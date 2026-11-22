/* The script templates in JavaScript (spec 10.3): each run as it is added, and with its settings set, on a program
 * that has what it is for. */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkScript, JS_TEMPLATES, parseD64, readD64File, runJs, scriptParams, setScriptParams, templateSource, type ScriptEnv, type ScriptTemplate } from '../src';
import { fromSource } from './helpers/programs';

const KEY = 0x5a, TEXT = 'HELLO FROM THE GAME', SCREEN = 'GAME OVER';
const plain = [...TEXT].map(c => c.charCodeAt(0));
/** a program with an encrypted text, a plain one in PETSCII and one in screen codes, a jump table in two halves,
 *  run-length data and a routine that doubles A */
const program = fromSource('game.prg', [
  '.pc = $0810',
  'double: asl', '        rts',
  'r0:     lda #0', '        rts',
  'r1:     lda #1', '        rts',
  'r2:     sta $d020', '        rts',
  '.pc = $0900',
  'lo:     .byte <r0, <r1, <r2, <r0',
  '.pc = $0910',
  'hi:     .byte >r0, >r1, >r2, >r0',
  '.pc = $0920',
  `crypted: .byte ${plain.map(b => b ^ KEY).join(', ')}`,
  '.pc = $0940',
  `petscii: .byte ${plain.join(', ')}, 0`,
  '.pc = $0960',
  `screen: .byte 0, ${[...SCREEN].map(c => (c === ' ' ? 32 : c.charCodeAt(0) - 64)).join(', ')}, 0`,
  '.pc = $0980',
  'packed: .byte 3, $aa, 2, $bb, 5, $00, 1, $cc, 0',
].join('\n'));
const at = (b: number[]) => { for (let a = 0; a < program.bytes.length; a++) if (b.every((v, k) => program.bytes[a + k] === v)) return program.load + a; throw new Error('not there'); };
const R2 = at([0x8d, 0x20, 0xd0]);
const env: ScriptEnv = { files: [program], names: new Map([['double', 0x0810], ['lo', 0x0900], ['hi', 0x0910], ['crypted', 0x0920], ['packed', 0x0980]]) };
const template = (name: string) => JS_TEMPLATES.find(t => t.name === name)!;
/** the template run with these settings (its scratchpads at $c000 on) */
const run = (t: ScriptTemplate, values: Record<string, string> = {}, extras = {}) => {
  const set = setScriptParams(t.source, { code: 'js' }, values);
  expect(set.skipped).toEqual([]);
  let start = 0xc000;
  const pads = t.pads.map(p => { const q = { ...p, start }; start += p.size; return q; });
  return runJs(env, { source: set.source, pads }, extras);
};

