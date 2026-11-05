/* =====================================================================
 * Text encodings: which bytes a `.text` string can write, and how.
 * The characters follow Kick Assembler 5.25's tables (measured with KickAss.jar). Only characters that
 * show what the C64 shows are used: a byte without one (inverse, graphics, ", £, ↑, ←) is written as
 * `.byte`, which keeps the output byte-exact. In a PETSCII text the control codes are written by name
 * in the same `.text` line (`.text PET_CLR + "HELLO" + PET_RETURN`).
 * ===================================================================== */
import type { Addr, Line, TextEncoding, Token } from '../types';

export interface TextEncodingInfo {
  /** the Kick Assembler `.encoding` name */
  kick: string;
  /** shown in block titles and menus */
  label: string;
  /** the character written in `.text` for a byte, or null for `.byte` */
  char: (b: number) => string | null;
}

const at = String.fromCharCode;
/** $20-$3f: digits and punctuation, the same in every table (" ends the string) */
const punct = (b: number) => (b >= 0x20 && b <= 0x3f && b !== 0x22 ? at(b) : null);

export const TEXT_ENCODINGS: Record<TextEncoding, TextEncodingInfo> = {
  petscii: { kick: 'petscii_upper', label: 'PETSCII', char: b => (b >= 0x20 && b <= 0x5d && b !== 0x22 && b !== 0x5c ? at(b) : null) },
  // the lower case character set: $41-$5a are lower case letters, $c1-$da upper case
  'petscii-mixed': {
    kick: 'petscii_mixed', label: 'PETSCII, mixed case',
    char: b => (b >= 0x41 && b <= 0x5a ? at(b + 0x20) : b >= 0xc1 && b <= 0xda ? at(b - 0x80) : b >= 0x20 && b <= 0x5d && b !== 0x22 && b !== 0x5c ? at(b) : null),
  },
  screen: { kick: 'screencode_upper', label: 'screen codes', char: b => (b <= 0x1b || b === 0x1d ? at(b + 0x40) : punct(b)) },
  // the lower case character set: $01-$1a are lower case letters, $41-$5a upper case
  'screen-mixed': {
    kick: 'screencode_mixed', label: 'screen codes, mixed case',
    char: b => (b === 0 || b === 0x1b || b === 0x1d ? at(b + 0x40) : b <= 0x1a ? at(b + 0x60) : b >= 0x41 && b <= 0x5a ? at(b) : punct(b)),
  },
};

export const textEncoding = (enc: TextEncoding | undefined): TextEncodingInfo => TEXT_ENCODINGS[enc ?? 'petscii'] ?? TEXT_ENCODINGS.petscii;

/* ---------- PETSCII control codes ---------- */

export interface PetsciiControl {
  /** the name the source gives it, a string constant: `.const PET_CLR = @"\$93"` */
  name: string;
  /** what it does when printed (CHROUT), for the comment on its definition and the listing's tooltip */
  desc: string;
}

const ctl = (name: string, desc: string): PetsciiControl => ({ name: `PET_${name}`, desc });
const color = (name: string) => ctl(name.toUpperCase().replace(/ /g, '_'), `text color ${name}`);
const fkey = (n: number) => ctl(`F${n}`, `the F${n} key`);

/** The control codes of the C64's PETSCII, as the Programmer's Reference Guide lists them (Appendix C, CHR$ codes);
 *  the colors by the names the C64 gives them. A code that is not here ($0a, $80, ...) is written as `.byte`. */
