/* The files of a BoozeLoader disk (spec 13.5d). BoozeLoader, HCL's loader for Booze Design (also in demos by Hitmen,
 * Genesis Project and others, from Edge of Disgrace in 2008 on), keeps its files out of the disk's directory. The C64
 * asks for a file by its number, and the drive looks its first sector up in a table on track 18; every file is an
 * ordinary chain of linked sectors, its load address first, packed with ByteBoozer (HCL's packer) so that it unpacks in
 * place while it loads. Its oldest disks have no table: the program sends the file's track and sector itself.
 *
 * What is on the disk, read from the disks themselves (the loader's source is not public):
 * - the drive code in 18/18, 18/15 and 18/12, which the drive reads itself (an M-E of 39 bytes has the DOS read them
 *   with its job queue and start them): 18/18 starts with `tsx / stx $04xx` and calls `jsr $f50a / bvc *`;
 * - the side in 18/0 byte $ff ('1', '2'; Edge of Disgrace's boot disk '0'), which the C64 waits for with a number from
 *   $80 up ($b1: side 1);
 * - the file table, 2 bytes (track, sector) per file number, in 18/9 (18/6 on Edge of Disgrace), read by the drive
 *   after the side; the drive code sets it (`ldx #9 / stx $0f`). A second side may have no drive code, only the table;
 * - each file: a chain of sectors (the next track and sector first, the last one's byte 1 the index of its last byte),
 *   then the load address and the packed bytes.
 *
 * ByteBoozer 2.0 (2016 on) writes where the file unpacks to (2 bytes), then the stream. Bits come from the top of a byte,
 * read when they are needed, between the other bytes. A type bit comes before a literal (0) or a match (1), but not
 * before the match that follows a literal shorter than 255. A length is 1 and, while a 1 comes, its next bit (an
 * interlaced Elias gamma, 8 bits at most): a literal is that many bytes, a match one byte more, 255 ends the stream. Two
 * bits more and whether the match is longer than 2 pick the offset's width: 3, 6, 8 or 10 bits after a match of 2, else
 * 4, 7, 10 or 13. Under 8 bits the offset - 1 is its bits inverted; from 8 its high bits come as they are, then its low
 * byte inverted.
 *
 * ByteBoozer 1.x (to 2015) writes a first byte of bits (already shifted, as the decruncher keeps them), where the file
 * unpacks to, then the stream: literals and matches as above, but the type bit before every literal of 255 and match
 * after one, a match's length the length + 1 (256 ends), and its offset built from 2 bits of prefix: 4, 2, 2 or 2 bits
 * after a match of 2, 5, 2, 2 or 3 after a longer one, each further group shifted on after adding 1. */
import type { Addr } from '../types';
import { parseD64, petsciiName, sectorOffset, sectorsOnTrack } from './d64';

/** the packer: ByteBoozer 1.x or 2.0 */
export type BoozeCruncher = 'b1' | 'b2';

export interface BoozeUnpacked { start: Addr; end: Addr; bytes: Uint8Array }

export interface BoozeFile {
  /** its number in the file table (from 0), as the program asks for it; null on a disk without a table */
  n: number | null;
  /** its first sector, and how many it has */
  track: number; sector: number; sectors: number;
  /** where the loader puts it (its load address), and its bytes after the load address as they are on the disk (`end`
   *  at most $10000) */
  load: Addr; end: Addr; bytes: Uint8Array;
  /** more bytes than memory holds from its load address: the program takes it in pieces (Edge of Disgrace has one) */
  long: boolean;
  /** what it unpacks to; null: not packed with the disk's ByteBoozer */
  unpacked: BoozeUnpacked | null;
}

export interface BoozeDisk {
  /** the sector of track 18 that holds the file table (9, or 6 on Edge of Disgrace); null: none, the program names
   *  each file's track and sector */
  table: number | null;
  /** the side the C64 waits for (18/0 byte $ff, '0'-'9'); null: none */
  side: number | null;
  /** the drive code is on the disk (18/18, 18/15 and 18/12); a second side can do without it */
  driveCode: boolean;
  /** the packer that unpacks the disk's files; null when none does */
  cruncher: BoozeCruncher | null;
  files: BoozeFile[];
  /** the header and id */
  header: string; id: string;
  /** the program in the directory that starts it all */
  boot: string | null;
}

const SIZES: Record<number, 35 | 40> = { 174848: 35, 175531: 35, 196608: 40, 197376: 40 };

