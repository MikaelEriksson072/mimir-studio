/* =====================================================================
 * 5.17 deep analysis (Settings.deepAnalysis): re-analyses until the problems are at a minimum.
 * Every round is a whole analysis. Inside one, a guess (a code island, a pointer-table target, an interrupt
 * handler, the load address without a BASIC stub) is traced on trial first and kept only when it runs into no
 * problem (`settle`), and a branch whose flags the instruction before it sets follows only the side it takes.
 * What a round learns, the next one uses while it traces: the $01 configuration of every instruction (a JSR or
 * JMP into ROM is not followed into the RAM below), the bytes code writes (a JSR or JMP whose operand is written
 * has its target set at run time, and a path stops quietly at an instruction code writes that is BRK or JAM now) and
 * the routines that never return (the bytes after a JSR to one are not code). A JSR or JMP to a BRK or JAM is not
 * followed either: the routine is put there at run time. The rounds end when the next one would decide the same. The
 * result is the deep one unless it has more faults than the normal analysis: warnings and errors that say code is read
 * wrongly. An indirect jump whose target is not known and a tip are no faults; more code read finds more of them.
 * ===================================================================== */
import { SOLVED, type Addr, type AnalysisResult, type DeepReport, type EntryKind, type GoneWhy, type LogEntry } from '../types';
import { cutKey, type Ctx, type CutWhy, type Deep } from './context';
import { OPC } from '../cpu/opcodes';
import { decode } from '../cpu/decode';
import { areaAt, banked, portsOf, reaches, type CartMode } from '../c64/memconfig';
import { $4 } from '../util/hex';
import { textUnderCode } from './strings';

/** What the Problems tab lists from the log. */
export const isProblem = (l: LogEntry): boolean => l.lvl === 'warn' || l.lvl === 'err' || l.lvl === 'hint';
export const problemCount = (log: LogEntry[]): number => log.filter(isProblem).length;
/** A problem that says code is read wrongly (a JAM, a BRK, an overlap, a jump into an instruction): not a tip, nor an
 *  indirect jump whose target is not known, which come with the code read. */
export const isFault = (l: LogEntry): boolean => (l.lvl === 'warn' || l.lvl === 'err') && l.code !== 'ijmp-unknown';
export const faultCount = (log: LogEntry[]): number => log.filter(isFault).length;

/**
 * Why the JSR or JMP at `pc` to `t` is not followed, by what the round before learned; null: it is. `guess`: the code
 * is a guess traced on trial, which a routine that is not there yet does not excuse. `newPort`: the configurations new
 * code runs with (an interrupt handler on trial: those its vectors need), else the main code's.
 */
export function cutFor(deep: Deep, loaded: (a: Addr) => boolean, mem: Uint8Array, pc: Addr, t: Addr, guess = false, cart: CartMode = 'none', newPort = 0): CutWhy | null {
  if (deep.written && (deep.written[(pc + 1) & 0xffff] || deep.written[(pc + 2) & 0xffff])) return 'smc';
  // ROM (or I/O) in every configuration the instruction can run with; new code runs with the main code's. A
  // cartridge's ROM is the program's own bytes
  const port = deep.port?.[pc] || newPort || deep.main;
  if (port && loaded(t) && banked(t, cart) && reaches(t, port, false, cart) === 'hw') return 'rom';
  // no routine starts with BRK or JAM: the code there is put in place at run time (unpacked or copied)
  if (!guess && loaded(t) && (mem[t] === 0x00 || OPC[mem[t]].jam)) return 'empty';
  return null;
}

