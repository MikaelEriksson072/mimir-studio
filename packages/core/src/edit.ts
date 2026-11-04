/* Editing helpers the UI and the CLI share: they turn an intent into the override that does it. */
import type { Addr, AnalysisResult, Block, BlockKind, ListingLine, NumberFormat, Override, OverrideProps, Project } from './types';
import { findBlock } from './analyze/classify';
import { MARK_AS, MARK_TYPE } from './model';
import { h4 } from './util/hex';

export interface BlockMerge {
  /** append it to `project.overrides` */
  override: Override;
  /** the block at the address and the neighbour it is merged with */
  block: Block;
  other: Block;
  /** the type the merged block gets (the type of `block`, as far as an override can say it) */
  into: BlockKind;
}

/** Detected-only kinds an override cannot reproduce over a longer range become plain data. */
const AS_OVERRIDE: Partial<Record<BlockKind, BlockKind>> = { lohi: 'data', basic: 'data' };

/** An override that gives `start`..`end` the type and settings of block `b` (text encoding, table kind, number
 *  format and row length of data, tables and words, music init/play). */
/** The blocks whose numbers can be written in another format, and how many go on a row: data, tables and words. */
export const FORMATTABLE: readonly BlockKind[] = ['data', 'table', 'words'];

/**
 * The override that gives block `b` a number format (`hex`, `dec` or `bin`; null: the default, which for words is
 * addresses) or a count of items a row (null: the default), keeping its type and its other settings. `overrides`
 * are the project's: the last one over exactly the block gives the settings, so a second change made before the
 * analysis has caught up with the first keeps the first.
 */
export function formatOverride(b: Block, change: { fmt?: NumberFormat | null; row?: number | null; mc?: boolean | null }, overrides: readonly Override[] = []): Override {
  const o = overrideLike(b, b.start, b.end);
  const last = [...overrides].reverse().find(x => x.start === o.start && x.end === o.end);
  const props: OverrideProps = { ...(last && last.type === o.type ? last.props : o.props) };
  if (change.fmt !== undefined) { if (change.fmt && !(change.fmt === 'hex' && b.type !== 'words')) props.fmt = change.fmt; else delete props.fmt; }
  if (change.row !== undefined) { if (change.row) props.row = change.row; else delete props.row; }
  if (change.mc !== undefined) { if (change.mc != null) props.mc = change.mc; else delete props.mc; }
  return { start: o.start, end: o.end, type: o.type, ...(Object.keys(props).length ? { props } : {}) };
}

function overrideLike(b: Block, start: Addr, end: Addr): Override {
  const type = AS_OVERRIDE[b.type] ?? b.type;
  const p = b.props, props: OverrideProps = {};
  if (type === 'text' && p.enc) props.enc = p.enc;
  if (type === 'table' && p.sub) props.sub = p.sub;
  if (type === 'data' || type === 'table' || type === 'words') { if (p.fmt) props.fmt = p.fmt; if (p.row) props.row = p.row; }
  if (type === 'music') { if (p.init != null) props.init = p.init; if (p.play != null) props.play = p.play; }
  if ((type === 'sprite' || type === 'charset' || type === 'bitmap') && p.mc != null) props.mc = p.mc;
  return { start, end, type, ...(Object.keys(props).length ? { props } : {}) };
}

/** the neighbour of `b` before or after it, when it is in the same file and touches it */
function neighbour(A: AnalysisResult, b: Block, dir: 'prev' | 'next'): Block | null {
  const o = A.blocks[b.id + (dir === 'prev' ? -1 : 1)];
  return o && o.file === b.file && (dir === 'prev' ? o.end === b.start : o.start === b.end) ? o : null;
}

/**
 * Merge the block at `at` with the block before or after it into one block of `at`'s type and settings
 * (text encoding, table kind, number format and row length, music init/play). Null when there is no
 * neighbour in the same file. Code stays split per routine: merging code with data disassembles the data.
 */
