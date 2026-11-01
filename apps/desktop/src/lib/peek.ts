/* The peek (spec 10, "Titta åt andra hållet"): with Ctrl held, the block under the pointer shown the other way than the
 * listing shows it, in a small box. Code is shown as its bytes with their text (PETSCII and screen codes), every other
 * block as code: swept from the block's start as Data as code does, so the instructions stay put while the pointer goes
 * down the block. */
import { decode, h2, h4, hwSymbol, isIO, OPC, type Addr, type AnalysisResult, type Block, type ListingLine, type RenderResult, type Token } from '@mimir/core';

/** at most this many rows in the box */
export const PEEK_ROWS = 12;
/** bytes a row shown as bytes */
export const PEEK_ROW = 8;

/** the names the instructions use: the render's labels and zero-page variables */
export type PeekNames = Pick<RenderResult, 'labels' | 'zp'>;

/** What the box shows. `from`: the address the pointer is at; `mark`: the bytes of its line (none on a header or a
 *  label); `rest`: the bytes of the block after the rows shown. */
export type Peek = { block: Block; from: Addr; mark: { start: Addr; end: Addr } | null; rest: number } & (
  | { as: 'bytes'; rows: { a: Addr; n: number }[] }
  | { as: 'code'; lines: Extract<ListingLine, { k: 'ins' | 'dat' }>[] });

/** the peek at `from` in block `b`; `asCode`: the block is shown as bytes in the listing, so the box shows it as code.
 *  `n`: how many bytes the line at `from` has (they are marked) */
export function peekOf(A: AnalysisResult, names: PeekNames, b: Block, from: Addr, n: number, asCode: boolean): Peek {
  const mark = n > 0 ? { start: from, end: Math.min(b.end, from + n) } : null;
  if (!asCode) {
    const rows: { a: Addr; n: number }[] = [];
    let p = from;
    while (p < b.end && rows.length < PEEK_ROWS) { const k = Math.min(PEEK_ROW, b.end - p); rows.push({ a: p, n: k }); p += k; }
    return { as: 'bytes', block: b, from, mark, rest: b.end - p, rows };
  }
  // from the block's start: the instruction the pointer's byte is in comes first
  const lines: Extract<ListingLine, { k: 'ins' | 'dat' }>[] = [];
  let p = b.start;
  while (p < b.end && lines.length < PEEK_ROWS) {
    const o = OPC[A.mem[p]], len = !o.jam && p + o.len <= b.end ? o.len : 1;
    if (p + len > from) lines.push(len === o.len && !o.jam ? { k: 'ins', a: p, n: len, mn: o.mn, ext: '', tok: operand(A, names, p), cmt: '', ill: o.ill }
      : { k: 'dat', a: p, n: 1, dir: '.byte', tok: [{ t: 'num', s: hex(A, A.mem[p], 2) }], cmt: o.jam ? `${o.mn.toLowerCase()} (halts the CPU)` : '' });
    p += len;
  }
  return { as: 'code', block: b, from, mark, rest: b.end - p, lines };
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
