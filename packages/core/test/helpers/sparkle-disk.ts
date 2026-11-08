/* A writer for Sparkle disks, to test the reader with (c64/sparkle-disk.ts): bundles packed into blocks the way each
 * kind of Sparkle's block unpacker reads them (`old`, `f8` and `84` items; with a simple greedy packer, not Sparkle's
 * own), laid out in the drive's sector walk, with the drive's counts (`raw`, `bits` or `eor`), Memento Mori's kind of
 * directory and the side numbers. The drive code and the boot program are only the few bytes the reader knows them by;
 * nothing of Sparkle's own code is on the disks. */
import { makeD64, sectorsOnTrack, sparkleBlockOrder, type SparkleCountCode, type SparkleItems } from '../../src';

/** a piece of a bundle: its bytes from `start` on, `io` when it goes under the I/O area */
export interface FakeSegment { start: number; bytes: number[]; io?: boolean }
export type FakeBundle = FakeSegment[];

const COUNT_BITS = [3, 1, 2, 0, 7, 5, 6, 4];
/** a count as the drive reads it: as it is, each bit moved and all inverted, or EOR $7f/$76 */
export function sparkleCode(n: number, code: SparkleCountCode = 'bits'): number {
  if (code === 'raw') return n & 0xff;
  if (code === 'eor') return n ^ ((n & 9) === 0 || (n & 9) === 9 ? 0x7f : 0x76);
  let v = 0;
  for (let i = 0; i < 8; i++) if (n & (1 << i)) v |= 1 << COUNT_BITS[i];
  return ~v & 0xff;
}

/** The bundles packed into blocks, in the order the drive reads them, and where each bundle starts (its block and the
 *  index of its first byte of bits there; the old blocks have none there). Every step leaves room to end the block. */
