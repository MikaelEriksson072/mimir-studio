/* Sindri for a JavaScript script (spec 10.3): the unpacker run on a packed file, a disassembly, a BASIC listing, a whole
 * C64 to run code in, and the files a run makes with save(). */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_PACK, makeDemo, packWithBrokkr, parsePrg, runJs, type ScriptEnv, type UserScript } from '../src';
import { findC64Roms } from '../src/node';
import { fromSource } from './helpers/programs';

const roms = findC64Roms();
const demo = makeDemo();
const demoFile = parsePrg(demo.name, demo.prg);
const js = (lines: string[], pads: UserScript['pads'] = []): UserScript => ({ id: 's', name: 's', lang: 'kickass', code: 'js', source: lines.join('\n'), pads });
const packed = async () => {
  const p = await packWithBrokkr([{ name: demo.name, prg: demo.prg }], { ...DEFAULT_PACK, format: 'exomizer', effect: 'none' });
  return parsePrg('packed.prg', p.prg!);
};
/** a program with a BASIC line (10 SYS2064) and a routine that adds X to A and writes the sum to the screen's corner */
const small = fromSource('small.prg', [
  '.pc = $0801', '.byte $0b, $08, $0a, $00, $9e, $32, $30, $36, $34, $00, $00, $00',
  '.pc = $0810',
  'add:    stx $fb', '        clc', '        adc $fb', '        sta $0400', '        rts',
  'forever: jmp forever',
].join('\n'));
const smallEnv: ScriptEnv = { files: [small], names: new Map([['add', 0x0810], ['forever', 0x0819]]) };

