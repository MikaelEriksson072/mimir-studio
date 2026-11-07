/* G64 images for the tests: a D64's tracks as d64ToDisk lays them out, with half tracks put in or replaced, and a
 * Pirate Slayer version 2 key track (no SYNC, framed off the image's bytes by any number of bits). */
import { d64ToDisk } from '../src/gcr.ts';

/** A G64 of a D64's tracks (as d64ToDisk lays them out), with these half tracks put in or replaced. */
export function makeG64(d64: Uint8Array, halves: Record<number, Uint8Array> = {}): Uint8Array {
  const disk = d64ToDisk(d64);
  const tracks: (Uint8Array | null)[] = [];
  for (let h = 2; h < 86; h++) tracks.push(halves[h] ?? (h & 1 ? null : disk.tracks[h >> 1] ?? null));
  const n = tracks.length, head = 12 + n * 8;
  const size = head + tracks.reduce((s, t) => s + (t ? t.length + 2 : 0), 0);
  const out = new Uint8Array(size), dv = new DataView(out.buffer);
  out.set([...'GCR-1541'].map(c => c.charCodeAt(0)));
  out[8] = 0; out[9] = n; dv.setUint16(10, 7928, true);
  let at = head;
  tracks.forEach((t, i) => {
    if (!t) return;
    dv.setUint32(12 + i * 4, at, true);
    dv.setUint32(12 + n * 4 + i * 4, 3, true);
    dv.setUint16(at, t.length, true);
    out.set(t, at + 2);
    at += t.length + 2;
  });
  return out;
}

/** bytes laid on a track shifted by `bit` bits (0-7): the image's bytes no longer line up with them */
export function shifted(bytes: number[], bit: number): Uint8Array {
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length * 8; i++) {
    const v = (bytes[Math.floor(i / 8)] >> (7 - (i % 8))) & 1, j = (i + bit) % (bytes.length * 8);
    if (v) out[j >> 3] |= 0x80 >> (j & 7);
  }
  return out;
}

/** A Pirate Slayer version 2 key track: no SYNC, three copies of D7 … D7, EB, CC AD × 512, the 12 bytes; 0x55 between */
export function keyTrack(bit: number, length = 6666): Uint8Array {
  const sig = [0x55, 0xae, 0x9b, 0x55, 0xad, 0x55, 0xcb, 0xae, 0x6b, 0xab, 0xad, 0xaf];
  const copy = [...Array(300).fill(0xd7), 0xeb, ...Array(512).fill([0xcc, 0xad]).flat(), ...sig, 0xab, 0xad, 0xad];
  const bytes: number[] = [];
  while (bytes.length + copy.length + 200 < length) bytes.push(...Array(200).fill(0x55), ...copy);
  while (bytes.length < length) bytes.push(0x55);
  return shifted(bytes, bit);
}

