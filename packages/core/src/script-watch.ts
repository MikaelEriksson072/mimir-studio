/* =====================================================================
 * The watch list of a user script (spec 10.3): the memory its code may change, found in the code itself (every
 * instruction that writes an address: `sta $d020`, `inc counter`, `sta screen,x`, and the pointers it writes through
 * or moves: `sta (dest),y`), and the memory the user adds (UserScript.watch). Each is read as a run starts, as the
 * last run left it, or (debugging) as the run has it now, through the script's eyes: its own memory where its code,
 * data and scratchpads are, the program's everywhere else.
 * ===================================================================== */
import type { Addr, ScriptPad, ScriptWatchEntry } from './types';
import { OPC, type AddrMode } from './cpu/opcodes';
import { codeOf, type ScriptCheck, type ScriptMemory } from './script';
import { h2, h4 } from './util/hex';

/** whose memory an address is while the script runs: the program's, its zero page, the script's own code and data,
 *  or one of its scratchpads */
export type WatchSpace = 'program' | 'zp' | 'own' | 'pad';

/** A spot of memory on the watch list. */
export interface WatchSpot {
  /** what it is known by on the list (what the user takes off it by): the operand as the code writes it (`$d020`,
   *  `screen,x`, `(dest),y`) for one found in the code, `+` and the expression for one the user added */
  key: string;
  /** what the list calls it: the operand's name or address as the code writes it, or what the user typed */
  name: string;
  at: Addr;
  /** how many bytes it covers from `at`: 1, 2 (a word, low byte first), or a range (an indexed write reaches 256) */
  size: number;
  /** a 16-bit value, low byte first */
  word?: boolean;
  /** a zero-page pointer (a word): the bytes it points at are shown too */
  ptr?: boolean;
  /** the index register that picks the byte written (`sta screen,x`, `sta (dest),y`): debugging, the row of bytes
   *  shown follows it */
  index?: 'x' | 'y';
  /** an indexed zero-page address (`sta $f0,x`): it wraps in the zero page */
  wrap?: boolean;
  space: WatchSpace;
  /** the scratchpad it is in (space `pad`) */
  pad?: string;
  /** the lines of the code that write it or move it (none for one the user added) */
  lines: number[];
  /** the first of those lines' code (`sta screen,x`) */
  how?: string;
  /** a pointer the code only reads through: on the list because the code moves it */
  readsThrough?: boolean;
  /** added by the user */
  user?: boolean;
  /** what is wrong with one the user added (its expression names no address now) */
  error?: string;
}

/** whose memory `at` is while the script runs */
export function watchSpace(check: Pick<ScriptCheck, 'written'>, pads: readonly Pick<ScriptPad, 'name' | 'start' | 'size'>[], at: Addr): { space: WatchSpace; pad?: string } {
  if (check.written[at & 0xffff]) return { space: 'own' };
  const p = pads.find(q => at >= q.start && at < q.start + q.size);
  if (p) return { space: 'pad', pad: p.name };
  return { space: at < 0x100 ? 'zp' : 'program' };
}

/** the operand of an instruction's line as written, without its index and its parentheses (`screen` of
 *  `sta screen,x`, `dest` of `sta (dest),y`); null: the line is not that instruction written plainly */
function operandOf(code: string, mn: string, mode: AddrMode): string | null {
  const m = new RegExp(`(?:^|\\s)${mn}(?:\\.[a-z]+)?\\s+(.+)$`, 'i').exec(code);
  if (!m) return null;
  // (the closing brace of a block on the same line is not the operand's)
  let t = m[1].replace(/\s*\}+\s*$/, '').trim();
  const shape: Partial<Record<AddrMode, RegExp>> = {
    zpx: /^(.+?)\s*,\s*x$/i, abx: /^(.+?)\s*,\s*x$/i, zpy: /^(.+?)\s*,\s*y$/i, aby: /^(.+?)\s*,\s*y$/i,
    izy: /^\(\s*(.+?)\s*\)\s*,\s*y$/i, izx: /^\(\s*(.+?)\s*,\s*x\s*\)$/i,
  };
  const s = shape[mode];
  if (s) { const p = s.exec(t); if (!p) return null; t = p[1]; }
  t = t.replace(/\s+/g, ' ').trim();
  return t && !t.startsWith('#') ? t : null;
}

