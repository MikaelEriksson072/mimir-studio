/* 5.1 memory image (8.1b: relocated blocks where they run), 5.2 user overrides, 5.3 BASIC stubs */
import type { Ctx } from './context';
import { T, TYPE_BY_KEY } from '../model';
import type { Addr, BlockKind, Reloc } from '../types';
import { $4 } from '../util/hex';
import { parseBasic } from '../c64/basic';

export function loadMemory(ctx: Ctx): void {
  const { files, mem, owner, L } = ctx;
  files.forEach((f, i) => {
    const end = Math.min(0x10000, f.load + f.bytes.length);
    let overlap = 0;
    for (let a = f.load; a < end; a++) { if (owner[a] >= 0) overlap++; mem[a] = f.bytes[a - f.load]; owner[a] = i; }
    L('info', `Loaded ${f.name}: ${$4(f.load)}-${$4(end - 1)}, ${end - f.load} bytes`, f.load, 'load');
    if (f.load + f.bytes.length > 0x10000) L('warn', `${f.name} runs past $ffff and was truncated`, f.load, 'load', 'file-truncated');
    if (overlap) L('warn', `${f.name} overlaps ${overlap} bytes of an earlier file; the later file wins`, f.load, 'load', 'file-overlap');
  });
  dropJunk(ctx);
  placeRelocs(ctx);
}

/** 11.7: the bytes the user called junk are not loaded: nothing traces, names or writes them (they read as $00, like
 *  the gap Kick Assembler leaves in the output) */
function dropJunk(ctx: Ctx): void {
  const { mem, owner, L } = ctx;
  for (const j of ctx.project.junk ?? []) {
    let n = 0;
    for (let a = Math.max(0, j.start); a < Math.min(0x10000, j.end); a++) if (owner[a] >= 0) { owner[a] = -1; mem[a] = 0; n++; }
    if (n) L('info', `${span(j.start, j.end)} is junk: left out (${n} byte${n === 1 ? '' : 's'})`, j.start, 'load');
  }
}

const span = (s: Addr, e: Addr) => (e - s > 1 ? `${$4(s)}-${$4(e - 1)}` : $4(s));

/**
 * 8.1b: a copy of each relocated block's bytes where they run. A block is placed once all its bytes are loaded by one
 * owner (a file, or the copy of a block placed before: a block relocated again from where it runs) and nothing is
 * loaded where it runs; the copy is owned by `files.length + k` (`Ctx.relocs`). What cannot be placed is told why.
 */
function placeRelocs(ctx: Ctx): void {
  const { files, mem, owner, relocs, L } = ctx;
  const fileOf = (o: number) => (o >= files.length ? relocs[o - files.length].file : o);
  const ownerName = (o: number) => {
    if (o < files.length) return files[o].name;
    const x = relocs[o - files.length];
    return `the relocated block at ${span(x.to, x.to + x.end - x.start)}`;
  };
  /** why `r` cannot be placed now; null: it can */
  const why = (r: Reloc): string | null => {
    const n = r.end - r.start;
    if (r.end > 0x10000) return 'it runs past $ffff where it is loaded';
    if (r.to + n > 0x10000) return `at ${$4(r.to)} it would run past $ffff`;
    const o = owner[r.start];
    for (let a = r.start; a < r.end; a++) {
      if (owner[a] < 0) return `${$4(a)} is not loaded`;
      if (owner[a] !== o) return `it crosses from ${ownerName(o)} into ${ownerName(owner[a])} at ${$4(a)}`;
    }
    const other = relocs.find(x => x.start < r.end && r.start < x.end);
    if (other) return `it overlaps the relocated block ${span(other.start, other.end)}`;
    for (let a = r.to; a < r.to + n; a++) if (owner[a] >= 0) {
      return a >= r.start && a < r.end ? 'where it runs it would cover its own bytes, which a block of its own cannot show'
        : `${$4(a)}, where it would run, is loaded from ${ownerName(owner[a])} (nothing may be loaded where a relocated block runs)`;
    }
    return null;
  };
  // in rounds: a block relocated from where another one runs waits for that one
  let left = (ctx.project.relocs || []).filter(r => r.start < r.end);
  for (let again = true; left.length && again;) {
    again = false;
    left = left.filter(r => {
      if (why(r)) return true;
      const k = relocs.length, n = r.end - r.start, o = owner[r.start];
      for (let i = 0; i < n; i++) { mem[r.to + i] = mem[r.start + i]; owner[r.to + i] = files.length + k; }
      relocs.push({ start: r.start, end: r.end, to: r.to, file: fileOf(o) });
      L('info', `${span(r.start, r.end)} of ${ownerName(o)} runs at ${span(r.to, r.to + n)} (relocated): it is read, traced and named there`, r.start, 'reloc');
      again = true;
      return false;
    });
  }
  for (const r of left) L('warn', `The block ${span(r.start, r.end)} relocated to ${$4(r.to)} is not placed: ${why(r)}`, r.start < 0x10000 ? r.start : null, 'reloc', 'reloc-unplaced');
}

