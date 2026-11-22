/* The I/O a program starts in. A PRG holds memory, not what the VIC-II, the CIAs and the SID were set to before the
 * program started: Elite's loader turns the CIAs' interrupts off and picks VIC bank 1, and the game's own init, which
 * its decoder calls, sets bitmap mode and the raster interrupt before the game starts at $886f. Started from a C64 at
 * the READY prompt with only its memory, the game looked at bank 0 and the KERNAL's timer interrupt ran on into the
 * game's raster handler. Here: those registers when a layer starts, against what they hold at READY, as the steps
 * that take a C64 at READY there (StartIo), which Build & Run's start code and a run of Sindri started at an address
 * carry out before the program's first instruction.
 *
 * What is set: the VIC's registers (not its interrupt flags and collisions), each CIA's interrupt mask, timer latches
 * and control (loaded anew, running or not as the program had them), CIA 2's ports and both CIAs' port directions
 * (not CIA 1's port bits: a program sets the keyboard column it reads itself), and the SID's filter and volume (not
 * its voices: the program's music sets them), and the colour RAM when it is not as READY leaves it (Elite's init colours
 * the dashboard: started with READY's light blue, the frame's top line, shown in the dashboard's mode, came out light
 * blue). Not: the TOD clocks, the timers' counts. */
import type { C64 } from './c64.ts';

/** what the I/O registers hold (as written; the VIC's raster compare as its 9 bits) */
export interface IoState {
  vic: Uint8Array;
  compare: number;
  cia: { pra: number; prb: number; ddra: number; ddrb: number; tal: number; tbl: number; cra: number; crb: number; mask: number }[];
  /** $d415-$d418 */
  sid: Uint8Array;
  /** the colour RAM's 1000 colours ($d800-$dbe7, the low four bits) */
  color: Uint8Array;
}

/** write `value` to `at`, or read `at` (value null) to acknowledge an interrupt that is waiting */
export interface IoStep { at: number; value: number | null }

/**
 * How a program starts besides its memory and $01: the I/O steps from the READY prompt, whether interrupts are on (the
 * I flag clear), and the colour RAM when it is not READY's (1000 hex digits, a colour each, from $d800)
 */
export interface StartIo { steps: IoStep[]; interrupts: boolean; color?: string }

export function ioState(m: C64): IoState {
  return {
    vic: m.vic.regs.slice(0, 0x2f), compare: m.vic.compare,
    cia: [m.cia1, m.cia2].map(c => ({ pra: c.pra, prb: c.prb, ddra: c.ddra, ddrb: c.ddrb, tal: c.tal, tbl: c.tbl, cra: c.cra, crb: c.crb, mask: c.mask })),
    sid: m.sidRegs.slice(0x15, 0x19),
    color: m.color.slice(0, 1000).map(c => c & 0x0f),
  };
}

/** The start's I/O (`now`) from the READY prompt (`ready`), or null when it is as at READY. */
export function startIo(now: IoState, ready: IoState, interrupts: boolean): StartIo | null {
  const steps = ioSteps(now, ready);
  const color = now.color.some((c, i) => c !== ready.color[i]) ? [...now.color].map(c => c.toString(16)).join('') : null;
  if (!steps.length && color == null) return null;
  return { steps, interrupts, ...(color != null ? { color } : {}) };
}

/** the VIC registers set apart (raster compare, interrupt mask) or not at all (interrupt flags, collisions) */
const VIC_APART = new Set([0x11, 0x12, 0x19, 0x1a, 0x1e, 0x1f]);

/**
 * The steps that take a C64 at the READY prompt (`ready`) to `now`, in an order a start routine can run them with
 * interrupts off: first the CIA interrupts that `now` does not have are turned off, then the registers are written,
 * then what is waiting is acknowledged (a read of the CIA's ICR, $0f to $d019), and last the interrupts `now` has are
 * turned on (CIA 2's is the NMI, which SEI does not hold off). Empty when nothing differs.
 */
export function ioSteps(now: IoState, ready: IoState): IoStep[] {
  const first: IoStep[] = [], mid: IoStep[] = [], acks: IoStep[] = [], last: IoStep[] = [];
  now.cia.forEach((c, i) => {
    const r = ready.cia[i], base = i ? 0xdd00 : 0xdc00;
    if (c.mask !== r.mask) {
      first.push({ at: base + 0x0d, value: 0x7f });
      acks.push({ at: base + 0x0d, value: null });
      if (c.mask) last.push({ at: base + 0x0d, value: 0x80 | c.mask });
    }
    const ports: ['ddra' | 'pra' | 'ddrb' | 'prb', number][] = i ? [['ddra', 2], ['pra', 0], ['ddrb', 3], ['prb', 1]] : [['ddra', 2], ['ddrb', 3]];
    for (const [k, off] of ports) if (c[k] !== r[k]) mid.push({ at: base + off, value: c[k] });
    if (c.tal !== r.tal) mid.push({ at: base + 4, value: c.tal & 0xff }, { at: base + 5, value: c.tal >> 8 });
    if (c.tbl !== r.tbl) mid.push({ at: base + 6, value: c.tbl & 0xff }, { at: base + 7, value: c.tbl >> 8 });
    // (force load: the timer counts from its latch, as the program's started from it)
    if (c.tal !== r.tal || c.cra !== r.cra) mid.push({ at: base + 0x0e, value: c.cra | 0x10 });
    if (c.tbl !== r.tbl || c.crb !== r.crb) mid.push({ at: base + 0x0f, value: c.crb | 0x10 });
  });
  for (let r = 0; r < 0x2f; r++) if (!VIC_APART.has(r) && now.vic[r] !== ready.vic[r]) mid.push({ at: 0xd000 + r, value: now.vic[r] });
  // $d011's top bit is the raster compare's ninth
  if (now.vic[0x11] !== ready.vic[0x11] || (now.compare & 0x100) !== (ready.compare & 0x100)) mid.push({ at: 0xd011, value: (now.vic[0x11] & 0x7f) | ((now.compare >> 1) & 0x80) });
  if ((now.compare & 0xff) !== (ready.compare & 0xff)) mid.push({ at: 0xd012, value: now.compare & 0xff });
  for (let r = 0; r < 4; r++) if (now.sid[r] !== ready.sid[r]) mid.push({ at: 0xd415 + r, value: now.sid[r] });
  if (now.vic[0x1a] !== ready.vic[0x1a]) {
    acks.push({ at: 0xd019, value: 0x0f });
    last.push({ at: 0xd01a, value: now.vic[0x1a] });
  }
  if (!first.length && !mid.length && !last.length) return [];
  return [...first, ...mid, ...acks, ...last];
}

/** Carry a start's I/O out on a C64 (with the I/O in view: $01 as at READY): the colour RAM, then the steps. */
export function applyIo(m: C64, io: StartIo): void {
  if (io.color) for (let i = 0; i < 1000; i++) m.color[i] = parseInt(io.color[i], 16) || 0;
  for (const s of io.steps) if (s.value == null) m.read(s.at); else m.write(s.at, s.value);
}
