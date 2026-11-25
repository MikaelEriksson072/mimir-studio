import { describe, expect, it } from 'vitest';
import { asmBlockBytes, asmBlockMarks, asmBlockText, asmLabel, asmMarkAt, libraryLabel, type AsmBlockKind } from '../src/asm-blocks';
import { asmProgram, checkAsm } from '../src/asm-project';
import { makePsid } from '../src/c64/psid';
import { pictureData, picture, writePicture } from '../src/c64/pictures';
import type { ScriptLang } from '../src/types';

const bytes = (n: number, f: (i: number) => number) => Uint8Array.from({ length: n }, (_, i) => f(i) & 0xff);
const SPRITES = bytes(128, i => i * 7 + 1);
const LANGS: ScriptLang[] = ['kickass', '64tass'];
/** a program of `lang` with `block` after its code */
const program = (lang: ScriptLang, block: string) => (lang === '64tass'
  ? `        * = $0801\n        .byte $0b, $08, $ea, $07, $9e\n        .text "2061"\n        .byte 0, 0, 0\nstart   lda #0\n        rts\n${block}`
  : `BasicUpstart2(start)\nstart:\n        lda #0\n        rts\n${block}`);

describe('blocks marked in the sources', () => {
  it('reads each block between @block and @end, what it is and how it is drawn or played', () => {
    const { marks, warnings } = asmBlockMarks([{ path: 'main.asm', text: [
      'start: rts',
      '// @block sprite multicolor',
      'spr: .byte 0',
      '// @end',
      '; @block music init=$1000 play=$1003',
      '.byte 1',
      '// @end',
      '  // @block text screen',
      '.text "A"',
    ].join('\n') }]);
    expect(warnings).toEqual([]);
    expect(marks).toEqual([
      { file: 'main.asm', line: 2, end: 4, kind: 'sprite', props: { mc: true } },
      { file: 'main.asm', line: 5, end: 7, kind: 'music', props: { init: 0x1000, play: 0x1003 } },
      // a block without an @end goes to the end of its file
      { file: 'main.asm', line: 8, end: 10, kind: 'text', props: { enc: 'screen' } },
    ]);
    expect(asmMarkAt(marks, 'main.asm', 3)?.kind).toBe('sprite');
    expect(asmMarkAt(marks, 'main.asm', 4)).toBe(null);
    expect(asmMarkAt(marks, 'other.asm', 3)).toBe(null);
  });
  it('says what it does not understand, on its line', () => {
    const { marks, warnings } = asmBlockMarks([{ path: 'a.asm', text: '// @block pictures\n.byte 1\n// @end\n// @end\n// @block sprite sideways\n// @block data\n' }]);
    expect(marks.map(m => m.kind)).toEqual(['data', 'sprite', 'data']);
    expect(warnings.map(w => w.line)).toEqual([1, 4, 5, 6]);
    expect(warnings[0].msg).toMatch(/not a kind of block/);
  });
  it('makes the program\'s bytes code, its BASIC line BASIC, and a block\'s bytes what the block is', () => {
    const text = program('kickass', '        .align $40\n// @block sprite hires\nspr:\n        .fill 64, i\n// @end\ntail:   .byte 1, 2\n');
    const c = checkAsm({ 'main.asm': text }, 'main.asm', 'kickass');
    expect(c.ok).toBe(true);
    const p = asmProgram(c, 'main.asm', asmBlockMarks([{ path: 'main.asm', text }]).marks);
    const spr = c.names.get('spr')!, tail = c.names.get('tail')!;
    expect(spr % 64).toBe(0);
    expect(p.overrides).toEqual([
      { start: 0x0801, end: 0x080d, type: 'basic' },
      // (the code, then the .align's zeros: no block)
      { start: 0x080e, end: spr, type: 'code' },
      { start: spr, end: spr + 64, type: 'sprite', props: { mc: false } },
      { start: tail, end: tail + 2, type: 'code' },
    ]);
  });
});

