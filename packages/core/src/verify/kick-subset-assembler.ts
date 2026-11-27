/* =====================================================================
 * Assembles the Kick Assembler subset that the generator emits
 * (#import, #define/#if/#else/#endif, .pc/*=, .pseudopc { }, .label/.const/.var, .byte/.word/.text/.encoding, `@"\$93"` strings,
 * .fill with expressions, .import binary, LoadSid, BasicUpstart2, every
 * addressing mode, .abs/.zp, multi-pass resolution), and what code the user writes in patches and scripts uses besides:
 * multi-labels (`!loop:`, `!:`, `bne !-`, `jmp !loop+`), scopes (`{ }`, `name: { }` read as `name.label`), .if/else,
 * .for, .while, .eval, .print, .error, comparisons, `&&` `||` `!` `~`, `? :`, `[ ]` as parentheses, char literals,
 * floating-point arithmetic and the math functions; macros (`.macro name(a, b) { }`, called `name(1, 2)` before or
 * after the definition, each call a scope of its own that a label before the call names), functions (`.function f(a)
 * { .return a*2 }`, one per number of arguments), pseudo commands (`.pseudocommand mov src : dst { }`, each argument
 * with its addressing mode, CmdArgument, AT_*), and segments: `.segmentdef`, `.segment` (start, startAfter, align, min,
 * max, fill, fillByte, virtual, segments, outPrg, outBin, prgFiles, sidFiles, allowOverlap), `.file`, `.segmentout`,
 * `.memblock`. Measured against KickAss 5.25: `<` and `>` take all of the
 * expression after them (`<label+1` is the low byte of label+1), `{ }` of .if, .for, .while and a plain block open a
 * scope whose labels the code outside does not see (each .for or .while round its own), `.pseudopc { }` does not, and
 * a condition must be true or false; a macro sees the names of the top level, not the caller's; a segment must be
 * defined before `.segment` goes to it, one with no start starts at $2000, and `<main>.prg` is the Default segment
 * (the program the check gives: else the file a `.file` or an outPrg writes). The desktop app and the CLI can
 * additionally run the real KickAss.jar.
 * ===================================================================== */
import type { AsmBlock, AsmError, AssembleResult, Vfs } from '../types';
import { BRANCHES, ENC, MODE_LEN, type AddrMode } from '../cpu/opcodes';
import { parsePsid } from '../c64/psid';
import { h4 } from '../util/hex';
import { KICK_DISK_TYPES, kickBytes, kickD64, type KickDiskFile, type KickDiskFormat } from './kick-d64';

interface Stmt { file: string; line: number; src?: string; label?: string; body: string }

type Tok = { t: 'n'; v: number } | { t: 's'; v: string } | { t: 'c'; v: string } | { t: 'id'; v: string } | { t: 'op'; v: string } | { t: 'ml'; name: string; dir: '+' | '-'; n: number };
type Node =
  | { k: 'n'; v: number } | { k: 's'; v: string } | { k: 'c'; v: string } | { k: 'pc' }
  | { k: 'id'; v: string } | { k: 'mem'; o: Node; v: string } | { k: 'call'; f: Node; args: Node[] }
  | { k: 'ml'; name: string; dir: '+' | '-'; n: number }
  | { k: 'u'; op: string; a: Node } | { k: 'b'; op: string; a: Node; b: Node } | { k: 'q'; c: Node; a: Node; b: Node };
// The expression evaluator is dynamically typed: numbers, booleans, strings, functions and LoadSid objects.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Value = any;

/** binary operators by precedence (higher binds tighter), as Java and Kick Assembler have them */
const BIN: Record<string, number> = {
  '||': 1, '&&': 2, '|': 3, '^': 4, '&': 5, '==': 6, '!=': 6, '<': 7, '<=': 7, '>': 7, '>=': 7, '<<': 8, '>>': 8, '+': 9, '-': 9, '*': 10, '/': 10,
};

// As measured with KickAss 5.25: the mapped characters below, every other character is its ASCII code
// (lower case in the *_upper tables too, and \ ^ _ ` { | } ~ everywhere).
const ENCODINGS: Record<string, (c: string) => number> = {
  screencode_upper: c => { const k = c.charCodeAt(0); if (c === '@') return 0; if (k >= 65 && k <= 90) return k - 64; if (c === '[') return 0x1b; if (c === ']') return 0x1d; return k; },
  screencode_mixed: c => { const k = c.charCodeAt(0); if (c === '@') return 0; if (k >= 97 && k <= 122) return k - 96; if (c === '[') return 0x1b; if (c === ']') return 0x1d; return k; },
  petscii_upper: c => c.charCodeAt(0),
  petscii_mixed: c => { const k = c.charCodeAt(0); if (k >= 97 && k <= 122) return k - 32; if (k >= 65 && k <= 90) return k + 0x80; return k; },
};

