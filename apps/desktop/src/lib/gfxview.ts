/* The memory graphics browser (spec 14.5): all 64 KB drawn as characters, sprites, bitmaps or screens, ICU64-style,
 * and pictures made of a font per character row. With every bank of a cartridge at once (13.9b) the rows are the
 * banks' loaded parts one after the other, at bank addresses. Pure geometry and drawing, so the view and the tests
 * share them. */
import { DEMO_FONT, type Addr, type C64Picture } from '@mimir/core';
import { C64, hexRgb } from './palette';

/** `fontrows`: a picture of up to 25 character rows, each drawn with its own font (2 KB, the one after the font of the row
 *  above) and the same 40 screen codes (the first row of the screen) */
export type GfxKind = 'chars' | 'sprites' | 'bitmap' | 'screens' | 'fontrows';

export interface GfxLayout {
  kind: GfxKind;
  /** bytes per cell: a character (8), a sprite (64), a bitmap frame (8192: one per 8 KB, of which 8000 are shown), a
   *  screen (1024: one per 1 KB, as the VIC places them, of which 1000 are shown) */
  unit: number;
  cols: number;
  /** cell size and the gap after it, in pixels at zoom 1 */
  cellW: number; cellH: number; gapX: number; gapY: number;
  /** the first cell starts here (0..unit-1): moves the grid by bytes to find data that is not aligned; a font per row:
   *  the first font */
  offset: number;
  rows: number;
  width: number; height: number;
  /** a font per row: the 40 screen codes every row shows, and the font of each row (2 KB apart, where a font can be) */
  codes?: Uint8Array;
  rowStarts?: Addr[];
  /** the memory laid out ends here: 64 KB, or past the last bank */
  size: number;
  /** parts of memory laid out one after the other (every bank at once): each row's first address, and where the part
   *  the row is in ends (no cell starts there or after it) */
  parts?: { starts: Addr[]; ends: Addr[] };
  /** bitmaps: the part of each that is drawn (a cell is that part: `cols` x 8 by `rows` x 8 pixels) */
  win?: BitmapWindow;
}

/** bytes a bitmap frame shows: 40 x 25 cells of 8 bytes */
export const BITMAP_BYTES = 8000;
/** character rows in a whole bitmap; a bitmap row is 40 cells of 8 bytes (320 bytes, 8 pixel lines) */
export const BITMAP_ROWS = 25;
export const BITMAP_ROW_BYTES = 320;
/** cells in a bitmap row (8 bytes each, 8 pixels wide) */
export const BITMAP_COLS = 40;
/** a bitmap height as a whole number of character rows, 1 to 25 (anything else is a whole bitmap) */
export const bitmapRowsOf = (n: unknown) => (typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= BITMAP_ROWS ? n : BITMAP_ROWS);

/** The part of each bitmap that is drawn and selected: character rows `top` to `top + rows - 1` (0-24) and columns
 *  `left` to `left + cols - 1` (0-39), counted as the VIC counts them. Its bytes stay where they are in the bitmap (a
 *  logo in the middle of the screen, code in the columns beside it); what is outside it is not drawn. */
export interface BitmapWindow { top: number; rows: number; left: number; cols: number }
export const WHOLE_BITMAP: Readonly<BitmapWindow> = { top: 0, rows: BITMAP_ROWS, left: 0, cols: BITMAP_COLS };
const intIn = (n: unknown, lo: number, hi: number): n is number => typeof n === 'number' && Number.isInteger(n) && n >= lo && n <= hi;
/** a window that fits in a bitmap: a first row or column outside it is 0, a count that does not fit is the rest of the
 *  bitmap from there. A number is that many rows from the top, the whole width (as `bitmapRowsOf`) */
