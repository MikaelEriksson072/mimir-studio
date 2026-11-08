/* The bundles of a Sparkle disk side (spec 13.5i). Sparkle (Sparta/OMG, 2019 on) builds a trackmo's disk from a
 * script, a .sls file whose paragraphs are bundles: the files and pieces of files one loader call loads. They are not
 * files on the disk. Sparkle packs the bundles one after another into blocks of 256 bytes, back to back (a bundle starts
 * in the block where the one before it ends), and the drive sends a bundle's blocks in the order they pass under the
 * head: every block says where its bytes go, so the C64 unpacks each one as it comes.
 *
 * Read from Genesis Project's Memento Mori (2020), All Hallows Eve (2022) and Lethargy's 5 Shades of Grey (2020), and checked byte for byte against the loader running in Sindri and the disks' own unpackers:
 * - the boot program (the first directory entry) copies the resident part to $0160-$02ff (the old one to $0180) and
 *   sends an M-E that has the DOS read the drive code from track 18 (18/11-18/15, or 18/2, 6, 10, 14 and 18) and start
 *   it. It loads the first bundle with `lda #>start-1 / pha / lda #<start-1 / pha / jmp load`: the script's Start;
 * - 18/14 is the drive's zero page. The drive code takes each speed zone's interleave from it (`ldx zp,y` with y the
 *   sectors on the track; most versions at $4f + y) and patches its sector walk with it;
 * - the blocks are tracks 1 to 35 (40), past 18, each track's sectors in the order the drive walks them: on from where
 *   the walk on the track before ended, an interleave on at a time, the next sector when that one is taken; past the
 *   track's last sector it goes back by the sectors on the track (and one more on a track of 21), and it steps two on
 *   over track 18. The first block is 1/0;
 * - a block is its bytes as the C64 receives them. Byte 0 is the first byte of bits; the rest is read from the top
 *   down: where the bytes go (low, then high; a high byte of 0 means under the I/O area, and the real one follows),
 *   then items. A bit 0 is a literal of 1 byte; a bit 1 a longer literal, its length - 1 in a nibble (two to a byte, the
 *   low one first; 0: a whole byte follows). A literal is followed by a copy; after a copy a bit 1 is another copy, a
 *   0 a literal. A copy byte with its low two bits not 0 copies (b & 3) + 1 bytes from (b >> 2) + 1 above. Bits come
 *   from the top of a byte, its lowest 1 marks the end of them; a new byte of them is read when they run out. Copies
 *   come from higher addresses: a bundle unpacks from its highest bytes down. The other item bytes (`items`):
 *   - `f8` (Memento Mori): (b >> 2) + 1 bytes from the next byte + 1 above; 0 ends the block, $f8 n (n not 0) copies
 *     n + 1 bytes from the next byte + 1 above, $f8 0 ends the bundle (the next one starts below it: its bits, then
 *     where it goes), and $fc gives a new address;
 *   - `old` (5 Shades of Grey): the same, but a block's byte 0 holds 8 bits (the 1 that ends them goes in as the first
 *     is read), and a bundle that starts below the end of another goes on with its bits and nibble;
 *   - `84` (All Hallows Eve, Sparkle 3's too): the length in bits 2-6, the distance's high byte first when bit 7 is
 *     not set: 1LLLLL00 o copies L bytes from o + 1 above, 0LLLLL00 h o from (h o) + 1 above; with L = 1 a byte of
 *     length follows ($84 n o, $04 h n o; $84 0 ends the bundle), with L = 0 ($80) a new address; 0 ends the block;
 * - byte 1 of the first block and of a block where a bundle ends is for the drive: how many more blocks the next
 *   bundle that goes on past it takes; the drive sends the C64 a 0 there. The counts are coded (`counts`): `raw` as
 *   they are (the old blocks), `bits` each bit moved (bit i to 3, 1, 2, 0, 7, 5, 6, 4) and all inverted (Memento Mori),
 *   `eor` EOR $7f when bits 0 and 3 are the same, else $76 (All Hallows Eve). A count of 0 ends the side; the same
 *   code in the BAM at $ff and $fe gives this side's number and the next's. That every bundle ends where the counts say
 *   is the check that the walk, the items and the counts are right;
 * - 18/17 and 18/18 are the drive's directory: 4 bytes a bundle, by its number (128 at most). In Memento Mori: its
 *   first block's track, where the walk on that track starts, the sectors left on the track from that block on (all
 *   three coded as the counts), and where in the block the bundle starts. A part loads the next bundle with `jsr
 *   $01f9`; `lda #number / jsr $0160` before it picks another (Memento Mori's third side starts its main code from its
 *   last bundle). Later disks list only the bundles a script gives a number, and not as this reads them.
 * Sparkle 3's newest disks (Aloft, Wavemode) keep their drive code another way, and a few modified loaders (Lethargy's
 * Median and Padawans Awakening) count otherwise: they are not read. */
