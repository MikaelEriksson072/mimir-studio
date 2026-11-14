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
import type { Addr, AnalysisResult, Block, BlockKind, Cartridge, FileInput, ListingLine, LoadedFile, MusicInfo, Patch, Project, RenderResult, ScriptInit, ScriptPad, ScriptPadSource, Settings, UserScript } from './types';
import { musicVarName } from './render/kick';
import { monitorChar } from './c64/monitor';
import { assemble } from './verify/kick-subset-assembler';
import { planPatch, programNames, withoutPatch, withPatch } from './patch';
import { fileSpaces } from './spaces';
import { OPC } from './cpu/opcodes';
import { lineText, type LineTextSettings } from './render/lines';
import { PETSCII_CONTROLS } from './c64/text';
import { SYM } from './c64/symbols';
import { findBlock } from './analyze/classify';
import { h2, h4 } from './util/hex';

export interface ScriptRange { start: Addr; end: Addr }

/** What a script runs with: the program's memory as LOAD leaves it and the names the code may use. */
export interface ScriptEnv {
  /** the files at their load addresses, later over earlier (a cartridge's: those of the bank the C64 starts in) */
  files: readonly Pick<LoadedFile, 'load' | 'bytes'>[];
  /** the hardware names and the program's labels and zero-page variables, as the listing names them, and the end of
   *  each block whose start has a label (`tbl_001_end`, the address after it) */
  names: ReadonlyMap<string, Addr>;
  /** the end names among `names`, with their block: `tbl_001_end` → the block tbl_001 starts */
  ends?: ReadonlyMap<string, ScriptRange>;
  /** the names among `names` that are a number, not an address (`music.size`): no memory of the program they name */
  values?: ReadonlySet<string>;
}

/** what of a music LoadSid gives the source: where it is loaded, its init and play routines (addresses) and its length */
export type MusicField = 'location' | 'init' | 'play' | 'size';

/**
 * The music as the source has it when it loads it with LoadSid (`.var music = LoadSid(…)`, `jsr music.play`,
 * `sta music.location+$1ae1,y`): `music.location`, `.init`, `.play` and `.size`, under the .var's name (`music`, or
 * `music_1000` when the program has more than one), so that a line copied from the listing assembles in a script as
 * it is. Given whatever the setting: a script written while it was on still assembles with it off.
 */
export function musicNames(music: readonly Pick<MusicInfo, 'start' | 'end' | 'init' | 'play'>[]): Map<string, { value: number; field: MusicField }> {
  const out = new Map<string, { value: number; field: MusicField }>();
  for (const m of music) {
    const v = musicVarName(m, music.length);
    out.set(`${v}.location`, { value: m.start, field: 'location' });
    out.set(`${v}.init`, { value: m.init, field: 'init' });
    out.set(`${v}.play`, { value: m.play, field: 'play' });
    out.set(`${v}.size`, { value: m.end - m.start, field: 'size' });
  }
  return out;
}

/**
 * The end of each of the program's blocks whose start has a label, by that label and `_end` (`tbl_001_end`): the
 * address after the block, as a scratchpad's `pad1_end` is. Not where the program (or the hardware) has the name
 * already: its own name wins.
 */
export function blockEndNames(R: Pick<RenderResult, 'labels'>, blocks: readonly Pick<Block, 'start' | 'end'>[], taken: ReadonlyMap<string, Addr>): Map<string, ScriptRange> {
  const out = new Map<string, ScriptRange>();
  for (const b of blocks) {
    const l = R.labels.get(b.start);
    if (!l || b.end <= b.start || b.end > 0x10000) continue;
    const n = `${l.name}_end`;
    if (!taken.has(n) && !out.has(n)) out.set(n, { start: b.start, end: b.end });
  }
  return out;
}

/** The env of a project: its files (with the patches that are on) and the names its listing gives, its music's too. */
export function scriptEnv(project: { files: readonly FileInput[]; cart?: Cartridge | null }, R: Pick<RenderResult, 'labels' | 'zp'>, settings: Pick<Settings, 'hexCase'>, blocks: readonly Pick<Block, 'start' | 'end'>[] = [], music: readonly Pick<MusicInfo, 'start' | 'end' | 'init' | 'play'>[] = []): ScriptEnv {
  const l = fileSpaces(project);
  const files = project.files.filter((_, i) => !l || l.spaces[i] === 0).map(f => ({ load: f.load, bytes: f.bytes }));
  const names = programNames(R, settings), ends = blockEndNames(R, blocks, names);
  for (const [n, r] of ends) names.set(n, r.end);
  const values = new Set<string>();
  for (const [n, f] of musicNames(music)) { names.set(n, f.value); if (f.field === 'size') values.add(n); }
  return { files, names, ...(ends.size ? { ends } : {}), ...(values.size ? { values } : {}) };
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
  /** the zero-page byte of the script's init it is about (its index in ScriptInit.zp) */
  zp?: number;
}

/** the status register a run starts with when the script's init does not say: I set (no interrupts come in a run in
 *  any case), the other flags clear; bits 5 and 4 (- and B) are not flags a program can set */
export const SCRIPT_P = 0x24;
/** the flags of the status register, as the debugger and Init show them: name, bit and what it is */
export const SCRIPT_FLAGS = [
  { name: 'N', bit: 0x80, what: 'Negative' }, { name: 'V', bit: 0x40, what: 'Overflow' }, { name: 'D', bit: 0x08, what: 'Decimal mode' },
  { name: 'I', bit: 0x04, what: 'Interrupt disable' }, { name: 'Z', bit: 0x02, what: 'Zero' }, { name: 'C', bit: 0x01, what: 'Carry' },
] as const;

/** Whether an init sets nothing: the run starts as without one (A, X and Y 0, only I set, the zero page as it is). */
export function initEmpty(init?: ScriptInit | null): boolean {
  return !init || (!init.a && !init.x && !init.y && ((init.p ?? SCRIPT_P) & 0xcf) === (SCRIPT_P & 0xcf) && !init.zp?.length);
}

