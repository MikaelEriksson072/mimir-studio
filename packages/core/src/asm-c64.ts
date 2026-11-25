/* =====================================================================
 * The Assembler's program run in the whole C64 (spec 10.7, Runs in: Whole C64): Sindri's C64 as it stands at READY
 * with VICE's ROMs, the VIC, the CIAs and their interrupts (and a 1541 when a disk is given), in place of the memory-
 * only machine. The program is put into RAM as LOAD leaves it (the PRG its assembler makes, and a BASIC program's end
 * where RUN keeps its variables) and started as from the READY prompt: RUN typed for its BASIC line, else SYS and its
 * start. The machine stops where the program's first instruction is about to run: the debugger's start. From there it
 * goes an instruction at a time, or on in the C64's own time (a frame at a time) until a breakpoint or a pause; it does
 * not end by itself (a program that returns goes back to BASIC, as on a C64), only a JAM stops it.
 *
 * Its picture is the VIC's frame as VICE draws it (vicScreen), line by line with the registers each raster line started
 * with, so that raster bars and splits show; the keys pressed go into the keyboard matrix (c64Key says where a key of
 * the PC's keyboard is on the C64's).
 * ===================================================================== */
import { driveWith, readyC64, type C64, type Cpu, type Roms } from '@mimir/sindri';
import type { Addr } from './types';
import type { AsmCheck } from './asm-project';
import type { ScriptCheck, ScriptEnd, ScriptRun, StackEntry } from './script';
import { c64TextScreen, type ScriptScreen } from './script-screen';
import { vicScreen, vicState, type VicScreen, type VicState } from './c64/vicscreen';
import { h4 } from './util/hex';

/** the PAL C64's clock (cycles a second), its raster lines and cycles a line */
export const PAL_CLOCK = 985_248;
export const PAL_LINES = 312;
export const LINE_CYCLES = 63;
export const FRAME_CYCLES = PAL_LINES * LINE_CYCLES;
/** the C64's time the start may take (RUN typed at READY, BASIC running the line and its SYS) */
const START_CYCLES = 3 * PAL_CLOCK;

/** What a run in the whole C64 needs: VICE's ROMs (with the 1541's DOS ROM for a disk), and a disk for drive 8. */
export interface AsmC64Options { roms: Roms; disk?: Uint8Array | null }

export class AsmC64 {
  readonly m: C64;
  readonly cpu: Cpu;
  /** the program's labels by address (the debugger's names), its lines */
  readonly check: ScriptCheck;
  /** (the debugger's: the code running is the program's, or the ROMs') */
  readonly inScript = true;
  /** how it ended: only a JAM ends it (null: it goes on) */
  end: ScriptEnd | null = null;
  /** the address of the instruction run last */
  at: Addr;
  /** what was typed at READY to start it */
  readonly typed: string;
  /** where its start's return into BASIC is on the stack */
  private readonly startS: number;
  private readonly c0: number;
  private readonly i0: number;
  private readonly t0 = Date.now();
  /** who made each JSR whose return address is on the stack, by the stack pointer before it */
  private readonly frames = new Map<number, boolean>();
  /** the VIC's registers and bank as each raster line started (a frame's worth, written over line by line) */
  private readonly lineRegs = new Uint8Array(PAL_LINES * 0x40);
  private readonly lineBank = new Uint8Array(PAL_LINES);
  private lastLine = -1;
  /** the last frame drawn whole, and how many were */
  private frame: VicScreen | null = null;
  drawn = 0;

