/* Playing a music block (c64/sidplayer.ts): the PRG moves the block's bytes to where the player runs, calls init with
 * the song in A and play once a frame from the raster interrupt, with the KERNAL in where it can be. Keys 1-9 and 0
 * start songs $00-$09, + and - the next and the one before. Run in Sindri's emulated C64 (stand-in ROMs), and in the
 * real VICE when it is found: the debug cartridge makes VICE exit with what the tune wrote to $d7ff. */
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { C64, standInRoms } from '@mimir/sindri';
import { assemble, h4 } from '../src';
import { musicPlayData, sidPlayer, SID_PLAYER_DATA, SID_PLAYER_LINE, SID_PLAYER_SONG_AT } from '../src/c64/sidplayer';
import { findVice, prepareVice } from '../src/node';

/** what the test tune writes: the song init got, plays since init, $01 and the raster line in play, init's $01 */
const OUT = 0x0340, SONG = OUT, COUNT = OUT + 1, PORT = OUT + 2, LINE = OUT + 3, INIT_PORT = OUT + 4, BAD_LINE = OUT + 5;

/** A tune at `load`, `len` bytes: JMP init / JMP play, then a pattern the move must keep. With `exit`, the 50th play
 *  writes $40 | $01's low bits to the debug cartridge ($d7ff), $ee when play was called on another raster line. */
function tune(load: number, len: number, exit = false): Uint8Array {
  const src = `.pc = $${h4(load)}
 jmp init
 jmp play
init: sta $${h4(SONG)}
 lda #0
 sta $${h4(COUNT)}
 sta $${h4(BAD_LINE)}
 lda $01
 sta $${h4(INIT_PORT)}
 lda #$0f
 sta $d418
 rts
play: inc $${h4(COUNT)}
 lda $d012
 sta $${h4(LINE)}
 cmp #$${(SID_PLAYER_LINE).toString(16)}
 beq line_ok
 cmp #$${(SID_PLAYER_LINE + 1).toString(16)}
 beq line_ok
 inc $${h4(BAD_LINE)}
line_ok: lda $01
 sta $${h4(PORT)}
 ${exit ? `lda $${h4(COUNT)}
 cmp #50
 bne done
 lda $${h4(BAD_LINE)}
 bne bad
 lda $01
 and #7
 ora #$40
 sta $d7ff
bad: lda #$ee
 sta $d7ff` : ''}
done: rts
`;
  const r = assemble({ 't.asm': src }, 't.asm');
  if (r.errors.length) throw new Error(r.errors.map(e => e.msg).join('; '));
  const code = r.mem.subarray(load, r.max + 1);
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) out[i] = (i * 7 + 3) & 0xff;
  out.set(code);
  return out;
}

/** The PRG loaded as LOAD does and started at its SYS, in Sindri's C64; `frames` lets time pass. `nmi`: CIA 2's
 *  interrupt is taken too (on the NMI line's edge). */
function boot(prg: Uint8Array, nmi = false) {
  const m = new C64(standInRoms());
  m.write(0xdc02, 0xff); m.write(0xdc03, 0x00); // the keyboard's ports, as the KERNAL sets them
  m.ram.set(prg.subarray(2), prg[0] | (prg[1] << 8));
  m.cpu.pc = 0x080d; m.cpu.s = 0xf6; m.cpu.i = 0;
  let nmiWas = false;
  const frames = (n: number) => {
    const until = m.cycles + n * 63 * 312;
    while (m.cycles < until) {
      const cpu = m.cpu, iWas = cpu.i;
      m.advance(cpu.step());
      if (cpu.jammed) throw new Error(`JAM at $${h4(cpu.pc)}`);
      if (nmi && m.nmiLine && !nmiWas) m.advance(cpu.nmi());
      else if (m.irqLine && !(cpu.lastOp === 0x40 ? cpu.i : iWas)) m.advance(cpu.irq());
      nmiWas = m.nmiLine;
    }
  };
  /** hold a key (keyboard matrix row bit of $dc00, column bit of $dc01) for a few frames, then let go */
  const press = (row: number, col: number) => { m.input.keys[row] = col; frames(3); m.input.release(); frames(3); };
  return { m, frames, press };
}

