/* BoozeLoader disks (c64/booze-disk.ts, spec 13.5d). The disks are built the way BoozeLoader's disks are, and the
 * packed files the way ByteBoozer 1 and 2 write them (test/helpers/booze-disk.ts). The reader was also checked against
 * released BoozeLoader disks, Edge of Disgrace (2008) to Codeboys & Endians (2025): spec 13.5d. */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { boozeFileList, boozeFileName, makeD64, parseD64, readBitfireDisk, readBoozeDisk, readSpindleDisk, sectorsOnTrack, unpackByteBoozer1, unpackByteBoozer2, type BoozeCruncher } from '../src';
import { BOOZE_BOOT, boozeStream, expand, makeBoozeDisk, packBooze, packInPlace, type Step } from './helpers/booze-disk';
import { fromSource } from './helpers/programs';

const offset = (t: number, s: number) => { let n = 0; for (let k = 1; k < t; k++) n += sectorsOnTrack(k); return (n + s) * 256; };

/** 16 literals of 255 (a type bit after each) and one of 3, then matches of 2 and longer with each offset width of
 *  either packer (and the longest match, 255), a literal before the end */
const steps = (kind: BoozeCruncher): Step[] => [
  ...Array.from({ length: 16 }, (_, k): Step => [Array.from({ length: 255 }, (_, i) => (i * 7 + k * 13 + 3) & 0xff)]), [[9, 8, 7]],
  [2, 5], [255, 40], [2, 60], [3, 200], [2, 250], [4, 900], [2, kind === 'b2' ? 1000 : 1300], [5, 4000], [6, 15], [3, 100],
  [[0x41, 0x42]],
];

describe('ByteBoozer 2', () => {
  it('unpacks literals and matches of every offset width, and ends', () => {
    const s = steps('b2'), packed = boozeStream('b2', 0x1000, s), plain = expand(s);
    const u = unpackByteBoozer2(Uint8Array.from(packed), 0x8000);
    expect(u).toMatchObject({ start: 0x1000, end: 0x1000 + plain.length });
    expect([...u!.bytes]).toEqual(plain);
    // a byte its packer left after the end is allowed (it started a byte of bits it did not need), two are not
    expect(unpackByteBoozer2(Uint8Array.from([...packed, 0]), 0x8000)).not.toBeNull();
    expect(unpackByteBoozer2(Uint8Array.from([...packed, 0, 0]), 0x8000)).toBeNull();
  });

  it('unpacks in place: the packed bytes at the end of where it unpacks to', () => {
    const plain = [...Array.from({ length: 600 }, (_, i) => (i % 37) * 3), ...Array.from({ length: 200 }, (_, i) => (i * 13) & 0xff)];
    const { load, bytes } = packInPlace('b2', plain, 0x2b20);
    expect(load + bytes.length - 0x2b20).toBeLessThan(8);
    const u = unpackByteBoozer2(Uint8Array.from(bytes), load);
    expect(u).toMatchObject({ start: 0x2b20 - plain.length, end: 0x2b20 });
  });

  it('is no packed file for other bytes', () => {
    expect(unpackByteBoozer2(new TextEncoder().encode('MIMIR STUDIO READS BOOZELOADER DISKS'), 0x2000)).toBeNull();
    expect(unpackByteBoozer2(Uint8Array.from([0x00, 0x10]), 0x2000)).toBeNull();
  });
});

describe('ByteBoozer 1', () => {
  it('unpacks literals and matches with every offset prefix, its first bits in the header byte or not', () => {
    const s = steps('b1'), plain = expand(s);
    for (const head of [0, 7]) {
      const packed = boozeStream('b1', 0x1000, s, head);
      const u = unpackByteBoozer1(Uint8Array.from(packed), 0x8000);
      expect(u).toMatchObject({ start: 0x1000, end: 0x1000 + plain.length });
      expect([...u!.bytes]).toEqual(plain);
      // it is not ByteBoozer 2
      expect(unpackByteBoozer2(Uint8Array.from(packed), 0x8000)?.bytes ?? null).not.toEqual(Uint8Array.from(plain));
    }
  });

  it('is no packed file for other bytes', () => {
    expect(unpackByteBoozer1(new TextEncoder().encode('MIMIR STUDIO READS BOOZELOADER DISKS'), 0x2000)).toBeNull();
  });
});

