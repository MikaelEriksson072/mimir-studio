/* Para-Protect disks for the tests (c64/paraprotect.ts, spec 13.5o): tracks as its loader reads them (each sector's
 * header after a SYNC, then a SYNC and the data block, whatever its first byte) and tracks of Bangkok Knights' own
 * format (each data block right after its header with no SYNC between, sector 0's header with no SYNC before it).
 * Nothing of Paranoid's or the games' own code is in them: the boot the tests make has only the byte patterns its
 * loader stub and table are known by. */
import { sectorsOn } from '@mimir/sindri';

const GCR = [0x0a, 0x0b, 0x12, 0x13, 0x0e, 0x0f, 0x16, 0x17, 0x09, 0x19, 0x1a, 0x1b, 0x0d, 0x1d, 0x1e, 0x15];
/** the bytes a 1541 writes a turn, by speed zone (tracks 31-42, 25-30, 18-24, 1-17) */
const TRACK_BYTES = [6250, 6666, 7142, 7692];
const zone = (t: number) => (t <= 17 ? 3 : t <= 24 ? 2 : t <= 30 ? 1 : 0);

/** bytes as GCR, 4 to 5 */
function gcr(bytes: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < bytes.length; i += 4) {
    let v = 0;
    for (let k = 0; k < 4; k++) { const b = bytes[i + k] ?? 0; v = v * 1024 + ((GCR[b >> 4] << 5) | GCR[b & 15]); }
    for (let j = 4; j >= 0; j--) out.push(Math.floor(v / 2 ** (8 * j)) & 0xff);
  }
  return out;
}

const ID: [number, number] = [0x44, 0x50];
const header = (track: number, sector: number) => gcr([0x08, sector ^ track ^ ID[1] ^ ID[0], sector, track, ID[1], ID[0], 0x0f, 0x0f]);
const block = (first: number, data: Uint8Array) => gcr([first, ...data, data.reduce((a, b) => a ^ b, 0), 0, 0]);

/** n bytes made from a seed */
export const fill = (n: number, seed: number): Uint8Array => Uint8Array.from({ length: n }, (_, i) => (i * 13 + seed * 7 + 1) & 0xff);

/** A track as Para-Protect's loader reads it: every sector of the track (`data`, zeros where it has none), the data
 *  block's first byte `first(sector)` ($07 as the DOS's, or the sector's number as Bangkok Knights has it). */
export function loaderTrack(track: number, data: (Uint8Array | undefined)[], first: (sector: number) => number): Uint8Array {
  const out: number[] = [];
  for (let s = 0; s < sectorsOn(track); s++) {
    out.push(...Array(5).fill(0xff), ...header(track, s), ...Array(9).fill(0x55), ...Array(5).fill(0xff), ...block(first(s), data[s] ?? new Uint8Array(256)), ...Array(8).fill(0x55));
  }
  while (out.length < TRACK_BYTES[zone(track)]) out.push(0x55);
  return Uint8Array.from(out);
}

/** A track of Bangkok Knights' own format: each header after a SYNC with its data block (first byte $07) right after
 *  it, one byte between; sector 0's header first on the track with a single $FF before it, so no SYNC (the track
 *  ends with $55, whose last bit and the $FF are 9 one bits). */
export function ownTrack(track: number, data: (Uint8Array | undefined)[]): Uint8Array {
  const out: number[] = [];
  for (let s = 0; s < sectorsOn(track); s++) {
    out.push(...(s ? Array(5).fill(0xff) : [0xff]), ...header(track, s), 0x55, ...block(0x07, data[s] ?? new Uint8Array(256)), ...Array(6).fill(0x55));
  }
  while (out.length < TRACK_BYTES[zone(track)]) out.push(0x55);
  return Uint8Array.from(out);
}

/** A sector of a directory: link, then entries of (type, track, sector, name, blocks). */
export function directorySector(next: [number, number], entries: { type: number; track: number; sector: number; name: string; blocks: number }[]): Uint8Array {
  const b = new Uint8Array(256);
  b[0] = next[0]; b[1] = next[1];
  entries.forEach((e, k) => {
    const o = k * 32;
    b[o + 2] = e.type; b[o + 3] = e.track; b[o + 4] = e.sector;
    for (let i = 0; i < 16; i++) b[o + 5 + i] = i < e.name.length ? e.name.charCodeAt(i) : 0xa0;
    b[o + 30] = e.blocks & 0xff; b[o + 31] = e.blocks >> 8;
  });
  return b;
}

/**
 * A boot as Para-Protect's boot has its loader in memory, at `load` (clear of $0328, so no STOP vector of its own):
 * the copy of the loader stub to $02AE (ldy #$2f / lda stub,y / sta $02ae,y / dey / bpl), the stub (sei / lda
 * $02c5,x / sta $8f / lda pages,x / pha / lda track,x / pha / ldy sector,x / pla / tax / pla / jmp $00b2), the
 * tables after it (where the pages go, how many, the track, the sector of each request), and its text.
 */
export function bootPrg(load: number, requests: { dest: number; pages: number; track: number; sector: number }[], text = 'PARA-PROTECT V2 1987'): Uint8Array {
  const n = requests.length, stub = load + 0x40;
  const t = (k: number) => 0xc5 + k * n;
  const bytes = new Uint8Array(0x100);
  bytes.set([0xa0, 0x2f, 0xb9, stub & 0xff, stub >> 8, 0x99, 0xae, 0x02, 0x88, 0x10, 0xf7, 0x60], 0);
  bytes.set([0x78, 0xbd, t(0), 0x02, 0x85, 0x8f, 0xbd, t(1), 0x02, 0x48, 0xbd, t(2), 0x02, 0x48, 0xbc, t(3), 0x02, 0x68, 0xaa, 0x68, 0x4c, 0xb2, 0x00], 0x40);
  // the tables start at $02c5 in the copy: $17 bytes after the stub
  requests.forEach((q, k) => {
    bytes[0x40 + 0x17 + k] = q.dest >> 8;
    bytes[0x40 + 0x17 + n + k] = q.pages;
    bytes[0x40 + 0x17 + 2 * n + k] = q.track;
    bytes[0x40 + 0x17 + 3 * n + k] = q.sector;
  });
  bytes.set([...text].map(c => c.charCodeAt(0)), 0xc0);
  return Uint8Array.from([load & 0xff, load >> 8, ...bytes]);
}
