/* =====================================================================
 * User scripts (spec 10.3): Kick Assembler code the user writes in Mimir to work on the program's bytes, such as
 * running a decryption loop over a block. A script is assembled with the built-in assembler, with the program's
 * labels and zero-page variables (as the listing names them), the hardware names and its scratchpads at hand, and
 * run in Sindri's 6510 on a copy of memory as LOAD leaves it: the files at their load addresses, plain RAM (no ROMs,
 * no I/O, no interrupts). It starts at its `start` label, else at its first byte, and ends at its last RTS (it is
 * called like SYS) or at a BRK. A run never changes the project's files: what the script leaves in its scratchpads
 * is kept, and what it changed in the program's bytes is listed, so that it can be written over them as a patch.
 * Scripts are not part of the export or of Build & Run.
 * ===================================================================== */
import { Cpu, type Bus } from '@mimir/sindri';
import type { Addr, Cartridge, FileInput, LoadedFile, RenderResult, ScriptPad, Settings, UserScript } from './types';
import { assemble } from './verify/kick-subset-assembler';
import { programNames } from './patch';
import { fileSpaces } from './spaces';
import { OPC } from './cpu/opcodes';
import { h2, h4 } from './util/hex';

export interface ScriptRange { start: Addr; end: Addr }

/** What a script runs with: the program's memory as LOAD leaves it and the names the code may use. */
export interface ScriptEnv {
  /** the files at their load addresses, later over earlier (a cartridge's: those of the bank the C64 starts in) */
  files: readonly Pick<LoadedFile, 'load' | 'bytes'>[];
  /** the hardware names and the program's labels and zero-page variables, as the listing names them */
  names: ReadonlyMap<string, Addr>;
}

/** The env of a project: its files (with the patches that are on) and the names its listing gives. */
export function scriptEnv(project: { files: readonly FileInput[]; cart?: Cartridge | null }, R: Pick<RenderResult, 'labels' | 'zp'>, settings: Pick<Settings, 'hexCase'>): ScriptEnv {
  const l = fileSpaces(project);
  const files = project.files.filter((_, i) => !l || l.spaces[i] === 0).map(f => ({ load: f.load, bytes: f.bytes }));
  return { files, names: programNames(R, settings) };
}

/** which addresses the files hold */
export function loadedMask(files: ScriptEnv['files']): Uint8Array {
  const m = new Uint8Array(0x10000);
  for (const f of files) m.fill(1, f.load, Math.min(0x10000, f.load + f.bytes.length));
  return m;
}

/** the runs of set bytes in a mask */
export function maskRanges(mask: ArrayLike<number>, from = 0, to = 0x10000): ScriptRange[] {
  const out: ScriptRange[] = [];
  for (let a = from; a < to; a++) {
    if (!mask[a]) continue;
    const s = a; while (a < to && mask[a]) a++;
    out.push({ start: s, end: a });
  }
  return out;
}

/** `$c000-$c0ff` (end excluded in the range, included in the text) */
export const rangeText = (r: ScriptRange): string => r.end - r.start === 1 ? `$${h4(r.start)}` : `$${h4(r.start)}-$${h4(r.end - 1)}`;

/**
 * A place for `size` bytes that no file, no range of `taken` and not the zero page or the stack ($0000-$01ff) holds:
 * `near` when it is free, else $c000 (the C64's free 4 KB), else the largest free area (from $1000 when that leaves
 * room), its start rounded up to a page when that leaves room. null: there is none so large.
 */
