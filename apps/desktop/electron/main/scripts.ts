/* The library of scripts as files (spec 10.3): the folder Scripts in the library's folder, a file a script (its code,
 * with a line at the top that says the rest: core's script-file.ts). Only this store touches the folder; the renderer
 * names a file by its plain name there. One change at a time (a queue), as the library's other files. */
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isScriptFileName, SCRIPT_FILE_MAX, SCRIPT_FOLDER } from '@mimir/core';
import type { ScriptsListing } from '../../shared/ipc';

export class ScriptStore {
  private queue: Promise<unknown> = Promise.resolve();
  /** `rootOf`: the library's folder now (the settings can change it); `trash`: a file moved to the Recycle Bin */
  constructor(private readonly rootOf: () => string, private readonly trash: (path: string) => Promise<void>) {}

  private run<T>(fn: () => Promise<T>): Promise<T> { const p = this.queue.then(fn, fn); this.queue = p.catch(() => undefined); return p; }

  /** the folder of the scripts */
  dir(): string { return join(this.rootOf(), SCRIPT_FOLDER); }
  /** a script's file, only by a plain name */
  path(file: string): string {
    if (!isScriptFileName(file)) throw new Error(`"${file}" is not a script's file name`);
    return join(this.dir(), file);
  }

  private async read(): Promise<ScriptsListing> {
    const dir = this.dir(), files: ScriptsListing['files'] = [];
    let names: string[] = [];
    try { names = await readdir(dir); } catch { return { dir, files }; }
    for (const file of names.sort((a, b) => a.localeCompare(b))) {
      if (!isScriptFileName(file)) continue;
      try {
        const p = join(dir, file), st = await stat(p);
        if (!st.isFile() || st.size > SCRIPT_FILE_MAX) continue;
        files.push({ file, text: await readFile(p, 'utf8'), mtime: st.mtimeMs });
      } catch { /* gone, or not readable: not in the list */ }
    }
    return { dir, files };
  }

  /** the scripts in the folder, by file name */
  list(): Promise<ScriptsListing> { return this.run(() => this.read()); }

  /** a script's file written (in place of the one of that name), and one that it takes the place of under another
   *  name (`was`: a script renamed, or one that became JavaScript) moved to the Recycle Bin */
  save(req: { file: string; text: string; was?: string }): Promise<ScriptsListing> {
    return this.run(async () => {
      const p = this.path(req.file);
      if (req.text.length > SCRIPT_FILE_MAX) throw new Error('the script is too long for the library');
      await mkdir(this.dir(), { recursive: true });
      await writeFile(p, req.text, 'utf8');
      if (req.was && req.was.toLowerCase() !== req.file.toLowerCase()) { try { await this.trash(this.path(req.was)); } catch { /* it was not there */ } }
      return this.read();
    });
  }

  /** a script's file to the Recycle Bin */
  remove(req: { file: string }): Promise<ScriptsListing> {
    return this.run(async () => {
      try { await this.trash(this.path(req.file)); } catch (e) { if (!/ENOENT|not exist|find/i.test(String(e))) throw e; }
      return this.read();
    });
  }
}
