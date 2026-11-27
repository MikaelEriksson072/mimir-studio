/* Pictures in the listing: the .byte rows of sprites, charsets and bitmaps drawn as they look (Settings → General).
 * The listing's lines are the source's, so a graphics block's rows are replaced by picture lines (GfxLine): a
 * charset as rows of 32 characters, sprites 8 to a row with their addresses under them, a bitmap as its picture. A
 * picture taller than a row of the listing is followed by lines that only make its room (`pad`), so every line keeps
 * the listing's row height. Labels, comment lines and the .import of a binary file stay lines of their own, and
 * break the picture where they are. The export and the source view do not change. Pure, so the tests share it. */
import { findBlock, h4, type Addr, type AnalysisResult, type Block, type GfxLine, type ListingLine, type Override, type SpriteColors } from '@mimir/core';
import { fileLineNumbers } from './lines';
import { C64, hexRgb } from './palette';
import type { GfxColors } from './gfxview';

export type GfxKind = GfxLine['kind'];

/** the kind of picture a block type is drawn as */
export const GFX_KIND: Partial<Record<Block['type'], GfxKind>> = { sprite: 'sprite', charset: 'chars', bitmap: 'bitmap' };

/** An item's size and the gap after it, in C64 pixels; how many go on a row; how much bigger they are drawn; how many
 *  rows of the listing (20 px) one row of items takes. */
export const GFX_GEOMETRY: Record<GfxKind, { unit: number; w: number; h: number; gap: number; cols: number; scale: number }> = {
  chars: { unit: 8, w: 8, h: 8, gap: 0, cols: 32, scale: 2 },
  sprite: { unit: 64, w: 24, h: 21, gap: 5, cols: 8, scale: 2 },
  bitmap: { unit: 8, w: 8, h: 8, gap: 0, cols: 40, scale: 1 },
};
/** the bytes of a bitmap's picture: 40 x 25 cells of 8 bytes */
const BITMAP_BYTES = 8000;
/** the height of a listing row (lib/util ROW; not imported, so the tests need no DOM) */
const ROW_PX = 20;
/** below a sprite: its address */
export const SPRITE_CAPTION = 13;

/** Whether block `b` is drawn multicolour: as set for it, else as the VIC evidence says. Sprites: the bits written to
 *  $d01c for the sprites whose pointer points into the block (any bit when no pointer does); a charset: $d016's
 *  multicolour bit when no bitmap mode is set (which it is then for); a bitmap: $d016's multicolour bit. */
export function blockMc(A: AnalysisResult, b: Block): boolean {
  return b.props.mc ?? vicMc(A, b.type, b.start, b.end);
}

/** whether `start`..`end` as a block of `type` is multicolour as the VIC evidence says (blockMc without a setting) */
export function vicMc(A: AnalysisResult, type: Block['type'], start: Addr, end: Addr): boolean {
  if (type === 'sprite') {
    const m = A.vic.spriteMc ?? 0;
    if (!m) return false;
    const refs = A.vic.sprites.filter(s => s.addr >= start && s.addr < end);
    return refs.length ? refs.some(s => (m >> s.n) & 1) : true;
  }
  return type === 'charset' ? A.vic.multicolor && !A.vic.bitmap : A.vic.multicolor;
}

/** The block setting (OverrideProps.mc) that draws `start`..`end` as a block of `type` multicolour or not (`mc`), as
 *  set where it is seen (the Graphics tab): null when the VIC evidence says the same, so it keeps following it. */
export function mcSetting(A: AnalysisResult, type: Block['type'], start: Addr, end: Addr, mc: boolean): boolean | null {
  return vicMc(A, type, start, end) === mc ? null : mc;
}

/** Mark as override `o` with sprites, a charset or a bitmap drawn multicolour or not (`mc`) as where they were marked
 *  (the Graphics tab): its setting (mcSetting) over the one of a block it merges with; other types as they are */
export function markMc(A: AnalysisResult, o: Override, mc: boolean): Override {
  if (o.type !== 'sprite' && o.type !== 'charset' && o.type !== 'bitmap') return o;
  const v = mcSetting(A, o.type, o.start, o.end, mc), { props: p0, ...base } = o, { mc: _, ...rest } = p0 ?? {};
  const props = v == null ? rest : { ...rest, mc: v };
  return Object.keys(props).length ? { ...base, props } : base;
}

