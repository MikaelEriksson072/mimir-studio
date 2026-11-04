/* The peek (spec 10, "Titta åt andra hållet"): with Ctrl held, the block under the pointer shown the other way than the
 * listing shows it, in a small box. Code is shown as its bytes with their text (PETSCII and screen codes), every other
 * block as code: swept from the block's start as Data as code does, so the instructions stay put while the pointer goes
 * down the block. The mouse wheel scrolls the box up and down the block. */
import { decode, h2, h4, hwSymbol, isIO, OPC, type Addr, type AnalysisResult, type Block, type ListingLine, type RenderResult, type Token } from '@mimir/core';

/** at most this many rows in the box */
export const PEEK_ROWS = 12;
/** bytes a row shown as bytes */
export const PEEK_ROW = 8;

/** the names the instructions use: the render's labels and zero-page variables */
export type PeekNames = Pick<RenderResult, 'labels' | 'zp'>;

/** What the box shows. `from`: the address the pointer is at; `mark`: the bytes of its line (none on a header or a
 *  label); `before` / `rest`: the bytes of the block before and after the rows shown. `off`: how many rows the box is
 *  scrolled from the pointer's line (up is less than 0), and how far it goes each way: `min` has the block's first
 *  byte in the top row, `max` its last byte in the bottom row (never less than 0: unscrolled, the box starts at the
 *  pointer's line however near the end it is). */
export type Peek = { block: Block; from: Addr; mark: { start: Addr; end: Addr } | null; before: number; rest: number; off: number; min: number; max: number } & (
  | { as: 'bytes'; rows: { a: Addr; n: number }[] }
  | { as: 'code'; lines: Extract<ListingLine, { k: 'ins' | 'dat' }>[] });

/** the peek at `from` in block `b`; `asCode`: the block is shown as bytes in the listing, so the box shows it as code.
 *  `n`: how many bytes the line at `from` has (they are marked); `off`: the rows it is scrolled (kept within the block) */
export function peekOf(A: AnalysisResult, names: PeekNames, b: Block, from: Addr, n: number, asCode: boolean, off = 0): Peek {
  const mark = n > 0 ? { start: from, end: Math.min(b.end, from + n) } : null;
  if (!asCode) {
    // rows of eight from the pointer's byte; above it the first row is the block's first bytes, as many as are left
    const min = -Math.ceil((from - b.start) / PEEK_ROW), last = Math.ceil((b.end - from) / PEEK_ROW) - 1;
    const max = Math.max(0, last - PEEK_ROWS + 1), top = Math.max(min, Math.min(max, off));
    const rows: { a: Addr; n: number }[] = [];
    for (let j = top; j <= last && rows.length < PEEK_ROWS; j++) {
      const a = Math.max(b.start, from + j * PEEK_ROW);
      rows.push({ a, n: Math.min(b.end, from + (j + 1) * PEEK_ROW) - a });
    }
    const end = rows.length ? rows[rows.length - 1].a + rows[rows.length - 1].n : from;
    return { as: 'bytes', block: b, from, mark, before: (rows[0]?.a ?? from) - b.start, rest: b.end - end, off: top, min, max, rows };
  }
  // every instruction from the block's start: the one the pointer's byte is in comes first, unscrolled
  const starts: Addr[] = [], lens: number[] = [];
  let p = b.start, at = -1;
  while (p < b.end) {
    const o = OPC[A.mem[p]], len = !o.jam && p + o.len <= b.end ? o.len : 1;
    if (at < 0 && p + len > from) at = starts.length;
    starts.push(p); lens.push(len); p += len;
  }
  if (at < 0) at = Math.max(0, starts.length - 1);
  const min = -at, max = Math.max(0, starts.length - PEEK_ROWS - at), top = at + Math.max(min, Math.min(max, off));
  const lines: Extract<ListingLine, { k: 'ins' | 'dat' }>[] = [];
  for (let i = top; i < starts.length && lines.length < PEEK_ROWS; i++) {
    const q = starts[i], o = OPC[A.mem[q]];
    lines.push(lens[i] === o.len && !o.jam ? { k: 'ins', a: q, n: lens[i], mn: o.mn, ext: '', tok: operand(A, names, q), cmt: '', ill: o.ill }
      : { k: 'dat', a: q, n: 1, dir: '.byte', tok: [{ t: 'num', s: hex(A, A.mem[q], 2) }], cmt: o.jam ? `${o.mn.toLowerCase()} (halts the CPU)` : '' });
  }
  const end = lines.length ? lines[lines.length - 1].a + lines[lines.length - 1].n : from;
  return { as: 'code', block: b, from, mark, before: (lines[0]?.a ?? from) - b.start, rest: b.end - end, off: top - at, min, max, lines };
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
