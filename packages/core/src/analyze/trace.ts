/* 5.4 entry points and recursive-descent code tracing, 5.7 forced code; 5.17 tracing a guess on trial */
import type { Addr, EntryKind, GoneWhy, LogEntry } from '../types';
import { cutKey, forkTrace, type Ctx, type CutWhy, type Decision } from './context';
import { cutFor } from './deep';
import { KERNAL_IN, KERNAL_OUT } from './banks';
import { OPC, type OpcodeInfo } from '../cpu/opcodes';
import { T } from '../model';
import { decode } from '../cpu/decode';
import { $4, h2 } from '../util/hex';
import { inlineAfter } from './strings';

/** The program start set by the user, BASIC SYS targets, the first file's load address, user entries and code overrides. */
export function seedEntries(ctx: Ctx): void {
  const { basics, files, ov, project, enqueue, loaded, L } = ctx;
  // a start the user set replaces the detected one; a BASIC stub's SYS target is still code, the load address no longer is
  const userStart = project.entryPoint != null && loaded(project.entryPoint);
  if (userStart) { enqueue(project.entryPoint!, 'entry'); ctx.entry = project.entryPoint!; L('info', `Program start set by you: ${$4(project.entryPoint!)}`, project.entryPoint!, 'entry'); }
  else if (project.entryPoint != null) L('warn', `The program start you set (${$4(project.entryPoint)}) is not in a loaded file; using the detected one`, null, 'entry', 'entry-not-loaded');
  for (const b of basics) if (b.sys != null) { enqueue(b.sys, 'entry'); ctx.entry = ctx.entry ?? b.sys; }
  // a cartridge starts where its vectors point (5.3b), not at its first byte
  const cart = ctx.cartStart?.entries.filter(e => loaded(e.a)) ?? [];
  for (const e of cart) { enqueue(e.a, e.kind); if (e.kind === 'entry') ctx.entry = ctx.entry ?? e.a; }
  // a bank the C64 does not start in (13.9b) is traced from what calls it, its own vectors and the code marked
  if (project.bank != null && !userStart && !cart.length) L('info', `Bank ${project.bank} has no start of its own: it is traced from what other banks call in it and from the code you mark (C)`, null, 'entry');
  else if (files.length && !userStart && !cart.length && !basics.some(b => b.file === 0) && !ov[files[0].load]) {
    // a deep analysis traces the load address on trial, like any guess (`settle`)
    if (ctx.deep) ctx.pending.push({ a: files[0].load, kind: 'entry' });
    else loadEntry(ctx);
  }
  for (const a of project.entries || []) enqueue(a, 'user');
  // what other banks of the cartridge call here (13.9b)
  for (const a of project.calls || []) if (loaded(a)) enqueue(a, 'sub');
  for (const o of ctx.ovList) if (o.type === 'code') enqueue(o.start, 'user');
}

function loadEntry(ctx: Ctx): void {
  const f = ctx.files[0];
  ctx.enqueue(f.load, 'entry'); ctx.entry = ctx.entry ?? f.load;
  ctx.L('info', `No BASIC stub in ${f.name}; using load address ${$4(f.load)} as entry point`, f.load, 'entry');
}

const BRANCH_ON: Record<string, [string, boolean]> = {
  BCC: ['C', false], BCS: ['C', true], BVC: ['V', false], BVS: ['V', true], BEQ: ['Z', true], BNE: ['Z', false], BMI: ['N', true], BPL: ['N', false],
};

/** The flags a straight run of code has set for sure: each with its value and the instruction that set it. */
type Flags = Partial<Record<'C' | 'V' | 'Z' | 'N', [boolean, number]>>;
const NO_FLAGS = new Set(['STA', 'STX', 'STY', 'SAX', 'PHA', 'PHP', 'SEI', 'CLI', 'SED', 'CLD', 'NOP', 'TXS']);
const NZ_ONLY = new Set(['LDA', 'LDX', 'LDY', 'TAX', 'TAY', 'TXA', 'TYA', 'TSX', 'INX', 'INY', 'DEX', 'DEY', 'INC', 'DEC', 'AND', 'ORA', 'EOR', 'PLA']);