export function bitmapWindowOf(w: number | Partial<Record<keyof BitmapWindow, unknown>> | null | undefined): BitmapWindow {
  if (w == null || typeof w !== 'object') return { ...WHOLE_BITMAP, rows: bitmapRowsOf(w) };
  const top = intIn(w.top, 0, BITMAP_ROWS - 1) ? w.top : 0, left = intIn(w.left, 0, BITMAP_COLS - 1) ? w.left : 0;
  return { top, rows: intIn(w.rows, 1, BITMAP_ROWS - top) ? w.rows : BITMAP_ROWS - top, left, cols: intIn(w.cols, 1, BITMAP_COLS - left) ? w.cols : BITMAP_COLS - left };
}
export const isWholeBitmap = (w: BitmapWindow) => w.top === 0 && w.left === 0 && w.rows === BITMAP_ROWS && w.cols === BITMAP_COLS;
/** a window's bytes counted from the first byte of its bitmap: its first byte, and just past its last */
export const windowSpan = (w: BitmapWindow) => ({ from: w.top * BITMAP_ROW_BYTES + w.left * 8, to: (w.top + w.rows - 1) * BITMAP_ROW_BYTES + (w.left + w.cols) * 8 });
/** the bytes of the window in the bitmap at `frame`: a stretch per character row (`cols` cells), or one for all of
 *  them when the window is as wide as the bitmap; cut to `within` */
export function windowPieces(frame: Addr, w: BitmapWindow, within?: { start: Addr; end: Addr }): { start: Addr; end: Addr }[] {
  const s = windowSpan(w), out: { start: Addr; end: Addr }[] = [];
  const all = w.cols === BITMAP_COLS ? [{ start: frame + s.from, end: frame + s.to }]
    : Array.from({ length: w.rows }, (_, r) => { const a = frame + (w.top + r) * BITMAP_ROW_BYTES + w.left * 8; return { start: a, end: a + w.cols * 8 }; });
  for (const p of all) {
    const a = Math.max(p.start, within?.start ?? p.start), b = Math.min(p.end, within?.end ?? p.end);
    if (a < b) out.push({ start: a, end: b });
  }
  return out;
}
/** the bitmap at `frame` as 8000 bytes with only the window's in them (the rest 0): a picture of what is drawn */
export function windowBitmap(mem: Uint8Array, frame: Addr, w: BitmapWindow): Uint8Array {
  const out = new Uint8Array(BITMAP_BYTES);
  for (const p of windowPieces(frame, w)) out.set(mem.subarray(p.start, Math.min(p.end, mem.length)), p.start - frame);
  return out;
}
/** sprites a row can show, 1 to this many */
export const MAX_SPRITE_COLS = 24;
/** a count of sprites a row, 1 to 24 (anything else is the default 8) */
export const spriteColsOf = (n: unknown) => (typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= MAX_SPRITE_COLS ? n : 8);
/** bytes a screen shows: 40 x 25 screen codes */
export const SCREEN_BYTES = 1000;

/** `parts`: only these ranges, one after the other (every bank of a cartridge: its loaded memory at bank addresses,
 *  each starting on 8 KB so the cells stay where the VIC has them); the grid's offset moves each part's first cell.
 *  `bitmap`: the part of each bitmap drawn (BitmapWindow; a number: its first 1-25 character rows), a picture smaller
 *  than the screen, a logo in the middle of it. Still one per 8 KB; a bitmap cell is that part, its bytes from the
 *  window's first to its last */
export function gfxLayout(kind: GfxKind, cols: number, offset = 0, parts?: readonly { start: Addr; end: Addr }[], bitmap: number | BitmapWindow = WHOLE_BITMAP): GfxLayout {
  const win = kind === 'bitmap' ? bitmapWindowOf(bitmap) : undefined;
  const g = kind === 'chars' ? { unit: 8, cellW: 8, cellH: 8, gapX: 0, gapY: 0, cols }
    : kind === 'sprites' ? { unit: 64, cellW: 24, cellH: 21, gapX: 2, gapY: 2, cols }
      : kind === 'screens' ? { unit: 0x400, cellW: 320, cellH: 200, gapX: 8, gapY: 8, cols }
        : { unit: 0x2000, cellW: win!.cols * 8, cellH: win!.rows * 8, gapX: 0, gapY: 8, cols: 1 };
  const off = ((offset % g.unit) + g.unit) % g.unit;
  const width = g.cols * (g.cellW + g.gapX), w = win ? { win } : {};
  if (!parts) {
    const rows = Math.ceil((0x10000 - off) / (g.unit * g.cols));
    return { kind, ...g, offset: off, rows, width, height: rows * (g.cellH + g.gapY), size: 0x10000, ...w };
  }
  const starts: Addr[] = [], ends: Addr[] = [];
  for (const p of parts) for (let a = p.start + off; a < p.end; a += g.unit * g.cols) { starts.push(a); ends.push(p.end); }
  const rows = starts.length, size = parts.reduce((n, p) => Math.max(n, p.end), 0);
  return { kind, ...g, offset: off, rows, width, height: rows * (g.cellH + g.gapY), size, parts: { starts, ends }, ...w };
}
/** the part of a bitmap layout's bitmaps drawn (a layout made without one: its rows from the top, the whole width) */
const winOf = (L: GfxLayout): BitmapWindow => L.win ?? { ...WHOLE_BITMAP, rows: Math.max(1, L.cellH >> 3) };

