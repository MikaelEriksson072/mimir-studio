/* Junk (spec 11.7): bytes the user leaves out of everything. The analysis takes them as not loaded (analyze/memory.ts),
 * so the listing, the source and the output do not have them; the Explorer's Junk list puts them back. */
import type { Addr, JunkArea } from './types';

/** `areas` with `start`..`end` (end excluded) added, sorted by address: the areas it overlaps or touches join it */
export function addJunk(areas: readonly JunkArea[] | undefined, start: Addr, end: Addr): JunkArea[] {
  let s = start, e = end;
  const out: JunkArea[] = [];
  for (const j of areas ?? []) {
    if (j.end < s || j.start > e) out.push(j);
    else { s = Math.min(s, j.start); e = Math.max(e, j.end); }
  }
  out.push({ start: s, end: e });
  return out.sort((x, y) => x.start - y.start);
}

/** `areas` without the one that starts at `start` */
export const removeJunk = (areas: readonly JunkArea[] | undefined, start: Addr): JunkArea[] => (areas ?? []).filter(j => j.start !== start);

/** the junk area that holds `a` */
export const junkAt = (areas: readonly JunkArea[] | undefined, a: Addr): JunkArea | undefined => areas?.find(j => a >= j.start && a < j.end);

/** the parts of the junk areas inside `start`..`end` (end excluded), in order */
export function junkIn(areas: readonly JunkArea[] | undefined, start: Addr, end: Addr): JunkArea[] {
  const out: JunkArea[] = [];
  for (const j of areas ?? []) { const s = Math.max(j.start, start), e = Math.min(j.end, end); if (s < e) out.push({ start: s, end: e }); }
  return out.sort((x, y) => x.start - y.start);
}
