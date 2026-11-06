import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decruncherNeeds, findSys, LONG_SECONDS, PAL_HZ, ramFor, sfx } from '../src/sfx.ts';
import { EXOMIZER, basicProgram, programLike, rng } from './tools.ts';

// sfx() runs every file it makes in an emulated C64 and compares the memory with the program; these tests make
// files for programs in different places and check what it reports.
const area = (r: ReturnType<typeof sfx>, name: string) => r.areas.find(a => a.name === name)!;

describe('self-extracting files', () => {
  it('start a program at $0801 by its SYS, with the decruncher in the stack page', () => {
    const prog = basicProgram(programLike(20000, 2), 2064);
    const r = sfx(prog, 0x0801);
    expect(r.entry).toBe(2064);
    expect(r.prg[0] | (r.prg[1] << 8)).toBe(0x0801);
    expect(findSys(a => r.prg[a - 0x0801 + 2] ?? 0)).toBe(0x080d);
    expect(area(r, 'Decruncher').start).toBe(0x0100);
    expect(area(r, 'Decrunch table').start).toBe(0x0334);
    expect(r.ramDuring).toBe(0x37);
    expect(r.effect).toBe(true);
    expect(r.prg.length).toBeLessThan(prog.length / 2);
  });

  it('switch I/O out for data under it, and leave $01 and interrupts as told', () => {
    const prog = programLike(0xf000 - 0x1000, 3);
    const r = sfx(prog, 0x1000, { start: 0x1000, ramExit: 0x35, irqExit: false });
    expect(r.ramDuring).toBe(0x34);
    expect(r.effect).toBe(false);
    expect(r.ramExit).toBe(0x35);
    expect(r.irqExit).toBe(false);
    expect(r.warnings.join()).toMatch(/I\/O is switched out/);
  });

  it('move the stream of a program that loads below $0801, with the start past the program', () => {
    // hardly crunchable: the file ends past the program, where the start's move loops count on in their own code
    const r = rng(17), data = Uint8Array.from({ length: 6000 }, (_, i) => (i % 5 ? Math.floor(r() * 256) : 0));
    for (const format of ['exomizer', 'fast'] as const) {
      const s = sfx(data, 0x0700, { start: 0x0700, format });
      expect(area(s, 'File').end).toBeGreaterThan(0x0700 + data.length);
    }
  });

  it('find room when the program covers the screen and $0334', () => {
    const r = sfx(programLike(0xc000 - 0x0300, 4), 0x0300, { start: 0x0300 });
    const dec = area(r, 'Decruncher'), table = area(r, 'Decrunch table');
    for (const a of [dec, table]) expect(a.end <= 0x0300 || a.start >= 0xc000).toBe(true);
  });

  it('keep the decruncher, its tables and zero page where they are told, and out of memory to keep free', () => {
    const prog = basicProgram(programLike(20000, 2), 2064);
    const told = sfx(prog, 0x0801, { place: { zp: 0x22, decruncher: 0xc000, tables: 0xc400 } });
    expect(area(told, 'Decruncher')).toMatchObject({ start: 0xc000, note: 'zero page $22-$2a' });
    expect(area(told, 'Decrunch table').start).toBe(0xc400);
    const kept = sfx(prog, 0x0801, { place: { keep: [[0x0100, 0x0200], [0x0334, 0x0400]] } });
    for (const a of [area(kept, 'Decruncher'), area(kept, 'Decrunch table'), area(kept, 'Crunched data')]) {
      expect(a.end <= 0x0100 || (a.start >= 0x0200 && a.end <= 0x0334) || a.start >= 0x0400).toBe(true);
    }
    // the tables of Brokkr's own format at the start of the pages after it
    const own = sfx(prog, 0x0801, { format: 'brokkr', place: { tables: 0xc080 } });
    expect(area(own, 'Probabilities').start).toBe(0xc100);
    expect(area(own, 'Quarter squares').start).toBe(0xc300);
  });

  it('say what their decruncher takes before anything is crunched, as the files they make take it', () => {
    const prog = basicProgram(programLike(20000, 2), 2064);
    for (const format of ['exomizer', 'brokkr', 'fast'] as const) {
      const needs = decruncherNeeds({ format });
      const r = sfx(prog, 0x0801, { format });
      const dec = area(r, 'Decruncher'), zp = /zero page \$([0-9a-f]+)-\$([0-9a-f]+)/.exec(dec.note!)!;
      expect(dec.end - dec.start).toBeGreaterThanOrEqual(needs.resident.min);
      expect(dec.end - dec.start).toBeLessThanOrEqual(needs.resident.max);
      expect(parseInt(zp[2], 16) - parseInt(zp[1], 16) + 1).toBe(needs.zp);
      const tables = r.areas.filter(a => ['Decrunch table', 'Probabilities', 'Quarter squares'].includes(a.name)).reduce((n, a) => n + a.end - a.start, 0);
      expect(tables).toBeGreaterThanOrEqual(needs.tables.min);
      expect(tables).toBeLessThanOrEqual(needs.tables.max);
    }
    expect(decruncherNeeds({ format: 'fast', start: 'basic' }).resident.max).toBeGreaterThan(decruncherNeeds({ format: 'fast' }).resident.max);
  });

  it('say what is in the way of where they are told to go', () => {
    const prog = basicProgram(programLike(8000, 2), 2064);
    expect(() => sfx(prog, 0x0801, { place: { decruncher: 0x1000 } })).toThrow(/decruncher .* at \$1000.* lies in the program \$0801/);
    expect(() => sfx(prog, 0x0801, { place: { decruncher: 0xe000 } })).toThrow(/under ROM or I\/O once \$01 is \$37/);
    expect(() => sfx(prog, 0x0801, { place: { decruncher: 0xc000, keep: [[0xc000, 0xd000]] } })).toThrow(/lies in \$c000–\$cfff, which it is to keep free/);
    expect(() => sfx(prog, 0x0801, { place: { zp: 0xfa } })).toThrow(/zero page bytes from \$fa do not fit/);
    expect(() => sfx(prog, 0x0801, { place: { zp: 0x22, decruncher: 0xc000, tables: 0xc000 } })).toThrow(/overlap/);
  });

  it('take this many bytes besides the stream: the BASIC line, the start and the decruncher', () => {
    // every byte the code around the stream gains or loses shows here
    const basic = basicProgram(programLike(20000, 2), 2064), high = programLike(0xc000 - 0x1000, 3);
    const overhead = (data: Uint8Array, load: number, o: Parameters<typeof sfx>[2]) => { const r = sfx(data, load, o); return r.prg.length - r.stream.length; };
    expect([overhead(basic, 0x0801, {}), overhead(basic, 0x0801, { format: 'brokkr' }), overhead(basic, 0x0801, { format: 'fast' })]).toEqual([357, 586, 262]);
    expect([overhead(high, 0x1000, { start: 0x1000 }), overhead(high, 0x1000, { start: 0x1000, format: 'brokkr' }), overhead(high, 0x1000, { start: 0x1000, format: 'fast' })]).toEqual([354, 583, 259]);
  });

  it('take the smallest of the formats, or the smallest that decrunches in time (auto)', () => {
    const prog = basicProgram(programLike(12000, 2), 2064);
    const each = Object.fromEntries((['exomizer', 'brokkr', 'fast'] as const).map(format => [format, sfx(prog, 0x0801, { format })]));
    const auto = sfx(prog, 0x0801, { format: 'auto' });
    expect(auto.tried?.map(t => t.format)).toEqual(['exomizer', 'brokkr', 'fast']);
    expect(auto.format).toBe('brokkr');
    expect(auto.prg).toEqual(each.brokkr.prg);
    // Brokkr's own format takes longest, and says so when that is more than LONG_SECONDS
    expect(each.brokkr.cycles).toBeGreaterThan(5 * each.exomizer.cycles);
    expect(each.exomizer.warnings.join()).not.toMatch(/Decrunching takes/);
    const big = sfx(basicProgram(programLike(20000, 2), 2064), 0x0801, { format: 'brokkr' });
    expect(big.cycles / PAL_HZ).toBeGreaterThan(LONG_SECONDS);
    expect(big.warnings.join()).toMatch(/Decrunching takes \d+\.\d s on a PAL C64: Brokkr's own format is the slowest/);
    // within 2 s: the smaller of the two that are that quick
    const quick = sfx(prog, 0x0801, { format: 'auto', maxSeconds: 2 });
    expect(quick.prg.length).toBe(Math.min(each.exomizer.prg.length, each.fast.prg.length));
    expect(quick.format).not.toBe('brokkr');
    const none = sfx(prog, 0x0801, { format: 'auto', maxSeconds: 0.05 });
    expect(none.format).toBe('fast');
    expect(none.warnings.join()).toMatch(/No format decrunches within 0\.05 s: the fastest, Brokkr's fast one/);
    // the decruncher's needs, whichever it takes
    expect(decruncherNeeds({ format: 'auto' })).toMatchObject({ tables: { min: 0, max: 1536, align: 256 }, zp: 12 });
  });

  it('run a BASIC program with RUN', () => {
    const r = sfx(basicProgram(programLike(3000, 5)), 0x0801, { start: 'basic' });
    expect(r.basic).toBe(true);
    expect(r.ramExit).toBe(0x37);
  });

  it('crunch with a table for length 3 when it is smaller', () => {
    const prog = basicProgram(programLike(12000, 6));
    const auto = sfx(prog, 0x0801, { fourTables: 'auto' });
    const three = sfx(prog, 0x0801);
    expect(auto.prg.length).toBeLessThanOrEqual(three.prg.length);
  });

  it('say what is wrong when they cannot be made', () => {
    expect(() => sfx(programLike(100, 1), 0x0801)).toThrow(/no SYS/);
    expect(() => sfx(programLike(100, 1), 0x2000)).toThrow(/not at \$0801/);
    expect(() => sfx(programLike(0x300, 1), 0x0100, { start: 0x0100 })).toThrow(/top of the stack/);
    const r = rng(9), noise = Uint8Array.from({ length: 0xd000 }, () => Math.floor(r() * 256));
    expect(() => sfx(noise, 0x2000, { start: 0x2000 })).toThrow(/BRK-E1|\$d000/);
  });

  it('know which $01 makes memory RAM', () => {
    expect(ramFor([[0x0801, 0x9fff]])).toBe(0x37);
    expect(ramFor([[0x0801, 0xb000]])).toBe(0x36);
    expect(ramFor([[0xe000, 0xe100]])).toBe(0x35);
    expect(ramFor([[0xc000, 0xd001]])).toBe(0x34);
  });
});

describe.skipIf(!EXOMIZER)('against Exomizer 3.1.1', () => {
  it('Exomizer\'s desfx decrunches a Brokkr file to the same program', () => {
    const dir = mkdtempSync(join(tmpdir(), 'brokkr-sfx-'));
    const prog = basicProgram(programLike(15000, 8), 2064);
    writeFileSync(join(dir, 'b.prg'), sfx(prog, 0x0801).prg);
    const out = execFileSync(EXOMIZER!, ['desfx', '-o', join(dir, 'd.prg'), join(dir, 'b.prg')], { encoding: 'utf8' });
    expect(out).toMatch(/entry1? at \$0810/i);
    const d = new Uint8Array(readFileSync(join(dir, 'd.prg')));
    const load = d[0] | (d[1] << 8), off = 0x0801 - load;
    expect(d.subarray(2 + off, 2 + off + prog.length)).toEqual(prog);
  });
});
