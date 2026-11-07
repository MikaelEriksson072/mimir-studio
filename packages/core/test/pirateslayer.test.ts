/* Pirate Slayer on a disk (c64/pirateslayer.ts, spec 13.5h): the key track of a G64 (no SYNC, framed off the image's
 * bytes), the three kinds of boot, the drive's check where it is not encrypted, and the boot's own text; the loader
 * (analyze/loaders.ts) by its key check, its signature and its receive loops. The disks are made here: the files are
 * a few bytes of what each boot is known by, nothing of Electronic Arts' own code beyond them. */
import { describe, expect, it } from 'vitest';
import { analyze, makeD64, readPirateSlayerDisk, render, type ProjectInput } from '../src';
import { wrapComment } from '../src/render/kick';
import { fromSource } from './helpers/programs';
import { keyTrack, toG64 } from './helpers/g64';

const prg = (load: number, ...data: number[]) => Uint8Array.from([load & 0xff, load >> 8, ...data]);
const text = (s: string) => [...s].map(c => c.charCodeAt(0));
const BOOT_TEXT = '+2 PIRATESLAYER BOOT PROGRAMMED BY KRIS HATLELID REGINA, SASK. CANADA';
/** the drive's check as its code has it: bvc * / clv / lda $1c01 / cmp #$d7 / bne / … / cmp #$eb */
const CHECK = [0x50, 0xfe, 0xb8, 0xad, 0x01, 0x1c, 0xc9, 0xd7, 0xd0, 0xe7, 0x50, 0xfe, 0xb8, 0xad, 0x01, 0x1c, 0xc9, 0xd7, 0xf0, 0xf6, 0xc9, 0xeb, 0xd0, 0xd9];

describe('Pirate Slayer on a disk', () => {
  // EA's own boot: EA (2 blocks over the stack page) and LOADER (with its text); the game on later tracks
  const eaDisk = makeD64({ name: 'electronic arts', id: 'ea', files: [
    { name: 'EA', data: prg(0x00f7, ...Array(335).fill(0x02)) },
    { name: 'LOADER', data: prg(0xfffa, 0, 0, 0, 0, 0, 0, 0x0f, 0x06, ...text(BOOT_TEXT), ...Array(5000).fill(0)) },
  ] });

  it('reads the key on track 2 of a G64, framed from any bit, and the boot EA → LOADER', () => {
    const p = readPirateSlayerDisk(toG64(eaDisk, { 4: keyTrack(3) }))!;
    expect(p).not.toBeNull();
    expect(p.version).toBe('v2');
    expect(p.format).toBe('G64');
    expect(p.keys).toHaveLength(1);
    expect(p.keys[0]).toMatchObject({ track: 2, bitPhase: 3, syncs: 0 });
    expect(p.keys[0].copies).toEqual(Array(3).fill({ d7: 300, pairs: 512, signature: true }));
    expect(p.boot).toMatchObject({ kind: 'loader', files: ['EA', 'LOADER'] });
    expect(p.text).toBe(BOOT_TEXT);
    expect(p.summary).toBe('Pirate Slayer V2 (Electronic Arts): the key on track 2 (no SYNC, 3 copies a turn, framed from bit 3); boot EA → LOADER');
  });

  it('says that a D64 has no key track, so its boot fails the check', () => {
    const p = readPirateSlayerDisk(eaDisk)!;
    expect(p.version).toBe('v2');
    expect(p.keys).toEqual([]);
    expect(p.summary).toBe('Pirate Slayer V2 (Electronic Arts): no key track (a D64 has none: the check fails); boot EA → LOADER');
  });

  it('knows the stack-page boot at $0102 by its first bytes, and a boot of its own that loads over $ae/$af', () => {
    const stack = makeD64({ name: 'flight', files: [{ name: 'EA', data: prg(0x0102, 0x20, 0x44, 0xe5, 0xa9, 0x0b, 0x8d, 0x11, 0xd0, 0xa9, 0x0f, 0xa8, 0xa2, 0x08, 0x20, 0xba, 0xff, 0xa9, 0x00, 0x20, 0xbd, 0xff, 0x20, 0xc0, 0xff, ...Array(200).fill(0)) }] });
    expect(readPirateSlayerDisk(stack)!.boot).toMatchObject({ kind: 'stack', files: ['EA'] });
    // a boot of the game's own: its first two bytes move LOAD's pointer to $02b0; the check is in the next file
    const own = makeD64({ name: 'race', files: [
      { name: 'BOOT', data: prg(0x00ae, 0xae, 0x02, ...Array(700).fill(0xea)) },
      { name: 'MAIN', data: prg(0x8000, ...Array(100).fill(0), ...CHECK, ...Array(100).fill(0)) },
    ] });
    const p = readPirateSlayerDisk(toG64(own, { 4: keyTrack(7, 4) }))!;
    expect(p.boot?.kind).toBe('own');
    expect(p.boot?.how).toContain('so the rest of it goes to $02B0');
    expect(p.checkIn).toEqual(['MAIN']);
    expect(p.keys[0]).toMatchObject({ track: 2, bitPhase: 7 });
    expect(p.keys[0].copies).toHaveLength(4);
  });

  it('finds nothing on other disks, D64 or G64', () => {
    const plain = makeD64({ name: 'demo', files: [{ name: 'DEMO', data: prg(0x0801, ...Array(3000).fill(0x60)) }] });
    expect(readPirateSlayerDisk(plain)).toBeNull();
    expect(readPirateSlayerDisk(toG64(plain))).toBeNull();
  });
});