/** Sprites' colours (as the VIC gives them) as the colours of the bit pairs that drawGfxLine and the Graphics tab take
 *  (00, 01, 10, 11; hires 0 and 1 as 00 and 11): the sprite's own colour is a set pixel, in multicolour 10, and
 *  multicolour 2 ($d026) is 11. */
export function spritePairColors(c: SpriteColors, mc: boolean): GfxColors {
  return mc ? { bg: c.bg, mc1: c.mc1, mc2: c.sprite, fg: c.mc2 } : { bg: c.bg, fg: c.sprite, mc1: c.mc1, mc2: c.mc2 };
}

/** The sprite colours that draw sprites as the bit pairs' colours `t` (the Graphics tab's) do, multicolour or not:
 *  spritePairColors the other way round. */
export function spriteColorsOf(t: GfxColors, mc: boolean): SpriteColors {
  return mc ? { bg: t.bg, sprite: t.mc2, mc1: t.mc1, mc2: t.fg } : { bg: t.bg, sprite: t.fg, mc1: t.mc1, mc2: t.mc2 };
}

/** whether two sets of sprite colours (or none) are the same */
export const sameSpriteColors = (a: SpriteColors | null | undefined, b: SpriteColors | null | undefined): boolean =>
  !a || !b ? !a === !b : a.bg === b.bg && a.sprite === b.sprite && a.mc1 === b.mc1 && a.mc2 === b.mc2;

/** the block type each Graphics tab view draws (lib/gfxview GfxKind): its multicolour is that block's */
const GFX_VIEW_BLOCK: Record<string, Block['type'] | undefined> = { sprites: 'sprite', chars: 'charset', fontrows: 'charset', bitmap: 'bitmap' };

/** Multicolor switched in Graphics tab view `view` with `start`..`end` selected: the blocks of the type it draws that the
 *  selection has bytes in and that are not drawn so yet, each with the setting that draws it so (mcSetting) */
export function gfxMcChanges(A: AnalysisResult, view: string, start: Addr, end: Addr, mc: boolean): { b: Block; mc: boolean | null }[] {
  const type = GFX_VIEW_BLOCK[view];
  if (!type) return [];
  return A.blocks.filter(b => b.type === type && b.start < end && start < b.end && blockMc(A, b) !== mc).map(b => ({ b, mc: mcSetting(A, b.type, b.start, b.end, mc) }));
}

/** how many items a picture line holds (the last one may lack bytes) */
export const gfxCount = (l: GfxLine): number => Math.ceil(l.n / l.unit);
/** the rows of items a picture line has */
export const gfxGridRows = (l: GfxLine): number => Math.max(1, Math.ceil((l.col + gfxCount(l)) / l.cols));
/** the size of a picture line in C64 pixels (its canvas), before it is drawn `scale` times bigger */
export function gfxSize(l: GfxLine): { width: number; height: number; scale: number } {
  const g = GFX_GEOMETRY[l.kind];
  return { width: l.cols * (g.w + g.gap) - g.gap, height: gfxGridRows(l) * g.h, scale: g.scale };
}
/** where item `k` of a picture line is drawn, in C64 pixels */
export function gfxItemBox(l: GfxLine, k: number): { x: number; y: number; w: number; h: number } {
  const g = GFX_GEOMETRY[l.kind], i = l.col + k;
  return { x: (i % l.cols) * (g.w + g.gap), y: Math.floor(i / l.cols) * g.h, w: g.w, h: g.h };
}
/** the bytes of item `k` */
const itemCell = (l: GfxLine, k: number) => ({ a: l.a + k * l.unit, n: Math.min(l.unit, l.n - k * l.unit) });

/** the items of a picture line as cells (lib/cells: ← and → step through them, a click picks one); none for its room */
export function gfxCells(l: GfxLine): { a: Addr; n: number }[] {
  return l.pad ? [] : Array.from({ length: gfxCount(l) }, (_, k) => itemCell(l, k));
}

