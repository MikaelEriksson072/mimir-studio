/* The Assembler (spec 10.7): a folder of Kick Assembler or 64tass sources, edited in the app. The folders opened in it
 * (the newest first) are kept as JSON in the user data folder, so the Assembler can offer them again; a file is only
 * ever named by its path inside the folder (no absolute paths, no `..`), and the folder must be one the user picked in
 * this session or one opened in the Assembler before. Deleting moves a file to the Recycle Bin. */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, normalize, relative, resolve } from 'node:path';
import { z } from 'zod';
import type { AsmChangeRequest, AsmEntry, AsmFolder, AsmReadResult, AsmRecent } from '../../shared/ipc';
import { projectNameProblem } from '../../shared/projects';

/** how many folders the Assembler lists */
export const RECENT_ASM = 12;
/** at most this many files and folders are listed (a folder with more says so) */
export const ASM_LIST_MAX = 4000;
/** how deep the listing goes */
const ASM_DEPTH = 12;
/** a file bigger than this is not read */
export const ASM_READ_MAX = 16 * 1024 * 1024;
/** folders the listing leaves out: version control's and tools' own */
const SKIP = new Set(['.git', '.svn', '.hg', 'node_modules', '.vs', '.idea', '.DS_Store', 'Thumbs.db', 'desktop.ini']);

const path = z.string().min(1).max(4096);
const fileSchema = z.object({ recent: z.array(z.object({ dir: path, opened: z.number() })).max(100).default([]) });
type Stored = z.output<typeof fileSchema>;

const isDir = (p: string | undefined): p is string => { try { return !!p && existsSync(p) && statSync(p).isDirectory(); } catch { return false; } };
const same = (a: string, b: string) => resolve(normalize(a)).toLowerCase() === resolve(normalize(b)).toLowerCase();

/** The folders opened in the Assembler, the newest first. */
export class AsmStore {
  private readonly file: string;
  private value: Stored = { recent: [] };

  constructor(dir: string) {
    this.file = join(dir, 'assembler.json');
    try {
      if (existsSync(this.file)) this.value = fileSchema.parse(JSON.parse(readFileSync(this.file, 'utf8')));
    } catch {
      this.value = { recent: [] }; // an unreadable file only means the Assembler has no folders to offer
    }
  }

  recent(): AsmRecent[] {
    return this.value.recent.map(r => ({ dir: r.dir, name: basename(r.dir) || r.dir, opened: r.opened, exists: isDir(r.dir) }));
  }

  /** `dir` opened: at the top of the list */
  enter(dir: string): void {
    this.value = { recent: [{ dir: resolve(dir), opened: Date.now() }, ...this.value.recent.filter(r => !same(r.dir, dir))].slice(0, RECENT_ASM) };
    this.write();
  }

  /** a folder opened before (it opens again without a dialog) */
  isRecent(dir: string): boolean { return this.value.recent.some(r => same(r.dir, dir)); }

  forget(dir: string): AsmRecent[] {
    this.value = { recent: this.value.recent.filter(r => !same(r.dir, dir)) };
    this.write();
    return this.recent();
  }

  private write(): void {
    try { mkdirSync(dirname(this.file), { recursive: true }); writeFileSync(this.file, JSON.stringify(this.value, null, 2)); } catch { /* best effort */ }
  }
}

/** a path inside the folder, as the renderer names it (`src/main.asm`), made the file's full path; anything that leaves
 *  the folder (an absolute path, `..`) or names nothing is refused */
