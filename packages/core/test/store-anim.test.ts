/* Store-stream animations (core store-anim): a player of the shape Bliss Machine's lightning has, written here with
 * addresses and tables of its own, and a stream made for it, on a Spindle disk of three jobs. */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findStorePlayers, readSpindleDisk, readStoreStream, spindleStoreAnims, storePagesText, storePlayerAt, type SpindleDisk, type SpindleJob } from '../src';
import { makeSpindleDisk } from './helpers/spindle-disk';

const E = 0x2000, P = 0xfb, N = 0x02, C1 = 0x03, C2 = 0x04, GROUPS = 0x3000, PAGES = 0x3100, COUNTS = 0x3200, VALUES = 0x3300;
const lo = (a: number) => a & 0xff, hi = (a: number) => a >> 8;
const read = [0xb1, P, 0xc8, 0xd0, 0x02, 0xe6, P + 1];

/** the player at E (ldy #0 … rts), then its explicit group and value */
function player(): number[] {
  const op = E + 66, value = E + 36, low = E + 55;
  const b = [
    0xa0, 0x00, ...read, 0x85, N, 0xc9, 0x00, 0xf0, 0x41,
    ...read, 0xaa, 0xbd, lo(GROUPS), hi(GROUPS), 0xf0, 0x3f, 0x85, C1, 0xbd, lo(PAGES), hi(PAGES), 0x8d, lo(op + 1), hi(op + 1),
    ...read, 0xaa, 0xbd, lo(COUNTS), hi(COUNTS), 0xf0, 0x40, 0x85, C2, 0xbd, lo(VALUES), hi(VALUES), 0xaa,
    ...read, 0x8d, lo(op), hi(op), 0x8e, 0x00, 0xff,
    0xc6, C2, 0xd0, 0xef, 0xc6, C1, 0xd0, 0xd8, 0xc6, N, 0xd0, 0xbf,
    0x98, 0x18, 0x65, P, 0x85, P, 0x90, 0x02, 0xe6, P + 1, 0x60,
    // the explicit group: page, count
    ...read, 0x8d, lo(op + 1), hi(op + 1), ...read, 0x85, C1, 0x4c, lo(value), hi(value),
    // the explicit value: value, count
    ...read, 0xaa, ...read, 0x85, C2, 0x4c, lo(low), hi(low),
  ];
  expect(b.length).toBe(91 + 22 + 20);
  return b;
}

/** the tables: index 1 is a group of one value in page $04, and two stores of $0e; index 0 says explicit */
function tables(): Uint8Array {
  const t = new Uint8Array(0x400);
  t[0x001] = 1; t[0x101] = 0x04; t[0x201] = 2; t[0x301] = 0x0e;
  return t;
}

type Store = [addr: number, value: number];
/** a frame's stores as the player reads them: groups by page, values in each, low bytes */
function encode(frame: Store[]): number[] {
  const pages = new Map<number, Map<number, number[]>>();
  for (const [a, v] of frame) {
    const m = pages.get(hi(a)) ?? new Map<number, number[]>(); pages.set(hi(a), m);
    m.set(v, [...(m.get(v) ?? []), lo(a)]);
  }
  const out = [pages.size];
  for (const [page, values] of pages) {
    out.push(...(page === 0x04 && values.size === 1 ? [1] : [0, page, values.size]));
    for (const [v, lows] of values) out.push(...(v === 0x0e && lows.length === 2 ? [1] : [0, v, lows.length]), ...lows);
  }
  return out;
}

/** frames of stores into the screen at $0400 and colour RAM, from a fixed seed */
function frames(n: number): Store[][] {
  let s = 12345;
  const rnd = (m: number) => { s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff; return (s >> 8) % m; };
  const out: Store[][] = [];
  for (let f = 0; f < n; f++) {
    const fr: Store[] = [];
    if (f % 5 === 0) fr.push([0x0400 + rnd(250), 0x0e], [0x0400 + 250 + rnd(5), 0x0e]);
    for (let k = rnd(12); k > 0; k--) fr.push([(rnd(2) ? 0x0400 : 0xd800) + rnd(1000), rnd(256)]);
    out.push(f === 7 ? [] : fr);
  }
  return out;
}

const job = (n: number, chunks: [number, number[] | Uint8Array][]): SpindleJob =>
  ({ n, labels: [], track: 1, sector: 0, chunks: chunks.map(([start, b]) => ({ start, end: start + b.length, bytes: Uint8Array.from(b) })), jump: null, shadow: false, missing: 0 });
