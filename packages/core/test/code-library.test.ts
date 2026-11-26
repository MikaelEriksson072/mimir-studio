/* The macro and code libraries (spec 10.8): an item as a file (its code under a line that says the rest) read back the
 * same, a file written by hand, the macros a piece of code defines in Kick Assembler and 64tass, code taken from a
 * source and made a macro (assembled by Mimir's own check: the call gives the bytes the code gave), the calls, the
 * alphabetical groups and the search. */
import { describe, expect, it } from 'vitest';
import {
  checkAsm, codeLibCall, codeLibDedent, codeLibFileName, codeLibFileText, codeLibGroups, codeLibHit, codeLibIsMacro, codeLibLetter, codeLibMacroAt, codeLibMacros, codeLibMatches, codeLibOrder,
  codeLibSignature, codeLibStem, codeLibTake, codeLibWrap, definesMacro, guessAsmLang, isCodeLibFileName, macroName, readCodeLibFile, type CodeLibItem,
} from '../src';

const KICK_MACRO = `.macro WaitRaster(line) {
!:      lda $d012
        cmp #line
        bne !-
}`;
const TASS_MACRO = `WaitRaster .macro line
-       lda $d012
        cmp #\\1
        bne -
        .endm`;

describe('an item of the libraries as a file', () => {
  it('is its code under a line that says the rest, and reads back as it was', () => {
    const created = Date.UTC(2026, 10, 26, 20, 14);
    const text = codeLibFileText({ lang: 'kickass', description: 'Waits for a raster line.\nA second line.', color: 'teal', created, from: 'dfml · main.asm:12–16' }, KICK_MACRO);
    const [head, ...code] = text.split('\n');
    expect(head).toBe('// mimir-library {"lang":"kickass","created":"2026-11-26T20:14:00.000Z","color":"teal","description":"Waits for a raster line.\\nA second line.","from":"dfml · main.asm:12–16"}');
    expect(code.join('\n')).toBe(`${KICK_MACRO}\n`);
    expect(readCodeLibFile('macro', 'WaitRaster.asm', text, { changed: created + 1000 })).toEqual({
      kind: 'macro', file: 'WaitRaster.asm', name: 'WaitRaster', code: KICK_MACRO, lang: 'kickass', description: 'Waits for a raster line.\nA second line.', color: 'teal', created, changed: created + 1000, from: 'dfml · main.asm:12–16',
    });
    // 64tass's comment; no colour, no description: not in the line
    const t = codeLibFileText({ lang: '64tass', description: '  ', created }, TASS_MACRO);
    expect(t.split('\n')[0]).toBe('; mimir-library {"lang":"64tass","created":"2026-11-26T20:14:00.000Z"}');
    const back = readCodeLibFile('macro', 'WaitRaster.asm', t.replace(/\n/g, '\r\n'), { changed: created });
    expect(back).toMatchObject({ code: TASS_MACRO, lang: '64tass', description: '', created });
    expect(back).not.toHaveProperty('color');
    expect(back).not.toHaveProperty('own');
  });

  it('reads a file put there by hand: its code alone, the assembler guessed, made when its file was', () => {
    const own = readCodeLibFile('macro', 'irq.s', `${TASS_MACRO}\n\n`, { changed: 2000, born: 1000 });
    expect(own).toMatchObject({ name: 'irq', code: TASS_MACRO, lang: '64tass', created: 1000, changed: 2000, own: true, description: '' });
    expect(readCodeLibFile('code', 'clear screen.asm', '        ldx #0\n!:      sta $0400,x\n        inx\n        bne !-\n', { changed: 5 })).toMatchObject({ lang: 'kickass', created: 5, own: true });
    // what is not as it should be in the line is left out; a line that is no JSON leaves the code
    const odd = readCodeLibFile('code', 'x.asm', '// mimir-library {"lang":"basic","color":"rainbow","created":"soon","description":7}\nnop\n', { changed: 9 });
    expect(odd).toMatchObject({ lang: 'kickass', created: 9, description: '', code: 'nop' });
    expect(odd).not.toHaveProperty('color');
    // (a line not as Mimir writes it stays in the code: it is a comment there)
    expect(readCodeLibFile('code', 'x.asm', '// mimir-library {oops\nnop\n', { changed: 9 })?.code).toBe('// mimir-library {oops\nnop');
    // own colours of the user's as bookmarks have them
    expect(readCodeLibFile('code', 'x.asm', '// mimir-library {"lang":"kickass","color":"#A0B1C2","created":"2026-01-01T00:00:00.000Z"}\nnop', { changed: 9 })?.color).toBe('#a0b1c2');
    // not a file of the libraries
    expect(readCodeLibFile('code', 'notes.txt', 'x', { changed: 1 })).toBeNull();
    expect(readCodeLibFile('code', '../x.asm', 'x', { changed: 1 })).toBeNull();
  });

  it('names files after the items, unique in their folder', () => {
    expect(codeLibFileName('WaitRaster', [])).toBe('WaitRaster.asm');
    expect(codeLibFileName('WaitRaster', ['waitraster.ASM', 'WaitRaster (2).asm'])).toBe('WaitRaster (3).asm');
    expect(codeLibStem('  a/b: c?  ')).toBe('a_b_ c_');
    expect(codeLibStem('...')).toBe('untitled');
    expect(isCodeLibFileName('Clear screen.asm')).toBe(true);
    expect(isCodeLibFileName('irq.s')).toBe(true);
    expect(isCodeLibFileName('.hidden.asm')).toBe(false);
    expect(isCodeLibFileName('a\\b.asm')).toBe(false);
    expect(isCodeLibFileName('readme.md')).toBe(false);
  });

  it('guesses the assembler from what only one of them has', () => {
    expect(guessAsmLang(KICK_MACRO)).toBe('kickass');
    expect(guessAsmLang(TASS_MACRO)).toBe('64tass');
    expect(guessAsmLang('; clear\n        lda #0\n')).toBe('64tass');
    expect(guessAsmLang('        lda #0\n', '64tass')).toBe('64tass');
    expect(guessAsmLang('        lda #0\n')).toBe('kickass');
  });
});

