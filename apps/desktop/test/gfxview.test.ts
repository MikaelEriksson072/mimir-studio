/* The memory graphics browser's geometry and drawing (src/lib/gfxview.ts). */
import { describe, expect, it } from 'vitest';
import { pixelAt, bitmapAround, bitmapRowsOf, bitmapWindowOf, cellFrom, isWholeBitmap, windowBitmap, windowPieces, windowSpan, WHOLE_BITMAP, builtinFont, byteAt, cellAt, cellBytes, cellLayout, cellOf, cellRange, charsetAround, drawMemory, fontRowsLayout, LOADED, MARKED, markedRgb, NOT_LOADED, fontRowStarts, gfxImage, noFont, gfxLayout, rangeRects, rowAddr, screenPointer, spriteColsOf, spritePointer, stepCell } from '../src/lib/gfxview';
import { C64, hexRgb } from '../src/lib/palette';

describe('memory graphics layout', () => {
  it('lays all 64 KB out as characters, sprites or 8 KB bitmaps', () => {
    expect(gfxLayout('chars', 32)).toMatchObject({ unit: 8, rows: 256, width: 256, height: 2048 });
    expect(gfxLayout('sprites', 8)).toMatchObject({ unit: 64, rows: 128, width: 8 * 26, height: 128 * 23 });
    expect(gfxLayout('bitmap', 1)).toMatchObject({ unit: 0x2000, cols: 1, rows: 8, width: 320, height: 8 * 208 });
    // the offset moves the grid by bytes, within one cell
    expect(gfxLayout('chars', 32, 3)).toMatchObject({ offset: 3, rows: 256 });
    expect(gfxLayout('chars', 32, -1).offset).toBe(7);
    expect(rowAddr(gfxLayout('chars', 32, 3), 2)).toBe(3 + 512);
  });

  it('lays sprites out 1 to 24 a row; a saved count outside that is 8', () => {
    expect(gfxLayout('sprites', 1)).toMatchObject({ rows: 1024, width: 26 });
    // 1024 sprites, 24 a row: 43 rows, the last of 16
    const L = gfxLayout('sprites', 24);
    expect(L).toMatchObject({ rows: 43, width: 24 * 26 });
    expect(rowAddr(L, 42)).toBe(42 * 24 * 64);
    expect(cellOf(L, 0xffc0)).toMatchObject({ start: 0xffc0, x: 15 * 26, y: 42 * 23 });
    expect([1, 5, 24].map(spriteColsOf)).toEqual([1, 5, 24]);
    expect([0, 25, 2.5, -3, NaN, '10', undefined, null].map(spriteColsOf)).toEqual([8, 8, 8, 8, 8, 8, 8, 8]);
  });

  it('finds the cell and the byte under a point, and back', () => {
    const L = gfxLayout('chars', 32);
    expect(cellAt(L, 0, 0)).toBe(0);
    expect(cellAt(L, 8 * 5 + 3, 8 * 2 + 7)).toBe(2 * 256 + 5 * 8);
    expect(byteAt(L, 8 * 5 + 3, 8 * 2 + 7)).toBe(2 * 256 + 5 * 8 + 7);
    expect(cellOf(L, 0x3008)).toEqual({ start: 0x3008, x: 8, y: 0x30 * 8, w: 8, h: 8 });
    const S = gfxLayout('sprites', 8);
    // a sprite's byte: three per line
    expect(byteAt(S, 26 + 17, 4)).toBe(64 + 4 * 3 + 2);
    // the gap between sprites is no cell
    expect(cellAt(S, 25, 0)).toBeNull();
    const B = gfxLayout('bitmap', 1);
    expect(cellAt(B, 10, 208 + 5)).toBe(0x2000);
    expect(byteAt(B, 8 * 3 + 1, 208 + 8 * 2 + 5)).toBe(0x2000 + (2 * 40 + 3) * 8 + 5);
    expect(cellAt(B, 10, 205)).toBeNull();
  });

  it('selects whole cells, either way round, and gives the rectangles per row', () => {
    const L = gfxLayout('chars', 32);
    expect(cellRange(L, 0x3013, 0x3001)).toEqual({ start: 0x3000, end: 0x3018 });
    expect(cellRange(gfxLayout('sprites', 8), 0x2005, 0x2005)).toEqual({ start: 0x2000, end: 0x2040 });
    expect(cellRange(gfxLayout('bitmap', 1), 0x2100, 0x2100)).toEqual({ start: 0x2000, end: 0x2000 + 8000 });
    // $30f0-$3110: the last two characters of one row, then three of the next
    expect(rangeRects(L, 0x30f0, 0x3118)).toEqual([{ x: 30 * 8, y: 0x30 * 8, w: 16, h: 8 }, { x: 0, y: 0x31 * 8, w: 24, h: 8 }]);
    expect(rangeRects(L, 0x3000, 0x3800)).toHaveLength(8);
  });

  it('knows charsets, bitmaps and sprite pointers the way the VIC sees them', () => {
    expect(charsetAround(0x3456)).toEqual({ start: 0x3000, end: 0x3800 });
    expect(bitmapAround(0x5123)).toEqual({ start: 0x4000, end: 0x4000 + 8000 });
    expect(spritePointer(0x2000)).toEqual({ pointer: 0x80, bank: 0 });
    expect(spritePointer(0x7fc0)).toEqual({ pointer: 0xff, bank: 1 });
    // in a cartridge's bank 1 (bank addresses, 13.9b): the same, in that bank
    expect(charsetAround(0x18456)).toEqual({ start: 0x18000, end: 0x18800 });
    expect(spritePointer(0x1a000)).toEqual({ pointer: 0x80, bank: 2 });
  });

  it('lays every bank out at once: their parts one after the other, nothing between them', () => {
    // two 8 KB banks at $8000: bank 0's and bank 1's ($18000) rows, 40 characters (320 bytes) a row
    const L = gfxLayout('chars', 40, 0, [{ start: 0x8000, end: 0xa000 }, { start: 0x18000, end: 0x1a000 }]);
    const perBank = Math.ceil(0x2000 / 320);
    expect(L).toMatchObject({ rows: 2 * perBank, size: 0x1a000, height: 2 * perBank * 8 });
    expect(rowAddr(L, 0)).toBe(0x8000);
    expect(rowAddr(L, perBank)).toBe(0x18000);
    expect(rowAddr(L, L.rows)).toBe(0x1a000);
    // the last row of bank 0 is short: no cell after $9fff
    expect(cellAt(L, 8 * 39, (perBank - 1) * 8)).toBeNull();
    expect(cellAt(L, 0, perBank * 8)).toBe(0x18000);
    expect(cellOf(L, 0x18008)).toEqual({ start: 0x18008, x: 8, y: perBank * 8, w: 8, h: 8 });
    // memory between the parts is not laid out
    expect(cellOf(L, 0xc000)).toBeNull();
    expect(cellOf(L, 0x10000)).toBeNull();
    // a band of rows: bank 1's first row drawn at the top of the band
    const mem = new Uint8Array(0x1a000); mem[0x18000] = 0xff;
    const px = new Uint8ClampedArray(L.width * 8 * 4);
    drawMemory(px, L, mem, () => true, false, { bg: 0, fg: 1, mc1: 2, mc2: 3 }, undefined, undefined, perBank, perBank + 1);
    expect([...px.subarray(0, 3)]).toEqual([255, 255, 255]);
  });
});

