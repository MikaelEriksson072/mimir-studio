/* A tape as a C64 shows its files: what LOAD prints as it searches the tape, against x64sc 3.10's screen (true datasette
 * emulation, LOAD"ZZZ") for tapes with odd names and the repository's tape fixtures; and the directory the files would
 * make on a disk, listed by the 1541's rules (dirlist.ts, checked against VICE in dirlist.test.ts). */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { makeT64, readTape, screenRowText, tapeDirectory, tapeDirEntry, tapeScreen, type DirScreen, type TapeScreen } from '../src';
import { controlTape, kernalTape, oddTape } from './helpers/tapelist-tapes';
import { VICE_TAPE_SCREENS } from './helpers/tapelist-vice';

const fixture = (p: string) => readFileSync(join(__dirname, '../../../fixtures', p));
const hex = (a: ArrayLike<number>) => Array.from(a, b => b.toString(16).padStart(2, '0')).join('');
const asc = (s: string) => [...s].map(c => c.charCodeAt(0));

/** the screen's rows as VICE's are written: screen codes in hex, then the colours, a colour only where something is shown */
const rowsOf = (s: TapeScreen) => s.rows.map(r => `${hex(r.codes)} ${Array.from(r.colors, (c, i) => (r.codes[i] === 0x20 ? '.' : c.toString(16))).join('')}`);
const viceRows = (rows: string[]) => rows.map(r => { const [codes, colors] = r.split(' '); return `${codes} ${[...colors].map((c, i) => (codes.slice(i * 2, i * 2 + 2) === '20' ? '.' : c)).join('')}`; });
const text = (s: TapeScreen | DirScreen) => s.rows.map(r => screenRowText(r, s.lower));
const parts = (s: TapeScreen) => s.rows.map(r => s.parts[r.part]);

describe('the tape as a C64 finds its files', () => {
  it('prints the KERNAL\'s messages and a FOUND line per header, as VICE does, the names\' own codes acting', () => {
    // VICE's SEARCHING line has FOR ZZZ after it, the name LOAD was given
    const same = (s: TapeScreen, vice: string[]) => {
      const v = viceRows(vice);
      expect(text(s)[3]).toBe('SEARCHING');
      expect(v[3]).toMatch(/^130501120308090e0720060f12201a1a1a20/);
      expect(rowsOf(s).filter((_, i) => i !== 3)).toEqual(v.filter((_, i) => i !== 3));
    };
    same(tapeScreen(readTape(oddTape())), VICE_TAPE_SCREENS.odd);
    same(tapeScreen(readTape(fixture('tap/cyberload-demo.tap'))), VICE_TAPE_SCREENS.cyberloadDemo);
    same(tapeScreen(readTape(fixture('t64/mimir-demo.t64'))), VICE_TAPE_SCREENS.t64Demo);
    // CLR, cursor up, RETURN, DEL and lower case: the screen from its top after the CLR
    expect(rowsOf(tapeScreen(readTape(controlTape())))).toEqual(viceRows(VICE_TAPE_SCREENS.control));
  });

  it('says which file each FOUND is, and when a data block printed it', () => {
    const img = readTape(oddTape()), s = tapeScreen(img);
    expect(text(s).slice(0, 5)).toEqual(['PRESS PLAY ON TAPE', 'OK', '', 'SEARCHING', 'FOUND PLAIN']);
    expect(parts(s).slice(0, 4)).toEqual(Array(4).fill({ kind: 'kernal' }));
    const found = parts(s).slice(4).map(p => (p.kind === 'found' ? `${img.files[p.file].name}${p.data ? ' (data)' : ''}` : p.kind));
    // PLAIN's data block (1, 2, 3) is too short to reach the name: the header's is still there; DATA4's checksum is
    // its byte 5
    expect(found).toEqual(['PLAIN', 'PLAIN (data)', '·WHITE·BLUE', 'A"B·C', 'NOTES', 'DATA3', 'DATA3 (data)', 'DATA1', 'DATA1 (data)', 'DATA4', 'DATA4 (data)', '·RVS·OFF', 'ab··  SHIFT', 'WITH NO SPACES!!']);
    expect(text(s)[10]).toBe('FOUND SNEAKY THREE');
    expect(text(s)[14]).toBe('FOUND EATA4');
  });

  it('shows the screen from its top after a name\'s CLR, and the lower case set after a $0e', () => {
    const s = tapeScreen(readTape(controlTape()));
    // UP's X went up into CLEARED's row, and the $0e switched the whole screen to the lower case set
    expect(text(s)).toEqual(['cleared x', 'found ret', 'urn', 'found delx', 'found lower']);
    expect(s.lower).toBe(true);
    const cleared = tapeScreen(readTape(kernalTape([{ type: 3, name: asc('A'), data: [0] }, { type: 4, name: [0x93, 0x11, 0x11, ...asc('SIDE 1')] }])));
    expect(text(cleared)).toEqual(['', '', 'SIDE 1']);
    expect(parts(cleared)).toEqual(Array(3).fill({ kind: 'found', file: 1, data: false }));
  });

  it('passes over the end-of-tape marker, a data file\'s blocks and a turbo loader\'s files', () => {
    const s = tapeScreen(readTape(kernalTape([
      { type: 3, name: asc('ONE'), data: [0] }, { type: 5, name: [] }, { type: 4, name: asc('SEQ'), data: [3, 3, 3] }, { type: 1, name: asc('TWO'), load: 0x0801, data: [0x0b, 8] },
    ])));
    expect(text(s).slice(4)).toEqual(['FOUND ONE', 'FOUND SEQ', 'FOUND TWO']);
    // the Cyberload demo: its boot file, then turbo files the KERNAL does not read
    const img = readTape(fixture('tap/cyberload-demo.tap')), c = tapeScreen(img);
    expect(img.files.map(f => f.format)).toEqual(['cbm', 'cyberload', 'cyberload', 'cyberload', 'cyberload']);
    expect(new Set(parts(c).flatMap(p => (p.kind === 'found' ? [p.file] : [])))).toEqual(new Set([0]));
  });

  it('finds a T64\'s files by their entries, not its C64S snapshots', () => {
    const t64 = makeT64({ name: 'ARCHIVE', files: [{ name: 'GAME', load: 0x0801, data: Uint8Array.of(0) }, { name: 'SNAP', load: 0, data: Uint8Array.of(0), type: 3, fileType: 0 }, { name: 'EXTRA', load: 0xc000, data: Uint8Array.of(1) }] });
    const img = readTape(t64);
    expect(img.files.map(f => f.load)).toEqual([0x0801, null, 0xc000]);
    expect(text(tapeScreen(img)).slice(4)).toEqual(['FOUND GAME', 'FOUND EXTRA']);
  });
});

