/* A writer for disks of the Covert Bitops loader, to test the reader with (c64/covert-disk.ts): the files laid out as
 * Cadaver's own tools lay them out, ported from their C sources (makedisk.c in his c64tools, maked64.c in
 * c64gameframework/tools), and packed in the loader's formats with Brokkr's Exomizer streams and a small Pucrunch writer
 * of our own (the loader's old format: 31 RLE codes, a byte above them in 5 + 3 bits). Nothing of the loader's own code
 * is on the disks unless a test puts bytes of it there. */
import { crunchData } from '@mimir/brokkr';
import { sectorsOnTrack } from '../../src';

export interface FakeCovertFile {
  /** its name on the disk, as the command file has it (_ for a space) */
  name: string;
  /** every byte of it (a PRG: its load address first) */
  data: number[] | Uint8Array;
  /** maked64: its own interleave */
  interleave?: number;
}

export interface FakeCovertDisk {
  tool: 'makedisk' | 'maked64';
  /** the disk name argument: 16 characters of header, two more, the id, one more and the DOS type (_ for a space,
   *  . for a space that is not $a0) */
  name?: string;
  interleave?: number;
  /** maked64: the order to write the files in (their places in `files`); by default theirs */
  order?: number[];
  /** maked64's dir option */
  dir?: boolean;
}

const OFFSETS: number[][] = [];
{
  let e = 0;
  for (let t = 1; t <= 35; t++) { OFFSETS[t] = []; for (let s = 0; s < sectorsOnTrack(t); s++) { OFFSETS[t][s] = e; e += 256; } }
}

