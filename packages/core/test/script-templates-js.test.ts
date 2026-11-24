/* The script templates in JavaScript (spec 10.3): each run as it is added, and with its settings set, on a program
 * that has what it is for. */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkScript, DEFAULT_PACK, JS_TEMPLATES, makeDemo, packWithBrokkr, parsePrg, parseD64, readD64File, runJs, scriptParams, setScriptParams, templateSource, type ScriptEnv, type ScriptTemplate } from '../src';
import { findC64Roms } from '../src/node';
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
  it('are fourteen, each JavaScript with a comment that says what it does and settings the Settings tab shows', () => {
    expect(JS_TEMPLATES.map(t => t.name)).toEqual(['xor_js', 'find_text', 'find_bytes', 'jump_table', 'rle_unpack', 'disk_files', 'call_many', 'sindri_unpack', 'sindri_run', 'brokkr_pack', 'loader_files', 'export_own', 'screen_show', 'screen_hexdump']);
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

  it('Show a screen puts the screen codes, colours and character set of the program on the C64 screen', () => {
    const r = run(template('screen_show'), { screenAt: '0x0960', colorsAt: '"packed"', border: '"black"', background: '0' });
    expect(r.error).toBeUndefined();
    const s = r.screen!;
    expect(s).toMatchObject({ cols: 40, rows: 25, border: 0, background: 0, wrote: true });
    expect([...s.codes.subarray(1, 10)]).toEqual([...SCREEN].map(c => (c === ' ' ? 32 : c.charCodeAt(0) - 64)));
    expect(s.colors[0]).toBe(3);
    expect(s.font).toBeUndefined();
    expect(r.prints).toEqual(['Shown: $0960-$0d47, colours from $0980']);
    expect(run(template('screen_show'), { charsetAt: '0x0800' }).screen!.font!.length).toBe(2048);
  });

  it('Hex dump on the screen fills the rows of the screen, more bytes a row on a wider screen', () => {
    const r = run(template('screen_hexdump'), { start: '"crypted"' });
    expect(r.error).toBeUndefined();
    const s = r.screen!, row0 = [...s.codes.subarray(0, 40)];
    // "0920 " in yellow, then the bytes
    expect(row0.slice(0, 4)).toEqual([0x30, 0x39, 0x32, 0x30]);
    expect(s.colors[0]).toBe(7);
    expect(r.prints).toEqual(['A dump of $0920 on the C64 screen: 8 bytes a row, 40 x 25']);
    const wide = run(template('screen_hexdump'), { start: '"crypted"' }, { screen: { cols: 80, rows: 30 } });
    expect(wide.prints).toEqual(['A dump of $0920 on the C64 screen: 16 bytes a row, 80 x 30']);
    // the 29th row (the last of the dump) starts at $0920 + 28 * 16
    expect([...wide.screen!.codes.subarray(28 * 80, 28 * 80 + 4)]).toEqual([0x30, 0x01, 0x05, 0x30]);
  });
});

