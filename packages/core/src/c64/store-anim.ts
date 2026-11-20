/* Animations stored as lists of stores (store streams): the bytes of such an animation are no packed program. Nothing
 * unpacks them into memory; a player reads one frame each time it is called and stores the frame's values into the
 * screens and colour RAM. So they are recognised here by their player and read as it reads them, to tell the files
 * that hold them from packed ones.
 *
 * The player known so far is the one in Extend's Bliss Machine (disk 1, Spindle job 5, at $1f9d, called from the
 * part's raster interrupt once a frame): its stream is in jobs 6-8 ($8000-$cced, 448 frames of lightning striking).
 * A frame is
 * - a byte N: the number of groups (0: the frame changes nothing);
 * - a group: an index x into two tables of the player, `count = groups[x]` and `page = pages[x]`; when the count is 0
 *   the page and the count follow as bytes of their own;
 * - then `count` values: an index x into two more tables, `n = counts[x]` and `value = values[x]`; when n is 0 the
 *   value and n follow as bytes of their own;
 * - then n low bytes: the player stores the value at page:low for each.
 * An explicit count of 0 is 256 (the player counts down to 0). The player reads the stream through a pointer in the
 * zero page and adds what it read to it after the frame, so the frames follow one another.
 *
 * The player is found by its code: reading a byte is `lda (ptr),y / iny / bne +2 / inc ptr+1`, and the store is
 * `sta lo / stx $hh00` with `lo` the stx's own operand and the page stored into its high byte by the group. Where the
 * frames start comes from the code that sets the pointer (`lda #<start / sta ptr / lda #>start / sta ptr+1`). The
 * stream ends where the bytes holding it end: the frames are read one after another while they are in loaded bytes. */
import type { Addr } from '../types';
import type { SpindleDisk, SpindleJob } from './spindle-disk';

/** frames read at most from a start */
const MAX_FRAMES = 20000;

export interface StorePlayer {
  /** where the player starts (`ldy #0`, before its first read) */
  entry: Addr;
  /** the stream pointer in the zero page (low byte; the high byte is the next) */
  ptr: number;
  /** the four tables: a group's count and page, a value's count and value (by the index the stream gives) */
  groups: Addr; pages: Addr; counts: Addr; values: Addr;
}

export interface StoreAnim {
  player: StorePlayer;
  /** the code that points the player at the stream (`lda #<start`) */
  setter: Addr;
  /** the stream: its first byte and the byte after its last frame */
  start: Addr; end: Addr;
  /** where each frame starts (the first one is `start`) */
  frames: Addr[];
  /** the pages the frames store into (high bytes), in order */
  pages: number[];
  /** stores the frames make in all */
  stores: number;
}

/** bytes the player is long, from its entry to the end of the code that moves the pointer on after a frame */
const PLAYER_LEN = 90;

/** the read of a byte through the pointer: `lda (p),y / iny / bne +2 / inc p+1` (7 bytes) */
const isRead = (m: Uint8Array, a: number, p: number) =>
  m[a] === 0xb1 && m[a + 1] === p && m[a + 2] === 0xc8 && m[a + 3] === 0xd0 && m[a + 4] === 0x02 && m[a + 5] === 0xe6 && m[a + 6] === p + 1;
const w = (m: Uint8Array, a: number) => m[a] | m[a + 1] << 8;
/** where a branch at `a` goes */
const target = (m: Uint8Array, a: number) => (a + 2 + (m[a + 1] << 24 >> 24)) & 0xffff;

/** The player whose code starts at `e` (`ldy #0`), or null. The layout is the one in Bliss Machine's part:
 *  e+0  ldy #0 / read / sta n / cmp #0 / beq done
 *  e+15 group: read / tax / lda groups,x / beq explicit / sta c1 / lda pages,x / sta hi
 *  e+36 value: read / tax / lda counts,x / beq explicit / sta c2 / lda values,x / tax
 *  e+55 low:   read / sta lo / stx $hh00 (lo, hi: its operand) / dec c2 / bne low / dec c1 / bne value / dec n / bne group
 *  e+80 done:  tya / clc / adc p / sta p / bcc +2 / inc p+1
 *  the explicit group: read / sta hi / read / sta c1 / jmp value; the explicit value: read / tax / read / sta c2 / jmp low */
