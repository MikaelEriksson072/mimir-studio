/* 5.5b strings handed to print routines: the ROM's (STROUT, SETNAM) and the program's own routines that print a string
 * through CHROUT. The parameters at a call tell where the string is; the routine tells how long it is: the length it is
 * given, the count its loop compares the index with, or the byte that ends it. */
import type { Ctx } from './context';
import type { Addr } from '../types';
import { BRANCHES, CLOBBER_A, OPC, SHIFT_MN } from '../cpu/opcodes';
import { decode } from '../cpu/decode';
import { $2, $4 } from '../util/hex';

export type Reg8 = 'a' | 'x' | 'y';
/** a register, or a byte in memory the caller sets */
export type Place = Reg8 | Addr;

/** How a string ends: at a byte that ends it (its last byte), after a count, or after a count the caller sets. */
export interface StringEnd { end?: number[]; len?: number; lenAt?: Place }

/** A routine that takes a string's address: one that prints it, or SETNAM, which is given a file name. */
export interface Printer extends StringEnd {
  kind: 'print' | 'name';
  /** "STROUT ($ab1e)", "the routine at $0840" */
  name: string;
  /** where its caller puts the string's address: the low and the high byte */
  ptr: [Place, Place];
  /** the index its loop starts with, added to the address (a count counts from it) */
  offset: number;
}

/** A string the code hands to a print routine: its length or the bytes that end it, and the reason it is text. */
export interface StringEv { len?: number; end?: number[]; by: string }

/** Routines that print the character in A (and keep A): CHROUT, the screen editor's output and BASIC's. */
export const CHAR_OUT: ReadonlyMap<Addr, string> = new Map([[0xffd2, 'CHROUT ($ffd2)'], [0xe716, 'the screen output ($e716)'], [0xab47, "BASIC's output ($ab47)"]]);

/** STROUT prints to the 0 or the quote that ends the string; SETNAM is given the name's length in A. */
export const ROM_PRINTERS: ReadonlyMap<Addr, Printer> = new Map<Addr, Printer>([
  [0xab1e, { kind: 'print', name: 'STROUT ($ab1e)', ptr: ['a', 'y'], offset: 0, end: [0x00, 0x22] }],
  [0xffbd, { kind: 'name', name: 'SETNAM ($ffbd)', ptr: ['x', 'y'], offset: 0, lenAt: 'a' }],
]);

/** The reason a string a printer is handed is text: "printed by STROUT ($ab1e) from $0a0f". */
export const handedText = (P: Pick<Printer, 'kind' | 'name'>, from: Addr): string => `${P.kind === 'name' ? 'the file name given to' : 'printed by'} ${P.name} from ${$4(from)}`;

/** Instructions that leave the Z flag as it is. */
const KEEPS_Z = new Set(['STA', 'STX', 'STY', 'SAX', 'PHA', 'PHP', 'TXS', 'CLC', 'SEC', 'CLI', 'SEI', 'CLD', 'SED', 'CLV', 'NOP', 'JMP', ...BRANCHES]);
const writesA = (mn: string, mode: string) => mn === 'LDA' || mn === 'TXA' || mn === 'TYA' || CLOBBER_A.has(mn) || (SHIFT_MN.has(mn) && mode === 'acc');

type Code = Pick<Ctx, 'mem' | 'insLen' | 'skip'>;
/** A loop that prints a string, and the call that prints each character. */
export interface PrintLoop extends StringEnd { out: Addr }

/**
 * From the load of a string's next character (`lda (zp),y` or `lda tab,x`): whether the loop prints the character, and
 * how it ends. The first test of the character on a path out of the loop is the byte that ends the string (a test that
 * goes back into the loop is a character it prints its own way); a compare of the index before the branch back is the
 * count. Null when the character is not printed.
 */
