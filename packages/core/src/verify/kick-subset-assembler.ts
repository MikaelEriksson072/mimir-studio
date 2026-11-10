/* =====================================================================
 * Assembles the Kick Assembler subset that the generator emits
 * (#import, #define/#if/#else/#endif, .pc/*=, .pseudopc { }, .label/.const/.var, .byte/.word/.text/.encoding, `@"\$93"` strings,
 * .fill with expressions, .import binary, LoadSid, BasicUpstart2, every
 * addressing mode, .abs/.zp, multi-pass resolution), and what code the user writes in patches and scripts uses besides:
 * multi-labels (`!loop:`, `!:`, `bne !-`, `jmp !loop+`), scopes (`{ }`, `name: { }` read as `name.label`), .if/else,
 * .for, .while, .eval, .print, .error, comparisons, `&&` `||` `!` `~`, `? :`, `[ ]` as parentheses, char literals,
 * floating-point arithmetic and the math functions. Measured against KickAss 5.25: `<` and `>` take all of the
 * expression after them (`<label+1` is the low byte of label+1), `{ }` of .if, .for, .while and a plain block open a
 * scope whose labels the code outside does not see (each .for or .while round its own), `.pseudopc { }` does not, and
 * a condition must be true or false. The desktop app and the CLI can additionally run the real KickAss.jar.
 * ===================================================================== */
import type { AsmBlock, AsmError, AssembleResult, Vfs } from '../types';
import { BRANCHES, ENC, MODE_LEN, type AddrMode } from '../cpu/opcodes';
import { parsePsid } from '../c64/psid';
import { h4 } from '../util/hex';

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

const typeName = (v: Value) => typeof v === 'boolean' ? 'boolean' : typeof v === 'string' ? 'string' : typeof v === 'number' ? 'number' : 'object';
/** a value that goes into bytes or an address: a number (a boolean or a string is an error, as in Kick Assembler) */
const numberOf = (v: Value): number => {
  if (typeof v === 'number') { if (!Number.isFinite(v)) throw new Error(`${v} is not a number that fits in memory`); return Math.trunc(v); }
  throw new Error(`Can't get a number from a value of type ${typeName(v)}`);
};
const isBool = (v: Value): v is boolean => typeof v === 'boolean';

