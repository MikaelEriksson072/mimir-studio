/* A music player run on the 6510 (Sindri's CPU): init with the song in A, then play once a frame, the way a demo's
 * interrupt calls it. Memory is a copy of the program's; the VIC, the CIAs and the SID answer as far as players ask
 * them (the raster line moves on with each read, oscillator 3 gives noise), and nothing interrupts. What the run gives:
 * whether init and every play call returned, the SID registers written and the notes started (a voice's gate bit
 * switched on), and the bytes it ran or read before writing them: the player's code and data, and where they end.
 * The analysis (analyze/music.ts) tells players from other jump tables by it, and the block's range comes from it. */
import { Cpu, type Bus } from '@mimir/sindri';
import type { Addr } from '../types';
import { h4 } from '../util/hex';

export interface PlayerRunOptions {
  init: Addr;
  play: Addr;
  /** the song init gets in A (0: the first) */
  song?: number;
  /** play calls (frames) at most */
  frames: number;
  /** play only, no init: a snapshot's player goes on from where it was */
  noInit?: boolean;
  /** stop after this many frames when no SID register was written yet (not a player) */
  quiet?: number;
  /** stop once this many frames went by without a byte used for the first time (the song has come round) */
  settle?: number;
  /** what is loaded: running into other bytes ends the run (the stack and the zero page excepted) */
  loaded?: (a: Addr) => boolean;
}

export interface PlayerRun {
  /** init returned (true with `noInit`) */
  init: boolean;
  /** play calls that returned, of `frames` */
  played: number;
  frames: number;
  /** why the run stopped before `frames` calls returned; null when they all did */
  stop: string | null;
  /** the SID registers written ($d400-$d418, mirrors folded), and the notes started */
  regs: number;
  notes: number;
  /** per address: USED_RUN when the CPU fetched it, USED_READ when it was read as data before the run wrote it */
  used: Uint8Array;
  /** the frame the last address was used for the first time (0: during init) */
  lastNew: number;
  initCycles: number;
  maxPlay: number;
}

export const USED_RUN = 1, USED_READ = 2;
/** a run plays: init and every play call returned, and it wrote the SID as music does (most registers, notes) */
export const plays = (r: PlayerRun): boolean => r.init && !r.stop && r.regs >= 8 && r.notes >= 2;

const INIT_CYCLES = 400_000;
/** one PAL frame: a play call that takes longer is not one */
const PLAY_CYCLES = 19_656;
/** where the run's calls return to: an address that is never code ($fff0 in the KERNAL's last page) */
const TRAP = 0xfff0;