  constructor(c: Pick<AsmCheck, 'ok' | 'entry' | 'entryFrom' | 'asm' | 'check'>, o: AsmC64Options) {
    if (!c.ok || c.entry == null) throw new Error('The program does not assemble in Mimir, so it cannot run in the C64.');
    const m = readyC64(o.roms);
    if (!m) throw new Error('The C64 did not start with these ROMs: a run in the whole C64 needs the ROM files of VICE (Settings → Toolchain).');
    if (o.disk) {
      if (!o.roms.drive) throw new Error('The ROMs have no 1541 DOS ROM, so the disk cannot be used: it is with VICE (Settings → Toolchain).');
      m.attachDrive(driveWith(o.roms.drive, o.disk));
    }
    this.m = m; this.cpu = m.cpu; this.check = c.check;
    // the program as LOAD leaves it: the PRG its assembler makes (the gaps between its parts zeros), not over the CPU's
    // port at $0000-$0001
    const prg = c.asm.prg, load = prg && prg.length > 2 ? prg[0] | (prg[1] << 8) : 0;
    let end = 0;
    if (prg && prg.length > 2) {
      const from = Math.max(0, 2 - load);
      m.ram.set(prg.subarray(2 + from, 2 + Math.max(from, 0x10000 - load)), load + from);
      end = Math.min(0x10000, load + prg.length - 2);
    }
    // a BASIC program's end, where LOAD puts it: RUN keeps its variables after the program
    if (load === 0x0801) for (const p of [0x2d, 0x2f, 0x31, 0xae]) { m.ram[p] = end & 0xff; m.ram[p + 1] = (end >> 8) & 0xff; }
    // started as from READY: RUN for its BASIC line, else SYS and its start; stopped where its first instruction is
    this.typed = c.entryFrom === 'basic' ? 'RUN' : `SYS${c.entry}`;
    const keys = [...`${this.typed}\r`].map(ch => (ch === '\r' ? 0x0d : ch.charCodeAt(0)));
    m.ram.set(keys, 0x0277); m.ram[0xc6] = keys.length;
    m.icount++;
    this.c0 = m.cycles; this.i0 = m.icount; this.at = this.cpu.pc;
    while (this.cpu.pc !== c.entry) {
      if (m.cycles - this.c0 > START_CYCLES) throw new Error(`The program did not start: ${this.typed} was typed at READY, and after ${START_CYCLES / PAL_CLOCK} seconds of the C64's time it had not got to $${h4(c.entry)} (it was at $${h4(this.cpu.pc)}).`);
      if (!this.step()) throw new Error(`The C64 jammed at $${h4(this.at)} before the program started.`);
    }
    this.frames.clear();
    this.startS = this.cpu.s;
    this.c0 = m.cycles; this.i0 = m.icount;
  }

  /** instructions and cycles since the program started */
  get instructions(): number { return this.m.icount - this.i0; }
  get cycles(): number { return this.m.cycles - this.c0; }
  /** seconds of the C64's time since it started */
  get seconds(): number { return this.cycles / PAL_CLOCK; }

  /** the VIC's bank: CIA 2's port A, bits 0-1 (inputs read as 1) */
  private bank(): number { const c = this.m.cia2; return 3 - (((c.pra & c.ddra) | (~c.ddra & 0xff)) & 3); }

  /** Run one instruction (and an interrupt that is due); false once it has ended (a JAM). */
  step(): boolean {
    if (this.end) return false;
    const m = this.m, cpu = this.cpu, s0 = cpu.s, iWas = cpu.i;
    this.at = cpu.pc;
    m.dmaWait();
    const n = cpu.step();
    m.icount++;
    if (cpu.jammed) { this.end = 'jam'; return false; }
    m.advance(n);
    const op = cpu.lastOp;
    if (op === 0x20) this.frames.set(s0, true);
    else if (op === 0x60) this.frames.delete(cpu.s);
    if (m.irqDue() && !(op === 0x40 ? cpu.i : iWas)) m.advance(m.takeIrq());
    if (m.nmiDue()) m.advance(m.takeNmi());
    this.tick();
    return true;
  }

