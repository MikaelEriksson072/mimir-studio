/* 8.1b: loops that copy code to another address before it runs there, found so the user can relocate it in one go.
 * A copy is `lda src,x / sta dst,x` (or `,y`) in a loop that steps the index register, with what the register starts at
 * and where the loop ends known, and the code jumps or calls into where the bytes go, where nothing is loaded, or where
 * the bytes loaded there start no routine where the jump goes in (`over`: a program saved after it ran keeps the
 * screen it showed where its loader is copied to). Several
 * pairs in one loop (a page each) make one block when they follow one another. What it copies must be code where the
 * jump goes in (in real intros a text copied to the screen at $0400 is the usual look-alike: `jsr $2020` is three
 * spaces), and of copies to the same place the one the jump follows wins. Each copy is a hint with the relocation that
 * reads the bytes where they run. */
import type { Ctx } from './context';
import type { Addr, Reloc, RelocCopy } from '../types';
import { OPC } from '../cpu/opcodes';
import { decode } from '../cpu/decode';
import { $4 } from '../util/hex';

/** the branches a copy loop goes back with: while the index is not 0 / not negative / below the compare */
const BACK = new Set(['BNE', 'BPL', 'BCC']);

/**
 * The offsets from the bases that the loop from `top` back to the branch at `br` goes through: [first, last], or null
 * when they cannot be told. `r`: the index register; it starts at the `ldx #`/`ldy #` just before `top`.
 */
function offsets(ctx: Ctx, top: Addr, br: Addr, r: 'x' | 'y'): [number, number] | null {
  const { mem, insLen } = ctx;
  const ld = top - 2, init = OPC[mem[ld]];
  if (insLen[ld] !== 2 || init.mode !== 'imm' || init.mn !== (r === 'x' ? 'LDX' : 'LDY')) return null;
  const v = mem[ld + 1], b = OPC[mem[br]].mn;
  let step = 0, cmp: number | null = null;
  for (let p = top; p < br; p += insLen[p] || 1) {
    const o = OPC[mem[p]];
    if (!insLen[p]) return null;
    if (o.mn === (r === 'x' ? 'INX' : 'INY')) step++;
    else if (o.mn === (r === 'x' ? 'DEX' : 'DEY')) step--;
    else if (o.mn === (r === 'x' ? 'LDX' : 'LDY') || o.mn === (r === 'x' ? 'TAX' : 'TAY') || o.flow === 'jsr') return null;
    if (o.mn === (r === 'x' ? 'CPX' : 'CPY') && o.mode === 'imm' && p + 2 === br) cmp = mem[p + 1];
  }
  // from $81 up the first DEX already leaves a negative index
  if (step === -1 && cmp == null && b === 'BPL') return v <= 0x80 ? [0, v] : null;
  if (step === -1 && cmp == null && b === 'BNE') return v === 0 ? [0, 255] : [1, v];
  if (step === 1 && cmp == null && b === 'BNE') return [v, 255];
  if (step === 1 && cmp != null && (b === 'BNE' || b === 'BCC')) return cmp === 0 && b === 'BNE' ? [v, 255] : cmp > v ? [v, cmp - 1] : null;
  if (step === -1 && cmp != null && b === 'BNE') return v > cmp ? [cmp + 1, v] : null;
  return null;
}

/** the bytes at `a` (up to `end`) start a routine: 5 documented instructions with no BRK or JAM, not the same one
 *  three times in a row */
function routineAt(mem: Uint8Array, a: Addr, end: Addr): boolean {
  let last = '', same = 0;
  for (let k = 0; k < 5; k++) {
    const o = OPC[mem[a]];
    if (a + o.len > end || o.ill || o.jam || o.flow === 'brk') return false;
    const ins = [...mem.subarray(a, a + o.len)].join();
    same = ins === last ? same + 1 : 0; last = ins;
    if (same >= 2) return false;
    if (o.flow === 'ret' || o.flow === 'jmp' || o.flow === 'jmpi') return k >= 1;
    a += o.len;
  }
  return true;
}

