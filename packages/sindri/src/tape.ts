/* The datasette: a TAP image's pulses reach CIA1's FLAG line while the motor runs (the 6510's port bit 5 low), with
 * PLAY held down (port bit 4 reads 0). A program's own tape loader reads them as it would on a C64.
 *
 * The KERNAL's own format is also read here, straight from the pulses, for the KERNAL's LOAD from the tape: Sindri does
 * LOAD's work (the header into the tape buffer at $033c, the data where it goes, the tape wound to after the file), as
 * the KERNAL's routines would take minutes of C64 time for it. A TAP: "C64-TAPE-RAW", the version, the length; then a
 * byte per pulse in units of 8 cycles, 0 for a longer one (version 1: its cycles in the next 3 bytes; version 2 half
 * waves, two to a pulse). A KERNAL block: a leader of short pulses, each byte a long and a medium pulse and 9 bit pairs
 * (short + medium a 0, medium + short a 1, from the lowest bit, then odd parity), long + short at its end; the sync
 * bytes $89 … $81 (the repeat: $09 … $01), the bytes, their XOR. A file is a 192-byte header block (type, start, end,
 * name, the rest of the tape buffer) and a data block, each written twice. */

/** Each pulse's length in cycles. */
export function tapPulses(tap: Uint8Array): Uint32Array {
  const magic = 'C64-TAPE-RAW';
  for (let i = 0; i < magic.length; i++) if (tap[i] !== magic.charCodeAt(i)) throw new Error('not a .tap tape image: it does not start with C64-TAPE-RAW');
  const version = tap[12];
  const declared = (tap[16] | (tap[17] << 8) | (tap[18] << 16) | (tap[19] << 24)) >>> 0;
  const end = declared > 0 && 20 + declared <= tap.length ? 20 + declared : tap.length;
  const out: number[] = [];
  let half = -1;
  for (let i = 20; i < end; i++) {
    let c = tap[i];
    if (c === 0) {
      if (version === 0) c = 20000;
      else { c = (tap[i + 1] | (tap[i + 2] << 8) | (tap[i + 3] << 16)) >>> 0; i += 3; }
    } else c *= 8;
    if (version === 2) { if (half < 0) { half = c; continue; } c += half; half = -1; }
    out.push(c);
  }
  return Uint32Array.from(out);
}

export class Datasette {
  readonly pulses: Uint32Array;
  /** the next pulse, and the cycles left until its edge */
  pos = 0;
  private left: number;
  /** the motor runs (the C64 drives port bit 5 low) */
  motor = false;
  /** edges that reached the FLAG line so far: the program loads while this grows */
  edges = 0;

  constructor(pulses: Uint32Array) {
    this.pulses = pulses;
    this.left = pulses[0] ?? 0;
  }

  /** Wind the tape to pulse `pos`. */
  seek(pos: number): void {
    this.pos = Math.max(0, Math.min(pos, this.pulses.length));
    this.left = this.pulses[this.pos] ?? 0;
  }

  get atEnd(): boolean { return this.pos >= this.pulses.length; }

  /** Let n cycles pass with the motor on; returns how many pulses ended (each an edge on the FLAG line). */
  advance(n: number): number {
    let e = 0;
    while (this.pos < this.pulses.length) {
      if (n < this.left) { this.left -= n; break; }
      n -= this.left;
      e++;
      this.pos++;
      this.left = this.pulses[this.pos] ?? 0;
    }
    this.edges += e;
    return e;
  }
}

/** A file in the KERNAL's format: its header (the tape buffer's 192 bytes), its data, and its first and past-last pulse. */
export interface TapeFile {
  header: Uint8Array;
  data: Uint8Array;
  /** the header's type (1 BASIC, relocatable; 3 a program; 4 SEQ; 5 the end of the tape), start and end */
  type: number;
  start: number;
  end: number;
  at: number;
  to: number;
}

interface Block { at: number; to: number; bytes: number[]; bad: boolean }

/** The KERNAL blocks on the tape, each after a leader of short pulses. */
function blocks(c: Uint32Array): Block[] {
  const out: Block[] = [];
  let i = 0;
  while (i < c.length) {
    if (c[i] < 280 || c[i] > 500) { i++; continue; }
    let j = i, sum = 0;
    while (j < c.length && Math.abs(c[j] - c[i]) < c[i] * 0.2) { sum += c[j]; j++; }
    if (j - i < 40) { i = Math.max(i + 1, j); continue; }
    const b = block(c, j, sum / (j - i));
    if (!b) { i = j + 1; continue; }
    b.at = i;
    out.push(b);
    i = b.to;
  }
  return out;
}

