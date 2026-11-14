/* LOAD"$",8 and LIST on a C64: the directory as the 1541 sends it, a BASIC program, listed by BASIC and printed by the
 * screen editor, cell by cell, as the C64 shows it. Checked against x64sc 3.10 with true drive emulation (the 1541's own
 * ROM builds the lines), names full of shifted spaces, quotes, graphics and control codes, and file types 5-7:
 *
 * - The disk's line: RVS ON, the name in quotes and the ID with the DOS type, shifted spaces ($a0) as spaces; nothing
 *   else is changed, so a quote in the name ends BASIC's quotes and the bytes after it list as BASIC keywords.
 * - A file's line: its blocks as the line number, spaces so the quote is in column 5 (blocks < 10: 3, < 100: 2, else 1),
 *   the name: the first shifted space or quote in it becomes the closing quote (after the 16th byte when there is
 *   none), and the bytes after it lose bit 7. Then `*` for a file never closed, the type, and `<` for a locked one.
 *   The 1541 reads the type's three letters from three tables one after the other, so types 5-7 read on into the next
 *   table and past the last: two of them put a zero in the line, which ends it there, and BASIC's relinking makes
 *   lines of what follows.
 * - BLOCKS FREE. as the last line.
 *
 * LIST prints a RETURN before each line, its number and a space, then its bytes, keywords for the bytes from $80 out of
 * quotes; READY. after the last. The screen editor shows what is printed: quote mode (control codes in quotes are
 * shown inverse, RETURN and DEL still act), RVS ON until RETURN, the colour codes (the colour stays from line to line),
 * cursor moves, DEL and INST, the character set switches. */
import { diskBam, diskSectors, directoryEntries, directoryFile } from './d64';
import { monitorChar, petsciiToScreen } from './monitor';

/** a part of the listing: the disk's line, a directory entry (the file it is in `parseD64(...).files`, null for a type
 *  that list leaves out: 5-7), BLOCKS FREE. and READY. */
export type DirPart = { kind: 'header' } | { kind: 'entry'; file: number | null } | { kind: 'free' } | { kind: 'ready' };

/** a row of the C64's screen: 40 screen codes (the inverse ones with bit 7) and their colours, and the part of the
 *  listing that printed in it last */
export interface DirScreenRow { codes: Uint8Array; colors: Uint8Array; part: number }

export interface DirScreen {
  /** the rows from the first the listing printed in to the cursor's: the screen as it would be with room for all */
  rows: DirScreenRow[];
  parts: DirPart[];
  /** the character set the listing leaves the screen in: the lower case one after a $0e */
  lower: boolean;
  /** where the cursor is after READY., and its colour */
  cursor: { row: number; col: number; color: number };
}

/** the C64's colours when it starts: light blue text on blue, a light blue border */
export const C64_TEXT = 14, C64_BACKGROUND = 6, C64_BORDER = 14;

// the type names: the 1541 keeps their first, second and third letters in tables of five, one after the other, so a
// type 5-7 reads the next table's letters, and after the last table the ROM's bytes $08, $00, $00
const TYPE1 = [0x44, 0x53, 0x50, 0x55, 0x52, 0x45, 0x45, 0x52];
const TYPE2 = [0x45, 0x45, 0x52, 0x53, 0x45, 0x4c, 0x51, 0x47];
const TYPE3 = [0x4c, 0x51, 0x47, 0x52, 0x4c, 0x08, 0x00, 0x00];

