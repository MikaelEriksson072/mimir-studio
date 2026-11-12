/* Sindri (packages/sindri) as Mimir uses it: fakePack's decruncher gives the demo back byte for
 * byte, with the stand-ins and with VICE's ROMs when VICE is installed; the layer report and the summary the packed
 * notice shows; VICE's ROMs found next to the x64sc in the settings; an Exomizer self-extracting file named by its
 * fingerprint when Exomizer is installed; and, with VICE's 1541 DOS ROM, a program that loads its next file from the
 * disk it came from; and a VICE snapshot, which Sindri goes on from where it was taken. */
import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { conclusive, DEFAULT_PACK, depackers, makeD64, makeDemo, makePrg, openC64File, packedData, packerNames, parsePrg, unpackLog, unpackPrg, unpackSummary, type Roms } from '../src';
import { findC64Roms, findExomizer, runExomizer, viceRomFolders } from '../src/node';
import { fakePack } from './helpers/fake-packer';
import { fromSource } from './helpers/programs';

const demo = makeDemo().prg;
const packed = fakePack(demo, 0x0810);
/** fixtures/prg/packed-menu.prg, packed twice with a wait between, as a cracked game's trainer menu waits in front of
 *  the packed game: fakePack unpacks $07f0-$390c and starts it at $07f8, which waits for a key (GETIN) and then starts
 *  the demo packed by fakePack ($080d); $07f0-$07f7 and $0800 hold JAMs, so neither SYS to where it loads nor RUN
 *  starts it */
const menuPacked = (() => {
  const head = [0x02, 0x02, 0x02, 0x02, 0x02, 0x02, 0x02, 0x02, 0x20, 0xe4, 0xff, 0xf0, 0xfb, 0x4c, 0x0d, 0x08, 0x02];
  return fakePack(makePrg(0x07f0, Uint8Array.from([...head, ...packed.subarray(2)])), 0x07f8);
})();
/** fixtures/prg/packed-rom.prg, as Cybernoid 2's game starts at $a2ab with $01 = $36: fakePack unpacks a stage at
 *  $0900 that copies a program to $a000, under the BASIC ROM, and starts it with $01 = $36 */
const romPacked = (() => {
  const f = fromSource('rom.prg', '.pc = $0900\n ldx #5\nc:\n lda game,x\n sta $a000,x\n dex\n bpl c\n lda #$36\n sta $01\n jmp $a000\ngame:\n inc $d020\n jmp $a000\n.fill 400, $55');
  return fakePack(makePrg(f.load, f.bytes), 0x0900);
})();
const roms = findC64Roms();
const modes: [string, Roms | null][] = roms ? [['stand-ins', null], ['ROMs', roms]] : [['stand-ins', null]];