/** The flags after the instruction `o` at `pc` (operand `v`): CLC, SEC and CLV set C and V, a load of a constant Z and N. */
function flagsAfter(f: Flags, o: OpcodeInfo, v: number, pc: number): Flags {
  if (NO_FLAGS.has(o.mn)) return f;
  if (o.mn === 'CLC' || o.mn === 'SEC') return { ...f, C: [o.mn === 'SEC', pc] };
  if (o.mn === 'CLV') return { ...f, V: [false, pc] };
  if (!NZ_ONLY.has(o.mn)) return {};
  const load = o.mode === 'imm' && (o.mn === 'LDA' || o.mn === 'LDX' || o.mn === 'LDY');
  return load ? { C: f.C, V: f.V, Z: [v === 0, pc], N: [v >= 0x80, pc] } : { C: f.C, V: f.V };
}

export function trace(ctx: Ctx): void {
  const { queue, mem, insLen, codeOwner, skip, loaded, forcedData, addX, enqueue, ijumps, inlineCalls, entryKind, flagCut, S, L } = ctx;
  const { deep, cuts, blameCut, decOf, blame, newIns } = ctx;
  // a deep analysis does not follow a JSR or JMP into ROM or through an operand that code writes
  const follow = (from: number, to: number) => {
    const why = deep && !insLen[to] && cutFor(deep, loaded, mem, from, to, ctx.onTrial, ctx.cart, ctx.trialPort);
    if (why) cuts.set(cutKey(from, to), why);
    return !why;
  };
  // the way to each address queued and to each problem: the last decision on it (`trial` blames it)
  const via = (t: number, d: Decision | null) => { t &= 0xffff; if (!decOf.has(t)) decOf.set(t, d); };
  while (queue.length) {
    let pc = queue.pop()!;
    // the flags this run has set, which a deep analysis reads at a branch
    let flags: Flags = {};
    let dec = decOf.get(pc) ?? null;
    const blamed = () => { if (!blame.has(pc)) blame.set(pc, dec); };
    for (;;) {
      if (!loaded(pc)) break;
      if (insLen[pc]) break;
      if (codeOwner[pc] >= 0) {
        const s = codeOwner[pc], op = mem[s];
        if ((op === 0x2c || op === 0x24) && pc === s + 1 && !skip.has(s)) {
          skip.add(s); insLen[s] = 1;
          for (let k = 1; k < OPC[op].len; k++) codeOwner[s + k] = -1;
          L('info', `BIT-skip idiom at ${$4(s)}: $${h2(op)} hides the instruction at ${$4(pc)}`, s, 'code');
        } else {
          blamed();
          L('warn', `Jump into the middle of the instruction at ${$4(s)} (target ${$4(pc)}); overlapping code is not traced`, pc, 'code', 'mid-instruction');
          break;
        }
      }
      if (forcedData(pc)) {
        blamed();
        const r = ctx.ov[pc] === T.RELOC ? ctx.relocs.find(x => pc >= x.start && pc < x.end) : undefined;
        if (r) L('warn', `Code path runs into ${$4(pc)}, where the block that runs at ${$4(r.to)} is loaded (relocated): it is traced where it runs, at ${$4(r.to + pc - r.start)}`, pc, 'code', 'into-relocated');
        else L('warn', `Code path runs into user-defined data at ${$4(pc)}`, pc, 'code', 'into-user-data');
        break;
      }
      const info = OPC[mem[pc]];
      // a deep analysis: code writes the instruction here, BRK or JAM now, so it is set at run time
      if (deep?.written?.[pc] && !ctx.onTrial && (info.jam || info.flow === 'brk')) { L('info', `The code writes the instruction at ${$4(pc)} ($${h2(mem[pc])} now), so it is set at run time and the path stops there`, pc, 'deep'); break; }
      if (info.jam) { blamed(); L('err', `JAM opcode $${h2(mem[pc])} reached at ${$4(pc)}; the path probably runs into data`, pc, 'code', 'jam'); break; }
      if (info.ill && !S.illegal) { blamed(); L('warn', `Undocumented opcode $${h2(mem[pc])} at ${$4(pc)} stops tracing (undocumented opcodes are disabled)`, pc, 'code', 'undocumented-off'); break; }
      let ok = true;
      for (let k = 1; k < info.len; k++) {
        const b = (pc + k) & 0xffff;
        // every byte must be loaded by the same file: an instruction never crosses a file end (spec 7.3)
        if (!loaded(b) || ctx.owner[b] !== ctx.owner[pc] || insLen[b] || codeOwner[b] >= 0 || forcedData(b)) { ok = false; break; }
      }
      if (!ok && (mem[pc] === 0x2c || mem[pc] === 0x24) && insLen[(pc + 1) & 0xffff]) {
        skip.add(pc); insLen[pc] = 1;
        L('info', `BIT-skip idiom at ${$4(pc)}: $${h2(mem[pc])} hides the instruction at ${$4(pc + 1)}`, pc, 'code');
        break;
      }
      if (!ok) { blamed(); L('warn', `Instruction at ${$4(pc)} would overlap other code or leave the file; tracing stopped`, pc, 'code', 'overlap'); break; }
      insLen[pc] = info.len;
      for (let k = 1; k < info.len; k++) codeOwner[(pc + k) & 0xffff] = pc;
      newIns?.push(pc);
      if (entryKind.has(pc)) flags = {}; // reached some other way too
      const d = decode(mem, pc), next = (pc + info.len) & 0xffff;
      if (info.flow === 'br') {
        addX(d.target!, pc, 'branch');
        // the flags the run set decide (`releaseFlags` takes that back when the run is entered some other way)
        const [f, when] = BRANCH_ON[info.mn], set = deep && d.target !== next ? flags[f as keyof Flags] : undefined;
        const known = set ? set[0] === when : null;
        // a side that ran into a problem when a strong guess was traced on trial is left out
        const cut = blameCut.get(pc)?.side;
        if (known !== false && cut !== d.target) { via(d.target!, { at: pc, side: d.target! }); enqueue(d.target!, 'branch'); }
        if (known === true) { flagCut.set(pc, { side: next, by: set![1] }); break; }
        if (known === false) flagCut.set(pc, { side: d.target!, by: set![1] });
        if (cut === next && d.target !== next) break;
        dec = { at: pc, side: next };
        pc = next; continue;
      }
      if (info.flow === 'jmp') { addX(d.target!, pc, 'jump'); if (follow(pc, d.target!)) { via(d.target!, dec); enqueue(d.target!, 'jmp'); } break; }
      if (info.flow === 'jmpi') { addX(d.v!, pc, 'ptr'); ijumps.push({ pc, ptr: d.v! }); break; }
      if (info.flow === 'jsr') {
        addX(d.target!, pc, 'call');
        if (follow(pc, d.target!)) { via(d.target!, dec); enqueue(d.target!, 'sub'); }
        if (deep?.noReturn.has(pc)) { cuts.set(cutKey(pc, next), 'noreturn'); break; } // the routine never returns
        const t = d.target!;
        // a routine that reads what follows the JSR: a string it prints or bytes it goes on after (5.5b)
        const after = loaded(t) ? inlineAfter(ctx, pc, t) : null;
        if (after) {
          inlineCalls.add(pc);
          if (after === 'unknown') L('warn', `JSR ${$4(t)} pops its return address; inline data follows ${$4(next)}`, pc, 'code', 'inline-data');
          else {
            const on = after.s + after.n, range = `${$4(after.s)}${after.n > 1 ? `-${$4(on - 1)}` : ''}`;
            L('ok', `JSR ${$4(t)} ${after.string ? 'prints the string' : `reads the ${after.n} byte${after.n === 1 ? '' : 's'}`} after it (${range}); the code goes on at ${$4(on)}`, pc, 'code');
            via(on, dec); enqueue(on, 'jmp');
          }
          break;
        }
        // the bytes after it ran into a problem when a strong guess was traced on trial: the routine does not return
        if (blameCut.get(pc)?.side === next) break;
        dec = { at: pc, side: next };
        flags = {}; pc = next; continue;
      }
      if (info.flow === 'ret') break;
      if (info.flow === 'brk') { blamed(); L('warn', `BRK at ${$4(pc)} ends the code path`, pc, 'code', 'brk'); break; }
      if (deep) flags = flagsAfter(flags, info, mem[(pc + 1) & 0xffff], pc);
      pc = next;
    }
  }
}

