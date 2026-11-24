/* What the Scripts tab keeps while the window is open (spec 10.3): which script is shown, the last run of each
 * (its scratchpads and its changes to the program are kept in the project, the rest of a run is not), the one running
 * and the output's height; and the library of scripts, which every project can take a copy of (kept by the app). */
import { create } from 'zustand';
import { readScriptFile, scriptFileName, scriptFileText, b64dec, b64enc, tidyInit, SCREEN_C64, screenSize, type ScreenSize, type Patch, type ScriptInit, type ScriptLang, type ScriptPad, type ScriptPadSource, type ScriptRun, type ScriptWatchEntry, type ScriptWriteFailure, type ScriptZpInit, type UserScript } from '@mimir/core';
import { store } from '../lib/util';

/** the output's tabs (spec 10.3): what the runs start with, the watch list, what the script changed in the program,
 *  its scratchpads, how the last run ended, and what the check found */
export type OutTab = 'settings' | 'init' | 'watch' | 'program' | 'pads' | 'run' | 'problems';
/** the change In the program shows beside its list: one of the script's changes to the program (its patch's id) or one
 *  a run in safe mode would make (by index in its `would`) */
export type ChangeShown = { kind: 'patch'; id: string } | { kind: 'would'; i: number };
/** how the output shows a scratchpad or a change: as hex, code or text, or (a scratchpad) compared with another */
export type PadMode = 'hex' | 'code' | 'text' | 'compare';

/** a run kept to show; `safe`: it ran in safe mode, so nothing went into the program, and `would` holds the patches it
 *  would have written (`failed`: what could not have been) */
export interface ScriptRunKept { run: ScriptRun; source: string; at: number; failed: ScriptWriteFailure[]; safe?: boolean; would?: Patch[];
  /** what the script's directives did to the program beyond its bytes (in safe mode: would do), and what they could not */
  acted?: { done: string[]; failed: { line: number; why: string }[] } }

/** a script in the library: its code and its scratchpads (without what they held), whether it runs in safe mode,
 *  what its runs start with and its watch list (what the user added and took off) */
export interface LibraryScript { name: string; lang: ScriptLang; code?: 'js'; source: string; pads: Omit<ScriptPad, 'bytes'>[]; saved: number; safe?: boolean; init?: ScriptInit; machine?: 'c64'; stopAt?: string; watch?: ScriptWatchEntry[]; unwatch?: string[];
  /** its table of values (Run with values…), and the names of the program its code needs (a routine the user named): where a program has them, the script fits it */
  table?: string; needs?: string[];
  /** when it runs by itself: `load`, it is added to every program opened and run there; `build`, before Build & Run */
  when?: 'build' | 'load';
  /** its file in the library's folder Scripts (missing: kept by the app, where there is no folder) */
  file?: string }

/** the scripts moved from the app's own keeping into the library's folder (once) */
const MOVED_KEY = 'kr.scriptLibraryMoved';
/** the library's folder as its listing gives it: each file a script, named after its file */
const fromFiles = (files: readonly { file: string; text: string; mtime: number }[]): LibraryScript[] => files.flatMap(f => { const s = readScriptFile(f.file, f.text); return s ? [{ ...s, saved: f.mtime, file: f.file }] : []; })
  .sort((a, b) => a.name.localeCompare(b.name));

const LIBRARY_KEY = 'kr.scriptLibrary';
const SCREEN_KEY = 'kr.scriptScreen';

/** The C64 screen beside a script's code (kept by the app): shown or not, extended mode (more columns and rows than
 *  the C64's 40×25, as many as the panel has room for), how big a C64 pixel is there (SCREEN_ZOOMS), the zoom of the
 *  40×25 screen (`mag`: 0 is Fit, as big as the panel has room for; else SCREEN_MAGS, the panel scrolling when it is
 *  bigger), the panel's width, and the size extended mode last had (what a run gets). */
