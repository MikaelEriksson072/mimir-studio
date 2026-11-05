import { describe, expect, it } from 'vitest';
import { analyze, makeDemo, parsePrg, render, type ListingLine, type ProjectInput } from '@mimir/core';
import { cellAt, cellParts, cellsOf } from '../src/lib/cells';

const demo = (): ProjectInput => {
  const d = makeDemo();
  return { name: 'raster-demo', files: [parsePrg(d.name, d.prg)], overrides: [], labels: {}, comments: {}, settings: {} };
};

describe('the bytes of a data line as cells', () => {
  const p = demo(), A = analyze(p), R = render(A, p);
  const line = (a: number, dir?: string): ListingLine => R.lines.find(l => l.a === a && l.k === 'dat' && (!dir || l.dir === dir))!;

  it('makes each item of a .byte line a byte, with the commas between them', () => {
    const l = line(0x0939, '.byte');
    expect(cellsOf(l)).toEqual(Array.from({ length: 8 }, (_, i) => ({ a: 0x0939 + i, n: 1 })));
    const parts = cellParts(l)!;
    // the cells and the ", " between them spell the operand as the line writes it
    expect(parts.flatMap(x => x.tok.map(t => t.s)).join('')).toBe(l.k === 'dat' ? l.tok.map(t => t.s).join('') : '');
    expect(parts.filter(x => !x.cell).every(x => x.tok[0].s === ', ')).toBe(true);
  });

  it('makes each character of a .text line a byte, the quotes outside them', () => {
    const l = line(0x0949, '.text');
    const cs = cellsOf(l)!;
    expect(cs.length).toBe(l.k === 'dat' ? l.n : -1);
    expect(cs[3]).toEqual({ a: 0x094c, n: 1 });
    const parts = cellParts(l)!;
    // the string, then its RETURN by name: `"MIMIR STUDIO DEMO    " + PET_RETURN`
    expect([parts[0].cell, parts[parts.length - 3].cell, parts[parts.length - 2].cell]).toEqual([null, null, null]);
    expect(parts[parts.length - 1]).toMatchObject({ cell: { a: 0x0949 + cs.length - 1, n: 1 }, tok: [{ t: 'hw', s: 'PET_RETURN' }] });
    expect(parts.map(x => x.tok[0].s).join('')).toBe(l.k === 'dat' ? l.tok.map(t => t.s).join('') : '');
    expect(l.k === 'dat' && l.tok[0].s).toMatch(/^"MIMIR STUDIO DEMO *"$/);
  });

  it('makes each PETSCII control code by name a byte of the .text line, the " + " between them no byte', () => {
    // $0949: "MIMIR STUDIO DEMO", here CLR, "MI", RETURN and the rest of the bytes
    const bytes = p.files[0].bytes.slice(), at = 0x0949 - p.files[0].load;
    bytes.set([0x93, 0x4d, 0x49, 0x0d], at);
    const q = { ...p, files: [{ ...p.files[0], bytes }], overrides: [{ start: 0x0949, end: 0x0959, type: 'text' as const, props: { enc: 'petscii' as const } }] };
    const R2 = render(analyze(q), q);
    const l = R2.lines.find(x => x.a === 0x0949 && x.k === 'dat')!;
    expect(l.k === 'dat' && l.tok.map(t => t.s).join('')).toBe('PET_CLR + "MI" + PET_RETURN + "R STUDIO DEM"');
    const cs = cellsOf(l)!;
    expect(cs).toEqual(Array.from({ length: l.k === 'dat' ? l.n : 0 }, (_, i) => ({ a: 0x0949 + i, n: 1 })));
    const parts = cellParts(l)!;
    expect(parts.map(x => x.tok.map(t => t.s).join('')).join('')).toBe(l.k === 'dat' ? l.tok.map(t => t.s).join('') : '');
    expect(parts[0]).toEqual({ cell: { a: 0x0949, n: 1 }, tok: [expect.objectContaining({ t: 'hw', s: 'PET_CLR' })] });
    expect(cellAt(l, 0x094c)?.a).toBe(0x094c);
  });

  it('makes each item of a .word line two bytes', () => {
    const q = { ...p, overrides: [{ start: 0x0939, end: 0x0941, type: 'words' as const, props: { fmt: 'hex' as const, row: 4 } }] };
    const R2 = render(analyze(q), q);
    const l = R2.lines.find(x => x.a === 0x0939 && x.k === 'dat')!;
    expect(cellsOf(l)).toEqual([0, 2, 4, 6].map(i => ({ a: 0x0939 + i, n: 2 })));
    expect(cellAt(l, 0x093c)).toEqual({ a: 0x093b, n: 2 });
  });

  it('has none for instructions, headers and labels', () => {
    for (const l of R.lines.filter(x => x.k === 'ins' || x.k === 'hdr' || x.k === 'lbl').slice(0, 50)) expect(cellsOf(l)).toBeNull();
    expect(cellAt(null, 0x0939)).toBeNull();
  });
});
