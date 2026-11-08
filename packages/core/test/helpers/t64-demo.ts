/* fixtures/t64/mimir-demo.t64, a T64 tape archive of our own: a boot file at $0801 whose code (copied to $c000) loads
 * the next file from the tape with the KERNAL (LOAD "MIMIR DEMO",1,1) and starts it, the raster demo as that file, and
 * a sine table whose directory entry ends at $c3c6, as an old converter wrote every file's end. */
import { assemble, makeT64 } from '../../src';

/** a sine table of 512 bytes */
export const sine = () => Uint8Array.from({ length: 512 }, (_, i) => Math.round(127.5 + 127.5 * Math.sin((i / 256) * Math.PI)));

/** the boot file: `10 SYS2061`, then a loader copied to $c000 (the file it loads goes over $0801) */
export function t64Boot(name: string, entry: number): Uint8Array {
  const src = `
.encoding "petscii_upper"
* = $0801
  .word $080b, 10
  .byte $9e
  .text "2061"
  .byte 0, 0, 0
  ldx #(loaded - loader)
copy:
  lda code - 1,x
  sta loader - 1,x
  dex
  bne copy
  jmp loader
code:
.pseudopc $c000 {
loader:
  lda #${name.length}
  ldx #<fname
  ldy #>fname
  jsr $ffbd
  lda #1
  ldx #1
  ldy #1
  jsr $ffba
  lda #0
  jsr $ffd5
  bcs fail
  jmp $${entry.toString(16).padStart(4, '0')}
fail:
  inc $d020
  jmp fail
fname:
  .text "${name}"
loaded:
}
`;
  const r = assemble({ 'boot.asm': src }, 'boot.asm');
  if (r.errors.length) throw new Error(r.errors.map(e => e.msg).join('; '));
  return r.mem.slice(0x0801, 0x0801 + (r.max + 1 - 0x0801));
}

export function demoT64(demo: Uint8Array): Uint8Array {
  const load = demo[0] | (demo[1] << 8);
  const t = makeT64({ name: 'MIMIR T64', files: [
    { name: 'MIMIR BOOT', load: 0x0801, data: t64Boot('MIMIR DEMO', 0x0810) },
    { name: 'MIMIR DEMO', load, data: demo.subarray(2) },
    { name: 'MIMIR SINE', load: 0x4000, data: sine() },
  ] });
  // the sine table's end, as Conv64 wrote it
  t.set([0xc6, 0xc3], 0x40 + 2 * 32 + 4);
  return t;
}