export function freePlace(files: ScriptEnv['files'], size: number, taken: readonly ScriptRange[] = [], near?: Addr): Addr | null {
  const used = loadedMask(files);
  used.fill(1, 0, 0x200);
  for (const r of taken) used.fill(1, Math.max(0, r.start), Math.min(0x10000, r.end));
  const fits = (a: number) => { if (a < 0 || a + size > 0x10000) return false; for (let k = a; k < a + size; k++) if (used[k]) return false; return true; };
  for (const a of [near, 0xc000]) if (a != null && fits(a)) return a;
  const free: ScriptRange[] = [];
  for (let a = 0; a < 0x10000; a++) {
    if (used[a]) continue;
    const s = a; while (a < 0x10000 && !used[a]) a++;
    free.push({ start: s, end: a });
  }
  free.sort((a, b) => (b.end - b.start) - (a.end - a.start) || a.start - b.start);
  for (const r of free) {
    let s = r.start < 0x1000 && r.end - 0x1000 >= size ? 0x1000 : r.start;
    if (((s + 0xff) & ~0xff) + size <= r.end) s = (s + 0xff) & ~0xff;
    if (s + size <= r.end) return s;
  }
  return null;
}

/** a script name of its own in the project: `base`, else `base2`, `base3`, … */
export function scriptName(taken: readonly { name: string }[], base = 'script'): string {
  const has = (n: string) => taken.some(s => s.name.toLowerCase() === n.toLowerCase());
  if (!has(base)) return base;
  for (let i = 2; ; i++) if (!has(`${base}${i}`)) return `${base}${i}`;
}

/** a scratchpad name of its own in the script: pad1, pad2, … */
export const padName = (pads: readonly ScriptPad[]): string => { for (let i = 1; ; i++) if (!pads.some(p => p.name === `pad${i}`)) return `pad${i}`; };

/**
 * A new script: its code in free memory (at the program's own bytes when there is none), one scratchpad of 256 bytes
 * after it, and `body` (lines of the listing, say) between `start:` and the RTS that ends it.
 */
export function newScript(files: ScriptEnv['files'], taken: readonly { name: string }[], body: readonly string[] = [], id = Math.random().toString(36).slice(2, 10)): UserScript {
  const name = scriptName(taken);
  const code = freePlace(files, 0x800) ?? freePlace(files, 0x100) ?? 0xc000;
  const pad = freePlace(files, 0x100, [{ start: code, end: code + 0x800 }], code + 0x800) ?? Math.min(0xff00, code + 0x800);
  const indent = '        ';
  const lines = body.length ? body.map(l => (/^\S/.test(l) && !/^[!A-Za-z_]\w*:/.test(l) ? indent + l : l)) : [`${indent}// your code: the program's labels and variables, the hardware names and pad1 can be used`];
  const source = [
    `// ${name}: runs in Mimir on a copy of the program's memory (never in the export or Build & Run).`,
    '// It starts at start: and ends at its last RTS or at a BRK; pad1 is its scratchpad.',
    `${indent}* = $${h4(code)} "${name}"`,
    'start:',
    ...lines,
    `${indent}rts`,
    '',
  ].join('\n');
  return { id, name, lang: 'kickass', source, pads: [{ name: 'pad1', start: pad, size: 0x100 }] };
}

export interface ScriptProblem {
  level: 'error' | 'warning';
  msg: string;
  /** the line of the code (1 for the first); missing: not on a line */
  line?: number;
  /** the scratchpad it is about (its index) */
  pad?: number;
}

/** A script checked: assembled, and its scratchpads looked at. It can run when `ok`. */
export interface ScriptCheck {
  ok: boolean;
  problems: ScriptProblem[];
  /** where it starts: its `start` label, else its first byte (null: it has no code) */
  entry: Addr | null;
  /** the memory its code writes */
  code: ScriptRange[];
  bytes: number;
  /** what `.print` printed */
  prints: string[];
  /** the assembled bytes, and which addresses they are at */
  mem: Uint8Array;
  written: Uint8Array;
}

const PAD_NAME = /^[A-Za-z_]\w*$/;

/** the names a script's code may use: the program's, the hardware's and its scratchpads' (`pad`, `pad_end`) */
export function scriptNames(env: ScriptEnv, pads: readonly ScriptPad[]): Map<string, Addr> {
  const out = new Map(env.names);
  for (const p of pads) if (PAD_NAME.test(p.name)) { out.set(p.name, p.start); out.set(`${p.name}_end`, p.start + p.size); }
  return out;
}

