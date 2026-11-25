/* =====================================================================
 * Assembles the 64tass subset that the generator writes for 64tass (spec 11.8), as 64tass 1.57 does with -a -C:
 * labels at the start of a line (`name:` or `name`), `name = value`, `name := value`, the anonymous labels `+` and
 * `-` (`bne -`, `.word (+)`), `* = address`, `.logical`/`.here`, `.if`/`.elsif`/`.else`/`.endif`, `.namespace` and
 * `.block` scopes read as `name.label`, `.include`, `.cpu`, `.enc "none"`/`"screen"` (the -a tables), `.byte`,
 * `.word`, `.text`, `.null`, `.fill`, `.binary`, `.comment`/`.endc`, `@w`/`@b` before an operand, every addressing
 * mode of the NMOS 6510 with 64tass's names of the undocumented opcodes (with `.cpu "6502i"`), and the expressions
 * it uses: numbers, strings, `*`, `<` and `>` over all of the expression after them (as 64tass: `<label+1` is the
 * low byte of label+1), the arithmetic, bit, shift, comparison and logical operators, `? :`, lists, byte strings
 * indexed, by lists and sliced (`sid[[7, 6]]`, `sid[offset + 2:]`), binary(), len() and format(). Macros: `name
 * .macro a, b=2` … `.endm` (a block of its own, which a label before the call names: `var .lohi 1, 2` → `var.lo`) and
 * `name .segment` … `.endsegment` (no block), called `#name 1, 2` or `.name 1, 2` before or after the definition, the
 * parameters as text (`\1`-`\9`, `\name`, `\{name}`, `\@` all of them, `@1`-`@9`; not inside strings, as 64tass 1.57).
 * Functions: `name .function a, b=1, *rest` … `.endf result` (and `name .sfunction a, expression`), called in a value
 * (`add(2)`: the result, a list when there are several) or as an instruction (`mva #1, $d020`, `#mva …`, `.mva …`:
 * its lines with the arguments as values, `#1` an immediate one that `lda value` takes as lda #1; a label before it gets
 * the result when there is one), before or after the definition, each call a block of its own under the top level.
 * Loops: `.for i := 0, i < 8, i += 1`, `.for x in list`, `.rept n`, `.while cond` … `.endfor`/`.endrept`/`.endwhile`/`.next`,
 * and their b-forms (`.bfor`, `.brept`, `.bwhile`: each round a block of its own, a label before it the list of them:
 * `lst[1].label`), `.break`, `.continue`, `.breakif`, `.continueif`; variables changed with `+=`, `-=` … and `::=`;
 * `range()`, and an operator over a list giving a list (`%10000000 >> range(8)`).
 * Sections: `.dsection name` where the bytes of every `.section name` … `.send` go, as 64tass, nested too; `.byte ?`,
 * `.word ?`, `.addr ?` take room only. Several passes until the sizes settle, as 64tass. The desktop app and the CLI
 * can additionally run the real 64tass.
 * ===================================================================== */
import type { AsmError, AssembleResult, Vfs } from '../types';
import { MODE_LEN, OPC, TASS_ENC, type AddrMode } from '../cpu/opcodes';
import { h4 } from '../util/hex';
import { importPath, type AssembleOptions } from './kick-subset-assembler';

/** a statement: its label, its body and (`cmt`) the comment after it, which a `* =` line's names its block by */
interface Stmt { file: string; line: number; src: string; label?: string; body: string; cmt?: string }

type Tok = { t: 'n'; v: number } | { t: 's'; v: string } | { t: 'id'; v: string } | { t: 'op'; v: string };
type Node =
  | { k: 'n'; v: number } | { k: 's'; v: string } | { k: 'pc' } | { k: 'id'; v: string } | { k: 'anon'; dir: '+' | '-'; n: number }
  | { k: 'mem'; o: Node; v: string } | { k: 'call'; f: Node; args: Node[] } | { k: 'list'; items: Node[] }
  | { k: 'idx'; o: Node; i: Node } | { k: 'slice'; o: Node; a: Node | null; b: Node | null }
  | { k: 'u'; op: string; a: Node } | { k: 'b'; op: string; a: Node; b: Node } | { k: 'q'; c: Node; a: Node; b: Node };
// numbers, booleans, strings (characters), byte strings (Uint8Array), lists and namespaces
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Value = any;

/** binary operators by precedence (higher binds tighter) */
const BIN: Record<string, number> = {
  '||': 1, '^^': 1, '&&': 2, '|': 3, '^': 4, '&': 5, '==': 6, '!=': 6, '<': 6, '<=': 6, '>': 6, '>=': 6, '<<': 7, '>>': 7, '+': 8, '-': 8, '*': 9, '/': 9, '%': 9, '**': 10,
};

/** the character tables of `.enc "none"` and `.enc "screen"` with -a (measured with 64tass 1.57.2900, every printable
 *  character): letters a-z are the unshifted ones, A-Z the shifted, £ ↑ ← π where the C64 has them; anything else
 *  ("\", "^", "_", "`", "{" …) cannot be encoded */
const ENCODINGS: Record<string, (c: string) => number | null> = {
  none: c => {
    const k = c.charCodeAt(0);
    if (k >= 0x20 && k <= 0x40) return k;
    if (k >= 0x41 && k <= 0x5a) return k + 0x80;
    if (k >= 0x61 && k <= 0x7a) return k - 0x20;
    return ({ '[': 0x5b, '£': 0x5c, ']': 0x5d, '↑': 0x5e, '←': 0x5f, 'π': 0xff } as Record<string, number>)[c] ?? null;
  },
  screen: c => {
    const k = c.charCodeAt(0);
    if (k >= 0x20 && k <= 0x3f) return k;
    if (c === '@') return 0;
    if (k >= 0x41 && k <= 0x5a) return k;
    if (k >= 0x61 && k <= 0x7a) return k - 0x60;
    return ({ '[': 0x1b, '£': 0x1c, ']': 0x1d, '↑': 0x1e, '←': 0x1f, 'π': 0x5e } as Record<string, number>)[c] ?? null;
  },
};

const IMPLIED_ACC = new Set(['ASL', 'LSR', 'ROL', 'ROR']);
const BRANCH = new Set(['BPL', 'BMI', 'BVC', 'BVS', 'BCC', 'BCS', 'BNE', 'BEQ']);
/** the namespace a `.namespace` or `.block` label (or a macro call's) stands for, and the address where it starts */
interface Space { space: string; v?: number }
/** a macro (`.macro`: a block of its own; `.segment`: none): its parameters with their defaults and its lines */
interface TMacro { kind: 'macro' | 'segment'; name: string; params: { name: string; def: string | null }[]; lines: { raw: string; line: number }[]; file: string }
/** a function (`.function` … `.endf result`, or `.sfunction`): its parameters (`*rest` takes the rest as a list), its
 *  lines and the expressions it gives */
interface TFunc { name: string; params: { name: string; def: string | null; rest: boolean }[]; body: Stmt[]; result: string; st: Stmt }
/** an immediate value: a function's argument written `#1` (`lda value` is then lda #1) */
interface Imm { imm: true; v: Value }
const isImm = (v: Value): v is Imm => !!v && typeof v === 'object' && v.imm === true;
/** what .break and .continue throw to the loop they are in */
class LoopSignal { constructor(readonly kind: 'break' | 'continue') {} }
/** a loop's first line, and the lines that end one */
const LOOP = /^\.(b?)(for|rept|while)\b\s*(.*)$/, LOOP_END = /^\.(next|endfor|endrept|endwhile)\b/;
/** a section: where its .dsection put it in this pass and the last (pc, and the offset of a .logical), how much its
 *  fragments took so far and at most */
interface Sect { name: string; key: string; pc0: number | null; off0: number; used: number; max: number; prevPc0: number | null; prevOff0: number; prevSize: number; frags: boolean }
const isSpace = (v: Value): v is Space => !!v && typeof v === 'object' && typeof v.space === 'string';

const typeName = (v: Value) => typeof v === 'boolean' ? 'bool' : typeof v === 'string' ? 'str' : typeof v === 'number' ? 'int' : v instanceof Uint8Array ? 'bytes' : Array.isArray(v) ? 'list' : 'namespace';

