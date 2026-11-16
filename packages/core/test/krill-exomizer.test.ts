/* Krill's loader built with Exomizer, loading files by track and sector (c64/krill-disk.ts, analyze/krill.ts, spec
 * 13.5k): files of `exomizer mem -f` (a load address, where the file unpacks to, a stream unpacked forwards while it
 * loads), the loader's calls in the files' code (ldx #track / ldy #sector / jsr, a table of tracks and sectors, a raw
 * load to an address with the carry set), chains of sectors outside the directory that those calls load, and the
 * program's own calls read back as its script, as Triad's Continuum (2014) has them. The reader was checked on that
 * disk: every one of its 26 packed files is byte for byte what the demo's own resident unpacker makes of it (run on
 * Sindri's Cpu), and all 27 loads Sindri ran from its disk, in the whole demo, are what the reader has (spec 13.5k). */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  analyze, cc1541Script, krillCallText, krillFileName, krillFilePrg, krillLoads, krillPackerName, krillScriptText, parseD64,
  readBitfireDisk, readBoozeDisk, readCovertDisk, readKrillDisk, readSparkleDisk, readSpindleDisk, unpackKrillExomizer, type ProjectInput,
} from '../src';
import { hideKrillEntry, makeKrillDisk, packKrillExomizer, packKrillExomizerInPlace, type FakeKrillEntry } from './helpers/krill-disk';
import { fromSource } from './helpers/programs';

/** bytes that pack: runs, repeats near and far, and stretches that do not */
const mixed = (n: number, seed: number) => Array.from({ length: n }, (_, i) => {
  const k = i % 700;
  if (k < 120) return (seed + (i >> 5)) & 0xff;
  if (k < 400) return [3, 1, 4, 1, 5, 9, 2, 6][(i + seed) % 8] ^ (k >> 6);
  if (k < 500) return (i * 151 + seed * 7 + (i >> 3) * 31) & 0xff;
  return (k * 3 + seed) & 0xff;
});

const BOOT = [0x0b, 0x08, 0x0a, 0x00, 0x9e, 0x32, 0x30, 0x36, 0x31, 0, 0, 0, 0x60];

describe("Krill's loader's Exomizer (exomizer mem -f)", () => {
  it('unpacks forwards to where the stream says, from a file loaded elsewhere', () => {
    const data = mixed(3000, 1), p = packKrillExomizer(data, 0x4000);
    const u = unpackKrillExomizer(Uint8Array.from(p.bytes), 0x9000)!;
    expect(u).toMatchObject({ start: 0x4000, end: 0x4000 + 3000, inplace: false, packer: 'exomizer', protocol: 0 });
    expect([...u.bytes]).toEqual(data);
  });

  it('unpacks in place when the stream ends far enough after the data, and not when writing would reach it', () => {
    const data = mixed(3000, 2), p = packKrillExomizerInPlace(data, 0x2000);
    expect(p.safety).toBeGreaterThan(0);
    const u = unpackKrillExomizer(Uint8Array.from(p.bytes), p.load)!;
    expect(u).toMatchObject({ start: 0x2000, end: 0x2000 + 3000, inplace: true });
    expect([...u.bytes]).toEqual(data);
    // a byte nearer: the unpacking would write over a byte of its stream before it is read
    const short = packKrillExomizerInPlace(data, 0x2000, 0, 1);
    expect(unpackKrillExomizer(Uint8Array.from(short.bytes), short.load)).toBeNull();
  });

  it('reads the protocol it is given (Exomizer 3: 7 and 39), and is no file for other bytes', () => {
    const data = mixed(2000, 3);
    for (const protocol of [7, 39]) {
      const p = packKrillExomizer(data, 0x3000, protocol);
      expect([...unpackKrillExomizer(Uint8Array.from(p.bytes), 0xa000, protocol)!.bytes]).toEqual(data);
    }
    expect(unpackKrillExomizer(Uint8Array.from(mixed(500, 4)), 0x4000)).toBeNull();
    expect(unpackKrillExomizer(Uint8Array.from([0x20, 0x00]), 0x4000)).toBeNull();
  });

  it('reads a disk whose files are packed so by name, with the protocol that reads them, and names them .exo', () => {
    const files = [mixed(2000, 5), mixed(1500, 6), mixed(1000, 7)].map((d, i) => packKrillExomizer(d, 0x2000 + i * 0x1000, 39).bytes);
    const disk = makeKrillDisk([
      { name: 'BOOT', load: 0x0801, bytes: BOOT },
      ...files.map((bytes, i): FakeKrillEntry => ({ name: `PART${i}`, load: 0x8000 + i * 0x1000, bytes })),
    ]);
    const d = readKrillDisk(disk)!;
    // no call in the files: an Exomizer build may load by name or by track and sector
    expect(d).toMatchObject({ packer: 'exomizer', protocol: 39, by: null, found: 'files', calls: [] });
    expect(krillPackerName(d)).toBe('Exomizer 3 (protocol 39)');
    expect(d.files.map(krillFileName)).toEqual(['file00_0801.prg', 'file01_2000.exo', 'file02_3000.exo', 'file03_4000.exo']);
    expect(cc1541Script(d, 'exo.d64').slice(0, 3)).toEqual([
      "# cc1541 command line, rebuilt by Mimir Studio from exo.d64 (Krill's loader, Exomizer 3 (protocol 39)): 4 files, 3 of them packed.",
      "# Krill's loader has no load script: a part loads a file by its name, or the next file in the directory with an empty",
      "# name, or (builds of version 146 and older) by its track and sector; no call in the files' code says which this",
    ]);
  });
});

