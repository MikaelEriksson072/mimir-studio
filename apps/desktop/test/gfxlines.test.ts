import { describe, expect, it } from 'vitest';
import { analyze, assemble, formatOverride, markOverride, parsePrg, render, resizeBlock, showcaseProject, type GfxLine, type ListingLine, type ProjectInput } from '@mimir/core';
import { blockMc, drawGfxLine, gfxMcChanges, markMc, mcSetting, sameSpriteColors, spriteColorsOf, spritePairColors, vicMc, gfxCells, gfxHead, gfxItemAt, gfxItemBox, gfxListing, gfxRects, gfxSize } from '../src/lib/gfxlines';
import { C64, hexRgb } from '../src/lib/palette';
import { cellAt, cellsOf } from '../src/lib/cells';
import { foldLines } from '../src/lib/fold';
import { findText } from '../src/lib/find';
import { fileLineNumbers } from '../src/lib/lines';

// the showcase: four multicolour sprites at $2000 (each with a label), a hires font at $2800 and a multicolour
// bitmap at $4000, with $d01c, $d016 and $d011 written as constants
const p = showcaseProject();
const A = analyze(p), R = render(A, p);
const G = gfxListing(R.lines, A);
const pics = (lines: readonly ListingLine[]) => lines.filter((l): l is GfxLine => l.k === 'gfx' && !l.pad);
/** the lines that hold bytes of s..e: .byte rows, or the .import of a binary file */
const byteRows = (lines: readonly ListingLine[], s: number, e: number) => lines.filter(l => (l.k === 'dat' || (l.k === 'dir' && l.n > 0)) && l.a >= s && l.a < e).length;
// the charset and the bitmap as .byte rows too (the showcase saves them as binary files)
const pb: ProjectInput = { ...p, settings: { ...p.settings, gfxBinary: false } };
const Ab = analyze(pb), Rb = render(Ab, pb), Gb = gfxListing(Rb.lines, Ab);

