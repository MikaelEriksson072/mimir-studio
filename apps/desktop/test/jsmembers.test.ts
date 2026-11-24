/* What a JavaScript script's values have (spec 10.3): after a dot the editor suggests the members of the value before
 * it, for the things a script is given and for the names the code gave such values. */
import { describe, expect, it } from 'vitest';
import { JS_MEMBERS, jsMembers, jsTypeOf, tailExpression } from '../src/lib/jsmembers';
import { jsSuggestions } from '../src/monaco/providers';

const labels = (before: string, typed = '', source = '') => jsMembers(before, typed, source)?.map(m => m.label) ?? null;
const SOURCE = [
  'const r = cpu.call("decrypt", { a: 1 });',
  'const bytes = disk.read("SPRITE"), into = pad("file");',
  'for (const f of disk.files) {',
  '  print(f.name);',
  '}',
  'for (const part of files) print(part.start);',
  'disk.files.forEach((entry, i) => print(entry.blocks));',
  'const first = disk.files[0];',
  'const big = disk.files.filter(x => x.blocks > 10);',
  'const count = 8;',
].join('\n');

describe('the members of a JavaScript script\'s values', () => {
  it('are those of the disk, the CPU and the memory after their names', () => {
    expect(labels('disk')).toEqual(['name', 'id', 'tracks', 'files', 'read', 'sector']);
    expect(labels('  if (disk')).toEqual(['name', 'id', 'tracks', 'files', 'read', 'sector']);
    expect(labels('cpu')).toEqual(['call', 'limit']);
    expect(labels('mem')).toEqual(JS_MEMBERS.bytes.map(m => m.label));
    expect(labels('mem')).toContain('subarray');
    expect(labels('files')).toContain('forEach');
    // what is typed after the dot narrows them
    expect(labels('disk', 'f')).toEqual(['files']);
    expect(labels('disk', 'files')).toEqual([]);
    expect(labels('disk', 'S')).toEqual(['sector']);
  });

  it('are those of what a call or a member gives', () => {
    expect(labels('cpu.call("x", { a: 1 })')).toEqual(['a', 'x', 'y', 'p', 'c', 'z', 'n', 'brk']);
    expect(labels('pad("result")')).toContain('fill');
    expect(labels('const n = disk.read(f)')).toContain('length');
    expect(labels('disk.sector(18, 0)')).toContain('subarray');
    expect(labels('disk.files')).toContain('map');
    expect(labels('disk.files[i]')).toEqual(['name', 'type', 'blocks', 'track', 'sector']);
    expect(labels('files[0]')).toEqual(['start', 'end']);
    expect(labels('disk.files.find(f => f.type === "PRG")')).toEqual(['name', 'type', 'blocks', 'track', 'sector']);
    expect(labels('mem.subarray(0, 16)')).toContain('set');
    expect(labels('disk.name')).toContain('padEnd');
    expect(labels('disk.files[0].name')).toContain('toLowerCase');
  });

  it('are those of the value the code gave a name', () => {
    expect(labels('  print(r', '', SOURCE)).toEqual(['a', 'x', 'y', 'p', 'c', 'z', 'n', 'brk']);
    expect(labels('bytes', '', SOURCE)).toContain('length');
    expect(labels('into', '', SOURCE)).toContain('fill');
    expect(labels('  print(f', '', SOURCE)).toEqual(['name', 'type', 'blocks', 'track', 'sector']);
    expect(labels('part', '', SOURCE)).toEqual(['start', 'end']);
    expect(labels('entry', '', SOURCE)).toEqual(['name', 'type', 'blocks', 'track', 'sector']);
    expect(labels('first', '', SOURCE)).toEqual(['name', 'type', 'blocks', 'track', 'sector']);
    expect(labels('big', '', SOURCE)).toContain('forEach');
    expect(labels('big[0]', '', SOURCE)).toEqual(['name', 'type', 'blocks', 'track', 'sector']);
    expect(labels('f.name', '', SOURCE)).toContain('padEnd');
  });

  it('are none for a value Mimir does not know', () => {
    expect(labels('count', '', SOURCE)).toBeNull();
    expect(labels('nothing', '', SOURCE)).toBeNull();
    expect(labels('1')).toBeNull();
    expect(labels('addr("x")')).toBeNull();
    expect(jsTypeOf('', SOURCE)).toBeNull();
  });

  it('read the expression before the dot from its end back, over whole brackets', () => {
    expect(tailExpression('  print(disk.files[i + 1]')).toBe('disk.files[i + 1]');
    expect(tailExpression('x = cpu.call("a", { a: f(1) })')).toBe('cpu.call("a", { a: f(1) })');
    expect(tailExpression('a + b')).toBe('b');
    expect(tailExpression('')).toBe('');
  });

  it('come in the editor after a dot, each with what is put in and what it is', () => {
    const s = jsSuggestions('const d = disk.', '', new Map(), [], '');
    expect(s.map(x => x.label)).toEqual(['name', 'id', 'tracks', 'files', 'read', 'sector']);
    expect(s.every(x => x.kind === 'member' && x.detail.length > 8)).toBe(true);
    expect(s.find(x => x.label === 'read')?.insert).toBe('read(');
    expect(s.find(x => x.label === 'files')?.insert).toBe('files');
    expect(jsSuggestions('cpu.', 'ca', new Map(), []).map(x => x.label)).toEqual(['call']);
    expect(jsSuggestions('  print(r.', '', new Map(), [], SOURCE).map(x => x.label)).toEqual(['a', 'x', 'y', 'p', 'c', 'z', 'n', 'brk']);
    // nothing after the dot of a value Mimir does not know, and not inside a text
    expect(jsSuggestions('count.', '', new Map(), [], SOURCE)).toEqual([]);
    expect(jsSuggestions('print("disk.', '', new Map(), [], SOURCE)).toEqual([]);
    // without a dot, what the script is given, as before
    expect(jsSuggestions('', 'di', new Map(), []).map(x => x.label)).toEqual(['disk']);
    expect(jsSuggestions('', 'cp', new Map(), []).map(x => x.label)).toEqual(['cpu']);
  });
});