/** An init as it is kept: without what is as without one (null: nothing at all). */
export function tidyInit(init: ScriptInit): ScriptInit | null {
  if (initEmpty(init)) return null;
  const p = init.p == null ? undefined : (init.p & 0xcf) | 0x20;
  return {
    ...(init.a ? { a: init.a } : {}), ...(init.x ? { x: init.x } : {}), ...(init.y ? { y: init.y } : {}),
    ...(p != null && (p & 0xcf) !== (SCRIPT_P & 0xcf) ? { p } : {}),
    ...(init.zp?.length ? { zp: init.zp.map(z => ({ at: z.at, value: z.value, ...(z.word ? { word: true } : {}) })) } : {}),
  };
}

/** what is wrong with a script's init: a register or flag byte that is not a byte, a zero-page entry outside the zero
 *  page or with too big a value (errors), a zero-page byte set twice (a warning: the later one wins) */
function checkInit(init: ScriptInit | undefined, problems: ScriptProblem[]): void {
  if (!init) return;
  const isByte = (v: number) => Number.isInteger(v) && v >= 0 && v <= 0xff;
  for (const [k, v] of [['A', init.a], ['X', init.x], ['Y', init.y], ['The status register', init.p]] as const)
    if (v != null && !isByte(v)) problems.push({ level: 'error', msg: `Init: ${k} must be a byte ($00-$ff).` });
  const by = new Map<number, number>();
  (init.zp ?? []).forEach((z, i) => {
    const n = z.word ? 2 : 1;
    if (!(Number.isInteger(z.at) && z.at >= 0 && z.at + n <= 0x100)) {
      problems.push({ level: 'error', zp: i, msg: `Init: $${h4(Number(z.at) & 0xffff)} is not in the zero page: ${z.word ? 'a word goes at $00-$fe' : 'a byte goes at $00-$ff'}.` });
      return;
    }
    if (!(Number.isInteger(z.value) && z.value >= 0 && z.value <= (z.word ? 0xffff : 0xff)))
      problems.push({ level: 'error', zp: i, msg: `Init: the value for $${h2(z.at)} must be ${z.word ? 'a word ($0000-$ffff)' : 'a byte ($00-$ff); a word takes two'}.` });
    for (let k = 0; k < n; k++) {
      if (by.has(z.at + k)) problems.push({ level: 'warning', zp: i, msg: `Init: $${h2(z.at + k)} is set twice; the later one wins.` });
      by.set(z.at + k, i);
    }
  });
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
  /** the line of the code each byte comes from (0: none), and where each line's bytes start (a debugger's line) */
  lines: Int32Array;
  starts: Uint8Array;
  /** the script's own labels at its own addresses (its code and data), by address: the first one at each */
  labels: Map<Addr, string>;
  /** the program's names the code uses (not its scratchpads'): each with the line it is first used on and its address */
  uses: { name: string; line: number; at: Addr }[];
  /** where its instructions start (not its data) */
  ops: Uint8Array;
  /** the program's memory its instructions read and write at an address (not the script's own): Mimir places the
   *  code and finds room for scratchpads away from it */
  access: ScriptAccess[];
}

const PAD_NAME = /^[A-Za-z_]\w*$/;

/** the names a script's code may use: the program's, the hardware's and its scratchpads' (`pad`, `pad_end`) */
export function scriptNames(env: ScriptEnv, pads: readonly ScriptPad[]): Map<string, Addr> {
  const out = new Map(env.names);
  for (const p of pads) if (PAD_NAME.test(p.name)) { out.set(p.name, p.start); out.set(`${p.name}_end`, p.start + p.size); }
  return out;
}

/**
 * Mimir's own names end in their address (`colors_0939`, `ptr_fb`). One that the script uses and the program no longer
 * has, because the analysis named the bytes anew after a run changed them (`colors_0939` is `tbl_0939` once the table
 * holds more than colours), still finds its address, when the program has a name there: a script does not stop
 * assembling because of what its own run did.
 */
export function withAddressNames(names: Map<string, Addr>, source: string): Map<string, Addr> {
  const named = new Set(names.values());
  for (const m of source.matchAll(/\b([A-Za-z_][A-Za-z0-9]*_([0-9a-fA-F]{4}|[0-9a-fA-F]{2}))\b/g)) {
    if (names.has(m[1])) continue;
    const a = parseInt(m[2], 16);
    if (named.has(a)) names.set(m[1], a);
  }
  return names;
}

/**
 * Memory an instruction of the script reads or writes as the program's: its operand is an address (`$0400`, a name of
 * the program, a constant), not one of the script's own labels (`name:`, a `!` label, `*`). An indexed one (`,x`
 * `,y`) may reach 255 bytes on. `text` is its line without the comment.
 */
export interface ScriptAccess extends ScriptRange { line: number; write: boolean; text: string }

/** a line of code without its comment and its strings, and without the label it starts with */
export const codeOf = (line: string) => line.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '').replace(/"(?:[^"\\]|\\.)*"/g, '""')
  .replace(/^\s*(?:[A-Za-z_][\w.]*|![A-Za-z_]\w*|!)\s*:/, '').trim();

/** The script's instructions that read or write the program's memory at an address (not by a pointer: (zp),y and
 *  (zp,x) can go anywhere), from its assembled bytes and its lines. */
