/* Editing block boundaries: splitting a block at a byte, moving the bytes from a byte to the block's edge into the
 * neighbouring block, giving a block a new range, and marking bytes inside a line (the rest keeps its type). */
import { describe, expect, it } from 'vitest';
import {
  analyze, findBlock, keepCutTypes, makeDemo, markOverride, moveBlockKeys, moveFrom, parsePrg, render, resizeBlock, splitBlock, verify,
  type AnalysisResult, type Override, type ProjectInput,
} from '../src';
import { fromSource } from './helpers/programs';

const demoInput = (): ProjectInput => {
  const d = makeDemo();
  return { name: 'raster-demo', files: [parsePrg(d.name, d.prg)], overrides: [], labels: {}, comments: {}, settings: {} };
};

/** the user's case: code reached only through a jump the trace cannot follow sits at the end of a data block, before
 *  code the trace found */
const SRC = `
.pc = $1000 "Code"
start:  lda #$00
        jmp later
tab:    .byte $32, $52, $67
real:   ldx #$ff
        jsr $05cd
later:  ldy #$05
        lda $d020
        rts
`;
const progInput = (): ProjectInput => ({ name: 'prog', files: [fromSource('prog.prg', SRC)], overrides: [], labels: {}, comments: {}, settings: {} });
const TAB = 0x1005, REAL = 0x1008, LATER = 0x100d;

const failure = (V: ReturnType<typeof verify>) => V.results.map(r => ({ file: r.file, errors: r.errors.slice(0, 5), diffs: r.diffs.slice(0, 5) }));
/** the analysis with these overrides; it must still assemble to the same bytes */
const withOverrides = (p: ProjectInput, overrides: Override[]) => {
  const q = { ...p, overrides };
  const A = analyze(q), R = render(A, q), V = verify(A, R);
  expect(V.ok, JSON.stringify(failure(V))).toBe(true);
  return { A, R };
};
const spans = (A: AnalysisResult, start: number, end: number) => A.blocks.filter(b => b.end > start && b.start < end).map(b => [b.start, b.end, b.type]);

describe('the user\'s program', () => {
  const p = progInput();
  const A0 = analyze(p);

  it('has the code at $1008 inside the data block before the traced code', () => {
    expect(spans(A0, TAB, LATER + 1)).toEqual([[TAB, LATER, 'data'], [LATER, 0x1013, 'code']]);
  });

  it('moves the bytes from $1008 to the end of the data block into the code after it', () => {
    const m = moveFrom(A0, REAL, 'next');
    if ('error' in m) throw new Error(m.error);
    expect([m.start, m.end, m.into.start, m.rekey]).toEqual([REAL, LATER, LATER, { from: LATER, to: REAL }]);
    expect(m.overrides).toEqual([{ start: REAL, end: 0x1013, type: 'code' }]);
    const { A, R } = withOverrides(p, m.overrides);
    // the jump to `later` does not start a routine: one code block from $1008
    expect(spans(A, TAB, 0x1013)).toEqual([[TAB, REAL, 'data'], [REAL, 0x1013, 'code']]);
    const ins = R.lines.filter(l => l.k === 'ins' && l.a >= REAL && l.a < LATER).map(l => l.k === 'ins' && l.mn.toLowerCase());
    expect(ins).toEqual(['ldx', 'jsr']);
  });

  it('splits the data block at a byte in the middle of its line', () => {
    const s = splitBlock(A0, REAL);
    if ('error' in s) throw new Error(s.error);
    expect(s.overrides).toEqual([{ start: TAB, end: REAL, type: 'data' }, { start: REAL, end: LATER, type: 'data' }]);
    expect(spans(withOverrides(p, s.overrides).A, TAB, LATER)).toEqual([[TAB, REAL, 'data'], [REAL, LATER, 'data']]);
  });

  it('makes one byte in a row of bytes a word, the bytes around it staying bytes', () => {
    const o: Override = { start: REAL, end: REAL + 2, type: 'words' };
    const { A, R } = withOverrides(p, [...keepCutTypes(A0, o.start, o.end), o]);
    expect(spans(A, TAB, LATER)).toEqual([[TAB, REAL, 'data'], [REAL, REAL + 2, 'words'], [REAL + 2, LATER, 'data']]);
    const dat = R.lines.filter(l => l.k === 'dat' && l.a >= TAB && l.a < LATER).map(l => l.k === 'dat' && [l.a, l.dir, l.n]);
    expect(dat).toEqual([[TAB, '.byte', 3], [REAL, '.word', 2], [REAL + 2, '.byte', 3]]);
  });

  it('splits code only between instructions', () => {
    expect(splitBlock(A0, LATER + 1)).toEqual({ error: '$100e is inside the instruction at $100d' });
    const s = splitBlock(A0, LATER + 2);
    if ('error' in s) throw new Error(s.error);
    expect(s.overrides).toEqual([{ start: LATER + 2, end: 0x1013, type: 'code' }]);
    expect(spans(withOverrides(p, s.overrides).A, LATER, 0x1013)).toEqual([[LATER, LATER + 2, 'code'], [LATER + 2, 0x1013, 'code']]);
  });

  it('grows the data block into the code only to the end of an instruction', () => {
    expect(resizeBlock(A0, TAB, TAB, LATER + 1)).toEqual({ error: '$100e is inside the instruction at $100d' });
    const r = resizeBlock(A0, TAB, TAB, LATER + 2);
    if ('error' in r) throw new Error(r.error);
    // the rest of the code starts a routine of its own, as nothing reaches it from its old start
    expect(r.overrides).toEqual([{ start: LATER + 2, end: 0x1013, type: 'code' }, { start: TAB, end: LATER + 2, type: 'data' }]);
    expect(spans(withOverrides(p, r.overrides).A, TAB, 0x1013)).toEqual([[TAB, LATER + 2, 'data'], [LATER + 2, 0x1013, 'code']]);
  });
});

