/* Disks of the Covert Bitops loader (c64/covert-disk.ts, spec 13.5l). The files are packed in the loader's formats and
 * laid out as Cadaver's makedisk and maked64 lay them out (test/helpers/covert-disk.ts, ported from their C sources).
 * The reader was also checked against the example disks of the loader's own releases (2.05, 2.12, 2.23 to 2.29, 3.0 to
 * 3.06): every packed file on them unpacks to what the loader's own unpacker, from the test programs on the same disk,
 * makes of it on Sindri's Cpu, 15 of the 16 are laid out as makedisk lays them out, and the helper writes those 15
 * again byte for byte from what the reader read back (spec 13.5l). */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  COVERT_RAW_AT, covertDiskFile, covertFileName, covertFilePrg, covertScript, covertScriptText, covertSummary, covertUnpackedName, maked64DiskName, maked64Text, makeD64, parseD64,
  readBitfireDisk, readBoozeDisk, readCovertDisk, readKrillDisk, readSparkleDisk, readSpindleDisk, unpackCovertExomizer, unpackCovertExomizer3Raw, unpackCovertFile, unpackCovertPucrunch,
  type CovertDisk,
} from '../src';
import { exo3Raw, exoLevel, makeCovertDisk, pucrunch, type FakeCovertFile } from './helpers/covert-disk';

/** bytes that pack: runs, repeats near and far, and stretches that do not */
const mixed = (n: number, seed: number) => Array.from({ length: n }, (_, i) => {
  const k = i % 700;
  if (k < 120) return (seed + (i >> 5)) & 0xff;
  if (k < 400) return [3, 1, 4, 1, 5, 9, 2, 6][(i + seed) % 8] ^ (k >> 6);
  if (k < 500) return (i * 151 + seed * 7 + (i >> 3) * 31) & 0xff;
  return (k * 3 + seed) & 0xff;
});
const prg = (load: number, bytes: number[]) => [load & 0xff, load >> 8, ...bytes];
const petscii = (s: string) => [...s].map(c => c.charCodeAt(0));

describe("the Covert Bitops loader's packers", () => {
  it('unpacks exomizer level as version 2 does: where it ends, high byte first, then the stream, backwards', () => {
    const plain = mixed(3000, 1);
    const file = exoLevel(plain, 0x4000);
    expect(file.slice(0, 2)).toEqual([0x4b, 0xb8]);
    const u = unpackCovertExomizer(Uint8Array.from(file))!;
    expect(u).toMatchObject({ packer: 'exomizer', start: 0x4000, end: 0x4000 + 3000 });
    expect([...u.bytes]).toEqual(plain);
    // forwards (-f) when backwards does not fit below the address
    const f = unpackCovertExomizer(Uint8Array.from(exoLevel(mixed(600, 2), 0x0100, { forward: true })))!;
    expect(f).toMatchObject({ packer: 'exomizer-forward', start: 0x0100, end: 0x0100 + 600 });
    expect([...f.bytes]).toEqual(mixed(600, 2));
    // Exomizer 3 (2.27 on): the same with protocol 7
    const e3 = unpackCovertExomizer(Uint8Array.from(exoLevel(plain, 0x2000, { exo3: true })), 3)!;
    expect(e3).toMatchObject({ packer: 'exomizer3', start: 0x2000 });
    expect([...e3.bytes]).toEqual(plain);
    expect(unpackCovertFile(Uint8Array.from(exoLevel(plain, 0x2000, { exo3: true })))).toMatchObject({ packer: 'exomizer3' });
    // a byte more is not a file
    expect(unpackCovertExomizer(Uint8Array.from([...file, 0]))).toBeNull();
  });

  it('unpacks exomizer3 raw as version 3 does: the stream alone, to where the program says', () => {
    const plain = mixed(2000, 3);
    const u = unpackCovertExomizer3Raw(Uint8Array.from(exo3Raw(plain)))!;
    expect(u).toMatchObject({ packer: 'exomizer3-raw', start: null, end: null });
    expect([...u.bytes]).toEqual(plain);
    expect(unpackCovertFile(Uint8Array.from(exo3Raw(plain)))).toMatchObject({ packer: 'exomizer3-raw' });
  });

  it('unpacks pucrunch -c0 in the old format the loader reads: escapes, copies, runs from the table and not', () => {
    const plain = [...mixed(1500, 4), ...Array(40).fill(0), ...Array(9).fill(0x77), 0xc5, 0xc5, 0x41, 0x42, 0x41, 0x42, ...mixed(300, 5)];
    const file = pucrunch(plain, 0x3000, 0x5000);
    expect(file.slice(2, 4)).toEqual([0x70, 0x75]);
    const u = unpackCovertPucrunch(Uint8Array.from(file))!;
    expect(u).toMatchObject({ packer: 'pucrunch', start: 0x3000, end: 0x3000 + plain.length });
    expect([...u.bytes]).toEqual(plain);
    // without "pu", or with a byte more, it is not one
    expect(unpackCovertPucrunch(Uint8Array.from([...file.slice(0, 2), 0x70, 0x76, ...file.slice(4)]))).toBeNull();
    expect(unpackCovertPucrunch(Uint8Array.from([...file, 0]))).toBeNull();
  });

  it('is no packed file for other bytes', () => {
    expect(unpackCovertFile(new TextEncoder().encode('MIMIR STUDIO READS COVERT BITOPS DISKS'))).toBeNull();
    expect(unpackCovertFile(Uint8Array.from(prg(0x0801, [0x0b, 0x08, 0x0a, 0x00, 0x9e, 0x32, 0x30, 0x36, 0x31, 0, 0, 0])))).toBeNull();
    expect(unpackCovertFile(Uint8Array.from(prg(0x4000, mixed(800, 9))))).toBeNull();
  });
});

