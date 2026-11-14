/* Disks of Krill's loader with its ZX0 or, version 146, Doynax LZ (c64/krill-disk.ts, spec 13.5k and 13.5l). The files
 * are packed the way the loader's unpackers read them, the disks laid out as test/helpers/krill-disk.ts writes them. The
 * reader was also checked against released disks: every file Nightfall's loader unpacked in Sindri is byte for byte
 * what it unpacks (spec 13.5k), and so is every packed file of both sides of GoatLight (2015) against the demo's own
 * Doynax unpacker, taken from its boot and run on Sindri's Cpu (spec 13.5l). */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cc1541Script, cc1541Text, krillDiskPrg, krillFileName, krillFilePrg, krillUnpackedName, makeD64, parseD64, readBitfireDisk, readBoozeDisk, readKrillDisk, readSparkleDisk, readSpindleDisk, unpackDali, unpackKrillDoynax, unpackKrillTinyCrunch, unpackKrillZx0 } from '../src';
import { KrillDoynax, KrillZx0, makeKrillDisk, packKrillDoynax, packKrillInPlace, packKrillTinyCrunch, packKrillTinyCrunchInPlace, packKrillZx0, type FakeKrillEntry } from './helpers/krill-disk';

/** the bytes of literals and copies (an offset of 0: the last one again), as a plain decoder makes them */
function expand(steps: ([number[]] | [number, number])[]): number[] {
  const out: number[] = [];
  let last = 1;
  for (const s of steps) {
    if (s.length === 1) out.push(...s[0]);
    else { const [len, off] = s; if (off) last = off; for (let i = 0; i < len; i++) out.push(out[out.length - last]); }
  }
  return out;
}

/** bytes that pack: runs, repeats near and far, and stretches that do not */
const mixed = (n: number, seed: number) => Array.from({ length: n }, (_, i) => {
  const k = i % 700;
  if (k < 120) return (seed + (i >> 5)) & 0xff;
  if (k < 400) return [3, 1, 4, 1, 5, 9, 2, 6][(i + seed) % 8] ^ (k >> 6);
  if (k < 500) return (i * 151 + seed * 7 + (i >> 3) * 31) & 0xff;
  return (k * 3 + seed) & 0xff;
});