/** what LIST prints for the bytes $80-$fe out of quotes: BASIC's keywords, then (its table read on) its error messages */
const WORDS = ('END FOR NEXT DATA INPUT# INPUT DIM READ LET GOTO RUN IF RESTORE GOSUB RETURN REM STOP ON WAIT LOAD SAVE VERIFY DEF POKE PRINT# PRINT CONT LIST CLR CMD SYS OPEN CLOSE GET NEW TAB( TO FN SPC( THEN NOT STEP + - * / ^ AND OR > = < SGN INT ABS USR FRE POS SQR RND LOG EXP COS SIN TAN ATN PEEK LEN STR$ VAL ASC CHR$ LEFT$ RIGHT$ MID$ GO'.split(' '))
  .concat(['TOO MANY FILES', 'FILE OPEN', 'FILE NOT OPEN', 'FILE NOT FOUND', 'DEVICE NOT PRESENT', 'NOT INPUT FILE', 'NOT OUTPUT FILE', 'MISSING FILE NAME', 'ILLEGAL DEVICE NUMBER', 'NEXT WITHOUT FOR', 'SYNTAX', 'RETURN WITHOUT GOSUB', 'OUT OF DATA', 'ILLEGAL QUANTITY', 'OVERFLOW', 'OUT OF MEMORY', "UNDEF'D STATEMENT", 'BAD SUBSCRIPT', "REDIM'D ARRAY", 'DIVISION BY ZERO', 'ILLEGAL DIRECT', 'TYPE MISMATCH', 'STRING TOO LONG', 'FILE DATA', 'FORMULA TOO COMPLEX', "CAN'T CONTINUE", "UNDEF'D FUNCTION", 'VERIFY', 'LOAD']);

const ascii = (s: string) => [...s].map(c => c.charCodeAt(0));

/** A directory entry's line as the 1541 writes it: 27 bytes after the blocks. */
function entryText(u8: Uint8Array, p: number): number[] {
  const kind = u8[p + 2], blocks = u8[p + 30] | (u8[p + 31] << 8);
  const t = new Array<number>(27).fill(0x20);
  const q = blocks < 10 ? 3 : blocks < 100 ? 2 : 1;
  t[q] = 0x22;
  const name = u8.subarray(p + 5, p + 21);
  let end = name.findIndex(b => b === 0xa0 || b === 0x22);
  if (end < 0) { end = 16; t[q + 17] = 0x22; }
  for (let k = 0; k < 16; k++) t[q + 1 + k] = k < end ? name[k] : k === end ? 0x22 : name[k] & 0x7f;
  if (!(kind & 0x80)) t[q + 18] = 0x2a;
  t[q + 19] = TYPE1[kind & 7]; t[q + 20] = TYPE2[kind & 7]; t[q + 21] = TYPE3[kind & 7];
  if (kind & 0x40) t[q + 22] = 0x3c;
  return t;
}

/**
 * The directory as LOAD"$",8 loads it at $0801: a BASIC line per entry after the disk's own, BLOCKS FREE. last, each
 * line's link $0101 as the 1541 sends it. `part`: the part of the listing each byte is from.
 */
export function directoryProgram(image: Uint8Array): { bytes: Uint8Array; part: Uint16Array; parts: DirPart[] } {
  const u8 = diskSectors(image);
  const { bam, freeBlocks } = diskBam(u8);
  const bytes: number[] = [], part: number[] = [];
  const parts: DirPart[] = [{ kind: 'header' }];
  const line = (n: number, text: number[], k: number) => { for (const b of [1, 1, n & 255, n >> 8, ...text, 0]) { bytes.push(b); part.push(k); } };
  const spaced = (a: number, n: number) => [...bam.subarray(a, a + n)].map(b => (b === 0xa0 ? 0x20 : b));
  line(0, [0x12, 0x22, ...spaced(0x90, 16), 0x22, 0x20, ...spaced(0xa2, 5)], 0);
  let file = 0;
  for (const p of directoryEntries(u8)) {
    parts.push({ kind: 'entry', file: directoryFile(u8, p) ? file++ : null });
    line(u8[p + 30] | (u8[p + 31] << 8), entryText(u8, p), parts.length - 1);
  }
  parts.push({ kind: 'free' });
  line(freeBlocks, [...ascii('BLOCKS FREE.'), ...new Array<number>(13).fill(0x20)], parts.length - 1);
  bytes.push(0, 0); part.push(parts.length - 1, parts.length - 1);
  return { bytes: Uint8Array.from(bytes), part: Uint16Array.from(part), parts };
}

