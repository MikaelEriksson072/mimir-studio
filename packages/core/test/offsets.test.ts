/* The listing's offset column (as in SourceGen): where each loaded byte is in the file it was opened from. */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileOffsetBases, offsetText, openC64File, openCartridge, parseVsf } from '../src';

const fixture = (p: string) => new Uint8Array(readFileSync(join(__dirname, '../../../fixtures', p)));

describe('offsets in the file a byte was opened from', () => {
  it('puts a PRG\'s bytes after its 2-byte load address', () => {
    const f = openC64File('raster-demo.prg', fixture('prg/raster-demo.prg'));
    expect(fileOffsetBases({ files: [f] })).toEqual([2]);
  });

  it('finds a cartridge chip\'s bytes in its CHIP packet, as SourceGen numbers them', () => {
    // the 64-byte header and a 16-byte CHIP header before each bank: bank 0's $8000 is at 80, bank 1's at 8288
    const o = openCartridge('mimir-demo.crt', fixture('crt/mimir-demo.crt'));
    expect(fileOffsetBases({ files: o.files, cart: o.cart })).toEqual([0x50, 0x2060]);
    expect(offsetText(0x50)).toBe('+000050');
    expect(offsetText(0x2060)).toBe('+002060');
    // without the image (or one that cannot be read) the chips have none
    expect(fileOffsetBases({ files: o.files })).toEqual([null, null]);
  });

  it('finds a snapshot\'s RAM in its C64MEM module', () => {
    const vsf = fixture('vsf/raster-demo.vsf'), f = openC64File('raster-demo.vsf', vsf);
    const mem = parseVsf(vsf).modules.find(m => m.name === 'C64MEM')!;
    const [base] = fileOffsetBases({ files: [f] });
    expect(base).toBe(mem.offset + 4 + f.load);
    // the byte there is the RAM's at the load address
    expect(vsf[base!]).toBe(f.bytes[0]);
  });
});
