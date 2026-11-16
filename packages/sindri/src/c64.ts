/* The emulated C64: 64 KB RAM, the ROMs banked by $00/$01, the VIC-II (raster line, raster IRQ, badlines), both
 * CIAs (timers, interrupts, keyboard and joysticks, TOD), the SID registers the CPU can read, and colour RAM.
 * It is as exact as unpacking needs: whole instructions, a PAL timing of 63 cycles x 312 lines. A 1541 can be put on
 * the serial bus (drive.ts); without one nothing answers there. A datasette with a tape (tape.ts) sends its pulses to
 * CIA1's FLAG line while the motor runs, PLAY held down.
 *
 * It also records, for every RAM address, which layer wrote it last and when, and when it was last read as data.
 * Sindri finds the layers of a packed program from that. And from the moment the file is loaded, when each byte was
 * first run, read and written: what the program did with the loaded bytes (`UnpackResult.fileUse`). */
import { Cpu, type Bus } from './cpu.ts';
import { DRIVE_RATIO, type Drive } from './drive.ts';
import type { Datasette } from './tape.ts';
import { CYCLES, OPCODES } from './opcodes.ts';

/** what a 256-byte page reads from */
export const RAM = 0, ZP = 1, BASIC = 2, KERNAL = 3, CHAR = 4, IO = 5;

/** layer tags: written while the C64 started, and the bytes of the loaded file */
export const BOOT = -2, LOADED = -1;

export const CYCLES_PER_LINE = 63, LINES = 312;

/**
 * RAM as the C64 powers it on, as VICE's x64sc (3.10) fills it by default: four bytes of $00 and four of $ff ($0000-
 * $0001 the first two $00), the pattern inverted in every other 16 KB ($4000-$7fff, $c000-$ffff); VICE also flips a
 * bit now and then, which is left out. A real C64 has stripes of its own, never the same byte everywhere, and loaders
 * look: Cyberload's second stage wipes itself when the RAM under the KERNAL at $f37a-$f478 is all one byte (Tusker).
 */
export const POWER_ON: Uint8Array = (() => {
  const ram = new Uint8Array(0x10000);
  for (let a = 0; a < 0x10000; a++) ram[a] = (((a + 2) >> 2) & 1 ? 0xff : 0) ^ ((a >> 14) & 1 ? 0xff : 0);
  return ram;
})();

/** read-modify-write instructions (their last two cycles write) and those whose last cycle writes (stores, pushes) */
const RMW = new Set([
  0x06, 0x0e, 0x16, 0x1e, 0x46, 0x4e, 0x56, 0x5e, 0x26, 0x2e, 0x36, 0x3e, 0x66, 0x6e, 0x76, 0x7e, 0xe6, 0xee, 0xf6, 0xfe,
  0xc6, 0xce, 0xd6, 0xde, 0x03, 0x07, 0x0f, 0x13, 0x17, 0x1b, 0x1f, 0x23, 0x27, 0x2f, 0x33, 0x37, 0x3b, 0x3f, 0x43, 0x47,
  0x4f, 0x53, 0x57, 0x5b, 0x5f, 0x63, 0x67, 0x6f, 0x73, 0x77, 0x7b, 0x7f, 0xc3, 0xc7, 0xcf, 0xd3, 0xd7, 0xdb, 0xdf, 0xe3,
  0xe7, 0xef, 0xf3, 0xf7, 0xfb, 0xff,
]);
const WRITES_LAST = new Set([
  0x81, 0x85, 0x8d, 0x91, 0x95, 0x99, 0x9d, 0x84, 0x8c, 0x94, 0x86, 0x8e, 0x96, 0x83, 0x87, 0x8f, 0x97, 0x93, 0x9f, 0x9c,
  0x9e, 0x9b, 0x48, 0x08,
]);
export const CYCLES_PER_FRAME = CYCLES_PER_LINE * LINES;
/** for each opcode, its cycles that write (bit k: cycle k): a store's last, a read-modify-write's last two, JSR's and
 *  BRK's pushes */
const WRITE_CYCLES: Uint8Array = Uint8Array.from({ length: 256 }, (_, op) =>
  op === 0x20 ? 0b011000 : op === 0x00 ? 0b0011100 : RMW.has(op) ? 3 << (CYCLES[op] - 2) : WRITES_LAST.has(op) ? 1 << (CYCLES[op] - 1) : 0);
/** the cycles of an interrupt sequence that write (the three pushes) */
const INTERRUPT_WRITES = 0b0011100;
/** the opcodes that take a cycle more when their indexed address crosses a page: found by running each across one */
const PAGE_CROSS: Uint8Array = (() => {
  const out = new Uint8Array(256), mem = new Uint8Array(0x10000);
  const cpu = new Cpu({ read: a => mem[a], write: (a, v) => { mem[a] = v; }, fetch: a => mem[a] });
  for (let op = 0; op < 256; op++) {
    const mode = OPCODES[op].mode;
    if (mode !== 'abx' && mode !== 'aby' && mode !== 'izy') continue;
    mem.fill(0);
    mem[0x1000] = op; mem[0x1001] = mode === 'izy' ? 0x10 : 0xff; mem[0x1002] = 0x20;
    mem[0x10] = 0xff; mem[0x11] = 0x20;
    cpu.pc = 0x1000; cpu.x = 1; cpu.y = 1; cpu.s = 0xff; cpu.jammed = false;
    cpu.step();
    if (cpu.penalty) out[op] = 1;
  }
  return out;
})();

/** PAL: 985248 Hz */
export const CLOCK = 985248;

/** cycles from..to-1 of a line as bits: [cycles 0-31, cycles 32-62] */
function cycleBits(from: number, to: number): [number, number] {
  let lo = 0, hi = 0;
  for (let c = from; c < to; c++) if (c < 32) lo |= 1 << c; else hi |= 1 << (c - 32);
  return [lo, hi];
}
/** the cycles a badline holds BA low in: from 11 (3 before the first character fetch) to 53, the last */
const BAD_BA = cycleBits(11, 54);
/**
 * A sprite's fetches (the 6569's p-access and three s-accesses) take two cycles, sprite 0's 57-58 at the end of a line,
 * sprite 1's 59-60, sprite 2's 61-62, sprite 3's 0-1 of the next line ... sprite 7's 8-9; BA goes low three cycles
 * before. In a line: BA for the sprites whose DMA is on from its cycle 54 (sprites 0-4 start here) and for those that
 * were on at the end of the line before (sprites 3-7 fetch at the start of this one). Measured in VICE (x64sc): a read
 * in these cycles waits until the fetches are over, sprite 0 costs 5 cycles, all eight 19.
 */
const SPRITE_END_BA = [cycleBits(54, 59), cycleBits(56, 61), cycleBits(58, 63), cycleBits(60, 63), cycleBits(62, 63), [0, 0], [0, 0], [0, 0]];
const SPRITE_START_BA = [[0, 0], [0, 0], [0, 0], cycleBits(0, 2), cycleBits(0, 4), cycleBits(1, 6), cycleBits(3, 8), cycleBits(5, 10)];

