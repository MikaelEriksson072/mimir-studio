/* What the script editor suggests where the cursor is (spec 10.3): words that start with what is typed, the right
 * kind for the place, and nothing for an index register. */
import { describe, expect, it } from 'vitest';
import { dottedNameAt, scriptSuggestions } from '../src/monaco/providers';

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

  it('give the script\'s links first, the program\'s names before the hardware\'s, and say what each is', () => {
    const more = { links: new Set(['tabell', 'text_out+3']), kinds: new Map([['tabell', 'table'], ['text_out', 'text']]) };
    const got = scriptSuggestions('        lda ', 't', names, pads, more);
    expect(got.filter(s => s.kind === 'link')).toEqual([
      { label: 'tabell', kind: 'link', detail: '$0939 · linked · table' },
      { label: 'text_out+3', kind: 'link', detail: '$2003 · linked · text' },
    ]);
    // a linked name is not given twice
    expect(got.filter(s => s.label === 'tabell')).toHaveLength(1);
    expect(scriptSuggestions('        lda ', 'te', names, pads, more).find(s => s.label === 'text_out')).toEqual({ label: 'text_out', kind: 'name', detail: '$2000 · text' });
    expect(scriptSuggestions('        lda ', 'SID', names, pads)).toEqual([{ label: 'SID_POT_X', kind: 'hardware', detail: '$d419 · hardware' }]);
  });

  it('give the rest of a name with a dot after its first part (LoadSid\'s music.location, …), and find it whole', () => {
    const music = new Map([...names, ['music.location', 0x1000], ['music.init', 0x1000], ['music.play', 0x1003], ['music.size', 0x0a00]]);
    const kinds = new Map([['music.play', 'music: its play routine']]);
    const got = (before: string, typed: string) => scriptSuggestions(before, typed, music, pads, { kinds });
    expect(got('        sta music.', '').map(s => s.label).sort()).toEqual(['.init', '.location', '.play', '.size']);
    expect(got('        jsr music.', 'p')).toEqual([{ label: '.play', kind: 'name', detail: '$1003 · music: its play routine' }]);
    expect(got('        lda music.', 'lo').map(s => s.label)).toEqual(['.location']);
    // a name that has no such names, a number, and a directive where a mnemonic goes, as before
    expect(got('        lda tabell.', '')).toEqual([]);
    expect(got('        lda $1000.', '')).toEqual([]);
    expect(got('        .', 'by').map(s => s.label)).toEqual(['.byte']);
    // typed from its start it is found whole
    expect(got('        sta ', 'mus').map(s => s.label).sort()).toEqual(['music.init', 'music.location', 'music.play', 'music.size']);
    // the hover takes the name whole, wherever in it the mouse is
    const line = '        sta music.location+$1ae1,y  // lda.abs';
    expect(dottedNameAt(line, line.indexOf('music') + 1)).toBe('music.location');
    expect(dottedNameAt(line, line.indexOf('location') + 3)).toBe('music.location');
    expect(dottedNameAt(line, line.indexOf('$1ae1'))).toBeNull();
    expect(dottedNameAt('        lda.abs $0000,y', 9)).toBe('lda.abs');
  });

  it('find a name by a part of it after a _ from two letters on, and give them all on Ctrl+Space', () => {
    expect(labels('        lda ', 'po')).toEqual(['SID_POT_X', 'pow']);
    expect(labels('        lda ', 'ou')).toEqual(['text_out']);
    // one letter, or a digit, finds no part
    expect(labels('        lda ', 'o')).toEqual([]);
    expect(labels('        lda ', '08')).toEqual([]);
    // nothing typed in an operand (Ctrl+Space): every name and function; still nothing after an index comma
    expect(labels('        lda ', '')).toEqual(expect.arrayContaining(['tabell', 'SID_POT_X', 'pad1', 'loop_0870', 'sin']));
    expect(labels('        lda tabell,', '')).toEqual([]);
  });
});
