/* 5.8 SID music detection. A player starts with a jump table: JMP init, then JMP play (up to four JMPs) or the play
 * code right after them, scored by the code its entries reach. That code is decoded from the table where the trace did
 * not get to it, so a player still counts when its init ran before a snapshot was taken or its play is called from an
 * interrupt the trace did not find. Play is the entry the IRQ or the program calls, else the one that writes the most
 * SID registers. A table whose code calls another player's entries is that player's caller, and where tables overlap
 * the strongest wins.
 *
 * A table whose code writes the SID is also run (c64/sidrun.ts): init, then each entry after it as play, once a frame.
 * One that plays (init and play return, most SID registers written, notes started) is a player whatever calls it, which
 * finds a music file loaded on its own (nothing calls it, its load address is the program's start), players whose play
 * code changes itself, and the right table among a player's inner ones (which play nothing on their own). Where tables
 * overlap, the one whose play the IRQ calls comes first, then one that plays (the most over a minute), and a player
 * that plays has the bytes its run used in its block: its data before the table and the song data after the code that
 * the player reads through pointers. In a snapshot, a player that init no
 * longer restarts (it changed its own code, say) plays on from where it was without init, with the bytes outside the
 * block it reads as they were (`MusicInfo.resume`). */
import type { Ctx } from './context';
import type { Addr, MusicInfo } from '../types';
import { OPC } from '../cpu/opcodes';
import { decode } from '../cpu/decode';
import { $4, word } from '../util/hex';
import { plays, runPlayer, USED_READ, USED_RUN, type PlayerRun, type PlayerRunOptions } from '../c64/sidrun';
import { parseVsf } from '../c64/vsf';

export type MusicCtx = Pick<Ctx, 'S' | 'mem' | 'insLen' | 'codeOwner' | 'skip' | 'inlineCalls' | 'xrefs' | 'owner' | 'ovList' | 'loaded' | 'forcedData' | 'L' | 'entryKind'> & Partial<Pick<Ctx, 'files'>>;

/** a player keeps its code together: the table's targets and the code they reach lie this close after it */
const SPAN = 0x2000;
const BEFORE = 0x800;
/** the frames a table is tried for (3 s), and at most for the bytes the song uses (3 minutes, or until it has come
 *  round: 30 s without a byte used for the first time) */
const TRY_FRAMES = 150, LONG_FRAMES = 9000, SETTLE = 1500;
/** a minute's run stops when nothing has written the SID in 10 s: no tune starts that late */
const QUIET = 500;
/** a snapshot's player is played for a minute with init and without: a tune's start can be quiet, a player that init
 *  does not start again stays so */
const MINUTE = 3000;
/** a tune that init starts again plays more notes than this in a minute */
const STUCK = 30;
/** the bytes a run used are the block's when the unused ones between them are fewer than this (and no other code is
 *  in between) */
const GAP = 0x800;
/** a snapshot's player plays on without init with at most this many bytes outside its block as they were */
const MAX_RESUME = 256;

/** The code reachable from some addresses: the trace's instructions where it decoded them, the rest decoded here. */
interface Reach {
  ins: Map<Addr, number>;
  /** paths that ran into data (a JAM, BRK or unstable opcode, the middle of a traced instruction, a data override) */
  bad: number;
  illegal: number;
  /** instructions the trace had decoded */
  traced: number;
}

interface Slot { at: Addr; to: Addr; jmp: boolean }

/** A jump table that passed the tests: its entries, the code they reach and where that code ends; `irq` when the
 *  IRQ calls play, `judged` when its code passed the tests (not only its run); `run`: the run that played (init and
 *  `play`), `resume` when it played without init */
interface Cand { start: Addr; api: Addr[]; play: Addr; sub: Reach; regs: Set<Addr>; sidAt: Addr[]; score: number; why: string[]; hi: Addr; irq: boolean; judged: boolean; run?: PlayerRun; resume?: boolean }

/**
 * Where note frequency tables start (their high bytes): a run of at least 24 rising bytes, one apart (the low and
 * high bytes in tables of their own) or two (in pairs), in which a byte is about twice the one twelve notes (an
 * octave) before it, at least six times.
 */
