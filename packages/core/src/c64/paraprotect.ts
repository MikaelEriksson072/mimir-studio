/* Para-Protect V2 ("PARA-PROTECTED BY PARANOID 1988"), a copy protection and fast loader that several publishers'
 * disks of 1987-1988 have (System 3's Bangkok Knights, Elite's Buggy Boy, Thundercats and Beyond the Ice Palace,
 * Electra's Better Dead than Alien, Digital Integration's F-16 Combat Pilot, Screen 7's Jaws, DataByte's Superstar Ice
 * Hockey), read from the disk (spec 13.5o; the analysis is in docs/paraprotect.md).
 *
 * The directory lists one file under many names: the boot, five blocks at $00AE. LOAD's own pointer at $AE/$AF is the
 * first thing it loads over, so the rest goes where the bytes before have pointed it, and the stack page is filled
 * with $02 so that LOAD returns to $0203. On the way it loads over the STOP vector at $0328: the KERNAL's serial LOAD
 * calls STOP before every byte it takes, so from there on the boot's own code runs between its bytes, and from $033B
 * on that code decodes each byte as it comes in (an XOR with the pointer, a key that moves on, and a table of its own).
 * At $0203 it clears memory, decodes a few bytes more, checks for a cartridge at $DE00/$DF00 and has the drive read
 * its code from track 18 (an M-E command whose bytes are a DOS job; the stages read 18/18 and 18/15 and so on). The
 * drive code then takes requests: a number of pages, a track and a sector (bit 7: back to the DOS after it). It finds
 * each sector's header as the DOS does, takes the data block after it whatever its first byte (the ID the DOS wants to
 * be $07: Bangkok Knights has the sector's number there, so a 1541's DOS reads none of it), and goes on 8 sectors
 * further, to the next track's sector 0 when that comes round to 0. The C64 receives two bits at a time and stores
 * the pages under the I/O. The requests the boot makes are in a table its loader stub reads (where the pages go, how
 * many, the track, the sector); that table is read here from the boot as LOAD leaves it, its decoding run on Sindri's
 * 6510. A game asks for more itself: a page from track 40 (sector 14) most of them.
 *
 * Bangkok Knights' game has a loader of its own besides: its drive code reads a directory of its own from 11/0, with
 * sector chains as the DOS's, but every data block right after its header, with no SYNC between (the DOS cannot read
 * them), and track 11's sector 0 with no SYNC before its header either. That directory and its files are read here
 * too, wherever such sectors are. */
import { Cpu, decodeGcr, isG64, parseG64, sectorsOn, syncEnds, type Bus } from '@mimir/sindri';
import { diskSectors, parseD64, petsciiName, readD64File, sectorOffset, type D64File } from './d64';

/** A request in the boot's table: where the pages go, how many, the first track and sector. */
export interface ParaProtectRequest {
  /** its index in the table (X when the loader stub is called) */
  index: number;
  dest: number; pages: number; track: number; sector: number;
  /** bit 7 of the sector: the drive goes back to its DOS after this one */
  dos: boolean;
}

export type ParaProtectKind = 'loader' | 'page' | 'own';

/** A file read from the disk: by the boot's loader (a request of its table), a page past track 35 that no request
 *  names (a game asks for it itself), or a file of the game's own directory (Bangkok Knights). */
export interface ParaProtectFile {
  kind: ParaProtectKind;
  /** the host file name it is saved under */
  name: string;
  /** its first sector */
  track: number; sector: number;
  /** the sectors it reads, in order ("21/0", …) */
  sectors: string[];
  /** where it loads, its bytes, and where they end (at most $10000) */
  load: number; end: number; bytes: Uint8Array;
  /** sectors read with a wrong checksum or bytes that are no GCR, and sectors not found (their bytes are 0) */
  bad: number; missing: number;
  /** the request it is, for a loader file */
  request?: ParaProtectRequest;
  /** where it loads is worked out from its own code (a page no request names) */
  guessed?: boolean;
  note: string;
}

