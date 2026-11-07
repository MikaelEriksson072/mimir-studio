/* Pirate Slayer, Electronic Arts' copy protection (1986-1989, by Kris Hatlelid, after PirateBusters by Kevin Pickell
 * and Brian Niessen), read from the disk (spec 13.5h).
 *
 * The key is a track the drive cannot read with its DOS: it has no SYNC mark at all, only bytes that EA's mastering
 * wrote, a few copies a turn. Version 2 has it on track 2: D7 D7 … D7 (hundreds), EB, CC AD 512 times, then the 12
 * bytes 55 AE 9B 55 AD 55 CB AE 6B AB AD AF. Version 1 had it on track 36 (and EB D7 AA 55 on track 37); PirateBusters
 * (Beach-Head II) on track 35, D7 D7 EB AA 55. With no SYNC the drive frames the bytes wherever its bit counter is,
 * and on a real disk that moves on every turn: the check reads up to some 65000 bytes for a turn where they line up.
 * Only a G64 has the track; a D64 of the disk has the sectors but not the key, so its boot fails the check.
 *
 * The boots: EA's own (EA, 2 blocks at $00F7, then LOADER, 22 blocks, "+2 PIRATESLAYER BOOT PROGRAMMED BY KRIS
 * HATLELID"), the stack-page boot of later titles (EA, 1-2 blocks at $0102, the check run as a DOS job and the drive
 * reset with UJ), or a boot of the game's own that runs the same check (Ferrari Formula One's FF1-BOOT at $00AE). */
import { isG64, parseG64 } from '@mimir/sindri';
import { parseD64, readD64File, type D64File } from './d64';

export type PirateSlayerVersion = 'v1' | 'v2' | 'piratebusters';

export interface PirateSlayerKey {
  /** the track that holds it (whole tracks) */
  track: number;
  /** what the check looks for first */
  pattern: number[];
  /** the bit (0-7) at which the image's bytes must be framed to read the key; 0: on the image's byte boundaries */
  bitPhase: number;
  /** each copy on the track in one turn: the D7s in front of it, the CC AD pairs after EB, and whether the 12 bytes
   *  after them are the signature (v2) */
  copies: { d7: number; pairs: number; signature: boolean }[];
  /** SYNC marks on the track: none on a Pirate Slayer key track */
  syncs: number;
}

export interface PirateSlayerBoot {
  kind: 'loader' | 'stack' | 'own';
  /** the boot's files, in the order they load */
  files: string[];
  /** what it does */
  how: string;
}

export interface PirateSlayerDisk {
  /** from the key track; from the boot's text when the image has no tracks (a D64) */
  version: PirateSlayerVersion | null;
  format: 'D64' | 'G64';
  /** the key tracks found on a G64 */
  keys: PirateSlayerKey[];
  boot: PirateSlayerBoot | null;
  /** files that hold the drive's key check as it is (not encrypted) */
  checkIn: string[];
  /** the boot's own text */
  text: string | null;
  /** one line for the Explorer and the toast */
  summary: string;
}

/** the 12 bytes after the CC AD pairs on a version 2 key track */
export const PIRATESLAYER_SIGNATURE = [0x55, 0xae, 0x9b, 0x55, 0xad, 0x55, 0xcb, 0xae, 0x6b, 0xab, 0xad, 0xaf];

const KEYS: { version: PirateSlayerVersion; track: number; pattern: number[] }[] = [
  { version: 'v2', track: 2, pattern: [0xd7, 0xd7, 0xeb, 0xcc, 0xad] },
  { version: 'v1', track: 36, pattern: [0xd7, 0xd7, 0xeb, 0xcc, 0xad] },
  { version: 'v1', track: 37, pattern: [0xeb, 0xd7, 0xaa, 0x55] },
  { version: 'piratebusters', track: 35, pattern: [0xd7, 0xd7, 0xeb, 0xaa, 0x55] },
];

/** bit i of a track, round and round */
const bitOf = (t: Uint8Array, i: number): number => (t[(i >> 3) % t.length] >> (7 - (i & 7))) & 1;
const byteAt = (t: Uint8Array, i: number): number => { let v = 0; for (let j = 0; j < 8; j++) v = (v << 1) | bitOf(t, i + j); return v; };

/** the bits where `pattern` starts on the track, framed anywhere */
function findBits(t: Uint8Array, pattern: number[]): number[] {
  const bits = t.length * 8, hits: number[] = [];
  const head = ((pattern[0] << 24) | (pattern[1] << 16) | (pattern[2] << 8) | (pattern[3] ?? 0)) >>> 0;
  const headBits = pattern.length >= 4 ? 32 : 24;
  const mask = headBits === 32 ? 0xffffffff : 0xffffff00;
  let win = 0;
  for (let i = 0; i < 31; i++) win = ((win << 1) | bitOf(t, i)) >>> 0;
  outer: for (let s = 0; s < bits; s++) {
    win = ((win << 1) | bitOf(t, s + 31)) >>> 0;
    if (((win & mask) >>> 0) !== ((head & mask) >>> 0)) continue;
    for (let k = 4; k < pattern.length; k++) if (byteAt(t, s + k * 8) !== pattern[k]) continue outer;
    hits.push(s);
  }
  return hits;
}