describe('memory graphics drawing', () => {
  it('tints bytes already marked as graphics orange, so they differ from loaded and not loaded ones in any colours', () => {
    const L = gfxLayout('chars', 3), mem = new Uint8Array(0x10000);
    mem[0] = mem[8] = mem[16] = 0b10000000;
    const px = new Uint8ClampedArray(L.width * L.height * 4);
    // char 0 loaded, char 1 marked as graphics, char 2 not loaded
    drawMemory(px, L, mem, a => (a < 8 ? LOADED : a < 16 ? MARKED : NOT_LOADED), false, { bg: 0, fg: 1, mc1: 15, mc2: 12 });
    const at = (x: number, y: number) => [...px.subarray((y * L.width + x) * 4, (y * L.width + x) * 4 + 3)];
    const step = L.cellW + L.gapX;
    expect(at(0, 0)).toEqual([255, 255, 255]);
    expect(at(1, 0)).toEqual([0, 0, 0]);
    // marked: white and black 45 % of the way to the graphics orange
    expect(at(step, 0)).toEqual(markedRgb([255, 255, 255]).map(Math.round));
    expect(at(step + 1, 0)).toEqual(markedRgb([0, 0, 0]).map(Math.round));
    expect(at(step + 1, 0)[0]).toBeGreaterThan(at(step + 1, 0)[2] + 50);
    // and not the blue-grey of bytes that are not loaded
    expect(at(step * 2 + 1, 0)).not.toEqual(at(step + 1, 0));
    // booleans still say loaded or not
    drawMemory(px, L, mem, a => a < 16, false, { bg: 0, fg: 1, mc1: 15, mc2: 12 });
    expect(at(step + 1, 0)).toEqual([0, 0, 0]);
  });
  it('draws set bits in the foreground, and bytes that are not loaded in a colour of their own', () => {
    const L = gfxLayout('chars', 1), mem = new Uint8Array(0x10000);
    mem[0] = 0b10000001;
    const px = new Uint8ClampedArray(L.width * L.height * 4);
    drawMemory(px, L, mem, a => a < 8, false, { bg: 0, fg: 1, mc1: 15, mc2: 12 });
    const at = (x: number, y: number) => [...px.subarray((y * L.width + x) * 4, (y * L.width + x) * 4 + 3)];
    expect([at(0, 0), at(1, 0), at(7, 0)]).toEqual([[255, 255, 255], [0, 0, 0], [255, 255, 255]]);
    // the next character is not loaded: not black although its bytes are 0
    expect(at(0, 8)).not.toEqual([0, 0, 0]);
    // multicolor: bit pairs, two pixels wide (%10 is mc2, grey $0c)
    mem[0] = 0b10000000;
    drawMemory(px, L, mem, () => true, true, { bg: 0, fg: 1, mc1: 15, mc2: 12 });
    expect([at(0, 0), at(1, 0), at(2, 0)]).toEqual([[0x6c, 0x6c, 0x6c], [0x6c, 0x6c, 0x6c], [0, 0, 0]]);
  });
});

