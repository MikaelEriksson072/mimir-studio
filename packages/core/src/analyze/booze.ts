/* 5.15b BoozeLoader's script (spec 13.5d). BoozeLoader (HCL/Booze Design) has no script file and no linker that writes
 * code for it: the demo's own code calls the loader with a file number (`lda #file / jsr $0200`), calls the part it
 * loaded, loads the next one and so on, and asks for the next disk side with a number from $80 up (`lda #$b2`: side 2).
 * Its oldest version takes a track and sector instead (`ldy #sector / ldx #track / lda #0 / jsr $0200`; A 1 loads
 * without unpacking, 2 unpacks what is in memory at X/Y). That code is the script: the stretches of code that call the
 * loader, from their start to their rts or jmp, read as their loads, side changes and other calls (with what A, X and Y
 * are set to right before them, such as a part's arguments). The disk's file table gives what each file unpacks to
 * (c64/booze-disk.ts).
 *
 * Often the script is copied elsewhere before it runs, or only the loader's own page reaches it, so the analysis does
 * not trace it: then `lda #n / jsr loader` in the bytes it did not trace are read too, as a stretch that is not traced
 * (back over jsr, immediate loads and stores, on to an rts or jmp). A tail call (`lda #n / jmp loader`) loads too. */
import type { Addr, BoozeScript, BoozeStep, LoaderFinding } from '../types';
import type { Ctx } from './context';
import { OPC } from '../cpu/opcodes';

/** the oldest version's entry sends X and Y (the track and sector): txa / jsr send / tya / jsr send / jsr … / cmp #0 / php */
const BY_TRACK = [0x8a, 0x20, null, null, 0x98, 0x20, null, null, 0x20, null, null, 0xc9, 0x00, 0x08];
/** stores, inc and dec (of memory) and flag changes: they leave A, X and Y as they are */
const KEEPS = new Set([0x85, 0x8d, 0x86, 0x8e, 0x84, 0x8c, 0xe6, 0xee, 0xc6, 0xce, 0xea, 0x18, 0x38, 0x58, 0x78]);
const IMMEDIATE: Record<number, 'a' | 'x' | 'y'> = { 0xa9: 'a', 0xa2: 'x', 0xa0: 'y' };
/** a stretch of code is at most this long; one not traced starts at most this far before its first load */
const MAX_RUN = 0x1000, MAX_BACK = 0x40;