describe('graphics as pictures in the listing', () => {
  it('replaces the .byte rows of sprites, charsets and bitmaps, and nothing else', () => {
    for (const [s, e] of [[0x2000, 0x2100], [0x2800, 0x3000], [0x4000, 0x5f40]]) {
      expect(byteRows(Rb.lines, s, e)).toBeGreaterThan(0);
      expect(byteRows(Gb.lines, s, e), `$${s.toString(16)}`).toBe(0);
    }
    // every other line stays, in its order
    const other = (lines: readonly ListingLine[]) => lines.filter(l => l.k !== 'gfx' && !(l.k === 'dat' && [[0x2000, 0x2100], [0x2800, 0x3000], [0x4000, 0x5f40]].some(([s, e]) => l.a >= s && l.a < e)));
    const sprites = (l: ListingLine) => (l.k === 'lbl' && /^spr_20[0-c]0$/.test(l.name)) || (l.k === 'cmt' && /^sprite \$/.test(l.text));
    expect(other(Gb.lines)).toEqual(other(Rb.lines).filter(l => !sprites(l)));
    expect(pics(Gb.lines).map(l => `${l.kind} ${l.a.toString(16)}`)).toEqual(pics(G.lines).map(l => `${l.kind} ${l.a.toString(16)}`));
  });

  it('keeps the .import of a binary file, without its bytes, and draws them under it', () => {
    const i = G.lines.findIndex(l => l.k === 'dir' && l.a === 0x2800 && l.tok[0]?.s === '.import binary');
    expect(G.lines[i]).toMatchObject({ k: 'dir', n: 0 });
    expect(G.lines[i + 1]).toMatchObject({ k: 'gfx', kind: 'chars', a: 0x2800 });
  });

  it('draws the sprites side by side with their labels under them, multicolour as $d01c says', () => {
    const [s] = pics(G.lines).filter(l => l.kind === 'sprite');
    expect(s).toMatchObject({ a: 0x2000, n: 256, unit: 64, cols: 8, col: 0, mc: true, rows: 3 });
    expect(s.names?.map(x => x.name)).toEqual(['spr_2000', 'spr_2040', 'spr_2080', 'spr_20c0']);
    // its room: two lines after it, without bytes
    const i = G.lines.indexOf(s);
    expect(G.lines.slice(i + 1, i + 3).every(l => l.k === 'gfx' && l.pad && l.n === 0)).toBe(true);
    expect(gfxHead(G.lines, i + 2)).toBe(i);
    // the labels are found where the sprites are
    expect(findText(s)).toContain('spr_2080:');
  });

  it('lays a charset out 32 characters a row, by screen code, hires when a bitmap takes the multicolour bit', () => {
    const rows = pics(G.lines).filter(l => l.kind === 'chars');
    expect(rows.map(l => l.a)).toEqual(Array.from({ length: 8 }, (_, k) => 0x2800 + k * 256));
    expect(rows.every(l => l.n === 256 && l.col === 0 && l.rows === 1 && !l.mc)).toBe(true);
  });

  it('draws the bitmap as one picture of 40 x 25 cells', () => {
    const [b] = pics(G.lines).filter(l => l.kind === 'bitmap');
    expect(b).toMatchObject({ a: 0x4000, n: 8000, cols: 40, mc: true });
    expect(gfxSize(b)).toEqual({ width: 320, height: 200, scale: 1 });
    expect(b.rows).toBe(11);
  });

  it('keeps the numbers of the .asm lines, the folds and the addresses', () => {
    const nums = fileLineNumbers(R.lines);
    const v = foldLines(G.lines, A.blocks, new Set(), A.mem.length, A.relocs, G.nums);
    // (the .import lines are copies, without bytes)
    G.lines.forEach((l, i) => { if (l.k !== 'gfx' && R.lines.includes(l)) expect(v.lineNo[i]).toBe(nums[R.lines.indexOf(l)]); });
    const imp = (lines: readonly ListingLine[]) => lines.findIndex(l => l.k === 'dir' && l.a === 0x4000 && l.tok[0]?.s === '.import binary');
    expect(v.lineNo[imp(G.lines)]).toBe(nums[imp(R.lines)]);
    // the picture under an .import is no line of the .asm file
    expect(G.lines[imp(G.lines) + 1].k).toBe('gfx');
    expect(v.lineNo[imp(G.lines) + 1]).toBe(0);
    // a picture: the number of the first .byte row it stands for
    const s = pics(G.lines)[0], first = R.lines.findIndex(l => l.k === 'dat' && l.a === 0x2000);
    expect(v.lineNo[G.lines.indexOf(s)]).toBe(nums[first]);
    // every byte of a picture is on its line
    for (const a of [0x2000, 0x20ff, 0x2abc, 0x4000, 0x5f3f]) expect(v.lines[v.lineOf[a]]?.k, `$${a.toString(16)}`).toBe('gfx');
  });

  it('makes each character, sprite and bitmap cell a cell to pick', () => {
    const s = pics(G.lines)[0];
    expect(gfxCells(s)).toEqual([0, 1, 2, 3].map(k => ({ a: 0x2000 + k * 64, n: 64 })));
    expect(cellsOf(s)).toEqual(gfxCells(s));
    expect(cellAt(s, 0x2085)).toEqual({ a: 0x2080, n: 64 });
    const c = pics(G.lines).find(l => l.kind === 'chars' && l.a === 0x2900)!;
    // character $21 is the second of the row, at 8 pixels
    expect(gfxItemAt(c, 9, 3)).toEqual({ a: 0x2908, n: 8 });
    expect(gfxItemBox(c, 1)).toEqual({ x: 8, y: 0, w: 8, h: 8 });
    // between two sprites is a gap
    expect(gfxItemAt(s, 25, 4)).toBe(null);
    expect(gfxItemAt(s, 30, 4)).toEqual({ a: 0x2040, n: 64 });
    const b = pics(G.lines).find(l => l.kind === 'bitmap')!;
    // the cell at column 3 of row 2
    expect(gfxItemAt(b, 3 * 8 + 2, 2 * 8 + 5)).toEqual({ a: 0x4000 + (2 * 40 + 3) * 8, n: 8 });
  });

  it('frames the items a selection takes in, one rectangle a row', () => {
    const b = pics(G.lines).find(l => l.kind === 'bitmap')!;
    // from cell 38 of row 0 to cell 1 of row 1
    expect(gfxRects(b, 0x4000 + 38 * 8, 0x4000 + 42 * 8)).toEqual([{ x: 304, y: 0, w: 16, h: 8 }, { x: 0, y: 8, w: 16, h: 8 }]);
  });

  it('draws multicolour bits in pairs and leaves no item transparent', () => {
    const s = pics(G.lines)[0], { width, height } = gfxSize(s), px = new Uint8ClampedArray(width * height * 4);
    drawGfxLine(px, s, A.mem, { bg: 0, fg: 1, mc1: 2, mc2: 5 });
    // the pixels of a sprite are opaque, the gaps between sprites transparent
    expect(px[(0 * width + 3) * 4 + 3]).toBe(255);
    expect(px[(0 * width + 26) * 4 + 3]).toBe(0);
    // each multicolour pixel is two wide
    for (let y = 0; y < 21; y++) for (let x = 0; x < 24; x += 2) {
      const o = (y * width + x) * 4;
      expect([px[o], px[o + 1], px[o + 2]]).toEqual([px[o + 4], px[o + 5], px[o + 6]]);
    }
  });

  it('follows the multicolour set for a block, and leaves blocks shown as code alone', () => {
    const b = A.blocks.find(x => x.type === 'charset')!;
    expect(blockMc(A, b)).toBe(false);
    const q: ProjectInput = { ...p, overrides: [...(p.overrides ?? []), formatOverride(b, { mc: true })] };
    const B = analyze(q), b2 = B.blocks.find(x => x.type === 'charset')!;
    expect(b2.props.mc).toBe(true);
    expect(pics(gfxListing(render(B, q).lines, B).lines).filter(l => l.kind === 'chars').every(l => l.mc)).toBe(true);
    const C = render(A, p, { dataAsCode: true });
    expect(pics(gfxListing(C.lines, A).lines)).toEqual([]);
  });

  it('draws sprites and a charset as Multicolor was where they were marked (the Graphics tab)', () => {
    // the font at $2800 is hires as the VIC says ($d016 multicolour, but a bitmap mode), the sprites multicolour ($d01c)
    expect(vicMc(A, 'charset', 0x2800, 0x3000)).toBe(false);
    expect(vicMc(A, 'sprite', 0x2000, 0x2100)).toBe(true);
    // a setting only where the VIC says otherwise
    expect(mcSetting(A, 'charset', 0x2800, 0x3000, true)).toBe(true);
    expect(mcSetting(A, 'charset', 0x2800, 0x3000, false)).toBeNull();
    expect(mcSetting(A, 'sprite', 0x2000, 0x2100, false)).toBe(false);
    expect(mcSetting(A, 'sprite', 0x2000, 0x2100, true)).toBeNull();
    // Mark as Charset with Multicolor on: the listing draws its characters multicolour
    const o = markMc(A, markOverride(A, 0x2800, 0x3000, 'charset').override, true);
    expect(o.props?.mc).toBe(true);
    const q: ProjectInput = { ...p, overrides: [...(p.overrides ?? []), o] };
    const B = analyze(q), chars = pics(gfxListing(render(B, q).lines, B).lines).filter(l => l.kind === 'chars');
    expect(chars.length).toBeGreaterThan(0);
    expect(chars.every(l => l.mc)).toBe(true);
    // with it off, as the VIC says: no setting; and a mark that is no graphics is left as it is
    expect(markMc(A, markOverride(A, 0x2800, 0x3000, 'charset').override, false).props?.mc).toBeUndefined();
    const bytes = markOverride(A, 0x2800, 0x3000, 'bytes').override;
    expect(markMc(A, bytes, true)).toBe(bytes);
    // marked hires where the block it merges with is set multicolour: hires (what was seen gives the setting)
    const set = formatOverride(B.blocks.find(x => x.type === 'charset')!, { mc: true });
    expect(markMc(B, { ...set }, false).props?.mc).toBeUndefined();
  });

  it('switching Multicolor in the Graphics tab sets it for the blocks of the kind shown that the selection is in', () => {
    // the charset at $2800 drawn as characters, multicolour: one change, a setting
    const ch = gfxMcChanges(A, 'chars', 0x2810, 0x2820, true);
    expect(ch.map(c => [c.b.start, c.mc])).toEqual([[0x2800, true]]);
    expect(gfxMcChanges(A, 'fontrows', 0x2810, 0x2820, true).map(c => c.b.start)).toEqual([0x2800]);
    // already drawn so, or not the kind the view draws, or screens: nothing
    expect(gfxMcChanges(A, 'chars', 0x2810, 0x2820, false)).toEqual([]);
    expect(gfxMcChanges(A, 'sprites', 0x2810, 0x2820, true)).toEqual([]);
    expect(gfxMcChanges(A, 'screens', 0x2810, 0x2820, true)).toEqual([]);
    // the sprites hires: a setting; back to multicolour once set: the setting goes (as the VIC registers say)
    const sp = gfxMcChanges(A, 'sprites', 0x2000, 0x2100, false);
    expect(sp.map(c => [c.b.type, c.mc])).toEqual(sp.map(() => ['sprite', false]));
    expect(sp.length).toBeGreaterThan(0);
    const q: ProjectInput = { ...p, overrides: [...(p.overrides ?? []), ...sp.map(c => formatOverride(c.b, { mc: c.mc }))] };
    const B = analyze(q);
    expect(pics(gfxListing(render(B, q).lines, B).lines).filter(l => l.kind === 'sprite').some(l => l.mc)).toBe(false);
    expect(gfxMcChanges(B, 'sprites', 0x2000, 0x2100, true).map(c => c.mc)).toEqual(sp.map(() => null));
  });
});

