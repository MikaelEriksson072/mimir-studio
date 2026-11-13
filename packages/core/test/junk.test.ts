/* Junk (spec 11.7): bytes the user leaves out of everything. The analysis takes them as not loaded, so the listing,
 * the source and the output do not have them, and the round trip compares only the rest. */
import { describe, expect, it } from 'vitest';
import { addJunk, analyze, assemble, comparePrg, deserializeProject, findBlock, junkAt, junkIn, makeDemo, parsePrg, removeJunk, render, serializeProject, verify, createProject, type ProjectInput } from '../src';

const demoInput = (): ProjectInput => {
  const d = makeDemo();
  return { name: 'raster-demo', files: [parsePrg(d.name, d.prg)], overrides: [], labels: {}, comments: {}, settings: {} };
};
const roundTrip = (p: ProjectInput) => { const A = analyze(p), R = render(A, p); return { A, R, V: verify(A, R) }; };
const failure = (V: ReturnType<typeof verify>) => JSON.stringify(V.results.map(r => ({ errors: r.errors.slice(0, 5), diffs: r.diffs.slice(0, 5) })));

describe('junk areas', () => {
  it('join the areas they overlap or touch, and keep the list sorted', () => {
    let j = addJunk(undefined, 0x3000, 0x3100);
    j = addJunk(j, 0x1000, 0x1010);
    expect(j).toEqual([{ start: 0x1000, end: 0x1010 }, { start: 0x3000, end: 0x3100 }]);
    // touching at either end, and over two at once
    expect(addJunk(j, 0x1010, 0x1020)).toEqual([{ start: 0x1000, end: 0x1020 }, { start: 0x3000, end: 0x3100 }]);
    expect(addJunk(j, 0x0ff0, 0x3001)).toEqual([{ start: 0x0ff0, end: 0x3100 }]);
    expect(removeJunk(j, 0x1000)).toEqual([{ start: 0x3000, end: 0x3100 }]);
    expect(junkAt(j, 0x30ff)).toEqual({ start: 0x3000, end: 0x3100 });
    expect(junkAt(j, 0x3100)).toBeUndefined();
    expect(junkIn(j, 0x1008, 0x3080)).toEqual([{ start: 0x1008, end: 0x1010 }, { start: 0x3000, end: 0x3080 }]);
  });
});