export function mergeOverride(A: AnalysisResult, at: Addr, dir: 'prev' | 'next'): BlockMerge | null {
  const block = findBlock(A.blocks, at);
  if (!block) return null;
  const other = neighbour(A, block, dir);
  if (!other) return null;
  const override = overrideLike(block, Math.min(block.start, other.start), Math.max(block.end, other.end));
  return { override, block, other, into: override.type as BlockKind };
}

export interface ByteMove {
  /** append them to `project.overrides` */
  overrides: Override[];
  /** the bytes that move (end excluded), the block they leave and the block they join */
  start: Addr; end: Addr; from: Block; into: Block;
  /** the block whose start moves with them: its comment, build exclusion and binary file go along (`moveBlockKeys`) */
  rekey: { from: Addr; to: Addr } | null;
}

/** Kinds that detection could read differently once a block is shorter: the block the bytes leave keeps its type. */
const KEEP_TYPE: BlockKind[] = ['text', 'table', 'words', 'sprite', 'charset', 'bitmap', 'screen', 'music', 'fill'];

/**
 * Move `start`..`end` (end excluded), bytes at the start (`dir` 'prev') or the end ('next') of one block, into the
 * neighbouring block on that side. The neighbour grows by them and keeps its type and settings; the block they leave
 * keeps its type for the rest. Code stays split per routine, so an instruction cannot move from one code block to
 * another, and the BASIC stub is read from its lines.
 */
export function moveBytes(A: AnalysisResult, start: Addr, end: Addr, dir: 'prev' | 'next'): ByteMove | { error: string } {
  const what = end - start > 1 ? `$${h4(start)}-$${h4(end - 1)}` : `$${h4(start)}`;
  const from = findBlock(A.blocks, start);
  if (!from || !(start < end && end <= from.end)) return { error: `${what} is not inside one block` };
  if (dir === 'prev' ? start !== from.start : end !== from.end) return { error: `${what} is not at the ${dir === 'prev' ? 'start' : 'end'} of its block` };
  const into = neighbour(A, from, dir);
  if (!into) return { error: `there is no ${dir === 'prev' ? 'previous' : 'next'} block in this file` };
  if (from.type === 'basic' || into.type === 'basic') return { error: 'the BASIC stub is read from its lines' };
  if (from.type === 'code' && into.type === 'code') return { error: 'code stays split per routine' };
  const overrides: Override[] = [];
  const rest = dir === 'prev' ? { start: end, end: from.end } : { start: from.start, end: start };
  // a block the user typed keeps its own override for the rest
  if (rest.end > rest.start && !from.user && KEEP_TYPE.includes(from.type)) overrides.push(overrideLike(from, rest.start, rest.end));
  overrides.push(overrideLike(into, Math.min(into.start, start), Math.max(into.end, end)));
  const rekey = dir === 'next' ? { from: into.start, to: start } : rest.end > rest.start ? { from: from.start, to: end } : null;
  return { overrides, start, end, from, into, rekey };
}

/**
 * The move listing line `l` starts when it is dragged out of its block towards `dir`: the whole instruction in code
 * (and a code block's `.byte` line), a `.word`, and otherwise the one byte at that edge of the block. Null when the line
 * does not hold that edge of its block or the bytes cannot move there.
 */
export function lineMove(A: AnalysisResult, l: ListingLine, dir: 'prev' | 'next'): ByteMove | null {
  const n = 'n' in l ? l.n : 0;
  const b = n > 0 ? findBlock(A.blocks, l.a) : null;
  if (!b || (dir === 'prev' ? l.a !== b.start : l.a + n !== b.end)) return null;
  const whole = b.type === 'code' || (l.k === 'dat' && l.dir === '.word');
  const [s, e] = whole ? [l.a, l.a + n] : dir === 'prev' ? [b.start, b.start + 1] : [b.end - 1, b.end];
  const m = moveBytes(A, s, e, dir);
  return 'error' in m ? null : m;
}

/** `$xxxx` or `$xxxx-$yyyy` for the bytes `start`..`end` (end excluded) */
const spanText = (start: Addr, end: Addr) => (end - start > 1 ? `$${h4(start)}-$${h4(end - 1)}` : `$${h4(start)}`);

