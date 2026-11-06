/* A run's result does not depend on the runs before it in the process: the first one boots the C64 and the 1541,
 * later ones start from the saved boot, and both must start alike. In a file of its own, so that its first run is
 * the first in the process. Needs VICE's ROMs and its 1541 DOS ROM. */
import { describe, expect, it } from 'vitest';
import { unpack, type UnpackResult } from '../src/index.ts';
import { findRoms } from '../src/node.ts';
import { asm, SYS_LINE } from './asm.ts';
import { makeD64 } from './disk.ts';

const roms = findRoms();

/**
 * A boot file that reads the 1541's VIA 1 timer 1 with M-R (it counts down from $ffff all the time, so it holds the
 * drive's clock), puts the two bytes into a program at $c000 and runs it: when the drive starts at another moment,
 * the saved program differs.
 */
const PROBE = asm(`${SYS_LINE}
       ldx #12
copy:  lda code,x
       sta $c000,x
       dex
       bpl copy
       lda #6
       ldx #<cmd
       ldy #>cmd
       jsr $ffbd
       lda #15
       ldx #8
       ldy #15
       jsr $ffba
       jsr $ffc0
       ldx #15
       jsr $ffc6
       jsr $ffcf
       sta $c001
       jsr $ffcf
       sta $c006
       jsr $ffcc
       lda #15
       jsr $ffc3
       jmp $c000
cmd:   .text "M-R"
       .byte $04, $18, 2
code:  .byte $a9, 0, $8d, 0, 4, $a2, 0, $8e, 1, 4, $4c, $0a, $c0
`);

/** what a run found, without how long it took on this computer */
const outcome = ({ ms: _ms, save: _save, ...rest }: UnpackResult) => rest;

describe.skipIf(!roms?.drive)('runs in one process', () => {
  it('give the same layers, stop and saved program, the first one too', () => {
    const disk = makeD64([{ name: 'PROBE', prg: PROBE.prg }]);
    const first = unpack(PROBE.prg, { roms, disk }), second = unpack(PROBE.prg, { roms, disk });
    expect(first.layers.map(l => l.entry)).toEqual([0x080d, 0xc000]);
    expect(first.saved).toMatchObject({ start: 0xc000, entry: 0xc000 });
    expect(outcome(second)).toEqual(outcome(first));
  });
});
