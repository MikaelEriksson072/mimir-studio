/* The files of a disk for Krill's loader (spec 13.5k). Krill's loader (Krill/Plush) loads ordinary files of the disk's
 * directory, each a chain of linked sectors with its load address first: a part loads one by its name (`ldx #<name /
 * ldy #>name / jsr load`, the name's bytes up to a 0) or, with an empty name (a 0 alone), the next file in the
 * directory. There is no load script: the directory is the order, and the names are often lines of a dirart. What comes
 * closest to a script is the command line of cc1541, the disk builder that comes with the loader, which writes the
 * files in that order with those names.
 *
 * The loader unpacks a file while it loads, with the unpacker it was built with. This reads files packed with its ZX0,
 * as Artline Designs' Nightfall (2024) has them; it was read from the resident part of that demo's loader, and every
 * file the demo loaded in Sindri is byte for byte what this unpacks:
 * - where the file unpacks to (2 bytes, the high byte first), then a zx0 stream: a literal (Elias-gamma length, then
 *   the bytes); after a literal a match with the last offset (0) or a new one (1); after a match a literal (0) or a new
 *   match (1);
 * - numbers are interlaced Elias gamma (a 0 before each further bit, a 1 at the end), 8 low bits first from 256 on;
 *   bits come from the bottom of a byte, read when they are needed;
 * - a new offset is a number (its high part + 1) and a byte (7 low bits, then 1 for length 2, else the length - 1 follows
 *   without its first 0); 256 ends the stream. It is dali's stream (Bitfire 1.x, c64/bitfire-disk.ts) with the bits
 *   the other way round in a byte and the address the other way round;
 * - a file packed in place has no end: it ends where its writing reaches its reading after a match, the rest being the
 *   bytes as they are (a few: less than a quarter of the file is taken as one, as other bytes that unpack so by chance
 *   end after a few bytes, the rest of them left).
 * Older builds of the loader (version 146, 2015) unpack with Doynax LZ (Doynamite) instead, as GoatLight (Fairlight,
 * Noice and Offence, 2015) has them: read from the loader's doynaxdecomp.s, and every packed file of both of GoatLight's
 * sides is byte for byte what the demo's own unpacker (from its boot, run on Sindri's Cpu) makes of it:
 * - where the file unpacks to (2 bytes, the low byte first), then the stream; bits come from the top of a byte, read
 *   when they are needed, and the bytes of literals and far offsets are taken from the stream between them;
 * - a 1 starts a literal: its length in interlaced Elias gamma (a 0 before each further bit, a 1 at the end; 0 is 256),
 *   then its bytes, the last of them first; a literal of 256 is followed by a 1 or 0 again, any other by a match;
 * - a match: 3 bits (the first 1 for a match of 2 bytes, then which of 4 offset ranges), the offset (in bits, or high
 *   bits and a byte), then for a longer match its length - 1 in gamma (a data bit, then a 0 to go on or 1 to stop);
 *   a length of 256 ends the stream;
 * - the loader unpacks in place, reading the stream where the file loaded: when writing reaches bytes of the stream
 *   that are still to be read (GoatLight's C1 has three), it reads what it wrote, and so does this.
 * Such a file has to end where its stream ends.
 * Revision 166 (2018) built with ChristopherJam's TinyCrunch, as Fossil's Space Beer (2019) has it, unpacks with a
 * resident routine of its own (at $0374 there); read from that routine, and every file of the disk is byte for byte what
 * the demo's own routine makes of it (run on Sindri's Cpu), and what it unpacked when Sindri ran the demo from its disk:
 * - the last byte the file unpacks to, then where it unpacks to less 1 (2 bytes, the low byte first), then the stream
 *   of bytes, a token each and no bits:
 * - $00 ends it (the last byte then goes after the rest); $01-$7f a copy of (token >> 3) + 2 bytes from up to 2048 back:
 *   $800 less the token's 3 low bits and the next byte; $80-$bf a literal of token - $7f bytes; $c0-$ff a copy of 2
 *   bytes from $ff - token back (1-63);
 * - it unpacks in place, reading the stream where the file loaded: when writing reaches bytes of the stream still to be
 *   read, it reads what it wrote (Space Beer's J reads its end from a 0 it wrote 9 bytes before the file's own end).
 * Such a file ends where its stream ends, or its unpacking ends past it, over its last bytes (the end a 0 it wrote); it
 * copies only bytes it unpacked, as TinyCrunch packs a file on its own; and a literal of fewer than 64 bytes is never
 * followed by another, as a packer makes them one. Any byte being a token, other bytes unpack so now and then without
 * those rules (889 disks of the reference archive did, Activa's Ghostbusters Demo among them).
 * Builds with Exomizer (version 146 and older, as Triad's Continuum, 2014, and Fairlight's and Onslaught's demos of
 * 2010-2016 have them; later ones with Exomizer 3, as Still Standing) read `exomizer mem -f` files: the load address,
 * where the file unpacks to (the high byte first), then a stream of protocol 0, 7 or 39, unpacked forwards while the
 * blocks come in, reading it where the file loaded (Brokkr's reader; in place only with its safety margin). Version 146
 * and older can also be built to load a file by its track and sector (`ldx #track / ldy #sector / jsr loadcompd`, the
 * carry set to load to the address in zero page): the calls are read from the files' own code, with tables of tracks
 * and sectors, and a chain they load that is not in the directory becomes a file of its own. Continuum's 26 packed files
 * are byte for byte what its own resident unpacker makes of them (run on Sindri's Cpu). Builds with other unpackers
 * (Pucrunch, ByteBoozer, Levelcrush) are not read here.
 * A disk counts as one when at least two of its files unpack so, twice as many as the files that neither unpack nor are
 * BASIC programs at $0801 (the boot program loads with LOAD; those are not tried): a disk packed another way has a file
 * that happens to unpack now and then. */
import { readStream } from '@mimir/brokkr';
import type { Addr } from '../types';
import { loaderCodeIn } from '../analyze/loaders';
import { diskSectors, parseD64, petsciiName, sectorOffset, sectorsOnTrack, type D64FileType } from './d64';

/** the unpackers this reads files of: the loader's ZX0 (version 184 on), Doynax LZ (version 146), Exomizer (version
 *  146 and older, and later builds with Exomizer 3) and TinyCrunch (revision 166) */
