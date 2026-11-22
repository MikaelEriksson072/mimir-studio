/* 5.8 SID music detection. A player starts with a jump table: JMP init, then JMP play (up to four JMPs) or the play
 * code right after them, scored by the code its entries reach. A tune whose song is set in its data can have an init
 * that does nothing in place of JMP init (rts, nop / rts, nop / nop / rts at the start of a page, as Booze Design's):
 * that table counts only when it plays, and it never calls another player. That code is decoded from the table where the trace did
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
 * block it reads as they were (`MusicInfo.resume`). A player with no table (5.8c, `calledPlayers()`) is a routine the
 * IRQ calls, with the program's own routines that start its songs (`MusicInfo.songs`). */
import type { Ctx } from './context';
import type { Addr, DigiInfo, InitRegs, MusicInfo, MusicSong } from '../types';
import { OPC } from '../cpu/opcodes';
import { decode } from '../cpu/decode';
import { $4, word } from '../util/hex';
import { digiPlays, plays, runDigi, runPlayer, USED_READ, USED_RUN, type DigiRun, type PlayerRun, type PlayerRunOptions, type PlayerState } from '../c64/sidrun';
import { parseVsf } from '../c64/vsf';

export type MusicCtx = Pick<Ctx, 'S' | 'mem' | 'insLen' | 'codeOwner' | 'skip' | 'inlineCalls' | 'xrefs' | 'owner' | 'ovList' | 'loaded' | 'forcedData' | 'L' | 'entryKind'> & Partial<Pick<Ctx, 'files' | 'ev' | 'project'>>;

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
/** a snapshot's player plays on without init with at most this many bytes outside its block as they were (and a
 *  player with no table, 5.8c, from what a song's routine leaves) */
const MAX_RESUME = 256;
/** a player with no table: the program's routines run as its songs' init, those that write the most of what play reads */
const SONG_TRIES = 24;

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
 *  `play`), `resume` when it played without init, `empty` when its init does nothing (an rts where JMP init would be).
 *  A player with no table (5.8c) starts at its play routine, and `songs` are the program's routines that start its
 *  songs (`init` the first) */
interface Cand { start: Addr; api: Addr[]; play: Addr; sub: Reach; regs: Set<Addr>; sidAt: Addr[]; score: number; why: string[]; hi: Addr; irq: boolean; judged: boolean; run?: PlayerRun; resume?: boolean; empty?: boolean; initRegs?: InitRegs; init?: Addr; songs?: Addr[] }
/** what init is run as: the table's first entry, or a player with no table's first song routine */
const initOf = (c: Cand): Addr => c.init ?? c.start;

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
/** runs of sample players (5.8b), by memory, init and how long; one that does not play keeps only its verdict */
const DIGI_RUNS = new Map<string, DigiRun>(), DIGI_KEPT = 64;
/** a sample player whose init does not return plays from the bytes init left: at most this many put back */
const MAX_LOOP_RESUME = 512;
const keep = (m: Map<string, PlayerRun>, k: string, r: PlayerRun, n: number) => { m.set(k, r); while (m.size > n) m.delete(m.keys().next().value!); };
const memKey = (m: Uint8Array): string => {
  let h = 0x811c9dc5, g = 0;
  for (let i = 0; i < m.length; i++) { h = Math.imul(h ^ m[i], 0x01000193); g = (g + m[i] * (i + 1)) | 0; }
  return `${(h >>> 0).toString(36)}.${(g >>> 0).toString(36)}`;
};

/**
 * The JMPs the program writes into place before it calls them: three bytes that traced code calls or jumps to, where
 * every store into each puts the same constant (by traced code: `lda #$4c / sta`), $4c into the first, and where the
 * file has no JMP. By address, the JMP's target.
 */
export function writtenJmps(ctx: Pick<MusicCtx, 'mem' | 'xrefs' | 'loaded' | 'ev'>): Map<Addr, Addr> {
  const out = new Map<Addr, Addr>();
  const writes = ctx.ev?.writes;
  if (!writes?.length) return out;
  const { mem, xrefs, loaded } = ctx;
  const byDest = new Map<Addr, { pc: Addr; v: number | null }[]>();
  for (const w of writes) if (!w.indexed) { let l = byDest.get(w.dest); if (!l) byDest.set(w.dest, l = []); l.push(w); }
  // the one value every store into the byte puts there (undefined: nothing stores into it; null: another or an unknown
  // one, or a store the constants pass did not follow: an indexed one, inc or dec)
  const value = (a: Addr): number | null | undefined => {
    const stores = (xrefs.get(a) || []).filter(x => x.kind === 'write' || x.kind === 'rmw');
    if (!stores.length) return undefined;
    const ws = byDest.get(a) || [];
    let v: number | null = null;
    for (const x of stores) {
      const w = ws.find(w => w.pc === x.from);
      if (!w || w.v == null || (v != null && w.v !== v)) return null;
      v = w.v;
    }
    return v;
  };
  for (const a of byDest.keys()) {
    if (a > 0xfffd || mem[a] === 0x4c || !loaded(a) || !loaded(a + 1) || !loaded(a + 2)) continue;
    if (!(xrefs.get(a) || []).some(x => x.kind === 'call' || x.kind === 'jump') || value(a) !== 0x4c) continue;
    const lo = value(a + 1), hi = value(a + 2);
    if (lo === null || hi === null) continue;
    const t = (lo ?? mem[a + 1]) | ((hi ?? mem[a + 2]) << 8);
    if (loaded(t)) out.set(a, t);
  }
  return out;
}

