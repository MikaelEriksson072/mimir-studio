/* The project's macro file (spec 10.8, AsmMacroFile): one file Mimir builds from the macro library of whole files (their
 * macros belong together): those added, those of the macros the code calls, those of the macros they use (each file's
 * own lines with them); the
 * main source imports it once and assembles as with the code written out. Kept in the project file. */
import { describe, expect, it } from 'vitest';
import {
  checkAsm, codeLibCalled, codeLibFileText, codeLibProjectFile, codeLibRest, createProject, deserializeProject, readCodeLibFile, serializeProject, type CodeLibItem,
} from '../src';

const RASTER = `#importonce
.const BORDER = $d020

// =====
// Sets the border's colour
// =====
.macro SetBorder(c) {
    lda #c
    sta BORDER
}

// Waits for a line, then the border
.macro WaitAndSet(line, c) {
!:  lda $d012
    cmp #line
    bne !-
    save()
    SetBorder(c)
}
.macro save() {pha;txa;pha}
.macro Unused() {nop}
`;
const lib: CodeLibItem[] = [
  readCodeLibFile('macro', 'raster.asm', codeLibFileText({ lang: 'kickass', description: '', created: 1, collection: true }, RASTER), { changed: 2 })!,
  readCodeLibFile('macro', 'Black.asm', codeLibFileText({ lang: 'kickass', description: 'Border and background black', created: 1 }, '.macro Black() {\n    lda #0\n    sta $d020\n    sta $d021\n}'), { changed: 2 })!,
  readCodeLibFile('macro', 'Tass.asm', codeLibFileText({ lang: '64tass', description: '', created: 1 }, 'Black   .macro\n        nop\n        .endm'), { changed: 2 })!,
  readCodeLibFile('code', 'Clear.asm', codeLibFileText({ lang: 'kickass', description: '', created: 1 }, '.macro Clear() {\n nop\n}'), { changed: 2 })!,
];

