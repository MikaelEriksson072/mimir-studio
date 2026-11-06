import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assemble } from '../src/asm.ts';
import { checkDecruncher, checkMem, decruncherFile } from '../src/decrunch-file.ts';
import { Machine } from '../src/emulate.ts';
import { CheckError } from '../src/errors.ts';
import { mem, memBrk, memFast, memFile } from '../src/files.ts';
import { crunchData } from '../src/crunch.ts';
import { P } from '../src/format.ts';
import { programLike } from './tools.ts';

// One decruncher for many mem files: each file is run through the same PRG in the emulated C64.
const crunch = async (format: 'exomizer' | 'brokkr' | 'fast', data: Uint8Array, start: number) => {
  const r = format === 'brokkr' ? memBrk(data, start) : format === 'fast' ? memFast(data, start) : await mem(data, start);
  return { start: r.at!.start, bytes: r.bytes.subarray(2) };
};

describe('the decruncher as a file of its own', () => {
  for (const format of ['exomizer', 'brokkr', 'fast'] as const) {
    it(`decrunches every file of its format (${format})`, async () => {
      const d = decruncherFile({ format });
      expect(d.prg[0] | (d.prg[1] << 8)).toBe(0xc000);
      expect(d.entry).toBe(0xc000);
      expect(d.source).not.toMatch(/^\* =/m);
      expect(d.zp.end).toBe(0x100);
      for (const [start, seed] of [[0x1000, 1], [0x4000, 2], [0x8000, 3]]) {
        const data = programLike(6000, seed);
        expect(checkDecruncher(d, await crunch(format, data, start), { start, bytes: data }).port).toBe(0x37);
      }
    });
  }

  it('goes where it is told, with its zero page and tables', async () => {
    const d = decruncherFile({ format: 'exomizer', at: 0x9000, zp: 0x22, table: 0x0400 });
    expect(d.source).toMatch(/^\* = \$9000$/m);
    expect(d.source).toMatch(/^\.const ZP = \$22/m);
    expect(d).toMatchObject({ start: 0x9000, entry: 0x9000, zp: { start: 0x22, end: 0x2b }, tables: { start: 0x0400, end: 0x049c } });
    const data = programLike(5000, 4);
    checkDecruncher(d, await crunch('exomizer', data, 0x2000), { start: 0x2000, bytes: data });
    // Brokkr's own format: its tables on the page after it, 0.5 KB of them when small
    const own = decruncherFile({ format: 'brokkr', small: true });
    expect(own.tables).toEqual({ start: (own.end + 0xff) & 0xff00, end: ((own.end + 0xff) & 0xff00) + 512 });
    checkDecruncher(own, await crunch('brokkr', data, 0x2000), { start: 0x2000, bytes: data });
  });

  it('says what is wrong', async () => {
    expect(() => decruncherFile({ zp: 0xfa })).toThrow(/9 zero page bytes from \$fa do not fit/);
    expect(() => decruncherFile({ at: 0xff00 })).toThrow(/does not fit from \$ff00/);
    expect(() => decruncherFile({ at: 0xc000, table: 0xc100 })).toThrow(/tables .* lie over the decruncher/);
    expect(() => decruncherFile({ format: 'brokkr', table: 0xc080 })).toThrow(/start a page/);
    const data = programLike(5000, 5);
    expect(() => checkDecruncher(decruncherFile({ at: 0x2400 }), { start: 0x6000, bytes: new Uint8Array(10) }, { start: 0x2000, bytes: data }, 'level1.prg'))
      .toThrow(/level1\.prg decrunches to \$2000–\$3387, over the decruncher \(\$2400–\$2542\)/);
  });

  it('is written by `brokkr decruncher`, as source or as a PRG', () => {
    const dir = mkdtempSync(join(tmpdir(), 'brokkr-dec-')), cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
    const out = execFileSync(process.execPath, [cli, 'decruncher', '--format', 'fast', '--at', '$9000', '-o', join(dir, 'd.prg')], { encoding: 'utf8' });
    expect(out).toMatch(/d\.prg: Brokkr's decruncher of its fast format at \$9000–\$90e0 \(225 bytes\): set stream \(\$fc\)/);
    expect(new Uint8Array(readFileSync(join(dir, 'd.prg')))).toEqual(decruncherFile({ format: 'fast', at: 0x9000 }).prg);
    execFileSync(process.execPath, [cli, 'decruncher', '-o', join(dir, 'd.asm')]);
    expect(readFileSync(join(dir, 'd.asm'), 'utf8')).toBe(decruncherFile().source);
  });
});

describe('the checks in the emulated C64', () => {
  it("mark what a program writes, start from noise when told, and keep the stack's lowest", () => {
    const m = new Machine(7);
    expect(new Machine().ram.every(b => b === 0)).toBe(true);
    expect(m.ram.some(b => b !== 0)).toBe(true);
    const code = assemble('* = $1000\n lda #1\n sta $c000\n sta $c001\n pha\n pla\n sta $d020\n jmp *');
    m.ram.set(code.bytes, 0x1000);
    m.cpu.s = 0xf6;
    m.run(0x1000, pc => pc === code.end - 3, 1000);
    // the border is I/O, not RAM; the stack is RAM
    expect(m.writtenOutside([[0x01e0, 0x0200]])).toEqual({ first: [0xc000, 0xc001], count: 2 });
    expect(m.writtenOutside([[0xc000, 0xc002], [0x01e0, 0x0200]]).count).toBe(0);
    expect(m.lowestS).toBe(0xf5);
  });

  it('check a mem file with a decruncher put where there is room, or say why not', async () => {
    // data over $c000: the decruncher goes elsewhere
    const data = programLike(0x1800, 9), start = 0xbc00;
    const r = await mem(data, start);
    const file = { start: r.at!.start, bytes: r.bytes.subarray(2) };
    expect(checkMem({ format: 'exomizer' }, file, { start, bytes: data })).toMatchObject({ at: 0x1000 });
    // -P7: no offsets taken again, and the decruncher reads none
    const p7 = memFile(data, start, crunchData(data.slice().reverse(), { protocol: { flags: 7 } }));
    expect(checkMem({ format: 'exomizer', flags: 7 }, { start: p7.at!.start, bytes: p7.bytes.subarray(2) }, { start, bytes: data })).toHaveProperty('cycles');
    expect(checkMem({ format: 'exomizer', forward: true }, file, { start, bytes: data })).toEqual({ skipped: expect.stringMatching(/reads backward/) });
    expect(checkMem({ format: 'exomizer', header: false }, file, { start, bytes: data })).toEqual({ skipped: expect.stringMatching(/no encoding \(-E\)/) });
    expect(checkMem({ format: 'exomizer', flags: 39 | P.ALIGN }, file, { start, bytes: data })).toEqual({ skipped: expect.stringMatching(/not -P47/) });
  });

  it('fail with the file and the memory when a stream does not decrunch', () => {
    // a -P7 stream read by a decruncher that takes offsets again
    const data = programLike(4000, 10), start = 0x2000;
    const p7 = memFile(data, start, crunchData(data.slice().reverse(), { protocol: { flags: 7 } }));
    const file = { start: p7.at!.start, bytes: p7.bytes.subarray(2) };
    let e: unknown;
    try { checkDecruncher(decruncherFile({ reuse: true }), file, { start, bytes: data }, 'p7.prg'); } catch (x) { e = x; }
    expect(e).toBeInstanceOf(CheckError);
    expect((e as CheckError).message).toMatch(/^p7\.prg does not decrunch with the decruncher in the emulated C64/);
    expect((e as CheckError).file).toEqual(file.bytes);
    expect((e as CheckError).memory).toHaveLength(0x10000);
  });

  it('check every file `brokkr mem` writes, and say when it cannot', () => {
    const dir = mkdtempSync(join(tmpdir(), 'brokkr-mem-')), cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
    const prg = join(dir, 'p.prg');
    writeFileSync(prg, Uint8Array.from([0x00, 0x20, ...programLike(3000, 11)]));
    const brokkr = (...args: string[]) => execFileSync(process.execPath, [cli, 'mem', ...args, prg, '-o', join(dir, 'm.prg')], { encoding: 'utf8' });
    for (const format of ['exomizer', 'brokkr', 'fast']) expect(brokkr('--format', format)).toMatch(/checked with Brokkr's decruncher in an emulated C64: \d+ cycles/);
    expect(brokkr('-f')).toMatch(/not checked in an emulated C64: Brokkr's decruncher reads backward/);
    expect(JSON.parse(brokkr('--json')).check).toMatchObject({ cycles: expect.any(Number), port: 0x37 });
  });
});
