/* The Assembler's Release (spec 10.7): each kind of image of a program, and what it says when LOAD and RUN would not
 * start the program. That each starts in the real VICE: asm-release.integration.test.ts. */
import { describe, expect, it } from 'vitest';
import { releaseImage, releaseStarts } from '../src/asm-release';
import { parseD64, readD64File } from '../src/c64/d64';
import { readTape } from '../src/c64/tap';

const prg = (load: number, n: number) => Uint8Array.from([load & 0xff, load >> 8, ...Array.from({ length: n }, (_, i) => i & 0xff)]);

describe('releaseImage', () => {
  it('puts the program on a disk as its first file, named, with the disk name and id', () => {
    const p = prg(0x0801, 300), d = parseD64(releaseImage('d64', p, { name: 'GAME', disk: 'MY DISK', id: '25' }));
    expect(d.name).toBe('MY DISK');
    expect(d.files[0].name).toBe('GAME');
    expect([...readD64File(releaseImage('d64', p, { name: 'GAME', disk: 'MY DISK', id: '25' }), d.files[0])]).toEqual([...p]);
  });

  it('puts it on a tape where it loads, as BASIC when it loads at $0801', () => {
    const t = readTape(releaseImage('tap', prg(0x0801, 100), { name: 'GAME' }));
    expect(t.files[0].name).toBe('GAME');
    expect(t.files[0].load).toBe(0x0801);
    expect(t.files[0].data.length).toBe(100);
  });

  it('makes a cartridge and gives a PRG as it is', () => {
    expect(new TextDecoder().decode(releaseImage('crt', prg(0x1000, 50), { name: 'GAME' }).subarray(0, 16))).toBe('C64 CARTRIDGE   ');
    const p = prg(0x0801, 10);
    expect(releaseImage('prg', p, { name: 'X' })).toBe(p);
    expect(() => releaseImage('d64', Uint8Array.from([1, 8]), { name: 'X' })).toThrow(/no bytes/);
  });
});

describe('releaseStarts', () => {
  it('says that LOAD and RUN do not start a program without a BASIC line, which a cartridge does', () => {
    expect(releaseStarts('d64', prg(0x0801, 10))).toBeNull();
    expect(releaseStarts('crt', prg(0xc000, 10))).toBeNull();
    expect(releaseStarts('tap', prg(0xc000, 10))).toMatch(/loads at \$c000, not with a BASIC line at \$0801: LOAD and RUN do not start it/);
  });
});
