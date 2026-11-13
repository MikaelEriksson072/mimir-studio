/* View offsets (spec 10.4): bytes the listing shows at another address than where they are loaded, for manual
 * analysis. The listing names them where they are shown and sends references there to them; the .asm, the output and
 * the round trip are as without the offset. */
import { describe, expect, it } from 'vitest';
import { analyze, lineText, refsShown, removeViewOffset, render, setViewOffset, shiftText, shownAddress, shownLabelName, shownTarget, usableViewOffsets, verify, viewOffsetAt, viewOffsetFit, viewOffsetProblem, deserializeProject, serializeProject, createProject, type ListingLine, type ProjectInput, type RenderResult } from '../src';
import { fromSource, relocProgram } from './helpers/programs';

/** the moved program (8.1b) without relocating it: the code at $1000 is written to run at $2000 */
const movedInput = (extra: Partial<ProjectInput> = {}): ProjectInput => ({
  name: 'moved', files: [relocProgram()], labels: {}, comments: {}, settings: {},
  // the code (the program copies it and jumps to $2000, which the analysis does not follow) and its table
  overrides: [{ start: 0x1000, end: 0x100d, type: 'code' }, { start: 0x100d, end: 0x1011, type: 'data' }],
  ...extra,
});
const OFFSET = { start: 0x1000, end: 0x1011, to: 0x2000 };
const listingText = (R: RenderResult) => R.lines.filter((l): l is Exclude<ListingLine, { k: 'file' | 'gfx' }> => l.k !== 'file' && l.k !== 'gfx').map(l => lineText(l, { indent: 8, commentCol: 40, addrComments: false })).join('\n');

describe('view offset helpers', () => {
  it('say where a byte is shown and which byte is shown at an address', () => {
    const offs = [OFFSET];
    expect(viewOffsetAt(offs, 0x1010)).toBe(OFFSET);
    expect(viewOffsetAt(offs, 0x1011)).toBeUndefined();
    expect(shownAddress(offs, 0x1009)).toBe(0x2009);
    expect(shownAddress(offs, 0x0900)).toBe(0x0900);
    expect(shownTarget(offs, 0x200d)).toEqual({ o: OFFSET, at: 0x100d });
    expect(shownTarget(offs, 0x2011)).toBeUndefined();
    expect(shiftText(OFFSET)).toBe('+$1000');
    expect(shiftText({ start: 0x0900, to: 0x0800 })).toBe('-$0100');
    expect(shownLabelName('sub_1009', 0x1009, 0x2009)).toBe('sub_2009');
    expect(shownLabelName('start', 0x1009, 0x2009)).toBe('start');
    expect(setViewOffset([OFFSET], { start: 0x0900, end: 0x0910, to: 0xc000 }).map(o => o.start)).toEqual([0x0900, 0x1000]);
    expect(setViewOffset([OFFSET], { ...OFFSET, to: 0x3000 })).toEqual([{ ...OFFSET, to: 0x3000 }]);
    expect(removeViewOffset([OFFSET], 0x1000)).toEqual([]);
  });

  it('refuse what cannot be shown: not loaded, over itself, past $ffff, over another offset, a relocated block', () => {
    const A = analyze(movedInput());
    expect(viewOffsetProblem(A, [], 0x1000, 0x1011, 0x2000)).toBeNull();
    // loaded bytes where they are shown are fine
    expect(viewOffsetProblem(A, [], 0x1000, 0x1011, 0x0810)).toBeNull();
    expect(viewOffsetProblem(A, [], 0x1000, 0x1011, 0x1000)).toMatch(/already/);
    expect(viewOffsetProblem(A, [], 0x1000, 0x1011, 0x1008)).toMatch(/over themselves/);
    expect(viewOffsetProblem(A, [], 0x1000, 0x1011, 0xfff8)).toMatch(/past \$ffff/);
    expect(viewOffsetProblem(A, [], 0x1000, 0x1020, 0x2000)).toMatch(/\$1011 is not loaded/);
    expect(viewOffsetProblem(A, [OFFSET], 0x1008, 0x1010, 0x3000)).toMatch(/shown at \$2000 already/);
    expect(viewOffsetProblem(A, [OFFSET], 0x0810, 0x0818, 0x2008)).toMatch(/shows \$1000-\$1010 already/);
    // moving an offset: its own area is not in the way
    expect(viewOffsetProblem(A, [OFFSET], 0x1000, 0x1011, 0x2008, OFFSET)).toBeNull();
    const Ar = analyze(movedInput({ overrides: [], relocs: [{ start: 0x1000, end: 0x1011, to: 0x2000 }] }));
    expect(viewOffsetProblem(Ar, [], 0x1000, 0x1011, 0x3000)).toMatch(/relocated block/);
    expect(usableViewOffsets(Ar, [{ ...OFFSET, to: 0x3000 }])).toEqual([]);
  });
});

