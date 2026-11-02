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

  it('takes one file at a time, and says when there is none', () => {
    expect(sindri('a.prg', 'b.prg').error).toBe('sindri: one file at a time, not 2: "a.prg", "b.prg" (a path with spaces goes in quotes)');
    expect(sindri('c.prg').error).toBe(`sindri: no file ${join(dir, 'c.prg')}`);
    expect(sindri('-i').error).toBe('sindri: no file given');
    expect(sindri('a.prg', '--file', 'X').error).toBe('sindri: --file picks a file on a D64');
  });
});
