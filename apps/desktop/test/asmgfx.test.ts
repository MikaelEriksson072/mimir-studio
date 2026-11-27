import { describe, expect, it } from 'vitest';
import { analyze, asmBlockMarks, asmBlockText, asmProgram, checkAsm, render, type GfxLine, type ProjectInput, type ScriptLang } from '@mimir/core';
import { asmHiddenRanges, asmPictureHeight, asmPictureLine, asmPictures } from '../src/lib/asmgfx';
import { gfxListing } from '../src/lib/gfxlines';

/** a program's source with a block in it (as Insert block writes it), checked, and the pictures of its file */
function pictures(lang: ScriptLang, body: string, o: Parameters<typeof asmPictures>[5] = {}) {
  const tass = lang === '64tass';
  const src = `${tass ? '        * = $0801\n        .byte $0b, $08, $ea, $07, $9e\n        .text "2061"\n        .byte 0, 0, 0\nstart   rts\n' : 'BasicUpstart2(start)\nstart:  rts\n'}${body}`;
  const c = checkAsm({ 'main.asm': src, 'sprites/ship.spr': new Uint8Array(128).fill(0x3c) }, 'main.asm', lang);
  expect(c.problems).toEqual([]);
  const { marks } = asmBlockMarks([{ path: 'main.asm', text: src }]);
  const lines = src.split('\n');
  const lineOf = (re: RegExp, from = 0) => lines.findIndex((l, i) => i >= from && re.test(l)) + 1;
  return { c, src, lines, lineOf, pics: asmPictures(c, 'main.asm', src, marks, lang, o) };
}
const bytes = (n: number, f: (i: number) => number) => Uint8Array.from({ length: n }, (_, i) => f(i));