/** registers an instruction sets to something not known here (a call sets all three) */
const SETS_A = new Set(['ADC', 'SBC', 'AND', 'ORA', 'EOR', 'PLA', 'SLO', 'RLA', 'SRE', 'RRA', 'ISC', 'ANC', 'ALR', 'ARR', 'XAA', 'LAS', 'LAX', 'LDA']);
const SETS_X = new Set(['LDX', 'TSX', 'LAX', 'LAS', 'AXS']);
const SETS_Y = new Set(['LDY']);
/** the instructions looked back over from a call */
const BACK_INS = 12;

/**
 * What A, X and Y hold at the call at `call` (a JSR or JMP into a player's init), where the code right before it sets
 * them with constants: `ldx #$28 / ldy #$b7 / jsr $b000` (The Last Ninja), also through tax/tay/txa/tya and inx/dex.
 * The trace's instructions back to one another path comes into, or to a call, a jump or a return before it; code the
 * trace did not decode only by the loads with a constant right before the call. Null when it sets none of them.
 */
export function regsAtCall(ctx: Pick<MusicCtx, 'mem' | 'insLen' | 'xrefs' | 'loaded' | 'owner'>, call: Addr): InitRegs | null {
  const { mem, insLen, xrefs, loaded, owner } = ctx;
  const ins: Addr[] = [];
  // another path comes in at p: what the registers hold on it is not known here
  const joins = (p: Addr) => (xrefs.get(p) || []).some(x => x.kind === 'branch' || x.kind === 'jump' || x.kind === 'call');
  if (insLen[call]) {
    for (let p = call; ins.length < BACK_INS && !joins(p);) {
      let q = -1;
      for (let k = 1; k <= 3 && p - k >= 0; k++) if (insLen[p - k] === k) { q = p - k; break; }
      if (q < 0) break;
      const f = OPC[mem[q]].flow;
      if (f !== 'seq' && f !== 'br') break;
      ins.unshift(q); p = q;
    }
  } else {
    for (let p = call; ins.length < 3 && p >= 2 && loaded(p - 2) && owner[p - 2] === owner[call] && !insLen[p - 2] && !insLen[p - 1] && (mem[p - 2] === 0xa9 || mem[p - 2] === 0xa2 || mem[p - 2] === 0xa0); p -= 2) ins.unshift(p - 2);
  }
  let a: number | null = null, x: number | null = null, y: number | null = null;
  for (const p of ins) {
    const o = OPC[mem[p]], v = mem[p + 1];
    if (o.mode === 'imm' && o.mn === 'LDA') a = v;
    else if (o.mode === 'imm' && o.mn === 'LDX') x = v;
    else if (o.mode === 'imm' && o.mn === 'LDY') y = v;
    else if (o.mn === 'TAX') x = a;
    else if (o.mn === 'TAY') y = a;
    else if (o.mn === 'TXA') a = x;
    else if (o.mn === 'TYA') a = y;
    else if (o.mn === 'INX' || o.mn === 'DEX') x = x == null ? null : (x + (o.mn === 'INX' ? 1 : -1)) & 0xff;
    else if (o.mn === 'INY' || o.mn === 'DEY') y = y == null ? null : (y + (o.mn === 'INY' ? 1 : -1)) & 0xff;
    else {
      if (SETS_A.has(o.mn) || (o.mode === 'acc')) a = null;
      if (SETS_X.has(o.mn)) x = null;
      if (SETS_Y.has(o.mn)) y = null;
    }
  }
  if (a == null && x == null && y == null) return null;
  return { ...(a != null ? { a } : {}), ...(x != null ? { x } : {}), ...(y != null ? { y } : {}), at: call };
}

const regsText = (g: InitRegs) => (['a', 'x', 'y'] as const).filter(r => g[r] != null).map(r => `${r.toUpperCase()} = $${g[r]!.toString(16).padStart(2, '0')}`).join(', ');

