/* A tape as a C64 shows its files (Settings → General → As on a C64), in two ways.
 *
 * As a directory (tapeDirectory, the Explorer's choice): a tape has none, so this is the directory its files would make
 * on a disk, listed as LOAD"$",8 and LIST list a disk's (dirlist.ts), as VICE lists a tape's contents when it is attached:
 *
 * - The disk's line: the tape's name (a T64's own, a TAP's file name) and its length (m:ss) where a disk has its ID.
 * - A line per file in tape order, the end-of-tape marker left out: its blocks as a 1541 would store it (the load address
 *   too, 254 bytes a block), its name (the spaces after it are the KERNAL's padding: they end it, as shifted spaces do
 *   on a disk), PRG or SEQ (a C64S snapshot in a T64: FRZ), with a T before the type for a turbo loader's file, which
 *   the KERNAL cannot load (VICE marks Turbo Tape's so). A file the tape gives no name: Mimir's name for it in upper
 *   case, ▁ for the _; data without a header: (NO HEADER).
 * - No BLOCKS FREE. line (VICE has none for a tape either), READY. after the last.
 *
 * As LOAD finds them (tapeScreen): what the KERNAL prints while LOAD searches the tape for a name none of its files
 * has, from the tape's start to its end.
 * Checked against x64sc 3.10 (true datasette emulation) with LOAD"ZZZ" on tapes with odd names:
 *
 * - PRESS PLAY ON TAPE, OK when PLAY is pressed, and SEARCHING, each after a RETURN (OK with one after it too), as the
 *   KERNAL's messages at $f0bd have them (the FOR and the name LOAD was given are left out).
 * - The KERNAL reads each block on the tape into the tape buffer at $033c and takes it for a header when its first
 *   byte is 1, 3 or 4 (a BASIC program, a program, a data file): FOUND after a RETURN, then bytes 5-20 of the buffer
 *   through CHROUT, all 16 of them, padding included, so a name's colour codes, RVS, quotes and cursor moves act as on
 *   the C64. A program's data block that starts with 1, 3 or 4 is taken for a header as well and prints a FOUND of its
 *   own: its bytes 5-20, or (a block shorter than 21 bytes) what the block wrote over the header before it, the
 *   checksum after its last byte.
 * - A data file's blocks (type 2) are passed over. The end-of-tape marker (type 5) ends the search (?DEVICE NOT PRESENT,
 *   as the KERNAL returns its type as the error); the screen goes on past it, as LOAD typed again would.
 * - A turbo loader's files are no KERNAL blocks: they are not on the screen. A T64's files are, as VICE finds them
 *   (its tape traps put each entry's header in the buffer), but not its C64S snapshots.
 */
import { directoryLines, fileLine, headerLine, listScreen, ScreenEditor, type DirPart, type DirScreen, type DirScreenRow } from './dirlist';
import type { TapeFile, TapeImage } from './tap';

/** a part of the screen: the KERNAL's own messages, or a FOUND line of a file (`img.files[file]`), `data` when its
 *  data block printed it */
export type TapePart = { kind: 'kernal' } | { kind: 'found'; file: number; data: boolean };

export interface TapeScreen {
  /** the rows from PRESS PLAY ON TAPE to the last FOUND */
  rows: DirScreenRow[];
  parts: TapePart[];
  /** the character set the names leave the screen in: the lower case one after a $0e */
  lower: boolean;
}

/** the block types the KERNAL takes for a header (FAH at $f72c) */
const HEADER = new Set([1, 3, 4]);

