/* A writer for tapes in TapeTool's turbo format, to test the tape reader with (c64/tap.ts) and to make
 * fixtures/tap/mimir-demo.tap: TapeTool's leader ($ff $c3), sync byte, full headers and TinyHeader, blocks of a page,
 * RLE packed blocks and the leader pairs TapeTool writes around them itself, as Martin Piper's TapeTool.exe writes them
 * (measured on its output); and the formats of Turbo Tape 64, Freeload and US Gold's loader. The boot file's loader is a
 * small one of our own (it reads the TinyHeader file and starts it): nothing of TapeTool's own code is on the tapes. */
import { assemble, makeTap, tapPulses } from '../../src';

/** turbo pulses in TAP units: a 0 and a 1 (TapeTool's default TapeTurboSpeed $80: 256 and 512 cycles) */
export class TurboWriter {
  readonly pulses: number[] = [];
  constructor(readonly zero = 0x20, readonly one = 0x40) {}
  bit(b: number): void { this.pulses.push(b ? this.one : this.zero); }
  byte(v: number): void { for (let i = 7; i >= 0; i--) this.bit((v >> i) & 1); }
  bytes(bs: ArrayLike<number>): void { for (let i = 0; i < bs.length; i++) this.byte(bs[i]); }
  /** TapeTool's leader: `n` pairs of $ff $c3 */
  leader(n: number): void { for (let i = 0; i < n; i++) { this.byte(0xff); this.byte(0xc3); } }
}

/** TapeTool's RLE: an escape byte no byte of the block has (else the rarest, then written as a run of 1), runs of 4 or
 *  more as escape, count, value, and the escape at the end. Null when it does not make the block shorter. */
export function rle(data: Uint8Array): Uint8Array | null {
  const count = new Array(256).fill(0);
  for (const v of data) count[v]++;
  const esc = count.indexOf(Math.min(...count));
  const out = [esc];
  for (let i = 0; i < data.length;) {
    let n = 1;
    while (i + n < data.length && data[i + n] === data[i] && n < 255) n++;
    if (n >= 4 || data[i] === esc) { out.push(esc, n, data[i]); i += n; } else { out.push(data[i]); i++; }
  }
  out.push(esc);
  return out.length < data.length && out.length <= 255 ? Uint8Array.from(out) : null;
}

/** A TinyHeader file (`otft`): its own 4 leader pairs, sync, $69, the data, their XOR; 2 pairs after it. */
export function tinyFile(w: TurboWriter, data: Uint8Array): void {
  w.leader(4);
  w.bytes([0xaa, 0x69]);
  w.bytes(data);
  w.byte(data.reduce((a, v) => a ^ v, 0));
  w.leader(2);
}

/** A file in checksum blocks (`otfb`, `otfbr` with `packed`): a block a page, in `order` (indexes into the pages,
 *  default memory order), each with 2 leader pairs before it and 2 after (8 after an RLE packed one). */
export function blockFile(w: TurboWriter, id: number, load: number, data: Uint8Array, o: { packed?: boolean; order?: number[] } = {}): void {
  const blocks: { start: number; bytes: Uint8Array }[] = [];
  for (let a = load; a < load + data.length;) {
    const end = Math.min(load + data.length, (a & 0xff00) + 0x100);
    blocks.push({ start: a, bytes: data.subarray(a - load, end - load) });
    a = end;
  }
  for (const k of o.order ?? blocks.map((_, i) => i)) {
    const b = blocks[k], packed = o.packed ? rle(b.bytes) : null, end = b.start + b.bytes.length;
    const head = [0xaa, 0xf0, packed ? 0xb7 : 0x96, id, b.start & 0xff, b.start >> 8, blocks.length, packed ? packed.length : end & 0xff, packed ? b.bytes.length - 1 : end >> 8];
    w.leader(2);
    w.bytes(head);
    w.byte(head.reduce((a, v) => a ^ v, 0));
    const body = packed ?? b.bytes;
    w.bytes(body);
    w.byte(body.reduce((a, v) => a ^ v, 0));
    w.leader(packed ? 8 : 2);
  }
}

