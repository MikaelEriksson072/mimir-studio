/* Tape images (.tap, spec 13.5e): the pulses a datasette reads, and the files on them.
 *
 * A TAP ("C64-TAPE-RAW") holds the length of every pulse the datasette's read head sends to CIA1's FLAG line, from one
 * falling edge to the next: version 0 a byte per pulse in units of 8 cycles (0: a pause longer than that), version 1
 * the same with 0 followed by the exact cycles in 3 bytes, version 2 (the C16's) half waves, two to a pulse.
 *
 * Files are read in these formats:
 * - the KERNAL's own (CBM): a leader of short pulses, then each byte as a long and a medium pulse and 9 bit pairs (8 bits
 *   from the lowest, then odd parity; short + medium is a 0, medium + short a 1), a block ending with long + short. A file
 *   is a header block of 192 bytes (type, start, end, the name, and the rest of the tape buffer at $033c, where many tape
 *   loaders keep their code) and a data block, each written twice (sync bytes $89 … $81, then $09 … $01 for the copy)
 *   and each ending with an XOR checksum;
 * - Martin Piper's TapeTool: two pulse lengths (a 1 twice as long as a 0; by default 256 and 512 cycles), the top bit
 *   first, a leader of $ff $c3, the sync byte $aa; then a full header ($f0, $96, or $b7 for a block packed with RLE, the
 *   file name byte, start, how many blocks the file has, end, a checksum of the header) or the TinyHeader ($69 alone:
 *   only the data and its checksum, as the boot loader in the CBM header knows where it goes and how long it is). A file
 *   written with checksum blocks is a block per page, in any order, and files can be interleaved;
 * - Turbo Tape 64 (and the Action Replay 7.2's "Turbo Tape 250"): a 0 and a 1 around 263 cycles apart, the top bit
 *   first, a leader of $02 and the sync bytes $09 … $01; a header (1, start, end, a byte, the name) and a data block (0,
 *   the bytes, an XOR checksum);
 * - Freeload (Ocean's) and US Gold's loader: a pilot byte, a sync byte, [a name,] start, end, the data and their XOR;
 * - Mega-Save (Palace's, Hewson's, Level 9's, Alligata's …): a pilot of $63, the sync bytes $64 … $ff, a byte, a header
 *   of 10 bytes (start, end, …), the data and their XOR;
 * - Novaload (Novagen's, Elite's, Encore's, US Gold's Americana …): the lowest bit first, a pilot of 0 bits, a 1 and $aa;
 *   a file its LOAD reads (the name, start, end, blocks with a running sum) or the pages its boot file's loader reads;
 * - Wildload (Interceptor Micros' loader, on Activision's, Thalamus' Hits, Electric Dreams', Domark's … tapes): the
 *   lowest bit first, a pilot of $a0, the sync bytes $0a … $01, then a chain of blocks loaded from their last byte down
 *   (wildFiles);
 * - Microload (Interceptor Micros' own games, Electric Dreams', Epyx's …): the same pilot and sync, then the start, the
 *   length as a negative number, the data and their XOR (microFiles);
 * - Cyberload (System 3's, Thalamus', Activision's, Accolade's …): a pilot of $0f before every sync byte, the loader's
 *   four stages each in a format of its own (cyberFirst, cyberSecond, cyberBlocks, cyberNamedFiles);
 * - Firebird's loader (Firebird's, Silverbird's, Rainbird's, Psygnosis', Odin's …): blocks of a pilot byte, its
 *   complement and the pilot again, the first stage's in a chain where each names the next one's pilot, a second kind
 *   in files of their own (firebirdBlocks, firebirdFiles).
 * Anything else that holds data is the turbo data of a loader not known here: the boot program's loader reads it, so
 * Sindri does, running the boot program with the tape in its datasette (13.5f). */
import { Cpu, type Bus } from '@mimir/sindri';
import { petsciiName } from './d64';
import { isT64, readT64, type T64Entry, type T64Info } from './t64';

const hex4 = (v: number) => v.toString(16).padStart(4, '0');
const hex2 = (v: number) => v.toString(16).padStart(2, '0');

/** PAL C64 cycles a second: a TAP counts its pulses in them */
export const TAPE_CLOCK = 985248;

export interface TapPulses {
  /** the TAP version (0, 1 or 2) */
  version: number;
  /** each pulse's length in cycles */
  cycles: Uint32Array;
  /** each pulse's byte offset in the file */
  offsets: Uint32Array;
  /** the time each pulse starts, in cycles from the tape's start (one more: the tape's length) */
  times: Float64Array;
}

const MAGIC = 'C64-TAPE-RAW';
/** a version 0 pause (a 0 byte): as long as VICE takes it */
const V0_PAUSE = 20000;

/** A .tap tape image, known by its header. */
export function isTap(u8: Uint8Array): boolean {
  if (u8.length < 20) return false;
  for (let i = 0; i < MAGIC.length; i++) if (u8[i] !== MAGIC.charCodeAt(i)) return false;
  return true;
}

/** The pulses of a .tap image. */
export function tapPulses(u8: Uint8Array): TapPulses {
  if (!isTap(u8)) throw new Error('not a .tap tape image: it does not start with C64-TAPE-RAW');
  const version = u8[12];
  if (version > 2) throw new Error(`a .tap image of version ${version}: versions 0, 1 and 2 are known`);
  const declared = (u8[16] | (u8[17] << 8) | (u8[18] << 16) | (u8[19] << 24)) >>> 0;
  // a length that says more than the file holds (or nothing at all) is taken as the file's
  const end = declared > 0 && 20 + declared <= u8.length ? 20 + declared : u8.length;
  const cycles: number[] = [], offsets: number[] = [];
  let half = -1, halfAt = 0;
  for (let i = 20; i < end; i++) {
    const at = i;
    let c = u8[i];
    if (c === 0) {
      if (version === 0) c = V0_PAUSE;
      else { c = (u8[i + 1] | (u8[i + 2] << 8) | (u8[i + 3] << 16)) >>> 0; i += 3; }
    } else c *= 8;
    if (version === 2) {
      // half waves: two make a pulse
      if (half < 0) { half = c; halfAt = at; continue; }
      c += half; half = -1;
      cycles.push(c); offsets.push(halfAt);
      continue;
    }
    cycles.push(c); offsets.push(at);
  }
  const times = new Float64Array(cycles.length + 1);
  for (let i = 0; i < cycles.length; i++) times[i + 1] = times[i] + cycles[i];
  return { version, cycles: Uint32Array.from(cycles), offsets: Uint32Array.from(offsets), times };
}

/** `t64`: a file of a T64 tape archive (t64.ts), which holds the files, not the pulses */
export type TapeFormat = 'cbm' | 'tapetool' | 'turbotape' | 'freeload' | 'usgold' | 'megasave' | 'novaload' | 'wildload' | 'microload' | 'cyberload' | 'firebird' | 't64';
/** CBM: a program (type 3, loads where it was saved), a BASIC program (type 1, relocatable: LOAD puts it at the start
 *  of BASIC), a SEQ file (type 4, its data in type 2 blocks), the end-of-tape marker (type 5), or data without a header */
export type TapeFileType = 'PRG' | 'BASIC' | 'SEQ' | 'END' | 'DATA';

export interface TapeFile {
  format: TapeFormat;
  /** the name: CBM and Turbo Tape the header's (PETSCII as text), TapeTool "file N" after its name byte */
  name: string;
  /** the 16 name bytes as stored (CBM and Turbo Tape) */
  raw?: Uint8Array;
  type: TapeFileType;
  /** where it loads and ends (exclusive); null where the tape does not say (TapeTool's TinyHeader when the boot loader
   *  was not read; data without a header) */
  load: number | null;
  end: number | null;
  /** the bytes: a CBM file's data block (the copy read best), a TapeTool file's blocks joined and unpacked */
  data: Uint8Array;
  /** CBM: the 192 header bytes, the tape buffer at $033c after LOAD (its loader code, when it holds some) */
  header?: Uint8Array;
  /** CBM: the header holds more than the name and its padding (a tape loader's code, mostly) */
  headerCode?: boolean;
  /** TapeTool: the file name byte the loader asks for (a T64's entry number, from 1); how many blocks it has, how many
   *  of them were RLE packed; the TinyHeader (no name, no address: the boot loader's next file) */
  id?: number;
  blocks?: number;
  packed?: number;
  tiny?: boolean;
  /** TapeTool: its blocks were not in memory order (written with `n <seed>`); it shares its leader with the file
   *  before it, its blocks mixed with that file's (written after `s`); the leader before it, in TapeTool's units
   *  (a $ff $c3 pair each) */
  shuffled?: boolean;
  interleaved?: boolean;
  leader?: number;
  /** TapeTool: its last block on the tape was RLE packed (TapeTool leaves a longer gap after such a block) */
  lastPacked?: boolean;
  /** CBM: a relocatable program's address in its header (LOAD puts it at the start of BASIC, `load`) */
  saved?: number;
  /** CBM: how many copies of the header and the data were on the tape (2 each, normally) */
  copies?: [number, number];
  /** T64: its directory entry */
  t64?: T64Entry;
  /** the first pulse (the start of its first block) and the pulse after its last one; the TAP file offset of the
   *  first; seconds from the tape's start. A T64's file: its directory slot and the one after it, the offset of its
   *  bytes in the T64, 0 seconds */
  at: number;
  to: number;
  offset: number;
  seconds: number;
  /** what went wrong reading it: checksums, missing blocks, unreadable bytes */
  errors: string[];
  /** what is unusual about it, not an error (a header that says more than its data block holds) */
  note?: string;
}

/** a stretch of the tape with data no format here reads: an unknown loader's turbo data */
export interface TapeUnknown {
  at: number; to: number; offset: number; seconds: number;
  /** pulses in it, and its two pulse lengths (cycles) when it has two */
  pulses: number;
  short: number | null; long: number | null;
}

export interface TapeImage {
  /** the TAP version (a T64's version, $0100 or $0101) */
  version: number;
  /** pulses, and the tape's length in seconds (a T64: 0, 0) */
  pulses: number;
  seconds: number;
  /** the files in tape order */
  files: TapeFile[];
  unknown: TapeUnknown[];
  /** TapeTool's turbo files are on it: how fast (the cycles of a 0, TapeTurboSpeed × 2), and the leader pairs after its
   *  last block (the lead-out) */
  tapetool: { speed: number; leadOut: number } | null;
  /** a T64 tape archive: its header (the files are its directory's) */
  t64?: T64Info;
}

/* ---------------------------------------------------------------------------------------------------------------- */
/* the KERNAL's format                                                                                              */

interface CbmBlock {
  /** the leader's first pulse, the first byte's, and the pulse after the end-of-data marker (or the last byte) */
  lead: number; at: number; to: number;
  bytes: number[];
  /** indexes of bytes not read cleanly (a bit pair or the parity wrong) */
  bad: Set<number>;
}

const CBM_LEADER = 40;

/** The CBM blocks on the tape: each after a leader of short pulses. */
function cbmBlocks(p: TapPulses): CbmBlock[] {
  const c = p.cycles, n = c.length, out: CbmBlock[] = [];
  let i = 0;
  while (i < n) {
    // a leader: a run of similar pulses in the KERNAL's short range
    if (c[i] < 280 || c[i] > 500) { i++; continue; }
    let j = i, sum = 0;
    while (j < n && Math.abs(c[j] - c[i]) < c[i] * 0.2) { sum += c[j]; j++; }
    if (j - i < CBM_LEADER) { i = Math.max(i + 1, j); continue; }
    const block = readCbmBlock(c, j, sum / (j - i));
    if (!block || block.bytes.length < 2) { i = j + 1; continue; }
    block.lead = i;
    out.push(block);
    i = block.to;
  }
  return out;
}

/** The bytes of a block that starts at pulse `at` (a byte marker), the leader's short pulse `s` cycles long. */
function readCbmBlock(c: Uint32Array, at: number, s: number): CbmBlock | null {
  // the pulse lengths, from the short one: medium 1.375×, long 1.79× (they follow the tape's speed as bits come)
  let S = s, M = s * 1.375, L = s * 1.79;
  const kind = (k: number): number => {
    const v = c[k];
    if (v === undefined) return -1;
    if (v < (S + M) / 2) return v < S * 0.6 ? -1 : 0;
    if (v < (M + L) / 2) return 1;
    return v < L * 1.4 ? 2 : -1;
  };
  const isMarker = (k: number) => kind(k) === 2 && kind(k + 1) === 1;
  const isEnd = (k: number) => kind(k) === 2 && kind(k + 1) === 0;
  if (!isMarker(at)) return null;
  const bytes: number[] = [], bad = new Set<number>();
  let k = at;
  for (;;) {
    let v = 0, ok = true, ones = 0;
    for (let b = 0; b < 9; b++) {
      const x = kind(k + 2 + 2 * b), y = kind(k + 3 + 2 * b);
      let bit: number;
      if (x === 0 && y === 1) bit = 0; else if (x === 1 && y === 0) bit = 1; else { ok = false; bit = 0; }
      if (ok) {
        // follow the tape's speed
        const sh = c[k + 2 + 2 * b + bit], md = c[k + 3 + 2 * b - bit];
        S = S * 0.95 + sh * 0.05; M = M * 0.95 + md * 0.05;
      }
      if (b < 8) { v |= bit << b; ones += bit; } else if (((ones + bit) & 1) === 0) ok = false;
    }
    if (!ok) bad.add(bytes.length);
    bytes.push(v);
    L = L * 0.95 + c[k] * 0.05;
    k += 20;
    if (isMarker(k)) continue;
    if (isEnd(k)) { k += 2; break; }
    // a pulse lost or split: the next marker a pulse or two away
    const near = [-1, 1, -2, 2].map(d => k + d).find(x => isMarker(x) || isEnd(x));
    if (near === undefined) break;
    k = near;
    if (isEnd(k)) { k += 2; break; }
  }
  return { lead: at, at, to: k, bytes, bad };
}