/**
 * Deep analysis: a branch whose side was left out by the flags before it, where the code from the instruction that
 * set them is reached some other way after all (a jump or branch into it, a BIT-skip byte that runs into it, an entry
 * point), or that instruction or the branch is modified by code: then both sides are followed. Returns whether
 * anything was queued.
 */
export function releaseFlags(ctx: Ctx): boolean {
  const { flagCut, xrefs, entryKind, skip, mem, insLen, queue, ev } = ctx;
  const entered = (a: number) => entryKind.has(a) || (xrefs.get(a) || []).some(x => (x.kind === 'branch' || x.kind === 'jump' || x.kind === 'call') && insLen[x.from])
    || [1, 2, 3].some(k => skip.has((a - k) & 0xffff) && OPC[mem[(a - k) & 0xffff]].len === k);
  let any = false;
  for (const [b, { side, by }] of flagCut) {
    let open = ev.smc.has(by) || ev.smc.has(b);
    for (let a = by, n = 0; !open && a !== b; n++) {
      a = (a + insLen[a]) & 0xffff;
      open = !insLen[a] || n > 64 || entered(a);
    }
    if (!open) continue;
    flagCut.delete(b);
    // a branch target is an entry point as usual; the fall-through is not
    if (side === ((b + 2) & 0xffff)) { if (!insLen[side]) queue.push(side); } else ctx.enqueue(side, 'branch');
    any = true;
  }
  return any;
}