describe('the image of a selection (Save → .png)', () => {
  const colors = { bg: 0, fg: 1, mc1: 2, mc2: 5 };
  const rgb = (img: { width: number; rgba: Uint8ClampedArray }, x: number, y: number) => { const o = (y * img.width + x) * 4; return [img.rgba[o], img.rgba[o + 1], img.rgba[o + 2], img.rgba[o + 3]]; };
  const of = (i: number) => [...hexRgb(C64[i]), 255];
  const mem = new Uint8Array(0x10000);
  mem[0x3000] = 0b10000001; mem[0x3008] = 0xff;
  mem[0x2000] = 0b01_10_11_00;

  it('draws characters 16 to a row without gaps, the rest transparent', () => {
    const img = gfxImage('chars', mem, 0x3000, 0x3010, false, colors);
    expect([img.width, img.height]).toEqual([16, 8]);
    expect(rgb(img, 0, 0)).toEqual(of(1));
    expect(rgb(img, 1, 0)).toEqual(of(0));
    expect(rgb(img, 7, 0)).toEqual(of(1));
    expect(rgb(img, 8, 0)).toEqual(of(1));
    const many = gfxImage('chars', mem, 0x3000, 0x3000 + 17 * 8, false, colors);
    expect([many.width, many.height]).toEqual([128, 16]);
    expect(rgb(many, 127, 15)[3]).toBe(0);
  });

  it('draws sprites 8 to a row and bitmaps as 320 x 200, multicolour pixels two wide', () => {
    const img = gfxImage('sprites', mem, 0x2000, 0x2080, true, colors);
    expect([img.width, img.height]).toEqual([48, 21]);
    expect([0, 2, 4, 6].map(x => rgb(img, x, 0))).toEqual([of(2), of(5), of(1), of(0)]);
    expect(rgb(img, 1, 0)).toEqual(of(2));
    const bm = gfxImage('bitmap', mem, 0x2000, 0x2000 + 8000, true, colors);
    expect([bm.width, bm.height]).toEqual([320, 200]);
    expect(rgb(bm, 0, 0)).toEqual(of(2));
  });
});

