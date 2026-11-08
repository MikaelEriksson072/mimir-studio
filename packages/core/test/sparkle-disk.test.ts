/* Sparkle disks (c64/sparkle-disk.ts, spec 13.5i). The disks are built the way Sparkle lays its disks out, the blocks
 * packed the way each kind of its block unpacker reads them (test/helpers/sparkle-disk.ts). The reader was also checked
 * against released Sparkle disks: every write of the loader running in Sindri, and every bundle against the disk's own
 * unpacker run on Sindri's 6502 (spec 13.5i). */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeD64, parseD64, readBitfireDisk, readBoozeDisk, readSparkleDisk, readSpindleDisk, sectorsOnTrack, sparkleBlockOrder, sparkleChunkName, sparkleChunkPrg, sparkleCount, sparkleScript } from '../src';
import { makeSparkleDisk, packSparkle, sparkleCode, type FakeBundle } from './helpers/sparkle-disk';

const offset = (t: number, s: number) => { let n = 0; for (let k = 1; k < t; k++) n += sectorsOnTrack(k); return (n + s) * 256; };

/** bytes that pack: runs, repeats near and far, and stretches that do not */
const mixed = (n: number, seed: number) => Array.from({ length: n }, (_, i) => {
  const k = i % 700;
  if (k < 120) return (seed + (i >> 5)) & 0xff; // runs
  if (k < 400) return [3, 1, 4, 1, 5, 9, 2, 6][(i + seed) % 8] ^ (k >> 6); // short repeats
  if (k < 500) return (i * 151 + seed * 7 + (i >> 3) * 31) & 0xff; // little to copy
  return (k * 3 + seed) & 0xff; // repeats from far
});

/** bytes that repeat from further than 256 bytes above, in a block (the 84 items' far copies): a run, a pattern, a
 *  longer run and the pattern again */
const far = (seed: number) => {
  const pattern = Array.from({ length: 40 }, (_, i) => (i * 29 + seed) & 0xff);
  return [...pattern, ...Array(700).fill(seed & 0xff), ...pattern, ...Array(300).fill(1), ...pattern];
};

const BUNDLES: FakeBundle[] = [
  [{ start: 0x2000, bytes: mixed(5000, 1) }, { start: 0x8000, bytes: Array.from({ length: 300 }, (_, i) => (i * 97 + 13) & 0xff) }],
  [{ start: 0xd000, bytes: mixed(600, 2), io: true }, { start: 0xd800, bytes: Array.from({ length: 1000 }, (_, i) => i & 15) }],
  [{ start: 0x0400, bytes: [1, 2, 3, 4, 5] }],
  [{ start: 0x4000, bytes: mixed(3000, 3) }],
  [{ start: 0x0500, bytes: [9, 8, 7] }],
];

