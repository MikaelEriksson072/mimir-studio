/* Build & Run in a debugger (spec 13.2b): the start code next to the program in the PRG Retro Debugger or C64 Debugger
 * loads. Where it goes (always at the PRG's load address, where C64 Debugger's -alwaysjmp jumps), and, with VICE's
 * ROMs, what it does in Sindri's C64 when it is jumped to at READY as the debuggers do: RUN, SYS with $01, a program
 * started as from VICE's monitor, the drive's initialise, LOAD"*",8,1 and RUN. And the command lines each debugger
 * gets, with what it cannot take left out or refused. */
import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { C64, d64ToDisk } from '@mimir/sindri';
import { Drive } from '../../sindri/src/drive.ts';
import { debuggerStart, DRIVE_INIT, makeD64, makePrg, type Roms } from '../src';
import { DEBUGGERS, debuggerArgv, findC64Roms, prepareDebugger } from '../src/node';
import { fromSource } from './helpers/programs';

const prgOf = (src: string) => { const f = fromSource('t.prg', src); return makePrg(f.load, f.bytes); };
const loadOf = (prg: Uint8Array) => prg[0] | (prg[1] << 8);
/** the bytes the PRG puts at [from, to) */
const at = (prg: Uint8Array, from: number, to: number) => prg.subarray(2 + from - loadOf(prg), 2 + to - loadOf(prg));

// 10 SYS2061, then code that marks $c000, keeps BASIC's end pointer and returns to BASIC
const basic = prgOf(`*=$0801
.byte $0b,$08,$0a,$00,$9e,$32,$30,$36,$31,$00,$00,$00
*=$080d
 lda #$11
 sta $c000
 lda $2d
 sta $c001
 lda $2e
 sta $c002
 rts`);
// at $c000: $01 and a mark, then a loop
const atC000 = prgOf(`*=$c000
 lda $01
 sta $c100
 lda #$22
 sta $c101
loop: jmp loop`);
// over the screen ($0400-$0827): spaces with a text, and code at $0810 that keeps $01 and the stack pointer
const overScreen = prgOf(`*=$0400
.fill 480, $20
.byte $0d,$0f,$0e,$09,$14,$0f,$12
.fill 513, $20
*=$07e8
.fill 40, 0
*=$0810
 lda $01
 sta $c000
 tsx
 stx $c001
loop: jmp loop`);

describe('where the start code goes', () => {
  it('a BASIC program at $0801: the code after it, and a JMP to it below $0800, which stays 0; RUN is typed', () => {
    const r = debuggerStart(basic);
    expect(r).toMatchObject({ via: 'run', jmp: 0x07fd, typed: 'run' });
    expect(Array.from(at(r.prg, 0x07fd, 0x0801))).toEqual([0x4c, (basic.length + 0x07ff) & 0xff, (basic.length + 0x07ff) >> 8, 0]);
    expect(at(r.prg, 0x0801, 0x0801 + basic.length - 2)).toEqual(basic.subarray(2));
  });

  it('a program at $c000 has no room before it: it is carried in BASIC\'s free memory, past its empty program', () => {
    const r = debuggerStart(atC000, { start: 0xc000 });
    expect(r).toMatchObject({ via: 'sys', jmp: 0x0803, carried: true, typed: 'sys49152' });
    // the program's bytes at the end of the carried copy
    expect(r.prg.subarray(r.prg.length - (atC000.length - 2))).toEqual(atC000.subarray(2));
  });

  it('with another $01 the line calls a routine that sets it and jumps to the start', () => {
    const r = debuggerStart(atC000, { start: 0xc000, port: 0x36 });
    const sys = Number(r.typed!.replace('sys', ''));
    expect(Array.from(at(r.prg, sys, sys + 7))).toEqual([0xa9, 0x36, 0x85, 0x01, 0x4c, 0x00, 0xc0]);
  });

  it('with a disk the drive\'s initialise is typed first', () => {
    expect(debuggerStart(basic, { disk: true }).typed).toBe(`${DRIVE_INIT}run`);
    expect(debuggerStart(atC000, { start: 0xc000, disk: true }).typed).toBe(`${DRIVE_INIT}sys49152`);
  });

  it('a program over the screen starts as from the monitor: with nothing to do first it is jumped to as it is', () => {
    expect(debuggerStart(overScreen, { start: 0x0400 })).toMatchObject({ via: 'monitor', jmp: 0x0400, code: null, prg: overScreen });
    const r = debuggerStart(overScreen, { start: 0x0810, port: 0x36 });
    expect(r.via).toBe('monitor');
    // right before it, in the tape buffer
    expect(r.code).toEqual({ start: r.jmp, end: 0x0400 });
    expect(r.jmp).toBeGreaterThanOrEqual(0x0334);
  });

  it('a memory dump from $0208 to $ffff: the code at the bottom of the stack page, which it moves the stack below', () => {
    const dump = makePrg(0x0208, new Uint8Array(0x10000 - 0x0208).fill(0xea));
    const r = debuggerStart(dump, { start: 0x1000, port: 0x36, disk: true });
    expect(r.via).toBe('monitor');
    expect(r.jmp).toBeGreaterThanOrEqual(0x0130);
    expect(r.code!.end).toBe(0x0208);
    // sei, tsx, stx, then ldx #<below the code>, txs
    expect(Array.from(at(r.prg, r.jmp!, r.jmp! + 7))).toEqual([0x78, 0xba, 0x8e, expect.any(Number), expect.any(Number), 0xa2, (r.jmp! - 1) & 0xff]);
  });

  it('no room anywhere: the program is only loaded, and the warning says what to type', () => {
    const full = makePrg(0x0801, new Uint8Array(0xa000 - 0x0801));
    expect(debuggerStart(full)).toMatchObject({ jmp: null, code: null, prg: full, warning: expect.stringContaining('type RUN') });
  });

  it('a disk or a tape VICE autostarts: LOAD typed by code at $02a7, RUN waiting in the keyboard buffer', () => {
    expect(debuggerStart(null, { load: 'disk' })).toMatchObject({ via: 'load', jmp: 0x02a7, typed: 'load"*",8,1, then run' });
    const tape = debuggerStart(null, { load: 'tape' });
    expect(tape.typed).toBe('load, then run');
    expect(tape.code!.end).toBeLessThanOrEqual(0x0300);
  });
});

