/* =====================================================================
 * Disk images made and changed: a 1541 disk (.d64, 35 tracks; one of 40 or 42 is read, and written on its first 35)
 * and a 1581 disk (.d81, 80 tracks of 40 sectors). A DiskEdit is an image with its directory, its block availability
 * map (BAM) and its files' sector chains kept in step: a file added takes free sectors as the drive's DOS picks them
 * (from the track next to the directory's outwards; 10 sectors apart on a 1541, one after the other on a 1581), a
 * file removed gives its sectors back, and validate() works the BAM out again from the files, as the drive's V command.
 *
 * The layouts, as VICE's c1541 writes them (its images and these are the same, byte for byte, for the same files):
 *   D64  18/0  the link to the directory (18/1), "A", then four bytes a track from byte 4: how many sectors are free
 *              and a bit a sector (set: free); the disk's name at $90 (16, padded with $a0), its ID at $a2, "2A" at $a5
 *        18/1… the directory, eight entries a sector, the next sector three on
 *   D81  40/0  the link to the directory (40/3), "D", the name at 4, the ID at $16, "3D" at $19
 *        40/1  the BAM of tracks 1-40: the link to 40/2, "D", $bb, the ID, $c0, and from $10 six bytes a track: how
 *              many sectors are free and 40 bits; 40/2 the same for tracks 41-80
 *        40/3… the directory
 * A directory entry is 32 bytes: the file's type at 2 ($80 closed, $40 locked; 1 SEQ, 2 PRG, 3 USR, 4 REL, on a 1581
 * 5 CBM, a partition), its first track and sector at 3, its name at 5 (16, padded with $a0), its blocks at 30.
 * ===================================================================== */
import { petsciiName } from './d64';

export type DiskKind = 'd64' | 'd81';
export type DiskFileType = 'DEL' | 'SEQ' | 'PRG' | 'USR' | 'REL' | 'CBM';
const TYPES: (DiskFileType | null)[] = ['DEL', 'SEQ', 'PRG', 'USR', 'REL', 'CBM', null, null];

/** a file of the directory */
export interface DiskEntry {
  name: string; raw: Uint8Array; type: DiskFileType; closed: boolean; locked: boolean;
  /** its size in blocks, as the directory says */
  blocks: number;
  track: number; sector: number;
  /** where its entry is in the image */
  at: number;
}

const D64_SIZES: Record<number, number> = { 174848: 35, 175531: 35, 196608: 40, 197376: 40, 205312: 42, 206114: 42 };
const D81_SIZES: readonly number[] = [819200, 822400];
/** what kind of image bytes are, by their size: null for neither */
export const diskKindOf = (b: Uint8Array): DiskKind | null => (D64_SIZES[b.length] ? 'd64' : D81_SIZES.includes(b.length) ? 'd81' : null);

/** a name as the disk has it: 16 bytes of PETSCII padded with $a0 (letters in upper case, as typed on a C64) */
export function diskName(name: string, n = 16): Uint8Array {
  const out = new Uint8Array(n).fill(0xa0);
  [...name].slice(0, n).forEach((c, i) => {
    const k = c.toUpperCase().charCodeAt(0);
    out[i] = c === '£' ? 0x5c : c === '↑' ? 0x5e : c === '←' ? 0x5f : k >= 0x20 && k <= 0x5d ? k : 0x3f;
  });
  return out;
}

const same = (a: string, b: string) => a.toUpperCase() === b.toUpperCase();

export class DiskEdit {
  readonly kind: DiskKind;
  /** the image: its sectors one after the other (and a D64's error bytes after them, when it has them) */
  readonly bytes: Uint8Array;
  readonly tracks: number;
  /** the directory's track, and the tracks the BAM has (a file's sectors are taken there) */
  readonly dirTrack: number;
  private readonly bamTracks: number;