/** `s` split at `sep` where it is outside strings, parentheses and brackets */
function splitTop(s: string, sep: string): string[] {
  const out: string[] = []; let depth = 0, q = '', cur = '';
  for (let k = 0; k < s.length; k++) {
    const c = s[k];
    if (q) { cur += c; if (c === q) q = ''; continue; }
    if (c === '"' || c === "'") { q = c; cur += c; continue; }
    if (c === '(' || c === '[') depth++;
    if (c === ')' || c === ']') depth--;
    if (!depth && c === sep) { out.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim() || out.length) out.push(cur.trim());
  return out;
}

/** the line without its comment (`;` outside strings) */
function stripComment(raw: string): string {
  let q = '';
  for (let k = 0; k < raw.length; k++) {
    const c = raw[k];
    if (q) { if (c === q) q = ''; continue; }
    if (c === '"' || c === "'") { q = c; continue; }
    if (c === ';') return raw.slice(0, k);
  }
  return raw;
}

/** printf-like formatting as 64tass's format(): %d %x %X %b %s %c with a width (and 0 to pad with zeros) */
function format(fmt: string, args: Value[]): string {
  let i = 0;
  return fmt.replace(/%(-?)(0?)(\d*)([dxXbsc%])/g, (_m, left: string, zero: string, w: string, c: string) => {
    if (c === '%') return '%';
    const v = args[i++];
    let s = c === 'd' ? String(Math.trunc(v)) : c === 'x' ? (Math.trunc(v) >>> 0).toString(16) : c === 'X' ? (Math.trunc(v) >>> 0).toString(16).toUpperCase()
      : c === 'b' ? (Math.trunc(v) >>> 0).toString(2) : c === 'c' ? String.fromCharCode(v) : String(v);
    const width = +w || 0;
    if (s.length < width) s = left ? s.padEnd(width) : s.padStart(width, zero && c !== 's' ? '0' : ' ');
    return s;
  });
}

export function assembleTass(vfs: Vfs, entryPath: string, opts: AssembleOptions = {}): AssembleResult {
  const errors: AsmError[] = [];
  /** 0 while the files are read, then the passes, and the final one */
  let pass: number | 'final' = 0;
  /** the macros being run, outermost first: a byte one writes is its outermost call's line's, and a problem in one says
   *  which call it was in */
  let calls: { name: string; st: Stmt }[] = [];
  // (only the loading and the final pass report: a pass before it may meet a value not known yet)
  const E = (msg: string, st?: Stmt) => {
    if (pass !== 0 && pass !== 'final') return;
    const c = calls[calls.length - 1];
    const where = c && st && c.st !== st ? ` (in the macro ${c.name}, called on line ${c.st.line}${c.st.file !== st.file ? ` of ${c.st.file}` : ''})` : '';
    errors.push({ msg: msg + where, file: st ? st.file : entryPath, line: st ? st.line : 0 });
  };
  const stmts: Stmt[] = [];
  const macros = new Map<string, TMacro>(), funcs = new Map<string, TFunc>();

  // ---- the lines: comments off, the label at the start of a line, .include and .comment … .endc ----
  /** a line as a statement: its label at the start of the line, the rest, and its comment */
  const parseLine = (raw: string, path: string, no: number): Stmt => {
    const line = stripComment(raw).replace(/\s+$/, '');
    const cmt = raw.slice(stripComment(raw).length).replace(/^;\s*/, '').trim();
    let label: string | undefined, rest = line;
    if (line && !/^\s/.test(line)) {
      // at the start of a line: a label (`name:`, `name`, `+`, `-`), else `*` or a directive
      // (a mnemonic there, in lower case, is the instruction, as 64tass reads `lda #1` at the start of a line)
      const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*|[+-])(:?)(?=\s|$|=)/);
      if (m && !(!m[2] && /^[a-z]{3}$/.test(m[1]) && TASS_ENC[m[1].toUpperCase()])) { label = m[1]; rest = line.slice(m[0].length); }
    }
    return { file: path, line: no, src: raw, ...(label ? { label } : {}), body: rest.trim(), ...(cmt ? { cmt } : {}) };
  };
  const loadFile = (path: string, depth: number) => {
    const src = vfs[path];
    if (typeof src !== 'string') { E(`can't open file "${path}"`); return; }
    if (depth > 16) { E(`.include nested too deep at "${path}"`); return; }
    let inComment = false, def: TMacro | null = null, inner = 0, fn: TFunc | null = null;
    src.split(/\r?\n/).forEach((raw, i) => {
      const st = parseLine(raw, path, i + 1), { label, body } = st;
      if (inComment) { if (/^\.endc(omment)?$/.test(body)) inComment = false; return; }
      // a macro's lines are kept as they are written, until its end
      if (def) {
        if (/^\.(macro|segment)\b/.test(body)) inner++;
        else if (/^\.(endm|endmacro|endsegment)\b/.test(body)) { if (inner) inner--; else { def = null; return; } }
        def.lines.push({ raw, line: i + 1 });
        return;
      }
      // a function's lines, until .endf (its result after it)
      if (fn) {
        const end = body.match(/^\.(endf|endfunction)\b\s*(.*)$/);
        if (end) { fn.result = end[2].trim(); fn = null; return; }
        if (st.label || st.body) fn.body.push(st);
        return;
      }
      if (/^\.comment$/.test(body)) { inComment = true; return; }
      const fd = body.match(/^\.(function|sfunction)\b\s*(.*)$/);
      if (fd) {
        const parts = fd[2].trim() ? splitTop(fd[2], ',') : [];
        const result = fd[1] === 'sfunction' ? parts.pop() ?? '' : '';
        const f: TFunc = { name: label ?? '', params: parts.filter(x => x !== '').map(x => { const [n, d] = x.split('='); const name = n.trim().replace(/:.*$/, ''); return { name: name.replace(/^\*/, ''), def: d == null ? null : d.trim(), rest: name.startsWith('*') }; }), body: [], result, st };
        if (!label || label === '+' || label === '-') E(`a .${fd[1]} needs its name before it (name .${fd[1]})`, st);
        else if (funcs.has(label) || macros.has(label)) E(`duplicate definition '${label}'`, st);
        else funcs.set(label, f);
        if (fd[1] === 'function') fn = f;
        return;
      }
      const md = body.match(/^\.(macro|segment)\b\s*(.*)$/);
      if (md) {
        def = { kind: md[1] as TMacro['kind'], name: label ?? '', params: md[2].trim() ? splitTop(md[2], ',').map(p => { const [n, d] = p.split('='); return { name: n.trim(), def: d == null ? null : d.trim() }; }) : [], lines: [], file: path };
        if (!label || label === '+' || label === '-') E(`a .${md[1]} needs its name before it (name .${md[1]})`, st);
        else if (macros.has(label)) E(`duplicate definition '${label}'`, st);
        else macros.set(label, def);
        return;
      }
      const inc = body.match(/^\.include\s+"([^"]+)"$/);
      if (inc) { if (label) stmts.push({ ...st, body: '' }); loadFile(importPath(vfs, path, inc[1]), depth + 1); return; }
      if (!label && !body) return;
      stmts.push(st);
    });
    if (inComment) E(`.comment without .endc in "${path}"`);
    const unclosed = def as TMacro | null, unended = fn as TFunc | null;
    if (unclosed) E(`closing directive '.endmacro' not found for '${unclosed.name}' in "${path}"`);
    if (unended) E(`closing directive '.endfunction' not found for '${unended.name}'`, unended.st);
  };
  loadFile(entryPath, 0);
  /** a macro's lines for a call with these parameters (as text): each reference replaced outside strings and comments */
  const expanded = new Map<string, Stmt[]>();
  const expand = (def: TMacro, argText: string): Stmt[] => {
    const key = `${def.name}\u0000${argText}`;
    const done = expanded.get(key); if (done) return done;
    const given = argText.trim() ? splitTop(argText, ',') : [];
    const texts = Array.from({ length: Math.max(given.length, def.params.length) }, (_, i) => (given[i] ?? '') !== '' ? given[i] : (def.params[i]?.def ?? ''));
    const named = new Map(def.params.map((p, i) => [p.name, texts[i]] as const).filter(([n]) => n));
    const sub = (raw: string) => {
      let out = '', q = '';
      for (let k = 0; k < raw.length; k++) {
        const c = raw[k];
        if (q) { out += c; if (c === q) q = ''; continue; }
        if (c === '"' || c === "'") { q = c; out += c; continue; }
        if (c === ';') return out + raw.slice(k);
        if (c === '\\' || c === '@') {
          const r = raw.slice(k + 1);
          let m: RegExpMatchArray | null;
          if ((m = r.match(/^[1-9]/))) { out += texts[+m[0] - 1] ?? ''; k += 1; continue; }
          if (c === '\\' && r[0] === '@') { out += argText.trim(); k += 1; continue; }
          if (c === '\\' && (m = r.match(/^\{([A-Za-z_]\w*)\}/)) && named.has(m[1])) { out += named.get(m[1]); k += m[0].length; continue; }
          if (c === '\\' && (m = r.match(/^[A-Za-z_]\w*/)) && named.has(m[0])) { out += named.get(m[0]); k += m[0].length; continue; }
        }
        out += c;
      }
      return out;
    };
    const list = def.lines.map(l => parseLine(sub(l.raw), def.file, l.line)).filter(st => st.label || st.body);
    expanded.set(key, list);
    return list;
  };
  /** a function called as an instruction: `name …`, `#name …` or `.name …` (a name that is a function) */
  const fnCallOf = (body: string): { def: TFunc; args: string } | null => {
    const m = body.match(/^[#.]?([A-Za-z_]\w*)(?:\s+(.*))?$/);
    const def = m ? funcs.get(m[1]) : undefined;
    return def && !(m![0][0] !== '#' && m![0][0] !== '.' && TASS_ENC[m![1].toUpperCase()] && m![1].length === 3) ? { def, args: m![2] ?? '' } : null;
  };
  /** a call of a macro: `#name …` or `.name …` (a name that is a macro) */
  const callOf = (body: string): { def: TMacro; args: string } | null => {
    const m = body.match(/^[#.]([A-Za-z_]\w*)(?:\s+(.*))?$/);
    const def = m ? macros.get(m[1]) : undefined;
    return def ? { def, args: m![2] ?? '' } : null;
  };

  // ---- expressions ----
  const tokenize = (s: string): Tok[] => {
    const out: Tok[] = []; let i = 0;
    while (i < s.length) {
      const c = s[i];
      if (/\s/.test(c)) { i++; continue; }
      if (c === '$') { const m = s.slice(i + 1).match(/^[0-9a-fA-F_]+/); if (!m) throw new Error(`bad hex number in "${s}"`); out.push({ t: 'n', v: parseInt(m[0].replace(/_/g, ''), 16) }); i += 1 + m[0].length; continue; }
      if (c === '%' && /[01]/.test(s[i + 1] ?? '') && !(out.length && (out[out.length - 1].t !== 'op' || /[)\]]/.test((out[out.length - 1] as { v: string }).v)))) {
        const m = s.slice(i + 1).match(/^[01_]+/)!; out.push({ t: 'n', v: parseInt(m[0].replace(/_/g, ''), 2) }); i += 1 + m[0].length; continue;
      }
      if (/[0-9]/.test(c)) { const m = s.slice(i).match(/^[0-9][0-9_]*/)!; out.push({ t: 'n', v: parseInt(m[0].replace(/_/g, ''), 10) }); i += m[0].length; continue; }
      if (/[A-Za-z_]/.test(c)) { const m = s.slice(i).match(/^[A-Za-z_][A-Za-z0-9_]*/)!; out.push({ t: 'id', v: m[0] }); i += m[0].length; continue; }
      if (c === '"' || c === "'") {
        // a string; the quote doubled inside it is the quote
        let j = i + 1, v = '';
        for (;;) {
          if (j >= s.length) throw new Error('unterminated string');
          if (s[j] === c) { if (s[j + 1] === c) { v += c; j += 2; continue; } break; }
          v += s[j++];
        }
        out.push({ t: 's', v }); i = j + 1; continue;
      }
      const three = s.slice(i, i + 3), two = s.slice(i, i + 2);
      if (['<=>'].includes(three)) { out.push({ t: 'op', v: three }); i += 3; continue; }
      if (['<<', '>>', '==', '!=', '<=', '>=', '&&', '||', '^^', '**'].includes(two)) { out.push({ t: 'op', v: two }); i += 2; continue; }
      if ('+-*/%&|^<>(),.!~?:[]'.includes(c)) { out.push({ t: 'op', v: c }); i++; continue; }
      throw new Error(`unexpected "${c}" in expression "${s}"`);
    }
    return out;
  };
  const parseExpr = (s: string): Node => {
    const tk = tokenize(s); let p = 0;
    const peek = (k = 0): Tok | undefined => tk[p + k], next = (): Tok | undefined => tk[p++];
    const isOp = (t: Tok | undefined, v: string) => !!t && t.t === 'op' && t.v === v;
    const ends = (t: Tok | undefined) => !t || isOp(t, ')') || isOp(t, ',') || isOp(t, ']') || isOp(t, ':');
    const primary = (): Node => {
      const t = next();
      if (!t) throw new Error(`incomplete expression "${s}"`);
      if (t.t === 'n') return post({ k: 'n', v: t.v });
      if (t.t === 's') return post({ k: 's', v: t.v });
      if (t.t === 'id') return post({ k: 'id', v: t.v });
      if (t.v === '*') return { k: 'pc' };
      // an anonymous label: `+`, `++`, `-`, `--` where a value ends
      if (t.v === '+' || t.v === '-') {
        let n = 1; while (isOp(peek(n - 1), t.v)) n++;
        if (ends(peek(n - 1))) { p += n - 1; return { k: 'anon', dir: t.v, n }; }
        return { k: 'u', op: t.v, a: primary() };
      }
      if (t.v === '(') {
        const e = full();
        // a tuple: `(1234, 5678)`
        if (isOp(peek(), ',')) { const items = [e]; while (isOp(peek(), ',')) { next(); items.push(full()); } if (!isOp(next(), ')')) throw new Error(`missing ) in "${s}"`); return post({ k: 'list', items }); }
        if (!isOp(next(), ')')) throw new Error(`missing ) in "${s}"`);
        return post(e);
      }
      if (t.v === '[') {
        const items: Node[] = [];
        if (!isOp(peek(), ']')) for (;;) { items.push(full()); const c = next(); if (isOp(c, ']')) break; if (!isOp(c, ',')) throw new Error(`bad list in "${s}"`); } else next();
        return post({ k: 'list', items });
      }
      // `<` and `>` take all of the expression after them (64tass: `<label+10` is `<(label+10)`)
      if (t.v === '<' || t.v === '>') return { k: 'u', op: t.v, a: full() };
      if (t.v === '~' || t.v === '!') return { k: 'u', op: t.v, a: primary() };
      throw new Error(`unexpected "${t.v}" in "${s}"`);
    };
    /** member access, calls, indexing and slicing after a value */
    const post = (node: Node): Node => {
      for (;;) {
        const q = peek();
        if (isOp(q, '.') && peek(1)?.t === 'id') { next(); node = { k: 'mem', o: node, v: (next() as { v: string }).v }; continue; }
        if (isOp(q, '(') && (node.k === 'id' || node.k === 'mem')) {
          next(); const args: Node[] = [];
          if (!isOp(peek(), ')')) { for (;;) { args.push(full()); const c = next(); if (isOp(c, ')')) break; if (!isOp(c, ',')) throw new Error(`bad argument list in "${s}"`); } } else next();
          node = { k: 'call', f: node, args }; continue;
        }
        if (isOp(q, '[')) {
          next();
          const a = isOp(peek(), ':') ? null : full();
          if (isOp(peek(), ':')) { next(); const b = isOp(peek(), ']') ? null : full(); if (!isOp(next(), ']')) throw new Error(`missing ] in "${s}"`); node = { k: 'slice', o: node, a, b }; continue; }
          if (!isOp(next(), ']')) throw new Error(`missing ] in "${s}"`);
          node = { k: 'idx', o: node, i: a! }; continue;
        }
        return node;
      }
    };
    const expr = (minP: number): Node => {
      let left = primary();
      for (;;) {
        const t = peek();
        if (!t || t.t !== 'op' || !BIN[t.v] || BIN[t.v] < minP) break;
        next(); const right = expr(t.v === '**' ? BIN[t.v] : BIN[t.v] + 1); left = { k: 'b', op: t.v, a: left, b: right };
      }
      return left;
    };
    const full = (): Node => {
      const c = expr(1);
      if (!isOp(peek(), '?')) return c;
      next(); const a = full(); if (!isOp(next(), ':')) throw new Error(`missing : after ? in "${s}"`);
      return { k: 'q', c, a, b: full() };
    };
    const e = full();
    if (p < tk.length) throw new Error(`unexpected "${(tk[p] as { v: string | number }).v}" in "${s}"`);
    return e;
  };
  const cache = new Map<string, Node>();
  const P = (s: string): Node => { let n = cache.get(s); if (!n) { n = parseExpr(s); cache.set(s, n); } return n; };

  const syms = new Map<string, Value>();
  let pc = 0, unresolved: string[] = [], missing = false;
  /** a loop went round too many times: no more passes before the final one, which says so */
  let stuck = false;
  let enc = 'none', cpu = '6502';
  const names = opts.names;
  let curStmt: Stmt | null = null;
  const external = new Map<string, number>();
  // anonymous labels in the order this pass defines them, and the last pass's
  let anon: { dir: '+' | '-'; v: number }[] = [], anonPrev: { dir: '+' | '-'; v: number }[] = [];
  /** the namespaces the statement is in, innermost last (`music`, …) */
  let spaces: string[] = [];
  const keyIn = (sp: readonly string[], name: string) => (sp.length ? `${sp.join('.')}.${name}` : name);

  /** the encodings the source defines (`.enc "ascii"` with `.cdef`): a name 64tass does not have starts empty */
  const userEnc = new Map<string, Map<string, number>>();
  /** the bytes a string gives in the current encoding */
  const encode = (s: string): number[] => {
    const own = userEnc.get(enc);
    const f = ENCODINGS[enc] ?? ((c: string) => own?.get(c) ?? null);
    return [...s].map(c => { const b = f(c); if (b == null) throw new Error(`can't encode character '${c}' (U+${c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')})`); return b; });
  };
  /** a value as an integer: a number, a byte string little-endian, a string of one character encoded, a boolean 0/1 */
  const numberOf = (v: Value): number => {
    if (typeof v === 'number') { if (!Number.isFinite(v)) throw new Error(`${v} is not a number that fits in memory`); return Math.trunc(v); }
    if (typeof v === 'boolean') return v ? 1 : 0;
    if (v instanceof Uint8Array) { let n = 0; for (let i = v.length - 1; i >= 0; i--) n = n * 256 + v[i]; return n; }
    if (typeof v === 'string') { const b = encode(v); if (b.length === 1) return b[0]; throw new Error(`a string of ${b.length} characters is not a number`); }
    // a block's or a macro call's label is also the address where it starts
    if (isSpace(v) && typeof v.v === 'number') return v.v;
    if (isImm(v)) return numberOf(v.v);
    throw new Error(`a ${typeName(v)} is not a number`);
  };
  const truth = (v: Value): boolean => (typeof v === 'boolean' ? v : numberOf(v) !== 0);
  const bytesOf = (v: Value): Uint8Array => (v instanceof Uint8Array ? v : typeof v === 'string' ? Uint8Array.from(encode(v)) : (() => { throw new Error(`a ${typeName(v)} has no bytes`); })());

  const builtins: Record<string, Value> = {
    true: true, false: false,
    binary: (path: string, off?: number, len?: number) => {
      const u = vfs[importPath(vfs, curStmt?.file ?? entryPath, path)]; if (!(u instanceof Uint8Array)) throw new Error(`can't open file "${path}"`);
      const o = off == null ? 0 : numberOf(off); return u.slice(o, len == null ? u.length : o + numberOf(len));
    },
    len: (x: Value) => { if (x instanceof Uint8Array || typeof x === 'string' || Array.isArray(x)) return x.length; throw new Error(`len() of a ${typeName(x)}`); },
    format: (f: string, ...args: Value[]) => format(f, args),
    range: (...a: Value[]) => {
      const [s, e, t] = a.length === 1 ? [0, numberOf(a[0]), 1] : [numberOf(a[0]), numberOf(a[1]), a[2] == null ? 1 : numberOf(a[2])];
      if (!t) throw new Error('range() with a step of 0');
      const out: number[] = [];
      for (let i = s; t > 0 ? i < e : i > e; i += t) { out.push(i); if (out.length > 1_000_000) throw new Error('range() of more than a million values'); }
      return out;
    },
  };
  /** the code label a local label (`_loop`) belongs to: the last one before it (a constant opens no new scope) */
  let scope = '';
  const lookup = (name: string): Value | undefined => {
    if (name.startsWith('_') && scope) { const v = lookup(`${scope}.${name}`); if (v !== undefined) return v; }
    for (let i = spaces.length; i >= 0; i--) { const k = keyIn(spaces.slice(0, i), name); if (syms.has(k)) return syms.get(k); }
    // a function: its result for the arguments (it runs its lines)
    const f = funcs.get(name);
    if (f) return (...args: Value[]) => callFn(f, args, null);
    if (name in builtins) return builtins[name];
    const ext = names?.get(name);
    if (ext !== undefined && pass === 'final' && curStmt && !external.has(name)) external.set(name, curStmt.line);
    return ext;
  };
  const dotted = (n: Node): string | null => n.k === 'id' ? n.v : n.k === 'mem' ? ((o => o && `${o}.${n.v}`)(dotted(n.o))) : null;

  const ev = (node: Node): Value => {
    switch (node.k) {
      case 'n': return node.v;
      case 's': return node.v;
      case 'pc': return pc;
      case 'id': { const v = lookup(node.v); if (v !== undefined) return v; unresolved.push(node.v); return null; }
      case 'anon': {
        // `-` the n-th `-` label back from here; `+` the n-th `+` label ahead (from the last pass)
        let left = node.n;
        if (node.dir === '-') { for (let i = anon.length - 1; i >= 0; i--) if (anon[i].dir === '-' && !--left) return anon[i].v; }
        else for (let i = anon.length; i < anonPrev.length; i++) if (anonPrev[i].dir === '+' && !--left) return anonPrev[i].v;
        unresolved.push(node.dir.repeat(node.n)); return null;
      }
      case 'mem': {
        const d = dotted(node);
        if (d) { const v = lookup(d); if (v !== undefined) return v; }
        const o = ev(node.o); if (o == null) return null;
        if (isSpace(o)) { const k = `${o.space}.${node.v}`; if (syms.has(k)) return syms.get(k); unresolved.push(k); return null; }
        throw new Error(`a ${typeName(o)} has no .${node.v}`);
      }
      case 'call': {
        const fn = ev(node.f); const args = node.args.map(a => ev(a));
        if (fn == null || args.some(a => a == null)) return null;
        if (typeof fn !== 'function') throw new Error(`${dotted(node.f) ?? 'this'} is not a function`);
        return fn(...args);
      }
      case 'list': { const items = node.items.map(a => ev(a)); return items.some(a => a == null) ? null : items; }
      case 'idx': {
        const o = ev(node.o), i = ev(node.i); if (o == null || i == null) return null;
        const seq = o instanceof Uint8Array || typeof o === 'string' || Array.isArray(o) ? o : null;
        if (!seq) throw new Error(`a ${typeName(o)} cannot be indexed`);
        const at = (x: Value) => { let k = numberOf(x); if (k < 0) k += seq.length; if (k < 0 || k >= seq.length) throw new Error(`index ${numberOf(x)} out of range (length ${seq.length})`); return k; };
        // a list of indexes picks those (a byte string of them: sid[[7, 6]])
        if (Array.isArray(i)) return o instanceof Uint8Array ? Uint8Array.from(i.map(x => o[at(x)])) : typeof o === 'string' ? i.map(x => o[at(x)]).join('') : i.map(x => o[at(x)]);
        return o instanceof Uint8Array ? o.slice(at(i), at(i) + 1) : o[at(i)];
      }
      case 'slice': {
        const o = ev(node.o); if (o == null) return null;
        const a = node.a ? ev(node.a) : 0, b = node.b ? ev(node.b) : undefined;
        if (a == null || (node.b && b == null)) return null;
        if (!(o instanceof Uint8Array || typeof o === 'string' || Array.isArray(o))) throw new Error(`a ${typeName(o)} cannot be sliced`);
        return o.slice(numberOf(a), b == null ? undefined : numberOf(b));
      }
      case 'q': { const c = ev(node.c); if (c == null) return null; return ev(truth(c) ? node.a : node.b); }
      case 'u': {
        const v = ev(node.a); if (v == null) return null;
        if (node.op === '!') return !truth(v);
        // of a list, each item's (`<(1234, 5678)`: both low bytes)
        if (Array.isArray(v)) return v.map(x => ev({ k: 'u', op: node.op, a: { k: 'n', v: numberOf(x) } }));
        const n = numberOf(v);
        return node.op === '<' ? n & 0xff : node.op === '>' ? (n >> 8) & 0xff : node.op === '~' ? ~n : node.op === '+' ? n : -n;
      }
      case 'b': {
        if (node.op === '&&' || node.op === '||') {
          const x = ev(node.a); if (x == null) return null;
          if (node.op === '&&' ? !truth(x) : truth(x)) return x;
          return ev(node.b);
        }
        const x = ev(node.a), y = ev(node.b); if (x == null || y == null) return null;
        return bin(node.op, x, y);
      }
    }
    return null;
  };
  /** a binary operator's value: over a list, a list of each item's (two lists item by item) */
  const bin = (op: string, x: Value, y: Value): Value => {
    if (Array.isArray(x) || Array.isArray(y)) {
      if (Array.isArray(x) && Array.isArray(y) && x.length !== y.length) throw new Error(`lists of ${x.length} and ${y.length} values`);
      const n = Array.isArray(x) ? x.length : y.length;
      return Array.from({ length: n }, (_, i) => bin(op, Array.isArray(x) ? x[i] : x, Array.isArray(y) ? y[i] : y));
    }
    if (op === '==' || op === '!=') {
      const same = x instanceof Uint8Array || y instanceof Uint8Array ? numberOf(x) === numberOf(y) : typeof x === typeof y ? x === y : numberOf(x) === numberOf(y);
      return op === '==' ? same : !same;
    }
    const a = numberOf(x), b = numberOf(y);
    switch (op) {
      case '+': return a + b; case '-': return a - b; case '*': return a * b;
      case '/': if (!b) throw new Error('division by zero'); return Math.floor(a / b);
      case '%': if (!b) throw new Error('division by zero'); return a - b * Math.floor(a / b);
      case '**': return a ** b;
      case '&': return a & b; case '|': return a | b; case '^': return a ^ b;
      case '<<': return a << b; case '>>': return a >> b;
      case '<': return a < b; case '<=': return a <= b; case '>': return a > b; case '>=': return a >= b;
      case '^^': return truth(x) !== truth(y) ? (truth(x) ? x : y) : false;
    }
    return null;
  };
  const evn = (src: string): number | null => { const v = ev(P(src)); return v == null ? null : numberOf(v); };
  /** runs a function the source defines with these arguments (set by each pass: it runs lines); `st`: called as an
   *  instruction there. Its result: undefined when its .endf gives none */
  let callFn: (f: TFunc, args: Value[], st: Stmt | null) => Value = () => null;

  let mem = new Uint8Array(0x10000), written = new Uint8Array(0x10000), blocks: { start: number; name: string }[] = [];
  // `.logical a`: `pc` counts from a while the bytes go on where they are; `off` is how far pc is from where the next
  // byte goes, and `outer` the offsets of the .logical blocks around
  let off = 0, outer: number[] = [], first = -1;
  const lines = new Int32Array(0x10000), starts = new Uint8Array(0x10000), ops = new Uint8Array(0x10000);
  /** the program counter at each line of the entry file the final pass assembles (not those of an .if not taken) */
  const linePcs = new Map<number, number>();
  /** the sections, by name (one whose .dsection is in another's fragment: `outer/name`) */
  const sects = new Map<string, Sect>();
  const prints: string[] = [];
  let endPc = 0;
  // (allFiles: every file's lines, and whose each byte is: its index in fileNames + 1)
  const all = !!opts.allFiles, fileOf = all ? new Uint16Array(0x10000) : undefined, fileNames: string[] = [];
  const fileNo = (file: string) => { let i = fileNames.indexOf(file); if (i < 0) i = fileNames.push(file) - 1; return i + 1; };
  const mine = (st: Stmt) => all || st.file === entryPath;
  /** the line a byte is said to come from: a macro's is the line that calls it (the outermost call) */
  const site = (st: Stmt) => calls.length ? calls[0].st : st;
  let fresh = false;
  const emit = (b: number, st: Stmt) => {
    b &= 0xff;
    const a = pc - off;
    if (a < 0 || a > 0xffff) { E('program counter past $ffff', st); return; }
    if (written[a] && pass === 'final') E(`memory at $${h4(a)} written twice`, st);
    if (first < 0) first = a;
    const at = site(st);
    if (pass === 'final' && mine(at)) { lines[a] = at.line; if (fresh) starts[a] = 1; if (fileOf) fileOf[a] = fileNo(at.file); }
    fresh = false;
    mem[a] = b; written[a] = 1; pc++;
  };
  const byte = (v: Value, st: Stmt): void => { if (Array.isArray(v)) { for (const x of v) byte(x, st); return; } const n = numberOf(v); if (pass === 'final' && (n < 0 || n > 0xff)) E(`too large for a 8 bit unsigned integer '${n}'`, st); emit(n, st); };
  /** what `.text` writes of a value: a string encoded, a byte string as it is, a number as a byte, a list each */
  const text = (v: Value, st: Stmt) => {
    if (typeof v === 'string') { for (const b of encode(v)) emit(b, st); return; }
    if (v instanceof Uint8Array) { for (const b of v) emit(b, st); return; }
    if (Array.isArray(v)) { for (const x of v) text(x, st); return; }
    byte(v, st);
  };

  const runPass = (final: boolean) => {
    mem = new Uint8Array(0x10000); written = new Uint8Array(0x10000); blocks = [];
    pc = opts.pc ?? 0; off = 0; outer = []; enc = 'none'; cpu = '6502'; unresolved = []; missing = false; first = -1; spaces = []; scope = '';
    anonPrev = anon; anon = [];
    let changed = false;
    const defs = new Set<string>();
    const define = (name: string, v: Value, st: Stmt, variable = false) => {
      const k = keyIn(spaces, name);
      // (a name defined twice keeps its first value, as 64tass)
      if (!variable) { if (defs.has(k)) { E(`duplicate definition '${name}'`, st); return; } defs.add(k); }
      if (final && syms.has(k) && typeof v === 'number' && syms.get(k) !== v && !variable) E(`symbol "${name}" changed value in the final pass`, st);
      const old = syms.get(k);
      if (old !== v && (typeof v === 'number' || !syms.has(k) || (isSpace(v) && isSpace(old) && v.v !== old.v))) changed = true;
      syms.set(k, v);
    };
    const defineVar = (name: string, v: Value) => define(name, v, curStmt ?? stmts[0], true);
    // .if: whether each level is on, whether a branch of it was taken, and whether the level around it is on
    const cond: { on: boolean; taken: boolean; outer: boolean }[] = [];
    const active = () => cond.every(c => c.on);
    const report = (st: Stmt) => { if (unresolved.length) { missing = true; if (final) for (const u of new Set(unresolved)) E(`not defined symbol '${u}'`, st); } unresolved = []; };

    // ---- macros: each call runs the macro's lines with its parameters, a .macro in a block of its own ----
    calls = [];
    let callNo = 0;
    const runCall = (def: TMacro, args: string, st: Stmt) => {
      if (calls.length >= 100) throw new Error(`macros called ${calls.length} deep at ${def.name}: does it call itself without end?`);
      const list = expand(def, args);
      const wasSpaces = spaces, wasScope = scope;
      if (def.kind === 'macro') spaces = [...spaces, st.label && st.label !== '+' && st.label !== '-' ? st.label : `#m${callNo++}`];
      calls.push({ name: def.name, st });
      try { runList(list); } finally { calls.pop(); if (def.kind === 'macro') { spaces = wasSpaces; scope = wasScope; } }
    };

    // ---- functions: each call a block of its own under the top level, its parameters variables in it ----
    let fnNo = 0;
    callFn = (f, args, st) => {
      if (calls.length >= 100) throw new Error(`functions called ${calls.length} deep at ${f.name}: does it call itself without end?`);
      const wasSpaces = spaces, wasScope = scope, wasStmt = curStmt, wasUnresolved = unresolved;
      spaces = [`#f${fnNo++}`]; unresolved = [];
      calls.push({ name: `${f.name}()`, st: st ?? wasStmt ?? f.st });
      try {
        const fixed = f.params.filter(x => !x.rest), rest = f.params.find(x => x.rest);
        if (args.length > fixed.length && !rest) throw new Error(`too many arguments for ${f.name}: it takes ${fixed.length}, not ${args.length}`);
        fixed.forEach((x, i) => {
          let v = args[i];
          if (v === undefined) { if (x.def == null) throw new Error(`not enough arguments for ${f.name}: ${x.name} has none`); v = ev(P(x.def)); }
          if (x.name) defineVar(x.name, v);
        });
        if (rest) defineVar(rest.name, args.slice(fixed.length));
        runList(f.body);
        if (!f.result) return undefined;
        const parts = splitTop(f.result, ',').map(e => ev(P(e)));
        if (parts.some(x => x == null)) return null;
        return parts.length === 1 ? parts[0] : parts;
      } finally {
        calls.pop(); spaces = wasSpaces; scope = wasScope; curStmt = wasStmt;
        unresolved = wasUnresolved.concat(unresolved);
      }
    };
    /** a function's argument as written: `#1` immediate, else its value */
    const argOf = (text: string): Value => { const t = text.trim(); if (t[0] === '#') { const v = ev(P(t.slice(1))); return v == null ? null : { imm: true, v } as Imm; } return ev(P(t)); };

    // ---- sections: the fragments open now, innermost last; each section where its .dsection is ----
    for (const x of sects.values()) {
      x.prevOff0 = x.pc0 != null ? x.off0 : x.prevOff0; x.prevPc0 = x.pc0 ?? x.prevPc0; x.prevSize = x.max;
      x.pc0 = null; x.used = 0; x.max = 0; x.frags = false;
    }
    const open: { sect: Sect; pc: number; off: number }[] = [];
    const newSect = (name: string, key: string): Sect => { const x: Sect = { name, key, pc0: null, off0: 0, used: 0, max: 0, prevPc0: null, prevOff0: 0, prevSize: 0, frags: false }; sects.set(key, x); return x; };
    /** the section `.section name` means: one a fragment open now holds (its .dsection inside it), else the top level's */
    const sectFor = (name: string): Sect => {
      for (let i = open.length - 1; i >= 0; i--) { const x = sects.get(`${open[i].sect.key}/${name}`); if (x) return x; }
      return sects.get(name) ?? newSect(name, name);
    };
    const sectFirst = new Map<Sect, Stmt>();

    // ---- loops: their lines run again and again; a b-loop's each round in a block of its own ----
    let loops = 0, loopNo = 0, rounds = 0;
    /** a variable set: `::=` and `+=` … change the one a name finds (an outer block's too), `:=` sets it here */
    const setVar = (name: string, v: Value, st: Stmt, here: boolean) => {
      if (!here) for (let i = spaces.length; i >= 0; i--) { const k = keyIn(spaces.slice(0, i), name); if (syms.has(k)) { syms.set(k, v); return; } }
      define(name, v, st, true);
    };
    /** `i := 0`, `i = 0`, `i += 1`, `i ::= 2`: an assignment of a .for */
    const assign = (text: string, st: Stmt) => {
      const m = text.trim().match(/^([A-Za-z_]\w*)\s*(::=|:=|=|\+=|-=|\*=|\/=|%=|<<=|>>=|\|=|&=|\^=)\s*(.+)$/);
      if (!m) { if (text.trim()) ev(P(text)); return; }
      const r = ev(P(m[3])); if (r == null) { unresolved.push(m[1]); return; }
      if (m[2] === ':=' || m[2] === '=') { setVar(m[1], r, st, true); return; }
      if (m[2] === '::=') { setVar(m[1], r, st, false); return; }
      const old = lookup(m[1]); if (old === undefined) throw new Error(`not defined symbol '${m[1]}'`);
      setVar(m[1], bin(m[2].slice(0, -1), old, r), st, false);
    };
    /** where the loop that starts at `list[i]` ends (its .next, .endfor …), nested loops counted */
    const ends = new WeakMap<readonly Stmt[], Map<number, number>>();
    const endOf = (list: readonly Stmt[], i: number): number => {
      let m = ends.get(list); if (!m) { m = new Map(); ends.set(list, m); }
      const known = m.get(i); if (known != null) return known;
      let depth = 0, j = i + 1;
      for (; j < list.length; j++) { const b = list[j].body; if (LOOP.test(b)) depth++; else if (LOOP_END.test(b)) { if (!depth) break; depth--; } }
      const end = j < list.length ? j : -1; m.set(i, end); return end;
    };
    const runLoop = (b: boolean, kind: string, head: string, body: readonly Stmt[], st: Stmt): Space[] => {
      const scopes: Space[] = [];
      /** a round of the loop: false when it .breaks */
      const round = (): boolean => {
        if (++rounds > 100_000) { stuck = true; throw new Error(`.${kind} went round 100000 times: does its condition ever turn false?`); }
        const wasSpaces = spaces, wasScope = scope, depth = cond.length;
        if (b) { const name = `#l${loopNo++}`; scopes.push({ space: keyIn(spaces, name), v: pc }); spaces = [...spaces, name]; }
        loops++;
        try { runList(body); }
        catch (err) { if (!(err instanceof LoopSignal)) throw err; cond.length = depth; if (err.kind === 'break') return false; }
        finally { loops--; if (b) { spaces = wasSpaces; scope = wasScope; } }
        if (cond.length !== depth) { E(`an .if in the .${kind} is not closed in it`, st); cond.length = depth; }
        return true;
      };
      const test = (c: string) => { const v = ev(P(c)); report(st); return v != null && truth(v); };
      if (kind === 'rept') { const n = evn(head); report(st); for (let i = 0; i < (n ?? 0); i++) if (!round()) break; return scopes; }
      if (kind === 'while') { while (test(head)) if (!round()) break; return scopes; }
      const inForm = head.match(/^([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*)\s+in\s+(.+)$/);
      if (inForm) {
        const names = inForm[1].split(',').map(x => x.trim()), parts = splitTop(inForm[2], ',');
        const v = parts.length > 1 ? parts.map(x => ev(P(x))) : ev(P(inForm[2]));
        report(st);
        if (v == null || (Array.isArray(v) && v.some(x => x == null))) return scopes;
        const items: Value[] = Array.isArray(v) ? v : v instanceof Uint8Array ? [...v] : typeof v === 'string' ? [...v] : [v];
        for (const it of items) {
          if (names.length > 1) { if (!Array.isArray(it) || it.length !== names.length) throw new Error(`${names.length} variables, but a value of ${Array.isArray(it) ? it.length : 1}`); names.forEach((n, i) => setVar(n, it[i], st, true)); }
          else setVar(names[0], it, st, true);
          if (!round()) break;
        }
        return scopes;
      }
      const [init = '', c = '', step = ''] = splitTop(head, ',');
      assign(init, st); report(st);
      for (;;) {
        if (c.trim() && !test(c)) break;
        if (!round()) break;
        assign(step, st); report(st);
      }
      return scopes;
    };

    const runList = (list: readonly Stmt[]): void => { for (let ix = 0; ix < list.length; ix++) { const st = list[ix];
      curStmt = st; fresh = true;
      const s = st.body;
      try {
        let m: RegExpMatchArray | null;
        // the conditions, followed in every branch to find their ends
        if ((m = s.match(/^\.(if|elsif|else|endif|fi)\b\s*(.*)$/))) {
          const top = cond[cond.length - 1];
          const test = () => { const v = ev(P(m![2])); if (v == null) return false; return truth(v); };
          switch (m[1]) {
            case 'if': { const o = active(), v = o && test(); cond.push({ on: v, taken: v, outer: o }); break; }
            case 'elsif': if (!top) E('.elsif without .if', st); else { const v = top.outer && !top.taken && test(); top.on = v; top.taken ||= v; } break;
            case 'else': if (!top) E('.else without .if', st); else { top.on = top.outer && !top.taken; top.taken = true; } break;
            default: if (!cond.pop()) E(`.${m[1]} without .if`, st);
          }
          report(st);
          continue;
        }
        if (!active()) continue;
        // (a macro's lines are the call's: the program counter at a line is the line's own only)
        if (final && st.file === entryPath && !calls.length) linePcs.set(st.line, pc);
        const call = callOf(s), fcall = call ? null : fnCallOf(s);
        // a function called as an instruction: its lines; a label before it gets its result (the address when none)
        if (fcall) {
          const args = fcall.args.trim() ? splitTop(fcall.args, ',').map(argOf) : [];
          if (st.label === '+' || st.label === '-') anon.push({ dir: st.label, v: pc });
          const here = pc, r = args.some(a => a == null) ? null : callFn(fcall.def, args, st);
          if (st.label && st.label !== '+' && st.label !== '-') {
            const local = st.label.startsWith('_') && scope ? `${scope}.${st.label}` : st.label;
            if (r !== undefined) { if (r != null) define(local, r, st); }
            else { define(local, here, st); if (!st.label.startsWith('_')) scope = st.label; }
          }
          report(st);
          continue;
        }
        // a label: an anonymous one, `name = value`, `name := value`, a namespace, or the address here; one that
        // starts with _ is local to the code label before it (`loop._x`); one before a .macro's call names its block
        if (st.label === '+' || st.label === '-') anon.push({ dir: st.label, v: pc });
        else if (st.label) {
          const local = st.label.startsWith('_') && scope ? `${scope}.${st.label}` : st.label;
          if ((m = s.match(/^(:?)=(?!=)\s*(.+)$/))) { const v = ev(P(m[2])); if (v != null) define(local, v, st, m[1] === ':'); report(st); continue; }
          // a variable changed: `n += 1`, `n ::= 2` (the one the name finds)
          if (/^(::|\+|-|\*|\/|%|<<|>>|\||&|\^)=/.test(s)) { assign(`${local} ${s}`, st); report(st); continue; }
          if (/^\.(namespace|block)\b/.test(s) || call?.def.kind === 'macro') {
            define(st.label, { space: keyIn(spaces, st.label), ...(/^\.namespace\b/.test(s) ? {} : { v: pc }) } as Space, st);
            if (call) { runCall(call.def, call.args, st); continue; }
            spaces = [...spaces, st.label];
            continue;
          }
          // (a b-loop's label is the list of its rounds' blocks, set when it ends)
          if (!/^\.b(for|rept|while)\b/.test(s)) { define(local, pc, st); if (!st.label.startsWith('_')) scope = st.label; }
        }
        if (call) { runCall(call.def, call.args, st); continue; }
        // a loop: its lines up to its end, again and again
        if ((m = s.match(LOOP))) {
          const end = endOf(list, ix);
          // (one not closed takes the rest of the lines with it, as 64tass)
          if (end < 0) { E(`closing directive '.end${m[2]}' not found`, st); ix = list.length; continue; }
          const b = m[1] === 'b', label = st.label && st.label !== '+' && st.label !== '-' ? st.label : null;
          try { const scopes = runLoop(b, m[2], m[3].trim(), list.slice(ix + 1, end), st); if (b && label) define(label, scopes, st); }
          finally { ix = end; }
          continue;
        }
        if (LOOP_END.test(s)) { E(`${s.split(/\s/)[0]} without a loop`, st); continue; }
        if ((m = s.match(/^\.(break|continue)(if)?\b\s*(.*)$/))) {
          if (!loops) { E('.break or .continue must be used within a loop', st); continue; }
          if (m[2]) { const v = ev(P(m[3])); report(st); if (v == null || !truth(v)) continue; }
          throw new LoopSignal(m[1] as 'break' | 'continue');
        }
        if (!s) continue;
        // a macro's call that names no macro
        if ((m = s.match(/^#([A-Za-z_]\w*)\b/))) { E(`not defined symbol '${m[1]}' (no macro of that name)`, st); continue; }
        // sections: where they go (.dsection), and their fragments (.section … .send)
        if ((m = s.match(/^\.dsection\s+([A-Za-z_]\w*)$/))) {
          const key = (open.length ? `${open[open.length - 1].sect.key}/` : '') + m[1];
          const x = sects.get(key) ?? newSect(m[1], key);
          if (x.pc0 != null) { E(`duplicate definition '${m[1]}'`, st); continue; }
          x.pc0 = pc; x.off0 = off;
          // the room its fragments took: they are compiled where they are written
          pc += Math.max(x.prevSize, x.max);
          continue;
        }
        if ((m = s.match(/^\.section\s+([A-Za-z_]\w*)$/))) {
          const x = sectFor(m[1]);
          x.frags = true; if (!sectFirst.has(x)) sectFirst.set(x, st);
          open.push({ sect: x, pc, off });
          pc = (x.pc0 ?? x.prevPc0 ?? 0) + x.used; off = x.pc0 != null ? x.off0 : x.prevOff0;
          continue;
        }
        if ((m = s.match(/^\.(send|endsection)\b\s*(.*)$/))) {
          const top = open.pop();
          if (!top) { E(`.${m[1]} without .section`, st); continue; }
          if (m[2].trim() && m[2].trim() !== top.sect.name) E(`wrong reference: .${m[1]} ${m[2].trim()} closes the .section ${top.sect.name}`, st);
          top.sect.used = pc - (top.sect.pc0 ?? top.sect.prevPc0 ?? 0); top.sect.max = Math.max(top.sect.max, top.sect.used);
          pc = top.pc; off = top.off;
          continue;
        }
        if (/^\.(endnamespace|bend|endblock)$/.test(s)) { if (!spaces.length) E(`${s} without .namespace`, st); else spaces = spaces.slice(0, -1); continue; }
        if (/^\.(namespace|block)$/.test(s)) { spaces = [...spaces, `#${st.line}`]; continue; }
        // a namespace opened again by its name (`.namespace bank03`: a bank's next chip)
        if ((m = s.match(/^\.namespace\s+(.+)$/))) {
          const v = ev(P(m[1])); report(st);
          if (isSpace(v)) spaces = v.space.split('.'); else if (final) E(`${m[1]} is not a namespace`, st);
          continue;
        }
        // (inside .logical the program counter moves and the bytes with it, as in 64tass: `off` stays)
        if ((m = s.match(/^\*\s*=\s*(.+)$/))) { const v = evn(m[1]); if (v != null) pc = v; blocks.push({ start: pc, name: st.cmt ?? '' }); report(st); continue; }
        // an encoding's characters: `.cdef " ~", 32` (a range given by its first and last character), `.cdef 32, 126, 32`
        if ((m = s.match(/^\.cdef\s+(.+)$/))) {
          const args = splitTop(m[1], ',').map(a => ev(P(a)));
          const table = userEnc.get(enc) ?? new Map<string, number>(); userEnc.set(enc, table);
          for (let k = 0; k < args.length;) {
            let from: number, to: number;
            if (typeof args[k] === 'string' && [...args[k]].length === 2) { [from, to] = [...args[k]].map((c: string) => c.codePointAt(0)!); k++; }
            else { from = typeof args[k] === 'string' ? args[k].codePointAt(0) : numberOf(args[k]); to = typeof args[k + 1] === 'string' ? args[k + 1].codePointAt(0) : numberOf(args[k + 1]); k += 2; }
            const at = numberOf(args[k++]);
            for (let c = from; c <= to; c++) table.set(String.fromCodePoint(c), (at + c - from) & 0xff);
          }
          continue;
        }
        // a message (64tass prints it as a warning; a script's output shows it as Kick Assembler's .print), an error
        if ((m = s.match(/^\.(warn|error)\b\s*(.*)$/))) {
          const parts = splitTop(m[2], ',').filter(a => a !== '').map(a => ev(P(a)));
          report(st);
          if (final && parts.every(p => p != null)) {
            const text = parts.map(p => (typeof p === 'string' ? p : typeof p === 'number' || typeof p === 'boolean' ? String(numberOf(p)) : '')).join('');
            if (m[1] === 'warn') prints.push(text); else E(text || '.error', st);
          }
          continue;
        }
        // a condition that stops the build with its message (Kick Assembler's .errorif)
        if ((m = s.match(/^\.(cerror|cwarn)\s+(.+)$/))) {
          const [c, msg] = splitTop(m[2], ',');
          const v = ev(P(c)); const text = msg ? ev(P(msg)) : null;
          if (final && v != null && truth(v) && m[1] === 'cerror') E(typeof text === 'string' ? text : 'a .cerror condition is true', st);
          report(st);
          continue;
        }
        if ((m = s.match(/^\.logical\s+(.+)$/))) { const v = evn(m[1]); report(st); outer.push(off); if (v != null) { off += v - pc; pc = v; } continue; }
        if (/^\.(here|endlogical)$/.test(s)) { if (!outer.length) { E(`${s} without .logical`, st); continue; } const was = outer.pop()!; pc -= off - was; off = was; continue; }
        if ((m = s.match(/^\.enc\s+(.+)$/))) { const v = ev(P(m[1])); if (typeof v === 'string') enc = v; report(st); continue; }
        if ((m = s.match(/^\.cpu\s+(.+)$/))) { const v = ev(P(m[1])); if (typeof v === 'string') cpu = v === 'default' ? '6502' : v; continue; }
        // .align n: on to the next multiple of n, the gap not written (as 64tass leaves it); .align n, v fills it with v
        if ((m = s.match(/^\.align\b\s*(.*)$/))) {
          const [na, fa] = splitTop(m[1], ',').map(a => a.trim());
          const n = na ? evn(na) : null;
          if (n == null || n <= 0) { if (final) E('.align needs a positive number', st); report(st); continue; }
          if (fa) { const v = ev(P(fa)); while (pc % n) byte(v ?? 0, st); }
          else pc += (n - (pc % n)) % n;
          report(st);
          continue;
        }
        if ((m = s.match(/^\.(byte|word|addr|text|null|fill|binary)\b\s*(.*)$/))) {
          const dir = m[1], args = splitTop(m[2], ',').filter(a => a !== '');
          // (`?`: room for the value, nothing written)
          if (dir === 'byte') for (const a of args) { if (a === '?') { pc++; continue; } const v = ev(P(a)); if (v == null) emit(0, st); else byte(v, st); }
          else if (dir === 'word' || dir === 'addr') for (const a of args) { if (a === '?') { pc += 2; continue; } const v = ev(P(a)); for (const x of Array.isArray(v) ? v : [v]) { const n = x == null ? 0 : numberOf(x); if (final && (n < 0 || n > 0xffff)) E(`too large for a 16 bit unsigned integer '${n}'`, st); emit(n & 0xff, st); emit((n >> 8) & 0xff, st); } }
          else if (dir === 'text' || dir === 'null') {
            const from = pc;
            for (const a of args) { const v = ev(P(a)); if (v == null) emit(0, st); else text(v, st); }
            if (dir === 'null') {
              for (let x = from; x < pc; x++) if (final && mem[(x - off) & 0xffff] === 0) { E('null in string (.null adds the zero byte)', st); break; }
              emit(0, st);
            }
          } else if (dir === 'fill') {
            const n = evn(args[0]); if (n == null) { report(st); continue; }
            if (args[1] == null) { pc += n; continue; } // no value: room only, nothing written
            const v = ev(P(args[1]));
            const pat = v == null ? [0] : v instanceof Uint8Array ? [...v] : [numberOf(v)];
            for (let i = 0; i < n; i++) emit(pat[i % pat.length], st);
          } else {
            const path = ev(P(args[0])); const u = vfs[importPath(vfs, st.file, path)];
            if (!(u instanceof Uint8Array)) { E(`can't open file "${path}"`, st); continue; }
            const o = args[1] ? evn(args[1]) ?? 0 : 0; const len = args[2] ? evn(args[2]) ?? 0 : u.length - o;
            for (let i = 0; i < len && o + i < u.length; i++) emit(u[o + i], st);
          }
          report(st);
          continue;
        }
        // an instruction: its mnemonic (lower case with -C), then the operand
        if ((m = s.match(/^([a-z]{3})(?:\s+(.*))?$/)) && TASS_ENC[m[1].toUpperCase()]) {
          const mn = m[1].toUpperCase(), modes = TASS_ENC[mn]!;
          let arg = (m[2] || '').trim(), force: 'w' | 'b' | '' = '';
          const f = arg.match(/^@([wbl])\s*(.*)$/);
          if (f) { force = f[1] === 'b' ? 'b' : 'w'; arg = f[2].trim(); }
          let mode: string, ex: string | null = null;
          if (!arg || (arg === 'a' && IMPLIED_ACC.has(mn))) mode = IMPLIED_ACC.has(mn) ? 'acc' : 'imp';
          else if (arg[0] === '#') { mode = 'imm'; ex = arg.slice(1); }
          else if ((m = arg.match(/^\((.+),\s*x\s*\)$/))) { mode = 'izx'; ex = m[1]; }
          else if ((m = arg.match(/^\((.+)\)\s*,\s*y$/))) { mode = 'izy'; ex = m[1]; }
          else if ((m = arg.match(/^\((.+)\)$/)) && mn === 'JMP') { mode = 'ind'; ex = m[1]; }
          else if ((m = arg.match(/^(.+),\s*([xy])$/))) { ex = m[1]; mode = m[2]; }
          else { ex = arg; mode = 'plain'; }
          // (a function's argument written #1 is immediate: lda value is lda #1)
          const raw = ex != null ? ev(P(ex)) : null;
          if (isImm(raw) && mode === 'plain') mode = 'imm';
          const v = raw == null ? null : numberOf(raw);
          if (BRANCH.has(mn)) mode = 'rel';
          else if (mode === 'plain' || mode === 'x' || mode === 'y') {
            const suf = mode === 'plain' ? '' : mode;
            const zpOk = modes[('zp' + suf) as AddrMode] !== undefined, absOk = modes[('ab' + (suf || 's')) as AddrMode] !== undefined;
            const wantZp = force === 'b' || (force !== 'w' && v != null && v >= 0 && v < 0x100);
            mode = (wantZp && zpOk) ? 'zp' + suf : absOk ? (suf ? 'ab' + suf : 'abs') : 'zp' + suf;
          }
          const op = modes[mode as AddrMode];
          if (op === undefined) { E(`not a valid addressing mode for ${mn.toLowerCase()} (${mode})`, st); continue; }
          if (OPC[op].ill && cpu !== '6502i') { E(`${mn.toLowerCase()} is an undocumented opcode: it needs .cpu "6502i"`, st); continue; }
          emit(op, st);
          if (pass === 'final' && mine(site(st))) ops[(pc - off - 1) & 0xffff] = 1;
          const len = MODE_LEN[mode as AddrMode];
          if (mode === 'rel') {
            const o = v == null ? 0 : v - (pc + 1);
            if (final && (o < -128 || o > 127)) E(`branch too far (${o})`, st);
            emit(o & 0xff, st);
          } else if (len === 2) { if (final && v != null && (v < -128 || v > 255)) E(`too large for a 8 bit unsigned integer '${v}'`, st); emit(v ?? 0, st); }
          else if (len === 3) { if (final && v != null && (v < 0 || v > 0xffff)) E(`too large for a 16 bit unsigned integer '${v}'`, st); emit((v ?? 0) & 0xff, st); emit(((v ?? 0) >> 8) & 0xff, st); }
          report(st);
          continue;
        }
        E(`general syntax: ${s}`, st);
      } catch (err) { if (err instanceof LoopSignal) throw err; E((err as Error).message, st); if (unresolved.length) missing = true; unresolved = []; }
    } };
    runList(stmts);
    if (open.length && final) E(`.section without .send (${open.map(o => o.sect.name).join(', ')})`, open[0] && sectFirst.get(open[0].sect));
    for (const x of sects.values()) {
      if (x.frags && x.pc0 == null && final) E(`not defined section '${x.name}': its bytes go where a .dsection ${x.name} is`, sectFirst.get(x));
      // a section that moved or grew takes another pass
      if (x.pc0 !== x.prevPc0 || x.max !== x.prevSize) changed = true;
    }
    if (cond.length && final) E(`.if without .endif (${cond.length} open)`);
    if (outer.length && final) E(`.logical without .here (${outer.length} open)`);
    if (final) endPc = pc;
    return changed;
  };
  for (pass = 1; pass <= 12; pass++) { const ch = runPass(false); if (stuck || (!ch && !missing && pass > 1)) break; }
  pass = 'final';
  runPass(true);
  let min = -1, max = -1;
  for (let a = 0; a < 0x10000; a++) if (written[a]) { if (min < 0) min = a; max = a; }
  let prg: Uint8Array | null = null;
  if (min >= 0) { prg = new Uint8Array(max - min + 3); prg[0] = min & 0xff; prg[1] = min >> 8; prg.set(mem.subarray(min, max + 1), 2); }
  const said = new Set<string>();
  const once = errors.filter(e => { const k = `${e.file}:${e.line}:${e.msg}`; if (said.has(k)) return false; said.add(k); return true; });
  // the memory map: each `* =` with a name as its comment (`* = $0810 ; Code`), to the next one
  const blockList = blocks.filter(b => b.name).map((b, i, arr) => ({ start: b.start, name: b.name, end: i + 1 < arr.length ? arr[i + 1].start - 1 : max }));
  return { mem, written, min, max, errors: once, prg, blocks: blockList, symbols: syms, prints, first, external, lines, starts, ops, linePcs, endPc, ...(fileOf ? { fileOf, fileNames } : {}) };
}