/** What makes a guess traced on trial fail: the trace stops at a problem (but not at inline data after a JSR). */
const fails = (l: LogEntry) => (l.lvl === 'warn' || l.lvl === 'err') && l.code !== 'inline-data';

/** The bytes the code traced on trial (`f`, and not `ctx`) writes with a plain store: a pointer set in the guess itself. */
function writtenOnTrial(ctx: Ctx, f: Ctx, p: number): boolean {
  const { mem } = ctx;
  for (let a = 0; a < 0x10000; a++) {
    if (!f.insLen[a] || ctx.insLen[a] || f.skip.has(a)) continue;
    const o = OPC[mem[a]];
    if ((o.access !== 'write' && o.access !== 'rmw') || (o.mode !== 'zp' && o.mode !== 'abs')) continue;
    const t = decode(mem, a).target!;
    if (t === p || t === ((p + 1) & 0xffff)) return true;
  }
  return false;
}

/**
 * An indirect JMP goes somewhere known: through a system vector ($0300-$033f, $a000-$a00b, $fff6-$ffff), a pointer code
 * writes (the code so far, or the code traced on trial `f`), or a pointer table found so far.
 */
function knownPointer(ctx: Ctx, p: number, f: Ctx | null = null): boolean {
  if ((p >= 0x0300 && p < 0x0340) || (p >= 0xa000 && p < 0xa00c) || p >= 0xfff6) return true;
  const writes = (a: number) => (ctx.xrefs.get(a) || []).some(x => (x.kind === 'write' || x.kind === 'rmw') && ctx.insLen[x.from]) || !!ctx.deep?.written?.[a];
  return writes(p) || writes((p + 1) & 0xffff) || [...ctx.lohiTabs.values()].some(t => t.dest === p) || [...ctx.wordTables.values()].some(t => t.dest === p)
    || (!!f && writtenOnTrial(ctx, f, p));
}

