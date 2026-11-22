/* Disk-Speed on a disk (c64/diskspeed.ts, spec 13.5p): the boot decoded as it decodes itself (its B-E command and its
 * call between files), the drive code's DOS reads whose status is the key, the next stage decoded with it (or, on a
 * copy that reads them right, with the key worked out from its first instruction), its table and the files from
 * 14/15 on, 11 sectors on and the next track down at sector 0, every byte inverted; the loader in a program
 * (analyze/loaders.ts). The disks are made here (helpers/diskspeed-disk.ts). */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyze, diskSpeedFileList, diskSpeedPrg, makeD64, readDiskSpeedDisk, type ProjectInput } from '../src';
import { fromSource } from './helpers/programs';
import { DEMO_FILES, DEMO_START, diskSpeedD64, fill } from './helpers/diskspeed-disk';

describe('Disk-Speed on a disk', () => {
  it('reads the boot, the drive code, the key from the checksum errors, the table and its files', () => {
    const p = readDiskSpeedDisk(diskSpeedD64())!;
    expect(p).not.toBeNull();
    expect(p.format).toBe('D64');
    expect(p.text).toBe("THIS DEMO USES THE 'DISK-SPEED' LOADING SYSTEM");
    expect(p.boot).toEqual({ name: 'BOOT', track: 14, sector: 12, blocks: 2, load: 0x0308, end: 0x0420, command: 'B-E 2 0 14 0', hook: { at: 0x033c, left: 2 } });
    expect(p.stage1).toEqual({ track: 14, sector: 0, at: 0x0500 });
    expect(p.checks).toEqual([{ track: 14, sector: 3, status: 5 }, { track: 14, sector: 14, status: 5 }]);
    expect([p.key, p.keyFrom]).toEqual([5, 'errors']);
    expect(p.stage2).toEqual([{ track: 36, sector: 11, at: 0x0300 }, { track: 36, sector: 1, at: 0x0400 }]);
    expect([p.table, p.data, p.stepping]).toEqual([{ track: 14, sector: 4 }, { track: 14, sector: 15 }, { step: 11, count: 21, down: true }]);
    expect(p.start).toBe(DEMO_START);
    expect(p.files.map(f => [f.name, f.load, f.end, f.pages, f.part, f.ok])).toEqual([
      ['INTRO.prg', 0x0801, 0x0929, 1, 40, true], ['MAIN.prg', 0x2000, 0x2300, 3, 0, true], ['HOOK.prg', 0x033c, 0x0346, 0, 10, true],
    ]);
    // as the C64 gets them: the disk holds every byte inverted
    p.files.forEach((f, i) => expect(f.bytes).toEqual(DEMO_FILES[i].bytes));
    // 14/15, then 11 on each time round a track of 21
    expect(p.files.flatMap(f => f.sectors)).toEqual(['14/15', '14/5', '14/16', '14/6', '14/17', '14/7']);
    expect(p.files[0].note).toContain('the program starts here, at $0810');
    expect(p.files[2].note).toContain('the boot calls $033c (JSR) when 2 files are left, before MAIN loads');
    expect(p.summary).toBe('Disk-Speed (Morse Technology): 3 files from the table at 14/4, the program starting at $0810; the drive code at 14/0 reads 14/3 and 14/14 (status $05 and $05), its key $05 for 36/11 + 36/1');
  });

  it('goes to the next track down when the step comes round to sector 0', () => {
    const big = [{ name: 'BIG', load: 0x1000, bytes: fill(14 * 256, 4) }];
    const p = readDiskSpeedDisk(diskSpeedD64({ files: big }))!;
    expect(p.files[0].sectors.slice(10)).toEqual(['14/20', '14/10', '13/0', '13/11']);
    expect(p.files[0].bytes).toEqual(big[0].bytes);
    expect(p.files[0].ok).toBe(true);
  });

  it('works the key out from the next stage on a copy whose checks read right, or a D64 with no error bytes', () => {
    for (const disk of [diskSpeedD64({ checks: [1, 1], key: 5 }), diskSpeedD64({ errors: false, key: 5 })]) {
      const p = readDiskSpeedDisk(disk)!;
      expect(p.checks.map(c => c.status)).toEqual([1, 1]);
      expect([p.key, p.keyFrom]).toEqual([5, 'code']);
      expect(p.files.map(f => f.ok)).toEqual([true, true, true]);
      expect(p.summary).toContain('no error on this image, the key from the code $05');
    }
  });

  it('finds the drive code by its own bytes when the directory does not have the boot', () => {
    const p = readDiskSpeedDisk(diskSpeedD64({ boot: false }))!;
    expect(p.boot).toBeNull();
    expect(p.stage1).toEqual({ track: 14, sector: 0, at: 0x0500 });
    expect(p.files).toHaveLength(3);
    expect(p.files[2].note).not.toContain('the boot calls');
  });

  it("says when a file's bytes do not come to its checksum", () => {
    const p = readDiskSpeedDisk(diskSpeedD64({ badSum: true }))!;
    expect(p.files.map(f => f.ok)).toEqual([true, false, true]);
    expect(p.files[1].note).toContain('checksum $00 wrong'.replace('$00', `$${p.files[1].sum.toString(16).padStart(2, '0')}`));
  });

  it('gives the files as PRGs and as a list', () => {
    const p = readDiskSpeedDisk(diskSpeedD64())!;
    expect([...diskSpeedPrg(p.files[2])]).toEqual([0x3c, 0x03, ...DEMO_FILES[2].bytes]);
    const list = diskSpeedFileList(p, 'demo.d64');
    expect(list[0]).toBe("; Disk-Speed files of demo.d64, read by Mimir Studio: 3 files of the loader's table at 14/4 (the directory lists only the boot).");
    expect(list[3]).toMatch(/^INTRO\.prg +; 14\/15, 2 sectors, loads at \$0801-\$0928 \(296 bytes\): 1 whole sector and 40 bytes of one more, inverted on the disk; checksum \$[0-9a-f]{2} right; the program starts here, at \$0810$/);
  });

  it('finds nothing on other disks', () => {
    expect(readDiskSpeedDisk(makeD64({ name: 'plain', files: [{ name: 'A', data: Uint8Array.from([0x01, 0x08, 0x60]) }] }))).toBeNull();
    // a next stage that is no code with any key
    const broken = diskSpeedD64();
    const off = (() => { let n = 0; for (let t = 1; t < 36; t++) n += t <= 17 ? 21 : t <= 24 ? 19 : t <= 30 ? 18 : 17; return (n + 11) * 256; })();
    broken.set([0x4c ^ 5, 0x00, 0x90], off);
    expect(readDiskSpeedDisk(broken)).toBeNull();
  });
});