export function storePlayerAt(m: Uint8Array, e: number): StorePlayer | null {
  if (e + PLAYER_LEN > 0x10000 || m[e] !== 0xa0 || m[e + 1] !== 0) return null;
  const p = m[e + 3];
  if (p === 0xff || !isRead(m, e + 2, p)) return null;
  const n = m[e + 10];
  if (m[e + 9] !== 0x85 || m[e + 11] !== 0xc9 || m[e + 12] !== 0 || m[e + 13] !== 0xf0 || target(m, e + 13) !== e + 80) return null;
  const group = e + 15, value = e + 36, low = e + 55, op = e + 66;
  // the group
  if (!isRead(m, group, p) || m[e + 22] !== 0xaa || m[e + 23] !== 0xbd || m[e + 26] !== 0xf0 || m[e + 28] !== 0x85 || m[e + 30] !== 0xbd || m[e + 33] !== 0x8d || w(m, e + 34) !== op + 1) return null;
  const c1 = m[e + 29];
  // the value
  if (!isRead(m, value, p) || m[e + 43] !== 0xaa || m[e + 44] !== 0xbd || m[e + 47] !== 0xf0 || m[e + 49] !== 0x85 || m[e + 51] !== 0xbd || m[e + 54] !== 0xaa) return null;
  const c2 = m[e + 50];
  // the store and the loops
  if (!isRead(m, low, p) || m[e + 62] !== 0x8d || w(m, e + 63) !== op || m[e + 65] !== 0x8e) return null;
  if (m[e + 68] !== 0xc6 || m[e + 69] !== c2 || m[e + 70] !== 0xd0 || target(m, e + 70) !== low) return null;
  if (m[e + 72] !== 0xc6 || m[e + 73] !== c1 || m[e + 74] !== 0xd0 || target(m, e + 74) !== value) return null;
  if (m[e + 76] !== 0xc6 || m[e + 77] !== n || m[e + 78] !== 0xd0 || target(m, e + 78) !== group) return null;
  // done: the pointer moves on by what the frame read
  const d = e + 80;
  if (m[d] !== 0x98 || m[d + 1] !== 0x18 || m[d + 2] !== 0x65 || m[d + 3] !== p || m[d + 4] !== 0x85 || m[d + 5] !== p || m[d + 6] !== 0x90 || m[d + 7] !== 0x02 || m[d + 8] !== 0xe6 || m[d + 9] !== p + 1) return null;
  // the explicit group and value
  const xg = target(m, e + 26), xv = target(m, e + 47);
  if (xg + 17 > 0x10000 || !isRead(m, xg, p) || m[xg + 7] !== 0x8d || w(m, xg + 8) !== op + 1 || !isRead(m, xg + 10, p) || m[xg + 17] !== 0x85 || m[xg + 18] !== c1 || m[xg + 19] !== 0x4c || w(m, xg + 20) !== value) return null;
  if (xv + 16 > 0x10000 || !isRead(m, xv, p) || m[xv + 7] !== 0xaa || !isRead(m, xv + 8, p) || m[xv + 15] !== 0x85 || m[xv + 16] !== c2 || m[xv + 17] !== 0x4c || w(m, xv + 18) !== low) return null;
  return { entry: e, ptr: p, groups: w(m, e + 24), pages: w(m, e + 31), counts: w(m, e + 45), values: w(m, e + 52) };
}

/** the players whose code is in `from`-`to` (to exclusive) */
export function findStorePlayers(m: Uint8Array, from: Addr = 0, to: Addr = 0x10000): StorePlayer[] {
  const out: StorePlayer[] = [];
  for (let a = from; a + PLAYER_LEN <= to; a++) if (m[a] === 0xa0 && m[a + 2] === 0xb1) { const p = storePlayerAt(m, a); if (p) out.push(p); }
  return out;
}

/** the starts the code gives the pointer `p`: `lda #<s / sta p / lda #>s / sta p+1` (or the high byte first), where
 *  the code is loaded; each with where its `lda` is */
export function storeStreamStarts(m: Uint8Array, p: number, on: (a: Addr) => boolean): { setter: Addr; start: Addr }[] {
  const out: { setter: Addr; start: Addr }[] = [];
  for (let a = 0; a + 8 <= 0x10000; a++) {
    if (m[a] !== 0xa9 || m[a + 2] !== 0x85 || m[a + 4] !== 0xa9 || m[a + 6] !== 0x85 || !on(a)) continue;
    if (m[a + 3] === p && m[a + 7] === p + 1) out.push({ setter: a, start: m[a + 1] | m[a + 5] << 8 });
    else if (m[a + 3] === p + 1 && m[a + 7] === p) out.push({ setter: a, start: m[a + 5] | m[a + 1] << 8 });
  }
  return out;
}

/** Reads the frames from `start` as the player does, one after another while each is in loaded bytes (and the table
 *  entries it uses are too). The stream ends after the last frame that ends where loaded bytes end (`ends`), so a
 *  stream that runs on into other data is not taken for longer than it is; null: no such frame, or under two. */
