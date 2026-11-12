/* Build & Run's VICE command line (spec 13.2). With a program start set, VICE loads the PRG without RUN and
 * types `sys <start>`; a program over BASIC's work area ($0002-$03ff, a memory dump say) leaves no BASIC to type
 * into, so VICE stops at READY and loads and starts it from the monitor. The real-VICE part runs when x64sc is
 * found (VICE env var or the usual folders): headless (-console), with a config file of its own (nothing is saved
 * to the user's vice.ini), and the debug cartridge makes VICE exit with the value written to $d7ff, which tells
 * which code ran. */
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analyze, builtCartridge, coversReadyScreen, makeD64, makePrg, makeT64, makeTap, openCartridge, overwritesSystemArea, parseVsf, startsFromMonitor, patchSnapshot, readTape, render, replaceTapeFile, verify, writeT64 } from '../src';
import { DRIVE_INIT, findVice, prepareVice, startStatements, typedLines, viceArgv, viceMonitorScript } from '../src/node';
import { fromSource } from './helpers/programs';
import { readPng } from './helpers/png';
import { bootLoader, tinyFile, TurboWriter, withTurbo } from './helpers/tapetool-tape';

describe('VICE command line', () => {
  it('autostarts without a program start', () => {
    expect(viceArgv({ args: ['-autostartprgmode', '1'], prgPath: 'p.prg', labelsPath: 'p.vs' })).toEqual(['-autostartprgmode', '1', '-moncommands', 'p.vs', '-autostart', 'p.prg']);
  });

  it('loads without RUN and types sys <start> with one', () => {
    expect(viceArgv({ prgPath: 'p.prg', start: 0x0866 })).toEqual(['-autoload', 'p.prg', '-keybuf', 'sys2150\\n']);
    // the virtual file system mode loads through the keyboard buffer itself: inject is used instead
    expect(viceArgv({ args: ['-autostartprgmode', '0'], prgPath: 'p.prg', start: 0x0866 })).toEqual(['-autostartprgmode', '0', '-autostartprgmode', '1', '-autoload', 'p.prg', '-keybuf', 'sys2150\\n']);
    expect(viceArgv({ args: ['-autostartprgmode', '0'], prgPath: 'p.prg' })).toEqual(['-autostartprgmode', '0', '-autostart', 'p.prg']);
  });

  it('starts from the monitor at READY: labels, load at the PRG address into RAM, go', () => {
    expect(viceArgv({ args: ['-autostartprgmode', '1'], prgPath: 'p.prg', start: 0x1000, via: 'monitor', scriptPath: 'p.start.mon' }))
      .toEqual(['-autostartprgmode', '1', '-moncommands', 'p.start.mon', '-initbreak', 'ready']);
    expect(viceMonitorScript({ prgPath: 'C:\\b uild\\test.prg', start: 0x1000, labels: 'al C:1000 .start\r\nal C:1010 .loop' }))
      .toBe('al C:1000 .start\nal C:1010 .loop\nbank ram\nl "C:\\b uild\\test.prg" 0\nbank cpu\ng 1000\n');
    expect(viceMonitorScript({ prgPath: 'p.prg', start: 0x080d })).toBe('bank ram\nl "p.prg" 0\nbank cpu\ng 080d\n');
    // with a disk in drive 8 the last device is 8, as loading from it leaves it
    expect(viceMonitorScript({ prgPath: 'p.prg', start: 0x1400, disk: true })).toBe('> C:00ba 08\nbank ram\nl "p.prg" 0\nbank cpu\ng 1400\n');
  });

  it('starts a program with the $01 Sindri saw at its start: a stub typed with POKEs, or set from the monitor', () => {
    // BASIC runs in the ROM $01 switches off: `lda #$36 / sta $01 / jmp $a2ab` at $02a7, then sys679
    expect(startStatements(0xa2ab, 0x36)).toEqual(['poke679,169', 'poke680,54', 'poke681,133', 'poke682,1', 'poke683,76', 'poke684,171', 'poke685,162', 'sys679']);
    expect(startStatements(0xa2ab, 0x37)).toEqual(['sys41643']);
    expect(startStatements(0xa2ab, null)).toEqual(['sys41643']);
    const pokes = 'poke679,169:poke680,54:poke681,133:poke682,1:poke683,76:poke684,171:poke685,162';
    expect(viceArgv({ prgPath: 'p.prg', start: 0xa2ab, port: 0x36 })).toEqual(['-autoload', 'p.prg', '-keybuf', `${pokes}\\nsys679\\n`]);
    // with a disk: the drive reads it first, on a line of its own (each line within BASIC's 80)
    const lines = viceArgv({ prgPath: 'p.prg', start: 0xa2ab, port: 0x36, disk: 'd.d64' }).at(-1)!.split('\\n').filter(Boolean);
    expect(lines).toEqual([DRIVE_INIT.slice(0, -1), pokes, 'sys679']);
    for (const l of lines) expect(l.length).toBeLessThanOrEqual(79);
    expect(typedLines(['a'.repeat(70), 'b'.repeat(8), 'c'])).toBe(`${'a'.repeat(70)}:${'b'.repeat(8)}\\nc\\n`);
    expect(viceMonitorScript({ prgPath: 'p.prg', start: 0xa2ab, port: 0x36, disk: true })).toBe('> C:00ba 08\nbank ram\nl "p.prg" 0\nbank cpu\n> C:0001 36\ng a2ab\n');
    expect(viceMonitorScript({ prgPath: 'p.prg', start: 0x1400, port: 0x37 })).toBe('bank ram\nl "p.prg" 0\nbank cpu\ng 1400\n');
  });

  it('puts a disk in drive 8, with the inject PRG mode (the disk image mode would replace it), and has the drive read it first', () => {
    // no string literal: BASIC would copy it into string space, which a program up to $a000 or beyond leaves none of
    const init = 'open15,8,15:poke781,15:sys65481:poke780,73:sys65490:sys65484:close15:';
    expect(DRIVE_INIT).toBe(init);
    expect(init).not.toContain('"');
    expect(`${init}sys65535`.length).toBeLessThanOrEqual(80); // BASIC's line
    expect(viceArgv({ prgPath: 'p.prg', disk: 'd.d64' })).toEqual(['-autostartprgmode', '1', '-8', 'd.d64', '-autoload', 'p.prg', '-keybuf', `${init}run\\n`]);
    expect(viceArgv({ args: ['-autostartprgmode', '1'], prgPath: 'p.prg', labelsPath: 'p.vs', start: 0x0801, disk: 'd.d64' }))
      .toEqual(['-autostartprgmode', '1', '-8', 'd.d64', '-moncommands', 'p.vs', '-autoload', 'p.prg', '-keybuf', `${init}sys2049\\n`]);
    expect(viceArgv({ args: ['-autostartprgmode', '2'], prgPath: 'p.prg', disk: 'd.d64' })).toEqual(['-autostartprgmode', '2', '-autostartprgmode', '1', '-8', 'd.d64', '-autoload', 'p.prg', '-keybuf', `${init}run\\n`]);
    // started from the monitor: the drive reads the disk first, typed at READY with nothing loaded, and sys679 stops in
    // the monitor, which loads the program over what the typing wrote
    expect(viceArgv({ prgPath: 'p.prg', start: 0x1000, via: 'monitor', scriptPath: 'p.start.mon', disk: 'd.d64' }))
      .toEqual(['-8', 'd.d64', '-keybuf', `${init}sys679\\n`, '-moncommands', 'p.start.mon', '-initbreak', '0x02a7']);
    // a snapshot brings its drive as it was taken
    expect(viceArgv({ prgPath: 'p.vsf', disk: 'd.d64' })).toEqual(['-autostartprgmode', '1', '-8', 'd.d64', '-autostart', 'p.vsf']);
  });

  it('puts a tape in the datasette (-1), and autostarts a tape given as the program', () => {
    expect(viceArgv({ prgPath: 'p.prg', tape: 't.tap' })).toEqual(['-1', 't.tap', '-autostart', 'p.prg']);
    expect(viceArgv({ prgPath: 'p.prg', disk: 'd.d64', tape: 't.tap' }).slice(0, 6)).toEqual(['-autostartprgmode', '1', '-8', 'd.d64', '-1', 't.tap']);
    // the tape's first file loads with the KERNAL: no drive to read the disk first
    expect(viceArgv({ prgPath: 'b.tap', labelsPath: 'p.vs', disk: 'd.d64' })).toEqual(['-autostartprgmode', '1', '-8', 'd.d64', '-moncommands', 'p.vs', '-autostart', 'b.tap']);
    // a T64 has no pulses: VICE reads it through its tape traps
    expect(viceArgv({ prgPath: 'b.t64', disk: 'd.d64' })).toEqual(['-autostartprgmode', '1', '-8', 'd.d64', '-trapdevice1', '-autostart', 'b.t64']);
    expect(viceArgv({ prgPath: 'p.prg', tape: 't.T64' })).toEqual(['-trapdevice1', '-1', 't.T64', '-autostart', 'p.prg']);
  });

  it('attaches a cartridge (-cartcrt) instead of starting a program, with the labels and a disk', async () => {
    expect(viceArgv({ args: ['-autostartprgmode', '1'], prgPath: 'c.crt', labelsPath: 'p.vs', cart: true })).toEqual(['-autostartprgmode', '1', '-moncommands', 'p.vs', '-cartcrt', 'c.crt']);
    expect(viceArgv({ prgPath: 'c.crt', disk: 'd.d64', start: 0x1000, cart: true })).toEqual(['-8', 'd.d64', '-cartcrt', 'c.crt']);
    expect(await prepareVice({ prgPath: 'c.crt', cart: true })).toEqual({ argv: ['-cartcrt', 'c.crt'], via: 'cart' });
  });

  it('knows which programs overwrite BASIC\'s work area', () => {
    expect(overwritesSystemArea(0x0002, 0xfffe)).toBe(true); // a memory dump
    expect(overwritesSystemArea(0x0326, 2)).toBe(true); // vector-hijacking autostart loaders
    expect(overwritesSystemArea(0x03ff, 1)).toBe(true);
    expect(overwritesSystemArea(0x0400, 0x1000)).toBe(false); // the screen is not BASIC's
    expect(overwritesSystemArea(0x0801, 0x2000)).toBe(false);
    expect(overwritesSystemArea(0x0000, 2)).toBe(false); // $00/$01 are the CPU port, not RAM BASIC needs
    // ... but typing at READY writes on the screen: a program over it starts from the monitor too
    expect(coversReadyScreen(0x0400, 0xfc00)).toBe(true); // a game Sindri saved (Cybernoid 2)
    expect(coversReadyScreen(0x07e7, 1)).toBe(true);
    expect(coversReadyScreen(0x07e8, 0x100)).toBe(false);
    expect(coversReadyScreen(0x0801, 0x2000)).toBe(false);
    expect(startsFromMonitor(0x0400, 0x1000)).toBe(true);
    expect(startsFromMonitor(0x0200, 0x100)).toBe(true);
    expect(startsFromMonitor(0x0801, 0x2000)).toBe(false);
  });

  it('picks the start from the PRG and writes the monitor file next to it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mimir-vice-'));
    try {
      const basic = join(dir, 'basic.prg'), dump = join(dir, 'dump.prg'), vs = join(dir, 'dump.vs'), screen = join(dir, 'screen.prg');
      await writeFile(basic, Uint8Array.from([0x01, 0x08, 0x60]));
      await writeFile(screen, Uint8Array.from([0x00, 0x04, ...new Uint8Array(0x1000)]));
      await writeFile(dump, Uint8Array.from([0x02, 0x00, ...new Uint8Array(0x400)]));
      await writeFile(vs, 'al C:0002 .zp\n');
      expect(await prepareVice({ prgPath: basic })).toEqual({ argv: ['-autostart', basic], via: 'run' });
      expect(await prepareVice({ prgPath: dump })).toEqual({ argv: ['-autostart', dump], via: 'run' }); // RUN: the app warns
      expect(await prepareVice({ prgPath: basic, start: 0x0801 })).toEqual({ argv: ['-autoload', basic, '-keybuf', 'sys2049\\n'], via: 'sys' });
      const m = await prepareVice({ prgPath: dump, labelsPath: vs, start: 0x0300 });
      expect(m).toEqual({ argv: ['-moncommands', join(dir, 'dump.start.mon'), '-initbreak', 'ready'], via: 'monitor' });
      expect(await readFile(join(dir, 'dump.start.mon'), 'utf8')).toBe(`al C:0002 .zp\nbank ram\nl "${dump}" 0\nbank cpu\ng 0300\n`);
      // over the screen at READY, with the $01 Sindri saw at the start
      expect(await prepareVice({ prgPath: screen, start: 0x1000, port: 0x36 })).toEqual({ argv: ['-moncommands', join(dir, 'screen.start.mon'), '-initbreak', 'ready'], via: 'monitor' });
      expect(await readFile(join(dir, 'screen.start.mon'), 'utf8')).toBe(`bank ram\nl "${screen}" 0\nbank cpu\n> C:0001 36\ng 1000\n`);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

const vice = process.env.VICE || findVice();

describe.skipIf(!vice)(`real VICE (${vice ?? 'not found'})`, () => {
  const headless = (dir: string) => ['-config', join(dir, 'vice.ini'), '-default', '-console', '-sounddev', 'dummy', '+confirmonexit', '-debugcart', '-limitcycles', '40000000', '-autostartprgmode', '1'];
  const prgOf = (f: { load: number; bytes: Uint8Array }) => Uint8Array.from([f.load & 0xff, f.load >> 8, ...f.bytes]);

  it('starts the program at the address it is given, and with RUN otherwise', async () => {
    // 10 SYS2061 → exit $11; the program start set by the user at $0820 → exit $42
    const f = fromSource('start.prg', '.pc = $0801\n.byte $0b,$08,$0a,$00,$9e,$32,$30,$36,$31,$00,$00,$00\n.pc = $080d\n lda #$11\n sta $d7ff\n jmp *\n.pc = $0820\n lda #$42\n sta $d7ff\n jmp *');
    const dir = await mkdtemp(join(tmpdir(), 'mimir-vice-'));
    try {
      const prgPath = join(dir, 'start.prg');
      await writeFile(prgPath, prgOf(f));
      const run = async (start?: number) => {
        const { argv } = await prepareVice({ args: headless(dir), prgPath, start });
        return spawnSync(vice!, argv, { timeout: 90_000, windowsHide: true }).status;
      };
      expect(await run()).toBe(0x11);
      expect(await run(0x0820)).toBe(0x42);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('puts the disk in drive 8: the program loads its second part from it', async () => {
    // 10 SYS2061: LOAD"PART2",8,1 through the KERNAL, then jump to it; PART2 (on the disk only) exits with $42
    const f = fromSource('loader.prg', '.pc = $0801\n.byte $0b,$08,$0a,$00,$9e,$32,$30,$36,$31,$00,$00,$00\n.pc = $080d\n lda #5\n ldx #<name\n ldy #>name\n jsr $ffbd\n lda #1\n ldx #8\n ldy #1\n jsr $ffba\n lda #0\n jsr $ffd5\n bcs fail\n jmp $c000\nfail:\n lda #$ee\n sta $d7ff\n jmp *\nname: .byte $50,$41,$52,$54,$32');
    const dir = await mkdtemp(join(tmpdir(), 'mimir-vice-'));
    try {
      const prgPath = join(dir, 'loader.prg'), disk = join(dir, 'disk.d64');
      await writeFile(prgPath, prgOf(f));
      await writeFile(disk, makeD64({ name: 'parts', files: [{ name: 'part2', data: Uint8Array.from([0x00, 0xc0, 0xa9, 0x42, 0x8d, 0xff, 0xd7, 0x4c, 0x05, 0xc0]) }] }));
      const { argv } = await prepareVice({ args: headless(dir), prgPath, disk });
      expect(spawnSync(vice!, argv, { timeout: 90_000, windowsHide: true }).status).toBe(0x42);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('autostarts a tape: the boot file\'s loader reads the next file from the datasette; the same with the boot file written again', async () => {
    // the boot loader of the tape fixtures (in the tape buffer, started through $0302) reads a TinyHeader file that
    // exits with $42; Build & Run writes the boot file again in front of the rest of the tape (replaceTapeFile)
    const exit = Uint8Array.from([0xa9, 0x42, 0x8d, 0xff, 0xd7, 0x4c, 0x05, 0xc0]);
    const boot = bootLoader(0xc000, 0xc000 + exit.length, 0xc000);
    const kernal = makeTap({ files: [{ name: 'BOOT', load: 0x02a7, data: boot.data, header: boot.header }] });
    const w = new TurboWriter();
    w.leader(0xc0);
    tinyFile(w, exit);
    w.leader(0x40);
    const tape = withTurbo(kernal, w.pulses);
    const f = readTape(tape).files[0];
    const again = replaceTapeFile(tape, f, f.header!, f.data);
    const dir = await mkdtemp(join(tmpdir(), 'mimir-vice-'));
    try {
      for (const [name, t] of [['boot.tap', tape], ['again.tap', again]] as const) {
        const prgPath = join(dir, name);
        await writeFile(prgPath, t);
        const { argv } = await prepareVice({ args: headless(dir).map(a => (a === '40000000' ? '200000000' : a)), prgPath });
        expect(argv).toContain('-autostart');
        expect(spawnSync(vice!, argv, { timeout: 120_000, windowsHide: true }).status, name).toBe(0x42);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('autostarts a T64, and puts one in the datasette: LOAD from the tape finds its next file, one before it too', async () => {
    // 10 SYS2061: LOAD"PART2",1,1 through the KERNAL, then jump to it; PART2 exits with $42 (13.5j)
    const f = fromSource('t64boot.prg', '.pc = $0801\n.byte $0b,$08,$0a,$00,$9e,$32,$30,$36,$31,$00,$00,$00\n.pc = $080d\n lda #5\n ldx #<name\n ldy #>name\n jsr $ffbd\n lda #1\n ldx #1\n ldy #1\n jsr $ffba\n lda #0\n jsr $ffd5\n bcs fail\n jmp $c000\nfail:\n lda #$ee\n sta $d7ff\n jmp *\nname: .byte $50,$41,$52,$54,$32');
    const boot = { name: 'BOOT', load: 0x0801, data: f.bytes };
    const part2 = { name: 'PART2', load: 0xc000, data: Uint8Array.from([0xa9, 0x42, 0x8d, 0xff, 0xd7, 0x4c, 0x05, 0xc0]) };
    const junk = { name: 'JUNK', load: 0xc000, data: Uint8Array.from([0xa9, 0xee, 0x8d, 0xff, 0xd7, 0x4c, 0x05, 0xc0]) };
    const after = makeT64({ name: 'MIMIR', files: [boot, junk, part2] }), before = makeT64({ name: 'MIMIR', files: [part2, junk, boot] });
    const dir = await mkdtemp(join(tmpdir(), 'mimir-vice-'));
    try {
      // (in the datasette the program waits for PLAY, which the user presses: here the monitor does)
      await writeFile(join(dir, 'play.mon'), 'tapectrl 1\n');
      const status = async (o: { prgPath: string; tape?: string }) => {
        const { argv } = await prepareVice({ args: [...headless(dir), ...(o.tape ? ['-moncommands', join(dir, 'play.mon')] : [])], ...o });
        return spawnSync(vice!, argv, { timeout: 90_000, windowsHide: true }).status;
      };
      // (written: Build & Run's T64 of the project's first file and those after it, the file in front of it left out)
      const written = writeT64(makeT64({ files: [junk, boot, junk, part2] }), new Map([[1, prgOf({ load: 0x0801, bytes: f.bytes })]]), 1);
      for (const [name, t] of [['after.t64', after], ['written.t64', written]] as const) {
        await writeFile(join(dir, name), t);
        expect(await status({ prgPath: join(dir, name) }), name).toBe(0x42);
      }
      // the boot file run as a PRG, the T64 in the datasette (Build & Run's copy of it)
      const prgPath = join(dir, 'boot.prg');
      await writeFile(prgPath, prgOf({ load: 0x0801, bytes: f.bytes }));
      for (const [name, t] of [['after.t64', after], ['before.t64', before]] as const) {
        await writeFile(join(dir, name), t);
        expect(await status({ prgPath, tape: join(dir, name) }), `${name} in the datasette`).toBe(0x42);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('has the drive read the disk before the program starts, as loading it from the disk would', async () => {
    // M-R of the drive's $0012: the first byte of the ID of the disk it last read ("M" of "MI"; nothing read: 0).
    // A fast loader's drive code counts on it (Sparkle hangs without)
    const f = fromSource('id.prg', '.pc = $0801\n.byte $0b,$08,$0a,$00,$9e,$32,$30,$36,$31,$00,$00,$00\n.pc = $080d\n lda #6\n ldx #<cmd\n ldy #>cmd\n jsr $ffbd\n lda #15\n ldx #8\n ldy #15\n jsr $ffba\n jsr $ffc0\n ldx #15\n jsr $ffc6\n jsr $ffcf\n sta $d7ff\n jmp *\ncmd: .byte $4d,$2d,$52,$12,$00,$01');
    const dir = await mkdtemp(join(tmpdir(), 'mimir-vice-'));
    try {
      const prgPath = join(dir, 'id.prg'), disk = join(dir, 'disk.d64');
      await writeFile(prgPath, prgOf(f));
      await writeFile(disk, makeD64({ name: 'parts', id: 'mi', files: [] }));
      const { argv } = await prepareVice({ args: headless(dir), prgPath, disk });
      expect(spawnSync(vice!, argv, { timeout: 90_000, windowsHide: true }).status).toBe(0x4d);
      // only put into memory and RUN, the drive has read nothing
      expect(spawnSync(vice!, [...headless(dir), '-8', disk, '-autostart', prgPath], { timeout: 90_000, windowsHide: true }).status).not.toBe(0x4d);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('starts a program that loads up to $f344 with a disk: no string space is left for BASIC', async () => {
    // an unpacked program (Reflexball: $0801-$f344, start $0840) sets BASIC's end past $a000, so a string typed at
    // READY stops with ?OUT OF MEMORY. The drive reads the disk all the same: M-R of its $0012, the ID's "M"
    const f = fromSource('big.prg', '.pc = $0801\n.byte $0b,$08,$0a,$00,$9e,$32,$30,$36,$31,$00,$00,$00\n.pc = $080d\n lda #6\n ldx #<cmd\n ldy #>cmd\n jsr $ffbd\n lda #15\n ldx #8\n ldy #15\n jsr $ffba\n jsr $ffc0\n ldx #15\n jsr $ffc6\n jsr $ffcf\n sta $d7ff\n jmp *\ncmd: .byte $4d,$2d,$52,$12,$00,$01\n.pc = $f343\n.byte $00');
    expect(f.load + f.bytes.length).toBe(0xf344);
    const dir = await mkdtemp(join(tmpdir(), 'mimir-vice-'));
    try {
      const prgPath = join(dir, 'big.prg'), disk = join(dir, 'disk.d64');
      await writeFile(prgPath, prgOf(f));
      await writeFile(disk, makeD64({ name: 'parts', id: 'mi', files: [] }));
      for (const start of [undefined, 0x080d]) {
        const { argv } = await prepareVice({ args: headless(dir), prgPath, disk, start });
        expect(spawnSync(vice!, argv, { timeout: 90_000, windowsHide: true }).status).toBe(0x4d);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('starts a program over BASIC\'s work area (a memory dump from $0002) from the monitor', async () => {
    // zero page, stack and buffers zeroed (the IRQ/BRK/NMI vectors keep their KERNAL values): typing `sys` cannot work
    const f = fromSource('dump.prg', '.pc = $0002\n.byte $00\n.pc = $0314\n.byte $31,$ea,$66,$fe,$47,$fe\n.pc = $0c00\n sei\n lda #$42\n sta $d7ff\n jmp *');
    expect(f.load).toBe(0x0002);
    const dir = await mkdtemp(join(tmpdir(), 'mimir-vice-'));
    try {
      const prgPath = join(dir, 'dump.prg');
      await writeFile(prgPath, prgOf(f));
      const { argv, via } = await prepareVice({ args: headless(dir), prgPath, start: 0x0c00 });
      expect(via).toBe('monitor');
      expect(spawnSync(vice!, argv, { timeout: 90_000, windowsHide: true }).status).toBe(0x42);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('puts a PRG\'s bytes at $d000-$dfff in the RAM under the I/O area, from the monitor and with sys', async () => {
    // a program Sindri saved can have its data there (Cybernoid II +17HDF, $0208-$ffff). The program reads RAM there
    // ($01 = $34) and exits with $d000's byte, $ee when $dfff's is not the file's. Through the CPU's view the load
    // wrote the file's 0 at $d7ff to the debug cartridge, which ended VICE with 0 before the program ran
    const code = '.pc = $0c00\n sei\n lda #$34\n sta $01\n ldx $d000\n ldy $dfff\n lda #$37\n sta $01\n cpy #$24\n beq ok\n ldx #$ee\nok:\n stx $d7ff\n jmp *\n.pc = $d000\n.byte $42\n.pc = $dfff\n.byte $24';
    const files: [string, ReturnType<typeof fromSource>, string][] = [
      ['dump', fromSource('dump.prg', `.pc = $0002\n.byte $00\n.pc = $0314\n.byte $31,$ea,$66,$fe,$47,$fe\n${code}`), 'monitor'],
      ['basic', fromSource('basic.prg', `.pc = $0801\n.byte $0b,$08,$0a,$00,$9e,$32,$30,$36,$31,$00,$00,$00\n${code}`), 'sys'],
    ];
    const dir = await mkdtemp(join(tmpdir(), 'mimir-vice-'));
    try {
      for (const [name, f, how] of files) {
        const prgPath = join(dir, `${name}.prg`);
        await writeFile(prgPath, prgOf(f));
        const { argv, via } = await prepareVice({ args: headless(dir), prgPath, start: 0x0c00 });
        expect(via).toBe(how);
        expect(spawnSync(vice!, argv, { timeout: 90_000, windowsHide: true }).status, name).toBe(0x42);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 120_000);

  it('starts a program under the BASIC ROM with the $01 it needs, typed as a stub and from the monitor, with a disk too', async () => {
    // a game Sindri saved can start at $a2ab with $01 = $36 (Cybernoid 2): with $37 the CPU runs BASIC's ROM there.
    // The program exits with $42, with $01 as it found it in A when that was not $36
    const code = '.pc = $a000\n lda $01\n cmp #$36\n bne bad\n lda #$42\nbad:\n sta $d7ff\n jmp *';
    const files: [string, ReturnType<typeof fromSource>, string][] = [
      ['game', fromSource('game.prg', code), 'sys'],
      ['dump', fromSource('dump.prg', `.pc = $0200\n.byte $00\n${code}`), 'monitor'],
    ];
    const dir = await mkdtemp(join(tmpdir(), 'mimir-vice-'));
    try {
      const disk = join(dir, 'disk.d64');
      await writeFile(disk, makeD64({ name: 'parts', files: [{ name: 'top10', data: Uint8Array.from([0x00, 0xc0, 0x60]) }] }));
      for (const [name, f, how] of files) for (const d of [null, disk]) {
        const prgPath = join(dir, `${name}.prg`);
        await writeFile(prgPath, prgOf(f));
        const { argv, via } = await prepareVice({ args: headless(dir), prgPath, start: 0xa000, port: 0x36, disk: d });
        expect(via).toBe(how);
        expect(spawnSync(vice!, argv, { timeout: 90_000, windowsHide: true }).status, `${name}${d ? ' with the disk' : ''}`).toBe(0x42);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 240_000);

  it('starts a program over the screen at READY from the monitor, with its bytes there, after the drive read the disk', async () => {
    // typing at READY writes on the screen: $0400's $42 would be gone. With the disk, the drive reads it first (M-R of
    // its $0012, the ID's "M"), and the monitor stopped at $02a7 for it once: the program's own code there runs
    const f = fromSource('screen.prg', '.pc = $0400\n.byte $42\n.pc = $0c00\n lda #$60\n sta $02a7\n jsr $02a7\n lda #6\n ldx #<cmd\n ldy #>cmd\n jsr $ffbd\n lda #15\n ldx #8\n ldy #15\n jsr $ffba\n jsr $ffc0\n ldx #15\n jsr $ffc6\n jsr $ffcf\n cmp #$4d\n bne bad\n lda $0400\n sta $d7ff\n jmp *\nbad:\n lda #$ee\n sta $d7ff\n jmp *\ncmd: .byte $4d,$2d,$52,$12,$00,$01');
    const dir = await mkdtemp(join(tmpdir(), 'mimir-vice-'));
    try {
      const prgPath = join(dir, 'screen.prg'), disk = join(dir, 'disk.d64');
      await writeFile(prgPath, prgOf(f));
      await writeFile(disk, makeD64({ name: 'parts', id: 'mi', files: [] }));
      const { argv, via } = await prepareVice({ args: headless(dir), prgPath, start: 0x0c00, disk });
      expect(via).toBe('monitor');
      expect(spawnSync(vice!, argv, { timeout: 90_000, windowsHide: true }).status).toBe(0x42);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 120_000);

  it('starts a memory dump from the monitor with the disk\'s drive as the last device used, as loading from it leaves it', async () => {
    // the program exits with $ba, the device a program that loads "from where it came from" takes (0 at READY)
    const f = fromSource('dump.prg', '.pc = $0200\n.byte $00\n.pc = $0c00\n lda $ba\n sta $d7ff\n jmp *');
    const dir = await mkdtemp(join(tmpdir(), 'mimir-vice-'));
    try {
      const prgPath = join(dir, 'dump.prg'), disk = join(dir, 'disk.d64');
      await writeFile(prgPath, prgOf(f));
      await writeFile(disk, makeD64({ name: 'parts', files: [{ name: 'top10', data: Uint8Array.from([0x00, 0xc0, 0x60]) }] }));
      for (const [d, device] of [[disk, 8], [null, 0]] as const) {
        const { argv, via } = await prepareVice({ args: headless(dir), prgPath, start: 0x0c00, disk: d });
        expect(via).toBe('monitor');
        expect(spawnSync(vice!, argv, { timeout: 90_000, windowsHide: true }).status, d ? 'with the disk' : 'without').toBe(device);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 120_000);

  it('starts the cartridge rebuilt from its re-assembled boot bank: it switches bank 1 in and reads it', async () => {
    // fixtures/crt/mimir-demo.crt (crt.test.ts): a Magic Desk whose bank 0 copies bank 1's text to the screen and
    // exits with its first screen code, "M" ($0d)
    const crt = new Uint8Array(await readFile(join(__dirname, '../../../fixtures/crt/mimir-demo.crt')));
    const o = openCartridge('mimir-demo.crt', crt), p = { name: 'mimir-demo', files: o.files, cart: o.cart };
    const A = analyze(p), V = verify(A, render(A, p));
    const built = builtCartridge(p, V.results.map(r => r.prg))!;
    expect(built.crt).toEqual(crt);
    const dir = await mkdtemp(join(tmpdir(), 'mimir-vice-'));
    try {
      const path = join(dir, built.name);
      await writeFile(path, built.crt);
      const { argv, via } = await prepareVice({ args: headless(dir), prgPath: path, cart: true });
      expect(via).toBe('cart');
      expect(spawnSync(vice!, argv, { timeout: 90_000, windowsHide: true }).status).toBe(0x0d);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('restarts a snapshot as it was taken, with the built program in its RAM', async () => {
    // the raster demo's snapshot, taken in its IRQ handler at $08c7: there the program now sets the border and the
    // background to red and stops. VICE goes on from that PC with the patched RAM (the debug cartridge does not
    // survive loading a snapshot, so the screenshot VICE saves when it stops tells)
    const vsf = new Uint8Array(await readFile(join(__dirname, '../../../fixtures/vsf/raster-demo.vsf')));
    const pc = parseVsf(vsf).cpu!.pc;
    const red = Uint8Array.from([0xa9, 0x02, 0x8d, 0x20, 0xd0, 0x8d, 0x21, 0xd0, 0x4c, (pc + 8) & 0xff, (pc + 8) >> 8]);
    const dir = await mkdtemp(join(tmpdir(), 'mimir-vice-'));
    try {
      const shot = async (file: Uint8Array, name: string) => {
        const path = join(dir, `${name}.vsf`), png = join(dir, `${name}.png`);
        await writeFile(path, file);
        // VICE boots, then loads the snapshot; a few frames after that are enough, at full speed
        const args = headless(dir).filter(a => a !== '-debugcart').map(a => (a === '40000000' ? '10000000' : a));
        const { argv, via } = await prepareVice({ args: [...args, '-warp', '-exitscreenshot', png], prgPath: path });
        expect(via).toBe('run');
        spawnSync(vice!, argv, { timeout: 90_000, windowsHide: true });
        return readPng(new Uint8Array(await readFile(png)));
      };
      const isRed = ([r, g, b]: number[]) => r > g + 40 && r > b + 30;
      const patched = await shot(patchSnapshot(vsf, [makePrg(pc, red)]), 'red');
      expect(isRed(patched.pixel(4, 4)), String(patched.pixel(4, 4))).toBe(true);
      expect(isRed(patched.pixel(patched.width >> 1, patched.height - 60))).toBe(true);
      // as it was: the demo's black border
      const before = await shot(vsf, 'demo');
      expect(isRed(before.pixel(4, 4))).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
