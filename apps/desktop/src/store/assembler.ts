/* What the Assembler keeps (spec 10.7): per folder the main file and the language when the user chose them (else
 * they are found from the sources), the folders of the tree that are open, the breakpoints, the tabs, the split editor,
 * the output's tab and height, and whether the file list is folded. The folder, its files and their texts are the Assembler's own (AssemblerView). */
import { create } from 'zustand';
import type { ScriptLang } from '@mimir/core';
import { store } from '../lib/util';

/** the output's tabs: what the check and the build found, the build's output, how the last run in Mimir ended, and the
 *  cycles of the lines chosen */
export type AsmOutTab = 'problems' | 'build' | 'run' | 'cycles';

const MAINS_KEY = 'kr.asmMain', LANGS_KEY = 'kr.asmLang', OPEN_KEY = 'kr.asmOpen', LAYOUT_KEY = 'kr.asmLayout', TABS_KEY = 'kr.asmTabs', MACHINE_KEY = 'kr.asmMachine', SPLIT_KEY = 'kr.asmSplit';

/** what a run in Mimir runs in: Mimir's 6510 with the program's memory only, or the whole C64 (Sindri, VICE's ROMs) */
export type AsmMachineKind = 'memory' | 'c64';

/** a folder's tabs: the files open in the editor, in their order, and the one that is a preview (a click in the list
 *  opens a file there, and the next click puts another in its place; typing in it or a double-click keeps it) */
export interface AsmTabs { open: string[]; preview: string | null }
export const NO_TABS: AsmTabs = { open: [], preview: null };

/** a folder's split editor: the file the second editor shows, where it is (`right`: beside the first, `down`: under
 *  it) and its share of the room the two have */
export interface AsmSplit { path: string; side: 'right' | 'down'; size: number }
const readSplits = (): Record<string, AsmSplit> => {
  const v = store.get<Record<string, Partial<AsmSplit>> | null>(SPLIT_KEY, null) ?? {}, out: Record<string, AsmSplit> = {};
  for (const [dir, s] of Object.entries(v)) if (s && typeof s.path === 'string' && s.path) {
    out[dir] = { path: s.path, side: s.side === 'down' ? 'down' : 'right', size: Number.isFinite(s.size) ? Math.max(0.15, Math.min(0.85, s.size!)) : 0.5 };
  }
  return out;
};

/** `cycles`: each instruction's 6510 cycles beside its line number, the lines chosen counted under Cycles; `splitSide`,
 *  `splitSize`: where a split opens and its share of the room (as the last split had them) */
interface Layout { outH: number; outFolded: boolean; listFolded: boolean; listW: number; outTab: AsmOutTab; cycles: boolean; splitSide: 'right' | 'down'; splitSize: number }
const readLayout = (): Layout => {
  const v = store.get<Partial<Layout> | null>(LAYOUT_KEY, null) ?? {};
  return {
    outH: Number.isFinite(v.outH) ? Math.max(110, Math.min(1200, v.outH!)) : 200, outFolded: v.outFolded === true, listFolded: v.listFolded === true,
    listW: Number.isFinite(v.listW) ? Math.max(160, Math.min(700, v.listW!)) : 240, outTab: v.outTab === 'build' || v.outTab === 'run' || v.outTab === 'cycles' ? v.outTab : 'problems',
    cycles: v.cycles === true, splitSide: v.splitSide === 'down' ? 'down' : 'right', splitSize: Number.isFinite(v.splitSize) ? Math.max(0.15, Math.min(0.85, v.splitSize!)) : 0.5,
  };
};