describe('Sparkle disks', () => {
  it('read every bundle: its chunks, unpacked from their highest byte down, byte for byte', () => {
    const disk = makeSparkleDisk(BUNDLES, { start: 0x2000, side: 1, next: 2 });
    const d = readSparkleDisk(disk)!;
    expect(d).not.toBeNull();
    expect(d.bundles.map(b => b.chunks.map(c => [c.start, c.end, c.io]))).toEqual([
      [[0x2000, 0x2000 + 5000, false], [0x8000, 0x8000 + 300, false]],
      [[0xd000, 0xd000 + 600, true], [0xd800, 0xd800 + 1000, false]],
      [[0x0400, 0x0405, false]],
      [[0x4000, 0x4000 + 3000, false]],
      [[0x0500, 0x0503, false]],
    ]);
    BUNDLES.forEach((b, n) => b.forEach((seg, k) => expect([...d.bundles[n].chunks[k].bytes], `bundle ${n} chunk ${k}`).toEqual(seg.bytes)));
    expect(d.bundles.every(b => b.missing === 0)).toBe(true);
    expect(d).toMatchObject({ items: 'f8', counts: 'bits', complete: true, start: 0x2000, il: [4, 3, 3, 3], zp: 2, side: 1, next: 2, indexed: true, api: { next: 0x1f9, send: 0x160 }, boot: 'SPARKLE DEMO', header: 'SPARKLE DEMO', tracks: 35 });
    // the blocks: as many as the packer wrote, the first bundle from 1/0, a small one inside the block before it
    const packed = packSparkle(BUNDLES);
    expect(d.blocks).toBe(packed.blocks.length);
    expect(d.bundles.reduce((n, b) => n + b.blocks, 0)).toBe(packed.blocks.length);
    expect(d.bundles[0]).toMatchObject({ track: 1, sector: 0 });
    expect(d.bundles[2].blocks).toBe(0);
  });

  it('use every kind of item: literals of a nibble and of a byte, the three matches, new addresses', () => {
    const { blocks } = packSparkle(BUNDLES);
    // the packer's items show in the blocks: $f8 n (long matches), $fc (a new address)
    const all = blocks.flatMap(b => [...b]);
    expect(all.filter(v => v === 0xf8).length).toBeGreaterThan(5);
    expect(all.includes(0xfc)).toBe(true);
  });

  it('read All Hallows Eve\'s kind: $84 and $04 long copies, copies from up to 64K above, $80 a new address, EOR counts', () => {
    const bundles: FakeBundle[] = [...BUNDLES, [{ start: 0x6000, bytes: far(7) }, { start: 0x9000, bytes: far(9) }]];
    const disk = makeSparkleDisk(bundles, { items: '84', start: 0x0100, side: 2, next: 3 });
    const d = readSparkleDisk(disk)!;
    expect(d).toMatchObject({ items: '84', counts: 'eor', complete: true, start: 0x0100, zp: 2, side: 2, next: 3, indexed: false, api: { next: 0x200, send: 0x160 } });
    expect(d.bundles.length).toBe(bundles.length);
    bundles.forEach((b, n) => b.forEach((seg, k) => {
      const c = d.bundles[n].chunks[k];
      expect([c.start, c.end, c.io], `bundle ${n} chunk ${k}`).toEqual([seg.start, seg.start + seg.bytes.length, !!seg.io]);
      expect([...c.bytes], `bundle ${n} chunk ${k}`).toEqual(seg.bytes);
    }));
    // its items: far copies (no bit 7: 0LLLLL00 h o, $04 h n o), near long ones ($84 n o), new addresses ($80)
    const all = packSparkle(bundles, '84', 'eor').blocks.flatMap(b => [...b]);
    expect(all.filter(v => v === 0x84).length).toBeGreaterThan(5);
    expect(all.includes(0x80)).toBe(true);
    // All Hallows Eve's counts: 21 and 15 blocks, the end of the side; a count is its own code
    expect([0x63, 0x70, 0x7f].map(b => sparkleCount(b, 'eor'))).toEqual([21, 15, 0]);
    for (let n = 0; n < 256; n++) expect(sparkleCount(sparkleCode(n, 'eor'), 'eor')).toBe(n);
  });

  it('read the old kind: 8 bits in a block\'s first byte, a bundle going on with the bits before it, counts as they are', () => {
    const disk = makeSparkleDisk(BUNDLES, { items: 'old', start: 0x0f00 });
    const d = readSparkleDisk(disk)!;
    expect(d).toMatchObject({ items: 'old', counts: 'raw', complete: true, start: 0x0f00, zp: 0xf0, side: null, next: null, api: { next: 0x180, send: null } });
    BUNDLES.forEach((b, n) => b.forEach((seg, k) => expect([...d.bundles[n].chunks[k].bytes], `bundle ${n} chunk ${k}`).toEqual(seg.bytes)));
    // the old sides end with a last count of 1, the block after it empty or a file of the directory (5 Shades of
    // Grey): the side ends there; a larger count there, a side that does not unpack to its end
    const { ends } = packSparkle(BUNDLES, 'old', 'raw');
    const order = sparkleBlockOrder(35, [4, 3, 3, 3]), lastEnd = ends[ends.length - 1];
    const [t, s] = order[lastEnd], [t2, s2] = order[lastEnd + 1];
    for (const [count, complete] of [[1, true], [2, false]] as const) {
      const end = disk.slice();
      end[offset(t, s) + 1] = count;
      end.set(Array.from({ length: 256 }, (_, i) => (i * 37 + 5) & 0xff), offset(t2, s2));
      const c = readSparkleDisk(end)!;
      expect(c.complete, `count ${count}`).toBe(complete);
      expect(c.bundles.map(x => x.chunks.map(y => y.start))).toEqual(d.bundles.map(x => x.chunks.map(y => y.start)));
    }
  });

  it('walk the sectors the way the drive does: Memento Mori\'s first tracks', () => {
    // read from Genesis Project's Memento Mori (2020), IL0-IL3 5, 4, 3, 3: the blocks the drive sent, track by track
    const order = sparkleBlockOrder(35, [5, 4, 3, 3]);
    const track = (t: number) => order.filter(([u]) => u === t).map(([, s]) => s);
    expect(track(1)).toEqual([0, 5, 10, 15, 20, 3, 8, 13, 18, 1, 6, 11, 16, 2, 7, 12, 17, 4, 9, 14, 19]);
    expect(track(2)).toEqual([2, 7, 12, 17, 0, 5, 10, 15, 20, 3, 8, 13, 18, 1, 6, 11, 16, 4, 9, 14, 19]);
    // its second bundle: the last five of track 5, then the first five of track 6
    expect(track(5).slice(16)).toEqual([16, 4, 9, 14, 19]);
    expect(track(6).slice(0, 5)).toEqual([2, 7, 12, 17, 0]);
    // every sector of tracks 1-35 once, none of track 18; two on over track 18
    expect(order.length).toBe(683 - 19);
    expect(new Set(order.map(([t, s]) => `${t}/${s}`)).size).toBe(order.length);
    expect(order.some(([t]) => t === 18)).toBe(false);
    // where the walk starts on a track, as Memento Mori's directory has it: on from the track before, two on over 18
    expect([5, 6, 7, 9, 10, 14, 15, 22, 23, 28, 30, 33].map(t => track(t)[0])).toEqual([2, 2, 2, 2, 2, 2, 2, 4, 4, 10, 14, 16]);
  });

  it('read the drive\'s counts: bit i in bit 3, 1, 2, 0, 7, 5, 6, 4, inverted', () => {
    // Memento Mori: the first block (99 more), bundles of 10, 29 and 49 blocks, the end of the side, sides 1-3
    expect([0x95, 0xfc, 0x72, 0x57, 0xff, 0xf7, 0xfd, 0xf5].map(b => sparkleCount(b))).toEqual([99, 10, 29, 49, 0, 1, 2, 3]);
    for (let n = 0; n < 256; n++) expect(sparkleCount(sparkleCode(n))).toBe(n);
  });

  it('read the bundles without the directory or the boot program, and say what is missing', () => {
    const noDir = readSparkleDisk(makeSparkleDisk(BUNDLES, { dir: false }))!;
    expect(noDir.bundles.length).toBe(5);
    expect(noDir.indexed).toBe(false);
    const noBoot = readSparkleDisk(makeSparkleDisk(BUNDLES, { boot: false }))!;
    expect(noBoot).toMatchObject({ start: null, zp: null, api: null, boot: null, indexed: true });
    expect(noBoot.bundles.length).toBe(5);
    // another interleave: the reader takes it from the drive's zero page
    expect(readSparkleDisk(makeSparkleDisk(BUNDLES, { il: [8, 6, 6, 3] }))!.il).toEqual([8, 6, 6, 3]);
  });

  it('write the loader script the way Sparkle reads it', () => {
    const d = readSparkleDisk(makeSparkleDisk(BUNDLES, { start: 0x2000, side: 1, next: 2 }))!;
    const s = sparkleScript(d, 'demo.d64');
    expect(s[0]).toBe('# Sparkle loader script, rebuilt by Mimir Studio from demo.d64 (Sparkle): 5 bundles, 7 files.');
    expect(s.slice(2, 13)).toEqual(['# This is side 1; the loader goes on with side 2.', 'Path:\t"demo.d64"', 'Header:\tSPARKLE DEMO', 'ID:\tSP 2A', 'Name:\tSPARKLE DEMO',
      'Start:\t2000', 'IL0:\t4', 'IL1:\t3', 'IL2:\t3', 'IL3:\t3', 'ZP:\t02']);
    // a paragraph per bundle, after an empty line; a note of its own before each File line
    const files = s.filter(l => l.startsWith('File:'));
    expect(files).toEqual(['File:\t"bundle00_2000.prg"', 'File:\t"bundle00_8000.prg"', 'File:\t"bundle01_d000.prg*"', 'File:\t"bundle01_d800.prg"', 'File:\t"bundle02_0400.prg"', 'File:\t"bundle03_4000.prg"', 'File:\t"bundle04_0500.prg"']);
    expect(s.filter(l => l === '').length).toBe(5);
    expect(s).toContain('#   $d000-$d257, 600 bytes, under the I/O area');
    expect(sparkleChunkName(d.bundles[1], d.bundles[1].chunks[0])).toBe('bundle01_d000.prg');
    expect([...sparkleChunkPrg(d.bundles[2].chunks[0])]).toEqual([0x00, 0x04, 1, 2, 3, 4, 5]);
  });

  it('find none on other disks', () => {
    expect(readSparkleDisk(makeD64({ name: 'PLAIN', files: [{ name: 'A', data: Uint8Array.from([0x01, 0x08, 0x60]) }] }))).toBeNull();
    for (const name of ['bitfire-demo.d64', 'spindle-demo.d64', 'booze-demo.d64', 'mimir-demo.d64', 'kernal-load.d64', 'pirateslayer-demo.d64']) {
      const img = new Uint8Array(readFileSync(join(__dirname, '../../../fixtures/d64', name)));
      expect(readSparkleDisk(img), name).toBeNull();
    }
    expect(readSparkleDisk(new Uint8Array(1000))).toBeNull();
    // a block that does not unpack: the first block's header points nowhere, its items run off the block
    const broken = makeSparkleDisk(BUNDLES);
    broken.fill(0x55, offset(1, 0) + 2, offset(1, 0) + 256);
    expect(readSparkleDisk(broken)).toBeNull();
  });
});

