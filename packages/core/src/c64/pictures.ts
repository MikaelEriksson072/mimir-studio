/* Bitmap pictures as C64 paint programs save them (the library's Bitmaps, spec 10.6): the 8000-byte bitmap with its
 * screen matrix, colour RAM and background, in the layout of Koala Painter, Advanced Art Studio (multicolour), Art
 * Studio or Doodle! (hires). Each file is a PRG: its load address first, where the program kept the picture.
 *
 * Multicolour: a cell's pairs %01 and %10 take the high and the low nibble of its screen code, %11 its colour RAM and %00
 * the background ($d021). Hires: set bits the high nibble, clear bits the low one. */
import type { Addr } from '../types';
import { makePrg } from './prg';

export type PictureFormat = 'koala' | 'ocp' | 'art' | 'doodle';
export const PICTURE_FORMATS: readonly PictureFormat[] = ['koala', 'ocp', 'art', 'doodle'];

export interface PictureFormatInfo {
  /** the paint program */
  label: string;
  /** the extension a file is written with, and those read */
  ext: string;
  reads: readonly string[];
  /** multicolour (else hires) */
  mc: boolean;
  /** where the program loads it */
  load: Addr;
  /** the file's length, its load address included */
  size: number;
}

export const PICTURE_INFO: Record<PictureFormat, PictureFormatInfo> = {
  // $6000 bitmap, $7f40 screen, $8328 colour RAM, $8710 background
  koala: { label: 'Koala Painter', ext: 'kla', reads: ['kla', 'koa'], mc: true, load: 0x6000, size: 10003 },
  // $2000 bitmap, $3f40 screen, $4328 border, $4329 background, 14 unused, $4338 colour RAM
  ocp: { label: 'Advanced Art Studio', ext: 'ocp', reads: ['ocp', 'mpic'], mc: true, load: 0x2000, size: 10018 },
  // $2000 bitmap, $3f40 screen, $4328 border, 6 unused
  art: { label: 'Art Studio', ext: 'art', reads: ['art'], mc: false, load: 0x2000, size: 9009 },
  // $5c00 screen (and 24 unused), $6000 bitmap (and 192 unused)
  doodle: { label: 'Doodle!', ext: 'dd', reads: ['dd', 'ddl'], mc: false, load: 0x5c00, size: 9218 },
};

/** the formats of multicolour pictures, and of hires ones */
export const PICTURE_FORMATS_MC: readonly PictureFormat[] = PICTURE_FORMATS.filter(f => PICTURE_INFO[f].mc);
export const PICTURE_FORMATS_HIRES: readonly PictureFormat[] = PICTURE_FORMATS.filter(f => !PICTURE_INFO[f].mc);

/** "Koala Painter (.kla)" */
export const pictureFormatName = (f: PictureFormat): string => `${PICTURE_INFO[f].label} (.${PICTURE_INFO[f].ext})`;

/** the format a file is in, by its extension */
export function pictureFormatOf(file: string): PictureFormat | null {
  const ext = /\.([^.]+)$/.exec(file)?.[1].toLowerCase();
  return (ext && PICTURE_FORMATS.find(f => PICTURE_INFO[f].reads.includes(ext))) || null;
}

/** every extension a picture is read with */
export const PICTURE_READS: readonly string[] = PICTURE_FORMATS.flatMap(f => PICTURE_INFO[f].reads);

const BITMAP = 8000, SCREEN = 1000;

/** a picture, whatever its format: 8000 bytes of bitmap, 1000 screen codes, 1000 colour RAM nibbles (multicolour; a hires
 *  picture has none) and the background ($d021; a hires picture's border) */
export interface C64Picture {
  mc: boolean;
  bitmap: Uint8Array;
  screen: Uint8Array;
  color: Uint8Array;
  bg: number;
}

/** bytes `n` long: `b` from `at`, zeros past its end */
const part = (b: Uint8Array, at: number, n: number) => { const o = new Uint8Array(n); if (at < b.length) o.set(b.subarray(at, Math.min(b.length, at + n))); return o; };

/** A picture made whole: 8000 + 1000 + 1000 bytes (fewer are filled up with zeros), the colours nibbles. */
export function picture(p: { mc: boolean; bitmap: Uint8Array; screen: Uint8Array; color?: Uint8Array; bg: number }): C64Picture {
  const color = part(p.color ?? new Uint8Array(0), 0, SCREEN);
  for (let i = 0; i < SCREEN; i++) color[i] &= 15;
  return { mc: p.mc, bitmap: part(p.bitmap, 0, BITMAP), screen: part(p.screen, 0, SCREEN), color, bg: p.bg & 15 };
}

