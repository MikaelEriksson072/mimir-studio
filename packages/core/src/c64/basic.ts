/* BASIC stub parsing: line links, tokens, SYS address, BasicUpstart2 match. */
import type { Addr, BasicInfo, BasicLine } from '../types';
import { h2, word } from '../util/hex';

export const BASIC_TOKENS = ('END FOR NEXT DATA INPUT# INPUT DIM READ LET GOTO RUN IF RESTORE GOSUB RETURN REM STOP ON WAIT LOAD SAVE VERIFY DEF POKE PRINT# PRINT CONT LIST CLR CMD SYS OPEN CLOSE GET NEW TAB( TO FN SPC( THEN NOT STEP + - * / ^ AND OR > = < SGN INT ABS USR FRE POS SQR RND LOG EXP COS SIN TAN ATN PEEK LEN STR$ VAL ASC CHR$ LEFT$ RIGHT$ MID$ GO').split(' ');

const tokText = (t: number): string => t >= 0x80 && t <= 0xcb ? BASIC_TOKENS[t - 0x80] : t >= 0x20 && t < 0x60 ? String.fromCharCode(t) : `{${h2(t)}}`;

/** The line as the listing's comment shows it: each SYS address also in hex, after its expression, `1999 SYS2065 ($0811)
 *  ABC` (`hex` writes the number as the listing writes its numbers). A $9e inside quotes is a colour code, not SYS. */
export function basicLineComment(l: BasicLine, hex: (v: number) => string): string {
  const t = l.toks;
  let s = l.num + ' ', quoted = false;
  for (let i = 0; i < t.length;) {
    const c = t[i++];
    s += tokText(c);
    if (c === 0x22) quoted = !quoted;
    if (c !== 0x9e || quoted) continue;
    const r = sysTarget(t, i);
    if (!r) continue;
    s += t.slice(i, r.end).map(tokText).join('') + ` (${hex(r.addr)})`;
    i = r.end;
  }
  return s;
}

const PLUS = 0xaa, MINUS = 0xab, TIMES = 0xac, DIVIDE = 0xad, POWER = 0xae;
const isDigit = (c: number) => c >= 0x30 && c <= 0x39;

/**
 * Where a SYS goes, its expression worked out as BASIC works it out (`SYS2069-2MHZ!` goes to 2067: the expression ends
 * at the M; `SYS9*4096` to 36864): numbers (spaces in them skipped, a decimal point, FIN's exponent), + - * / ^ and
 * brackets. It ends at the first byte that does not go on with it. `i`: the byte after the SYS token; `end`: the byte
 * after the expression. Null without a number in it, with a variable (`SYSSR+16`: the program sets SR before), a
 * function (PEEK …) or anything else BASIC only knows as the program runs, or outside 0-65535 (?ILLEGAL QUANTITY).
 */
function sysTarget(t: number[], i: number): { addr: number; end: number } | null {
  let nums = 0;
  const sp = () => { let j = i; while (t[j] === 0x20) j++; return j; };
  const number = (): number => {
    let s = '', dot = false;
    for (;;) {
      const j = sp(), c = t[j];
      if (isDigit(c)) s += String.fromCharCode(c);
      else if (c === 0x2e && !dot) { dot = true; s += '.'; }
      else break;
      i = j + 1;
    }
    let v = s === '.' ? 0 : Number(s);
    // an exponent (2E3) is taken with its digits; an E without them changes nothing (SYS2072 EAGLE)
    let k = sp();
    if (t[k] === 0x45) {
      let neg = false, e = '';
      do k++; while (t[k] === 0x20);
      if (t[k] === MINUS || t[k] === 0x2d || t[k] === PLUS || t[k] === 0x2b) { neg = t[k] === MINUS || t[k] === 0x2d; do k++; while (t[k] === 0x20); }
      for (; isDigit(t[k]); ) { e += String.fromCharCode(t[k]); i = ++k; while (t[k] === 0x20) k++; }
      if (e) v *= 10 ** (neg ? -Number(e) : Number(e));
    }
    nums++;
    return v;
  };
  const primary = (): number | null => {
    const j = sp(), c = t[j];
    if (isDigit(c) || c === 0x2e) return number();
    if (c === 0x28) {
      i = j + 1;
      const v = sum(), k = sp();
      if (v == null || t[k] !== 0x29) return null;
      i = k + 1;
      return v;
    }
    return null;
  };
  const unary = (): number | null => {
    const j = sp();
    if (t[j] === MINUS) { i = j + 1; const v = unary(); return v == null ? null : -v; }
    if (t[j] === PLUS) { i = j + 1; return unary(); }
    let v = primary();
    for (let k = sp(); v != null && t[k] === POWER; k = sp()) {
      i = k + 1;
      const r = unary();
      v = r == null ? null : v ** r;
    }
    return v;
  };
  const product = (): number | null => {
    let v = unary();
    for (let k = sp(); v != null && (t[k] === TIMES || t[k] === DIVIDE); k = sp()) {
      i = k + 1;
      const r = unary();
      v = r == null ? null : t[k] === TIMES ? v * r : v / r;
    }
    return v;
  };
  const sum = (): number | null => {
    let v = product();
    for (let k = sp(); v != null && (t[k] === PLUS || t[k] === MINUS); k = sp()) {
      i = k + 1;
      const r = product();
      v = r == null ? null : t[k] === PLUS ? v + r : v - r;
    }
    return v;
  };
  const v = sum();
  return v == null || !nums || !(v >= 0 && v < 65536) ? null : { addr: Math.floor(v), end: i };
}