describe('bitmaps of fewer rows (Height)', () => {
  const colors = { bg: 0, fg: 1, mc1: 2, mc2: 5 };
  const white = [...hexRgb(C64[1]), 255], black = [...hexRgb(C64[0]), 255];
  const rgb = (img: { width: number; rgba: Uint8ClampedArray }, x: number, y: number) => { const o = (y * img.width + x) * 4; return [img.rgba[o], img.rgba[o + 1], img.rgba[o + 2], img.rgba[o + 3]]; };

  it('draws the first rows of each 8 KB, and a cell is those rows: 320 bytes each', () => {
    const B = gfxLayout('bitmap', 1, 0, undefined, 10);
    // still one per 8 KB, each 80 pixels high and 8 apart
    expect(B).toMatchObject({ unit: 0x2000, rows: 8, cellH: 80, height: 8 * 88 });
    expect(cellBytes(B)).toBe(3200);
    expect(cellBytes(gfxLayout('bitmap', 1))).toBe(8000);
    // the second frame starts 88 pixels down; below its tenth row is the gap
    expect(cellAt(B, 10, 88 + 79)).toBe(0x2000);
    expect(cellAt(B, 10, 88 + 80)).toBeNull();
    expect(byteAt(B, 8 * 3 + 1, 88 + 8 * 9 + 5)).toBe(0x2000 + (9 * 40 + 3) * 8 + 5);
    expect(cellOf(B, 0x2100)).toEqual({ start: 0x2000, x: 0, y: 88, w: 320, h: 80 });
    // a click selects the rows drawn, a drag the frames from one to the other
    expect(cellRange(B, 0x2100, 0x2100)).toEqual({ start: 0x2000, end: 0x2000 + 3200 });
    expect(cellRange(B, 0x2100, 0x4100)).toEqual({ start: 0x2000, end: 0x4000 + 3200 });
    expect(rangeRects(B, 0x2000, 0x2000 + 3200)).toEqual([{ x: 0, y: 88, w: 320, h: 80 }]);
    // the offset still moves the grid by bytes
    expect(cellRange(gfxLayout('bitmap', 1, 0x280, undefined, 4), 0x2300, 0x2300)).toEqual({ start: 0x2280, end: 0x2280 + 1280 });
  });

  it('takes 1 to 25 rows, anything else (a saved setting gone wrong) is a whole bitmap', () => {
    expect([1, 12, 25].map(bitmapRowsOf)).toEqual([1, 12, 25]);
    expect([0, 26, 2.5, -3, NaN, '10', undefined, null].map(bitmapRowsOf)).toEqual([25, 25, 25, 25, 25, 25, 25, 25]);
    expect(gfxLayout('bitmap', 1, 0, undefined, 40).cellH).toBe(200);
  });

  it('draws no more than the rows, and saves them as an image of that height, one per 8 KB', () => {
    const mem = new Uint8Array(0x10000);
    // row 2 and row 3 of the bitmap at $2000: their first byte's top line
    mem[0x2000 + 2 * 320] = 0xff; mem[0x2000 + 3 * 320] = 0xff; mem[0x4000] = 0x80;
    const B = gfxLayout('bitmap', 1, 0, undefined, 3), px = new Uint8ClampedArray(B.width * B.height * 4);
    drawMemory(px, B, mem, () => true, false, colors);
    const at = (x: number, y: number) => [...px.subarray((y * B.width + x) * 4, (y * B.width + x) * 4 + 4)];
    // frame 1 is 32 pixels down: its row 2 is drawn, its row 3 is the gap
    expect(at(0, 32 + 16)).toEqual(white);
    expect(at(0, 32 + 24)).toEqual([24, 24, 32, 255]);
    const img = gfxImage('bitmap', mem, 0x2000, 0x2000 + 960, false, colors, { bitmap: 3 });
    expect([img.width, img.height]).toEqual([320, 24]);
    expect(rgb(img, 0, 16)).toEqual(white);
    // two frames: the second is the next 8 KB, under the first
    const two = gfxImage('bitmap', mem, 0x2000, 0x4000 + 960, false, colors, { bitmap: 3 });
    expect([two.width, two.height]).toEqual([320, 48]);
    expect([rgb(two, 0, 24), rgb(two, 1, 24)]).toEqual([white, black]);
    // two whole bitmaps: the second starts at the next 8 KB, not 8000 bytes on
    const whole = gfxImage('bitmap', mem, 0x2000, 0x4000 + 8000, false, colors);
    expect([whole.height, ...rgb(whole, 0, 200)]).toEqual([400, ...white]);
  });
});

