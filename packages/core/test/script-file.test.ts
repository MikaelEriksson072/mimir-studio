/* A script as a file (spec 10.3): its code with a line at the top that says the rest, read back the same; a file
 * written by hand; what is not as it should be left out; and whether a script of the library fits a program. */
import { describe, expect, it } from 'vitest';
import { isScriptFileName, readScriptFile, scriptFileName, scriptFileText, scriptFits, type StoredScript } from '../src';

const full: StoredScript = {
  name: 'decrypt level', lang: 'kickass', source: '.var key = $77\n        lda #key\n        rts\n',
  pads: [{ name: 'result', start: 0xc000, size: 0x400, fill: 0xff, data: Uint8Array.from([1, 2, 3]), role: 'result' }, { name: 'inp', start: 0xc400, size: 16, role: 'file', load: 0x6000, src: { form: 'hex', text: '01 02' } }],
  safe: true, init: { a: 1, zp: [{ at: 0xfb, value: 0x1234, word: true }] }, machine: 'c64', stopAt: 'after', watch: [{ expr: '$c000', size: 2 }], unwatch: ['$d020'], table: 'key\n$77\n$12\n', needs: ['decrypt_level'],
};

describe('a script as a file', () => {
  it('is its code under a line that says the rest, and reads back as it was', () => {
    const text = scriptFileText(full);
    const [head, ...code] = text.split('\n');
    expect(head.startsWith('// mimir-script {"lang":"kickass","pads":[')).toBe(true);
    expect(code.join('\n')).toBe(full.source);
    expect(scriptFileName(full)).toBe('decrypt level.asm');
    expect(readScriptFile('decrypt level.asm', text)).toEqual(full);
    // a script with nothing but its code has a short line
    expect(scriptFileText({ name: 'a', lang: 'kickass', source: '        rts', pads: [] })).toBe('// mimir-script {"lang":"kickass"}\n        rts');
  });

  it('is a comment to 64tass, and JavaScript by its extension', () => {
    const tass: StoredScript = { name: 't', lang: '64tass', source: '        rts', pads: [] };
    expect(scriptFileText(tass).split('\n')[0]).toBe('; mimir-script {"lang":"64tass"}');
    expect(readScriptFile('t.asm', scriptFileText(tass))).toEqual(tass);
    const js: StoredScript = { name: 'unxor', lang: 'kickass', code: 'js', source: 'mem[0x0840] ^= 0x5a;\n', pads: [], table: 'key\n1\n' };
    expect(scriptFileName(js)).toBe('unxor.js');
    expect(scriptFileText(js).split('\n')[0]).toBe('// mimir-script {"lang":"kickass","table":"key\\n1\\n"}');
    expect(readScriptFile('unxor.js', scriptFileText(js))).toEqual(js);
  });

  it('is a script too when it was written by hand, without the line', () => {
    expect(readScriptFile('by hand.asm', '        lda #1\r\n        rts\r\n')).toEqual({ name: 'by hand', lang: 'kickass', source: '        lda #1\n        rts\n', pads: [] });
    expect(readScriptFile('by hand.js', 'print(1)')).toEqual({ name: 'by hand', lang: 'kickass', code: 'js', source: 'print(1)', pads: [] });
    // a first line that only looks like it is code
    expect(readScriptFile('x.asm', '// mimir-script not json\n        rts')?.source).toBe('// mimir-script not json\n        rts');
  });

  it('leaves out what is not as it should be', () => {
    const text = `// mimir-script ${JSON.stringify({ lang: 'cobol', pads: [{ name: 'ok', start: 0xc000, size: 4 }, { name: '9bad', start: 0, size: 4 }, { name: 'far', start: 0xffff, size: 4 }, { name: 'd', start: 0xc100, size: 4, data: '!!!' }], safe: 'yes', init: { a: 999 }, machine: 'amiga', stopAt: 7, needs: ['fine', 'not a name', 3], table: 5 })}\n        rts`;
    expect(readScriptFile('odd.asm', text)).toEqual({ name: 'odd', lang: 'kickass', source: '        rts', pads: [{ name: 'ok', start: 0xc000, size: 4 }, { name: 'd', start: 0xc100, size: 4 }], needs: ['fine'] });
  });

  it('has a plain name: no folder, .asm or .js, not hidden', () => {
    for (const ok of ['a.asm', 'decrypt level.asm', 'x.JS', 'år_2.asm']) expect(isScriptFileName(ok)).toBe(true);
    for (const bad of ['a.txt', '../a.asm', 'sub/a.asm', 'sub\\a.asm', '.hidden.asm', '-x.asm', 'a.asm.exe', 'a:b.asm', '']) expect(isScriptFileName(bad)).toBe(false);
    expect(readScriptFile('../a.asm', 'rts')).toBeNull();
    expect(scriptFileName({ name: 'a/b:c?' })).toBe('a_b_c_.asm');
    expect(scriptFileName({ name: '...' })).toBe('script.asm');
  });

  it('fits a program that has every name it needs, as a label or as a routine known from another project', () => {
    const has = (n: string) => n === 'decrypt_level', known = (n: string) => n === 'unpack';
    expect(scriptFits({ needs: ['decrypt_level'] }, has, known)).toEqual({ fits: true, naming: [] });
    expect(scriptFits({ needs: ['decrypt_level', 'unpack'] }, has, known)).toEqual({ fits: true, naming: ['unpack'] });
    expect(scriptFits({ needs: ['decrypt_level', 'other'] }, has, known).fits).toBe(false);
    // a script that needs nothing fits no program in particular
    expect(scriptFits({}, has, known).fits).toBe(false);
  });
});
