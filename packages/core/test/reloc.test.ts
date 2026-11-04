/* Relocated blocks (spec 8.1b): bytes the program copies to another address before they run there. The analysis reads
 * them where they run, the source writes them where they are loaded inside .pseudopc, and the round trip is byte for
 * byte. The user's work on the bytes moves with them, a copy loop is found and suggested, a block can be relocated
 * again from where another one runs, and patches in one are written where the file has the bytes. */
import { describe, expect, it } from 'vitest';
import {
  addReloc, analyze, codeWhereLoaded, createProject, deserializeProject, findBlock, loadAddress, loadRange, moveReloc, planPatch, relocAt, relocProblem, removeReloc, render, serializeProject,
  verify, withPatch, type Project, type ProjectInput, type Reloc,
} from '../src';
import { fromSource, relocProgram, RELOC_SRC } from './helpers/programs';

const RELOC: Reloc = { start: 0x1000, end: 0x1011, to: 0x2000 };
const file = relocProgram;
const project = (relocs: Reloc[] = [RELOC]): Project => ({ ...createProject({ files: [file()] }), relocs });
const roundTrip = (p: ProjectInput) => { const A = analyze(p), R = render(A, p), V = verify(A, R); return { A, R, V, src: R.files['moved.asm'] as string }; };
const fails = (V: ReturnType<typeof verify>) => V.results.flatMap(r => [...r.errors.map(e => `${e.line}: ${e.msg}`), ...r.diffs.slice(0, 4).map(d => JSON.stringify(d))]);

