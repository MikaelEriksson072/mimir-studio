/* =====================================================================
 * User scripts (spec 10.3): Kick Assembler code the user writes in Mimir to work on the program's bytes, such as
 * running a decryption loop over a block. A script is assembled with the built-in assembler, with the program's
 * labels and zero-page variables (as the listing names them), the hardware names and its scratchpads at hand, and
 * run in Sindri's 6510 on a copy of memory as LOAD leaves it: the files at their load addresses, plain RAM (no ROMs,
 * no I/O, no interrupts). It starts at its `start` label, else at its first byte, and ends at its last RTS (it is
 * called like SYS) or at a BRK. A run starts from the program without what the script's earlier runs changed, and
 * what it changes in the program's bytes is written into the program as the script's patches (Patch.script): the
 * listing, the source, the export and Build & Run have the new bytes, the script's code never. What it leaves in its
 * scratchpads (data kept outside the program, a log, say) is kept with the script.
 * ===================================================================== */
import { Cpu, type Bus } from '@mimir/sindri';
import type { Addr, AnalysisResult, Cartridge, FileInput, LoadedFile, Patch, Project, RenderResult, ScriptPad, Settings, UserScript } from './types';
import { assemble } from './verify/kick-subset-assembler';
import { planPatch, programNames, withoutPatch, withPatch } from './patch';
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

/**
 * Where a script's code (or a scratchpad) goes when the script does not say: free memory (freePlace) and, when the
 * program fills memory, among the program's bytes but not at `avoid` (the program's names the script uses): `near`
 * when it fits there, else the longest run of one byte value (unused memory, most likely), else the first room. The
 * address only names the bytes for the script: they are memory of the script's own (runScript), and the program
 * never sees them. `free`: no file has bytes there. null: there is no room at all.
 */