export interface ParaProtectBoot {
  /** the directory's file that is the boot (the first; the others have its track and sector too) */
  name: string; blocks: number;
  /** how to call it: its name in quotes, or the first file and its sector when the name is only graphics (Bangkok Knights) */
  label: string;
  /** where LOAD starts it and where LOAD ends */
  load: number; end: number;
  /** the STOP vector's calls while it loads */
  calls: number;
  /** where its loader stub is in the boot as loaded, and where it is copied to */
  stub: number; stubAt: number;
  /** the requests of its table */
  requests: ParaProtectRequest[];
  /** the drive command it sends, decoded ("M-E" and its bytes) */
  command: string | null;
}

export interface ParaProtectDisk {
  format: 'D64' | 'G64';
  /** the boot's texts ("PARA-PROTECT V2 1987", "PARA-PROTECTED BY PARANOID 1988") */
  text: string[];
  boot: ParaProtectBoot | null;
  /** the first byte of the loader's data blocks: $07 as the DOS's, or the sector's number (Bangkok Knights) */
  ids: 'dos' | 'sector' | 'mixed' | null;
  /** how the drive loader goes from sector to sector */
  stepping: ParaProtectStepping;
  /** the game's own directory (Bangkok Knights: 11/0), and its files in `files` */
  ownDirectory: { track: number; sector: number; sectors: string[] } | null;
  files: ParaProtectFile[];
  /** one line for the Explorer and the toast */
  summary: string;
}

const hex = (n: number, w = 4): string => n.toString(16).padStart(w, '0');

/** PETSCII as text the way the boot's texts read: shifted letters ($C1-$DA) as capitals */
const plain = (b: Uint8Array): string => Array.from(b, c => {
  const x = c >= 0xc1 && c <= 0xda ? c - 0x80 : c;
  return x >= 0x20 && x < 0x7f ? String.fromCharCode(x) : ' ';
}).join('');

/** the boot's texts: "PARA-PROTECT V2 1987" and "PARA-PROTECTED BY PARANOID 1988" */
function bootTexts(bytes: Uint8Array[]): string[] {
  const out: string[] = [];
  for (const b of bytes) {
    for (const m of plain(b).matchAll(/PARA-PROTECT(?:ED BY PARANOID [0-9]{4}| V[0-9] [0-9]{4})/g)) if (!out.includes(m[0])) out.push(m[0]);
  }
  return out;
}

/* ---- the boot, as LOAD leaves it ---- */

const KERNAL_STOP = 0xf6ed;

/**
 * The boot as the KERNAL's serial LOAD (LOAD"*",8,1) leaves it in memory: a byte at a time through the pointer at
 * $AE/$AF, and before each byte after the first the STOP vector at $0328 called (JSR $FFE1 at $F4F9) once the file
 * has loaded over it with an address in RAM. The code it calls runs here on Sindri's 6510 until it leaves RAM (it
 * ends with a jump into the KERNAL's STOP routine or an RTS to it). The input buffer at $0200 holds the line typed.
 */
function bootMemory(prg: Uint8Array): { mem: Uint8Array; end: number; calls: number } | null {
  if (prg.length < 3) return null;
  const mem = new Uint8Array(0x10000);
  mem.set([0x93, 0x22, 0x2a, 0x22, 0x2c, 0x38, 0x2c, 0x31, 0x00], 0x0200);
  mem[0x0328] = KERNAL_STOP & 0xff; mem[0x0329] = KERNAL_STOP >> 8;
  const bus: Bus = { read: a => mem[a], write: (a, v) => { if (a >= 2) mem[a] = v; }, fetch: a => mem[a] };
  const cpu = new Cpu(bus);
  mem[0xae] = prg[0]; mem[0xaf] = prg[1];
  let calls = 0, steps = 0;
  for (let i = 2; i < prg.length; i++) {
    const v = mem[0x0328] | (mem[0x0329] << 8);
    if (i > 2 && v !== KERNAL_STOP && v < 0xa000) {
      calls++;
      // the return to $F4FC that JSR $FFE1 pushed, where the stack is in the KERNAL's loop
      mem[0x01f7] = 0xf4; mem[0x01f6] = 0xfb; cpu.s = 0xf5;
      cpu.pc = v;
      let n = 0;
      while (cpu.pc < 0xa000 && !cpu.jammed && n < 20000) { cpu.step(); n++; }
      steps += n;
      if (cpu.jammed || n >= 20000 || steps > 4_000_000) return null;
    }
    const a = mem[0xae] | (mem[0xaf] << 8);
    if (a >= 2) mem[a] = prg[i];
    // INC $AE / BNE / INC $AF, from memory after the store
    let lo = mem[0xae], hi = mem[0xaf];
    lo = (lo + 1) & 0xff; if (!lo) hi = (hi + 1) & 0xff;
    mem[0xae] = lo; mem[0xaf] = hi;
  }
  return { mem, end: mem[0xae] | (mem[0xaf] << 8), calls };
}

