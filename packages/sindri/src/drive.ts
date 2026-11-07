/* The 1541 disk drive on the serial bus: its own 6502 with 2 KB of RAM, the DOS ROM (from VICE, never shipped),
 * VIA 1 on the serial bus and VIA 2 on the read/write head, and a disk turning under the head at 300 rpm.
 *
 * It runs behind the C64, cycle for cycle at its own 1 MHz: whenever the C64 reads or writes the serial port
 * ($dd00) the drive first catches up to that moment, running every instruction whose bus access comes before the
 * C64's. So both see the lines change in the order a real C64 and 1541 would, which fast loaders that count cycles
 * depend on.
 *
 * The serial bus: ATN, CLK and DATA are open-collector lines, low when either side pulls them. VIA 1 port B: bit 0
 * DATA in, bit 1 DATA out, bit 2 CLK in, bit 3 CLK out, bit 4 ATN acknowledge, bits 5-6 the device number (8),
 * bit 7 ATN in (the inputs read 1 while a line is low); CA1 sees ATN. The drive pulls DATA low by itself while ATN
 * and the acknowledge bit differ. VIA 2: port A the GCR byte under the head, port B bits 0-1 the stepper, bit 2 the
 * motor, bit 3 the LED, bit 4 write protect, bits 5-6 the density, bit 7 SYNC (0 while the head is over one); CA1
 * byte ready, which also sets the CPU's overflow flag while CA2 is high; CB2 low writes. */
import { Cpu, type Bus } from './cpu.ts';
import { BYTE_CYCLES, type Disk } from './gcr.ts';
import { CYCLES } from './opcodes.ts';
import { Via, type ViaState } from './via.ts';

/** drive cycles per C64 cycle (1 MHz against PAL's 985248 Hz) */
export const DRIVE_RATIO = 1_000_000 / 985248;

export interface DriveState {
  ram: Uint8Array; cpu: { a: number; x: number; y: number; s: number; pc: number; p: number };
  via1: ViaState; via2: ViaState; cycles: number; halftrack: number;
}

export class Drive implements Bus {
  readonly ram = new Uint8Array(0x800);
  readonly via1 = new Via();
  readonly via2 = new Via();
  readonly cpu: Cpu;
  readonly rom: Uint8Array;
  disk: Disk | null = null;
  /** drive cycles since power-on */
  cycles = 0;
  /**
   * the head: half tracks from 2 (track 1) to 84 (track 42). The stepper's phase (VIA 2 port B bits 0-1) is tied to
   * where the head is: phase 0 on track 1, 2 on track 2, 0 on track 3 and so on (as in VICE, after its first seek
   * to track 1), so a reset that sets phase 0 moves the head off an even track
   */
  halftrack = 36;
  /**
   * The head on a G64 reads bit by bit, as the 1541's does: the bit under it on the track, the bits since the last
   * SYNC (a byte every 8, which the SYNC lines up), the 1 bits in a row (ten are a SYNC), the bits read lately, and the
   * time towards the next bit (in eighths of a cycle); a G64 track is as a bit copier read it, SYNCs anywhere, or none
   * at all. A track a D64 makes is whole bytes after every SYNC, so it reads a byte at a time (and as fast as before).
   */
  private bit = 0;
  private count = 0;
  private ones = 0;
  private shift = 0;
  private rot = 0;
  private latch = 0;
  private sync = false;
  /** the byte being written, loaded from VIA 2 port A when the last one was done */
  private wbyte = 0;
  /** tracks with no SYNC anywhere on them */
  private syncless = new WeakMap<Uint8Array, boolean>();
  /** the lines the C64 pulls low */
  c64Atn = false; c64Clk = false; c64Data = false;
  /** bytes the head read and wrote, for the report */
  bytesRead = 0;
  bytesWritten = 0;
  /** times the drive changed its own DATA or CLK line: it talks on the serial bus (sends what it read, answers the
   *  C64) */
  busChanges = 0;
  private lines = 0;

  constructor(rom: Uint8Array) {
    if (rom.length !== 0x4000) throw new Error(`a 1541 DOS ROM has 16 KB, not ${rom.length} bytes`);
    this.rom = rom;
    this.cpu = new Cpu(this);
    this.via1.inputB = () => (this.dataLow ? 0x01 : 0) | (this.clkLow ? 0x04 : 0) | (this.c64Atn ? 0x80 : 0);
    this.via2.inputA = () => this.latch;
    this.via2.inputB = () => (this.sync ? 0 : 0x80) | (this.disk?.writeProtected ? 0 : 0x10);
    this.via2.changedB = () => this.step2();
    this.via1.changedB = () => {
      const l = this.via1.outB & 0x0a;
      if (l !== this.lines) { this.lines = l; this.busChanges++; }
    };
    this.reset();
  }

  reset(): void {
    const c = this.cpu;
    c.s = 0xfd; c.p = 0x24; c.jammed = false;
    c.pc = this.read(0xfffc) | (this.read(0xfffd) << 8);
  }

