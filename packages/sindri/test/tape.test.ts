/* The datasette (tape.ts): a TAP's pulses on CIA1's FLAG line while the motor runs, PLAY held down; the KERNAL's format
 * read for LOAD from the tape; and a boot file, as tape loaders have them, whose loader in the tape buffer reads the
 * next file from the tape and starts it, or that starts through the IRQ vector the KERNAL puts back after the load. */
import { describe, expect, it } from 'vitest';
import { Datasette, tapeFiles, tapPulses, unpack } from '../src/index.ts';
import { findRoms } from '../src/node.ts';
import { asm } from './asm.ts';
import { PROGRAM } from './packers.ts';

const roms = findRoms();
const S = 0x30, M = 0x42, L = 0x56;

/** a header block and a data block in the KERNAL's format, each twice, as SAVE writes them (TAP units) */
function kernal(out: number[], header: Uint8Array, data: Uint8Array): void {
  const byte = (v: number) => {
    out.push(L, M);
    let ones = 0;
    for (let b = 0; b < 8; b++) { const bit = (v >> b) & 1; ones += bit; out.push(...(bit ? [M, S] : [S, M])); }
    out.push(...(ones & 1 ? [S, M] : [M, S]));
  };
  for (const [block, leader] of [[header, 0x6a00], [data, 0x1500]] as const) {
    for (const copy of [0x80, 0]) {
      for (let i = 0; i < (copy ? leader : 0x4f); i++) out.push(S);
      for (let i = 9; i >= 1; i--) byte(copy | i);
      for (const v of block) byte(v);
      byte(block.reduce((a, v) => a ^ v, 0));
      out.push(L, S);
    }
    for (let i = 0; i < 0x4e; i++) out.push(S);
  }
}

/** turbo bytes, the top bit first: a 0 of 256 cycles, a 1 of 512 */
const turbo = (out: number[], bytes: ArrayLike<number>) => { for (let i = 0; i < bytes.length; i++) for (let b = 7; b >= 0; b--) out.push((bytes[i] >> b) & 1 ? 0x40 : 0x20); };

function tap(pulses: number[]): Uint8Array {
  const u8 = new Uint8Array(20 + pulses.length);
  u8.set([...'C64-TAPE-RAW'].map(c => c.charCodeAt(0)));
  u8[12] = 1;
  u8[16] = pulses.length & 0xff; u8[17] = (pulses.length >> 8) & 0xff; u8[18] = pulses.length >> 16;
  u8.set(pulses, 20);
  return u8;
}

const header = (type: number, start: number, end: number, name: string, rest: Uint8Array = new Uint8Array(0)) => {
  const h = new Uint8Array(192).fill(0x20);
  h.set([type, start & 0xff, start >> 8, end & 0xff, end >> 8], 0);
  h.set([...name].map(c => c.charCodeAt(0)), 5);
  h.set(rest.subarray(0, 171), 21);
  return h;
};

/** the boot file's loader, in the tape buffer at $0351: it waits for the sync byte $aa and $69, reads PROGRAM's bytes
 *  to $1000 (a pulse on the FLAG line; CIA1's timer A, one shot from 367 cycles, has run out after a 1) and starts it */
const end = 0x1000 + PROGRAM.prg.length - 2;
const LOADER = asm(`
* = $0351
loader: sei
       lda #$7f
       sta $dc0d
       lda $dc0d
       lda #$05
       sta $01
       lda #$6f
       sta $dc04
       lda #$01
       sta $dc05
sync:  jsr edge
       rol a
       cmp #$aa
       bne sync
       jsr getbyte
       cmp #$69
       bne sync
next:  jsr getbyte
sm:    sta $1000
       inc sm+1
       bne check
       inc sm+2
check: lda sm+1
       cmp #<${end}
       bne next
       lda sm+2
       cmp #>${end}
       bne next
       lda #$37
       sta $01
       jmp $1000
getbyte: lda #1
gb:    jsr edge
       rol a
       bcc gb
       rts
edge:  pha
       lda #$10
e1:    bit $dc0d
       beq e1
       lda $dc04
       cmp $dc04
       beq e2
       clc
e2:    lda #$19
       sta $dc0e
       pla
       rts
`);