function programAccesses(asm: { mem: Uint8Array; ops: Uint8Array; lines: Int32Array }, source: string): ScriptAccess[] {
  const src = source.split(/\r?\n/);
  // the script's own labels: where its code and data are (an operand naming one is the script's own memory)
  const own = new Set([...source.matchAll(/^\s*([A-Za-z_]\w*)\s*:/gm)].map(m => m[1]));
  const ownRef = (text: string) => /![A-Za-z_+-]|(^|[\s(,#<>+\-*/])\*(?=\s*(?:[+\-),]|$))/.test(text) || [...text.matchAll(/[A-Za-z_]\w*/g)].some(m => own.has(m[0]));
  const out: ScriptAccess[] = [];
  for (let a = 0; a < 0x10000; a++) {
    if (!asm.ops[a]) continue;
    const o = OPC[asm.mem[a]];
    const reach = o.mode === 'abs' ? 1 : o.mode === 'abx' || o.mode === 'aby' ? 256 : o.mode === 'ind' ? 2 : 0;
    if (!reach || (!o.access && o.mode !== 'ind')) continue;
    const line = asm.lines[a], text = codeOf(src[line - 1] ?? '');
    if (ownRef(text.replace(/^\S+/, ''))) continue;
    const v = asm.mem[(a + 1) & 0xffff] | asm.mem[(a + 2) & 0xffff] << 8;
    out.push({ start: v, end: Math.min(0x10000, v + reach), line, write: o.access === 'write' || o.access === 'rmw', text });
  }
  return out;
}

/** whether a line of code names a scratchpad (or the address after it) */
const namesPad = (text: string, pad: ScriptPad) => new RegExp(`(^|[^\\w.])(${pad.name}|${pad.name}_end)(?!\\w)`).test(text);

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
export function checkScript(env: ScriptEnv, script: Pick<UserScript, 'source' | 'pads' | 'init'>): ScriptCheck {
  const problems: ScriptProblem[] = [];
  checkInit(script.init, problems);
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
    if (p.data && p.data.length > p.size) problems.push({ level: 'warning', pad: i, msg: `Scratchpad "${p.name}" starts with ${p.data.length} bytes but holds ${p.size}: a run starts it with the first ${p.size}.` });
    good.push(p);
  });
  const pads = good.map(p => ({ start: p.start, end: p.start + p.size }));
  const names = withAddressNames(scriptNames(env, script.pads), script.source);
  const at = (pc: number) => assemble({ 'script.asm': script.source }, 'script.asm', { names, pc });
  // assembled once where it may go, to learn how big it is and which of the program's names it uses
  const free = freePlace(env.files, 0x100, pads);
  let pc = free ?? 0xc000;
  let asm = at(pc);
  const padNames = new Set(script.pads.flatMap(p => [p.name, `${p.name}_end`]));
  const used = [...asm.external].filter(([n]) => !padNames.has(n) && !env.values?.has(n)).map(([name, line]) => ({ name, line, at: names.get(name)! }));
  let place: ScriptCheck['place'] = 'own';
  if (!setsItsPlace(script.source) && !asm.errors.length) {
    let n = 0; while (pc + n < 0x10000 && asm.written[pc + n]) n++;
    const elsewhere = maskRanges(asm.written).filter(r => r.start !== pc);
    // not where the code reads or writes the program's memory (`sta $0400,x` over the code would change the code)
    const reached = programAccesses(asm, script.source);
    const p = scriptPlace(env.files, Math.max(1, n), [...pads, ...elsewhere, ...used.map(u => ({ start: u.at, end: u.at + 1 })), ...reached], free ?? undefined);
    if (!p) err('There is no room for the script\'s code: it uses the program\'s memory all over. Give it an address with * = at its top.');
    else { place = p.free ? 'free' : 'program'; if (p.at !== pc) { pc = p.at; asm = at(pc); } }
  }
  // (a line that names a scratchpad and reaches into it means the scratchpad)
  const access = programAccesses(asm, script.source).filter(x => !good.some(p => p.start < x.end && x.start < p.start + p.size && namesPad(x.text, p)));
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
    // an address the code reads or writes as the program's where the script's own code or a scratchpad is: the
    // access would go to the script's own memory there (`sta $0400,x` over the code changes the code, and the loop
    // stops after a few rounds)
    for (const x of access) {
      if (problems.some(p => p.level === 'error' && p.line === x.line)) continue;
      const span = rangeText(x), verb = x.write ? 'writes' : 'reads';
      const over = maskRanges(asm.written, x.start, x.end);
      if (over.length) {
        err(`"${x.text}" ${verb} ${span} of the program, but the script's own code is at ${over.map(rangeText).join(', ')}: it would ${x.write ? 'write over its own code' : 'read its own code'} there, not the program. ${place === 'own' ? 'Give the code another address with * =, or leave * = out and Mimir finds room.' : 'There is no other room for the code: give it an address with * = at its top.'}`, x.line);
        continue;
      }
      const pad = script.pads.findIndex(p => p.start < x.end && x.start < p.start + p.size && !namesPad(x.text, p));
      if (pad >= 0) err(`"${x.text}" ${verb} ${span} of the program, but the scratchpad ${script.pads[pad].name} is at ${rangeText({ start: script.pads[pad].start, end: script.pads[pad].start + script.pads[pad].size })}: it would ${x.write ? 'write' : 'read'} the scratchpad there, not the program. Give the scratchpad another address (or write ${script.pads[pad].name} when the scratchpad is meant).`, x.line, pad);
    }
  }
  const labels = new Map<Addr, string>();
  for (const [k, v] of asm.symbols) if (typeof v === 'number' && /^[A-Za-z_]\w*$/.test(k) && v >= 0 && v < 0x10000 && asm.written[v] && !labels.has(v)) labels.set(v, k);
  return { ok: !problems.some(p => p.level === 'error'), problems, entry, code, bytes, place, prints: asm.prints, mem: asm.mem, written: asm.written, lines: asm.lines, starts: asm.starts, ops: asm.ops, labels, uses: used, access };
}

/** An address of the program linked to a script (UserScript.links), with the name its code writes for it and what that
 *  name is: a label, the label before it in its block and how far on (`table+5`), a zero-page variable, a hardware
 *  register, else the address itself. */
export interface ScriptLink { at: Addr; name: string; what: 'label' | 'variable' | 'hardware' | 'address' }

/** The name a script's code writes for an address of the program (a link's): as the listing names it. */
export function linkName(R: Pick<RenderResult, 'labels' | 'zp'>, A: Pick<AnalysisResult, 'blocks'>, at: Addr): ScriptLink {
  const l = R.labels.get(at);
  if (l) return { at, name: l.name, what: 'label' };
  const z = at < 0x100 ? R.zp.get(at) : undefined;
  if (z) return { at, name: z.off ? `${z.name}+${z.off}` : z.name, what: 'variable' };
  const hw = SYM.exact.get(at);
  if (hw && !hw.name.includes('+')) return { at, name: hw.name, what: 'hardware' };
  // inside a block: the label before it there (a byte of a table)
  const b = findBlock(A.blocks, at);
  if (b) for (let p = at - 1; p >= b.start && at - p < 0x1000; p--) { const q = R.labels.get(p); if (q) return { at, name: `${q.name}+${at - p}`, what: 'label' }; }
  return { at, name: '$' + h4(at), what: 'address' };
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
  /** the script's own memory after the run (its code and data, its scratchpads), at its own addresses: what the watch
   *  list reads there */
  own: Uint8Array;
  ms: number;
  /** the script's own code it wrote over while it ran (code that changes itself, or an address it writes that lies
   *  where its code is): by line of the code, its first address written and how many writes */
  overCode?: { at: Addr; line: number; times: number }[];
}

