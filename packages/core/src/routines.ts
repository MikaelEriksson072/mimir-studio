/* Routines known from other projects (spec 10.5). A routine the user names leaves a fingerprint: its bytes, with the
 * addresses that follow the program when it is linked elsewhere masked out, as IDA's FLIRT masks the relocated bytes
 * of a library function. A routine of another project with the same opcodes, whose bytes are the same wherever the
 * fingerprint is not masked, is the same routine at another address: its name is suggested there.
 *
 * What is masked: the operand of an absolute instruction (abs, abs,x, abs,y and the indirect JMP) that points into
 * $0400-$cfff, where programs and their data are, and an immediate the analysis read as half of such an address
 * (`lda #<text`, `ldy #>text`). What stays: opcodes, zero-page addresses, branch offsets, other immediates, and
 * absolute addresses below $0400 (the system's variables and vectors) and from $d000 (I/O and the KERNAL), which are
 * the same in every program and tell routines apart best (`sta $d020`, `jsr $ffd2`). */
import type { Addr, AnalysisResult, EntryKind } from './types';
import { OPC } from './cpu/opcodes';
import { h2 } from './util/hex';

/** a routine as it is in a program: its instructions from `start` to `end` (the address after its last one) */
export interface Routine {
  start: Addr;
  end: Addr;
  /** how many instructions */
  n: number;
  /** its opcodes in address order, as hex: what a fingerprint is looked up by */
  opcodes: string;
  /** all its bytes as hex, `..` for a masked one */
  pattern: string;
  /** how many of its bytes are not masked */
  fixed: number;
}

/** a routine the library knows: its name, its fingerprint, and the project it was named in */
export interface KnownRoutine {
  name: string;
  opcodes: string;
  pattern: string;
  /** the project it was named in */
  from?: string;
  /** when (ms) */
  saved?: number;
}

/** a routine of the program that the library knows */
export interface RoutineMatch { addr: Addr; end: Addr; name: string; from?: string }

type Code = Pick<AnalysisResult, 'mem' | 'insLen' | 'hints'>;

/** At most this many instructions make a fingerprint (a routine that goes on is cut there, each time the same). */
export const ROUTINE_MAX = 1024;
/** A fingerprint with masked bytes has at least this many instructions, this many different opcodes and this many bytes
 *  that are not masked: a shorter one (`lda $xxxx,x / sta $xxxx,x / inx / bne / rts`) is every copy loop, whatever it
 *  copies. One without a masked byte is the same bytes wherever it is found, so `exact` bytes are enough
 *  (`bit $d011 / bpl / bit $d011 / bmi / rts`, in 27 of 428 programs measured). */
export const ROUTINE_MIN = { n: 8, opcodes: 5, fixed: 14, exact: 8 };

/** the entry points that start a routine a name is learned from, and suggested at: not a branch's or a jump's target,
 *  which is a place inside one, nor a guess */
const ROUTINE_KINDS: ReadonlySet<EntryKind> = new Set<EntryKind>(['entry', 'irq', 'nmi', 'brk', 'sub', 'ptr', 'user']);
export const startsRoutine = (k: EntryKind | undefined): boolean => k != null && ROUTINE_KINDS.has(k);

/** an absolute address that follows the program when it is linked elsewhere */
const relocatable = (t: number): boolean => t >= 0x0400 && t < 0xd000;

/** The routine that starts at `start`: its instructions in address order up to the first RTS, RTI, JMP, BRK or JAM that
 *  no branch of it goes past (or to where the code ends). Null when no instruction starts there. */
export function routineAt(A: Code, start: Addr): Routine | null {
  const { mem, insLen, hints } = A;
  if (!insLen[start]) return null;
  const base = start - (start & 0xffff), limit = base + 0x10000;
  let pc = start, far = start, n = 0, fixed = 0, opcodes = '', pattern = '';
  while (n < ROUTINE_MAX && pc < limit && insLen[pc]) {
    const o = OPC[mem[pc]];
    if (pc + o.len > limit) break;
    const b1 = mem[pc + 1], b2 = mem[pc + 2];
    opcodes += h2(o.op); pattern += h2(o.op); fixed++; n++;
    if (o.len === 3) {
      if (relocatable(b1 | (b2 << 8))) pattern += '....';
      else { pattern += h2(b1) + h2(b2); fixed += 2; }
    } else if (o.len === 2) {
      const h = o.mode === 'imm' ? hints.get(pc) : undefined;
      if (h && relocatable(h.target & 0xffff)) pattern += '..';
      else { pattern += h2(b1); fixed++; }
      if (o.mode === 'rel') { const t = pc + 2 + ((b1 ^ 0x80) - 0x80); if (t > far) far = t; }
    }
    pc += o.len;
    if ((o.flow === 'ret' || o.flow === 'jmp' || o.flow === 'jmpi' || o.flow === 'brk' || o.flow === 'jam') && pc > far) break;
  }
  return { start, end: pc, n, opcodes, pattern, fixed };
}

/** Whether a routine is enough to know it again by (ROUTINE_MIN). */
export function learnable(r: Routine | null): r is Routine {
  if (!r) return false;
  if (r.fixed === r.end - r.start) return r.fixed >= ROUTINE_MIN.exact;
  if (r.n < ROUTINE_MIN.n || r.fixed < ROUTINE_MIN.fixed) return false;
  const seen = new Set<string>();
  for (let i = 0; i < r.opcodes.length; i += 2) seen.add(r.opcodes.slice(i, i + 2));
  return seen.size >= ROUTINE_MIN.opcodes;
}