export type KrillPacker = 'zx0' | 'doynax' | 'tinycrunch' | 'exomizer';
/** each packer as the script and the app name it, and the extension of a file packed with it */
export const KRILL_PACKER: Record<KrillPacker, { name: string; ext: string }> = {
  zx0: { name: 'its ZX0', ext: 'zx0' },
  doynax: { name: 'Doynax LZ (version 146)', ext: 'dnx' },
  tinycrunch: { name: 'TinyCrunch', ext: 'tc' },
  exomizer: { name: 'Exomizer', ext: 'exo' },
};
/** the Exomizer streams a disk's files can be: protocol 0 (Exomizer 2, and 3 with -P0), 7 and 39 (Exomizer 3), the
 *  ones met on the disks of the reference archive */
export const KRILL_EXOMIZER_PROTOCOLS = [0, 7, 39] as const;

/** the packer of a disk's files as the app names it: Exomizer with its version and protocol */
export const krillPackerName = (d: Pick<KrillDisk, 'packer' | 'protocol'>): string =>
  d.packer !== 'exomizer' ? KRILL_PACKER[d.packer].name : d.protocol ? `Exomizer 3 (protocol ${d.protocol})` : 'Exomizer 2';

export interface KrillUnpacked {
  start: Addr; end: Addr; bytes: Uint8Array;
  /** packed in place: it ends where it started to be read */
  inplace: boolean;
  /** what it is packed with (when it is not the ZX0) */
  packer?: KrillPacker;
  /** bytes of its stream that the unpacking wrote over before it read them (Doynax LZ and TinyCrunch, unpacking in
   *  place) */
  overwritten?: number;
  /** Exomizer: the stream's protocol */
  protocol?: number;
}

export interface KrillFile {
  /** its directory entry (from 0); -1: it is not in the directory, a chain of sectors the program loads by its track
   *  and sector */
  entry: number;
  /** where the loader puts it (its load address), and its bytes after the load address as they are on the disk (`end`
   *  at most $10000) */
  load: Addr; end: Addr; bytes: Uint8Array;
  /** its sectors, in the order of its chain */
  sectors: [number, number][];
  /** what it unpacks to (the disk's packer); null: not packed so */
  unpacked: KrillUnpacked | null;
  /** a BASIC program at $0801 (a line, then a token), such as the boot program: it loads with LOAD, not with the
   *  loader, and is not tried as a packed file */
  basic: boolean;
}

export interface KrillEntry {
  /** its place in the directory (from 0) */
  n: number;
  /** the name as the 1541 lists it, and its 16 bytes as stored ($a0-padded) */
  name: string; raw: Uint8Array;
  type: D64FileType; closed: boolean; locked: boolean;
  /** the blocks the directory shows (a dirart's lines often show 0) */
  blocks: number;
  /** where it starts on the disk (0/0: nowhere, a line of a dirart) */
  track: number; sector: number;
  /** its file; null: it has none of its own (a line of a dirart, or one that starts where an earlier entry does) */
  file: KrillFile | null;
  /** it starts where this earlier entry does (a loop file); null: it does not */
  same: number | null;
}

/** A call of the loader in the code of a file of the disk that names a file of the disk (spec 13.5k). */
export interface KrillCall {
  /** the file whose code holds it (an index into `files`), where its first instruction is and where its jsr (or jmp)
   *  is */
  in: number; at: Addr; jsr: Addr;
  /** the routine of the loader it calls */
  to: Addr;
  /** how it names the file: its track and sector in X and Y (`ldx #track / ldy #sector`), an entry of a table of
   *  tracks and sectors (`ldy table+1,x / lda table,x / tax`), or a pointer to its name in X and Y */
  how: 'ts' | 'table' | 'name';
  /** the file it loads (an index into `files`) */
  file: number;
  /** a table's call: where its tracks are, and the entry (from 0) */
  table?: Addr; entry?: number;
  /** where the call has the file go instead of its load address: an address it stores in zero page right before it,
   *  with the carry set (Krill's loader of version 146 loads there then); null: it does not say */
  dest: Addr | null;
}

export interface KrillDisk {
  /** the packer of its files: the loader's ZX0, Doynax LZ (version 146), Exomizer or TinyCrunch */
  packer: KrillPacker;
  /** Exomizer: its streams' protocol (0: Exomizer 2); null for the other packers */
  protocol: number | null;
  /** what shows it is a disk for Krill's loader: the loader's own code (or name) in one of its files, as it is or
   *  unpacked, or only its files, packed as the loader reads them (Exomizer's `mem -f` files other loaders read too;
   *  the boot that installs the loader is mostly packed, so its code is not to be seen) */
  found: 'code' | 'files';
  /** how the program names a file: by its name (the next with an empty one: the directory is the order), or by its
   *  track and sector (version 146 and older built so, as Triad's Continuum is), read from the calls in the files; null
   *  when no call says and the build can be either (Exomizer: version 146 and older) */
  by: 'name' | 'ts' | null;
  /** the directory, entry by entry */
  entries: KrillEntry[];
  /** the entries' files, in the directory's order: the order the loader loads them in, the next after the last; then
   *  the files outside the directory that a call loads by their track and sector (entry -1) */
  files: KrillFile[];
  /** the loader's calls read from the code of the files, by file and address */
  calls: KrillCall[];
  /** the header and the 5 characters of the id ($a2-$a6 of the BAM), as listed and as stored */
  header: string; id: string; headerRaw: Uint8Array; idRaw: Uint8Array;
  /** the interleave the files' sector chains step by on a track (the most common one; cc1541's default is 10) */
  interleave: number;
  tracks: number;
}

/** A file packed with Krill's ZX0 unpacked, read from its place in memory (writing may reach the bytes it reads); null
 *  when it is not one. `data` starts with where it unpacks to. */
