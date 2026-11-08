/* T64 tape archives (spec 13.5j): the header and the directory as VICE reads them (every entry of type 1, ends that
 * are wrong taken as far as the bytes go), makeT64 and writeT64 (Build & Run writes the files built from it back), the
 * fixture, and Sindri with a T64 in its datasette: the boot file's LOAD from the tape loads the next file and starts it. */
import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { isT64, makePrg, makeT64, makeTap, readT64, readTape, t64Info, tapeFileName, unpackPrg, writeT64 } from '../src';
import { t64Files } from '@mimir/sindri';
import { demoT64, sine, t64Boot } from './helpers/t64-demo';

const demo = new Uint8Array(readFileSync(join(__dirname, '../../../fixtures/prg/raster-demo.prg')));
const bytes = (n: number, seed = 1) => Uint8Array.from({ length: n }, (_, i) => (i * 31 + seed * 7) & 0xff);
/** a directory entry's bytes at slot `i` */
const entry = (t: Uint8Array, i: number) => 0x40 + 32 * i;

describe('the T64 header', () => {
  it('knows a T64 by its signature line, and a TAP, a PRG or a web page named .t64 as none', () => {
    const t = makeT64({ name: 'TAPE', files: [{ name: 'A', load: 0x0801, data: bytes(10) }] });
    expect(isT64(t)).toBe(true);
    for (const sig of ['C64 tape image file', 'C64S tape file\r\n*Conv 64*', 'C64 TAPE IMAGE']) {
      const u = t.slice(); u.fill(0, 0, 32); u.set([...sig].map(c => c.charCodeAt(0)));
      expect(isT64(u), sig).toBe(true);
    }
    expect(isT64(makeTap({ files: [{ name: 'A', load: 0x0801, data: bytes(10) }] }))).toBe(false);
    expect(isT64(Uint8Array.from([0x01, 0x08, ...bytes(200)]))).toBe(false);
    expect(isT64(new TextEncoder().encode(`<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.01//EN">${' '.repeat(100)}`))).toBe(false);
    expect(isT64(t.subarray(0, 0x50))).toBe(false);
    expect(t64Info(t)).toMatchObject({ signature: 'C64S tape image file', version: 0x0101, max: 1, used: 1, name: 'TAPE' });
  });
});