export function printLoop(ctx: Code, at: Addr): PrintLoop | null {
  const { mem, insLen, skip } = ctx;
  const idx = OPC[mem[at]].mode === 'abx' ? 'X' : 'Y';
  const seen = new Set<Addr>([at]);
  // back into the loop: the load, an index set again just before it, or what the loop ran through
  const inLoop = (a: Addr) => (a <= at && at - a <= 6) || seen.has(a);
  const leaves = (from: Addr): boolean => {
    for (let pc = from, n = 0; n < 16 && insLen[pc] && !skip.has(pc); n++) {
      const d = decode(mem, pc), f = d.info.flow;
      if (f === 'ret' || f === 'jmpi' || f === 'brk' || f === 'jam') return true;
      if (f === 'jmp') return !inLoop(d.target!);
      if (f === 'br' && inLoop(d.target!)) return false;
      pc = (pc + insLen[pc]) & 0xffff;
    }
    return false;
  };
  const out: StringEnd = {};
  let chr = true, pushed = false, printed: Addr | null = null, decided = false;
  /** Z tells whether the character is this byte */
  let z: number | null = 0;
  /** the index was compared with this count, or with the byte at this address */
  let count: { n: number } | { at: Addr } | null = null;
  const take = (c: { n: number } | { at: Addr }) => { if ('n' in c) out.len = c.n; else out.lenAt = c.at; decided = true; };
  let pc = (at + insLen[at]) & 0xffff;
  for (let n = 0; n < 32 && insLen[pc] && !skip.has(pc) && !seen.has(pc); n++) {
    seen.add(pc);
    const d = decode(mem, pc), { mn, mode, flow } = d.info, next = (pc + insLen[pc]) & 0xffff;
    if (flow === 'ret' || flow === 'jmpi' || flow === 'brk' || flow === 'jam') break;
    if (flow === 'jmp') { if (inLoop(d.target!)) break; pc = d.target!; continue; }
    if (flow === 'jsr') {
      // the character routines keep A; another routine is not known to
      if (CHAR_OUT.has(d.target!)) { if (chr) printed ??= pc; } else chr = false;
      z = null; count = null; pc = next; continue;
    }
    if (flow === 'br') {
      const t = d.target!, back = inLoop(t);
      if (!decided && z != null && (mn === 'BEQ' || mn === 'BNE')) {
        // BEQ leaves at the end byte, BNE goes on at its target while it is not there
        if ((mn === 'BNE' && back) || leaves(mn === 'BEQ' ? t : next)) { out.end = [z]; decided = true; }
        if (back) break;
        pc = mn === 'BEQ' ? next : t; continue;
      }
      if (!decided && count) {
        if ((mn === 'BNE' || mn === 'BCC') && back) take(count);
        else if ((mn === 'BEQ' || mn === 'BCS') && !back && leaves(t)) take(count);
      }
      if (back) break;
      pc = next; continue;
    }
    if (mn === 'PHA') pushed = chr;
    else if (mn === 'PLA') { chr = pushed; z = chr ? 0 : null; pc = next; continue; }
    else if (mn === 'CMP') { z = chr && mode === 'imm' ? d.v! : null; pc = next; continue; }
    else if ((mn === 'CPX' || mn === 'CPY') && mn.endsWith(idx)) { z = null; count = mode === 'imm' ? { n: d.v! } : mode === 'zp' || mode === 'abs' ? { at: d.target! } : null; pc = next; continue; }
    else if ((mn === 'TAX' || mn === 'TAY') && chr) { z = 0; pc = next; continue; }
    // an index that counts down prints the string backwards: no count
    else if (mn === 'DE' + idx) count = null;
    if (writesA(mn, mode)) chr = false;
    if (!KEEPS_Z.has(mn)) z = null;
    pc = next;
  }
  return printed != null ? { ...out, out: printed } : null;
}

/** A symbolic register: an entry register, a known value, or unknown. */
type Sym = Reg8 | number | null;

/**
 * The program's own routine at `t` that takes a string: it keeps the string's address from two registers, or reads it
 * from a zero page pair its caller sets, and prints the string through CHROUT; or it hands its registers on to another
 * such routine (a call, or a jump to the ROM's) before it changes them.
 */
