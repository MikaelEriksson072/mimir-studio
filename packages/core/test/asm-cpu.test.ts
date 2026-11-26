/* 64tass's other processors in Mimir's own check (spec 10.7): .cpu "65816" (the SuperCPU's), "65c02", "r65c02",
 * "w65c02", and the command line's -x / --m65816; .dpage and .databank; .al/.xl and .autsiz; random() and .seed; the
 * operators x and `. The bytes are those 64tass 1.57 writes (measured; asm-cpu.integration.test.ts builds them with it). */
import { describe, expect, it } from 'vitest';
import { asmArgCpu, checkAsm } from '../src/asm-project';

/** the bytes the check makes of `lines` (after * = $1000), and the check */
const tass = (lines: string[], args?: string[]) => {
  const c = checkAsm({ 'main.asm': [' * = $1000', ...lines, ''].join('\n') }, 'main.asm', '64tass', args ? { args } : {});
  return { c, bytes: c.asm.prg ? [...c.asm.prg.subarray(2)] : [] };
};
const ok = (lines: string[], args?: string[]) => { const r = tass(lines, args); expect(r.c.problems).toEqual([]); return r.bytes; };

describe('the 65816', () => {
  it('its addressing modes, as 64tass writes them', () => {
    expect(ok([' .cpu "65816"', ' lda $12', ' lda $1234', ' lda $123456', ' lda $123456,x', ' lda [$12]', ' lda [$12],y', ' lda 3,s', ' lda (#3,s),y', ' lda ($12)'])).toEqual([
      0xa5, 0x12, 0xad, 0x34, 0x12, 0xaf, 0x56, 0x34, 0x12, 0xbf, 0x56, 0x34, 0x12, 0xa7, 0x12, 0xb7, 0x12, 0xa3, 3, 0xb3, 3, 0xb2, 0x12]);
    expect(ok([' .cpu "65816"', ' jml $123456', ' jsl $1234', ' jmp [$1234]', ' jsr ($1234,x)', ' mvn #1,#2', ' mvp 3,4', ' pea #$1234', ' pea $1234', ' pei ($12)', ' cop #5', ' wdm #6'])).toEqual([
      0x5c, 0x56, 0x34, 0x12, 0x22, 0x34, 0x12, 0, 0xdc, 0x34, 0x12, 0xfc, 0x34, 0x12, 0x54, 2, 1, 0x44, 4, 3, 0xf4, 0x34, 0x12, 0xf4, 0x34, 0x12, 0xd4, 0x12, 2, 5, 0x42, 6]);
    // per and brl: 16 bits back to $1000
    expect(ok(['l .cpu "65816"', ' per l', ' brl l'])).toEqual([0x62, 0xfd, 0xff, 0x82, 0xfa, 0xff]);
    expect(ok([' .cpu "65816"', ' phb', ' plb', ' phd', ' pld', ' phk', ' rtl', ' tcd', ' tdc', ' tcs', ' tsc', ' txy', ' tyx', ' xba', ' xce', ' wai', ' stp', ' swa', ' tad'])).toEqual([
      0x8b, 0xab, 0x0b, 0x2b, 0x4b, 0x6b, 0x5b, 0x7b, 0x1b, 0x3b, 0x9b, 0xbb, 0xeb, 0xfb, 0xcb, 0xdb, 0xeb, 0x5b]);
  });
  it('@b, @w and @l, the direct page and the data bank', () => {
    expect(ok([' .cpu "65816"', ' lda @l $1234', ' lda @w $12', ' .dpage $400', ' lda $456', ' lda $12', ' .dpage 0', ' .databank $10', ' lda $101234', ' lda $1234'])).toEqual([
      0xaf, 0x34, 0x12, 0, 0xad, 0x12, 0, 0xa5, 0x56, 0xad, 0x12, 0, 0xad, 0x34, 0x12, 0xaf, 0x34, 0x12, 0]);
    // n,d n,b n,k: as they are
    expect(ok([' .cpu "65816"', ' lda #$1234,b', ' lda #$12,d', ' jsr #$1234,k', ' lda (#$12,d),y', ' lda [#$12,d]'])).toEqual([0xad, 0x34, 0x12, 0xa5, 0x12, 0x20, 0x34, 0x12, 0xb1, 0x12, 0xa7, 0x12]);
  });
  it('the immediates 16 bits with .al and .xl, or as REP and SEP set them with .autsiz', () => {
    expect(ok([' .cpu "65816"', ' .al', ' .xl', ' lda #$1234', ' ldx #$5678', ' rep #$30', ' .as', ' lda #$12', ' lda @w #$12', ' sep #$20', ' cpx #$100'])).toEqual([
      0xa9, 0x34, 0x12, 0xa2, 0x78, 0x56, 0xc2, 0x30, 0xa9, 0x12, 0xa9, 0x12, 0, 0xe2, 0x20, 0xe0, 0, 1]);
    expect(ok([' .cpu "65816"', ' .autsiz', ' rep #$30', ' lda #$1234', ' sep #$20', ' lda #$12', ' ldx #$1234', ' .mansiz', ' rep #$20', ' lda #$12'])).toEqual([
      0xc2, 0x30, 0xa9, 0x34, 0x12, 0xe2, 0x20, 0xa9, 0x12, 0xa2, 0x34, 0x12, 0xc2, 0x20, 0xa9, 0x12]);
  });
  it('a bank other than 0: .logical, the bank byte, and the PRG at the address in 64 KiB', () => {
    expect(ok([' .cpu "65816"', ' .logical $018000', 'a lda a', ' jmp a', ' .here', ' lda #`a', ' lda #>a'])).toEqual([0xaf, 0, 0x80, 1, 0x4c, 0, 0x80, 0xa9, 1, 0xa9, 0x80]);
    const c = checkAsm({ 'main.asm': ' .cpu "65816"\n * = $018000\n lda #1\n' }, 'main.asm', '64tass');
    expect([...c.asm.prg!]).toEqual([0, 0x80, 0xa9, 1]);
  });
  it('says what 64tass says no to', () => {
    const msg = (lines: string[]) => tass([' .cpu "65816"', ...lines]).c.problems.map(p => p.msg);
    expect(msg([' jmp $123456'])).toEqual(["address in different program bank '$123456'"]);
    expect(msg([' jmp @l $1234'])).toEqual(["no long sized addressing mode for opcode 'jmp'"]);
    expect(msg([' lda @b $1234'])).toEqual(["not a direct page address '$1234'"]);
    expect(msg([' lda $123456,y'])).toEqual(["not a data bank address '$123456'"]);
    expect(msg([' .as', ' lda #$1234'])).toEqual(["too large for a 8 bit unsigned integer '4660'"]);
  });
  it('a mnemonic only it has at the start of a line is the instruction; on the 6502 a label', () => {
    expect(ok([' .cpu "65816"', 'phx', 'xba'])).toEqual([0xda, 0xeb]);
    const c = checkAsm({ 'main.asm': ' * = $1000\nphx\n .word phx\n' }, 'main.asm', '64tass');
    expect(c.problems).toEqual([]);
    expect([...c.asm.prg!.subarray(2)]).toEqual([0, 0x10]);
  });
  it('the arguments\' -x or --m65816: the 65816 from the first line; the check says it does not run on a C64', () => {
    expect(asmArgCpu(['-Wall', '--m65816'])).toBe('65816');
    expect(asmArgCpu(['-x', '-c'])).toBe('65c02');
    expect(asmArgCpu(['-a'])).toBe(null);
    const { c, bytes } = tass([' xba', ' lda [$12]'], ['-x']);
    expect(c.problems).toEqual([]);
    expect(bytes).toEqual([0xeb, 0xa7, 0x12]);
    expect(c.cpus).toEqual(['65816']);
    expect(c.warnings[0].msg).toMatch(/SuperCPU/);
    // a processor 64tass does not know is an error, as in 64tass; --m4510 is the 4510
    expect(tass([' .cpu "z80"', ' nop']).c.problems[0].msg).toMatch(/unknown processor 'z80'/);
    expect(tass([' map'], ['--m4510']).bytes).toEqual([0x5c]);
  });
});