describe('the project\'s macro file', () => {
  it('has whole files: one added, the file of a macro the code calls, all their macros (they belong together), each file\'s own lines', () => {
    const main = '* = $1000\nstart:  WaitAndSet(100, 2)\n        rts\n';
    const b = codeLibProjectFile(lib, { macros: [], collections: ['Black'] }, [main], 'kickass', 'macros.asm');
    expect(b.files).toEqual([{ file: 'Black.asm', name: 'Black', why: 'added', count: 1, own: [] }, { file: 'raster.asm', name: 'raster', why: 'called', count: 4, own: [] }]);
    expect(b.macros.map(({ name, in: i, why, sig }) => ({ name, in: i, why, sig }))).toEqual([
      { name: 'Black', in: 'Black', why: 'added', sig: 'Black()' },
      { name: 'SetBorder', in: 'raster', why: 'called', sig: 'SetBorder(c)' },
      { name: 'WaitAndSet', in: 'raster', why: 'called', sig: 'WaitAndSet(line, c)' },
      { name: 'save', in: 'raster', why: 'called', sig: 'save()' },
      { name: 'Unused', in: 'raster', why: 'called', sig: 'Unused()' },
    ]);
    // what the editor shows of it: each macro's description and definition, the files with their own lines
    expect(b.macros[2]).toMatchObject({ description: 'Waits for a line, then the border', code: expect.stringMatching(/^\.macro WaitAndSet\(line, c\) \{\n/) });
    expect(b.groups).toEqual([{ in: 'Black', rest: '', macros: ['Black'] }, { in: 'raster', rest: '.const BORDER = $d020', macros: ['SetBorder', 'WaitAndSet', 'save', 'Unused'] }]);
    expect(b.missing).toEqual([]);
    expect(b.text).toBe([
      '// macros.asm: built by Mimir from the macro library (Macros and code): the files of macros this project uses, all of',
      '// each file\'s macros (they belong together). Mimir writes it again as they change: change them in the library.',
      '#importonce',
      '',
      '// ---- Black ----',
      '',
      '// Border and background black',
      '.macro Black() {\n    lda #0\n    sta $d020\n    sta $d021\n}',
      '',
      '// ---- raster ----',
      '.const BORDER = $d020',
      '',
      '// =====\n// Sets the border\'s colour\n// =====',
      '.macro SetBorder(c) {\n    lda #c\n    sta BORDER\n}',
      '',
      '// Waits for a line, then the border',
      '.macro WaitAndSet(line, c) {\n!:  lda $d012\n    cmp #line\n    bne !-\n    save()\n    SetBorder(c)\n}',
      '',
      '.macro save() {pha;txa;pha}',
      '',
      '.macro Unused() {nop}',
      ''].join('\n'));
    // imported once, the main source assembles as with the code written out
    const a = checkAsm({ 'main.asm': `#import "macros.asm"\n${main}`, 'macros.asm': b.text }, 'main.asm', 'kickass');
    const inline = checkAsm({ 'main.asm': '* = $1000\nstart:\n!:  lda $d012\n    cmp #100\n    bne !-\n    pha\n    txa\n    pha\n    lda #2\n    sta $d020\n        rts\n' }, 'main.asm', 'kickass');
    expect(a.problems).toEqual([]);
    expect([...a.asm.mem.slice(0x1000, 0x1000 + inline.bytes)]).toEqual([...inline.asm.mem.slice(0x1000, 0x1000 + inline.bytes)]);
    // a macro named (as a suggestion chosen does): its whole file
    expect(codeLibProjectFile(lib, { macros: ['save'], collections: [], called: false }, ['* = $1000'], 'kickass', 'macros.asm').files.map(f => [f.name, f.why, f.count])).toEqual([['raster', 'added', 4]]);
  });

  it('a file that uses another\'s macro brings that file; without the calls only what is added; what the project defines left out, by file', () => {
    const items = [...lib, readCodeLibFile('macro', 'Uses.asm', codeLibFileText({ lang: 'kickass', description: '', created: 1 }, '.macro Flash() {\n    SetBorder(1)\n}'), { changed: 2 })!];
    const u = codeLibProjectFile(items, { macros: [], collections: ['Uses'], called: false }, ['* = $1000'], 'kickass', 'macros.asm');
    expect(u.files.map(f => [f.name, f.why])).toEqual([['raster', 'used'], ['Uses', 'added']]);
    // the project defines one of a file's macros: that one left out, said by its file
    const main = '* = $1000\n        WaitAndSet(100, 2)\n.macro SetBorder(c) {\n    lda #c\n}\n';
    const b = codeLibProjectFile(lib, { macros: ['Nope'], collections: ['RASTER'], called: false }, [main], 'kickass', 'macros.asm');
    expect(b.macros.map(m => [m.name, m.why])).toEqual([['WaitAndSet', 'added'], ['save', 'added'], ['Unused', 'added']]);
    expect(b.files).toEqual([{ file: 'raster.asm', name: 'raster', why: 'added', count: 3, own: ['SetBorder'] }]);
    expect(b.own).toEqual(['SetBorder']);
    expect(b.missing).toEqual(['Nope']);
    expect(b.text).not.toContain('.macro SetBorder');
    // nothing: the lines at its top alone
    const none = codeLibProjectFile(lib, { macros: [], collections: [] }, ['* = $1000\n rts'], 'kickass', 'macros.asm');
    expect(none.macros).toEqual([]);
    expect(none.files).toEqual([]);
    expect(none.text.split('\n')).toHaveLength(4);
    // a 64tass project: its library's files only
    const t = codeLibProjectFile(lib, { macros: [], collections: ['Black'] }, ['        #Black'], '64tass', 'macros.s');
    expect(t.text).toContain('; ---- Tass ----\n\nBlack   .macro\n        nop\n        .endm\n');
    expect(t.text).not.toContain('#importonce');
  });

  it('knows a call from a label, a comment or a string', () => {
    const names = ['save', 'SetBorder', 'Move', 'Black'];
    expect(codeLibCalled(['        jsr save\nsave:   rts\n// SetBorder(1)\n.text "Black()"\n        Move src : dst\n'], names, 'kickass')).toEqual(['Move']);
    expect(codeLibCalled(['loop:   SetBorder(1)\n        lda #Black(2)'], names, 'kickass')).toEqual(['SetBorder', 'Black']);
    expect(codeLibCalled(['        #save\n        .Black\n        jsr SetBorder ; Move()'], names, '64tass')).toEqual(['save', 'Black']);
  });

  it('a collection\'s own lines', () => {
    expect(codeLibRest(RASTER, 'kickass')).toBe('.const BORDER = $d020');
  });

  it('is kept in the project file', () => {
    const p = createProject({ name: 'x', files: [], asm: { lang: 'kickass', main: 'main.asm', macros: { file: 'macros.asm', macros: ['Black', 'Black'], collections: ['raster'], called: true } } });
    expect(p.asm!.macros).toEqual({ file: 'macros.asm', macros: ['Black'], collections: ['raster'] });
    const back = deserializeProject(serializeProject({ ...p, asm: { ...p.asm!, macros: { file: 'src/macros.asm', macros: [], collections: [], called: false } } }));
    expect(back.asm!.macros).toEqual({ file: 'src/macros.asm', macros: [], collections: [], called: false });
  });
});