describe('the macros a piece of code defines', () => {
  it('reads Kick Assembler\'s macros, pseudo commands and functions with their parameters and lines', () => {
    const code = `// a comment with .macro Fake() { in it
${KICK_MACRO}
.pseudocommand mov src : tar {
    lda src
    sta tar
}
.function twice(x) { .return x*2 }
.macro Nothing() { nop }
.macro Braces(t) {
    .if (t > 1) {
        nop /* } */
    } else { brk }
    .text "}"
}`;
    expect(codeLibMacros(code, 'kickass')).toEqual([
      { name: 'WaitRaster', params: ['line'], how: 'macro', line: 2, end: 6 },
      { name: 'mov', params: ['src', 'tar'], how: 'pseudocommand', line: 7, end: 10 },
      { name: 'twice', params: ['x'], how: 'function', line: 11, end: 11 },
      { name: 'Nothing', params: [], how: 'macro', line: 12, end: 12 },
      { name: 'Braces', params: ['t'], how: 'macro', line: 13, end: 18 },
    ]);
    expect(codeLibMacroAt(code, 'kickass', 4)?.name).toBe('WaitRaster');
    expect(codeLibMacroAt(code, 'kickass', 1)).toBeNull();
    expect(codeLibIsMacro(KICK_MACRO, 'kickass')?.name).toBe('WaitRaster');
    expect(codeLibIsMacro(`// waits\n${KICK_MACRO}\n`, 'kickass')?.name).toBe('WaitRaster');
    expect(codeLibIsMacro(`${KICK_MACRO}\nnop`, 'kickass')).toBeNull();
    expect(codeLibIsMacro(code, 'kickass')).toBeNull();
  });

  it('reads 64tass\'s macros, segments and functions, macros in them too', () => {
    const code = `; colours
SetColors .macro border, back=0
        lda #\\border
        sta $d020
Inner   .macro
        nop
        .endm
        lda #\\back
        sta $d021
        .endmacro
Bump:   .segment
        inc $d020
        .endsegment
double  .function x
        .endf x*2
half    .sfunction x=1, x/2`;
    expect(codeLibMacros(code, '64tass')).toEqual([
      { name: 'SetColors', params: ['border', 'back'], how: 'macro', line: 2, end: 10 },
      { name: 'Bump', params: [], how: 'segment', line: 11, end: 13 },
      { name: 'double', params: ['x'], how: 'function', line: 14, end: 15 },
      { name: 'half', params: ['x'], how: 'sfunction', line: 16, end: 16 },
    ]);
    expect(codeLibIsMacro(TASS_MACRO, '64tass')).toMatchObject({ name: 'WaitRaster', params: ['line'], line: 1, end: 5 });
    expect(definesMacro(`        nop\n${TASS_MACRO}`, '64tass', 'WaitRaster')).toBe(2);
    expect(definesMacro(`nop\n${KICK_MACRO}`, 'kickass', 'WaitRaster')).toBe(2);
    expect(definesMacro(KICK_MACRO, 'kickass', 'Wait')).toBe(0);
  });

  it('writes the call and the signature as each assembler has them', () => {
    const m = { name: 'SetColors', params: ['border', 'back'], how: 'macro' as const };
    expect(codeLibCall(m, 'kickass')).toBe('SetColors(border, back)');
    expect(codeLibCall(m, 'kickass', true)).toBe('SetColors(${1:border}, ${2:back})');
    expect(codeLibCall(m, '64tass')).toBe('#SetColors border, back');
    expect(codeLibCall({ name: 'Bump', params: [], how: 'segment' }, '64tass', true)).toBe('#Bump');
    expect(codeLibCall({ name: 'mov', params: ['src', 'tar'], how: 'pseudocommand' }, 'kickass', true)).toBe('mov ${1:src} : ${2:tar}');
    expect(codeLibCall({ name: 'twice', params: ['x'], how: 'function' }, '64tass')).toBe('twice(x)');
    expect(codeLibSignature(m, 'kickass')).toBe('SetColors(border, back)');
    expect(codeLibSignature(m, '64tass')).toBe('SetColors border, back');
    expect(codeLibSignature({ name: 'Nothing', params: [], how: 'macro' }, 'kickass')).toBe('Nothing()');
  });
});

