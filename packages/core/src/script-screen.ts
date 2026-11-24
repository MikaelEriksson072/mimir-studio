/* =====================================================================
 * A script's C64 screen (spec 10.3): a text screen of the C64's, 40 columns and 25 rows (more in the Scripts tab's
 * extended mode, never fewer), that a script prints on as a C64 program does. The screen editor here is the KERNAL's
 * as CHROUT drives it: PETSCII printed at the cursor, the colour codes, RVS ON and OFF, CLR and HOME, the cursor
 * moves, DEL and INST, quote mode, the two character sets, logical lines of two rows, and the screen scrolling up a
 * logical line when the cursor goes past its last row. A clear fills the colour RAM with the cursor's colour, as the
 * C64's later KERNALs (VICE's) do.
 *
 * Who prints on it:
 * - a JavaScript script, through `screen` (screenApi: print, write, chrout, at, colours, poke, show, charset);
 * - a script in assembler that runs in memory only, through the KERNAL's and BASIC's own entries that print, which
 *   its run does itself when the program has no bytes there (screenTraps, screenRoutine): CHROUT ($ffd2), the
 *   screen editor's output ($e716), clear ($e544) and home ($e566), PLOT ($fff0), STROUT ($ab1e: a text up to a zero
 *   byte, at A/Y) and LINPRT ($bdcd: the number in A/X); also when the program's own code calls them (cpu.call);
 * - a script that runs in the whole C64: its screen is the C64's own, as the VIC shows it (c64TextScreen).
 *
 * In a run in memory (in assembler or in JavaScript) the screen is also in the memory, where the C64 has it
 * (screenMemory): the screen matrix at $0400-$07e7, the colour RAM at $d800-$dbe7 and the VIC's border and background
 * colours at $d020 and $d021, so that `sta $0400,x` puts a character on it, `sta $d800,x` colours it, `lda $0400` reads
 * what CHROUT printed and `mem[0x0400]` in JavaScript is the screen's first cell. Each part is where no file of the
 * program and no scratchpad has bytes (a program that loads over $0400 keeps its bytes as its own); a run starts it
 * as a cleared screen. On a screen larger than the C64's (extended mode) the memory is its top left 40×25 cells, a row
 * of 40 after another, as on the C64.
 *
 * What a run leaves on it is a ScriptScreen, kept with the run (ScriptRun.screen) and drawn by the Scripts tab.
 * ===================================================================== */
import type { C64 } from '@mimir/sindri';
import { C64_BACKGROUND, C64_BORDER, C64_TEXT } from './c64/dirlist';
import { petsciiToScreen } from './c64/monitor';

/** a screen's size in characters */
export interface ScreenSize { cols: number; rows: number }
/** the C64's own screen */
export const SCREEN_C64: Readonly<ScreenSize> = { cols: 40, rows: 25 };
/** the largest screen extended mode gives a script */
export const SCREEN_MAX: Readonly<ScreenSize> = { cols: 240, rows: 120 };

/** A size as a script's screen can have it: whole characters, from 40×25 up to SCREEN_MAX. */
export const screenSize = (s?: Partial<ScreenSize> | null): ScreenSize => ({
  cols: Math.max(SCREEN_C64.cols, Math.min(SCREEN_MAX.cols, Math.floor(Number(s?.cols) || SCREEN_C64.cols))),
  rows: Math.max(SCREEN_C64.rows, Math.min(SCREEN_MAX.rows, Math.floor(Number(s?.rows) || SCREEN_C64.rows))),
});

/** What a run left on its screen: the screen codes (bit 7: inverse) and colours of every cell, a row after another,
 *  the border and background colours, the character set, and the cursor. */
export interface ScriptScreen {
  cols: number;
  rows: number;
  codes: Uint8Array;
  colors: Uint8Array;
  border: number;
  background: number;
  /** the lower case character set (Commodore+Shift) */
  lower: boolean;
  /** the character set's 2 KB when it is not the ROM's (the program's own, in RAM) */
  font?: Uint8Array;
  /** where the cursor is, and its colour (null: none is shown, as on a C64 that is busy) */
  cursor: { col: number; row: number; color: number } | null;
  /** the run printed or drew on it (false: it is as it was when the run started) */
  wrote: boolean;
  /** the screen is the whole C64's, as its VIC shows it (a run in the whole C64) */
  c64?: boolean;
}

