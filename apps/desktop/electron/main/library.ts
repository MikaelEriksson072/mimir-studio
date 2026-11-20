/* The library's folder (spec 10.6): a folder for each kind (SIDs, Sprites, Chars, Bitmaps) with the files the user added and
 * library.json, which keeps where each was taken from. Only this store touches the folder; the renderer names a file
 * by its kind and its plain name in that kind's folder. One change at a time (a queue), as the quicksaves' history. */
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  isLibraryFileName, libraryExt, LIBRARY_FOLDERS, LIBRARY_INDEX, LIBRARY_KINDS, LIBRARY_MAX_BYTES, libraryHash, libraryIndexJson, libraryItems, readLibraryFile, readLibraryIndex,
  safeFileName, sidWithTexts, uniqueLibraryName, type LibraryEntry, type LibraryFile, type LibraryItem, type LibraryKind,
} from '@mimir/core';
import type { LibraryAddRequest, LibraryChangeResult, LibraryFileRequest, LibraryListing, LibraryUpdateRequest } from '../../shared/ipc';

/** where the library is when the settings name no folder: Mimir\Library in the documents folder, beside the projects */
export const defaultLibraryDir = (documents: string): string => join(documents, 'Mimir', 'Library');

export class LibraryStore {
  private queue: Promise<unknown> = Promise.resolve();
  /** `dirOf`: the library's folder now (the settings can change it); `trash`: a file moved to the Recycle Bin */
  constructor(private readonly dirOf: () => string, private readonly trash: (path: string) => Promise<void>) {}

  private run<T>(fn: () => Promise<T>): Promise<T> { const p = this.queue.then(fn, fn); this.queue = p.catch(() => undefined); return p; }

  /** the library's folder */
  root(): string { return this.dirOf(); }
  /** the folder of a kind's files */
  folder(kind: LibraryKind): string { return join(this.dirOf(), LIBRARY_FOLDERS[kind]); }
  /** a file of the library, only by a plain name of its kind */
  path(kind: LibraryKind, file: string): string {
    if (!isLibraryFileName(kind, file)) throw new Error(`"${file}" is not a file of the library's ${LIBRARY_FOLDERS[kind]}`);
    return join(this.folder(kind), file);
  }

  private async readIndex(): Promise<LibraryEntry[]> {
    try { return readLibraryIndex(JSON.parse(await readFile(join(this.dirOf(), LIBRARY_INDEX), 'utf8'))); } catch { return []; }
  }
  private async writeIndex(entries: readonly LibraryEntry[]): Promise<void> {
    await mkdir(this.dirOf(), { recursive: true });
    await writeFile(join(this.dirOf(), LIBRARY_INDEX), libraryIndexJson(entries));
  }
  /** the files in the kinds' folders (none that are too large, or not files) */
  private async files(): Promise<LibraryFile[]> {
    const out: LibraryFile[] = [];
    for (const kind of LIBRARY_KINDS) {
      let names: string[] = [];
      try { names = await readdir(this.folder(kind)); } catch { continue; }
      for (const file of names.sort((a, b) => a.localeCompare(b))) {
        if (!isLibraryFileName(kind, file)) continue;
        try {
          const p = join(this.folder(kind), file), st = await stat(p);
          if (!st.isFile() || st.size > LIBRARY_MAX_BYTES) continue;
          out.push({ kind, file, bytes: new Uint8Array(await readFile(p)), mtime: st.mtimeMs });
        } catch { /* gone, or not readable: not in the list */ }
      }
    }
    return out;
  }
  /** the library as the folders hold it; library.json is written again when a file was renamed or removed by hand */
  private async read(): Promise<LibraryListing> {
    const dir = this.dirOf(), exists = existsSync(dir);
    if (!exists) return { dir, exists, items: [] };
    const r = libraryItems(await this.readIndex(), await this.files());
    if (r.changed) await this.writeIndex(r.index).catch(() => undefined);
    return { dir, exists, items: r.items };
  }

  list(): Promise<LibraryListing> { return this.run(() => this.read()); }