export class Vic {
  readonly regs = new Uint8Array(0x40);
  line = 0;
  lineCycle = 0;
  compare = 0;
  flags = 0;
  /** DEN was set on line $30, so this frame has badlines */
  private den = true;
  /** in the last advance: the cycle (counted from its start) in which the raster compare raised its flag, else -1 */
  rose = -1;
  /** the sprites whose DMA is on (a bit each), and how many lines of fetches each has left */
  sprites = 0;
  private readonly spriteLines = new Uint8Array(8);
  /** the sprites that were on at the end of the line before: they fetch in this line's cycles 0-9 */
  private spritesBefore = 0;
  /** the BA bits of this line and the next while their keys are the version they were made for */
  private readonly ba0 = new Int32Array(2);
  private readonly ba1 = new Int32Array(2);
  private ba0Key = -1;
  private ba1Key = -1;
  /** bumped by every write and event that changes when BA is low */
  private baVersion = 0;
  private readonly simLines = new Uint8Array(8);

  /** register r as the CPU reads it `at` cycles into the instruction (the raster line may have moved on) */
  read(r: number, at = 0): number {
    const line = this.lineCycle + at >= CYCLES_PER_LINE ? (this.line === LINES - 1 ? 0 : this.line + 1) : this.line;
    switch (r) {
      case 0x11: return (this.regs[0x11] & 0x7f) | ((line & 0x100) >> 1);
      case 0x12: return line & 0xff;
      case 0x16: return this.regs[0x16] | 0xc0;
      case 0x18: return this.regs[0x18] | 0x01;
      case 0x19: return this.flags | 0x70 | (this.flags & this.regs[0x1a] & 0x0f ? 0x80 : 0);
      case 0x1a: return this.regs[0x1a] | 0xf0;
      case 0x1e: case 0x1f: { const v = this.regs[r]; this.regs[r] = 0; return v; }
    }
    if (r >= 0x2f) return 0xff;
    if (r >= 0x20) return this.regs[r] | 0xf0;
    return this.regs[r];
  }

  write(r: number, v: number): void {
    switch (r) {
      case 0x11:
        this.regs[0x11] = v; this.compare = (this.compare & 0xff) | ((v & 0x80) << 1);
        // (DEN set in any cycle of line $30 lets the frame have badlines)
        if (this.line === 0x30 && v & 0x10) this.den = true;
        this.baVersion++;
        return;
      case 0x12: this.compare = (this.compare & 0x100) | v; return;
      case 0x19: this.flags &= ~v & 0x0f; return;
      case 0x1e: case 0x1f: return;
    }
    if (r < 0x2f) this.regs[r] = v;
    // sprite Y positions, enable and Y expansion
    if ((r < 0x10 && r & 1) || r === 0x15 || r === 0x17) this.baVersion++;
  }

  get irq(): boolean { return (this.flags & this.regs[0x1a] & 0x0f) !== 0; }

  /**
   * Let n cycles pass. The VIC's own bus cycles are not in them: the CPU waits for those before an instruction
   * (C64.dmaWait), as BA tells it. Here the sprites' DMA goes on in cycle 54 (Y equal to the line's low byte, the sprite
   * enabled) for 21 lines of fetches (42 Y-expanded), counted down in cycle 15.
   */
  advance(n: number): number {
    this.rose = -1;
    const c0 = this.lineCycle;
    // (no event in these cycles: most of the time)
    if (c0 + n < (c0 < 15 ? 15 : c0 < 54 ? 54 : CYCLES_PER_LINE)) { this.lineCycle = c0 + n; return 0; }
    let done = 0;
    while (done < n) {
      const c = this.lineCycle;
      const next = c < 15 ? 15 : c < 54 ? 54 : CYCLES_PER_LINE;
      const step = Math.min(n - done, next - c);
      this.lineCycle += step; done += step;
      if (this.lineCycle !== next) break;
      if (next === 15) {
        if (this.sprites) for (let i = 0; i < 8; i++) if (this.sprites >> i & 1 && --this.spriteLines[i] === 0) this.sprites &= ~(1 << i);
      } else if (next === 54) {
        this.sprites = this.spritesOn(this.sprites, this.spriteLines, this.line);
      } else {
        this.lineCycle = 0;
        this.spritesBefore = this.sprites;
        const line = this.line = this.line === LINES - 1 ? 0 : this.line + 1;
        if (line === 0x30) this.den = (this.regs[0x11] & 0x10) !== 0;
        // the compare matches in the line's first cycle (line 0: its second, as in VICE)
        if (line === this.compare) { if (!(this.flags & 1)) this.rose = done + (line ? 0 : 1); this.flags |= 1; }
        // (the sprites counted down in cycle 15 and turned on in 54 are what the BA bits already took them to be)
        this.baVersion++;
      }
    }
    return 0;
  }

  /** the sprites on after cycle 54 of `line`: those enabled whose Y is the line's low byte go on */
  private spritesOn(on: number, lines: Uint8Array, line: number): number {
    const r = this.regs, enabled = r[0x15] & ~on;
    if (!enabled) return on;
    for (let i = 0; i < 8; i++) {
      if (enabled >> i & 1 && r[1 + 2 * i] === (line & 0xff)) { on |= 1 << i; lines[i] = r[0x17] >> i & 1 ? 42 : 21; }
    }
    return on;
  }

  /** whether line L is a badline with DEN as latched for its frame and YSCROLL as it is now */
  private badline(line: number, den: boolean): boolean {
    return den && line >= 0x30 && line <= 0xf7 && (line & 7) === (this.regs[0x11] & 7);
  }

  /**
   * The cycles in which BA is low in the line `ahead` lines on (0: this one), as the registers are now (bits for
   * cycles 0-31, 32-62; the arrays for this line and the next are the VIC's own, valid until it changes): the badline's (YSCROLL as it is in each cycle: a write that makes the line a badline
   * after cycle 11 holds the CPU from its next read on, measured in VICE) and the sprites'.
   */
  baBits(ahead: number): Int32Array {
    if (ahead === 0) {
      if (this.ba0Key !== this.baVersion) { this.ba0Key = this.baVersion; this.lineBits(0, this.ba0); }
      return this.ba0;
    }
    if (ahead === 1) {
      if (this.ba1Key !== this.baVersion) { this.ba1Key = this.baVersion; this.lineBits(1, this.ba1); }
      return this.ba1;
    }
    const out = new Int32Array(2);
    this.lineBits(ahead, out);
    return out;
  }