  /** a new raster line: its registers kept for the picture; a new frame: the picture drawn */
  private tick(): void {
    const line = this.m.vic.line;
    if (line === this.lastLine) return;
    if (line < this.lastLine) { this.frame = this.draw(PAL_LINES); this.drawn++; }
    const regs = this.m.vic.regs, bank = this.bank();
    // (and the lines an instruction stepped over)
    for (let l = this.lastLine < 0 || line < this.lastLine ? line : this.lastLine + 1; l <= line; l++) { this.lineRegs.set(regs, l * 0x40); this.lineBank[l] = bank; }
    this.lastLine = line;
  }

  /** the picture with each line's registers up to `upTo`, and the registers as they are now below it */
  private draw(upTo: number): VicScreen {
    const m = this.m, now = vicState(m.vic.regs, this.bank(), m.ram);
    let prev: { line: number; st: VicState } | null = null;
    const regsAt = (l: number) => this.lineRegs.subarray(l * 0x40, l * 0x40 + 0x40);
    const lineOf = (line: number): VicState => {
      if (line >= upTo || line >= PAL_LINES) return now;
      // a line whose registers and bank are the line before's has that line's state
      if (prev && prev.line === line - 1 && this.lineBank[line] === this.lineBank[prev.line]) {
        const a = regsAt(line), b = regsAt(prev.line);
        let same = true;
        for (let i = 0; i < 0x2f && same; i++) if (a[i] !== b[i]) same = false;
        if (same) { prev = { line, st: prev.st }; return prev.st; }
      }
      const st = vicState(regsAt(line), this.lineBank[line], m.ram);
      prev = { line, st };
      return st;
    };
    return vicScreen(now, m.ram, m.color, m.chargen, lineOf);
  }

  /** The VIC's picture: running, the last frame drawn whole; stopped (`now`), the frame as far as the raster beam has
   *  got with the registers each line had, and the registers as they are now from there down (what a step changed
   *  shows at once). */
  picture(now = false): VicScreen {
    if (!now && this.frame) return this.frame;
    return this.draw(this.lastLine < 0 ? 0 : this.lastLine);
  }

  /** the text screen the VIC shows (its characters and colours), for the screen's text */
  text(): ScriptScreen { return c64TextScreen(this.m, true); }

  /**
   * On until `stop` holds after an instruction, it ends, or `max` instructions have run: 'stopped', 'ended' or 'more'
   * (call again to go on).
   */
  runUntil(stop: ((m: AsmC64) => boolean) | null, max = Infinity): 'stopped' | 'ended' | 'more' {
    for (let n = 0; n < max; n++) {
      if (!this.step()) return 'ended';
      if (stop?.(this)) return 'stopped';
    }
    return 'more';
  }

  /** On for `cycles` of the C64's time (a frame's worth, in the C64's own time), or until `stop` holds or it ends. */
  runFor(cycles: number, stop: ((m: AsmC64) => boolean) | null): 'stopped' | 'ended' | 'more' {
    const until = this.m.cycles + cycles;
    while (this.m.cycles < until) {
      if (!this.step()) return 'ended';
      if (stop?.(this)) return 'stopped';
    }
    return 'more';
  }

  /** a byte as the CPU sees it now (the ROMs and the I/O where they are banked in) */
  peek(a: Addr): number { return this.m.peek(a & 0xffff); }
  /** the program's line at an address (the debugger names lines by file itself: asmLineAt) */
  lineAt(pc: Addr = this.cpu.pc): number | null { return this.check.lines[pc & 0xffff] || null; }
  callLine(): number | null { return null; }

  /** the stack from its top down to the stack pointer: the return into BASIC its start has, and the JSRs' returns */
  stack(): StackEntry[] {
    const out: StackEntry[] = [], ram = this.m.ram;
    for (let s = 0xff; s > this.cpu.s; s--) {
      const value = ram[0x100 + s];
      const by = s === this.startS + 2 ? 'start' : this.frames.has(s) ? 'program' : null;
      if (by && s - 1 > this.cpu.s) {
        out.push({ addr: 0x100 + s, value, ret: { to: (((value << 8) | ram[0x100 + s - 1]) + 1) & 0xffff, by } });
        out.push({ addr: 0x100 + s - 1, value: ram[0x100 + s - 1], low: true });
        s--;
      } else out.push({ addr: 0x100 + s, value });
    }
    return out;
  }