import type { Addr } from '../types';
import { diskSectors, parseD64, petsciiName, readD64File, sectorOffset, sectorsOnTrack } from './d64';

export interface SparkleChunk {
  start: Addr; end: Addr; bytes: Uint8Array;
  /** it loads into the RAM under the I/O area ($01 = $34 while it unpacks) */
  io: boolean;
}

export interface SparkleBundle {
  /** its number from 0, as the loader loads them one after the other */
  n: number;
  /** the block it starts in */
  track: number; sector: number;
  /** the blocks the drive reads for it; 0: it was all in the block where the bundle before it ended */
  blocks: number;
  /** what it loads, by address */
  chunks: SparkleChunk[];
  /** bytes a copy needs that nothing loaded before it (a damaged disk) */
  missing: number;
}

export interface SparkleDisk {
  bundles: SparkleBundle[];
  /** the blocks' items, and how the drive's counts are coded (the two go together on the disks seen) */
  items: SparkleItems; counts: SparkleCountCode;
  /** where the boot program goes after the first bundle (the script's Start); null: no boot program on the side */
  start: Addr | null;
  /** the interleave of the four speed zones (tracks 1-17, 18-24, 25-30, 31 on): the script's IL0-IL3 */
  il: [number, number, number, number];
  /** the loader's zero page (3 bytes from here): the script's ZP; null: no boot program to read it from */
  zp: number | null;
  /** this side's number and the next side's (18/0 bytes $ff and $fe); null: not given, or the last side */
  side: number | null; next: number | null;
  /** the blocks the bundles take, from 1/0 on */
  blocks: number;
  /** the bundles unpack to the end of the side; false: the last one did not (its last block counts on more blocks
   *  that are not Sparkle blocks), and the ones before it are all there is here */
  complete: boolean;
  /** the boot program's name in the directory (the script's Name); null: none */
  boot: string | null;
  /** the directory's header and its 5 characters of ID (the script's Header and ID) */
  header: string; id: string;
  tracks: 35 | 40;
  /** the drive's directory (18/17-18/18) has every bundle where it is: a part can load one by its index */
  indexed: boolean;
  /** the resident part's calls (from the boot program): load the next bundle, and send the drive a bundle's index
   *  (in A) to load next (null: the old one has none); null: no boot program on the side, or not one known */
  api: { next: Addr; send: Addr | null } | null;
}

/** The blocks' items: `f8`, $f8 for long copies and the end of a bundle and $fc for a new address (Memento Mori,
 *  2020); `old`, the same items, but a block's first byte holds 8 bits and a bundle that starts in the block where the
 *  one before ended goes on with its bits (5 Shades of Grey and Gamertro, 2020; Fatzone's demos to 2023); `84`, $84 and
 *  $04 for long copies and the end of a bundle and $80 for a new address, with copies from up to 64K above (All
 *  Hallows Eve, 2022, on). */
export type SparkleItems = 'old' | 'f8' | '84';
/** How the drive's counts are coded: `raw`, as they are (the old blocks); `bits`, each bit moved (bit i to 3, 1, 2,
 *  0, 7, 5, 6, 4) and all inverted (Memento Mori); `eor`, EOR $7f when bits 0 and 3 are the same and $76 when not (All
 *  Hallows Eve). */