describe('the 65DTV02, the 65CE02, the 4510 and the 65EL02', () => {
  it('the 65DTV02 (the C64 DTV): BRA, SAC, SIR, the undocumented opcodes it has', () => {
    expect(ok([' .cpu "65dtv02"', 'l bra l', ' sac #1', ' sir #2', ' lax $12', ' dcm $12'])).toEqual([0x12, 0xfe, 0x32, 1, 0x42, 2, 0xa7, 0x12, 0xc7, 0x12]);
    expect(tass([' .cpu "65dtv02"', ' anc #1']).c.ok).toBe(false);
  });
  it('the 65CE02 and the 4510: the Z register, (dp),z, n,s, 16 bit branches as far as they must go, words, MAP', () => {
    expect(ok([' .cpu "65ce02"', ' bne near', ' bne far', 'near nop', ' .fill 200', 'far rts', ' bsr near', ' lda (#$12,s),y', ' lda ($12),z', ' ldz #1', ' inw $12', ' phw #$1234', ' rtn #2']).filter((_, i) => i < 6 || i > 205)).toEqual([
      0xd0, 0x03, 0xd3, 0xca, 0x00, 0xea, 0x60, 0x63, 0x34, 0xff, 0xe2, 0x12, 0xb2, 0x12, 0xa3, 1, 0xe3, 0x12, 0xf4, 0x34, 0x12, 0x62, 2]);
    expect(ok([' .cpu "4510"', ' map', ' eom', ' neg', ' asr a', ' taz'])).toEqual([0x5c, 0xea, 0x42, 0x43, 0x4b]);
    // (dp) is (dp),z there
    expect(tass([' .cpu "65ce02"', ' lda ($12)']).c.ok).toBe(false);
  });
  it('the 65EL02: the return stack, MUL and DIV, 16 bit immediates as on the 65816', () => {
    expect(ok([' .cpu "65el02"', ' lda #$12,r', ' sta (#3,r),y', ' mul $12', ' div $1234,x', ' .al', ' lda #$1234', ' rhi', ' rer *'])).toEqual([
      0xa7, 0x12, 0x97, 3, 0x0f, 0x12, 0x7f, 0x34, 0x12, 0xa9, 0x34, 0x12, 0x0b, 0x82, 0xfe]);
  });
});

