/* The files of a disk for the Covert Bitops loader (Cadaver), spec 13.5l. The loader (version 2, 2002-2020: the
 * "Autoconfiguring Loader/Depacker" 2.0 to 2.29; version 3, 2023: the "Loadersystem" 3.0 to 3.06) loads ordinary
 * files of the disk's directory, each a chain of linked sectors, by name: version 2 by two letters in X and Y (the
 * first two characters of the name) or by a pointer to a whole name ending in a 0 (a * ends it early), version 3 by a
 * number in A, the name's first two characters as hex digits ("00" to "FF"; the rest of the name is not looked at).
 * The file goes to memory byte by byte as the drive sends it, with the routine the program calls:
 * - as it is: its first two bytes are where it goes (LOADFILE, LoadUnpacked), or the program says where (LoadUnpackedRaw);
 * - unpacked with Exomizer 1 or 2 (LOADFILE_EXOMIZER, version 2): the file is `exomizer level` (Exomizer 1: `-r`) as it
 *   is: where it ends, the high byte first, then the stream, unpacked from the end backwards; with -f (the loader built
 *   with FORWARD_DECRUNCHING) the address is where it starts and it unpacks forwards;
 * - unpacked with Exomizer 3 (2.27 to 2.29 built with EXOMIZER_VERSION_3): the same, the stream of `exomizer3 level`
 *   (protocol 7: bits from the top of a byte, longer offsets in whole bytes, the first literal without a flag), and
 *   forwards with -f;
 * - unpacked with Exomizer 3 raw (LoadExomizer3Raw, version 3): `exomizer3 raw -T4 -M256 -P-32 -c`, the stream alone,
 *   forwards from where the program says (X and Y); Cadaver's own games pack so too (pack3, which leaves Exomizer 3.1's
 *   protocol 39 as it is), though their engines' loaders and chunk files are their own and not read here;
 * - unpacked with Pucrunch (LOADFILE_PUCRUNCH, version 2): `pucrunch -c0`: a load address the loader skips, "pu",
 *   where it ends, the escape, where it starts, the parameters, 31 bytes of RLE codes at most (the old format, which
 *   is what the loader's unpacker reads), then the stream.
 * The streams are read with Brokkr's Exomizer reader (it reads every protocol) and an own Pucrunch reader; both were
 * checked against the example disks of the loader's releases (2.05, 2.12, 2.23 to 2.29, 3.0 to 3.06), whose packed
 * files the loader's own unpacker, in the test programs on the same disks, unpacks on Sindri's Cpu to the same bytes.
 *
 * There is no load script: the program asks for files by name. What is read back is the program's own calls, when
 * the code is on the disk to be read (unpacked, or in a file that is not packed): `ldx #"A" / ldy #"B" / jsr load`,
 * `ldx #<name / ldy #>name / jsr load` and `lda #$01 (/ ldx #<to / ldy #>to) / jsr load` naming files of the disk;
 * they also give where a raw file goes. How the disk is built is Cadaver's own tools: makedisk (c64tools, the loader's
 * example disks, BOFH, MW4) and maked64 (Hessian, Steel Ranger, the loader's 3.x examples), a command file with a line
 * per file, the local file and its name on the disk (_ for a space), and the disk's name, id and interleave on the
 * command line. makedisk writes the files in the command file's order from the directory out (track 17 down, then 19
 * up; with an interleave over 10 the other way round), maked64 from track 1 on in the order its command file gives
 * after an empty line (and a file's own interleave after its name); both start a file at the first free sector and step
 * `interleave` sectors on (or to the next free one). This reads back which of them laid the disk out, and the order.
 *
 * A disk counts as one when the loader's code is in one of its files (the test programs, an unpacked main program), or
 * when at least two of its files are packed as the loader reads them, twice as many as the files that are neither
 * packed nor BASIC programs at $0801 (a boot loads with LOAD; those are not tried). Other loaders that read Exomizer
 * level or Pucrunch -c0 files as they are would count too; their files unpack all the same. */
import { readStream } from '@mimir/brokkr';
import type { Addr } from '../types';
import { diskSectors, parseD64, petsciiName, sectorOffset, sectorsOnTrack, type D64FileType } from './d64';

/** Cadaver's disk builders */
export type CovertTool = 'maked64' | 'makedisk';

/** the ways a file can be packed for the loader */
export type CovertPacker = 'exomizer' | 'exomizer-forward' | 'exomizer3' | 'exomizer3-forward' | 'exomizer3-raw' | 'pucrunch';

/** each packer: its name, the extension of a file packed with it, the loader's version that unpacks it, and how it
 *  is made */
