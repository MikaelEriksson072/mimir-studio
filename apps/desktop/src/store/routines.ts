/* The routines Mimir knows from other projects (spec 10.5): the fingerprints of the routines the user named, kept by
 * the app as the scripts' library is, so every project gets their names suggested. */
import { create } from 'zustand';
import { readRoutineLibrary, type KnownRoutine } from '@mimir/core';
import { store } from '../lib/util';

const LIBRARY_KEY = 'kr.routineLibrary';

interface RoutinesState {
  library: readonly KnownRoutine[];
  /** the library as it is from now on (core's learnRoutine and learnProject make it); the same one changes nothing */
  setLibrary: (library: readonly KnownRoutine[]) => void;
  /** without the entries of a name (all its variants) */
  forget: (name: string) => void;
}

export const useRoutines = create<RoutinesState>((set, get) => ({
  library: readRoutineLibrary(store.get<unknown>(LIBRARY_KEY, [])),
  setLibrary: library => {
    if (library === get().library) return;
    store.set(LIBRARY_KEY, library); set({ library });
  },
  forget: name => get().setLibrary(get().library.filter(k => k.name !== name)),
}));