/** A 35-track disk with these files, as makedisk or maked64 writes it. */
export function makeCovertDisk(files: FakeCovertFile[], o: FakeCovertDisk): Uint8Array {
  const image = new Uint8Array(174848);
  let buffer = new Uint8Array(256);
  const read = (t: number, s: number) => { buffer = image.slice(OFFSETS[t][s], OFFSETS[t][s] + 256); };
  const write = (t: number, s: number) => image.set(buffer, OFFSETS[t][s]);
  const bam = OFFSETS[18][0];
  const markFree = (t: number, s: number) => { image[bam + 4 * t]++; image[bam + 4 * t + (s >> 3) + 1] |= 1 << (s & 7); };
  const markUsed = (t: number, s: number) => { image[bam + 4 * t]--; image[bam + 4 * t + (s >> 3) + 1] &= 0xff - (1 << (s & 7)); };
  const query = (t: number, s: number) => (image[bam + 4 * t + (s >> 3) + 1] & (1 << (s & 7))) !== 0;
  const n = (t: number) => sectorsOnTrack(t);
  const m64 = o.tool === 'maked64', dir = m64 && !!o.dir, disk = o.interleave ?? 10;

  // the disk name: _ is a space, which (as any space) becomes $a0; a . becomes a space
  const name = [...(o.name ?? '')].map(c => (c === '_' ? ' ' : c));
  buffer = new Uint8Array(256);
  buffer.set([18, 1, 0x41, 0]);
  for (let c = 0; c < 23; c++) { const ch = name[c] ?? ' '; buffer[144 + c] = ch === '.' ? 0x20 : ch !== ' ' ? ch.charCodeAt(0) : 0xa0; }
  for (let c = 23; c < 27; c++) buffer[144 + c] = 0xa0;
  write(18, 0);
  for (let t = 1; t <= 35; t++) for (let s = 0; s < n(t); s++) markFree(t, s);
  markUsed(18, 0);
  read(18, 1); buffer[0] = 0; buffer[1] = 0xff; markUsed(18, 1); write(18, 1);
  if (dir) for (let c = 2; c < Math.floor((files.length + 7) / 8) + 1; c++) markUsed(18, c);

  const firstFree = (il: number): [number, number] => {
    const scan = (t: number): [number, number] | null => {
      for (let c = 0, s = 0; c < n(t); c++) { if (query(t, s)) return [t, s]; s = il > 10 ? (s + n(t) - 1) % n(t) : (s + 1) % n(t); }
      return null;
    };
    const up = (from: number) => { for (let t = from; t <= 35; t++) { if (t === 18 && !dir) continue; const f = scan(t); if (f) return f; } return null; };
    const down = (from: number) => { for (let t = from; t >= 1; t--) { const f = scan(t); if (f) return f; } return null; };
    const f = m64 ? up(1) : il > 10 ? up(19) ?? down(17) : down(17) ?? up(19);
    if (!f) throw new Error('disk full');
    return f;
  };
  const nextFree = (track: number, sector: number, il: number): [number, number] => {
    sector += il;
    if (sector >= n(track)) sector %= n(track);
    if (query(track, sector)) return [track, sector];
    for (let c = 0; c < n(track); c++) {
      sector = il > 10 ? (sector + n(track) - 1) % n(track) : (sector + 1) % n(track);
      if (query(track, sector)) return [track, sector];
    }
    const any = (t: number): [number, number] | null => { for (let s = 0; s < n(t); s++) if (query(t, s)) return [t, s]; return null; };
    if (m64) { for (let t = track; t <= 35; t++) { if (t === 18 && !dir) continue; const f = any(t); if (f) return f; } }
    else if (track < 18) { for (let t = track; t >= 1; t--) { const f = any(t); if (f) return f; } for (let t = 19; t <= 35; t++) { const f = any(t); if (f) return f; } }
    else { for (let t = track; t <= 35; t++) { const f = any(t); if (f) return f; } for (let t = 17; t >= 1; t--) { const f = any(t); if (f) return f; } }
    throw new Error('disk full');
  };
  const where: { t: number; s: number; blocks: number }[] = [];
  const writeFile = (i: number) => {
    const data = Uint8Array.from(files[i].data), il = (m64 && files[i].interleave) || disk;
    let [track, sector] = firstFree(il);
    const start = { t: track, s: sector, blocks: 0 };
    let last: [number, number] | null = null;
    for (let at = 0; ; ) {
      buffer = new Uint8Array(256);
      const chunk = data.subarray(at, at + 254);
      at += chunk.length;
      buffer.set(chunk, 2);
      if (!chunk.length) {
        if (last) { read(...last); buffer[0] = 0; buffer[1] = 255; write(...last); } else { markUsed(track, sector); start.blocks++; }
        break;
      }
      if (chunk.length < 254) { buffer[0] = 0; buffer[1] = chunk.length + 1; write(track, sector); markUsed(track, sector); start.blocks++; break; }
      write(track, sector); markUsed(track, sector); start.blocks++;
      last = [track, sector];
      [track, sector] = nextFree(track, sector, il);
      read(...last); buffer[0] = track; buffer[1] = sector; write(...last);
    }
    where[i] = start;
  };
  const dirEntry = (i: number) => {
    let t = 18, s = 1;
    for (;;) {
      read(t, s);
      for (let c = 2; c < 256; c += 32) {
        if (buffer[c]) continue;
        const nm = files[i].name;
        for (let d = 0; d < 16; d++) { const ch = d < nm.length ? nm.charCodeAt(d) : 0xa0; buffer[c + d + 3] = ch === 0x5f ? 0x20 : ch; }
        buffer[c] = 0x82; buffer[c + 1] = where[i].t; buffer[c + 2] = where[i].s;
        buffer[c + 28] = where[i].blocks & 0xff; buffer[c + 29] = where[i].blocks >> 8;
        write(t, s);
        return;
      }
      if (buffer[0]) { [t, s] = [buffer[0], buffer[1]]; continue; }
      buffer[0] = t; buffer[1] = s + 1; write(t, s);
      s++;
      read(t, s); buffer[0] = 0; buffer[1] = 0xff; markUsed(t, s); write(t, s);
    }
  };
  if (m64) {
    for (const i of o.order ?? files.map((_, k) => k)) writeFile(i);
    if (dir) for (let c = 2; c < Math.floor((files.length + 7) / 8) + 1; c++) markFree(18, c);
    files.forEach((_, i) => dirEntry(i));
  } else files.forEach((_, i) => { writeFile(i); dirEntry(i); });
  return image;
}