describe('a part of each bitmap (Rows and Columns)', () => {
  const colors = { bg: 0, fg: 1, mc1: 2, mc2: 5 };
  const white = [...hexRgb(C64[1]), 255], black = [...hexRgb(C64[0]), 255];
  const rgb = (img: { width: number; rgba: Uint8ClampedArray }, x: number, y: number) => { const o = (y * img.width + x) * 4; return [img.rgba[o], img.rgba[o + 1], img.rgba[o + 2], img.rgba[o + 3]]; };
  // rows 8-15 and columns 10-29: a logo in the middle of the screen
  const w = { top: 8, rows: 8, left: 10, cols: 20 };

  it('fits a saved part in the bitmap: a first row or column outside it is 0, too many is the rest from there', () => {
    expect(bitmapWindowOf(w)).toEqual(w);
    expect(bitmapWindowOf({ top: 24, rows: 1, left: 39, cols: 1 })).toEqual({ top: 24, rows: 1, left: 39, cols: 1 });
    expect(bitmapWindowOf({ top: 20, rows: 10, left: 30, cols: 20 })).toEqual({ top: 20, rows: 5, left: 30, cols: 10 });
    expect(bitmapWindowOf({ top: 25, rows: 0, left: -1, cols: 2.5 })).toEqual({ ...WHOLE_BITMAP });
    expect(bitmapWindowOf({ top: '3' as unknown as number, rows: 10 })).toEqual({ top: 0, rows: 10, left: 0, cols: 40 });
    // a number of rows (the Height before) is those rows from the top, the whole width
    expect(bitmapWindowOf(10)).toEqual({ top: 0, rows: 10, left: 0, cols: 40 });
    expect([undefined, null, 30].map(x => isWholeBitmap(bitmapWindowOf(x)))).toEqual([true, true, true]);
    expect(isWholeBitmap(w)).toBe(false);
  });

  it('draws the part of each 8 KB, and a click selects its bytes from the first to the last', () => {
    const B = gfxLayout('bitmap', 1, 0, undefined, w);
    // 160 x 64 pixels, still one per 8 KB, 8 apart
    expect(B).toMatchObject({ unit: 0x2000, rows: 8, cellW: 160, cellH: 64, width: 160, height: 8 * 72, win: w });
    expect(windowSpan(w)).toEqual({ from: 8 * 320 + 80, to: 15 * 320 + 30 * 8 });
    expect([cellFrom(B), cellBytes(B)]).toEqual([2640, 4800 + 240 - 2640]);
    // the second frame ($2000) starts 72 pixels down; right of its 20 columns is no bitmap
    expect(cellAt(B, 159, 72 + 5)).toBe(0x2000);
    expect(cellAt(B, 160, 72 + 5)).toBeNull();
    // the pixel at the part's top left is row 8, column 10 of the bitmap
    expect(byteAt(B, 0, 72)).toBe(0x2000 + (8 * 40 + 10) * 8);
    expect(byteAt(B, 8 * 3 + 1, 72 + 8 * 2 + 5)).toBe(0x2000 + (10 * 40 + 13) * 8 + 5);
    expect(cellRange(B, 0x2000, 0x2000)).toEqual({ start: 0x2000 + 2640, end: 0x2000 + 15 * 320 + 240 });
    expect(cellRange(B, 0x2000, 0x4000)).toEqual({ start: 0x2000 + 2640, end: 0x4000 + 15 * 320 + 240 });
    // the selection is drawn over the whole cell
    expect(rangeRects(B, 0x2000 + 2640, 0x2000 + 15 * 320 + 240)).toEqual([{ x: 0, y: 72, w: 160, h: 64 }]);
    // a layout of one cell keeps the part
    expect(cellLayout(B, 0x2000).win).toEqual(w);
  });

  it('draws only the part, each cell where it is in the bitmap, and saves it as an image of that size', () => {
    const mem = new Uint8Array(0x10000);
    // row 8, column 10 (the part's top left) and row 8, column 9 (beside it): their top line
    mem[0x2000 + (8 * 40 + 10) * 8] = 0x80; mem[0x2000 + (8 * 40 + 9) * 8] = 0xff;
    const B = gfxLayout('bitmap', 1, 0, undefined, w), px = new Uint8ClampedArray(B.width * B.height * 4);
    drawMemory(px, B, mem, () => true, false, colors);
    const at = (x: number, y: number) => [...px.subarray((y * B.width + x) * 4, (y * B.width + x) * 4 + 4)];
    expect([at(0, 72), at(1, 72)]).toEqual([white, black]);
    const img = gfxImage('bitmap', mem, 0x2000 + windowSpan(w).from, 0x2000 + windowSpan(w).to, false, colors, { bitmap: w });
    expect([img.width, img.height]).toEqual([160, 64]);
    expect([rgb(img, 0, 0), rgb(img, 1, 0)]).toEqual([white, black]);
  });

  it('gives each cell of a snapshot its own colours by its place in the bitmap', () => {
    const mem = new Uint8Array(0x10000).fill(0xff, 0x2000, 0x4000), seen: number[] = [];
    const B = gfxLayout('bitmap', 1, 0, undefined, { top: 24, rows: 1, left: 38, cols: 2 });
    drawMemory(new Uint8ClampedArray(B.width * B.height * 4), B, mem, () => true, false, colors, undefined, undefined, 1, 2, (k, base, i) => { seen.push(base, i); return null; });
    expect(seen).toEqual([0x2000, 998, 0x2000, 999]);
  });

  it('marks the bytes drawn: a stretch per row, one for all rows when as wide as the bitmap; a picture of only them', () => {
    expect(windowPieces(0x2000, { top: 1, rows: 2, left: 4, cols: 2 })).toEqual([{ start: 0x2000 + 320 + 32, end: 0x2000 + 320 + 48 }, { start: 0x2000 + 640 + 32, end: 0x2000 + 640 + 48 }]);
    expect(windowPieces(0x2000, { top: 1, rows: 2, left: 0, cols: 40 })).toEqual([{ start: 0x2000 + 320, end: 0x2000 + 960 }]);
    // cut to a selection that starts in the second row's stretch
    expect(windowPieces(0x2000, { top: 1, rows: 2, left: 4, cols: 2 }, { start: 0x2000 + 640 + 40, end: 0x3000 })).toEqual([{ start: 0x2000 + 640 + 40, end: 0x2000 + 640 + 48 }]);
    const mem = new Uint8Array(0x10000).fill(7, 0x2000, 0x4000), pic = windowBitmap(mem, 0x2000, { top: 1, rows: 2, left: 4, cols: 2 });
    expect(pic.length).toBe(8000);
    expect([pic[320 + 31], pic[320 + 32], pic[320 + 47], pic[320 + 48], pic[640 + 40]]).toEqual([0, 7, 7, 0, 7]);
  });
});