/** the item under a point (C64 pixels from the picture's top left), as a cell; null in a gap or past the last item */
export function gfxItemAt(l: GfxLine, x: number, y: number): { a: Addr; n: number } | null {
  const g = GFX_GEOMETRY[l.kind];
  if (x < 0 || y < 0) return null;
  const cx = Math.floor(x / (g.w + g.gap)), cy = Math.floor(y / g.h);
  if (cx >= l.cols || x - cx * (g.w + g.gap) >= g.w) return null;
  const k = cy * l.cols + cx - l.col;
  return k >= 0 && k < gfxCount(l) ? itemCell(l, k) : null;
}

/** the rectangles (C64 pixels) of the items that `start`..`end` (end excluded) takes in, one per row of items */
export function gfxRects(l: GfxLine, start: Addr, end: Addr): { x: number; y: number; w: number; h: number }[] {
  const n = gfxCount(l), k0 = Math.max(0, Math.floor((start - l.a) / l.unit)), k1 = Math.min(n - 1, Math.ceil((end - l.a) / l.unit) - 1);
  const out: { x: number; y: number; w: number; h: number }[] = [];
  for (let k = k0; k <= k1; k++) {
    const b = gfxItemBox(l, k), last = out[out.length - 1];
    if (last && last.y === b.y && k > k0) last.w = b.x + b.w - last.x; else out.push({ ...b });
  }
  return out;
}

/** What item `k` is, for its tooltip: a character's screen code (in its 2 KB, as the VIC counts them), a sprite's
 *  pointer and the sprites that point to it, a bitmap cell's column and row. */
export function gfxItemText(A: { vic: { sprites: readonly { addr: Addr; n: number }[] } }, l: GfxLine, k: number): string {
  const { a, n } = itemCell(l, k), span = n > 1 ? `$${h4(a)}–$${h4(a + n - 1)}` : `$${h4(a)}`;
  const part = n < l.unit ? ` · ${n} of its ${l.unit} bytes` : '';
  if (l.kind === 'chars') return `Character $${((a & 0x7ff) >> 3).toString(16).padStart(2, '0')} · ${span}${part}`;
  if (l.kind === 'sprite') {
    const ptr = ((a & 0x3fff) >> 6).toString(16).padStart(2, '0'), by = A.vic.sprites.filter(s => s.addr === (a & 0xffff)).map(s => s.n);
    const name = l.names?.find(x => x.a === a)?.name;
    return `Sprite ${name ? `${name} · ` : ''}${span} · pointer $${ptr} in VIC bank ${(a & 0xffff) >> 14}${by.length ? ` · sprite ${[...new Set(by)].sort().join(', ')} points to it` : ''}${part}`;
  }
  const c = (a - l.blk) >> 3;
  return `Cell ${c % 40}, ${Math.floor(c / 40)} · ${span}${part}`;
}

/**
 * Draw picture line `l` into RGBA `px` (gfxSize wide and high): each item in its block's colours (sprites given theirs
 * in the inspector) or else `colors`, the Graphics tab's, hires or multicolour (pairs of bits: background, mc1, mc2,
 * foreground); where no item is, transparent.
 */
export function drawGfxLine(px: Uint8ClampedArray, l: GfxLine, mem: Uint8Array, colors: GfxColors): void {
  const { width } = gfxSize(l), g = GFX_GEOMETRY[l.kind], c = l.colors ?? colors;
  const pal = [c.bg, c.mc1, c.mc2, c.fg].map(i => hexRgb(C64[i & 15]));
  px.fill(0);
  const put = (x: number, y: number, c: number[]) => { const o = (y * width + x) * 4; px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; px[o + 3] = 255; };
  const byte = (v: number, x: number, y: number) => {
    if (l.mc) for (let k = 0; k < 4; k++) { const c = pal[(v >> (6 - k * 2)) & 3]; put(x + k * 2, y, c); put(x + k * 2 + 1, y, c); }
    else for (let k = 0; k < 8; k++) put(x + k, y, (v >> (7 - k)) & 1 ? pal[3] : pal[0]);
  };
  const end = l.a + l.n;
  for (let k = 0, n = gfxCount(l); k < n; k++) {
    const { x, y } = gfxItemBox(l, k), a = l.a + k * l.unit;
    // a byte the line does not hold (the end of a block that is no whole sprite) is drawn empty
    const at = (q: Addr) => (q < end && q < mem.length ? mem[q] : 0);
    if (l.kind === 'sprite') { for (let r = 0; r < g.h; r++) for (let c = 0; c < 3; c++) byte(at(a + r * 3 + c), x + c * 8, y + r); }
    else for (let r = 0; r < 8; r++) byte(at(a + r), x, y + r);
  }
}