describe('junk in the middle of a program', () => {
  const base = demoInput();
  const p = { ...base, junk: [{ start: 0x09b5, end: 0x0ab5 }] };
  const { A, R, V } = roundTrip(p);
  const src = R.files['raster-demo.asm'] as string;

  it('is not loaded for the analysis: no block, nothing traced or named there', () => {
    for (let a = 0x09b5; a < 0x0ab5; a++) expect(A.owner[a]).toBe(-1);
    expect(findBlock(A.blocks, 0x09b5)).toBeNull();
    expect(findBlock(A.blocks, 0x0ab5)?.start).toBe(0x0ab5);
    expect([...A.labels.keys()].some(a => a >= 0x09b5 && a < 0x0ab5)).toBe(false);
    expect(A.log.some(l => l.msg === '$09b5-$0ab4 is junk: left out (256 bytes)')).toBe(true);
  });

  it('is not in the listing or the source, not even under #if: code that reads it writes the bare address', () => {
    expect(R.lines.some(l => l.k !== 'file' && 'n' in l && l.n > 0 && l.a >= 0x09b5 && l.a < 0x0ab5)).toBe(false);
    expect(src).not.toContain('sine_09b5');
    expect(src).not.toMatch(/#if|#define|INCLUDE_/);
    expect(src).toContain('lda $09b5,x');
    // the block after it starts where it is
    expect(src).toMatch(/\.pc = \$0ab5 "Data"/);
  });

  it('is left out of the output and the round trip, which still verifies', () => {
    expect(V.ok, failure(V)).toBe(true);
    const r = V.results[0];
    expect(r.excluded).toBe(256);
    expect(r.same).toBe(r.total);
    expect(r.total).toBe(12287 - 256);
    // a gap Kick Assembler fills with zeros
    for (let a = 0x09b5; a < 0x0ab5; a++) expect(r.prg![a - 0x0801 + 2]).toBe(0);
    expect(R.excluded).toEqual([{ start: 0x09b5, end: 0x0ab5, file: 0, name: '', junk: true }]);
    // KickAss.jar's output is compared the same way
    expect(comparePrg(base.files[0], r.prg, R.excluded).ok).toBe(true);
  });

  it('keeps the user\'s names and comments on its bytes, for when it is put back', () => {
    const q = { ...p, labels: { 0x09b5: 'wave' }, comments: { 0x09c5: 'peak' } };
    const out = roundTrip(q);
    expect(out.V.ok, failure(out.V)).toBe(true);
    expect(out.R.files['raster-demo.asm']).not.toMatch(/wave|peak/);
    const back = roundTrip({ ...q, junk: removeJunk(q.junk, 0x09b5) });
    expect(back.V.ok, failure(back.V)).toBe(true);
    expect(back.R.files['raster-demo.asm']).toMatch(/^wave:$/m);
    expect(back.V.results[0].prg).toEqual(makeDemo().prg);
  });

  it('cuts a block it covers part of', () => {
    const out = roundTrip({ ...base, junk: [{ start: 0x0a00, end: 0x0a40 }] });
    expect(out.V.ok, failure(out.V)).toBe(true);
    expect(findBlock(out.A.blocks, 0x09ff)?.end).toBe(0x0a00);
    expect(findBlock(out.A.blocks, 0x0a40)?.start).toBe(0x0a40);
    expect(out.R.files['raster-demo.asm']).toMatch(/\.pc = \$0a40 /);
  });
});

describe('junk at the end of a program', () => {
  const p = { ...demoInput(), junk: [{ start: 0x3000, end: 0x3800 }] };
  const { R, V } = roundTrip(p);
  const src = R.files['raster-demo.asm'] as string;

  it('makes the output end before it, and the source says so', () => {
    expect(V.ok, failure(V)).toBe(true);
    const prg = V.results[0].prg!;
    expect(prg.length - 2).toBe(0x3000 - 0x0801);
    expect(src).toContain('// load $0801-$2fff (10239 bytes)');
    // the charset that was there is no file of the export any more
    expect(Object.keys(R.files).sort()).toEqual(['include/c64-hardware.asm', 'music/music_1000.sid', 'raster-demo.asm']);
  });

  it('assembles with the built-in assembler to exactly the bytes before it', () => {
    const asm = assemble(R.files, 'raster-demo.asm');
    expect(asm.errors).toEqual([]);
    expect(asm.prg).toEqual(makeDemo().prg.subarray(0, 2 + 0x3000 - 0x0801));
  });
});

describe('junk at the start of a program', () => {
  it('moves the start of the output', () => {
    const { V, R } = roundTrip({ ...demoInput(), junk: [{ start: 0x0801, end: 0x0810 }] });
    expect(V.ok, failure(V)).toBe(true);
    const prg = V.results[0].prg!;
    expect(prg[0] | (prg[1] << 8)).toBe(0x0810);
    expect(R.files['raster-demo.asm']).toContain('// load $0810-$37ff');
  });
});

describe('junk in the project file', () => {
  it('is saved and read back, and a project without it has none', () => {
    const p = { ...createProject({ files: demoInput().files }), junk: [{ start: 0x09b5, end: 0x0ab5 }] };
    const s = serializeProject(p);
    expect(s.junk).toEqual([{ start: 0x09b5, end: 0x0ab5 }]);
    expect(deserializeProject(JSON.parse(JSON.stringify(s))).junk).toEqual([{ start: 0x09b5, end: 0x0ab5 }]);
    const none = serializeProject(createProject({ files: demoInput().files }));
    expect('junk' in none).toBe(false);
    expect('junk' in deserializeProject(none)).toBe(false);
  });
});
