/* .tap tape images (spec 13.5e): the pulses, the KERNAL's format (as makeTap writes it, read back, copies merged),
 * TapeTool's turbo format (TinyHeader, checksum blocks, RLE, blocks in any order) and Turbo Tape's, the stretches no
 * format reads, the TapeTool command lines, the tape with its boot file written again, and Sindri playing the tape:
 * the boot file's own loader loads the next file from the datasette and starts it. */
import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makePrg, makeTap, readTape, replaceTapeFile, tapeFileName, tapeToolRle, tapeToolScript, tapPulses, unpackPrg } from '../src';
import { blockFile, demoTape, rle, runs, sineTable, tinyFile, turboTapeFile, TurboWriter, withTurbo } from './helpers/tapetool-tape';

const bytes = (n: number, seed = 1) => Uint8Array.from({ length: n }, (_, i) => (i * 31 + seed * 7) & 0xff);
const demo = new Uint8Array(readFileSync(join(__dirname, '../../../fixtures/prg/raster-demo.prg')));
/** a TAP of these TAP-unit pulses */
const tapOf = (version: number, body: number[]) => {
  const u8 = new Uint8Array(20 + body.length);
  u8.set([...'C64-TAPE-RAW'].map(c => c.charCodeAt(0)));
  u8[12] = version;
  u8[16] = body.length & 0xff; u8[17] = body.length >> 8;
  u8.set(body, 20);
  return u8;
};

describe('tap pulses', () => {
  it('reads versions 0, 1 and 2, and refuses what is not a tape', () => {
    expect([...tapPulses(tapOf(0, [0x30, 0, 0x42])).cycles]).toEqual([0x180, 20000, 0x210]);
    expect([...tapPulses(tapOf(1, [0x30, 0, 0x40, 0x42, 0x0f, 0x56])).cycles]).toEqual([0x180, 0x0f4240, 0x2b0]);
    // version 2: half waves, two to a pulse
    expect([...tapPulses(tapOf(2, [0x18, 0x18, 0x20, 0x22])).cycles]).toEqual([0x180, 0x210]);
    expect(tapPulses(tapOf(1, [0x30])).times[1]).toBe(0x180);
    expect(() => tapPulses(new Uint8Array(40))).toThrow(/not a \.tap tape image/);
  });
});

describe('the KERNAL format', () => {
  it('reads back what makeTap writes: names, types, addresses, data, both copies', () => {
    const files = [
      { name: 'first', load: 0x0801, data: bytes(1000), basic: true },
      { name: 'second', load: 0xc000, data: bytes(192, 3) },
      { name: 'third', load: 0x2000, data: bytes(1, 5) },
    ];
    const img = readTape(makeTap({ files, endOfTape: true }));
    expect(img.files.map(f => [f.format, f.name, f.type, f.load, f.end, f.copies, f.errors])).toEqual([
      ['cbm', 'FIRST', 'BASIC', 0x0801, 0x0801 + 1000, [2, 2], []],
      ['cbm', 'SECOND', 'PRG', 0xc000, 0xc000 + 192, [2, 2], []],
      ['cbm', 'THIRD', 'PRG', 0x2000, 0x2001, [2, 2], []],
      ['cbm', '(no name)', 'END', null, null, [2, 0], []],
    ]);
    for (const [i, f] of files.entries()) expect(img.files[i].data).toEqual(f.data);
    expect(img.files[0].seconds).toBe(0);
    expect(img.files[1].seconds).toBeGreaterThan(10);
    expect(img.unknown).toEqual([]);
    expect(img.tapetool).toBeNull();
    expect(tapeFileName(img.files[0])).toBe('FIRST.prg');
  });

  it('puts a relocatable program at the start of BASIC, as LOAD does, and says where it was saved from', () => {
    const [f] = readTape(makeTap({ files: [{ name: 'game', load: 0xcc49, data: bytes(100), basic: true }] })).files;
    expect([f.load, f.end, f.saved]).toEqual([0x0801, 0x0801 + 100, 0xcc49]);
    expect(f.note).toMatch(/saved from \$cc49/);
  });

  it('takes the copy read cleanly, and says so when neither is', () => {
    const tap = makeTap({ files: [{ name: 'x', load: 0x1000, data: bytes(300) }] });
    // where makeTap puts the data block's copies: after the header's leader, two copies and trailer, and its own leader
    const block = (n: number) => (9 + n + 1) * 20 + 2;
    const first = 0x6a00 + block(192) + 0x4f + block(192) + 0x4e + 0x1500, second = first + block(300) + 0x4f;
    // a pulse of data byte 5's first bit pair turned long: that byte is unreadable in that copy
    const pulse = (copy: number, k: number) => 20 + copy + (9 + k) * 20 + 3;
    const once = tap.slice();
    once[pulse(first, 5)] = 0x56;
    expect(readTape(once).files[0]).toMatchObject({ data: bytes(300), errors: [] });
    const twice = once.slice();
    twice[pulse(second, 7)] = 0x56;
    // byte by byte, from the copy that read it
    expect(readTape(twice).files[0]).toMatchObject({ data: bytes(300), errors: ['checksum: the data could not be read cleanly'] });
    twice[pulse(second, 5)] = 0x56;
    expect(readTape(twice).files[0].errors).toEqual(['checksum: the data could not be read cleanly']);
  });

  it('reads a data block of 192 bytes that looks like a header as the data', () => {
    const data = bytes(192); data[0] = 3;
    const img = readTape(makeTap({ files: [{ name: 'odd', load: 0x4000, data }] }));
    expect(img.files).toHaveLength(1);
    expect(img.files[0].data).toEqual(data);
  });

  it('knows a header with code in the tape buffer', () => {
    const header = new Uint8Array(171).fill(0x20); header.set([0x78, 0xee, 0x20, 0xd0, 0x4c, 0x52, 0x03]);
    const [f] = readTape(makeTap({ files: [{ name: 'boot', load: 0x02a7, data: bytes(93), header }] })).files;
    expect(f.headerCode).toBe(true);
    expect([...f.header!.subarray(21, 28)]).toEqual([0x78, 0xee, 0x20, 0xd0, 0x4c, 0x52, 0x03]);
  });
});