export function unpackKrillZx0(data: Uint8Array, load: Addr): KrillUnpacked | null {
  if (data.length < 3 || load + data.length > 0x10000) return null;
  const mem = new Uint8Array(0x10000);
  mem.set(data, load);
  const end = load + data.length, start = (data[0] << 8) | data[1];
  let src = load + 2, dst = start, left = 0, bits = 0, last = 1;
  const byte = () => { if (src >= end) throw new RangeError('past the end'); return mem[src++]; };
  const bit = () => { if (!left) { bits = byte(); left = 8; } const b = bits & 1; bits >>= 1; left--; return b; };
  const elias = (skip: boolean) => {
    const raw: number[] = [];
    while (skip || !bit()) { skip = false; raw.push(bit()); if (raw.length > 16) throw new RangeError('no number'); }
    if (raw.length < 8) return raw.reduce((v, b) => (v << 1) | b, 1);
    // from 256 on the 8 low bits come first
    return (raw.slice(8).reduce((v, b) => (v << 1) | b, 1) << 8) | raw.slice(0, 8).reduce((v, b) => (v << 1) | b, 0);
  };
  const copy = (n: number) => { for (let i = 0; i < n; i++, dst++) { if (dst > 0xffff) throw new RangeError('past $ffff'); mem[dst] = mem[dst - last]; } };
  // (a file packed in place leaves a few bytes as they are; other bytes that happen to unpack in place, such as a file
  // whose first bytes are near its load address, leave nearly all of themselves)
  const done = (): KrillUnpacked | null => (4 * (end - src) < data.length ? { start, end, bytes: mem.slice(start, end), inplace: true } : null);
  try {
    let state: 'lit' | 'rep' | 'match' = 'lit';
    for (;;) {
      if (state === 'lit') {
        const n = elias(false);
        for (let i = 0; i < n; i++, dst++) { if (dst > 0xffff) return null; mem[dst] = byte(); }
        state = bit() ? 'match' : 'rep';
      } else if (state === 'rep') {
        copy(elias(false));
        if (dst === src) return done();
        state = bit() ? 'match' : 'lit';
      } else {
        const hi = elias(false);
        // 256 ends the stream (the unpacker keeps the low byte: 0)
        if ((hi & 0xff) === 0) return src === end ? { start, end: dst, bytes: mem.slice(start, dst), inplace: false } : null;
        const b = byte();
        const n = b & 1 ? 2 : elias(true) + 1;
        last = (((hi - 1) << 7) | (b >> 1)) + 1;
        copy(n);
        if (dst === src) return done();
        state = bit() ? 'match' : 'lit';
      }
    }
  } catch { return null; }
}

const DOYNAX_LENGTH = [0x1f, 0x03, 0x5f, 0x0b, 0x5f, 0x00, 0x07, 0x3f];
const DOYNAX_LOW = [0xfe, 0xee, 0x6e, 0x6e, 0xb6, 0xb6, 0xf6, 0xfe];
const DOYNAX_HIGH = [0, 0, 0x7f, 0x7b, 0x7e, 0xfe, 0, 0];

/** A file packed with Doynax LZ, as version 146 of Krill's loader unpacks it: in place, reading the stream where the
 *  file loaded; null when it is not one. `data` starts with where it unpacks to (the low byte first). */
export function unpackKrillDoynax(data: Uint8Array, load: Addr): KrillUnpacked | null {
  if (data.length < 3 || load + data.length > 0x10000) return null;
  const mem = new Uint8Array(0x10000);
  mem.set(data, load);
  const end = load + data.length, start = data[0] | (data[1] << 8);
  let src = load + 2, dst = start, buf = 0, left = 0, overwritten = 0;
  const byte = () => { if (src >= end) throw new RangeError('past the end'); return mem[src++]; };
  const bit = () => { if (!left) { buf = byte(); left = 8; } const b = buf >> 7; buf = (buf << 1) & 0xff; left--; return b; };
  const put = (a: Addr, v: number) => { if (a >= src && a < end && mem[a] !== v) overwritten++; mem[a] = v; };
  try {
    let literal = bit();
    for (;;) {
      if (literal) {
        // its length (0: 256), then its bytes, the last first
        let v = 1;
        while (!bit()) v = ((v << 1) | bit()) & 0x1ff;
        const n = (v & 0xff) || 256;
        if (dst + n > 0x10000) return null;
        for (let i = n - 1; i >= 0; i--) put(dst + i, byte());
        dst += n;
        if (n === 256) { literal = bit(); continue; }
      }
      // a match: 2 bytes or longer, and the offset's range; the offset in bits, or high bits and then a byte, worked
      // out as the unpacker's adds with carry do
      let y = (bit() << 2) | (bit() << 1);
      y |= bit();
      let a = DOYNAX_LENGTH[y], from: Addr;
      if (a) { let c: number; do { c = a >> 7; a = ((a << 1) | bit()) & 0xff; } while (!c); }
      if (!(a & 0x80)) {
        const s = byte() + DOYNAX_LOW[y] + 1, hi = s < 0x100 ? (a - 1) & 0xff : a;
        const lo = (s & 0xff) + (dst & 0xff) + 1, mid = (hi + DOYNAX_HIGH[y] + (lo >> 8)) & 0xff;
        from = (lo & 0xff) | (((mid + (dst >> 8) + 1) & 0xff) << 8);
      } else {
        const s = a + DOYNAX_LOW[y] + 1, lo = (s & 0xff) + (dst & 0xff) + (s >> 8);
        from = (lo & 0xff) | (((0xff + (dst >> 8) + (lo >> 8)) & 0xff) << 8);
      }
      let n = 1;
      if (y < 4) do n = ((n << 1) | bit()) & 0xff; while (!bit());
      // a match of 257 bytes ends the stream, which has to be where the file ends
      if (!n) return src === end ? { start, end: dst, bytes: mem.slice(start, dst), inplace: false, packer: 'doynax', overwritten } : null;
      if (dst + n + 1 > 0x10000) return null;
      for (let i = 0; i <= n; i++) put(dst + i, mem[(from + i) & 0xffff]);
      dst += n + 1;
      literal = bit();
    }
  } catch { return null; }
}

/** A file packed with TinyCrunch, as revision 166 of Krill's loader unpacks it: in place, reading the stream where the
 *  file loaded; null when it is not one. `data` starts with the last byte it unpacks to, then where it unpacks to less
 *  1 (the low byte first). */
