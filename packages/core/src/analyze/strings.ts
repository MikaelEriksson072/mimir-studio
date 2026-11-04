/* 5.5b strings handed to print routines: the ROM's (STROUT, SETNAM) and the program's own routines that print a string
 * through CHROUT. The parameters at a call tell where the string is; the routine tells how long it is: the length it is
 * given, the count its loop compares the index with, or the byte that ends it. */
import { PET_CTRL, type Ctx } from './context';
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
  /** where its caller puts the string's address: the low and the high byte; `after`: the string follows the JSR (the
   *  routine pulls its return address off the stack and goes on after the string) */
  ptr: [Place, Place] | 'after';
  /** the index its loop starts with, added to the address (a count counts from it); after a JSR, to the address it
   *  pushes, the JSR's last byte */
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
  let chr = true, pushed = false, decided = false;
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
      if (!CHAR_OUT.has(d.target!)) chr = false;
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
  const via = printedAt(ctx, at);
  return via != null ? { ...out, out: via } : null;
}

/**
 * The call that prints the character the load at `at` reads, on any path through the loop, the nearest first (a loop
 * that tests for characters it prints its own way prints the others on a branch's side): a JSR or JMP to a character
 * routine with the character still in A. Null: none.
 */
function printedAt(ctx: Code, at: Addr): Addr | null {
  const { mem, insLen, skip } = ctx;
  const seen = new Set<number>();
  const todo: [Addr, boolean, boolean][] = [[(at + insLen[at]) & 0xffff, true, false]];
  for (let n = 0; todo.length && n < 96; n++) {
    let [pc, chr, pushed] = todo.shift()!;
    // not back into the loop, and once a place with the character in A or not
    if (!insLen[pc] || skip.has(pc) || (pc <= at && at - pc <= 6) || seen.has(pc * 2 + +chr)) continue;
    seen.add(pc * 2 + +chr);
    const d = decode(mem, pc), { mn, mode, flow } = d.info, next = (pc + insLen[pc]) & 0xffff;
    if ((flow === 'jsr' || flow === 'jmp') && chr && CHAR_OUT.has(d.target!)) return pc;
    if (flow === 'ret' || flow === 'jmpi' || flow === 'brk' || flow === 'jam') continue;
    if (flow === 'jsr') { todo.push([next, chr && CHAR_OUT.has(d.target!), pushed]); continue; }
    if (flow === 'jmp') { todo.push([d.target!, chr, pushed]); continue; }
    if (flow === 'br') { todo.push([next, chr, pushed], [d.target!, chr, pushed]); continue; }
    if (mn === 'PHA') pushed = chr;
    else if (mn === 'PLA') chr = pushed;
    else if (writesA(mn, mode)) chr = false;
    todo.push([next, chr, pushed]);
  }
  return null;
}

/** A symbolic register: an entry register, a byte of the return address pulled off the stack, a known value, or
 *  unknown. */
type Sym = Reg8 | 'ret0' | 'ret1' | number | null;
const isReg = (s: Sym | undefined): s is Reg8 => s === 'a' || s === 'x' || s === 'y';

/**
 * The program's own routine at `t` that takes a string: it keeps the string's address from two registers, reads it
 * from a zero page pair its caller sets, or pulls it off the stack as its return address (the string follows the JSR),
 * and prints the string through CHROUT; or it hands its registers on to another such routine (a call, or a jump to the
 * ROM's) before it changes them.
 */