/** Turbo Tape 64: a 0 of 208 cycles and a 1 of 320, a leader of $02, sync $09 … $01; a header (1, start, end, 0, the
 *  name) and a data block (0, the bytes, their XOR). */
export function turboTapeFile(w: TurboWriter, name: string, load: number, data: Uint8Array): void {
  const block = (bytes: number[]) => {
    for (let i = 0; i < 64; i++) w.byte(2);
    for (let v = 9; v >= 1; v--) w.byte(v);
    w.bytes(bytes);
    for (let i = 0; i < 16; i++) w.byte(0);
  };
  const end = load + data.length;
  const head = [1, load & 0xff, load >> 8, end & 0xff, end >> 8, 0, ...Array.from({ length: 16 }, (_, i) => (i < name.length ? name.toUpperCase().charCodeAt(i) : 0x20))];
  for (let i = head.length; i < 192; i++) head.push(0x20);
  block(head);
  block([0, ...data, data.reduce((a, v) => a ^ v, 0)]);
}

/** Freeload's format (pilot $40, sync $5a) and US Gold's (pilot $20, sync $ff, a 16-byte name): the pilot, the sync,
 *  [the name,] start, end, the data and their XOR (`sum` instead when given, none when null), the top bit first, as
 *  their loaders read them. */
export function pilotFile(w: TurboWriter, o: { pilot: number; sync: number; name?: string; load: number; data: Uint8Array; sum?: number | null; pilots?: number; trail?: number }): void {
  for (let i = 0; i < (o.pilots ?? 64); i++) w.byte(o.pilot);
  w.byte(o.sync);
  if (o.name != null) w.bytes(Array.from({ length: 16 }, (_, i) => (i < o.name!.length ? o.name!.toUpperCase().charCodeAt(i) : 0x20)));
  const end = o.load + o.data.length;
  w.bytes([o.load & 0xff, o.load >> 8, end & 0xff, end >> 8]);
  w.bytes(o.data);
  if (o.sum !== null) w.byte(o.sum ?? o.data.reduce((a, v) => a ^ v, 0));
  for (let i = 0; i < (o.trail ?? 16); i++) w.byte(0);
}

/** A Mega-Save file: $20 bytes before the pilot, a pilot of $63, the sync bytes $64 … $ff, a byte that is not 0, the
 *  header (start, end, where the loader starts the program, the flags to load the next file and to jump there, two
 *  more bytes), the data and their XOR (`sum` instead when given). */
export function megaSaveFile(w: TurboWriter, o: { load: number; data: Uint8Array; run?: number; next?: boolean; pilot?: number; sum?: number }): void {
  for (let i = 0; i < 16; i++) w.byte(0x20);
  for (let i = 0; i < (o.pilot ?? 300); i++) w.byte(0x63);
  for (let v = 0x64; v <= 0xff; v++) w.byte(v);
  w.byte(0x01);
  const end = (o.load + o.data.length) & 0xffff, run = o.run ?? 0;
  w.bytes([o.load & 0xff, o.load >> 8, end & 0xff, end >> 8, run & 0xff, run >> 8, o.next ? 1 : 0, o.next || !o.run ? 0 : 1, 0xca, 0]);
  w.bytes(o.data);
  w.byte(o.sum ?? o.data.reduce((a, v) => a ^ v, 0));
  for (let i = 0; i < 16; i++) w.byte(0);
}

/** fixtures/tap/megasave-demo.tap: a KERNAL boot file "MEGA DEMO" (bytes of our own in its header, no loader), then
 *  two Mega-Save files at Tazz's speed: a table at $c000 (the loader goes on) and `demo` (a PRG), which it RUNs. */