describe("Krill's loader's ZX0", () => {
  it('reads its bits from the bottom of a byte and the address high byte first', () => {
    // a literal of 1 ($41) and the end: the bits 1 (length 1), 1 (a new offset), 256 (sixteen 0s and a 1), the first
    // byte of bits before the literal, the next ones when they are needed
    const u = unpackKrillZx0(Uint8Array.from([0x10, 0x00, 0x03, 0x41, 0x00, 0x04]), 0x8000);
    expect(u).toMatchObject({ start: 0x1000, end: 0x1001, inplace: false });
    expect([...u!.bytes]).toEqual([0x41]);
    // the same stream as Bitfire's dali (bits from the top) is no file, nor is it read with the address low byte first
    expect(unpackDali(Uint8Array.from([0x00, 0x10, 0x03, 0x41, 0x00, 0x04]), 0x8000)).toBeNull();
  });

  it('unpacks a file with an end: literals, matches, a repeated offset, far offsets and 16-bit lengths', () => {
    const w = new KrillZx0();
    const lit300 = Array.from({ length: 300 }, (_, i) => (i * 13 + 7) & 0xff);
    w.literal([0x61, 0x62], true); w.match(5, 2); w.literal([0x63]); w.rep(4); w.match(300, 3); w.literal(lit300); w.match(2, 7); w.match(40, 200); w.match(3, 600); w.end();
    const plain = expand([[[0x61, 0x62]], [5, 2], [[0x63]], [4, 0], [300, 3], [lit300], [2, 7], [40, 200], [3, 600]]);
    const packed = Uint8Array.from([0x10, 0x00, ...w.out]);
    const u = unpackKrillZx0(packed, 0x8000);
    expect(u).toMatchObject({ start: 0x1000, end: 0x1000 + plain.length, inplace: false });
    expect([...u!.bytes]).toEqual(plain);
    // a byte more after the end is not this file
    expect(unpackKrillZx0(Uint8Array.from([...packed, 0]), 0x8000)).toBeNull();
  });

  it('unpacks a file packed in place: it ends where writing reaches reading after a match', () => {
    const plain = mixed(5000, 3);
    const { bytes, load } = packKrillInPlace(plain, 0xd000);
    const u = unpackKrillZx0(Uint8Array.from(bytes), load);
    expect(u).toMatchObject({ start: 0xd000 - plain.length, end: 0xd000, inplace: true });
    expect([...u!.bytes]).toEqual(plain);
    // and one with an end, unpacking elsewhere
    const e = unpackKrillZx0(Uint8Array.from(packKrillZx0(plain, 0x2000)), 0x9000);
    expect(e).toMatchObject({ start: 0x2000, end: 0x2000 + plain.length, inplace: false });
    expect([...e!.bytes]).toEqual(plain);
  });

  it('is no packed file for other bytes', () => {
    expect(unpackKrillZx0(new TextEncoder().encode('MIMIR STUDIO READS KRILL DISKS'), 0x2000)).toBeNull();
    expect(unpackKrillZx0(Uint8Array.from([0x10, 0x00]), 0x2000)).toBeNull();
    // past $ffff
    expect(unpackKrillZx0(Uint8Array.from(packKrillZx0(mixed(300, 1), 0xff00)), 0x8000)).toBeNull();
    // bytes whose first two say they unpack just above where they load: a few of them unpack until the writing reaches
    // the reading (a literal of 1 and a repeat of 1: bits 1, 0, 1), the rest, 950 bytes, left as they are; that is no
    // file packed in place (old disks such as Underground, 1989, have files that do this)
    const near = Uint8Array.from([0x30, 0x02, 0x05, 0x41, ...mixed(950, 8)]);
    expect(unpackKrillZx0(near, 0x3000)).toBeNull();
    // with 1 byte left of 5 it is one
    expect(unpackKrillZx0(Uint8Array.from([0x30, 0x02, 0x05, 0x41, 7]), 0x3000)).toMatchObject({ start: 0x3002, end: 0x3005, inplace: true });
    // a file packed in place that leaves only a few of its bytes as they are is one
    const { bytes, load } = packKrillInPlace([...mixed(3000, 9), ...Array.from({ length: 40 }, (_, i) => (i * 37) & 0xff)], 0x5000);
    expect(unpackKrillZx0(Uint8Array.from(bytes), load)).toMatchObject({ end: 0x5000, inplace: true });
  });
});

/** a dirart line: PETSCII graphics, a shifted letter and reverse bytes */
const ART = [0x6d, 0x6e, 0xbb, 0x9f, 0x20, 0x41, 0xc1, 0x23, 0x22, 0x40, 0x5b, 0x5d];

/** a boot program, two files packed in place, one with an end, a line of the dirart, the same file again */
function entries(): FakeKrillEntry[] {
  const a = packKrillInPlace(mixed(3000, 1), 0x4000), b = packKrillInPlace(mixed(1500, 2), 0xd000);
  return [
    { name: 'BOOT', load: 0x0801, bytes: [0x0b, 0x08, 0x0a, 0x00, 0x9e, 0x32, 0x30, 0x36, 0x31, 0, 0, 0, 0x60], blocks: 0 },
    { name: '----------------', load: a.load, bytes: a.bytes, blocks: 0 },
    { name: ART, load: b.load, bytes: b.bytes, blocks: 0 },
    { name: 'TEXT', load: 0x9000, bytes: packKrillZx0(mixed(800, 4), 0x0400) },
    { name: [0x60, 0x60, 0x60], type: 'DEL' },
    { name: 'AGAIN', same: 3 },
  ];
}

