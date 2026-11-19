/* Disks of DLoC's loader (c64/dloc-disk.ts, spec 13.5n). The files are packed with ZX0's first format by the helper's
 * own packer (test/helpers/dloc-disk.ts), and the boot is laid out as Six's self-extracting packer lays it out. The
 * reader was also checked against Halloween 2026 itself (Dark Lords of Chaos, 2026): its three parts unpack to what the
 * loader wrote into memory when Sindri ran the demo, byte for byte, and its boot to what Six's packer unpacked there
 * (all but the 7 bytes the installer changes once it runs). */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  c1541Name, DLOC_BASE, dlocCallText, dlocFileName, dlocFilePrg, dlocScript, dlocScriptText, dlocSummary, dlocUnpackedName, parseD64,
  readBitfireDisk, readBoozeDisk, readCovertDisk, readDlocDisk, readKrillDisk, readSparkleDisk, readSpindleDisk, unpackDlocBoot, unpackDlocFile, unpackZx0,
} from '../src';
import { dlocFile, loadCall, makeDlocDisk, petscii, sfxBoot, sysLine, Zx0, zx0 } from './helpers/dloc-disk';

/** bytes that pack: runs, repeats near and far, and stretches that do not */
const mixed = (n: number, seed: number) => Array.from({ length: n }, (_, i) => {
  const k = i % 700;
  if (k < 120) return (seed + (i >> 5)) & 0xff;
  if (k < 400) return [3, 1, 4, 1, 5, 9, 2, 6][(i + seed) % 8] ^ (k >> 6);
  if (k < 500) return (i * 151 + seed * 7 + (i >> 3) * 31) & 0xff;
  return (k * 3 + seed) & 0xff;
});
const prg = (load: number, bytes: number[]) => [load & 0xff, load >> 8, ...bytes];

/** the demo disk: a boot that installs nothing but loads PART1, PART1 the raster demo (and a load of PART2 after it),
 *  PART2 opening DATA by its name and MUSIC through a table of its own, reading on and unpacking from memory */
function demoDisk(): { disk: Uint8Array; demo: number[] } {
  const demo = [...readFileSync(join(__dirname, '../../../fixtures/prg/raster-demo.prg'))];
  // the boot's image: 2026 SYS 2067, the name at $080e, the load at $0813
  const boot = [...sysLine(0x0813), ...petscii('PART1'), ...loadCall('PART1', 0x080e)];
  // PART1: the raster demo, then (never reached) the load of PART2 and its name
  const end1 = 0x0801 + demo.length - 2;
  const part1 = [...demo.slice(2), ...loadCall('PART2', end1 + 9), ...petscii('PART2')];
  // PART2: open DATA (clc: at its load address), MUSIC through a table, read 8 bytes, unpack a stream in memory
  const at = 0x080e, code = [
    ...loadCall('DATA', 0x0900, DLOC_BASE + 3, false).slice(0, 6), 0x18, 0x20, 0x03, 0xfc,
    0xae, 0x00, 0x0a, 0xac, 0x01, 0x0a, 0xad, 0x02, 0x0a, 0x38, 0x20, 0x03, 0xfc,
    0xa9, 0x08, 0x20, 0x06, 0xfc,
    0xa2, 0x00, 0xa0, 0x0b, 0x20, 0x09, 0xfc,
    0x4c, 0x2f, 0x08,
  ];
  const part2 = [...sysLine(at), ...code];
  while (part2.length < 0x0900 - 0x0801) part2.push(0xea);
  part2.push(...petscii('DATA'));
  while (part2.length < 0x0a00 - 0x0801) part2.push(0);
  part2.push(0x03, 0x0a, 5, ...petscii('MUSIC'));
  while (part2.length < 0x0b00 - 0x0801) part2.push(0);
  part2.push(0x00, 0x40, ...zx0(mixed(300, 9)), ...mixed(1200, 3));
  const disk = makeDlocDisk([
    { name: 'BOOT', data: sfxBoot(boot, 0x0813) },
    { name: 'PART1', data: dlocFile(part1, 0x0801, 0x0810) },
    { name: 'PART2', data: dlocFile(part2, 0x0801, at, 32000) },
    { name: 'DATA', data: prg(0x2000, mixed(600, 4)) },
    { name: 'MUSIC', data: prg(0x1000, mixed(400, 7)) },
  ]);
  return { disk, demo: [...demo, ...part1.slice(demo.length - 2)] };
}