/** The C64's colours by name (what `screen.color = "light blue"` takes), 0-15. */
export const C64_COLOR_NAMES: readonly string[] = ['black', 'white', 'red', 'cyan', 'purple', 'green', 'blue', 'yellow', 'orange', 'brown', 'light red', 'dark grey', 'grey', 'light green', 'light blue', 'light grey'];
const COLOR_ALIASES: Record<string, number> = { violet: 4, pink: 10, darkgray: 11, gray: 12, mediumgrey: 12, mediumgray: 12, lightgray: 15 };

/** A colour as a script gives it: 0-15, or a name ("light blue", "lightBlue", "light_grey"). Throws for anything else. */
export function c64Color(v: unknown, what = 'colour'): number {
  if (typeof v === 'number' && Number.isInteger(v)) return v & 15;
  const k = String(v).toLowerCase().replace(/[\s_-]+/g, '');
  const i = C64_COLOR_NAMES.findIndex(n => n.replace(/ /g, '') === k);
  if (i >= 0) return i;
  if (k in COLOR_ALIASES) return COLOR_ALIASES[k];
  throw new TypeError(`${what}: "${String(v)}" is no colour of the C64's: 0-15, or ${C64_COLOR_NAMES.map(n => `"${n}"`).join(', ')}`);
}

const COLOR_CODES: Record<number, number> = { 0x05: 1, 0x1c: 2, 0x1e: 5, 0x1f: 6, 0x81: 8, 0x90: 0, 0x95: 9, 0x96: 10, 0x97: 11, 0x98: 12, 0x99: 13, 0x9a: 14, 0x9b: 15, 0x9c: 4, 0x9e: 7, 0x9f: 3 };
/** characters of a text that are not in ASCII's printable range, as PETSCII: the pound, the arrows, pi, the card
 *  suits and the line graphics (both character sets have them) */
const UNICODE: Record<string, number> = {
  '£': 0x5c, '↑': 0x5e, '←': 0x5f, 'π': 0xff, '♠': 0xc1, '♥': 0xd3, '♣': 0xd8, '♦': 0xda, '●': 0xd1, '○': 0xd7,
  '─': 0xc0, '│': 0xdd, '┼': 0xdb, '┌': 0xb0, '┐': 0xae, '└': 0xad, '┘': 0xbd, '├': 0xab, '┤': 0xb3, '┬': 0xb2, '┴': 0xb1,
  '▌': 0xa1, '▄': 0xa2, '▔': 0xa3, '▁': 0xa4, '▏': 0xa5, '▒': 0xa6, '▕': 0xa7, '▐': 0xb6, '▀': 0xb8, '▂': 0xaf, '▖': 0xbb, '▗': 0xac, '▘': 0xbe, '▝': 0xbc, '▚': 0xbf,
};

/**
 * The PETSCII a character of a text prints as, in the character set the screen has: letters as letters in either set
 * (capitals in the lower case set are the shifted codes), `_` as the low line, control characters (\x00-\x1f,
 * \x80-\x9f) as the PETSCII control codes they are (\x93 CLR, \x1c red, \x12 RVS ON); RETURN for a line end. null: a
 * character the C64 has no letter for (printed as `?`).
 */
export function textPetscii(ch: string, lower: boolean): number | null {
  const c = ch.charCodeAt(0);
  if (ch === '\n' || ch === '\r') return 0x0d;
  if (c < 0x20 || (c >= 0x80 && c < 0xa0)) return c;
  if (c >= 0x61 && c <= 0x7a) return c - 0x20;
  if (c >= 0x41 && c <= 0x5a) return lower ? c + 0x80 : c;
  if (c >= 0x20 && c <= 0x5d && c !== 0x5c) return c;
  switch (ch) {
    case '^': return 0x5e;
    case '_': return 0xa4;
    case '|': return 0xdd;
    case '{': return 0x28;
    case '}': return 0x29;
    case '`': return 0x27;
    case '~': return 0x2d;
    case '\\': return 0x2f;
  }
  return UNICODE[ch] ?? null;
}

/** Where a run in memory has its screen in its memory, as the C64 has it: the screen matrix (1000 screen codes), the
 *  colour RAM (their 1000 colours), and the VIC's border and background colour registers. */
export const SCREEN_RAM = 0x0400, COLOR_RAM = 0xd800, BORDER_AT = 0xd020, BACKGROUND_AT = 0xd021;