describe("sprite colours (set in the inspector's enlarged sprite)", () => {
  const sprites = A.blocks.find(x => x.type === 'sprite')!;
  const RED_ON_BLUE = { bg: 6, sprite: 2, mc1: 7, mc2: 1 };

  it("are the VIC's: the sprite's own colour a set pixel or 10, multicolour 1 01 and 2 11", () => {
    expect(spritePairColors(RED_ON_BLUE, false)).toEqual({ bg: 6, fg: 2, mc1: 7, mc2: 1 });
    expect(spritePairColors(RED_ON_BLUE, true)).toEqual({ bg: 6, mc1: 7, mc2: 2, fg: 1 });
    // the Graphics tab's colours (bit pairs) as sprite colours draw the same, either way
    const tab = { bg: 0, fg: 1, mc1: 15, mc2: 12 };
    for (const mc of [false, true]) expect(spritePairColors(spriteColorsOf(tab, mc), mc)).toEqual(tab);
    expect(spriteColorsOf(tab, true)).toEqual({ bg: 0, sprite: 12, mc1: 15, mc2: 1 });
    expect(sameSpriteColors(RED_ON_BLUE, { ...RED_ON_BLUE })).toBe(true);
    expect(sameSpriteColors(RED_ON_BLUE, { ...RED_ON_BLUE, mc2: 0 })).toBe(false);
    expect(sameSpriteColors(null, undefined)).toBe(true);
    expect(sameSpriteColors(null, RED_ON_BLUE)).toBe(false);
  });

  it('are saved with the block, kept with its multicolour, and taken away again', () => {
    const o = formatOverride(sprites, { colors: RED_ON_BLUE });
    expect(o).toMatchObject({ start: sprites.start, end: sprites.end, type: 'sprite', props: { colors: RED_ON_BLUE } });
    const q: ProjectInput = { ...p, overrides: [...(p.overrides ?? []), o] };
    const B = analyze(q), b = B.blocks.find(x => x.type === 'sprite')!;
    expect(b.props.colors).toEqual(RED_ON_BLUE);
    // hires set after them keeps them; null takes them away and keeps hires
    const hires = formatOverride(b, { mc: false }, q.overrides);
    expect(hires.props).toEqual({ mc: false, colors: RED_ON_BLUE });
    expect(formatOverride(b, { colors: null }, [...q.overrides!, hires]).props).toEqual({ mc: false });
  });

  it("draw the block's sprites in the listing, and only its", () => {
    const q: ProjectInput = { ...p, overrides: [...(p.overrides ?? []), formatOverride(sprites, { colors: RED_ON_BLUE })] };
    const B = analyze(q), L = pics(gfxListing(render(B, q).lines, B).lines);
    const s = L.find(l => l.kind === 'sprite')!;
    // the showcase's sprites are multicolour ($d01c): the sprite's own colour is 10
    expect(s.mc).toBe(true);
    expect(s.colors).toEqual({ bg: 6, mc1: 7, mc2: 2, fg: 1 });
    expect(L.filter(l => l.kind !== 'sprite').every(l => !l.colors)).toBe(true);
    expect(pics(G.lines).every(l => !l.colors)).toBe(true);
    const { width, height } = gfxSize(s), px = new Uint8ClampedArray(width * height * 4);
    drawGfxLine(px, s, B.mem, { bg: 0, fg: 1, mc1: 15, mc2: 12 });
    const seen = new Set<string>();
    for (let i = 0; i < px.length; i += 4) if (px[i + 3]) seen.add(`${px[i]},${px[i + 1]},${px[i + 2]}`);
    const allowed = new Set([6, 7, 2, 1].map(c => hexRgb(C64[c]).join(',')));
    expect([...seen].every(c => allowed.has(c))).toBe(true);
    expect(seen.has(hexRgb(C64[2]).join(','))).toBe(true);
  });

  it('go with the sprites when the block takes more of them', () => {
    const q: ProjectInput = { ...p, overrides: [...(p.overrides ?? []), formatOverride(sprites, { colors: RED_ON_BLUE })] };
    const B = analyze(q), b = B.blocks.find(x => x.type === 'sprite')!;
    const r = resizeBlock(B, b.start, b.start, b.start + 6 * 64);
    if ('error' in r) throw new Error(r.error);
    const q2: ProjectInput = { ...q, overrides: [...q.overrides!, ...r.overrides] };
    const C = analyze(q2);
    expect(C.blocks.find(x => x.type === 'sprite' && x.start === b.start)!.props.colors).toEqual(RED_ON_BLUE);
  });
});