const IMPLIED_ACC = new Set(['ASL', 'LSR', 'ROL', 'ROR']);
/** the escapes of an `@"..."` string besides `\$xx` (the byte xx); `\"` is not taken, as no generated line has it */
const ESCAPES: Record<string, string> = { b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', '\\': '\\' };

/** Kick Assembler's functions and constants that the code may use */
const num = (v: Value, f: string): number => { if (typeof v !== 'number') throw new Error(`${f}() takes numbers`); return v; };
const MATH: Record<string, Value> = {
  abs: (x: number) => Math.abs(num(x, 'abs')), acos: Math.acos, asin: Math.asin, atan: Math.atan, atan2: Math.atan2, cbrt: Math.cbrt, ceil: Math.ceil,
  cos: Math.cos, cosh: Math.cosh, exp: Math.exp, expm1: Math.expm1, floor: Math.floor, hypot: Math.hypot, IEEEremainder: (x: number, y: number) => x - y * Math.round(x / y),
  log: Math.log, log10: Math.log10, log1p: Math.log1p, max: Math.max, min: Math.min, mod: (a: number, b: number) => { const x = Math.trunc(num(a, 'mod')), y = Math.trunc(num(b, 'mod')); if (!y) throw new Error('mod() by zero'); return x % y; },
  pow: Math.pow, random: Math.random, round: (x: number) => Math.floor(num(x, 'round') + 0.5), signum: Math.sign, sin: Math.sin, sinh: Math.sinh, sqrt: Math.sqrt, tan: Math.tan, tanh: Math.tanh,
  toDegrees: (x: number) => num(x, 'toDegrees') * 180 / Math.PI, toRadians: (x: number) => num(x, 'toRadians') * Math.PI / 180,
  toIntString: (v: number, w?: number) => String(Math.trunc(v)).padStart(w ?? 0, ' '), toHexString: (v: number, w?: number) => (Math.trunc(v) >>> 0).toString(16).padStart(w ?? 0, '0'),
  toBinaryString: (v: number, w?: number) => (Math.trunc(v) >>> 0).toString(2).padStart(w ?? 0, '0'), toOctalString: (v: number, w?: number) => (Math.trunc(v) >>> 0).toString(8).padStart(w ?? 0, '0'),
  PI: Math.PI, E: Math.E, true: true, false: false,
};
/** a string's functions in Kick Assembler */
const stringMember = (s: string, m: string): Value => {
  switch (m) {
    case 'size': return () => s.length;
    case 'charAt': return (i: number) => s.charAt(i);
    case 'substring': return (a: number, b?: number) => s.substring(a, b);
    case 'toUpperCase': return () => s.toUpperCase();
    case 'toLowerCase': return () => s.toLowerCase();
    case 'asNumber': return () => { const v = Number(s.trim().replace(/^\$/, '0x')); if (Number.isNaN(v)) throw new Error(`"${s}" is not a number`); return v; };
    case 'asBoolean': return () => s.trim() === 'true';
  }
  throw new Error(`a string has no .${m}()`);
};

/** a pseudo command's argument: its addressing mode and value (`#1` is AT_IMMEDIATE 1), as Kick Assembler's CmdArgument */
interface CmdArg { cmd: true; type: number; value: Value; getType: () => number; getValue: () => Value }
const AT: Record<string, number> = { AT_NONE: 0, AT_ABSOLUTE: 1, AT_ABSOLUTEX: 2, AT_ABSOLUTEY: 3, AT_IMMEDIATE: 4, AT_INDIRECT: 5, AT_IZEROPAGEX: 6, AT_IZEROPAGEY: 7 };
const cmdArg = (type: number, value: Value): CmdArg => ({ cmd: true, type, value, getType: () => type, getValue: () => value });
const isCmd = (v: Value): v is CmdArg => !!v && typeof v === 'object' && v.cmd === true;
/** the instruction's addressing mode an argument of each type gives */
const CMD_MODE: Record<number, string> = { [AT.AT_ABSOLUTE]: 'plain', [AT.AT_ABSOLUTEX]: 'x', [AT.AT_ABSOLUTEY]: 'y', [AT.AT_IMMEDIATE]: 'imm', [AT.AT_INDIRECT]: 'ind', [AT.AT_IZEROPAGEX]: 'izx', [AT.AT_IZEROPAGEY]: 'izy' };
/** what `.return` throws to the function it ends */
class Ret { constructor(readonly v: Value) {} }

const typeName = (v: Value) => typeof v === 'boolean' ? 'boolean' : typeof v === 'string' ? 'string' : typeof v === 'number' ? 'number' : 'object';
/** a value that goes into bytes or an address: a number (a boolean or a string is an error, as in Kick Assembler) */
const numberOf = (v: Value): number => {
  if (typeof v === 'number') { if (!Number.isFinite(v)) throw new Error(`${v} is not a number that fits in memory`); return Math.trunc(v); }
  throw new Error(`Can't get a number from a value of type ${typeName(v)}`);
};
const isBool = (v: Value): v is boolean => typeof v === 'boolean';
/** `"A, B"` as its names */
const listOf = (v: Value): string[] => String(v).split(',').map(x => x.trim()).filter(Boolean);

export interface AssembleOptions {
  /** names the code may use without defining them (the program's labels, the hardware's): the code's own win */
  names?: ReadonlyMap<string, number>;
  /** where the program counter starts before the first .pc (0 when missing) */
  pc?: number;
  /** (64tass) the processor before a .cpu: the command line's (--m65816, -x …); missing: the 6502 */
  cpu?: string;
  /** the lines, statement starts and instructions of every file the code imports, not only the entry file's, with
   *  `fileOf` and `fileNames` saying whose each byte is (the Assembler's debugger: a breakpoint in an imported file) */
  allFiles?: boolean;
  /** what the assembler's command line defines (the project's arguments): Kick Assembler's `-define NAME` a symbol
   *  #if tests, 64tass's `-D NAME=value` a constant of the root scope, defined before the first line (a line defining
   *  it again is an error, as in 64tass; one in .weak gives way). `value` missing: 0, as 64tass gives `-D NAME` */
  defines?: readonly { name: string; value?: string }[];
  /** (64tass) the command line's --long-branch: a branch that does not reach goes over a JMP */
  longBranch?: boolean;
}

/** the folder part of a path in the files (`lib/macros.asm` → `lib/`; none: '') */
const folderOf = (path: string): string => { const i = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')); return i < 0 ? '' : path.slice(0, i + 1); };
/** `p` as Kick Assembler finds it from a file at `from`: in that file's folder first, else as it is written (from the
 *  entry file's folder) */
export function importPath(vfs: Vfs, from: string, p: string): string {
  const dir = folderOf(from);
  if (!dir || /^([A-Za-z]:)?[\\/]/.test(p)) return p;
  const near = (dir + p).replace(/\\/g, '/').split('/').reduce<string[]>((out, part) => { if (part === '..' && out.length && out[out.length - 1] !== '..') out.pop(); else if (part !== '.') out.push(part); return out; }, []).join('/');
  return vfs[near] !== undefined ? near : p;
}

/** an index past the parentheses (or brackets) that open at `i` in `s`, or -1 */
function closeAt(s: string, i: number): number {
  let depth = 0, q = '';
  for (let k = i; k < s.length; k++) {
    const c = s[k];
    if (q) { if (c === q) q = ''; continue; }
    if (c === '"') { q = c; continue; }
    if (c === "'" && s[k + 2] === "'") { k += 2; continue; }
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') { depth--; if (!depth) return k + 1; }
  }
  return -1;
}

/** `s` split at `sep` where it is outside strings, char literals and parentheses */
function splitTop(s: string, sep: string): string[] {
  const out: string[] = []; let depth = 0, q = '', cur = '';
  for (let k = 0; k < s.length; k++) {
    const c = s[k];
    if (q) { cur += c; if (c === q) q = ''; continue; }
    if (c === '"') { q = c; cur += c; continue; }
    if (c === "'" && s[k + 2] === "'") { cur += s.slice(k, k + 3); k += 2; continue; }
    if (c === '(' || c === '[') depth++;
    if (c === ')' || c === ']') depth--;
    if (!depth && c === sep) { out.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim() || out.length) out.push(cur.trim());
  return out;
}

/** a line of code cut where `{` opens (with what comes before it) and where `}` closes, outside strings */
function braceParts(s: string): string[] {
  const out: string[] = []; let q = '', cur = '', depth = 0;
  for (let k = 0; k < s.length; k++) {
    const c = s[k];
    if (q) { cur += c; if (c === q) q = ''; continue; }
    if (c === '"') { q = c; cur += c; continue; }
    if (c === "'" && s[k + 2] === "'") { cur += s.slice(k, k + 3); k += 2; continue; }
    if (c === '(' || c === '[') depth++;
    if (c === ')' || c === ']') depth--;
    if (!depth && c === '{') { out.push((cur.trim() + ' {').trim()); cur = ''; continue; }
    if (!depth && c === '}') { if (cur.trim()) out.push(cur.trim()); out.push('}'); cur = ''; continue; }
    // (; between statements on a line: `nop; nop`, `{pha;txa;pha}`; not in .for's parentheses)
    if (!depth && c === ';') { if (cur.trim()) out.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** a statement of the code, or a block of statements (a scope, `.pseudopc`, `.if`, `.for`, `.while`) */
type Tree =
  | { k: 'st'; st: Stmt }
  | { k: 'blk'; id: number; st: Stmt; kind: 'scope' | 'pseudopc' | 'if' | 'for' | 'while' | 'disk'; head: string; body: Tree[]; els?: Tree[] };

/** where names are looked up: a block's own variables and labels, then the blocks around it (a named one's labels are
 *  also `name.label` in `home`, else in the parent) */
interface Scope { key: string; vars: Map<string, Value>; parent: Scope | null; name?: string; home?: Scope }

/** a macro, function or pseudo command the code defines */
interface Def { kind: 'macro' | 'function' | 'pseudocommand'; name: string; params: string[]; body: Tree[]; st: Stmt }

/** a memory block of a segment: where it starts, its name, and the last address it reached (start - 1: none) */
interface MemBlock { start: number; name: string; end?: number }
/** a segment: its parameters, its own memory and program counter, its memory blocks; `Default` is the code's */
interface Seg {
  name: string; st: Stmt | null; p: Record<string, Value>;
  mem: Uint8Array; written: Uint8Array; lines: Int32Array; starts: Uint8Array; ops: Uint8Array; fileOf?: Uint16Array;
  pc: number; begun: boolean; blocks: MemBlock[];
  /** where its first byte went, and when (in the order of the code) */
  first: number; firstN: number;
}
/** what a file or a .segmentout gets of segments: their bytes (fill where asked) with the lines they come from */
interface Content { mem: Uint8Array; written: Uint8Array; lines: Int32Array; starts: Uint8Array; ops: Uint8Array; fileOf?: Uint16Array; min: number; max: number; first: number; firstN: number; blocks: AsmBlock[] }
/** a file the build writes: `.file` or a segment's outPrg / outBin */
interface OutFile { name: string; type: 'prg' | 'bin'; segments: string[]; st: Stmt }
const SEG_PARAMS = new Set(['start', 'startAfter', 'align', 'min', 'max', 'fill', 'fillByte', 'virtual', 'segments', 'outPrg', 'outBin', 'allowOverlap', 'hide', 'dest', 'prgFiles', 'sidFiles', 'modify']);
/** a .disk's parameters (KickAss's cc1541 disk writer), and each of its files' (those of a segment besides) */
const DISK_PARAMS = new Set(['filename', 'name', 'id', 'format', 'dontSplitFilesOverDir', 'storeFilesInDir', 'interleave', 'showInfo']);
const DISK_FILE_PARAMS = new Set([...SEG_PARAMS, 'name', 'type', 'hide', 'interleave', 'noStartAddr']);
/** a disk image the build writes, and its files with what each is made of (`extra`: the PRGs and SIDs it is given) */
interface OutDisk { p: Record<string, Value>; files: { p: Record<string, Value>; extra: Seg | null }[]; st: Stmt }

export function assemble(vfs: Vfs, entryPath: string, opts: AssembleOptions = {}): AssembleResult {
  const errors: AsmError[] = [];
  /** the macros, functions and pseudo commands being run, outermost first: a byte one writes is its outermost call's
   *  line's, and a problem in one says which call it was in */
  let calls: { name: string; st: Stmt }[] = [];
  const E = (msg: string, st?: Stmt) => {
    const c = calls[calls.length - 1];
    const where = c && st && c.st !== st ? ` (in ${c.name}, called on line ${c.st.line}${c.st.file !== st.file ? ` of ${c.st.file}` : ''})` : '';
    errors.push({ msg: msg + where, file: st ? st.file : entryPath, line: st ? st.line : 0 });
  };
  const warnings: AsmError[] = [];
  const stmts: Stmt[] = [];
  // preprocessor: #define/#undef and #if/#elif/#else/#endif over defined symbols (!, &&, ||, parentheses)
  const defines = new Set<string>(opts.defines?.map(d => d.name));
  const cond: { active: boolean; taken: boolean; outer: boolean }[] = [];
  const on = () => cond.every(c => c.active);
  const test = (src: string): boolean => {
    const t = src.match(/[A-Za-z_]\w*|&&|\|\||[!()]/g) || [];
    let i = 0;
    const not = (): boolean => {
      if (t[i] === '!') { i++; return !not(); }
      if (t[i] === '(') { i++; const v = or(); if (t[i] === ')') i++; return v; }
      const id = t[i++] ?? '';
      return id === 'true' || (id !== 'false' && defines.has(id));
    };
    const and = (): boolean => { let v = not(); while (t[i] === '&&') { i++; const r = not(); v = v && r; } return v; };
    const or = (): boolean => { let v = and(); while (t[i] === '||') { i++; const r = and(); v = v || r; } return v; };
    return or();
  };
  // how many times each file was imported: one with #importonce is read the first time only, as Kick Assembler does
  const loads = new Map<string, number>();
  const loadFile = (path: string, depth: number) => {
    const src = vfs[path];
    if (typeof src !== 'string') { E(`Can't open file "${path}"`); return; }
    if (depth > 16) { E(`#import nested too deep at "${path}"`); return; }
    loads.set(path, (loads.get(path) ?? 0) + 1);
    let inBlock = false, skip = false;
    src.split(/\r?\n/).forEach((raw, i) => {
      if (skip) return;
      let s = '', q = false;
      for (let k = 0; k < raw.length; k++) {
        const c = raw[k], c2 = raw[k + 1];
        if (inBlock) { if (c === '*' && c2 === '/') { inBlock = false; k++; } continue; }
        if (c === '"') q = !q;
        if (!q && c === "'" && raw[k + 2] === "'") { s += raw.slice(k, k + 3); k += 2; continue; }
        if (!q && c === '/' && c2 === '/') break;
        if (!q && c === '/' && c2 === '*') { inBlock = true; k++; continue; }
        s += c;
      }
      s = s.trim();
      if (!s) return;
      const pp = s.match(/^#(define|undef|if|elif|else|endif)\b\s*(.*)$/);
      if (pp) {
        const top = cond[cond.length - 1], at: Stmt = { file: path, line: i + 1, src: s, body: '' };
        switch (pp[1]) {
          case 'if': { const outer = on(), v = outer && test(pp[2]); cond.push({ active: v, taken: v, outer }); break; }
          case 'elif': if (!top) E('#elif without #if', at); else { const v = top.outer && !top.taken && test(pp[2]); top.active = v; top.taken ||= v; } break;
          case 'else': if (!top) E('#else without #if', at); else { top.active = top.outer && !top.taken; top.taken = true; } break;
          case 'endif': if (!cond.pop()) E('#endif without #if', at); break;
          default: if (on()) { const name = pp[2].trim().split(/\s+/)[0]; if (pp[1] === 'define') defines.add(name); else defines.delete(name); }
        }
        return;
      }
      if (!on()) return;
      if (/^#importonce\b/.test(s)) { if ((loads.get(path) ?? 0) > 1) skip = true; return; }
      const imp = s.match(/^(?:([A-Za-z_][A-Za-z0-9_]*)\s*:\s*)?#import\s+"([^"]+)"/);
      if (imp) { if (imp[1]) stmts.push({ file: path, line: i + 1, label: imp[1], body: '' }); loadFile(importPath(vfs, path, imp[2]), depth + 1); return; }
      for (let part of braceParts(s)) {
        const st: Stmt = { file: path, line: i + 1, src: s, body: '' };
        // a label (`name:`), or a multi-label (`!name:`, `!:`), before the statement
        const m = part.match(/^(![A-Za-z_]\w*|!|[A-Za-z_][A-Za-z0-9_]*)\s*:(?!:)\s*(.*)$/);
        if (m && !/^[A-Za-z_]\w*\s*:\s*=/.test(part)) { st.label = m[1]; part = m[2]; }
        st.body = part;
        stmts.push(st);
      }
    });
  };
  loadFile(entryPath, 0);
  if (cond.length) E(`#if without #endif (${cond.length} open)`);

  // ---- the statements as a tree of blocks ----
  let at = 0, blockIds = 0;
  // the macros, functions and pseudo commands, wherever they are in the code (a call may come first)
  const macros = new Map<string, Def>(), pseudos = new Map<string, Def>(), funcs = new Map<string, Map<number, Def>>();
  const addDef = (kind: Def['kind'], head: string, body: Tree[], st: Stmt) => {
    const m = kind === 'pseudocommand' ? head.match(/^([A-Za-z_]\w*)\s*(.*)$/) : head.match(/^([A-Za-z_]\w*)\s*\(([^)]*)\)$/);
    if (!m) { E(kind === 'pseudocommand' ? '.pseudocommand needs a name and its arguments: .pseudocommand mov src : dst {' : `.${kind} needs a name and its parameters: .${kind} name(a, b) {`, st); return; }
    const params = m[2].split(kind === 'pseudocommand' ? ':' : ',').map(p => p.trim()).filter(Boolean);
    const bad = params.find(p => !/^[A-Za-z_]\w*$/.test(p));
    if (bad) { E(`"${bad}" is not a name for a parameter`, st); return; }
    const def: Def = { kind, name: m[1], params, body, st };
    if (kind === 'function') {
      const byN = funcs.get(def.name) ?? new Map<number, Def>(); funcs.set(def.name, byN);
      if (byN.has(params.length)) E(`The function '${def.name}' with ${params.length} parameter${params.length === 1 ? '' : 's'} is already defined`, st); else byN.set(params.length, def);
      return;
    }
    const map = kind === 'macro' ? macros : pseudos;
    if (map.has(def.name)) E(`The ${kind === 'macro' ? 'macro' : 'pseudo command'} '${def.name}' is already defined`, st); else map.set(def.name, def);
  };
  const list = (inBlock: Stmt | null): Tree[] => {
    const out: Tree[] = [];
    while (at < stmts.length) {
      const st = stmts[at];
      if (st.body === '}' && !st.label) { at++; if (inBlock) return out; E('} without {', st); continue; }
      out.push(node());
    }
    if (inBlock) E('{ without }', inBlock);
    return out;
  };
  /** the body of a .if, .for, .while or else: a block, the statement after the header, or the next one */
  const bodyOf = (rest: string, st: Stmt): Tree[] => {
    if (rest === '{') return list(st);
    if (rest) return [node({ ...st, label: undefined, body: rest })];
    if (at < stmts.length && stmts[at].body === '{' && !stmts[at].label) { at++; return list(st); }
    if (at < stmts.length && stmts[at].body !== '}') return [node()];
    E('a .if, .for or .while without a body', st);
    return [];
  };
  const node = (given?: Stmt): Tree => {
    const st = given ?? stmts[at++];
    const s = st.body;
    const ctl = s.match(/^\.(if|for|while)\s*(?=\()/);
    if (ctl) {
      const open = ctl[0].length, close = closeAt(s, open);
      if (close < 0) { E(`missing ) after .${ctl[1]}`, st); return { k: 'st', st: { ...st, body: '' } }; }
      const head = s.slice(open + 1, close - 1), rest = s.slice(close).trim();
      // `.if (c) .byte 1 else .byte 2` on one line
      const inline = ctl[1] === 'if' && rest && rest !== '{' ? splitElse(rest) : null;
      const blk: Tree = { k: 'blk', id: blockIds++, st, kind: ctl[1] as 'if' | 'for' | 'while', head, body: bodyOf(inline ? inline[0] : rest, st) };
      if (ctl[1] === 'if') {
        if (inline && inline[1] != null) blk.els = bodyOf(inline[1], st);
        else if (at < stmts.length && /^else\b/.test(stmts[at].body) && !stmts[at].label) {
          const e = stmts[at++], r = e.body.slice(4).trim();
          blk.els = /^\.if\b/.test(r) ? [node({ ...e, body: r })] : bodyOf(r, e);
        }
      }
      return blk;
    }
    if (/^else\b/.test(s)) { E('else without .if', st); return { k: 'st', st: { ...st, body: '' } }; }
    // a definition: kept apart, run where it is called
    const def = s.match(/^\.(macro|function|pseudocommand)\b\s*(.*?)\s*(\{?)$/);
    if (def) {
      let body: Tree[] = [];
      if (def[3]) body = list(st);
      else if (at < stmts.length && stmts[at].body === '{' && !stmts[at].label) { at++; body = list(st); }
      else E(`.${def[1]} without its body in { }`, st);
      addDef(def[1] as Def['kind'], def[2], body, st);
      return { k: 'st', st: { ...st, body: '' } };
    }
    // a disk image: its files, each `[name="…", …]`, in its block
    if (/^\.disk\b/.test(s) && !s.endsWith('{') && at < stmts.length && stmts[at].body === '{' && !stmts[at].label) { at++; return { k: 'blk', id: blockIds++, st, kind: 'disk', head: s.slice(5).trim(), body: list(st) }; }
    if (s.endsWith('{')) {
      const head = s.slice(0, -1).trim(), pp = head.match(/^\.pseudopc\s+(.+)$/);
      if (/^\.disk\b/.test(head)) return { k: 'blk', id: blockIds++, st, kind: 'disk', head: head.slice(5).trim(), body: list(st) };
      if (pp) return { k: 'blk', id: blockIds++, st, kind: 'pseudopc', head: pp[1], body: list(st) };
      if (!head) return { k: 'blk', id: blockIds++, st, kind: 'scope', head: '', body: list(st) };
      if (/^\.(modify|filemodify)\b/.test(head)) E(`Mimir's check cannot run a modifier plugin (${head.split(/\s/)[0]}): Kick Assembler has none of its own, they are Java plugins (Run builds with Kick Assembler)`, st);
      else E(`unexpected { after "${head}"`, st);
      return { k: 'blk', id: blockIds++, st, kind: 'scope', head: '', body: list(st) };
    }
    return { k: 'st', st };
  };
  /** `a else b` cut at the `else` outside strings and parentheses */
  const splitElse = (s: string): [string, string | null] => {
    const parts = splitTop(s.replace(/\s+else\s+/g, '\u0001'), '\u0001');
    return parts.length > 1 ? [parts[0], parts.slice(1).join(' else ')] : [s, null];
  };
  const tree = list(null);

  // ---- expressions ----
  const tokenize = (s: string): Tok[] => {
    const out: Tok[] = []; let i = 0;
    while (i < s.length) {
      const c = s[i];
      if (/\s/.test(c)) { i++; continue; }
      if (c === '$') { const m = s.slice(i + 1).match(/^[0-9a-fA-F]+/); if (!m) throw new Error(`bad hex number in "${s}"`); out.push({ t: 'n', v: parseInt(m[0], 16) }); i += 1 + m[0].length; continue; }
      if (c === '%') { const m = s.slice(i + 1).match(/^[01]+/); if (m) { out.push({ t: 'n', v: parseInt(m[0], 2) }); i += 1 + m[0].length; continue; } }
      if (/[0-9]/.test(c)) { const m = s.slice(i).match(/^[0-9]+(?:\.[0-9]+)?/)!; out.push({ t: 'n', v: parseFloat(m[0]) }); i += m[0].length; continue; }
      if (/[A-Za-z_]/.test(c)) { const m = s.slice(i).match(/^[A-Za-z_][A-Za-z0-9_]*/)!; out.push({ t: 'id', v: m[0] }); i += m[0].length; continue; }
      if (c === '"') { const j = s.indexOf('"', i + 1); if (j < 0) throw new Error('unterminated string'); out.push({ t: 's', v: s.slice(i + 1, j) }); i = j + 1; continue; }
      if (c === "'" && s[i + 2] === "'") { out.push({ t: 'c', v: s[i + 1] }); i += 3; continue; }
      // a string with escapes, `@"\$93"` (a PETSCII control code by name, `.const PET_CLR = @"\$93"`)
      if (c === '@' && s[i + 1] === '"') {
        const j = s.indexOf('"', i + 2); if (j < 0) throw new Error('unterminated string');
        const v = s.slice(i + 2, j).replace(/\\(\$[0-9a-fA-F]{2}|.)/g, (_m, x: string) => {
          if (x[0] === '$' && x.length === 3) return String.fromCharCode(parseInt(x.slice(1), 16));
          const k = ESCAPES[x]; if (k == null) throw new Error(`unknown escape "\\${x}" in "${s}"`); return k;
        });
        out.push({ t: 's', v }); i = j + 1; continue;
      }
      // a multi-label: `!-`, `!+`, `!loop--`, `!next+` (not `!=`, and not a `!` before a value)
      if (c === '!') {
        const m = s.slice(i).match(/^!([A-Za-z_]\w*)?(\++|-+)(?![\w$%('"])/);
        if (m) { out.push({ t: 'ml', name: m[1] ?? '', dir: m[2][0] as '+' | '-', n: m[2].length }); i += m[0].length; continue; }
      }
      const two = s.slice(i, i + 2);
      if (['<<', '>>', '==', '!=', '<=', '>=', '&&', '||'].includes(two)) { out.push({ t: 'op', v: two }); i += 2; continue; }
      if ('+-*/&|^<>(),.!~?:[]'.includes(c)) { out.push({ t: 'op', v: c }); i++; continue; }
      throw new Error(`unexpected "${c}" in expression "${s}"`);
    }
    return out;
  };
  const parseExpr = (s: string): Node => {
    const tk = tokenize(s); let p = 0;
    const peek = (): Tok | undefined => tk[p], next = (): Tok | undefined => tk[p++];
    const isOp = (t: Tok | undefined, v: string) => !!t && t.t === 'op' && t.v === v;
    const primary = (): Node => {
      const t = next();
      if (!t) throw new Error(`incomplete expression "${s}"`);
      if (t.t === 'n') return { k: 'n', v: t.v };
      if (t.t === 's') return post({ k: 's', v: t.v });
      if (t.t === 'c') return { k: 'c', v: t.v };
      if (t.t === 'ml') return { k: 'ml', name: t.name, dir: t.dir, n: t.n };
      if (t.t === 'op' && t.v === '*') return { k: 'pc' };
      if (t.t === 'op' && (t.v === '(' || t.v === '[')) { const e = full(); const c = next(); if (!c || c.t !== 'op' || c.v !== (t.v === '(' ? ')' : ']')) throw new Error(`missing ${t.v === '(' ? ')' : ']'} in "${s}"`); return post(e); }
      // `<` and `>` take all of the expression after them (KickAss: `<label+1` is the low byte of label+1)
      if (t.t === 'op' && (t.v === '<' || t.v === '>')) return { k: 'u', op: t.v, a: expr(1) };
      if (t.t === 'op' && (t.v === '-' || t.v === '!' || t.v === '~' || t.v === '+')) return { k: 'u', op: t.v, a: primary() };
      if (t.t === 'id') return post({ k: 'id', v: t.v });
      throw new Error(`unexpected "${t.v}" in "${s}"`);
    };
    /** member access and calls after a value: `music.init`, `sin(x)`, `"ab".size()` */
    const post = (node: Node): Node => {
      for (;;) {
        const q = peek();
        if (isOp(q, '.')) { next(); const id = next(); if (!id || id.t !== 'id') throw new Error(`bad member access in "${s}"`); node = { k: 'mem', o: node, v: id.v }; continue; }
        if (isOp(q, '(') && (node.k === 'id' || node.k === 'mem')) {
          next(); const args: Node[] = [];
          if (!isOp(peek(), ')')) { for (;;) { args.push(full()); const c = next(); if (isOp(c, ')')) break; if (!isOp(c, ',')) throw new Error(`bad argument list in "${s}"`); } } else next();
          node = { k: 'call', f: node, args }; continue;
        }
        return node;
      }
    };
    const expr = (minP: number): Node => {
      let left = primary();
      for (;;) {
        const t = peek();
        if (!t || t.t !== 'op' || !BIN[t.v] || BIN[t.v] < minP) break;
        next(); const right = expr(BIN[t.v] + 1); left = { k: 'b', op: t.v, a: left, b: right };
      }
      return left;
    };
    /** an expression with `cond ? a : b` */
    const full = (): Node => {
      const c = expr(1);
      if (!isOp(peek(), '?')) return c;
      next(); const a = full(); if (!isOp(next(), ':')) throw new Error(`missing : after ? in "${s}"`);
      return { k: 'q', c, a, b: full() };
    };
    const e = full();
    if (p < tk.length) { const t = tk[p]; throw new Error(`unexpected "${t.t === 'ml' ? '!' + t.name + t.dir.repeat(t.n) : t.t === 'c' ? `'${t.v}'` : t.v}" in "${s}"`); }
    return e;
  };
  const cache = new Map<string, Node>();
  const P = (s: string): Node => { let n = cache.get(s); if (!n) { n = parseExpr(s); cache.set(s, n); } return n; };

  const syms = new Map<string, Value>();
  let pc = 0, pass: number | 'final' = 0, unresolved: string[] = [];
  let enc = 'screencode_mixed';
  const builtins: Record<string, Value> = {
    ...MATH, ...AT,
    CmdArgument: (type: Value, value: Value) => cmdArg(num(type, 'CmdArgument'), value),
    LoadSid: (path: string) => { const u = vfs[importPath(vfs, curStmt?.file ?? entryPath, path)]; if (!(u instanceof Uint8Array)) throw new Error(`LoadSid: can't open "${path}"`); const sid = parsePsid(u); return Object.assign({}, sid, { getData: (i: number) => sid.data[i] }); },
  };
  const names = opts.names;
  /** the statement being assembled, and the names from outside (`names`) the code used, with the first line using each */
  let curStmt: Stmt | null = null;
  const external = new Map<string, number>();
  // multi-labels in the order the pass defines them (`!name` as name, `!` as ''), and the last pass's
  let ml: { name: string; v: number }[] = [], mlPrev: { name: string; v: number }[] = [];
  const root: Scope = { key: '', vars: new Map(), parent: null };
  let cur: Scope = root;
  /** where a label of scope `s` is kept: a label of the outermost scope under its plain name */
  const keyOf = (s: Scope, name: string) => s.key ? `${s.key}>${name}` : name;
  const lookup = (name: string, s: Scope): Value | undefined => {
    for (let x: Scope | null = s; x; x = x.parent) {
      if (x.vars.has(name)) return x.vars.get(name);
      const k = keyOf(x, name);
      if (syms.has(k)) return syms.get(k);
    }
    if (name in builtins) return builtins[name];
    const ext = names?.get(name);
    // the names from outside the code uses in the final pass, and the first line that does
    if (ext !== undefined && pass === 'final' && curStmt && !external.has(name)) external.set(name, curStmt.line);
    return ext;
  };
  /** `a.b.c` of a node made of names and member accesses, or null */
  const dotted = (n: Node): string | null => n.k === 'id' ? n.v : n.k === 'mem' ? ((o => o && `${o}.${n.v}`)(dotted(n.o))) : null;
  const ev = (node: Node, s: Scope = cur): Value => {
    switch (node.k) {
      case 'n': return node.v;
      case 's': return node.v;
      case 'c': return (ENCODINGS[enc] ?? ENCODINGS.screencode_mixed)(node.v);
      case 'pc': return pc;
      case 'id': {
        const v = lookup(node.v, s);
        if (v !== undefined) return v;
        unresolved.push(node.v); return null;
      }
      case 'ml': {
        if (node.dir === '-') {
          let left = node.n;
          for (let i = ml.length - 1; i >= 0; i--) if (ml[i].name === node.name && !--left) return ml[i].v;
        } else {
          let left = node.n;
          for (let i = ml.length; i < mlPrev.length; i++) if (mlPrev[i].name === node.name && !--left) return mlPrev[i].v;
        }
        unresolved.push(`!${node.name}${node.dir.repeat(node.n)}`); return null;
      }
      case 'mem': {
        // a label in a named scope (`name.label`) first, else a member of a value (`music.init`)
        const d = dotted(node);
        if (d) { const v = lookup(d, s); if (v !== undefined) return v; }
        const o = ev(node.o, s); if (o == null) return null;
        if (typeof o === 'string') return stringMember(o, node.v);
        if (typeof o !== 'object') throw new Error(`a ${typeName(o)} has no .${node.v}`);
        const v = o[node.v]; if (v === undefined) throw new Error(`unknown member .${node.v}`); return v;
      }
      case 'call': {
        // a function the code defines
        if (node.f.k === 'id' && funcs.has(node.f.v)) { const args = node.args.map(a => ev(a, s)); return args.some(a => a == null) ? null : callFunc(node.f.v, args); }
        if (node.f.k === 'mem' && !(dotted(node.f) && lookup(dotted(node.f)!, s) !== undefined)) {
          const o = ev(node.f.o, s); if (o == null) return null;
          const fn = typeof o === 'string' ? stringMember(o, node.f.v) : o[node.f.v];
          if (typeof fn !== 'function') throw new Error(`.${node.f.v}() is not a function`);
          const args = node.args.map(a => ev(a, s)); if (args.some(a => a == null)) return null; return fn(...args);
        }
        const fn = ev(node.f, s); const args = node.args.map(a => ev(a, s));
        if (fn == null || args.some(a => a == null)) return null;
        if (typeof fn !== 'function') throw new Error(`${dotted(node.f) ?? 'this'} is not a function`);
        return fn(...args);
      }
      case 'q': {
        const c = ev(node.c, s); if (c == null) return null;
        if (!isBool(c)) throw new Error(`Can't get a boolean from a value of type ${typeName(c)} (before ?)`);
        return ev(c ? node.a : node.b, s);
      }
      case 'u': {
        const v = ev(node.a, s); if (v == null) return null;
        if (node.op === '!') { if (!isBool(v)) throw new Error(`! needs true or false, not a ${typeName(v)}`); return !v; }
        const n = numberOf(v);
        return node.op === '<' ? n & 0xff : node.op === '>' ? (n >> 8) & 0xff : node.op === '~' ? ~n : node.op === '+' ? v : -v;
      }
      case 'b': {
        if (node.op === '&&' || node.op === '||') {
          const x = ev(node.a, s); if (x == null) return null;
          if (!isBool(x)) throw new Error(`${node.op} needs true or false, not a ${typeName(x)}`);
          if (node.op === '&&' ? !x : x) return x;
          const y = ev(node.b, s); if (y == null) return null;
          if (!isBool(y)) throw new Error(`${node.op} needs true or false, not a ${typeName(y)}`);
          return y;
        }
        const x = ev(node.a, s), y = ev(node.b, s); if (x == null || y == null) return null;
        switch (node.op) {
          case '==': return x === y;
          case '!=': return x !== y;
          case '+': if (typeof x === 'string' || typeof y === 'string') return String(x) + String(y); break;
        }
        if (typeof x !== 'number' || typeof y !== 'number') throw new Error(`${node.op} needs numbers, not a ${typeName(typeof x !== 'number' ? x : y)}`);
        switch (node.op) {
          case '+': return x + y; case '-': return x - y; case '*': return x * y;
          case '/': if (!y) throw new Error('division by zero'); return x / y;
          case '&': return Math.trunc(x) & Math.trunc(y); case '|': return Math.trunc(x) | Math.trunc(y); case '^': return Math.trunc(x) ^ Math.trunc(y);
          case '<<': return Math.trunc(x) << Math.trunc(y); case '>>': return Math.trunc(x) >> Math.trunc(y);
          case '<': return x < y; case '<=': return x <= y; case '>': return x > y; case '>=': return x >= y;
        }
        return null;
      }
    }
    return null;
  };
  /** each macro call's statement's number: its scope's key, the same in every pass */
  const callIds = new Map<Stmt, number>();
  /** runs a function the code defines (set by each pass: it runs statements) */
  let callFunc: (name: string, args: Value[]) => Value = () => null;
  /** a number for bytes and addresses (null: not known yet in this pass) */
  const evn = (node: Node, s: Scope = cur): number | null => { const v = ev(node, s); return v == null ? null : numberOf(v); };
  /** a condition: true or false (null: not known yet in this pass) */
  const evb = (src: string, s: Scope = cur): boolean | null => {
    const v = ev(P(src), s); if (v == null) return null;
    if (!isBool(v)) throw new Error(`Can't get a boolean from a value of type ${typeName(v)}: a condition must be true or false (a comparison)`);
    return v;
  };
  const splitArgs = (s: string) => splitTop(s, ',').filter(a => a !== '');
  let mem: Uint8Array = new Uint8Array(0x10000), written: Uint8Array = new Uint8Array(0x10000), blocks: MemBlock[] = [];
  // `.pseudopc a { … }`: `pc` (labels, `*`, branches) counts from a while the bytes go on where they are; `off` is
  // how far pc is from where the next byte goes, and `outer` the offsets of the .pseudopc blocks around
  let off = 0, outer: number[] = [], first = -1;
  const prints: string[] = [];
  // in the final pass, the line of the entry file each byte comes from, and where each statement's bytes start (an
  // instruction's first byte: a debugger's line, a breakpoint's address)
  const lines0 = new Int32Array(0x10000), starts0 = new Uint8Array(0x10000), ops0 = new Uint8Array(0x10000);
  // (allFiles: every file's, and whose each byte is: its index in fileNames + 1)
  const all = !!opts.allFiles, fileOf0 = all ? new Uint16Array(0x10000) : undefined, fileNames: string[] = [];
  // (those of the segment the code writes in: the Default segment's are the ones above)
  let lines: Int32Array = lines0, starts: Uint8Array = starts0, ops: Uint8Array = ops0, fileOf: Uint16Array | undefined = fileOf0;
  const fileNo = (file: string) => { let i = fileNames.indexOf(file); if (i < 0) i = fileNames.push(file) - 1; return i + 1; };
  const mine = (st: Stmt) => all || st.file === entryPath;
  /** the line a byte is said to come from: a macro's is the line that calls it (the outermost call) */
  const site = (st: Stmt) => calls.length ? calls[0].st : st;
  // the segments, Default first (each pass makes them anew; the last pass's are kept for .segmentout and startAfter),
  // the one the code writes in, and the files the build writes
  const noI = new Int32Array(0), noU = new Uint8Array(0);
  const newSeg = (name: string, st: Stmt | null, p: Record<string, Value>, final: boolean, at = 0x2000): Seg => ({
    name, st, p, mem: new Uint8Array(0x10000), written: new Uint8Array(0x10000),
    lines: final ? new Int32Array(0x10000) : noI, starts: final ? new Uint8Array(0x10000) : noU, ops: final ? new Uint8Array(0x10000) : noU,
    ...(all ? { fileOf: final ? new Uint16Array(0x10000) : new Uint16Array(0) } : {}),
    pc: at, begun: false, blocks: [], first: -1, firstN: 0,
  });
  let segs = new Map<string, Seg>(), prevSegs: Map<string, Seg> | null = null, prevEnds = new Map<string, number>();
  let seg: Seg = newSeg('Default', null, {}, false), outFiles: (OutFile & { p: Record<string, Value> })[] = [], outed = new Set<string>(), outDisks: OutDisk[] = [];
  /** bytes written so far in the pass, and how deep in .function calls the code is (a function writes none) */
  let emitted = 0, inFunc = 0;
  let fresh = false;
  const emit = (b: number, st: Stmt) => {
    if (inFunc) throw new Error('A .function cannot write bytes: write them in a .macro');
    b &= 0xff;
    const a = pc - off;
    if (a < 0 || a > 0xffff) { E('program counter past $ffff', st); return; }
    const bl = blocks[blocks.length - 1];
    if (bl && (bl.end == null || a > bl.end)) bl.end = a;
    // a virtual segment's bytes take room and are written nowhere
    if (seg.p.virtual) { fresh = false; pc++; return; }
    if (written[a] && pass === 'final') E(`memory at $${h4(a)} written twice`, st);
    if (first < 0) first = a;
    if (seg.first < 0) { seg.first = a; seg.firstN = emitted; }
    emitted++;
    const at = site(st);
    if (pass === 'final' && mine(at)) { lines[a] = at.line; if (fresh) starts[a] = 1; if (fileOf) fileOf[a] = fileNo(at.file); }
    fresh = false;
    mem[a] = b; written[a] = 1; pc++;
  };
  /** the code writes in segment `s` from here on */
  const useSeg = (s: Seg) => {
    seg.pc = pc;
    seg = s; mem = s.mem; written = s.written; lines = s.lines; starts = s.starts; ops = s.ops; fileOf = s.fileOf; blocks = s.blocks;
    pc = s.pc;
  };
  /** where a segment ends: after its last byte (its start when it has none) */
  const segEnd = (s: Seg) => { let e = -1; for (const b of s.blocks) if (b.end != null && b.end > e) e = b.end; return e < 0 ? s.pc : e + 1; };
  /** the bytes of segments together (those they are made of too, and fill where asked), as a file or .segmentout has
   *  them; two in one address is an error unless allowOverlap */
  const compose = (names: readonly string[], p: Record<string, Value>, what: string, from: Map<string, Seg>, st: Stmt | null, final: boolean, extra: Seg | null = null): Content => {
    const out: Content = { mem: new Uint8Array(0x10000), written: new Uint8Array(0x10000), lines: new Int32Array(0x10000), starts: new Uint8Array(0x10000), ops: new Uint8Array(0x10000), ...(all ? { fileOf: new Uint16Array(0x10000) } : {}), min: -1, max: -1, first: -1, firstN: Infinity, blocks: [] };
    const who = new Int16Array(0x10000), parts: string[] = [], said = new Set<string>(), seen = new Set<string>();
    const fill = (q: Record<string, Value>, part: number) => {
      if (!q.fill || q.min == null || q.max == null) return;
      const fb = q.fillByte == null ? 0 : numberOf(q.fillByte) & 0xff;
      for (let a = Math.max(0, numberOf(q.min)); a <= Math.min(0xffff, numberOf(q.max)); a++) if (!out.written[a]) { out.mem[a] = fb; out.written[a] = 1; who[a] = part; }
    };
    // modify="BasicUpstart", _start=…: Kick Assembler's one modifier puts a BASIC line with SYS _start at $0801
    const upstart = (q: Record<string, Value>, part: number, at: Stmt | null) => {
      if (q.modify == null || q._start == null) return;
      const digits = String(numberOf(q._start)), next = 0x0801 + 6 + digits.length;
      const line = [next & 0xff, next >> 8, 10, 0, 0x9e, ...[...digits].map(c => c.charCodeAt(0)), 0, 0, 0];
      line.forEach((b, i) => {
        const a = 0x0801 + i;
        if (out.written[a] && who[a] !== part && final && !said.has(`up:${part}`)) { said.add(`up:${part}`); E(`In ${what} the BASIC line of the modifier BasicUpstart overlaps '${parts[who[a] - 1]}' at $${h4(a)}`, at ?? st ?? undefined); }
        out.mem[a] = b; out.written[a] = 1; who[a] = part; out.lines[a] = at?.line ?? 0;
      });
    };
    const add = (name: string, depth: number) => {
      const s = from.get(name) ?? (extra?.name === name ? extra : undefined);
      if (!s) { if (final) E(`Undefined segment '${name}' in ${what}`, st ?? undefined); return; }
      if (seen.has(name) || depth > 32) return;
      seen.add(name);
      if (s.p.segments != null) for (const n of String(s.p.segments).split(',').map(x => x.trim()).filter(Boolean)) add(n, depth + 1);
      if (s.p.virtual) return;
      const part = parts.push(name), free = !!(s.p.allowOverlap || p.allowOverlap);
      for (let a = 0; a < 0x10000; a++) {
        if (!s.written[a]) continue;
        if (out.written[a] && !free && who[a] !== part) {
          const k = `${who[a]}:${part}`;
          if (final && !said.has(k)) { said.add(k); E(`In ${what} the segment '${name}' overlaps '${parts[who[a] - 1]}' at $${h4(a)}`, s.st ?? st ?? undefined); }
        }
        out.mem[a] = s.mem[a]; out.written[a] = 1; who[a] = part;
        out.lines[a] = s.lines[a] ?? 0; out.starts[a] = s.starts[a] ?? 0; out.ops[a] = s.ops[a] ?? 0;
        if (out.fileOf && s.fileOf) out.fileOf[a] = s.fileOf[a] ?? 0;
      }
      fill(s.p, part);
      upstart(s.p, part, s.st);
      if (s.first >= 0 && s.firstN < out.firstN) { out.first = s.first; out.firstN = s.firstN; }
      for (const b of s.blocks) if (b.end != null && b.end >= b.start && (b.name || name !== 'Default')) out.blocks.push({ start: b.start, end: b.end, name: b.name || name });
    };
    for (const n of extra ? [...names, extra.name] : names) add(n, 0);
    const own = parts.push(what);
    fill(p, own); upstart(p, own, st);
    for (let a = 0; a < 0x10000; a++) if (out.written[a]) { if (out.min < 0) out.min = a; out.max = a; }
    out.blocks.sort((x, y) => x.start - y.start);
    return out;
  };

  /** `var x = 1`, `x = 1`, `x++`, `x += 2`: a variable declared (in `s`) or set (where it was declared); else the
   *  expression is evaluated (`.eval f()`) */
  const assign = (text: string, s: Scope, st: Stmt) => {
    const m = text.match(/^(var\s+)?([A-Za-z_]\w*)\s*(\+\+|--|[-+*/]?=(?!=))\s*(.*)$/);
    if (!m) { if (text.trim()) ev(P(text), s); return; }
    const [, decl, name, op, rhs] = m;
    if (decl) { if (op !== '=') throw new Error(`var ${name} needs = and a value`); s.vars.set(name, ev(P(rhs), s)); return; }
    let home: Scope | null = s;
    while (home && !home.vars.has(name)) home = home.parent;
    if (!home) {
      if (lookup(name, s) !== undefined) throw new Error(`"${name}" is a label or constant: only a .var can change`);
      throw new Error(`Unknown variable "${name}" (declare it with .var ${name} = …)`);
    }
    const old = home.vars.get(name);
    let v: Value;
    if (op === '++' || op === '--') { if (old == null) return; v = numberOf(old) + (op === '++' ? 1 : -1); }
    else {
      const r = ev(P(rhs), s);
      if (op === '=') v = r;
      else if (old == null || r == null) v = null;
      else if (op === '+=' && (typeof old === 'string' || typeof r === 'string')) v = String(old) + String(r);
      else { const a = numberOf(old), b = numberOf(r); v = op === '+=' ? a + b : op === '-=' ? a - b : op === '*=' ? a * b : (() => { if (!b) throw new Error('division by zero'); return a / b; })(); }
    }
    home.vars.set(name, v);
    void st;
  };

  const runPass = (final: boolean) => {
    prevSegs = segs.size ? segs : null;
    seg = { ...newSeg('Default', null, {}, false, opts.pc ?? 0), lines: lines0, starts: starts0, ops: ops0, fileOf: fileOf0, begun: true };
    segs = new Map([['Default', seg]]); outFiles = []; outed = new Set(); outDisks = [];
    mem = seg.mem; written = seg.written; blocks = seg.blocks; lines = lines0; starts = starts0; ops = ops0; fileOf = fileOf0;
    pc = opts.pc ?? 0; off = 0; outer = []; enc = 'screencode_mixed'; unresolved = []; first = -1;
    calls = []; inFunc = 0; emitted = 0;
    mlPrev = ml; ml = [];
    root.vars.clear(); cur = root;
    let changed = false;
    const define = (name: string, v: Value, st: Stmt, s: Scope = cur) => {
      const k = keyOf(s, name);
      if (final && syms.has(k) && syms.get(k) !== v && typeof v === 'number') E(`symbol "${name}" changed value in the final pass`, st);
      if (syms.get(k) !== v) changed = true;
      syms.set(k, v);
      // a label of a named scope can be reached from the scope around it as `scope.label` (a macro call's: from where
      // it is called)
      const home = s.home ?? s.parent;
      if (s.name && home) define(`${s.name}.${name}`, v, st, home);
    };

    // ---- macros, functions, pseudo commands ----
    const ids = callIds;
    const callKey = (st: Stmt) => { let i = ids.get(st); if (i == null) { i = ids.size; ids.set(st, i); } return `c${i}`; };
    const deep = (name: string) => { if (calls.length >= 100) throw new Error(`Calls nested ${calls.length} deep at ${name}: does a macro or function call itself without end?`); };
    /** a macro or pseudo command run with its parameters: a scope of its own under the top level (a label before the
     *  call names it), its bytes the call's line's */
    const invoke = (def: Def, args: Value[], st: Stmt) => {
      deep(def.name);
      const was = cur, named = st.label && st.label[0] !== '!' ? st.label : undefined;
      cur = { key: `${was.key}>${callKey(st)}`, vars: new Map(def.params.map((p, i) => [p, args[i]])), parent: root, ...(named ? { name: named, home: was } : {}) };
      calls.push({ name: def.kind === 'macro' ? `${def.name}()` : def.name, st });
      try { run(def.body); } finally { cur = was; calls.pop(); }
    };
    callFunc = (name, args) => {
      const byN = funcs.get(name)!, def = byN.get(args.length);
      if (!def) throw new Error(`Invalid number of arguments for the function ${name}: it takes ${[...byN.keys()].join(' or ')}, not ${args.length}`);
      deep(name);
      const was = cur, wasStmt = curStmt, wasUnresolved = unresolved, wasFresh = fresh;
      cur = { key: `${was.key}>f`, vars: new Map(def.params.map((p, i) => [p, args[i]])), parent: root };
      unresolved = []; inFunc++;
      calls.push({ name: `${name}()`, st: wasStmt ?? def.st });
      try { run(def.body); return null; }
      catch (err) { if (err instanceof Ret) return err.v; throw err; }
      finally { cur = was; curStmt = wasStmt; fresh = wasFresh; unresolved = wasUnresolved.concat(unresolved); inFunc--; calls.pop(); }
    };
    /** a pseudo command's argument as it is written: `#1`, `$d020,x`, `($fb),y` … */
    const argOf = (text: string): CmdArg => {
      const t = text.trim(); let m: RegExpMatchArray | null;
      if (!t) return cmdArg(AT.AT_NONE, null);
      if (t[0] === '#') return cmdArg(AT.AT_IMMEDIATE, ev(P(t.slice(1))));
      if ((m = t.match(/^\((.+),\s*[xX]\s*\)$/))) return cmdArg(AT.AT_IZEROPAGEX, ev(P(m[1])));
      if ((m = t.match(/^\((.+)\)\s*,\s*[yY]$/))) return cmdArg(AT.AT_IZEROPAGEY, ev(P(m[1])));
      if ((m = t.match(/^(.+),\s*([xXyY])$/))) return cmdArg(m[2].toLowerCase() === 'x' ? AT.AT_ABSOLUTEX : AT.AT_ABSOLUTEY, ev(P(m[1])));
      if (t[0] === '(' && closeAt(t, 0) === t.length) return cmdArg(AT.AT_INDIRECT, ev(P(t.slice(1, -1))));
      return cmdArg(AT.AT_ABSOLUTE, ev(P(t)));
    };

    // ---- segments ----
    /** `start=$1000, fill, segments="A,B"`: each parameter's value (a name alone is true) */
    const paramsOf = (text: string): Record<string, Value> => {
      const p: Record<string, Value> = {};
      for (const part of splitTop(text, ',').filter(Boolean)) {
        const m = part.match(/^([A-Za-z_]\w*)\s*(?:=\s*(.+))?$/);
        if (!m) throw new Error(`bad parameter "${part}"`);
        p[m[1]] = m[2] == null ? true : ev(P(m[2]));
      }
      return p;
    };
    /** `[…]` at the start of `s` and what comes after it */
    const bracket = (s: string): { p: Record<string, Value> | null; rest: string } => {
      const t = s.trim();
      if (t[0] !== '[') return { p: null, rest: t };
      const k = closeAt(t, 0); if (k < 0) throw new Error('missing ] after the parameters');
      return { p: paramsOf(t.slice(1, k - 1)), rest: t.slice(k).trim() };
    };
    const checkParams = (p: Record<string, Value>, allowed: Set<string>, what: string) => {
      for (const k of Object.keys(p)) {
        if (k[0] === '_' && 'modify' in p) continue;
        if (!allowed.has(k)) throw new Error(`Unknown parameter "${k}" of ${what}`);
      }
      if ('modify' in p) {
        if (String(p.modify) !== 'BasicUpstart') throw new Error(`Mimir's check cannot run the modifier "${p.modify}" of ${what}: only BasicUpstart is Kick Assembler's own, others are plugins (Run builds with Kick Assembler)`);
        if (!('_start' in p)) throw new Error(`The modifier BasicUpstart of ${what} needs _start (the address its SYS goes to)`);
      }
      if (p.fill && (!('min' in p) || !('max' in p))) throw new Error("Can't use fill without both min and max");
    };
    /** the PRGs (where they load) and SIDs (their data where it loads) a segment, or a file of a disk, is given */
    const giveFiles = (s: Seg, p: Record<string, Value>, st: Stmt) => {
      for (const k of ['prgFiles', 'sidFiles'] as const) if (p[k] != null) for (const f of listOf(p[k])) {
        const u = vfs[importPath(vfs, st.file, f)];
        if (!(u instanceof Uint8Array)) { E(`Can't open file "${f}"`, st); continue; }
        let load: number, data: Uint8Array;
        if (k === 'prgFiles') { load = u[0] | (u[1] << 8); data = u.subarray(2); } else { const sid = parsePsid(u); load = sid.location; data = sid.data; }
        const was = seg; useSeg(s); pc = load; blocks.push({ start: load, name: f.replace(/^.*[\\/]/, '') });
        for (const b of data) emit(b, st);
        useSeg(was);
      }
    };
    const defineSeg = (name: string, p: Record<string, Value>, st: Stmt): Seg => {
      if (segs.has(name)) throw new Error(`The segment '${name}' is already defined`);
      checkParams(p, SEG_PARAMS, `the segment ${name}`);
      const s = newSeg(name, st, p, final);
      segs.set(name, s);
      for (const k of ['outPrg', 'outBin'] as const) if (p[k] != null) outFiles.push({ name: String(p[k]), type: k === 'outPrg' ? 'prg' : 'bin', segments: [name], st, p: {} });
      giveFiles(s, p, st);
      return s;
    };
    /** a segment's first `.segment` in the pass: its program counter from start, startAfter (and align), else $2000 */
    const begin = (s: Seg) => {
      s.begun = true;
      let start: number | null = s.p.start != null ? numberOf(s.p.start) : null;
      if (start == null && s.p.startAfter != null) {
        const ref = String(s.p.startAfter), r = segs.get(ref) ?? prevSegs?.get(ref);
        const end = prevEnds.get(ref) ?? (r ? segEnd(r) : null);
        if (end == null) throw new Error(`The segment '${s.name}' starts after '${ref}', which is not defined`);
        start = end;
        const al = s.p.align != null ? numberOf(s.p.align) : 0;
        if (al > 0) start = Math.ceil(start / al) * al;
      }
      if (start != null) s.pc = start;
    };
    const defs = new Set<string>();
    const label = (st: Stmt) => {
      if (!st.label) return;
      if (st.label[0] === '!') { ml.push({ name: st.label.slice(1), v: pc }); return; }
      const k = keyOf(cur, st.label);
      if (defs.has(k)) E(`label "${st.label}" defined twice`, st);
      defs.add(k); define(st.label, pc, st);
    };
    let rounds = 0;
    const inScope = (key: string, name: string | undefined, body: Tree[]) => {
      const was = cur; cur = { key, vars: new Map(), parent: was, ...(name ? { name } : {}) };
      try { run(body); } finally { cur = was; }
    };
    const run = (nodes: Tree[]): void => { for (const n of nodes) { if (n.k === 'st') stmt(n.st); else block(n); } };
    /** in the final pass a name still unknown is an error of the statement (or block header) that uses it */
    const report = (st: Stmt) => { if (final && unresolved.length) { for (const u of new Set(unresolved)) E(`Unknown symbol "${u}"`, st); unresolved = []; } };
    const block = (b: Extract<Tree, { k: 'blk' }>) => {
      const st = b.st;
      curStmt = st;
      try {
        label(st);
        const key = `${cur.key}>${b.id}`;
        switch (b.kind) {
          case 'scope': inScope(key, st.label && st.label[0] !== '!' ? st.label : undefined, b.body); return;
          case 'disk': {
            const { p, rest } = bracket(b.head);
            if (!p || rest || p.filename == null) throw new Error('.disk needs its parameters: .disk [filename="game.d64", name="GAME", id="2025!"] { [name="GAME", type="prg", segments="Code"], … }');
            checkParams(p, DISK_PARAMS, '.disk');
            const text = b.body.map(n => (n.k === 'st' ? n.st.body : '')).join(' '), files: OutDisk['files'] = [];
            for (let i = 0; i < text.length;) {
              if (/[\s,]/.test(text[i])) { i++; continue; }
              if (text[i] !== '[') throw new Error(`a file of .disk is written [name="…", type="prg", segments="…"], not "${text.slice(i, i + 24)}"`);
              const k = closeAt(text, i); if (k < 0) throw new Error('missing ] after a file of .disk');
              const fp = paramsOf(text.slice(i + 1, k - 1)); i = k;
              checkParams(fp, DISK_FILE_PARAMS, `the file "${fp.name ?? ''}" of ${p.filename}`);
              if (fp.name == null) throw new Error(`a file of ${p.filename} needs its name: [name="…", …]`);
              let extra: Seg | null = null;
              if (fp.prgFiles != null || fp.sidFiles != null) { extra = newSeg(`<<${p.filename}:${files.length}>>`, st, {}, final); giveFiles(extra, fp, st); }
              files.push({ p: fp, extra });
            }
            outDisks.push({ p, files, st });
            return;
          }
          case 'pseudopc': {
            const v = evn(P(b.head)); report(st); outer.push(off); if (v != null) { off += v - pc; pc = v; }
            try { run(b.body); } finally { const was = outer.pop()!; pc -= off - was; off = was; }
            return;
          }
          case 'if': {
            const c = evb(b.head); report(st);
            if (c === true) inScope(`${key}t`, undefined, b.body);
            else if (c === false && b.els) inScope(`${key}e`, undefined, b.els);
            return;
          }
          case 'for': case 'while': {
            const parts = b.kind === 'for' ? splitTop(b.head, ';') : ['', b.head, ''];
            if (parts.length !== 3) throw new Error('.for needs (init; condition; step)');
            const loop: Scope = { key, vars: new Map(), parent: cur };
            for (const a of splitArgs(parts[0])) assign(a, loop, st);
            report(st);
            for (let n = 0; ; n++) {
              curStmt = st;
              const c = parts[1] ? evb(parts[1], loop) : true;
              report(st);
              if (c !== true) break;
              if (++rounds > 1_000_000) throw new Error(`.${b.kind} went round a million times: does its condition ever turn false?`);
              const was = cur; cur = { key: `${key}#${n}`, vars: new Map(), parent: loop };
              try { run(b.body); } finally { cur = was; }
              for (const a of splitArgs(parts[2])) assign(a, loop, st);
              report(st);
            }
            return;
          }
        }
      } catch (err) { if (err instanceof Ret) throw err; E((err as Error).message, st); report(st); }
    };
    const stmt = (st: Stmt) => {
      curStmt = st;
      fresh = true;
      try {
        label(st);
        const s = st.body;
        if (!s) return;
        let m: RegExpMatchArray | null;
        if ((m = s.match(/^(?:\.pc|\*)\s*=\s*(.+?)(?:\s+"([^"]*)")?$/))) {
          if (outer.length) { E('.pc inside .pseudopc', st); return; }
          const v = evn(P(m[1])); if (v != null) pc = v; blocks.push({ start: pc, name: m[2] || '' }); return;
        }
        if ((m = s.match(/^\.(label|const)\s+([A-Za-z_]\w*)\s*=\s*(.+)$/))) { const v = ev(P(m[3])); if (v != null) define(m[2], v, st); return; }
        if ((m = s.match(/^\.var\s+([A-Za-z_]\w*)\s*=\s*(.+)$/))) { cur.vars.set(m[1], ev(P(m[2]))); return; }
        if ((m = s.match(/^\.eval\s+(.+)$/))) { assign(m[1].trim(), cur, st); return; }
        if ((m = s.match(/^\.(print|printnow|error)\s+(.+)$/))) {
          const v = ev(P(m[2]));
          if (final) { const text = v == null ? '(not known)' : typeof v === 'number' ? String(v) : String(v); if (m[1] === 'error') E(text, st); else prints.push(text); }
          return;
        }
        if ((m = s.match(/^\.encoding\s+"([^"]+)"$/))) { if (!ENCODINGS[m[1]]) E(`unknown encoding "${m[1]}"`, st); enc = m[1]; return; }
        if ((m = s.match(/^\.cpu\b/))) return;
        if ((m = s.match(/^\.return\b\s*(.*)$/))) {
          if (!inFunc) { E('.return outside a .function', st); return; }
          throw new Ret(m[1] ? ev(P(m[1])) : null);
        }
        // segments: defined, gone to, written to files
        if ((m = s.match(/^\.segmentdef\s+([A-Za-z_]\w*)\s*(.*)$/))) {
          const { p, rest } = bracket(m[2]);
          if (rest) throw new Error(`unexpected "${rest}" after .segmentdef ${m[1]}`);
          defineSeg(m[1], p ?? {}, st);
          return;
        }
        if ((m = s.match(/^\.segment\s+([A-Za-z_]\w*)\s*(.*)$/))) {
          if (outer.length) { E('.segment inside .pseudopc', st); return; }
          const { p, rest } = bracket(m[2]), name = rest.match(/^"([^"]*)"$/);
          if (rest && !name) throw new Error(`unexpected "${rest}" after .segment ${m[1]}`);
          const t = p ? defineSeg(m[1], p, st) : segs.get(m[1]);
          if (!t) throw new Error(`Undefined segment '${m[1]}'`);
          useSeg(t);
          if (!t.begun) { begin(t); pc = t.pc; blocks.push({ start: pc, name: name ? name[1] : t.name }); }
          else if (name) blocks.push({ start: pc, name: name[1] });
          return;
        }
        if ((m = s.match(/^\.memblock\s+"([^"]*)"$/))) { blocks.push({ start: pc, name: m[1] }); return; }
        if ((m = s.match(/^\.file\s*(.*)$/))) {
          const { p, rest } = bracket(m[1]);
          if (!p || rest || p.name == null || p.segments == null) throw new Error('.file needs a name and its segments: .file [name="game.prg", segments="Code,Data"]');
          checkParams(p, new Set([...SEG_PARAMS, 'name', 'type', 'mbfiles']), '.file');
          const type = p.type == null ? 'prg' : String(p.type);
          if (type !== 'prg' && type !== 'bin') throw new Error(`.file writes type "prg" or "bin", not "${type}"`);
          outFiles.push({ name: String(p.name), type, segments: listOf(p.segments), st, p });
          return;
        }
        if ((m = s.match(/^\.segmentout\s*(.*)$/))) {
          const { p, rest } = bracket(m[1]);
          if (!p || rest || p.segments == null) throw new Error('.segmentout needs its segments: .segmentout [segments="Code"]');
          checkParams(p, SEG_PARAMS, '.segmentout');
          const names = listOf(p.segments);
          for (const n of names) outed.add(n);
          // the segments as the last pass left them (one that comes later in the code is not written yet)
          const from = prevSegs && names.every(n => prevSegs!.has(n)) ? prevSegs : segs;
          const c = compose(names, p, '.segmentout', from, st, final);
          if (c.min >= 0) for (let a = c.min; a <= c.max; a++) emit(c.mem[a], st);
          return;
        }
        if (/^\.disk\b/.test(s)) { E('.disk needs its files in { }: .disk [filename="game.d64"] { [name="GAME", segments="Code"] }', st); return; }
        if (/^\.(modify|filemodify)\b/.test(s)) { E(`Mimir's check cannot run a modifier plugin (${s.split(/\s/)[0]}): Kick Assembler has none of its own, they are Java plugins (Run builds with Kick Assembler)`, st); return; }
        // a macro called: `name(1, 2)` (or `:name(1, 2)`)
        // (Kick Assembler's own BasicUpstart and BasicUpstart2, of its autoinclude.asm, below, unless the code has its own)
        if ((m = s.match(/^:?([A-Za-z_]\w*)\s*\((.*)\)$/)) && !(/^BasicUpstart2?$/.test(m[1]) && !macros.has(m[1])) && !(ENC[m[1].toUpperCase()] && s[0] !== ':' && !macros.has(m[1]))) {
          const def = macros.get(m[1]);
          if (!def) { E(funcs.has(m[1]) ? `${m[1]}() is a function: use its value (.eval ${m[1]}(…))` : `Unknown macro "${m[1]}"`, st); return; }
          const args = splitArgs(m[2]).map(a => ev(P(a)));
          if (args.length !== def.params.length) { E(`Invalid number of arguments for macro ${m[1]}: it takes ${def.params.length}, not ${args.length}`, st); return; }
          invoke(def, args, st);
          return;
        }
        // a pseudo command: `mov #1 : $d020`
        if ((m = s.match(/^([A-Za-z_]\w*)(?:\s+(.*))?$/)) && pseudos.has(m[1])) {
          const def = pseudos.get(m[1])!, parts = m[2] ? splitTop(m[2], ':') : [];
          if (parts.length > def.params.length) { E(`Invalid number of arguments for the pseudo command ${m[1]}: it takes ${def.params.length}, not ${parts.length}`, st); return; }
          invoke(def, def.params.map((_, i) => argOf(parts[i] ?? '')), st);
          return;
        }
        // BasicUpstart(address): a BASIC line `10 SYS address` where the program counter is; BasicUpstart2 puts it at
        // $0801 (both as Kick Assembler's autoinclude.asm has them; `:BasicUpstart2(…)` too)
        if ((m = s.match(/^:?(BasicUpstart2?)\s*\((.+)\)$/))) {
          const two = m[1] === 'BasicUpstart2', v = evn(P(m[2])) ?? 0x1000;
          if (two) { pc = 0x0801; blocks.push({ start: pc, name: 'Basic Upstart' }); }
          const digits = String(v); const endL = pc + 6 + digits.length;
          emit(endL & 0xff, st); emit(endL >> 8, st); emit(10, st); emit(0, st); emit(0x9e, st);
          for (const c of digits) emit(c.charCodeAt(0), st);
          emit(0, st); emit(0, st); emit(0, st);
          // as KickAss 5.25's macro: `.pc = $080e "Basic End"` after the line (code after a SYS with four digits starts
          // a byte after the line's end)
          if (two && pc < 0x080e) pc = 0x080e;
          return;
        }
        if ((m = s.match(/^\.(byte|by|word|wo|text|fill|import\s+binary|align)\b\s*(.*)$/))) {
          const dir = m[1].replace(/\s+/g, ' '), args = splitArgs(m[2]);
          if (dir === 'byte' || dir === 'by') for (const a of args) { const v = evn(P(a)); emit(v ?? 0, st); }
          else if (dir === 'word' || dir === 'wo') for (const a of args) { const v = evn(P(a)) ?? 0; emit(v & 0xff, st); emit((v >> 8) & 0xff, st); }
          else if (dir === 'text') for (const a of args) { const v = ev(P(a)); if (typeof v === 'string') for (const c of v) emit(ENCODINGS[enc](c), st); else if (v != null) E('.text expects a string', st); }
          else if (dir === 'fill') {
            const n = evn(P(args[0])); const node = P(args[1] || '0'); if (n == null) return;
            const sc: Scope = { key: cur.key, vars: new Map(), parent: cur };
            for (let i = 0; i < n; i++) { sc.vars.set('i', i); emit(evn(node, sc) ?? 0, st); }
          }
          else if (dir === 'align') { const n = evn(P(args[0])); if (n) while (pc % n) emit(0, st); }
          else if (dir === 'import binary') { const path = ev(P(args[0])); const u = vfs[importPath(vfs, st.file, path)]; if (!(u instanceof Uint8Array)) { E(`Can't open binary file "${path}"`, st); return; } const o = args[1] ? evn(P(args[1])) ?? 0 : 0; const len = args[2] ? evn(P(args[2])) ?? 0 : u.length - o; for (let i = 0; i < len; i++) emit(u[o + i], st); }
          return;
        }
        // (the operand right after the mnemonic when it starts with # $ or %, as Kick Assembler takes it: lda#$35, sta$01)
        if ((m = s.match(/^([A-Za-z]{3})(?:\.([A-Za-z]+))?(?:\s+(.*)|([#$%].*))?$/)) && ENC[m[1].toUpperCase()]) {
          const mn = m[1].toUpperCase(), ext = (m[2] || '').toLowerCase(), arg = (m[3] ?? m[4] ?? '').trim();
          const modes = ENC[mn]!;
          let mode: string, ex: string | null = null;
          if (!arg) mode = IMPLIED_ACC.has(mn) ? 'acc' : 'imp';
          else if (arg[0] === '#') { mode = 'imm'; ex = arg.slice(1); }
          else if ((m = arg.match(/^\((.+),\s*[xX]\s*\)$/))) { mode = 'izx'; ex = m[1]; }
          else if ((m = arg.match(/^\((.+)\)\s*,\s*[yY]$/))) { mode = 'izy'; ex = m[1]; }
          else if ((m = arg.match(/^\((.+)\)$/)) && mn === 'JMP') { mode = 'ind'; ex = m[1]; }
          else if ((m = arg.match(/^(.+),\s*([xXyY])$/))) { ex = m[1]; mode = m[2].toLowerCase(); }
          else { ex = arg; mode = 'plain'; }
          // Kick Assembler only allows a forced mode where it can choose between zero page and absolute
          if ((mode === 'izy' && (ext === 'zp' || ext === 'z')) || ((mode === 'izx' || mode === 'izy') && (ext === 'abs' || ext === 'a'))) {
            E(`Cannot force ${ext === 'zp' || ext === 'z' ? 'zeropage' : 'absolute'} mode on an argument of type ${mode === 'izy' ? 'indirectZeropageY' : 'indirectZeropageX'}`, st); return;
          }
          const raw = ex != null ? ev(P(ex)) : null;
          let v: number | null;
          // a pseudo command's argument (or a CmdArgument) brings its addressing mode: `lda src` with src = #1 is lda #1
          if (isCmd(raw)) {
            const want = CMD_MODE[raw.type];
            if (raw.type === AT.AT_NONE) mode = IMPLIED_ACC.has(mn) ? 'acc' : 'imp';
            else if (mode === 'plain') mode = want ?? 'plain';
            else if (raw.type !== AT.AT_ABSOLUTE) throw new Error(`an argument written ${want === 'imm' ? '#…' : `as ${want}`} cannot take ,${mode} too`);
            v = raw.value == null ? null : numberOf(raw.value);
          } else v = raw == null ? null : numberOf(raw);
          if (BRANCHES.has(mn)) mode = 'rel';
          else if (mode === 'plain' || mode === 'x' || mode === 'y') {
            const suf = mode === 'plain' ? '' : mode;
            const forceZp = ext === 'zp' || ext === 'z', forceAbs = ext === 'abs' || ext === 'a';
            const zpOk = modes[('zp' + suf) as AddrMode] !== undefined, absOk = modes[('ab' + (suf || 's')) as AddrMode] !== undefined;
            const wantZp = forceZp || (!forceAbs && v != null && v >= 0 && v < 0x100);
            mode = (wantZp && zpOk) ? 'zp' + suf : absOk ? (suf ? 'ab' + suf : 'abs') : 'zp' + suf;
          }
          // (an immediate value takes its low byte: KickAss 5.25 writes lda #$1234 as a9 34)
          const op = modes[mode as AddrMode];
          if (op === undefined) { E(`${mn.toLowerCase()} does not support this addressing mode (${mode})`, st); return; }
          emit(op, st);
          if (pass === 'final' && mine(site(st)) && !seg.p.virtual) ops[(pc - off - 1) & 0xffff] = 1;
          const len = MODE_LEN[mode as AddrMode];
          if (mode === 'rel') {
            const o = v == null ? 0 : v - (pc + 1);
            if (final && (o < -128 || o > 127)) E(`branch out of range (${o})`, st);
            emit(o & 0xff, st);
          } else if (len === 2) { if (final && v != null && mode !== 'imm' && (v < -128 || v > 255)) E(`value $${(v >>> 0).toString(16)} does not fit in a byte`, st); emit(v ?? 0, st); }
          else if (len === 3) { emit((v ?? 0) & 0xff, st); emit(((v ?? 0) >> 8) & 0xff, st); }
          return;
        }
        E(`unsupported statement: ${s}`, st);
      } catch (err) { if (err instanceof Ret) throw err; E((err as Error).message, st); }
      finally { report(st); }
    };
    run(tree);
    // a segment that moved (startAfter another that grew) takes another pass
    useSeg(seg);
    const ends = new Map([...segs].map(([k, s]) => [k, segEnd(s)] as const));
    const moved = [...ends].some(([k, e]) => prevEnds.get(k) !== e);
    prevEnds = ends;
    return changed || moved;
  };
  for (pass = 1; pass <= 12; pass++) { const ch = runPass(false); if (!ch && !unresolved.length && pass > 1) break; }
  pass = 'final';
  runPass(true);
  // the program: <main>.prg, the Default segment; when the code has segments and Default is empty, the file a .file (or
  // an outPrg) writes, the one called <main>.prg first (the build takes that file then)
  const dflt = segs.get('Default')!;
  let out: Pick<Content, 'mem' | 'written' | 'lines' | 'starts' | 'ops' | 'fileOf' | 'first'> & { blocks: AsmBlock[] | null } = { mem: dflt.mem, written: dflt.written, lines: lines0, starts: starts0, ops: ops0, fileOf: fileOf0, first, blocks: null };
  let programFile: string | null = null, fileContents: Content[] = [];
  const usesSegs = segs.size > 1 || outFiles.length > 0 || outDisks.length > 0;
  // the files the build writes besides <main>.prg (a .file with mbfiles: one per memory block, name_block.prg), and the
  // disk images
  const outList: { name: string; type: 'prg' | 'bin'; segments: string[]; c: Content; st: Stmt }[] = [];
  const diskList: { name: string; image: Uint8Array | null; first: Content | null }[] = [];
  if (usesSegs) {
    const base = entryPath.replace(/^.*[\\/]/, '').replace(/\.[^.]*$/, '') + '.prg';
    // (every file put together: two segments over each other in one is an error)
    for (const f of outFiles) {
      const c = compose(f.segments, f.p, `the file '${f.name}'`, segs, f.st, true);
      if (!f.p.mbfiles) { outList.push({ name: f.name, type: f.type, segments: f.segments, c, st: f.st }); continue; }
      const dot = f.name.lastIndexOf('.'), stem = dot > 0 ? f.name.slice(0, dot) : f.name, ext = dot > 0 ? f.name.slice(dot) : '';
      for (const b of c.blocks) {
        const written = new Uint8Array(0x10000); written.set(c.written.subarray(b.start, b.end + 1), b.start);
        outList.push({ name: `${stem}_${b.name}${ext}`, type: f.type, segments: f.segments, c: { ...c, written, min: b.start, max: b.end, blocks: [b] }, st: f.st });
      }
    }
    fileContents = outList.map(o => o.c);
    // the disk images: each file's bytes (with the address it loads at unless noStartAddr, which a PRG has not), then
    // the image as Kick Assembler lays it out
    for (const d of outDisks) {
      const name = String(d.p.filename), interleave = d.p.interleave == null ? 10 : numberOf(d.p.interleave);
      let first: Content | null = null;
      try {
        if (interleave < 0) throw new Error(`Interleave can't be negative: ${interleave}`);
        const format = String(d.p.format ?? 'commodore').toLowerCase() as KickDiskFormat;
        if (!['commodore', 'speeddos', 'dolphindos'].includes(format)) throw new Error(`Unknown format: ${d.p.format}`);
        const files: KickDiskFile[] = d.files.map(f => {
          let type = String(f.p.type ?? 'prg'), locked = false;
          if (type.endsWith('<')) { locked = true; type = type.slice(0, -1); }
          const t = KICK_DISK_TYPES[type.toLowerCase()];
          if (t == null) throw new Error(`Unknown type: ${type}`);
          const fi = f.p.interleave == null ? interleave : numberOf(f.p.interleave);
          if (fi < 0) throw new Error(`Interleave can't be negative: ${fi}`);
          const c = compose(f.p.segments == null ? [] : listOf(f.p.segments), f.p, `the file '${f.p.name}' of ${name}`, segs, d.st, true, f.extra);
          const noStart = f.p.noStartAddr == null ? t !== KICK_DISK_TYPES.prg : !!f.p.noStartAddr;
          const body = c.min < 0 ? new Uint8Array(0) : c.mem.subarray(c.min, c.max + 1);
          const data = c.min < 0 ? body : noStart ? body.slice() : Uint8Array.from([c.min & 0xff, c.min >> 8, ...body]);
          if (!first && t === KICK_DISK_TYPES.prg && !f.p.hide && c.min >= 0) first = c;
          return { name: kickBytes(String(f.p.name)), type: t, interleave: fi, data, locked, visible: !f.p.hide };
        });
        const image = kickD64({ format, name: kickBytes(String(d.p.name ?? 'UNNAMED')), id: kickBytes(String(d.p.id ?? '   2A')), files, dontSplitFilesOverDir: !!d.p.dontSplitFilesOverDir, storeFilesInDir: !!d.p.storeFilesInDir });
        diskList.push({ name, image, first });
        if (d.p.showInfo) prints.push(`Info for disk '${d.p.name ?? 'UNNAMED'}'`);
      } catch (err) { E(`Error while generating '${name}': ${(err as Error).message}`, d.st); diskList.push({ name, image: null, first: null }); }
    }
    const named = outList.find(f => f.type === 'prg' && f.name.toLowerCase() === base.toLowerCase());
    let c: Content | null = null;
    if (dflt.first >= 0) {
      if (named) E(`Can't output default segment since a file called '${base}' already exist`, named.st);
      c = compose(['Default'], {}, base, segs, null, true); programFile = base;
    } else {
      const o = named ?? outList.find(f => f.type === 'prg');
      if (o) { c = o.c; programFile = o.name; }
      // else the first PRG on the first disk that has one: what VICE starts of the disk
      else { const d = diskList.find(x => x.first); if (d) { c = d.first; programFile = d.name; } }
    }
    if (c) out = { mem: c.mem, written: c.written, lines: c.lines, starts: c.starts, ops: c.ops, fileOf: c.fileOf, first: c.first, blocks: c.blocks };
    // a segment with bytes that no file has: Kick Assembler writes it nowhere
    const inFile = new Set<string>(['Default']);
    const take = (n: string, d: number) => { if (d > 32 || inFile.has(n) && d) return; inFile.add(n); const s = segs.get(n); if (s?.p.segments != null) for (const x of listOf(s.p.segments)) take(x, d + 1); };
    for (const f of outFiles) for (const n of f.segments) take(n, 0);
    for (const d of outDisks) for (const f of d.files) if (f.p.segments != null) for (const n of listOf(f.p.segments)) take(n, 0);
    for (const n of outed) take(n, 0);
    for (const s of segs.values()) {
      if (inFile.has(s.name) || s.first < 0 || s.p.virtual || !s.st) continue;
      warnings.push({ msg: `The segment '${s.name}' is in no file: Kick Assembler writes ${base} from the Default segment only (name it in a .file [segments="${s.name}"], or give it outPrg="…")`, file: s.st.file, line: s.st.line });
    }
  }
  let min = -1, max = -1;
  for (let a = 0; a < 0x10000; a++) if (out.written[a]) { if (min < 0) min = a; max = a; }
  const blockList: AsmBlock[] = out.blocks ?? dflt.blocks.filter(b => b.name).map((b, i, arr) => ({ start: b.start, name: b.name, end: i + 1 < arr.length ? arr[i + 1].start - 1 : max }));
  let prg: Uint8Array | null = null;
  if (min >= 0) { prg = new Uint8Array(max - min + 3); prg[0] = min & 0xff; prg[1] = min >> 8; prg.set(out.mem.subarray(min, max + 1), 2); }
  // an error a loop met in each round is said once
  const said = new Set<string>();
  const once = errors.filter(e => { const k = `${e.file}:${e.line}:${e.msg}`; if (said.has(k)) return false; said.add(k); return true; });
  const bytesOf = (c: Content | undefined, type: 'prg' | 'bin'): Uint8Array | null => {
    if (!c || c.min < 0) return null;
    const body = c.mem.subarray(c.min, c.max + 1);
    return type === 'bin' ? body.slice() : Uint8Array.from([c.min & 0xff, c.min >> 8, ...body]);
  };
  const files: NonNullable<AssembleResult['files']> = [
    ...outList.map((f, i) => ({ name: f.name, type: f.type, segments: f.segments, bytes: bytesOf(fileContents[i], f.type) })),
    ...diskList.map(d => ({ name: d.name, type: 'd64' as const, segments: [], bytes: d.image })),
  ];
  return {
    mem: out.mem, written: out.written, min, max, errors: once, prg, blocks: blockList, symbols: syms, vars: new Map(root.vars), prints, first: out.first, external,
    lines: out.lines, starts: out.starts, ops: out.ops, ...(out.fileOf ? { fileOf: out.fileOf, fileNames } : {}),
    ...(warnings.length ? { warnings } : {}), ...(usesSegs ? { files, programFile } : {}),
  };
}
