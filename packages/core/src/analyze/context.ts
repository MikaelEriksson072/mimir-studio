/* Shared mutable state of one analysis run. Every stage in analyze/* reads
 * and writes this object; the order of the stages is fixed in analyze/index. */
import type {
  Addr, BasicInfo, DelaySled, EntryKind, FileInput, ImmediateHint, IndirectJump, LogEntry, LogLevel,
  GoneWhy, LohiTable, Override, ProblemCode, ProblemLevel, ProjectInput, RelocInfo, Settings, SpindleDriver, TextEncoding, XRef, XRefKind,
} from '../types';
import { DEFAULT_SETTINGS, T } from '../model';
import type { CartMode } from '../c64/memconfig';
import { projectCartMode } from '../c64/crt';
import type { CartStart } from './cartridge';
import type { CaseSwitch, Printer, StringEv } from './strings';

/** Entry-point priority: a stronger kind replaces a weaker one at the same address. */
export const PRI: Record<EntryKind, number> = { entry: 9, irq: 8, nmi: 8, brk: 7, user: 7, sub: 6, ptr: 5, guess: 4, jmp: 3, branch: 2 };
export const VECTORS: Record<number, 'irq' | 'brk' | 'nmi' | undefined> = { 0x0314: 'irq', 0x0316: 'brk', 0x0318: 'nmi', 0xfffe: 'irq', 0xfffa: 'nmi' };
export const PET_CTRL = new Set([0x05, 0x0d, 0x0e, 0x11, 0x12, 0x13, 0x1c, 0x1d, 0x1e, 0x1f, 0x81, 0x8e, 0x90, 0x91, 0x92, 0x93, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0x9b, 0x9c, 0x9d, 0x9e, 0x9f]);

/** Constant written to memory by a store instruction (evidence pass). */
export interface WriteEvidence { pc: Addr; dest: Addr; v: number | null; indexed?: boolean }
/** `LDA tA,X / STA p / LDA tB,X / STA p+1` pair candidate. */
export interface LohiPair { lo: Addr; hi: Addr; dest: Addr; r: 'x' | 'y'; pc: Addr }

/** Evidence collected by the linear constant-propagation pass; rebuilt on every pass. */
export interface Evidence {
  writes: WriteEvidence[];
  hints: Map<Addr, ImmediateHint>;
  ptrTargets: Map<Addr, Addr>;
  lohi: LohiPair[];
  dataEv: Map<Addr, Set<string>>;
  wordPtrs: Set<Addr>;
  textPtrs: Map<Addr, TextEncoding>;
  /** 5.5b the strings handed to print routines (they are in textPtrs too), and the program's own print routines */
  strings: Map<Addr, StringEv>;
  printers: Map<Addr, Printer>;
  /** 5.5c a $0e or $8e the code sends to a character output routine */
  cases: CaseSwitch[];
  smc: Map<Addr, Addr>;
  /** interrupt handler -> the vector addresses it was installed through */
  vectors: Map<Addr, Set<Addr>>;
}

/** Logs a line once: a warning, error or tip (what the Problems tab lists) with the code of its kind of problem. */
export interface LogFn {
  (lvl: 'info' | 'ok', msg: string, addr?: Addr | null, cat?: string): void;
  (lvl: ProblemLevel, msg: string, addr: Addr | null, cat: string, code: ProblemCode): void;
}

