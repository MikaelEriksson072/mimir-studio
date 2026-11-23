/* PETSCII animations that a player in the program draws frame by frame (spec 13.5b). The bytes of such an animation are
 * no packed program: nothing unpacks them into memory, the player reads one frame at a time and writes it to the screen.
 * So they are recognised here, read as the player reads them: where each frame starts and ends, and how many there are
 * (the loader's script tab says which files hold them).
 *
 * The player known so far is the one in The Pumpkins' Breadbin of Horror (side 1, Spindle job 13: the pumpkin growing
 * out of a sprout). Its frames are a stream of runs:
 * - a frame is runs up to a 0 byte; the position starts at 0, the screen's first character, in every frame;
 * - a run is a byte H: the position moves on by H & 15 first (15: the bytes after it are added too, as long as they are
 *   $ff, the first one that is not ending it and added as well), then H >> 4 indexes follow (0 is 256 to the player);
 * - an index x puts the screen code `chars[x]` and the colour `colours[x]` (two tables of the player) at the position,
 *   and the position moves on by one.
 * The player draws into the screen it is not showing after copying the one it shows there, so a frame is what changes
 * from the frame before; the first is drawn over a screen of spaces.
 *
 * The player is found by its code: the loop that writes a run (`lda (ptr),y / tax / lda chars,x / sta (scr),y /
 * lda colours,x / sta (col),y / iny / dec n / bne / jmp next`) and before it the run's header (`and #$0f / cmp #$0f /
 * beq`, `cpx #$ff / beq`, `lsr` four times into n). Where the frames start comes from the code that sets the stream
 * pointer (`lda #<start / sta ptr / lda #>start / sta ptr+1`), how many from the counter it sets beside it (the one the
 * code counts down after each call of the player: `jsr player / dec counter / bne`). Several starts are played in the
 * order of the state the code sets with them (a value it stores beside each of them into the same place), else in the
 * order they are in the code. */
import type { Addr } from '../types';
import { MODE_LEN, OPC } from '../cpu/opcodes';

/** instructions that leave A as it is (a value `lda #` loaded is still the one a `sta` after them stores) */
const KEEPS_A = new Set(['STA', 'STX', 'STY', 'LDX', 'LDY', 'INX', 'INY', 'DEX', 'DEY', 'INC', 'DEC', 'CLC', 'SEC', 'CLI', 'SEI', 'CLD', 'SED', 'CLV', 'NOP', 'CPX', 'CPY', 'CMP', 'BIT', 'TAX', 'TAY', 'PHA', 'PHP']);

/** frames read at most from a start the code does not count */
const MAX_FRAMES = 2000;
/** runs a frame has at most (a screen's worth of one-character runs and more) */
const MAX_RUNS = 1100;

export interface PetsciiPlayer {
  /** the loop that writes a run, and the start of the loop that reads the next run (the frame's first one too) */
  loop: Addr; next: Addr;
  /** what the code calls to draw a frame (null: no call found) */
  entry: Addr | null;
  /** the zero-page pointer into the stream; the counter of frames the code counts down after each call (null: none) */
  ptr: number; counter: number | null;
  /** its two tables: the screen code and the colour of each index (which is which is not told) */
  tables: [Addr, Addr];
}

export interface PetsciiSequence {
  /** where its first frame starts, and the code that sets it there */
  start: Addr; setAt: Addr;
  /** the frames the code plays from it (the counter it sets); null: not counted, read until the stream stops making sense,
   *  reaches another start or has a frame that changes nothing */
  count: number | null;
  /** its frames as read (fewer than `count` when the stream stops making sense) */
  frames: number;
}

export interface PetsciiFrame {
  /** its number in the order the frames are played (0 the first), its sequence and its number in the sequence */
  n: number; seq: number; k: number;
  /** its bytes in the stream */
  start: Addr; end: Addr;
  /** characters it writes */
  writes: number;
}

export interface PetsciiAnim {
  player: PetsciiPlayer;
  sequences: PetsciiSequence[];
  frames: PetsciiFrame[];
  /** the bytes the frames are in */
  start: Addr; end: Addr;
  /** why fewer frames were read than the code plays, or why there are none; null: all of them */
  problem: string | null;
}