  /** the spindle motor runs (VIA 2 port B bit 2): the drive is loading or about to */
  get motorOn(): boolean { return (this.via2.outB & 0x04) !== 0; }

  /**
   * Insert the disk and have the DOS read a header on track 18, as it does when the C64 loads the file: then it
   * knows the disk's ID, which reading a sector through the job queue checks (code a loader sends with M-E does).
   */
  insert(disk: Disk): void {
    this.disk = disk;
    const ram = this.ram, start = this.cycles;
    ram[0x06] = 18; ram[0x07] = 0; ram[0x00] = 0xb0;
    while (ram[0x00] >= 0x80 && this.cycles - start < 3_000_000) this.step();
  }

  // --- the bus lines --------------------------------------------------------------------------------------------
  get atnLow(): boolean { return this.c64Atn; }
  get clkLow(): boolean { return this.c64Clk || (this.via1.outB & 0x08) !== 0; }
  get dataLow(): boolean { const b = this.via1.outB; return this.c64Data || (b & 0x02) !== 0 || this.c64Atn !== ((b & 0x10) !== 0); }

  /** The C64 changed its serial outputs (true: it pulls the line low). */
  setC64(atn: boolean, clk: boolean, data: boolean): void {
    this.c64Clk = clk; this.c64Data = data;
    if (atn !== this.c64Atn) { this.c64Atn = atn; this.via1.setCa1(atn); }
  }

  // --- memory ---------------------------------------------------------------------------------------------------
  read(a: number): number {
    if (a < 0x1800) return this.ram[a & 0x7ff];
    if (a < 0x1c00) return this.via1.read(a & 0x0f);
    if (a < 0x2000) return this.via2.read(a & 0x0f);
    if (a >= 0x8000) return this.rom[a & 0x3fff];
    return a >> 8;
  }

  fetch(a: number): number { return a < 0x1800 ? this.ram[a & 0x7ff] : a >= 0x8000 ? this.rom[a & 0x3fff] : this.read(a); }

  write(a: number, v: number): void {
    if (a < 0x1800) this.ram[a & 0x7ff] = v;
    else if (a < 0x1c00) this.via1.write(a & 0x0f, v);
    else if (a < 0x2000) this.via2.write(a & 0x0f, v);
  }

  // --- running --------------------------------------------------------------------------------------------------
  /**
   * One instruction (or an interrupt), with the time it takes passing for the VIAs and the disk. The cycles before
   * the instruction's bus access pass first, so that it reads the byte under the head, the timers and the overflow
   * flag as they are in that cycle (a GCR decoder that reads the head without waiting depends on it).
   */
  step(): number {
    const c = this.cpu;
    let n: number;
    if (!c.i && (this.via1.irq || this.via2.irq)) { n = c.irq(); this.pass(n); }
    else {
      const before = CYCLES[this.fetch(c.pc)] - 1;
      this.pass(before);
      // a JAM stops the drive's CPU for good, as on the real drive; the VIAs and the disk go on
      n = c.step() || 2;
      this.pass(n - before);
    }
    this.cycles += n;
    return n;
  }

  private pass(n: number): void {
    if (n <= 0) return;
    this.via1.advance(n);
    this.via2.advance(n);
    this.turn(n);
  }

  /** Run every instruction whose bus access comes before drive cycle `target`. */
  runUntil(target: number): void {
    const c = this.cpu;
    while (this.cycles + CYCLES[this.fetch(c.pc)] - 1 < target) this.step();
  }

  // --- the head and the disk -------------------------------------------------------------------------------------
  private track(): Uint8Array | null {
    const d = this.disk;
    if (!d) return null;
    if (d.halves) return d.halves[this.halftrack] ?? null;
    return this.halftrack & 1 ? null : d.tracks[this.halftrack >> 1] ?? null;
  }

  /**
   * VIA 2 port B changed: the stepper moves the head half a track in or out, towards the phase now powered; the
   * opposite phase moves it a whole track in, as VICE has it (Pirate Slayer's boots reset the drive with UJ while the
   * head is on their track with no SYNC, phase 2: the reset's phase 0 puts it on track 3, where the DOS finds headers)
   */
  private step2(): void {
    const d = ((this.via2.outB & 3) - (this.halftrack - 2)) & 3;
    if (!d) return;
    const before = this.track()?.length ?? 0;
    this.halftrack = Math.max(2, Math.min(84, this.halftrack + (d === 1 ? 1 : d === 3 ? -1 : 2)));
    // the disk keeps turning: the head lands at the same angle on the new track
    const after = this.track()?.length ?? 0;
    if (before && after) this.bit = Math.floor((this.bit * after) / before);
  }

