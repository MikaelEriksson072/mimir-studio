/* The files of a disk for DLoC's loader (spec 13.5n): the loader Six of Dark Lords of Chaos wrote for the group's
 * Halloween 2026 ("our own assembler, our own packer, our own loader", the release's notes say), read from that demo's
 * disk, as its source is not public.
 *
 * The disk is an ordinary DOS disk: the C64 asks for a file by its name (A its length, X and Y where it is), and code
 * in the drive finds it in the directory (the first closed PRG whose name starts with those bytes) and sends its
 * sectors as the DOS chains them, each block its length first (0 ends the file, $ff: not found). The C64 calls the
 * loader through a table of jumps at $fc00:
 * - $fc00 loads a file, unpacks it while it loads and starts it: the file is where it unpacks to (2 bytes), where it
 *   starts (2 bytes), then a ZX0 stream in ZX0's first format (bits from the top of a byte; a new offset's high part
 *   + 1 as an interlaced Elias gamma with its bits as they are, 256 ending the stream; its low byte's 7 bits and the
 *   length's first bit; then the length - 1). A part ends by loading the next with `lda #length / ldx #<name / ldy
 *   #>name / jmp $fc00`;
 * - $fc03 opens a file (carry clear: to its load address, set: to the address in $fb/$fc), $fc06 reads A bytes more of
 *   it, so a part can read a file as it plays; such files are not packed;
 * - $fc09 unpacks a ZX0 stream from memory (X and Y point at where it unpacks to, then the stream);
 * - $fc0c and $fc0f call the program (before and after a load).
 * The transfer is 2 bits at a time with ATN as the clock (the C64 writes $dd00, the drive waits on bit 7 of $1800),
 * the name goes to the drive on DATA with CLK as the clock; the drive reads the sectors' GCR itself.
 *
 * The boot is a BASIC program that LOAD"*",8 and RUN load: packed with Six's packer, a self-extracting file whose
 * first code moves the stream to the top of memory and unpacks it with the same ZX0 code at $0100. What it unpacks
 * installs the loader (M-W of the drive code to $0300-$06ff and $0745-$07fd, M-E $0300), copies the resident part to
 * $fc00 and loads the first part. This reads that too: the boot unpacked, the loader's code in it, and its first load.
 *
 * There is no load script: each part names the next. What is read back is the calls in the parts' code: the loads
 * with the name in A, X and Y, and, where a part opens files through a table of its own, the names of the disk's
 * files in its memory. Followed from the boot they give the order the parts load in. */
import type { Addr } from '../types';
import { diskSectors, parseD64, petsciiName, sectorOffset, sectorsOnTrack, type D64FileType } from './d64';

/** where the resident part's table of jumps is, when no code on the disk says otherwise */
export const DLOC_BASE = 0xfc00;

/** the routines of the table of jumps, by their offset in it */
export type DlocRoutine = 'load' | 'open' | 'read' | 'unpack';
const ROUTINES: DlocRoutine[] = ['load', 'open', 'read', 'unpack'];
/** what each routine does, as the tab and the script say it */
export const DLOC_ROUTINE: Record<DlocRoutine, string> = {
  load: 'loads it, unpacks it while it loads and starts it',
  open: 'opens it, to be read a few bytes at a time',
  read: 'reads A bytes more of the open file',
  unpack: 'unpacks a ZX0 stream in memory',
};

/** A file the loader unpacks while it loads: where it goes and where it starts. */
export interface DlocUnpacked { start: Addr; end: Addr; run: Addr; bytes: Uint8Array }

/** The boot, unpacked as Six's self-extracting packer unpacks it. */
export interface DlocBoot {
  start: Addr; end: Addr; bytes: Uint8Array;
  /** where its first code jumps when the unpacking is done */
  run: Addr;
  /** where the stream is moved to and unpacked from */
  stream: Addr;
}

export interface DlocFile {
  /** its directory entry (from 0) */
  entry: number;
  /** every byte of it, the load address first, as the drive sends them */
  data: Uint8Array;
  load: Addr;
  /** its sectors, in the order of its chain */
  sectors: [number, number][];
  /** packed for $fc00: what it unpacks to; null: not packed so */
  unpacked: DlocUnpacked | null;
  /** a BASIC program at $0801 (a line, then a token): the boot, loaded with LOAD */
  basic: boolean;
  /** packed with Six's self-extracting packer: what it unpacks to */
  boot: DlocBoot | null;
  /** the loader's own code is in it (as it is, unpacked, or in what its boot unpacks to) */
  code: boolean;
}