describe('relocated blocks', () => {
  it('are read where they run and written where they are loaded, inside .pseudopc, byte for byte', () => {
    const { A, src, V } = roundTrip(project());
    expect(fails(V)).toEqual([]);
    expect(V.ok).toBe(true);
    // the copy reads the loaded bytes and writes where they run; the jump goes to the code there
    expect(src).toMatch(/lda reloc_1000,x/);
    expect(src).toMatch(/sta l_2000,x/);
    expect(src).toMatch(/jmp l_2000/);
    expect(src).toMatch(/^reloc_1000:\n\.pseudopc \$2000 \{/m);
    expect(src).toMatch(/jsr sub_2009/);
    expect(src).toMatch(/lda tbl_200d,x/);
    expect(src).toMatch(/^\}\s+\/\/ end of reloc_1000/m);
    // traced at $2000; where it is loaded it is one block that says where it runs
    expect(A.insLen[0x2000]).toBe(3);
    expect(A.insLen[0x1000]).toBe(0);
    expect(findBlock(A.blocks, 0x1000)).toMatchObject({ type: 'reloc', start: 0x1000, end: 0x1011, user: true, props: { to: 0x2000 } });
    expect(findBlock(A.blocks, 0x2000)).toMatchObject({ type: 'code', file: 0 });
    expect(A.owner[0x2000]).toBe(0);
    expect(A.relocs).toEqual([{ ...RELOC, file: 0 }]);
    expect(loadAddress(A, 0x200d)).toBe(0x100d);
    // where a range is in the built PRG (the Pack view): one piece, or none across the edge of the copy
    expect(loadRange(A, 0x2009, 0x200d)).toEqual({ start: 0x1009, end: 0x100d });
    expect(loadRange(A, 0x0810, 0x0812)).toEqual({ start: 0x0810, end: 0x0812 });
    expect(loadRange(A, 0x200f, 0x2012)).toBeNull();
    expect(relocAt(A, 0x2010)).toMatchObject({ start: 0x1000 });
    // the copy is no code changing itself, and nothing is left to suggest
    expect(A.smc.size).toBe(0);
    expect(A.copies).toEqual([]);
    // no .pc inside the .pseudopc
    const inside = src.slice(src.indexOf('.pseudopc $2000'), src.indexOf('// end of reloc_1000'));
    expect(inside.length).toBeGreaterThan(100);
    expect(inside).not.toMatch(/^\.pc/m);
  });

  it('are found from the copy loop and the jump into where the bytes go', () => {
    const { A } = roundTrip(project([]));
    expect(A.copies).toEqual([{ start: 0x1000, end: 0x1011, to: 0x2000, loop: 0x080f, at: 0x0812, jump: 0x0818 }]);
    expect(A.log.find(l => l.cat === 'reloc')).toMatchObject({ lvl: 'hint', addr: 0x0812, msg: expect.stringMatching(/The loop at \$080f copies \$1000-\$1010 to \$2000-\$2010, and the jmp at \$0818 goes there/) });
    // pages: two pairs a page apart, counted up to 0 again, make one block
    const pages = fromSource('pages.prg', `.pc = $c000\n ldx #$00\nl: lda $c100,x\n sta $0400,x\n lda $c200,x\n sta $0500,x\n inx\n bne l\n jmp $0400\n.pc = $c100\n inc $d020\n jmp $0400\n.fill 506, 0`);
    expect(analyze({ files: [pages] }).copies).toEqual([{ start: 0xc100, end: 0xc300, to: 0x0400, loop: 0xc002, at: 0xc005, jump: 0xc011 }]);
    // a copy of data (nothing jumps there) is not suggested
    const data = fromSource('data.prg', `.pc = $c000\n ldx #$07\nl: lda $c100,x\n sta $0400,x\n dex\n bpl l\n rts\n.pc = $c100\n.byte 1,2,3,4,5,6,7,8`);
    expect(analyze({ files: [data] }).copies).toEqual([]);
    // nor one of what is no routine where the jump goes in: a text copied to the screen, which code jumps into once a
    // routine is there (in real intros the routine is copied there just before the jump), or NOPs
    const text = (bytes: string) => fromSource('text.prg', `.pc = $c000\n ldx #$27\nl: lda $c100,x\n sta $0400,x\n dex\n bpl l\n jmp $0400\n.pc = $c100\n${bytes}`);
    expect(analyze({ files: [text('.fill 40, $20')] }).copies).toEqual([]);
    expect(analyze({ files: [text('.byte $08,$05,$0c,$0c,$0f,$2c,$17,$0f,$12,$0c,$04\n.fill 29, $20')] }).copies).toEqual([]);
    expect(analyze({ files: [text('.fill 40, $ea')] }).copies).toEqual([]);
    // a loop that copies a few bytes more than its routine, into a subroutine the program calls where it is loaded:
    // that stays out ($c109-$c10c), as the analysis says of any range with such code in it
    const over = fromSource('over.prg', `.pc = $c000\n ldx #$0f\nl: lda $c100,x\n sta $0340,x\n dex\n bpl l\n jsr $c109\n jmp $0340\n.pc = $c100\n inc $d020\n inc $d021\n jmp $0340\n sta $d020\n rts\n.fill 3, 0`);
    const O = analyze({ files: [over] });
    expect(O.copies).toMatchObject([{ start: 0xc100, end: 0xc109, to: 0x0340 }]);
    expect(codeWhereLoaded(O, 0xc100, 0xc110)).toEqual([{ start: 0xc109, end: 0xc10d }]);
    // of two copies to the same place, the one the jump follows
    const two = fromSource('two.prg', `.pc = $c000\n ldx #$0f\nt: lda $c180,x\n sta $0400,x\n dex\n bpl t\n ldx #$0f\nl: lda $c100,x\n sta $0400,x\n dex\n bpl l\n jmp $0400\n.pc = $c100\n inc $d020\n jmp $0400\n.fill 10, 0\n.pc = $c180\n lda #$01\n sta $d021\n jmp $0400\n.fill 8, 0`);
    expect(analyze({ files: [two] }).copies.map(c => c.start)).toEqual([0xc100]);
  });

  it('take a bookmark\'s area along with its first byte, cut where the block ends; one that runs into it ends there', () => {
    const p: Project = {
      ...project([]), bookmarks: {
        0x1003: { title: 'inside', text: '', end: 0x100d }, 0x1009: { title: 'past the end', text: '', end: 0x1020 },
        0x0ff8: { title: 'into it', text: '', end: 0x1004 }, 0x0ff0: { title: 'over it', text: '', end: 0x1030 }, 0x100f: { title: 'one line', text: '' },
      },
    };
    addReloc(p, RELOC);
    expect(p.bookmarks).toEqual({
      0x2003: { title: 'inside', text: '', end: 0x200d }, 0x2009: { title: 'past the end', text: '', end: 0x2011 },
      0x0ff8: { title: 'into it', text: '', end: 0x1000 }, 0x0ff0: { title: 'over it', text: '', end: 0x1030 }, 0x200f: { title: 'one line', text: '' },
    });
  });

  it('take the user\'s work on the bytes along, and give it back', () => {
    const p: Project = {
      ...project([]), labels: { 0x1009: 'subroutine', 0x080d: 'main' }, comments: { 0x1003: 'call it' }, blockComments: { 0x1000: 'moved code' },
      notes: { 0x1006: { text: 'again' } }, bookmarks: { 0x100d: { title: 'table', text: '' } }, entries: [0x1009],
      overrides: [{ start: 0x0ff0, end: 0x100d, type: 'code' }, { start: 0x100d, end: 0x1011, type: 'data', props: { fmt: 'dec' } }],
    };
    addReloc(p, RELOC);
    expect(p.labels).toEqual({ 0x2009: 'subroutine', 0x080d: 'main' });
    expect(p.comments).toEqual({ 0x2003: 'call it' });
    expect(p.blockComments).toEqual({ 0x2000: 'moved code' });
    expect(Object.keys(p.notes).map(Number)).toEqual([0x2006]);
    expect(Object.keys(p.bookmarks).map(Number)).toEqual([0x200d]);
    expect(p.entries).toEqual([0x2009]);
    // a mark that starts before the block keeps its part outside it
    expect(p.overrides).toEqual([{ start: 0x0ff0, end: 0x1000, type: 'code' }, { start: 0x2000, end: 0x200d, type: 'code' }, { start: 0x200d, end: 0x2011, type: 'data', props: { fmt: 'dec' } }]);
    const { src, V } = roundTrip(p);
    expect(V.ok).toBe(true);
    // marked as code by the user, where it runs now: code_2000
    expect(src).toMatch(/\/\/ moved code\ncode_2000:\n/);
    expect(src).toMatch(/\/\/ again\n\s+jmp code_2000/);
    expect(src).toMatch(/^subroutine:$/m);
    expect(src).toMatch(/jsr subroutine\s+\/\/ call it/);
    expect(src).toMatch(/\.byte 1, 2, 3, 4/);
    // somewhere else, and back to where it is loaded
    moveReloc(p, 0x1000, 0xc000);
    expect(p.relocs).toEqual([{ ...RELOC, to: 0xc000 }]);
    expect(p.labels).toEqual({ 0xc009: 'subroutine', 0x080d: 'main' });
    expect(roundTrip(p).src).toMatch(/\.pseudopc \$c000 \{/);
    removeReloc(p, 0x1000);
    expect(p.relocs).toEqual([]);
    expect(p.labels).toEqual({ 0x1009: 'subroutine', 0x080d: 'main' });
    expect(p.comments).toEqual({ 0x1003: 'call it' });
  });

  it('say what is in the way', () => {
    const { A } = roundTrip(project([]));
    expect(relocProblem(A, 0x1000, 0x1011, 0x2000)).toBeNull();
    expect(relocProblem(A, 0x1000, 0x1011, 0x0900)).toMatch(/\$0900 is loaded from moved\.prg: a relocated block runs where nothing is loaded/);
    expect(relocProblem(A, 0x1000, 0x1011, 0x1008)).toMatch(/cover its own bytes/);
    expect(relocProblem(A, 0x1000, 0x1020, 0x2000)).toMatch(/runs past the end of the file at \$1011/);
    expect(relocProblem(A, 0x1000, 0x1011, 0xfff8)).toMatch(/would run past \$ffff/);
    expect(relocProblem(A, 0x1000, 0x1011, 0x2000, null, [{ start: 0x0fff, bytes: new Uint8Array(3) }])).toMatch(/A patch .* crosses the edge/);
    const B = roundTrip(project()).A;
    expect(relocProblem(B, 0x1004, 0x1008, 0x3000)).toMatch(/where the relocated block \$1000-\$1010 is loaded: relocate the bytes where they run, at \$2004/);
    expect(relocProblem(B, 0x0810, 0x0812, 0x2004)).toMatch(/\$2004 is where the relocated block \$1000-\$1010 runs/);
    // moving it: its own copy is not in the way
    expect(relocProblem(B, 0x1000, 0x1011, 0x2008, RELOC)).toBeNull();
    // the analysis says why one is not placed
    expect(analyze({ files: [file()], relocs: [{ start: 0x1000, end: 0x1011, to: 0x0900 }] }).log.find(l => l.cat === 'reloc')).toMatchObject({ lvl: 'warn', msg: expect.stringMatching(/is not placed: \$0900, where it would run, is loaded from moved\.prg/) });
  });

  it('can be relocated again from where another one runs, inside its .pseudopc', () => {
    // $2009-$200c (sub) runs at $c000 too: a .pseudopc inside the .pseudopc
    const p = project([RELOC, { start: 0x2009, end: 0x200d, to: 0xc000 }]);
    const { A, src, V } = roundTrip(p);
    expect(fails(V)).toEqual([]);
    expect(A.relocs.map(r => r.file)).toEqual([0, 0]);
    expect(loadAddress(A, 0xc002)).toBe(0x100b);
    expect(A.insLen[0xc000]).toBe(0); // nothing calls it there
    // Kick Assembler cannot nest .pseudopc: the outer one pauses, and goes on after the inner one
    expect(src).toMatch(/^\.pseudopc \$2000 \{[\s\S]*^\}\s+\/\/ reloc_1000 goes on after reloc_2009\n[\s\S]*^\.label reloc_2009 = \$2009\n\.pseudopc \$c000 \{[\s\S]*^\}\s+\/\/ end of reloc_2009[\s\S]*^\.pseudopc \$200d \{\s+\/\/ reloc_1000 goes on\n[\s\S]*^\}\s+\/\/ end of reloc_1000/m);
    // ending with one relocated from it: the end is a comment (nothing is open)
    const last = roundTrip(project([RELOC, { start: 0x200d, end: 0x2011, to: 0xc000 }]));
    expect(fails(last.V)).toEqual([]);
    expect(last.src).toMatch(/^\}\s+\/\/ end of reloc_200d, which runs at \$c000\n\n\/\/ end of reloc_1000, which runs at \$2000$/m);
  });

  it('take patches, written where the file has the bytes', () => {
    const p = project();
    const { A, R } = roundTrip(p);
    const r = planPatch(A, R, p, { name: 'red', start: 0x2000, end: 0x2003, source: '  dec $d020', fill: 'nop', over: false });
    if ('error' in r) throw new Error(r.error);
    expect(r.patch).toMatchObject({ start: 0x2000, at: 0x1000 });
    const q = { ...p, ...withPatch(p, r.patch) };
    expect([...q.files[0].bytes.subarray(0x1000 - 0x0801, 0x1003 - 0x0801)]).toEqual([0xce, 0x20, 0xd0]);
    const t = roundTrip(q);
    expect(fails(t.V)).toEqual([]);
    expect(t.src).toMatch(/dec VIC_BORDER_COLOR/);
    // a patch past the end of the block's copy does not fit
    const far = planPatch(A, R, p, { name: 'far', start: 0x200f, end: 0x2011, source: '  jmp $1234', fill: 'nop', over: true });
    expect(far).toMatchObject({ error: expect.stringMatching(/past the end of the file/) });
  });

  it('can be left out of the build or saved as a binary file whole', () => {
    const p = project();
    const out = roundTrip({ ...p, excluded: [0x1000] });
    expect(fails(out.V)).toEqual([]);
    expect(out.src).toMatch(/#if INCLUDE_reloc_1000\nreloc_1000:\n\.pseudopc \$2000 \{/);
    expect(out.src).toMatch(/#else[\s\S]*\.label l_2000 = \$2000[\s\S]*#endif/);
    const bin = roundTrip({ ...p, binary: [0x1000] });
    expect(fails(bin.V)).toEqual([]);
    expect(bin.src).toMatch(/\.import binary "data\/reloc_1000\.bin"/);
    expect(bin.src).toMatch(/\.label l_2000 = \$2000/);
    expect(bin.src).not.toMatch(/\.pseudopc \$/);
  });

  it('the fixture is fixtures/prg/moved-demo.prg, which the e2e tests open', async () => {
    const { readFileSync, writeFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { makePrg } = await import('../src');
    const f = file(), prg = makePrg(f.load, f.bytes);
    const path = join(__dirname, '../../../fixtures/prg/moved-demo.prg');
    if (process.env.WRITE_FIXTURES) writeFileSync(path, prg);
    expect(new Uint8Array(readFileSync(path))).toEqual(prg);
  });

  it('are kept in the project file, with the patches in them', () => {
    const p = project();
    const q = deserializeProject(JSON.parse(JSON.stringify(serializeProject(p))));
    expect(q.relocs).toEqual([RELOC]);
    const old = serializeProject(createProject({ files: [file()] }));
    expect('relocs' in old).toBe(false);
    expect(deserializeProject(old).relocs).toEqual([]);
  });
});