  private lineBits(ahead: number, out: Int32Array): void {
    if (!this.sprites && !this.spritesBefore && !this.regs[0x15]) {
      // (no sprites: only the badline)
      let line = this.line, den = this.den;
      for (let k = 0; k < ahead; k++) { line = line === LINES - 1 ? 0 : line + 1; if (line === 0x30) den = (this.regs[0x11] & 0x10) !== 0; }
      const bad = this.badline(line, den);
      out[0] = bad ? BAD_BA[0] : 0; out[1] = bad ? BAD_BA[1] : 0;
      return;
    }
    const lines = this.simLines;
    lines.set(this.spriteLines);
    let on = this.sprites, before = this.spritesBefore, line = this.line, den = this.den, c = this.lineCycle;
    for (let k = 0; ; k++) {
      if (k > 0) {
        before = on; c = 0;
        line = line === LINES - 1 ? 0 : line + 1;
        if (line === 0x30) den = (this.regs[0x11] & 0x10) !== 0;
      }
      if (c < 15 && on) for (let i = 0; i < 8; i++) if (on >> i & 1 && --lines[i] === 0) on &= ~(1 << i);
      if (c < 54) on = this.spritesOn(on, lines, line);
      if (k === ahead) break;
    }
    let lo = 0, hi = 0;
    if (this.badline(line, den)) { lo = BAD_BA[0]; hi = BAD_BA[1]; }
    for (let i = 3; i < 8; i++) if (before >> i & 1) { lo |= SPRITE_START_BA[i][0]; hi |= SPRITE_START_BA[i][1]; }
    for (let i = 0; i < 5; i++) if (on >> i & 1) { lo |= SPRITE_END_BA[i][0]; hi |= SPRITE_END_BA[i][1]; }
    out[0] = lo; out[1] = hi;
  }

  /** the VIC's state beyond the registers, for a saved machine */
  get spriteState(): { on: number; before: number; lines: number[] } {
    return { on: this.sprites, before: this.spritesBefore, lines: [...this.spriteLines] };
  }
  set spriteState(s: { on: number; before: number; lines: number[] }) {
    this.sprites = s.on; this.spritesBefore = s.before; this.spriteLines.set(s.lines); this.baVersion++;
  }
}

export class Cia {
  pra = 0xff; prb = 0xff; ddra = 0; ddrb = 0;
  ta = 0xffff; tb = 0xffff; tal = 0xffff; tbl = 0xffff;
  cra = 0; crb = 0;
  icr = 0; mask = 0;
  sdr = 0;
  /**
   * cycles a timer does not count yet: one started by a write waits for the rest of the writing instruction and one
   * cycle more, so it counts from the third cycle after the write; one the write loads (force load, bit 4) waits a
   * cycle longer (measured in VICE: STA $DC0E / LDA $DC04 gives the latch minus 2 after a start, minus 1 after a load)
   */
  waitA = 0; waitB = 0;
  /** a write just started (1) or loaded (2) the timer: the C64 sets the wait, as it knows the instruction */
  startedA = 0; startedB = 0;
  /** TOD: tenths, seconds, minutes, hours (BCD) */
  readonly tod = new Uint8Array([0, 0, 0, 1]);
  private todCycles = 0;
  /** the levels of the port pins the outside world drives (keyboard, joysticks, serial bus) */
  inputA: () => number = () => 0xff;
  inputB: () => number = () => 0xff;

  get irq(): boolean { return (this.icr & this.mask & 0x1f) !== 0; }

  /**
   * in the last advance: the cycle (counted from its start) in which a timer's underflow pulled the interrupt line
   * low, else -1. The CPU takes the interrupt as it takes a raster IRQ, after the instruction that ends two cycles or
   * more after it (C64.irqDue, nmiDue)
   */
  rose = -1;

  advance(n: number): void {
    const was = this.irq;
    let underflowsA = 0, atA = -1, atB = -1;
    const nb = n - Math.min(n, this.waitB);
    this.waitB -= n - nb;
    if (this.cra & 1 && !(this.cra & 0x20)) {
      const na = n - Math.min(n, this.waitA);
      this.waitA -= n - na;
      // (the first underflow comes in the cycle the timer goes from 0 on)
      if (this.ta < na) atA = n - na + this.ta;
      this.ta -= na;
      while (this.ta < 0) {
        underflowsA++;
        this.icr |= 1;
        if (this.cra & 8) { this.cra &= ~1; this.ta = this.tal; break; }
        this.ta += this.tal + 1;
      }
    }
    if (this.crb & 1) {
      const mode = (this.crb >> 5) & 3;
      const count = mode === 0 ? nb : mode >= 2 ? underflowsA : 0;
      if (count) {
        if (this.tb < count) atB = Math.min(n - 1, mode === 0 ? n - nb + this.tb : atA + this.tb * (this.tal + 1));
        this.tb -= count;
        while (this.tb < 0) {
          this.icr |= 2;
          if (this.crb & 8) { this.crb &= ~1; this.tb = this.tbl; break; }
          this.tb += this.tbl + 1;
        }
      }
    }
    this.rose = -1;
    if (!was && this.irq) {
      const a = this.mask & 1 && atA >= 0 ? atA : n, b = this.mask & 2 && atB >= 0 ? atB : n;
      if (Math.min(a, b) < n) this.rose = Math.min(a, b);
    }
    this.todCycles += n;
    if (this.todCycles >= CLOCK / 10) { this.todCycles -= CLOCK / 10; this.tickTod(); }
  }

  private tickTod(): void {
    const t = this.tod;
    const inc = (v: number) => (v & 15) === 9 ? (v & 0xf0) + 0x10 : v + 1;
    if ((t[0] = (t[0] + 1) % 10) !== 0) return;
    t[1] = t[1] === 0x59 ? 0 : inc(t[1]);
    if (t[1]) return;
    t[2] = t[2] === 0x59 ? 0 : inc(t[2]);
    if (t[2]) return;
    const pm = t[3] & 0x80, h = t[3] & 0x1f;
    t[3] = h === 0x11 ? 0x12 | (pm ^ 0x80) : h === 0x12 ? 0x01 | pm : inc(h) | pm;
  }

  /**
   * A timer's count `n` cycles on, without letting them pass: the CIA moves on after each instruction, but the
   * instruction reads the timer in its last cycle (code that decrypts itself with the timer's value depends on it).
   */
  private ahead(t: number, latch: number, cr: number, wait: number, n: number): number {
    if (!(cr & 1)) return Math.max(t, 0);
    const v = t - (n - Math.min(n, wait));
    // a running timer reloads as it reaches 0, so it never reads 0: the latch shows for two cycles instead (the
    // underflow still comes a cycle later; Pirate Slayer's boot decrypts itself with these values)
    if (v === 0) return latch;
    if (v > 0) return v;
    return cr & 8 ? latch : latch - ((-v - 1) % (latch + 1));
  }

