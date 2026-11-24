/* =====================================================================
 * The export for a JavaScript script (spec 10.3): what Export writes (the sources, the binaries, the build scripts,
 * the README, the project file, the original files), as `exporter` in a script's code (script-js.ts; `export` is a
 * word of the language). A script reads the files, changes them, adds its own and has the export written:
 *
 *   exporter.name                  the project's name
 *   exporter.assembler             the assembler the sources are for: "kickass" or "64tass"
 *   exporter.folder                where the export goes: the project's source folder, else the folder exported to
 *                                  last; null when a folder will be asked for
 *   exporter.main                  the name of the first source ("raster-demo.asm")
 *   exporter.sources               the names of the sources, in the order they are built
 *   exporter.outDir                the folder of the built PRGs in the export ("out")
 *   exporter.files                 every file the export writes: [{ name, kind, size, text, bytes }], kind "source",
 *                                  "script" (build.bat, build.sh), "text" or "binary"; text is null for a binary
 *   exporter.names                 their names
 *   exporter.has(name)             whether the export has a file
 *   exporter.read(name)            a file's text (a binary's bytes); it throws when there is none
 *   exporter.add(name, content)    a file added, or put in place of one: a text or bytes
 *   exporter.edit(name, text => …) a text file changed: the function gets the text and gives the new one
 *   exporter.replace(name, from, to)
 *                                  every place a text (or a regular expression) is found in a text file, replaced;
 *                                  gives how many
 *   exporter.remove(name)          a file left out of the export
 *   exporter.rename(from, to)      a file under another name
 *   exporter.changes               what the script has done so far: { added, changed, removed }
 *   exporter.write({ elsewhere })  the export written when the run has ended well: to exporter.folder, or to a folder
 *                                  that is asked for (elsewhere: true, or no folder yet). It is verified first, as
 *                                  Export does; the verified PRGs are written to out/ as always
 *
 * Nothing is written during the run: the run ends with the request (ScriptRun.exports) and the app writes it, unless
 * the script is in safe mode, where Last run says what it would write.
 * ===================================================================== */
import type { Vfs } from './types';

/** what the app hands a script's run of the export as it is now */
export interface ScriptExportData {
  name: string;
  assembler: string;
  folder: string | null;
  main: string;
  sources: string[];
  outDir: string;
  files: Vfs;
}

/** what a script asked the export to be: the files it added or changed, those it took out, and where it goes */
export interface ScriptExportRequest {
  /** files added or put in place of the export's own, by name */
  files: Vfs;
  /** the export's own files left out */
  removed: string[];
  /** of `files`, those that stand in place of one the export has */
  changed: string[];
  /** a folder is asked for, also when the project has one */
  elsewhere: boolean;
}

export type ExportFileKind = 'source' | 'script' | 'text' | 'binary';

