/* .tap tape images (spec 13.5e): the pulses, the KERNAL's format (as makeTap writes it, read back, copies merged),
 * TapeTool's turbo format (TinyHeader, checksum blocks, RLE, blocks in any order) and Turbo Tape's, the stretches no
 * format reads, the TapeTool command lines, the tape with its boot file written again, and Sindri playing the tape:
 * the boot file's own loader loads the next file from the datasette and starts it. */
import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { makePrg, makeTap, notPacked, readTape, replaceTapeFile, tapeBoot, tapeFileName, tapeToolRle, tapeToolScript, tapPulses, unpackLog, unpackPrg, unpackSummary, type TapeFile } from '../src';
import { findC64Roms } from '../src/node';
import { fakePack } from './helpers/fake-packer';
import { blockFile, bootLoader, demoTape, firebirdChain, firebirdDemoTape, firebirdFile, firebirdPause, loaderStartTape, megaSaveDemoTape, megaSaveFile, novaFile, novaloadDemoTape, novaPages, pilotFile, rle, runs, sineTable, tinyFile, tinyLoader, turboTapeFile, TurboWriter, microFile, microloadDemoTape, wildChain, wildloadDemoTape, withTurbo } from './helpers/tapetool-tape';
import { cyberBlocks, cyberFirstStage, cyberloadDemoTape, cyberNamedFile, cyberPause, cyberSecondStage, otherSideDemoTape, secondStageCode } from './helpers/cyberload-tape';

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

  it('loads what the header says of a longer data block, as the KERNAL stores it: the rest is only read', () => {
    // a boot file's whole tape buffer of 192 bytes, its header saying the 12 that load over the vectors at $0300 (the
    // spaces after them would take $0314 and $0328 to $2020)
    const data = Uint8Array.from({ length: 192 }, (_, i) => (i < 12 ? (i & 1 ? 0x03 : 0x51) : 0x20));
    const [f] = readTape(makeTap({ files: [{ name: 'boot', load: 0x0300, data, end: 0x030c }] })).files;
    expect([f.load, f.end, [...f.data], f.note, f.errors]).toEqual([0x0300, 0x030c, [...data.slice(0, 12)], "the data block holds 192 bytes, LOAD stores the header's 12", []]);
    // a header that says more than the block holds: the file is the block
    const [g] = readTape(makeTap({ files: [{ name: 'more', load: 0x1000, data: bytes(100), end: 0x1100 }] })).files;
    expect([g.end, g.data.length, g.note]).toEqual([0x1000 + 100, 100, 'the header says $1000-$1100, the data block holds 100 bytes']);
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

describe('Freeload and US Gold\'s loader', () => {
  it('read their files: pilot, sync, [a name,] start, end, the data and their XOR', () => {
    // Freeload's pulses: a 0 of about 280 cycles, a 1 of about 376
    const w = new TurboWriter(0x23, 0x2f);
    pilotFile(w, { pilot: 0x40, sync: 0x5a, load: 0x0800, data: bytes(1088, 2) });
    pilotFile(w, { pilot: 0x40, sync: 0x5a, load: 0xa000, data: bytes(3000, 3) });
    const u = new TurboWriter(0x24, 0x31);
    pilotFile(u, { pilot: 0x20, sync: 0xff, name: 'loader', load: 0xc075, data: bytes(1116, 4) });
    pilotFile(u, { pilot: 0x20, sync: 0xff, name: 'a', load: 0x2000, data: bytes(4000, 5) });
    const img = readTape(withTurbo(makeTap({ files: [] }), [...w.pulses, 0, 0x20, 0x4e, 0, ...u.pulses]));
    expect(img.files.map(f => [f.format, f.name, f.load, f.end, f.errors])).toEqual([
      ['freeload', 'file_0800', 0x0800, 0x0800 + 1088, []],
      ['freeload', 'file_a000', 0xa000, 0xa000 + 3000, []],
      ['usgold', 'LOADER', 0xc075, 0xc075 + 1116, []],
      ['usgold', 'A', 0x2000, 0x2000 + 4000, []],
    ]);
    expect(img.files[2].data).toEqual(bytes(1116, 4));
    expect(img.unknown).toEqual([]);
    expect(tapeFileName(img.files[0])).toBe('file_0800.prg');
    // a checksum that does not fit: not a file of theirs, but turbo data no format reads
    const bad = new TurboWriter(0x23, 0x2f);
    pilotFile(bad, { pilot: 0x40, sync: 0x5a, load: 0x0800, data: bytes(3000, 2) });
    const t = withTurbo(makeTap({ files: [] }), bad.pulses);
    const at = t.length - 16 * 8 - 8 + 3;
    t[at] = t[at] === 0x23 ? 0x2f : 0x23;
    const again = readTape(t);
    expect(again.files).toEqual([]);
    expect(again.unknown).toHaveLength(1);
  });

  it('keep a file whose sum does not match on a tape where the others pass theirs (Ghostbusters\' charset)', () => {
    // Ghostbusters (Kixx): the loader at $f800, the charset at $7000 with a sum the boot never checks (it checks the
    // last file of the row), the music at $e000; the charset's stretch ends with its sum
    const xor = (d: Uint8Array) => d.reduce((a, v) => a ^ v, 0);
    const charset = bytes(2047, 7), wrong = xor(charset) ^ 0x6d;
    const tape = (o: { pilots?: number; trail?: number; others?: boolean }) => {
      const one = new TurboWriter(0x23, 0x2f), two = new TurboWriter(0x23, 0x2f), three = new TurboWriter(0x23, 0x2f);
      pilotFile(one, { pilot: 0x40, sync: 0x5a, load: 0xf800, data: bytes(1936, 2) });
      pilotFile(two, { pilot: 0x40, sync: 0x5a, load: 0x7000, data: charset, sum: wrong, pilots: o.pilots, trail: o.trail ?? 0 });
      pilotFile(three, { pilot: 0x40, sync: 0x5a, load: 0xe000, data: bytes(3952, 3) });
      const pause = [0, 0x20, 0x4e, 0];
      return readTape(withTurbo(makeTap({ files: [] }), o.others === false ? two.pulses : [...one.pulses, ...pause, ...two.pulses, ...pause, ...three.pulses]));
    };
    const img = tape({});
    expect(img.files.map(f => [f.name, f.load, f.end, f.errors])).toEqual([
      ['file_f800', 0xf800, 0xf800 + 1936, []],
      ['file_7000', 0x7000, 0x77ff, [`checksum: the data's XOR is $${xor(charset).toString(16).padStart(2, '0')}, the tape says $${wrong.toString(16).padStart(2, '0')}`]],
      ['file_e000', 0xe000, 0xe000 + 3952, []],
    ]);
    expect(img.files[1].data).toEqual(charset);
    expect(img.unknown).toEqual([]);
    // turbo data no format reads: alone on its tape (no file of the format passes its sum: another format with the same
    // pilot and sync), after a short pilot, or with the stretch going on after the sum
    for (const o of [{ others: false }, { pilots: 8 }, { trail: 16 }]) {
      const t = tape(o);
      expect(t.files.map(f => f.name)).toEqual(o.others === false ? [] : ['file_f800', 'file_e000']);
      expect(t.unknown).toHaveLength(1);
    }
  });

  it("read a file whose header's end takes in its sum, with the tape ending there (Gauntlet's first level)", () => {
    // Gauntlet's level tape: "A" at $2000-$2e01, 3 584 bytes and their XOR as the last byte, a pulse of 1 256 cycles
    // and a pause; then the levels "A1", each with its sum after it. The game's loader stores all 3 585 bytes.
    const level = bytes(3584, 9);
    const tape = (last: number) => {
      const a = new TurboWriter(0x21, 0x44), a1 = new TurboWriter(0x21, 0x44);
      pilotFile(a, { pilot: 0x20, sync: 0xff, name: 'a', load: 0x2000, data: Uint8Array.from([...level, last]), sum: null, trail: 0 });
      a.pulses.push(0x9d);
      pilotFile(a1, { pilot: 0x20, sync: 0xff, name: 'a1', load: 0x2000, data: bytes(5120, 10), trail: 0 });
      return readTape(withTurbo(makeTap({ files: [] }), [...a.pulses, 0, 0x20, 0x4e, 0, ...a1.pulses]));
    };
    const xor = level.reduce((a, v) => a ^ v, 0);
    const img = tape(xor);
    expect(img.files.map(f => [f.name, f.load, f.end, f.data.length, f.errors])).toEqual([
      ['A', 0x2000, 0x2e01, 3585, []],
      ['A1', 0x2000, 0x3400, 5120, []],
    ]);
    expect(img.files[0].data).toEqual(Uint8Array.from([...level, xor]));
    expect(img.files[0].note).toMatch(/takes in the sum: the last byte it loads, at \$2e00, is the XOR/);
    expect(img.files[1].note).toBeUndefined();
    expect(img.unknown).toEqual([]);
    // a last byte that is not the XOR of the others: turbo data no format reads
    const bad = tape(xor ^ 0x10);
    expect(bad.files.map(f => f.name)).toEqual(['A1']);
    expect(bad.unknown).toHaveLength(1);
  });
});

describe('Mega-Save', () => {
  it('reads its files at each speed: a pilot of $63, the sync bytes $64 … $ff, a byte, the header, the data and their XOR', () => {
    // Cauldron's speed (CIA2's timer B from $0107: a 0 of about 208 cycles, a 1 of 320), and Tazz's ($01fa: 432, 568)
    const w = new TurboWriter(26, 40);
    megaSaveFile(w, { load: 0x0f00, data: bytes(2000, 2), next: true });
    megaSaveFile(w, { load: 0xe000, data: bytes(0x2000, 3), run: 0x800a });
    const t = new TurboWriter(54, 71);
    megaSaveFile(t, { load: 0x0801, data: bytes(3000, 4) });
    const img = readTape(withTurbo(makeTap({ files: [] }), [...w.pulses, 0, 0x20, 0x4e, 0, ...t.pulses]));
    expect(img.files.map(f => [f.format, f.name, f.type, f.load, f.end, f.note, f.errors])).toEqual([
      ['megasave', 'file_0f00', 'PRG', 0x0f00, 0x0f00 + 2000, 'the loader goes on to the next file', []],
      // an end of $0000: to the top of memory
      ['megasave', 'file_e000', 'PRG', 0xe000, 0x10000, 'the loader starts it at $800a', []],
      ['megasave', 'file_0801', 'PRG', 0x0801, 0x0801 + 3000, 'the loader RUNs it', []],
    ]);
    expect(img.files[1].data).toEqual(bytes(0x2000, 3));
    expect(img.files[2].data).toEqual(bytes(3000, 4));
    expect(img.unknown).toEqual([]);
    expect(tapeFileName(img.files[2])).toBe('file_0801.prg');
  });

  it('is fixtures/tap/megasave-demo.tap, which the e2e tests insert: a table, then the demo', () => {
    const tape = megaSaveDemoTape(demo);
    const path = join(__dirname, '../../../fixtures/tap/megasave-demo.tap');
    if (process.env.WRITE_FIXTURES) writeFileSync(path, tape);
    expect(new Uint8Array(readFileSync(path))).toEqual(tape);
    const img = readTape(tape);
    expect(img.unknown).toEqual([]);
    expect(img.files.map(f => [f.format, f.name, f.load, f.end, f.note, f.errors])).toEqual([
      ['cbm', 'MEGA DEMO', 0x02a7, 0x02a7 + 93, undefined, []],
      ['megasave', 'file_c000', 0xc000, 0xc000 + 600, 'the loader goes on to the next file', []],
      ['megasave', 'file_0801', 0x0801, 0x0801 + demo.length - 2, 'the loader RUNs it', []],
    ]);
    expect(img.files[2].data).toEqual(demo.subarray(2));
  });

  it('keeps a file whose checksum does not fit, saying so; a table of the bytes 0 to 255 in other data is no file', () => {
    const w = new TurboWriter(38, 54);
    megaSaveFile(w, { load: 0x4000, data: bytes(1000, 5), sum: 0x5a ^ bytes(1000, 5).reduce((a, v) => a ^ v, 0) });
    const [f] = readTape(withTurbo(makeTap({ files: [] }), w.pulses)).files;
    expect([f.format, f.load, f.end, f.errors]).toEqual(['megasave', 0x4000, 0x4000 + 1000, ['checksum: the data could not be read cleanly']]);
    // another loader's data: the bytes 0 to 255 (one $63 before $64), then what reads as a header, data and its XOR
    const u = new TurboWriter(38, 54);
    const data = bytes(500, 6);
    u.bytes([...bytes(1500, 7), ...Array.from({ length: 256 }, (_, i) => i), 1, 0x00, 0x40, 0xf4, 0x41, 0, 0, 0, 1, 0, 0, ...data, data.reduce((a, v) => a ^ v, 0), ...bytes(1500, 8)]);
    const other = readTape(withTurbo(makeTap({ files: [] }), u.pulses));
    expect(other.files).toEqual([]);
    expect(other.unknown).toHaveLength(1);
    // a pilot of 7 bytes is not enough, 8 are
    for (const [pilot, n] of [[7, 0], [8, 1]]) {
      const s = new TurboWriter(38, 54);
      s.bytes(bytes(400, 9));
      megaSaveFile(s, { load: 0x2000, data: bytes(600, 10), pilot });
      expect(readTape(withTurbo(makeTap({ files: [] }), s.pulses)).files).toHaveLength(n);
    }
  });
});

describe('Novaload', () => {
  const page = (n: number) => bytes(256, n);

  it('reads its files: a pilot of 0 bits, a 1, $aa, the name, start less 256, end, the blocks with a running sum', () => {
    const w = new TurboWriter(37, 87);
    // a whole number of blocks (its last block holds 0 bytes), one with a last block of 100 bytes, one with no name
    novaFile(w, { name: 'B2', load: 0x4000, data: bytes(0x3200, 2) });
    novaFile(w, { name: 'SUB.SID', load: 0x0834, data: bytes(14284, 3) });
    novaFile(w, { load: 0xc000, data: bytes(100, 4) });
    // up to the top of memory: an end of $0000
    novaFile(w, { name: 'F', load: 0xf800, data: bytes(0x800, 5) });
    const img = readTape(withTurbo(makeTap({ files: [] }), w.pulses));
    expect(img.files.map(f => [f.format, f.name, f.type, f.load, f.end, f.errors])).toEqual([
      ['novaload', 'B2', 'PRG', 0x4000, 0x7200, []],
      ['novaload', 'SUB.SID', 'PRG', 0x0834, 0x0834 + 14284, []],
      ['novaload', 'file_c000', 'PRG', 0xc000, 0xc064, []],
      ['novaload', 'F', 'PRG', 0xf800, 0x10000, []],
    ]);
    expect(img.files[1].data).toEqual(bytes(14284, 3));
    expect([...img.files[0].raw!]).toEqual([0x42, 0x32]);
    expect(img.files[2].raw).toBeUndefined();
    expect(img.unknown).toEqual([]);
    expect(tapeFileName(img.files[1])).toBe('SUB.SID.prg');
  });

  it("reads what the boot file's loader reads: $55, then page after page up to a page 0; files are pages that follow on", () => {
    const w = new TurboWriter(37, 87);
    novaPages(w, [0xe0, 0xe1, 0xe2, 0xe3, 0xef, 0xf0, 0xfe, 0xff, 0x08, 0x09].map(p => ({ page: p, data: page(p) })));
    const img = readTape(withTurbo(makeTap({ files: [] }), w.pulses));
    expect(img.files.map(f => [f.format, f.name, f.load, f.end, f.note, f.errors])).toEqual([
      ['novaload', 'file_e000', 0xe000, 0xe400, "the boot file's loader reads it, 4 pages", []],
      ['novaload', 'file_ef00', 0xef00, 0xf100, "the boot file's loader reads it, 2 pages", []],
      ['novaload', 'file_fe00', 0xfe00, 0x10000, "the boot file's loader reads it, 2 pages", []],
      ['novaload', 'file_0800', 0x0800, 0x0a00, "the boot file's loader reads it, 2 pages", []],
    ]);
    expect(img.files[3].data).toEqual(new Uint8Array([...page(0x08), ...page(0x09)]));
    expect(img.unknown).toEqual([]);
  });

  it('keeps a block whose sum does not fit, saying so, and takes nothing from a short pilot or one page alone', () => {
    const w = new TurboWriter(37, 87);
    novaFile(w, { name: 'X', load: 0x1000, data: bytes(1000, 6), bad: 1 });
    novaPages(w, [0x20, 0x21, 0x22].map(p => ({ page: p, data: page(p) })), { bad: 1 });
    const img = readTape(withTurbo(makeTap({ files: [] }), w.pulses));
    expect(img.files.map(f => [f.name, f.load, f.end, f.errors])).toEqual([
      ['X', 0x1000, 0x1000 + 1000, ['checksum: the block at $1100 could not be read cleanly']],
      ['file_2000', 0x2000, 0x2300, ['checksum: the page at $2100 could not be read cleanly']],
    ]);
    // another loader's data with a pilot of a few dozen 0 bits before a 1 and $aa: no file, however its sums fit
    const s = new TurboWriter(37, 87);
    s.bytes(bytes(1500, 7));
    novaFile(s, { name: 'Y', load: 0x2000, data: bytes(600, 8), pilot: 200 });
    s.bytes(bytes(1500, 9));
    expect(readTape(withTurbo(makeTap({ files: [] }), s.pulses)).files).toEqual([]);
    // one page that adds up: other data now and then has one
    const one = new TurboWriter(37, 87);
    novaPages(one, [{ page: 0x30, data: page(0x30) }]);
    expect(readTape(withTurbo(makeTap({ files: [] }), one.pulses)).files).toEqual([]);
  });

  it('is fixtures/tap/novaload-demo.tap, which the e2e tests insert: pages for the boot file, then the demo', () => {
    const tape = novaloadDemoTape(demo);
    const path = join(__dirname, '../../../fixtures/tap/novaload-demo.tap');
    if (process.env.WRITE_FIXTURES) writeFileSync(path, tape);
    expect(new Uint8Array(readFileSync(path))).toEqual(tape);
    const img = readTape(tape);
    expect(img.unknown).toEqual([]);
    expect(img.files.map(f => [f.format, f.name, f.load, f.end, f.errors])).toEqual([
      ['cbm', 'NOVA DEMO', 0x0801, 0x0801 + 176, []],
      ['novaload', 'file_c000', 0xc000, 0xc200, []],
      ['novaload', 'file_e000', 0xe000, 0xe100, []],
      ['novaload', 'DEMO', 0x0801, 0x0801 + demo.length - 2, []],
    ]);
    expect(img.files[3].data).toEqual(demo.subarray(2));
  });
});

describe('Wildload', () => {
  /** Delta's speed: a 0 of 384 cycles, a 1 of 568 */
  const wild = () => new TurboWriter(48, 71);
  const tape = (w: TurboWriter) => readTape(withTurbo(makeTap({ files: [] }), w.pulses));
  const io = "stored with the I/O in ($01 = 5): its bytes at $d000-$dfff go to the VIC's and the CIAs' registers and the colour RAM";

  it('reads a chain: blocks one after another, each loaded from its last byte down, XOR the low byte of its address', () => {
    const w = wild();
    // the stretch starts with the bits 1, 0, 1: $a0 before a whole byte has gone in (Joystick 10's tape hung the reader
    // on it, going back to a pilot before the stretch again and again)
    w.bit(1); w.bit(0); w.bit(1);
    // Delta's chain (Thalamus): the tape buffer, the game's code in pieces, a byte at $0002 the boot waits for, and the
    // header with $fe; a block at the top of memory, one of a byte, registers with the I/O in and RAM under it
    wildChain(w, [
      { load: 0x033c, data: bytes(192, 1) },
      { load: 0xe000, data: bytes(0x1ffe, 2) },
      { load: 0x0002, data: Uint8Array.of(1) },
      { load: 0xd016, data: Uint8Array.of(0x18) },
      { load: 0xd011, data: Uint8Array.of(0x3b) },
      { load: 0xc800, data: bytes(0x1000, 3), flag: 0 },
      { load: 0xff00, data: bytes(256, 4) },
    ], { end: 0xff });
    wildChain(w, [{ load: 0x1000, data: bytes(0xaf00, 5) }, { load: 0x02a7, data: bytes(89, 6) }]);
    const img = tape(w);
    expect(img.files.map(f => [f.format, f.name, f.type, f.load, f.end, f.note, f.errors])).toEqual([
      ['wildload', 'file_033c', 'PRG', 0x033c, 0x03fc, undefined, []],
      ['wildload', 'file_e000', 'PRG', 0xe000, 0xfffe, undefined, []],
      ['wildload', 'file_0002', 'PRG', 0x0002, 0x0003, undefined, []],
      ['wildload', 'file_d016', 'PRG', 0xd016, 0xd017, io, []],
      ['wildload', 'file_d011', 'PRG', 0xd011, 0xd012, io, []],
      ['wildload', 'file_c800', 'PRG', 0xc800, 0xd800, 'stored with $01 = 0: into the RAM under the I/O', []],
      ['wildload', 'file_ff00', 'PRG', 0xff00, 0x10000, 'the loader looks for the next pilot after it (flag $ff)', []],
      ['wildload', 'file_1000', 'PRG', 0x1000, 0xbf00, undefined, []],
      ['wildload', 'file_02a7', 'PRG', 0x02a7, 0x0300, 'the end of the chain: the loader stops after it (flag $fe)', []],
    ]);
    expect(img.files[1].data).toEqual(bytes(0x1ffe, 2));
    expect(img.files[7].data).toEqual(bytes(0xaf00, 5));
    expect(img.unknown).toEqual([]);
    // the first block from its pilot, the next from its header right after the sum before it
    expect(img.files[1].at).toBe(img.files[0].to);
    expect(tapeFileName(img.files[0])).toBe('file_033c.prg');
  });

  it('keeps a later block whose sum does not fit and one the tape stops in, saying so; takes nothing else with the pilot $a0', () => {
    const w = wild();
    wildChain(w, [{ load: 0x0800, data: bytes(300, 1) }, { load: 0x2000, data: bytes(500, 2) }, { load: 0x4000, data: bytes(200, 3) }], { bad: 1, end: 0xff });
    w.pulses.push(0, 0x20, 0x4e, 0);
    wildChain(w, [{ load: 0x5000, data: bytes(100, 4) }, { load: 0x6000, data: bytes(1000, 5) }], { cut: 600 });
    const img = tape(w);
    expect(img.files.map(f => [f.name, f.load, f.end, f.errors])).toEqual([
      ['file_0800', 0x0800, 0x0800 + 300, []],
      ['file_2000', 0x2000, 0x2000 + 500, [`checksum: the data's XOR is $${bytes(500, 2).reduce((a, v) => a ^ v, 0).toString(16).padStart(2, '0')}, the tape says $${(bytes(500, 2).reduce((a, v) => a ^ v, 0) ^ 0x5a).toString(16).padStart(2, '0')}`]],
      ['file_4000', 0x4000, 0x4000 + 200, []],
      ['file_5000', 0x5000, 0x5000 + 100, []],
      // its top 600 bytes, as the loader stores them from the last one down
      ['file_6190', 0x6000 + 400, 0x6000 + 1000, ['the data runs past the end of the turbo stretch: 600 of its 1000 bytes are on it']],
    ]);
    expect(img.files[4].data).toEqual(bytes(1000, 5).subarray(400));
    // a first block whose sum does not fit, and a short pilot: no files
    const n = wild();
    wildChain(n, [{ load: 0x0800, data: bytes(300, 1) }, { load: 0x2000, data: bytes(500, 2) }], { bad: 0 });
    wildChain(n, [{ load: 0x0800, data: bytes(300, 1) }], { pilot: 20 });
    for (let i = 0; i < 256; i++) n.bytes([0x05]);
    expect(tape(n).files).toEqual([]);
  });

  it('is fixtures/tap/wildload-demo.tap, which the e2e tests insert: a chain as Delta\'s starts with the demo, then a table', () => {
    const t = wildloadDemoTape(demo);
    const path = join(__dirname, '../../../fixtures/tap/wildload-demo.tap');
    if (process.env.WRITE_FIXTURES) writeFileSync(path, t);
    expect(new Uint8Array(readFileSync(path))).toEqual(t);
    const img = readTape(t);
    expect(img.unknown).toEqual([]);
    expect(img.files.map(f => [f.format, f.name, f.load, f.end, f.errors])).toEqual([
      ['cbm', 'WILD DEMO', 0x029f, 0x029f + 97, []],
      ['wildload', 'file_033c', 0x033c, 0x03fc, []],
      ['wildload', 'file_d011', 0xd011, 0xd012, []],
      ['wildload', 'file_d800', 0xd800, 0xda00, []],
      ['wildload', 'file_0801', 0x0801, 0x0801 + demo.length - 2, []],
      ['wildload', 'file_c000', 0xc000, 0xc200, []],
    ]);
    expect(img.files[4].data).toEqual(demo.subarray(2));
  });
});

describe('Microload', () => {
  /** Bigtop Barney's speed: a 0 of 224 cycles, a 1 of 432 */
  const micro = () => new TurboWriter(28, 54);
  const tape = (w: TurboWriter) => readTape(withTurbo(makeTap({ files: [] }), w.pulses));

  it('reads its files: a pilot of $a0, $0a … $01, the start, the length as a negative number, the data up, their XOR', () => {
    const w = micro();
    // Bigtop Barney's first files (Interceptor Micros): the code that runs while the rest loads, a picture, the boot's
    // page again; one up to the top of memory, and Magic Bytes' longer pilot
    w.bit(1); w.bit(0); w.bit(1);
    microFile(w, { load: 0xe000, data: bytes(0x1c00, 1) });
    microFile(w, { load: 0x2000, data: bytes(0x2000, 2) });
    microFile(w, { load: 0x02a7, data: bytes(88, 3) });
    microFile(w, { load: 0xff00, data: bytes(256, 4) });
    microFile(w, { load: 0x0818, data: bytes(3000, 5), pilot: 857 });
    const img = tape(w);
    expect(img.files.map(f => [f.format, f.name, f.type, f.load, f.end, f.errors])).toEqual([
      ['microload', 'file_e000', 'PRG', 0xe000, 0xfc00, []],
      ['microload', 'file_2000', 'PRG', 0x2000, 0x4000, []],
      ['microload', 'file_02a7', 'PRG', 0x02a7, 0x02ff, []],
      ['microload', 'file_ff00', 'PRG', 0xff00, 0x10000, []],
      ['microload', 'file_0818', 'PRG', 0x0818, 0x0818 + 3000, []],
    ]);
    expect(img.files[1].data).toEqual(bytes(0x2000, 2));
    expect(img.unknown).toEqual([]);
  });

  it('keeps a file whose sum does not fit where the tape stops after it; takes nothing else, and no file inside one', () => {
    const w = micro();
    microFile(w, { load: 0x4000, data: bytes(1000, 1), bad: true });
    const img = tape(w);
    const x = bytes(1000, 1).reduce((a, v) => a ^ v, 0);
    expect(img.files.map(f => [f.name, f.load, f.end, f.errors])).toEqual([
      ['file_4000', 0x4000, 0x4000 + 1000, [`checksum: the data's XOR is $${x.toString(16).padStart(2, '0')}, the tape says $${(x ^ 0x5a).toString(16).padStart(2, '0')}`]],
    ]);
    // a sum that does not fit with the stretch going on after it, a short pilot, and Wildload's chain and Rainbow Arts'
    // block (a block number before the start), which have the same pilot and sync: no Microload files
    const n = micro();
    microFile(n, { load: 0x4000, data: bytes(1000, 1), bad: true, tail: [...bytes(200, 2)].flatMap(v => [v & 1, (v >> 1) & 1, (v >> 2) & 1, (v >> 3) & 1, (v >> 4) & 1, (v >> 5) & 1, (v >> 6) & 1, (v >> 7) & 1]) });
    microFile(n, { load: 0x4000, data: bytes(1000, 3), pilot: 20 });
    // Rainbow Arts' block: the pilot, the sync, its number 5, the start $5000, the length 1 000 as a negative number,
    // the data and their XOR
    const lsb = (v: number) => { for (let i = 0; i < 8; i++) n.bit((v >> i) & 1); };
    const ra = bytes(1000, 4);
    [...Array(992).fill(0xa0), 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0x05, 0x00, 0x50, 0x18, 0xfc, ...ra, ra.reduce((a, v) => a ^ v, 0)].forEach(lsb);
    expect(tape(n).files).toEqual([]);
    const wn = micro();
    wildChain(wn, [{ load: 0x0800, data: bytes(300, 1) }, { load: 0x2000, data: bytes(500, 2) }]);
    expect(tape(wn).files.map(f => f.format)).toEqual(['wildload', 'wildload']);
    // a Freeload file (the top bit first: pilot $40, sync $5a, start, end, data, XOR) in a Microload file's bits: its
    // data, not a file of its own (Ronald Rubberduck's $0800 holds one at $8040)
    const free = [0x40, 0x40, 0x40, 0x5a, 0x40, 0x80, 0x80, 0x80, ...bytes(64, 5), bytes(64, 5).reduce((a, v) => a ^ v, 0)];
    const fbits = free.flatMap(v => [7, 6, 5, 4, 3, 2, 1, 0].map(i => (v >> i) & 1));
    const packed = Array.from({ length: fbits.length / 8 }, (_, k) => fbits.slice(k * 8, k * 8 + 8).reduce((a, b, i) => a | (b << i), 0));
    const host = micro();
    microFile(host, { load: 0x0800, data: [...bytes(500, 6), ...packed, ...bytes(500, 7)] });
    expect(tape(host).files.map(f => [f.format, f.name])).toEqual([['microload', 'file_0800']]);
  });

  it('is fixtures/tap/microload-demo.tap, which the e2e tests insert: a table, the demo, a table', () => {
    const t = microloadDemoTape(demo);
    const path = join(__dirname, '../../../fixtures/tap/microload-demo.tap');
    if (process.env.WRITE_FIXTURES) writeFileSync(path, t);
    expect(new Uint8Array(readFileSync(path))).toEqual(t);
    const img = readTape(t);
    expect(img.unknown).toEqual([]);
    expect(img.files.map(f => [f.format, f.name, f.load, f.end, f.errors])).toEqual([
      ['cbm', 'MICRO DEMO', 0x02a7, 0x02a7 + 93, []],
      ['microload', 'file_e000', 0xe000, 0xe400, []],
      ['microload', 'file_0801', 0x0801, 0x0801 + demo.length - 2, []],
      ['microload', 'file_c000', 0xc000, 0xc200, []],
    ]);
    expect(img.files[2].data).toEqual(demo.subarray(2));
  });
});

describe('Cyberload', () => {
  const cyber = () => new TurboWriter(48, 90);
  const pause = cyberPause;
  const bootTape = () => makeTap({ files: [{ name: 'boot', load: 0x029f, data: bytes(156, 6), header: Uint8Array.from({ length: 171 }, (_, i) => (i * 13 + 5) & 0xff) }] });

  it('reads its four stages: the first after the boot file, the second with the keys in its code, blocks, files by name', () => {
    const boot = readTape(bootTape()).files[0];
    expect(boot.headerCode).toBe(true);
    const w = cyber();
    // the first stage: the second stage's code in the zero page, the tape header again, a part of its own; its RTS
    // takes $0001 off the stack, into $0002
    cyberFirstStage(w, [{ load: 0x0002, bytes: secondStageCode(0x9c, 0x7a) }, { load: 0x033c, bytes: boot.header!.subarray(0, 40) }, { load: 0x0392, bytes: [1, 2, 3] }], [0xff, 0x00, 0x01]);
    cyberSecondStage(w, 0xc000, bytes(600, 7), 0x9c, 0x7a);
    pause(w);
    // the third stage: a file of three blocks the loader calls into, one whose blocks are a stretch each (the tape
    // stops between them), the second all 0 bits
    cyberBlocks(w, 0xe000, bytes(600, 8), { call: 0xe003 });
    pause(w);
    const zeros = new Uint8Array(512);
    zeros.set(bytes(256, 9));
    cyberBlocks(w, 0x4000, zeros, { pause });
    // the fourth: the later header (with the speed, Tusker's), the earlier (The Last Ninja's), Myth's sync byte $55,
    // Accolade's names padded with zeros
    cyberNamedFile(w, { name: 'GAME', load: 0x0801, data: bytes(1000, 10), speed: 340 });
    pause(w);
    cyberNamedFile(w, { name: '0B', load: 0xb000, data: bytes(700, 11) });
    pause(w);
    cyberNamedFile(w, { name: 'M', load: 0xeffe, data: bytes(300, 12), speed: 340, sync: 0x55 });
    pause(w);
    cyberNamedFile(w, { name: 'TITLE.GRA', load: 0x2000, data: bytes(256, 13), pad: 0 });
    const img = readTape(withTurbo(bootTape(), w.pulses));
    expect(img.unknown).toEqual([]);
    expect(img.files.map(f => [f.format, f.name, f.load, f.end, f.errors])).toEqual([
      ['cbm', 'BOOT', 0x029f, 0x029f + 156, []],
      ['cyberload', 'file_0002', 0x0002, 0x0395, []],
      ['cyberload', 'file_c000', 0xc000, 0xc000 + 600, []],
      ['cyberload', 'file_e000', 0xe000, 0xe000 + 600, []],
      ['cyberload', 'file_4000', 0x4000, 0x4000 + 512, []],
      ['cyberload', 'GAME', 0x0801, 0x0801 + 1000, []],
      ['cyberload', '0B', 0xb000, 0xb000 + 700, []],
      ['cyberload', 'M', 0xeffe, 0xeffe + 300, []],
      ['cyberload', 'TITLE.GRA', 0x2000, 0x2000 + 256, []],
    ]);
    const [, first, second, blocks, zero, game] = img.files;
    // the first stage's bytes where it stored them, the boot file's between
    expect([...first.data.subarray(0, 23)]).toEqual(secondStageCode(0x9c, 0x7a));
    expect(first.data.subarray(0x029f - 2, 0x0314 - 2)).toEqual(boot.data.subarray(0, 0x0314 - 0x029f));
    expect([...first.data.subarray(0x0392 - 2)]).toEqual([1, 2, 3]);
    expect(first.note).toMatch(/stores \$0002-\$0018, \$033c-\$0363, \$0392-\$0394.*: \$0002$/);
    expect(second.data).toEqual(bytes(600, 7));
    expect(second.note).toMatch(/XOR \$9c, its bytes XOR \$7a/);
    expect(blocks.data).toEqual(bytes(600, 8));
    expect(blocks.note).toBe('third stage, 3 blocks; the loader calls $e003 after it');
    expect(zero.data).toEqual(zeros);
    expect(game.data).toEqual(bytes(1000, 10));
    expect(game.note).toBe('fourth stage (LOAD by name), sync $aa, 4 blocks, read with a timer of 510 cycles');
    expect(img.files[6].note).toBe('fourth stage (LOAD by name), sync $aa, 3 blocks');
    expect(tapeFileName(game)).toBe('GAME.prg');
  });

  it('is fixtures/tap/cyberload-demo.tap, which the e2e tests insert: the four stages, the demo the fourth one\'s file', () => {
    const tape = cyberloadDemoTape(demo);
    const path = join(__dirname, '../../../fixtures/tap/cyberload-demo.tap');
    if (process.env.WRITE_FIXTURES) writeFileSync(path, tape);
    expect(new Uint8Array(readFileSync(path))).toEqual(tape);
    const img = readTape(tape);
    expect(img.unknown).toEqual([]);
    expect(img.files.map(f => [f.format, f.name, f.load, f.end, f.errors])).toEqual([
      ['cbm', 'CYBER DEMO', 0x029f, 0x029f + 156, []],
      ['cyberload', 'file_0002', 0x0002, 0x0395, []],
      ['cyberload', 'file_c000', 0xc000, 0xc000 + 600, []],
      ['cyberload', 'file_e000', 0xe000, 0xe000 + 600, []],
      ['cyberload', 'DEMO', 0x0801, 0x0801 + demo.length - 2, []],
    ]);
    expect(img.files[4].data).toEqual(demo.subarray(2));
  });

  it('says which blocks do not check, and takes no header from data of one byte over and over', () => {
    const w = cyber();
    cyberBlocks(w, 0x1000, bytes(768, 2), { bad: 0x1100 });
    pause(w);
    // a "header" of $0f bytes after the pilot: its XOR is 0, as the blocks' after it are
    for (let i = 0; i < 300; i++) w.byte(0x0f);
    w.byte(0x0f);
    for (let i = 0; i < 2000; i++) w.byte(0x00);
    const img = readTape(withTurbo(makeTap({ files: [] }), w.pulses));
    expect(img.files.map(f => [f.name, f.load, f.data.length, f.errors])).toEqual([['file_1000', 0x1000, 768, ['checksum: the block at $1100 could not be read cleanly']]]);
    // a file by name whose header does not check is turbo data no format reads
    const u = cyber();
    cyberNamedFile(u, { name: 'GAME', load: 0x0801, data: bytes(3000, 3), speed: 340 });
    const t = withTurbo(makeTap({ files: [] }), u.pulses);
    const at = t.length - u.pulses.length + 8 * 9 + 3;
    t[at] = t[at] === 48 ? 90 : 48;
    const again = readTape(t);
    expect(again.files).toEqual([]);
    expect(again.unknown).toHaveLength(1);
  });

  it("reads a file of the tape's other side backwards where this side is blank, as far as it is not under this side's recording", () => {
    // side A: a boot file and a Freeload file; side B: a file by name, which side A's datasette hears last pulse first
    // after side A's recording, its end under that recording (Preservers' IK+: side B's "M" after a Novaload copy)
    const a = cyber();
    pilotFile(a, { pilot: 0x40, sync: 0x5a, load: 0x0801, data: bytes(600, 4) });
    const b = cyber();
    cyberNamedFile(b, { name: 'M', load: 0x0200, data: bytes(2000, 5), speed: 340 });
    const heard = b.pulses.slice().reverse();
    // hidden: the zeros after the last block, the last two blocks (208 and 256 bytes, each with its sum) and half of
    // the one before them, more than side A's file has after its sum
    const img = readTape(withTurbo(bootTape(), [...a.pulses, ...heard.slice(8 * 8 + 209 * 8 + 257 * 8 + 1000)]));
    expect(img.unknown).toEqual([]);
    expect(img.files.map(f => [f.format, f.name, f.load, f.end, f.errors, !!f.backwards])).toEqual([
      ['cbm', 'BOOT', 0x029f, 0x029f + 156, [], false],
      ['freeload', 'file_0801', 0x0801, 0x0801 + 600, [], false],
      ['cyberload', 'M', 0x0200, 0x0700, ['the tape has it from $0200 to $0700: its header says it ends at $09d0, the rest is not on the tape'], true],
    ]);
    const m = img.files[2];
    expect(m.data).toEqual(bytes(2000, 5).subarray(0, 0x500));
    expect(m.note).toBe("on the tape's other side, heard backwards where this side is blank (under this side's recordings it is not heard); fourth stage (LOAD by name), sync $aa, 8 blocks, read with a timer of 510 cycles");
    // its pulses: this side's, from where side A's file ends to the tape's end
    expect(m.at).toBeGreaterThanOrEqual(img.files[1].to);
    expect(m.to).toBe(tapPulses(withTurbo(bootTape(), [...a.pulses, ...heard.slice(8 * 8 + 209 * 8 + 257 * 8 + 1000)])).cycles.length);
    // no loader on this side loads it
    expect(tapeBoot(img, m)).toBeNull();
    // all of it, when this side is blank where it is
    const whole = readTape(withTurbo(bootTape(), heard));
    expect(whole.files.map(f => [f.name, f.load, f.end, f.errors, !!f.backwards])).toEqual([['BOOT', 0x029f, 0x029f + 156, [], false], ['M', 0x0200, 0x09d0, [], true]]);
    expect(whole.files[1].data).toEqual(bytes(2000, 5));
    // played forwards, a file the stretch ends in is not taken: the loader would read on past it
    const cut = readTape(withTurbo(bootTape(), b.pulses.slice(0, b.pulses.length - 8 * 8 - 209 * 8 - 300)));
    expect(cut.files.map(f => f.name)).toEqual(['BOOT']);
    expect(cut.unknown).toHaveLength(1);
  });

  it("is fixtures/tap/other-side-demo.tap, which the e2e tests insert: side A's files, then the demo from side B backwards", () => {
    const tape = otherSideDemoTape(demo);
    const path = join(__dirname, '../../../fixtures/tap/other-side-demo.tap');
    if (process.env.WRITE_FIXTURES) writeFileSync(path, tape);
    expect(new Uint8Array(readFileSync(path))).toEqual(tape);
    const img = readTape(tape);
    expect(img.unknown).toEqual([]);
    expect(img.files.map(f => [f.format, f.name, f.load, f.end, f.errors, !!f.backwards])).toEqual([
      ['cbm', 'SIDE A', 0x0801, 0x0801 + 300, [], false],
      ['freeload', 'file_c000', 0xc000, 0xc200, [], false],
      ['cyberload', 'DEMO', 0x0801, 0x0801 + demo.length - 2, [], true],
    ]);
    expect(img.files[2].data).toEqual(demo.subarray(2));
  });
});

describe("Firebird's loader", () => {
  // Bubble Bobble's speed: a 0 of 384 cycles, a 1 of 720
  const fire = () => new TurboWriter(48, 90);
  const tape = (w: TurboWriter) => readTape(withTurbo(makeTap({ files: [] }), w.pulses));
  const page = (n: number) => bytes(256, n);

  it("reads the first stage: a chain of blocks, each naming the next one's pilot; files are the memory they fill", () => {
    const w = fire();
    const loader = page(9);
    // Bubble Bobble's shape: 64 bytes at $0200, the program in blocks, the loader's own page again (twice), the last
    // block at $bf00, which the loader jumps to; the tape stops after each block but one
    firebirdChain(w, [
      { load: 0x0200, data: bytes(64, 1) }, { load: 0x1000, data: page(2) }, { load: 0x1100, data: page(3) },
      { load: 0x1c00, data: loader }, { load: 0x1200, data: page(4) }, { load: 0x1c00, data: loader }, { load: 0xbf00, data: page(5) },
    ], { pilot: 0x7e, loop: 0x1c41, jump: 0xbf00, pause: firebirdPause });
    const img = tape(w);
    expect(img.files.map(f => [f.format, f.name, f.type, f.load, f.end, f.note, f.errors])).toEqual([
      ['firebird', 'file_0200', 'PRG', 0x0200, 0x0240, 'first stage, 1 block', []],
      ['firebird', 'file_1000', 'PRG', 0x1000, 0x1300, 'first stage, 3 blocks', []],
      ['firebird', 'file_1c00', 'PRG', 0x1c00, 0x1d00, 'first stage, 1 block, loaded 2 times', []],
      ['firebird', 'file_bf00', 'PRG', 0xbf00, 0xc000, 'first stage, 1 block; the loader jumps to $bf00 after it', []],
    ]);
    expect(img.files[1].data).toEqual(new Uint8Array([...page(2), ...page(3), ...page(4)]));
    expect(img.files[2].data).toEqual(loader);
    expect(img.unknown).toEqual([]);
    expect(tapeFileName(img.files[1])).toBe('file_1000.prg');
  });

  it('reads the second kind: files of their own, a pilot each, up to the page their header names', () => {
    const w = fire();
    firebirdFile(w, { pilot: 0x34, load: 0x5800, data: bytes(1024, 6) });
    // the sum of its first block is the next one's pilot byte: that block's pilot does not reach back into it
    const data = bytes(512, 7);
    data[255] ^= data.subarray(0, 256).reduce((a, v) => a ^ v, 0) ^ 0x35;
    firebirdFile(w, { pilot: 0x35, load: 0x0400, data, jump: 0x0810 });
    // up to the top of memory: the page after it is 0 in the header (Blood Money's at $ef00, Cholo's at $e000)
    firebirdFile(w, { pilot: 0x36, load: 0xfe00, data: bytes(512, 16) });
    const img = tape(w);
    expect(img.files.map(f => [f.format, f.name, f.load, f.end, f.note, f.errors])).toEqual([
      ['firebird', 'file_5800', 0x5800, 0x5c00, 'pilot $34, 4 blocks; the loader returns after it', []],
      ['firebird', 'file_0400', 0x0400, 0x0600, 'pilot $35, 2 blocks; the loader jumps to $0810 after it', []],
      ['firebird', 'file_fe00', 0xfe00, 0x10000, 'pilot $36, 2 blocks; the loader returns after it', []],
    ]);
    expect(img.files[1].data).toEqual(data);
    expect(img.unknown).toEqual([]);
  });

  it('keeps a block whose sum does not fit where its chain or file goes on, says what is missing, and takes no single block', () => {
    const w = fire();
    firebirdChain(w, [{ load: 0x0200, data: bytes(64, 1) }, { load: 0x1000, data: page(2) }, { load: 0x1100, data: page(3) }, { load: 0x1200, data: page(4) }], { pilot: 0x6b, loop: 0xc041, jump: 0x1000, bad: 2 });
    firebirdFile(w, { pilot: 0x48, load: 0xc000, data: bytes(768, 8), bad: 1 });
    // blocks of a file missing: its last, then its first
    firebirdFile(w, { pilot: 0x50, load: 0xe000, data: bytes(768, 9), skip: [2] });
    firebirdFile(w, { pilot: 0x51, load: 0xf000, data: bytes(768, 10), skip: [0] });
    const img = tape(w);
    expect(img.files.map(f => [f.name, f.load, f.end, f.errors])).toEqual([
      ['file_0200', 0x0200, 0x0240, []],
      ['file_1000', 0x1000, 0x1300, ['checksum: the block at $1100 could not be read cleanly']],
      ['file_c000', 0xc000, 0xc300, ['checksum: the block at $c100 could not be read cleanly']],
      ['file_e000', 0xe000, 0xe200, ['it ends at $e200, its blocks up to $e300 are not on the tape']],
      ['file_f100', 0xf100, 0xf300, ['its first block is not on the tape']],
    ]);
    // one block of the first stage alone, or of a file it is not the whole of: data now and then holds a pilot, its
    // complement and a sum that fits
    const one = fire();
    one.bytes(bytes(800, 11));
    firebirdChain(one, [{ load: 0x0200, data: bytes(64, 1) }], { pilot: 0x6b, loop: 0xc041, jump: 0xc041 });
    one.bytes(bytes(800, 12));
    firebirdFile(one, { pilot: 0x22, load: 0x3000, data: bytes(768, 13), skip: [1, 2] });
    one.bytes(bytes(800, 14));
    expect(tape(one).files).toEqual([]);
    // a file of one block is whole: its header says it ends after it
    const whole = fire();
    firebirdFile(whole, { pilot: 0x22, load: 0x3000, data: bytes(256, 15) });
    expect(tape(whole).files.map(f => [f.name, f.load, f.end, f.errors])).toEqual([['file_3000', 0x3000, 0x3100, []]]);
  });

  it('is fixtures/tap/firebird-demo.tap, which the e2e tests insert: the first stage with the demo, then a file of the second kind', () => {
    const t = firebirdDemoTape(demo);
    const path = join(__dirname, '../../../fixtures/tap/firebird-demo.tap');
    if (process.env.WRITE_FIXTURES) writeFileSync(path, t);
    expect(new Uint8Array(readFileSync(path))).toEqual(t);
    const img = readTape(t);
    expect(img.unknown).toEqual([]);
    const end = 0x0801 + Math.ceil((demo.length - 2) / 256) * 256;
    expect(img.files.map(f => [f.format, f.name, f.load, f.end, f.errors])).toEqual([
      ['cbm', 'FIREBIRD DEMO', 0x02a7, 0x02a7 + 93, []],
      ['firebird', 'file_0200', 0x0200, 0x0240, []],
      ['firebird', 'file_0801', 0x0801, end, []],
      ['firebird', 'file_bf00', 0xbf00, 0xc000, []],
      ['firebird', 'file_c000', 0xc000, 0xc200, []],
    ]);
    expect(img.files[2].data.subarray(0, demo.length - 2)).toEqual(demo.subarray(2));
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

  it('runs a turbo file that does not run from where it loads from the tape\'s boot file, whose loader loads and starts it (Delta\'s chain)', () => {
    // a turbo file is a part of what its loader loads (a Wildload chain's block: Delta's file_1000, the packed game at
    // $1000-$beff), started by the loader elsewhere: SYS to where it loads hit a JAM, and Unpack found nothing
    const packed = fakePack(demo, 0x0810);
    const tape = loaderStartTape(packed, 0x080d);
    const path = join(__dirname, '../../../fixtures/tap/loader-start-demo.tap');
    if (process.env.WRITE_FIXTURES) writeFileSync(path, tape);
    expect(new Uint8Array(readFileSync(path))).toEqual(tape);
    const img = readTape(tape);
    expect(img.files.map(f => [f.format, f.name, f.load])).toEqual([['cbm', 'LOADER DEMO', 0x02a7], ['tapetool', 'TinyHeader file', 0x0800], ['tapetool', 'file 1', 0x4000]]);
    const [boot, file, jams] = img.files;
    // the KERNAL program before a turbo file is the boot file whose loader loads it; a KERNAL file is a program of its own
    expect(tapeBoot(img, file)).toBe(boot);
    expect(tapeBoot(img, jams)).toBe(boot);
    expect(tapeBoot(img, boot)).toBeNull();
    const withBoot = (f: TapeFile) => ({ tap: tape, at: f.to, boot: { name: boot.name, prg: makePrg(boot.load!, boot.data), at: boot.to } });
    const roms0 = findC64Roms();
    for (const roms of roms0 ? [null, roms0] : [null]) {
      // alone, as before: SYS $0800, a JAM
      expect(unpackPrg(makePrg(file.load!, file.data), roms, null, null, { tap: tape, at: file.to })).toMatchObject({ unpacked: false, stop: { reason: 'jam', pc: 0x0800 } });
      const run = unpackPrg(makePrg(file.load!, file.data), roms, null, null, withBoot(file));
      expect(run.boot).toEqual({ name: 'LOADER DEMO', after: 1, loading: [], alone: { entry: 0x0800, stop: expect.objectContaining({ reason: 'jam', pc: 0x0800 }) } });
      expect(run.layers.map(l => l.entry)).toEqual([0x0351, 0x080d, 0x0340, 0x0810]);
      expect(run.layers[1].tape).toBeGreaterThanOrEqual(file.to);
      expect(run.unpacked).toBe(true);
      // (with the JAM the loader put at $0800 in front of it)
      expect(run.saved).toMatchObject({ start: 0x0800, end: 0x37ff, entry: 0x0810 });
      expect(run.saved!.prg).toEqual(makePrg(0x0800, Uint8Array.from([0x02, ...demo.subarray(2)])));
      expect(unpackSummary(run)).toMatch(/^A loader on the tape loads it: Sindri ran the tape's boot file "LOADER DEMO", and after its loader had loaded it peels off 2 layers: an unknown mover at \$080d .*, then an unknown decoder at \$0340 .*; the program starts at \$0810$/);
      const log = unpackLog(run, 'tinyheader.prg', 0x0800, file.data.length).split('\n');
      expect(log).toContain('Alone, started at $0800, it stopped: jam, the CPU stopped on the JAM opcode at $0800');
      expect(log).toContain('A loader on the tape loads it: run from the tape\'s boot file "LOADER DEMO"; layer 1 on started after its loader had loaded the file');
      // (the tape's loader turned CIA 1's interrupts off and set its timer A: the program starts so, Saved.io)
      expect(log.at(-1)).toBe("saved layer 3: $0800-$37ff (12.0 KB), start with SYS 2064 = $0810, and the I/O it started in (5 steps: CIA 1's interrupts off, CIA 1's timer A)");

      // a file the boot's loader never gets to (a level the game loads later): the file's own run, and why
      const never = unpackPrg(makePrg(jams.load!, jams.data), roms, null, null, withBoot(jams));
      expect(never).toMatchObject({ unpacked: false, stop: { reason: 'jam', pc: 0x4000 }, boot: { name: 'LOADER DEMO', after: null } });
      expect(notPacked(never)).toBe(false);
      expect(unpackSummary(never)).toBe('Sindri peels off no layer (it stopped: jam, the CPU stopped on the JAM opcode at $4000); the tape\'s boot file "LOADER DEMO", run too, never loaded it');
      expect(unpackLog(never, 'file1.prg', 0x4000, 256)).toContain('The tape\'s boot file "LOADER DEMO", run too, never loaded it: its loader did not get past the file');

      // the program the loader starts runs as it is: not packed, with the reason
      const plain = readTape(loaderStartTape(demo, 0x0810));
      const notYet = unpackPrg(makePrg(0x0800, plain.files[1].data), roms, null, null, { tap: loaderStartTape(demo, 0x0810), at: plain.files[1].to, boot: { name: 'LOADER DEMO', prg: makePrg(0x02a7, plain.files[0].data), at: plain.files[0].to } });
      expect(notYet).toMatchObject({ unpacked: false, boot: { after: 1 }, stop: { reason: 'settled' } });
      expect(notPacked(notYet)).toBe(true);
      expect(unpackSummary(notYet)).toMatch(/^A loader on the tape loads it: Sindri ran the tape's boot file "LOADER DEMO", and the program its loader started after loading it ran as it is: not packed \(it stopped: settled/);
      expect(unpackLog(notYet, 'tinyheader.prg', 0x0800, 1).split('\n').at(-1)).toBe('not packed: the program its loader started ran as it is and never jumped into code it wrote');

      // a file that runs from where it loads is run so, as before (the boot file's own loader, here)
      expect(unpackPrg(makePrg(boot.load!, boot.data), roms, null, null, { tap: tape, at: boot.to }).boot).toBeUndefined();
    }
  });

  it('counts a loader stage the file holds, which loads the rest of the tape, as loading, not as unpacking it (Firetrack\'s second stage at $1000)', () => {
    // the boot's loader reads a second stage into $c000 (a JAM, then the loader at $c001) and starts it at $c001; that
    // reads the program into $0800 (a JAM, then the PRG) and starts it at `entry`
    const twoStages = (prg: Uint8Array, entry: number) => {
      const data = Uint8Array.from([0x02, ...prg.subarray(2)]);
      const stage = Uint8Array.from([0x02, ...tinyLoader(0xc001, 0x0800, 0x0800 + data.length, entry)]);
      const boot = bootLoader(0xc000, 0xc000 + stage.length, 0xc001);
      const w = new TurboWriter();
      w.leader(0xc0); tinyFile(w, stage); w.leader(0x40); tinyFile(w, data); w.leader(0x40);
      return withTurbo(makeTap({ files: [{ name: 'STAGES', load: 0x02a7, data: boot.data, header: boot.header }] }), w.pulses);
    };
    const roms0 = findC64Roms();
    for (const roms of roms0 ? [null, roms0] : [null]) {
      for (const [prg, entry, packed] of [[fakePack(demo, 0x0810), 0x080d, true], [demo, 0x0810, false]] as const) {
        const tape = twoStages(prg, entry), img = readTape(tape);
        const [boot, stage] = img.files;
        expect([stage.format, stage.load]).toEqual(['tapetool', 0xc000]);
        const run = unpackPrg(makePrg(stage.load!, stage.data), roms, null, null, { tap: tape, at: stage.to, boot: { name: boot.name, prg: makePrg(boot.load!, boot.data), at: boot.to } });
        expect(run.layers.map(l => l.entry)).toEqual(packed ? [0x0351, 0xc001, 0x080d, 0x0340, 0x0810] : [0x0351, 0xc001, 0x0810]);
        // the second stage began after the tape had passed the file, and loaded the program while it ran
        expect(run.boot).toMatchObject({ name: 'STAGES', after: 1, loading: [1], alone: { entry: 0xc000, stop: { reason: 'jam', pc: 0xc000 } } });
        expect(run.unpacked).toBe(packed);
        expect(notPacked(run)).toBe(!packed);
        expect(unpackSummary(run)).toMatch(packed ? /after its loader had loaded it peels off 2 layers: an unknown mover at \$080d .*, then an unknown decoder at \$0340 / : /the program its loader started after loading it ran as it is: not packed/);
        expect(unpackLog(run, 'stage.prg', 0xc000, stage.data.length)).toContain('layer 1 on started after its loader had loaded the file (layer 1: the loader going on, loading more of the tape)');
      }
    }
  });
});