export function packSparkle(bundles: FakeBundle[], items: SparkleItems = 'f8', counts: SparkleCountCode = 'bits'): { blocks: Uint8Array[]; starts: { block: number; x: number }[]; ends: number[] } {
  const blocks: Uint8Array[] = [], starts: { block: number; x: number }[] = [], ends: number[] = [];
  let blk = new Uint8Array(256), x = 255, bitsAt = 0, bitsLeft = 0, nibAt = -1, startBits = 0;
  const near = items === '84';
  /** what the unpacker reads next: a literal's bit, an item byte, or the bit after a match */
  let state: 'lit' | 'tok' | 'match' = 'lit';
  // read through a call: the closures below change it, which TypeScript's narrowing does not see
  const now = () => state;
  const byte = (v: number) => { if (x < 2) throw new Error('the block is full'); blk[x--] = v & 0xff; };
  // a bundle's first byte of bits (byte 0 of a block, or below the end of the bundle before) is read as it is: 7 bits
  // and a 1 below them; the old blocks' byte 0 holds 8 (the 1 goes in as the first is read); a byte read when the bits
  // run out holds 8
  const firstBits = (at: number) => {
    startBits = at; bitsAt = at;
    if (items === 'old') { blk[at] = 0; bitsLeft = 8; startBits = -1; } else { blk[at] = 1; bitsLeft = 7; }
  };
  const bit = (v: number) => {
    if (!bitsLeft) { bitsAt = x; byte(0); bitsLeft = 8; }
    bitsLeft--;
    if (v) blk[bitsAt] |= 1 << (bitsAt === startBits ? bitsLeft + 1 : bitsLeft);
  };
  const nibble = (v: number) => { if (nibAt < 0) { nibAt = x; byte(v & 15); } else { blk[nibAt] |= (v & 15) << 4; nibAt = -1; } };
  const header = (addr: number, io: boolean) => { byte(addr & 0xff); if (io) byte(0); byte(addr >> 8); };
  const room = () => x - 1;
  const toTok = () => { if (state === 'match') bit(1); state = 'tok'; };
  const literal = (bytes: number[]) => {
    if (bytes.length === 1) bit(0);
    else { bit(1); const v = bytes.length - 1; if (v < 16) nibble(v); else { nibble(0); byte(v); } }
    bytes.forEach(byte);
    state = 'tok';
  };
  /** a copy's item bytes */
  const copy = (len: number, dist: number): number[] => {
    if (len <= 4 && dist <= 64) return [((dist - 1) << 2) | (len - 1)];
    if (!near) return len <= 62 ? [(len - 1) << 2, dist - 1] : [0xf8, len - 1, dist - 1];
    const d = dist - 1, hi = d >> 8;
    if (dist <= 256) return len <= 31 ? [0x80 | (len << 2), d] : [0x84, len, d];
    return len <= 31 ? [len << 2, hi, d & 0xff] : [0x04, hi, len, d & 0xff];
  };
  const newAddress = near ? 0x80 : 0xfc, endOfBundle = near ? [0x84, 0] : [0xf8, 0];
  /** the end of the block (from where a byte of bits and an item byte fit), and the next one */
  const nextBlock = () => {
    toTok(); blk[x--] = 0;
    blocks.push(blk);
    blk = new Uint8Array(256); x = 255; nibAt = -1;
    firstBits(0);
  };
  // the last byte written, to write again where a bundle that does not end in its block ends in the next one
  let last = { addr: 0, value: 0, io: false };

  firstBits(0);
  bundles.forEach((bundle, n) => {
    if (n === 0) starts.push({ block: 0, x: 0 });
    else if (items === 'old') starts.push({ block: blocks.length, x });
    else { starts.push({ block: blocks.length, x }); const at = x; byte(0); firstBits(at); nibAt = -1; }
    bundle.forEach((seg, k) => {
      const top = seg.start + seg.bytes.length - 1, d = [...seg.bytes].reverse();
      const io = !!seg.io;
      // a new address where a literal and the end of the block fit too, else in the next block
      if (k > 0) { if (room() < 12) nextBlock(); else { toTok(); byte(newAddress); } }
      header(top, io);
      state = 'lit';
      let from = 0;
      /** the byte at an address while d[j] is the next to write: one of this segment written in this block */
      const value = (src: number, j: number) => { const idx = top - src; return idx >= from && idx < j ? d[idx] : undefined; };
      const matchAt = (j: number) => {
        let best = { len: 0, dist: 0 };
        for (let dist = 1; dist <= (near ? 0x2000 : 256); dist++) {
          if (j - dist < from) break;
          let len = 0;
          while (j + len < d.length && len < (near ? 255 : 256) && value(top - j - len + dist, j + len) === d[j + len]) len++;
          if (len > best.len) best = { len, dist };
        }
        return best.len >= 2 && !(near && best.dist > 256 && best.len < 3) ? best : null;
      };
      for (let i = 0; i < d.length;) {
        if (now() === 'lit') {
          let len = 1;
          while (i + len < d.length && len < 256 && 3 + len + 1 + 2 <= room() && (matchAt(i + len)?.len ?? 0) < 3) len++;
          literal(d.slice(i, i + len));
          i += len;
          continue;
        }
        const m = matchAt(i), item = m && copy(m.len, m.dist);
        if (m && item && room() >= item.length + 3) {
          toTok();
          item.forEach(byte);
          i += m.len; state = 'match';
        } else if (!m && now() === 'match' && room() >= 7) { bit(0); state = 'lit'; }
        else if (!m && now() === 'tok' && room() >= 10) { byte(newAddress); header(top - i, io); state = 'lit'; }
        else {
          // the segment goes on in the next block, which says where again
          nextBlock(); from = i;
          header(top - i, io); state = 'lit';
        }
      }
      last = { addr: seg.start, value: seg.bytes[0], io };
    });
    // the end of the bundle, where the next one's start fits below it too; else the end goes to the next block, after
    // the bundle's last byte written again
    if (room() < (n + 1 < bundles.length ? 13 : 4)) { nextBlock(); header(last.addr, last.io); state = 'lit'; literal([last.value]); }
    toTok(); endOfBundle.forEach(byte);
    ends.push(blocks.length);
  });
  blocks.push(blk);
  // byte 1: the first block's and each bundle's last block's count of the blocks the next bundle takes on
  blocks[0][1] = sparkleCode(ends[0], counts);
  ends.forEach((e, n) => {
    const later = ends.findIndex((f, m) => m > n && f > e);
    if (ends[n + 1] === e && n + 1 < ends.length) return;
    blocks[e][1] = sparkleCode(later < 0 ? 0 : ends[later] - e, counts);
  });
  return { blocks, starts, ends };
}