describe('ZX0 as the loader unpacks it', () => {
  it('reads literals, new offsets near and far, repeats, lengths of 256 and more, and the end', () => {
    for (const [data, far] of [[mixed(5000, 1), 4096], [mixed(20000, 2), 32000], [[...new Array(1000).fill(7), ...mixed(300, 3)], 4096], [[1, 2, 3], 4096]] as const) {
      const s = zx0([...data], far), mem = new Uint8Array(0x10000);
      const r = unpackZx0(Uint8Array.from(s), 0, s.length, mem, 0x1000)!;
      expect(r).toEqual({ end: 0x1000 + data.length, read: s.length });
      expect([...mem.subarray(0x1000, r.end)]).toEqual([...data]);
    }
  });

  it('takes a file for $fc00: where it unpacks to, where it starts, a stream that ends with the file', () => {
    const data = mixed(3000, 5), file = Uint8Array.from(dlocFile(data, 0x4000, 0x4010));
    const u = unpackDlocFile(file)!;
    expect(u).toMatchObject({ start: 0x4000, end: 0x4000 + 3000, run: 0x4010 });
    expect([...u.bytes]).toEqual(data);
    // a byte after the end, a start outside, a stream cut short, past $ffff: not one
    expect(unpackDlocFile(Uint8Array.from([...file, 0]))).toBeNull();
    expect(unpackDlocFile(Uint8Array.from(dlocFile(data, 0x4000, 0x3fff)))).toBeNull();
    expect(unpackDlocFile(file.subarray(0, file.length - 1))).toBeNull();
    expect(unpackDlocFile(Uint8Array.from(dlocFile(data, 0xf800, 0xf800)))).toBeNull();
  });

  it('writes the offset as the loader reads it: the high part + 1 as it is, the low 7 bits inverted', () => {
    const w = new Zx0();
    w.literal([0xaa, 0xbb], true);
    w.match(2, 2);
    w.end();
    // the first literal has no type bit: its length 2 is 0 0 1; a 1 for a new offset, its high part + 1 = 1 (a 1), the
    // byte of offset 2 (its low bits inverted: $7e) with length 2; the end: a 1, then 256 (16 bits, then a 1)
    expect(w.out).toEqual([0b00111100, 0xaa, 0xbb, 0xfd, 0x00, 0b00000010]);
    const mem = new Uint8Array(0x10000);
    expect(unpackZx0(Uint8Array.from(w.out), 0, w.out.length, mem, 0x2000)).toEqual({ end: 0x2004, read: w.out.length });
    expect([...mem.subarray(0x2000, 0x2004)]).toEqual([0xaa, 0xbb, 0xaa, 0xbb]);
  });
});

describe("Six's self-extracting boot", () => {
  it('is unpacked as its code does: the stream moved up from $0900, unpacked to $0801, started where its code jumps', () => {
    const image = [...sysLine(0x0813), ...mixed(4000, 6)];
    const b = unpackDlocBoot(Uint8Array.from(sfxBoot(image, 0x0813)))!;
    expect(b).toMatchObject({ start: 0x0801, end: 0x0801 + image.length, run: 0x0813, stream: 0xe000 });
    expect([...b.bytes]).toEqual(image);
    // a BASIC program without that code is not one
    expect(unpackDlocBoot(Uint8Array.from(prg(0x0801, [...sysLine(0x080e), 0x60])))).toBeNull();
  });
});