export function findBoozeScript(ctx: Ctx, loaders: LoaderFinding[]): BoozeScript | null {
  const f = loaders.find(l => l.id === 'boozeloader');
  if (!f) return null;
  const { mem, insLen, codeOwner, loaded } = ctx;
  const isCode = (a: Addr) => insLen[a] > 0 || codeOwner[a] >= 0;
  const target = (j: Addr) => mem[j + 1] | (mem[j + 2] << 8);
  const ends = (op: number) => op === 0x60 || op === 0x40 || op === 0x4c || op === 0x6c || OPC[op].jam;
  /** the instruction before the one at `a` in traced code */
  const prev = (a: Addr): Addr | null => { for (let n = 1; n <= 3; n++) if (a - n >= 0 && insLen[a - n] === n) return a - n; return null; };
  /** the loader's calls: jsr (or jmp, a tail call such as Triad's lda #n / jmp loader) in traced code, and lda #n / jsr
   *  (or jmp) in the bytes not traced (the jsr's address) */
  const call = (op: number) => op === 0x20 || op === 0x4c;
  const traced: Addr[] = [], untraced: Addr[] = [];
  for (let a = 0; a + 2 < 0x10000; a++) {
    if (insLen[a] === 3 && call(mem[a])) traced.push(a);
    else if (a >= 2 && call(mem[a]) && mem[a - 2] === 0xa9 && loaded(a - 2) && loaded(a + 2) && !isCode(a - 2) && !isCode(a) && !isCode(a + 2)) untraced.push(a);
  }

  // the loader's entry: a routine near its resident parts that starts like it (pha / jsr send, or cmp #2 / bne for the
  // oldest), or one the program does not have yet (the resident is copied there later), that the program calls with a
  // number in A (with one there, at least three times)
  const resident = f.parts.filter(p => p.role === 'resident' && !p.outside);
  const near = (t: Addr) => resident.some(p => t >= p.start - 0x200 && t < p.end + 0x200);
  const looksLike = (t: Addr) => loaded(t) && (mem[t] === 0x48 || (mem[t] === 0xc9 && mem[t + 1] === 0x02 && mem[t + 2] === 0xd0));
  const calls = new Map<Addr, number>();
  const count = (j: Addr) => calls.set(target(j), (calls.get(target(j)) ?? 0) + 1);
  for (const j of traced) { const p = prev(j); if (p != null && mem[p] === 0xa9) count(j); }
  untraced.forEach(count);
  const entries = [...calls].filter(([t, n]) => (near(t) && looksLike(t)) || (!loaded(t) && n >= 3)).sort((x, y) => y[1] - x[1] || x[0] - y[0]);
  if (!entries.length) return null;
  const loader = entries[0][0];
  let byTrack = false;
  for (let a = 0; a + BY_TRACK.length <= 0x10000 && !byTrack; a++) byTrack = loaded(a) && BY_TRACK.every((b, i) => b == null || mem[a + i] === b);

  // the stretches of code around each call of the loader: back to the instruction after an rts, rti or jmp, on to one
  const runs: BoozeScript['runs'] = [];
  const inRun = (a: Addr) => runs.some(r => a >= r.start && a < r.end);
  /** decoded on from `start` (traced: as the analysis decoded it) to the instruction after an rts, rti or jmp */
  const endOf = (start: Addr, isTraced: boolean) => {
    let a = start;
    while (a - start < MAX_RUN && a < 0x10000 && (isTraced ? insLen[a] > 0 : loaded(a) && !isCode(a))) { const op = mem[a]; a += isTraced ? insLen[a] : OPC[op].len; if (ends(op)) break; }
    return Math.min(a, 0x10000);
  };
  for (const j of traced) {
    if (target(j) !== loader || inRun(j)) continue;
    let start = j;
    for (let p = prev(start); p != null && !ends(mem[p]) && j - p < MAX_RUN; p = prev(p)) start = p;
    runs.push({ start, end: endOf(start, true), traced: true });
  }
  for (const j of untraced) {
    if (target(j) !== loader || inRun(j)) continue;
    // back over what such a script has before a load: jsr, stores, inc and dec (3 bytes), immediate loads (2 bytes)
    let start = j - 2;
    const free = (a: Addr, n: number) => a >= 0 && [...Array(n).keys()].every(i => loaded(a + i) && !isCode(a + i));
    while (j - start < MAX_BACK) {
      const b3 = start - 3, b2 = start - 2;
      if (free(b3, 3) && (mem[b3] === 0x20 || mem[b3] === 0x8d || mem[b3] === 0x8e || mem[b3] === 0x8c || mem[b3] === 0xee || mem[b3] === 0xce)) start = b3;
      else if (free(b2, 2) && IMMEDIATE[mem[b2]]) start = b2;
      else break;
    }
    // (bytes that only look like one call are not a script: one not traced loads twice at least, or is one of a row of
    // calls, as Triad's lda #n / jmp loader are, each within 64 bytes of the next)
    const end = endOf(start, false), mine = untraced.filter(k => k >= start && k < end && target(k) === loader);
    if (mine.length >= 2 || untraced.some(k => target(k) === loader && !mine.includes(k) && Math.abs(k - j) <= 64)) runs.push({ start, end, traced: false });
  }
  runs.sort((x, y) => x.start - y.start);

  // the steps, with A, X and Y as the immediate loads since the last other instruction set them
  const steps: BoozeStep[] = [];
  for (const r of runs) {
    let regs: { a: number | null; x: number | null; y: number | null; at: Addr | null } = { a: null, x: null, y: null, at: null };
    const clear = () => { regs = { a: null, x: null, y: null, at: null }; };
    for (let a = r.start; a < r.end; a += r.traced ? insLen[a] || 1 : OPC[mem[a]].len) {
      const op = mem[a], reg = IMMEDIATE[op];
      if (reg) { regs[reg] = mem[a + 1]; regs.at ??= a; continue; }
      if (KEEPS.has(op)) continue;
      if (op !== 0x20 && !(op === 0x4c && target(a) === loader)) { clear(); continue; }
      const t = target(a), g = regs, at = g.at ?? a;
      clear();
      if (t !== loader) { steps.push({ at, jsr: a, kind: 'call', to: t, a: g.a, x: g.x, y: g.y }); continue; }
      if (byTrack) steps.push({ at, jsr: a, kind: 'load', mode: g.a ?? 0, track: g.x, sector: g.y });
      else if (g.a != null && g.a >= 0x80) { const c = g.a & 0x7f; steps.push({ at, jsr: a, kind: 'side', side: c >= 0x30 && c <= 0x39 ? c - 0x30 : c }); }
      else steps.push({ at, jsr: a, kind: 'load', file: g.a });
    }
  }
  return { loader, byTrack, runs, steps };
}