type Pat = (number | null)[];
const at = (buf: Uint8Array, p: Pat, from = 0, to = buf.length): number => {
  outer: for (let i = from; i + p.length <= to; i++) { for (let k = 0; k < p.length; k++) if (p[k] != null && buf[i + k] !== p[k]) continue outer; return i; }
  return -1;
};
/** the job code's start (tsx / stx $04xx) and the drive's bit receive (lsr / lsr / lsr / tya / ror / bcc) */
const JOB: Pat = [0xba, 0x8e, null, 0x04], GCR_WAIT: Pat = [0x20, 0x0a, 0xf5, 0x50, 0xfe], RECEIVE: Pat = [0x4a, 0x4a, 0x4a, 0x98, 0x6a, 0x90];

/** A stream's bits, as both ByteBoozers keep them: shifted out of the top, the next byte read when the last bit is used
 *  (a 1 shifted in from the bottom marks the end). */
class Bits {
  constructor(private readonly mem: Uint8Array, public src: number, private readonly end: number, private bits: number) {}
  byte(): number { if (this.src >= this.end) throw new RangeError('past the end'); return this.mem[this.src++]; }
  bit(): number {
    const c = this.bits >> 7;
    this.bits = (this.bits << 1) & 0xff;
    if (this.bits) return c;
    const b = this.byte();
    this.bits = ((b << 1) | 1) & 0xff;
    return b >> 7;
  }
  /** 1, then while a 1 comes its next bit, up to 8 bits */
  length(): number { let n = 1; while (this.bit()) { n = (n << 1) | this.bit(); if (n & 0x80) break; } return n; }
}

/** the offset widths of ByteBoozer 2 as its decruncher keeps them: the leading 1s count the bits to read */
const B2_TABLE = [0xdf, 0xfb, 0x00, 0x80, 0xef, 0xfd, 0x80, 0xf0];

/** A ByteBoozer 2 file unpacked, read from its place in memory (writing may reach the bytes it reads); null when it is
 *  not one. `data` starts with where it unpacks to. */
export function unpackByteBoozer2(data: Uint8Array, load: Addr): BoozeUnpacked | null {
  if (data.length < 3 || load + data.length > 0x10000) return null;
  const mem = new Uint8Array(0x10000);
  mem.set(data, load);
  const start = data[0] | (data[1] << 8), end = load + data.length;
  const s = new Bits(mem, load + 2, end, 0x80);
  let dst = start;
  try {
    for (let match = !!s.bit(); ; match = !!s.bit()) {
      if (!match) {
        const n = s.length();
        for (let i = 0; i < n; i++, dst++) { if (dst > 0xffff) return null; mem[dst] = s.byte(); }
        if (n === 255) continue;
      }
      const n = s.length();
      if (n === 255) return end - s.src <= 1 ? { start, end: dst, bytes: mem.slice(start, dst) } : null;
      let v = B2_TABLE[(n >= 2 ? 4 : 0) | (s.bit() << 1) | s.bit()], hi: number, lo: number;
      if (v === 0) { hi = 0xff; lo = s.byte(); }
      else {
        let out: number;
        do { out = v >> 7; v = ((v << 1) | s.bit()) & 0xff; } while (out);
        if (v & 0x80) { hi = 0xff; lo = v; } else { hi = v ^ 0xff; lo = s.byte(); }
      }
      const offset = 0x10000 - ((hi << 8) | lo);
      if (offset > dst - start) return null;
      for (let i = 0; i <= n; i++, dst++) { if (dst > 0xffff) return null; mem[dst] = mem[dst - offset]; }
    }
  } catch { return null; }
}

/** the bits of each group of a ByteBoozer 1 offset, by its prefix (0-3 after a match of 2) */
const B1_TABLE = [4, 2, 2, 2, 5, 2, 2, 3];

/** A ByteBoozer 1.x file unpacked, read from its place in memory; null when it is not one. `data` starts with its
 *  first byte of bits, then where it unpacks to. */
export function unpackByteBoozer1(data: Uint8Array, load: Addr): BoozeUnpacked | null {
  if (data.length < 4 || load + data.length > 0x10000) return null;
  const mem = new Uint8Array(0x10000);
  mem.set(data, load);
  const start = data[1] | (data[2] << 8), end = load + data.length;
  const s = new Bits(mem, load + 3, end, data[0]);
  let dst = start;
  try {
    for (let match = !!s.bit(); ; match = !!s.bit()) {
      for (;;) {
        const n = s.length();
        if (!match) {
          for (let i = 0; i < n; i++, dst++) { if (dst > 0xffff) return null; mem[dst] = s.byte(); }
          if (n === 255) break;
          match = true;
          continue;
        }
        const len = n + 1;
        if (len === 256) return s.src === end ? { start, end: dst, bytes: mem.slice(start, dst) } : null;
        let p = (len >= 3 ? 4 : 0) | (s.bit() << 1) | s.bit(), offset = 0;
        for (;;) {
          for (let i = 0; i < B1_TABLE[p]; i++) offset = ((offset << 1) | s.bit()) & 0xffff;
          if (!(p-- & 3)) break;
          offset = (offset + 1) & 0xffff;
        }
        if (!offset || offset > dst - start) return null;
        for (let i = 0; i < len; i++, dst++) { if (dst > 0xffff) return null; mem[dst] = mem[dst - offset]; }
        break;
      }
    }
  } catch { return null; }
}