  constructor(bytes: Uint8Array) {
    const kind = diskKindOf(bytes);
    if (!kind) throw new Error(`not a .d64 or .d81 disk image: ${bytes.length} bytes (a D64 has 174848, a D81 819200)`);
    this.kind = kind; this.bytes = bytes;
    this.tracks = kind === 'd81' ? 80 : D64_SIZES[bytes.length];
    this.dirTrack = kind === 'd81' ? 40 : 18;
    this.bamTracks = kind === 'd81' ? 80 : 35;
  }

  /** a new, formatted disk: empty, with a name and an ID (two characters) */
  static format(kind: DiskKind, name = '', id = '01'): DiskEdit {
    const d = new DiskEdit(new Uint8Array(kind === 'd81' ? 819200 : 174848));
    d.formatDisk(name, id);
    return d;
  }

  /* ---- sectors ---- */
  sectorsOn(t: number): number { return this.kind === 'd81' ? 40 : t <= 17 ? 21 : t <= 24 ? 19 : t <= 30 ? 18 : 17; }
  has(t: number, s: number): boolean { return Number.isInteger(t) && Number.isInteger(s) && t >= 1 && t <= this.tracks && s >= 0 && s < this.sectorsOn(t); }
  offset(t: number, s: number): number {
    if (!this.has(t, s)) throw new RangeError(`there is no track ${t} sector ${s} on the disk (tracks 1-${this.tracks}, ${this.kind === 'd81' ? '40 sectors each' : '17 to 21 sectors each'})`);
    if (this.kind === 'd81') return ((t - 1) * 40 + s) * 256;
    let n = 0;
    for (let i = 1; i < t; i++) n += this.sectorsOn(i);
    return (n + s) * 256;
  }
  /** a sector's 256 bytes, in the image: what is written there is on the disk */
  sector(t: number, s: number): Uint8Array { const o = this.offset(t, s); return this.bytes.subarray(o, o + 256); }
  /** how many sectors the disk has */
  get sectors(): number { let n = 0; for (let t = 1; t <= this.tracks; t++) n += this.sectorsOn(t); return n; }

  /* ---- the BAM ---- */
  private get header(): number { return this.offset(this.dirTrack, 0); }
  /** where a track's BAM entry is: its count of free sectors, then its bits; -1 for a track the BAM has none for */
  private bamAt(t: number): number {
    if (t < 1 || t > this.bamTracks) return -1;
    if (this.kind === 'd64') return this.header + 4 * t;
    return this.offset(40, t <= 40 ? 1 : 2) + 0x10 + 6 * ((t - 1) % 40);
  }
  isFree(t: number, s: number): boolean {
    const b = this.bamAt(t);
    return this.has(t, s) && b >= 0 && !!(this.bytes[b + 1 + (s >> 3)] & (1 << (s & 7)));
  }
  /** a sector taken (true when it was free) */
  allocate(t: number, s: number): boolean {
    if (!this.isFree(t, s)) { this.offset(t, s); return false; }
    const b = this.bamAt(t);
    this.bytes[b + 1 + (s >> 3)] &= ~(1 << (s & 7)); this.bytes[b]--;
    return true;
  }
  /** a sector given back (true when it was taken) */
  release(t: number, s: number): boolean {
    const b = this.bamAt(t);
    this.offset(t, s);
    if (b < 0 || this.isFree(t, s)) return false;
    this.bytes[b + 1 + (s >> 3)] |= 1 << (s & 7); this.bytes[b]++;
    return true;
  }
  /** how many sectors of a track are free */
  freeOn(t: number): number { const b = this.bamAt(t); return b < 0 ? 0 : this.bytes[b]; }
  /** "blocks free", as the drive counts them: the directory's track left out */
  get free(): number { let n = 0; for (let t = 1; t <= this.bamTracks; t++) if (t !== this.dirTrack) n += this.freeOn(t); return n; }

