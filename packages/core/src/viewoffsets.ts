/* View offsets (spec 10.4): bytes the listing shows at another address than the one they are loaded at, for manual
 * analysis. Code the program copies somewhere else before it runs it is read with the addresses and labels it has
 * there, and references to that area go to it, without relocating it: the analysis, the .asm, the output and the round
 * trip are as without the offset (render() shows them only with RenderOptions.viewOffsets, in the listing), so the
 * exported source keeps the bytes where they are loaded and the program's own code moves them when it runs. Unlike a
 * relocated block (8.1b) the area it is shown at may hold loaded bytes too. */
import type { Addr, AnalysisResult, ViewOffset, XRef } from './types';
import { relocAt, relocLoadedAt } from './relocs';
import { h4 } from './util/hex';

const SPACE = 0x10000;
const size = (o: Pick<ViewOffset, 'start' | 'end'>) => o.end - o.start;
const span = (s: Addr, e: Addr) => (e - s > 1 ? `$${h4(s)}-$${h4(e - 1)}` : `$${h4(s)}`);

/** the view offset whose bytes hold `a` (where they are loaded) */
export const viewOffsetAt = (offs: readonly ViewOffset[] | undefined, a: Addr): ViewOffset | undefined =>
  offs?.find(o => a >= o.start && a < o.end);

/** the address the listing shows `a` at: where its view offset shows it, elsewhere `a` itself */
export const shownAddress = (offs: readonly ViewOffset[] | undefined, a: Addr): Addr => {
  const o = viewOffsetAt(offs, a);
  return o ? o.to + a - o.start : a;
};

/** the view offset that shows its bytes where `a` is, and the loaded byte shown at `a` */
export function shownTarget(offs: readonly ViewOffset[] | undefined, a: Addr): { o: ViewOffset; at: Addr } | undefined {
  for (const o of offs ?? []) if (a >= o.to && a < o.to + size(o)) return { o, at: o.start + a - o.to };
  return undefined;
}

/** how far a view offset moves its bytes, as `+$b700` or `-$0100` */
export const shiftText = (o: Pick<ViewOffset, 'start' | 'to'>): string => {
  const d = o.to - o.start;
  return `${d < 0 ? '-' : '+'}$${h4(Math.abs(d))}`;
};

/** An automatic label's name where its view offset shows it: the address in it is the one shown (`l_0903` → `l_c003`);
 *  other names stay as they are. */
export const shownLabelName = (name: string, a: Addr, shown: Addr): string => {
  const at = `_${h4(a)}`;
  return name.toLowerCase().endsWith(at) ? `${name.slice(0, -4)}${h4(shown)}` : name;
};

/**
 * Why `start`..`end` (end excluded) cannot be shown at `to`; null when it can. The bytes must be loaded, in one bank,
 * and not in a relocated block (which the listing shows where it runs already); where they are shown they may not cover
 * themselves, nor the bytes or the shown area of another view offset (`except`: the one being moved). Loaded bytes where
 * they are shown are fine: references there go to the offset's bytes in the listing.
 */
export function viewOffsetProblem(A: Pick<AnalysisResult, 'owner' | 'relocs'>, offs: readonly ViewOffset[] | undefined, start: Addr, end: Addr, to: Addr, except?: Pick<ViewOffset, 'start'> | null): string | null {
  if (!(start < end)) return 'The end must come after the start.';
  const base = Math.floor(start / SPACE) * SPACE, n = end - start;
  if (end > base + SPACE) return `${span(start, end)} runs past $ffff.`;
  if (to < base || to >= base + SPACE) return 'The address to show them at must be in the bank the bytes are loaded in.';
  if (to + n > base + SPACE) return `At $${h4(to)} the ${n} bytes would run past $ffff.`;
  if (to === start) return `The bytes are at $${h4(to)} already: give the address to show them at.`;
  for (let a = start; a < end; a++) {
    if (A.owner[a] < 0) return `$${h4(a)} is not loaded: only loaded bytes can be shown elsewhere.`;
    const r = relocLoadedAt(A, a) ?? relocAt(A, a);
    if (r) return `$${h4(a)} is in the relocated block ${span(r.start, r.end)}, which the listing shows where it runs already.`;
  }
  if (to < end && start < to + n) return `At $${h4(to)} the bytes would be shown over themselves (${span(start, end)}).`;
  for (const o of offs ?? []) {
    if (except && o.start === except.start) continue;
    if (o.start < end && start < o.end) return `${span(o.start, o.end)} is shown at $${h4(o.to)} already.`;
    if (o.to < to + n && to < o.to + size(o)) return `$${h4(o.to)}-$${h4(o.to + size(o) - 1)} shows ${span(o.start, o.end)} already.`;
  }
  return null;
}

/** The view offsets the listing can show, in order: each one checked against those before it (a file removed, junk or
 *  a relocated block can leave one without its bytes). */
export function usableViewOffsets(A: Pick<AnalysisResult, 'owner' | 'relocs'>, offs: readonly ViewOffset[] | undefined): ViewOffset[] {
  const out: ViewOffset[] = [];
  for (const o of offs ?? []) if (!viewOffsetProblem(A, out, o.start, o.end, o.to)) out.push(o);
  return out;
}

/** What the references say about showing `start`..`end` at `to`: how many go into the area it is shown at (`refs`;
 *  not those of code loaded there, which keeps its own), how many of those come from the bytes themselves (`own`), and
 *  of the jumps and calls there (`jumps`) how many land on an instruction the analysis decoded in the bytes (`onCode`). */
export function viewOffsetFit(A: Pick<AnalysisResult, 'xrefs' | 'insLen'>, start: Addr, end: Addr, to: Addr): { refs: number; own: number; jumps: number; onCode: number } {
  let refs = 0, own = 0, jumps = 0, onCode = 0;
  const n = end - start;
  for (let t = to; t < to + n; t++) {
    for (const x of A.xrefs.get(t) ?? []) {
      if (x.from >= to && x.from < to + n) continue;
      refs++;
      if (x.from >= start && x.from < end) own++;
      if (x.kind === 'call' || x.kind === 'jump') { jumps++; if (A.insLen[start + t - to] > 0) onCode++; }
    }
  }
  return { refs, own, jumps, onCode };
}

/** The references to the byte at `a`, and where a view offset shows it, those to the address it is shown at (not from
 *  code loaded there, which keeps its own). */
export function refsShown(A: Pick<AnalysisResult, 'xrefs'>, offs: readonly ViewOffset[] | undefined, a: Addr): XRef[] {
  const own = A.xrefs.get(a) ?? [], o = viewOffsetAt(offs, a);
  if (!o) return own;
  const shown = o.to + a - o.start;
  return [...own, ...(A.xrefs.get(shown) ?? []).filter(x => !(x.from >= o.to && x.from < o.to + size(o)))];
}

/** `offs` with `o` in place of the one that starts where it does, sorted by address */
export const setViewOffset = (offs: readonly ViewOffset[] | undefined, o: ViewOffset): ViewOffset[] =>
  [...(offs ?? []).filter(x => x.start !== o.start), { start: o.start, end: o.end, to: o.to }].sort((x, y) => x.start - y.start);

/** `offs` without the one that starts at `start` */
export const removeViewOffset = (offs: readonly ViewOffset[] | undefined, start: Addr): ViewOffset[] => (offs ?? []).filter(o => o.start !== start);