/** where `pattern` (null: any byte) is in mem[from..to) */
function find(mem: Uint8Array, pattern: (number | null)[], from: number, to: number): number {
  outer: for (let a = from; a + pattern.length <= to; a++) {
    for (let k = 0; k < pattern.length; k++) if (pattern[k] != null && mem[a + k] !== pattern[k]) continue outer;
    return a;
  }
  return -1;
}

/**
 * The loader stub and its table. The stub (sei / lda dest,x / sta $8f / lda pages,x / pha / lda track,x / pha / ldy
 * sector,x / … / pla / tax / pla / jmp $00b2) is copied to page 2 with the table after it; the copy loop says where
 * (lda stub,y / sta $02xx,y). The tables follow one another, so the number of requests is how far apart they are.
 */
function loaderTable(mem: Uint8Array): { stub: number; stubAt: number; requests: ParaProtectRequest[] } | null {
  const stub = find(mem, [0x78, 0xbd, null, 0x02, 0x85, 0x8f, 0xbd, null, 0x02, 0x48, 0xbd, null, 0x02, 0x48, 0xbc, null, 0x02], 0x0200, 0x0800);
  if (stub < 0 || find(mem, [0x68, 0xaa, 0x68, 0x4c, 0xb2, 0x00], stub + 17, stub + 30) < 0) return null;
  const copy = find(mem, [0xb9, stub & 0xff, stub >> 8, 0x99, null, 0x02], 0x0200, 0x0800);
  if (copy < 0) return null;
  const stubAt = 0x0200 | mem[copy + 4];
  const at = (k: number) => stub + ((0x0200 | mem[stub + k]) - stubAt);
  const [dest, pages, track, sector] = [at(2), at(7), at(11), at(15)];
  const n = pages - dest;
  if (n < 1 || n > 16 || track - pages !== n || sector - track !== n) return null;
  const requests: ParaProtectRequest[] = [];
  for (let k = 0; k < n; k++) {
    const s = mem[sector + k];
    requests.push({ index: k, dest: mem[dest + k] << 8, pages: mem[pages + k] || 256, track: mem[track + k], sector: s & 0x7f, dos: (s & 0x80) !== 0 });
  }
  return { stub, stubAt, requests };
}

/** The drive command the boot sends, decoded: ldx #0 / ldy #n / tya / dec cmd,x / eor cmd,x / jsr $eddd (Bangkok
 *  Knights), or sent as it is backwards and forwards (lda cmd,y / jsr $eddd / tya / sta cmd,y …, the others). */
function driveCommand(mem: Uint8Array): string | null {
  const show = (b: number[]) => {
    const t = plain(Uint8Array.from(b));
    const m = /M-[EWR]/.exec(t);
    return m ? `${m[0]} $${hex(b[m.index + 3] | (b[m.index + 4] << 8))}` : null;
  };
  const x = find(mem, [0xa2, 0x00, 0xa0, null, 0x98, 0xde, null, null, 0x5d, null, null, 0x20, 0xdd, 0xed], 0x0200, 0x0800);
  if (x >= 0) {
    const n = mem[x + 3], at = mem[x + 6] | (mem[x + 7] << 8), cmd: number[] = [];
    for (let k = 0, y = n; y >= 0; k++, y--) cmd.push(((mem[at + k] - 1) & 0xff) ^ y);
    return show(cmd);
  }
  const y = find(mem, [0xa0, null, 0xb9, null, null, 0x20, 0xdd, 0xed, 0x98, 0x99], 0x0200, 0x0800);
  if (y >= 0) {
    const n = mem[y + 1], at = mem[y + 3] | (mem[y + 4] << 8), cmd: number[] = [];
    for (let k = n; k >= 0; k--) cmd.push(mem[at + k]);
    return show(cmd);
  }
  return null;
}

