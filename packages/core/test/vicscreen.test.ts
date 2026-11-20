/* A VICE snapshot's VIC-II (spec 13.7): its module read in both of VICE's layouts, the VIC's view of its registers,
 * the screen drawn as VICE draws it (checked pixel for pixel against VICE's own screenshots), and what the analysis
 * takes from it. fixtures/vsf/vic-*.vsf and their .bmp were saved by x64sc 3.10 (make-vic.asm says how). */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { analyze, openC64File, parseVsf, snapshotVicState, vicScreen, vicState } from '../src';

const fixture = (p: string) => new Uint8Array(readFileSync(join(__dirname, '../../../fixtures', p)));

/** a 4-bit BMP as VICE's monitor writes it (`screenshot "x.bmp" 0`): its palette is the C64's, in order */
function readBmp(b: Uint8Array): { width: number; height: number; pixels: Uint8Array } {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const off = v.getUint32(10, true), width = v.getInt32(18, true), height = v.getInt32(22, true);
  expect(v.getUint16(28, true)).toBe(4);
  const stride = Math.ceil(width / 8) * 4, pixels = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) pixels[y * width + x] = (b[off + (height - 1 - y) * stride + (x >> 1)] >> (x & 1 ? 0 : 4)) & 15;
  return { width, height, pixels };
}

/** a snapshot with C64MEM, CIA2 and a VIC-II module laid out by `vic` */
function makeVsf(machine: string, format: [number, number], ram: Uint8Array, vic: { name: string; minor: number; data: number[] }, dd00 = 0x97): Uint8Array {
  const bytes: number[] = [...'VICE Snapshot File\x1a'].map(c => c.charCodeAt(0)), pad = (s: string, n: number) => [...s.padEnd(n, '\0')].map(c => c.charCodeAt(0));
  bytes.push(...format, ...pad(machine, 16));
  const module = (name: string, minor: number, data: ArrayLike<number>) => { const size = 22 + data.length; bytes.push(...pad(name, 16), 1, minor, size & 0xff, (size >> 8) & 0xff, (size >> 16) & 0xff, size >>> 24, ...Array.from(data)); };
  module('C64MEM', 0, [0x37, 0x2f, 1, 1, ...ram, 0, 0, 0]);
  module('CIA2', 0, [dd00, 0xff, 0x3f, 0, ...new Array(30).fill(0)]);
  module(vic.name, vic.minor, vic.data);
  return new Uint8Array(bytes);
}

