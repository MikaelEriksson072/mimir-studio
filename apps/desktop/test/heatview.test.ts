/* The memory map's zoom and pan (src/lib/heatview.ts). */
import { describe, expect, it } from 'vitest';
import { HEAT_WHOLE, heatAt, heatAxis, heatCell, heatCenter, heatClamp, heatDetail, heatMaxZoom, heatPan, heatRect, heatRespan, heatShows, heatSpan, heatTexts, heatVisible, heatZoom, heatZoomText } from '../src/lib/heatview';

const BOX = { w: 256, h: 256 };
const ALL = { p0: 0, rows: 256 };
// $0800-$37ff: the demo's 48 pages
const FIT = { p0: 8, rows: 48 };

describe('memory map zoom', () => {
  it('finds the loaded pages, or shows all 64 KB', () => {
    const owner = new Int16Array(65536).fill(-1);
    expect(heatSpan(owner, true)).toEqual(ALL);
    owner.fill(0, 0x0801, 0x3800);
    expect(heatSpan(owner, true)).toEqual(FIT);
    expect(heatSpan(owner, false)).toEqual(ALL);
  });

  it('makes the bytes wider with the zoom, and as tall once the rows are no taller', () => {
    expect(heatCell(ALL, BOX, 1)).toEqual({ cw: 1, ch: 1 });
    expect(heatCell(ALL, BOX, 8)).toEqual({ cw: 8, ch: 8 });
    // 48 pages fill the box: a row is 5.33 px tall, and only the width grows until a byte is that wide
    expect(heatCell(FIT, BOX, 1)).toEqual({ cw: 1, ch: 256 / 48 });
    expect(heatCell(FIT, BOX, 4).ch).toBe(256 / 48);
    expect(heatCell(FIT, BOX, 16)).toEqual({ cw: 16, ch: 16 });
    // the closest: eight bytes across, however wide the box is
    expect(heatMaxZoom(BOX)).toBe(32);
    expect(heatMaxZoom({ w: 128, h: 128 })).toBe(64);
  });

  it('zooms around the pointer: the byte under it stays under it', () => {
    for (const span of [ALL, FIT]) {
      let v = HEAT_WHOLE;
      const px = 200.5, py = 90.3, a = heatAt(v, span, BOX, px, py);
      for (let i = 0; i < 12; i++) {
        v = heatZoom(v, span, BOX, 1.5, px, py);
        expect(heatAt(v, span, BOX, px, py)).toBe(a);
      }
      expect(v.z).toBe(32);
      // and back out the same way, to exactly the whole map
      for (let i = 0; i < 12; i++) v = heatZoom(v, span, BOX, 1 / 1.5, px, py);
      expect(v).toEqual(HEAT_WHOLE);
    }
  });

  it('keeps the view on the map at its edges and corners', () => {
    // zooming in at the top left corner keeps it there
    const v = heatZoom(HEAT_WHOLE, ALL, BOX, 4, 0, 0);
    expect(v).toEqual({ z: 4, x: 0, y: 0 });
    expect(heatAt(v, ALL, BOX, 0, 0)).toBe(0);
    // the bottom right: the last byte stays in the corner
    const w = heatZoom(HEAT_WHOLE, ALL, BOX, 4, 255.5, 255.5);
    expect(w).toEqual({ z: 4, x: 766.5, y: 766.5 });
    expect(heatAt(w, ALL, BOX, 255.5, 255.5)).toBe(0xffff);
    expect(heatClamp({ z: 100, x: -5, y: 1e6 }, ALL, BOX)).toEqual({ z: 32, x: 0, y: 256 * 32 - 256 });
    expect(heatClamp({ z: 0.5, x: 10, y: 10 }, ALL, BOX)).toEqual(HEAT_WHOLE);
  });

  it('moves the map with a drag, as far as its edges', () => {
    const v = heatCenter({ z: 8, x: 0, y: 0 }, ALL, BOX, 0x8080);
    expect(heatAt(v, ALL, BOX, 128, 128)).toBe(0x8080);
    // dragging left by two bytes brings the bytes to the right of it under the pointer
    const w = heatPan(v, ALL, BOX, -16, 0);
    expect(heatAt(w, ALL, BOX, 128, 128)).toBe(0x8082);
    // and down by a row brings the page above
    expect(heatAt(heatPan(v, ALL, BOX, 0, 8), ALL, BOX, 128, 128)).toBe(0x7f80);
    expect(heatPan(v, ALL, BOX, 1e5, 1e5)).toEqual({ z: 8, x: 0, y: 0 });
    // the whole map does not move
    expect(heatPan(HEAT_WHOLE, FIT, BOX, 30, -30)).toEqual(HEAT_WHOLE);
  });

  it('keeps the zoom and what is in the middle when the map shows other pages', () => {
    const v = heatZoom(HEAT_WHOLE, FIT, BOX, 8, 100.3, 60.7);
    const w = heatRespan(v, FIT, ALL, BOX);
    // at ×8 a row is as tall either way: the very same bytes in view
    expect(w.z).toBe(8);
    expect([0, 255].map(p => heatAt(w, ALL, BOX, p, p))).toEqual([0, 255].map(p => heatAt(v, FIT, BOX, p, p)));
    const back = heatRespan(w, ALL, FIT, BOX);
    expect(back.z).toBe(8); expect(back.x).toBeCloseTo(v.x, 6); expect(back.y).toBeCloseTo(v.y, 6);
    // at ×2 the rows of 45 loaded pages are taller than those of all 256: the middle stays the middle
    const pages = { p0: 0x80, rows: 45 }, x = heatZoom(HEAT_WHOLE, pages, BOX, 2, 128, 128), y = heatRespan(x, pages, ALL, BOX);
    expect(heatAt(x, pages, BOX, 128, 128)).toBe(0x9680);
    expect(heatAt(y, ALL, BOX, 128, 128)).toBe(0x9680);
    expect(heatRespan(HEAT_WHOLE, FIT, ALL, BOX)).toEqual(HEAT_WHOLE);
  });

  it('finds the byte under a point and where a byte is, and whether it is in view', () => {
    expect(heatAt(HEAT_WHOLE, FIT, BOX, 16.5, 0)).toBe(0x0810);
    expect(heatAt(HEAT_WHOLE, FIT, BOX, 300, 300)).toBe(0x37ff);
    expect(heatRect(HEAT_WHOLE, FIT, BOX, 0x0910)).toEqual({ x: 16, y: 256 / 48, w: 1, h: 256 / 48 });
    expect(heatRect(HEAT_WHOLE, FIT, BOX, 0x4000)).toBeNull();
    const v = heatCenter({ z: 16, x: 0, y: 0 }, ALL, BOX, 0x1000);
    expect(heatShows(v, ALL, BOX, 0x1000)).toBe(true);
    expect(heatShows(v, ALL, BOX, 0x1010)).toBe(false);
    expect(heatShows(v, ALL, BOX, 0x2000)).toBe(false);
    // a page that is not on the map is not centred on
    expect(heatCenter(v, FIT, BOX, 0x4000)).toEqual(heatClamp(v, FIT, BOX));
    expect(heatVisible(v, ALL, BOX)).toEqual({ c0: 0, c1: 16, r0: 8, r1: 25 });
  });

  it('puts the addresses down the side: four, or one for each row when they are tall enough', () => {
    expect(heatAxis(HEAT_WHOLE, ALL, BOX)).toEqual([{ a: 0, y: 0 }, { a: 0x4000, y: 64 }, { a: 0x8000, y: 128 }, { a: 0xc000, y: 192 }]);
    expect(heatAxis(HEAT_WHOLE, FIT, BOX).map(l => l.a)).toEqual([0x0800, 0x1400, 0x2000, 0x2c00]);
    // moved sideways, each says the address at the left edge
    const v = heatCenter({ z: 32, x: 0, y: 0 }, ALL, BOX, 0xc010);
    // (the column half out of the box on the left does not count)
    expect(heatAxis(v, ALL, BOX).map(l => l.a)).toEqual([0xbd, 0xbe, 0xbf, 0xc0, 0xc1, 0xc2, 0xc3].map(p => p * 256 + 0x0d));
    // a few pages: a row each at the whole map
    expect(heatAxis(HEAT_WHOLE, { p0: 8, rows: 4 }, BOX)).toEqual([0x0800, 0x0900, 0x0a00, 0x0b00].map((a, i) => ({ a, y: i * 64 + 32 - 4.5 })));
  });

  it('shows more in the bytes the larger they are', () => {
    expect(heatDetail(1, 1)).toEqual({ grid: false, font: 0, names: false, sub: false });
    expect(heatDetail(6, 6)).toEqual({ grid: true, font: 0, names: false, sub: false });
    expect(heatDetail(13, 13).font).toBe(0);
    expect(heatDetail(14, 14)).toEqual({ grid: true, font: 8, names: false, sub: false });
    expect(heatDetail(16, 16).font).toBe(9);
    expect(heatDetail(19, 19).font).toBe(11);
    expect(heatDetail(22, 22)).toEqual({ grid: true, font: 10, names: true, sub: false });
    expect(heatDetail(32, 32)).toEqual({ grid: true, font: 10, names: true, sub: true });
    // tall rows of narrow bytes have no room for text
    expect(heatDetail(4, 60).font).toBe(0);
  });

  it('says what each byte shows on the Type, Bytes and Refs maps', () => {
    expect(heatTexts('type', 0xa9, { ins: true })).toEqual({ main: 'a9', sub: 'lda' });
    expect(heatTexts('type', 0xa9, { ins: true, hexUpper: true, mnUpper: true })).toEqual({ main: 'A9', sub: 'LDA' });
    expect(heatTexts('type', 0xa9, {})).toEqual({ main: 'a9' });
    expect(heatTexts('bytes', 0x3c, {})).toEqual({ main: '3c', bits: 0x3c });
    expect(heatTexts('refs', 0x20, { refs: 3 })).toEqual({ main: '×3', sub: '20' });
    expect(heatTexts('refs', 0x20, {})).toEqual({ sub: '20' });
    expect([1, 2.5, 4.04, 12.4, 32].map(heatZoomText)).toEqual(['×1', '×2.5', '×4', '×12', '×32']);
  });
});
