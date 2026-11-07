/* G64 images, the head reading bit by bit, and the timing that Pirate Slayer's boots (Electronic Arts) count on: a
 * key track with no SYNC framed off the image's bytes, CIA timers read in the instruction's last cycle (a running
 * timer never reads 0), the stepper's phase tied to the head, and LOAD through its own pointer at $ae/$af. */
import { describe, expect, it } from 'vitest';
import { unpack } from '../src/index.ts';
import { findRoms } from '../src/node.ts';
import { C64 } from '../src/c64.ts';
import { Drive } from '../src/drive.ts';
import { g64ToD64, g64ToDisk, isG64, parseG64, writeG64Sectors } from '../src/g64.ts';
import { standInRoms } from '../src/standin.ts';
import { asm } from './asm.ts';
import { makeD64 } from './disk.ts';
import { keyTrack, makeG64 } from './g64disk.ts';
import { noise } from './packers.ts';

const roms = findRoms();
const withDrive = !!roms?.drive;

describe('G64 images', () => {
  const d64 = makeD64([{ name: 'NOISE', prg: noise(30000, 5) }]);
  const g64 = makeG64(d64);

  it('are known by their signature, and their sectors read back as the D64 they came from', () => {
    expect(isG64(g64)).toBe(true);
    expect(isG64(d64)).toBe(false);
    const back = g64ToD64(g64);
    expect(back.length).toBe(175531);
    expect(back.subarray(0, 174848)).toEqual(d64);
    expect([...back.subarray(174848)].every(e => e === 1)).toBe(true);
    expect(g64ToDisk(g64).name).toBe('TEST DISK');
  });

  it('write a sector back in place and leave the rest of the track as it was', () => {
    const data = Uint8Array.from({ length: 256 }, (_, i) => (i * 7) & 0xff);
    const out = writeG64Sectors(g64, [{ track: 5, sector: 3, data }]);
    const back = g64ToD64(out), at = (4 * 21 + 3) * 256;
    expect(back.subarray(at, at + 256)).toEqual(data);
    expect(back.subarray(0, at)).toEqual(d64.subarray(0, at));
    expect(back.subarray(at + 256, 174848)).toEqual(d64.subarray(at + 256));
    const before = parseG64(g64).halves[10]!, after = parseG64(out).halves[10]!;
    expect(after.length).toBe(before.length);
    const changed = [...after.keys()].filter(i => after[i] !== before[i]);
    expect(changed.length).toBeGreaterThan(200);
    expect(changed[changed.length - 1] - changed[0]).toBeLessThan(330);
  });

  it('read a track with no SYNC as sectors that are not there (error 3), a half track as nothing', () => {
    const g = makeG64(d64, { 4: keyTrack(3), 5: keyTrack(0) });
    const back = g64ToD64(g);
    const errors = back.subarray(174848);
    expect([...errors.subarray(21, 42)].every(e => e === 3)).toBe(true);
    expect([...errors.subarray(0, 21)].every(e => e === 1)).toBe(true);
    expect(g64ToDisk(g).halves![5]!.length).toBe(6666);
  });
});

describe.skipIf(!withDrive)('the head on a track with no SYNC', () => {
  it('frames the bytes where its bit counter is, which slips a bit each turn, so the key is found at any bit', () => {
    // Pirate Slayer's check, as its drive code has it: D7 … D7, EB, CC AD 512 times; then $0600 = 1
    const code = asm(`
* = $0500
       sei
       lda $1c00
       ora #$04
       and #$9f
       ora #$20
       sta $1c00
       lda #$00
       sta $0600
miss:  bvc *
       clv
       lda $1c01
       cmp #$d7
       bne miss
d7:    bvc *
       clv
       lda $1c01
       cmp #$d7
       beq d7
       cmp #$eb
       bne miss
       ldx #$02
       ldy #$00
pair:  bvc *
       clv
       lda $1c01
       cmp #$cc
       bne miss
       bvc *
       clv
       lda $1c01
       cmp #$ad
       bne miss
       dey
       bne pair
       dex
       bne pair
       lda #$01
       sta $0600
       jmp *
`);
    for (const bit of [0, 3, 7]) {
      const d = new Drive(roms!.drive!);
      while (d.cycles < 2_500_000) d.step();
      d.insert(g64ToDisk(makeG64(makeD64([]), { 4: keyTrack(bit) })));
      // the head on track 2, the stepper's phase as it is there (2)
      d.write(0x1c00, (d.via2.outB & ~3) | 2);
      d.halftrack = 4;
      d.ram.set(code.prg.subarray(2), 0x0500);
      d.cpu.pc = 0x0500;
      const start = d.cycles;
      while (d.ram[0x600] !== 1 && d.cycles - start < 6_000_000) d.step();
      expect(d.ram[0x600], `key framed from bit ${bit}`).toBe(1);
    }
  });
});

describe('the stepper', () => {
  it('is tied to the head: phase 0 on track 1, 2 on track 2; the opposite phase moves it a whole track in', () => {
    const d = new Drive(new Uint8Array(0x4000));
    d.write(0x1c02, 0x6f);
    d.halftrack = 4;
    d.write(0x1c00, 0x62);
    expect(d.halftrack).toBe(4);
    d.write(0x1c00, 0x63);
    expect(d.halftrack).toBe(5);
    d.write(0x1c00, 0x62);
    expect(d.halftrack).toBe(4);
    // a reset sets phase 0: from track 2 the head goes to track 3 (Pirate Slayer's boots reset the drive with UJ there)
    d.write(0x1c00, 0x60);
    expect(d.halftrack).toBe(6);
  });
});

describe('CIA timers', () => {
  it('are read in the instruction\'s last cycle, count from the third cycle after the write, and never read 0', () => {
    const m = new C64(standInRoms());
    const code = asm(`
* = $c000
       lda #$06
       sta $dc04
       lda #$00
       sta $dc05
       lda #$01
       sta $dc0e
       lda $dc04
       ldx $dc04
       ldy $dc04
       sta $c100
       stx $c101
       sty $c102
       jmp *
`);
    m.ram.set(code.prg.subarray(2), 0xc000);
    m.cpu.pc = 0xc000; m.cpu.i = 1;
    for (let n = 0; n < 40; n++) { m.dmaWait(); m.advance(m.cpu.step()); }
    // the latch is 6: the reads 4, 8 and 12 cycles after the write see 4, then 0 shown as the latch, then 3
    expect([...m.ram.subarray(0xc100, 0xc103)]).toEqual([4, 6, 3]);
  });
});

describe.skipIf(!roms)('LOAD', () => {
  it('stores through its pointer at $ae/$af: a file over the pointer goes on where its first bytes say', () => {
    // loads at $00ae: $ae, $02 make the pointer $02b0; the rest is code there and the BASIC idle vector at $0302
    const rest = new Uint8Array(0x0304 - 0x02b0);
    rest.set([0xee, 0x20, 0xd0, 0x4c, 0xb0, 0x02]);
    rest[0x0302 - 0x02b0] = 0xb0; rest[0x0303 - 0x02b0] = 0x02;
    const file = Uint8Array.from([0xae, 0x00, 0xae, 0x02, ...rest]);
    const r = unpack(file, { roms, maxCycles: 3_000_000 });
    expect(r.layers[0]?.entry).toBe(0x02b0);
  });
});