export function runPlayer(mem0: Uint8Array, o: PlayerRunOptions): PlayerRun {
  const mem = mem0.slice();
  const written = new Uint8Array(0x10000), used = new Uint8Array(0x10000);
  const ctl = [0, 0, 0];
  let regMask = 0, notes = 0, sidWrites = 0, raster = 0, noise = 0x7ffff8, frame = 0, lastNew = 0;
  const io = (a: Addr) => a >= 0xd000 && a < 0xe000;
  const use = (a: Addr, k: number) => { if (!(used[a] & k)) { if (!used[a]) lastNew = frame; used[a] |= k; } };
  let ranOff: Addr | null = null;
  const bus: Bus = {
    read(a) {
      if (io(a)) {
        if (a === 0xd012) return (raster = (raster + 1) % 312) & 0xff;
        if (a === 0xd011) return (raster >> 1) & 0x80 | 0x1b;
        if ((a & 0xfc1f) === 0xd41b) {
          // oscillator 3 as noise: the SID's 23-bit LFSR
          for (let k = 0; k < 8; k++) noise = ((noise << 1) | (((noise >> 22) ^ (noise >> 17)) & 1)) & 0x7fffff;
          return (noise >> 15) & 0xff;
        }
        return 0;
      }
      if (!written[a]) use(a, USED_READ);
      return mem[a];
    },
    write(a, v) {
      if (io(a)) {
        if (a >= 0xd400 && a < 0xd800) {
          const r = a & 0x1f;
          if (r > 0x18) return;
          sidWrites++;
          regMask |= 1 << r;
          if (r === 4 || r === 11 || r === 18) { const k = (r - 4) / 7; if ((v & 1) && !(ctl[k] & 1)) notes++; ctl[k] = v; }
        }
        return;
      }
      written[a] = 1;
      mem[a] = v;
    },
    fetch(a) {
      if (o.loaded && a >= 0x200 && !o.loaded(a) && ranOff == null) ranOff = a;
      if (!written[a]) use(a, USED_RUN);
      return mem[a];
    },
  };
  const cpu = new Cpu(bus);
  const call = (at: Addr, a: number, budget: number): { ok: boolean; cycles: number; why: string } => {
    cpu.s = 0xfd; cpu.pc = at; cpu.a = a; cpu.x = 0; cpu.y = 0; cpu.i = 1; cpu.d = 0;
    mem[0x1fe] = (TRAP - 1) & 0xff; mem[0x1ff] = (TRAP - 1) >> 8;
    let c = 0;
    while (cpu.pc !== TRAP) {
      if (c >= budget) return { ok: false, cycles: c, why: `does not return in ${budget} cycles` };
      const pc = cpu.pc;
      c += cpu.step();
      if (cpu.jammed) return { ok: false, cycles: c, why: `runs into a JAM at $${h4(pc)}` };
      if (ranOff != null) return { ok: false, cycles: c, why: `runs into $${h4(ranOff)}, which is not loaded` };
      const op = cpu.lastOp;
      if (op === 0x00) return { ok: false, cycles: c, why: `runs into a BRK at $${h4(pc)}` };
      if (op === 0x40) return { ok: false, cycles: c, why: 'returns with RTI' };
    }
    return { ok: true, cycles: c, why: '' };
  };
  const out = (init: boolean, played: number, stop: string | null, initCycles: number, maxPlay: number): PlayerRun => {
    let regs = 0;
    for (let r = 0; r <= 0x18; r++) if (regMask & (1 << r)) regs++;
    return { init, played, frames: o.frames, stop, regs, notes, used, lastNew, initCycles, maxPlay };
  };
  let initCycles = 0;
  if (!o.noInit) {
    const r = call(o.init, (o.song ?? 0) & 0xff, INIT_CYCLES);
    initCycles = r.cycles;
    if (!r.ok) return out(false, 0, `init ${r.why}`, initCycles, 0);
  }
  let maxPlay = 0, played = 0;
  for (frame = 1; frame <= o.frames; frame++) {
    const r = call(o.play, 0, PLAY_CYCLES);
    maxPlay = Math.max(maxPlay, r.cycles);
    if (!r.ok) return out(true, played, `play ${r.why} (call ${frame})`, initCycles, maxPlay);
    played++;
    if (o.quiet && frame >= o.quiet && !sidWrites) return out(true, played, `play writes no SID register in ${o.quiet} calls`, initCycles, maxPlay);
    if (o.settle && frame - lastNew >= o.settle) break;
  }
  return out(true, played, null, initCycles, maxPlay);
}

/* ---- sample players (digis) ----
 * A sample player has no play routine called once a frame: init starts a CIA timer whose interrupt (CIA 2's NMI, or
 * CIA 1's IRQ) writes a sample to the SID thousands of times a second, its value read from memory (the volume at
 * $d418, a voice's pulse width, ...). The run calls init, takes the timer and the vector init left, and runs the
 * handler as the timer would call it, an interrupt at a time, frame by frame. */

export interface DigiRunOptions {
  init: Addr;
  song?: number;
  /** frames of samples at most */
  frames: number;
  /** stop once this many frames went by without a byte used for the first time (the song has come round) */
  settle?: number;
  /** $01 as init is called (the memory's own when it is loaded) */
  port?: number;
  loaded?: (a: Addr) => boolean;
  /** an init that does not return (a program's start, which sets the player up and goes on into its main loop): the
   *  player is taken as init left it after its cycles (`DigiRun.loop`) */
  loop?: boolean;
  /** an IRQ handler of the program's, run once a frame before the samples: a sequencer that starts them (Wonderland
   *  IV's raster IRQ sets the NMI's pointer, end and rate); `kernal`: called through $0314, A, X and Y on the stack */
  irq?: { handler: Addr; kernal: boolean };
}