/** the most character rows a font-per-row picture has: a screen's */
export const FONT_ROWS = 25;

/** Memory a font (2 KB) cannot be in, as the VIC and the system see it. */
export const NO_FONT: { start: Addr; end: Addr; why: string }[] = [
  { start: 0x0000, end: 0x0800, why: 'zero page, stack and screen' },
  { start: 0x1000, end: 0x2000, why: 'the VIC sees the character ROM there' },
  { start: 0x9000, end: 0xa000, why: 'the VIC sees the character ROM there' },
  { start: 0xd000, end: 0xe000, why: 'I/O and colour RAM' },
];
/** why no font can be at `a` (its 2 KB touch such memory), or null */
export const noFont = (a: Addr) => NO_FONT.find(z => a < z.end && a + 0x800 > z.start) ?? null;

/**
 * The fonts of a font-per-row picture: from `first` in 2 KB steps, one per row, up to `rows` and not past $ffff. With
 * `skip`, a step where no font can be is passed over and the row takes the next one; `skipped` says which and why.
 */
export function fontRowStarts(first: Addr, rows: number, skip = true): { starts: Addr[]; skipped: { at: Addr; why: string }[] } {
  const starts: Addr[] = [], skipped: { at: Addr; why: string }[] = [];
  for (let a = first; a <= 0xffff && starts.length < Math.min(rows, FONT_ROWS); a += 0x800) {
    const z = skip ? noFont(a) : null;
    if (z) skipped.push({ at: a, why: z.why }); else starts.push(a);
  }
  return { starts, skipped };
}

/**
 * A picture of character rows, row r drawn with the font (256 characters, 2 KB) at `starts[r]` and the 40 screen
 * `codes`. A cell is a row: its font.
 */
export function fontRowsLayout(starts: Addr[], codes: ArrayLike<number>): GfxLayout {
  const rowStarts = starts.length ? starts.slice(0, FONT_ROWS) : [0];
  const c = new Uint8Array(40); for (let i = 0; i < 40; i++) c[i] = codes[i] ?? i;
  const n = rowStarts.length;
  return { kind: 'fontrows', unit: 0x800, cols: 1, cellW: 320, cellH: 8, gapX: 0, gapY: 0, offset: rowStarts[0], rows: n, width: 320, height: n * 8, codes: c, rowStarts, size: 0x10000 };
}

/** the bytes of one row of cells */
export const rowBytes = (L: GfxLayout) => L.unit * L.cols;
/** the address of the first byte in row `r` (`rows`: just past the last row) */
export const rowAddr = (L: GfxLayout, r: number) => {
  const s = L.rowStarts, p = L.parts;
  if (p) return r < p.starts.length ? p.starts[r] : p.ends[p.ends.length - 1] ?? 0;
  return s ? (r < s.length ? s[r] : s[s.length - 1] + 0x800) : L.offset + r * rowBytes(L);
};
/** no cell of row `r` starts at or after this: the end of its part, or of memory */
const rowEnd = (L: GfxLayout, r: number) => L.parts?.ends[r] ?? L.size;
/** the row whose bytes hold `a` (parts only), or -1 */
function partRow(L: GfxLayout, a: Addr): number {
  const s = L.parts!.starts;
  let lo = 0, hi = s.length - 1;
  if (hi < 0 || a < s[0]) return -1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (s[mid] <= a) lo = mid; else hi = mid - 1; }
  return a < Math.min(s[lo] + rowBytes(L), L.parts!.ends[lo]) ? lo : -1;
}