/** The part that loads the others, at $c000: by track and sector, by a table of them, and raw to $e000 with the carry
 *  set (Continuum's 17/10 loads 19/18 and 20/9 so); `ts` gives where each named file starts. */
function part(ts: Record<'a' | 'b' | 'h' | 'f1' | 'f2' | 'raw', [number, number]>): number[] {
  const code = [
    0x18, 0xa2, ts.a[0], 0xa0, ts.a[1], 0x20, 0x0b, 0x02, 0xb0, 0xf6, 0x60, // $c000: clc / ldx / ldy / jsr loadcompd / bcs
    0xad, 0x40, 0xc0, 0x0a, 0xaa, 0xbc, 0x31, 0xc0, 0xbd, 0x30, 0xc0, 0xaa, 0x20, 0x0b, 0x02, 0x60, // $c00b: the table
    0x38, 0xa2, ts.raw[0], 0xa0, ts.raw[1], 0xa9, 0x00, 0x85, 0x06, 0xa9, 0xe0, 0x85, 0x07, 0x20, 0x00, 0x02, 0x60, // $c01b
  ];
  while (code.length < 0x30) code.push(0xea);
  code.push(...ts.b, ...ts.h, ...ts.f1, ...ts.f2, 0, 0);
  while (code.length < 0x41) code.push(0);
  return [...code, ...mixed(400, 9)];
}

/** A disk for a build of version 146 that loads by track and sector, as Continuum's is: the boot, packed files of the
 *  directory with dirart names (DEL), one packed in place, one not packed, the part above last, and a file whose
 *  directory entry is emptied (a chain of sectors outside the directory). */