export function megaSaveDemoTape(demo: Uint8Array): Uint8Array {
  const kernal = makeTap({ files: [{ name: 'MEGA DEMO', load: 0x02a7, data: Uint8Array.from({ length: 93 }, (_, i) => (i * 11 + 3) & 0xff), header: Uint8Array.from({ length: 171 }, (_, i) => (i * 13 + 5) & 0xff) }] });
  const w = new TurboWriter(54, 71);
  megaSaveFile(w, { load: 0xc000, data: Uint8Array.from({ length: 600 }, (_, i) => (i * 7) & 0xff), next: true });
  megaSaveFile(w, { load: demo[0] | (demo[1] << 8), data: demo.subarray(2) });
  return withTurbo(kernal, w.pulses);
}

/** Novaload's bits: the lowest first; its pilot of 0 bits (its tapes have about 2 060), a 1 and the sync byte $aa. */
function novaByte(w: TurboWriter, v: number): void { for (let i = 0; i < 8; i++) w.bit((v >> i) & 1); }
function novaSync(w: TurboWriter, pilot: number): void { for (let i = 0; i < pilot; i++) w.bit(0); w.bit(1); novaByte(w, 0xaa); }

/** A Novaload file (what its LOAD reads): the name's length, the name, its start less 256, its end, the bytes in its last
 *  block and its blocks plus one, their sum; then its blocks, 256 bytes each but the last, each followed by the sum of all
 *  the bytes after the sync byte (the sums too). `bad` spoils the sum after that block. */
export function novaFile(w: TurboWriter, o: { name?: string; load: number; data: Uint8Array; pilot?: number; bad?: number }): void {
  novaSync(w, o.pilot ?? 2064);
  const name = [...(o.name ?? '')].map(c => c.toUpperCase().charCodeAt(0));
  const start = (o.load - 0x100) & 0xffff, end = (o.load + o.data.length) & 0xffff;
  const head = [name.length, ...name, start & 0xff, start >> 8, end & 0xff, end >> 8, o.data.length & 0xff, (o.data.length >> 8) + 1];
  let sum = 0;
  for (const v of head) { novaByte(w, v); sum = (sum + v) & 0xff; }
  novaByte(w, sum);
  sum = (sum * 2) & 0xff;
  for (let b = 0, at = 0; at < o.data.length; b++) {
    const size = Math.min(256, o.data.length - at);
    for (let i = 0; i < size; i++) { novaByte(w, o.data[at + i]); sum = (sum + o.data[at + i]) & 0xff; }
    at += size;
    const ck = b === o.bad ? sum ^ 0x5a : sum;
    novaByte(w, ck);
    sum = (sum + ck) & 0xff;
  }
  for (let i = 0; i < 64; i++) w.bit(0);
}

/** What the loader in a Novaload boot file's header reads: $55, then each page (its number, its 256 bytes, their sum
 *  with the number), up to a page 0. `bad` spoils that page's sum. */
export function novaPages(w: TurboWriter, pages: { page: number; data: Uint8Array }[], o: { pilot?: number; bad?: number } = {}): void {
  novaSync(w, o.pilot ?? 2064);
  novaByte(w, 0x55);
  pages.forEach((p, k) => {
    novaByte(w, p.page);
    let sum = p.page;
    for (const v of p.data) { novaByte(w, v); sum = (sum + v) & 0xff; }
    novaByte(w, k === o.bad ? sum ^ 0x5a : sum);
  });
  novaByte(w, 0);
  for (let i = 0; i < 64; i++) w.bit(0);
}

/** fixtures/tap/novaload-demo.tap: a KERNAL boot file "NOVA DEMO" (bytes of our own in its header, no loader), then what
 *  a Novaload boot's loader reads (a table at $c000-$c1ff, a page at $e000), and `demo` (a PRG) as the file "DEMO", at
 *  Paperboy's speed (a 0 of 296 cycles, a 1 of 696). */