interface CbmRead {
  /** 1: the first copy ($89 … $81), 2: the repeat ($09 … $01) */
  copy: 1 | 2;
  data: number[];
  ok: boolean;
  bad: Set<number>;
  block: CbmBlock;
}

function cbmRead(b: CbmBlock): CbmRead | null {
  if (b.bytes.length < 11) return null;
  // the sync bytes count down: most of them must be right (a bad one can be anything)
  let first = 0, rep = 0;
  for (let i = 0; i < 9; i++) { if (b.bytes[i] === 0x89 - i) first++; if (b.bytes[i] === 0x09 - i) rep++; }
  if (Math.max(first, rep) < 6) return null;
  const data = b.bytes.slice(9, -1), sum = b.bytes[b.bytes.length - 1];
  const bad = new Set([...b.bad].filter(i => i >= 9 && i < b.bytes.length - 1).map(i => i - 9));
  const x = data.reduce((a, v) => a ^ v, 0);
  return { copy: first >= rep ? 1 : 2, data, ok: x === sum && !b.bad.has(b.bytes.length - 1) && bad.size === 0, bad, block: b };
}

/** the copy read best, or the two merged byte by byte */
function bestOf(reads: CbmRead[]): { data: Uint8Array; ok: boolean } {
  const good = reads.find(r => r.ok);
  if (good) return { data: Uint8Array.from(good.data), ok: true };
  const len = Math.max(...reads.map(r => r.data.length));
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    const r = reads.find(x => i < x.data.length && !x.bad.has(i)) ?? reads.find(x => i < x.data.length);
    out[i] = r ? r.data[i] : 0;
  }
  return { data: out, ok: false };
}

const CBM_TYPES: Record<number, TapeFileType> = { 1: 'BASIC', 3: 'PRG', 4: 'SEQ', 5: 'END' };

/** The CBM files: a header and its data, each copy read and the best taken. */
function cbmFiles(p: TapPulses, blocks: CbmBlock[]): TapeFile[] {
  const reads = blocks.map(cbmRead);
  const out: TapeFile[] = [];
  const at = (b: CbmBlock) => ({ at: b.lead, offset: p.offsets[b.lead] ?? 0, seconds: (p.times[b.lead] ?? 0) / TAPE_CLOCK });
  const isHeader = (r: CbmRead | null) => !!r && r.data.length === 192 && !!CBM_TYPES[r.data[0]];
  let i = 0;
  while (i < reads.length) {
    const r = reads[i];
    if (!r) { i++; continue; }
    if (!isHeader(r)) {
      // data without a header (or a header that cannot be read)
      const copies = [r];
      if (r.copy === 1 && reads[i + 1]?.copy === 2 && reads[i + 1]!.data.length === r.data.length) copies.push(reads[i + 1]!);
      const best = bestOf(copies);
      out.push({
        format: 'cbm', name: '(data without a header)', type: 'DATA', load: null, end: null, data: best.data,
        ...at(r.block), to: copies[copies.length - 1].block.to, errors: best.ok ? [] : ['checksum: the data could not be read cleanly'],
      });
      i += copies.length;
      continue;
    }
    // a header and its repeat
    const hs = [r];
    let j = i + 1;
    if (r.copy === 1 && isHeader(reads[j]) && reads[j]!.copy === 2) { hs.push(reads[j]!); j++; }
    const h = bestOf(hs), hd = h.data;
    const type = CBM_TYPES[hd[0]];
    const raw = hd.slice(5, 21), start = hd[1] | (hd[2] << 8), stop = hd[3] | (hd[4] << 8);
    const errors: string[] = h.ok ? [] : ['checksum: the header could not be read cleanly'];
    // code or data in the tape buffer after the name: anything but the padding (spaces, or zeros)
    const rest = hd.subarray(21);
    const headerCode = rest.some(v => v !== 0x20) && rest.some(v => v !== 0);
    const file: TapeFile = {
      format: 'cbm', name: petsciiName(raw.map(v => (v === 0x20 ? 0xa0 : v))).trimEnd() || '(no name)', raw, type,
      load: type === 'PRG' || type === 'BASIC' ? start : null, end: type === 'PRG' || type === 'BASIC' ? stop : null,
      data: new Uint8Array(0), header: hd, headerCode, ...at(r.block), to: hs[hs.length - 1].block.to, errors,
    };
    let dataCopies = 0;
    if (type === 'PRG' || type === 'BASIC') {
      const len = (stop - start) & 0xffff;
      const ds: CbmRead[] = [];
      // the data block(s) after it (TapeTool's boot files have one copy); 192 bytes of data can look like a header
      const isData = (x: CbmRead | null) => !!x && (ds.length === 0 ? !isHeader(x) || x.data.length === len : x.copy === 2 && x.data.length === ds[0].data.length);
      while (j < reads.length && ds.length < 2 && isData(reads[j])) { ds.push(reads[j]!); j++; }
      dataCopies = ds.length;
      if (ds.length) {
        const best = bestOf(ds);
        file.data = best.data;
        file.to = ds[ds.length - 1].block.to;
        if (!best.ok) errors.push('checksum: the data could not be read cleanly');
        // the KERNAL stores a block's bytes up to the header's end and only reads the rest: a block that holds more (a
        // whole tape buffer of 192 bytes for the 12 or 52 of a boot file that loads over the vectors at $0300, as
        // Epyx's Summer Games and Incentive's Zodiac have) loads that many, as VICE loads them. A loader that takes over
        // while the KERNAL loads (through a vector the data overwrites) can have the header say more than the block
        // holds: the file is what the block holds
        if (len && best.data.length > len) { file.note = `the data block holds ${best.data.length} bytes, LOAD stores the header's ${len}`; file.data = best.data.slice(0, len); }
        else if (best.data.length !== len) { file.note = `the header says $${hex4(start)}-$${hex4(stop)}, the data block holds ${best.data.length} bytes`; file.end = start + best.data.length; }
      } else errors.push('no data block follows the header');
      // a relocatable program: LOAD (secondary address 0, as typed and as SHIFT+RUN/STOP does it) puts it at the start
      // of BASIC
      if (type === 'BASIC' && start !== 0x0801) {
        file.saved = start;
        file.load = 0x0801;
        file.end = 0x0801 + file.data.length;
        file.note = `${file.note ? `${file.note}; ` : ''}saved from $${hex4(start)}: LOAD puts a relocatable program at the start of BASIC, $0801`;
      }
    } else if (type === 'SEQ') {
      // type 2 blocks: 191 bytes each
      const parts: number[] = [];
      while (j < reads.length && reads[j] && reads[j]!.data.length === 192 && reads[j]!.data[0] === 2) {
        const ds = [reads[j]!];
        j++;
        if (ds[0].copy === 1 && reads[j]?.copy === 2 && reads[j]!.data[0] === 2) { ds.push(reads[j]!); j++; }
        const best = bestOf(ds);
        if (!best.ok) errors.push('checksum: a data block could not be read cleanly');
        parts.push(...best.data.subarray(1));
        file.to = ds[ds.length - 1].block.to;
        dataCopies = Math.max(dataCopies, ds.length);
      }
      file.data = Uint8Array.from(parts);
    }
    file.copies = [hs.length, dataCopies];
    out.push(file);
    i = j;
  }
  return out;
}

/* ---------------------------------------------------------------------------------------------------------------- */
/* turbo data: two pulse lengths                                                                                    */

interface Region { from: number; to: number }

/** The stretches of the tape outside the CBM blocks, split at pauses. */
function regions(p: TapPulses, cbm: CbmBlock[]): Region[] {
  const n = p.cycles.length, out: Region[] = [];
  const taken = new Uint8Array(n);
  for (const b of cbm) taken.fill(1, b.at, b.to);
  let i = 0;
  while (i < n) {
    while (i < n && (taken[i] || p.cycles[i] > 4000)) i++;
    const from = i;
    while (i < n && !taken[i] && p.cycles[i] <= 4000) i++;
    if (i - from >= 64) out.push({ from, to: i });
  }
  return out;
}

/** The two pulse lengths of a stretch (from its busiest pulse lengths), or null when it has no two that a turbo
 *  could use (a 1 1.3 to 3 times as long as a 0). */
function twoLengths(c: Uint32Array, from: number, to: number): { short: number; long: number } | null {
  const hist = new Float64Array(512);
  for (let i = from; i < to; i++) hist[Math.min(511, c[i] >> 3)]++;
  const smooth = (b: number) => (hist[b - 1] ?? 0) + hist[b] + (hist[b + 1] ?? 0);
  let a = 1;
  for (let b = 1; b < 511; b++) if (smooth(b) > smooth(a)) a = b;
  let best = -1;
  for (let b = 1; b < 511; b++) {
    const r = b > a ? b / a : a / b;
    if (r < 1.3 || r > 3) continue;
    if (best < 0 || smooth(b) > smooth(best)) best = b;
  }
  if (best < 0 || smooth(best) < (to - from) * 0.05) return null;
  // the centres of the two peaks
  const centre = (b: number) => { let s = 0, w = 0; for (let x = b - 2; x <= b + 2; x++) if (x > 0 && x < 512) { s += hist[x] * x; w += hist[x]; } return (s / w) * 8; };
  const x = centre(a), y = centre(best);
  return { short: Math.min(x, y), long: Math.max(x, y) };
}

/** The two lengths of the stretch before, for a stretch with too few pulses of a second length for twoLengths (a block
 *  of mostly 0 bits, as Cyberload's blocks of an empty part of a picture): when nine in ten of its pulses are of them. */
function sameLengths(c: Uint32Array, from: number, to: number, prev: { short: number; long: number } | null): { short: number; long: number } | null {
  if (!prev) return null;
  let near = 0;
  for (let i = from; i < to; i++) if (Math.abs(c[i] - prev.short) <= prev.short * 0.2 || Math.abs(c[i] - prev.long) <= prev.long * 0.2) near++;
  return near >= (to - from) * 0.9 ? prev : null;
}

/** The bits of a stretch, a 1 for a pulse longer than `threshold`. */
function bitsOf(c: Uint32Array, r: Region, threshold: number): Uint8Array {
  const out = new Uint8Array(r.to - r.from);
  for (let i = r.from; i < r.to; i++) out[i - r.from] = c[i] > threshold ? 1 : 0;
  return out;
}

/** A stretch that is a leader: read as bytes (at the alignment that gives the fewest values), four values or fewer
 *  make 90 % of it ($ff $c3, $02, $40 …), where data has many. */
function isLeader(bits: Uint8Array): boolean {
  for (let align = 0; align < 8; align++) {
    const counts = new Map<number, number>();
    let n = 0;
    for (let at = align; at + 8 <= bits.length; at += 8, n++) { const v = msbByte(bits, at); counts.set(v, (counts.get(v) ?? 0) + 1); }
    const top = [...counts.values()].sort((a, b) => b - a).slice(0, 4).reduce((a, v) => a + v, 0);
    if (n && top >= n * 0.9) return true;
  }
  return false;
}

/** byte `k` of a bit stream from bit `at`, the top bit first (-1 past the end) */
function msbByte(bits: Uint8Array, at: number): number {
  if (at < 0 || at + 8 > bits.length) return -1;
  let v = 0;
  for (let i = 0; i < 8; i++) v = (v << 1) | bits[at + i];
  return v;
}

/* ---- TapeTool ---- */

interface TtBlock {
  tiny: boolean;
  id: number; start: number; end: number; count: number; rle: boolean;
  /** the bytes as they load (unpacked) */
  bytes: Uint8Array;
  ok: boolean;
  headerOk: boolean;
  at: number; to: number;
  /** leader bytes ($ff and $c3) right before its sync */
  lead: number;
}

const TT_SYNC = 0xaa, TT_EX = 0xf0, TT_EX2 = 0x96, TT_EX2_RLE = 0xb7, TT_EX3 = 0x69;

/** TapeTool's RLE: the first byte is the escape; escape, count (0 = 256), value is a run; a last escape ends it. */
export function tapeToolRle(packed: Uint8Array): Uint8Array {
  const out: number[] = [];
  if (!packed.length) return new Uint8Array(0);
  const esc = packed[0];
  let i = 1;
  while (i < packed.length) {
    const b = packed[i++];
    if (b !== esc) { out.push(b); continue; }
    if (i >= packed.length) break;
    const n = packed[i++] || 256, v = packed[i++];
    for (let k = 0; k < n; k++) out.push(v);
  }
  return Uint8Array.from(out);
}