export const COVERT_PACKER: Record<CovertPacker, { name: string; ext: string; version: 2 | 3; how: string }> = {
  exomizer: { name: 'Exomizer 1/2', ext: 'exo', version: 2, how: 'exomizer level (Exomizer 1: exomizer -r)' },
  'exomizer-forward': { name: 'Exomizer 2 forwards', ext: 'exo', version: 2, how: 'exomizer level -f' },
  exomizer3: { name: 'Exomizer 3', ext: 'exo3', version: 2, how: 'exomizer3 level' },
  'exomizer3-forward': { name: 'Exomizer 3 forwards', ext: 'exo3', version: 2, how: 'exomizer3 level -f' },
  'exomizer3-raw': { name: 'Exomizer 3 raw', ext: 'exo3', version: 3, how: 'exomizer3 raw -T4 -M256 -P-32 -c' },
  pucrunch: { name: 'Pucrunch', ext: 'puc', version: 2, how: 'pucrunch -c0' },
};

/** where a raw file opens when no call in the program says where it goes */
export const COVERT_RAW_AT = 0x1000;

export interface CovertUnpacked {
  packer: CovertPacker;
  /** where it unpacks to (end: after its last byte); a raw file: where a call in the program puts it, null when none
   *  does */
  start: Addr | null; end: Addr | null;
  bytes: Uint8Array;
}

export interface CovertFile {
  /** its directory entry (from 0) */
  entry: number;
  /** the name the loader asks for: its first two characters (version 2 with names of two letters, version 3 as two
   *  hex digits) */
  key: string;
  /** every byte of it, as the loader reads them: a load address first, or the packed stream's own first bytes */
  data: Uint8Array;
  /** its first two bytes as an address: where LOAD and the loader's unpacked loading put the rest */
  load: Addr;
  /** its sectors, in the order of its chain */
  sectors: [number, number][];
  /** what it unpacks to; null: not packed (or not in a way the loader reads) */
  unpacked: CovertUnpacked | null;
  /** a BASIC program at $0801 (a line, then a token): it loads with LOAD, not with the loader, and is not tried */
  basic: boolean;
  /** the loader's own code is in it (as it is, or unpacked): its version */
  code: 2 | 3 | null;
}

export interface CovertEntry {
  n: number;
  name: string; raw: Uint8Array;
  type: D64FileType; closed: boolean; locked: boolean;
  blocks: number;
  track: number; sector: number;
  file: CovertFile | null;
  /** it starts where this earlier entry does */
  same: number | null;
}

/** A call of the loader in the program's code that names a file of the disk. */
export interface CovertCall {
  /** the file whose code holds it (its entry), where its first instruction is and where its jsr is */
  in: number; at: Addr; jsr: Addr;
  /** the routine it calls and the file it loads (its entry) */
  to: Addr; file: number;
  /** how it names the file: two letters in X and Y, a pointer to the name, a number in A */
  how: 'letters' | 'name' | 'number';
  /** where it puts a raw file (X and Y with a number in A); null: it does not say */
  dest: Addr | null;
}

export interface CovertDisk {
  /** the loader's version, by its code on the disk, else by how the files are packed (null: neither says) */
  version: 2 | 3 | null;
  /** what shows it is a disk for the loader: its code in a file, or files packed as it reads them */
  found: 'code' | 'files';
  /** the packers of its files, in the order of this list's types */
  packers: CovertPacker[];
  entries: CovertEntry[];
  /** the entries' files, in the directory's order */
  files: CovertFile[];
  /** the loader's calls read from the program's code on the disk */
  calls: CovertCall[];
  header: string; id: string;
  /** BAM bytes $90-$a6: the header, two $a0, the id, $a0 and the DOS type, as maked64's disk name writes them */
  nameRaw: Uint8Array;
  /** the interleave the files' sector chains step by on a track (the one most files take; the tools' default is 10) */
  interleave: number;
  tracks: number;
  /** the order the files were written in (entries) */
  order: number[];
  /** the tool that laid the disk out: every file is where it puts it, writing them in that order with that interleave
   *  (null: neither did) */
  tool: CovertTool | null;
  /** files are on track 18 too (maked64's dir option) */
  dirTrack: boolean;
  /** the interleave of each file that steps by another one than the disk's (entry -> interleave) */
  fileInterleave: Map<number, number>;
}

const hx = (v: number, w: number) => v.toString(16).padStart(w, '0');

// ---- the packers ------------------------------------------------------------------------------------------------

/** An Exomizer stream in reading order (protocol 0: Exomizer 1 and 2; 7: Exomizer 3 as the loader takes it); null
 *  when the bytes are not one that ends where they do. */
function exomizer(stream: Uint8Array, flags: number): Uint8Array | null {
  try {
    const d = readStream(stream, flags, undefined, 0x10000);
    return d.read === stream.length && d.data.length ? d.data : null;
  } catch { return null; }
}

/** A file of `exomizer level` (Exomizer 1 and 2: protocol 0; Exomizer 3: 7) as the loader of version 2 unpacks it:
 *  the address (high byte first) then the stream; backwards from the address unless only forwards fits. */
