/* =====================================================================
 * Scripts the analysis suggests (spec 10.3): what the program's own code says a script would be good for.
 *
 * Decryption loops: a loop of the program that reads a byte, changes it with a key (EOR, ADC after CLC, SBC after SEC,
 * up to four in a row) and stores it, a byte at a time by an index register:
 *     ldx #0 / lda data,x / eor #$5a / sta data,x / inx / cpx #16 / bne
 * The loop says the method and the key, and, when the bytes are at an address (not behind a pointer), where they are
 * and how many: the template that does the same (script-templates.ts) gets its settings filled in from it, with the
 * result in the scratchpad `result`, so that the program stays as it is. It is found in the code as the analysis has
 * it (the instruction starts), without running anything.
 *
 * A routine called as the program calls it: a script that is one JSR to it, with A, X and Y set (the script's init) to
 * what the program's own call loads them with just before its JSR.
 * ===================================================================== */
import type { Addr, AnalysisResult, ScriptInit, ScriptLang } from './types';
import { OPC } from './cpu/opcodes';
import { SCRIPT_TEMPLATES, templateSource } from './script-templates';
import { h2, h4 } from './util/hex';

/** a step of a decryption loop: the key EORed in, added, or taken off */
export interface CryptStep { op: 'xor' | 'add' | 'sub'; key: number }

/** A loop of the program that changes bytes with a key and stores them. */
export interface CryptLoop {
  /** its first instruction, and the address after its branch */
  start: Addr; end: Addr;
  /** what it does to each byte, in its order */
  steps: CryptStep[];
  /** where the bytes it reads are, where they go and how many, when its operands are addresses and its index starts
   *  with a number; null: behind a pointer ((zp),y), or the index comes from elsewhere */
  source: Addr | null; dest: Addr | null; length: number | null;
  /** the zero-page pointers it reads and writes through, when it does */
  ptr?: { src: number; dst: number };
  /** its instructions that do the work, as text: `lda $0830,x / eor #$5a / sta $0830,x` */
  text: string;
}

type Ins = { a: Addr; mn: string; mode: string; v: number };

const BRANCH: Record<string, (f: { z: boolean; n: boolean; c: boolean | null }) => boolean | null> = {
  BNE: f => !f.z, BEQ: f => f.z, BPL: f => !f.n, BMI: f => f.n, BCC: f => (f.c == null ? null : !f.c), BCS: f => f.c,
};

/** the bytes the index of a loop visits: from `start`, stepped by `dir`, compared with `cmp` (null: none) before the
 *  branch `mn` is taken; null: the branch needs a flag the loop does not set */
function visited(start: number, dir: 1 | -1, cmp: number | null, mn: string): { lo: number; n: number } | null {
  const seen = new Uint8Array(256);
  let i = start & 0xff, n = 0;
  for (; n < 256; ) {
    if (seen[i]) break;
    seen[i] = 1; n++;
    i = (i + dir) & 0xff;
    const f = cmp == null ? { z: i === 0, n: (i & 0x80) !== 0, c: null } : { z: i === cmp, n: ((i - cmp) & 0x80) !== 0, c: i >= cmp };
    const go = BRANCH[mn]?.(f);
    if (go == null) return null;
    if (!go) break;
  }
  if (n === 256) return { lo: 0, n };
  let lo = 0; while (lo < 256 && !seen[lo]) lo++;
  // one stretch of bytes (a loop that wraps round the index is not a table)
  for (let k = lo; k < lo + n; k++) if (k > 255 || !seen[k]) return null;
  return { lo, n };
}

const operand = (i: Ins) => (i.mode === 'imm' ? `#$${h2(i.v)}` : i.mode === 'izy' ? `($${h2(i.v)}),y` : i.mode === 'abx' ? `$${h4(i.v)},x` : i.mode === 'aby' ? `$${h4(i.v)},y` : '');

/**
 * The decryption loops in the program's code: each backward branch whose body is a load by an index (`lda a,x`,
 * `lda a,y`, `lda (zp),y`), one to four changes with a key, a store by the same index, and the index stepped (and
 * compared). Not those that write the screen or the I/O area from elsewhere (text put on the screen with its codes
 * shifted), and not those of fewer than 8 bytes.
 */
