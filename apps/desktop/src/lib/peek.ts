/* The peek (spec 10, "Titta åt andra hållet"): with Ctrl held, the block under the pointer shown the other way than the
 * listing shows it, in a small box. Code is shown as its bytes with their text (PETSCII and screen codes), every other
 * block as code: swept from the block's start as Data as code does, so the instructions stay put while the pointer goes
 * down the block. The mouse wheel scrolls the box up and down the whole .asm file, block after block in the order the
 * listing has them, shown the same way; where a block starts a divider names it. */
import { decode, h2, h4, hwSymbol, isIO, OPC, type Addr, type AnalysisResult, type Block, type ListingLine, type RenderResult, type Token } from '@mimir/core';

/** at most this many rows in the box (a divider is a row) */
export const PEEK_ROWS = 12;
/** bytes a row shown as bytes */
export const PEEK_ROW = 8;

/** the names the instructions use: the render's labels and zero-page variables */
export type PeekNames = Pick<RenderResult, 'labels' | 'zp'>;

/** a row of bytes */
export type PeekBytes = { k: 'row'; a: Addr; n: number };
/** an instruction, or a byte that is none */
export type PeekLine = Extract<ListingLine, { k: 'ins' | 'dat' }>;
/** what a row of the box is: bytes or an instruction, or a divider before the rows of the block that starts there */
export type PeekItem = { k: 'blk'; b: Block } | PeekBytes | PeekLine;

/** What the box shows. `from`: the address the pointer is at; `mark`: the bytes of its line (none on a header or a
 *  label). `head`: the block of the top row (the box's head names it); `before`: its bytes above that row; `tail`: the
 *  block of the bottom row; `rest`: its bytes below it. `off`: how many rows the box is scrolled from the pointer's
 *  line (up is less than 0, dividers not counted), and how far it goes each way: `min` has the file's first byte in the
 *  top row, `max` its last byte in the bottom row (never less than 0: unscrolled, the box starts at the pointer's line
 *  however near the end it is). */
export type Peek = {
  as: 'bytes' | 'code'; from: Addr; mark: { start: Addr; end: Addr } | null;
  head: Block; before: number; tail: Block; rest: number; off: number; min: number; max: number; items: PeekItem[];
};

/** The blocks in the order the listing (the .asm file) has them, from its headers. A relocated block's own header is
 *  left out: the blocks where its bytes run come after it. */
export function peekOrder(A: AnalysisResult, lines: readonly ListingLine[]): Block[] {
  const byId = new Map(A.blocks.map(b => [b.id, b])), seen = new Set<number>(), out: Block[] = [];
  for (const l of lines) {
    if (l.k !== 'hdr' || seen.has(l.blk)) continue;
    const b = byId.get(l.blk);
    if (b && b.type !== 'reloc' && b.end > b.start) { seen.add(b.id); out.push(b); }
  }
  return out;
}

/** where each instruction of a block starts, swept from its start (a jam opcode, or an instruction that would run past
 *  the block, is a byte); kept per analysis */
const sweeps = new WeakMap<AnalysisResult, Map<Block, Int32Array>>();
function sweep(A: AnalysisResult, b: Block): Int32Array {
  let m = sweeps.get(A);
  if (!m) sweeps.set(A, m = new Map());
  let s = m.get(b);
  if (!s) {
    const out: number[] = [];
    for (let p = b.start; p < b.end;) { const o = OPC[A.mem[p]]; out.push(p); p += !o.jam && p + o.len <= b.end ? o.len : 1; }
    m.set(b, s = Int32Array.from(out));
  }
  return s;
}

/** The file's rows, block after block in `blocks`: a block `asCode` gives as code, an instruction a row (swept from
 *  its start), the others as bytes eight a row from `gridAt` (above it the block's first row has its first bytes, as
 *  many as are left). Rows are counted from the file's first; `rowOf` is the row an address of a block is in. */