function tapeToolBlocks(bits: Uint8Array, base: number): TtBlock[] {
  const out: TtBlock[] = [];
  let reg = 0, k = 0;
  const leadBefore = (at: number) => { let n = 0; while (msbByte(bits, at - 16 * (n + 1)) === 0xff && msbByte(bits, at - 16 * n - 8) === 0xc3) n++; return 2 * n; };
  const leaderAt = (at: number) => { for (let i = 0; i < 4; i++) { const x = msbByte(bits, at + 16 * i), y = msbByte(bits, at + 16 * i + 8); if (!((x === 0xff && y === 0xc3) || (x === 0xc3 && y === 0xff))) return false; } return true; };
  while (k < bits.length) {
    reg = ((reg << 1) | bits[k]) & 0xff;
    k++;
    if (reg !== TT_SYNC) continue;
    const syncAt = k - 8;
    const b1 = msbByte(bits, k);
    if (b1 === TT_EX) {
      const h = Array.from({ length: 8 }, (_, i) => msbByte(bits, k + 8 + 8 * i));
      if (h.some(v => v < 0)) continue;
      const [ex2, id, lo, hi, count, elo, ehi, sum] = h;
      if (ex2 !== TT_EX2 && ex2 !== TT_EX2_RLE) continue;
      const x = [TT_SYNC, TT_EX, ex2, id, lo, hi, count, elo, ehi].reduce((a, v) => a ^ v, 0);
      if (x !== sum) continue;
      const rle = ex2 === TT_EX2_RLE, start = lo | (hi << 8);
      const len = rle ? elo : ((elo | (ehi << 8)) - start) & 0xffff;
      if (!len) continue;
      let at = k + 72;
      const raw = new Uint8Array(len);
      let ok = true;
      for (let i = 0; i < len; i++) { const v = msbByte(bits, at); if (v < 0) { ok = false; break; } raw[i] = v; at += 8; }
      const chk = msbByte(bits, at);
      at += 8;
      ok = ok && chk === raw.reduce((a, v) => a ^ v, 0);
      const bytes = rle ? tapeToolRle(raw) : raw;
      const end = rle ? start + ehi + 1 : elo | (ehi << 8);
      out.push({ tiny: false, id, start, end, count, rle, bytes, ok, headerOk: true, at: base + syncAt, to: base + Math.min(at, bits.length), lead: leadBefore(syncAt) });
      k = at; reg = 0;
      continue;
    }
    // the TinyHeader has nothing to check but the checksum at its end: only after TapeTool's own leader
    if (b1 === TT_EX3 && leaderAt(syncAt - 64)) {
      // the data runs to the leader of the next file (or the end of the stretch); the byte before it is the checksum
      const bytes: number[] = [];
      let at = k + 8;
      while (at + 8 <= bits.length && !leaderAt(at)) { bytes.push(msbByte(bits, at)); at += 8; }
      if (bytes.length < 2) continue;
      // the checksum is the last byte before the next leader; at the end of a stretch, where the checksum fits with
      // nothing after it but a trailer (one or two values)
      let x = 0, cut = -1;
      for (let i = 0; i + 1 < bytes.length; i++) x ^= bytes[i];
      if (x === bytes[bytes.length - 1]) cut = bytes.length - 1;
      x = 0;
      for (let i = 0; i + 1 < bytes.length && cut < 0; i++) {
        x ^= bytes[i];
        if (x === bytes[i + 1] && new Set(bytes.slice(i + 2)).size <= 2) cut = i + 1;
      }
      const ok = cut > 0;
      const data = Uint8Array.from(bytes.slice(0, ok ? cut : bytes.length));
      const to = ok ? k + 8 + 8 * (cut + 1) : at;
      out.push({ tiny: true, id: -1, start: 0, end: data.length, count: 1, rle: false, bytes: data, ok, headerOk: true, at: base + syncAt, to: base + to, lead: leadBefore(syncAt) });
      k = to; reg = 0;
    }
  }
  return out;
}

/** The TinyHeader file's place, from the boot loader that reads it: `sta <start>` (the address it stores at, counted up
 *  by the code), then `lda` of that operand's bytes compared with the end's (`cmp #<end`, `cmp #>end`). */
function tinyPlace(boot: TapeFile[]): { load: number; end: number } | null {
  for (const f of boot) {
    const mem = new Map<number, number>();
    f.header?.forEach((v, i) => mem.set(0x033c + i, v));
    if (f.load != null) f.data.forEach((v, i) => mem.set((f.load! + i) & 0xffff, v));
    const at = (a: number) => mem.get(a & 0xffff) ?? -1;
    for (const a of mem.keys()) {
      if (at(a) !== 0x8d) continue;
      const lo = at(a + 1), hi = at(a + 2);
      let endLo = -1, endHi = -1;
      for (let b = a + 3; b < a + 48; b++) {
        if (at(b) !== 0xad || at(b + 3) !== 0xc9) continue;
        const op = at(b + 1) | (at(b + 2) << 8);
        if (op === ((a + 1) & 0xffff)) endLo = at(b + 4);
        if (op === ((a + 2) & 0xffff)) endHi = at(b + 4);
      }
      if (endLo >= 0 && endHi >= 0) return { load: lo | (hi << 8), end: endLo | (endHi << 8) };
    }
  }
  return null;
}

/** TapeTool's files: a TinyHeader file each, and a file's blocks (same name byte, until its count) joined. */
function tapeToolFiles(p: TapPulses, blocks: TtBlock[], before: TapeFile[]): TapeFile[] {
  const out: TapeFile[] = [];
  const where = (at: number) => ({ at, offset: p.offsets[at] ?? 0, seconds: (p.times[at] ?? 0) / TAPE_CLOCK });
  const open = new Map<number, { blocks: TtBlock[]; pages: Set<number> }>();
  const groups: TtBlock[][] = [];
  for (const b of blocks) {
    if (b.tiny) { groups.push([b]); continue; }
    let g = open.get(b.id);
    if (g && g.pages.has(b.start)) { open.delete(b.id); g = undefined; }
    if (!g) { g = { blocks: [], pages: new Set() }; open.set(b.id, g); groups.push(g.blocks); }
    g.blocks.push(b);
    g.pages.add(b.start);
    if (g.blocks.length >= b.count) open.delete(b.id);
  }
  groups.sort((x, y) => x[0].at - y[0].at);
  for (const g of groups) {
    const first = g[0];
    if (first.tiny) {
      const boot = before.filter(f => f.format === 'cbm' && f.at < first.at);
      const place = tinyPlace(boot.reverse());
      const errors = first.ok ? [] : ['checksum: the data could not be read cleanly'];
      if (place && ((place.end - place.load) & 0xffff) !== first.bytes.length) errors.push(`the boot loader reads ${(place.end - place.load) & 0xffff} bytes to $${place.load.toString(16).padStart(4, '0')}, the tape holds ${first.bytes.length}`);
      out.push({
        format: 'tapetool', name: 'TinyHeader file', type: 'PRG', load: place?.load ?? null, end: place ? place.load + first.bytes.length : null,
        data: first.bytes, tiny: true, blocks: 1, packed: 0, leader: Math.round(first.lead / 2), ...where(first.at), to: first.to, errors,
      });
      continue;
    }
    // written after `s`: its first block comes before the last block of the file before it
    const prev = out[out.length - 1];
    const interleaved = !!prev && prev.format === 'tapetool' && !prev.tiny && prev.to > first.at;
    const load = Math.min(...g.map(b => b.start)), end = Math.max(...g.map(b => b.end));
    const data = new Uint8Array(Math.max(0, end - load));
    const errors: string[] = [];
    const have = new Uint8Array(data.length);
    for (const b of g) {
      data.set(b.bytes.subarray(0, Math.max(0, Math.min(b.bytes.length, end - b.start))), b.start - load);
      have.fill(1, b.start - load, b.start - load + b.bytes.length);
      if (!b.ok) errors.push(`checksum: the block at $${b.start.toString(16).padStart(4, '0')} could not be read cleanly`);
      if (b.rle && b.bytes.length !== b.end - b.start) errors.push(`the RLE block at $${b.start.toString(16).padStart(4, '0')} unpacks to ${b.bytes.length} bytes, not ${b.end - b.start}`);
    }
    if (g.length < first.count) errors.push(`${first.count - g.length} of its ${first.count} blocks are not on the tape`);
    else if (have.includes(0)) errors.push('the blocks leave gaps');
    out.push({
      format: 'tapetool', name: `file ${first.id}`, type: 'PRG', load, end, data, id: first.id, blocks: g.length, packed: g.filter(b => b.rle).length,
      shuffled: g.some((b, i) => i > 0 && b.start < g[i - 1].start), interleaved, leader: interleaved ? 0 : Math.round(first.lead / 2),
      lastPacked: g.reduce((a, b) => (b.to > a.to ? b : a)).rle,
      ...where(first.at), to: Math.max(...g.map(b => b.to)), errors,
    });
  }
  return out;
}

/* ---- Turbo Tape 64 ---- */

/** a Turbo Tape block: where its sync starts, and where its first byte (the id: 1 or 2 a header, 0 data) is */
interface TurboSync { at: number; bit: number; id: number }

/** Turbo Tape's syncs: the leader $02, then $09 … $01. */
function turboTapeSyncs(bits: Uint8Array): TurboSync[] {
  const out: TurboSync[] = [];
  let reg = 0, k = 0;
  while (k < bits.length) {
    reg = ((reg << 1) | bits[k]) & 0xffffff;
    k++;
    if (reg !== 0x020209) continue;
    let at = k, good = true;
    for (let v = 8; v >= 1; v--, at += 8) if (msbByte(bits, at) !== v) { good = false; break; }
    const id = msbByte(bits, at);
    if (!good || id < 0 || id > 2) continue;
    out.push({ at: k - 8, bit: at, id });
    k = at + 8; reg = 0;
  }
  return out;
}

/** Turbo Tape's files: a header (the id, start, end, a byte, the 16 name bytes) and the data block after it (0, the
 *  bytes, their XOR), read to the length the header gives (the data can hold anything, the leader's $02 too). */
function turboTapeFiles(p: TapPulses, bits: Uint8Array, base: number): TapeFile[] {
  const out: TapeFile[] = [];
  const syncs = turboTapeSyncs(bits);
  for (let i = 0; i + 1 < syncs.length; i++) {
    const h = syncs[i], d = syncs[i + 1];
    if (h.id === 0 || d.id !== 0) continue;
    const head = Array.from({ length: 22 }, (_, k) => msbByte(bits, h.bit + 8 * k));
    if (head.includes(-1)) continue;
    const start = head[1] | (head[2] << 8), stop = head[3] | (head[4] << 8), len = (stop - start) & 0xffff;
    if (!len || stop <= start) continue;
    const data = new Uint8Array(len);
    let at = d.bit + 8, x = 0, whole = true;
    for (let k = 0; k < len; k++, at += 8) { const v = msbByte(bits, at); if (v < 0) { whole = false; break; } data[k] = v; x ^= v; }
    const sum = msbByte(bits, at);
    // a checksum that fits is what tells Turbo Tape from other loaders with its leader and sync
    if (!whole || sum !== x) continue;
    const raw = Uint8Array.from(head.slice(6, 22));
    out.push({
      format: 'turbotape', name: petsciiName(raw.map(v => (v === 0x20 ? 0xa0 : v))).trimEnd() || '(no name)', raw, type: 'PRG',
      load: start, end: stop, data, at: base + h.at, offset: p.offsets[base + h.at] ?? 0, seconds: (p.times[base + h.at] ?? 0) / TAPE_CLOCK, to: base + at + 8, errors: [],
    });
    i++;
  }
  return out;
}

/* ---- Freeload and US Gold's loader ---- */

/** Turbo formats of a pilot byte, a sync byte and a plain header, the top bit first; learned from the bytes their
 *  loaders stored as Sindri ran them with the tape: Freeload (Ocean, Imagine, Mastertronic, Domark …: pilot $40, sync
 *  $5a, start, end, the data, their XOR) and US Gold's loader (Freeload's bit reading: pilot $20, sync $ff, a 16-byte
 *  name, start, end, the data, their XOR) */
const PILOT_FORMATS: { format: TapeFormat; pilot: number; sync: number; name: boolean }[] = [
  { format: 'freeload', pilot: 0x40, sync: 0x5a, name: false },
  { format: 'usgold', pilot: 0x20, sync: 0xff, name: true },
];

/** the pilot bytes in front of a file whose sum does not match, at least: real files have 64 to 128 (Ghostbusters'
 *  charset 64), data that happens to hold the pilot and the sync two */
const PILOT_LONG = 16;
/** the bits a stretch may go on after such a file's sum: it ends with the file (Ghostbusters' charset has 3) */
const PILOT_TAIL = 64;

/** The files of the pilot formats in a stretch, and `doubtful` ones whose sum does not match: a long pilot leads to
 *  them and the stretch ends with their sum, so they are files, not data that happens to hold the pilot and the sync.
 *  readTape keeps those on a tape where other files of the format pass their sums (their loaders check only some:
 *  Ghostbusters' boot checks the sum of the last file of a row, not of the charset at $7000 before it). */
