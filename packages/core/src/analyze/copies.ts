/* 8.1b: loops that copy code to another address before it runs there, found so the user can relocate it in one go.
 * A copy is `lda src,x / sta dst,x` (or `,y`) in a loop that steps the index register, with what the register starts at
 * and where the loop ends known, and the code jumps or calls into where the bytes go, where nothing is loaded. Several
 * pairs in one loop (a page each) make one block when they follow one another. What it copies must be code where the
 * jump goes in (in real intros a text copied to the screen at $0400 is the usual look-alike: `jsr $2020` is three
 * spaces), and of copies to the same place the one the jump follows wins. Each copy is a hint with the relocation that
 * reads the bytes where they run. */
import type { Ctx } from './context';
import type { Addr, RelocCopy } from '../types';
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
      // the bytes are one piece of one file (or of a relocated block's copy), and nothing is loaded where they go
      let ok = loaded(start);
      for (let a = start; ok && a < end; a++) if (owner[a] !== owner[start]) ok = false;
      for (let a = to; ok && a < to + c.len; a++) if (loaded(a)) ok = false;
      if (!ok || textLike(mem, start, end)) continue;
      // and the code goes there: what it copies is code that runs where it goes (the jump nearest after the loop)
      let jump: Addr | null = null;
      for (let a = to; a < to + c.len; a++) for (const x of xrefs.get(a) ?? []) {
        if ((x.kind !== 'jump' && x.kind !== 'call') || !insLen[x.from] || !routineAt(mem, start + a - to, end)) continue;
        if (jump == null || (x.from > br ? x.from - br : 0x10000 + x.from) < (jump > br ? jump - br : 0x10000 + jump)) jump = x.from;
      }
      if (jump == null) continue;
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
      found.push({ loop: top, at: c.at, start: lo, end: hi, to: to + lo - start, jump, br });
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
    L('hint', other ? `${goes}, but it is relocated to run at ${$4(other.to)}. Let it run at ${$4(c.to)} (the Relocated tab, or right-click it → Change where it runs…).`
      : `${goes}: that code runs at ${$4(c.to)}. Relocate ${what} to run there (the Relocated tab, or right-click → Relocate…), and it is traced and named where it runs.`, c.at, 'reloc');
  }
  return out;
}
