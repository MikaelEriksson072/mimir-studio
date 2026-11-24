/* Disk images for a JavaScript script (spec 10.3): a D64 and a D81 made, files added and changed, the mounted disk
 * worked on as a copy, and what leaves the run: a file, or the disk to mount. */
import { describe, expect, it } from 'vitest';
import { DiskEdit, diskRequestText, makeD64, parseD64, readD64File, runJs, type ScriptEnv, type UserScript } from '../src';
import { fromSource } from './helpers/programs';

const program = fromSource('p.prg', ['.pc = $0810', 'start: rts', 'data: .byte 1, 2, 3, 4'].join('\n'));
const env: ScriptEnv = { files: [program], names: new Map([['start', 0x0810], ['data', 0x0811]]) };
const js = (lines: string[]): UserScript => ({ id: 's', name: 's', lang: 'kickass', code: 'js', source: lines.join('\n'), pads: [] });
const mounted = makeD64({ name: 'GAME DISK', id: 'GD', files: [{ name: 'BOOT', data: Uint8Array.of(0x01, 0x08, 0x60) }, { name: 'NOTE', type: 'SEQ', data: Uint8Array.from({ length: 300 }, (_, i) => i & 0xff) }] });
const run = (lines: string[], extras: Parameters<typeof runJs>[2] = { disk: mounted }) => runJs(env, js(lines), extras);