/** Null when a code block can be cut at `a`; else why not (it is inside an instruction). */
function insideInstruction(A: AnalysisResult, b: Block, a: Addr): string | null {
  if (b.type !== 'code' || a <= b.start || a >= b.end) return null;
  const at = A.codeOwner[a];
  return at >= 0 && at !== a ? `$${h4(a)} is inside the instruction at $${h4(at)}` : null;
}

/** Why the block `b` cannot be cut or resized, or null. */
function fixedBlock(b: Block): string | null {
  if (b.type === 'basic') return 'the BASIC stub is read from its lines';
  if (b.type === 'reloc') return `$${h4(b.start)}-$${h4(b.end - 1)} is where a relocated block is loaded: change its blocks where they run, on the lines inside .pseudopc`;
  return null;
}

/**
 * Overrides that keep the type of the blocks `start`..`end` (end excluded) cuts, for their parts outside it, where
 * detection could read the shorter part differently (KEEP_TYPE; a block the user typed keeps its own override). Code
 * is left to the trace. Put them before the override over the range.
 */
export function keepCutTypes(A: AnalysisResult, start: Addr, end: Addr): Override[] {
  const out: Override[] = [];
  for (const b of A.blocks) {
    if (b.end <= start || b.start >= end || b.user || !KEEP_TYPE.includes(b.type)) continue;
    if (b.start < start) out.push(overrideLike(b, b.start, start));
    if (b.end > end) out.push(overrideLike(b, end, b.end));
  }
  return out;
}

export interface BlockSplit {
  /** append them to `project.overrides` */
  overrides: Override[];
  /** the block that is split, and where the second part starts */
  block: Block; at: Addr;
}

/**
 * Split the block at `at` in two there: both parts keep its type and settings (a lo/hi table and BASIC become data).
 * Code is split by starting a routine at `at` (an override from there), which must be the start of an instruction.
 */
export function splitBlock(A: AnalysisResult, at: Addr): BlockSplit | { error: string } {
  const b = findBlock(A.blocks, at);
  if (!b || at < b.start || at >= b.end) return { error: `$${h4(at)} is not part of any block` };
  const fixed = fixedBlock(b); if (fixed) return { error: fixed };
  if (at === b.start) return { error: `$${h4(at)} is the start of its block already` };
  const inside = insideInstruction(A, b, at); if (inside) return { error: inside };
  const overrides = b.type === 'code' ? [{ start: at, end: b.end, type: 'code' as const }] : [overrideLike(b, b.start, at), overrideLike(b, at, b.end)];
  return { overrides, block: b, at };
}

/**
 * The bytes of the block at `at` from `at` to its end ('next'), or from its start to `to` (end excluded: the end of
 * the byte or word at `at`) ('prev'), into the neighbouring block on that side, as `moveBytes` moves them. In code
 * the whole instruction at `at` goes along.
 */
export function moveFrom(A: AnalysisResult, at: Addr, dir: 'prev' | 'next', to: Addr = at + 1): ByteMove | { error: string } {
  const b = findBlock(A.blocks, at);
  if (!b || at < b.start || at >= b.end) return { error: `$${h4(at)} is not part of any block` };
  const ins = b.type === 'code' && A.codeOwner[at] >= b.start ? A.codeOwner[at] : at;
  if (dir === 'next') return moveBytes(A, ins, b.end, 'next');
  const end = Math.min(b.end, b.type === 'code' && A.insLen[ins] ? Math.max(to, ins + A.insLen[ins]) : to);
  return moveBytes(A, b.start, end, 'prev');
}

export interface BlockResize {
  /** append them to `project.overrides` */
  overrides: Override[];
  /** the block and its new range (end excluded) */
  block: Block; start: Addr; end: Addr;
  /** blocks it now covers whole: they become part of it */
  replaced: Block[];
  /** blocks it takes bytes from (the part it takes); the rest of each keeps its type */
  took: { from: Block; start: Addr; end: Addr }[];
  /** bytes it gives up: to the neighbouring block on that side, or (`to` null) a block of their own of its type */
  gave: { to: Block | null; start: Addr; end: Addr }[];
  /** block starts that move (comment, build exclusion, binary file: `moveBlockKeys`), in order */
  rekeys: { from: Addr; to: Addr }[];
}

