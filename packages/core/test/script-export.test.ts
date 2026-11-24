/* The export for a JavaScript script (spec 10.3): the export's files read, changed, added, taken out and renamed, the
 * request a run ends with, and the request laid over the export when it is written. */
import { describe, expect, it } from 'vitest';
import { applyExportRequest, exportFileName, exportRequestText, runJs, type ScriptEnv, type ScriptExportData, type UserScript } from '../src';
import { fromSource } from './helpers/programs';

const program = fromSource('p.prg', ['.pc = $0810', 'start: rts', '.pc = $0900', 'data: .fill 4, 0'].join('\n'));
const env: ScriptEnv = { files: [program], names: new Map([['data', 0x0900]]) };
const js = (lines: string[]): UserScript => ({ id: 's', name: 's', lang: 'kickass', code: 'js', source: lines.join('\n'), pads: [] });
const data = (): ScriptExportData => ({
  name: 'demo', assembler: 'kickass', folder: 'C:\\work\\demo\\source', main: 'p.asm', sources: ['p.asm'], outDir: 'out',
  files: { 'p.asm': '.pc = $0810\nstart: rts\n// end\n', 'build.bat': 'java -jar KickAss.jar p.asm\r\n', 'README.md': '# demo\n', 'bin/p_0900.bin': Uint8Array.of(1, 2, 3), 'original/p.prg': Uint8Array.of(0x10, 0x08, 0x60) },
});
const run = (lines: string[], d: ScriptExportData | null = data()) => runJs(env, js(lines), { export: d });