function block(c: Uint32Array, at: number, s: number): Block | null {
  let S = s, M = s * 1.375, L = s * 1.79;
  const kind = (k: number): number => {
    const v = c[k];
    if (v === undefined) return -1;
    if (v < (S + M) / 2) return v < S * 0.6 ? -1 : 0;
    if (v < (M + L) / 2) return 1;
    return v < L * 1.4 ? 2 : -1;
  };
  const marker = (k: number) => kind(k) === 2 && kind(k + 1) === 1;
  const end = (k: number) => kind(k) === 2 && kind(k + 1) === 0;
  if (!marker(at)) return null;
  const bytes: number[] = [];
  let k = at, bad = false;
  for (;;) {
    let v = 0, ones = 0;
    for (let b = 0; b < 9; b++) {
      const x = kind(k + 2 + 2 * b), y = kind(k + 3 + 2 * b);
      const bit = x === 1 && y === 0 ? 1 : 0;
      if (!(x === 0 && y === 1) && !(x === 1 && y === 0)) bad = true;
      else { S = S * 0.95 + c[k + 2 + 2 * b + bit] * 0.05; M = M * 0.95 + c[k + 3 + 2 * b - bit] * 0.05; }
      if (b < 8) { v |= bit << b; ones += bit; } else if (((ones + bit) & 1) === 0) bad = true;
    }
    bytes.push(v);
    L = L * 0.95 + c[k] * 0.05;
    k += 20;
    if (marker(k)) continue;
    if (end(k)) { k += 2; break; }
    const near = [-1, 1, -2, 2].map(d => k + d).find(x => marker(x) || end(x));
    if (near === undefined) break;
    k = near;
    if (end(k)) { k += 2; break; }
  }
  return bytes.length >= 11 ? { at, to: k, bytes, bad } : null;
}

/** The KERNAL files on the tape, in order: a header and its data, the copy read best. */
export function tapeFiles(pulses: Uint32Array): TapeFile[] {
  const read = blocks(pulses).map(b => {
    let first = 0, rep = 0;
    for (let i = 0; i < 9; i++) { if (b.bytes[i] === 0x89 - i) first++; if (b.bytes[i] === 0x09 - i) rep++; }
    if (Math.max(first, rep) < 6) return null;
    const data = b.bytes.slice(9, -1);
    const ok = !b.bad && data.reduce((a, v) => a ^ v, 0) === b.bytes[b.bytes.length - 1];
    return { copy: first >= rep ? 1 : 2, data, ok, b };
  });
  const best = (rs: NonNullable<(typeof read)[number]>[]) => Uint8Array.from((rs.find(r => r.ok) ?? rs[0]).data);
  const out: TapeFile[] = [];
  for (let i = 0; i < read.length; i++) {
    const r = read[i];
    if (!r || r.data.length !== 192 || ![1, 3, 4, 5].includes(r.data[0])) continue;
    const hs = [r];
    if (r.copy === 1 && read[i + 1]?.copy === 2 && read[i + 1]!.data.length === 192) hs.push(read[++i]!);
    const header = best(hs), start = header[1] | (header[2] << 8), end = header[3] | (header[4] << 8);
    let data = new Uint8Array(0), to = hs[hs.length - 1].b.to;
    if (header[0] === 1 || header[0] === 3) {
      const ds = [];
      const d = read[i + 1];
      if (d && (d.data.length !== 192 || ((end - start) & 0xffff) === 192)) {
        ds.push(d); i++;
        if (d.copy === 1 && read[i + 1]?.copy === 2 && read[i + 1]!.data.length === d.data.length) ds.push(read[++i]!);
        data = best(ds);
        to = ds[ds.length - 1].b.to;
      }
    }
    out.push({ header, data, type: header[0], start, end, at: hs[0].b.at, to });
  }
  return out;
}

/** The name in a header, as LOAD compares it: the bytes up to the name's length. */
export function tapeNameMatches(header: Uint8Array, name: Uint8Array): boolean {
  for (let i = 0; i < name.length && i < 16; i++) if (header[5 + i] !== name[i]) return false;
  return true;
}
