/* The user's build templates (spec 11.4b): build.bat and build.sh with placeholders, kept by the app as the scripts'
 * library is, so every project can make its build scripts from one. Mimir's own templates are core's
 * (BUILT_IN_TEMPLATES), not kept here. */
import { create } from 'zustand';
import { readTemplateLibrary, type BuildTemplate } from '@mimir/core';
import { store } from '../lib/util';

const LIBRARY_KEY = 'kr.buildTemplates';

interface BuildTemplatesState {
  library: readonly BuildTemplate[];
  /** the template kept, in place of the one called `was` (a rename) or of its own name; sorted by name */
  save: (t: BuildTemplate, was?: string) => void;
  remove: (name: string) => void;
}

const sorted = (l: BuildTemplate[]) => l.sort((a, b) => a.name.localeCompare(b.name));

export const useBuildTemplates = create<BuildTemplatesState>((set, get) => ({
  library: readTemplateLibrary(store.get<unknown>(LIBRARY_KEY, [])),
  save: (t, was) => {
    const gone = new Set([t.name.toLowerCase(), (was ?? t.name).toLowerCase()]);
    const { builtIn: _, ...own } = t;
    const library = sorted([...get().library.filter(x => !gone.has(x.name.toLowerCase())), own]);
    store.set(LIBRARY_KEY, library); set({ library });
  },
  remove: name => {
    const library = get().library.filter(x => x.name !== name);
    store.set(LIBRARY_KEY, library); set({ library });
  },
}));