export interface Ctx {
  project: ProjectInput;
  S: Settings;
  files: FileInput[];
  mem: Uint8Array;
  owner: Int16Array;
  log: LogEntry[];
  /** the messages logged so far (each is logged once) */
  logged: Set<string>;
  L: LogFn;
  loaded: (a: number) => boolean;
  /** the relocated blocks placed where they run (8.1b): the copy of block k is owned by `files.length + k`, so an
   *  instruction or a block never runs from it into other bytes; the result gives those bytes the file they are of */
  relocs: RelocInfo[];
  // overrides
  ov: Uint8Array;
  ovList: Override[];
  ovProps: Map<Addr, Override>;
  /** inside a code override that is one block (`one`), after its start: no routine starts a code block here */
  joined: Uint8Array;
  forcedData: (a: Addr) => boolean;
  /** the memory map of the cartridge the files are chips of ('none': no cartridge) */
  cart: CartMode;
  /** its start vectors in the loaded chips (5.3b) */
  cartStart: CartStart | null;
  // entry points and tracing
  basics: BasicInfo[];
  insLen: Uint8Array;
  codeOwner: Int32Array;
  skip: Set<Addr>;
  xrefs: Map<Addr, XRef[]>;
  addX: (to: Addr, from: Addr, kind: XRefKind) => void;
  entryKind: Map<Addr, EntryKind>;
  queue: Addr[];
  enqueue: (a: Addr, kind: EntryKind, sure?: boolean) => void;
  ijumps: IndirectJump[];
  inlineCalls: Set<Addr>;
  entry: Addr | null;
  // evidence and tables
  ev: Evidence;
  lohiTabs: Map<Addr, LohiTable>;
  /** .word tables of code addresses that an indirect JMP goes through: start -> length in bytes, vector, targets */
  wordTables: Map<Addr, { len: number; dest: Addr; targets: Addr[] }>;
  /** timing code (5.4b): the branches into a delay, and the delays' instructions */
  delays: Map<Addr, DelaySled>;
  delayIns: Set<Addr>;
  /** Spindle's effect drivers (5.4c), in the order the parts run */
  spindle: SpindleDriver[];
  // deep analysis (5.17); null without it
  deep: Deep | null;
  /** guesses waiting to be traced on trial: code islands, pointer-table targets, interrupt handlers, the load address */
  pending: { a: Addr; kind: EntryKind }[];
  /** guesses that tracing on trial showed to lead into problems: the first problem */
  rejected: Map<Addr, { kind: EntryKind; why: LogEntry }>;
  /** calls and jumps not followed, `from * 0x10000 + to` */
  cuts: Map<number, CutWhy>;
  /** conditional branches whose flags the instruction before (`by`) sets: the side not followed */
  flagCut: Map<Addr, { side: Addr; by: Addr }>;
  /** branches (and JSRs, for the bytes after them) whose side ran into a problem when a strong guess was traced on
   *  trial: the side not followed, the guess and the problem */
  blameCut: Map<Addr, { side: Addr; guess: Addr; kind: EntryKind; why: LogEntry }>;
  /** the last decision on the way to an address the trace queued (a branch's side, the bytes after a JSR) */
  decOf: Map<Addr, Decision | null>;
  /** the last decision on the way to each problem the trace ran into (by the problem's address) */
  blame: Map<Addr, Decision | null>;
  /** the problems the traces on trial ran into and the code they read, by address: of a guess left out, or on a side
   *  left out (8.11e) */
  trialBehind: Map<Addr, GoneWhy>;
  /** a copy that traces on trial: the instructions it read (null in the analysis itself) */
  newIns: Addr[] | null;
  /** a copy that traces a guess on trial: a BRK or JAM where code is not there yet counts against it */
  onTrial: boolean;
  /** the $01 configurations new code runs with on trial (an interrupt handler: those its vectors need); 0: the main
   *  code's */
  trialPort: number;
}

/**
 * Why a deep analysis does not follow a call or jump: it reaches ROM, its operand is written by code, the routine is
 * not there yet (a BRK or JAM where it starts), or it never returns.
 */
export type CutWhy = 'rom' | 'smc' | 'empty' | 'noreturn';

/** What a round of a deep analysis learned for the next one (5.17). */
export interface Deep {
  /** the $01 configurations each instruction can run with (0: not code), and their union over all code */
  port: Uint8Array | null;
  main: number;
  /** the bytes code writes */
  written: Uint8Array | null;
  /** JSRs to routines that never return */
  noReturn: Set<Addr>;
  /** the bytes of strings handed to print routines that code islands keep out of (5.5b) */
  text: Set<Addr>;
}

/** A point where a trace chose one way: the side of a branch it went on with, or the bytes after a JSR. */
export interface Decision { at: Addr; side: Addr }

/** The entry points a deep analysis traces on trial before it keeps them. */
export const WEAK: ReadonlySet<EntryKind> = new Set<EntryKind>(['guess', 'ptr', 'irq', 'nmi', 'brk']);
export const cutKey = (from: Addr, to: Addr): number => from * 0x10000 + (to & 0xffff);