export interface ScreenPrefs { open: boolean; extended: boolean; zoom: number; mag: number; width: number; size: ScreenSize }
/** the sizes of a C64 pixel extended mode has: CSS pixels, made whole pixels of the display (ScriptScreen.tsx) */
export const SCREEN_ZOOMS = [1, 2, 3, 4] as const;
/** the zooms of the 40×25 screen besides Fit: a C64 pixel's size in CSS pixels, made whole pixels of the display */
export const SCREEN_MAGS = [1, 2, 3, 4, 5, 6, 8] as const;
const readScreenPrefs = (): ScreenPrefs => {
  const v = store.get<Partial<ScreenPrefs> | null>(SCREEN_KEY, null) ?? {};
  const zoom = SCREEN_ZOOMS.includes(v.zoom as 1) ? v.zoom! : 1, mag = SCREEN_MAGS.includes(v.mag as 1) ? v.mag! : 0;
  return { open: v.open === true, extended: v.extended === true, zoom, mag, width: Number.isFinite(v.width) ? Math.max(240, Math.min(2000, v.width!)) : 520, size: screenSize(v.size) };
};
/** The size of the C64 screen a run gets now: 40×25, or in extended mode what the panel had room for. */
export const runScreenSize = (): ScreenSize => { const p = useScripts.getState().c64; return p.extended ? screenSize(p.size) : { ...SCREEN_C64 }; };
const LIST_FOLDED_KEY = 'kr.scriptListFolded';
const LIST_W_KEY = 'kr.scriptListW';
/** the Scripts tab's list: how narrow and how wide its edge can be dragged, and its width at first */
export const SCRIPT_LIST_W = { min: 120, max: 700, start: 150 } as const;
export const clampListW = (w: number) => Math.round(Math.max(SCRIPT_LIST_W.min, Math.min(SCRIPT_LIST_W.max, w)));
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
        name: s.name, lang: s.lang === '64tass' ? '64tass' : 'kickass', ...(s.code === 'js' ? { code: 'js' as const } : {}), source: s.source, saved: Number(s.saved) || 0, ...(s.safe === true ? { safe: true } : {}), ...(init ? { init } : {}), ...(s.machine === 'c64' ? { machine: 'c64' as const } : {}), ...(typeof s.stopAt === 'string' && s.stopAt.trim() ? { stopAt: s.stopAt.slice(0, 200) } : {}),
        ...(watch.length ? { watch } : {}), ...(unwatch.length ? { unwatch } : {}),
        pads: s.pads.map(({ name, start, size, fill, data, src, role, load }) => {
          const d = readData(data), w = readSrc(src);
          return { name, start, size, ...(fill ? { fill } : {}), ...(d ? { data: d } : {}), ...(w ? { src: w } : {}), ...(role === 'file' || role === 'result' ? { role } : {}), ...(Number.isInteger(load) && load! >= 0 && load! <= 0xffff ? { load } : {}) };
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
  /** the output's tab shown */
  outTab: OutTab;
  /** the scratchpad the Scratchpads tab shows beside its list (by index) */
  pad: number;
  /** the change In the program shows beside its list (null: the first) */
  change: ChangeShown | null;
  mode: PadMode;
  /** the text column: PETSCII or screen codes */
  screen: boolean;
  outH: number;
  /** the output's height while debugging (lower: the code and the debugger's panel need the room) */
  dbgOutH: number;
  /** the output below the editor folded down to its bar (the editor takes the room) */
  outFolded: boolean;
  /** the script editor in full screen: it has the whole window, the rest of the window (the title bar, the activity
   *  bar, the side panel, the inspector, the tab row, the bottom panel, the status bar) is hidden until it is left
   *  (kept while the window is open: another tab shows the window as it is, and the Scripts tab is full screen again) */
  full: boolean;
  /** the Scripts tab's list of the project's scripts and the library folded in to a strip (kept by the app) */
  listFolded: boolean;
  setListFolded: (v: boolean) => void;
  /** the list's width, its edge dragged (kept by the app) */
  listW: number;
  setListW: (w: number) => void;
  /** the list's Templates folded to its heading (kept by the app) */
  templatesFolded: boolean;
  setTemplatesFolded: (v: boolean) => void;
  /** what Compare compares the shown scratchpad with: another scratchpad (its name), or `@start`, what a run starts it
   *  with (what the last run changed in it) */
  cmpWith: string | null;
  library: LibraryScript[];
  /** the library's folder of scripts (null: the app keeps them itself, where there is no folder) */
  libraryDir: string | null;
  /** the library read from its folder again (files added, changed or removed there by hand show); the first time, the
   *  scripts the app kept itself are moved into the folder */
  loadLibrary: () => Promise<void>;
  /** a line of the shown script to go to once its editor is there (a click on a script's mark in the listing) */
  gotoLine: number | null;
  /** each script's breakpoints, by line (the editor keeps them while it is open; this while it is not) */
  bps: Record<string, number[]>;
  /** the C64 screen beside the code (kept by the app) */
  c64: ScreenPrefs;
  setC64: (p: Partial<ScreenPrefs>) => void;
  setBps: (id: string, lines: number[]) => void;
  set: (s: Partial<Omit<ScriptsState, 'set' | 'library' | 'libraryDir' | 'loadLibrary' | 'saveToLibrary' | 'removeFromLibrary' | 'bps' | 'setBps' | 'listFolded' | 'setListFolded' | 'listW' | 'setListW' | 'templatesFolded' | 'setTemplatesFolded' | 'c64' | 'setC64'>>) => void;
  /** a copy of the script in the library, in place of one of the same name: whether one was replaced */
  saveToLibrary: (s: Pick<UserScript, 'name' | 'lang' | 'code' | 'source' | 'pads' | 'safe' | 'init' | 'watch' | 'unwatch' | 'machine' | 'stopAt' | 'table' | 'when'> & { needs?: string[] }) => boolean;
  removeFromLibrary: (name: string) => void;
}

export const useScripts = create<ScriptsState>((set, get) => ({
  selected: null, runs: {}, running: null, gotoLine: null, outTab: 'watch', pad: 0, change: null, mode: 'hex', screen: false, outH: 300, dbgOutH: 170, outFolded: false, cmpWith: null, full: false,
  library: readLibrary(),
  libraryDir: null,
  loadLibrary: async () => {
    const kr = window.kr;
    if (!kr) return;
    try {
      let listing = await kr.scriptsList();
      if (store.get<boolean>(MOVED_KEY, false) !== true) {
        // what the app kept itself goes into the folder, where no file has its name
        const have = new Set(fromFiles(listing.files).map(s => s.name.toLowerCase()));
        for (const { saved: _s, file: _f, ...s } of readLibrary()) if (!have.has(s.name.toLowerCase())) listing = await kr.scriptsSave({ file: scriptFileName(s), text: scriptFileText(s) });
        store.set(MOVED_KEY, true);
      }
      set({ library: fromFiles(listing.files), libraryDir: listing.dir });
    } catch { /* the folder cannot be read: the list stays as it is */ }
  },
  bps: {},
  c64: readScreenPrefs(),
  setC64: p => {
    const next = { ...get().c64, ...p };
    if (p.size && next.size.cols === get().c64.size.cols && next.size.rows === get().c64.size.rows && Object.keys(p).length === 1) return;
    store.set(SCREEN_KEY, next); set({ c64: next });
  },
  setBps: (id, lines) => set(s => ({ bps: { ...s.bps, [id]: lines } })),
  set: s => set(s),
  listFolded: store.get<boolean>(LIST_FOLDED_KEY, false) === true,
  setListFolded: v => { store.set(LIST_FOLDED_KEY, v); set({ listFolded: v }); },
  listW: (w => Number.isFinite(w) ? clampListW(w) : SCRIPT_LIST_W.start)(store.get<number>(LIST_W_KEY, SCRIPT_LIST_W.start)),
  setListW: w => { const v = clampListW(w); if (v === get().listW) return; store.set(LIST_W_KEY, v); set({ listW: v }); },
  templatesFolded: store.get<boolean>(TEMPLATES_FOLDED_KEY, false) === true,
  setTemplatesFolded: v => { store.set(TEMPLATES_FOLDED_KEY, v); set({ templatesFolded: v }); },
  saveToLibrary: s => {
    const lib = get().library, had = lib.some(x => x.name.toLowerCase() === s.name.toLowerCase());
    const entry: LibraryScript = { name: s.name, lang: s.lang, ...(s.code ? { code: s.code } : {}), source: s.source, pads: s.pads.map(({ bytes: _, ...p }) => p), saved: Date.now(), ...(s.safe ? { safe: true } : {}), ...(s.init ? { init: structuredClone(s.init) } : {}), ...(s.machine ? { machine: s.machine } : {}), ...(s.stopAt ? { stopAt: s.stopAt } : {}), ...(s.watch?.length ? { watch: structuredClone(s.watch) } : {}), ...(s.unwatch?.length ? { unwatch: [...s.unwatch] } : {}),
      ...(s.table ? { table: s.table } : {}), ...(s.needs?.length ? { needs: [...s.needs] } : {}), ...(s.when ? { when: s.when } : {}) };
    const was = lib.find(x => x.name.toLowerCase() === s.name.toLowerCase());
    const kr = window.kr;
    if (kr) entry.file = scriptFileName(entry);
    const library = [...lib.filter(x => x !== was), entry].sort((a, b) => a.name.localeCompare(b.name));
    set({ library });
    // a file in the library's folder; without a folder the app keeps it
    if (kr) { const { saved: _s, file: _f, ...doc } = entry; void kr.scriptsSave({ file: entry.file!, text: scriptFileText(doc), ...(was?.file ? { was: was.file } : {}) }).then(l => set({ library: fromFiles(l.files), libraryDir: l.dir }), () => undefined); }
    else storeLibrary(library);
    return had;
  },
  removeFromLibrary: name => {
    const gone = get().library.find(x => x.name === name), library = get().library.filter(x => x.name !== name);
    set({ library });
    const kr = window.kr;
    if (kr && gone) void kr.scriptsRemove({ file: gone.file ?? scriptFileName(gone) }).then(l => set({ library: fromFiles(l.files), libraryDir: l.dir }), () => undefined);
    else storeLibrary(library);
  },
}));
