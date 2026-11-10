/* What the Scripts tab keeps while the window is open (spec 10.3): which script is shown, the last run of each
 * (its scratchpads and its changes to the program are kept in the project, the rest of a run is not), the one running
 * and the output's height; and the library of scripts, which every project can take a copy of (kept by the app). */
import { create } from 'zustand';
import type { ScriptLang, ScriptPad, ScriptRun, ScriptWriteFailure, UserScript } from '@mimir/core';
import { store } from '../lib/util';

/** what the output shows: a scratchpad (by index) or one of the script's changes to the program (its patch's id) */
export type ScriptShown = { kind: 'pad'; i: number } | { kind: 'patch'; id: string };
export type PadMode = 'hex' | 'code' | 'text';

export interface ScriptRunKept { run: ScriptRun; source: string; at: number; failed: ScriptWriteFailure[] }

/** a script in the library: its code and its scratchpads (without what they held) */
export interface LibraryScript { name: string; lang: ScriptLang; source: string; pads: Omit<ScriptPad, 'bytes'>[]; saved: number }

const LIBRARY_KEY = 'kr.scriptLibrary';
const isPad = (p: unknown): p is Omit<ScriptPad, 'bytes'> => !!p && typeof (p as ScriptPad).name === 'string' && Number.isInteger((p as ScriptPad).start) && Number.isInteger((p as ScriptPad).size);
const readLibrary = (): LibraryScript[] => {
  const v = store.get<unknown>(LIBRARY_KEY, []);
  return Array.isArray(v) ? v.filter((s): s is LibraryScript => !!s && typeof s.name === 'string' && s.name.length > 0 && typeof s.source === 'string' && Array.isArray(s.pads) && s.pads.every(isPad))
    .map(s => ({ name: s.name, lang: 'kickass', source: s.source, pads: s.pads.map(({ name, start, size, fill }) => ({ name, start, size, ...(fill ? { fill } : {}) })), saved: Number(s.saved) || 0 })) : [];
};

interface ScriptsState {
  selected: string | null;
  runs: Record<string, ScriptRunKept>;
  running: string | null;
  shown: ScriptShown;
  mode: PadMode;
  /** the text column: PETSCII or screen codes */
  screen: boolean;
  outH: number;
  /** the output's height while debugging (lower: the code and the debugger's panel need the room) */
  dbgOutH: number;
  library: LibraryScript[];
  /** a line of the shown script to go to once its editor is there (a click on a script's mark in the listing) */
  gotoLine: number | null;
  /** each script's breakpoints, by line (the editor keeps them while it is open; this while it is not) */
  bps: Record<string, number[]>;
  setBps: (id: string, lines: number[]) => void;
  set: (s: Partial<Omit<ScriptsState, 'set' | 'library' | 'saveToLibrary' | 'removeFromLibrary' | 'bps' | 'setBps'>>) => void;
  /** a copy of the script in the library, in place of one of the same name: whether one was replaced */
  saveToLibrary: (s: Pick<UserScript, 'name' | 'lang' | 'source' | 'pads'>) => boolean;
  removeFromLibrary: (name: string) => void;
}

export const useScripts = create<ScriptsState>((set, get) => ({
  selected: null, runs: {}, running: null, gotoLine: null, shown: { kind: 'pad', i: 0 }, mode: 'hex', screen: false, outH: 300, dbgOutH: 170,
  library: readLibrary(),
  bps: {},
  setBps: (id, lines) => set(s => ({ bps: { ...s.bps, [id]: lines } })),
  set: s => set(s),
  saveToLibrary: s => {
    const lib = get().library, had = lib.some(x => x.name.toLowerCase() === s.name.toLowerCase());
    const entry: LibraryScript = { name: s.name, lang: s.lang, source: s.source, pads: s.pads.map(({ bytes: _, ...p }) => p), saved: Date.now() };
    const library = [...lib.filter(x => x.name.toLowerCase() !== s.name.toLowerCase()), entry].sort((a, b) => a.name.localeCompare(b.name));
    store.set(LIBRARY_KEY, library); set({ library });
    return had;
  },
  removeFromLibrary: name => {
    const library = get().library.filter(x => x.name !== name);
    store.set(LIBRARY_KEY, library); set({ library });
  },
}));