describe('exporter in a JavaScript script', () => {
  it('says what the export is and lists its files with their kind, size, text and bytes', () => {
    const r = run([
      'print(exporter.name, exporter.assembler, exporter.folder, exporter.main, exporter.sources.join(), exporter.outDir);',
      'print(exporter.files.map(f => [f.name, f.kind, f.size, f.text === null ? "-" : f.text.length, f.bytes.length].join(":")).join(" | "));',
      'print(exporter.names.join(), exporter.has("P.ASM"), exporter.has("nope.asm"));',
      'print(exporter.read("p.asm").split("\\n")[1], exporter.read("bin/p_0900.bin").join(), exporter.read("bin\\\\p_0900.bin").length);',
      'try { exporter.read("nope"); } catch (e) { print(e.message); }',
    ]);
    expect(r.error).toBeUndefined();
    expect(r.prints).toEqual([
      'demo kickass C:\\work\\demo\\source p.asm p.asm out',
      'p.asm:source:30:30:30 | build.bat:script:29:29:29 | README.md:text:7:7:7 | bin/p_0900.bin:binary:3:-:3 | original/p.prg:binary:3:-:3',
      'p.asm,build.bat,README.md,bin/p_0900.bin,original/p.prg true false',
      'start: rts 1,2,3 3',
      'exporter.read: the export has no file "nope" (exporter.names lists them)',
    ]);
    // reading asks for nothing
    expect(r.exports).toBeUndefined();
  });

  it('adds, edits, replaces, removes and renames, and write() ends the run with the request', () => {
    const r = run([
      'exporter.add("data/level1.bin", mem.subarray(0x0810, 0x0811));',
      'exporter.add("NOTES.txt", "made by a script\\n");',
      'print(exporter.edit("p.asm", t => "// header\\n" + t), exporter.edit("README.md", t => t));',
      'print(exporter.replace("build.bat", "KickAss.jar", "C:\\\\tools\\\\KickAss.jar"), exporter.replace("p.asm", /\\$(08)(10)/, "$$$2$1"), exporter.replace("p.asm", "nothing", "x"));',
      'print(exporter.remove("original/p.prg"), exporter.remove("nope"));',
      'exporter.rename("bin/p_0900.bin", "bin/data.bin");',
      'exporter.add("temp.txt", "x"); exporter.remove("temp.txt");',
      'const c = exporter.changes;', 'print(c.added.join(), "/", c.changed.join(), "/", c.removed.join());',
      'print(exporter.write().join());',
    ]);
    expect(r.error).toBeUndefined();
    expect(r.prints).toEqual(['true false', '1 1 0', 'true false', 'data/level1.bin,NOTES.txt,bin/data.bin / p.asm,build.bat / original/p.prg,bin/p_0900.bin',
      'p.asm,build.bat,README.md,data/level1.bin,NOTES.txt,bin/data.bin']);
    const x = r.exports!;
    expect(Object.keys(x.files).sort()).toEqual(['NOTES.txt', 'bin/data.bin', 'build.bat', 'data/level1.bin', 'p.asm']);
    expect(x.files['p.asm']).toBe('// header\n.pc = $1008\nstart: rts\n// end\n');
    expect(x.files['build.bat']).toBe('java -jar C:\\tools\\KickAss.jar p.asm\r\n');
    expect([...(x.files['data/level1.bin'] as Uint8Array)]).toEqual([0x60]);
    expect([...(x.files['bin/data.bin'] as Uint8Array)]).toEqual([1, 2, 3]);
    expect([...x.changed].sort()).toEqual(['build.bat', 'p.asm']);
    expect([...x.removed].sort()).toEqual(['bin/p_0900.bin', 'original/p.prg']);
    expect(x.elsewhere).toBe(false);
    expect(exportRequestText(x)).toEqual(['The export, to the project\'s folder (a folder is asked for when there is none)',
      '3 files added: data/level1.bin, NOTES.txt, bin/data.bin', '2 files changed: p.asm, build.bat', '2 files left out: original/p.prg, bin/p_0900.bin']);
  });

  it('write() alone asks for the export as it is, elsewhere when told; a run that stops with an error asks for nothing', () => {
    const plain = run(['exporter.write({ elsewhere: true });']).exports!;
    expect(plain).toEqual({ files: {}, removed: [], changed: [], elsewhere: true });
    expect(exportRequestText(plain)).toEqual(['The export, to a folder that is asked for', 'The files as Export writes them']);
    // a file put back as it was is no change
    expect(run(['const t = exporter.read("p.asm");', 'exporter.add("p.asm", t + "x");', 'exporter.add("p.asm", t);', 'exporter.write();']).exports).toEqual({ files: {}, removed: [], changed: [], elsewhere: false });
    const failed = run(['exporter.write();', 'throw new Error("no");']);
    expect(failed.error?.msg).toBe('Error: no');
    expect(failed.exports).toBeUndefined();
  });

  it('says what it does not take: a name out of the folder, a binary as text, no content, and no export here', () => {
    const r = run([
      'for (const bad of [() => exporter.add("../x.txt", "x"), () => exporter.add("C:/x.txt", "x"), () => exporter.add("", "x"), () => exporter.add("a.txt", 12), () => exporter.edit("bin/p_0900.bin", t => t),',
      '  () => exporter.edit("p.asm", t => 1), () => exporter.edit("p.asm", "x"), () => exporter.replace("p.asm", "", "x"), () => exporter.rename("p.asm", "README.md"), () => exporter.rename("nope", "x")]) try { bad(); print("ok"); } catch (e) { print(e.message); }',
    ]);
    expect(r.prints).toEqual([
      'exporter.add: "../x.txt" is no name of a file in the export\'s folder (a name, or folders and a name with /; no .., no drive)',
      'exporter.add: "C:/x.txt" is no name of a file in the export\'s folder (a name, or folders and a name with /; no .., no drive)',
      'exporter.add: a file needs a name',
      'exporter.add: the content is a text, or bytes (a Uint8Array, such as mem.subarray(…))',
      'exporter.edit: bin/p_0900.bin is a binary file, not a text',
      'exporter.edit: the function gave no text for p.asm',
      'exporter.edit: give a function that takes the text and gives the new text: exporter.edit(name, text => text + "…")',
      'exporter.replace: the text to find is empty',
      'exporter.rename: the export has a file "README.md" already',
      'exporter.rename: the export has no file "nope"',
    ]);
    const none = run(['print(typeof exporter);', 'exporter.files;'], null);
    expect(none.prints).toEqual(['object']);
    expect(none.error?.msg).toMatch(/^Error: exporter: there is nothing to export here/);
    expect(exportFileName('a\\b.txt', 'x')).toBe('a/b.txt');
  });
});

describe('a script\'s export laid over the export', () => {
  const files = { 'p.asm': 'new source\n', 'build.bat': 'b', 'bin/a.bin': Uint8Array.of(1), 'out/p.prg': Uint8Array.of(9) };
  const req = { files: { 'p.asm': 'edited\n', 'build.bat': 'B', 'extra.txt': 'x' }, removed: ['bin/a.bin', 'gone.txt'], changed: ['p.asm', 'build.bat'], elsewhere: false };
  it('puts the script\'s files in, takes the removed out and keeps the rest (the verified PRGs)', () => {
    const r = applyExportRequest(files, req, false);
    expect(r.stale).toEqual([]);
    expect(r.files).toEqual({ 'p.asm': 'edited\n', 'build.bat': 'B', 'extra.txt': 'x', 'out/p.prg': Uint8Array.of(9) });
    expect(files['p.asm']).toBe('new source\n');
  });
  it('leaves a source the script changed as it is now when the run changed the program', () => {
    const r = applyExportRequest(files, req, true);
    expect(r.stale).toEqual(['p.asm']);
    expect(r.files['p.asm']).toBe('new source\n');
    expect(r.files['build.bat']).toBe('B');
    expect(r.files['extra.txt']).toBe('x');
  });
});