const addrText = (a: Addr, zp: boolean) => (zp ? `$${h2(a)}` : `$${h4(a)}`);

/**
 * The memory a script's code may change, found in its assembled code: each instruction that writes an address (a
 * store, or a read-modify-write: INC, ASL, …) gives the byte it writes, an indexed one (`,x` `,y`) the range it can
 * reach, and one that writes through a zero-page pointer (`sta (dest),y`) the pointer, whose bytes it points at are
 * shown too. A pointer the code only reads through is there when the code moves it (`inc src+1`). What the same
 * operand writes is one spot (the lines that write it are kept); a pointer takes in the writes of its two bytes, two
 * bytes written as `name` and `name+1` are a word, and a byte written also with an index is in its range. A write the
 * code makes through the program's routines it calls cannot be known here. In the order of their first lines.
 */
export function scriptWatches(check: Pick<ScriptCheck, 'mem' | 'ops' | 'lines' | 'written'>, source: string, pads: readonly Pick<ScriptPad, 'name' | 'start' | 'size'>[]): WatchSpot[] {
  const src = source.split(/\r?\n/);
  interface Found { at: number; kind: 'byte' | 'range' | 'ptr'; index?: 'x' | 'y'; zp: boolean; core: string | null; line: number; how: string; write: boolean }
  const found: Found[] = [];
  for (let a = 0; a < 0x10000; a++) {
    if (!check.ops[a]) continue;
    const o = OPC[check.mem[a]];
    const lo = check.mem[(a + 1) & 0xffff], w = lo | (check.mem[(a + 2) & 0xffff] << 8);
    const write = o.access === 'write' || o.access === 'rmw';
    let f: Pick<Found, 'at' | 'kind' | 'index' | 'zp'> | null = null;
    switch (o.mode) {
      case 'zp': if (write) f = { at: lo, kind: 'byte', zp: true }; break;
      case 'abs': if (write) f = { at: w, kind: 'byte', zp: false }; break;
      case 'zpx': if (write) f = { at: lo, kind: 'range', index: 'x', zp: true }; break;
      case 'zpy': if (write) f = { at: lo, kind: 'range', index: 'y', zp: true }; break;
      case 'abx': if (write) f = { at: w, kind: 'range', index: 'x', zp: false }; break;
      case 'aby': if (write) f = { at: w, kind: 'range', index: 'y', zp: false }; break;
      // a pointer: written through, or only read through (kept when the code moves it)
      case 'izy': if (o.access) f = { at: lo, kind: 'ptr', index: 'y', zp: true }; break;
      case 'izx': if (o.access) f = { at: lo, kind: 'ptr', zp: true }; break;
    }
    if (!f) continue;
    const line = check.lines[a], how = codeOf(src[line - 1] ?? '');
    found.push({ ...f, core: operandOf(how, o.mn, o.mode), line, how, write });
  }
  // an operand that writes more than one address (a line in a .for, `*+1` on several lines) is named by address
  const ats = new Map<string, Set<number>>();
  for (const f of found) if (f.core) { const k = `${f.kind}:${f.core}`; if (!ats.has(k)) ats.set(k, new Set()); ats.get(k)!.add(f.at); }
  interface Spot extends WatchSpot { wrote: boolean }
  const spots = new Map<string, Spot>();
  for (const f of found) {
    const name = f.core && ats.get(`${f.kind}:${f.core}`)!.size === 1 ? f.core : addrText(f.at, f.zp);
    const key = f.kind === 'byte' ? name : f.kind === 'range' ? `${name},${f.index}` : f.index ? `(${name}),y` : `(${name},x)`;
    const had = spots.get(key);
    if (had) { if (!had.lines.includes(f.line)) had.lines.push(f.line); had.wrote ||= f.write; continue; }
    const size = f.kind === 'byte' ? 1 : f.kind === 'ptr' ? 2 : f.zp ? 0x100 : Math.min(0x100, 0x10000 - f.at);
    spots.set(key, {
      key, name, at: f.at, size, lines: [f.line], how: f.how, wrote: f.write, ...watchSpace(check, pads, f.at),
      ...(f.kind === 'ptr' ? { word: true, ptr: true } : {}), ...(f.index ? { index: f.index } : {}), ...(f.kind === 'range' && f.zp ? { wrap: true } : {}),
    });
  }
  const all = [...spots.values()];
  const drop = new Set<Spot>();
  const take = (into: Spot, from: Spot) => { for (const l of from.lines) if (!into.lines.includes(l)) into.lines.push(l); drop.add(from); };
  const bytes = () => all.filter(s => !drop.has(s) && s.size === 1);
  // a pointer takes in the writes of its two bytes; one the code only reads through stays when the code moves it
  for (const p of all.filter(s => s.ptr)) {
    const mine = bytes().filter(s => s.at === p.at || s.at === ((p.at + 1) & 0xff));
    for (const s of mine) take(p, s);
    if (!p.wrote) { if (mine.length) p.readsThrough = true; else drop.add(p); }
  }
  // `name` and `name+1`: a word
  const bare = (n: string) => n.replace(/\s+/g, '');
  for (const a of bytes()) {
    if (drop.has(a)) continue;
    const b = bytes().find(s => s !== a && s.at === ((a.at + 1) & 0xffff) && bare(s.name) === `${bare(a.name)}+1`);
    if (b) { a.size = 2; a.word = true; take(a, b); }
  }
  // a byte also written with an index from it: in its range
  for (const r of all.filter(s => s.size > 2 && !s.ptr)) for (const s of bytes()) if (s.at === r.at && bare(s.name) === bare(r.name)) take(r, s);
  return all.filter(s => !drop.has(s)).map(({ wrote: _, ...s }) => ({ ...s, lines: s.lines.sort((x, y) => x - y) }))
    .sort((x, y) => x.lines[0] - y.lines[0] || x.at - y.at);
}