export function unpackCovertExomizer(data: Uint8Array, version: 2 | 3 = 2): CovertUnpacked | null {
  if (data.length < 4) return null;
  const out = exomizer(data.subarray(2), version === 3 ? 7 : 0);
  if (!out) return null;
  const addr = (data[0] << 8) | data[1], end = addr || 0x10000;
  if (end - out.length >= 0) return { packer: version === 3 ? 'exomizer3' : 'exomizer', start: end - out.length, end, bytes: out.slice().reverse() };
  // (forwards when backwards does not fit: a file that fits both ways is taken backwards, the loader's default)
  if (addr + out.length <= 0x10000) return { packer: version === 3 ? 'exomizer3-forward' : 'exomizer-forward', start: addr, end: addr + out.length, bytes: out };
  return null;
}

/** A file of `exomizer3 raw` as LoadExomizer3Raw (version 3) unpacks it: the stream alone, forwards, to where the
 *  program says. */
export function unpackCovertExomizer3Raw(data: Uint8Array): CovertUnpacked | null {
  if (data.length < 3) return null;
  const out = exomizer(data, 7) ?? exomizer(data, 39);
  return out ? { packer: 'exomizer3-raw', start: null, end: null, bytes: out } : null;
}

/** A file of `pucrunch -c0` as the loader of version 2 unpacks it (Pucrunch's old format, 31 RLE codes at most); null
 *  when it is not one that ends where it does. */
export function unpackCovertPucrunch(data: Uint8Array): CovertUnpacked | null {
  if (data.length < 17 || data[2] !== 0x70 || data[3] !== 0x75) return null;
  let escape = data[6];
  const start = data[7] | (data[8] << 8), escBits = data[9], maxGamma = data[10] - 1, extra = data[12], rle = data[15];
  if (escBits > 8 || maxGamma < 5 || maxGamma > 7 || data[11] !== 1 << maxGamma || extra > 4 || rle > 31) return null;
  const table = data.subarray(15, 16 + rle);
  let at = 16 + rle, mask = 0x80;
  const bits = (n: number) => {
    let v = 0;
    while (n-- > 0) {
      if (at >= data.length) throw new RangeError('past the end');
      v = (v << 1) | (data[at] & mask ? 1 : 0);
      mask >>= 1;
      if (!mask) { mask = 0x80; at++; }
    }
    return v;
  };
  const value = () => { let i = 0; while (i < maxGamma && bits(1)) i++; return (1 << i) | bits(i); };
  const out: number[] = [];
  const put = (v: number) => { if (start + out.length >= 0x10000) throw new RangeError('past $ffff'); out.push(v); };
  try {
    for (;;) {
      const sel = escBits ? bits(escBits) : escape;
      if (sel !== escape) { put((sel << (8 - escBits)) | bits(8 - escBits)); continue; }
      const len = value();
      let pos: number;
      if (len !== 1) {
        let hi = value() - 1;
        if (hi === (2 << maxGamma) - 2) break;
        if (extra) hi = (hi << extra) | bits(extra);
        pos = (hi << 8) | (bits(8) ^ 0xff);
      } else if (bits(1)) {
        // an escaped byte with a new escape, or a run of one byte (from the table, or 5 bits and 3 more)
        if (!bits(1)) { const next = bits(escBits); put((escape << (8 - escBits)) | bits(8 - escBits)); escape = next; continue; }
        let n = value();
        if (n >= 1 << maxGamma) { n = ((n - (1 << maxGamma)) << (8 - maxGamma)) | bits(8 - maxGamma); n |= (value() - 1) << 8; }
        const code = value(), byte = code < 32 ? table[code] : (((code - 32) << 3) | bits(3)) & 0xff;
        for (let i = 0; i <= n; i++) put(byte);
        continue;
      } else pos = bits(8) ^ 0xff;
      if (out.length - pos - 1 < 0) return null;
      for (let i = 0; i <= len; i++) put(out[out.length - pos - 1]);
    }
  } catch { return null; }
  // the stream ends with the byte its end is in
  if (at + (mask === 0x80 ? 0 : 1) !== data.length || !out.length) return null;
  return { packer: 'pucrunch', start, end: start + out.length, bytes: Uint8Array.from(out) };
}

/** A file as the loader would unpack it: Pucrunch, Exomizer 1/2 level, Exomizer 3 level, Exomizer 3 raw, the first
 *  that reads it whole. */
export function unpackCovertFile(data: Uint8Array): CovertUnpacked | null {
  return unpackCovertPucrunch(data) ?? unpackCovertExomizer(data, 2) ?? unpackCovertExomizer(data, 3) ?? unpackCovertExomizer3Raw(data);
}

// ---- the loader's code and calls --------------------------------------------------------------------------------