export interface DlocEntry {
  n: number;
  name: string; raw: Uint8Array;
  type: D64FileType; closed: boolean;
  blocks: number;
  track: number; sector: number;
  file: DlocFile | null;
}

/** A call of the loader in a file's code. */
export interface DlocCall {
  /** the file whose code holds it (its entry), where its first instruction is, and its jsr or jmp */
  in: number; at: Addr; jsr: Addr; jmp: boolean;
  /** the routine it calls, and its address */
  routine: DlocRoutine; to: Addr;
  /** what it asks for: A, X and Y as the code sets them (null: not right before the call) */
  a: number | null; x: number | null; y: number | null;
  /** clc (0) or sec (1) right before it: open puts the file at its load address, or at the address in $fb/$fc */
  carry: 0 | 1 | null;
  /** the file it names (its entry; null: none of the disk's, or the registers are not set right before it) */
  file: number | null;
  /** the name's bytes as the call gives them (A of them from X/Y) */
  name: Uint8Array | null;
}

/** A file's name in the memory of a part that opens or loads files through a table of its own. */
export interface DlocName { in: number; at: Addr; file: number }

export interface DlocDisk {
  /** what shows it is a disk for the loader: its code in a file (or in what the boot unpacks to), or files packed so */
  found: 'code' | 'files';
  /** where the table of jumps is ($fc00) */
  base: Addr;
  entries: DlocEntry[];
  files: DlocFile[];
  calls: DlocCall[];
  names: DlocName[];
  /** the order the files load in, followed from the boot through the loads (entries); the files the parts open
   *  follow the part that opens them */
  order: number[];
  header: string; id: string;
  /** BAM bytes $90-$9f and $a2-$a3: the header and the id as stored */
  headerRaw: Uint8Array; idRaw: Uint8Array;
}

const hx = (v: number, w: number) => v.toString(16).padStart(w, '0');

// ---- ZX0 --------------------------------------------------------------------------------------------------------

/**
 * A ZX0 stream in its first format unpacked into `mem` at `dest`, read from `src` from `at` up to `end` (src may be
 * mem itself, as when the boot unpacks itself): where the unpacking ended and where the reading did; null when the
 * bytes are not such a stream (past the end, past $ffff, a copy from before $0000).
 */
export function unpackZx0(src: Uint8Array, at: number, end: number, mem: Uint8Array, dest: Addr): { end: Addr; read: number } | null {
  let s = at, d = dest, mask = 0, bits = 0, last = 1;
  const byte = () => { if (s >= end) throw new RangeError('past the end'); return src[s++]; };
  const bit = () => { if (!(mask >>= 1)) { mask = 0x80; bits = byte(); } return bits & mask ? 1 : 0; };
  const elias = (skip: boolean) => { let v = 1; while (skip || !bit()) { skip = false; v = (v << 1) | bit(); if (v > 0xffff) throw new RangeError('no number'); } return v; };
  const copy = (n: number) => {
    if (d - last < 0 || d + n > 0x10000) throw new RangeError('out of memory');
    for (let i = 0; i < n; i++, d++) mem[d] = mem[d - last];
  };
  try {
    let state: 'lit' | 'rep' | 'match' = 'lit';
    for (;;) {
      if (state === 'lit') {
        const n = elias(false);
        if (d + n > 0x10000) return null;
        for (let i = 0; i < n; i++) mem[d++] = byte();
        state = bit() ? 'match' : 'rep';
      } else if (state === 'rep') {
        copy(elias(false));
        state = bit() ? 'match' : 'lit';
      } else {
        const hi = elias(false);
        // (the loader looks at the low byte: 256 ends the stream)
        if ((hi & 0xff) === 0) return { end: d, read: s };
        const b = byte();
        const n = b & 1 ? 2 : elias(true) + 1;
        last = hi * 128 - (b >> 1);
        copy(n);
        state = bit() ? 'match' : 'lit';
      }
    }
  } catch { return null; }
}