/** Assemble the script and check it and its scratchpads: it can run when nothing is an error. */
export function checkScript(env: ScriptEnv, script: Pick<UserScript, 'source' | 'pads'>): ScriptCheck {
  const problems: ScriptProblem[] = [];
  const err = (msg: string, line?: number, pad?: number) => problems.push({ level: 'error', msg, ...(line ? { line } : {}), ...(pad != null ? { pad } : {}) });
  const warn = (msg: string, line?: number, pad?: number) => problems.push({ level: 'warning', msg, ...(line ? { line } : {}), ...(pad != null ? { pad } : {}) });
  const loaded = loadedMask(env.files);
  // the scratchpads: a name of their own, inside memory, not over each other
  script.pads.forEach((p, i) => {
    if (!PAD_NAME.test(p.name)) err(`Scratchpad "${p.name}": a name is letters, digits and _, not starting with a digit.`, undefined, i);
    else if (script.pads.findIndex(q => q.name === p.name) !== i) err(`There are two scratchpads called "${p.name}".`, undefined, i);
    if (!(Number.isInteger(p.start) && Number.isInteger(p.size) && p.start >= 0 && p.size >= 1 && p.start + p.size <= 0x10000)) { err(`Scratchpad "${p.name}" must lie inside $0000-$ffff and hold a byte at least.`, undefined, i); return; }
    const o = script.pads.findIndex((q, j) => j < i && q.start < p.start + p.size && p.start < q.start + q.size);
    if (o >= 0) err(`Scratchpad "${p.name}" lies over "${script.pads[o].name}".`, undefined, i);
    if (p.start < 0x200) warn(`Scratchpad "${p.name}" lies in the zero page or the stack ($0000-$01ff): the CPU uses those bytes as the script runs.`, undefined, i);
    let over = 0; for (let a = p.start; a < p.start + p.size; a++) over += loaded[a];
    if (over) warn(`Scratchpad "${p.name}" lies over ${over} of the program's bytes: the script sees the pad there, not the program.`, undefined, i);
  });
  const asm = assemble({ 'script.asm': script.source }, 'script.asm', { names: scriptNames(env, script.pads), pc: 0x1000 });
  for (const e of asm.errors) err(e.msg, e.file === 'script.asm' && e.line > 0 ? e.line : undefined);
  const code = maskRanges(asm.written);
  const bytes = code.reduce((n, r) => n + r.end - r.start, 0);
  const own = asm.symbols.get('start');
  const entry = typeof own === 'number' ? own & 0xffff : asm.first >= 0 ? asm.first : null;
  if (!asm.errors.length) {
    if (entry == null) err('The script has no code to run: write the instructions it runs (it starts at start:, else at its first byte).');
    let over = 0; for (const r of code) for (let a = r.start; a < r.end; a++) over += loaded[a] && !script.pads.some(p => a >= p.start && a < p.start + p.size) ? 1 : 0;
    if (over) warn(`The script's code lies over ${over} of the program's bytes (${code.filter(r => { for (let a = r.start; a < r.end; a++) if (loaded[a]) return true; return false; }).map(rangeText).join(', ')}): they are the script's while it runs.`);
    if (code.some(r => r.start < 0x200 && r.end > 0x100)) warn('The script\'s code lies in the stack ($0100-$01ff): JSR, RTS and the start of the run write there.');
  }
  return { ok: !problems.some(p => p.level === 'error'), problems, entry, code, bytes, prints: asm.prints, mem: asm.mem, written: asm.written };
}

/** how a run ended: the RTS that returns from the script, a BRK, a JAM opcode, or the instruction limit */
export type ScriptEnd = 'rts' | 'brk' | 'jam' | 'limit';

/** A run changed `start`..`end` (excluded) of the program's bytes: `bytes` as it left them, `old` as they were. */
export interface ScriptChange extends ScriptRange { bytes: Uint8Array; old: Uint8Array }