export function readStoreStream(m: Uint8Array, pl: StorePlayer, start: Addr, on: (a: Addr) => boolean, ends: (a: Addr) => boolean): Omit<StoreAnim, 'player' | 'setter'> | null {
  const frames: Addr[] = [], pages = new Set<number>();
  let p = start, stores = 0, best: { n: number; end: Addr; stores: number; pages: number[] } | null = null;
  const byte = (a: number) => { if (a > 0xffff || !on(a)) throw 0; return m[a]; };
  while (frames.length < MAX_FRAMES) {
    const f = p, pg = new Set<number>();
    let k = 0;
    try {
      const rd = () => byte(p + k++);
      let s = 0;
      for (let g = rd(); g > 0; g--) {
        const x = rd();
        let c1 = byte(pl.groups + x), page: number;
        if (c1 === 0) { page = rd(); c1 = rd() || 256; } else page = byte(pl.pages + x);
        pg.add(page);
        for (; c1 > 0; c1--) {
          const y = rd();
          let n = byte(pl.counts + y);
          if (n === 0) { rd(); n = rd() || 256; } else byte(pl.values + y);
          for (; n > 0; n--) { rd(); s++; }
        }
      }
      stores += s;
    } catch { break; }
    frames.push(f);
    for (const x of pg) pages.add(x);
    p = f + k;
    if (ends(p)) best = { n: frames.length, end: p, stores, pages: [...pages].sort((a, b) => a - b) };
    if (p > 0xffff) break;
  }
  if (!best || best.n < 2) return null;
  return { start, end: best.end, frames: frames.slice(0, best.n), pages: best.pages, stores: best.stores };
}

/** the pages as address ranges: `$4000-$47ff, $d800-$dbff` */
export function storePagesText(pages: number[]): string {
  const h = (a: number) => `$${a.toString(16).padStart(4, '0')}`;
  const runs: [number, number][] = [];
  for (const x of pages) { const r = runs[runs.length - 1]; if (r && x === r[1] + 1) r[1] = x; else runs.push([x, x]); }
  return runs.map(([a, b]) => `${h(a << 8)}–${h(b << 8 | 0xff)}`).join(', ');
}

export interface SpindleStoreAnim extends StoreAnim {
  /** the job whose code holds the player */
  playerJob: SpindleJob;
  /** the jobs whose chunks hold the stream, in load order, each with the frames that start in it (first, last: 1-based) */
  dataJobs: { job: SpindleJob; first: number; last: number }[];
}

/** The store-stream animations of a Spindle 3 disk's jobs: memory as the jobs leave it, one after another, is searched
 *  for the player in each job's chunks and read from the starts the code gives it, as long as the player's code is
 *  still there; the stream must end where a chunk ends. The longest reading of each player and start is kept. */
export function spindleStoreAnims(d: SpindleDisk): SpindleStoreAnim[] {
  const mem = new Uint8Array(0x10000), owner = new Int16Array(0x10000).fill(-1), ends = new Uint8Array(0x10001);
  const live: { pl: StorePlayer; job: number }[] = [];
  const best = new Map<string, SpindleStoreAnim>();
  const on = (a: Addr) => owner[a] >= 0;
  d.jobs.forEach((j, k) => {
    for (const c of j.chunks) { mem.set(c.bytes.subarray(0, c.end - c.start), c.start); owner.fill(k, c.start, c.end); ends.fill(0, c.start, c.end); ends[c.end] = 1; }
    for (const c of j.chunks) for (const pl of findStorePlayers(mem, c.start, c.end)) if (!live.some(l => l.pl.entry === pl.entry)) live.push({ pl, job: k });
    for (let i = live.length - 1; i >= 0; i--) {
      const { pl, job } = live[i];
      // the player's code overwritten by a later job: it is gone
      let whole = true;
      for (let a = pl.entry; a < pl.entry + PLAYER_LEN; a++) if (owner[a] !== job) { whole = false; break; }
      if (!whole || !storePlayerAt(mem, pl.entry)) { live.splice(i, 1); continue; }
      for (const s of storeStreamStarts(mem, pl.ptr, on)) {
        const r = readStoreStream(mem, pl, s.start, on, a => ends[a] === 1);
        const key = `${pl.entry}:${s.start}`, had = best.get(key);
        if (!r || (had && had.frames.length >= r.frames.length)) continue;
        const data = new Map<number, { job: SpindleJob; first: number; last: number }>();
        r.frames.forEach((f, n) => { const o = owner[f], x = data.get(o); if (x) x.last = n + 1; else data.set(o, { job: d.jobs[o], first: n + 1, last: n + 1 }); });
        // a job that holds stream bytes but no frame's start (the end of a frame running into it)
        for (let a = r.start; a < r.end; a++) if (!data.has(owner[a])) data.set(owner[a], { job: d.jobs[owner[a]], first: 0, last: 0 });
        best.set(key, { ...r, player: pl, setter: s.setter, playerJob: d.jobs[job], dataJobs: [...data.entries()].sort((x, y) => x[0] - y[0]).map(e => e[1]) });
      }
    }
  });
  return [...best.values()].sort((a, b) => a.start - b.start);
}
