/* Bitmap pictures (the library's Bitmaps, spec 10.6): the four paint programs' layouts written and read back, a
 * picture the same bytes whatever its format, and where a bitmap's screen and colour RAM are found beside it. */
import { describe, expect, it } from 'vitest';
import {
  analyze, findBlock, findPictureColors, flatColors, isLibraryFileName, libraryExt, libraryHash, libraryItems, picture, pictureData, pictureFormatOf, pictureFromData, PICTURE_FORMATS, PICTURE_INFO, readLibraryFile, makeShowcase, readPicture, showcaseProject, writePicture,
  type Addr, type C64Picture,
} from '../src';

const bytes = (n: number, f: (i: number) => number) => Uint8Array.from({ length: n }, (_, i) => f(i) & 255);
const mcPic = (): C64Picture => picture({ mc: true, bitmap: bytes(8000, i => i * 7), screen: bytes(1000, i => i * 13), color: bytes(1000, i => i), bg: 6 });
const hiPic = (): C64Picture => picture({ mc: false, bitmap: bytes(8000, i => i * 3), screen: bytes(1000, i => i * 5), bg: 14 });

describe('picture formats', () => {
  it('writes each format at its load address and length', () => {
    for (const f of PICTURE_FORMATS) {
      const b = writePicture(f, PICTURE_INFO[f].mc ? mcPic() : hiPic());
      expect(b.length, f).toBe(PICTURE_INFO[f].size);
      expect(b[0] | (b[1] << 8), f).toBe(PICTURE_INFO[f].load);
    }
  });

  it('puts each part where the paint program has it', () => {
    const p = mcPic(), k = writePicture('koala', p), o = writePicture('ocp', p);
    // Koala Painter: $6000 bitmap, $7f40 screen, $8328 colour RAM, $8710 background
    expect(k.subarray(2 + 8000, 2 + 9000)).toEqual(p.screen);
    expect(k.subarray(2 + 9000, 2 + 10000)).toEqual(p.color);
    expect(k[2 + 10000]).toBe(6);
    // Advanced Art Studio: $3f40 screen, $4328 border, $4329 background, $4338 colour RAM
    expect(o.subarray(2 + 8000, 2 + 9000)).toEqual(p.screen);
    expect(o[2 + 9001]).toBe(6);
    expect(o.subarray(2 + 9016, 2 + 10016)).toEqual(p.color);
    // Doodle!: $5c00 screen, $6000 bitmap
    const h = hiPic(), d = writePicture('doodle', h);
    expect(d.subarray(2, 2 + 1000)).toEqual(h.screen);
    expect(d.subarray(2 + 0x400, 2 + 0x400 + 8000)).toEqual(h.bitmap);
  });

  it('reads back what it wrote, the same picture whatever the format', () => {
    for (const f of PICTURE_FORMATS) {
      const p = PICTURE_INFO[f].mc ? mcPic() : hiPic();
      const r = readPicture(f, writePicture(f, p));
      expect('problem' in r, f).toBe(false);
      expect(pictureData(r as C64Picture), f).toEqual(pictureData(p));
    }
    expect(pictureData(readPicture('koala', writePicture('koala', mcPic())) as C64Picture)).toEqual(pictureData(readPicture('ocp', writePicture('ocp', mcPic())) as C64Picture));
    expect(pictureFromData(pictureData(mcPic()), true)).toEqual(mcPic());
  });

  it('refuses a file too short for its format, and takes one without the bytes after the screen', () => {
    expect(readPicture('koala', new Uint8Array(9000))).toMatchObject({ problem: expect.stringContaining('too short for a Koala Painter picture') });
    expect(readPicture('ocp', new Uint8Array(10003))).toMatchObject({ problem: expect.stringContaining('an Advanced Art Studio') });
    // an Art Studio file of bitmap and screen only (no border)
    expect(readPicture('art', writePicture('art', hiPic()).subarray(0, 9002))).toMatchObject({ mc: false, screen: hiPic().screen });
  });

  it('knows a format by its extension', () => {
    expect(pictureFormatOf('Comaland - logo ($6000-$7f3f).kla')).toBe('koala');
    expect(pictureFormatOf('pic.KOA')).toBe('koala');
    expect(pictureFormatOf('pic.mpic')).toBe('ocp');
    expect(pictureFormatOf('pic.dd')).toBe('doodle');
    expect(pictureFormatOf('pic.bin')).toBeNull();
  });

  it('fills a screen and colour RAM with one set of colours', () => {
    const m = flatColors(true, { bg: 0, fg: 1, mc1: 15, mc2: 12 }), h = flatColors(false, { bg: 6, fg: 14, mc1: 0, mc2: 0 });
    expect([m.screen[0], m.color[999], h.screen[500]]).toEqual([0xfc, 1, 0xe6]);
  });
});