function fileRows(A: AnalysisResult, names: PeekNames, blocks: readonly Block[], asCode: (k: Block) => boolean, gridAt: (k: Block) => Addr) {
  const parts = blocks.map(k => {
    if (asCode(k)) { const s = sweep(A, k); return { b: k, head: 0, at: k.start, starts: s as Int32Array | null, count: s.length }; }
    const at = gridAt(k), head = Math.ceil((at - k.start) / PEEK_ROW);
    return { b: k, head, at, starts: null as Int32Array | null, count: head + Math.ceil((k.end - at) / PEEK_ROW) };
  });
  const first: number[] = [];
  let total = 0;
  for (const p of parts) { first.push(total); total += p.count; }
  /** the block and its row of the file's row `g` */
  const locate = (g: number) => {
    let lo = 0, hi = parts.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (first[m] <= g) lo = m; else hi = m - 1; }
    return { p: parts[lo], j: g - first[lo] };
  };
  const row = (g: number): PeekBytes | PeekLine => {
    const { p, j } = locate(g);
    if (!p.starts) {
      const k = j - p.head, a = Math.max(p.b.start, p.at + k * PEEK_ROW);
      return { k: 'row', a, n: Math.min(p.b.end, p.at + (k + 1) * PEEK_ROW) - a };
    }
    const a = p.starts[j], len = (j + 1 < p.starts.length ? p.starts[j + 1] : p.b.end) - a, o = OPC[A.mem[a]];
    return len === o.len && !o.jam ? { k: 'ins', a, n: len, mn: o.mn, ext: '', tok: operand(A, names, a), cmt: '', ill: o.ill }
      : { k: 'dat', a, n: 1, dir: '.byte', tok: [{ t: 'num', s: hex(A, A.mem[a], 2) }], cmt: o.jam ? `${o.mn.toLowerCase()} (halts the CPU)` : '' };
  };
  /** a block starts at row `g`: a divider above it, unless it is the top row */
  const starts = (g: number) => locate(g).j === 0;
  /** the row of address `a` of block `b`: the row of its byte, or the instruction it is in */
  const rowOf = (b: Block, a: Addr) => {
    const ab = blocks.indexOf(b), pb = parts[ab];
    if (pb.starts) { let lo = 0, hi = pb.starts.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (pb.starts[m] <= a) lo = m; else hi = m - 1; } return first[ab] + lo; }
    return first[ab] + Math.max(0, Math.min(pb.count - 1, pb.head + Math.floor((a - pb.at) / PEEK_ROW)));
  };
  return { total, locate, row, starts, rowOf };
}

/** the peek at `from` in block `b` of the blocks `order` (peekOrder; `b` is put in it if it is missing); `asCode`: the
 *  block is shown as bytes in the listing, so the box shows the file as code. `n`: how many bytes the line at `from`
 *  has (they are marked); `off`: the rows it is scrolled (kept within the file) */
export function peekOf(A: AnalysisResult, names: PeekNames, order: readonly Block[], b: Block, from: Addr, n: number, asCode: boolean, off = 0): Peek {
  const mark = n > 0 ? { start: from, end: Math.min(b.end, from + n) } : null;
  const blocks = order.includes(b) ? order : [b];
  // as bytes the pointer's block is in rows from the pointer's byte, the others from their start
  const { total, locate, row, starts, rowOf } = fileRows(A, names, blocks, () => asCode, k => (k === b ? from : k.start));
  const at = rowOf(b, from);
  // the top row that has the file's last byte in the bottom row, the dividers counted
  let last = total - 1;
  for (let rows = 1; last > 0;) { const more = 1 + (starts(last) ? 1 : 0); if (rows + more > PEEK_ROWS) break; rows += more; last--; }
  const min = -at, max = Math.max(0, last - at), top = at + Math.max(min, Math.min(max, off));

  const items: PeekItem[] = [];
  let g = top;
  for (; g < total && items.length < PEEK_ROWS; g++) {
    if (g > top && starts(g)) { if (items.length + 2 > PEEK_ROWS) break; items.push({ k: 'blk', b: locate(g).p.b }); }
    items.push(row(g));
  }
  const t0 = row(top), t1 = row(g - 1), head = locate(top).p.b, tail = locate(g - 1).p.b;
  return { as: asCode ? 'code' : 'bytes', from, mark, head, before: t0.a - head.start, tail, rest: tail.end - (t1.a + t1.n), off: top - at, min, max, items };
}

/** What the pane beside the listing shows. `pad`: empty rows above the first item (the file starts lower down);
 *  `items`: the rows from the top, dividers counted; the anchor's row is item `above - pad`, and `at` is that row.
 *  `head`: the block of the first item. `off`: how many rows the anchor's row is scrolled from the anchor's byte, and
 *  how far it goes each way (`min` puts the file's first row there, `max` its last). */
export type PeekPane = { pad: number; items: PeekItem[]; at: PeekLine; head: Block; off: number; min: number; max: number };

