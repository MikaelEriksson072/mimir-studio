/* The loader for a JavaScript script (spec 10.3): the files a loader tab lists, group by group, found by name, loaded
 * into the script's memory, and the loader script; with a real Spindle disk's jobs. */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JS_TEMPLATES, readSpindleDisk, runJs, setScriptParams, spinChunkName, spinScript, type ScriptEnv, type ScriptLoaderData, type UserScript } from '../src';
import { fromSource } from './helpers/programs';

const program = fromSource('p.prg', ['.pc = $0810', 'start: rts', '.pc = $0900', 'data: .fill 16, 0'].join('\n'));
const env: ScriptEnv = { files: [program], names: new Map([['data', 0x0900]]) };
const js = (lines: string[]): UserScript => ({ id: 's', name: 's', lang: 'kickass', code: 'js', source: lines.join('\n'), pads: [] });
const two: ScriptLoaderData[] = [
  { name: 'Sparkle', from: 'demo.d64', script: ['# script', 'File:\t"a.prg"'], groups: [
    { name: 'bundle00', what: 'bundle $00 of demo.d64', files: [{ name: 'bundle00_0900.prg', load: 0x0900, bytes: Uint8Array.of(1, 2, 3, 4) }] },
    { name: 'bundle01', what: 'bundle $01 of demo.d64', files: [{ name: 'bundle01_3000.prg', load: 0x3000, bytes: Uint8Array.of(9, 8) }, { name: 'bundle01_d000.prg', load: 0xd000, bytes: Uint8Array.of(7) }] },
  ] },
  { name: 'Tape', from: 'game.tap', script: [], groups: [{ name: 'boot', what: '"BOOT" of game.tap', files: [{ name: 'boot.prg', load: 0x0801, bytes: Uint8Array.of(5) }] }] },
];