describe("a disk for DLoC's loader", () => {
  it('reads the files, the calls and the order they load in, from the boot through the parts', () => {
    const { disk, demo } = demoDisk();
    const d = readDlocDisk(disk)!;
    expect(d).toMatchObject({ found: 'files', base: 0xfc00, header: 'DLOC DEMO', id: '26' });
    expect(d.files.map(f => [d.entries[f.entry].name, dlocFileName(f, d), dlocUnpackedName(f, d), !!f.unpacked, !!f.boot, f.basic])).toEqual([
      ['BOOT', 'boot.prg', 'boot_0801.prg', false, true, true],
      ['PART1', 'part1.zx0', 'part1_0801.prg', true, false, false],
      ['PART2', 'part2.zx0', 'part2_0801.prg', true, false, false],
      ['DATA', 'data.prg', 'data.prg', false, false, false],
      ['MUSIC', 'music.prg', 'music.prg', false, false, false],
    ]);
    expect([...dlocFilePrg(d.files[1])]).toEqual(demo);
    expect(d.files[1].unpacked!.run).toBe(0x0810);
    expect(d.calls.map(c => [d.entries[c.in].name, c.routine, c.file, dlocCallText(c, d)])).toEqual([
      ['BOOT', 'load', 1, 'lda #$05 / ldx #<name / ldy #>name / jmp $fc00 ("PART1")'],
      ['PART1', 'load', 2, 'lda #$05 / ldx #<name / ldy #>name / jmp $fc00 ("PART2")'],
      ['PART2', 'open', 3, 'lda #$04 / ldx #<name / ldy #>name / clc / jsr $fc03 ("DATA")'],
      ['PART2', 'open', null, 'sec / jsr $fc03'],
      ['PART2', 'read', null, 'lda #$08 / jsr $fc06'],
      ['PART2', 'unpack', null, 'ldx #$00 / ldy #$0b / jsr $fc09'],
    ]);
    expect(d.names).toEqual([{ in: 2, at: 0x0a03, file: 4 }]);
    expect(d.order).toEqual([0, 1, 2, 3, 4]);
    expect(dlocSummary(d)).toBe('2 files packed with ZX0, 3 load calls read from the code; BOOT → PART1 → PART2 (a part reads DATA, MUSIC)');
    expect(parseD64(disk)).toMatchObject({ name: 'DLOC DEMO', id: '26' });
  });

  it('writes the script: each file in the order they load, its calls, and c1541 writing the disk again', () => {
    const d = readDlocDisk(demoDisk().disk)!;
    const s = dlocScript(d, 'dloc-demo.d64');
    expect(s.command).toBe('c1541 -format "dloc demo,26" d64 dloc-demo.d64 -write boot.prg "boot" -write part1.zx0 "part1" -write part2.zx0 "part2" -write data.prg "data" -write music.prg "music"');
    const text = dlocScriptText(s), h = (v: number) => `$${v.toString(16).padStart(4, '0')}`;
    expect(text[0]).toBe("; DLoC's loader (Six/Dark Lords of Chaos), read by Mimir Studio from dloc-demo.d64: 5 files, 2 of them packed with ZX0.");
    const boot = d.files[0].boot!, p2 = d.files[2];
    expect(boot.end).toBe(0x0801 + 13 + 5 + 9);
    expect(text).toContain(`;   "BOOT"              the boot (LOAD and RUN), packed with Six's packer: unpacks itself to $0801-${h(boot.end - 1)} and starts at $0813`);
    expect(text).toContain(';       $0813: loads "PART1"');
    expect(text).toContain(`;   "PART2"             unpacks to $0801-${h(p2.unpacked!.end - 1)} while it loads (${p2.unpacked!.bytes.length} bytes from ${p2.data.length}), starts at $080e`);
    expect(text).toContain(';       $080e: opens "DATA"');
    expect(text).toContain(';       $0a03: the name "MUSIC" (what it opens)');
    expect(text).toContain(';   "DATA"              not packed: $2000-$2257');
    expect(text[text.length - 1]).toBe(s.command);
    expect(c1541Name(Uint8Array.from([0x48, 0x2d, 0x31, 0xa0]))).toBe('h-1');
    expect(c1541Name(Uint8Array.from([0x48, 0xc1]))).toBeNull();
  });

  it("is found by the loader's code in a file even with one packed file, and not without code or enough packed files", () => {
    const recv = [0xa5, 0x9f, 0x8d, 0x00, 0xdd, 0x20, 0x01, 0xff, 0xea, 0xea, 0xea, 0xad, 0x00, 0xdd, 0xa6, 0x9e, 0x8e, 0x00, 0xdd, 0x29, 0xc0, 0x85, 0x93];
    const one = makeDlocDisk([
      { name: 'LOADER', data: prg(0xc000, [...recv, 0x60]) },
      { name: 'PART', data: dlocFile(mixed(2000, 1), 0x2000, 0x2000) },
      { name: 'PIC', data: prg(0x6000, mixed(800, 2)) },
    ]);
    expect(readDlocDisk(one)).toMatchObject({ found: 'code' });
    expect(readDlocDisk(one)!.files[0].code).toBe(true);
    // without the code: one packed file is not enough, nor two against two of nothing the parts name
    expect(readDlocDisk(makeDlocDisk([{ name: 'PART', data: dlocFile(mixed(2000, 1), 0x2000, 0x2000) }, { name: 'PIC', data: prg(0x6000, mixed(800, 2)) }]))).toBeNull();
    expect(readDlocDisk(makeDlocDisk([
      { name: 'A', data: dlocFile(mixed(900, 1), 0x2000, 0x2000) }, { name: 'B', data: dlocFile(mixed(900, 2), 0x2000, 0x2000) },
      { name: 'C', data: prg(0x6000, mixed(800, 2)) }, { name: 'D', data: prg(0x7000, mixed(800, 3)) },
    ]))).toBeNull();
    // plain programs are no such disk
    expect(readDlocDisk(makeDlocDisk([{ name: 'X', data: prg(0x0801, [...sysLine(0x080e), 0x60]) }, { name: 'Y', data: prg(0x1000, mixed(500, 1)) }]))).toBeNull();
  });
});

describe('the DLoC disk fixture', () => {
  it('is fixtures/d64/dloc-demo.d64, which the e2e tests mount, and no other reader takes it', () => {
    const { disk } = demoDisk();
    const path = join(__dirname, '../../../fixtures/d64/dloc-demo.d64');
    if (process.env.WRITE_FIXTURES) writeFileSync(path, disk);
    expect(new Uint8Array(readFileSync(path))).toEqual(disk);
    expect(readSpindleDisk(disk)).toBeNull();
    expect(readBitfireDisk(disk)).toBeNull();
    expect(readBoozeDisk(disk)).toBeNull();
    expect(readSparkleDisk(disk)).toBeNull();
    expect(readKrillDisk(disk)).toBeNull();
    expect(readCovertDisk(disk)).toBeNull();
  });
});
