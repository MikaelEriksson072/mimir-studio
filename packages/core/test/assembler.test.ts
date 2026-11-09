/* The built-in Kick-subset assembler's preprocessor (#define/#undef/#if/#elif/#else/#endif). */
import { describe, expect, it } from 'vitest';
import { assemble } from '../src';

const bytes = (src: string) => { const r = assemble({ 'a.asm': src }, 'a.asm'); expect(r.errors).toEqual([]); return [...r.mem.subarray(0x1000, 0x1000 + r.max - 0x1000 + 1)]; };

describe('text encodings', () => {
  // the bytes KickAss 5.25 writes for these strings (measured with KickAss.jar)
  const enc = (name: string, text: string) => bytes(`.pc = $1000\n.encoding "${name}"\n.text "${text}"`);
  it('match Kick Assembler for mapped and passed-through characters', () => {
    expect(enc('screencode_upper', '@AZ[]az^_`\\{~ 0?')).toEqual([0x00, 0x01, 0x1a, 0x1b, 0x1d, 0x61, 0x7a, 0x5e, 0x5f, 0x60, 0x5c, 0x7b, 0x7e, 0x20, 0x30, 0x3f]);
    expect(enc('screencode_mixed', '@azAZ[]^\\')).toEqual([0x00, 0x01, 0x1a, 0x41, 0x5a, 0x1b, 0x1d, 0x5e, 0x5c]);
    expect(enc('petscii_upper', '@AZaz^')).toEqual([0x40, 0x41, 0x5a, 0x61, 0x7a, 0x5e]);
    expect(enc('petscii_mixed', '@azAZ[{')).toEqual([0x40, 0x41, 0x5a, 0xc1, 0xda, 0x5b, 0x7b]);
  });
});

describe('preprocessor', () => {
  it('assembles only the branches whose condition holds', () => {
    const src = (defs: string) => `${defs}\n.pc = $1000\n#if A\n.byte 1\n#elif B && !C\n.byte 2\n#else\n.byte 3\n#endif\n.byte 9`;
    expect(bytes(src('#define A'))).toEqual([1, 9]);
    expect(bytes(src('#define B'))).toEqual([2, 9]);
    expect(bytes(src('#define B\n#define C'))).toEqual([3, 9]);
    expect(bytes(src('#define A\n#undef A\n#define B'))).toEqual([2, 9]);
    expect(bytes(src('#define C'))).toEqual([3, 9]);
  });

  it('nests, ignores #define in skipped branches, and skips #import there', () => {
    const r = assemble({ 'a.asm': '.pc = $1000\n#if X\n#define Y\n#import "missing.asm"\n#endif\n#if (X || !Y) && true\n.byte 7\n#endif', 'b.asm': '' }, 'a.asm');
    expect(r.errors).toEqual([]);
    expect(r.mem[0x1000]).toBe(7);
  });

  it('reports unbalanced directives', () => {
    expect(assemble({ 'a.asm': '#if A\n.byte 1' }, 'a.asm').errors.map(e => e.msg)).toContain('#if without #endif (1 open)');
    expect(assemble({ 'a.asm': '#endif' }, 'a.asm').errors.map(e => e.msg)).toContain('#endif without #if');
  });
});

/** the source's errors (line: message), and its bytes from $1000 */
const asm = (src: string) => { const r = assemble({ 'a.asm': src }, 'a.asm', { pc: 0x1000 }); return { errors: r.errors.map(e => `${e.line}: ${e.msg}`), bytes: r.max >= 0x1000 ? [...r.mem.subarray(0x1000, r.max + 1)] : [], r }; };