/** Does the routine at `t` never return: every path in the traced code ends in a loop, without RTS, RTI or JMP (ind)? */
function neverReturns(A: AnalysisResult, cuts: Map<number, CutWhy>, t: Addr): boolean {
  const { mem, insLen, skip, inlineCalls } = A;
  const stack = [t], vis = new Set<number>();
  while (stack.length) {
    const n = stack.pop()!;
    if (vis.has(n)) continue;
    if (vis.size > 4000 || !insLen[n]) return false; // too far, or out of the traced code: it may return
    vis.add(n);
    const o = OPC[mem[n]], next = (n + o.len) & 0xffff;
    if (skip.has(n)) { stack.push(next); continue; }
    const d = decode(mem, n);
    switch (o.flow) {
      case 'jmp': if (cuts.has(cutKey(n, d.target!))) return false; stack.push(d.target!); break; // into ROM: a tail call
      case 'br': stack.push(d.target!, next); break;
      case 'jsr': if (inlineCalls.has(n)) return false; if (cuts.get(cutKey(n, next)) !== 'noreturn') stack.push(next); break;
      case 'ret': case 'jmpi': case 'brk': case 'jam': return false;
      default: stack.push(next);
    }
  }
  return true;
}

/**
 * What round `A` teaches the next one, into `deep`. Returns whether the next round can decide differently: on this
 * round's code, or in the configuration that new code is assumed to run with.
 */
export function learn(A: AnalysisResult, ctx: Ctx, deep: Deep): boolean {
  const { mem, insLen, skip, xrefs, mcfg, owner, inlineCalls } = A;
  const port = mcfg?.port ?? null;
  // code under ROM or I/O only runs with RAM there: the main code is the rest
  let main = 0;
  if (port) for (let a = 0; a < 0x10000; a++) if (insLen[a] && !banked(a)) main |= port[a];
  const written = new Uint8Array(0x10000);
  for (const [to, xs] of xrefs) if (xs.some(x => (x.kind === 'write' || x.kind === 'rmw') && insLen[x.from])) written[to] = 1;
  // the strings handed to print routines that the round's code islands took: the next round's keep out of them
  const text = new Set([...deep.text, ...textUnderCode(ctx)]);
  const next: Deep = { port, main, written, noReturn: new Set(), text };
  const loaded = (a: Addr) => owner[a] >= 0;
  const would = new Map<number, CutWhy>();
  const calls: Addr[] = [];
  for (let pc = 0; pc < 0x10000; pc++) {
    if (!insLen[pc] || skip.has(pc)) continue;
    const o = OPC[mem[pc]];
    if ((o.flow !== 'jsr' && o.flow !== 'jmp') || o.mode !== 'abs') continue;
    const t = decode(mem, pc).target!, why = cutFor(next, loaded, mem, pc, t, false, ctx.cart);
    if (why) would.set(cutKey(pc, t), why);
    else if (o.flow === 'jsr' && !inlineCalls.has(pc) && insLen[t]) calls.push(pc);
  }
  for (const pc of calls) {
    if (!neverReturns(A, would, decode(mem, pc).target!)) continue;
    next.noReturn.add(pc);
    would.set(cutKey(pc, pc + 3), 'noreturn');
  }
  const same = would.size === ctx.cuts.size && [...would].every(([k, w]) => ctx.cuts.get(k) === w);
  const changed = !same || main !== deep.main || text.size !== deep.text.size;
  Object.assign(deep, next);
  return changed;
}

const AREA = { kernal: 'KERNAL ROM', basic: 'BASIC ROM', io: 'I/O', char: 'character ROM', ram: 'RAM', cart: 'cartridge ROM' } as const;
const list = (as: Addr[]) => as.slice(0, 4).map($4).join(', ') + (as.length > 4 ? ', …' : '');
const KIND: Partial<Record<EntryKind, string>> = { ptr: 'pointer-table target', irq: 'IRQ handler', nmi: 'NMI handler', brk: 'BRK handler' };

/** How many of a deep analysis's gone problems are solved (the code read right), decided on a guess, or neither. */
export function goneCounts(d: Pick<DeepReport, 'gone'>): { solved: number; decided: number; other: number } {
  const out = { solved: 0, decided: 0, other: 0 };
  for (const [k, n] of Object.entries(d.gone) as [GoneWhy, number][]) out[SOLVED.has(k) ? 'solved' : k === 'other' ? 'other' : 'decided'] += n;
  return out;
}

