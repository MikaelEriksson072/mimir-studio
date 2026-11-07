/* A writer for BoozeLoader disks, to test the reader with (c64/booze-disk.ts): the file table on track 18, the side
 * byte, files as chains of linked sectors, packed the way ByteBoozer 1 and 2 write them (with simple greedy packers, not
 * HCL's own). The drive code is only the few bytes the reader knows it by; nothing of BoozeLoader's own code is on the
 * disks. */
import { makeD64, sectorsOnTrack, unpackByteBoozer1, unpackByteBoozer2, type BoozeCruncher } from '../../src';

/** a step of a packed stream: literal bytes, or a copy of `len` bytes from `offset` back */
export type Step = [number[]] | [number, number];

/** ByteBoozer's bits: from the top of a byte, the byte put in the stream when its first bit is written (the decruncher
 *  reads it then); ByteBoozer 1 keeps up to 7 first bits in its header byte */
class Writer {
  out: number[] = [];
  private left = 0;
  private at = 0;
  private afterLiteral = false;
  /** ByteBoozer 1's header bits (up to `headBits`, 7 at most) */
  private readonly head: number[] = [];
  constructor(private readonly kind: BoozeCruncher, private readonly headBits = 0) {}
  bit(v: number) {
    if (this.kind === 'b1' && this.head.length < this.headBits) { this.head.push(v ? 1 : 0); return; }
    if (!this.left) { this.at = this.out.length; this.out.push(0); this.left = 8; }
    this.left--;
    if (v) this.out[this.at] |= 1 << this.left;
  }
  /** 1-255: the bits after the first 1, each after a 1, then a 0 (none after 7 bits) */
  length(n: number) {
    for (let b = 30 - Math.clz32(n); b >= 0; b--) { this.bit(1); this.bit((n >> b) & 1); }
    if (n < 128) this.bit(0);
  }
  literal(bytes: number[]) {
    if (this.afterLiteral) throw new Error('a literal shorter than 255 is followed by a match');
    this.bit(0); this.length(bytes.length); this.out.push(...bytes);
    this.afterLiteral = bytes.length < 255;
  }
  match(len: number, offset: number) {
    if (!this.afterLiteral) this.bit(1);
    this.afterLiteral = false;
    this.length(len - 1);
    const long = len >= 3 ? 4 : 0;
    if (this.kind === 'b2') {
      const widths = long ? [4, 7, 10, 13] : [3, 6, 8, 10];
      const k = widths.findIndex(w => offset <= 1 << w);
      if (k < 0) throw new Error(`offset ${offset} too far`);
      this.bit(k & 2); this.bit(k & 1);
      const w = widths[k], o = offset - 1;
      if (w < 8) for (let b = w - 1; b >= 0; b--) this.bit(~o & (1 << b));
      else { for (let b = w - 9; b >= 0; b--) this.bit((o >> 8) & (1 << b)); this.out.push(~o & 0xff); }
      return;
    }
    // ByteBoozer 1: groups read from the prefix's down to the first, 1 added before each further group
    const widths = long ? [5, 2, 2, 3] : [4, 2, 2, 2];
    for (let k = 0; k < 4; k++) {
      const groups: number[] = [];
      let rest = offset;
      for (let j = 0; j < k; j++) { groups.unshift(rest & ((1 << widths[j]) - 1)); rest = (rest >> widths[j]) - 1; }
      if (rest < 0 || rest >= 1 << widths[k]) continue;
      groups.unshift(rest);
      this.bit(k & 2); this.bit(k & 1);
      groups.forEach((v, i) => { const w = widths[k - i]; for (let b = w - 1; b >= 0; b--) this.bit(v & (1 << b)); });
      return;
    }
    throw new Error(`offset ${offset} too far`);
  }
  end() { if (!this.afterLiteral) this.bit(1); this.length(255); }
  /** ByteBoozer 1's header byte: its bits, then a 1 */
  headByte(): number { return this.head.reduce((v, b, i) => v | (b << (7 - i)), 0) | (1 << (7 - this.head.length)); }
}

/** the steps written as a stream for `dest`: ByteBoozer 2 `dest lo hi stream`, ByteBoozer 1 `head dest lo hi stream` */
export function boozeStream(kind: BoozeCruncher, dest: number, steps: Step[], headBits = 0): number[] {
  const w = new Writer(kind, headBits);
  for (const s of steps) if (s.length === 1) w.literal(s[0]); else w.match(s[0], s[1]);
  w.end();
  return kind === 'b2' ? [dest & 0xff, dest >> 8, ...w.out] : [w.headByte(), dest & 0xff, dest >> 8, ...w.out];
}

/** the bytes the steps make */
export function expand(steps: Step[]): number[] {
  const out: number[] = [];
  for (const s of steps) if (s.length === 1) out.push(...s[0]); else for (let i = 0; i < s[0]; i++) out.push(out[out.length - s[1]]);
  return out;
}

/** `data` as greedy steps: the longest copy (2-255 bytes) from up to 4 KB back (a copy of 2 from as far as its offsets
 *  reach: 1024 for ByteBoozer 2, 1359 for 1), else literals of up to 255 (one shorter is followed by a copy or the end) */
export function boozeSteps(kind: BoozeCruncher, data: number[]): Step[] {
  const steps: Step[] = [];
  let lit: number[] = [];
  const short = kind === 'b2' ? 1024 : 1359;
  for (let i = 0; i < data.length;) {
    let len = 0, off = 0;
    for (let o = 1; o <= Math.min(i, 4096); o++) {
      let n = 0;
      while (n < 255 && i + n < data.length && data[i + n] === data[i + n - o]) n++;
      if (n > len && (n > 2 || o <= short)) { len = n; off = o; }
    }
    if (len >= 2) { if (lit.length) steps.push([lit]); lit = []; steps.push([len, off]); i += len; continue; }
    lit.push(data[i++]);
    if (lit.length === 255) { steps.push([lit]); lit = []; }
  }
  if (lit.length) steps.push([lit]);
  return steps;
}

