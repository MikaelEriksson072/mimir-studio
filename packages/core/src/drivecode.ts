/* The drive code (spec 8.11i): the code a fast loader keeps in the C64's memory to upload to the 1541 (or a 1581) and
 * run there, re-assembled where it runs.
 *
 * The loaders (analyze/loaders.ts) find the drive code and the drive commands; the listing shows that code as data, as
 * the C64 never runs it. Here each part is written where it is in the C64's memory, inside `.pseudopc` at the address
 * where it runs in the drive, so the source assembles to the program's bytes again, with the drive's code as code.
 *
 * Where a part runs, in this order:
 * - the bytes after an M-W command ("M-W" lo hi n, then the n bytes: the installer sends the command and its bytes as
 *   they are) go to lo hi;
 * - a known loader's part says it (Bitfire's "code for the 1541 at $0150");
 * - otherwise its own jumps tell: the run address at which most of its JMPs and JSRs land on instructions in it, and
 *   the code traced from them meets no byte that is no instruction (an M-W or M-E address, a page start, wins a tie).
 * The code is traced from where the drive starts it (M-E, the start of an upload, a page start, as the DOS runs a job's
 * code from the start of its buffer), on trial for the weaker of them, and every jump and branch it makes in the
 * drive's memory. What it does not reach stays data.
 */
import type { Addr, AnalysisResult, Line, Token } from './types';
import { OPC, MODE_LEN } from './cpu/opcodes';
import { kickMnemonic, lineText, type LineTextSettings } from './render/lines';
import { assemble } from './verify/kick-subset-assembler';
import { $4, h4 } from './util/hex';

/** a run of the drive code's bytes in the C64's memory and where they run in the drive */
export interface DriveSegment {
  /** its bytes in the C64's memory */
  start: Addr; end: Addr;
  /** where they run in the drive; null when that is not known (they are written where they are) */
  run: Addr | null;
  /** how the run address was found: the bytes after an M-W, the known loader's own address, its jumps (a guess) */
  found: 'M-W' | 'loader' | 'jumps' | null;
  how: string;
  /** the loader whose drive code it is */
  loader: string;
  /** the drive it is for: a 1581's serial port is the CIA at $4000, a 1541's the VIA at $1800 */
  drive: '1541' | '1581';
  /** bytes traced as code */
  code: number;
}

export interface DriveCheck {
  /** the source assembled to the program's bytes */
  ok: boolean;
  /** bytes it gave */
  bytes: number;
  /** addresses where it gave another byte (the first few) */
  diffs: Addr[];
  errors: string[];
}

export interface DriveCode {
  /** the file name the source is saved as */
  file: string;
  segments: DriveSegment[];
  lines: Line[];
  text: string;
  /** per line of `text`: the C64 address of its bytes and the drive address where they run */
  at: ({ c64: Addr; drive: Addr | null } | null)[];
  /** per segment: the line of `text` (0-based) where it starts, its `.pseudopc` */
  partLines: number[];
  /** the C64 bytes the source covers, and the source assembled */
  bytes: number;
  check: DriveCheck;
}

type Cmd = { at: Addr; end: Addr; kind: 'M-W' | 'M-E' | 'M-R'; addr: Addr; n: number; forward: boolean };

const KIND: Record<number, Cmd['kind']> = { 0x57: 'M-W', 0x45: 'M-E', 0x52: 'M-R' };

/** the 1541's VIAs: VIA 1 on the serial bus, VIA 2 on the disk controller */
const VIA_REGS: [string, string][] = [
  ['PB', 'port B'], ['PA', 'port A'], ['DDRB', 'port B direction'], ['DDRA', 'port A direction'],
  ['T1CL', 'timer 1 low (read: the count, write: the latch)'], ['T1CH', 'timer 1 high (write: start it)'],
  ['T1LL', 'timer 1 latch low'], ['T1LH', 'timer 1 latch high'], ['T2CL', 'timer 2 low'], ['T2CH', 'timer 2 high'],
  ['SR', 'shift register'], ['ACR', 'auxiliary control'], ['PCR', 'peripheral control'], ['IFR', 'interrupt flags'],
  ['IER', 'interrupt enable'], ['PA2', 'port A, no handshake'],
];
/** the registers' description (on the .label line), and a short one for the lines that use them */
const VIA_WHAT: Record<string, [string, string]> = {
  VIA1_PB: ['serial bus: bit 0 DATA in, 1 DATA out, 2 CLK in, 3 CLK out, 4 ATN acknowledge, 5-6 device number, 7 ATN in', 'serial bus'],
  VIA1_PA: ['parallel port (a parallel cable)', 'parallel port'],
  VIA2_PB: ['head: bits 0-1 stepper, 2 motor, 3 LED, 4 write protect, 5-6 density, 7 SYNC (0 over one)', 'head: stepper, motor, LED, density, SYNC'],
  VIA2_PA: ['the GCR byte under the head', 'GCR byte'],
  VIA2_PCR: ['head: CA2 the byte-ready overflow, CB2 read (high) or write', 'byte ready, read or write'],
  VIA2_DDRA: ['GCR port direction ($ff: write)', 'GCR port direction'],
};
const VIA_SYM = new Map<Addr, { name: string; desc: string; short: string }>();
for (const [base, n] of [[0x1800, 1], [0x1c00, 2]] as const)
  VIA_REGS.forEach(([r, d], i) => { const name = `VIA${n}_${r}`, [desc, short] = VIA_WHAT[name] ?? [`VIA ${n} ${d}`, '']; VIA_SYM.set(base + i, { name, desc, short }); });
