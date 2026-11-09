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
 * A disk counts as one when at least two of its files unpack so, twice as many as the files that neither unpack nor are
 * BASIC programs at $0801 (the boot program loads with LOAD; those are not tried): a disk packed another way has a file
 * that happens to unpack now and then. Builds of the loader with other unpackers (Exomizer and others) are not read here. */
import type { Addr } from '../types';
import { diskSectors, parseD64, petsciiName, sectorOffset, sectorsOnTrack, type D64FileType } from './d64';

export interface KrillUnpacked {
  start: Addr; end: Addr; bytes: Uint8Array;
  /** packed in place: it ends where it started to be read */
  inplace: boolean;
}

export interface KrillFile {
  /** its directory entry (from 0) */
  entry: number;
  /** where the loader puts it (its load address), and its bytes after the load address as they are on the disk (`end`
   *  at most $10000) */
  load: Addr; end: Addr; bytes: Uint8Array;
  /** its sectors, in the order of its chain */
  sectors: [number, number][];
  /** what it unpacks to (Krill's ZX0); null: not packed so */
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

export interface KrillDisk {
  /** the packer of its files: the loader's ZX0 */
  packer: 'zx0';
  /** the directory, entry by entry */
  entries: KrillEntry[];
  /** the entries' files, in the directory's order: the order the loader loads them in, the next after the last */
  files: KrillFile[];
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

/** The most common value, the smallest of those as common; `none` for none. */
function mode(values: number[], none: number): number {
  const count = new Map<number, number>();
  for (const v of values) count.set(v, (count.get(v) ?? 0) + 1);
  let best = none, n = 0;
  for (const [v, c] of [...count].sort((a, b) => a[0] - b[0])) if (c > n) { best = v; n = c; }
  return best;
}

/** The directory and files of a disk for Krill's loader whose files are packed with its ZX0; null when it is not one. */
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
    e.file = { entry: n, load, end: Math.min(load + bytes.length, 0x10000), bytes, sectors: c.sectors, unpacked: basic ? null : unpackKrillZx0(bytes, load), basic };
    return e;
  });
  const files = entries.flatMap(e => (e.file ? [e.file] : []));
  const packed = files.filter(f => f.unpacked).length, other = files.filter(f => !f.unpacked && !f.basic).length;
  if (packed < 2 || packed < 2 * other) return null;
  // the step from a sector to the next on the same track, as cc1541's interleave takes it
  const steps = files.flatMap(f => f.sectors.slice(1).flatMap(([t, s], i) => {
    const [pt, ps] = f.sectors[i];
    return t === pt ? [(s - ps + sectorsOnTrack(t)) % sectorsOnTrack(t)] : [];
  }));
  const bam = sec(18, 0);
  return {
    packer: 'zx0', entries, files, header: img.name, id: petsciiName(bam.subarray(0xa2, 0xa7)), headerRaw: bam.slice(0x90, 0xa0), idRaw: bam.slice(0xa2, 0xa7),
    interleave: mode(steps, 10), tracks,
  };
}

const hx = (v: number, w: number) => v.toString(16).padStart(w, '0');

/** A file's name in the rebuilt script: its directory entry and where it unpacks to (or loads, when it is not packed),
 *  `.zx0` for the file as it is on the disk when it is packed, else `.prg` (the local names are not on the disk). */
export const krillFileName = (f: KrillFile): string => `file${hx(f.entry, 2)}_${hx(f.unpacked?.start ?? f.load, 4)}.${f.unpacked ? 'zx0' : 'prg'}`;
/** The name of a packed file unpacked: a PRG at where it unpacks to. */
export const krillUnpackedName = (f: KrillFile): string => `file${hx(f.entry, 2)}_${hx(f.unpacked?.start ?? f.load, 4)}.prg`;

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
  const n = disk.files.length, unpacked = disk.files.filter(f => f.unpacked).length;
  const out = [
    `# cc1541 command line, rebuilt by Mimir Studio from ${name} (Krill's loader, its ZX0): ${n} file${n === 1 ? '' : 's'}, ${unpacked} of them packed.`,
    '# Krill\'s loader has no load script: a part loads a file by its name, or the next file in the directory with an empty',
    '# name, so the directory is the order they load in. cc1541 writes each file as it is on the disk (packed); the names',
    '# are the directory\'s (# and two hex digits is a PETSCII byte), the local file names are made up from the entry and',
    '# where the file unpacks to.',
  ];
  for (const e of disk.entries) {
    const f = e.file, label = `${hx(e.n, 2)} "${e.name}"`.padEnd(21);
    if (!f) {
      out.push(`#   ${label} ${e.same != null ? `the same file as entry ${hx(e.same, 2)}` : e.track ? `points at ${e.track}/${e.sector}, no file of its own` : 'a line of the directory, no file'}`);
      continue;
    }
    const u = f.unpacked;
    const what = u ? `unpacks to $${hx(u.start, 4)}-$${hx(u.end - 1, 4)} (${u.end - u.start} bytes)` : f.basic ? 'a BASIC program, loaded with LOAD and RUN' : 'not packed with the loader\'s ZX0';
    out.push(`#   ${label} ${krillFileName(f).padEnd(16)} loads at $${hx(f.load, 4)}-$${hx(f.end - 1, 4)} (${f.bytes.length} bytes), ${what}`);
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