const BASIC = '.pc = $0801\n.byte $0b,$08,$0a,$00,$9e,$32,$30,$36,$31,$00,$00,$00\n.pc = $080d\n';
const project = (src: string): ProjectInput => ({ name: 'loader', files: [fromSource('loader.prg', BASIC + src)] });

/** a receive loop like Pirate Slayer's, the key check it uploads to the drive and the key's last bytes */
const SOURCE = ` jsr recv
 rts
recv: ldy #0
byte: sec
 ldx $02
wait: lda $d012
 sbc #$32
 bcc go
 and #$07
 beq wait
go: stx $dd00
 txa
 ora #$20
 tax
 nop
 nop
 lda #$ff
 lda $dd00
 lsr
 lsr
 nop
 eor $dd00
 lsr
 lsr
 nop
 bit $80
 eor $dd00
 lsr
 lsr
 eor $02
 eor $dd00
 stx $dd00
 eor #$ff
 sta $c000,y
 iny
 bne byte
 rts
drive: .byte ${CHECK.map(b => `$${b.toString(16)}`).join(',')}
key: .byte $55,$ae,$9b,$55,$ad,$55,$cb,$ae,$6b,$ab,$ad,$af
`;

describe('the Pirate Slayer loader', () => {
  it('is known by its receive loop, the drive code it uploads (the key check) and the key it compares', () => {
    const found = analyze(project(SOURCE)).loaders;
    const ps = found.find(l => l.id === 'pirateslayer');
    // the source's head says so over lines of 110 characters at most, the key's bytes on one of them
    const p = project(SOURCE);
    const head = (render(analyze(p), p).files['loader.asm'] as string).split('\n').filter(l => l.startsWith('//   '));
    expect(head[0]).toMatch(/^\/\/   Pirate Slayer \(Electronic Arts\): /);
    expect(head.length).toBeGreaterThan(2);
    expect(head.every(l => l.length <= 113)).toBe(true);
    expect(head.some(l => l.includes('55 AE 9B 55 AD 55 CB AE 6B AB AD AF'))).toBe(true);
    expect(ps?.sure).toBe('match');
    // the check and the key right after it are one part of drive code
    expect(ps?.parts.map(p => p.role).sort()).toEqual(['drivecode', 'resident']);
    const drive = ps!.parts.find(p => p.role === 'drivecode')!;
    expect(drive.end - drive.start).toBeGreaterThanOrEqual(CHECK.length + 12);
    expect(found.filter(l => l.id !== 'pirateslayer')).toEqual([]);
  });
});

describe('a comment in the source', () => {
  it('is broken between words, the first line under the head and the rest under it, runs of bytes kept whole', () => {
    expect(wrapComment('short text', 100)).toEqual(['  short text']);
    expect(wrapComment('one two three four five six', 15)).toEqual(['  one two three', '    four five', '    six']);
    expect(wrapComment('the key: then 55 AE 9B 55 AD AF, and lda $dd00 / lsr / lsr / eor $dd00 last', 42))
      .toEqual(['  the key: then 55 AE 9B 55 AD AF, and', '    lda $dd00 / lsr / lsr / eor $dd00 last']);
    expect(wrapComment('a key of 55 AE 9B 55 AD AF here', 21)).toEqual(['  a key of', '    55 AE 9B 55 AD AF', '    here']);
  });
});
