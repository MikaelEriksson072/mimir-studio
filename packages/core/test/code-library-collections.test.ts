/* Collections of the macro library (spec 10.8): a file with several macros (a library a source imports) read as one
 * macro each, described by the comments above it (the lines that only decorate them left out), its colour and when it
 * was made in its mimir-macro line; a macro put in, changed in its place (its comments' decoration kept), taken out,
 * renamed; the macros a macro uses; the macros exported as one file, with and without Mimir's lines. */
import { describe, expect, it } from 'vitest';
import {
  checkAsm, codeLibDecor, codeLibExportText, codeLibFileText, codeLibNeeds, codeLibPlain, codeLibPutSub, codeLibRenameMacro, codeLibSubItems, codeLibSubs, codeLibSubText, codeLibTakeOutSub,
  readCodeLibFile,
} from '../src';

const LIB = `#importonce
.const BORDER = $d020

// =====================================
// Sets the border's colour
// to the colour given
// =====================================
.macro SetBorder(c) {
    lda #c
    sta BORDER
}

// =====================================
// Waits for a raster line, then
// sets the border
//
// (a line of its own after an empty one)
// =====================================
// mimir-macro {"created":"2026-11-20T10:00:00.000Z","color":"teal"}
.macro WaitAndSet(line, c) {
!:  lda $d012
    cmp #line
    bne !-
    save()
    SetBorder(c)
}
.macro save() {pha;txa;pha}
.macro restore() {pla;tax;pla}
`;