describe('disks of Krill\'s loader', () => {
  it('reads the directory: each file, unpacked when it is packed with the ZX0, in the directory\'s order', () => {
    const d = readKrillDisk(makeKrillDisk(entries(), { header: [0x41, 0x52, 0x54, 0x20, 0x40, 0x20, 0x5a, 0x4f, 0x4f], id: [0x32, 0x30, 0xa0, 0x32, 0x41] }))!;
    expect(d).toMatchObject({ packer: 'zx0', header: 'ART @ ZOO', id: '20 2A', interleave: 1, tracks: 35 });
    expect(d.entries.map(e => [e.n, e.file?.entry ?? null, e.same, e.type])).toEqual([[0, 0, null, 'PRG'], [1, 1, null, 'PRG'], [2, 2, null, 'PRG'], [3, 3, null, 'PRG'], [4, null, null, 'DEL'], [5, null, 3, 'PRG']]);
    expect(d.files.map(f => [f.entry, f.basic, f.unpacked && [f.unpacked.start, f.unpacked.end, f.unpacked.inplace]])).toEqual([
      [0, true, null], [1, false, [0x4000 - 3000, 0x4000, true]], [2, false, [0xd000 - 1500, 0xd000, true]], [3, false, [0x0400, 0x0400 + 800, false]],
    ]);
    expect([...d.files[1].unpacked!.bytes]).toEqual(mixed(3000, 1));
    expect([...d.files[3].unpacked!.bytes]).toEqual(mixed(800, 4));
    expect(d.files[1].sectors[0]).toEqual([1, 1]);
    expect(d.entries[2].name).toBe('mn·· Aa#"@[]');
  });

  it('names the files and makes PRGs of them: unpacked, and as they are on the disk', () => {
    const d = readKrillDisk(makeKrillDisk(entries()))!;
    expect(d.files.map(krillFileName)).toEqual(['file00_0801.prg', 'file01_3448.zx0', 'file02_ca24.zx0', 'file03_0400.zx0']);
    expect(krillUnpackedName(d.files[3])).toBe('file03_0400.prg');
    expect([...krillFilePrg(d.files[3]).subarray(0, 4)]).toEqual([0x00, 0x04, ...mixed(800, 4).slice(0, 2)]);
    expect(krillFilePrg(d.files[3]).length).toBe(802);
    expect([...krillDiskPrg(d.files[3]).subarray(0, 4)]).toEqual([0x00, 0x90, 0x04, 0x00]);
    // one that is not packed opens as it loads
    expect([...krillFilePrg(d.files[0]).subarray(0, 3)]).toEqual([0x01, 0x08, 0x0b]);
  });

  it('writes the names as cc1541 takes them: lower-case letters, # and two hex digits for the other bytes', () => {
    expect(cc1541Text(Uint8Array.from([...ART, 0xa0, 0xa0]))).toBe('#6d#6e#bb#9f a#c1#23#22#40#5b#5d');
    expect(cc1541Text(Uint8Array.from([0x4e, 0x46, 0x2d, 0x31, 0x2e, 0x21, 0x24, 0x20, 0xa0]))).toBe('nf-1.#21#24 ');
    expect(cc1541Text(Uint8Array.from([0x32, 0x30, 0xa0, 0x32, 0x41]), false)).toBe('20#a02a');
  });

  it('rebuilds cc1541\'s command line: the directory in order, the blocks it shows, dirart lines and loop files', () => {
    const d = readKrillDisk(makeKrillDisk(entries(), { header: 'KRILL DEMO', id: [0x32, 0x34, 0xa0, 0x32, 0x41] }))!;
    const s = cc1541Script(d, 'krill.d64');
    expect(s[0]).toBe("# cc1541 command line, rebuilt by Mimir Studio from krill.d64 (Krill's loader, its ZX0): 4 files, 3 of them packed.");
    expect(s.filter(l => l.startsWith('#   '))).toEqual([
      '#   00 "BOOT"             file00_0801.prg  loads at $0801-$080d (13 bytes), a BASIC program, loaded with LOAD and RUN',
      '#   01 "----------------" file01_3448.zx0  loads at $3d73-$3fff (653 bytes), unpacks to $3448-$3fff (3000 bytes)',
      '#   02 "mn·· Aa#"@[]"     file02_ca24.zx0  loads at $ce1b-$cfff (485 bytes), unpacks to $ca24-$cfff (1500 bytes)',
      '#   03 "TEXT"             file03_0400.zx0  loads at $9000-$916e (367 bytes), unpacks to $0400-$071f (800 bytes)',
      '#   04 "···"              a line of the directory, no file',
      '#   05 "AGAIN"            the same file as entry 03',
    ]);
    expect(s.slice(s.indexOf(''))).toEqual(['',
      'cc1541 -n "krill demo" -i "24#a02a" -S 1 \\',
      '  -f "boot" -B 0 -w file00_0801.prg \\',
      '  -f "----------------" -B 0 -w file01_3448.zx0 \\',
      '  -f "#6d#6e#bb#9f a#c1#23#22#40#5b#5d" -B 0 -w file02_ca24.zx0 \\',
      '  -f "text" -w file03_0400.zx0 \\',
      '  -T DEL -f "#60#60#60" -L \\',
      `  -f "again" -B 0 -l "text" \\`,
      '  krill.d64',
    ]);
  });

  it('finds none on other disks, nor on one whose files are mostly packed another way', () => {
    expect(readKrillDisk(makeD64({ name: 'PLAIN', files: [{ name: 'A', data: Uint8Array.from([0x01, 0x08, 0x60]) }] }))).toBeNull();
    for (const name of ['bitfire-demo.d64', 'spindle-demo.d64', 'booze-demo.d64', 'sparkle-demo.d64', 'mimir-demo.d64', 'kernal-load.d64', 'pirateslayer-demo.d64']) {
      const img = new Uint8Array(readFileSync(join(__dirname, '../../../fixtures/d64', name)));
      expect(readKrillDisk(img), name).toBeNull();
    }
    expect(readKrillDisk(new Uint8Array(1000))).toBeNull();
    // two files packed so, but three others that are not (and not BASIC programs): a disk packed another way
    const other = (n: number): FakeKrillEntry => ({ name: `OTHER${n}`, load: 0x4000, bytes: mixed(600, n) });
    const two = entries().slice(1, 3);
    expect(readKrillDisk(makeKrillDisk([...two, other(5), other(6), other(7)]))).toBeNull();
    expect(readKrillDisk(makeKrillDisk([...two, other(5)]))).not.toBeNull();
    // one file alone is not enough
    expect(readKrillDisk(makeKrillDisk([entries()[0], entries()[1]]))).toBeNull();
  });

  it('does not try a BASIC program at $0801 as a packed file, though its bytes may unpack (Kings Size has two)', () => {
    // packed for $1008 at $0801: the address reads as a BASIC line's link to $0810, the second literal byte as SYS
    const packed = packKrillZx0([0x20, 0x9e, ...mixed(600, 3)], 0x1008);
    expect([...packed.slice(0, 2), packed[4]]).toEqual([0x10, 0x08, 0x9e]);
    expect(unpackKrillZx0(Uint8Array.from(packed), 0x0801)).not.toBeNull();
    const d = readKrillDisk(makeKrillDisk([{ name: 'LINE', load: 0x0801, bytes: packed }, ...entries().slice(1, 3)]))!;
    expect(d.files[0]).toMatchObject({ basic: true, unpacked: null });
    expect(d.files.map(f => !!f.unpacked)).toEqual([false, true, true]);
  });
});

