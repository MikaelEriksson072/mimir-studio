/* The Inspector's enlarged character and sprite (src/lib/charzoom.ts): the one a click is on, its pixels, the keys. */
import { describe, expect, it } from 'vitest';
import { CHAR_COLS, CHAR_LAST, charBits, charCount, charIndex, charIndexAt, charNumber, charPixels, charStep, drawPixel, SPRITE_LAST, spriteCols, spriteCount, spriteIndex, spriteNumber, spritePixels, spriteStep } from '../src/lib/charzoom';

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

  it('steps through memory with the keys, past the preview\'s characters, staying at the ends of memory', () => {
    // a charset at $3000, 256 characters, 16 a row
    expect(charStep(0x3008, 'ArrowRight', 0x3000, 256)).toBe(0x3010);
    expect(charStep(0x3008, 'ArrowLeft', 0x3000, 256)).toBe(0x3000);
    expect(charStep(0x3008, 'ArrowDown', 0x3000, 256)).toBe(0x3088);
    expect(charStep(0x3088, 'ArrowUp', 0x3000, 256)).toBe(0x3008);
    expect(charStep(0x3123, 'Home', 0x3000, 256)).toBe(0x3000);
    expect(charStep(0x3123, 'End', 0x3000, 256)).toBe(0x37f8);
    // past the first and the last
    expect(charStep(0x3000, 'ArrowLeft', 0x3000, 256)).toBe(0x2ff8);
    expect(charStep(0x37f8, 'ArrowRight', 0x3000, 256)).toBe(0x3800);
    expect(charStep(0x3010, 'ArrowUp', 0x3000, 256)).toBe(0x2f90);
    expect(charStep(0x37f0, 'ArrowDown', 0x3000, 256)).toBe(0x3870);
    // a block of one character (no selection of more): on through the font, a row of 16 for ↑ ↓
    expect(charStep(0x2000, 'ArrowRight', 0x2000, 1)).toBe(0x2008);
    expect(charStep(0x2000, 'ArrowDown', 0x2000, 1)).toBe(0x2080);
    expect(charStep(0x2468, 'Home', 0x2000, 1)).toBe(0x2000);
    expect(charStep(0x2468, 'End', 0x2000, 1)).toBe(0x2000);
    // the ends of memory
    expect(charStep(0x0000, 'ArrowLeft', 0x3000, 256)).toBe(0x0000);
    expect(charStep(0x0070, 'ArrowUp', 0x3000, 256)).toBe(0x0070);
    expect(charStep(0xfff8, 'ArrowRight', 0x3000, 256)).toBe(0xfff8);
    expect(charStep(0xff80, 'ArrowDown', 0x3000, 256)).toBe(0xff80);
    expect(charStep(0xff78, 'ArrowDown', 0x3000, 256)).toBe(0xfff8);
    expect(CHAR_LAST).toBe(0xfff8);
    // a preview not on 8 keeps its phase
    expect(charStep(0x3003, 'ArrowRight', 0x3003, 1)).toBe(0x300b);
    expect(charStep(0x3003, 'a', 0x3003, 1)).toBeNull();
    expect(charStep(0x3003, 'Enter', 0x3003, 1)).toBeNull();
  });

  it('knows which of the preview\'s characters one is, if any', () => {
    expect(charIndex(0x3008, 0x3000, 256)).toBe(1);
    expect(charIndex(0x37f8, 0x3000, 256)).toBe(255);
    expect(charIndex(0x3800, 0x3000, 256)).toBeNull();
    expect(charIndex(0x2ff8, 0x3000, 256)).toBeNull();
    expect(charIndex(0x3004, 0x3000, 256)).toBeNull();
    expect(charIndex(0x2000, 0x2000, 1)).toBe(0);
    expect(charIndex(0x2008, 0x2000, 1)).toBeNull();
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

describe('the enlarged sprite', () => {
  it('counts the sprites the preview draws, at most 32, and 4 a row', () => {
    expect(spriteCount(64)).toBe(1);
    expect(spriteCount(63)).toBe(1);
    expect(spriteCount(256)).toBe(4);
    expect(spriteCount(2048)).toBe(32);
    expect(spriteCount(8000)).toBe(32);
    expect(spriteCols(1)).toBe(1);
    expect(spriteCols(3)).toBe(3);
    expect(spriteCols(32)).toBe(4);
  });

  it('finds the sprite under a point of the preview: 4 a row', () => {
    // 32 sprites: 4 × 8
    expect(charIndexAt(1.5 / 4, 0.5 / 8, 32, 4)).toBe(1);
    expect(charIndexAt(0.5 / 4, 1.5 / 8, 32, 4)).toBe(4);
    expect(charIndexAt(0.99, 0.99, 32, 4)).toBe(31);
    // 6 sprites: the second row has 2
    expect(charIndexAt(1.5 / 4, 0.75, 6, 4)).toBe(5);
    expect(charIndexAt(2.5 / 4, 0.75, 6, 4)).toBeNull();
    // one sprite fills the preview
    expect(charIndexAt(0.9, 0.9, 1, 1)).toBe(0);
  });

  it('gives the pixels of a sprite, 3 bytes a row, hires and multicolour', () => {
    const mem = new Uint8Array(0x10000);
    // row 0: $00 $7e $00, row 20: $ff $00 $1b
    mem.set([0x00, 0x7e, 0x00], 0x2000);
    mem.set([0xff, 0x00, 0x1b], 0x2000 + 60);
    mem[0x2000 + 63] = 0xff; // the 64th byte, not drawn
    const hi = spritePixels(mem, 0x2000, false);
    expect(hi).toHaveLength(21);
    expect(hi.every(r => r.length === 24)).toBe(true);
    expect(hi[0].join('')).toBe('000000000333333000000000');
    expect(hi[20].join('')).toBe('333333330000000000033033');
    const mc = spritePixels(mem, 0x2000, true);
    expect(mc.every(r => r.length === 12)).toBe(true);
    // $7e = 01 11 11 10; $1b = 00 01 10 11
    expect(mc[0].join('')).toBe('000013320000');
    expect(mc[20].join('')).toBe('333300000123');
    // 64 bytes from $fff0 (a selection, not on 64) wrap to $0000: row 6 is $0002-$0004
    mem[0x0002] = 0x01;
    expect(spritePixels(mem, 0xfff0, false)[6].join('')).toBe('000000030000000000000000');
  });

  it('steps through memory with the keys, past the preview\'s sprites, staying at the ends of memory', () => {
    // a block of one sprite at $2000: the frames after it and before it
    expect(spriteStep(0x2000, 'ArrowRight', 0x2000, 1)).toBe(0x2040);
    expect(spriteStep(0x2040, 'ArrowRight', 0x2000, 1)).toBe(0x2080);
    expect(spriteStep(0x2000, 'ArrowLeft', 0x2000, 1)).toBe(0x1fc0);
    // one a row in its preview: ↑ ↓ a sprite too
    expect(spriteStep(0x2000, 'ArrowDown', 0x2000, 1)).toBe(0x2040);
    // Home and End: the preview's first and last
    expect(spriteStep(0x2380, 'Home', 0x2000, 1)).toBe(0x2000);
    expect(spriteStep(0x1000, 'End', 0x2000, 1)).toBe(0x2000);
    // 32 sprites from $3000, 4 a row
    expect(spriteStep(0x3040, 'ArrowDown', 0x3000, 32)).toBe(0x3140);
    expect(spriteStep(0x3140, 'ArrowUp', 0x3000, 32)).toBe(0x3040);
    expect(spriteStep(0x37c0, 'ArrowRight', 0x3000, 32)).toBe(0x3800);
    expect(spriteStep(0x3000, 'End', 0x3000, 32)).toBe(0x37c0);
    // the ends of memory
    expect(spriteStep(0x0000, 'ArrowLeft', 0x2000, 1)).toBe(0x0000);
    expect(spriteStep(0x0040, 'ArrowUp', 0x3000, 32)).toBe(0x0040);
    expect(spriteStep(0xffc0, 'ArrowRight', 0x2000, 1)).toBe(0xffc0);
    expect(SPRITE_LAST).toBe(0xffc0);
    // a preview not on 64 keeps its phase
    expect(spriteStep(0x2010, 'ArrowRight', 0x2010, 1)).toBe(0x2050);
    expect(spriteStep(0x2010, 'Enter', 0x2010, 1)).toBeNull();
  });

  it('knows which of the preview\'s sprites one is, if any', () => {
    expect(spriteIndex(0x3040, 0x3000, 32)).toBe(1);
    expect(spriteIndex(0x37c0, 0x3000, 32)).toBe(31);
    expect(spriteIndex(0x3800, 0x3000, 32)).toBeNull();
    expect(spriteIndex(0x2fc0, 0x3000, 32)).toBeNull();
    expect(spriteIndex(0x3008, 0x3000, 32)).toBeNull();
    expect(spriteIndex(0x2000, 0x2000, 1)).toBe(0);
  });

  it('numbers a sprite by its pointer in its VIC bank', () => {
    expect(spriteNumber(0x2000)).toBe(0x80);
    expect(spriteNumber(0x3040)).toBe(0xc1);
    expect(spriteNumber(0x0340)).toBe(0x0d);
    expect(spriteNumber(0xc000)).toBe(0x00);
    expect(spriteNumber(0x7fc0)).toBe(0xff);
    expect(spriteNumber(0x2008)).toBeNull();
  });
});

describe('drawing in the enlarged sprite or character (an Assembler project)', () => {
  const mem = new Uint8Array(0x10000);
  mem[0x2000] = 0b00000000; mem[0x2004] = 0b11111111; mem[0x3002] = 0b01010101;
  const get = (a: number) => mem[a];
  it('sets or clears a hires pixel in its byte', () => {
    expect(drawPixel(get, 'sprite', 0x2000, false, 0, 0, 3)).toEqual({ addr: 0x2000, value: 0b10000000 });
    expect(drawPixel(get, 'sprite', 0x2000, false, 9, 1, 0)).toEqual({ addr: 0x2004, value: 0b10111111 });
    expect(drawPixel(get, 'sprite', 0x2000, false, 23, 20, 3)).toEqual({ addr: 0x2000 + 62, value: 0b00000001 });
    expect(drawPixel(get, 'chars', 0x3000, false, 7, 2, 3)).toEqual({ addr: 0x3002, value: 0b01010101 });
    expect(drawPixel(get, 'chars', 0x3000, false, 1, 2, 3)).toEqual({ addr: 0x3002, value: 0b01010101 | 0b01000000 });
  });
  it('sets a multicolour pixel\'s bit pair', () => {
    expect(drawPixel(get, 'sprite', 0x2000, true, 0, 0, 2)).toEqual({ addr: 0x2000, value: 0b10000000 });
    expect(drawPixel(get, 'sprite', 0x2000, true, 7, 1, 0)).toEqual({ addr: 0x2004, value: 0b11111100 });
    expect(drawPixel(get, 'chars', 0x3000, true, 3, 2, 3)).toEqual({ addr: 0x3002, value: 0b01010111 });
  });
});