  /** the keys held down, by where they are in the keyboard matrix: [column (CIA 1 port A bit), row (port B bit)] */
  setKeys(keys: readonly (readonly [number, number])[]): void {
    const k = this.m.input.keys;
    k.fill(0);
    for (const [c, r] of keys) k[c & 7] |= 1 << (r & 7);
  }

  /** the run as it stands: how far it got, its registers, its memory and its screen */
  result(): ScriptRun {
    const cpu = this.cpu, mem = this.m.ram.slice();
    return {
      end: this.end ?? 'stop', at: this.end ? this.at : cpu.pc, instructions: this.instructions, cycles: this.cycles,
      regs: { a: cpu.a, x: cpu.x, y: cpu.y, s: cpu.s, p: cpu.p, pc: cpu.pc }, pads: [], changes: [], other: 0, mem, own: mem, ms: Date.now() - this.t0,
      screen: this.text(),
    };
  }
}

/** How a run in the whole C64 stands, in a sentence; `where` names an address's line. */
export function asmC64Text(m: Pick<AsmC64, 'end' | 'at' | 'cpu' | 'instructions' | 'cycles' | 'seconds'>, where: (a: Addr) => string | null): string {
  const pc = m.end ? m.at : m.cpu.pc, w = where(pc);
  const n = `${m.instructions.toLocaleString('en-US')} instruction${m.instructions === 1 ? '' : 's'}, ${m.cycles.toLocaleString('en-US')} cycles (${m.seconds.toFixed(2)} s of the C64's time)`;
  if (m.end === 'jam') return `The CPU jammed at $${h4(pc)}${w ? ` (${w})` : ''} after ${n}: did the code run into data?`;
  return `Stopped at $${h4(pc)}${w ? ` (${w})` : pc >= 0xa000 && pc < 0xc000 ? ' in BASIC' : pc >= 0xe000 ? ' in the KERNAL' : ''} after ${n}.`;
}

/** where a key of the C64's keyboard is in its matrix: [column (CIA 1 port A bit), row (port B bit)] */
export const C64_KEYS: Readonly<Record<string, readonly [number, number]>> = {
  DEL: [0, 0], RETURN: [0, 1], RIGHT: [0, 2], F7: [0, 3], F1: [0, 4], F3: [0, 5], F5: [0, 6], DOWN: [0, 7],
  3: [1, 0], W: [1, 1], A: [1, 2], 4: [1, 3], Z: [1, 4], S: [1, 5], E: [1, 6], LSHIFT: [1, 7],
  5: [2, 0], R: [2, 1], D: [2, 2], 6: [2, 3], C: [2, 4], F: [2, 5], T: [2, 6], X: [2, 7],
  7: [3, 0], Y: [3, 1], G: [3, 2], 8: [3, 3], B: [3, 4], H: [3, 5], U: [3, 6], V: [3, 7],
  9: [4, 0], I: [4, 1], J: [4, 2], 0: [4, 3], M: [4, 4], K: [4, 5], O: [4, 6], N: [4, 7],
  '+': [5, 0], P: [5, 1], L: [5, 2], '-': [5, 3], '.': [5, 4], ':': [5, 5], '@': [5, 6], ',': [5, 7],
  '£': [6, 0], '*': [6, 1], ';': [6, 2], HOME: [6, 3], RSHIFT: [6, 4], '=': [6, 5], '↑': [6, 6], '/': [6, 7],
  1: [7, 0], '←': [7, 1], CTRL: [7, 2], 2: [7, 3], SPACE: [7, 4], CBM: [7, 5], Q: [7, 6], STOP: [7, 7],
};