/** what a spot the user added is known by on the list: `+`, the expression and what it is (`+table@8`, `+ptr@ptr`) */
export const watchEntryKey = (e: ScriptWatchEntry): string => `+${e.expr}${e.ptr ? '@ptr' : e.size && e.size > 1 ? `@${e.size}` : ''}`;

/**
 * The spots the user added (UserScript.watch): each expression read by `resolve` (an address, a name of the program or
 * the script, `name+2`); a byte, a word, a pointer or a row of bytes. One that names no address now says so.
 */
export function userWatches(entries: readonly ScriptWatchEntry[], resolve: (expr: string) => Addr | null, check: Pick<ScriptCheck, 'written'>, pads: readonly Pick<ScriptPad, 'name' | 'start' | 'size'>[]): WatchSpot[] {
  return entries.map(e => {
    const at = resolve(e.expr);
    const size = e.ptr ? 2 : Math.max(1, Math.min(0x100, e.size ?? 1));
    const base = { key: watchEntryKey(e), name: e.expr, lines: [], user: true as const };
    if (at == null) return { ...base, at: 0, size, space: 'program' as const, error: `"${e.expr}" names no address of the program or the script now` };
    return {
      ...base, at, size: e.ptr ? 2 : Math.min(size, 0x10000 - at), ...watchSpace(check, pads, at),
      ...(e.ptr ? { word: true, ptr: true } : size === 2 ? { word: true } : {}),
    };
  });
}

