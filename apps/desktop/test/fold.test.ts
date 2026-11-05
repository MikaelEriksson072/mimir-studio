import { describe, expect, it } from 'vitest';
import { analyze, assemble, demoProject, findBlock, lineText, parsePrg, render, type ProjectInput } from '@mimir/core';
import { blockStep, foldLines } from '../src/lib/fold';
import { fileLineNumbers } from '../src/lib/lines';

const p = demoProject();
const A = analyze(p);
const R = render(A, p);

describe('folding a relocated block (8.1b)', () => {
  // $1000-$1010 runs at $2000 ($2009-$200c of it again at $c000): its .pseudopc pauses for the one relocated from it
  const src = `.pc = $0801
.byte $0b,$08,$0a,$00,$9e,$32,$30,$36,$31,$00,$00,$00
.pc = $080d
 jmp $2000
.pc = $1000
.pseudopc $2000 {
m: inc $d020
 jsr s
 jmp m
s: lda t,x
 rts
t: .byte 1,2,3,4
}`;
  const prg = assemble({ 'm.asm': src }, 'm.asm').prg!;
  const q: ProjectInput = { files: [parsePrg('m.prg', prg)], relocs: [{ start: 0x1000, end: 0x1011, to: 0x2000 }, { start: 0x2009, end: 0x200d, to: 0xc000 }] };
  const B = analyze(q), S = render(B, q);

  it('hides its .pseudopc and every block in it, and stands for where they run', () => {
    const v = foldLines(S.lines, B.blocks, new Set([0x1000]), B.mem.length, B.relocs);
    const h = v.lines.findIndex(l => l.k === 'hdr' && l.a === 0x1000);
    expect(v.lines.some(l => l.k === 'dir' && l.reloc)).toBe(false);
    expect(v.lines.some(l => l.a >= 0x2000 && l.a < 0x2011 && l.k !== 'blank')).toBe(false);
    for (const a of [0x1000, 0x2000, 0x2010, 0xc000, 0xc003]) expect(v.lineOf[a], `$${a.toString(16)}`).toBe(h);
    // it is the file's last block: nothing comes after its header
    expect(h).toBe(v.lines.length - 1);
  });

  it('folding a block where it runs ends at the pause of its .pseudopc', () => {
    const code = findBlock(B.blocks, 0x2000)!;
    const v = foldLines(S.lines, B.blocks, new Set([code.start]), B.mem.length, B.relocs);
    expect(v.lines.some(l => l.k === 'dir' && l.reloc === 'pause')).toBe(true);
    expect(v.lines.some(l => l.k === 'dir' && l.reloc === 'open' && l.a === 0x2009)).toBe(true);
  });
});

describe('folding the listing', () => {
  it('shows every line when nothing is folded', () => {
    const v = foldLines(R.lines, A.blocks, new Set());
    expect(v.lines).toEqual(R.lines);
    expect([...v.lineNo]).toEqual([...fileLineNumbers(R.lines)]);
    expect(v.hidden.size).toBe(0);
  });

  it('keeps only the header of a folded block, which then stands for all its bytes', () => {
    const sine = findBlock(A.blocks, 0x09b5)!;
    const v = foldLines(R.lines, A.blocks, new Set([sine.start]));
    const h = v.lines.findIndex(l => l.k === 'hdr' && l.a === sine.start);
    expect(v.hidden.get(h)).toBeGreaterThan(10);
    expect(v.lines.length).toBe(R.lines.length - v.hidden.get(h)!);
    for (let a = sine.start; a < sine.end; a++) expect(v.lineOf[a]).toBe(h);
    // the next block starts right after the header and the blank line
    expect(v.lines[h + 1].k).toBe('blank');
    expect(v.lines[h + 2]).toMatchObject({ k: 'hdr', a: sine.end });
    // line numbers stay those of the .asm file
    const file = (R.files['raster-demo.asm'] as string).split('\n');
    v.lines.forEach((l, i) => { if (l.k !== 'file') expect(file[v.lineNo[i] - 1]).toBe(lineText(l, A.S)); });
  });

  it('folds the empty lines the user inserted in a block with it', () => {
    const sine = findBlock(A.blocks, 0x09b5)!;
    const q = { ...p, blanks: { [sine.start + 8]: 2, [sine.start + 16]: 1 } };
    const Q = render(A, q);
    expect(Q.lines.filter(l => l.k === 'blank' && l.user)).toHaveLength(3);
    const v = foldLines(Q.lines, A.blocks, new Set([sine.start]));
    const h = v.lines.findIndex(l => l.k === 'hdr' && l.a === sine.start);
    expect(v.lines.some(l => l.k === 'blank' && l.user)).toBe(false);
    expect(v.lines[h + 1]).toMatchObject({ k: 'blank' });
    expect(v.lines[h + 2]).toMatchObject({ k: 'hdr', a: sine.end });
    // unfolded, they are lines of the .asm file like the others
    const file = (Q.files['raster-demo.asm'] as string).split('\n'), w = foldLines(Q.lines, A.blocks, new Set());
    w.lines.forEach((l, i) => { if (l.k !== 'file') expect(file[w.lineNo[i] - 1]).toBe(lineText(l, A.S)); });
  });

  it('folds several blocks, and addresses outside them still map to their own lines', () => {
    const starts = A.blocks.filter(b => b.type !== 'code').map(b => b.start);
    const v = foldLines(R.lines, A.blocks, new Set(starts));
    expect(v.hidden.size).toBe(starts.length);
    const code = A.blocks.find(b => b.type === 'code')!;
    const at = v.lineOf[code.start];
    expect(v.lines[at]).toMatchObject({ a: code.start });
    expect(v.lines[at].k).not.toBe('hdr');
  });
});

describe('from block to block (Ctrl+↓ / Ctrl+↑)', () => {
  const hdrs = [3, 10, 20];
  it('goes down to the next block, from the file head to the first', () => {
    expect(blockStep(hdrs, 0, 1, false)).toBe(3);
    expect(blockStep(hdrs, 3, 1, true)).toBe(10);
    expect(blockStep(hdrs, 12, 1, false)).toBe(20);
    expect(blockStep(hdrs, 25, 1, false)).toBe(-1);
    expect(blockStep([], 0, 1, false)).toBe(-1);
  });

  it('goes up to the start of its own block, then to the one before', () => {
    expect(blockStep(hdrs, 14, -1, false)).toBe(10);
    expect(blockStep(hdrs, 11, -1, true)).toBe(3);
    // a folded block: the cursor's line is its header
    expect(blockStep(hdrs, 10, -1, true)).toBe(3);
    expect(blockStep(hdrs, 4, -1, true)).toBe(-1);
    expect(blockStep(hdrs, 1, -1, false)).toBe(-1);
  });

  it('visits every block of the demo, in the order of the listing', () => {
    const h = R.lines.flatMap((l, i) => (l.k === 'hdr' ? [i] : []));
    expect(h.length).toBe(A.blocks.length);
    const seen: number[] = [];
    for (let i = blockStep(h, -1, 1, false); i >= 0; i = blockStep(h, i, 1, true)) seen.push(R.lines[i].a);
    expect(seen).toEqual(A.blocks.map(b => b.start));
  });
});