describe('the directory', () => {
  it('reads back what makeT64 writes: names, addresses, bytes, entries in their order', () => {
    const files = [{ name: 'BOOT', load: 0x0801, data: bytes(300) }, { name: 'Part 2', load: 0x4000, data: bytes(1000, 2) }, { name: 'TOP', load: 0xff00, data: bytes(256, 3) }];
    const t = makeT64({ name: 'MY TAPE', files });
    const img = readT64(t);
    expect(img.t64?.name).toBe('MY TAPE');
    expect([img.pulses, img.seconds, img.unknown, img.tapetool]).toEqual([0, 0, [], null]);
    expect(img.files.map(f => [f.format, f.name, f.type, f.load, f.end, f.at, f.to, f.id, f.t64?.fileType, f.errors, f.note])).toEqual([
      ['t64', 'BOOT', 'PRG', 0x0801, 0x0801 + 300, 0, 1, 1, 0x82, [], undefined],
      ['t64', 'PART 2', 'PRG', 0x4000, 0x4000 + 1000, 1, 2, 2, 0x82, [], undefined],
      // an end of 0: up to the top of memory
      ['t64', 'TOP', 'PRG', 0xff00, 0x10000, 2, 3, 3, 0x82, [], undefined],
    ]);
    img.files.forEach((f, i) => expect(f.data).toEqual(files[i].data));
    expect(img.files.map(f => f.offset)).toEqual([0x40 + 96, 0x40 + 96 + 300, 0x40 + 96 + 1300]);
    // readTape takes a T64 too, and the files save under their names
    expect(readTape(t)).toEqual(img);
    expect(img.files.map(tapeFileName)).toEqual(['BOOT.prg', 'PART 2.prg', 'TOP.prg']);
  });

  it('reads every entry of type 1, whatever the header says is used, and skips the free ones', () => {
    const one = makeT64({ files: [{ name: 'A', load: 0x0801, data: bytes(40) }, { name: 'B', load: 0x1000, data: bytes(50) }] });
    // room for 30 entries, the second file in slot 5, "0 used": the header of many T64s in the wild
    const dir = 0x40 + 30 * 32, t = new Uint8Array(dir + 90);
    t.set(one.subarray(0, 0x40));
    t.set([30, 0, 0, 0], 0x22);
    t.set(one.subarray(entry(one, 0), entry(one, 0) + 32), entry(t, 0));
    t.set(one.subarray(entry(one, 1), entry(one, 1) + 32), entry(t, 5));
    t.set([dir & 0xff, dir >> 8, 0, 0], entry(t, 0) + 8);
    t.set([(dir + 40) & 0xff, (dir + 40) >> 8, 0, 0], entry(t, 5) + 8);
    t.set(one.subarray(0x40 + 64), dir);
    // a slot of text is no entry
    t.set([0x47, 0x30, 0x41, 0x42], entry(t, 9));
    const img = readT64(t);
    expect(img.files.map(f => [f.name, f.at, f.id, f.data.length])).toEqual([['A', 0, 1, 40], ['B', 5, 6, 50]]);
    expect(img.t64?.used).toBe(0);
  });

  it('takes a file as far as its bytes go when its end is wrong: $c3c6, past the next file, before its start', () => {
    const t = makeT64({ files: [{ name: 'A', load: 0x0801, data: bytes(100) }, { name: 'B', load: 0x2000, data: bytes(200) }, { name: 'C', load: 0x3000, data: bytes(50) }] });
    t.set([0xc6, 0xc3], entry(t, 0) + 4);
    t.set([0x00, 0x30], entry(t, 1) + 4);
    t.set([0x00, 0x20], entry(t, 2) + 4);
    const img = readT64(t);
    expect(img.files.map(f => [f.load, f.end, f.data.length])).toEqual([[0x0801, 0x0801 + 100, 100], [0x2000, 0x2000 + 200, 200], [0x3000, 0x3000 + 50, 50]]);
    expect(img.files[0].note).toMatch(/the directory's end \$c3c6 is wrong .*: the 100 bytes up to the next file are taken/);
    expect(img.files[1].note).toBe('the directory gives $2000-$3000 (4096 bytes), the T64 holds 200: those are taken');
    expect(img.files[2].note).toMatch(/an end before its start: the 50 bytes up to the end of the T64 are taken/);
    // an end short of the bytes: the file is what the end says (the rest is padding)
    const p = makeT64({ files: [{ name: 'A', load: 0x0801, data: bytes(100) }] });
    p.set([0x01 + 60, 0x08], entry(p, 0) + 4);
    expect(readT64(p).files[0].data).toEqual(bytes(100).subarray(0, 60));
    // a T64 cut short: its file is what is there
    expect(readT64(t.subarray(0, t.length - 20)).files[2].data.length).toBe(30);
  });

  it('lists a C64S snapshot without opening it, and says where a file\'s bytes are not', () => {
    const t = makeT64({ files: [{ name: 'GAME', load: 0x0801, data: bytes(64) }, { name: 'FROZEN', load: 0, data: bytes(64, 2), type: 3, fileType: 0 }, { name: 'GONE', load: 0x1000, data: bytes(8, 3) }] });
    t.set([0xff, 0xff, 0, 0], entry(t, 2) + 8);
    const img = readT64(t);
    expect(img.files.map(f => [f.name, f.type, f.load, f.data.length])).toEqual([['GAME', 'PRG', 0x0801, 64], ['FROZEN', 'DATA', null, 64 + 8], ['GONE', 'PRG', 0x1000, 0]]);
    expect(img.files[1].note).toMatch(/C64S memory snapshot/);
    expect(img.files[2].errors[0]).toMatch(/past the end of the T64/);
  });

  it('reads the files as Sindri\'s datasette does: the same slots, addresses and bytes', () => {
    const t = demoT64(demo);
    const mine = readT64(t).files, s = t64Files(t);
    expect(s.map(f => [f.at, f.to, f.start, f.data.length])).toEqual(mine.map(f => [f.at, f.to, f.load, f.data.length]));
    s.forEach((f, i) => expect(f.data).toEqual(mine[i].data));
  });
});

describe('writing a T64', () => {
  it('writes it again as it was, and with the files built written back, from the slot asked for', () => {
    const t = demoT64(demo);
    const img = readT64(t);
    // nothing built: the same files, the same names and tape name (the $c3c6 end comes out right)
    const again = readT64(writeT64(t));
    expect(again.files.map(f => [f.name, f.load, f.end, f.data.length])).toEqual(img.files.map(f => [f.name, f.load, f.end, f.data.length]));
    expect(again.t64?.name).toBe('MIMIR T64');
    expect(again.files.every(f => !f.note)).toBe(true);
    // the demo built again, longer and somewhere else: its entry follows it, the others stay
    const built = makePrg(0x0900, bytes(5000));
    const w = readT64(writeT64(t, new Map([[1, built]])));
    expect(w.files.map(f => [f.name, f.load, f.end])).toEqual([['MIMIR BOOT', 0x0801, img.files[0].end], ['MIMIR DEMO', 0x0900, 0x0900 + 5000], ['MIMIR SINE', 0x4000, 0x4200]]);
    expect(w.files[1].data).toEqual(bytes(5000));
    expect(w.files[2].data).toEqual(sine());
    // from the demo on: VICE's autostart loads the first file
    expect(readT64(writeT64(t, new Map([[1, built]]), 1)).files.map(f => f.name)).toEqual(['MIMIR DEMO', 'MIMIR SINE']);
  });
});

describe('the fixture and Sindri', () => {
  it('reads fixtures/t64/mimir-demo.t64: the boot file, the demo it loads, the sine table with its $c3c6 end', () => {
    const t = demoT64(demo);
    const path = join(__dirname, '../../../fixtures/t64/mimir-demo.t64');
    if (process.env.WRITE_FIXTURES) writeFileSync(path, t);
    expect(new Uint8Array(readFileSync(path))).toEqual(t);
    const img = readTape(t);
    expect(img.files.map(f => [f.name, f.load, f.end, !!f.note])).toEqual([
      ['MIMIR BOOT', 0x0801, 0x0801 + t64Boot('MIMIR DEMO', 0x0810).length, false],
      ['MIMIR DEMO', 0x0801, 0x0801 + demo.length - 2, false],
      ['MIMIR SINE', 0x4000, 0x4200, true],
    ]);
    expect(img.files[1].data).toEqual(demo.subarray(2));
  });

  it('Sindri runs the boot file with the T64 in its datasette: LOAD from the tape loads the demo, which it starts', () => {
    const t = demoT64(demo);
    const boot = readT64(t).files[0];
    const run = unpackPrg(makePrg(boot.load!, boot.data), null, null, null, { tap: t, at: boot.to });
    expect(run.tape).toBe('datasette: a T64 of 3 files, the tape stood after the file (before file 2), now before file 3');
    expect(run.unpacked).toBe(true);
    expect(run.saved!.entry).toBe(0x0810);
    const saved = run.saved!.prg, at = 0x0801 - run.saved!.start + 2;
    expect([...saved.subarray(at, at + demo.length - 2)]).toEqual([...demo.subarray(2)]);
  });
});