export function unpackKrillTinyCrunch(data: Uint8Array, load: Addr): KrillUnpacked | null {
  if (data.length < 4 || load + data.length > 0x10000) return null;
  const mem = new Uint8Array(0x10000);
  mem.set(data, load);
  const end = load + data.length, last = data[0], start = (data[1] | (data[2] << 8)) + 1;
  let src = load + 3, dst = start, overwritten = 0;
  const byte = () => { if (src >= end) throw new RangeError('past the end'); return mem[src++]; };
  const put = (v: number) => {
    if (dst > 0xffff) throw new RangeError('past $ffff');
    if (dst >= src && dst < end && mem[dst] !== v) overwritten++;
    mem[dst++] = v;
  };
  // a copy takes bytes it unpacked, before where it writes
  const copy = (back: number, n: number) => {
    if (back < 1 || dst - back < start) throw new RangeError('before the start');
    for (let i = 0; i < n; i++) put(mem[dst - back]);
  };
  try {
    // a literal of fewer than 64 bytes is never followed by another (a packer makes them one), which bytes that are no
    // such file soon do
    let shortLiteral = false;
    for (;;) {
      const t = byte();
      if (!t) break;
      const literal = t >= 0x80 && t < 0xc0;
      if (literal && shortLiteral) return null;
      shortLiteral = literal && t < 0xbf;
      if (t < 0x80) { const lo = byte(); copy(0x800 - (((t & 7) << 8) | lo), (t >> 3) + 2); }
      else if (literal) for (let n = t - 0x7f; n > 0; n--) put(byte());
      else copy(0xff - t, 2);
    }
    // the end was the stream's last byte, or a 0 the unpacking wrote over the stream, going on past the file's end
    const wroteEnd = src - 1 >= start && src - 1 < dst;
    put(last);
    if (src !== end && !(wroteEnd && dst >= end)) return null;
  } catch { return null; }
  return { start, end: dst, bytes: mem.slice(start, dst), inplace: start < end && dst > load, packer: 'tinycrunch', overwritten };
}

/** A file packed with Exomizer as Krill's loader unpacks it (`exomizer mem -f`): where it unpacks to (the high byte
 *  first), then a stream of this protocol, unpacked forwards while it loads, reading it where the file loaded; null
 *  when it is not one that ends where the file does, or whose unpacking would write over bytes of its stream before
 *  they are read. */
export function unpackKrillExomizer(data: Uint8Array, load: Addr, protocol = 0): KrillUnpacked | null {
  if (data.length < 4 || load + data.length > 0x10000) return null;
  const start = (data[0] << 8) | data[1], end = load + data.length;
  let d: ReturnType<typeof readStream>;
  try { d = readStream(data.subarray(2), protocol, undefined, 0x10000); } catch { return null; }
  if (d.read !== data.length - 2 || !d.data.length || start + d.data.length > 0x10000) return null;
  // in place (its bytes reach where the stream is): the stream has to end far enough after them that writing never
  // reaches a byte still to be read (Brokkr's safety margin)
  const stop = start + d.data.length, inplace = start < end && stop > load + 2;
  if (inplace && end - stop < d.safety) return null;
  return { start, end: stop, bytes: d.data, inplace, packer: 'exomizer', protocol };
}

/** The most common value, the smallest of those as common; `none` for none. */
function mode(values: number[], none: number): number {
  const count = new Map<number, number>();
  for (const v of values) count.set(v, (count.get(v) ?? 0) + 1);
  let best = none, n = 0;
  for (const [v, c] of [...count].sort((a, b) => a[0] - b[0])) if (c > n) { best = v; n = c; }
  return best;
}

const UNPACK: Record<Exclude<KrillPacker, 'exomizer'>, (data: Uint8Array, load: Addr) => KrillUnpacked | null> = { zx0: unpackKrillZx0, doynax: unpackKrillDoynax, tinycrunch: unpackKrillTinyCrunch };

// ---- the calls of the loader ------------------------------------------------------------------------------------

/** what X or Y holds right before a call: a value, or a byte of a table at an index the code does not say */
export type KrillReg = { imm: number } | { table: Addr; by: 'x' | 'y' };

/** The registers right before a call of the loader, read from the straight run of code that sets them. */
export interface KrillRegs {
  /** where the run starts (a clc or sec right before it included) */
  at: Addr;
  x: KrillReg; y: KrillReg;
  /** the carry the run sets (null: it does not) */
  carry: 0 | 1 | null;
  /** with the carry set, an address the run stores in two bytes of zero page (`lda #lo / sta zp / lda #hi / sta zp+1`):
   *  where version 146 loads the file instead of its load address */
  dest: Addr | null;
}

type Val = { k: 'imm'; v: number } | { k: 'tab'; at: Addr; by: 'x' | 'y' } | { k: 'idx' } | null;

/** The registers after the code from `i` to `j` (exactly there), when it is only instructions that set X, Y and A
 *  from immediates and tables, store A in memory, set the carry or move A, X and Y between them; null otherwise. */
function runRegs(read: (a: Addr) => number | null, i: Addr, j: Addr): { x: Val; y: Val; carry: 0 | 1 | null; zp: Map<number, number> } | null {
  let x: Val = { k: 'idx' }, y: Val = { k: 'idx' }, a: Val = { k: 'idx' }, carry: 0 | 1 | null = null;
  const zp = new Map<number, number>();
  const idx = (r: Val) => r?.k === 'idx';
  /** abs,x or abs,y: a byte of the code's own when the index is known, else a table's at the index */
  const indexed = (w: Addr, r: Val, by: 'x' | 'y'): Val => {
    if (r?.k === 'imm') { const v = read((w + r.v) & 0xffff); return v == null ? null : { k: 'imm', v }; }
    return idx(r) ? { k: 'tab', at: w, by } : null;
  };
  let p = i;
  while (p < j) {
    const op = read(p), o1 = read(p + 1), o2 = read(p + 2);
    if (op == null) return null;
    const w = (o1 ?? 0) | ((o2 ?? 0) << 8);
    switch (op) {
      case 0xa2: if (o1 == null) return null; x = { k: 'imm', v: o1 }; p += 2; break;
      case 0xa0: if (o1 == null) return null; y = { k: 'imm', v: o1 }; p += 2; break;
      case 0xa9: if (o1 == null) return null; a = { k: 'imm', v: o1 }; p += 2; break;
      case 0x85: if (o1 == null) return null; if (a?.k === 'imm') zp.set(o1, a.v); else zp.delete(o1); p += 2; break;
      case 0x18: carry = 0; p++; break;
      case 0x38: carry = 1; p++; break;
      case 0xea: p++; break;
      case 0xaa: x = a; p++; break;
      case 0xa8: y = a; p++; break;
      case 0x8a: a = x; p++; break;
      case 0x98: a = y; p++; break;
      // an index doubled for a table of pairs
      case 0x0a: a = idx(a) ? a : a?.k === 'imm' ? { k: 'imm', v: (a.v << 1) & 0xff } : null; p++; break;
      case 0xbc: if (o2 == null) return null; y = indexed(w, x, 'x'); p += 3; break;
      case 0xbe: if (o2 == null) return null; x = indexed(w, y, 'y'); p += 3; break;
      case 0xbd: if (o2 == null) return null; a = indexed(w, x, 'x'); p += 3; break;
      case 0xb9: if (o2 == null) return null; a = indexed(w, y, 'y'); p += 3; break;
      case 0x8d: case 0x8e: case 0x8c: if (o2 == null) return null; p += 3; break;
      default: return null;
    }
  }
  return p === j ? { x, y, carry, zp } : null;
}

