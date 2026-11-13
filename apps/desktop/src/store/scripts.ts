/* What the Scripts tab keeps while the window is open (spec 10.3): which script is shown, the last run of each
 * (its scratchpads and its changes to the program are kept in the project, the rest of a run is not), the one running
 * and the output's height; and the library of scripts, which every project can take a copy of (kept by the app). */
import { create } from 'zustand';
import { b64dec, b64enc, tidyInit, type Patch, type ScriptInit, type ScriptLang, type ScriptPad, type ScriptPadSource, type ScriptRun, type ScriptWatchEntry, type ScriptWriteFailure, type ScriptZpInit, type UserScript } from '@mimir/core';
import { store } from '../lib/util';

/** what the output shows: a scratchpad (by index), one of the script's changes to the program (its patch's id) or one
 *  a run in safe mode would make (by index in its `would`) */
export type ScriptShown = { kind: 'pad'; i: number } | { kind: 'patch'; id: string } | { kind: 'would'; i: number };
/** how the output shows a scratchpad or a change: as hex, code or text, or (a scratchpad) compared with another */
export type PadMode = 'hex' | 'code' | 'text' | 'compare';

/** a run kept to show; `safe`: it ran in safe mode, so nothing went into the program, and `would` holds the patches it
 *  would have written (`failed`: what could not have been) */
export interface ScriptRunKept { run: ScriptRun; source: string; at: number; failed: ScriptWriteFailure[]; safe?: boolean; would?: Patch[] }

/** a script in the library: its code and its scratchpads (without what they held), whether it runs in safe mode,
 *  what its runs start with and its watch list (what the user added and took off) */
export interface LibraryScript { name: string; lang: ScriptLang; source: string; pads: Omit<ScriptPad, 'bytes'>[]; saved: number; safe?: boolean; init?: ScriptInit; watch?: ScriptWatchEntry[]; unwatch?: string[] }

const LIBRARY_KEY = 'kr.scriptLibrary';
const LIST_FOLDED_KEY = 'kr.scriptListFolded';
const TEMPLATES_FOLDED_KEY = 'kr.scriptTemplatesFolded';
const isPad = (p: unknown): p is Omit<ScriptPad, 'bytes'> => !!p && typeof (p as ScriptPad).name === 'string' && Number.isInteger((p as ScriptPad).start) && Number.isInteger((p as ScriptPad).size);
const isByte = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 0xff;
/** an init as the library keeps it, when it is one (what is not a byte, or not in the zero page, left out) */
const readInit = (v: unknown): ScriptInit | null => {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>, zp = Array.isArray(o.zp) ? o.zp : [];
  return tidyInit({
    ...(isByte(o.a) ? { a: o.a } : {}), ...(isByte(o.x) ? { x: o.x } : {}), ...(isByte(o.y) ? { y: o.y } : {}), ...(isByte(o.p) ? { p: o.p } : {}),
    zp: zp.filter((z): z is ScriptZpInit => !!z && isByte(z.at) && Number.isInteger(z.value) && z.value >= 0 && (z.word === true ? z.at <= 0xfe && z.value <= 0xffff : isByte(z.value))),
  });
};
/** how the user wrote a scratchpad's start content, when it is that */
const readSrc = (v: unknown): ScriptPadSource | null => {
  const o = v as Partial<ScriptPadSource> | null;
  return o && (o.form === 'asm' || o.form === 'hex' || o.form === 'text') && typeof o.text === 'string' ? { form: o.form, text: o.text, ...(o.screen === true ? { screen: true } : {}) } : null;
};
/** a watch list as the library keeps it (what is not an entry left out) */
const readWatch = (v: unknown): ScriptWatchEntry[] => (Array.isArray(v) ? v : [])
  .filter((w): w is ScriptWatchEntry => !!w && typeof w.expr === 'string' && w.expr.length > 0 && (w.size == null || (Number.isInteger(w.size) && w.size >= 1 && w.size <= 256)))
  .map(w => ({ expr: w.expr, ...(w.size && w.size > 1 ? { size: w.size } : {}), ...(w.ptr === true ? { ptr: true } : {}) }));