/** a main routine and the two subroutines it calls, one after the other: a code block each */
const SUBS = `
.pc = $1000 "Code"
start:  jsr sub1
        jsr sub2
        rts
sub1:   lda #$01
        sta $d020
        rts
sub2:   lda #$02
        sta $d021
        rts
`;
const SUB1 = 0x1007, SUB2 = 0x100d, SUBS_END = 0x1013;

describe('Auto merge: marking takes in the blocks of that type next to it', () => {
  const p: ProjectInput = { name: 'subs', files: [fromSource('subs.prg', SUBS)], overrides: [], labels: {}, comments: {}, settings: {} };
  const A0 = analyze(p);

  it('has a code block per routine', () => {
    expect(spans(A0, 0x1000, SUBS_END)).toEqual([[0x1000, SUB1, 'code'], [SUB1, SUB2, 'code'], [SUB2, SUBS_END, 'code']]);
  });

  it('merges a code block marked as code with the code blocks before and after it into one block', () => {
    const m = markOverride(A0, SUB1, SUB2, 'code');
    expect([m.prev?.start, m.next?.start]).toEqual([0x1000, SUB2]);
    expect(m.override).toEqual({ start: 0x1000, end: SUBS_END, type: 'code', props: { one: true } });
    const { A, R } = withOverrides(p, [m.override]);
    expect(spans(A, 0x1000, SUBS_END)).toEqual([[0x1000, SUBS_END, 'code']]);
    // the subroutines keep their names and their code
    expect(R.labels.get(SUB1)?.name).toBeTruthy();
    expect(R.lines.filter(l => l.k === 'ins').length).toBe(9);
  });

  it('merges with the one neighbour there is, and not at all when it is off', () => {
    const m = markOverride(A0, 0x1000, SUB1, 'code');
    expect([m.prev, m.next?.start]).toEqual([null, SUB1]);
    expect(spans(withOverrides(p, [m.override]).A, 0x1000, SUBS_END)).toEqual([[0x1000, SUB2, 'code'], [SUB2, SUBS_END, 'code']]);
    const off = markOverride(A0, SUB1, SUB2, 'code', false);
    expect(off).toEqual({ override: { start: SUB1, end: SUB2, type: 'code' }, prev: null, next: null });
  });

  it('keeps merged code one block when it is marked as code again, and when it is split', () => {
    const merged = withOverrides(p, [markOverride(A0, SUB1, SUB2, 'code').override]).A;
    const again = markOverride(merged, 0x1000, SUBS_END, 'code');
    expect(again.override).toEqual({ start: 0x1000, end: SUBS_END, type: 'code', props: { one: true } });
    const s = splitBlock(merged, SUB1);
    if ('error' in s) throw new Error(s.error);
    expect(s.overrides).toEqual([{ start: SUB1, end: SUBS_END, type: 'code', props: { one: true } }]);
    const ov = [markOverride(A0, SUB1, SUB2, 'code').override, ...s.overrides];
    expect(spans(withOverrides(p, ov).A, 0x1000, SUBS_END)).toEqual([[0x1000, SUB1, 'code'], [SUB1, SUBS_END, 'code']]);
  });

  it('does not take in a block of the same type in another file', () => {
    const two = analyze({ name: 't', files: [{ name: 'a.prg', load: 0x1000, bytes: new Uint8Array(16).fill(1) }, { name: 'b.prg', load: 0x1010, bytes: new Uint8Array(16).fill(2) }],
      overrides: [{ start: 0x1000, end: 0x1010, type: 'data' }, { start: 0x1010, end: 0x1020, type: 'data' }] });
    expect(spans(two, 0x1000, 0x1020)).toEqual([[0x1000, 0x1010, 'data'], [0x1010, 0x1020, 'data']]);
    expect(markOverride(two, 0x1000, 0x1010, 'bytes').next).toBeNull();
  });
});

