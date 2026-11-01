import { describe, expect, it } from 'vitest';
import { T, type ListingLine } from '@mimir/core';
import { findLines, findRegExp, findText, nextHit } from '../src/lib/find';

const lines: ListingLine[] = [
  { k: 'hdr', a: 0x0810, blk: 0, type: T.CODE, text: 'Code · main_loop · $0810-$081f (16 bytes)' },
  { k: 'lbl', a: 0x0810, name: 'main_loop' },
  { k: 'ins', a: 0x0810, n: 2, mn: 'lda', ext: '', tok: [{ t: 'p', s: '#' }, { t: 'num', s: '$00' }], cmt: 'black border' },
  { k: 'ins', a: 0x0812, n: 3, mn: 'sta', ext: '', tok: [{ t: 'hw', s: 'BORDER', to: 0xd020 }], cmt: '' },
  { k: 'dat', a: 0x0815, n: 4, dir: '.text', tok: [{ t: 'str', s: '"HELLO"' }], cmt: '' },
  { k: 'cmt', a: 0x0819, text: 'set the border to black' },
  { k: 'ins', a: 0x0819, n: 3, mn: 'jmp', ext: '', tok: [{ t: 'lbl', s: 'main_loop2', to: 0x0820 }], cmt: '' },
  { k: 'blank', a: 0x081c },
];
const texts = lines.map(findText);
const find = (q: string, matchCase = false, word = false) => findLines(texts, findRegExp(q, { matchCase, word }));

describe('Find in the listing', () => {
  it('searches the text the listing shows, without addresses and bytes', () => {
    expect(texts[2]).toBe('lda #$00\n// black border');
    expect(texts[1]).toBe('main_loop:');
    expect(find('lda #$00')).toEqual([2]);
    expect(find('0810')).toEqual([0]);
    expect(find('8d')).toEqual([]);
    expect(texts[7]).toBe('');
  });

  it('finds in any case unless asked to match it', () => {
    expect(find('border')).toEqual([2, 3, 5]);
    expect(find('BORDER', true)).toEqual([3]);
    expect(find('hello')).toEqual([4]);
    expect(find('hello', true)).toEqual([]);
  });

  it('finds whole words, and takes the text as it is (not as a pattern)', () => {
    expect(find('main_loop')).toEqual([0, 1, 6]);
    expect(find('main_loop', false, true)).toEqual([0, 1]);
    expect(find('$00')).toEqual([2]);
    expect(find('.text')).toEqual([4]);
    expect(find('(')).toEqual([0]);
    expect(find('')).toEqual([]);
  });

  it('keeps the code and the comment of a line apart', () => {
    expect(find('$00 // black')).toEqual([]);
    expect(find('// black border')).toEqual([2]);
    expect(find('code')).toEqual([0]);
  });

  it('steps through the hits from a line, around at the ends', () => {
    const hits = [2, 5, 9];
    expect(nextHit(hits, 5, 1)).toBe(2);
    expect(nextHit(hits, 5, 1, true)).toBe(1);
    expect(nextHit(hits, 6, 1, true)).toBe(2);
    expect(nextHit(hits, 9, 1)).toBe(0);
    expect(nextHit(hits, 5, -1)).toBe(0);
    expect(nextHit(hits, 2, -1)).toBe(2);
    expect(nextHit(hits, 0, -1)).toBe(2);
    expect(nextHit(hits, 30, -1)).toBe(2);
    expect(nextHit([], 3, 1)).toBe(-1);
  });
});