const screenText = (m: C64, at: number, n: number) => String.fromCharCode(...[...m.ram.subarray(at, at + n)].map(c => (c >= 1 && c <= 26 ? c + 0x40 : c === 0x64 ? 0x5f : c)));

describe('the music block player', () => {
  it('moves the block where it runs, calls init with the song and play once a frame on its raster line', () => {
    const data = tune(0x1000, 0x1234);
    const p = sidPlayer({ data, load: 0x1000, init: 0x1000, play: 0x1003, title: 'music_1000' });
    expect(p.port).toBe(0x37);
    expect(p.screen).toBe(true);
    expect(p.prg[0] | (p.prg[1] << 8)).toBe(0x0801);
    // the block's bytes as they are, from $0c00 in the PRG
    expect(p.prg.subarray(2 + SID_PLAYER_DATA - 0x0801)).toEqual(data);
    const { m, frames } = boot(p.prg);
    frames(12);
    expect(m.ram.subarray(0x1000, 0x1000 + data.length)).toEqual(data);
    expect(m.ram[SONG]).toBe(0);
    // (moving the bytes takes some frames first)
    expect(m.ram[COUNT]).toBeGreaterThanOrEqual(5);
    expect(m.ram[COUNT]).toBeLessThanOrEqual(11);
    expect(m.ram[BAD_LINE]).toBe(0);
    expect(m.ram[PORT] & 7).toBe(7);
    expect(m.ram[INIT_PORT] & 7).toBe(7);
    expect(m.sidRegs[0x18]).toBe(0x0f);
    // the driver is out of the block's way and the PRG's
    expect(p.driver.start).toBe(0xc000);
    // the screen says what plays
    expect(screenText(m, 0x0428, 33)).toBe('MIMIR STUDIO - MUSIC BLOCK PLAYER');
    expect(screenText(m, 0x0428 + 80, 10)).toBe('MUSIC_1000');
    expect(screenText(m, 0x0428 + 120, 36)).toBe('$1000-$2233  INIT $1000  PLAY $1003 ');
    expect(screenText(m, SID_PLAYER_SONG_AT - 6, 8)).toBe('SONG $00');
  });

  it('starts songs with 1-9 and 0, and the next and the one before with + and -', () => {
    const p = sidPlayer({ data: tune(0x1000, 0x400), load: 0x1000, init: 0x1000, play: 0x1003 });
    const { m, frames, press } = boot(p.prg);
    frames(5);
    // 3: PA1, PB0
    press(1, 0x01);
    expect(m.ram[SONG]).toBe(2);
    expect(m.ram[COUNT]).toBeLessThanOrEqual(6);
    expect(screenText(m, SID_PLAYER_SONG_AT, 2)).toBe('02');
    // 0: PA4, PB3
    press(4, 0x08);
    expect(m.ram[SONG]).toBe(9);
    // +: PA5, PB0, twice
    press(5, 0x01); press(5, 0x01);
    expect(m.ram[SONG]).toBe(0x0b);
    expect(screenText(m, SID_PLAYER_SONG_AT, 2)).toBe('0B');
    // -: PA5, PB3
    press(5, 0x08);
    expect(m.ram[SONG]).toBe(0x0a);
    // a key held starts its song once
    const count = () => m.ram[COUNT];
    m.input.keys[7] = 0x01; frames(2);
    expect(m.ram[SONG]).toBe(0);
    frames(5);
    expect(count()).toBeGreaterThanOrEqual(5);
    m.input.release(); frames(1);
  });

  it('starts with the song asked for', () => {
    const p = sidPlayer({ data: tune(0x1000, 0x100), load: 0x1000, init: 0x1000, play: 0x1003, song: 4 });
    const { m, frames } = boot(p.prg);
    frames(3);
    expect(m.ram[SONG]).toBe(4);
    expect(screenText(m, SID_PLAYER_SONG_AT, 2)).toBe('04');
  });

  it('plays a block under BASIC with BASIC out, and one under the KERNAL from the CPU\'s own vector', () => {
    for (const [load, port] of [[0xa000, 6], [0xb800, 6], [0xe000, 5], [0x0300, 5]] as const) {
      const data = tune(load, 0x1000);
      const p = sidPlayer({ data, load, init: load, play: load + 3 });
      expect(p.port & 7, h4(load)).toBe(port);
      const { m, frames } = boot(p.prg);
      frames(12);
      expect(m.ram.subarray(load, load + 0x10), h4(load)).toEqual(data.subarray(0, 0x10));
      expect(m.ram[COUNT], h4(load)).toBeGreaterThanOrEqual(4);
      expect(m.ram[PORT] & 7, h4(load)).toBe(port);
    }
  });

  it('moves blocks over the PRG itself, forward or from the top as they overlap', () => {
    // over the BASIC line and the driver's copy ($0801), just above where the bytes are in the PRG, and over the screen
    for (const [load, len] of [[0x0801, 0x1234], [0x0900, 0x0381], [0x0c80, 0x2345], [0x0d00, 0x100], [0x0400, 0x900], [0x2000, 0x41]] as const) {
      const data = tune(load, len);
      const p = sidPlayer({ data, load, init: load, play: load + 3 });
      const { m, frames } = boot(p.prg);
      frames(12);
      const got = m.ram.slice(load, load + len);
      // (the tune's own variables are outside it)
      expect(got, `$${h4(load)}, ${len} bytes`).toEqual(data);
      expect(m.ram[COUNT], h4(load)).toBeGreaterThanOrEqual(2);
      expect(p.screen, h4(load)).toBe(load + len <= 0x0400 || load >= 0x07e8);
    }
  });

  it('puts the driver out of the way of the block and the PRG', () => {
    expect(sidPlayer({ data: tune(0xc000, 0x1000), load: 0xc000, init: 0xc000, play: 0xc003 }).driver.start).toBe(0x9e00);
    const p = sidPlayer({ data: tune(0xc000, 0x1000), load: 0xc000, init: 0xc000, play: 0xc003 });
    const { m, frames } = boot(p.prg);
    frames(12);
    expect(m.ram[COUNT]).toBeGreaterThanOrEqual(4);
  });

  it('says what it cannot play', () => {
    const t = (load: number, len: number) => () => sidPlayer({ data: new Uint8Array(len), load, init: load, play: load + 3 });
    expect(t(0x1000, 0)).toThrow(/empty/);
    expect(t(0xf000, 0x1000)).toThrow(/interrupt vectors/);
    expect(t(0x1000, 0xc500)).toThrow(/too big/);
    expect(t(0x0000, 0x10)).toThrow(/processor port/);
    expect(sidPlayer({ data: new Uint8Array(0x100), load: 0xd000, init: 0xd000, play: 0xd003 }).warnings[0]).toMatch(/I\/O area/);
  });
});