export function novaloadDemoTape(demo: Uint8Array): Uint8Array {
  const kernal = makeTap({ files: [{ name: 'NOVA DEMO', load: 0x0801, basic: true, data: Uint8Array.from({ length: 176 }, (_, i) => (i * 11 + 3) & 0xff), header: Uint8Array.from({ length: 171 }, (_, i) => (i * 13 + 5) & 0xff) }] });
  const w = new TurboWriter(37, 87);
  const page = (n: number) => Uint8Array.from({ length: 256 }, (_, i) => (i * 7 + n) & 0xff);
  novaPages(w, [{ page: 0xc0, data: page(0) }, { page: 0xc1, data: page(1) }, { page: 0xe0, data: page(2) }]);
  novaFile(w, { name: 'DEMO', load: demo[0] | (demo[1] << 8), data: demo.subarray(2) });
  return withTurbo(kernal, w.pulses);
}

/** A pause in the tape (the tape stops between Firebird's blocks): a pulse of 20 000 cycles. */
export const firebirdPause = (w: TurboWriter) => { w.pulses.push(0, 0x20, 0x4e, 0); };

/** Firebird's first stage: a chain of blocks, the top bit first, each the pilot byte 10 times, its complement and the
 *  pilot, then the next block's pilot (the first block's pilot is $0f, the others `pilot`), the block's number, its
 *  address, its bytes (the first block's 64, the others 256), a count and that many bytes the loader skips, the XOR of
 *  the bytes, and where the loader jumps after it (`loop` back into itself; the last block's `jump`). `bad` spoils that
 *  block's sum, `sums` puts in sums of its own; a pause after each block when given. */
export function firebirdChain(w: TurboWriter, blocks: { load: number; data: Uint8Array }[], o: { pilot: number; loop: number; jump: number; bad?: number; sums?: Record<number, number>; pause?: (w: TurboWriter) => void }): void {
  blocks.forEach((b, n) => {
    const p = n ? o.pilot : 0x0f, data = b.data.subarray(0, n ? 0x100 : 0x40);
    for (let i = 0; i < 10; i++) w.byte(p);
    w.bytes([p ^ 0xff, p, o.pilot, n, b.load & 0xff, b.load >> 8]);
    w.bytes(Uint8Array.from({ length: n ? 0x100 : 0x40 }, (_, i) => data[i] ?? 0));
    const skip = (n * 7 + 3) & 0x1f;
    w.byte(skip);
    for (let i = 0; i < (skip || 256); i++) w.byte((i * 37 + n) & 0xff);
    const x = data.reduce((a, v) => a ^ v, 0);
    w.byte(o.sums?.[n] ?? (n === o.bad ? x ^ 0x5a : x));
    const jump = n === blocks.length - 1 ? o.jump : o.loop;
    w.bytes([jump & 0xff, jump >> 8]);
    o.pause?.(w);
  });
}

/** A file of the second kind of Firebird's blocks (what a loader the program loads reads): a block a page, each the
 *  pilot byte 10 times, its complement and the pilot, then its number, its address, 0, the page the file ends before,
 *  where the loader jumps after the file (0: it returns), the 256 bytes and their XOR. `bad` spoils that block's sum,
 *  `skip` leaves those blocks out. */
export function firebirdFile(w: TurboWriter, o: { pilot: number; load: number; data: Uint8Array; jump?: number; bad?: number; skip?: number[] }): void {
  const pages = Math.ceil(o.data.length / 256), end = ((o.load >> 8) + pages) & 0xff, jump = o.jump ?? 0;
  for (let n = 0; n < pages; n++) {
    if (o.skip?.includes(n)) continue;
    const block = Uint8Array.from({ length: 256 }, (_, i) => o.data[n * 256 + i] ?? 0), load = o.load + n * 256;
    for (let i = 0; i < 10; i++) w.byte(o.pilot);
    w.bytes([o.pilot ^ 0xff, o.pilot, n, load & 0xff, load >> 8, 0, end, jump & 0xff, jump >> 8]);
    w.bytes(block);
    const x = block.reduce((a, v) => a ^ v, 0);
    w.byte(n === o.bad ? x ^ 0x5a : x);
  }
  for (let i = 0; i < 16; i++) w.byte(0);
}

