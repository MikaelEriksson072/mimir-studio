/* =====================================================================
 * Assembles the 64tass subset that the generator writes for 64tass (spec 11.8), as 64tass 1.57 does with -a -C:
 * labels at the start of a line (`name:` or `name`), `name = value`, `name := value`, the anonymous labels `+` and
 * `-` (`bne -`, `.word (+)`), `* = address`, `.logical`/`.here`, `.if`/`.elsif`/`.else`/`.endif`, `.namespace` and
 * `.block` scopes read as `name.label`, `.include`, `.cpu`, `.enc "none"`/`"screen"` (the -a tables), `.byte`,
 * `.word`, `.text`, `.null`, `.fill`, `.binary`, `.comment`/`.endc`, `@w`/`@b`/`@l` before an operand, every addressing
 * mode of the NMOS 6510 with 64tass's names of the undocumented opcodes (with `.cpu "6502i"`) and of the 65C02, R65C02,
 * W65C02 and 65816 (`.cpu "65816"`, tass-cpu.ts: the address's size from `.dpage` and `.databank`, the immediates'
 * from `.al`/`.xl` or REP/SEP with `.autsiz`), and the expressions
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
 * Floating point: `1.5`, `1e3`, `1.5p3`, `pi`, the math functions (sin, cos, sqrt, floor, round, trunc, frac …, over a
 * list each), `/` dividing as floats when either side is one, rounded down where an integer is needed (as 64tass).
 * Structures and unions: anonymous ones compiled in place (a union's lines each where it starts, as long as its longest),
 * named ones (`nn_s .struct col, row` … `.ends`) giving their fields' offsets (`nn_s.x`) and instances by
 * `nn .dstruct nn_s, 1, 2`, `.dunion` or `.nn_s 1, 2` (`nn.x`; a field not given `?`). `.virtual [address]` … `.endv`:
 * compiled, nothing written. The TASM forms `.lbl`/`.goto`, `name .var value` and `.ifne`, `.ifeq`, `.ifpl`, `.ifmi`.
 * More data: `.char`, `.rta` (address - 1), `.sint`, `.long`, `.lint`, `.dword`, `.dint`, `.ptext`, `.shift`, `.shiftl`, and
 * `.eor` over all that is written; `.proc` … `.pend` compiled only where its name is used, `.page` … `.endp`, `.offs`,
 * `.weak` … `.endweak` (a stronger definition wins), `.with`, `.endn`, `.switch`/`.case`/`.default`, `.end`,
 * `.option allow_branch_across_page`, `.binclude`, own encodings (`.encode` … `.endencode`, `.tdef`, `.edef`) and
 * dictionaries (`{1: 15, :0}[x]`, `{.x: 24}.x`); `random()` and `.seed` as 64tass draws (its xorshift128+), the operators
 * `x` (repeat) and ` (bank byte); the listing directives are taken and do nothing.
 * Sections: `.dsection name` where the bytes of every `.section name` … `.send` go, as 64tass, nested too; `.byte ?`,
 * `.word ?`, `.addr ?` take room only. Several passes until the sizes settle, as 64tass. The desktop app and the CLI
 * can additionally run the real 64tass.
 * ===================================================================== */
import type { AsmError, AssembleResult, Vfs } from '../types';
import { TASS_ENC } from '../cpu/opcodes';
import { ACCU_IMM, alwaysBranch, CPU_MODE_LEN, cpuOp, INDEX_IMM, OPPOSITE, REG_FORMS, REL16_FROM, tassCpu, WIDE_CPUS, type CpuMode, type TassCpu } from './tass-cpu';
import { h4 } from '../util/hex';
import { importPath, type AssembleOptions } from './kick-subset-assembler';

/** a statement: its label, its body and (`cmt`) the comment after it, which a `* =` line's names its block by */
interface Stmt { file: string; line: number; src: string; label?: string; body: string; cmt?: string; bare?: boolean }

type Tok = { t: 'n'; v: number; f?: boolean } | { t: 's'; v: string } | { t: 'id'; v: string } | { t: 'op'; v: string };
type Node =
  | { k: 'n'; v: number; f?: boolean } | { k: 's'; v: string } | { k: 'pc' } | { k: 'id'; v: string } | { k: 'anon'; dir: '+' | '-'; n: number }
  | { k: 'mem'; o: Node; v: string } | { k: 'call'; f: Node; args: Node[] } | { k: 'list'; items: Node[] }
  | { k: 'dict'; items: { key: Node | null; sym?: string; val: Node }[] }
  | { k: 'idx'; o: Node; i: Node } | { k: 'slice'; o: Node; a: Node | null; b: Node | null }
  | { k: 'u'; op: string; a: Node } | { k: 'b'; op: string; a: Node; b: Node } | { k: 'q'; c: Node; a: Node; b: Node };
// numbers, booleans, strings (characters), byte strings (Uint8Array), lists and namespaces
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Value = any;