/** Guesses with strong evidence: an interrupt handler code installs, the load address. The rest are weak: code
 *  islands and pointer-table targets, whose bytes look like code for a few instructions before they run into a problem
 *  as often as not (measured: keeping them without the side that does makes far more read-only data code, 8.11h). */
const STRONG: ReadonlySet<EntryKind> = new Set<EntryKind>(['irq', 'nmi', 'brk', 'entry']);
/** At most this many sides left out for one guess. */
const MAX_BLAME = 8;

export interface Trial {
  /** the problem that leaves the guess out, or null: it is kept */
  why: LogEntry | null;
  /** the sides left out for it (a strong guess): branch or JSR -> the side */
  cuts: Map<Addr, { side: Addr; why: LogEntry }>;
  /** what the decision on it leaves out (8.11e): where its traces on trial that failed ran into problems, and (left
   *  out) the instructions they read */
  seen: Addr[];
}

/**
 * Deep analysis: trace `a` on trial, with the sides of branches it reaches that the flags left out. A weak guess fails
 * at the first problem it runs into (an indirect JMP through a pointer nothing sets is one). A strong one blames the
 * last decision on the way to the problem, a branch's side or the bytes after a JSR, leaves that out and is traced on
 * trial again; it fails when the problem is on its own straight way.
 */
export function trial(ctx: Ctx, a: number, kind: EntryKind): Trial {
  const cuts: Trial['cuts'] = new Map(), strong = STRONG.has(kind), seen = new Set<Addr>();
  for (;;) {
    const f = forkTrace(ctx);
    // a strong guess is traced as the code so far is: a JSR or JMP to a BRK or JAM goes to a routine put there at run
    // time, and a path stops quietly at an instruction the code writes
    if (strong) f.onTrial = false;
    // an interrupt handler runs with what its vectors need: the KERNAL in for $0314-$0319, out for $fffa-$ffff
    if (kind === 'irq' || kind === 'nmi' || kind === 'brk') {
      let need = 0;
      for (const v of ctx.ev.vectors.get(a) ?? []) need |= v >= 0xff00 ? KERNAL_OUT : KERNAL_IN;
      f.trialPort = need && ((ctx.deep?.main ?? 0) & need || need);
    }
    for (const [at, c] of cuts) f.blameCut.set(at, { side: c.side, guess: a, kind, why: c.why });
    f.enqueue(a, kind, true);
    trace(f);
    while (releaseFlags(f)) trace(f);
    const bad = f.log.find(fails);
    if (bad) {
      for (const l of f.log) if (l.code && l.addr != null && l.lvl !== 'hint') seen.add(l.addr);
      const d = strong && bad.addr != null ? f.blame.get(bad.addr) : null;
      if (!d || cuts.has(d.at) || cuts.size >= MAX_BLAME) { for (const p of f.newIns!) seen.add(p); return { why: bad, cuts, seen: [...seen] }; }
      cuts.set(d.at, { side: d.side, why: bad });
      continue;
    }
    // an indirect jump whose target is not known is no fault (isFault): a strong guess keeps it
    if (strong) return { why: null, cuts, seen: [...seen] };
    const j = f.ijumps.find(j => !knownPointer(ctx, j.ptr, f));
    if (j) { seen.add(j.pc); for (const p of f.newIns!) seen.add(p); }
    return { seen: [...seen], why: j ?{ lvl: 'warn', msg: `Indirect JMP (${$4(j.ptr)}) at ${$4(j.pc)}: target unknown at analysis time`, addr: j.pc, cat: 'code', code: 'ijmp-unknown' } : null, cuts };
  }
}

/**
 * 5.17 deep analysis: the guesses waiting (code islands, pointer-table targets, interrupt handlers, the load address)
 * are traced on trial, one at a time; a guess is kept and traced when that runs into no problem, or a strong one once
 * the sides that do are left out, else it is left out.
 */