type Pattern = (number | null)[];
const pat = (s: string): Pattern => s.split(' ').map(t => (t === '..' ? null : parseInt(t, 16)));
/** the loader's own code, by version: the installer's drive commands (M-W of 32 bytes and M-E, stored backwards: at
 *  $0000 and $0500 in version 2, $0404 in 3), else the receive loop (lda #$10 / ora $dd00 in 3.0 and 3.01, lda $dd00 /
 *  ora #$10 in 2 and 3.02 on) */
const CODE: [Pattern, 2 | 3][] = [
  [pat('20 00 00 57 2D 4D 05 00 45 2D 4D'), 2],
  [pat('20 04 04 57 2D 4D .. .. 45 2D 4D'), 3],
  [pat('AD 11 D0 18 ED 12 D0 29 07 F0 .. A9 10 0D 00 DD 8D 00 DD'), 3],
  [pat('AD 11 D0 18 ED 12 D0 29 07 F0 .. AD 00 DD 09 10 8D 00 DD'), 2],
];
const findIn = (b: Uint8Array, p: Pattern): number[] => {
  const out: number[] = [];
  for (let i = 0; i + p.length <= b.length; i++) if (p.every((v, k) => v == null || b[i + k] === v)) out.push(i);
  return out;
};

/** the loader's version whose code is in these bytes; null: none */
function codeIn(b: Uint8Array): 2 | 3 | null {
  for (const [p, v] of CODE) if (findIn(b, p).length) return v;
  return null;
}

/** The file's bytes as memory: where it is unpacked (a raw file nowhere), else where it loads. */
function visible(f: CovertFile): { at: Addr; bytes: Uint8Array } | null {
  if (f.unpacked) return f.unpacked.start != null ? { at: f.unpacked.start, bytes: f.unpacked.bytes } : null;
  return f.data.length > 2 ? { at: f.load, bytes: f.data.subarray(2, 2 + Math.max(0, 0x10000 - f.load)) } : null;
}

const HEX = '0123456789ABCDEF';

/** The calls of the loader in the files' code that name files of the disk. */
function findCalls(files: CovertFile[], entries: CovertEntry[]): CovertCall[] {
  // what a call can name: two letters (the name's first two bytes), a whole name (a * ends it early), a number as two
  // hex digits
  const named = entries.filter(e => e.file && e.type === 'PRG');
  const byLetters = (x: number, y: number) => named.find(e => e.raw[0] === x && e.raw[1] === y);
  const byNumber = (a: number) => named.find(e => e.raw[0] === HEX.charCodeAt(a >> 4) && e.raw[1] === HEX.charCodeAt(a & 15));
  const byName = (mem: Uint8Array, at: number) => {
    const s: number[] = [];
    for (let i = at; i < mem.length && i - at <= 16; i++) { if (!mem[i]) break; s.push(mem[i]); }
    if (!s.length || s.length > 16 || mem[at + s.length] !== 0) return undefined;
    const star = s.indexOf(0x2a), want = star >= 0 ? s.slice(0, star) : s;
    return named.find(e => want.every((c, i) => e.raw[i] === c) && (star >= 0 || e.raw.length === want.length || e.raw[want.length] === 0xa0));
  };
  const out: CovertCall[] = [];
  const numbers: CovertCall[] = [];
  for (const f of files) {
    const v = visible(f);
    if (!v) continue;
    const mem = new Uint8Array(0x10000);
    mem.set(v.bytes.subarray(0, 0x10000 - v.at), v.at);
    const end = v.at + v.bytes.length;
    for (let j = v.at + 2; j + 2 < end; j++) {
      if (mem[j] !== 0x20) continue;
      // the immediate loads of A, X and Y just before the jsr
      const regs: Record<'a' | 'x' | 'y', number | null> = { a: null, x: null, y: null };
      let at = j;
      for (let k = 0; k < 3 && at - 2 >= v.at; k++) {
        const op = mem[at - 2], r = op === 0xa9 ? 'a' : op === 0xa2 ? 'x' : op === 0xa0 ? 'y' : null;
        if (!r || regs[r] != null) break;
        regs[r] = mem[at - 1];
        at -= 2;
      }
      if (at === j) continue;
      const to = mem[j + 1] | (mem[j + 2] << 8), xy = regs.x != null && regs.y != null ? regs.x | (regs.y << 8) : null;
      const letters = regs.a == null && regs.x != null && regs.y != null ? byLetters(regs.x, regs.y) : undefined;
      const name = !letters && regs.a == null && xy != null && xy >= v.at && xy < end ? byName(mem, xy) : undefined;
      if (letters || name) { out.push({ in: f.entry, at, jsr: j, to, file: (letters ?? name)!.n, how: letters ? 'letters' : 'name', dest: null }); continue; }
      const number = regs.a != null ? byNumber(regs.a) : undefined;
      if (number) numbers.push({ in: f.entry, at, jsr: j, to, file: number.n, how: 'number', dest: xy });
    }
  }
  // `lda #n / jsr` is everywhere: a routine counts as the loader when it is called with two files of the disk or more,
  // or from a program that has the loader's code with where the file goes in X and Y as well
  const files2 = new Map<Addr, Set<number>>();
  for (const c of numbers) files2.set(c.to, (files2.get(c.to) ?? new Set()).add(c.file));
  const withCode = new Set(files.filter(f => f.code).map(f => f.entry));
  out.push(...numbers.filter(c => files2.get(c.to)!.size >= 2 || (c.dest != null && withCode.has(c.in))));
  return out.sort((a, b) => a.in - b.in || a.at - b.at);
}

