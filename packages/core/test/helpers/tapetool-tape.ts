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
 *  [the name,] start, end, the data and their XOR, the top bit first, as their loaders read them. */
export function pilotFile(w: TurboWriter, o: { pilot: number; sync: number; name?: string; load: number; data: Uint8Array }): void {
  for (let i = 0; i < 64; i++) w.byte(o.pilot);
  w.byte(o.sync);
  if (o.name != null) w.bytes(Array.from({ length: 16 }, (_, i) => (i < o.name!.length ? o.name!.toUpperCase().charCodeAt(i) : 0x20)));
  const end = o.load + o.data.length;
  w.bytes([o.load & 0xff, o.load >> 8, end & 0xff, end >> 8]);
  w.bytes(o.data);
  w.byte(o.data.reduce((a, v) => a ^ v, 0));
  for (let i = 0; i < 16; i++) w.byte(0);
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