export function settle(ctx: Ctx): void {
  const { pending, rejected } = ctx;
  while (pending.length) {
    const { a, kind } = pending.shift()!;
    if (rejected.has(a)) continue; // the code only grows, so it fails again
    if (!ctx.insLen[a]) {
      const t = trial(ctx, a, kind);
      // what the decision leaves out: all the guess ran into, or (kept) what was on the sides left out
      for (const p of t.seen) if (!ctx.trialBehind.has(p)) ctx.trialBehind.set(p, t.why ? 'rejected' : 'blamed');
      if (t.why) { rejected.set(a, { kind, why: t.why }); continue; }
      for (const [at, c] of t.cuts) ctx.blameCut.set(at, { side: c.side, guess: a, kind, why: c.why });
    }
    if (kind === 'entry') loadEntry(ctx); else ctx.enqueue(a, kind, true);
    // as on trial, so the next guess is traced on trial against what the code is now
    trace(ctx);
    while (releaseFlags(ctx)) trace(ctx);
  }
}

/**
 * Deep analysis (8.11e): what lies behind each kind of decision it took: the problems there and the instructions, by
 * their address, with the kind. The guesses left out and the problems on the sides left out from what their traces on
 * trial ran into; the sides left out, the calls, jumps and branch sides not followed traced as the normal analysis would
 * (without the deep analysis's rules, from the code it has). Those it decided on a guess first, so a problem behind
 * both kinds counts as decided.
 */
export function behind(ctx: Ctx): Map<Addr, GoneWhy> {
  const out = new Map<Addr, GoneWhy>(ctx.trialBehind);
  const look = (why: GoneWhy, starts: [Addr, EntryKind][]) => {
    if (!starts.length) return;
    const f = forkTrace(ctx);
    f.deep = null; f.blameCut = new Map();
    for (const [a, kind] of starts) f.enqueue(a, kind, true);
    trace(f);
    const at = (a: Addr) => { if (!out.has(a)) out.set(a, why); };
    for (const l of f.log) if (l.code && l.addr != null) at(l.addr);
    for (const j of f.ijumps) at(j.pc);
    for (const p of f.newIns!) at(p);
  };
  const cut = (w: CutWhy): [Addr, EntryKind][] => [...ctx.cuts].filter(([, why]) => why === w).map(([k]) => [k & 0xffff, 'jmp']);
  look('blamed', [...ctx.blameCut.values()].map(c => [c.side, 'branch']));
  look('runTime', cut('empty'));
  look('flags', [...ctx.flagCut.values()].map(c => [c.side, 'branch']));
  // and the KERNAL's own handlers that $0314-$0319 are set to (the KERNAL calls them with its ROM in)
  look('rom', [...cut('rom'), ...[...ctx.ev.vectors].filter(([v, ds]) => v >= 0xe000 && !ctx.insLen[v] && [...ds].some(d => d < 0x0400)).map(([v]): [Addr, EntryKind] => [v, 'irq'])]);
  look('smc', cut('smc'));
  look('noreturn', cut('noreturn'));
  return out;
}

/** User "mark as code": linear sweep over the override range after tracing. */
export function sweepForcedCode(ctx: Ctx): void {
  const { ovList, insLen, codeOwner, mem, loaded, forcedData } = ctx;
  for (const o of ovList) {
    if (o.type !== 'code') continue;
    let a = o.start;
    while (a < o.end) {
      if (insLen[a]) { a += insLen[a]; continue; }
      const info = OPC[mem[a]];
      // Never start inside an instruction decoded earlier (overlapping code overrides), and leave
      // bytes that a later override turned back into data alone, as tracing does.
      let ok = codeOwner[a] < 0 && !forcedData(a) && loaded(a + info.len - 1) && a + info.len <= o.end;
      for (let k = 1; ok && k < info.len; k++) if (insLen[a + k] || codeOwner[a + k] >= 0 || forcedData(a + k) || ctx.owner[a + k] !== ctx.owner[a]) ok = false;
      if (!ok) break;
      insLen[a] = info.len; for (let k = 1; k < info.len; k++) codeOwner[a + k] = a;
      a += info.len;
    }
  }
}