  /* ---- the disk's name ---- */
  private get nameAt(): number { return this.header + (this.kind === 'd81' ? 0x04 : 0x90); }
  private get idAt(): number { return this.header + (this.kind === 'd81' ? 0x16 : 0xa2); }
  get name(): string { return petsciiName(this.bytes.subarray(this.nameAt, this.nameAt + 16)); }
  set name(v: string) { this.bytes.set(diskName(v), this.nameAt); }
  get id(): string { return petsciiName(this.bytes.subarray(this.idAt, this.idAt + 2)); }
  set id(v: string) {
    this.bytes.set(diskName(v, 2), this.idAt);
    if (this.kind === 'd81') for (const s of [1, 2]) this.bytes.set(diskName(v, 2), this.offset(40, s) + 4);
  }
  get dosType(): string { const a = this.header + (this.kind === 'd81' ? 0x19 : 0xa5); return petsciiName(this.bytes.subarray(a, a + 2)); }

  /** the disk formatted: every sector empty, a new BAM, an empty directory */
  formatDisk(name: string, id: string): void {
    const b = this.bytes, total = this.sectors * 256;
    b.fill(0, 0, total);
    if (this.kind === 'd64') {
      const h = this.header;
      b[h] = 18; b[h + 1] = 1; b[h + 2] = 0x41;
      for (let t = 1; t <= 35; t++) { const n = this.sectorsOn(t), e = h + 4 * t; b[e] = n; b[e + 1] = 0xff; b[e + 2] = 0xff; b[e + 3] = (1 << (n - 16)) - 1; }
      b.fill(0xa0, h + 0x90, h + 0xab);
      b[h + 0xa5] = 0x32; b[h + 0xa6] = 0x41;
      this.allocate(18, 0); this.allocate(18, 1);
      b[this.offset(18, 1) + 1] = 0xff;
    } else {
      const h = this.header;
      b[h] = 40; b[h + 1] = 3; b[h + 2] = 0x44;
      b.fill(0xa0, h + 0x04, h + 0x1d);
      b[h + 0x19] = 0x33; b[h + 0x1a] = 0x44;
      for (const s of [1, 2]) {
        const o = this.offset(40, s);
        b[o] = s === 1 ? 40 : 0; b[o + 1] = s === 1 ? 2 : 0xff; b[o + 2] = 0x44; b[o + 3] = 0xbb; b[o + 6] = 0xc0;
        for (let t = 0; t < 40; t++) { b[o + 0x10 + 6 * t] = 40; b.fill(0xff, o + 0x11 + 6 * t, o + 0x16 + 6 * t); }
      }
      for (const s of [0, 1, 2, 3]) this.allocate(40, s);
      b[this.offset(40, 3) + 1] = 0xff;
    }
    this.name = name; this.id = id;
  }

  /* ---- the directory ---- */
  /** the directory's sectors, in their order */
  private dirSectors(): [number, number][] {
    const out: [number, number][] = [], seen = new Set<number>();
    let t = this.dirTrack, s = this.kind === 'd81' ? 3 : 1;
    while (t !== 0 && this.has(t, s) && !seen.has(this.offset(t, s))) {
      seen.add(this.offset(t, s)); out.push([t, s]);
      const o = this.offset(t, s);
      [t, s] = [this.bytes[o], this.bytes[o + 1]];
    }
    return out;
  }
  private entryAt(at: number): DiskEntry | null {
    const b = this.bytes, kind = b[at + 2], type = TYPES[kind & 7];
    if (!kind || !type || (type === 'CBM' && this.kind !== 'd81')) return null;
    const raw = b.slice(at + 5, at + 21);
    return { name: petsciiName(raw), raw, type, closed: !!(kind & 0x80), locked: !!(kind & 0x40), blocks: b[at + 30] | (b[at + 31] << 8), track: b[at + 3], sector: b[at + 4], at };
  }
  /** the files, as a directory listing has them */
  get files(): DiskEntry[] {
    const out: DiskEntry[] = [];
    for (const [t, s] of this.dirSectors()) for (let e = 0; e < 8; e++) { const f = this.entryAt(this.offset(t, s) + e * 32); if (f) out.push(f); }
    return out;
  }
  find(name: string): DiskEntry | null { return this.files.find(f => same(f.name, name)) ?? null; }
  private need(name: string, what: string): DiskEntry {
    const f = this.find(name);
    if (!f) throw new ReferenceError(`${what}: no file "${name}" on the disk`);
    return f;
  }