const offset = (t: number, s: number) => { let n = 0; for (let k = 1; k < t; k++) n += sectorsOnTrack(k); return (n + s) * 256; };

/** The boot program: a BASIC line, the copy of the resident part, and the first load (`lda #>start-1 / pha / lda
 *  #<start-1 / pha / jmp load`). The resident part has, a few bytes each, the call that sends a bundle's index at
 *  $0160, the receive loop's last read, the block unpacker's item byte and store, and the call that loads the next
 *  bundle: Memento Mori's (`f8`, from $01f9), All Hallows Eve's (`84`, from $0200), or the old one at $0180-$02ff,
 *  copied in three halves (`lda #bits / ldx #place / bne` at $0180, no index). */
export function sparkleBoot(start: number, items: SparkleItems = 'f8'): Uint8Array {
  const res = new Uint8Array(0x1a0).fill(0xea); // $0160-$02ff
  const put = (a: number, b: number[]) => res.set(b, a - 0x160);
  put(0x1be, [0x2d, 0x00, 0xdd, 0x8d, 0x00, 0xdd, 0x09, 0x00, 0x9d, 0x00, 0x03, 0x50, 0xcc]);
  let first = 0x0181;
  if (items === 'f8') {
    put(0x160, [0x85, 0x04]);
    put(0x1f9, [0xa2, 0x00, 0xad, 0x00, 0x03, 0xd0, 0x06]);
    put(0x22c, [0xbd, 0x00, 0x03, 0xf0, 0xb4, 0xc9, 0xf8, 0xb0, 0x9d, 0x4a, 0x4b, 0xfe, 0xa8, 0x49, 0xff, 0x65, 0x02]);
    put(0x261, [0x91, 0x02, 0x88, 0xd0, 0xf8]);
  } else if (items === '84') {
    first = 0x0185;
    put(0x160, [0x85, 0x04]);
    put(0x200, [0xa2, 0xff, 0x8e, 0xbf, 0x02, 0xe8, 0xbd, 0x00, 0x03, 0xd0, 0x05]);
    put(0x232, [0xbd, 0x00, 0x03, 0x10, 0x9f, 0x8c, 0x55, 0x02, 0x4b, 0x7c, 0x4a, 0xc9, 0x02]);
    put(0x278, [0x91, 0x02, 0x88, 0xd0, 0xf8]);
  } else {
    first = 0x0180;
    put(0x180, [0xa9, 0x00, 0xa2, 0x00, 0xd0, 0x60]);
    put(0x23d, [0xbd, 0x00, 0x03, 0xf0, 0xbc, 0xc9, 0xf8, 0xb0, 0xa2, 0x4a, 0x4b, 0xfe, 0xa8, 0x49, 0xff, 0x65, 0xf0]);
    put(0x272, [0x91, 0xf0, 0x88, 0xd0, 0xf8]);
  }
  const load = [0xa9, ((start - 1) >> 8) & 0xff, 0x48, 0xa9, (start - 1) & 0xff, 0x48, 0x4c, first & 0xff, 0x01];
  // the resident part is at $0900-$0a9f in the program: two pages copied (to $0160 from $0900, to $0200 from $09a0),
  // or the old one's three halves (to $0180, $0200 and $0280 from $0920, $09a0 and $0a20)
  const copy = items === 'old'
    ? [0xa2, 0x00, 0xbd, 0x20, 0x09, 0x9d, 0x80, 0x01, 0xbd, 0xa0, 0x09, 0x9d, 0x00, 0x02, 0xbd, 0x20, 0x0a, 0x9d, 0x80, 0x02, 0xe8, 0x10, 0xeb]
    : [0xa2, 0x00, 0xbd, 0x00, 0x09, 0x9d, 0x60, 0x01, 0xbd, 0xa0, 0x09, 0x9d, 0x00, 0x02, 0xe8, 0xd0, 0xf1];
  const prg = [0x01, 0x08, 0x0b, 0x08, 0x0a, 0x00, 0x9e, 0x32, 0x30, 0x36, 0x31, 0x00, 0x00, 0x00, ...copy, ...load];
  while (prg.length < 0x0900 - 0x0801 + 2) prg.push(0xea);
  return Uint8Array.from([...prg, ...res]);
}

