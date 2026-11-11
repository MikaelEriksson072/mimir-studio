/* A script's Init (spec 10.3): what its register and zero-page fields read. */
import { describe, expect, it } from 'vitest';
import { initValue } from '../src/lib/scriptinit';

const names = new Map([['colors_0939', 0x0939], ['ptr_fb', 0xfb], ['pad1', 0xc800]]);

describe('script init values', () => {
  it('read hex, binary and decimal numbers', () => {
    expect(initValue('$fb', names)).toBe(0xfb);
    expect(initValue('$C000', names)).toBe(0xc000);
    expect(initValue('%101', names)).toBe(5);
    expect(initValue(' 255 ', names)).toBe(255);
  });

  it('read names, with an offset and as the low or the high byte', () => {
    expect(initValue('colors_0939', names)).toBe(0x0939);
    expect(initValue('ptr_fb+1', names)).toBe(0xfc);
    expect(initValue('pad1 - $10', names)).toBe(0xc7f0);
    expect(initValue('<colors_0939', names)).toBe(0x39);
    expect(initValue('>colors_0939', names)).toBe(0x09);
    expect(initValue('>pad1+$100', names)).toBe(0xc9);
  });

  it('say null for what is not a number of $0000-$ffff', () => {
    expect(initValue('', names)).toBeNull();
    expect(initValue('nothing', names)).toBeNull();
    expect(initValue('$10000', names)).toBeNull();
    expect(initValue('ptr_fb-$100', names)).toBeNull();
    expect(initValue('$fg', names)).toBeNull();
  });
});
