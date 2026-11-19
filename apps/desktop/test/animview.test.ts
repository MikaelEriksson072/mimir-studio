/* The Graphics tab's Animations: the grid of frames, what is under the pointer, the frames a selection has, and the
 * drawing (src/lib/animview.ts). The frames are made by hand here; core's test reads them from a player. */
import { describe, expect, it } from 'vitest';
import type { PetsciiAnim, PetsciiFrame } from '@mimir/core';
import { animColsOf, animFps, animLayout, animSpeedOf, C64_RGB, drawFrame, drawFrames, frameAt, frameBox, framesImage, framesIn, frameSpan, frameWhere } from '../src/lib/animview';
import { C64, hexRgb } from '../src/lib/palette';

/** a frame of spaces with screen code `code` in colour `colour` at character `at`, its bytes at start..end */
const frame = (n: number, seq: number, k: number, start: number, end: number, at = 0, code = 0x20, colour = 0): PetsciiFrame => {
  const chars = new Uint8Array(1000).fill(0x20), colours = new Uint8Array(1000);
  chars[at] = code; colours[at] = colour;
  return { n, seq, k, start, end, chars, colours, writes: 1 };
};
/** frames 0-2 at $8000 (10 bytes each), then frames 1-2 played again (the same bytes) */
const anim = (): PetsciiAnim => {
  const frames = [frame(0, 0, 0, 0x8000, 0x800a), frame(1, 0, 1, 0x800a, 0x8014), frame(2, 0, 2, 0x8014, 0x801e), frame(3, 1, 0, 0x800a, 0x8014), frame(4, 1, 1, 0x8014, 0x801e)];
  return {
    player: { loop: 0xfb38, next: 0xfab7, entry: 0xfaaf, ptr: 0x80, counter: 0x8c, chars: 0xcd00, colours: 0xcdfb },
    sequences: [{ start: 0x8000, setAt: 0xfa43, count: 3, frames: 3 }, { start: 0x800a, setAt: 0xfa7c, count: 2, frames: 2 }],
    frames, start: 0x8000, end: 0x801e, problem: null,
  };
};

describe('animation frames', () => {
  it('lays the frames out 1-4 a row, a screen each with a gap', () => {
    expect(animLayout(5, 2)).toMatchObject({ n: 5, cols: 2, rows: 3, cellW: 320, cellH: 200, width: 2 * 328, height: 3 * 208 });
    expect(animLayout(0, 3)).toMatchObject({ rows: 0, height: 0 });
    expect(frameBox(animLayout(5, 2), 3)).toEqual({ x: 328, y: 208, w: 320, h: 200 });
    expect([animColsOf(3), animColsOf(5), animColsOf('2')]).toEqual([3, 2, 2]);
    expect([animSpeedOf(1), animSpeedOf(7), animSpeedOf(undefined)]).toEqual([1, 4, 4]);
    expect([animFps(1), animFps(4), animFps(3)]).toEqual([50, 12.5, 16.7]);
  });

  it('finds the frame and the character under the pointer, none in a gap or past the last frame', () => {
    const L = animLayout(5, 2);
    expect(frameAt(L, 0, 0)).toEqual({ frame: 0, char: 0 });
    // frame 1 (the second column), character row 2, column 3
    expect(frameAt(L, 328 + 3 * 8 + 7, 2 * 8 + 1)).toEqual({ frame: 1, char: 83 });
    expect(frameAt(L, 322, 10)).toBeNull();
    expect(frameAt(L, 10, 204)).toBeNull();
    // the sixth frame's place (row 2, column 1) holds none
    expect(frameAt(L, 330, 2 * 208 + 10)).toBeNull();
    expect(frameAt(L, 10, 2 * 208 + 10)).toEqual({ frame: 4, char: 41 });
  });

  it('selects the frames whose bytes a range has: bytes played twice are both frames', () => {
    const a = anim();
    expect(framesIn(a, 0x8000, 0x800a)).toEqual([0]);
    expect(framesIn(a, 0x800a, 0x800b)).toEqual([1, 3]);
    expect(framesIn(a, 0x8009, 0x8015)).toEqual([0, 1, 2, 3, 4]);
    expect(framesIn(a, 0x801e, 0x8100)).toEqual([]);
    expect(frameSpan(a, 2, 0)).toEqual({ start: 0x8000, end: 0x801e });
    expect(frameSpan(a, 3, 3)).toEqual({ start: 0x800a, end: 0x8014 });
    expect(frameWhere(a, 4)).toBe('sequence 2 of 2, frame 2 of 2 (from $800a)');
  });

  it('draws each character in its own colour over the background', () => {
    const font = new Uint8Array(0x800);
    font.set([0xff, 0, 0, 0, 0, 0, 0, 0x80], 0x51 * 8);
    const px = new Uint8ClampedArray(320 * 200 * 4);
    drawFrame(px, 320, 0, 0, frame(0, 0, 0, 0, 1, 41, 0x51, 7), font, 6);
    const at = (x: number, y: number) => [...px.subarray((y * 320 + x) * 4, (y * 320 + x) * 4 + 3)];
    expect(at(8, 8)).toEqual(hexRgb(C64[7]));
    expect(at(15, 8)).toEqual(hexRgb(C64[7]));
    expect(at(8, 15)).toEqual(hexRgb(C64[7]));
    expect(at(9, 15)).toEqual(hexRgb(C64[6]));
    expect(at(0, 0)).toEqual(hexRgb(C64[6]));
    // the grid: rows 1-2 of a layout of 5 frames 2 a row, drawn from the top of the band; the gaps in their colour
    const L = animLayout(5, 2), band = new Uint8ClampedArray(L.width * 2 * 208 * 4);
    const a = anim();
    a.frames[2] = frame(2, 0, 2, 0x8014, 0x801e, 0, 0x51, 2);
    drawFrames(band, L, a.frames, font, 0, [1, 2, 3], 1, 3);
    expect([...band.subarray(0, 3)]).toEqual(hexRgb(C64[2]));
    expect([...band.subarray(320 * 4, 320 * 4 + 3)]).toEqual([1, 2, 3]);
    // frame 5's place in the last row is a gap
    const last = (208 + 10) * L.width + 330;
    expect([...band.subarray(last * 4, last * 4 + 3)]).toEqual([1, 2, 3]);
  });

  it('makes an image of frames without gaps, and has the palette as numbers for a GIF', () => {
    const font = new Uint8Array(0x800), a = anim();
    expect(framesImage(a.frames.slice(0, 3), font, 0, 2)).toMatchObject({ width: 640, height: 400 });
    expect(framesImage(a.frames.slice(0, 1), font, 0, 4)).toMatchObject({ width: 320, height: 200 });
    expect(C64_RGB[8]).toBe(0x6f4f25);
    expect(C64_RGB.length).toBe(16);
  });
});