export function inFolder(dir: string, rel: string): string {
  if (typeof rel !== 'string' || !rel || rel.length > 1024 || isAbsolute(rel) || /^[\\/]|^[A-Za-z]:/.test(rel)) throw new Error(`"${rel}" is not a path inside the folder`);
  // eslint-disable-next-line no-control-regex
  if (rel.split(/[\\/]/).some(p => !p || p === '.' || p === '..' || /[<>:"|?*\u0000-\u001f]/.test(p))) throw new Error(`"${rel}" is not a path inside the folder`);
  const full = resolve(dir, rel), r = relative(resolve(dir), full);
  if (!r || r.startsWith('..') || isAbsolute(r)) throw new Error(`"${rel}" is not a path inside the folder`);
  return full;
}

/** what is in the folder: its files and folders, the folders first, each by name (`more`: there are more than listed) */
export async function listFolder(dir: string): Promise<AsmFolder> {
  const root = resolve(dir), entries: AsmEntry[] = [];
  let more = false;
  const walk = async (rel: string, depth: number): Promise<void> => {
    if (depth > ASM_DEPTH) return;
    let items;
    try { items = await readdir(rel ? join(root, rel) : root, { withFileTypes: true }); } catch { return; }
    items.sort((a, b) => +b.isDirectory() - +a.isDirectory() || a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }));
    for (const it of items) {
      if (SKIP.has(it.name) || it.isSymbolicLink()) continue;
      if (entries.length >= ASM_LIST_MAX) { more = true; return; }
      const p = rel ? `${rel}/${it.name}` : it.name;
      if (it.isDirectory()) { entries.push({ path: p, dir: true, size: 0, mtime: 0 }); await walk(p, depth + 1); }
      else if (it.isFile()) {
        const s = await stat(join(root, p)).catch(() => null);
        entries.push({ path: p, dir: false, size: s?.size ?? 0, mtime: s?.mtimeMs ?? 0 });
      }
    }
  };
  await walk('', 0);
  return { dir: root, name: basename(root) || root, entries, more };
}

/** a file of the folder: as text (UTF-8), or its bytes */
export async function readInFolder(dir: string, rel: string, as: 'text' | 'bytes'): Promise<AsmReadResult> {
  const full = inFolder(dir, rel), s = await stat(full);
  if (!s.isFile()) throw new Error(`${rel} is not a file`);
  if (s.size > ASM_READ_MAX) throw new Error(`${rel} is ${s.size} bytes: the Assembler reads files up to ${ASM_READ_MAX / 1024 / 1024} MB`);
  const bytes = await readFile(full);
  return as === 'text' ? { text: bytes.toString('utf8'), size: s.size, mtime: s.mtimeMs } : { bytes: new Uint8Array(bytes), size: s.size, mtime: s.mtimeMs };
}

/** a source written, or a data file's bytes (its folder made when it is not there) */
export async function writeInFolder(dir: string, rel: string, data: string | Uint8Array): Promise<{ mtime: number }> {
  const full = inFolder(dir, rel);
  await mkdir(dirname(full), { recursive: true });
  if (typeof data === 'string') await writeFile(full, data, 'utf8'); else await writeFile(full, data);
  return { mtime: (await stat(full)).mtimeMs };
}

/** a new file (with its text) or folder, one renamed or moved inside the folder, or one moved to the Recycle Bin */
export async function changeInFolder(dir: string, req: AsmChangeRequest, trash: (p: string) => Promise<void>): Promise<string[]> {
  const full = inFolder(dir, req.path);
  switch (req.op) {
    case 'file':
      if (existsSync(full)) throw new Error(`${req.path} is there already`);
      await mkdir(dirname(full), { recursive: true });
      await writeFile(full, req.text ?? '', { encoding: 'utf8', flag: 'wx' });
      return [full];
    case 'folder':
      if (existsSync(full)) throw new Error(`${req.path} is there already`);
      await mkdir(full, { recursive: true });
      return [full];
    case 'rename': {
      const to = inFolder(dir, req.to);
      if (!existsSync(full)) throw new Error(`${req.path} is not there`);
      // (a change of case only is a rename too on Windows)
      if (existsSync(to) && !same(full, to)) throw new Error(`${req.to} is there already`);
      if (relative(full, to) && !relative(full, to).startsWith('..') && !isAbsolute(relative(full, to))) throw new Error(`A folder cannot go into itself`);
      await mkdir(dirname(to), { recursive: true });
      await rename(full, to);
      return [full, to];
    }
    case 'remove':
      if (!existsSync(full)) throw new Error(`${req.path} is not there`);
      await trash(full);
      return [full];
  }
}

/** a new folder for the Assembler, `<parent>/<name>`, with `files` (the first source) in it */
export async function createAsmFolder(parent: string, name: string, files: Record<string, string>): Promise<string> {
  const problem = projectNameProblem(name);
  if (problem) throw new Error(problem);
  const dir = join(resolve(parent), name.trim());
  if (isDir(dir) && (await readdir(dir)).length) throw new Error(`${dir} is there already, with files in it: open it with Open folder…, or give the new one another name`);
  await mkdir(dir, { recursive: true });
  for (const [rel, text] of Object.entries(files)) {
    const full = inFolder(dir, rel);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, text, 'utf8');
  }
  return dir;
}