export function findCryptLoops(A: Pick<AnalysisResult, 'mem' | 'insLen'>): CryptLoop[] {
  const { mem, insLen } = A, out: CryptLoop[] = [];
  const ins = (a: Addr): Ins => { const o = OPC[mem[a]]; return { a, mn: o.mn, mode: o.mode, v: o.len === 2 ? mem[a + 1] : o.len === 3 ? mem[a + 1] | mem[a + 2] << 8 : 0 }; };
  for (let b = 0; b < 0xfffe; b++) {
    if (!insLen[b] || OPC[mem[b]].flow !== 'br') continue;
    const rel = mem[b + 1], start = (b + 2 + (rel < 0x80 ? rel : rel - 0x100)) & 0xffff;
    if (start >= b || b - start > 40 || !insLen[start]) continue;
    // the body, instruction by instruction, ending at the branch
    const body: Ins[] = [];
    let a = start; while (a < b && insLen[a]) { body.push(ins(a)); a += insLen[a]; }
    if (a !== b || body.length < 4) continue;
    const load = body[0];
    if (load.mn !== 'LDA' || !['abx', 'aby', 'izy'].includes(load.mode)) continue;
    const reg = load.mode === 'abx' ? 'X' : 'Y';
    // the changes, up to the store
    const steps: CryptStep[] = [];
    let k = 1, ok = true;
    for (; k < body.length && body[k].mn !== 'STA'; k++) {
      const i = body[k], next = body[k + 1];
      if (i.mn === 'EOR' && i.mode === 'imm') steps.push({ op: 'xor', key: i.v });
      else if (i.mn === 'CLC' && next?.mn === 'ADC' && next.mode === 'imm') { steps.push({ op: 'add', key: next.v }); k++; }
      else if (i.mn === 'SEC' && next?.mn === 'SBC' && next.mode === 'imm') { steps.push({ op: 'sub', key: next.v }); k++; }
      else { ok = false; break; }
    }
    const store = body[k];
    if (!ok || !store || !steps.length || steps.length > 4 || store.mn !== 'STA') continue;
    if (!(store.mode === load.mode || (reg === 'Y' && ['aby', 'izy'].includes(store.mode)))) continue;
    // the rest: the index stepped once, and compared
    let dir: 1 | -1 | null = null, cmp: number | null = null;
    for (const i of body.slice(k + 1)) {
      if (i.mn === `IN${reg}` && dir == null) dir = 1;
      else if (i.mn === `DE${reg}` && dir == null) dir = -1;
      else if (i.mn === `CP${reg}` && i.mode === 'imm' && dir != null && cmp == null) cmp = i.v;
      else { ok = false; break; }
    }
    if (!ok || dir == null) continue;
    const text = [load, ...body.slice(1, k), store].map(i => `${i.mn.toLowerCase()} ${operand(i)}`.trim()).join(' / ');
    const loop: CryptLoop = { start, end: b + 2, steps, source: null, dest: null, length: null, text };
    if (load.mode === 'izy' || store.mode === 'izy') { if (load.mode === 'izy' && store.mode === 'izy') loop.ptr = { src: load.v, dst: store.v }; }
    else {
      // the index's first value: the instruction just before the loop loads it with a number
      let first: number | null = null;
      for (let p = start - 2; p < start; p++) if (p >= 0 && insLen[p] && p + insLen[p] === start && OPC[mem[p]].mn === `LD${reg}` && OPC[mem[p]].mode === 'imm') first = mem[p + 1];
      const v = first == null ? null : visited(first, dir, cmp, OPC[mem[b]].mn);
      if (v) { loop.source = load.v + v.lo; loop.dest = store.v + v.lo; loop.length = v.n; }
      const dest = loop.dest ?? store.v, src = loop.source ?? load.v;
      const screen = (x: number) => (x >= 0x0400 && x < 0x0800) || (x >= 0xd000 && x < 0xe000);
      if (screen(dest) && dest !== src) continue;
      if (loop.length != null && (loop.length < 8 || loop.source! + loop.length > 0x10000 || loop.dest! + loop.length > 0x10000)) continue;
    }
    out.push(loop);
  }
  return out;
}

/** What a loop does, in words: `EOR #$5a`, `SBC #$1b, EOR #$aa`. */
export const cryptStepsText = (steps: readonly CryptStep[]): string =>
  steps.map(s => `${s.op === 'xor' ? 'EOR' : s.op === 'add' ? 'ADC' : 'SBC'} #$${h2(s.key)}`).join(', ');

/** Where a loop works, in words: `16 bytes at $0830, in place`, `256 bytes from $f2b6 to $8000`, or by its pointer. */
export function cryptWhereText(l: CryptLoop): string {
  if (l.length != null && l.source != null && l.dest != null)
    return `${l.length} bytes at $${h4(l.source)}${l.dest === l.source ? ', in place' : `, written to $${h4(l.dest)}`}`;
  if (l.ptr) return `through the pointer at $${h2(l.ptr.src)}${l.ptr.dst !== l.ptr.src ? ` to the one at $${h2(l.ptr.dst)}` : ', in place'}: where and how many the code before the loop sets`;
  return 'from where the index starts: the code before the loop sets it';
}

/** the value of a `.var name = value` line of a template set to `value` (the comment after it stays in its column) */
function setVar(source: string, name: string, value: string): string {
  const re = new RegExp(`^(\\.var ${name}[ \\t]*=[ \\t]*)(\\S+)([ \\t]*)`, 'm');
  if (!re.test(source)) throw new Error(`the template has no .var ${name}`);
  return source.replace(re, (_m, head: string, old: string, gap: string) => { const w = old.length + gap.length; return `${head}${!gap.length ? value : value.length < w ? value.padEnd(w) : `${value} `}`; });
}

