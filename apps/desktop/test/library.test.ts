/* The library in the app (spec 10.6): which blocks go in it, how an item is described, found and drawn. */
import { describe, expect, it } from 'vitest';
import { libraryHash, makePsid, picture, pictureData, sidWithTexts, type LibraryItem } from '@mimir/core';
import { deepSidName, itemCount, itemFrom, itemImage, itemWhat, LIB_COLORS, libraryKindOf, libraryMatches, libraryOrder, sameInLibrary, sidInfo } from '../src/lib/library';

const tune = makePsid(new Uint8Array([0x60, 0x60, 0x60]), 0x1000, 0x1000, 0x1001, 'Tune');
const item = (o: Partial<LibraryItem>): LibraryItem => ({ kind: 'sid', file: 'tune.sid', name: 'Tune', added: 1, hash: libraryHash(tune), data: tune, ...o });

describe('the library in the app', () => {
  it('takes music, sprite, charset and bitmap blocks', () => {
    expect(libraryKindOf('music')).toBe('sid');
    expect(libraryKindOf('sprite')).toBe('sprites');
    expect(libraryKindOf('charset')).toBe('chars');
    expect(libraryKindOf('bitmap')).toBe('bitmaps');
    expect(libraryKindOf('screen')).toBeNull();
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
    expect(itemWhat({ kind: 'bitmaps', data: new Uint8Array(10001), mc: true, file: 'logo.kla' })).toBe('multicolour bitmap, Koala Painter');
    expect(itemWhat({ kind: 'bitmaps', data: new Uint8Array(10001), mc: false, file: 'logo.dd' })).toBe('hires bitmap, Doodle!');
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

  it('draws a bitmap as its picture, each cell in its own colours', () => {
    // cell 0 all %01 (the screen's high nibble: white), cell 1 all %11 (colour RAM: red), the rest %00 (background: blue)
    const bitmap = new Uint8Array(8000);
    bitmap.fill(0x55, 0, 8); bitmap.fill(0xff, 8, 16);
    const color = new Uint8Array(1000); color[1] = 2;
    const data = pictureData(picture({ mc: true, bitmap, screen: new Uint8Array(1000).fill(0x10), color, bg: 6 }));
    const img = itemImage({ kind: 'bitmaps', data }, 1, true, LIB_COLORS);
    expect([img.width, img.height]).toEqual([320, 200]);
    const at = (x: number, y: number) => [...img.rgba.subarray((y * 320 + x) * 4, (y * 320 + x) * 4 + 3)];
    expect([at(0, 0), at(8, 7), at(16, 0)]).toEqual([[255, 255, 255], [0x68, 0x37, 0x2b], [0x35, 0x28, 0x79]]);
    // hires: set bits the high nibble, clear bits the low one
    const hi = itemImage({ kind: 'bitmaps', data: pictureData(picture({ mc: false, bitmap: new Uint8Array(8000).fill(0x80), screen: new Uint8Array(1000).fill(0x16), bg: 0 })) }, 1, false, LIB_COLORS);
    expect([[...hi.rgba.subarray(0, 3)], [...hi.rgba.subarray(4, 7)]]).toEqual([[255, 255, 255], [0x35, 0x28, 0x79]]);
  });
});
