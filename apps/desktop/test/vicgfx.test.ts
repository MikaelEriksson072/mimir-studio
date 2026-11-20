/* The Graphics tab in a snapshot's VIC colours (lib/vicgfx.ts): the colours each view gets from fixtures/vsf/vic-*.vsf
 * (make-vic.asm scenes 1 and 2), and the bitmap the VIC showed drawn cell by cell as core's vicScreen draws the screen. */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { vicScreen } from '@mimir/core';
import { cellLayout, drawMemory, gfxImage, gfxLayout } from '../src/lib/gfxview';
import { snapshotVic } from '../src/lib/overview';
import { C64, hexRgb } from '../src/lib/palette';
import { vicCellColors, vicGfxColors } from '../src/lib/vicgfx';

const snap = (n: string) => snapshotVic([{ vsf: new Uint8Array(readFileSync(join(__dirname, `../../../fixtures/vsf/${n}.vsf`))) }])!;

describe('the Graphics tab in a snapshot\'s VIC colours', () => {
  it('gives each view the colours the VIC draws it with', () => {
    const v = snap('vic-sprites'), mem = v.ram;
    // scene 1: $d021 6, $d022 5, $d023 7; sprite colours 1 3 4 5 7 10 13 14, sprites 4 and 5 multicolour, $d025 1, $d026 9
    expect(vicGfxColors(v, mem, 'chars', true)).toMatchObject({ bg: 6, mc1: 5, mc2: 7 });
    expect(vicGfxColors(v, mem, 'chars', true).fg).toBeLessThan(8);
    expect(vicGfxColors(v, mem, 'sprites', true)).toEqual({ bg: 6, mc1: 1, mc2: 7, fg: 9 });
    expect(vicGfxColors(v, mem, 'sprites', false)).toEqual({ bg: 6, fg: 1, mc1: 1, mc2: 9 });
    // the colour most cells have in colour RAM
    const n = new Array(16).fill(0);
    for (const c of v.vic.colorRam.subarray(0, 1000)) n[c]++;
    expect(n[vicGfxColors(v, mem, 'screens', false).fg]).toBe(Math.max(...n));
    // scene 2: a multicolour bitmap, $d021 11
    const b = snap('vic-bitmap');
    expect(vicGfxColors(b, b.ram, 'bitmap', true).bg).toBe(11);
  });

  it('colours the shown screen and bitmap cell by cell, and nothing else', () => {
    const v = snap('vic-sprites'), cells = vicCellColors(v, v.ram);
    const i = [...v.vic.colorRam.subarray(0, 1000)].findIndex(c => c & 8), j = [...v.vic.colorRam.subarray(0, 1000)].findIndex(c => !(c & 8));
    expect(cells('screens', 0x0400, i)).toEqual({ pal: [6, 5, 7, v.vic.colorRam[i] & 7], mc: true });
    expect(cells('screens', 0x0400, j)).toEqual({ pal: [6, 0, 0, v.vic.colorRam[j]], mc: false });
    expect(cells('screens', 0x0800, 0)).toBeNull();
    expect(cells('bitmap', 0x2000, 0)).toBeNull();
    const b = snap('vic-bitmap'), bc = vicCellColors(b, b.ram), code = b.ram[0x5c00 + 41];
    expect(bc('bitmap', 0x6000, 41)).toEqual({ pal: [11, code >> 4, code & 15, b.vic.colorRam[41]], mc: true });
    expect(bc('bitmap', 0x4000, 41)).toBeNull();
  });

  it('draws the bitmap the VIC showed as the VIC drew it', () => {
    const b = snap('vic-bitmap');
    // the VIC's picture without its sprites: the display window (x 32, line 51; no scroll) is the bitmap in its colours
    const st = { ...b.st, sprites: b.st.sprites.map(s => ({ ...s, on: false })) };
    const vic = vicScreen(st, b.ram, b.vic.colorRam), rgb = C64.map(hexRgb);
    const expected = (x: number, y: number) => rgb[vic.pixels[(y + 35) * vic.width + x + 32]];
    // the tab's bitmap view, one bitmap a row: the one at $6000, drawn with the cells' own colours (the view's are
    // other, and not multicolour, so a cell that took them would show)
    const L = gfxLayout('bitmap', 1), G = cellLayout(L, 0x6000), px = new Uint8ClampedArray(G.width * G.height * 4);
    drawMemory(px, G, b.ram, () => true, false, { bg: 0, fg: 1, mc1: 2, mc2: 3 }, undefined, undefined, 0, G.rows, vicCellColors(b, b.ram));
    let diff = 0;
    for (let y = 0; y < 200; y++) for (let x = 0; x < 320; x++) {
      const o = (y * G.width + x) * 4, e = expected(x, y);
      if (px[o] !== e[0] || px[o + 1] !== e[1] || px[o + 2] !== e[2]) diff++;
    }
    expect(diff).toBe(0);
    // the PNG Save… writes, too
    const img = gfxImage('bitmap', b.ram, 0x6000, 0x7f40, false, { bg: 0, fg: 1, mc1: 2, mc2: 3 }, { cells: vicCellColors(b, b.ram) });
    const e = expected(100, 77);
    expect([...img.rgba.subarray((77 * 320 + 100) * 4, (77 * 320 + 100) * 4 + 3)]).toEqual(e);
  });
});