/** the bytes at `a` (up to `end`) are no code: a BRK, JAM or undocumented opcode, or one instruction three times in a
 *  row, before a jump or a return in the first five instructions (a screen's spaces are jsr $2020 again and again) */
function noCodeAt(mem: Uint8Array, a: Addr, end: Addr): boolean {
  let last = '', same = 0;
  for (let k = 0; k < 5; k++) {
    const o = OPC[mem[a]];
    if (a + o.len > end) return false;
    if (o.ill || o.jam || o.unstable || o.flow === 'brk') return true;
    const ins = [...mem.subarray(a, a + o.len)].join();
    same = ins === last ? same + 1 : 0; last = ins;
    if (same >= 2) return true;
    if (o.flow === 'ret' || o.flow === 'jmp' || o.flow === 'jmpi') return false;
    a += o.len;
  }
  return false;
}

/**
 * The instructions of the code a loop copies from `start`..`end` (end excluded) to run at `to`, where it is loaded,
 * decoded from `entry` (where it runs) along every way on: branches, and calls and jumps into where it runs; at most
 * `max`, none where `skip` says (the trace read them there already). In address order.
 */
export function copiedCode(mem: Uint8Array, c: Reloc, entry: Addr, max = 1024, skip?: (a: Addr) => boolean): Addr[] {
  const out: Addr[] = [], seen = new Set<Addr>(), n = c.end - c.start;
  const here = (t: Addr) => (t >= c.to && t < c.to + n ? c.start + t - c.to : null);
  const first = here(entry);
  const stack = first != null ? [first] : [];
  while (stack.length && out.length < max) {
    const pc = stack.pop()!;
    if (seen.has(pc) || pc < c.start || skip?.(pc)) continue;
    const o = OPC[mem[pc]];
    if (pc + o.len > c.end || o.jam || o.flow === 'brk' || o.ill) continue;
    seen.add(pc); out.push(pc);
    // (a branch goes the same way where the code is loaded; an absolute jump goes where it runs)
    const t = o.len === 3 || o.flow === 'br' ? decode(mem, pc).target : null;
    if (o.flow === 'seq' || o.flow === 'br' || o.flow === 'jsr') stack.push(pc + o.len);
    if (o.flow === 'br' && t != null) stack.push(t);
    if ((o.flow === 'jmp' || o.flow === 'jsr') && t != null) { const h = here(t); if (h != null) stack.push(h); }
  }
  return out.sort((x, y) => x - y);
}

/** `start`..`end` is text (16 bytes or more, nearly all spaces, letters as screen codes or PETSCII, and digits): code
 *  has many $20 bytes too (JSR, and addresses $20xx), but not so many letters around them */
function textLike(mem: Uint8Array, start: Addr, end: Addr): boolean {
  let n = 0;
  for (let a = start; a < end; a++) { const b = mem[a]; if (b === 0x20 || (b >= 0x01 && b <= 0x1a) || (b >= 0x30 && b <= 0x39) || (b >= 0x41 && b <= 0x5a) || b === 0x2e || b === 0x21) n++; }
  return end - start >= 16 && n >= (end - start) * 0.85;
}

