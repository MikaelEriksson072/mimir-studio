/* The library (spec 10.6): the SID music, sprites and charsets the user found, kept by the app in a folder of their own
 * (a folder for each kind) for every project. Each is a file other tools read too (.sid, .spr, .64c) with a name that
 * says where it was found ("Comaland side 1 - file25 - music_1000 ($1000-$1fff).sid"); the folder's library.json
 * keeps what the file cannot say: where it was taken from, when, how it is drawn. Files put in the folders by hand are
 * in the library too. Pure: the main process reads and writes the files, the app shows them. */
import type { Addr } from './types';
import { h4 } from './util/hex';
import { makePrg } from './c64/prg';

export type LibraryKind = 'sid' | 'sprites' | 'chars';
export const LIBRARY_KINDS: readonly LibraryKind[] = ['sid', 'sprites', 'chars'];
/** each kind's folder in the library */
export const LIBRARY_FOLDERS: Record<LibraryKind, string> = { sid: 'SIDs', sprites: 'Sprites', chars: 'Chars' };
/** the extension a file is written with: a PSID/RSID, raw sprites (64 bytes each), a charset with its load address */
export const LIBRARY_EXT: Record<LibraryKind, string> = { sid: 'sid', sprites: 'spr', chars: '64c' };
/** the extensions read in each folder (also files put there by hand) */
export const LIBRARY_READS: Record<LibraryKind, readonly string[]> = { sid: ['sid'], sprites: ['spr', 'bin', 'raw'], chars: ['64c', 'chr', 'bin', 'raw'] };
/** the index in the library's folder */
export const LIBRARY_INDEX = 'library.json';
/** the largest file read: a .sid of all 64 KB with its header */
export const LIBRARY_MAX_BYTES = 0x10000 + 0x7c + 2;
/** the longest name a file gets (without its extension and a " (2)"): the folder's path comes in front of it */
export const LIBRARY_STEM_MAX = 140;

/** C64 colour numbers: the background (00), the colours of the pairs 01 and 10, and a set pixel (hires) or 11 */
export interface LibraryColors { bg: number; fg: number; mc1: number; mc2: number }

/** where the bytes were taken from */
export interface LibrarySource {
  /** what the file's name says about it, as the user left it ("Comaland side 1 - file25") */
  text?: string;
  /** the project, the file the bytes were in (a PRG, a snapshot), the disk or tape the file was opened from */
  project?: string;
  file?: string;
  disk?: string;
  /** where the bytes were in memory (end excluded) */
  start?: Addr;
  end?: Addr;
}

/** a sample player with nothing to call each frame (an RSID): what VICE's player needs to play it again */
export interface LibraryDigi { nmi: boolean; hz: number; irq?: { handler: Addr; kernal: boolean } }

/** what library.json keeps of a file: its name in the library, when it was added, its bytes' hash (a file renamed by
 *  hand is found again by it), where it was taken from, and how it is drawn or played */
export interface LibraryEntry {
  kind: LibraryKind;
  /** the file's name in its kind's folder */
  file: string;
  name: string;
  added: number;
  hash: string;
  from?: LibrarySource;
  /** sprites and charsets: multicolour, and the colours they are drawn in */
  mc?: boolean;
  colors?: LibraryColors;
  /** SIDs: a sample player's interrupt (VICE's player starts its timers again) and what its init writes */
  digi?: LibraryDigi;
  busy?: [Addr, Addr][];
}

/** a file of the library as the app gets it: its entry (made up from the file for one put there by hand, `own`), its
 *  bytes (a .sid whole, sprites and a charset without a load address) and the load address a file had */
export interface LibraryItem extends LibraryEntry {
  data: Uint8Array;
  load?: Addr;
  own?: boolean;
}

/** a file found in a kind's folder */
export interface LibraryFile { kind: LibraryKind; file: string; bytes: Uint8Array; mtime: number }

/** FNV-1a of the bytes, 8 hex digits: the same bytes added again are found in the library */
export function libraryHash(bytes: Uint8Array): string {
  let h = 0x811c9dc5;
  for (const v of bytes) h = Math.imul(h ^ v, 0x01000193) >>> 0;
  return h.toString(16).padStart(8, '0');
}

