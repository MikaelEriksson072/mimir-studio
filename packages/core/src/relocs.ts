/* Relocated blocks (spec 8.1b): bytes the program copies to another address before they run there. The analysis puts a
 * copy of them where they run (analyze/memory) and reads them there; the source writes them where they are loaded,
 * inside `.pseudopc` (render/kick). What the UI and the CLI share: where a byte that runs somewhere is loaded, whether
 * a range can be relocated, and the user's work on the bytes (names, comments, marks, patches) moved along with them
 * when a block is relocated, moved or put back. */
import type { Addr, AnalysisResult, Project, Reloc, RelocInfo } from './types';
import { T } from './model';
import { h4 } from './util/hex';

const SPACE = 0x10000;
const size = (r: Pick<Reloc, 'start' | 'end'>) => r.end - r.start;
const span = (s: Addr, e: Addr) => (e - s > 1 ? `$${h4(s)}-$${h4(e - 1)}` : `$${h4(s)}`);

/** the relocated block whose copy runs at `a` (each address is in one at most) */
export const relocAt = (A: Pick<AnalysisResult, 'relocs'>, a: Addr): RelocInfo | undefined =>
  A.relocs?.find(r => a >= r.to && a < r.to + size(r));

/** the relocated block loaded at `a`: where its bytes are before the program copies them */
export const relocLoadedAt = (A: Pick<AnalysisResult, 'relocs'>, a: Addr): RelocInfo | undefined =>
  A.relocs?.find(r => a >= r.start && a < r.end);

/** where the byte that runs at `a` is loaded, through every relocated block it was copied by; elsewhere `a` itself */
export function loadAddress(A: Pick<AnalysisResult, 'relocs'>, a: Addr): Addr {
  for (let r = relocAt(A, a), n = 0; r && n < 64; r = relocAt(A, a), n++) a = r.start + a - r.to;
  return a;
}

/** Where the bytes of `start`..`end` (end excluded) are loaded, as one range (the built PRG has them there); null when
 *  they are not one piece there (the range crosses the edge of a relocated block's copy). */
export function loadRange(A: Pick<AnalysisResult, 'relocs'>, start: Addr, end: Addr): { start: Addr; end: Addr } | null {
  const s = loadAddress(A, start);
  for (let a = start + 1; a < end; a++) if (loadAddress(A, a) !== s + a - start) return null;
  return { start: s, end: s + end - start };
}

/**
 * Why `start`..`end` (end excluded) cannot run at `to`; null when it can. The bytes must be one piece of one file (or
 * of a relocated block's copy, to relocate them again), not in a relocated block where it is loaded, and where they
 * run nothing may be loaded, and a patch (`patches`) may not cross its edges. `except`: the relocated block being moved,
 * whose copy is not in the way. In a cartridge (spec 13.9b) `to` is in the bank of `start`.
 */
export function relocProblem(A: Pick<AnalysisResult, 'owner' | 'tm' | 'relocs' | 'files'>, start: Addr, end: Addr, to: Addr, except?: Reloc | null, patches: readonly { start: Addr; bytes: Uint8Array }[] = []): string | null {
  if (!(start < end)) return 'The end must come after the start.';
  const base = Math.floor(start / SPACE) * SPACE, n = end - start;
  if (end > base + SPACE) return `${span(start, end)} runs past $ffff.`;
  if (to < base || to >= base + SPACE) return 'The run address must be in the bank the block is loaded in.';
  if (to + n > base + SPACE) return `At $${h4(to)} the ${n} bytes would run past $ffff.`;
  if (to === start) return `The block is already at $${h4(to)}: give the address it runs at.`;
  const file = A.owner[start], piece = relocAt(A, start);
  if (file < 0) return `$${h4(start)} is not part of any loaded file.`;
  for (let a = start; a < end; a++) {
    if (A.owner[a] !== file || relocAt(A, a) !== piece) return A.owner[a] < 0 ? `${span(start, end)} runs past the end of the file at $${h4(a)}.` : `${span(start, end)} crosses into ${relocAt(A, a) ? 'a relocated block' : 'another file'} at $${h4(a)}.`;
    const l = A.tm[a] === T.RELOC ? relocLoadedAt(A, a) : undefined;
    if (l && !(except && l.start === except.start)) return `$${h4(a)} is where the relocated block ${span(l.start, l.end)} is loaded: relocate the bytes where they run, at $${h4(l.to + a - l.start)}.`;
  }
  if (to < end && start < to + n) return `At $${h4(to)} the block would cover its own bytes (${span(start, end)}).`;
  const old = except ? relocLoadedAt(A, except.start) : undefined;
  for (let a = to; a < to + n; a++) {
    if (A.owner[a] < 0 || (old && a >= old.to && a < old.to + size(old))) continue;
    const r = relocAt(A, a);
    return r ? `$${h4(a)} is where the relocated block ${span(r.start, r.end)} runs.` : `$${h4(a)} is loaded from ${A.files[A.owner[a]]?.name ?? 'a file'}: a relocated block runs where nothing is loaded.`;
  }
  const cut = patches.find(p => (p.start < start && p.start + p.bytes.length > start) || (p.start < end && p.start + p.bytes.length > end));
  if (cut) return `A patch (${span(cut.start, cut.start + cut.bytes.length)}) crosses the edge of the block: it can only move with it whole.`;
  return null;
}