/** A Sparkle disk side with these bundles (the first loaded by the boot program, which then goes to `start`). */
export function makeSparkleDisk(bundles: FakeBundle[], o: { name?: string; il?: [number, number, number, number]; start?: number; side?: number; next?: number; dir?: boolean; boot?: boolean; items?: SparkleItems; counts?: SparkleCountCode } = {}): Uint8Array {
  const il = o.il ?? [4, 3, 3, 3], items = o.items ?? 'f8', counts = o.counts ?? (items === 'old' ? 'raw' : items === '84' ? 'eor' : 'bits');
  const img = makeD64({ name: o.name ?? 'SPARKLE DEMO', id: 'SP', files: [] });
  const { blocks, starts } = packSparkle(bundles, items, counts);
  const order = sparkleBlockOrder(35, il);
  if (blocks.length > order.length) throw new Error('too many blocks');
  const bam = offset(18, 0);
  const take = (t: number, s: number) => {
    if (img[bam + 4 * t + 1 + (s >> 3)] & (1 << (s & 7))) { img[bam + 4 * t + 1 + (s >> 3)] &= ~(1 << (s & 7)); img[bam + 4 * t]--; }
  };
  blocks.forEach((b, i) => { const [t, s] = order[i]; img.set(b, offset(t, s)); take(t, s); });
  // the drive code: the walk's setup (ldx $4f,y / stx / one more back on a track of 21) and the zero page in 18/14 with
  // each zone's interleave as sbx takes it
  img.set([0x78, 0xa9, 0x7a, 0x8d, 0x02, 0x18, 0xa9, 0x10, 0x8d, 0x00, 0x18, 0xa2, 0x00, 0xbd, 0x00, 0x06, 0x95, 0x00], offset(18, 15));
  img.set([0xb6, 0x4f, 0x8e, 0x93, 0x02, 0xa2, 0x01, 0x86, 0x28, 0xc0, 0x15, 0xf0, 0x01, 0xca, 0x8e, 0x9d, 0x02], offset(18, 13) + 0xb9);
  [21, 19, 18, 17].forEach((spt, i) => { img[offset(18, 14) + 0x4f + spt] = (0x100 - il[i]) & 0xff; });
  for (const s of [11, 12, 13, 14, 15]) take(18, s);
  // the directory (Memento Mori's): a bundle's track, where the walk starts on it, the sectors left there, where in
  // the block it starts
  if (o.dir ?? (items === 'f8' && counts === 'bits')) {
    const walk = new Map<number, number[]>();
    for (const [t, s] of order) walk.set(t, [...(walk.get(t) ?? []), s]);
    const dir = offset(18, 17);
    starts.slice(0, 128).forEach(({ block, x }, n) => {
      const [t, s] = order[block], w = walk.get(t)!;
      img.set([sparkleCode(t, counts), sparkleCode(w[0], counts), sparkleCode(w.length - w.indexOf(s), counts), x], dir + 4 * n);
    });
    take(18, 17); take(18, 18);
  }
  if (o.side != null) img[bam + 0xff] = sparkleCode(o.side, counts);
  if (o.next != null) img[bam + 0xfe] = sparkleCode(o.next, counts);
  if (o.boot !== false) {
    // the boot program on 18/7 on, the directory's first entry
    const boot = sparkleBoot(o.start ?? 0x0810, items);
    const secs = [7, 8, 9, 10, 16];
    const n = Math.ceil(boot.length / 254);
    for (let k = 0; k < n; k++) {
      const at = offset(18, secs[k]), part = boot.subarray(k * 254, k * 254 + 254);
      img.set(k + 1 < n ? [18, secs[k + 1]] : [0, part.length + 1], at);
      img.set(part, at + 2);
      take(18, secs[k]);
    }
    const e = offset(18, 1) + 2;
    img.set([0x82, 18, 7], e);
    img.set([...'SPARKLE DEMO'].map(c => c.charCodeAt(0)), e + 3);
    img.fill(0xa0, e + 3 + 12, e + 19);
    img.set([n, 0], e + 28);
  }
  return img;
}