describe('code taken from a source', () => {
  const src = 'start:  sei\n\n        lda #$00\n        sta $d020   \n        sta $d021\n\n        rts\n';
  it('is its lines without the indent they all have and the empty lines at the ends', () => {
    expect(codeLibTake(src, 2, 6)).toBe('lda #$00\nsta $d020\nsta $d021');
    expect(codeLibTake(src, 1, 3)).toBe('start:  sei\n\n        lda #$00');
    expect(codeLibDedent('\t\tlda #1\n\t\t  sta 2\n\n\t\trts')).toBe('lda #1\n  sta 2\n\nrts');
    expect(codeLibDedent('  a\n    b')).toBe('a\n  b');
  });

  it('becomes a macro the call of which gives the bytes the code gave (Kick Assembler)', () => {
    const code = codeLibTake(src, 3, 5);
    const wrapped = codeLibWrap(code, 'Black', [], 'kickass');
    expect(wrapped).toBe('.macro Black() {\n    lda #$00\n    sta $d020\n    sta $d021\n}');
    expect(codeLibIsMacro(wrapped, 'kickass')).toMatchObject({ name: 'Black', params: [], line: 1, end: 5 });
    const inline = checkAsm({ 'main.asm': `* = $1000\n${code}\n` }, 'main.asm', 'kickass');
    const called = checkAsm({ 'main.asm': `* = $1000\n${codeLibCall({ name: 'Black', params: [], how: 'macro' }, 'kickass')}\n${wrapped}\n` }, 'main.asm', 'kickass');
    expect(called.problems).toEqual([]);
    expect([...called.asm.mem.slice(0x1000, 0x1008)]).toEqual([...inline.asm.mem.slice(0x1000, 0x1008)]);
    expect([...inline.asm.mem.slice(0x1000, 0x1008)]).toEqual([0xa9, 0x00, 0x8d, 0x20, 0xd0, 0x8d, 0x21, 0xd0]);
  });

  it('becomes a macro the call of which gives the bytes the code gave (64tass)', () => {
    const code = '-       lda $d012\n        cmp #$80\n        bne -';
    const wrapped = codeLibWrap(code, 'Wait', [], '64tass');
    expect(wrapped).toBe('Wait    .macro\n-       lda $d012\n        cmp #$80\n        bne -\n        .endm');
    expect(codeLibWrap('\tnop', 'AVeryLongName', ['a', 'b'], '64tass')).toBe('AVeryLongName .macro a, b\n\tnop\n\t.endm');
    expect(codeLibIsMacro(wrapped, '64tass')).toMatchObject({ name: 'Wait', line: 1, end: 5 });
    const inline = checkAsm({ 'main.asm': `* = $1000\n${code}\n` }, 'main.asm', '64tass');
    const called = checkAsm({ 'main.asm': `* = $1000\n${wrapped}\n        ${codeLibCall({ name: 'Wait', params: [], how: 'macro' }, '64tass')}\n` }, 'main.asm', '64tass');
    expect(called.problems).toEqual([]);
    expect([...called.asm.mem.slice(0x1000, 0x1007)]).toEqual([...inline.asm.mem.slice(0x1000, 0x1007)]);
  });

  it('names a macro as each assembler can', () => {
    expect(macroName('wait raster-line')).toBe('wait_raster_line');
    expect(macroName('3d')).toBe('_3d');
    expect(macroName('_init')).toBe('_init');
    expect(macroName('  ')).toBe('');
  });
});

