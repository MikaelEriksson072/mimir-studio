/* An Assembler project (spec 10.7) in the project window: what the Assembler tab and the rest of the window tell each
 * other. The tab checks the sources as they are typed and puts the program they make here (the project's views,
 * Graphics, Memory, the inspector and the Explorer, show it); the window asks it to show an address's line in the
 * sources, to run or build, and to write what is not written yet before the window closes or the project does. */
import { create } from 'zustand';
import type { Addr, AnalysisResult, AsmBlockKind, AsmByteChange, AsmC64Note, AsmCheck, AsmProgram, CodeLibBuilt, CodeLibKind, ScriptLang } from '@mimir/core';
import type { LibraryRef } from './library';

/** what the window asks the Assembler tab for; `block`: Insert block, of a kind or with a library item; `log`: `text`
 *  (a pack's) after the last build's, under Build; `write`: bytes drawn (the enlarged sprite or character) written into
 *  the lines that write them; `drop`: files dropped on the window copied into the folder; the bookmarks': `bmAdd` the
 *  editor for the caret's line, `bmGo` the line of bookmark `id`, `bmJump` the next (`dir` 1) or previous one,
 *  `line` a file's `line` shown (to `end`, selected) while a bookmark is edited; the macro and code libraries' (10.8):
 *  `codeLib` the dialog for a new item of the lines selected (`libKind` its library, `libInto` a collection it goes in),
 *  `insert` an item put in the source */
export interface AsmAsk {
  what: 'run' | 'build' | 'debug' | 'debugger' | 'block' | 'log' | 'write' | 'drop' | 'bmAdd' | 'bmGo' | 'bmJump' | 'line' | 'codeLib' | 'insert' | 'dropImport'; n: number;
  kind?: AsmBlockKind; lib?: LibraryRef; text?: string; changes?: AsmByteChange[]; files?: AsmDropped[]; at?: string | null;
  id?: string; dir?: 1 | -1; line?: number; end?: number | null; libKind?: CodeLibKind; libInto?: string; insert?: AsmInsert;
}
/** an item of the macro or code library put in the source shown, where the caret is: `call` a macro's call (`text` a
 *  snippet: its parameters places to type in), else its lines at the caret's line (`block`: a macro's definition, an
 *  empty line before and after it where the lines beside it have text); `lang` the assembler it is written for,
 *  `macro` the name of the macro it calls or defines */
/** where macros of the project's macro file's files are defined in the project itself (left out of it): a source of
 *  its own, or a file it imports from outside the folder (`key` as the check names it, `where` where it was found,
 *  `importers` the sources that import it) */
export interface AsmMacroDefined { key: string; where: string; outside: boolean; names: string[]; importers: string[] }
export interface AsmInsert { text: string; call: boolean; block: boolean; lang: ScriptLang; name: string; macro: string | null; library: string; top?: boolean }
/** a file dropped on the window: copied into the project's folder (`drop`; `at`: the folder or file it was dropped on in the file list) */
export interface AsmDropped { name: string; bytes: Uint8Array }
export interface AsmLive { mem: Uint8Array; pc: Addr; where: string | null; whole: boolean; running: boolean; n: number }
/** the main file built with KickAss.jar or 64tass (Pack, Release): the PRG's bytes, where it and its labels are, and
 *  the main file (a path in the project's folder) */
export interface AsmBuilt { prg: Uint8Array; prgPath: string; vsPath: string | null; main: string }