  /** register r as the CPU reads it `at` cycles into the instruction (the timers count on meanwhile) */
  read(r: number, at = 0): number {
    switch (r) {
      case 0x0: return (this.pra | ~this.ddra) & this.inputA() & 0xff;
      case 0x1: return (this.prb | ~this.ddrb) & this.inputB() & 0xff;
      case 0x2: return this.ddra;
      case 0x3: return this.ddrb;
      case 0x4: return this.ahead(this.ta, this.tal, this.cra & 0x20 ? 0 : this.cra, this.waitA, at) & 0xff;
      case 0x5: return this.ahead(this.ta, this.tal, this.cra & 0x20 ? 0 : this.cra, this.waitA, at) >> 8;
      case 0x6: return this.ahead(this.tb, this.tbl, this.crb & 0x60 ? 0 : this.crb, this.waitB, at) & 0xff;
      case 0x7: return this.ahead(this.tb, this.tbl, this.crb & 0x60 ? 0 : this.crb, this.waitB, at) >> 8;
      case 0x8: return this.tod[0];
      case 0x9: return this.tod[1];
      case 0xa: return this.tod[2];
      case 0xb: return this.tod[3];
      case 0xc: return this.sdr;
      case 0xd: { const v = this.icr | (this.irq ? 0x80 : 0); this.icr = 0; return v; }
      case 0xe: return this.cra & 0xef;
      default: return this.crb & 0xef;
    }
  }

  write(r: number, v: number): void {
    switch (r) {
      case 0x0: this.pra = v; return;
      case 0x1: this.prb = v; return;
      case 0x2: this.ddra = v; return;
      case 0x3: this.ddrb = v; return;
      case 0x4: this.tal = (this.tal & 0xff00) | v; return;
      case 0x5: this.tal = (this.tal & 0xff) | (v << 8); if (!(this.cra & 1)) this.ta = this.tal; return;
      case 0x6: this.tbl = (this.tbl & 0xff00) | v; return;
      case 0x7: this.tbl = (this.tbl & 0xff) | (v << 8); if (!(this.crb & 1)) this.tb = this.tbl; return;
      case 0x8: case 0x9: case 0xa: case 0xb: if (!(this.crb & 0x80)) this.tod[r - 8] = v; return;
      case 0xc: this.sdr = v; return;
      case 0xd: if (v & 0x80) this.mask |= v & 0x1f; else this.mask &= ~v & 0x1f; return;
      case 0xe: if (v & 0x10) this.ta = this.tal; this.startedA = v & 0x10 ? 2 : v & 1 && !(this.cra & 1) ? 1 : 0; this.cra = v & 0xef; return;
      default: if (v & 0x10) this.tb = this.tbl; this.startedB = v & 0x10 ? 2 : v & 1 && !(this.crb & 1) ? 1 : 0; this.crb = v & 0xef;
    }
  }
}

/** The keys held down (by keyboard matrix column, a bit per row) and the joysticks (bit 4 = fire). */
export class Input {
  readonly keys = new Uint8Array(8);
  joy1 = 0;
  joy2 = 0;
  /** the PETSCII code of the key held down, for the stand-in GETIN */
  petscii = 0;
  release(): void { this.keys.fill(0); this.joy1 = this.joy2 = 0; this.petscii = 0; }
}

export interface Roms {
  basic: Uint8Array; kernal: Uint8Array; chargen: Uint8Array;
  /** where they came from */
  source: string;
  /** the 1541's DOS ROM (16 KB), for a disk, and where it came from */
  drive?: Uint8Array;
  driveSource?: string;
}

/** The machine state that can be saved and put back (the post-boot state is reused between files). */
export interface MachineState {
  ram: Uint8Array; color: Uint8Array; ddr: number; port: number;
  cpu: { a: number; x: number; y: number; s: number; pc: number; p: number };
  vic: { regs: Uint8Array; line: number; lineCycle: number; compare: number; flags: number; sprites?: Vic['spriteState'] };
  cia: [Cia, Cia];
  cycles: number;
}

/** the noise register's period (it never holds 0) */
const NOISE_PERIOD = 0x7fffff;

/**
 * SID voice 3's oscillator as a program reads it at $d41b (OSC3), as an 8580 makes it (VICE's default SID: reSID, its
 * wave.cc/wave.h): a 24-bit accumulator ($555555 at power-on) adds the frequency each cycle; the output is the top 8 of
 * the 12 bits of the selected waveforms (sawtooth: the accumulator's top bits; triangle: the bits after the top one,
 * inverted while it is set, or while it differs from voice 2's with ring modulation; pulse: on while the top 12 bits
 * reach the pulse width, compared a cycle late; noise: 8 bits of a 23-bit shift register, $7ffffe at power-on, that
 * shifts two cycles after accumulator bit 19 rises). The 8580's triangle and sawtooth come a cycle late. The test bit
 * holds the accumulator at 0 and the pulse high; let go, it shifts the noise register once (bit 17 inverted in), and
 * held for 2519864 cycles it fills the register with ones, a bit every 315000 cycles more. Sync resets the
 * accumulator as voice 2's top bit rises (it and ring modulation are done roughly and not measured). Measured in VICE (x64sc, reSID 8580): the test bit let go before a read moved
 * one cycle at a time, and noise read every 20 cycles for 256 reads. Not emulated: waveforms combined with each other
 * (an 8580 gives its own values, here the AND of them) and the noise register written back by them, the output fading
 * while no waveform is on, the 6581 (its triangle and sawtooth a cycle earlier, its noise otherwise), the envelope
 * ($d41c reads 0). The oscillators run only as far as a read or a write of voice 2's or 3's registers needs.
 */
export class Osc3 {
  /** the cycle the oscillators have run to */
  at = 0;
  /** voice 3's accumulator, the cycle before, and voice 2's */
  acc = 0x555555; before = 0x555555; acc2 = 0x555555;
  /** the noise shift register, and the cycle a shift is due in (-1: none) */
  noise = 0x7ffffe; shiftAt = -1;
  /** the cycle the test bit went on, while it is (-1: off or the register already reset) */
  testFrom = -1;
  /** the waveform output last read (12 bits): it stays while no waveform is on */
  held = 0;

  private readonly regs: Uint8Array;

  constructor(regs: Uint8Array) { this.regs = regs; }

  /** a write to voice 2's or 3's register r in cycle t */
  write(r: number, v: number, t: number): void {
    this.run(t);
    const was = this.regs[0x12];
    this.regs[r] = v;
    if (r !== 0x12) return;
    if (v & 8 && !(was & 8)) { this.acc = this.before = 0; this.shiftAt = -1; this.testFrom = t; }
    else if (!(v & 8) && was & 8) {
      this.noise = ((this.noise << 1) | (~this.noise >> 17 & 1)) & 0x7fffff;
      this.testFrom = -1;
    }
  }

