/* User scripts in JavaScript (spec 10.3): one memory with the program and the scratchpads, the program's names, its own
 * 6510 code called, the disk, what a run prints and marks up, and what it throws. */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkScript, endedWell, fileRunPlan, fileRunResults, newScript, parseD64, readD64File, runJs, runScript, scriptEndText, type ScriptEnv, type UserScript } from '../src';
import { fromSource } from './helpers/programs';

const KEY = 0x5a;
const PLAIN = [...'HELLO, SCRIPTS!!'].map(c => c.charCodeAt(0));
/** a program with a block encrypted with EOR #$5a, its own loop that decrypts it in place, and a routine that adds */
const program = fromSource('crypt.prg', [
  '.pc = $0810',
  'decrypt: ldx #0',
  'loop:   lda data,x', `        eor #$${KEY.toString(16)}`, '        sta data,x', '        inx', '        cpx #16', '        bne loop', '        rts',
  'add:    stx $fb', '        clc', '        adc $fb', '        rts',
  'forever: jmp forever',
  'jam:    .byte $02',
  '.pc = $0840',
  `data:   .byte ${PLAIN.map(b => b ^ KEY).join(', ')}`,
].join('\n'));
const at = (b: number[]) => { for (let a = 0; a < program.bytes.length; a++) if (b.every((v, k) => program.bytes[a + k] === v)) return program.load + a; throw new Error('not there'); };
const env: ScriptEnv = { files: [program], names: new Map([['decrypt', 0x0810], ['add', at([0x86, 0xfb, 0x18])], ['forever', at([0x4c])], ['jam', at([0x02])], ['data', 0x0840]]) };
const js = (lines: string[], pads: UserScript['pads'] = []): UserScript => ({ id: 's', name: 's', lang: 'kickass', code: 'js', source: lines.join('\n'), pads });

