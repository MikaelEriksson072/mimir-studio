/* The drive code re-assembled (spec 8.11i): where each part runs in the drive, the code traced there, and the source
 * assembling to the program's bytes again. */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { analyze, assemble, DEFAULT_SETTINGS, demoProject, driveCode, parsePrg, runAddress } from '../src';
import { fromSource } from './helpers/programs';

const BASIC = '.pc = $0801\n.byte $0b,$08,$0a,$00,$9e,$32,$30,$36,$31,$00,$00,$00\n.pc = $080d\n';

/** a loader that sends a first stage with M-W (its bytes after the command) and starts it with M-E; the main code it
 *  then receives runs at $0500 and is kept at $3000 */
const LOADER = BASIC + ` jsr install
 jsr receive
 rts
install: lda #8
 jsr $ffb1
 lda #$6f
 jsr $ff93
 ldx #0
send: lda cmds,x
 jsr $ffa8
 inx
 cpx #27
 bne send
 jsr $ffae
 rts
receive: ldx #8
bit: lda $dd00
 asl
 ror $02
 lda $dd00
 lda $dd00
 lda $dd00
 dex
 bne bit
 rts
cmds: .byte $4d,$2d,$57,$00,$07,16
.pseudopc $0700 {
stage1: sei
 lda #$08
 sta $1800
 jsr $0500
 jmp stage1
 .fill 16 - (* - stage1), $ea
}
 .byte $4d,$2d,$45,$00,$07
.pc = $3000
.pseudopc $0500 {
main: sei
 lda $1800
 and #$04
 bne main
 lda $1c00
 ora #$04
 sta $1c00
 jsr wait
 sta $0300
 jsr wait
 sta $0301
 lda #$08
 bne skip
 .byte $00, $00
skip: jsr out
 lda #$08
 .byte $2c
second: lda #$04
 sta $1800
 jsr second
 jmp main
wait: clv
 bvc *
 lda $1c01
 rts
out: sta $1800
 lda $1800
 rts
table: .byte 1, 2, 3, 4, 5, 6, 7, 8
}
`;

describe('drive code', () => {
  const file = fromSource('loader.prg', LOADER);
  const A = analyze({ name: 'loader', files: [file] });
  const D = driveCode(A, DEFAULT_SETTINGS, 'loader.prg')!;

  it('places the bytes after an M-W where it writes them, and the rest where its jumps land on code', () => {
    expect(D).not.toBeNull();
    expect(D.file).toBe('loader-drive.asm');
    const parts = D.segments.map(g => ({ run: g.run, found: g.found }));
    expect(parts).toContainEqual({ run: 0x0700, found: 'M-W' });
    expect(parts).toContainEqual({ run: 0x0500, found: 'jumps' });
    const main = D.segments.find(g => g.run === 0x0500)!;
    expect(main.start).toBeLessThanOrEqual(0x3000);
    expect(main.drive).toBe('1541');
  });

  it('writes the drive code as code, inside .pseudopc where it runs, and the commands as bytes', () => {
    expect(D.text).toContain('.pseudopc $0700 {');
    expect(D.text).toContain('.pseudopc $0500 {');
    expect(D.text).toMatch(/\.byte \$4d, \$2d, \$57, \$00, \$07, \$10 +\/\/ "M-W": 16 bytes to \$0700 in the drive/);
    expect(D.text).toMatch(/\.byte \$4d, \$2d, \$45, \$00, \$07 +\/\/ "M-E": starts the drive at \$0700/);
    // the M-E address is the entry; the main code's routines have labels at their drive addresses
    expect(D.text).toMatch(/^entry_0700:$/m);
    expect(D.text).toMatch(/^sub_[0-9a-f]{4}:$/m);
    expect(D.text).toMatch(/^ +jsr \$0500$|^ +jsr [a-z]+_0500$/m);
    // the 1541's registers by name, defined once
    expect(D.text).toMatch(/^\.label VIA1_PB = \$1800 +\/\/ serial bus/m);
    expect(D.text).toMatch(/^\.label VIA2_PA = \$1c01 +\/\/ the GCR byte under the head/m);
    expect(D.text).toMatch(/^ +lda VIA2_PA +\/\/ GCR byte$/m);
    // lda #8 / bne: the bytes after it are not code; .byte $2c skips the lda #4 a jsr goes to
    expect(D.text).toMatch(/^ +\.byte \$00, \$00$/m);
    expect(D.text).toMatch(/^ +\.byte \$2c +\/\/ bit abs: skips the next 2-byte instruction$/m);
    expect(D.text).toMatch(/^ +lda #\$04$/m);
  });

  it('assembles to the program\'s bytes again', () => {
    expect(D.check).toMatchObject({ ok: true, diffs: [], errors: [] });
    expect(D.check.bytes).toBe(D.bytes);
    const r = assemble({ [D.file]: D.text }, D.file);
    expect(r.errors).toEqual([]);
    for (let a = 0; a < 0x10000; a++) if (r.written[a]) expect(r.mem[a]).toBe(A.mem[a]);
  });

  it('maps every line of the source to its bytes in the C64 and where they run in the drive', () => {
    const lines = D.text.split('\n');
    const i = lines.findIndex((l, n) => /^ +sei$/.test(l) && D.at[n]?.drive === 0x0500);
    expect(i).toBeGreaterThan(0);
    const main = D.segments.find(g => g.run === 0x0500)!;
    expect(D.at[i]).toEqual({ c64: main.start, drive: 0x0500 });
    expect(D.partLines.map(n => lines[n])).toEqual(D.segments.map(g => (g.run != null ? expect.stringMatching(/^\.pseudopc \$/) : expect.stringMatching(/^\/\/ \$/))));
  });

  it('finds the address where code runs by its jumps, and none for bytes that jump nowhere in them', () => {
    const src = '.pc = $1000\n.pseudopc $0400 {\nl: lda $1c01\n jsr s\n bne l\n jmp l\ns: lda #1\n sta $1800\n rts\n}\n';
    const r = assemble({ 'a.asm': src }, 'a.asm');
    expect(runAddress(r.mem, 0x1000, 0x1000 + 17, new Set())).toMatchObject({ run: 0x0400 });
    const data = new Uint8Array(0x10000).fill(0xea, 0x2000, 0x2040);
    expect(runAddress(data, 0x2000, 0x2040, new Set())).toBeNull();
  });

  it('re-assembles the fast loader fixture and has nothing for a program without one', () => {
    const f = parsePrg('loader-demo.prg', new Uint8Array(readFileSync(join(__dirname, '../../../fixtures/prg/loader-demo.prg'))));
    const L = driveCode(analyze({ name: 'loader-demo', files: [f] }), DEFAULT_SETTINGS, f.name)!;
    expect(L.segments.length).toBeGreaterThan(0);
    expect(L.check.ok).toBe(true);
    expect(driveCode(analyze(demoProject()), DEFAULT_SETTINGS, 'demo.prg')).toBeNull();
  });
});
