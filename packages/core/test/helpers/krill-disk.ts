/* A writer for disks of Krill's loader, to test the reader with (c64/krill-disk.ts): files packed the way the loader's
 * ZX0 unpacker reads them (with a simple greedy packer, not the loader's own tools), in a directory with the names as
 * PETSCII bytes, dirart lines without a file and the block counts a directory shows. Nothing of the loader's own code
 * is on the disks. */
import { makeD64, sectorsOnTrack, type D64FileType } from '../../src';

/** The loader's ZX0 writer: bits from the bottom of a byte, put in the stream when the first is written. */
export class KrillZx0 {
  out: number[] = [];
  private mask = 0;
  private at = 0;
  bit(v: number) {
    if (!this.mask || this.mask > 0x80) { this.mask = 1; this.at = this.out.length; this.out.push(0); }
    if (v) this.out[this.at] |= this.mask;
    this.mask <<= 1;
  }
  /** interlaced Elias gamma; from 256 on the 8 low bits first; `skip`: without the first 0 (and the 1 of a 1) */
  elias(value: number, skip = false) {
    const bits = 31 - Math.clz32(value);
    let i = 1 << bits;
    if (bits >= 8) { value &= ~i; value = (value >> 8) | ((value & 0xff) << (bits - 8)); }
    while ((i >>= 1) > 0) { if (!skip) this.bit(0); skip = false; this.bit(value & i ? 1 : 0); }
    if (!skip) this.bit(1);
  }
  literal(bytes: number[], first = false) { if (!first) this.bit(0); this.elias(bytes.length); this.out.push(...bytes); }
  rep(len: number) { this.bit(0); this.elias(len); }
  match(len: number, offset: number) {
    this.bit(1); this.elias(((offset - 1) >> 7) + 1);
    this.out.push((((offset - 1) & 0x7f) << 1) | (len === 2 ? 1 : 0));
    this.elias(len - 1, true);
  }
  end() { this.bit(1); this.elias(256); }
}

type Step = { lit: number[] } | { len: number; off: number };

/** the longest copy from up to 4 KB back where there is one of 3 bytes or more, else a literal (the first byte always
 *  is one) */