/** `exomizer level` as the loader of version 2 reads it: where it ends (high byte first), then the stream of the data
 *  backwards (Exomizer 2: protocol 0; Exomizer 3: 7); forward: where it starts, the stream of the data forwards. */
export function exoLevel(data: number[], start: number, o: { exo3?: boolean; forward?: boolean } = {}): number[] {
  const flags = o.exo3 ? 7 : 0, d = Uint8Array.from(o.forward ? data : [...data].reverse());
  const addr = o.forward ? start : start + data.length;
  return [(addr >> 8) & 0xff, addr & 0xff, ...crunchData(d, { protocol: { flags }, effort: 'fast' }).stream];
}

/** `exomizer3 raw -P-32`: the stream alone, forwards (protocol 7). */
export const exo3Raw = (data: number[]): number[] => [...crunchData(Uint8Array.from(data), { protocol: { flags: 7 }, effort: 'fast' }).stream];

/** A Pucrunch writer for `pucrunch -c0` in the old format the loader reads: escaped literals (2 escape bits), copies
 *  of 2 bytes and more, runs of one byte (from the RLE table, or 5 bits and 3), the end. */
export function pucrunch(data: number[], start: number, load: number): number[] {
  const escBits = 2, maxGamma = 7, rle = [0x00, 0xff, 0x20];
  const bits: number[] = [];
  const put = (v: number, n: number) => { for (let i = n - 1; i >= 0; i--) bits.push((v >> i) & 1); };
  const value = (v: number) => { const i = 31 - Math.clz32(v); for (let k = 0; k < i; k++) bits.push(1); if (i < maxGamma) bits.push(0); put(v & ((1 << i) - 1), i); };
  let escape = 0;
  const literal = (b: number) => {
    if (b >> (8 - escBits) !== escape) { put(b >> (8 - escBits), escBits); put(b, 8 - escBits); return; }
    // a byte whose top bits are the escape: escaped, with a new escape (the next byte's top bits, or any other)
    put(escape, escBits); value(1); put(1, 1); put(0, 1);
    const next = (escape + 1) & 3;
    put(next, escBits); put(b, 8 - escBits); escape = next;
  };
  for (let i = 0; i < data.length;) {
    // a run of one byte, 3 or more
    let run = 1;
    while (i + run < data.length && data[i + run] === data[i] && run < 64) run++;
    if (run >= 3) {
      put(escape, escBits); value(1); put(1, 1); put(1, 1);
      value(run - 1);
      const code = rle.indexOf(data[i]);
      if (code >= 0) value(code + 1); else { value(32 + (data[i] >> 3)); put(data[i] & 7, 3); }
      i += run;
      continue;
    }
    // a copy from up to 4 KB back, 2 bytes or more
    let len = 0, off = 0;
    for (let o = 1; o <= Math.min(i, 4096); o++) {
      let k = 0;
      while (i + k < data.length && data[i + k] === data[i + k - o] && k < 255) k++;
      if (k > len) { len = k; off = o; }
    }
    if (len >= 3 || (len === 2 && off <= 256)) {
      const pos = off - 1;
      put(escape, escBits);
      if (len === 2) { value(1); put(0, 1); put(pos ^ 0xff, 8); } else { value(len - 1); value((pos >> 8) + 1); put((pos & 0xff) ^ 0xff, 8); }
      i += len;
      continue;
    }
    literal(data[i++]);
  }
  put(escape, escBits); value(2); value((2 << maxGamma) - 1);
  while (bits.length % 8) bits.push(0);
  const stream: number[] = [];
  for (let i = 0; i < bits.length; i += 8) stream.push(bits.slice(i, i + 8).reduce((v, b) => (v << 1) | b, 0));
  const end = start + data.length + 0x100;
  return [load & 0xff, load >> 8, 0x70, 0x75, end & 0xff, (end >> 8) & 0xff, 0, start & 0xff, start >> 8, escBits, maxGamma + 1, 1 << maxGamma, 0, 0xff, 0xff, rle.length, ...rle, ...stream];
}