describe('the 65C02 family and the 6502', () => {
  it('the 65C02', () => {
    expect(ok([' .cpu "65c02"', ' bra l', 'l stz $12', ' phx', ' lda ($12)', ' bit #1', ' inc a', ' jmp ($1234,x)', ' tsb $12', ' ina', ' dea', ' clr $1234,x'])).toEqual([
      0x80, 0, 0x64, 0x12, 0xda, 0xb2, 0x12, 0x89, 1, 0x1a, 0x7c, 0x34, 0x12, 0x04, 0x12, 0x1a, 0x3a, 0x9e, 0x34, 0x12]);
    expect(tass([' .cpu "65c02"', ' lda [$12]']).c.ok).toBe(false);
  });
  it('the W65C02: Rockwell\'s bit instructions, WAI and STP', () => {
    expect(ok([' .cpu "w65c02"', 'l rmb 1,$12', ' smb 7,$12', ' bbr 3,$12,l', ' bbs 5,$12,m', 'm wai', ' stp', ' nop $12'])).toEqual([
      0x17, 0x12, 0xf7, 0x12, 0x3f, 0x12, 0xf9, 0xdf, 0x12, 0x00, 0xcb, 0xdb, 0x44, 0x12]);
  });
  it('the 6502: .dpage too, brk #, the aliases; a parenthesised expression is not indirect', () => {
    expect(ok([' .dpage $400', ' lda $456', ' lda $12', ' lda ($412),y', ' .dpage 0', ' brk #$12', ' lda ($10)+2', ' jmp ($1000)+2', ' shl', ' cpa #1'])).toEqual([
      0xa5, 0x56, 0xad, 0x12, 0, 0xb1, 0x12, 0x00, 0x12, 0xa5, 0x12, 0x4c, 0x02, 0x10, 0x0a, 0xc9, 1]);
    expect(tass([' lda ($12)']).c.problems[0].msg).toMatch(/no dpi addressing mode/);
    expect(tass([' stz $12']).c.ok).toBe(false);
    expect(tass([' lax $12']).c.problems[0].msg).toMatch(/needs .cpu "6502i"/);
  });
});

describe('random() and .seed', () => {
  it('draw what 64tass draws: its xorshift128+, started again each pass', () => {
    expect(ok(['.byte random([256] x 8)', '.byte random([10] x 4)'])).toEqual([0x2d, 0x15, 0x21, 0x2d, 0xb0, 0x11, 0x06, 0x08, 5, 4, 6, 9]);
    expect(ok(['.seed 1234', '.byte random([256] x 4)', '.seed $123456789abcdef0123456789', '.byte random([256] x 4)'])).toEqual([0x5b, 0x8b, 0x69, 0x7b, 0xfa, 0x02, 0x23, 0x08]);
    // a step, a float, a range that is not a power of two (rejection over 32 bits)
    expect(ok(['.byte random(10, 0, -3)', '.byte random() * 256', '.byte random(100000) & 255'])).toHaveLength(3);
    expect(tass(['.byte random(0)']).c.ok).toBe(false);
    expect(tass(['.byte random(1, 5, 0)']).c.ok).toBe(false);
  });
  it('a label after a forward reference keeps its value: each pass draws the same (64tass: 8)', () => {
    const { c, bytes } = tass([' lda later', 'x = random(100)', '.byte x', 'later = $1234']);
    expect(c.problems).toEqual([]);
    expect(bytes).toEqual([0xad, 0x34, 0x12, 8]);
  });
});

describe('the operators x and `', () => {
  it('repeat a list, a string or bytes; ` is the bank byte', () => {
    expect(ok(['.byte [1,2] x 1+1', '.byte [1] x 2 * 2', '.byte [2] x 2 ** 2', '.text "ab" x 2', '.byte [5] x 0', '.byte `$123456, `$123456+$10000'])).toEqual([
      2, 3, 2, 2, 2, 2, 2, 2, 0x41, 0x42, 0x41, 0x42, 0x12, 0x13]);
  });
});