/** A file as $fc00 unpacks it: where it unpacks to, where it starts, then the stream, which must end with the file
 *  and start the program inside what it unpacks to; null when it is not one. */
export function unpackDlocFile(data: Uint8Array): DlocUnpacked | null {
  if (data.length < 6) return null;
  const start = data[0] | (data[1] << 8), run = data[2] | (data[3] << 8);
  const mem = new Uint8Array(0x10000);
  const r = unpackZx0(data, 4, data.length, mem, start);
  if (!r || r.read !== data.length || r.end <= start || run < start || run >= r.end) return null;
  return { start, end: r.end, run, bytes: mem.slice(start, r.end) };
}

// ---- the boot and the loader's code -----------------------------------------------------------------------------

type Pattern = (number | null)[];
const pat = (s: string): Pattern => s.split(' ').map(t => (t === '..' ? null : parseInt(t, 16)));
const findIn = (b: ArrayLike<number>, p: Pattern, from = 0, to = b.length): number[] => {
  const out: number[] = [];
  for (let i = from; i + p.length <= to; i++) if (p.every((v, k) => v == null || b[i + k] === v)) out.push(i);
  return out;
};

/** Six's self-extracting file: it copies its unpacking code to $0100 and $0180, moves the stream's pages to the top of
 *  memory, sets where it reads (2 zero-page bytes) and writes (2 more), and jumps to $0100 */
const SFX = pat('A2 FF 9A 78 A9 .. 85 01 A2 00 BD .. .. 9D 00 01 E8 E0 .. D0 F5 A2 00 BD .. .. 9D .. 01 E8 E0 .. D0 F5 A2 .. A0 00 B9 .. .. 99 .. .. C8 D0 F7 EE .. .. EE .. .. CA D0 EE A9 .. 85 .. A9 .. 85 .. A9 .. 85 .. A9 .. 85 .. 4C 00 01');

/** A file packed with Six's self-extracting packer, unpacked as its code unpacks it; null when it is not one. */
export function unpackDlocBoot(data: Uint8Array): DlocBoot | null {
  if (data.length < 4) return null;
  const load = data[0] | (data[1] << 8), body = data.subarray(2, 2 + Math.max(0, 0x10000 - load));
  const i = findIn(body, SFX, 0, Math.min(body.length, 0x100))[0];
  if (i == null) return null;
  const mem = new Uint8Array(0x10000);
  mem.set(body, load);
  const at = load + i, w = (o: number) => mem[at + o] | (mem[at + o + 1] << 8);
  const stub = (o: number) => mem.subarray(w(o), w(o) + mem[at + o + 7]);
  // the unpacking code's end: lda #$37 / sta $01 / cli / jmp to the program
  const code = [stub(11), stub(24)];
  let run: number | null = null;
  for (const c of code) { const j = findIn(c, pat('85 01 58 4C'))[0]; if (j != null && j + 6 <= c.length) { run = c[j + 4] | (c[j + 5] << 8); break; } }
  if (run == null) return null;
  // the pages moved up, from the first as the code does it
  const pages = mem[at + 35] || 256, from = w(39), to = w(42);
  if (to + pages * 256 > 0x10000) return null;
  for (let k = 0; k < pages * 256; k++) mem[to + k] = mem[from + k];
  const stream = mem[at + 57] | (mem[at + 61] << 8), dest = mem[at + 65] | (mem[at + 69] << 8);
  const r = unpackZx0(mem, stream, 0x10000, mem, dest);
  if (!r || r.end <= dest) return null;
  return { start: dest, end: r.end, bytes: mem.slice(dest, r.end), run, stream };
}

/** the loader's own code: the C64's receive loop (four reads of $dd00, ATN written as the clock) and the drive's
 *  send (a nibble from a table, two bit pairs on $1800 as ATN turns) */
const CODE: Pattern[] = [
  pat('A5 .. 8D 00 DD 20 .. .. EA EA EA AD 00 DD A6 .. 8E 00 DD 29 C0 85'),
  pat('BD .. 07 2C 00 18 10 FB 8D 00 18 BD .. 07 2C 00 18 30 FB 8D 00 18'),
];
/** the table of jumps at the resident part's start, then the load routine (sei / sta / stx / sty) */
const TABLE = pat('4C .. .. 4C .. .. 4C .. .. 4C .. .. 4C .. .. 4C .. .. 78 8D .. .. 8E .. .. 8C');