/** files of a disk: one packed for $1000 loaded elsewhere, one not packed, one packed in place ending at $5000 */
function files(kind: BoozeCruncher) {
  const a = Array.from({ length: 1500 }, (_, i) => ((i >> 3) * 5 + (i % 3)) & 0xff), b = Array.from({ length: 256 }, (_, i) => (i * 97 + 11) & 0xff);
  const c = [...Array.from({ length: 900 }, (_, i) => (i % 21) + 0x40), ...Array.from({ length: 100 }, (_, i) => (i * 31) & 0xff)];
  return { plain: [a, b, c], disk: [{ load: 0x9000, bytes: packBooze(kind, a, 0x1000) }, { load: 0x4000, bytes: b }, packInPlace(kind, c, 0x5000)] };
}

describe('BoozeLoader disks', () => {
  it('reads the file table in 18/9, the side and the files, and unpacks them with ByteBoozer 2', () => {
    const f = files('b2'), d = readBoozeDisk(makeBoozeDisk(f.disk, { side: 1 }))!;
    expect(d).toMatchObject({ table: 9, side: 1, driveCode: true, cruncher: 'b2', header: 'BOOZE DEMO', boot: 'BOOT' });
    expect(d.files.map(x => [x.n, x.load, x.unpacked && x.unpacked.start, x.unpacked && x.unpacked.end])).toEqual([
      [0, 0x9000, 0x1000, 0x1000 + 1500], [1, 0x4000, null, null], [2, f.disk[2].load, 0x5000 - 1000, 0x5000],
    ]);
    expect([...d.files[0].unpacked!.bytes]).toEqual(f.plain[0]);
    expect([...d.files[1].bytes]).toEqual(f.plain[1]);
    expect([...d.files[2].unpacked!.bytes]).toEqual(f.plain[2]);
    // the chain: from track 3, every 4th sector
    expect(d.files.map(x => [x.track, x.sector])).toEqual([[3, 0], [3, 16], [3, 1]]);
    expect(d.files[0].sectors).toBe(Math.ceil((f.disk[0].bytes.length + 2) / 254));
    expect(boozeFileName(d.files[0])).toBe('file00_1000.prg');
    expect(boozeFileName(d.files[1])).toBe('file01_4000.prg');
  });

  it('reads a table in 18/6 (Edge of Disgrace) and ByteBoozer 1, and a second side without the drive code', () => {
    const f = files('b1');
    const d = readBoozeDisk(makeBoozeDisk(f.disk, { side: 2, table: 6 }))!;
    expect(d).toMatchObject({ table: 6, side: 2, cruncher: 'b1' });
    expect(d.files.map(x => x.unpacked && [...x.unpacked.bytes])).toEqual([f.plain[0], null, f.plain[2]]);
    // without the drive code: the table is looked for in 18/9 and 18/6, and its files must unpack
    const b2 = files('b2');
    expect(readBoozeDisk(makeBoozeDisk(b2.disk, { side: 2, driveCode: false }))).toMatchObject({ table: 9, side: 2, driveCode: false, cruncher: 'b2' });
    expect(readBoozeDisk(makeBoozeDisk([b2.disk[1], b2.disk[1]], { side: 2, driveCode: false }))).toBeNull();
  });

  it('finds the files of a disk without a table by the chains the BAM holds, and one with an empty table has none', () => {
    const f = files('b1'), d = readBoozeDisk(makeBoozeDisk(f.disk, { table: null }))!;
    expect(d).toMatchObject({ table: null, side: null, cruncher: 'b1' });
    // (in the order of their first sectors)
    expect(d.files.map(x => [x.n, x.track, x.sector, !!x.unpacked])).toEqual([[null, 3, 0, true], [null, 3, 1, true], [null, 3, 16, false]]);
    expect(boozeFileName(d.files[0])).toBe('t3s0_1000.prg');
    expect(readBoozeDisk(makeBoozeDisk([], { side: 0 }))).toMatchObject({ table: 9, side: 0, files: [] });
  });

  it('lists the files as text', () => {
    const d = readBoozeDisk(makeBoozeDisk(files('b2').disk, { side: 1 }))!;
    const text = boozeFileList(d, 'demo.d64');
    expect(text[0]).toBe('; BoozeLoader files of demo.d64, read by Mimir Studio: 3 files on side 1, packed with ByteBoozer 2.');
    expect(text[1]).toBe('; The program loads a file by its number (lda #n / jsr loader); the table in 18/9 gives its first sector.');
    expect(text[3]).toMatch(/^file00_1000\.prg +; 3\/0, \d+ sectors, loads at \$9000-\$[0-9a-f]{4}, unpacks to \$1000-\$15db \(1500 bytes\)$/);
    expect(text[4]).toBe('file01_4000.prg    ; 3/16, 2 sectors, loads at $4000-$40ff, not packed');
  });

  it('is no BoozeLoader disk for other disks', () => {
    expect(readBoozeDisk(makeD64({ name: 'PLAIN', files: [{ name: 'A', data: Uint8Array.from([0x01, 0x08, 0x60]) }] }))).toBeNull();
    for (const name of ['bitfire-demo.d64', 'spindle-demo.d64', 'mimir-demo.d64', 'kernal-load.d64', 'krill-demo.d64']) {
      const img = new Uint8Array(readFileSync(join(__dirname, '../../../fixtures/d64', name)));
      expect(readBoozeDisk(img), name).toBeNull();
    }
    // the drive code without a valid table: a broken chain
    const broken = makeBoozeDisk(files('b2').disk, { side: 1 });
    broken.set([40, 0], offset(18, 9));
    expect(readBoozeDisk(broken)).toBeNull();
    expect(readBoozeDisk(new Uint8Array(1000))).toBeNull();
  });
});