/** binary operators by precedence (higher binds tighter) */
const BIN: Record<string, number> = {
  '||': 1, '^^': 1, '&&': 2, '|': 3, '^': 4, '&': 5, '==': 6, '!=': 6, '<': 6, '<=': 6, '>': 6, '>=': 6, '<<': 7, '>>': 7, '+': 8, '-': 8, '*': 9, '/': 9, '%': 9, x: 9, '**': 10,
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

/** the namespace a `.namespace` or `.block` label (or a macro call's) stands for, and the address where it starts */
interface Space { space: string; v?: number }
/** a macro (`.macro`: a block of its own; `.segment`: none): its parameters with their defaults and its lines */
interface TMacro { kind: 'macro' | 'segment' | 'struct' | 'union'; name: string; params: { name: string; def: string | null }[]; lines: { raw: string; line: number }[]; file: string }
/** a function (`.function` … `.endf result`, or `.sfunction`): its parameters (`*rest` takes the rest as a list), its
 *  lines and the expressions it gives */
interface TFunc { name: string; params: { name: string; def: string | null; rest: boolean }[]; body: Stmt[]; result: string; st: Stmt }
/** an immediate value: a function's argument written `#1` (`lda value` is then lda #1) */
interface Imm { imm: true; v: Value }
const isImm = (v: Value): v is Imm => !!v && typeof v === 'object' && v.imm === true;
/** a floating-point value (`1.5`, `1e3`, `pi`, `sin()`): where an integer is needed it is rounded down, as 64tass does */
class Flt { constructor(readonly f: number) {} }
const isFlt = (v: Value): v is Flt => v instanceof Flt;
/** a dictionary: its values by key (`n:1`, `s:text`, `.:symbol`) and the one for a key it does not have */
class Dict { constructor(readonly map: Map<string, Value>, readonly def: Value | undefined) {} }
const isDict = (v: Value): v is Dict => v instanceof Dict;
/** an encoding a label stands for (`abc .encode`): `.encode abc`, `.enc abc`, and abc("text") its bytes */
class EncRef { constructor(readonly name: string) {} }
const isEnc = (v: Value): v is EncRef => v instanceof EncRef;
/** the bytes and signedness of the number directives */
const SIZED: Record<string, [number, boolean]> = { char: [1, true], rta: [2, false], sint: [2, true], long: [3, false], lint: [3, true], dword: [4, false], dint: [4, true] };
/** what .break and .continue throw to the loop they are in */
class LoopSignal { constructor(readonly kind: 'break' | 'continue') {} }
/** a loop's first line, and the lines that end one */
const LOOP = /^\.(b?)(for|rept|while)\b\s*(.*)$/, LOOP_END = /^\.(next|endfor|endrept|endwhile)\b/;
/** a section: where its .dsection put it in this pass and the last (pc, and the offset of a .logical), how much its
 *  fragments took so far and at most */
interface Sect { name: string; key: string; pc0: number | null; off0: number; used: number; max: number; prevPc0: number | null; prevOff0: number; prevSize: number; frags: boolean }
const isSpace = (v: Value): v is Space => !!v && typeof v === 'object' && typeof v.space === 'string';

const typeName = (v: Value) => v instanceof Flt ? 'float' : v instanceof Dict ? 'dict' : v instanceof EncRef ? 'encoding' : typeof v === 'boolean' ? 'bool' : typeof v === 'string' ? 'str' : typeof v === 'number' ? 'int' : v instanceof Uint8Array ? 'bytes' : Array.isArray(v) ? 'list' : 'namespace';

/** `s` split at `sep` where it is outside strings, parentheses and brackets */
function splitTop(s: string, sep: string): string[] {
  const out: string[] = []; let depth = 0, q = '', cur = '';
  for (let k = 0; k < s.length; k++) {
    const c = s[k];
    if (q) { cur += c; if (c === q) q = ''; continue; }
    if (c === '"' || c === "'") { q = c; cur += c; continue; }
    if (c === '(' || c === '[' || c === '{') depth++;
    if (c === ')' || c === ']' || c === '}') depth--;
    if (!depth && c === sep) { out.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim() || out.length) out.push(cur.trim());
  return out;
}

/** where the bracket opening at `i` closes (outside strings), or -1 */
function closer(s: string, i: number): number {
  let depth = 0, q = '';
  for (let k = i; k < s.length; k++) {
    const c = s[k];
    if (q) { if (c === q) q = ''; continue; }
    if (c === '"' || c === "'") { q = c; continue; }
    if (c === '(' || c === '[' || c === '{') depth++;
    else if ((c === ')' || c === ']' || c === '}') && --depth === 0) return k;
  }
  return -1;
}
/** how an instruction's operand is taken: from the direct page or data bank 64tass is set to (`auto`), as it is written
 *  (`#n,d`, `#n,b`, `#n,s`), as a jump's address in its program bank (`k`), or as an address in bank 0 (`jmp ($1234)`) */
type How = 'auto' | 'as-is' | 'k' | 'bank0';
/** an instruction's operand as 64tass reads it: `(`…`)` or `[`…`]` around all of it (or before `,y`), the parts inside
 *  split at the commas, and those after it; `($12)+1` is an expression */
function operandOf(arg: string): { br: '' | '(' | '['; inner: string[]; after: string[] } {
  if (arg[0] === '(' || arg[0] === '[') {
    const j = closer(arg, 0), rest = j > 0 ? arg.slice(j + 1).trim() : null;
    if (rest != null && (!rest || rest[0] === ',')) return { br: arg[0] as '(' | '[', inner: splitTop(arg.slice(1, j), ','), after: rest ? splitTop(rest.slice(1), ',').map(x => x.toLowerCase()) : [] };
  }
  return { br: '', inner: splitTop(arg, ','), after: [] };
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
    const v0 = args[i++], v = v0 instanceof Flt ? v0.f : v0;
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
    let label: string | undefined, rest = line, bare = false;
    if (line && !/^\s/.test(line)) {
      // at the start of a line: a label (`name:`, `name`, `+`, `-`), else `*` or a directive
      // (a mnemonic there, in lower case, is the instruction, as 64tass reads `lda #1` at the start of a line; one only
      // another processor has is looked at again where it is run: `bare`, a label without its colon)
      const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*|[+-])(:?)(?=\s|$|=)/);
      if (m && !(!m[2] && /^[a-z]{3}$/.test(m[1]) && TASS_ENC[m[1].toUpperCase()])) { label = m[1]; rest = line.slice(m[0].length); bare = !m[2] && /^[a-z]{3}$/.test(m[1]); }
    }
    return { file: path, line: no, src: raw, ...(label ? { label } : {}), body: rest.trim(), ...(cmt ? { cmt } : {}), ...(bare ? { bare } : {}) };
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
        const agg = def.kind === 'struct' || def.kind === 'union';
        if (agg ? /^\.(struct|union)\b/.test(body) : /^\.(macro|segment)\b/.test(body)) inner++;
        else if (agg ? /^\.(ends|endstruct|endu|endunion)\b/.test(body) : /^\.(endm|endmacro|endsegment)\b/.test(body)) { if (inner) inner--; else { def = null; return; } }
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
      // (a named .struct or .union is a definition, where its fields' offsets are found; an anonymous one is compiled in place)
      const md = body.match(/^\.(macro|segment)\b\s*(.*)$/) ?? (label && label !== '+' && label !== '-' ? body.match(/^\.(struct|union)\b\s*(.*)$/) : null);
      if (md && (md[1] === 'struct' || md[1] === 'union')) stmts.push({ ...st, label: undefined, body: `\u0001${md[1]} ${label}` });
      if (md) {
        def = { kind: md[1] as TMacro['kind'], name: label ?? '', params: md[2].trim() ? splitTop(md[2], ',').map(p => { const [n, d] = p.split('='); return { name: n.trim(), def: d == null ? null : d.trim() }; }) : [], lines: [], file: path };
        if (!label || label === '+' || label === '-') E(`a .${md[1]} needs its name before it (name .${md[1]})`, st);
        else if (macros.has(label)) E(`duplicate definition '${label}'`, st);
        else macros.set(label, def);
        return;
      }
      // .binclude: a source included in a block of its own (a label before it names the block)
      const binc = body.match(/^\.binclude\s+"([^"]+)"$/);
      if (binc) { stmts.push({ ...st, body: '.block' }); loadFile(importPath(vfs, path, binc[1]), depth + 1); stmts.push({ ...st, label: undefined, body: '.bend' }); return; }
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
  // the command line's -D NAME=value: constants defined before the first line (a problem in one is the command line's)
  opts.defines?.forEach((d, i) => stmts.push(parseLine(`${d.name}=${d.value ?? '0'}`, '<command line>', i + 1)));
  loadFile(entryPath, 0);
  /** a macro's lines for a call with these parameters (as text): each reference replaced outside strings and comments */
  const expanded = new Map<string, Stmt[]>();
  const expand = (def: TMacro, argText: string): Stmt[] => {
    const key = `${def.name}\u0000${argText}`;
    const done = expanded.get(key); if (done) return done;
    const given = argText.trim() ? splitTop(argText, ',') : [];
    // (a structure's or union's field not given is ? : room, nothing written)
    const unset = def.kind === 'struct' || def.kind === 'union' ? '?' : '';
    const texts = Array.from({ length: Math.max(given.length, def.params.length) }, (_, i) => (given[i] ?? '') !== '' ? given[i] : (def.params[i]?.def ?? unset));
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
          if ((m = r.match(/^[1-9]/))) { out += texts[+m[0] - 1] ?? unset; k += 1; continue; }
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
    // an instance of a structure or union: .dstruct name, … / .dunion name, …
    const d = body.match(/^\.(dstruct|dunion)\s+([A-Za-z_]\w*)\s*(?:,\s*(.*))?$/);
    if (d) { const def = macros.get(d[2]); return def && (def.kind === 'struct' || def.kind === 'union') ? { def, args: d[3] ?? '' } : null; }
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
      if (/[0-9]/.test(c)) {
        // (a point or an exponent makes it a float: 1.5, 1e3, and 1.5p3 = 1.5 * 2 ** 3)
        const m = s.slice(i).match(/^[0-9][0-9_]*(\.[0-9][0-9_]*)?([eEpP][+-]?[0-9]+)?/)!, txt = m[0].replace(/_/g, '');
        if (m[1] || m[2]) { const [mant, exp] = txt.split(/[eEpP]/); let v = parseFloat(mant); if (m[2]) v *= /[pP]/.test(m[2]) ? 2 ** +exp : 10 ** +exp; out.push({ t: 'n', v, f: true }); }
        else out.push({ t: 'n', v: parseInt(txt, 10) });
        i += m[0].length; continue;
      }
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
      if ('+-*/%&|^<>(),.!~?:[]{}`'.includes(c)) { out.push({ t: 'op', v: c }); i++; continue; }
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
      if (t.t === 'n') return post({ k: 'n', v: t.v, ...(t.f ? { f: true } : {}) });
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
      // a dictionary: `{1: 15, "a": 2, .x: 24, :0}` (`:value` for a key it does not have)
      if (t.v === '{') {
        const items: { key: Node | null; sym?: string; val: Node }[] = [];
        if (!isOp(peek(), '}')) for (;;) {
          if (isOp(peek(), ':')) { next(); items.push({ key: null, val: full() }); }
          else if (isOp(peek(), '.') && peek(1)?.t === 'id') { next(); const sym = (next() as { v: string }).v; if (!isOp(next(), ':')) throw new Error(`missing : in "${s}"`); items.push({ key: null, sym, val: full() }); }
          else { const key = expr(1); if (!isOp(next(), ':')) throw new Error(`missing : in "${s}"`); items.push({ key, val: full() }); }
          const c = next(); if (isOp(c, '}')) break; if (!isOp(c, ',')) throw new Error(`bad dictionary in "${s}"`);
        } else next();
        return post({ k: 'dict', items });
      }
      if (t.v === '[') {
        const items: Node[] = [];
        if (!isOp(peek(), ']')) for (;;) { items.push(full()); const c = next(); if (isOp(c, ']')) break; if (!isOp(c, ',')) throw new Error(`bad list in "${s}"`); } else next();
        return post({ k: 'list', items });
      }
      // `<` and `>` take all of the expression after them (64tass: `<label+10` is `<(label+10)`)
      if (t.v === '<' || t.v === '>' || t.v === '`') return { k: 'u', op: t.v, a: full() };
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
        // (`x`, the repeat, is a word with spaces around it: [0] x 8)
        const o = t?.t === 'id' && t.v === 'x' ? 'x' : t?.t === 'op' ? t.v : null;
        if (!o || !BIN[o] || BIN[o] < minP) break;
        next(); const right = expr(o === '**' ? BIN[o] : BIN[o] + 1); left = { k: 'b', op: o, a: left, b: right };
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
  let enc = 'none';
  // the processor (.cpu, or the command line's), and the 65816's: the direct page and data bank addresses are chosen in
  // (null: none), the accumulator's and index registers' immediates 16 bits, REP/SEP setting those (.autsiz)
  const cpu0: TassCpu = (opts.cpu && tassCpu(opts.cpu)) || '6502';
  let cpu: TassCpu = cpu0, dpage: number | null = 0, databank: number | null = 0, longaccu = false, longindex = false, autosize = false;
  /** the processors other than the 6502 the code is written for (.cpu), in the order they came */
  const cpusUsed: TassCpu[] = [];
  /** 64tass's pseudo random numbers (xorshift128+), started again each pass as 64tass does; .seed sets them */
  const SEED: [bigint, bigint] = [0x5229a30f996ad7ebn, 0xc03bbc753f671f6fn], M64 = (1n << 64n) - 1n;
  let rng: [bigint, bigint] = [...SEED];
  const reseed = (v: bigint) => {
    rng = [...SEED];
    const d = (i: number) => (v >> BigInt(32 * i)) & 0xffffffffn;
    rng[0] ^= d(0) | (d(1) << 32n); rng[1] ^= d(2) | (d(3) << 32n);
  };
  const random64 = (): bigint => {
    let a = rng[0]; const b = rng[1];
    rng[0] = b; a ^= (a << 23n) & M64; a ^= a >> 17n; a ^= b ^ (b >> 26n); rng[1] = a;
    return (a + b) & M64;
  };
  const warnings: AsmError[] = [];
  /** what the check says of a processor that is not the C64's */
  const cpuNote = (c: TassCpu) => (c === '65816' ? 'The 65816\'s instructions run on a SuperCPU (VICE\'s xscpu64), not on the C64\'s 6510: Mimir\'s debugger and x64sc run a 6510'
    : c === '65dtv02' ? 'The 65DTV02\'s instructions (BRA, SAC, SIR) run on a C64 DTV, not on the C64\'s 6510: Mimir\'s debugger and x64sc run a 6510'
      : c === '4510' ? 'The 4510\'s instructions run on a C65 or a MEGA65, not on the C64\'s 6510: Mimir\'s debugger and x64sc run a 6510'
        : `The ${c.toUpperCase()}'s instructions do not run on the C64's 6510 (Mimir's debugger and VICE's x64sc run a 6510)`);
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
  /** the escapes an encoding has (`.edef "{cr}", 13`): the bytes each text stands for */
  const userEsc = new Map<string, Map<string, number[]>>();
  /** the bytes a string gives in the current encoding: its escapes (the longest that matches), its own characters (.cdef,
   *  .tdef), the built-in table */
  const encode = (s: string): number[] => {
    const own = userEnc.get(enc), esc = userEsc.get(enc), table = ENCODINGS[enc];
    const keys = esc ? [...esc.keys()].sort((a, b) => b.length - a.length) : [];
    const out: number[] = [];
    for (let i = 0; i < s.length;) {
      const e = keys.find(k => s.startsWith(k, i));
      if (e) { out.push(...esc!.get(e)!); i += e.length; continue; }
      const c = String.fromCodePoint(s.codePointAt(i)!);
      const b = own?.get(c) ?? (table ? table(c) : null);
      if (b == null) throw new Error(`can't encode character '${c}' (U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')})`);
      out.push(b); i += c.length;
    }
    return out;
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
    if (isFlt(v)) { if (!Number.isFinite(v.f)) throw new Error(`${v.f} is not a number that fits in memory`); return Math.floor(v.f); }
    throw new Error(`a ${typeName(v)} is not a number`);
  };
  const truth = (v: Value): boolean => (typeof v === 'boolean' ? v : isFlt(v) ? v.f !== 0 : numberOf(v) !== 0);
  /** a value as a float's number */
  const fnum = (v: Value): number => (isFlt(v) ? v.f : typeof v === 'number' ? v : numberOf(v));
  /** a function of one value, over a list each item's */
  const each = (f: (x: Value) => Value) => { const g = (x: Value): Value => (Array.isArray(x) ? x.map(g) : f(x)); return g; };
  /** a function over its arguments as 64tass broadcasts one: the lists' elements in turn (a list of one with each of the
   *  others' elements), the other arguments as they are */
  const broadcast = (args: Value[], f: (x: Value[]) => Value): Value => {
    const lists = args.filter((a): a is Value[] => Array.isArray(a));
    if (!lists.length) return f(args);
    const n = Math.max(...lists.map(l => l.length));
    if (lists.some(l => l.length !== n && l.length !== 1)) throw new Error('lists of different lengths can\'t be broadcast');
    return Array.from({ length: n }, (_, i) => broadcast(args.map(a => (Array.isArray(a) ? a[a.length === 1 ? 0 : i] : a)), f));
  };
  /** a float's function (its result a float), and one that keeps an integer an integer */
  const fl = (g: (x: number) => number) => each(x => new Flt(g(fnum(x))));
  const keep = (g: (x: number) => number) => each(x => (isFlt(x) ? new Flt(g(x.f)) : g(fnum(x))));
  const bytesOf = (v: Value): Uint8Array => (v instanceof Uint8Array ? v : typeof v === 'string' ? Uint8Array.from(encode(v)) : (() => { throw new Error(`a ${typeName(v)} has no bytes`); })());

  const builtins: Record<string, Value> = {
    true: true, false: false, pi: new Flt(Math.PI),
    floor: keep(Math.floor), ceil: keep(Math.ceil), round: keep(x => Math.sign(x) * Math.round(Math.abs(x))), trunc: keep(Math.trunc), abs: keep(Math.abs),
    frac: fl(x => x - Math.trunc(x)), sqrt: fl(Math.sqrt), cbrt: fl(Math.cbrt), log10: fl(Math.log10), log: fl(Math.log), exp: fl(Math.exp),
    sin: fl(Math.sin), asin: fl(Math.asin), sinh: fl(Math.sinh), cos: fl(Math.cos), acos: fl(Math.acos), cosh: fl(Math.cosh),
    tan: fl(Math.tan), atan: fl(Math.atan), tanh: fl(Math.tanh), rad: fl(x => x * Math.PI / 180), deg: fl(x => x * 180 / Math.PI),
    pow: (a: Value, b: Value) => new Flt(fnum(a) ** fnum(b)), hypot: (y: Value, x: Value) => new Flt(Math.hypot(fnum(y), fnum(x))),
    atan2: (y: Value, x: Value) => new Flt(Math.atan2(fnum(y), fnum(x))),
    sign: each(x => Math.sign(fnum(x))), int: each(x => Math.trunc(fnum(x))), float: each(x => new Flt(fnum(x))),
    binary: (path: string, off?: number, len?: number) => {
      const u = vfs[importPath(vfs, curStmt?.file ?? entryPath, path)]; if (!(u instanceof Uint8Array)) throw new Error(`can't open file "${path}"`);
      const o = off == null ? 0 : numberOf(off); return u.slice(o, len == null ? u.length : o + numberOf(len));
    },
    len: (x: Value) => { if (x instanceof Uint8Array || typeof x === 'string' || Array.isArray(x)) return x.length; throw new Error(`len() of a ${typeName(x)}`); },
    format: (f: string, ...args: Value[]) => format(f, args),
    // random(): a float 0 <= x < 1; random(e), random(s, e), random(s, e, t) an integer, as 64tass draws it (over lists
    // each element's in turn)
    random: (...a: Value[]) => broadcast(a, (x: Value[]) => {
      if (!x.length) return new Flt(Number(random64() & ((1n << 53n) - 1n)) * 2 ** -53);
      const [st, en, step] = x.length === 1 ? [0, numberOf(x[0]), 1] : [numberOf(x[0]), numberOf(x[1]), x[2] == null ? 1 : numberOf(x[2])];
      if (!step) throw new Error('random() with a step of 0');
      let e = en;
      const n = step > 0 ? (e < st ? (e = st, 0) : Math.floor((e - st + step - 1) / step)) : (e > st ? (e = st, 0) : Math.floor((st - e - step - 1) / -step));
      if (!n) throw new Error('random() of an empty range');
      if (step !== 1 || (n & (n - 1)) !== 0) {
        const U = 0xffffffffn, q = U / BigInt(n), lim = q * BigInt(n);
        let r: bigint; do r = random64() & U; while (r >= lim);
        return st + Number(r / q) * step;
      }
      return st + Number(random64() & BigInt(n - 1));
    }),
    range: (...a: Value[]) => {
      const [s, e, t] = a.length === 1 ? [0, numberOf(a[0]), 1] : [numberOf(a[0]), numberOf(a[1]), a[2] == null ? 1 : numberOf(a[2])];
      if (!t) throw new Error('range() with a step of 0');
      const out: number[] = [];
      for (let i = s; t > 0 ? i < e : i > e; i += t) { out.push(i); if (out.length > 1_000_000) throw new Error('range() of more than a million values'); }
      return out;
    },
  };
  /** the names looked up in this pass and the last (a .proc is compiled where its name is used), .with's namespaces */
  let refsNow = new Set<string>(), refsPrev: Set<string> | null = null, withs: string[][] = [];
  /** the names this pass has defined so far, and whether a value just looked up was one it has not yet (a forward
   *  reference: a gcc, gne … to it may skip nothing, or one byte) */
  let defsNow: Set<string> | null = null, lookedForward = false;
  /** where each always taken branch (gcc, gra …) ended in the last pass and this one, by its line (each time it runs) */
  let gPrev = new Map<Stmt, number[]>(), gNow = new Map<Stmt, number[]>();
  /** --long-branch (the command line's): the JMPs this pass's long branches made, where and to where (a later branch to
   *  the same place in reach goes to one) */
  const longBranch = !!opts.longBranch;
  let longJmps: { at: number; to: number }[] = [];
  /** a name looked up: its key, and (`p1.in1`) the names before each dot in it */
  const used = (k: string, dotted = false) => {
    refsNow.add(k);
    if (defsNow && !defsNow.has(k)) lookedForward = true;
    if (dotted) for (let j = k.indexOf('.'); j > 0; j = k.indexOf('.', j + 1)) refsNow.add(k.slice(0, j));
  };
  /** a dictionary's key for a value */
  const dictKey = (k: Value): string => (typeof k === 'string' ? `s:${k}` : isFlt(k) ? `n:${k.f}` : `n:${numberOf(k)}`);
  /** the code label a local label (`_loop`) belongs to: the last one before it (a constant opens no new scope) */
  let scope = '';
  const lookup = (name: string): Value | undefined => {
    if (name.startsWith('_') && scope) { const v = lookup(`${scope}.${name}`); if (v !== undefined) return v; }
    for (let i = spaces.length; i >= 0; i--) { const k = keyIn(spaces.slice(0, i), name); if (syms.has(k)) { used(k, name.includes('.')); return syms.get(k); } }
    // (.with's namespaces, innermost first)
    for (let w = withs.length - 1; w >= 0; w--) { const k = keyIn(withs[w], name); if (syms.has(k)) { used(k, name.includes('.')); return syms.get(k); } }
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
      case 'n': return node.f ? new Flt(node.v) : node.v;
      case 's': return node.v;
      case 'pc': return pc;
      case 'id': { const v = lookup(node.v); if (v !== undefined) return v; unresolved.push(node.v); return null; }
      case 'anon': {
        // `-` the n-th `-` label back from here; `+` the n-th `+` label ahead (from the last pass)
        let left = node.n;
        if (node.dir === '-') { for (let i = anon.length - 1; i >= 0; i--) if (anon[i].dir === '-' && !--left) return anon[i].v; }
        else { lookedForward = true; for (let i = anon.length; i < anonPrev.length; i++) if (anonPrev[i].dir === '+' && !--left) return anonPrev[i].v; }
        unresolved.push(node.dir.repeat(node.n)); return null;
      }
      case 'mem': {
        const d = dotted(node);
        if (d) { const v = lookup(d); if (v !== undefined) return v; }
        const o = ev(node.o); if (o == null) return null;
        if (isSpace(o)) { const k = `${o.space}.${node.v}`; if (syms.has(k)) { used(k); return syms.get(k); } unresolved.push(k); return null; }
        if (isDict(o)) { const v = o.map.get(`.:${node.v}`); if (v !== undefined) return v; if (o.def !== undefined) return o.def; throw new Error('key not in dictionary'); }
        throw new Error(`a ${typeName(o)} has no .${node.v}`);
      }
      case 'call': {
        const fn = ev(node.f); const args = node.args.map(a => ev(a));
        if (fn == null || args.some(a => a == null)) return null;
        // an encoding as a function: the bytes of a text in it
        if (isEnc(fn)) { const was = enc; enc = fn.name; try { return Uint8Array.from(encode(String(args[0]))); } finally { enc = was; } }
        if (typeof fn !== 'function') throw new Error(`${dotted(node.f) ?? 'this'} is not a function`);
        return fn(...args);
      }
      case 'list': { const items = node.items.map(a => ev(a)); return items.some(a => a == null) ? null : items; }
      case 'dict': {
        const map = new Map<string, Value>(); let def: Value | undefined;
        for (const it of node.items) {
          const v = ev(it.val); if (v == null) return null;
          if (it.sym) { map.set(`.:${it.sym}`, v); continue; }
          if (!it.key) { def = v; continue; }
          const k = ev(it.key); if (k == null) return null;
          map.set(dictKey(k), v);
        }
        return new Dict(map, def);
      }
      case 'idx': {
        const o = ev(node.o), i = ev(node.i); if (o == null || i == null) return null;
        // a dictionary's value for a key (a list of keys: each one's)
        if (isDict(o)) {
          const get = (k: Value): Value => { const v = o.map.get(dictKey(k)); if (v !== undefined) return v; if (o.def !== undefined) return o.def; throw new Error('key not in dictionary'); };
          return Array.isArray(i) ? i.map(get) : get(i);
        }
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
        // of a list, each item's (`<(1234, 5678)`: both low bytes); a float stays one under - and +
        if (Array.isArray(v)) return each(x => (isFlt(x) && (node.op === '-' || node.op === '+') ? new Flt(node.op === '-' ? -x.f : x.f) : ev({ k: 'u', op: node.op, a: { k: 'n', v: numberOf(x) } })))(v);
        if (isFlt(v) && (node.op === '-' || node.op === '+')) return new Flt(node.op === '-' ? -v.f : v.f);
        const n = numberOf(v);
        return node.op === '<' ? n & 0xff : node.op === '>' ? (n >> 8) & 0xff : node.op === '`' ? (n >> 16) & 0xff : node.op === '~' ? ~n : node.op === '+' ? n : -n;
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
    // x n: a list, a string or bytes repeated n times
    if (op === 'x') {
      const n = numberOf(y);
      if (n < 0) throw new Error(`repeat ${n} times`);
      if (Array.isArray(x)) return Array.from({ length: n * x.length }, (_, i) => x[i % x.length]);
      if (typeof x === 'string') return x.repeat(n);
      if (x instanceof Uint8Array) { const o = new Uint8Array(x.length * n); for (let i = 0; i < n; i++) o.set(x, i * x.length); return o; }
      throw new Error(`a ${typeName(x)} can't be repeated`);
    }
    if (Array.isArray(x) || Array.isArray(y)) {
      if (Array.isArray(x) && Array.isArray(y) && x.length !== y.length) throw new Error(`lists of ${x.length} and ${y.length} values`);
      const n = Array.isArray(x) ? x.length : y.length;
      return Array.from({ length: n }, (_, i) => bin(op, Array.isArray(x) ? x[i] : x, Array.isArray(y) ? y[i] : y));
    }
    // a float on either side: float arithmetic (/ divides as floats, << and >> multiply and divide by powers of 2); the bit
    // operators take their integers
    if (isFlt(x) || isFlt(y)) {
      const a = fnum(x), b = fnum(y);
      switch (op) {
        case '+': return new Flt(a + b); case '-': return new Flt(a - b); case '*': return new Flt(a * b);
        case '/': if (!b) throw new Error('division by zero'); return new Flt(a / b);
        case '%': if (!b) throw new Error('division by zero'); return new Flt(a - b * Math.floor(a / b));
        case '**': return new Flt(a ** b);
        case '<<': return new Flt(a * 2 ** b); case '>>': return new Flt(a / 2 ** b);
        case '<': return a < b; case '<=': return a <= b; case '>': return a > b; case '>=': return a >= b;
        case '==': return a === b; case '!=': return a !== b;
      }
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
  /** .virtual blocks open (what is compiled in one is written nowhere), and .struct and .union blocks open, innermost
   *  last (a union's lines each start where it starts; it is as long as its longest) */
  let virt: { pc: number; off: number }[] = [];
  /** .eor's value (xored into each byte written), .end met, branches allowed across a page (.option) */
  let eorVal = 0, ended = false, branchAcross = true;
  /** the .proc blocks compiled in the last pass (a change takes another pass) */
  const procWas = new Map<string, boolean>();
  /** .weak blocks open; the names defined strong in this pass and the last (a weak one gives way), and weak in this one */
  let weak = 0, strongNow = new Set<string>(), strongPrev = new Set<string>(), weakNow = new Set<string>();
  let aggs: { kind: 'struct' | 'union'; start: number; max: number }[] = [];
  const emit = (b: number, st: Stmt) => {
    b = (b ^ eorVal) & 0xff;
    if (virt.length) { fresh = false; pc++; return; }
    // (the 65816's addresses go round in 64 KiB in the PRG, as 64tass writes it: * = $018000 is at $8000)
    const a = cpu === '65816' ? (pc - off) & 0xffff : pc - off;
    if (a < 0 || a > 0xffff) { E('program counter past $ffff', st); return; }
    if (written[a] && pass === 'final' && !aggs.some(x => x.kind === 'union')) E(`memory at $${h4(a)} written twice`, st);
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
    pc = opts.pc ?? 0; off = 0; outer = []; enc = 'none'; unresolved = [];
    cpu = cpu0; dpage = 0; databank = 0; longaccu = false; longindex = false; autosize = false; rng = [...SEED]; cpusUsed.length = 0; warnings.length = 0;
    if (cpu0 !== '6502' && cpu0 !== '6502i') { cpusUsed.push(cpu0); if (final) warnings.push({ file: entryPath, line: 0, msg: `${cpuNote(cpu0)} (the arguments ask for it)` }); }
    if (opts.cpu && !tassCpu(opts.cpu) && final) E(`unknown processor '${opts.cpu}' (the arguments)`);
    missing = false; first = -1; spaces = []; scope = '';
    anonPrev = anon; anon = []; gPrev = gNow; gNow = new Map(); longJmps = [];
    let changed = false;
    const defs = new Set<string>();
    defsNow = defs;
    const define = (name: string, v: Value, st: Stmt, variable = false) => {
      const k = keyIn(spaces, name);
      // (a name defined twice keeps its first value, as 64tass; one in .weak gives way to one outside it, wherever it is)
      if (!variable) {
        if (weak) { if (defs.has(k) || strongPrev.has(k)) return; weakNow.add(k); defs.add(k); }
        else { if (defs.has(k) && !weakNow.has(k)) { E(`duplicate definition '${name}'`, st); return; } weakNow.delete(k); defs.add(k); strongNow.add(k); }
      }
      if (final && syms.has(k) && typeof v === 'number' && syms.get(k) !== v && !variable) E(`symbol "${name}" changed value in the final pass`, st);
      const old = syms.get(k);
      if (old !== v && (typeof v === 'number' || !syms.has(k) || (isSpace(v) && isSpace(old) && v.v !== old.v))) changed = true;
      syms.set(k, v);
    };
    const defineVar = (name: string, v: Value) => define(name, v, curStmt ?? stmts[0], true);
    // .if: whether each level is on, whether a branch of it was taken, and whether the level around it is on
    const cond: { on: boolean; taken: boolean; outer: boolean; sw?: Value }[] = [];
    const active = () => cond.every(c => c.on);
    const report = (st: Stmt) => { if (unresolved.length) { missing = true; if (final) for (const u of new Set(unresolved)) E(`not defined symbol '${u}'`, st); } unresolved = []; };

    virt = []; aggs = []; eorVal = 0; ended = false; branchAcross = true; withs = []; weak = 0;
    if (pass !== 1) refsPrev = refsNow;
    refsNow = new Set(); strongPrev = strongNow; strongNow = new Set(); weakNow = new Set();
    /** .page blocks open (where each starts), .encode blocks open (the encoding before each) */
    const pages: { pc: number; st: Stmt }[] = [], encs: string[] = [];
    /** where the .proc that starts at list[i] ends */
    const procEnd = (list: readonly Stmt[], i: number) => { let d = 0; for (let j = i + 1; j < list.length; j++) { const b = list[j].body; if (/^\.proc\b/.test(b)) d++; else if (/^\.(pend|endproc)\b/.test(b)) { if (!d) return j; d--; } } return -1; };
    /** a union ends: the program counter past its longest line */
    const endUnion = () => { const u = aggs.pop(); if (u) { u.max = Math.max(u.max, pc - u.start); pc = u.start + u.max; } };
    /** .lbl jump labels in each list of lines (.goto goes back to one) */
    const lbls = new WeakMap<readonly Stmt[], Map<string, { ix: number; cond: number }>>();
    // ---- macros: each call runs the macro's lines with its parameters, a .macro in a block of its own ----
    calls = [];
    let callNo = 0;
    const runCall = (def: TMacro, args: string, st: Stmt) => {
      if (calls.length >= 100) throw new Error(`macros called ${calls.length} deep at ${def.name}: does it call itself without end?`);
      const list = expand(def, args);
      const wasSpaces = spaces, wasScope = scope;
      const scoped = def.kind !== 'segment';
      if (scoped) spaces = [...spaces, st.label && st.label !== '+' && st.label !== '-' ? st.label : `#m${callNo++}`];
      if (def.kind === 'union') aggs.push({ kind: 'union', start: pc, max: 0 });
      calls.push({ name: def.name, st });
      try { runList(list); } finally { calls.pop(); if (def.kind === 'union') endUnion(); if (scoped) { spaces = wasSpaces; scope = wasScope; } }
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

    /** a line starting with a word that is a mnemonic of the processor now (one 64tass's 6502 has not: `phx` on the
     *  65816, an alias such as `bge`) without a colon: that instruction, as 64tass reads it, else the label it was */
    const asInstruction = (st: Stmt): Stmt => {
      if (!st.bare || !st.label || /^(\.|:?=)/.test(st.body) || !(cpuOp(cpu, st.label.toUpperCase()) || (/^g[a-z]{2}$/.test(st.label) && alwaysBranch(cpu, st.label.slice(1))))) return st;
      const { label, bare: _, ...rest } = st;
      return { ...rest, body: `${label} ${st.body}`.trim() };
    };
    const runList = (list: readonly Stmt[]): void => { for (let ix = 0; ix < list.length; ix++) { const st = asInstruction(list[ix]);
      if (ended) return;
      curStmt = st; fresh = true;
      const s = st.body;
      try {
        let m: RegExpMatchArray | null;
        // the conditions, followed in every branch to find their ends
        if ((m = s.match(/^\.(if|ifne|ifeq|ifpl|ifmi|elsif|else|endif|fi|switch|case|default|endswitch)\b\s*(.*)$/))) {
          const top = cond[cond.length - 1], kind = m[1];
          // (TASM's: .ifne not zero, .ifeq zero, .ifpl not negative, .ifmi negative)
          const test = () => { const v = ev(P(m![2])); if (v == null) return false; return kind === 'ifeq' ? !truth(v) : kind === 'ifpl' ? fnum(v) >= 0 : kind === 'ifmi' ? fnum(v) < 0 : truth(v); };
          switch (kind) {
            case 'if': case 'ifne': case 'ifeq': case 'ifpl': case 'ifmi': { const o = active(), v = o && test(); cond.push({ on: v, taken: v, outer: o }); break; }
            case 'elsif': if (!top) E('.elsif without .if', st); else { const v = top.outer && !top.taken && test(); top.on = v; top.taken ||= v; } break;
            case 'else': if (!top) E('.else without .if', st); else { top.on = top.outer && !top.taken; top.taken = true; } break;
            // .switch value: the first .case that has it (or .default) compiled
            case 'switch': { const o = active(); cond.push({ on: false, taken: false, outer: o, sw: o ? ev(P(m[2])) : null }); break; }
            case 'case': if (!top || !('sw' in top)) E('.case without .switch', st); else { const v = top.outer && !top.taken && top.sw != null && splitTop(m[2], ',').some(e => { const x = ev(P(e)); return x != null && bin('==', x, top.sw) === true; }); top.on = v; top.taken ||= v; } break;
            case 'default': if (!top || !('sw' in top)) E('.default without .switch', st); else { top.on = top.outer && !top.taken; top.taken = true; } break;
            default: if (!cond.pop()) E(`.${m[1]} without .if`, st);
          }
          report(st);
          continue;
        }
        if (!active()) continue;
        const inUnion = aggs[aggs.length - 1];
        if (inUnion?.kind === 'union' && !/^\.(ends|endstruct|endu|endunion)\b/.test(s)) { inUnion.max = Math.max(inUnion.max, pc - inUnion.start); pc = inUnion.start; }
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
        // TASM's loop: `name .lbl` … `.goto name` assembles again from after the .lbl
        if (/^\.lbl$/.test(s)) {
          if (!st.label) { E('.lbl needs its name before it (name .lbl)', st); continue; }
          let at = lbls.get(list); if (!at) { at = new Map(); lbls.set(list, at); }
          at.set(st.label, { ix, cond: cond.length });
          continue;
        }
        if ((m = s.match(/^\.goto\s+([A-Za-z_]\w*)$/))) {
          const t = lbls.get(list)?.get(m[1]);
          if (!t) { E(`not defined symbol '${m[1]}' (.goto goes back to a .lbl before it)`, st); continue; }
          if (++rounds > 100_000) { stuck = true; throw new Error('.goto went round 100000 times: does its condition ever turn false?'); }
          cond.length = t.cond; ix = t.ix;
          continue;
        }
        // a .proc whose name nothing used in the last pass: not compiled (its lines skipped to its .pend)
        if (st.label && /^\.proc$/.test(s)) {
          const k = keyIn(spaces, st.label), on = pass === 1 || !refsPrev || refsPrev.has(k);
          if (procWas.get(k) !== on) { procWas.set(k, on); changed = true; }
          if (!on) { const end = procEnd(list, ix); ix = end < 0 ? list.length : end; continue; }
        }
        // `abc .encode`: an encoding the label stands for, in effect to its .endencode
        if (st.label && /^\.encode$/.test(s)) {
          const name = `#enc:${keyIn(spaces, st.label)}`;
          define(st.label, new EncRef(name), st);
          encs.push(enc); enc = name; userEnc.set(name, userEnc.get(name) ?? new Map()); continue;
        }
        // a label: an anonymous one, `name = value`, `name := value`, a namespace, or the address here; one that
        // starts with _ is local to the code label before it (`loop._x`); one before a .macro's call names its block
        if (st.label === '+' || st.label === '-') anon.push({ dir: st.label, v: pc });
        else if (st.label) {
          const local = st.label.startsWith('_') && scope ? `${scope}.${st.label}` : st.label;
          if ((m = s.match(/^(:?)=(?!=)\s*(.+)$/))) { const v = ev(P(m[2])); if (v != null) define(local, v, st, m[1] === ':'); report(st); continue; }
          // TASM's variable: `i .var 3`
          if ((m = s.match(/^\.var\s+(.+)$/))) { const v = ev(P(m[1])); if (v != null) setVar(local, v, st, true); report(st); continue; }
          // a variable changed: `n += 1`, `n ::= 2` (the one the name finds)
          if (/^(::|\+|-|\*|\/|%|<<|>>|\||&|\^)=/.test(s)) { assign(`${local} ${s}`, st); report(st); continue; }
          if (/^\.(namespace|block|proc)\b/.test(s) || (call && call.def.kind !== 'segment')) {
            define(st.label, { space: keyIn(spaces, st.label), ...(/^\.namespace\b/.test(s) ? {} : { v: pc }) } as Space, st);
            if (call) { runCall(call.def, call.args, st); continue; }
            spaces = [...spaces, st.label];
            continue;
          }
          // (a b-loop's label is the list of its rounds' blocks, set when it ends)
          if (!/^\.b(for|rept|while)\b/.test(s)) { define(local, pc, st); if (!st.label.startsWith('_')) scope = st.label; }
        }
        if (call) { runCall(call.def, call.args, st); continue; }
        if ((m = s.match(/^\.(dstruct|dunion)\s+([A-Za-z_]\w*)/))) { E(`not defined symbol '${m[2]}' (no .${m[1] === 'dstruct' ? 'struct' : 'union'} of that name)`, st); continue; }
        // .virtual [address] … .endv: compiled, nothing written, the program counter back where it was after
        if ((m = s.match(/^\.virtual\b\s*(.*)$/))) { virt.push({ pc, off }); if (m[1].trim()) { const v = evn(m[1]); report(st); if (v != null) pc = v; } continue; }
        if (/^\.(endv|endvirtual)$/.test(s)) { const v = virt.pop(); if (!v) E(`${s} without .virtual`, st); else { pc = v.pc; off = v.off; } continue; }
        // an anonymous structure or union, compiled here
        if (/^\.(struct|union)$/.test(s)) { aggs.push({ kind: s === '.union' ? 'union' : 'struct', start: pc, max: 0 }); continue; }
        if ((m = s.match(/^\.(ends|endstruct|endu|endunion)\b/))) {
          const top = aggs[aggs.length - 1], want = /^\.(endu|endunion)/.test(s) ? 'union' : 'struct';
          if (!top || top.kind !== want) { E(`${m[0]} without .${want}`, st); continue; }
          if (want === 'union') endUnion(); else aggs.pop();
          continue;
        }
        // a named structure or union where it is defined: its fields compiled at 0, written nowhere (nn_s.x is an offset)
        if ((m = s.match(/^\u0001(struct|union) ([A-Za-z_]\w*)$/))) {
          const def = macros.get(m[2])!, was = { pc, off, spaces, scope };
          define(m[2], { space: keyIn(spaces, m[2]), v: 0 } as Space, st);
          virt.push({ pc, off }); pc = 0; spaces = [...spaces, m[2]];
          if (def.kind === 'union') aggs.push({ kind: 'union', start: 0, max: 0 });
          try { runList(expand(def, '')); } finally { if (def.kind === 'union') endUnion(); virt.pop(); pc = was.pc; off = was.off; spaces = was.spaces; scope = was.scope; }
          continue;
        }
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
        if (/^\.(endnamespace|endn|bend|endblock|pend|endproc)$/.test(s)) { if (!spaces.length) E(`${s} without .namespace`, st); else spaces = spaces.slice(0, -1); continue; }
        if (/^\.(namespace|block|proc)$/.test(s)) { spaces = [...spaces, `#${st.line}`]; continue; }
        // .with ns … .endwith: its names without the prefix
        if ((m = s.match(/^\.with\s+(.+)$/))) { const v = ev(P(m[1])); report(st); if (isSpace(v)) withs.push(v.space.split('.')); else { withs.push([]); if (final) E(`${m[1]} is not a namespace`, st); } continue; }
        if (/^\.endwith$/.test(s)) { if (!withs.pop()) E('.endwith without .with', st); continue; }
        // .weak … .endweak: definitions a stronger one outside overrides
        if (/^\.weak$/.test(s)) { weak++; continue; }
        if (/^\.endweak$/.test(s)) { if (!weak) E('.endweak without .weak', st); else weak--; continue; }
        // .page … .endp: its code must not cross a page (the program counter's at both ends)
        if (/^\.page$/.test(s)) { pages.push({ pc, st }); continue; }
        if (/^\.(endp|endpage)$/.test(s)) {
          const p0 = pages.pop();
          if (!p0) E(`${s} without .page`, st);
          else if (final && (p0.pc >> 8) !== (pc >> 8)) E(`different start and end page $${h4(p0.pc)} and $${h4(pc)}`, st);
          continue;
        }
        // .encode [encoding] … .endencode: an encoding in effect (a new one without a name)
        if ((m = s.match(/^\.encode\b\s*(.*)$/))) {
          let name = `#enc@${st.file}:${st.line}`;
          if (m[1].trim()) { const v = ev(P(m[1])); report(st); if (isEnc(v)) name = v.name; else if (typeof v === 'string') name = v; }
          encs.push(enc); enc = name; continue;
        }
        if (/^\.endencode$/.test(s)) { const was = encs.pop(); if (was == null) E('.endencode without .encode', st); else enc = was; continue; }
        // an encoding's escapes: `.edef "{cr}", 13, "{crlf}", [13, 10]`
        if ((m = s.match(/^\.edef\s+(.+)$/))) {
          const args = splitTop(m[1], ',').map(a => ev(P(a))); report(st);
          const esc = userEsc.get(enc) ?? new Map<string, number[]>(); userEsc.set(enc, esc);
          for (let k = 0; k + 1 < args.length; k += 2) {
            if (typeof args[k] !== 'string' || args[k] == null || args[k + 1] == null) continue;
            const v = args[k + 1], bytes: number[] = [];
            for (const x of Array.isArray(v) ? v : [v]) if (typeof x === 'string') bytes.push(...encode(x)); else bytes.push(numberOf(x) & 0xff);
            esc.set(args[k], bytes);
          }
          continue;
        }
        // an encoding's characters one by one: `.tdef "XYZ", 100` (100, 101, 102), `.tdef "AC", [65, 33]`
        if ((m = s.match(/^\.tdef\s+(.+)$/))) {
          const args = splitTop(m[1], ',').map(a => ev(P(a))); report(st);
          const table = userEnc.get(enc) ?? new Map<string, number>(); userEnc.set(enc, table);
          for (let k = 0; k + 1 < args.length; k += 2) {
            const chars = typeof args[k] === 'string' ? [...args[k] as string] : [String.fromCodePoint(numberOf(args[k]))], v = args[k + 1];
            if (v == null) continue;
            chars.forEach((c, i) => table.set(c, (Array.isArray(v) ? numberOf(v[i]) : numberOf(v) + i) & 0xff));
          }
          continue;
        }
        // .offs n: the bytes go n on from the program counter
        if ((m = s.match(/^\.offs\s+(.+)$/))) { const v = evn(m[1]); report(st); if (v != null) off = -v; continue; }
        // .eor v: each byte written xored with v
        if ((m = s.match(/^\.eor\s+(.+)$/))) { const v = evn(m[1]); report(st); eorVal = (v ?? 0) & 0xff; continue; }
        if (/^\.end$/.test(s)) { ended = true; return; }
        if ((m = s.match(/^\.option\s+([A-Za-z_]\w*)\s*=\s*(.+)$/))) { const v = ev(P(m[2])); report(st); if (m[1] === 'allow_branch_across_page' && v != null) branchAcross = truth(v); continue; }
        // the 65816's: the accumulator's and index registers' immediates 8 or 16 bits, set by REP and SEP or not
        if ((m = s.match(/^\.(al|as|xl|xs|autsiz|mansiz)$/))) { if (m[1] === 'al' || m[1] === 'as') longaccu = m[1] === 'al'; else if (m[1] === 'xl' || m[1] === 'xs') longindex = m[1] === 'xl'; else autosize = m[1] === 'autsiz'; continue; }
        // .dpage a, .databank b: the 256 bytes direct page addresses are in, the 64 KiB data bank (? none); every processor
        if ((m = s.match(/^\.(dpage|databank)\s+(.+)$/))) {
          const none = m[2].trim() === '?', v = none ? null : evn(m[2]); report(st);
          if (!none && v == null) continue;
          if (m[1] === 'dpage') dpage = v == null ? null : v & 0xffff; else databank = v == null ? null : v & 0xff;
          continue;
        }
        // .seed n: random() draws another sequence
        if ((m = s.match(/^\.seed\s+(.+)$/))) {
          // (a number written out is read with all its bits: a seed has up to 128)
          const lit = m[1].trim().replace(/_/g, '').match(/^(?:\$([0-9a-f]+)|%([01]+)|(\d+))$/i);
          if (lit) { reseed(BigInt(lit[1] ? `0x${lit[1]}` : lit[2] ? `0b${lit[2]}` : lit[3])); continue; }
          const v = ev(P(m[1])); report(st);
          if (v == null) continue;
          const n = typeof v === 'number' || isFlt(v) ? numberOf(v) : null;
          if (n == null || n < 0) { E('.seed needs an unsigned integer', st); continue; }
          reseed(BigInt(n));
          continue;
        }
        // (listing and TASM directives that change nothing here)
        if (/^\.(proff|pron|hidemac|showmac)$/.test(s) || /^\.(assert|check)\b/.test(s)) continue;
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
        if ((m = s.match(/^\.enc\s+(.+)$/))) { const v = ev(P(m[1])); if (typeof v === 'string') enc = v; else if (isEnc(v)) enc = v.name; report(st); continue; }
        // .cpu "name": the instructions of that processor from here ("default": the command line's)
        if ((m = s.match(/^\.cpu\s+(.+)$/))) {
          const v = ev(P(m[1])); report(st);
          if (typeof v !== 'string') continue;
          const c = v === 'default' ? cpu0 : tassCpu(v);
          if (!c) { E(`unknown processor '${v}' (64tass knows 6502, 6502i, 65c02, r65c02, w65c02, 65816, 65dtv02, 65ce02, 4510 and 65el02)`, st); continue; }
          cpu = c;
          if (c !== '6502' && c !== '6502i' && !cpusUsed.includes(c)) {
            cpusUsed.push(c);
            if (final) warnings.push({ file: st.file, line: st.line, msg: cpuNote(c) });
          }
          continue;
        }
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
        // numbers of 1-4 bytes, signed or not (`.rta`: an address - 1, for RTS)
        if ((m = s.match(/^\.(char|rta|sint|long|lint|dword|dint)\b\s*(.*)$/))) {
          const [n, signed] = SIZED[m[1]], rta = m[1] === 'rta', lo = signed ? -(2 ** (8 * n - 1)) : 0, hi = signed ? 2 ** (8 * n - 1) - 1 : 2 ** (8 * n) - 1;
          for (const a of splitTop(m[2], ',').filter(x => x !== '')) {
            if (a === '?') { pc += n; continue; }
            const v = ev(P(a));
            for (const x of Array.isArray(v) ? v.flat(Infinity) : [v]) {
              const k = x == null ? 0 : numberOf(x) - (rta ? 1 : 0);
              if (final && x != null && (k < lo || k > hi)) E(`too large for a ${8 * n} bit ${signed ? 'signed' : 'unsigned'} integer '${k}'`, st);
              const u = ((k % 2 ** (8 * n)) + 2 ** (8 * n)) % 2 ** (8 * n);
              for (let b = 0; b < n; b++) emit(Math.floor(u / 256 ** b) & 0xff, st);
            }
          }
          report(st);
          continue;
        }
        // texts with their length first (.ptext), the last byte's bit 7 set (.shift), shifted left with the last one's bit 0
        // set (.shiftl)
        if ((m = s.match(/^\.(ptext|shift|shiftl)\b\s*(.*)$/))) {
          const out: number[] = [];
          const take = (v: Value): void => { if (typeof v === 'string') out.push(...encode(v)); else if (v instanceof Uint8Array) out.push(...v); else if (Array.isArray(v)) v.forEach(take); else out.push(numberOf(v) & 0xff); };
          let unknown = false;
          for (const a of splitTop(m[2], ',').filter(x => x !== '')) { const v = ev(P(a)); if (v == null) unknown = true; else take(v); }
          report(st);
          if (unknown) { for (let i = 0; i <= out.length; i++) emit(0, st); continue; }
          if (m[1] === 'ptext') { if (final && out.length > 255) E(`a .ptext of ${out.length} bytes (at most 255)`, st); emit(out.length, st); for (const b of out) emit(b, st); continue; }
          if (!out.length) { E(`a .${m[1]} needs at least one byte`, st); continue; }
          if (final && out.some(b => b & 0x80)) E(`a byte of the .${m[1]} has its bit 7 set already`, st);
          if (m[1] === 'shift') out[out.length - 1] |= 0x80;
          else { for (let i = 0; i < out.length; i++) out[i] = (out[i] << 1) & 0xff; out[out.length - 1] |= 1; }
          for (const b of out) emit(b, st);
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
        // 64tass's always taken branches (gcc, gne, gra …, for where the flag is known): the branch when it reaches, else
        // JMP (BRL on the 65816); one that skips nothing ahead is no code, one that skips a byte (on the 65CE02 two too)
        // the opposite branch's opcode alone (gra: NOP # on the R65C02 and W65C02); the bytes it skips as in the last pass
        if ((m = s.match(/^g(eq|ne|cc|cs|pl|mi|vc|vs|lt|ge|ra)(?:\s+(.*))?$/)) && alwaysBranch(cpu, m[1])) {
          const g = alwaysBranch(cpu, m[1])!, at = pc;
          lookedForward = false;
          const raw = m[2] ? ev(P(m[2].trim())) : null, v = raw == null ? null : numberOf(raw), ahead = lookedForward;
          const occ = gNow.get(st)?.length ?? 0, endPrev = gPrev.get(st)?.[occ];
          const skips = v != null && ahead && endPrev != null ? v - endPrev : null;
          const near = (x: number) => x - (at + 2) >= -128 && x - (at + 2) <= 127;
          let out: number[];
          if (!m[2]) { E(`g${m[1]} needs where it goes`, st); continue; }
          if (v == null) out = [g.rel, 0];
          else if (skips === 0) out = [];
          else if (skips === 1 && g.skip1 != null) out = [g.skip1];
          else if (skips === 2 && g.skip2 != null) out = [g.skip2];
          else if (near(v)) out = [g.rel, (v - (at + 2)) & 0xff];
          else if (g.brl != null) { const o = v - (at + 3); out = [g.brl, o & 0xff, (o >> 8) & 0xff]; }
          else { if (final && Math.floor(v / 0x10000) !== Math.floor(at / 0x10000)) E(`address in different program bank '$${v.toString(16)}'`, st); out = [g.jmp, v & 0xff, (v >> 8) & 0xff]; }
          out.forEach((b, i) => { emit(b, st); if (!i && pass === 'final' && mine(site(st)) && !virt.length) ops[(pc - off - 1) & 0xffff] = 1; });
          gNow.set(st, [...(gNow.get(st) ?? []), at + out.length]);
          report(st);
          continue;
        }
        // an instruction: its mnemonic (lower case with -C), then the operand
        if ((m = s.match(/^([a-z]{3})(?:\s+(.*))?$/)) && (cpuOp(cpu, m[1].toUpperCase()) || TASS_ENC[m[1].toUpperCase()])) {
          const found = cpuOp(cpu, m[1].toUpperCase());
          if (!found) { E(cpu === '6502' && cpuOp('6502i', m[1].toUpperCase()) ? `${m[1]} is an undocumented opcode: it needs .cpu "6502i"` : `${m[1]} is not an instruction of the ${cpu}`, st); continue; }
          const { mn, modes } = found, at = pc;
          let arg = (m[2] || '').trim(), force: 'b' | 'w' | 'l' | '' = '';
          const f = arg.match(/^@([wbl])\s*(.*)$/);
          if (f) { force = f[1] as 'b' | 'w' | 'l'; arg = f[2].trim(); }
          const has = (x: CpuMode | null): x is CpuMode => x != null && modes[x] !== undefined;
          const val = (src: string): number | null => { const r = ev(P(src)); return r == null ? null : numberOf(r); };
          const hex = (n: number) => `$${n.toString(16).padStart(n > 0xffff ? 6 : n > 0xff ? 4 : 2, '0')}`;
          /** the mode, the operand's value, and how it is taken: from the direct page or data bank 64tass is set to,
           *  as it is (`#n,d`, `#n,b`, `#n,s`), or as an address the jump's program bank must have */
          let mode: CpuMode | null = null, v: number | null = null, how: How = 'auto', op: number | undefined;
          /** the bytes after it: mvn/mvp's banks, a bit instruction's direct page */
          let tail: (number | null)[] = [], bitNo: number | null = null;
          const isJump = mn === 'JMP' || mn === 'JSR';
          // 64tass's register forms: the transfer the processor has (lda x is TXA, ldx s TSX, stx s TXS, inc x INX …)
          const reg = /^[xyzsbd]$/i.test(arg) || (arg.toLowerCase() === 'a' && !has('acc')) ? REG_FORMS[`${mn} ${arg.toUpperCase()}`] : undefined;
          const regOp = reg ? cpuOp(cpu, reg)?.modes.imp : undefined;
          if (regOp != null) {
            emit(regOp, st);
            if (pass === 'final' && mine(site(st)) && !virt.length) ops[(pc - off - 1) & 0xffff] = 1;
            report(st);
            continue;
          }
          if (!arg || (arg === 'a' && has('acc'))) mode = arg === 'a' || !has('imp') ? 'acc' : 'imp';
          else if (has('move')) {
            const parts = splitTop(arg, ',');
            if (parts.length !== 2) { E(`${m[1]} needs two banks (${m[1]} #source, #destination)`, st); continue; }
            const [src, dst] = parts.map(p => val(p.replace(/^#/, '')));
            mode = 'move'; tail = [dst, src];
          } else if (has('bit') || has('bitrel')) {
            const parts = splitTop(arg, ',');
            if (parts.length !== (has('bit') ? 2 : 3)) { E(`${m[1]} needs ${has('bit') ? 'a bit and an address (rmb 7,$20)' : 'a bit, an address and where to branch (bbs 7,$20,label)'}`, st); continue; }
            bitNo = val(parts[0]); mode = has('bit') ? 'bit' : 'bitrel'; tail = [val(parts[1])];
            if (mode === 'bitrel') v = val(parts[2]);
          } else {
            const o = operandOf(arg), sfx = o.inner.slice(1).map(x => x.toLowerCase());
            const key = `${o.br}E${sfx.map(x => `,${x}`).join('')}${o.br === '(' ? ')' : o.br === '[' ? ']' : ''}${o.after.map(x => `,${x}`).join('')}`;
            const e0 = o.inner[0] ?? '';
            if (key === 'E' && e0.startsWith('#')) { mode = 'imm'; v = val(e0.slice(1)); }
            else {
              // (#n is written in the forms that take n as it is: lda #1,s, lda (#$12,d),y)
              if (e0.startsWith('#') && !/,[sbdkr]/.test(key)) { E(`general syntax: ${s}`, st); continue; }
              const raw = ev(P(e0.replace(/^#/, '')));
              v = raw == null ? null : numberOf(raw);
              const jump = isJump || mn === 'JML', x = v;
              /** a plain address's mode (x or y indexed): the direct page when it is in it, else the data bank's, else long */
              const pick = (suf: '' | 'x' | 'y'): CpuMode | null => {
                const dpM = `dp${suf}` as CpuMode, abM = (suf ? `ab${suf}` : 'abs') as CpuMode, lgM: CpuMode | null = suf === 'y' ? null : suf ? 'longx' : 'long';
                if (force === 'b') return has(dpM) ? dpM : null;
                if (force === 'w') return has(abM) ? abM : null;
                if (force === 'l') return has(lgM) ? lgM : null;
                if (x == null) return has(abM) ? abM : has(lgM) ? lgM : has(dpM) ? dpM : null;
                if (has(dpM) && dpage != null && x >= dpage && x - dpage <= 0xff) return dpM;
                if (has(abM) && databank != null && Math.floor(x / 0x10000) === databank) return abM;
                if (has(lgM)) return lgM;
                return has(abM) ? abM : has(dpM) ? dpM : null;
              };
              const forms: Record<string, () => [CpuMode | null, How?]> = {
                // (a function's argument written #1 is immediate: lda value is lda #1)
                // (a branch the 65CE02 has 16 bits of too: those when its target is too far for 8, or with @w)
                E: () => (isImm(raw) || mn === 'PEA' ? ['imm']
                  : has('rel') && has('rell') ? [force === 'w' ? 'rell' : force === 'b' || x == null || (x - (at + 2) >= -128 && x - (at + 2) <= 127) ? 'rel' : 'rell']
                  : has('rel') ? ['rel'] : has('rell') ? ['rell']
                  : isJump ? [force === 'l' ? null : 'abs', 'k'] : mn === 'JML' || mn === 'JSL' ? ['long'] : [pick('')]),
                'E,x': () => [pick('x')], 'E,y': () => [pick('y')], 'E,s': () => ['sr', 'as-is'],
                'E,b': () => ['abs', 'as-is'], 'E,b,x': () => ['abx', 'as-is'], 'E,b,y': () => ['aby', 'as-is'],
                'E,d': () => ['dp', 'as-is'], 'E,d,x': () => ['dpx', 'as-is'], 'E,d,y': () => ['dpy', 'as-is'], 'E,k': () => ['abs', 'as-is'],
                '(E)': () => (jump ? ['absi', 'bank0'] : ['dpi']), '(E,x)': () => (jump ? ['absix', 'k'] : ['dpix']),
                '(E),y': () => ['dpiy'], '(E,s),y': () => ['sriy', 'as-is'], '(E),z': () => ['dpiz'],
                // (the 65EL02's return stack)
                'E,r': () => ['rr', 'as-is'], '(E,r),y': () => ['rriy', 'as-is'],
                '(E,d)': () => ['dpi', 'as-is'], '(E,d,x)': () => ['dpix', 'as-is'], '(E,d),y': () => ['dpiy', 'as-is'], '(E,k,x)': () => ['absix', 'as-is'],
                '[E]': () => (jump ? ['absil', 'bank0'] : ['dpil']), '[E],y': () => ['dpily'], '[E,d]': () => ['dpil', 'as-is'], '[E,d],y': () => ['dpily', 'as-is'],
              };
              const form = forms[key];
              if (!form) { E(`general syntax: ${s}`, st); continue; }
              const [fm, fh] = form();
              mode = fm; how = fh ?? 'auto';
            }
          }
          op = mode ? modes[mode as CpuMode] : undefined;
          if (mode === 'bit' || mode === 'bitrel') op = op! + ((bitNo ?? 0) & 7) * 16;
          if (op === undefined) {
            E(cpu === '6502' && cpuOp('6502i', mn)?.modes[mode as CpuMode] !== undefined ? `${m[1]} is an undocumented opcode: it needs .cpu "6502i"`
              : `no ${force === 'l' ? 'long sized ' : ''}${mode ? `${mode} ` : ''}addressing mode for opcode '${m[1]}'`, st);
            continue;
          }
          const md = mode as CpuMode;
          // the immediate's size: 16 bits for the 65816's (and 65EL02's) accumulator (.al) or index registers (.xl), PEA's
          // and PHW's always
          const wide = md === 'imm' && (mn === 'PEA' || mn === 'PHW' || force === 'w' || (force !== 'b' && WIDE_CPUS.has(cpu) && ((ACCU_IMM.has(mn) && longaccu) || (INDEX_IMM.has(mn) && longindex))));
          // the operand as it is written in the instruction, and whether it fits
          let n = v ?? 0, bad = '';
          const dpClass = /^dp/.test(md), absClass = md === 'abs' || md === 'abx' || md === 'aby' || md === 'absi' || md === 'absix' || md === 'absil';
          if (v != null) {
            if (md === 'imm') { if (wide ? v < -32768 || v > 0xffff : v < -128 || v > 0xff) bad = `too large for a ${wide ? 16 : 8} bit unsigned integer '${v}'`; }
            else if (md === 'sr' || md === 'sriy' || md === 'rr' || md === 'rriy') { if (v < 0 || v > 0xff) bad = `too large for a 8 bit unsigned integer '${v}'`; }
            else if (dpClass) {
              if (how !== 'as-is') { if (dpage == null || v < dpage || v - dpage > 0xff) bad = `not a direct page address '${hex(v)}'`; else n = v - dpage; }
              else if (v < 0 || v > 0xff) bad = `too large for a 8 bit unsigned integer '${v}'`;
            } else if (absClass) {
              if (how === 'as-is' || how === 'bank0') { if (v < 0 || v > 0xffff) bad = `too large for a 16 bit unsigned integer '${v}'`; }
              else if (how === 'k') { if (Math.floor(v / 0x10000) !== Math.floor(at / 0x10000)) bad = cpu === '65816' ? `address in different program bank '${hex(v)}'` : `too large for a 16 bit unsigned integer '${v}'`; }
              else if (databank == null || Math.floor(v / 0x10000) !== databank) bad = cpu === '65816' || databank !== 0 ? `not a data bank address '${hex(v)}'` : `too large for a 16 bit unsigned integer '${v}'`;
              n = v & 0xffff;
            } else if (md === 'long' || md === 'longx') { if (v < 0 || v > 0xffffff) bad = `too large for a 24 bit unsigned integer '${v}'`; }
          }
          if (final && bad) E(bad, st);
          // --long-branch: a branch that does not reach goes over a JMP (BRL on the 65816) with the opposite branch, or to
          // the JMP to the same place a long branch before it made, when that is in reach; BRA is the JMP itself
          if (md === 'rel' && longBranch && force !== 'b' && v != null && (v - (at + 2) < -128 || v - (at + 2) > 127)) {
            const brl = cpuOp(cpu, 'BRL')?.modes.rell, jmp = cpuOp(cpu, 'JMP')?.modes.abs, opp = OPPOSITE[mn] ? cpuOp(cpu, OPPOSITE[mn])?.modes.rel : undefined;
            const far = (from: number): number[] => (brl != null ? [brl, (v - (from + 3)) & 0xff, ((v - (from + 3)) >> 8) & 0xff] : [jmp ?? 0x4c, v & 0xff, (v >> 8) & 0xff]);
            const again = mn === 'BRA' ? undefined : [...longJmps].reverse().find(j => j.to === v && j.at - (at + 2) >= -128 && j.at - (at + 2) <= 127);
            let out: number[] | null = null;
            if (again) out = [op, (again.at - (at + 2)) & 0xff];
            else if (mn === 'BRA') out = far(at);
            else if (opp != null) { out = [opp, 3, ...far(at + 2)]; longJmps.push({ at: at + 2, to: v }); }
            if (out) {
              if (final && !again && Math.floor(v / 0x10000) !== Math.floor(at / 0x10000)) E(`address in different program bank '${hex(v)}'`, st);
              out.forEach((b, i) => { emit(b, st); if (!i && pass === 'final' && mine(site(st)) && !virt.length) ops[(pc - off - 1) & 0xffff] = 1; });
              report(st);
              continue;
            }
          }
          emit(op, st);
          if (pass === 'final' && mine(site(st)) && !virt.length) ops[(pc - off - 1) & 0xffff] = 1;
          const bytes = (x: number, k: number) => { for (let i = 0; i < k; i++) emit((x >> (8 * i)) & 0xff, st); };
          if (md === 'rel' || md === 'bitrel') {
            if (md === 'bitrel') { const d = tail[0]; if (final && d != null && (dpage == null || d < dpage || d - dpage > 0xff)) E(`not a direct page address '${hex(d)}'`, st); bytes((d ?? 0) - (dpage ?? 0), 1); }
            const nx = pc + 1, o = v == null ? 0 : v - nx;
            if (final && (o < -128 || o > 127)) E(`branch too far (${o})`, st);
            if (final && md === 'rel' && !branchAcross && v != null && (nx & 0xff00) !== (v & 0xff00)) { const by = v > nx ? v - (nx | 0xff) : v - (nx & 0xff00); E(`branch crosses page by ${by > 0 ? '+' : ''}${by} bytes`, st); }
            bytes(o, 1);
          } else if (md === 'rell') bytes(v == null ? 0 : v - (at + (REL16_FROM[cpu] ?? 3)), 2);
          else if (md === 'move') { for (const b of tail) { if (final && b != null && (b < 0 || b > 0xff)) E(`too large for a 8 bit unsigned integer '${b}'`, st); bytes(b ?? 0, 1); } }
          else if (md === 'bit') { const d = tail[0]; if (final && d != null && (dpage == null || d < dpage || d - dpage > 0xff)) E(`not a direct page address '${hex(d)}'`, st); bytes((d ?? 0) - (dpage ?? 0), 1); }
          else bytes(n, md === 'imm' ? (wide ? 2 : 1) : CPU_MODE_LEN[md]);
          // .autsiz: REP and SEP set the immediates' sizes
          if (WIDE_CPUS.has(cpu) && autosize && md === 'imm' && v != null && (mn === 'REP' || mn === 'SEP')) {
            if (v & 0x20) longaccu = mn === 'REP';
            if (v & 0x10) longindex = mn === 'REP';
          }
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
    if (virt.length && final) E(`.virtual without .endv (${virt.length} open)`);
    if (aggs.length && final) E(`.${aggs[aggs.length - 1].kind} without its end (${aggs.length} open)`);
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
  return { mem, written, min, max, errors: once, prg, blocks: blockList, symbols: syms, prints, first, external, lines, starts, ops, linePcs, endPc, ...(fileOf ? { fileOf, fileNames } : {}), warnings: [...warnings], ...(cpusUsed.length ? { cpus: [...cpusUsed] } : {}) };
}