/**
 * Give the block at `at` the range `start`..`end` (end excluded), keeping its type and settings. Growing, it takes
 * in the blocks it now covers and cuts the one its new edge lands in, whose rest keeps its type. Shrinking, the bytes
 * it gives up join the neighbouring block on that side (`freed` 'join', when there is one it can join) or stay a
 * block of their own of its type ('own'). The range must lie in the block's file; code is cut only between
 * instructions, and the BASIC stub and where a relocated block is loaded keep their range.
 */
export function resizeBlock(A: AnalysisResult, at: Addr, start: Addr, end: Addr, freed: 'join' | 'own' = 'join'): BlockResize | { error: string } {
  const b = findBlock(A.blocks, at);
  if (!b || at < b.start || at >= b.end) return { error: `$${h4(at)} is not part of any block` };
  const fixed = fixedBlock(b); if (fixed) return { error: fixed };
  if (!(start < end)) return { error: 'the end must come after the start' };
  if (start >= b.end || end <= b.start) return { error: `${spanText(start, end)} does not overlap the block $${h4(b.start)}-$${h4(b.end - 1)}` };
  if (start === b.start && end === b.end) return { error: `the block is $${h4(b.start)}-$${h4(b.end - 1)} already` };
  for (let a = start; a < end; a++) if (A.owner[a] !== b.file) return { error: `${spanText(start, end)} ${A.owner[a] < 0 ? `runs past the end of the file at $${h4(a)}` : `crosses into another file at $${h4(a)}`}` };
  const overrides: Override[] = [], replaced: Block[] = [], took: BlockResize['took'] = [], gave: BlockResize['gave'] = [], rekeys: BlockResize['rekeys'] = [];
  const blocked = (c: Block) => fixedBlock(c);
  /** the bytes `s`..`e` the block gives up, on the side of neighbour `n` */
  const give = (s: Addr, e: Addr, dir: 'prev' | 'next') => {
    const n = neighbour(A, b, dir);
    if (freed === 'join' && n && !blocked(n) && !(n.type === 'code' && b.type === 'code')) {
      overrides.push(overrideLike(n, Math.min(n.start, s), Math.max(n.end, e)));
      gave.push({ to: n, start: s, end: e });
      if (dir === 'next') rekeys.push({ from: n.start, to: s });
    } else {
      overrides.push(overrideLike(b, s, e));
      gave.push({ to: null, start: s, end: e });
    }
  };
  // the start
  if (start < b.start) {
    for (const c of A.blocks) {
      if (c.end <= start || c.start >= b.start || c.file !== b.file) continue;
      const why = blocked(c); if (why) return { error: why };
      if (c.start >= start) { replaced.push(c); continue; }
      const inside = insideInstruction(A, c, start); if (inside) return { error: inside };
      if (!c.user && KEEP_TYPE.includes(c.type)) overrides.push(overrideLike(c, c.start, start));
      took.push({ from: c, start, end: c.end });
    }
  } else if (start > b.start) {
    const inside = insideInstruction(A, b, start); if (inside) return { error: inside };
    give(b.start, start, 'prev');
  }
  if (start !== b.start) rekeys.unshift({ from: b.start, to: start });
  // the end
  if (end > b.end) {
    for (const c of A.blocks) {
      if (c.start >= end || c.end <= b.end || c.file !== b.file) continue;
      const why = blocked(c); if (why) return { error: why };
      if (c.end <= end) { replaced.push(c); continue; }
      const inside = insideInstruction(A, c, end); if (inside) return { error: inside };
      // the rest of a code block is no longer reached from its start: it starts a routine of its own
      if (c.type === 'code') overrides.push({ start: end, end: c.end, type: 'code' });
      else if (!c.user && KEEP_TYPE.includes(c.type)) overrides.push(overrideLike(c, end, c.end));
      took.push({ from: c, start: c.start, end });
      rekeys.push({ from: c.start, to: end });
    }
  } else if (end < b.end) {
    const inside = insideInstruction(A, b, end); if (inside) return { error: inside };
    give(end, b.end, 'next');
  }
  overrides.push(overrideLike(b, start, end));
  return { overrides, block: b, start, end, replaced, took, gave, rekeys };
}

