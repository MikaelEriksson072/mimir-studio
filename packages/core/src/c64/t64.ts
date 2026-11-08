/* T64 tape archives (.t64, spec 13.5j): the files of a tape, not its pulses, as the C64S emulator kept them.
 *
 * A T64 is a 64-byte header (a signature line padded with zeros to 32 bytes: "C64 tape image file", "C64S tape file"
 * or "C64S tape image file"; the version, $0100 or $0101; how many entries the directory has room for and how many it
 * says are used; the tape's name, 24 bytes of PETSCII), then the directory, 32 bytes an entry: the C64S type (0 a free
 * entry, 1 a tape file, 3 and others a memory snapshot of C64S, with no 1541 type), the 1541 file type ($82 PRG
 * mostly; any is taken as a program), the start and end address (the end exclusive, as a tape header has it), the
 * file's offset in the T64, and its name (16 bytes of PETSCII padded with spaces). The data follows the directory,
 * each file's bytes without a load address.
 *
 * Many T64s in the wild disagree with themselves: the directory says no entry is used while it holds one, and an old
 * converter wrote $C3C6 as every file's end. So every entry of type 1 is a file, used or not (as VICE takes them),
 * and a file is as long as its end says only when its bytes are there and the end is not $C3C6: else it is what lies
 * up to the next file's offset (or the end of the T64). Of the 63 090 T64s of the reference archive (67 249 files),
 * 89 say no entry is used, 54 files end at $C3C6 and 37 more where their bytes are not.
 *
 * In Mimir a T64 goes in the datasette as a TAP does (MountedTape): its files open, Sindri's LOAD from the tape reads
 * them, and Build & Run writes the files built from it back (writeT64). */
import { petsciiName } from './d64';
import type { TapeFile, TapeImage } from './tap';

const hex4 = (v: number) => v.toString(16).padStart(4, '0');

/** The T64's header: its signature line, version, room in the directory and the entries it says are used, its name. */
export interface T64Info {
  signature: string;
  version: number;
  max: number;
  used: number;
  name: string;
  /** the 24 name bytes as stored */
  raw: Uint8Array;
}

/** A directory entry (TapeFile.t64): its slot (from 0), its C64S type, its 1541 file type, the end address it gives. */
export interface T64Entry { slot: number; type: number; fileType: number; end: number }

const DIR = 0x40, ENTRY = 32;

/** A .t64 tape archive, known by its header: "C64" and "tape" in the signature line ("C64S tape image file", "C64
 *  tape image file", "C64S tape file"), not a TAP's "C64-TAPE-RAW" (a TAP named .t64 is read as a TAP). */
export function isT64(u8: Uint8Array): boolean {
  if (u8.length < DIR + ENTRY) return false;
  const sig = String.fromCharCode(...u8.subarray(0, 32)).replace(/\0.*$/s, '');
  return /^C64/.test(sig) && /tape/i.test(sig) && !sig.startsWith('C64-TAPE-RAW');
}

/** an entry of the directory: a tape file (type 1), or a C64S snapshot (another type, no 1541 type); anything else in
 *  a slot is no entry */
const isEntry = (u8: Uint8Array, e: number) => u8[e] === 1 || (u8[e] > 1 && u8[e + 1] === 0);

const word = (u8: Uint8Array, at: number) => u8[at] | (u8[at + 1] << 8);
const long = (u8: Uint8Array, at: number) => (u8[at] | (u8[at + 1] << 8) | (u8[at + 2] << 16) | (u8[at + 3] << 24)) >>> 0;
/** a name padded with spaces (or $a0, or zeros), as text */
const nameOf = (raw: Uint8Array) => petsciiName(raw.map(v => (v === 0x20 || v === 0 ? 0xa0 : v))).trimEnd();

/** The header of a .t64. */
export function t64Info(u8: Uint8Array): T64Info {
  if (!isT64(u8)) throw new Error('not a .t64 tape archive: its header does not start with "C64" and name a tape');
  const raw = u8.slice(0x28, 0x40);
  return {
    // (its first line: "C64S tape file" can go on with a line of its own, "*Conv 64*")
    signature: String.fromCharCode(...u8.subarray(0, 32)).replace(/[\0\r\n\x1a].*$/s, '').trimEnd(),
    version: word(u8, 0x20), max: word(u8, 0x22), used: word(u8, 0x24), name: nameOf(raw), raw,
  };
}

