/* A writer for Cyberload's tape formats, to test the tape reader with (c64/tap.ts): its four stages as the archive's
 * tapes have them (Tusker's, The Last Ninja's), with data of our own and a second stage's code of our own in the zero
 * page (it holds the two XOR keys where Cyberload's does, and calls the byte reader at once): nothing of Cyberload's own
 * code is on the tapes. Bits are pulses of 384 and 720 cycles (48 and 90 in TAP units), the top bit first. */
import { makeTap, readTape } from '../../src';
import { TurboWriter, withTurbo } from './tapetool-tape';

/** the pilot of $0f bytes before every sync byte */
const pilot = (w: TurboWriter, n = 8) => { for (let i = 0; i < n; i++) w.byte(0x0f); };
const xor = (bs: ArrayLike<number>) => Array.from(bs).reduce((a, v) => a ^ v, 0);

/**
 * The first stage: $f0, then a byte to add to where it stores (from $ffd5) and the bytes, each with a bit after it (1
 * store, 0 leave it on the stack and a second bit: 1 another byte to add, 0 the end), a last byte. `left` are the bytes
 * left on the stack after each part (the last two the address the RTS takes, less one). A gap of more than 255 bytes
 * between two parts is made of empty parts.
 */
export function cyberFirstStage(w: TurboWriter, parts: { load: number; bytes: ArrayLike<number> }[], left: number[]): void {
  pilot(w);
  w.byte(0xf0);
  let at = 0xffd5;
  const bit = (b: number) => w.bit(b);
  parts.forEach((p, i) => {
    let gap = (p.load - at) & 0xffff;
    while (gap > 255) { w.byte(255); w.byte(0xff); bit(0); bit(1); gap -= 255; }
    w.byte(gap);
    for (const v of Array.from(p.bytes)) { w.byte(v); bit(1); }
    at = (p.load + p.bytes.length) & 0xffff;
    w.byte(left[i] ?? 0xff); bit(0);
    bit(i < parts.length - 1 ? 1 : 0);
  });
  w.byte(0);
}

/** The second stage: $f0, where it goes and how many bytes (XOR k1), the bytes (XOR k2), a byte of lead-out. */
export function cyberSecondStage(w: TurboWriter, load: number, data: ArrayLike<number>, k1: number, k2: number): void {
  pilot(w);
  w.byte(0xf0);
  w.bytes([load & 0xff, load >> 8, data.length & 0xff, data.length >> 8].map(v => v ^ k1));
  w.bytes(Array.from(data, v => v ^ k2));
  w.byte(0);
}

/** A second stage's code in the zero page, from $0002: jsr $03ae (the byte reader in the tape buffer), then what
 *  Cyberload's has there: ldx #0, jsr $03ae, eor #k1, sta $02,x, inx, cpx #4, bcc, jsr $03ae, eor #k2. */
export const secondStageCode = (k1: number, k2: number) => [0x20, 0xae, 0x03, 0xa2, 0x00, 0x20, 0xae, 0x03, 0x49, k1, 0x95, 0x02, 0xe8, 0xe0, 0x04, 0x90, 0xf4, 0x20, 0xae, 0x03, 0x49, k2, 0x60];

/**
 * The third stage's blocks of a file: each the pilot, $cc, eight header bytes (where it goes, how many (0: 256), the byte
 * that makes their XOR and the data's 0, flags (bit 7 on the last: the loader calls `call`), a byte, the call address),
 * the bytes. `pause` gives the pulses written between blocks (the loader stops the tape); `bad` spoils a block's sum.
 */
export function cyberBlocks(w: TurboWriter, load: number, data: Uint8Array, o: { call?: number; pause?: (w: TurboWriter) => void; bad?: number } = {}): void {
  for (let i = 0, a = load; i < data.length; i += 256, a += 256) {
    const part = data.subarray(i, i + 256), last = i + 256 >= data.length;
    const head = [a & 0xff, a >> 8, part.length & 0xff, 0, last && o.call != null ? 0x84 : 0x04, 0, (o.call ?? 0) & 0xff, (o.call ?? 0) >> 8];
    head[3] = xor(head) ^ xor(part) ^ (o.bad === a ? 1 : 0);
    pilot(w);
    w.byte(0xcc);
    w.bytes(head);
    w.bytes(part);
    o.pause?.(w);
  }
}

/**
 * A file of the fourth stage, Cyberload's LOAD by name: the pilot, the sync byte, the name (padded), the load address
 * and the length, on the later version (`speed`) the word the timer is set from, the header's XOR; a byte on the later
 * one; the data 256 bytes at a time, each followed by the XOR of all since the header's.
 */
export function cyberNamedFile(w: TurboWriter, o: { name: string; load: number; data: Uint8Array; speed?: number; sync?: number; pad?: number }): void {
  pilot(w);
  w.byte(o.sync ?? 0xaa);
  const head = [...Array.from({ length: 16 }, (_, i) => (i < o.name.length ? o.name.charCodeAt(i) : (o.pad ?? 0x20))), o.load & 0xff, o.load >> 8, o.data.length & 0xff, o.data.length >> 8];
  if (o.speed != null) head.push(o.speed & 0xff, o.speed >> 8);
  head.push(xor(head));
  w.bytes(head);
  let x = 0;
  if (o.speed != null) w.byte(0);
  for (let i = 0; i < o.data.length; i += 256) {
    const part = o.data.subarray(i, i + 256);
    w.bytes(part);
    x ^= xor(part);
    w.byte(x);
    x = 0;
  }
  for (let i = 0; i < 8; i++) w.byte(0);
}

/** a pause the loader stops the tape for (a stretch of its own): 20000 cycles */
export const cyberPause = (w: TurboWriter) => { w.pulses.push(0, 0x20, 0x4e, 0); };

/**
 * fixtures/tap/cyberload-demo.tap: a KERNAL boot file "CYBER DEMO" whose tape header holds bytes standing in for
 * Cyberload's loader, then the four stages: the first (the second stage's code of our own in the zero page, the tape
 * header again), the second at $c000 (its keys $9c and $7a), a file of third-stage blocks at $e000 the loader calls
 * into, and the demo (a PRG) as the fourth stage's file "DEMO" with a header of the later kind (Tusker's).
 */
export function cyberloadDemoTape(demo: Uint8Array): Uint8Array {
  const kernal = makeTap({ files: [{ name: 'CYBER DEMO', load: 0x029f, data: Uint8Array.from({ length: 156 }, (_, i) => (i * 11 + 3) & 0xff), header: Uint8Array.from({ length: 171 }, (_, i) => (i * 13 + 5) & 0xff) }] });
  const header = readTape(kernal).files[0].header!;
  const w = new TurboWriter(48, 90);
  cyberFirstStage(w, [{ load: 0x0002, bytes: secondStageCode(0x9c, 0x7a) }, { load: 0x033c, bytes: header.subarray(0, 40) }, { load: 0x0392, bytes: [0xea, 0xea, 0x60] }], [0xff, 0x00, 0x01]);
  cyberSecondStage(w, 0xc000, Uint8Array.from({ length: 600 }, (_, i) => (i * 7) & 0xff), 0x9c, 0x7a);
  cyberPause(w);
  cyberBlocks(w, 0xe000, Uint8Array.from({ length: 600 }, (_, i) => (i * 5 + 1) & 0xff), { call: 0xe003, pause: cyberPause });
  cyberNamedFile(w, { name: 'DEMO', load: demo[0] | (demo[1] << 8), data: demo.subarray(2), speed: 340 });
  return withTurbo(kernal, w.pulses);
}