// ---- the disk ---------------------------------------------------------------------------------------------------

/** The most common value (of those as common: 10, the tools' default interleave, else the smallest); `none` for none. */
function mode(values: number[], none: number): number {
  const count = new Map<number, number>();
  for (const v of values) count.set(v, (count.get(v) ?? 0) + 1);
  let best = none, n = 0;
  for (const [v, c] of [...count].sort((a, b) => a[0] - b[0])) if (c > n || (c === n && v === 10)) { best = v; n = c; }
  return best;
}

/** the steps from a sector to the next on the same track along a chain */
const stepsOf = (sectors: [number, number][]) => sectors.slice(1).flatMap(([t, s], i) => {
  const [pt, ps] = sectors[i];
  return t === pt ? [(s - ps + sectorsOnTrack(t)) % sectorsOnTrack(t)] : [];
});

/** Whether `tool` laid the files out, writing them in `order` (maked64: the first that starts where it would start the
 *  next one; makedisk: the directory's order). Both start a file at the first free sector of a track (from sector 0 up;
 *  with an interleave over 10, 0 then down) and go on `interleave` sectors (else the next free one on the track, up or
 *  down the same way); maked64 looks from track 1 up and goes on to the next tracks (18 only with its dir option),
 *  makedisk looks from track 17 down and then from 19 up (an interleave over 10: 19 up first) and goes on away from the
 *  directory, then to the other half. */
function layout(tool: CovertTool, files: CovertFile[], interleave: number, dir: boolean, tracks: number): { order: number[]; exact: boolean; own: Map<number, number> } {
  const free = new Set<number>(), last = Math.min(tracks, 35), m64 = tool === 'maked64';
  const key = (t: number, s: number) => t * 32 + s;
  for (let t = 1; t <= last; t++) for (let s = 0; s < sectorsOnTrack(t); s++) if (t !== 18 || (m64 && dir && s > 1)) free.add(key(t, s));
  // (with the dir option the directory's own sectors are kept free of files)
  if (m64 && dir) for (let s = 2; s < Math.floor((files.length + 7) / 8) + 1; s++) free.delete(key(18, s));
  const range = (from: number, to: number) => { const r: number[] = []; for (let t = from; from <= to ? t <= to : t >= to; t += from <= to ? 1 : -1) if (t !== 18 || (m64 && dir)) r.push(t); return r; };
  /** free, and not taken by the file being laid out */
  let taken = new Set<number>();
  const open = (t: number, s: number) => free.has(key(t, s)) && !taken.has(key(t, s));
  const onTrack = (t: number, s: number, il: number): [number, number] | null => {
    const n = sectorsOnTrack(t);
    for (let c = 0; c < n; c++, s = il > 10 ? (s + n - 1) % n : (s + 1) % n) if (open(t, s)) return [t, s];
    return null;
  };
  const first = (il: number): [number, number] | null => {
    const order = m64 ? range(1, last) : il > 10 ? [...range(19, last), ...range(17, 1)] : [...range(17, 1), ...range(19, last)];
    for (const t of order) { const at = onTrack(t, 0, il); if (at) return at; }
    return null;
  };
  const next = (t: number, s: number, il: number): [number, number] | null => {
    const n = sectorsOnTrack(t);
    s = (s + il) % n;
    if (open(t, s)) return [t, s];
    const here = onTrack(t, il > 10 ? (s + n - 1) % n : (s + 1) % n, il);
    if (here) return here;
    const order = m64 ? range(t, last) : t < 18 ? [...range(t, 1), ...range(19, last)] : [...range(t, last), ...range(17, 1)];
    for (const tt of order) for (let ss = 0; ss < sectorsOnTrack(tt); ss++) if (open(tt, ss)) return [tt, ss];
    return null;
  };
  /** the file is where the tool puts it next with this interleave */
  const fits = (f: CovertFile, il: number) => {
    taken = new Set();
    let at = first(il);
    for (const [t, s] of f.sectors) {
      if (!at || at[0] !== t || at[1] !== s) return false;
      taken.add(key(t, s));
      at = next(t, s, il);
    }
    return true;
  };
  /** the interleaves to try a file with: the disk's, then (maked64 only) the steps its chain takes, most taken first */
  const tries = (f: CovertFile) => {
    if (!m64) return [interleave];
    const count = new Map<number, number>();
    for (const v of stepsOf(f.sectors)) count.set(v, (count.get(v) ?? 0) + 1);
    return [interleave, ...[...count].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([v]) => v).filter(v => v !== interleave)];
  };
  const left = files.filter(f => f.sectors.length);
  const order: number[] = [], own = new Map<number, number>();
  let exact = true;
  while (left.length) {
    // maked64: a file that is where it would write the next one, else the first on the disk; makedisk: the next in the
    // directory
    let i = 0, il: number | undefined = interleave;
    if (m64) {
      i = left.findIndex(f => (il = tries(f).find(v => fits(f, v))) != null);
      if (i < 0) { i = left.reduce((b, f, k) => (key(...f.sectors[0]) < key(...left[b].sectors[0]) ? k : b), 0); il = undefined; }
    } else if (!fits(left[0], interleave)) il = undefined;
    const f = left.splice(i, 1)[0];
    if (il == null) exact = false;
    else if (il !== interleave) own.set(f.entry, il);
    order.push(f.entry);
    for (const [t, s] of f.sectors) free.delete(key(t, s));
  }
  taken = new Set();
  return { order, exact, own };
}