export type SparkleCountCode = 'raw' | 'bits' | 'eor';

const SIZES: Record<number, 35 | 40> = { 174848: 35, 175531: 35, 196608: 40, 197376: 40 };
/** where a block's count for the drive keeps each bit of the count (all of them inverted) */
const COUNT_BITS = [3, 1, 2, 0, 7, 5, 6, 4];

/** A count the drive reads (byte 1 of a bundle's last block, the first three bytes of a directory entry, or a side
 *  number in the BAM). */
export function sparkleCount(b: number, code: SparkleCountCode = 'bits'): number {
  if (code === 'raw') return b;
  if (code === 'eor') return b ^ ((b & 9) === 0 || (b & 9) === 9 ? 0x7f : 0x76);
  const v = ~b & 0xff;
  let n = 0;
  for (let i = 0; i < 8; i++) if (v & (1 << COUNT_BITS[i])) n |= 1 << i;
  return n;
}

const toPat = (s: string): (number | null)[] => s.split(' ').map(x => (x === '..' ? null : parseInt(x, 16)));
const find = (b: Uint8Array, p: (number | null)[], from = 0): number => {
  for (let a = from; a + p.length <= b.length; a++) if (p.every((x, i) => x === null || b[a + i] === x)) return a;
  return -1;
};
/** the drive code sets up its sector walk for a track: ldx il,y (y the sectors on it) / stx, then one more sector
 *  back past the last one on a track of 21 (ldx #1 / stx / cpy #21 / beq / dex / stx) */
const WALK_SETUP = toPat('B6 .. 8E .. .. A2 01 86 .. C0 15 F0 01 CA 8E');
/** the C64's resident part copied from the boot program to $0160 and $0200, or (the old one) to $0180, $0200, $0280 */
const RESIDENT_COPY = toPat('BD .. .. 9D 60 01 BD .. .. 9D 00 02');
const RESIDENT_COPY_OLD = toPat('BD .. .. 9D 80 01 BD .. .. 9D 00 02 BD .. .. 9D 80 02');
/** the block unpacker reads an item byte (lda $0300,x): `f8`, 0 ends the block, from $f8 a command; `84`, from $80 a
 *  near copy (alr #$7c / lsr: its length) */
const UNPACKER: Record<SparkleItems, (number | null)[]> = {
  old: toPat('BD 00 03 F0 .. C9 F8 B0 .. 4A 4B FE A8 49 FF 65'),
  f8: toPat('BD 00 03 F0 .. C9 F8 B0 .. 4A 4B FE A8 49 FF 65'),
  84: toPat('BD 00 03 10 .. 8C .. 02 4B 7C 4A C9 02'),
};
/** where the unpacker writes: sta (zp),y / dey / bne */
const STORE = toPat('91 .. 88 D0 F8');
/** load the next bundle: the first byte of the block 0 means it goes on where the last bundle ended (ldx #0 / lda
 *  $0300 / bne; or ldx #$ff / stx / inx / lda $0300(,x) / bne) */
const LOAD_NEXT = [toPat('A2 00 AD 00 03 D0'), toPat('A2 FF 8E .. 02 E8 BD 00 03 D0'), toPat('A2 FF 8E .. 02 E8 AD 00 03 8E 00 03 D0')];
/** the first load: lda #>start-1 / pha / lda #<start-1 / pha / jmp load */
const FIRST_LOAD = toPat('A9 .. 48 A9 .. 48 4C .. 01');

/** The sectors in the order the drive reads them (track by track, a speed zone's interleave at a time). */
export function sparkleBlockOrder(tracks: number, il: readonly number[]): [number, number][] {
  const out: [number, number][] = [];
  let x = 0;
  for (let t = 1; t <= tracks; t++) {
    if (t === 18) { x += 2; continue; }
    const spt = sectorsOnTrack(t), step = il[t <= 17 ? 0 : t <= 24 ? 1 : t <= 30 ? 2 : 3], back = spt === 21 ? 1 : 0;
    const wrap = () => { if (x >= spt) { x -= spt; if (x) x -= back; } };
    const taken = new Uint8Array(spt);
    wrap();
    for (let n = 0; n < spt; wrap()) {
      if (taken[x]) { x++; continue; }
      taken[x] = 1; out.push([t, x]); n++; x += step;
    }
  }
  return out;
}