  /** n drive cycles of the disk turning under the head (while the motor runs) */
  private turn(n: number): void {
    const b = this.via2.outB;
    if (!(b & 0x04)) return;
    // a byte takes `per` cycles at this density: a bit is per/8 of a cycle
    const per = BYTE_CYCLES[(b >> 5) & 3];
    this.rot += n * 8;
    if (this.rot < per) return;
    const t = this.track();
    if (!this.disk?.halves) {
      // a D64's tracks are whole bytes after every SYNC: the head reads them a byte at a time
      while (this.rot >= per * 8) { this.rot -= per * 8; if (t && t.length) this.nextByte(t); else this.noByte(); }
      return;
    }
    while (this.rot >= per) { this.rot -= per; if (t && t.length) this.nextBit(t); else this.noBit(); }
  }

  /** the next byte of a D64's track passes under the head */
  private nextByte(t: Uint8Array): void {
    const v2 = this.via2;
    this.bit = ((this.bit & ~7) + 8) % (t.length * 8);
    const i = this.bit >> 3;
    if (!v2.cb2) {
      t[i] = v2.outA;
      this.bytesWritten++;
      this.sync = false;
      this.ready();
      return;
    }
    const byte = t[i];
    // SYNC: the head over at least ten 1 bits in a row; no byte is ready meanwhile
    this.sync = byte === 0xff && t[(i + t.length - 1) % t.length] === 0xff;
    if (this.sync) return;
    this.latch = byte;
    this.bytesRead++;
    this.ready();
  }

  /** no track under the head, a byte's time: no SYNC, and a 0 byte */
  private noByte(): void {
    this.sync = false; this.latch = 0;
    this.ready();
  }

  /** no track under the head (unformatted, or between the tracks of a D64): no SYNC, and a 0 byte every 8 bits */
  private noBit(): void {
    this.sync = false; this.ones = 0;
    if (++this.count < 8) return;
    this.count = 0; this.latch = 0;
    this.ready();
  }

  /** the next bit of track t passes under the head */
  private nextBit(t: Uint8Array): void {
    const v2 = this.via2;
    // a turn of the disk: on a real one the bits in a turn are rarely a multiple of 8, so where the drive frames the
    // bytes of a track without a SYNC moves on with every turn; a G64 track is whole bytes, so the head slips a bit
    // there to do the same (a copy protection's track with no SYNC is read where it lines up)
    if (++this.bit >= t.length * 8) this.bit = this.noSync(t) ? 1 : 0;
    const i = this.bit;
    if (!v2.cb2) {
      // writing: the byte in port A when the last one was done, bit by bit
      if (this.count === 0) { this.wbyte = v2.outA; this.bytesWritten++; this.ready(); }
      const m = 0x80 >> (i & 7);
      t[i >> 3] = (this.wbyte << this.count) & 0x80 ? t[i >> 3] | m : t[i >> 3] & ~m;
      this.count = (this.count + 1) & 7;
      this.sync = false; this.ones = 0;
      this.syncless.delete(t);
      return;
    }
    const v = (t[i >> 3] >> (7 - (i & 7))) & 1;
    if (v) {
      // SYNC: ten 1 bits in a row and more; meanwhile no byte is ready, and the next one starts after it
      if (++this.ones >= 10) { this.sync = true; this.count = 0; return; }
    } else this.ones = 0;
    this.sync = false;
    this.shift = ((this.shift << 1) | v) & 0xff;
    if (++this.count < 8) return;
    this.count = 0;
    this.latch = this.shift;
    this.bytesRead++;
    this.ready();
  }

  /** the track has no SYNC anywhere */
  private noSync(t: Uint8Array): boolean {
    let none = this.syncless.get(t);
    if (none === undefined) {
      none = true;
      let ones = 0;
      for (let k = 0; k < t.length * 8 + 10 && none; k++) {
        if ((t[(k >> 3) % t.length] >> (7 - (k & 7))) & 1) { if (++ones >= 10) none = false; } else ones = 0;
      }
      this.syncless.set(t, none);
    }
    return none;
  }

  /** a byte is ready: VIA 2's CA1 flag, and the CPU's overflow flag while byte ready is enabled (CA2 high) */
  private ready(): void {
    this.via2.ifr |= 0x02;
    if (this.via2.ca2) this.cpu.v = 1;
  }

  // --- state ----------------------------------------------------------------------------------------------------
  save(): DriveState {
    const c = this.cpu;
    return {
      ram: this.ram.slice(), cpu: { a: c.a, x: c.x, y: c.y, s: c.s, pc: c.pc, p: c.p },
      via1: this.via1.save(), via2: this.via2.save(), cycles: this.cycles, halftrack: this.halftrack,
    };
  }

  restore(s: DriveState): void {
    this.ram.set(s.ram);
    const c = this.cpu;
    c.a = s.cpu.a; c.x = s.cpu.x; c.y = s.cpu.y; c.s = s.cpu.s; c.pc = s.cpu.pc; c.p = s.cpu.p;
    this.via1.restore(s.via1); this.via2.restore(s.via2);
    this.cycles = s.cycles; this.halftrack = s.halftrack;
    this.lines = this.via1.outB & 0x0a;
  }
}