const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i;

/** A file name Windows (and every other system) takes: no \ / : * ? " < > | or control characters (each becomes _),
 *  spaces run together, no dot or space at the end, no - or . first (taken for an option or hidden), not a device's
 *  name, at most `max` characters; nothing left is "untitled". */
export function safeFileName(s: string, max = LIBRARY_STEM_MAX): string {
  // eslint-disable-next-line no-control-regex
  let t = s.replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '_').replace(/\s+/g, ' ').trim();
  t = t.replace(/^[-.\s]+/, '');
  if (t.length > max) t = t.slice(0, max);
  t = t.replace(/[.\s]+$/, '');
  if (!t) return 'untitled';
  return RESERVED.test(t) ? `_${t}` : t;
}

/** a file's name without its folder and extension */
export const fileStem = (name: string): string => name.replace(/^.*[\\/]/, '').replace(/\.[^.]*$/, '') || name;

/** a name as the source's names are compared: letters and digits only, any case ("INTRO 3 V1.0" = "intro_3_v1_0") */
const sameName = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/** What a file's name says about where the bytes were taken from: the disk (or tape) the file came from, the file and
 *  the project, each once (one whose name another already holds is left out, whatever its spaces, dots and
 *  underscores: the project "Comaland" with its disk "Comaland side 1", the project "INTRO 3 V1.0" with its file
 *  "INTRO_3_V1_0.prg"), extensions left out: "Comaland side 1 - file25_1000". */
export function librarySourceText(from: LibrarySource): string {
  const parts: string[] = [];
  // (a disk's and a file's extension left out, .d64 or .prg, not the ".0" of a version: a project's name has none)
  for (const [p, file] of [[from.disk, true], [from.file, true], [from.project, false]] as const) {
    const t = p ? (file ? p.replace(/^.*[\\/]/, '').replace(/\.[A-Za-z][A-Za-z0-9]{0,3}$/, '') : p).replace(/\s+/g, ' ').trim() : '';
    const low = sameName(t);
    if (!low) continue;
    // one that holds an earlier one, or is it, takes its place (the project "Comaland II" after the file "Comaland", the
    // project's name for the file's)
    const i = parts.findIndex(q => low.includes(sameName(q)));
    if (i >= 0) { parts.splice(i, 1, t); continue; }
    if (!parts.some(q => sameName(q).includes(low))) parts.push(t);
  }
  return parts.join(' - ');
}

/** the bytes' addresses as a file name has them: "$1000-$1fff" */
export const libraryRange = (start?: Addr, end?: Addr): string => (start != null && end != null && end > start ? `$${h4(start)}-$${h4(end - 1)}` : '');

/** The name a file gets in the library, without its extension: where it was taken from, its name and its addresses,
 *  "Comaland side 1 - file25_1000 - music_1000 ($1000-$1fff)". A name that is the source already is not said twice. */
export function libraryStem(name: string, from: LibrarySource = {}): string {
  const where = (from.text ?? librarySourceText(from)).trim(), what = name.trim();
  const range = libraryRange(from.start, from.end);
  const head = [where, what].filter((p, i, a) => p && (i === 0 || p.toLowerCase() !== a[0].toLowerCase())).join(' - ');
  // the addresses are kept when the rest is cut to fit
  const tail = range ? ` (${range})` : '';
  return safeFileName(`${safeFileName(head || 'untitled', LIBRARY_STEM_MAX - tail.length)}${tail}`);
}

/** `stem` with the kind's extension, made unique among `taken` (a folder's files, any case): "… (2).sid" */
export function uniqueLibraryName(stem: string, ext: string, taken: Iterable<string>): string {
  const low = new Set([...taken].map(t => t.toLowerCase()));
  let name = `${stem}.${ext}`;
  for (let n = 2; low.has(name.toLowerCase()); n++) name = `${stem} (${n}).${ext}`;
  return name;
}

