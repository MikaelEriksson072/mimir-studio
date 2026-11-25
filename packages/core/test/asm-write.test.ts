/* Bytes changed in an Assembler project's program written back into the lines that write them (spec 10.7). */
import { describe, expect, it } from 'vitest';
import { asmWriteBytes } from '../src/asm-write';
import { checkAsm } from '../src/asm-project';
import type { ScriptLang, Vfs } from '../src/types';

const KICK = `BasicUpstart2(start)
start:  rts
        * = $2000
spr:    .byte %00000000, %11110000, %00001111   // row 0
        .byte $0a, $FF, 200
tab:    .byte <start, 7
        .fill 4, i
        .for (var i = 0; i < 2; i++) .byte 9
data:   .import binary "gfx/data.bin", 2, 4
`;
const DATA = Uint8Array.from([0x00, 0x20, 1, 2, 3, 4, 5]);

const run = (lang: ScriptLang, text: string, vfs: Vfs, changes: { addr: number; value: number }[]) => {
  const all = { 'main.asm': text, ...vfs };
  const c = checkAsm(all, 'main.asm', lang);
  expect(c.problems).toEqual([]);
  return { c, w: asmWriteBytes(c, all, lang, changes) };
};

describe('bytes written back into the sources', () => {
  it('changes a .byte line\'s values as they are written: binary, hex in its case, decimal', () => {
    const { w } = run('kickass', KICK, { 'gfx/data.bin': DATA }, [{ addr: 0x2001, value: 0x81 }, { addr: 0x2004, value: 0xab }, { addr: 0x2005, value: 7 }]);
    expect(w.problems).toEqual([]);
    const lines = w.texts['main.asm'].split('\n');
    expect(lines[3]).toBe('spr:    .byte %00000000, %10000001, %00001111   // row 0');
    expect(lines[4]).toBe('        .byte $0a, $AB, 7');
    expect(w.lines).toEqual([{ file: 'main.asm', line: 4 }, { file: 'main.asm', line: 5 }]);
    // the sources with the change assemble to it
    const again = checkAsm({ 'main.asm': w.texts['main.asm'], 'gfx/data.bin': DATA }, 'main.asm', 'kickass');
    expect([...again.asm.mem.subarray(0x2000, 0x2006)]).toEqual([0x00, 0x81, 0x0f, 0x0a, 0xab, 7]);
  });

  it('changes a file the line loads, at the offset it reads', () => {
    const { c, w } = run('kickass', KICK, { 'gfx/data.bin': DATA }, [{ addr: 0, value: 0 }].slice(1));
    const data = c.names.get('data')!;
    const r = asmWriteBytes(c, { 'main.asm': KICK, 'gfx/data.bin': DATA }, 'kickass', [{ addr: data + 1, value: 0x99 }]);
    expect(r.problems).toEqual([]);
    expect([...r.bins['gfx/data.bin']]).toEqual([0x00, 0x20, 1, 0x99, 3, 4, 5]);
    expect(r.texts).toEqual({});
    expect(w.problems).toEqual([]);
  });

  it('says why a byte written by an expression, .fill or a loop is not changed', () => {
    const { c } = run('kickass', KICK, { 'gfx/data.bin': DATA }, []);
    const tab = c.names.get('tab')!;
    const vfs = { 'main.asm': KICK, 'gfx/data.bin': DATA };
    expect(asmWriteBytes(c, vfs, 'kickass', [{ addr: tab, value: 1 }]).problems[0]).toMatch(/the value <start on main.asm line 6, not a number/);
    expect(asmWriteBytes(c, vfs, 'kickass', [{ addr: tab + 1, value: 1 }]).problems).toEqual([]);
    expect(asmWriteBytes(c, vfs, 'kickass', [{ addr: tab + 2, value: 1 }]).problems[0]).toMatch(/main.asm line 7, which is not .byte/);
    expect(asmWriteBytes(c, vfs, 'kickass', [{ addr: tab + 6, value: 1 }]).problems[0]).toMatch(/line 8 writes its bytes more than once/);
    expect(asmWriteBytes(c, vfs, 'kickass', [{ addr: 0x0801, value: 1 }]).problems[0]).toMatch(/not .byte/);
  });

  it('writes 64tass\'s .byte lines and .binary files', () => {
    const text = `        * = $1000\nspr     .byte %00000000, $10 ; comment\n        .binary "d.bin", 1\n`;
    const { w } = run('64tass', text, { 'd.bin': Uint8Array.from([9, 8, 7]) }, [{ addr: 0x1000, value: 0xf0 }, { addr: 0x1001, value: 0x11 }, { addr: 0x1003, value: 0x55 }]);
    expect(w.problems).toEqual([]);
    expect(w.texts['main.asm'].split('\n')[1]).toBe('spr     .byte %11110000, $11 ; comment');
    expect([...w.bins['d.bin']]).toEqual([9, 8, 0x55]);
  });

  it('keeps a file\'s line ends', () => {
    const text = KICK.replace(/\n/g, '\r\n');
    const { w } = run('kickass', text, { 'gfx/data.bin': DATA }, [{ addr: 0x2000, value: 1 }]);
    expect(w.texts['main.asm'].split('\r\n')[3]).toBe('spr:    .byte %00000001, %11110000, %00001111   // row 0');
    expect(w.texts['main.asm'].includes('\r\n')).toBe(true);
    expect(w.texts['main.asm'].replace(/\r\n/g, '').includes('\n')).toBe(false);
  });
});