const indexOf = (b: Uint8Array, p: number[]) => { for (let i = 0; i + p.length <= b.length; i++) if (p.every((x, k) => b[i + k] === x)) return i; return -1; };

/** where a frame ends and how many characters it writes; or why it is not one */
function readFrame(mem: Uint8Array, at: Addr, loaded: (a: Addr) => boolean): { end: Addr; writes: number } | { problem: string } {
  let writes = 0;
  let p = at, pos = 0;
  const byte = (a: Addr) => (loaded(a & 0xffff) ? mem[a & 0xffff] : -1);
  for (let runs = 0; ; runs++) {
    const h = byte(p);
    if (h < 0) return { problem: `$${hex(p & 0xffff)} is not loaded` };
    if (h === 0) return { end: (p + 1) & 0xffff, writes };
    if (runs >= MAX_RUNS) return { problem: `no end of the frame in ${MAX_RUNS} runs` };
    let y = 1, skip = h & 15;
    if (skip === 15) {
      skip = 0;
      for (;;) { const x = byte(p + y); if (x < 0) return { problem: `$${hex((p + y) & 0xffff)} is not loaded` }; skip += x; y++; if (x !== 0xff) break; }
    }
    const n = h >> 4 || 256;
    pos += skip;
    if (pos + n > 0x400) return { problem: `a run at $${hex(p & 0xffff)} writes past the screen` };
    for (let i = 0; i < n; i++, y++) {
      const x = byte(p + y);
      if (x < 0) return { problem: `$${hex((p + y) & 0xffff)} is not loaded` };
      writes++;
    }
    pos += n;
    p = (p + y) & 0xffff;
  }
}

const hex = (v: number) => v.toString(16).padStart(4, '0');

/**
 * The PETSCII animations of the players in `mem` (the first 64 KB), each with its frames in the order they are played.
 * `loaded`: the bytes that are in the program (others are never read as code, tables or frames).
 */