function tsDisk(): { disk: Uint8Array; ts: Record<'a' | 'b' | 'h' | 'f1' | 'f2' | 'raw' | 'part', [number, number]>; data: Record<string, number[]> } {
  const data = { a: mixed(3000, 11), b: mixed(1500, 12), h: mixed(800, 13), f1: mixed(600, 14), f2: mixed(700, 15), raw: mixed(300, 16) };
  const a = packKrillExomizerInPlace(data.a, 0x2000);
  const packed = (d: number[], dest: number) => packKrillExomizer(d, dest).bytes;
  const entries = (p: number[]): FakeKrillEntry[] => [
    { name: 'TS DEMO', load: 0x0801, bytes: BOOT },
    { name: [0x6d, 0x6e, 0x6d, 0x6e], type: 'DEL', load: a.load, bytes: a.bytes, blocks: 0 },
    { name: [0x6e, 0x6d], type: 'DEL', load: 0x9000, bytes: packed(data.b, 0x4000), blocks: 0 },
    { name: 'HIDDEN', type: 'DEL', load: 0xa000, bytes: packed(data.h, 0x5000), blocks: 0 },
    { name: [0x60, 0x60], type: 'DEL', load: 0xb000, bytes: packed(data.f1, 0x6000), blocks: 0 },
    { name: [0x60, 0x6d], type: 'DEL', load: 0xb800, bytes: packed(data.f2, 0x6800), blocks: 0 },
    { name: [0x20, 0x20], type: 'DEL', load: 0x7000, bytes: data.raw, blocks: 0 },
    { name: [0x6e, 0x6e], type: 'DEL', load: 0x8000, bytes: packKrillExomizer(p, 0xc000).bytes, blocks: 0 },
  ];
  // where the files start, from a first layout (the part is the last file: its length moves no other)
  const first = parseD64(makeKrillDisk(entries(part({ a: [0, 0], b: [0, 0], h: [0, 0], f1: [0, 0], f2: [0, 0], raw: [0, 0] })), { header: 'TS DEMO' })).files;
  const at = (i: number): [number, number] => [first[i].track, first[i].sector];
  const ts = { a: at(1), b: at(2), h: at(3), f1: at(4), f2: at(5), raw: at(6), part: at(7) };
  const disk = hideKrillEntry(makeKrillDisk(entries(part(ts)), { header: 'TS DEMO', id: [0x31, 0x34, 0xa0, 0x32, 0x41] }), 3);
  return { disk, ts, data: { ...data, part: part(ts) } };
}

