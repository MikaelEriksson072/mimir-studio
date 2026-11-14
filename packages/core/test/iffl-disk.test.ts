/* IFFL files (c64/iffl-disk.ts, spec 13.5m): one file with a table of lengths in its first sector and the parts a game
 * loads after it, each a chain of `exomizer level` pieces. The files here are written the way the cracks' are; the
 * reader was also checked on the reference archive (28 disks of 9 releases), where the levels of The Last Ninja unpack
 * to the same bytes at the same addresses from Cryonix's file (Exomizer 3) and Hokuto Force's (Exomizer 2). */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { crunchData } from '@mimir/brokkr';
import { IFFL_ENTRIES, IFFL_TABLE, ifflPartName, ifflPieceName, ifflPiecePrg, makeD64, readIffl, readIfflDisk, readKrillDisk, readCovertDisk, unpackIfflPart } from '../src';

/** `exomizer level`: where the data ends (high byte first), then the stream of the data from its end backwards */
const level = (data: number[], start: number, exo3 = true): number[] => {
  const end = start + data.length;
  return [end >> 8, end & 0xff, ...crunchData(Uint8Array.from([...data].reverse()), { protocol: { flags: exo3 ? 39 : 0 }, effort: 'fast' }).stream];
};
/** an IFFL file: the table of the parts' lengths (low bytes, then high bytes), then the parts */
const iffl = (parts: number[][]): Uint8Array => {
  const out = new Uint8Array(IFFL_TABLE + parts.reduce((a, p) => a + p.length, 0));
  let at = IFFL_TABLE;
  parts.forEach((p, i) => { out[i] = p.length & 0xff; out[IFFL_ENTRIES + i] = p.length >> 8; out.set(p, at); at += p.length; });
  return out;
};
/** bytes that pack: runs, repeats and stretches that do not */
const mixed = (n: number, seed: number) => Array.from({ length: n }, (_, i) => {
  const k = i % 700;
  if (k < 120) return (seed + (i >> 5)) & 0xff;
  if (k < 400) return [3, 1, 4, 1, 5, 9, 2, 6][(i + seed) % 8] ^ (k >> 6);
  if (k < 500) return (i * 151 + seed * 7 + (i >> 3) * 31) & 0xff;
  return (k * 3 + seed) & 0xff;
});
const scores = [...'000500 ABC 000400 DEF 000300 GHI '].map(c => c.charCodeAt(0));

describe('an IFFL part', () => {
  it('is a chain of pieces, each unpacked from its end backwards', () => {
    const a = mixed(3000, 1), b = mixed(700, 9);
    for (const exo3 of [true, false]) {
      const packer = exo3 ? 'exomizer3' : 'exomizer2';
      const one = unpackIfflPart(Uint8Array.from(level(a, 0x5400, exo3)), packer)!;
      expect(one.map(p => [p.start, p.end])).toEqual([[0x5400, 0x5400 + 3000]]);
      expect([...one[0].bytes]).toEqual(a);
      const la = level(a, 0x0800, exo3), lb = level(b, 0xc000, exo3);
      const two = unpackIfflPart(Uint8Array.from([...la, ...lb]), packer)!;
      expect(two.map(p => [p.start, p.end, p.at, p.packed])).toEqual([[0x0800, 0x0800 + 3000, 0, la.length], [0xc000, 0xc000 + 700, la.length, lb.length]]);
      expect([...two[1].bytes]).toEqual(b);
      // the other Exomizer's stream is not read, nor a part with bytes after its last piece, nor one cut short
      expect(unpackIfflPart(Uint8Array.from(la), exo3 ? 'exomizer2' : 'exomizer3')).toBeNull();
      expect(unpackIfflPart(Uint8Array.from([...la, 1, 2, 3]), packer)).toBeNull();
      expect(unpackIfflPart(Uint8Array.from(la.slice(0, -3)), packer)).toBeNull();
    }
  });
  it('cannot be longer than the memory below its end', () => {
    const data = mixed(3000, 4), l = level(data, 0x0800);
    // the same stream said to end at $0400: 3000 bytes do not fit below it
    expect(unpackIfflPart(Uint8Array.from([0x04, 0x00, ...l.slice(2)]), 'exomizer3')).toBeNull();
    expect(unpackIfflPart(Uint8Array.from(scores), 'exomizer3')).toBeNull();
  });
});