describe('the tape as a directory', () => {
  it("lists every file as the 1541 would, the turbo loaders' with a T, READY. and the cursor after them", () => {
    const img = readTape(fixture('tap/cyberload-demo.tap')), s = tapeDirectory(img, 'cyberload-demo.tap');
    // the ▁ (PETSCII $a4) for the _ in Mimir's names is a graphics character: · here
    expect(text(s)).toEqual(['0 "CYBERLOAD-DEMO  " 1:08', '1    "CYBER DEMO"       PRG', '4    "FILE·0002"       TPRG', '3    "FILE·C000"       TPRG',
      '3    "FILE·E000"       TPRG', '49   "DEMO"            TPRG', 'READY.', '']);
    // the disk's line in RVS after its 0
    expect([...s.rows[0].codes.slice(0, 3)]).toEqual([0x30, 0x20, 0xa2]);
    expect(s.rows.map(r => s.parts[r.part])).toEqual([{ kind: 'header' }, ...[0, 1, 2, 3, 4].map(file => ({ kind: 'entry', file })), { kind: 'ready' }, { kind: 'ready' }]);
    expect(s.cursor).toEqual({ row: 7, col: 0, color: 14 });
    // DEMO: 12 287 bytes and its load address, 49 blocks of 254
    expect(img.files[4].data.length).toBe(12287);
    expect(tapeDirEntry(img.files[4])).toMatchObject({ blocks: 49, splat: 0x54, type: 'PRG' });
  });

  it("ends a name at the KERNAL's padding, closes it at a quote, shows its control codes as LIST does, leaves out the end-of-tape marker", () => {
    const img = readTape(oddTape()), s = tapeDirectory(img, 'odd.tap');
    expect(text(s).slice(1, -2)).toEqual([
      '1    "PLAIN"            PRG',
      // in quotes the colour codes and RVS are shown inverse, as on a disk (white an inverse E)
      '1    "EWHITE·BLUE"      PRG',
      // the name's quote closes the quotes: the rest is out of them, its colour code turning the C to red
      '1    "A"BC             PRG',
      '1    "NOTES"            SEQ',
      '1    "DATA3"            PRG', '1    "DATA1"            PRG', '1    "DATA4"            PRG', '1    "RRVS·OFF"         PRG',
      // a shifted space ends the name, the bytes after it lose bit 7: the second a space
      '1    "···π" SHIFT       PRG',
      '1    "WITH NO SPACES!!" PRG',
    ]);
    expect([...s.rows[2].codes.slice(5, 7)]).toEqual([0x22, 0x85]);
    expect([...s.rows[3].colors.slice(8, 10)]).toEqual([14, 2]);
    expect(img.files.at(-1)?.type).toBe('END');
    expect(new Set(s.parts.flatMap(p => (p.kind === 'entry' ? [p.file] : [])))).toEqual(new Set(img.files.slice(0, -1).map((_, i) => i)));
  });

  it('counts blocks as a disk stores the file, with its load address', () => {
    const tape = (n: number, type: 3 | 4 = 3) => tapeDirEntry(readTape(kernalTape([{ type, name: asc('F'), data: new Array<number>(n).fill(1) }])).files[0]);
    expect([252, 253, 506, 507].map(n => tape(n)?.blocks)).toEqual([1, 2, 2, 3]);
    // a data file: no load address, the bytes of its data blocks (191 each on the tape)
    expect([191, 192, 573].map(n => tape(n, 4)?.blocks)).toEqual([1, 2, 3]);
    expect(tape(1, 4)?.type).toBe('SEQ');
  });

  it('names a TAP after its file, its length as the ID; a T64 by its own name, its C64S snapshots FRZ', () => {
    const odd = readTape(oddTape());
    expect(Math.floor(odd.seconds)).toBe(138);
    expect(text(tapeDirectory(odd, 'My_Tape.TAP'))[0]).toBe('0 "MY·TAPE         " 2:18');
    const t64 = makeT64({ name: 'ARCHIVE', files: [{ name: 'GAME', load: 0x0801, data: Uint8Array.of(0) }, { name: 'SNAP', load: 0, data: Uint8Array.of(0), type: 3, fileType: 0 }] });
    expect(text(tapeDirectory(readTape(t64), 'x.t64')).slice(0, 3)).toEqual(['0 "ARCHIVE         " T64', '1    "GAME"             PRG', '1    "SNAP"             FRZ']);
    expect(text(tapeDirectory(readTape(makeT64({ files: [{ name: 'GAME', load: 0x0801, data: Uint8Array.of(0) }] })), 'games.t64'))[0]).toBe('0 "GAMES           " T64');
  });
});