/** The picture as a file of the format (a PRG). A hires picture in a multicolour format gets colour RAM of zeros; a
 *  multicolour one in a hires format loses its colour RAM. */
export function writePicture(format: PictureFormat, p: C64Picture): Uint8Array {
  const i = PICTURE_INFO[format], body = new Uint8Array(i.size - 2);
  const bg = p.bg & 15;
  if (format === 'koala') {
    body.set(p.bitmap.subarray(0, BITMAP), 0); body.set(p.screen.subarray(0, SCREEN), 8000); body.set(p.color.subarray(0, SCREEN), 9000); body[10000] = bg;
  } else if (format === 'ocp') {
    body.set(p.bitmap.subarray(0, BITMAP), 0); body.set(p.screen.subarray(0, SCREEN), 8000); body[9000] = bg; body[9001] = bg; body.set(p.color.subarray(0, SCREEN), 9016);
  } else if (format === 'art') {
    body.set(p.bitmap.subarray(0, BITMAP), 0); body.set(p.screen.subarray(0, SCREEN), 8000); body[9000] = bg;
  } else {
    body.set(p.screen.subarray(0, SCREEN), 0); body.set(p.bitmap.subarray(0, BITMAP), 0x400);
  }
  return makePrg(i.load, body);
}

/** The picture in a file of the format (its load address first, whatever it is), or why it is not one: a file shorter
 *  than its bitmap and screen is refused, one without what comes after them (the border, padding) is taken. */
export function readPicture(format: PictureFormat, bytes: Uint8Array): C64Picture | { problem: string } {
  const i = PICTURE_INFO[format];
  const b = bytes.subarray(2);
  const need = format === 'doodle' ? 0x400 + BITMAP : format === 'art' ? BITMAP + SCREEN : i.size - 2;
  if (bytes.length < 2 + need) return { problem: `${bytes.length} bytes, too short for a${/^[AEIOU]/.test(i.label) ? 'n' : ''} ${i.label} picture (${i.size})` };
  if (bytes.length > 0x10000 + 2) return { problem: `${bytes.length} bytes, more than a C64 holds` };
  if (format === 'koala') return picture({ mc: true, bitmap: part(b, 0, BITMAP), screen: part(b, 8000, SCREEN), color: part(b, 9000, SCREEN), bg: b[10000] });
  if (format === 'ocp') return picture({ mc: true, bitmap: part(b, 0, BITMAP), screen: part(b, 8000, SCREEN), color: part(b, 9016, SCREEN), bg: b[9001] });
  if (format === 'art') return picture({ mc: false, bitmap: part(b, 0, BITMAP), screen: part(b, 8000, SCREEN), bg: b.length > 9000 ? b[9000] : 0 });
  return picture({ mc: false, bitmap: part(b, 0x400, BITMAP), screen: part(b, 0, SCREEN), bg: 0 });
}

/** The picture as the library keeps it whatever its file's format: Koala Painter's layout without the load address
 *  (bitmap, screen, colour RAM, background: 10001 bytes), the same picture in two formats the same bytes (a hires one
 *  has no colour RAM or background: what a file keeps of its border is left out). */
export function pictureData(p: C64Picture): Uint8Array {
  const o = new Uint8Array(BITMAP + 2 * SCREEN + 1);
  o.set(p.bitmap.subarray(0, BITMAP)); o.set(p.screen.subarray(0, SCREEN), 8000);
  if (p.mc) { o.set(p.color.subarray(0, SCREEN), 9000); o[10000] = p.bg & 15; }
  return o;
}
/** a picture from what pictureData made */
export const pictureFromData = (data: Uint8Array, mc: boolean): C64Picture => picture({ mc, bitmap: part(data, 0, BITMAP), screen: part(data, 8000, SCREEN), color: part(data, 9000, SCREEN), bg: data[10000] ?? 0 });

/** the colours a picture is given when it has none in memory: one set for every cell */
export interface PictureColors { bg: number; fg: number; mc1: number; mc2: number }

/** A screen matrix and colour RAM of one colour set: multicolour %01 mc1 and %10 mc2 in the screen, %11 fg in colour RAM;
 *  hires set bits fg and clear bits bg. */