describe('a new block, written for its assembler', () => {
  const check = (lang: ScriptLang, text: string, vfs: Record<string, string | Uint8Array> = {}) => {
    const src = program(lang, text);
    const c = checkAsm({ 'main.asm': src, ...vfs }, 'main.asm', lang);
    expect(c.problems).toEqual([]);
    return { c, p: asmProgram(c, 'main.asm', asmBlockMarks([{ path: 'main.asm', text: src }]).marks) };
  };
  const at = (c: ReturnType<typeof checkAsm>, a: number, n: number) => [...c.asm.mem.subarray(a, a + n)];

  for (const lang of LANGS) {
    it(`writes sprites as 21 rows of 3 binary bytes and the 64th byte, aligned to 64, as .byte lines or a file (${lang})`, () => {
      const t = asmBlockText({ kind: 'sprite', lang, name: 'ship', bytes: SPRITES, mc: true, at: null });
      const lines = t.text.split('\n');
      expect(lines[0]).toBe('        .align $40');
      expect(lines[1]).toBe(`${lang === '64tass' ? ';' : '//'} @block sprite multicolor`);
      expect(lines[t.labelLine]).toBe(lang === '64tass' ? 'ship' : 'ship:');
      expect(lines.filter(l => /^\s+\.byte %[01]{8}, %[01]{8}, %[01]{8}$/.test(l))).toHaveLength(42);
      const { c, p } = check(lang, t.text);
      const ship = c.names.get('ship')!;
      expect(ship % 64).toBe(0);
      expect(at(c, ship, 128)).toEqual([...SPRITES]);
      expect(p.overrides.find(o => o.start === ship)).toEqual({ start: ship, end: ship + 128, type: 'sprite', props: { mc: true } });
      // the same from a file of the project, after its load address
      const f = asmBlockText({ kind: 'sprite', lang, name: 'ship', bytes: SPRITES, mc: true, at: 0x2000, file: { path: 'sprites/ship.spr', offset: 2 } });
      expect(f.text).toContain(lang === '64tass' ? '.binary "sprites/ship.spr", 2, 128' : '.import binary "sprites/ship.spr", 2, 128');
      const g = check(lang, f.text, { 'sprites/ship.spr': Uint8Array.from([0, 0x20, ...SPRITES]) });
      expect(g.c.names.get('ship')).toBe(0x2000);
      expect(at(g.c, 0x2000, 128)).toEqual([...SPRITES]);
      expect(g.p.overrides.find(o => o.start === 0x2000)?.type).toBe('sprite');
    });

    it(`writes a charset a char a line, a screen a row a line, data 8 a line (${lang})`, () => {
      const chars = bytes(32, i => i ^ 0x55), screen = bytes(1000, i => i % 40), data = bytes(10, i => 100 + i);
      const block = [
        asmBlockText({ kind: 'charset', lang, name: 'font', bytes: chars, mc: null, at: null }).text,
        asmBlockText({ kind: 'screen', lang, name: 'scr', bytes: screen, at: null }).text,
        asmBlockText({ kind: 'data', lang, name: 'tab', bytes: data, at: null }).text,
      ].join('');
      expect(block).toMatch(/\.byte \$55, \$54, \$57, \$56, \$51, \$50, \$53, \$52\s+(\/\/|;) char \$00/);
      const { c, p } = check(lang, block);
      const font = c.names.get('font')!, scr = c.names.get('scr')!, tab = c.names.get('tab')!;
      expect(font % 0x800).toBe(0);
      expect(scr % 0x400).toBe(0);
      expect(at(c, font, 32)).toEqual([...chars]);
      expect(at(c, scr, 1000)).toEqual([...screen]);
      expect(at(c, tab, 10)).toEqual([...data]);
      expect(p.overrides.filter(o => o.type !== 'code' && o.type !== 'basic').map(o => [o.type, o.start, o.end - o.start])).toEqual([['charset', font, 32], ['screen', scr, 1000], ['data', tab, 10]]);
    });

    it(`writes a picture: its bitmap, screen and colours as blocks, and its background (${lang})`, () => {
      const pic = picture({ mc: true, bitmap: bytes(8000, i => i * 3), screen: bytes(1000, i => i), color: bytes(1000, i => i & 15), bg: 6 });
      const body = pictureData(pic), koala = writePicture('koala', pic);
      for (const file of [null, { path: 'bitmaps/pic.kla', offset: 2 }]) {
        const t = asmBlockText({ kind: 'bitmap', lang, name: 'pic', bytes: body, picture: true, mc: true, at: 0x4000, file });
        const { c, p } = check(lang, t.text, file ? { 'bitmaps/pic.kla': koala } : {});
        expect(c.names.get('pic')).toBe(0x4000);
        expect(at(c, 0x4000, 10000)).toEqual([...body.subarray(0, 10000)]);
        expect(c.names.get('pic_screen')).toBe(0x4000 + 8000);
        expect(c.names.get('pic_colors')).toBe(0x4000 + 9000);
        expect(c.names.get('pic_bg')).toBe(6);
        expect(p.overrides.filter(o => o.start >= 0x4000).map(o => [o.type, o.start, o.end])).toEqual([['bitmap', 0x4000, 0x4000 + 8000], ['screen', 0x4000 + 8000, 0x4000 + 9000], ['data', 0x4000 + 9000, 0x4000 + 10000]]);
      }
    });

    it(`writes music at its load address, with init and play, as .byte lines or the .sid (${lang})`, () => {
      const sid = makePsid(bytes(40, i => i + 1), 0x1000, 0x1000, 0x1003, 'Tune');
      for (const file of [null, { path: 'music/tune.sid' }]) {
        const t = asmBlockText({ kind: 'music', lang, name: 'tune', bytes: sid, at: null, file });
        const { c, p } = check(lang, t.text, file ? { 'music/tune.sid': sid } : {});
        expect(at(c, 0x1000, 40)).toEqual([...bytes(40, i => i + 1)]);
        expect(p.overrides.find(o => o.start === 0x1000)).toEqual({ start: 0x1000, end: 0x1028, type: 'music', props: { init: 0x1000, play: 0x1003 } });
        // Kick Assembler reads the .sid with LoadSid: init and play are its variable's
        if (lang === 'kickass' && file) expect(t.text).toContain('.var tune = LoadSid("music/tune.sid")');
        else { expect(c.names.get('tune_init')).toBe(0x1000); expect(c.names.get('tune_play')).toBe(0x1003); }
      }
    });
  }
});

