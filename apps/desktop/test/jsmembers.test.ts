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
    expect(jsSuggestions('', 'di', new Map(), []).map(x => x.label)).toEqual(['disk', 'disks']);
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

describe('what the library\'s values have', () => {
  const names = (before: string, source = '') => jsMembers(before, '', source)?.map(x => x.label);
  it('library., an item and where it is from', () => {
    expect(names('library')).toEqual(['items', 'sids', 'sprites', 'chars', 'bitmaps', 'find', 'search', 'same', 'add', 'folder', 'requests']);
    const src = 'const f = library.find("font");\nfor (const item of library.sids) {\n}\nlibrary.search("x").forEach(found => {});\n';
    expect(names('f', src)).toEqual(expect.arrayContaining(['kind', 'name', 'file', 'bytes', 'put', 'asFile', 'tune', 'sprite', 'char', 'bitmap']));
    expect(names('item', src)).toEqual(names('f', src));
    expect(names('found', src)).toEqual(names('f', src));
    expect(names('item.tune', src)).toContain('init');
    expect(names('f.from', src)).toEqual(['text', 'project', 'file', 'disk', 'start', 'end']);
    expect(names('f.colors', src)).toEqual(['bg', 'fg', 'mc1', 'mc2']);
    expect(jsTypeOf('library.bitmaps[0].bitmap', src)).toBe('bytes');
    expect(jsTypeOf('f.asFile("koala")', src)).toBe('bytes');
    expect(jsTypeOf('f.put(0x2000)', src)).toBe('file');
  });
});

describe('what the blocks\' values have', () => {
  const names = (before: string, source = '') => jsMembers(before, '', source)?.map(x => x.label);
  it('blocks., a block, a struct with its fields and a custom type', () => {
    expect(names('blocks')).toEqual(['all', 'count', 'at', 'in', 'of', 'find', 'mark', 'struct', 'define', 'split', 'auto', 'comment', 'exclude', 'binary', 'text', 'encode', 'types', 'defined']);
    const src = 'const b = blocks.at(0x0840);\nfor (const one of blocks.all) {\n}\nblocks.of("text").forEach(t => {});\nconst rec = blocks.struct("enemy", ["x: byte"]);\nconst row = blocks.define("row", { as: "bytes" });\n';
    expect(names('b', src)).toEqual(expect.arrayContaining(['start', 'end', 'size', 'type', 'as', 'custom', 'label', 'bytes', 'records', 'struct', 'mark', 'format', 'setLabel', 'setComment', 'split', 'auto', 'exclude', 'asBinary', 'junk']));
    expect(names('one', src)).toEqual(names('b', src));
    expect(names('t', src)).toEqual(names('b', src));
    expect(names('b.next', src)).toEqual(names('b', src));
    expect(names('rec', src)).toEqual(['name', 'size', 'fields', 'text', 'read', 'records', 'write', 'offset', 'mark', 'markRecords']);
    expect(names('b.struct', src)).toEqual(names('rec', src));
    expect(names('rec.fields[0]', src)).toEqual(['name', 'type', 'count', 'fmt', 'enc', 'offset', 'size', 'text']);
    expect(names('row', src)).toEqual(['name', 'as', 'struct', 'size', 'mark']);
    expect(names('blocks.defined[0]', src)).toEqual(names('row', src));
    expect(jsTypeOf('b.bytes', src)).toBe('bytes');
    expect(jsTypeOf('blocks.encode("A")', src)).toBe('bytes');
    expect(jsTypeOf('blocks.find("x")', src)).toBe('block');
    expect(jsTypeOf('blocks.in(1, 2)', src)).toBe('blockList');
  });
});

describe('what the cartridges\' values have', () => {
  const names = (before: string, source = '') => jsMembers(before, '', source)?.map(x => x.label);
  it('cartridges., a cartridge, a chip, a structure and how it starts', () => {
    expect(names('cartridges')).toEqual(['create', 'fromProgram', 'open', 'project', 'layouts', 'layout', 'types', 'structs', 'cbm80']);
    const src = 'const c = cartridges.create("normal");\nconst p = cartridges.project;\nfor (const x of c.chips) {\n}\nfor (const l of cartridges.layouts) {\n}\nconst s = c.start;\n';
    expect(names('c', src)).toEqual(['name', 'fileName', 'hw', 'type', 'revision', 'version', 'exrom', 'game', 'mode', 'chips', 'banks', 'bootBank', 'total', 'size', 'bytes', 'start',
      'chip', 'find', 'read', 'write', 'fill', 'peek', 'poke', 'get', 'put', 'add', 'remove', 'resize', 'set', 'setStart', 'setVectors', 'list', 'file', 'save', 'run']);
    expect(names('p', src)).toEqual(names('c', src));
    expect(names('cartridges.fromProgram(x)', src)).toEqual(names('c', src));
    expect(names('cartridges.open(x)', src)).toEqual(names('c', src));
    expect(names('x', src)).toEqual(['number', 'bank', 'load', 'address', 'size', 'end', 'type', 'typeId']);
    expect(names('c.find(0, 0x8000)', src)).toEqual(names('x', src));
    expect(names('c.add(0, 0x8000, 16)', src)).toEqual(names('x', src));
    expect(names('l', src)).toEqual(['key', 'id', 'name', 'sizes', 'size', 'exrom', 'game', 'banks', 'chips']);
    expect(names('cartridges.layout("md")', src)).toEqual(names('l', src));
    expect(names('s', src)).toEqual(['kind', 'cold', 'warm', 'reset', 'nmi', 'irq']);
    expect(jsTypeOf('c.read(0)', src)).toBe('bytes');
    expect(jsTypeOf('c.get(0, 0x8000, 9)', src)).toBe('bytes');
    expect(jsTypeOf('cartridges.cbm80(0x8009)', src)).toBe('bytes');
    expect(jsTypeOf('c.list()', src)).toBe('texts');
  });
});

