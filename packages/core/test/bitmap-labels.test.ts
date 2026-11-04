/* Code that draws into a bitmap (The Lab, at $6000) reads and writes addresses all over it. They get no labels of
 * their own there, which would cut its picture in the listing: the code counts from the bitmap's label. */
import { describe, expect, it } from 'vitest';
import { analyze, render, verify, type Override, type ProjectInput } from '../src';
import { fromSource } from './helpers/programs';

const SRC = `
.pc = $1000 "Code"
start:  lda #$3b
        sta $d011
        lda #$18
        sta $d018
        ldx #0
loop:   lda $3f80,x
        sta $2005,x
        sta $2143,x
        sta $2c80,x
        lda $2abc
        sta $3f3f
        inx
        bne loop
        rts
.pc = $2000 "Bitmap"
.fill 8000, (i * 37) & $ff
.pc = $3f80 "Tab"
.fill 128, i
`;
const file = fromSource('lab.prg', SRC);
const project = (p: Partial<ProjectInput> = {}): ProjectInput => ({ name: 'lab', files: [file], overrides: [], labels: {}, comments: {}, settings: {}, ...p });
const operands = (R: ReturnType<typeof render>) => R.lines.filter(l => l.k === 'ins' && l.a >= 0x1000 && l.a < 0x1100).map(l => (l as { tok: { s: string }[] }).tok.map(t => t.s).join(''));

describe('addresses inside a bitmap', () => {
  for (const [what, overrides] of [['the VIC shows', []], ['marked', [{ start: 0x2000, end: 0x3f40, type: 'bitmap' }]]] as [string, Override[]][]) {
    it(`count from its label, which is the only one in it (${what})`, () => {
      for (const gfxBinary of [true, false]) {
        const p = project({ overrides, settings: { gfxBinary } });
        const A = analyze(p), R = render(A, p);
        expect(A.blocks.find(b => b.start === 0x2000)).toMatchObject({ type: 'bitmap', end: 0x3f40 });
        expect([...A.labels.keys()].filter(a => a >= 0x2000 && a < 0x3f40)).toEqual([0x2000]);
        expect(operands(R)).toEqual(expect.arrayContaining(['bitmap_2000+5,x', 'bitmap_2000+323,x', 'bitmap_2000+3200,x', 'bitmap_2000+2748', 'bitmap_2000+7999']));
        // as a binary file again, with nothing inside it to define
        if (gfxBinary) expect(R.lines.some(l => l.k === 'dir' && l.a === 0x2000 && l.n === 8000 && l.tok[0].s === '.import binary')).toBe(true);
        expect(verify(A, R).ok).toBe(true);
      }
    });
  }

  it('keeps a label the user gave an address in it, and counts from that one after it', () => {
    const p = project({ labels: { 0x2140: 'row1' } });
    const A = analyze(p), R = render(A, p);
    expect(operands(R)).toEqual(expect.arrayContaining(['bitmap_2000+5,x', 'row1+3,x', 'row1+2880,x']));
    expect(verify(A, R).ok).toBe(true);
  });

  it('a bitmap marked with fewer rows than the VIC shows ends where the marking does', () => {
    // 16 character rows (the Graphics tab's Height): 5120 bytes, the rest a bitmap of its own as the VIC says
    const p = project({ overrides: [{ start: 0x2000, end: 0x3400, type: 'bitmap' }] });
    const A = analyze(p), R = render(A, p);
    const bm = A.blocks.filter(b => b.type === 'bitmap').map(b => [b.start, b.end, b.user, b.reason]);
    expect(bm).toEqual([[0x2000, 0x3400, true, 'user override'], [0x3400, 0x3f40, false, '$d011 bitmap mode + $d018=$18']]);
    // each is a picture of its own, its code counting from it
    expect(R.lines.filter(l => l.k === 'lbl' && l.a >= 0x2000 && l.a < 0x3f40).map(l => l.k === 'lbl' && l.name)).toEqual(['bitmap_2000', 'bitmap_3400']);
    expect(operands(R)).toEqual(expect.arrayContaining(['bitmap_2000+3200,x', 'bitmap_3400+2879']));
    expect(verify(A, R).ok).toBe(true);
    // the whole bitmap marked again is one block
    expect(analyze(project({ overrides: [...p.overrides!, { start: 0x2000, end: 0x3f40, type: 'bitmap' }] })).blocks.filter(b => b.type === 'bitmap').map(b => [b.start, b.end])).toEqual([[0x2000, 0x3f40]]);
  });

  it('elsewhere a data block still gets a label where code reads it', () => {
    const p = project({ overrides: [{ start: 0x2000, end: 0x3f40, type: 'data' }] });
    const A = analyze(p);
    expect(A.labels.get(0x2143)?.name).toBe('var_2143');
  });
});