function parse(data: number[]): Step[] {
  const steps: Step[] = [];
  let lit: number[] = [];
  for (let i = 0; i < data.length;) {
    let len = 0, off = 0;
    for (let o = 1; i > 0 && o <= Math.min(i, 4096); o++) {
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

/** the steps written: the same offset again after a literal is a repeat */
function write(steps: Step[]): KrillZx0 {
  const w = new KrillZx0();
  let prev: 'lit' | 'copy' | null = null, last = 1;
  for (const s of steps) {
    if ('lit' in s) { w.literal(s.lit, prev === null); prev = 'lit'; continue; }
    if (prev === 'lit' && s.off === last) w.rep(s.len); else w.match(s.len, s.off);
    last = s.off; prev = 'copy';
  }
  return w;
}

/** `data` packed for `dest`, with an end: where it unpacks to (the high byte first), then the stream */
export function packKrillZx0(data: number[], dest: number): number[] {
  const w = write(parse(data));
  w.end();
  return [dest >> 8, dest & 0xff, ...w.out];
}

/** `data` packed in place, to end at `end`: the stream up to its last copy, then the rest of the bytes as they are;
 *  `load` is where the file goes so that the unpacking ends where its reading does */
export function packKrillInPlace(data: number[], end: number): { bytes: number[]; load: number } {
  const steps = parse(data);
  while (steps.length && 'lit' in steps[steps.length - 1]) steps.pop();
  const coded = steps.reduce((n, s) => n + ('lit' in s ? s.lit.length : s.len), 0);
  const start = end - data.length, bytes = [start >> 8, start & 0xff, ...write(steps).out, ...data.slice(coded)];
  return { bytes, load: end - bytes.length };
}

/** A directory entry: its name (text, taken as makeD64 takes it, or the 16 PETSCII bytes), its file (a load address
 *  and bytes; none: a line of a dirart pointing nowhere), the blocks it shows (by default its own), its type, and
 *  `same`: it starts where that earlier entry does */
export interface FakeKrillEntry { name: string | number[]; load?: number; bytes?: number[]; blocks?: number; type?: D64FileType; same?: number }

const dirEntry = (i: number) => { let n = 0; for (let t = 1; t < 18; t++) n += sectorsOnTrack(t); return (n + 1 + 3 * (i >> 3)) * 256 + (i & 7) * 32; };
const bamAt = () => { let n = 0; for (let t = 1; t < 18; t++) n += sectorsOnTrack(t); return n * 256; };

/** A 35-track disk with these entries in its directory (the files one after another from track 1, as makeD64 lays
 *  them out), and the header and id as PETSCII bytes when they are given so. */
export function makeKrillDisk(entries: FakeKrillEntry[], o: { header?: string | number[]; id?: number[] } = {}): Uint8Array {
  const disk = makeD64({
    name: typeof o.header === 'string' ? o.header : 'KRILL DISK',
    files: entries.map(e => ({ name: typeof e.name === 'string' ? e.name : 'X', type: e.type, data: Uint8Array.from(e.bytes ? [e.load! & 0xff, e.load! >> 8, ...e.bytes] : [0]) })),
  });
  entries.forEach((e, i) => {
    const d = dirEntry(i);
    if (typeof e.name !== 'string') { disk.fill(0xa0, d + 5, d + 21); disk.set(e.name.slice(0, 16), d + 5); }
    if (!e.bytes) { disk[d + 3] = 0; disk[d + 4] = 0; disk[d + 30] = 0; disk[d + 31] = 0; }
    if (e.same != null) { const s = dirEntry(e.same); disk[d + 3] = disk[s + 3]; disk[d + 4] = disk[s + 4]; }
    if (e.blocks != null) { disk[d + 30] = e.blocks & 0xff; disk[d + 31] = e.blocks >> 8; }
  });
  if (Array.isArray(o.header)) { disk.fill(0xa0, bamAt() + 0x90, bamAt() + 0xa0); disk.set(o.header.slice(0, 16), bamAt() + 0x90); }
  if (o.id) disk.set(o.id.slice(0, 5), bamAt() + 0xa2);
  return disk;
}

/** Doynax LZ as version 146 of the loader reads it (doynaxdecomp.s): bits from the top of a byte, put in the stream
 *  when the first is written; literal bytes and the low bytes of far offsets go in between as they come. */
export class KrillDoynax {
  out: number[] = [];
  private mask = 0;
  private at = 0;
  /** what came last: a literal of fewer than 256 bytes is always followed by a match, with no bit to say so */
  private afterLiteral = false;
  private started = false;
  bit(v: number) {
    if (!this.mask) { this.mask = 0x80; this.at = this.out.length; this.out.push(0); }
    if (v) this.out[this.at] |= this.mask;
    this.mask >>= 1;
  }
  bits(v: number, n: number) { for (let i = n - 1; i >= 0; i--) this.bit((v >> i) & 1); }
  /** a literal: 1, its length (a 0 and a digit for each digit after the first 1, then a 1; 256 is 0), its bytes last first */
  literal(bytes: number[]) {
    if (!this.started || !this.afterLiteral) this.bit(1);
    this.started = true;
    const digits = (bytes.length & 0xff || 0x100).toString(2).slice(1);
    for (const d of digits) { this.bit(0); this.bit(+d); }
    this.bit(1);
    for (let i = bytes.length - 1; i >= 0; i--) this.out.push(bytes[i]);
    this.afterLiteral = bytes.length < 256;
  }
  /** a match: 0 (unless after a literal), 1 for 2 bytes, the offset's range and bits (counted down from the range's
   *  top), then for a longer one its length - 1 (each digit after the first 1, then 0 to go on or 1 to stop) */
  match(len: number, offset: number) {
    if (!this.started || !this.afterLiteral) this.bit(0);
    this.started = true;
    const ranges = len === 2 ? [[7, 3, 8], [6, 6, 72], [5, 8, 328], [4, 10, 1352]] : [[0, 4, 16], [1, 7, 144], [2, 10, 1168], [3, 13, 9360]];
    const [y, n, top] = ranges.find(([, , t]) => offset <= t)!;
    this.bits(y, 3);
    const v = top - offset;
    // far offsets: the high bits, then the low byte as a byte of its own
    if (y >= 2 && y <= 5) { this.bits(v >> 8, n - 8); this.out.push(v & 0xff); } else this.bits(v, n);
    if (len > 2) { const digits = (len - 1).toString(2).slice(1); digits.split('').forEach((d, i) => { this.bit(+d); this.bit(i === digits.length - 1 ? 1 : 0); }); }
    this.afterLiteral = false;
  }
  /** the end: a match of 257 bytes */
  end() { this.match(257, 1); }
}

/** `data` packed with Doynax LZ for `dest` (the low byte first), with the end; matches from up to 8 KB back */
export function packKrillDoynax(data: number[], dest: number): number[] {
  const w = new KrillDoynax();
  let lit: number[] = [];
  const flush = () => { while (lit.length) { w.literal(lit.slice(0, 256)); lit = lit.slice(256); } };
  for (let i = 0; i < data.length;) {
    let len = 0, off = 0;
    for (let o = 1; i > 0 && o <= Math.min(i, 8192); o++) {
      let n = 0;
      while (i + n < data.length && data[i + n] === data[i + n - o] && n < 256) n++;
      if (n > len) { len = n; off = o; }
    }
    if (len < 3 && !(len === 2 && off <= 1352)) { lit.push(data[i++]); continue; }
    // a match needs a literal before it unless it is the first, or the literal before it was of 256 bytes
    flush();
    w.match(len, off);
    i += len;
  }
  flush();
  w.end();
  return [dest & 0xff, dest >> 8, ...w.out];
}
