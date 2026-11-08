/* VICE snapshots (.vsf): the C64 a snapshot holds, as Sindri's machine state, so that a run can go on from it
 * (UnpackOptions.resume). A snapshot taken in a cracked game's intro or trainer menu still holds the game packed,
 * behind the menu; going on from it, with the keys Sindri presses when the program waits, unpacks it.
 *
 * The modules as x64sc writes them (VICE 3.x, its source's snapshot writers):
 *   C64MEM    port data, port direction, EXROM, GAME, then the 64 KB of RAM
 *   MAINCPU   the cycle counter (8 bytes from snapshot format 2, 4 before), A, X, Y, SP, PC (word), status
 *   CIA1/2    (2.x) PRA, PRB, DDRA, DDRB, timer A and B (words, as they count now), TOD tenths, seconds, minutes,
 *             hours, SDR, the interrupt mask, CRA, CRB, the latches A and B (words), the interrupt flags
 *   VIC-II    (x64sc, 1.3; VIC-IISC from 1.4) the model, the 64 registers, the raster cycle (dword), the cycle flags,
 *             the raster line (dword), start of frame, the interrupt flags, the raster compare line (dword), ...,
 *             and the colour RAM (1 KB) 761 bytes in
 * Not read: the 1541 (a snapshot taken while a program loads from disk needs the drive as it was), the SID. */
import { Cia, type MachineState } from './c64.ts';

const MAGIC = 'VICE Snapshot File\x1a';
const VERSION = 'VICE Version\x1a';
const COLOUR_RAM = 761;

interface Module { name: string; major: number; minor: number; at: number; size: number }

const text = (b: Uint8Array, at: number, n: number) => String.fromCharCode(...b.subarray(at, at + n));
const word = (b: Uint8Array, at: number) => b[at] | (b[at + 1] << 8);
const dword = (b: Uint8Array, at: number) => (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0;

export const isVsf = (b: Uint8Array): boolean => b.length >= MAGIC.length && text(b, 0, MAGIC.length) === MAGIC;

/** A C64 snapshot's machine: what Sindri goes on from, and where the CPU was. Throws when it is not one Sindri reads. */
export function vsfMachine(b: Uint8Array): MachineState {
  if (!isVsf(b)) throw new Error('not a VICE snapshot');
  const format = b[19];
  const machine = text(b, 21, 16).replace(/\0.*$/s, '');
  if (!/^C64/.test(machine)) throw new Error(`a snapshot of a ${machine || 'machine Sindri does not know'}, not a C64`);
  let p = 37;
  if (text(b, p, VERSION.length) === VERSION) p += VERSION.length + 8;
  const modules: Module[] = [];
  while (p + 22 <= b.length) {
    const size = dword(b, p + 18);
    if (size < 22 || p + size > b.length) throw new Error('the snapshot is damaged');
    modules.push({ name: text(b, p, 16).replace(/\0.*$/s, ''), major: b[p + 16], minor: b[p + 17], at: p + 22, size: size - 22 });
    p += size;
  }
  const mod = (name: string) => modules.find(m => m.name === name);
  const mem = mod('C64MEM'), cpu = mod('MAINCPU'), vic = mod('VIC-IISC') ?? mod('VIC-II');
  if (!mem || mem.size < 4 + 0x10000) throw new Error('the snapshot has no C64 memory');
  const clk = format >= 2 ? 8 : 4;
  if (!cpu || cpu.size < clk + 7) throw new Error('the snapshot has no CPU registers');
  if (!vic || vic.major !== 1 || vic.size < COLOUR_RAM + 0x400) throw new Error('the snapshot has no VIC-II Sindri can read');
  const cia = (name: string): Cia => {
    const c = new Cia(), m = mod(name);
    if (!m || m.major !== 2 || m.size < 21) throw new Error(`the snapshot has no ${name} Sindri can read`);
    const o = m.at;
    c.pra = b[o]; c.prb = b[o + 1]; c.ddra = b[o + 2]; c.ddrb = b[o + 3];
    c.ta = word(b, o + 4); c.tb = word(b, o + 6);
    c.tod.set(b.subarray(o + 8, o + 12));
    c.sdr = b[o + 12]; c.mask = b[o + 13] & 0x1f; c.cra = b[o + 14]; c.crb = b[o + 15];
    c.tal = word(b, o + 16); c.tbl = word(b, o + 18); c.icr = b[o + 20] & 0x1f;
    return c;
  };
  const c = cpu.at + clk, v = vic.at;
  return {
    ram: b.slice(mem.at + 4, mem.at + 4 + 0x10000),
    color: Uint8Array.from(b.subarray(v + COLOUR_RAM, v + COLOUR_RAM + 0x400), x => x & 0x0f),
    port: b[mem.at], ddr: b[mem.at + 1],
    cpu: { a: b[c], x: b[c + 1], y: b[c + 2], s: b[c + 3], pc: word(b, c + 4), p: b[c + 6] },
    vic: { regs: b.slice(v + 1, v + 0x41), lineCycle: dword(b, v + 65), line: dword(b, v + 73), flags: b[v + 78] & 0x0f, compare: dword(b, v + 79), bad: false },
    cia: [cia('CIA1'), cia('CIA2')],
    cycles: 0,
  };
}