/** How many directory entries there are: as many as the header has room for, but not past the first file's data (a
 *  header with 0 room, or room for more than the T64 holds, is read up to there). */
function slotCount(u8: Uint8Array, max: number): number {
  const fit = Math.floor((u8.length - DIR) / ENTRY);
  let n = Math.min(max || fit, fit);
  // the directory ends where the first file's data starts
  let first = u8.length;
  for (let i = 0; i < n; i++) {
    const e = DIR + i * ENTRY, off = long(u8, e + 8);
    if (u8[e] === 1 && off >= DIR) first = Math.min(first, off);
  }
  n = Math.min(n, Math.max(1, Math.floor((first - DIR) / ENTRY)));
  return n;
}

/**
 * Read a .t64: its files in directory order (the order LOAD finds them on the tape), as tape files of the format
 * 't64'. `at` is the entry's slot and `to` the slot after it, where the tape stands once the file has loaded (as a
 * TAP's pulses, for Sindri's datasette); `offset` where its bytes start in the T64. A memory snapshot of C64S is
 * listed (type DATA, no load address), not opened.
 */
export function readT64(u8: Uint8Array): TapeImage {
  const info = t64Info(u8);
  const n = slotCount(u8, info.max);
  const entries: { slot: number; type: number; fileType: number; start: number; end: number; offset: number; raw: Uint8Array }[] = [];
  for (let i = 0; i < n; i++) {
    const e = DIR + i * ENTRY;
    if (!isEntry(u8, e)) continue;
    entries.push({ slot: i, type: u8[e], fileType: u8[e + 1], start: word(u8, e + 2), end: word(u8, e + 4), offset: long(u8, e + 8), raw: u8.slice(e + 16, e + 32) });
  }
  // each file's room: up to the next file's bytes (by offset), or the end of the T64
  const byOffset = [...entries].sort((a, b) => a.offset - b.offset);
  const room = new Map<number, number>(), last = new Set<number>();
  byOffset.forEach((e, k) => {
    let next = u8.length;
    for (let j = k + 1; j < byOffset.length; j++) if (byOffset[j].offset > e.offset) { next = byOffset[j].offset; break; }
    if (next >= u8.length) last.add(e.slot);
    room.set(e.slot, Math.max(0, Math.min(next, u8.length) - e.offset));
  });
  const files: TapeFile[] = entries.map(e => {
    const errors: string[] = [];
    let note: string | undefined;
    const name = nameOf(e.raw) || '(no name)';
    const t64: T64Entry = { slot: e.slot, type: e.type, fileType: e.fileType, end: e.end };
    const base = { format: 't64' as const, name, raw: e.raw, at: e.slot, to: e.slot + 1, offset: e.offset, seconds: 0, id: e.slot + 1, t64 };
    // a C64S memory snapshot ("FRZ"): the C64S type above 1 and no 1541 type
    if (e.type !== 1) {
      const have = room.get(e.slot) ?? 0;
      return { ...base, type: 'DATA', load: null, end: null, data: u8.slice(e.offset, e.offset + have), errors, note: `a C64S memory snapshot (entry type ${e.type}), not a program` };
    }
    if (e.offset < DIR + n * ENTRY || e.offset >= u8.length) {
      errors.push(e.offset >= u8.length ? `its bytes would start at $${e.offset.toString(16)}, past the end of the T64 ($${u8.length.toString(16)})` : `its bytes would start at $${e.offset.toString(16)}, inside the directory`);
      return { ...base, type: 'PRG', load: e.start, end: e.start, data: new Uint8Array(0), errors };
    }
    const have = room.get(e.slot) ?? 0;
    // the length the directory gives: an end of 0 is $10000 (a file up to the top of memory)
    const said = e.end > e.start ? e.end - e.start : e.end === 0 ? 0x10000 - e.start : -1;
    let len: number;
    const upTo = last.has(e.slot) ? 'up to the end of the T64' : 'up to the next file';
    if (said < 0) { len = Math.min(have, 0x10000 - e.start); note = `the directory gives $${hex4(e.start)}-$${hex4(e.end)}, an end before its start: the ${len} bytes ${upTo} are taken`; }
    else if (e.end === 0xc3c6 && said !== have) { len = Math.min(have, 0x10000 - e.start); note = `the directory's end $c3c6 is wrong (an old converter wrote it for every file): the ${len} bytes ${upTo} are taken`; }
    else if (said > have) { len = Math.min(have, 0x10000 - e.start); note = `the directory gives $${hex4(e.start)}-$${hex4(e.end)} (${said} bytes), the T64 holds ${have}: those are taken`; }
    else len = said;
    return { ...base, type: 'PRG', load: e.start, end: e.start + len, data: u8.slice(e.offset, e.offset + len), errors, ...(note ? { note } : {}) };
  });
  return { version: info.version, pulses: 0, seconds: 0, files, unknown: [], tapetool: null, t64: info };
}