describe('TapeTool', () => {
  it('unpacks its RLE: escape, count, value, and the escape at the end', () => {
    expect([...tapeToolRle(Uint8Array.from([0xff, 1, 2, 0xff, 4, 9, 3, 0xff, 0, 7, 0xff]))]).toEqual([1, 2, 9, 9, 9, 9, 3, ...new Array(256).fill(7)]);
    const r = runs().subarray(0, 256);
    expect(tapeToolRle(rle(r)!)).toEqual(r);
  });

  it('reads the fixture: the boot file, the TinyHeader file where its loader puts it, blocks in any order, RLE', () => {
    const tape = demoTape(demo);
    const path = join(__dirname, '../../../fixtures/tap/mimir-demo.tap');
    if (process.env.WRITE_FIXTURES) writeFileSync(path, tape);
    expect(new Uint8Array(readFileSync(path))).toEqual(tape);
    const img = readTape(tape);
    expect(img.files.map(f => [f.format, f.name, f.load, f.end, f.tiny ?? false, f.blocks ?? null, f.packed ?? null, f.shuffled ?? false, f.errors])).toEqual([
      ['cbm', 'MIMIR TAPE', 0x02a7, 0x0304, false, null, null, false, []],
      ['tapetool', 'TinyHeader file', 0x0801, 0x0801 + demo.length - 2, true, 1, 0, false, []],
      ['tapetool', 'file 1', 0x4000, 0x4200, false, 2, 0, true, []],
      ['tapetool', 'file 2', 0x5000, 0x5258, false, 3, 3, false, []],
    ]);
    expect(img.files[0].headerCode).toBe(true);
    expect(img.files[1].data).toEqual(demo.subarray(2));
    expect(img.files[2].data).toEqual(sineTable());
    expect(img.files[3].data).toEqual(runs());
    expect(img.unknown).toEqual([]);
    expect(img.tapetool).toEqual({ speed: 256, leadOut: 0x48 });
  });

  it('writes the command lines that write the tape again with TapeTool, and the files they need', () => {
    const img = readTape(demoTape(demo));
    const s = tapeToolScript(img, 'demo.tap')!;
    expect(s.script.filter(l => !l.startsWith('rem'))).toEqual([
      'TapeTool.exe wn "demo.tap" ocb1 "boot.bin" $2a7 0 16 16 187 187 280 c',
      'TapeTool.exe w "demo.tap" a otl$c0 otft "tinyheader.prg" c',
      'TapeTool.exe n 1 w "demo.tap" a otl$40 otfb "file1.prg" 1 c',
      'TapeTool.exe w "demo.tap" a otl$40 otfbr "file2.prg" 2 c',
      'TapeTool.exe w "demo.tap" a otl$40 c',
    ]);
    expect(Object.keys(s.files)).toEqual(['boot.bin', 'tinyheader.prg', 'file1.prg', 'file2.prg']);
    expect(s.files['tinyheader.prg']).toEqual(demo);
    expect(s.files['boot.bin'].length).toBe(187 + 93);
    expect(tapeToolScript(readTape(makeTap({ files: [{ name: 'x', load: 0x1000, data: bytes(10) }] })), 'x.tap')).toBeNull();
  });

  it('reads another TapeTurboSpeed, and gives it to TapeTool with ft on every line', () => {
    // TapeTurboSpeed $a0, as SEUCK Redux's tapes have it: a 0 of 320 cycles, a 1 of 640
    const w = new TurboWriter(0x28, 0x50);
    w.leader(0xc0);
    blockFile(w, 3, 0x2000, bytes(300, 4));
    w.leader(0xc0);
    const img = readTape(withTurbo(makeTap({ files: [] }), w.pulses));
    expect(img.files.map(f => [f.name, f.load, f.end, f.errors])).toEqual([['file 3', 0x2000, 0x2000 + 300, []]]);
    expect(img.tapetool?.speed).toBe(320);
    expect(tapeToolScript(img, 'x.tap')!.script.filter(l => !l.startsWith('rem'))).toEqual([
      'TapeTool.exe wn "x.tap" ft $140 $280 1 $aa otl$c0 otfb "file3.prg" 3 c',
      'TapeTool.exe w "x.tap" a ft $140 $280 1 $aa otl$c0 c',
    ]);
  });

  it('reads files mixed with each other, and blocks that are not on the tape', () => {
    const w = new TurboWriter();
    w.leader(0x40);
    // file 3's two blocks, file 4's block between them (as `s` writes them), then file 5 with a block missing
    const a = bytes(512, 2), b = bytes(100, 3), c = bytes(600, 4);
    const mixed = new TurboWriter();
    blockFile(mixed, 3, 0x6000, a, { order: [0] });
    blockFile(mixed, 4, 0x7000, b);
    const second = new TurboWriter();
    blockFile(second, 3, 0x6000, a, { order: [1] });
    w.pulses.push(...mixed.pulses);
    // (blockFile writes a whole file's header count: file 3 has 2 blocks, the second one comes after file 4's)
    w.pulses.push(...second.pulses);
    w.leader(0x40);
    blockFile(w, 5, 0x8000, c, { order: [0, 2] });
    w.leader(0x40);
    const img = readTape(withTurbo(makeTap({ files: [] }), w.pulses));
    expect(img.files.map(f => [f.name, f.load, f.end, f.blocks, f.interleaved ?? false, f.errors])).toEqual([
      ['file 3', 0x6000, 0x6200, 2, false, []],
      ['file 4', 0x7000, 0x7064, 1, true, []],
      ['file 5', 0x8000, 0x8258, 2, false, ['1 of its 3 blocks are not on the tape']],
    ]);
    expect(img.files[0].data).toEqual(a);
  });

  it('needs its own leader before a TinyHeader, which has nothing else to check', () => {
    const w = new TurboWriter();
    for (let i = 0; i < 200; i++) w.byte(0x40);
    w.bytes([0xaa, 0x69, 1, 2, 3, 0]);
    for (let i = 0; i < 200; i++) w.byte(0x40);
    expect(readTape(withTurbo(makeTap({ files: [] }), w.pulses)).files).toEqual([]);
    const t = new TurboWriter();
    t.leader(0x40);
    tinyFile(t, Uint8Array.from([1, 2, 3]));
    t.leader(0x40);
    const [f] = readTape(withTurbo(makeTap({ files: [] }), t.pulses)).files;
    expect([f.name, f.load, [...f.data], f.errors]).toEqual(['TinyHeader file', null, [1, 2, 3], []]);
  });
});