describe('the Krill disk fixture', () => {
  it('is fixtures/d64/krill-demo.d64, which the e2e tests mount: the raster demo packed, a dirart name, a file with an end', () => {
    const demo = [...readFileSync(join(__dirname, '../../../fixtures/prg/raster-demo.prg'))];
    const boot = [0x0b, 0x08, 0x0a, 0x00, 0x9e, 0x32, 0x30, 0x36, 0x31, 0, 0, 0, 0x60];
    // the raster demo packed with an end, unpacking to $0801 from a file that loads below $6000
    const start = demo[0] | (demo[1] << 8), rasterPacked = packKrillZx0(demo.slice(2), start);
    const art = packKrillInPlace(mixed(2000, 5), 0xd000);
    const disk = makeKrillDisk([
      { name: 'KRILL DEMO', load: 0x0801, bytes: boot, blocks: 0 },
      { name: '----------------', load: 0x6000 - rasterPacked.length, bytes: rasterPacked, blocks: 0 },
      { name: ART, load: art.load, bytes: art.bytes, blocks: 0 },
      { name: [0x60, 0x60, 0x60, 0x60], type: 'DEL' },
    ], { header: 'KRILL DEMO', id: [0x32, 0x34, 0xa0, 0x32, 0x41] });
    const path = join(__dirname, '../../../fixtures/d64/krill-demo.d64');
    if (process.env.WRITE_FIXTURES) writeFileSync(path, disk);
    expect(new Uint8Array(readFileSync(path))).toEqual(disk);
    const d = readKrillDisk(disk)!;
    expect(d.files.map(f => [krillFileName(f), f.load, f.unpacked?.start ?? null, f.unpacked?.end ?? null])).toEqual([
      ['file00_0801.prg', 0x0801, null, null], ['file01_0801.zx0', 0x6000 - rasterPacked.length, 0x0801, 0x0801 + demo.length - 2], ['file02_c830.zx0', art.load, 0xd000 - 2000, 0xd000],
    ]);
    expect([...krillFilePrg(d.files[1])]).toEqual(demo);
    expect(parseD64(disk)).toMatchObject({ name: 'KRILL DEMO', files: [expect.objectContaining({ name: 'KRILL DEMO', blocks: 0 }), expect.anything(), expect.anything(), expect.objectContaining({ type: 'DEL', track: 0 })] });
    // no other reader takes it
    expect(readBitfireDisk(disk)).toBeNull();
    expect(readSpindleDisk(disk)).toBeNull();
    expect(readBoozeDisk(disk)).toBeNull();
    expect(readSparkleDisk(disk)).toBeNull();
  });
});

