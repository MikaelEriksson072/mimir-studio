/* G64 disk images: the 1541's tracks as the GCR bits a bit copier (nibtools) read off the original disk, half tracks
 * and copy-protection tracks included. Sindri's drive reads them bit for bit (drive.ts); the standard sectors on them
 * are decoded into a D64, for the directory and the files, and can be written back in place. */
import { encode, GCR, sectorsOn, type Disk } from './gcr.ts';

const SIGNATURE = 'GCR-1541';

/** the image starts with "GCR-1541" */
export const isG64 = (b: Uint8Array): boolean => b.length >= 12 && String.fromCharCode(...b.subarray(0, 8)) === SIGNATURE;

export interface G64 {
  /** the GCR bytes of each half track (2 = track 1, 3 = track 1.5, … 85); null where the image has none */
  halves: (Uint8Array | null)[];
  /** the speed zone the image gives each half track (0-3), or null when it gives one per byte */
  speeds: (number | null)[];
  /** where each half track's bytes start in the image (after their length) */
  offsets: number[];
}

/** Read a G64's tables: its tracks are views into the image. */
export function parseG64(b: Uint8Array): G64 {
  if (!isG64(b)) throw new Error('not a G64 image: it does not start with "GCR-1541"');
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const count = b[9];
  if (12 + count * 8 > b.length) throw new Error(`a broken G64 image: ${count} half tracks do not fit in ${b.length} bytes`);
  const halves: (Uint8Array | null)[] = [null, null], speeds: (number | null)[] = [null, null], offsets: number[] = [0, 0];
  for (let i = 0; i < count && i + 2 <= 85; i++) {
    const at = dv.getUint32(12 + i * 4, true), speed = dv.getUint32(12 + count * 4 + i * 4, true);
    offsets.push(at ? at + 2 : 0);
    speeds.push(speed < 4 ? speed : null);
    if (!at || at + 2 > b.length) { halves.push(null); continue; }
    const len = dv.getUint16(at, true);
    halves.push(len ? b.subarray(at + 2, Math.min(b.length, at + 2 + len)) : null);
  }
  return { halves, speeds, offsets };
}

/** bit i of a track (counted from its first byte's top bit, round and round) */
const bitOf = (t: Uint8Array, i: number): number => (t[(i >> 3) % t.length] >> (7 - (i & 7))) & 1;

/** where the SYNC marks on a track end (the bit after each run of at least ten 1 bits), in order */
export function syncEnds(t: Uint8Array): number[] {
  const n = t.length * 8, out: number[] = [];
  if (!n) return out;
  // start on a 0 bit, so that no SYNC is split at the end of the track
  let start = 0;
  while (start < n && bitOf(t, start)) start++;
  if (start === n) return out;
  let ones = 0;
  for (let k = 1; k <= n; k++) {
    const i = start + k;
    if (bitOf(t, i)) { ones++; continue; }
    if (ones >= 10) out.push(i % n);
    ones = 0;
  }
  return out.sort((a, b) => a - b);
}

/** `count` bytes framed from bit `at` (as the drive frames them after a SYNC) */
const bytesAt = (t: Uint8Array, at: number, count: number): number[] => {
  const out: number[] = [];
  for (let b = 0; b < count; b++) { let v = 0; for (let j = 0; j < 8; j++) v = (v << 1) | bitOf(t, at + b * 8 + j); out.push(v); }
  return out;
};

const DECODE = new Map(GCR.map((g, i) => [g, i]));

/** GCR bytes (5 per 4) as bytes; null for a nibble that is no GCR code */
export function decodeGcr(g: number[]): (number | null)[] {
  const out: (number | null)[] = [];
  for (let i = 0; i + 5 <= g.length; i += 5) {
    // 40 bits as two 20-bit halves (JavaScript's bit operators are 32-bit)
    const hi = (g[i] << 12) | (g[i + 1] << 4) | (g[i + 2] >> 4), lo = ((g[i + 2] & 15) << 16) | (g[i + 3] << 8) | g[i + 4];
    for (const half of [hi, lo]) {
      for (const shift of [10, 0]) {
        const a = DECODE.get((half >> (shift + 5)) & 31), b = DECODE.get((half >> shift) & 31);
        out.push(a === undefined || b === undefined ? null : (a << 4) | b);
      }
    }
  }
  return out;
}

export interface G64Sector {
  track: number;
  sector: number;
  /** the D64 error code: 1 read, 2 no header block, 3 no SYNC on the track, 4 no data block, 5 a wrong data checksum
   *  or bytes that are no GCR, 9 a wrong header checksum */
  error: number;
  /** the 256 bytes (zeros when there are none) */
  data: Uint8Array;
  /** where the data block starts on the track (its first bit after the SYNC), -1 without one */
  dataBit: number;
}

