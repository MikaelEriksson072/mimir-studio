import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The command line says what is wrong before anything runs; a disk with a space in its folder's name, as the shell
// passes it without quotes, shows how.
const CLI = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'sindri-cli-'));
mkdirSync(join(dir, '001. The Lab'));
const disk = join(dir, '001. The Lab', 'side1.d64');
writeFileSync(disk, new Uint8Array(174848));
writeFileSync(join(dir, 'a.prg'), Uint8Array.of(0x01, 0x08, 0x60));
writeFileSync(join(dir, 'b.prg'), Uint8Array.of(0x01, 0x08, 0x60));

const sindri = (...args: string[]) => {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd: dir, env: { ...process.env, INIT_CWD: dir }, encoding: 'utf8' });
  return { status: r.status, error: r.stderr.trim() };
};
/** what it printed, line by line */
const report = (...args: string[]) => {
  const r = spawnSync(process.execPath, [CLI, ...args], { cwd: dir, env: { ...process.env, INIT_CWD: dir }, encoding: 'utf8' });
  return { status: r.status, lines: r.stdout.trim().split(/\r?\n/) };
};

describe('the command line', () => {
  it('says that a path with spaces goes in quotes', () => {
    expect(sindri(...disk.split(' '))).toEqual({ status: 2, error: `sindri: a path with spaces goes in quotes: sindri "${disk}"` });
    expect(sindri(...'001. The Lab/side1.d64'.split(' '), '--file', 'PART*').error).toBe('sindri: a path with spaces goes in quotes: sindri "001. The Lab/side1.d64"');
  });

  it('says that --file names a file on the disk, not the disk', () => {
    const cut = sindri('--file', ...disk.split(' ')).error;
    expect(cut).toBe(`sindri: --file takes the name of a file on the disk, not the disk: give the disk on its own, in quotes as its path has spaces, as in sindri "${disk}" (its first PRG, or --file NAME after it for another)`);
    expect(sindri('--file', disk).error).toMatch(/^sindri: --file takes the name of a file on the disk, not the disk: give the disk on its own, as in sindri ".*side1\.d64" \(its first PRG/);
    expect(sindri('--file', 'PART*').error).toBe('sindri: no file given: --file NAME picks a file on the disk given with it, as in sindri disk.d64 --file PART*');
  });

  it('says that a program that settles in its own code is not packed, and calls it no depacker', () => {
    // 10 SYS2061, then inc $d020 / jmp $080d
    writeFileSync(join(dir, 'plain.prg'), Uint8Array.of(0x01, 0x08, 0x0b, 0x08, 0x0a, 0x00, 0x9e, 0x32, 0x30, 0x36, 0x31, 0x00, 0x00, 0x00, 0xee, 0x20, 0xd0, 0x4c, 0x0d, 0x08));
    const r = report('plain.prg', '--no-roms');
    expect(r.status).toBe(1);
    expect(r.lines[2]).toBe('layer 0  $080d  start           program');
    expect(r.lines.join('\n')).not.toContain('depacker');
    expect(r.lines.at(-2)).toMatch(/: settled/);
    expect(r.lines.at(-1)).toBe('not packed: it ran as it is and never jumped into code it wrote');
    // cut short, it says nothing either way
    expect(report('plain.prg', '--no-roms', '--cycles', '0.1').lines.slice(-2)).toEqual([expect.stringMatching(/: budget/), 'nothing was unpacked']);
  });

  it('takes one file at a time, and says when there is none', () => {
    expect(sindri('a.prg', 'b.prg').error).toBe('sindri: one file at a time, not 2: "a.prg", "b.prg" (a path with spaces goes in quotes)');
    expect(sindri('c.prg').error).toBe(`sindri: no file ${join(dir, 'c.prg')}`);
    expect(sindri('-i').error).toBe('sindri: no file given');
    expect(sindri('a.prg', '--file', 'X').error).toBe('sindri: --file picks a file on a D64, G64, TAP or T64');
  });
});