const reg = (v: Val): KrillReg | null => (v?.k === 'imm' ? { imm: v.v } : v?.k === 'tab' ? { table: v.at, by: v.by } : null);

/** The registers right before the jsr (or jmp) at `j`: the shortest straight run of code up to it (at most 24 bytes)
 *  that sets both X and Y, to values or from tables (both indexed by the same register); null when there is none. */
export function krillCallRegs(read: (a: Addr) => number | null, j: Addr): KrillRegs | null {
  for (let k = 2; k <= 24 && j - k >= 0; k++) {
    const i = j - k, r = runRegs(read, i, j);
    const x = r && reg(r.x), y = r && reg(r.y);
    if (!r || !x || !y || ('table' in x) !== ('table' in y) || ('table' in x && 'table' in y && x.by !== y.by)) continue;
    let at = i, carry = r.carry;
    // a clc or sec right before (version 146 loads with the carry clear, to where the program says with it set)
    const before = i > 0 ? read(i - 1) : null;
    if (carry == null && (before === 0x18 || before === 0x38)) { at = i - 1; carry = before === 0x38 ? 1 : 0; }
    let dest: Addr | null = null;
    if (carry === 1) for (const z of [...r.zp.keys()].sort((p, q) => p - q)) if (r.zp.has(z + 1)) { dest = r.zp.get(z)! | (r.zp.get(z + 1)! << 8); break; }
    return { at, x, y, carry, dest };
  }
  return null;
}

/** a table's entries as tracks and sectors: X's table and Y's, a pair each when one is right after the other */
export function krillTableEntries(read: (a: Addr) => number | null, x: { table: Addr }, y: { table: Addr }, max = 64): [number, number][] {
  const stride = Math.abs(y.table - x.table) === 1 ? 2 : 1, out: [number, number][] = [];
  for (let e = 0; e < max; e++) {
    const t = read((x.table + e * stride) & 0xffff), s = read((y.table + e * stride) & 0xffff);
    if (t == null || s == null) break;
    out.push([t, s]);
  }
  return out;
}

/** The directory and files of a disk for Krill's loader whose files are packed with its ZX0, Doynax LZ, Exomizer or
 *  TinyCrunch, and the loader's calls in their code; null when it is not one. */
export function readKrillDisk(disk: Uint8Array): KrillDisk | null {
  let image: Uint8Array, img: ReturnType<typeof parseD64>;
  try { image = diskSectors(disk); img = parseD64(image); } catch { return null; }
  const tracks = img.tracks;
  const sec = (t: number, s: number) => { const o = sectorOffset(t, s, tracks); return image.subarray(o, o + 256); };
  /** a file's sectors and bytes along its chain; null when the chain leaves the disk or loops */
  const chain = (t: number, s: number): { sectors: [number, number][]; data: Uint8Array } | null => {
    const sectors: [number, number][] = [], parts: Uint8Array[] = [], seen = new Set<number>();
    while (t) {
      if (t > tracks || s >= sectorsOnTrack(t) || seen.has(t * 32 + s)) return null;
      seen.add(t * 32 + s);
      sectors.push([t, s]);
      const b = sec(t, s);
      parts.push(b[0] ? b.subarray(2) : b.subarray(2, Math.max(b[1], 1) + 1));
      [t, s] = [b[0], b[1]];
    }
    const data = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of parts) { data.set(p, o); o += p.length; }
    return { sectors, data };
  };
  const starts = new Map<number, number>();
  const entries = img.files.map((f, n): KrillEntry => {
    const e: KrillEntry = { n, name: f.name, raw: f.raw, type: f.type, closed: f.closed, locked: f.locked, blocks: f.blocks, track: f.track, sector: f.sector, file: null, same: null };
    // a line of a dirart points nowhere, or at the BAM (18/0)
    if (!f.track || (f.track === 18 && f.sector === 0)) return e;
    const key = f.track * 32 + f.sector;
    if (starts.has(key)) { e.same = starts.get(key)!; return e; }
    starts.set(key, n);
    const c = chain(f.track, f.sector);
    if (!c || c.data.length < 3) return e;
    const load = c.data[0] | (c.data[1] << 8), bytes = c.data.subarray(2);
    // a BASIC program at $0801 starts with a line: a link into the program, a line number, a token (SYS); its bytes
    // can happen to unpack (Kings Size has two that do), so it is not tried
    const link = bytes[0] | (bytes[1] << 8);
    const basic = load === 0x0801 && bytes.length >= 6 && link > 0x0805 && link <= 0x0801 + bytes.length && bytes[4] >= 0x80;
    e.file = { entry: n, load, end: Math.min(load + bytes.length, 0x10000), bytes, sectors: c.sectors, unpacked: null, basic };
    return e;
  });
  const files = entries.flatMap(e => (e.file ? [e.file] : []));
  // the loader's ZX0, else Doynax LZ, Exomizer or TinyCrunch (older builds): the first that the disk's files are packed
  // with (TinyCrunch last: any byte is a token of it, so it takes the most); Exomizer with the protocol that reads most
  const fits = () => {
    const packed = files.filter(f => f.unpacked).length, other = files.filter(f => !f.unpacked && !f.basic).length;
    return packed >= 2 && packed >= 2 * other ? packed : 0;
  };
  let protocol: number | null = null;
  const unpack = (p: KrillPacker, f: KrillFile) => (f.basic ? null : p === 'exomizer' ? unpackKrillExomizer(f.bytes, f.load, protocol ?? 0) : UNPACK[p](f.bytes, f.load));
  const packer = (['zx0', 'doynax', 'exomizer', 'tinycrunch'] as const).find(p => {
    if (p !== 'exomizer') { for (const f of files) f.unpacked = unpack(p, f); return fits() > 0; }
    let best = 0, bestProtocol: number | null = null;
    for (const pr of KRILL_EXOMIZER_PROTOCOLS) {
      protocol = pr;
      for (const f of files) f.unpacked = unpack(p, f);
      const n = fits();
      if (n > best) { best = n; bestProtocol = pr; }
    }
    protocol = bestProtocol;
    if (protocol == null) return false;
    for (const f of files) f.unpacked = unpack(p, f);
    return true;
  });
  if (!packer) return null;

  // the loader's calls in the files' code, and the files outside the directory they load by track and sector
  const calls = findCalls(files, entries, tracks, sec, chain, f => unpack(packer, f));
  // (with no call in the files an Exomizer build can be either: version 146 and older load by track and sector too)
  const by: KrillDisk['by'] = calls.length ? (calls.every(c => c.how !== 'name') ? 'ts' : 'name') : packer === 'exomizer' ? null : 'name';
  const found: KrillDisk['found'] = files.some(f => loaderCodeIn('krill', f.bytes) || (f.unpacked && loaderCodeIn('krill', f.unpacked.bytes))) ? 'code' : 'files';
  // the step from a sector to the next on the same track, as cc1541's interleave takes it
  const steps = files.flatMap(f => f.sectors.slice(1).flatMap(([t, s], i) => {
    const [pt, ps] = f.sectors[i];
    return t === pt ? [(s - ps + sectorsOnTrack(t)) % sectorsOnTrack(t)] : [];
  }));
  const bam = sec(18, 0);
  return {
    packer, protocol: packer === 'exomizer' ? protocol : null, found, by, entries, files, calls, header: img.name, id: petsciiName(bam.subarray(0xa2, 0xa7)), headerRaw: bam.slice(0x90, 0xa0), idRaw: bam.slice(0xa2, 0xa7),
    interleave: mode(steps, 10), tracks,
  };
}