const roms = findC64Roms();
const READY = 0xe5cd;

/** Sindri's C64 powered on and at the READY prompt (with the drive started up and the disk in it, when there is one) */
function machine(r: Roms, disk?: Uint8Array): C64 {
  const m = new C64(r), cpu = m.cpu;
  m.ddr = 0; m.port = 0; m.updateMap();
  cpu.s = 0xfd; cpu.p = 0x24; cpu.pc = m.peekWord(0xfffc);
  if (disk) {
    const d = new Drive(r.drive!);
    while (d.cycles < 2_500_000) d.step();
    d.insert(d64ToDisk(disk));
    m.attachDrive(d);
  }
  if (!until(m, () => cpu.pc === READY && !m.ram[0xc6], 20_000_000)) throw new Error('no READY');
  return m;
}

/** run until `done` (true) or `max` cycles (false), with the interrupts */
function until(m: C64, done: () => boolean, max: number): boolean {
  const cpu = m.cpu, end = m.cycles + max;
  let nmiWas = false;
  while (m.cycles < end) {
    if (done()) return true;
    const iWas = cpu.i;
    m.dmaWait();
    const cycles = cpu.step();
    if (cpu.jammed) throw new Error(`JAM at $${cpu.pc.toString(16)}`);
    m.advance(cycles);
    if (m.irqDue() && !(cpu.lastOp === 0x40 ? cpu.i : iWas)) m.advance(cpu.irq());
    const nmi = m.nmiLine;
    if (nmi && !nmiWas) m.advance(cpu.nmi());
    nmiWas = nmi;
  }
  return false;
}

/** what the debuggers do: the PRG into RAM (under the I/O area and the ROMs too) at READY, and a jump to its start */
function start(m: C64, prg: Uint8Array, jmp: number): void {
  m.ram.set(prg.subarray(2), loadOf(prg));
  m.cpu.pc = jmp;
}

const text = (m: C64, from: number, n: number) => String.fromCharCode(...m.ram.subarray(from, from + n));