/** A script that does what a decryption loop of the program does: a template's copy with its settings filled in. */
export interface CryptScript {
  /** the template it is a copy of (its name) */
  template: string;
  source: string;
  pads: { name: string; size: number }[];
  /** whether the loop said where the bytes are and how many (else the template's own values stand there, to be set) */
  placed: boolean;
}

/**
 * The script for a decryption loop: the template that does the same (one EOR: XOR key byte; one ADC or SBC:
 * Add/subtract; several: Several steps) with its key or steps set, and, when the loop says them, `source` (by the
 * program's name for it when `nameOf` gives one) and `length`; `dest` stays the scratchpad `result`, made as big as
 * the bytes, so that a run leaves the program as it is. A comment says where the loop is and what it does.
 */
export function cryptScript(l: CryptLoop, nameOf: (a: Addr) => string | null = () => null, lang: ScriptLang = 'kickass'): CryptScript {
  const one = l.steps.length === 1 ? l.steps[0] : null;
  const name = one?.op === 'xor' ? 'xor_key' : one ? 'add_key' : 'steps';
  const t = SCRIPT_TEMPLATES.find(x => x.name === name)!;
  let s = t.source;
  const key = (v: number) => `$${h2(v)}`;
  if (one?.op === 'xor') s = setVar(s, 'key', key(one.key));
  else if (one) { s = setVar(s, 'key', key(one.key)); s = setVar(s, 'subtract', one.op === 'sub' ? 'true' : 'false'); s = setVar(s, 'keyAdd', '$00'); }
  else for (let i = 0; i < 4; i++) {
    const st = l.steps[i];
    s = setVar(s, `step${i + 1}`, !st ? 'NONE' : st.op === 'xor' ? 'XOR' : st.op === 'add' ? 'ADD' : 'SUB');
    s = setVar(s, `key${i + 1}`, key(st?.key ?? 0));
  }
  const placed = l.source != null && l.length != null;
  if (placed) { s = setVar(s, 'source', nameOf(l.source!) ?? `$${h4(l.source!)}`); s = setVar(s, 'length', `$${l.length!.toString(16).padStart(4, '0')}`); }
  const note = [
    `// Found in the program: the loop at $${h4(l.start)},`,
    `//   ${l.text}`,
    `//   (${cryptWhereText(l)}).`,
    ...(placed ? ['// source, length and the key are the loop\'s; the result goes into the scratchpad', '// result (dest = source writes it into the program instead).']
      : ['// The key is the loop\'s. Set source and length: the code before the loop', '// says where the bytes are and how many.']),
    '',
  ];
  const lines = s.split('\n'), at = lines.findIndex(x => x.startsWith('// ---- settings'));
  lines.splice(at < 0 ? 0 : at, 0, ...note);
  return { template: name, source: templateSource({ source: lines.join('\n') }, lang), pads: t.pads.map(p => ({ name: p.name, size: placed ? Math.max(1, l.length!) : p.size })), placed };
}

/** A script that calls a routine as the program does: its line, the registers its init sets and the call they are from. */
export interface CallScript { line: string; comment: string; init: ScriptInit | null; from: Addr | null }

/**
 * The script that calls the routine at `at` (`name` in the code): one JSR, and A, X and Y as the program's first call
 * of it loads them with numbers just before its JSR (`lda #1 / ldx #<t / jsr name`): they become the script's init.
 */
export function callScript(A: Pick<AnalysisResult, 'mem' | 'insLen' | 'xrefs'>, at: Addr, name: string): CallScript {
  const { mem, insLen } = A;
  const calls = (A.xrefs.get(at) ?? []).filter(x => x.kind === 'call' && insLen[x.from] === 3 && mem[x.from] === 0x20).map(x => x.from).sort((a, b) => a - b);
  const prev = (a: Addr): Addr | null => { for (let p = a - 1; p >= a - 3 && p >= 0; p--) if (insLen[p] && p + insLen[p] === a) return p; return null; };
  const regsOf = (from: Addr) => {
    const init: ScriptInit = {};
    for (let p = prev(from), n = 0; p != null && n < 4; p = prev(p), n++) {
      const o = OPC[mem[p]], r = o.mn === 'LDA' ? 'a' : o.mn === 'LDX' ? 'x' : o.mn === 'LDY' ? 'y' : null;
      if (!r || o.mode !== 'imm') break;
      if (init[r] == null) init[r] = mem[p + 1];
    }
    return init;
  };
  // the first call that sets a register, else the first call
  const from = calls.find(c => Object.keys(regsOf(c)).length) ?? calls[0] ?? null;
  const init = from == null ? {} : regsOf(from), set = (['a', 'x', 'y'] as const).filter(r => init[r] != null);
  const regs = set.map(r => `${r.toUpperCase()} = $${h2(init[r]!)}`).join(', ');
  return {
    line: `        jsr ${name}`,
    comment: from == null ? `calls ${name}; A, X and Y are set under Init` : set.length ? `calls ${name} as the program does at $${h4(from)}: ${regs} (Init)` : `calls ${name}, as the program does at $${h4(from)}; A, X and Y are set under Init`,
    init: set.length ? init : null, from,
  };
}