/** instructions a run may take before it is stopped (about 2.5 s; a run goes some 80 million a second) */
export const SCRIPT_LIMIT = 200_000_000;

/** where the RTS that ends the script returns to: the run pushes $ffff, so it lands at $0000 with the stack empty */
const DONE = 0x0000;

/**
 * Memory as a script's run has it: the program's (`mem`) and the script's own (`own`, at the addresses `mine` marks:
 * its code and data and its scratchpads), and which of its own bytes are its instructions (`code`). A ScriptMachine is
 * one; scriptStartMemory makes one as a run starts.
 */
export interface ScriptMemory { mem: Uint8Array; own: Uint8Array; mine: Uint8Array; code: Uint8Array }

/**
 * The memory a run of the script starts with (as ScriptMachine sets it up): the files at their load addresses, the
 * return of the SYS on the stack, the zero-page bytes of its init; its scratchpads as they start and its assembled
 * bytes as its own memory. Also for a script that does not check out (what it assembled is its own memory then).
 * `into`: fill these arrays (they start empty) instead of new ones.
 */
export function scriptStartMemory(env: ScriptEnv, script: Pick<UserScript, 'pads' | 'init'>, check: Pick<ScriptCheck, 'mem' | 'written' | 'ops'>, into?: ScriptMemory): ScriptMemory {
  const m = into ?? { mem: new Uint8Array(0x10000), own: new Uint8Array(0x10000), mine: new Uint8Array(0x10000), code: new Uint8Array(0x10000) };
  const { mem, own, mine, code } = m;
  for (const f of env.files) mem.set(f.bytes.subarray(0, Math.max(0, 0x10000 - f.load)), f.load);
  // each scratchpad as a run starts it: its start content, the rest its fill
  for (const p of script.pads) {
    if (!(p.start >= 0 && p.size >= 1 && p.start + p.size <= 0x10000)) continue;
    own.set(padStart(p), p.start); mine.fill(1, p.start, p.start + p.size);
  }
  for (let a = 0; a < 0x10000; a++) if (check.written[a]) { own[a] = check.mem[a]; mine[a] = 1; }
  // its instructions' bytes (not its data): a write there changes its code
  for (let a = 0; a < 0x10000; a++) if (check.ops[a]) code.fill(1, a, Math.min(0x10000, a + OPC[check.mem[a]].len));
  // called like SYS: the return address on the stack; the init's zero page in place before the run (no change of it)
  mem[0x1ff] = (DONE - 1) >> 8 & 0xff; mem[0x1fe] = (DONE - 1) & 0xff;
  for (const z of script.init?.zp ?? []) { mem[z.at & 0xff] = z.value & 0xff; if (z.word) mem[(z.at + 1) & 0xff] = (z.value >> 8) & 0xff; }
  return m;
}

/** A byte of the stack, from the top ($01ff) down to the stack pointer: a return address a JSR (or the start of the
 *  run, called like SYS) put there is said, with who made the JSR and where it goes back to. */
export interface StackEntry {
  addr: Addr;
  value: number;
  /** the high byte of a return address (the low byte is the entry after it): where an RTS goes and who it goes to */
  ret?: { to: Addr; by: 'start' | 'script' | 'program' };
  /** the low byte of a return address */
  low?: boolean;
}

/**
 * A script's run as a machine that goes an instruction at a time (spec 10.3, the debugger), or on until something
 * holds. Two memories: the program's, as LOAD leaves it, and the script's own, with its code and its scratchpads
 * (filled). The script's code reads and writes its own memory at its own addresses and the program's everywhere else;
 * the program's code (a routine the script calls) only ever sees the program's memory, even at the addresses of the
 * script's code. Whose code runs follows the jumps: a JSR, JMP or branch from the script to an address of its own
 * stays in the script, anything else goes to the program, and an RTS goes back to whoever made the JSR. The zero page
 * and the stack are shared. The 6510 starts at the entry with the stack holding the return address of a SYS, and goes
 * until the script returns, a BRK or JAM, or `limit` instructions.
 */
/** The bus of a script's run: the script's own memory where its code reads and writes its own addresses, the program's
 *  memory everywhere else. A pointer ((zp),y or (zp,x)) of the script's that points where its own instructions are
 *  means the program's memory there: the script's code went where Mimir found room, and a pointer to the program's
 *  bytes (a decryption's source or destination, set from `.var`s) may point there. A class, so that every run's bus has
 *  the same methods and the CPU's calls stay fast. */
class ScriptBus implements Bus {
  constructor(private readonly mem: Uint8Array, private readonly own: Uint8Array, private readonly mine: Uint8Array, private readonly ctx: { script: boolean; at: number },
    /** the script's code bytes, and how many times the script wrote over each (a check: code that changes itself) */
    private readonly code: Uint8Array, readonly overCode: Uint32Array) { }
  /** the instruction running (the script's, at ctx.at) reaches memory through a pointer */
  private viaPointer(): boolean { const m = OPC[this.own[this.ctx.at]].mode; return m === 'izy' || m === 'izx'; }
  read(a: number): number { return this.ctx.script && this.mine[a] && !(this.code[a] && this.viaPointer()) ? this.own[a] : this.mem[a]; }
  write(a: number, v: number): void {
    if (this.ctx.script && this.mine[a] && !(this.code[a] && this.viaPointer())) { this.own[a] = v; if (this.code[a]) this.overCode[a]++; } else this.mem[a] = v;
  }
  fetch(a: number): number { return this.ctx.script && this.mine[a] ? this.own[a] : this.mem[a]; }
}