describe('a bitmap the code draws into (The Lab)', () => {
  // code that reads and writes all over the bitmap at $6000: inside a cell, at a row's start, at its last byte
  const src = `.pc = $1000 "Code"
        lda #$3b
        sta $d011
        lda #$78
        sta $d018
        lda #$02
        sta $dd00
        ldx #0
loop:   lda $6005,x
        sta $6143,x
        sta $6280,x
        sta $7f3f
        inx
        bne loop
        rts
.pc = $6000 "Bitmap"
.fill 8000, (i * 37) & $ff
`;
  const r = assemble({ 'lab.asm': src }, 'lab.asm');
  const q: ProjectInput = { name: 'lab', files: [parsePrg('lab.prg', r.prg!)], overrides: [{ start: 0x6000, end: 0x7f40, type: 'bitmap' }], labels: {}, comments: {}, settings: {} };

  it('is one picture, with no label inside it', () => {
    for (const gfxBinary of [true, false]) {
      const s = { ...q, settings: { gfxBinary } }, B = analyze(s), L = gfxListing(render(B, s).lines, B).lines;
      expect(pics(L).filter(l => l.kind === 'bitmap').map(l => [l.a, l.n])).toEqual([[0x6000, 8000]]);
      expect(L.filter(l => l.k === 'lbl' && l.a >= 0x6000 && l.a < 0x7f40).map(l => l.k === 'lbl' && l.name)).toEqual(['bitmap_6000']);
      // the code counts from its label
      const code = L.filter(l => l.k === 'ins').map(l => l.k === 'ins' && l.tok.map(t => t.s).join(''));
      expect(code).toEqual(expect.arrayContaining(['bitmap_6000+5,x', 'bitmap_6000+323,x', 'bitmap_6000+640,x', 'bitmap_6000+7999']));
    }
  });
});

describe('sprites one after the other', () => {
  it('a sprite block grows by whole sprites, taking the bytes after it', () => {
    const b = A.blocks.find(x => x.type === 'sprite')!;
    const r = resizeBlock(A, b.start, b.start, b.start + 6 * 64);
    if ('error' in r) throw new Error(r.error);
    const q: ProjectInput = { ...p, overrides: [...(p.overrides ?? []), ...r.overrides] };
    const B = analyze(q), b2 = B.blocks.find(x => x.type === 'sprite' && x.start === b.start)!;
    expect(b2.end - b2.start).toBe(6 * 64);
    const [s] = pics(gfxListing(render(B, q).lines, B).lines).filter(l => l.kind === 'sprite');
    expect(s.n).toBe(6 * 64);
    // the two new sprites have no labels: their addresses are written under them
    expect(s.names?.length).toBe(4);
  });
});