export function detectMusic(ctx: MusicCtx): MusicInfo[] {
  const { S, insLen, codeOwner, skip, inlineCalls, xrefs, owner, ovList, loaded, forcedData, L, entryKind } = ctx;
  const music: MusicInfo[] = [];
  // the JMPs the program writes into place before it calls them are in the memory the tables are read from and the
  // players run in; an entry that is one is its target, which the block's own bytes play from. Mathematica's demo
  // (Reflex, 1995) writes JMP $081d over the $00 of BASIC's $0800, its player's JMP init, before it calls $0800
  const put = writtenJmps(ctx);
  const mem = put.size ? ctx.mem.slice() : ctx.mem;
  for (const [a, t] of put) { mem[a] = 0x4c; mem[a + 1] = t & 0xff; mem[a + 2] = t >> 8; }
  const entryOf = (e: Addr) => put.get(e) ?? e;

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
  type Kind = 'try' | 'quiet' | 'long' | 'minute' | 'resume' | 'resumeMinute' | 'resumeLong' | 'songTry' | 'songLong';
  const KIND: Record<Kind, Omit<PlayerRunOptions, 'init' | 'play'>> = {
    try: { frames: TRY_FRAMES, loaded },
    long: { frames: LONG_FRAMES, settle: SETTLE, loaded },
    quiet: { frames: MINUTE, quiet: QUIET, loaded },
    minute: { frames: MINUTE, quiet: QUIET, loaded },
    resumeMinute: { frames: MINUTE, quiet: QUIET, loaded, noInit: true },
    resume: { frames: TRY_FRAMES, quiet: QUIET, loaded, noInit: true },
    resumeLong: { frames: LONG_FRAMES, settle: SETTLE, loaded, noInit: true },
    // (a song routine of a player with no table, 5.8c: with what it leaves for play)
    songTry: { frames: TRY_FRAMES, loaded, state: true },
    songLong: { frames: LONG_FRAMES, settle: SETTLE, loaded, state: true },
  };
  const runOf = (init: Addr, play: Addr, kind: Kind, regs?: InitRegs): PlayerRun => {
    // (a run without init gives init nothing)
    const g = KIND[kind].noInit ? undefined : regs;
    const m = memory(), k = `${key}:${init}:${play}:${kind}${g ? `:${g.a ?? '-'},${g.x ?? '-'},${g.y ?? '-'}` : ''}`;
    let r = RUNS.get(k) ?? VERDICTS.get(k);
    if (r) { const c = RUNS.has(k) ? RUNS : VERDICTS; c.delete(k); c.set(k, r); return r; }
    r = runPlayer(m, { init, play, ...KIND[kind], ...(g ? { regs: g } : {}) });
    // a run that played nothing keeps only its verdict, and so does a minute's (only how much it played is asked)
    if (plays(r) && kind !== 'minute' && kind !== 'resumeMinute') keep(RUNS, k, r, RUNS_KEPT); else keep(VERDICTS, k, { ...r, used: EMPTY, state: undefined }, VERDICTS_KEPT);
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

  /** the three bytes at `a` as an init that returns at once: rts (two bytes of the player's after it), nop / rts, nop /
   *  nop / rts */
  const emptyInit = (a: Addr): string | null => {
    if (!loaded(a) || !loaded(a + 2)) return null;
    if (mem[a] === 0x60) return 'rts';
    if (mem[a] === 0xea && mem[a + 1] === 0x60) return 'nop / rts';
    return mem[a] === 0xea && mem[a + 1] === 0xea && mem[a + 2] === 0x60 ? 'nop / nop / rts' : null;
  };

  // every table first, then the players among them
  const cands: Cand[] = [];
  if (S.detectMusic) for (let a = 0; a < 0xfffa; a++) {
    // an init that does nothing where JMP init would be (rts, nop / rts or nop / nop / rts at the start of a page): the
    // song is set in the player's data, and the program only calls play, right after (Booze Design's tunes)
    const empty = (a & 0xff) === 0 ? emptyInit(a) : null;
    if ((mem[a] !== 0x4c && !empty) || !loaded(a) || !loaded(a + 5) || (!insLen[a] && codeOwner[a] >= 0)) continue;
    const near = (t: Addr) => loaded(t) && owner[t] === owner[a] && t >= a - BEFORE && t < a + SPAN;
    const t0 = empty ? a : word(mem, a + 1);
    if (!near(t0)) continue;
    // JMP init, then JMP play (up to four JMPs), or the play code itself right after them
    const slots: Slot[] = [{ at: a, to: t0, jmp: !empty }];
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

    // what the program gives init where it calls it (constants loaded right before the call), each set once, the ones
    // that set more registers first
    let callRegs: InitRegs[] | null = null;
    const regsOfCalls = (): InitRegs[] => {
      if (callRegs) return callRegs;
      const at = new Set<Addr>();
      for (const e of slots[0].jmp ? [a, slots[0].to] : [a]) {
        for (const x of calls(e)) at.add(x.from);
        for (const p of rawRefs(e)) if (outside(p)) at.add(p);
      }
      const sets = new Map<string, InitRegs>();
      for (const p of [...at].sort((u, v) => u - v)) {
        const g = regsAtCall({ mem, insLen, xrefs, loaded, owner }, p);
        // X or Y set, not to 0 both (what the run without them gave init): a number in A alone is a song, or a sound
        // effect's argument (lda #3 / jsr sfx), and every player plays its first song
        if (!g || (!g.x && !g.y)) continue;
        const k = `${g.a ?? '-'},${g.x ?? '-'},${g.y ?? '-'}`;
        if (!sets.has(k)) sets.set(k, g);
      }
      const n = (g: InitRegs) => (g.a != null ? 1 : 0) + (g.x != null ? 1 : 0) + (g.y != null ? 1 : 0);
      return (callRegs = [...sets.values()].sort((u, v) => n(v) - n(u)).slice(0, 4));
    };

    // run it when its code writes the SID: each entry after init as play, the one that plays best
    let ran: { slot: Slot; run: PlayerRun; regs?: InitRegs } | null = null;
    if (slots.length > 1 && reaches.some(reachWritesSid)) {
      for (const s of slots.slice(1)) {
        // a tune can start quietly: one whose init and play return and write the SID as music does (8 registers) but
        // that do not play yet are heard for a minute
        const tryWith = (g?: InitRegs) => {
          const r = runOf(a, s.at, 'try', g);
          return !plays(r) && r.init && !r.stop && r.regs >= 8 ? runOf(a, s.at, 'quiet', g) : r;
        };
        let r = tryWith(), regs: InitRegs | undefined, returns = r.init;
        // it does not play with the song number alone: with what the program gives init (The Last Ninja's player takes
        // its song's address in X and Y), for 3 s each (a routine called with an argument, a sound effect's, plays
        // nothing either way)
        if (!plays(r) && !empty) for (const g of regsOfCalls()) {
          const q = runOf(a, s.at, 'try', g);
          returns ||= q.init;
          if (plays(q)) { r = q; regs = g; break; }
        }
        if (plays(r) && (!ran || better(r, ran.run))) ran = { slot: s, run: r, ...(regs ? { regs } : {}) };
        // init did not return: no entry after it plays
        if (!returns) break;
      }
    }

    const judged = ((): Cand | null => {
      // the program's own start is not a player's init (unless it plays), and an init that does nothing counts only
      // when the player plays (an rts with code after it is everywhere)
      if (entryKind.get(a) === 'entry' || empty) return null;
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
      const g = ran.regs, r = runOf(a, judged.play, 'try', g);
      ran = plays(r) ? { slot: slots.find(s => s.at === judged.play)!, run: r, ...(g ? { regs: g } : {}) } : null;
    }
    let c: Cand | null = judged;
    if (ran) {
      // the run decides play; the table is a player whatever calls it
      const r = ran.run, play = ran.slot.at;
      if (!c) {
        const entries = slots.filter(s => s.jmp || s === ran!.slot || s === slots[0]);
        const sub = reach(entries.map(s => s.to));
        const regs = sidRegs(sub);
        const callsA = calls(a).filter(x => x.kind === 'call').length, callsB = calls(play).filter(x => x.kind === 'call').length;
        const why = [empty ? `an init that does nothing (${empty}), then ${ran.slot.jmp ? 'JMP play' : 'the play code'} at +${play - a}`
          : ran.slot.jmp && play === a + 3 ? 'JMP init / JMP play table' : ran.slot.jmp ? `JMP init / JMP play table (play at +${play - a})` : `JMP init, then the play code at +${play - a}`];
        let score = 2 + ((a & 0xff) === 0 ? 1 : 0) + (callsA && callsB ? 2 : callsA || callsB ? 1 : 0);
        if (callsA || callsB) why.push(callsA && callsB ? 'init and play both called from outside' : 'called from outside');
        if ((a & 0xff) === 0) why.push('page aligned');
        let hi = tableEnd;
        for (const [pc, len] of sub.ins) hi = Math.max(hi, pc + len);
        const irq = irqPlays(ran.slot);
        if (irq) why.push('play called from the IRQ');
        c = { start: a, api: entries.map(s => s.at), play, sub, regs, sidAt: [...sub.ins.keys()].filter(isSidWrite), score, why, hi, irq, judged: false, ...(empty ? { empty: true } : {}) };
      } else if (c.play !== play) {
        c.why.push(`play at ${$4(play)}, not ${$4(c.play)}: that is the one that plays`);
        c.play = play;
        if (!c.api.includes(play)) c.api.push(play);
      }
      c.score += 4;
      c.run = r;
      if (ran.regs) {
        c.initRegs = ran.regs;
        c.why.push(`init plays with what the program gives it at ${$4(ran.regs.at!)}: ${regsText(ran.regs)} (with the song number alone it plays nothing)`);
      }
    }
    if (c) cands.push(c);
  }
  // players with no jump table (5.8c): the IRQ calls play, the program's own routines start the songs
  if (S.detectMusic) cands.push(...calledPlayers());
  /** What the run says about a player found (the tables that become blocks only: a snapshot's costs two minutes of
   *  play). In a snapshot the player ran before: when it plays far more on from where it was than init starts it
   *  again (init no longer does, say, as a player whose code changed itself), it plays on without init. A player
   *  whose songs the program's routines start plays from what they leave. */
  const settle = (c: Cand) => {
    const a = c.start, init = initOf(c);
    const withInit = c.run ?? runOf(init, c.play, 'try', c.initRegs);
    const goesOn = !c.songs && memory() && snapshot && plays(runOf(a, c.play, 'resume')) ? runOf(a, c.play, 'resumeMinute') : null;
    const minute = goesOn ? runOf(a, c.play, 'minute', c.initRegs) : null;
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
  const minute = (c: Cand) => { let v = heard.get(c); if (v == null) heard.set(c, v = musical(runOf(initOf(c), c.play, c.resume ? 'resumeMinute' : 'minute', c.initRegs))); return v; };
  /** the run of a table that starts its player's code runs nothing in the bytes before it (where code can be: BEFORE) */
  const runOpens = (c: Cand) => {
    if (!c.run) return true;
    for (let p = Math.max(0, c.start - BEFORE); p < c.start; p++) if ((c.run.used[p] & USED_RUN) && owner[p] === owner[c.start]) return false;
    return true;
  };
  const clientOf = (a: Cand, b: Cand) => {
    // (a caller starts the player it calls, which an init that does nothing does not: a table it runs through is a JMP
    // in its own play code, followed by more of it; nor does a player with no table, which the IRQ calls itself)
    if (a.empty || a.songs || (b.start >= a.start && b.start < a.start + 3 * a.api.length)) return false;
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
    // (a player with no table: each song's run, and what play ran and read in them together, its variables the song's
    // routine wrote too; not what the routines ran, the program's code, whose bytes the songs' init puts in place)
    const songRuns = c.songs?.map(x => { const r = runOf(x, c.play, 'songLong'); return plays(r) && r.state ? r : runOf(x, c.play, 'songTry'); });
    if (c.run) {
      run = songRuns ? songRuns[0] : runOf(a, c.play, c.resume ? 'resumeLong' : 'long', c.initRegs);
      if (!plays(run)) run = c.run;
      let u = run.used;
      if (songRuns) {
        u = new Uint8Array(0x10000);
        for (const { state: st } of songRuns) if (st) for (let p = 0; p < 0x10000; p++) u[p] |= (st.ran[p] ? USED_RUN : 0) | (st.read[p] ? USED_READ : 0);
      }
      const other = (p: Addr) => !loaded(p) || owner[p] !== owner[a] || (p >= 0xd000 && p < 0xe000 && !u[p])
        || music.some(m => p >= m.start && p < m.end) || (starts.has(p) && p !== a)
        || (!!insLen[p] && !(u[p] & USED_RUN) && !c.sub.ins.has(p));
      // the code the run ran near the table is the player's whatever lies between: without it, it runs out of its block
      // (and with no table what play read too: Bomb Jack's song data lie past its sound effects' code)
      let top = e, bottom = a;
      for (let p = Math.max(0x0200, a - BEFORE); p < Math.min(0x10000, a + SPAN); p++) {
        if (!(songRuns ? u[p] : u[p] & USED_RUN) || !loaded(p) || owner[p] !== owner[a] || music.some(m => p >= m.start && p < m.end)) continue;
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
    // a player with no table: what each song's routine leaves for play (the bytes it wrote that play read, the SID
    // registers it set) and the bytes outside the block play read, as the program has them, which an init next to
    // the block puts in place (the routines are the program's, out of the block)
    let songs: MusicSong[] | undefined;
    if (c.songs && songRuns) {
      const out: MusicSong[] = [];
      for (const [k, r] of songRuns.entries()) {
        const st = r.state;
        if (!st) { out.length = 0; break; }
        const state: [Addr, number][] = [];
        for (let p = 2; p < 0x10000; p++) {
          if (!st.read[p] || (p >= 0x0100 && p < 0x0200) || (p >= 0xd000 && p < 0xe000) || p >= 0xfffa) continue;
          if (st.wrote[p] || p < s || p >= e) state.push([p, st.after[p]]);
        }
        st.sid.forEach((v, q) => { if (v >= 0) state.push([0xd400 + q, v]); });
        if (state.length > MAX_RESUME) { c.why.push(`the routine at ${$4(c.songs[k])} that starts song ${k} leaves ${state.length} bytes for play, too many to put in place: the block plays only in the program`); out.length = 0; break; }
        out.push({ at: c.songs[k], state });
      }
      if (out.length) songs = out;
    }
    for (const x of new Set([a, c.play])) {
      const t = put.get(x);
      if (t != null) c.why.push(`the program writes JMP ${$4(t)} at ${$4(x)} before it calls it: ${x === a ? 'init' : 'play'} is ${$4(t)}`);
    }
    music.push({
      start: s, end: e, init: entryOf(initOf(c)), play: entryOf(c.play), sidRegs: run ? run.regs : c.regs.size, score: c.score, why: c.why, file: owner[a],
      ...(run ? { run: { regs: run.regs, notes: run.notes, seconds: Math.round(run.played / 50) } } : {}), ...(resume ? { resume } : {}),
      // (a player that plays on without init is given nothing)
      ...(c.initRegs && !c.resume ? { initRegs: c.initRegs } : {}),
      ...(songs ? { songs } : {}),
    });
  }
  if (S.detectMusic) samplePlayers();
  music.sort((x, y) => x.start - y.start);
  for (const m of music) L('ok', `Music detected at ${$4(m.start)}-${$4(m.end - 1)} (score ${m.score}: ${m.why.join(', ')})`, m.start, 'music');
  for (const o of ovList) if (o.type === 'music' && !music.some(m => m.start === o.start))
    music.push({ start: o.start, end: o.end, init: o.props?.init ?? o.start, play: o.props?.play ?? o.start + 3, sidRegs: 0, score: 0, why: ['marked by user'], file: owner[o.start], user: true });
  return music;

  /* 5.8c Players with no jump table. The IRQ calls play (a JSR in its code to a routine that writes the SID), and the
   * program starts each song with a routine of its own, which writes bytes play reads (its pointers, its tempo) and can
   * lie far from the player: Bomb Jack (Elite, 1986) calls play $7448 from its IRQs, and each of six routines at
   * $08f1-$093b sets a song up ($8400, $8c4f, ...) and copies its pointers to where play reads them ($0e7b). The
   * program's routines that write what play reads are run as init, play once a frame after; of a routine and one it
   * calls, the one that leaves play more is the song's (the one called when they leave the same), and routines that
   * leave play the same bytes are one song. One song must play on for a minute: a sound effect stops. */
  function calledPlayers(): Cand[] {
    fromIrq(-1);
    const irq = irqCode!;
    if (!irq.size) return [];
    // the tables found (their entries, where their JMPs go, the code they reach) are players already
    const taken = new Set<Addr>(), entries = new Set<Addr>();
    for (const c of cands) for (const e of c.api) { taken.add(e); entries.add(e); if (mem[e] === 0x4c) taken.add(word(mem, e + 1)); }
    // play: a routine the IRQ's code calls that writes 8 SID registers or more, keeps its code together and calls no
    // table's entry (that table is the player); not a routine of a table's code (The Last Ninja's IRQ calls the play
    // code its table at $1000 runs into)
    const found: { t: Addr; from: Addr; regs: Set<Addr> }[] = [];
    for (const pc of irq) {
      if (mem[pc] !== 0x20) continue;
      const t = word(mem, pc + 1);
      if (taken.has(t) || found.some(x => x.t === t) || !loaded(t) || !insLen[t] || cands.some(c => c.sub.ins.has(t))) continue;
      const r = reachOf(t);
      if (r.bad > 2 || r.illegal * 8 > r.ins.size) continue;
      const regs = sidRegs(r);
      if (regs.size < 8) continue;
      let away = 0, calls = false;
      for (const p of r.ins.keys()) {
        if (p < t - BEFORE || p >= t + SPAN) away++;
        if (OPC[mem[p]].flow === 'jsr' && entries.has(word(mem, p + 1))) calls = true;
      }
      if (away > 16 || calls) continue;
      found.push({ t, from: pc, regs });
    }
    // one routine inside another (play's own subroutine, or a routine that only calls play): the one that writes more
    // SID registers, the inner one when they write the same
    const within = (x: { t: Addr }, y: { t: Addr }) => x.t !== y.t && reachOf(y.t).ins.has(x.t);
    const same = (p: Set<Addr>, q: Set<Addr>) => p.size === q.size && [...p].every(r => q.has(r));
    const kept = found.filter(x => !found.some(y => (within(x, y) && !same(x.regs, y.regs)) || (within(y, x) && same(x.regs, y.regs))));
    const traced = new Map<Addr, Reach>();
    const tracedReach = (e: Addr) => { let r = traced.get(e); if (!r) traced.set(e, r = reach([e], true)); return r; };
    const out: Cand[] = [];
    for (const { t, from, regs } of kept) {
      const sub = reachOf(t);
      // what play reads: its variables (absolute and zero page) and the pointers it reads through
      const reads = new Set<Addr>();
      for (const p of sub.ins.keys()) {
        const o = OPC[mem[p]], d = decode(mem, p);
        if (o.mode === 'izx' || o.mode === 'izy') { reads.add(d.v!); reads.add((d.v! + 1) & 0xff); }
        else if ((o.access === 'read' || o.access === 'rmw') && (o.mode === 'abs' || o.mode === 'zp') && (d.target! < 0xd000 || d.target! >= 0xe000)) reads.add(d.target!);
      }
      // the routines the program calls whose code writes two of them or more, those that write the most first
      const tried: { e: Addr; hits: number; size: number }[] = [];
      for (const [e, xs] of xrefs) {
        if (e === t || sub.ins.has(e) || !insLen[e] || !xs.some(x => x.kind === 'call')) continue;
        const r = tracedReach(e), hit = new Set<Addr>();
        for (const p of r.ins.keys()) {
          const o = OPC[mem[p]];
          if ((o.access === 'write' || o.access === 'rmw') && (o.mode === 'abs' || o.mode === 'zp')) { const d = decode(mem, p).target!; if (reads.has(d)) hit.add(d); }
        }
        if (hit.size >= 2) tried.push({ e, hits: hit.size, size: r.ins.size });
      }
      tried.sort((x, y) => y.hits - x.hits || x.size - y.size || x.e - y.e);
      // each run as init: those that play notes that can be heard (frequencies the program builds as it runs, or a
      // volume another routine sets, are 0 in the file)
      const ok: { e: Addr; r: PlayerRun; st: PlayerState }[] = [];
      for (const { e } of tried.slice(0, SONG_TRIES)) {
        const r = runOf(e, t, 'songTry');
        if (plays(r) && r.heard >= 2 && r.state) ok.push({ e, r, st: r.state });
      }
      if (!ok.length) continue;
      // what play read in any of the runs (which bytes it reads depends on the song's path)
      const any = new Uint8Array(0x10000);
      for (const { st } of ok) for (let p = 2; p < 0x10000; p++) any[p] |= st.read[p];
      const read: Addr[] = [];
      for (let p = 2; p < 0x10000; p++) if (any[p] && (p < 0x0100 || p >= 0x0200) && (p < 0xd000 || p >= 0xe000)) read.push(p);
      const left = (x: { st: PlayerState }) => read.filter(p => x.st.wrote[p]);
      // a routine that calls another is the song's when it writes bytes play reads that the one it calls does not (Bomb
      // Jack's $08f1 copies the song's pointers to where play reads them after $8400 set it up); else the one called
      const calls = (x: { e: Addr }, y: { e: Addr }) => x.e !== y.e && tracedReach(x.e).ins.has(y.e);
      const more = (x: { st: PlayerState }, y: { st: PlayerState }) => read.some(p => x.st.wrote[p] && !y.st.wrote[p]);
      const starts = ok.filter(y => !ok.some(x => (calls(x, y) && more(x, y)) || (calls(y, x) && !more(y, x))));
      // (routines that leave play the same bytes start the same song)
      const seen = new Set<string>();
      const songs = starts.sort((x, y) => x.e - y.e).filter(x => {
        const k = left(x).map(p => `${p}:${x.st.after[p]}`).join(',');
        if (!k || seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      if (!songs.length || !songs.some(x => runOf(x.e, t, 'minute').heard >= STUCK)) continue;
      let hi = t + 1;
      for (const [p, len] of sub.ins) if (p >= t - BEFORE && p < t + SPAN) hi = Math.max(hi, p + len);
      const first = songs[0];
      const why = [`no jump table: the IRQ calls play ${$4(t)} (at ${$4(from)})`,
        songs.length === 1 ? `the program starts its song with the routine at ${$4(first.e)}, which sets ${left(first).length} bytes play reads`
          : `the program starts its ${songs.length} songs with routines of its own (${songs.map(x => $4(x.e)).join(', ')}), which set the bytes play reads`];
      out.push({ start: t, init: first.e, api: [t], play: t, sub, regs, sidAt: [...sub.ins.keys()].filter(isSidWrite), score: 9, why, hi, irq: true, judged: true, run: first.r, songs: songs.map(x => x.e) });
    }
    return out;
  }

  /* 5.8b Sample players (digis). A routine whose code turns on a CIA timer's interrupt (a constant with bit 7 and a
   * timer's bit stored into $dc0d or $dd0d), in a program that sets a timer this fast (a latch's high byte below 8),
   * is run as init (c64/sidrun.ts, runDigi): the timer and the vector init leaves give the handler, which is run as
   * often as the timer would call it. One that writes samples to the SID is a player. Its block is the bytes around
   * init that init and the handler used (as a frame player's: gaps under GAP, up to code the run did not run); what
   * else they read (the samples and the song, a copied handler's source) plays with it as its parts. Voodoo People
   * (1995) copies its NMI to $0080 and mixes four channels of sample pages into two voices' pulse widths, 6158 times
   * a second: no JMP table, no play routine, nothing the trace reaches. */
  function samplePlayers() {
    const writes = ctx.ev?.writes;
    if (!writes?.length) return;
    // ($dc05, $dc07, $dd05, $dd07: the timers' latches, high bytes)
    if (!writes.some(w => (w.dest & 0xfefd) === 0xdc05 && w.v != null && w.v < 8)) return;
    const on = writes.filter(w => (w.dest === 0xdc0d || w.dest === 0xdd0d) && w.v != null && (w.v & 0x80) && (w.v & 0x03) && insLen[w.pc]);
    if (!on.length) return;
    // the routines whose code reaches each of those stores, the smallest first (the program's start reaches them all)
    const routines = [...entryKind].filter(([, k]) => k === 'sub' || k === 'entry' || k === 'user' || k === 'ptr' || k === 'guess').map(([e]) => e);
    const traced = new Map<Addr, Reach>();
    const tracedReach = (e: Addr) => { let r = traced.get(e); if (!r) traced.set(e, r = reach([e], true)); return r; };
    const inits: Addr[] = [];
    for (const w of on) {
      const around = routines.filter(e => tracedReach(e).ins.has(w.pc)).sort((x, y) => tracedReach(x).ins.size - tracedReach(y).ins.size || x - y);
      for (const e of around.slice(0, 3)) if (!inits.includes(e)) inits.push(e);
    }
    const m0 = memory();
    const port = snapshot ? undefined : (ctx.project?.entryPort ?? 0x37);
    // how a run is made: `loop`, an init that does not return taken as it left the player; `irq`, the program's IRQ
    // run once a frame (a sequencer that starts the samples)
    type Mode = { loop?: boolean; irq?: { handler: Addr; kernal: boolean } };
    const runOfDigi = (init: Addr, long: boolean, mode: Mode = {}): DigiRun => {
      const k = `${key}:${init}:${port ?? '-'}:${long ? 'long' : 'try'}:${mode.loop ? 'loop' : ''}:${mode.irq?.handler ?? ''}`;
      let r = DIGI_RUNS.get(k);
      if (r) { DIGI_RUNS.delete(k); DIGI_RUNS.set(k, r); return r; }
      r = runDigi(m0, { init, frames: long ? LONG_FRAMES : TRY_FRAMES, settle: long ? SETTLE : undefined, port, loaded, ...mode });
      DIGI_RUNS.set(k, digiPlays(r) ? r : { ...r, used: EMPTY, wrote: EMPTY, after: undefined, handlerUsed: undefined, handlerWrote: undefined });
      while (DIGI_RUNS.size > DIGI_KEPT) DIGI_RUNS.delete(DIGI_RUNS.keys().next().value!);
      return r;
    };
    // the program's IRQ handlers (the trace's), through $0314 (the KERNAL's entry) unless only $fffe is set to them
    const irqs = [...entryKind].filter(([, k]) => k === 'irq').map(([h]) => {
      const vs = ctx.ev?.vectors.get(h);
      return { handler: h, kernal: !vs || vs.has(0x0314) || !vs.has(0xfffe) };
    }).filter(q => q.handler < 0xe000 || loaded(q.handler)).slice(0, 3);
    const ranges = (has: (p: Addr) => boolean): [Addr, Addr][] => {
      const out: [Addr, Addr][] = [];
      for (let p = 0x0200; p < 0x10000; p++) {
        if (!has(p)) continue;
        const last = out[out.length - 1];
        if (last && p - last[1] < 0x100) last[1] = p + 1; else out.push([p, p + 1]);
      }
      return out;
    };
    const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;
    for (const init of inits) {
      if (music.some(m => m.digi && m.init === init)) continue;
      // (an init that does not return, the program's start going on into its main loop: the player as it left it)
      let t = runOfDigi(init, false, { loop: true });
      let mode: Mode = t.loop ? { loop: true } : {};
      // a handler that runs but plays nothing, or plays now and then (a sample init left, which ends), may play what the
      // program's IRQ starts (a sequencer there): that run, when it plays clearly more
      // (an init that does not return has set the program's IRQ vector itself, often where the trace did not go)
      const candidates = (x: DigiRun) => {
        const set = x.after && ((x.port & 2) ? 0x0314 : 0xfffe), h = set ? x.after![set] | (x.after![set + 1] << 8) : -1;
        return [...(h >= 0 && loaded(h) && h !== x.handler && !irqs.some(q => q.handler === h) ? [{ handler: h, kernal: set === 0x0314 }] : []), ...irqs];
      };
      const better = (long: boolean, x: DigiRun) => {
        for (const q of candidates(x)) {
          const y = runOfDigi(init, long, { ...mode, irq: q });
          if (digiPlays(y) && (!digiPlays(x) || y.sidCalls > x.sidCalls * 1.25)) return { q, y };
        }
        return null;
      };
      if (!t.stop && t.calls > 0 && (!digiPlays(t) || t.sidCalls * 10 < t.calls * 9)) {
        const b = better(false, t);
        if (b) { mode = { ...mode, irq: b.q }; t = b.y; }
      }
      if (!digiPlays(t)) continue;
      // one player once: an outer routine (the program's start) reaches the init of one found already
      if (music.some(m => m.digi && m.digi.handler === t.handler && m.digi.vector === t.vector)) continue;
      let r = runOfDigi(init, true, mode);
      if (!digiPlays(r)) r = t;
      // samples that stop before the song comes round: what starts them again may be the program's IRQ
      if (!mode.irq && r.sidCalls * 2 < r.calls) {
        const b = better(true, r);
        if (b) { mode = { ...mode, irq: b.q }; r = b.y; }
      }
      // what the block is made of: all the run used and wrote, or with `loop` what the handler (and the IRQ) did, as
      // init's own run went on into the program
      const u = mode.loop ? r.handlerUsed! : r.used, w = mode.loop ? r.handlerWrote! : r.wrote;
      const after = r.after, changed = (p: Addr) => !!after && (!loaded(p) || after[p] !== m0[p]);
      // the block: those bytes around init (with `loop`, around the handler, else the first loaded byte the handler
      // used), up to code the run did not run, another player or another file's bytes
      const anchor = !mode.loop ? init : loaded(r.handler) && !changed(r.handler) ? r.handler : (() => { for (let p = 0x0200; p < 0x10000; p++) if (u[p] && loaded(p) && !changed(p)) return p; return -1; })();
      if (anchor < 0) continue;
      const fa = owner[anchor];
      // (bytes init changed are the block's too: what init left is put back over them)
      const other = (p: Addr) => !loaded(p) || owner[p] !== fa || music.some(m => p >= m.start && p < m.end) || (!!insLen[p] && !(u[p] & USED_RUN));
      let s = anchor, e = anchor + 1;
      for (let p = anchor, last = anchor; p < 0x10000 && p - last < GAP && !other(p); p++) if (u[p] || w[p]) { last = p; e = p + 1; }
      for (let p = anchor - 1, last = anchor; p >= 0x0200 && last - p < GAP && !other(p); p--) if (u[p] || w[p]) { last = p; s = p; }
      // (a frame player whose init also starts samples, digi drums, keeps its block: the parts are outside that)
      const same = mode.loop ? undefined : music.find(m => m.init === init);
      if (same) { s = same.start; e = same.end; }
      // with `loop`, the bytes the handler uses as init left them, where they are not the program's own (the zero page
      // init set, a copied handler, the vector, $01) and the SID registers init wrote: put back before the timer starts
      let resume: [Addr, number][] | undefined;
      if (mode.loop && after) {
        resume = [[1, r.port], [r.vector, after[r.vector]], [r.vector + 1, after[r.vector + 1]]];
        for (let p = 2; p < 0x10000; p++) {
          if (!u[p] || (p >= 0x0100 && p < 0x0200) || (p >= 0xd000 && p < 0xe000) || p === r.vector || p === r.vector + 1 || !changed(p)) continue;
          resume.push([p, after[p]]);
        }
        if (resume.length > MAX_LOOP_RESUME) continue;
        r.sid!.forEach((v, k) => { if (v >= 0) resume!.push([0xd400 + k, v]); });
      }
      const parts = ranges(p => !!u[p] && (p < s || p >= e) && loaded(p));
      const put = new Set((resume ?? []).map(([a]) => a));
      const wrote = ranges(p => (!!w[p] || put.has(p)) && (p < s || p >= e) && (p < 0xd000 || p >= 0xe000));
      // the registers the samples go to: those written about as often as the one written most, with values that change
      const most = Math.max(...r.regs.map(x => x.writes));
      const regs = r.regs.filter(x => x.writes * 2 >= most && x.values >= 2).sort((x, y) => x.reg - y.reg);
      const values = Math.max(...r.regs.map(x => x.values));
      const seconds = Math.round(r.played / 50);
      const info: DigiInfo = {
        nmi: r.nmi, hz: r.hz, latch: r.latch, handler: r.handler, vector: r.vector, port: r.port, regs: regs.map(x => x.reg), values, seconds, parts, wrote,
        ...(mode.loop ? { loop: true, timer: r.timer! } : {}), ...(mode.irq ? { irq: mode.irq } : {}),
      };
      const partBytes = parts.reduce((n, [a, b]) => n + b - a, 0);
      const it = r.nmi ? 'NMI' : 'IRQ';
      const why = [
        `a sample player: ${mode.loop ? `init ${$4(init)}, which does not return (it goes on into the program), leaves` : `init ${$4(init)} starts`} CIA ${r.nmi ? 2 : 1}'s timer (every ${r.latch + 1} cycles, ${r.hz} Hz) with its ${it} at ${$4(r.handler)} (vector ${$4(r.vector)})`,
        ...(mode.irq ? [`the program's IRQ at ${$4(mode.irq.handler)} starts the samples (a sequencer there): with it run once a frame the ${it} plays`] : []),
        `the ${it} writes samples to ${regs.map(x => $4(x.reg)).join(', ')} (${sampleRegs(regs.map(x => x.reg))}) in ${r.sidCalls === r.calls ? 'every interrupt' : `${Math.round(100 * r.sidCalls / r.calls)} % of the interrupts`}: ${values} different values in ${seconds} s`,
        ...(parts.length ? [`it plays from ${parts.map(([a, b]) => `${$4(a)}-${$4(b - 1)}`).join(', ')} too (${kb(partBytes)}: its samples and song)`] : []),
        ...(resume ? [`it plays from the ${resume.length} bytes, registers and vector init leaves (put back in place of init)`] : []),
        ...(r.sidCalls * 2 < r.calls ? [`its samples stop after ${Math.round(r.lastSid / 50)} s: what starts them again (the program's main loop, or an IRQ the run did not find) does not run with it`] : []),
      ];
      // a frame player whose init also starts samples (digi drums): that player, with the samples it plays
      if (same) { same.digi = info; same.why.push(...why); continue; }
      if (music.some(m => m.start < e && s < m.end)) continue;
      music.push({ start: s, end: e, init, play: 0, sidRegs: r.regs.length, score: 10, why, file: fa, digi: info, ...(resume ? { resume } : {}) });
    }
  }
}

/** what the SID registers samples go to are: the volume (4-bit samples), pulse widths (PWM), frequencies, ... */
function sampleRegs(regs: Addr[]): string {
  const name = (a: Addr) => {
    const r = a - 0xd400;
    if (r === 0x18) return 'volume';
    if (r < 0x15) return ['frequency', 'frequency', 'pulse width', 'pulse width', 'control', 'attack/decay', 'sustain/release'][r % 7];
    return r === 0x17 ? 'resonance' : 'filter cutoff';
  };
  return [...new Set(regs.map(name))].join(', ');
}

