/* What the Assembler keeps (spec 10.7): per folder the main file and the language when the user chose them (else
 * they are found from the sources), the folders of the tree that are open, the breakpoints, the output's tab and height,
 * and whether the file list is folded. The folder, its files and their texts are the Assembler's own (AssemblerView). */
import { create } from 'zustand';
import type { ScriptLang } from '@mimir/core';
import { store } from '../lib/util';

/** the output's tabs: what the check and the build found, the build's output, and how the last run in Mimir ended */
export type AsmOutTab = 'problems' | 'build' | 'run';

const MAINS_KEY = 'kr.asmMain', LANGS_KEY = 'kr.asmLang', OPEN_KEY = 'kr.asmOpen', LAYOUT_KEY = 'kr.asmLayout';

interface Layout { outH: number; outFolded: boolean; listFolded: boolean; listW: number; outTab: AsmOutTab }
const readLayout = (): Layout => {
  const v = store.get<Partial<Layout> | null>(LAYOUT_KEY, null) ?? {};
  return {
    outH: Number.isFinite(v.outH) ? Math.max(110, Math.min(1200, v.outH!)) : 200, outFolded: v.outFolded === true, listFolded: v.listFolded === true,
    listW: Number.isFinite(v.listW) ? Math.max(160, Math.min(700, v.listW!)) : 240, outTab: v.outTab === 'build' || v.outTab === 'run' ? v.outTab : 'problems',
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
  set: (patch: Partial<Layout>) => void;
  setMain: (dir: string, path: string | null) => void;
  setLang: (dir: string, lang: ScriptLang | null) => void;
  setShown: (dir: string, path: string | null) => void;
  setExpanded: (dir: string, paths: string[]) => void;
  setBps: (dir: string, path: string, lines: number[]) => void;
}

const without = <T,>(r: Record<string, T>, k: string): Record<string, T> => { const { [k]: _, ...rest } = r; return rest; };
const layoutOf = (s: Layout): Layout => ({ outH: s.outH, outFolded: s.outFolded, listFolded: s.listFolded, listW: s.listW, outTab: s.outTab });

export const useAssembler = create<AsmState>((set, get) => ({
  ...readLayout(),
  mains: store.get<Record<string, string>>(MAINS_KEY, {}),
  langs: store.get<Record<string, ScriptLang>>(LANGS_KEY, {}),
  shown: store.get<Record<string, string>>(OPEN_KEY, {}),
  expanded: {},
  bps: {},
  set: patch => { set(patch); store.set(LAYOUT_KEY, layoutOf({ ...get(), ...patch })); },
  setMain: (dir, path) => { const mains = path ? { ...get().mains, [dir]: path } : without(get().mains, dir); store.set(MAINS_KEY, mains); set({ mains }); },
  setLang: (dir, lang) => { const langs = lang ? { ...get().langs, [dir]: lang } : without(get().langs, dir); store.set(LANGS_KEY, langs); set({ langs }); },
  setShown: (dir, path) => { const shown = path ? { ...get().shown, [dir]: path } : without(get().shown, dir); store.set(OPEN_KEY, shown); set({ shown }); },
  setExpanded: (dir, paths) => set({ expanded: { ...get().expanded, [dir]: paths } }),
  setBps: (dir, path, lines) => {
    const k = `${dir}|${path}`, had = get().bps[k];
    // (nothing changes: no new state, so a file's breakpoints set as its model is made draw nothing again)
    if (had ? had.length === lines.length && had.every((l, i) => l === lines[i]) : !lines.length) return;
    set({ bps: lines.length ? { ...get().bps, [k]: lines } : without(get().bps, k) });
  },
}));