describe('the showcase', () => {
  const p = demoInput();
  const A0 = analyze(p);

  it('merges a text marked as text with the text of that encoding after it', () => {
    const m = markOverride(A0, 0x0949, 0x0960, 'text');
    expect([m.prev, m.next?.start]).toEqual([null, 0x0960]);
    expect(m.override).toEqual({ start: 0x0949, end: 0x0985, type: 'text', props: { enc: 'petscii' } });
    expect(spans(withOverrides(p, [m.override]).A, 0x0939, 0x0985)).toEqual([[0x0939, 0x0949, 'table'], [0x0949, 0x0985, 'text']]);
    // screen codes are another type of text, and bytes are not a table
    expect(markOverride(A0, 0x0949, 0x0960, 'textsc').override).toEqual({ start: 0x0949, end: 0x0960, type: 'text', props: { enc: 'screen' } });
    expect(markOverride(A0, 0x0949, 0x0960, 'bytes').override).toEqual({ start: 0x0949, end: 0x0960, type: 'data' });
  });

  it('merges with the table before it, which gives its kind', () => {
    const m = markOverride(A0, 0x0949, 0x0960, 'table');
    expect(m.override).toEqual({ start: 0x0939, end: 0x0960, type: 'table', props: { sub: 'colors' } });
    const { A } = withOverrides(p, [m.override]);
    expect(findBlock(A.blocks, 0x0950)).toMatchObject({ start: 0x0939, end: 0x0960, type: 'table' });
  });
  // the color table $0939-$0948, then the texts $0949-$095f and $0960-$0984
  it('has the blocks the tests use', () => {
    expect(spans(A0, 0x0939, 0x0985)).toEqual([[0x0939, 0x0949, 'table'], [0x0949, 0x0960, 'text'], [0x0960, 0x0985, 'text']]);
  });

  it('splits a text in two texts', () => {
    const s = splitBlock(A0, 0x0952);
    if ('error' in s) throw new Error(s.error);
    const { A } = withOverrides(p, s.overrides);
    expect(spans(A, 0x0949, 0x0960)).toEqual([[0x0949, 0x0952, 'text'], [0x0952, 0x0960, 'text']]);
    expect(findBlock(A.blocks, 0x0952)?.props.enc).toBe('petscii');
  });

  it('says why a block cannot be split there', () => {
    expect(splitBlock(A0, 0x0949)).toEqual({ error: '$0949 is the start of its block already' });
    expect(splitBlock(A0, 0x0805)).toEqual({ error: 'the BASIC stub is read from its lines' });
  });

  it('moves the start of a block, to a byte inside it, into the block before it', () => {
    const m = moveFrom(A0, 0x0964, 'prev');
    if ('error' in m) throw new Error(m.error);
    expect([m.start, m.end, m.into.start]).toEqual([0x0960, 0x0965, 0x0949]);
    const { A } = withOverrides(p, m.overrides);
    expect(spans(A, 0x0949, 0x0985)).toEqual([[0x0949, 0x0965, 'text'], [0x0965, 0x0985, 'text']]);
  });

  it('keeps the type of the parts of a block a mark inside it leaves', () => {
    expect(keepCutTypes(A0, 0x0950, 0x0952)).toEqual([
      { start: 0x0949, end: 0x0950, type: 'text', props: { enc: 'petscii' } },
      { start: 0x0952, end: 0x0960, type: 'text', props: { enc: 'petscii' } },
    ]);
    // a block the user typed keeps its own override
    const A = analyze({ ...p, overrides: [{ start: 0x0949, end: 0x0960, type: 'text', props: { enc: 'petscii' } }] });
    expect(keepCutTypes(A, 0x0950, 0x0952)).toEqual([]);
  });

  describe('a new range for a block', () => {
    const resized = (start: number, end: number, freed: 'join' | 'own' = 'join') => {
      const r = resizeBlock(A0, 0x0939, start, end, freed);
      if ('error' in r) throw new Error(r.error);
      return { r, A: withOverrides(p, r.overrides).A };
    };

    it('shrinking, gives the bytes at its end to the block after it', () => {
      const { r, A } = resized(0x0939, 0x0945);
      expect(r.gave.map(g => [g.to?.start, g.start, g.end])).toEqual([[0x0949, 0x0945, 0x0949]]);
      expect(r.rekeys).toEqual([{ from: 0x0949, to: 0x0945 }]);
      expect(spans(A, 0x0939, 0x0960)).toEqual([[0x0939, 0x0945, 'table'], [0x0945, 0x0960, 'text']]);
    });

    it('shrinking, or keeps them as a block of their own', () => {
      const { r, A } = resized(0x0939, 0x0945, 'own');
      expect(r.gave.map(g => [g.to, g.start, g.end])).toEqual([[null, 0x0945, 0x0949]]);
      expect(spans(A, 0x0939, 0x0960)).toEqual([[0x0939, 0x0945, 'table'], [0x0945, 0x0949, 'table'], [0x0949, 0x0960, 'text']]);
    });

    it('growing, takes bytes from the block after it, whose rest stays a text', () => {
      const { r, A } = resized(0x0939, 0x0950);
      expect(r.took.map(t => [t.from.start, t.start, t.end])).toEqual([[0x0949, 0x0949, 0x0950]]);
      expect(r.rekeys).toEqual([{ from: 0x0949, to: 0x0950 }]);
      expect(spans(A, 0x0939, 0x0960)).toEqual([[0x0939, 0x0950, 'table'], [0x0950, 0x0960, 'text']]);
      expect(findBlock(A.blocks, 0x0939)?.props.sub).toBe('colors');
    });

    it('growing over a whole block, takes it in', () => {
      const { r, A } = resized(0x0939, 0x0962);
      expect(r.replaced.map(b => b.start)).toEqual([0x0949]);
      expect(spans(A, 0x0939, 0x0985)).toEqual([[0x0939, 0x0962, 'table'], [0x0962, 0x0985, 'text']]);
    });

    it('moves its start both ways', () => {
      const up = resized(0x0935, 0x0949);
      expect(up.r.rekeys).toEqual([{ from: 0x0939, to: 0x0935 }]);
      expect(findBlock(up.A.blocks, 0x0935)).toMatchObject({ start: 0x0935, end: 0x0949, type: 'table' });
      const down = resized(0x093c, 0x0949, 'own');
      expect(spans(down.A, 0x0939, 0x0949)).toEqual([[0x0939, 0x093c, 'table'], [0x093c, 0x0949, 'table']]);
    });

    it('says what is wrong with the range', () => {
      expect(resizeBlock(A0, 0x0939, 0x0939, 0x0949)).toEqual({ error: 'the block is $0939-$0948 already' });
      expect(resizeBlock(A0, 0x0939, 0x0950, 0x0940)).toEqual({ error: 'the end must come after the start' });
      expect(resizeBlock(A0, 0x0939, 0x0a00, 0x0a10)).toEqual({ error: '$0a00-$0a0f does not overlap the block $0939-$0948' });
      expect(resizeBlock(A0, 0x0939, 0x0939, 0x4000)).toMatchObject({ error: expect.stringMatching(/runs past the end of the file at \$/) });
      expect(resizeBlock(A0, 0x0939, 0x0805, 0x0949)).toMatchObject({ error: 'the BASIC stub is read from its lines' });
    });

    it('takes the block comments along with the starts that move', () => {
      const r = resizeBlock(A0, 0x0939, 0x0935, 0x0950);
      if ('error' in r) throw new Error(r.error);
      const keys = { blockComments: { 0x0939: 'colours', 0x0949: 'title' } as Record<number, string>, excluded: [] as number[], binary: [] as number[] };
      for (const k of r.rekeys) moveBlockKeys(keys, k.from, k.to);
      expect(keys.blockComments).toEqual({ 0x0935: 'colours', 0x0950: 'title' });
    });
  });
});