export function findCopies(ctx: Ctx): RelocCopy[] {
  const { mem, insLen, owner, xrefs, loaded, L } = ctx;
  const found: (RelocCopy & { br: Addr })[] = [];
  const seen = new Set<Addr>();
  for (let br = 0; br < 0x10000; br++) {
    const o = OPC[mem[br]];
    if (!insLen[br] || o.flow !== 'br' || !BACK.has(o.mn)) continue;
    const top = decode(mem, br).target!;
    if (top >= br || br - top > 48 || !insLen[top]) continue;
    // the pairs of the loop: an indexed load, then a store with the same index
    const pairs: { src: Addr; dst: Addr; r: 'x' | 'y'; at: Addr }[] = [];
    for (let p = top; p < br && insLen[p]; p += insLen[p]) {
      const ld = OPC[mem[p]], q = p + insLen[p], st = OPC[mem[q]];
      if (ld.mn !== 'LDA' || (ld.mode !== 'abx' && ld.mode !== 'aby') || !insLen[q] || st.mn !== 'STA' || st.mode !== ld.mode) continue;
      pairs.push({ src: decode(mem, p).v!, dst: decode(mem, q).v!, r: ld.mode === 'abx' ? 'x' : 'y', at: q });
    }
    if (!pairs.length || pairs.some(x => x.r !== pairs[0].r)) continue;
    const off = offsets(ctx, top, br, pairs[0].r);
    if (!off) continue;
    // pairs a page apart (or as far apart as the loop copies) make one block
    const n = off[1] - off[0] + 1;
    pairs.sort((x, y) => x.src - y.src);
    const runs: { src: Addr; dst: Addr; at: Addr; len: number }[] = [];
    for (const x of pairs) {
      const last = runs[runs.length - 1];
      if (last && x.src + off[0] === last.src + last.len && x.dst + off[0] === last.dst + last.len) last.len += n;
      else runs.push({ src: x.src + off[0], dst: x.dst + off[0], at: x.at, len: n });
    }
    for (const c of runs) {
      const start = c.src, end = start + c.len, to = c.dst;
      if (seen.has(start) || end > 0x10000 || to + c.len > 0x10000 || (to < end && start < to + c.len)) continue;
      // the bytes are one piece of one file (or of a relocated block's copy)
      let ok = loaded(start);
      for (let a = start; ok && a < end; a++) if (owner[a] !== owner[start]) ok = false;
      if (!ok || textLike(mem, start, end)) continue;
      // where they go is loaded too: a program saved after it ran has what was there then (The Last Ninja +Triad,
      // unpacked: its trainer copies the loader from $ca00 to $0400 where the intro's screen was)
      let over = false;
      for (let a = to; !over && a < to + c.len; a++) if (loaded(a)) over = true;
      // over loaded bytes, where the jump goes in they are no code (a screen's spaces are jsr $2020 again and again),
      // and the copy's code refers to where it runs (jsr, jmp, lda … there) more than to where it is loaded, or they
      // are a fill (16 bytes the same) and it refers to nothing where it is loaded: the program's own code that runs
      // there first (Vicious Sid 2's jmp $9000 at $0400), a charset copied to where code is (Micro Sleep's) and code
      // that runs where it is loaded (Uncensored's jsr $09d7 at $0953) are not that
      const fill = (a: Addr) => { let z = 0; while (z < 16 && a + z < to + c.len && mem[a + z] === mem[a]) z++; return z >= 16; };
      const overOk = (a: Addr) => {
        if (!noCodeAt(mem, a, to + c.len)) return false;
        let run = 0, here = 0;
        for (const p of copiedCode(mem, { start, end, to }, a, 256)) {
          if (OPC[mem[p]].len !== 3) continue;
          const v = mem[p + 1] | (mem[p + 2] << 8);
          if (v >= to && v < to + c.len) run++; else if (v >= start && v < end) here++;
        }
        return run > here || (!here && fill(a));
      };
      // and the code goes there: what it copies is code that runs where it goes (the jump nearest after the loop)
      let jump: Addr | null = null;
      for (let a = to; a < to + c.len; a++) for (const x of xrefs.get(a) ?? []) {
        if ((x.kind !== 'jump' && x.kind !== 'call') || !insLen[x.from] || !routineAt(mem, start + a - to, end)) continue;
        if (over && (x.from >= to && x.from < to + c.len || !overOk(a))) continue;
        if (jump == null || (x.from > br ? x.from - br : 0x10000 + x.from) < (jump > br ? jump - br : 0x10000 + jump)) jump = x.from;
      }
      if (jump == null) continue;
      // over loaded bytes, they are no code the program runs there itself: no start, interrupt handler or routine of
      // the user's in them, and nothing else jumps, calls or branches into them from outside (Eldorado copies to $0800
      // over its own start at $0812, which runs first): the bytes there become junk when it is relocated
      if (over) {
        const own = (a: Addr) => a >= to && a < to + c.len;
        let theirs = false;
        for (let a = to; !theirs && a < to + c.len; a++) {
          const k = ctx.entryKind.get(a);
          if (k === 'entry' || k === 'irq' || k === 'nmi' || k === 'brk' || k === 'user') theirs = true;
          for (const x of xrefs.get(a) ?? []) {
            if ((x.kind !== 'jump' && x.kind !== 'call' && x.kind !== 'branch') || own(x.from) || !insLen[x.from]) continue;
            if (x.kind === 'branch' || !routineAt(mem, start + a - to, end) || !overOk(a)) theirs = true;
          }
        }
        if (theirs) continue;
      }
      // code the program runs where it is loaded stays out (a loop that copies a few bytes more than its routine, into
      // a subroutine the program calls there): what code elsewhere jumps, calls or branches into, and the code traced
      // on from there. A routine the analysis only guessed (a code island) is no such code
      const t = start + decode(mem, jump).target! - to;
      let lo = start, hi = end;
      for (let a = start; a < end; a++) {
        if (!(xrefs.get(a) ?? []).some(x => x.kind !== 'read' && x.kind !== 'write' && x.kind !== 'rmw' && x.kind !== 'ptr' && insLen[x.from] && (x.from < start || x.from >= end))) continue;
        if (a > t) { hi = Math.min(hi, a); continue; }
        let e = a;
        while (e < end && (insLen[e] || ctx.codeOwner[e] >= 0)) e += insLen[e] || 1;
        lo = Math.max(lo, e);
      }
      if (lo > t) continue;
      seen.add(start);
      found.push({ loop: top, at: c.at, start: lo, end: hi, to: to + lo - start, jump, br, ...(over ? { over: true } : {}) });
    }
  }
  // of copies to the same place, the one whose loop the jump follows (a text copied to the screen goes there too)
  const near = (c: { jump: Addr; br: Addr }) => (c.jump > c.br ? c.jump - c.br : 0x10000);
  const out = found.filter(c => !found.some(o => o !== c && o.to < c.to + c.end - c.start && c.to < o.to + o.end - o.start && near(o) < near(c)))
    .map(({ br: _, ...c }) => c);
  for (const c of out) {
    const what = `${$4(c.start)}-${$4(c.end - 1)}`, goes = `The loop at ${$4(c.loop)} copies ${what} to ${$4(c.to)}-${$4(c.to + c.end - c.start - 1)}, and the ${OPC[mem[c.jump]].mn.toLowerCase()} at ${$4(c.jump)} goes there`;
    // relocated to run somewhere else
    const other = ctx.relocs.find(r => r.start === c.start);
    const there = `${$4(c.to)}-${$4(c.to + c.end - c.start - 1)}`;
    L('hint', other ? `${goes}, but it is relocated to run at ${$4(other.to)}. Let it run at ${$4(c.to)} (the Relocated tab, or right-click it → Change where it runs…).`
      : c.over ? `${goes}: that code runs at ${$4(c.to)}, over bytes the file has there (${there}), which start no routine where the ${OPC[mem[c.jump]].mn.toLowerCase()} goes in: what was there when the program was saved, its screen, say. Relocate ${what} to run there (the Relocated tab, or right-click → Relocate…): those bytes become junk, and the code is traced and named where it runs.`
        : `${goes}: that code runs at ${$4(c.to)}. Relocate ${what} to run there (the Relocated tab, or right-click → Relocate…), and it is traced and named where it runs.`, c.at, 'reloc', 'copy-loop');
  }
  return out;
}