const SIGNATURE = 'C64S tape image file';

/** PETSCII of a name as typed: upper case, `n` bytes padded with spaces */
const petscii = (s: string, n: number) => { const b = new Uint8Array(n).fill(0x20); for (let i = 0; i < Math.min(n, s.length); i++) b[i] = s.toUpperCase().charCodeAt(i) & 0x7f; return b; };

/**
 * Write a .t64 (version $0101, "C64S tape image file") with these files in this order, each a tape file of type $82
 * (PRG): `raw` keeps a name's 16 bytes as they were (else `name` is taken as PETSCII upper case), `fileType` its 1541
 * type. A directory with room for exactly the files, the data one file after another.
 */
export function makeT64(o: { name?: string; raw?: Uint8Array; files: { name: string; raw?: Uint8Array; load: number; data: Uint8Array; fileType?: number; type?: number }[] }): Uint8Array {
  const n = Math.max(1, o.files.length);
  const size = DIR + n * ENTRY + o.files.reduce((a, f) => a + f.data.length, 0);
  const u8 = new Uint8Array(size);
  for (let i = 0; i < SIGNATURE.length; i++) u8[i] = SIGNATURE.charCodeAt(i);
  u8[0x20] = 0x01; u8[0x21] = 0x01;
  u8[0x22] = n & 0xff; u8[0x23] = n >> 8;
  u8[0x24] = o.files.length & 0xff; u8[0x25] = o.files.length >> 8;
  u8.set(o.raw ? o.raw.subarray(0, 24) : petscii(o.name ?? '', 24), 0x28);
  let off = DIR + n * ENTRY;
  o.files.forEach((f, i) => {
    const e = DIR + i * ENTRY, end = f.load + f.data.length;
    if (end > 0x10000) throw new Error(`"${f.name}" ends past $ffff`);
    u8[e] = f.type ?? 1; u8[e + 1] = f.fileType ?? 0x82;
    u8[e + 2] = f.load & 0xff; u8[e + 3] = f.load >> 8; u8[e + 4] = end & 0xff; u8[e + 5] = (end >> 8) & 0xff;
    u8[e + 8] = off & 0xff; u8[e + 9] = (off >> 8) & 0xff; u8[e + 10] = (off >> 16) & 0xff; u8[e + 11] = off >>> 24;
    u8.set(f.raw ? f.raw.subarray(0, 16) : petscii(f.name, 16), e + 16);
    u8.set(f.data, off);
    off += f.data.length;
  });
  return u8;
}

/**
 * The T64 written again (Build & Run, 13.5j): its files from the slot `from` on, in their order, each with its name,
 * types and bytes, but those `built` has for its slot (a PRG: load address first) as built. A file that starts
 * before `from` is left out: VICE's autostart loads the first file. The tape's name stays.
 */
export function writeT64(u8: Uint8Array, built: Map<number, Uint8Array> = new Map(), from = 0): Uint8Array {
  const img = readT64(u8), info = img.t64!;
  const files = img.files.filter(f => f.at >= from).map(f => {
    const e = f.t64!, prg = built.get(e.slot);
    if (prg) {
      if (prg.length < 2) throw new Error(`"${f.name}": the built file has no load address`);
      return { name: f.name, raw: f.raw, load: prg[0] | (prg[1] << 8), data: prg.subarray(2), fileType: e.fileType || 0x82, type: e.type };
    }
    return { name: f.name, raw: f.raw, load: f.load ?? 0, data: f.data, fileType: e.fileType, type: e.type };
  });
  return makeT64({ raw: info.raw, files });
}