const codeIn = (b: Uint8Array): boolean => CODE.some(p => findIn(b, p).length > 0);

/** where the table of jumps runs: its first jump goes to the code right after it */
function baseIn(b: Uint8Array): Addr | null {
  for (const i of findIn(b, TABLE)) { const t = b[i + 1] | (b[i + 2] << 8); if (t >= 0x12) return t - 0x12; }
  return null;
}

/** The file's bytes as memory: unpacked, what its boot unpacks to, else where it loads. */
function visible(f: DlocFile): { at: Addr; bytes: Uint8Array } | null {
  if (f.unpacked) return { at: f.unpacked.start, bytes: f.unpacked.bytes };
  if (f.boot) return { at: f.boot.start, bytes: f.boot.bytes };
  return f.data.length > 2 ? { at: f.load, bytes: f.data.subarray(2, 2 + Math.max(0, 0x10000 - f.load)) } : null;
}

/** The calls of the loader in the files' code, and the names of the disk's files in the parts that call it with
 *  registers that are not set right before. */
function findCalls(files: DlocFile[], entries: DlocEntry[], base: Addr): { calls: DlocCall[]; names: DlocName[] } {
  const prgs = entries.filter(e => e.file && e.type === 'PRG' && e.closed);
  /** the drive's search: the first closed PRG whose name starts with these bytes */
  const named = (b: Uint8Array) => b.length && b.length <= 16 ? prgs.find(e => b.every((c, i) => e.raw[i] === c)) : undefined;
  const calls: DlocCall[] = [], names: DlocName[] = [];
  for (const f of files) {
    const v = visible(f);
    if (!v) continue;
    const end = v.at + v.bytes.length, mem = new Uint8Array(0x10000);
    mem.set(v.bytes, v.at);
    for (let j = v.at; j + 2 < end; j++) {
      if (mem[j] !== 0x20 && mem[j] !== 0x4c) continue;
      const k = (mem[j + 1] | (mem[j + 2] << 8)) - base;
      if (k < 0 || k > 9 || k % 3) continue;
      const routine = ROUTINES[k / 3];
      // the immediate loads of A, X and Y just before it, and the carry (clc or sec: where open puts the file)
      const regs: Record<'a' | 'x' | 'y', number | null> = { a: null, x: null, y: null };
      let at = j, carry: 0 | 1 | null = null;
      // (an immediate load before a clc or sec, as `ldy #$38` ends in the byte of sec; the carry only right before the
      // call, as an earlier $18 can be a branch's operand)
      for (let n = 0; n < 4 && at - 1 >= v.at; n++) {
        const op = at - 2 >= v.at ? mem[at - 2] : -1, r = op === 0xa9 ? 'a' : op === 0xa2 ? 'x' : op === 0xa0 ? 'y' : null;
        if (r && regs[r] == null) { regs[r] = mem[at - 1]; at -= 2; continue; }
        if (n === 0 && (mem[at - 1] === 0x18 || mem[at - 1] === 0x38)) { carry = mem[at - 1] === 0x38 ? 1 : 0; at--; continue; }
        break;
      }
      let name: Uint8Array | null = null, file: number | null = null;
      if ((routine === 'load' || routine === 'open') && regs.a != null && regs.x != null && regs.y != null) {
        const p = regs.x | (regs.y << 8);
        if (regs.a >= 1 && regs.a <= 16 && p >= v.at && p + regs.a <= end) { name = mem.slice(p, p + regs.a); file = named(name)?.n ?? null; }
      }
      calls.push({ in: f.entry, at, jsr: j, jmp: mem[j] === 0x4c, routine, to: base + k, ...regs, carry, file, name });
    }
  }
  // a part that loads or opens with registers it does not set right before: the names in it of the disk's files that
  // no call loads as a part (nor the boot)
  const parts = new Set(calls.flatMap(c => (c.routine === 'load' && c.file != null ? [c.file] : [])));
  for (const f of files) {
    const v = visible(f);
    if (!v || !calls.some(c => c.in === f.entry && (c.routine === 'load' || c.routine === 'open') && c.file == null)) continue;
    const found: DlocName[] = [];
    for (const e of prgs) {
      if (e.n === f.entry || parts.has(e.n) || e.file!.basic || calls.some(c => c.in === f.entry && c.file === e.n)) continue;
      let len = 16;
      while (len > 0 && e.raw[len - 1] === 0xa0) len--;
      if (len < 2) continue;
      const at = findIn(v.bytes, [...e.raw.subarray(0, len)])[0];
      if (at != null) found.push({ in: f.entry, at: v.at + at, file: e.n });
    }
    names.push(...found.sort((a, b) => a.at - b.at));
  }
  return { calls, names };
}

