/* The scripts for a JavaScript script (spec 10.3): the project's scripts read, another script's code run as a library,
 * and what a run asks to be added, changed and run. */
import { describe, expect, it } from 'vitest';
import { planScriptsRequests, runJs, scriptsRequestText, type ScriptEnv, type ScriptScriptsData, type UserScript } from '../src';
import { fromSource } from './helpers/programs';

const program = fromSource('p.prg', ['.pc = $0810', 'start: rts', 'data: .byte 1, 2, 3, 4'].join('\n'));
const env: ScriptEnv = { files: [program], names: new Map([['start', 0x0810], ['data', 0x0811]]) };
const js = (lines: string[]): UserScript => ({ id: 's', name: 'main', lang: 'kickass', code: 'js', source: lines.join('\n'), pads: [] });
const LIB = ['const scale = 2;      // what each byte is multiplied by', 'const sum = (a, n) => { let s = 0; for (let i = 0; i < n; i++) s += mem[a + i]; return s * scale; };', 'print("lib loaded, scale " + scale);', 'return { sum, scale };'].join('\n');
const data = (): ScriptScriptsData => ({ self: 'main', scripts: [
  { name: 'main', lang: 'kickass', code: 'js', source: '// the one that runs', key: 'Alt+1' },
  { name: 'lib', lang: 'kickass', code: 'js', source: LIB, safe: true, pads: [{ name: 'pad1', start: 0xc000, size: 16 }] },
  { name: 'decrypt', lang: 'kickass', source: '.var key = $5a   // the key\n        rts', when: 'build' },
  { name: 'broken', lang: 'kickass', code: 'js', source: 'const x = 1;\nthrow new Error("bad " + x);' },
  { name: 'loop', lang: 'kickass', code: 'js', source: 'return scripts.call("loop");' },
], library: [{ name: 'shared', lang: 'kickass', code: 'js', source: 'const n = 1;   // a number\nreturn n;', when: 'load' }] });
const run = (lines: string[], d: ScriptScriptsData | null = data()) => runJs(env, js(lines), { scripts: d });