/** Two deep reports added up (a cartridge's banks, 13.9b). */
export function addDeepReports(a: DeepReport, b: DeepReport): DeepReport {
  const gone = { ...a.gone };
  for (const [k, n] of Object.entries(b.gone) as [GoneWhy, number][]) gone[k] = (gone[k] ?? 0) + n;
  return {
    rounds: Math.max(a.rounds, b.rounds), before: a.before + b.before, after: a.after + b.after, rejected: a.rejected + b.rejected,
    cuts: a.cuts + b.cuts, branches: a.branches + b.branches, blamed: a.blamed + b.blamed, gone, added: a.added + b.added, ms: a.ms + b.ms,
    decisions: { guesses: [...a.decisions.guesses, ...b.decisions.guesses], sides: [...a.decisions.sides, ...b.decisions.sides], runTime: [...a.decisions.runTime, ...b.decisions.runTime] },
  };
}

/** A problem by its kind and place (its address, or none), to find it in another analysis's log. */
const problemKey = (l: LogEntry) => `${l.code}@${l.addr ?? ''}`;

/** The start of the instruction the normal analysis `N` had where the instruction at `pc` overlaps it (`overlap`), or
 *  that the jump to `pc` goes into the middle of (`mid-instruction`). */
function overlapped(N: AnalysisResult, l: LogEntry): Addr | null {
  const pc = l.addr!;
  if (l.code === 'mid-instruction') return N.codeOwner[pc] >= 0 ? N.codeOwner[pc] : null;
  for (let k = 1; k < OPC[N.mem[pc]].len; k++) {
    const b = (pc + k) & 0xffff;
    if (N.insLen[b]) return b;
    if (N.codeOwner[b] >= 0) return N.codeOwner[b];
  }
  return null;
}

/**
 * Why each problem of the normal analysis `N` is gone in the deep one `A` (8.11e): by what the deep analysis has now
 * where the problem was, or by what lies behind its decisions (`behind`). Also how many problems are new.
 */
export function goneWhy(N: AnalysisResult, A: AnalysisResult, ctx: Ctx, behind: Map<Addr, GoneWhy>): { gone: Partial<Record<GoneWhy, number>>; added: number } {
  const now = new Set(A.log.filter(isProblem).map(problemKey)), was = new Set(N.log.filter(isProblem).map(problemKey));
  const gone: Partial<Record<GoneWhy, number>> = {};
  const why = (l: LogEntry): GoneWhy => {
    const a = l.addr;
    if (a == null) return 'other';
    // the code is there, without the problem: the jump's target found, $01 followed, the bytes of a tip read as code
    if (A.insLen[a] > 0 || A.codeOwner[a] >= 0) {
      if (l.code === 'ijmp-unknown' && A.insLen[a]) return 'pointer';
      if (l.code === 'port-unknown' && A.insLen[a]) return 'port';
      if (l.code === 'unreached') return 'kept';
    } else if (ctx.rejected.has(a)) return 'rejected';
    const b = behind.get(a);
    if (b) return b;
    // a BRK or JAM the code writes: the path stops there, as the instruction is set at run time
    if ((l.code === 'brk' || l.code === 'jam') && ctx.deep?.written?.[a]) return 'smc';
    // a tip about bytes in a block where a guess left out starts, near its start (as the tip is left out, 5.17)
    if (l.code === 'unreached') {
      const blk = A.blocks.find(x => a >= x.start && a < x.end);
      if (blk) for (let k = blk.start; k < blk.end && k < blk.start + 16; k++) if (ctx.rejected.has(k) && !A.insLen[k]) return 'rejected';
      // or its block began after code the normal analysis has and this one does not: for what lies behind that code
      const p = (a - 1) & 0xffff, s = N.insLen[p] ? p : N.codeOwner[p];
      if (s >= 0 && !A.insLen[s] && behind.get(s)) return behind.get(s)!;
    }
    // two readings overlapped: the other one is gone, for what lies behind it, or it chose
    if (l.code === 'overlap' || l.code === 'mid-instruction') {
      const o = overlapped(N, l);
      return (o != null && behind.get(o)) || 'chosen';
    }
    return 'other';
  };
  for (const l of N.log) {
    if (!isProblem(l) || now.has(problemKey(l))) continue;
    const w = why(l);
    gone[w] = (gone[w] ?? 0) + 1;
  }
  return { gone, added: A.log.filter(l => isProblem(l) && !was.has(problemKey(l))).length };
}