describe('an IFFL file', () => {
  it('is a table of lengths that end where the file ends', () => {
    const parts = [level(mixed(2000, 1), 0x4000), level(mixed(900, 2), 0x0800), scores];
    const file = iffl(parts), r = readIffl(file)!;
    expect(r.packer).toBe('exomizer3');
    expect(r.parts.map(p => [p.n, p.offset, p.bytes.length, p.pieces?.length ?? null])).toEqual([[0, 254, parts[0].length, 1], [1, 254 + parts[0].length, parts[1].length, 1], [2, 254 + parts[0].length + parts[1].length, scores.length, null]]);
    // a byte more or less than the table says, a gap in the table, one part only: no IFFL file
    expect(readIffl(Uint8Array.from([...file, 0]))).toBeNull();
    expect(readIffl(file.subarray(0, file.length - 1))).toBeNull();
    const gap = file.slice(); gap[4] = gap[2]; gap[IFFL_ENTRIES + 4] = gap[IFFL_ENTRIES + 2]; gap[2] = gap[IFFL_ENTRIES + 2] = 0;
    expect(readIffl(gap)).toBeNull();
    expect(readIffl(iffl([parts[0]]))).toBeNull();
    expect(readIffl(new Uint8Array(254))).toBeNull();
    // a program is none
    expect(readIffl(new Uint8Array(readFileSync(join(__dirname, '../../../fixtures/prg/raster-demo.prg'))))).toBeNull();
  });
  it("takes the Exomizer that reads more of its parts, and none when no part unpacks", () => {
    const e2 = readIffl(iffl([level(mixed(2000, 1), 0x4000, false), level(mixed(900, 2), 0x0800, false), scores]))!;
    expect(e2.packer).toBe('exomizer2');
    expect(e2.parts.map(p => !!p.pieces)).toEqual([true, true, false]);
    const none = readIffl(iffl([scores, scores, mixed(300, 3)]))!;
    expect(none.packer).toBeNull();
    expect(none.parts.every(p => !p.pieces)).toBe(true);
  });
});

describe('the IFFL disk fixture', () => {
  it('is fixtures/d64/iffl-demo.d64, which the e2e tests mount: a boot program and an IFFL file of three parts', () => {
    const demo = [...readFileSync(join(__dirname, '../../../fixtures/prg/raster-demo.prg'))];
    const boot = [0x01, 0x08, 0x0b, 0x08, 0x0a, 0x00, 0x9e, 0x32, 0x30, 0x36, 0x31, 0, 0, 0, 0x60];
    const start = demo[0] | (demo[1] << 8);
    // the raster demo as one piece; a part of two pieces; a high score table that is not packed
    const parts = [level(demo.slice(2), start), [...level(mixed(2000, 5), 0xc000), ...level(mixed(600, 7), 0x2000)], scores];
    const disk = makeD64({ name: 'IFFL DEMO', id: '24', files: [{ name: 'IFFL DEMO', data: Uint8Array.from(boot) }, { name: 'IFFLDATA', data: iffl(parts) }] });
    const path = join(__dirname, '../../../fixtures/d64/iffl-demo.d64');
    if (process.env.WRITE_FIXTURES) writeFileSync(path, disk);
    expect(new Uint8Array(readFileSync(path))).toEqual(disk);
    const d = readIfflDisk(disk)!;
    expect(d.files.map(f => [f.entry, f.name, f.packer, f.parts.length])).toEqual([[1, 'IFFLDATA', 'exomizer3', 3]]);
    const f = d.files[0];
    expect(f.parts.map(p => ifflPartName(f, p))).toEqual(['iffl01_part00.exo', 'iffl01_part01.exo', 'iffl01_part02.bin']);
    expect(f.parts.flatMap(p => (p.pieces ?? []).map(x => ifflPieceName(f, p, x)))).toEqual(['iffl01_part00_0801.prg', 'iffl01_part01_c000.prg', 'iffl01_part01_2000.prg']);
    expect([...ifflPiecePrg(f.parts[0].pieces![0])]).toEqual(demo);
    expect([...f.parts[2].bytes]).toEqual(scores);
    // the loaders' readers do not take it
    expect(readKrillDisk(disk)).toBeNull();
    expect(readCovertDisk(disk)).toBeNull();
  });
  it('finds no IFFL file on the other fixtures', () => {
    for (const name of ['krill-demo.d64', 'krill-tc-demo.d64']) expect(readIfflDisk(new Uint8Array(readFileSync(join(__dirname, '../../../fixtures/d64', name))))).toBeNull();
  });
});
