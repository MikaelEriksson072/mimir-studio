/* Folding in the listing: a folded block shows only its header line. The view keeps each line's number in its
 * .asm file, and the header of a folded block stands for every address of the block (cursor, scrolling, keys); a
 * folded relocated block (8.1b) hides its .pseudopc and the blocks in it, and stands for where they run too.
 * Ctrl+↓ / Ctrl+↑ go from block header to block header. */
import type { Addr, Block, ListingLine, Reloc } from '@mimir/core';
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

/** `size`: how many addresses there are (64 KB, or a cartridge's banks as spaces of their own, spec 13.9b);
 *  `relocs`: the relocated blocks, whose folded header stands for where they run too; `numbers`: each line's number in
 *  its .asm file, when the lines are not the file's one for one (pictures in the listing, lib/gfxlines) */
export function foldLines(all: readonly ListingLine[], blocks: readonly Block[], folded: ReadonlySet<Addr>, size = 0x10000, relocs: readonly Reloc[] = [], numbers?: Int32Array | null): ListingView {
  const nums = numbers ?? fileLineNumbers(all);
  const lines: ListingLine[] = [], no: number[] = [], hidden = new Map<number, number>(), foldedAt = new Map<number, Block>();
  let fold = -1; // view index of the folded header whose lines are being skipped
  let nest = 0; // in a folded relocated block: how many .pseudopc are open, its own too
  const hide = () => hidden.set(fold, (hidden.get(fold) || 0) + 1);
  all.forEach((l, i) => {
    const open = l.k === 'dir' && l.reloc === 'open', close = (l.k === 'dir' || l.k === 'cmt') && l.reloc === 'close';
    if (nest > 0) { hide(); if (open) nest++; else if (close && --nest === 0) fold = -1; return; }
    // a block where a relocated block runs ends at the `}` too (and where it pauses or goes on)
    if (l.k === 'hdr' || l.k === 'file' || close || (l.k === 'dir' && (l.reloc === 'pause' || l.reloc === 'resume'))) fold = -1;
    // the blank line after a block stays: it separates the folded header from the next block (the user's empty lines in
    // the block fold with it)
    if (fold >= 0 && (l.k !== 'blank' || l.user)) { hide(); if (open && foldedAt.get(fold)?.type === 'reloc') nest = 1; return; }
    if (l.k === 'hdr') { const b = blocks[l.blk]; if (b && folded.has(b.start)) { fold = lines.length; foldedAt.set(fold, b); } }
    lines.push(l); no.push(nums[i]);
  });
  const lineOf = new Int32Array(size).fill(-1);
  const put = (s: Addr, e: Addr, i: number) => { for (let a = s; a < e && a < size; a++) if (lineOf[a] < 0) lineOf[a] = i; };
  lines.forEach((l, i) => {
    const b = foldedAt.get(i);
    if (b) put(b.start, b.end, i); else if ('n' in l && l.n > 0) put(l.a, l.a + l.n, i);
  });
  // a folded relocated block stands for where it runs, and where the blocks relocated from there run
  foldedAt.forEach((b, i) => {
    if (b.type !== 'reloc') return;
    const spans = [[b.start, b.end]];
    for (let k = 0; k < spans.length; k++) for (const r of relocs) if (r.start >= spans[k][0] && r.start < spans[k][1] && !spans.some(([s]) => s === r.to)) spans.push([r.to, r.to + r.end - r.start]);
    for (const [s, e] of spans.slice(1)) put(s, e, i);
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