// ---- the disk ---------------------------------------------------------------------------------------------------

/** The directory and files of a disk for DLoC's loader; null when it is not one. */
export function readDlocDisk(disk: Uint8Array): DlocDisk | null {
  let image: Uint8Array, img: ReturnType<typeof parseD64>;
  try { image = diskSectors(disk); img = parseD64(image); } catch { return null; }
  const tracks = img.tracks;
  const sec = (t: number, s: number) => { const o = sectorOffset(t, s, tracks); return image.subarray(o, o + 256); };
  const chain = (t: number, s: number): { sectors: [number, number][]; data: Uint8Array } | null => {
    const sectors: [number, number][] = [], parts: Uint8Array[] = [], seen = new Set<number>();
    while (t) {
      if (t > tracks || s >= sectorsOnTrack(t) || seen.has(t * 32 + s)) return null;
      seen.add(t * 32 + s);
      sectors.push([t, s]);
      const b = sec(t, s);
      parts.push(b[0] ? b.subarray(2) : b.subarray(2, Math.max(b[1], 1) + 1));
      [t, s] = [b[0], b[1]];
    }
    const data = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of parts) { data.set(p, o); o += p.length; }
    return { sectors, data };
  };
  const entries = img.files.map((f, n): DlocEntry => {
    const e: DlocEntry = { n, name: f.name, raw: f.raw, type: f.type, closed: f.closed, blocks: f.blocks, track: f.track, sector: f.sector, file: null };
    if (!f.track || f.type === 'DEL' || (f.track === 18 && f.sector === 0)) return e;
    const c = chain(f.track, f.sector);
    if (!c || c.data.length < 2) return e;
    const data = c.data, load = data[0] | (data[1] << 8), rest = data.subarray(2);
    const link = rest[0] | (rest[1] << 8);
    const basic = load === 0x0801 && rest.length >= 6 && link > 0x0805 && link <= 0x0801 + rest.length && rest[4] >= 0x80;
    const file: DlocFile = { entry: n, data, load, sectors: c.sectors, unpacked: basic ? null : unpackDlocFile(data), basic, boot: basic ? unpackDlocBoot(data) : null, code: false };
    const v = visible(file);
    file.code = !!v && codeIn(v.bytes);
    e.file = file;
    return e;
  });
  const files = entries.flatMap(e => (e.file ? [e.file] : []));
  // (no code and fewer than two packed files can be no such disk: the calls are not looked for)
  if (!files.some(f => f.code) && files.filter(f => f.unpacked).length < 2) return null;
  let base: Addr | null = null;
  for (const f of files) { const v = visible(f); if (v && f.code) base ??= baseIn(v.bytes); }
  base ??= DLOC_BASE;
  const { calls, names } = findCalls(files, entries, base);
  const code = files.some(f => f.code);
  // files the parts load or open by name are the loader's even when they are not packed
  const used = new Set([...calls.map(c => c.file), ...names.map(n => n.file)]);
  const packed = files.filter(f => f.unpacked).length, other = files.filter(f => !f.unpacked && !f.basic && !f.code && !used.has(f.entry)).length;
  if (!code && !(packed >= 2 && packed >= 2 * other)) return null;

  // the order: from the boot (the BASIC program, else the first file), each part's loads, the files it opens after it
  const order: number[] = [];
  const first = files.find(f => f.basic && (f.boot || f.code)) ?? files.find(f => f.basic) ?? files[0];
  const visit = (n: number) => {
    if (order.includes(n)) return;
    order.push(n);
    const opened = [...calls.filter(c => c.in === n && c.routine === 'open' && c.file != null).map(c => c.file!), ...names.filter(x => x.in === n).map(x => x.file)];
    for (const o of opened) if (!order.includes(o) && !calls.some(c => c.routine === 'load' && c.file === o)) order.push(o);
    for (const c of calls) if (c.in === n && c.routine === 'load' && c.file != null) visit(c.file);
  };
  if (first) visit(first.entry);
  const bam = sec(18, 0);
  return {
    found: code ? 'code' : 'files', base, entries, files, calls, names, order,
    header: img.name, id: petsciiName(bam.subarray(0xa2, 0xa4)), headerRaw: bam.slice(0x90, 0xa0), idRaw: bam.slice(0xa2, 0xa4),
  };
}