/** a tape: the boot file (`data` at `load`, the loader in its header), then PROGRAM as turbo data after a leader */
function bootTape(load: number, data: Uint8Array): Uint8Array {
  const out: number[] = [];
  kernal(out, header(3, load, load + data.length, 'BOOT', LOADER.prg.subarray(2)), data);
  const t: number[] = [];
  for (let i = 0; i < 64; i++) turbo(t, [0xff, 0xc3]);
  turbo(t, [0xaa, 0x69, ...PROGRAM.prg.subarray(2), 0]);
  for (let i = 0; i < 16; i++) turbo(t, [0xff, 0xc3]);
  return tap([...out, ...t]);
}

/** $02a7-$0303, starting the loader through $0302 when BASIC goes on after the LOAD */
const viaMain = () => { const d = new Uint8Array(0x0304 - 0x02a7).fill(0xea); d.set([0x8b, 0xe3, 0x51, 0x03], 0x59); return d; };
/** $029f-$02a6: the IRQ vector the KERNAL keeps while it reads the tape, which it puts back after the load */
const viaIrq = () => Uint8Array.from([0x51, 0x03, 0, 0, 0, 0, 0, 0]);
const prgOf = (load: number, data: Uint8Array) => Uint8Array.from([load & 0xff, load >> 8, ...data]);

describe('the datasette', () => {
  it('reads the pulses of a TAP, and its KERNAL files', () => {
    const t = bootTape(0x02a7, viaMain());
    const p = tapPulses(t);
    expect(p[0]).toBe(S * 8);
    const [f] = tapeFiles(p);
    expect([f.type, f.start, f.end, [...f.data]]).toEqual([3, 0x02a7, 0x0304, [...viaMain()]]);
    expect([...f.header.subarray(21, 21 + LOADER.prg.length - 2)]).toEqual([...LOADER.prg.subarray(2)]);
    // the trailer after the file, then the turbo data
    expect([p[f.to], p[f.to + 0x4e]]).toEqual([S * 8, 0x40 * 8]);
  });

  it('plays its pulses while the motor runs: an edge as each one ends', () => {
    const d = new Datasette(Uint32Array.from([100, 200, 300]));
    expect(d.advance(99)).toBe(0);
    expect(d.advance(1)).toBe(1);
    expect(d.advance(500)).toBe(2);
    expect([d.atEnd, d.edges]).toEqual([true, 3]);
    d.seek(1);
    expect([d.pos, d.advance(200)]).toEqual([1, 1]);
  });

  for (const [what, r] of [['the stand-ins', null], ['the ROMs', roms]] as const) {
    it.skipIf(!r && what === 'the ROMs')(`runs the boot file's loader, which reads the next file from the tape (${what})`, () => {
      for (const [how, load, data] of [['$0302', 0x02a7, viaMain()], ['the IRQ vector at $029f', 0x029f, viaIrq()]] as const) {
        const t = bootTape(load, data);
        const res = unpack(prgOf(load, data), { roms: r, tape: t });
        expect(res.tape, how).toMatch(/the tape stood after the file .* played/);
        expect(res.unpacked, how).toBe(true);
        expect(res.saved!.entry, how).toBe(0x1000);
        const s = res.saved!;
        expect([...s.prg.subarray(2 + 0x1000 - s.start, 2 + 0x1000 - s.start + PROGRAM.prg.length - 2)], how).toEqual([...PROGRAM.prg.subarray(2)]);
        // PLAY held down reads as a 0 on bit 4 of $01; the saved port is the program's
        expect(s.port & 0x10, how).toBe(0x10);
      }
    });
  }

  it('leaves the pointers a tape LOAD leaves: the start in $c1, the end in $ae and in $ac', () => {
    // budget boot files (Mastertronic's, Codemasters') clear the memory from ($ac) up to $0800
    for (const r of [null, roms]) {
      if (r === roms && !roms) continue;
      let seen: number[] | null = null;
      unpack(prgOf(0x02a7, viaMain()), { roms: r, tape: bootTape(0x02a7, viaMain()), maxCycles: 2_000_000, onStep: (_pc, m) => { seen ??= [0xc1, 0xc2, 0xae, 0xaf, 0xac, 0xad].map(a => m.ram[a]); } });
      expect(seen).toEqual([0xa7, 0x02, 0x04, 0x03, 0x04, 0x03]);
    }
  });

  it('without the tape the loader waits for pulses that never come', () => {
    const res = unpack(prgOf(0x02a7, viaMain()), { roms: null, maxCycles: 20_000_000 });
    expect(res.unpacked).toBe(false);
    expect(res.tape).toBeNull();
  });
});