export function flatColors(mc: boolean, c: PictureColors): { screen: Uint8Array; color: Uint8Array } {
  return { screen: new Uint8Array(SCREEN).fill(mc ? ((c.mc1 & 15) << 4) | (c.mc2 & 15) : ((c.fg & 15) << 4) | (c.bg & 15)), color: new Uint8Array(SCREEN).fill(mc ? c.fg & 15 : 0) };
}

/** where a bitmap's colours were found in memory, and by what */
export interface PictureColorsAt {
  screen: Addr | null;
  color: Addr | null;
  bg: number | null;
  /** the paint program whose layout has them there; vic: the screen the VIC shows with it ($d018) */
  by: PictureFormat | 'vic' | null;
}

/** whether 1000 bytes read as colour RAM: nine in ten with nothing in the high nibble (colour RAM has four bits; a
 *  program's copy of it mostly has zeros above them) */
const colourRam = (mem: Uint8Array, at: Addr) => { let n = 0; for (let i = 0; i < SCREEN; i++) if (!(mem[at + i] & 0xf0)) n++; return n >= 900; };

/**
 * Where the screen matrix and colour RAM of the bitmap at `bitmap` are in memory, as a paint program's file loaded
 * whole puts them beside it: Koala Painter's (screen right after the bitmap, colour RAM after it, then the background)
 * or Advanced Art Studio's (the background, 14 bytes, then colour RAM) for multicolour; else the screen the VIC shows
 * with it (`screens`: those of $d018 in its VIC bank); else, hires, Art Studio's (screen after the bitmap) or Doodle's
 * (screen in the 1 KB before it), which is any data there. Colour RAM is taken only where most of its bytes are colours. `ok`: the bytes there are
 * the program's own data (loaded, not code); the VIC's screen needs only its first row (a logo's screen has only the
 * rows of the logo). With the VIC's screen, colour RAM is the table the program copies to it (`colorRams`: where $d800
 * is in memory for each), the one with the most colours in a row.
 */
export function findPictureColors(mem: Uint8Array, bitmap: Addr, mc: boolean, ok: (start: Addr, end: Addr) => boolean, screens: readonly Addr[] = [], colorRams: readonly Addr[] = []): PictureColorsAt {
  const has = (a: number, n: number) => a >= 0 && a + n <= mem.length && ok(a, a + n);
  const after = bitmap + BITMAP;
  if (mc) {
    // the two read alike (colour RAM after the screen): Advanced Art Studio's only when its 14 unused bytes are zeros
    // and its colour RAM goes on 16 bytes past Koala Painter's, else Koala Painter's, which is far more common
    const ocp = has(after, 2 * SCREEN + 16) && colourRam(mem, after + SCREEN + 16) && !(mem[after + SCREEN + 1] & 0xf0) && mem.subarray(after + SCREEN + 2, after + SCREEN + 16).every(v => v === 0);
    if (ocp) return { screen: after, color: after + SCREEN + 16, bg: mem[after + SCREEN + 1] & 15, by: 'ocp' };
    if (has(after, 2 * SCREEN + 1) && colourRam(mem, after + SCREEN) && !(mem[after + 2 * SCREEN] & 0xf0)) return { screen: after, color: after + SCREEN, bg: mem[after + 2 * SCREEN] & 15, by: 'koala' };
  }
  // (a hires screen beside the bitmap is any data there: the screen $d018 shows comes first)
  const vic = screens.find(s => (s & 0xc000) === (bitmap & 0xc000) && has(s, 40));
  if (vic != null) {
    // the colours in a row from a table's start (a logo's: its rows), at least a row of them
    const run = (a: Addr) => { let n = 0; while (n < SCREEN && has(a + n, 1) && !(mem[a + n] & 0xf0)) n++; return n; };
    let color: Addr | null = null, best = 39;
    if (mc) for (const c of colorRams) { const n = run(c); if (n > best) { best = n; color = c; } }
    return { screen: vic, color, bg: null, by: 'vic' };
  }
  if (!mc && has(after, SCREEN)) return { screen: after, color: null, bg: has(after + SCREEN, 1) ? mem[after + SCREEN] & 15 : null, by: 'art' };
  if (!mc && !(bitmap & 0x3ff) && has(bitmap - 0x400, SCREEN)) return { screen: bitmap - 0x400, color: null, bg: null, by: 'doodle' };
  return { screen: null, color: null, bg: null, by: null };
}