/** What is kept by a block's start (its comment, build exclusion and binary file) follows the start to `to`.
 *  Works on an Immer draft too. */
export function moveBlockKeys(p: Pick<Project, 'blockComments' | 'excluded' | 'binary'>, from: Addr, to: Addr): void {
  if (from === to) return;
  if (p.blockComments[from] != null) { p.blockComments[to] = p.blockComments[from]; delete p.blockComments[from]; }
  for (const k of ['excluded', 'binary'] as const) if (p[k].includes(from)) p[k] = [...new Set(p[k].map(a => (a === from ? to : a)))];
}

const TEXT_MARK: Record<string, string> = { petscii: 'text', screen: 'textsc', 'petscii-mixed': 'textmix', 'screen-mixed': 'textscmix' };
const KIND_MARK: Partial<Record<BlockKind, string>> = { code: 'code', data: 'bytes', words: 'words', table: 'table', sprite: 'sprite', charset: 'charset', bitmap: 'bitmap', screen: 'screen', music: 'music', fill: 'fill', lohi: 'bytes', basic: 'bytes' };

/** The "Mark as" id (MARK_AS) that gives a block of this type, text encoding included; detected-only kinds are Bytes. */
export function markIdOf(b: Pick<Block, 'type' | 'props'>): string {
  return b.type === 'text' ? TEXT_MARK[b.props.enc ?? 'petscii'] ?? 'text' : KIND_MARK[b.type] ?? 'bytes';
}

export interface RangeMerge {
  /** append it to `project.overrides` */
  override: Override;
  /** the "Mark as" id and the kind the range becomes */
  id: string; into: BlockKind;
  /** blocks inside the range: they become the one new block */
  replaced: Block[];
  /** blocks the range starts or ends inside: the part outside keeps its type */
  cut: Block[];
}

/**
 * Turn `start`..`end` (end excluded) into one block of type `id` (a MARK_AS id), replacing every block inside it.
 * Settings such as the number format, row length, table kind and music init/play come from `from` when it has the
 * same type (the block the cursor was in). The range must lie in one loaded file. Code stays split per routine.
 */
export function mergeRange(A: AnalysisResult, start: Addr, end: Addr, id: string, from?: Block | null): RangeMerge | { error: string } {
  const m = MARK_AS.find(x => x.id === id);
  if (!m) return { error: `unknown block type "${id}"` };
  if (!(start >= 0 && end <= A.owner.length && start < end)) return { error: 'the end must come after the start' };
  const file = A.owner[start];
  if (file < 0) return { error: `$${h4(start)} is not part of any loaded file` };
  for (let a = start; a < end; a++) if (A.owner[a] !== file) return { error: `$${h4(start)}-$${h4(end - 1)} ${A.owner[a] < 0 ? `runs past the end of the file at $${h4(a)}` : `crosses into another file at $${h4(a)}`}` };
  const into = MARK_TYPE[id];
  const props: OverrideProps = { ...(m.props ?? {}) };
  if (from && markIdOf(from) === id) {
    const p = from.props;
    if (into === 'table' && p.sub) props.sub = p.sub;
    if (into === 'data') { if (p.fmt) props.fmt = p.fmt; if (p.row) props.row = p.row; }
    if (into === 'music') { if (p.init != null) props.init = p.init; if (p.play != null) props.play = p.play; }
  }
  const touched = A.blocks.filter(b => b.start < end && b.end > start);
  return {
    override: { start, end, type: into, ...(Object.keys(props).length ? { props } : {}) },
    id, into,
    replaced: touched.filter(b => b.start >= start && b.end <= end),
    cut: touched.filter(b => b.start < start || b.end > end),
  };
}