// ---- names, PRGs and the script ---------------------------------------------------------------------------------

/** A file's local name: its name on the disk in lower case (other characters as _), with its entry when another file
 *  of the disk has the same, `.zx0` for a packed file as it is on the disk, else `.prg`. */
export function dlocFileName(f: DlocFile, disk: DlocDisk): string {
  const stem = (n: number) => disk.entries[n].name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'file';
  const s = stem(f.entry), twice = disk.files.some(g => g !== f && stem(g.entry) === s);
  return `${twice ? `${hx(f.entry, 2)}_` : ''}${s}.${f.unpacked ? 'zx0' : 'prg'}`;
}

/** The name of a packed file (or the boot) unpacked: a PRG at where it unpacks to. */
export function dlocUnpackedName(f: DlocFile, disk: DlocDisk): string {
  const u = f.unpacked ?? f.boot;
  return dlocFileName(f, disk).replace(/\.[a-z0-9]+$/, u ? `_${hx(u.start, 4)}.prg` : '.prg');
}

/** A file as a PRG: unpacked at where it unpacks to (the boot: what its packer unpacks it to), else as it is. */
export function dlocFilePrg(f: DlocFile): Uint8Array {
  const u = f.unpacked ?? f.boot;
  if (!u) return f.data.slice(0, Math.min(f.data.length, 2 + 0x10000 - f.load));
  const out = new Uint8Array(u.bytes.length + 2);
  out[0] = u.start & 0xff; out[1] = u.start >> 8;
  out.set(u.bytes, 2);
  return out;
}

/** The disk's summary: what is packed, the calls, the order. */
export function dlocSummary(d: DlocDisk): string {
  const packed = d.files.filter(f => f.unpacked).length, loads = d.calls.filter(c => c.file != null).length;
  const parts = d.order.filter(n => n === d.order[0] || d.calls.some(c => c.routine === 'load' && c.file === n));
  const read = d.order.filter(n => !parts.includes(n)).map(n => d.entries[n].name);
  const chain = parts.length > 1 ? `; ${parts.map(n => d.entries[n].name).join(' → ')}${read.length ? ` (a part reads ${read.join(', ')})` : ''}` : '';
  return `${packed} file${packed === 1 ? '' : 's'} packed with ZX0, ${loads} load call${loads === 1 ? '' : 's'} read from the code${chain}`;
}

/** A call as the script says it: `lda #$05 / ldx #<name / ldy #>name / jmp $fc00 ("INTRO")`. */
export function dlocCallText(c: DlocCall, disk: DlocDisk): string {
  const regs = [c.a != null && `lda #$${hx(c.a, 2)}`, c.x != null && (c.name ? 'ldx #<name' : `ldx #$${hx(c.x, 2)}`), c.y != null && (c.name ? 'ldy #>name' : `ldy #$${hx(c.y, 2)}`), c.carry != null && (c.carry ? 'sec' : 'clc')].filter(Boolean);
  const what = c.file != null ? ` ("${disk.entries[c.file].name}")` : c.name ? ` ("${petsciiName(c.name)}": no file of the disk)` : '';
  return `${[...regs, `${c.jmp ? 'jmp' : 'jsr'} $${hx(c.to, 4)}`].join(' / ')}${what}`;
}

/** c1541's name for a file: PETSCII letters as ASCII lower case (c1541 turns them back), digits and most punctuation
 *  as they are; null when a byte cannot be written so. */
