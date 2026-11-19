/* A writer for disks of DLoC's loader, to test the reader with (c64/dloc-disk.ts): files packed for $fc00 (where they
 * unpack to, where they start, then a ZX0 stream in its first format, written here by a simple greedy packer, not Six's
 * own), and a boot laid out as Six's self-extracting packer lays it out (its first code's copy loops and pointers, then
 * the stream), but with none of the code that unpacks it: only the reader's static unpacking can take it apart. Nothing
 * of the loader's own code is on the disks. */
import { makeD64, type D64FileType } from '../../src';

/** ZX0's first format: bits from the top of a byte, put in the stream when the first is written. */
export class Zx0 {
  out: number[] = [];
  private mask = 0;
  private at = 0;
  bit(v: number) {
    if (!this.mask) { this.mask = 0x80; this.at = this.out.length; this.out.push(0); }
    if (v) this.out[this.at] |= this.mask;
    this.mask >>= 1;
  }
  /** interlaced Elias gamma: a 0 before each bit after the first, a 1 at the end; `skip`: without the first 0 */
  elias(value: number, skip = false) {
    const bits = 31 - Math.clz32(value);
    for (let i = bits - 1; i >= 0; i--) { if (!skip) this.bit(0); skip = false; this.bit((value >> i) & 1); }
    if (!skip) this.bit(1);
  }
  literal(bytes: number[], first = false) { if (!first) this.bit(0); this.elias(bytes.length); this.out.push(...bytes); }
  rep(len: number) { this.bit(0); this.elias(len); }
  /** a new offset: its high part + 1, then a byte of its low 7 bits (inverted) and whether the length is 2 */
  match(len: number, offset: number) {
    this.bit(1); this.elias(((offset - 1) >> 7) + 1);
    this.out.push(((~(offset - 1) & 0x7f) << 1) | (len === 2 ? 1 : 0));
    if (len > 2) this.elias(len - 1, true);
  }
  end() { this.bit(1); this.elias(256); }
}

type Step = { lit: number[] } | { len: number; off: number };

/** the longest copy from up to `far` bytes back where there is one of 3 bytes or more, else a literal */
function parse(data: number[], far: number): Step[] {
  const steps: Step[] = [];
  let lit: number[] = [];
  for (let i = 0; i < data.length;) {
    let len = 0, off = 0;
    for (let o = 1; i > 0 && o <= Math.min(i, far); o++) {
      let n = 0;
      while (i + n < data.length && data[i + n] === data[i + n - o]) n++;
      if (n > len) { len = n; off = o; }
    }
    if (len < 3) { lit.push(data[i++]); continue; }
    if (lit.length) { steps.push({ lit }); lit = []; }
    steps.push({ len, off });
    i += len;
  }
  if (lit.length) steps.push({ lit });
  return steps;
}

/** `data` as a ZX0 stream with its end; matches from up to `far` bytes back (the same offset again after a literal
 *  is a repeat) */
export function zx0(data: number[], far = 4096): number[] {
  const w = new Zx0();
  let prev: 'lit' | 'copy' | null = null, last = 1;
  for (const s of parse(data, far)) {
    if ('lit' in s) { w.literal(s.lit, prev === null); prev = 'lit'; continue; }
    if (prev === 'lit' && s.off === last) w.rep(s.len); else w.match(s.len, s.off);
    last = s.off; prev = 'copy';
  }
  w.end();
  return w.out;
}

/** A file for $fc00: where it unpacks to, where it starts, the stream. */
export const dlocFile = (data: number[], start: number, run: number, far?: number): number[] => [start & 0xff, start >> 8, run & 0xff, run >> 8, ...zx0(data, far)];

/** The BASIC line of Six's programs: 2026 SYS start (with a space after SYS), at $0801. */
export const sysLine = (start: number): number[] => {
  const text = [...` ${start}`].map(c => c.charCodeAt(0)), end = 0x0801 + 5 + text.length + 1;
  return [end & 0xff, end >> 8, 0xea, 0x07, 0x9e, ...text, 0, 0, 0];
};

/** A boot as Six's packer lays it out: `6 SYS2061`, the code that copies its unpacking code to $0100 and $0180 (here
 *  only the end of it: lda #$37 / sta $01 / cli / jmp run), moves the stream's pages from $0900 to `to` and jumps to
 *  $0100, then the stream of `image` (what it unpacks to $0801) at $0900. */
export function sfxBoot(image: number[], run: number, to = 0xe000): number[] {
  const stream = zx0(image), pages = Math.ceil(stream.length / 256);
  if (to + pages * 256 > 0x10000) throw new Error('the stream does not fit');
  const head = [0x0b, 0x08, 0x06, 0x00, 0x9e, 0x32, 0x30, 0x36, 0x31, 0x00, 0x00, 0x00];
  const code = [
    0xa2, 0xff, 0x9a, 0x78, 0xa9, 0x30, 0x85, 0x01,
    0xa2, 0x00, 0xbd, 0x58, 0x08, 0x9d, 0x00, 0x01, 0xe8, 0xe0, 0x08, 0xd0, 0xf5,
    0xa2, 0x00, 0xbd, 0x60, 0x08, 0x9d, 0x80, 0x01, 0xe8, 0xe0, 0x08, 0xd0, 0xf5,
    0xa2, pages & 0xff, 0xa0, 0x00, 0xb9, 0x00, 0x09, 0x99, to & 0xff, to >> 8, 0xc8, 0xd0, 0xf7, 0xee, 0x35, 0x08, 0xee, 0x38, 0x08, 0xca, 0xd0, 0xee,
    0xa9, to & 0xff, 0x85, 0xf8, 0xa9, to >> 8, 0x85, 0xf9, 0xa9, 0x01, 0x85, 0xfa, 0xa9, 0x08, 0x85, 0xfb, 0x4c, 0x00, 0x01,
  ];
  const stub = [0xa9, 0x37, 0x85, 0x01, 0x58, 0x4c, run & 0xff, run >> 8, 0, 0, 0, 0, 0, 0, 0, 0];
  const body = [...head, ...code, ...stub];
  return [0x01, 0x08, ...body, ...new Array(0x0900 - 0x0801 - body.length).fill(0), ...stream];
}

/** `lda #length / ldx #<name / ldy #>name / jmp $fc00` (or another of the loader's routines) for a name at `at` */
export const loadCall = (name: string, at: number, to = 0xfc00, jmp = true): number[] => [0xa9, name.length, 0xa2, at & 0xff, 0xa0, at >> 8, jmp ? 0x4c : 0x20, to & 0xff, to >> 8];

export const petscii = (s: string): number[] => [...s].map(c => c.charCodeAt(0));

export interface FakeDlocFile { name: string; data: number[]; type?: D64FileType }

/** A 35-track disk with these files in its directory, one after another from track 1. */
export function makeDlocDisk(files: FakeDlocFile[], name = 'DLOC DEMO', id = '26'): Uint8Array {
  return makeD64({ name, id, files: files.map(f => ({ name: f.name, type: f.type, data: Uint8Array.from(f.data) })) });
}