/** a boot program at $0801 (SYS 2061) whose code is `code` */
const boot = (code: number[]) => prg(0x0801, [0x0b, 0x08, 0x0a, 0x00, 0x9e, 0x32, 0x30, 0x36, 0x31, 0, 0, 0, ...code]);

/** version 2: a boot that loads "P1" by two letters and "PICTURE" by a pointer to its name (at $0830), files packed
 *  every way version 2 unpacks, one not packed, written by makedisk with an interleave of 12 */
function v2Files(): FakeCovertFile[] {
  const code = [0xa2, 0x50, 0xa0, 0x31, 0x20, 0x00, 0xc0, 0xa2, 0x30, 0xa0, 0x08, 0x20, 0x03, 0xc0, 0x60];
  const name = [...petscii('PICT*'), 0];
  const pad = Array(0x0830 - 0x080d - code.length).fill(0xea);
  return [
    { name: 'BOOT', data: boot([...code, ...pad, ...name]) },
    { name: 'P1', data: exoLevel(mixed(4000, 1), 0x2000) },
    { name: 'PICTURE', data: pucrunch(mixed(2500, 2), 0x6000, 0x7000) },
    { name: 'M3_MUSIC', data: exoLevel(mixed(1200, 3), 0x1000, { exo3: true }) },
    { name: 'TEXT', data: prg(0x0400, mixed(500, 4)) },
  ];
}
const v2Disk = () => makeCovertDisk(v2Files(), { tool: 'makedisk', name: 'COVERT_TEST_______CB_2A', interleave: 12 });