/** a byte as the script's code sees it: its own memory where its code, data and scratchpads are, the program's
 *  elsewhere; through a pointer, the program's also where its instructions are (as the run's bus has it) */
export function watchByte(m: ScriptMemory, a: number, viaPointer = false): number {
  a &= 0xffff;
  return m.mine[a] && !(viaPointer && m.code[a]) ? m.own[a] : m.mem[a];
}

/** a row of a spot's bytes */
export interface WatchRow { at: Addr; bytes: number[]; was?: number[] }

/** A spot read from memory. */
export interface WatchView {
  /** a byte's or a word's value (a pointer's: the address it points at); `was` the same in the memory compared with */
  value?: number;
  was?: number;
  /** the bytes shown in a row: of a range, or where a pointer points */
  row?: WatchRow;
  /** of a range (a pointer's: the 256 bytes from where it points): how many differ from the start, and
   *  of how many */
  changed?: number;
  of?: number;
}

/**
 * A spot as `now` has it: a byte or a word with `was`, its value in `ref` (what it is compared with: the start, or the
 * memory before the debugger's last step); a range, or the 256 bytes from where a pointer points now, as a row of
 * `per` bytes. Debugging (`regs`), the row follows the index register (the byte the instruction writes next is in
 * it); otherwise the row is where the first byte that differs from `start` is (else the first bytes).
 */
export function watchView(spot: WatchSpot, now: ScriptMemory, o: { ref?: ScriptMemory | null; start?: ScriptMemory | null; regs?: { x: number; y: number } | null; per?: number } = {}): WatchView {
  const per = Math.max(1, o.per ?? 8);
  if (spot.error) return {};
  if (spot.size === 1) return { value: watchByte(now, spot.at), ...(o.ref ? { was: watchByte(o.ref, spot.at) } : {}) };
  // a pointer in the zero page wraps there, as (zp),y does
  const wordAt = (m: ScriptMemory) => watchByte(m, spot.at) | (watchByte(m, spot.ptr && spot.at < 0x100 ? (spot.at + 1) & 0xff : spot.at + 1) << 8);
  if (spot.word) {
    const value = wordAt(now), out: WatchView = { value, ...(o.ref ? { was: wordAt(o.ref) } : {}) };
    if (!spot.ptr) return out;
    const target = o.regs && spot.index ? (value + o.regs[spot.index]) & 0xffff : null;
    return { ...out, ...rowOf(value, 0x100, false, true, target) };
  }
  const target = o.regs && spot.index ? spot.at + o.regs[spot.index] : null;
  return rowOf(spot.at, spot.size, !!spot.wrap, false, target);

  function rowOf(origin: number, len: number, wrap: boolean, viaPointer: boolean, target: number | null): WatchView {
    const addr = (i: number) => (wrap ? (origin + i) & 0xff : (origin + i) & 0xffff);
    let changed: number | undefined, first = -1;
    if (o.start) {
      changed = 0;
      for (let i = 0; i < len; i++) if (watchByte(now, addr(i), viaPointer) !== watchByte(o.start, addr(i), viaPointer)) { changed++; if (first < 0) first = i; }
    }
    let off = 0;
    if (target != null) { const d = (target - origin) & (wrap ? 0xff : 0xffff); if (d < len) off = d; }
    else if (first >= 0) off = first;
    off = Math.max(0, Math.min(Math.floor(off / per) * per, len - per));
    const n = Math.min(per, len);
    const row: WatchRow = { at: addr(off), bytes: Array.from({ length: n }, (_, k) => watchByte(now, addr(off + k), viaPointer)) };
    if (o.ref) { const ref = o.ref; row.was = Array.from({ length: n }, (_, k) => watchByte(ref, addr(off + k), viaPointer)); }
    return { row, ...(changed != null ? { changed, of: len } : {}) };
  }
}