/** fixtures/tap/firebird-demo.tap: a KERNAL boot file "FIREBIRD DEMO" (bytes of our own, no loader), then Firebird's
 *  first stage at Bubble Bobble's speed (a 0 of 384 cycles, a 1 of 720): 64 bytes at $0200, `demo` (a PRG) in blocks
 *  from its load address, a last block at $bf00 the loader jumps to, each block after a pause; then a table at
 *  $c000-$c1ff as a file of the second kind (pilot $34, the loader returns after it). */
export function firebirdDemoTape(demo: Uint8Array): Uint8Array {
  const kernal = makeTap({ files: [{ name: 'FIREBIRD DEMO', load: 0x02a7, data: Uint8Array.from({ length: 93 }, (_, i) => (i * 11 + 3) & 0xff), header: Uint8Array.from({ length: 171 }, (_, i) => (i * 13 + 5) & 0xff) }] });
  const w = new TurboWriter(48, 90);
  const load = demo[0] | (demo[1] << 8), data = demo.subarray(2);
  const blocks: { load: number; data: Uint8Array }[] = [{ load: 0x0200, data: Uint8Array.from({ length: 64 }, (_, i) => (i * 3 + 1) & 0xff) }];
  for (let o = 0; o < data.length; o += 256) blocks.push({ load: load + o, data: data.subarray(o, o + 256) });
  blocks.push({ load: 0xbf00, data: Uint8Array.from({ length: 256 }, (_, i) => (i * 5 + 2) & 0xff) });
  firebirdPause(w);
  firebirdChain(w, blocks, { pilot: 0x7e, loop: 0x1c41, jump: 0xbf00, pause: firebirdPause });
  firebirdFile(w, { pilot: 0x34, load: 0xc000, data: Uint8Array.from({ length: 512 }, (_, i) => (i * 7) & 0xff) });
  return withTurbo(kernal, w.pulses);
}

/** A Wildload chain, the lowest bit first: a pilot of $a0 (its tapes have 256), the sync bytes $0a … $01, then each
 *  block's header (the address of its last byte, how many bytes it has, its flag: 1 unless given), its bytes from the
 *  last one down, each XOR the low byte of its address, and the XOR of the bytes; then the header that ends the chain
 *  (`end`: $fe, the loader stops; $ff, it looks for the next pilot) and 7 pulses, as on the tapes. `bad` spoils that
 *  block's sum, `cut` stops the tape after that many of the last block's bytes. */
export function wildChain(w: TurboWriter, blocks: { load: number; data: Uint8Array; flag?: number }[], o: { end?: number; pilot?: number; bad?: number; cut?: number } = {}): void {
  for (let i = 0; i < (o.pilot ?? 256); i++) novaByte(w, 0xa0);
  for (let s = 0x0a; s >= 1; s--) novaByte(w, s);
  for (const [n, b] of blocks.entries()) {
    const top = b.load + b.data.length - 1;
    for (const v of [top & 0xff, top >> 8, b.data.length & 0xff, b.data.length >> 8, b.flag ?? 1]) novaByte(w, v);
    let x = 0;
    for (let i = b.data.length - 1; i >= 0; i--) {
      if (o.cut !== undefined && n === blocks.length - 1 && b.data.length - 1 - i === o.cut) return;
      novaByte(w, b.data[i] ^ ((b.load + i) & 0xff));
      x ^= b.data[i];
    }
    novaByte(w, n === o.bad ? x ^ 0x5a : x);
  }
  for (const v of [0, 0, 0, 0, o.end ?? 0xfe]) novaByte(w, v);
  for (let i = 0; i < 7; i++) w.bit(0);
}

/** fixtures/tap/wildload-demo.tap: a KERNAL boot file "WILD DEMO" (bytes of our own, no loader), then a Wildload chain
 *  at Delta's speed (a 0 of 384 cycles, a 1 of 568) as Delta's starts: 192 bytes into the tape buffer, a byte for the
 *  VIC's $d011 (the I/O in), 512 bytes under the I/O at $d800 (flag 0), `demo` (a PRG) from its load address, ending
 *  with $ff; after a pause a second chain with a table at $c000 that ends the loading ($fe). */