function ownPrinter(ctx: Code, t: Addr, printer: (a: Addr) => Printer | null): Printer | null {
  const { mem, insLen, skip } = ctx;
  const R: Record<Reg8, Sym> = { a: 'a', x: 'x', y: 'y' };
  const stores = new Map<Addr, Sym>();
  /** a place of a routine handed on, as this routine's caller sets it (undefined: the caller does not) */
  const handOn = (p: Place): Place | undefined => {
    const s = typeof p === 'string' ? R[p] : stores.has(p) ? stores.get(p)! : p;
    return typeof s === 'string' ? s : typeof p === 'number' && !stores.has(p) ? p : undefined;
  };
  const name = `the routine at ${$4(t)}`;
  for (let pc = t, n = 0; n < 24 && insLen[pc] && !skip.has(pc); n++) {
    const d = decode(mem, pc), { mn, mode, flow } = d.info, next = (pc + insLen[pc]) & 0xffff;
    if (flow === 'ret' || flow === 'jmpi' || flow === 'brk' || flow === 'jam') return null;
    // on into the rest of the routine
    if (flow === 'jmp' && insLen[d.target!]) { pc = d.target!; continue; }
    if ((flow === 'jsr' || flow === 'jmp') && !CHAR_OUT.has(d.target!)) {
      const P = printer(d.target!);
      if (P) {
        const lo = handOn(P.ptr[0]), hi = handOn(P.ptr[1]), lenAt = P.lenAt != null ? handOn(P.lenAt) : undefined;
        return lo === undefined || hi === undefined ? null : { ...P, name, ptr: [lo, hi], lenAt };
      }
      if (flow === 'jmp') return null;
      R.a = R.x = R.y = null; pc = next; continue;
    }
    if (flow === 'jmp') return null;
    if (mn === 'LDA' && mode === 'izy') {
      const lo = handOn(d.v!), hi = handOn((d.v! + 1) & 0xff);
      const loop = typeof R.y === 'number' && lo !== undefined && hi !== undefined ? printLoop(ctx, pc) : null;
      if (!loop) return null;
      return { kind: 'print', name, ptr: [lo!, hi!], offset: R.y as number, end: loop.end, len: loop.len, lenAt: loop.lenAt != null ? handOn(loop.lenAt) : undefined };
    }
    const r = mn === 'STA' ? R.a : mn === 'STX' ? R.x : mn === 'STY' ? R.y : undefined;
    if ((mode === 'zp' || mode === 'abs') && (d.info.access === 'write' || d.info.access === 'rmw')) stores.set(d.target!, r ?? null);
    const step = (v: Sym, k: number): Sym => (typeof v === 'number' ? (v + k) & 0xff : null);
    switch (mn) {
      case 'LDA': R.a = mode === 'imm' ? d.v! : null; break;
      case 'LDX': R.x = mode === 'imm' ? d.v! : null; break;
      case 'LDY': R.y = mode === 'imm' ? d.v! : null; break;
      case 'TAX': R.x = R.a; break; case 'TAY': R.y = R.a; break;
      case 'TXA': R.a = R.x; break; case 'TYA': R.a = R.y; break;
      case 'INX': R.x = step(R.x, 1); break; case 'DEX': R.x = step(R.x, -1); break;
      case 'INY': R.y = step(R.y, 1); break; case 'DEY': R.y = step(R.y, -1); break;
      default:
        if (writesA(mn, mode)) R.a = null;
        if (mn === 'TSX' || mn === 'LAX' || mn === 'AXS' || mn === 'LAS') R.x = null;
    }
    pc = next;
  }
  return null;
}

/** The routines that take a string: `printer(t)` for a call to `t`, worked out once per evidence pass; the program's
 *  own are kept in `found` and logged. */
export function printers(ctx: Ctx, found: Map<Addr, Printer>): (t: Addr) => Printer | null {
  const memo = new Map<Addr, Printer | null>();
  const printer = (t: Addr): Printer | null => {
    // a call to the ROM's routine is one also where the program is loaded below the ROM (the trace follows it there)
    const rom = ROM_PRINTERS.get(t);
    if (rom || !ctx.insLen[t]) return rom ?? null;
    if (memo.has(t)) return memo.get(t)!;
    memo.set(t, null); // a routine that reaches itself is none
    const P = ownPrinter(ctx, t, printer);
    memo.set(t, P);
    if (P) {
      found.set(t, P);
      ctx.L('ok', `${P.kind === 'name' ? 'File name' : 'Print'} routine at ${$4(t)}: the string's address in ${placeText(P.ptr[0])}/${placeText(P.ptr[1])}${endText(P)}`, t, 'data');
    }
    return P;
  };
  return printer;
}

const placeText = (p: Place) => (typeof p === 'string' ? p.toUpperCase() : $2(p));
function endText(e: StringEnd): string {
  if (e.lenAt != null) return `, its length in ${placeText(e.lenAt)}`;
  if (e.len != null) return `, ${e.len} bytes`;
  if (e.end) return `, ended by ${e.end.map($2).join(' or ')}`;
  return '';
}

/* 5.5c the case the program prints in: the screen shows the upper case characters until a $0e printed through CHROUT
 * (or a $d018 store) switches it to the lower case ones, where $41-$5a are lower case letters and $c1-$da upper case */

/** A switch of the characters the screen shows: to the lower case set (mixed case text) or back to the upper case one. */
export interface CaseSwitch { at: Addr; lower: boolean; how: string }

/** A $0e (lower case) or $8e (upper case) handed to a character output routine at `at`. */
export function sentCase(v: number | null | undefined, t: Addr, at: Addr): CaseSwitch | null {
  const name = CHAR_OUT.get(t);
  return name && (v === 0x0e || v === 0x8e) ? { at, lower: v === 0x0e, how: `${$2(v)} sent to ${name} at ${$4(at)}` } : null;
}

/**
 * A $d018 store at `at` of `v` (null: not known), where the VIC sees the ROM's characters (`rom`) or not: `$x6`/`$x7`
 * selects the lower case set, `$x4`/`$x5` the upper case one, and so does `lda $d018 / ora #$02 / sta $d018`
 * (`and #$fd`), as the screen editor does. Any other value shows characters of the program's own (or a bitmap), which
 * has its letters where the upper case set has them: a switch away from the lower case set too.
 */