/** How many characters and sprites go on a row of the listing when `room` pixels are left for the picture: 32
 *  characters (a row of screen codes, $00-$1f …) or as many as 16 or 8 that fit, and up to 8 sprites. */
export function gfxColsFor(room: number): Partial<Record<GfxKind, number>> {
  const step = (GFX_GEOMETRY.sprite.w + GFX_GEOMETRY.sprite.gap) * GFX_GEOMETRY.sprite.scale;
  return { chars: room >= 512 ? 32 : room >= 256 ? 16 : 8, sprite: Math.max(1, Math.min(8, Math.floor((room + GFX_GEOMETRY.sprite.gap * 2) / step))) };
}

/** The picture lines bytes `start`..`end` of a block of `kind` (starting at `blk`) are drawn as, `cols` items a row: a
 *  bitmap whole (from the cell its first byte is in); a charset's rows hold the characters whose screen codes share it
 *  ($00-$1f, $20-$3f …); sprites start each row anew. `col`: the column its first item is in. */
export function gfxSpans(kind: GfxKind, blk: Addr, start: Addr, end: Addr, cols: number): { s: Addr; e: Addr; col: number }[] {
  const unit = GFX_GEOMETRY[kind].unit, aligned = (start - blk) % unit === 0;
  if (kind === 'bitmap') return [{ s: start, e: end, col: aligned ? ((start - blk) >> 3) % 40 : 0 }];
  const out: { s: Addr; e: Addr; col: number }[] = [];
  let p = start, col = kind === 'chars' && aligned && !(start & 7) ? ((start & 0x7ff) >> 3) % cols : 0;
  while (p < end) {
    const e = Math.min(end, p + (cols - col) * unit);
    out.push({ s: p, e, col });
    p = e; col = 0;
  }
  return out;
}

/** The listing's lines with the .byte rows of every sprite, charset and bitmap block drawn as pictures, and each
 *  line's number in its .asm file (a picture: the first row it stands for; its room: 0). Blocks shown as code (Data as
 *  code) stay as they are. `cols`: how many characters and sprites a row (gfxColsFor; GFX_GEOMETRY by default). */