/** Where the first SYS on the line goes that BASIC can work out before the program runs (`SYS2072`, `SYS (2072)`,
 *  `SYS9*4096`); a $9e inside quotes is a colour code. */
function sysOf(t: number[]): number | null {
  let quoted = false;
  for (let i = 0; i < t.length; i++) {
    if (t[i] === 0x22) quoted = !quoted;
    if (t[i] !== 0x9e || quoted) continue;
    const r = sysTarget(t, i + 1);
    if (r) return r.addr;
  }
  return null;
}

/**
 * The BASIC program at `start`, read by its line links. Where the links do not hold (a crack's `1988 SYS2072 TRIUMWYRAT`
 * whose link points into its own line, The Last Ninja +6 Teesside Cracking Service) the lines are read as the C64 reads
 * them after LOAD: BASIC relinks the program (LINKPRG, $a533), each line ending at its first 0 from its fifth byte and the
 * program at a line whose link has a high byte of 0. Read that way it counts only when a SYS in it goes into the same
 * file, so bytes that are no BASIC are not taken for a stub, and it ends where that SYS goes when the code starts in it.
 */
export function parseBasic(mem: Uint8Array, owner: Int16Array, start: Addr): BasicInfo | null {
  const linked = readLines(mem, owner, start, false);
  if (linked) return linked;
  const r = readLines(mem, owner, start, true);
  if (!r || r.sys == null || owner[r.sys] < 0 || owner[r.sys] !== owner[start]) return null;
  // the code the SYS goes to often starts in the bytes BASIC reads as the rest of the line or as the end of the program
  // (1990 SYS2059 with LDY #$00 at $080b): the stub ends there
  if (r.sys <= start || r.sys >= r.end) return r;
  const lines = r.lines.filter(l => l.addr < r.sys!).map(l => {
    if (l.addr + 4 + l.toks.length <= r.sys!) return l;
    const toks = l.toks.slice(0, Math.max(0, r.sys! - l.addr - 4));
    return { ...l, toks, text: l.num + ' ' + toks.map(tokText).join('') };
  });
  const sysLine = lines.find(l => l.addr === r.sysLine?.addr) ?? null;
  return { ...r, end: r.sys, lines, sysLine };
}

function readLines(mem: Uint8Array, owner: Int16Array, start: Addr, relink: boolean): BasicInfo | null {
  const lines: BasicLine[] = [];
  let a = start;
  for (let guard = 0; guard < 64; guard++) {
    if (owner[a] < 0 || owner[a + 1] < 0) return null;
    const link = word(mem, a);
    if (relink ? mem[a + 1] === 0 : link === 0) {
      const end = a + 2;
      let sys: number | null = null, sysLine: BasicLine | null = null;
      for (const l of lines) {
        sys = sysOf(l.toks);
        if (sys != null) { sysLine = l; break; }
      }
      const one = lines.length === 1 && lines[0];
      const upstart = !!(one && start === 0x0801 && one.num === 10 && sys != null &&
        one.toks.length === 1 + String(sys).length && one.toks[0] === 0x9e &&
        one.toks.slice(1).map(c => String.fromCharCode(c)).join('') === String(sys) && word(mem, start) === end - 2);
      return { start, end, lines, sys, sysLine, upstart, ...(relink ? { relinked: true } : {}) };
    }
    const num = word(mem, a + 2), toks: number[] = [];
    let next: number;
    if (relink) {
      // LINKPRG looks for the 0 from the line's fifth byte on (Y = 5 … 255)
      let y = 5;
      while (y < 256 && (owner[a + y] >= 0 && mem[a + y] !== 0)) y++;
      if (y >= 256 || owner[a + y] < 0) return null;
      for (let p = a + 4; p < a + y; p++) toks.push(mem[p]);
      next = a + y + 1;
    } else {
      if (link <= a + 4 || link > a + 260) return null;
      let p = a + 4;
      while (p < link - 1 && mem[p] !== 0) toks.push(mem[p++]);
      if (p !== link - 1 || mem[p] !== 0) return null;
      next = link;
    }
    lines.push({ addr: a, num, toks, text: num + ' ' + toks.map(tokText).join('') });
    a = next;
  }
  return null;
}
