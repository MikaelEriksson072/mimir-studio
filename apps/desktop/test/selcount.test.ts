import { describe, expect, it } from 'vitest';
import { analyze, makeDemo, parsePrg, render, type ProjectInput } from '@mimir/core';
import { foldLines } from '../src/lib/fold';
import { listingSelCount, selCountText, sourceSelCount } from '../src/lib/selcount';

const demo = (): ProjectInput => {
  const d = makeDemo();
  return { name: 'raster-demo', files: [parsePrg(d.name, d.prg)], overrides: [], labels: {}, comments: {}, settings: {} };
};

describe('the count of a selection’s bytes', () => {
  it('says how many bytes, in decimal and in hex', () => {
    expect(selCountText(17)).toBe('17 bytes ($11)');
    expect(selCountText(1)).toBe('1 byte ($01)');
    expect(selCountText(2048)).toBe('2048 bytes ($0800)');
    expect(selCountText(65536)).toBe('65536 bytes ($10000)');
  });

  const p = demo(), A = analyze(p), R = render(A, p);

  it('counts the listing’s bytes in the selection, and the lines they are on', () => {
    const v = foldLines(R.lines, A.blocks, new Set());
    const c = listingSelCount(v.lineOf, 0x0816, 0x0827)!;
    expect(c.bytes).toBe(17);
    expect(v.lines[c.first].a).toBe(0x0816);
    expect(v.lines[c.last].a).toBe(0x0824);
    // a folded block's header stands for all its bytes
    const code = A.blocks.find(b => b.start === 0x0810)!;
    const f = foldLines(R.lines, A.blocks, new Set([code.start]));
    const cf = listingSelCount(f.lineOf, code.start, code.end)!;
    expect(cf.bytes).toBe(code.end - code.start);
    expect(cf.first).toBe(cf.last);
    expect(f.lines[cf.first].k).toBe('hdr');
  });

  it('leaves out the bytes the listing has no line for (the gap between two files)', () => {
    const lineOf = new Int32Array(0x10000).fill(-1);
    for (let a = 0x1000; a < 0x1010; a++) lineOf[a] = 3;
    for (let a = 0x2000; a < 0x2004; a++) lineOf[a] = 9;
    expect(listingSelCount(lineOf, 0x1008, 0x2002)).toEqual({ bytes: 10, first: 3, last: 9 });
    expect(listingSelCount(lineOf, 0x1800, 0x1900)).toBeNull();
  });

  it('counts the bytes of the lines selected in a source file', () => {
    const lines = R.fileLines['raster-demo.asm'];
    const at = (s: string) => lines.findIndex(l => 'tok' in l && l.tok.map(t => t.s).join('').includes(s)) + 1;
    const basic = at('BasicUpstart2'), fill = at('.fill 3');
    expect(basic).toBeGreaterThan(0);
    expect(fill).toBeGreaterThan(basic);
    // from the BasicUpstart2 line to the end of the .fill line: its 12 bytes and the fill's 3, the header lines between none
    expect(sourceSelCount(lines, [{ startLineNumber: basic, startColumn: 1, endLineNumber: fill, endColumn: 20 }])).toEqual({ bytes: 15, first: basic, last: fill });
    // whole lines selected end at the start of the line after them, which is not taken in
    expect(sourceSelCount(lines, [{ startLineNumber: basic, startColumn: 1, endLineNumber: fill, endColumn: 1 }])).toEqual({ bytes: 12, first: basic, last: fill - 1 });
    // a selection in one line (a word) is no count
    expect(sourceSelCount(lines, [{ startLineNumber: basic, startColumn: 1, endLineNumber: basic, endColumn: 9 }])).toBeNull();
    // lines with no bytes (the file's head) neither
    expect(sourceSelCount(lines, [{ startLineNumber: 1, startColumn: 1, endLineNumber: 3, endColumn: 1 }])).toBeNull();
    // two selections over the same line count it once
    expect(sourceSelCount(lines, [
      { startLineNumber: basic, startColumn: 1, endLineNumber: fill, endColumn: 20 },
      { startLineNumber: fill - 1, startColumn: 1, endLineNumber: fill, endColumn: 20 },
    ])!.bytes).toBe(15);
  });
});