describe('what a block takes from a file, and its name', () => {
  it('takes sprites and charsets after a load address, a picture whole, a .sid whole', () => {
    expect(asmBlockBytes('sprite', 'a.spr', bytes(64, i => i))).toEqual({ bytes: bytes(64, i => i), offset: 0 });
    expect(asmBlockBytes('sprite', 'a.bin', bytes(130, i => i))).toMatchObject({ offset: 2, bytes: bytes(128, i => i + 2) });
    expect(asmBlockBytes('charset', 'font.64c', bytes(10, i => i))).toMatchObject({ offset: 2 });
    expect(asmBlockBytes('data', 'x.prg', bytes(5, i => i))).toMatchObject({ offset: 2, bytes: bytes(3, i => i + 2) });
    const pic = picture({ mc: true, bitmap: bytes(8000, i => i), screen: bytes(1000, i => i), color: bytes(1000, i => i & 15), bg: 1 });
    expect(asmBlockBytes('bitmap', 'p.kla', writePicture('koala', pic))).toMatchObject({ picture: true, mc: true, koala: true, offset: 2, bytes: pictureData(pic) });
    expect(asmBlockBytes('bitmap', 'raw.bin', bytes(100, i => i))).toMatchObject({ problem: expect.stringMatching(/a bitmap is 8000/) });
    expect(asmBlockBytes('music', 'x.sid', bytes(10, i => i))).toMatchObject({ problem: expect.stringMatching(/not a PSID/) });
  });
  it('gives a label both assemblers take', () => {
    expect(asmLabel('Player ship #2')).toBe('Player_ship_2');
    expect(asmLabel('2nd')).toBe('_2nd');
    expect(asmLabel('lda')).toBe('lda_');
    expect(asmLabel('Åka')).toBe('Aka');
    expect(asmLabel('   ')).toBe('block');
    expect(libraryLabel('Comaland side 1 - file25 - spr_2000 ($2000-$203f)')).toBe('spr_2000');
    expect(libraryLabel('My own')).toBe('My_own');
  });
});

describe('64tass\'s .align in Mimir\'s assembler', () => {
  it('leaves the gap unwritten, or fills it', () => {
    const c = checkAsm({ 'm.asm': '        * = $1001\n        .byte 1\n        .align 16\nx       .byte 2\n        .align 8, $ee\n        .byte 3\n' }, 'm.asm', '64tass');
    expect(c.problems).toEqual([]);
    expect(c.names.get('x')).toBe(0x1010);
    expect(c.asm.written[0x1005]).toBe(0);
    expect([...c.asm.mem.subarray(0x1011, 0x1019)]).toEqual([0xee, 0xee, 0xee, 0xee, 0xee, 0xee, 0xee, 3]);
  });
});

void (null as unknown as AsmBlockKind);