describe("Krill's loader loading by track and sector (version 146)", () => {
  it('reads the calls in the files: by track and sector, a table of them, a raw load to an address', () => {
    const { disk, ts, data } = tsDisk();
    const d = readKrillDisk(disk)!;
    expect(d).toMatchObject({ packer: 'exomizer', protocol: 0, by: 'ts', found: 'files' });
    expect(d.files.map(krillFileName)).toEqual([
      'file00_0801.prg', 'file01_2000.exo', 'file02_4000.exo', 'file03_6000.exo', 'file04_6800.exo', 'file05_7000.prg', 'file06_c000.exo',
      `t${String(ts.h[0]).padStart(2, '0')}s${String(ts.h[1]).padStart(2, '0')}_5000.exo`,
    ]);
    const hidden = d.files[7];
    expect(hidden).toMatchObject({ entry: -1, load: 0xa000, unpacked: { start: 0x5000, end: 0x5000 + 800 } });
    expect([...hidden.unpacked!.bytes]).toEqual(data.h);
    expect(d.files[1].unpacked).toMatchObject({ start: 0x2000, inplace: true });
    expect(d.calls.map(c => [c.at, c.jsr, c.to, c.how, krillFileName(d.files[c.file]), c.dest])).toEqual([
      [0xc000, 0xc005, 0x020b, 'ts', 'file01_2000.exo', null],
      [0xc010, 0xc017, 0x020b, 'table', 'file02_4000.exo', null],
      [0xc010, 0xc017, 0x020b, 'table', krillFileName(hidden), null],
      [0xc010, 0xc017, 0x020b, 'table', 'file03_6000.exo', null],
      [0xc010, 0xc017, 0x020b, 'table', 'file04_6800.exo', null],
      [0xc01b, 0xc028, 0x0200, 'ts', 'file05_7000.prg', 0xe000],
    ]);
    expect(d.calls.every(c => d.files[c.in] === d.files[6])).toBe(true);
    expect(d.calls.map(c => krillCallText(c, d))).toEqual([
      `load ${ts.a.join('/')}`, `load ${ts.b.join('/')} (table $c030, entry 0)`, `load ${ts.h.join('/')} (table $c030, entry 1)`,
      `load ${ts.f1.join('/')} (table $c030, entry 2)`, `load ${ts.f2.join('/')} (table $c030, entry 3)`, `load ${ts.raw.join('/')} to $e000`,
    ]);
  });

  it("writes cc1541's command line with the files outside the directory and the calls as comments", () => {
    const { disk, ts } = tsDisk();
    const d = readKrillDisk(disk)!, text = cc1541Script(d, 'ts.d64');
    expect(text[0]).toBe("# cc1541 command line, rebuilt by Mimir Studio from ts.d64 (Krill's loader, Exomizer 2): 8 files, 6 of them packed.");
    expect(text[1]).toMatch(/this build loads a file by its track and sector/);
    expect(text).toContain('# 1 file is not in the directory, loaded by its track and sector; this command line does not write it:');
    expect(text.some(l => l.startsWith(`#   ${ts.h.join('/')}`) && l.includes('loads at $a000') && l.includes('unpacks to $5000-$531f'))).toBe(true);
    expect(text).toContain("# The loader's calls in the files' code (6): the file, where, the routine, the file it loads.");
    expect(text.some(l => l.includes(`file06_c000.exo  $c01b calls $0200  load ${ts.raw.join('/')} to $e000`))).toBe(true);
    // the hidden file has no entry in the command line
    expect(text.filter(l => l.includes('-w ')).length).toBe(7);
  });

  it('drops calls of a routine called only once, and does not take a call naming the middle of a file', () => {
    const { ts } = tsDisk();
    // one call alone: no routine of the loader (nothing else calls it)
    const one = [0x18, 0xa2, ts.a[0], 0xa0, ts.a[1], 0x20, 0x0b, 0x02, 0x60, ...mixed(300, 20)];
    const disk = makeKrillDisk([
      { name: 'BOOT', load: 0x0801, bytes: BOOT },
      { name: 'A', load: 0x9000, bytes: packKrillExomizer(mixed(1500, 21), 0x2000).bytes },
      { name: 'B', load: 0x9800, bytes: packKrillExomizer(mixed(1500, 22), 0x3000).bytes },
      { name: 'P', load: 0xa000, bytes: packKrillExomizer(one, 0xc000).bytes },
    ]);
    const d = readKrillDisk(disk)!;
    expect(d).toMatchObject({ by: null, calls: [] });
    // three calls: two name where files start, one the second sector of a file, which is no file of its own
    const files = (p: number[]): FakeKrillEntry[] => [
      { name: 'BOOT', load: 0x0801, bytes: BOOT },
      { name: 'A', load: 0x9000, bytes: packKrillExomizer(mixed(1500, 21), 0x2000).bytes },
      { name: 'B', load: 0x9800, bytes: packKrillExomizer(mixed(1500, 22), 0x3000).bytes },
      { name: 'P', load: 0xa000, bytes: packKrillExomizer(p, 0xc000).bytes },
    ];
    const call = (t: number, s: number) => [0x18, 0xa2, t, 0xa0, s, 0x20, 0x0b, 0x02, 0x60];
    const layout = readKrillDisk(makeKrillDisk(files([...call(0, 0), ...mixed(300, 20)])))!.files;
    const [a, b] = [layout[1].sectors, layout[2].sectors];
    expect(a.length).toBeGreaterThan(1);
    const three = readKrillDisk(makeKrillDisk(files([...call(...a[0]), ...call(...b[0]), ...call(...a[1]), ...mixed(300, 20)])))!;
    expect(three.calls.map(c => [c.at, krillFileName(three.files[c.file])])).toEqual([[0xc000, 'file01_2000.exo'], [0xc009, 'file02_3000.exo']]);
    expect(three.files.some(f => f.entry < 0)).toBe(false);
  });
});

