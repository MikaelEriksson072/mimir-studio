/* G64 images for the tests: a D64's tracks as Sindri lays them out (d64ToDisk), with half tracks put in or replaced,
 * and a Pirate Slayer version 2 key track (no SYNC, framed off the image's bytes by `bit` bits). Nothing of EA's own
 * code or data is in them: only the key's byte pattern, which the protection's check reads. */
import { d64ToDisk } from '@mimir/sindri';

/** A G64 of a D64's tracks, with these half tracks (2 = track 1) put in or replaced. */
export function toG64(d64: Uint8Array, halves: Record<number, Uint8Array> = {}): Uint8Array {
  const disk = d64ToDisk(d64);
  const tracks: (Uint8Array | null)[] = [];
  for (let h = 2; h < 86; h++) tracks.push(halves[h] ?? (h & 1 ? null : disk.tracks[h >> 1] ?? null));
  const n = tracks.length, head = 12 + n * 8;
  const out = new Uint8Array(head + tracks.reduce((s, t) => s + (t ? t.length + 2 : 0), 0)), dv = new DataView(out.buffer);
  out.set([...'GCR-1541'].map(c => c.charCodeAt(0)));
  out[9] = n; dv.setUint16(10, 7928, true);
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

/** A Pirate Slayer version 2 key track: no SYNC, `copies` × (D7 × 300, EB, CC AD × 512, the 12 bytes), 0x55 between,
 *  shifted by `bit` bits off the image's bytes. */
export function keyTrack(bit: number, copies = 3, length = 6666): Uint8Array {
  const sig = [0x55, 0xae, 0x9b, 0x55, 0xad, 0x55, 0xcb, 0xae, 0x6b, 0xab, 0xad, 0xaf];
  const copy = [...Array(300).fill(0xd7), 0xeb, ...Array(512).fill([0xcc, 0xad]).flat(), ...sig, 0xab, 0xad, 0xad];
  const bytes: number[] = [];
  for (let k = 0; k < copies; k++) bytes.push(...Array(150).fill(0x55), ...copy);
  while (bytes.length < length) bytes.push(0x55);
  const out = new Uint8Array(length);
  for (let i = 0; i < length * 8; i++) {
    const v = (bytes[i >> 3] >> (7 - (i & 7))) & 1, j = (i + bit) % (length * 8);
    if (v) out[j >> 3] |= 0x80 >> (j & 7);
  }
  return out;
}