/** A key of the PC's keyboard on the C64's: the C64 keys it holds down, and `shift` when it says whether SHIFT is held
 *  with them (a character the C64 has elsewhere: `"` is SHIFT and 2) rather than the PC's own Shift keys. */
export interface C64Key { keys: (readonly [number, number])[]; shift?: boolean }

/** the characters typed on the PC that the C64 has on a key of its own, with or without SHIFT */
const SYMBOLS: Readonly<Record<string, [string, boolean]>> = {
  '+': ['+', false], '-': ['-', false], '.': ['.', false], ',': [',', false], ':': [':', false], ';': [';', false], '=': ['=', false],
  '/': ['/', false], '*': ['*', false], '@': ['@', false], '£': ['£', false], '^': ['↑', false],
  '!': ['1', true], '"': ['2', true], '#': ['3', true], $: ['4', true], '%': ['5', true], '&': ['6', true], "'": ['7', true], '(': ['8', true], ')': ['9', true],
  '<': [',', true], '>': ['.', true], '?': ['/', true], '[': [':', true], ']': [';', true],
};

/**
 * Where a key of the PC's keyboard (a KeyboardEvent's `code` and `key`) is on the C64's, as VICE's own mapping has it:
 * letters, digits, Space, Return (Enter), INST/DEL (Backspace; Insert is SHIFT and it), CLR/HOME (Home), RUN/STOP (Esc),
 * CTRL (Ctrl, Tab), C= (Alt), the Shift keys, the cursor keys (left and up are SHIFT and right and down), F1-F8 (F2 is
 * SHIFT and F1 …), and the punctuation by the character it types. null: the C64 has no such key.
 */
export function c64Key(code: string, key: string): C64Key | null {
  const k = (name: string) => C64_KEYS[name];
  const one = (name: string, shift?: boolean): C64Key => ({ keys: [k(name)], ...(shift == null ? {} : { shift }) });
  if (/^Key[A-Z]$/.test(code)) return one(code.slice(3));
  if (/^(Digit|Numpad)[0-9]$/.test(code)) return one(code.slice(-1));
  switch (code) {
    case 'Space': return one('SPACE');
    case 'Enter': case 'NumpadEnter': return one('RETURN');
    case 'Backspace': case 'Delete': return one('DEL');
    case 'Insert': return one('DEL', true);
    case 'Home': return one('HOME');
    case 'Escape': return one('STOP');
    case 'ControlLeft': case 'ControlRight': case 'Tab': return one('CTRL');
    case 'AltLeft': return one('CBM');
    case 'ShiftLeft': return one('LSHIFT');
    case 'ShiftRight': return one('RSHIFT');
    case 'ArrowRight': return one('RIGHT', false);
    case 'ArrowLeft': return one('RIGHT', true);
    case 'ArrowDown': return one('DOWN', false);
    case 'ArrowUp': return one('DOWN', true);
    case 'F1': case 'F3': case 'F5': case 'F7': return one(code, false);
    case 'F2': case 'F4': case 'F6': case 'F8': return one(`F${+code.slice(1) - 1}`, true);
  }
  const s = SYMBOLS[key];
  return s ? one(s[0], s[1]) : null;
}

/**
 * The C64 keys held down for the PC's keys held down now (by their `code`, each with what c64Key gave): SHIFT held as
 * the PC's Shift keys say, unless a key held says otherwise (the last one pressed wins).
 */
export function c64Held(held: readonly { code: string; key: C64Key }[]): (readonly [number, number])[] {
  let shift: boolean | undefined;
  for (const h of held) if (h.key.shift != null) shift = h.key.shift;
  const out: (readonly [number, number])[] = [];
  const shiftKeys = new Set([C64_KEYS.LSHIFT, C64_KEYS.RSHIFT]);
  for (const h of held) for (const kk of h.key.keys) if (!shiftKeys.has(kk) || shift == null) out.push(kk);
  if (shift) out.push(C64_KEYS.LSHIFT);
  return out;
}
