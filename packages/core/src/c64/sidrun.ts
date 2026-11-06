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