describe('the Disk-Speed disk fixture', () => {
  it('is fixtures/d64/diskspeed-demo.d64, which the e2e tests mount: the raster demo, a sine table and the hook', () => {
    const demo = new Uint8Array(readFileSync(join(__dirname, '../../../fixtures/prg/raster-demo.prg')));
    const sine = Uint8Array.from({ length: 256 }, (_, i) => Math.round(127.5 + 127.5 * Math.sin((i / 256) * 2 * Math.PI)));
    const disk = diskSpeedD64({ files: [{ name: 'DEMO', load: 0x0801, bytes: demo.subarray(2) }, { name: 'SINE', load: 0x4000, bytes: sine }, DEMO_FILES[2]] });
    const path = join(__dirname, '../../../fixtures/d64/diskspeed-demo.d64');
    if (process.env.WRITE_FIXTURES) writeFileSync(path, disk);
    expect(new Uint8Array(readFileSync(path))).toEqual(disk);
    const p = readDiskSpeedDisk(disk)!;
    expect(p.files.map(f => f.name)).toEqual(['DEMO.prg', 'SINE.prg', 'HOOK.prg']);
    expect(diskSpeedPrg(p.files[0])).toEqual(demo);
    expect(p.files.every(f => f.ok)).toBe(true);
    expect(p.summary).toBe('Disk-Speed (Morse Technology): 3 files from the table at 14/4, the program starting at $0810; the drive code at 14/0 reads 14/3 and 14/14 (status $05 and $05), its key $05 for 36/11 + 36/1');
  });
});

const BASIC = '.pc = $0801\n.byte $0b,$08,$0a,$00,$9e,$32,$30,$36,$31,$00,$00,$00\n.pc = $080d\n';
const project = (src: string): ProjectInput => ({ name: 'loader', files: [fromSource('loader.prg', BASIC + src)] });

/** a receive routine in the form of Disk-Speed's (lines let go, wait for CLK, pull it, wait, read the bus four times) */
const SOURCE = ` jsr recv
 rts
recv: lda #$27
 sta $dd00
wait: bit $dd00
 bvc wait
 lda #$03
 sta $dd00
 ldx #$07
delay: dex
 bpl delay
 ldx #$03
bits: lda $dd00
 asl
 php
 asl
 rol $bd
 plp
 rol $bd
 dex
 bpl bits
 lda #$17
 sta $dd00
 lda $bd
 rts
`;

describe('the Disk-Speed loader', () => {
  it('is known by its receive routine', () => {
    const ds = analyze(project(SOURCE)).loaders.find(l => l.id === 'diskspeed');
    expect(ds).toBeDefined();
    expect(ds!.parts.map(p => p.role)).toEqual(['resident']);
  });
});