export interface AssembleOptions {
  /** names the code may use without defining them (the program's labels, the hardware's): the code's own win */
  names?: ReadonlyMap<string, number>;
  /** where the program counter starts before the first .pc (0 when missing) */
  pc?: number;
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
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** a statement of the code, or a block of statements (a scope, `.pseudopc`, `.if`, `.for`, `.while`) */
type Tree =
  | { k: 'st'; st: Stmt }
  | { k: 'blk'; id: number; st: Stmt; kind: 'scope' | 'pseudopc' | 'if' | 'for' | 'while'; head: string; body: Tree[]; els?: Tree[] };

/** where names are looked up: a block's own variables and labels, then the blocks around it */
interface Scope { key: string; vars: Map<string, Value>; parent: Scope | null; name?: string }

export function assemble(vfs: Vfs, entryPath: string, opts: AssembleOptions = {}): AssembleResult {
  const errors: AsmError[] = [];
  const E = (msg: string, st?: Stmt) => errors.push({ msg, file: st ? st.file : entryPath, line: st ? st.line : 0 });
  const stmts: Stmt[] = [];
  // preprocessor: #define/#undef and #if/#elif/#else/#endif over defined symbols (!, &&, ||, parentheses)
  const defines = new Set<string>();
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
  const loadFile = (path: string, depth: number) => {
    const src = vfs[path];
    if (typeof src !== 'string') { E(`Can't open file "${path}"`); return; }
    if (depth > 16) { E(`#import nested too deep at "${path}"`); return; }
    let inBlock = false;
    src.split(/\r?\n/).forEach((raw, i) => {
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
      const imp = s.match(/^(?:([A-Za-z_][A-Za-z0-9_]*)\s*:\s*)?#import\s+"([^"]+)"/);
      if (imp) { if (imp[1]) stmts.push({ file: path, line: i + 1, label: imp[1], body: '' }); loadFile(imp[2], depth + 1); return; }
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
    if (s.endsWith('{')) {
      const head = s.slice(0, -1).trim(), pp = head.match(/^\.pseudopc\s+(.+)$/);
      if (pp) return { k: 'blk', id: blockIds++, st, kind: 'pseudopc', head: pp[1], body: list(st) };
      if (!head) return { k: 'blk', id: blockIds++, st, kind: 'scope', head: '', body: list(st) };
      E(`unexpected { after "${head}"`, st);
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
    ...MATH,
    LoadSid: (path: string) => { const u = vfs[path]; if (!(u instanceof Uint8Array)) throw new Error(`LoadSid: can't open "${path}"`); const sid = parsePsid(u); return Object.assign({}, sid, { getData: (i: number) => sid.data[i] }); },
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
  /** a number for bytes and addresses (null: not known yet in this pass) */
  const evn = (node: Node, s: Scope = cur): number | null => { const v = ev(node, s); return v == null ? null : numberOf(v); };
  /** a condition: true or false (null: not known yet in this pass) */
  const evb = (src: string, s: Scope = cur): boolean | null => {
    const v = ev(P(src), s); if (v == null) return null;
    if (!isBool(v)) throw new Error(`Can't get a boolean from a value of type ${typeName(v)}: a condition must be true or false (a comparison)`);
    return v;
  };
  const splitArgs = (s: string) => splitTop(s, ',').filter(a => a !== '');
  let mem = new Uint8Array(0x10000), written = new Uint8Array(0x10000), blocks: { start: number; name: string }[] = [];
  // `.pseudopc a { … }`: `pc` (labels, `*`, branches) counts from a while the bytes go on where they are; `off` is
  // how far pc is from where the next byte goes, and `outer` the offsets of the .pseudopc blocks around
  let off = 0, outer: number[] = [], first = -1;
  const prints: string[] = [];
  // in the final pass, the line of the entry file each byte comes from, and where each statement's bytes start (an
  // instruction's first byte: a debugger's line, a breakpoint's address)
  const lines = new Int32Array(0x10000), starts = new Uint8Array(0x10000);
  let fresh = false;
  const emit = (b: number, st: Stmt) => {
    b &= 0xff;
    const a = pc - off;
    if (a < 0 || a > 0xffff) { E('program counter past $ffff', st); return; }
    if (written[a] && pass === 'final') E(`memory at $${h4(a)} written twice`, st);
    if (first < 0) first = a;
    if (pass === 'final' && st.file === entryPath) { lines[a] = st.line; if (fresh) starts[a] = 1; }
    fresh = false;
    mem[a] = b; written[a] = 1; pc++;
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
    mem = new Uint8Array(0x10000); written = new Uint8Array(0x10000); blocks = [];
    pc = opts.pc ?? 0; off = 0; outer = []; enc = 'screencode_mixed'; unresolved = []; first = -1;
    mlPrev = ml; ml = [];
    root.vars.clear(); cur = root;
    let changed = false;
    const define = (name: string, v: Value, st: Stmt, s: Scope = cur) => {
      const k = keyOf(s, name);
      if (final && syms.has(k) && syms.get(k) !== v && typeof v === 'number') E(`symbol "${name}" changed value in the final pass`, st);
      if (syms.get(k) !== v) changed = true;
      syms.set(k, v);
      // a label of a named scope can be reached from the scope around it as `scope.label`
      if (s.name && s.parent) define(`${s.name}.${name}`, v, st, s.parent);
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
      } catch (err) { E((err as Error).message, st); report(st); }
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
        if ((m = s.match(/^BasicUpstart2\s*\((.+)\)$/))) {
          const v = evn(P(m[1])) ?? 0x1000; pc = 0x0801; blocks.push({ start: pc, name: 'Basic Upstart' });
          const digits = String(v); const endL = 0x0801 + 6 + digits.length;
          emit(endL & 0xff, st); emit(endL >> 8, st); emit(10, st); emit(0, st); emit(0x9e, st);
          for (const c of digits) emit(c.charCodeAt(0), st);
          emit(0, st); emit(0, st); emit(0, st);
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
          else if (dir === 'import binary') { const path = ev(P(args[0])); const u = vfs[path]; if (!(u instanceof Uint8Array)) { E(`Can't open binary file "${path}"`, st); return; } const o = args[1] ? evn(P(args[1])) ?? 0 : 0; const len = args[2] ? evn(P(args[2])) ?? 0 : u.length - o; for (let i = 0; i < len; i++) emit(u[o + i], st); }
          return;
        }
        if ((m = s.match(/^([A-Za-z]{3})(?:\.([A-Za-z]+))?(?:\s+(.*))?$/)) && ENC[m[1].toUpperCase()]) {
          const mn = m[1].toUpperCase(), ext = (m[2] || '').toLowerCase(), arg = (m[3] || '').trim();
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
          const v = ex != null ? evn(P(ex)) : null;
          if (BRANCHES.has(mn)) mode = 'rel';
          else if (mode === 'plain' || mode === 'x' || mode === 'y') {
            const suf = mode === 'plain' ? '' : mode;
            const forceZp = ext === 'zp' || ext === 'z', forceAbs = ext === 'abs' || ext === 'a';
            const zpOk = modes[('zp' + suf) as AddrMode] !== undefined, absOk = modes[('ab' + (suf || 's')) as AddrMode] !== undefined;
            const wantZp = forceZp || (!forceAbs && v != null && v >= 0 && v < 0x100);
            mode = (wantZp && zpOk) ? 'zp' + suf : absOk ? (suf ? 'ab' + suf : 'abs') : 'zp' + suf;
          }
          const op = modes[mode as AddrMode];
          if (op === undefined) { E(`${mn.toLowerCase()} does not support this addressing mode (${mode})`, st); return; }
          emit(op, st);
          const len = MODE_LEN[mode as AddrMode];
          if (mode === 'rel') {
            const o = v == null ? 0 : v - (pc + 1);
            if (final && (o < -128 || o > 127)) E(`branch out of range (${o})`, st);
            emit(o & 0xff, st);
          } else if (len === 2) { if (final && v != null && (v < -128 || v > 255)) E(`value $${(v >>> 0).toString(16)} does not fit in a byte`, st); emit(v ?? 0, st); }
          else if (len === 3) { emit((v ?? 0) & 0xff, st); emit(((v ?? 0) >> 8) & 0xff, st); }
          return;
        }
        E(`unsupported statement: ${s}`, st);
      } catch (err) { E((err as Error).message, st); }
      finally { report(st); }
    };
    run(tree);
    return changed;
  };
  for (pass = 1; pass <= 12; pass++) { const ch = runPass(false); if (!ch && !unresolved.length && pass > 1) break; }
  pass = 'final';
  runPass(true);
  let min = -1, max = -1;
  for (let a = 0; a < 0x10000; a++) if (written[a]) { if (min < 0) min = a; max = a; }
  const blockList: AsmBlock[] = blocks.filter(b => b.name).map((b, i, arr) => ({ start: b.start, name: b.name, end: i + 1 < arr.length ? arr[i + 1].start - 1 : max }));
  let prg: Uint8Array | null = null;
  if (min >= 0) { prg = new Uint8Array(max - min + 3); prg[0] = min & 0xff; prg[1] = min >> 8; prg.set(mem.subarray(min, max + 1), 2); }
  // an error a loop met in each round is said once
  const said = new Set<string>();
  const once = errors.filter(e => { const k = `${e.file}:${e.line}:${e.msg}`; if (said.has(k)) return false; said.add(k); return true; });
  return { mem, written, min, max, errors: once, prg, blocks: blockList, symbols: syms, prints, first, external, lines, starts };
}