const readData = (v: unknown): Uint8Array | null => { try { return typeof v === 'string' && v ? b64dec(v) : null; } catch { return null; } };
const readLibrary = (): LibraryScript[] => {
  const v = store.get<unknown>(LIBRARY_KEY, []);
  return Array.isArray(v) ? v.filter((s): s is LibraryScript => !!s && typeof s.name === 'string' && s.name.length > 0 && typeof s.source === 'string' && Array.isArray(s.pads) && s.pads.every(isPad))
    .map(s => {
      const init = readInit(s.init), watch = readWatch(s.watch), unwatch = Array.isArray(s.unwatch) ? s.unwatch.filter((k): k is string => typeof k === 'string') : [];
      return {
        name: s.name, lang: 'kickass', source: s.source, saved: Number(s.saved) || 0, ...(s.safe === true ? { safe: true } : {}), ...(init ? { init } : {}),
        ...(watch.length ? { watch } : {}), ...(unwatch.length ? { unwatch } : {}),
        pads: s.pads.map(({ name, start, size, fill, data, src }) => {
          const d = readData(data), w = readSrc(src);
          return { name, start, size, ...(fill ? { fill } : {}), ...(d ? { data: d } : {}), ...(w ? { src: w } : {}) };
        }),
      };
    }) : [];
};
/** the library as localStorage keeps it: a scratchpad's start content as base64 */
const storeLibrary = (library: LibraryScript[]) =>
  store.set(LIBRARY_KEY, library.map(s => ({ ...s, pads: s.pads.map(({ data, ...p }) => ({ ...p, ...(data ? { data: b64enc(data) } : {}) })) })));

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
  /** the output below the editor folded down to its bar (the editor takes the room) */
  outFolded: boolean;
  /** the Scripts tab's list of the project's scripts and the library folded in to a strip (kept by the app) */
  listFolded: boolean;
  setListFolded: (v: boolean) => void;
  /** the list's Templates folded to its heading (kept by the app) */
  templatesFolded: boolean;
  setTemplatesFolded: (v: boolean) => void;
  /** what Compare compares the shown scratchpad with: another scratchpad (its name), or `@start`, what a run starts it
   *  with (what the last run changed in it) */
  cmpWith: string | null;
  library: LibraryScript[];
  /** a line of the shown script to go to once its editor is there (a click on a script's mark in the listing) */
  gotoLine: number | null;
  /** each script's breakpoints, by line (the editor keeps them while it is open; this while it is not) */
  bps: Record<string, number[]>;
  setBps: (id: string, lines: number[]) => void;
  set: (s: Partial<Omit<ScriptsState, 'set' | 'library' | 'saveToLibrary' | 'removeFromLibrary' | 'bps' | 'setBps' | 'listFolded' | 'setListFolded' | 'templatesFolded' | 'setTemplatesFolded'>>) => void;
  /** a copy of the script in the library, in place of one of the same name: whether one was replaced */
  saveToLibrary: (s: Pick<UserScript, 'name' | 'lang' | 'source' | 'pads' | 'safe' | 'init' | 'watch' | 'unwatch'>) => boolean;
  removeFromLibrary: (name: string) => void;
}

export const useScripts = create<ScriptsState>((set, get) => ({
  selected: null, runs: {}, running: null, gotoLine: null, shown: { kind: 'pad', i: 0 }, mode: 'hex', screen: false, outH: 300, dbgOutH: 170, outFolded: false, cmpWith: null,
  library: readLibrary(),
  bps: {},
  setBps: (id, lines) => set(s => ({ bps: { ...s.bps, [id]: lines } })),
  set: s => set(s),
  listFolded: store.get<boolean>(LIST_FOLDED_KEY, false) === true,
  setListFolded: v => { store.set(LIST_FOLDED_KEY, v); set({ listFolded: v }); },
  templatesFolded: store.get<boolean>(TEMPLATES_FOLDED_KEY, false) === true,
  setTemplatesFolded: v => { store.set(TEMPLATES_FOLDED_KEY, v); set({ templatesFolded: v }); },
  saveToLibrary: s => {
    const lib = get().library, had = lib.some(x => x.name.toLowerCase() === s.name.toLowerCase());
    const entry: LibraryScript = { name: s.name, lang: s.lang, source: s.source, pads: s.pads.map(({ bytes: _, ...p }) => p), saved: Date.now(), ...(s.safe ? { safe: true } : {}), ...(s.init ? { init: structuredClone(s.init) } : {}), ...(s.watch?.length ? { watch: structuredClone(s.watch) } : {}), ...(s.unwatch?.length ? { unwatch: [...s.unwatch] } : {}) };
    const library = [...lib.filter(x => x.name.toLowerCase() !== s.name.toLowerCase()), entry].sort((a, b) => a.name.localeCompare(b.name));
    storeLibrary(library); set({ library });
    return had;
  },
  removeFromLibrary: name => {
    const library = get().library.filter(x => x.name !== name);
    storeLibrary(library); set({ library });
  },
}));