export function c1541Name(raw: Uint8Array): string | null {
  let end = raw.length;
  while (end > 0 && raw[end - 1] === 0xa0) end--;
  let s = '';
  for (const b of raw.subarray(0, end)) {
    if (b >= 0x41 && b <= 0x5a) s += String.fromCharCode(b + 0x20);
    else if (b >= 0x20 && b < 0x41 && b !== 0x22 && b !== 0x2c && b !== 0x3a) s += String.fromCharCode(b);
    else return null;
  }
  return s;
}

/** The script: what each file is in the order they load, and the c1541 command line that writes the disk again. */
export interface DlocScript {
  /** what the disk is and each file, as comments */
  notes: string[];
  /** c1541 writing the disk again with the files saved by their local names */
  command: string;
}

export function dlocScript(disk: DlocDisk, name: string): DlocScript {
  const n = disk.files.length, packed = disk.files.filter(f => f.unpacked).length;
  const base = name.replace(/\.[dg]64$/i, ''), at = (a: Addr) => `$${hx(a, 4)}`;
  const notes = [
    `DLoC's loader (Six/Dark Lords of Chaos), read by Mimir Studio from ${name}: ${n} file${n === 1 ? '' : 's'}, ${packed} of them packed with ZX0.`,
    `The loader has no load script: a part loads the next by its name (lda #length / ldx #<name / ldy #>name / jmp ${at(disk.base)}),`,
    'so the calls in the parts\' code are the script. In the order they load:',
  ];
  const rest = disk.entries.filter(e => e.file && !disk.order.includes(e.n)).map(e => e.n);
  for (const e of [...disk.order, ...rest].map(k => disk.entries[k])) {
    const f = e.file!, u = f.unpacked, label = `"${e.name}"`.padEnd(19);
    if (rest[0] === e.n) notes.push('  not loaded by any call read from the code:');
    const what = f.boot ? `the boot (LOAD and RUN), packed with Six's packer: unpacks itself to ${at(f.boot.start)}-${at(f.boot.end - 1)} and starts at ${at(f.boot.run)}`
      : f.basic ? 'a BASIC program, loaded with LOAD and RUN'
      : u ? `unpacks to ${at(u.start)}-${at(u.end - 1)} while it loads (${u.bytes.length} bytes from ${f.data.length}), starts at ${at(u.run)}`
      : `not packed: ${at(f.load)}-${at(Math.min(f.load + f.data.length - 2, 0x10000) - 1)}`;
    notes.push(`  ${label} ${what}${f.code ? "; the loader's own code" : ''}`);
    for (const c of disk.calls.filter(x => x.in === e.n)) {
      const to = c.file != null ? `"${disk.entries[c.file].name}"` : c.name ? `"${petsciiName(c.name)}" (no file of the disk)` : null;
      if (c.routine === 'load' || c.routine === 'open') notes.push(`      ${at(c.at)}: ${c.routine === 'load' ? 'loads' : 'opens'} ${to ?? 'a file the registers name (set elsewhere)'}`);
      else notes.push(`      ${at(c.at)}: ${c.routine === 'read' ? 'reads on in the open file' : 'unpacks a ZX0 stream in memory'}`);
    }
    for (const x of disk.names.filter(y => y.in === e.n)) notes.push(`      ${at(x.at)}: the name "${disk.entries[x.file].name}" (what it opens)`);
  }
  const writes = disk.entries.filter(e => e.file).map(e => `-write ${dlocFileName(e.file!, disk)} "${c1541Name(e.raw) ?? '?'}"`);
  notes.push('The disk is an ordinary DOS disk (the drive finds each file in the directory and follows its sectors), so c1541 writes it',
    'again from the files as they are on it; a part packed again: zx0 -c (the first format), its address and start in front.');
  const command = `c1541 -format "${c1541Name(disk.headerRaw) ?? 'disk'},${c1541Name(disk.idRaw) ?? '00'}" d64 ${base}.d64 ${writes.join(' ')}`;
  return { notes, command };
}

/** The script as text, as the tab shows it: the notes as comments, then the command line. */
export const dlocScriptText = (s: DlocScript): string[] => [...s.notes.map(l => `; ${l}`), '', s.command];
