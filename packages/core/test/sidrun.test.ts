/* A music player run on the 6510 (spec 5.8, c64/sidrun.ts): init with the song in A, then play once a frame, with the
 * SID registers written, the notes started, the bytes it ran and read, and why it stopped. */
import { describe, expect, it } from 'vitest';
import { assemble } from '../src';
import { plays, runPlayer, USED_READ, USED_RUN } from '../src/c64/sidrun';

/** the assembled source: its memory, and where a label is */
const built = (src: string) => {
  const r = assemble({ 'p.asm': src }, 'p.asm');
  if (r.errors.length) throw new Error(r.errors.map(e => `${e.line}: ${e.msg}`).join('; '));
  return { mem: r.mem, at: (l: string) => Number(r.symbols.get(l)) };
};
const memOf = (src: string) => built(src).mem;
/** init sets the volume, play starts a note on each voice and lets it ring */
const PLAYER = `.pc = $1000
 jmp init
 jmp play
init: lda #$0f
 sta $d418
 rts
play: ldx #0
voice: lda freq,x
 sta $d400,x
 lda #$12
 sta $d401,x
 lda #$41
 sta $d404,x
 lda #$09
 sta $d405,x
 txa
 clc
 adc #7
 tax
 cpx #21
 bne voice
 rts
freq: .byte $11,0,0,0,0,0,0,$22,0,0,0,0,0,0,$33
`;

describe('a player run', () => {
  it('calls init, then play each frame: the SID registers, the notes started and the bytes it used', () => {
    const { mem, at } = built(PLAYER), freq = at('freq');
    const r = runPlayer(mem, { init: 0x1000, play: 0x1003, frames: 150 });
    expect(r).toMatchObject({ init: true, played: 150, stop: null, notes: 3 });
    // $d400, $d401, $d404 and $d405 of each voice, and the volume
    expect(r.regs).toBe(13);
    expect(plays(r)).toBe(true);
    expect(r.used[0x1000] & USED_RUN).toBeTruthy();
    expect(r.used[0x1006] & USED_RUN).toBeTruthy();
    // the frequencies are read, the bytes after them are not used
    expect([0, 7, 14].map(k => r.used[freq + k])).toEqual([USED_READ, USED_READ, USED_READ]);
    expect(r.used[freq + 1]).toBe(0);
    expect(r.used[freq + 15]).toBe(0);
  });

  it('plays on without init, and says why a run that is no player stops', () => {
    const r = runPlayer(memOf(PLAYER), { init: 0x1000, play: 0x1003, frames: 10, noInit: true });
    expect(r).toMatchObject({ init: true, played: 10, regs: 12 });
    expect(runPlayer(memOf('.pc = $1000\n jmp init\n jmp init\ninit: jmp init\n'), { init: 0x1000, play: 0x1003, frames: 10 }).stop).toMatch(/^init does not return/);
    expect(runPlayer(memOf('.pc = $1000\n jmp init\n jmp play\ninit: rts\nplay: brk\n'), { init: 0x1000, play: 0x1003, frames: 10 }).stop).toMatch(/^play runs into a BRK at \$1007 \(call 1\)/);
    expect(runPlayer(memOf('.pc = $1000\n jmp init\n jmp play\ninit: rts\nplay: inc $2000\n rts\n'), { init: 0x1000, play: 0x1003, frames: 100, quiet: 50 }).stop).toMatch(/writes no SID register in 50 calls/);
    // a player that writes the SID but starts no notes does not play
    expect(plays(runPlayer(memOf('.pc = $1000\n jmp init\n jmp play\ninit: rts\nplay: ldx #$18\n lda #0\nc: sta $d400,x\n dex\n bpl c\n rts\n'), { init: 0x1000, play: 0x1003, frames: 20 }))).toBe(false);
  });

  it('stops where the code runs into bytes that are not loaded', () => {
    const r = runPlayer(memOf(PLAYER.replace('init: lda #$0f', 'init: jmp $3000\n lda #$0f')), { init: 0x1000, play: 0x1003, frames: 10, loaded: a => a >= 0x1000 && a < 0x1100 });
    expect(r.stop).toBe('init runs into $3000, which is not loaded');
  });
});