/** A run's memory with which parts of the C64's screen are in it (screenMemory): the screen matrix at SCREEN_RAM, the
 *  colour RAM at COLOR_RAM, the border and background at BORDER_AT and BACKGROUND_AT. */
export interface ScreenMemory { mem: Uint8Array; screen: boolean; color: boolean; regs: boolean }

/** The parts of the C64's screen a run in memory has in `mem`: each where no file of the program and no scratchpad
 *  has bytes (a program that loads over the screen keeps its bytes as its own). */
export function screenMemory(mem: Uint8Array, files: readonly { load: number; bytes: Uint8Array }[], pads: readonly { start: number; size: number }[] = []): ScreenMemory {
  const free = (s: number, e: number) => !files.some(f => f.load < e && s < f.load + f.bytes.length) && !pads.some(p => p.start < e && s < p.start + p.size);
  return { mem, screen: free(SCREEN_RAM, SCREEN_RAM + 1000), color: free(COLOR_RAM, COLOR_RAM + 1000), regs: free(BORDER_AT, BACKGROUND_AT + 1) };
}

/** The addresses of the screen's parts in the memory (none: a run without them), end excluded: what a run wrote there
 *  is on the screen, not among the bytes it changed. */
export function screenRanges(m: ScreenMemory | null | undefined): { start: number; end: number }[] {
  if (!m) return [];
  return [
    ...(m.screen ? [{ start: SCREEN_RAM, end: SCREEN_RAM + 1000 }] : []),
    ...(m.regs ? [{ start: BORDER_AT, end: BACKGROUND_AT + 1 }] : []),
    ...(m.color ? [{ start: COLOR_RAM, end: COLOR_RAM + 1000 }] : []),
  ];
}

/** The screen's parts in the memory as a run starts them: a cleared screen, spaces in light blue, the C64's border
 *  and background. */
export function startScreenMemory(m: ScreenMemory): void {
  if (m.screen) m.mem.fill(0x20, SCREEN_RAM, SCREEN_RAM + 1000);
  if (m.color) m.mem.fill(C64_TEXT, COLOR_RAM, COLOR_RAM + 1000);
  if (m.regs) { m.mem[BORDER_AT] = C64_BORDER; m.mem[BACKGROUND_AT] = C64_BACKGROUND; }
}

/**
 * The KERNAL's screen editor on a screen of `cols` × `rows`, as CHROUT drives it. With `memory` (a run in memory) the
 * screen is also in the memory (screenMemory): a 40×25 screen's cells are the memory's bytes at $0400 and $d800, and
 * a larger screen has its top left 40×25 there, kept in step with sync().
 */
export class TextScreen {
  readonly cols: number;
  readonly rows: number;
  readonly codes: Uint8Array;
  readonly colors: Uint8Array;
  /** the run's memory the screen is in (null: none) */
  readonly memory: ScreenMemory | null;
  /** 1: the row goes on from the row above (the second row of a logical line) */
  private readonly link: Uint8Array;
  col = 0; row = 0; color = C64_TEXT;
  rvs = false; lower = false; quote = false; insert = 0;
  font: Uint8Array | null = null;
  private bord = C64_BORDER;
  private back = C64_BACKGROUND;
  private drew = false;
  /** a screen larger than 40×25 in the memory: the screen's memory as it was when last in step (codes, then colours) */
  private readonly last: Uint8Array | null = null;

  constructor(size: Partial<ScreenSize> = SCREEN_C64, memory: ScreenMemory | null = null) {
    const { cols, rows } = screenSize(size);
    this.cols = cols; this.rows = rows; this.memory = memory;
    const m = memory, c64 = cols === SCREEN_C64.cols && rows === SCREEN_C64.rows;
    // (the C64's size: the cells are the memory's own bytes)
    this.codes = m?.screen && c64 ? m.mem.subarray(SCREEN_RAM, SCREEN_RAM + 1000) : new Uint8Array(cols * rows);
    this.colors = m?.color && c64 ? m.mem.subarray(COLOR_RAM, COLOR_RAM + 1000) : new Uint8Array(cols * rows);
    this.codes.fill(0x20); this.colors.fill(C64_TEXT);
    this.link = new Uint8Array(rows);
    if (m) {
      startScreenMemory(m);
      if (!c64 && (m.screen || m.color)) { this.last = new Uint8Array(2000); this.sync(); }
    }
  }