export class ScriptMachine implements ScriptMemory {
  readonly cpu: Cpu;
  /** the program's memory, and the script's own (and which addresses are the script's) */
  readonly mem = new Uint8Array(0x10000);
  readonly own = new Uint8Array(0x10000);
  readonly mine = new Uint8Array(0x10000);
  /** the script's instructions' bytes (not its data): a write there changes its code */
  readonly code = new Uint8Array(0x10000);
  /** whether the code running is the script's */
  // (kept in an object of its own: the bus reads it at every byte)
  // (and the address of the instruction running, for a pointer's: ScriptBus)
  private readonly ctx = { script: false, at: 0 };
  get inScript(): boolean { return this.ctx.script; }
  set inScript(v: boolean) { this.ctx.script = v; }
  instructions = 0;
  cycles = 0;
  /** how it ended (null: it goes on) */
  end: ScriptEnd | null = null;
  /** the address of the instruction run last */
  at: Addr;
  private readonly before: Uint8Array;
  private readonly loaded: Uint8Array;
  /** who made each JSR whose return address is on the stack, by the stack pointer before it: the script or not */
  private readonly frames = new Map<number, boolean>();
  private readonly t0 = Date.now();
  /** how many times the script wrote over each byte of its own code */
  readonly overCode = new Uint32Array(0x10000);

  constructor(readonly env: ScriptEnv, readonly script: Pick<UserScript, 'source' | 'pads' | 'init'>, readonly check: ScriptCheck = checkScript(env, script), readonly limit = SCRIPT_LIMIT) {
    if (!check.ok || check.entry == null) throw new Error(check.problems.find(p => p.level === 'error')?.msg ?? 'The script has no code to run.');
    const { mem, own, mine, ctx } = this;
    this.loaded = loadedMask(env.files);
    // the files, the scratchpads, the script's code, the SYS return on the stack and the init's zero page
    scriptStartMemory(env, script, check, this);
    this.inScript = !!mine[check.entry];
    const bus = new ScriptBus(mem, own, mine, ctx, this.code, this.overCode);
    const cpu = this.cpu = new Cpu(bus);
    // called like SYS (the stack holds its return); the registers and the flags the script's init gives (else A, X
    // and Y 0 and interrupts off)
    cpu.s = 0xfd; cpu.pc = check.entry;
    const init = script.init;
    cpu.a = (init?.a ?? 0) & 0xff; cpu.x = (init?.x ?? 0) & 0xff; cpu.y = (init?.y ?? 0) & 0xff; cpu.p = (init?.p ?? SCRIPT_P) & 0xff;
    this.at = cpu.pc;
    this.before = mem.slice();
  }

  /** Run one instruction; false once the run has ended. */
  step(): boolean {
    if (this.end) return false;
    if (this.instructions >= this.limit) { this.end = 'limit'; this.at = this.cpu.pc; return false; }
    const cpu = this.cpu, mine = this.mine;
    this.at = this.ctx.at = cpu.pc;
    const s0 = cpu.s, was = this.inScript;
    this.cycles += cpu.step(); this.instructions++;
    if (cpu.jammed) { this.end = 'jam'; return false; }
    const op = cpu.lastOp;
    if (op === 0x00) { this.end = 'brk'; return false; }
    if (op === 0x60 && cpu.s === 0xff && cpu.pc === DONE) { this.end = 'rts'; return false; }
    if (op === 0x20) { this.frames.set(s0, was); this.inScript = was && !!mine[cpu.pc]; }
    else if (op === 0x60) { const back = this.frames.get(cpu.s); this.frames.delete(cpu.s); this.inScript = back ?? (was && !!mine[cpu.pc]); }
    else if (was) this.inScript = !!mine[cpu.pc];
    return true;
  }

  /**
   * Run on until `stop` holds after an instruction, the run ends, or `max` instructions have run: 'stopped', 'ended'
   * or 'more' (call again to go on).
   */
  runUntil(stop: ((m: ScriptMachine) => boolean) | null, max = Infinity): 'stopped' | 'ended' | 'more' {
    if (stop) {
      for (let n = 0; n < max; n++) {
        if (!this.step()) return 'ended';
        if (stop(this)) return 'stopped';
      }
      return this.end ? 'ended' : 'more';
    }
    // nothing to stop at: step()'s work in a loop of its own, the hot fields in locals (twice as fast)
    if (this.end) return 'ended';
    const cpu = this.cpu, mine = this.mine, frames = this.frames, ctx = this.ctx;
    const until = Math.min(this.limit, this.instructions + max);
    let n = this.instructions, cycles = this.cycles, end: ScriptEnd | null = null, at = this.at;
    while (n < until) {
      at = ctx.at = cpu.pc;
      const s0 = cpu.s, was = ctx.script;
      cycles += cpu.step(); n++;
      if (cpu.jammed) { end = 'jam'; break; }
      const op = cpu.lastOp;
      if (op === 0x00) { end = 'brk'; break; }
      if (op === 0x60) {
        if (cpu.s === 0xff && cpu.pc === DONE) { end = 'rts'; break; }
        const back = frames.get(cpu.s); frames.delete(cpu.s); ctx.script = back ?? (was && !!mine[cpu.pc]);
      } else if (op === 0x20) { frames.set(s0, was); ctx.script = was && !!mine[cpu.pc]; }
      else if (was) ctx.script = !!mine[cpu.pc];
    }
    this.instructions = n; this.cycles = cycles; this.at = at;
    if (end) { this.end = end; return 'ended'; }
    if (n >= this.limit) { this.end = 'limit'; this.at = cpu.pc; return 'ended'; }
    return 'more';
  }

  /** a byte as the code running now sees it (or as the script's code or the program's does) */
  peek(a: Addr, script = this.inScript): number { return script && this.mine[a & 0xffff] ? this.own[a & 0xffff] : this.mem[a & 0xffff]; }

  /** the line of the script's code at `pc` (null: not the script's code, or no line) */
  lineAt(pc: Addr = this.cpu.pc): number | null { return this.mine[pc] && this.check.lines[pc] ? this.check.lines[pc] : null; }

  /** the line of the script's JSR the program's code is running for (the innermost), when the program's code runs */
  callLine(): number | null {
    if (this.inScript) return null;
    for (let s = this.cpu.s + 1; s < 0xff; s++) if (this.frames.get(s) === true) {
      const back = ((this.mem[0x100 + s] << 8) | this.mem[0x100 + s - 1]) + 1;
      return this.lineAt((back - 3) & 0xffff);
    }
    return null;
  }