export interface ScriptRun {
  end: ScriptEnd;
  /** where it ended: the RTS, the BRK or the JAM, or the instruction it was at when the limit came */
  at: Addr;
  instructions: number;
  cycles: number;
  regs: { a: number; x: number; y: number; s: number; p: number; pc: number };
  /** what each scratchpad holds after the run, by name */
  pads: { name: string; bytes: Uint8Array }[];
  /** the program's bytes it changed (outside its scratchpads and its own code), nearby changes taken together */
  changes: ScriptChange[];
  /** bytes changed elsewhere: neither the program's, a scratchpad's nor the code's (the zero page, say) */
  other: number;
  /** the memory after the run */
  mem: Uint8Array;
  ms: number;
}

/** instructions a run may take before it is stopped (about 1.5 s; the 6510 runs some 140 million a second) */
export const SCRIPT_LIMIT = 200_000_000;

/** where the RTS that ends the script returns to: the run pushes $ffff, so it lands at $0000 with the stack empty */
const DONE = 0x0000;

/**
 * Run a script that checked ok: memory as LOAD leaves it, the scratchpads filled, the script's bytes over them;
 * the 6510 starts at the entry with the stack holding the return address of a SYS, and goes until the script
 * returns, a BRK or JAM, or `limit` instructions.
 */
export function runScript(env: ScriptEnv, script: Pick<UserScript, 'source' | 'pads'>, check: ScriptCheck = checkScript(env, script), limit = SCRIPT_LIMIT): ScriptRun {
  if (!check.ok || check.entry == null) throw new Error(check.problems.find(p => p.level === 'error')?.msg ?? 'The script has no code to run.');
  const t0 = Date.now();
  const mem = new Uint8Array(0x10000), loaded = loadedMask(env.files), pad = new Uint8Array(0x10000);
  for (const f of env.files) mem.set(f.bytes.subarray(0, Math.max(0, 0x10000 - f.load)), f.load);
  for (const p of script.pads) { mem.fill((p.fill ?? 0) & 0xff, p.start, p.start + p.size); pad.fill(1, p.start, p.start + p.size); }
  for (let a = 0; a < 0x10000; a++) if (check.written[a]) mem[a] = check.mem[a];
  const bus: Bus = { read: a => mem[a], write: (a, v) => { mem[a] = v; }, fetch: a => mem[a] };
  const cpu = new Cpu(bus);
  // called like SYS: the return address on the stack, interrupts off
  mem[0x1ff] = (DONE - 1) >> 8 & 0xff; mem[0x1fe] = (DONE - 1) & 0xff; cpu.s = 0xfd; cpu.pc = check.entry; cpu.i = 1;
  const before = mem.slice();
  let n = 0, cycles = 0, end: ScriptEnd = 'limit', at = cpu.pc;
  while (n < limit) {
    at = cpu.pc;
    cycles += cpu.step(); n++;
    if (cpu.jammed) { end = 'jam'; break; }
    const op = cpu.lastOp;
    if (op === 0x00) { end = 'brk'; break; }
    if (op === 0x60 && cpu.s === 0xff && cpu.pc === DONE) { end = 'rts'; break; }
  }
  if (end === 'limit') at = cpu.pc;
  // what changed: in the program's bytes outside the pads and the code, nearby changes taken together
  const changes: ScriptChange[] = [];
  let other = 0;
  const GAP = 8;
  for (let a = 0; a < 0x10000; a++) {
    if (mem[a] === before[a] || pad[a] || check.written[a]) continue;
    if (!loaded[a]) { other++; continue; }
    const last = changes[changes.length - 1];
    if (last && a - last.end <= GAP && [...Array(a - last.end).keys()].every(k => loaded[last.end + k] && !pad[last.end + k] && !check.written[last.end + k])) last.end = a + 1;
    else changes.push({ start: a, end: a + 1, bytes: new Uint8Array(0), old: new Uint8Array(0) });
  }
  for (const c of changes) { c.bytes = mem.slice(c.start, c.end); c.old = before.slice(c.start, c.end); }
  return {
    end, at, instructions: n, cycles, regs: { a: cpu.a, x: cpu.x, y: cpu.y, s: cpu.s, p: cpu.p, pc: cpu.pc },
    pads: script.pads.map(p => ({ name: p.name, bytes: mem.slice(p.start, p.start + p.size) })),
    changes, other, mem, ms: Date.now() - t0,
  };
}