export function wildloadDemoTape(demo: Uint8Array): Uint8Array {
  const kernal = makeTap({ files: [{ name: 'WILD DEMO', load: 0x029f, data: Uint8Array.from({ length: 97 }, (_, i) => (i * 11 + 3) & 0xff), header: Uint8Array.from({ length: 171 }, (_, i) => (i * 13 + 5) & 0xff) }] });
  const w = new TurboWriter(48, 71);
  const load = demo[0] | (demo[1] << 8);
  wildChain(w, [
    { load: 0x033c, data: Uint8Array.from({ length: 192 }, (_, i) => (i * 3 + 1) & 0xff) },
    { load: 0xd011, data: Uint8Array.of(0x0b) },
    { load: 0xd800, data: Uint8Array.from({ length: 512 }, (_, i) => (i * 5 + 2) & 0xff), flag: 0 },
    { load, data: demo.subarray(2) },
  ], { end: 0xff });
  firebirdPause(w);
  wildChain(w, [{ load: 0xc000, data: Uint8Array.from({ length: 512 }, (_, i) => (i * 7) & 0xff) }]);
  return withTurbo(kernal, w.pulses);
}

/** A Microload file, the lowest bit first: a pilot of $a0 (255 on the tapes), the sync bytes $0a … $01, the start and
 *  the length as a negative number, the data from the first byte up and their XOR, then a pause (the tape stops after
 *  each file), unless `tail` gives the bits that follow instead. `bad` spoils the sum. */
export function microFile(w: TurboWriter, o: { load: number; data: ArrayLike<number>; pilot?: number; bad?: boolean; tail?: number[] }): void {
  for (let i = 0; i < (o.pilot ?? 255); i++) novaByte(w, 0xa0);
  for (let s = 0x0a; s >= 1; s--) novaByte(w, s);
  const neg = 0x10000 - o.data.length;
  for (const v of [o.load & 0xff, o.load >> 8, neg & 0xff, neg >> 8]) novaByte(w, v);
  let x = 0;
  for (let i = 0; i < o.data.length; i++) { novaByte(w, o.data[i]); x ^= o.data[i]; }
  novaByte(w, o.bad ? x ^ 0x5a : x);
  if (o.tail) for (const b of o.tail) w.bit(b);
  else firebirdPause(w);
}

/** fixtures/tap/microload-demo.tap: a KERNAL boot file "MICRO DEMO" at $02a7 (bytes of our own, no loader), then
 *  Microload's files at Bigtop Barney's speed (a 0 of 224 cycles, a 1 of 432): a table at $e000, `demo` (a PRG) from its
 *  load address and a table at $c000, each after its own pilot. */
export function microloadDemoTape(demo: Uint8Array): Uint8Array {
  const kernal = makeTap({ files: [{ name: 'MICRO DEMO', load: 0x02a7, data: Uint8Array.from({ length: 93 }, (_, i) => (i * 11 + 3) & 0xff), header: Uint8Array.from({ length: 171 }, (_, i) => (i * 13 + 5) & 0xff) }] });
  const w = new TurboWriter(28, 54);
  microFile(w, { load: 0xe000, data: Uint8Array.from({ length: 1024 }, (_, i) => (i * 3 + 1) & 0xff) });
  microFile(w, { load: demo[0] | (demo[1] << 8), data: demo.subarray(2) });
  microFile(w, { load: 0xc000, data: Uint8Array.from({ length: 512 }, (_, i) => (i * 7) & 0xff) });
  return withTurbo(kernal, w.pulses);
}

