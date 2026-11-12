import type { Addr } from '../types';

export interface ParsedPrg { name: string; load: Addr; bytes: Uint8Array }

/** Split a .prg into its 2-byte little-endian load address and payload. */
export function parsePrg(name: string, u8: Uint8Array): ParsedPrg {
  if (u8.length < 3) throw new Error(`${name}: too short to be a PRG (needs a 2-byte load address and data)`);
  const load = u8[0] | (u8[1] << 8);
  return { name, load, bytes: u8.slice(2) };
}

/** BASIC's and the KERNAL's work area: zero page, stack, input and keyboard buffers, vectors ($0002-$03ff). */
export const SYSTEM_AREA = { start: 0x0002, end: 0x0400 } as const;

/** A program loaded over the system area (a memory dump, say) cannot be started from BASIC, with RUN or SYS. */
export const overwritesSystemArea = (load: Addr, len: number): boolean => len > 0 && load < SYSTEM_AREA.end && load + len > SYSTEM_AREA.start;

/** The screen at READY ($0400-$07e7): what is typed there (Build & Run's `sys <start>`, the drive's initialise) and
 *  READY itself are written into these bytes. */
export const READY_SCREEN = { start: 0x0400, end: 0x07e8 } as const;

/** A program loaded over the screen at READY loses the bytes typing writes there: started with `sys`, it is not the
 *  program that was loaded (a game Sindri saved, $0400-$ffff, with data in the screen). */
export const coversReadyScreen = (load: Addr, len: number): boolean => len > 0 && load < READY_SCREEN.end && load + len > READY_SCREEN.start;

/** Build & Run starts a program from the VICE monitor, loaded as it is, rather than typing `sys <start>` at READY: it
 *  overwrites BASIC's work area, or the screen typing writes on. */
export const startsFromMonitor = (load: Addr, len: number): boolean => overwritesSystemArea(load, len) || coversReadyScreen(load, len);

/** Where Build & Run puts the stub that sets $01 and jumps to a program's start: $02a7-$02ad, a part of the system
 *  area neither BASIC nor the KERNAL uses (a program started with `sys` does not load over the system area, so it is
 *  free when the stub runs). */
export const START_STUB = 0x02a7;

/** Build a .prg (load address + payload). */
export function makePrg(load: Addr, bytes: Uint8Array): Uint8Array {
  const u = new Uint8Array(bytes.length + 2);
  u[0] = load & 255; u[1] = load >> 8;
  u.set(bytes, 2);
  return u;
}