describe('Turbo Tape 64', () => {
  it('reads a header and its data, and calls data no format reads unknown', () => {
    const w = new TurboWriter(0x1a, 0x28);
    turboTapeFile(w, 'game', 0x0801, bytes(3000));
    // an unknown loader: two pulse lengths, any bytes
    const u = new TurboWriter(0x24, 0x50);
    u.bytes(bytes(2000, 9));
    const img = readTape(withTurbo(makeTap({ files: [] }), [...w.pulses, 0, 0x20, 0x4e, 0, ...u.pulses]));
    expect(img.files.map(f => [f.format, f.name, f.type, f.load, f.end, f.errors])).toEqual([['turbotape', 'GAME', 'PRG', 0x0801, 0x0801 + 3000, []]]);
    expect(img.files[0].data).toEqual(bytes(3000));
    expect(img.unknown).toHaveLength(1);
    expect(img.unknown[0]).toMatchObject({ pulses: u.pulses.length, short: 0x24 * 8, long: 0x50 * 8 });
  });
});

describe('the tape in Build & Run and in Sindri', () => {
  it('writes a KERNAL file again, the tape after it as it was', () => {
    const tape = demoTape(demo);
    const img = readTape(tape);
    const boot = img.files[0];
    const data = boot.data.slice(); data[0] = 0x60;
    const header = boot.header!.slice(); header.set([...'NEW BOOT        '].map(c => c.charCodeAt(0)), 5);
    const again = readTape(replaceTapeFile(tape, boot, header, data));
    expect(again.files.map(f => f.name)).toEqual(['NEW BOOT', 'TinyHeader file', 'file 1', 'file 2']);
    expect(again.files[0].data).toEqual(data);
    expect(again.files[1].data).toEqual(demo.subarray(2));
  });

  it('Sindri plays the tape: the boot file\'s loader reads the next file from the datasette and starts it', () => {
    const tape = demoTape(demo);
    const boot = readTape(tape).files[0];
    const run = unpackPrg(makePrg(boot.load!, boot.data), null, null, null, { tap: tape });
    expect(run.tape).toMatch(/the tape stood after the file .* played/);
    expect(run.unpacked).toBe(true);
    expect(run.saved!.start).toBeLessThanOrEqual(0x0801);
    const saved = run.saved!.prg, at = 0x0801 - run.saved!.start + 2;
    expect([...saved.subarray(at, at + demo.length - 2)]).toEqual([...demo.subarray(2)]);
    expect(run.saved!.entry).toBe(0x0810);
  });
});