/** What the C64 shows of the tape's files: the KERNAL's FOUND lines as LOAD searches it to its end. */
export function tapeScreen(img: TapeImage): TapeScreen {
  const parts: TapePart[] = [{ kind: 'kernal' }];
  const s = new ScreenEditor();
  // the line LOAD was typed on, and its RETURN
  const typed = s.rows[0];
  s.out(0x0d);
  s.text('\rPRESS PLAY ON TAPE');
  s.text('\rOK\r');
  s.text('\rSEARCHING ');
  // the tape buffer, as the blocks leave it
  const buf = new Uint8Array(192).fill(0x20);
  const found = (file: number, data: boolean) => {
    parts.push({ kind: 'found', file, data });
    s.part = parts.length - 1;
    s.text('\rFOUND ');
    for (let i = 5; i < 21; i++) s.out(buf[i]);
  };
  /** a data block read into the buffer: as much as fits, and its checksum after it */
  const block = (data: Uint8Array) => {
    buf.set(data.subarray(0, 192));
    if (data.length < 192) buf[data.length] = data.reduce((x, v) => x ^ v, 0);
  };
  img.files.forEach((f, i) => {
    if (f.format === 't64') {
      if (f.load == null || !f.raw) return;
      buf.fill(0x20);
      buf[0] = 3;
      buf.set(f.raw.subarray(0, 16), 5);
      found(i, false);
      return;
    }
    if (f.format !== 'cbm') return;
    if (f.header) {
      buf.set(f.header.subarray(0, 192));
      if (HEADER.has(buf[0])) found(i, false);
    }
    if (f.type === 'SEQ' || f.type === 'END' || !f.data.length) return;
    block(f.data);
    if (HEADER.has(buf[0])) found(i, true);
  });
  // the rows LOAD was typed on and its RETURN went to are not shown, unless a name went back up and printed in them;
  // after a name's CLR the screen is shown from its top
  const from = s.rows[0] !== typed ? 0 : s.touched[0] ? 0 : s.touched[1] ? 1 : 2;
  return { rows: s.rows.slice(from), parts, lower: s.lower };
}

/* ---------------------------------------------------------------------------------------------------------------- */
/* the tape as a directory                                                                                          */

/** a tape file's line in the directory: its blocks, its 16 name bytes ($a0 after the name), the byte before the type
 *  (T: a turbo loader's file) and the type */
export interface TapeDirEntry { blocks: number; name: Uint8Array; splat: number; type: 'PRG' | 'SEQ' | 'FRZ' }

const PETSCII_UNDERLINE = 0xa4;

/** text as PETSCII upper case: letters to $41-$5a, _ to ▁, what PETSCII has no letter for to ? */
function petsciiText(s: string): number[] {
  return [...s].map(ch => {
    const c = ch.toUpperCase().charCodeAt(0);
    return ch === '_' ? PETSCII_UNDERLINE : c >= 0x20 && c <= 0x5d ? c : 0x3f;
  });
}

/** 16 name bytes: the spaces (and zeros) after the name are padding, shifted spaces as on a disk */
function nameBytes(raw: ArrayLike<number>): Uint8Array {
  const out = new Uint8Array(16).fill(0xa0);
  let n = Math.min(16, raw.length);
  while (n > 0 && (raw[n - 1] === 0x20 || raw[n - 1] === 0xa0 || raw[n - 1] === 0)) n--;
  for (let k = 0; k < n; k++) out[k] = raw[k];
  return out;
}

/** A tape file's line in the directory, null for the end-of-tape marker (the C64 lists nothing of it). */
export function tapeDirEntry(f: TapeFile): TapeDirEntry | null {
  if (f.format === 'cbm' && f.type === 'END') return null;
  const type = f.format === 't64' && f.load == null ? 'FRZ' : f.type === 'SEQ' || f.type === 'DATA' ? 'SEQ' : 'PRG';
  // a program on a disk starts with its load address
  const blocks = Math.ceil((f.data.length + (type === 'PRG' && f.load != null ? 2 : 0)) / 254);
  const name = nameBytes(f.raw ?? petsciiText(f.type === 'DATA' && f.format === 'cbm' ? '(NO HEADER)' : f.name));
  const splat = f.format === 'cbm' || f.format === 't64' ? 0x20 : 0x54;
  return { blocks, name, splat, type };
}

/** the tape's length as the directory's ID: m:ss */
const tapeLength = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/**
 * The tape's files as a directory a C64 lists (see the top): `name` is the tape's file name, the directory's name for
 * a TAP (and a T64 without one of its own). The parts' files are `img.files`'.
 */
export function tapeDirectory(img: TapeImage, name: string): DirScreen {
  const own = img.t64 && img.t64.name.trim() ? img.t64.raw.subarray(0, 16) : null;
  const title = own ? Array.from(own, b => (b === 0 ? 0x20 : b)) : petsciiText(name.replace(/\.(tap|t64)$/i, '').slice(0, 16));
  const id = petsciiText(img.t64 ? 'T64' : tapeLength(img.seconds));
  const lines: { n: number; text: number[]; part: DirPart }[] = [{ n: 0, text: headerLine(title, id), part: { kind: 'header' } }];
  img.files.forEach((f, file) => {
    const e = tapeDirEntry(f);
    if (e) lines.push({ n: e.blocks, text: fileLine(e.blocks, e.name, e.splat, petsciiText(e.type)), part: { kind: 'entry', file } });
  });
  return listScreen(directoryLines(lines));
}