function pilotFiles(p: TapPulses, bits: Uint8Array, base: number): { files: TapeFile[]; doubtful: TapeFile[] } {
  const out: TapeFile[] = [], doubtful: TapeFile[] = [];
  for (const fmt of PILOT_FORMATS) {
    const want = (fmt.pilot << 16) | (fmt.pilot << 8) | fmt.sync;
    let reg = 0, k = 0;
    while (k < bits.length) {
      reg = ((reg << 1) | bits[k]) & 0xffffff;
      k++;
      if (reg !== want) continue;
      const syncAt = k - 24;
      let at = k;
      const take = () => { const v = msbByte(bits, at); at += 8; return v; };
      const raw = fmt.name ? Uint8Array.from({ length: 16 }, take) : null;
      const start = take() | (take() << 8), stop = take() | (take() << 8);
      if (raw?.includes(255) || stop <= start || at > bits.length) continue;
      const data = new Uint8Array(stop - start);
      let x = 0, whole = true;
      for (let i = 0; i < data.length; i++) { const v = take(); if (v < 0) { whole = false; break; } data[i] = v; x ^= v; }
      if (!whole) continue;
      const sum = take();
      const file = (errors: string[]): TapeFile => {
        const name = raw ? petsciiName(raw.map(v => (v === 0x20 ? 0xa0 : v))).trimEnd() || "(no name)" : `file_${hex4(start)}`;
        return { format: fmt.format, name, ...(raw ? { raw } : {}), type: 'PRG', load: start, end: stop, data, at: base + syncAt, offset: p.offsets[base + syncAt] ?? 0, seconds: (p.times[base + syncAt] ?? 0) / TAPE_CLOCK, to: base + at, errors };
      };
      // the checksum tells the format from data that happens to hold its pilot and sync
      if (sum === x) { out.push(file([])); k = at; reg = 0; continue; }
      // a header whose end takes in the sum, and the stretch ends there: the last byte loaded is the XOR of the bytes
      // before it, and the loader reads its sum off what comes after (Gauntlet's first level "A": $2000-$2e01, its
      // sum at $2e00; the game's loader stores 3 585 bytes and reads the sum from the next file's pilot, unchecked)
      if (sum < 0 && x === 0 && data.length > 1 && bits.length - (at - 8) < 8) {
        out.push({ ...file([]), to: base + bits.length, note: `the header's end takes in the sum: the last byte it loads, at $${hex4(stop - 1)}, is the XOR of the bytes before it, and the tape has no sum after it` });
        k = at; reg = 0; continue;
      }
      let pilot = 2;
      while (msbByte(bits, k - 16 - pilot * 8) === fmt.pilot) pilot++;
      if (sum >= 0 && bits.length - at < PILOT_TAIL && pilot >= PILOT_LONG) doubtful.push(file([`checksum: the data's XOR is $${hex2(x)}, the tape says $${hex2(sum)}`]));
    }
  }
  return { files: out, doubtful };
}

/* ---- Mega-Save ---- */

/* Mega-Save (TAPClean's name; Final TAP's CHR, after Cauldron, Hewson and Rainbird): the loader in the boot file's tape
 * header waits for a pulse on the FLAG line and restarts CIA2's timer B, one shot from $0107, $016e or $01fa cycles
 * (the three speeds), whose underflow is a 1, the top bit first. Each file: a pilot of $63, the sync bytes $64 … $ff, a
 * byte that is not 0, 10 header bytes (start, end, where it starts the program, a flag to load the next file, a flag to
 * jump there, two more), the data and their XOR. Learned from the boot of Tazz; Palace's, Hewson's, Level 9's,
 * Alligata's, Llamasoft's tapes and others have it. */

/** the sync bytes after the pilot; the pilot bytes it needs before them (its tapes have hundreds; a table of the
 *  bytes 0 to 255 in another loader's data has one) */
const MEGA_SYNC = 0xff - 0x64 + 1;
const MEGA_PILOT = 8;

function megaSaveFiles(p: TapPulses, bits: Uint8Array, base: number): TapeFile[] {
  const out: TapeFile[] = [];
  let reg = 0;
  for (let k = 0; k < bits.length; k++) {
    reg = ((reg << 1) | bits[k]) & 0xffff;
    if (reg !== 0x6364) continue;
    const syncAt = k - 15;
    let lead = 1;
    while (lead < MEGA_PILOT && msbByte(bits, syncAt - 8 * lead) === 0x63) lead++;
    if (lead < MEGA_PILOT) continue;
    let at = k + 1, n = 1;
    while (n < MEGA_SYNC && msbByte(bits, at) === 0x64 + n) { at += 8; n++; }
    // all 156 bytes counting up; the loader starts over when the byte after them is 0
    if (n < MEGA_SYNC) continue;
    const take = () => { const v = msbByte(bits, at); at += 8; return v; };
    if (take() <= 0) continue;
    const head = Array.from({ length: 10 }, take);
    if (head.includes(-1)) continue;
    const start = head[0] | (head[1] << 8), stop = head[2] | (head[3] << 8) || 0x10000;
    if (stop <= start) continue;
    const data = new Uint8Array(stop - start);
    let x = 0, whole = true;
    for (let i = 0; i < data.length; i++) { const v = take(); if (v < 0) { whole = false; break; } data[i] = v; x ^= v; }
    const sum = take();
    const errors = !whole ? ['the data runs past the end of the turbo stretch'] : sum !== x ? ['checksum: the data could not be read cleanly'] : [];
    // what the boot's loader does after it: the next file, a jump, or RUN (BASIC relinked, RUN typed into the keyboard buffer)
    const note = head[6] ? 'the loader goes on to the next file' : head[7] ? `the loader starts it at $${hex4(head[4] | (head[5] << 8))}` : 'the loader RUNs it';
    out.push({ format: 'megasave', name: `file_${hex4(start)}`, type: 'PRG', load: start, end: stop, data, note, at: base + syncAt, offset: p.offsets[base + syncAt] ?? 0, seconds: (p.times[base + syncAt] ?? 0) / TAPE_CLOCK, to: base + Math.min(at, bits.length), errors });
    k = at - 1; reg = 0;
  }
  return out;
}

/* ---- Novaload ---- */

/* Novaload (Novagen's own, and Elite's, Encore's, US Gold's Americana, Epyx's, MicroProse's, Martech's … tapes): a pulse
 * longer than about 500 cycles is a 1 (CIA1's timer A, one shot from $03f4, has gone below $0200; the first Novaload
 * read the top bit of $81f4), the lowest bit first; before each file a pilot of 0 bits (about 2 060), a 1 and the sync
 * byte $aa. Then one of two kinds:
 * - a file (what Novaload's LOAD reads, by name): the length of its name, the name, its start less 256, its end, the
 *   bytes in its last block and its blocks plus one, the sum of these bytes; then its blocks, 256 bytes each but the
 *   last, each followed by the sum of all the bytes after the sync byte before it (the sums too);
 * - what the loader in the boot file's tape header reads in its IRQ: the byte $55, then blocks of a page each (the
 *   page, its 256 bytes, their sum with the page) until a page 0.
 * Learned from Paperboy's (Elite) boot and its LOAD as Sindri ran them with the tape. */

/** zero bits a Novaload pilot needs (its tapes have about 2 060, from 2 006; another loader's data has a few dozen) */
const NOVA_PILOT = 256;

/** byte `k` of a bit stream from bit `at`, the lowest bit first (-1 past the end) */
function lsbByte(bits: Uint8Array, at: number): number {
  if (at < 0 || at + 8 > bits.length) return -1;
  let v = 0;
  for (let i = 0; i < 8; i++) v |= bits[at + i] << i;
  return v;
}

function novaFiles(p: TapPulses, bits: Uint8Array, base: number): TapeFile[] {
  const out: TapeFile[] = [];
  let zeros = 0;
  for (let k = 0; k < bits.length; k++) {
    if (!bits[k]) { zeros++; continue; }
    const pilot = zeros;
    zeros = 0;
    if (pilot < NOVA_PILOT || lsbByte(bits, k + 1) !== 0xaa) continue;
    const r = novaFile(p, bits, base, k) ?? novaPages(p, bits, base, k);
    if (!r) continue;
    out.push(...r.files);
    k = r.end - 1;
  }
  return out;
}

const fileAt = (p: TapPulses, at: number) => ({ at, offset: p.offsets[at] ?? 0, seconds: (p.times[at] ?? 0) / TAPE_CLOCK });

/** A Novaload file from its 1 before the sync byte at bit `k`: its header has to add up, and its blocks have to be as
 *  many as from its start to its end. */
function novaFile(p: TapPulses, bits: Uint8Array, base: number, k: number): { files: TapeFile[]; end: number } | null {
  let at = k + 9;
  const take = () => { const v = lsbByte(bits, at); at += 8; return v; };
  const n = take();
  if (n < 0 || n > 16) return null;
  const named = Array.from({ length: n }, take), head = Array.from({ length: 6 }, take);
  if (named.includes(-1) || head.includes(-1)) return null;
  const raw = Uint8Array.from(named);
  let sum = [n, ...named, ...head].reduce((a, v) => (a + v) & 0xff, 0);
  if (take() !== sum) return null;
  sum = (sum * 2) & 0xff;
  const start = ((head[0] | (head[1] << 8)) + 0x100) & 0xffff, blocks = head[5] - 1, last = head[4];
  const length = blocks * 256 + last, end = head[2] | (head[3] << 8) || 0x10000;
  if (blocks < 0 || !length || start + length !== end) return null;
  const data = new Uint8Array(length), errors: string[] = [];
  let o = 0;
  for (let b = 0; b <= blocks && o < length; b++) {
    const size = b < blocks ? 256 : last;
    for (let i = 0; i < size; i++) {
      const v = take();
      if (v < 0) { errors.push('the data runs past the end of the turbo stretch'); break; }
      data[o++] = v;
      sum = (sum + v) & 0xff;
    }
    const v = errors.length ? -1 : take();
    if (v < 0) { if (!errors.length) errors.push('the data runs past the end of the turbo stretch'); break; }
    if (v !== sum) errors.push(`checksum: the block at $${hex4((start + o - size) & 0xffff)} could not be read cleanly`);
    sum = (sum + v) & 0xff;
  }
  const name = petsciiName(raw.map(v => (v === 0x20 ? 0xa0 : v))).trimEnd() || `file_${hex4(start)}`;
  return { files: [{ format: 'novaload', name, ...(n ? { raw } : {}), type: 'PRG', load: start, end, data, ...fileAt(p, base + k), to: base + Math.min(at, bits.length), errors }], end: Math.min(at, bits.length) };
}

/** The pages the boot file's loader reads after the sync byte at bit `k`: $55, then page by page up to a page 0. A page
 *  whose sum does not fit is taken (with an error) where the one after it fits; files are pages that follow on from
 *  each other in memory. Two pages have to fit (one page fits by chance in other data now and then). */
function novaPages(p: TapPulses, bits: Uint8Array, base: number, k: number): { files: TapeFile[]; end: number } | null {
  let at = k + 9;
  if (lsbByte(bits, at) !== 0x55) return null;
  at += 8;
  const page = (from: number) => {
    const pg = lsbByte(bits, from);
    if (pg <= 0) return null;
    const data = new Uint8Array(256);
    let sum = pg;
    for (let i = 0; i < 256; i++) { const v = lsbByte(bits, from + 8 + i * 8); if (v < 0) return null; data[i] = v; sum = (sum + v) & 0xff; }
    return { page: pg, data, ok: lsbByte(bits, from + 8 + 256 * 8) === sum, at: from, to: from + 8 * 258 };
  };
  const pages: NonNullable<ReturnType<typeof page>>[] = [];
  for (let pg = page(at); pg; pg = page(at)) {
    if (!pg.ok && !page(pg.to)?.ok) break;
    pages.push(pg);
    at = pg.to;
  }
  if (pages.filter(x => x.ok).length < 2) return null;
  const groups: (typeof pages)[] = [];
  for (const pg of pages) {
    const g = groups[groups.length - 1];
    if (g && g[g.length - 1].page + 1 === pg.page) g.push(pg);
    else groups.push([pg]);
  }
  const files = groups.map((g, i): TapeFile => {
    const load = g[0].page << 8, data = new Uint8Array(g.length * 256);
    g.forEach((pg, j) => data.set(pg.data, j * 256));
    return {
      format: 'novaload', name: `file_${hex4(load)}`, type: 'PRG', load, end: load + data.length, data,
      ...fileAt(p, base + (i ? g[0].at : k)), to: base + g[g.length - 1].to,
      errors: g.filter(pg => !pg.ok).map(pg => `checksum: the page at $${hex4(pg.page << 8)} could not be read cleanly`),
      note: `the boot file's loader reads it, ${g.length} page${g.length === 1 ? '' : 's'}`,
    };
  });
  return { files, end: at };
}

/* ---- Wildload ---- */

/* Wildload (TAPClean's name), Interceptor Micros' loader: each chain's first block fills the tape buffer with "WILD SAVE
 * (C) INTERCEPTOR MICROS 1987 WRITTEN BY ANDREW CHALLIS JANUARY 1987". Activision's, Thalamus' Hits, Electric Dreams',
 * Domark's, Image Works', Incentive's, Mirrorsoft's … tapes (Interceptor's own games have Microload, another format with
 * the same pilot and sync bytes: the start, the length as a negative number, the data from the first byte up). The boot
 * file, started through the IRQ vector the KERNAL's LOAD puts back from $029f, reads the loader's 208 bytes into the
 * stack page with the KERNAL ($f84a), decrypts them with its tape header and reads the rest in an IRQ on the FLAG line:
 * CIA1's timer A, restarted from $03e0 at each pulse, is below $0200 (bit 1 of its high byte) after a pulse longer than
 * about 480 cycles, a 1; the lowest bit first. A pilot of $a0 (found bit by bit), the sync bytes $0a … $01, then blocks one after another with nothing between
 * them: a header of 5 bytes (the address of the block's last byte, how many bytes it has, a flag), its bytes from the
 * last one down, each XOR the low byte of its address, and the XOR of the bytes it stored. A header with the flag $fe ends
 * the chain (the loader jumps into what it loaded), $ff makes it look for the next pilot; any other flag is a block,
 * stored with $01 = 0 when the flag is 0 (into the RAM under the I/O), else with $01 = 5, so a block at $d000-$dfff goes
 * to the VIC's and the CIAs' registers and the colour RAM: the loading picture's. Learned from Delta's (Thalamus) loader,
 * run in Sindri with the tape: every byte it stored is the reader's, in the same order. */