describe('disks of the Covert Bitops loader', () => {
  it("reads version 2's disk: the files in the directory's order, unpacked, and the calls in the boot's code", () => {
    const d = readCovertDisk(v2Disk())!;
    expect(d).toMatchObject({ version: 2, found: 'files', packers: ['exomizer', 'exomizer3', 'pucrunch'], header: 'COVERT TEST', id: 'CB 2A', interleave: 12, tracks: 35, tool: 'makedisk', order: [0, 1, 2, 3, 4], dirTrack: false });
    expect(d.files.map(f => [f.entry, f.key, f.basic, f.unpacked && [f.unpacked.packer, f.unpacked.start, f.unpacked.end]])).toEqual([
      [0, 'BO', true, null], [1, 'P1', false, ['exomizer', 0x2000, 0x2000 + 4000]], [2, 'PI', false, ['pucrunch', 0x6000, 0x6000 + 2500]],
      [3, 'M3', false, ['exomizer3', 0x1000, 0x1000 + 1200]], [4, 'TE', false, null],
    ]);
    expect([...d.files[1].unpacked!.bytes]).toEqual(mixed(4000, 1));
    // makedisk starts next to the directory (with an interleave over 10: at 19, sector 0 then down) and steps on
    expect(d.files[0].sectors).toEqual([[19, 0]]);
    expect(d.files[1].sectors.slice(0, 3)).toEqual([[19, 18], [19, 11], [19, 4]]);
    expect(d.calls.map(c => [c.in, c.at, c.jsr, c.to, c.file, c.how])).toEqual([[0, 0x080d, 0x0811, 0xc000, 1, 'letters'], [0, 0x0814, 0x0818, 0xc003, 2, 'name']]);
    expect(covertSummary(d)).toBe('version 2, 3 files packed (Exomizer 1/2, Exomizer 3, Pucrunch), 2 load calls read from the code');
  });

  it('reads version 3\'s disk: names as hex digits, raw files where the calls put them, maked64\'s order and interleaves', () => {
    // the loader's code (its drive commands) and calls: lda #$01 / ldx #<$4000 / ldy #>$4000 / jsr, lda #$02 / jsr
    const cmds = [0x20, 0x04, 0x04, 0x57, 0x2d, 0x4d, 0x04, 0x7b, 0x45, 0x2d, 0x4d];
    const code = [0xa9, 0x01, 0xa2, 0x00, 0xa0, 0x40, 0x20, 0x00, 0x09, 0xa9, 0x02, 0x20, 0x10, 0x09, 0x60, ...cmds];
    const files: FakeCovertFile[] = [
      { name: 'GAME', data: boot(code) },
      { name: '01', data: exo3Raw(mixed(3000, 5)) },
      { name: '02', data: prg(0x0c00, mixed(700, 6)), interleave: 7 },
      { name: '03_TITLE', data: exo3Raw(mixed(900, 7)) },
    ];
    const disk = makeCovertDisk(files, { tool: 'maked64', name: 'GAME_DISK_________GD_2A', interleave: 10, order: [2, 0, 1, 3] });
    const d = readCovertDisk(disk)!;
    expect(d).toMatchObject({ version: 3, found: 'code', packers: ['exomizer3-raw'], tool: 'maked64', order: [2, 0, 1, 3], interleave: 10 });
    expect([...d.fileInterleave]).toEqual([[2, 7]]);
    expect(d.files.map(f => [f.key, f.code, f.unpacked && [f.unpacked.start, f.unpacked.end]])).toEqual([
      ['GA', 3, null], ['01', null, [0x4000, 0x4000 + 3000]], ['02', null, null], ['03', null, [null, null]],
    ]);
    // maked64 starts at track 1, the file it writes first there
    expect(d.files[2].sectors[0]).toEqual([1, 0]);
    expect(d.calls.map(c => [c.at, c.file, c.how, c.dest])).toEqual([[0x080d, 1, 'number', 0x4000]]);
    // a raw file no call places opens at COVERT_RAW_AT
    expect([...covertFilePrg(d.files[3]).subarray(0, 2)]).toEqual([COVERT_RAW_AT & 0xff, COVERT_RAW_AT >> 8]);
    expect(covertFileName(d.files[3])).toBe('file03_raw.exo3');
  });

  it('names the files and makes PRGs of them: unpacked, and as they are on the disk', () => {
    const d = readCovertDisk(v2Disk())!;
    expect(d.files.map(covertFileName)).toEqual(['file00_0801.prg', 'file01_2000.exo', 'file02_6000.puc', 'file03_1000.exo3', 'file04_0400.prg']);
    expect(d.files.map(covertUnpackedName)).toEqual(['file00_0801.prg', 'file01_2000.prg', 'file02_6000.prg', 'file03_1000.prg', 'file04_0400.prg']);
    expect([...covertFilePrg(d.files[1])]).toEqual(prg(0x2000, mixed(4000, 1)));
    expect([...covertFilePrg(d.files[4])]).toEqual(prg(0x0400, mixed(500, 4)));
    expect([...covertDiskFile(d.files[2])]).toEqual(pucrunch(mixed(2500, 2), 0x6000, 0x7000));
  });

  it('writes names and the disk name as the tools take them', () => {
    expect(maked64Text(Uint8Array.from([0x50, 0x49, 0x43, 0x20, 0x31, 0xa0, 0xa0]))).toBe('PIC_1');
    expect(maked64Text(Uint8Array.from([0x41, 0xc1]))).toBeNull();
    expect(maked64DiskName(Uint8Array.from([...petscii('MY DISK'), ...Array(11).fill(0xa0), ...petscii('MD'), 0xa0, ...petscii('2A')]))).toBe('MY.DISK___________MD_2A');
  });

  const rebuilt = (d: CovertDisk, files: FakeCovertFile[]) => {
    const s = covertScript(d, 'test.d64');
    const [, , , name, il, dir] = s.command.split(' ');
    const lines = s.seq.slice(0, s.seq.includes('') ? s.seq.indexOf('') : s.seq.length).map(l => l.split(' '));
    const order = s.seq.includes('') ? s.seq.slice(s.seq.indexOf('') + 1).map(n => lines.findIndex(l => l[0] === n)) : undefined;
    const byLocal = (local: string) => files[d.entries.findIndex(e => e.file && covertFileName(e.file) === local)];
    return makeCovertDisk(lines.map(([local, nm, own]) => ({ name: nm, data: byLocal(local).data, interleave: own ? Number(own) : undefined })), { tool: s.tool, name, interleave: Number(il), order, dir: dir === 'dir' });
  };

  it("rebuilds makedisk's command file: the disk it writes again is the same, byte for byte", () => {
    const disk = v2Disk(), d = readCovertDisk(disk)!, s = covertScript(d, 'test.d64');
    expect(s.tool).toBe('makedisk');
    expect(s.seq).toEqual(['file00_0801.prg BOOT', 'file01_2000.exo P1', 'file02_6000.puc PICTURE', 'file03_1000.exo3 M3_MUSIC', 'file04_0400.prg TEXT']);
    expect(s.command).toBe('makedisk test.d64 test.seq COVERT_TEST_______CB_2A 12');
    const text = covertScriptText(s);
    expect(text[0]).toBe('; makedisk command file, rebuilt by Mimir Studio from test.d64 (Covert Bitops loader, version 2): 5 files, 3 of them packed.');
    expect(text).toContain(';   01 "P1"               file01_2000.exo  ' + `${exoLevel(mixed(4000, 1), 0x2000).length} bytes, Exomizer 1/2 (exomizer level (Exomizer 1: exomizer -r)), unpacks to $2000-$2f9f (4000 bytes)`);
    expect(text).toContain(';       loaded by $080d in entry 00: ldx #"P" / ldy #"1" / jsr $c000');
    expect(text).toContain(';       loaded by $0814 in entry 00: ldx #<name / ldy #>name / jsr $c003 ("PICTURE")');
    expect(text[text.length - 1]).toBe('; makedisk test.d64 test.seq COVERT_TEST_______CB_2A 12');
    expect(rebuilt(d, v2Files())).toEqual(disk);
  });

  it("rebuilds maked64's command file with its write order and a file's own interleave, the same disk again", () => {
    const files: FakeCovertFile[] = [
      { name: 'BOOT', data: boot([0x60]) },
      { name: '00', data: exo3Raw(mixed(2000, 1)) },
      { name: '01', data: exo3Raw(mixed(5000, 2)), interleave: 4 },
      { name: '02', data: exoLevel(mixed(800, 3), 0x5000) },
    ];
    const disk = makeCovertDisk(files, { tool: 'maked64', name: 'M64_______________M6_2A', interleave: 10, order: [3, 1, 0, 2] });
    const d = readCovertDisk(disk)!, s = covertScript(d, 'test.d64');
    expect(s.seq).toEqual(['file00_0801.prg BOOT', 'file01_raw.exo3 00', 'file02_raw.exo3 01 4', 'file03_5000.exo 02', '', 'file03_5000.exo', 'file01_raw.exo3', 'file00_0801.prg', 'file02_raw.exo3']);
    expect(s.command).toBe('maked64 test.d64 test.seq M64_______________M6_2A 10');
    expect(rebuilt(d, files)).toEqual(disk);
    // with the dir option the files go on track 18 too
    // (bytes that do not pack, enough of them to fill the other tracks)
    const noise = (n: number, seed: number) => { let x = seed * 2654435761 >>> 0; return Array.from({ length: n }, () => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return x >>> 24; }); };
    const big = Array.from({ length: 10 }, (_, i): FakeCovertFile => ({ name: `F${i}`, data: exo3Raw(noise(16900, i + 1)) }));
    const full = makeCovertDisk(big, { tool: 'maked64', name: 'FULL', dir: true });
    const f = readCovertDisk(full)!;
    expect(f).toMatchObject({ tool: 'maked64', dirTrack: true });
    expect(covertScript(f, 'full.d64').command).toMatch(/ 10 dir$/);
    expect(rebuilt(f, big)).toEqual(full);
  });

  it('says when neither tool laid the disk out, and writes maked64\'s command file all the same', () => {
    // written by makedisk, then the first two directory entries swapped: makedisk writes in the directory's order
    const disk = makeCovertDisk(v2Files(), { tool: 'makedisk', interleave: 12 });
    const dir = 0x16600 + 2;
    const first = disk.slice(dir, dir + 30);
    disk.copyWithin(dir, dir + 32, dir + 62);
    disk.set(first, dir + 32);
    const d = readCovertDisk(disk)!;
    expect(d.entries.map(e => e.name)).toEqual(['P1', 'BOOT', 'PICTURE', 'M3 MUSIC', 'TEXT']);
    expect(d.tool).toBeNull();
    expect(covertScriptText(covertScript(d, 'other.d64')).join('\n')).toContain('Neither maked64 nor makedisk laid this\n; disk out');
  });

  it('finds none on other disks, nor on one whose files are mostly something else', () => {
    expect(readCovertDisk(makeD64({ name: 'PLAIN', files: [{ name: 'A', data: Uint8Array.from([0x01, 0x08, 0x60]) }] }))).toBeNull();
    for (const name of ['bitfire-demo.d64', 'spindle-demo.d64', 'booze-demo.d64', 'sparkle-demo.d64', 'krill-demo.d64', 'mimir-demo.d64', 'kernal-load.d64', 'pirateslayer-demo.d64', 'turn-disk-a.d64', 'turn-disk-b.d64']) {
      const img = new Uint8Array(readFileSync(join(__dirname, '../../../fixtures/d64', name)));
      expect(readCovertDisk(img), name).toBeNull();
    }
    expect(readCovertDisk(new Uint8Array(1000))).toBeNull();
    const packed = v2Files().slice(1, 3), other = (n: number): FakeCovertFile => ({ name: `O${n}`, data: prg(0x4000, mixed(600, n)) });
    expect(readCovertDisk(makeCovertDisk([...packed, other(5), other(6)], { tool: 'makedisk' }))).toBeNull();
    expect(readCovertDisk(makeCovertDisk([...packed, other(5)], { tool: 'makedisk' }))).not.toBeNull();
    // one packed file alone is not enough, without the loader's code
    expect(readCovertDisk(makeCovertDisk(v2Files().slice(0, 2), { tool: 'makedisk' }))).toBeNull();
  });
});

