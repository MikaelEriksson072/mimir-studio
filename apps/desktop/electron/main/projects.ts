/* Projects: a project is a folder of its own, named after it, with its project file <name>.mimir.json and what Mimir
 * writes for it: source\ (the Kick Assembler export), build\ (KickAss.jar's output) and packed\ (the packed file).
 * What was worked on last (a project, or work without one, which the window keeps), the projects opened last and
 * where new projects go are kept as JSON in the user data folder, so the start screen can offer them. */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { copyFile, cp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, normalize, relative, resolve } from 'node:path';
import { z } from 'zod';
import type { ProjectCreateResult, ProjectHome, ProjectStartInfo, RecentProject } from '../../shared/ipc';
import { PROJECT_FOLDERS, projectFileName, projectNameOf, projectNameProblem, type ProjectFolder } from '../../shared/projects';

/** how many projects the start screen lists */
export const RECENT_PROJECTS = 10;

const path = z.string().min(1).max(4096);
const fileSchema = z.object({
  last: z.union([z.object({ kind: z.literal('project'), file: path }), z.object({ kind: z.literal('unsaved') })]).optional(),
  recent: z.array(z.object({ file: path, opened: z.number() })).max(100).default([]),
  parent: path.optional(),
});
type Stored = z.output<typeof fileSchema>;

const isDir = (p: string | undefined): p is string => { try { return !!p && existsSync(p) && statSync(p).isDirectory(); } catch { return false; } };
const same = (a: string, b: string) => resolve(normalize(a)).toLowerCase() === resolve(normalize(b)).toLowerCase();

/** the project whose project file is `file` */
export const homeOf = (file: string): ProjectHome => ({ name: projectNameOf(file), dir: dirname(resolve(file)), file: resolve(file) });

export class ProjectStore {
  private readonly file: string;
  private value: Stored = { recent: [] };
  /** the project this run works on (null: work without a project) */
  current: ProjectHome | null = null;
  /** chosen in this run: a reloaded window goes on with it instead of showing the start screen again */
  private chosen = false;

  /** `dir`: the user data folder; `documents`: the user's documents folder (new projects go in Mimir there) */
  constructor(dir: string, private readonly documents: string) {
    this.file = join(dir, 'projects.json');
    try {
      if (existsSync(this.file)) this.value = fileSchema.parse(JSON.parse(readFileSync(this.file, 'utf8')));
    } catch {
      this.value = { recent: [] }; // an unreadable file only means the start screen has nothing to offer
    }
  }

  start(): ProjectStartInfo {
    const last = this.value.last;
    return {
      last: last?.kind === 'project' ? { kind: 'project', home: homeOf(last.file), exists: existsSync(last.file) } : last ? { kind: 'unsaved' } : null,
      resume: !this.chosen ? null : this.current ? { kind: 'project', home: this.current } : { kind: 'unsaved' },
      recent: this.recent(),
      parent: this.parent(),
    };
  }

  recent(): RecentProject[] {
    return this.value.recent.map(r => ({ ...homeOf(r.file), opened: r.opened, exists: existsSync(r.file) }));
  }

  /** work on `home` from now on: it is what was worked on last, at the top of the projects opened last */
  enter(home: ProjectHome): void {
    this.current = home;
    this.chosen = true;
    this.value = { ...this.value, last: { kind: 'project', file: home.file }, recent: [{ file: home.file, opened: Date.now() }, ...this.value.recent.filter(r => !same(r.file, home.file))].slice(0, RECENT_PROJECTS) };
    this.write();
  }

  /** work without a project from now on */
  unsaved(): void {
    this.current = null;
    this.chosen = true;
    this.value = { ...this.value, last: { kind: 'unsaved' } };
    this.write();
  }

  /** a project opened before (one the start screen may open again without a dialog) */
  isRecent(file: string): boolean {
    return this.value.recent.some(r => same(r.file, file)) || (this.value.last?.kind === 'project' && same(this.value.last.file, file));
  }

  forget(file: string): RecentProject[] {
    const last = this.value.last;
    this.value = { ...this.value, recent: this.value.recent.filter(r => !same(r.file, file)), ...(last?.kind === 'project' && same(last.file, file) ? { last: undefined } : {}) };
    this.write();
    return this.recent();
  }

  /** where a new project's folder goes: where the last one went, else Mimir in the documents folder */
  parent(): string {
    return isDir(this.value.parent) ? this.value.parent : join(this.documents, 'Mimir');
  }

  rememberParent(dir: string): void {
    this.value = { ...this.value, parent: dir };
    this.write();
  }

  /** the folder of the current project for `kind` (made when it is missing); null without a project */
  folder(kind: ProjectFolder): string | null {
    if (!this.current) return null;
    const dir = join(this.current.dir, PROJECT_FOLDERS[kind]);
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  private write(): void {
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(this.file, JSON.stringify(this.value, null, 2));
    } catch { /* remembering is best effort */ }
  }
}

/** The folder `<parent>/<name>` of a new project (made when missing); refused when a project of that name is there. */
export async function createProjectFolder(parent: string, name: string): Promise<ProjectHome> {
  const problem = projectNameProblem(name);
  if (problem) throw new Error(problem);
  const n = name.trim(), dir = join(resolve(parent), n), file = join(dir, projectFileName(n));
  if (existsSync(file)) throw new Error(`There is a project called ${n} in ${parent} already: open it, or give this one another name`);
  if (existsSync(dir) && !isDir(dir)) throw new Error(`${dir} is a file`);
  await mkdir(dir, { recursive: true });
  return { name: n, dir, file };
}

/** a folder the app made in the OS temp folder (a build or pack folder): it can be moved, not only copied */
export const isOwnTemp = (dir: string): boolean => {
  const rel = relative(resolve(tmpdir()), resolve(dir));
  return !!rel && !rel.startsWith('..') && !isAbsolute(rel) && !/[\\/]/.test(rel) && rel.startsWith('mimir-');
};

/**
 * The work done without a project, into the new project's folder: the last export is copied to source\ (the folder the
 * user picked stays as it is), the last build moves to build\ and the packed file to packed\ (from the app's own
 * folders in temp, which go). Returns where each one is now.
 */
export async function gatherWork(home: ProjectHome, from: { exportDir?: string; buildDir?: string; packed?: string }): Promise<ProjectCreateResult['moved']> {
  const moved: ProjectCreateResult['moved'] = {};
  const into = (kind: ProjectFolder) => join(home.dir, PROJECT_FOLDERS[kind]);
  if (from.exportDir && isDir(from.exportDir)) {
    await cp(from.exportDir, into('source'), { recursive: true });
    moved.source = into('source');
  }
  if (from.buildDir && isDir(from.buildDir)) {
    await cp(from.buildDir, into('build'), { recursive: true });
    moved.build = into('build');
    if (isOwnTemp(from.buildDir)) await rm(from.buildDir, { recursive: true, force: true }).catch(() => null);
  }
  if (from.packed && existsSync(from.packed)) {
    await mkdir(into('packed'), { recursive: true });
    moved.packed = join(into('packed'), basename(from.packed));
    await copyFile(from.packed, moved.packed);
    if (isOwnTemp(dirname(from.packed))) await rm(dirname(from.packed), { recursive: true, force: true }).catch(() => null);
  }
  return moved;
}