interface Unpacked { at: number; last: number; chunks: SparkleChunk[]; missing: number }

/** The bundles in the blocks, unpacked as the loader does; null when the blocks are not a Sparkle side with these
 *  items and counts. A bundle that does not end in the block where the last one did must end where that block's count
 *  says: a strong check that the blocks, items and counts are right. When the side's last bundle does not unpack, the
 *  ones checked before it are the side, not complete (but for the old blocks' end: a last count of 1). */
function unpackBlocks(blocks: Uint8Array[], items: SparkleItems, code: SparkleCountCode): { bundles: Unpacked[]; complete: boolean } | null {
  const mem = new Uint8Array(0x10000), known = new Uint8Array(0x10000);
  // the bundle (+1) that wrote each address last, and whether it went under the I/O area ($d000-$dfff with $01 = $34)
  const stamp = new Uint16Array(0x10000), io = new Uint8Array(0x10000);
  const bundles: Unpacked[] = [];
  let bi = 0, blk = blocks[0].slice(), x = 0, bits = 0, ptr = 0, nib = -1, under = false;
  let at = 0, missing = 0, written: number[] = [];
  blk[1] = 0;
  const byte = (i: number) => { if (i < 0 || i > 255) throw new Error('outside the block'); return blk[i]; };
  const header = () => {
    const lo = byte(x--);
    let hi = byte(x--);
    under = hi === 0;
    if (under) hi = byte(x--);
    ptr = (hi << 8) | lo;
    blk[0] = 0;
  };
  // the old blocks' first byte of bits holds 8: the 1 that ends them goes in below as the first one is read
  let mark = false;
  const startBits = () => {
    bits = byte(x--); nib = -1;
    if (items === 'old') mark = true;
    else if (!bits) throw new Error('no bits');
  };
  const bit = () => {
    if (mark) { mark = false; const c = bits >> 7; bits = ((bits << 1) | 1) & 0xff; return c; }
    let c = bits >> 7;
    bits = (bits << 1) & 0xff;
    if (!bits) { const b = byte(x--); c = b >> 7; bits = ((b << 1) | 1) & 0xff; }
    return c;
  };
  const put = (v: number) => {
    if (stamp[ptr] !== bundles.length + 1) { stamp[ptr] = bundles.length + 1; written.push(ptr); }
    mem[ptr] = v; known[ptr] = 1; io[ptr] = under && ptr >> 12 === 0xd ? 1 : 0;
    ptr = (ptr - 1) & 0xffff;
  };
  /** the bundle's bytes as it leaves them, a chunk per run of addresses; under the I/O area when any of its bytes
   *  in $d000-$dfff is (Sparkle sets $01 a block at a time, so a file's blocks outside it may not say so) */
  const finish = (last: number) => {
    const chunks: SparkleChunk[] = [];
    written.sort((a, b) => a - b);
    for (let i = 0; i < written.length;) {
      let j = i + 1, under = io[written[i]];
      while (j < written.length && written[j] === written[j - 1] + 1) under |= io[written[j++]];
      const start = written[i], end = written[j - 1] + 1;
      chunks.push({ start, end, bytes: mem.slice(start, end), io: !!under });
      i = j;
    }
    bundles.push({ at, last, chunks, missing });
    written = []; missing = 0;
  };
  // the side's last block: the drive sends no more, but bundles that end in it still load
  let final = false;
  // the block where the next bundle that goes on past its block must end, and the last block where one ended
  let due = sparkleCount(blocks[0][1], code), lastEnd = 0, checked = 0;
  /** the bundles before the one that did not unpack, when at least two of them ended where the counts say; the old
   *  sides all end so, with a last count of 1 (the block after it is empty, or a file of the directory) */
  const cut = () => (checked >= 2 ? { bundles, complete: items === 'old' && due === lastEnd + 1 } : null);
  try {
    x = 0; startBits(); x = 255; header();
    let literal = true;
    for (let steps = 0; steps < 8_000_000; steps++) {
      if (literal) {
        let n = 1;
        if (bit()) {
          if (nib < 0) { const b = byte(x--); n = b & 15; nib = b >> 4; } else { n = nib; nib = -1; }
          if (!n) n = byte(x--);
          n++;
        }
        for (let k = 0; k < n; k++) put(byte(x--));
        literal = false;
        continue;
      }
      const t = byte(x);
      let len = 0, dist = 0, end = -1;
      if (t & 3) { len = (t & 3) + 1; dist = (t >> 2) + 1; x--; }
      else if (t === 0) {
        // the end of the block: the next one
        if (final) return { bundles, complete: true };
        if (++bi >= blocks.length) { bi--; return cut(); }
        blk = blocks[bi].slice();
        x = 0; startBits(); x = 255; header();
        literal = true;
        continue;
      } else if (items !== '84') {
        if (t === 0xf8 && byte(x - 1) === 0) end = x - 2;
        else if (t === 0xfc) { x--; header(); literal = true; continue; }
        else if (t === 0xf8) { len = byte(x - 1) + 1; dist = byte(x - 2) + 1; x -= 3; }
        else { len = (t >> 2) + 1; dist = byte(x - 1) + 1; x -= 2; }
      } else {
        // the length in bits 2-6 (1: a byte of length follows, 0 of it ends the bundle; 0: a new address); without
        // bit 7 the distance's high byte comes first
        const l = (t >> 2) & 31;
        let p = x - 1, hi = 0;
        if (!(t & 0x80)) hi = byte(p--);
        if (!l) { x--; header(); literal = true; continue; }
        len = l === 1 ? byte(p--) : l;
        if (!len) end = p;
        else { dist = ((hi << 8) | byte(p--)) + 1; x = p; }
      }
      if (end >= 0) {
        // the end of the bundle: the drive's count is in byte 1, and the next bundle starts below
        // (the first block's count is for the first bundle that ends past it: the first may end in it)
        if (bi !== lastEnd) { if (bi !== due) return null; due = bi + sparkleCount(blocks[bi][1], code); checked++; }
        if (due === bi) final = true;
        lastEnd = bi;
        finish(bi);
        blk[1] = 0;
        x = end; at = bi;
        if (final && (x < 1 || !blk[x])) return { bundles, complete: true };
        // (the old blocks go on with the bits and the nibble the last bundle left)
        if (items !== 'old') startBits();
        header();
        literal = true;
        continue;
      }
      for (let k = 0; k < len; k++) {
        const src = (ptr + dist) & 0xffff;
        if (!known[src]) missing++;
        put(mem[src]);
      }
      literal = !bit();
    }
  } catch { return final ? { bundles, complete: true } : cut(); }
  return null;
}