/** What code in patches and scripts uses besides the generated subset; each expectation was measured with KickAss 5.25. */
describe('Kick Assembler beyond the generated subset', () => {
  it('has multi-labels: !name: and !:, referred to backwards and forwards', () => {
    const { errors, bytes } = asm('!loop: dex\n bne !loop-\n beq !+\n nop\n!: inx\n!: bne !-\n jmp !loop-');
    expect(errors).toEqual([]);
    expect(bytes).toEqual([0xca, 0xd0, 0xfd, 0xf0, 0x01, 0xea, 0xe8, 0xd0, 0xfe, 0x4c, 0x00, 0x10]);
    expect(asm(' bne !-').errors).toEqual(['1: Unknown symbol "!-"']);
  });

  it('runs .for, .while and .if, with a scope of its own for each round', () => {
    expect(asm('.for (var i=0; i<3; i++) {\nbar: .byte i\n}\n.var t = 0\n.while (t < 2) { .byte 9\n.eval t++ }').bytes).toEqual([0, 1, 2, 9, 9]);
    const c = '.const C = 5\n.if (C > 3) .byte 1\nelse .byte 2\n.if (C < 3) {\n .byte 3\n} else .if (C == 5) {\n .byte 4\n} else {\n .byte 5\n}';
    expect(asm(c).bytes).toEqual([1, 4]);
    // a label in a block is the block's own; a named block's labels are name.label outside it
    expect(asm('.if (true) {\nfoo: nop\n}\n jmp foo').errors).toEqual(['4: Unknown symbol "foo"']);
    expect(asm('lab: {\n inner: nop\n}\n jmp lab.inner').bytes).toEqual([0xea, 0x4c, 0x00, 0x10]);
    expect(asm('.for (var i=0; i<2; i++) {\n ldx #0\n!: dex\n bne !-\n}').bytes).toEqual([0xa2, 0, 0xca, 0xd0, 0xfd, 0xa2, 0, 0xca, 0xd0, 0xfd]);
    expect(asm('.if (1) nop').errors[0]).toMatch(/^1: Can't get a boolean/);
    // an unknown name in a block's header is an error of its line, said once
    expect(asm(' nop\n.if (NOPE == 1) nop').errors).toEqual(['2: Unknown symbol "NOPE"']);
    expect(asm('.for (var i = 0; i < 3; i++) {\n .byte i + NOPE\n}').errors).toEqual(['2: Unknown symbol "NOPE"']);
    expect(asm('.pseudopc NOPE {\n nop\n}').errors).toEqual(['1: Unknown symbol "NOPE"']);
  });

  it('has variables, .eval and .print', () => {
    const { bytes, r } = asm('.var v = 3\n.eval v = v + 1\n.eval v++\n.eval v *= 2\n .byte v\n.print "v=" + v');
    expect(bytes).toEqual([10]);
    expect(r.prints).toEqual(['v=10']);
    expect(asm('.const K = 1\n.eval K++').errors[0]).toMatch(/only a \.var can change/);
    expect(asm('.error "stop here"').errors).toEqual(['1: stop here']);
  });

  it('evaluates as Kick Assembler does: < and > take what follows, floats, comparisons, ? :, [ ], char literals', () => {
    expect(asm(' lda #<$12ff+1\n lda #>$12ff+1\n .byte <$12ff+1, >$12ff+$101, >$1234 & $ff, >$1234 - $100, 2 + >$1234').bytes).toEqual([0xa9, 0x00, 0xa9, 0x13, 0x00, 0x14, 0x00, 0x11, 0x14]);
    expect(asm(' .byte 1+2*3, (2 | 1) == 3 ? 9 : 8, -7/2 & $ff, 7/2*2, [3+4]*2, round(2.6), floor(2.6), mod(10,3), ~1 & $ff, <(-1)').bytes).toEqual([7, 9, 0xfd, 7, 14, 3, 2, 1, 0xfe, 0xff]);
    expect(asm(' .byte \'A\', \'a\', 1==1 ? 1 : 0, 3 < 4 ? 1 : 0, !true ? 1 : 0, "ab".size()').bytes).toEqual([0x41, 0x01, 1, 1, 0, 2]);
    expect(asm(' .byte round(127*sin(toRadians(90)))').bytes).toEqual([127]);
    expect(asm(' .byte 1 == 1').errors[0]).toMatch(/Can't get a number from a value of type boolean/);
  });

  it('takes names from outside that the code\'s own override, and starts where it is told', () => {
    const names = new Map([['table', 0x2000], ['own', 0x3000]]);
    const r = assemble({ 'a.asm': ' lda table\n jmp own\nown: rts' }, 'a.asm', { names, pc: 0xc000 });
    expect(r.errors).toEqual([]);
    expect([...r.mem.subarray(0xc000, 0xc007)]).toEqual([0xad, 0x00, 0x20, 0x4c, 0x06, 0xc0, 0x60]);
    expect(r.first).toBe(0xc000);
  });
});