describe('sindri in a JavaScript script', () => {
  it('unpacks the program\'s packed file: the packer, the layers, the program it was made from, saved as a file', async () => {
    const env: ScriptEnv = { files: [await packed()], names: new Map() };
    const run = runJs(env, js([
      'const r = sindri.unpack();',
      'print(r.unpacked, r.packer, hex(r.entry), hex(r.port, 2), r.layers.length, r.layers[r.layers.length - 1].kind);',
      'print(r.end - r.start === r.bytes.length, r.prg.length === r.bytes.length + 2, (r.prg[0] | r.prg[1] << 8) === r.start, typeof r.stop, r.cycles > 0);',
      'print(r.layers[0].written.length > 0, r.layers[0].written[0].end > r.layers[0].written[0].start, typeof r.layers[0].what);',
      'save("unpacked.prg", r.bytes, r.start);',
    ]));
    expect(run.error).toBeUndefined();
    expect(run.prints![0]).toBe('true Brokkr / Exomizer format (stage 1) → Brokkr / Exomizer format (depacker) $0810 $37 3 program');
    expect(run.prints![1]).toBe('true true true string true');
    expect(run.prints![2]).toBe('true true string');
    expect(run.made).toHaveLength(1);
    const made = run.made![0];
    expect(made.name).toBe('unpacked.prg');
    expect(made.load).toBeLessThanOrEqual(demoFile.load);
    expect(made.bytes.subarray(demoFile.load - made.load!, demoFile.load - made.load! + demoFile.bytes.length)).toEqual(demoFile.bytes);
    // the program's own bytes are as they were: unpacking is Sindri's, in a machine of its own
    expect(run.changes).toEqual([]);
  });

  it('unpacks a PRG it is given, and one that is not packed is said to be so', async () => {
    const env: ScriptEnv = { files: [await packed()], names: new Map() };
    const run = runJs(env, js(['const r = sindri.unpack(sindri.prg(files[0].start, files[0].end), { disk: false });', 'print(r.unpacked, hex(r.entry));',
      'const plain = sindri.unpack(r.prg);', 'print(plain.unpacked, plain.layers.length);',
      'try { sindri.unpack([1, 2]); } catch (e) { print(e.message); }', 'try { sindri.unpack("no"); } catch (e) { print(e.message); }']));
    expect(run.error).toBeUndefined();
    expect(run.prints![0]).toBe('true $0810');
    expect(run.prints![1]).toBe('false 1');
    expect(run.prints![2]).toMatch(/a PRG is its load address and at least a byte/);
    expect(run.prints![3]).toMatch(/^sindri\.unpack: bytes are wanted/);
  });

  it('disassembles, lists BASIC, finds the SYS and makes a PRG of a stretch of mem', () => {
    const run = runJs(smallEnv, js([
      'sindri.disassemble("add", 3).forEach(l => print(l));',
      'print(sindri.disassemble(0xc000, 9, [0xa9, 0x01, 0x60]).join("|"));',
      'print(sindri.basic().join("|"), hex(sindri.sys()), sindri.sys(0x0810));',
      'const p = sindri.prg("add", addr("add") + 4);', 'print(p.length, hex(p[0] | p[1] << 8), hex(p[2], 2), sindri.roms);',
      'try { sindri.prg(0x1000, 0x1000); } catch (e) { print(e.message); }',
    ]));
    expect(run.error).toBeUndefined();
    expect(run.prints!.slice(0, 3)).toEqual(['$0810  86 fb     stx $fb', '$0812  18        clc', '$0813  65 fb     adc $fb']);
    expect(run.prints![3]).toBe('$c000  a9 01     lda #$01|$c002  60        rts');
    expect(run.prints![4]).toBe('10 SYS2064 $0810 null');
    expect(run.prints![5]).toBe('6 $0810 $86 stand-ins');
    expect(run.prints![6]).toMatch(/the end \(\$1000\) is not after the start \(\$1000\)/);
  });

  it('save() lists the files a run made, with safe names, and wants bytes', () => {
    const run = runJs(smallEnv, js(['save("a/b:c.bin", mem.subarray(0x0810, 0x0814));', 'save("- x", [1, 2, 3], "add");', 'try { save("y", 12); } catch (e) { print(e.message); }']));
    expect(run.error).toBeUndefined();
    expect(run.made!.map(m => [m.name, m.load, [...m.bytes]])).toEqual([['a_b_c.bin', null, [0x86, 0xfb, 0x18, 0x65]], ['x', 0x0810, [1, 2, 3]]]);
    expect(run.prints).toEqual(['save: bytes are wanted (a Uint8Array, such as mem.subarray(…) or what sindri.unpack gave)']);
    // a run that made none has no list
    expect(runJs(smallEnv, js(['print(1);'])).made).toBeUndefined();
  });

  it('a whole C64 needs the ROMs, and says so', () => {
    const run = runJs(smallEnv, js(['sindri.c64();']), { roms: null });
    expect(run.error?.msg).toMatch(/sindri\.c64 needs the C64's ROM files/);
  });
});

describe.skipIf(!roms)('sindri.c64 in a JavaScript script (VICE\'s ROMs)', () => {
  it('is a C64 at READY with the program in its RAM: its screen, a routine called, keys typed, a run to an address', () => {
    const run = runJs(smallEnv, js([
      'const m = sindri.c64();',
      'print(m.screen()[1].trim(), "/", m.screen().find(l => l.startsWith("READY")));',
      'print(hex(m.mem[0x0810], 2), hex(m.peek(0xe000), 2) === hex(m.mem[0xe000], 2), sindri.roms !== "stand-ins");',
      'const r = m.call("add", { a: 40, x: 2 });',
      'print(r.a, m.a, m.mem[0x0400], m.screen()[0].length > 0, m.cycles > 0);',
      // RUN typed at the prompt gets to the SYS address
      'm.type("RUN\\r");', 'const s = m.run({ until: "add", cycles: 3000000 });', 'print(s.reason, hex(s.pc), s.cycles > 0);',
      'const t = m.run({ cycles: 1000 });', 'print(t.reason, t.cycles >= 1000);',
      'm.pc = 0xc000; m.a = 0x1ff; m.load([0xa9, 0x07, 0x60], 0xc000);', 'print(hex(m.pc), m.a, hex(m.mem[0xc001], 2), m.call(0xc000).a);',
      'try { m.call("forever", { cycles: 5000 }); } catch (e) { print(e.message); }',
      // the script's own memory is another: the C64's RAM is its own
      'print(mem[0x0400]);',
    ]), { roms });
    expect(run.error).toBeUndefined();
    expect(run.prints![0]).toBe('**** COMMODORE 64 BASIC V2 **** / READY.');
    expect(run.prints![1]).toBe('$86 false true');
    expect(run.prints![2]).toBe('42 42 42 true true');
    expect(run.prints![3]).toBe('until $0810 true');
    expect(run.prints![4]).toBe('cycles true');
    expect(run.prints![5]).toBe('$c000 255 $07 7');
    expect(run.prints![6]).toMatch(/the routine called at \$0819 did not return after 5,000 cycles \(it was at \$0819\)/);
    // (a space: $0400 of the script's memory is its own C64 screen, cleared)
    expect(run.prints![7]).toBe('32');
    expect(run.changes).toEqual([]);
  });

  it('has the mounted disk in its 1541: LOAD"$",8 typed lists it', () => {
    const disk = new Uint8Array(readFileSync(join(__dirname, '../../../fixtures/d64/mimir-demo.d64')));
    const run = runJs(smallEnv, js([
      'const m = sindri.c64({ program: false });',
      'm.type("LOAD\\"$\\",8\\r");', 'm.run({ cycles: 12000000 });',
      'm.type("LIST\\r");', 'm.run({ cycles: 3000000 });',
      'print(m.screen().filter(l => l).join("|"));',
    ]), { roms, disk });
    expect(run.error).toBeUndefined();
    expect(run.prints![0]).toMatch(/SEARCHING FOR \$\|LOADING\|READY\./);
    expect(run.prints![0]).toMatch(/MIMIR DEMO/);
    expect(run.prints![0]).toMatch(/"SPRITE"\s+PRG/);
  });
});