/* ---- the sectors ---- */

interface Read { id: number; ok: boolean; data: Uint8Array }
type Track = Map<number, Read>;

const bitOf = (t: Uint8Array, i: number): number => (t[(i >> 3) % t.length] >> (7 - (i & 7))) & 1;
const bytesAt = (t: Uint8Array, at: number, count: number): number[] => {
  const out: number[] = [];
  for (let b = 0; b < count; b++) { let v = 0; for (let j = 0; j < 8; j++) v = (v << 1) | bitOf(t, at + b * 8 + j); out.push(v); }
  return out;
};

/** a data block's 326 GCR bytes as the drive decodes them ($F8E0): its first byte, 256 bytes, the checksum */
function dataBlock(g: number[]): Read {
  const d = decodeGcr(g);
  let sum = 0;
  for (let i = 1; i <= 256; i++) sum ^= d[i] ?? 0;
  const ok = d.slice(0, 258).every(v => v != null) && sum === d[257];
  return { id: d[0] ?? -1, ok, data: Uint8Array.from(d.slice(1, 257), v => v ?? 0) };
}

/** a sector header's first 6 bytes decoded, when it is one of `track`'s with the right checksum */
function header(t: Uint8Array, at: number, track: number): number | null {
  const h = decodeGcr(bytesAt(t, at, 10));
  if (h[0] !== 0x08 || h[3] !== track || h[2] == null || h[2] >= 42) return null;
  return h[1] === (h[2] ^ h[3] ^ (h[4] ?? 0) ^ (h[5] ?? 0)) ? h[2] : null;
}

/** Para-Protect's loader on a track: each header after a SYNC, the data block after the SYNC that follows it, whatever
 *  its first byte (the first good copy of each sector). */
function loaderTrack(t: Uint8Array | null, track: number): Track {
  const m: Track = new Map();
  if (!t) return m;
  const ends = syncEnds(t), bits = t.length * 8;
  for (let k = 0; k < ends.length; k++) {
    const s = header(t, ends[k], track);
    if (s == null) continue;
    const next = ends[(k + 1) % ends.length], gap = (next - ends[k] + bits) % bits;
    if (ends.length < 2 || gap <= 80 || gap > 80 + 60 * 8) continue;
    const r = dataBlock(bytesAt(t, next, 326));
    if (!m.has(s) || (!m.get(s)!.ok && r.ok)) m.set(s, r);
  }
  return m;
}

/** Bangkok Knights' own format on a track: a header found by its bytes, framed from the SYNC before it (a header may
 *  have no SYNC of its own: track 11's sector 0), and the data block's GCR 11 bytes after the header begins, with no
 *  SYNC between. */
function ownTrack(t: Uint8Array | null, track: number): Track {
  const m: Track = new Map();
  if (!t) return m;
  const ends = syncEnds(t), bits = t.length * 8;
  for (let k = 0; k < ends.length; k++) {
    const e = ends[k], span = (ends[(k + 1) % ends.length] - e + bits) % bits || bits;
    for (let p = 0; p + 80 <= span; p += 8) {
      // a header's GCR starts $52 ($08's code, then the checksum's first bits)
      if (bytesAt(t, e + p, 1)[0] !== 0x52) continue;
      const s = header(t, e + p, track);
      if (s == null) continue;
      const r = dataBlock(bytesAt(t, e + p + 88, 326));
      if (r.ok && (!m.has(s) || !m.get(s)!.ok)) m.set(s, r);
    }
  }
  return m;
}

/** The sectors as the loader reads them: from a G64's tracks (any first byte), or a D64's (its error bytes, if it has
 *  them, say which it could not read). */