  /** the border's and the background's colours (in the memory at $d020 and $d021 when the screen is there) */
  get border(): number { const m = this.memory; return m?.regs ? m.mem[BORDER_AT] & 15 : this.bord; }
  set border(v: number) { const m = this.memory; if (m?.regs) m.mem[BORDER_AT] = v & 15; else this.bord = v & 15; }
  get background(): number { const m = this.memory; return m?.regs ? m.mem[BACKGROUND_AT] & 15 : this.back; }
  set background(v: number) { const m = this.memory; if (m?.regs) m.mem[BACKGROUND_AT] = v & 15; else this.back = v & 15; }

  /** something was printed or drawn on it, or written into its memory (it is not as the run started it) */
  get wrote(): boolean { return this.drew || this.memoryWrote(); }
  set wrote(v: boolean) { this.drew = v; }
  private memoryWrote(): boolean {
    const m = this.memory;
    if (!m) return false;
    const mem = m.mem;
    if (m.screen) for (let a = SCREEN_RAM; a < SCREEN_RAM + 1000; a++) if (mem[a] !== 0x20) return true;
    if (m.color) for (let a = COLOR_RAM; a < COLOR_RAM + 1000; a++) if ((mem[a] & 15) !== C64_TEXT) return true;
    return m.regs && ((mem[BORDER_AT] & 15) !== C64_BORDER || (mem[BACKGROUND_AT] & 15) !== C64_BACKGROUND);
  }

  /**
   * A screen larger than 40×25 and its memory in step: what was written into the memory since the last time onto
   * the screen's top left 40×25, then those cells into the memory. Called before and after whatever prints on it or
   * reads it (screenRoutine, screenApi) and by state(). Nothing to do for a 40×25 screen, whose cells are the memory.
   */
  sync(): void {
    const m = this.memory, last = this.last;
    if (!m || !last) return;
    const w = this.cols, mem = m.mem;
    const parts = [[m.screen, SCREEN_RAM, this.codes, 0], [m.color, COLOR_RAM, this.colors, 1000]] as const;
    for (const [on, at, cells, off] of parts) {
      if (!on) continue;
      for (let i = 0; i < 1000; i++) { const v = mem[at + i]; if (v !== last[off + i]) cells[((i / 40) | 0) * w + (i % 40)] = v; }
      for (let r = 0; r < 25; r++) mem.set(cells.subarray(r * w, r * w + 40), at + r * 40);
      last.set(mem.subarray(at, at + 1000), off);
    }
  }

  /** the rows of the logical line the cursor is in */
  private line(): [number, number] {
    const start = this.link[this.row] ? this.row - 1 : this.row;
    return [start, start + 1 < this.rows && this.link[start + 1] ? start + 1 : start];
  }
  /** the screen up by the top logical line's rows; how many */
  private scroll(): number {
    const n = this.rows > 1 && this.link[1] ? 2 : 1, w = this.cols;
    this.codes.copyWithin(0, n * w); this.colors.copyWithin(0, n * w);
    this.codes.fill(0x20, (this.rows - n) * w); this.colors.fill(this.color, (this.rows - n) * w);
    this.link.copyWithin(0, n); this.link.fill(0, this.rows - n); this.link[0] = 0;
    return n;
  }
  /** the cursor to the start of the row below `r`: the screen scrolls when that is past its last */
  private down(r: number): void {
    let to = r + 1;
    if (to >= this.rows) to -= this.scroll();
    this.row = Math.max(0, to);
  }
  /** a blank row put in below `r` that goes on from it (what is below moves down; the last row is lost) */
  private grow(r: number): void {
    if (r + 1 >= this.rows) { r -= this.scroll(); }
    const w = this.cols, at = (r + 1) * w;
    this.codes.copyWithin(at + w, at, (this.rows - 1) * w); this.colors.copyWithin(at + w, at, (this.rows - 1) * w);
    this.link.copyWithin(r + 2, r + 1, this.rows - 1);
    this.codes.fill(0x20, at, at + w); this.colors.fill(this.color, at, at + w);
    this.link[r + 1] = 1;
    this.row = r + 1;
  }
  private cell(i: number, start: number): number { return start * this.cols + i; }