const GONE_TEXT: Record<GoneWhy, string> = {
  flags: 'on sides of branches the flags never take', rom: 'behind calls into ROM', smc: 'behind calls and jumps whose target the code writes',
  noreturn: 'after calls to routines that never return', pointer: 'at indirect jumps whose target is found', port: 'where $01 is followed',
  rejected: 'in guesses left out as data', kept: 'about bytes now read as code', blamed: 'on sides left out for a strong guess',
  runTime: 'in routines taken to be put in place at run time', chosen: 'where it chose one of two overlapping readings', other: 'for no reason found',
};

/**
 * The log lines of a deep analysis: what it did not follow and left out, why the normal analysis's problems are gone
 * (`behind`: what lies behind its decisions), and a summary (and `A.deep`).
 */
export function deepLog(A: AnalysisResult, ctx: Ctx, normal: AnalysisResult, behind: Map<Addr, GoneWhy>, rounds: number): void {
  const { mem, mcfg, xrefs, insLen } = A;
  const before = problemCount(normal.log);
  const L = (lvl: LogEntry['lvl'], msg: string, addr: Addr | null) => A.log.push({ lvl, msg, addr, cat: 'deep' });
  const rom = new Map<Addr, Addr[]>();
  for (const [k, why] of [...ctx.cuts].sort((x, y) => x[0] - y[0])) {
    const from = Math.floor(k / 0x10000), to = k & 0xffff, mn = OPC[mem[from]].mn;
    if (why === 'rom') { const s = rom.get(to) ?? []; s.push(from); rom.set(to, s); continue; }
    if (why === 'noreturn') { L('info', `The routine at ${$4(decode(mem, from).target!)} never returns, so the bytes after the JSR at ${$4(from)} are not traced`, from); continue; }
    if (why === 'empty') { L('info', `The ${mn} at ${$4(from)} goes to ${$4(to)}, which holds $${mem[to].toString(16).padStart(2, '0')}: the routine is put there at run time (unpacked or copied), so it is not traced`, from); continue; }
    const by = [from + 1, from + 2].flatMap(a => xrefs.get(a & 0xffff) || []).find(x => (x.kind === 'write' || x.kind === 'rmw') && insLen[x.from]);
    L('info', `${by ? `The code at ${$4(by.from)}` : 'Code'} writes the address of the ${mn} at ${$4(from)}, so its target ${$4(to)} is set at run time and is not followed`, from);
  }
  for (const [t, from] of rom) {
    const area = mcfg ? AREA[areaAt(t, portsOf(mcfg.port[from[0]])[0] ?? 7, false, mcfg.cart)] : 'ROM';
    L('info', `${from.length === 1 ? `The ${OPC[mem[from[0]]].mn} at ${$4(from[0])}` : `${from.length} calls and jumps (at ${list(from)})`} to ${$4(t)} reach${from.length === 1 ? 'es' : ''} the ${area} there, so the RAM below it is not traced`, from[0]);
  }
  // one line per data block: the first start left out in it, and how many more
  let rejected = 0;
  const groups = new Map<string, { a: Addr; kind: EntryKind; why: LogEntry; more: number; end: Addr }>();
  for (const [a, { kind, why }] of [...ctx.rejected].sort((x, y) => x[0] - y[0])) {
    if (insLen[a]) continue; // code after all, reached some other way
    rejected++;
    const b = kind === 'guess' ? A.blocks.find(x => a >= x.start && a < x.end) : undefined;
    const key = kind + (b ? b.start : a);
    const g = groups.get(key);
    if (g) { g.more++; g.end = a; } else groups.set(key, { a, kind, why, more: 0, end: a });
  }
  for (const { a, kind, why, more, end } of groups.values()) {
    const what = kind === 'entry' ? `The load address ${$4(a)} is not used as the entry point`
      : kind === 'guess' ? `The routine-like bytes at ${$4(a)}${more ? ` (and ${more} more start${more === 1 ? '' : 's'} up to ${$4(end)})` : ''} stay data`
        : `The ${KIND[kind]} at ${$4(a)} stays data`;
    L('info', `${what}: traced on trial, ${kind === 'guess' ? 'they run' : 'it runs'} into a problem (${why.msg.replace(/[.;].*$/, '')})`, a);
  }
  // a strong guess kept without the sides that ran into a problem on trial
  for (const [at, { side, guess, kind, why }] of [...ctx.blameCut].sort((x, y) => x[0] - y[0])) {
    const o = OPC[mem[at]], who = kind === 'entry' ? `The load address ${$4(guess)}` : `The ${KIND[kind]} at ${$4(guess)}`;
    const part = o.flow === 'jsr' ? `the bytes after the JSR at ${$4(at)}` : `the side of the ${o.mn} at ${$4(at)} that goes to ${$4(side)}`;
    L('info', `${who} is kept without ${part}: traced on trial, that runs into a problem (${why.msg.replace(/[.;].*$/, '')})`, at);
  }
  const after = problemCount(A.log), cuts = ctx.cuts.size, branches = ctx.flagCut.size, blamed = ctx.blameCut.size;
  const { gone, added } = goneWhy(normal, A, ctx, behind);
  const decisions = {
    guesses: [...ctx.rejected.keys()].filter(a => !insLen[a]).sort((x, y) => x - y),
    sides: [...ctx.blameCut.values()].map(c => c.side),
    runTime: [...ctx.cuts].filter(([, why]) => why === 'empty').map(([k]) => k & 0xffff),
  };
  A.deep = { rounds, before, after, rejected, cuts, branches, blamed, gone, added, decisions, ms: 0 };
  const s = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;
  // the problems gone: solved, the code read right, or decided on a guess (and those no reason explains)
  const c = goneCounts(A.deep), part = (keep: (k: GoneWhy) => boolean) => (Object.entries(gone) as [GoneWhy, number][]).filter(([k]) => keep(k)).sort((x, y) => y[1] - x[1]).map(([k, n]) => `${n} ${GONE_TEXT[k]}`).join(', ');
  if (c.solved + c.decided + c.other) {
    L('info', `Of the ${s(c.solved + c.decided + c.other, 'problem')} the normal analysis has and this one does not, ${c.solved} ${c.solved === 1 ? 'is' : 'are'} solved, the code read right${c.solved ? ` (${part(k => SOLVED.has(k))})` : ''}, and ${c.decided} decided on a guess${c.decided ? ` (${part(k => !SOLVED.has(k) && k !== 'other')})` : ''}${c.other ? `; ${c.other} ${GONE_TEXT.other}` : ''}${added ? `. It has ${s(added, 'problem')} the normal one does not, in code it reads further` : ''}`, null);
  } else if (added) L('info', `This analysis has ${s(added, 'problem')} the normal one does not, in code it reads further`, null);
  L('ok', `Deep analysis: ${before} → ${s(after, 'problem')} in ${s(rounds, 'round')} (${c.solved} solved, ${c.decided} decided${c.other ? `, ${c.other} other` : ''}): ${s(rejected, 'guess', 'guesses')} left out, ${s(cuts, 'call or jump', 'calls and jumps')} not followed, ${s(branches, 'branch', 'branches')} decided by the flags before ${branches === 1 ? 'it' : 'them'}${blamed ? `, ${s(blamed, 'side')} left out where a strong guess ran into a problem` : ''}`, null);
}