describe('where a bitmap\'s colours are', () => {
  const all = () => true;
  const mem = () => new Uint8Array(0x10000);

  it('finds a Koala Painter picture loaded whole', () => {
    const m = mem();
    m.set(writePicture('koala', mcPic()).subarray(2), 0x6000);
    expect(findPictureColors(m, 0x6000, true, all)).toEqual({ screen: 0x7f40, color: 0x8328, bg: 6, by: 'koala' });
  });

  it('finds an Advanced Art Studio picture loaded whole', () => {
    const m = mem();
    m.set(writePicture('ocp', mcPic()).subarray(2), 0x2000);
    // its colour RAM after the 14 unused bytes, not Koala's (which would start at the border)
    expect(findPictureColors(m, 0x2000, true, all)).toEqual({ screen: 0x3f40, color: 0x4338, bg: 6, by: 'ocp' });
    // with something in its unused bytes it is taken for Koala Painter's, which is far more common
    m[0x4330] = 1;
    expect(findPictureColors(m, 0x2000, true, all)).toMatchObject({ color: 0x4328, by: 'koala' });
  });

  it('takes a Koala Painter picture whose colour RAM starts with zeros for one, when nothing comes after it', () => {
    const m = mem(), p = mcPic();
    p.color.fill(0, 0, 16);
    m.set(writePicture('koala', p).subarray(2), 0x6000);
    expect(findPictureColors(m, 0x6000, true, (s, e) => e <= 0x8711)).toMatchObject({ color: 0x8328, by: 'koala' });
  });

  it('takes no colour RAM where the bytes are not colours, and the VIC\'s screen then', () => {
    const m = mem();
    m.fill(0xa9, 0x7f40, 0x8800);
    expect(findPictureColors(m, 0x6000, true, all)).toEqual({ screen: null, color: null, bg: null, by: null });
    expect(findPictureColors(m, 0x6000, true, all, [0x0400, 0x4400])).toEqual({ screen: 0x4400, color: null, bg: null, by: 'vic' });
    // a logo's screen has only the rows of the logo: its first row will do; none, not
    const logo = (s: Addr, e: Addr) => (s >= 0x6000 && e <= 0x7f40) || (s >= 0x4400 && e <= 0x4400 + 320);
    expect(findPictureColors(m, 0x6000, true, logo, [0x4400])).toMatchObject({ screen: 0x4400, by: 'vic' });
    expect(findPictureColors(m, 0x6000, true, (s, e) => s >= 0x6000 && e <= 0x7f40, [0x4400])).toMatchObject({ screen: null, by: null });
    // bytes that are not the program's data (not loaded, or code) are not taken
    expect(findPictureColors(m, 0x6000, false, (s, e) => s >= 0x6000 && e <= 0x7f40)).toEqual({ screen: null, color: null, bg: null, by: null });
  });

  it('takes colour RAM from the table the program copies to it, the one with the most colours in a row', () => {
    const m = mem();
    m.fill(0x20, 0x3000, 0x3100); m.fill(3, 0x3100, 0x3240); m.fill(5, 0x3300, 0x3310);
    // (the table at $3100 is the longest; $3300 is less than a row)
    expect(findPictureColors(m, 0x6000, true, (s, e) => (s >= 0x4400 && e <= 0x4400 + 320) || (s >= 0x3000 && e <= 0x3400), [0x4400], [0x3000, 0x3100, 0x3300]))
      .toEqual({ screen: 0x4400, color: 0x3100, bg: null, by: 'vic' });
    // hires has none
    expect(findPictureColors(m, 0x6000, false, (s, e) => s >= 0x4400 && e <= 0x4400 + 320, [0x4400], [0x3100])).toMatchObject({ color: null, by: 'vic' });
  });

  it('knows the showcase logo\'s screen and the table its colour RAM is copied from', () => {
    const A = analyze(showcaseProject()), logoColors = makeShowcase().labels.logo_colors;
    expect(logoColors).toBeGreaterThan(0);
    // lda logo_colors,x / sta $d800,x and lda logo_colors+256,x / sta $d900,x: both say logo_colors
    expect(A.vic.colorRam).toContain(logoColors);
    const ok = (s: Addr, e: Addr) => { for (let a = s; a < e; a++) if (A.owner[a] < 0 || findBlock(A.blocks, a)?.type === 'code') return false; return true; };
    const screens = A.blocks.filter(b => b.type === 'screen').map(b => b.start);
    expect(findPictureColors(A.mem, 0x4000, true, ok, screens, A.vic.colorRam)).toEqual({ screen: 0x6000, color: logoColors, bg: null, by: 'vic' });
  });

  it('finds a hires screen after the bitmap (Art Studio) or before it (Doodle!)', () => {
    const m = mem();
    expect(findPictureColors(m, 0x2000, false, all)).toMatchObject({ screen: 0x3f40, by: 'art' });
    expect(findPictureColors(m, 0x6000, false, (s) => s < 0x6000)).toMatchObject({ screen: 0x5c00, by: 'doodle' });
  });
});

describe('bitmaps in the library', () => {
  it('reads every format in the Bitmaps folder, the picture as the same bytes', () => {
    const k = writePicture('koala', mcPic()), a = writePicture('art', hiPic());
    expect(isLibraryFileName('bitmaps', 'x.kla') && isLibraryFileName('bitmaps', 'x.dd') && !isLibraryFileName('bitmaps', 'x.spr')).toBe(true);
    expect(libraryExt('bitmaps', 'ocp')).toBe('ocp');
    expect(libraryExt('bitmaps')).toBe('kla');
    expect(readLibraryFile('bitmaps', 'x.kla', k)).toEqual({ data: pictureData(mcPic()), mc: true });
    expect(readLibraryFile('bitmaps', 'x.art', a)).toEqual({ data: pictureData(hiPic()), mc: false });
    expect(readLibraryFile('bitmaps', 'x.kla', a)).toMatchObject({ problem: expect.any(String) });
    const { items } = libraryItems([{ kind: 'bitmaps', file: 'logo.kla', name: 'logo', added: 1, hash: libraryHash(pictureData(mcPic())), mc: false }], [
      { kind: 'bitmaps', file: 'logo.kla', bytes: k, mtime: 1 }, { kind: 'bitmaps', file: 'mine.art', bytes: a, mtime: 2 },
    ]);
    // multicolour as the format is, whatever the entry says
    expect(items.map(i => [i.file, i.mc, !!i.own])).toEqual([['logo.kla', true, false], ['mine.art', false, true]]);
  });
});