/** The directory and files of a disk for the Covert Bitops loader; null when it is not one. */
export function readCovertDisk(disk: Uint8Array): CovertDisk | null {
  let image: Uint8Array, img: ReturnType<typeof parseD64>;
  try { image = diskSectors(disk); img = parseD64(image); } catch { return null; }
  const tracks = img.tracks;
  const sec = (t: number, s: number) => { const o = sectorOffset(t, s, tracks); return image.subarray(o, o + 256); };
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
  const entries = img.files.map((f, n): CovertEntry => {
    const e: CovertEntry = { n, name: f.name, raw: f.raw, type: f.type, closed: f.closed, locked: f.locked, blocks: f.blocks, track: f.track, sector: f.sector, file: null, same: null };
    if (!f.track || (f.track === 18 && f.sector === 0)) return e;
    const key = f.track * 32 + f.sector;
    if (starts.has(key)) { e.same = starts.get(key)!; return e; }
    starts.set(key, n);
    const c = chain(f.track, f.sector);
    if (!c || c.data.length < 2) return e;
    const data = c.data, load = data[0] | (data[1] << 8), rest = data.subarray(2);
    const link = rest[0] | (rest[1] << 8);
    const basic = load === 0x0801 && rest.length >= 6 && link > 0x0805 && link <= 0x0801 + rest.length && rest[4] >= 0x80;
    const file: CovertFile = { entry: n, key: petsciiName(f.raw.subarray(0, 2)), data, load, sectors: c.sectors, unpacked: basic ? null : unpackCovertFile(data), basic, code: null };
    const v = visible(file);
    file.code = v ? codeIn(v.bytes) : null;
    e.file = file;
    return e;
  });
  const files = entries.flatMap(e => (e.file ? [e.file] : []));
  const packed = files.filter(f => f.unpacked).length, other = files.filter(f => !f.unpacked && !f.basic && !f.code).length;
  const code = files.find(f => f.code)?.code ?? null;
  const byFiles = packed >= 2 && packed >= 2 * other;
  if (!code && !byFiles) return null;

  const calls = findCalls(files, entries);
  // a raw file goes where the first call that loads it puts it
  for (const f of files) {
    const u = f.unpacked;
    if (u?.packer !== 'exomizer3-raw') continue;
    const dest = calls.find(c => c.file === f.entry && c.dest != null)?.dest;
    if (dest != null && dest + u.bytes.length <= 0x10000) { u.start = dest; u.end = dest + u.bytes.length; }
  }
  const order: CovertPacker[] = ['exomizer', 'exomizer-forward', 'exomizer3', 'exomizer3-forward', 'exomizer3-raw', 'pucrunch'];
  const packers = order.filter(p => files.some(f => f.unpacked?.packer === p));
  const version = code ?? (packers.some(p => COVERT_PACKER[p].version === 3) ? 3 : packers.length ? 2 : null);

  // each file's interleave (the step it takes most), and the disk's: the one most files take
  const own = new Map(files.map(f => [f.entry, mode(stepsOf(f.sectors), -1)]));
  const interleave = mode([...own.values()].filter(v => v >= 0), 10);
  const dirTrack = files.some(f => f.sectors.some(([t]) => t === 18));
  const m64 = layout('maked64', files, interleave, dirTrack, tracks), mkd = layout('makedisk', files, interleave, dirTrack, tracks);
  const tool: CovertTool | null = tracks !== 35 ? null : mkd.exact && !dirTrack ? 'makedisk' : m64.exact ? 'maked64' : null;
  // a file's own interleave: as maked64 wrote it, else the step its chain takes most
  const fileInterleave = tool === 'maked64' ? m64.own : new Map<number, number>();
  if (!tool) for (const [e, il] of own) if (il >= 0 && il !== interleave) fileInterleave.set(e, il);
  const bam = sec(18, 0);
  return {
    version, found: code ? 'code' : 'files', packers, entries, files, calls,
    header: img.name, id: petsciiName(bam.subarray(0xa2, 0xa7)), nameRaw: bam.slice(0x90, 0xa7),
    interleave, tracks, order: tool === 'makedisk' ? mkd.order : m64.order, tool, dirTrack, fileInterleave,
  };
}