describe('what the tapes\' values have', () => {
  const names = (before: string, source = '') => jsMembers(before, '', source)?.map(x => x.label);
  it('tapes., a tape and a file of it', () => {
    expect(names('tapes')).toEqual(['create', 'open', 'mounted', 'kinds']);
    const src = 'const t = tapes.create("tap");\nconst m = tapes.mounted;\nfor (const f of t.files) {\n}\nconst a = t.toT64();\n';
    expect(names('t', src)).toEqual(['kind', 'name', 'files', 'find', 'has', 'read', 'prg', 'add', 'remove', 'rename', 'list', 'size', 'bytes', 'file', 'save', 'insert', 'toT64', 'toTap', 'version', 'seconds', 'pulses', 'unknown', 'pause', 'addPulses', 'cut', 'endOfTape']);
    expect(names('m', src)).toEqual(names('t', src));
    expect(names('a', src)).toEqual(names('t', src));
    expect(names('f', src)).toEqual(['number', 'name', 'format', 'type', 'load', 'end', 'size', 'seconds', 'errors']);
    expect(names('t.find(0)', src)).toEqual(names('f', src));
    expect(jsTypeOf('t.read(0)', src)).toBe('bytes');
    expect(jsTypeOf('t.prg("x")', src)).toBe('bytes');
    expect(jsTypeOf('t.list()', src)).toBe('texts');
  });
});

describe('what the disks\' values have', () => {
  const names = (before: string, source = '') => jsMembers(before, '', source)?.map(x => x.label);
  it('disks., a disk and a file of its directory', () => {
    expect(names('disks')).toEqual(['create', 'open', 'mounted', 'kinds', 'blocksFor']);
    const src = 'const d = disks.create("d64", { name: "x" });\nconst m = disks.mounted;\nfor (const f of d.files) {\n}\nconst e = d.add("a", [1]);\n';
    expect(names('d', src)).toEqual(['kind', 'name', 'id', 'dosType', 'tracks', 'sectors', 'size', 'free', 'files', 'find', 'has', 'read', 'add', 'remove', 'rename', 'lock', 'setType', 'sector', 'sectorsOn', 'isFree', 'allocate', 'release', 'chain', 'validate', 'format', 'list', 'bytes', 'file', 'save', 'mount']);
    expect(names('m', src)).toEqual(names('d', src));
    expect(names('disks.open(x)', src)).toEqual(names('d', src));
    expect(names('f', src)).toEqual(['name', 'type', 'blocks', 'size', 'track', 'sector', 'locked', 'closed']);
    expect(names('e', src)).toEqual(names('f', src));
    expect(jsTypeOf('d.read("a")', src)).toBe('bytes');
    expect(jsTypeOf('d.sector(18, 0)', src)).toBe('bytes');
    expect(jsTypeOf('d.list()', src)).toBe('texts');
  });
});

describe('what the scripts\' values have', () => {
  const names = (before: string, source = '') => jsMembers(before, '', source)?.map(x => x.label);
  it('scripts., a script, its settings and a template', () => {
    expect(names('scripts')).toEqual(['all', 'names', 'self', 'find', 'library', 'templates', 'call', 'use', 'add', 'edit', 'run', 'requests']);
    const src = 'const lib = scripts.find("lib");\nfor (const s of scripts.all) {\n}\nscripts.templates.forEach(t => {});\n';
    expect(names('lib', src)).toEqual(['name', 'code', 'lang', 'source', 'lines', 'safe', 'when', 'key', 'machine', 'pads', 'settings', 'self', 'setting', 'withSettings', 'call']);
    expect(names('s', src)).toEqual(names('lib', src));
    expect(names('scripts.self', src)).toEqual(names('lib', src));
    expect(names('scripts.library[0]', src)).toEqual(names('lib', src));
    expect(names('lib.settings[0]', src)).toEqual(['name', 'value', 'line', 'comment']);
    expect(names('t', src)).toEqual(['name', 'title', 'about', 'code', 'source', 'lines', 'safe', 'settings']);
    expect(jsTypeOf('lib.source', src)).toBe('text');
    expect(jsTypeOf('lib.withSettings({})', src)).toBe('text');
    expect(jsTypeOf('scripts.names', src)).toBe('texts');
  });
});

