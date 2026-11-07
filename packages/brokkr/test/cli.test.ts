import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Disk } from '../src/d64.ts';
import { basicProgram, programLike } from './tools.ts';

// The command line as Exomizer's users type it, and what it says when something is wrong.
const CLI = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'brokkr-cli-'));
const prg = (name: string, load: number, body: Uint8Array) => {
  writeFileSync(join(dir, name), Uint8Array.from([load & 0xff, load >> 8, ...body]));
  return name;
};
const brokkr = (...args: string[]) => {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd: dir, encoding: 'utf8' });
  return { status: r.status, out: r.stdout, err: r.stderr };
};
const size = (name: string) => statSync(join(dir, name)).size;
const game = prg('game.prg', 0x1000, programLike(3000, 1));

/** a BASIC program without a SYS: 10 PRINT "HI" and 20 GOTO 10 */
const printer = (): Uint8Array => {
  const l1 = [0x99, 0x20, 0x22, 0x48, 0x49, 0x22, 0], l2 = [0x89, 0x20, 0x31, 0x30, 0];
  const second = 0x0801 + 4 + l1.length, end = second + 4 + l2.length;
  return Uint8Array.from([second & 0xff, second >> 8, 10, 0, ...l1, end & 0xff, end >> 8, 20, 0, ...l2, 0, 0]);
};