const h2 = (v: number) => v.toString(16).padStart(2, '0'), h4 = (v: number) => v.toString(16).padStart(4, '0');

/** A step as a line of the script: `load $07`, `side 2`, `load 3/0` (track/sector), `call $4003 a=$04 x=$05`. */
export function boozeLine(s: BoozeStep): string {
  if (s.kind === 'side') return `side ${s.side}`;
  if (s.kind === 'call') return `call $${h4(s.to!)}${(['a', 'x', 'y'] as const).map(r => (s[r] != null ? ` ${r}=$${h2(s[r]!)}` : '')).join('')}`;
  if (s.mode == null) return s.file != null ? `load $${h2(s.file)}` : 'load (A set by the code)';
  const ts = s.track != null && s.sector != null ? `${s.track}/${s.sector}` : '(X and Y set by the code)';
  if (s.mode === 2) return s.track != null && s.sector != null ? `unpack $${h2(s.track)}${h2(s.sector)}` : 'unpack (X and Y set by the code)';
  return s.mode === 1 ? `load ${ts} as it is` : `load ${ts}`;
}

/** The script as text: a comment that says what it is, then each stretch of code with its steps. `unpacks`: what a
 *  file unpacks to, by number, from a mounted disk of the side the steps are on (null: not known). */
export function boozeScript(script: BoozeScript, unpacks?: (s: BoozeStep, side: number | null) => string | null): string[] {
  const loads = script.steps.filter(s => s.kind === 'load').length;
  const out = [
    `; BoozeLoader script, read back by Mimir Studio from the code that calls the loader at $${h4(script.loader)}: ${loads} load${loads === 1 ? '' : 's'}.`,
    script.byTrack
      ? `; The code is the script: ldy #sector / ldx #track / lda #0 / jsr $${h4(script.loader)} loads a file, and the calls between run the parts.`
      : `; The code is the script: lda #file / jsr $${h4(script.loader)} loads a file, lda #$80+side waits for a disk side, and the calls between run the parts.`,
  ];
  let side: number | null = null;
  for (const r of script.runs) {
    out.push('', `$${h4(r.start)}-$${h4(r.end - 1)}:${r.traced ? '' : ' (not traced: copied elsewhere before it runs, or not reached by the analysis)'}`);
    for (const s of script.steps.filter(x => x.jsr >= r.start && x.jsr < r.end)) {
      if (s.kind === 'side') side = s.side ?? null;
      const what = s.kind === 'load' ? unpacks?.(s, side) : null;
      out.push(`  ${boozeLine(s).padEnd(26)} ; $${h4(s.at)}${what ? `, ${what}` : ''}`);
    }
  }
  return out;
}