/** the cell under a point (pixels at zoom 1), as the address of its first byte; null in a gap or past the end */
export function cellAt(L: GfxLayout, x: number, y: number): Addr | null {
  const c = Math.floor(x / (L.cellW + L.gapX)), r = Math.floor(y / (L.cellH + L.gapY));
  if (c < 0 || c >= L.cols || r < 0 || r >= L.rows) return null;
  if (x - c * (L.cellW + L.gapX) >= L.cellW || y - r * (L.cellH + L.gapY) >= L.cellH) return null;
  const a = rowAddr(L, r) + c * L.unit;
  return a < rowEnd(L, r) ? a : null;
}

/** the cell holding `a`: its first byte and where it is drawn */
export function cellOf(L: GfxLayout, a: Addr): { start: Addr; x: number; y: number; w: number; h: number } | null {
  if (L.parts) {
    const r = partRow(L, a); if (r < 0) return null;
    const c = Math.floor((a - L.parts.starts[r]) / L.unit);
    return { start: L.parts.starts[r] + c * L.unit, x: c * (L.cellW + L.gapX), y: r * (L.cellH + L.gapY), w: L.cellW, h: L.cellH };
  }
  if (a < L.offset || a > 0xffff) return null;
  if (L.rowStarts) {
    // a font per row: the row whose font holds `a` (none in memory the rows skip)
    const r = L.rowStarts.findIndex(s => a >= s && a < s + L.unit);
    return r < 0 ? null : { start: L.rowStarts[r], x: 0, y: r * L.cellH, w: L.cellW, h: L.cellH };
  }
  const k = Math.floor((a - L.offset) / L.unit), r = Math.floor(k / L.cols), c = k % L.cols;
  if (r >= L.rows) return null;
  return { start: L.offset + k * L.unit, x: c * (L.cellW + L.gapX), y: r * (L.cellH + L.gapY), w: L.cellW, h: L.cellH };
}

/** the byte under a point (pixels at zoom 1): a character's row, a sprite's byte, a bitmap cell's row, a screen code */
export function byteAt(L: GfxLayout, x: number, y: number): Addr | null {
  const start = cellAt(L, x, y);
  if (start == null) return null;
  const xi = Math.floor(x % (L.cellW + L.gapX)), yi = Math.floor(y % (L.cellH + L.gapY));
  const a = L.kind === 'chars' ? start + yi : L.kind === 'sprites' ? start + yi * 3 + (xi >> 3)
    : L.kind === 'screens' ? start + (yi >> 3) * 40 + (xi >> 3)
      // a font per row: the character's line in the row's font
      : L.kind === 'fontrows' ? start + L.codes![xi >> 3] * 8 + yi
        // a bitmap: the window's row and column in the bitmap
        : (w => start + ((w.top + (yi >> 3)) * BITMAP_COLS + w.left + (xi >> 3)) * 8 + (yi & 7))(winOf(L));
  return a < L.size ? a : null;
}

/** the cell starting at `start` alone, without gaps: a layout of one row and one column of `L`'s kind, for drawing that
 *  cell by itself (Ctrl over a screen shows it over the whole window) */
export const cellLayout = (L: GfxLayout, start: Addr): GfxLayout => ({
  kind: L.kind, unit: L.unit, cols: 1, cellW: L.cellW, cellH: L.cellH, gapX: 0, gapY: 0, offset: start, rows: 1, width: L.cellW, height: L.cellH, size: L.size, ...(L.win ? { win: L.win } : {}),
});

/** the cell before (`d` -1) or after (1) the one starting at `start`, in reading order: along its row, then the row
 *  below (with every bank, over the end of a bank's part); null at either end */
export function stepCell(L: GfxLayout, start: Addr, d: 1 | -1): Addr | null {
  const c = cellOf(L, start);
  if (!c || L.rowStarts) return null;
  let r = Math.round(c.y / (L.cellH + L.gapY)), k = Math.round(c.x / (L.cellW + L.gapX)) + d;
  for (;;) {
    if (k < 0) { r--; k = L.cols - 1; } else if (k >= L.cols) { r++; k = 0; }
    if (r < 0 || r >= L.rows) return null;
    const a = rowAddr(L, r) + k * L.unit;
    if (a < rowEnd(L, r)) return a;
    // a row of a part that ends before this cell: the next row on, the cell before it back
    if (d > 0) { r++; k = 0; } else k--;
  }
}

