import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkDecruncher, decruncherFile } from '../src/decrunch-file.ts';
import { mem, memBrk, memFast } from '../src/files.ts';
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
    expect(out).toMatch(/d\.prg: Brokkr's decruncher of its fast format at \$9000–\$90e0 \(225 bytes\): set stream \(\$fa\)/);
    expect(new Uint8Array(readFileSync(join(dir, 'd.prg')))).toEqual(decruncherFile({ format: 'fast', at: 0x9000 }).prg);
    execFileSync(process.execPath, [cli, 'decruncher', '-o', join(dir, 'd.asm')]);
    expect(readFileSync(join(dir, 'd.asm'), 'utf8')).toBe(decruncherFile().source);
  });
});