  /** a file's sectors along its chain (a partition's: its blocks one after the other) */
  chain(f: Pick<DiskEntry, 'name' | 'track' | 'sector'> & Partial<Pick<DiskEntry, 'type' | 'blocks'>>): [number, number][] {
    const out: [number, number][] = [], seen = new Set<number>();
    let t = f.track, s = f.sector;
    if (f.type === 'CBM') {
      for (let n = 0; n < (f.blocks ?? 0) && this.has(t, s); n++) { out.push([t, s]); if (++s >= this.sectorsOn(t)) { s = 0; t++; } }
      return out;
    }
    while (t !== 0) {
      if (!this.has(t, s)) throw new Error(`"${f.name}": its sector chain goes to track ${t} sector ${s}, which is not on the disk`);
      const o = this.offset(t, s);
      if (seen.has(o)) throw new Error(`"${f.name}": its sector chain loops back to track ${t} sector ${s}`);
      seen.add(o); out.push([t, s]);
      [t, s] = [this.bytes[o], this.bytes[o + 1]];
    }
    return out;
  }
  /** a file's bytes (a PRG's with its load address first) */
  read(name: string): Uint8Array {
    const f = this.need(name, 'read');
    if (f.type === 'CBM') throw new Error(`"${f.name}" is a partition, not a file: its sectors are read one by one`);
    const c = this.chain(f), parts: Uint8Array[] = [];
    c.forEach(([t, s], i) => { const sec = this.sector(t, s); parts.push(sec.subarray(2, i === c.length - 1 ? Math.max(2, sec[1] + 1) : 256)); });
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let p = 0;
    for (const x of parts) { out.set(x, p); p += x.length; }
    return out;
  }

  /** the tracks a file's sectors are looked for on: from the one next to the directory's outwards, below it first */
  private trackOrder(): number[] {
    const out: number[] = [];
    for (let d = 1; d < this.bamTracks; d++) { if (this.dirTrack - d >= 1) out.push(this.dirTrack - d); if (this.dirTrack + d <= this.bamTracks) out.push(this.dirTrack + d); }
    return out;
  }
  /** the next free sector for a file whose last one was `prev` (null: its first), taken; null when the disk is full */
  private nextSector(prev: [number, number] | null): [number, number] | null {
    const step = this.kind === 'd81' ? 1 : 10;
    const order = this.trackOrder();
    const onTrack = (t: number, from: number): number => { const n = this.sectorsOn(t); for (let i = 0; i < n; i++) { const s = (from + i) % n; if (this.isFree(t, s)) return s; } return -1; };
    if (prev && this.freeOn(prev[0]) > 0) {
      const n = this.sectorsOn(prev[0]);
      let s = prev[1] + step;
      if (s >= n) { s -= n; if (s > 0 && this.kind === 'd64') s--; }
      const got = onTrack(prev[0], s);
      if (got >= 0) { this.allocate(prev[0], got); return [prev[0], got]; }
    }
    // (the tracks after the last one's in the order, then those before: a file goes on away from the directory)
    const at = prev ? order.indexOf(prev[0]) : -1;
    for (const t of [...order.slice(at + 1), ...order.slice(0, at + 1)]) {
      const got = this.freeOn(t) > 0 ? onTrack(t, 0) : -1;
      if (got >= 0) { this.allocate(t, got); return [t, got]; }
    }
    return null;
  }
  /** a free entry of the directory, a new directory sector taken for it when all are full; null when there is no room */
  private freeEntry(): number | null {
    const dir = this.dirSectors();
    for (const [t, s] of dir) for (let e = 0; e < 8; e++) { const at = this.offset(t, s) + e * 32; if (!this.bytes[at + 2]) return at; }
    const [lt, ls] = dir[dir.length - 1], n = this.sectorsOn(this.dirTrack), step = this.kind === 'd81' ? 1 : 3;
    for (let i = 0; i < n; i++) {
      const s = (ls + step + i) % n;
      if (!this.isFree(this.dirTrack, s)) continue;
      this.allocate(this.dirTrack, s);
      const o = this.offset(this.dirTrack, s), last = this.offset(lt, ls);
      this.bytes.fill(0, o, o + 256); this.bytes[o + 1] = 0xff;
      this.bytes[last] = this.dirTrack; this.bytes[last + 1] = s;
      return o;
    }
    return null;
  }