/** A sample player at $1000 (5.8b), as a demo's: init switches the KERNAL out, sets the NMI vector, starts CIA 2's
 *  timer, and also a raster interrupt of the demo's, its handler at $1f00 outside the block (a JAM there). The NMI
 *  plays the page of samples at $e000, then the one at $4000, to the volume, and counts its samples at COUNT; with
 *  `exit`, the 4096th writes $5a to the debug cartridge ($d7ff). */
function sampleTune(exit = false) {
  const r = assemble({ 's.asm': `.pc = $1f00
 .byte $02
.pc = $1000
init: sei
 lda #$35
 sta $01
 lda #<nmi
 sta $fffa
 lda #>nmi
 sta $fffb
 lda #$00
 sta $fffe
 lda #$1f
 sta $ffff
 lda #$01
 sta $d01a
 lda #0
 sta $${h4(COUNT)}
 sta $${h4(COUNT + 1)}
 lda #$7f
 sta $dd04
 lda #0
 sta $dd05
 lda #$81
 sta $dd0d
 lda #$11
 sta $dd0e
 rts
nmi: pha
 tya
 pha
pos: ldy #0
smp: lda $e000,y
 sta $d418
 inc pos+1
 bne count
 lda smp+2
 eor #$a0
 sta smp+2
count: inc $${h4(COUNT)}
 bne done
 inc $${h4(COUNT + 1)}
 ${exit ? `lda $${h4(COUNT + 1)}
 cmp #$10
 bne done
 lda #$5a
 sta $d7ff` : ''}
done: lda $dd0d
 pla
 tay
 pla
 rti
` }, 's.asm');
  if (r.errors.length) throw new Error(r.errors.map(e => e.msg).join('; '));
  const data = r.mem.slice(0x1000, r.max + 1);
  const page = (k: number) => Uint8Array.from({ length: 256 }, (_, i) => ((i * k) >> 3) & 0x0f);
  return { data, parts: [{ load: 0xe000, data: page(3) }, { load: 0x4000, data: page(5) }] };
}