  /** a screen code at the cursor, and the cursor on */
  private put(code: number): void {
    if (this.rvs) code |= 0x80;
    const i = this.row * this.cols + this.col;
    this.codes[i] = code; this.colors[i] = this.color; this.wrote = true;
    if (this.insert > 0) this.insert--;
    if (++this.col < this.cols) return;
    this.col = 0;
    // past the last column: the first row of a logical line goes on in a row of its own; a full two-row line ends
    if (!this.link[this.row]) this.grow(this.row);
    else { this.down(this.row); this.link[this.row] = 0; }
  }

  /** RETURN: the cursor to the start of the row after its logical line; quotes, RVS and inserts end */
  private ret(): void {
    this.quote = false; this.rvs = false; this.insert = 0;
    const [, end] = this.line();
    this.down(end); this.col = 0;
  }
  private del(): void {
    const [start, end] = this.line();
    const i = (this.row - start) * this.cols + this.col;
    if (i === 0) return;
    const n = (end - start + 1) * this.cols, base = this.cell(0, start);
    this.codes.copyWithin(base + i - 1, base + i, base + n); this.colors.copyWithin(base + i - 1, base + i, base + n);
    this.codes[base + n - 1] = 0x20; this.colors[base + n - 1] = this.color;
    this.row = start + Math.floor((i - 1) / this.cols); this.col = (i - 1) % this.cols;
    this.wrote = true;
  }
  private inst(): void {
    const [start, end] = this.line();
    const i = (this.row - start) * this.cols + this.col, n = (end - start + 1) * this.cols, base = this.cell(0, start);
    this.codes.copyWithin(base + i + 1, base + i, base + n - 1); this.colors.copyWithin(base + i + 1, base + i, base + n - 1);
    this.codes[base + i] = 0x20; this.colors[base + i] = this.color;
    this.insert++; this.wrote = true;
  }

  /** One byte printed as CHROUT prints it. */
  out(c: number): void {
    c &= 0xff;
    if (c === 0x0d || c === 0x8d) { this.ret(); return; }
    const sc = petsciiToScreen(c);
    if (sc != null) {
      if (c === 0x22) this.quote = !this.quote;
      this.put(sc); return;
    }
    // a control code: shown inverse after INST and (but DEL) in quotes
    if (this.insert > 0 || (this.quote && c !== 0x14)) { this.put((c < 0x80 ? c : c - 0x40) | 0x80); return; }
    const color = COLOR_CODES[c];
    if (color != null) { this.color = color; return; }
    switch (c) {
      case 0x0e: this.lower = true; this.wrote = true; break;
      case 0x8e: this.lower = false; this.wrote = true; break;
      case 0x12: this.rvs = true; break;
      case 0x92: this.rvs = false; break;
      case 0x11: this.down(this.row); break;
      case 0x91: if (this.row > 0) this.row--; break;
      case 0x1d: if (++this.col === this.cols) { this.col = 0; this.down(this.row); } break;
      case 0x9d: if (this.col > 0) this.col--; else if (this.row > 0) { this.row--; this.col = this.cols - 1; } break;
      case 0x13: this.home(); break;
      case 0x93: this.clear(); break;
      case 0x14: this.del(); break;
      case 0x94: this.inst(); break;
    }
  }
  /** A text printed: each character as the PETSCII it is in the character set the screen has then (textPetscii). */
  text(s: string): void {
    let cr = false;
    for (const ch of s) {
      if (ch === '\n' && cr) { cr = false; continue; }
      cr = ch === '\r';
      this.out(textPetscii(ch, this.lower) ?? 0x3f);
    }
  }
  /** CLR: spaces in the cursor's colour, the cursor home */
  clear(): void {
    this.codes.fill(0x20); this.colors.fill(this.color); this.link.fill(0);
    this.home(); this.wrote = true;
  }
  home(): void { this.row = 0; this.col = 0; }
  /** the cursor to a cell (PLOT) */
  at(col: number, row: number): void {
    this.col = Math.max(0, Math.min(this.cols - 1, Math.floor(col) || 0));
    this.row = Math.max(0, Math.min(this.rows - 1, Math.floor(row) || 0));
  }
  /** a screen code (and a colour) into a cell, as a POKE into the screen and the colour RAM does */
  poke(col: number, row: number, code: number, color?: number): void {
    if (!(col >= 0 && col < this.cols && row >= 0 && row < this.rows)) return;
    const i = Math.floor(row) * this.cols + Math.floor(col);
    this.codes[i] = code & 0xff;
    if (color != null) this.colors[i] = color & 15;
    this.wrote = true;
  }
  /** A screen of `w` × `h` (screen codes a row after another, and their colours; none: the cursor's colour) put at
   *  the top left: what is outside this screen is left out. */
  show(codes: ArrayLike<number>, colors: ArrayLike<number> | null, w = SCREEN_C64.cols, h = SCREEN_C64.rows): void {
    for (let r = 0; r < Math.min(h, this.rows); r++) for (let c = 0; c < Math.min(w, this.cols); c++) {
      const k = r * w + c, i = r * this.cols + c;
      if (k >= codes.length) break;
      this.codes[i] = codes[k] & 0xff; this.colors[i] = colors && k < colors.length ? colors[k] & 15 : this.color;
    }
    this.link.fill(0); this.wrote = true;
  }
  /** What is on it, as a run keeps it (a colour as the VIC sees it: the low four bits of what is in colour RAM). */
  state(): ScriptScreen {
    this.sync();
    return {
      cols: this.cols, rows: this.rows, codes: this.codes.slice(), colors: this.colors.map(c => c & 15), border: this.border, background: this.background,
      lower: this.lower, ...(this.font ? { font: this.font.slice() } : {}), cursor: { col: this.col, row: this.row, color: this.color }, wrote: this.wrote,
    };
  }
}