/** a call as it is first read: the file it names by its track and sector (or name), before the calls are weighed */
interface Candidate { in: number; at: Addr; jsr: Addr; to: Addr; how: KrillCall['how']; ts?: [number, number]; name?: number; table?: Addr; entry?: number; dest: Addr | null }

/**
 * The loader's calls in the code of the disk's files (unpacked, or as they are when not packed; not the BASIC boot):
 * a jsr or jmp right after code that sets X and Y to a file's track and sector, to an entry of a table of them, or to
 * the address of a file's name in the same file. A routine counts as the loader's when two calls at least call it (or
 * one that names a file of the directory by its name), or it is within $20 of one that does (version 146's loadraw and
 * loadcompd are 11 bytes apart). The program loads by
 * name or by track and sector, not both: the calls of the kind with fewer are dropped (by name when as many). A call
 * by track and sector may name a chain of sectors that is not in the directory: that becomes a file (entry -1), whose
 * own code is read for calls in turn.
 */
function findCalls(files: KrillFile[], entries: KrillEntry[], tracks: number, sec: (t: number, s: number) => Uint8Array,
  chain: (t: number, s: number) => { sectors: [number, number][]; data: Uint8Array } | null, unpack: (f: KrillFile) => KrillUnpacked | null): KrillCall[] {
  // the directory's own sectors, and every sector of a file (a call naming the middle of one names no file)
  const dir = new Set<number>([18 * 32]);
  for (let [t, s] = [sec(18, 0)[0], sec(18, 0)[1]]; t === 18 && s < sectorsOnTrack(18) && !dir.has(t * 32 + s);) { dir.add(t * 32 + s); const b = sec(t, s); [t, s] = [b[0], b[1]]; }
  const first = new Map<number, number>(), inside = new Set<number>();
  const own = (f: KrillFile, i: number) => { first.set(f.sectors[0][0] * 32 + f.sectors[0][1], i); for (const [t, s] of f.sectors.slice(1)) inside.add(t * 32 + s); };
  files.forEach(own);
  /** a chain of sectors a file can start at (one of the files', or one that is not in the directory) */
  const startsAt = (t: number, s: number) => t >= 1 && t <= tracks && s < sectorsOnTrack(t) && !dir.has(t * 32 + s) && !inside.has(t * 32 + s)
    && (first.has(t * 32 + s) || (chain(t, s)?.data.length ?? 0) >= 3);
  /** a name's bytes as the directory stores them, without the shift-spaces after it */
  const nameOf = (raw: Uint8Array) => { let n = raw.length; while (n > 0 && raw[n - 1] === 0xa0) n--; return [...raw.subarray(0, n)].join(','); };
  const named = new Map<string, number>();
  for (const e of entries) { const f = e.file ?? (e.same != null ? entries[e.same].file : null); if (f && !named.has(nameOf(e.raw))) named.set(nameOf(e.raw), files.indexOf(f)); }

  const scan = (fi: number): Candidate[] => {
    const f = files[fi];
    if (f.basic) return [];
    const base = f.unpacked?.start ?? f.load, bytes = f.unpacked?.bytes ?? f.bytes.subarray(0, f.end - f.load);
    const read = (a: Addr) => (a >= base && a < base + bytes.length ? bytes[a - base] : null);
    const out: Candidate[] = [];
    for (let k = 0; k + 2 < bytes.length; k++) {
      if (bytes[k] !== 0x20 && bytes[k] !== 0x4c) continue;
      const j = base + k, to = bytes[k + 1] | (bytes[k + 2] << 8), r = krillCallRegs(read, j);
      if (!r) continue;
      const c = { in: fi, at: r.at, jsr: j, to, dest: r.dest };
      if ('imm' in r.x && 'imm' in r.y) {
        // a pointer to a name of the directory (a 0 after it) in the file, else a track and sector
        const p = (r.y.imm << 8) | r.x.imm, name: number[] = [];
        for (let a = p; read(a) != null && read(a) !== 0 && name.length < 17; a++) name.push(read(a)!);
        const n = read(p + name.length) === 0 && name.length && name.length <= 16 ? named.get(name.join(',')) : undefined;
        if (n != null) out.push({ ...c, how: 'name', name: n });
        else if (startsAt(r.x.imm, r.y.imm)) out.push({ ...c, how: 'ts', ts: [r.x.imm, r.y.imm] });
      } else if ('table' in r.x && 'table' in r.y) {
        const all = krillTableEntries(read, r.x, r.y), ok: [number, number][] = [];
        for (const ts of all) { if (!startsAt(ts[0], ts[1])) break; ok.push(ts); }
        if (ok.length >= 2) ok.forEach((ts, entry) => out.push({ ...c, how: 'table', ts, table: (r.x as { table: Addr }).table, entry }));
      }
    }
    return out;
  };

  const found: Candidate[] = [];
  let scanned = 0, calls: KrillCall[] = [];
  for (let round = 0; round < 8 && scanned < files.length; round++) {
    for (; scanned < files.length; scanned++) found.push(...scan(scanned));
    // the loader's routines: called by two calls at least (a table is one) or by one with a name of the directory, or
    // near one that is
    const sites = new Map<Addr, Set<Addr>>();
    for (const c of found) sites.set(c.to, (sites.get(c.to) ?? new Set()).add(c.jsr));
    const busy = [...sites].filter(([t, s]) => s.size >= 2 || found.some(c => c.to === t && c.how === 'name')).map(([t]) => t);
    const loader = (t: Addr) => busy.some(b => Math.abs(b - t) <= 0x20);
    let kept = found.filter(c => loader(c.to));
    const byName = new Set(kept.filter(c => c.how === 'name').map(c => c.jsr)).size, byTs = new Set(kept.filter(c => c.how !== 'name').map(c => c.jsr)).size;
    kept = kept.filter(c => (byTs > byName ? c.how !== 'name' : c.how === 'name'));
    // a chain the program loads that is not a file yet becomes one (outside the directory)
    calls = kept.map(c => {
      let file = c.name;
      if (c.ts) {
        const key = c.ts[0] * 32 + c.ts[1];
        if (!first.has(key)) {
          const ch = chain(c.ts[0], c.ts[1])!, load = ch.data[0] | (ch.data[1] << 8), bytes = ch.data.subarray(2);
          const nf: KrillFile = { entry: -1, load, end: Math.min(load + bytes.length, 0x10000), bytes, sectors: ch.sectors, unpacked: null, basic: false };
          nf.unpacked = unpack(nf);
          files.push(nf);
          own(nf, files.length - 1);
        }
        file = first.get(key)!;
      }
      const call: KrillCall = { in: c.in, at: c.at, jsr: c.jsr, to: c.to, how: c.how, file: file!, dest: c.dest };
      if (c.table != null) { call.table = c.table; call.entry = c.entry; }
      return call;
    });
  }
  return calls.sort((p, q) => p.in - q.in || p.jsr - q.jsr || (p.entry ?? 0) - (q.entry ?? 0));
}

