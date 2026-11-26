/* Integration (spec 10.7): what the Assembler's Release makes starts in the real VICE as Release starts it: the
 * program built with KickAss.jar (else Mimir's own check, which gives the same bytes), as it is and packed with Brokkr
 * and with Exomizer, as a disk image and a tape image (autostarted), a cartridge (attached) and a PRG (autostarted).
 * VICE runs headless (-console) with a config file of its own, and the debug cartridge makes it exit with the value
 * the program writes to $d7ff. Runs when VICE (and KickAss.jar, Exomizer for theirs) is found; otherwise skipped. */
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkAsm } from '../src/asm-project';
import { releaseImage, releaseStarts, type ReleaseKind } from '../src/asm-release';
import { packWithBrokkr } from '../src/brokkr';
import { DEFAULT_PACK } from '../src/pack';
import { findExomizer, findKickAssJar, findVice, prepareVice, runExomizer, runKickAssembler, writeVfs } from '../src/node';

const vice = process.env.VICE || findVice();
const jar = process.env.KICKASS_JAR || findKickAssJar();
const java = process.env.JAVA || 'java';
const kick = !!jar && spawnSync(java, ['-version'], { windowsHide: true }).status === 0;
const exomizer = process.env.EXOMIZER || findExomizer();

/** a program that exits VICE with `code` (through the debug cartridge), with some data so a pack has work */
const source = (code: number, basic: boolean) => `${basic ? 'BasicUpstart2(start)' : '* = $1000'}
start: lda #$${code.toString(16)}
 sta $d7ff
 jmp *
 .fill 1500, (i * 7) & 15
`;

/** the program as Release gets it: KickAss.jar's build (Mimir's own check where there is none) */
async function built(text: string): Promise<Uint8Array> {
  if (!kick) return checkAsm({ 'main.asm': text }, 'main.asm', 'kickass').asm.prg!;
  const dir = await mkdtemp(join(tmpdir(), 'mimir-release-'));
  try {
    await writeVfs(dir, { 'main.asm': text });
    const r = await runKickAssembler({ java, jar: jar!, cwd: dir, entry: 'main.asm', outDir: 'out' });
    expect(r.ok, r.output).toBe(true);
    return r.prg!;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** VICE's exit code for a release: what the program wrote to $d7ff (1 or none when it ran out of cycles) */
async function exitOf(kind: ReleaseKind, bytes: Uint8Array): Promise<number | null> {
  const dir = await mkdtemp(join(tmpdir(), 'mimir-release-vice-'));
  try {
    const path = join(dir, `main.${kind}`);
    await writeFile(path, bytes);
    // (a tape takes LOAD's minutes of C64 time: warp, and more cycles)
    const args = ['-config', join(dir, 'vice.ini'), '-default', '-console', '-sounddev', 'dummy', '+confirmonexit', '-debugcart', '-warp',
      '-limitcycles', kind === 'tap' ? '400000000' : '60000000', '-autostartprgmode', '1'];
    const { argv } = await prepareVice({ args, prgPath: path, ...(kind === 'crt' ? { cart: true } : {}) });
    return spawnSync(vice!, argv, { timeout: 300_000, windowsHide: true }).status;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const KINDS: ReleaseKind[] = ['prg', 'd64', 'tap', 'crt'];

describe.skipIf(!vice)(`releases started in the real VICE (${vice ?? 'not found'})`, () => {
  it('starts the built program from each kind of release', async () => {
    const prg = await built(source(0x42, true));
    for (const kind of KINDS) {
      expect(releaseStarts(kind, prg), kind).toBeNull();
      expect(await exitOf(kind, releaseImage(kind, prg, { name: 'MAIN', disk: 'MY RELEASE', id: '25' })), kind).toBe(0x42);
    }
  }, 600_000);

  it('starts the program packed with Brokkr from each kind of release', async () => {
    const prg = await built(source(0x43, true));
    const r = await packWithBrokkr([{ name: 'main.prg', prg }], { ...DEFAULT_PACK, start: 'sys' });
    expect(r.ok, r.error).toBe(true);
    expect(r.prg!.length).toBeLessThan(prg.length);
    for (const kind of KINDS) expect(await exitOf(kind, releaseImage(kind, r.prg!, { name: 'MAIN' })), kind).toBe(0x43);
  }, 600_000);

  it.skipIf(!exomizer)('starts the program packed with Exomizer from each kind of release', async () => {
    const prg = await built(source(0x44, true));
    const dir = await mkdtemp(join(tmpdir(), 'mimir-release-exo-'));
    try {
      const r = await runExomizer({ exe: exomizer!, dir, files: [{ name: 'main.prg', prg }], prefs: { ...DEFAULT_PACK, packer: 'exomizer', start: 'sys' } });
      expect(r.ok, r.error ?? r.output).toBe(true);
      const packed = r.out!.prg;
      for (const kind of KINDS) expect(await exitOf(kind, releaseImage(kind, packed, { name: 'MAIN' })), kind).toBe(0x44);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 600_000);

  it('starts a program without a BASIC line only from a cartridge, and says so for the rest', async () => {
    const prg = await built(source(0x45, false));
    expect(await exitOf('crt', releaseImage('crt', prg, { name: 'MAIN' }))).toBe(0x45);
    for (const kind of ['prg', 'd64'] as const) {
      expect(releaseStarts(kind, prg), kind).toMatch(/loads at \$1000, not with a BASIC line/);
      expect(await exitOf(kind, releaseImage(kind, prg, { name: 'MAIN' })), kind).not.toBe(0x45);
    }
  }, 600_000);
});


describe.skipIf(!vice)('a program without a BASIC line, packed', () => {
  it('starts from a disk when packed: its decruncher jumps to where it starts', async () => {
    const prg = await built(source(0x46, false));
    const r = await packWithBrokkr([{ name: 'main.prg', prg }], { ...DEFAULT_PACK, start: 'jmp', jmp: 0x1000 });
    expect(r.ok, r.error).toBe(true);
    expect(await exitOf('d64', releaseImage('d64', r.prg!, { name: 'MAIN' }))).toBe(0x46);
  }, 300_000);
});