/** The standard sectors on a track of the image (by whole track 1-42), each as its first good copy says. */
export function trackSectors(t: Uint8Array | null, track: number): G64Sector[] {
  const n = sectorsOn(track), found: (G64Sector | null)[] = Array(n).fill(null);
  const ends = t ? syncEnds(t) : [];
  const bits = t ? t.length * 8 : 0;
  for (let k = 0; t && k < ends.length; k++) {
    const h = decodeGcr(bytesAt(t, ends[k], 10));
    if (h[0] !== 0x08 || h[3] !== track || h[2] == null || h[2] >= n) continue;
    const s = h[2];
    if (found[s]?.error === 1) continue;
    const headerOk = ((h[1] ?? -1) === ((h[2] ?? 0) ^ (h[3] ?? 0) ^ (h[4] ?? 0) ^ (h[5] ?? 0)));
    // the data block: the next SYNC, a few bytes after the header
    const next = ends[(k + 1) % ends.length], gap = (next - ends[k] + bits) % bits;
    let sector: G64Sector = { track, sector: s, error: 4, data: new Uint8Array(256), dataBit: -1 };
    if (ends.length > 1 && gap > 80 && gap < 80 + 60 * 8) {
      const d = decodeGcr(bytesAt(t, next, 325));
      if (d[0] === 0x07) {
        let sum = 0;
        for (let i = 1; i <= 256; i++) sum ^= d[i] ?? 0;
        const data = Uint8Array.from(d.slice(1, 257), v => v ?? 0);
        const good = d.slice(1, 258).every(v => v != null) && sum === d[257];
        sector = { track, sector: s, error: good ? (headerOk ? 1 : 9) : 5, data, dataBit: next };
      }
    }
    if (!found[s] || sector.error === 1) found[s] = sector;
  }
  return found.map((f, s) => f ?? { track, sector: s, error: ends.length ? 2 : 3, data: new Uint8Array(256), dataBit: -1 });
}

/** offsets of the tracks' sectors in a D64 of 35/40 tracks */
const d64Offset = (track: number, sector: number): number => { let n = 0; for (let t = 1; t < track; t++) n += sectorsOn(t); return n + sector; };

/**
 * The standard sectors of a G64 as a D64 with an error byte per sector (35 tracks, or 40 when tracks 36-40 hold
 * sectors), for the directory and the files. A track with no sectors (a copy protection's) reads as errors.
 */
export function g64ToD64(b: Uint8Array): Uint8Array {
  const g = parseG64(b);
  const all: G64Sector[][] = [];
  for (let t = 1; t <= 40; t++) all[t] = trackSectors(g.halves[t * 2] ?? null, t);
  const tracks = all.slice(36, 41).some(s => s.some(x => x.error === 1)) ? 40 : 35;
  const sectors = d64Offset(tracks + 1, 0);
  const out = new Uint8Array(sectors * 257);
  for (let t = 1; t <= tracks; t++) {
    for (const s of all[t]) {
      const i = d64Offset(t, s.sector);
      out.set(s.data, i * 256);
      out[sectors * 256 + i] = s.error;
    }
  }
  return out;
}

const text = (bytes: Uint8Array): string =>
  Array.from(bytes, c => (c === 0xa0 ? '' : c >= 0x20 && c < 0x7f ? String.fromCharCode(c) : '?')).join('').trimEnd();

/** A G64 as the drive's disk: its tracks and half tracks as they are, the name and ID from its BAM. */
export function g64ToDisk(b: Uint8Array): Disk {
  const g = parseG64(b);
  // the drive writes to the disk: its own copy of the tracks
  const halves = g.halves.map(h => (h ? h.slice() : null));
  const tracks: (Uint8Array | null)[] = [null];
  for (let t = 1; t <= 42; t++) tracks.push(halves[t * 2] ?? null);
  const bam = trackSectors(g.halves[36] ?? null, 18)[0];
  return { tracks, halves, name: text(bam.data.subarray(0x90, 0xa0)), id: text(bam.data.subarray(0xa2, 0xa4)), writeProtected: false };
}

/**
 * A copy of the G64 with these sectors' data written in place: each data block encoded again where it was, so the
 * rest of the track (gaps, other sectors, a copy protection's bits) stays as it was. A sector without a data block
 * on the image cannot be written.
 */
export function writeG64Sectors(b: Uint8Array, writes: { track: number; sector: number; data: Uint8Array }[]): Uint8Array {
  const out = b.slice();
  const g = parseG64(out);
  for (const w of writes) {
    const t = g.halves[w.track * 2];
    const s = t ? trackSectors(t, w.track)[w.sector] : null;
    if (!t || !s || s.dataBit < 0) throw new Error(`track ${w.track} sector ${w.sector} has no data block on the G64 to write`);
    let sum = 0;
    for (const v of w.data) sum ^= v;
    const gcr: number[] = [];
    encode(gcr, [0x07, ...w.data.subarray(0, 256), sum, 0x00, 0x00]);
    const bits = t.length * 8;
    for (let k = 0; k < gcr.length * 8; k++) {
      const i = (s.dataBit + k) % bits, v = (gcr[k >> 3] >> (7 - (k & 7))) & 1;
      const m = 0x80 >> (i & 7);
      t[i >> 3] = v ? t[i >> 3] | m : t[i >> 3] & ~m;
    }
  }
  return out;
}
