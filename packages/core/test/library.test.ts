/* The library (spec 10.6): file names that say where the bytes were found, the files' formats, and library.json read
 * with the files the folders hold. */
import { describe, expect, it } from 'vitest';
import {
  charsetFile, isLibraryFileName, libraryHash, libraryIndexJson, libraryItems, librarySourceText, libraryStem, makePsid, parsePsid, readLibraryFile, readLibraryIndex,
  safeFileName, sidWithTexts, spriteFile, uniqueLibraryName, type LibraryEntry,
} from '../src';

describe('file names', () => {
  it('says where the bytes were taken from, each place once', () => {
    expect(librarySourceText({ disk: 'Comaland side 1.d64', file: 'file25_1000.prg', project: 'Comaland' })).toBe('Comaland side 1 - file25_1000');
    expect(librarySourceText({ file: 'cybernoid ii.prg', project: 'Cybernoid II' })).toBe('Cybernoid II');
    // a project whose name holds the file's takes its place
    expect(librarySourceText({ file: 'Comaland.prg', project: 'Comaland II' })).toBe('Comaland II');
    expect(librarySourceText({ file: 'game.vsf', project: 'Uridium' })).toBe('game - Uridium');
    // the same name with other spaces, dots and underscores is said once, as the project has it
    expect(librarySourceText({ file: 'INTRO_3_V1_0_FLA-unpacked.prg', project: 'INTRO 3 V1.0_FLA-unpacked' })).toBe('INTRO 3 V1.0_FLA-unpacked');
    expect(librarySourceText({})).toBe('');
  });

  it('is the source, the name and the addresses', () => {
    expect(libraryStem('music_1000', { disk: 'Comaland side 1.d64', file: 'file25_1000.prg', start: 0x1000, end: 0x2000 }))
      .toBe('Comaland side 1 - file25_1000 - music_1000 ($1000-$1fff)');
    // the source as the user wrote it
    expect(libraryStem('Commando theme', { text: 'Rob Hubbard', start: 0x1000, end: 0x1800 })).toBe('Rob Hubbard - Commando theme ($1000-$17ff)');
    // a name that is the source is not said twice; no source, no addresses
    expect(libraryStem('Uridium', { text: 'uridium' })).toBe('uridium');
    expect(libraryStem('charset_3000')).toBe('charset_3000');
    expect(libraryStem('', {})).toBe('untitled');
  });

  it('is a name Windows takes', () => {
    expect(safeFileName('a/b\\c:d*e?f"g<h>i|j')).toBe('a_b_c_d_e_f_g_h_i_j');
    expect(safeFileName('- THE DEMO -')).toBe('THE DEMO -');
    expect(safeFileName('name. ')).toBe('name');
    expect(safeFileName('con')).toBe('_con');
    expect(safeFileName('a\u0001b   c')).toBe('a_b c');
    expect(safeFileName('...')).toBe('untitled');
    // a long one is cut, the addresses kept
    const s = libraryStem('x'.repeat(300), { start: 0x1000, end: 0x1100 });
    expect(s.length).toBeLessThanOrEqual(140);
    expect(s.endsWith(' ($1000-$10ff)')).toBe(true);
  });

  it('is made unique in its folder', () => {
    expect(uniqueLibraryName('tune', 'sid', [])).toBe('tune.sid');
    expect(uniqueLibraryName('tune', 'sid', ['TUNE.sid', 'tune (2).sid'])).toBe('tune (3).sid');
  });

  it('is a plain name of the kind', () => {
    expect(isLibraryFileName('sid', 'tune.sid')).toBe(true);
    expect(isLibraryFileName('sid', 'tune.prg')).toBe(false);
    expect(isLibraryFileName('chars', 'font.64c')).toBe(true);
    expect(isLibraryFileName('chars', '../font.64c')).toBe(false);
    expect(isLibraryFileName('sprites', 'a\\b.spr')).toBe(false);
    expect(isLibraryFileName('sprites', '.spr')).toBe(false);
  });
});