/** the bytes a cell stands for (a bitmap frame: 8000, or its window's from the first to the last, not the 8 KB step; a
 *  screen: 1000, not the 1 KB step) */
export const cellBytes = (L: GfxLayout) => (L.kind === 'bitmap' ? (s => s.to - s.from)(windowSpan(winOf(L))) : L.kind === 'screens' ? SCREEN_BYTES : L.unit);
/** where those bytes start in the cell: a bitmap at its window's first byte, the others at the cell's */
export const cellFrom = (L: GfxLayout) => (L.kind === 'bitmap' ? windowSpan(winOf(L)).from : 0);

/** whole cells from the cell holding `a` to the one holding `b` (either order), as [start, end): a bitmap from the
 *  first byte of the first one's window to the last byte of the last one's */
export function cellRange(L: GfxLayout, a: Addr, b: Addr): { start: Addr; end: Addr } | null {
  const x = cellOf(L, Math.min(a, b)), y = cellOf(L, Math.max(a, b));
  if (!x || !y) return null;
  const f = cellFrom(L);
  return { start: x.start + f, end: Math.min(L.size, y.start + f + cellBytes(L)) };
}

/** the rectangles a range covers, one per row (cells are drawn row by row) */
export function rangeRects(L: GfxLayout, start: Addr, end: Addr): { x: number; y: number; w: number; h: number }[] {
  const out: { x: number; y: number; w: number; h: number }[] = [];
  // a font per row: every row whose font the range touches
  if (L.rowStarts) return L.rowStarts.flatMap((s, r) => (s < end && s + L.unit > start ? [{ x: 0, y: r * L.cellH, w: L.cellW, h: L.cellH }] : []));
  const a = cellOf(L, L.parts ? start : Math.max(start, L.offset)), b = cellOf(L, Math.min(end, L.size, rowAddr(L, L.rows)) - 1);
  if (!a || !b || end <= start) return out;
  const stepX = L.cellW + L.gapX, stepY = L.cellH + L.gapY;
  for (let y = a.y; y <= b.y; y += stepY) {
    const x0 = y === a.y ? a.x : 0, x1 = y === b.y ? b.x + L.cellW : (L.cols - 1) * stepX + L.cellW;
    out.push({ x: x0, y, w: x1 - x0, h: L.cellH });
  }
  return out;
}

/** the 2 KB charset (VIC alignment) around `a` (in its cartridge bank) */
export const charsetAround = (a: Addr) => ({ start: a - (a & 0x7ff), end: a - (a & 0x7ff) + 0x800 });
/** the 8 KB-aligned bitmap around `a` (8000 bytes) */
export const bitmapAround = (a: Addr) => ({ start: a - (a & 0x1fff), end: a - (a & 0x1fff) + BITMAP_BYTES });
/** what the VIC calls the sprite at `a`: its pointer value (in its 16 KB VIC bank) and that VIC bank */
export const spritePointer = (a: Addr) => ({ pointer: (a & 0x3fff) >> 6, bank: (a & 0xffff) >> 14 });
/** what the VIC calls the screen at `a` (1 KB aligned): the high nibble of $d018 and the VIC bank; null when not aligned */
export const screenPointer = (a: Addr) => ((a & 0x3ff) === 0 ? { d018: (a & 0x3fff) >> 10, bank: (a & 0xffff) >> 14 } : null);

/** screen code order of the built-in letters: @, A-Z, then space to ? (the graphics are left empty) */
const SCREEN_ORDER = '@ABCDEFGHIJKLMNOPQRSTUVWXYZ[£]↑← !"#$%&\'()*+,-./0123456789:;<=>?';

/**
 * A 2 KB charset to draw screens with when VICE's character ROM is not found: the demo font's letters, digits and
 * punctuation at their screen codes, codes 128-255 reversed.
 */
export function builtinFont(): Uint8Array {
  const f = new Uint8Array(0x800);
  [...SCREEN_ORDER].forEach((c, code) => { const g = DEMO_FONT[c]; if (g) for (let y = 0; y < 8; y++) f[code * 8 + y] = parseInt(g.slice(y * 2, y * 2 + 2), 16); });
  for (let i = 0; i < 0x400; i++) f[0x400 + i] = f[i] ^ 0xff;
  return f;
}