/** the timer that plays: CIA 1 or 2 (the NMI), timer A or B, its control register as init left it */
export interface DigiTimer { cia: 1 | 2; b: boolean; ctl: number }

export interface DigiRun {
  /** init returned */
  init: boolean;
  /** init did not return (with `loop`): the player was taken as init left it */
  loop: boolean;
  timer: DigiTimer | null;
  /** with `loop`: memory as init left it, the SID registers it wrote last (-1: not written), and per address what the
   *  handler (and the IRQ) used, read before written or not (USED_RUN / USED_READ), and wrote */
  after?: Uint8Array;
  sid?: number[];
  handlerUsed?: Uint8Array;
  handlerWrote?: Uint8Array;
  /** why the run stopped (init did not return, no fast timer interrupt, the handler did not return); null: it ran */
  stop: string | null;
  /** the timer's interrupt is the NMI (CIA 2), else the IRQ (CIA 1) */
  nmi: boolean;
  /** the timer's latch (cycles - 1) and the interrupts a second (PAL) */
  latch: number;
  hz: number;
  /** where the interrupt goes: the vector init left, as $01 shows it ($0318/$0314 with the KERNAL in, else
   *  $fffa/$fffe) */
  vector: Addr;
  handler: Addr;
  /** $01 after init */
  port: number;
  /** interrupts run, those that wrote the SID, and the frames they make */
  calls: number;
  sidCalls: number;
  played: number;
  /** each SID register written by the handler: how often, and how many different values */
  regs: { reg: Addr; writes: number; values: number }[];
  /** per address: USED_RUN / USED_READ by init and the handler (as runPlayer's), and the bytes they wrote */
  used: Uint8Array;
  wrote: Uint8Array;
  /** the frame the last address was used for the first time */
  lastNew: number;
  /** the most cycles one interrupt took */
  maxCycles: number;
  /** the frame of the last interrupt that wrote the SID (samples that stop: nothing started them again) */
  lastSid: number;
  /** bytes from $0200 the handler read that were neither loaded nor written by init: what the program builds as it
   *  runs (Macho Programming's table at $0400), which the run does not have */
  unloaded: number;
}

/** a timer this fast or slower is a play routine's (a frame is 19656 cycles), not samples: at least ~490 a second */
export const DIGI_LATCH_MAX = 2000;
/** a timer faster than this leaves no time for the handler */
const DIGI_LATCH_MIN = 40;
/** the KERNAL's interrupt exits: its IRQ ($ea31), the end of it ($ea7e, $ea81: pla / tay / pla / tax / pla / rti), the
 *  end of its NMI ($febc) */
const KERNAL_EXITS = new Set([0xea31, 0xea7e, 0xea81, 0xfebc]);

/** a sample player: init returned (or, with `loop`, was taken where it was), a timer interrupt faster than a play
 *  routine's ran its handler, which wrote the SID in at least a quarter of the interrupts (Kalle Kloakk's in about
 *  half), at least 8 different values to one register (a 4-bit sample through $d418 has 16) */
export const digiPlays = (r: DigiRun): boolean =>
  (r.init || r.loop) && !r.stop && r.calls > 0 && r.sidCalls * 4 >= r.calls && r.regs.some(x => x.values >= 8) && r.unloaded <= DIGI_UNLOADED;
/** a handler that reads more bytes than this that nothing loaded or wrote plays what the program builds as it runs */
export const DIGI_UNLOADED = 32;