/**
 * The code in `start`..`end` that the analysis traces where it is loaded (end excluded), as ranges: relocated, those
 * bytes are read where they run only (a copy loop that copies a few bytes more than its routine, say).
 */
export function codeWhereLoaded(A: Pick<AnalysisResult, 'insLen' | 'codeOwner'>, start: Addr, end: Addr): { start: Addr; end: Addr }[] {
  const out: { start: Addr; end: Addr }[] = [];
  for (let a = start; a < end; a++) {
    if (!(A.insLen[a] > 0 || A.codeOwner[a] >= 0)) continue;
    const last = out[out.length - 1];
    if (last && last.end === a) last.end = a + 1; else out.push({ start: a, end: a + 1 });
  }
  return out;
}

/** What `moveKeys` moves: the user's work kept by address in the project. */
export type RelocKeys = Pick<Project, 'labels' | 'comments' | 'blockComments' | 'notes' | 'blanks' | 'bookmarks' | 'overrides' | 'bankZones' | 'entries' | 'entryPoint' | 'excluded' | 'binary' | 'patches' | 'relocs'>;

/**
 * The user's work on `from`..`from + n` moves to `to`..`to + n`: names, comments, comment lines, empty lines, bookmarks, marks
 * (overrides, bank zones; one that reaches past the range is cut there), entry points, the program start, excluded and
 * binary blocks, patches (which keep where their bytes are in the file) and the blocks relocated from there. Works on
 * an Immer draft too.
 */
export function moveKeys(p: RelocKeys, from: Addr, n: number, to: Addr): void {
  if (from === to || n <= 0) return;
  const end = from + n, inside = (a: Addr) => a >= from && a < end, moved = (a: Addr) => to + a - from;
  const rec = <V>(r: Record<Addr, V>) => {
    const keys = Object.keys(r).map(Number).filter(inside), vals = keys.map(k => r[k]);
    for (const k of keys) delete r[k];
    keys.forEach((k, i) => { r[moved(k)] = vals[i]; });
  };
  // a bookmark's area moves with its first byte, cut where the range ends; one that runs into the range from before
  // it ends where the range starts
  for (const [k, b] of Object.entries(p.bookmarks)) {
    if (b.end == null) continue;
    if (inside(+k)) b.end = moved(Math.min(b.end, end));
    else if (+k < from && b.end > from && b.end <= end) b.end = from;
  }
  rec(p.labels); rec(p.comments); rec(p.blockComments); rec(p.notes); rec(p.bookmarks);
  if (p.blanks) rec(p.blanks);
  const list = (xs: Addr[]) => xs.map(a => (inside(a) ? moved(a) : a));
  p.entries = [...new Set(list(p.entries))];
  p.excluded = [...new Set(list(p.excluded))];
  p.binary = [...new Set(list(p.binary))];
  if (p.entryPoint != null && inside(p.entryPoint)) p.entryPoint = moved(p.entryPoint);
  // a mark keeps its place in the list (later ones win): the part outside stays, the part inside moves
  const ranged = <X extends { start: Addr; end: Addr }>(xs: X[]): X[] => xs.flatMap(x => {
    if (x.end <= from || x.start >= end) return [x];
    const s = Math.max(x.start, from), e = Math.min(x.end, end);
    return [...(x.start < from ? [{ ...x, end: from }] : []), ...(x.end > end ? [{ ...x, start: end }] : []), { ...x, start: moved(s), end: moved(e) }];
  });
  p.overrides = ranged(p.overrides);
  p.bankZones = ranged(p.bankZones);
  p.patches = p.patches.map(x => {
    if (!inside(x.start)) return x;
    const at = x.at ?? x.start, start = moved(x.start), { at: _, ...rest } = x;
    return { ...rest, start, end: moved(x.end), ...(at !== start ? { at } : {}) };
  });
  // a block relocated from where these bytes are goes along with them
  p.relocs = p.relocs.map(r => (inside(r.start) ? { ...r, start: moved(r.start), end: moved(r.end) } : r));
}

/** Relocate `r.start`..`r.end` to run at `r.to`: the user's work on the bytes moves to where they run. Works on an Immer
 *  draft too. */
export function addReloc(p: RelocKeys, r: Reloc): void {
  moveKeys(p, r.start, size(r), r.to);
  p.relocs = [...p.relocs, { start: r.start, end: r.end, to: r.to }];
}

/** The relocated block loaded at `start` runs at `to` instead: its work moves along. Works on an Immer draft too. */
export function moveReloc(p: RelocKeys, start: Addr, to: Addr): void {
  const r = p.relocs.find(x => x.start === start);
  if (!r || r.to === to) return;
  const was = r.to;
  p.relocs = p.relocs.map(x => (x === r ? { ...x, to } : x));
  moveKeys(p, was, size(r), to);
}

/** The relocated block loaded at `start` is no longer relocated: its work goes back to where its bytes are loaded.
 *  Works on an Immer draft too. */
export function removeReloc(p: RelocKeys, start: Addr): void {
  const r = p.relocs.find(x => x.start === start);
  if (!r) return;
  p.relocs = p.relocs.filter(x => x !== r);
  moveKeys(p, r.to, size(r), r.start);
}