/** The pane beside the listing (spec 10, "Titta åt andra hållet bredvid listningen"): the file block after block in
 *  `order`, every block as code, an instruction a row swept from the block's start (a byte that is no instruction a
 *  `.byte` row), the same whatever the listing makes of the block. The row of `from` (in block `b`), or the row `off`
 *  rows from it, has `above` items over it (fewer than none: it is that many items above the top); `count` items in
 *  all. */
export function peekPane(A: AnalysisResult, names: PeekNames, order: readonly Block[], b: Block, from: Addr, above: number, count: number, off = 0): PeekPane {
  const blocks = order.includes(b) ? order : [b];
  const { total, locate, row, starts, rowOf } = fileRows(A, names, blocks, () => true, k => k.start);
  const g0 = rowOf(b, from), min = -g0, max = total - 1 - g0;
  const o = Math.max(min, Math.min(max, off)), ga = g0 + o;
  // up from the anchor's row: each row there, and the divider over a block's first row
  let g = ga, n = 0, lead = false;
  while (n < above && g > 0) {
    const need = 1 + (starts(g) ? 1 : 0);
    if (n + need > above) { lead = true; n++; break; }
    n += need; g--;
  }
  // down from the top (an anchor above the top: its items over the top are left out)
  const skip = Math.max(0, -above), pad = Math.max(0, above - n), want = count - pad + skip;
  // each item with the block it is of (the head names the first one's)
  const all: { it: PeekItem; b: Block }[] = [];
  for (let r = g; r < total && all.length < want; r++) {
    const k = locate(r).p.b;
    if ((r > g || lead) && starts(r)) all.push({ it: { k: 'blk', b: k }, b: k });
    if (all.length < want) all.push({ it: row(r), b: k });
  }
  const shown = all.slice(skip);
  return { pad, items: shown.map(x => x.it), at: row(ga) as PeekLine, head: shown[0]?.b ?? locate(ga).p.b, off: o, min, max };
}

const hex = (A: AnalysisResult, v: number, w: 2 | 4) => { const s = w === 2 ? h2(v & 0xff) : h4(v & 0xffff); return '$' + (A.S.hexCase === 'upper' ? s.toUpperCase() : s); };

/** an instruction's operand as the listing writes it, without its finer points (bank tracking, `label+n`, .zp): a label
 *  at the address, a zero-page variable or a hardware register where nothing of the program is, else the address */
function operand(A: AnalysisResult, names: PeekNames, pc: Addr): Token[] {
  const o = OPC[A.mem[pc]], d = decode(A.mem, pc);
  const call = o.flow === 'jsr' || o.flow === 'jmp';
  const at = (a: Addr, zp: boolean): Token[] => {
    const lb = names.labels.get(a);
    if (lb && A.owner[a] >= 0) return [{ t: 'lbl', s: lb.name }];
    const v = a & 0xffff;
    if (A.owner[a] < 0 || (isIO(v) && !call)) {
      const z = v < 0x100 ? names.zp.get(v) : undefined;
      if (z) return z.off ? [{ t: 'lbl', s: z.name }, { t: 'p', s: '+' }, { t: 'num', s: '1' }] : [{ t: 'lbl', s: z.name }];
      const hs = A.S.hwInclude !== 'none' ? hwSymbol(v) : null;
      if (hs && (!call || hs.sym.call || hs.off)) return [{ t: 'hw', s: hs.text }];
    }
    return [{ t: 'num', s: hex(A, v, zp ? 2 : 4) }];
  };
  switch (o.mode) {
    case 'imp': case 'acc': return [];
    case 'imm': return [{ t: 'p', s: '#' }, { t: 'num', s: hex(A, d.v!, 2) }];
    case 'rel': return at(d.target!, false);
    case 'zp': return at(d.target!, true);
    case 'zpx': return [...at(d.target!, true), { t: 'p', s: ',x' }];
    case 'zpy': return [...at(d.target!, true), { t: 'p', s: ',y' }];
    case 'izx': return [{ t: 'p', s: '(' }, ...at(d.target!, true), { t: 'p', s: ',x)' }];
    case 'izy': return [{ t: 'p', s: '(' }, ...at(d.target!, true), { t: 'p', s: '),y' }];
    case 'ind': return [{ t: 'p', s: '(' }, ...at(d.target!, false), { t: 'p', s: ')' }];
    case 'abx': return [...at(d.target!, false), { t: 'p', s: ',x' }];
    case 'aby': return [...at(d.target!, false), { t: 'p', s: ',y' }];
    default: return at(d.target!, false);
  }
}