describe('the VIC-II of a snapshot', () => {
  it('reads the module x64sc 3.10 writes: registers, colour RAM, raster', () => {
    const s = parseVsf(fixture('vsf/vic-sprites.vsf'));
    expect(s.modules.find(m => m.name === 'VIC-II')).toMatchObject({ major: 1, minor: 3 });
    const v = s.vic!;
    expect(v.model).toBe(1);
    // as make-vic.asm (scene 1) wrote them
    expect([v.regs[0x11], v.regs[0x16], v.regs[0x18], v.regs[0x15], v.regs[0x1c], v.regs[0x20], v.regs[0x21], v.regs[0x22], v.regs[0x23]]).toEqual([0x13, 0x13, 0x1c, 0xff, 0x30, 2, 6, 5, 7]);
    expect([v.regs[0x02], v.regs[0x03], v.regs[0x10]]).toEqual([340 & 0xff, 100, 0x02]);
    expect(v.colorRam.length).toBe(0x400);
    expect(v.colorRam.every(c => c < 16)).toBe(true);
    // the LFSR make-vic.asm fills colour RAM with leaves every colour about as often
    expect(new Set(v.colorRam).size).toBe(16);
    expect(v.irqLine).toBe(v.regs[0x12] | ((v.regs[0x11] & 0x80) << 1));
  });

  it('reads the older x64sc layout (4-byte clocks: colour RAM at 757) and x64\'s own', () => {
    const ram = new Uint8Array(0x10000), regs = new Array(64).fill(0);
    regs[0x11] = 0x9b; regs[0x12] = 0x20; regs[0x18] = 0x14; regs[0x20] = 14;
    const colour = Array.from({ length: 0x400 }, (_, i) => 0xf0 | (i % 16));
    const sc = new Array(757 + 0x400 + 100).fill(0);
    sc[0] = 3; regs.forEach((r, i) => { sc[1 + i] = r; }); sc[73] = 0x30; sc[78] = 0x81; sc[79] = 0x20; sc[80] = 1;
    colour.forEach((c, i) => { sc[757 + i] = c; });
    const a = parseVsf(makeVsf('C64SC', [1, 1], ram, { name: 'VIC-II', minor: 1, data: sc })).vic!;
    expect(a).toMatchObject({ model: 3, line: 0x30, irqFlags: 0x81, irqLine: 0x120 });
    expect([...a.colorRam.subarray(0, 18)]).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 0, 1]);
    // x64: the colour RAM at 43, the raster at 1116, the registers at 1119, the interrupt flags at 1193, no model
    const old = new Array(1300).fill(0);
    colour.forEach((c, i) => { old[43 + i] = c; });
    old[1116] = 12; old[1117] = 0x05; old[1118] = 0x01; regs.forEach((r, i) => { old[1119 + i] = r; }); old[1193] = 0x01;
    const b = parseVsf(makeVsf('C64', [1, 1], ram, { name: 'VIC-II', minor: 3, data: old })).vic!;
    expect(b).toMatchObject({ model: null, cycle: 12, line: 0x105, irqFlags: 1, irqLine: 0x120 });
    expect(b.regs[0x18]).toBe(0x14);
    expect([...b.colorRam.subarray(0, 3)]).toEqual([0, 1, 2]);
    // too short for its layout: no VIC
    expect(parseVsf(makeVsf('C64SC', [2, 0], ram, { name: 'VIC-II', minor: 3, data: sc.slice(0, 800) })).vic).toBeNull();
  });

  it('works out the mode, the bank and where the VIC reads from', () => {
    const ram = new Uint8Array(0x10000);
    ram[0x5ff8] = 0x40; ram[0x5ffb] = 0xff;
    const regs = new Array(64).fill(0);
    Object.assign(regs, { 0x11: 0x3b, 0x16: 0x18, 0x18: 0x78, 0x15: 0x09, 0x1c: 0x08, 0x1d: 0x01, 0x17: 0x08, 0x1b: 0x01, 0x10: 0x08, 0x06: 0xf4, 0x07: 0x40 });
    const st = vicState(regs, 1, ram);
    expect(st).toMatchObject({ bank: 1, base: 0x4000, mode: 'mc-bitmap', den: true, rows: 25, cols: 40, screen: 0x5c00, bitmap: 0x6000, charRom: false });
    expect(st.sprites.filter(s => s.on).map(s => [s.n, s.addr, s.mc, s.wide, s.tall, s.behind, s.x])).toEqual([[0, 0x5000, false, true, false, true, 0], [3, 0x7fc0, true, false, true, false, 0x1f4]]);
    const mode = (d011: number, d016: number) => vicState({ ...regs, 0x11: d011, 0x16: d016 } as never, 0, ram).mode;
    expect([mode(0x1b, 0x08), mode(0x1b, 0x18), mode(0x5b, 0x08), mode(0x3b, 0x08), mode(0x5b, 0x18), mode(0x7b, 0x08), mode(0x7b, 0x18)])
      .toEqual(['text', 'mc-text', 'ecm-text', 'bitmap', 'invalid', 'invalid', 'invalid']);
    // the character ROM: $1000-$1fff in banks 0 and 2, RAM in 1 and 3
    expect([0, 1, 2, 3].map(b => vicState({ ...regs, 0x11: 0x1b, 0x18: 0x14 } as never, b, ram).charRom)).toEqual([true, false, true, false]);
    expect(vicState({ ...regs, 0x11: 0x03, 0x16: 0x00 } as never, 0, ram)).toMatchObject({ den: false, rows: 24, cols: 38 });
  });

  it('draws the screen pixel for pixel as VICE did', () => {
    for (const name of ['vic-sprites', 'vic-bitmap']) {
      const s = parseVsf(fixture(`vsf/${name}.vsf`)), st = snapshotVicState(s)!;
      const v = vicScreen(st, s.ram, s.vic!.colorRam), vice = readBmp(fixture(`vsf/${name}.bmp`));
      expect([v.width, v.height]).toEqual([vice.width, vice.height]);
      let diff = 0;
      for (let i = 0; i < v.pixels.length; i++) if (v.pixels[i] !== vice.pixels[i]) diff++;
      expect(diff, name).toBe(0);
    }
  });

  it('shows the border alone with the screen off, and black in an invalid mode', () => {
    const ram = new Uint8Array(0x10000).fill(0xff), regs = new Array(64).fill(0);
    Object.assign(regs, { 0x11: 0x0b, 0x16: 0x08, 0x18: 0x14, 0x20: 4, 0x21: 6, 0x15: 1, 0x00: 100, 0x01: 100 });
    const off = vicScreen(vicState(regs, 0, ram), ram, new Uint8Array(0x400));
    expect(off.pixels.every(p => p === 4)).toBe(true);
    const bad = vicScreen(vicState({ ...regs, 0x11: 0x7b } as never, 0, ram), ram, new Uint8Array(0x400));
    // the display window (x 32-351, lines 51-250) is black, the border stays
    expect(bad.pixels[(51 - 16) * 384 + 40]).toBe(0);
    expect(bad.pixels[0]).toBe(4);
  });

  it('gives the analysis the screen, the charset and the sprites the VIC showed', () => {
    const f = openC64File('vic-sprites.vsf', fixture('vsf/vic-sprites.vsf'));
    const A = analyze({ name: 'vic-sprites', files: [f], entries: f.entries ?? [], ...(f.start != null ? { entryPoint: f.start } : {}) });
    const at = (a: number) => A.blocks.find(b => b.start <= a && a < b.end)?.type;
    expect([at(0x0400), at(0x07e7), at(0x3000), at(0x2000), at(0x21ff)]).toEqual(['screen', 'screen', 'charset', 'sprite', 'sprite']);
    const why = A.log.filter(l => l.cat === 'gfx').map(l => l.msg);
    expect(why).toContain("Screen matrix at $0400 (the snapshot's VIC shows the screen at $0400 ($d018=$1c))");
    expect(why).toContain("Sprites at $21c0 (the snapshot's VIC shows sprite 7 from pointer $07ff = $87)");
    expect(A.vic.multicolor).toBe(true);
    expect(A.vic.spriteMc).toBe(0x30);
    expect(A.vic.sprites.map(s => s.addr)).toEqual(expect.arrayContaining([0x2000, 0x21c0]));
    // the bitmap of the other snapshot, in VIC bank 1
    const g = openC64File('vic-bitmap.vsf', fixture('vsf/vic-bitmap.vsf'));
    const B = analyze({ name: 'vic-bitmap', files: [g], entries: g.entries ?? [], ...(g.start != null ? { entryPoint: g.start } : {}) });
    expect(B.blocks.find(b => b.start === 0x6000)?.type).toBe('bitmap');
    expect(B.blocks.find(b => b.start === 0x5c00)?.type).toBe('screen');
    expect(B.vic.banks.has(1)).toBe(true);
  });
});