/** 8.1b: the result's owners, where a relocated block's copy is owned by the file whose bytes it holds; the blocks
 *  and the music likewise. Without relocated blocks: as they are. */
export function fileOwners(ctx: Ctx, ...lists: { file: number }[][]): Int16Array {
  const n = ctx.files.length, fileOf = (o: number) => (o >= n ? ctx.relocs[o - n].file : o);
  if (!ctx.relocs.length) return ctx.owner;
  for (const l of lists) for (const x of l) x.file = fileOf(x.file);
  return ctx.owner.map(fileOf);
}

/** Later overrides win; 'auto' clears. Unknown type names (old project files) count as data.
 * Only what still wins counts: an override that later ones cover completely leaves no block boundary, props,
 * entry point or code sweep behind, so marking a range merges the overrides inside it into the new block. */
export function applyOverrides(ctx: Ctx): void {
  const { project, ov, ovProps, joined } = ctx;
  const list = project.overrides || [];
  const win = new Int32Array(0x10000).fill(-1);
  list.forEach((o, i) => {
    // a stored 'reloc' says nothing: a relocated block is a Reloc, not an override
    const t = o.type === 'auto' ? 0 : o.type === 'reloc' ? T.DATA : (TYPE_BY_KEY[o.type as BlockKind] || T.DATA);
    for (let a = o.start; a < o.end && a < 0x10000; a++) { ov[a] = t; win[a] = o.type === 'auto' ? -1 : i; }
  });
  // a block boundary (with that override's props) wherever the winning override changes
  const live = new Set<number>();
  for (let a = 0; a < 0x10000; a++) {
    const i = win[a]; if (i < 0) continue;
    live.add(i);
    if (a === 0 || win[a - 1] !== i) ovProps.set(a, list[i]);
    // code merged into one block: past where the override's part starts, no routine starts a block of its own
    else if (list[i].type === 'code' && list[i].props?.one) joined[a] = 1;
  }
  // 8.1b: where a relocated block is loaded it is that block, whatever was marked there: its bytes are marked where
  // they run
  for (const r of ctx.relocs) for (let a = r.start; a < r.end; a++) { ov[a] = T.RELOC; ovProps.delete(a); joined[a] = 0; }
  ctx.ovList = list.filter((o, i) => live.has(i) && !ctx.relocs.some(r => o.start >= r.start && o.start < r.end));
}

export function findBasicStubs(ctx: Ctx): void {
  const { files, ov, mem, owner, basics, L } = ctx;
  files.forEach((f, i) => {
    // a file that starts before $0801 and covers it (a memory dump, a VICE snapshot from $0200) counts only a stub
    // that SYSes into the same file, so dump bytes that happen to look like a BASIC line are not taken for one
    const covers = f.load < 0x0801 && f.load + f.bytes.length > 0x0801;
    if ((f.load !== 0x0801 && !covers) || ov[0x0801]) return;
    const b = parseBasic(mem, owner, 0x0801);
    if (b && covers && (b.sys == null || owner[b.sys] !== i)) return;
    if (b) {
      b.file = i; basics.push(b);
      L('ok', `BASIC stub: ${b.lines.map(l => l.text).join(' : ')}` + (b.sys != null ? ` → entry ${$4(b.sys)}` : ''), 0x0801, 'entry');
    }
  });
}
