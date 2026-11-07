/* BoozeLoader in a program (analyze/loaders.ts, analyze/booze.ts, spec 8.11c and 13.5d): known by its receive loop and
 * its way of sending a bit (a few instructions each, written here from Booze Design's demos), and its script read back
 * from the code that calls it: loads by number, the disk side, track and sector for its oldest version, and the other
 * calls between them, traced or in bytes the analysis did not reach. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyze, boozeLine, boozeScript, readBoozeDisk, render, verify, type ProjectInput } from '../src';
import { BOOZE_BOOT } from './helpers/booze-disk';
import { fromSource } from './helpers/programs';

const BASIC = '.pc = $0801\n.byte $0b,$08,$0a,$00,$9e,$32,$30,$36,$31,$00,$00,$00\n.pc = $080d\n';
const project = (src: string): ProjectInput => ({ name: 'booze', files: [fromSource('booze.prg', src)] });

/** the receive loop alone, at $c000: the loader is called at $0200, where it is copied later */
const RECEIVE = `.pc = $c000
 dey
 ldx #$08
 lda $dd00
 stx $dd00
 lsr
 lsr
 iny
 nop
 ldx #$00
 eor $dd00
 stx $dd00
 lsr
 lsr
 rts
`;

describe('BoozeLoader', () => {
  it('is known by its receive loop and its way of sending a bit, and its script is the code that calls it', () => {
    const A = analyze(project(BOOZE_BOOT));
    expect(A.loaders.map(l => l.id)).toEqual(['boozeloader']);
    expect(A.loaders[0].parts.map(p => p.what)).toEqual([expect.stringMatching(/^receive loop/)]);
    const s = A.booze!;
    expect(s).toMatchObject({ loader: 0x082a, byTrack: false, runs: [{ start: 0x080d, end: 0x082a, traced: true }] });
    expect(s.steps.map(boozeLine)).toEqual(['side 1', 'load $00', 'call $1000', 'load $01', 'load $02', 'call $2000 x=$05']);
    expect(s.steps.map(x => x.at)).toEqual([0x080d, 0x0812, 0x0817, 0x081a, 0x081f, 0x0824]);
  });

  it('writes the script with what each file unpacks to, from the disk of its side', () => {
    const A = analyze(project(BOOZE_BOOT));
    const disk = readBoozeDisk(new Uint8Array(readFileSync(join(__dirname, '../../../fixtures/d64/booze-demo.d64'))))!;
    const text = boozeScript(A.booze!, (st, side) => {
      const u = side === disk.side ? disk.files.find(f => f.n === st.file)?.unpacked : null;
      return u ? `unpacks to $${u.start.toString(16)}` : null;
    });
    expect(text).toEqual([
      '; BoozeLoader script, read back by Mimir Studio from the code that calls the loader at $082a: 3 loads.',
      '; The code is the script: lda #file / jsr $082a loads a file, lda #$80+side waits for a disk side, and the calls between run the parts.',
      '',
      '$080d-$0829:',
      '  side 1                     ; $080d',
      '  load $00                   ; $0812, unpacks to $801',
      '  call $1000                 ; $0817',
      '  load $01                   ; $081a',
      '  load $02                   ; $081f, unpacks to $4c18',
      '  call $2000 x=$05           ; $0824',
    ]);
  });

  it('reads the oldest version, which takes a track and sector, from the loader it has not copied to $0200 yet', () => {
    const A = analyze(project(`${BASIC} ldy #$00
 ldx #$01
 lda #$00
 jsr $0200
 ldy #$05
 ldx #$02
 lda #$01
 jsr $0200
 ldy #$00
 ldx #$40
 lda #$02
 jsr $0200
 jsr $c000
 jsr send
 rts
send: txa
 jsr $c100
 tya
 jsr $c100
 jsr $c100
 cmp #$00
 php
 plp
 rts
${RECEIVE}`));
    expect(A.loaders.map(l => l.id)).toEqual(['boozeloader']);
    expect(A.booze).toMatchObject({ loader: 0x0200, byTrack: true });
    expect(A.booze!.steps.map(boozeLine)).toEqual(['load 1/0', 'load 2/5 as it is', 'unpack $4000', 'call $c000', expect.stringMatching(/^call \$/)]);
  });

  it('reads a script the analysis does not trace, as bytes that call the loader', () => {
    // the script is in data after the rts, marked as data (as one copied elsewhere before it runs is to the analysis)
    const A = analyze({ ...project(`${BASIC} jsr $c000
 rts
.byte $20,$00,$30, $a9,$b1,$20,$00,$02, $a9,$00,$20,$00,$02, $a9,$01,$20,$00,$02, $a2,$03,$20,$03,$30, $60
${RECEIVE}`), overrides: [{ start: 0x0811, end: 0x082a, type: 'data' }] });
    expect(A.booze).toMatchObject({ loader: 0x0200, runs: [{ start: 0x0811, end: 0x0829, traced: false }] });
    expect(A.booze!.steps.map(boozeLine)).toEqual(['call $3000', 'side 1', 'load $00', 'load $01', 'call $3003 x=$03']);
    // one call alone in data is not a script
    const one = analyze(project(`${BASIC} jsr $c000
 rts
.byte $a9,$00,$20,$00,$02, $ff
${RECEIVE}`));
    expect(one.booze).toBeNull();
  });

  it('reads tail calls (lda #n / jmp loader), a row of them not traced as Triad\'s demos have', () => {
    const A = analyze({ ...project(`${BASIC} jsr $c000
 rts
.byte $a9,$b1,$4c,$00,$02, $ea, $a9,$00,$4c,$00,$02, $ea, $a9,$01,$4c,$00,$02, $60
${RECEIVE}`), overrides: [{ start: 0x0811, end: 0x0823, type: 'data' }] });
    expect(A.booze!.runs).toHaveLength(3);
    expect(A.booze!.steps.map(boozeLine)).toEqual(['side 1', 'load $00', 'load $01']);
  });

  it('has no script without BoozeLoader, and calls of $0200 alone are not it', () => {
    expect(analyze(project(`${BASIC} lda #$00
 jsr $0200
 lda #$01
 jsr $0200
 lda #$02
 jsr $0200
 rts`)).booze).toBeNull();
  });

  it('marks the script in the source, which still builds byte-exact', () => {
    const p = project(BOOZE_BOOT);
    const A = analyze(p), R = render(A, p);
    const text = R.files['booze.asm'] as string;
    expect(text).toContain('// BoozeLoader script found by Mimir Studio (the ==== lines mark its stretches of code), as its loads and calls:');
    expect(text).toContain('//     call $2000 x=$05           ; $0824');
    expect(text).toContain('// ==== BoozeLoader script: 3 loads from here to $0829 ====');
    expect(verify(A, R).ok).toBe(true);
  });
});
