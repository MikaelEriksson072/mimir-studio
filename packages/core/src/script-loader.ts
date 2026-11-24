/* =====================================================================
 * The loader for a JavaScript script (spec 10.3): what the loader tab of the mounted disk or tape shows (Spindle,
 * Bitfire, BoozeLoader, Sparkle, IFFL, Krill's, Covert Bitops', DLoC's, Pirate Slayer, Para-Protect, Disk-Speed, a
 * tape), as `loader` in a script's code (script-js.ts): the files the loader loads, unpacked where the tab unpacks
 * them, and its script.
 *
 *   loader                       the loader of the mounted disk (else of the tape), or null when Mimir knows none
 *   loaders                      all of them (a disk's, then the tape's): a list, empty when there is none
 *   loader.name                  which loader: "Spindle", "Sparkle", "Krill's loader", "Tape", …
 *   loader.disk                  the name of the disk image or tape it is on
 *   loader.script                the loader script as the tab writes it (the tool's own script that builds the disk
 *                                again, or the list of the files), a text; loader.lines the same as lines
 *   loader.groups                what one call of the loader loads together (a Spindle job, a Sparkle bundle, an
 *                                IFFL part; else a file each): [{ name, what, files, start, end, size }]
 *   loader.files                 every file, in the order they load: [{ name, group, index, start, end, size, bytes,
 *                                prg }], bytes without a load address, prg with it
 *   loader.find(name)            a file by its name (with or without its extension, any case), or by its number in
 *                                loader.files; null when there is none
 *   loader.group(name)           a group by its name or its number
 *   loader.load(what, at)        a file (a name, a number or one of loader.files) or a group (one of loader.groups, or
 *                                its name) copied into mem where it loads (a file can be put elsewhere with at):
 *                                { start, end } of what was written
 *   loader.at(address)           the files that cover an address when they are loaded
 *
 * Addresses' ends are the address after the last byte, as everywhere in a script.
 * ===================================================================== */

/** a loader as the app hands it to a script's run: its groups with their files' bytes */
export interface ScriptLoaderData {
  /** which loader ("Spindle", "Sparkle", …) */
  name: string;
  /** the disk image's or the tape's name */
  from: string;
  /** the loader script as the tab writes it, a line each (none: the loader has no script) */
  script: string[];
  groups: { name: string; what: string; files: { name: string; load: number; bytes: Uint8Array }[] }[];
}

interface LoaderFile { name: string; group: string; index: number; start: number; end: number; size: number; bytes: Uint8Array; prg: Uint8Array }
interface LoaderGroup { name: string; what: string; files: LoaderFile[]; start: number; end: number; size: number }

const stem = (s: string) => s.toLowerCase().replace(/\.[a-z0-9]{1,4}$/, '');

/** One loader for a script's run. */
function oneLoader(d: ScriptLoaderData, ctx: { mem: Uint8Array; addr: (where: unknown) => number }): Record<string, unknown> {
  const files: LoaderFile[] = [];
  const groups: LoaderGroup[] = d.groups.map(g => {
    const own = g.files.map(f => {
      const bytes = f.bytes.subarray(0, Math.max(0, 0x10000 - f.load)), prg = new Uint8Array(bytes.length + 2);
      prg[0] = f.load & 0xff; prg[1] = f.load >> 8; prg.set(bytes, 2);
      const file: LoaderFile = { name: f.name, group: g.name, index: files.length, start: f.load, end: f.load + bytes.length, size: bytes.length, bytes, prg };
      files.push(file);
      return file;
    });
    return { name: g.name, what: g.what, files: own, start: own.length ? Math.min(...own.map(f => f.start)) : 0, end: own.length ? Math.max(...own.map(f => f.end)) : 0, size: own.reduce((n, f) => n + f.size, 0) };
  });
  const isFile = (v: unknown): v is LoaderFile => !!v && typeof v === 'object' && files.includes(v as LoaderFile);
  const isGroup = (v: unknown): v is LoaderGroup => !!v && typeof v === 'object' && groups.includes(v as LoaderGroup);
  const find = (what: unknown): LoaderFile | null => {
    if (isFile(what)) return what;
    if (typeof what === 'number') return files[what] ?? null;
    const n = String(what ?? '').toLowerCase();
    return files.find(f => f.name.toLowerCase() === n) ?? files.find(f => stem(f.name) === stem(n)) ?? null;
  };
  const group = (what: unknown): LoaderGroup | null => {
    if (isGroup(what)) return what;
    if (typeof what === 'number') return groups[what] ?? null;
    const n = String(what ?? '').toLowerCase();
    return groups.find(g => g.name.toLowerCase() === n) ?? null;
  };
  const put = (f: LoaderFile, at: number): { start: number; end: number } => {
    const b = f.bytes.subarray(0, Math.max(0, 0x10000 - at));
    ctx.mem.set(b, at);
    return { start: at, end: at + b.length };
  };
  return {
    name: d.name, disk: d.from, script: d.script.join('\n'), lines: [...d.script], groups, files,
    find, group,
    load(what: unknown, at?: unknown) {
      const g = isGroup(what) ? what : isFile(what) || typeof what === 'number' ? null : find(what) ? null : group(what);
      if (g) {
        if (at != null) throw new RangeError(`loader.load: a group loads where its files load (${g.name} has ${g.files.length}): give a file to put it elsewhere`);
        for (const f of g.files) put(f, f.start);
        return { start: g.start, end: g.end };
      }
      const f = find(what);
      if (!f) throw new RangeError(`loader.load: ${d.name} on ${d.from} has no file or group ${typeof what === 'number' ? what : JSON.stringify(String(what))} (loader.files lists them)`);
      return put(f, at == null ? f.start : ctx.addr(at));
    },
    at(where: unknown): LoaderFile[] { const a = ctx.addr(where); return files.filter(f => a >= f.start && a < f.end); },
  };
}

/** `loader` and `loaders` for a script's run. */
export function loaderApi(data: readonly ScriptLoaderData[], ctx: { mem: Uint8Array; addr: (where: unknown) => number }): { loader: Record<string, unknown> | null; loaders: Record<string, unknown>[] } {
  const loaders = data.map(d => oneLoader(d, ctx));
  return { loader: loaders[0] ?? null, loaders };
}