  /** $d41b as read in cycle t */
  read(t: number): number {
    this.run(t);
    const r = this.regs, ctrl = r[0x12], wave = ctrl >> 4;
    if (!wave) return this.held >> 4;
    let out = 0xfff;
    if (wave & 1) {
      const top = (ctrl & 4 ? this.before ^ this.acc2 : this.before) & 0x800000;
      out &= ((top ? ~this.before : this.before) >> 11) & 0xfff;
    }
    if (wave & 2) out &= this.before >> 12;
    if (wave & 4 && !(ctrl & 8) && (this.before >> 12) < ((r[0x10] | (r[0x11] << 8)) & 0xfff)) out = 0;
    if (wave & 8) {
      const n = this.noise;
      out &= ((n >> 9) & 0x800) | ((n >> 8) & 0x400) | ((n >> 5) & 0x200) | ((n >> 3) & 0x100) | ((n >> 2) & 0x080)
        | ((n << 1) & 0x040) | ((n << 3) & 0x020) | ((n << 4) & 0x010);
    }
    this.held = out;
    return out >> 4;
  }

  /** Let the oscillators run to cycle t. */
  run(t: number): void {
    const from = this.at, n = t - from;
    if (n <= 0) return;
    this.at = t;
    const r = this.regs, ctrl = r[0x12], f = r[0x0e] | (r[0x0f] << 8);
    // voice 2, for ring modulation and sync: the last cycle its top bit rose (0: none)
    const f2 = r[0x07] | (r[0x08] << 8), a2 = this.acc2;
    let rose2 = 0;
    if (r[0x0b] & 8) this.acc2 = 0;
    else {
      if (ctrl & 2 && f2) {
        // (the top bit rises as the accumulator passes m * 2^24 + 2^23: the cycles since the last time)
        const last = Math.floor((a2 + n * f2 - 0x800000) / 0x1000000);
        if (last > Math.floor((a2 - 0x800000) / 0x1000000)) rose2 = n - Math.ceil((last * 0x1000000 + 0x800000 - a2) / f2) + 1;
      }
      this.acc2 = (a2 + n * f2) % 0x1000000;
    }
    if (ctrl & 8) {
      // (held long enough, the test bit fills the noise register with ones, a bit at a time)
      const fade = this.testFrom + 2519864;
      if (this.testFrom >= 0 && t >= fade) {
        let s = this.noise;
        for (let i = from >= fade ? Math.floor((from - fade) / 315000) + 1 : 0, end = Math.floor((t - fade) / 315000) + 1; i < end && s !== 0x7fffff; i++) {
          s |= 1; s = (s | (s << 1)) & 0x7fffff;
        }
        this.noise = s;
      }
      return;
    }
    let shifts = 0;
    if (this.shiftAt >= 0 && this.shiftAt <= t) { shifts++; this.shiftAt = -1; }
    const a = this.acc;
    if (f) {
      // bit 19 rises as the accumulator passes m * 2^20 + 2^19; the register shifts two cycles later
      const first = Math.floor((a - 0x80000) / 0x100000), last = Math.floor((a + n * f - 0x80000) / 0x100000);
      const k = last - first;
      if (k > 0) {
        const j = Math.ceil((last * 0x100000 + 0x80000 - a) / f);
        if (j + 2 <= n) shifts += k;
        else { shifts += k - 1; this.shiftAt = from + j + 2; }
      }
    }
    if (shifts) {
      let s = this.noise;
      for (let i = shifts % NOISE_PERIOD; i > 0; i--) s = ((s << 1) | (((s >> 22) ^ (s >> 17)) & 1)) & 0x7fffff;
      this.noise = s;
    }
    if (rose2) {
      // synced: counting again from 0 since voice 2's top bit last rose
      this.acc = ((rose2 - 1) * f) % 0x1000000; this.before = (Math.max(0, rose2 - 2) * f) % 0x1000000;
    } else {
      this.acc = (a + n * f) % 0x1000000; this.before = (a + (n - 1) * f) % 0x1000000;
    }
  }
}

export class C64 implements Bus {
  readonly ram = new Uint8Array(0x10000);
  readonly color = new Uint8Array(0x400);
  readonly map = new Uint8Array(256);
  basic: Uint8Array;
  kernal: Uint8Array;
  chargen: Uint8Array;
  ddr = 0x2f;
  port = 0x37;
  readonly vic = new Vic();
  readonly cia1 = new Cia();
  readonly cia2 = new Cia();
  readonly sidRegs = new Uint8Array(0x20);
  /** SID voice 3's oscillator, which a program can read at $d41b */
  readonly osc3 = new Osc3(this.sidRegs);
  readonly input = new Input();
  readonly cpu: Cpu;
  cycles = 0;
  /** the 1541 on the serial bus, and the C64 and drive cycles when it was attached */
  drive: Drive | null = null;
  private driveBase = 0;
  private driveStart = 0;
  /** the datasette with its tape, PLAY held down: its pulses reach CIA1's FLAG line while the motor runs */
  tape: Datasette | null = null;

  // --- tracking ---------------------------------------------------------------------------------------------------
  /** the layer that wrote each RAM byte last (BOOT, LOADED or a layer id) */
  readonly wid = new Int32Array(0x10000).fill(BOOT);
  /** when it was written last (an instruction count, 0 = never) */
  readonly wtime = new Uint32Array(0x10000);
  /** when it was last read as data */
  readonly rtime = new Uint32Array(0x10000);
  /** when it was last executed (any byte of an instruction) */
  readonly etime = new Uint32Array(0x10000);
  /** the opcode it held when it was last executed as one (code that is overwritten later keeps its fingerprint) */
  readonly eop = new Uint8Array(0x10000);
  /** since the file was loaded (instruction counts, 0 = not yet): when each byte was first executed as an opcode, as an
   *  operand, read as data and written. What happened up to the first write was done with the byte as it was loaded */
  readonly firstOp = new Uint32Array(0x10000);
  readonly firstArg = new Uint32Array(0x10000);
  readonly firstRead = new Uint32Array(0x10000);
  readonly firstWrite = new Uint32Array(0x10000);
  /** when each byte was first written in this machine (by the CPU, LOAD or Sindri; 0 = never): a byte never written
   *  still holds what the C64 started up with (POWER_ON, where the start-up left it) */
  readonly firstTouch = new Uint32Array(0x10000);
  /** the tag new writes get */
  tag = BOOT;
  /** the CPU runs ROM code (or C64 set-up code in RAM): its writes below $0400 are the system's (keyboard buffer,
   * clock, screen editor), not the program's */
  inRom = true;
  /** instructions executed (from 1) */
  icount = 1;
  /**
   * Writes (from $0400) to addresses not written since `freshMark` (an instruction count), next to the one before:
   * a depacker streaming its output through memory makes many, a program rewriting its screen and variables (or
   * now and then a variable it had not touched for a while) next to none. Sindri tells progress from settling
   * with it.
   */
  fresh = 0;
  freshMark = 0;
  private lastFresh = -2;
  /** writes to I/O registers since the counter was reset (VIC, SID, CIA), for telling programs from depackers */
  ioWrites = 0;