describe('a collection\'s macros', () => {
  it('each with the comments above it as its description, its own colour and time, its decoration, its lines', () => {
    const subs = codeLibSubs(LIB, 'kickass');
    expect(subs.map(s => s.name)).toEqual(['SetBorder', 'WaitAndSet', 'save', 'restore']);
    const [set, wait, save, restore] = subs;
    expect(set).toMatchObject({ top: 4, line: 8, end: 11, params: ['c'], description: 'Sets the border\'s colour\nto the colour given', decor: { top: '// =====================================', bottom: '// =====================================' } });
    expect(set.code).toBe('.macro SetBorder(c) {\n    lda #c\n    sta BORDER\n}');
    expect(set.color).toBeUndefined();
    expect(wait).toMatchObject({ top: 13, line: 20, end: 26, description: 'Waits for a raster line, then\nsets the border\n\n(a line of its own after an empty one)', color: 'teal', created: Date.UTC(2026, 10, 20, 10) });
    // (one right under another has no comments: the one above is code)
    expect(save).toMatchObject({ top: 27, line: 27, end: 27, description: '' });
    expect(save.decor).toBeUndefined();
    expect(restore).toMatchObject({ top: 28, line: 28, end: 28 });
    expect(codeLibDecor(subs)).toEqual({ top: '// =====================================', bottom: '// =====================================' });
  });

  it('a file of them is a collection, its macros entries of the lists (their colour and time their own, else the collection\'s)', () => {
    const file = codeLibFileText({ lang: 'kickass', description: 'Raster things', created: Date.UTC(2026, 10, 1), color: 'pink' }, LIB);
    const item = readCodeLibFile('macro', 'raster.asm', file, { changed: Date.UTC(2026, 10, 27) })!;
    expect(item.collection).toBe(true);
    expect(item.description).toBe('Raster things');
    expect(item.macros!.map(m => m.name)).toEqual(['SetBorder', 'WaitAndSet', 'save', 'restore']);
    const entries = codeLibSubItems(item);
    expect(entries[0]).toMatchObject({ name: 'SetBorder', macro: 'SetBorder', in: 'raster', file: 'raster.asm', color: 'pink', created: Date.UTC(2026, 10, 1), lang: 'kickass' });
    expect(entries[1]).toMatchObject({ name: 'WaitAndSet', color: 'teal', created: Date.UTC(2026, 10, 20, 10) });
    // one macro is no collection unless its file says it is one; one put there by hand is described by its comments
    expect(readCodeLibFile('macro', 'one.asm', codeLibFileText({ lang: 'kickass', description: '', created: 1 }, '.macro A() {\n nop\n}'), { changed: 2 })!.collection).toBeUndefined();
    const said = readCodeLibFile('macro', 'one.asm', codeLibFileText({ lang: 'kickass', description: '', created: 1, collection: true }, '.macro A() {\n nop\n}'), { changed: 2 })!;
    expect(said.collection).toBe(true);
    expect(said.macros).toHaveLength(1);
    expect(readCodeLibFile('macro', 'own.asm', '// Burns a raster line\n.macro Burn() {\n  .fill 20, $ea\n}\n', { changed: 2 })!.description).toBe('Burns a raster line');
    // a piece of code is never one
    expect(readCodeLibFile('code', 'raster.asm', file, { changed: 2 })!.collection).toBeUndefined();
  });

  it('a macro put in at the end in the collection\'s style, changed in its place with its decoration, taken out', () => {
    const decor = codeLibDecor(codeLibSubs(LIB, 'kickass'));
    const add = codeLibSubText({ code: '.macro Black() {\n    lda #0\n    sta $d020\n}', description: 'Border black', created: Date.UTC(2026, 10, 27, 9), color: 'blue' }, 'kickass', decor);
    expect(add).toBe('// =====================================\n// Border black\n// =====================================\n// mimir-macro {"created":"2026-11-27T09:00:00.000Z","color":"blue"}\n.macro Black() {\n    lda #0\n    sta $d020\n}');
    const added = codeLibPutSub(LIB, 'kickass', add);
    expect(added.startsWith(LIB.trimEnd() + '\n\n// =====')).toBe(true);
    expect(codeLibSubs(added, 'kickass').at(-1)).toMatchObject({ name: 'Black', description: 'Border black', color: 'blue' });

    // SetBorder changed: a new description and a colour, its decoration as it was, the rest of the file as it was
    const old = codeLibSubs(LIB, 'kickass')[0];
    const changed = codeLibPutSub(LIB, 'kickass', codeLibSubText({ code: old.code, description: 'The border\'s colour', color: 'green' }, 'kickass', old.decor), 'SetBorder');
    expect(changed).toBe(LIB.replace('// Sets the border\'s colour\n// to the colour given\n// =====================================\n', '// The border\'s colour\n// =====================================\n// mimir-macro {"color":"green"}\n'));
    // a description taken away: its comments go, decoration and all
    const bare = codeLibPutSub(LIB, 'kickass', codeLibSubText({ code: old.code, description: '' }, 'kickass', old.decor), 'SetBorder');
    expect(bare).toContain('.const BORDER = $d020\n\n.macro SetBorder(c) {');

    // taken out: its lines and one of the empty runs around it
    const out = codeLibTakeOutSub(LIB, 'kickass', 'SetBorder');
    expect(out).toBe(LIB.replace(/\/\/ =+\n\/\/ Sets[^]*?\n}\n\n/, ''));
    expect(codeLibSubs(out, 'kickass').map(s => s.name)).toEqual(['WaitAndSet', 'save', 'restore']);
    expect(codeLibTakeOutSub(LIB, 'kickass', 'restore').endsWith('.macro save() {pha;txa;pha}\n')).toBe(true);
    expect(codeLibTakeOutSub(LIB, 'kickass', 'Nothing')).toBe(LIB);
  });

  it('a macro renamed in its definition; the macros one uses, and those they use', () => {
    expect(codeLibRenameMacro('.macro SetBorder(c) {\n    lda #c\n}', 'kickass', 'SetBorder', 'Border')).toBe('.macro Border(c) {\n    lda #c\n}');
    expect(codeLibRenameMacro('Wait    .macro line\n        lda $d012\n        .endm', '64tass', 'Wait', 'WaitLine')).toBe('WaitLine    .macro line\n        lda $d012\n        .endm');
    const subs = codeLibSubs(LIB, 'kickass');
    expect(codeLibNeeds(subs, 'WaitAndSet', 'kickass')).toEqual(['SetBorder', 'save']);
    expect(codeLibNeeds(subs, 'SetBorder', 'kickass')).toEqual([]);
    // (a name in a comment or a label of that name is no use of it)
    expect(codeLibNeeds([{ name: 'A', code: '.macro A() {\n  // save() here\nsave: nop\n}' }, { name: 'save', code: '.macro save() {pha}' }], 'A', 'kickass')).toEqual([]);
    const tass = 'Save    .macro\n        pha\n        .endm\nBoth    .macro\n        #Save\n        .endm';
    expect(codeLibNeeds(codeLibSubs(tass, '64tass'), 'Both', '64tass')).toEqual(['Save']);
  });

  it('macros exported as one file: their descriptions as comments; with Mimir\'s lines it reads back as it was', () => {
    const subs = codeLibSubs(LIB, 'kickass');
    const plain = codeLibExportText([subs[1], subs[0]], 'kickass');
    expect(plain).not.toContain('mimir-');
    expect(plain.startsWith('// =====================================\n// Waits for a raster line, then\n')).toBe(true);
    expect(codeLibSubs(plain, 'kickass').map(s => [s.name, s.description])).toEqual([['WaitAndSet', subs[1].description], ['SetBorder', subs[0].description]]);
    const kept = codeLibExportText(subs, 'kickass', { lang: 'kickass', description: 'Mine', created: Date.UTC(2026, 10, 27) });
    const back = readCodeLibFile('macro', 'x.asm', kept, { changed: 1 })!;
    expect(back.collection).toBe(true);
    expect(back.description).toBe('Mine');
    expect(back.macros!.map(m => [m.name, m.description, m.color ?? null])).toEqual(subs.map(m => [m.name, m.description, m.color ?? null]));
    expect(codeLibPlain(LIB)).toBe(LIB.replace('// mimir-macro {"created":"2026-11-20T10:00:00.000Z","color":"teal"}\n', ''));
  });

  it('(64tass) a collection with ; comments', () => {
    const src = '; ---------------\n; Waits for a line\n; ---------------\nWait    .macro line\n-       lda $d012\n        cmp #\\line\n        bne -\n        .endm\n\n; Black\nBlack   .macro\n        lda #0\n        sta $d020\n        .endm\n';
    const subs = codeLibSubs(src, '64tass');
    expect(subs.map(s => [s.name, s.description, s.top, s.line, s.end])).toEqual([['Wait', 'Waits for a line', 1, 4, 8], ['Black', 'Black', 10, 11, 14]]);
    const t = codeLibSubText({ code: subs[1].code, description: 'Border black', color: 'red' }, '64tass', codeLibDecor(subs));
    expect(t).toBe('; ---------------\n; Border black\n; ---------------\n; mimir-macro {"color":"red"}\nBlack   .macro\n        lda #0\n        sta $d020\n        .endm');
  });

  it('in Mimir\'s check: a collection imported, its macros called, give the bytes the code gave', () => {
    const main = '* = $1000\n        WaitAndSet(100, 2)\n        rts\n#import "Macros/raster.asm"\n';
    const inline = '* = $1000\n!:  lda $d012\n    cmp #100\n    bne !-\n    pha\n    txa\n    pha\n    lda #2\n    sta $d020\n        rts\n';
    const file = codeLibFileText({ lang: 'kickass', description: 'Raster things', created: 1, collection: true }, LIB);
    const a = checkAsm({ 'main.asm': main, 'Macros/raster.asm': file }, 'main.asm', 'kickass'), b = checkAsm({ 'main.asm': inline }, 'main.asm', 'kickass');
    expect(a.problems).toEqual([]);
    expect(a.bytes).toBe(b.bytes);
    expect([...a.asm.mem.slice(0x1000, 0x1000 + b.bytes)]).toEqual([...b.asm.mem.slice(0x1000, 0x1000 + b.bytes)]);
  });
});
