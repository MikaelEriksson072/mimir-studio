/* =====================================================================
 * A user script run in the whole C64 (spec 10.3, UserScript.machine 'c64'): Sindri's machine as it stands at the READY
 * prompt, with the ROMs, the VIC, the CIAs and their interrupts, and a 1541 with the mounted disk on the serial bus,
 * instead of a copy of the program's memory and nothing else. The script can then call code that needs the machine:
 * the KERNAL's LOAD, the game's own loader with its drive code, a routine that waits for a timer or a raster line.
 *
 * The program's files are put into the C64's RAM at their load addresses, as LOAD leaves them, and the script's code
 * and scratchpads too: here they are in the same memory as the program (there is one machine), so the program's code
 * sees them, and the script's code must not lie where what it loads goes. The run starts at the script's entry, called
 * like SYS, with $01 as at READY (BASIC, the KERNAL and the I/O in) and the registers and flags of the script's init
 * (interrupts off unless the init clears I or the code does). It ends when the script returns, at a BRK, at a JAM, at
 * the address it stops at, or after `maxCycles`.
 *
 * What it gives is a ScriptRun as the plain machine's: the program's bytes it changed (not the script's own), the
 * scratchpads, and every stretch of memory it wrote (`wrote`: what a loader loaded).
 * ===================================================================== */
import { driveWith, readyC64, type Roms } from '@mimir/sindri';
import type { Addr, UserScript } from './types';
import { checkScript, maskRanges, padStart, runChanges, SCRIPT_P, type ScriptCheck, type ScriptEnd, type ScriptEnv, type ScriptRun } from './script';
import { vicMatrix, c64TextScreen } from './script-screen';

/** What a run in the whole C64 needs: the ROMs (with the 1541's DOS ROM when a disk is to be used), and the disk in the
 *  drive (a D64 or a G64; null: no drive on the bus). */
export interface ScriptC64 { roms: Roms; disk?: Uint8Array | null }

/** the cycles a run in the whole C64 may take: ten minutes of the C64's time (a disk loads slowly) */
export const SCRIPT_C64_CYCLES = 600_000_000;

/** where the RTS that ends the script returns to: the run pushes $ffff, so it lands at $0000 with the stack empty */
const DONE = 0x0000;

/**
 * Run a script that checked ok in the whole C64, to its end. `stopAt`: the run ends when it gets to this address.
 * Throws when the C64 does not start with the ROMs, or a disk is given and the ROMs have no 1541 DOS ROM.
 */