describe('scripts in a JavaScript script', () => {
  it('lists the project\'s scripts, the library\'s and the templates', () => {
    const r = run([
      'print(scripts.names.join(), scripts.all.length, scripts.self.name, scripts.self.key, scripts.all.filter(s => s.self).length);',
      'const l = scripts.find("LIB");', 'print(l.name, l.code, l.lang, l.lines, l.safe, l.when, l.key, l.machine, JSON.stringify(l.pads), String(l));',
      'print(JSON.stringify(l.settings), l.setting("scale"), l.setting("nothing"));',
      'const d = scripts.find("decrypt");', 'print(d.code, d.when, d.settings.map(p => p.name + "=" + p.value).join(), scripts.find("nothing"));',
      'print(scripts.library.map(s => s.name + ":" + s.code + ":" + s.when + ":" + s.settings.length).join(), scripts.templates.length > 20, scripts.templates.some(t => t.name === "xor_js" && t.code === "js" && t.settings.length > 0), scripts.templates.some(t => t.code === "asm"));',
      'print(l.withSettings({ scale: 5 }).split("\\n")[0]);',
    ]);
    expect(r.error).toBeUndefined();
    expect(r.prints).toEqual([
      'main,lib,decrypt,broken,loop 5 main Alt+1 1',
      'lib js kickass 4 true null null null [{"name":"pad1","start":49152,"end":49168,"size":16}] lib (JavaScript, 4 lines)',
      '[{"name":"scale","value":"2","line":1,"comment":"what each byte is multiplied by"}] 2 null',
      'asm build key=$5a null',
      'shared:js:load:1 true true true',
      'const scale = 5;      // what each byte is multiplied by',
    ]);
    expect(r.scripts).toBeUndefined();
  });

  it('runs another script\'s code as a library: the same mem and print, its settings set, what it returns given back', () => {
    const r = run([
      'const lib = scripts.use("lib");', 'print(lib.scale, lib.sum(addr("data"), 4));',
      'const big = scripts.call("lib", { scale: 10 });', 'print(big.sum(addr("data"), 4), scripts.find("lib").call({ scale: 3 }).scale, scripts.library[0].call());',
    ]);
    expect(r.error).toBeUndefined();
    expect(r.prints).toEqual(['lib loaded, scale 2', '2 20', 'lib loaded, scale 10', 'lib loaded, scale 3', '100 3 1']);
  });

  it('says where an error of a called script is, and what cannot be called', () => {
    const a = run(['print(1);', 'scripts.call("broken");']);
    expect(a.error).toEqual({ msg: 'Error: in the script "broken" (line 2): bad 1', line: 2 });
    const b = run(['for (const f of [() => scripts.call("decrypt"), () => scripts.call("nothing"), () => scripts.call("lib", { speed: 1 }), () => scripts.call("lib", { scale: [1] }), () => scripts.call("loop")]) try { f(); } catch (e) { print(e.message); }']);
    expect(b.error).toBeUndefined();
    expect(b.prints![0]).toMatch(/^scripts\.call: decrypt is written in assembler/);
    expect(b.prints![1]).toBe('scripts.call: "nothing" is not a script of the project (it has main, lib, decrypt, broken, loop)');
    expect(b.prints![2]).toBe('scripts.call: lib has no setting speed (it has scale)');
    expect(b.prints![3]).toMatch(/^scripts\.call: the setting scale takes a text \(without "\), a number, true or false/);
    expect(b.prints![4]).toMatch(/scripts call scripts 8 deep at most \(does loop call itself\?\)$/);
  });

  it('ends the run with what it asked for: scripts added, changed and run', () => {
    const r = run([
      'scripts.add("made", "print(1);\\nprint(2);", { safe: true, key: "alt+3" });',
      'scripts.add("asm one", "        rts", { code: "asm", when: "build" });',
      'scripts.edit("lib", { settings: { scale: 4 }, safe: false, name: "library", key: null });',
      'scripts.edit("decrypt", { source: "        nop\\r\\n        rts", when: null });',
      'scripts.run("lib", { settings: { scale: 7 } });', 'scripts.run("decrypt");',
      'scripts.requests.forEach(t => print(t));',
    ]);
    expect(r.error).toBeUndefined();
    expect(r.prints).toEqual([
      'made added (JavaScript, 2 lines, safe mode, Alt+3)', 'asm one added (assembler, 1 line, runs on build)',
      'lib changed: its code (4 lines), its name (library), safe mode off, no key', 'decrypt changed: its code (2 lines), runs only when asked',
      'lib run with settings of its own', 'decrypt run',
    ]);
    expect(r.scripts).toHaveLength(6);
    expect(r.scripts![4]).toMatchObject({ kind: 'run', name: 'lib' });
    expect((r.scripts![4] as { source: string }).source.startsWith('const scale = 7;')).toBe(true);
    expect(scriptsRequestText(r.scripts![5])).toBe('decrypt run');

    // what they come to in the project
    const project: UserScript[] = data().scripts.map((s, i) => ({ id: `id${i}`, pads: [], ...s })) as UserScript[];
    let n = 0;
    const plan = planScriptsRequests(project, r.scripts!, { lang: '64tass', id: () => `new${n++}` });
    expect(plan.failed).toEqual([]);
    expect(plan.changed).toBe(true);
    expect(plan.scripts.map(s => s.name)).toEqual(['main', 'library', 'decrypt', 'broken', 'loop', 'made', 'asm one']);
    expect(plan.scripts[5]).toEqual({ id: 'new0', name: 'made', lang: '64tass', code: 'js', source: 'print(1);\nprint(2);', pads: [], safe: true, key: 'Alt+3' });
    expect(plan.scripts[6]).toEqual({ id: 'new1', name: 'asm one', lang: '64tass', source: '        rts', pads: [], when: 'build' });
    expect([plan.scripts[1].source.split('\n')[0], plan.scripts[1].safe, plan.scripts[1].id]).toEqual(['const scale = 4;      // what each byte is multiplied by', undefined, 'id1']);
    expect([plan.scripts[2].source, plan.scripts[2].when]).toEqual(['        nop\n        rts', undefined]);
    // a script renamed in the same run is run under its new name, with the settings asked for
    expect(plan.runs.map(x => [x.id, x.name, x.source?.split('\n')[0]])).toEqual([['id1', 'library', 'const scale = 7;      // what each byte is multiplied by'], ['id2', 'decrypt', undefined]]);
    expect(plan.done).toHaveLength(6);
    // (and what cannot be done is said)
    const again = planScriptsRequests(plan.scripts, [{ kind: 'add', name: 'MADE', source: '' }, { kind: 'edit', name: 'gone', source: '' }, { kind: 'edit', name: 'made', rename: 'main' }, { kind: 'edit', name: 'loop', key: 'Alt+3' }], { lang: 'kickass', id: () => 'x' });
    expect(again.failed).toEqual(['MADE is in the project already: scripts.edit changes it', 'gone is not a script of the project', 'made cannot be named main: another script has that name']);
    // one script has a key
    expect(again.scripts.filter(s => s.key === 'Alt+3').map(s => s.name)).toEqual(['loop']);
  });

  it('refuses what is no script, asks for nothing after an error, and has no project to change where it is not given', () => {
    const bad = run(['for (const f of [() => scripts.add("a/b", ""), () => scripts.add("lib", ""), () => scripts.add("x", 5), () => scripts.add("x", "", { code: "basic" }), () => scripts.add("x", "", { when: "save" }), () => scripts.add("x", "", { key: "F1" }),',
      '  () => scripts.edit("nothing", {}), () => scripts.edit("lib"), () => scripts.run("nothing"), () => scripts.edit("lib", { settings: { speed: 1 } })]) try { f(); print("ok"); } catch (e) { print(e.message); }']);
    expect(bad.error).toBeUndefined();
    expect(bad.prints![0]).toMatch(/^scripts\.add: "a\/b" is no name of a script/);
    expect(bad.prints![1]).toBe('scripts.add: lib is in the project already: scripts.edit changes it');
    expect(bad.prints![2]).toBe('scripts.add: the code is wanted, a text');
    expect(bad.prints![3]).toBe('scripts.add: code is "js" or "asm" (not "basic")');
    expect(bad.prints![4]).toBe('scripts.add: when is "build", "load" or null (not "save")');
    expect(bad.prints![5]).toMatch(/^scripts\.add: key is one of Alt\+1, .*, or null \(not "F1"\)$/);
    expect(bad.prints![6]).toMatch(/^scripts\.edit: "nothing" is not a script of the project/);
    expect(bad.prints![7]).toMatch(/^scripts\.edit: what to change is wanted/);
    expect(bad.prints![8]).toMatch(/^scripts\.run: "nothing" is not a script of the project/);
    expect(bad.prints![9]).toBe('scripts.edit: lib has no setting speed (it has scale)');
    expect(bad.scripts).toBeUndefined();
    expect(run(['scripts.add("x", "");', 'throw new Error("no");']).scripts).toBeUndefined();
    expect(run(['for (let i = 0; i < 17; i++) scripts.add("s" + i, "");']).error?.msg).toBe('RangeError: scripts: a run asks for 16 things at most');
    const none = run(['print(scripts.all.length, scripts.self, scripts.find("lib"), scripts.library.length, scripts.templates.length > 0);', 'scripts.add("x", "");'], null);
    expect(none.prints).toEqual(['0 null null 0 true']);
    expect(none.error?.msg).toMatch(/^Error: scripts: the project's scripts are not given here/);
  });
});