/** a 1541 VIA register by the name the drive code source gives it (VIA1_PB …), for the editor's hover */
export function driveSymbol(name: string): { addr: Addr; desc: string } | null {
  for (const [addr, v] of VIA_SYM) if (v.name === name) return { addr, desc: v.desc };
  return null;
}
/** 1541 DOS ROM routines fast loaders call (the drive code around the calls shows what they do) */
const ROM_1541: Record<number, string> = {
  0xf50a: 'waits for the data block after its header',
  0xf556: 'waits for a SYNC',
  0xf5e9: "the data block's checksum",
  0xf8e0: 'decodes the GCR data block',
  0xf969: 'ends the job, its error code in A',
  0xeaa0: 'reset',
};

/** an instruction the drive code can start with or run into: documented (no BRK) or an undocumented one Kick
 *  Assembler writes */
const runnable = (b: number) => { const o = OPC[b]; return b !== 0x00 && !o.jam && !o.unstable && (!o.ill || o.kick); };
/** A branch right after `lda #`/`ldx #`/`ldy #` (Z and N known) or `clc`/`sec` (C known): 'taken' or 'not' when it
 *  always goes one way, as `lda #$7f / bne` does. `bvc`/`bvs` are never known: the byte-ready line sets V in a 1541. */
const branchWay = (prev: number | null, prevV: number, br: number): 'taken' | 'not' | null => {
  if (prev == null) return null;
  const p = OPC[prev];
  const z = p.mode === 'imm' && (p.mn === 'LDA' || p.mn === 'LDX' || p.mn === 'LDY') ? prevV === 0 : null;
  const n = z == null ? null : prevV >= 0x80;
  const c = p.mn === 'CLC' ? false : p.mn === 'SEC' ? true : null;
  const way = (cond: boolean | null, when: boolean) => (cond == null ? null : cond === when ? 'taken' : 'not');
  switch (OPC[br].mn) {
    case 'BEQ': return way(z, true); case 'BNE': return way(z, false);
    case 'BMI': return way(n, true); case 'BPL': return way(n, false);
    case 'BCS': return way(c, true); case 'BCC': return way(c, false);
    default: return null;
  }
};
/** an instruction that writes an absolute address (sta abs, sta abs,x, inc abs …) */
const storesAbs = (b: number) => { const o = OPC[b]; return MODE_LEN[o.mode] === 3 && (o.access === 'write' || o.access === 'rmw') && !o.ill; };