  /** the stack from its top ($01ff) down to the stack pointer, with the return addresses said */
  stack(): StackEntry[] {
    const out: StackEntry[] = [];
    for (let s = 0xff; s > this.cpu.s; s--) {
      const value = this.mem[0x100 + s];
      const by = s === 0xff ? 'start' : this.frames.has(s) ? (this.frames.get(s) ? 'script' : 'program') : null;
      if (by && s - 1 > this.cpu.s) {
        out.push({ addr: 0x100 + s, value, ret: { to: (((value << 8) | this.mem[0x100 + s - 1]) + 1) & 0xffff, by } });
        out.push({ addr: 0x100 + s - 1, value: this.mem[0x100 + s - 1], low: true });
        s--;
      } else out.push({ addr: 0x100 + s, value });
    }
    return out;
  }

  /** the run as it stands (once it has ended: its result): what it changed in the program, what its pads hold */
  result(): ScriptRun {
    const { mem, before, loaded, cpu, env } = this;
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
    // the script's own code it wrote over, by line (the first address and how many writes)
    const overCode: ScriptRun['overCode'] = [];
    for (let a = 0; a < 0x10000; a++) {
      if (!this.overCode[a]) continue;
      const line = this.check.lines[a], o = overCode.find(x => x.line === line);
      if (o) o.times += this.overCode[a]; else overCode.push({ at: a, line, times: this.overCode[a] });
    }
    return {
      end: this.end ?? 'limit', at: this.end ? this.at : cpu.pc, instructions: this.instructions, cycles: this.cycles,
      regs: { a: cpu.a, x: cpu.x, y: cpu.y, s: cpu.s, p: cpu.p, pc: cpu.pc },
      pads: this.script.pads.map(p => ({ name: p.name, bytes: this.own.slice(p.start, p.start + p.size) })),
      changes, other, mem, own: this.own, ms: Date.now() - this.t0, ...(overCode.length ? { overCode } : {}),
    };
  }
}