function sectorSource(image: Uint8Array): { loader: (track: number) => Track; own: ((track: number) => Track) | null; tracks: number } {
  if (isG64(image)) {
    const g = parseG64(image), a = new Map<number, Track>(), b = new Map<number, Track>();
    return {
      loader: t => { let m = a.get(t); if (!m) { m = loaderTrack(g.halves[t * 2] ?? null, t); a.set(t, m); } return m; },
      own: t => { let m = b.get(t); if (!m) { m = ownTrack(g.halves[t * 2] ?? null, t); b.set(t, m); } return m; },
      tracks: 42,
    };
  }
  const d = diskSectors(image), img = parseD64(image), cache = new Map<number, Track>();
  const total = (() => { let n = 0; for (let t = 1; t <= img.tracks; t++) n += sectorsOn(t); return n; })();
  return {
    loader: t => {
      let m = cache.get(t);
      if (m) return m;
      m = new Map();
      if (t >= 1 && t <= img.tracks) {
        for (let s = 0; s < sectorsOn(t); s++) {
          const o = sectorOffset(t, s, img.tracks), e = img.errorInfo ? d[total * 256 + o / 256] : 1;
          m.set(s, { id: e <= 1 ? 7 : -1, ok: e <= 1, data: d.slice(o, o + 256) });
        }
      }
      cache.set(t, m);
      return m;
    },
    own: null,
    tracks: img.tracks,
  };
}

/**
 * How the drive loader goes from sector to sector: `step` sectors on, and the number of sectors a track has, from the
 * DOS ($F24B: 21, 19, 18, 17) or from a table of the loader's own by speed zone (tracks 31-35, 25-30, 18-24, 1-17).
 * Where its code is on track 18 as it is (18/15 on Elite's, Electra's, DataByte's … disks: lda track / jsr $f24b / lda
 * table,x / sta $c2 / clc / lda sector / adc #step / cmp $c2), both are read from it: 17, 17, 19, 19 and 8 (F-16
 * Combat Pilot: 1). Bangkok Knights' stages are encrypted on the disk: its loader (decoded in the drive) takes the
 * DOS's counts, 8 on.
 */
export interface ParaProtectStepping { step: number; counts: [number, number, number, number] | null; from: string | null }

function loaderStepping(sector18: (s: number) => Uint8Array | null): ParaProtectStepping {
  for (let s = 0; s < 19; s++) {
    const b = sector18(s);
    if (!b) continue;
    for (let i = 0; i + 16 < 256; i++) {
      if (b[i] !== 0x20 || b[i + 1] !== 0x4b || b[i + 2] !== 0xf2) continue;
      let j = i + 3, table = -1;
      if (b[j] === 0xbd) { table = b[j + 1] | (b[j + 2] << 8); j += 3; }
      if (b[j] !== 0x85 || b[j + 1] !== 0xc2 || b[j + 2] !== 0x18 || b[j + 3] !== 0xa5 || b[j + 5] !== 0x69 || b[j + 7] !== 0xc5) continue;
      const step = b[j + 6];
      if (table < 0) return { step, counts: null, from: `18/${s}` };
      // the page the code runs in, by its own jsr and jmp targets; the drive has 18/18 at $0700 (the M-E command's
      // read), 18/15 at $0600 and 18/14 at $0500
      const pages = new Map<number, number>();
      for (let k = 0; k + 2 < 256; k++) if ((b[k] === 0x20 || b[k] === 0x4c) && b[k + 2] >= 3 && b[k + 2] <= 7) pages.set(b[k + 2], (pages.get(b[k + 2]) ?? 0) + 1);
      const page = [...pages].sort((x, y) => y[1] - x[1])[0]?.[0];
      const at = (a: number): number => {
        const p = a >> 8, src = p === page ? b : sector18(p === 7 ? 18 : p === 6 ? 15 : p === 5 ? 14 : -1);
        return src ? src[a & 0xff] : 0;
      };
      const counts = [at(table), at(table + 1), at(table + 2), at(table + 3)] as [number, number, number, number];
      if (counts.every(n => n >= 16 && n <= 24)) return { step, counts, from: `18/${s}` };
    }
  }
  return { step: 8, counts: null, from: null };
}