describe('what Sindri\'s values have', () => {
  const labels = (before: string, source = '') => jsMembers(before, '', source)?.map(x => x.label);
  it('sindri., a C64 of its, what an unpack gives and its layers', () => {
    expect(labels('sindri')).toEqual(['unpack', 'c64', 'disassemble', 'basic', 'sys', 'prg', 'roms']);
    expect(labels('sindri.c64()')).toEqual(['mem', 'run', 'call', 'type', 'screen', 'load', 'loadPrg', 'peek', 'pc', 'a', 'x', 'y', 's', 'p', 'cycles']);
    const src = 'const m = sindri.c64({ disk: false });\nconst r = sindri.unpack(disk.read("A"));\nconst s = m.run({ until: 0x0810 });\nfor (const layer of r.layers) {\n}\n';
    expect(labels('m', src)).toContain('screen');
    expect(labels('r', src)).toEqual(['unpacked', 'packer', 'start', 'end', 'entry', 'port', 'basic', 'bytes', 'prg', 'layers', 'listing', 'stop', 'drive', 'cycles', 'ms']);
    expect(labels('s', src)).toEqual(['reason', 'pc', 'cycles']);
    expect(labels('layer', src)).toEqual(['index', 'entry', 'kind', 'packer', 'instructions', 'written', 'what']);
    expect(labels('m.call(0x0810)', src)).toContain('brk');
  });
  it('bytes, lists and texts among them', () => {
    const src = 'const m = sindri.c64();\nconst r = sindri.unpack();\n';
    expect(jsTypeOf('m.mem', src)).toBe('bytes');
    expect(jsTypeOf('r.bytes.subarray(0, 4)', src)).toBe('bytes');
    expect(jsTypeOf('sindri.prg(0x0801, 0x0900)', src)).toBe('bytes');
    expect(jsTypeOf('r.layers[0].written[0]', src)).toBe('file');
    expect(jsTypeOf('m.screen()[0]', src)).toBe('text');
    expect(jsTypeOf('sindri.disassemble(0x0810).join("\\n")', src)).toBe('text');
    expect(jsTypeOf('r.packer', src)).toBe('text');
    expect(jsTypeOf('sindri.sys()', src)).toBeNull();
  });
});