  /** how many blocks bytes take as a file */
  static blocksFor(length: number): number { return Math.max(1, Math.ceil(length / 254)); }

  /** a file added: its bytes (a PRG's with its load address first) in free sectors, and its entry in the directory */
  add(name: string, data: Uint8Array, type: DiskFileType = 'PRG'): DiskEntry {
    const n = [...name].length;
    if (n < 1 || n > 16) throw new RangeError(`add: a file's name is 1 to 16 characters ("${name}" is ${n})`);
    if (type === 'REL' || type === 'CBM') throw new TypeError(`add: a ${type} file is not made here (PRG, SEQ, USR or DEL)`);
    if (this.find(name)) throw new RangeError(`add: "${name}" is on the disk already (remove it first, or give this one another name)`);
    const need = DiskEdit.blocksFor(data.length);
    if (need > this.free) throw new RangeError(`add: "${name}" needs ${need} block${need === 1 ? '' : 's'} and the disk has ${this.free} free`);
    const keep = this.bytes.slice();
    const entry = this.freeEntry();
    if (entry == null) { this.bytes.set(keep); throw new RangeError(`add: the directory is full (${this.files.length} files)`); }
    const chain: [number, number][] = [];
    for (let i = 0; i < need; i++) {
      const s = this.nextSector(chain[chain.length - 1] ?? null);
      if (!s) { this.bytes.set(keep); throw new RangeError(`add: "${name}" needs ${need} blocks and the disk is full`); }
      chain.push(s);
    }
    chain.forEach(([t, s], i) => {
      const sec = this.sector(t, s), part = data.subarray(i * 254, i * 254 + 254);
      sec.fill(0);
      if (i + 1 < chain.length) { sec[0] = chain[i + 1][0]; sec[1] = chain[i + 1][1]; } else { sec[0] = 0; sec[1] = part.length + 1; }
      sec.set(part, 2);
    });
    const b = this.bytes;
    // (the link of a directory sector, its first two bytes, is not part of an entry)
    b.fill(0, entry + 2, entry + 32);
    b[entry + 2] = 0x80 | TYPES.indexOf(type);
    b[entry + 3] = chain[0][0]; b[entry + 4] = chain[0][1];
    b.set(diskName(name), entry + 5);
    b[entry + 30] = need & 0xff; b[entry + 31] = need >> 8;
    return this.entryAt(entry)!;
  }