// ---- names, PRGs and the script ---------------------------------------------------------------------------------

/** A file's local name in the rebuilt command file: its entry and where it unpacks to (a raw file whose address no
 *  call gives: `raw`), with the packer's extension for the file as it is on the disk, else `.prg`. It starts with a
 *  letter: maked64 skips lines that start with anything below "@". */
export function covertFileName(f: CovertFile): string {
  const u = f.unpacked;
  const at = u ? (u.start != null ? hx(u.start, 4) : 'raw') : hx(f.load, 4);
  return `file${hx(f.entry, 2)}_${at}.${u ? COVERT_PACKER[u.packer].ext : 'prg'}`;
}

/** The name of a packed file unpacked: a PRG at where it unpacks to. */
export const covertUnpackedName = (f: CovertFile): string => covertFileName(f).replace(/\.[a-z0-9]+$/, '.prg');

/** A file as a PRG: unpacked at where it unpacks to (a raw file whose address no call gives at COVERT_RAW_AT); else
 *  as it is (its first two bytes the load address). */
export function covertFilePrg(f: CovertFile): Uint8Array {
  if (!f.unpacked) return f.data.slice(0, Math.min(f.data.length, 2 + 0x10000 - f.load));
  const start = f.unpacked.start ?? COVERT_RAW_AT, bytes = f.unpacked.bytes.subarray(0, 0x10000 - start);
  const out = new Uint8Array(bytes.length + 2);
  out[0] = start & 0xff; out[1] = start >> 8;
  out.set(bytes, 2);
  return out;
}

/** The file as it is on the disk: every byte of it, what maked64 takes as the local file. */
export const covertDiskFile = (f: CovertFile): Uint8Array => f.data.slice();

/** PETSCII as maked64 takes it in a command file: _ for a space, letters, digits and punctuation as they are (it
 *  writes the characters of the line as they are, so upper case is PETSCII's letters); `null` when a byte cannot be
 *  written so (shifted letters, graphics, $a0 inside the name). */
export function maked64Text(raw: Uint8Array): string | null {
  let end = raw.length;
  while (end > 0 && raw[end - 1] === 0xa0) end--;
  let s = '';
  for (const b of raw.subarray(0, end)) {
    if (b === 0x20) s += '_';
    else if (b > 0x20 && b <= 0x5d && b !== 0x5c) s += String.fromCharCode(b);
    else return null;
  }
  return s;
}

/** maked64's disk name argument: the 23 bytes $90-$a6 of the BAM, $a0 as _, a space as . (maked64 writes a _ or a
 *  space as $a0 and a . as a space). */
export function maked64DiskName(raw: Uint8Array): string {
  return [...raw].map(b => (b === 0xa0 ? '_' : b === 0x20 ? '.' : b > 0x20 && b < 0x7f && b !== 0x5f && b !== 0x2e ? String.fromCharCode(b) : '_')).join('');
}

/** The disk's summary: the loader's version and how its files are packed. */
export function covertSummary(d: CovertDisk): string {
  const packed = d.files.filter(f => f.unpacked).length;
  const how = d.packers.map(p => COVERT_PACKER[p].name).join(', ');
  return `${d.version ? `version ${d.version}, ` : ''}${packed} file${packed === 1 ? '' : 's'} packed${how ? ` (${how})` : ''}, ${d.calls.length} load call${d.calls.length === 1 ? '' : 's'} read from the code`;
}

/** The script that builds the disk again: the command file for Cadaver's tool (the one that laid the disk out, else
 *  maked64), notes on each entry, and the command line. */
export interface CovertScript {
  tool: CovertTool;
  /** the command file as the tool reads it: a line per file, the local file and its name on the disk (maked64: a
   *  file's own interleave after it, and the order to write them in after an empty line) */
  seq: string[];
  /** what the disk is and each entry, as comments */
  notes: string[];
  /** the command line that writes the disk with it */
  command: string;
}