export function gfxListing(all: readonly ListingLine[], A: AnalysisResult, cols: Partial<Record<GfxKind, number>> = {}): { lines: ListingLine[]; nums: Int32Array } {
  const nums0 = fileLineNumbers(all);
  const out: ListingLine[] = [], nums: number[] = [];
  const keep = (l: ListingLine, num: number) => { out.push(l); nums.push(num); };
  let b: Block | null = null, kind: GfxKind | null = null, mc = false;
  /** the bytes gathered for the next picture: from `start` to `end`, the row numbers and comments of their rows;
   *  `after`: labels and comment lines inside an item (not where one starts), which come under the picture that holds
   *  it; `names`: the labels of its sprites */
  let run: { start: Addr; end: Addr; rows: { a: Addr; num: number }[]; cmts: { a: Addr; n: number; cmt: string }[]; after: { l: ListingLine; num: number }[]; names: { a: Addr; name: string }[] } | null = null;
  /** the label of a sprite (where one starts), until its bytes come: it is written under the sprite */
  let pending: { l: Extract<ListingLine, { k: 'lbl' }>; num: number }[] = [];
  /** labels kept for a sprite whose bytes did not come after all are lines of their own again */
  const unpend = () => { for (const x of pending) keep(x.l, x.num); pending = []; };
  const flush = () => {
    const r = run; run = null;
    if (!r || !b || !kind) return;
    const g = { ...GFX_GEOMETRY[kind], cols: kind === 'bitmap' ? 40 : cols[kind] ?? GFX_GEOMETRY[kind].cols };
    const numAt = (a: Addr) => { let num = r.rows[0].num; for (const x of r.rows) if (x.a <= a) num = x.num; return num; };
    const push = (s: Addr, e: Addr, col: number) => {
      const cs = r.cmts.filter(c => c.a < e && c.a + c.n > s), cmt = cs.map(c => c.cmt).join(' · ');
      const names = r.names.filter(x => x.a >= s && x.a < e);
      const own = kind === 'sprite' ? b!.props.colors : undefined;
      const l: GfxLine = { k: 'gfx', a: s, n: e - s, kind: kind!, unit: g.unit, col, cols: g.cols, rows: 1, blk: b!.start, mc, ...(own ? { colors: spritePairColors(own, mc) } : {}), ...(cmt ? { cmt, cmtAt: cs.map(c => c.a) } : {}), ...(names.length ? { names } : {}) };
      const h = gfxGridRows(l) * g.h * g.scale + (kind === 'sprite' ? SPRITE_CAPTION + 4 : kind === 'bitmap' ? 8 : 0);
      l.rows = Math.max(1, Math.ceil(h / ROW_PX));
      keep(l, numAt(s));
      for (let k = 1; k < l.rows; k++) keep({ ...l, n: 0, pad: true, cmt: undefined, cmtAt: undefined, names: undefined }, 0);
      for (const x of r.after) if (x.l.a >= s && (x.l.a < e || e === r.end)) keep(x.l, x.num);
    };
    for (const s of gfxSpans(kind, b.start, r.start, r.end, g.cols)) push(s.s, s.e, s.col);
  };
  all.forEach((l, i) => {
    if (l.k === 'hdr' || l.k === 'file') {
      flush(); unpend();
      const nb = l.k === 'hdr' && !l.preview ? A.blocks[l.blk] : null;
      b = nb && GFX_KIND[nb.type] ? nb : null;
      kind = b ? GFX_KIND[b.type]! : null;
      mc = b ? blockMc(A, b) : false;
      keep(l, nums0[i]);
      return;
    }
    if (!b || !kind) { keep(l, nums0[i]); return; }
    // the bytes of the picture: a bitmap's first 8000 (what is after them is no part of the picture)
    const last = kind === 'bitmap' ? Math.min(b.end, b.start + BITMAP_BYTES) : b.end;
    const bytes = (l.k === 'dat' || (l.k === 'dir' && l.n > 0)) && l.a >= b.start && l.a + l.n <= last ? l : null;
    if (bytes) {
      // the .import of a binary file stays (without bytes of its own); the picture of its bytes comes under it
      if (l.k === 'dir') { flush(); keep({ ...l, n: 0 }, nums0[i]); }
      if (run && run.end !== l.a) flush();
      run ??= { start: l.a, end: l.a, rows: [], cmts: [], after: [], names: [] };
      run.end = l.a + bytes.n;
      // the picture of an .import is no line of the .asm file: no number (the .import line has it)
      run.rows.push({ a: l.a, num: l.k === 'dir' ? 0 : nums0[i] });
      for (const x of pending) run.names.push({ a: x.l.a, name: x.l.name });
      pending = [];
      if (l.k === 'dat' && l.userCmt && l.cmt) run.cmts.push({ a: l.a, n: l.n, cmt: l.cmt });
      if (l.k === 'dir') flush();
      return;
    }
    // a sprite's own comment line (its address and pointer) is what the picture shows, and its label goes under it
    if (kind === 'sprite' && l.k === 'cmt' && !l.note && !l.mark && !l.raw && l.zp == null && /^sprite \$/i.test(l.text)) return;
    if (kind === 'sprite' && l.k === 'lbl' && l.a < b.end && (l.a - b.start) % 64 === 0 && (!run || run.end === l.a)) { pending.push({ l, num: nums0[i] }); return; }
    // a label, a comment line or an empty line inside an item does not cut the picture there: it comes under it
    if (run && (l.k === 'lbl' || (l.k === 'cmt' && l.note) || (l.k === 'blank' && l.user)) && l.a > run.start && (l.a - b.start) % GFX_GEOMETRY[kind].unit !== 0) { run.after.push({ l, num: nums0[i] }); return; }
    flush(); unpend();
    keep(l, nums0[i]);
  });
  flush(); unpend();
  return { lines: out, nums: Int32Array.from(nums) };
}

/** the picture line a line of the listing is (its own, or the one whose room it is), else the line itself */
export function gfxHead(lines: readonly ListingLine[], i: number): number {
  while (i > 0 && lines[i]?.k === 'gfx' && (lines[i] as GfxLine).pad) i--;
  return i;
}

/** the block of a picture line */
export const gfxBlock = (A: AnalysisResult, l: GfxLine): Block | null => findBlock(A.blocks, l.blk);