describe('the music block player with a sample player', () => {
  it('puts the samples where they play, starts init and lets its NMI play, with no raster interrupt and nothing called each frame', () => {
    const t = sampleTune();
    const d = musicPlayData(t.data, 0x1000, 0x1000, 0, undefined, { nmi: true, hz: 7697, wrote: [], parts: t.parts });
    expect(d.alone).toBeUndefined();
    // init is wrapped: $01, the player's init, then the demo's raster interrupt off (and CIA 1's beside an NMI)
    expect(d.wrapped).toEqual({ at: 0x1000 + t.data.length, bytes: 27, init: 0x1000 });
    const p = sidPlayer({ data: d.data, load: d.load, init: d.init, play: d.play, parts: d.parts, digi: d.digi, busy: d.busy, title: 'samples' });
    expect(p.port).toBe(0x35);
    // (the NMI as the CPU takes it: on the line's edge)
    const { m, frames } = boot(p.prg, true);
    const seen = new Set<number>();
    for (let k = 0; k < 40; k++) { frames(1); seen.add(m.sidRegs[0x18]); }
    for (const part of t.parts) expect(m.ram.subarray(part.load, part.load + 256)).toEqual(part.data);
    expect(m.ram[COUNT + 1]).toBeGreaterThan(8);
    expect(seen.size).toBeGreaterThan(8);
    // (the demo's raster interrupt never ran: its handler is a JAM, which frames() throws at; the wrapper switched it off)
    expect(screenText(m, SID_PLAYER_SONG_AT - 6 * 40 - 6 + 3 * 40, 80)).toMatch(/^\$1000-\$\w{4}  INIT \$\w{4}  NO PLAY +SAMPLES: ITS NMI, 7697 HZ, \$01 = \$35/);
  });

  it('plays a sample player whose init never returns from what init left: the bytes put back, then its timer started again', () => {
    // the NMI alone (no init): it plays the page at the pointer $fb (zero page, set by the program's start) to the volume
    const r = assemble({ 'n.asm': `.pc = $5000
nmi: pha
 tya
 pha
 ldy #0
 lda ($fb),y
 and #$0f
 sta $d418
 inc $fb
 inc $${h4(COUNT)}
 bne done
 inc $${h4(COUNT + 1)}
done: lda $dd0d
 pla
 tay
 pla
 rti
` }, 'n.asm');
    // (noise: $d418 is looked at once a frame, ~154 samples on, which a pattern can step over)
    let v = 1;
    const data = r.mem.slice(0x5000, r.max + 1), page = Uint8Array.from({ length: 256 }, () => (v = (v * 1103515245 + 12345) % 0x80000000) >> 27);
    const resume: [number, number][] = [[1, 0x37], [0x0318, 0x00], [0x0319, 0x50], [0xfb, 0], [0xfc, 0x60], [COUNT, 0], [COUNT + 1, 0], [0xd418, 0x0f]];
    const d = musicPlayData(data, 0x5000, 0x0810, 0, resume, { nmi: true, hz: 7697, latch: 0x7f, wrote: [], loop: true, timer: { cia: 2, b: false, ctl: 1 }, parts: [{ load: 0x6000, data: page }] });
    expect(d.resume).toBeDefined();
    expect(d.alone).toBeUndefined();
    const p = sidPlayer({ data: d.data, load: d.load, init: d.init, play: d.play, parts: d.parts, digi: d.digi, busy: d.busy });
    const { m, frames } = boot(p.prg, true);
    const seen = new Set<number>();
    for (let k = 0; k < 40; k++) { frames(1); seen.add(m.sidRegs[0x18]); }
    // (the timer every 128 cycles: about 154 interrupts a frame, 6 pages of samples in 10 frames)
    const count = () => m.ram[COUNT] | (m.ram[COUNT + 1] << 8), before = count();
    frames(10);
    expect(count() - before).toBeGreaterThan(1400);
    expect(seen.size).toBeGreaterThan(8);
  });

  it('stores parts where they run when that is in the PRG, the others in the room left', () => {
    const t = sampleTune();
    const p = sidPlayer({ data: t.data, load: 0x1000, init: 0x1000, play: 0, parts: t.parts, digi: { nmi: true, hz: 7697 } });
    const at = (a: number) => p.prg[2 + a - 0x0801];
    // the block and the page at $4000 where they run, the one at $e000 in the PRG's room from $0c00 on
    expect(at(0x1000)).toBe(t.data[0]);
    expect(p.prg.subarray(2 + 0x4000 - 0x0801, 2 + 0x4100 - 0x0801)).toEqual(t.parts[1].data);
    expect(p.prg.subarray(2 + SID_PLAYER_DATA - 0x0801, 2 + SID_PLAYER_DATA + 256 - 0x0801)).toEqual(t.parts[0].data);
  });
});