export interface GfxColors { bg: number; fg: number; mc1: number; mc2: number }

/** Colours of their own for some cells (a VICE snapshot's shown screen and bitmap, lib/vicgfx.ts): for cell `i`
 *  (0-999) of the bitmap or screen at `base`, the colours of the bit pairs 00, 01, 10, 11 (hires 0 and 1 as 00 and 11)
 *  and whether it is drawn multicolour; null: the view's colours */
export type CellColors = (kind: GfxKind, base: Addr, i: number) => { pal: readonly number[]; mc: boolean } | null;

/** how `drawMemory` draws a byte: not loaded, loaded, or in a block already marked as graphics */
export type Shade = 0 | 1 | 2;
export const NOT_LOADED: Shade = 0, LOADED: Shade = 1, MARKED: Shade = 2;
/** the graphics colour (`--g-gfx`, orange in both themes) that bytes already marked as graphics are tinted with */
export const MARKED_TINT: readonly [number, number, number] = [235, 104, 52];
/** a colour tinted as bytes already marked as graphics are: 45 % of the way to `MARKED_TINT`, so a black background
 *  turns a dark orange and white a light one, and each colour still differs from the others */
export const markedRgb = ([r, g, b]: readonly number[]): number[] => [r * 0.55 + MARKED_TINT[0] * 0.45, g * 0.55 + MARKED_TINT[1] * 0.45, b * 0.55 + MARKED_TINT[2] * 0.45];

/**
 * Draw the rows `from` to `to` of layout `L` (all of them by default) into RGBA `px` (L.width x their height): hires,
 * or multicolor (pairs of bits: bg, mc1, mc2, fg). Screens draw each screen code with `font` (2 KB). `shade` says how
 * each byte is drawn: bytes that are not loaded (false, `NOT_LOADED`) dark, so the program stands out, loaded ones (true,
 * `LOADED`) in the colours, and those in a block already marked as graphics (`MARKED`) tinted with the graphics colour,
 * so what is left to find stands out from what is known; gaps get `gap`. `cells` gives some screen and bitmap cells
 * colours of their own (a snapshot's, CellColors).
 */
export function drawMemory(px: Uint8ClampedArray, L: GfxLayout, mem: Uint8Array, shade: (a: Addr) => boolean | Shade, mc: boolean, colors: GfxColors, font?: Uint8Array, gap: [number, number, number] = [24, 24, 32], from = 0, to = L.rows, cells?: CellColors): void {
  // the colours as each shade draws them: not loaded a blue-grey of its own, so it differs from loaded bytes in any
  // colours (a black background too); marked tinted
  const rgb = C64.map(hexRgb), shaded = [rgb.map(([r, g, b]) => [r * 0.25 + 34, g * 0.25 + 34, b * 0.25 + 52]), rgb, rgb.map(c => markedRgb(c))];
  const palsOf = (p: readonly number[]) => shaded.map(s => p.map(i => s[i & 15]));
  const pals = palsOf([colors.bg, colors.mc1, colors.mc2, colors.fg]);
  const palOf = (a: Addr, own = pals) => own[Number(shade(a))] ?? own[1];
  for (let i = 0; i < px.length; i += 4) { px[i] = gap[0]; px[i + 1] = gap[1]; px[i + 2] = gap[2]; px[i + 3] = 255; }
  const put = (x: number, y: number, c: number[]) => { const o = (y * L.width + x) * 4; px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; };
  const bits = (b: number, p: number[][], x: number, y: number, m = mc) => {
    if (m) for (let k = 0; k < 4; k++) { const c = p[(b >> (6 - k * 2)) & 3]; put(x + k * 2, y, c); put(x + k * 2 + 1, y, c); }
    else for (let k = 0; k < 8; k++) put(x + k, y, (b >> (7 - k)) & 1 ? p[3] : p[0]);
  };
  const byte = (a: Addr, x: number, y: number) => { if (a < mem.length) bits(mem[a], palOf(a), x, y); };
  const f = L.kind === 'screens' ? font ?? builtinFont() : null;
  const stepX = L.cellW + L.gapX, stepY = L.cellH + L.gapY;
  for (let r = Math.max(0, from); r < Math.min(to, L.rows); r++) for (let c = 0; c < L.cols; c++) {
    const base = rowAddr(L, r) + c * L.unit, ox = c * stepX, oy = (r - from) * stepY;
    if (base >= rowEnd(L, r)) continue;
    if (L.kind === 'chars') for (let y = 0; y < 8; y++) byte(base + y, ox, oy + y);
    else if (L.kind === 'sprites') for (let y = 0; y < 21; y++) for (let k = 0; k < 3; k++) byte(base + y * 3 + k, ox + k * 8, oy + y);
    else if (L.kind === 'fontrows') for (let x = 0; x < 40; x++) for (let y = 0; y < 8; y++) byte(base + L.codes![x] * 8 + y, x * 8, oy + y);
    else if (f) for (let i = 0; i < SCREEN_BYTES && base + i < mem.length; i++) {
      const own = cells?.('screens', base, i), p = palOf(base + i, own ? palsOf(own.pal) : pals), g = mem[base + i] * 8, x = ox + (i % 40) * 8, y0 = oy + Math.floor(i / 40) * 8;
      for (let y = 0; y < 8; y++) bits(f[g + y], p, x, y0 + y, own ? own.mc : mc);
    }
    // a bitmap: its window's cells, each where it is in the bitmap
    else { const w = winOf(L); for (let cy = 0; cy < w.rows; cy++) for (let cx = 0; cx < w.cols; cx++) {
      const i = (w.top + cy) * BITMAP_COLS + w.left + cx, own = cells?.('bitmap', base, i), ps = own ? palsOf(own.pal) : pals;
      for (let y = 0; y < 8; y++) { const a = base + i * 8 + y; if (a < mem.length) bits(mem[a], palOf(a, ps), ox + cx * 8, oy + cy * 8 + y, own ? own.mc : mc); }
    } }
  }
}