function ownPrinter(ctx: Code, t: Addr, printer: (a: Addr) => Printer | null): Printer | null {
  const { mem, insLen, skip } = ctx;
  const R: Record<Reg8, Sym> = { a: 'a', x: 'x', y: 'y' };
  const stores = new Map<Addr, Sym>();
  // what is on the stack: pushed here (unknown), or below them the return address, pulled low byte first
  let pushed = 0, pulled = 0, lost = false;
  // the return address' low byte counted up or down where it is kept (`inc $fb` before `lda ($fb),y`)
  let moved = 0;
  /** a place of a routine handed on, as this routine's caller sets it (undefined: the caller does not) */
  const handOn = (p: Place): Place | undefined => {
    const s = typeof p === 'string' ? R[p] : stores.has(p) ? stores.get(p)! : p;
    return isReg(s) ? s : typeof p === 'number' && !stores.has(p) ? p : undefined;
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
        // the string after a JSR follows this routine's caller only where a jump goes on with the stack as it was
        if (P.ptr === 'after') return flow === 'jmp' && !pushed && !pulled && !lost ? { ...P, name } : null;
        const lo = handOn(P.ptr[0]), hi = handOn(P.ptr[1]), lenAt = P.lenAt != null ? handOn(P.lenAt) : undefined;
        return lo === undefined || hi === undefined ? null : { ...P, name, ptr: [lo, hi], lenAt };
      }
      if (flow === 'jmp') return null;
      R.a = R.x = R.y = null; pc = next; continue;
    }
    if (flow === 'jmp') return null;
    if (mn === 'LDA' && mode === 'izy') {
      const y = R.y, lo = stores.get(d.v!), hi = stores.get((d.v! + 1) & 0xff);
      if (typeof y !== 'number') return null;
      const after = lo === 'ret0' && hi === 'ret1', loLoc = handOn(d.v!), hiLoc = handOn((d.v! + 1) & 0xff);
      const loop = after || (loLoc !== undefined && hiLoc !== undefined) ? printLoop(ctx, pc) : null;
      if (!loop) return null;
      return { kind: 'print', name, ptr: after ? 'after' : [loLoc!, hiLoc!], offset: y + (after ? moved : 0), end: loop.end, len: loop.len, lenAt: loop.lenAt != null && !after ? handOn(loop.lenAt) : undefined };
    }
    const r = mn === 'STA' ? R.a : mn === 'STX' ? R.x : mn === 'STY' ? R.y : undefined;
    const kept = mode === 'zp' || mode === 'abs' ? stores.get(d.target!) : undefined;
    if ((mn === 'INC' || mn === 'DEC') && (kept === 'ret0' || kept === 'ret1')) { if (kept === 'ret0') moved += mn === 'INC' ? 1 : -1; }
    else if ((mode === 'zp' || mode === 'abs') && (d.info.access === 'write' || d.info.access === 'rmw')) stores.set(d.target!, r ?? null);
    const step = (v: Sym, k: number): Sym => (typeof v === 'number' ? (v + k) & 0xff : null);
    const pull = (): Sym => (pushed ? (pushed--, null) : lost || pulled > 1 ? null : pulled++ ? 'ret1' : 'ret0');
    switch (mn) {
      case 'PHA': case 'PHP': pushed++; break;
      case 'PLA': R.a = pull(); break;
      case 'PLP': pull(); break;
      case 'TXS': lost = true; break;
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
      const where = P.ptr === 'after' ? 'the string after the JSR to it' : `the string's address in ${placeText(P.ptr[0])}/${placeText(P.ptr[1])}`;
      ctx.L('ok', `${P.kind === 'name' ? 'File name' : 'Print'} routine at ${$4(t)}: ${where}${endText(P)}`, t, 'data');
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
export function stringLen(mem: Uint8Array, s: Addr, max: number, str: Pick<StringEv, 'len' | 'end'>): number | null {
  if (str.len != null) return Math.min(str.len, max);
  if (!str.end) return null;
  for (let i = 0; i < 256 && s + i < 0x10000; i++) if (str.end.includes(mem[s + i])) return Math.min(i + 1, max);
  return null;
}

/** Any PETSCII character, graphics too, or a control code. */
const printable = (b: number) => (b >= 0x20 && b < 0x80) || b >= 0xa0 || PET_CTRL.has(b);

/**
 * How long the string a print routine is handed at `s` is, at most `max` bytes, when that many bytes read as text (a
 * loop that writes a file through CHROUT can write anything); null when it is not known or not text. An empty string,
 * only the byte that ends it, is no text.
 */
export function handedLen(mem: Uint8Array, s: Addr, max: number, str: Pick<StringEv, 'len' | 'end'>): number | null {
  const n = stringLen(mem, s, max, str);
  if (n == null || (str.end && n < 2 && str.end.includes(mem[s]))) return null;
  let ok = 0; for (let i = 0; i < n; i++) if (printable(mem[s + i]) || str.end?.includes(mem[s + i])) ok++;
  return ok >= n * 0.8 ? n : null;
}

/** A letter (of either case set), digit, punctuation or control code. */
const isChar = (b: number) => (b >= 0x20 && b <= 0x5f) || (b >= 0x61 && b <= 0x7a) || (b >= 0xc1 && b <= 0xda) || PET_CTRL.has(b);

/**
 * The bytes of the strings handed to print routines that code is traced over. A code island (5.13) is a guess, and one
 * found in the same round as the call that prints a string can start inside the string and decode on into the code
 * after it ("HUS...", $0d, $0d, $00 before `inc $01`): the islands of the next analysis keep out of these bytes. Only a
 * string of 4 bytes or more that is nearly all letters, digits, punctuation and control codes counts.
 */
export function textUnderCode(ctx: Pick<Ctx, 'ev' | 'mem' | 'insLen' | 'codeOwner' | 'owner'>): Set<Addr> {
  const { mem, insLen, codeOwner, owner } = ctx, out = new Set<Addr>();
  for (const [s, str] of ctx.ev.strings) {
    let max = 0; while (max < 256 && s + max < 0x10000 && owner[s + max] === owner[s]) max++;
    const n = handedLen(mem, s, max, str);
    if (!n || n < 4) continue;
    let chars = 0, code = false;
    for (let a = s; a < s + n; a++) { if (isChar(mem[a]) || str.end?.includes(mem[a])) chars++; if (insLen[a] || codeOwner[a] >= 0) code = true; }
    if (code && chars >= n * 0.9) for (let a = s; a < s + n; a++) out.add(a);
  }
  return out;
}

/** `sta`, `stx` and `sty` to the zero page or an absolute address: they leave the stack as it is. */
const STORES = new Set([0x84, 0x85, 0x86, 0x8c, 0x8d, 0x8e]);

/**
 * Does the routine at `t` pull its return address off the stack first (`pla / sta zp / pla`, after up to three stores
 * that leave the stack, `sty $24`)? Then the bytes after a JSR to it are data it reads, not code.
 */
export function popsReturn(mem: Uint8Array, t: Addr): boolean {
  let p = t;
  for (let k = 0; k < 3 && STORES.has(mem[p]); k++) p = (p + OPC[mem[p]].len) & 0xffff;
  return mem[p] === 0x68 && mem[(p + 1) & 0xffff] === 0x85 && mem[(p + 3) & 0xffff] === 0x68;
}

/**
 * The string after the JSR at `pc` to `t`, a routine that pulls its return address off the stack (`popsReturn`) and
 * prints what follows it: where it is and how long, to the byte that ends it or its count. The routine is decoded from
 * its bytes, which may not be traced yet; it goes on after the string. Null: it prints none, or its end is not found.
 */
export function inlineString(ctx: Pick<Ctx, 'mem' | 'insLen' | 'skip' | 'owner'>, pc: Addr, t: Addr): { s: Addr; n: number } | null {
  const { mem, owner } = ctx, P = rawPrinter(ctx, t);
  if (!P || P.ptr !== 'after') return null;
  const s = (pc + 2 + P.offset) & 0xffff;
  let max = 0; while (max < 256 && s + max < 0x10000 && owner[s + max] === owner[pc]) max++;
  const n = handedLen(mem, s, max, { len: P.len != null && P.len > P.offset ? P.len - P.offset : undefined, end: P.end });
  return n && s + n < 0x10000 && owner[s + n] === owner[pc] ? { s, n } : null;
}

/** Does the routine at `t` print the string after the JSR to it (decoded from its bytes, which may not be traced yet)?
 *  Only a routine that pulls its return address is looked at. */
export function printsAfter(ctx: Pick<Ctx, 'mem' | 'insLen' | 'skip' | 'owner'>, t: Addr): boolean {
  return ctx.owner[t] >= 0 && (popsReturn(ctx.mem, t) || returnUse(ctx.mem, ctx.owner, t).pulls) && rawPrinter(ctx, t)?.ptr === 'after';
}

/** The printer at `t`, decoded from its bytes over what is not traced yet: it and the routines it hands on to. */
function rawPrinter(ctx: Pick<Ctx, 'mem' | 'insLen' | 'skip' | 'owner'>, t: Addr): Printer | null {
  const { mem, owner } = ctx, insLen = ctx.insLen.slice(), view = { mem, insLen, skip: ctx.skip };
  // the routines decoded from their starts, over what is not traced yet: this one and the ones it hands on to
  const memo = new Map<Addr, Printer | null>();
  const printer = (a: Addr): Printer | null => {
    const rom = ROM_PRINTERS.get(a);
    if (rom || owner[a] < 0) return rom ?? null;
    if (memo.has(a)) return memo.get(a)!;
    memo.set(a, null);
    for (let p = a, k = 0; k < 64 && owner[p] === owner[a]; k++) {
      const o = OPC[mem[p]];
      if (o.jam || o.unstable) break;
      if (!insLen[p]) insLen[p] = o.len;
      p = (p + o.len) & 0xffff;
    }
    const P = ownPrinter(view, a, printer);
    memo.set(a, P);
    return P;
  };
  return printer(t);
}

/** A byte of the return address a JSR pushed (`r`: 0 the low, 1 the high one), plus `k`; null: anything else. */
type RetByte = { r: 0 | 1; k: number } | null;
/** What a routine does with its return address: pulls it (`early`: before any branch or call), and goes on `on` bytes
 *  after it. */
interface ReturnUse { pulls: boolean; early: boolean; on: number | null }
const returnUses = new WeakMap<Uint8Array, Map<Addr, ReturnUse>>();

/**
 * What the routine at `t` does with its return address, decoded from its bytes (it may not be traced yet): whether it
 * pulls it off the stack before any branch or call, and how far past the address the JSR pushed (its last byte) the
 * code goes on. It puts it back plus k (`pla / clc / adc #2 / tax / pla / adc #0 / pha / txa / pha`: an RTS goes on
 * k + 1 bytes after it), or jumps through it (`jmp (zp)`, k bytes after it). `on` is null when not found.
 */
function returnUse(mem: Uint8Array, owner: Int16Array, t: Addr): ReturnUse {
  let memo = returnUses.get(mem);
  if (!memo) returnUses.set(mem, memo = new Map());
  const known = memo.get(t);
  if (known) return known;
  const R: { a: RetByte; x: RetByte; y: RetByte } = { a: null, x: null, y: null };
  const stores = new Map<Addr, RetByte>(), stack: RetByte[] = [];
  let pulled = 0, early = false, branched = false, carry: number | null = null, on: number | null = null;
  // once through each instruction: not round a loop again (a loop that reads the bytes after the JSR one by one goes
  // on where it ends), but on into a routine it jumps to
  const seen = new Set<Addr>();
  const add = (v: RetByte, k: number): RetByte => (v && (v.r === 1 ? v : { r: 0, k: v.k + k }));
  for (let pc = t, n = 0; n < 48 && owner[pc] === owner[t] && on == null && !seen.has(pc); n++) {
    seen.add(pc);
    const o = OPC[mem[pc]], d = decode(mem, pc), next = (pc + o.len) & 0xffff, { mn, mode } = o;
    if (o.jam || o.unstable || o.flow === 'brk' || o.flow === 'ret') break;
    if (o.flow === 'jmpi') {
      const lo = stores.get(d.v!), hi = stores.get((d.v! + 1) & 0xffff);
      if (lo?.r === 0 && hi?.r === 1) on = lo.k;
      break;
    }
    if (o.flow === 'jmp') { pc = d.target!; continue; }
    if (o.flow === 'jsr' || o.flow === 'br') {
      if (!pulled) branched = true;
      if (o.flow === 'jsr') { R.a = R.x = R.y = null; carry = null; }
      pc = next; continue;
    }
    const at = mode === 'zp' || mode === 'abs' ? d.target! : null;
    switch (mn) {
      case 'PHA': stack.push(R.a); break;
      case 'PHP': stack.push(null); break;
      case 'PLA':
        if (stack.length) R.a = stack.pop()!;
        else { R.a = pulled < 2 ? { r: pulled as 0 | 1, k: 0 } : null; pulled++; if (!branched) early = true; }
        break;
      case 'PLP': if (stack.length) stack.pop(); else pulled++; carry = null; break;
      case 'TXS': n = 48; break;
      case 'CLC': carry = 0; break;
      case 'SEC': carry = 1; break;
      case 'ADC': case 'SBC': {
        const a = R.a;
        R.a = a?.r === 1 ? a : a && mode === 'imm' && carry != null ? add(a, mn === 'ADC' ? d.v! + carry : -d.v! - 1 + carry) : null;
        carry = null;
        break;
      }
      case 'STA': case 'STX': case 'STY': if (at != null) stores.set(at, mn === 'STA' ? R.a : mn === 'STX' ? R.x : R.y); break;
      case 'LDA': R.a = at != null ? stores.get(at) ?? null : null; break;
      case 'LDX': R.x = at != null ? stores.get(at) ?? null : null; break;
      case 'LDY': R.y = at != null ? stores.get(at) ?? null : null; break;
      case 'TAX': R.x = R.a; break; case 'TAY': R.y = R.a; break;
      case 'TXA': R.a = R.x; break; case 'TYA': R.a = R.y; break;
      case 'INC': case 'DEC': if (at != null) stores.set(at, add(stores.get(at) ?? null, mn === 'INC' ? 1 : -1)); break;
      case 'INX': case 'DEX': R.x = add(R.x, mn === 'INX' ? 1 : -1); break;
      case 'INY': case 'DEY': R.y = add(R.y, mn === 'INY' ? 1 : -1); break;
      default:
        if (writesA(mn, mode)) R.a = null;
        if (mn === 'TSX' || mn === 'LAX') R.x = null;
        if (o.access === 'write' || o.access === 'rmw') { if (at != null) stores.set(at, null); }
        if (mn === 'CMP' || mn === 'CPX' || mn === 'CPY' || SHIFT_MN.has(mn) || CLOBBER_A.has(mn)) carry = null;
    }
    // the return address back on the stack, plus k: an RTS goes on k + 1 bytes after it
    if (pulled === 2 && stack.length >= 2 && stack[0]?.r === 1 && stack[1]?.r === 0) on = stack[1].k + 1;
    pc = next;
  }
  const use = { pulls: pulled > 0, early, on };
  memo.set(t, use);
  return use;
}

/**
 * What follows the JSR at `pc` to `t`, when the routine reads it (5.5b): a string it prints, or `n` bytes it goes on
 * after (the address of a call into another bank, say); the code goes on after either. 'unknown': it pulls its return
 * address (`popsReturn`), but where it goes on is not found. Null: it returns as a routine does.
 */
export function inlineAfter(ctx: Pick<Ctx, 'mem' | 'insLen' | 'skip' | 'owner'>, pc: Addr, t: Addr): { s: Addr; n: number; string: boolean } | 'unknown' | null {
  const { mem, owner } = ctx;
  if (owner[t] < 0) return null;
  const pops = popsReturn(mem, t), use = returnUse(mem, owner, t);
  if (!pops && !use.pulls) return null;
  // also a routine that hands on to one that prints it (`jsr setcursor / jmp print`)
  const str = inlineString(ctx, pc, t);
  if (str) return { ...str, string: true };
  if (!pops && !use.early) return null;
  if (use.on == null) return pops ? 'unknown' : null;
  // back where it was called from: a routine that keeps its return address as it is
  if (use.on <= 1) return pops ? 'unknown' : null;
  const s = (pc + 3) & 0xffff, n = use.on - 1;
  return s + n < 0x10000 && owner[s + n] === owner[pc] ? { s, n, string: false } : 'unknown';
}