/** the number of sectors the loader takes a track to have */
const loaderCount = (how: ParaProtectStepping, track: number): number => {
  if (track > 35) return sectorsOn(Math.min(track, 42));
  if (!how.counts) return sectorsOn(track);
  return how.counts[track >= 31 ? 0 : track >= 25 ? 1 : track >= 18 ? 2 : 3];
};

/** a request's pages as the drive loader reads them: `step` sectors on, to the next track's sector 0 when it comes
 *  round to 0 */
function requestBytes(read: (t: number) => Track, how: ParaProtectStepping, pages: number, track: number, sector: number) {
  const bytes = new Uint8Array(pages * 256), sectors: string[] = [], ids = new Set<'dos' | 'sector'>();
  let bad = 0, missing = 0;
  for (let p = 0; p < pages; p++) {
    sectors.push(`${track}/${sector}`);
    const r = track <= 42 ? read(track).get(sector) : undefined;
    if (!r) missing++;
    else {
      if (!r.ok) bad++;
      bytes.set(r.data, p * 256);
      if (r.ok && r.id === sector) { if (sector !== 7) ids.add('sector'); } else if (r.ok && r.id === 7) ids.add('dos');
    }
    const n = loaderCount(how, track);
    let s = sector + how.step;
    if (s >= n) { s -= n; if (s === 0) track++; }
    sector = s;
  }
  return { bytes, sectors, bad, missing, ids };
}

/** Where a page loads, from its own code: the high byte most of its JSR and JMP targets have, when they land in it. */
function pageHome(b: Uint8Array): number | null {
  const count = new Map<number, number>();
  for (let i = 0; i + 2 < b.length; i++) {
    if (b[i] !== 0x20 && b[i] !== 0x4c) continue;
    count.set(b[i + 2], (count.get(b[i + 2]) ?? 0) + 1);
  }
  let best = -1, n = 0;
  for (const [h, c] of count) if (c > n || (c === n && h < best)) { best = h; n = c; }
  return n >= 3 && best >= 0x02 && best < 0xd0 ? best << 8 : null;
}

/* ---- Bangkok Knights' own directory ---- */

/** a directory sector: link, then 8 entries of 32 bytes, each empty or a file with its track/sector and a name */
function isDirectory(b: Uint8Array): boolean {
  let used = 0;
  for (let e = 0; e < 8; e++) {
    const x = b.subarray(e * 32, e * 32 + 32), type = x[2];
    if (!type) continue;
    if ((type & 0x7f) < 1 || (type & 0x7f) > 4 || !x[3] || x[3] > 42 || x[4] >= sectorsOn(x[3])) return false;
    if (!x.subarray(5, 21).some(c => c !== 0xa0) || x.subarray(5, 21).some(c => c < 0x20 && c !== 0)) return false;
    used++;
  }
  return used > 0;
}

