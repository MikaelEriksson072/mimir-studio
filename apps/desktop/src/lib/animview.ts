/* The Graphics tab's Animations view (spec 14.5b): the frames of a PETSCII animation a player in memory draws (core
 * findPetsciiAnims), a screen each, in a grid of 1-4 a row. A frame's bytes are its part of the stream, so selecting a
 * frame selects them. Pure geometry and drawing, so the view and the tests share them. */
import type { Addr, PetsciiAnim, PetsciiFrame } from '@mimir/core';
import { C64, hexRgb } from './palette';

export interface AnimLayout {
  /** frames, frames a row, and the rows they make */
  n: number; cols: number; rows: number;
  /** a frame's size and the gap after it, in pixels at zoom 1 */
  cellW: number; cellH: number; gapX: number; gapY: number;
  width: number; height: number;
}

/** frames a row the view offers */
export const ANIM_COLS = [1, 2, 3, 4];
/** video frames (1/50 s on PAL) each frame of the animation is shown, as the player is called: 1 to 8 */
export const ANIM_SPEEDS = [1, 2, 3, 4, 5, 6, 8];
/** frames a row as saved: 1-4, else 2 */
export const animColsOf = (n: unknown) => (typeof n === 'number' && ANIM_COLS.includes(n) ? n : 2);
/** video frames a frame as saved: one of the speeds, else 4 (12.5 frames a second) */
export const animSpeedOf = (n: unknown) => (typeof n === 'number' && ANIM_SPEEDS.includes(n) ? n : 4);
/** frames a second at a speed of `v` video frames a frame (PAL, 50 a second) */
export const animFps = (v: number) => Math.round((50 / v) * 10) / 10;

export function animLayout(n: number, cols: number): AnimLayout {
  const c = Math.max(1, cols), rows = Math.ceil(n / c), cellW = 320, cellH = 200, gapX = 8, gapY = 8;
  return { n, cols: c, rows, cellW, cellH, gapX, gapY, width: c * (cellW + gapX), height: rows * (cellH + gapY) };
}

/** the frame under a point (pixels at zoom 1), and the character under it (0-999); null in a gap or past the last frame */
export function frameAt(L: AnimLayout, x: number, y: number): { frame: number; char: number } | null {
  const c = Math.floor(x / (L.cellW + L.gapX)), r = Math.floor(y / (L.cellH + L.gapY));
  if (c < 0 || c >= L.cols || r < 0 || r >= L.rows) return null;
  const xi = x - c * (L.cellW + L.gapX), yi = y - r * (L.cellH + L.gapY);
  if (xi >= L.cellW || yi >= L.cellH) return null;
  const frame = r * L.cols + c;
  return frame < L.n ? { frame, char: Math.floor(yi / 8) * 40 + Math.floor(xi / 8) } : null;
}

/** where frame `i` is drawn */
export const frameBox = (L: AnimLayout, i: number) => ({ x: (i % L.cols) * (L.cellW + L.gapX), y: Math.floor(i / L.cols) * (L.cellH + L.gapY), w: L.cellW, h: L.cellH });

/** a frame's bytes end here (past $ffff: $10000) */
const endOf = (f: PetsciiFrame) => (f.end <= f.start ? 0x10000 : f.end);

/** the frames whose bytes the range has a byte of (bytes played twice: every frame that plays them) */
export const framesIn = (anim: PetsciiAnim, start: Addr, end: Addr): number[] => anim.frames.flatMap((f, i) => (f.start < end && start < endOf(f) ? [i] : []));

/** the bytes of the frames from `i` to `j` (either order), from the lowest to the highest */
export function frameSpan(anim: PetsciiAnim, i: number, j: number): { start: Addr; end: Addr } {
  const fs = anim.frames.slice(Math.min(i, j), Math.max(i, j) + 1);
  return { start: Math.min(...fs.map(f => f.start)), end: Math.max(...fs.map(endOf)) };
}

/** the sequence frame `i` is in, as the view says it: `sequence 2 of 4, frame 1 of 15 (from $bffb)` */
export function frameWhere(anim: PetsciiAnim, i: number): string {
  const f = anim.frames[i], q = anim.sequences[f.seq];
  return `sequence ${f.seq + 1} of ${anim.sequences.length}, frame ${f.k + 1} of ${q.frames} (from $${q.start.toString(16).padStart(4, '0')})`;
}

/** frame `f` into RGBA `px` (`width` pixels a row) at x, y: each screen code drawn with `font` (2 KB) in its colour over `bg` */
export function drawFrame(px: Uint8ClampedArray, width: number, x: number, y: number, f: Pick<PetsciiFrame, 'chars' | 'colours'>, font: Uint8Array, bg: number): void {
  const pal = C64.map(hexRgb), back = pal[bg & 15];
  for (let i = 0; i < 1000; i++) {
    const g = f.chars[i] * 8, fg = pal[f.colours[i] & 15], x0 = x + (i % 40) * 8, y0 = y + Math.floor(i / 40) * 8;
    for (let r = 0; r < 8; r++) {
      const bits = font[g + r] ?? 0;
      for (let k = 0; k < 8; k++) {
        const c = bits & (0x80 >> k) ? fg : back, o = ((y0 + r) * width + x0 + k) * 4;
        px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; px[o + 3] = 255;
      }
    }
  }
}

/** the rows `from` to `to` of the layout into RGBA `px` (L.width x their height), gaps in `gap` */
export function drawFrames(px: Uint8ClampedArray, L: AnimLayout, frames: readonly PetsciiFrame[], font: Uint8Array, bg: number, gap: [number, number, number] = [24, 24, 32], from = 0, to = L.rows): void {
  for (let i = 0; i < px.length; i += 4) { px[i] = gap[0]; px[i + 1] = gap[1]; px[i + 2] = gap[2]; px[i + 3] = 255; }
  for (let r = Math.max(0, from); r < Math.min(to, L.rows); r++) for (let c = 0; c < L.cols; c++) {
    const i = r * L.cols + c;
    if (i < frames.length) drawFrame(px, L.width, c * (L.cellW + L.gapX), (r - from) * (L.cellH + L.gapY), frames[i], font, bg);
  }
}

/** frames as one image without gaps, `per` a row (320 x 200 each); one frame is 320 x 200 */
export function framesImage(frames: readonly PetsciiFrame[], font: Uint8Array, bg: number, per: number): { width: number; height: number; rgba: Uint8ClampedArray<ArrayBuffer> } {
  const cols = Math.max(1, Math.min(per, frames.length)), rows = Math.max(1, Math.ceil(frames.length / cols));
  const width = cols * 320, height = rows * 200, rgba = new Uint8ClampedArray(width * height * 4);
  frames.forEach((f, i) => drawFrame(rgba, width, (i % cols) * 320, Math.floor(i / cols) * 200, f, font, bg));
  return { width, height, rgba };
}

/** the C64 palette as 0xrrggbb numbers (an animated GIF's colours) */
export const C64_RGB = C64.map(h => parseInt(h.slice(1), 16));