/** The bundles of a Sparkle disk side; null when it is not one this reads. */
export function readSparkleDisk(disk: Uint8Array): SparkleDisk | null {
  const image = diskSectors(disk);
  const tracks = SIZES[image.length];
  if (!tracks) return null;
  const sec = (t: number, s: number) => { const o = sectorOffset(t, s, tracks); return image.subarray(o, o + 256); };
  // the drive code (18/11-18/15, or 18/2, 6, 10, 14, 18 as Lethargy's has it; Sparkle 3 has it elsewhere on track 18):
  // its sector walk's interleave, from its zero page in 18/14 (the table where the walk's setup takes it, else at
  // $4f + the sectors on a track, where most versions keep it)
  const track18 = new Uint8Array(sectorsOnTrack(18) * 256);
  for (let s = 0; s < sectorsOnTrack(18); s++) track18.set(sec(18, s), s * 256);
  const w = find(track18, WALK_SETUP);
  const zpPage = sec(18, 14), SPT = [21, 19, 18, 17];
  const tables = w >= 0 ? [track18[w + 1]] : [0x4f];
  // the kinds of blocks and counts: one that unpacks to the end of the side, else the one that unpacks most bundles
  type Try = { got: NonNullable<ReturnType<typeof unpackBlocks>>; items: SparkleItems; counts: SparkleCountCode; il: [number, number, number, number]; order: [number, number][] };
  let best: Try | null = null;
  for (const table of tables) {
    const il = SPT.map(spt => (0x100 - zpPage[(table + spt) & 0xff]) & 0xff) as [number, number, number, number];
    if (il.some((v, i) => v < 1 || v >= SPT[i])) continue;
    const order = sparkleBlockOrder(tracks, il);
    const blocks = order.map(([t, s]) => sec(t, s));
    for (const [i, c] of [['f8', 'bits'], ['84', 'eor'], ['84', 'bits'], ['f8', 'eor'], ['old', 'raw'], ['old', 'bits'], ['old', 'eor']] as const) {
      const r = unpackBlocks(blocks, i, c);
      if (!r?.bundles.length) continue;
      if (!best || (r.complete && !best.got.complete) || (r.complete === best.got.complete && r.bundles.length > best.got.bundles.length)) best = { got: r, items: i, counts: c, il, order };
      if (r.complete) break;
    }
    if (best?.got.complete) break;
  }
  if (!best) return null;
  const { items, counts, il, order } = best, got = best.got.bundles, complete = best.got.complete;
  const all = got;
  const bundles = got.map((u, n): SparkleBundle => ({
    n, track: order[u.at][0], sector: order[u.at][1], blocks: n === 0 ? u.last + 1 : u.last - all[n - 1].last, chunks: u.chunks, missing: u.missing,
  }));

  // the boot program: the loader's zero page and where it goes after the first bundle
  const img = parseD64(image);
  const bootFile = img.files.find(f => f.type === 'PRG' && f.blocks > 0 && f.track > 0) ?? null;
  let start: Addr | null = null, zp: number | null = null, api: SparkleDisk['api'] = null;
  if (bootFile) {
    try {
      const prg = readD64File(image, bootFile), load = prg[0] | (prg[1] << 8), body = prg.subarray(2);
      // the resident part, $0160-$02ff: two pages copied (to $0160 and $0200), or the old one's three halves (to
      // $0180, $0200 and $0280)
      const res = new Uint8Array(0x1a0);
      const at = (c: number, o: number) => ((body[c + o] | (body[c + o + 1] << 8)) - load) & 0xffff;
      const c = find(body, RESIDENT_COPY), old = c < 0 ? find(body, RESIDENT_COPY_OLD) : -1;
      if (c >= 0) {
        res.set(body.subarray(at(c, 1), at(c, 1) + 0x100), 0);
        res.set(body.subarray(at(c, 7), at(c, 7) + 0x100), 0xa0);
      } else if (old >= 0) [0x20, 0xa0, 0x120].forEach((to, k) => res.set(body.subarray(at(old, 6 * k + 1), at(old, 6 * k + 1) + 0x80), to));
      if (c >= 0 || old >= 0) {
        const s = find(res, STORE);
        if (find(res, UNPACKER[items]) >= 0 && s >= 0) zp = res[s + 1];
        const next = LOAD_NEXT.map(q => find(res, q)).find(a => a >= 0) ?? -1;
        // the call that sends an index stores it in the loader's third zero page byte first
        if (next >= 0 && zp != null && res[0] === 0x85 && res[1] === zp + 2) api = { next: 0x160 + next, send: 0x160 };
        // the old one goes on where the last bundle ended from the bits and the place it keeps in its first two
        // instructions: lda #bits / ldx #place / bne
        else if (old >= 0 && res[0x20] === 0xa9 && res[0x22] === 0xa2 && res[0x24] === 0xd0) api = { next: 0x180, send: null };
      }
      const f = find(body, FIRST_LOAD);
      if (f >= 0) start = (((body[f + 1] << 8) | body[f + 4]) + 1) & 0xffff;
    } catch { /* a broken boot program: no start */ }
  }
  // the directory: each bundle's entry points at the block it starts in, and where in it
  const dir = new Uint8Array(512);
  dir.set(sec(18, 17), 0); dir.set(sec(18, 18), 256);
  const walkOf = new Map<number, number[]>();
  for (const [t, s] of order) walkOf.set(t, [...(walkOf.get(t) ?? []), s]);
  const indexed = bundles.slice(0, 128).every((b, i) => {
    const t = sparkleCount(dir[4 * i], counts), walk = walkOf.get(t), left = sparkleCount(dir[4 * i + 2], counts);
    return t === b.track && !!walk && walk[0] === sparkleCount(dir[4 * i + 1], counts) && walk[walk.length - left] === b.sector;
  });
  const bam = sec(18, 0);
  // (the old disks keep other bytes there)
  const side = items === 'old' ? 0 : sparkleCount(bam[0xff], counts), next = items === 'old' ? 0 : sparkleCount(bam[0xfe], counts);
  return {
    bundles, items, counts, complete, start, il, zp, side: side > 0 && side < 64 ? side : null, next: next > 0 && next < 64 ? next : null,
    blocks: got[got.length - 1].last + 1, boot: bootFile?.name ?? null, header: img.name, id: petsciiName(bam.subarray(0xa2, 0xa7)).trim(), tracks, indexed, api,
  };
}

