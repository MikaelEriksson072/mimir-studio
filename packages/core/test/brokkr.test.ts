/* Brokkr in the Pack view (spec 13.8): the result has the shape of an Exomizer run, the self-extracting file is
 * checked in Brokkr's emulated C64, and the command shown makes the same file with the standalone Brokkr. */
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { workerFile } from '@mimir/brokkr/node';
import { brokkrArgs, DEFAULT_PACK, makeDemo, makePrg, packNeeds, packWithBrokkr, parsePrg, type PackPrefs } from '../src';
import { findVice, packWithBrokkrThreads } from '../src/node';
import { fromSource, rng } from './helpers/programs';

const P = (o: Partial<PackPrefs> = {}): PackPrefs => ({ ...DEFAULT_PACK, ...o });
const bytes = (n: number, f = (i: number) => i & 0xff) => Uint8Array.from({ length: n }, (_, i) => f(i));
const demo = makeDemo();
const f = parsePrg(demo.name, demo.prg);
const cli = join(__dirname, '..', '..', 'brokkr', 'src', 'cli.ts');

describe('packing with Brokkr', () => {
  it('packs the whole demo as a self-extracting program, checked in an emulated C64', async () => {
    const r = await packWithBrokkr([{ name: 'raster demo.prg', prg: demo.prg }], P());
    expect(r.error).toBeUndefined();
    expect(r.ok).toBe(true);
    expect(r.name).toBe('raster demo-brokkr.prg');
    expect(r.argv).toEqual(['brokkr', 'sfx', '--start', 'sys', '-o', 'raster demo-brokkr.prg', 'raster demo.prg']);
    expect(r.prg!.length).toBeLessThan(demo.prg.length);
    expect(r.prg![0] | (r.prg![1] << 8)).toBe(0x0801);
    expect(r.packed).toEqual({ start: f.load, length: f.bytes.length });
    expect(r.report.layout.find(a => a.name === 'Decrunched data')).toMatchObject({ start: f.load, end: f.load + f.bytes.length });
    expect(r.report.decruncher.find(d => d.what === 'RAM config')?.exit).toBe('$37');
    expect(r.check).toMatchObject({ status: 'same', text: expect.stringMatching(/emulated C64/) });
  });

  it('packs chosen ranges with a jmp, the gap zero-filled, without the effect', async () => {
    const prg = makePrg(0x1000, bytes(0x3000, i => (i * 7) ^ (i >> 5)));
    const prefs = P({ start: 'jmp', jmp: 0x1000, effect: 'none', ranges: [{ start: 0x1000, end: 0x1800 }, { start: 0x2000, end: 0x3000 }] });
    const r = await packWithBrokkr([{ name: 'game.prg', prg }], prefs);
    expect(r.ok).toBe(true);
    expect(r.argv).toEqual(['brokkr', 'sfx', '--start', '$1000', '--no-effect', '-o', 'game-brokkr.prg', 'game.prg,$1000,0,2048', 'game.prg,$2000,4096,4096']);
    expect(r.packed).toEqual({ start: 0x1000, length: 0x2000 });
    expect(r.check).toMatchObject({ status: 'same', text: expect.stringMatching(/starts at \$1000/) });
  });

  it('writes crunched data (mem) with its decruncher, which decrunches it in an emulated C64', async () => {
    const r = await packWithBrokkr([{ name: 'game.prg', prg: demo.prg }], P({ mode: 'mem', memLoad: 'none' }));
    expect(r.ok).toBe(true);
    expect(r.name).toBe('game-brokkr.bin');
    expect(r.prg!.length).toBeLessThan(f.bytes.length);
    expect(r.files?.map(x => x.name)).toEqual(['game-brokkr.bin', 'game-brokkr-decrunch.prg', 'game-brokkr-decrunch.asm']);
    expect(r.check).toMatchObject({ status: 'same', text: expect.stringMatching(/^Decrunched by game-brokkr-decrunch\.prg in Brokkr's emulated C64: \$0801–\$[0-9a-f]{4} has the same \d+ bytes/) });
    expect(r.report.layout.map(a => a.name)).toEqual(['Decrunched data', 'Decruncher', 'Decrunch table']);
    const alone = await packWithBrokkr([{ name: 'game.prg', prg: demo.prg }], P({ mode: 'mem', decruncher: false }));
    expect(alone.files?.map(x => x.name)).toEqual(['game-brokkr.prg']);
    expect(alone.check?.text).toMatch(/decrunched the stream again/);
    expect(brokkrArgs(P({ mode: 'mem', memLoad: 0x2000, forward: true, compat: true, effort: 'fast' }), ['a.prg'], 'a-brokkr.prg'))
      .toEqual(['brokkr', 'mem', '-f', '-l', '$2000', '-T', '5', '--effort', 'fast', '-o', 'a-brokkr.prg', 'a.prg']);
  });

  it('says what is wrong instead of packing', async () => {
    const noSys = await packWithBrokkr([{ name: 'game.prg', prg: makePrg(0x1000, bytes(4000)) }], P());
    expect(noSys).toMatchObject({ ok: false, error: expect.stringMatching(/not at \$0801/) });
    expect(noSys.output).toMatch(/BRK-E110/);
    const none = await packWithBrokkr([{ name: 'game.prg', prg: demo.prg }], P({ ranges: [{ start: 0xc000, end: 0xc100 }] }));
    expect(none).toMatchObject({ ok: false, error: 'None of the chosen blocks is in the built files.' });
  });

  it('makes the same file as the command it shows, run with the standalone Brokkr in the pack folder', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mimir-brokkr-'));
    try {
      const prg = makePrg(0x1000, bytes(0x3000, i => (i * 13) ^ (i >> 3)));
      const r = await packWithBrokkr([{ name: 'game.prg', prg }], P({ start: 'jmp', jmp: 0x1000, ranges: [{ start: 0x1000, end: 0x1800 }, { start: 0x2400, end: 0x3000 }] }));
      for (const i of r.inputs) await writeFile(join(dir, i.name), i.prg);
      const run = spawnSync(process.execPath, [cli, ...r.argv.slice(1), '-q'], { cwd: dir, encoding: 'utf8' });
      expect(run.stderr).toBe('');
      expect(new Uint8Array(await readFile(join(dir, r.name!)))).toEqual(r.prg);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it("packs in Brokkr's own format, smaller, as the command it shows does", async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mimir-brokkr-'));
    try {
      // text in a random order: adaptive coding takes its letters in fewer bits than Exomizer's literals
      let seed = 7;
      const text = 'BROKKR AND SINDRI FORGED THE HAMMER. ';
      const prg = makePrg(0x1000, bytes(0x3000, () => text.charCodeAt((seed = (seed * 1103515245 + 12345) >>> 0) % text.length)));
      const prefs = P({ format: 'brokkr', start: 'jmp', jmp: 0x1000, compat: true });
      const r = await packWithBrokkr([{ name: 'game.prg', prg }], prefs);
      const exo = await packWithBrokkr([{ name: 'game.prg', prg }], { ...prefs, format: 'exomizer' });
      expect(r.ok).toBe(true);
      expect(r.argv).toEqual(['brokkr', 'sfx', '--format', 'brokkr', '--start', '$1000', '-o', 'game-brokkr.prg', 'game.prg']);
      expect(r.report.layout.map(a => a.name)).toContain('Probabilities');
      expect(r.check?.status).toBe('same');
      expect(r.prg!.length).toBeLessThan(exo.prg!.length);
      for (const i of r.inputs) await writeFile(join(dir, i.name), i.prg);
      const run = spawnSync(process.execPath, [cli, ...r.argv.slice(1), '-q'], { cwd: dir, encoding: 'utf8' });
      expect(run.stderr).toBe('');
      expect(new Uint8Array(await readFile(join(dir, r.name!)))).toEqual(r.prg);
      const mem = await packWithBrokkr([{ name: 'game.prg', prg }], P({ format: 'brokkr', mode: 'mem' }));
      expect(mem.ok).toBe(true);
      expect(mem.check?.text).toMatch(/^Decrunched by game-brokkr-decrunch\.prg in Brokkr's emulated C64/);
      // forward is for Exomizer's format: the Pack view hides it here, so a stale tick changes nothing
      const backward = await packWithBrokkr([{ name: 'game.prg', prg }], P({ format: 'brokkr', mode: 'mem', forward: true }));
      expect(backward.ok).toBe(true);
      expect(backward.prg).toEqual(mem.prg);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('says what the decruncher takes with the settings, before anything is packed', () => {
    // the least: without literal sequences, and leaving $01 alone at the end when it is $37 all along
    expect(packNeeds(P())).toMatchObject({ resident: { min: 201, max: 229 }, tables: { min: 156, max: 156 }, zp: 9 });
    expect(packNeeds(P({ format: 'brokkr' }))).toMatchObject({ tables: { min: 512, max: 1536, align: 256 }, zp: 12 });
    expect(packNeeds(P({ format: 'fast' })).tables.max).toBe(0);
    // RUN ends the decruncher with a longer exit
    expect(packNeeds(P({ start: 'basic' })).resident.max).toBeGreaterThan(packNeeds(P()).resident.max);
  });

  it('puts the decruncher, its tables and zero page where they are set, and keeps memory free, as the command does', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mimir-brokkr-'));
    try {
      const prefs = P({ decruncherAt: 0xc000, tablesAt: 0xc400, zp: 0x22, keep: [{ start: 0x0334, end: 0x0400 }] });
      const r = await packWithBrokkr([{ name: 'raster demo.prg', prg: demo.prg }], prefs);
      expect(r.ok).toBe(true);
      expect(r.argv).toEqual(['brokkr', 'sfx', '--start', 'sys', '--zp', '$22', '--at', '$c000', '--table', '$c400', '--keep', '$0334-$03ff', '-o', 'raster demo-brokkr.prg', 'raster demo.prg']);
      expect(r.report.layout.find(a => a.name === 'Decruncher')).toMatchObject({ start: 0xc000, note: 'zero page $22-$2a' });
      expect(r.report.layout.find(a => a.name === 'Decrunch table')?.start).toBe(0xc400);
      expect(r.check?.status).toBe('same');
      for (const i of r.inputs) await writeFile(join(dir, i.name), i.prg);
      const run = spawnSync(process.execPath, [cli, ...r.argv.slice(1), '-q'], { cwd: dir, encoding: 'utf8' });
      expect(run.stderr).toBe('');
      expect(new Uint8Array(await readFile(join(dir, r.name!)))).toEqual(r.prg);
      // in the way: the program
      expect(await packWithBrokkr([{ name: 'raster demo.prg', prg: demo.prg }], P({ decruncherAt: 0x1000 })))
        .toMatchObject({ ok: false, error: expect.stringMatching(/lies in the program/) });
      // crunched data has no decruncher of Brokkr's to place
      expect(brokkrArgs(P({ mode: 'mem', decruncherAt: 0xc000, keep: [{ start: 0xc000, end: 0xd000 }] }), ['a.prg'], 'a-brokkr.prg')).toEqual(['brokkr', 'mem', '-o', 'a-brokkr.prg', 'a.prg']);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it("packs in Brokkr's fast format, as the command it shows does", async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mimir-brokkr-'));
    try {
      const r = await packWithBrokkr([{ name: 'raster demo.prg', prg: demo.prg }], P({ format: 'fast' }));
      expect(r.ok).toBe(true);
      expect(r.argv).toEqual(['brokkr', 'sfx', '--format', 'fast', '--start', 'sys', '-o', 'raster demo-brokkr.prg', 'raster demo.prg']);
      expect(r.report.layout.find(a => a.name === 'Decruncher')?.start).toBe(0x0100);
      expect(r.check?.status).toBe('same');
      for (const i of r.inputs) await writeFile(join(dir, i.name), i.prg);
      const run = spawnSync(process.execPath, [cli, ...r.argv.slice(1), '-q'], { cwd: dir, encoding: 'utf8' });
      expect(run.stderr).toBe('');
      expect(new Uint8Array(await readFile(join(dir, r.name!)))).toEqual(r.prg);
      const mem = await packWithBrokkr([{ name: 'game.prg', prg: demo.prg }], P({ format: 'fast', mode: 'mem' }));
      expect(mem.ok).toBe(true);
      expect(mem.check?.text).toMatch(/^Decrunched by game-brokkr-decrunch\.prg in Brokkr's emulated C64/);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it("crunches each part into a file of its own, with one decruncher for all, as the commands it shows do", async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mimir-brokkr-'));
    try {
      const prg = makePrg(0x1000, bytes(0x3000, i => (i * 13) ^ (i >> 3)));
      const prefs = P({ mode: 'mem', format: 'fast', split: true, decruncherAt: 0x9000, ranges: [{ start: 0x1000, end: 0x1800 }, { start: 0x2400, end: 0x3000 }] });
      const r = await packWithBrokkr([{ name: 'game.prg', prg }], prefs);
      expect(r.ok).toBe(true);
      expect(r.files?.map(x => x.name)).toEqual(['game-brokkr-1000.prg', 'game-brokkr-2400.prg', 'game-brokkr-decrunch.prg', 'game-brokkr-decrunch.asm']);
      // the stream: the address after the file's last byte as loaded
      const [, end, stream] = /^\$1000–\$17ff, loaded at \$[0-9a-f]{4}–\$([0-9a-f]{4}): stream \$([0-9a-f]{4})$/.exec(r.files![0].note)!;
      expect(parseInt(stream, 16)).toBe(parseInt(end, 16) + 1);
      expect(r.files![2].note).toMatch(/^the decruncher at \$9000–\$90e0: set stream \(\$fc\)/);
      expect(r.check).toMatchObject({ status: 'same', text: expect.stringMatching(/each of the 2 files gives the same bytes/) });
      expect(r.report.layout.map(a => a.name)).toEqual(['Decruncher']);
      expect(r.commands.map(c => c[c.indexOf('-o') + 1])).toEqual(['game-brokkr-1000.prg', 'game-brokkr-2400.prg', 'game-brokkr-decrunch.asm', 'game-brokkr-decrunch.prg']);
      expect(r.commands[3]).toEqual(['brokkr', 'decruncher', '--format', 'fast', '--at', '$9000', '-o', 'game-brokkr-decrunch.prg']);
      // the standalone Brokkr makes the same files; the source Mimir writes names the files at its top
      for (const i of r.inputs) await writeFile(join(dir, i.name), i.prg);
      for (const c of r.commands) expect(spawnSync(process.execPath, [cli, ...c.slice(1), '-q'], { cwd: dir, encoding: 'utf8' }).stderr).toBe('');
      for (const x of r.files!) {
        const made = new Uint8Array(await readFile(join(dir, x.name)));
        if (x.name.endsWith('.asm')) expect(new TextDecoder().decode(x.prg).endsWith(new TextDecoder().decode(made))).toBe(true);
        else expect(made).toEqual(x.prg);
      }
      expect(new TextDecoder().decode(r.files![3].prg)).toMatch(/^\/\/ +game-brokkr-2400\.prg: loaded at .*, decrunches to \$2400–\$2fff$/m);
      // the whole build: a file for each PRG
      const two = await packWithBrokkr([{ name: 'a.prg', prg: makePrg(0x2000, bytes(3000)) }, { name: 'b.prg', prg: makePrg(0x6000, bytes(2000, i => i * 3)) }], P({ mode: 'mem', split: true }));
      expect(two.files?.map(x => x.name)).toEqual(['a-brokkr-2000.prg', 'a-brokkr-6000.prg', 'a-brokkr-decrunch.prg', 'a-brokkr-decrunch.asm']);
      expect(two.check?.status).toBe('same');
      // a decruncher where a file decrunches does not decrunch it
      const over = await packWithBrokkr([{ name: 'game.prg', prg }], { ...prefs, decruncherAt: 0x1100 });
      expect(over.check).toMatchObject({ status: 'differs', text: expect.stringMatching(/game-brokkr-1000\.prg loads at \$[0-9a-f]{4}–\$[0-9a-f]{4}, over the decruncher \(\$1100–\$11e0\)/) });
      expect(await packWithBrokkr([{ name: 'game.prg', prg }], { ...prefs, decruncherAt: 0xff80 })).toMatchObject({ ok: false, error: expect.stringMatching(/does not fit from \$ff80/) });
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('leaves out the settings that take no effect, as the Pack view hides them', async () => {
    const args = (o: Partial<PackPrefs>) => brokkrArgs(P(o), ['a.prg'], 'o.prg');
    // literal sequences in a self-extracting file: its decruncher reads them, and Brokkr tries the stream both ways
    expect(args({ compat: true, forward: true, memLoad: 0x2000 })).toEqual(['brokkr', 'sfx', '--start', 'sys', '-o', 'o.prg', 'a.prg']);
    // RUN needs $37; the fast format's decruncher does not flash the border
    expect(args({ start: 'basic', ramExit: 0x35, irqExit: false })).toEqual(['brokkr', 'sfx', '--start', 'basic', '--irq', 'off', '-o', 'o.prg', 'a.prg']);
    expect(args({ format: 'fast', effect: 'none' })).toEqual(['brokkr', 'sfx', '--format', 'fast', '--start', 'sys', '-o', 'o.prg', 'a.prg']);
    // crunched data has no start; Brokkr's own formats are decrunched backward by its own decruncher
    expect(args({ mode: 'mem', start: 'jmp', jmp: 0x1000, effect: 'none', ramExit: 0x35 })).toEqual(['brokkr', 'mem', '-o', 'o.prg', 'a.prg']);
    expect(args({ mode: 'mem', format: 'brokkr', forward: true, compat: true })).toEqual(['brokkr', 'mem', '--format', 'brokkr', '-o', 'o.prg', 'a.prg']);
    // Exomizer's settings are not Brokkr's
    expect(args({ fast: true, extra: '-p 4' })).toEqual(['brokkr', 'sfx', '--start', 'sys', '-o', 'o.prg', 'a.prg']);
    const r = await packWithBrokkr([{ name: 'raster demo.prg', prg: demo.prg }], P({ start: 'basic', ramExit: 0x35 }));
    expect(r.report.decruncher.find(d => d.what === 'RAM config')?.exit).toBe('$37');
    expect(r.output).not.toMatch(/RUN needs BASIC/);
  });

  it('crunches data for old decrunchers as the command it shows does (-T 5: no literal sequences, no mirrors)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mimir-brokkr-'));
    try {
      // long runs, so the stream has lengths above 256 that exodecrunch.s gets wrong unless they are left out
      const prg = makePrg(0x1000, bytes(0x3000, i => ((i >> 9) & 1 ? 0 : (i * 7) ^ (i >> 4))));
      const r = await packWithBrokkr([{ name: 'game.prg', prg }], P({ mode: 'mem', compat: true }));
      expect(r.ok).toBe(true);
      expect(r.argv).toEqual(['brokkr', 'mem', '-T', '5', '-o', 'game-brokkr.prg', 'game.prg']);
      for (const i of r.inputs) await writeFile(join(dir, i.name), i.prg);
      const run = spawnSync(process.execPath, [cli, ...r.argv.slice(1), '-q'], { cwd: dir, encoding: 'utf8' });
      expect(run.stderr).toBe('');
      expect(new Uint8Array(await readFile(join(dir, r.name!)))).toEqual(r.prg);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it('spreads effort max over threads', async () => {
    const prg = makePrg(0x1000, bytes(3000, i => (i * 5) ^ (i >> 4)));
    const prefs = P({ effort: 'max', start: 'jmp', jmp: 0x1000 });
    const r = await packWithBrokkrThreads([{ name: 'small.prg', prg }], prefs, workerFile, 2);
    const normal = await packWithBrokkr([{ name: 'small.prg', prg }], { ...prefs, effort: 'normal' });
    expect(r.ok).toBe(true);
    expect(r.check?.status).toBe('same');
    expect(r.prg!.length).toBeLessThanOrEqual(normal.prg!.length);
  });
});

const vice = process.env.VICE || findVice();

describe.skipIf(!vice)('a file Brokkr packs, in real VICE', () => {
  // headless, with a config of its own (nothing goes to the user's vice.ini); the debug cartridge makes VICE exit with
  // the value the program writes to $d7ff: the xor of its 4 KB of data, computed after decrunching
  const headless = (dir: string) => ['-config', join(dir, 'vice.ini'), '-default', '-console', '-sounddev', 'dummy', '+confirmonexit', '-debugcart', '-limitcycles', '120000000', '-autostartprgmode', '1'];
  /** 10 SYS2061: xor the 16 pages of data at `at` and exit with it */
  const program = (at: number) => {
    const r = rng(64);
    const data = Array.from({ length: 4096 }, (_, i) => (i % 97 < 40 ? i & 7 : Math.floor(r() * 256)));
    let sum = data.reduce((a, b) => a ^ b, 0);
    if (sum === 0) { data[0] ^= 0x5a; sum = 0x5a; }
    const rows: string[] = [];
    for (let i = 0; i < data.length; i += 32) rows.push(`.byte ${data.slice(i, i + 32).map(v => `$${v.toString(16).padStart(2, '0')}`).join(',')}`);
    const p = fromSource('checksum.prg', ['.pc = $0801', '.byte $0b,$08,$0a,$00,$9e,$32,$30,$36,$31,$00,$00,$00', '.pc = $080d',
      ' lda #$00', ' sta $fb', ` lda #$${(at >> 8).toString(16)}`, ' sta $fc', ' ldx #16', ' lda #0', ' ldy #0', 'loop:', ' eor ($fb),y', ' iny', ' bne loop', ' inc $fc', ' dex', ' bne loop',
      ' sta $d7ff', ' jmp *', `.pc = $${at.toString(16)}`, ...rows].join('\n'));
    return { prg: makePrg(p.load, p.bytes), sum };
  };
  const packAndRun = async (at: number, prefs: PackPrefs) => {
    const { prg, sum } = program(at);
    const r = await packWithBrokkr([{ name: 'checksum.prg', prg }], prefs);
    expect(r.error).toBeUndefined();
    expect(r.check?.status).toBe('same');
    const dir = await mkdtemp(join(tmpdir(), 'mimir-brokkr-vice-'));
    try {
      await writeFile(join(dir, 'packed.prg'), r.prg!);
      expect(spawnSync(vice!, [...headless(dir), '-autostart', join(dir, 'packed.prg')], { timeout: 120_000, windowsHide: true }).status).toBe(sum);
    } finally { await rm(dir, { recursive: true, force: true }); }
    return r;
  };

  // the stream decrunched where the file has it, its first bytes copied down over the BASIC line, the zero page
  // copied in with the decruncher and $01 left at $37
  for (const format of ['exomizer', 'brokkr', 'fast'] as const) {
    it(`decrunches a file in ${format === 'exomizer' ? "Exomizer's format" : format === 'fast' ? "Brokkr's fast format" : "Brokkr's own format"} and starts it by its SYS`, () => packAndRun(0x0900, P({ format })));
  }

  it('decrunches data under BASIC with $01 set while it does, and leaves it at $35 with interrupts off', async () => {
    const r = await packAndRun(0xa000, P({ ramExit: 0x35, irqExit: false }));
    expect(r.report.decruncher.find(d => d.what === 'RAM config')).toMatchObject({ during: '$36', exit: '$35' });
  });
});