export function noteTables(mem: Uint8Array, loaded: (a: Addr) => boolean): { start: Addr; end: Addr }[] {
  const out: { start: Addr; end: Addr }[] = [];
  // along each chain of bytes `step` apart; the starts after a failed one that would stop where it stopped are skipped
  for (const step of [1, 2]) for (let r = 0; r < step; r++) {
    for (let a = r; a + step * 24 < 0x10000;) {
      if (!loaded(a)) { a += step; continue; }
      let n = 1, octaves = 0, next = a + step;
      for (;;) {
        const p = a + step * n;
        if (p >= 0x10000 || !loaded(p) || mem[p] < mem[p - step]) { next = p; break; }
        if (n >= 12) {
          const before = mem[p - 12 * step];
          if (before >= 8) {
            if (Math.abs(mem[p] - 2 * before) > 2 + (before >> 5)) { next = p - 11 * step; break; }
            octaves++;
          }
        }
        n++;
      }
      if (n >= 24 && octaves >= 6) {
        // the zeros a run can start with are not notes
        let start = a;
        while (mem[start] === 0) start += step;
        out.push({ start, end: a + step * n });
        next = a + step * n;
      }
      a = Math.max(a + step, next);
    }
  }
  return out.sort((x, y) => x.start - y.start);
}

/** Runs of players, by the memory they ran in and how: the analysis detects music more than once (its rounds, the
 *  deep analysis), on the same bytes. Only runs that played keep the bytes they used. */
const RUNS = new Map<string, PlayerRun>(), VERDICTS = new Map<string, PlayerRun>();
const EMPTY = new Uint8Array(0x10000);
const RUNS_KEPT = 128, VERDICTS_KEPT = 8192;
const keep = (m: Map<string, PlayerRun>, k: string, r: PlayerRun, n: number) => { m.set(k, r); while (m.size > n) m.delete(m.keys().next().value!); };
const memKey = (m: Uint8Array): string => {
  let h = 0x811c9dc5, g = 0;
  for (let i = 0; i < m.length; i++) { h = Math.imul(h ^ m[i], 0x01000193); g = (g + m[i] * (i + 1)) | 0; }
  return `${(h >>> 0).toString(36)}.${(g >>> 0).toString(36)}`;
};