describe('the JavaScript templates', () => {
  it('are seven, each JavaScript with a comment that says what it does and settings the Settings tab shows', () => {
    expect(JS_TEMPLATES.map(t => t.name)).toEqual(['xor_js', 'find_text', 'find_bytes', 'jump_table', 'rle_unpack', 'disk_files', 'call_many']);
    for (const t of JS_TEMPLATES) {
      expect(t.code).toBe('js');
      expect(t.source.startsWith(`// ${'='.repeat(76)}\n//  `)).toBe(true);
      expect(t.source.split('\n')[1]).toContain('Mimir template');
      expect(scriptParams(t.source, { code: 'js' }).length).toBeGreaterThan(0);
      // each setting's line says what it is
      for (const p of scriptParams(t.source, { code: 'js' })) expect(p.comment.length, `${t.name}.${p.name}`).toBeGreaterThan(8);
      // JavaScript is as it is in a 64tass project too
      expect(templateSource(t, '64tass')).toBe(t.source);
      expect(checkScript(env, { source: t.source, code: 'js', pads: t.pads.map((p, i) => ({ ...p, start: 0xc000 + i * 0x4000 })) }).ok).toBe(true);
    }
    expect(template('call_many').safe).toBe(true);
  });

  it('XOR key byte decrypts a block into the scratchpad, or in place', () => {
    const r = run(template('xor_js'), { source: '"crypted"', length: String(plain.length), key: '0x5a' });
    expect(r.error).toBeUndefined();
    expect([...r.pads[0].bytes.subarray(0, plain.length)]).toEqual(plain);
    expect(r.changes).toEqual([]);
    expect(r.prints).toEqual([`$0920-$${(0x0920 + plain.length - 1).toString(16).padStart(4, '0')} EOR $5a -> $c000`]);
    const inPlace = run(template('xor_js'), { source: '0x0920', dest: '0x0920', length: String(plain.length), key: '0x5a' });
    expect([...inPlace.changes[0].bytes]).toEqual(plain);
    expect(run(template('xor_js'), { length: '0x1000' }).error?.msg).toContain('length is more than the scratchpad result holds');
  });

  it('Find text finds the texts in PETSCII or in screen codes, and marks them when asked', () => {
    const r = run(template('find_text'));
    expect(r.error).toBeUndefined();
    expect(r.prints).toEqual([`$0940-$${(0x0940 + TEXT.length - 1).toString(16).padStart(4, '0')}  ${TEXT}`, '1 text found']);
    expect(r.actions).toBeUndefined();
    const sc = run(template('find_text'), { screenCodes: 'true', markThem: 'true' });
    expect(sc.prints).toEqual([`$0961-$${(0x0961 + SCREEN.length - 1).toString(16).padStart(4, '0')}  ${SCREEN}`, '1 text found']);
    expect(sc.actions).toEqual([{ kind: 'mark', line: 0, start: 0x0961, end: 0x0961 + SCREEN.length, as: 'textsc' }]);
    expect(run(template('find_text'), { minLength: '40' }).prints).toEqual(['0 texts found']);
  });

  it('Find bytes finds a pattern, ?? for any byte', () => {
    const r = run(template('find_bytes'));
    expect(r.prints).toEqual([`$${R2.toString(16).padStart(4, '0')}  8d 20 d0 `, '1 place']);
    const any = run(template('find_bytes'), { pattern: '"a9 ?? 60"' });
    expect(any.prints).toHaveLength(3);
    expect(any.prints![2]).toBe('2 places');
    expect(run(template('find_bytes'), { pattern: '"zz"' }).error?.msg).toContain('pattern is hex bytes');
  });

  it('Name a jump table prints where its entries go, and names them when asked', () => {
    const t = template('jump_table');
    const r = run(t, { lo: '"lo"', hi: '"hi"', count: '4' });
    expect(r.error).toBeUndefined();
    expect(r.prints).toEqual(['  0  $0812  routine_00', '  1  $0815  routine_01', `  2  $${R2.toString(16).padStart(4, '0')}  routine_02`, '  3  $0812  (as an entry before)']);
    expect(r.actions).toBeUndefined();
    const named = run(t, { lo: '0x0900', hi: '0x0910', count: '4', prefix: '"state"', nameThem: 'true' });
    expect(named.actions).toEqual([
      { kind: 'name', line: 0, at: 0x0812, name: 'state_00' }, { kind: 'name', line: 0, at: 0x0815, name: 'state_01' }, { kind: 'name', line: 0, at: R2, name: 'state_02' }]);
    // a table of addresses less one
    expect(run(t, { lo: '"lo"', hi: '"hi"', count: '1', plusOne: 'true' }).prints).toEqual(['  0  $0813  routine_00']);
  });

  it('Unpack RLE unpacks counts and bytes into the scratchpad', () => {
    const r = run(template('rle_unpack'), { source: '"packed"' });
    expect(r.error).toBeUndefined();
    expect([...r.pads[0].bytes.subarray(0, 12)]).toEqual([0xaa, 0xaa, 0xaa, 0xbb, 0xbb, 0, 0, 0, 0, 0, 0xcc, 0]);
    expect(r.prints).toEqual(['9 packed bytes -> 11 unpacked, at $c000']);
    expect(r.changes).toEqual([]);
  });

  it('Read the disk lists the directory, and copies a file into the scratchpad', () => {
    const disk = new Uint8Array(readFileSync(join(__dirname, '../../../fixtures/d64/mimir-demo.d64')));
    const sprite = readD64File(disk, parseD64(disk).files.find(f => f.name === 'SPRITE')!);
    const dir = run(template('disk_files'), {}, { disk });
    expect(dir.error).toBeUndefined();
    expect(dir.prints![0]).toMatch(/^MIMIR DEMO  /);
    expect(dir.prints!.slice(1).map(l => l.trim().split(/\s{2,}/))).toEqual([
      ['49', 'RASTER DEMO', 'PRG', expect.stringMatching(/^\$0801-\$[0-9a-f]{4}$/)], ['1', 'SPRITE', 'PRG', `$c000-$${(0xc000 + sprite.length - 3).toString(16)}`], ['1', 'NOTES', 'SEQ']]);
    const one = run(template('disk_files'), { fileName: '"SPRITE"' }, { disk });
    expect(one.prints).toEqual([`SPRITE: ${sprite.length - 2} bytes, loads at $c000`]);
    expect([...one.pads[0].bytes.subarray(0, sprite.length - 2)]).toEqual([...sprite.subarray(2)]);
    expect(run(template('disk_files')).error?.msg).toBe('Error: no disk is mounted: File, Mount disk image');
  });

  it('Call a routine calls it with every value and prints what it gives back', () => {
    const r = run(template('call_many'), { routine: '"double"', first: '126', last: '129' });
    expect(r.error).toBeUndefined();
    expect(r.prints).toEqual(['A=$7e  ->  A=$fc X=$00 Y=$00', 'A=$7f  ->  A=$fe X=$00 Y=$00', 'A=$80  ->  A=$00 X=$00 Y=$00  carry set', 'A=$81  ->  A=$02 X=$00 Y=$00  carry set']);
  });
});
