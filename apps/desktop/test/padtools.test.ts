/* Scratchpads compared (spec 10.3): how the heat map fits its bytes into the room it has. */
import { describe, expect, it } from 'vitest';
import { heatLayout } from '../src/lib/heatmap';

describe('the heat map of two scratchpads', () => {
  it('takes the row length that gives the biggest cells, up to 18 pixels', () => {
    // 256 bytes in plenty of room: 16 a row, cells as big as allowed
    expect(heatLayout(256, { w: 600, h: 400 })).toEqual({ cols: 16, cell: 18 });
    // 4 KB in a wide, low room: long rows (128 a row gives 3-pixel cells, 256 only 2)
    expect(heatLayout(4096, { w: 700, h: 120 })).toEqual({ cols: 128, cell: 3 });
    // 4 KB in a square room: 64 a row, 64 rows
    expect(heatLayout(4096, { w: 400, h: 400 })).toEqual({ cols: 64, cell: 6 });
    // a few bytes: 16 a row all the same
    expect(heatLayout(5, { w: 600, h: 400 })).toEqual({ cols: 16, cell: 18 });
  });

  it('scrolls with cells of a pixel or two when even the longest rows do not fit the height', () => {
    expect(heatLayout(0x10000, { w: 600, h: 100 })).toEqual({ cols: 256, cell: 2 });
    expect(heatLayout(0x10000, { w: 300, h: 100 })).toEqual({ cols: 128, cell: 2 });
    expect(heatLayout(0x10000, { w: 200, h: 100 })).toEqual({ cols: 64, cell: 2 });
  });
});
