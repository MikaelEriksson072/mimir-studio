/* The Inspector's enlarged character (src/lib/charzoom.ts): the character a click is on, its pixels, the keys. */
import { describe, expect, it } from 'vitest';
import { CHAR_COLS, charBits, charCount, charIndexAt, charNumber, charPixels, charStep } from '../src/lib/charzoom';

describe('the enlarged character', () => {
  it('counts the characters the preview draws: one per 8 bytes, at least one, at most 256', () => {
    expect(charCount(2048)).toBe(256);
    expect(charCount(4096)).toBe(256);
    expect(charCount(8)).toBe(1);
    expect(charCount(3)).toBe(1);
    expect(charCount(100)).toBe(12);
  });

  it('finds the character under a point of the preview', () => {
    // a whole charset: 16 × 16 characters
    expect(charIndexAt(0, 0, 256)).toBe(0);
    expect(charIndexAt(1.5 / 16, 0.5 / 16, 256)).toBe(1);
    expect(charIndexAt(0.5 / 16, 1.5 / 16, 256)).toBe(16);
    expect(charIndexAt(0.999, 0.999, 256)).toBe(255);
    // off the canvas
    expect(charIndexAt(-0.01, 0.5, 256)).toBeNull();
    expect(charIndexAt(1, 0.5, 256)).toBeNull();
    expect(charIndexAt(0.5, 1, 256)).toBeNull();
    // 20 characters: two rows, the second with 4; past them is nothing
    expect(charIndexAt(3.5 / 16, 0.75, 20)).toBe(19);
    expect(charIndexAt(4.5 / 16, 0.75, 20)).toBeNull();
    expect(charIndexAt(15.5 / 16, 0.25, 20)).toBe(15);
    // one character in a row of 16 columns: only its cell
    expect(charIndexAt(0.5 / 16, 0.5, 1)).toBe(0);
    expect(charIndexAt(1.5 / 16, 0.5, 1)).toBeNull();
    expect(CHAR_COLS).toBe(16);
  });

  it('gives the pixels of a character, hires and multicolour', () => {
    const mem = new Uint8Array(0x10000);
    mem.set([0x7c, 0xc6, 0xc6, 0xfe, 0xc6, 0xc6, 0xc6, 0x00], 0x3008); // A
    const hi = charPixels(mem, 0x3008, false);
    expect(hi).toHaveLength(8);
    expect(hi[0]).toEqual([0, 3, 3, 3, 3, 3, 0, 0]);
    expect(hi[3]).toEqual([3, 3, 3, 3, 3, 3, 3, 0]);
    expect(hi[7]).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    // the bit pairs: $1b = 00 01 10 11
    mem[0x2000] = 0x1b;
    const mc = charPixels(mem, 0x2000, true);
    expect(mc[0]).toEqual([0, 1, 2, 3]);
    expect(mc.every(r => r.length === 4)).toBe(true);
    // the last character of memory wraps to $0000
    mem[0x0000] = 0xff;
    expect(charPixels(mem, 0xfffc, false)[4]).toEqual([3, 3, 3, 3, 3, 3, 3, 3]);
  });

  it('steps with the keys: one, a row, the first and the last, staying at the edges', () => {
    expect(charStep(1, 'ArrowRight', 256)).toBe(2);
    expect(charStep(1, 'ArrowLeft', 256)).toBe(0);
    expect(charStep(0, 'ArrowLeft', 256)).toBe(0);
    expect(charStep(255, 'ArrowRight', 256)).toBe(255);
    expect(charStep(1, 'ArrowDown', 256)).toBe(17);
    expect(charStep(17, 'ArrowUp', 256)).toBe(1);
    expect(charStep(5, 'ArrowUp', 256)).toBe(5);
    expect(charStep(10, 'ArrowDown', 20)).toBe(10);
    expect(charStep(3, 'ArrowDown', 20)).toBe(19);
    expect(charStep(9, 'Home', 20)).toBe(0);
    expect(charStep(9, 'End', 20)).toBe(19);
    expect(charStep(9, 'a', 20)).toBeNull();
    expect(charStep(9, 'Enter', 20)).toBeNull();
  });

  it('numbers a character in its 2 KB charset and writes its bytes as bits', () => {
    expect(charNumber(0x3000)).toBe(0);
    expect(charNumber(0x3008)).toBe(1);
    expect(charNumber(0x37f8)).toBe(0xff);
    expect(charNumber(0x3800)).toBe(0);
    expect(charNumber(0x3200)).toBe(0x40);
    expect(charNumber(0x3003)).toBeNull();
    expect(charBits(0x7c, false)).toBe('01111100');
    expect(charBits(0x1b, true)).toBe('00 01 10 11');
    expect(charBits(0, true)).toBe('00 00 00 00');
  });
});
