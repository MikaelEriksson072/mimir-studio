/* The macro and code libraries as files (spec 10.8): the folders Macros and Code in the library's folder, a file an item
 * (its code, with a line at the top that says the rest: core's code-library.ts). Only this store touches the folders;
 * the renderer names a file by its kind and its plain name there. One change at a time (a queue), as the library's
 * other files. */
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  CODE_LIB_FILE_MAX, CODE_LIB_FOLDERS, CODE_LIB_KINDS, codeLibFileName, codeLibFileText, codeLibNameOf, codeLibStem, isCodeLibFileName, readCodeLibFile, type CodeLibItem, type CodeLibKind,
} from '@mimir/core';
import type { CodeLibChange, CodeLibFileRequest, CodeLibListing, CodeLibSaveRequest } from '../../shared/ipc';

export class CodeLibStore {
  private queue: Promise<unknown> = Promise.resolve();
  /** `rootOf`: the library's folder now (the settings can change it); `trash`: a file moved to the Recycle Bin;
   *  `now`: the time an item is made at */
  constructor(private readonly rootOf: () => string, private readonly trash: (path: string) => Promise<void>, private readonly now: () => number = Date.now) {}

  private run<T>(fn: () => Promise<T>): Promise<T> { const p = this.queue.then(fn, fn); this.queue = p.catch(() => undefined); return p; }

  /** a kind's folder */
  folder(kind: CodeLibKind): string { return join(this.rootOf(), CODE_LIB_FOLDERS[kind]); }
  /** an item's file, only by its kind and a plain name */
  path(kind: CodeLibKind, file: string): string {
    if (!isCodeLibFileName(file)) throw new Error(`"${file}" is not a file of the ${CODE_LIB_FOLDERS[kind]} library`);
    return join(this.folder(kind), file);
  }

  private async items(kind: CodeLibKind): Promise<CodeLibItem[]> {
    let names: string[] = [];
    try { names = await readdir(this.folder(kind)); } catch { return []; }
    const out: CodeLibItem[] = [];
    for (const file of names) {
      if (!isCodeLibFileName(file)) continue;
      try {
        const p = join(this.folder(kind), file), st = await stat(p);
        if (!st.isFile() || st.size > CODE_LIB_FILE_MAX) continue;
        const item = readCodeLibFile(kind, file, await readFile(p, 'utf8'), { changed: st.mtimeMs, born: st.birthtimeMs });
        if (item) out.push(item);
      } catch { /* gone, or not readable: not in the list */ }
    }
    return out;
  }
  private async read(): Promise<CodeLibListing> {
    const items: CodeLibItem[] = [];
    for (const kind of CODE_LIB_KINDS) items.push(...await this.items(kind));
    return { dir: this.rootOf(), folders: { macro: this.folder('macro'), code: this.folder('code') }, items };
  }

  /** the macros and the code in the folders */
  list(): Promise<CodeLibListing> { return this.run(() => this.read()); }

  /**
   * An item written: a new one (`was` missing) in its kind's folder under its name (made unique there), made now; one
   * of the library (`was`) in its place, renamed when its name changed, moved to the other folder when its kind did;
   * when it was made stays as its file says.
   */
  save(req: CodeLibSaveRequest): Promise<CodeLibChange> {
    return this.run(async () => {
      const folder = this.folder(req.kind);
      await mkdir(folder, { recursive: true });
      let created = this.now();
      const old = req.was ? this.path(req.was.kind, req.was.file) : null;
      const was = req.was;
      if (old && was) {
        if (!existsSync(old)) throw new Error(`${was.file} is not in the ${CODE_LIB_FOLDERS[was.kind]} library any more`);
        const st = await stat(old), item = readCodeLibFile(was.kind, was.file, await readFile(old, 'utf8'), { changed: st.mtimeMs, born: st.birthtimeMs });
        if (item) created = item.created;
      }
      // its own file is not another's name; its name as it was (any case) keeps its file's extension (.s, .inc …)
      const stay = !!was && was.kind === req.kind;
      const taken = (await readdir(folder)).filter(f => !(stay && f.toLowerCase() === was!.file.toLowerCase()));
      const stem = codeLibStem(req.name);
      const file = stay && codeLibNameOf(was!.file).toLowerCase() === stem.toLowerCase() ? `${stem}${/\.[^.]+$/.exec(was!.file)![0]}` : codeLibFileName(req.name, taken);
      const text = codeLibFileText({ lang: req.lang, description: req.description, created, ...(req.color ? { color: req.color } : {}), ...(req.from ? { from: req.from } : {}) }, req.code);
      if (text.length > CODE_LIB_FILE_MAX) throw new Error('the code is too long for the library');
      const p = join(folder, file);
      // (a rename where only the letters' case changed too)
      if (old && old !== p) await rename(old, p);
      await writeFile(p, text, { encoding: 'utf8', ...(old ? {} : { flag: 'wx' }) });
      const listing = await this.read();
      const item = listing.items.find(i => i.kind === req.kind && i.file === file);
      if (!item) throw new Error(`${file} could not be read back from the library`);
      return { item, listing };
    });
  }

  /** an item's file to the Recycle Bin */
  remove(req: CodeLibFileRequest): Promise<CodeLibListing> {
    return this.run(async () => {
      const p = this.path(req.kind, req.file);
      if (existsSync(p)) await this.trash(p);
      return this.read();
    });
  }
}
