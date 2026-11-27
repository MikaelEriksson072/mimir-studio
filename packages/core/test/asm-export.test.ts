/* Export from an Assembler project (spec 10.7): the program, a range, a source's bytes or a data file's, as .bin, .prg,
 * .byte lines, one source, VICE labels, symbols, a C array, BASIC DATA lines, a hex dump and a listing. */
import { describe, expect, it } from 'vitest';
import { checkAsm } from '../src/asm-project';
import {
  asmDataAt, asmExport, asmExportBasic, asmExportByteLines, asmExportC, asmExportData, asmExportFile, asmExportHex, asmExportKinds, asmExportListing,
  asmExportProgram, asmExportRange, asmExportSymbols, asmExportViceLabels, asmOneSource, asmOneSourceSame, joinedParts,
} from '../src/asm-export';
import type { Vfs } from '../src/types';
import { KICK, SPRITE, TASS } from './asm-export-fixtures';

describe('export from an Assembler project', () => {
  const c = checkAsm(KICK, 'main.asm', 'kickass');
  it('the program is the PRG the build writes; its labels all of them', () => {
    expect(c.problems).toEqual([]);
    const p = asmExportProgram(c, 'main')!;
    expect(p.parts).toHaveLength(1);
    expect(p.parts[0].start).toBe(0x0801);
    expect([...asmExport('prg', p, { lang: 'kickass' })]).toEqual([...c.asm.prg!]);
    expect([...asmExport('bin', p, { lang: 'kickass' })]).toEqual([...c.asm.prg!.slice(2)]);
    expect(p.names!.get('sprite')).toBe(0x2000);
    expect(asmExportKinds(p)).toEqual(['bin', 'prg', 'bytes', 'one', 'vs', 'sym', 'c', 'bas', 'hex', 'lst']);
  });
  it('a range, the bytes a source writes, a data file (where the program has it)', () => {
    const r = asmExportRange(c, 0x2000, 0x2003, 'main_2000')!;
    expect([...r.parts[0].bytes]).toEqual([...SPRITE.slice(0, 4)]);
    expect([...r.names!.keys()]).toEqual(['sprite']);
    expect(asmExportKinds(r)).not.toContain('one');
    // the macros' bytes are their call's: the file of macros writes none
    expect(asmExportFile(c, 'lib/macros.asm', 'macros')).toBeNull();
    const f = asmExportFile(c, 'lib/data.asm', 'data')!;
    expect(f.parts.map(p => [p.start, p.bytes.length])).toEqual([[0x2000, 63]]);
    expect(asmDataAt(c, SPRITE)).toBe(0x2000);
    const d = asmExportData(SPRITE, 0x3000, 'sprite');
    expect(asmExportKinds(d)).toEqual(['bin', 'prg', 'bytes', 'c', 'bas', 'hex']);
    expect(asmExportData(Uint8Array.of(0x00, 0xc0, 9, 8), 0, 'x', true).parts).toEqual([{ start: 0xc000, bytes: Uint8Array.of(9, 8) }]);
  });
  it('.byte lines that assemble to the same bytes, in either language', () => {
    const p = asmExportProgram(c, 'main')!;
    for (const lang of ['kickass', '64tass'] as const) {
      const back = checkAsm({ 'x.asm': asmExportByteLines(p, lang) }, 'x.asm', lang);
      expect(back.problems, lang).toEqual([]);
      expect([...back.asm.prg!], lang).toEqual([...c.asm.prg!]);
    }
    // stretches with a gap: a * = before each, a label at each
    const two = { ...asmExportData(Uint8Array.of(1, 2), 0x1000, 'two'), parts: [{ start: 0x1000, bytes: Uint8Array.of(1, 2) }, { start: 0x1010, bytes: Uint8Array.of(3) }] };
    const t = asmExportByteLines(two, 'kickass');
    expect(t).toContain('* = $1000\ntwo:\n    .byte $01, $02');
    expect(t).toContain('* = $1010\ntwo_1010:\n    .byte $03');
    expect([...joinedParts(two.parts).bytes]).toEqual([1, 2, ...Array(14).fill(0), 3]);
  });
  it('VICE labels, symbols, a C array, BASIC DATA lines, a hex dump', () => {
    const p = asmExportProgram(c, 'main')!;
    const vs = asmExportViceLabels(p.names!).split('\n');
    expect(vs).toContain(`al C:${c.names.get('start')!.toString(16).padStart(4, '0')} .start`);
    expect(vs).toContain('al C:2000 .sprite');
    expect(vs).toContain('al C:d020 .BORDER');
    expect(asmExportSymbols(p.names!, 'kickass')).toContain('.label BORDER=$d020');
    expect(asmExportSymbols(p.names!, '64tass')).toMatch(/\nBORDER\s+= \$d020\n/);
    const h = asmExportC(p);
    expect(h).toContain('#define MAIN_ADDR 0x0801');
    expect(h).toContain(`const unsigned char main[${c.asm.prg!.length - 2}] = {`);
    const bas = asmExportBasic(p).trim().split('\n');
    expect(bas[1]).toBe(`20 for i=0 to ${c.asm.prg!.length - 3}:read b:poke 2049+i,b:next`);
    expect(bas.every(l => l.length <= 80)).toBe(true);
    expect(bas.filter(l => / data /.test(l)).flatMap(l => l.replace(/^\d+ data /, '').split(',').map(Number))).toEqual([...c.asm.prg!.slice(2)]);
    const hex = asmExportHex(asmExportRange(c, 0x2000, 0x2011, 'x')!).split('\n');
    expect(hex[0]).toBe(`2000  ${[...SPRITE.slice(0, 16)].map(b => b.toString(16).padStart(2, '0')).join(' ')}  ${[...SPRITE.slice(0, 16)].map(b => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.')).join('')}`);
    expect(hex[1].startsWith('2010  ')).toBe(true);
  });
  it('a listing: each line that writes bytes, its address, bytes, file and line', () => {
    const l = asmExportListing(asmExportProgram(c, 'main')!, KICK).split('\n');
    const at = c.names.get('start')!.toString(16).padStart(4, '0');
    expect(l.find(x => x.startsWith(at))).toMatch(/^\w{4} {2}a2 00\s+main\.asm:4\s+start: {2}ldx #0$/);
    // a macro's bytes are its call's line
    expect(l.some(x => /a9 02\s+main\.asm:10\s+done: {3}Border\(2\)$/.test(x))).toBe(true);
    expect(l.some(x => /^2000 .*lib\/data\.asm:2\s+sprite: \.import binary/.test(x))).toBe(true);
    expect(l.some(x => /… 55 more bytes/.test(x))).toBe(true);
    // a source's own lines only
    const f = asmExportListing(asmExportFile(c, 'lib/data.asm', 'data')!, KICK);
    expect(f).not.toContain('main.asm');
  });
});

describe('one source: the main file with the sources it imports put in', () => {
  it('Kick Assembler: #import, #importonce once, the data a library loads named from the main file, the same program', () => {
    const c = checkAsm(KICK, 'main.asm', 'kickass');
    const one = asmOneSource(KICK, 'main.asm', 'kickass');
    expect(one.problems).toEqual([]);
    expect(one.inlined).toEqual(['lib/macros.asm', 'lib/data.asm']);
    expect(one.text.match(/\.macro Border/g)).toHaveLength(1);
    expect(one.text).toContain('put in already (it has #importonce)');
    expect(one.text).toContain('.import binary "lib/sprite.bin"');
    expect(one.text).toContain('/* #import "nothing.asm" */');
    expect(one.text).not.toMatch(/^#import/m);
    expect(asmOneSourceSame(KICK, 'main.asm', 'kickass', one.text, c)).toEqual({ same: true, problems: [] });
    // what the check of it alone says when it is not the same
    expect(asmOneSourceSame(KICK, 'main.asm', 'kickass', KICK['main.asm'] as string, c).same).toBe(false);
  });
  it('64tass: .include, .binclude as a .block of its own, the same program', () => {
    const c = checkAsm(TASS, 'main.asm', '64tass');
    expect(c.problems).toEqual([]);
    const one = asmOneSource(TASS, 'main.asm', '64tass');
    expect(one.inlined).toEqual(['lib/print.asm', 'lib/gfx.asm']);
    expect(one.text).toContain('gfx .block ; .binclude "lib/gfx.asm"');
    expect(one.text).toContain('.binary "lib/logo.bin"');
    expect(asmOneSourceSame(TASS, 'main.asm', '64tass', one.text, c)).toEqual({ same: true, problems: [] });
  });
  it('a main file in a folder: the data named from its folder', () => {
    const vfs: Vfs = { 'src/main.asm': '* = $1000\n#import "../lib/data.asm"\n', 'lib/data.asm': '.import binary "sprite.bin"\n', 'lib/sprite.bin': SPRITE };
    const c = checkAsm(vfs, 'src/main.asm', 'kickass');
    expect(c.problems).toEqual([]);
    const one = asmOneSource(vfs, 'src/main.asm', 'kickass');
    expect(one.text).toContain('.import binary "../lib/sprite.bin"');
    expect(asmOneSourceSame(vfs, 'src/main.asm', 'kickass', one.text, c).same).toBe(true);
  });
});
