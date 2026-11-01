/* Folding in the listing: a folded block shows only its header line. The view keeps each line's number in its
 * .asm file, and the header of a folded block stands for every address of the block (cursor, scrolling, keys).
 * Ctrl+↓ / Ctrl+↑ go from block header to block header. */
import type { Addr, Block, ListingLine } from '@mimir/core';
import { fileLineNumbers } from './lines';

export interface ListingView {
  lines: ListingLine[];
  /** 1-based line in the .asm file for every view line (0 for the file bars) */
  lineNo: Int32Array;
  /** address -> index of the view line that shows it (a folded block's header for all its bytes), -1 for none */
  lineOf: Int32Array;
  /** view index of a folded header -> how many lines it hides */
  hidden: Map<number, number>;
}

/** `size`: how many addresses there are (64 KB, or a cartridge's banks as spaces of their own, spec 13.9b) */
export function foldLines(all: readonly ListingLine[], blocks: readonly Block[], folded: ReadonlySet<Addr>, size = 0x10000): ListingView {
  const nums = fileLineNumbers(all);
  const lines: ListingLine[] = [], no: number[] = [], hidden = new Map<number, number>(), foldedAt = new Map<number, Block>();
  let fold = -1; // view index of the folded header whose lines are being skipped
  all.forEach((l, i) => {
    if (l.k === 'hdr' || l.k === 'file') fold = -1;
    // the blank line after a block stays: it separates the folded header from the next block
    if (fold >= 0 && l.k !== 'blank') { hidden.set(fold, (hidden.get(fold) || 0) + 1); return; }
    if (l.k === 'hdr') { const b = blocks[l.blk]; if (b && folded.has(b.start)) { fold = lines.length; foldedAt.set(fold, b); } }
    lines.push(l); no.push(nums[i]);
  });
  const lineOf = new Int32Array(size).fill(-1);
  lines.forEach((l, i) => {
    const b = foldedAt.get(i);
    const [s, e] = b ? [b.start, b.end] : 'n' in l && l.n > 0 ? [l.a, l.a + l.n] : [0, 0];
    for (let a = s; a < e && a < size; a++) if (lineOf[a] < 0) lineOf[a] = i;
  });
  return { lines, lineNo: Int32Array.from(no), lineOf, hidden };
}

/** Ctrl+↓ / Ctrl+↑: the block header to go to from line `from` (indices into the listing's lines, `hdrs` the headers'
 *  in order; -1 for none). Down: the next block's. Up: the line's own block's, or the one before when the cursor is
 *  at its start (`atStart`). Before the first header (a file's head) going up finds none; past the last, going down. */
export function blockStep(hdrs: readonly number[], from: number, dir: 1 | -1, atStart: boolean): number {
  // the last header on or before the line
  let lo = 0, hi = hdrs.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (hdrs[mid] <= from) lo = mid + 1; else hi = mid; }
  const k = dir > 0 ? lo : atStart ? lo - 2 : lo - 1;
  return k >= 0 && k < hdrs.length ? hdrs[k] : -1;
}