  private fade = 0;
  private fadeUntil = 0;

  constructor(roms: Roms) {
    this.basic = roms.basic; this.kernal = roms.kernal; this.chargen = roms.chargen;
    this.cpu = new Cpu(this);
    this.cia1.inputA = () => ~this.input.joy2 & 0xff;
    this.cia1.inputB = () => {
      const cols = ~(this.cia1.pra | ~this.cia1.ddra) & 0xff;
      let rows = 0xff;
      for (let c = 0; c < 8; c++) if (cols & (1 << c)) rows &= ~this.input.keys[c];
      return rows & ~this.input.joy1 & 0xff;
    };
    // serial bus: CLK IN and DATA IN are low while either side pulls them; with no drive only the C64's own
    // (inverted) outputs do
    this.cia2.inputA = () => {
      const d = this.drive;
      if (d) return 0x3f | (d.clkLow ? 0 : 0x40) | (d.dataLow ? 0 : 0x80);
      return 0x3f | (this.cia2.pra & 0x10 ? 0 : 0x40) | (this.cia2.pra & 0x20 ? 0 : 0x80);
    };
    this.updateMap();
  }

  // --- the serial bus -------------------------------------------------------------------------------------------
  /** Put a 1541 on the serial bus; it runs from now on, behind the C64. */
  attachDrive(d: Drive): void {
    this.drive = d;
    this.driveBase = this.cycles;
    this.driveStart = d.cycles;
    this.serialOut();
  }

  /** Let the drive catch up to C64 cycle `at`. */
  syncDrive(at = this.cycles): void {
    this.drive?.runUntil(this.driveStart + (at - this.driveBase) * DRIVE_RATIO);
  }

  /** the C64's ATN, CLK and DATA outputs (bits 3-5 of $dd00, through inverters: a 1 pulls the line low) */
  private serialOut(): void {
    const l = this.serialLines();
    this.drive!.setC64((l & 1) !== 0, (l & 2) !== 0, (l & 4) !== 0);
  }

  /** the lines the C64 pulls low: bit 0 ATN, 1 CLK, 2 DATA */
  private serialLines(): number {
    const out = this.cia2.pra | ~this.cia2.ddra;
    return ((out >> 3) & 1) | ((out >> 3) & 2) | ((out >> 3) & 4);
  }

  /** the cycle in which the running instruction reaches the bus: its last one (a read across a page takes one more) */
  private get busCycle(): number { return this.cycles + this.lastCycle; }

  /** the last cycle of the running instruction, counted from its first: where it reads or writes I/O */
  private get lastCycle(): number { return CYCLES[this.cpu.lastOp & 0xff] - 1 + this.cpu.penalty; }

  // --- banking ----------------------------------------------------------------------------------------------------
  updateMap(): void {
    const m = (this.port | ~this.ddr) & 7;
    const map = this.map;
    map.fill(RAM);
    map[0] = ZP;
    const basic = (m & 3) === 3 ? BASIC : RAM;
    for (let p = 0xa0; p < 0xc0; p++) map[p] = basic;
    const d = (m & 3) === 0 ? RAM : m & 4 ? IO : CHAR;
    for (let p = 0xd0; p < 0xe0; p++) map[p] = d;
    const kernal = m & 2 ? KERNAL : RAM;
    for (let p = 0xe0; p < 0x100; p++) map[p] = kernal;
  }

  /** the processor port as read at $01: pull-ups on bits 0-2, the cassette buttons on bit 4 (0 with PLAY held down on
   *  the datasette), bits 6-7 fade */
  private readPort(): number {
    let inputs = this.tape ? 0x07 : 0x17;
    if (this.cycles < this.fadeUntil) inputs |= this.fade;
    return ((this.port & this.ddr) | (~this.ddr & inputs)) & 0xff;
  }

  private writePort(a: number, v: number): void {
    if (a === 0) {
      // bits 6-7 switched to input keep their level for a while
      const off = this.ddr & ~v & 0xc0;
      if (off) { this.fade = (this.fade & ~off) | (this.port & off); this.fadeUntil = this.cycles + 350000; }
      this.ddr = v;
    } else this.port = v;
    this.updateMap();
    // the cassette motor runs while the port drives bit 5 low
    if (this.tape) this.tape.motor = (this.ddr & 0x20) !== 0 && (this.port & 0x20) === 0;
  }

  /** the value at $01 as a program sees it */
  get cpuPort(): number { return this.readPort(); }

  // --- the bus ----------------------------------------------------------------------------------------------------
  read(a: number): number {
    switch (this.map[a >> 8]) {
      case RAM:
        // (the system reading its own variables below $0400, as the KERNAL's interrupt does, is not the program's)
        if (!this.inRom || a >= 0x400) { this.rtime[a] = this.icount; if (!this.firstRead[a]) this.firstRead[a] = this.icount; }
        return this.ram[a];
      case ZP:
        if (a === 0) return this.ddr;
        if (a === 1) return this.readPort();
        if (!this.inRom) { this.rtime[a] = this.icount; if (!this.firstRead[a]) this.firstRead[a] = this.icount; }
        return this.ram[a];
      case BASIC: return this.basic[a - 0xa000];
      case KERNAL: return this.kernal[a - 0xe000];
      case CHAR: return this.chargen[a - 0xd000];
      default: return this.readIo(a);
    }
  }

  fetch(a: number): number {
    switch (this.map[a >> 8]) {
      case RAM: case ZP: return a > 1 ? this.ram[a] : a === 0 ? this.ddr : this.readPort();
      case BASIC: return this.basic[a - 0xa000];
      case KERNAL: return this.kernal[a - 0xe000];
      case CHAR: return this.chargen[a - 0xd000];
      default: return this.readIo(a);
    }
  }

  write(a: number, v: number): void {
    if (this.map[a >> 8] === IO) { this.writeIo(a, v); return; }
    if (a < 2) this.writePort(a, v);
    if (a >= 0x400 && this.wtime[a] < this.freshMark) {
      if (a - this.lastFresh === 1 || this.lastFresh - a === 1) this.fresh++;
      this.lastFresh = a;
    }
    this.wid[a] = this.inRom && a < 0x400 ? BOOT : this.tag;
    this.wtime[a] = this.icount;
    if (!this.firstWrite[a]) this.firstWrite[a] = this.icount;
    if (!this.firstTouch[a]) this.firstTouch[a] = this.icount;
    this.ram[a] = v;
  }

  /** what the CPU would read, without side effects (for reports and traps) */
  peek(a: number): number {
    switch (this.map[a >> 8]) {
      case BASIC: return this.basic[a - 0xa000];
      case KERNAL: return this.kernal[a - 0xe000];
      case CHAR: return this.chargen[a - 0xd000];
      case IO: return a >= 0xd800 && a < 0xdc00 ? this.color[a & 0x3ff] : 0;
      default: return a > 1 ? this.ram[a] : a === 0 ? this.ddr : this.readPort();
    }
  }