describe('screens', () => {
  const colors = { bg: 6, fg: 14, mc1: 2, mc2: 5 };
  const font = new Uint8Array(0x800);
  font[1 * 8] = 0b11000000; // code 1, its top row
  font[2 * 8 + 7] = 0xff; // code 2, its bottom row

  it('lays memory out as a screen per 1 KB, 40 x 25 screen codes of which a point is one', () => {
    const L = gfxLayout('screens', 2);
    expect(L).toMatchObject({ unit: 0x400, cols: 2, rows: 32, width: 2 * 328, height: 32 * 208 });
    expect(cellAt(L, 328 + 5, 208 + 5)).toBe(0x0c00);
    expect(byteAt(L, 8 * 3 + 1, 208 + 8 * 2 + 7)).toBe(0x0800 + 2 * 40 + 3);
    // the gap, and the rows below the 25th, are no screen
    expect(cellAt(L, 322, 0)).toBeNull();
    expect(cellRange(L, 0x0410, 0x0410)).toEqual({ start: 0x0400, end: 0x0400 + 1000 });
    expect(cellRange(gfxLayout('screens', 1, 0x345), 0x2345, 0x2345)).toEqual({ start: 0x2345, end: 0x2345 + 1000 });
    expect(screenPointer(0x0400)).toEqual({ d018: 1, bank: 0 });
    expect(screenPointer(0x6c00)).toEqual({ d018: 0xb, bank: 1 });
    expect(screenPointer(0x2345)).toBeNull();
  });

  it('draws each screen code with the charset, dark where nothing is loaded', () => {
    const L = gfxLayout('screens', 1), mem = new Uint8Array(0x10000);
    mem[0x0400] = 1; mem[0x0401] = 2; mem[0x0428] = 1;
    const px = new Uint8ClampedArray(L.width * L.height * 4);
    drawMemory(px, L, mem, a => a >= 0x0400 && a < 0x0800, false, colors, font);
    const at = (x: number, y: number) => [...px.subarray((y * L.width + x) * 4, (y * L.width + x) * 4 + 3)];
    const fg = hexRgb(C64[14]), bg = hexRgb(C64[6]), y0 = 208;
    expect([at(0, y0), at(1, y0), at(2, y0)]).toEqual([fg, fg, bg]);
    expect([at(8, y0 + 7), at(15, y0 + 7), at(8, y0)]).toEqual([fg, fg, bg]);
    // the next row of the screen starts 40 codes later
    expect(at(0, y0 + 8)).toEqual(fg);
    // the screen at $0000 is not loaded
    expect(at(2, 0)).not.toEqual(bg);
  });

  it('draws the built-in letters when there is no charset, and saves a screen as a 320 x 200 image', () => {
    const f = builtinFont();
    expect(f.length).toBe(0x800);
    // A is screen code 1, 0 is 48, and 129 is A reversed
    expect([...f.subarray(8, 16)]).toEqual([0x7c, 0xc6, 0xc6, 0xfe, 0xc6, 0xc6, 0xc6, 0x00]);
    expect(f[48 * 8]).toBe(0x7c);
    expect([...f.subarray(129 * 8, 129 * 8 + 2)]).toEqual([0x83, 0x39]);
    const mem = new Uint8Array(0x10000);
    mem[0x6000] = 2;
    const img = gfxImage('screens', mem, 0x6000, 0x6000 + 1000, false, colors, { font });
    expect([img.width, img.height]).toEqual([320, 200]);
    const px = (x: number, y: number) => [...img.rgba.subarray((y * 320 + x) * 4, (y * 320 + x) * 4 + 4)];
    expect([px(0, 7), px(0, 0)]).toEqual([[...hexRgb(C64[14]), 255], [...hexRgb(C64[6]), 255]]);
    // two screens of a 2 KB selection, one under the other
    expect(gfxImage('screens', mem, 0x6000, 0x6800, false, colors, { font }).height).toBe(400);
  });

  it('draws one screen by itself, without gaps (Ctrl over a screen shows it over the whole window)', () => {
    const L = gfxLayout('screens', 3), mem = new Uint8Array(0x10000);
    mem[0x0c00] = 1; mem[0x0c00 + 999] = 2;
    const G = cellLayout(L, 0x0c00);
    expect(G).toMatchObject({ kind: 'screens', cols: 1, rows: 1, width: 320, height: 200, gapX: 0, gapY: 0 });
    const px = new Uint8ClampedArray(G.width * G.height * 4);
    drawMemory(px, G, mem, () => LOADED, false, colors, font);
    const at = (x: number, y: number) => [...px.subarray((y * 320 + x) * 4, (y * 320 + x) * 4 + 3)];
    const fg = hexRgb(C64[14]), bg = hexRgb(C64[6]);
    // code 1 at the top left, code 2's bottom row at the bottom right, nothing of the screen beside it
    expect([at(0, 0), at(2, 0), at(312, 199), at(319, 199), at(312, 191)]).toEqual([fg, bg, fg, fg, bg]);
    // a screen that does not start on 1 KB (Go moved the grid)
    const H = cellLayout(gfxLayout('screens', 1, 0x345), 0x2345);
    expect(rowAddr(H, 0)).toBe(0x2345);
  });

  it('steps to the screen before or after, along the row and then the next one', () => {
    const L = gfxLayout('screens', 3);
    expect(stepCell(L, 0x0400, 1)).toBe(0x0800);
    expect(stepCell(L, 0x0800, 1)).toBe(0x0c00);
    expect(stepCell(L, 0x0400, -1)).toBe(0x0000);
    expect(stepCell(L, 0x0000, -1)).toBeNull();
    expect(stepCell(L, 0xfc00, 1)).toBeNull();
    // with the grid moved, from the screen's start
    expect(stepCell(gfxLayout('screens', 1, 0x345), 0x2345, 1)).toBe(0x2745);
    expect(stepCell(gfxLayout('screens', 1, 0x345), 0x0345, -1)).toBeNull();
    // every bank at once: over the end of a bank's part into the next one, and back
    const B = gfxLayout('screens', 2, 0, [{ start: 0x08000, end: 0x08c00 }, { start: 0x18000, end: 0x1a000 }]);
    expect(stepCell(B, 0x08400, 1)).toBe(0x08800);
    expect(stepCell(B, 0x08800, 1)).toBe(0x18000);
    expect(stepCell(B, 0x18000, -1)).toBe(0x08800);
    expect(stepCell(B, 0x19c00, 1)).toBeNull();
  });
});