describe('the Sparkle disk fixture', () => {
  it('is fixtures/d64/sparkle-demo.d64, which the e2e tests mount: the raster demo, a bundle under the I/O area, a small one', () => {
    const demo = [...readFileSync(join(__dirname, '../../../fixtures/prg/raster-demo.prg'))];
    const bundles: FakeBundle[] = [
      [{ start: demo[0] | (demo[1] << 8), bytes: demo.slice(2) }],
      [{ start: 0x3000, bytes: mixed(1200, 5) }, { start: 0xd000, bytes: mixed(500, 6), io: true }],
      [{ start: 0x0400, bytes: Array.from({ length: 40 }, (_, i) => 0x41 + (i % 26)) }],
    ];
    const disk = makeSparkleDisk(bundles, { start: 0x0810, side: 1 });
    const path = join(__dirname, '../../../fixtures/d64/sparkle-demo.d64');
    if (process.env.WRITE_FIXTURES) writeFileSync(path, disk);
    expect(new Uint8Array(readFileSync(path))).toEqual(disk);
    const d = readSparkleDisk(disk)!;
    expect(d.bundles.map(b => b.chunks.map(c => [c.start, c.end]))).toEqual([[[0x0801, 0x0801 + demo.length - 2]], [[0x3000, 0x34b0], [0xd000, 0xd1f4]], [[0x0400, 0x0428]]]);
    expect([...d.bundles[0].chunks[0].bytes]).toEqual(demo.slice(2));
    expect(parseD64(disk)).toMatchObject({ name: 'SPARKLE DEMO', files: [expect.objectContaining({ name: 'SPARKLE DEMO', type: 'PRG', track: 18, sector: 7 })] });
    // no other reader takes it
    expect(readBitfireDisk(disk)).toBeNull();
    expect(readSpindleDisk(disk)).toBeNull();
    expect(readBoozeDisk(disk)).toBeNull();
  });
});