/** pilot bytes a Wildload chain needs before its sync (its tapes have 230 to 256) */
const WILD_PILOT = 32;
/** the sync bytes after the pilot $a0, Wildload's and Microload's: $0a … $01 */
const A0_SYNC = 10;

/** What a pilot of $a0 (at least `min` bytes, found bit by bit, the lowest bit first) and the sync bytes $0a … $01
 *  lead to: `read` gets the pilot's first bit and the bit after the sync, and gives what it read and the bit it ends
 *  at, or null; the scan goes on from there, or from the end of the pilot (as the loaders look for it bit by bit again
 *  after a byte that is not the sync). */
function a0Pilots<T>(bits: Uint8Array, min: number, read: (from: number, at: number) => { v: T; end: number } | null): T[] {
  const out: T[] = [];
  let reg = 0;
  for (let k = 0; k < bits.length; k++) {
    reg = (reg >> 1) | (bits[k] << 7);
    // (a byte needs eight bits: three bits 1, 0, 1 at the start of the stretch make $a0 too)
    if (reg !== 0xa0 || k < 7) continue;
    const from = k - 7;
    let at = from, n = 0, s = 0;
    while (lsbByte(bits, at) === 0xa0) { at += 8; n++; }
    while (s < A0_SYNC && lsbByte(bits, at + 8 * s) === 0x0a - s) s++;
    const r = n >= min && s === A0_SYNC ? read(from, at + 8 * A0_SYNC) : null;
    k = (r ? r.end : at) - 1;
    reg = r ? 0 : 0xa0;
    if (r) out.push(r.v);
  }
  return out;
}

function wildFiles(p: TapPulses, bits: Uint8Array, base: number): TapeFile[] {
  return a0Pilots(bits, WILD_PILOT, (from, at) => { const c = wildChain(p, bits, base, from, at); return c && { v: c.files, end: c.end }; }).flat();
}

/** The blocks of a Wildload chain from its first header at bit `at` (its pilot at `from`): a file each, up to the header
 *  that ends the chain. The first block's sum has to match (other loaders have the pilot $a0 and the same sync bytes:
 *  Microload, Rainbow Arts'); a later one whose sum does not is kept with an error. */
function wildChain(p: TapPulses, bits: Uint8Array, base: number, from: number, at: number): { files: TapeFile[]; end: number } | null {
  const files: TapeFile[] = [];
  const io = (load: number, end: number) => load < 0xe000 && end > 0xd000;
  for (;;) {
    const head = Array.from({ length: 5 }, (_, i) => lsbByte(bits, at + 8 * i));
    if (head.includes(-1)) break;
    const top = head[0] | (head[1] << 8), count = head[2] | (head[3] << 8), flag = head[4];
    if (flag === 0xfe || flag === 0xff || !count) {
      const last = files[files.length - 1];
      if (!last) return null;
      at += 40;
      last.to = base + at;
      last.note = [last.note, flag === 0xff ? 'the loader looks for the next pilot after it (flag $ff)' : 'the end of the chain: the loader stops after it (flag $fe)'].filter(Boolean).join('; ');
      break;
    }
    // a block that would go on below $0000 is not a header
    if (count > top + 1) break;
    const data = new Uint8Array(count);
    let pos = at + 40, x = 0, got = 0;
    for (; got < count; got++, pos += 8) {
      const v = lsbByte(bits, pos);
      if (v < 0) break;
      data[count - 1 - got] = v ^ ((top - got) & 0xff);
      x ^= data[count - 1 - got];
    }
    const sum = got === count ? lsbByte(bits, pos) : -1;
    if (sum !== x && !files.length) return null;
    const load = top + 1 - got, end = top + 1, errors: string[] = [];
    if (got < count) errors.push(`the data runs past the end of the turbo stretch: ${got} of its ${count} bytes are on it`);
    else if (sum < 0) errors.push('the data runs past the end of the turbo stretch: its sum is not on it');
    else if (sum !== x) errors.push(`checksum: the data's XOR is $${hex2(x)}, the tape says $${hex2(sum)}`);
    const note = io(load, end) ? (flag ? 'stored with the I/O in ($01 = 5): its bytes at $d000-$dfff go to the VIC\'s and the CIAs\' registers and the colour RAM' : 'stored with $01 = 0: into the RAM under the I/O') : undefined;
    files.push({ format: 'wildload', name: `file_${hex4(load)}`, type: 'PRG', load, end, data: data.subarray(count - got), ...fileAt(p, base + (files.length ? at : from)), to: base + Math.min(pos + 8, bits.length), errors, ...(note ? { note } : {}) });
    if (errors.length && got < count) { at = pos; break; }
    at = pos + 8;
  }
  return files.length ? { files, end: Math.min(at, bits.length) } : null;
}

/* ---- Microload ---- */

/* Microload (TAPClean's name): Interceptor Micros' own games (Bigtop Barney, Front Line, Guzzler, Melonmania),
 * Electric Dreams' (Aliens, Chameleon, Dandy), Epyx's (Movie Monster Game, Winter Games, Jumpman), Players' (Velocipede,
 * Ronald Rubberduck) and the first file of Magic Bytes' tapes (Western Games, Vampire's Empire). The loader is in the boot
 * file's tape header, at $0351 (the boot file at $02a7, which BASIC's idle vector at $0302 starts, makes it the IRQ at
 * $fffe): a pulse on the FLAG line restarts CIA2's timer A from $014d, and a 1 is that it ran out (333 cycles), the lowest
 * bit first. A pilot of $a0 (found bit by bit; 255 bytes on the tapes, 857 on Magic Bytes'), the sync bytes $0a … $01,
 * then the start and the length as a negative number (counted up to 0), the data from the first byte up and their XOR. A
 * sum that does not fit resets the C64 ($fcf2). The boot file says how many files the loader reads ($fa) and where it
 * starts the game; the first file's code runs while the others load. Learned from Bigtop Barney's boot, run in Sindri
 * with the tape. */

/** pilot bytes a Microload file needs before its sync (the tapes have 255 or 857) */
const MICRO_PILOT = 32;
/** the pulses a stretch goes on after a file whose sum does not fit (the tape stops after each file: the stretch ends) */
const MICRO_TAIL = 16;

function microFiles(p: TapPulses, bits: Uint8Array, base: number): TapeFile[] {
  return a0Pilots(bits, MICRO_PILOT, (from, at) => microFile(p, bits, base, from, at));
}

/** Wildload's chains and Microload's files in a stretch: a Microload file is not taken where a chain is (they have the
 *  same pilot and sync bytes) */
function wildAndMicro(p: TapPulses, bits: Uint8Array, base: number): TapeFile[] {
  const wild = wildFiles(p, bits, base);
  return [...wild, ...microFiles(p, bits, base).filter(m => !wild.some(w => w.at < m.to && m.at < w.to))];
}

/** A Microload file from its header at bit `at` (its pilot at `from`). One whose sum does not fit is taken only where
 *  the stretch ends with it: Wildload's and Rainbow Arts' blocks have the same pilot and sync, and read this way their
 *  lengths take them elsewhere. */
function microFile(p: TapPulses, bits: Uint8Array, base: number, from: number, at: number): { v: TapeFile; end: number } | null {
  const head = Array.from({ length: 4 }, (_, i) => lsbByte(bits, at + 8 * i));
  if (head.includes(-1)) return null;
  const load = head[0] | (head[1] << 8), neg = head[2] | (head[3] << 8), length = 0x10000 - neg;
  if (!neg || load + length > 0x10000) return null;
  const data = new Uint8Array(length);
  let pos = at + 32, x = 0;
  for (let i = 0; i < length; i++, pos += 8) {
    const v = lsbByte(bits, pos);
    if (v < 0) return null;
    data[i] = v;
    x ^= v;
  }
  const sum = lsbByte(bits, pos);
  if (sum < 0) return null;
  pos += 8;
  if (sum !== x && bits.length - pos > MICRO_TAIL) return null;
  const errors = sum === x ? [] : [`checksum: the data's XOR is $${hex2(x)}, the tape says $${hex2(sum)}`];
  return { v: { format: 'microload', name: `file_${hex4(load)}`, type: 'PRG', load, end: load + length, data, ...fileAt(p, base + from), to: base + pos, errors }, end: pos };
}

/* ---- Cyberload ---- */

/* Cyberload (System 3, Thalamus, Hewson, Activision …) loads in stages after the KERNAL boot file, each with a pulse
 * longer than CIA1's timer A (one shot, about 500 cycles on most tapes) a 1, the top bit first, and a pilot of $0f
 * bytes before every sync byte. Its first two stages load the loader itself; the third reads blocks with an address
 * of their own, the fourth (in the game's memory too, for its levels) is a LOAD by name. Learned from the code of
 * Tusker's and The Last Ninja's stages as Sindri ran them with the tape. */

/** pilot bytes a Cyberload sync needs before it (its own tapes have 6 to 8) */
const CYBER_LEAD = 4;

/** where the first sync byte `sync` after a Cyberload pilot is in `bits` from bit `from` on (the bit after it), or -1 */
function cyberSync(bits: Uint8Array, from: number, sync: number): number {
  let reg = 0;
  for (let k = from; k < bits.length; k++) {
    reg = ((reg << 1) | bits[k]) & 0xff;
    if (reg === sync && cyberPilot(bits, k - 7) >= 0) return k + 1;
  }
  return -1;
}

/**
 * Cyberload's first stage, which the boot file's loader in the tape header reads (after it decrypts itself): the pilot,
 * $f0, then a byte to add to where it stores (it starts at $ffd5, so the first goes to the zero page) and bytes, each
 * followed by a bit: 1 store it and go on, 0 do not (the loader leaves it on the stack) and a second bit, 1 another
 * byte to add, 0 the end. It stores the second stage's code in the zero page and its own again in the tape buffer, the
 * tape header's first 21 bytes as they were (that is how it is known), and returns through the bytes it left on the
 * stack into the zero page. The file is its bytes from the first stored to the last, those between as the boot file
 * left them (0 where it has none); the second stage's two XOR keys are read from its code.
 */
function cyberFirst(p: TapPulses, bits: Uint8Array, r: Region, boot: TapeFile | undefined): { file: TapeFile; keys: [number, number] | null; end: number } | null {
  const head = boot?.header;
  if (!head) return null;
  let at = cyberSync(bits, 0, 0xf0);
  if (at < 0) return null;
  const syncAt = cyberPilot(bits, at - 8);
  const bit = () => (at < bits.length ? bits[at++] : -1);
  const byte = () => { const v = msbByte(bits, at); at += 8; return v; };
  const segs: { off: number; bytes: number[] }[] = [], left: number[] = [];
  let seg = { off: byte(), bytes: [] as number[] };
  for (let n = 0; n < 0x10000; n++) {
    const v = byte(), b = bit();
    if (v < 0 || b < 0) return null;
    if (b) { seg.bytes.push(v); continue; }
    left.push(v);
    segs.push(seg);
    const more = bit();
    if (more < 0) return null;
    if (!more) break;
    seg = { off: byte(), bytes: [] };
  }
  // where each segment goes: the one that holds the tape header's start is at $033c
  let rel = 0;
  const offs = segs.map(s => { rel += s.off; const o = rel; rel += s.bytes.length; return o; });
  const hs = segs.findIndex(s => s.bytes.length >= 21 && s.bytes.slice(0, 21).every((v, i) => v === head[i]));
  if (hs < 0) return null;
  const base = (0x033c - offs[hs]) & 0xffff;
  const placed = segs.map((s, i) => ({ load: (base + offs[i]) & 0xffff, bytes: s.bytes })).filter(s => s.bytes.length);
  const load = Math.min(...placed.map(s => s.load)), end = Math.max(...placed.map(s => s.load + s.bytes.length));
  if (end > 0x10000 || end - load > 0x1000) return null;
  // memory as the first stage leaves it: the boot file, its header in the tape buffer, the IRQ vector the KERNAL's
  // LOAD put back from $029f/$02a0 (the boot file's bytes there), what it stored
  const mem = new Uint8Array(0x10000);
  if (boot.load != null) mem.set(boot.data.subarray(0, 0x10000 - boot.load), boot.load);
  mem.set(head, 0x033c);
  mem[0x0314] = mem[0x029f]; mem[0x0315] = mem[0x02a0];
  for (const s of placed) mem.set(s.bytes, s.load);
  const data = mem.slice(load, end);
  const span = (s: { load: number; bytes: number[] }) => s.bytes.length === 1 ? `$${hex4(s.load)}` : `$${hex4(s.load)}-$${hex4(s.load + s.bytes.length - 1)}`;
  // the RTS that ends it takes the last two it left on the stack
  const entry = left.length >= 2 ? (((left[left.length - 2] << 8) | left[left.length - 1]) + 1) & 0xffff : null;
  const ret = entry != null ? `; its RTS takes the last two bytes it left on the stack: $${hex4(entry)}` : '';
  const keys = entry != null ? cyberKeys(mem, entry) : null;
  return {
    keys, end: at,
    file: {
      format: 'cyberload', name: `file_${hex4(load)}`, type: 'PRG', load, end, data,
      at: r.from + syncAt, offset: p.offsets[r.from + syncAt] ?? 0, seconds: (p.times[r.from + syncAt] ?? 0) / TAPE_CLOCK, to: r.from + Math.min(at, bits.length),
      errors: [], note: `first stage: stores ${placed.map(span).join(', ')} (the bytes between as the boot file left them)${ret}`,
    },
  };
}

