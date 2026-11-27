/* What the script editor suggests where the cursor is (spec 10.3): words that start with what is typed, the right
 * kind for the place, and nothing for an index register. */
import { describe, expect, it } from 'vitest';
import { asmMacroSuggestions, dottedNameAt, jsSuggestions, scriptSuggestions, type AsmLibMacro } from '../src/monaco/providers';

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
  it('in 64tass: its directives and functions, a label at the start of the line, ; for a comment', () => {
    const t = (before: string, typed: string) => scriptSuggestions(before, typed, names, pads, { lang: '64tass' }).map(s => s.label).sort();
    expect(t('        ', 'ld')).toEqual(['lda', 'ldx', 'ldy']);
    expect(t('loop    ', 'ro')).toEqual(['rol', 'ror']);
    expect(t('+       ', 'rt')).toEqual(['rti', 'rts']);
    // (a label after white space too, as 64tass takes it; a mnemonic there is the instruction: its operand next)
    expect(t('  loop  ', 'ro')).toEqual(['rol', 'ror']);
    expect(t('\t- ', 'rt')).toEqual(['rti', 'rts']);
    expect(t('  lda ', 'T')).toEqual(['tabell', 'text_out', 'true']);
    expect(t('  loop lda tabell,', 'x')).toEqual([]);
    expect(t('        .', 'en')).toEqual(['.enc', '.endc', '.endif', '.endnamespace']);
    expect(t('        lda ', 'T')).toEqual(['tabell', 'text_out', 'true']);
    expect(t('        lda ', 'le')).toEqual(['len']);
    expect(t('        lda tabell,', 'x')).toEqual([]);
    expect(t('loop    sta pad1,', '')).toEqual([]);
    expect(t('        nop ; ', 'ta')).toEqual([]);
    // Kick Assembler's comment is no comment in 64tass, nor 64tass's in Kick Assembler
    expect(labels('        nop ; ', 'ta')).toEqual(['tabell', 'tan']);
  });
});

describe('suggestions in a JavaScript script', () => {
  const js = (before: string, typed: string) => jsSuggestions(before, typed, names, pads).map(s => s.label).sort();
  it('give what the script is given where code is written, and nothing with nothing typed', () => {
    expect(js('', 'pr')).toEqual(['print']);
    expect(js('const d = ', 'ad')).toEqual(['addr']);
    expect(js('', 'cp')).toEqual(['cpu']);
    expect(js('cpu.', 'ca')).toEqual(['call']);
    expect(js('', '')).toEqual([]);
    expect(jsSuggestions('', 'ad', names, pads)[0].insert).toBe('addr("');
  });
  it('give the program\'s names inside the quotes of what takes an address, and scratchpads inside pad', () => {
    expect(js('const d = addr("', 'ta')).toEqual(['tabell']);
    expect(js('cpu.call("', 'loop')).toEqual(['loop_0870']);
    expect(js('mark(d, "', 'te')).toEqual(['text_out']);
    expect(js('const p = pad("', 'pa')).toEqual(['pad1']);
    // not inside another string
    expect(js('print("', 'pr')).toEqual([]);
  });
});

describe('the macro library\'s macros in the Assembler\'s suggestions (spec 10.8)', () => {
  const lib = (lang: 'kickass' | '64tass'): AsmLibMacro[] => [
    { name: 'SetBorder', how: 'macro', sig: lang === 'kickass' ? 'SetBorder(c)' : 'SetBorder c', snippet: lang === 'kickass' ? 'SetBorder(${1:c})' : '#SetBorder ${1:c}', description: 'The border', in: 'raster', note: '' },
    { name: 'irq_save', how: 'macro', sig: 'irq_save()', snippet: lang === 'kickass' ? 'irq_save()' : '#irq_save', description: '', in: 'irq_lib', note: '' },
    { name: 'Move', how: 'pseudocommand', sig: 'Move src : dst', snippet: 'Move ${1:src} : ${2:dst}', description: '', in: null, note: '' },
    { name: 'Lo', how: 'function', sig: 'Lo(a)', snippet: 'Lo(${1:a})', description: '', in: null, note: '' },
  ];
  const kick = (before: string, typed: string) => asmMacroSuggestions(before, typed, lib('kickass'), 'kickass').map(s => s.insert);
  const tass = (before: string, typed: string) => asmMacroSuggestions(before, typed, lib('64tass'), '64tass').map(s => s.insert);

  it('give the macros where an instruction goes, their calls with places for the parameters', () => {
    expect(kick('        ', 'se')).toEqual(['SetBorder(${1:c})']);
    expect(kick('loop:   ', 'M')).toEqual(['Move ${1:src} : ${2:dst}']);
    // a part after a _, from two letters on
    expect(kick('        ', 'sa')).toEqual(['irq_save()']);
    expect(kick('        ', 's')).toEqual(['SetBorder(${1:c})']);
    // nothing typed, typed in full, in a comment, after an instruction's comma
    expect(kick('        ', '')).toEqual([]);
    expect(kick('        ', 'SetBorder')).toEqual([]);
    expect(kick('        // ', 'Se')).toEqual([]);
    expect(kick('        lda tab,', 'x')).toEqual([]);
  });

  it('give the functions in an operand, not the macros', () => {
    expect(kick('        lda #', 'L')).toEqual(['Lo(${1:a})']);
    expect(kick('        lda #', 'Se')).toEqual([]);
    expect(kick('        lda music.', 'L')).toEqual([]);
  });

  it('(64tass) the call with its # where an instruction goes, without it after a # typed there', () => {
    expect(tass('        ', 'Se')).toEqual(['#SetBorder ${1:c}']);
    expect(tass('        #', 'Se')).toEqual(['SetBorder ${1:c}']);
    expect(tass('        #', '')).toEqual(['SetBorder ${1:c}', 'irq_save', 'Move ${1:src} : ${2:dst}']);
    // an immediate operand's # is no call
    expect(tass('        lda #', '')).toEqual([]);
    expect(tass('        ; ', 'Se')).toEqual([]);
  });
});