describe('the lists', () => {
  const item = (name: string, o: Partial<CodeLibItem> = {}): CodeLibItem => ({ kind: 'macro', file: `${name}.asm`, name, code: 'nop', lang: 'kickass', description: '', created: 0, changed: 0, ...o });
  it('are in alphabetical order, a group a letter: A–Z, Å, Ä, Ö, then #', () => {
    expect(['Apa', 'apa', '_init', 'Ölbricka', 'Ärlig', 'Åsna', 'zero', '3d', 'Élan', 'beta 10', 'beta 9'].map(codeLibLetter)).toEqual(['A', 'A', 'I', 'Ö', 'Ä', 'Å', 'Z', '#', 'E', 'B', 'B']);
    const items = ['zero', 'Ölbricka', '3d', 'Åsna', 'beta 10', 'Apa', 'beta 9', '_init', 'Ärlig', 'apb'].map(n => item(n));
    expect(codeLibOrder(items).map(i => i.name)).toEqual(['Apa', 'apb', 'beta 9', 'beta 10', '_init', 'zero', 'Åsna', 'Ärlig', 'Ölbricka', '3d']);
    expect(codeLibGroups(items).map(g => `${g.letter}:${g.items.length}`)).toEqual(['A:2', 'B:2', 'I:1', 'Z:1', 'Å:1', 'Ä:1', 'Ö:1', '#:1']);
  });

  it('are searched by every word in names, descriptions, where they came from and the code', () => {
    const i = item('WaitRaster', { description: 'Waits until the beam is on a line', code: KICK_MACRO, from: 'dfml · main.asm:3–7' });
    expect(codeLibMatches(i, '')).toBe(true);
    expect(codeLibMatches(i, 'wait')).toBe(true);
    expect(codeLibMatches(i, 'BEAM line')).toBe(true);
    expect(codeLibMatches(i, '$d012')).toBe(true);
    expect(codeLibMatches(i, 'dfml')).toBe(true);
    expect(codeLibMatches(i, 'beam sprite')).toBe(false);
    expect(codeLibHit(i, 'raster')).toBe('name');
    expect(codeLibHit(i, 'beam')).toBe('description');
    expect(codeLibHit(i, 'd012')).toBe('code');
    expect(codeLibHit(i, ' ')).toBeNull();
  });
});