/** The routines of the KERNAL and BASIC that print, which a script's run in memory does itself (screenRoutine). */
export const SCREEN_ROUTINES: ReadonlyMap<number, string> = new Map([
  [0xffd2, 'CHROUT'], [0xe716, 'the screen editor\'s output'], [0xe544, 'clear the screen'], [0xe566, 'cursor home'],
  [0xfff0, 'PLOT'], [0xab1e, 'STROUT'], [0xbdcd, 'LINPRT'],
]);

/** Where a run in memory does the printing routines itself: 1 at each of SCREEN_ROUTINES where no file of the program
 *  has bytes (a program with its own code there keeps it) and the script has none of its own (`mine`). */
export function screenTraps(files: readonly { load: number; bytes: Uint8Array }[], mine?: Uint8Array): Uint8Array {
  const t = new Uint8Array(0x10000);
  for (const a of SCREEN_ROUTINES.keys()) {
    if (mine?.[a]) continue;
    if (files.some(f => a >= f.load && a < f.load + f.bytes.length)) continue;
    t[a] = 1;
  }
  return t;
}

/** what screenRoutine needs of the CPU: its registers and the carry */
interface RoutineCpu { a: number; x: number; y: number; s: number; pc: number; c: number }

/**
 * The routine at the CPU's PC (one of SCREEN_ROUTINES) done on `screen` with the registers it is called with, then
 * returned from as its RTS would: the return address taken off the stack. `read`: memory as the caller sees it (a
 * text STROUT prints, the stack).
 */
export function screenRoutine(screen: TextScreen, cpu: RoutineCpu, read: (a: number) => number): void {
  // (what the code wrote into the screen's memory is on the screen first, and what this prints goes into it)
  screen.sync();
  switch (cpu.pc) {
    case 0xffd2: case 0xe716: screen.out(cpu.a); cpu.c = 0; break;
    case 0xe544: screen.clear(); break;
    case 0xe566: screen.home(); break;
    case 0xfff0:
      if (cpu.c) { cpu.x = screen.row; cpu.y = screen.col; } else screen.at(cpu.y, cpu.x);
      break;
    case 0xab1e: {
      let p = cpu.a | (cpu.y << 8);
      for (let n = 0; n < 0x10000; n++, p = (p + 1) & 0xffff) { const b = read(p); if (!b) break; screen.out(b); }
      cpu.a = 0; break;
    }
    case 0xbdcd: screen.text(String((cpu.a << 8) | cpu.x)); break;
  }
  screen.sync();
  const lo = read(0x100 + ((cpu.s + 1) & 0xff)), hi = read(0x100 + ((cpu.s + 2) & 0xff));
  cpu.s = (cpu.s + 2) & 0xff;
  cpu.pc = (((hi << 8) | lo) + 1) & 0xffff;
}