describe("Krill's loader's Doynax LZ (version 146)", () => {
  it('reads its bits from the top of a byte, the address low byte first, a literal\'s bytes last first', () => {
    // a literal of 2 ($41 $42: bits 1, 0 0, 1), stored $42 $41, then the end: a match (no bit after a literal), range
    // 0 (bits 000), 4 offset bits (1111 for an offset of 1), length 256 (eight digits 0, each with a 0 to go on, the
    // last with a 1): the first byte of bits is 1001 000 1
    const w = new KrillDoynax();
    w.literal([0x41, 0x42]); w.end();
    const u = unpackKrillDoynax(Uint8Array.from([0x00, 0x10, ...w.out]), 0x8000);
    expect(u).toMatchObject({ start: 0x1000, end: 0x1002, inplace: false, packer: 'doynax', overwritten: 0 });
    expect([...u!.bytes]).toEqual([0x41, 0x42]);
    expect(w.out.slice(0, 3)).toEqual([0x91, 0x42, 0x41]);
  });

  it('unpacks literals, matches of 2 bytes and longer in every offset range, literals of 256 bytes', () => {
    const plain = [...mixed(9000, 7), ...Array.from({ length: 300 }, (_, i) => (i * 97 + 13) & 0xff), ...mixed(2000, 7)];
    const packed = Uint8Array.from(packKrillDoynax(plain, 0x2000));
    const u = unpackKrillDoynax(packed, 0x9000);
    expect(u).toMatchObject({ start: 0x2000, end: 0x2000 + plain.length, overwritten: 0 });
    expect([...u!.bytes]).toEqual(plain);
    // every offset range is used
    const w = new KrillDoynax();
    w.literal([1, 2, 3]);
    for (const [len, off] of [[2, 1], [2, 8], [2, 9], [2, 72], [2, 73], [2, 328], [2, 329], [2, 1352], [3, 1], [5, 16], [4, 17], [9, 144], [3, 145], [3, 1168], [3, 1169], [40, 9360]]) {
      w.match(len, off); w.literal([len]);
    }
    w.end();
    const all = unpackKrillDoynax(Uint8Array.from([0x00, 0x40, ...w.out]), 0x0800);
    // (the copies reach before the start: zeros there, as the unpacker's memory would have)
    expect(all).toMatchObject({ start: 0x4000 });
    expect(all!.bytes.length).toBe(3 + [2, 2, 2, 2, 2, 2, 2, 2, 3, 5, 4, 9, 3, 3, 3, 40].reduce((a, b) => a + b + 1, 0));
    // a byte more after the end is not this file
    expect(unpackKrillDoynax(Uint8Array.from([...packed, 0]), 0x9000)).toBeNull();
  });

  it('unpacks in place, reading what it wrote over bytes of its stream still to be read', () => {
    // a literal written over the stream's own next bytes: GoatLight's C1 has three such bytes
    const w = new KrillDoynax();
    w.literal([0x11, 0x22, 0x33]); w.end();
    const stream = [0x05, 0x10, ...w.out];
    // loaded at $1000 it unpacks to $1005, over the end's own bits
    const u = unpackKrillDoynax(Uint8Array.from(stream), 0x1000);
    expect(u === null || u.overwritten! > 0).toBe(true);
    expect(unpackKrillDoynax(Uint8Array.from(stream), 0x2000)).toMatchObject({ start: 0x1005, end: 0x1008, overwritten: 0 });
  });

  it('reads a disk whose files are packed with it, as GoatLight\'s are, and names them .dnx', () => {
    const a = packKrillDoynax(mixed(3000, 1), 0x2000), b = packKrillDoynax(mixed(1500, 2), 0xc000);
    const disk = makeKrillDisk([
      { name: 'BOOT', load: 0x0801, bytes: [0x0b, 0x08, 0x0a, 0x00, 0x9e, 0x32, 0x30, 0x36, 0x31, 0, 0, 0, 0x60] },
      { name: 'A1 PART ONE', load: 0x6000 - a.length, bytes: a },
      { name: 'B2', load: 0xe000 - b.length, bytes: b },
    ]);
    const d = readKrillDisk(disk)!;
    expect(d.packer).toBe('doynax');
    expect(d.files.map(f => [krillFileName(f), f.unpacked?.start ?? null, f.unpacked?.end ?? null])).toEqual([
      ['file00_0801.prg', null, null], ['file01_2000.dnx', 0x2000, 0x2000 + 3000], ['file02_c000.dnx', 0xc000, 0xc000 + 1500],
    ]);
    expect([...krillFilePrg(d.files[1])]).toEqual([0x00, 0x20, ...mixed(3000, 1)]);
    expect(cc1541Script(d, 'goat.d64')[0]).toBe("# cc1541 command line, rebuilt by Mimir Studio from goat.d64 (Krill's loader, Doynax LZ (version 146)): 3 files, 2 of them packed.");
    // ZX0 is tried first: the ZX0 fixture stays a ZX0 disk
    expect(readKrillDisk(new Uint8Array(readFileSync(join(__dirname, '../../../fixtures/d64/krill-demo.d64'))))!.packer).toBe('zx0');
  });
});