describe('loader in a JavaScript script', () => {
  it('is null with no loader, and loaders an empty list', () => {
    const run = runJs(env, js(['print(loader, loaders.length);']));
    expect(run.prints).toEqual(['null 0']);
  });

  it('lists the groups and the files, finds a file by its name or number, and has the script', () => {
    const run = runJs(env, js([
      'print(loader.name, loader.disk, loader.groups.length, loader.files.length, loaders.length, loaders[1].name, loaders[1].script === "");',
      'print(loader.groups.map(g => g.name + ":" + g.files.length + ":" + hex(g.start) + "-" + hex(g.end) + ":" + g.size + ":" + g.what).join(" | "));',
      'print(loader.files.map(f => [f.index, f.name, f.group, hex(f.start), hex(f.end), f.size, f.bytes.length, f.prg.length, hex(f.prg[0] | f.prg[1] << 8)].join(",")).join(" | "));',
      'print(loader.find("BUNDLE01_3000").name, loader.find("bundle01_d000.prg").index, loader.find(0).name, loader.find("nope"), loader.find(loader.files[1]) === loader.files[1]);',
      'print(loader.group("bundle01").files.length, loader.group(0).name, loader.group("x"));',
      'print(loader.script.split("\\n").length, loader.lines[0], loader.at(0x3001).map(f => f.name).join(), loader.at(0x4000).length);',
    ]), { loaders: two });
    expect(run.error).toBeUndefined();
    expect(run.prints).toEqual([
      'Sparkle demo.d64 2 3 2 Tape true',
      'bundle00:1:$0900-$0904:4:bundle $00 of demo.d64 | bundle01:2:$3000-$d001:3:bundle $01 of demo.d64',
      '0,bundle00_0900.prg,bundle00,$0900,$0904,4,4,6,$0900 | 1,bundle01_3000.prg,bundle01,$3000,$3002,2,2,4,$3000 | 2,bundle01_d000.prg,bundle01,$d000,$d001,1,1,3,$d000',
      'bundle01_3000.prg 2 bundle00_0900.prg null true',
      '2 bundle00 null',
      '2 # script bundle01_3000.prg 0',
    ]);
    expect(run.changes).toEqual([]);
  });

  it('loads a file or a group into mem where it loads, or a file elsewhere: over the program it is a change', () => {
    const run = runJs(env, js([
      'const a = loader.load("bundle00_0900");', 'print(hex(a.start), hex(a.end), mem[0x0900], mem[0x0903]);',
      'const g = loader.load("bundle01");', 'print(hex(g.start), hex(g.end), mem[0x3000], mem[0xd000]);',
      'const b = loader.load(loader.files[1], "data");', 'print(hex(b.start), hex(b.end), mem[0x0900], mem[0x0901], mem[0x0902]);',
      'print(loader.load(loader.groups[0]).end === 0x0904, loader.load(2, 0xffff).end);',
      'try { loader.load("nope"); } catch (e) { print(e.message); }',
      'try { loader.load("bundle01", 0x4000); } catch (e) { print(e.message); }',
    ]), { loaders: two });
    expect(run.error).toBeUndefined();
    expect(run.prints).toEqual(['$0900 $0904 1 4', '$3000 $d001 9 7', '$0900 $0902 9 8 3', 'true 65536',
      'loader.load: Sparkle on demo.d64 has no file or group "nope" (loader.files lists them)',
      'loader.load: a group loads where its files load (bundle01 has 2): give a file to put it elsewhere']);
    // what went over the program's bytes is the run's change
    expect(run.changes.map(c => [c.start, [...c.bytes]])).toEqual([[0x0900, [1, 2, 3, 4]]]);
  });

  it('a real Spindle disk\'s jobs, and the template that lists a loader\'s files', () => {
    const image = new Uint8Array(readFileSync(join(__dirname, '../../../fixtures/d64/spindle-demo.d64')));
    const d = readSpindleDisk(image)!;
    expect(d.jobs.length).toBeGreaterThan(0);
    const data: ScriptLoaderData = { name: 'Spindle', from: 'spindle-demo.d64', script: spinScript(d, 'spindle-demo.d64'),
      groups: d.jobs.map(j => ({ name: `job${j.n.toString(16).padStart(2, '0')}`, what: `job ${j.n} of spindle-demo.d64`, files: j.chunks.map(c => ({ name: spinChunkName(j, c).replace(/\.bin$/, '.prg'), load: c.start, bytes: c.bytes })) })) };
    const chunks = d.jobs.flatMap(j => j.chunks), t = JS_TEMPLATES.find(x => x.name === 'loader_files')!;
    const go = (values: Record<string, string>, loaders: ScriptLoaderData[] = [data]) => runJs(env, { source: setScriptParams(t.source, { code: 'js' }, values).source, pads: [] }, { loaders });
    const r = go({});
    expect(r.error).toBeUndefined();
    expect(r.prints![0]).toBe(`Spindle on spindle-demo.d64: ${d.jobs.length} group${d.jobs.length === 1 ? '' : 's'}, ${chunks.length} file${chunks.length === 1 ? '' : 's'}`);
    expect(r.prints![1]).toBe('job01  (job 1 of spindle-demo.d64)');
    expect(r.prints).toHaveLength(1 + d.jobs.length + chunks.length);
    expect(r.prints![2]).toMatch(/^  job01_[0-9a-f]{4}\.prg +\$[0-9a-f]{4}-\$[0-9a-f]{4} +\d+ bytes$/);
    expect(r.made).toBeUndefined();
    // every file made a file, and the script printed
    const all = go({ saveFile: '"*"', showScript: 'true' });
    expect(all.made!.map(m => [m.load, m.bytes.length])).toEqual(chunks.map(c => [c.start, c.bytes.length]));
    expect(all.prints!.slice(r.prints!.length)).toEqual(data.script);
    // one by its name, without its extension
    const first = data.groups[0].files[0];
    expect(go({ saveFile: JSON.stringify(first.name.replace('.prg', '')) }).made!.map(m => m.name)).toEqual([first.name]);
    expect(go({ saveFile: '"nope"' }).error?.msg).toBe('Error: The loader has no file nope');
    expect(go({}, []).error?.msg).toMatch(/^Error: The mounted disk or tape has no loader Mimir knows/);
  });
});