/** whether `file` is a plain file name the kind's folder reads (no folder in it) */
export function isLibraryFileName(kind: LibraryKind, file: string): boolean {
  if (!file || file.length > 255 || /[\\/:*?"<>|]/.test(file) || file === '.' || file === '..' || /^[.\s]/.test(file)) return false;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f]/.test(file)) return false;
  const ext = /\.([^.]+)$/.exec(file)?.[1].toLowerCase();
  return !!ext && LIBRARY_READS[kind].includes(ext);
}

/** a charset as a .64c file: a PRG, its load address first */
export const charsetFile = (bytes: Uint8Array, load: Addr): Uint8Array => makePrg(load, bytes);

/** sprites as a .spr file: 64 bytes each, a last one that is not whole filled up with zeros */
export function spriteFile(bytes: Uint8Array): Uint8Array {
  const n = Math.max(1, Math.ceil(bytes.length / 64)) * 64;
  if (n === bytes.length) return bytes.slice();
  const out = new Uint8Array(n);
  out.set(bytes);
  return out;
}

/** Latin-1, as a PSID's texts are; what is not is ? */
const latin1 = (s: string) => [...s].map(c => { const k = c.codePointAt(0)!; return k >= 0x20 && k <= 0xff && (k < 0x7f || k >= 0xa0) ? k : 0x3f; });

/** A .sid with its three texts (name, author, released: 31 characters each, Latin-1) set; those not given stay. */
export function sidWithTexts(sid: Uint8Array, t: { name?: string; author?: string; released?: string }): Uint8Array {
  const out = sid.slice();
  const put = (o: number, s?: string) => {
    if (s == null) return;
    out.fill(0, o, o + 32);
    latin1(s.trim()).slice(0, 31).forEach((k, i) => { out[o + i] = k; });
  };
  put(0x16, t.name); put(0x36, t.author); put(0x56, t.released);
  return out;
}

const isSid = (u8: Uint8Array) => u8.length >= 0x7e && ((u8[0] === 0x50 || u8[0] === 0x52) && u8[1] === 0x53 && u8[2] === 0x49 && u8[3] === 0x44);

/** What a file of the library holds: a .sid whole (a PSID or RSID), sprites and a charset without the load address a
 *  file has (a .64c always; another when its length is 2 more than whole sprites or characters); or why it is not one. */
export function readLibraryFile(kind: LibraryKind, file: string, bytes: Uint8Array): { data: Uint8Array; load?: Addr } | { problem: string } {
  if (!bytes.length) return { problem: 'empty' };
  if (bytes.length > LIBRARY_MAX_BYTES) return { problem: `${bytes.length} bytes, more than a C64 holds` };
  if (kind === 'sid') return isSid(bytes) ? { data: bytes } : { problem: 'not a PSID or RSID file' };
  const unit = kind === 'chars' ? 8 : 64;
  const withLoad = (kind === 'chars' && /\.64c$/i.test(file)) || (bytes.length > 2 && bytes.length % unit === 2);
  if (withLoad) {
    if (bytes.length < 3) return { problem: 'no bytes after the load address' };
    return { data: bytes.slice(2), load: bytes[0] | (bytes[1] << 8) };
  }
  return { data: bytes };
}

const isByte = (v: unknown, max = 0xff): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= max;
const str = (v: unknown, max = 400): string | undefined => (typeof v === 'string' && v.length <= max ? v : undefined);

function readSource(v: unknown): LibrarySource | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const o = v as Record<string, unknown>, s: LibrarySource = {};
  for (const k of ['text', 'project', 'file', 'disk'] as const) { const t = str(o[k]); if (t != null) s[k] = t; }
  if (isByte(o.start, 0xffff) && isByte(o.end, 0x10000) && (o.end as number) > (o.start as number)) { s.start = o.start; s.end = o.end as number; }
  return Object.keys(s).length ? s : undefined;
}

function readColors(v: unknown): LibraryColors | undefined {
  const o = v as Partial<LibraryColors> | null;
  return o && typeof o === 'object' && isByte(o.bg, 15) && isByte(o.fg, 15) && isByte(o.mc1, 15) && isByte(o.mc2, 15) ? { bg: o.bg, fg: o.fg, mc1: o.mc1, mc2: o.mc2 } : undefined;
}

function readDigi(v: unknown): LibraryDigi | undefined {
  const o = v as Partial<LibraryDigi> | null;
  if (!o || typeof o !== 'object' || typeof o.nmi !== 'boolean' || !Number.isFinite(o.hz)) return undefined;
  const irq = o.irq && isByte(o.irq.handler, 0xffff) && typeof o.irq.kernal === 'boolean' ? { handler: o.irq.handler, kernal: o.irq.kernal } : undefined;
  return { nmi: o.nmi, hz: Number(o.hz), ...(irq ? { irq } : {}) };
}

/** library.json's entries, those that are entries (anything else in it left out) */
export function readLibraryIndex(v: unknown): LibraryEntry[] {
  const items = v && typeof v === 'object' && Array.isArray((v as { items?: unknown }).items) ? (v as { items: unknown[] }).items : [];
  const out: LibraryEntry[] = [];
  for (const x of items) {
    if (!x || typeof x !== 'object') continue;
    const o = x as Record<string, unknown>;
    const kind = LIBRARY_KINDS.find(k => k === o.kind);
    const file = str(o.file, 255), name = str(o.name), hash = str(o.hash, 16);
    if (!kind || !file || !isLibraryFileName(kind, file) || name == null || !hash) continue;
    const from = readSource(o.from), colors = readColors(o.colors), digi = readDigi(o.digi);
    const busy = Array.isArray(o.busy) ? o.busy.filter((r): r is [Addr, Addr] => Array.isArray(r) && r.length === 2 && isByte(r[0], 0xffff) && isByte(r[1], 0x10000) && r[1] > r[0]) : [];
    out.push({ kind, file, name, added: Number.isFinite(o.added) ? Number(o.added) : 0, hash,
      ...(from ? { from } : {}), ...(typeof o.mc === 'boolean' ? { mc: o.mc } : {}), ...(colors ? { colors } : {}), ...(digi ? { digi } : {}), ...(busy.length ? { busy } : {}) });
  }
  return out;
}

/** library.json as it is written */
export const libraryIndexJson = (entries: readonly LibraryEntry[]): string => JSON.stringify({ version: 1, items: entries }, null, 1);

const key = (kind: LibraryKind, file: string) => `${kind}/${file.toLowerCase()}`;

/**
 * The library as the folders hold it: each file with its entry, found by its name, or (a file renamed by hand) by its
 * bytes' hash among the entries whose file is gone; a file with no entry is one put there by hand (`own`), named after
 * the file, added when it was last written. Entries whose file is gone are dropped from the index. Files that are not
 * of their kind (a .bin that is no charset) are left out. `changed`: the index is not as it was read.
 */
export function libraryItems(index: readonly LibraryEntry[], files: readonly LibraryFile[]): { items: LibraryItem[]; index: LibraryEntry[]; changed: boolean } {
  const byFile = new Map(index.map(e => [key(e.kind, e.file), e]));
  const present = new Set(files.map(f => key(f.kind, f.file)));
  // entries whose file is not there any more, by their hash: a file renamed by hand finds its entry again
  const lost = index.filter(e => !present.has(key(e.kind, e.file)));
  const items: LibraryItem[] = [], next: LibraryEntry[] = [];
  let changed = false;
  for (const f of files) {
    const r = readLibraryFile(f.kind, f.file, f.bytes);
    if ('problem' in r) continue;
    const hash = libraryHash(r.data);
    let e = byFile.get(key(f.kind, f.file));
    if (!e) {
      const i = lost.findIndex(x => x.kind === f.kind && x.hash === hash);
      if (i >= 0) { e = { ...lost[i], file: f.file }; lost.splice(i, 1); changed = true; }
    }
    if (e && e.hash !== hash) { e = { ...e, hash }; changed = true; }
    if (e) {
      next.push(e);
      items.push({ ...e, data: r.data, ...(r.load != null ? { load: r.load } : {}) });
    } else items.push({ kind: f.kind, file: f.file, name: fileStem(f.file), added: f.mtime, hash, data: r.data, ...(r.load != null ? { load: r.load } : {}), own: true });
  }
  if (next.length !== index.length) changed = true;
  return { items, index: next, changed };
}