/**
 * The second stage's two XOR keys: its code in the zero page decrypts itself (with the bytes the boot file left at
 * $0314), so it runs here on Sindri's 6510, from where the first stage returns into it until it calls the byte reader
 * in the tape buffer, and the keys are read from it then (ldx #0, jsr byte, eor #k1, sta $02,x, inx, cpx #4, bcc,
 * jsr byte, eor #k2). The ROMs it may read stand in as bytes that differ (it checks the RAM under the KERNAL is not
 * one byte all over, as a freezer's would be); I/O reads 0.
 */
function cyberKeys(mem: Uint8Array, entry: number): [number, number] | null {
  for (let a = 0xa000; a < 0x10000; a++) mem[a] = (a * 7) & 0xff;
  mem[1] = 0x37;
  const io = (a: number) => a >= 0xd000 && a < 0xe000;
  const bus: Bus = { read: a => (io(a) ? 0 : mem[a]), write: (a, v) => { if (!io(a)) mem[a] = v; }, fetch: a => mem[a] };
  const cpu = new Cpu(bus);
  cpu.pc = entry; cpu.s = 0xf0;
  for (let n = 0; n < 200000 && !cpu.jammed; n++) {
    if (cpu.pc >= 0x033c && cpu.pc < 0x0400) {
      for (let i = 2; i + 16 < 0x100; i++) {
        const b = (k: number) => mem[i + k];
        if (b(0) === 0x20 && b(3) === 0x49 && b(5) === 0x95 && b(7) === 0xe8 && b(8) === 0xe0 && b(9) === 0x04 && b(10) === 0x90 && b(12) === 0x20 && b(15) === 0x49) return [b(4), b(16)];
      }
      return null;
    }
    cpu.step();
  }
  return null;
}

/** Cyberload's second stage, which the first stage's code in the zero page reads: the pilot, $f0, where it goes and
 *  how many bytes (each XOR the first key), the bytes (XOR the second), up to where the stretch ends. */
function cyberSecond(p: TapPulses, bits: Uint8Array, r: Region, from: number, keys: [number, number]): TapeFile | null {
  let at = cyberSync(bits, from, 0xf0);
  if (at < 0) return null;
  const syncAt = cyberPilot(bits, at - 8);
  const head = Array.from({ length: 4 }, (_, i) => msbByte(bits, at + 8 * i) ^ keys[0]);
  at += 32;
  const load = head[0] | (head[1] << 8), len = head[2] | (head[3] << 8);
  // no checksum: the length has to take the stretch to its end (a byte or two of lead-out after it)
  const left = (bits.length - at) / 8 - len;
  if (!len || load + len > 0x10000 || left < 0 || left > 4) return null;
  const data = Uint8Array.from({ length: len }, (_, i) => msbByte(bits, at + 8 * i) ^ keys[1]);
  at += 8 * len;
  return {
    format: 'cyberload', name: `file_${hex4(load)}`, type: 'PRG', load, end: load + len, data,
    at: r.from + syncAt, offset: p.offsets[r.from + syncAt] ?? 0, seconds: (p.times[r.from + syncAt] ?? 0) / TAPE_CLOCK, to: r.from + at,
    errors: [], note: `second stage: its address and length XOR $${keys[0].toString(16).padStart(2, '0')}, its bytes XOR $${keys[1].toString(16).padStart(2, '0')} (the keys in the first stage's code)`,
  };
}

/** A block of Cyberload's third stage: the pilot, $cc, eight header bytes (where it goes, how many bytes (0: 256), a
 *  byte that makes the XOR of the header and the data 0, flags (bit 7: the loader calls the address in the last two
 *  header bytes after the block), a byte, that address), the bytes. */
interface CyberBlock { at: number; to: number; load: number; bytes: Uint8Array; flags: number; call: number; ok: boolean }

/** where the pilot of $0f bytes before the sync byte at bit `at` starts, or -1 when it is shorter than CYBER_LEAD */
function cyberPilot(bits: Uint8Array, at: number): number {
  let n = 0;
  while (msbByte(bits, at - 8 * (n + 1)) === 0x0f) n++;
  return n >= CYBER_LEAD ? at - 8 * n : -1;
}

/** the third stage's blocks in a stretch (bits from pulse `base` on) */
function cyberBlocks(bits: Uint8Array, base: number): CyberBlock[] {
  const out: CyberBlock[] = [];
  let reg = 0;
  for (let k = 0; k < bits.length; k++) {
    reg = ((reg << 1) | bits[k]) & 0xff;
    if (reg !== 0xcc || cyberPilot(bits, k - 7) < 0) continue;
    let at = k + 1;
    const head = Array.from({ length: 8 }, (_, i) => msbByte(bits, at + 8 * i));
    at += 64;
    const n = head[2] || 256;
    if (head.includes(-1) || at + 8 * n > bits.length) continue;
    const bytes = new Uint8Array(n);
    let x = head.reduce((a, v) => a ^ v, 0);
    for (let i = 0; i < n; i++, at += 8) { bytes[i] = msbByte(bits, at); x ^= bytes[i]; }
    out.push({ at: base + cyberPilot(bits, k - 7), to: base + at, load: head[0] | (head[1] << 8), bytes, flags: head[4], call: head[6] | (head[7] << 8), ok: x === 0 });
    k = at - 1; reg = 0;
  }
  return out;
}

/** The third stage's files: blocks that follow on from each other in memory, up to one after which the loader calls
 *  code. A block that does not check is taken (with an error) only where it goes on from the one before. */
function cyberBlockFiles(p: TapPulses, blocks: CyberBlock[]): TapeFile[] {
  const groups: CyberBlock[][] = [];
  for (const b of blocks.sort((x, y) => x.at - y.at)) {
    const g = groups[groups.length - 1], last = g?.[g.length - 1];
    const follows = !!last && !(last.flags & 0x80) && ((last.load + last.bytes.length) & 0xffff) === b.load;
    if (follows) g.push(b);
    else if (b.ok && b.load + b.bytes.length <= 0x10000) groups.push([b]);
  }
  return groups.filter(g => g.some(b => b.ok)).map(g => {
    const load = g[0].load, data = new Uint8Array(g.reduce((a, b) => a + b.bytes.length, 0));
    let o = 0;
    for (const b of g) { data.set(b.bytes.subarray(0, Math.max(0, Math.min(b.bytes.length, 0x10000 - load - o))), o); o += b.bytes.length; }
    const last = g[g.length - 1];
    const call = last.flags & 0x80 ? `; the loader calls $${hex4(last.call)} after it` : '';
    return {
      format: 'cyberload' as const, name: `file_${hex4(load)}`, type: 'PRG' as const, load, end: Math.min(0x10000, load + data.length), data: data.subarray(0, Math.min(data.length, 0x10000 - load)),
      at: g[0].at, offset: p.offsets[g[0].at] ?? 0, seconds: (p.times[g[0].at] ?? 0) / TAPE_CLOCK, to: last.to,
      errors: g.filter(b => !b.ok).map(b => `checksum: the block at $${hex4(b.load)} could not be read cleanly`),
      note: `third stage, ${g.length} block${g.length === 1 ? '' : 's'}${call}`,
    };
  });
}

/**
 * The fourth stage's files, Cyberload's LOAD by name: the pilot, a sync byte of the game's own ($aa on most tapes,
 * $55 on Myth's; not the other stages' $cc and $f0), a header (16 name bytes, the load address, the length; on later
 * tapes, as Tusker's, a word whose 1.5 times is the timer the data is read with), the XOR of the header; a byte on the
 * later ones; then the data, 256 bytes at a time, each followed by the XOR of all bytes since the header's. Which
 * header it is shows where the blocks check.
 */
function cyberNamedFiles(p: TapPulses, bits: Uint8Array, r: Region, threshold: number): TapeFile[] {
  const out: TapeFile[] = [], c = p.cycles;
  const byteAt = (at: number, t: number) => {
    if (at < r.from || at + 8 > r.to) return -1;
    let v = 0;
    for (let i = 0; i < 8; i++) v = (v << 1) | (c[at + i] > t ? 1 : 0);
    return v;
  };
  let reg = 0;
  for (let k = 0; k < bits.length; k++) {
    // the sync byte, after three pilot bytes (cyberPilot wants more)
    reg = ((reg << 1) | bits[k]) >>> 0;
    const sync = reg & 0xff;
    if (reg >>> 8 !== 0x0f0f0f || sync === 0x0f || sync === 0xcc || sync === 0xf0) continue;
    const pilot = cyberPilot(bits, k - 7);
    if (pilot < 0) continue;
    const head = Array.from({ length: 23 }, (_, i) => msbByte(bits, k + 1 + 8 * i));
    if (head.includes(-1)) continue;
    const load = head[16] | (head[17] << 8), len = head[18] | (head[19] << 8), speed = head[20] | (head[21] << 8);
    if (!len || load + len > 0x10000) continue;
    // a name of characters one can type, padded with spaces or zeros ("D", "0B", "0:MINI-PUTT", Accolade's "TITLE.GRA"):
    // data of a byte over and over (whose XOR is 0 whatever it is) is not taken for a header
    const typed = (v: number) => (v >= 0x20 && v < 0x60) || v === 0xa0 || (v >= 0xc1 && v <= 0xda);
    let named = 16;
    while (named > 0 && (head[named - 1] === 0x00 || head[named - 1] === 0x20 || head[named - 1] === 0xa0)) named--;
    if (!named || !head.slice(0, named).every(typed)) continue;
    let best: { data: Uint8Array; bad: number[]; to: number; speed: number | null } | null = null;
    for (const later of [false, true]) {
      if (head.slice(0, later ? 23 : 21).reduce((a, v) => a ^ v, 0) !== 0) continue;
      // the later header's speed: a timer the loader can count down in a pulse's time
      if (later && (speed < 100 || speed > 2000)) continue;
      const t = later ? speed * 1.5 : threshold;
      let at = r.from + k + 1 + 8 * (later ? 23 : 21), x = 0;
      if (later) { x = byteAt(at, t); at += 8; }
      const data = new Uint8Array(len), bad: number[] = [];
      let whole = true;
      for (let o = 0; o < len && whole; o += 256) {
        for (let i = o; i < Math.min(len, o + 256); i++, at += 8) { const v = byteAt(at, t); if (v < 0) { whole = false; break; } data[i] = v; x ^= v; }
        const sum = byteAt(at, t);
        at += 8;
        if (sum < 0) whole = false;
        else if ((x ^= sum) !== 0) { bad.push(load + o); x = 0; }
      }
      if (!whole || bad.length > len / 512) continue;
      if (!best || bad.length < best.bad.length) best = { data, bad, to: at, speed: later ? speed : null };
    }
    if (!best) continue;
    const raw = Uint8Array.from(head.slice(0, 16));
    const blocks = Math.ceil(len / 256);
    out.push({
      format: 'cyberload', name: petsciiName(raw.subarray(0, named).map(v => (v === 0x20 ? 0xa0 : v))).trimEnd(), raw, type: 'PRG', load, end: load + len, data: best.data,
      at: r.from + pilot, offset: p.offsets[r.from + pilot] ?? 0, seconds: (p.times[r.from + pilot] ?? 0) / TAPE_CLOCK, to: best.to,
      errors: best.bad.map(a => `checksum: the block at $${hex4(a)} could not be read cleanly`),
      note: `fourth stage (LOAD by name), sync $${sync.toString(16).padStart(2, '0')}, ${blocks} block${blocks === 1 ? '' : 's'}${best.speed ? `, read with a timer of ${Math.round(best.speed * 1.5)} cycles` : ''}`,
    });
    k = best.to - r.from - 1; reg = 0;
  }
  return out;
}

/* ---- Firebird ---- */

/* Firebird's loader (Firebird's, Silverbird's and Rainbird's tapes, and Psygnosis', Odin's, Thor's, Activision's,
 * Melbourne House's, Ariolasoft's …): the boot file loads it with the KERNAL (Bubble Bobble's at $1c00), and it reads
 * the tape in an IRQ on the FLAG line that restarts CIA2's timer A, one shot from $0232 cycles, whose underflow is a 1,
 * the top bit first. It finds its pilot byte bit by bit, then reads whole bytes into a ring of 32 at $033c. Each block:
 * the pilot byte (9 to 11 of them on the tapes, at least FB_PILOT here), its complement and the pilot again, then one of
 * two kinds:
 * - the first stage (the loader the boot file loads): the next block's pilot byte (the first block's is $0f), the
 *   block's number (from 0), its address; 256 bytes (64 in block 0), a count and that many bytes the loader skips (0:
 *   256), the XOR of the data, and where the loader jumps after the block: back into itself, the last block's into the
 *   code that block holds (it decrypts what was loaded: each game in its own way, so the bytes are given as loaded);
 * - a loader a program loads with the first stage and calls (Bubble Bobble's at $4900, for its $5800-$cfff and
 *   $0400-$47ff), the same reading: a pilot byte for the whole file, then each block's number (from 0 in each file),
 *   its address, a byte (0), the page the file ends before, where the loader jumps after the file (0: it returns), 256
 *   bytes and their XOR.
 * Learned from Bubble Bobble's loader at $1c00 and the one its first stage decrypts, run in Sindri with the tape: every
 * byte they stored is the reader's. A block whose sum does not match is taken only where it carries on a chain or a file
 * whose other blocks do. */

/** pilot bytes a Firebird block needs before the complement (the tapes have 9 to 11) */
const FB_PILOT = 4;

interface FbBlock {
  /** the first stage, or the second kind (a file of its own) */
  first: boolean;
  /** the stretch it is in, its first pilot byte and the bit after it (pulses) */
  s: number;
  at: number; to: number;
  pilot: number; num: number; load: number; bytes: Uint8Array;
  /** the first stage: the next block's pilot byte; the second kind: the page its file ends before */
  next: number;
  /** where the loader jumps after the block (the first stage) or after the file (the second kind; 0: it returns) */
  jump: number;
  ok: boolean;
}

