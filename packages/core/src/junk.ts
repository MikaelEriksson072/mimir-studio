/* Junk (spec 11.7): bytes the user leaves out of everything. The analysis takes them as not loaded (analyze/memory.ts),
 * so the listing, the source and the output do not have them; the Explorer's Junk list puts them back. */
import type { Addr, AnalysisResult, Block, JunkArea } from './types';
import { h4 } from './util/hex';

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

/** What marking a range as junk does: the range trimmed to the bytes that are loaded or junk already, how many loaded
 *  bytes it takes, the blocks it takes whole and those it cuts (the rest of each keeps its type), and the junk areas
 *  it joins. */
export interface JunkPlan {
  start: Addr; end: Addr;
  /** loaded bytes in it, which become junk (those that are junk already or not loaded are not counted) */
  bytes: number;
  /** blocks wholly inside it, gone with it */
  whole: Block[];
  /** blocks it covers part of */
  cut: Block[];
  /** the junk areas it overlaps or touches, which become one area with it */
  joins: JunkArea[];
}

/** Why `start`..`end` (end excluded) cannot be junk, or what marking it does (JunkPlan). A relocated block's bytes,
 *  where it is loaded or where it runs, cannot be junk: they are relocated with it. */
export function junkPlan(A: Pick<AnalysisResult, 'blocks' | 'owner' | 'relocs'>, areas: readonly JunkArea[] | undefined,
  start: Addr, end: Addr): JunkPlan | { error: string } {
  const span = (s: Addr, e: Addr) => (e - s > 1 ? `$${h4(s)}–$${h4(e - 1)}` : `$${h4(s)}`);
  if (end <= start) return { error: 'the range is empty' };
  const rl = A.relocs.find(r => (r.start < end && start < r.end) || (r.to < end && start < r.to + r.end - r.start));
  if (rl) return { error: `${span(rl.start, rl.end)} is a relocated block (it runs at ${span(rl.to, rl.to + rl.end - rl.start)}): stop relocating it before you call its bytes junk` };
  const top = Math.min(end, A.owner.length);
  let s = -1, e = -1, bytes = 0;
  for (let a = Math.max(0, start); a < top; a++) {
    const loaded = A.owner[a] >= 0;
    if (loaded) bytes++;
    if (loaded || junkAt(areas, a)) { if (s < 0) s = a; e = a + 1; }
  }
  if (!bytes) return { error: s >= 0 ? `${span(start, end)} is junk already` : `nothing is loaded at ${span(start, end)}` };
  const whole: Block[] = [], cut: Block[] = [];
  for (const b of A.blocks) {
    if (b.end <= s || b.start >= e) continue;
    (b.start >= s && b.end <= e ? whole : cut).push(b);
  }
  // addJunk joins the areas it overlaps or touches
  const joins = (areas ?? []).filter(j => j.end >= s && j.start <= e);
  return { start: s, end: e, bytes, whole, cut, joins };
}