export function runDigi(mem0: Uint8Array, o: DigiRunOptions): DigiRun {
  const mem = mem0.slice();
  const loaded = o.loaded;
  if (o.port != null && !(loaded?.(1) ?? true)) mem[1] = o.port;
  const written = new Uint8Array(0x10000), used = new Uint8Array(0x10000);
  // (what the handler uses and writes, kept with `loop` only: the player is played from the state init left)
  const hUsed = o.loop ? new Uint8Array(0x10000) : null, hWrote = o.loop ? new Uint8Array(0x10000) : null;
  const cia = [new Uint8Array(16), new Uint8Array(16)], mask = [0, 0];
  const regWrites = new Uint32Array(0x19), regValues = Array.from({ length: 0x19 }, () => new Set<number>());
  const sidLast: number[] = Array(0x19).fill(-1);
  const foreign = new Uint8Array(0x10000);
  let unloaded = 0;
  let raster = 0, noise = 0x7ffff8, frame = 0, lastNew = 0, inside = -1, sidHere = false, counting = false, rasterIrq = false;
  const use = (a: Addr, k: number) => { if (!(used[a] & k)) { if (!used[a]) lastNew = frame; used[a] |= k; } };
  const port = () => mem[1] & 7;
  const io = (a: Addr) => a >= 0xd000 && a < 0xe000 && (port() & 3) !== 0 && (port() & 4) !== 0;
  let ranOff: Addr | null = null;
  const bus: Bus = {
    read(a) {
      if (io(a)) {
        if (a === 0xd012) return (raster = (raster + 1) % 312) & 0xff;
        if (a === 0xd011) return (raster >> 1) & 0x80 | 0x1b;
        if ((a & 0xfc1f) === 0xd41b) {
          for (let k = 0; k < 8; k++) noise = ((noise << 1) | (((noise >> 22) ^ (noise >> 17)) & 1)) & 0x7fffff;
          return (noise >> 15) & 0xff;
        }
        if (a >= 0xdc00 && a < 0xde00) {
          // the interrupt control register says the timer that interrupts ran out (and reading it clears that)
          const k = (a >> 8) & 1, r = a & 15;
          if (r === 13) { if (inside !== k) return 0; inside = -1; return 0x81; }
          return cia[k][r];
        }
        // (the raster interrupt, while the program's IRQ runs)
        if (a === 0xd019) return rasterIrq ? 0x81 : 0;
        return 0;
      }
      if (!written[a]) { use(a, USED_READ); if (counting && a >= 0x0200 && loaded && !loaded(a) && !foreign[a]) { foreign[a] = 1; unloaded++; } }
      if (hUsed && counting) hUsed[a] |= USED_READ;
      return mem[a];
    },
    write(a, v) {
      if (io(a)) {
        if (a >= 0xd400 && a < 0xd800) {
          const r = a & 0x1f;
          if (r > 0x18) return;
          sidLast[r] = v;
          if (!counting) return;
          regWrites[r]++; regValues[r].add(v); sidHere = true;
        } else if (a >= 0xdc00 && a < 0xde00) {
          const k = (a >> 8) & 1, r = a & 15;
          if (r === 13) mask[k] = v & 0x80 ? mask[k] | (v & 0x1f) : mask[k] & ~(v & 0x1f);
          else cia[k][r] = v;
        }
        return;
      }
      written[a] = 1;
      if (hWrote && counting) hWrote[a] = 1;
      mem[a] = v;
    },
    fetch(a) {
      if (loaded && a >= 0x200 && !loaded(a) && !written[a] && ranOff == null) ranOff = a;
      if (!written[a]) use(a, USED_RUN);
      if (hUsed && counting) hUsed[a] |= USED_RUN;
      return mem[a];
    },
  };
  const cpu = new Cpu(bus);
  // the ROM where $01 shows it: the run has no ROMs, so a call into them returns at once (init clearing the screen
  // with the KERNAL, say) and an interrupt that leaves through the KERNAL's exits has returned
  const rom = (pc: Addr) => ((port() & 2) && pc >= 0xe000) || ((port() & 3) === 3 && pc >= 0xa000 && pc < 0xc000);
  const run = (at: Addr, irq: 'none' | 'raw' | 'kernal-irq', budget: number): { ok: boolean; cycles: number; why: string } => {
    cpu.pc = at; cpu.i = 1; cpu.d = 0;
    if (irq === 'none') { cpu.s = 0xfd; cpu.a = (o.song ?? 0) & 0xff; cpu.x = 0; cpu.y = 0; mem[0x1fe] = (TRAP - 1) & 0xff; mem[0x1ff] = (TRAP - 1) >> 8; }
    else {
      // as the CPU takes an interrupt: the return address and the flags on the stack; through the KERNAL's IRQ entry
      // ($ff48) A, X and Y too
      cpu.s = 0xfc; mem[0x1ff] = TRAP >> 8; mem[0x1fe] = TRAP & 0xff; mem[0x1fd] = 0x20;
      if (irq === 'kernal-irq') { mem[0x1fc] = cpu.a; mem[0x1fb] = cpu.x; mem[0x1fa] = cpu.y; cpu.s = 0xf9; }
    }
    let c = 0;
    while (cpu.pc !== TRAP) {
      if (c >= budget) return { ok: false, cycles: c, why: `does not return in ${budget} cycles` };
      const pc = cpu.pc;
      if (rom(pc)) {
        if (irq !== 'none' && KERNAL_EXITS.has(pc)) return { ok: true, cycles: c, why: '' };
        if (irq !== 'none') return { ok: false, cycles: c, why: `runs into the ROM at $${h4(pc)}` };
        // a JSR into the ROM: back to the caller
        const lo = mem[0x100 | ((cpu.s + 1) & 0xff)], hi = mem[0x100 | ((cpu.s + 2) & 0xff)];
        cpu.s = (cpu.s + 2) & 0xff; cpu.pc = (((hi << 8) | lo) + 1) & 0xffff; c += 12;
        continue;
      }
      c += cpu.step();
      if (cpu.jammed) return { ok: false, cycles: c, why: `runs into a JAM at $${h4(pc)}` };
      if (ranOff != null) return { ok: false, cycles: c, why: `runs into $${h4(ranOff)}, which is not loaded` };
      const op = cpu.lastOp;
      if (op === 0x00) return { ok: false, cycles: c, why: `runs into a BRK at $${h4(pc)}` };
      if (op === 0x40 && irq === 'none') return { ok: false, cycles: c, why: 'returns with RTI' };
    }
    return { ok: true, cycles: c, why: '' };
  };
  let loop = false;
  const result = (init: boolean, stop: string | null, t: Partial<DigiRun>): DigiRun => ({
    init, loop, timer: null, stop, nmi: false, latch: 0, hz: 0, vector: 0, handler: 0, port: mem[1], calls: 0, sidCalls: 0, played: 0,
    regs: [], used, wrote: written, lastNew, maxCycles: 0, lastSid: 0, unloaded, ...t,
    ...(hUsed ? { handlerUsed: hUsed, handlerWrote: hWrote! } : {}),
  });

  const r = run(o.init, 'none', INIT_CYCLES);
  if (!r.ok) {
    if (!o.loop || !/^does not return/.test(r.why)) return result(false, `init ${r.why}`, {});
    loop = true;
  }
  // the timer: CIA 2's (the NMI) when init started it with its interrupt on, else CIA 1's; timer A, else B
  const timer = (k: number): { latch: number; t: DigiTimer } | null => {
    for (const [bit, lo, ctl] of [[1, 4, 14], [2, 6, 15]] as const) {
      if (!(mask[k] & bit) || !(cia[k][ctl] & 1)) continue;
      return { latch: cia[k][lo] | (cia[k][lo + 1] << 8), t: { cia: k ? 2 : 1, b: bit === 2, ctl: cia[k][ctl] } };
    }
    return null;
  };
  const t2 = timer(1), t1 = timer(0);
  const nmi = t2 != null && t2.latch <= DIGI_LATCH_MAX;
  const which = nmi ? t2 : t1;
  if (which == null) return result(!loop, `init ${loop ? 'loops before it starts' : 'starts'} no timer interrupt`, {});
  let latch = which.latch;
  if (latch > DIGI_LATCH_MAX || latch < DIGI_LATCH_MIN) return result(!loop, `the timer interrupt comes every ${latch + 1} cycles, not samples`, { latch });
  const kernal = (port() & 2) !== 0;
  const vector = nmi ? (kernal ? 0x0318 : 0xfffa) : (kernal ? 0x0314 : 0xfffe);
  const handler = mem[vector] | (mem[vector + 1] << 8);
  const hz = Math.round(985248 / (latch + 1));
  const base = { init: !loop, nmi, latch, hz, vector, handler, port: mem[1], timer: which.t, ...(loop ? { after: mem.slice(), sid: [...sidLast] } : {}) };
  if (kernal && handler >= 0xe000) return result(!loop, `the ${nmi ? 'NMI' : 'IRQ'} vector ${h4(vector)} goes to the KERNAL ($${h4(handler)})`, base);
  // (a sequencer in the program's IRQ can change the rate)
  const ci = nmi ? 1 : 0, lo = which.t.b ? 6 : 4;
  const latchNow = () => { const v = cia[ci][lo] | (cia[ci][lo + 1] << 8); return v >= DIGI_LATCH_MIN && v <= DIGI_LATCH_MAX ? v : latch; };

  // the handler, as often as the timer calls it: every latch + 1 cycles, PAL frames of 19656 cycles; the program's IRQ
  // (`irq`) once a frame before. The vector is read at each interrupt, as the CPU does: a handler in two halves points
  // it at the other one (Wonderland IV's NMI plays a sample's low nibble, then its high nibble), and an IRQ that
  // sets its vector goes on there
  counting = true;
  let calls = 0, sidCalls = 0, maxCycles = 0, acc = 0, played = 0, lastSid = 0;
  const irqVector = o.irq?.kernal ? 0x0314 : 0xfffe;
  let irqAt = o.irq?.handler ?? 0;
  for (frame = 1; frame <= o.frames; frame++) {
    if (o.irq) {
      rasterIrq = true;
      const was = mem[irqVector] | (mem[irqVector + 1] << 8);
      const q = run(irqAt, o.irq.kernal ? 'kernal-irq' : 'raw', PLAY_CYCLES);
      rasterIrq = false;
      if (!q.ok) return result(!loop, `the IRQ at $${h4(irqAt)} ${q.why} (frame ${frame})`, { ...base, calls, sidCalls, played, maxCycles, regs: regsOf() });
      const set = mem[irqVector] | (mem[irqVector + 1] << 8);
      if (set !== was) irqAt = set;
      latch = latchNow();
    }
    acc += PLAY_CYCLES;
    while (acc >= latch + 1) {
      acc -= latch + 1;
      sidHere = false; inside = nmi ? 1 : 0;
      const now = mem[vector] | (mem[vector + 1] << 8);
      const h = run(now, nmi || !kernal ? 'raw' : 'kernal-irq', PLAY_CYCLES);
      inside = -1;
      maxCycles = Math.max(maxCycles, h.cycles);
      if (!h.ok) return result(!loop, `the ${nmi ? 'NMI' : 'IRQ'} at $${h4(now)} ${h.why} (interrupt ${calls + 1})`, { ...base, calls, sidCalls, played, maxCycles, regs: regsOf() });
      calls++;
      if (sidHere) { sidCalls++; lastSid = frame; }
    }
    played = frame;
    if (o.settle && frame - lastNew >= o.settle) break;
  }
  function regsOf() {
    const out: DigiRun['regs'] = [];
    for (let k = 0; k <= 0x18; k++) if (regWrites[k]) out.push({ reg: 0xd400 + k, writes: regWrites[k], values: regValues[k].size });
    return out;
  }
  return result(!loop, null, { ...base, calls, sidCalls, played, lastSid, maxCycles, regs: regsOf() });
}