/**
 * The selection as an image at 1x, drawn as the tab draws it but without the gaps: characters 16 to a row, sprites 8 (or
 * `per`), a
 * bitmap as 320 x 200 or its window (`bitmap`, BitmapWindow or a number of rows; one per 8 KB, under each other, `start`
 * the first byte of the first one's window), a screen as 320 x 200 (multicolour pixels two
 * wide; screens drawn with `font`, one per 1 KB), the fonts of a font-per-row picture as its rows (each 320 x 8, with the
 * 40 `codes`). Cells past the end of the selection stay transparent; `cells` gives some colours of their own (CellColors).
 */
export function gfxImage(kind: GfxKind, mem: Uint8Array, start: Addr, end: Addr, mc: boolean, colors: GfxColors, opts: { font?: Uint8Array; codes?: ArrayLike<number>; rows?: Addr[]; bitmap?: number | BitmapWindow; per?: number; cells?: CellColors } = {}): { width: number; height: number; rgba: Uint8ClampedArray<ArrayBuffer> } {
  const rgb = C64.map(hexRgb), pal = [colors.bg, colors.mc1, colors.mc2, colors.fg].map(i => rgb[i & 15]);
  const win = bitmapWindowOf(opts.bitmap), from = kind === 'bitmap' ? windowSpan(win).from : 0;
  const g = kind === 'chars' ? { unit: 8, w: 8, h: 8, per: 16 } : kind === 'sprites' ? { unit: 64, w: 24, h: 21, per: 8 }
    : kind === 'screens' ? { unit: 0x400, w: 320, h: 200, per: 1 } : kind === 'fontrows' ? { unit: 0x800, w: 320, h: 8, per: 1 }
      : { unit: 0x2000, w: win.cols * 8, h: win.rows * 8, per: 1 };
  // a font per row: the rows whose font lies in the selection (memory the picture skips is no row)
  const bases = kind === 'fontrows' && opts.rows ? opts.rows.filter(a => a >= start && a < end) : null;
  // (`per`: characters or sprites a row, instead of 16 and 8)
  const per = opts.per != null && opts.per >= 1 && (kind === 'chars' || kind === 'sprites') ? Math.floor(opts.per) : g.per;
  const n = bases ? Math.max(1, bases.length) : Math.max(1, Math.ceil((end - start) / g.unit)), cols = Math.min(per, n), rows = Math.ceil(n / cols);
  const width = cols * g.w, height = rows * g.h, rgba = new Uint8ClampedArray(width * height * 4);
  const put = (x: number, y: number, c: number[]) => { const o = (y * width + x) * 4; rgba[o] = c[0]; rgba[o + 1] = c[1]; rgba[o + 2] = c[2]; rgba[o + 3] = 255; };
  const bits = (b: number, x: number, y: number, p: number[][] = pal, m = mc) => {
    if (m) for (let k = 0; k < 4; k++) { const c = p[(b >> (6 - k * 2)) & 3]; put(x + k * 2, y, c); put(x + k * 2 + 1, y, c); }
    else for (let k = 0; k < 8; k++) put(x + k, y, (b >> (7 - k)) & 1 ? p[3] : p[0]);
  };
  const byte = (a: Addr, x: number, y: number, p?: number[][], m?: boolean) => { if (a < end && a < mem.length) bits(mem[a], x, y, p, m); };
  /** a cell's own colours (CellColors), or the view's */
  const own = (k: GfxKind, base: Addr, i: number) => { const o = opts.cells?.(k, base, i); return o ? { p: o.pal.map(c => rgb[c & 15]), m: o.mc } : { p: pal, m: mc }; };
  const f = kind === 'screens' ? opts.font ?? builtinFont() : null;
  for (let i = 0; i < n; i++) {
    const base = bases ? bases[i] ?? start : start + i * g.unit, ox = (i % cols) * g.w, oy = Math.floor(i / cols) * g.h;
    if (kind === 'chars') for (let y = 0; y < 8; y++) byte(base + y, ox, oy + y);
    else if (kind === 'sprites') for (let y = 0; y < 21; y++) for (let k = 0; k < 3; k++) byte(base + y * 3 + k, ox + k * 8, oy + y);
    else if (kind === 'fontrows') for (let x = 0; x < 40; x++) for (let y = 0; y < 8; y++) byte(base + (opts.codes?.[x] ?? x) * 8 + y, x * 8, oy + y);
    else if (f) for (let j = 0; j < SCREEN_BYTES && base + j < end && base + j < mem.length; j++) {
      const code = mem[base + j], o = own('screens', base, j);
      for (let y = 0; y < 8; y++) bits(f[code * 8 + y], ox + (j % 40) * 8, oy + Math.floor(j / 40) * 8 + y, o.p, o.m);
    }
    // a bitmap: the window's cells (`base` is its first byte), each where it is in the bitmap
    else for (let cy = 0; cy < win.rows; cy++) for (let cx = 0; cx < win.cols; cx++) {
      const frame = base - from, j = (win.top + cy) * BITMAP_COLS + win.left + cx, o = own('bitmap', frame, j);
      for (let y = 0; y < 8; y++) byte(frame + j * 8 + y, ox + cx * 8, oy + cy * 8 + y, o.p, o.m);
    }
  }
  return { width, height, rgba };
}

