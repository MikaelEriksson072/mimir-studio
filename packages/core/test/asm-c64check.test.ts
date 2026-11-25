/* C64 checks of an Assembler project's program (spec 10.7): what the VIC and LOAD do with it that the assembler cannot
 * see. The program as an Assembler project's views take it (asmProgram), analysed as App analyses it. */
import { describe, expect, it } from 'vitest';
import { asmC64Notes } from '../src/asm-c64check';
import { asmBlockMarks } from '../src/asm-blocks';
import { asmProgram, checkAsm } from '../src/asm-project';
import { analyze } from '../src/analyze';
import { createProject } from '../src/project';

/** the notes of a Kick Assembler program, analysed as an Assembler project's */
function notes(src: string) {
  const c = checkAsm({ 'main.asm': src }, 'main.asm', 'kickass');
  expect(c.problems).toEqual([]);
  const prog = asmProgram(c, 'main.asm', asmBlockMarks([{ path: 'main.asm', text: src }]).marks);
  const A = analyze({ ...createProject({ name: 'p', files: prog.files, settings: { deepAnalysis: false } }), overrides: prog.overrides, labels: prog.labels, entryPoint: prog.entryPoint });
  return asmC64Notes(A);
}
const sprite = (at: string, mark = '// @block sprite') => `        * = ${at}\n${mark}\n        .fill 64, $ff\n// @end\n`;

describe('the C64 checks', () => {
  it('says nothing of a program the VIC and LOAD take as it is', () => {
    expect(notes(`BasicUpstart2(start)\nstart:  lda #$80\n        sta $07f8\n        rts\n${sprite('$2000')}`)).toEqual([]);
  });
  it('sees sprites outside the VIC bank the program shows, and under the character ROM', () => {
    const n = notes(`BasicUpstart2(start)\nstart:  rts\n${sprite('$4000')}${sprite('$1000')}`);
    expect(n.map(x => [x.level, x.addr])).toEqual([['warning', 0x1000], ['warning', 0x4000]]);
    expect(n[0].msg).toMatch(/character ROM at \$1000-\$1fff/);
    expect(n[1].msg).toMatch(/VIC bank 1 \(\$4000-\$7fff\), but the program shows bank 0/);
  });
  it('sees graphics that are not aligned', () => {
    const n = notes(`BasicUpstart2(start)\nstart:  rts\n${sprite('$2010')}`);
    expect(n).toHaveLength(1);
    expect(n[0].msg).toMatch(/not aligned: the VIC reads a sprite from a multiple of \$40/);
  });
  it('says what a sprite pointer shows that is not marked as sprites, or not loaded', () => {
    const n = notes(`BasicUpstart2(start)\nstart:  lda #$80\n        sta $07f8\n        lda #$81\n        sta $07f9\n        rts\n${sprite('$2000', '// (not marked)')}`);
    expect(n.map(x => [x.level, x.addr])).toEqual([['info', 0x2000], ['info', 0x2040]]);
    expect(n[0].msg).toMatch(/mark its bytes as sprites/);
    expect(n[1].msg).toMatch(/which the program does not load/);
  });
  it('sees bytes LOAD writes into the I/O registers, code under a ROM, and bytes over the KERNAL\'s work area', () => {
    const n = notes(`BasicUpstart2(start)\nstart:  jmp $e000\n        * = $d000\n        .byte 1\n        * = $e000\n        rts\n        * = $0340\n        .byte 2\n`);
    expect(n.map(x => [x.level, x.addr])).toEqual([['warning', 0xd000], ['warning', 0xe000], ['info', 0x0340]]);
    // a program that banks the ROM out runs its code there (one under BASIC: a file to $e000 has $d000-$dfff in it)
    const banked = notes(`BasicUpstart2(start)\nstart:  lda #$36\n        sta $01\n        jmp $a000\n        * = $a000\n        rts\n`);
    expect(banked).toEqual([]);
  });
});