export const emptyEvidence = (): Evidence => ({
  writes: [], hints: new Map(), ptrTargets: new Map(), lohi: [], dataEv: new Map(), wordPtrs: new Set(), textPtrs: new Map(), strings: new Map(), printers: new Map(), cases: [], smc: new Map(), vectors: new Map(),
});

export function createContext(project: ProjectInput, deep: Deep | null = null): Ctx {
  const S: Settings = Object.assign({}, DEFAULT_SETTINGS, project.settings || {});
  const mem = new Uint8Array(0x10000);
  const owner = new Int16Array(0x10000).fill(-1);
  const loaded = (a: number) => a >= 0 && a < 0x10000 && owner[a] >= 0;
  const ov = new Uint8Array(0x10000);
  const ctx = {
    project, S, files: project.files, mem, owner, log: [], logged: new Set(), loaded, relocs: [],
    ov, ovList: [], ovProps: new Map(), joined: new Uint8Array(0x10000), forcedData: (a: Addr) => ov[a] !== 0 && ov[a] !== T.CODE,
    cart: projectCartMode(project.cart, project.files), cartStart: null,
    basics: [], insLen: new Uint8Array(0x10000), codeOwner: new Int32Array(0x10000).fill(-1), skip: new Set(), xrefs: new Map(),
    entryKind: new Map(), queue: [],
    ijumps: [], inlineCalls: new Set(), entry: null,
    ev: emptyEvidence(), lohiTabs: new Map(), wordTables: new Map(), delays: new Map(), delayIns: new Set(), spindle: [],
    deep: S.deepAnalysis ? deep ?? { port: null, main: 0, written: null, noReturn: new Set(), text: new Set() } : null,
    pending: [], rejected: new Map(), cuts: new Map(), flagCut: new Map(), onTrial: false, trialPort: 0,
    blameCut: new Map(), decOf: new Map(), blame: new Map(), trialBehind: new Map(), newIns: null,
  } as unknown as Ctx;
  return bind(ctx);
}

/** The log, cross-reference and entry-point functions of `ctx`, over its own state. */
function bind(ctx: Ctx): Ctx {
  const { log, logged, xrefs, entryKind, queue, insLen, loaded, pending } = ctx;
  ctx.L = ((lvl: LogLevel, msg: string, addr: Addr | null = null, cat = 'analysis', code?: ProblemCode) => {
    const key = lvl + msg; if (logged.has(key)) return; logged.add(key);
    log.push(code ? { lvl, msg, addr, cat, code } : { lvl, msg, addr, cat });
  }) as LogFn;
  ctx.addX = (to, from, kind) => {
    to &= 0xffff; let l = xrefs.get(to);
    if (!l) xrefs.set(to, l = []);
    if (!l.some(x => x.from === from && x.kind === kind)) l.push({ from, kind });
  };
  // a deep analysis keeps a guess only once tracing it on trial shows no problems (`sure`: it did)
  ctx.enqueue = (a, kind, sure = false) => {
    a &= 0xffff;
    if (!loaded(a)) return;
    if (ctx.deep && !sure && WEAK.has(kind) && !insLen[a]) { pending.push({ a, kind }); return; }
    const k = entryKind.get(a);
    if (!k || PRI[kind] > PRI[k]) entryKind.set(a, kind);
    if (!insLen[a]) queue.push(a);
  };
  return ctx;
}

/** A copy of the trace state of `ctx` to trace a guess on trial: what it logs is its own, the rest is shared. */
export function forkTrace(ctx: Ctx): Ctx {
  return bind({
    ...ctx, insLen: ctx.insLen.slice(), codeOwner: ctx.codeOwner.slice(), skip: new Set(ctx.skip), xrefs: new Map(),
    entryKind: new Map(ctx.entryKind), queue: [], ijumps: [], inlineCalls: new Set(ctx.inlineCalls),
    log: [], logged: new Set(ctx.logged), pending: [], cuts: new Map(), flagCut: new Map(ctx.flagCut), onTrial: true,
    blameCut: new Map(ctx.blameCut), decOf: new Map(), blame: new Map(), newIns: [],
  });
}