const hx = (v: number, w: number) => v.toString(16).padStart(w, '0');

/** A chunk's file name: the bundle and the address (the real names are not on the disk). */
export const sparkleChunkName = (b: Pick<SparkleBundle, 'n'>, c: Pick<SparkleChunk, 'start'>): string => `bundle${hx(b.n, 2)}_${hx(c.start, 4)}.prg`;

/** A chunk as a PRG: its address, then its bytes. */
export function sparkleChunkPrg(c: SparkleChunk): Uint8Array {
  const out = new Uint8Array(c.bytes.length + 2);
  out[0] = c.start & 0xff; out[1] = c.start >> 8;
  out.set(c.bytes, 2);
  return out;
}

/** The loader script as Sparkle reads it: the disk's entries, then a paragraph per bundle and a File line per chunk
 *  (its PRG file, `*` when it goes under the I/O area). Sparkle ignores lines it does not know, so the notes are lines
 *  of their own (after a File entry they would be its parameters). */
export function sparkleScript(disk: SparkleDisk, name: string): string[] {
  const n = disk.bundles.length, chunks = disk.bundles.reduce((k, b) => k + b.chunks.length, 0);
  const out = [
    `# Sparkle loader script, rebuilt by Mimir Studio from ${name} (Sparkle): ${n} bundle${n === 1 ? '' : 's'}, ${chunks} file${chunks === 1 ? '' : 's'}.`,
    '# A paragraph is a loader call. The file names are made up: each is a PRG of the bytes the bundle loads at that address.',
  ];
  if (disk.side != null) out.push(`# This is side ${disk.side}${disk.next != null ? `; the loader goes on with side ${disk.next}` : ', the last one'}.`);
  if (!disk.complete) out.push('# The last bundle of the side did not unpack: its last block counts on one more, where the blocks are not Sparkle blocks.');
  out.push(`Path:\t"${name.replace(/\.(d64|g64)$/i, '')}.d64"`, `Header:\t${disk.header}`, `ID:\t${disk.id}`);
  if (disk.boot != null) out.push(`Name:\t${disk.boot}`);
  if (disk.start != null) out.push(`Start:\t${hx(disk.start, 4)}`);
  if (disk.tracks === 40) out.push('Tracks:\t40');
  disk.il.forEach((v, i) => out.push(`IL${i}:\t${v}`));
  if (disk.zp != null) out.push(`ZP:\t${hx(disk.zp, 2)}`);
  for (const b of disk.bundles) {
    out.push('', `# bundle ${b.n}: from ${b.track}/${b.sector}, ${b.blocks} block${b.blocks === 1 ? '' : 's'}${b.missing ? `; ${b.missing} bytes could not be unpacked` : ''}`);
    for (const c of b.chunks) {
      out.push(`#   $${hx(c.start, 4)}-$${hx(c.end - 1, 4)}, ${c.end - c.start} bytes${c.io ? ', under the I/O area' : ''}`);
      out.push(`File:\t"${sparkleChunkName(b, c)}${c.io ? '*' : ''}"`);
    }
  }
  return out;
}
