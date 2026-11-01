/* Project store (Zustand + Immer). The project is the single source of truth; every edit goes
 * through `update(label, recipe)` and becomes one undoable step. */
import { create } from 'zustand';
import type { Draft } from 'immer';
import { DEFAULT_SETTINGS, demoProject, deserializeProject, serializeProject, type Project, type SerializedProject } from '@mimir/core';
import { store } from '../lib/util';
import { commit, commitReplace, initHistory, ownChanges, redo, undo, type History } from './history';
import type { ProjectHome } from '../../shared/ipc';

/** the work without a project, kept by the window */
const SAVED_KEY = 'kr.project';
/** whether it has changes that are not in a project (not just a file opened) */
const CHANGED_KEY = 'kr.projectChanged';

/** the work without a project the window kept, or null */
export function unsavedWork(): Project | null {
  const saved = store.get<SerializedProject | null>(SAVED_KEY, null);
  if (saved) {
    try { return deserializeProject(saved); } catch { /* not readable: there is none */ }
  }
  return null;
}

/** whether the work without a project the window kept has changes that are not in a project (work kept before Mimir
 *  told them apart may have) */
export function unsavedWorkChanged(): boolean {
  return store.get<boolean | null>(CHANGED_KEY, null) ?? store.get<unknown>(SAVED_KEY, null) != null;
}

/** Whether the work has changes since it was opened: the work without a project's are in no project. Settings are none,
 *  a file opened in its place takes them along. */
export const workChanged = (h: History<Project>): boolean => ownChanges(h, step => step.patches.every(p => p.path[0] === 'settings'));

interface ProjectState extends History<Project> {
  /** the project the work is in: its folder and project file (null: work without a project, which the window keeps) */
  home: ProjectHome | null;
  update: (label: string, recipe: (draft: Draft<Project>) => void) => void;
  /** a new project; with `undoLabel` as an undoable step (Ctrl+Z brings the one before back), else with a new history */
  replace: (project: Project, undoLabel?: string) => void;
  /** work on `project` in `home` (null: without a project) from now on, with a new history; `changed`: it has changes
   *  that are not in a project (the work without a project the window kept) */
  enter: (project: Project, home: ProjectHome | null, changed?: boolean) => void;
  /** the work goes on in `home` as it is (it was moved there, or leaves its project) */
  setHome: (home: ProjectHome | null) => void;
  undo: () => void;
  redo: () => void;
}

const withDefaults = (project: Project): Project => ({ ...project, settings: { ...DEFAULT_SETTINGS, ...project.settings } });

const kept = unsavedWork();
export const useProject = create<ProjectState>((set) => ({
  ...initHistory(kept ?? demoProject(), !!kept && unsavedWorkChanged()),
  home: null,
  update: (label, recipe) => set(s => commit(s, label, recipe)),
  replace: (project, undoLabel) => set(s => (undoLabel ? commitReplace(s, undoLabel, withDefaults(project)) : initHistory(withDefaults(project)))),
  enter: (project, home, changed = false) => set({ ...initHistory(withDefaults(project), changed), home }),
  setHome: home => set({ home }),
  undo: () => set(s => undo(s)),
  redo: () => set(s => redo(s)),
}));

// work without a project is saved to the renderer's storage so a restart continues where the user left off (a
// project's work goes to its project file: the workspace saves it)
let saveTimer: ReturnType<typeof setTimeout> | undefined;
useProject.subscribe((s, prev) => {
  if (s.present === prev.present || s.home) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { store.set(SAVED_KEY, serializeProject(s.present)); store.set(CHANGED_KEY, workChanged(s)); }, 600);
});

/** the work without a project is in a project now: the window keeps none (not even an edit about to be saved) */
export function forgetUnsavedWork(): void {
  clearTimeout(saveTimer);
  store.set(SAVED_KEY, null);
  store.set(CHANGED_KEY, null);
}