function ownDirectory(own: (t: number) => Track, tracks: number): { dir: ParaProtectDisk['ownDirectory']; files: ParaProtectFile[] } {
  const dirs = new Map<string, Uint8Array>();
  for (let t = 1; t <= tracks; t++) for (const [s, r] of own(t)) if (r.ok && isDirectory(r.data)) dirs.set(`${t}/${s}`, r.data);
  if (!dirs.size) return { dir: null, files: [] };
  const linked = new Set([...dirs.values()].map(b => `${b[0]}/${b[1]}`));
  const start = [...dirs.keys()].find(k => !linked.has(k));
  if (!start) return { dir: null, files: [] };
  const files: ParaProtectFile[] = [], sectors: string[] = [];
  let [t, s] = start.split('/').map(Number);
  while (t && dirs.has(`${t}/${s}`) && !sectors.includes(`${t}/${s}`)) {
    sectors.push(`${t}/${s}`);
    const b = dirs.get(`${t}/${s}`)!;
    for (let e = 0; e < 8; e++) {
      const x = b.subarray(e * 32, e * 32 + 32);
      if (!x[2]) continue;
      const name = petsciiName(x.subarray(5, 21));
      const parts: Uint8Array[] = [], chain: string[] = [];
      let [ft, fs] = [x[3], x[4]];
      let missing = 0;
      while (ft) {
        const key = `${ft}/${fs}`;
        if (chain.includes(key)) break;
        const r = ft <= tracks ? own(ft).get(fs) : undefined;
        if (!r) { missing++; break; }
        chain.push(key);
        parts.push(r.data[0] ? r.data.subarray(2) : r.data.subarray(2, Math.max(2, r.data[1] + 1)));
        [ft, fs] = [r.data[0], r.data[1]];
      }
      const all = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
      parts.reduce((o, p) => (all.set(p, o), o + p.length), 0);
      const load = all.length >= 2 ? all[0] | (all[1] << 8) : 0, bytes = all.subarray(2);
      files.push({
        kind: 'own', name: `${name.replace(/[^\w.-]+/g, '_') || `t${x[3]}s${x[4]}`}.prg`, track: x[3], sector: x[4], sectors: chain,
        load, end: Math.min(0x10000, load + bytes.length), bytes, bad: 0, missing,
        note: `"${name}" in the game's own directory (${sectors[0]}), ${x[30] | (x[31] << 8)} blocks: a sector chain of its own format, every data block right after its header`,
      });
    }
    [t, s] = [b[0], b[1]];
  }
  return { dir: { track: Number(start.split('/')[0]), sector: Number(start.split('/')[1]), sectors }, files };
}

/* ---- the disk ---- */

/** A host file name for a file the loader reads: its first sector and where it loads (t21s0_ba00.prg). */
export const paraProtectFileName = (f: Pick<ParaProtectFile, 'name'>): string => f.name;

/** A file as a PRG: its load address and its bytes, as far as memory holds them. */
export function paraProtectPrg(f: ParaProtectFile): Uint8Array {
  const out = new Uint8Array(2 + f.end - f.load);
  out[0] = f.load & 0xff; out[1] = f.load >> 8;
  out.set(f.bytes.subarray(0, f.end - f.load), 2);
  return out;
}

/** The files as text (files.txt beside them when they are saved): a line each, after a header that says what they are. */
export function paraProtectFileList(disk: ParaProtectDisk, name: string): string[] {
  const n = disk.files.length;
  const out = [
    `; Para-Protect files of ${name}, read by Mimir Studio: ${n} file${n === 1 ? '' : 's'} the directory does not list.`,
    "; Loader files: a request of the boot's table, pages by track and sector (8 sectors on, the next track at sector 0).",
    '; Their names are made up of the first sector and the load address; a game directory\'s files keep their names.',
  ];
  for (const f of disk.files) {
    const past = f.load + f.bytes.length - f.end;
    out.push(`${f.name.padEnd(18)} ; ${f.track}/${f.sector}, ${f.sectors.length} sector${f.sectors.length === 1 ? '' : 's'}, loads at $${hex(f.load)}-$${hex(f.end - 1)} (${f.end - f.load} bytes)${f.bad ? `, ${f.bad} bad` : ''}${f.missing ? `, ${f.missing} missing` : ''}${past > 0 ? `, the ${past} bytes past $ffff left out` : ''}: ${f.note}`);
  }
  return out;
}

/** Para-Protect on a disk image (G64 or D64): its boot, the boot's requests, the files they and the game read; null
 *  when its boot is not on it. */