/** A whole tape: a KERNAL tape (makeTap) with turbo pulses after it. */
export function withTurbo(kernal: Uint8Array, turbo: number[]): Uint8Array {
  const p = tapPulses(kernal), n = p.cycles.length + turbo.length;
  const u8 = new Uint8Array(20 + n);
  u8.set(kernal.subarray(0, 20));
  u8[16] = n & 0xff; u8[17] = (n >> 8) & 0xff; u8[18] = (n >> 16) & 0xff; u8[19] = n >>> 24;
  u8.set(kernal.subarray(20, 20 + p.cycles.length), 20);
  u8.set(turbo, 20 + p.cycles.length);
  return u8;
}

/** The boot file's loader, in the tape buffer at $0351: it reads the TinyHeader file into `load`-`end` as TapeTool's
 *  TinyHeader loaders do (a pulse on the FLAG line; CIA1's timer A, one shot from 367 cycles, has run out after a 1),
 *  then starts it at `entry` with the ROMs in. The boot file's data ($02a7-$0303) starts it through $0302. */
export function bootLoader(load: number, end: number, entry: number): { header: Uint8Array; data: Uint8Array } {
  const src = `.pc = $0351
loader:
  sei
  lda #$7f
  sta $dc0d
  lda $dc0d
  lda #$05
  sta $01
  lda #$6f
  sta $dc04
  lda #$01
  sta $dc05
sync:
  jsr edge
  rol
  cmp #$aa
  bne sync
  jsr getbyte
  cmp #$69
  bne sync
next:
  jsr getbyte
sm:
  sta $${load.toString(16).padStart(4, '0')}
  inc sm+1
  bne check
  inc sm+2
check:
  lda sm+1
  cmp #<$${end.toString(16).padStart(4, '0')}
  bne next
  lda sm+2
  cmp #>$${end.toString(16).padStart(4, '0')}
  bne next
  jsr getbyte
  lda #$37
  sta $01
  jmp $${entry.toString(16).padStart(4, '0')}
getbyte:
  lda #1
gb:
  jsr edge
  rol
  bcc gb
  rts
edge:
  pha
  lda #$10
e1:
  bit $dc0d
  beq e1
  lda $dc04
  cmp $dc04
  beq e2
  clc
e2:
  lda #$19
  sta $dc0e
  pla
  rts
`;
  const r = assemble({ 'boot.asm': src }, 'boot.asm');
  if (r.errors.length) throw new Error(r.errors.map(e => e.msg).join('; '));
  const header = new Uint8Array(171).fill(0x20);
  header.set(r.mem.subarray(0x0351, r.max + 1), 0);
  // $02a7-$0303: nothing but the vectors at $0300: BASIC's error vector as it is, and $0302 to the loader
  const data = new Uint8Array(0x0304 - 0x02a7).fill(0xea);
  data.set([0x8b, 0xe3, 0x51, 0x03], 0x0300 - 0x02a7);
  return { header, data };
}

/** fixtures/tap/mimir-demo.tap: the boot file with our loader, the raster demo as the TinyHeader file it loads and
 *  starts, a sine table in two blocks written in reverse order, and a file of runs whose blocks are RLE packed. */
export function demoTape(demo: Uint8Array): Uint8Array {
  const load = demo[0] | (demo[1] << 8), data = demo.subarray(2);
  const boot = bootLoader(load, load + data.length, 0x0810);
  const kernal = makeTap({ files: [{ name: 'MIMIR TAPE', load: 0x02a7, data: boot.data, header: boot.header }] });
  const w = new TurboWriter();
  w.leader(0xc0);
  tinyFile(w, data);
  w.leader(0x40);
  blockFile(w, 1, 0x4000, sineTable(), { order: [1, 0] });
  w.leader(0x40);
  blockFile(w, 2, 0x5000, runs(), { packed: true });
  w.leader(0x40);
  return withTurbo(kernal, w.pulses);
}

export const sineTable = () => Uint8Array.from({ length: 512 }, (_, i) => Math.round(127.5 + 127.5 * Math.sin((i / 256) * 2 * Math.PI)));
export const runs = () => Uint8Array.from({ length: 600 }, (_, i) => (i < 300 ? (i >> 5) & 1 ? 0x55 : 0 : i % 7 === 0 ? i & 0xff : 0x20));