const hx = (v: number, w: number) => v.toString(16).padStart(w, '0');

/** a file's stem: its directory entry (file05), or where it starts for one outside the directory (t21s10) */
const stem = (f: KrillFile) => (f.entry >= 0 ? `file${hx(f.entry, 2)}` : `t${String(f.sectors[0][0]).padStart(2, '0')}s${String(f.sectors[0][1]).padStart(2, '0')}`);
/** A file's name in the rebuilt script: its directory entry (or where it starts, outside the directory) and where it
 *  unpacks to (or loads, when it is not packed), `.zx0` (`.dnx` for Doynax LZ, `.exo` for Exomizer) for the file as it
 *  is on the disk when it is packed, else `.prg` (the local names are not on the disk). */
export const krillFileName = (f: KrillFile): string => `${stem(f)}_${hx(f.unpacked?.start ?? f.load, 4)}.${f.unpacked ? KRILL_PACKER[f.unpacked.packer ?? 'zx0'].ext : 'prg'}`;
/** The name of a packed file unpacked: a PRG at where it unpacks to. */
export const krillUnpackedName = (f: KrillFile): string => `${stem(f)}_${hx(f.unpacked?.start ?? f.load, 4)}.prg`;
/** where a file starts on the disk, as track/sector */
export const krillFileTs = (f: KrillFile): string => `${f.sectors[0][0]}/${f.sectors[0][1]}`;

/** A call as a line of the script: `load 6/17` (by track and sector), `load 21/8` with its table's entry, `load "NAME"`,
 *  and where the call has it go when it says. */
export function krillCallText(c: KrillCall, disk: KrillDisk): string {
  const f = disk.files[c.file];
  const what = c.how === 'name' ? `load "${disk.entries[f.entry]?.name ?? ''}"` : `load ${krillFileTs(f)}`;
  return `${what}${c.how === 'table' ? ` (table $${hx(c.table!, 4)}, entry ${c.entry})` : ''}${c.dest != null ? ` to $${hx(c.dest, 4)}` : ''}`;
}

/** A file as a PRG: unpacked at where it unpacks to; else as it loads (as much as memory holds). */
export function krillFilePrg(f: KrillFile): Uint8Array {
  const start = f.unpacked?.start ?? f.load, bytes = f.unpacked?.bytes ?? f.bytes.subarray(0, f.end - f.load);
  const out = new Uint8Array(bytes.length + 2);
  out[0] = start & 0xff; out[1] = start >> 8;
  out.set(bytes, 2);
  return out;
}

/** The file as it is on the disk: its load address, then its bytes. */
export function krillDiskPrg(f: KrillFile): Uint8Array {
  const out = new Uint8Array(f.bytes.length + 2);
  out[0] = f.load & 0xff; out[1] = f.load >> 8;
  out.set(f.bytes, 2);
  return out;
}

/** PETSCII bytes as cc1541 takes them in a name, header or id: letters (unshifted, $41-$5a) in lower case, digits,
 *  space and punctuation as they are, every other byte as # and two hex digits; trailing shift-spaces dropped. The
 *  characters a shell would read in double quotes are written as # too. */