describe("Krill's loader's TinyCrunch (revision 166)", () => {
  it('reads a token a byte: literals, copies of 2 from near, longer copies from far, the end and the last byte', () => {
    // the last byte ($99) and where it unpacks to less 1 ($0fff), then a literal of 2 ($81 'A' 'B'), a copy of 2 from 1
    // back ($fe), one of 3 from 4 back ($0f: length 3, offset bits 7; $fc: $800 - $7fc), the end; the last byte after it
    const u = unpackKrillTinyCrunch(Uint8Array.from([0x99, 0xff, 0x0f, 0x81, 0x41, 0x42, 0xfe, 0x0f, 0xfc, 0x00]), 0x8000);
    expect(u).toMatchObject({ start: 0x1000, end: 0x1008, inplace: false, packer: 'tinycrunch', overwritten: 0 });
    expect([...u!.bytes]).toEqual([0x41, 0x42, 0x42, 0x42, 0x41, 0x42, 0x42, 0x99]);
    // a byte more after the end is not this file
    expect(unpackKrillTinyCrunch(Uint8Array.from([0x99, 0xff, 0x0f, 0x81, 0x41, 0x42, 0xfe, 0x0f, 0xfc, 0x00, 0x00]), 0x8000)).toBeNull();
  });

  it('unpacks literals of 64, copies of up to 17 bytes from up to 2048 back', () => {
    const plain = [...mixed(9000, 7), ...Array.from({ length: 300 }, (_, i) => (i * 97 + 13) & 0xff), ...mixed(2000, 7)];
    const packed = packKrillTinyCrunch(plain, 0x2000);
    // every kind of token is in it
    const u = unpackKrillTinyCrunch(Uint8Array.from(packed), 0x9000);
    expect(u).toMatchObject({ start: 0x2000, end: 0x2000 + plain.length, overwritten: 0 });
    expect([...u!.bytes]).toEqual(plain);
    expect(packed).toContain(0xbf);
    // in place, ending where the file ends
    const { bytes, load } = packKrillTinyCrunchInPlace(plain, 0xd000);
    const p = unpackKrillTinyCrunch(Uint8Array.from(bytes), load);
    expect(p).toMatchObject({ start: 0xd000 - plain.length, end: 0xd000, inplace: true });
    expect([...p!.bytes]).toEqual(plain);
  });

  it('unpacks in place, reading an end it wrote over its stream, past the file\'s end, as Space Beer\'s J does', () => {
    // at $1003 a literal of 2 ($07 $00), then a copy of 6 from 1 back ($27 $ff), which writes 0s over $1008-$100a, the
    // stream's last 3 bytes: the token at $1008 is then a 0 it wrote, the end, and the last byte ($55) goes at $100b
    const stream = [0x55, 0x02, 0x10, 0x81, 0x07, 0x00, 0x27, 0xff, 0xaa, 0xbb, 0xcc];
    const u = unpackKrillTinyCrunch(Uint8Array.from(stream), 0x1000);
    expect(u).toMatchObject({ start: 0x1003, end: 0x100c, inplace: true, overwritten: 3 });
    expect([...u!.bytes]).toEqual([0x07, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x55]);
    // the unpacking has to reach the file's end then: with two bytes more it ends inside the file
    expect(unpackKrillTinyCrunch(Uint8Array.from([...stream, 0xdd, 0xee]), 0x1000)).toBeNull();
    // loaded elsewhere the stream goes on from $aa
    expect(unpackKrillTinyCrunch(Uint8Array.from(stream), 0x4000)).toBeNull();
  });

  it('is no packed file for other bytes', () => {
    expect(unpackKrillTinyCrunch(new TextEncoder().encode('MIMIR STUDIO READS KRILL DISKS'), 0x2000)).toBeNull();
    expect(unpackKrillTinyCrunch(Uint8Array.from([0x99, 0xff, 0x0f]), 0x2000)).toBeNull();
    // a copy from before where it unpacks to (TinyCrunch packs a file on its own)
    expect(unpackKrillTinyCrunch(Uint8Array.from([0x99, 0xff, 0x0f, 0x80, 0x41, 0xfd, 0x00]), 0x8000)).toBeNull();
    // a copy from 0 back ($ff)
    expect(unpackKrillTinyCrunch(Uint8Array.from([0x99, 0xff, 0x0f, 0x81, 0x41, 0x42, 0xff, 0x00]), 0x8000)).toBeNull();
    // a literal of fewer than 64 bytes and then another (a packer makes them one); after one of 64 there can be one
    expect(unpackKrillTinyCrunch(Uint8Array.from([0x99, 0xff, 0x0f, 0x80, 0x41, 0x80, 0x42, 0x00]), 0x8000)).toBeNull();
    const lit64 = Array.from({ length: 64 }, (_, i) => i);
    expect(unpackKrillTinyCrunch(Uint8Array.from([0x99, 0xff, 0x0f, 0xbf, ...lit64, 0x80, 0x42, 0x00]), 0x8000)).toMatchObject({ start: 0x1000, end: 0x1000 + 66 });
    // an end at the stream's start, as a boot program's first bytes can be: the last byte alone, far from the file, is
    // not an end the unpacking wrote over the file (Seaworld's and Artificial Intelligence's boots, in the archive)
    expect(unpackKrillTinyCrunch(Uint8Array.from([0x0b, 0x08, 0x64, 0x00, 0x9e, 0x32, 0x30, 0x36, 0x31]), 0x0801)).toBeNull();
    // past $ffff
    expect(unpackKrillTinyCrunch(Uint8Array.from(packKrillTinyCrunch(mixed(300, 1), 0xff00)), 0x8000)).toBeNull();
  });

  it('reads a disk whose files are packed with it, as Space Beer\'s are, and names them .tc', () => {
    const a = packKrillTinyCrunchInPlace(mixed(3000, 1), 0x4000), b = packKrillTinyCrunch(mixed(1500, 2), 0xc000);
    const disk = makeKrillDisk([
      { name: 'SPACE', load: 0x0801, bytes: [0x0b, 0x08, 0x0a, 0x00, 0x9e, 0x32, 0x30, 0x36, 0x31, 0, 0, 0, 0x60] },
      { name: 'A', load: a.load, bytes: a.bytes },
      { name: 'B', load: 0xe000 - b.length, bytes: b },
    ]);
    const d = readKrillDisk(disk)!;
    expect(d.packer).toBe('tinycrunch');
    expect(d.files.map(f => [krillFileName(f), f.unpacked?.start ?? null, f.unpacked?.end ?? null, f.unpacked?.inplace ?? null])).toEqual([
      ['file00_0801.prg', null, null, null], ['file01_3448.tc', 0x4000 - 3000, 0x4000, true], ['file02_c000.tc', 0xc000, 0xc000 + 1500, false],
    ]);
    expect([...krillFilePrg(d.files[2])]).toEqual([0x00, 0xc0, ...mixed(1500, 2)]);
    expect(cc1541Script(d, 'beer.d64')[0]).toBe("# cc1541 command line, rebuilt by Mimir Studio from beer.d64 (Krill's loader, TinyCrunch): 3 files, 2 of them packed.");
    // ZX0 and Doynax LZ are tried first: those disks stay what they are
    expect(readKrillDisk(new Uint8Array(readFileSync(join(__dirname, '../../../fixtures/d64/krill-demo.d64'))))!.packer).toBe('zx0');
    const dnx = packKrillDoynax(mixed(3000, 1), 0x2000), dnx2 = packKrillDoynax(mixed(1500, 2), 0xc000);
    expect(readKrillDisk(makeKrillDisk([{ name: 'A', load: 0x6000 - dnx.length, bytes: dnx }, { name: 'B', load: 0xe000 - dnx2.length, bytes: dnx2 }]))!.packer).toBe('doynax');
  });
});

