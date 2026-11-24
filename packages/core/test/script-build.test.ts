/* Building and running for a JavaScript script (spec 10.3): the last build read, and the builds and starts a run ends
 * with. */
import { describe, expect, it } from 'vitest';
import { buildRequestText, runJs, type ScriptBuildData, type ScriptEnv, type UserScript } from '../src';
import { fromSource } from './helpers/programs';

const program = fromSource('p.prg', ['.pc = $0810', 'start: rts'].join('\n'));
const env: ScriptEnv = { files: [program], names: new Map([['start', 0x0810]]) };
const js = (lines: string[]): UserScript => ({ id: 's', name: 's', lang: 'kickass', code: 'js', source: lines.join('\n'), pads: [] });
const data = (last: ScriptBuildData['last'] = null): ScriptBuildData => ({ assembler: 'kickass', emulator: 'VICE', debugger: 'Retro Debugger', last });
const built: NonNullable<ScriptBuildData['last']> = { ok: false, fresh: true, by: 'built-in', log: 'Round-trip OK\n', files: [
  { name: 'p.prg', source: 'p.asm', ok: true, same: 1, total: 1, prg: Uint8Array.of(0x10, 0x08, 0x60), errors: [] },
  { name: 'q.prg', source: 'q.asm', ok: false, same: 0, total: 4, prg: null, errors: ['q.asm:3  unknown label'] },
] };
const run = (lines: string[], d: ScriptBuildData | null = data()) => runJs(env, js(lines), { build: d });

describe('build in a JavaScript script', () => {
  it('says what builds and runs the project, and has no last build before one', () => {
    const r = run(['print(build.assembler, build.emulator, build.debugger, build.last, build.requests.length);']);
    expect(r.prints).toEqual(['kickass VICE Retro Debugger null 0']);
    expect(r.builds).toBeUndefined();
  });

  it('reads the last build: each file\'s PRG, where it loads, and what the assembler said', () => {
    const r = run([
      'const b = build.last;', 'print(b.ok, b.fresh, b.by, b.log.trim(), b.files.length);',
      'print(b.files.map(f => [f.name, f.source, f.ok, f.same + "/" + f.total, f.start === null ? "-" : hex(f.start), f.end === null ? "-" : hex(f.end), f.bytes ? f.bytes.length : "-", f.prg ? f.prg.length : "-", f.errors.join(";")].join(",")).join(" | "));',
    ], data(built));
    expect(r.error).toBeUndefined();
    expect(r.prints).toEqual(['false true built-in Round-trip OK 2', 'p.prg,p.asm,true,1/1,$0810,$0811,1,3, | q.prg,q.asm,false,0/4,-,-,-,-,q.asm:3  unknown label']);
  });

  it('ends the run with what it asked for, in order: verify, Build & Run, a PRG of its own started', () => {
    const r = run([
      'build.verify();', 'build.run();', 'build.run({ debugger: true });',
      'build.start(sindri.prg("start", addr("start") + 1), { name: "my file", start: "start" });',
      'build.start([0x01, 0x08, 0x60], { debugger: true });',
      'build.requests.forEach(t => print(t));',
    ]);
    expect(r.error).toBeUndefined();
    expect(r.builds).toEqual([{ kind: 'verify' }, { kind: 'run', debugger: false }, { kind: 'run', debugger: true },
      { kind: 'start', name: 'my file.prg', prg: Uint8Array.of(0x10, 0x08, 0x60), start: 0x0810, debugger: false },
      { kind: 'start', name: 'script.prg', prg: Uint8Array.of(0x01, 0x08, 0x60), start: null, debugger: true }]);
    expect(r.prints).toEqual(['Verify: the round-trip check (as F7)', 'Build & Run in VICE (as F5)', 'Build & Run in Retro Debugger (as Shift+F5)',
      'my file.prg (1 bytes, loads at $0810) started in VICE with SYS 2064', 'script.prg (1 bytes, loads at $0801) started in Retro Debugger with RUN']);
    expect(buildRequestText(r.builds![1])).toBe('Build & Run in VICE (as F5)');
  });

  it('asks for nothing when the run stops with an error, takes eight requests at most, and says what it does not take', () => {
    const failed = run(['build.run();', 'throw new Error("no");']);
    expect(failed.builds).toBeUndefined();
    const many = run(['for (let i = 0; i < 9; i++) build.verify();']);
    expect(many.error?.msg).toBe('RangeError: build.verify: a run asks for 8 builds and starts at most');
    const bad = run(['for (const f of [() => build.start("x"), () => build.start([1, 2]), () => build.start([1, 8, 0], { start: "nowhere" })]) try { f(); print("ok"); } catch (e) { print(e.message); }']);
    expect(bad.prints![0]).toMatch(/^build\.start: a PRG is wanted, its load address first/);
    expect(bad.prints![1]).toBe('build.start: a PRG is its load address and at least a byte');
    expect(bad.prints![2]).not.toBe('ok');
    const none = run(['print(typeof build);', 'build.run();'], null);
    expect(none.prints).toEqual(['object']);
    expect(none.error?.msg).toMatch(/^Error: build: there is nothing to build here/);
  });
});