const unpackers: Record<BoozeCruncher, (data: Uint8Array, load: Addr) => BoozeUnpacked | null> = { b1: unpackByteBoozer1, b2: unpackByteBoozer2 };

interface Chain { track: number; sector: number; sectors: number; data: Uint8Array; used: number[] }

/** The files of a BoozeLoader disk; null when it is not one. */
export function readBoozeDisk(image: Uint8Array): BoozeDisk | null {
  const tracks = SIZES[image.length];
  if (!tracks) return null;
  const off = (t: number, s: number) => sectorOffset(t, s, tracks);
  const sec = (t: number, s: number) => image.subarray(off(t, s), off(t, s) + 256);
  const valid = (t: number, s: number) => t >= 1 && t <= tracks && s < sectorsOnTrack(t);
  /** a file's chain: its sectors in order, its bytes; null when it breaks off or loops */
  const chain = (t: number, s: number): Chain | null => {
    const parts: Uint8Array[] = [], used: number[] = [], seen = new Set<number>();
    const first = { track: t, sector: s };
    for (;;) {
      if (!valid(t, s) || seen.has(off(t, s))) return null;
      seen.add(off(t, s)); used.push(off(t, s));
      const b = sec(t, s);
      if (!b[0]) {
        if (b[1] < 1) return null;
        parts.push(b.subarray(2, b[1] + 1));
        break;
      }
      parts.push(b.subarray(2));
      [t, s] = [b[0], b[1]];
    }
    const data = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let k = 0;
    for (const p of parts) { data.set(p, k); k += p.length; }
    return { ...first, sectors: used.length, data, used };
  };

  // the drive code: 18/18 starts the job code, and the three sectors hold its bit receive
  const code = [18, 15, 12].map(s => sec(18, s));
  const all = new Uint8Array(768);
  code.forEach((c, i) => all.set(c, i * 256));
  const driveCode = at(code[0], JOB, 0, 4) === 0 && at(code[0], GCR_WAIT, 2, 16) >= 0 && at(all, RECEIVE) >= 0;
  // the table's sector, as the drive code sets it (ldx #s / stx $0f, lda #s / sta $0f); none: the program names
  // track and sector
  let tables: number[] = [];
  if (driveCode) {
    for (let i = 0; i + 4 <= all.length; i++) {
      const op = all[i], v = all[i + 1];
      if (((op === 0xa2 && all[i + 2] === 0x86) || (op === 0xa9 && all[i + 2] === 0x85)) && all[i + 3] === 0x0f && v > 0 && v < sectorsOnTrack(18)) tables.push(v);
    }
    tables = [...new Set(tables)];
  } else tables = [9, 6];

  const bam = sec(18, 0);
  const img = parseD64(image);
  // the directory's sectors and its files' chains are not BoozeLoader's
  const dirSectors = new Set<number>();
  for (let [t, s] = [18, 1], n = 0; t === 18 && n < 19 && valid(t, s) && !dirSectors.has(off(t, s)); n++) { dirSectors.add(off(t, s)); [t, s] = [sec(t, s)[0], sec(t, s)[1]]; }
  const text = (a: number, n: number) => petsciiName(bam.subarray(a, a + n)).trim();
  const sideByte = bam[0xff];
  const side = sideByte >= 0x30 && sideByte <= 0x39 ? sideByte - 0x30 : null;

  /** the files and the packer that unpacks most of them */
  const finish = (table: number | null, chains: { n: number | null; c: Chain }[]): { disk: BoozeDisk; score: number } | null => {
    const files: BoozeFile[] = [];
    for (const { n, c } of chains) {
      if (c.data.length < 2) return null;
      const load = c.data[0] | (c.data[1] << 8), bytes = c.data.slice(2);
      files.push({ n, track: c.track, sector: c.sector, sectors: c.sectors, load, end: Math.min(0x10000, load + bytes.length), bytes, long: load + bytes.length > 0x10000, unpacked: null });
    }
    let cruncher: BoozeCruncher | null = null, best = 0;
    for (const k of ['b2', 'b1'] as const) {
      const got = files.map(f => unpackers[k](f.bytes, f.load));
      const score = got.filter(Boolean).length;
      if (score > best) { best = score; cruncher = k; files.forEach((f, i) => { f.unpacked = got[i]; }); }
    }
    const boot = img.files.find(f => f.type === 'PRG' && f.blocks > 0 && f.track !== 0);
    return { score: best, disk: { table, side, driveCode, cruncher, files, header: text(0x90, 16), id: text(0xa2, 5), boot: boot?.name ?? null } };
  };

  let best: { disk: BoozeDisk; score: number } | null = null;
  for (const ts of tables) {
    if (dirSectors.has(off(18, ts))) continue;
    const t = sec(18, ts), chains: { n: number; c: Chain }[] = [];
    let ok = true;
    for (let n = 0; n < 128 && t[2 * n]; n++) {
      const c = chain(t[2 * n], t[2 * n + 1]);
      if (!c) { ok = false; break; }
      chains.push({ n, c });
    }
    // (a disk with the drive code and an empty table is one with no files: Edge of Disgrace's boot disk)
    if (!ok || (!chains.length && !driveCode)) continue;
    const got = finish(ts, chains);
    if (got && (!best || got.score > best.score)) best = got;
  }
  if (!best && driveCode && !tables.length) {
    // no table: every chain no other one links to, in the BAM's used sectors, but the directory's and track 18's
    const free = (t: number, s: number) => t <= 35 && !!(bam[4 * t + 1 + (s >> 3)] & (1 << (s & 7)));
    const linked = new Set<number>(), taken = new Set<number>();
    for (const f of img.files) { const c = valid(f.track, f.sector) ? chain(f.track, f.sector) : null; c?.used.forEach(o => taken.add(o)); }
    const used: [number, number][] = [];
    for (let t = 1; t <= Math.min(tracks, 35); t++) {
      if (t === 18) continue;
      for (let s = 0; s < sectorsOnTrack(t); s++) {
        if (free(t, s) || taken.has(off(t, s))) continue;
        used.push([t, s]);
        const b = sec(t, s);
        if (b[0] && valid(b[0], b[1])) linked.add(off(b[0], b[1]));
      }
    }
    const chains = used.filter(([t, s]) => !linked.has(off(t, s))).map(([t, s]) => chain(t, s)).filter((c): c is Chain => !!c).map(c => ({ n: null, c }));
    if (chains.length) best = finish(null, chains);
  }
  // a disk with the drive code is one; without it, its files must unpack
  if (!best || (!driveCode && (best.score === 0 || best.score * 2 < best.disk.files.length))) return null;
  return best.disk;
}