describe('a view offset in the listing', () => {
  const p = movedInput({ viewOffsets: [OFFSET] });
  const A = analyze(p);
  const R = render(A, p, { viewOffsets: true });
  const plain = render(A, p);
  const text = listingText(R);

  it('names the bytes where they are shown, and references there go to them', () => {
    const start = R.labels.get(0x1000)!.name;
    expect(start).toMatch(/_2000$/);
    expect(text).toContain(`${start}:`);
    expect(text).toContain(`sta ${start},x`);
    expect(text).toContain(`jmp ${start}`);
    // a call and a read into the area shown get labels on the bytes they go to
    expect(R.labels.get(0x1009)?.name).toBe('sub_2009');
    expect(text).toContain('jsr sub_2009');
    expect(R.labels.get(0x100d)?.name).toBe('data_200d');
    expect(text).toContain('lda data_200d,x');
    // where the bytes are loaded, their labels do not fit: the copy loop reads the bare address
    expect(text).toContain('lda $1000,x');
    expect(R.viewOffsets).toEqual([OFFSET]);
  });

  it('marks where the bytes shown elsewhere start and end, with the .pc where they are shown', () => {
    expect(text).toContain('==== shown at $2000-$2010 (offset +$1000), only here: the .asm has these 17 bytes at $1000-$1010 ====');
    // they run to the end of the file: no end mark
    expect(text).not.toContain('==== end of the bytes shown');
    expect(text).toMatch(/\.pc = \$2000 "Code"/);
    expect(R.lines.some(l => l.k === 'hdr' && l.text.includes('· shown at $2000-$200c'))).toBe(true);
    // the code only: its end is marked, and the table after it is read where it is loaded
    const q = movedInput({ viewOffsets: [{ start: 0x1000, end: 0x100d, to: 0x2000 }] }), Aq = analyze(q);
    const t = listingText(render(Aq, q, { viewOffsets: true }));
    expect(t).toContain('==== end of the bytes shown at $2000 ====');
    expect(t).toContain('lda $200d,x');
  });

  it('leaves the .asm, the output and the round trip as without the offset', () => {
    expect(R.files).toEqual(plain.files);
    expect(R.fileLines).toEqual(plain.fileLines);
    expect(R.files).toEqual(render(A, movedInput()).files);
    // the names the files have, for the source view and the notes
    expect(R.fileLabels).toEqual(plain.labels);
    expect(plain.fileLabels).toBeUndefined();
    const src = R.files['moved.asm'] as string;
    expect(src).not.toMatch(/_2000|_2009|_200d|shown at/);
    expect(src).toContain('.pc = $1000');
    const V = verify(A, R);
    expect(V.ok).toBe(true);
    // a render without RenderOptions.viewOffsets has none
    expect(plain.viewOffsets).toBeUndefined();
    expect(listingText(plain)).not.toContain('shown at');
  });

  it('says what the references say about the address, and lists those to where a byte is shown', () => {
    // sta $2000,x and jmp $2000 from the copy loop, the jsr, the jmp and the lda inside
    expect(viewOffsetFit(A, 0x1000, 0x1011, 0x2000)).toEqual({ refs: 5, own: 3, jumps: 3, onCode: 3 });
    expect(viewOffsetFit(A, 0x1000, 0x1011, 0x3000).refs).toBe(0);
    expect(refsShown(A, [OFFSET], 0x1000).map(x => x.kind).sort()).toEqual(['jump', 'jump', 'read', 'write']);
    expect(refsShown(A, [], 0x1000)).toEqual(A.xrefs.get(0x1000) ?? []);
  });

  it('keeps the user names where the bytes are, in the listing and in the .asm', () => {
    const q = { ...p, labels: { 0x1009: 'flash' } };
    const Aq = analyze(q), Rq = render(Aq, q, { viewOffsets: true });
    expect(listingText(Rq)).toContain('jsr flash');
    const src = Rq.files['moved.asm'] as string;
    expect(src).toContain('flash:');
    // the .asm has no label where the code runs: the call there is written as it is
    expect(src).toContain('jsr $2009');
    expect(verify(Aq, Rq).ok).toBe(true);
  });

  it('is saved in the project file, and older files have none', () => {
    const proj = { ...createProject({ name: 'moved', files: [relocProgram()] }), viewOffsets: [OFFSET] };
    expect(deserializeProject(JSON.parse(JSON.stringify(serializeProject(proj)))).viewOffsets).toEqual([OFFSET]);
    expect(deserializeProject(JSON.parse(JSON.stringify(serializeProject(createProject({ name: 'moved', files: [relocProgram()] }))))).viewOffsets).toBeUndefined();
  });
});

describe('a view offset over loaded bytes', () => {
  // the code at $1000 is shown where a routine of the program is loaded ($0900): references from elsewhere go to the
  // bytes shown, and the routine loaded there keeps its own
  const src = `
.pc = $0801 "Basic"
.byte $0b,$08,$0a,$00,$9e,$32,$30,$36,$31,$00,$00,$00
.pc = $080d "Code"
start:  jsr $0900
        jsr $0903
        rts
.pc = $0900 "Loaded"
first:  ldx #3
        rts
loop:   dex
        bne loop
        rts
.pc = $1000 "Copied"
        lda #1
        rts
        nop
        rts
`;
  const files = [fromSource('over.prg', src)];
  const p: ProjectInput = { name: 'over', files, labels: {}, comments: {}, settings: {}, overrides: [{ start: 0x1000, end: 0x1005, type: 'code' }], viewOffsets: [{ start: 0x1000, end: 0x1005, to: 0x0900 }] };
  const A = analyze(p);
  const R = render(A, p, { viewOffsets: true });
  const text = listingText(R);

  it('sends references from elsewhere to the bytes shown, and keeps those of the code loaded there', () => {
    expect(viewOffsetProblem(A, [], 0x1000, 0x1005, 0x0900)).toBeNull();
    const a = R.labels.get(0x1000)!.name, b = R.labels.get(0x1003)?.name;
    expect(text).toContain(`jsr ${a}`);
    // the analysis named the routine loaded at $0903 sub_0903 already: the bytes shown there get the loaded address after it
    expect(R.labels.get(0x0903)?.name).toBe('sub_0903');
    expect(b).toBe('sub_0903_1003');
    expect(text).toContain('jsr sub_0903_1003');
    // the routine loaded at $0900 branches to its own loop
    expect(text).toContain('bne sub_0903');
    expect(new Set([...R.labels.values()].map(l => l.name)).size).toBe(R.labels.size);
    expect(verify(A, R).ok).toBe(true);
  });
});