describe.skipIf(!roms)('the start code in a C64 (VICE\'s ROMs)', () => {
  it('RUN: the program runs with BASIC\'s end pointer at its end and returns to READY', () => {
    const m = machine(roms!), r = debuggerStart(basic);
    start(m, r.prg, r.jmp!);
    expect(until(m, () => m.ram[0xc000] === 0x11 && m.cpu.pc === READY, 5_000_000)).toBe(true);
    expect(m.ram[0xc001] | (m.ram[0xc002] << 8)).toBe(0x0801 + basic.length - 2);
    // RUN typed on the line after READY.
    expect(text(m, 0x0400 + 6 * 40, 3)).toBe('\x12\x15\x0e');
  });

  it('SYS with $01 = $36: the carried program is copied to $c000 and starts with $01 = $36; BASIC\'s program stays empty', () => {
    const m = machine(roms!), r = debuggerStart(atC000, { start: 0xc000, port: 0x36 });
    start(m, r.prg, r.jmp!);
    expect(until(m, () => m.ram[0xc101] === 0x22, 5_000_000)).toBe(true);
    expect(m.ram[0xc100]).toBe(0x36);
    expect(m.ram.subarray(0xc000, 0xc000 + atC000.length - 2)).toEqual(atC000.subarray(2));
    expect([m.ram[0x0801], m.ram[0x0802]]).toEqual([0, 0]);
  });

  it('as from the monitor: $01 as given, the stack pointer as at READY, the screen bytes as loaded', () => {
    const m = machine(roms!), r = debuggerStart(overScreen, { start: 0x0810, port: 0x36 }), sp = m.cpu.s;
    start(m, r.prg, r.jmp!);
    expect(until(m, () => m.cpu.pc >= 0x0818 && m.cpu.pc < 0x0820, 1_000_000)).toBe(true);
    expect([m.ram[0xc000], m.ram[0xc001]]).toEqual([0x36, sp]);
    expect(text(m, 0x0400 + 480, 7)).toBe('\x0d\x0f\x0e\x09\x14\x0f\x12');
  });

  describe.skipIf(!roms?.drive)('with a disk in the 1541', () => {
    // reads the drive's error channel into $c100 and keeps $ba at $c140
    const status = `
 lda #15
 ldx #8
 ldy #15
 jsr $ffba
 lda #0
 jsr $ffbd
 jsr $ffc0
 ldx #15
 jsr $ffc6
 ldy #0
read: jsr $ffcf
 sta $c100,y
 iny
 cmp #13
 bne read
 jsr $ffcc
 lda #15
 jsr $ffc3
 lda $ba
 sta $c140
done: jmp done`;
    const disk = makeD64({ name: 'mimir test', id: 'mt', files: [{ name: 'boot', data: prgOf(`*=$0801
.byte $0b,$08,$0a,$00,$9e,$32,$30,$36,$31,$00,$00,$00
*=$080d
 lda #$33
 sta $c000
loop: jmp loop`) }] });
    const statusText = (m: C64) => text(m, 0xc100, 6);
    const doneAt = (m: C64) => () => m.ram[0xc140] !== 0;

    it('a program loaded into memory: the drive has not read the disk (its power-on message)', () => {
      const m = machine(roms!, disk), r = debuggerStart(prgOf(`*=$c000${status}`), { start: 0xc000 });
      start(m, r.prg, r.jmp!);
      expect(until(m, doneAt(m), 10_000_000)).toBe(true);
      expect(statusText(m)).toBe('73,CBM');
    });

    it('SYS: the drive\'s initialise typed first, so the drive has read the disk', () => {
      const m = machine(roms!, disk), r = debuggerStart(prgOf(`*=$c000${status}`), { start: 0xc000, disk: true });
      start(m, r.prg, r.jmp!);
      expect(until(m, doneAt(m), 10_000_000)).toBe(true);
      expect(statusText(m)).toBe('00, OK');
      expect(m.ram[0xc140]).toBe(8);
    });

    it('as from the monitor: the KERNAL tells the drive to read the disk, with the program\'s system area put back', () => {
      const prg = prgOf(`*=$0400\n.fill $400, $20\n*=$0800${status}`);
      const m = machine(roms!, disk), r = debuggerStart(prg, { start: 0x0800, disk: true });
      expect(r.via).toBe('monitor');
      start(m, r.prg, r.jmp!);
      const files = m.ram.slice(0x0259, 0x0277), zp = m.ram.slice(0x90, 0xbd);
      // (the code's first instruction after the init: the program's own code)
      expect(until(m, () => m.cpu.pc === 0x0800, 10_000_000)).toBe(true);
      expect(m.ram.slice(0x0259, 0x0277)).toEqual(files);
      zp[0xba - 0x90] = 8;
      expect(m.ram.slice(0x90, 0xbd)).toEqual(zp);
      expect(until(m, doneAt(m), 10_000_000)).toBe(true);
      expect(statusText(m)).toBe('00, OK');
    });

    it('LOAD"*",8,1 and RUN: the disk\'s first program runs', () => {
      const m = machine(roms!, disk), r = debuggerStart(null, { load: 'disk' });
      start(m, r.prg, r.jmp!);
      expect(until(m, () => m.ram[0xc000] === 0x33, 30_000_000)).toBe(true);
    });
  });
});