/** The Firebird blocks in a stretch (bits from pulse `base` on), each read in both kinds where its pilot leads to one:
 *  the chains and the files they make are chosen after all stretches (firebirdFiles). */
function firebirdBlocks(bits: Uint8Array, base: number, s: number): FbBlock[] {
  const out: FbBlock[] = [];
  /** the end of the last block that checked: a pilot does not reach back into it (its sum can be the pilot byte) */
  let floor = 0;
  let reg = 0;
  for (let k = 0; k < bits.length; k++) {
    reg = ((reg << 1) | bits[k]) >>> 0;
    if (k < 31) continue;
    // the pilot byte twice, its complement, the pilot (the last two bytes before the header)
    const v = reg & 0xff;
    if (v === 0 || v === 0xff || reg >>> 24 !== v || ((reg >>> 16) & 0xff) !== v || ((reg >>> 8) & 0xff) !== (v ^ 0xff)) continue;
    const syncAt = k + 1 - 16;
    let n = 0;
    while (syncAt - 8 * (n + 1) >= floor && msbByte(bits, syncAt - 8 * (n + 1)) === v) n++;
    if (n < FB_PILOT) continue;
    const from = syncAt - 8 * n, found: FbBlock[] = [];
    for (const first of [true, false]) {
      let at = k + 1;
      const take = () => { const b = msbByte(bits, at); at += 8; return b; };
      const head = Array.from({ length: first ? 4 : 7 }, take);
      if (head.includes(-1)) continue;
      const num = first ? head[1] : head[0], load = first ? head[2] | (head[3] << 8) : head[1] | (head[2] << 8);
      const bytes = new Uint8Array(first && num === 0 ? 0x40 : 0x100);
      let x = 0, whole = true;
      for (let i = 0; i < bytes.length; i++) { const b = take(); if (b < 0) { whole = false; break; } bytes[i] = b; x ^= b; }
      if (!whole) continue;
      if (first) { const skip = take(); if (skip < 0) continue; at += 8 * (skip || 256); }
      const sum = take(), jump = first ? take() | (take() << 8) : head[5] | (head[6] << 8);
      if (sum < 0 || at > bits.length) continue;
      found.push({ first, s, at: base + from, to: base + at, pilot: v, num, load, bytes, next: first ? head[0] : head[4], jump, ok: sum === x });
    }
    out.push(...found);
    // past a block that checks: the pilot of the next one cannot start inside it
    const ok = found.filter(b => b.ok);
    if (ok.length) { floor = Math.min(...ok.map(b => b.to)) - base; k = floor - 1; reg = 0; }
  }
  return out;
}

/** The files of the Firebird blocks on a tape, and the blocks they took. First-stage blocks make a chain where each
 *  carries on from the one before (its pilot byte the one that block named, its number one more); a chain is files of
 *  the memory its blocks fill, a page loaded again (Bubble Bobble's loader loads its own page at $1c00 five times)
 *  counted, the later bytes kept. Blocks of the second kind make a file where they have one pilot, page, end and jump
 *  and follow on in memory. Two blocks that check make a chain or a file (or one block that is a whole file):
 *  data that happens to hold the pilot, its complement and a sum that fits makes single blocks. */
function firebirdFiles(p: TapPulses, blocks: FbBlock[]): { files: TapeFile[]; taken: FbBlock[] } {
  blocks.sort((a, b) => a.at - b.at);
  const chains: FbBlock[][] = [], groups: FbBlock[][] = [];
  /** the latest chain or file whose last block `b` carries on */
  const latest = (gs: FbBlock[][], b: FbBlock, on: (l: FbBlock) => boolean) => {
    for (let i = gs.length - 1; i >= 0; i--) { const l = gs[i][gs[i].length - 1]; if (l.to <= b.at && ((l.num + 1) & 0xff) === b.num && on(l)) return gs[i]; }
    return null;
  };
  for (const b of blocks) {
    const gs = b.first ? chains : groups;
    const g = b.first ? latest(chains, b, l => l.next === b.pilot) : latest(groups, b, l => l.pilot === b.pilot && l.next === b.next && l.jump === b.jump && l.load + 0x100 === b.load);
    if (g) g.push(b);
    else if (b.ok) gs.push([b]);
  }
  /** the page after a block's (0 after the top of memory, as the header has it) */
  const after = (b: FbBlock) => ((b.load >> 8) + 1) & 0xff;
  const whole = (g: FbBlock[]) => g.length === 1 && g[0].num === 0 && after(g[0]) === g[0].next;
  const keep = (g: FbBlock[]) => {
    // a block that does not check ends a chain or a file it does not carry on
    while (g.length && !g[g.length - 1].ok) g.pop();
    return g.filter(b => b.ok).length >= 2 || whole(g);
  };
  const files: TapeFile[] = [], taken: FbBlock[] = [];
  const bad = (b: FbBlock) => `checksum: the block at $${hex4(b.load)} could not be read cleanly`;
  // a pulse is one block's: where a chain and a file both read it, the longer one has it
  const claimed = new Set<number>();
  const all = [...chains.filter(keep), ...groups.filter(keep)].sort((a, b) => b.length - a.length).filter(g => {
    if (g.some(b => claimed.has(b.at))) return false;
    for (const b of g) claimed.add(b.at);
    return true;
  });
  for (const g of all) {
    taken.push(...g);
    if (g[0].first) {
      // the memory the chain fills: a block goes on from a run that ends where it starts, or loads a page a run has
      const usual = [...g.reduce((m, b) => m.set(b.jump, (m.get(b.jump) ?? 0) + 1), new Map<number, number>())].sort((a, b) => b[1] - a[1])[0][0];
      const runs: { load: number; end: number; blocks: FbBlock[]; again: number; mem: Map<number, number> }[] = [];
      for (const b of g) {
        const end = Math.min(0x10000, b.load + b.bytes.length);
        let r = runs.find(r => b.load >= r.load && end <= r.end);
        if (r) r.again++;
        else if ((r = runs.find(r => r.end === b.load))) r.end = end;
        else runs.push(r = { load: b.load, end, blocks: [], again: 0, mem: new Map() });
        r.blocks.push(b);
        for (let i = 0; i < end - b.load; i++) r.mem.set(b.load + i, b.bytes[i]);
      }
      for (const r of runs) {
        const data = Uint8Array.from({ length: r.end - r.load }, (_, i) => r.mem.get(r.load + i) ?? 0);
        const first = r.blocks[0], last = r.blocks.reduce((a, b) => (b.to > a.to ? b : a));
        const jumps = r.blocks.filter(b => b.jump !== usual).map(b => `$${hex4(b.jump)}`);
        const n = r.blocks.length - r.again;
        files.push({
          format: 'firebird', name: `file_${hex4(r.load)}`, type: 'PRG', load: r.load, end: r.end, data,
          ...fileAt(p, first.at), to: last.to, errors: r.blocks.filter(b => !b.ok).map(bad),
          note: `first stage, ${n} block${n === 1 ? '' : 's'}${r.again ? `, loaded ${r.again + 1} times` : ''}${jumps.length ? `; the loader jumps to ${jumps.join(', ')} after it` : ''}`,
        });
      }
    } else {
      const first = g[0], last = g[g.length - 1], end = Math.min(0x10000, last.load + 0x100);
      const data = new Uint8Array(end - first.load);
      g.forEach((b, i) => data.set(b.bytes.subarray(0, Math.min(0x100, data.length - i * 0x100)), i * 0x100));
      const errors = g.filter(b => !b.ok).map(bad);
      if (first.num) errors.push(first.num === 1 ? 'its first block is not on the tape' : `its first ${first.num} blocks are not on the tape`);
      if (after(last) !== first.next) errors.push(`it ends at $${hex4(end & 0xffff)}, its blocks up to $${hex2(first.next)}00 are not on the tape`);
      files.push({
        format: 'firebird', name: `file_${hex4(first.load)}`, type: 'PRG', load: first.load, end, data,
        ...fileAt(p, first.at), to: last.to, errors,
        note: `pilot $${hex2(first.pilot)}, ${g.length} block${g.length === 1 ? '' : 's'}; ${first.jump ? `the loader jumps to $${hex4(first.jump)} after it` : 'the loader returns after it'}`,
      });
    }
  }
  return { files, taken };
}

/* ---------------------------------------------------------------------------------------------------------------- */

/** Read a .tap image: its files in every format known here, and the stretches with data none of them reads. A .t64
 *  tape archive is read as its directory says (readT64). */
/** What no format took of a stretch: unknown turbo data, where there is enough of it to hold some (not a leader). */
function unknownTurbo(p: TapPulses, r: Region, taken: readonly (readonly [number, number])[]): TapeUnknown[] {
  const out: TapeUnknown[] = [];
  let from = r.from;
  for (const [a, b] of [...[...taken].sort((x, y) => x[0] - y[0]), [r.to, r.to] as const]) {
    if (a - from >= 2000) {
      const t = twoLengths(p.cycles, from, a);
      if (t && !isLeader(bitsOf(p.cycles, { from, to: a }, (t.short + t.long) / 2))) out.push({ at: from, to: a, offset: p.offsets[from] ?? 0, seconds: (p.times[from] ?? 0) / TAPE_CLOCK, pulses: a - from, short: Math.round(t.short), long: Math.round(t.long) });
    }
    from = Math.max(from, b);
  }
  return out;
}

export function readTape(u8: Uint8Array): TapeImage {
  if (isT64(u8)) return readT64(u8);
  const p = tapPulses(u8);
  const cbm = cbmBlocks(p);
  const files = cbmFiles(p, cbm);
  const unknown: TapeUnknown[] = [];
  let tapetool = null as TapeImage['tapetool'];
  const cyber: CyberBlock[] = [];
  let before: { short: number; long: number } | null = null;
  /** the boot files a Cyberload first stage was read after, and the second stage's keys from one in the stretch before */
  const firsts = new Set<TapeFile>();
  let keys: [number, number] | null = null;
  /** each stretch and the parts of it formats took: what is left between them is unknown turbo data (counted after all
   *  stretches, as a doubtful file is taken only then); pilot files whose sums do not match, with their stretch */
  const stretches: { r: Region; taken: (readonly [number, number])[] }[] = [];
  const doubtful: { f: TapeFile; s: number }[] = [];
  /** Firebird's blocks, made into chains and files across stretches (the loader stops the tape between blocks) */
  const fb: FbBlock[] = [];
  for (const r of regions(p, cbm)) {
    const two: { short: number; long: number } | null = twoLengths(p.cycles, r.from, r.to) ?? sameLengths(p.cycles, r.from, r.to, before);
    if (two) before = two;
    const found: TapeFile[] = [];
    let blocks: CyberBlock[] = [];
    if (two) {
      const bits = bitsOf(p.cycles, r, (two.short + two.long) / 2);
      const tt = tapeToolBlocks(bits, r.from);
      if (tt.length) {
        found.push(...tapeToolFiles(p, tt, files));
        // the lead-out after its last block: leader bytes up to the end of the stretch
        const last = tt.reduce((a, b) => (b.to > a.to ? b : a));
        let out = 0;
        for (let at = last.to - r.from; at + 8 <= bits.length; at += 8) { const v = msbByte(bits, at); if (v !== 0xff && v !== 0xc3) break; out++; }
        tapetool = { speed: tapetool?.speed ?? Math.round(two.short / 8) * 8, leadOut: Math.round(out / 2) };
      }
      const pilot = pilotFiles(p, bits, r.from);
      doubtful.push(...pilot.doubtful.map(f => ({ f, s: stretches.length })));
      // Wildload's chains and Microload's files take their pulses: another format's file inside them is their data
      // holding its pilot, sync and a sum that fits by chance (a Freeload file of 64 bytes in Ronald Rubberduck's $0800)
      const wm = wildAndMicro(p, bits, r.from);
      const own = (f: TapeFile) => !wm.some(w => w.at < f.to && f.at < w.to);
      found.push(...[...turboTapeFiles(p, bits, r.from), ...pilot.files, ...megaSaveFiles(p, bits, r.from), ...novaFiles(p, bits, r.from)].filter(own), ...wm, ...cyberNamedFiles(p, bits, r, (two.short + two.long) / 2).filter(own));
      // Cyberload's first stage in the stretch after its boot file, and the second after it with the keys it holds
      if (keys) { const f = cyberSecond(p, bits, r, 0, keys); if (f) found.push(f); keys = null; }
      const boot = files.filter(f => f.format === 'cbm' && f.headerCode && f.to <= r.from).pop();
      const first = boot && !firsts.has(boot) && r.from - boot.to < 50000 ? cyberFirst(p, bits, r, boot) : null;
      if (first) {
        firsts.add(boot!);
        found.push(first.file);
        const second = first.keys ? cyberSecond(p, bits, r, first.end, first.keys) : null;
        if (second) found.push(second);
        else keys = first.keys;
      }
      blocks = cyberBlocks(bits, r.from);
      cyber.push(...blocks);
      fb.push(...firebirdBlocks(bits, r.from, stretches.length));
    }
    files.push(...found);
    stretches.push({ r, taken: [...found, ...blocks.filter(b => b.ok)].map(f => [f.at, f.to] as const) });
  }
  // Cyberload's blocks make files across stretches: the loader stops the tape between them
  files.push(...cyberBlockFiles(p, cyber));
  // Firebird's chains and files, of blocks no other format took
  const firebird = firebirdFiles(p, fb.filter(b => !stretches[b.s].taken.some(([a, c]) => a < b.to && b.at < c)));
  files.push(...firebird.files);
  for (const b of firebird.taken) stretches[b.s].taken.push([b.at, b.to]);
  // a pilot file whose sum does not match, on a tape where files of its format pass theirs: the loader does not check
  // every sum (with no file passing, the format is another with the same pilot and sync)
  for (const { f, s } of doubtful) {
    if (!files.some(g => g.format === f.format && !g.errors.length)) continue;
    if (stretches[s].taken.some(([a, b]) => a < f.to && f.at < b)) continue;
    files.push(f);
    stretches[s].taken.push([f.at, f.to]);
  }
  for (const { r, taken } of stretches) unknown.push(...unknownTurbo(p, r, taken));
  files.sort((a, b) => a.at - b.at);
  return { version: p.version, pulses: p.cycles.length, seconds: p.times[p.times.length - 1] / TAPE_CLOCK, files, unknown, tapetool };
}

