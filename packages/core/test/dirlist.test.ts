/* LOAD"$",8 and LIST as a C64 shows them, against x64sc 3.10's screen (true drive emulation) for disks with odd names. */
import { describe, expect, it } from 'vitest';
import { directoryProgram, directoryScreen, makeD64, parseD64, screenRowText, type DirScreen } from '../src';
import { sectorOffset } from '../src/c64/d64';
import { headerDisk, oddDisk, typesDisk } from './helpers/dirlist-disks';
import { VICE_SCREENS } from './helpers/dirlist-vice';

const hex = (a: ArrayLike<number>) => Array.from(a, b => b.toString(16).padStart(2, '0')).join('');

/** the screen's rows as VICE's are written: screen codes in hex, then the colours, a colour only where something is shown */
const rowsOf = (s: DirScreen) => s.rows.map(r => `${hex(r.codes)} ${Array.from(r.colors, (c, i) => (r.codes[i] === 0x20 ? '.' : c.toString(16))).join('')}`);
const viceRows = (rows: string[]) => rows.map(r => { const [codes, colors] = r.split(' '); return `${codes} ${[...colors].map((c, i) => (codes.slice(i * 2, i * 2 + 2) === '20' ? '.' : c)).join('')}`; });

/** the rows down to READY. (the cursor's row after it is not on VICE's list); the last `n` when VICE's screen scrolled */
const tail = (s: DirScreen, n: number) => rowsOf(s).slice(0, -1).slice(-n);

describe('directory listing', () => {
  it('lists names as the 1541 and LIST show them: shifted spaces, quotes, graphics, control codes, keywords', () => {
    const s = directoryScreen(oddDisk());
    expect(tail(s, 99)).toEqual(viceRows(VICE_SCREENS.odd));
    expect(s.cursor).toEqual({ row: s.rows.length - 1, col: 0, color: 1 });
    expect(s.lower).toBe(false);
  });

  it('lists types 5-7 as the 1541 does, their lines ending early, and a disk name that ends the quotes', () => {
    expect(tail(directoryScreen(typesDisk()), VICE_SCREENS.types.length)).toEqual(viceRows(VICE_SCREENS.types));
    expect(tail(directoryScreen(headerDisk()), 99)).toEqual(viceRows(VICE_SCREENS.header));
  });

  it('says which part of the listing each row is: the disk, a file of parseD64 (null for types 5-7), blocks free, READY', () => {
    const img = oddDisk(), s = directoryScreen(img), files = parseD64(img).files;
    const part = (row: number) => s.parts[s.rows[row].part];
    expect(part(0)).toEqual({ kind: 'header' });
    expect(part(1)).toEqual({ kind: 'entry', file: 0 });
    // the file with RETURN, DEL and cursor down in its name: four rows
    expect([5, 6, 7, 8].map(r => part(r))).toEqual(Array(4).fill({ kind: 'entry', file: 4 }));
    expect(files[4].blocks).toBe(0);
    // TYPE5 is not a file parseD64 lists; 65535 blocks is the one after it
    expect(part(17)).toEqual({ kind: 'entry', file: null });
    expect(part(18)).toEqual({ kind: 'entry', file: files.length - 1 });
    expect(files[files.length - 1].blocks).toBe(65535);
    expect(part(19)).toEqual({ kind: 'free' });
    expect(part(20)).toEqual({ kind: 'ready' });
    expect(screenRowText(s.rows[19])).toBe('630 BLOCKS FREE.');
  });

  it('writes the lines as LOAD"$",8 loads them', () => {
    const img = makeD64({ name: 'demo disk', id: 'mx', files: [{ name: 'hello', data: new Uint8Array(300) }] });
    const p = directoryProgram(img).bytes;
    const text = (from: number, to: number) => String.fromCharCode(...p.subarray(from, to));
    // the disk's line: link, line 0, RVS ON, the name in quotes, ID and DOS type
    expect([...p.subarray(0, 5)]).toEqual([1, 1, 0, 0, 0x12]);
    expect(text(5, 29)).toBe('"DEMO DISK       " MX 2A');
    // a file's line: link, blocks, the name in column 5, the type
    expect([...p.subarray(30, 34)]).toEqual([1, 1, 2, 0]);
    expect(text(34, 61)).toBe('   "HELLO"            PRG  ');
    expect(screenRowText(directoryScreen(img).rows[1])).toBe('2    "HELLO"            PRG');
    expect([...p.subarray(-2)]).toEqual([0, 0]);
  });

  it('switches to the lower case set on $0e out of quotes, and keeps going on a disk with no files', () => {
    const img = makeD64({ name: 'x', files: [] });
    const s = directoryScreen(img);
    expect(s.rows.map(r => screenRowText(r))).toEqual(['0 "X               " 01 2A', '664 BLOCKS FREE.', 'READY.', '']);
    // the bytes after a name's closing quote lose bit 7: $8e becomes $0e
    const d = oddDisk();
    d.set([0x4e, 0xa0, 0x8e], sectorOffset(18, 1, 35) + 5); // the first file: N, a shifted space, $8e
    expect(directoryScreen(d).lower).toBe(true);
    expect(screenRowText(directoryScreen(d).rows[1])).toBe('5    "N"MAL            PRG');
  });
});