/** A program with version 146's resident at $0200 (its loadraw and loadcompd as stand-ins, its pollblock as Continuum
 *  has it) and the calls of Continuum's main program: a job traced, jobs a script of its own runs (not traced), a
 *  table, and a raw load to $e000. */
function scriptProgram(ts: Record<string, [number, number]>): ProjectInput {
  const b = (v: number) => `$${v.toString(16).padStart(2, '0')}`;
  const src = `.pc = $0200
loadraw: jmp start
 .fill 8, $ea
loadcompd: rts
.pc = $0220
start: sei
 jsr job1
loop: jmp loop
job1: clc
 ldx #${b(ts.a[0])}
 ldy #${b(ts.a[1])}
 jsr loadcompd
 bcs job1
 rts
// jobs only a script of the program's own runs: not traced
 .byte $18, $a2, ${b(ts.part[0])}, $a0, ${b(ts.part[1])}, $20, $0b, $02, $b0, $f6, $60
 .byte $38, $a2, ${b(ts.raw[0])}, $a0, ${b(ts.raw[1])}, $a9, $00, $85, $06, $a9, $e0, $85, $07, $20, $00, $02, $60
.pc = $029f
 .byte $a2,$03,$8e,$02,$dd,$c9,$fe,$f0,$ee,$18,$69,$fb,$38,$60,$a9,$01,$a2,$37,$2c,$00,$dd,$50,$fb,$30,$f3,$8e,$02,$dd,$20,$a8,$02,$60
`;
  // the jobs marked as data: the analysis does not trace them (it would take them for code after the rts)
  return { name: 'krill-script', files: [fromSource('krill-script.prg', src)], overrides: [{ start: 0x0232, end: 0x024a, type: 'data' }] };
}