describe('a font per row', () => {
  const colors = { bg: 0, fg: 1, mc1: 2, mc2: 5 };
  const codes = Uint8Array.from({ length: 40 }, (_, i) => (i === 1 ? 7 : i));
  const starts = (first: number, rows: number, skip = true) => fontRowStarts(first, rows, skip).starts;

  it('takes a font every 2 KB, passing over memory where no font can be, at most 25 and not past $ffff', () => {
    expect(starts(0x2000, 4)).toEqual([0x2000, 0x2800, 0x3000, 0x3800]);
    // the VIC sees the character ROM at $1000-$1fff (and $9000-$9fff); $0000 holds the zero page, stack and screen
    expect(starts(0x0000, 4)).toEqual([0x0800, 0x2000, 0x2800, 0x3000]);
    expect(fontRowStarts(0x0800, 3).skipped).toEqual([{ at: 0x1000, why: 'the VIC sees the character ROM there' }, { at: 0x1800, why: 'the VIC sees the character ROM there' }]);
    expect(starts(0x8800, 3)).toEqual([0x8800, 0xa000, 0xa800]);
    // I/O and colour RAM; the RAM under the BASIC and Kernal ROMs is fine, the VIC reads RAM there
    expect(starts(0xc000, 25)).toEqual([0xc000, 0xc800, 0xe000, 0xe800, 0xf000, 0xf800]);
    // without skipping every 2 KB counts, and a font that is not on a 2 KB boundary is passed over where it touches such memory
    expect(starts(0x0800, 3, false)).toEqual([0x0800, 0x1000, 0x1800]);
    expect(noFont(0x0f00)?.why).toBe('the VIC sees the character ROM there');
    expect(noFont(0x2700)).toBeNull();
    expect(starts(0x2000, 40, false)).toHaveLength(25);
    // from $2000 only 24 fonts fit before $ffff once $9000, $9800, $d000 and $d800 are passed over
    expect(starts(0x2000, 25).slice(-1)).toEqual([0xf800]);
    expect(starts(0x2000, 25)).toHaveLength(24);
  });

  it('lays out a row per font; a click on a row is its font, memory it skips is none', () => {
    const L = fontRowsLayout(starts(0x0800, 4), codes);
    expect(L).toMatchObject({ kind: 'fontrows', unit: 0x800, rows: 4, width: 320, height: 32, offset: 0x0800 });
    expect([0, 1, 2, 3, 4].map(r => rowAddr(L, r))).toEqual([0x0800, 0x2000, 0x2800, 0x3000, 0x3800]);
    // a row is a cell: its font; the character's line comes from the code in its column
    expect(cellAt(L, 100, 8 + 2)).toBe(0x2000);
    expect(byteAt(L, 8 + 4, 3 * 8 + 2)).toBe(0x3000 + 7 * 8 + 2);
    expect(cellOf(L, 0x2900)).toMatchObject({ start: 0x2800, y: 16 });
    expect(cellOf(L, 0x1400)).toBeNull();
    expect(cellRange(L, 0x2900, 0x3000)).toEqual({ start: 0x2800, end: 0x3800 });
    expect(rangeRects(L, 0x0800, 0x2800)).toEqual([{ x: 0, y: 0, w: 320, h: 8 }, { x: 0, y: 8, w: 320, h: 8 }]);
  });

  it('draws each row with its own font and the same codes, also as an image of the rows selected', () => {
    const mem = new Uint8Array(0x10000);
    mem[0x0800 + 7 * 8] = 0x80; // row 0's font, char 7, top line: the first pixel of column 1
    mem[0x2000 + 7 * 8 + 1] = 0x01; // row 1's font ($1000 and $1800 skipped), second line: the last pixel of column 1
    const rows = starts(0x0800, 2), L = fontRowsLayout(rows, codes), px = new Uint8ClampedArray(L.width * L.height * 4);
    drawMemory(px, L, mem, () => true, false, colors);
    const at = (x: number, y: number) => [...px.subarray((y * L.width + x) * 4, (y * L.width + x) * 4 + 3)];
    const fg = hexRgb(C64[1]), bg = hexRgb(C64[0]);
    expect([at(8, 0), at(9, 0), at(15, 9), at(8, 9)]).toEqual([fg, bg, fg, bg]);
    const img = gfxImage('fontrows', mem, 0x0800, 0x2800, false, colors, { codes, rows });
    expect([img.width, img.height]).toEqual([320, 16]);
    expect([...img.rgba.subarray((9 * 320 + 15) * 4, (9 * 320 + 15) * 4 + 3)]).toEqual(fg);
  });
});