  peekWord(a: number): number { return this.peek(a) | (this.peek((a + 1) & 0xffff) << 8); }

  private readIo(a: number): number {
    // the timers and the raster line as they are in the cycle the instruction reads them (its last one)
    const at = this.lastCycle;
    if (a < 0xd400) return this.vic.read(a & 0x3f, at);
    if (a < 0xd800) return this.readSid(a & 0x1f);
    if (a < 0xdc00) return this.color[a & 0x3ff] & 0x0f;
    if (a < 0xdd00) return this.cia1.read(a & 0x0f, at);
    if (a < 0xde00) {
      // ($dd00 and $dd02, the serial port and its data direction: the drive catches up first)
      if (this.drive && (a & 0x0d) === 0) this.syncDrive(this.busCycle);
      return this.cia2.read(a & 0x0f, at);
    }
    return 0;
  }

  private writeIo(a: number, v: number): void {
    this.ioWrites++;
    const irqWas = this.irqLine, nmiWas = this.cia2.irq;
    this.writeChip(a, v);
    // a write that lets an interrupt through (its enable bit set while its flag is up) pulls the line low in its own
    // cycle, the last of the instruction: the CPU takes it after the next one (measured in VICE: STA $D01A or STA
    // $DC0D/$DD0D with #$81 and the flag up, then NOPs: the return address is the second NOP)
    if (!irqWas && this.irqLine) this.irqSince = this.busCycle;
    if (!nmiWas && this.cia2.irq) this.nmiEdge(this.busCycle);
  }

  private writeChip(a: number, v: number): void {
    if (a < 0xd400) this.vic.write(a & 0x3f, v);
    else if (a < 0xd800) {
      const r = a & 0x1f;
      // (voice 2's and 3's registers: oscillator 3 runs up to the write's cycle first)
      if (r >= 0x07 && r <= 0x12) this.osc3.write(r, v, this.busCycle);
      else this.sidRegs[r] = v;
    }
    else if (a < 0xdc00) this.color[a & 0x3ff] = v & 0x0f;
    else if (a < 0xdd00) { this.cia1.write(a & 0x0f, v); this.timerStart(this.cia1); }
    else if (a < 0xde00) {
      const serial = this.drive && (a & 0x0d) === 0;
      // what the C64 does to ATN, CLK and DATA reaches the drive a cycle after the write, as in VICE (maincpu_clk + 1):
      // the drive runs to then first. Fast loaders are timed so to the cycle: Pirate Slayer's reads its first bit pair
      // 16 cycles after it lets DATA go, and Megaparts 2's drive sends a byte's four pairs 16-40 cycles after ATN goes
      // (one cycle off, every tenth byte arrived wrong). (Until the C64's IRQs were taken in the right cycle, a delay on
      // ATN broke Krill's loader and others; see docs/pirateslayer.md)
      if (serial) this.syncDrive(this.busCycle + 1);
      this.cia2.write(a & 0x0f, v);
      this.timerStart(this.cia2);
      if (serial) this.serialOut();
    }
  }

  /**
   * a timer the write started waits for the rest of this instruction (see Cia.waitA): the write is in its last
   * cycle, and the timer counts from the third cycle after it, as on the 6526 (read right after STA $DC0E, LDA
   * $DC04 gives the latch minus 2), or from the fourth when the write loads it (the latch minus 1)
   */
  private timerStart(cia: Cia): void {
    const wait = CYCLES[this.cpu.lastOp & 0xff];
    if (cia.startedA) { cia.waitA = wait + cia.startedA; cia.startedA = 0; }
    if (cia.startedB) { cia.waitB = wait + cia.startedB; cia.startedB = 0; }
  }

  private readSid(r: number): number {
    switch (r) {
      case 0x19: case 0x1a: return 0xff;
      // (in the cycle the instruction reads it, its last)
      case 0x1b: return this.osc3.read(this.busCycle);
      default: return 0;
    }
  }

  // --- time and interrupts ----------------------------------------------------------------------------------------
  /**
   * Before the instruction at PC: the cycles the CPU waits for the VIC. While BA is low (a badline's cycles 11-53, a
   * sprite's fetches and the three cycles before them; Vic.baBits) the 6510 stops at its next read cycle until BA is
   * high again, and its write cycles go on. The instruction's cycles, read or write, are walked against BA (its page
   * crossing and taken branch counted), and the time it waits passes first: its I/O access in its last cycle comes after
   * the VIC's. Fast loaders that read the serial port at counted cycles around badlines depend on it, raster code on
   * sprites taking their cycles, and FLI-like code on a badline its $d011 write makes in the middle of a line (Continuum,
   * Triad 2014: its NMI handler does it every eighth line, 40 cycles each). Measured in VICE (x64sc) with a cycle-exact
   * raster sync, a timer and a read moved one cycle at a time (test/timing.test.ts).
   */
  dmaWait(): void {
    const v = this.vic, c = v.lineCycle, bits = v.baBits(0);
    // (most of the time BA stays high through the instruction, 9 cycles at most)
    if (c < CYCLES_PER_LINE - 9) {
      if (!(bits[0] | bits[1])) return;
      const lo = c < 32 ? bits[0] >>> c : 0, hi = c > 23 ? (c < 32 ? bits[1] << (32 - c) : bits[1] >>> (c - 32)) : 0;
      if (!((lo | hi) & 0x1ff)) return;
    } else if (!(bits[1] >>> (c - 32)) && !(v.baBits(1)[0] & ((1 << (c + 9 - CYCLES_PER_LINE)) - 1))) return;
    const op = this.peek(this.cpu.pc);
    const wait = this.baWait(this.nextCycles(op), WRITE_CYCLES[op]);
    if (wait) this.advance(wait);
  }

  /** The cycles n cycles of the CPU (bit k of `writes` set: cycle k writes) wait for BA from now on. */
  baWait(n: number, writes: number): number {
    const v = this.vic;
    let c = v.lineCycle, ahead = 0, bits = v.baBits(0), wait = 0;
    for (let k = 0; k < n; k++) {
      if (!(writes >> k & 1)) {
        while ((c < 32 ? bits[0] >>> c : bits[1] >>> (c - 32)) & 1) {
          wait++;
          if (++c === CYCLES_PER_LINE) { c = 0; bits = v.baBits(++ahead); }
        }
      }
      if (++c === CYCLES_PER_LINE) { c = 0; bits = v.baBits(++ahead); }
    }
    return wait;
  }