export function readParaProtectDisk(image: Uint8Array): ParaProtectDisk | null {
  const format = isG64(image) ? 'G64' : 'D64';
  let dir;
  try { dir = parseD64(image); } catch { return null; }
  const first = dir.files.find(f => f.type === 'PRG' && f.track);
  if (!first) return null;
  let prg: Uint8Array;
  try { prg = readD64File(image, first); } catch { return null; }
  const text = bootTexts([prg]);
  if (!text.length) return null;
  const same = dir.files.filter((f: D64File) => f.track === first.track && f.sector === first.sector).length;
  const label = /[A-Za-z0-9]/.test(first.name) ? `"${first.name}"` : `the first file (${first.track}/${first.sector})`;
  const loaded = bootMemory(prg);
  const table = loaded ? loaderTable(loaded.mem) : null;
  const boot: ParaProtectBoot | null = loaded ? {
    name: first.name, label, blocks: Math.max(first.blocks, Math.ceil((prg.length + 2) / 254)), load: prg[0] | (prg[1] << 8), end: loaded.end, calls: loaded.calls,
    stub: table?.stub ?? -1, stubAt: table?.stubAt ?? -1, requests: table?.requests ?? [], command: driveCommand(loaded.mem),
  } : null;
  const src = sectorSource(image);
  const stepping = loaderStepping(s => src.loader(18).get(s)?.data ?? null);
  const files: ParaProtectFile[] = [];
  const read = new Set<string>(), ids = new Set<'dos' | 'sector'>();
  for (const q of boot?.requests ?? []) {
    const r = requestBytes(src.loader, stepping, q.pages, q.track, q.sector);
    r.sectors.forEach(s => read.add(s));
    r.ids.forEach(i => ids.add(i));
    files.push({
      kind: 'loader', name: `t${q.track}s${q.sector}_${hex(q.dest)}.prg`, track: q.track, sector: q.sector, sectors: r.sectors,
      load: q.dest, end: Math.min(0x10000, q.dest + r.bytes.length), bytes: r.bytes, bad: r.bad, missing: r.missing, request: q,
      note: `the boot's request ${q.index} (X=${q.index}): ${q.pages} page${q.pages === 1 ? '' : 's'} from ${q.track}/${q.sector} to $${hex(q.dest)}${q.dos ? ', then the drive goes back to its DOS' : ''}`,
    });
  }
  // pages past track 35 that no request names: a game asks for them itself
  for (let t = 36; t <= src.tracks; t++) {
    for (const [s, r] of [...src.loader(t)].sort((a, b) => a[0] - b[0])) {
      if (read.has(`${t}/${s}`) || !r.ok || r.data.every(v => !v)) continue;
      const home = pageHome(r.data);
      files.push({
        kind: 'page', name: `t${t}s${s}_${hex(home ?? 0)}.prg`, track: t, sector: s, sectors: [`${t}/${s}`],
        load: home ?? 0, end: (home ?? 0) + 256, bytes: r.data, bad: 0, missing: 0, guessed: home != null,
        note: `a page no request of the boot names: the game asks the loader for it itself${home != null ? `; it loads at $${hex(home)} as its own calls say` : '; where it loads is not on the disk'}`,
      });
    }
  }
  const own = src.own ? ownDirectory(src.own, src.tracks) : { dir: null, files: [] };
  files.push(...own.files);
  const idKind = ids.size === 2 ? 'mixed' : ids.has('sector') ? 'sector' : ids.has('dos') ? 'dos' : null;
  const loaderFiles = files.filter(f => f.kind === 'loader'), bad = files.reduce((a, f) => a + f.bad + f.missing, 0);
  const summary = [
    `${text.find(t => /V\d/.test(t))?.replace('PARA-PROTECT', 'Para-Protect') ?? 'Para-Protect'} (Paranoid): boot ${label}${same > 1 ? ` (${same} directory entries)` : ''} at $${hex(boot?.load ?? 0)}`,
    loaderFiles.length ? `${loaderFiles.length} loader file${loaderFiles.length === 1 ? '' : 's'}${idKind === 'sector' ? ' (data blocks marked with their sector number)' : ''}` : 'no loader table found',
    ...files.some(f => f.kind === 'page') ? [`${files.filter(f => f.kind === 'page').length} page${files.filter(f => f.kind === 'page').length === 1 ? '' : 's'} past track 35`] : [],
    ...own.dir ? [`${own.files.length} file${own.files.length === 1 ? '' : 's'} in the game's own directory (${own.dir.track}/${own.dir.sector})`] : [],
    ...bad ? [`${bad} sector${bad === 1 ? '' : 's'} not read${format === 'D64' ? ' (a D64 holds only what the DOS reads: mount the G64)' : ''}`] : [],
  ].join('; ');
  return { format, text, boot, ids: idKind, stepping, ownDirectory: own.dir, files, summary };
}