describe('the pixel a point is on (drawing in the Graphics tab)', () => {
  it('gives the byte and the bit of a character, a sprite or a bitmap; the bit pair in multicolour', () => {
    const C = gfxLayout('chars', 32), S = gfxLayout('sprites', 8), B = gfxLayout('bitmap', 1);
    expect(pixelAt(C, 8 * 5 + 3, 8 * 2 + 7, false)).toEqual({ addr: 2 * 256 + 5 * 8 + 7, shift: 4, mask: 1 });
    expect(pixelAt(C, 8 * 5 + 3, 8 * 2 + 7, true)).toEqual({ addr: 2 * 256 + 5 * 8 + 7, shift: 4, mask: 3 });
    expect(pixelAt(S, 26 + 17, 4, false)).toEqual({ addr: 64 + 4 * 3 + 2, shift: 6, mask: 1 });
    expect(pixelAt(S, 26 + 23, 4, true)).toEqual({ addr: 64 + 4 * 3 + 2, shift: 0, mask: 3 });
    expect(pixelAt(B, 8 * 3 + 7, 8 * 1 + 2, false)).toEqual({ addr: (1 * 40 + 3) * 8 + 2, shift: 0, mask: 1 });
    // a gap, a screen: no pixel
    expect(pixelAt(S, 25, 4, false)).toBe(null);
    expect(pixelAt(gfxLayout('screens', 2), 3, 3, false)).toBe(null);
  });
});