  /**
   * The cycles the instruction at PC takes (op: its opcode), a page crossing and a taken branch included, as Cpu.step
   * will count them.
   */
  nextCycles(op: number): number {
    const cpu = this.cpu, pc = cpu.pc;
    let n = CYCLES[op];
    if (PAGE_CROSS[op]) {
      const mode = OPCODES[op].mode;
      let base: number, index: number;
      if (mode === 'izy') { const p = this.peek((pc + 1) & 0xffff); base = this.peek(p) | (this.peek((p + 1) & 0xff) << 8); index = cpu.y; }
      else { base = this.peekWord((pc + 1) & 0xffff); index = mode === 'abx' ? cpu.x : cpu.y; }
      if (((base + index) ^ base) & 0xff00) n++;
    } else if ((op & 0x1f) === 0x10) {
      // BPL BMI BVC BVS BCC BCS BNE BEQ: N, V, C or Z, clear or set
      const flag = op < 0x40 ? cpu.n : op < 0x80 ? cpu.v : op < 0xc0 ? cpu.c : cpu.z, taken = op & 0x20 ? flag !== 0 : flag === 0;
      if (taken) {
        const next = (pc + 2) & 0xffff, to = (next + ((this.peek((pc + 1) & 0xffff) ^ 0x80) - 0x80)) & 0xffff;
        n += (to ^ next) & 0xff00 ? 2 : 1;
      }
    }
    return n;
  }

  /** The CPU takes an IRQ (irqDue, the I flag clear): its cycles, the wait for BA first, to pass with advance. */
  takeIrq(): number {
    const wait = this.baWait(7, INTERRUPT_WRITES);
    if (wait) this.advance(wait);
    return this.cpu.irq();
  }

  /** Let the cycles of one instruction pass; returns them plus the cycles badlines stole. */
  advance(n: number): number {
    const was = this.irqLine, nmiWas = this.cia2.irq, t0 = this.cycles;
    const total = n + this.vic.advance(n);
    this.cia1.advance(total);
    this.cia2.advance(total);
    // a pulse from the tape ends: an edge on the FLAG line
    if (this.tape?.motor && this.tape.advance(total)) this.cia1.icr |= 0x10;
    this.cycles += total;
    // the IRQ line went low: in the cycle the raster compare matched or a CIA 1 timer underflowed (the earlier of
    // them), or (the tape) as at the start of the instruction
    if (!was && this.irqLine) {
      const v = this.vic.irq && this.vic.rose >= 0 ? this.vic.rose : Infinity, c = this.cia1.irq && this.cia1.rose >= 0 ? this.cia1.rose : Infinity;
      this.irqSince = t0 + (Math.min(v, c) < Infinity ? Math.min(v, c) : 0);
    }
    if (!nmiWas && this.cia2.irq) this.nmiEdge(t0 + Math.max(0, this.cia2.rose));
    return total;
  }

  /** the cycle the IRQ line went low (while it is) */
  irqSince = 0;

  get irqLine(): boolean { return this.vic.irq || this.cia1.irq; }

  /**
   * After an instruction: whether the CPU takes an IRQ now (the caller checks the I flag). The 6510 polls the line in
   * the instruction's last cycle, with the level it had a cycle before: an IRQ that comes in the last cycle waits for
   * the next instruction, and a taken branch that stays in its page polls a cycle earlier still (measured in VICE
   * with raster IRQs after a cycle-exact sync: The Wild Bunch's IRQ handler times itself by CIA timer A, and taken a
   * few cycles early it branches past the end of its delay into a JAM). The same holds for a CIA timer's IRQ, counted
   * from the cycle of its underflow (measured in VICE with one-shot timers before chains of NOP, BNE, BIT and INC).
   */
  irqDue(): boolean {
    return this.irqLine && this.irqSince <= this.cycles - (this.cpu.quickBranch ? 3 : 2);
  }

  /** CIA 2's interrupt output, the NMI line (low while true) */
  get nmiLine(): boolean { return this.cia2.irq; }

  /** the 6510 saw the NMI line go low and has not taken the NMI yet; nmiSince: the cycle it went low */
  private nmiPending = false;
  nmiSince = 0;

  private nmiEdge(at: number): void { this.nmiPending = true; this.nmiSince = at; }

  /**
   * After an instruction: whether the CPU takes an NMI now. The 6510 latches the line's edge and takes the NMI as it
   * takes an IRQ: after the instruction that ends two cycles or more after it (three after a taken branch in its
   * page), measured in VICE as for the IRQ. Taken an instruction early, Continuum's (Triad 2014) NMI handler, which
   * jumps through CIA 1's timer B ($dc06, a cycle counter of the raster line) to code for the cycle it came in,
   * reads a value one higher than any it has code for, jumps into data and crashes.
   */
  nmiDue(): boolean {
    return this.nmiPending && this.nmiSince <= this.cycles - (this.cpu.quickBranch ? 3 : 2);
  }

  /** The CPU takes the NMI (nmiDue): its cycles, to pass with advance. */
  takeNmi(): number {
    this.nmiPending = false;
    const wait = this.baWait(7, INTERRUPT_WRITES);
    if (wait) this.advance(wait);
    return this.cpu.nmi();
  }

  // --- state ------------------------------------------------------------------------------------------------------
  save(): MachineState {
    const c = this.cpu;
    const copyCia = (s: Cia) => Object.assign(Object.create(Cia.prototype) as Cia, s, { tod: s.tod.slice() });
    return {
      ram: this.ram.slice(), color: this.color.slice(), ddr: this.ddr, port: this.port,
      cpu: { a: c.a, x: c.x, y: c.y, s: c.s, pc: c.pc, p: c.p },
      vic: { regs: this.vic.regs.slice(), line: this.vic.line, lineCycle: this.vic.lineCycle, compare: this.vic.compare, flags: this.vic.flags, sprites: this.vic.spriteState },
      cia: [copyCia(this.cia1), copyCia(this.cia2)],
      cycles: this.cycles,
    };
  }

  restore(s: MachineState): void {
    this.ram.set(s.ram); this.color.set(s.color); this.ddr = s.ddr; this.port = s.port;
    if (this.tape) this.tape.motor = (this.ddr & 0x20) !== 0 && (this.port & 0x20) === 0;
    const c = this.cpu;
    c.a = s.cpu.a; c.x = s.cpu.x; c.y = s.cpu.y; c.s = s.cpu.s; c.pc = s.cpu.pc; c.p = s.cpu.p;
    this.vic.regs.set(s.vic.regs); this.vic.line = s.vic.line; this.vic.lineCycle = s.vic.lineCycle;
    this.vic.compare = s.vic.compare; this.vic.flags = s.vic.flags;
    this.vic.spriteState = s.vic.sprites ?? { on: 0, before: 0, lines: [0, 0, 0, 0, 0, 0, 0, 0] };
    for (const [mine, saved] of [[this.cia1, s.cia[0]], [this.cia2, s.cia[1]]] as const) {
      const { inputA, inputB } = mine;
      Object.assign(mine, saved, { tod: saved.tod.slice(), inputA, inputB });
    }
    this.cycles = s.cycles;
    // (the oscillators go on from here; the SID's state is not saved)
    this.osc3.at = s.cycles;
    this.nmiPending = false;
    this.updateMap();
  }
}