export function covertScript(disk: CovertDisk, name: string): CovertScript {
  const n = disk.files.length, packed = disk.files.filter(f => f.unpacked).length;
  const base = name.replace(/\.[dg]64$/i, ''), tool: CovertTool = disk.tool ?? 'maked64';
  const notes = [
    `${tool} command file, rebuilt by Mimir Studio from ${name} (Covert Bitops loader${disk.version ? `, version ${disk.version}` : ''}): ${n} file${n === 1 ? '' : 's'}, ${packed} of them packed.`,
    `The loader has no load script: the program asks for a file by name (${disk.version === 3 ? "a number in A, the name's first two characters as hex digits" : 'two letters in X and Y, or a pointer to the name'}),`,
    `so the calls in its code and the disk are the script. Cadaver builds his disks with ${tool}: a line per file, the local`,
    tool === 'makedisk' ? 'file and its name on the disk (_ for a space), in the order it writes them, from the directory out.'
      : "file and its name on the disk (_ for a space), in the directory's order; after the first empty line the order it\nwrites them in, from track 1 on.",
    `The local names are made up from the entry and where the file unpacks to. ${disk.tool ? `Every file is where ${tool} puts it.` : 'Neither maked64 nor makedisk laid this\ndisk out (or not in one go): maked64 writes the files elsewhere.'}`,
  ];
  for (const e of disk.entries) {
    const f = e.file, label = `${hx(e.n, 2)} "${e.name}"`.padEnd(21);
    if (!f) {
      notes.push(`  ${label} ${e.same != null ? `the same file as entry ${hx(e.same, 2)}: ${tool} cannot write that` : e.track ? `points at ${e.track}/${e.sector}, no file of its own` : `a line of the directory, no file: ${tool} cannot write that`}`);
      continue;
    }
    const u = f.unpacked;
    const what = u ? `${COVERT_PACKER[u.packer].name} (${COVERT_PACKER[u.packer].how}), unpacks to ${u.start != null ? `$${hx(u.start, 4)}-$${hx(u.end! - 1, 4)}` : 'where the program says'} (${u.bytes.length} bytes)`
      : f.basic ? 'a BASIC program, loaded with LOAD and RUN' : `not packed: $${hx(f.load, 4)}-$${hx(Math.min(f.load + f.data.length - 2, 0x10000) - 1, 4)}`;
    notes.push(`  ${label} ${covertFileName(f).padEnd(16)} ${f.data.length} bytes, ${what}${f.code ? `; the loader's own code (version ${f.code})` : ''}`);
    if (maked64Text(e.raw) == null) notes.push(`      its name's bytes ${[...e.raw].map(b => hx(b, 2)).join(' ')} cannot be written in a command file: ? stands for it`);
    if (tool === 'makedisk' && disk.fileInterleave.has(e.n)) notes.push(`      steps by ${disk.fileInterleave.get(e.n)} sectors: makedisk has one interleave for every file`);
    for (const c of disk.calls.filter(x => x.file === e.n)) notes.push(`      loaded by $${hx(c.at, 4)} in entry ${hx(c.in, 2)}: ${covertCallText(c, disk)}`);
  }
  const seq: string[] = [];
  const line = (e: CovertEntry) => `${covertFileName(e.file!)} ${maked64Text(e.raw) ?? '?'}${tool === 'maked64' && disk.fileInterleave.has(e.n) ? ` ${disk.fileInterleave.get(e.n)}` : ''}`;
  if (tool === 'makedisk') seq.push(...disk.order.map(e => line(disk.entries[e])));
  else {
    seq.push(...disk.entries.filter(e => e.file).map(line));
    // the order, when it is not the directory's
    const dirOrder = disk.files.map(f => f.entry);
    if (disk.order.some((v, i) => v !== dirOrder[i])) seq.push('', ...disk.order.map(e => covertFileName(disk.entries[e].file!)));
  }
  const command = `${tool} ${base}.d64 ${base}.seq ${maked64DiskName(disk.nameRaw)} ${disk.interleave}${tool === 'maked64' && disk.dirTrack ? ' dir' : ''}`;
  return { tool, seq, notes, command };
}

/** The script as text, as the tab shows it: the notes as comments, the command file, the command line. */
export const covertScriptText = (s: CovertScript): string[] => [...s.notes.flatMap(l => l.split('\n')).map(l => `; ${l}`), '', ...s.seq, '', `; ${s.command}`];

/** A call as the script says it: `ldx #"A" / ldy #"B" / jsr $1234` and so on. */
export function covertCallText(c: CovertCall, disk: CovertDisk): string {
  const e = disk.entries[c.file];
  if (c.how === 'letters') return `ldx #"${e.name[0]}" / ldy #"${e.name[1]}" / jsr $${hx(c.to, 4)}`;
  if (c.how === 'name') return `ldx #<name / ldy #>name / jsr $${hx(c.to, 4)} ("${e.name}")`;
  return `lda #$${hx(parseInt(e.name.slice(0, 2), 16), 2)}${c.dest != null ? ` / ldx #<$${hx(c.dest, 4)} / ldy #>$${hx(c.dest, 4)}` : ''} / jsr $${hx(c.to, 4)}`;
}