export function d018Case(mem: Uint8Array, insLen: Uint8Array, at: Addr, v: number | null, rom: boolean): CaseSwitch | null {
  if (v != null) {
    const k = v & 0x0e;
    if (rom && (k === 0x06 || k === 0x04)) return { at, lower: k === 0x06, how: `$d018 = ${$2(v)} at ${$4(at)}` };
    return { at, lower: false, how: `$d018 = ${$2(v)} at ${$4(at)}, not the ROM's characters` };
  }
  const op = (at - 2) & 0xffff, ld = (at - 5) & 0xffff;
  if (!rom || insLen[op] !== 2 || insLen[ld] !== 3 || mem[ld] !== 0xad || (mem[ld + 1] | (mem[ld + 2] << 8)) !== 0xd018) return null;
  const k = mem[op + 1] & 0x0e;
  if (mem[op] === 0x09 && k === 0x02) return { at, lower: true, how: `ora #${$2(mem[op + 1])} into $d018 at ${$4(at)}` };
  if (mem[op] === 0x29 && k === 0x0c) return { at, lower: false, how: `and #${$2(mem[op + 1])} into $d018 at ${$4(at)}` };
  return null;
}

const shifted = (b: number) => (b >= 0xc1 && b <= 0xda) || (b >= 0x61 && b <= 0x7a);
const plain = (b: number) => b >= 0x41 && b <= 0x5a;

/** The first $0e or $8e in a printed string: it switches the case of the rest, and of what the program prints next. */
export function stringSwitch(bytes: ArrayLike<number>, at: Addr): CaseSwitch | null {
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0x0e || bytes[i] === 0x8e) return { at, lower: bytes[i] === 0x0e, how: `${$2(bytes[i])} in the string at ${$4(at)}` };
  }
  return null;
}

/**
 * The case a printed string shows it is in, whatever the program does elsewhere: its first $0e or $8e, or a word that
 * starts with a capital, a shifted letter and two plain ones ("Abyss", stored as $c1 $42 $59: with the upper case
 * characters a graphic before "BYSS"). Null: it reads either way.
 */
export function ownCase(bytes: ArrayLike<number>): { lower: boolean; why: string } | null {
  const sw = stringSwitch(bytes, 0);
  if (sw) return { lower: sw.lower, why: `${sw.lower ? '$0e' : '$8e'} in it` };
  for (let i = 0; i + 2 < bytes.length; i++) {
    if (!shifted(bytes[i]) || !plain(bytes[i + 1]) || !plain(bytes[i + 2]) || (i && (shifted(bytes[i - 1]) || plain(bytes[i - 1])))) continue;
    let word = String.fromCharCode((bytes[i] & 0x1f) | 0x40);
    for (let j = i + 1; j < bytes.length && plain(bytes[j]); j++) word += String.fromCharCode(bytes[j] + 0x20);
    return { lower: true, why: `"${word}"` };
  }
  return null;
}

/** The encoding of the text a program prints: per string, from what the string shows or else what the program does. */
export type PrintCase = (bytes: ArrayLike<number>) => { enc: 'petscii' | 'petscii-mixed'; why: string };

/**
 * The case the program prints in, from its switches (sorted by address): the lower case characters when it switches to
 * them and never away. A program that also switches back, or to characters of its own, prints its text in upper case
 * unless a string shows otherwise (a loader's messages, say, before the program switches). Logs it once a string that
 * shows nothing takes it.
 */
export function printCase(switches: CaseSwitch[], L: Ctx['L']): PrintCase {
  const low = switches.find(c => c.lower), up = switches.find(c => !c.lower);
  const lower = !!low && !up;
  let told = !low;
  return bytes => {
    const own = ownCase(bytes);
    if (!own && !told) {
      told = true;
      if (lower) L('ok', `The program switches to the lower case characters (${low!.how}): the text it prints is mixed case`, low!.at, 'data');
      else L('info', `The program switches to the lower case characters (${low!.how}) and away from them (${up!.how}): the text it prints is upper case unless a string shows otherwise`, low!.at, 'data');
    }
    const l = own ? own.lower : lower;
    return { enc: l ? 'petscii-mixed' : 'petscii', why: own && own.lower !== lower ? `, ${own.lower ? 'mixed' : 'upper'} case (${own.why})` : '' };
  };
}

/** How long the string at `s` is, at most `max` bytes: its length, or up to the byte that ends it (null: not known). */
export function stringLen(mem: Uint8Array, s: Addr, max: number, str: StringEv): number | null {
  if (str.len != null) return Math.min(str.len, max);
  if (!str.end) return null;
  for (let i = 0; i < 256 && s + i < 0x10000; i++) if (str.end.includes(mem[s + i])) return Math.min(i + 1, max);
  return null;
}