/** SYNC marks: runs of ten 1 bits or more */
function syncCount(t: Uint8Array): number {
  let ones = 0, n = 0;
  for (let i = 0; i < t.length * 8; i++) {
    if (bitOf(t, i)) { if (++ones === 10) n++; } else ones = 0;
  }
  return n;
}

/** The key on a track: each copy's D7s, CC AD pairs and signature (for the D7 D7 EB CC AD keys). */
function readKey(t: Uint8Array, track: number, pattern: number[]): PirateSlayerKey | null {
  const hits = findBits(t, pattern);
  if (!hits.length) return null;
  const copies: PirateSlayerKey['copies'] = [];
  const seen = new Set<number>();
  for (const h of hits) {
    if (pattern[2] !== 0xeb || pattern[3] !== 0xcc) { copies.push({ d7: 0, pairs: 0, signature: false }); continue; }
    // back over the D7s to where they begin; one copy per run
    let s = h;
    while (byteAt(t, s - 8) === 0xd7 && h - s < t.length * 8) s -= 8;
    if (seen.has(s)) continue;
    seen.add(s);
    let p = h + 24, pairs = 0;
    while (byteAt(t, p) === 0xcc && byteAt(t, p + 8) === 0xad && pairs < 4096) { pairs++; p += 16; }
    const signature = PIRATESLAYER_SIGNATURE.every((v, k) => byteAt(t, p + k * 8) === v);
    copies.push({ d7: (h - s) / 8 + 2, pairs, signature });
  }
  return { track, pattern, bitPhase: hits[0] % 8, copies, syncs: syncCount(t) };
}

/** the stack-page boot's first bytes (EA at $0102 on Chuck Yeager's Advanced Flight Trainer and Demon Stalkers): it
 *  clears the screen, blanks it and opens the command channel */
const STACK_BOOT = [0x20, 0x44, 0xe5, 0xa9, 0x0b, 0x8d, 0x11, 0xd0, 0xa9, 0x0f, 0xa8, 0xa2, 0x08, 0x20, 0xba, 0xff, 0xa9, 0x00, 0x20, 0xbd, 0xff, 0x20, 0xc0, 0xff];

const KEY_CHECK = [0x50, 0xfe, 0xb8, 0xad, 0x01, 0x1c, 0xc9, 0xd7, 0xd0, -1, 0x50, 0xfe, 0xb8, 0xad, 0x01, 0x1c, 0xc9, 0xd7, 0xf0];
const contains = (b: Uint8Array, p: number[]): boolean => {
  for (let i = 0; i + p.length <= b.length; i++) if (p.every((v, k) => v < 0 || b[i + k] === v)) return true;
  return false;
};

const hex4 = (n: number): string => `$${n.toString(16).toUpperCase().padStart(4, '0')}`;
const VERSION: Record<PirateSlayerVersion, string> = { v1: 'Pirate Slayer V1', v2: 'Pirate Slayer V2', piratebusters: 'PirateBusters' };

/** Where LOAD puts the bytes after the first two of a file that loads over its pointer at $AE/$AF, as the KERNAL's loop
 *  does it (null when the file does not). */
function pointerMove(prg: Uint8Array): number | null {
  const load = prg[0] | (prg[1] << 8);
  if (load > 0xaf || load + prg.length - 2 <= 0xae) return null;
  let lo = load & 0xff, hi = load >> 8;
  for (let i = 2; i < prg.length; i++) {
    const a = lo | (hi << 8);
    if (a === 0xae) lo = prg[i]; else if (a === 0xaf) hi = prg[i];
    lo = (lo + 1) & 0xff;
    if (!lo) hi = (hi + 1) & 0xff;
    // the pointer was written and now points away from where the file was going
    const next = lo | (hi << 8);
    if ((a === 0xae || a === 0xaf) && next !== a + 1) return next;
  }
  return null;
}