describe('the Covert disk fixture', () => {
  it('is fixtures/d64/covert-demo.d64, which the e2e tests mount: the raster demo packed, Pucrunch, Exomizer 3, a file as it is', () => {
    const demo = [...readFileSync(join(__dirname, '../../../fixtures/prg/raster-demo.prg'))];
    const start = demo[0] | (demo[1] << 8);
    const files: FakeCovertFile[] = [
      { name: 'COVERT_DEMO', data: boot([0xa2, 0x30, 0xa0, 0x31, 0x20, 0x00, 0xc0, 0x4c, 0x01, 0x08]) },
      { name: '01_RASTER', data: exoLevel(demo.slice(2), start) },
      { name: '02_ART', data: pucrunch(mixed(2000, 5), 0x4000, 0x6000) },
      { name: '03_MUSIC', data: exoLevel(mixed(1500, 6), 0x1000, { exo3: true }) },
      { name: '04_TEXT', data: prg(0x0400, petscii('THE COVERT BITOPS LOADER LOADS FILES BY NAME.')) },
    ];
    const disk = makeCovertDisk(files, { tool: 'makedisk', name: 'COVERT_DEMO_______CB_2A', interleave: 10 });
    const path = join(__dirname, '../../../fixtures/d64/covert-demo.d64');
    if (process.env.WRITE_FIXTURES) writeFileSync(path, disk);
    expect(new Uint8Array(readFileSync(path))).toEqual(disk);
    const d = readCovertDisk(disk)!;
    expect(d).toMatchObject({ version: 2, tool: 'makedisk', interleave: 10 });
    expect(d.files.map(f => [covertFileName(f), f.unpacked?.packer ?? null])).toEqual([
      ['file00_0801.prg', null], ['file01_0801.exo', 'exomizer'], ['file02_4000.puc', 'pucrunch'], ['file03_1000.exo3', 'exomizer3'], ['file04_0400.prg', null],
    ]);
    expect([...covertFilePrg(d.files[1])]).toEqual(demo);
    expect(d.calls.map(c => [c.file, c.how])).toEqual([[1, 'letters']]);
    expect(parseD64(disk)).toMatchObject({ name: 'COVERT DEMO', id: 'CB' });
    // no other reader takes it
    expect(readBitfireDisk(disk)).toBeNull();
    expect(readSpindleDisk(disk)).toBeNull();
    expect(readBoozeDisk(disk)).toBeNull();
    expect(readSparkleDisk(disk)).toBeNull();
    expect(readKrillDisk(disk)).toBeNull();
  });
});