export function scriptPlace(files: ScriptEnv['files'], size: number, avoid: readonly ScriptRange[] = [], near?: Addr): { at: Addr; free: boolean } | null {
  const f = freePlace(files, size, avoid, near);
  if (f != null) return { at: f, free: true };
  const no = new Uint8Array(0x10000);
  no.fill(1, 0, 0x200);
  for (const r of avoid) no.fill(1, Math.max(0, r.start), Math.min(0x10000, r.end));
  const fits = (a: number) => { if (a < 0x200 || a + size > 0x10000) return false; for (let k = a; k < a + size; k++) if (no[k]) return false; return true; };
  if (near != null && fits(near)) return { at: near, free: false };
  const mem = new Uint8Array(0x10000);
  for (const fl of files) mem.set(fl.bytes.subarray(0, Math.max(0, 0x10000 - fl.load)), fl.load);
  let best: { at: number; len: number } | null = null;
  for (let a = 0x200; a < 0x10000;) {
    if (no[a]) { a++; continue; }
    let e = a; while (e < 0x10000 && !no[e] && mem[e] === mem[a]) e++;
    if (e - a >= size && (!best || e - a > best.len)) best = { at: a, len: e - a };
    a = e;
  }
  if (best) return { at: best.at, free: false };
  for (let a = 0x200; a + size <= 0x10000; a++) if (fits(a)) return { at: a, free: false };
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
 * A new script: a comment that says what happens when it runs, `body` (lines of the listing, say) and the RTS that
 * ends it. No `* =`: Mimir finds a place for its code. No scratchpad: one is added for data kept outside the program.
 */
export function newScript(taken: readonly { name: string }[], body: readonly string[] = [], id = Math.random().toString(36).slice(2, 10)): UserScript {
  const name = scriptName(taken);
  const indent = '        ';
  const lines = body.length ? body.map(l => (/^\S/.test(l) && !/^[!A-Za-z_]\w*:/.test(l) ? indent + l : l)) : [`${indent}// your code here: the program's labels, variables and tables can be used`];
  const source = [
    `// ${name}: runs in Mimir, from its first line to its last RTS. What it changes in the`,
    '// program\'s bytes goes into the program and its .asm; this code itself never does.',
    ...lines,
    `${indent}rts`,
    '',
  ].join('\n');
  return { id, name, lang: 'kickass', source, pads: [] };
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
  /** the addresses its code has (in its own memory) */
  code: ScriptRange[];
  bytes: number;
  /** who chose the code's address: Mimir, in free memory (`free`) or among the program's bytes when it fills memory
   *  (`program`), or the script with its own `* =` (`own`) */
  place: 'free' | 'program' | 'own';
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

/** whether the script's first line of code says where it goes (`* =` or `.pc =`) */
const setsItsPlace = (source: string): boolean => {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').split(/\r?\n/).map(l => l.replace(/\/\/.*$/, '').trim()).find(l => l);
  return !!code && /^(?:\*|\.pc)\s*=/.test(code);
};

/**
 * Assemble the script and check it and its scratchpads: it can run when nothing is an error. Without a `* =` of its
 * own the code goes where scriptPlace finds room, away from the program's names it uses; its code and scratchpads are
 * memory of its own, so the only trouble an address can make is a name of the program that the script uses where
 * its own bytes are (it would read itself there): that is an error on the line that uses the name.
 */
export function checkScript(env: ScriptEnv, script: Pick<UserScript, 'source' | 'pads'>): ScriptCheck {
  const problems: ScriptProblem[] = [];
  const err = (msg: string, line?: number, pad?: number) => problems.push({ level: 'error', msg, ...(line ? { line } : {}), ...(pad != null ? { pad } : {}) });
  // the scratchpads: a name of their own, inside memory, not over each other, not in the zero page or the stack
  const good: ScriptPad[] = [];
  script.pads.forEach((p, i) => {
    if (!PAD_NAME.test(p.name)) err(`Scratchpad "${p.name}": a name is letters, digits and _, not starting with a digit.`, undefined, i);
    else if (script.pads.findIndex(q => q.name === p.name) !== i) err(`There are two scratchpads called "${p.name}".`, undefined, i);
    if (!(Number.isInteger(p.start) && Number.isInteger(p.size) && p.start >= 0 && p.size >= 1 && p.start + p.size <= 0x10000)) { err(`Scratchpad "${p.name}" must lie inside $0000-$ffff and hold a byte at least.`, undefined, i); return; }
    const o = script.pads.findIndex((q, j) => j < i && q.start < p.start + p.size && p.start < q.start + q.size);
    if (o >= 0) err(`Scratchpad "${p.name}" lies over "${script.pads[o].name}".`, undefined, i);
    if (p.start < 0x200) err(`Scratchpad "${p.name}" is in the zero page or the stack ($0000-$01ff), which the script shares with the program: give it an address from $0200.`, undefined, i);
    good.push(p);
  });
  const pads = good.map(p => ({ start: p.start, end: p.start + p.size }));
  const names = scriptNames(env, script.pads);
  const at = (pc: number) => assemble({ 'script.asm': script.source }, 'script.asm', { names, pc });
  // assembled once where it may go, to learn how big it is and which of the program's names it uses
  const free = freePlace(env.files, 0x100, pads);
  let pc = free ?? 0xc000;
  let asm = at(pc);
  const padNames = new Set(script.pads.flatMap(p => [p.name, `${p.name}_end`]));
  const used = [...asm.external].filter(([n]) => !padNames.has(n)).map(([name, line]) => ({ name, line, at: names.get(name)! }));
  let place: ScriptCheck['place'] = 'own';
  if (!setsItsPlace(script.source) && !asm.errors.length) {
    let n = 0; while (pc + n < 0x10000 && asm.written[pc + n]) n++;
    const elsewhere = maskRanges(asm.written).filter(r => r.start !== pc);
    const p = scriptPlace(env.files, Math.max(1, n), [...pads, ...elsewhere, ...used.map(u => ({ start: u.at, end: u.at + 1 }))], free ?? undefined);
    if (!p) err('There is no room for the script\'s code: it uses names all over memory. Give it an address with * = at its top.');
    else { place = p.free ? 'free' : 'program'; if (p.at !== pc) { pc = p.at; asm = at(pc); } }
  }
  for (const e of asm.errors) err(e.msg, e.file === 'script.asm' && e.line > 0 ? e.line : undefined);
  const code = maskRanges(asm.written);
  const bytes = code.reduce((n, r) => n + r.end - r.start, 0);
  const own = asm.symbols.get('start');
  const entry = typeof own === 'number' ? own & 0xffff : asm.first >= 0 ? asm.first : null;
  if (!asm.errors.length) {
    if (entry == null) err('The script has no code to run: write the instructions it runs (it runs from its first line, or from start: when it has one).');
    if (code.some(r => r.start < 0x200)) err('The script\'s code is in the zero page or the stack ($0000-$01ff), which it shares with the program: give it an address from $0200 with * =, or leave * = out and Mimir finds one.');
    for (const u of used) {
      if (asm.written[u.at]) err(`${u.name} ($${h4(u.at)}) is where the script's own code is, so the script would read its own bytes there, not the program's: ${place === 'own' ? 'give the code another address with * =, or leave * = out and Mimir finds one' : 'give it an address with * ='}.`, u.line);
      const pad = script.pads.findIndex(p => u.at >= p.start && u.at < p.start + p.size);
      if (pad >= 0) err(`${u.name} ($${h4(u.at)}) is inside the scratchpad ${script.pads[pad].name}, so the script would read the scratchpad there, not the program: give the scratchpad another address.`, u.line, pad);
    }
  }
  return { ok: !problems.some(p => p.level === 'error'), problems, entry, code, bytes, place, prints: asm.prints, mem: asm.mem, written: asm.written };
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
  /** the program's bytes it changed, nearby changes taken together (not the zero page and the stack) */
  changes: ScriptChange[];
  /** bytes changed that are not the program's, or are its zero page and stack (the CPU's work area): not kept */
  other: number;
  /** the program's memory after the run */
  mem: Uint8Array;
  ms: number;
}

/** instructions a run may take before it is stopped (about 1.5 s; the 6510 runs some 140 million a second) */
export const SCRIPT_LIMIT = 200_000_000;

/** where the RTS that ends the script returns to: the run pushes $ffff, so it lands at $0000 with the stack empty */
const DONE = 0x0000;

/**
 * Run a script that checked ok. Two memories: the program's, as LOAD leaves it, and the script's own, with its code
 * and its scratchpads (filled). The script's code reads and writes its own memory at its own addresses and the
 * program's everywhere else; the program's code (a routine the script calls) only ever sees the program's memory,
 * even at the addresses of the script's code. Whose code runs follows the jumps: a JSR, JMP or branch from the
 * script to an address of its own stays in the script, anything else goes to the program, and an RTS goes back to
 * whoever made the JSR. The zero page and the stack are shared. The 6510 starts at the entry with the stack holding
 * the return address of a SYS, and goes until the script returns, a BRK or JAM, or `limit` instructions.
 */
export function runScript(env: ScriptEnv, script: Pick<UserScript, 'source' | 'pads'>, check: ScriptCheck = checkScript(env, script), limit = SCRIPT_LIMIT): ScriptRun {
  if (!check.ok || check.entry == null) throw new Error(check.problems.find(p => p.level === 'error')?.msg ?? 'The script has no code to run.');
  const t0 = Date.now();
  const mem = new Uint8Array(0x10000), loaded = loadedMask(env.files);
  for (const f of env.files) mem.set(f.bytes.subarray(0, Math.max(0, 0x10000 - f.load)), f.load);
  // the script's own memory, and which addresses are in it
  const own = new Uint8Array(0x10000), mine = new Uint8Array(0x10000);
  for (const p of script.pads) { own.fill((p.fill ?? 0) & 0xff, p.start, p.start + p.size); mine.fill(1, p.start, p.start + p.size); }
  for (let a = 0; a < 0x10000; a++) if (check.written[a]) { own[a] = check.mem[a]; mine[a] = 1; }
  let inScript = !!mine[check.entry];
  const bus: Bus = {
    read: a => (inScript && mine[a] ? own[a] : mem[a]),
    write: (a, v) => { if (inScript && mine[a]) own[a] = v; else mem[a] = v; },
    fetch: a => (inScript && mine[a] ? own[a] : mem[a]),
  };
  const cpu = new Cpu(bus);
  // called like SYS: the return address on the stack, interrupts off
  mem[0x1ff] = (DONE - 1) >> 8 & 0xff; mem[0x1fe] = (DONE - 1) & 0xff; cpu.s = 0xfd; cpu.pc = check.entry; cpu.i = 1;
  const before = mem.slice();
  /** who made each JSR whose return address is on the stack, by the stack pointer before it: the script or not */
  const frames = new Map<number, boolean>();
  let n = 0, cycles = 0, end: ScriptEnd = 'limit', at = cpu.pc;
  while (n < limit) {
    at = cpu.pc;
    const s0 = cpu.s, was = inScript;
    cycles += cpu.step(); n++;
    if (cpu.jammed) { end = 'jam'; break; }
    const op = cpu.lastOp;
    if (op === 0x00) { end = 'brk'; break; }
    if (op === 0x60 && cpu.s === 0xff && cpu.pc === DONE) { end = 'rts'; break; }
    if (op === 0x20) { frames.set(s0, was); inScript = was && !!mine[cpu.pc]; }
    else if (op === 0x60) { const back = frames.get(cpu.s); frames.delete(cpu.s); inScript = back ?? (was && !!mine[cpu.pc]); }
    else if (was) inScript = !!mine[cpu.pc];
  }
  if (end === 'limit') at = cpu.pc;
  // what changed in the program's bytes (not its zero page and stack: the CPU's work area), nearby changes taken
  // together, in one file (the file a byte is in is the last one LOAD put there)
  const file = new Int16Array(0x10000).fill(-1);
  env.files.forEach((f, i) => file.fill(i, f.load, Math.min(0x10000, f.load + f.bytes.length)));
  const changes: ScriptChange[] = [];
  let other = 0;
  const GAP = 8;
  for (let a = 0; a < 0x10000; a++) {
    if (mem[a] === before[a]) continue;
    if (a < 0x200 || !loaded[a]) { other++; continue; }
    const last = changes[changes.length - 1];
    if (last && a - last.end <= GAP && file[last.start] === file[a] && [...Array(a - last.end).keys()].every(k => file[last.end + k] === file[a])) last.end = a + 1;
    else changes.push({ start: a, end: a + 1, bytes: new Uint8Array(0), old: new Uint8Array(0) });
  }
  for (const c of changes) { c.bytes = mem.slice(c.start, c.end); c.old = before.slice(c.start, c.end); }
  return {
    end, at, instructions: n, cycles, regs: { a: cpu.a, x: cpu.x, y: cpu.y, s: cpu.s, p: cpu.p, pc: cpu.pc },
    pads: script.pads.map(p => ({ name: p.name, bytes: own.slice(p.start, p.start + p.size) })),
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

/** The patches that hold what the script `id` changed in the program when it last ran. */
export const scriptPatches = <P extends Pick<Patch, 'script'>>(patches: readonly P[], id: string): P[] => patches.filter(p => p.script === id);

type PatchedProject = Pick<Project, 'files' | 'patches'> & Partial<Pick<Project, 'cart'>>;

/** The project without the script's patches: the program's bytes as they were before its runs changed them. */
export function withoutScriptPatches(project: PatchedProject, id: string): Pick<Project, 'files' | 'patches'> {
  let cur: PatchedProject = project;
  for (const p of scriptPatches(project.patches, id).reverse()) cur = { ...cur, ...withoutPatch(cur, p.id) };
  return { files: cur.files, patches: cur.patches };
}

/** A change of a run that could not be written into the program, and why (it lies in a patch of the user's, say). */
export interface ScriptWriteFailure extends ScriptRange { error: string }

/**
 * Write a run's changes into the program as the script's patches, one a change, named after the script (and the
 * address, when there are several): `project` is the project without the script's earlier patches (the one the
 * run started from). A change at the range of an earlier patch that was switched off is written switched off: the
 * user left it out. A change that cannot be a patch (in a patch of the user's, across a relocated block's edge) is
 * not written and said why.
 */
export function writeScriptRun(A: AnalysisResult, R: Pick<RenderResult, 'labels' | 'zp'>, project: PatchedProject & { settings: Pick<Settings, 'hexCase'> },
  script: Pick<UserScript, 'id' | 'name'>, run: Pick<ScriptRun, 'changes'>, earlier: readonly Pick<Patch, 'start' | 'end' | 'off'>[] = []): { files: Project['files']; patches: Patch[]; written: Patch[]; failed: ScriptWriteFailure[] } {
  let cur: PatchedProject & { settings: Pick<Settings, 'hexCase'> } = project;
  const written: Patch[] = [], failed: ScriptWriteFailure[] = [];
  for (const c of run.changes) {
    const base = run.changes.length === 1 ? script.name : `${script.name}_${h4(c.start)}`;
    let name = base;
    for (let k = 2; cur.patches.some(p => p.name.toLowerCase() === name.toLowerCase()); k++) name = `${base}_${k}`;
    const plan = planPatch(A, R, cur, { name, start: c.start, end: c.end, source: byteLines(c.bytes).join('\n'), fill: 'keep', over: false });
    if ('error' in plan) { failed.push({ start: c.start, end: c.end, error: plan.error }); continue; }
    const off = earlier.some(p => p.off && p.start === c.start && p.end === c.end);
    const patch: Patch = { ...plan.patch, script: script.id, ...(off ? { off: true } : {}) };
    cur = { ...cur, ...withPatch(cur, patch) };
    written.push(patch);
  }
  return { files: cur.files, patches: cur.patches, written, failed };
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