const vice = process.env.VICE || findVice();

describe.skipIf(!vice)(`the music block player in the real VICE (${vice ?? 'not found'})`, () => {
  const headless = (dir: string) => ['-config', join(dir, 'vice.ini'), '-default', '-console', '-sounddev', 'dummy', '+confirmonexit', '-debugcart', '-limitcycles', '40000000', '-autostartprgmode', '1'];

  it('plays a sample player: its NMI runs (4096 samples) with the samples in place', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mimir-sidplay-'));
    try {
      const t = sampleTune(true);
      const d = musicPlayData(t.data, 0x1000, 0x1000, 0, undefined, { nmi: true, hz: 7697, wrote: [], parts: t.parts });
      const p = sidPlayer({ data: d.data, load: d.load, init: d.init, play: d.play, parts: d.parts, digi: d.digi, busy: d.busy });
      const prgPath = join(dir, 'samples.prg');
      await writeFile(prgPath, p.prg);
      const { argv } = await prepareVice({ args: headless(dir), prgPath });
      expect(spawnSync(vice!, argv, { timeout: 90_000, windowsHide: true }).status).toBe(0x5a);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('RUN starts it and play is called each frame on its raster line, with the KERNAL and BASIC as the block needs', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mimir-sidplay-'));
    try {
      for (const [load, exit] of [[0x1000, 0x47], [0xa000, 0x46], [0xe000, 0x45]] as const) {
        const p = sidPlayer({ data: tune(load, 0x800, true), load, init: load, play: load + 3 });
        const prgPath = join(dir, `music_${h4(load)}.prg`);
        await writeFile(prgPath, p.prg);
        const { argv } = await prepareVice({ args: headless(dir), prgPath });
        expect(spawnSync(vice!, argv, { timeout: 90_000, windowsHide: true }).status, h4(load)).toBe(exit);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