/** The drive code of the analysed program, re-assembled; null when the loaders found none. */
export function driveCode(A: AnalysisResult, S: LineTextSettings & { hexCase?: 'lower' | 'upper' }, name: string): DriveCode | null {
  const mem = A.mem, owner = A.owner;
  const up = S.hexCase === 'upper';
  const hx = (v: number, w: number) => { const s = v.toString(16).padStart(w, '0'); return up ? s.toUpperCase() : s; };
  const n2 = (v: number) => '$' + hx(v & 0xff, 2), n4 = (v: number) => '$' + hx(v & 0xffff, 4);
  const $ = (v: number) => '$' + h4(v);

  // ---- the parts and the commands ----
  const parts: { s: Addr; e: Addr; loader: string; what: string }[] = [];
  const cmds: Cmd[] = [];
  for (const l of A.loaders) for (const p of l.parts) {
    // (a cartridge bank's parts, at bank addresses, are not written here)
    if (p.outside || p.end > 0x10000) continue;
    if (p.role === 'drivecode') parts.push({ s: p.start, e: p.end, loader: l.name, what: p.what });
    if (p.role !== 'command') continue;
    for (let a = p.start; a + 2 < p.end + 3 && a + 2 <= 0xffff; a++) {
      if (mem[a] === 0x4d && mem[a + 1] === 0x2d && KIND[mem[a + 2]] && a + 4 <= 0xffff) {
        const kind = KIND[mem[a + 2]], len = kind === 'M-E' ? 5 : 6;
        if (!cmds.some(c => c.at === a)) cmds.push({ at: a, end: Math.min(0x10000, a + len), kind, addr: mem[a + 3] | (mem[a + 4] << 8), n: kind === 'M-E' ? 0 : mem[a + 5], forward: true });
      } else if (KIND[mem[a]] && mem[a + 1] === 0x2d && mem[a + 2] === 0x4d && a >= 3) {
        const kind = KIND[mem[a]], at = a - (kind === 'M-E' ? 2 : 3);
        if (!cmds.some(c => c.at === at)) cmds.push({ at, end: a + 3, kind, addr: mem[a - 1] | (mem[a - 2] << 8), n: kind === 'M-E' ? 0 : mem[a - 3], forward: false });
      }
    }
  }
  if (!parts.length) return null;
  parts.sort((x, y) => x.s - y.s);
  cmds.sort((x, y) => x.at - y.at);
  const inPart = (s: Addr, e: Addr) => parts.find(p => p.s < e && p.e > s);
  const isCmdAt = (a: Addr) => mem[a] === 0x4d && mem[a + 1] === 0x2d && !!KIND[mem[a + 2]];

  // ---- the runs of bytes: the bytes after an M-W, and the rest of each part ----
  interface Seg extends DriveSegment { hint: Addr | null; gap?: boolean }
  const segs: Seg[] = [];
  const taken = new Uint8Array(0x10000);
  const loaderOf = (s: Addr, e: Addr) => inPart(s, e)?.loader ?? parts[0].loader;
  for (const c of cmds) {
    if (c.kind !== 'M-W' || !c.forward || c.n <= 4) continue;
    const s = c.end, e = s + c.n;
    if (e > 0x10000 || owner[s] < 0 || owner[e - 1] !== owner[c.at]) continue;
    let mixed = false;
    for (let a = s; a < e && !mixed; a++) if (owner[a] !== owner[c.at] || isCmdAt(a)) mixed = true;
    // the bytes are the command's when they are drive code, or another command follows them (a chain of uploads)
    if (mixed || !(inPart(s, e) || cmds.some(x => x.at === e))) continue;
    segs.push({ start: s, end: e, run: c.addr, found: 'M-W', how: `the ${c.n} bytes after M-W ${$(c.addr)}`, loader: loaderOf(c.at, e), drive: '1541', code: 0, hint: null });
    taken.fill(1, s, e);
  }
  // a short M-W sets a value (the device number at $0077): its bytes go with it
  for (const c of cmds) {
    if (c.kind !== 'M-W' || !c.forward || c.n < 1 || c.n > 4 || c.end + c.n > 0x10000) continue;
    const e = c.end + c.n;
    let ok = !!inPart(c.end, e);
    for (let a = c.end; a < e && ok; a++) if (owner[a] !== owner[c.at] || isCmdAt(a) || taken[a]) ok = false;
    if (ok) c.end = e;
  }
  for (const c of cmds) taken.fill(2, c.at, c.end);
  for (const p of parts) {
    for (let a = p.s; a < p.e;) {
      if (taken[a]) { a++; continue; }
      let e = a; while (e < p.e && !taken[e]) e++;
      const at = /at \$([0-9a-f]{4})/i.exec(p.what);
      segs.push({ start: a, end: e, run: null, found: null, how: '', loader: p.loader, drive: '1541', code: 0, hint: at && a === p.s ? parseInt(at[1], 16) : null });
      taken.fill(3, a, e);
      a = e;
    }
  }
  segs.sort((x, y) => x.start - y.start);

  for (const g of segs) {
    // a 1581's serial port is CIA 8520 at $4000
    let cia = 0, via = 0;
    for (let a = g.start; a + 2 < g.end; a++) {
      const o = OPC[mem[a]];
      if (MODE_LEN[o.mode] !== 3 || o.flow === 'jmp' || o.flow === 'jsr') continue;
      const t = mem[a + 1] | (mem[a + 2] << 8);
      if (t >= 0x4000 && t <= 0x400f) cia++;
      if ((t >= 0x1800 && t <= 0x180f) || (t >= 0x1c00 && t <= 0x1c0f)) via++;
    }
    if (cia >= 2 && cia > via) g.drive = '1581';
  }

  // ---- where the rest runs ----
  for (const g of segs) {
    if (g.run != null) continue;
    const L = g.end - g.start;
    // a few bytes between the drive commands (the padding after an M-W's bytes)
    if (L < 8) { g.gap = true; g.how = `${L} byte${L === 1 ? '' : 's'} between the drive commands`; continue; }
    const cands = new Set<number>([...cmds.filter(c => c.kind !== 'M-R').map(c => c.addr), ...(g.hint != null ? [g.hint] : [])]);
    // the drive's RAM: a 1541 has 2 KB, a 1581 8 KB
    const best = runAddress(mem, g.start, g.end, cands, g.hint, g.drive === '1581' ? 0x2000 : 0x800);
    if (best) { g.run = best.run; g.how = best.how; g.found = best.run === g.hint ? 'loader' : 'jumps'; }
    else if (g.hint != null) { g.run = g.hint; g.how = `the loader's part runs at ${$(g.hint)}`; g.found = 'loader'; }
    else g.how = 'where it runs in the drive is not known: written where it is';
  }

  // ---- the drive's memory: segments that do not overlap there share one image (the surest first: the bytes of an
  // M-W and a known loader's parts, then those placed by their jumps) ----
  const images: Seg[][] = [];
  const rank = (g: Seg) => (g.found === 'M-W' ? 0 : g.found === 'loader' ? 1 : 2);
  for (const g of [...segs].sort((x, y) => rank(x) - rank(y) || x.start - y.start)) {
    if (g.run == null) { images.push([g]); continue; }
    const len = g.end - g.start;
    const img = images.find(im => im.every(x => x.run != null && (x.run + (x.end - x.start) <= g.run! || g.run! + len <= x.run)));
    if (img) img.push(g); else images.push([g]);
  }
  const imageOf = new Map<Seg, number>();
  images.forEach((im, i) => im.forEach(g => imageOf.set(g, i)));
  /** per image: drive address -> C64 address of the byte there */
  const where = images.map(im => {
    const m = new Int32Array(0x10000).fill(-1);
    for (const g of im) { const base = g.run ?? g.start; for (let a = g.start; a < g.end; a++) m[(base + a - g.start) & 0xffff] = a; }
    return m;
  });
  const segAt = (img: number, d: Addr) => { const c = where[img][d & 0xffff]; return c < 0 ? null : images[img].find(g => c >= g.start && c < g.end) ?? null; };

  // ---- trace the code ----
  const ins = images.map(() => new Uint8Array(0x10000)); // instruction length at its first byte (drive address)
  const inside = images.map(() => new Uint8Array(0x10000)); // 1: an operand byte
  const refs = images.map(() => new Map<Addr, Set<'sub' | 'jmp' | 'back' | 'fwd' | 'entry' | 'read' | 'write' | 'index'>>());
  const ref = (i: number, a: Addr, k: 'sub' | 'jmp' | 'back' | 'fwd' | 'entry' | 'read' | 'write' | 'index') => { const m = refs[i]; if (!m.has(a)) m.set(a, new Set()); m.get(a)!.add(k); };
  const byteAt = (i: number, d: Addr) => { const c = where[i][d & 0xffff]; return c < 0 ? -1 : mem[c]; };
  /** an image whose run address is not known: its bytes are where they are in the C64, so only its branches tell */
  const unknown = (i: number) => images[i][0].run == null;
  /** per image: the addresses its bytes store to (sta abs and the like, wherever they are): code there is written
   *  while it runs (an RTS put over a placeholder), so a path that meets no instruction there just ends */
  const stored = images.map((im, i) => { const set = new Set<Addr>(); if (!unknown(i)) for (const g of im) for (let a = g.start; a + 2 < g.end; a++) if (storesAbs(mem[a])) set.add(mem[a + 1] | (mem[a + 2] << 8)); return set; });
  /** per image: a BIT that skips the instruction hidden in its operand (`lda #8 / .byte $2c / lda #4`) */
  const skip = images.map(() => new Uint8Array(0x10000));
  const isBit = (b: number) => b === 0x2c || b === 0x24;
  /** trace from `entry`; weak: on trial, nothing is kept when it runs into a byte that is no instruction */
  const trace = (i: number, entry: Addr, weak: boolean): boolean => {
    const local = new Map<Addr, number>(), operand = new Set<Addr>(), more: Addr[] = [];
    const stack: [Addr, number | null, number][] = [[entry, null, 0]];
    /** BITs that turn out to skip: those of this trace, and traced ones (their operand bytes are free then) */
    const skips = new Set<Addr>(), unbit = new Set<Addr>(), freed = new Set<Addr>();
    const busy = (q: Addr) => (!!inside[i][q] && !freed.has(q)) || operand.has(q);
    const start = (q: Addr) => !!(ins[i][q] && !unbit.has(q)) || local.has(q);
    while (stack.length) {
      const [pc, prev, prevV] = stack.pop()!;
      if (start(pc) || skips.has(pc) || skip[i][pc]) continue;
      if (busy(pc)) {
        // into the operand of a BIT: the BIT skips the instruction there
        const a = (pc - 1) & 0xffff, n = local.get(a) ?? (unbit.has(a) ? 0 : ins[i][a]);
        if (n && isBit(byteAt(i, a))) {
          if (local.has(a)) { local.delete(a); skips.add(a); } else { unbit.add(a); skips.add(a); }
          for (let k = 1; k < n; k++) { operand.delete((a + k) & 0xffff); freed.add((a + k) & 0xffff); }
        } else { if (weak) return false; continue; }
      }
      const b = byteAt(i, pc);
      // (code that is written while it runs, an RTS put over a placeholder: the path ends there)
      if (b >= 0 && !runnable(b) && stored[i].has(pc)) continue;
      if (b < 0 || !runnable(b)) { if (weak) return false; continue; }
      const o = OPC[b];
      // a BIT whose operand holds traced code skips it
      if (isBit(b) && [1, 2].slice(0, o.len - 1).some(k => start((pc + k) & 0xffff))) { skips.add(pc); stack.push([(pc + 1) & 0xffff, null, 0]); continue; }
      let fits = true;
      for (let k = 1; k < o.len; k++) { const q = (pc + k) & 0xffff; if (byteAt(i, q) < 0 || start(q) || skips.has(q) || skip[i][q] || busy(q)) fits = false; }
      if (!fits) { if (weak) return false; continue; }
      local.set(pc, o.len);
      for (let k = 1; k < o.len; k++) operand.add((pc + k) & 0xffff);
      const v = o.len === 3 ? byteAt(i, pc + 1) | (byteAt(i, pc + 2) << 8) : o.len === 2 ? byteAt(i, pc + 1) : 0;
      const next = (pc + o.len) & 0xffff;
      const go = (t: Addr) => { if (byteAt(i, t) >= 0) stack.push([t, null, 0]); else more.push(t); };
      switch (o.flow) {
        case 'seq': stack.push([next, b, v]); break;
        case 'br': { const w = branchWay(prev, prevV, b); if (w !== 'not') go((next + ((v ^ 0x80) - 0x80)) & 0xffff); if (w !== 'taken') stack.push([next, null, 0]); break; }
        case 'jmp': if (v !== pc && !unknown(i)) go(v); break;
        case 'jsr': if (!unknown(i)) go(v); stack.push([next, null, 0]); break;
        default: break;
      }
    }
    for (const a of unbit) { const n = ins[i][a]; ins[i][a] = 0; for (let k = 1; k < n; k++) inside[i][(a + k) & 0xffff] = 0; }
    for (const a of skips) skip[i][a] = 1;
    for (const [a, n] of local) { ins[i][a] = n; for (let k = 1; k < n; k++) inside[i][(a + k) & 0xffff] = 1; }
    // jumps into another image's code: entries there
    if (!unknown(i)) for (const t of more) for (let j = 0; j < images.length; j++) if (j !== i && !unknown(j) && byteAt(j, t) >= 0) pending.push({ i: j, a: t, weak: false });
    return true;
  };
  const pending: { i: number; a: Addr; weak: boolean }[] = [];
  images.forEach((im, i) => {
    for (const c of cmds) if (c.kind === 'M-E' && byteAt(i, c.addr) >= 0) { pending.push({ i, a: c.addr, weak: false }); ref(i, c.addr, 'entry'); }
    for (const g of im) if (g.hint != null && g.run === g.hint) pending.push({ i, a: g.run, weak: false });
  });
  const drain = () => { while (pending.length) { const p = pending.shift()!; trace(p.i, p.a, p.weak); } };
  drain();
  // the weaker starts: where an upload starts, page starts (the DOS runs a job's code from its buffer's start)
  images.forEach((im, i) => {
    const starts = new Set<Addr>();
    for (const g of im) {
      const base = g.run ?? g.start;
      starts.add(base);
      for (let d = (base + 0xff) & ~0xff; d < base + g.end - g.start; d += 0x100) starts.add(d);
      for (const c of cmds) if (c.kind === 'M-W' && c.addr >= base && c.addr < base + g.end - g.start) starts.add(c.addr);
      // what its JMPs and JSRs land on, wherever they are in its bytes (where it runs was found by them)
      if (g.run != null) for (let a = g.start; a + 2 < g.end; a++) if (mem[a] === 0x4c || mem[a] === 0x20) { const t = mem[a + 1] | (mem[a + 2] << 8); if (byteAt(i, t) >= 0) starts.add(t); }
    }
    for (const a of [...starts].sort((x, y) => x - y)) { trace(i, a, true); drain(); }
  });

  // ---- what the code refers to ----
  images.forEach((_, i) => {
    for (let pc = 0; pc < 0x10000; pc++) {
      const n = ins[i][pc]; if (!n) continue;
      const o = OPC[byteAt(i, pc)];
      const v = n === 3 ? byteAt(i, pc + 1) | (byteAt(i, pc + 2) << 8) : n === 2 ? byteAt(i, pc + 1) : 0;
      if (o.mode === 'rel') { const t = (pc + 2 + ((v ^ 0x80) - 0x80)) & 0xffff; if (byteAt(i, t) >= 0) ref(i, t, t <= pc ? 'back' : 'fwd'); continue; }
      if (unknown(i)) continue;
      if (o.flow === 'jsr') { if (byteAt(i, v) >= 0) ref(i, v, 'sub'); continue; }
      if (o.flow === 'jmp') { if (v !== pc && byteAt(i, v) >= 0) ref(i, v, 'jmp'); continue; }
      if (MODE_LEN[o.mode] === 3 && o.mode !== 'ind' && byteAt(i, v) >= 0 && v >= 0x100) ref(i, v, o.access === 'write' || o.access === 'rmw' ? 'write' : o.mode === 'abx' || o.mode === 'aby' ? 'index' : 'read');
      if (o.mode === 'ind' && byteAt(i, v) >= 0) ref(i, v, 'read');
    }
  });
  for (const g of segs) { const i = imageOf.get(g)!, base = g.run ?? g.start; for (let d = base; d < base + g.end - g.start; d++) g.code += ins[i][d & 0xffff] || skip[i][d & 0xffff]; }

  // ---- labels ----
  const suffix = (i: number) => (images.filter(im => im[0].run != null).length > 1 && images[i][0].run != null && i > 0 ? `_${i + 1}` : '');
  const labels = images.map(() => new Map<Addr, string>());
  images.forEach((_, i) => {
    for (const [a, ks] of refs[i]) {
      // a reference into an instruction's operand (self-modifying code) is that instruction's label + k
      let at = a;
      if (inside[i][a]) { at = a; while (at > 0 && !ins[i][at]) at--; }
      const code = !!ins[i][at];
      const pre = ks.has('entry') ? 'entry' : ks.has('sub') ? 'sub' : ks.has('jmp') || (ks.has('back') && ks.has('fwd')) ? 'l' : ks.has('back') ? 'loop' : ks.has('fwd') ? 'skip'
        : code ? (ks.has('write') ? 'smc' : 'l') : ks.has('write') ? 'var' : ks.has('index') ? 'tbl' : 'data';
      if (!labels[i].has(at) || pre === 'entry' || pre === 'sub') labels[i].set(at, `${pre}_${hx(at, 4)}${suffix(i)}`);
    }
  });
  /** the tokens of an address operand in image i */
  const addrTok = (i: number, t: Addr, call: boolean, drive: '1541' | '1581'): Token[] => {
    const g = unknown(i) ? null : segAt(i, t);
    if (g) {
      let at = t; while (at > 0 && !labels[i].has(at) && inside[i][at]) at--;
      const name = labels[i].get(at);
      if (name) return [{ t: 'lbl', s: at === t ? name : `${name}+${t - at}`, to: t }];
    }
    const via = drive === '1541' ? VIA_SYM.get(t) : undefined;
    if (via && !call) { usedVia.add(t); return [{ t: 'hw', s: via.name, to: t, sym: { name: via.name, desc: via.desc, cat: 'VIA', addr: t } }]; }
    return [{ t: 'num', s: n4(t), to: t }];
  };
  const usedVia = new Set<Addr>();

  // ---- the lines ----
  const body: Line[] = [];
  const dataLine = (a: Addr, bytes: number[], cmt: string): Line => ({ k: 'dat', a, n: bytes.length, dir: '.byte', tok: bytes.flatMap((b, k) => [...(k ? [{ t: 'p', s: ', ' } as Token] : []), { t: 'num', s: n2(b) } as Token]), cmt });
  const lineDrive: (Addr | null)[] = [];
  const push = (l: Line, d: Addr | null) => { body.push(l); lineDrive.push(d); };
  const romCall = (drive: '1541' | '1581', t: Addr) => (drive === '1541' ? t >= 0xc000 : t >= 0x8000);
  /** the body line where each part starts */
  const segLine = new Map<Seg, number>();
  const emitSeg = (g: Seg) => {
    const i = imageOf.get(g)!, base = g.run ?? g.start, L = g.end - g.start;
    const drv = (c: Addr) => (base + c - g.start) & 0xffff;
    if (g.gap) { push(dataLine(g.start, [...mem.subarray(g.start, g.end)], g.how), null); return; }
    segLine.set(g, body.length);
    if (g.run != null) push({ k: 'dir', a: g.start, n: 0, tok: [{ t: 'dir', s: '.pseudopc' }, { t: 'p', s: ' ' }, { t: 'num', s: n4(g.run) }, { t: 'p', s: ' {' }], cmt: `${$(g.start)}-${$(g.end - 1)} run at ${$(g.run)}-${$(g.run + L - 1)} (${g.how})` }, g.run);
    else push({ k: 'cmt', a: g.start, text: `${$(g.start)}-${$(g.end - 1)}: ${g.how}` }, null);
    let data: number[] = [], dataAt = g.start;
    const flush = () => { if (data.length) push(dataLine(dataAt, data, ''), drv(dataAt)); data = []; };
    for (let c = g.start; c < g.end;) {
      const d = drv(c), n = ins[i][d];
      const lbl = labels[i].get(d);
      if (lbl || n || skip[i][d] || data.length === S_ROW) flush();
      if (lbl) push({ k: 'lbl', a: c, name: lbl }, d);
      if (skip[i][d]) {
        const o = OPC[mem[c]];
        push({ k: 'dat', a: c, n: 1, dir: '.byte', tok: [{ t: 'num', s: n2(mem[c]) }], cmt: `bit ${o.mode === 'abs' ? 'abs' : 'zp'}: skips the next ${o.len - 1}-byte instruction` }, d);
        c++; continue;
      }
      if (n) {
        if (c + n > g.end) {
          // the instruction goes on in bytes elsewhere in the C64's memory (after the next drive command)
          const o = OPC[mem[c]];
          push(dataLine(c, [...mem.subarray(c, g.end)], `${kickMnemonic(o.mn)}: its last ${c + n - g.end === 1 ? 'byte is' : `${c + n - g.end} bytes are`} in the next part`), d);
          c = g.end; continue;
        }
        push(insLine(i, c, d, g.drive), d);
        c += n; continue;
      }
      if (inside[i][d]) {
        // the rest of an instruction that started in the part before
        let e = c; while (e < g.end && inside[i][drv(e)] && !ins[i][drv(e)]) e++;
        push(dataLine(c, [...mem.subarray(c, e)], 'the rest of the instruction before the drive command'), d);
        c = e; continue;
      }
      if (!data.length) dataAt = c;
      data.push(mem[c]); c++;
    }
    flush();
    if (g.run != null) push({ k: 'dir', a: g.end, n: 0, tok: [{ t: 'p', s: '}' }] }, null);
  };
  const S_ROW = 8;
  const insLine = (i: number, c: Addr, d: Addr, drive: '1541' | '1581'): Line => {
    const o = OPC[mem[c]], n = o.len;
    const v = n === 3 ? mem[c + 1] | (mem[c + 2] << 8) : n === 2 ? mem[c + 1] : 0;
    const tok: Token[] = [];
    let ext: '' | '.abs' = '';
    const cm: string[] = [];
    switch (o.mode) {
      case 'imp': case 'acc': break;
      case 'imm': tok.push({ t: 'p', s: '#' }, { t: 'num', s: n2(v) }); break;
      case 'rel': {
        const t = (d + 2 + ((v ^ 0x80) - 0x80)) & 0xffff;
        const name = labels[i].get(t);
        if (name) tok.push({ t: 'lbl', s: name, to: t });
        else { const k = t - d; tok.push({ t: 'p', s: k >= 0 ? `*+${k}` : `*-${-k}` }); }
        break;
      }
      case 'zp': case 'zpx': case 'zpy': case 'izx': case 'izy': {
        const t: Token = { t: 'num', s: n2(v) };
        if (o.mode === 'izx') tok.push({ t: 'p', s: '(' }, t, { t: 'p', s: ',x)' });
        else if (o.mode === 'izy') tok.push({ t: 'p', s: '(' }, t, { t: 'p', s: '),y' });
        else tok.push(t, ...(o.mode === 'zpx' ? [{ t: 'p', s: ',x' } as Token] : o.mode === 'zpy' ? [{ t: 'p', s: ',y' } as Token] : []));
        break;
      }
      default: {
        if (o.flow === 'jmp' && v === d) { tok.push({ t: 'p', s: '*' }); break; }
        const call = o.flow === 'jsr' || o.flow === 'jmp';
        const tk = addrTok(i, v, call, drive);
        if (v < 0x100 && o.mode !== 'ind') { ext = '.abs'; if (tk[0].t === 'num') tk[0].s = n4(v); }
        if (o.mode === 'ind') tok.push({ t: 'p', s: '(' }, ...tk, { t: 'p', s: ')' });
        else tok.push(...tk, ...(o.mode === 'abx' ? [{ t: 'p', s: ',x' } as Token] : o.mode === 'aby' ? [{ t: 'p', s: ',y' } as Token] : []));
        if (call && romCall(drive, v)) cm.push(drive === '1541' && ROM_1541[v] ? `1541 ROM: ${ROM_1541[v]}` : `in the ${drive}'s ROM`);
        if (tk[0].t === 'hw') { const via = VIA_SYM.get(v); if (via?.short) cm.push(via.short); }
        break;
      }
    }
    if (o.ill) cm.push('undocumented');
    return { k: 'ins', a: c, n, mn: o.mn, ext, tok, cmt: cm.join('; '), ...(o.ill ? { ill: true } : {}) };
  };

  // the units: each run of the C64's memory the drive code and its commands cover, from its first byte
  const pieces: ({ k: 'seg'; g: Seg } | { k: 'cmd'; c: Cmd })[] = [
    ...segs.map(g => ({ k: 'seg' as const, g })),
    ...cmds.filter(c => segs.some(g => c.at <= g.end && c.end >= g.start)).map(c => ({ k: 'cmd' as const, c })),
  ].sort((x, y) => (x.k === 'seg' ? x.g.start : x.c.at) - (y.k === 'seg' ? y.g.start : y.c.at));
  let pc = -1, covered = 0;
  for (const p of pieces) {
    const s = p.k === 'seg' ? p.g.start : p.c.at, e = p.k === 'seg' ? p.g.end : p.c.end;
    if (s < pc) continue; // (a command inside bytes already written)
    if (s !== pc) {
      if (body.length) push({ k: 'blank', a: s }, null);
      const loader = p.k === 'seg' ? p.g.loader : loaderOf(s, e);
      const head = `---- ${loader}: drive code at ${$(s)} `;
      push({ k: 'cmt', a: s, text: head.padEnd(Math.max(66, head.length + 4), '-') }, null);
      push({ k: 'dir', a: s, n: 0, tok: [{ t: 'dir', s: '.pc' }, { t: 'p', s: ' = ' }, { t: 'num', s: n4(s) }, { t: 'p', s: ' ' }, { t: 'str', s: '"Drive code"' }] }, null);
    }
    if (p.k === 'cmd') {
      const c = p.c;
      const what = c.kind === 'M-W' ? `${c.n} bytes to ${$(c.addr)} in the drive` : c.kind === 'M-E' ? `starts the drive at ${$(c.addr)}` : `reads ${c.n} bytes from ${$(c.addr)} in the drive`;
      push(dataLine(c.at, [...mem.subarray(c.at, c.end)], `"${c.kind}"${c.forward ? '' : ' backwards (sent from its end)'}: ${what}`), null);
    } else emitSeg(p.g);
    covered += e - s;
    pc = e;
  }

  // ---- the head ----
  const head: Line[] = [];
  const hc = (text: string) => head.push({ k: 'cmt', a: segs[0].start, text });
  const drives = [...new Set(segs.map(g => g.drive))];
  hc(`${name}: the drive code, re-assembled`);
  hc('');
  hc(`The code for the ${drives.join(' and ')} that the program keeps in the C64's memory and uploads to the drive. Each part is`);
  hc('written where it is in the C64\'s memory, inside .pseudopc at the address where it runs in the drive, so this source');
  hc('assembles to the program\'s bytes again. What the traced code does not reach stays data.');
  hc('');
  for (const g of segs.filter(x => !x.gap)) hc(`${$(g.start)}-${$(g.end - 1)}  ${g.run != null ? `runs at ${$(g.run)}-${$(g.run + g.end - g.start - 1)}` : 'runs where it is not known'}  ${g.code} of ${g.end - g.start} bytes code  (${g.how})`);
  const lines: Line[] = [...head];
  if (usedVia.size) {
    lines.push({ k: 'blank', a: segs[0].start });
    for (const a of [...usedVia].sort((x, y) => x - y)) { const v = VIA_SYM.get(a)!; lines.push({ k: 'dir', a: segs[0].start, n: 0, tok: [{ t: 'dir', s: '.label' }, { t: 'p', s: ' ' }, { t: 'def', s: v.name, zp: a }, { t: 'p', s: ' = ' }, { t: 'num', s: n4(a) }], cmt: v.desc }); }
  }
  lines.push({ k: 'blank', a: segs[0].start });
  const headN = lines.length;
  lines.push(...body);
  const at: DriveCode['at'] = [...lines.slice(0, headN).map(() => null), ...body.map((l, k) => (l.k === 'blank' ? null : { c64: l.a, drive: lineDrive[k] }))];
  const text = lines.map(l => lineText(l, S)).join('\n') + '\n';

  // ---- assemble it: the same bytes ----
  const file = `${name.replace(/\.[^.]*$/, '')}-drive.asm`;
  const check: DriveCheck = { ok: false, bytes: 0, diffs: [], errors: [] };
  try {
    const r = assemble({ [file]: text }, file);
    check.errors = r.errors.map(e => `line ${e.line}: ${e.msg}`);
    for (let a = 0; a < 0x10000; a++) {
      if (!r.written[a]) continue;
      check.bytes++;
      if (r.mem[a] !== mem[a] && check.diffs.length < 8) check.diffs.push(a);
    }
    check.ok = !check.errors.length && !check.diffs.length && check.bytes === covered;
  } catch (e) { check.errors.push(String((e as Error)?.message ?? e)); }
  const shown = segs.filter(g => !g.gap);
  return { file, segments: shown.map(({ hint: _h, gap: _g, ...g }) => g), partLines: shown.map(g => headN + (segLine.get(g) ?? 0)), lines, text, at, bytes: covered, check };
}