describe('a script in JavaScript', () => {
  it('changes the program\'s bytes in mem by its names: they are the run\'s changes', () => {
    const s = js(['const d = addr("data");', `for (let i = 0; i < 16; i++) mem[d + i] ^= ${KEY};`]);
    const c = checkScript(env, s);
    expect(c).toMatchObject({ ok: true, problems: [], entry: null, bytes: 0 });
    const run = runScript(env, s, c);
    expect(run.end).toBe('rts');
    expect(endedWell(run.end)).toBe(true);
    expect(run.changes).toHaveLength(1);
    expect(run.changes[0]).toMatchObject({ start: 0x0840, end: 0x0850 });
    expect([...run.changes[0].bytes]).toEqual(PLAIN);
    expect(run.wrote).toEqual([{ start: 0x0840, end: 0x0850 }]);
    // the program in the env is as it was
    expect(program.bytes[0x30]).toBe(PLAIN[0] ^ KEY);
  });

  it('calls the program\'s own 6510 code with registers and gets them back', () => {
    const run = runJs(env, js(['cpu.call("decrypt");', 'const r = cpu.call("add", { a: 40, x: 2 });', 'print("sum", r.a, r.c, hex(addr("data")), hex(255, 2));', 'pad("out").set(mem.subarray(addr("data"), addr("data") + 16));'],
      [{ name: 'out', start: 0xc000, size: 16 }]));
    expect(run.error).toBeUndefined();
    expect(run.prints).toEqual(['sum 42 false $0840 $ff']);
    expect([...run.pads[0].bytes]).toEqual(PLAIN);
    expect(run.pads[0].wrote).toEqual([0, 16]);
    expect([...run.changes[0].bytes]).toEqual(PLAIN);
    expect(run.instructions).toBeGreaterThan(16 * 6);
    // a scratchpad's bytes are not the program's: no change, and not among what it wrote
    expect(run.changes).toHaveLength(1);
    expect(run.wrote!.some(r => r.start === 0xc000)).toBe(false);
  });

  it('ends with the error it throws and its line, keeping what it did until then', () => {
    const run = runJs(env, js(['mem[addr("data")] = 1;', 'const x = addr("nowhere");', 'mem[addr("data") + 1] = 2;']));
    expect(run.end).toBe('error');
    expect(endedWell(run.end)).toBe(false);
    expect(run.error).toEqual({ msg: 'ReferenceError: "nowhere" is not a name of the program or a scratchpad', line: 2 });
    expect(scriptEndText(run)).toBe('Stopped with an error on line 2: ReferenceError: "nowhere" is not a name of the program or a scratchpad');
    expect([run.mem[0x0840], run.mem[0x0841]]).toEqual([1, PLAIN[1] ^ KEY]);
    // a syntax error is said by the run
    expect(runJs(env, js(['for (;;'])).error?.msg).toMatch(/^SyntaxError: /);
    // code that never returns, and code that jams
    expect(runJs(env, js(['cpu.limit = 1000;', 'cpu.call("forever");'])).error?.msg).toMatch(/did not return after 1,000 instructions \(it was at \$[0-9a-f]{4}\)/);
    expect(runJs(env, js(['cpu.call("jam");'])).error?.msg).toMatch(/jammed at \$[0-9a-f]{4} \(a JAM opcode\)/);
    expect(runJs(env, js(['pad("none")'])).error?.msg).toBe('ReferenceError: "none" is not a scratchpad of the script (it has none)');
  });

  it('has nothing of the worker to reach out with', () => {
    const run = runJs(env, js(['print(typeof fetch, typeof self, typeof globalThis, typeof importScripts, typeof setTimeout, typeof process, typeof require);']));
    expect(run.prints).toEqual(['undefined undefined undefined undefined undefined undefined undefined']);
  });

  it('says what to do to the program beyond its bytes, as the directives do', () => {
    const run = runJs(env, js(['mark("data", addr("data") + 16, "text");', 'name("data", "secret");', 'note("decrypt", "decrypts the text");', 'junk(0x0850, 0x0858);']));
    expect(run.actions).toEqual([
      { kind: 'mark', line: 0, start: 0x0840, end: 0x0850, as: 'text' },
      { kind: 'name', line: 0, at: 0x0840, name: 'secret' },
      { kind: 'note', line: 0, at: 0x0810, text: 'decrypts the text' },
      { kind: 'junk', line: 0, start: 0x0850, end: 0x0858 },
    ]);
    expect(runJs(env, js(['mark("data", "data", "text")'])).error?.msg).toMatch(/^RangeError: the end \(\$0840\) is not after the start/);
    expect(runJs(env, js(['mark(0x0840, 0x0850, "poem")'])).error?.msg).toMatch(/^TypeError: mark: "poem" is no type/);
    expect(runJs(env, js(['name(0x0840, "9lives")'])).error?.msg).toMatch(/is no label/);
  });

  it('reads the mounted disk: its directory, a file, a sector', () => {
    const disk = new Uint8Array(readFileSync(join(__dirname, '../../../fixtures/d64/mimir-demo.d64')));
    const sprite = readD64File(disk, parseD64(disk).files.find(f => f.name === 'SPRITE')!);
    const run = runJs(env, js(['print(disk.name, disk.files.map(f => f.name + ":" + f.type).join(","));', 'const f = disk.read("SPRITE");', 'pad("out").set(f.subarray(2, 18));', 'print(f.length, hex(f[0] | f[1] << 8), disk.sector(18, 0).length);',
      'try { disk.sector(99, 0); } catch (e) { print(e.message); }'], [{ name: 'out', start: 0xc000, size: 16 }]), { disk });
    expect(run.error).toBeUndefined();
    expect(run.prints).toEqual(['MIMIR DEMO RASTER DEMO:PRG,SPRITE:PRG,NOTES:SEQ', `${sprite.length} $c000 256`, 'track 99 sector 0 is not on the disk']);
    expect([...run.pads[0].bytes]).toEqual([...sprite.subarray(2, 18)]);
    // without a disk it is null
    expect(runJs(env, js(['print(disk === null)'])).prints).toEqual(['true']);
  });

  it('runs on a file as an assembler script does: the file in its scratchpad, the result a file', () => {
    const s = { ...js(['const p = pad("inp");', `for (let i = 0; i < p.length; i++) p[i] ^= ${KEY};`, 'print(hex(addr("inp_load")), addr("inp_end") - addr("inp"));'], [{ name: 'inp', start: 0xc000, size: 4, role: 'file' }]), name: 'unxor' };
    const file = { name: 'LEVEL1', load: 0x6000, bytes: Uint8Array.from(PLAIN.map(b => b ^ KEY)) };
    const plan = fileRunPlan(env, s, file);
    if ('error' in plan) throw new Error(plan.error);
    const run = runScript(env, plan.script, plan.check);
    expect(run.prints).toEqual(['$6000 16']);
    expect(fileRunResults(plan, file, run, s.name)).toEqual([{ name: 'LEVEL1_unxor.prg', load: 0x6000, bytes: Uint8Array.from(PLAIN), from: 'file', pad: 'inp' }]);
  });

  it('checks its scratchpads, and starts as a script that does nothing', () => {
    const c = checkScript(env, js(['mem[0] = 1'], [{ name: 'a', start: 0xc000, size: 16 }, { name: 'a', start: 0xc100, size: 16 }]));
    expect(c.ok).toBe(false);
    expect(c.problems[0].msg).toBe('There are two scratchpads called "a".');
    const s = newScript([], [], 'id', '64tass', 'js');
    expect(s).toMatchObject({ name: 'script', lang: '64tass', code: 'js', pads: [] });
    expect(s.source.startsWith('// script: JavaScript that runs in Mimir.')).toBe(true);
    expect(runJs(env, s)).toMatchObject({ end: 'rts', changes: [] });
  });
});