/** Whether the routine `r` is the known one `k`: the same opcodes, and the same bytes wherever `k` is not masked
 *  (what `r` masks does not count: its analysis may have read an immediate another way). */
export function sameRoutine(k: Pick<KnownRoutine, 'opcodes' | 'pattern'>, r: Routine, mem: Uint8Array): boolean {
  if (k.opcodes !== r.opcodes || k.pattern.length !== (r.end - r.start) * 2) return false;
  for (let i = 0; i < r.end - r.start; i++) {
    const c = k.pattern.charCodeAt(i * 2);
    if (c !== 46 /* . */ && parseInt(k.pattern.substr(i * 2, 2), 16) !== mem[r.start + i]) return false;
  }
  return true;
}

const fixedOf = (pattern: string): number => { let n = 0; for (let i = 0; i < pattern.length; i += 2) if (pattern.charCodeAt(i) !== 46) n++; return n; };

/** The library with the routine `r` in it as `name`: in place of the entry with its fingerprint (a routine has one
 *  name), beside the ones of the same name (a routine's variants). The same array when nothing changes, or `r` is too
 *  short to know again. */
export function learnRoutine(library: readonly KnownRoutine[], r: Routine | null, name: string, from?: string, at?: number): readonly KnownRoutine[] {
  if (!name || !learnable(r)) return library;
  const old = library.find(k => k.opcodes === r.opcodes && k.pattern === r.pattern);
  if (old && old.name === name) return library;
  const entry: KnownRoutine = { name, opcodes: r.opcodes, pattern: r.pattern, ...(from ? { from } : {}), ...(at != null ? { saved: at } : {}) };
  return [...library.filter(k => k !== old), entry];
}

/** The library with what the program's named routines teach: `names` are the user's names by address (Project.labels). */
export function learnProject(library: readonly KnownRoutine[], A: Code & Pick<AnalysisResult, 'entryKind'>, names: Readonly<Record<Addr, string>>, from?: string, at?: number): readonly KnownRoutine[] {
  let lib = library;
  for (const [a, name] of Object.entries(names)) {
    const addr = +a;
    if (name && startsRoutine(A.entryKind.get(addr))) lib = learnRoutine(lib, routineAt(A, addr), name, from, at);
  }
  return lib;
}

/** The routines of the program that the library knows, by address. Of several known ones a routine is, the one with
 *  the most bytes that are not masked, then the one learned last. */
export function knownRoutines(A: Code & Pick<AnalysisResult, 'entryKind'>, library: readonly KnownRoutine[]): RoutineMatch[] {
  if (!library.length) return [];
  const by = new Map<string, KnownRoutine[]>();
  for (const k of library) { const l = by.get(k.opcodes); if (l) l.push(k); else by.set(k.opcodes, [k]); }
  // (a routine's first opcode: most entry points are told apart without reading on)
  const first = new Set<number>();
  for (const k of by.keys()) first.add(parseInt(k.slice(0, 2), 16));
  const out: RoutineMatch[] = [];
  for (const [addr, kind] of A.entryKind) {
    if (!startsRoutine(kind) || !A.insLen[addr] || !first.has(A.mem[addr])) continue;
    const r = routineAt(A, addr);
    if (!learnable(r)) continue;
    let best: KnownRoutine | null = null, bestFixed = -1;
    for (const k of by.get(r.opcodes) ?? []) {
      if (!sameRoutine(k, r, A.mem)) continue;
      const f = fixedOf(k.pattern);
      if (f > bestFixed || (f === bestFixed && (k.saved ?? 0) >= (best?.saved ?? 0))) { best = k; bestFixed = f; }
    }
    if (best) out.push({ addr, end: r.end, name: best.name, ...(best.from ? { from: best.from } : {}) });
  }
  return out.sort((x, y) => x.addr - y.addr);
}

/** The names to suggest: the matches whose address the user has not named and whose name the analysis does not
 *  already give it; a name that is taken (`taken`: every name of the program, or a suggestion before it) gets `_2`,
 *  `_3` … after it, and one `valid` refuses (the project's assembler) is left out. */
export function routineSuggestions(matches: readonly RoutineMatch[], userNames: Readonly<Record<Addr, string>>, nameAt: (a: Addr) => string | undefined,
  taken: Iterable<string>, valid: (name: string) => boolean = () => true): RoutineMatch[] {
  const used = new Set(taken), out: RoutineMatch[] = [];
  for (const m of matches) {
    if (userNames[m.addr] || nameAt(m.addr) === m.name || !valid(m.name)) continue;
    let name = m.name;
    for (let i = 2; used.has(name); i++) name = `${m.name}_${i}`;
    used.add(name);
    out.push({ ...m, name });
  }
  return out;
}

const isHex = (s: unknown, masks: boolean): s is string => typeof s === 'string' && s.length >= 2 && s.length % 2 === 0 && (masks ? /^(?:[0-9a-f]{2}|\.\.)+$/ : /^[0-9a-f]+$/).test(s);

/** A library as it was stored (JSON), with what is not an entry left out. */
export function readRoutineLibrary(v: unknown): KnownRoutine[] {
  if (!Array.isArray(v)) return [];
  const out: KnownRoutine[] = [];
  for (const k of v as Partial<KnownRoutine>[]) {
    if (!k || typeof k.name !== 'string' || !k.name || !isHex(k.opcodes, false) || !isHex(k.pattern, true)) continue;
    out.push({ name: k.name, opcodes: k.opcodes, pattern: k.pattern, ...(typeof k.from === 'string' && k.from ? { from: k.from } : {}), ...(Number.isFinite(k.saved) ? { saved: k.saved } : {}) });
  }
  return out;
}
