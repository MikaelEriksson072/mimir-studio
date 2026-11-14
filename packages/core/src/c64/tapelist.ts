/* A tape as a C64 shows its files (Settings → General → As on a C64): a tape has no directory, so this is what the
 * KERNAL prints while LOAD searches the tape for a name none of its files has, from the tape's start to its end.
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
import { ScreenEditor, type DirScreenRow } from './dirlist';
import type { TapeImage } from './tap';

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
