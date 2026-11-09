/* Disks of Krill's loader with its ZX0 (c64/krill-disk.ts, spec 13.5k). The files are packed the way the loader's ZX0
 * unpacker reads them, the disks laid out as test/helpers/krill-disk.ts writes them. The reader was also checked against
 * released disks: every file Nightfall's loader unpacked in Sindri is byte for byte what it unpacks (spec 13.5k). */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cc1541Script, cc1541Text, krillDiskPrg, krillFileName, krillFilePrg, krillUnpackedName, makeD64, parseD64, readBitfireDisk, readBoozeDisk, readKrillDisk, readSparkleDisk, readSpindleDisk, unpackDali, unpackKrillZx0 } from '../src';
import { KrillZx0, makeKrillDisk, packKrillInPlace, packKrillZx0, type FakeKrillEntry } from './helpers/krill-disk';

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