describe('the TinyCrunch disk fixture', () => {
  it('is fixtures/d64/krill-tc-demo.d64, which the e2e tests mount: the raster demo packed in place, a file unpacking elsewhere', () => {
    const demo = [...readFileSync(join(__dirname, '../../../fixtures/prg/raster-demo.prg'))];
    const boot = [0x0b, 0x08, 0x0a, 0x00, 0x9e, 0x32, 0x30, 0x36, 0x31, 0, 0, 0, 0x60];
    // the raster demo packed in place, ending where it ends, as Space Beer's files mostly are; a file unpacking to $c000
    // from one that loads below $e000
    const start = demo[0] | (demo[1] << 8), raster = packKrillTinyCrunchInPlace(demo.slice(2), start + demo.length - 2);
    const other = packKrillTinyCrunch(mixed(2000, 5), 0xc000);
    const disk = makeKrillDisk([
      { name: 'TC DEMO', load: 0x0801, bytes: boot },
      { name: 'A', load: raster.load, bytes: raster.bytes },
      { name: 'B', load: 0xe000 - other.length, bytes: other },
    ], { header: 'TINY CRUNCH', id: [0x31, 0x39, 0xa0, 0x32, 0x41] });
    const path = join(__dirname, '../../../fixtures/d64/krill-tc-demo.d64');
    if (process.env.WRITE_FIXTURES) writeFileSync(path, disk);
    expect(new Uint8Array(readFileSync(path))).toEqual(disk);
    const d = readKrillDisk(disk)!;
    expect(d.packer).toBe('tinycrunch');
    expect(d.files.map(f => [krillFileName(f), f.load, f.unpacked?.start ?? null, f.unpacked?.end ?? null, f.unpacked?.inplace ?? null])).toEqual([
      ['file00_0801.prg', 0x0801, null, null, null], ['file01_0801.tc', raster.load, 0x0801, 0x0801 + demo.length - 2, true], ['file02_c000.tc', 0xe000 - other.length, 0xc000, 0xc000 + 2000, false],
    ]);
    expect([...krillFilePrg(d.files[1])]).toEqual(demo);
    // no other reader takes it
    expect(readBitfireDisk(disk)).toBeNull();
    expect(readSpindleDisk(disk)).toBeNull();
    expect(readBoozeDisk(disk)).toBeNull();
    expect(readSparkleDisk(disk)).toBeNull();
  });
});