const COLOR_CODES: Record<number, number> = { 0x05: 1, 0x1c: 2, 0x1e: 5, 0x1f: 6, 0x81: 8, 0x90: 0, 0x95: 9, 0x96: 10, 0x97: 11, 0x98: 12, 0x99: 13, 0x9a: 14, 0x9b: 15, 0x9c: 4, 0x9e: 7, 0x9f: 3 };

/** The C64's screen editor as CHROUT drives it, on a screen that grows downwards instead of scrolling (the tape's
 *  screen, tapelist.ts, prints with it too). */
export class ScreenEditor {
  rows: DirScreenRow[] = [];
  /** the rows that go on from the row above: a logical line of two rows */
  cont: boolean[] = [];
  row = 0; col = 0; color = C64_TEXT; rvs = false; quote = false; insert = 0; lower = false;
  /** the part of the listing printing now */
  part = 0;
  touched: boolean[] = [];

  constructor() { this.add(0); }
  private add(at: number, cont = false) {
    this.rows.splice(at, 0, { codes: new Uint8Array(40).fill(0x20), colors: new Uint8Array(40).fill(C64_TEXT), part: this.part });
    this.cont.splice(at, 0, cont); this.touched.splice(at, 0, false);
  }
  private goRow(r: number) { while (this.rows.length <= r) this.add(this.rows.length); this.row = r; }
  /** the top of the 25 rows on the screen: HOME and cursor up go no higher */
  private get top() { return Math.max(0, this.rows.length - 25); }
  /** the rows of the logical line the cursor is in */
  private line(): [number, number] {
    const start = this.cont[this.row] ? this.row - 1 : this.row;
    return [start, this.cont[start + 1] ? start + 1 : start];
  }
  private cell(i: number, start: number): [DirScreenRow, number] { return [this.rows[start + Math.floor(i / 40)], i % 40]; }
  private mark(r: number) { this.rows[r].part = this.part; this.touched[r] = true; }

  private put(code: number) {
    if (this.rvs) code |= 0x80;
    const r = this.rows[this.row];
    r.codes[this.col] = code; r.colors[this.col] = this.color; this.mark(this.row);
    if (this.insert > 0) this.insert--;
    if (++this.col < 40) return;
    this.col = 0;
    // past the 40th column: the logical line goes on in a row of its own (inserted when the next row holds a line), or a
    // full two-row line ends and the next row starts a new one
    if (!this.cont[this.row]) { this.add(this.row + 1, true); this.row++; } else this.goRow(this.row + 1);
  }
  /** a control code in quotes (or after INST): shown as an inverse character */
  private putControl(c: number) { this.put((c < 0x80 ? c : c - 0x40) | 0x80); }

  private ret() {
    this.quote = false; this.rvs = false; this.insert = 0;
    const [, end] = this.line();
    this.goRow(end + 1); this.col = 0;
    if (!this.touched[this.row]) this.rows[this.row].part = this.part;
  }
  private del() {
    const [start, end] = this.line();
    const i = (this.row - start) * 40 + this.col;
    if (i === 0) return;
    const n = (end - start + 1) * 40;
    for (let k = i - 1; k < n - 1; k++) { const [a, x] = this.cell(k, start), [b, y] = this.cell(k + 1, start); a.codes[x] = b.codes[y]; a.colors[x] = b.colors[y]; }
    const [last, z] = this.cell(n - 1, start); last.codes[z] = 0x20; last.colors[z] = this.color;
    this.row = start + Math.floor((i - 1) / 40); this.col = (i - 1) % 40;
    for (let r = start; r <= end; r++) this.mark(r);
  }
  private inst() {
    const [start, end] = this.line();
    const i = (this.row - start) * 40 + this.col, n = (end - start + 1) * 40;
    for (let k = n - 1; k > i; k--) { const [a, x] = this.cell(k, start), [b, y] = this.cell(k - 1, start); a.codes[x] = b.codes[y]; a.colors[x] = b.colors[y]; }
    const [r, x] = this.cell(i, start); r.codes[x] = 0x20; r.colors[x] = this.color;
    this.insert++;
    for (let k = start; k <= end; k++) this.mark(k);
  }