  /** The file written in its kind's folder under a name of its own (`stem` made safe, and unique there), its entry
   *  in library.json. */
  add(req: LibraryAddRequest): Promise<LibraryChangeResult> {
    return this.run(async () => {
      const folder = this.folder(req.kind);
      await mkdir(folder, { recursive: true });
      const ext = libraryExt(req.kind, req.format);
      const r = readLibraryFile(req.kind, `x.${ext}`, req.bytes);
      if ('problem' in r) throw new Error(`Not a ${LIBRARY_FOLDERS[req.kind]} file: ${r.problem}`);
      const file = uniqueLibraryName(safeFileName(req.stem), ext, await readdir(folder));
      await writeFile(join(folder, file), req.bytes, { flag: 'wx' });
      // (a picture is multicolour as its format is)
      const mc = r.mc ?? req.entry.mc;
      const entry: LibraryEntry = { kind: req.kind, file, name: req.entry.name.trim() || file.replace(/\.[^.]+$/, ''), added: Date.now(), hash: libraryHash(r.data),
        ...(req.entry.from ? { from: req.entry.from } : {}), ...(mc != null ? { mc } : {}), ...(req.entry.colors ? { colors: req.entry.colors } : {}),
        ...(req.entry.digi ? { digi: req.entry.digi } : {}), ...(req.entry.busy?.length ? { busy: req.entry.busy } : {}) };
      await this.writeIndex([...(await this.readIndex()).filter(e => !(e.kind === entry.kind && e.file.toLowerCase() === file.toLowerCase())), entry]);
      return this.changed(req.kind, file);
    });
  }

  /** A file's name (a .sid's own too), its file's name (renamed to `stem`, unique in its folder) or how it is drawn.
   *  A file put there by hand gets an entry. */
  update(req: LibraryUpdateRequest): Promise<LibraryChangeResult> {
    return this.run(async () => {
      const p = this.path(req.kind, req.file);
      if (!existsSync(p)) throw new Error(`${req.file} is not in the library's ${LIBRARY_FOLDERS[req.kind]} any more`);
      const { items } = await this.read();
      const item = items.find(i => i.kind === req.kind && i.file === req.file);
      if (!item) throw new Error(`${req.file} is not a ${LIBRARY_FOLDERS[req.kind]} file Mimir reads`);
      let file = req.file, data = item.data;
      if (req.kind === 'sid' && req.name != null && req.name.trim()) {
        data = sidWithTexts(item.data, { name: req.name });
        await writeFile(p, data);
      }
      if (req.stem != null) {
        const others = (await readdir(this.folder(req.kind))).filter(f => f.toLowerCase() !== req.file.toLowerCase());
        const to = uniqueLibraryName(safeFileName(req.stem), extOf(req.file), others);
        if (to !== req.file) { await rename(p, join(this.folder(req.kind), to)); file = to; }
      }
      const { data: _d, load: _l, own: _o, ...was } = item;
      const entry: LibraryEntry = { ...was, file, hash: req.kind === 'sid' ? libraryHash(data) : was.hash,
        ...(req.name != null && req.name.trim() ? { name: req.name.trim() } : {}), ...(req.mc != null ? { mc: req.mc } : {}), ...(req.colors ? { colors: req.colors } : {}) };
      await this.writeIndex([...(await this.readIndex()).filter(e => !(e.kind === req.kind && e.file.toLowerCase() === req.file.toLowerCase())), entry]);
      return this.changed(req.kind, file);
    });
  }

  /** the file to the Recycle Bin, its entry out of library.json */
  remove(req: LibraryFileRequest): Promise<LibraryListing> {
    return this.run(async () => {
      const p = this.path(req.kind, req.file);
      if (existsSync(p)) await this.trash(p);
      const index = await this.readIndex();
      const next = index.filter(e => !(e.kind === req.kind && e.file.toLowerCase() === req.file.toLowerCase()));
      if (next.length !== index.length) await this.writeIndex(next);
      return this.read();
    });
  }

  private async changed(kind: LibraryKind, file: string): Promise<LibraryChangeResult> {
    const listing = await this.read();
    const item = listing.items.find((i): i is LibraryItem => i.kind === kind && i.file === file);
    if (!item) throw new Error(`${file} could not be read back from the library`);
    return { item, listing };
  }
}

const extOf = (file: string) => /\.([^.]+)$/.exec(file)?.[1] ?? '';
