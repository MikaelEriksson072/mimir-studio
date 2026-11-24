/* The library for a JavaScript script (spec 10.3, 10.6): its items read, put in memory, and what a run asks to be
 * added. */
import { describe, expect, it } from 'vitest';
import { libraryHash, libraryRequestText, makePsid, parsePsid, pictureData, picture, readPicture, runJs, type LibraryItem, type ScriptEnv, type ScriptLibraryData, type UserScript } from '../src';
import { fromSource } from './helpers/programs';

const program = fromSource('p.prg', ['.pc = $0810', 'start: rts'].join('\n'));
const env: ScriptEnv = { files: [program], names: new Map([['start', 0x0810]]) };
const js = (lines: string[]): UserScript => ({ id: 's', name: 's', lang: 'kickass', code: 'js', source: lines.join('\n'), pads: [] });

const tune = makePsid(Uint8Array.of(0x4c, 0x06, 0x10, 0x4c, 0x07, 0x10, 0x60, 0x60), 0x1000, 0x1000, 0x1003, 'Title tune');
const sprites = Uint8Array.from({ length: 128 }, (_, i) => i);
const chars = Uint8Array.from({ length: 24 }, (_, i) => 0x80 + i);
const pic = picture({ mc: true, bitmap: new Uint8Array(8000).fill(0xaa), screen: new Uint8Array(1000).fill(0x12), color: new Uint8Array(1000).fill(5), bg: 6 });
const item = (kind: LibraryItem['kind'], file: string, name: string, data: Uint8Array, more: Partial<LibraryItem> = {}): LibraryItem => ({ kind, file, name, added: 1000, hash: libraryHash(data), data, ...more });
const data = (): ScriptLibraryData => ({ dir: 'C:\\Lib', formats: { mc: 'koala', hires: 'art' }, items: [
  item('sid', 'Game - music_1000 ($1000-$1007).sid', 'music_1000', tune, { from: { project: 'Game', file: 'game.prg', start: 0x1000, end: 0x1008 } }),
  item('sprites', 'Game - ship.spr', 'ship', sprites, { mc: true, colors: { bg: 0, fg: 1, mc1: 2, mc2: 3 } }),
  item('chars', 'font.64c', 'font', chars, { load: 0x3800, own: true }),
  item('bitmaps', 'Game - title.kla', 'title', pictureData(pic), { mc: true }),
] });
const run = (lines: string[], d: ScriptLibraryData | null = data()) => runJs(env, js(lines), { library: d });

