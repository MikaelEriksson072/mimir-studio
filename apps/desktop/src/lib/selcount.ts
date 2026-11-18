/* How many bytes a selection takes in, shown in the margin beside it: in the listing (a selection of lines or bytes)
 * and in the source tab (the lines selected in Monaco). */
import type { Addr, Line } from '@mimir/core';

/** "17 bytes ($11)", "2048 bytes ($0800)" */
export const selCountText = (n: number): string => `${n} byte${n === 1 ? '' : 's'} ($${n.toString(16).padStart(n > 0xff ? 4 : 2, '0')})`;

/** The listing's selection `start`..`end` (exclusive): how many of its bytes the listing has a line for (bytes no file
 *  loads have none: a selection over the gap between two files counts the loaded ones), and the first and the last
 *  line they are on (indices into the listing's lines, through `lineOf`). Null when it has none. */
export function listingSelCount(lineOf: Int32Array, start: Addr, end: Addr): { bytes: number; first: number; last: number } | null {
  let bytes = 0, first = -1, last = -1;
  for (let a = Math.max(0, start), e = Math.min(end, lineOf.length); a < e; a++) {
    const i = lineOf[a];
    if (i < 0) continue;
    bytes++;
    if (first < 0 || i < first) first = i;
    if (i > last) last = i;
  }
  return bytes ? { bytes, first, last } : null;
}

/** a selection in the editor, as Monaco gives it (1-based lines and columns) */
export interface SourceSel { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number }

/** The lines the selections in a source file take in, and the bytes those lines hold (`lines`: the file's lines,
 *  R.fileLines). A selection counts when it goes over more than one line; one that ends at the start of a line (whole
 *  lines selected) ends at the line before it. `first` and `last`: the first and the last line selected (1-based), for
 *  where the count goes. Null when no selection goes over lines, or the lines hold no bytes. */
export function sourceSelCount(lines: readonly Line[], sels: readonly SourceSel[]): { bytes: number; first: number; last: number } | null {
  const taken = new Set<number>();
  let first = Infinity, last = -1;
  for (const s of sels) {
    if (s.endLineNumber <= s.startLineNumber) continue;
    const end = s.endColumn === 1 ? s.endLineNumber - 1 : s.endLineNumber;
    first = Math.min(first, s.startLineNumber); last = Math.max(last, end);
    for (let n = s.startLineNumber; n <= end; n++) taken.add(n);
  }
  let bytes = 0;
  for (const n of taken) { const l = lines[n - 1]; if (l && 'n' in l && l.n > 0) bytes += l.n; }
  return bytes ? { bytes, first, last } : null;
}
