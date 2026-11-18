/* The library in the app (spec 10.6): which blocks go in it, how an item is described, found and drawn. */
import { describe, expect, it } from 'vitest';
import { libraryHash, makePsid, sidWithTexts, type LibraryItem } from '@mimir/core';
import { deepSidName, itemCount, itemFrom, itemImage, itemWhat, LIB_COLORS, libraryKindOf, libraryMatches, libraryOrder, sameInLibrary, sidInfo } from '../src/lib/library';

const tune = makePsid(new Uint8Array([0x60, 0x60, 0x60]), 0x1000, 0x1000, 0x1001, 'Tune');
const item = (o: Partial<LibraryItem>): LibraryItem => ({ kind: 'sid', file: 'tune.sid', name: 'Tune', added: 1, hash: libraryHash(tune), data: tune, ...o });

describe('the library in the app', () => {
  it('takes music, sprite and charset blocks', () => {
    expect(libraryKindOf('music')).toBe('sid');
    expect(libraryKindOf('sprite')).toBe('sprites');
    expect(libraryKindOf('charset')).toBe('chars');
    expect(libraryKindOf('bitmap')).toBeNull();
    expect(libraryKindOf('code')).toBeNull();
  });

  it('says what an item is and where it was taken from', () => {
    expect(itemWhat(item({}))).toBe('PSID');
    expect(itemWhat(item({ data: sidWithTexts(makePsid(new Uint8Array(3), 0x1000, 0x1000, 0, 'x', true), {}) }))).toBe('RSID');
    expect(itemWhat({ kind: 'sprites', data: new Uint8Array(192) })).toBe('3 sprites');
    expect(itemWhat({ kind: 'chars', data: new Uint8Array(8) })).toBe('1 character');
    expect(itemCount({ kind: 'chars', data: new Uint8Array(2048) })).toBe(256);
    expect(itemFrom(item({ from: { text: 'Cybernoid II', start: 0x1000, end: 0x2000 } }))).toBe('Cybernoid II · $1000-$1fff');
    expect(itemFrom(item({ own: true }))).toBe('put in the folder by hand');
    expect(itemFrom(item({}))).toBe('');
    expect(sidInfo({ kind: 'sid', data: new Uint8Array(10) })).toBeNull();
  });

  it('finds items by every word, in their names, sources and authors', () => {
    const t = item({ data: sidWithTexts(tune, { author: 'Rob Hubbard' }), from: { text: 'Commando', disk: 'Commando.d64' } });
    expect(libraryMatches(t, '')).toBe(true);
    expect(libraryMatches(t, 'hubbard commando')).toBe(true);
    expect(libraryMatches(t, 'sids')).toBe(true);
    expect(libraryMatches(t, 'hubbard sprites')).toBe(false);
  });

  it('lists the newest first', () => {
    expect(libraryOrder([item({ file: 'a.sid', added: 1 }), item({ file: 'b.sid', added: 3 }), item({ file: 'c.sid', added: 3 })]).map(i => i.file)).toEqual(['b.sid', 'c.sid', 'a.sid']);
  });

  it('finds the same bytes in the library, a .sid whatever its texts', () => {
    const items = [item({ data: sidWithTexts(tune, { name: 'Another name', author: 'Me' }) }), item({ kind: 'chars', file: 'f.64c', data: new Uint8Array(8).fill(1), hash: libraryHash(new Uint8Array(8).fill(1)) })];
    expect(sameInLibrary(items, 'sid', tune)?.file).toBe('tune.sid');
    expect(sameInLibrary(items, 'chars', new Uint8Array(8).fill(1))?.file).toBe('f.64c');
    expect(sameInLibrary(items, 'chars', new Uint8Array(8).fill(2))).toBeNull();
    expect(sameInLibrary(items, 'sprites', new Uint8Array(8).fill(1))).toBeNull();
  });

  it('gives DeepSID a plain name', () => {
    expect(deepSidName('Comaland - music_1000 ($1000-$1fff)', tune)).toMatch(/^Comaland_-_music_1000_1000-_1fff-[0-9a-f]{6}\.sid$/);
    expect(deepSidName('åäö', tune)).toMatch(/^tune-[0-9a-f]{6}\.sid$/);
  });

  it('draws sprites and characters so many a row', () => {
    const sprites = { kind: 'sprites' as const, data: new Uint8Array(64 * 5).fill(0xff) };
    expect(itemImage(sprites, 4, false, LIB_COLORS)).toMatchObject({ width: 4 * 24, height: 2 * 21 });
    expect(itemImage(sprites, 8, false, LIB_COLORS)).toMatchObject({ width: 5 * 24, height: 21 });
    // a thumbnail: the first two only
    expect(itemImage(sprites, 8, false, LIB_COLORS, 2)).toMatchObject({ width: 2 * 24, height: 21 });
    const chars = { kind: 'chars' as const, data: new Uint8Array(2048) };
    expect(itemImage(chars, 32, false, LIB_COLORS)).toMatchObject({ width: 256, height: 64 });
    // a set pixel in the foreground colour (white), an unset one in the background's (black)
    const img = itemImage({ kind: 'chars', data: new Uint8Array([0x80, 0, 0, 0, 0, 0, 0, 0]) }, 16, false, LIB_COLORS);
    expect([...img.rgba.subarray(0, 4)]).toEqual([255, 255, 255, 255]);
    expect([...img.rgba.subarray(4, 8)]).toEqual([0, 0, 0, 255]);
  });
});
