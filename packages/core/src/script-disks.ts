/* =====================================================================
 * Disk images for a JavaScript script (spec 10.3), as `disks`: a 1541 disk (.d64) and a 1581 disk (.d81) made and
 * changed (c64/diskedit.ts).
 *
 *   disks.create("d64" or "d81", { name, id })   a new, formatted disk
 *   disks.open(bytes)             a disk image's bytes (a file read from somewhere, what another call made) to work on
 *   disks.mounted                 the mounted disk to work on, a copy: a D64, a G64's sectors as a D64, or the D81
 *                                 that was mounted for scripts; null without one
 *   a disk: kind, name, id (both set too), dosType, tracks, sectors, size, free, files, bytes (the image, as it is now)
 *     find(name), has(name), read(name)                  a file's entry, and its bytes
 *     add(name, bytes, { type, load, replace })          a file added, in free sectors as the drive's DOS takes them
 *     remove(name), rename(name, to), lock(name, on), setType(name, type)
 *     sector(track, sector)                              a sector's 256 bytes in the image: written there, it is on the disk
 *     sectorsOn(track), isFree(t, s), allocate(t, s), release(t, s), chain(name)
 *     validate()                  the BAM worked out again from the files, as the drive's V command; gives what was wrong
 *     format(name, id)            everything off the disk
 *     list()                      the directory as LOAD"$" lists it, a line each
 *     file()                      the image's bytes, a copy
 *     save(fileName)              the image a file of the run (Last run: Save…)
 *     mount()                     asks for the image to be the mounted disk when the run has ended well
 *
 * A disk a script works on is the script's own: the mounted disk and the files on the PC are as they were. What it
 * made leaves the run as a file (save) or as the mounted disk (mount).
 * ===================================================================== */
import { DiskEdit, diskKindOf, type DiskEntry, type DiskFileType, type DiskKind } from './c64/diskedit';
import { diskSectors } from './c64/d64';
import { h4 } from './util/hex';

/** the disk a script may take a copy of: the mounted one */
export interface ScriptDisksData { name: string; bytes: Uint8Array }
/** what a script asked for with a disk's mount(): the image to mount */
export interface ScriptDiskRequest { name: string; kind: DiskKind; bytes: Uint8Array; files: number; free: number }

export const diskRequestText = (r: ScriptDiskRequest): string => `${r.name} mounted (${r.kind === 'd81' ? 'a D81' : 'a D64'}, ${r.files} file${r.files === 1 ? '' : 's'}, ${r.free} blocks free)`;

const FILE_TYPES: readonly string[] = ['PRG', 'SEQ', 'USR', 'DEL'];