export function cc1541Text(raw: Uint8Array, pad = true): string {
  let end = raw.length;
  if (pad) while (end > 0 && raw[end - 1] === 0xa0) end--;
  let s = '';
  for (const b of raw.subarray(0, end)) {
    if (b >= 0x41 && b <= 0x5a) s += String.fromCharCode(b + 0x20);
    else if (b >= 0x20 && b <= 0x3f && !'"#$!'.includes(String.fromCharCode(b))) s += String.fromCharCode(b);
    else s += `#${hx(b, 2)}`;
  }
  return s;
}

const shellName = (name: string) => (/^[\w.-]+$/.test(name) ? name : `"${name.replace(/(["\\$`])/g, '\\$1')}"`);
const TYPE_OPTION: Partial<Record<D64FileType, string>> = { SEQ: 'SEQ', USR: 'USR', REL: 'REL', DEL: 'DEL' };

/** cc1541's command line that writes the disk again: the files as they are on it, in the directory's order and with
 *  its names, the lines of a dirart as entries without a file; each entry in a comment first. */
export function cc1541Script(disk: KrillDisk, name: string): string[] {
  const n = disk.files.length, unpacked = disk.files.filter(f => f.unpacked).length, outside = disk.files.filter(f => f.entry < 0);
  const out = [
    `# cc1541 command line, rebuilt by Mimir Studio from ${name} (Krill's loader, ${krillPackerName(disk)}): ${n} file${n === 1 ? '' : 's'}, ${unpacked} of them packed.`,
    ...(disk.by === 'ts' ? [
      '# Krill\'s loader has no load script, and this build loads a file by its track and sector (ldx #track / ldy #sector /',
      '# jsr), as the calls in the files\' code below show: a disk written again has to have each file start where it does',
      '# on this one (not checked for this command line). cc1541 writes each file as it is on the disk (packed); the names',
      '# are the directory\'s (# and two hex digits is a PETSCII byte), the local file names are made up from the entry (or',
      '# where a file outside the directory starts) and where the file unpacks to.',
    ] : disk.by == null ? [
      '# Krill\'s loader has no load script: a part loads a file by its name, or the next file in the directory with an empty',
      '# name, or (builds of version 146 and older) by its track and sector; no call in the files\' code says which this',
      '# build does. cc1541 writes each file as it is on the disk (packed); the names are the directory\'s (# and two hex',
      '# digits is a PETSCII byte), the local file names are made up from the entry and where the file unpacks to.',
    ] : [
      '# Krill\'s loader has no load script: a part loads a file by its name, or the next file in the directory with an empty',
      '# name, so the directory is the order they load in. cc1541 writes each file as it is on the disk (packed); the names',
      '# are the directory\'s (# and two hex digits is a PETSCII byte), the local file names are made up from the entry and',
      '# where the file unpacks to.',
    ]),
  ];
  const describe = (f: KrillFile) => {
    const u = f.unpacked;
    return u ? `unpacks to $${hx(u.start, 4)}-$${hx(u.end - 1, 4)} (${u.end - u.start} bytes)${u.overwritten ? `, writing over ${u.overwritten} byte${u.overwritten === 1 ? '' : 's'} of its stream before they are read` : ''}`
      : f.basic ? 'a BASIC program, loaded with LOAD and RUN' : `not packed with ${disk.packer === 'zx0' ? "the loader's ZX0" : disk.packer === 'doynax' ? 'Doynax LZ' : disk.packer === 'exomizer' ? krillPackerName(disk) : 'TinyCrunch'}`;
  };
  for (const e of disk.entries) {
    const f = e.file, label = `${hx(e.n, 2)} "${e.name}"`.padEnd(21);
    if (!f) {
      out.push(`#   ${label} ${e.same != null ? `the same file as entry ${hx(e.same, 2)}` : e.track ? `points at ${e.track}/${e.sector}, no file of its own` : 'a line of the directory, no file'}`);
      continue;
    }
    out.push(`#   ${label} ${krillFileName(f).padEnd(16)} loads at $${hx(f.load, 4)}-$${hx(f.end - 1, 4)} (${f.bytes.length} bytes), ${describe(f)}`);
  }
  if (outside.length) {
    out.push(`# ${outside.length} file${outside.length === 1 ? ' is' : 's are'} not in the directory, loaded by ${outside.length === 1 ? 'its' : 'their'} track and sector; this command line does not write ${outside.length === 1 ? 'it' : 'them'}:`);
    for (const f of outside) out.push(`#   ${krillFileTs(f).padEnd(20)} ${krillFileName(f).padEnd(16)} loads at $${hx(f.load, 4)}-$${hx(f.end - 1, 4)} (${f.bytes.length} bytes), ${describe(f)}`);
  }
  if (disk.calls.length) {
    out.push(`# The loader's calls in the files' code (${disk.calls.length}): the file, where, the routine, the file it loads.`);
    for (const c of disk.calls) out.push(`#   ${krillFileName(disk.files[c.in]).padEnd(16)} $${hx(c.at, 4)} calls $${hx(c.to, 4)}  ${krillCallText(c, disk).padEnd(34)} ${krillFileName(disk.files[c.file])}`);
  }
  const lines = [`cc1541 -n "${cc1541Text(disk.headerRaw)}" -i "${cc1541Text(disk.idRaw, false)}"${disk.interleave !== 10 ? ` -S ${disk.interleave}` : ''}`];
  for (const e of disk.entries) {
    const opts: string[] = [];
    if (TYPE_OPTION[e.type]) opts.push(`-T ${TYPE_OPTION[e.type]}`);
    opts.push(`-f "${cc1541Text(e.raw)}"`);
    // the blocks the directory shows, when they are not the file's
    const sectors = e.file?.sectors.length ?? (e.same != null ? disk.entries[e.same].file?.sectors.length ?? 0 : 0);
    if (e.blocks !== sectors) opts.push(`-B ${e.blocks}`);
    if (e.file) opts.push(`-w ${krillFileName(e.file)}`);
    else if (e.same != null) opts.push(`-l "${cc1541Text(disk.entries[e.same].raw)}"`);
    else opts.push('-L');
    lines.push(opts.join(' '));
  }
  lines.push(shellName(name.replace(/\.g64$/i, '.d64')));
  out.push('', ...lines.map((l, i) => `${i ? '  ' : ''}${l}${i < lines.length - 1 ? ' \\' : ''}`));
  return out;
}