/** How a run ended, in a sentence. */
export function scriptEndText(r: Pick<ScriptRun, 'end' | 'at' | 'instructions' | 'cycles'>): string {
  const n = `${r.instructions.toLocaleString('en-US')} instruction${r.instructions === 1 ? '' : 's'}, ${r.cycles.toLocaleString('en-US')} cycles`;
  switch (r.end) {
    case 'rts': return `Returned (RTS at $${h4(r.at)}) after ${n}.`;
    case 'brk': return `Stopped at the BRK at $${h4(r.at)} after ${n}.`;
    case 'jam': return `The CPU jammed at $${h4(r.at)} (a JAM opcode) after ${n}: did the code run into data?`;
    case 'limit': return `Stopped after ${n} at $${h4(r.at)}, the most a run may take: does it loop for ever?`;
  }
}

/** Bytes as `.byte` lines, `perRow` a line, for a patch's code or the clipboard. */
export function byteLines(bytes: ArrayLike<number>, perRow = 16, indent = '        '): string[] {
  const out: string[] = [];
  for (let i = 0; i < bytes.length; i += perRow) out.push(`${indent}.byte ${Array.from({ length: Math.min(perRow, bytes.length - i) }, (_, k) => `$${h2(bytes[i + k])}`).join(', ')}`);
  return out;
}

/** A line of a scratchpad's bytes disassembled: its address, its bytes and the instruction (names for its target). */
export interface PadInstruction { a: Addr; n: number; text: string; ill: boolean }

/** `bytes` disassembled as if at `at`, an instruction a line; a target with a name in `names` gets the name. */
export function disassembleBytes(bytes: ArrayLike<number>, at: Addr, names?: ReadonlyMap<Addr, string>): PadInstruction[] {
  const out: PadInstruction[] = [];
  const name = (v: number, w: 2 | 4) => names?.get(v) ?? `$${w === 2 ? h2(v) : h4(v)}`;
  for (let i = 0; i < bytes.length;) {
    const o = OPC[bytes[i]], a = (at + i) & 0xffff;
    if (i + o.len > bytes.length) { out.push({ a, n: 1, text: `.byte $${h2(bytes[i])}`, ill: false }); i++; continue; }
    const lo = bytes[i + 1], w = lo | (bytes[i + 2] << 8), mn = o.mn.toLowerCase();
    let arg = '';
    switch (o.mode) {
      case 'imm': arg = ` #$${h2(lo)}`; break;
      case 'zp': arg = ` ${name(lo, 2)}`; break; case 'zpx': arg = ` ${name(lo, 2)},x`; break; case 'zpy': arg = ` ${name(lo, 2)},y`; break;
      case 'izx': arg = ` (${name(lo, 2)},x)`; break; case 'izy': arg = ` (${name(lo, 2)}),y`; break;
      case 'abs': arg = ` ${name(w, 4)}`; break; case 'abx': arg = ` ${name(w, 4)},x`; break; case 'aby': arg = ` ${name(w, 4)},y`; break;
      case 'ind': arg = ` (${name(w, 4)})`; break;
      case 'rel': arg = ` ${name((a + 2 + ((lo ^ 0x80) - 0x80)) & 0xffff, 4)}`; break;
    }
    out.push({ a, n: o.len, text: mn + arg, ill: o.ill });
    i += o.len;
  }
  return out;
}
