/* SID voice 3's oscillator as a program reads it at $d41b, as VICE 3.10 (x64sc) does with its default SID, reSID's
 * 8580: each table below was read there by the same program (with a BASIC line, SYS 49152, in front). */
import { describe, expect, it } from 'vitest';
import { C64 } from '../src/c64.ts';
import { standInRoms } from '../src/standin.ts';
import { asm } from './asm.ts';

/** the program from $c000, run in a C64 as it powers on until it ends at done: the bytes it left at $c800 */
function run(source: string, count: number): number[] {
  const code = asm(source);
  const m = new C64(standInRoms());
  m.ram.set(code.prg.subarray(2), 0xc000);
  m.write(0, 0x2f); m.write(1, 0x37);
  m.cpu.pc = 0xc000;
  for (let k = 0; k < 4_000_000 && m.cpu.pc !== code.labels.done; k++) { m.dmaWait(); m.advance(m.cpu.step()); }
  expect(m.cpu.pc).toBe(code.labels.done);
  return [...m.ram.subarray(0xc800, 0xc800 + count)];
}

/** the screen off (no badlines) from line $fa on */
const quiet = `       sei
       lda #$0b
       sta $d011
wt0:   lda $d012
       cmp #$fa
       bne wt0`;

/**
 * For xi = 0, 1 ... count-1: voice 3 at frequency `freq` with pulse width `pw`, the test bit set by `test` (a long one,
 * `hold`, 41000 cycles), then `wave` written to $d412 and $d41b read xi + 12 cycles after that write.
 */
const sweep = (count: number, wave: number, o: { test?: number; pw?: number; hold?: boolean; freq?: number } = {}) => {
  const freq = o.freq ?? 0xffff, pw = o.pw ?? 0x800;
  return run(`
* = $c000
${quiet}
       lda #$00
       sta xi
loop:  sec
       lda #<slend
       sbc xi
       sta vec
       lda #>slend
       sbc #$00
       sta vec+1
       lda #${freq & 0xff}
       sta $d40e
       lda #${freq >> 8}
       sta $d40f
       lda #${pw & 0xff}
       sta $d410
       lda #${pw >> 8}
       sta $d411
       lda #${o.test ?? 0x08}
       sta $d412
${o.hold ? '       jsr hold' : '       nop\n       nop'}
       lda #${wave}
       sta $d412
       jmp (vec)
.fill ${count + 2}, $c9
slend: .byte $c5, $ea
       lda $d41b
       ldx xi
       sta $c800,x
       inc xi
       lda xi
       cmp #${count}
       beq done
       jmp loop
done:  jmp done
hold:  ldy #$20
       ldx #$00
h1:    dex
       bne h1
       dey
       bne h1
       rts
xi:    .byte 0
vec:   .word 0
`, count);
};

/** noise at frequency `freq` from the test bit let go, read every 20 cycles (24 after every 64th) 256 times */
const stream = (freq: number) => run(`
* = $c000
${quiet}
       lda #${freq & 0xff}
       sta $d40e
       lda #${freq >> 8}
       sta $d40f
       lda #$08
       sta $d412
       lda #$80
       sta $d412
       ldx #$00
l:     lda $d41b
       sta $c800,x
       inx
       beq done
       txa
       and #$3f
       bne l
       nop
       nop
       nop
       nop
       jmp l
done:  jmp done
`, 256);

const bytes = (hex: string) => hex.match(/../g)!.map(h => parseInt(h, 16));
const each = (n: number, f: (xi: number) => number) => Array.from({ length: n }, (_, xi) => f(xi));

