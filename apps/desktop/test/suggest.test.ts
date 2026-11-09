/* What the script editor suggests where the cursor is (spec 10.3): words that start with what is typed, the right
 * kind for the place, and nothing for an index register. */
import { describe, expect, it } from 'vitest';
import { scriptSuggestions } from '../src/monaco/providers';

const names = new Map([['tabell', 0x0939], ['SID_POT_X', 0xd419], ['VIC_SPR0_X', 0xd000], ['loop_0870', 0x0870], ['text_out', 0x2000], ['pad1', 0xc800], ['pad1_end', 0xc900]]);
const pads = [{ name: 'pad1' }];
const labels = (before: string, typed: string) => scriptSuggestions(before, typed, names, pads).map(s => s.label).sort();

describe('script suggestions', () => {
  it('give nothing for the index register after an instruction\'s comma', () => {
    expect(labels('        lda tabell,', 'x')).toEqual([]);
    expect(labels('loop:   sta pad1, ', 'y')).toEqual([]);
    expect(labels('!:      lda (ptr),', 'y')).toEqual([]);
  });

  it('give the words that start with what is typed, not those that only hold its letters', () => {
    expect(labels('        lda ', 'x')).toEqual([]);
    expect(labels('        lda ', 'ta')).toEqual(['tabell', 'tan']);
    expect(labels('        lda ', 'T')).toEqual(['tabell', 'tan', 'text_out', 'toBinaryString', 'toDegrees', 'toHexString', 'toIntString', 'toRadians', 'true']);
    expect(labels('        sta ', 'pad')).toEqual(['pad1', 'pad1_end']);
    expect(scriptSuggestions('        sta ', 'pad', names, pads)[0]).toMatchObject({ kind: 'pad', detail: '$c800 · scratchpad' });
  });

  it('give mnemonics where an instruction goes, directives after a dot there, and nothing in a comment', () => {
    expect(labels('        ', 'ld')).toEqual(['lda', 'ldx', 'ldy']);
    // a word typed in full needs no box
    expect(labels('        ', 'rts')).toEqual([]);
    expect(labels('        lda ', 'tabell')).toEqual([]);
    expect(labels('loop:   ', 'ro')).toEqual(['rol', 'ror']);
    expect(labels('        .', 'by')).toEqual(['.byte']);
    expect(labels('        jsr music.', 'i')).toEqual([]);
    expect(labels('        lda tabell // ', 'ta')).toEqual([]);
    expect(labels('        ', '')).toEqual([]);
  });

  it('give names in a directive\'s list after its commas', () => {
    expect(labels('        .word loop_0870, ', 'te')).toEqual(['text_out']);
  });
});