describe('the files', () => {
  it('writes a charset with its load address and sprites whole', () => {
    const f = charsetFile(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), 0x3000);
    expect([...f.slice(0, 3)]).toEqual([0x00, 0x30, 1]);
    expect(readLibraryFile('chars', 'font.64c', f)).toEqual({ data: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), load: 0x3000 });
    expect(spriteFile(new Uint8Array(63).fill(7)).length).toBe(64);
    expect(spriteFile(new Uint8Array(128)).length).toBe(128);
  });

  it('reads files put there by hand', () => {
    // raw: as they are; 2 more than whole: a load address
    expect(readLibraryFile('chars', 'font.bin', new Uint8Array(2048))).toEqual({ data: new Uint8Array(2048) });
    expect(readLibraryFile('sprites', 'man.spr', new Uint8Array(130))).toMatchObject({ load: 0 });
    expect(readLibraryFile('sid', 'x.sid', new Uint8Array(200))).toEqual({ problem: 'not a PSID or RSID file' });
    expect(readLibraryFile('chars', 'font.bin', new Uint8Array(0))).toEqual({ problem: 'empty' });
  });

  it('sets the texts of a .sid', () => {
    const sid = makePsid(new Uint8Array([0x60]), 0x1000, 0x1000, 0x1003, 'Ripped music');
    const t = parsePsid(sidWithTexts(sid, { name: 'Låten', author: 'Rob Hubbard', released: 'Cybernoid II - file' }));
    expect(t).toMatchObject({ name: 'Låten', author: 'Rob Hubbard', released: 'Cybernoid II - file', rsid: false, location: 0x1000, play: 0x1003 });
    // 31 characters at most, one not in Latin-1 is ?
    expect(parsePsid(sidWithTexts(sid, { name: 'x'.repeat(40) + '♪' })).name).toBe('x'.repeat(31));
    expect(parsePsid(sidWithTexts(sid, { author: 'a ♪' })).author).toBe('a ?');
    // what is not given stays
    expect(parsePsid(sidWithTexts(sid, { author: 'me' })).name).toBe('Ripped music');
  });
});

describe('library.json and the folders', () => {
  const tune = makePsid(new Uint8Array([0x60, 0x60, 0x60]), 0x1000, 0x1000, 0x1001, 'Tune');
  const font = charsetFile(new Uint8Array(16).fill(0x55), 0x2000);
  const entry = (e: Partial<LibraryEntry>): LibraryEntry => ({ kind: 'sid', file: 'tune.sid', name: 'Tune', added: 5, hash: libraryHash(tune), ...e });

  it('reads the entries it can, leaves out the rest', () => {
    const json = libraryIndexJson([entry({ from: { text: 'Game', start: 0x1000, end: 0x1003 }, digi: { nmi: true, hz: 8000 }, busy: [[0x2000, 0x2100]] })]);
    expect(readLibraryIndex(JSON.parse(json))).toEqual([entry({ from: { text: 'Game', start: 0x1000, end: 0x1003 }, digi: { nmi: true, hz: 8000 }, busy: [[0x2000, 0x2100]] })]);
    expect(readLibraryIndex({ items: [{ kind: 'sid', file: '../x.sid', name: 'x', hash: '1' }, { kind: 'bitmap', file: 'x.sid', name: 'x', hash: '1' }, null, 7] })).toEqual([]);
    expect(readLibraryIndex(null)).toEqual([]);
    expect(readLibraryIndex({ items: [{ kind: 'chars', file: 'f.64c', name: 'f', hash: 'ab', colors: { bg: 0, fg: 1, mc1: 2, mc2: 99 }, mc: true }] })).toEqual([{ kind: 'chars', file: 'f.64c', name: 'f', hash: 'ab', added: 0, mc: true }]);
  });

  it('gives each file its entry, and the files put there by hand', () => {
    const r = libraryItems([entry({})], [
      { kind: 'sid', file: 'tune.sid', bytes: tune, mtime: 9 },
      { kind: 'chars', file: 'mine.64c', bytes: font, mtime: 7 },
      { kind: 'chars', file: 'broken.bin', bytes: new Uint8Array(0), mtime: 7 },
    ]);
    expect(r.changed).toBe(false);
    expect(r.items.map(i => [i.kind, i.file, i.name, i.added, !!i.own])).toEqual([['sid', 'tune.sid', 'Tune', 5, false], ['chars', 'mine.64c', 'mine', 7, true]]);
    expect(r.items[1]).toMatchObject({ load: 0x2000, data: new Uint8Array(16).fill(0x55) });
  });

  it('finds a renamed file by its bytes and drops entries whose file is gone', () => {
    const r = libraryItems([entry({ from: { text: 'Game' } }), entry({ kind: 'chars', file: 'gone.64c', hash: 'ffffffff' })], [{ kind: 'sid', file: 'renamed.sid', bytes: tune, mtime: 9 }]);
    expect(r.changed).toBe(true);
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({ file: 'renamed.sid', name: 'Tune', from: { text: 'Game' } });
    expect(r.index).toEqual([entry({ file: 'renamed.sid', from: { text: 'Game' } })]);
  });

  it('takes a file changed by hand with its new bytes', () => {
    const other = makePsid(new Uint8Array([0x60]), 0x1000, 0x1000, 0x1000, 'Other');
    const r = libraryItems([entry({})], [{ kind: 'sid', file: 'tune.sid', bytes: other, mtime: 9 }]);
    expect(r.changed).toBe(true);
    expect(r.index[0].hash).toBe(libraryHash(other));
  });
});