describe("Krill's loader's script in a program", () => {
  it('is known by version 146\'s pollblock, and its calls are read from traced code and from bytes not traced', () => {
    const { ts } = tsDisk();
    const A = analyze(scriptProgram(ts));
    expect(A.loaders.map(l => [l.id, l.sure, l.parts.map(p => p.what)])).toEqual([
      ['krill', 'match', ['version 146 and older: waiting for a block (ldx #$03 / stx $dd02 / bit $dd00 / bvc / stx $dd02)']],
    ]);
    const S = A.krill!;
    expect(S).toMatchObject({ routines: [0x0200, 0x020b], by: 'ts' });
    expect(S.steps.map(s => [s.at, s.to, s.traced, s.x, s.y, s.carry, s.dest])).toEqual([
      [0x0227, 0x020b, true, ts.a[0], ts.a[1], 0, null],
      [0x0232, 0x020b, false, ts.part[0], ts.part[1], 0, null],
      [0x023d, 0x0200, false, ts.raw[0], ts.raw[1], 1, 0xe000],
    ]);
  });

  it('gives each load its file on the mounted disk, and writes the script with the disk\'s command line', () => {
    const { disk, ts } = tsDisk();
    const A = analyze(scriptProgram(ts)), d = readKrillDisk(disk)!;
    expect(krillLoads(A.krill!, d).map(l => [l.text, l.file && krillFileName(l.file)])).toEqual([
      [`load ${ts.a.join('/')}`, 'file01_2000.exo'], [`load ${ts.part.join('/')}`, 'file06_c000.exo'], [`load ${ts.raw.join('/')} to $e000`, 'file05_7000.prg'],
    ]);
    // without the disk: no files
    expect(krillLoads(A.krill!, null).map(l => l.file)).toEqual([null, null, null]);
    const text = krillScriptText(A.krill!, d, 'ts.d64');
    expect(text.slice(0, 3)).toEqual([
      "; Krill's loader script, read back by Mimir Studio from the code that calls the loader at $0200 and $020b: 3 loads.",
      '; The code is the script: ldx #track / ldy #sector / jsr $0200 loads a file (this build names a file by where it starts).',
      '; Calls marked "not traced" were read from bytes the analysis did not trace (copied elsewhere, or run by a script of the program\'s own).',
    ]);
    expect(text[4]).toBe(`  ${`load ${ts.a.join('/')}`.padEnd(38)} ; $0227, file01_2000.exo, unpacks to $2000-$2bb7`);
    expect(text[5]).toMatch(/; \$0232 \(not traced\), file06_c000\.exo, unpacks to \$c000-/);
    expect(text).toContain(cc1541Script(d, 'ts.d64')[0]);
  });

  it('reads a name X and Y point at as the load of a file by its name', () => {
    const src = `.pc = $0200
 jmp start
 .fill 8, $ea
 rts
.pc = $0220
start: ldx #<n1
 ldy #>n1
 jsr $020b
 ldx #<n2
 ldy #>n2
 jsr $020b
 jmp start
n1: .byte $50, $41, $52, $54, $31, 0
n2: .byte $50, $41, $52, $54, $32, 0
.pc = $029f
 .byte $a2,$03,$8e,$02,$dd,$c9,$fe,$f0,$ee,$18,$69,$fb,$38,$60,$a9,$01,$a2,$37,$2c,$00,$dd,$50,$fb,$30,$f3,$8e,$02,$dd,$20,$a8,$02,$60
`;
    const A = analyze({ name: 'n', files: [fromSource('n.prg', src)] });
    expect(A.krill).toMatchObject({ by: 'name', routines: [0x020b] });
    expect(krillLoads(A.krill!, null).map(l => l.text)).toEqual(['load "PART1"', 'load "PART2"']);
    const disk = makeKrillDisk([
      { name: 'BOOT', load: 0x0801, bytes: BOOT },
      { name: 'PART1', load: 0x9000, bytes: packKrillExomizer(mixed(1500, 31), 0x2000).bytes },
      { name: 'PART2', load: 0x9800, bytes: packKrillExomizer(mixed(1500, 32), 0x3000).bytes },
    ]);
    expect(krillLoads(A.krill!, readKrillDisk(disk)).map(l => l.file && krillFileName(l.file))).toEqual(['file01_2000.exo', 'file02_3000.exo']);
  });
});

describe('the Krill track-and-sector fixtures', () => {
  it('are fixtures/d64/krill-ts-demo.d64 and fixtures/prg/krill-ts-script.prg, which the e2e tests use', () => {
    const { disk, ts } = tsDisk();
    const diskPath = join(__dirname, '../../../fixtures/d64/krill-ts-demo.d64'), prgPath = join(__dirname, '../../../fixtures/prg/krill-ts-script.prg');
    const f = scriptProgram(ts).files[0], prg = Uint8Array.from([f.load & 0xff, f.load >> 8, ...f.bytes]);
    if (process.env.WRITE_FIXTURES) { writeFileSync(diskPath, disk); writeFileSync(prgPath, prg); }
    expect(new Uint8Array(readFileSync(diskPath))).toEqual(disk);
    expect(new Uint8Array(readFileSync(prgPath))).toEqual(prg);
    expect(ts).toEqual({ a: [1, 1], b: [1, 4], h: [1, 6], f1: [1, 8], f2: [1, 10], raw: [1, 12], part: [1, 14] });
    const d = readKrillDisk(disk)!;
    expect([...krillFilePrg(d.files[1]).subarray(2)]).toEqual(mixed(3000, 11));
    // no other reader takes it
    expect(readBitfireDisk(disk)).toBeNull();
    expect(readSpindleDisk(disk)).toBeNull();
    expect(readBoozeDisk(disk)).toBeNull();
    expect(readSparkleDisk(disk)).toBeNull();
    expect(readCovertDisk(disk)).toBeNull();
  });
});