describe('library in a JavaScript script', () => {
  it('lists the library: every item, each kind, and what an item is', () => {
    const r = run([
      'print(library.folder, library.items.length, library.sids.length, library.sprites.length, library.chars.length, library.bitmaps.length);',
      'for (const i of library.items) print(i.kind, i.name, i.file, i.size, i.count, i.load, i.mc, i.own, i.added, i.hash.length);',
      'const s = library.sids[0];', 'print(s.tune.name, hex(s.tune.start), hex(s.tune.init), hex(s.tune.play), s.tune.songs, s.from.project, s.from.file, hex(s.from.start), s.from.disk);',
      'const p = library.sprites[0];', 'print(p.sprite(1)[0], p.sprite(1).length, JSON.stringify(p.colors), library.chars[0].char(2).join(), library.chars[0].colors);',
      'const b = library.bitmaps[0];', 'print(b.bitmap.length, b.bitmap[0], b.screen.length, b.screen[0], b.colorRam[999], b.background);',
      'try { p.sprite(2); } catch (e) { print(e.message); }',
    ]);
    expect(r.error).toBeUndefined();
    expect(r.prints).toEqual([
      'C:\\Lib 4 1 1 1 1',
      `sid music_1000 Game - music_1000 ($1000-$1007).sid ${tune.length} 1 null false false 1000 8`,
      'sprites ship Game - ship.spr 128 2 null true false 1000 8',
      'chars font font.64c 24 3 14336 false true 1000 8',
      'bitmaps title Game - title.kla 10001 1 null true false 1000 8',
      'Title tune $1000 $1000 $1003 1 Game game.prg $1000 null',
      '64 64 {"bg":0,"fg":1,"mc1":2,"mc2":3} 144,145,146,147,148,149,150,151 null',
      '8000 170 1000 18 5 6',
      'sprite: ship has 2, numbered from 0 (not 2)',
    ]);
  });

  it('finds items by name, file or text, and by their bytes', () => {
    const r = run([
      'print(library.find("SHIP").file, library.find("font.64c").name, library.find("game - title").kind, library.find("ship", "chars"), library.find("nothing"));',
      'print(library.search("game").map(i => i.name).join(), library.search("game", "sid").length, library.search("zzz").length);',
      'print(library.same("sprites", library.sprites[0].bytes).name, library.same("chars", [1, 2, 3]), library.same("sid", library.sids[0].bytes).name);',
      'try { library.find("x", "tunes"); } catch (e) { print(e.message); }',
    ]);
    expect(r.error).toBeUndefined();
    expect(r.prints).toEqual(['Game - ship.spr font bitmaps null null', 'music_1000,ship,title 1 0', 'ship null music_1000', 'library.find: the kind is "sid", "sprites", "chars" or "bitmaps" (not "tunes")']);
  });

  it('puts an item in mem and gives it as a file', () => {
    const r = run([
      'const a = library.sids[0].put();', 'print(hex(a.start), hex(a.end), hex(mem[0x1000], 2));',
      'const b = library.chars[0].put();', 'const c = library.chars[0].put(0x2000);', 'print(hex(b.start), hex(c.start), hex(c.end), mem[0x3800], mem[0x2000]);',
      'const d = library.sprites[0].put(0x3000);', 'print(hex(d.end), mem[0x3001]);',
      'const e = library.bitmaps[0].put({ bitmap: 0x6000, screen: 0x4400 });', 'print(hex(e.start), hex(e.end), mem[0x6000], mem[0x4400], mem[0xd800]);',
      'print(library.chars[0].asFile().length, hex(library.chars[0].asFile()[1], 2), library.sprites[0].asFile().length, library.bitmaps[0].asFile().length, library.bitmaps[0].asFile("ocp").length, library.sids[0].asFile().length === library.sids[0].size);',
      'for (const f of [() => library.sprites[0].put(), () => library.bitmaps[0].put(0x2000), () => library.sprites[0].put(0xffe0), () => library.bitmaps[0].asFile("gif")]) try { f(); } catch (e) { print(e.message); }',
    ]);
    expect(r.error).toBeUndefined();
    expect(r.prints).toEqual(['$1000 $1008 $4c', '$3800 $2000 $2018 128 128', '$3080 1', '$4400 $7f40 170 18 14', '26 $38 128 10003 10018 true',
      'put: where? ship has no load address: put(address)', 'put: a picture goes to put({ bitmap, screen, colorRam }): an address for each part that is wanted',
      'put: 128 bytes at $ffe0 run past $ffff', 'asFile: the format is "koala", "ocp", "art", "doodle" (not "gif")']);
    expect(r.changes).toEqual([]);
  });

  it('ends the run with what it asked to be added, each as the file the library keeps', () => {
    const r = run([
      'library.add("sid", library.sids[0].bytes, { name: "Again", author: "Me", from: "a script" });',
      'library.add("sprites", mem.subarray(0x0810, 0x0811), { name: "one", mc: true, colors: { bg: 0, fg: 1, mc1: 2, mc2: 3 } });',
      'library.add("chars", new Uint8Array(20).fill(7), { name: "set", load: 0x3000 });',
      'library.add("bitmaps", { bitmap: new Uint8Array(8000).fill(1), screen: new Uint8Array(1000).fill(2), mc: false }, { name: "pic" });',
      'library.add("bitmap", { bitmap: new Uint8Array(8000), background: 3 }, { name: "pic2", format: "ocp" });',
      'library.requests.forEach(t => print(t));',
    ]);
    expect(r.error).toBeUndefined();
    const a = r.library!;
    expect(a.map(x => [x.kind, x.name, x.bytes.length, x.data.length, x.format, x.mc])).toEqual([
      ['sid', 'Again', tune.length, tune.length, undefined, undefined], ['sprites', 'one', 64, 64, undefined, true], ['chars', 'set', 18, 16, undefined, false],
      ['bitmaps', 'pic', 9009, 10001, 'art', false], ['bitmaps', 'pic2', 10018, 10001, 'ocp', true]]);
    expect([parsePsid(a[0].bytes).name, parsePsid(a[0].bytes).author, a[0].from]).toEqual(['Again', 'Me', { text: 'a script' }]);
    expect(a[1].colors).toEqual({ bg: 0, fg: 1, mc1: 2, mc2: 3 });
    expect([a[2].bytes[0], a[2].bytes[1]]).toEqual([0x00, 0x30]);
    const back = readPicture('art', a[3].bytes);
    expect('problem' in back ? null : [back.bitmap[0], back.screen[0]]).toEqual([1, 2]);
    expect(r.prints).toEqual([`Again (SID, ${tune.length} bytes)`, 'one (sprites, 1 sprite)', 'set (charset, 2 characters)', 'pic (bitmap, hires picture, Art Studio)', 'pic2 (bitmap, multicolour picture, Advanced Art Studio)']);
    expect(libraryRequestText(a[1])).toBe('one (sprites, 1 sprite)');
  });

  it('adds nothing when the run stops with an error, says what it does not take, and is empty where it is not given', () => {
    expect(run(['library.add("sprites", [1], { name: "x" });', 'throw new Error("no");']).library).toBeUndefined();
    const bad = run(['for (const f of [() => library.add("sprites", [1], {}), () => library.add("sid", [1, 2, 3], { name: "x" }), () => library.add("chars", [1], { name: "x" }), () => library.add("bitmaps", [1], { name: "x" }),',
      '  () => library.add("bitmaps", { bitmap: new Uint8Array(8000), mc: false }, { name: "x", format: "koala" }), () => library.add("sprites", [1], { name: "x", colors: { bg: 16 } }), () => library.add("music", [1], { name: "x" })]) try { f(); print("ok"); } catch (e) { print(e.message); }']);
    expect(bad.prints![0]).toMatch(/^library\.add: a name is wanted/);
    expect(bad.prints![1]).toMatch(/^library\.add: a SID is added as a \.sid file/);
    expect(bad.prints![2]).toBe('library.add: a charset is 8 bytes a character');
    expect(bad.prints![3]).toMatch(/^library\.add: a picture is \{ bitmap, screen, colorRam, background, mc \}/);
    expect(bad.prints![4]).toBe('library.add: Koala Painter is a multicolour format, the picture is hires');
    expect(bad.prints![5]).toMatch(/^library\.add: colors is \{ bg, fg, mc1, mc2 \}/);
    expect(bad.prints![6]).toMatch(/^library\.add: the kind is/);
    expect(bad.library).toBeUndefined();
    expect(run(['for (let i = 0; i < 33; i++) library.add("sprites", [i], { name: "s" + i });']).error?.msg).toBe('RangeError: library.add: a run adds 32 things at most');
    const none = run(['print(library.items.length, library.folder === "", library.find("x"));', 'library.add("sprites", [1], { name: "x" });'], null);
    expect(none.prints).toEqual(['0 true null']);
    expect(none.error?.msg).toMatch(/^Error: library: the library is not given here/);
  });
});
