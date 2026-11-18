/* A label's references in a box beside it (spec 10, Korsreferenser vid etiketten): a label picked in the listing (its
 * line clicked, or the label in the Symbols view) gets a small box beside its line with who references it: where
 * from, how (a call, a jump, a read …, or the low or high byte of its address), the line there as the listing writes it,
 * and the label of the code it is in. A click on one goes there. The Cross-references tab (X) lists the same. */
import { findBlock, refsShown, shownAddress, type Addr, type AnalysisResult, type ListingLine, type RenderResult, type XRef, type XRefKind } from '@mimir/core';

/** How a line references a label: the analysis's kinds, and for a line that only names it, `lo` / `hi` (`#<irq`,
 *  `.byte >irq`: the low or high byte of its address) or `name` (another use, as `BasicUpstart2(start)`). */
export type RefKind = XRefKind | 'lo' | 'hi' | 'name';

/** what a reference is, as the box and the Cross-references tab write it */
export const XREF_KIND: Record<RefKind, string> = { call: 'call', jump: 'jump', branch: 'branch', read: 'read', write: 'write', rmw: 'read+write', ptr: 'pointer', lo: 'low byte', hi: 'high byte', name: 'named' };

/** a line that can reference a label: an instruction, a data line, a directive */
export type RefLine = Extract<ListingLine, { k: 'ins' | 'dat' | 'dir' }>;

/** A reference to a label. `from`: the instruction (or the data line's byte) that makes it, `shown`: that address as
 *  the listing shows it (a view offset, 10.4); `line`: its line in the listing, null when the render has none; `where`:
 *  the label at `from` or the nearest before it in its block, with how far on (`loop`, `loop+5`); null when there is
 *  none near. */
export interface LabelRef { from: Addr; kind: RefKind; shown: Addr; line: RefLine | null; where: string | null }

/** how far back the label of the code a reference is in may be (bytes) */
const WHERE_BACK = 256;

const byAddr = new WeakMap<readonly ListingLine[], Map<Addr, Extract<ListingLine, { k: 'ins' | 'dat' }>>>();
/** the line with bytes that starts at each address of `lines` (the first, as the listing has them) */
function linesByAddr(lines: readonly ListingLine[]): Map<Addr, Extract<ListingLine, { k: 'ins' | 'dat' }>> {
  let m = byAddr.get(lines);
  if (m) return m;
  m = new Map();
  for (const l of lines) if ((l.k === 'ins' || l.k === 'dat') && l.n > 0 && !m.has(l.a)) m.set(l.a, l);
  byAddr.set(lines, m);
  return m;
}

/** the line `a` is on: the one that starts there, or the data line before it whose bytes take it in (`.word` lines) */
export function refLine(lines: readonly ListingLine[], a: Addr): RefLine | null {
  const m = linesByAddr(lines);
  for (let p = a; p >= 0 && p > a - 64; p--) { const l = m.get(p); if (l) return p + l.n > a ? l : null; }
  return null;
}

/** a line that names a label in its operand: how (`kind`: `lo`, `hi`, `ptr` for a `.word`, else `name`) and the `+n`
 *  written after the name (`smc_08ef+1`) */
interface Naming { l: RefLine; kind: RefKind; off: number }
const byName = new WeakMap<readonly ListingLine[], Map<Addr, Naming[]>>();
/** an offset written after a label (`+1`, `+$0020`, `+%101`), 0 when it is not a number */
const offsetOf = (s: string): number => {
  const v = s.startsWith('$') ? parseInt(s.slice(1), 16) : s.startsWith('%') ? parseInt(s.slice(1), 2) : /^\d+$/.test(s) ? parseInt(s, 10) : NaN;
  return Number.isFinite(v) ? v : 0;
};
/** the lines of `lines` that name each label's address in their operand (once a line) */
function linesNaming(lines: readonly ListingLine[]): Map<Addr, Naming[]> {
  let m = byName.get(lines);
  if (m) return m;
  m = new Map();
  for (const l of lines) {
    if (l.k !== 'ins' && l.k !== 'dat' && l.k !== 'dir') continue;
    const here = new Set<Addr>();
    l.tok.forEach((t, j) => {
      if (t.t !== 'lbl' || t.to == null || here.has(t.to)) return;
      here.add(t.to);
      const before = l.tok[j - 1], plus = l.tok[j + 1], n = l.tok[j + 2];
      const byte = before?.t === 'p' ? /[<>]$/.exec(before.s)?.[0] : undefined;
      const kind: RefKind = byte === '<' ? 'lo' : byte === '>' ? 'hi' : l.k === 'dat' && l.dir === '.word' ? 'ptr' : 'name';
      const off = plus?.t === 'p' && plus.s === '+' && n?.t === 'num' ? offsetOf(n.s) : 0;
      const at = m!.get(t.to);
      if (at) at.push({ l, kind, off }); else m!.set(t.to, [{ l, kind, off }]);
    });
  }
  byName.set(lines, m);
  return m;
}

/** the label at `a` or the nearest before it in the block `a` is in, written as the listing writes an address after a
 *  label (`loop+5`); null when none is within WHERE_BACK bytes */
export function labelBefore(A: Pick<AnalysisResult, 'blocks'>, labels: RenderResult['labels'], a: Addr): string | null {
  const b = findBlock(A.blocks, a), lo = Math.max(b ? b.start : a, a - WHERE_BACK);
  for (let p = a; p >= lo; p--) { const l = labels.get(p); if (l) return p === a ? l.name : `${l.name}+${a - p}`; }
  return null;
}

/** The references to the label at `a` (`zp`: the zero-page variable there, whose pointer's high byte `a+1` is its too),
 *  by address: the analysis's (with a view offset, 10.4, also those to where its bytes are shown), and every other line
 *  that names it in its operand (`lda #<irq`, `.word irq`, `BasicUpstart2(start)`, `inc smc+1`), one a line. */
export function labelRefs(A: Pick<AnalysisResult, 'xrefs' | 'blocks'>, R: Pick<RenderResult, 'lines' | 'labels' | 'zp' | 'viewOffsets'>, a: Addr, zp: boolean): LabelRef[] {
  const xs: XRef[] = zp ? [...(A.xrefs.get(a) ?? []), ...(R.zp.get(a + 1)?.off ? A.xrefs.get(a + 1) ?? [] : [])] : refsShown(A, R.viewOffsets, a);
  const seen = new Set<string>(), covered = new Set<RefLine>(), out: LabelRef[] = [];
  const add = (from: Addr, kind: RefKind, line: RefLine | null) =>
    out.push({ from, kind, shown: shownAddress(R.viewOffsets, from), line, where: labelBefore(A, R.labels, from) });
  for (const x of xs) {
    const k = `${x.from}/${x.kind}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const line = refLine(R.lines, x.from);
    if (line) covered.add(line);
    add(x.from, x.kind, line);
  }
  // the lines that name it and make no reference the analysis has (`lda #<irq`, a `.word` table it did not read)
  for (const u of linesNaming(R.lines).get(a) ?? []) {
    if (covered.has(u.l)) continue;
    covered.add(u.l);
    // `inc smc+1`: the analysis's reference to the byte after the label, from this instruction
    const x = u.kind === 'name' && u.l.k === 'ins' ? A.xrefs.get(a + u.off)?.find(r => r.from === u.l.a) : undefined;
    add(u.l.a, x ? x.kind : u.kind, u.l);
  }
  return out.sort((x, y) => x.from - y.from);
}
