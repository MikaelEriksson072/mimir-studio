/* 5.5 evidence pass: constant propagation over linear runs of instructions */
import { emptyEvidence, VECTORS, type Ctx } from './context';
import { CLOBBER_A, OPC, SHIFT_MN } from '../cpu/opcodes';
import { decode } from '../cpu/decode';
import { SYM, isIO } from '../c64/symbols';
import type { Addr } from '../types';
import { $4 } from '../util/hex';
import { CHAR_OUT, handedText, printers, printLoop, sentCase, type Place, type StringEv } from './strings';

/** An indexed table read; `from`: the index it starts with, when known (a loop's first value) */
interface IndexedLoad { t: Addr; r: 'x' | 'y'; pc: Addr; from?: number | null }
/** Known register content: an immediate value and where it was loaded, or an indexed table read. */
interface Reg { v: number | null; src?: Addr | null; idx?: IndexedLoad | null }
interface IdxStore { dest: Addr; t: Addr; r: 'x' | 'y' }

const evTag = (ctx: Ctx, a: Addr, tag: string) => {
  const dataEv = ctx.ev.dataEv;
  let s = dataEv.get(a); if (!s) dataEv.set(a, s = new Set()); s.add(tag);
};

export function evidence(ctx: Ctx): void {
  ctx.ev = emptyEvidence();
  const { writes, hints, ptrTargets, lohi, wordPtrs, textPtrs, strings, cases, smc } = ctx.ev;
  const { mem, insLen, codeOwner, xrefs, entryKind, inlineCalls, skip, loaded, addX, enqueue, L } = ctx;
  const starts: Addr[] = [];
  for (let a = 0; a < 0x10000; a++) if (insLen[a]) starts.push(a);
  let A: Reg | null = null, X: Reg | null = null, Y: Reg | null = null, recent = new Map<Addr, Reg>(), idxStores: IdxStore[] = [];
  // X and Y as they go into the tight loop at `inAt` (its first index)
  let inAt = -1, inX: Reg | null = null, inY: Reg | null = null;
  const reset = () => { A = X = Y = null; recent = new Map(); idxStores = []; };
  const clearWritten = (from: Addr, to: Addr) => {
    for (let a = from; a <= to; a++) {
      if (!insLen[a]) continue;
      const o = OPC[mem[a]];
      if (o.mn === 'LDA' || o.mn === 'TXA' || o.mn === 'TYA' || CLOBBER_A.has(o.mn) || (SHIFT_MN.has(o.mn) && o.mode === 'acc')) A = null;
      if (['LDX', 'TAX', 'TSX', 'INX', 'DEX', 'LAX', 'AXS', 'LAS'].includes(o.mn)) X = null;
      if (['LDY', 'TAY', 'INY', 'DEY'].includes(o.mn)) Y = null;
      if (o.flow === 'jsr') A = X = Y = null;
    }
  };
  let prevEnd = -1, prevBreak = true;
  const pair = (dest: number, lo: Reg, hi: Reg) => {
    const value = lo.v! | (hi.v! << 8);
    if (dest >= 0 && !VECTORS[dest] && (isIO(dest) || dest >= 0xff00 || dest < 2)) return;
    const sym = SYM.exact.get(value);
    if (loaded(value) || (sym && sym.call)) {
      hints.set(lo.src!, { kind: 'lo', target: value });
      hints.set(hi.src!, { kind: 'hi', target: value });
    }
    if (loaded(dest)) wordPtrs.add(dest);
    const vk = VECTORS[dest];
    if (vk && loaded(value)) {
      let vs = ctx.ev.vectors.get(value); if (!vs) ctx.ev.vectors.set(value, vs = new Set()); vs.add(dest);
      // the KERNAL calls through $0314-$0319 with its ROM banked in, so a handler at $e000-$ffff is its own routine
      if (ctx.deep && dest < 0x0400 && value >= 0xe000) L('info', `${vk.toUpperCase()} vector ${$4(dest)} set to ${$4(value)} at ${$4(lo.src!)}: the KERNAL ROM's own routine, so the RAM below is not traced`, lo.src!, 'deep');
      else { enqueue(value, vk); L('ok', `${vk.toUpperCase()} vector ${$4(dest)} set to ${$4(value)} at ${$4(lo.src!)}`, lo.src!, 'entry'); }
    }
    else if (loaded(value)) ptrTargets.set(value, dest);
  };
  // 5.5b strings handed to print routines
  const printer = printers(ctx, ctx.ev.printers);
  const addString = (s: Addr, str: StringEv) => {
    if (!loaded(s)) return;
    textPtrs.set(s, 'petscii'); ptrTargets.delete(s);
    const old = strings.get(s);
    if (!old || (old.len == null && str.len != null)) strings.set(s, str);
  };
  const lenOf = (count: number | null | undefined, from: number) => (count != null && count > from ? count - from : undefined);
  for (const pc of starts) {
    const xs = xrefs.get(pc);
    const isTarget = entryKind.has(pc) || (xs && xs.some(x => x.kind === 'branch' || x.kind === 'jump' || x.kind === 'call'));
    if (pc !== prevEnd || prevBreak) reset();
    else if (isTarget) {
      const flowIn = xs ? xs.filter(x => x.kind === 'branch' || x.kind === 'jump' || x.kind === 'call') : [];
      const tight = !entryKind.has(pc) || entryKind.get(pc) === 'branch';
      if (tight && flowIn.length && flowIn.every(x => x.kind === 'branch' && x.from > pc && x.from - pc <= 24)) {
        inAt = pc; inX = X as Reg | null; inY = Y as Reg | null;
        clearWritten(pc, Math.max(...flowIn.map(x => x.from)));
      } else reset();
    }
    const info = OPC[mem[pc]], d = decode(mem, pc), mn = info.mn, mode = info.mode;
    if (info.access === 'rmw' && d.target != null) recent.delete(d.target);
    prevEnd = (pc + insLen[pc]) & 0xffff;
    prevBreak = info.flow === 'jmp' || info.flow === 'jmpi' || info.flow === 'ret' || info.flow === 'brk' || inlineCalls.has(pc);
    if (skip.has(pc)) { reset(); continue; }
    // data references (none from a delay's operands, which only take time)
    if (info.access && d.target != null && !ctx.delayIns.has(pc)) {
      const tgt = d.target;
      const kind = (mode === 'izx' || mode === 'izy') ? 'ptr' : info.access;
      addX(tgt, pc, kind);
      if (kind === 'ptr') addX(tgt + 1, pc, 'ptr');
      // `lda $1000,x / sta $2000,x` into a relocated block that runs at $2000, from its bytes at $1000: the copy that
      // puts it there (8.1b), not code that changes itself
      const from = (A as Reg | null)?.idx;
      const copied = (mode === 'abx' || mode === 'aby') && mn === 'STA' && !!from && from.r === (mode === 'abx' ? 'x' : 'y')
        && ctx.relocs.some(r => tgt >= r.to && tgt < r.to + r.end - r.start && from.t === r.start + tgt - r.to);
      if ((info.access === 'write' || info.access === 'rmw') && loaded(tgt) && (insLen[tgt] || codeOwner[tgt] >= 0) && !copied) {
        const s = insLen[tgt] ? tgt : codeOwner[tgt];
        smc.set(s, pc);
        L('info', `Self-modifying code: ${$4(pc)} writes into the instruction at ${$4(s)}`, pc, 'code');
      }
    }
    // TypeScript narrows the `let` registers to null inside this loop body; read them through these accessors
    const a = (): Reg | null => A, x = (): Reg | null => X, y = (): Reg | null => Y;
    /** the index register's value here, or as it goes into the tight loop that starts here */
    const index = (r: 'x' | 'y'): number | null => ((r === 'x' ? x() : y()) ?? (inAt === pc ? (r === 'x' ? inX : inY) : null))?.v ?? null;
    const idxOf = (): IndexedLoad | null => (mode === 'abx' || mode === 'aby') && loaded(d.v!) && !insLen[d.v!] && codeOwner[d.v!] < 0 ? { t: d.v!, r: mode === 'abx' ? 'x' : 'y', pc, from: index(mode === 'abx' ? 'x' : 'y') } : null;
    /** a call or jump to a routine that takes a string: the string is where its parameters say; or to a character
     *  output routine with $0e or $8e in A, which switches the case (5.5c) */
    const handOver = (t: Addr) => {
      const sw = sentCase(a()?.v, t, pc);
      if (sw) cases.push(sw);
      const P = printer(t);
      if (!P) return;
      // the string that follows a JSR (the trace goes on after it)
      if (P.ptr === 'after') { if (mn === 'JSR' && inlineCalls.has(pc)) addString((pc + 2 + P.offset) & 0xffff, { len: lenOf(P.len, P.offset), end: P.end, by: handedText(P, pc) }); return; }
      const val = (p: Place): Reg | null => (p === 'a' ? a() : p === 'x' ? x() : p === 'y' ? y() : recent.get(p) ?? null);
      const lo = val(P.ptr[0]), hi = val(P.ptr[1]);
      if (lo?.v == null || hi?.v == null) return;
      // the registers' loads become #<text / #>text (stores to a pointer got theirs)
      if (typeof P.ptr[0] === 'string' && typeof P.ptr[1] === 'string') { if (lo.src == null || hi.src == null) return; pair(-1, lo, hi); }
      addString(((lo.v | (hi.v << 8)) + P.offset) & 0xffff, { len: lenOf(P.lenAt != null ? val(P.lenAt)?.v : P.len, P.offset), end: P.end, by: handedText(P, pc) });
    };
    switch (mn) {
      case 'LDA': {
        A = mode === 'imm' ? { v: d.v, src: pc } : (idxOf() ? { v: null, idx: idxOf() } : null);
        // `lda (zp),y` printed through CHROUT, with the pointer set in this run: the string is where it points
        const lo = mode === 'izy' ? recent.get(d.v!) : undefined, hi = mode === 'izy' ? recent.get((d.v! + 1) & 0xff) : undefined, from = index('y');
        const loop = lo?.v != null && hi?.v != null && from != null ? printLoop(ctx, pc) : null;
        if (loop) addString(((lo!.v! | (hi!.v! << 8)) + from!) & 0xffff, { len: lenOf(loop.len ?? (loop.lenAt != null ? recent.get(loop.lenAt as Addr)?.v : null), from!), end: loop.end, by: `printed through ${CHAR_OUT.get(mem[loop.out + 1] | (mem[loop.out + 2] << 8))} from ${$4(loop.out)}` });
        break;
      }
      case 'LDX': X = mode === 'imm' ? { v: d.v, src: pc } : null; break;
      case 'LDY': Y = mode === 'imm' ? { v: d.v, src: pc } : null; break;
      case 'TAX': { const r = a(); X = r && r.v != null ? { v: r.v, src: null } : null; break; }
      case 'TAY': { const r = a(); Y = r && r.v != null ? { v: r.v, src: null } : null; break; }
      case 'TXA': { const r = x(); A = r && r.v != null ? { v: r.v, src: null } : null; break; }
      case 'TYA': { const r = y(); A = r && r.v != null ? { v: r.v, src: null } : null; break; }
      case 'INX': case 'DEX': { const r = x(); X = r && r.v != null ? { v: (r.v + (mn === 'INX' ? 1 : 255)) & 255, src: null } : null; break; }
      case 'INY': case 'DEY': { const r = y(); Y = r && r.v != null ? { v: (r.v + (mn === 'INY' ? 1 : 255)) & 255, src: null } : null; break; }
      case 'BEQ': case 'BNE': { const r = a(); if (r && r.idx) evTag(ctx, r.idx.t, 'zt'); break; }
      case 'STA': case 'STX': case 'STY': case 'SAX': {
        const R = mn === 'STA' ? a() : mn === 'STX' ? x() : mn === 'STY' ? y() : null;
        const dest = d.target!;
        if (mode === 'zp' || mode === 'abs') {
          writes.push({ pc, dest, v: R ? R.v : null });
          if (R && R.v != null && R.src != null) {
            recent.set(dest, R);
            const lo = recent.get((dest - 1) & 0xffff), hi = recent.get((dest + 1) & 0xffff);
            if (lo && lo.src !== R.src) pair((dest - 1) & 0xffff, lo, R);
            if (hi && hi.src !== R.src) pair(dest, R, hi);
          } else recent.delete(dest);
          if (R && R.idx) {
            for (const s of idxStores) {
              if (s.r !== R.idx.r || s.t === R.idx.t) continue;
              if (s.dest === dest - 1) lohi.push({ lo: s.t, hi: R.idx.t, dest: dest - 1, r: s.r, pc });
              else if (s.dest === dest + 1) lohi.push({ lo: R.idx.t, hi: s.t, dest, r: s.r, pc });
            }
            idxStores.push({ dest, t: R.idx.t, r: R.idx.r });
            const t = R.idx.t;
            if (dest >= 0xd020 && dest <= 0xd02e) evTag(ctx, t, 'color');
            else if (dest >= 0xd000 && dest <= 0xd00f) evTag(ctx, t, 'spritepos');
            else if (dest === 0xd012) evTag(ctx, t, 'raster');
            else if (dest >= 0xd400 && dest <= 0xd418) evTag(ctx, t, 'sid');
            else if (dest === 0xd016 || dest === 0xd011) evTag(ctx, t, 'scroll');
          }
        } else if (R && R.idx && (mode === 'abx' || mode === 'aby')) {
          if (dest >= 0x0400 && dest < 0x0800 && !loaded(dest)) evTag(ctx, R.idx.t, 'screen');
          else if (dest >= 0xd800 && dest < 0xdc00) evTag(ctx, R.idx.t, 'colorram');
        } else if (R && R.v != null && (mode === 'abx' || mode === 'aby')) {
          writes.push({ pc, dest, v: R.v, indexed: true });
        }
        break;
      }
      case 'JSR': {
        const t = d.target!, ra = a();
        if (CHAR_OUT.has(t) && ra && ra.idx) {
          const { t: tab, pc: at, from } = ra.idx;
          evTag(ctx, tab, 'petscii');
          // a loop that prints the table: its count or end byte says how long the string is
          const loop = printLoop(ctx, at);
          const len = from != null ? lenOf(loop?.len ?? (loop?.lenAt != null ? recent.get(loop.lenAt as Addr)?.v : null), from) : undefined;
          if (loop && (len != null || loop.end)) addString((tab + (from ?? 0)) & 0xffff, { len, end: loop.end, by: `printed through ${CHAR_OUT.get(t)} from ${$4(pc)}` });
        }
        handOver(t);
        A = X = Y = null; break;
      }
      case 'JMP': if (mode === 'abs') handOver(d.target!); break;
      default:
        if (CLOBBER_A.has(mn) || (SHIFT_MN.has(mn) && mode === 'acc')) A = null;
        if (mn === 'TSX' || mn === 'AXS' || mn === 'LAS' || mn === 'LAX') X = null;
        if (mn === 'LAX') A = null;
    }
  }
}
