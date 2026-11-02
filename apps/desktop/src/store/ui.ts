/* Per-user UI preferences, persisted in localStorage. */
import { create } from 'zustand';
import type { MonitorMode } from '@mimir/core';
import { store } from '../lib/util';

export type Theme = 'dark' | 'light';
export type EditorTab = 'listing' | 'source' | 'spec' | 'gfx' | 'mem';
export type BottomTab = 'log' | 'problems' | 'xrefs' | 'irqs' | 'relocs' | 'spindle' | 'bitfire' | 'stats' | 'build';
export type Activity = 'explorer' | 'blocks' | 'symbols' | 'bookmarks' | 'pack';
export interface Sizes { side: number; insp: number; bottom: number }
/** the inspector (the panel on the right): always open, or folded into a strip at the right edge that opens it over the
 *  editor when it is needed and folds it in again at a click outside it */
export type InspectorMode = 'open' | 'auto';
/** what the listing's left column shows: the memory address of the line, or its line number in the .asm file */
export type Gutter = 'addr' | 'line';
/** the Graphics tab: memory as characters, sprites or bitmaps, and how it is drawn */
export interface GfxPrefs {
  kind: 'chars' | 'sprites' | 'bitmap' | 'screens' | 'fontrows';
  charCols: number; spriteCols: number; screenCols: number; zoom: number; mc: boolean; offset: number;
  colors: { bg: number; fg: number; mc1: number; mc2: number };
  /** what screens are drawn with: VICE's character ROM ('rom', 'rom-lower'), the built-in letters ('builtin') or the
   *  2 KB of memory at an address ('$3000') */
  screenFont: string;
  /** a font per row: where the 40 screen codes are, the first row's font (the next rows' follow 2 KB apart), how many rows,
   *  and whether memory where no font can be is passed over */
  rowCodes: number; rowFonts: number; rowCount: number; rowSkip: boolean;
  /** the version of these settings (2: 40 characters a row is the default) */
  v?: number;
}
const GFX_DEFAULTS: GfxPrefs = { kind: 'chars', charCols: 40, spriteCols: 8, screenCols: 1, zoom: 2, mc: false, offset: 0, colors: { bg: 0, fg: 1, mc1: 15, mc2: 12 }, screenFont: 'rom', rowCodes: 0x0400, rowFonts: 0x2000, rowCount: 25, rowSkip: true };
/** The saved Graphics settings over the defaults. 40 characters a row (a screen's width) became the default: the old
 *  default 32 moves to it once (`v` 2), a count picked before stays. */
export function gfxPrefs(saved: Partial<GfxPrefs>): GfxPrefs {
  const p = { ...GFX_DEFAULTS, ...saved, v: 2 };
  if ((saved.v ?? 1) < 2 && saved.charCols === 32) p.charCols = 40;
  return p;
}
/** the Memory tab: VICE's m (hex and text, 16 or 8 bytes a row), i (PETSCII) or ii (screen codes), which character set, block colours */
export interface MonPrefs { mode: MonitorMode; perRow: 8 | 16; lower: boolean; colors: boolean }
const MON_DEFAULTS: MonPrefs = { mode: 'm', perRow: 16, lower: false, colors: false };

interface UiState {
  theme: Theme;
  tab: EditorTab;
  bottom: BottomTab;
  activity: Activity;
  /** the side panel (Explorer, Blocks, Symbols, Bookmarks, Pack) is shown; collapsed, the listing and the other views get its room */
  sidePanel: boolean;
  /** the bottom panel (log, problems, xrefs …) is open */
  panelOpen: boolean;
  inspector: InspectorMode;
  welcome: boolean;
  heatFit: boolean;
  gutter: Gutter;
  /** listing only: show the blocks that are not code disassembled (not persisted: the listing then differs from the export) */
  dataAsCode: boolean;
  /** listing: the 6510 cycles of every instruction, and the cycles of the selected range or block */
  cycles: boolean;
  /** listing: the offset column, where each byte is in the file it was opened from (as in SourceGen) */
  offsets: boolean;
  /** a new VICE quicksave (Alt+F11 in VICE) is opened when it is written */
  followQuicksave: boolean;
  /** the start screen is shown when the app starts; off: it goes on with what was worked on last */
  startScreen: boolean;
  /** the side panel's sections opened in this run (by id); not persisted: every section is closed when the app starts */
  sideOpen: string[];
  /** the user's own bookmark colours, for every project: eight places, each #rrggbb or empty */
  bmColors: string[];
  gfx: GfxPrefs;
  mon: MonPrefs;
  sizes: Sizes;
  set: (patch: Partial<Omit<UiState, 'set'>>) => void;
}

/** how many colours of their own the user can keep for bookmarks */
export const OWN_BM_COLORS = 8;
/** the saved own bookmark colours: always eight places, those that are not #rrggbb empty */
export const bmColorsOf = (saved: unknown): string[] =>
  Array.from({ length: OWN_BM_COLORS }, (_, i) => { const c = Array.isArray(saved) ? saved[i] : null; return typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c) ? c.toLowerCase() : ''; });

const PERSIST = ['theme', 'tab', 'sidePanel', 'panelOpen', 'inspector', 'welcome', 'heatFit', 'gutter', 'cycles', 'offsets', 'followQuicksave', 'startScreen', 'bmColors', 'gfx', 'mon', 'sizes'] as const;

export const useUi = create<UiState>((set) => ({
  theme: store.get<Theme>('kr.theme', 'dark'),
  tab: store.get<EditorTab>('kr.tab', 'listing'),
  bottom: 'log',
  activity: 'explorer',
  sidePanel: store.get('kr.sidePanel', true),
  panelOpen: store.get('kr.panel', true),
  inspector: store.get<InspectorMode>('kr.inspector', 'open') === 'auto' ? 'auto' : 'open',
  welcome: store.get('kr.welcome', true),
  heatFit: store.get('kr.fit', true),
  gutter: store.get<Gutter>('kr.gutter', 'addr'),
  dataAsCode: false,
  cycles: store.get('kr.cycles', false),
  offsets: store.get('kr.offsets', true),
  followQuicksave: store.get('kr.followQuicksave', true),
  startScreen: store.get('kr.startScreen', true),
  sideOpen: [],
  bmColors: bmColorsOf(store.get<unknown>('kr.bmColors', [])),
  gfx: gfxPrefs(store.get<Partial<GfxPrefs>>('kr.gfx', {})),
  mon: { ...MON_DEFAULTS, ...store.get<Partial<MonPrefs>>('kr.mon', {}) },
  sizes: store.get<Sizes>('kr.sizes', { side: 272, insp: 312, bottom: 230 }),
  set: patch => set(patch),
}));

useUi.subscribe((s, prev) => {
  for (const k of PERSIST) {
    if (s[k] === prev[k]) continue;
    const key = k === 'panelOpen' ? 'kr.panel' : k === 'heatFit' ? 'kr.fit' : `kr.${k}`;
    store.set(key, s[k]);
  }
});