/** a name in the export's folder: forward slashes, no way out of the folder, no drive, nothing a file cannot have */
export function exportFileName(name: unknown, what: string): string {
  const n = String(name ?? '').replace(/\\/g, '/').trim();
  if (!n) throw new RangeError(`${what}: a file needs a name`);
  if (n.length > 200) throw new RangeError(`${what}: the name is longer than 200 characters`);
  if (/^\/|^[A-Za-z]:|[<>:"|?*\u0000-\u001f]/.test(n) || n.split('/').some(p => !p || p === '.' || p === '..' || /[. ]$/.test(p)))
    throw new RangeError(`${what}: ${JSON.stringify(n)} is no name of a file in the export's folder (a name, or folders and a name with /; no .., no drive)`);
  return n;
}

/** `exporter` for a script's run; `asked` is called with the request when the script calls write(). */
export function exportApi(data: ScriptExportData | null, asked: (r: ScriptExportRequest) => void): Record<string, unknown> {
  const need = (): ScriptExportData => { if (!data) throw new Error('exporter: there is nothing to export here (the project has no file, or the script runs where the export is not given: Run on files, Run with values, before Build & Run)'); return data; };
  const own = new Map<string, string | Uint8Array>(Object.entries(data?.files ?? {}));
  // the export as the script has made it: its own files, less the removed, with the added
  const now = new Map(own), touched = new Set<string>(), removed = new Set<string>();
  const key = (name: unknown, what: string): string => {
    const n = exportFileName(name, what);
    if (now.has(n)) return n;
    // (Windows' file names: the case does not tell two files apart)
    const low = n.toLowerCase();
    for (const k of now.keys()) if (k.toLowerCase() === low) return k;
    return n;
  };
  const kindOf = (name: string, v: string | Uint8Array): ExportFileKind =>
    typeof v !== 'string' ? 'binary' : data?.sources.includes(name) || /\.(asm|s|inc|sym)$/i.test(name) ? 'source' : /(^|\/)build\.(bat|sh)$/i.test(name) ? 'script' : 'text';
  const enc = new TextEncoder();
  const file = (name: string, v: string | Uint8Array) => ({ name, kind: kindOf(name, v), size: typeof v === 'string' ? enc.encode(v).length : v.length, text: typeof v === 'string' ? v : null, bytes: typeof v === 'string' ? enc.encode(v) : v });
  const put = (n: string, v: string | Uint8Array) => { now.set(n, v); removed.delete(n); touched.add(n); };
  const text = (name: unknown, what: string): [string, string] => {
    const n = key(name, what), v = now.get(n);
    if (v == null) throw new RangeError(`${what}: the export has no file ${JSON.stringify(n)} (exporter.names lists them)`);
    if (typeof v !== 'string') throw new TypeError(`${what}: ${n} is a binary file, not a text`);
    return [n, v];
  };
  const api: Record<string, unknown> = {
    has: (name: unknown): boolean => { need(); return now.has(key(name, 'exporter.has')); },
    read(name: unknown): string | Uint8Array {
      need();
      const n = key(name, 'exporter.read'), v = now.get(n);
      if (v == null) throw new RangeError(`exporter.read: the export has no file ${JSON.stringify(n)} (exporter.names lists them)`);
      return typeof v === 'string' ? v : v.slice();
    },
    add(name: unknown, content: unknown) {
      need();
      const n = key(name, 'exporter.add');
      if (typeof content === 'string') put(n, content);
      else if (content instanceof Uint8Array) put(n, content.slice());
      else if (Array.isArray(content)) put(n, Uint8Array.from(content as number[]));
      else throw new TypeError('exporter.add: the content is a text, or bytes (a Uint8Array, such as mem.subarray(…))');
      if (touched.size > 2000) throw new RangeError('exporter.add: a script adds or changes 2000 files at most');
    },
    edit(name: unknown, change: unknown): boolean {
      need();
      const [n, old] = text(name, 'exporter.edit');
      if (typeof change !== 'function') throw new TypeError('exporter.edit: give a function that takes the text and gives the new text: exporter.edit(name, text => text + "…")');
      const next = (change as (t: string) => unknown)(old);
      if (typeof next !== 'string') throw new TypeError(`exporter.edit: the function gave no text for ${n}`);
      if (next === old) return false;
      put(n, next);
      return true;
    },
    replace(name: unknown, from: unknown, to: unknown): number {
      need();
      const [n, old] = text(name, 'exporter.replace');
      let count = 0, next: string;
      if (from instanceof RegExp) { const re = new RegExp(from.source, from.flags.includes('g') ? from.flags : from.flags + 'g'); count = (old.match(re) ?? []).length; next = typeof to === 'function' ? old.replace(re, to as (s: string, ...a: unknown[]) => string) : old.replace(re, String(to ?? '')); }
      else { const f = String(from ?? ''); if (!f) throw new RangeError('exporter.replace: the text to find is empty'); const parts = old.split(f); count = parts.length - 1; next = parts.join(String(to ?? '')); }
      if (count && next !== old) put(n, next);
      return count;
    },
    remove(name: unknown): boolean {
      need();
      const n = key(name, 'exporter.remove');
      if (!now.has(n)) return false;
      now.delete(n); touched.delete(n);
      if (own.has(n)) removed.add(n);
      return true;
    },
    rename(from: unknown, to: unknown) {
      need();
      const a = key(from, 'exporter.rename'), v = now.get(a), b = exportFileName(to, 'exporter.rename');
      if (v == null) throw new RangeError(`exporter.rename: the export has no file ${JSON.stringify(a)}`);
      if (b !== a && now.has(key(b, 'exporter.rename'))) throw new RangeError(`exporter.rename: the export has a file ${JSON.stringify(b)} already`);
      now.delete(a); touched.delete(a);
      if (own.has(a)) removed.add(a);
      put(b, v);
    },
    write(o: { elsewhere?: boolean } = {}): string[] {
      need();
      const files: Vfs = {}, changed: string[] = [];
      for (const n of touched) { const v = now.get(n); if (v == null) continue; const was = own.get(n); if (was != null && same(was, v)) continue; files[n] = v; if (was != null) changed.push(n); }
      asked({ files, removed: [...removed].filter(n => !now.has(n)), changed, elsewhere: !!o?.elsewhere });
      return [...now.keys()];
    },
  };
  const get = (name: string, f: () => unknown) => Object.defineProperty(api, name, { enumerable: true, get: f });
  get('name', () => need().name); get('assembler', () => need().assembler); get('folder', () => need().folder);
  get('main', () => need().main); get('sources', () => [...need().sources]); get('outDir', () => need().outDir);
  get('files', () => { need(); return [...now].map(([n, v]) => file(n, v)); });
  get('names', () => { need(); return [...now.keys()]; });
  get('changes', () => {
    need();
    const added: string[] = [], changed: string[] = [];
    for (const n of touched) { const was = own.get(n), v = now.get(n); if (v == null) continue; if (was == null) added.push(n); else if (!same(was, v)) changed.push(n); }
    return { added, changed, removed: [...removed].filter(n => !now.has(n)) };
  });
  return api;
}

function same(a: string | Uint8Array, b: string | Uint8Array): boolean {
  if (typeof a === 'string' || typeof b === 'string') return a === b;
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** The export a script asked for, laid over the export as it is when it is written: the files as they go to the
 *  folder, and the changed files left out because the program is no longer the one the script read (`stale`: the
 *  run changed the program, so a source the script edited is not the source any more). */
export function applyExportRequest(files: Vfs, r: ScriptExportRequest, programChanged: boolean): { files: Vfs; stale: string[] } {
  const out: Vfs = { ...files }, stale: string[] = [];
  for (const n of r.removed) delete out[n];
  for (const [n, v] of Object.entries(r.files)) {
    // a generated source changed by the script, when the run also changed the program: the script's text was made
    // from the source before the change
    if (programChanged && r.changed.includes(n) && /\.(asm|s|inc|sym|md|json)$/i.test(n) && typeof files[n] === 'string') { stale.push(n); continue; }
    out[n] = v;
  }
  return { files: out, stale };
}

/** What a request does, a line each: for Last run (and what a safe run would do). */
export function exportRequestText(r: ScriptExportRequest): string[] {
  const added = Object.keys(r.files).filter(n => !r.changed.includes(n));
  const list = (names: string[]) => `${names.slice(0, 6).join(', ')}${names.length > 6 ? `, and ${names.length - 6} more` : ''}`;
  return [
    r.elsewhere ? 'The export, to a folder that is asked for' : 'The export, to the project\'s folder (a folder is asked for when there is none)',
    ...(added.length ? [`${added.length} file${added.length === 1 ? '' : 's'} added: ${list(added)}`] : []),
    ...(r.changed.length ? [`${r.changed.length} file${r.changed.length === 1 ? '' : 's'} changed: ${list(r.changed)}`] : []),
    ...(r.removed.length ? [`${r.removed.length} file${r.removed.length === 1 ? '' : 's'} left out: ${list(r.removed)}`] : []),
    ...(!added.length && !r.changed.length && !r.removed.length ? ['The files as Export writes them'] : []),
  ];
}