interface AsmLinkState {
  /** the program the sources make, as the project's views take it: the last check that assembled (null: none yet) */
  program: AsmProgram | null;
  /** that check (an address's file and line), and whether the sources as they are now assemble */
  check: AsmCheck | null;
  assembles: boolean;
  /** an address whose line the Assembler tab is to show (`n` tells one request from the next) */
  show: { addr: Addr; n: number } | null;
  /** Run, Build, Debug or Insert block asked for outside the tab (the title bar, F5 on another tab, the palette, the
   *  library's menu) */
  ask: AsmAsk | null;
  /** a build is running */
  building: boolean;
  /** the main file the tab builds (a path in the project's folder; null: none yet) */
  main: string | null;
  /** the sources in the project's folder, and the main file Mimir finds among them (Settings → Assembler project) */
  sources: string[];
  found: string | null;
  /** the text files in the folder (a bookmark can be in any), how many lines one has (null: none such), the title a
   *  bookmark gets on a line (the label there, else the file and line) */
  textFiles: string[];
  linesOf: (file: string) => number | null;
  titleAt: (file: string, line: number) => string;
  /** the source that defines a macro (a pseudo command, a function, a segment) of that name (null: none does), for
   *  the macro library (spec 10.8) */
  macroDefined: (name: string) => string | null;
  /** the project's macro file as Mimir built it last (what is in it and why; where the macros of its files the project
   *  defines itself are; null: the project has none) */
  macroFile: (CodeLibBuilt & { file: string; defined: AsmMacroDefined[] }) | null;
  /** the caret's line in the Assembler, and the lines selected (`to` > `from`: more than one) */
  caret: { file: string; line: number } | null;
  selection: { file: string; from: number; to: number } | null;
  /** the C64 checks of the program (the window's analysis of it: asmC64Notes) */
  notes: AsmC64Note[];
  /** the window's analysis of the program (null: none yet), and its cursor and selection: the pictures in the editor
   *  (lib/asmgfx.ts) are drawn multicolour as its VIC evidence says, name its sprite pointers, and show what is picked */
  analysis: AnalysisResult | null;
  place: { cursor: Addr | null; sel: { start: Addr; end: Addr } | null };
  /** the memory of the program being debugged (Memory and Graphics show it while it is): its RAM, where it stopped (or
   *  runs: `running`), that line, whether it is the whole C64; `n` tells one from the next. Null: not debugging */
  live: AsmLive | null;
  /** what is not written yet, written (the tab sets it) */
  flush: () => Promise<unknown>;
  /** the main file built (what is not written yet is written first); null: it was not (the tab said why) */
  buildPrg: () => Promise<AsmBuilt | null>;
  set: (p: Partial<Omit<AsmLinkState, 'set' | 'reset' | 'request' | 'showAddr'>>) => void;
  request: (what: AsmAsk['what'], o?: Pick<AsmAsk, 'kind' | 'lib' | 'text' | 'changes' | 'files' | 'at' | 'id' | 'dir' | 'line' | 'end' | 'libKind' | 'libInto' | 'insert'>) => void;
  showAddr: (addr: Addr) => void;
  /** the project closed: nothing is kept */
  reset: () => void;
}

const none = () => Promise.resolve();
const noBuild = () => Promise.resolve(null);
/** no folder open: no text files, no caret */
const NO_PLACE = { cursor: null, sel: null };
const NO_TEXT = { textFiles: [], linesOf: () => null, titleAt: (file: string, line: number) => `${file}:${line}`, macroDefined: () => null, macroFile: null, caret: null, selection: null };
export const useAsmLink = create<AsmLinkState>(set => ({
  program: null, check: null, assembles: false, show: null, ask: null, building: false, main: null, sources: [], found: null, ...NO_TEXT, notes: [], analysis: null, place: NO_PLACE, live: null, flush: none, buildPrg: noBuild,
  set: p => set(p),
  request: (what, o) => set(s => ({ ask: { what, n: (s.ask?.n ?? 0) + 1, ...o } })),
  showAddr: addr => set(s => ({ show: { addr, n: (s.show?.n ?? 0) + 1 } })),
  reset: () => set({ program: null, check: null, assembles: false, show: null, ask: null, building: false, main: null, sources: [], found: null, ...NO_TEXT, notes: [], analysis: null, place: NO_PLACE, live: null, flush: none, buildPrg: noBuild }),
}));