describe('the command line', () => {
  it("reads a one-letter option's value right after it, as Exomizer does", () => {
    for (const [joined, apart] of [['-P7', ['-P', '7']], ['-m1024', ['-m', '1024']], ['-P+16', ['-P', '+16']], ['-T4', ['-T', '4']]] as const) {
      expect(brokkr('raw', joined, game, '-o', 'a.bin', '-q').status).toBe(0);
      expect(brokkr('raw', ...apart, game, '-o', 'b.bin', '-q').status).toBe(0);
      expect(readFileSync(join(dir, 'a.bin'))).toEqual(readFileSync(join(dir, 'b.bin')));
    }
    // the settings change the stream: a decruncher for other settings would read it wrong
    expect(brokkr('raw', '-P7', game, '-o', 'a.bin', '-q').status).toBe(0);
    expect(brokkr('raw', game, '-o', 'c.bin', '-q').status).toBe(0);
    expect(size('c.bin')).not.toBe(size('a.bin'));
    expect(brokkr('raw', `-ogame-raw.bin`, game, '-q').status).toBe(0);
    expect(size('game-raw.bin')).toBe(size('c.bin'));
  });

  it("says an option is not Brokkr's, instead of leaving it out", () => {
    expect(brokkr('raw', '--bogus', game).err).toMatch(/BRK-E017: Brokkr has no option --bogus\.\n {2}brokkr --help lists them\./);
    expect(brokkr('sfx', '-n', game).err).toMatch(/BRK-E017: Brokkr has no option -n\.\n {2}Exomizer's -n is --no-effect in Brokkr\./);
    expect(brokkr('raw', '-q=1', game).err).toMatch(/BRK-E017: The option -q takes no value/);
  });

  it('takes --four-tables with a value or without one', () => {
    const sys = prg('sys.prg', 0x0801, basicProgram(programLike(4000, 2)));
    expect(brokkr('sfx', '--four-tables', sys, '-o', 'f.prg', '-q')).toMatchObject({ status: 0, err: '' });
    expect(brokkr('sfx', '--four-tables', 'auto', sys, '-o', 'g.prg', '-q').status).toBe(0);
    expect(brokkr('sfx', '--four-tables=off', sys, '-o', 'h.prg', '-q').status).toBe(0);
    expect(brokkr('sfx', '--four-tables=maybe', sys).err).toMatch(/--four-tables is on, off, auto or nothing, not "maybe"/);
  });

  it('says what is wrong with the arguments as JSON with --json, and wants a thread at least', () => {
    const r = brokkr('raw', '--json', game, '-o');
    expect(r.status).toBe(1);
    expect(JSON.parse(r.out)).toMatchObject({ ok: false, error: { code: 'BRK-E001', message: 'The option -o needs a value.' } });
    expect(brokkr('mem', '--effort', 'max', '--threads', '0', game).err).toMatch(/BRK-E018: --threads .* at least 1, not 0/);
  });

  it("crunches Brokkr's own format with effort max on threads, never larger than normal", () => {
    expect(brokkr('raw', '--format', 'brokkr', game, '-o', 'own-normal.bin', '-q').status).toBe(0);
    expect(brokkr('raw', '--format', 'brokkr', '--effort', 'max', '--threads', '2', game, '-o', 'own-max.bin', '-q')).toMatchObject({ status: 0, err: '' });
    expect(size('own-max.bin')).toBeLessThanOrEqual(size('own-normal.bin'));
  });

  it('packs a self-extracting file in the format that makes it smallest, within a time if told', () => {
    const sys = prg('auto.prg', 0x0801, basicProgram(programLike(6000, 12)));
    const r = brokkr('sfx', '--format', 'auto', '--max-seconds', '2', sys, '-o', 'auto-sfx.prg');
    expect(r.out).toMatch(/^ {2}exomizer \d+ bytes, \d+\.\d\d s to decrunch/m);
    expect(r.out).toMatch(/^ {2}brokkr {3}\d+ bytes, \d+\.\d\d s to decrunch/m);
    expect(r.out).toMatch(/ \(taken\)$/m);
    expect(brokkr('mem', '--format', 'auto', sys).err).toMatch(/BRK-E012: --format auto is for self-extracting files/);
    expect(brokkr('sfx', '--max-seconds', '2', sys).err).toMatch(/BRK-E019: --max-seconds goes with --format auto/);
    expect(brokkr('sfx', '--format', 'auto', '--max-seconds', '0', sys).err).toMatch(/BRK-E019: --max-seconds is a time in seconds above 0/);
  });

  it('does not start a program by a SYS it cannot read', () => {
    // 10 SYS <text>, the link to the end of the program after it
    const at = (text: string) => prg('expr.prg', 0x0801, Uint8Array.from([0x07 + text.length, 0x08, 10, 0, 0x9e, ...Buffer.from(text, 'latin1'), 0, 0, 0, ...programLike(300, 3)]));
    expect(brokkr('sfx', at('2*1024')).err).toMatch(/BRK-E110: The first BASIC line has SYS 2\*1024, which Brokkr does not read as an address/);
    expect(brokkr('sfx', at('4096\xaa16')).err).toMatch(/SYS 4096\+16/);
    expect(brokkr('sfx', at('(2061)'), '-o', 'p.prg', '-q').status).toBe(0);
    expect(brokkr('sfx', at('2061:\x8f HI'), '-o', 'p.prg', '-q').status).toBe(0);
  });
});

describe('packing on a disk image', () => {
  const disk = (files: [Uint8Array | string, Uint8Array][]) => {
    const d = Disk.format('BROKKR', 'BK');
    for (const [name, bytes] of files) d.write(name, bytes);
    writeFileSync(join(dir, 'in.d64'), d.bytes);
  };
  const out = () => new Disk(new Uint8Array(readFileSync(join(dir, 'in-brokkr.d64'))));

  it('packs in place a file whose name has PETSCII graphics, not next to it', () => {
    const name = Uint8Array.from([0x47, 0x41, 0x4d, 0x45, 0xe1, 0xdb]);
    disk([[name, Uint8Array.from([0x01, 0x08, ...basicProgram(programLike(6000, 4))])]]);
    expect(brokkr('d64', 'in.d64', 'GAME*', '-q').status).toBe(0);
    const files = out().files();
    expect(files).toHaveLength(1);
    expect([...files[0].raw]).toEqual([...name]);
    expect(files[0].blocks).toBeLessThan(24);
  });

  it('starts a BASIC program without a SYS with RUN, and leaves a file it cannot pack as it is', () => {
    const run = Uint8Array.from([0x01, 0x08, ...printer(), ...programLike(4000, 5)]);
    const expr = Uint8Array.from([0x01, 0x08, 0x0a, 0x08, 10, 0, 0x9e, 0x32, 0xac, 0x34, 0, 0, 0, ...programLike(4000, 6)]);
    const data = Uint8Array.from([0x00, 0x20, ...programLike(4000, 7)]);
    disk([['RUN ME', run], ['SYS EXPR', expr], ['DATA', data]]);
    const r = brokkr('d64', 'in.d64', 'RUN ME', 'SYS EXPR', 'DATA', '--json');
    expect(r.status).toBe(0);
    const packed = JSON.parse(r.out).packed;
    expect(packed[0]).toMatchObject({ name: 'RUN ME', mode: 'sfx', start: 'basic' });
    expect(packed[1]).toMatchObject({ name: 'SYS EXPR', mode: 'sfx', error: { code: 'BRK-E110' } });
    expect(packed[2]).toMatchObject({ name: 'DATA', mode: 'mem' });
    const d = out();
    expect(d.read(d.find('SYS EXPR')!)).toEqual(expr);
    expect(d.read(d.find('RUN ME')!).length).toBeLessThan(run.length);
    // none packed: no disk written, and why
    expect(brokkr('d64', 'in.d64', 'SYS EXPR', '-o', 'none.d64').err).toMatch(/BRK-E322: None of the files could be packed, so no disk image was written: "SYS EXPR": BRK-E110/);
    expect(brokkr('d64', 'in.d64', 'NOT THERE', 'DATA').err).toMatch(/BRK-E320: There is no file "NOT THERE"/);
  });
});