  /** a file taken off the disk: its sectors are free again, its entry empty (as the drive's S command) */
  remove(name: string): DiskEntry {
    const f = this.need(name, 'remove');
    for (const [t, s] of this.chain(f)) this.release(t, s);
    this.bytes[f.at + 2] = 0;
    return f;
  }
  rename(name: string, to: string): void {
    const f = this.need(name, 'rename'), n = [...to].length;
    if (n < 1 || n > 16) throw new RangeError(`rename: a file's name is 1 to 16 characters ("${to}" is ${n})`);
    const other = this.find(to);
    if (other && other.at !== f.at) throw new RangeError(`rename: "${to}" is on the disk already`);
    this.bytes.set(diskName(to), f.at + 5);
  }
  /** a file locked (`<` in a listing: the drive does not scratch it) or not, and of a type */
  setFile(name: string, o: { locked?: boolean; type?: DiskFileType; closed?: boolean }): void {
    const f = this.need(name, 'file'), b = this.bytes;
    if (o.locked != null) b[f.at + 2] = o.locked ? b[f.at + 2] | 0x40 : b[f.at + 2] & ~0x40;
    if (o.closed != null) b[f.at + 2] = o.closed ? b[f.at + 2] | 0x80 : b[f.at + 2] & ~0x80;
    if (o.type) {
      if (o.type === 'CBM' || o.type === 'REL') throw new TypeError(`a file is not made a ${o.type} file here`);
      b[f.at + 2] = (b[f.at + 2] & 0xf8) | TYPES.indexOf(o.type);
    }
  }

  /**
   * The BAM worked out again from what is on the disk, as the drive's V command: every sector free but the header's,
   * the BAM's, the directory's and those of the closed files; a file that was never closed is taken out of the
   * directory. Gives what was wrong: sectors the BAM had as taken that no file has, sectors of a file it had as free,
   * files whose chain is broken (they are left as they are, their sectors taken as far as the chain goes).
   */
  validate(): string[] {
    const problems: string[] = [];
    const was = new Set<number>();
    for (let t = 1; t <= this.bamTracks; t++) for (let s = 0; s < this.sectorsOn(t); s++) if (!this.isFree(t, s)) was.add(this.offset(t, s));
    for (let t = 1; t <= this.bamTracks; t++) for (let s = 0; s < this.sectorsOn(t); s++) this.release(t, s);
    const now = new Set<number>();
    const take = (t: number, s: number) => { if (t <= this.bamTracks) { this.allocate(t, s); now.add(this.offset(t, s)); } };
    take(this.dirTrack, 0);
    if (this.kind === 'd81') { take(40, 1); take(40, 2); }
    for (const [t, s] of this.dirSectors()) take(t, s);
    for (const f of this.files) {
      if (!f.closed) { this.bytes[f.at + 2] = 0; problems.push(`"${f.name}" was never closed: taken out of the directory`); continue; }
      let c: [number, number][] = [];
      try { c = this.chain(f); } catch (e) {
        problems.push((e as Error).message);
        // (as far as it goes)
        const seen = new Set<number>(); let t = f.track, s = f.sector;
        while (t !== 0 && this.has(t, s) && !seen.has(this.offset(t, s))) { seen.add(this.offset(t, s)); c.push([t, s]); const o = this.offset(t, s); [t, s] = [this.bytes[o], this.bytes[o + 1]]; }
      }
      for (const [t, s] of c) { if (now.has(this.offset(t, s)) && t <= this.bamTracks) problems.push(`"${f.name}" has track ${t} sector ${s}, which another file has too`); take(t, s); }
      if (f.type !== 'CBM' && c.length !== f.blocks) { this.bytes[f.at + 30] = c.length & 0xff; this.bytes[f.at + 31] = c.length >> 8; problems.push(`"${f.name}" is ${c.length} block${c.length === 1 ? '' : 's'}, the directory said ${f.blocks}`); }
    }
    const lost = [...was].filter(o => !now.has(o)).length, found = [...now].filter(o => !was.has(o)).length;
    if (lost) problems.push(`${lost} sector${lost === 1 ? ' was' : 's were'} taken in the BAM and no file has ${lost === 1 ? 'it' : 'them'}: free again`);
    if (found) problems.push(`${found} sector${found === 1 ? '' : 's'} of the files ${found === 1 ? 'was' : 'were'} free in the BAM: taken`);
    return problems;
  }
}
