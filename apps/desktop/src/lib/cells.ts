/* The bytes of a data line one by one: each item of a `.byte` line is a byte, of a `.word` line two, and each
 * character of a `.text` line one. The listing makes each a cell to click, so a block can be split, re-typed or
 * moved from any byte, not only from the start of a line. */
import type { Addr, ListingLine, Token } from '@mimir/core';
import { gfxCells } from './gfxlines';

/** an item of a data line: where its bytes start and how many there are */
export interface Cell { a: Addr; n: number }
/** a part of the line's operand: a cell's tokens, or what stands between them (`cell` null: `, ` and the quotes) */
export interface CellPart { cell: Cell | null; tok: Token[] }

const cache = new WeakMap<ListingLine, CellPart[] | null>();

/** The parts of a data line's operand, its cells among them; null for other lines, and where the items do not add up
 *  to the line's bytes. */
export function cellParts(l: ListingLine): CellPart[] | null {
  if (cache.has(l)) return cache.get(l)!;
  const parts = partsOf(l);
  cache.set(l, parts);
  return parts;
}

function partsOf(l: ListingLine): CellPart[] | null {
  if (l.k !== 'dat' || l.n < 1) return null;
  if (l.dir === '.text') {
    const t = l.tok[0];
    if (l.tok.length !== 1 || t.t !== 'str' || t.s.length !== l.n + 2 || t.s[0] !== '"' || t.s[t.s.length - 1] !== '"') return null;
    const q: CellPart = { cell: null, tok: [{ t: 'str', s: '"' }] };
    return [q, ...t.s.slice(1, -1).split('').map((s, i) => ({ cell: { a: l.a + i, n: 1 }, tok: [{ t: 'str' as const, s }] })), q];
  }
  const size = l.dir === '.word' ? 2 : 1;
  const items: Token[][] = [[]];
  for (const t of l.tok) { if (t.t === 'p' && t.s === ', ') items.push([]); else items[items.length - 1].push(t); }
  if (items.some(x => !x.length) || items.length * size !== l.n) return null;
  const out: CellPart[] = [];
  items.forEach((tok, i) => { if (i) out.push({ cell: null, tok: [{ t: 'p', s: ', ' }] }); out.push({ cell: { a: l.a + i * size, n: size }, tok }); });
  return out;
}

/** the cells of a line (null: it has none); a picture's are its characters, sprites or bitmap cells */
export function cellsOf(l: ListingLine): Cell[] | null {
  if (l.k === 'gfx') { const c = gfxCells(l); return c.length ? c : null; }
  const p = cellParts(l);
  return p ? p.flatMap(x => (x.cell ? [x.cell] : [])) : null;
}

/** the cell of line `l` that holds address `a` */
export function cellAt(l: ListingLine | null | undefined, a: Addr): Cell | null {
  const cs = l ? cellsOf(l) : null;
  return cs?.find(c => a >= c.a && a < c.a + c.n) ?? null;
}