/** A picture (a bitmap with its screen matrix and colour RAM) as an image of 320 x 200, each cell in its own colours:
 *  multicolour %00 the background, %01 and %10 the screen code's high and low nibble, %11 colour RAM; hires set bits the
 *  high nibble, clear bits the low one. */
export function pictureImage(p: C64Picture): { width: number; height: number; rgba: Uint8ClampedArray<ArrayBuffer> } {
  const width = 320, height = 200, rgba = new Uint8ClampedArray(width * height * 4);
  const rgb = C64.map(hexRgb);
  for (let cell = 0; cell < 1000; cell++) {
    const s = p.screen[cell], pal = p.mc ? [p.bg, s >> 4, s & 15, p.color[cell]] : [s & 15, 0, 0, s >> 4];
    const x0 = (cell % 40) * 8, y0 = Math.floor(cell / 40) * 8;
    for (let y = 0; y < 8; y++) {
      const b = p.bitmap[cell * 8 + y];
      for (let x = 0; x < 8; x++) {
        const v = p.mc ? (b >> (6 - (x & 6))) & 3 : (b >> (7 - x)) & 1 ? 3 : 0;
        const c = rgb[pal[v] & 15], o = ((y0 + y) * width + x0 + x) * 4;
        rgba[o] = c[0]; rgba[o + 1] = c[1]; rgba[o + 2] = c[2]; rgba[o + 3] = 255;
      }
    }
  }
  return { width, height, rgba };
}