/** Pirate Slayer on a disk image (D64 or G64): its key, its boot, where its check is; null when it shows no sign of it. */
export function readPirateSlayerDisk(image: Uint8Array): PirateSlayerDisk | null {
  const format = isG64(image) ? 'G64' : 'D64';
  let dir;
  try { dir = parseD64(image); } catch { return null; }
  // the key tracks, on a G64
  const keys: PirateSlayerKey[] = [];
  let version: PirateSlayerVersion | null = null;
  if (format === 'G64') {
    const g = parseG64(image);
    for (const k of KEYS) {
      const t = g.halves[k.track * 2];
      if (!t) continue;
      const key = readKey(t, k.track, k.pattern);
      // a D7 D7 EB CC AD key has its pairs; the others are short and only count on a track with no SYNC
      if (!key || (k.pattern[3] === 0xcc ? !key.copies.some(c => c.pairs >= 256) : key.syncs > 1)) continue;
      keys.push(key);
      version ??= k.version;
    }
  }
  // the files: the boot, its text, and the drive's check where it is not encrypted
  const prgs = dir.files.filter(f => f.type === 'PRG' && f.track);
  const read = (f: D64File): Uint8Array | null => { try { return readD64File(image, f); } catch { return null; } };
  const byName = (n: string) => prgs.find(f => f.name === n);
  let text: string | null = null;
  const checkIn: string[] = [];
  for (const f of prgs) {
    const b = read(f);
    if (!b) continue;
    const s = String.fromCharCode(...b.subarray(0, Math.min(b.length, 512)));
    const m = /[+ ]?\d?\s*PIRATE ?SLAYER[ A-Z0-9.,/-]*/.exec(s);
    if (m && !text) text = m[0].replace(/\s+$/, '').trim();
    if (contains(b, KEY_CHECK) || contains(b, PIRATESLAYER_SIGNATURE)) checkIn.push(f.name);
  }
  if (!version && text) version = /\+2|V2/.test(text) ? 'v2' : null;
  let boot: PirateSlayerBoot | null = null;
  const first = prgs[0], firstBytes = first ? read(first) : null;
  const firstLoad = firstBytes && firstBytes.length > 2 ? firstBytes[0] | (firstBytes[1] << 8) : -1;
  const loader = byName('LOADER');
  if (first && loader && (text || keys.length)) {
    boot = {
      kind: 'loader', files: [first.name, loader.name],
      how: `${first.name} (${first.blocks} blocks at ${hex4(firstLoad)}) loads over the stack page, so LOAD returns into its own code; it sends UI and I to the drive and loads LOADER (${loader.blocks} blocks): loading over LOAD's pointer at $AE/$AF sends the rest of it on to other places. LOADER decrypts itself layer after layer with CIA 2's timer A as the key (counted cycles, so a freezer or a monitor breaks it) and wipes the code it ran, uploads its drive code with M-W, which looks for the key (ten tries, then the drive resets), and loads the game with a 2-bit loader of its own, sector chains by track and sector.`,
    };
  } else if (first && firstBytes && firstLoad >= 0x0100 && firstLoad < 0x0200 && (keys.length || checkIn.length || text || STACK_BOOT.every((v, k) => firstBytes[k + 2] === v))) {
    boot = {
      kind: 'stack', files: [first.name],
      how: `${first.name} (${first.blocks} block${first.blocks === 1 ? '' : 's'} at ${hex4(firstLoad)}) loads over the stack page and starts as LOAD returns. It decodes itself in layers, reads blocks of track 1 with U1, uploads the drive code a byte at a time with M-W and runs the key check as a DOS job ($E0) on the key track, reads the result with M-R, resets the drive with UJ (the reset moves the head off the key track) and has the drive run its loader from 1/1 with B-E.`,
    };
  } else if (first && firstBytes && (keys.length || checkIn.length)) {
    const moved = pointerMove(firstBytes);
    boot = {
      kind: 'own', files: [first.name, ...checkIn.filter(n => n !== first.name)],
      how: `${first.name} is a boot of the game's own${moved != null ? `: it loads at ${hex4(firstLoad)}, over LOAD's pointer at $AE/$AF, so the rest of it goes to ${hex4(moved)}` : ''}. ${checkIn.length ? `${checkIn.join(', ')} hold${checkIn.length === 1 ? 's' : ''} the drive's key check, uploaded with M-W and run as a DOS job on the key track.` : ''}`.trim(),
    };
  }
  if (!keys.length && !boot && !checkIn.length && !text) return null;
  const key = keys[0];
  const where = key
    ? `the key on track ${key.track} (no SYNC, ${key.copies.length} cop${key.copies.length === 1 ? 'y' : 'ies'} a turn${key.bitPhase ? `, framed from bit ${key.bitPhase}` : ''})`
    : format === 'D64' ? 'no key track (a D64 has none: the check fails)' : 'no key track on the image';
  const summary = `${version ? VERSION[version] : 'Pirate Slayer'} (Electronic Arts): ${where}${boot ? `; boot ${boot.files.join(' → ')}` : ''}`;
  return { version, format, keys, boot, checkIn, text, summary };
}