/** the 16 KB the VIC sees, as CIA 2 picks it */
const vicBank = (c: Pick<C64, 'cia2'>): number => (3 - ((c.cia2.pra | ~c.cia2.ddra) & 3)) << 14;
/** where the VIC reads its text screen: its bank and the matrix $d018 picks there */
export const vicMatrix = (c: Pick<C64, 'vic' | 'cia2'>): number => vicBank(c) | (((c.vic.regs[0x18] >> 4) & 15) << 10);

/**
 * The text screen of a whole C64 as its VIC shows it: the matrix in the bank CIA 2 picks and where $d018 puts it, the
 * colour RAM, the border and background colours, and the character set (the ROM's, or the 2 KB in RAM $d018 points
 * at). `wrote`: whether the run changed it.
 */
export function c64TextScreen(c: Pick<C64, 'ram' | 'color' | 'vic' | 'cia2'>, wrote: boolean): ScriptScreen {
  const bank = vicBank(c), d018 = c.vic.regs[0x18];
  const at = vicMatrix(c), chars = bank | (((d018 >> 1) & 7) << 11);
  const codes = new Uint8Array(1000), colors = new Uint8Array(1000);
  for (let i = 0; i < 1000; i++) { codes[i] = c.ram[(at + i) & 0xffff]; colors[i] = c.color[i] & 15; }
  // the VIC sees the character ROM at $1000-$1fff of banks 0 and 2: elsewhere the characters are in RAM
  const rom = (bank === 0 || bank === 0x8000) && (chars & 0x3000) === 0x1000;
  return {
    ...SCREEN_C64, codes, colors, border: c.vic.regs[0x20] & 15, background: c.vic.regs[0x21] & 15, lower: (d018 & 2) !== 0,
    ...(rom ? {} : { font: c.ram.slice(chars, chars + 0x800) }), cursor: null, wrote, c64: true,
  };
}

/** what `screen` needs of the JavaScript run it is in: its memory, its names, how print writes a value, and the C64 of
 *  sindri.c64() a value is (null: it is none) */
export interface ScreenContext {
  mem: Uint8Array;
  addr: (where: unknown) => number;
  show: (v: unknown) => string;
  machine: (v: unknown) => Pick<C64, 'ram' | 'color' | 'vic' | 'cia2'> | null;
}

/**
 * `screen` for a JavaScript script's run (script-js.ts): its C64 screen, 40×25 or (extended mode) larger.
 *
 *   screen.cols, screen.rows      its size in characters
 *   screen.print(...values)       a line: the values as print writes them, then RETURN
 *   screen.write(...values)       the same without the RETURN: the cursor stays after the text
 *   screen.chrout(byte or bytes)  PETSCII as CHROUT prints it: colour codes, RVS ON $12/OFF $92, CLR $93, HOME $13,
 *                                 the cursor moves, $0e/$8e the character sets
 *   screen.at(col, row)           the cursor to a column and a row, from 0; screen.col and screen.row say where it is
 *   screen.clear(), screen.home() CLR, and the cursor home
 *   screen.color, .border, .background
 *                                 colours, 0-15 or a name ("light blue"), read and set
 *   screen.reverse, screen.lower  RVS ON, the lower case character set: true or false
 *   screen.poke(col, row, code, color), screen.peek(col, row)
 *                                 a screen code (and its colour) in a cell, as POKE into the screen and colour RAM
 *   screen.codes, screen.colors   every cell's screen code and colour, a row after another
 *   mem[0x0400 + 40 * row + col], mem[0xd800 + …], mem[0xd020], mem[0xd021]
 *                                 the same in the memory, as on the C64 (screenMemory): the top left 40×25 cells, their
 *                                 colours, the border and the background (and so what the program's code writes there)
 *   screen.show(at, colorsAt)    a 40×25 screen of the program's (1000 screen codes at an address, a name, or
 *                                 bytes, and their colours) at the top left; show(c64) the screen of a C64 of sindri.c64()
 *   screen.charset(at)            a character set of the program's (2 KB at an address, a name, or bytes) in place of
 *                                 the ROM's; charset(null) for the ROM's again
 *
 * Text is written as text, in either character set: letters as letters, `\n` as RETURN, and the control characters
 * \x00-\x1f and \x80-\x9f as the PETSCII codes they are ("\x1c" red, "\x12" RVS ON, "\x93" CLR).
 */