/** `disks` for a script. `save` makes a file of the run; `asked` takes what mount() asks for. */
export function disksApi(mounted: ScriptDisksData | null, ctx: { addr: (where: unknown) => number; save: (name: string, bytes: Uint8Array) => void }, asked: (r: ScriptDiskRequest) => void): Record<string, unknown> {
  const bytesOf = (v: unknown, what: string): Uint8Array => {
    if (v instanceof Uint8Array) return v;
    if (Array.isArray(v)) return Uint8Array.from(v as number[]);
    throw new TypeError(`${what}: bytes are wanted (a Uint8Array, such as mem.subarray(…), disk.read(…) or another disk's read(…))`);
  };
  const text = (v: unknown, what: string): string => { if (typeof v !== 'string') throw new TypeError(`${what}: a name is wanted, a text (not ${String(v)})`); return v; };
  const num = (v: unknown, what: string): number => { const n = Number(v); if (!Number.isInteger(n)) throw new TypeError(`${what}: a number is wanted (not ${String(v)})`); return n; };
  const typeOf = (v: unknown, what: string): DiskFileType => {
    const t = String(v ?? 'prg').toUpperCase();
    if (!FILE_TYPES.includes(t)) throw new TypeError(`${what}: the type is "prg", "seq", "usr" or "del" (not "${String(v)}")`);
    return t as DiskFileType;
  };
  const entry = (d: DiskEdit, f: DiskEntry) => Object.freeze({ name: f.name, type: f.type.toLowerCase(), blocks: f.blocks, track: f.track, sector: f.sector, locked: f.locked, closed: f.closed,
    get size() { try { return d.read(f.name).length; } catch { return 0; } } });

  const wrap = (d: DiskEdit, file: string): Record<string, unknown> => {
    const ext = d.kind;
    const o = {
      kind: d.kind, tracks: d.tracks, sectors: d.sectors, size: d.bytes.length, bytes: d.bytes,
      find(name: unknown) { const f = d.find(text(name, 'find')); return f ? entry(d, f) : null; },
      has: (name: unknown) => !!d.find(text(name, 'has')),
      read: (name: unknown) => d.read(text(name, 'read')),
      add(name: unknown, bytes: unknown, opts?: unknown) {
        const n = text(name, 'add'), q = (opts && typeof opts === 'object' ? opts : {}) as Record<string, unknown>;
        let data = bytesOf(bytes, 'add');
        // (a load address in front, for bytes that are a program's without one)
        if (q.load != null) { const a = ctx.addr(q.load), w = new Uint8Array(data.length + 2); w[0] = a & 0xff; w[1] = a >> 8; w.set(data, 2); data = w; }
        const type = typeOf(q.type, 'add');
        if (q.replace && d.find(n)) {
          // (taken back when the new one does not fit)
          const keep = d.bytes.slice();
          d.remove(n);
          try { return entry(d, d.add(n, data, type)); } catch (e) { d.bytes.set(keep); throw e; }
        }
        return entry(d, d.add(n, data, type));
      },
      remove(name: unknown) { const f = d.remove(text(name, 'remove')); return { name: f.name, blocks: f.blocks }; },
      rename(name: unknown, to: unknown) { d.rename(text(name, 'rename'), text(to, 'rename')); },
      lock(name: unknown, on: unknown = true) { d.setFile(text(name, 'lock'), { locked: !!on }); },
      setType(name: unknown, type: unknown) { d.setFile(text(name, 'setType'), { type: typeOf(type, 'setType') }); },
      sector: (t: unknown, s: unknown) => d.sector(num(t, 'sector'), num(s, 'sector')),
      sectorsOn(t: unknown) { const n = num(t, 'sectorsOn'); if (n < 1 || n > d.tracks) throw new RangeError(`sectorsOn: the disk has tracks 1-${d.tracks} (not ${n})`); return d.sectorsOn(n); },
      isFree: (t: unknown, s: unknown) => d.isFree(num(t, 'isFree'), num(s, 'isFree')),
      allocate: (t: unknown, s: unknown) => d.allocate(num(t, 'allocate'), num(s, 'allocate')),
      release: (t: unknown, s: unknown) => d.release(num(t, 'release'), num(s, 'release')),
      chain(name: unknown) { const f = d.find(text(name, 'chain')); if (!f) throw new ReferenceError(`chain: no file "${String(name)}" on the disk`); return d.chain(f).map(([track, sector]) => ({ track, sector })); },
      validate: () => d.validate(),
      format(name: unknown = d.name, id: unknown = d.id) { d.formatDisk(String(name), String(id)); },
      list(): string[] {
        return [`0 "${d.name.padEnd(16)}" ${d.id.padEnd(2)} ${d.dosType}`,
          ...d.files.map(f => `${String(f.blocks).padEnd(5)}"${f.name}"${' '.repeat(Math.max(0, 16 - f.name.length))}${f.closed ? ' ' : '*'}${f.type}${f.locked ? '<' : ''}`),
          `${d.free} BLOCKS FREE.`];
      },
      file: (): Uint8Array => d.bytes.slice(),
      save(name?: unknown) {
        const n = name == null ? file : String(name);
        const full = /\.[A-Za-z0-9]{1,4}$/.test(n) ? n : `${n}.${ext}`;
        ctx.save(full, d.bytes.slice());
        return full;
      },
      mount(name?: unknown) {
        const n = name == null ? file : String(name);
        asked({ name: /\.[A-Za-z0-9]{1,4}$/.test(n) ? n : `${n}.${ext}`, kind: d.kind, bytes: d.bytes.slice(), files: d.files.length, free: d.free });
      },
      toString: () => `${d.kind === 'd81' ? 'D81' : 'D64'} "${d.name}" ${d.id}: ${d.files.length} file${d.files.length === 1 ? '' : 's'}, ${d.free} blocks free`,
    };
    Object.defineProperties(o, {
      name: { enumerable: true, get: () => d.name, set: (v: unknown) => { d.name = String(v); } },
      id: { enumerable: true, get: () => d.id, set: (v: unknown) => { d.id = String(v); } },
      dosType: { enumerable: true, get: () => d.dosType },
      free: { enumerable: true, get: () => d.free },
      files: { enumerable: true, get: () => d.files.map(f => entry(d, f)) },
    });
    return o;
  };

  const kindOf = (k: unknown, what: string): DiskKind => {
    const s = String(k ?? '').toLowerCase().replace(/^\./, '');
    if (s === 'd64' || s === '1541') return 'd64';
    if (s === 'd81' || s === '1581') return 'd81';
    throw new TypeError(`${what}: the kind is "d64" (a 1541 disk) or "d81" (a 1581 disk), not "${String(k)}"`);
  };
  const open = (bytes: Uint8Array, name: string, what: string) => {
    // (a G64: its sectors, as a D64)
    let b = bytes;
    try { b = diskSectors(bytes); } catch { /* not one */ }
    if (!diskKindOf(b)) throw new TypeError(`${what}: ${bytes.length} bytes are not a disk image (a D64 has 174848, a D81 819200; $${h4(bytes.length & 0xffff)} is neither)`);
    return wrap(new DiskEdit(b.slice()), name.replace(/\.g64$/i, '.d64'));
  };
  return {
    kinds: ['d64', 'd81'],
    create(kind: unknown, opts?: unknown) {
      const k = kindOf(kind, 'disks.create'), q = (opts && typeof opts === 'object' ? opts : {}) as Record<string, unknown>;
      const name = String(q.name ?? ''), id = String(q.id ?? '01');
      if ([...name].length > 16) throw new RangeError(`disks.create: a disk's name is 16 characters at most ("${name}" is ${[...name].length})`);
      if ([...id].length > 2) throw new RangeError(`disks.create: a disk's ID is two characters ("${id}")`);
      return wrap(DiskEdit.format(k, name, id), `${(name || 'disk').toLowerCase().replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_')}.${k}`);
    },
    open: (bytes: unknown, name?: unknown) => open(bytesOf(bytes, 'disks.open'), name == null ? 'disk' : String(name), 'disks.open'),
    get mounted() { return mounted ? open(mounted.bytes, mounted.name, 'disks.mounted') : null; },
    blocksFor(n: unknown) { return DiskEdit.blocksFor(num(typeof n === 'number' ? n : (n as { length?: number })?.length, 'disks.blocksFor')); },
  };
}