export function detectMusic(ctx: MusicCtx): MusicInfo[] {
  const { S, mem, insLen, codeOwner, skip, inlineCalls, xrefs, owner, ovList, loaded, forcedData, L, entryKind } = ctx;
  const music: MusicInfo[] = [];

  const reach = (starts: Addr[], tracedOnly = false): Reach => {
    const ins = new Map<Addr, number>(), stack = [...starts];
    let bad = 0, illegal = 0, traced = 0;
    while (stack.length) {
      const pc = stack.pop()!;
      if (ins.has(pc) || ins.size > 4096 || !loaded(pc)) continue;
      let len = insLen[pc];
      if (len) traced++;
      else if (tracedOnly) continue;
      else {
        const o = OPC[mem[pc]], s = codeOwner[pc];
        // inside an instruction of the trace: only the BIT-skip idiom hides another instruction like that
        if (s >= 0 && !(pc === s + 1 && (mem[s] === 0x2c || mem[s] === 0x24))) { bad++; continue; }
        if (forcedData(pc) || o.jam || o.unstable || o.flow === 'brk' || (o.ill && !S.illegal)) { bad++; continue; }
        let fits = true;
        for (let k = 1; k < o.len; k++) if (!loaded(pc + k) || owner[pc + k] !== owner[pc] || forcedData(pc + k)) fits = false;
        if (!fits) { bad++; continue; }
        len = o.len;
        if (o.ill) illegal++;
      }
      ins.set(pc, len);
      const o = OPC[mem[pc]], d = decode(mem, pc), next = (pc + len) & 0xffff;
      if (skip.has(pc)) { stack.push(next); continue; }
      if (o.flow === 'seq' || o.flow === 'br' || (o.flow === 'jsr' && !inlineCalls.has(pc))) stack.push(next);
      if (o.flow === 'br' || o.flow === 'jmp' || o.flow === 'jsr') stack.push(d.target!);
    }
    return { ins, bad, illegal, traced };
  };
  const reached = new Map<Addr, Reach>();
  const reachOf = (t: Addr) => { let r = reached.get(t); if (!r) reached.set(t, r = reach([t])); return r; };
  // (asked of the same instructions for many tables: 1 yes, 2 no)
  const sidWrite = new Uint8Array(0x10000);
  const isSidWrite = (pc: Addr) => {
    if (!sidWrite[pc]) { const o = OPC[mem[pc]], t = decode(mem, pc).target; sidWrite[pc] = (o.access === 'write' || o.access === 'rmw') && t != null && t >= 0xd400 && t <= 0xd41c ? 1 : 2; }
    return sidWrite[pc] === 1;
  };
  /** the code a table's entry reaches writes the SID (per reach, which reachOf keeps per target) */
  const writesSid = new WeakMap<Reach, boolean>();
  const reachWritesSid = (r: Reach) => { let v = writesSid.get(r); if (v == null) { v = false; for (const pc of r.ins.keys()) if (isSidWrite(pc)) { v = true; break; } writesSid.set(r, v); } return v; };
  const sidRegs = (r: Reach) => {
    const regs = new Set<Addr>();
    for (const pc of r.ins.keys()) {
      if (!isSidWrite(pc)) continue;
      const o = OPC[mem[pc]], t = decode(mem, pc).target!;
      regs.add(t);
      if (o.mode === 'abx' || o.mode === 'aby') {
        // a loop over the registers (`sta $d400,x` up to `cpx #$19`, a buffered player's) writes them all
        let n = 3;
        for (let p = pc + 3, k = 0; k < 4 && r.ins.has(p); k++) {
          const c = mem[p];
          if ((c === 0xe0 && o.mode === 'abx') || (c === 0xc0 && o.mode === 'aby')) { n = Math.max(n, Math.min(mem[p + 1], 0xd419 - t)); break; }
          p += r.ins.get(p)!;
        }
        for (let k = 1; k < n; k++) regs.add(t + k);
      }
    }
    return regs;
  };

  // the code interrupts run: from the handlers the trace found and from the vectors in memory (a snapshot's live ones)
  let irqCode: Set<Addr> | null = null;
  const fromIrq = (from: Addr) => {
    if (!irqCode) {
      const handlers = [...entryKind].filter(([, k]) => k === 'irq' || k === 'nmi').map(([h]) => h);
      for (const v of [0x0314, 0x0318, 0xfffe, 0xfffa]) if (loaded(v) && loaded(v + 1)) handlers.push(word(mem, v));
      irqCode = new Set(reach(handlers, true).ins.keys());
    }
    return irqCode.has(from);
  };
  // JSR and JMP instructions anywhere in memory by target, the ones the trace never decoded too
  let raw: Map<Addr, Addr[]> | null = null;
  const rawRefs = (t: Addr) => {
    if (!raw) {
      raw = new Map();
      for (let p = 0; p < 0xfffd; p++) {
        if ((mem[p] !== 0x20 && mem[p] !== 0x4c) || !loaded(p) || !loaded(p + 2) || codeOwner[p] >= 0) continue;
        const to = word(mem, p + 1);
        let l = raw.get(to); if (!l) raw.set(to, l = []); l.push(p);
      }
    }
    return raw.get(t) || [];
  };

  // the memory players run in: the program's, and a snapshot's zero page, stack and other bytes the project leaves out
  let runMem: Uint8Array | null = null, key = '', snapshot = false, sidState: Uint8Array | null = null;
  const memory = () => {
    if (runMem) return runMem;
    runMem = mem.slice();
    for (const f of ctx.files ?? []) {
      if (!f.vsf) continue;
      try {
        const v = parseVsf(f.vsf);
        for (let a = 0; a < 0x10000; a++) if (!loaded(a)) runMem[a] = v.ram[a];
        snapshot = true; sidState = v.sid;
      } catch { /* not readable */ }
    }
    key = memKey(runMem);
    return runMem;
  };
  // 'quiet': a minute of a tune that starts quietly, kept with its bytes as a try's are; 'minute', 'resumeMinute': how
  // much a minute plays, kept without them
  type Kind = 'try' | 'quiet' | 'long' | 'minute' | 'resume' | 'resumeMinute' | 'resumeLong';
  const KIND: Record<Kind, Omit<PlayerRunOptions, 'init' | 'play'>> = {
    try: { frames: TRY_FRAMES, loaded },
    long: { frames: LONG_FRAMES, settle: SETTLE, loaded },
    quiet: { frames: MINUTE, quiet: QUIET, loaded },
    minute: { frames: MINUTE, quiet: QUIET, loaded },
    resumeMinute: { frames: MINUTE, quiet: QUIET, loaded, noInit: true },
    resume: { frames: TRY_FRAMES, quiet: QUIET, loaded, noInit: true },
    resumeLong: { frames: LONG_FRAMES, settle: SETTLE, loaded, noInit: true },
  };
  const runOf = (init: Addr, play: Addr, kind: Kind): PlayerRun => {
    const m = memory(), k = `${key}:${init}:${play}:${kind}`;
    let r = RUNS.get(k) ?? VERDICTS.get(k);
    if (r) { const c = RUNS.has(k) ? RUNS : VERDICTS; c.delete(k); c.set(k, r); return r; }
    r = runPlayer(m, { init, play, ...KIND[kind] });
    // a run that played nothing keeps only its verdict, and so does a minute's (only how much it played is asked)
    if (plays(r) && kind !== 'minute' && kind !== 'resumeMinute') keep(RUNS, k, r, RUNS_KEPT); else keep(VERDICTS, k, { ...r, used: EMPTY }, VERDICTS_KEPT);
    return r;
  };
  const ranText = (r: PlayerRun) => `${r.regs} SID registers and ${r.notes} note${r.notes === 1 ? '' : 's'} in ${Math.round(r.played / 50)} s`;
  /** how much like music a run that plays is: its registers and notes; of two, the one with more is better */
  const musical = (r: PlayerRun) => r.regs + Math.min(r.notes, 24);
  const better = (x: PlayerRun, y: PlayerRun) => musical(x) > musical(y);

  const notes = noteTables(mem, loaded);
  // traced code reaches the address by a branch or by running on from the instruction before it
  const runInto = (a: Addr) => {
    if (!insLen[a]) return false;
    if ((xrefs.get(a) || []).some(x => x.kind === 'branch')) return true;
    for (let p = Math.max(0, a - 3); p < a; p++) {
      if (insLen[p] && p + insLen[p] === a && !skip.has(p)) { const f = OPC[mem[p]].flow; if (f === 'seq' || f === 'br' || (f === 'jsr' && !inlineCalls.has(p))) return true; }
    }
    return false;
  };

  // every table first, then the players among them
  const cands: Cand[] = [];
  if (S.detectMusic) for (let a = 0; a < 0xfffa; a++) {
    if (mem[a] !== 0x4c || !loaded(a) || !loaded(a + 5) || (!insLen[a] && codeOwner[a] >= 0)) continue;
    const near = (t: Addr) => loaded(t) && owner[t] === owner[a] && t >= a - BEFORE && t < a + SPAN;
    const t0 = word(mem, a + 1);
    if (!near(t0)) continue;
    // JMP init, then JMP play (up to four JMPs), or the play code itself right after them
    const slots: Slot[] = [{ at: a, to: t0, jmp: true }];
    for (let s = a + 3; s <= a + 12; s += 3) {
      if (codeOwner[s] >= 0) break;
      if (s <= a + 9 && mem[s] === 0x4c && loaded(s + 2) && near(word(mem, s + 1))) { slots.push({ at: s, to: word(mem, s + 1), jmp: true }); continue; }
      slots.push({ at: s, to: s, jmp: false });
      break;
    }
    const reaches = slots.map(s => reachOf(s.to));
    // called from outside: from code that is not the player's own (nor a JMP of a table just before this one)
    const own = new Set<Addr>();
    for (const r of reaches) for (const pc of r.ins.keys()) own.add(pc);
    const tableEnd = a + 3 * slots.length;
    const outside = (from: Addr) => (from < a - 12 || from >= tableEnd) && !own.has(from);
    const calls = (at: Addr) => (xrefs.get(at) || []).filter(x => (x.kind === 'call' || x.kind === 'jump') && outside(x.from));
    const rawHit = (at: Addr) => rawRefs(at).some(outside);
    // the IRQ calls play: the entry, or the code its JMP goes to (a program can call a player's play routine directly)
    const irqPlays = (s: Slot) => calls(s.at).some(x => fromIrq(x.from)) || (s.jmp && calls(s.to).some(x => fromIrq(x.from)));

    // run it when its code writes the SID: each entry after init as play, the one that plays best
    let ran: { slot: Slot; run: PlayerRun } | null = null;
    if (slots.length > 1 && reaches.some(reachWritesSid)) {
      for (const s of slots.slice(1)) {
        let r = runOf(a, s.at, 'try');
        // a tune can start quietly: one whose init and play return and write the SID as music does (8 registers) but
        // that do not play yet are heard for a minute
        if (!plays(r) && r.init && !r.stop && r.regs >= 8) r = runOf(a, s.at, 'quiet');
        if (plays(r) && (!ran || better(r, ran.run))) ran = { slot: s, run: r };
        // init did not return: no entry after it plays
        if (!r.init) break;
      }
    }

    const judged = ((): Cand | null => {
      // the program's own start is not a player's init (unless it plays)
      if (entryKind.get(a) === 'entry') return null;
      // code right after the JMPs is everywhere: as play it needs a caller or SID writes of its own
      const live = slots.filter((s, i) => s.jmp || calls(s.at).length || rawHit(s.at) || sidRegs(reaches[i]).size >= 4);
      if (live.length < 2) return null;
      // a table is a way in: code the program runs into with nothing calling it is a JMP pair inside other code
      if (runInto(a) && !live.some(s => calls(s.at).length || rawHit(s.at))) return null;

      // play: the entry the IRQ calls, else one the program calls, else one code the trace did not reach calls,
      // else the one that writes the most SID registers (a volume or sound-effect entry writes few)
      const plays_ = live.slice(1).map(s => {
        const regs = sidRegs(reaches[slots.indexOf(s)]).size, c = calls(s.at);
        const irq = irqPlays(s), raw = !c.length && rawHit(s.at);
        const w = (irq ? 100 : 0) + (c.length ? 20 : 0) + (raw ? 15 : 0) + Math.min(30, 2 * regs) + (s.at === a + 3 ? 1 : 0);
        return { s, regs, irq, called: c.length > 0, raw, w };
      });
      const best = plays_.reduce((x, y) => (y.w > x.w ? y : x));
      const play = best.s;
      if (!play.jmp && best.regs === 0) return null;

      const sub = reach(live.filter(s => s.jmp || s === play).map(s => s.to));
      if (sub.ins.size < 4 || sub.bad > 2 || sub.illegal * 8 > sub.ins.size) return null;
      let away = 0;
      for (const pc of sub.ins.keys()) if (pc < a - BEFORE || pc >= a + SPAN) away++;
      if (away > 16) return null;

      let score = 2;
      const why = [play.jmp && play.at === a + 3 ? 'JMP init / JMP play table' : play.jmp ? `JMP init / JMP play table (play at +${play.at - a})` : `JMP init, then the play code at +${play.at - a}`];
      const callsA = calls(a).filter(x => x.kind === 'call').length;
      const callsB = calls(play.at).filter(x => x.kind === 'call').length;
      if (callsA && callsB) { score += 2; why.push('init and play both called from outside'); }
      else if (callsA || callsB) { score += 1; why.push('called from outside'); }
      if ((a & 0xff) === 0) { score += 1; why.push('page aligned'); }
      const regs = sidRegs(sub);
      if (regs.size >= 4) { score += 3; why.push(`writes ${regs.size} SID registers`); }
      else if (regs.size >= 1) score += 1;
      // nothing the trace decoded or called: only the player's own SID writes count
      if (!sub.traced && !callsA && !callsB && regs.size < 4) return null;
      if (best.irq) why.push('play called from the IRQ');
      else if (!best.called && best.raw) why.push('play called from code the trace did not reach');
      if (sub.traced < sub.ins.size) why.push(`${sub.ins.size - sub.traced} instructions decoded from the table (the trace did not reach them)`);

      let hi = tableEnd;
      for (const [pc, len] of sub.ins) hi = Math.max(hi, pc + len);
      for (const pc of sub.ins.keys()) {
        const o = OPC[mem[pc]], d = decode(mem, pc);
        if (o.access && d.target != null && loaded(d.target) && d.target > hi && d.target < a + SPAN) hi = Math.max(hi, d.target + 1);
      }
      // traced code in the range that the table does not reach: a few entries the program calls directly are fine,
      // much of it is other code
      let foreign = 0;
      for (let p = a; p < hi; p++) if (insLen[p] && !sub.ins.has(p) && !skip.has(p)) foreign++;
      if (foreign > 8 && foreign * 4 > sub.ins.size) return null;
      // the note frequency table every tracker player has, read by the code
      const note = notes.find(t => [...sub.ins.keys()].some(pc => {
        const o = OPC[mem[pc]], d = decode(mem, pc);
        return o.access === 'read' && (o.mode === 'abs' || o.mode === 'abx' || o.mode === 'aby') && d.target! >= t.start - 0x20 && d.target! < t.end;
      }));
      if (note) { score += 2; why.push(`note frequency table at ${$4(note.start)}`); }
      // something calls it (traced or not), or it reads notes and starts a page (where players are put): a JMP pair in
      // other code that writes the SID does neither
      const called = live.some(s => calls(s.at).length || rawHit(s.at));
      if (!called && (!note || (a & 0xff) !== 0)) return null;
      if (score < 5) return null;
      // the play code right after a single JMP (the end of one routine and the start of the next, in any code): only
      // with both entries called, or a note table and a caller
      if (!play.jmp && play.at === a + 3 && !(callsA && callsB) && !(note && called)) return null;
      return { start: a, api: live.map(s => s.at), play: play.at, sub, regs, sidAt: [...sub.ins.keys()].filter(isSidWrite), score, why, hi, irq: best.irq, judged: true };
    })();

    // the entry the IRQ calls is play when it plays too: the run's best can be a part of the play routine
    if (ran && judged?.irq && ran.slot.at !== judged.play) {
      const r = runOf(a, judged.play, 'try');
      ran = plays(r) ? { slot: slots.find(s => s.at === judged.play)!, run: r } : null;
    }
    let c: Cand | null = judged;
    if (ran) {
      // the run decides play; the table is a player whatever calls it
      const r = ran.run, play = ran.slot.at;
      if (!c) {
        const entries = slots.filter(s => s.jmp || s === ran!.slot);
        const sub = reach(entries.map(s => s.to));
        const regs = sidRegs(sub);
        const callsA = calls(a).filter(x => x.kind === 'call').length, callsB = calls(play).filter(x => x.kind === 'call').length;
        const why = [ran.slot.jmp && play === a + 3 ? 'JMP init / JMP play table' : ran.slot.jmp ? `JMP init / JMP play table (play at +${play - a})` : `JMP init, then the play code at +${play - a}`];
        let score = 2 + ((a & 0xff) === 0 ? 1 : 0) + (callsA && callsB ? 2 : callsA || callsB ? 1 : 0);
        if (callsA || callsB) why.push(callsA && callsB ? 'init and play both called from outside' : 'called from outside');
        if ((a & 0xff) === 0) why.push('page aligned');
        let hi = tableEnd;
        for (const [pc, len] of sub.ins) hi = Math.max(hi, pc + len);
        const irq = irqPlays(ran.slot);
        if (irq) why.push('play called from the IRQ');
        c = { start: a, api: entries.map(s => s.at), play, sub, regs, sidAt: [...sub.ins.keys()].filter(isSidWrite), score, why, hi, irq, judged: false };
      } else if (c.play !== play) {
        c.why.push(`play at ${$4(play)}, not ${$4(c.play)}: that is the one that plays`);
        c.play = play;
        if (!c.api.includes(play)) c.api.push(play);
      }
      c.score += 4;
      c.run = r;
    }
    if (c) cands.push(c);
  }
  /** What the run says about a player found (the tables that become blocks only: a snapshot's costs two minutes of
   *  play). In a snapshot the player ran before: when it plays far more on from where it was than init starts it
   *  again (init no longer does, say, as a player whose code changed itself), it plays on without init. */
  const settle = (c: Cand) => {
    const a = c.start;
    const withInit = c.run ?? runOf(a, c.play, 'try');
    const goesOn = memory() && snapshot && plays(runOf(a, c.play, 'resume')) ? runOf(a, c.play, 'resumeMinute') : null;
    const minute = goesOn ? runOf(a, c.play, 'minute') : null;
    if (goesOn && minute && plays(goesOn) && (!plays(minute) || (minute.notes < STUCK && minute.notes * 4 < goesOn.notes))) {
      c.run = goesOn; c.resume = true;
      c.why.push(`init does not start it again (${minute.stop ?? ranText(minute)}), play goes on from the snapshot: ${ranText(goesOn)}`);
    } else if (c.run) c.why.push(`init and play run: ${ranText(c.run)}`);
    else if (c.sub.ins.size >= 4) c.why.push(`running init and play plays nothing (${withInit.stop ?? ranText(withInit)})`);
  };

  // a calls b: b's table starts its code (a table inside a player, which a player's own code jumps to, has player code
  // before it), a's code jumps to b's entries from outside b, never runs into b's code any other way, and most of
  // the SID writes it reaches are b's
  const opens = (b: Cand) => { for (const pc of b.sub.ins.keys()) if (pc < b.start) return false; return true; };
  // players that play are compared over a minute: a part of one can start a few notes and stop, a tune start quietly
  const heard = new Map<Cand, number>();
  const minute = (c: Cand) => { let v = heard.get(c); if (v == null) heard.set(c, v = musical(runOf(c.start, c.play, c.resume ? 'resumeMinute' : 'minute'))); return v; };
  /** the run of a table that starts its player's code runs nothing in the bytes before it (where code can be: BEFORE) */
  const runOpens = (c: Cand) => {
    if (!c.run) return true;
    for (let p = Math.max(0, c.start - BEFORE); p < c.start; p++) if ((c.run.used[p] & USED_RUN) && owner[p] === owner[c.start]) return false;
    return true;
  };
  const clientOf = (a: Cand, b: Cand) => {
    if (b.start >= a.start && b.start < a.start + 3 * a.api.length) return false;
    // runs: a plays through b when its run ran b's entries, b plays as much on its own (over a minute) and never runs
    // a's table, and b's table starts its code (a part of a player, which the player's own flow runs through, has code
    // before it). A player that plays more than the inner routine it calls is no caller of it
    if (a.run && !a.resume) {
      if (!b.run || b.resume || !runOpens(b) || minute(a) > minute(b) || (a.judged && !b.judged)) return false;
      const ranB = b.api.some(e => a.run!.used[e] & USED_RUN);
      return ranB && !(b.run.used[a.start] & USED_RUN);
    }
    // (a table only its run found is a part of a player at most: code jumps into it from the player)
    if (!b.judged || !opens(b)) return false;
    let calls = false;
    for (const pc of a.sub.ins.keys()) {
      const inB = pc >= b.start && pc < b.hi;
      if (inB) { if (!b.sub.ins.has(pc)) return false; continue; }
      const o = OPC[mem[pc]];
      if ((o.flow === 'jsr' || o.flow === 'jmp') && b.api.includes(decode(mem, pc).target!)) calls = true;
    }
    return calls && a.sidAt.filter(pc => !b.sub.ins.has(pc)).length < b.sidAt.length;
  };
  // b is inside a's player when its play code (not a JMP) is where one of a's JMPs goes and none goes to b's init: the
  // JMP just before a player's play routine, which the program can call directly (a table of JMPs to b's init and play
  // is b's caller instead)
  const jumpsTo = (a: Cand, t: Addr) => a.api.some(e => mem[e] === 0x4c && word(mem, e + 1) === t);
  const inside = (b: Cand, a: Cand) => b.play !== b.start && mem[b.play] !== 0x4c && jumpsTo(a, b.play) && !jumpsTo(a, b.start);
  // (a table is no caller of one inside it)
  const players = cands.filter(a => !cands.some(b => b !== a && ((clientOf(a, b) && !inside(b, a)) || inside(a, b))));
  // the ones whose play the IRQ calls first (a demo's own entries, not a part of the player), then the ones that play
  // (the most like music first), then the strongest; a weaker table inside a player found already, or whose code runs
  // into one, is not a player
  const starts = new Set(players.map(c => c.start));
  // a table that plays only as a part of a player (its run runs code before it) comes after the ones that play on their own
  const rank = (c: Cand) => (c.irq ? 2 : 0) + (c.run && runOpens(c) ? 1 : 0);
  const order = [...players].sort((x, y) => rank(y) - rank(x) || (y.run && x.run ? minute(y) - minute(x) : 0) || y.score - x.score || x.start - y.start);
  for (const c of order) {
    const a = c.start;
    if (music.some(m => a >= m.start && a < m.end)) continue;
    // the code ends where another player's table starts, when that player's code is its own
    let hi = c.hi;
    for (const b of players) if (b.start >= a + 3 * c.api.length && b.start < hi && opens(b) && ![...b.sub.ins.keys()].some(pc => c.sub.ins.has(pc))) hi = b.start;
    if (music.some(m => m.start > a && m.start < hi && [...c.sub.ins.keys()].some(pc => pc >= m.start && pc < m.end))) continue;
    for (const m of music) if (m.start > a && m.start < hi) hi = m.start;
    settle(c);
    const refFromOutside = (p: Addr) => (xrefs.get(p) || []).some(x => x.from < a || x.from >= hi);
    // the data after the code, up to other code, bytes the rest of the program uses, a fill or the next player
    let e = hi;
    while (e < 0x10000 && loaded(e) && !insLen[e] && codeOwner[e] < 0 && !refFromOutside(e) && e - a < 0x3000 && !forcedData(e) && !starts.has(e)) {
      let z = 0; while (z < 32 && mem[e + z] === mem[e] && loaded(e + z)) z++;
      if (z >= 32) break;
      e++;
    }
    // a player that plays: the bytes its run used (over three minutes of the song) are the block's too, before the
    // table and after the code, up to other code the run did not run, another player or other files' bytes
    let s = a, resume: [Addr, number][] | undefined, run: PlayerRun | undefined;
    if (c.run) {
      run = runOf(a, c.play, c.resume ? 'resumeLong' : 'long');
      if (!plays(run)) run = c.run;
      const u = run.used;
      const other = (p: Addr) => !loaded(p) || owner[p] !== owner[a] || (p >= 0xd000 && p < 0xe000 && !u[p])
        || music.some(m => p >= m.start && p < m.end) || (starts.has(p) && p !== a)
        || (!!insLen[p] && !(u[p] & USED_RUN) && !c.sub.ins.has(p));
      // the code the run ran near the table is the player's whatever lies between: without it, it runs out of its block
      let top = e, bottom = a;
      for (let p = Math.max(0x0200, a - BEFORE); p < Math.min(0x10000, a + SPAN); p++) {
        if (!(u[p] & USED_RUN) || !loaded(p) || owner[p] !== owner[a] || music.some(m => p >= m.start && p < m.end)) continue;
        if (p < bottom) bottom = p;
        if (p >= top) top = p + 1;
      }
      for (let p = Math.max(top, hi); p < 0x10000 && p - top < GAP && !other(p); p++) if (u[p]) top = p + 1;
      for (let p = bottom - 1; p >= 0x0200 && bottom - p <= GAP && !other(p); p--) if (u[p]) bottom = p;
      if (top > e) c.why.push(`the song data its run read reaches ${$4(top - 1)}`);
      if (bottom < a) c.why.push(`its run uses the bytes from ${$4(bottom)} on, before the table`);
      e = top; s = bottom;
      if (c.resume) {
        // the bytes outside the block the player reads: the zero page and its other variables, as the snapshot has them
        const m = memory(), st: [Addr, number][] = [];
        for (let p = 2; p < 0x10000; p++) {
          if (!(u[p] & USED_READ) || (p >= s && p < e) || (p >= 0x0100 && p < 0x0200) || (p >= 0x0314 && p < 0x031a) || p >= 0xfffa || (p >= 0xd000 && p < 0xe000)) continue;
          st.push([p, m[p]]);
        }
        if (st.length <= MAX_RESUME) {
          // and the SID as the snapshot left it: a player that sets the volume and the filter only in init needs them
          resume = sidState ? [...st, ...[...sidState].map((v, r): [Addr, number] => [0xd400 + r, v])] : st;
        } else c.why.push(`it reads ${st.length} bytes outside the block, too many to play it on from the snapshot`);
      }
    }
    music.push({
      start: s, end: e, init: a, play: c.play, sidRegs: run ? run.regs : c.regs.size, score: c.score, why: c.why, file: owner[a],
      ...(run ? { run: { regs: run.regs, notes: run.notes, seconds: Math.round(run.played / 50) } } : {}), ...(resume ? { resume } : {}),
    });
  }
  music.sort((x, y) => x.start - y.start);
  for (const m of music) L('ok', `Music detected at ${$4(m.start)}-${$4(m.end - 1)} (score ${m.score}: ${m.why.join(', ')})`, m.start, 'music');
  for (const o of ovList) if (o.type === 'music' && !music.some(m => m.start === o.start))
    music.push({ start: o.start, end: o.end, init: o.props?.init ?? o.start, play: o.props?.play ?? o.start + 3, sidRegs: 0, score: 0, why: ['marked by user'], file: owner[o.start], user: true });
  return music;
}