/** Run a script that checked ok to its end (ScriptMachine), in one go. */
export function runScript(env: ScriptEnv, script: Pick<UserScript, 'source' | 'pads' | 'init'>, check: ScriptCheck = checkScript(env, script), limit = SCRIPT_LIMIT): ScriptRun {
  const m = new ScriptMachine(env, script, check, limit);
  m.runUntil(null);
  return m.result();
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

/* ---- scratchpads: what one holds when a run starts, written as Kick Assembler, hex or text, and two compared ---- */

/** The bytes a scratchpad holds when a run starts: its start content (`data`) from its start, the rest its fill. */
export function padStart(p: Pick<ScriptPad, 'size' | 'fill' | 'data'>): Uint8Array {
  const b = new Uint8Array(p.size).fill((p.fill ?? 0) & 0xff);
  if (p.data) b.set(p.data.subarray(0, p.size));
  return b;
}

/** What a scratchpad holds now: what the last run left in it, else what a run starts it with. */
export const padNow = (p: Pick<ScriptPad, 'size' | 'fill' | 'data' | 'bytes'>): Uint8Array =>
  p.bytes && p.bytes.length === p.size ? p.bytes : padStart(p);

/** PETSCII or screen code of each character the C64 shows (the first byte that shows it); lower case letters are read
 *  as the upper case ones the C64 shows */
const charCodes = (screen: boolean): Map<string, number> => {
  const m = new Map<string, number>();
  for (let b = 0; b < (screen ? 0x80 : 0x100); b++) { const c = monitorChar(b, screen)?.ch; if (c != null && !m.has(c)) m.set(c, b); }
  return m;
};
const CODES = { petscii: charCodes(false), screen: charCodes(true) };

/** What is wrong with a scratchpad's start content as written: the message and the line of the text */
export interface PadDataError { error: string; line?: number }

/**
 * A scratchpad's start content from what the user wrote (ScriptPad.src), for a scratchpad at `at` of `size` bytes:
 * Kick Assembler assembled at `at` with `names` at hand (code and every kind of data: `.byte`, `.word`, `.text`,
 * `.fill`, instructions, labels of its own), hex bytes (`01 02 ff`, `$01,$02`, `0102ff`; a line that starts with an
 * address, as a hex dump does, puts its bytes there, and the text after two spaces is left out), or text, a byte a character: PETSCII
 * with a line end as RETURN ($0d), or screen codes with a line end as spaces to the next row of 40. What it does not
 * write from its first byte to its last is `fill`.
 */
export function padData(src: ScriptPadSource, at: Addr, size: number, names: ReadonlyMap<string, Addr>, fill = 0): { bytes: Uint8Array } | PadDataError {
  const tooBig = (n: number): PadDataError => ({ error: `It is ${n} bytes, and the scratchpad holds ${size}: make the scratchpad bigger, or write less.` });
  if (src.form === 'asm') {
    if (!src.text.trim()) return { bytes: new Uint8Array(0) };
    const asm = assemble({ 'pad.asm': src.text }, 'pad.asm', { names, pc: at });
    const e = asm.errors[0];
    if (e) return { error: e.msg, ...(e.file === 'pad.asm' && e.line > 0 ? { line: e.line } : {}) };
    let lo = -1, hi = -1;
    for (let a = 0; a < 0x10000; a++) if (asm.written[a]) { if (lo < 0) lo = a; hi = a; }
    if (lo < 0) return { bytes: new Uint8Array(0) };
    if (lo < at) return { error: `It writes $${h4(lo)}, before the scratchpad's start $${h4(at)}: leave * = out, or set it inside the scratchpad.` };
    if (hi + 1 - at > size) return tooBig(hi + 1 - at);
    const out = new Uint8Array(hi + 1 - at).fill(fill & 0xff);
    for (let a = at; a <= hi; a++) if (asm.written[a]) out[a - at] = asm.mem[a];
    return { bytes: out };
  }
  const lines = src.text.split(/\r?\n/);
  const out: number[] = [];
  if (src.form === 'hex') {
    // where the next byte goes: on from the last line, or where a hex dump's line says
    let pos = 0, hi = 0;
    const put = (b: number) => { out[pos++] = b; hi = Math.max(hi, pos); };
    for (let i = 0; i < lines.length; i++) {
      let l = lines[i].replace(/\/\/.*$/, '').replace(/;.*$/, '');
      // a hex dump's line: its address first (its bytes go there), its text after two spaces
      const dump = /^\s*\$?([0-9a-f]{4})(?::\s*|\s{2,})/i.exec(l);
      if (dump) {
        const a = parseInt(dump[1], 16);
        if (a < at || a >= at + size) return { error: `$${h4(a)} is outside the scratchpad ($${h4(at)}-$${h4(at + size - 1)}).`, line: i + 1 };
        pos = a - at;
        l = l.slice(dump[0].length); const t = /\S\s{2,}/.exec(l); if (t) l = l.slice(0, t.index + 1);
      }
      for (const tok of l.split(/[\s,]+/).filter(Boolean)) {
        const h = tok.replace(/^(\$|0x)/i, '');
        if (!/^[0-9a-f]+$/i.test(h) || (h.length > 2 && h.length % 2)) return { error: `"${tok}" is not a hex byte (write 01, $01 or 0102).`, line: i + 1 };
        if (h.length <= 2) put(parseInt(h, 16));
        else for (let k = 0; k < h.length; k += 2) put(parseInt(h.slice(k, k + 2), 16));
      }
    }
    // what no line wrote, between bytes that were: the fill
    out.length = hi;
    for (let k = 0; k < hi; k++) if (out[k] === undefined) out[k] = fill & 0xff;
  } else {
    const codes = src.screen ? CODES.screen : CODES.petscii;
    for (let i = 0; i < lines.length; i++) {
      if (i > 0) {
        // screen codes: the line before ends with spaces to the end of its row of 40 (an empty line is a row of them)
        if (src.screen) { let n = (40 - (out.length % 40)) % 40; if (!n && !lines[i - 1].length) n = 40; for (let k = 0; k < n; k++) out.push(0x20); }
        else out.push(0x0d);
      }
      for (const c of lines[i]) {
        const b = codes.get(c) ?? codes.get(c.toUpperCase());
        if (b == null) return { error: `"${c}" is not a character the C64 has in ${src.screen ? 'its screen codes' : 'PETSCII'}.`, line: i + 1 };
        out.push(b);
      }
    }
  }
  if (out.length > size) return tooBig(out.length);
  return { bytes: Uint8Array.from(out) };
}

/** A scratchpad's bytes written in a form (what the editor shows for them when the user has not written them in it):
 *  `.byte` lines, a hex dump with the addresses, or the text (a byte with no character as `.`). */
export function padText(bytes: Uint8Array, form: ScriptPadSource['form'], at: Addr, screen = false): string {
  if (!bytes.length) return '';
  if (form === 'asm') return byteLines(bytes, 16, '').join('\n');
  if (form === 'hex') {
    const rows: string[] = [];
    for (let i = 0; i < bytes.length; i += 16) rows.push(`$${h4(at + i)}  ${Array.from(bytes.subarray(i, i + 16), b => h2(b)).join(' ')}`);
    return rows.join('\n');
  }
  const ch = (b: number) => monitorChar(b, screen)?.ch ?? '.';
  if (screen) {
    const rows: string[] = [];
    for (let i = 0; i < bytes.length; i += 40) rows.push(Array.from(bytes.subarray(i, i + 40), ch).join('').replace(/ +$/, ''));
    return rows.join('\n');
  }
  let s = '';
  for (const b of bytes) s += b === 0x0d ? '\n' : ch(b);
  return s;
}

/** A block of the program as a scratchpad's start content: its bytes, and what they are written as (`src`), with
 *  `what` saying how (*code*, *text*, *characters, 8 bytes a line*, …). */
export interface BlockPad { bytes: Uint8Array; src: ScriptPadSource; what: string }

/** what a block of each type becomes in a scratchpad (blockPad); the other types: hex */
export const BLOCK_PAD_FORM: Readonly<Partial<Record<BlockKind, string>>> = {
  code: 'code', text: 'text', charset: '.byte, 8 a line', sprite: '.byte, 3 a line', bitmap: '.byte, 8 a line', screen: '.byte, 40 a line',
};

/** a line of a block as the listing writes it, and where its bytes are (none for a comment or a label) */
interface CodeLine { text: string; a?: Addr; n?: number }

/** The block's lines as the listing writes them, with the program's names kept: its own label lines as comments (so
 *  the names stay the program's, and the bytes the same), a branch as `*±n` from where it is (so it branches the same
 *  way at any address); lines of no bytes (.pc, .pseudopc) left out, but a text's `.encoding` kept. */
function listingLines(lines: readonly ListingLine[], start: Addr, end: Addr, mem: Uint8Array, S: LineTextSettings, encoding: boolean): CodeLine[] {
  const out: CodeLine[] = [];
  for (const l of lines) {
    if (l.k === 'file' || l.k === 'hdr' || l.k === 'gfx' || l.k === 'blank' || !('a' in l) || l.a < start || l.a >= end) continue;
    if (l.k === 'lbl') { out.push({ text: `// ${l.name}:` }); continue; }
    if (l.k === 'cmt') { if (l.zp == null && !l.mark) out.push({ text: lineText(l, S) }); continue; }
    if (l.k === 'dir' && !l.n) { if (encoding && l.tok[0]?.s === '.encoding') out.push({ text: lineText(l, S) }); continue; }
    let t = lineText(l, S);
    if (l.k === 'ins' && OPC[mem[l.a]].mode === 'rel') {
      const off = (((mem[(l.a + 1) & 0xffff] ^ 0x80) - 0x80) + 2);
      const m = /^(\s*[A-Za-z]{3}(?:\.[A-Za-z]+)?\s+)([^\s/]+)(.*)$/.exec(t);
      if (m) t = `${m[1]}*${off >= 0 ? '+' : ''}${off}${m[3].includes('//') ? m[3].replace('//', `// ${m[2]} ·`) : `  // ${m[2]}`}`;
    }
    out.push({ text: t, ...('n' in l && l.n > 0 ? { a: l.a, n: l.n } : {}) });
  }
  return out;
}

/** The PETSCII control codes a text uses by name (`PET_RETURN`), defined as the source's head defines them */
function petsciiConsts(text: string): string[] {
  const used = new Set(text.match(/\bPET_[A-Z0-9_]+\b/g) ?? []);
  return Object.entries(PETSCII_CONTROLS).filter(([, c]) => used.has(c.name)).map(([b, c]) => `.const ${c.name} = @"\\$${h2(+b)}"`);
}

/** The lines as Kick Assembler that gives `bytes` exactly at `at`: a line that does not assemble (a name only the
 *  source's head has, `music.init`) or gives other bytes is written as its bytes (`.byte`, the line as a comment), so
 *  the rest stays as it was. null: it cannot be made to. */
function exactCode(lines: CodeLine[], bytes: Uint8Array, start: Addr, at: Addr, names: ReadonlyMap<string, Addr>, mem: Uint8Array): string | null {
  const ls = lines.slice();
  const raw = (i: number) => {
    const l = ls[i];
    if (l.a == null || l.n == null) { ls.splice(i, 1); return true; }
    if (l.text.trimStart().startsWith('.byte $') && l.text.includes('// was')) return false;
    ls[i] = { ...l, text: `${byteLines(mem.subarray(l.a, l.a + l.n), 16)[0]}  // was ${l.text.replace(/\s*\/\/.*$/, '').trim()}` };
    return true;
  };
  for (let k = 0; k <= lines.length + 1; k++) {
    const body = ls.map(l => l.text).join('\n'), head = petsciiConsts(body);
    const r = padData({ form: 'asm', text: [...head, body].join('\n') }, at, bytes.length, names);
    if ('error' in r) {
      const i = (r.line ?? 0) - 1 - head.length;
      if (i < 0 || i >= ls.length || !raw(i)) return null;
      continue;
    }
    const d = r.bytes.length !== bytes.length ? Math.min(r.bytes.length, bytes.length) : r.bytes.findIndex((b, i) => b !== bytes[i]);
    if (d < 0) return [...head, body].join('\n');
    const i = ls.findIndex(l => l.a != null && l.n != null && start + d >= l.a && start + d < l.a + l.n);
    if (i < 0 || !raw(i)) return null;
  }
  return null;
}

/** `.byte` lines of `per` bytes, a comment line before each `group` bytes (`// char $00`) */
function byteGroups(bytes: Uint8Array, per: number, group: number, head: (i: number) => string): string {
  const out: string[] = [];
  for (let g = 0; g < bytes.length; g += group) {
    out.push(`// ${head(g / group)}`);
    out.push(...byteLines(bytes.subarray(g, Math.min(bytes.length, g + group)), per, '        '));
  }
  return out.join('\n');
}

/**
 * A block of the program as what a scratchpad at `at` starts with (spec 10.3), written as its type is: code as Kick
 * Assembler (its lines as the listing writes them, the program's names kept), text as text in its encoding (else as the
 * listing writes it), characters as `.byte` lines of 8 (one character), sprites of 3 (a row; 21 and the 64th byte),
 * a bitmap of 8 (a cell, the rows of 40 cells said), a screen of 40 (a row), and other data as hex. Each form is
 * assembled (or read) at `at` with `names`: one that does not give the block's bytes exactly is not used, and hex
 * always does.
 */
export function blockPad(block: Pick<Block, 'start' | 'end' | 'type' | 'props'>, lines: readonly ListingLine[], mem: Uint8Array, at: Addr, names: ReadonlyMap<string, Addr>, S: LineTextSettings): BlockPad {
  const bytes = mem.slice(block.start, block.end), n = bytes.length;
  const exact = (src: ScriptPadSource) => { const r = padData(src, at, n, names); return 'bytes' in r && r.bytes.length === n && r.bytes.every((b, i) => b === bytes[i]); };
  const asm = (text: string, what: string): BlockPad => ({ bytes, src: { form: 'asm', text }, what });
  const tries: BlockPad[] = [];
  const t = block.type;
  const listing = (encoding: boolean, what: string): BlockPad | null => {
    const text = exactCode(listingLines(lines, block.start, block.end, mem, S, encoding), bytes, block.start, at, names, mem);
    return text == null ? null : asm(text, what);
  };
  if (t === 'code') { const c = listing(false, 'code'); if (c) return c; }
  else if (t === 'text') {
    const screen = (block.props.enc ?? 'petscii').startsWith('screen');
    tries.push({ bytes, src: { form: 'text', text: padText(bytes, 'text', at, screen), ...(screen ? { screen } : {}) }, what: `text (${screen ? 'screen codes' : 'PETSCII'})` });
    if (!exact(tries[0].src)) { const c = listing(true, 'text, as the listing writes it'); if (c) return c; }
  } else if (t === 'charset') tries.push(asm(byteGroups(bytes, 8, 8, i => `char $${h2(i & 0xff)}${i > 255 ? ` (${i})` : ''}`), 'characters, 8 bytes a line'));
  else if (t === 'sprite') tries.push(asm(byteGroups(bytes, 3, 64, i => `sprite ${i}`), 'sprites, 3 bytes a line'));
  else if (t === 'bitmap') tries.push(asm(byteGroups(bytes, 8, 320, i => `row ${i}`), 'a bitmap, 8 bytes (a cell) a line'));
  else if (t === 'screen') tries.push(asm(byteGroups(bytes, 40, 1000, i => `screen ${i}`), 'a screen, 40 bytes (a row) a line'));
  for (const c of tries) if (exact(c.src)) return c;
  return { bytes, src: { form: 'hex', text: padText(bytes, 'hex', at) }, what: 'hex' };
}

/** Two scratchpads' bytes compared byte by byte from their starts: how many are the same and how many differ (of
 *  the bytes both have), how many only one has, the first that differs, and the runs of bytes that differ. */
export interface PadDiff { same: number; differ: number; onlyA: number; onlyB: number; first: number | null; runs: ScriptRange[] }
export function padDiff(a: ArrayLike<number>, b: ArrayLike<number>): PadDiff {
  const n = Math.min(a.length, b.length), runs: ScriptRange[] = [];
  let differ = 0;
  for (let i = 0; i < n; i++) {
    if (a[i] === b[i]) continue;
    differ++;
    const last = runs[runs.length - 1];
    if (last && last.end === i) last.end++; else runs.push({ start: i, end: i + 1 });
  }
  return { same: n - differ, differ, onlyA: Math.max(0, a.length - n), onlyB: Math.max(0, b.length - n), first: runs[0]?.start ?? null, runs };
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