for (const [mode, r] of modes) {
  describe(`Sindri with the ${mode}`, () => {
    it('unpacks fakePack: the demo, byte for byte, starting at $0810', () => {
      const run = unpackPrg(packed, r);
      expect(run.unpacked).toBe(true);
      expect(run.saved).toMatchObject({ layer: 2, start: 0x0801, end: 0x37ff, entry: 0x0810, basic: false });
      expect(run.saved!.prg).toEqual(demo);
      expect(run.layers.map(l => [l.entry, l.kind])).toEqual([[0x080d, 'mover'], [0x0340, 'decoder'], [0x0810, 'program']]);
      expect(depackers(run).map(l => l.entry)).toEqual([0x080d, 0x0340]);
      expect(conclusive(run)).toBe(true);
      // fakePack is no packer the signatures know: its layers go by their fingerprints
      expect(packerNames(run)).toBeNull();
      expect(unpackSummary(run)).toMatch(/^Sindri peels off 2 layers: an unknown mover at \$080d \(fingerprint [0-9a-f]{8}\), then an unknown decoder at \$0340 \(fingerprint [0-9a-f]{8}\); the program starts at \$0810$/);
      const log = unpackLog(run, 'packed.prg', 0x0801, packed.length - 2).split('\n');
      expect(log.slice(0, 2)).toEqual(['packed.prg: $0801-$390c (12.3 KB), 10 SYS2061', `ROMs: ${r ? r.source : 'stand-ins (no ROM files)'}`]);
      expect(log).toContain('layer 1  $0340  jmp from $0839  decoder');
      expect(log).toContain('         text: "FAKEPACK"');
      expect(log.at(-1)).toBe('saved layer 2: $0801-$37ff (12.0 KB), start with SYS 2064 = $0810');
    });

    it('unpacks a program that waits for a key in front of more packing when it is run from its start', () => {
      // the first run stops at the wait (no keys once something was unpacked), and saves it with its start
      const first = unpackPrg(menuPacked, r);
      expect(first.layers.map(l => [l.entry, l.kind])).toEqual([[0x080d, 'mover'], [0x0340, 'decoder'], [0x07f8, 'program']]);
      expect(first.saved).toMatchObject({ start: 0x07f0, end: 0x390c, entry: 0x07f8, basic: false });
      // run as LOAD leaves it, SYS to where it loads hits a JAM; from its start, the keys Sindri presses go on to the demo
      expect(unpackPrg(first.saved!.prg, r)).toMatchObject({ unpacked: false, stop: { reason: 'jam' } });
      const second = unpackPrg(first.saved!.prg, r, null, 0x07f8);
      expect(second.layers.map(l => [l.entry, l.kind])).toEqual([[0x07f8, 'mover'], [0x0340, 'decoder'], [0x0810, 'program']]);
      expect(second.layers[0].presses.length).toBeGreaterThan(0);
      expect(second.saved).toMatchObject({ start: 0x0801, end: 0x37ff, entry: 0x0810 });
      expect(second.saved!.prg).toEqual(demo);
    });

    it('finds nothing to unpack in the plain demo', () => {
      const run = unpackPrg(demo, r);
      expect(run).toMatchObject({ unpacked: false, saved: null });
      expect(packerNames(run)).toBeNull();
      expect(unpackSummary(run)).toMatch(/^Sindri peels off no layer \(it stopped: /);
      expect(unpackLog(run, 'demo.prg', 0x0801, demo.length - 2).split('\n').at(-1)).toBe('nothing was unpacked');
    });
  });
}

describe('the C64 ROMs for Sindri', () => {
  it('are looked for in VICE\'s C64 folder: beside its bin folder, beside the program, in share/vice', () => {
    expect(viceRomFolders(join('vice', 'bin', 'x64sc.exe'))).toEqual([join('vice', 'C64'), join('vice', 'bin', 'C64'), join('vice', 'share', 'vice', 'C64')]);
    expect(viceRomFolders('  ')).toEqual([]);
  });

  it('come from the VICE in the settings first', () => {
    const vice = mkdtempSync(join(tmpdir(), 'mimir-vice-'));
    mkdirSync(join(vice, 'bin'));
    mkdirSync(join(vice, 'C64'));
    writeFileSync(join(vice, 'C64', 'kernal-901227-03.bin'), new Uint8Array(0x2000));
    writeFileSync(join(vice, 'C64', 'basic-901226-01.bin'), new Uint8Array(0x2000));
    writeFileSync(join(vice, 'C64', 'chargen-901225-01.bin'), new Uint8Array(0x1000));
    const found = findC64Roms(join(vice, 'bin', 'x64sc.exe'));
    expect(found?.source).toBe(join(vice, 'bin', '..', 'C64'));
    expect([found?.kernal.length, found?.basic.length, found?.chargen.length]).toEqual([0x2000, 0x2000, 0x1000]);
  });
});

describe.skipIf(!roms?.drive)('Sindri with the disk in a 1541', () => {
  // 10 SYS2061: LOAD "PART2",8,1 through the KERNAL, then JMP $C000
  const boot = makePrg(0x0801, Uint8Array.from([
    0x0b, 0x08, 0x0a, 0x00, 0x9e, 0x32, 0x30, 0x36, 0x31, 0x00, 0x00, 0x00,
    0xa9, 0x05, 0xa2, 0x2f, 0xa0, 0x08, 0x20, 0xbd, 0xff, 0xa9, 0x01, 0xa2, 0x08, 0xa0, 0x01, 0x20, 0xba, 0xff,
    0xa9, 0x00, 0x20, 0xd5, 0xff, 0xb0, 0x03, 0x4c, 0x00, 0xc0, 0xee, 0x20, 0xd0, 0x4c, 0x29, 0x08,
    0x50, 0x41, 0x52, 0x54, 0x32,
  ]));
  // inc $d020 / dec $d021 / jmp $c000, and 600 bytes after it
  const part2 = makePrg(0xc000, Uint8Array.from([0xee, 0x20, 0xd0, 0xce, 0x21, 0xd0, 0x4c, 0x00, 0xc0, ...Array.from({ length: 600 }, (_, i) => (i * 37) & 0xff)]));
  const disk = makeD64({ name: 'mimir test', id: 'mt', files: [{ name: 'boot', data: boot }, { name: 'part2', data: part2 }] });

  it('follows the next file the program loads from the disk, and the report names the drive', () => {
    const run = unpackPrg(boot, roms, disk);
    expect(run.layers.map(l => l.entry)).toEqual([0x080d, 0xc000]);
    expect(run.saved).toMatchObject({ entry: 0xc000, start: 0xc000 });
    expect(run.saved!.prg).toEqual(part2);
    expect(unpackLog(run, 'boot', 0x0801, boot.length - 2).split('\n')[2]).toMatch(/^Drive: 1541 with "MIMIR TEST" MT, \d+ bytes read$/);
  });

  it('stops where the program loads without the disk', () => {
    expect(unpackPrg(boot, roms).stop).toMatchObject({ reason: 'load', detail: 'loads "PART2" from device 8' });
  });
});

const vendored = join(__dirname, '..', '..', '..', 'apps', 'desktop', 'vendor', 'exomizer', 'exomizer.exe');
const EXO = findExomizer([process.env.EXOMIZER || '', process.platform === 'win32' && existsSync(vendored) ? vendored : ''].filter(Boolean));

describe.skipIf(!EXO)('an Exomizer self-extracting file', () => {
  it('is named by its fingerprint and unpacks to the demo', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mimir-unpacker-'));
    try {
      const sfx = await runExomizer({ exe: EXO!, dir, files: [{ name: 'demo.prg', prg: demo }], prefs: DEFAULT_PACK });
      expect(sfx.ok).toBe(true);
      const run = unpackPrg(sfx.out!.prg, roms);
      expect(packerNames(run)).toMatch(/^Exomizer/);
      expect(unpackSummary(run)).toMatch(/^Sindri peels off \d layers?: .*Exomizer.* \(a decruncher at \$[0-9a-f]{4}\).*; the program starts at \$0810$/);
      // the demo's bytes are all there, in place
      const out = parsePrg('out', run.saved!.prg), d = parsePrg('demo', demo);
      expect(out.load).toBeLessThanOrEqual(d.load);
      expect(out.bytes.subarray(d.load - out.load, d.load - out.load + d.bytes.length)).toEqual(d.bytes);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('the fixture fixtures/prg/packed-menu.prg', () => {
  it('is the demo packed twice with a wait for a key between, which the e2e tests unpack in two steps', () => {
    const path = join(__dirname, '../../../fixtures/prg/packed-menu.prg');
    if (process.env.WRITE_FIXTURES) writeFileSync(path, menuPacked);
    expect(new Uint8Array(readFileSync(path))).toEqual(menuPacked);
  });
});

describe('the fixture fixtures/prg/packed-rom.prg', () => {
  it('unpacks to a program under the BASIC ROM that starts with $01 = $36, and runs again from there with it', () => {
    const path = join(__dirname, '../../../fixtures/prg/packed-rom.prg');
    if (process.env.WRITE_FIXTURES) writeFileSync(path, romPacked);
    expect(new Uint8Array(readFileSync(path))).toEqual(romPacked);
    for (const [mode, r] of modes) {
      const run = unpackPrg(romPacked, r);
      expect(run.saved, mode).toMatchObject({ entry: 0xa000, port: 0x36, basic: false });
      // Unpack again from that start (the app's runStart): with its $01 the program runs; with $37, BASIC's ROM
      const again = (port: number | null) => unpackPrg(run.saved!.prg, r, null, 0xa000, null, null, port);
      expect(again(0x36).layers[0]?.entry, mode).toBe(0xa000);
      expect(again(null).layers[0]?.entry, mode).not.toBe(0xa000);
    }
  });
});

describe.skipIf(!roms)('Sindri going on from a VICE snapshot', () => {
  const fixture = (name: string) => new Uint8Array(readFileSync(join(__dirname, '../../../fixtures/vsf', name)));
  const run = (vsf: Uint8Array) => { const f = openC64File('snap.vsf', vsf); return { f, run: unpackPrg(makePrg(f.load, f.bytes), roms, null, null, null, vsf) }; };

  it('unpacks what was still packed: packed-menu.vsf, stopped where it waits for a key, gives the demo', () => {
    // fixtures/vsf/packed-menu.vsf: fixtures/prg/packed-menu.prg in x64sc 3.10, stopped at $07f8 (make-packed-menu.mon)
    const { f, run: r } = run(fixture('packed-menu.vsf'));
    expect(r.snapshot).toBe(0x07f8);
    expect(r.layers.map(l => [l.entry, l.kind])).toEqual([[0x07f8, 'mover'], [0x0340, 'decoder'], [0x0810, 'program']]);
    expect(r.layers[0].presses.length).toBeGreaterThan(0);
    expect(packedData(r)).toEqual([{ start: 0x090e, end: 0x390c }]);
    expect(unpackSummary(r)).toMatch(/^Going on from the snapshot \(the CPU at \$07f8\), Sindri peels off 2 layers: an unknown mover at \$07f8 \(fingerprint [0-9a-f]{8}\), then an unknown decoder at \$0340 \(fingerprint [0-9a-f]{8}\); the packed data was at \$090e-\$390c; the program starts at \$0810$/);
    expect(unpackLog(r, f.name, f.load, f.bytes.length).split('\n')[2]).toBe('Snapshot: going on from where it was taken, the CPU at $07f8 (its RAM, VIC-II and CIAs; not its 1541)');
    const s = r.saved!, at = 0x0801 - s.start + 2, d = demo.subarray(2);
    expect(s.entry).toBe(0x0810);
    expect(s.prg.subarray(at, at + d.length)).toEqual(d);
  });

  it('finds nothing to unpack in the snapshot of the raster demo', () => {
    const { run: r } = run(fixture('raster-demo.vsf'));
    expect(r).toMatchObject({ unpacked: false, snapshot: 0x08c7 });
    expect(packedData(r)).toEqual([]);
    expect(unpackSummary(r)).toMatch(/^Going on from the snapshot \(the CPU at \$08c7\), Sindri peels off no layer \(it stopped: settled/);
  });
});