/** a disk whose job 1 holds the player, its tables and the code that points it at $5000, and jobs 2 and 3 the stream */
const setter = [0xa9, 0x00, 0x85, P, 0xa9, 0x50, 0x85, P + 1, 0x20, lo(E), hi(E), 0x60];
function disk(stream: number[], cut: number, extra: SpindleJob[] = []): SpindleDisk {
  return {
    jobs: [job(1, [[E, player()], [0x2100, setter], [GROUPS, tables()]]), ...extra, job(2, [[0x5000, stream.slice(0, cut)]]), job(3, [[0x5000 + cut, stream.slice(cut)]])],
    start: null, resident: 0, knock: null, next: null,
  } as unknown as SpindleDisk;
}

describe('store-stream animations', () => {
  const fs = frames(60), bytes = fs.flatMap(encode), stores = fs.reduce((n, f) => n + f.length, 0);
  // where job 2 ends and job 3 begins: inside a frame (a frame that ended there would end a shorter stream too)
  const ends = fs.map(encode).reduce((a, f) => [...a, a[a.length - 1] + f.length], [0]);
  const cut = ends.find(e => e > 300)! - 1;

  it('finds the player by its code, with its pointer and tables', () => {
    const m = new Uint8Array(0x10000);
    m.set(player(), E);
    expect(findStorePlayers(m)).toEqual([{ entry: E, ptr: P, groups: GROUPS, pages: PAGES, counts: COUNTS, values: VALUES }]);
    // a store that is not into its own operand is another loop
    const b = player(); b[63] = 0x00; m.set(b, E);
    expect(storePlayerAt(m, E)).toBeNull();
  });

  it('reads the frames as the player does, to where the bytes end', () => {
    const m = new Uint8Array(0x10000), on = new Uint8Array(0x10000);
    m.set(player(), E); m.set(tables(), GROUPS); on.fill(1, GROUPS, GROUPS + 0x400);
    m.set(bytes, 0x5000); on.fill(1, 0x5000, 0x5000 + bytes.length);
    const r = readStoreStream(m, storePlayerAt(m, E)!, 0x5000, a => on[a] === 1, a => a === 0x5000 + bytes.length)!;
    expect(r.frames.length).toBe(60);
    expect(r.end).toBe(0x5000 + bytes.length);
    expect(r.stores).toBe(stores);
    expect(storePagesText(r.pages)).toBe('$0400–$07ff, $d800–$dbff');
  });

  it('finds the animation on a disk: the player in job 1, the stream in jobs 2 and 3', () => {
    const r = spindleStoreAnims(disk(bytes, cut));
    expect(r).toHaveLength(1);
    const a = r[0];
    expect(a.playerJob.n).toBe(1);
    expect([a.start, a.end, a.setter, a.frames.length]).toEqual([0x5000, 0x5000 + bytes.length, 0x2100, 60]);
    // the frames that start in each job
    const inJob2 = a.frames.filter(f => f < 0x5000 + cut).length;
    expect(a.dataJobs.map(d => [d.job.n, d.first, d.last])).toEqual([[2, 1, inJob2], [3, inJob2 + 1, 60]]);
  });

  it('takes no stream that does not end where its bytes end, nor one frame', () => {
    // two bytes more after the last frame (a frame cut short): the stream ends nowhere
    expect(spindleStoreAnims(disk([...bytes, 3, 0], cut))).toEqual([]);
    expect(spindleStoreAnims(disk(encode(fs[0]), 2))).toEqual([]);
  });

  it('is fixtures/d64/store-anim.d64, which the e2e tests mount: job 1 the player, jobs 2 and 3 the stream', () => {
    const d = makeSpindleDisk([
      { chunks: [{ start: E, bytes: player() }, { start: 0x2100, bytes: setter }, { start: GROUPS, bytes: [...tables()] }] },
      { chunks: [{ start: 0x5000, bytes: bytes.slice(0, cut) }] },
      { chunks: [{ start: 0x5000 + cut, bytes: bytes.slice(cut) }] },
    ]);
    const path = join(__dirname, '../../../fixtures/d64/store-anim.d64');
    if (process.env.WRITE_FIXTURES) writeFileSync(path, d);
    expect(new Uint8Array(readFileSync(path))).toEqual(d);
    const [a, ...more] = spindleStoreAnims(readSpindleDisk(d)!);
    expect(more).toEqual([]);
    expect([a.playerJob.n, a.start, a.end, a.frames.length]).toEqual([1, 0x5000, 0x5000 + bytes.length, 60]);
    expect(a.dataJobs.map(x => x.job.n)).toEqual([2, 3]);
  });

  it('forgets a player a later job loads over', () => {
    const over = job(9, [[E + 40, [0xea, 0xea]]]);
    expect(spindleStoreAnims(disk(bytes, cut, [over]))).toEqual([]);
  });
});