describe('the C64 screen in the suggestions', () => {
  const labels = (before: string, source = '') => (jsMembers(before, '', source) ?? []).map(x => x.label);
  it('lists what screen has, and its codes and colours as bytes', () => {
    expect(labels('screen')).toEqual(['print', 'write', 'chrout', 'at', 'clear', 'home', 'poke', 'peek', 'show', 'charset', 'color', 'border', 'background', 'reverse', 'lower', 'cols', 'rows', 'col', 'row', 'codes', 'colors']);
    expect(jsTypeOf('screen.codes', '')).toBe('bytes');
    expect(jsMembers('screen', 'pr', '')!.map(x => x.label)).toEqual(['print']);
  });
  it('is not the screen when the script names its own screen', () => {
    expect(jsTypeOf('screen', 'const screen = c64.screen();')).not.toBe('screen');
  });
});

describe('what Brokkr\'s values have', () => {
  const names = (before: string, source = '') => jsMembers(before, '', source)?.map(x => x.label);
  it('brokkr., a packed file, a stream, a mem file and an area', () => {
    expect(names('brokkr')).toEqual(['pack', 'crunch', 'decrunch', 'mem', 'decruncher', 'formats']);
    const src = 'const p = brokkr.pack();\nconst c = brokkr.crunch(mem.subarray(0, 9));\nconst f = brokkr.mem(c.bytes, 0x1000);\nfor (const a of p.areas) {\n}\n';
    expect(names('p', src)).toEqual(['prg', 'bytes', 'load', 'end', 'size', 'from', 'saved', 'format', 'entry', 'basic', 'port', 'cycles', 'seconds', 'areas', 'warnings']);
    expect(names('c', src)).toEqual(['bytes', 'size', 'from', 'saved', 'format']);
    expect(names('f', src)).toEqual(['bytes', 'start', 'end', 'inPlace', 'size', 'from', 'saved', 'format', 'warnings']);
    expect(names('a', src)).toEqual(['name', 'start', 'end']);
    expect(jsTypeOf('p.prg', src)).toBe('bytes');
    expect(jsTypeOf('brokkr.decrunch(c.bytes)', src)).toBe('bytes');
    expect(jsTypeOf('f.inPlace', src)).toBe('file');
    expect(jsTypeOf('brokkr.formats[0]', src)).toBe('text');
    expect(jsTypeOf('brokkr.decruncher()', src)).toBe('text');
  });
});

describe('what the loader\'s values have', () => {
  const names = (before: string, source = '') => jsMembers(before, '', source)?.map(x => x.label);
  it('loader., one of its groups and one of its files', () => {
    expect(names('loader')).toEqual(['name', 'disk', 'files', 'groups', 'find', 'group', 'load', 'at', 'script', 'lines']);
    const src = 'const f = loader.find("a");\nfor (const g of loader.groups) {\n  for (const x of g.files) {\n  }\n}\nloader.files.forEach(file => 0);\nconst other = loaders[1];\n';
    expect(names('f', src)).toEqual(['name', 'group', 'index', 'start', 'end', 'size', 'bytes', 'prg']);
    expect(names('g', src)).toEqual(['name', 'what', 'files', 'start', 'end', 'size']);
    expect(names('x', src)).toContain('prg');
    expect(names('file', src)).toContain('bytes');
    expect(names('other', src)).toContain('groups');
    expect(names('loader.load("a")', src)).toEqual(['start', 'end']);
    expect(jsTypeOf('f.bytes', src)).toBe('bytes');
    expect(jsTypeOf('loader.script', src)).toBe('text');
    expect(jsTypeOf('loader.lines[0]', src)).toBe('text');
    expect(jsTypeOf('loader.at(0x0810)[0]', src)).toBe('loaderFile');
  });
});

describe('what the export\'s values have', () => {
  const names = (before: string, source = '') => jsMembers(before, '', source)?.map(x => x.label);
  it('exporter., one of its files and what it has changed', () => {
    expect(names('exporter')).toEqual(['files', 'names', 'sources', 'main', 'read', 'has', 'add', 'edit', 'replace', 'remove', 'rename', 'write', 'changes', 'name', 'assembler', 'folder', 'outDir']);
    const src = 'for (const f of exporter.files) {\n}\nconst c = exporter.changes;\n';
    expect(names('f', src)).toEqual(['name', 'kind', 'size', 'text', 'bytes']);
    expect(names('c', src)).toEqual(['added', 'changed', 'removed']);
    expect(jsTypeOf('exporter.sources[0]', src)).toBe('text');
    expect(jsTypeOf('f.bytes', src)).toBe('bytes');
    expect(jsTypeOf('exporter.name', src)).toBe('text');
  });
});