describe('the BoozeLoader disk fixture', () => {
  it('is fixtures/d64/booze-demo.d64, which the e2e tests mount: a boot program with a script, the raster demo packed, a table, and a file packed in place', () => {
    const demo = [...readFileSync(join(__dirname, '../../../fixtures/prg/raster-demo.prg'))];
    const f = files('b2');
    const boot = fromSource('boot.prg', BOOZE_BOOT);
    const prg = Uint8Array.from([boot.load & 0xff, boot.load >> 8, ...boot.bytes]);
    const disk = makeBoozeDisk([{ load: 0x8000, bytes: packBooze('b2', demo.slice(2), demo[0] | (demo[1] << 8)) }, f.disk[1], f.disk[2]], { side: 1, boot: prg });
    const path = join(__dirname, '../../../fixtures/d64/booze-demo.d64');
    if (process.env.WRITE_FIXTURES) writeFileSync(path, disk);
    expect(new Uint8Array(readFileSync(path))).toEqual(disk);
    const d = readBoozeDisk(disk)!;
    expect(d.files.map(x => x.unpacked && [x.unpacked.start, x.unpacked.end])).toEqual([[0x0801, 0x0801 + demo.length - 2], null, [0x5000 - 1000, 0x5000]]);
    expect([...d.files[0].unpacked!.bytes]).toEqual(demo.slice(2));
    expect(parseD64(disk)).toMatchObject({ name: 'BOOZE DEMO', files: [expect.objectContaining({ name: 'BOOT', type: 'PRG' })] });
    // no other reader takes it
    expect(readBitfireDisk(disk)).toBeNull();
    expect(readSpindleDisk(disk)).toBeNull();
  });
});