export function findPetsciiAnims(mem: Uint8Array, loaded: (a: Addr) => boolean = () => true): PetsciiAnim[] {
  const size = Math.min(mem.length, 0x10000), out: PetsciiAnim[] = [];
  const all = (a: Addr, n: number) => { for (let i = 0; i < n; i++) if (a + i >= size || !loaded(a + i)) return false; return true; };
  for (let a = 0; a + 21 <= size; a++) {
    // the loop that writes a run, its branch back to its start, then on to the next run
    if (mem[a] !== 0xb1 || mem[a + 2] !== 0xaa || mem[a + 3] !== 0xbd || mem[a + 6] !== 0x91 || mem[a + 8] !== 0xbd || mem[a + 11] !== 0x91
      || mem[a + 13] !== 0xc8 || mem[a + 14] !== 0xc6 || mem[a + 16] !== 0xd0 || mem[a + 18] !== 0x4c) continue;
    if (a + 18 + ((mem[a + 17] ^ 0x80) - 0x80) !== a || !all(a, 21)) continue;
    const ptr = mem[a + 1], n = mem[a + 15], next = mem[a + 19] | (mem[a + 20] << 8);
    if (next >= a || a - next > 160 || !all(next, a - next)) continue;
    // the run's header before it: the frame's end (a 0), the skip in the low nibble (15: more bytes), the count in the high
    const head = mem.subarray(next, a);
    if (indexOf(head, [0xb1, ptr, 0xd0]) < 0 || indexOf(head, [0x29, 0x0f, 0xc9, 0x0f, 0xf0]) < 0 || indexOf(head, [0xe0, 0xff, 0xf0]) < 0 || indexOf(head, [0x4a, 0x4a, 0x4a, 0x4a, 0x85, n]) < 0) continue;
    const t1 = mem[a + 4] | (mem[a + 5] << 8), t2 = mem[a + 9] | (mem[a + 10] << 8);

    // what calls it (a few bytes before the loop that reads a run: it clears the position first), and the frame counter
    // the code counts down right after the call
    const calls = new Map<Addr, number>();
    let counter: number | null = null;
    for (let b = 0; b + 3 <= size; b++) {
      if (mem[b] !== 0x20) continue;
      const t = mem[b + 1] | (mem[b + 2] << 8);
      if (t > next || next - t > 16 || !all(b, 3)) continue;
      calls.set(t, (calls.get(t) ?? 0) + 1);
      if (counter == null && mem[b + 3] === 0xc6 && mem[b + 5] === 0xd0 && all(b + 3, 3)) counter = mem[b + 4];
    }
    const entry = [...calls].sort((x, y) => y[1] - x[1] || x[0] - y[0])[0]?.[0] ?? null;

    // the code that sets the stream pointer, and what it stores beside it (up to its rts, jmp or rti)
    interface Setter { at: Addr; start: Addr; count: number | null; stores: Map<number, number> }
    const setters: Setter[] = [];
    for (let b = 0; b + 8 <= size; b++) {
      if (mem[b] !== 0xa9 || mem[b + 2] !== 0x85 || mem[b + 4] !== 0xa9 || mem[b + 6] !== 0x85) continue;
      const lo = mem[b + 3] === ptr && mem[b + 7] === ptr + 1 ? mem[b + 1] : mem[b + 3] === ptr + 1 && mem[b + 7] === ptr ? mem[b + 5] : -1;
      if (lo < 0 || !all(b, 8)) continue;
      const hi = mem[b + 3] === ptr ? mem[b + 5] : mem[b + 1];
      // the values it stores into zero page (`lda #v` and the `sta`s after it), instruction by instruction, up to the
      // first that leaves the stretch of code (rts, jmp, rti, a branch or a call)
      const stores = new Map<number, number>();
      let A: number | null = null;
      for (let c = b + 8, steps = 0; c < size && steps < 16; steps++) {
        const op = OPC[mem[c]], len = MODE_LEN[op.mode];
        if (op.flow !== 'seq' || !all(c, len)) break;
        if (mem[c] === 0xa9) A = mem[c + 1];
        else if (mem[c] === 0x85) { if (A != null && !stores.has(mem[c + 1])) stores.set(mem[c + 1], A); }
        else if (!KEEPS_A.has(op.mn)) A = null;
        c += len;
      }
      const count = counter != null && stores.has(counter) ? stores.get(counter)! || 256 : null;
      setters.push({ at: b, start: lo | (hi << 8), count, stores });
    }
    // played in the order of the state the code sets with each start (the same place in all of them), else as in the code
    const others = (s: Setter) => [...s.stores.keys()].filter(z => z !== ptr && z !== ptr + 1 && z !== counter);
    const state = setters.length > 1 ? others(setters[0]).find(z => setters.every(s => s.stores.has(z))) : undefined;
    if (state != null) setters.sort((x, y) => x.stores.get(state)! - y.stores.get(state)! || x.at - y.at);

    // the frames, in the order they are played
    const frames: PetsciiFrame[] = [];
    const sequences: PetsciiSequence[] = [];
    const starts = new Set(setters.map(s => s.start));
    let problem: string | null = setters.length ? null : 'the code never sets where the frames start';
    setters.forEach((s, seq) => {
      let p = s.start, k = 0;
      for (; k < (s.count ?? MAX_FRAMES); k++) {
        // a start the code does not count ends where another one begins
        if (s.count == null && k > 0 && starts.has(p)) break;
        const f = readFrame(mem, p, a => a < size && loaded(a));
        if ('problem' in f) { if (s.count != null || k === 0) problem ??= `frame ${k + 1} from $${hex(s.start)}: ${f.problem}`; break; }
        // (not counted: a frame that changes nothing is taken as the end, so zeros after the stream are no frames)
        if (s.count == null && !f.writes) break;
        frames.push({ n: frames.length, seq, k, start: p, end: f.end, writes: f.writes });
        p = f.end;
      }
      sequences.push({ start: s.start, setAt: s.at, count: s.count, frames: k });
    });
    const startAt = frames.length ? Math.min(...frames.map(f => f.start)) : setters[0]?.start ?? next;
    const endAt = frames.length ? Math.max(...frames.map(f => (f.end < f.start ? 0x10000 : f.end))) : startAt;
    out.push({ player: { loop: a, next, entry, ptr, counter, tables: [t1, t2] }, sequences, frames, start: startAt, end: endAt, problem: frames.length ? problem : problem ?? 'no frame could be read' });
    a += 20;
  }
  return out;
}