/**
 * Where the bytes from `s` to `e` run: the address at which the most of their JMPs and JSRs land on instructions in
 * them (three in a row that the drive can run), checked by tracing from those targets (a target whose code meets a
 * byte that is no instruction counts against it). `cands` (M-W and M-E addresses, the loader's own) win a tie.
 */
export function runAddress(mem: Uint8Array, s: Addr, e: Addr, cands: Set<number>, hint: Addr | null = null, top = 0x800): { run: Addr; how: string } | null {
  const L = e - s;
  const targets: Addr[] = [];
  const stores = new Set<Addr>();
  for (let o = 0; o + 2 < L; o++) {
    const b = mem[s + o], t = mem[s + o + 1] | (mem[s + o + 2] << 8);
    if (b === 0x4c || b === 0x20) targets.push(t);
    else if (storesAbs(b)) stores.add(t);
  }
  if (!targets.length && hint == null) return null;
  const ok3 = (off: number) => {
    for (let k = 0, p = off; k < 3; k++) {
      if (p >= L) return k > 0;
      const b = mem[s + p]; if (!runnable(b)) return false;
      const o = OPC[b]; if (o.flow === 'ret' || o.flow === 'jmp' || o.flow === 'jmpi') return true;
      p += o.len;
    }
    return true;
  };
  // run addresses where all the bytes are in the drive's RAM (below `top`)
  const MIN = 0, MAX = Math.max(1, top - L + 1);
  const score = new Float64Array(MAX - MIN);
  for (const t of targets) {
    if (t >= top) continue;
    for (let R = Math.max(MIN, t - L + 1); R <= t && R < MAX; R++) if (ok3(t - R)) score[R - MIN] += 1;
  }
  const order = [...score.keys()].filter(k => score[k] >= 2).sort((x, y) => score[y] - score[x]).slice(0, 12).map(k => k + MIN);
  // an upload goes a page at a time (the same low byte as in the C64, or a page start), or from an M-W address
  for (let R = s & 0xff; R < MAX; R += 0x100) order.push(R);
  for (let R = 0; R < MAX; R += 0x100) order.push(R);
  for (const R of cands) if (R >= MIN && R < MAX) order.push(R);
  if (hint != null && hint < MAX) order.push(hint);
  let best: { run: number; v: number; hits: number; bad: number } | null = null;
  for (const R of new Set(order)) {
    // trace from every target in the bytes: a byte that is no instruction counts against the address
    const seen = new Uint8Array(L);
    let hits = 0, bad = 0;
    for (const t of targets) {
      const off = t - R; if (off < 0 || off >= L) continue;
      const stack: [number, number | null, number][] = [[off, null, 0]]; let good = true;
      while (stack.length) {
        const [p, prev, prevV] = stack.pop()!;
        if (p < 0 || p >= L || seen[p]) continue;
        const b = mem[s + p];
        // (code the bytes write while they run: the path ends there)
        if (!runnable(b) && stores.has(R + p)) continue;
        if (!runnable(b) || p + OPC[b].len > L) { good = false; break; }
        seen[p] = 1;
        const o = OPC[b], next = p + o.len;
        const v = o.len === 3 ? mem[s + p + 1] | (mem[s + p + 2] << 8) : mem[s + p + 1];
        if (o.flow === 'seq') stack.push([next, b, v]);
        else if (o.flow === 'br') { const w = branchWay(prev, prevV, b); if (w !== 'not') stack.push([next + ((v ^ 0x80) - 0x80), null, 0]); if (w !== 'taken') stack.push([next, null, 0]); }
        else if (o.flow === 'jsr') { stack.push([v - R, null, 0]); stack.push([next, null, 0]); }
        else if (o.flow === 'jmp' && v - R !== p) stack.push([v - R, null, 0]);
      }
      if (good) hits++; else bad++;
    }
    const v = hits - 2 * bad + (cands.has(R) ? 1 : 0) + (hint === R ? 3 : 0) + ((R & 0xff) === (s & 0xff) ? 1 : 0) + ((R & 0xff) === 0 ? 0.5 : 0);
    if (!best || v > best.v) best = { run: R, v, hits, bad };
  }
  if (!best) return null;
  if (best.run !== hint && (best.hits < 1 || best.v < 3)) return null;
  const how = best.run === hint && best.hits < 2 ? `the loader's part runs at ${$4(best.run)}`
    : `${best.hits} of its jumps land on code there${best.run === hint ? ', where the loader\'s part runs' : cands.has(best.run) ? ', an M-W or M-E address' : (best.run & 0xff) === (s & 0xff) ? ', with the low byte it has in the C64' : ''}`;
  return { run: best.run, how };
}