describe('disks in a JavaScript script', () => {
  it('makes a D64 and a D81, adds files and reads them back', () => {
    const r = run([
      'for (const kind of disks.kinds) {',
      '  const d = disks.create(kind, { name: "my disk", id: "md" });',
      '  print(d.kind, d.name, d.id, d.dosType, d.tracks, d.sectors, d.size, d.free, d.files.length, String(d));',
      '  const f = d.add("program", mem.subarray(0x0810, 0x0815), { load: "start" });',
      '  d.add("text", [72, 73], { type: "seq" });',
      '  d.add("big", new Uint8Array(1000).fill(7));',
      '  print(f.name, f.type, f.blocks, f.size, f.track, f.sector, d.read("program").join(), d.read("TEXT").join(), d.files.map(x => x.name + ":" + x.size).join(), d.free);',
      '  print(d.has("big"), d.has("small"), d.find("small"), JSON.stringify(d.chain("big").slice(0, 2)), d.sectorsOn(1), d.isFree(1, 0), d.isFree(f.track, f.sector), disks.blocksFor(1000), disks.blocksFor(d.read("big")));',
      '  d.list().forEach(l => print(l));',
      '}',
    ]);
    expect(r.error).toBeUndefined();
    expect(r.prints).toEqual([
      'd64 MY DISK MD 2A 35 683 174848 664 0 D64 "MY DISK" MD: 0 files, 664 blocks free',
      'PROGRAM prg 1 7 17 0 16,8,96,1,2,3,4 72,73 PROGRAM:7,TEXT:2,BIG:1000 658',
      'true false null [{"track":17,"sector":2},{"track":17,"sector":12}] 21 true false 4 4',
      '0 "MY DISK         " MD 2A', '1    "PROGRAM"          PRG', '1    "TEXT"             SEQ', '4    "BIG"              PRG', '658 BLOCKS FREE.',
      'd81 MY DISK MD 3D 80 3200 819200 3160 0 D81 "MY DISK" MD: 0 files, 3160 blocks free',
      'PROGRAM prg 1 7 39 0 16,8,96,1,2,3,4 72,73 PROGRAM:7,TEXT:2,BIG:1000 3154',
      'true false null [{"track":39,"sector":2},{"track":39,"sector":3}] 40 true false 4 4',
      '0 "MY DISK         " MD 3D', '1    "PROGRAM"          PRG', '1    "TEXT"             SEQ', '4    "BIG"              PRG', '3154 BLOCKS FREE.',
    ]);
    expect(r.made).toBeUndefined();
    expect(r.disk).toBeUndefined();
  });

  it('changes a disk: files removed, renamed, replaced and locked, sectors written, the BAM validated, the disk formatted', () => {
    const r = run([
      'const d = disks.create("d81", { name: "work" });',
      'd.add("a", new Uint8Array(600).fill(1)); d.add("b", [1, 2, 3]); d.add("c", [9]);',
      'print(JSON.stringify(d.remove("a")), d.free, d.files.map(f => f.name).join());',
      'd.rename("b", "bee"); d.lock("bee"); d.setType("c", "usr"); d.add("c", [4, 5, 6, 7], { replace: true, type: "usr" });',
      'print(d.files.map(f => f.name + ":" + f.type + (f.locked ? "<" : "") + ":" + f.size).join(), d.read("c").join());',
      'd.name = "renamed"; d.id = "zz";', 'const s = d.sector(1, 0);', 's[0] = 0x4d; s[255] = 0xaa;', 'd.allocate(1, 0); d.allocate(1, 1);',
      'print(d.name, d.id, d.bytes[0], d.sector(1, 0)[255], d.isFree(1, 0), d.free, d.release(1, 1), d.release(1, 1));',
      'print(JSON.stringify(d.validate()), d.free, d.isFree(1, 0));',
      'd.format("empty", "e1");', 'print(d.name, d.id, d.files.length, d.free, d.bytes[0]);',
      'for (const f of [() => d.add("x".repeat(17), [1]), () => d.add("x", "text"), () => d.add("x", [1], { type: "rel" }), () => d.read("gone"), () => d.remove("gone"), () => d.sector(81, 0), () => d.sector(1, 40), () => d.add(5, [1]),',
      '  () => disks.create("d71"), () => disks.create("d64", { name: "a name that is far too long" }), () => disks.open([1, 2, 3]), () => d.add("huge", new Uint8Array(900000))]) try { f(); print("ok"); } catch (e) { print(e.message); }',
    ]);
    expect(r.error).toBeUndefined();
    expect(r.prints!.slice(0, 5)).toEqual([
      '{"name":"A","blocks":3} 3158 B,C',
      // (a file added takes the first free entry of the directory, as on a drive: the one "a" left)
      'C:usr:4,BEE:prg<:3 4,5,6,7',
      'RENAMED ZZ 77 170 false 3156 true false',
      '["1 sector was taken in the BAM and no file has it: free again"] 3158 true',
      'EMPTY E1 0 3160 0',
    ]);
    expect(r.prints!.slice(5)).toEqual([
      'add: a file\'s name is 1 to 16 characters ("xxxxxxxxxxxxxxxxx" is 17)',
      expect.stringMatching(/^add: bytes are wanted/),
      'add: the type is "prg", "seq", "usr" or "del" (not "rel")',
      'read: no file "gone" on the disk', 'remove: no file "gone" on the disk',
      'there is no track 81 sector 0 on the disk (tracks 1-80, 40 sectors each)', 'there is no track 1 sector 40 on the disk (tracks 1-80, 40 sectors each)',
      'add: a name is wanted, a text (not 5)',
      'disks.create: the kind is "d64" (a 1541 disk) or "d81" (a 1581 disk), not "d71"',
      'disks.create: a disk\'s name is 16 characters at most ("a name that is far too long" is 27)',
      expect.stringMatching(/^disks\.open: 3 bytes are not a disk image/),
      'add: "huge" needs 3544 blocks and the disk has 3160 free',
    ]);
  });

  it('works on a copy of the mounted disk: the mounted one stays as it was', () => {
    const before = mounted.slice();
    const r = run([
      'const d = disks.mounted;',
      'print(d.kind, d.name, d.id, d.files.map(f => f.name + ":" + f.type + ":" + f.blocks).join(), d.free, disk.files.length);',
      'd.add("extra", [1, 2, 3, 4]); d.remove("note"); d.name = "changed";',
      'print(d.files.map(f => f.name).join(), d.free, disks.mounted.files.length, disks.mounted.name, disk.name);',
      'const again = disks.open(d.file(), "copy.d64");', 'print(again.read("extra").join(), again.read("boot").join(), JSON.stringify(again.validate()));',
    ]);
    expect(r.error).toBeUndefined();
    expect(r.prints).toEqual(['d64 GAME DISK GD BOOT:prg:1,NOTE:seq:2 661 2', 'BOOT,EXTRA 662 2 GAME DISK GAME DISK', '1,2,3,4 1,8,96 []']);
    expect(mounted).toEqual(before);
    // without a disk there is none to copy, and disks are made all the same
    const none = run(['print(disks.mounted, disks.create("d64").free);'], {});
    expect(none.prints).toEqual(['null 664']);
    // a D81 mounted for scripts is the one disks.mounted gives
    const d81 = DiskEdit.format('d81', 'big one', '81');
    d81.add('file', Uint8Array.of(1, 2));
    const big = run(['const d = disks.mounted;', 'print(d.kind, d.name, d.files.length, d.read("file").join(), disk);'], { disks: { name: 'big.d81', bytes: d81.bytes } });
    expect(big.prints).toEqual(['d81 BIG ONE 1 1,2 null']);
  });

  it('leaves the run as a file, whole, and as the disk to mount', () => {
    const r = run([
      'const d = disks.create("d64", { name: "release", id: "r1" });', 'd.add("game", mem.subarray(0x0810, 0x0815), { load: 0x0810 });',
      'print(d.save(), d.save("side b"), d.save("other.bin"));',
      'const big = disks.create("d81", { name: "collection" });', 'big.add("game", d.read("game"));', 'print(big.save());',
      'd.mount();',
    ]);
    expect(r.error).toBeUndefined();
    expect(r.prints).toEqual(['release.d64 side b.d64 other.bin', 'collection.d81']);
    expect(r.made!.map(f => [f.name, f.load, f.bytes.length])).toEqual([['release.d64', null, 174848], ['side b.d64', null, 174848], ['other.bin', null, 174848], ['collection.d81', null, 819200]]);
    // the D64 is one the rest of Mimir reads
    const img = parseD64(r.made![0].bytes);
    expect([img.name, img.id, img.files.map(f => f.name)]).toEqual(['RELEASE', 'R1', ['GAME']]);
    expect(readD64File(r.made![0].bytes, img.files[0])).toEqual(Uint8Array.of(0x10, 0x08, 0x60, 1, 2, 3, 4));
    expect(new DiskEdit(r.made![3].bytes).read('game')).toEqual(Uint8Array.of(0x10, 0x08, 0x60, 1, 2, 3, 4));
    expect([r.disk!.name, r.disk!.kind, r.disk!.files, r.disk!.free, r.disk!.bytes.length]).toEqual(['release.d64', 'd64', 1, 663, 174848]);
    expect(diskRequestText(r.disk!)).toBe('release.d64 mounted (a D64, 1 file, 663 blocks free)');
    // nothing is mounted after an error
    expect(run(['disks.create("d64").mount();', 'throw new Error("no");']).disk).toBeUndefined();
  });
});