export const PETSCII_CONTROLS: Readonly<Record<number, PetsciiControl>> = {
  0x05: color('white'),
  0x08: ctl('CASE_LOCK', 'Shift+C= no longer switches the case'),
  0x09: ctl('CASE_UNLOCK', 'Shift+C= switches the case again'),
  0x0d: ctl('RETURN', 'return: the start of the next line'),
  0x0e: ctl('LOWER_CASE', 'switch to the lower case characters'),
  0x11: ctl('CRSR_DOWN', 'cursor down'),
  0x12: ctl('RVS_ON', 'reverse on'),
  0x13: ctl('HOME', 'cursor home'),
  0x14: ctl('DEL', 'delete'),
  0x1c: color('red'),
  0x1d: ctl('CRSR_RIGHT', 'cursor right'),
  0x1e: color('green'),
  0x1f: color('blue'),
  0x81: color('orange'),
  0x85: fkey(1), 0x86: fkey(3), 0x87: fkey(5), 0x88: fkey(7), 0x89: fkey(2), 0x8a: fkey(4), 0x8b: fkey(6), 0x8c: fkey(8),
  0x8d: ctl('SHIFT_RETURN', 'shift+return: the start of the next line'),
  0x8e: ctl('UPPER_CASE', 'switch to the upper case and graphics characters'),
  0x90: color('black'),
  0x91: ctl('CRSR_UP', 'cursor up'),
  0x92: ctl('RVS_OFF', 'reverse off'),
  0x93: ctl('CLR', 'clear the screen'),
  0x94: ctl('INST', 'insert'),
  0x95: color('brown'),
  0x96: color('light red'),
  0x97: color('dark grey'),
  0x98: color('grey'),
  0x99: color('light green'),
  0x9a: color('light blue'),
  0x9b: color('light grey'),
  0x9c: color('purple'),
  0x9d: ctl('CRSR_LEFT', 'cursor left'),
  0x9e: color('yellow'),
  0x9f: color('cyan'),
};

/** the name of a PETSCII control code, or undefined for any other byte */
export const petsciiControl = (b: number): PetsciiControl | undefined => PETSCII_CONTROLS[b];

/**
 * The operand of a `.text` line: the characters in strings, and in a PETSCII text (`pet`) each control code by its
 * name, joined by ` + ` (`PET_CLR + "HELLO" + PET_RETURN`). `char` gives each other byte's character; `use` hears of
 * every control code written, so the file head defines it.
 */
export function textTokens(bytes: ArrayLike<number>, char: (b: number) => string | null, pet: boolean, use?: (b: number) => void): Token[] {
  const tok: Token[] = [];
  for (let i = 0; i < bytes.length;) {
    if (tok.length) tok.push({ t: 'p', s: ' + ' });
    const c = pet ? petsciiControl(bytes[i]) : undefined;
    if (c) {
      use?.(bytes[i]);
      tok.push({ t: 'hw', s: c.name, sym: { name: c.name, desc: `${c.desc} ($${bytes[i].toString(16).padStart(2, '0')})`, cat: 'PETSCII control codes', addr: bytes[i] } });
      i++;
      continue;
    }
    let s = '';
    for (; i < bytes.length && !(pet && petsciiControl(bytes[i])); i++) s += char(bytes[i]) ?? '';
    tok.push({ t: 'str', s: `"${s}"` });
  }
  return tok;
}

/** The file head's definitions of the control codes its texts use, at `a`: `.const PET_CLR = @"\$93"`, a string with
 *  the byte in it, so the name can stand in a `.text` line (Kick Assembler 5.25 writes it unchanged in both PETSCII
 *  encodings, measured with KickAss.jar). */
export function petsciiDefinitions(used: ReadonlySet<number>, a: Addr, upper: boolean): Line[] {
  if (!used.size) return [];
  const hex = (b: number) => { const s = b.toString(16).padStart(2, '0'); return upper ? s.toUpperCase() : s; };
  return [
    { k: 'blank', a },
    { k: 'cmt', a, text: 'PETSCII control codes, written by name in the texts' },
    ...[...used].sort((x, y) => x - y).map((b): Line => ({
      k: 'dir', a, n: 0, cmt: PETSCII_CONTROLS[b].desc,
      tok: [{ t: 'dir', s: '.const' }, { t: 'p', s: ' ' }, { t: 'def', s: PETSCII_CONTROLS[b].name }, { t: 'p', s: ' = ' }, { t: 'str', s: `@"\\$${hex(b)}"` }],
    })),
  ];
}