interface AsmState extends Layout {
  /** the main file chosen per folder (by the folder's path) */
  mains: Record<string, string>;
  /** the language chosen per folder */
  langs: Record<string, ScriptLang>;
  /** the file shown last per folder */
  shown: Record<string, string>;
  /** the folders of the tree that are open, per folder */
  expanded: Record<string, string[]>;
  /** the breakpoints by folder and file: the lines */
  bps: Record<string, number[]>;
  /** the tabs of each folder (by the folder's path) */
  tabs: Record<string, AsmTabs>;
  /** what each folder's runs in Mimir run in (missing: memory only) */
  machines: Record<string, AsmMachineKind>;
  /** each folder's split editor (missing: none) */
  splits: Record<string, AsmSplit>;
  set: (patch: Partial<Layout>) => void;
  setMain: (dir: string, path: string | null) => void;
  setLang: (dir: string, lang: ScriptLang | null) => void;
  setShown: (dir: string, path: string | null) => void;
  setExpanded: (dir: string, paths: string[]) => void;
  setBps: (dir: string, path: string, lines: number[]) => void;
  setTabs: (dir: string, tabs: AsmTabs) => void;
  setMachine: (dir: string, kind: AsmMachineKind) => void;
  setSplit: (dir: string, split: AsmSplit | null) => void;
}

const without = <T,>(r: Record<string, T>, k: string): Record<string, T> => { const { [k]: _, ...rest } = r; return rest; };
const layoutOf = (s: Layout): Layout => ({ outH: s.outH, outFolded: s.outFolded, listFolded: s.listFolded, listW: s.listW, outTab: s.outTab, cycles: s.cycles, splitSide: s.splitSide, splitSize: s.splitSize });

export const useAssembler = create<AsmState>((set, get) => ({
  ...readLayout(),
  mains: store.get<Record<string, string>>(MAINS_KEY, {}),
  langs: store.get<Record<string, ScriptLang>>(LANGS_KEY, {}),
  shown: store.get<Record<string, string>>(OPEN_KEY, {}),
  expanded: {},
  bps: {},
  tabs: store.get<Record<string, AsmTabs>>(TABS_KEY, {}),
  machines: store.get<Record<string, AsmMachineKind>>(MACHINE_KEY, {}),
  splits: readSplits(),
  set: patch => { set(patch); store.set(LAYOUT_KEY, layoutOf({ ...get(), ...patch })); },
  setMain: (dir, path) => { const mains = path ? { ...get().mains, [dir]: path } : without(get().mains, dir); store.set(MAINS_KEY, mains); set({ mains }); },
  setLang: (dir, lang) => { const langs = lang ? { ...get().langs, [dir]: lang } : without(get().langs, dir); store.set(LANGS_KEY, langs); set({ langs }); },
  setShown: (dir, path) => { const shown = path ? { ...get().shown, [dir]: path } : without(get().shown, dir); store.set(OPEN_KEY, shown); set({ shown }); },
  setExpanded: (dir, paths) => set({ expanded: { ...get().expanded, [dir]: paths } }),
  setMachine: (dir, kind) => { const machines = kind === 'c64' ? { ...get().machines, [dir]: kind } : without(get().machines, dir); store.set(MACHINE_KEY, machines); set({ machines }); },
  setSplit: (dir, sp) => {
    const was = get().splits[dir];
    if (sp ? was && was.path === sp.path && was.side === sp.side && was.size === sp.size : !was) return;
    const splits = sp ? { ...get().splits, [dir]: sp } : without(get().splits, dir); store.set(SPLIT_KEY, splits); set({ splits });
    // (the next split opens as this one is)
    if (sp && (sp.side !== get().splitSide || sp.size !== get().splitSize)) get().set({ splitSide: sp.side, splitSize: sp.size });
  },
  setTabs: (dir, t) => { const tabs = { ...get().tabs, [dir]: t }; store.set(TABS_KEY, tabs); set({ tabs }); },
  setBps: (dir, path, lines) => {
    const k = `${dir}|${path}`, had = get().bps[k];
    // (nothing changes: no new state, so a file's breakpoints set as its model is made draw nothing again)
    if (had ? had.length === lines.length && had.every((l, i) => l === lines[i]) : !lines.length) return;
    set({ bps: lines.length ? { ...get().bps, [k]: lines } : without(get().bps, k) });
  },
}));
