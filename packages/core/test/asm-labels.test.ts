/* 64tass's labels after white space in Mimir's own check (spec 10.7), as the real 64tass 1.57 gives them (measured in
 * asm-labels.integration.test.ts): a label first on a line wherever it starts, macros and functions called without
 * the #, a register's letter that is a name the code has, no operand, the warning "label not on left side". */
import { describe, expect, it } from 'vitest';
import { checkAsm } from '../src/asm-project';

const prg = (text: string) => { const c = checkAsm({ 'main.asm': text }, 'main.asm', '64tass'); expect(c.problems).toEqual([]); return [...c.asm.prg!]; };

describe("64tass's labels after white space", () => {
  it('are labels as at the start of a line: before an instruction, alone, with a colon, values, + and -', () => {
    expect(prg('  * = $1000\n  loop lda #1\n  bne loop\n')).toEqual([0x00, 0x10, 0xa9, 0x01, 0xd0, 0xfc]);
    expect(prg('\t* = $1000\n\tback\n\tnop\n\tl2: jmp back\n\tjmp l2\n')).toEqual([0x00, 0x10, 0xea, 0x4c, 0x00, 0x10, 0x4c, 0x01, 0x10]);
    expect(prg('  * = $1000\n  x = 5\n  - lda #x\n  bne -\n')).toEqual([0x00, 0x10, 0xa9, 0x05, 0xd0, 0xfc]);
    expect(prg('  * = $1000\n  n .macro\n  lda #\\1\n  .endm\n  #n 3\n')).toEqual([0x00, 0x10, 0xa9, 0x03]);
  });
  it('a mnemonic of the processor first on a line is the instruction, one only another has a label', () => {
    expect(prg('  .cpu "65c02"\n  * = $1000\n  phx\n  gcc *\n')).toEqual([0x00, 0x10, 0xda, 0x90, 0xfe]);
    expect(prg('  * = $1000\n  phx nop\n  jmp phx\n')).toEqual([0x00, 0x10, 0xea, 0x4c, 0x00, 0x10]);
  });
  it('calls a macro, a segment or a function written without its #', () => {
    expect(prg('  * = $1000\nm .macro\n  lda #\\1\n  .endm\n  m 5\nlb m 7\n  jmp lb\n')).toEqual([0x00, 0x10, 0xa9, 0x05, 0xa9, 0x07, 0x4c, 0x02, 0x10]);
    expect(prg('  * = $1000\ns .segment\n  nop\n  .endm\n  s\nf .function a\n  .endf a*2\n  lb f 4\n  .byte lb\n')).toEqual([0x00, 0x10, 0xea, 0x08]);
  });
  it("takes a register's letter that is a name the code has as its address (lda x with a label x), else the register form", () => {
    expect(prg('  * = $1000\n  lda x\n')).toEqual([0x00, 0x10, 0x8a]);
    expect(prg('  * = $1000\nx .byte 1\n  lda x\na .byte 2\n  asl a\n  asl\n')).toEqual([0x00, 0x10, 0x01, 0xad, 0x00, 0x10, 0x02, 0x0e, 0x04, 0x10, 0x0a]);
  });
  it('says no to inc and dec without an operand, as 64tass does', () => {
    const c = checkAsm({ 'main.asm': '  .cpu "65c02"\n  * = $1000\n  inc\n' }, 'main.asm', '64tass');
    expect(c.problems.map(p => [p.line, p.msg])).toEqual([[3, "no implied addressing mode for opcode 'inc'"]]);
  });
  it('warns of a label of three letters after white space that nothing uses, alone or before an instruction', () => {
    const c = checkAsm({ 'main.asm': '  * = $1000\n  abc\n  ina\n  inx\n  jmp ina\n  abd lda #1\n  abe .byte 1\n  abcd\nabf\n' }, 'main.asm', '64tass');
    expect(c.problems).toEqual([]);
    expect(c.warnings.filter(w => /left side/.test(w.msg)).map(w => w.line)).toEqual([2, 6]);
  });
});