describe('the command lines', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mimir-debugger-'));
  const prgPath = join(dir, 'game.prg'), labels = join(dir, 'game.vs');
  writeFileSync(prgPath, atC000);

  it('Retro Debugger: -wait, then -prg and -jmp to the start code; C64 Debugger: -alwaysjmp to the load address', () => {
    expect(debuggerArgv('retro', { args: ['-layout', '2'], wait: 3000, labels, startPrg: 's.prg', jmp: 0x0803 })).toEqual(['-layout', '2', '-symbols', labels, '-wait', '3000', '-prg', 's.prg', '-jmp', 'x0803']);
    expect(debuggerArgv('c64d', { labels, disk: 'd.d64', tape: 't.tap', startPrg: 's.prg', jmp: 0x0803 })).toEqual(['-symbols', labels, '-d64', 'd.d64', '-tap', 't.tap', '-prg', 's.prg', '-alwaysjmp']);
    // no room for the start code: only loaded
    expect(debuggerArgv('c64d', { startPrg: 's.prg', jmp: null })).toEqual(['-prg', 's.prg']);
  });

  it('the start PRG is written next to the program: game.debugger.prg', async () => {
    const p = await prepareDebugger({ kind: 'c64d', exe: 'x', prgPath, labelsPath: labels, start: 0xc000, disk: join(dir, 'd.d64') });
    expect(p.startPrg).toBe(join(dir, 'game.debugger.prg'));
    expect(new Uint8Array(readFileSync(p.startPrg!))).toEqual(p.plan!.prg);
    expect(p).toMatchObject({ via: 'sys', notes: [] });
    expect(p.argv).toEqual(['-symbols', labels, '-d64', join(dir, 'd.d64'), '-prg', p.startPrg, '-alwaysjmp']);
    expect(p.plan!.typed).toBe(`${DRIVE_INIT}sys49152`);
  });

  it('Retro Debugger leaves the disk and the tape out, says so, and then does not initialise the drive', async () => {
    const p = await prepareDebugger({ kind: 'retro', exe: 'x', prgPath, start: 0xc000, disk: join(dir, 'd.d64'), tape: join(dir, 't.tap') });
    expect(p.argv).not.toContain('-d64');
    expect(p.argv).not.toContain('-tap');
    expect(p.notes).toEqual([expect.stringMatching(/^The disk is not in drive 8 .*stops its emulation/), expect.stringMatching(/^The tape is not in the datasette/)]);
    expect(p.plan!.typed).toBe('sys49152');
  });

  it('a cartridge: Retro Debugger attaches it and resets; C64 Debugger is refused, as is a VICE snapshot for both', async () => {
    const crt = join(dir, 'demo.crt');
    expect((await prepareDebugger({ kind: 'retro', exe: 'x', prgPath: crt, cart: true })).argv).toEqual(['-crt', crt, '-reset']);
    await expect(prepareDebugger({ kind: 'c64d', exe: 'x', prgPath: crt, cart: true })).rejects.toThrow(/does not start a cartridge/);
    for (const kind of ['retro', 'c64d'] as const) await expect(prepareDebugger({ kind, exe: 'x', prgPath: join(dir, 'snap.vsf') })).rejects.toThrow(/cannot restart a VICE snapshot/);
  });

  it('a disk or a tape VICE autostarts: C64 Debugger types LOAD, Retro Debugger is refused', async () => {
    const d64 = join(dir, 'disk.d64'), tap = join(dir, 'game.tap');
    const p = await prepareDebugger({ kind: 'c64d', exe: 'x', prgPath: d64 });
    expect(p).toMatchObject({ via: 'load', startPrg: join(dir, 'debugger-start.prg') });
    expect(p.argv).toEqual(['-d64', d64, '-prg', p.startPrg, '-alwaysjmp']);
    const t = await prepareDebugger({ kind: 'c64d', exe: 'x', prgPath: tap });
    expect(t.argv).toEqual(['-tap', tap, '-prg', t.startPrg, '-alwaysjmp']);
    expect(t.notes).toEqual([expect.stringContaining('Press PLAY')]);
    await expect(prepareDebugger({ kind: 'retro', exe: 'x', prgPath: d64 })).rejects.toThrow(/cannot start the disk/);
    await expect(prepareDebugger({ kind: 'retro', exe: 'x', prgPath: tap })).rejects.toThrow(/does not load from a tape/);
    expect(DEBUGGERS.retro.name).toBe('Retro Debugger');
  });
});