const hx = (v: number, w: number) => v.toString(16).padStart(w, '0');

export const BOOZE_CRUNCHER: Record<BoozeCruncher, string> = { b1: 'ByteBoozer 1', b2: 'ByteBoozer 2' };

/** A file's name: its number (or track and sector) and where it unpacks to, or loads when it is not packed (the real
 *  names are not on the disk). */
export const boozeFileName = (f: BoozeFile): string =>
  `${f.n != null ? `file${hx(f.n, 2)}` : `t${f.track}s${f.sector}`}_${hx(f.unpacked?.start ?? f.load, 4)}.prg`;

/** The disk's files as text: a line each, after a header that says what the disk is. */
export function boozeFileList(disk: BoozeDisk, name: string): string[] {
  const n = disk.files.length;
  const out = [
    `; BoozeLoader files of ${name}, read by Mimir Studio: ${n} file${n === 1 ? '' : 's'}${disk.side != null ? ` on side ${disk.side}` : ''}${disk.cruncher ? `, packed with ${BOOZE_CRUNCHER[disk.cruncher]}` : ''}.`,
    disk.table != null
      ? `; The program loads a file by its number (lda #n / jsr loader); the table in 18/${disk.table} gives its first sector.`
      : '; The program loads a file by its track and sector (ldx #track / ldy #sector / lda #0 / jsr loader).',
    '; The names are made up: the number (or track and sector) and where the file unpacks to.',
  ];
  for (const f of disk.files) {
    const u = f.unpacked;
    const what = u ? `, unpacks to $${hx(u.start, 4)}-$${hx(u.end - 1, 4)} (${u.end - u.start} bytes)` : f.long ? `, ${f.bytes.length} bytes, more than memory holds (taken in pieces)` : ', not packed';
    out.push(`${boozeFileName(f).padEnd(18)} ; ${f.track}/${f.sector}, ${f.sectors} sector${f.sectors === 1 ? '' : 's'}, loads at $${hx(f.load, 4)}-$${hx(f.end - 1, 4)}${what}`);
  }
  return out;
}