describe('SID oscillator 3', () => {
  it('counts the sawtooth and the triangle from the test bit let go, one cycle late as an 8580 shows them', () => {
    // xi + 12 cycles after the write: the accumulator has added $ffff xi + 12 times, the 8580 shows it as it was a cycle before
    expect(sweep(48, 0x20)).toEqual(each(48, xi => xi + 10));
    expect(sweep(48, 0x10)).toEqual(each(48, xi => 2 * xi + 21));
    expect(sweep(48, 0x10, { freq: 0x1234 })).toEqual(each(48, xi => ((xi + 11) * 0x1234) >> 15));
  });

  it('compares the pulse width a cycle late', () => {
    // the top 12 bits reach $140 in the 21st cycle; the read sees it a cycle later
    expect(sweep(48, 0x40, { pw: 0x0140 })).toEqual(each(48, xi => (xi < 10 ? 0 : 0xff)));
  });

  it('answers a SID-model check as an 8580 (Eclectic, 2014: test bit and every waveform, then the sawtooth)', () => {
    // the lowest bit 4 cycles after the write is 1 on an 8580, 0 on a 6581
    expect(sweep(16, 0x20, { test: 0xff })).toEqual(each(16, xi => xi + 10));
  });

  it('shifts the noise register two cycles after accumulator bit 19 rises, from its power-on value $7ffffe', () => {
    // read every 20 cycles; at $ffff bit 19 rises once (and shifts) while the program sets the frequency and the test bit
    expect(stream(0xffff)).toEqual(bytes(
      'fcfcf8f8f8f8f0e0e0e0c0c0c0810303030604040c0818183030206141c3c38787070f0e1e1c3c38383871f3e3e3c6c4' +
      'c4cc991b1b332624654ddbdb9fb7272f5fdfdfbfbf3f7efdfdfffafcfcf4f0e8f8d0d0e0a18142c08484010b0a121424' +
      '2008085192a220054343cb9615052f1a1c5d75aa287c54e1ebab9346e4a48c585ab03421214bc3d7c7a70f0f1f1ebe3c' +
      '3c797bfbfbf6e6e4ecd8d8d8b933236267c7c7ca8f1f173b2e3c557debbade74f4a8e858d8f1a1a32346c5c586091f1f' +
      '362c345949fb92b76466c94fdadabd25332b7fd7d7a62d9d5e5bbebc3174e9f1dfc2e48da55289fd16936f2f9257eeb6' +
      '980d7a90b86db3c16be684c46c810a5a'));
    expect(stream(0x5a3c)).toEqual(bytes(
      'fefcfcfcfcfcfcfcf8f8f8f8f8f8f8f8f8f0f0f0f0f0e0e0e0e0e0e0e0c0c0c0c0c0c0c0c0c081818181030303030303' +
      '030606060606040404040c0c0808081818181818183030303030202020206161414141c3c3c3c3c3c387878787870707' +
      '0707070f0f0e0e1e1e1c1c1c1c1c3c3c3838383838383879797171f3f3f3e3e3e3e3e6e6c6c6c4c4c4c4c4cccc898999' +
      '99991b1b1b1b3333333636262624246565654d4dcbcbdbdbdbdbdb9f9fb7b737372727272f2f6f6f5f5f5fdfdfdfdfff' +
      'ffbfbfbfbf3f3f3f7e7e7e7efdfdfdfdfdfffffafafafafafcfcfcfcf4f4f0f0f0e8e8e8e8f8f8d0d0d0d0d0e0e0e0e0' +
      'e0a1a181814242424242c0c084848484'));
    // the test bit let go shifts it once (bit 17 inverted in); held 41000 cycles it does not fill it with ones on an 8580
    expect(sweep(120, 0x80, { hold: true })).toEqual(bytes(
      'fcf0c0030820871ce39de72fbeea0b021e4b9df4b1b1992b27ec6aa8c8a494a234eb93c00634a10d694e75ad6a54a4f6' +
      'b5ad6a52ac28432ceb0be3da9b51d7344033459e8e866533160cc2655fd7118154615245c9048226f7ee67be689a7c74' +
      'c238de2b208c7e74ffd6e286c7ffdd27e5f28833e56da3ef'));
  });
});
