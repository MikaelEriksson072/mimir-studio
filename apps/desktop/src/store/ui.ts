/* Per-user UI preferences, persisted in localStorage. */
import { create } from 'zustand';
import { DEFAULT_PACK, MONITOR_PER_ROW, type BlockKind, type MonitorMode, type MonitorPerRow, type PackPrefs } from '@mimir/core';
import { store } from '../lib/util';
import { bitmapRowsOf, spriteColsOf } from '../lib/gfxview';

export type Theme = 'dark' | 'light';
export type EditorTab = 'listing' | 'drive' | 'source' | 'spec' | 'gfx' | 'mem' | 'scripts' | 'git';
export type BottomTab = 'log' | 'messages' | 'problems' | 'xrefs' | 'irqs' | 'relocs' | 'spindle' | 'bitfire' | 'booze' | 'sparkle' | 'krill' | 'covert' | 'pirateslayer' | 'tape' | 'stats' | 'build';
export type Activity = 'explorer' | 'blocks' | 'symbols' | 'bookmarks' | 'scripts' | 'pack';
export interface Sizes { side: number; insp: number; bottom: number }
/** the inspector (the panel on the right): always open, or folded into a strip at the right edge that opens it over the
 *  editor when it is needed and folds it in again at a click outside it */
export type InspectorMode = 'open' | 'auto';
/** how the Explorer lists the mounted disk: Mimir's own list, or the C64's screen after LOAD"$",8 and LIST (its font,
 *  PETSCII and colours) */
export type DiskLook = 'mimir' | 'c64';
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
  /** bitmaps: how many character rows of each are drawn and selected, 1-25 (fewer for a picture smaller than the screen) */
  bitmapRows: number;
  /** the version of these settings (2: 40 characters a row is the default) */
  v?: number;
}
const GFX_DEFAULTS: GfxPrefs = { kind: 'chars', charCols: 40, spriteCols: 8, screenCols: 1, zoom: 2, mc: false, offset: 0, colors: { bg: 0, fg: 1, mc1: 15, mc2: 12 }, screenFont: 'rom', rowCodes: 0x0400, rowFonts: 0x2000, rowCount: 25, rowSkip: true, bitmapRows: 25 };
/** The saved Graphics settings over the defaults. 40 characters a row (a screen's width) became the default: the old
 *  default 32 moves to it once (`v` 2), a count picked before stays. A bitmap height that is not 1-25 rows is 25,
 *  sprites a row that are not 1-24 are 8. */
export function gfxPrefs(saved: Partial<GfxPrefs>): GfxPrefs {
  const p = { ...GFX_DEFAULTS, ...saved, v: 2 };
  if ((saved.v ?? 1) < 2 && saved.charCols === 32) p.charCols = 40;
  p.bitmapRows = bitmapRowsOf(p.bitmapRows);
  p.spriteCols = spriteColsOf(p.spriteCols);
  return p;
}
/** the Memory tab: VICE's m, i (PETSCII) or ii (screen codes), each as hex and text with `perRow` bytes a row, which
 *  character set, block colours */
export interface MonPrefs { mode: MonitorMode; perRow: MonitorPerRow; lower: boolean; colors: boolean }
const MON_DEFAULTS: MonPrefs = { mode: 'm', perRow: 16, lower: false, colors: false };
/** The saved Memory settings over the defaults; bytes a row the tab does not offer are 16. */
export function monPrefs(saved: Partial<MonPrefs>): MonPrefs {
  const p = { ...MON_DEFAULTS, ...saved };
  if (!MONITOR_PER_ROW.includes(p.perRow)) p.perRow = MON_DEFAULTS.perRow;
  return p;
}

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
  /** listing: each line's bytes as PETSCII and as screen codes, in two columns at its right (V) */
  textCols: boolean;
  /** listing: sprites, charsets and bitmaps drawn as they look instead of their .byte rows (Settings → General) */
  gfxPictures: boolean;
  /** a packed file is unpacked as it is opened, when its unpacker says it is packed (Settings → General) */
  autoUnpack: boolean;
  /** a new VICE quicksave (Alt+F11 in VICE) is opened when it is written */
  followQuicksave: boolean;
  /** the start screen is shown when the app starts; off: it goes on with what was worked on last */
  startScreen: boolean;
  /** the overview of the analysis opens once the analysis of a file just opened is in (Settings → General, 14.1b) */
  overview: boolean;
  /** the mounted disk's directory as Mimir lists it or as a C64 does (Settings → General) */
  diskLook: DiskLook;
  /** marking a range (C, D, W, T …) merges it with the blocks of that type right before and after it (Settings → General) */
  autoMerge: boolean;
  /** how Pack on the start screen packs a file without a project (the packer, format, kind of file …), for the next time */
  quickPack: PackPrefs;
  /** New project makes a git repository in the project's folder too (the box as it was ticked last) */
  newProjectGit: boolean;
  /** the side panel's sections opened in this run (by id); not persisted: every section is closed when the app starts */
  sideOpen: string[];
  /** the Blocks view's folders (a block type each) opened in this run; not persisted: every folder is closed when the app starts */
  blkOpen: BlockKind[];
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

const PERSIST = ['theme', 'tab', 'sidePanel', 'panelOpen', 'inspector', 'welcome', 'heatFit', 'gutter', 'cycles', 'offsets', 'textCols', 'gfxPictures', 'autoUnpack', 'followQuicksave', 'startScreen', 'overview', 'diskLook', 'autoMerge', 'quickPack', 'newProjectGit', 'bmColors', 'gfx', 'mon', 'sizes'] as const;

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
  textCols: store.get('kr.textCols', false),
  gfxPictures: store.get('kr.gfxPictures', true),
  autoUnpack: store.get('kr.autoUnpack', false),
  followQuicksave: store.get('kr.followQuicksave', true),
  startScreen: store.get('kr.startScreen', true),
  overview: store.get('kr.overview', true),
  diskLook: store.get<DiskLook>('kr.diskLook', 'mimir') === 'c64' ? 'c64' : 'mimir',
  autoMerge: store.get('kr.autoMerge', true),
  quickPack: { ...DEFAULT_PACK, ...store.get<Partial<PackPrefs>>('kr.quickPack', {}) },
  newProjectGit: store.get<unknown>('kr.newProjectGit', false) === true,
  sideOpen: [],
  blkOpen: [],
  bmColors: bmColorsOf(store.get<unknown>('kr.bmColors', [])),
  gfx: gfxPrefs(store.get<Partial<GfxPrefs>>('kr.gfx', {})),
  mon: monPrefs(store.get<Partial<MonPrefs>>('kr.mon', {})),
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