  out(c: number) {
    if (c === 0x0d || c === 0x8d) { this.ret(); return; }
    const sc = petsciiToScreen(c);
    if (sc != null) {
      if (c === 0x22) this.quote = !this.quote;
      this.put(sc); return;
    }
    // a control code: shown inverse after INST and (but DEL) in quotes
    if (this.insert > 0 || (this.quote && c !== 0x14)) { this.putControl(c); return; }
    const color = COLOR_CODES[c];
    if (color != null) { this.color = color; return; }
    switch (c) {
      case 0x0e: this.lower = true; break;
      case 0x8e: this.lower = false; break;
      case 0x12: this.rvs = true; break;
      case 0x92: this.rvs = false; break;
      case 0x11: this.goRow(this.row + 1); break;
      case 0x91: if (this.row > this.top) this.row--; break;
      case 0x1d: if (++this.col === 40) { this.col = 0; this.goRow(this.row + 1); } break;
      case 0x9d: if (this.col > 0) this.col--; else if (this.row > this.top) { this.row--; this.col = 39; } break;
      case 0x13: this.row = this.top; this.col = 0; break;
      case 0x93: this.rows = []; this.cont = []; this.touched = []; this.add(0); this.row = 0; this.col = 0; break;
      case 0x14: this.del(); break;
      case 0x94: this.inst(); break;
    }
  }
  text(s: string) { for (const c of ascii(s)) this.out(c); }
}

/**
 * LOAD"$",8 and LIST: the screen the directory of a .d64 (or a .g64) makes on a C64, from the first row the listing
 * prints in to the cursor's after READY.
 */
export function directoryScreen(image: Uint8Array): DirScreen {
  const { bytes, part, parts } = directoryProgram(image);
  const at = (i: number) => (i < bytes.length ? bytes[i] : 0);
  const partAt = (i: number) => part[Math.min(i, part.length - 1)];
  // LOAD relinks the lines: each ends at the first zero from its sixth byte on, until a link's high byte is zero
  const starts: number[] = [];
  for (let p = 0; at(p + 1) !== 0 && starts.length < 4096;) {
    starts.push(p);
    let y = 5;
    while (at(p + y) !== 0 && y < 255) y++;
    p += y + 1;
  }
  const s = new ScreenEditor();
  for (const p of starts) {
    s.part = partAt(p);
    s.out(0x0d);
    s.part = partAt(p + 2);
    s.text(`${at(p + 2) | (at(p + 3) << 8)} `);
    let quoted = false;
    for (let y = 4; y < 256; y++) {
      const c = at(p + y);
      if (c === 0) break;
      s.part = partAt(p + y);
      if (c >= 0x80 && c !== 0xff && !quoted) { s.text(WORDS[c - 0x80] ?? ''); continue; }
      s.out(c);
      if (c === 0x22) quoted = !quoted;
    }
  }
  parts.push({ kind: 'ready' });
  s.part = parts.length - 1;
  s.out(0x0d); s.text('READY.'); s.out(0x0d);
  // the row LIST was typed in is not shown, unless the listing went back up and printed in it
  const from = s.touched[0] ? 0 : 1;
  return { rows: s.rows.slice(from), parts, lower: s.lower, cursor: { row: s.row - from, col: s.col, color: s.color } };
}

/** A row of the screen as text: the characters the C64 shows, `·` for a graphics character. */
export const screenRowText = (r: DirScreenRow, lower = false): string => [...r.codes].map(c => monitorChar(c, true, lower)?.ch ?? '·').join('').trimEnd();