describe('pictures in the Assembler’s editor', () => {
  it('draws a block of sprites as the listing does: its .byte lines one picture, its label under the first sprite', () => {
    const text = asmBlockText({ kind: 'sprite', lang: 'kickass', name: 'ship', bytes: bytes(192, i => i), at: 0x2000 }).text;
    const { pics, lines, lineOf } = pictures('kickass', text);
    expect(pics).toHaveLength(1);
    const p = pics[0];
    // from the first .byte line to the last: the comment lines between the sprites in it, the first one's above it
    expect(p.from).toBe(lineOf(/^\s*\.byte/));
    expect(lines[p.to - 1]).toMatch(/\.byte \$bf/);
    expect(lines[p.to]).toMatch(/@end/);
    expect(lines[p.after - 1]).toMatch(/sprite 0 of 3/);
    expect(p.kind).toBe('sprite');
    expect(p.rows).toHaveLength(1);
    expect(p.rows[0]).toMatchObject({ k: 'gfx', a: 0x2000, n: 192, kind: 'sprite', unit: 64, cols: 8, col: 0, blk: 0x2000, mc: false, names: [{ a: 0x2000, name: 'ship' }] });
    // a byte's line: the one that writes it (the second sprite's first row)
    expect(lines[asmPictureLine(p, 0x2040) - 1]).toMatch(/\.byte %01000000, %01000001, %01000010/);
    expect(lines[asmPictureLine(p, 0x2041) - 1]).toMatch(/\.byte %01000000, %01000001, %01000010/);
    expect(asmPictureLine(p, 0x2043)).toBe(asmPictureLine(p, 0x2040) + 1);
    // 21 rows of 2 pixels, the address under them, the gaps
    expect(asmPictureHeight(p)).toBe(6 + 42 + 13 + 6);
  });

  it('draws a block multicolour as its mark says, or as the window’s analysis says', () => {
    const text = asmBlockText({ kind: 'sprite', lang: 'kickass', name: 'ship', bytes: bytes(64, () => 0x55), at: 0x2000, mc: true }).text;
    expect(pictures('kickass', text).pics[0].rows[0].mc).toBe(true);
    const plain = asmBlockText({ kind: 'sprite', lang: 'kickass', name: 'ship', bytes: bytes(64, () => 0x55), at: 0x2000 }).text;
    expect(pictures('kickass', plain).pics[0].rows[0].mc).toBe(false);
    expect(pictures('kickass', plain, { mc: (m, s, e) => m.kind === 'sprite' && s === 0x2000 && e === 0x2040 }).pics[0].rows[0].mc).toBe(true);
  });

  it('draws a charset in rows of screen codes, as many as there is room for', () => {
    const text = asmBlockText({ kind: 'charset', lang: '64tass', name: 'font', bytes: bytes(512, i => i & 0xff), at: 0x3000 }).text;
    const { pics, lines } = pictures('64tass', text);
    expect(pics).toHaveLength(1);
    expect(pics[0].rows.map(r => [r.a, r.n, r.col])).toEqual([[0x3000, 256, 0], [0x3100, 256, 0]]);
    expect(lines[pics[0].from - 1]).toMatch(/\.byte \$00, \$01.*; char \$00/);
    expect(lines[pics[0].to - 1]).toMatch(/; char \$3f/);
    // 16 characters a row: four rows
    expect(pictures('64tass', text, { cols: { chars: 16 } }).pics[0].rows.map(r => r.n)).toEqual([128, 128, 128, 128]);
  });

  it('is the same picture as the re-assembler’s listing draws of the same block', () => {
    const text = [
      asmBlockText({ kind: 'charset', lang: 'kickass', name: 'font', bytes: bytes(80 * 8, i => i * 3), at: 0x3008 }).text,
      asmBlockText({ kind: 'sprite', lang: 'kickass', name: 'ship', bytes: bytes(64 * 10, i => i), at: 0x2000, mc: true }).text,
    ].join('');
    const { pics, c, src } = pictures('kickass', text);
    // (a charset that starts at its second character: the first row from its column)
    expect(pics.find(p => p.kind === 'chars')!.rows[0]).toMatchObject({ a: 0x3008, col: 1, n: 31 * 8 });
    const prog = asmProgram(c, 'main.asm', asmBlockMarks([{ path: 'main.asm', text: src }]).marks);
    const p: ProjectInput = { name: 'main', files: prog.files, overrides: prog.overrides, labels: prog.labels, comments: {}, settings: {} };
    const A = analyze(p), listed = gfxListing(render(A, p).lines, A).lines.filter((l): l is GfxLine => l.k === 'gfx' && !l.pad);
    const of = (ls: GfxLine[]) => ls.map(l => ({ a: l.a, n: l.n, kind: l.kind, col: l.col, cols: l.cols, blk: l.blk, mc: l.mc }));
    expect(of(pics.flatMap(x => x.rows)).sort((x, y) => x.a - y.a)).toEqual(of(listed).sort((x, y) => x.a - y.a));
  });

  it('breaks a picture at a label of a charset, at `* =` and where the bytes do not follow on; the lines stay', () => {
    const body = [
      '        * = $3000 "font"',
      '// @block charset',
      'font:',
      '        .byte 1, 2, 3, 4, 5, 6, 7, 8',
      '        .byte 1, 2, 3, 4, 5, 6, 7, 8',
      'second:',
      '        .byte 1, 2, 3, 4, 5, 6, 7, 8',
      '        * = $3100',
      '        .byte 9, 9, 9, 9, 9, 9, 9, 9',
      '// @end', '',
    ].join('\n');
    const { pics, lineOf } = pictures('kickass', body);
    expect(pics.map(p => [p.from, p.to, p.after])).toEqual([
      [lineOf(/^font:/) + 1, lineOf(/^font:/) + 2, lineOf(/^font:/)],
      [lineOf(/^second:/) + 1, lineOf(/^second:/) + 1, lineOf(/^second:/)],
      [lineOf(/\* = \$3100/) + 1, lineOf(/\* = \$3100/) + 1, lineOf(/\* = \$3100/)],
    ]);
    expect(pics.map(p => p.rows[0].a)).toEqual([0x3000, 0x3010, 0x3100]);
  });

  it('takes in the label of each sprite (written under it), and draws a file’s sprites under the line that imports it', () => {
    const body = [
      '        * = $2000 "sprites"',
      '// @block sprite multicolor',
      'one:',
      ...Array.from({ length: 21 }, () => '        .byte %11111111, 0, 0'),
      '        .byte 0',
      'two:    .byte 1, 2, 3',
      ...Array.from({ length: 20 }, () => '        .byte 0, 0, 0'),
      '        .byte 0',
      '// @end',
      '        * = $2400 "file"',
      '// @block sprite',
      'file:',
      '        .import binary "sprites/ship.spr"',
      '// @end', '',
    ].join('\n');
    const { pics, lineOf, lines } = pictures('kickass', body);
    expect(pics).toHaveLength(2);
    expect(pics[0]).toMatchObject({ from: lineOf(/^one:/) + 1, to: lineOf(/@end/) - 1, after: lineOf(/^one:/) });
    expect(pics[0].rows[0]).toMatchObject({ a: 0x2000, n: 128, mc: true, names: [{ a: 0x2000, name: 'one' }, { a: 0x2040, name: 'two' }] });
    const imp = lineOf(/\.import binary/);
    expect(pics[1]).toMatchObject({ from: imp + 1, to: imp, after: imp, lines: [{ a: 0x2400, line: imp }] });
    expect(pics[1].rows[0]).toMatchObject({ a: 0x2400, n: 128, names: [{ a: 0x2400, name: 'file' }] });
    expect(lines[imp - 1]).toMatch(/ship\.spr/);
  });

  it('draws a bitmap’s first 8000 bytes', () => {
    const text = asmBlockText({ kind: 'bitmap', lang: 'kickass', name: 'pic', bytes: bytes(8000, i => i & 0xff), at: 0x4000 }).text;
    const { pics } = pictures('kickass', text);
    expect(pics).toHaveLength(1);
    expect(pics[0].rows).toEqual([expect.objectContaining({ a: 0x4000, n: 8000, kind: 'bitmap', cols: 40, col: 0 })]);
    expect(asmPictureHeight(pics[0])).toBe(6 + 200 + 6);
  });

  it('leaves out other blocks, and a file the program has no bytes of', () => {
    const text = asmBlockText({ kind: 'data', lang: 'kickass', name: 'tab', bytes: bytes(16, i => i), at: 0x2000 }).text;
    const { pics, c, src } = pictures('kickass', text);
    expect(pics).toEqual([]);
    expect(asmPictures(c, 'other.asm', src, asmBlockMarks([{ path: 'other.asm', text: src }]).marks, 'kickass')).toEqual([]);
  });

  it('keeps the text of the picture the caret is on', () => {
    const text = asmBlockText({ kind: 'sprite', lang: 'kickass', name: 'ship', bytes: bytes(64, i => i), at: 0x2000 }).text;
    const { pics } = pictures('kickass', text);
    const p = pics[0];
    expect(asmHiddenRanges(pics, [1])).toEqual([{ startLineNumber: p.from, startColumn: 1, endLineNumber: p.to, endColumn: 1 }]);
    expect(asmHiddenRanges(pics, [1, p.from + 3])).toEqual([]);
    expect(asmHiddenRanges(pics, [p.to + 1])).toHaveLength(1);
  });
});