export function screenApi(scr: TextScreen, ctx: ScreenContext): Record<string, unknown> {
  const bytes = (v: unknown, n: number, what: string): Uint8Array => {
    if (v instanceof Uint8Array) return v.subarray(0, n);
    if (Array.isArray(v)) return Uint8Array.from(v.slice(0, n) as number[]);
    const a = ctx.addr(v);
    return ctx.mem.subarray(a, Math.min(0x10000, a + n));
  };
  const cell = (col: unknown, row: unknown, what: string): [number, number] => {
    const c = Number(col), r = Number(row);
    if (!Number.isInteger(c) || !Number.isInteger(r) || c < 0 || r < 0 || c >= scr.cols || r >= scr.rows)
      throw new RangeError(`screen.${what}: column ${String(col)}, row ${String(row)} is not on the screen (columns 0-${scr.cols - 1}, rows 0-${scr.rows - 1})`);
    return [c, r];
  };
  const text = (v: unknown[]) => v.map(ctx.show).join(' ');
  const api: Record<string, unknown> = {
    print(...v: unknown[]) { scr.text(text(v)); scr.out(0x0d); },
    write(...v: unknown[]) { scr.text(text(v)); },
    chrout(v: unknown) {
      if (typeof v === 'number') { scr.out(v); return; }
      if (typeof v === 'string') { scr.text(v); return; }
      if (!(v instanceof Uint8Array) && !Array.isArray(v)) throw new TypeError('screen.chrout: a byte (a number) or bytes are wanted');
      const a = v as ArrayLike<number>;
      for (let i = 0; i < a.length; i++) scr.out(Number(a[i]));
    },
    at(col: unknown, row: unknown) { const [c, r] = cell(col, row, 'at'); scr.at(c, r); },
    clear() { scr.clear(); },
    home() { scr.home(); },
    poke(col: unknown, row: unknown, code: unknown, color?: unknown) {
      const [c, r] = cell(col, row, 'poke');
      scr.poke(c, r, Number(code) & 0xff, color == null ? undefined : c64Color(color, 'screen.poke'));
    },
    peek(col: unknown, row: unknown): number { const [c, r] = cell(col, row, 'peek'); return scr.codes[r * scr.cols + c]; },
    show(from: unknown, colorsFrom?: unknown) {
      const m = ctx.machine(from);
      if (m) {
        const s = c64TextScreen(m, true);
        scr.show(s.codes, s.colors); scr.border = s.border; scr.background = s.background; scr.lower = s.lower; scr.font = s.font ?? null;
        return;
      }
      scr.show(bytes(from, 1000, 'screen.show'), colorsFrom == null ? null : bytes(colorsFrom, 1000, 'screen.show'));
    },
    charset(from: unknown) {
      if (from == null) { scr.font = null; scr.wrote = true; return; }
      const f = new Uint8Array(0x800);
      f.set(bytes(from, 0x800, 'screen.charset'));
      scr.font = f; scr.wrote = true;
    },
  };
  // each in step with the memory before and after (a screen larger than 40×25: TextScreen.sync)
  for (const [k, f] of Object.entries(api)) {
    if (typeof f !== 'function') continue;
    api[k] = (...a: unknown[]) => { scr.sync(); try { return (f as (...x: unknown[]) => unknown)(...a); } finally { scr.sync(); } };
  }
  const prop = (name: string, get: () => unknown, set?: (v: unknown) => void) => Object.defineProperty(api, name, { enumerable: true, get, ...(set ? { set } : {}) });
  prop('cols', () => scr.cols);
  prop('rows', () => scr.rows);
  prop('col', () => scr.col, v => { scr.at(Number(v), scr.row); });
  prop('row', () => scr.row, v => { scr.at(scr.col, Number(v)); });
  prop('color', () => scr.color, v => { scr.color = c64Color(v, 'screen.color'); });
  prop('border', () => scr.border, v => { scr.border = c64Color(v, 'screen.border'); scr.wrote = true; });
  prop('background', () => scr.background, v => { scr.background = c64Color(v, 'screen.background'); scr.wrote = true; });
  prop('reverse', () => scr.rvs, v => { scr.rvs = !!v; });
  prop('lower', () => scr.lower, v => { scr.lower = !!v; scr.wrote = true; });
  prop('codes', () => { scr.sync(); scr.wrote = true; return scr.codes; });
  prop('colors', () => { scr.sync(); scr.wrote = true; return scr.colors; });
  return api;
}