/** A host file name for a tape file: its name without control codes and with characters Windows does not allow
 *  replaced, plus `.prg` (a SEQ file `.seq`, data `.bin`); a TapeTool file `file<name byte>` or `tinyheader`. */
export function tapeFileName(f: Pick<TapeFile, 'name' | 'type' | 'format' | 'id' | 'tiny'>): string {
  const name = f.format === 'tapetool' ? (f.tiny ? 'tinyheader' : `file${f.id}`) : f.name;
  // (control codes in a tape name, a colour or a clear screen, are left out)
  // eslint-disable-next-line no-control-regex
  const base = name.replace(/·/g, '').replace(/[<>:"/\\|?*\u0000-\u001f()]/g, '_').replace(/[. ]+$/, '').trim() || 'file';
  return `${base}.${f.type === 'SEQ' ? 'seq' : f.type === 'DATA' || f.type === 'END' ? 'bin' : 'prg'}`;
}

/**
 * The KERNAL program whose loader loads `f`, a file of a turbo loader's format (13.5f): the last KERNAL program before
 * it on the tape, as LOAD on a C64 loads it, with its loader reading on from the tape. A turbo file is a part of what
 * the loader loads (a Wildload chain's block, a Cyberload part): its load address is no place to start it, the loader
 * starts what it loaded. Null for a KERNAL file or a T64's (a program of its own), and for one with no KERNAL program
 * before it.
 */
export function tapeBoot(img: Pick<TapeImage, 'files'>, f: TapeFile): TapeFile | null {
  if (f.format === 'cbm' || f.format === 't64') return null;
  let boot: TapeFile | null = null;
  for (const x of img.files) {
    if (x.at >= f.at) break;
    if (x.format === 'cbm' && (x.type === 'PRG' || x.type === 'BASIC') && x.load != null && x.data.length) boot = x;
  }
  return boot;
}

/**
 * A TapeTool tape written again (13.5g): the files to save next to TapeTool.exe and its command lines, one a file as
 * TapeTool's ExampleBuild.bat has them. The boot file (a KERNAL header with the loader in the tape buffer, its data
 * once: `ocb1`) is saved as `boot.bin`, its name, the rest of the header and the data one after another, and given to
 * `ocb1` with their offsets; a TinyHeader file with `otft`, the others with `otfb` (`otfbr` when blocks were RLE
 * packed), `s` before a file interleaved with the one before it, `n 1` where the blocks were not in memory order
 * (TapeTool shuffles them with the seed it is given, so their order can differ), and each file's leader (`otl`). Files
 * TapeTool does not write (a KERNAL file other than the boot file, Turbo Tape) are named in a remark. Null when the
 * tape has no TapeTool files.
 */
export function tapeToolScript(img: TapeImage, tapName: string): { script: string[]; files: Record<string, Uint8Array> } | null {
  if (!img.tapetool) return null;
  const tap = tapName.replace(/"/g, '');
  const files: Record<string, Uint8Array> = {};
  const lines: string[] = [`rem ${tap}: Martin Piper's TapeTool writes it again from the files Mimir saved from it`];
  const prg = (f: TapeFile) => { const out = new Uint8Array(2 + f.data.length); out[0] = (f.load ?? 0) & 0xff; out[1] = (f.load ?? 0) >> 8; out.set(f.data, 2); return out; };
  const hex = (v: number) => `$${v.toString(16)}`;
  let first = true;
  // another speed than TapeTool's default ($80: a 0 of $100 cycles, a 1 of $200) is given with `ft` on every line
  const s = img.tapetool.speed, ft = s !== 0x100 ? `ft $${s.toString(16)} $${(2 * s).toString(16)} 1 $aa ` : '';
  const open = () => { const w = first ? `wn "${tap}"` : `w "${tap}" a`; first = false; return `${w} ${ft}`.trimEnd(); };
  const tt = img.files.filter(f => f.format === 'tapetool');
  // the leader pairs TapeTool writes itself: 4 before a TinyHeader or a whole file, 2 before each block and after
  // each block (8 after an RLE packed one, for the time its loader takes to unpack it); what is left is `otl`'s
  let after = 0;
  const leader = (f: TapeFile, own: number) => { const n = Math.max(0, (f.leader ?? 0) - own - after); return n ? `otl${hex(n)} ` : ''; };
  for (let i = 0; i < img.files.length; i++) {
    const f = img.files[i];
    if (f.format === 'cbm' && f.header && f.headerCode && f.load != null && !files['boot.bin']) {
      // name, the tape buffer after it, the data: ocb1 <file> <load> <name start> <name end> <header> <header end>
      // <data start> <data end>
      const bin = new Uint8Array(16 + 171 + f.data.length);
      bin.set(f.header.subarray(5, 21), 0); bin.set(f.header.subarray(21), 16); bin.set(f.data, 187);
      files['boot.bin'] = bin;
      lines.push(`rem the boot file "${f.name}": a KERNAL header with the loader in the tape buffer, its data at ${hex(f.load)} once${f.copies?.[1] !== 1 ? ` (on this tape the data is there ${f.copies?.[1] ?? 0} times)` : ''}`);
      lines.push(`TapeTool.exe ${open()} ocb1 "boot.bin" ${hex(f.load)} 0 16 16 187 187 ${187 + f.data.length} c`);
      after = 0;
      continue;
    }
    if (f.format !== 'tapetool') { lines.push(`rem ${f.format === 'cbm' ? 'a KERNAL file' : 'a Turbo Tape file'} TapeTool does not write here: "${f.name}" ($${hex4(f.load ?? 0)}-$${hex4((f.end ?? 1) - 1)})`); after = 0; continue; }
    if (f.interleaved) continue;
    const name = tapeFileName(f);
    files[name] = prg(f);
    if (f.tiny) {
      lines.push(`rem the boot loader's next file, without a header (TinyHeader): ${f.data.length} bytes${f.load != null ? ` to ${hex(f.load)}` : ''}`);
      lines.push(`TapeTool.exe ${open()} ${leader(f, 4)}otft "${name}" c`);
      after = 2;
      continue;
    }
    // this file and those interleaved with it, one command
    const group = [f, ...tt.slice(tt.indexOf(f) + 1).filter((g, k, rest) => g.interleaved && rest.slice(0, k).every(x => x.interleaved))];
    const parts = group.map(g => {
      const n = tapeFileName(g);
      files[n] = prg(g);
      return `otfb${g.packed ? 'r' : ''} "${n}" ${g.id}`;
    });
    const shuffled = group.some(g => g.shuffled);
    lines.push(`rem ${group.map(g => `file ${g.id}: ${hex(g.load ?? 0)}-${hex((g.end ?? 1) - 1)}, ${g.blocks} block${g.blocks === 1 ? '' : 's'}${g.packed ? `, ${g.packed} RLE packed` : ''}`).join('; ')}${shuffled ? ' (blocks in random order)' : ''}`);
    lines.push(`TapeTool.exe ${shuffled ? 'n 1 ' : ''}${open()} ${leader(f, 2)}${parts.join(' s ')} c`);
    const last = group.reduce((a, g) => (g.to > a.to ? g : a));
    after = last.lastPacked ? 8 : 2;
  }
  const out = img.tapetool.leadOut - after;
  if (out > 0) lines.push('rem the lead-out', `TapeTool.exe ${open()} otl${hex(out)} c`);
  return { script: lines, files };
}

/* ---------------------------------------------------------------------------------------------------------------- */
/* writing: the KERNAL's format, as SAVE writes it                                                                  */

const PAL_SHORT = 0x30, PAL_MEDIUM = 0x42, PAL_LONG = 0x56;

/**
 * Write a .tap (version 1) with these files in the KERNAL's format, as SAVE writes them: a 10 second leader, each
 * file's header and data blocks twice, and the end-of-tape marker when asked. A program saved with `basic` is type 1
 * (LOAD puts it at the start of BASIC), else type 3. `header`: the rest of the header (tape buffer $0351-$03fb, at most
 * 171 bytes), e.g. a loader's code. Names are taken as PETSCII upper case.
 */
export function makeTap(o: { files: { name: string; data: Uint8Array; load: number; basic?: boolean; header?: Uint8Array; end?: number }[]; endOfTape?: boolean }): Uint8Array {
  const petscii = (s: string, n: number) => { const b = new Uint8Array(n).fill(0x20); for (let i = 0; i < Math.min(n, s.length); i++) b[i] = s.toUpperCase().charCodeAt(i) & 0x7f; return b; };
  const out: number[] = [];
  o.files.forEach((f, i) => {
    // (`end`: the end the header says, when it is not after the data)
    const h = new Uint8Array(192).fill(0x20), end = f.end ?? f.load + f.data.length;
    if (end > 0x10000) throw new Error(`"${f.name}" ends past $ffff`);
    h[0] = f.basic ? 1 : 3; h[1] = f.load & 0xff; h[2] = f.load >> 8; h[3] = end & 0xff; h[4] = (end >> 8) & 0xff;
    h.set(petscii(f.name, 16), 5);
    if (f.header) h.set(f.header.subarray(0, 171), 21);
    cbmPulses(out, h, f.data, i === 0 ? 0x6a00 : 0x1a00);
  });
  if (o.endOfTape) { const h = new Uint8Array(192).fill(0x20); h[0] = 5; cbmPulses(out, h, null, 0x1a00); }
  return tapOf(out);
}

/**
 * The tape with one of its KERNAL files written again (Build & Run, 13.5f): `header` (its 192 bytes: type, start,
 * end, name, the tape buffer) and `data` in the KERNAL's format, each twice, after a 10 second leader, then the tape as
 * it was after the file. What came before the file is left out: VICE's autostart loads the first file.
 */
export function replaceTapeFile(tap: Uint8Array, f: Pick<TapeFile, 'to'>, header: Uint8Array, data: Uint8Array): Uint8Array {
  const p = tapPulses(tap), out: number[] = [];
  if (header.length !== 192) throw new Error('a KERNAL tape header has 192 bytes');
  cbmPulses(out, header, data, 0x6a00);
  for (let i = f.to; i < p.cycles.length; i++) out.push(p.cycles[i] < 8 * 256 ? Math.max(1, Math.round(p.cycles[i] / 8)) : -p.cycles[i]);
  return tapOf(out);
}

/** A TAP (version 1) of these pulses: TAP units (cycles / 8), or a longer pulse as minus its cycles. */
function tapOf(pulses: number[]): Uint8Array {
  let n = 0;
  for (const v of pulses) n += v < 0 ? 4 : 1;
  const u8 = new Uint8Array(20 + n);
  for (let i = 0; i < MAGIC.length; i++) u8[i] = MAGIC.charCodeAt(i);
  u8[12] = 1;
  u8[16] = n & 0xff; u8[17] = (n >> 8) & 0xff; u8[18] = (n >> 16) & 0xff; u8[19] = n >>> 24;
  let k = 20;
  for (const v of pulses) {
    if (v >= 0) { u8[k++] = v; continue; }
    const c = Math.min(-v, 0xffffff);
    u8[k++] = 0; u8[k++] = c & 0xff; u8[k++] = (c >> 8) & 0xff; u8[k++] = c >> 16;
  }
  return u8;
}

/** A header block and its data block (none for a marker), each twice, as SAVE writes them, in TAP units. */
function cbmPulses(out: number[], header: Uint8Array, data: Uint8Array | null, leader: number): void {
  const pulse = (v: number, n = 1) => { for (let i = 0; i < n; i++) out.push(v); };
  const byte = (v: number) => {
    pulse(PAL_LONG); pulse(PAL_MEDIUM);
    let ones = 0;
    for (let b = 0; b < 8; b++) { const bit = (v >> b) & 1; ones += bit; if (bit) { pulse(PAL_MEDIUM); pulse(PAL_SHORT); } else { pulse(PAL_SHORT); pulse(PAL_MEDIUM); } }
    if (ones & 1) { pulse(PAL_SHORT); pulse(PAL_MEDIUM); } else { pulse(PAL_MEDIUM); pulse(PAL_SHORT); }
  };
  const block = (data: Uint8Array, leader: number) => {
    for (const copy of [0x80, 0x00]) {
      pulse(PAL_SHORT, copy ? leader : 0x4f);
      for (let i = 9; i >= 1; i--) byte(copy | i);
      let x = 0;
      for (const v of data) { byte(v); x ^= v; }
      byte(x);
      pulse(PAL_LONG); pulse(PAL_SHORT);
    }
    pulse(PAL_SHORT, 0x4e);
  };
  block(header, leader);
  if (data) block(data, 0x1500);
}