/** `data` packed for `dest` */
export const packBooze = (kind: BoozeCruncher, data: number[], dest: number): number[] => boozeStream(kind, dest, boozeSteps(kind, data));

/** `data` packed to unpack in place, ending at `end`: loaded as close after its end as unpacking allows (writing must
 *  not pass reading), as ByteBoozer places a file */
export function packInPlace(kind: BoozeCruncher, data: number[], end: number): { load: number; bytes: number[] } {
  const bytes = packBooze(kind, data, end - data.length), unpack = kind === 'b2' ? unpackByteBoozer2 : unpackByteBoozer1;
  for (let k = 0; k < 256; k++) {
    const load = end + k - bytes.length, u = unpack(Uint8Array.from(bytes), load);
    if (u && u.bytes.length === data.length && u.bytes.every((b, i) => b === data[i])) return { load, bytes };
  }
  throw new Error('does not unpack in place');
}

const offset = (t: number, s: number) => { let n = 0; for (let k = 1; k < t; k++) n += sectorsOnTrack(k); return (n + s) * 256; };

export interface FakeBoozeFile { load: number; bytes: number[] }

/**
 * A disk as BoozeLoader's disks are: the boot program BOOT in the directory, the drive code's marks in 18/18 (unless
 * `driveCode` is false), the side in 18/0 byte $ff, the file table in 18/`table` (9; none: the program names track and
 * sector), and each file as a chain of sectors from track 3 on (every 4th sector, as the drive reads them), its load
 * address first, the sectors taken in the BAM.
 */
export function makeBoozeDisk(files: FakeBoozeFile[], o: { name?: string; side?: number; table?: number | null; driveCode?: boolean; boot?: Uint8Array } = {}): Uint8Array {
  const img = makeD64({ name: o.name ?? 'BOOZE DEMO', files: [{ name: 'BOOT', data: o.boot ?? Uint8Array.from([0x01, 0x08, 0x60]) }] });
  const table = o.table === undefined ? 9 : o.table;
  if (o.driveCode !== false) {
    // tsx / stx $04xx / ldx #$ff / txs / jsr $f50a / bvc *; the bit receive (lsr x3 / tya / ror / bcc); the table's sector
    const s = offset(18, 18);
    img.set([0xba, 0x8e, 0xb1, 0x04, 0xa2, 0xff, 0x9a, 0x20, 0x0a, 0xf5, 0x50, 0xfe], s);
    img.set([0x4a, 0x4a, 0x4a, 0x98, 0x6a, 0x90, 0xe4], offset(18, 12) + 0x60);
    if (table != null) img.set([0xa2, table, 0x86, 0x0f], offset(18, 15) + 0x10);
  }
  if (o.side != null) img[offset(18, 0) + 0xff] = 0x30 + o.side;
  // the sectors from track 3 on, every 4th on a track, then from 1, 2 and 3
  const order: [number, number][] = [];
  for (let t = 3; t <= 35; t++) { if (t === 18) continue; for (let r = 0; r < 4; r++) for (let s = r; s < sectorsOnTrack(t); s += 4) order.push([t, s]); }
  let pos = 0;
  const bam = offset(18, 0);
  files.forEach((f, n) => {
    const data = [f.load & 0xff, f.load >> 8, ...f.bytes], chain: [number, number][] = [];
    for (let p = 0; p === 0 || p < data.length; p += 254) chain.push(order[pos++]);
    chain.forEach(([t, s], k) => {
      const at = offset(t, s), part = data.slice(k * 254, k * 254 + 254);
      if (k + 1 < chain.length) img.set(chain[k + 1], at); else img.set([0, part.length + 1], at);
      img.set(part, at + 2);
      // taken in the BAM
      if (img[bam + 4 * t + 1 + (s >> 3)] & (1 << (s & 7))) { img[bam + 4 * t + 1 + (s >> 3)] &= ~(1 << (s & 7)); img[bam + 4 * t]--; }
    });
    if (table != null) img.set(chain[0], offset(18, table) + 2 * n);
  });
  return img;
}

/** the boot program of the fixture: a script (side 1, files 0, 1 and 2 and the parts between) and a loader with
 *  BoozeLoader's receive loop and its way of sending a bit, a few instructions each */
export const BOOZE_BOOT = `.pc = $0801
.byte $0b,$08,$0a,$00,$9e,$32,$30,$36,$31,$00,$00,$00
.pc = $080d
start:
 lda #$b1
 jsr load
 lda #$00
 jsr load
 jsr $1000
 lda #$01
 jsr load
 lda #$02
 jsr load
 ldx #$05
 jsr $2000
 rts
load:
 pha
 jsr send
 pla
 bpl recv
 rts
recv:
 dey
 ldx #$08
 lda $dd00
 stx $dd00
 lsr
 lsr
 iny
 nop
 ldx #$00
 eor $dd00
 stx $dd00
 lsr
 lsr
 ldx #$08
 eor $dd00
 stx $dd00
 lsr
 lsr
 sta last+1
 lda #$c0
 and $dd00
 sta $dd00
last:
 ora #$00
 sta $0400,y
 rts
send:
 ldy #$00
 bcc go
 ldy #$10
go:
 lda #$08
 sta $dd00
wait:
 bit $dd00
 bpl wait
 sty $dd00
 rts
`;