describe('the JavaScript templates that use Sindri', () => {
  const demo = makeDemo(), demoFile = parsePrg(demo.name, demo.prg), roms = findC64Roms();
  const runIn = (e: ScriptEnv, t: ScriptTemplate, values: Record<string, string>, extras = {}) => runJs(e, { source: setScriptParams(t.source, { code: 'js' }, values).source, pads: [] }, extras);

  it('Unpack with Sindri prints the layers and makes a file of the unpacked program', async () => {
    const p = await packWithBrokkr([{ name: demo.name, prg: demo.prg }], { ...DEFAULT_PACK, format: 'exomizer', effect: 'none' });
    const r = runIn({ files: [parsePrg('packed.prg', p.prg!)], names: new Map() }, template('sindri_unpack'), {});
    expect(r.error).toBeUndefined();
    expect(r.prints).toHaveLength(4);
    expect(r.prints![0]).toMatch(/^0  \$[0-9a-f]{4}  \S/);
    expect(r.prints![3]).toMatch(/^Unpacked \(Brokkr \/ Exomizer format \(stage 1\) → Brokkr \/ Exomizer format \(depacker\)\): \$[0-9a-f]{4}-\$[0-9a-f]{4}, \d+ bytes, starts at \$0810, \$01 = \$37$/);
    expect(r.made).toHaveLength(1);
    const made = r.made![0];
    expect(made.name).toBe('unpacked.prg');
    expect(made.bytes.subarray(demoFile.load - made.load!, demoFile.load - made.load! + demoFile.bytes.length)).toEqual(demoFile.bytes);
    expect(r.changes).toEqual([]);
  });

  it('Unpack with Sindri takes a file of the disk by its name, says when one is not packed, and makes no file with no name', () => {
    const disk = new Uint8Array(readFileSync(join(__dirname, '../../../fixtures/d64/mimir-demo.d64')));
    const r = runIn({ files: [demoFile], names: new Map() }, template('sindri_unpack'), { fileName: '"SPRITE"' }, { disk });
    expect(r.error).toBeUndefined();
    expect(r.prints![r.prints!.length - 1]).toMatch(/^Not unpacked\. /);
    expect(r.made).toBeUndefined();
    expect(runIn({ files: [demoFile], names: new Map() }, template('sindri_unpack'), { fileName: '"SPRITE"' }).error?.msg).toBe('Error: No disk is mounted: fileName needs one');
  });

  it.skipIf(!roms)('Run in a C64 starts the program with RUN, prints the screen and makes a file of its memory', () => {
    const e: ScriptEnv = { files: [demoFile], names: new Map() };
    const r = runIn(e, template('sindri_run'), { seconds: '1', saveFrom: '0x0400', saveTo: '0x07e8' }, { roms });
    expect(r.error).toBeUndefined();
    expect(r.prints![0]).toMatch(/^Ran 1 s, now at \$[0-9a-f]{4} after \d+ cycles; \$01 = \$3[0-7]$/);
    expect(r.prints!.length).toBeGreaterThan(1);
    expect(r.made!.map(m => [m.name, m.load, m.bytes.length])).toEqual([['memory_0400.prg', 0x0400, 1000]]);
    // the C64 screen of the script shows the C64's own
    expect(r.screen).toMatchObject({ cols: 40, rows: 25, wrote: true });
    // to an address: the demo's start, which RUN's SYS gets to
    const s = runIn(e, template('sindri_run'), { seconds: '2', stopAt: '0x0810' }, { roms });
    expect(s.prints![0]).toMatch(/^Got to \$0810 after \d+ cycles/);
    expect(s.made).toBeUndefined();
    // without the ROMs it says what it needs
    expect(runIn(e, template('sindri_run'), {}).error?.msg).toMatch(/sindri\.c64 needs the C64's ROM files/);
  });
});

describe('the JavaScript template that uses Brokkr', () => {
  it('Pack with Brokkr prints each format\'s size, checks the packed file with Sindri and makes a file of it', () => {
    const demo = makeDemo(), demoFile = parsePrg(demo.name, demo.prg);
    const go = (values: Record<string, string>) => runJs({ files: [demoFile], names: new Map() }, { source: setScriptParams(template('brokkr_pack').source, { code: 'js' }, values).source, pads: [] });
    const r = go({});
    expect(r.error).toBeUndefined();
    expect(r.prints).toHaveLength(5);
    for (const [i, f] of ['exomizer', 'brokkr', 'fast'].entries()) expect(r.prints![i]).toMatch(new RegExp(`^${f} +\\d+ bytes +[\\d.]+ % smaller  unpacks in [\\d.]+ s$`));
    expect(r.prints![3]).toMatch(new RegExp(`^Packed \\(exomizer\\): ${demo.prg.length} -> \\d+ bytes, starts at \\$0810$`));
    expect(r.prints![4]).toBe('Checked: Sindri unpacks it to the program, byte for byte');
    expect(r.made!.map(m => [m.name, m.load])).toEqual([['packed.prg', 0x0801]]);
    expect(r.made![0].bytes.length).toBeLessThan(demo.prg.length);
    expect(r.changes).toEqual([]);
    // another format, unchecked, and no file
    const o = go({ format: '"brokkr"', check: 'false', saveAs: '""' });
    expect(o.prints![3]).toMatch(/^Packed \(brokkr\): /);
    // Brokkr's warnings are printed: its own format's decruncher has no room but on the screen here
    expect(o.prints!.slice(4)).toEqual([expect.stringMatching(/^Warning: The decruncher runs on the screen /)]);
    expect(o.made).toBeUndefined();
  });
});

describe('the JavaScript template that writes the export', () => {
  it('Export with a header and a file list puts the line first in each source, adds the list and asks for the export', () => {
    const t = template('export_own');
    const data = { name: 'demo', assembler: 'kickass', folder: null as string | null, main: 'a.asm', sources: ['a.asm', 'b.asm'], outDir: 'out',
      files: { 'a.asm': '.pc = $0810\n', 'b.asm': '.pc = $2000\n', 'build.bat': 'x', 'bin/a.bin': Uint8Array.of(1, 2) } };
    const go = (values: Record<string, string>, d = data) => runJs(env, { source: setScriptParams(t.source, { code: 'js' }, values).source, pads: [] }, { export: d });
    const r = go({});
    expect(r.error).toBeUndefined();
    expect(r.prints).toEqual(['demo (kickass): 5 files to a folder that is asked for', 'Changed: a.asm, b.asm', 'Added: FILES.txt']);
    expect(r.exports!.files['a.asm']).toBe('// Exported by a script\n.pc = $0810\n');
    expect(r.exports!.files['b.asm']).toBe('// Exported by a script\n.pc = $2000\n');
    expect((r.exports!.files['FILES.txt'] as string).split('\n').slice(0, 4).map(l => l.split(/\s+/))).toEqual([['a.asm', '36', 'source'], ['b.asm', '36', 'source'], ['build.bat', '1', 'script'], ['bin/a.bin', '2', 'binary']]);
    expect(r.exports).toMatchObject({ changed: ['a.asm', 'b.asm'], removed: [], elsewhere: false });
    // 64tass comments, no list, elsewhere
    const o = go({ listFile: '""', elsewhere: 'true', header: '"x"' }, { ...data, assembler: '64tass', folder: 'C:\\p\\source' });
    expect(o.prints![0]).toBe('demo (64tass): 4 files to a folder that is asked for');
    expect(o.exports!.files).toEqual({ 'a.asm': '; x\n.pc = $0810\n', 'b.asm': '; x\n.pc = $2000\n' });
    expect(o.exports!.elsewhere).toBe(true);
    expect(go({ header: '""', listFile: '""' }, { ...data, folder: 'C:\\p\\source' }).prints).toEqual(['demo (kickass): 4 files to C:\\p\\source']);
  });
});