export function runScriptInC64(env: ScriptEnv, script: Pick<UserScript, 'source' | 'pads' | 'init'> & Partial<Pick<UserScript, 'lang'>>, hw: ScriptC64,
  check: ScriptCheck = checkScript(env, script), stopAt: Addr | null = null, maxCycles = SCRIPT_C64_CYCLES): ScriptRun {
  if (!check.ok || check.entry == null) throw new Error(check.problems.find(p => p.level === 'error')?.msg ?? 'The script has no code to run.');
  const t0 = Date.now();
  const m = readyC64(hw.roms);
  if (!m) throw new Error('The C64 did not start with these ROMs: a run in the whole C64 needs the ROM files of VICE (Settings → Toolchain).');
  if (hw.disk) {
    if (!hw.roms.drive) throw new Error('The ROMs have no 1541 DOS ROM, so the disk cannot be used: it is with VICE (Settings → Toolchain).');
    m.attachDrive(driveWith(hw.roms.drive, hw.disk));
  }
  const { ram, cpu } = m;
  // the program as LOAD leaves it, then the script's own bytes: its scratchpads as a run starts them, and its code
  for (const f of env.files) { const from = Math.max(0, 2 - f.load); if (f.load + from < 0x10000) ram.set(f.bytes.subarray(from, Math.max(from, 0x10000 - f.load)), f.load + from); }
  const own = new Uint8Array(0x10000);
  for (const p of script.pads) {
    if (!(p.start >= 2 && p.size >= 1 && p.start + p.size <= 0x10000)) continue;
    ram.set(padStart(p), p.start); own.fill(1, p.start, p.start + p.size);
  }
  for (let a = 2; a < 0x10000; a++) if (check.written[a]) { ram[a] = check.mem[a]; own[a] = 1; }
  // called like SYS: the return address on the stack; the init's zero page, registers and flags
  cpu.s = 0xfd; ram[0x1ff] = ((DONE - 1) >> 8) & 0xff; ram[0x1fe] = (DONE - 1) & 0xff;
  const init = script.init;
  for (const z of init?.zp ?? []) { const a = z.at & 0xff; if (a > 1) ram[a] = z.value & 0xff; if (z.word && a + 1 > 1) ram[(a + 1) & 0xff] = (z.value >> 8) & 0xff; }
  cpu.a = (init?.a ?? 0) & 0xff; cpu.x = (init?.x ?? 0) & 0xff; cpu.y = (init?.y ?? 0) & 0xff; cpu.p = (init?.p ?? SCRIPT_P) & 0xff;
  cpu.pc = check.entry;
  const before = ram.slice(), colorBefore = m.color.slice(), sideBefore = [m.vic.regs[0x20] & 15, m.vic.regs[0x21] & 15, m.vic.regs[0x18]];
  // (what is written from here on has an instruction count past this one: C64.wtime)
  m.icount++;
  const ic0 = m.icount, c0 = m.cycles;
  let end: ScriptEnd = 'limit', at = cpu.pc;
  for (let first = true; ; first = false) {
    const pc = cpu.pc;
    if (m.cycles - c0 >= maxCycles) { at = pc; break; }
    if (!first && stopAt != null && pc === stopAt) { end = 'stop'; at = pc; break; }
    at = pc;
    if (m.peek(pc) === 0x00) { end = 'brk'; break; }
    const iWas = cpu.i;
    m.dmaWait();
    const cycles = cpu.step();
    m.icount++;
    if (cpu.jammed) { end = 'jam'; break; }
    m.advance(cycles);
    if (cpu.lastOp === 0x60 && cpu.s === 0xff && cpu.pc === DONE) { end = 'rts'; break; }
    if (m.irqDue() && !(cpu.lastOp === 0x40 ? cpu.i : iWas)) m.advance(m.takeIrq());
    if (m.nmiDue()) m.advance(m.takeNmi());
  }
  const mem = ram.slice();
  // the C64's screen as the VIC shows it now: changed when the run wrote into its matrix or the colour RAM, or set the
  // border, the background or where the screen is
  const matrix = vicMatrix(m);
  let drew = m.color.some((v, i) => (v & 15) !== (colorBefore[i] & 15)) || (m.vic.regs[0x20] & 15) !== sideBefore[0] || (m.vic.regs[0x21] & 15) !== sideBefore[1] || m.vic.regs[0x18] !== sideBefore[2];
  for (let i = 0; i < 1000 && !drew; i++) if (m.wtime[(matrix + i) & 0xffff] >= ic0) drew = true;
  // what the run wrote: of the program's memory (not the script's own bytes), and of each scratchpad
  const wrote = new Uint8Array(0x10000);
  for (let a = 0x200; a < 0x10000; a++) if (m.wtime[a] >= ic0) wrote[a] = 1;
  const pads = script.pads.map(p => {
    const w = wrote.subarray(p.start, p.start + p.size), firstW = w.indexOf(1);
    return { name: p.name, bytes: mem.slice(p.start, p.start + p.size), ...(firstW >= 0 ? { wrote: [firstW, w.lastIndexOf(1) + 1] as [number, number] } : {}) };
  });
  const { changes, other } = runChanges(mem, before, env.files, own);
  for (let a = 0; a < 0x10000; a++) if (own[a]) wrote[a] = 0;
  return {
    end, at, instructions: m.icount - ic0, cycles: m.cycles - c0,
    regs: { a: cpu.a, x: cpu.x, y: cpu.y, s: cpu.s, p: cpu.p, pc: cpu.pc },
    pads, changes, other, mem, own: mem, wrote: maskRanges(wrote, 0x200), ms: Date.now() - t0, screen: c64TextScreen(m, drew),
  };
}