describe('what the snapshot\'s values have', () => {
  const names = (before: string, source = '') => jsMembers(before, '', source)?.map(x => x.label);
  it('snapshot., its CPU, VIC-II, sprites and drive', () => {
    expect(names('snapshot')).toEqual(['name', 'machine', 'vice', 'format', 'size', 'cpu', 'port', 'ram', 'cia1', 'cia2', 'sid', 'vic', 'drive', 'modules', 'module', 'has', 'changes', 'changed', 'file', 'reset', 'write']);
    const src = 'const v = snapshot.vic;\nconst d = snapshot.drive;\nfor (const s of snapshot.vic.sprites) {\n}\n';
    expect(names('snapshot.cpu')).toEqual(['pc', 'a', 'x', 'y', 'sp', 'status', 'flags']);
    expect(names('snapshot.port')).toEqual(['data', 'dir', 'config']);
    expect(names('v', src)).toEqual(expect.arrayContaining(['regs', 'colorRam', 'border', 'background', 'mode', 'bank', 'screenAt', 'sprites', 'line', 'irqLine']));
    expect(names('s', src)).toEqual(['n', 'on', 'x', 'y', 'color', 'mc', 'wide', 'tall', 'behind', 'pointer', 'dataAt']);
    expect(names('d', src)).toEqual(['unit', 'type', 'model', 'track', 'halfTrack', 'cpu', 'ram', 'via1', 'via2', 'motor', 'led']);
    expect(names('d.cpu', src)).toEqual(names('snapshot.cpu'));
    expect(names('d.via2', src)).toEqual(['pra', 'ddra', 'prb', 'ddrb', 'latch1', 'timer1', 'timer2', 'sr', 'acr', 'pcr', 'ifr', 'ier']);
    expect(names('snapshot.cia1')).toContain('latchA');
    expect(names('snapshot.modules[0]')).toEqual(['name', 'version', 'size', 'offset']);
    expect(jsTypeOf('snapshot.ram', src)).toBe('bytes');
    expect(jsTypeOf('d.ram', src)).toBe('bytes');
    expect(jsTypeOf('snapshot.file()', src)).toBe('bytes');
    expect(jsTypeOf('snapshot.module("SID")', src)).toBe('bytes');
  });
});

describe('what the SID music\'s values have', () => {
  const names = (before: string, source = '') => jsMembers(before, '', source)?.map(x => x.label);
  it('sid., a tune, what it plays with, a run and its dump', () => {
    expect(names('sid')).toEqual(['tunes', 'tune', 'at', 'parse', 'make', 'load', 'run', 'player', 'play', 'note', 'voices', 'noteTables', 'musicPlayer', 'requests']);
    const src = 'const t = sid.tune;\nconst r = t.run({ frames: 50 });\nfor (const tune of sid.tunes) {\n}\nconst v = sid.voices(r.dump[1]);\nconst p = sid.parse(t.sid());\n';
    expect(names('t', src)).toEqual(['name', 'file', 'start', 'end', 'size', 'bytes', 'init', 'play', 'song', 'songs', 'samples', 'why', 'score', 'plays', 'sid', 'player', 'run']);
    expect(names('tune', src)).toEqual(names('t', src));
    expect(names('t.plays', src)).toEqual(['start', 'end', 'bytes', 'init', 'play', 'parts', 'routine', 'problem', 'alone']);
    expect(names('r', src)).toContain('dump');
    expect(jsTypeOf('r.dump[0]', src)).toBe('bytes');
    expect(names('v', src)).toEqual(expect.arrayContaining(['length', 'map', 'volume', 'filtered']));
    expect(names('v[0]', src)).toEqual(['note', 'frequency', 'pulse', 'wave', 'gate', 'control', 'attack', 'decay', 'sustain', 'release']);
    expect(names('p', src)).toEqual(['name', 'author', 'released', 'start', 'end', 'size', 'init', 'play', 'songs', 'song', 'rsid', 'bytes']);
    expect(jsTypeOf('t.sid()', src)).toBe('bytes');
    expect(jsTypeOf('sid.player(t).prg', src)).toBe('bytes');
    expect(jsTypeOf('sid.at(0x1000).name', src)).toBe('text');
    expect(names('sid.note(1000)', src)).toEqual(['name', 'octave', 'hz', 'cents']);
  });
});

describe('what the build\'s values have', () => {
  const names = (before: string, source = '') => jsMembers(before, '', source)?.map(x => x.label);
  it('build., the last build and one of its files', () => {
    expect(names('build')).toEqual(['last', 'verify', 'run', 'start', 'requests', 'assembler', 'emulator', 'debugger']);
    const src = 'const b = build.last;\nfor (const f of b.files) {\n}\n';
    expect(names('b', src)).toEqual(['ok', 'fresh', 'by', 'files', 'log']);
    expect(names('f', src)).toEqual(['name', 'source', 'ok', 'same', 'total', 'start', 'end', 'bytes', 'prg', 'errors']);
    expect(jsTypeOf('build.last.files[0].prg', src)).toBe('bytes');
    expect(jsTypeOf('build.requests[0]', src)).toBe('text');
  });
});
