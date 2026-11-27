/* =====================================================================
 * Mimir Studio — renderer root. The project lives in the Zustand
 * store; analysis and rendering run in a Web Worker; file system and
 * toolchain access go through the typed `window.kr` bridge.
 * ===================================================================== */
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import {
  asmC64Notes, assemblerSources, bankRange, buildScripts, comparePrg, createProject, releaseImage, releaseStarts, cyclePath, d64FileName, detectPacking, makePrg, mergeOverride, nextSides, portName, portText, deserializeProject, exportFiles, findBlock, h2, h4, kindInfo, lineMove, lineText, MARK_AS, markOverride, MAX_BLANKS, moveBlockKeys, resizeBlock,
  gfxToData, keepCutTypes, markIdOf, moveFrom, splitBlock, type BlockResize,
  formatOverride, openC64File, overwritesSystemArea, coversReadyScreen, parseVsf, patchSnapshot, editRanges, showcaseProject, parseD64, parsePrg, pastEndText, projectNameFor, unpackedName, rangeCover, bitfireFileName, boozeFileName, readBitfireDisk, readBoozeDisk, readCovertDisk, readIfflDisk, IFFL_PACKER, ifflPartName, ifflPieceName, ifflPiecePrg, covertDiskFile, covertFileName, covertFilePrg, covertScript, covertScriptText, covertSummary, covertUnpackedName, dlocFileName, dlocFilePrg, dlocScript, dlocScriptText, dlocSummary, dlocUnpackedName, readDlocDisk, readD64File, readKrillDisk, cc1541Script, krillPackerName, krillScriptText, krillDiskPrg, krillFileName, krillFilePrg, krillUnpackedName, readSparkleDisk, sparkleChunkName, sparkleChunkPrg, sparkleScript, pirateSlayerFileList, pirateSlayerFileName, pirateSlayerPrg, readPirateSlayerDisk, paraProtectFileList, paraProtectPrg, readParaProtectDisk, diskSpeedFileList, diskSpeedPrg, readDiskSpeedDisk, writeDiskFile, readSpindleDisk, readTape, replaceTapeFile, tapeBoot, tapeFileName, tapeToolScript, writeT64, spinChunkName, spinScript, d64writeScript, boozeFileList, projectTextFiles, shellWord, SYSTEM_AREA, READY_SCREEN, START_STUB, textLabel, TOOLCHAIN_KEYS, validLabel, withId, ASSEMBLERS, assemblerOf, isLabelDefinition, labelFor,
  patchAt, patchEnd, patchesOn, patchFileName, patchPrg, switchPatch, withoutPatch, withPatch, notPacked, packedData, packerNames, unpackLog, ioSummary, sidPlayer, musicPlayData, musicSidFile, decode, zpPairable,
  charsetFile, libraryStem, parsePsid, sidWithTexts, spriteFile, findPictureColors, type LibraryColors, type LibraryItem, type LibraryKind, type LibrarySource,
  addReloc, loadAddress, loadRange, moveReloc, relocAt, relocLoadedAt, removeReloc, type Reloc,
  addJunk, junkPlan, removeJunk, type JunkArea,
  removeViewOffset, setViewOffset, shiftText, shownAddress, shownTarget, viewOffsetAt, type ViewOffset,
  checkScript, loadScripts, runChangeText, withRunChanges, scriptFits, runResults, setScriptParams, planScriptActions, DiskEdit, diskKindOf, planScriptsRequests, SCRIPTS_RUN_CHAIN, type ScriptsPlan, scriptBlocksData, endedWell, scriptStopAt, type Roms, type ScriptCheck, type ScriptEnv, callScript, cryptScript, cryptStepsText, cryptWhereText, findCryptLoops, type CryptLoop, lineComment, filePad, fileRunPlan, fileRunResults, type ScriptFileResult, asmOfLang, langOf, templateSource, LANG_TITLE, patchLang, OPC, type ScriptTemplate, linkName, type MusicField, musicNames, newId, newScript, padName, scriptPlace, scriptEndText, scriptEnv, scriptName, scriptPatches, withoutScriptPatches, writeScriptRun, type ScriptRun, type ScriptLoaderData, type ScriptExportData, type ScriptExportRequest, applyExportRequest, type ScriptBuildData, type ScriptBuildRequest, buildRequestText, type ScriptSidData, type ScriptSidRequest, sidRequestText, type ScriptLibraryData, type ScriptLibraryRequest, type UserScript,
  BLOCK_PAD_FORM, blockPad, padText, scriptNames, type BlockPad, type ScriptPad,
  bankFiles, bootBank, builtCartridge, cartBuild, cartridgeFiles, chipAddress, crtBanks, loadedRanges, compareCrt, describeCrt, expectedCartridge, fileOffsetBases, isCrt, openCartridge, parseCrt, SPACE, spaceAddr, spaceOf, spaceRender, spaceView, type Crt,
  type Addr, type AnalysisResult, type Block, type SpriteColors, type DriveCode, type Bookmark, type AsmBookmark, type BuildScript, type ByteMove, type D64File, type PirateSlayerDisk, type PirateSlayerFile, type ParaProtectDisk, type ParaProtectFile, type DiskSpeedDisk, type DiskSpeedFile, type NumberFormat, type Override, type PackingInfo, type PackPrefs, type KickProblem, type ListingLine, type LoadedFile, type FileInput, type Patch, type PatchPlan, type Project, type RenderResult,
  type BitfireDisk, type BitfireFile, type ScriptLang, type BoozeDisk, type BoozeFile, type CovertDisk, type CovertFile, type DlocDisk, type DlocFile, type IfflDisk, type IfflFile, type IfflPart, type KrillDisk, type KrillFile, type SparkleBundle, type SparkleChunk, type SparkleDisk, type SerializedProject, type Settings, type SpindleChunk, type SpindleDisk, type SpindleJob, type TapeFile, type Token, type StartIo, type ToolchainSettings, type UnpackDiskBoot, type UnpackRun, type VerifyResult,
  debugSources, asmLineAt, type AsmProgram,
  knownRoutines, learnProject, learnRoutine, routineAt, routineSuggestions, startsRoutine, type RoutineMatch,
  builtInTemplate, originalTemplate, renderTemplate, sfxEntry, templateScripts, templateText, type BuildTemplate, type BuiltInTemplateId,
  codeLibCall, codeLibNeeds, type CodeLibEntry, type CodeLibKind,
} from '@mimir/core';
import { forgetUnsavedWork, keepDeclinedWork, keepUnsavedWork, newProjectSettings, unsavedWork, unsavedWorkChanged, useProject, workChanged } from './store/project';
import { useUi, type Activity, type BottomTab, type EditorTab, type InspectorMode } from './store/ui';
import { runScreenSize, useScripts, type LibraryScript } from './store/scripts';
import { useRoutines } from './store/routines';
import { useBuildTemplates } from './store/buildTemplates';
import { runScriptInWorker, stopScript, type ScriptRunOpts } from './lib/scriptrun';
import { RunOnFilesModal, RunValuesModal, type FilesRunBusy, type FilesRunThen, type ScriptFileChoice } from './components/ScriptFiles';
import { exportWorker, useAnalysis, verifyInWorker } from './lib/analysis';
import { PROJECT_FOLDERS } from '../shared/projects';
import { bankAdr, cx, errorText, filesKey, ROW, store, uid } from './lib/util';
import { labelRefs } from './lib/labelrefs';

/** what the Scripts tab folded in when it opened, to bring back when another tab opens */
interface ScriptsFold { sidePanel: boolean; panelOpen: boolean; inspector: InspectorMode }
const SCRIPTS_FOLD_KEY = 'kr.scriptsFold';
/** what each of the music's names in a script is (the editor's suggestions and hovers say it) */
const MUSIC_FIELD_TEXT: Record<MusicField, string> = { location: 'music: where it is loaded (LoadSid)', init: 'music: its init routine', play: 'music: its play routine', size: 'music: its length in bytes, no address' };
import { blockStep, foldLines } from './lib/fold';
import { closeWindow, holdClose, whenClosing } from './lib/closing';
import { blockMc, gfxColsFor, gfxListing, gfxMcChanges, markMc, spritePairColors } from './lib/gfxlines';
import { C64_NAMES } from './lib/palette';
import { gfxLayout } from './lib/gfxview';
import { blockView } from './lib/blockfolders';
import { cellAt, cellsOf, type Cell } from './lib/cells';
import { operandName, renameText, type NameRef } from './lib/rename';
import { commentOf } from './lib/comments';
import { findLines, findRegExp, findText, nextHit, type FindOptions } from './lib/find';
import { AssemblerContext, asmWords } from './lib/assembler';
import { onlyRelocates, withIdentified, withUnpackRun } from './lib/packing';
import { unpackBuiltIn } from './lib/unpack';
import { animDataText, chunkAnimData, type AnimData } from './lib/storeanim';
import { packDefaults, packKeyOf } from './lib/pack';
import { Icon, LVL_ICON } from './lib/icons';
import type { BuildState, CartCheck, Changed, Command, ContextMenuState, DiskSide, Editing, KickBuild, MenuItem, Message, MountedDisk, MountedTape, NavOptions, ScrollReq, Sel, Toast, ToastKind, UiProblem, ViewAt } from './lib/types';
import { TitleBar } from './components/TitleBar';
import { ActivityBar } from './components/ActivityBar';
import { StatusBar } from './components/StatusBar';
import { Sidebar, tapeOpens } from './components/Sidebar';
import { Listing, type ListingFind, type ScriptMark, type XrefBox } from './components/Listing';
import { FindBar } from './components/FindBar';
import { Inspector } from './components/Inspector';
import { BitfirePanel, BoozePanel, BOTTOM_TABS, BuildPanel, CovertPanel, DlocPanel, IfflPanel, KrillPanel, LogList, MessagesPanel, DiskSpeedPanel, ParaProtectPanel, PirateSlayerPanel, ProblemsPanel, RasterPanel, RelocPanel, SparklePanel, SpindlePanel, StatsPanel, TapePanel, XrefPanel } from './components/BottomPanel';
import { SettingsModal, type AppPrefs, type AsmSettings, type SettingsPage } from './components/Settings';
import { useAssembler } from './store/assembler';
import { CommandPalette, GotoModal } from './components/CommandPalette';
import { MergeRangeModal } from './components/MergeRange';
import { JunkRangeModal } from './components/JunkRange';
import { BlockSizeModal } from './components/BlockSize';
import { RelocateModal, type RelocDraft } from './components/Relocate';
import { BuildTemplatesModal } from './components/BuildTemplates';
import { ViewOffsetModal, type ViewOffsetDraft } from './components/ViewOffset';
import { PatchModal, type PatchDraft } from './components/Patch';
import { MemoryGfx } from './components/MemoryGfx';
import { MemoryDump } from './components/MemoryDump';
import { LibraryTab } from './components/LibraryTab';
import { LibraryAddModal, type LibraryAnswer, type LibraryDraft } from './components/LibraryAdd';
import { useLibrary, type LibraryRef } from './store/library';
import { useCodeLib } from './store/codelib';
import { CODE_LIB_TITLE, focusCodeLibSearch, itemMacro, type CodeLibInsert } from './components/CodeLibView';
import { CodeLibExportDialog } from './components/CodeLibExportDialog';
import { CodeLibDialog } from './components/CodeLibDialog';
import { deepSidName, LIB_COLORS, LIB_KIND, libraryKindOf, sameInLibrary } from './lib/library';
import type { BankChoice } from './components/ViewModes';
import { bookmarkList, bookmarkSpan } from './components/Bookmarks';
import { asmBookmarkSpan, newBookmarkId } from './components/AsmBookmarks';
import type { PackProgress, PackResult } from './components/Pack';
import { ContextMenu } from './components/ContextMenu';
import { Splitter } from './components/Splitter';
import { ErrorBoundary } from './components/ErrorBoundary';
import { CloseNotSavedModal, CloseUnsavedModal, CreateProjectModal, gitNote, ignoreOut, StartScreen, UnsavedWorkModal } from './components/Start';
import { useCanvasColors, type HeatMode } from './components/Heatmap';
import type { AsmPickResult, EditorFindResult, IdentifyResponse, OpenedPrg, PrgOpenKind, ProjectHome, QuicksaveEntry, QuicksaveInfo, RunRequest, RunResult } from '../shared/ipc';
import { QuickPack } from './components/QuickPack';
import { AssemblerTab, ContinueInAssemblerModal, type AsmContinueInfo } from './components/AssemblerView';
import { AsmReleaseModal, type ReleaseChoice } from './components/AsmRelease';
import { useAsmLink, type AsmBuilt, type AsmDropped } from './store/asmlink';
import { AnalysisOverview, type OverviewLinks, type PackCheck, type PackLook } from './components/Overview';
import { GFX_KIND, snapshotPc } from './lib/overview';

const SourceView = lazy(() => import('./components/SourceView').then(m => ({ default: m.SourceView })));
const SpecView = lazy(() => import('./components/SpecView').then(m => ({ default: m.SpecView })));
const GitView = lazy(() => import('./components/GitView').then(m => ({ default: m.GitView })));
const DriveView = lazy(() => import('./components/DriveView').then(m => ({ default: m.DriveView })));
const ScriptsView = lazy(() => import('./components/ScriptsView').then(m => ({ default: m.ScriptsView })));

const kr = window.kr;
/** how long a block whose type changed stays framed (the .changed animation in app.css) */
const CHANGED_MS = 4000;
/** the Junk list of a project without junk */
const NO_JUNK: readonly JunkArea[] = [];
/** the view offsets of a project without any (spec 10.4) */
const NO_OFFSETS: readonly ViewOffset[] = [];
const pickToolchain = (s: Settings): ToolchainSettings => Object.fromEntries(TOOLCHAIN_KEYS.map(k => [k, s[k]])) as ToolchainSettings;
/** the source shown first and opened in the external editor: the first file's, or a cartridge's banks in one source */
const mainSource = (R: RenderResult): string => R.main ?? `${R.fileNames[0] || 'main'}.asm`;

/** a debugger's run in the build log (spec 13.2b): its command line, the start code next to the program and what it
 *  types, and what is not as in VICE; nothing for VICE */
function runDetail(r: RunResult): string {
  if (!r.debugger) return '';
  const lines = r.argv ? [`> ${r.argv.map(shellWord).join(' ')}`] : [];
  if (r.code) lines.push(`(start code at $${h4(r.code.start)}-$${h4(r.code.end - 1)}${r.carried ? ', with the program, which it copies into place first' : ''}${r.typed ? `; it types ${r.typed}` : ''})`);
  for (const n of r.notes ?? []) lines.push(`Note: ${n}`);
  return lines.map(l => `\n${l}`).join('');
}
/** `n` empty lines above `addr` (Project.blanks) in a draft of the project: 0 removes them, and the record once empty */
/** X and Y as a music block's init routine loads them (MusicPlayData.regs): "X = $28 and Y = $b7" */
const regsGiven = (g: { x?: number; y?: number }): string => (['x', 'y'] as const).filter(r => g[r] != null).map(r => `${r.toUpperCase()} = $${h2(g[r]!)}`).join(' and ');

function putBlanks(d: Project, addr: Addr, n: number): void {
  if (!n && !d.blanks?.[addr]) return;
  const b = d.blanks ?? (d.blanks = {});
  if (n) b[addr] = n; else delete b[addr];
  if (!Object.keys(b).length) delete d.blanks;
}

type Range = { start: Addr; end: Addr };
/** The selection from its anchor (or `from` when there is none yet) to `r`; anchor and target both stay whole. */
function extendSel(s: Sel | null, from: Range | null, r: Range): Sel {
  const a0 = s?.anchor ?? from?.start ?? r.start;
  const a1 = s?.anchor != null ? (s.anchorEnd ?? a0 + 1) : (from?.end ?? a0 + 1);
  return { start: Math.min(a0, r.start), end: Math.max(a1, r.end), multi: true, anchor: a0, anchorEnd: a1 };
}

/** the bottom panel's tabs of a loader's script or the tape, which the analysis overview links to */
const SCRIPT_TABS: readonly BottomTab[] = ['spindle', 'bitfire', 'booze', 'sparkle', 'krill', 'iffl', 'covert', 'dloc', 'pirateslayer', 'paraprotect', 'diskspeed', 'tape'];
/** the script tabs a mounted disk's own load script (or files) fills, each named as the disk's field that holds it: the
 *  tab row marks them, so a disk with a script is seen to have one */
const DISK_SCRIPT_TABS = ['spindle', 'bitfire', 'booze', 'sparkle', 'krill', 'iffl', 'covert', 'dloc', 'pirateslayer', 'paraprotect', 'diskspeed'] as const satisfies readonly (BottomTab & keyof MountedDisk)[];
const isDiskScriptTab = (k: BottomTab): k is (typeof DISK_SCRIPT_TABS)[number] => (DISK_SCRIPT_TABS as readonly BottomTab[]).includes(k);

/** the tabs of an Assembler project (spec 10.7): its Assembler first, and the views that are not of the analysis, the
 *  re-assembly or the listing */
const ASM_TABS: readonly EditorTab[] = ['asm', 'gfx', 'mem', 'scripts', 'git', 'spec', 'library'];
/** the side panel's views an Assembler project has not (none now: its bookmarks are on lines of the sources, moving with
 *  them, and the Pack view packs what the Assembler builds) */
const ASM_HIDDEN_VIEWS: readonly Activity[] = [];
/** the views only an Assembler project has: the macro and code libraries (spec 10.8) */
const ASM_ONLY_VIEWS: readonly Activity[] = ['codelib'];
const NO_ASM_BOOKMARKS: Record<string, AsmBookmark> = {};
/** every byte loaded: the memory of a program being debugged is all there is (Memory and Graphics show any of it) */
const ALL_LOADED = new Int16Array(0x10000);
/** an Assembler project's commands: those that are not of the analysis, the re-assembly or the listing (its own Run,
 *  Build and Debug come first) */
const ASM_COMMANDS = new Set(['mount', 'tape', 'side-panel', 'inspector-show', 'inspector-mode', 'panel', 'library-show', 'library-add', 'save', 'save-copy', 'openproj', 'reveal', 'start-screen', 'settings', 'theme', 'undo', 'redo', 'tab-gfx', 'tab-mem', 'tab-scripts', 'script-full', 'tab-git', 'script-new', 'tab-spec', 'pack-view', 'pack-run', 'pack-save', 'gfx-pictures']);

/** what the workspace says when it opens (from the start screen); `n` tells two of the same apart */
type Note = { text: string; n: number };

export function App() {
  const theme = useUi(s => s.theme);
  useEffect(() => { const root = document.documentElement; root.dataset.theme = theme; root.dataset.resolved = theme; }, [theme]);
  // the desktop app starts with the start screen (a project, or work without one); `resume`: a reloaded window goes on
  // with what it worked on
  const [startScreen, setStartScreen] = useState<{ resume: boolean } | null>(kr ? { resume: true } : null);
  const [note, setNote] = useState<Note | null>(null);
  if (startScreen) return <StartScreen resume={startScreen.resume} onStarted={text => { setNote(text ? { text, n: Date.now() } : null); setStartScreen(null); }} />;
  return <Studio note={note} onStartScreen={() => setStartScreen({ resume: false })} />;
}

/** An Assembler project as its views take it (spec 10.7): the program its sources make in place of files loaded, with its
 *  code, labels and start, and nothing of a re-assembly's. */
function asmView(p: Project, prog: AsmProgram | null): Project {
  return { ...p, files: prog?.files ?? [], overrides: prog?.overrides ?? [], labels: prog?.labels ?? {}, entryPoint: prog?.entryPoint ?? null, entryPort: null, entryIo: null,
    entries: [], comments: {}, blockComments: {}, notes: {}, blanks: {}, relocs: [], excluded: [], binary: [], junk: [], viewOffsets: [], patches: [], bankZones: [], zpPairs: {}, cart: null };
}

function Studio({ note, onStartScreen }: { note: Note | null; onStartScreen: () => void }) {
  const stored = useProject(s => s.present), home = useProject(s => s.home);
  // an Assembler project's views show the program its sources make (its Assembler tab puts it in asmlink)
  const program = useAsmLink(s => s.program);
  const view = useMemo(() => (stored.asm && home ? asmView(stored, program) : null), [stored, home, program]);
  const project = view ?? stored;
  const dataAsCode = useUi(s => s.dataAsCode);
  // the listing shows the view offsets (spec 10.4); the files, the export and verify never see them
  const { analysis, error, busy, deepBusy } = useAnalysis(project, { dataAsCode, viewOffsets: true });
  const [toolchain, setToolchain] = useState<ToolchainSettings>(() => pickToolchain(project.settings));
  useEffect(() => { if (kr) kr.getSettings().then(setToolchain).catch(() => { /* keep project defaults */ }); }, []);

  if (!analysis) return <div className="boot">{error ? `Analysis failed: ${error}` : 'Analysing…'}</div>;
  return <Workspace A={analysis.A} R={analysis.R} aKey={analysis.aKey} renderMs={analysis.renderMs} rProject={analysis.project} final={analysis.final} swaps={analysis.swaps} busy={busy} deepBusy={deepBusy} toolchain={toolchain} setToolchain={setToolchain} note={note} onStartScreen={onStartScreen} asmProject={view} />;
}

interface WorkspaceProps {
  A: AnalysisResult; R: RenderResult; aKey: number; renderMs: number; /** the project A and R were computed for */ rProject: Project;
  /** A is the analysis the settings ask for (not the normal one standing in for the deep one), and how many times a deep
   *  one took the place of the normal one */
  final: boolean; swaps: number;
  busy: boolean; /** the deep analysis of the project is still running */ deepBusy: boolean; toolchain: ToolchainSettings; setToolchain: (t: ToolchainSettings) => void;
  note: Note | null;
  /** back to the start screen (the project's work is saved first) */
  onStartScreen: () => void;
  /** an Assembler project as its views take it (asmView); null: another project */
  asmProject: Project | null;
}

/** `p` in `to` instead of `from`, when it is in `from` */
const rebase = <T extends string | null | undefined>(p: T, from: string, to: string): T => (p && p.startsWith(from) ? `${to}${p.slice(from.length)}` as T : p);

function Workspace({ A, R, aKey, renderMs, rProject, final, swaps, busy, deepBusy, toolchain, setToolchain, note, onStartScreen, asmProject }: WorkspaceProps) {
  /** the project as it is kept (its project file), and as the views take it: an Assembler project's is the program its
   *  sources make (spec 10.7), any other the same */
  const stored = useProject(s => s.present);
  const project = asmProject ?? stored;
  /** an Assembler project: its Assembler tab, Graphics, Memory, Scripts and Git, none of the analysis, the re-assembly
   *  and the listing */
  const asmMode = !!asmProject;
  const asmBuilding = useAsmLink(s => s.building), asmMain = useAsmLink(s => s.main);
  // the memory of the program being debugged in the Assembler: Memory and Graphics show it (all of it, loaded or not)
  const asmLive = useAsmLink(s => s.live);
  const liveA = useMemo(() => (asmMode && asmLive ? { ...A, mem: asmLive.mem, owner: ALL_LOADED } : null), [asmMode, asmLive, A]);
  const liveNote = asmLive ? `${asmLive.running ? 'Running' : 'Stopped'} at $${h4(asmLive.pc)}${asmLive.where ? ` (${asmLive.where})` : ''}: the memory of the program being debugged${asmLive.whole ? ' in the whole C64 (its RAM)' : ' in Mimir\'s 6510'}, as it is now. The program as it loads comes back when debugging stops.` : null;
  // an Assembler project's C64 checks (spec 10.7): what the analysis sees that the assembler cannot, to the Assembler tab
  const asmNotes = useMemo(() => (asmMode && A.files.length ? asmC64Notes(A) : []), [asmMode, A]);
  useEffect(() => { useAsmLink.getState().set({ notes: asmNotes }); }, [asmNotes]);
  // (the analysis itself: the pictures in its editor are drawn multicolour as its VIC evidence says)
  useEffect(() => { useAsmLink.getState().set({ analysis: asmMode && A.files.length ? A : null }); }, [asmMode, A]);
  const past = useProject(s => s.past), future = useProject(s => s.future), home = useProject(s => s.home);
  const { update, replace, undo, redo, enter, setHome } = useProject.getState();
  /** analysis settings from the project, toolchain paths from the app */
  const S: Settings = useMemo(() => ({ ...A.S, ...toolchain }), [A.S, toolchain]);
  /** the assembler the project's source is written for (spec 11.8) */
  const asm = assemblerOf(S), words = asmWords(asm), codeLang = langOf(asm);
  // the newest analysis, project and settings, for work that awaits (verify, build, export) and must not use a stale
  // render: an export right after a settings change runs with the settings of the analysis it waited for
  const latest = useRef({ A, R, aKey, project, rProject, S, final });
  latest.current = { A, R, aKey, project, rProject, S, final };
  /** resolves once A and R belong to the latest edit (the store, read directly: an edit made a moment ago may not
   *  have rendered yet, so render-time flags cannot tell), and are the deep analysis when it is on, not the normal one
   *  shown meanwhile; gives up after 30 s */
  const analysisSettled = () => new Promise<void>(resolve => {
    const t0 = Date.now();
    const tick = () => { if ((latest.current.rProject === useProject.getState().present && latest.current.final) || Date.now() - t0 > 30000) resolve(); else setTimeout(tick, 25); };
    tick();
  });
  const ui = useUi();
  const { theme, tab, bottom, activity, sidePanel, panelOpen, inspector, welcome, sizes, gutter, dataAsCode, cycles, offsets, textCols, followQuicksave, gfxPictures } = ui;
  const setUi = ui.set;

  const [srcPath, setSrcPath] = useState<string | null>(null);
  const [cursor, setCursor] = useState<Addr | null>(null);
  const [sel, setSel] = useState<Sel | null>(null);
  // (an Assembler project: the pictures in its editor show what is picked, as the listing's do)
  const selStart = sel?.start ?? null, selEnd = sel?.end ?? null;
  useEffect(() => { if (asmMode) useAsmLink.getState().set({ place: { cursor, sel: selStart != null && selEnd != null ? { start: selStart, end: selEnd } : null } }); }, [asmMode, cursor, selStart, selEnd]);
  const [scrollReq, setScrollReq] = useState<ScrollReq | null>(null);
  const [heatMode, setHeatMode] = useState<HeatMode>('type');
  /** the page Settings opens at this time (the Assembler's settings button: Assembler project); none: the one it was last on */
  const [settingsPage, setSettingsPage] = useState<SettingsPage | undefined>();
  const [modal, setModal] = useState<'settings' | 'goto' | 'palette' | 'merge' | 'size' | 'patch' | 'project' | 'reloc' | 'voff' | 'overview' | 'templates' | 'library' | 'junk' | null>(null);
  /** the range Mark range as junk… starts with (11.7) */
  const [junkInit, setJunkInit] = useState<{ start: Addr; end: Addr } | null>(null);
  /** the block the Block size dialog changes (its start when the dialog opened) */
  const [sizeAt, setSizeAt] = useState<Addr | null>(null);
  /** the patch dialog's range and code */
  const [patchDraft, setPatchDraft] = useState<PatchDraft | null>(null);
  /** the Relocate dialog's block: a range, a relocated block, or a copy loop's (spec 8.1b) */
  const [relocDraft, setRelocDraft] = useState<RelocDraft | null>(null);
  /** the view offset dialog's bytes: a range, or a view offset (spec 10.4) */
  const [voffDraft, setVoffDraft] = useState<ViewOffsetDraft | null>(null);
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [labelError, setLabelError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  /** every toast of this run, for the Messages tab (the last 200) */
  const [messages, setMessages] = useState<Message[]>([]);
  const [build, setBuild] = useState<BuildState | null>(null);
  /** the build as it is now, for what runs later than the render it was started in (a script's run) */
  const buildNow = useRef<BuildState | null>(null);
  buildNow.current = build;
  const [buildBusy, setBuildBusy] = useState<string | null>(null);
  const [dropping, setDropping] = useState(false);
  const [disk, setDisk] = useState<MountedDisk | null>(null);
  const [tape, setTape] = useState<MountedTape | null>(null);
  /** the folder of the last Kick Assembler export in this session (the terminal opens there) */
  const [exportDir, setExportDir] = useState<string | null>(null);
  /** the files that export was of (their ids): it moves into a project made from the work only while they are the work's */
  const exportedFiles = useRef<string | null>(null);
  /** Sublime Text and VS Code where they are installed, and the editor the Editor button opens the export in */
  const [editors, setEditors] = useState<EditorFindResult | null>(null);
  useEffect(() => { kr?.findEditors().then(setEditors).catch(() => setEditors(null)); }, [toolchain.editorPath]);
  const filesOf = (p: Project) => p.files.map(f => f.id).join(',');
  /** the last unpack (shown above the listing with the layer report, or the external unpacker's output) */
  const [unpacked, setUnpacked] = useState<{ ok: boolean; title: string; output: string; label: string } | null>(null);
  /** the last pack, with Brokkr or Exomizer (the Pack view shows it) */
  const [packRes, setPackRes] = useState<PackResult | null>(null);
  /** the pack under way (building and verifying, then packing): the Pack view and its activity button show it */
  const [packRun, setPackRun] = useState<PackProgress | null>(null);
  // a packed file belongs to the program it was packed from: other files (a new project, an added PRG) drop it
  useEffect(() => setPackRes(null), [project.files]);
  /** files whose "packed" notice was dismissed */
  const [packHidden, setPackHidden] = useState<ReadonlySet<string>>(() => new Set());
  const [drawer, setDrawer] = useState<'side' | 'insp' | null>(null);
  const navHist = useRef<{ back: Addr[]; fwd: Addr[] }>({ back: [], fwd: [] });
  const listRef = useRef<HTMLDivElement | null>(null);
  /** the bottom panel: dragging goes on from the height it has, which is less than the one kept when it gives way */
  const bottomRef = useRef<HTMLElement | null>(null);
  const colors = useCanvasColors(theme);

  // folded blocks (by start address) show only their header; the view maps addresses to the visible lines
  const [folded, setFolded] = useState<ReadonlySet<Addr>>(() => new Set());
  // the listing's lines: the source's, with sprites, charsets and bitmaps as pictures when that is on (lib/gfxlines),
  // as many characters and sprites a row as the listing has room for (left of the picture: the gutter, the address,
  // the bytes, and the offset and cycles columns when they are on)
  const [listW, setListW] = useState(0);
  const cols = gfxColsFor(listW ? listW - (3 + 57 + 96 + 30 + (offsets ? 66 : 0) + (cycles ? 76 : 0)) : 1e9);
  const shown = useMemo(() => (gfxPictures ? gfxListing(R.lines, A, { chars: cols.chars, sprite: cols.sprite }) : null), [R, A, gfxPictures, cols.chars, cols.sprite]);
  const listLines = shown?.lines ?? R.lines;
  const view = useMemo(() => foldLines(listLines, A.blocks, folded, A.mem.length, A.relocs, shown?.nums), [listLines, shown, A, folded]);
  const excludedSet = useMemo(() => new Set(project.excluded), [project.excluded]);
  const lineOf = view.lineOf;
  /* ---- where in memory the editor is (14.6b): the listing, Graphics and Memory each say where they were scrolled to,
     and the one opened next starts there (a jump since then wins). `viewSpace`: the bank that place is in ---- */
  const viewAt = useRef<ViewAt | null>(null);
  const [viewSpace, setViewSpace] = useState<number | null>(null);
  const seeAt = (v: ViewAt, shows: Addr = v.addr) => { viewAt.current = v; const s = spaceOf(shows); setViewSpace(x => (x === s ? x : s)); };
  /** a file just opened from a loader's script or the tape: Graphics shows its first byte in the top row, now when the
   *  tab is open, else when it opens; once it has, the tab says where it is, as when it is scrolled */
  // where Graphics goes to: the start of a file just opened from a loader (`id`), or a block shown from the Blocks view
  // (`addr`); where Memory goes to: a block shown from the Blocks view
  const [gfxGo, setGfxGo] = useState<{ id: string; n: number } | { addr: Addr; n: number } | null>(null);
  const [memGo, setMemGo] = useState<{ addr: Addr; n: number } | null>(null);
  /* ---- a cartridge's banks are spaces of their own (13.9b): the listing shows them all, one after the other, at bank
     addresses (space * $10000 + address); the 64 KB views (Graphics, Memory, the heatmap) show the bank of the cursor,
     and Graphics and Memory the bank the editor is in ---- */
  const space = (tab === 'gfx' || tab === 'mem') && viewSpace != null && A.spaces?.some(s => s.space === viewSpace) ? viewSpace : spaceOf(cursor ?? A.entry ?? 0);
  const base = space * SPACE;
  const As = useMemo(() => spaceView(A, space), [A, space]);
  const Rs = useMemo(() => spaceRender(R, A, space), [R, A, space]);
  const vCursor = cursor != null && spaceOf(cursor) === space ? cursor - base : null;
  const vSel = useMemo((): Sel | null => (!sel || !base ? sel : spaceOf(sel.start) !== space ? null
    : { ...sel, start: sel.start - base, end: sel.end - base, ...(sel.anchor != null ? { anchor: sel.anchor - base } : {}), ...(sel.anchorEnd != null ? { anchorEnd: sel.anchorEnd - base } : {}) }), [sel, base, space]);
  /** an address of a 64 KB view in the bank it shows */
  const inBank = (a: Addr): Addr => base + a;
  /** an address typed or picked without a bank: in the cursor's bank when it has it, else in the first bank that has it */
  const resolveAddr = (a: Addr, bank: number | null = null): Addr => {
    if (!A.spaces || a >= SPACE) return a;
    if (bank != null) { const s = A.spaces.find(x => x.bank === bank); return s ? s.space * SPACE + a : a; }
    if (A.owner[base + a] >= 0) return base + a;
    const s = A.spaces.find(x => A.owner[x.space * SPACE + a] >= 0);
    return s ? s.space * SPACE + a : a;
  };
  /** the cartridge bank an address is in (null without banks) */
  const bankAt = (a: Addr | null): number | null => (a == null ? null : A.spaces?.find(x => x.space === spaceOf(a))?.bank ?? null);
  /** the offset column (as in SourceGen): where the byte at an address is in the file it was opened from (a PRG after
   *  its load address, a chip in its .crt, a snapshot's RAM in its .vsf) */
  const offsetBases = useMemo(() => fileOffsetBases(project), [project.files, project.cart]); // eslint-disable-line react-hooks/exhaustive-deps
  const offsetAt = useCallback((a: Addr) => {
    const fi = A.owner[a], f = fi >= 0 ? A.files[fi] : undefined, b = fi >= 0 ? offsetBases[fi] : null;
    if (!f || b == null) return null;
    // a relocated block's bytes are where it is loaded (8.1b)
    return { n: b + spaceAddr(loadAddress(A, a)) - f.load, file: f.chip != null && project.cart ? project.cart.name : f.vsf ? f.name.replace(/\.prg$/i, '.vsf') : f.name };
  }, [A, offsetBases, project.cart]);
  /** where file `i` starts, in its bank */
  const fileAddr = (i: number): Addr => (A.spaces?.find(x => x.files.includes(i))?.space ?? 0) * SPACE + (project.files[i]?.load ?? 0);
  /** where VICE's CPU was when it saved the snapshot the analysis is of (spec 13.7): a snapshot opens there */
  const snapPc = useMemo(() => snapshotPc(A.files, A.owner), [A.files, A.owner]);
  // a new analysis with nowhere to be: the listing and the .asm go to the program start, a snapshot's to its PC (in
  // the bytes opened, else the start). Only an analysis of the project shown: the file opened before can still have
  // its result on the way when the next one opens (it renders with the next one's empty cursor), and its start is
  // nowhere in the new one, where the cursor then stayed
  useEffect(() => {
    if (rProject !== project) return;
    const at = snapPc?.loaded ? snapPc.pc : A.entry;
    if (cursor == null && at != null) { setCursor(at); setScrollReq({ addr: at, center: true, n: Date.now() }); }
  }, [A]); // eslint-disable-line react-hooks/exhaustive-deps

  /** a notice in the corner, kept in the Messages tab: an error stays until it is dismissed (or four newer ones push it
   *  out), the others go after 4.2 s, a long one after up to 9 s, so there is time to read it */
  const toast = useCallback((msg: string, kind: ToastKind = 'info') => {
    const id = uid();
    setToasts(t => [...t.slice(-3), { id, msg, kind }]);
    setMessages(m => [...m.slice(-199), { id, msg, kind, at: Date.now() }]);
    if (kind !== 'err') setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), Math.min(9000, Math.max(4200, msg.length * 40)));
  }, []);
  const dismissToast = (id: string) => setToasts(t => t.filter(x => x.id !== id));
  const needDesktop = () => { toast('This needs the desktop app (file system and toolchain access go through the Electron main process).', 'warn'); };
  const noted = useRef(0);
  useEffect(() => { if (note && note.n !== noted.current) { noted.current = note.n; toast(note.text, 'ok'); } }, [note, toast]);

  /* ---- a project's work is saved to its project file as it changes (the work without a project: the store keeps it) ---- */
  const pending = useRef<{ timer?: ReturnType<typeof setTimeout>; project?: Project; home?: ProjectHome }>({});
  /** the change waiting to be saved, saved now; when it could not be, the project and why (it waits to be saved again:
   *  with the next change, or when the window closes) */
  const saveNow = useCallback(async (): Promise<{ home: ProjectHome; error: string } | null> => {
    const w = pending.current;
    clearTimeout(w.timer);
    pending.current = {};
    if (!kr || !w.project || !w.home) return null;
    try { await kr.saveProject({ project: w.project, path: w.home.file }); return null; } catch (e) {
      if (!pending.current.project) pending.current = { project: w.project, home: w.home };
      toast(`The project was not saved: ${errorText(e)}`, 'err');
      return { home: w.home, error: errorText(e) };
    }
  }, [toast]);
  const seen = useRef({ project: stored, home });
  useEffect(() => {
    // an edit in the same project (not the project opened, nor the work just moved into one: that is on disk)
    const was = seen.current;
    seen.current = { project: stored, home };
    if (!home || was.home !== home || was.project === stored) return;
    clearTimeout(pending.current.timer);
    pending.current = { project: stored, home, timer: setTimeout(() => void saveNow(), 500) };
  }, [stored, home, saveNow]);
  useEffect(() => {
    const flush = () => void saveNow();
    window.addEventListener('beforeunload', flush);
    return () => { window.removeEventListener('beforeunload', flush); flush(); };
  }, [saveNow]);
  /** the work goes on without a project, at once: the project's last change is saved (the change waiting is taken as it
   *  is), and the project stays as it was. Returns the project left */
  const leaveProject = (): ProjectHome | null => {
    if (!home) return null;
    void saveNow();
    setHome(null);
    setExportDir(null);
    void kr?.workUnsaved();
    return home;
  };
  /** the project's work saved, and the work without a project kept: the start screen offers it as it is now */
  const toStartScreen = async () => { await useAsmLink.getState().flush().catch(() => null); await saveNow(); keepUnsavedWork(); onStartScreen(); };

  /* ---- work without a project, with changes that are in no project, asks before something takes its place: Save makes
     a project of it first ---- */
  const unsavedChanges = useProject(s => !s.home && workChanged(s));
  type Ask = { what: string; kept: Project | null; go: () => void };
  /** what waits for the answer; `kept`: the work without a project the window keeps (a project is open), else the work open */
  const [unsavedAsk, setUnsavedAsk] = useState<Ask | null>(null);
  /** "Save as a project…": the work made a project, then `go` */
  const [saveFirst, setSaveFirst] = useState<Ask | null>(null);
  /** what goes on once the work is a project: after the render that has the project */
  const [afterSave, setAfterSave] = useState<{ go: () => void } | null>(null);
  useEffect(() => { if (afterSave) { setAfterSave(null); afterSave.go(); } }, [afterSave]);
  /**
   * True when `what` would take the place of work without a project that has changes in no project: it asks first, and
   * `go` runs once the work is saved as a project, or is not to be. `leaves`: in a project, `what` leaves it and becomes
   * the work without a project, in place of the one the window keeps.
   */
  const askFirst = (what: string, leaves: boolean, go: () => void): boolean => {
    if (!kr) return false;
    const kept = home && leaves ? unsavedWork() : null;
    if (home ? !kept || !unsavedWorkChanged() : !workChanged(useProject.getState())) return false;
    setUnsavedAsk({ what, kept, go });
    return true;
  };
  /* ---- Mimir is to close (the window's X, Alt+F4, File → Exit): the project's last change is saved first; work without
     a project with changes in no project asks whether to save it as a project, and a project that could not be saved
     asks before its changes go ---- */
  type CloseAsk = { kind: 'unsaved' } | { kind: 'save' } | { kind: 'failed'; home: ProjectHome; error: string };
  const [closeAsk, setCloseAsk] = useState<CloseAsk | null>(null);
  const closeAskNow = useRef(closeAsk);
  closeAskNow.current = closeAsk;
  const tryClose = useCallback(async () => {
    holdClose();
    // (an Assembler project's files not written yet are first)
    await useAsmLink.getState().flush().catch(() => null);
    const failed = await saveNow();
    if (failed) { setCloseAsk({ kind: 'failed', ...failed }); return; }
    const s = useProject.getState();
    if (!s.home && workChanged(s)) { setCloseAsk({ kind: 'unsaved' }); return; }
    keepUnsavedWork();
    closeWindow();
  }, [saveNow]);
  // asked again while a question is open: it stays open
  useEffect(() => whenClosing(() => { if (closeAskNow.current) holdClose(); else void tryClose(); }), [tryClose]);
  /** closed without saving: work without a project is kept for the next start as before, a project's last change goes.
   *  `declined`: the work without a project's changes were asked about ("Close without saving"), so the next start
   *  does not ask about them again */
  const closeUnsaved = (declined = false) => { pending.current = {}; if (declined) keepDeclinedWork(); else keepUnsavedWork(); setCloseAsk(null); closeWindow(); };
  /** "Save as a project…" before closing: the work made a project, then the window closes */
  const saveThenClose = async (name: string, parent: string, git: boolean) => { await createFromWork(name, parent, git); setCloseAsk(null); closeWindow(); };

  /** the work (or the one the window keeps) made a project, as "Save as a project…" asked; then what waited */
  const saveFirstAs = async (name: string, parent: string, git: boolean) => {
    const s = saveFirst;
    if (!kr || !s) return;
    if (s.kept) {
      const r = await kr.createProject({ name, parent, project: s.kept, git });
      forgetUnsavedWork();
      const g = gitNote(r);
      toast(`Created the project ${r.home.name} in ${r.home.dir}${g.text}: the work without a project is saved there`, g.bad ? 'warn' : 'ok');
    } else await createFromWork(name, parent, git);
    setSaveFirst(null);
    setAfterSave({ go: s.go });
  };

  const navigate = useCallback((addr: Addr, opts: NavOptions = {}) => {
    if (addr == null || addr < 0 || addr >= A.owner.length) return;
    if (A.owner[addr] < 0) { toast(`$${h4(addr)} is not part of any loaded file`, 'warn'); return; }
    // going to an address inside a folded block (Go to, a link, the sidebar) unfolds it, and the relocated blocks it runs in
    if (opts.center) { const b = findBlock(A.blocks, addr); unfold([...(b && addr !== b.start ? [b.start] : []), ...relocsAround(addr)]); }
    if (cursor != null && cursor !== addr && !opts.noHistory) { navHist.current.back.push(cursor); navHist.current.fwd = []; }
    setCursor(addr);
    // a jump takes Graphics and Memory to its bank
    setViewSpace(spaceOf(addr));
    if (!opts.keepSel) setSel(null);
    if (!opts.fromSource) setScrollReq({ addr, center: !!opts.center, n: Date.now(), ...(opts.end != null ? { end: opts.end } : {}) });
    // (an Assembler project has no listing: its sources are shown at the address's line)
    if (opts.listing && asmMode) { if (useUi.getState().tab !== 'asm') setUi({ tab: 'asm' }); useAsmLink.getState().showAddr(addr); }
    else if (opts.listing && useUi.getState().tab !== 'listing') setUi({ tab: 'listing' });
  }, [A, cursor, toast, setUi, folded, asmMode]);
  const goBack = () => { const b = navHist.current.back.pop(); if (b != null && cursor != null) { navHist.current.fwd.push(cursor); navigate(b, { noHistory: true }); } };
  const goFwd = () => { const f = navHist.current.fwd.pop(); if (f != null && cursor != null) { navHist.current.back.push(cursor); navigate(f, { noHistory: true }); } };
  /** the relocated blocks the bytes at `a` run in, the innermost first (where each one is loaded) */
  const relocsAround = (a: Addr): Addr[] => { const out: Addr[] = []; for (let r = relocAt(A, a); r && out.length < 64; r = relocAt(A, r.start)) out.push(r.start); return out; };
  const unfold = (starts: Addr[]) => { const shut = starts.filter(s => folded.has(s)); if (shut.length) setFolded(f => { const n = new Set(f); for (const s of shut) n.delete(s); return n; }); };
  const resetView = () => { setCursor(null); setBuild(null); setSel(null); setFolded(new Set()); navHist.current = { back: [], fwd: [] }; viewAt.current = null; setViewSpace(null); setGfxGo(null); setMemGo(null); };
  /** fold or unfold the block that starts at (or contains) `a` */
  const toggleFold = (a: Addr) => { const b = findBlock(A.blocks, a); if (!b) return; setFolded(f => { const n = new Set(f); if (n.has(b.start)) n.delete(b.start); else n.add(b.start); return n; }); if (cursor != null && cursor > b.start && cursor < b.end) setCursor(b.start); };
  // a relocated block holds code too: it is no block of data to fold
  const foldAll = (which: 'data' | 'all' | 'none') => setFolded(which === 'none' ? new Set() : new Set(A.blocks.filter(b => which === 'all' || (b.type !== 'code' && b.type !== 'reloc')).map(b => b.start)));

  /* ---- find in the listing (Ctrl+F): every line with a match is marked, Enter and F3 go from one to the next ---- */
  const [findOpen, setFindOpen] = useState(false);
  const [findQ, setFindQ] = useState('');
  const [findOpts, setFindOpts] = useState<FindOptions>({ matchCase: false, word: false });
  /** the hit shown: its index in the listing's lines (folded blocks too) */
  const [findCur, setFindCur] = useState<number | null>(null);
  const [findFocus, setFindFocus] = useState(0);
  /** Ctrl+F in the source tab: Monaco's own find */
  const [srcFind, setSrcFind] = useState(0);
  const findTexts = useMemo(() => (findOpen ? listLines.map(l => findText(l, asm)) : null), [listLines, findOpen, asm]);
  const findRe = useMemo(() => (findOpen ? findRegExp(findQ, findOpts) : null), [findOpen, findQ, findOpts]);
  const findHits = useMemo(() => (findTexts ? findLines(findTexts, findRe) : []), [findTexts, findRe]);
  /** the hit shown, as an index into the hits (-1: none) */
  const findAt = useMemo(() => { if (findCur == null) return -1; const k = nextHit(findHits, findCur, 1, true); return findHits[k] === findCur ? k : -1; }, [findHits, findCur]);
  const listingFind = useMemo((): ListingFind | null => (findRe && findHits.length ? { re: findRe, hits: new Set(findHits.map(i => listLines[i])), cur: findAt >= 0 ? listLines[findHits[findAt]] : null } : null), [findRe, findHits, findAt, listLines]);
  /** where find put the cursor last: once it is moved elsewhere (a click), the next step goes from the cursor */
  const findAddr = useRef<Addr | null>(null);
  /** the cursor before the first step goes into the navigation history once a find (Esc then goes back to it) */
  const findBack = useRef(false);
  /** the cursor's line, as an index into the listing's lines */
  const cursorLineIdx = () => { const v = cursor != null ? lineOf[cursor] : -1; return v >= 0 ? Math.max(0, listLines.indexOf(view.lines[v])) : 0; };
  const showHit = (i: number) => {
    const l = listLines[i]; if (!l) return;
    // a hit inside a folded block unfolds it, and the relocated blocks it runs in
    if (l.k !== 'hdr') for (let j = i - 1; j >= 0; j--) {
      const h = listLines[j];
      if (h.k === 'file') break;
      if (h.k === 'hdr') { const b = A.blocks[h.blk]; if (b && folded.has(b.start)) setFolded(f => { const n = new Set(f); n.delete(b.start); return n; }); break; }
    }
    if (l.k !== 'file') unfold(relocsAround(l.a));
    // the cursor goes to the line's address, unless the line is in a file's head (whose lines share one address)
    const at = l.k !== 'file' && l.k !== 'blank' && !('head' in l && l.head) && A.owner[l.a] >= 0 ? l.a : null;
    if (at != null && at !== cursor) {
      if (!findBack.current && cursor != null) { navHist.current.back.push(cursor); navHist.current.fwd = []; findBack.current = true; }
      setCursor(at); setSel(null);
    }
    findAddr.current = at ?? cursor;
    setFindCur(i);
    setScrollReq({ addr: l.a, center: false, n: Date.now(), line: l });
  };
  const stepFind = (dir: 1 | -1) => {
    if (!findHits.length) return;
    // from the hit shown, or from the cursor's line once the cursor was moved elsewhere
    const k = findCur != null && cursor === findAddr.current ? nextHit(findHits, findCur, dir) : nextHit(findHits, cursorLineIdx(), dir, true);
    showHit(findHits[k]);
  };
  // typing shows the first hit from the one shown (or the cursor's line) on; without hits the one shown stays where
  // the next search starts
  useEffect(() => {
    if (!findOpen || !findHits.length) return;
    showHit(findHits[nextHit(findHits, findCur != null && cursor === findAddr.current ? findCur : cursorLineIdx(), 1, true)]);
  }, [findQ, findOpts]); // eslint-disable-line react-hooks/exhaustive-deps
  const openFind = () => {
    if (!findOpen) findBack.current = false;
    setFindOpen(true); setFindFocus(n => n + 1);
    if (useUi.getState().tab !== 'listing') setUi({ tab: 'listing' });
  };
  const closeFind = () => { setFindOpen(false); listRef.current?.focus(); };

  /* ---- Ctrl+↓ / Ctrl+↑: the next block, or the start of the cursor's block and then the one before; the block's
     header goes to the top of the listing. Folded blocks stay folded: the cursor stops on their header ---- */
  /** the block headers, as indices into the listing's lines */
  const hdrLines = useMemo(() => listLines.flatMap((l, i) => (l.k === 'hdr' ? [i] : [])), [listLines]);
  /** where the last jump put the cursor: a run of jumps goes into the navigation history once (Esc goes back) */
  const blockAddr = useRef<Addr | null>(null);
  const jumpBlock = (dir: 1 | -1) => {
    if (useUi.getState().tab !== 'listing') setUi({ tab: 'listing' });
    const from = cursor != null ? cursorLineIdx() : -1;
    const l = listLines[blockStep(hdrLines, from, dir, cursor != null && findBlock(A.blocks, cursor)?.start === cursor)];
    if (!l) return;
    if (cursor != null && cursor !== l.a && cursor !== blockAddr.current) { navHist.current.back.push(cursor); navHist.current.fwd = []; }
    blockAddr.current = l.a;
    setCursor(l.a); setSel(null);
    setScrollReq({ addr: l.a, center: false, n: Date.now(), line: l, top: true });
  };

  /* ---- files ---- */
  /** PRGs, and VICE snapshots as their RAM from $0200: the PC and interrupt handlers they hold become entry points */
  /** `undoLabel`: the new project is an undoable step (Ctrl+Z brings the one before back); `note`: the toast instead;
   *  `what`: what "The work is not saved" calls it (the files' names), `asked`: that was answered;
   *  `show`: the Explorer shows what was opened (the File menu's choices), the cartridge or the files;
   *  `gfx`: a file from a loader's script or the tape, whose start Graphics shows (14.6b) */
  const addFiles = (opened: OpenedPrg[], add: boolean, opts: { undoLabel?: string; note?: string; what?: string; asked?: boolean; show?: boolean; gfx?: boolean } = {}) => {
    if (!opened.length) return;
    // an Assembler project's program is what its sources make: nothing is loaded into it (spec 10.7)
    if (asmMode) { toast(`${opened.map(f => f.name).slice(0, 3).join(', ')} ${opened.length === 1 ? 'was' : 'were'} not opened: an Assembler project's program is what its sources make. Open ${opened.length === 1 ? 'it' : 'them'} in another project (Close the project, then Without a project or a project of its own)`, 'warn'); return; }
    // a cartridge's chips open as a project of their own, with the image (13.9): a project holds one cartridge
    const cart = opened.find(f => f.cart)?.cart;
    const ownCart = !!cart && !(add && project.cart && project.cart.name === cart.name && project.cart.crt.length === cart.crt.length);
    if ((ownCart || !add) && !opts.asked
      && askFirst(opts.what ?? (cart && ownCart ? cart.name : opened.map(f => f.name).join(', ')), !!home && project.files.length > 0, () => later.current.addFiles(opened, add, { ...opts, asked: true }))) return;
    // files that take the place of a project's are work without a project: the project stays as it was saved (an empty
    // project, just made, takes them)
    const left = (ownCart || !add) && home && project.files.length ? leaveProject() : null;
    const undoLabel = left ? undefined : opts.undoLabel ?? (home ? `Open ${cart && ownCart ? cart.name : opened.map(f => f.name).join(', ')}` : undefined);
    const leftNote = left ? `; without a project (${left.name} is saved as it was; Save makes a project of this)` : '';
    const note = opts.note && `${opts.note}${left ? leftNote : opts.undoLabel ? '. Ctrl+Z goes back to the project before' : ''}`;
    if (cart && ownCart) {
      const files: LoadedFile[] = opened.map(({ id, name, load, bytes, chip, cart: c }) => ({ id, name, load, bytes, ...(c === cart && chip != null ? { chip } : {}) }));
      replace(createProject({ files, settings: newProjectSettings(project.settings), cart }), undoLabel); resetView();
      // however it was opened, the Explorer shows the cartridge's banks
      showSection('cart');
      afterLoad(files.map(f => f.id), false);
      let what = '';
      try { what = `: ${describeCrt(parseCrt(cart.crt, cart.name))}`; } catch { /* the files say enough */ }
      const chips = files.filter(f => f.chip != null);
      toast(`Opened the cartridge ${cart.name}${what}; ${chips.length > 4 ? `${chips.length} chips, every bank in the listing` : chips.map(f => `${f.name} at $${h4(f.load)}`).join(', ')}${add ? ' (a project holds one cartridge, so it is a project of its own)' : ''}${leftNote}`, 'ok');
      return;
    }
    // a snapshot is kept with its file: Build & Run restarts it as it was
    const files: LoadedFile[] = opened.map(({ id, name, load, bytes, vsf, chip }) => ({ id, name, load, bytes, ...(vsf ? { vsf } : {}), ...(cart && chip != null ? { chip } : {}) }));
    const entries = [...new Set(opened.flatMap(f => f.entries ?? []))];
    // a snapshot's BASIC SYS is the program start: its RAM from $0200 cannot be started with RUN
    const start = add ? undefined : opened.find(f => f.start != null)?.start;
    if (add) update(opts.undoLabel ?? `Add ${files.map(f => f.name).join(', ')}`, d => { d.files.push(...files); for (const e of entries) if (!d.entries.includes(e)) d.entries.push(e); });
    // an empty project's nothing comes back with Ctrl+Z
    else { replace({ ...createProject({ name: projectNameFor(files[0].name), files, settings: newProjectSettings(project.settings) }), entries, entryPoint: start ?? null }, undoLabel); resetView(); }
    if (opts.gfx) setGfxGo({ id: files[0].id, n: Date.now() });
    if (opts.show) setUi({ activity: 'explorer', sidePanel: true });
    afterLoad(files.map(f => f.id), add);
    if (note) { toast(note, 'ok'); return; }
    toast(`Loaded ${opened.map(f => `${f.name} at $${h4(f.load)}${f.snapshot ? ` from a ${f.snapshot}${f.entries?.length ? `; traced from ${f.entries.map(e => `$${h4(e)}`).join(', ')}` : ''}${f.start != null && !add ? `; program start $${h4(f.start)}` : ''}` : ''}`).join(', ')}${leftNote}`, 'ok');
  };
  /** `kind`: the File menu's choice (or the Explorer's Add PRG file…), what the dialog asks for; what it opens is shown
   *  in the Explorer */
  const openPrgs = async (add: boolean, kind?: PrgOpenKind) => {
    if (!kr) return needDesktop();
    try { addFiles(await kr.openPrg({ zeroPage: !!project.settings.snapshotZeroPage, ...(kind ? { kind } : {}) }), add, { show: !!kind }); } catch (e) { toast(errorText(e), 'err'); }
  };
  /** the Explorer shown, with its section `id` open (the others as they were) */
  const showSection = (id: string) => {
    const open = useUi.getState().sideOpen;
    setUi({ activity: 'explorer', sidePanel: true, ...(open.includes(id) ? {} : { sideOpen: [...open, id] }) });
  };
  /** the files just loaded, by their ids, and whether they were added to a project; a newer load takes its place */
  const loaded = useRef<{ ids: string[]; add: boolean; n: number } | null>(null);
  /** files loaded while *Unpack packed files when they are opened* is on (Settings → General): each is unpacked once
   *  its unpacker says it is packed (see `unpackFile`), or left as it is */
  const toUnpack = useRef(new Set<string>());
  /** the files the scripts that run after a load wait for, whether they were added to a project, and when they were loaded */
  const scriptsFor = useRef<{ ids: string[]; add: boolean; n: number } | null>(null);
  /** the files the overview of the analysis waits for (Settings → General), and when they were loaded */
  const overviewFor = useRef<{ ids: string[]; n: number } | null>(null);
  /** after a load (14.1): the Explorer's Files section folds up at once; once the analysis is of the files loaded,
   *  Loaders opens when they hold a loader and Program start when the start is known. The other sections stay as they
   *  are, and the Explorer is shown only where the load shows it. Unpack's result is a load too (`unpacked`: it is not
   *  unpacked again) */
  const afterLoad = (ids: string[], add: boolean, unpacked = false) => {
    const open = useUi.getState().sideOpen;
    if (open.includes('files')) setUi({ sideOpen: open.filter(x => x !== 'files') });
    loaded.current = { ids, add, n: Date.now() };
    if (!unpacked && useUi.getState().autoUnpack) for (const id of ids) toUnpack.current.add(id);
    // the overview of the analysis opens once it is in (14.1b); an unpack's result takes the place of the packed file's
    overviewFor.current = useUi.getState().overview ? { ids, n: Date.now() } : null;
    // the scripts that run after a load (10.3) run once its analysis is in, and the unpack it waits for is done
    scriptsFor.current = { ids, add, n: Date.now() };
  };
  useEffect(() => {
    const l = loaded.current;
    // the analysis of the project the files went into, not the one before
    if (!l || rProject !== project) return;
    loaded.current = null;
    if (Date.now() - l.n > 60000) return;
    const mine = new Set(l.ids.map(id => project.files.findIndex(f => f.id === id)).filter(i => i >= 0));
    if (!mine.size) return;
    // files added to a project: only what is in them counts, not the project's other files
    const ours = (a: Addr) => !l.add || mine.has(A.owner[a]);
    const loader = A.loaders.some(x => !l.add || x.parts.some(p => !p.outside && ours(p.start)));
    // known: set (by you or by a snapshot's BASIC SYS), a BASIC SYS, a cartridge's vectors; not the load address taken
    // for want of one
    const e = A.entry;
    const start = e != null && ours(e) && (e !== A.files[0]?.load || project.entryPoint === e || A.basics.some(b => b.sys === e));
    const show = [loader && 'loaders', start && 'start'].filter((x): x is string => !!x);
    const now = useUi.getState().sideOpen;
    if (show.some(x => !now.includes(x))) setUi({ sideOpen: [...new Set([...now, ...show])] });
    // a snapshot added to a project: the listing and the .asm go to its PC (a new project's start there by itself)
    const snap = l.add ? snapshotPc(A.files.filter((_, i) => mine.has(i)), A.owner) : null;
    if (snap?.loaded) navigate(snap.pc, { center: true });
  }, [A, rProject, project, setUi, navigate]);
  /* ---- VICE's quicksave snapshot: Alt+F11 in VICE writes it, F9 here opens it, and each new one opens by itself ---- */
  const openQuicksave = async () => {
    if (!kr) return needDesktop();
    try {
      const r = await kr.openQuicksave({ zeroPage: !!project.settings.snapshotZeroPage });
      if (!r.found) { toast(`No VICE quicksave yet: in VICE, Snapshot → Quicksave snapshot (Alt+F11) writes ${r.path}`, 'warn'); return; }
      const f = r.files[0], at = new Date(r.saved).toLocaleTimeString();
      const traced = f.entries?.length ? `, traced from ${f.entries.map(e => `$${h4(e)}`).join(', ')}` : '';
      addFiles(r.files, false, { undoLabel: 'Open the VICE quicksave', note: `Opened the VICE quicksave from ${at}: ${f.snapshot ?? f.name}${traced}`, what: 'the VICE quicksave' });
    } catch (e) { toast(`VICE quicksave: ${errorText(e)}`, 'err'); }
  };
  /** what the Explorer says about it: the newest quicksave and when it was saved, or where VICE will write one */
  const [qsInfo, setQsInfo] = useState<QuicksaveInfo | null>(null);
  /** the newest quicksaves the app keeps, with the names given them */
  const [qsList, setQsList] = useState<QuicksaveEntry[]>([]);
  const refreshQuicksave = useCallback(() => {
    kr?.quicksaveInfo().then(setQsInfo, () => setQsInfo(null));
    kr?.quicksaves().then(setQsList, () => setQsList([]));
  }, []);
  /** a kept quicksave opened as a new project, like the latest one with F9 */
  const openKeptQuicksave = async (q: QuicksaveEntry) => {
    if (!kr) return needDesktop();
    try {
      const r = await kr.openQuicksaveEntry({ id: q.id, zeroPage: !!project.settings.snapshotZeroPage });
      if (!r.found) return;
      const f = r.files[0];
      const traced = f.entries?.length ? `, traced from ${f.entries.map(e => `$${h4(e)}`).join(', ')}` : '';
      addFiles(r.files, false, { undoLabel: `Open the quicksave "${q.name}"`, note: `Opened the quicksave "${q.name}": ${f.snapshot ?? f.name}${traced}`, what: `the quicksave "${q.name}"` });
    } catch (e) { toast(`VICE quicksave: ${errorText(e)}`, 'err'); refreshQuicksave(); }
  };
  const renameKeptQuicksave = async (q: QuicksaveEntry, name: string) => {
    if (!kr || !name.trim() || name.trim() === q.name) return;
    try { setQsList(await kr.renameQuicksave({ id: q.id, name: name.trim() })); } catch (e) { toast(errorText(e), 'err'); }
  };
  const saveKeptQuicksave = async (q: QuicksaveEntry) => {
    if (!kr) return needDesktop();
    try { const r = await kr.saveQuicksave({ id: q.id }); if (r) toast(`The quicksave "${q.name}" saved to ${r.path}`, 'ok'); } catch (e) { toast(`Save failed: ${errorText(e)}`, 'err'); }
  };
  /** a favourite stays when VICE saves new quicksaves; one no more goes like the others */
  const favouriteKeptQuicksave = async (q: QuicksaveEntry, on: boolean) => {
    if (!kr) return;
    try {
      setQsList(await kr.favouriteQuicksave({ id: q.id, on }));
      toast(on ? `"${q.name}" is a favourite: it stays when VICE saves new quicksaves` : `"${q.name}" is no favourite now: it goes when VICE saves a new quicksave, unless it is among the newest 5`, 'ok');
    } catch (e) { toast(errorText(e), 'err'); refreshQuicksave(); }
  };
  useEffect(refreshQuicksave, [refreshQuicksave, toolchain.viceQuicksave]);
  // the main process watches the quicksave file: a new one opens (or is announced) without a click
  const quicksaveRef = useRef(openQuicksave);
  quicksaveRef.current = openQuicksave;
  useEffect(() => kr?.onQuicksave(() => {
    refreshQuicksave();
    if (useUi.getState().followQuicksave) void quicksaveRef.current();
    else toast('VICE saved a new quicksave: F9 opens it', 'info');
  }), [toast, refreshQuicksave]);
  /* ---- the mounted .d64 or .g64 ---- */
  /** a .d81 that was mounted: kept for JavaScript scripts (`disks.mounted`), until a disk is mounted or ejected */
  const [scriptD81, setScriptD81] = useState<{ name: string; bytes: Uint8Array } | null>(null);
  const scriptD81Ref = useRef(scriptD81);
  scriptD81Ref.current = scriptD81;
  /** a disk mounted takes the tape out of the datasette, and a tape put in takes the disk out (the one loaded last is
   *  the one worked on, and Build & Run gives VICE no medium left from before); both stay when they come together
   *  (`keepOther`: Smart attach or a drop with both) */
  const mountBytes = (name: string, path: string | null, bytes: Uint8Array, sides: DiskSide[] = [], keepOther = false) => {
    // a 1581 disk is for scripts (disks.mounted): Mimir's own disk is a 1541's, and stays as it is
    if (diskKindOf(bytes) === 'd81') {
      const d = new DiskEdit(bytes);
      setScriptD81({ name, bytes });
      toast(`${name}: "${d.name}", a D81 with ${d.files.length} file${d.files.length === 1 ? '' : 's'}, kept for scripts: disks.mounted in a JavaScript script is this disk${disk ? ` (${disk.name} stays mounted)` : ''}. Mimir's own disk, with its files and loaders, is a D64 or a G64`, 'ok');
      return;
    }
    setScriptD81(null);
    const img = parseD64(bytes);
    let pirateslayer: PirateSlayerDisk | null = null;
    try { pirateslayer = readPirateSlayerDisk(bytes); } catch { /* not one */ }
    let paraprotect: ParaProtectDisk | null = null;
    try { paraprotect = readParaProtectDisk(bytes); } catch { /* not one */ }
    let diskspeed: DiskSpeedDisk | null = null;
    try { diskspeed = readDiskSpeedDisk(bytes); } catch { /* not one */ }
    let spindle: SpindleDisk | null = null;
    try { spindle = readSpindleDisk(bytes); } catch { /* not one */ }
    let bitfire: BitfireDisk | null = null;
    try { if (!spindle) bitfire = readBitfireDisk(bytes); } catch { /* not one */ }
    let booze: BoozeDisk | null = null;
    try { if (!spindle && !bitfire) booze = readBoozeDisk(bytes); } catch { /* not one */ }
    let sparkle: SparkleDisk | null = null;
    try { if (!spindle && !bitfire && !booze) sparkle = readSparkleDisk(bytes); } catch { /* not one */ }
    let krill: KrillDisk | null = null;
    try { if (!spindle && !bitfire && !booze && !sparkle) krill = readKrillDisk(bytes); } catch { /* not one */ }
    let covert: CovertDisk | null = null;
    try { if (!spindle && !bitfire && !booze && !sparkle && !krill) covert = readCovertDisk(bytes); } catch { /* not one */ }
    let dloc: DlocDisk | null = null;
    try { if (!spindle && !bitfire && !booze && !sparkle && !krill && !covert) dloc = readDlocDisk(bytes); } catch { /* not one */ }
    // an IFFL file is beside whatever else the disk is: one file holding the parts a game loads
    let iffl: IfflDisk | null = null;
    try { iffl = readIfflDisk(bytes); } catch { /* none */ }
    setDisk({ name, path, bytes, img, spindle, bitfire, booze, sparkle, krill, covert, dloc, iffl, pirateslayer, paraprotect, diskspeed, sides });
    const out = !keepOther && tape ? `; ejected ${tape.name}` : '';
    if (!keepOther) setTape(null);
    showSection('disk');
    const kind = spindle ? `, a Spindle 3 disk with ${spindle.jobs.length} job${spindle.jobs.length === 1 ? '' : 's'}`
      : bitfire ? `, a Bitfire disk with ${bitfire.files.length} file${bitfire.files.length === 1 ? '' : 's'} of its own`
      : booze ? `, a BoozeLoader disk with ${booze.files.length} file${booze.files.length === 1 ? '' : 's'} of its own`
      : sparkle ? `, a Sparkle disk with ${sparkle.bundles.length} bundle${sparkle.bundles.length === 1 ? '' : 's'} of files${sparkle.side != null ? ` (side ${sparkle.side})` : ''}`
      : krill ? `, a disk for Krill's loader with ${krill.files.filter(f => f.unpacked).length} files packed with ${krillPackerName(krill)}${krill.by === 'ts' ? `, loaded by track and sector${krill.files.some(f => f.entry < 0) ? ` (${krill.files.filter(f => f.entry < 0).length} not in the directory)` : ''}` : ''}`
      : covert ? `, a disk for the Covert Bitops loader (${covertSummary(covert)})`
      : dloc ? `, a disk for DLoC's loader (${dlocSummary(dloc)})`
      : pirateslayer ? `; ${pirateslayer.summary}`
      : paraprotect ? `; ${paraprotect.summary} (the Para-Protect tab)`
      : diskspeed ? `; ${diskspeed.summary} (the Disk-Speed tab)` : '';
    const ifflText = iffl ? `; ${iffl.files.map(f => `"${f.name}"`).join(', ')} ${iffl.files.length === 1 ? 'is an IFFL file' : 'are IFFL files'} with ${iffl.files.reduce((a, f) => a + f.parts.length, 0)} parts (the IFFL parts tab)` : '';
    const then = sides.length ? `; then ${sides.map(s => s.name).join(', ')}, which Sindri turns to when the program asks` : '';
    toast(`Mounted ${name}: "${img.name}"${img.format === 'G64' ? ' (G64)' : ''}, ${img.files.length} file${img.files.length === 1 ? '' : 's'}${kind}${ifflText}${then}${out}`, 'ok');
  };
  const mountDisk = async () => {
    if (!kr) return needDesktop();
    try { const r = await kr.openDisk(); if (r) mountBytes(r.name, r.path, r.bytes, r.sides); } catch (e) { toast(errorText(e), 'err'); }
  };
  const ejectDisk = () => { if (disk) toast(`Ejected ${disk.name}`, 'info'); setDisk(null); setScriptD81(null); };
  /* ---- the tape in the datasette (13.5e) ---- */
  /** (the disk goes out, as `mountBytes` says, unless `keepOther`) */
  const insertTapeBytes = (name: string, path: string | null, bytes: Uint8Array, keepOther = false) => {
    const img = readTape(bytes);
    setTape({ name, path, bytes, img });
    const out = !keepOther && disk ? `; ejected ${disk.name}` : '';
    if (!keepOther) setDisk(null);
    showSection('tape');
    // a T64 tape archive (13.5j): its directory's files, no pulses
    if (img.t64) { toast(`Inserted ${name} (a T64${img.t64.name ? `, "${img.t64.name}"` : ''}): ${img.files.length} file${img.files.length === 1 ? '' : 's'}${out}`, 'ok'); return; }
    const LABEL: Record<TapeFile['format'], string> = { cbm: 'KERNAL', tapetool: 'TapeTool', turbotape: 'Turbo Tape', freeload: 'Freeload', usgold: 'US Gold', megasave: 'Mega-Save', novaload: 'Novaload', wildload: 'Wildload', microload: 'Microload', cyberload: 'Cyberload', firebird: 'Firebird', t64: 'T64' };
    const kinds = (Object.keys(LABEL) as TapeFile['format'][]).map(k => { const n = img.files.filter(f => f.format === k).length; return n ? `${n} ${LABEL[k]}` : ''; }).filter(Boolean).join(', ');
    toast(`Inserted ${name} (${Math.round(img.seconds)} s): ${img.files.length} file${img.files.length === 1 ? '' : 's'}${kinds ? ` (${kinds})` : ''}${img.unknown.length ? `, and turbo data of a loader Sindri runs` : ''}${out}`, 'ok');
  };
  const insertTape = async () => {
    if (!kr) return needDesktop();
    try { const r = await kr.openTape(); if (r) insertTapeBytes(r.name, r.path, r.bytes); } catch (e) { toast(errorText(e), 'err'); }
  };
  const ejectTape = () => { if (tape) toast(`Ejected ${tape.name}`, 'info'); setTape(null); };
  /** the tape each file opened from it came from, and where it stood after the file: Sindri plays it on from there.
   *  `header`: the file is a KERNAL file's header (the tape buffer), not a program Sindri runs; `boot`: the KERNAL
   *  program whose loader loads it, for a file of a turbo loader (tapeBoot: Sindri runs the tape from it when the file
   *  does not run from where it loads) */
  const tapeOf = useRef(new Map<string, { tap: Uint8Array; file: TapeFile; header: boolean; boot?: TapeFile | null }>());
  /** a file from the tape as a PRG; a KERNAL file whose header holds code opens with its header, the tape buffer at
   *  $033c, as a second file (where many tape loaders keep their code) */
  const openFromTape = (f: TapeFile, add: boolean) => {
    if (!tape || f.load == null) return;
    lastFrom.current = { kind: 'tape', f };
    try {
      const files = tapeFiles(tape, f);
      addFiles(files, add, { gfx: true });
      if (files.length > 1) toast(`${f.name}'s header holds code: it is in the project too, as ${files[1].name} at $033c-$03fb (the tape buffer)`, 'info');
    } catch (e) { toast(`"${f.name}": ${errorText(e)}`, 'err'); }
  };
  /** a file of the tape as the project takes it: a PRG, and its header (the tape buffer) when that holds code; each
   *  kept with the tape it came from */
  const tapeFiles = (t: MountedTape, f: TapeFile) => {
    const base = tapeFileName(f).replace(/\.\w+$/, '');
    const file = withId(parsePrg(`${base}.prg`, makePrg(f.load!, f.data)));
    tapeOf.current.set(file.id, { tap: t.bytes, file: f, header: false, boot: tapeBoot(t.img, f) });
    const files = [file];
    if (f.headerCode && f.header) {
      const h = withId(parsePrg(`${base}-header.prg`, makePrg(0x033c, f.header)));
      tapeOf.current.set(h.id, { tap: t.bytes, file: f, header: true });
      files.push(h);
    }
    return files;
  };
  /** every file of the tape that opens, a source each (with its header, when that holds code, in the same source) */
  const exportTapeFiles = () => {
    if (!tape) return;
    exportLoaderFiles(tape.name, tape.img.files.filter(tapeOpens).map(f => {
      const base = tapeFileName(f).replace(/\.\w+$/, '');
      return { name: base, what: `"${f.name}" of ${tape.name}`, files: () => [parsePrg(`${base}.prg`, makePrg(f.load!, f.data)), ...(f.headerCode && f.header ? [parsePrg(`${base}-header.prg`, makePrg(0x033c, f.header))] : [])] };
    }));
  };
  /** every file of the tape to a folder, as PRGs; a TapeTool tape's with boot.bin and build.bat, TapeTool's command
   *  lines that write the tape again */
  const saveTapeFiles = async () => {
    if (!kr) return needDesktop();
    if (!tape) return;
    const files: Record<string, Uint8Array | string> = {};
    const tt = tapeToolScript(tape.img, tape.name);
    for (const f of tape.img.files) if (f.load != null && f.data.length) files[tapeFileName(f)] ??= makePrg(f.load, f.data);
    if (tt) { Object.assign(files, tt.files); files['build.bat'] = `${tt.script.join('\r\n')}\r\n`; }
    try {
      const w = await kr.writeExport({ target: 'pick', files });
      if (w) toast(`Saved ${w.written.length} file${w.written.length === 1 ? '' : 's'} of ${tape.name} to ${w.dir}${tt ? ': build.bat writes the tape again with TapeTool' : ''}`, 'ok');
    } catch (e) { toast(errorText(e), 'err'); }
  };
  /** the Kick Assembler source Smart attach gave Brokkr: Pack a file over the work, until it goes back */
  const [packSource, setPackSource] = useState<AsmPickResult | null>(null);
  /** File → Smart attach…: one dialog for every kind of file, each opened as its extension says (shared/smart-attach.ts):
   *  PRGs, snapshots and cartridges open as Open PRG files… opens them, a .d64 is mounted, a project opens, and a
   *  Kick Assembler source goes to Brokkr (Pack a file: KickAss.jar assembles it, Brokkr packs the PRG) */
  const smartAttach = async () => {
    if (!kr) return needDesktop();
    try {
      const r = await kr.smartAttach({ zeroPage: !!project.settings.snapshotZeroPage });
      if (!r) return;
      for (const p of r.problems) toast(`${p.name}: ${p.message}`, 'err');
      if (r.left.length) toast(`Not opened: ${r.left.map(l => `${l.name} (${l.why})`).join(', ')}`, 'warn');
      if (r.project) { await openProject(r.project); return; }
      if (r.disk) mountBytes(r.disk.name, r.disk.path, r.disk.bytes, r.disk.sides, !!r.tape);
      if (r.tape) insertTapeBytes(r.tape.name, r.tape.path, r.tape.bytes, !!r.disk);
      if (r.files.length) addFiles(r.files, false, { show: true });
      if (r.asm) setPackSource(r.asm);
    } catch (e) { toast(errorText(e), 'err'); }
  };
  /** the disk each file opened from a mounted D64 or G64 came from (Sindri puts it in its drive), and the file there
   *  (Build & Run writes the built file back into the disk's copy) */
  const diskOf = useRef(new Map<string, Uint8Array>());
  const diskFileOf = useRef(new Map<string, D64File>());
  /** the next sides of the disk each file came from (Sindri turns to them when the program asks) */
  const sidesOf = useRef(new Map<string, Uint8Array[]>());
  /** a file a disk's loader loads that the directory does not list (a Disk-Speed file): the disk, its next sides and its
   *  boot file, which Sindri runs when the file does not run alone (its loader loads it with the rest of the program) */
  const diskBootOf = useRef(new Map<string, { disk: Uint8Array; sides: Uint8Array[]; boot: UnpackDiskBoot }>());
  const openFromDisk = (f: D64File, add: boolean) => {
    if (!disk) return;
    lastFrom.current = { kind: 'disk', f };
    // an IFFL file is no program: its first bytes are a table, not a load address, so it opens as its parts
    const iffl = disk.iffl?.files.find(x => x.track === f.track && x.sector === f.sector);
    if (iffl) {
      setUi({ bottom: 'iffl', panelOpen: true });
      toast(`"${f.name}" is an IFFL file, not a program: ${iffl.parts.length} parts the game loads by number${iffl.packer ? `, packed with ${IFFL_PACKER[iffl.packer].name}` : ''}. Open them in the IFFL parts tab`, 'info');
      return;
    }
    // a 40-track disk kept as a 35-track image: the rest of the file is not in it
    if (f.pastEnd) { toast(pastEndText(f, f.pastEnd, disk.img.tracks), 'err'); return; }
    try {
      const file = withId(parsePrg(d64FileName(f), readD64File(disk.bytes, f)));
      diskOf.current.set(file.id, disk.bytes);
      diskFileOf.current.set(file.id, f);
      sidesOf.current.set(file.id, disk.sides.map(s => s.bytes));
      addFiles([file], add);
    } catch (e) { toast(`"${f.name}": ${errorText(e)}`, 'err'); }
  };
  /** the file of the disk or the tape opened (or added) last: Alt+↓ and Alt+↑ go on from it */
  const lastFrom = useRef<{ kind: 'disk'; f: D64File } | { kind: 'tape'; f: TapeFile } | null>(null);
  /** Alt+↓ / Alt+↑: the next program on the disk or the tape the last one came from (or the one before) opens, as a
   *  click on it does; with none opened yet, the first (or last) on the mounted disk, else on the tape */
  const openNextFrom = (dir: 1 | -1) => {
    const l = lastFrom.current;
    const kind = l && (l.kind === 'disk' ? disk : tape) ? l.kind : disk ? 'disk' : tape ? 'tape' : null;
    if (!kind) { toast('No disk or tape: Alt+↓ and Alt+↑ open the next program on a mounted disk or the tape, and the one before', 'info'); return; }
    const step = <T,>(files: readonly T[], from: T | undefined, can: (f: T) => boolean): T | null => {
      let i = from === undefined ? -1 : files.indexOf(from);
      if (i < 0) i = dir > 0 ? -1 : files.length;
      do i += dir; while (i >= 0 && i < files.length && !can(files[i]));
      return files[i] ?? null;
    };
    const name = kind === 'disk' ? disk!.name : tape!.name;
    const next = kind === 'disk'
      ? step(disk!.img.files, l?.kind === 'disk' ? l.f : undefined, f => f.type === 'PRG')
      : step(tape!.img.files, l?.kind === 'tape' ? l.f : undefined, tapeOpens);
    if (!next) { toast(dir > 0 ? `That was the last program on ${name}` : `That was the first program on ${name}`, 'info'); return; }
    if (kind === 'disk') openFromDisk(next as D64File, false); else openFromTape(next as TapeFile, false);
  };
  /** the files of the mounted disk and the tape that are in the project: the Explorer marks them */
  const diskOpen = new Set(project.files.map(f => diskFileOf.current.get(f.id)).filter((f): f is D64File => !!f));
  const tapeOpen = new Set(project.files.map(f => tapeOf.current.get(f.id)?.file).filter((f): f is TapeFile => !!f));
  /** the loader's own file (a chunk, a file, an IFFL part) each file opened from a loader tab of the bottom panel came
   *  from: the tab marks the ones in the project, so it shows which is loaded */
  const loaderOf = useRef(new Map<string, object>());
  const fromLoader = <T extends { id: string }>(item: object, files: T[]): T[] => { for (const f of files) loaderOf.current.set(f.id, item); return files; };
  const loaderOpen: ReadonlySet<object> = new Set(project.files.flatMap(f => { const x = loaderOf.current.get(f.id); return x ? [x] : []; }));
  /* ---- Export files to project (spec 13.5): a loader tab's files as sources of their own in a folder of the project,
     named after the disk or tape; the files that one loader call loads together (a Spindle job, a Sparkle bundle, an
     IFFL part's pieces) in one source. Each group is analysed alone, in a worker of its own, with the project's
     settings; the project and its listing stay as they are. It needs a project: without one the work becomes one
     first, as Save does ---- */
  type LoaderGroup = { name: string; what: string; files: () => FileInput[] };
  /** a file's name as a source's: without its extension, only letters, digits, _ and - */
  const stemOf = (fileName: string) => projectNameFor(fileName);
  const [exportAsk, setExportAsk] = useState<{ from: string; groups: LoaderGroup[] } | null>(null);
  const exporting = useRef(false);
  /** the folder in the project a disk's or tape's sources go in: its name, kept clear of the project's own folders */
  const exportFolder = (from: string) => { const n = projectNameFor(from); return (Object.values(PROJECT_FOLDERS) as string[]).includes(n.toLowerCase()) ? `${n}-files` : n; };
  /** set while the loader tabs' export functions are only asked which files they have (scriptFileChoices): the
   *  groups are kept here and nothing is exported */
  const groupsOnly = useRef<LoaderGroup[] | null>(null);
  const exportLoaderFiles = (from: string, groups: LoaderGroup[]) => {
    if (groupsOnly.current) { groupsOnly.current.push(...groups); return; }
    if (!kr) return needDesktop();
    if (!groups.length) { toast(`${from} has no file that opens as a program`, 'info'); return; }
    if (!home) { setExportAsk({ from, groups }); return; }
    void exportGroups(from, groups);
  };
  const exportGroups = async (from: string, groups: LoaderGroup[]) => {
    if (!kr) return;
    if (exporting.current) { toast('Export files to project is still at work', 'info'); return; }
    exporting.current = true;
    const folder = exportFolder(from), settings = latest.current.project.settings;
    const out: Record<string, string | Uint8Array> = {}, bad: string[] = [], taken = new Set<string>();
    let sources = 0, joined = 0;
    toast(`Exporting ${groups.length} source${groups.length === 1 ? '' : 's'} of ${from} to the project…`, 'info');
    try {
      for (const g of groups) {
        // (two groups of one name, two files a loader unpacks to one address: the second gets a number)
        const base = stemOf(g.name);
        let name = base;
        for (let k = 2; taken.has(name); k++) name = `${base}_${k}`;
        taken.add(name);
        const files = g.files().map(({ name: n, load, bytes }) => ({ name: n, load, bytes }));
        // a single file's source is named after the group (its own name, or the one with a number)
        if (files.length === 1) files[0].name = `${name}.prg`;
        const r = await exportWorker().exportGroup(createProject({ name, files, settings }), name, g.what);
        sources += r.sources.length;
        if (files.length > 1 && r.sources.length === 1) joined++;
        for (const [k, v] of Object.entries(r.files)) out[`${folder}/${k}`] = v;
        if (!r.ok) bad.push(`${name}${r.problem ? ` (${r.problem})` : ''}`);
      }
      const w = await kr.writeExport({ target: 'home', files: out });
      if (!w) return;
      const dir = `${w.dir}${w.dir.includes('/') && !w.dir.includes('\\') ? '/' : '\\'}${folder}`;
      toast(`Exported ${sources} source${sources === 1 ? '' : 's'} of ${from} to ${dir}${joined ? `, ${joined} of them with the files one load call loads, each in a segment written as its own PRG` : ''}: ${bad.length
        ? `${bad.length} did not assemble to the same bytes again: ${bad.slice(0, 3).join(', ')}${bad.length > 3 ? ', …' : ''}`
        : `every one assembles to the same bytes again`}`, bad.length ? 'warn' : 'ok');
    } catch (e) { toast(`Export files to project: ${errorText(e)}`, 'err'); } finally { exporting.current = false; }
  };
  /** Export files to project without a project: the work made a project (as Save makes it), then the export */
  const exportIntoNewProject = async (name: string, parent: string, git: boolean) => {
    const a = exportAsk;
    if (!a) return;
    await createFromWork(name, parent, git);
    setExportAsk(null);
    await exportGroups(a.from, a.groups);
  };
  /** the animation streams of the mounted Spindle disk (a player stores or draws them frame by frame, core store-anim
   *  and petscii-anim): a chunk opened from the Spindle tab that holds one is animation data, not a packed file */
  const spinDisk = disk?.spindle ?? null;
  const animDataOf = (f: LoadedFile | undefined): AnimData | null => {
    const c = f && loaderOf.current.get(f.id);
    return c && spinDisk ? chunkAnimData(spinDisk, c as SpindleChunk) : null;
  };
  /** a chunk of a Spindle disk's job, as a PRG at its address */
  const spinChunkFile = (j: SpindleJob, c: SpindleChunk) => withId(parsePrg(spinChunkName(j, c).replace(/\.bin$/, '.prg'), makePrg(c.start, c.bytes)));
  const openChunk = (j: SpindleJob, c: SpindleChunk, add: boolean) => {
    try { addFiles(fromLoader(c, [spinChunkFile(j, c)]), add, { gfx: true }); } catch (e) { toast(errorText(e), 'err'); }
  };
  /** a source per job, its chunks in it */
  const exportSpindleFiles = () => {
    const d = disk?.spindle;
    if (disk && d) exportLoaderFiles(disk.name, d.jobs.map(j => ({ name: `job${j.n.toString(16).padStart(2, '0')}`, what: `job ${j.n} of ${disk.name}`, files: () => j.chunks.map(c => spinChunkFile(j, c)) })));
  };
  /** every chunk of a Spindle disk's jobs in a folder: as the load script names it (the bytes alone, the script gives
   *  the address) and as a PRG at its address, with the script */
  const saveSpindleFiles = async () => {
    if (!kr) return needDesktop();
    const d = disk?.spindle;
    if (!disk || !d) return;
    const files: Record<string, Uint8Array | string> = {};
    let n = 0;
    for (const j of d.jobs) for (const c of j.chunks) {
      n++;
      files[spinChunkName(j, c)] = c.bytes.slice();
      files[spinChunkName(j, c).replace(/\.bin$/, '.prg')] = makePrg(c.start, c.bytes);
    }
    const script = `${disk.name.replace(/\.(d64|g64)$/i, '')}-spin.txt`;
    files[script] = `${spinScript(d, disk.name).join('\n')}\n`;
    try {
      const w = await kr.writeExport({ target: 'pick', files });
      if (w) toast(`Saved ${n} chunk${n === 1 ? '' : 's'} of ${disk.name}'s jobs to ${w.dir}, each as the script names it (.bin) and as a PRG, and ${script}, the load script Spin reads`, 'ok');
    } catch (e) { toast(errorText(e), 'err'); }
  };
  /** a file of a Bitfire disk as a PRG: unpacked, at where it unpacks to; else as it loads */
  const bitfirePrg = (f: BitfireFile) => makePrg(f.unpacked?.start ?? f.load, f.unpacked?.bytes ?? f.bytes);
  const bitfireFile = (f: BitfireFile) => withId(parsePrg(bitfireFileName(f).replace(/\.lz$/, '.prg'), bitfirePrg(f)));
  const openBitfireFile = (f: BitfireFile, add: boolean) => {
    try { addFiles(fromLoader(f, [bitfireFile(f)]), add, { gfx: true }); } catch (e) { toast(errorText(e), 'err'); }
  };
  const exportBitfireFiles = () => {
    const d = disk?.bitfire;
    if (disk && d) exportLoaderFiles(disk.name, d.files.map(f => { const x = bitfireFile(f); return { name: stemOf(x.name), what: `file $${h2(f.n)} of ${disk.name}`, files: () => [x] }; }));
  };
  /** every file of a Bitfire disk in a folder: as it is on the disk (what d64write's -b takes, the .lz the command line
   *  names) and unpacked as a PRG when it is packed, with d64write's command line that writes the disk again */
  const saveBitfireFiles = async () => {
    if (!kr) return needDesktop();
    const d = disk?.bitfire;
    if (!disk || !d) return;
    const files: Record<string, Uint8Array | string> = {};
    for (const f of d.files) {
      files[bitfireFileName(f)] = makePrg(f.load, f.bytes);
      if (f.unpacked) files[bitfireFileName(f).replace(/\.lz$/, '.prg')] = bitfirePrg(f);
    }
    const n = d.files.length, unpacked = d.files.filter(f => f.unpacked).length, script = `${disk.name.replace(/\.(d64|g64)$/i, '')}-d64write.sh`;
    files[script] = `${d64writeScript(d, disk.name).join('\n')}\n`;
    try {
      const w = await kr.writeExport({ target: 'pick', files });
      if (w) toast(`Saved ${n} file${n === 1 ? '' : 's'} of ${disk.name} to ${w.dir} (${unpacked} of them unpacked as well), and ${script}, d64write's command line that writes the disk again`, 'ok');
    } catch (e) { toast(errorText(e), 'err'); }
  };
  /** a file of a BoozeLoader disk as a PRG: unpacked, at where it unpacks to; else as it loads (as much as memory holds) */
  const boozePrg = (f: BoozeFile) => makePrg(f.unpacked?.start ?? f.load, f.unpacked?.bytes ?? f.bytes.subarray(0, f.end - f.load));
  const boozeFile = (f: BoozeFile) => withId(parsePrg(boozeFileName(f), boozePrg(f)));
  const openBoozeFile = (f: BoozeFile, add: boolean) => {
    try { addFiles(fromLoader(f, [boozeFile(f)]), add, { gfx: true }); } catch (e) { toast(errorText(e), 'err'); }
  };
  const exportBoozeFiles = () => {
    const d = disk?.booze;
    if (disk && d) exportLoaderFiles(disk.name, d.files.map(f => { const x = boozeFile(f); return { name: stemOf(x.name), what: `${f.n != null ? `file $${h2(f.n)}` : `the file at ${f.track}/${f.sector}`} of ${disk.name}`, files: () => [x] }; }));
  };
  /** every file of a BoozeLoader disk in a folder: as a PRG, unpacked when it is packed (else as much as memory holds),
   *  and as it is on the disk when that is not the same (packed: .b1 or .b2; longer than memory: .raw, all of it), with
   *  the list of the files */
  const saveBoozeFiles = async () => {
    if (!kr) return needDesktop();
    const d = disk?.booze;
    if (!disk || !d) return;
    const files: Record<string, Uint8Array | string> = {};
    for (const f of d.files) {
      files[boozeFileName(f)] = boozePrg(f);
      if (f.unpacked || f.long) files[boozeFileName(f).replace(/\.prg$/, f.unpacked ? `.${d.cruncher ?? 'packed'}` : '.raw')] = makePrg(f.load, f.bytes);
    }
    const n = d.files.length, unpacked = d.files.filter(f => f.unpacked).length, list = `${disk.name.replace(/\.(d64|g64)$/i, '')}-booze.txt`;
    files[list] = `${boozeFileList(d, disk.name).join('\r\n')}\r\n`;
    try {
      const w = await kr.writeExport({ target: 'pick', files });
      if (w) toast(`Saved ${n} file${n === 1 ? '' : 's'} of ${disk.name} to ${w.dir}${unpacked ? ` (${unpacked} unpacked, and as they are on the disk)` : ''}, and ${list}, the list of them`, 'ok');
    } catch (e) { toast(errorText(e), 'err'); }
  };
  /** a chunk of a Sparkle disk's bundle, as a PRG at its address */
  const sparkleFile = (b: SparkleBundle, c: SparkleChunk) => withId(parsePrg(sparkleChunkName(b, c), sparkleChunkPrg(c)));
  const openSparkleChunk = (b: SparkleBundle, c: SparkleChunk, add: boolean) => {
    try { addFiles(fromLoader(c, [sparkleFile(b, c)]), add, { gfx: true }); } catch (e) { toast(errorText(e), 'err'); }
  };
  /** a source per bundle, its files in it */
  const exportSparkleFiles = () => {
    const d = disk?.sparkle;
    if (disk && d) exportLoaderFiles(disk.name, d.bundles.map(b => ({ name: `bundle${b.n.toString(16).padStart(2, '0')}`, what: `bundle $${h2(b.n)} of ${disk.name}`, files: () => b.chunks.map(c => sparkleFile(b, c)) })));
  };
  /** every chunk of a Sparkle disk's bundles as a PRG in a folder, with the loader script rebuilt to load them */
  const saveSparkleFiles = async () => {
    if (!kr) return needDesktop();
    const d = disk?.sparkle;
    if (!disk || !d) return;
    const files: Record<string, Uint8Array | string> = {};
    for (const b of d.bundles) for (const c of b.chunks) files[sparkleChunkName(b, c)] = sparkleChunkPrg(c);
    const n = Object.keys(files).length, script = `${disk.name.replace(/\.(d64|g64)$/i, '')}.sls`;
    files[script] = `${sparkleScript(d, disk.name).join('\r\n')}\r\n`;
    try {
      const w = await kr.writeExport({ target: 'pick', files });
      if (w) toast(`Saved ${n} file${n === 1 ? '' : 's'} of ${disk.name}'s bundles to ${w.dir}, and ${script}, the loader script that loads them`, 'ok');
    } catch (e) { toast(errorText(e), 'err'); }
  };
  /** a part of an IFFL file unpacked: its pieces, a PRG each at where it unpacks to */
  const ifflPartFiles = (f: IfflFile, p: IfflPart) => (p.pieces ?? []).map(x => withId(parsePrg(ifflPieceName(f, p, x), ifflPiecePrg(x))));
  const openIfflPart = (f: IfflFile, p: IfflPart, add: boolean) => {
    if (!p.pieces) return;
    try { addFiles(fromLoader(p, ifflPartFiles(f, p)), add, { gfx: true }); } catch (e) { toast(errorText(e), 'err'); }
  };
  /** the parts that are packed (a part that is not has no address of its own: Save parts… saves it) */
  /** a source per packed part, its pieces in it (a part that is not packed has no address: Save parts… saves it) */
  const exportIfflParts = () => {
    const d = disk?.iffl;
    if (disk && d) exportLoaderFiles(disk.name, d.files.flatMap(f => f.parts.filter(p => p.pieces).map(p => ({ name: stemOf(ifflPartName(f, p)), what: `part ${p.n} of "${f.name}" on ${disk.name}`, files: () => ifflPartFiles(f, p) }))));
  };
  /** every part of the disk's IFFL files in a folder: as it is stored and, when it is packed, its pieces unpacked as
   *  PRGs */
  const saveIfflParts = async () => {
    if (!kr) return needDesktop();
    const d = disk?.iffl;
    if (!disk || !d) return;
    const files: Record<string, Uint8Array | string> = {};
    let n = 0, unpacked = 0;
    for (const f of d.files) for (const p of f.parts) {
      n++;
      files[ifflPartName(f, p)] = p.bytes;
      if (p.pieces) unpacked++;
      for (const x of p.pieces ?? []) files[ifflPieceName(f, p, x)] = ifflPiecePrg(x);
    }
    try {
      const w = await kr.writeExport({ target: 'pick', files });
      if (w) toast(`Saved ${n} IFFL part${n === 1 ? '' : 's'} of ${disk.name} to ${w.dir} (${unpacked} of them unpacked as well)`, 'ok');
    } catch (e) { toast(errorText(e), 'err'); }
  };
  /** a file of a disk for Krill's loader as a PRG: unpacked, at where it unpacks to; else as it loads */
  const krillFile = (f: KrillFile) => withId(parsePrg(krillUnpackedName(f), krillFilePrg(f)));
  const openKrillFile = (f: KrillFile, add: boolean) => {
    try { addFiles(fromLoader(f, [krillFile(f)]), add, { gfx: true }); } catch (e) { toast(errorText(e), 'err'); }
  };
  const exportKrillFiles = () => {
    const d = disk?.krill;
    if (disk && d) exportLoaderFiles(disk.name, d.files.map(f => { const x = krillFile(f); return { name: stemOf(x.name), what: `${krillFileName(f)} of ${disk.name}`, files: () => [x] }; }));
  };
  /** every file of a disk for Krill's loader in a folder: as it is on the disk (what cc1541 writes), and unpacked as a
   *  PRG when it is packed, with cc1541's command line that writes the disk again */
  const saveKrillFiles = async () => {
    if (!kr) return needDesktop();
    const d = disk?.krill;
    if (!disk || !d) return;
    const files: Record<string, Uint8Array | string> = {};
    for (const f of d.files) {
      files[krillFileName(f)] = krillDiskPrg(f);
      if (f.unpacked) files[krillUnpackedName(f)] = krillFilePrg(f);
    }
    const base = disk.name.replace(/\.(d64|g64)$/i, ''), n = d.files.length, unpacked = d.files.filter(f => f.unpacked).length, script = `${base}-cc1541.sh`;
    files[script] = `${cc1541Script(d, disk.name).join('\n')}\n`;
    // the program's own calls of the loader (5.15c), when the analysis found them
    const S = latest.current.A.krill, own = S?.steps.length ? `${base}-krill-script.txt` : null;
    if (S && own) files[own] = `${krillScriptText(S, d, disk.name).join('\n')}\n`;
    try {
      const w = await kr.writeExport({ target: 'pick', files });
      if (w) toast(`Saved ${n} file${n === 1 ? '' : 's'} of ${disk.name} to ${w.dir} (${unpacked} of them unpacked as well), and ${script}, cc1541's command line that writes the disk again${own ? `, and ${own}, the program's calls of the loader` : ''}`, 'ok');
    } catch (e) { toast(errorText(e), 'err'); }
  };
  /** a file of a disk for the Covert Bitops loader as a PRG: unpacked, at where it unpacks to; else as it loads */
  const covertFile = (f: CovertFile) => withId(parsePrg(covertUnpackedName(f), covertFilePrg(f)));
  const openCovertFile = (f: CovertFile, add: boolean) => {
    try { addFiles(fromLoader(f, [covertFile(f)]), add, { gfx: true }); } catch (e) { toast(errorText(e), 'err'); }
  };
  const exportCovertFiles = () => {
    const d = disk?.covert;
    if (disk && d) exportLoaderFiles(disk.name, d.files.map(f => { const x = covertFile(f); return { name: stemOf(x.name), what: `"${d.entries[f.entry].name}" of ${disk.name}`, files: () => [x] }; }));
  };
  /** every file of a disk for the Covert Bitops loader in a folder: as it is on the disk (what makedisk or maked64
   *  takes), and unpacked as a PRG when it is packed, with the tool's command file and a note with its command line */
  const saveCovertFiles = async () => {
    if (!kr) return needDesktop();
    const d = disk?.covert;
    if (!disk || !d) return;
    const files: Record<string, Uint8Array | string> = {};
    for (const f of d.files) {
      files[covertFileName(f)] = covertDiskFile(f);
      if (f.unpacked) files[covertUnpackedName(f)] = covertFilePrg(f);
    }
    const n = d.files.length, unpacked = d.files.filter(f => f.unpacked).length, base = disk.name.replace(/\.(d64|g64)$/i, '');
    const s = covertScript(d, disk.name), seq = `${base}.seq`, notes = `${base}-${s.tool}.txt`;
    files[seq] = `${s.seq.join('\r\n')}\r\n`;
    files[notes] = `${covertScriptText(s).join('\r\n')}\r\n`;
    try {
      const w = await kr.writeExport({ target: 'pick', files });
      if (w) toast(`Saved ${n} file${n === 1 ? '' : 's'} of ${disk.name} to ${w.dir} (${unpacked} of them unpacked as well), ${seq}, ${s.tool}'s command file that writes the disk again, and ${notes}`, 'ok');
    } catch (e) { toast(errorText(e), 'err'); }
  };
  /** a file of a disk for DLoC's loader as a PRG: unpacked, at where it unpacks to (the boot: what Six's packer unpacks
   *  it to); else as it loads */
  const openDlocFile = (f: DlocFile, add: boolean) => {
    const d = disk?.dloc;
    if (!d) return;
    try { addFiles(fromLoader(f, [withId(parsePrg(dlocUnpackedName(f, d), dlocFilePrg(f)))]), add, { gfx: true }); } catch (e) { toast(errorText(e), 'err'); }
  };
  /** in the order the tab lists them: the order they load in, then the files no load names */
  const exportDlocFiles = () => {
    const d = disk?.dloc;
    if (!disk || !d) return;
    const rows = [...d.order, ...d.files.map(f => f.entry).filter(e => !d.order.includes(e))].map(e => d.entries[e].file!);
    exportLoaderFiles(disk.name, rows.map(f => { const x = parsePrg(dlocUnpackedName(f, d), dlocFilePrg(f)); return { name: stemOf(x.name), what: `"${d.entries[f.entry].name}" of ${disk.name}`, files: () => [x] }; }));
  };
  /** every file of a disk for DLoC's loader in a folder: as it is on the disk (what c1541 writes), and unpacked as a
   *  PRG when it is packed, with the script (the files in the order they load, and c1541's command line) */
  const saveDlocFiles = async () => {
    if (!kr) return needDesktop();
    const d = disk?.dloc;
    if (!disk || !d) return;
    const files: Record<string, Uint8Array | string> = {};
    for (const f of d.files) {
      files[dlocFileName(f, d)] = f.data.slice();
      if (f.unpacked || f.boot) files[dlocUnpackedName(f, d)] = dlocFilePrg(f);
    }
    const n = d.files.length, unpacked = d.files.filter(f => f.unpacked || f.boot).length, script = `${disk.name.replace(/\.(d64|g64)$/i, '')}-dloc.txt`;
    files[script] = `${dlocScriptText(dlocScript(d, disk.name)).join('\r\n')}\r\n`;
    try {
      const w = await kr.writeExport({ target: 'pick', files });
      if (w) toast(`Saved ${n} file${n === 1 ? '' : 's'} of ${disk.name} to ${w.dir} (${unpacked} of them unpacked as well), and ${script}: the files in the order they load and c1541's command line that writes the disk again`, 'ok');
    } catch (e) { toast(errorText(e), 'err'); }
  };
  /** a file outside the directory of a Pirate Slayer disk as a PRG at its load address, decoded (as much as memory holds) */
  const pirateSlayerFile = (f: PirateSlayerFile) => withId(parsePrg(pirateSlayerFileName(f), pirateSlayerPrg(f)));
  const openPirateSlayerFile = (f: PirateSlayerFile, add: boolean) => {
    try { addFiles(fromLoader(f, [pirateSlayerFile(f)]), add, { gfx: true }); } catch (e) { toast(errorText(e), 'err'); }
  };
  const exportPirateSlayerFiles = () => {
    const p = disk?.pirateslayer;
    if (disk && p) exportLoaderFiles(disk.name, p.files.map(f => { const x = pirateSlayerFile(f); return { name: stemOf(x.name), what: `the file at ${f.track}/${f.sector} of ${disk.name}`, files: () => [x] }; }));
  };
  /** every file outside the directory of a Pirate Slayer disk, decoded, as a PRG each in a folder, with files.txt that
   *  lists them */
  const savePirateSlayerFiles = async () => {
    if (!kr) return needDesktop();
    const p = disk?.pirateslayer;
    if (!disk || !p?.files.length) return;
    const files: Record<string, Uint8Array | string> = {};
    for (const f of p.files) files[pirateSlayerFileName(f)] = pirateSlayerPrg(f);
    files['files.txt'] = `${pirateSlayerFileList(p, disk.name).join('\r\n')}\r\n`;
    try {
      const w = await kr.writeExport({ target: 'pick', files });
      if (w) toast(`Saved ${p.files.length} file${p.files.length === 1 ? '' : 's'} of ${disk.name} to ${w.dir}, decoded, and files.txt that lists them`, 'ok');
    } catch (e) { toast(errorText(e), 'err'); }
  };
  /** a file of a Para-Protect disk (a loader file, a page past track 35, a file of the game's own directory) as a PRG at
   *  its load address (as much as memory holds) */
  const paraProtectFile = (f: ParaProtectFile) => withId(parsePrg(f.name, paraProtectPrg(f)));
  const openParaProtectFile = (f: ParaProtectFile, add: boolean) => {
    try { addFiles(fromLoader(f, [paraProtectFile(f)]), add, { gfx: true }); } catch (e) { toast(errorText(e), 'err'); }
  };
  const exportParaProtectFiles = () => {
    const p = disk?.paraprotect;
    if (disk && p) exportLoaderFiles(disk.name, p.files.map(f => { const x = paraProtectFile(f); return { name: stemOf(x.name), what: `${f.kind === 'own' ? `the game's file ${f.name}` : `the loader's pages from ${f.track}/${f.sector}`} of ${disk.name}`, files: () => [x] }; }));
  };
  /** every file of a Para-Protect disk as a PRG each in a folder, with files.txt that lists them */
  const saveParaProtectFiles = async () => {
    if (!kr) return needDesktop();
    const p = disk?.paraprotect;
    if (!disk || !p?.files.length) return;
    const files: Record<string, Uint8Array | string> = {};
    for (const f of p.files) files[f.name] = paraProtectPrg(f);
    files['files.txt'] = `${paraProtectFileList(p, disk.name).join('\r\n')}\r\n`;
    try {
      const w = await kr.writeExport({ target: 'pick', files });
      if (w) toast(`Saved ${p.files.length} file${p.files.length === 1 ? '' : 's'} of ${disk.name} to ${w.dir}, and files.txt that lists them`, 'ok');
    } catch (e) { toast(errorText(e), 'err'); }
  };
  /** a file of a Disk-Speed disk's table as a PRG at its load address (as much as memory holds) */
  const diskSpeedFile = (f: DiskSpeedFile) => withId(parsePrg(f.name, diskSpeedPrg(f)));
  const openDiskSpeedFile = (f: DiskSpeedFile, add: boolean) => {
    try {
      const x = diskSpeedFile(f);
      // a file of the loader's table does not run alone (Elite decodes 2NDBIT and 3RDBIT once all five are in): Unpack
      // runs the disk from its boot file, as LOAD and RUN do
      const b = disk?.diskspeed?.boot, e = b && disk.img.files.find(z => z.type === 'PRG' && z.track === b.track && z.sector === b.sector);
      if (disk && e) diskBootOf.current.set(x.id, { disk: disk.bytes, sides: disk.sides.map(s => s.bytes), boot: { name: e.name, prg: readD64File(disk.bytes, e), start: f.load, end: f.end - 1 } });
      addFiles(fromLoader(f, [x]), add, { gfx: true });
    } catch (e) { toast(errorText(e), 'err'); }
  };
  const exportDiskSpeedFiles = () => {
    const p = disk?.diskspeed;
    if (disk && p) exportLoaderFiles(disk.name, p.files.map(f => { const x = diskSpeedFile(f); return { name: stemOf(x.name), what: `${f.label ? `${f.label}, ` : ''}the loader's file ${f.index + 1} from ${f.track}/${f.sector} of ${disk.name}`, files: () => [x] }; }));
  };
  /** every file of a Disk-Speed disk's table as a PRG each in a folder, with files.txt that lists them */
  const saveDiskSpeedFiles = async () => {
    if (!kr) return needDesktop();
    const p = disk?.diskspeed;
    if (!disk || !p?.files.length) return;
    const files: Record<string, Uint8Array | string> = {};
    for (const f of p.files) files[f.name] = diskSpeedPrg(f);
    files['files.txt'] = `${diskSpeedFileList(p, disk.name).join('\r\n')}\r\n`;
    try {
      const w = await kr.writeExport({ target: 'pick', files });
      if (w) toast(`Saved ${p.files.length} file${p.files.length === 1 ? '' : 's'} of ${disk.name} to ${w.dir}, as the C64 gets them, and files.txt that lists them`, 'ok');
    } catch (e) { toast(errorText(e), 'err'); }
  };
  /* ---- the project's cartridge (13.9) ---- */
  const crt = useMemo((): Crt | null => { try { return project.cart ? parseCrt(project.cart.crt, project.cart.name) : null; } catch { return null; } }, [project.cart]);
  /** a bank of the cartridge: in the project, the listing goes to its start (`leave`: it is taken out of the project);
   *  not in it, its chips are added (13.9b: every bank is a space of its own, so they never collide) */
  const openBank = (bank: number, leave = false) => {
    if (!crt || !project.cart) return;
    const mine = (f: LoadedFile) => f.chip != null && crt.chips[f.chip]?.bank === bank;
    const at = project.files.findIndex(mine);
    if (leave) {
      if (at < 0 || project.files.every(f => f.chip == null || mine(f))) return;
      update(`Leave bank ${bank} out`, d => { d.files = d.files.filter(f => !mine(f)); });
      toast(`Bank ${bank} is out of the project: the export takes it from the cartridge as it is (banks/). + adds it again`, 'ok');
      return;
    }
    if (at >= 0) { const s = A.spaces?.find(x => x.bank === bank); navigate(s?.entry ?? fileAddr(at), { center: true, listing: true }); return; }
    const chips = bankFiles(crt, bank).map(withId);
    update(`Add bank ${bank}`, d => { d.files.push(...chips); });
    toast(`Added bank ${bank} of ${project.cart.name}: ${chips.map(f => `${f.name} at $${h4(f.load)}`).join(', ')}`, 'ok');
  };
  /** the banks Graphics and Memory can show (13.9b): every bank of the cartridge, those in the project to pick */
  const bankChoices = useMemo((): BankChoice[] | null => {
    if (!crt) return null;
    const boot = bootBank(crt), kb = (n: number) => (n % 1024 ? `${n} B` : `${n / 1024} KB`);
    const open = new Set(project.files.map(f => f.chip));
    return crtBanks(crt).map(({ bank, chips }) => {
      const on = chips.some(c => open.has(c.index));
      return {
        bank, on,
        text: `${bank} · ${chips.map(c => `$${h4(chipAddress(crt, c))}`).join(' + ')}${bank === boot ? ' · start' : ''}${on ? '' : ' (not in the project)'}`,
        title: `${chips.map(c => `${kb(c.data.length)} at $${h4(chipAddress(crt, c))}`).join(', ')}${bank === boot ? ', the bank the C64 starts in' : ''}${on ? '' : '. + in the Explorer adds it'}`,
      };
    });
  }, [crt, project.files]);
  /** All banks in one .asm (13.9c), from the Explorer or the bank list; with it Graphics and Memory show every bank */
  const oneSource = (on: boolean) => update(on ? 'Every bank in one source' : 'A source per chip', d => { d.settings.cartOneSource = on; });
  /** every bank at once in Graphics and Memory (13.9b): with All banks in one .asm and more than one bank, as the source
   *  has them; a font per row stays in one bank */
  const allBanks = !!project.settings.cartOneSource && (A.spaces?.length ?? 0) > 1;
  const allGfx = allBanks && ui.gfx.kind !== 'fontrows';
  /** the banks' loaded memory for Graphics with every bank: from 8 KB to 8 KB, so the cells are where the VIC has them */
  const bankParts = useMemo(() => {
    if (!A.spaces) return null;
    const out: { start: Addr; end: Addr }[] = [];
    for (const r of loadedRanges(A.owner)) {
      const s = r.start - (r.start & 0x1fff), e = r.end + ((0x2000 - (r.end & 0x1fff)) & 0x1fff), last = out[out.length - 1];
      if (last && last.end >= s && spaceOf(last.start) === spaceOf(s)) last.end = Math.max(last.end, e); else out.push({ start: s, end: e });
    }
    return out;
  }, [A]);
  /** an address with its bank, `1:$8000` */
  const bankText = (a: Addr) => `${bankAt(a) ?? 0}:$${h4(spaceAddr(a))}`;
  /** Graphics and Memory show another bank: the cursor goes along, to the same address when that bank has it (else to
   *  where the bank starts), and a selection with it when the bank has all of its bytes. From every bank at once, it
   *  turns All banks in one .asm off */
  const showBank = (bank: number) => {
    const s = A.spaces?.find(x => x.bank === bank);
    if (!s || (!allBanks && s.space === space)) return;
    const to = s.space * SPACE, has = (a: Addr) => A.owner[to + a] >= 0;
    // the cursor in the bank shown (with every bank: wherever it is), else the top of the view
    const top = lastView && spaceOf(lastView.addr) === space ? lastView.addr - base : null;
    const here = allBanks ? (cursor != null ? spaceAddr(cursor) : top) : vCursor ?? top;
    const at = here != null && has(here) ? to + here : s.entry ?? fileAddr(s.files[0]);
    const from = allBanks ? (sel ? sel.start - spaceAddr(sel.start) : 0) : 0, ps = allBanks ? sel : vSel;
    const moved = ps && A.owner.subarray(to + ps.start - from, to + ps.end - from).every(o => o >= 0)
      ? { ...ps, start: to + ps.start - from, end: to + ps.end - from, ...(ps.anchor != null ? { anchor: to + ps.anchor - from } : {}), ...(ps.anchorEnd != null ? { anchorEnd: to + ps.anchorEnd - from } : {}) } : null;
    if (allBanks) { oneSource(false); toast(`Bank ${bank}: All banks in one .asm is off, so the export writes a source per chip again (Ctrl+Z turns it back on)`, 'ok'); }
    navigate(at, { keepSel: true });
    setSel(moved);
  };
  /** where Graphics and Memory open (14.6b): where the editor was last, in the bank they show (or anywhere, with every
   *  bank), unless a jump is newer */
  const lastView = viewAt.current;
  const fresh = lastView && (!scrollReq || scrollReq.n < lastView.n) ? lastView : null;
  const startIn = (all: boolean) => (!fresh ? null : all ? { addr: fresh.addr, end: fresh.end }
    : spaceOf(fresh.addr) === space ? { addr: fresh.addr - base, end: spaceOf(fresh.end) === space ? fresh.end - base : SPACE } : null);
  /** Graphics or Memory scrolled: the addresses at its top and bottom, in the bank it shows (bank addresses with every
   *  bank, where the bank to show later is the cursor's while it is on screen, as in the listing) */
  const seeIn = (all: boolean) => (top: Addr, end: Addr) => (all
    ? seeAt({ addr: top, end, n: Date.now() }, cursor != null && cursor >= top && cursor < end ? cursor : top)
    : seeAt({ addr: inBank(top), end: inBank(end), n: Date.now() }));
  /** the start of the file just opened from a loader's script or the tape, or of the block shown from the Blocks view,
   *  for Graphics (and the block for Memory): in the bank it shows (or anywhere, with every bank); null once the tab
   *  has shown it, or when the file is gone */
  const gfxFile = gfxGo && 'id' in gfxGo ? project.files.findIndex(f => f.id === gfxGo.id) : -1;
  const goAt = (all: boolean, a: Addr, n: number) => (all ? { addr: a, n } : spaceOf(a) === space ? { addr: a - base, n } : null);
  const goIn = (all: boolean) => (!gfxGo ? null : 'addr' in gfxGo ? goAt(all, gfxGo.addr, gfxGo.n) : gfxFile < 0 ? null : goAt(all, fileAddr(gfxFile), gfxGo.n));
  const memGoIn = (all: boolean) => (memGo ? goAt(all, memGo.addr, memGo.n) : null);
  // one bank in the project is analysed without spaces: it is the one shown
  const bankPick = bankChoices && {
    banks: bankChoices, all: (A.spaces?.length ?? 0) > 1,
    value: allBanks ? 'all' as const : A.spaces ? A.spaces.find(x => x.space === space)?.bank ?? null : crt?.chips[project.files[0]?.chip ?? -1]?.bank ?? null,
    onChange: (b: number | 'all') => {
      if (b !== 'all') { showBank(b); return; }
      oneSource(true);
      toast('All banks: Graphics and Memory show every bank, and All banks in one .asm is on, so the export writes every bank in one source (Ctrl+Z turns it off)', 'ok');
    },
  };
  /* ---- packed programs ---- */
  // a decruncher in front of compressed data (detectPacking), and what the unpacker finds: Sindri runs
  // every file opened (in a worker of its own, with the disk a file came from in its 1541) and keeps the result for Unpack; an external unpacker set in Settings
  // (unp64) unpacks a copy instead, and unp64 -i names the packer of every file opened
  const external = !!toolchain.unpackerPath;
  const unpackerName = external ? (toolchain.unpackerPath.split(/[\\/]/).pop() ?? 'unp64').replace(/\.exe$/i, '') : 'Sindri';
  const unpackLabel = external ? `Unpack with ${unpackerName}` : 'Unpack';
  const [runs, setRuns] = useState<Record<string, UnpackRun>>({});
  const running = useRef(new Map<string, Promise<UnpackRun>>());
  /** the checks for packing (a Sindri run by its runKey, unp64 -i by its idKey): when each began, and how long it took
   *  once it is done (failed: it never ran to an end). The analysis overview says it is still looking (a run can take
   *  half a minute, and Sindri runs one file at a time) */
  const [checks, setChecks] = useState<Record<string, PackCheck>>({});
  const checkBegins = (key: string) => setChecks(m => ({ ...m, [key]: { since: Date.now() } }));
  const checkEnds = (key: string, failed = false) => setChecks(m => {
    const c = m[key];
    return c && c.took == null ? { ...m, [key]: { ...c, took: Date.now() - c.since, ...(failed ? { failed } : {}) } } : m;
  });
  /** Where Sindri starts file `f`: at the program start when it is in the file (Unpack set it, or the user), with SYS
   *  as Build & Run starts it, else as LOAD leaves it. A program Unpack saved can start in the middle of its bytes (a
   *  cracked game's trainer menu at $2000 in $03dc-$f700, waiting for a key in front of the packed game). */
  const runStart = (f: LoadedFile): number | null => {
    // (a snapshot goes on from where it was taken)
    const e = f.vsf ? null : project.entryPoint;
    return e != null && e >= f.load && e < f.load + f.bytes.length ? e : null;
  };
  /** $01 as Sindri starts `f` at runStart: what Sindri saw there when Unpack set the start (null: as at READY) */
  const runPort = (f: LoadedFile): number | null => (runStart(f) != null ? project.entryPort ?? null : null);
  /** the I/O Sindri starts `f` in at runStart: what it saw there when Unpack set the start (null: as at READY) */
  const runIo = (f: LoadedFile): StartIo | null => (runStart(f) != null ? project.entryIo ?? null : null);
  /** a run of `f` from where it starts now (another program start, or $01 or the I/O there, is another run) */
  const runKey = (f: LoadedFile): string => { const e = runStart(f), p = runPort(f); return e == null ? f.id : `${f.id}@${e}${p != null ? `:${p}` : ''}${runIo(f) ? ':io' : ''}`; };
  const runFor = (f: LoadedFile): Promise<UnpackRun> => {
    const key = runKey(f);
    let p = running.current.get(key);
    if (!p) {
      const t = tapeOf.current.get(f.id), b = t?.boot;
      // (a turbo file goes with the boot file whose loader loads it: Sindri runs that when the file does not run alone)
      const boot = b?.load != null ? { name: tapeFileName(b).replace(/\.\w+$/, ''), prg: makePrg(b.load, b.data), at: b.to } : null;
      // (so does a file a disk's loader loads, with the disk's boot file; a file of the tape's other side, heard
      // backwards, runs without the tape: nothing on this side loads it)
      const db = diskBootOf.current.get(f.id);
      p = unpackBuiltIn(makePrg(f.load, f.bytes), diskOf.current.get(f.id) ?? db?.disk ?? null, t && !t.file.backwards ? { tap: t.tap, at: t.file.to, boot } : null, runStart(f), f.vsf ?? null, runPort(f), sidesOf.current.get(f.id) ?? db?.sides ?? [], db?.boot ?? null, runIo(f));
      running.current.set(key, p);
      checkBegins(key);
      p.then(r => { setRuns(m => ({ ...m, [key]: r })); checkEnds(key); }, () => { running.current.delete(key); checkEnds(key, true); });
    }
    return p;
  };
  useEffect(() => {
    // a cartridge's chip is not a program Sindri can load and run, nor is a tape file's header (the tape buffer). A
    // snapshot's RAM is not loaded and started either: Sindri goes on from the snapshot's machine where it was taken
    // (LOAD and RUN would start what its BASIC line says, not the program as it was). Animation data a player stores
    // frame by frame is no program either
    if (!external) for (const f of project.files) if (f.chip == null && !tapeOf.current.get(f.id)?.header && !animDataOf(f)) runFor(f).catch(() => { /* the heuristics still report it */ });
  }, [project.files, project.entryPoint, project.entryPort, external]); // eslint-disable-line react-hooks/exhaustive-deps
  const [identified, setIdentified] = useState<Record<string, IdentifyResponse>>({});
  const asked = useRef(new Set<string>());
  const idKey = (f: LoadedFile) => `${f.id}:${toolchain.unpackerPath}`;
  useEffect(() => {
    if (!kr || !/^unp64(\.exe)?$/i.test(toolchain.unpackerPath.split(/[\\/]/).pop() ?? '')) return;
    for (const f of project.files) {
      const key = idKey(f);
      if (asked.current.has(key)) continue;
      asked.current.add(key);
      checkBegins(key);
      kr.identifyPacker({ name: f.name, prg: makePrg(f.load, f.bytes) }).then(r => { setIdentified(m => ({ ...m, [key]: r })); checkEnds(key, !r.supported); })
        .catch(() => checkEnds(key, true)); // the heuristics still report it
    }
  }, [project.files, toolchain.unpackerPath]); // eslint-disable-line react-hooks/exhaustive-deps
  /** the check for packing of each file as it is now (the analysis overview shows those under way) */
  const lookingFor = project.files.flatMap((f, i): PackLook[] => {
    const c = checks[external ? idKey(f) : runKey(f)];
    return c ? [{ ...c, id: f.id, i, by: unpackerName }] : [];
  });
  const packing = useMemo(() => A.files.map((af, i): PackingInfo | null => {
    const f = project.files[i];
    // a cartridge's chip is no packed program (and is in a bank of its own). A snapshot's RAM is judged by Sindri going
    // on from it alone: the signs of a file miss what it still holds packed (9 of 73 games' snapshots), and crunched
    // data it is done with is no reason to unpack it
    // animation data a player stores frame by frame (Bliss Machine's lightning) looks packed to the signs, and is not
    if (animDataOf(f)) return null;
    const h = f?.chip != null || f?.vsf ? null : detectPacking(A, i), at = { index: i, size: af.bytes.length, entry: A.entry };
    // a snapshot is packed when going on from it a decruncher or decoder read packed data, not when it only moved code
    const run0 = f ? runs[runKey(f)] : undefined;
    const run = f?.vsf && run0 && !packedData(run0).length ? undefined : run0;
    // a program that only copies code elsewhere to run there is relocated (8.1b), not packed
    if (!external && f && onlyRelocates(run, A)) return null;
    return external ? withIdentified(h, f ? identified[idKey(f)] : undefined, at, unpackerName) : withUnpackRun(h, run, at);
  }), [A, identified, runs, project.files, project.entryPoint, project.entryPort, external, unpackerName, spinDisk]); // eslint-disable-line react-hooks/exhaustive-deps
  /** what each file is when it is animation data (the bar above the listing and the analysis overview say it) */
  const animData = useMemo(() => project.files.map(f => animDataOf(f)), [project.files, spinDisk]); // eslint-disable-line react-hooks/exhaustive-deps
  /** Put the unpacked PRG in place of file `i` (a project of its own when it was the only file); says where it went.
   *  `port`: $01 as the program starts at `start` (Sindri's saved.port), kept with the start when it is not $37; `io`:
   *  the I/O it starts in there (saved.io: the VIC bank, the raster interrupt, the colour RAM …), kept with the start */
  const takeUnpacked = (i: number, f: LoadedFile, prg: Uint8Array, start: number | null | undefined, port: number | null = null, io: StartIo | null = null): string => {
    const out = withId(parsePrg(unpackedName(f.name), prg));
    // a tape's boot file opened with its header, the tape buffer (13.5f), is one KERNAL file in two: Sindri ran them
    // together, so the unpacked program takes the place of both. Kept, the header would lie under the program where
    // it loads over the tape buffer (Tusker's first stage, $029f-$07e7), the later file winning those bytes, and the
    // unpacked file could not be built byte for byte; and with two files Unpack would set no program start
    const tf = tapeOf.current.get(f.id);
    const head = tf && !tf.header ? project.files.find(x => { const t = tapeOf.current.get(x.id); return x.id !== f.id && !!t?.header && t.file === tf.file; }) : undefined;
    const alone = project.files.length === (head ? 2 : 1);
    const entry = start != null && start >= out.load && start < out.load + out.bytes.length ? start : null;
    const entryPort = entry != null && port != null && port !== 0x37 && alone ? port : null;
    const entryIo = entry != null && io && alone ? io : null;
    if (alone) { replace({ ...createProject({ name: projectNameFor(out.name), files: [out], settings: project.settings }), entryPoint: entry, ...(entryPort != null ? { entryPort } : {}), ...(entryIo ? { entryIo } : {}) }, home ? `Unpack ${f.name}` : undefined); resetView(); }
    else update(`Unpack ${f.name}`, d => {
      // a patch written over the packed file (or its header) has nothing to stand on in the unpacked one
      const gone = [d.files[i], ...(head ? [head] : [])].map(x => ({ start: x.load, end: x.load + x.bytes.length }));
      d.files[i] = out;
      if (head) d.files = d.files.filter(x => x.id !== head.id);
      d.patches = d.patches.filter(p => !gone.some(g => p.start >= g.start && patchEnd(p) <= g.end));
    });
    // the program the packer hid is loaded now: its loader and its start show in the Explorer as a load's do (14.1)
    afterLoad([out.id], !alone, true);
    const at = `$${h4(out.load)}-$${h4(out.load + out.bytes.length - 1)}`;
    toast(`Unpacked ${f.name}${head ? ` with its header ${head.name}` : ''}: ${out.bytes.length} bytes at ${at}`, 'ok');
    return `${out.name}, ${at}${head ? ` (in place of ${f.name} and ${head.name})` : ''}${entry != null ? `, starting at $${h4(entry)}${entryPort != null ? ` with $01 = $${h2(entryPort)}` : ''}${entryIo ? ` and the I/O it started in (${ioSummary(entryIo)}${entryIo.color ? ', the colour RAM' : ''})` : ''}${alone ? ' (set as the program start)' : ''}` : ''}`;
  };
  /** `auto`: the file was just opened, with *Unpack packed files when they are opened* on */
  const unpackFile = async (i: number, auto = false) => {
    const f = project.files[i];
    if (!f) return;
    const when = auto ? ' as it was opened (Settings → General)' : '';
    if (!external) {
      setBuildBusy('Unpacking');
      try {
        const run = await runFor(f);
        const output = unpackLog(run, f.name, f.load, f.bytes.length);
        // a turbo file (or a file a disk's loader loads) that did not run from where it loads: Sindri ran the tape's (the
        // disk's) boot file, whose loader loads it
        const b = run.boot, viaBoot = b?.after != null, media = b?.from === 'disk' ? 'disk' : 'tape';
        const loads = b && viaBoot ? ` A loader on the ${media} loads it: Sindri ran the ${media}'s boot file "${b.name}" (alone, from $${h4(b.alone.entry)}, it stopped: ${b.alone.stop.reason}).` : '';
        if (!run.unpacked || !run.saved) {
          const stop = `${run.stop.reason}${run.stop.detail ? `, ${run.stop.detail}` : ''}`;
          // a program that ran as it is to where programs end up is not packed: nothing went wrong (a one-block intro)
          if (notPacked(run)) {
            setUnpacked({ ok: true, title: viaBoot ? `${f.name} is not packed:${loads} The program its loader started after loading it never jumped into code it wrote (it stopped: ${stop}). There is nothing to unpack; Unpack on the boot file "${b.name}" gives the program as its loader starts it.` : `${f.name} is not packed: Sindri ran it${f.vsf ? ' on from the snapshot' : ''}, and it never jumped into code it wrote (it stopped: ${stop}). There is nothing to unpack.`, output, label: 'Layer report' });
            toast(`${f.name} is not packed`, 'info');
            return;
          }
          setUnpacked({ ok: false, title: viaBoot ? `Sindri found nothing to unpack in ${f.name}:${loads} Nothing unpacked itself after its loader had loaded it (it stopped: ${stop}).` : `Sindri found nothing to unpack in ${f.name}: it stopped (${stop}) before a layer came off${b ? `, and the ${media}'s boot file "${b.name}", run too, never loaded it` : ''}.`, output, label: 'Layer report' });
          toast(`Sindri could not unpack ${f.name}`, 'err');
          return;
        }
        const names = packerNames(run);
        // a BASIC program starts with RUN: the analysis finds its SYS line itself
        const where = takeUnpacked(i, f, run.saved.prg, run.saved.basic ? null : run.saved.entry, run.saved.basic ? null : run.saved.port, run.saved.basic ? null : run.saved.io);
        setUnpacked({ ok: true, title: `Unpacked ${f.name}${names ? ` (${names})` : ''}${when}: ${where}.${loads}`, output, label: 'Layer report' });
      } catch (e) { toast(errorText(e), 'err'); } finally { setBuildBusy(null); }
      return;
    }
    if (!kr) return needDesktop();
    setBuildBusy(`Unpacking with ${unpackerName}`);
    try {
      const r = await kr.unpack({ name: f.name, prg: makePrg(f.load, f.bytes) });
      const output = `> ${r.argv.map(a => (/\s/.test(a) ? `"${a}"` : a)).join(' ')}\n${r.output.trim()}`;
      const label = `${unpackerName} output`;
      if (!r.ok || !r.prg) {
        setUnpacked({ ok: false, title: `${unpackerName} could not unpack ${f.name}: ${r.error ?? 'no result'}.`, output, label });
        toast(`${unpackerName} could not unpack ${f.name}`, 'err');
        return;
      }
      const where = takeUnpacked(i, f, r.prg, r.entry);
      setUnpacked({ ok: true, title: `Unpacked ${f.name} with ${unpackerName}${r.packer ? ` (${r.packer})` : ''}${when}: ${where}.`, output: `${output}\n\nKept ${r.name} from ${r.dir}`, label });
    } catch (e) { toast(errorText(e), 'err'); } finally { setBuildBusy(null); }
  };
  // Unpack packed files when they are opened: one at a time, once the analysis is of the project they are in and Sindri
  // has run them (an external unpacker goes by the analysis and what it identified); a file Sindri cannot unpack, or one
  // that is not packed, stays as it was opened
  const unpacking = useRef(false);
  useEffect(() => {
    if (!toUnpack.current.size || unpacking.current || rProject !== project) return;
    for (const id of [...toUnpack.current]) {
      const i = project.files.findIndex(f => f.id === id), f = project.files[i];
      if (!f || f.chip != null || f.vsf || tapeOf.current.get(id)?.header) { toUnpack.current.delete(id); continue; }
      const run = runs[runKey(f)];
      if (!external && !run) continue;
      toUnpack.current.delete(id);
      if (packing[i]?.verdict !== 'packed' || (!external && !(run?.unpacked && run.saved))) continue;
      unpacking.current = true;
      void unpackFile(i, true).finally(() => { unpacking.current = false; });
      return;
    }
  }, [rProject, project, runs, packing, external]); // eslint-disable-line react-hooks/exhaustive-deps
  /** `path`: the project file to open (Smart attach picked it), else a dialog asks */
  const openProject = async (path?: string) => {
    if (!kr) return needDesktop();
    try {
      await saveNow();
      const r = await kr.openProject(path ? { path } : undefined);
      if (r) { enter(r.project, r.home); resetView(); setExportDir(null); toast(`Opened the project ${r.home.name} (${r.home.dir})`, 'ok'); }
    } catch (e) { toast(errorText(e), 'err'); }
  };
  /* ---- Continue in the Assembler (spec 10.7): an Assembler project of the re-assembled program, its blocks marked ---- */
  const [asmContinue, setAsmContinue] = useState<AsmContinueInfo | null>(null);
  const startContinue = async () => {
    if (!kr) return needDesktop();
    if (asmMode) { toast('This is an Assembler project already', 'info'); return; }
    if (project.cart) { toast('A cartridge\'s sources build its image (a .crt): the Assembler builds and runs programs. Open a chip\'s program as a PRG to go on with it', 'warn'); return; }
    if (!project.files.length) { toast('There is no program to go on with: open one first', 'warn'); return; }
    try {
      const s = assemblerSources(A, project), start = await kr.assemblerStart();
      const base = project.name.replace(/\.[^.]*$/, '') || 'program';
      setAsmContinue({ name: `${base}-asm`, parent: start.parent, lang: s.lang, main: s.main, blocks: s.blocks, sources: s.sources.length });
    } catch (e) { toast(errorText(e), 'err'); }
  };
  const continueInAssembler = async (name: string, parent: string, lang: ScriptLang, git: boolean) => {
    if (!kr) return;
    await saveNow();
    // (written for the assembler chosen: the same program in its words)
    const p = { ...project, settings: { ...project.settings, assembler: lang === '64tass' ? '64tass' as const : 'kick' as const } };
    const s = assemblerSources(A, p);
    const made = createProject({ name, files: [], settings: { ...p.settings, deepAnalysis: false }, asm: { lang: s.lang, main: s.main } });
    const r = await kr.createProject({ name, parent, project: made, git });
    for (const [path, data] of Object.entries(s.files)) await kr.assemblerWrite({ dir: r.home.dir, path, ...(typeof data === 'string' ? { text: data } : { bytes: data }) });
    if (r.git?.ok) await ignoreOut(r.home.dir);
    setAsmContinue(null);
    enter(made, r.home); resetView(); setExportDir(null);
    toast(`${r.home.name} is an Assembler project of the program${gitNote(r).text}: ${s.main} is its main file, ${s.blocks === 1 ? 'a block' : `${s.blocks} blocks`} marked in its source; Run (F5) builds it and starts it in VICE`, 'ok');
  };
  /** a project file dropped on the window: its folder is not known, so it is work without a project */
  const openDroppedProject = (p: Project, name: string) => { leaveProject(); replace(p); resetView(); toast(`Opened project ${name} as work without a project: Save creates a project from it`, 'ok'); };
  const readDropped = async (list: FileList, add: boolean, at: string | null = null) => {
    const prgs: OpenedPrg[] = [];
    const disks: DiskSide[] = [];
    // a disk and a tape dropped together both stay (else the one dropped takes the other out)
    const both = Array.from(list).some(f => /\.[dg]64$/i.test(f.name)) && Array.from(list).some(f => /\.t(ap|64)$/i.test(f.name));
    // an Assembler project: the files are copied into its folder (a disk or a tape is put in the drive, as before)
    const copied: AsmDropped[] = [];
    for (const f of Array.from(list)) {
      if (asmMode && !/\.([dg]64|t(ap|64))$/i.test(f.name)) {
        try { copied.push({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) }); }
        catch { toast(`${f.name} was not copied: it is a folder (drop the files in it) or it could not be read`, 'warn'); }
        continue;
      }
      const buf = new Uint8Array(await f.arrayBuffer());
      try {
        if (/\.json$/i.test(f.name)) {
          const p = deserializeProject(JSON.parse(new TextDecoder().decode(buf)) as SerializedProject);
          if (!askFirst(f.name, !!home, () => later.current.openDroppedProject(p, f.name))) openDroppedProject(p, f.name);
          continue;
        }
        if (/\.[dg]64$/i.test(f.name)) { disks.push({ name: f.name, bytes: buf }); continue; }
        if (/\.t(ap|64)$/i.test(f.name)) { insertTapeBytes(f.name, null, buf, both); continue; }
        // a cartridge image (known by its header): the chips of its boot bank, with the image
        if (isCrt(buf)) { const o = openCartridge(f.name, buf); prgs.push(...o.files.map(x => ({ ...withId(x), cart: o.cart }))); continue; }
        // a .prg, or a VICE snapshot (known by its header)
        const o = openC64File(f.name, buf, { zeroPage: !!project.settings.snapshotZeroPage });
        prgs.push({ ...withId(o), ...(o.entries ? { entries: o.entries } : {}), ...(o.snapshot ? { snapshot: o.snapshot } : {}), ...(o.start != null ? { start: o.start } : {}) });
      } catch (e) { toast(errorText(e), 'err'); }
    }
    if (disks.length) {
      // (several disks of one release: its first side, the others after it; else the last one, as before)
      const names = disks.map(d => d.name), sidesAfter = (d: DiskSide) => nextSides(d.name, names);
      const first = disks.reduce((a, d) => (sidesAfter(d).length >= sidesAfter(a).length ? d : a));
      try { mountBytes(first.name, null, first.bytes, sidesAfter(first).map(n => disks.find(d => d.name === n)!), both); } catch (e) { toast(`${first.name}: ${errorText(e)}`, 'err'); }
    }
    if (copied.length) useAsmLink.getState().request('drop', { files: copied, at });
    addFiles(prgs, add);
  };
  useEffect(() => {
    const over = (e: DragEvent) => { if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) { e.preventDefault(); setDropping(true); } };
    const leave = (e: DragEvent) => { if (!e.relatedTarget) setDropping(false); };
    // (in an Assembler project, the folder or file of the file list it was dropped on)
    const listed = (e: DragEvent) => (e.target instanceof Element ? e.target.closest('[role="treeitem"][data-path]')?.getAttribute('data-path') ?? null : null);
    const drop = (e: DragEvent) => { e.preventDefault(); setDropping(false); if (e.dataTransfer?.files.length) void readDropped(e.dataTransfer.files, e.shiftKey, listed(e)); };
    window.addEventListener('dragover', over); window.addEventListener('dragleave', leave); window.addEventListener('drop', drop);
    return () => { window.removeEventListener('dragover', over); window.removeEventListener('dragleave', leave); window.removeEventListener('drop', drop); };
  });
  // (an Assembler project's folder is watched for its Assembler tab, which reads what changed: nothing to say)
  useEffect(() => kr?.onFsChanged(e => { if (!useProject.getState().present.asm) toast(`Changed outside the app: ${e.path}`, 'info'); }), [toast]);

  /* ---- edits ---- */
  const curLine: ListingLine | null = cursor != null && lineOf[cursor] >= 0 ? view.lines[lineOf[cursor]] : null;
  /** the bytes a listing line stands for; a block header stands for its whole block */
  const lineRange = (l: ListingLine): Range | null => {
    if (l.k === 'hdr') { const b = A.blocks[l.blk]; return b ? { start: b.start, end: b.end } : null; }
    if (l.k === 'file' || l.k === 'blank') return null;
    return { start: l.a, end: l.a + Math.max(1, 'n' in l ? l.n : 0) };
  };
  /** Shift+click, Shift+arrows and dragging: extend the selection to line `l` */
  const extendTo = (l: ListingLine): boolean => {
    const r = lineRange(l); if (!r) return false;
    const from = curLine ? lineRange(curLine) : cursor != null ? { start: cursor, end: cursor + 1 } : null;
    setSel(s => extendSel(s, from, r));
    return true;
  };
  /** a byte (or word) picked in a data line: the cursor goes to it, and it is the selection; `extend` (Shift): the
   *  selection runs from what was picked first to it, byte by byte */
  const pickCell = (c: Cell, extend = false, history = false) => {
    navigate(c.a, { noHistory: !history, keepSel: true });
    const r = { start: c.a, end: c.a + c.n };
    if (!extend) { setSel({ ...r, multi: true, anchor: r.start, anchorEnd: r.end, bytes: true }); return; }
    // from what the selection picked first, else from the byte or line at the cursor
    const anchor = sel?.anchor != null ? { start: sel.anchor, end: sel.anchorEnd ?? sel.anchor + 1 } : cursorItem();
    setSel({ ...extendSel(null, anchor, r), bytes: true });
  };
  /** a drag from byte `from`: to byte `to` of its line, or (`to` null) onto line `l`, which selects whole lines */
  const dragCells = (from: Cell, to: Cell | null, l: ListingLine) => {
    if (to) {
      const s = Math.min(from.a, to.a), e = Math.max(from.a + from.n, to.a + to.n);
      setSel({ start: s, end: e, multi: true, anchor: from.a, anchorEnd: from.a + from.n, bytes: true });
      setCursor(to.a);
      return;
    }
    const at = view.lines[lineOf[from.a]], r0 = at ? lineRange(at) : null, r = lineRange(l);
    if (!r0 || !r) return;
    setSel(extendSel(null, r0, r));
    setCursor(l.a);
  };
  /** the byte (or word) at the cursor when the selection is of bytes, else the cursor's line: what S, J and Shift+J
   *  start from */
  const cursorItem = (): Range | null => {
    if (cursor == null) return null;
    const c = sel?.bytes ? cellAt(curLine, cursor) : null;
    if (c) return { start: c.a, end: c.a + c.n };
    return curLine ? lineRange(curLine) : { start: cursor, end: cursor + 1 };
  };
  /* a block whose type changed: the cursor goes to its start, and once the listing has the new lines it shows that
     start where it was on screen (else a third of the way down) and frames the block a moment */
  const [changed, setChanged] = useState<Changed | null>(null);
  const pendingChange = useRef<{ start: Addr; end: Addr; label: string; y: number | null } | null>(null);
  const showChanged = (start: Addr, end: Addr, label: string) => {
    const el = listRef.current, i = lineOf[start], y = el && i >= 0 ? i * ROW - el.scrollTop : -1;
    pendingChange.current = { start, end, label, y: el && y >= 0 && y + ROW <= el.clientHeight ? y : null };
    setChanged(null);
    setCursor(start);
    setSel(s => (s?.multi ? s : null));
  };
  useLayoutEffect(() => {
    const p = pendingChange.current;
    // another edit (an undo, say) takes the frame away
    if (!p) { setChanged(null); return; }
    // the analysis of the edit (or of a later one) is in
    if (rProject !== useProject.getState().present) return;
    pendingChange.current = null;
    setScrollReq({ addr: p.start, center: false, n: Date.now(), ...(p.y != null ? { y: p.y } : {}) });
    setChanged({ start: p.start, end: p.end, label: p.label, at: Date.now() });
  }, [rProject]);
  /** where the listing goes once the analysis of an edit is in (the line after bytes that became junk): `y` is the
   *  line's place on screen, null for a third down */
  const pendingGo = useRef<{ addr: Addr; y: number | null } | null>(null);
  useLayoutEffect(() => {
    const p = pendingGo.current;
    if (!p || rProject !== useProject.getState().present) return;
    pendingGo.current = null;
    setScrollReq({ addr: p.addr, center: false, n: Date.now(), ...(p.y != null ? { y: p.y } : {}) });
  }, [rProject]);
  useEffect(() => { if (!changed) return; const t = setTimeout(() => setChanged(null), CHANGED_MS); return () => clearTimeout(t); }, [changed]);
  const targetRange = () => {
    if (sel && sel.multi && sel.end > sel.start) return sel;
    if (cursor == null) return null;
    const b = findBlock(A.blocks, cursor); if (!b) return null;
    return { start: curLine && curLine.a != null ? curLine.a : cursor, end: b.end };
  };
  /** `name`: a text is named by its first word (the Memory tab), unless its start has a name you gave it; `bytes`:
   *  the selection the range is, when it was picked byte by byte (by default the selection's, without a range); `mc`:
   *  Multicolor where the bytes were seen (the Graphics tab), which sprites, a charset or a bitmap are then drawn as */
  const mark = (id: string, range?: { start: Addr; end: Addr }, opts?: { name?: boolean; bytes?: Sel | null; mc?: boolean }) => {
    const s = opts?.bytes !== undefined ? opts.bytes : !range && sel?.bytes ? sel : null;
    const r0 = range || targetRange(); if (!r0) return;
    // bytes picked in a line: one byte as Code starts the code there, to the end of its block, and as Words is a word
    // with the byte after it; the parts of the blocks around them keep their types
    const one = !!s?.bytes && s.anchor === r0.start && s.anchorEnd === r0.end, b0 = findBlock(A.blocks, r0.start);
    const r = one && id === 'code' && b0 ? { start: r0.start, end: Math.max(r0.end, b0.end) }
      : one && id === 'words' && r0.end - r0.start === 1 && A.owner[r0.start + 1] === A.owner[r0.start] ? { start: r0.start, end: r0.start + 2 } : r0;
    const rl = A.relocs.find(x => x.start < r.end && r.start < x.end);
    if (rl) { toast(`$${h4(rl.start)}–$${h4(rl.end - 1)} runs at $${h4(rl.to)}: mark its bytes there, on the lines inside ${words.pseudopc}`, 'warn'); return; }
    // Auto merge (Settings → General): the blocks of that type right before and after the range join it
    // sprites, a charset or a bitmap marked where they were seen (the Graphics tab): drawn in the listing as there
    const mo = markOverride(A, r.start, r.end, id, useUi.getState().autoMerge), o = opts?.mc != null ? markMc(A, mo.override, opts.mc) : mo.override;
    const keep = s?.bytes ? keepCutTypes(A, o.start, o.end) : [];
    const m = MARK_AS.find(x => x.id === id), enc = m?.props?.enc, what = m ? m.label : id;
    const mcText = opts?.mc && (o.type === 'sprite' || o.type === 'charset' || o.type === 'bitmap') ? ' (multicolour)' : '';
    const name = opts?.name && enc && !mo.prev && !R.labels.get(r.start)?.user ? textLabel(A.mem, r.start, r.end, enc.startsWith('screen'), enc.endsWith('mixed'), n => nameTaken(n, r.start)) : null;
    // the analysis merges every block (and earlier override) inside the range into the new one; code stays split per
    // routine unless it is merged with the code next to it
    const merged = id === 'code' && !o.props?.one ? 0 : A.blocks.filter(b => b.start < o.end && b.end > o.start).length;
    const side = mo.prev && mo.next ? 'blocks before and after it' : mo.prev ? 'block before it' : mo.next ? 'block after it' : '';
    update(`Mark $${h4(r.start)}-$${h4(r.end - 1)} as ${what}${mcText}${side ? ` with the ${what} ${side}` : ''}${name ? ` named ${name}` : ''}`, d => {
      d.overrides.push(...keep, o);
      if (name) d.labels[r.start] = name;
    });
    toast(side ? `$${h4(r.start)}–$${h4(r.end - 1)} marked as ${what}${mcText} and merged with the ${what} ${side}: one block $${h4(o.start)}–$${h4(o.end - 1)}${merged > 1 ? ` (${merged} blocks)` : ''}`
      : `$${h4(r.start)}–$${h4(r.end - 1)} marked as ${what}${mcText}${name ? `, named ${name}` : ''}${merged > 1 ? `, merging ${merged} blocks into one` : ''}`, 'ok');
    showChanged(o.start, o.end, side ? `Marked as ${what} and merged` : `Marked as ${what}`);
  };
  /** Mark as from the Graphics tab's bitmaps drawn narrower than a bitmap: the bytes drawn, a stretch per character row,
   *  each a block of its own, so the bytes between them (code beside a logo, say) keep their types; one undo step */
  const markPieces = (id: string, pieces: Range[], mc?: boolean) => {
    if (pieces.length < 2) { if (pieces[0]) mark(id, pieces[0], { mc }); return; }
    const rl = A.relocs.find(x => pieces.some(p => x.start < p.end && p.start < x.end));
    if (rl) { toast(`$${h4(rl.start)}–$${h4(rl.end - 1)} runs at $${h4(rl.to)}: mark its bytes there, on the lines inside ${words.pseudopc}`, 'warn'); return; }
    const m = MARK_AS.find(x => x.id === id), what = m ? m.label : id;
    const os = pieces.map(p => { const o = markOverride(A, p.start, p.end, id, false).override; return mc != null ? markMc(A, o, mc) : o; });
    const mcText = mc && (os[0].type === 'sprite' || os[0].type === 'charset' || os[0].type === 'bitmap') ? ' (multicolour)' : '';
    const first = pieces[0], last = pieces[pieces.length - 1], n = pieces.length;
    update(`Mark ${n} stretches in $${h4(first.start)}-$${h4(last.end - 1)} as ${what}${mcText}`, d => { d.overrides.push(...os); });
    toast(`${n} stretches in $${h4(first.start)}–$${h4(last.end - 1)} marked as ${what}${mcText}, one a character row: the bytes between them keep their types`, 'ok');
    showChanged(first.start, last.end, `Marked as ${what}`);
  };
  /** Unmark (the Graphics tab): the graphics blocks in `r`, cut to it, become data; the rest of a block it cuts keeps
   *  its type and the other blocks in it stay as they are (gfxToData) */
  const unmark = (r: Range) => {
    const u = gfxToData(A, r.start, r.end, useUi.getState().autoMerge);
    if (!u.parts.length) { toast(`$${h4(r.start)}–$${h4(r.end - 1)} has no graphics to unmark`, 'warn'); return; }
    const rl = A.relocs.find(x => u.parts.some(p => x.start < p.end && p.start < x.end));
    if (rl) { toast(`$${h4(rl.start)}–$${h4(rl.end - 1)} runs at $${h4(rl.to)}: mark its bytes there, on the lines inside ${words.pseudopc}`, 'warn'); return; }
    const span = (p: Range) => `$${h4(p.start)}–$${h4(p.end - 1)}`;
    // named as Mark as names them (Sprite data, Screen matrix)
    const kinds = [...new Set(u.parts.flatMap(p => p.blocks.map(b => MARK_AS.find(m => m.id === markIdOf(b))?.label ?? kindInfo(b.type).label)))].join(', ');
    const many = u.parts.length > 1, where = many ? `${u.parts.length} stretches of graphics in $${h4(r.start)}–$${h4(r.end - 1)}` : span(u.parts[0]);
    const first = u.parts[0], last = u.parts[u.parts.length - 1];
    update(`Unmark ${where.replace('–', '-')} (${kinds}): data`, d => { d.overrides.push(...u.overrides); });
    toast(`${where} ${many ? 'are' : 'is'} data now (${many ? 'were' : 'was'} ${kinds})${u.merged.length ? `, one block with the data next to it` : ''}`, 'ok');
    showChanged(Math.min(first.start, ...u.merged.map(b => b.start)), Math.max(last.end, ...u.merged.map(b => b.end)), 'Unmarked: data');
  };
  /** a data, table or word block's number format and items a row (an override like the block, with them) */
  const setFormat = (b: Block, change: { fmt?: NumberFormat | null; row?: number | null; mc?: boolean | null }) => {
    const what = change.mc !== undefined ? (change.mc == null ? 'colours as the VIC registers say' : change.mc ? 'multicolour' : 'hires') : change.fmt !== undefined ? `${change.fmt === 'bin' ? 'binary' : change.fmt === 'dec' ? 'decimal' : change.fmt === 'hex' ? 'hex' : 'addresses'} numbers` : `${change.row ?? 'default'} a row`;
    update(`$${h4(b.start)}-$${h4(b.end - 1)}: ${what}`, d => { d.overrides.push(formatOverride(b, change, d.overrides)); });
    showChanged(b.start, b.end, what[0].toUpperCase() + what.slice(1));
  };
  /** a sprite block's colours, picked in the inspector's enlarged sprite (null: the Graphics tab's again): the listing
   *  draws its sprites in them. The cursor stays where it is (the palette is clicked through) */
  const setSpriteColors = (b: Block, colors: SpriteColors | null) => {
    const what = colors ? `sprite colours ${C64_NAMES[colors.sprite]} on ${C64_NAMES[colors.bg]}` : "the Graphics tab's colours";
    update(`$${h4(b.start)}-$${h4(b.end - 1)}: ${what}`, d => { d.overrides.push(formatOverride(b, { colors }, d.overrides)); });
  };
  /** Multicolor switched in the Graphics tab with `r` selected: the sprites, charsets or bitmaps of the type its `view`
   *  draws that the selection is in are drawn so in the listing too (their setting, as the inspector's Multicolor) */
  const setGfxMc = (r: Range, view: string, mc: boolean) => {
    const ch = gfxMcChanges(A, view, r.start, r.end, mc);
    if (!ch.length) return;
    const what = mc ? 'multicolour' : 'hires', span = (b: Block) => `$${h4(b.start)}–$${h4(b.end - 1)}`;
    update(`${ch.map(c => span(c.b).replace('–', '-')).join(', ')}: ${what}`, d => { for (const c of ch) d.overrides.push(formatOverride(c.b, { mc: c.mc }, d.overrides)); });
    toast(`${kindInfo(ch[0].b.type).label} ${ch.map(c => span(c.b)).slice(0, 3).join(', ')}${ch.length > 3 ? ` and ${ch.length - 3} more` : ''} drawn ${what} in the listing too`, 'ok');
  };
  /** the code in `r` runs with this $01 value / VIC bank; null returns it to detection */
  const setBankZone = (r: Range, part: 'port' | 'vicBank', v: number | null) => {
    const what = part === 'port' ? (v == null ? 'the detected $01' : `$01 = ${portName(v)} (${portText(v, A.mcfg?.cart)})`) : (v == null ? 'the detected VIC bank' : `VIC bank ${v} (${bankRange(v)})`);
    update(`$${h4(r.start)}-$${h4(r.end - 1)} runs with ${what}`, d => { d.bankZones.push({ start: r.start, end: r.end, [part]: v }); });
    toast(`$${h4(r.start)}–$${h4(r.end - 1)} runs with ${what}`, 'ok');
  };
  /** one block of the type of the block at `at` (default: the cursor) and its neighbour before or after it */
  const mergeBlock = (dir: 'prev' | 'next', at?: Addr) => {
    const a = at ?? cursor; if (a == null) return;
    const m = mergeOverride(A, a, dir);
    if (!m) { toast(`There is no ${dir === 'prev' ? 'previous' : 'next'} block in this file to merge with`, 'warn'); return; }
    const o = m.override, what = kindInfo(m.into).label;
    update(`Merge $${h4(o.start)}-$${h4(o.end - 1)} into one ${what} block`, d => { d.overrides.push(o); });
    toast(m.into === 'code' ? `$${h4(o.start)}–$${h4(o.end - 1)} marked as Code (code stays split per routine)` : `$${h4(o.start)}–$${h4(o.end - 1)} merged into one ${what} block`, 'ok');
    showChanged(o.start, o.end, m.into === 'code' ? 'Marked as Code' : `Merged into one ${what} block`);
  };
  /** a line at a block's edge was dragged into the neighbouring block (or the menu said so): its bytes join that block */
  const moveInto = (m: ByteMove) => {
    const what = m.end - m.start > 1 ? `$${h4(m.start)}-$${h4(m.end - 1)}` : `$${h4(m.start)}`, into = kindInfo(m.into.type).label;
    const start = Math.min(m.start, m.into.start), end = Math.max(m.end, m.into.end);
    update(`Move ${what} into the ${into} block`, d => { d.overrides.push(...m.overrides); if (m.rekey) moveBlockKeys(d, m.rekey.from, m.rekey.to); });
    setSel(null);
    showChanged(m.start, m.end, `Moved into the ${into} block`);
    toast(`${what.replace('-', '–')} moved into the ${into} block, now $${h4(start)}–$${h4(end - 1)}`, 'ok');
  };
  /** S: split the block at `at` (default: the byte or line at the cursor) in two blocks of its type */
  const splitAt = (at?: Addr) => {
    const a = at ?? cursorItem()?.start; if (a == null) return;
    const s = splitBlock(A, a);
    if ('error' in s) { toast(`Cannot split here: ${s.error}`, 'warn'); return; }
    const b = s.block, what = kindInfo(b.type).label;
    update(`Split $${h4(b.start)}-$${h4(b.end - 1)} at $${h4(a)}`, d => { d.overrides.push(...s.overrides); });
    toast(`Split the ${what} block in two: $${h4(b.start)}–$${h4(a - 1)} and $${h4(a)}–$${h4(b.end - 1)}`, 'ok');
    showChanged(a, b.end, 'Split here');
  };
  /** J / Shift+J: the bytes from `item` (default: the bytes selected one by one, else the byte or line at the cursor)
   *  to the end of its block ('next'), or from its block's start to the end of it ('prev'), join the block next to them */
  const joinFrom = (dir: 'prev' | 'next', item?: Range | null) => {
    const it = item ?? (sel?.bytes ? { start: sel.start, end: sel.end } : cursorItem()); if (!it) return;
    const m = moveFrom(A, it.start, dir, it.end);
    if ('error' in m) { toast(`Cannot join the ${dir === 'prev' ? 'previous' : 'next'} block: ${m.error}`, 'warn'); return; }
    moveInto(m);
  };
  /** L: the Block size dialog for the block at `at` (default: the cursor) */
  const openBlockSize = (at?: Addr) => {
    const a = at ?? cursor; const b = a != null ? findBlock(A.blocks, a) : null;
    if (!b) { toast('Put the cursor in a block first', 'info'); return; }
    setSizeAt(b.start); setModal('size');
  };
  /** the Block size dialog was applied: the block has its new range, and the blocks next to it give or take the bytes */
  const resizeInto = (r: BlockResize) => {
    const b = r.block, what = kindInfo(b.type).label;
    update(`$${h4(b.start)}-$${h4(b.end - 1)} becomes $${h4(r.start)}-$${h4(r.end - 1)}`, d => { d.overrides.push(...r.overrides); for (const k of r.rekeys) moveBlockKeys(d, k.from, k.to); });
    setModal(null); setSizeAt(null); setSel(null);
    showChanged(r.start, r.end, `${r.end - r.start} bytes`);
    toast(`The ${what} block is $${h4(r.start)}–$${h4(r.end - 1)} (${r.end - r.start} bytes)`, 'ok');
  };
  /** a sprite block gets `n` sprites: its size in 64-byte steps from its start (a sprite pointer often shows only the
   *  first of the sprites that follow one another); the blocks after it give or take the bytes, as with Block size */
  const setSprites = (b: Block, n: number) => {
    if (n < 1 || b.start + n * 64 === b.end) return;
    const r = resizeBlock(A, b.start, b.start, b.start + n * 64, 'join');
    if ('error' in r) { toast(`${n} sprites from $${h4(b.start)} do not fit: ${r.error}`, 'warn'); return; }
    update(`$${h4(b.start)}: ${n} sprite${n === 1 ? '' : 's'}`, d => { d.overrides.push(...r.overrides); for (const k of r.rekeys) moveBlockKeys(d, k.from, k.to); });
    showChanged(r.start, r.end, `${n} sprite${n === 1 ? '' : 's'}`);
  };
  /** the Merge range dialog was confirmed: one block of the chosen type replaces every block in the range */
  const mergeRangeInto = (o: Override, label: string, replaced: number) => {
    update(`Merge $${h4(o.start)}-$${h4(o.end - 1)} into one ${label} block`, d => { d.overrides.push(o); });
    setModal(null);
    setSel(null);
    showChanged(o.start, o.end, `Merged into one ${label} block`);
    toast(`Merged ${replaced} block${replaced === 1 ? '' : 's'} into one ${label} block $${h4(o.start)}–$${h4(o.end - 1)}`, 'ok');
  };
  /** leave the block at `a` out of the build (it stays in the source under #if), or put it back */
  const toggleExcluded = (a: Addr) => {
    const b = findBlock(A.blocks, a); if (!b) return;
    const inRun = relocAt(A, b.start);
    if (inRun) { toast(`A block where a relocated block runs is written inside its ${words.pseudopc}, so it cannot be left out alone: leave out the whole relocated block ($${h4(inRun.start)})`, 'warn'); return; }
    const out = project.excluded.includes(b.start);
    update(`${out ? 'Include' : 'Exclude'} $${h4(b.start)}-$${h4(b.end - 1)} ${out ? 'in' : 'from'} the build`, d => { d.excluded = out ? d.excluded.filter(x => x !== b.start) : [...d.excluded, b.start]; });
    toast(out ? `$${h4(b.start)}–$${h4(b.end - 1)} is built again` : `$${h4(b.start)}–$${h4(b.end - 1)} is left out of the build (still in the source under #if)`, 'ok');
  };
  /* ---- a debugger's breakpoints and watches (spec 13.2b): kept in the project, and written into the debug info
     Build & Run in a debugger (Shift+F5) gives it. The analysis, the source and the output do not see them ---- */
  /** the breakpoint on the instruction at `a` is set, or removed */
  const toggleBreakpoint = (a: Addr) => {
    const l = R.lines.find(x => x.k === 'ins' && a >= x.a && a < x.a + x.n);
    if (!l) { toast('A breakpoint goes on an instruction: put the cursor on a line of code', 'warn'); return; }
    const at = l.a, on = !!project.breakpoints?.includes(at);
    update(`${on ? 'Remove' : 'Set'} breakpoint $${h4(at)}`, d => { const rest = (d.breakpoints ?? []).filter(x => x !== at), next = on ? rest : [...rest, at].sort((x, y) => x - y); d.breakpoints = next.length ? next : undefined; });
    toast(on ? `Breakpoint $${h4(at)} removed` : `Breakpoint at $${h4(at)}: ${debuggerName} stops there when Shift+F5 starts it`, 'ok');
  };
  /** the address `a` is put on the debugger's watch list, or taken off it */
  const toggleWatch = (a: Addr) => {
    const on = !!project.watches?.includes(a);
    update(`${on ? 'Stop watching' : 'Watch'} $${h4(a)}`, d => { const rest = (d.watches ?? []).filter(x => x !== a), next = on ? rest : [...rest, a].sort((x, y) => x - y); d.watches = next.length ? next : undefined; });
    toast(on ? `$${h4(a)} is no longer watched` : `$${h4(a)} is watched: ${debuggerName} shows it in its watch list when Shift+F5 starts it`, 'ok');
  };
  const clearDebugMarks = () => {
    const b = project.breakpoints?.length ?? 0, w = project.watches?.length ?? 0; if (!b && !w) return;
    update('Remove all breakpoints and watches', d => { d.breakpoints = undefined; d.watches = undefined; });
    toast(`${b} breakpoint${b === 1 ? '' : 's'} and ${w} watch${w === 1 ? '' : 'es'} removed (Ctrl+Z brings them back)`, 'ok');
  };
  const breakpointSet = useMemo(() => new Set(project.breakpoints ?? []), [project.breakpoints]);
  /** save the block at `a` as a binary file (data/<label>.bin, loaded with .import binary), or write it out again */
  const toggleBinary = (a: Addr) => {
    const b = findBlock(A.blocks, a); if (!b) return;
    const on = project.binary.includes(b.start), name = R.labels.get(b.start)?.name ?? `block_${h4(b.start)}`;
    update(`${on ? 'Write' : 'Save'} $${h4(b.start)}-$${h4(b.end - 1)} ${on ? 'in the source' : 'as a binary file'}`, d => { d.binary = on ? d.binary.filter(x => x !== b.start) : [...d.binary, b.start]; });
    toast(on ? `$${h4(b.start)}–$${h4(b.end - 1)} is written in the source again` : `$${h4(b.start)}–$${h4(b.end - 1)} is saved as data/${name}.bin and loaded with ${words.binary}`, 'ok');
  };
  /** 11.7: `r` is junk: the analysis takes its bytes as not loaded, so the listing, the source and the output do not
   *  have them; the Explorer's Junk list puts them back */
  const markJunk = (want: { start: Addr; end: Addr }) => {
    // trimmed to the bytes that are loaded (or junk already); a relocated block's bytes cannot be junk
    const r = junkPlan(A, project.junk, want.start, want.end);
    if ('error' in r) { toast(`${r.error[0].toUpperCase()}${r.error.slice(1)}`, 'warn'); return; }
    // the cursor goes to the byte after it (a block starts there once it is junk), else to the file's next block
    const n = r.bytes, file = A.owner[r.start] >= 0 ? A.owner[r.start] : A.owner[r.end - 1];
    const after = file >= 0 && A.owner[r.end] === file ? r.end : A.blocks.find(b => b.start >= r.end && A.owner[b.start] === file)?.start;
    // once its analysis is in, the listing shows that line where the junk began on screen (or a third down)
    const el = listRef.current;
    let i = lineOf[r.start] ?? -1;
    for (let a = r.start - 1; i < 0 && a >= 0 && r.start - a < 64; a--) i = lineOf[a] ?? -1;
    const y = el && i >= 0 ? i * ROW - el.scrollTop : -1;
    pendingGo.current = after != null ? { addr: after, y: el && y >= 0 && y + ROW <= el.clientHeight ? y : null } : null;
    update(`Mark $${h4(r.start)}-$${h4(r.end - 1)} as junk`, d => { d.junk = addJunk(d.junk, r.start, r.end); });
    setSel(null);
    if (after != null) setCursor(after);
    toast(`$${h4(r.start)}–$${h4(r.end - 1)} is junk (${n} byte${n === 1 ? '' : 's'}): it is not in the listing, the source or the output. The Junk list in the Explorer puts it back`, 'ok');
  };
  /** Mark range as junk…: a start and an end, from `r`, else the selection, else from the cursor to its block's end */
  const openJunkRange = (r?: { start: Addr; end: Addr } | null) => {
    const b = cursor != null ? findBlock(A.blocks, cursor) : null;
    setJunkInit(r ?? (sel && sel.multi && sel.end > sel.start ? { start: sel.start, end: sel.end } : b && cursor != null ? { start: cursor, end: b.end } : null));
    setModal('junk');
  };
  /** a junk area is loaded again: the listing shows it, the source and the output have it */
  const includeJunk = (j: JunkArea) => {
    update(`Include $${h4(j.start)}-$${h4(j.end - 1)} again (no longer junk)`, d => { const rest = removeJunk(d.junk, j.start); if (rest.length) d.junk = rest; else d.junk = undefined; });
    showChanged(j.start, j.end, 'No longer junk');
    toast(`$${h4(j.start)}–$${h4(j.end - 1)} is back in the listing, the source and the output`, 'ok');
  };
  const includeAllJunk = () => {
    const n = project.junk?.length ?? 0; if (!n) return;
    update(`Include all ${n} junk area${n === 1 ? '' : 's'} again`, d => { d.junk = undefined; });
    toast(`${n} junk area${n === 1 ? ' is' : 's are'} back in the listing, the source and the output`, 'ok');
  };
  const clearOverride = (r?: { start: Addr; end: Addr }) => {
    const rr = r || targetRange(); if (!rr) return;
    update('Clear override', d => { d.overrides.push({ start: rr.start, end: rr.end, type: 'auto' }); });
    toast(`$${h4(rr.start)}–$${h4(rr.end - 1)} returned to automatic analysis`, 'ok');
    showChanged(rr.start, rr.end, 'Back to automatic analysis');
  };
  /* ---- relocated blocks: bytes the program copies elsewhere to run there (spec 8.1b) ---- */
  /** R: the relocated block where the range starts or the cursor is (where it is loaded or runs), else the selection,
   *  else the block at the cursor; `copyAt`: the copy loop the analysis found (a hint's Relocate button) */
  const startRelocate = (range?: Range | null, copyAt?: Addr) => {
    const c = copyAt != null ? A.copies.find(x => x.at === copyAt) : undefined;
    const r = c ?? range ?? (sel && sel.multi && sel.end > sel.start ? { start: sel.start, end: sel.end } : null);
    const at = r ? r.start : cursor;
    if (at == null) { toast('Select the bytes to relocate, or put the cursor in their block', 'info'); return; }
    // a range inside where a relocated block runs is relocated again from there; the cursor alone edits that block
    const rl = relocLoadedAt(A, at) ?? (r ? undefined : relocAt(A, at));
    if (rl) { setRelocDraft({ start: rl.start, end: rl.end, to: c && c.start === rl.start ? c.to : rl.to, reloc: rl, copyAt: c?.at ?? null }); setModal('reloc'); return; }
    const b = findBlock(A.blocks, at), span = r ?? (b ? { start: b.start, end: b.end } : null);
    if (!span) { toast(`$${h4(at)} is not part of any loaded file`, 'warn'); return; }
    const cp = c ?? A.copies.find(x => x.start <= span.start && span.end <= x.end);
    setRelocDraft({ start: span.start, end: span.end, to: cp ? cp.to + span.start - cp.start : null, copyAt: cp?.at ?? null });
    setModal('reloc');
  };
  const closeReloc = () => { setModal(null); setRelocDraft(null); setTimeout(() => listRef.current?.focus(), 0); };
  /** `junk`: the file's bytes where it runs, which become junk with it (a copy loop over them, RelocCopy.over) */
  const relocate = (r: Reloc, junk?: { start: Addr; end: Addr }) => {
    const n = r.end - r.start;
    update(`Relocate $${h4(r.start)}-$${h4(r.end - 1)} to run at $${h4(r.to)}`, d => { if (junk) d.junk = addJunk(d.junk, junk.start, junk.end); addReloc(d, r); });
    closeReloc(); setSel(null);
    toast(`$${h4(r.start)}–$${h4(r.end - 1)} runs at $${h4(r.to)}–$${h4(r.to + n - 1)}: traced and named there, and written inside ${words.pseudopc}${junk ? `; $${h4(junk.start)}–$${h4(junk.end - 1)}, which the file had there, is junk` : ''} (Ctrl+Z takes it back)`, 'ok');
    showChanged(r.to, r.to + n, `Relocated: runs at $${h4(r.to)}`);
  };
  /** the relocated block loaded at `start` runs at `to` instead */
  const runRelocAt = (start: Addr, to: Addr) => {
    const r = project.relocs.find(x => x.start === start); if (!r) return;
    const n = r.end - r.start;
    update(`$${h4(r.start)}-$${h4(r.end - 1)} runs at $${h4(to)}`, d => moveReloc(d, start, to));
    closeReloc();
    toast(`$${h4(r.start)}–$${h4(r.end - 1)} runs at $${h4(to)}–$${h4(to + n - 1)} now`, 'ok');
    showChanged(to, to + n, `Runs at $${h4(to)}`);
  };
  const unrelocate = (start: Addr) => {
    const r = project.relocs.find(x => x.start === start); if (!r) return;
    update(`Stop relocating $${h4(r.start)}-$${h4(r.end - 1)}`, d => removeReloc(d, start));
    closeReloc();
    toast(`$${h4(r.start)}–$${h4(r.end - 1)} is read where it is loaded again: its names and comments went back with it (Ctrl+Z relocates it again)`, 'ok');
    showChanged(r.start, r.end, 'No longer relocated');
  };
  /* ---- view offsets: bytes the listing shows at another address, for manual analysis (spec 10.4) ---- */
  const viewOffsets = project.viewOffsets ?? NO_OFFSETS;
  /** O: the view offset at the cursor (or the one given), else the selection, else the block at the cursor */
  const startViewOffset = (range?: Range | null) => {
    const r = range ?? (sel && sel.multi && sel.end > sel.start ? { start: sel.start, end: sel.end } : null);
    const at = r ? r.start : cursor;
    if (at == null) { toast('Select the bytes to show at another address, or put the cursor in their block', 'info'); return; }
    const o = viewOffsetAt(viewOffsets, at);
    if (o && (!r || (r.start === o.start && r.end === o.end))) { setVoffDraft({ start: o.start, end: o.end, offset: o }); setModal('voff'); return; }
    const b = findBlock(A.blocks, at), span = r ?? (b ? { start: b.start, end: b.end } : null);
    if (!span) { toast(`$${h4(at)} is not part of any loaded file`, 'warn'); return; }
    setVoffDraft({ start: span.start, end: span.end });
    setModal('voff');
  };
  const closeVoff = () => { setModal(null); setVoffDraft(null); setTimeout(() => listRef.current?.focus(), 0); };
  const applyViewOffset = (o: ViewOffset) => {
    const was = viewOffsets.some(x => x.start === o.start), n = o.end - o.start;
    update(was ? `Show $${h4(o.start)}-$${h4(o.end - 1)} at $${h4(o.to)} instead` : `Show $${h4(o.start)}-$${h4(o.end - 1)} at $${h4(o.to)}`, d => { d.viewOffsets = setViewOffset(d.viewOffsets, o); });
    closeVoff(); setSel(null);
    toast(`$${h4(o.start)}–$${h4(o.end - 1)} is shown at $${h4(o.to)}–$${h4(o.to + n - 1)} (offset ${shiftText(o)}) in the listing only: the .asm keeps it where it is loaded (Ctrl+Z takes it back)`, 'ok');
    showChanged(o.start, o.end, `Shown at $${h4(o.to)}`);
  };
  const removeOffset = (start: Addr) => {
    const o = viewOffsets.find(x => x.start === start); if (!o) return;
    update(`Show $${h4(o.start)}-$${h4(o.end - 1)} where it is loaded again`, d => { const rest = removeViewOffset(d.viewOffsets, start); d.viewOffsets = rest.length ? rest : undefined; });
    closeVoff();
    toast(`$${h4(o.start)}–$${h4(o.end - 1)} is shown where it is loaded again (Ctrl+Z shows it at $${h4(o.to)})`, 'ok');
    showChanged(o.start, o.end, 'Shown where it is loaded');
  };
  const removeAllOffsets = () => {
    const n = viewOffsets.length; if (!n) return;
    update(`Remove all ${n} view offset${n === 1 ? '' : 's'}`, d => { d.viewOffsets = undefined; });
    toast(`${n} view offset${n === 1 ? ' is' : 's are'} gone: the listing shows the bytes where they are loaded`, 'ok');
  };
  /** another address has the name, or a zero-page variable (they share the name space) */
  const nameTaken = (name: string, addr: Addr) => [...R.labels].some(([a, l]) => a !== addr && l.name === name) || [...R.zp].some(([a, z]) => a !== addr && !z.off && z.name === name);
  const rename = (addr: Addr, name: string): boolean => {
    // a name the project's assembler takes (64tass: not starting with _, which is local there, and not len, true …)
    if (name && !labelFor(asm, name, validLabel)) { setLabelError(asm === '64tass' ? 'Use letters, digits and _ only, start with a letter (64tass takes a name starting with _ as local), and avoid mnemonic and function names.' : 'Use letters, digits and _ only, start with a letter or _, and avoid mnemonic names.'); toast(`"${name}" is not a valid ${ASSEMBLERS[asm].name} label`, 'err'); return false; }
    for (const [a, l] of R.labels) if (a !== addr && l.name === name) { setLabelError(`"${name}" is already used at $${h4(a)}.`); toast(`"${name}" is already used at $${h4(a)}`, 'err'); return false; }
    // zero-page variables share the name space (a pointer's high byte is <name>+1, not a name of its own)
    for (const [a, z] of R.zp) if (a !== addr && !z.off && z.name === name) { setLabelError(`"${name}" is already the zero-page variable at $${h2(a)}.`); toast(`"${name}" is already the zero-page variable at $${h2(a)}`, 'err'); return false; }
    update(name ? `Rename $${h4(addr)} to ${name}` : `Restore label at $${h4(addr)}`, d => { if (name) d.labels[addr] = name; else delete d.labels[addr]; });
    learned.current = !!name && learnName(addr, name);
    return true;
  };
  /* ---- routines known from other projects (spec 10.5): a routine that is named leaves its fingerprint in the app's
   * library, and the routines of this project that the library knows get their names suggested ---- */
  const library = useRoutines(s => s.library);
  /** whether the last rename taught the library a routine (its message says so) */
  const learned = useRef(false);
  /** the routine at `addr` goes into the library as `name`, when it starts one and is enough to know again by */
  const learnName = (addr: Addr, name: string): boolean => {
    if (!useUi.getState().learnRoutines || !startsRoutine(A.entryKind.get(addr))) return false;
    const { library: lib, setLibrary } = useRoutines.getState();
    const next = learnRoutine(lib, routineAt(A, addr), name, project.name, Date.now());
    setLibrary(next);
    return next !== lib;
  };
  const knownHere = useMemo(() => knownRoutines(A, library), [A, library]);
  /** the names to suggest: where the user has given none, each a name the program does not have yet */
  const suggested = useMemo(() => routineSuggestions(knownHere, project.labels, a => R.labels.get(a)?.name,
    [...[...R.labels.values()].map(l => l.name), ...[...R.zp.values()].map(z => z.name)], n => labelFor(asm, n, validLabel)), [knownHere, project.labels, R, asm]);
  const nameKnown = (list: readonly RoutineMatch[] = suggested) => {
    if (!list.length) { toast(library.length ? 'No routine of this program is known from another project (or each has its name already)' : 'Mimir knows no routines yet: it learns the ones you name (N on a routine)', 'info'); return; }
    update(list.length === 1 ? `Name $${h4(list[0].addr)} ${list[0].name} (a known routine)` : `Name ${list.length} known routines`, d => { for (const m of list) d.labels[m.addr] = m.name; });
    toast(list.length === 1 ? `$${h4(list[0].addr)} is ${list[0].name} now${list[0].from ? `, as in ${list[0].from}` : ''}; Ctrl+Z takes it back` : `${list.length} routines have the names they had in other projects; Ctrl+Z takes it back`, 'ok');
  };
  /** the names of this project's routines go into the library (the ones named before Mimir learned, or while it was off) */
  const learnThisProject = () => {
    const { library: lib, setLibrary } = useRoutines.getState();
    const next = learnProject(lib, A, project.labels, project.name, Date.now());
    setLibrary(next);
    const n = next.filter(k => !lib.includes(k)).length;
    toast(n ? `Mimir learned ${n} routine${n === 1 ? '' : 's'} of this project: other projects get ${n === 1 ? 'its name' : 'their names'} suggested` : 'Nothing new to learn: the routines you named here are known, or too short to know again', n ? 'ok' : 'info');
  };
  const forgetKnown = (name: string) => {
    const n = useRoutines.getState().library.filter(k => k.name === name).length;
    useRoutines.getState().forget(name);
    toast(`Mimir no longer knows ${name}${n > 1 ? ` (${n} variants)` : ''}: it is not suggested again`, 'ok');
  };
  /** `$a` the low byte and `$a+1` the high byte of one 16-bit zero-page variable (`on`), or two variables
   *  (Project.zpPairs). As the analysis has them by itself the setting goes (unless a name on the high byte splits them) */
  const pairZp = (a: Addr, on: boolean) => {
    if (!zpPairable(a) || (R.zp.get(a + 1)?.off === 1) === on) return;
    const auto = A.zp.get(a + 1)?.off === 1 && !project.labels[a + 1];
    const name = R.zp.get(a)?.name ?? `zp_${h2(a)}`;
    update(on ? `Join $${h2(a)}/$${h2(a + 1)} into ${name}` : `Split ${name} into $${h2(a)} and $${h2(a + 1)}`, d => {
      const pairs = d.zpPairs ?? (d.zpPairs = {});
      if (on === auto) delete pairs[a]; else pairs[a] = on;
      if (!Object.keys(pairs).length) delete d.zpPairs;
    });
    toast(on ? `$${h2(a)} is the low byte and $${h2(a + 1)} the high byte of ${name}: the source writes ${name}+1 (Ctrl+Z splits them again)` : `$${h2(a)} and $${h2(a + 1)} are two variables again (Ctrl+Z joins them)`, 'ok');
  };
  /** the context menu's items that join or split the zero-page variable at `z` (the byte an instruction uses) */
  const zpPairItems = (z: Addr | null): MenuItem[] => {
    const zv = z != null ? R.zp.get(z) : undefined;
    if (z == null || !zv) return [];
    const lo = zv.off ? z - zv.off : z;
    if (R.zp.get(lo + 1)?.off === 1) return [{ label: `Split ${R.zp.get(lo)?.name ?? `$${h2(lo)}`} into two variables ($${h2(lo)} and $${h2(lo + 1)})`, run: () => pairZp(lo, false) }];
    const join = (a: Addr): MenuItem => ({ label: `Join $${h2(a)} (low byte) and $${h2(a + 1)} (high byte) into one 16-bit variable`, run: () => pairZp(a, true) });
    // `z` the high byte of the one before, or the low byte with the next one: neighbours the code uses that are in no
    // pair (the next byte also when neither is, as for a pointer the code only reads through)
    const back = zpPairable(z - 1) && R.zp.has(z - 1) && !R.zp.get(z - 1)!.off;
    const fwd = zpPairable(z) && (R.zp.has(z + 1) ? R.zp.get(z + 2)?.off !== 1 : !back);
    return [...(back ? [join(z - 1)] : []), ...(fwd ? [join(z)] : [])];
  };
  /** the zero-page byte an instruction line's operand is (null: none) */
  const zpOperand = (l: ListingLine): Addr | null => {
    if (l.k !== 'ins' || !(A.owner[l.a] >= 0)) return null;
    const d = decode(A.mem, l.a), m = d.info.mode;
    return d.v != null && d.v < 0x100 && m !== 'imm' && m !== 'rel' ? d.v : null;
  };
  const setComment = (addr: Addr, text: string) => update(`Comment at $${h4(addr)}`, d => { if (text) d.comments[addr] = text; else delete d.comments[addr]; });
  const setBlockComment = (addr: Addr, text: string) => { if ((project.blockComments[addr] || '') === text) return; update(`Block comment at $${h4(addr)}`, d => { if (text) d.blockComments[addr] = text; else delete d.blockComments[addr]; }); };
  /** how many empty lines `addr` has above its comment and labels (Project.blanks), and under its comment (Note.below) */
  const blanksAt = (addr: Addr) => ({ above: project.blanks?.[addr] ?? 0, under: project.notes[addr]?.below ?? 0 });
  /** `at`: the comment goes onto the address's empty line number `at` (counted from the top, those above and under the
   *  comment as one row): the empty lines before it stay above it, that one and the rest come under it. Without `at`
   *  it stays where it is; removed, its empty lines stay, above the line. `replace`: the comment takes empty line `at`'s
   *  place, one empty line fewer */
  const setNote = (addr: Addr, text: string, block: boolean, at?: number, replace = false) => {
    const old = project.notes[addr], { above, under } = blanksAt(addr);
    const drop = !!text && replace && at != null && at >= 0 && at < above + under, total = above + under - (drop ? 1 : 0);
    const k = !text ? total : at == null ? above : Math.max(0, Math.min(total, at));
    const same = !!old && old.text === text && !!old.block === block;
    if (old ? same && k === above && !drop : !text) return;
    const what = block ? 'comment block' : 'comment line', place = drop ? ' in place of an empty line' : '';
    update(!text ? `Remove comment above $${h4(addr)}` : same ? `Move ${what} above $${h4(addr)}${place}` : `${block ? 'Comment block' : 'Comment line'} above $${h4(addr)}${place}`, d => {
      if (text) d.notes[addr] = { text, ...(block ? { block } : {}), ...(total > k ? { below: Math.min(MAX_BLANKS, total - k) } : {}) };
      else delete d.notes[addr];
      putBlanks(d, addr, Math.min(MAX_BLANKS, k));
    });
  };
  /** DEL with the pointer resting on a comment in the listing (spec 10): the user's comment there goes, as one step
   *  Ctrl+Z takes back; one the analysis writes stays, and a toast says why. False: the pointer is on no comment, and
   *  DEL does what it does without one */
  const removeHoveredComment = (): boolean => {
    const row = listRef.current?.querySelector<HTMLElement>('.row[data-i]:hover');
    const l = row ? view.lines[Number(row.dataset.i)] : undefined;
    const c = row && l ? commentOf(l, !!row.querySelector('.src .cmt:hover')) : null;
    if (!c) return false;
    const back = ' (Ctrl+Z brings it back)', zpName = (a: Addr) => R.zp.get(a)?.name ?? `$${h2(a)}`;
    switch (c.kind) {
      case 'analysis':
        toast(c.line ? 'The analysis writes this comment line, so Delete leaves it: it removes the comments you wrote (; / * and the block\'s Comment in the inspector)' : 'The analysis writes this comment, so Delete leaves it: ; writes your own in its place', 'info');
        return true;
      case 'eol': {
        // (the listing may still show one just removed, until the analysis of the edit comes in)
        const at = c.addrs.filter(a => project.comments[a] != null);
        if (!at.length) return true;
        const where = at.map(a => `$${h4(a)}`).join(', ');
        update(`Remove comment${at.length > 1 ? 's' : ''} at ${where}`, d => { for (const a of at) delete d.comments[a]; });
        toast(`${c.zp ? `The comment of the zero-page variable ${zpName(at[0])}` : at.length > 1 ? `The comments at ${where}` : `The comment at $${h4(at[0])}`} removed${back}`, 'ok');
        return true;
      }
      case 'note': {
        const n = project.notes[c.addr];
        if (!n) return true;
        // its empty lines stay, above the line
        setNote(c.addr, '', !!n.block);
        toast(`The comment ${n.block ? 'block' : 'line'} above ${c.zp ? `the zero-page variable ${zpName(c.addr)}` : `$${h4(c.addr)}`} removed${back}`, 'ok');
        return true;
      }
      case 'block': {
        if (!project.blockComments[c.addr]) return true;
        update(`Remove block comment at $${h4(c.addr)}`, d => { delete d.blockComments[c.addr]; });
        toast(`The block's comment at $${h4(c.addr)} removed${back}`, 'ok');
        return true;
      }
    }
  };
  // `at`: the line the context menu was opened on (its closures were made before the cursor moved there)
  // a picture's line: the character, sprite or cell at the cursor
  const lineAddr = (at?: Addr) => at ?? (curLine && curLine.a != null && curLine.k !== 'gfx' ? curLine.a : cursor);
  /** `n` empty lines above `addr` (Project.blanks), above its comment lines and labels; `under`: under its comment
   *  (Note.below); 0 removes them */
  const setBlanks = (addr: Addr, n: number, under = false) => {
    if (under && !project.notes[addr]) return;
    const old = blanksAt(addr)[under ? 'under' : 'above'], k = Math.max(0, Math.min(MAX_BLANKS, n));
    if (k === old) return;
    const where = `${under ? 'under the comment ' : ''}above $${h4(addr)}`;
    update(k > old ? `Empty line ${where}` : `Remove ${old - k > 1 ? `${old - k} empty lines` : 'empty line'} ${where}`, d => {
      if (!under) putBlanks(d, addr, k);
      else if (k) d.notes[addr].below = k;
      else delete d.notes[addr].below;
    });
  };
  /** the line the empty line keys act on: the cursor line, not a zero-page variable's .label line in the file head */
  const blankLine = (at?: Addr): Addr | null => {
    if (at == null && pickedZp()) { toast('Empty lines go between the lines of the code and data, not among the zero-page variables', 'info'); return null; }
    return lineAddr(at) ?? null;
  };
  /** Shift+Enter: an empty line above the cursor line */
  const addBlank = (at?: Addr) => { const a = blankLine(at); if (a != null) setBlanks(a, blanksAt(a).above + 1); };
  /** Shift+Backspace: one empty line less above the cursor line (one inserted above a byte inside it too): one of those
   *  above its comment first, where Shift+Enter puts them, then one under it */
  const removeBlank = (at?: Addr) => {
    const a = blankLine(at); if (a == null) return;
    const l = at == null ? curLine : null, n = l && l.k !== 'gfx' && 'n' in l ? Math.max(1, l.n) : 1;
    const has = (p: Addr) => blanksAt(p).above + blanksAt(p).under > 0;
    let p = a; while (p < a + n - 1 && !has(p)) p++;
    const { above, under } = blanksAt(p);
    if (above) setBlanks(p, above - 1);
    else if (under) setBlanks(p, under - 1, true);
    else toast('There is no empty line above this line', 'info');
  };
  /** which of its address's empty lines (counted from the top) the user's empty line at `i` in the listing is */
  const blankIndex = (l: ListingLine, i: number) => {
    let n = 0;
    for (let k = i - 1; k >= 0 && view.lines[k].a === l.a; k--) { const x = view.lines[k]; if (x.k === 'blank' && x.user) n++; }
    return n;
  };
  /** a comment line or block written on one of the user's empty lines (`i` in the listing) goes there, between the
   *  empty lines before it and the rest; the comment the address has already moves there, to be edited. `replace`:
   *  the empty line becomes the comment (one empty line fewer) */
  const startNoteOn = (block: boolean, l: ListingLine, i: number, replace = false) => {
    const old = project.notes[l.a]?.text ?? '';
    setEditing({ kind: 'note', addr: l.a, value: block ? old : old.replace(/\s*\n\s*/g, ' '), block, blank: blankIndex(l, i), line: i, ...(replace ? { replace } : {}) });
    setUi({ tab: 'listing' });
  };
  /** the program starts at `a`; null clears it: the analysis uses the detected start (BASIC SYS or the load
   * address) again and Build & Run autostarts the program with RUN */
  const setStart = (a: Addr | null) => {
    if (project.entryPoint === a) return;
    // ($01 there was what Sindri saw at the start Unpack set)
    update(a == null ? 'Clear program start' : `Program start $${h4(a)}`, d => { d.entryPoint = a; d.entryPort = null; d.entryIo = null; });
    toast(a == null ? 'Program start cleared: Build & Run starts the program with RUN, and the analysis uses the detected start again' : `The program starts at $${h4(a)}; tracing from there`, 'ok');
    if (a != null) navigate(a, { center: true, listing: true });
  };
  /* ---- bookmarks: a title and a note per address, in the project file only ---- */
  /** the bookmark whose note the Bookmarks list shows, and the address the bookmark editor is open on (`end`: the
   *  area a new bookmark gets, the selection it was made from) */
  const [bmSel, setBmSel] = useState<Addr | null>(null);
  const [bmEdit, setBmEdit] = useState<{ at: Addr; end?: Addr } | null>(null);
  const showBookmarks = (a?: Addr) => {
    setUi({ activity: 'bookmarks', sidePanel: true });
    if (a !== undefined) setBmSel(a);
    if (window.matchMedia?.('(max-width: 900px)').matches) setDrawer('side');
  };
  /** the bookmark on the line of `a` (the line of a data row or a folded block holds several addresses), else `a` */
  const bookmarkOnLine = (a: Addr): Addr => {
    if (project.bookmarks[a] || lineOf[a] < 0) return a;
    for (const k of Object.keys(project.bookmarks)) if (lineOf[Number(k)] === lineOf[a]) return Number(k);
    return a;
  };
  /** the selection, when it takes in more than one line: a bookmark made from it is on that area */
  const selArea = (s: Sel | null = sel): Range | null => (s && s.multi && s.end > s.start && lineOf[s.start] >= 0 && lineOf[s.start] !== lineOf[s.end - 1] ? { start: s.start, end: s.end } : null);
  /** while the editor is open the listing selects the bookmark's area */
  const showBmArea = (start: Addr, end: Addr | null) => { if (end != null) setSel({ start, end, multi: true, anchor: start, anchorEnd: end }); else setSel(null); };
  /** the editor opens in the Bookmarks view, and the listing beside it shows the code at the address (and the area) */
  const openBookmarkEditor = (a: Addr, end?: Addr) => {
    const area = project.bookmarks[a] ? project.bookmarks[a].end : end;
    setBmEdit({ at: a, ...(project.bookmarks[a] || end == null ? {} : { end }) }); showBookmarks();
    navigate(a, { center: true, listing: true, noHistory: true, ...(area != null ? { end: area } : {}) });
    showBmArea(a, area ?? null);
  };
  /** a new bookmark made from a selection that takes in more than one line is on that area, from its first line */
  const startBookmark = (at?: Addr, area: Range | null = at == null ? selArea() : null) => {
    const a = area ? area.start : lineAddr(at);
    if (a == null) { toast('Put the cursor on a line in the listing first', 'warn'); return; }
    const on = bookmarkOnLine(a);
    openBookmarkEditor(on, area && on === area.start ? area.end : undefined);
  };
  const saveBookmark = (from: Addr, to: Addr, b: Bookmark) => {
    const old = project.bookmarks[from];
    setBmEdit(null); setBmSel(to);
    // the area is in its colour now: the selection that showed it goes
    if (b.end != null && sel && sel.start === to && sel.end === b.end) setSel(null);
    setTimeout(() => listRef.current?.focus(), 0);
    if (old && from === to && old.title === b.title && old.text === b.text && old.color === b.color && old.end === b.end) return;
    update(old ? `Bookmark ${bookmarkSpan(to, b)}` : `Add bookmark ${bookmarkSpan(to, b)}`, d => { delete d.bookmarks[from]; d.bookmarks[to] = b; });
    toast(old ? `Bookmark ${bookmarkSpan(to, b)} saved` : `Bookmark added at ${bookmarkSpan(to, b)}: Ctrl+B shows the list`, 'ok');
  };
  const deleteBookmark = (a: Addr) => {
    if (!project.bookmarks[a]) return;
    update(`Remove bookmark $${h4(a)}`, d => { delete d.bookmarks[a]; });
    if (bmEdit?.at === a) setBmEdit(null);
    toast(`Bookmark $${h4(a)} removed (Ctrl+Z brings it back)`, 'ok');
  };
  /** a jump to a bookmark goes to its first line; the listing shows as much of its area as fits */
  const bmNav = (a: Addr): NavOptions => { const end = project.bookmarks[a]?.end; return { center: true, listing: true, ...(end != null ? { end } : {}) }; };
  const goBookmark = (a: Addr) => {
    if (A.owner[a] < 0) { toast(`$${h4(a)} is not loaded: the file with this bookmark is not in the project`, 'warn'); return; }
    navigate(a, bmNav(a));
    setDrawer(null);
    setTimeout(() => listRef.current?.focus(), 0);
  };
  /** F2 / Shift+F2: the next / previous bookmark after the cursor line, round to the first / last */
  const jumpBookmark = (dir: 1 | -1) => {
    const all = bookmarkList(project.bookmarks).map(([a]) => a).filter(a => A.owner[a] >= 0);
    if (!all.length) { toast('No bookmarks yet: press B on a line to add one', 'info'); return; }
    const c = cursor ?? -1, here = c >= 0 ? lineOf[c] : -1;
    const other = (a: Addr) => here < 0 || lineOf[a] !== here;
    const a = dir > 0 ? (all.find(x => x > c && other(x)) ?? all[0]) : ([...all].reverse().find(x => x < c && other(x)) ?? all[all.length - 1]);
    navigate(a, bmNav(a));
    setBmSel(a);
    toast(`Bookmark $${h4(a)}: ${project.bookmarks[a].title}`, 'info');
  };
  /* ---- an Assembler project's bookmarks (10.7): on lines of its sources, as the re-assembler's on addresses; kept in
     its project file, moving with their lines as the code is edited (the Assembler tab says where they went) ---- */
  const asmBms = stored.asm?.bookmarks ?? NO_ASM_BOOKMARKS;
  /** the bookmark whose note the list shows, and the one the editor is open on (`id` null: a new one) */
  const [asmBmSel, setAsmBmSel] = useState<string | null>(null);
  const [asmBmEdit, setAsmBmEdit] = useState<{ id: string | null; file: string; line: number; end: number | null } | null>(null);
  const asmAsk2 = (what: 'bmAdd' | 'bmGo' | 'bmJump' | 'line' | 'codeLib' | 'dropImport', o?: { id?: string; dir?: 1 | -1; at?: string; line?: number; end?: number | null; libKind?: CodeLibKind; libInto?: string }) => { setUi({ tab: 'asm' }); useAsmLink.getState().request(what, o); };
  /* ---- the macro and code libraries (spec 10.8): the view, the dialog, an item put in the source ---- */
  const codeLibEditing = useCodeLib(s => s.editing);
  const codeLibExporting = useCodeLib(s => s.exporting);
  // (every macro counts: each of a file's)
  const codeLibCount = useCodeLib(s => s.listing?.items.reduce((n, i) => n + (i.kind === 'macro' ? i.macros?.length || 1 : 1), 0) ?? 0);
  // (a dialog of its own each time one opens)
  const codeLibKey = useMemo(() => uid(), [codeLibEditing]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (asmMode) void useCodeLib.getState().load(); }, [asmMode]);
  /** the libraries' view in the side panel (`search`: its search field focused) */
  const showCodeLib = (search = false) => { setUi({ activity: 'codelib', sidePanel: true }); if (narrow) setDrawer('side'); if (search) focusCodeLibSearch(); };
  /** an item put in the source where the Assembler's caret is (`call`: a macro's call, its parameters to type in; a
   *  macro's definition with those of its file it uses that the project does not define; `import`: a file's import
   *  line at the top of the source) */
  const insertCodeLib = (item: CodeLibEntry, how: CodeLibInsert) => {
    const lib = useCodeLib.getState().listing;
    setUi({ tab: 'asm' });
    if (how === 'import') {
      // (with / : both assemblers take it on Windows, and no \ is read as an escape)
      const dir = lib?.folders[item.kind] ?? '', path = `${dir}/${item.file}`.replace(/\\/g, '/');
      useAsmLink.getState().request('insert', { insert: { text: item.lang === '64tass' ? `.include "${path}"` : `#import "${path}"`, call: false, block: false, top: true, lang: item.lang, name: item.name, macro: null, library: CODE_LIB_TITLE[item.kind].lib } });
      return;
    }
    const m = itemMacro(item), call = how === 'call' && !!m;
    let text = call && m ? codeLibCall(m, item.lang, true) : item.code, name = item.name;
    const coll = !call && item.macro ? lib?.items.find(i => i.kind === item.kind && i.file === item.file) : undefined;
    if (coll?.macros && item.macro) {
      const there = useAsmLink.getState().macroDefined;
      const needs = codeLibNeeds(coll.macros, item.macro, item.lang).filter(n => !there(n));
      if (needs.length) { text = [...needs.map(n => coll.macros!.find(s => s.name === n)!.code), item.code].join('\n\n'); name = `${item.name} (with ${needs.join(', ')}, which it uses)`; }
    }
    useAsmLink.getState().request('insert', { insert: { text, call, block: !call && item.kind === 'macro', lang: item.lang, name, macro: m?.name ?? null, library: CODE_LIB_TITLE[item.kind].lib } });
  };
  /** the editor in the Bookmarks view: for the bookmark `id`, else a new one on the line (to `end`) */
  const openAsmBookmark = (at: { file: string; line: number; end: number | null; id: string | null }) => {
    const b = at.id ? asmBms[at.id] : undefined;
    setAsmBmEdit(b && at.id ? { id: at.id, file: b.file, line: b.line, end: b.end ?? null } : { id: null, file: at.file, line: at.line, end: at.end });
    showBookmarks();
  };
  const editAsmBookmark = (id: string) => { const b = asmBms[id]; if (!b) return; openAsmBookmark({ ...b, end: b.end ?? null, id }); asmAsk2('bmGo', { id }); };
  const saveAsmBookmark = (id: string | null, b: AsmBookmark) => {
    const key = id ?? newBookmarkId(), old = id ? asmBms[id] : undefined;
    setAsmBmEdit(null); setAsmBmSel(key);
    if (old && old.file === b.file && old.line === b.line && old.end === b.end && old.title === b.title && old.text === b.text && old.color === b.color) return;
    update(old ? `Bookmark ${asmBookmarkSpan(b)}` : `Add bookmark ${asmBookmarkSpan(b)}`, d => {
      if (!d.asm) return;
      const all = (d.asm.bookmarks ??= {}), x = all[key];
      if (!x) { all[key] = b; return; }
      // (the fields that changed, each: Ctrl+Z puts those back, not where the bookmark has moved with its line since)
      x.file = b.file; x.line = b.line; x.title = b.title; x.text = b.text;
      if (b.end != null) x.end = b.end; else delete x.end;
      if (b.color) x.color = b.color; else delete x.color;
    });
    toast(old ? `Bookmark ${asmBookmarkSpan(b)} saved` : `Bookmark added on ${asmBookmarkSpan(b)}: Ctrl+B shows the list`, 'ok');
  };
  const deleteAsmBookmark = (id: string) => {
    const b = asmBms[id]; if (!b) return;
    update(`Remove bookmark ${asmBookmarkSpan(b)}`, d => { if (!d.asm?.bookmarks) return; delete d.asm.bookmarks[id]; if (!Object.keys(d.asm.bookmarks).length) delete d.asm.bookmarks; });
    if (asmBmEdit?.id === id) setAsmBmEdit(null);
    toast(`Bookmark ${asmBookmarkSpan(b)} removed (Ctrl+Z brings it back)`, 'ok');
  };
  /** bookmarks that moved with their lines, and a file or folder renamed: kept as they are now, with no step to undo */
  const moveAsmBookmarks = (moved: Record<string, { line: number; end?: number }>) => useProject.getState().amend(d => {
    for (const [id, p] of Object.entries(moved)) { const x = d.asm?.bookmarks?.[id]; if (!x) continue; x.line = p.line; if (p.end != null) x.end = p.end; else delete x.end; }
  });
  const renameAsmBookmarks = (from: string, to: string) => useProject.getState().amend(d => {
    for (const x of Object.values(d.asm?.bookmarks ?? {})) if (x.file === from || x.file.startsWith(`${from}/`)) x.file = `${to}${x.file.slice(from.length)}`;
  });
  /* ---- patches: new code written over a range of the loaded bytes (spec 10.2) ---- */
  const patchSpan = (p: Patch) => `$${h4(p.start)}–$${h4(patchEnd(p) - 1)}`;
  /** the code of start..end as the listing writes it: its instructions and data, and the labels and comment lines in it */
  const rangeLines = (start: Addr, end: Addr): string[] => {
    const out: string[] = [];
    for (const l of R.lines) {
      if (l.k === 'file' || l.k === 'hdr' || l.a < start || l.a >= end) continue;
      if ((l.k === 'dir' && !l.n) || (l.k === 'cmt' && (l.zp != null || l.mark))) continue;
      out.push(lineText(l, S));
    }
    while (out.length && !out[0].trim()) out.shift();
    while (out.length && !out[out.length - 1].trim()) out.pop();
    return out;
  };
  const editPatch = (p: Patch) => {
    setPatchDraft({ start: p.start, end: p.end, name: p.name, source: p.source, lang: patchLang(p), fill: p.fill, over: p.over, cycles: !!p.cycles, id: p.id });
    setModal('patch');
  };
  /** P: the selection, else the line at the cursor (a range with a patch in it edits that patch) */
  const startPatch = (range?: Range | null) => {
    const r = range ?? (sel && sel.multi && sel.end > sel.start ? { start: sel.start, end: sel.end } : curLine && ('n' in curLine && curLine.n > 0 || curLine.k === 'hdr') ? lineRange(curLine) : null);
    if (!r) { toast('Select the lines to patch, or put the cursor on one', 'info'); return; }
    const hit = project.patches.filter(p => p.start < r.end && patchEnd(p) > r.start);
    if (hit.length === 1) { editPatch(hit[0]); return; }
    if (hit.length > 1) { toast(`The selection holds ${hit.length} patches (${hit.map(p => `"${p.name}"`).join(', ')}): edit them one at a time`, 'warn'); return; }
    if (A.owner[r.start] < 0) { toast(`$${h4(r.start)} is not part of any loaded file`, 'warn'); return; }
    // (in the project's language, as the listing writes the lines; 64tass needs .cpu "6502i" for an undocumented opcode)
    const ill = codeLang === '64tass' && R.lines.some(l => l.k === 'ins' && l.a >= r.start && l.a < r.end && OPC[A.mem[l.a]].ill);
    setPatchDraft({ start: r.start, end: r.end, name: `patch_${h4(r.start)}`, source: [...(ill ? ['        .cpu "6502i"'] : []), ...rangeLines(r.start, r.end)].join('\n'), lang: codeLang, fill: 'nop', over: false, cycles: false });
    setModal('patch');
  };
  const closePatch = () => { setModal(null); setPatchDraft(null); setTimeout(() => listRef.current?.focus(), 0); };
  const savePatchPlan = (plan: PatchPlan) => {
    const p = plan.patch, was = project.patches.some(x => x.id === p.id), w = withPatch(project, p);
    update(`${was ? 'Edit patch' : 'Patch'} "${p.name}" ${patchSpan(p)}`, d => { d.files = w.files; d.patches = w.patches; });
    closePatch();
    toast(p.off ? `Patch "${p.name}" saved; it is switched off (Explorer → Patches switches it on)`
      : `Patch "${p.name}" written over ${patchSpan(p)} (${p.bytes.length} byte${p.bytes.length === 1 ? '' : 's'}): the listing marks it, Ctrl+Z takes it back`, 'ok');
  };
  const removePatch = (p: Patch) => {
    const w = withoutPatch(project, p.id);
    update(`Remove patch "${p.name}"`, d => { d.files = w.files; d.patches = w.patches; });
    toast(`Patch "${p.name}" removed${p.off ? '' : `: ${patchSpan(p)} has its bytes back`}`, 'ok');
  };
  /** off: the bytes it wrote over come back, and it stays in the list; on: it is written again */
  const switchOnePatch = (p: Patch, on: boolean) => {
    const w = switchPatch(project, p.id, on);
    update(`Switch ${on ? 'on' : 'off'} patch "${p.name}"`, d => { d.files = w.files; d.patches = w.patches; });
    toast(on ? `Patch "${p.name}" is on: written over ${patchSpan(p)}` : `Patch "${p.name}" is off: ${patchSpan(p)} has its original bytes`, 'ok');
  };
  const savePatchPrg = async (p: Patch) => {
    if (!kr) return needDesktop();
    try {
      const r = await kr.saveFile({ name: patchFileName(p.name), bytes: patchPrg(p), title: `Save patch "${p.name}" as PRG` });
      if (r) toast(`Patch "${p.name}" saved to ${r.path} (loads at $${h4(p.start)})`, 'ok');
    } catch (e) { toast(`Save failed: ${errorText(e)}`, 'err'); }
  };

  /* ---- user scripts (spec 10.3): code that runs in Mimir (Kick Assembler or 64tass, the project's assembler's when
   * it is made); what a run changes in the program's bytes
   * goes into the program as the script's patches, the script's code never ---- */
  const userScripts = project.userScripts ?? [];
  /** the script running (the Scripts view's button has a spinner meanwhile) */
  const scriptRunning = useScripts(s => s.running);
  // the script editor in full screen (10.3): while the Scripts tab shows a script, the rest of the window is hidden
  const scriptsFull = useScripts(s => s.full) && tab === 'scripts' && userScripts.length > 0;
  const toggleScriptsFull = () => { const st = useScripts.getState(); st.set({ full: !st.full }); };
  const scriptsEnv = useMemo(() => scriptEnv(project, R, S, A.blocks, A.music), [project.files, project.cart, R, A, S.hexCase]); // eslint-disable-line react-hooks/exhaustive-deps
  /** what a script runs on: the program without what its earlier runs changed (a decryption runs on the bytes as they
   *  were, not on what it decrypted the last time) */
  const scriptEnvFor = (id: string) => { const { project: p, R: r, S: s, A: a } = latest.current; return scriptEnv({ ...p, ...withoutScriptPatches(p, id) }, r, s, a.blocks, a.music); };
  /** a script in the project (made, or copied from the library), shown in the Scripts tab */
  const addUserScript = (s: UserScript, what: string) => {
    update(`${what} "${s.name}"`, d => { d.userScripts = [...(d.userScripts ?? []), s]; });
    useScripts.getState().set({ selected: s.id, pad: 0, change: null });
    setUi({ tab: 'scripts' });
  };
  /** a new script; `lines`: code of the listing it starts with (the selection); `links`: addresses linked to it */
  const newUserScript = (lines: string[] = [], links: Addr[] = [], code?: UserScript['code']) => {
    const s: UserScript = { ...newScript(userScripts, lines, newId(), codeLang, code), ...(links.length ? { links } : {}) };
    if (code === 'js') {
      addUserScript(s, 'New JavaScript script');
      toast(`Script "${s.name}" made, in JavaScript. mem is the program's memory: what it changes there goes into the program and its .asm. Ctrl+Enter runs it`, 'ok');
      return;
    }
    addUserScript(s, 'New script');
    toast(`Script "${s.name}" made. Write its code and press Ctrl+Enter: what it changes in the program goes into the program and its .asm`, 'ok');
  };
  /** bytes of the program (the listing's or the source's selection) copied into a scratchpad as what a run starts it
   *  with: one of a script's (`pad`, its index: cut to its size), a new one there (`pad` null, placed like Add), or a
   *  new script with a new one (`id` null); the scratchpad is then shown */
  const copyIntoPad = (from: Addr, bytes: Uint8Array, id: string | null, pad: number | null) => {
    const n = bytes.length, where = `${n} byte${n === 1 ? '' : 's'} from $${h4(spaceAddr(from))}`;
    const show = (sid: string, i: number) => { useScripts.getState().set({ selected: sid, pad: i, outTab: 'pads', outFolded: false, ...(useScripts.getState().mode === 'compare' ? { mode: 'hex' as const } : {}) }); setUi({ tab: 'scripts' }); };
    if (id == null) {
      const base = newScript(userScripts, [], newId(), codeLang);
      const start = scriptPlace(scriptsEnv.files, n, checkScript(scriptsEnv, base).code)?.at ?? 0xc000;
      const s: UserScript = { ...base, pads: [{ name: 'pad1', start, size: n, data: bytes }] };
      addUserScript(s, 'New script with a scratchpad');
      show(s.id, 0);
      toast(`${where} copied into pad1 ($${h4(start)}) of the new script "${s.name}": a run starts it with them`, 'ok');
      return;
    }
    const s = userScripts.find(x => x.id === id); if (!s) return;
    if (pad == null) {
      const taken = [...(scriptChecks.get(id)?.code ?? []), ...s.pads.map(p => ({ start: p.start, end: p.start + p.size }))];
      const last = s.pads[s.pads.length - 1], name = padName(s.pads);
      const start = scriptPlace(scriptsEnv.files, n, taken, last ? last.start + last.size : undefined)?.at ?? 0xc000;
      editUserScript(id, { pads: [...s.pads, { name, start, size: n, data: bytes }] }, `Copy ${where} into a new scratchpad ${name} of "${s.name}"`);
      show(id, s.pads.length);
      toast(`${where} copied into the new scratchpad ${name} ($${h4(start)}) of "${s.name}": a run starts it with them`, 'ok');
      return;
    }
    const p = s.pads[pad]; if (!p) return;
    const { bytes: _b, src: _s, ...keep } = p;
    editUserScript(id, { pads: s.pads.map((x, k) => (k === pad ? { ...keep, data: bytes.slice(0, p.size) } : x)) }, `Copy ${where} into scratchpad ${p.name} of "${s.name}"`);
    show(id, pad);
    toast(n > p.size ? `${p.name} holds ${p.size} bytes: the first ${p.size} of the ${n} went in (make it bigger for all of them)` : `${where} copied into ${p.name} of "${s.name}": a run starts it with them`, n > p.size ? 'warn' : 'ok');
  };
  /** a block of the program copied into a scratchpad, written as its type is (blockPad: code as Kick Assembler, text as
   *  text, characters, sprites and bitmaps as `.byte` lines in their shape, other data as hex): into one of a script's
   *  (`pad`, its index; made as big as the block when there is room, else its first bytes in hex), a new one there
   *  (`pad` null), or a new script with a new one (`id` null) */
  const copyBlockIntoPad = (blockStart: Addr, id: string | null, pad: number | null) => {
    const b = A.blocks.find(x => x.start === blockStart); if (!b) return;
    const n = b.end - b.start, name = R.labels.get(b.start)?.name ?? `$${h4(spaceAddr(b.start))}`;
    const show = (sid: string, i: number) => { useScripts.getState().set({ selected: sid, pad: i, outTab: 'pads', outFolded: false, ...(useScripts.getState().mode === 'compare' ? { mode: 'hex' as const } : {}) }); setUi({ tab: 'scripts' }); };
    // (written in the script's language: the listing's lines as that assembler writes them, checked byte for byte)
    const typed = (at: Addr, pads: readonly ScriptPad[], lang: UserScript['lang'] = codeLang) => blockPad(b, R.lines, A.mem, at, scriptNames(scriptsEnv, pads), { ...S, assembler: asmOfLang(lang) });
    const said = (bp: BlockPad, padName: string, sname: string) => `Block ${name} ($${h4(spaceAddr(b.start))}-$${h4(spaceAddr(b.end - 1))}, ${n} bytes) copied into ${padName} of "${sname}" as ${bp.what}: a run starts it with them`;
    if (id == null) {
      const base = newScript(userScripts, [], newId(), codeLang), c = checkScript(scriptsEnv, base);
      const start = scriptPlace(scriptsEnv.files, n, [...c.code, ...c.access])?.at ?? 0xc000;
      const bp = typed(start, []);
      const s: UserScript = { ...base, pads: [{ name: 'pad1', start, size: n, data: bp.bytes, src: bp.src }] };
      addUserScript(s, 'New script with a scratchpad');
      show(s.id, 0);
      toast(said(bp, 'pad1', s.name), 'ok');
      return;
    }
    const s = userScripts.find(x => x.id === id); if (!s) return;
    const c = scriptChecks.get(id), others = (skip: number) => [...(c?.code ?? []), ...(c?.access ?? []), ...s.pads.filter((_, k) => k !== skip).map(p => ({ start: p.start, end: p.start + p.size }))];
    if (pad == null) {
      const last = s.pads[s.pads.length - 1], pn = padName(s.pads);
      const start = scriptPlace(scriptsEnv.files, n, others(-1), last ? last.start + last.size : undefined)?.at ?? 0xc000;
      const bp = typed(start, s.pads, s.lang);
      editUserScript(id, { pads: [...s.pads, { name: pn, start, size: n, data: bp.bytes, src: bp.src }] }, `Copy block ${name} into a new scratchpad ${pn} of "${s.name}"`);
      show(id, s.pads.length);
      toast(said(bp, `the new scratchpad ${pn} ($${h4(start)})`, s.name), 'ok');
      return;
    }
    const p = s.pads[pad]; if (!p) return;
    // as big as the block, when nothing of the script's is in the way
    const fits = p.size >= n || (p.start + n <= 0x10000 && !others(pad).some(r => r.start < p.start + n && p.start < r.end));
    const { bytes: _b, src: _s, data: _d, ...keep } = p;
    if (fits) {
      const bp = typed(p.start, s.pads, s.lang);
      editUserScript(id, { pads: s.pads.map((x, k) => (k === pad ? { ...keep, size: Math.max(p.size, n), data: bp.bytes, src: bp.src } : x)) }, `Copy block ${name} into scratchpad ${p.name} of "${s.name}"`);
      show(id, pad);
      toast(`${said(bp, p.name, s.name)}${n > p.size ? ` (${p.name} is ${n} bytes now)` : ''}`, 'ok');
      return;
    }
    const cut = A.mem.slice(b.start, b.start + p.size);
    editUserScript(id, { pads: s.pads.map((x, k) => (k === pad ? { ...keep, data: cut, src: { form: 'hex', text: padText(cut, 'hex', p.start) } } : x)) }, `Copy block ${name} into scratchpad ${p.name} of "${s.name}"`);
    show(id, pad);
    toast(`${p.name} holds ${p.size} bytes and cannot grow (something of the script's is after it): the first ${p.size} of block ${name}'s ${n} went in, as hex`, 'warn');
  };
  /** the menu that copies a block into a scratchpad, written as its type is: each script's, a new one in it, or a new
   *  script */
  const blockCopyMenu = (blockStart: Addr): MenuItem | null => {
    const b = A.blocks.find(x => x.start === blockStart); if (!b) return null;
    const name = R.labels.get(b.start)?.name ?? `$${h4(spaceAddr(b.start))}`, n = b.end - b.start;
    return { label: `Copy block ${name} into a scratchpad (as ${BLOCK_PAD_FORM[b.type] ?? 'hex'})`, icon: 'copy', children: [
      ...userScripts.flatMap((s, k): MenuItem[] => [
        ...(k ? [{ sep: true }] satisfies MenuItem[] : []),
        ...s.pads.map((p, j): MenuItem => ({ label: `${p.name} of "${s.name}" ($${h4(p.start)}, ${p.size} bytes)${p.size < n ? ', made bigger' : ''}`, run: () => copyBlockIntoPad(b.start, s.id, j) })),
        { label: `A new scratchpad in "${s.name}"`, run: () => copyBlockIntoPad(b.start, s.id, null) },
      ]),
      ...(userScripts.length ? [{ sep: true }] satisfies MenuItem[] : []),
      { label: 'A new script with a scratchpad', run: () => copyBlockIntoPad(b.start, null, null) },
    ] };
  };
  /** the menu that copies the program's bytes `start`..`end` into a scratchpad: each script's, a new one in it, or a
   *  new script */
  const padCopyMenu = (start: Addr, end: Addr): MenuItem => {
    const bytes = A.mem.slice(start, end), n = bytes.length;
    return { label: `Copy ${n} byte${n === 1 ? '' : 's'} into a scratchpad`, icon: 'copy', children: [
      // each item says its script: the source view shows them under the menu's own heading
      ...userScripts.flatMap((s, k): MenuItem[] => [
        ...(k ? [{ sep: true }] satisfies MenuItem[] : []),
        ...s.pads.map((p, j): MenuItem => ({ label: `${p.name} of "${s.name}" ($${h4(p.start)}, ${p.size} bytes)${p.size < n ? ': its first bytes only' : ''}`, run: () => copyIntoPad(start, bytes, s.id, j) })),
        { label: `A new scratchpad in "${s.name}"`, run: () => copyIntoPad(start, bytes, s.id, null) },
      ]),
      ...(userScripts.length ? [{ sep: true }] satisfies MenuItem[] : []),
      { label: 'A new script with a scratchpad', run: () => copyIntoPad(start, bytes, null, null) },
    ] };
  };
  /** a copy of a library script, under a name of its own in the project */
  const addLibraryScript = (l: LibraryScript) => {
    const name = userScripts.some(s => s.name.toLowerCase() === l.name.toLowerCase()) ? scriptName(userScripts, l.name) : l.name;
    // the routines it needs that are known from another project and have no name here yet get their names first
    const naming = suggested.filter(m => scriptFitsHere.get(l.name)?.naming.includes(m.name));
    if (naming.length) update(naming.length === 1 ? `Name $${h4(naming[0].addr)} ${naming[0].name} (a known routine)` : `Name ${naming.length} known routines`, d => { for (const m of naming) d.labels[m.addr] = m.name; });
    addUserScript({ id: newId(), name, lang: l.lang, ...(l.table ? { table: l.table } : {}), ...(l.when ? { when: l.when } : {}), ...(l.code ? { code: l.code } : {}), source: l.source, pads: l.pads.map(p => ({ ...p })), ...(l.safe ? { safe: true } : {}), ...(l.init ? { init: structuredClone(l.init) } : {}), ...(l.machine ? { machine: l.machine } : {}), ...(l.stopAt ? { stopAt: l.stopAt } : {}), ...(l.watch?.length ? { watch: l.watch.map(w => ({ ...w })) } : {}), ...(l.unwatch?.length ? { unwatch: [...l.unwatch] } : {}) }, 'Add script from the library');
    toast(`"${name}" added from the library: Ctrl+Enter runs it on this program${l.safe ? ' in safe mode (nothing goes into the program)' : ''}${naming.length ? `. ${naming.map(m => `$${h4(m.addr)} is ${m.name} now`).join(', ')}, as the script needs` : ''}`, 'ok');
  };
  /** the library's scripts, read from its folder when the app starts and when the Scripts tab is shown */
  const scriptLibrary = useScripts(s => s.library);
  useEffect(() => { if (tab === 'scripts' || !useScripts.getState().libraryDir) void useScripts.getState().loadLibrary(); }, [tab]);
  /** the library's scripts that fit this program: it has every name they need, as a label or as a routine known from
   *  another project (which adding the script names) */
  const scriptFitsHere = useMemo(() => {
    const names = new Set([...R.labels.values()].map(l => l.name)), known = new Set(suggested.map(m => m.name));
    const m = new Map<string, { naming: string[] }>();
    for (const l of scriptLibrary) { const f = scriptFits(l, n => names.has(n), n => known.has(n)); if (f.fits && !userScripts.some(s => s.name === l.name)) m.set(l.name, { naming: f.naming }); }
    return m;
  }, [scriptLibrary, R, suggested, userScripts]);
  /** the names the user gave in this program: a script saved to the library keeps those its code uses (what it needs) */
  const userNames = useMemo(() => new Set([...R.labels.values()].filter(l => l.user).map(l => l.name)), [R]);
  /** a copy of a template in the project (script-templates.ts): its code checked with its scratchpads out of the way,
   *  then each scratchpad placed where there is room, away from the code and from what the code reaches */
  const addTemplateScript = (t: ScriptTemplate) => {
    const name = scriptName(userScripts, t.name);
    const source = templateSource(t, codeLang);
    const c = checkScript(scriptsEnv, { source, lang: codeLang, code: t.code, pads: t.pads.map(p => ({ ...p, start: 0xffff, size: 1 })) });
    const pads: ScriptPad[] = [];
    for (const p of t.pads) {
      const taken = [...c.code, ...c.access, ...pads.map(q => ({ start: q.start, end: q.start + q.size }))];
      pads.push({ ...p, start: scriptPlace(scriptsEnv.files, p.size, taken)?.at ?? 0xc000 });
    }
    addUserScript({ id: newId(), name, lang: codeLang, ...(t.code ? { code: t.code } : {}), ...(t.safe ? { safe: true } : {}), source, pads }, 'Add template');
    // a JavaScript template: its settings are the place to start
    if (t.code === 'js') {
      useScripts.getState().set({ outTab: 'settings', outFolded: false });
      toast(`"${name}" added from the JavaScript templates: set its settings (the Settings tab) and press Ctrl+Enter${t.safe ? '. It is in safe mode: what the routine it calls writes is shown, not written' : ''}`, 'ok');
      return;
    }
    // what it decrypts goes into its scratchpad: the output shows the scratchpads
    if (pads.length) useScripts.getState().set({ outTab: 'pads', outFolded: false });
    toast(`"${name}" added from the templates: set its settings (source, dest, length, the key) and press Ctrl+Enter. With dest = result the program stays as it is`, 'ok');
  };
  /* ---- scripts the analysis suggests (script-suggest.ts): the program's loops that change bytes with a key, and a
     routine called as the program calls it ---- */
  const cryptLoops = useMemo(() => findCryptLoops(A), [A]);
  /** a script that does what a decryption loop does: the template for its method with its key (and, when the loop says
   *  them, its source and length) filled in, the result in the scratchpad `result`; linked to the loop */
  const addCryptScript = (l: CryptLoop) => {
    const cs = cryptScript(l, a => R.labels.get(a)?.name ?? null, codeLang);
    const name = scriptName(userScripts, `decrypt_${h4(spaceAddr(l.start))}`);
    const c = checkScript(scriptsEnv, { source: cs.source, lang: codeLang, pads: cs.pads.map(p => ({ ...p, start: 0xffff, size: 1 })) });
    const pads: ScriptPad[] = [];
    for (const p of cs.pads) {
      const taken = [...c.code, ...c.access, ...pads.map(q => ({ start: q.start, end: q.start + q.size }))];
      pads.push({ ...p, start: scriptPlace(scriptsEnv.files, p.size, taken)?.at ?? 0xc000 });
    }
    addUserScript({ id: newId(), name, lang: codeLang, source: cs.source, pads, links: [l.start] }, 'Add the script for a loop');
    // the editor shows what was filled in: the note about the loop, and the settings under it
    const found = cs.source.split('\n').findIndex(x => x.includes('Found in the program'));
    useScripts.getState().set({ outTab: 'pads', outFolded: false, ...(found >= 0 ? { gotoLine: found + 1 } : {}) });
    toast(cs.placed
      ? `"${name}" does what the loop at $${h4(spaceAddr(l.start))} does (${cryptStepsText(l.steps)}, ${cryptWhereText(l)}): Ctrl+Enter decrypts the bytes into the scratchpad result. The program stays as it is`
      : `"${name}" has the key of the loop at $${h4(spaceAddr(l.start))} (${cryptStepsText(l.steps)}): set source and length under settings (the code before the loop says where the bytes are), then Ctrl+Enter decrypts them into the scratchpad result`, 'ok');
  };
  /** a script that calls the routine at `at` as the program does: one JSR, with A, X and Y as the program's call loads
   *  them (its init). In safe mode: the routine's writes are shown, not written into the program */
  const addCallScript = (at: Addr) => {
    const k = scriptLinkOf(at), cs = callScript(A, at, k.name);
    const base = newScript(userScripts, [`        ${lineComment(codeLang)} ${cs.comment}`, cs.line], newId(), codeLang);
    addUserScript({ ...base, links: [at], safe: true, ...(cs.init ? { init: cs.init } : {}) }, 'New script that calls a routine');
    toast(`"${base.name}" calls ${k.name}${cs.init ? ` with ${(['a', 'x', 'y'] as const).filter(r => cs.init![r] != null).map(r => `${r.toUpperCase()} = $${h2(cs.init![r]!)}`).join(', ')}, as the program does at $${h4(spaceAddr(cs.from!))} (Init)` : ''}. It is in safe mode: Ctrl+Enter shows what the routine would change, and nothing goes into the program`, 'ok');
  };
  const editUserScript = (id: string, change: Partial<Pick<UserScript, 'name' | 'source' | 'lang' | 'pads' | 'links' | 'init' | 'watch' | 'unwatch' | 'machine' | 'stopAt' | 'table' | 'key' | 'when'>>, label: string) =>
    update(label, d => { const s = d.userScripts?.find(x => x.id === id); if (s) Object.assign(s, change); });
  /** safe mode on or off: on, the script's runs write nothing into the program (its .asm stays as it is) */
  const setScriptSafe = (id: string, on: boolean) => {
    const s = userScripts.find(x => x.id === id); if (!s || !!s.safe === on) return;
    update(`Safe mode ${on ? 'on' : 'off'} for "${s.name}"`, d => { const t = d.userScripts?.find(x => x.id === id); if (!t) return; if (on) t.safe = true; else delete t.safe; });
    const had = scriptPatches(project.patches, id).length > 0;
    toast(on ? `Safe mode on for "${s.name}": its runs leave the program and its .asm as they are, and show what they would change${had ? '. What its earlier runs wrote stays in (Take out removes it)' : ''}`
      : `Safe mode off for "${s.name}": what a run changes goes into the program and its .asm again`, 'ok');
  };
  /** the script goes, and what it changed goes out of the program with it */
  const removeUserScript = (id: string) => {
    const s = userScripts.find(x => x.id === id); if (!s) return;
    const n = scriptPatches(project.patches, id).length, w = withoutScriptPatches(project, id);
    update(`Delete script "${s.name}"`, d => { d.userScripts = (d.userScripts ?? []).filter(x => x.id !== id); d.files = w.files; d.patches = w.patches; });
    toast(`Script "${s.name}" deleted${n ? ', and what it changed taken out of the program' : ''} (Ctrl+Z brings it back)`, 'ok');
  };
  /** what the script changed taken out of the program (the script stays) */
  const takeOutScript = (id: string) => {
    const s = userScripts.find(x => x.id === id); if (!s) return;
    const w = withoutScriptPatches(project, id);
    update(`Take out what "${s.name}" changed`, d => { d.files = w.files; d.patches = w.patches; });
    toast(`What "${s.name}" changed is out of the program: the original bytes are back (Ctrl+Z puts it back; Run writes it again)`, 'ok');
  };
  /** a run ended: what it changed goes into the program as the script's patches (in place of its earlier ones, a change
   *  the user switched off staying off), what its scratchpads hold into the project, as one step */
  const ranUserScript = (id: string, run: ScriptRun, text: string) => {
    const { A: a, R: r, project: p, S: st } = latest.current;
    const s = p.userScripts?.find(x => x.id === id); if (!s) return null;
    const base = { ...p, ...withoutScriptPatches(p, id), settings: st };
    const w = writeScriptRun(a, r, base, s, run, scriptPatches(p.patches, id));
    // what its directives say beyond the bytes (.mark, .name, .note, .junk), in the same step
    const acts = scriptActsOf(id, text, run);
    // the snapshot it asked the project to keep (snapshot.write()), when the run ended well: in the same step
    const snap = run.snapshot && endedWell(run.end) ? run.snapshot.vsf : null;
    // and what it asked to be done with the project's scripts (scripts.add, edit, run): those added and changed in the
    // same step, those to run after it
    const plan = run.scripts?.length && endedWell(run.end) ? planScriptsRequests(p.userScripts ?? [], run.scripts, { lang: codeLang, id: newId }) : null;
    update(`Run script "${s.name}"`, d => {
      d.files = w.files; d.patches = w.patches;
      if (plan?.changed) d.userScripts = plan.scripts;
      if (snap) { const at = d.files.findIndex(x => x.vsf); if (at >= 0) d.files = d.files.map((x, i) => (i === at ? { ...x, vsf: snap } : x)); }
      if (acts) {
        d.overrides.push(...acts.overrides);
        for (const [at, name] of acts.labels) d.labels[at] = name;
        for (const [at, c] of acts.comments) d.comments[at] = c;
        if (acts.junk) d.junk = acts.junk;
        // what a JavaScript script's blocks asked for: comments above blocks, blocks in or out of the build, binary files
        for (const [at, c] of acts.blockComments) { if (c) d.blockComments[at] = c; else delete d.blockComments[at]; }
        for (const [at, on] of acts.excluded) d.excluded = on ? [...new Set([...d.excluded, at])] : d.excluded.filter(x => x !== at);
        for (const [at, on] of acts.binary) d.binary = on ? [...new Set([...d.binary, at])] : d.binary.filter(x => x !== at);
      }
      const t = d.userScripts?.find(x => x.id === id); if (!t) return;
      for (const pad of t.pads) { const b = run.pads.find(x => x.name === pad.name); if (b && b.bytes.length === pad.size) pad.bytes = b.bytes; }
    });
    return { written: w.written, failed: w.failed, acted: acts ? { done: acts.done, failed: acts.failed } : undefined, scripts: plan ?? undefined };
  };
  /** what a script's directives (.mark, .name, .note, .junk) come to in the project as it is now (null: it has none) */
  const scriptActsOf = (id: string, text: string, run: ScriptRun) => {
    const { A: a, R: r, project: p } = latest.current;
    const s = p.userScripts?.find(x => x.id === id); if (!s) return null;
    const c = checkScript(scriptEnvFor(id), { source: text, lang: s.lang, code: s.code, pads: s.pads, init: s.init });
    // (a JavaScript script says them as it runs)
    const actions = [...c.actions, ...(run.actions ?? [])];
    return actions.length ? planScriptActions(a, r, p, actions) : null;
  };
  /** a run in safe mode ended: what it would change in the program worked out as Run would write it, but nothing goes
   *  into the program; only its scratchpads (the script's own memory, not the program's) are kept in the project */
  const ranSafely = (id: string, run: ScriptRun, text: string) => {
    const { A: a, R: r, project: p, S: st } = latest.current;
    const s = p.userScripts?.find(x => x.id === id); if (!s) return null;
    const w = writeScriptRun(a, r, { ...p, ...withoutScriptPatches(p, id), settings: st }, s, run, scriptPatches(p.patches, id));
    if (s.pads.length) update(`Run script "${s.name}" in safe mode`, d => {
      const t = d.userScripts?.find(x => x.id === id); if (!t) return;
      for (const pad of t.pads) { const b = run.pads.find(x => x.name === pad.name); if (b && b.bytes.length === pad.size) pad.bytes = b.bytes; }
    });
    // (its directives are only worked out, as its changes are)
    const acts = scriptActsOf(id, text, run);
    return { written: w.written, failed: w.failed, acted: acts ? { done: acts.done, failed: acts.failed } : undefined, scripts: undefined as ScriptsPlan | undefined };
  };
  /** a run has ended (Run in the Scripts tab or the Scripts view, or debugging to its end): its changes into the program
   *  (in safe mode only worked out, unless `write`: Write into the program), the run kept to show, and what it did said */
  const finishScriptRun = (id: string, r: ScriptRun, text: string, write = false, chain = 0) => {
    const s = latest.current.project.userScripts?.find(x => x.id === id); if (!s) return;
    const safe = !!s.safe && !write;
    // (an Assembler project's program is what its sources make: a script's changes to it are only worked out, as in safe
    // mode, and said; the rest it asks for, files, disks, tapes, the library, is done)
    const w = safe || asmMode ? ranSafely(id, r, text) : ranUserScript(id, r, text);
    const st = useScripts.getState();
    st.set({ runs: { ...st.runs, [id]: { run: r, source: text, at: Date.now(), failed: w?.failed ?? [], ...(w?.acted ? { acted: w.acted } : {}), ...(safe || asmMode ? { safe: true, would: w?.written ?? [] } : {}) } } });
    // the script the Scripts tab shows: the one picked, else its first (as ScriptsView picks it)
    const list = latest.current.project.userScripts ?? [], shown = (list.find(x => x.id === st.selected) ?? list[0])?.id === id;
    // In the program shows the first change the run made (or would make, in safe mode) beside its list
    if (shown) st.set({ change: !w?.written.length ? null : safe || asmMode ? { kind: 'would', i: 0 } : { kind: 'patch', id: w.written[0].id } });
    // what it printed, the files it made, or the error it stopped with, is under Last run: that tab is shown
    if (shown && (r.prints?.length || r.made?.length || r.exports || r.builds?.length || r.plays?.length || r.library?.length || r.snapshot || r.scripts?.length || r.disk || r.tape || r.cartridge || r.error)) st.set({ outTab: 'run', outFolded: false });
    // the export it asked for: written now that the run has ended well and its changes are in the program (a safe run's
    // is only said, under Last run)
    if ((r.exports || r.builds?.length || r.plays?.length || r.library?.length || r.cartridge || w?.scripts?.runs.length) && !safe && endedWell(r.end)) void doScriptRequests(s.name, r, !!w?.written.length || !!w?.acted?.done.length, w?.scripts?.runs ?? [], chain);
    // the disk it asked to be mounted (a disk's mount()), when the run has ended well
    if (r.disk && !safe && endedWell(r.end)) { try { mountBytes(r.disk.name, null, r.disk.bytes); } catch (e) { toast(`"${s.name}": ${r.disk.name} was not mounted: ${errorText(e)}`, 'err'); } }
    // the tape it asked to be put in the datasette (a tape's insert()), when the run has ended well
    if (r.tape && !safe && endedWell(r.end)) { try { insertTapeBytes(r.tape.name, null, r.tape.bytes); } catch (e) { toast(`"${s.name}": ${r.tape.name} was not put in the datasette: ${errorText(e)}`, 'err'); } }
    // what it printed on its C64 screen: the screen is shown
    if (shown && r.screen?.wrote && !st.c64.open) st.setC64({ open: true });
    const on = w?.written.filter(p => !p.off) ?? [], bytes = on.reduce((n, p) => n + p.bytes.length, 0);
    const what = asmMode
      ? (w?.written.length ? ` It would change ${bytes} byte${bytes === 1 ? '' : 's'} of the program, which is not done: an Assembler project's program is what its sources make (Scripts → In the program → Would change).` : '')
      : safe
      ? ` Safe mode: nothing went into the program. ${w?.written.length ? `It would change ${bytes} byte${bytes === 1 ? '' : 's'} in ${on.length} place${on.length === 1 ? '' : 's'} (Scripts → In the program → Would change).` : 'It would change none of the program\'s bytes.'}`
      : w?.written.length ? ` It changed ${bytes} byte${bytes === 1 ? '' : 's'} of the program in ${on.length} place${on.length === 1 ? '' : 's'}: the listing and the source have them.` : ' It changed none of the program\'s bytes.';
    const printed = r.prints?.length ? ` It printed ${r.prints.length} line${r.prints.length === 1 ? '' : 's'} (Scripts → Last run): ${r.prints[0].length > 60 ? `${r.prints[0].slice(0, 60)}…` : r.prints[0]}${r.prints.length > 1 ? ' …' : ''}` : '';
    const asked = r.exports ? (safe ? ' It would write the export (Scripts → Last run).' : ' It asked for the export, which is being written.') : '';
    const building = r.builds?.length ? (safe ? ` It would build or start ${r.builds.length} thing${r.builds.length === 1 ? '' : 's'} (Scripts → Last run).` : ` It asked for: ${r.builds.map(b => buildRequestText(b, { emulator: 'VICE', debugger: debuggerName })).slice(0, 2).join('; ')}${r.builds.length > 2 ? '; …' : ''}.`) : '';
    const playing = r.plays?.length ? (safe ? ` It would play ${r.plays.length} tune${r.plays.length === 1 ? '' : 's'} (Scripts → Last run).` : ` It asked for ${r.plays.map(p => p.name).slice(0, 2).join(' and ')}${r.plays.length > 2 ? ', …' : ''} to be played.`) : '';
    const adding = r.library?.length ? (safe ? ` It would add ${r.library.length} thing${r.library.length === 1 ? '' : 's'} to the library (Scripts → Last run).` : ` It asked for ${r.library.length} thing${r.library.length === 1 ? '' : 's'} to be added to the library.`) : '';
    const scripted = r.scripts?.length && endedWell(r.end) ? (safe ? ` It would add, change or run ${r.scripts.length} script${r.scripts.length === 1 ? '' : 's'} (Scripts → Last run).`
      : `${w?.scripts?.done.length ? ` Scripts: ${w.scripts.done.slice(0, 2).join('; ')}${w.scripts.done.length > 2 ? '; …' : ''}.` : ''}${w?.scripts?.failed.length ? ` Not done: ${w.scripts.failed.join('; ')}.` : ''}`) : '';
    const mounting = `${r.disk && endedWell(r.end) && safe ? ` It would mount ${r.disk.name} (Scripts → Last run).` : ''}${r.tape && endedWell(r.end) && safe ? ` It would put ${r.tape.name} in the datasette (Scripts → Last run).` : ''}${r.cartridge && endedWell(r.end) ? (safe ? ` It would start the cartridge ${r.cartridge.name} in VICE (Scripts → Last run).` : ` It asked for the cartridge ${r.cartridge.name} to be started in VICE.`) : ''}`;
    const snapped = r.snapshot && endedWell(r.end) ? (safe ? ' It would change the snapshot (Scripts → Last run).' : r.snapshot.changes.length ? ` It changed the snapshot (${r.snapshot.changes[0]}${r.snapshot.changes.length > 1 ? ', …' : ''}): Build & Run restarts it so.` : ' It asked for the snapshot to be kept, with nothing changed in it.') : '';
    const made = r.made?.length ? ` It made ${r.made.length} file${r.made.length === 1 ? '' : 's'} (Scripts → Last run): ${r.made[0].name}${r.made.length > 1 ? ', …' : ''}.` : '';
    const drew = r.screen?.wrote ? ` It printed on ${r.screen.c64 ? 'the C64\'s screen' : 'its C64 screen'} (Scripts → C64 screen).` : '';
    toast(`${s.name}: ${scriptEndText(r)}${printed}${made}${asked}${building}${adding}${playing}${drew}${mounting}${snapped}${scripted}${what}${w?.acted?.done.length ? ` ${safe ? 'It would mark up' : 'It marked up'} ${w.acted.done.length} thing${w.acted.done.length === 1 ? '' : 's'} (${w.acted.done[0]}${w.acted.done.length > 1 ? ', …' : ''}).` : ''}${w?.acted?.failed.length ? ` ${w.acted.failed.length} of its directives could not be done (Scripts → Last run says why).` : ''}${r.overCode?.length ? ` It wrote over its own code (line ${r.overCode[0].line}): Scripts → Last run.` : ''}${w?.failed.length ? ` ${w.failed.length} change${w.failed.length === 1 ? '' : 's'} could not ${safe ? 'have been' : 'be'} written (Scripts → Last run says why).` : ''}`, endedWell(r.end) ? (w?.failed.length || r.overCode?.length ? 'warn' : 'ok') : 'warn');
  };
  /** the export as it is now, for a JavaScript script's `exporter` (core script-export.ts): what Export would write,
   *  less the verified PRGs (they are made when it is written); null without a file to export */
  const scriptExportData = (): ScriptExportData | null => {
    const { R: R1, project: p1, S: S1 } = latest.current;
    if (!p1.files.length) return null;
    const sep = home?.dir.includes('\\') ? '\\' : '/';
    return { name: p1.name, assembler: assemblerOf(S1) === '64tass' ? '64tass' : 'kickass', folder: home ? `${home.dir}${sep}${PROJECT_FOLDERS.source}` : exportDir, main: mainSource(R1),
      sources: Object.keys(R1.files).filter(n => typeof R1.files[n] === 'string' && /\.(asm|s)$/i.test(n) && !n.includes('/')), outDir: S1.outDir, files: exportFiles(p1, R1, S1, null, new Date()) };
  };
  /** the build as it is now, for a JavaScript script's `build` (core script-build.ts): the last Verify or Build & Run
   *  with its files' PRGs; null without a file to build */
  const scriptBuildData = (): ScriptBuildData | null => {
    const { R: R1, project: p1, S: S1 } = latest.current;
    if (!p1.files.length) return null;
    const b = buildNow.current;
    return { assembler: assemblerOf(S1) === '64tass' ? '64tass' : 'kickass', emulator: 'VICE', debugger: debuggerName,
      last: b && { ok: b.ok, fresh: b.key === filesKey(R1), by: b.kick ? asmTool : 'built-in', log: b.log,
        files: b.V.results.map((r, i) => { const k = b.kick?.compared[i]; return { name: r.path.replace(/\.[a-z0-9]+$/i, '.prg'), source: r.path, ok: k ? k.ok && r.ok : r.ok, same: k?.same ?? r.same, total: k?.total ?? r.total, prg: k?.prg ?? r.prg, errors: r.errors.map(e => `${e.file}:${e.line}  ${e.msg}`) }; }) } };
  };
  /** what a script's run asked for with exporter.write(), build.verify/run/start and sid.play: the export first, then
   *  the builds and starts in the order asked, then the tunes; one that does not go well ends them */
  const doScriptRequests = async (name: string, r: ScriptRun, changed: boolean, runs: ScriptsPlan['runs'] = [], chain = 0) => {
    if (r.exports && !(await exportProject(r.exports.elsewhere, { request: r.exports, changed, script: name })) && (r.builds?.length || r.plays?.length || r.library?.length)) { toast(`"${name}": the export was not written, so what it asked to build, start and play was not done`, 'warn'); return; }
    for (const b of r.builds ?? []) {
      if (b.kind === 'verify') { const v = await runVerify(); if (!v?.ok) return; continue; }
      if (b.kind === 'run') { await runBuild(b.debugger); continue; }
      const emu = b.debugger ? debuggerName : 'VICE';
      if (!kr) return needDesktop();
      try {
        const w = await kr.writeExport({ target: 'temp', name: 'scripted', files: { [b.name]: b.prg } });
        if (!w) return;
        const res = await kr.run({ prgPath: `${w.dir}/${b.name}`, ...(b.start != null ? { start: b.start } : {}), ...(b.debugger ? { debugger: true } : {}) });
        toast(`"${name}": ${emu} started ${b.name} (${b.prg.length - 2} bytes at $${h4(b.prg[0] | b.prg[1] << 8)})${b.start != null ? ` with SYS ${b.start}` : ''}${res.notes?.length ? ` (${res.notes.join('; ')})` : ''}`, res.notes?.length ? 'warn' : 'ok');
      } catch (e) { toast(`"${name}": ${emu} was not started with ${b.name}: ${errorText(e)}`, 'err'); return; }
    }
    // the cartridge it asked to have started (a cartridge's run()): the image written beside the others, attached in VICE
    if (r.cartridge) {
      if (!kr) return needDesktop();
      try {
        const c = r.cartridge, w = await kr.writeExport({ target: 'temp', name: 'scripted', files: { [c.name]: c.bytes } });
        if (!w) return;
        const res = await kr.run({ prgPath: `${w.dir}/${c.name}`, cart: true });
        toast(`"${name}": VICE started the cartridge ${c.name} (${c.type}, ${c.chips} chip${c.chips === 1 ? '' : 's'})${res.notes?.length ? ` (${res.notes.join('; ')})` : ''}`, res.notes?.length ? 'warn' : 'ok');
      } catch (e) { toast(`"${name}": VICE was not started with the cartridge ${r.cartridge.name}: ${errorText(e)}`, 'err'); return; }
    }
    if (r.library?.length && !(await addScriptLibrary(name, r.library))) return;
    for (const p of r.plays ?? []) if (!(await playScriptTune(name, p))) return;
    // the scripts it asked to be run after it (scripts.run), one after the other; a chain of them ends after SCRIPTS_RUN_CHAIN
    for (const q of runs) {
      if (chain >= SCRIPTS_RUN_CHAIN) { toast(`"${name}" asked for "${q.name}" to be run, but ${SCRIPTS_RUN_CHAIN} scripts have run one after the other: the chain ends here (does a script run itself?)`, 'warn'); return; }
      await analysisSettled();
      await runUserScript(q.id, q.source, false, chain + 1);
    }
  };
  /** the program's music, for a JavaScript script's `sid` (core script-sid.ts): each music block with what it plays
   *  with, as Play music and the export's .sid have it */
  const scriptSidData = (): ScriptSidData => {
    const { A: A1, R: R1, project: p1 } = latest.current;
    const tunes: ScriptSidData['tunes'] = [];
    for (const b of A1.blocks) {
      if (b.type !== 'music') continue;
      try {
        const { m, load, init, play, name, d } = musicData(b, A1, R1);
        tunes.push({ name, file: p1.files[A1.owner[b.start]]?.name ?? null, start: load, end: load + b.end - b.start, init, play, why: m?.why ?? [], score: m?.score ?? 0, data: d });
      } catch { /* a block that cannot play is not a tune */ }
    }
    return { player: toolchain.musicPlayer === 'deepsid' ? 'deepsid' : 'vice', tunes };
  };
  /** the library as it is now, for a JavaScript script's `library` (core script-library.ts): read first when it has
   *  not been; null outside the desktop app */
  const scriptLibraryData = async (): Promise<ScriptLibraryData | null> => {
    if (!kr) return null;
    const lib = useLibrary.getState();
    if (!lib.listing) await lib.load();
    const l = useLibrary.getState().listing;
    return l ? { dir: l.dir, items: l.items, formats: { mc: toolchain.bitmapFormatMc, hires: toolchain.bitmapFormatHires } } : null;
  };
  /** what a script asked to be added to the library (library.add): each written as Add to library writes it; bytes
   *  the library has already are left as they are */
  const addScriptLibrary = async (script: string, adds: readonly ScriptLibraryRequest[]): Promise<boolean> => {
    if (!kr) { needDesktop(); return false; }
    const lib = useLibrary.getState();
    if (!lib.listing) await lib.load();
    const added: string[] = [], there: string[] = [];
    try {
      for (const a of adds) {
        const same = sameInLibrary(useLibrary.getState().listing?.items ?? [], a.kind, a.data);
        if (same) { there.push(`${a.name} (${same.file})`); continue; }
        const proj = home?.name ?? latest.current.project.name;
        const from: LibrarySource = { ...(proj ? { project: proj } : {}), ...a.from };
        const r = await lib.add({ kind: a.kind, stem: libraryStem(a.name, from), bytes: a.bytes, ...(a.format ? { format: a.format } : {}),
          entry: { name: a.name, from, ...(a.mc != null ? { mc: a.mc } : {}), ...(a.colors ? { colors: a.colors } : {}) } });
        added.push(`${LIB_KIND[a.kind].folder}\\${r.item.file}`);
      }
    } catch (e) { toast(`"${script}": could not add to the library: ${errorText(e)}${added.length ? ` (${added.length} added before it)` : ''}`, 'err'); return false; }
    if (added.length) toast(`"${script}": added to the library: ${added.slice(0, 3).join(', ')}${added.length > 3 ? `, and ${added.length - 3} more` : ''}`, 'ok');
    if (there.length) toast(`"${script}": the library has ${there.length === 1 ? 'these bytes' : `${there.length} of them`} already: ${there.slice(0, 3).join(', ')}${there.length > 3 ? ', …' : ''}`, 'info');
    return true;
  };
  /** a tune a script asked to be played (sid.play): in VICE with Mimir's player, or in DeepSID as its .sid */
  const playScriptTune = async (script: string, p: ScriptSidRequest): Promise<boolean> => {
    if (!kr) { needDesktop(); return false; }
    const where = p.player;
    try {
      if (where === 'deepsid') {
        const file = deepSidName(p.name, p.sid);
        toast(`"${script}": opening ${p.name} in DeepSID…`, 'info');
        const r = await kr.playInDeepSid({ name: file, sid: p.sid });
        if (r.played) toast(`"${script}": DeepSID plays ${p.name} (${p.how}), as ${file}`, 'ok');
        else toast(`"${script}": DeepSID did not start ${p.name}: ${r.problem}. Its window ${/did not open/.test(r.problem ?? '') ? 'is' : 'stays'} open: press L there (Load SID) and choose ${r.path}`, 'warn');
        return true;
      }
      if (!p.prg) { toast(`"${script}": ${p.name} cannot play in VICE: ${p.problem ?? 'the player could not be made'}`, 'err'); return false; }
      const file = `${p.name.replace(/[^A-Za-z0-9_.-]+/g, '_').slice(0, 40) || 'tune'}.prg`;
      const w = await kr.writeExport({ target: 'temp', name: 'play', files: { [file]: p.prg } });
      if (!w) return false;
      await kr.run({ prgPath: `${w.dir}/${file}` });
      toast(`"${script}": VICE plays ${p.name}: ${p.how}. Keys 1-9 and 0 start songs $00-$09`, 'ok');
      for (const x of p.warnings) toast(x, 'warn');
      return true;
    } catch (e) { toast(`"${script}": ${p.name} was not played in ${where === 'deepsid' ? 'DeepSID' : 'VICE'}: ${errorText(e)}`, 'err'); return false; }
  };
  /** the C64's ROMs, for scripts that run in the whole C64 (asked for once they are needed, kept once found) */
  const scriptRoms = useRef<Roms | null>(null);
  /** how a script's run is to go beyond its code: the address it stops at (UserScript.stopAt, read with the names the
   *  code has), and for one that runs in the whole C64 the ROMs and the mounted disk. null: it cannot run, and why was
   *  said */
  const scriptRunOpts = async (s: UserScript, env: ScriptEnv, pads: readonly ScriptPad[], c: ScriptCheck, source = s.source): Promise<ScriptRunOpts | null> => {
    const stop = scriptStopAt(s.stopAt, scriptNames(env, pads), c);
    // the C64 screen it prints on: 40×25, or what the screen's extended mode has room for (Scripts → C64 screen)
    const screen = runScreenSize();
    // JavaScript runs in its own way: no stop address, no C64 of the run's; it gets the mounted disk, and the ROMs when
    // its code uses Sindri (without them sindri.unpack runs on the stand-ins, and sindri.c64 says what it needs)
    if (s.code === 'js') {
      // (the code that runs, which may be newer than the script's saved one)
      if (/\bsindri\b/.test(source)) scriptRoms.current ??= await (kr?.c64Roms() ?? Promise.resolve(null)).catch(() => null);
      // the loader's files are read (and unpacked) only for a script whose code names the loader
      return { disk: disk?.bytes ?? null, roms: /\bsindri\b/.test(source) ? scriptRoms.current : null, ...(/\bloaders?\b/.test(source) ? { loaders: scriptLoaders() } : {}), screen };
    }
    if (stop != null && typeof stop === 'object') { toast(`"${s.name}": its Stop at is no address: ${stop.error} (Scripts → Init)`, 'warn'); return null; }
    if (s.machine !== 'c64') return { stopAt: stop, screen };
    scriptRoms.current ??= await (kr?.c64Roms() ?? Promise.resolve(null)).catch(() => null);
    const roms = scriptRoms.current;
    if (!roms) { toast(`"${s.name}" runs in the whole C64, which needs the C64's ROM files: they come with VICE (Settings → Toolchain). Memory only (Scripts → Init) runs without them`, 'warn'); return null; }
    const image = disk?.bytes ?? null;
    if (image && !roms.drive) toast('The ROMs have no 1541 DOS ROM: the script runs without the disk', 'warn');
    return { stopAt: stop, c64: { roms, disk: image && roms.drive ? image : null } };
  };
  /** Run a script (`text`: its code as the editor has it, else as the project has it), in its worker; one at a time.
   *  `write`: what it changes goes into the program also when the script is in safe mode (Write into the program) */
  const runUserScript = async (id: string, text?: string, write = false, chain = 0) => {
    const s = latest.current.project.userScripts?.find(x => x.id === id); if (!s) return;
    if (useScripts.getState().running) { toast('A script is running: wait for it, or stop it in the Scripts tab', 'info'); return; }
    const source = text ?? s.source, env = scriptEnvFor(id);
    const c = checkScript(env, { source, lang: s.lang, code: s.code, pads: s.pads, init: s.init });
    if (!c.ok) { const e = c.problems.find(p => p.level === 'error'); toast(`"${s.name}" does not check out${e?.line ? ` (line ${e.line})` : ''}: ${e?.msg}`, 'warn'); return; }
    const opts = await scriptRunOpts(s, env, s.pads, c, source);
    if (!opts) return;
    // the export, for a script whose code names it (a run of the script itself: not one on files or with values)
    if (s.code === 'js' && /\bexporter\b/.test(source)) { await analysisSettled(); opts.export = scriptExportData(); }
    // and the build: the last one, and what it may ask to be built and started
    if (s.code === 'js' && /\bbuild\b/.test(source)) { await analysisSettled(); opts.build = scriptBuildData(); }
    // and the program's music, with where it plays
    if (s.code === 'js' && /\bsid\b/.test(source)) { await analysisSettled(); opts.sid = scriptSidData(); }
    // and the library of SIDs, sprites, charsets and bitmaps
    if (s.code === 'js' && /\blibrary\b/.test(source)) opts.library = await scriptLibraryData();
    // and the disk a script takes a copy of to change: the D81 mounted for scripts, else the mounted disk
    if (s.code === 'js' && /\bdisks\b/.test(source)) opts.disks = scriptD81Ref.current ?? (disk ? { name: disk.name, bytes: disk.bytes } : null);
    // and the tape in the datasette, which a script takes a copy of to change
    if (s.code === 'js' && /\btapes\b/.test(source)) opts.tapes = tape ? { name: tape.name, bytes: tape.bytes } : null;
    // and the project's cartridge (the image it was opened from), which a script takes a copy of to change
    if (s.code === 'js' && /\bcartridges\b/.test(source)) { const c = latest.current.project.cart; opts.cartridges = c ? { name: c.name, bytes: c.crt } : null; }
    // and the project's scripts, with the library's
    if (s.code === 'js' && /\bscripts\b/.test(source)) opts.scripts = {
      self: s.name,
      scripts: (latest.current.project.userScripts ?? []).map(x => ({ name: x.name, lang: x.lang, code: x.code, source: x.id === id ? source : x.source, safe: x.safe, when: x.when, key: x.key, machine: x.machine, pads: x.pads.map(p => ({ name: p.name, start: p.start, size: p.size })) })),
      library: useScripts.getState().library.map(l => ({ name: l.name, lang: l.lang, code: l.code, source: l.source, when: l.when })),
    };
    // and the snapshot the project was opened from
    if (s.code === 'js' && /\bsnapshot\b/.test(source)) { const f = latest.current.project.files.find(x => x.vsf); opts.snapshot = f?.vsf ? { name: f.name.replace(/\.prg$/i, '.vsf'), vsf: f.vsf } : null; }
    // and the program's blocks, as the analysis has them now
    if (s.code === 'js' && /\bblocks\b/.test(source)) { await analysisSettled(); const { A: a1, R: r1, project: p1 } = latest.current; opts.blocks = scriptBlocksData(a1, r1, p1); }
    useScripts.getState().set({ running: id });
    try {
      const r = await runScriptInWorker(env, { source, lang: s.lang, code: s.code, pads: s.pads, init: s.init }, opts);
      useScripts.getState().set({ running: null });
      finishScriptRun(id, r, source, write, chain);
    } catch (e) {
      useScripts.getState().set({ running: null });
      const msg = errorText(e);
      toast(msg === 'stopped' ? `${s.name} stopped` : `${s.name} did not run: ${msg}`, msg === 'stopped' ? 'info' : 'err');
    }
  };
  /** each script checked as the project has it, for the Scripts view: whether it can run, and what is wrong */
  const scriptChecks = useMemo(() => new Map(userScripts.map(s => [s.id, checkScript(scriptsEnv, s)])), [userScripts, scriptsEnv]);
  /** a script in the Scripts tab; `line`: the line of its code to show */
  const openUserScript = (id: string, line?: number) => { useScripts.getState().set({ selected: id, pad: 0, change: null, gotoLine: line ?? null }); setUi({ tab: 'scripts' }); };
  /** the name a script's code writes for an address of the program (a link's): as the listing names it */
  const scriptLinkOf = (a: Addr) => linkName(R, A, a);
  /** what kind of block each of the program's labels is on (the script editor's suggestions say it) */
  const scriptKinds = useMemo(() => {
    const m = new Map<string, string>();
    for (const [a, l] of R.labels) { const b = findBlock(A.blocks, a); m.set(l.name, b ? kindInfo(b.type).label.toLowerCase() : 'label'); }
    for (const z of R.zp.values()) if (!z.off) m.set(z.name, 'zero-page variable');
    // a block's end (tbl_001_end): the address after it
    for (const [n, r] of scriptsEnv.ends ?? []) { const b = findBlock(A.blocks, r.start); m.set(n, `end of the ${b ? kindInfo(b.type).label.toLowerCase() : 'block'} (the address after it)`); }
    // the music as LoadSid gives it in the source (music.location, …)
    for (const [n, f] of musicNames(A.music)) m.set(n, MUSIC_FIELD_TEXT[f.field]);
    return m;
  }, [R, A, scriptsEnv]);
  /** the program's blocks a scratchpad can be filled from (Scripts → Scratchpads → From a block…) */
  const scriptBlocks = useMemo(() => A.blocks.filter(b => b.start < 0x10000 && b.end > b.start).map(b => ({ start: b.start, end: b.end, kind: b.type, name: R.labels.get(b.start)?.name ?? `${h4(b.start)}` })), [A, R]);
  /** the scripts at each address of the program: linked to it, or their code uses its name (the listing marks them) */
  const scriptMarks = useMemo(() => {
    const m = new Map<Addr, ScriptMark[]>();
    const add = (a: Addr, k: ScriptMark) => {
      const l = m.get(a), o = l?.find(x => x.id === k.id);
      if (!l) m.set(a, [k]); else if (!o) l.push(k); else { o.linked ||= k.linked; o.line ??= k.line; }
    };
    for (const s of userScripts) {
      for (const a of s.links ?? []) add(a, { id: s.id, name: s.name, linked: true });
      // a block's end name marks the block (its label line), not the address after it
      for (const u of scriptChecks.get(s.id)?.uses ?? []) add(scriptsEnv.ends?.get(u.name)?.start ?? u.at, { id: s.id, name: s.name, linked: false, line: u.line });
    }
    return m;
  }, [userScripts, scriptChecks, scriptsEnv]);
  /** link an address of the program to a script: the script editor shows its name, and a click writes it in the code */
  const linkToScript = (id: string, a: Addr) => {
    const s = userScripts.find(x => x.id === id); if (!s || s.links?.includes(a)) return;
    const k = scriptLinkOf(a);
    update(`Link ${k.name} to "${s.name}"`, d => { const t = d.userScripts?.find(x => x.id === id); if (t) t.links = [...(t.links ?? []), a]; });
    toast(`${k.name} is linked to the script "${s.name}": in the Scripts tab a click on it writes it in the code`, 'ok');
  };
  const unlinkFromScript = (id: string, a: Addr) => {
    const s = userScripts.find(x => x.id === id); if (!s) return;
    update(`Unlink ${scriptLinkOf(a).name} from "${s.name}"`, d => { const t = d.userScripts?.find(x => x.id === id); if (t) t.links = (t.links ?? []).filter(x => x !== a); });
  };
  /** the menu item that links an address to a script: one of the project's (or unlinks it from one), or a new one */
  const linkMenu = (a: Addr): MenuItem => {
    const k = scriptLinkOf(a);
    return { label: `Link ${k.name} to a script`, icon: 'prompt', children: [
      ...userScripts.map((s): MenuItem => ((s.links ?? []).includes(a)
        ? { label: `Unlink from "${s.name}"`, run: () => unlinkFromScript(s.id, a) }
        : { label: `"${s.name}"`, run: () => linkToScript(s.id, a) })),
      ...(userScripts.length ? [{ sep: true }] satisfies MenuItem[] : []),
      { label: `New script with ${k.name}`, run: () => newUserScript([], [a]) },
    ] };
  };
  const saveScriptText = async (name: string, text: string) => {
    if (!kr) return needDesktop();
    try {
      const r = await kr.saveFile({ name, bytes: new TextEncoder().encode(text), title: 'Save as a text file' });
      if (r) toast(`Saved ${r.path}`, 'ok');
    } catch (e) { toast(`Save failed: ${errorText(e)}`, 'err'); }
  };
  const saveScriptBytes = async (name: string, bytes: Uint8Array, prg: boolean, load: Addr) => {
    if (!kr) return needDesktop();
    try {
      const r = await kr.saveFile({ name, bytes: prg ? makePrg(load, bytes) : bytes, title: prg ? 'Save as PRG' : 'Save as a binary file' });
      if (r) toast(`Saved ${r.path} (${bytes.length} bytes${prg ? `, loads at $${h4(load)}` : ''})`, 'ok');
    } catch (e) { toast(`Save failed: ${errorText(e)}`, 'err'); }
  };
  /* ---- scripts and files (spec 10.3): a file of the mounted disk or the tape into a scratchpad, a script run on
     files, and a scratchpad's bytes as a file of the project ---- */
  /** the files a script can be given: the mounted disk's directory (a PRG without its load address, another file as it
   *  is), what the disk's loader loads (as its tab opens them: unpacked, at their addresses) and the tape's files */
  const scriptFileChoices = (): ScriptFileChoice[] => {
    const out: ScriptFileChoice[] = [];
    const add = (group: string, key: string, name: string, load: Addr | null, bytes: Uint8Array) => { if (bytes.length) out.push({ key, group, name, load, bytes }); };
    if (disk) {
      for (const f of disk.img.files) {
        if (f.pastEnd) continue;
        try {
          const raw = readD64File(disk.bytes, f);
          if (f.type === 'PRG' && raw.length > 2) add(`${disk.name}: the directory`, `dir/${f.track}/${f.sector}`, f.name, raw[0] | raw[1] << 8, raw.subarray(2));
          else if (f.type !== 'PRG') add(`${disk.name}: the directory`, `dir/${f.track}/${f.sector}`, `${f.name} (${f.type})`, null, raw);
        } catch { /* a file that cannot be read is not listed */ }
      }
      const loaders: [string, () => void][] = [['Spindle jobs', exportSpindleFiles], ['Bitfire files', exportBitfireFiles], ['BoozeLoader files', exportBoozeFiles], ['Sparkle bundles', exportSparkleFiles],
        ['IFFL parts', exportIfflParts], ['Krill\'s loader', exportKrillFiles], ['Covert Bitops loader', exportCovertFiles], ['DLoC\'s loader', exportDlocFiles], ['Pirate Slayer files', exportPirateSlayerFiles],
        ['Para-Protect files', exportParaProtectFiles], ['Disk-Speed files', exportDiskSpeedFiles]];
      for (const [label, ask] of loaders) {
        const groups: LoaderGroup[] = groupsOnly.current = [];
        try { ask(); } catch { /* not such a disk */ } finally { groupsOnly.current = null; }
        for (const g of groups) try { g.files().forEach((f, k) => add(`${disk.name}: ${label}`, `${label}/${g.name}/${k}`, f.name, f.load, f.bytes)); } catch { /* a file that does not open is not listed */ }
      }
    }
    if (tape) tape.img.files.forEach((f, i) => { if (f.load != null && f.data.length) add(`${tape.name}: the tape`, `tape/${i}`, f.name || tapeFileName(f), f.load, f.data); });
    return out;
  };
  /** the loaders of the mounted disk and the tape for a JavaScript script's `loader` (core script-loader.ts): what each
   *  loader tab lists, group by group as Export files to project takes them, with the script the tab writes */
  const scriptLoaders = (): ScriptLoaderData[] => {
    const out: ScriptLoaderData[] = [];
    const lines = (make: () => string[] | null | undefined): string[] => { try { return make() ?? []; } catch { return []; } };
    const take = (name: string, from: string, ask: () => void, script: () => string[] | null | undefined) => {
      const groups: LoaderGroup[] = groupsOnly.current = [];
      try { ask(); } catch { /* not such a disk */ } finally { groupsOnly.current = null; }
      const made: ScriptLoaderData['groups'] = [];
      for (const g of groups) try { made.push({ name: g.name, what: g.what, files: g.files().map(f => ({ name: f.name, load: f.load, bytes: f.bytes })) }); } catch { /* a group that does not open is not there */ }
      if (made.length) out.push({ name, from, script: lines(script), groups: made });
    };
    if (disk) {
      const n = disk.name;
      if (disk.spindle) take('Spindle', n, exportSpindleFiles, () => spinScript(disk.spindle!, n));
      if (disk.bitfire) take('Bitfire', n, exportBitfireFiles, () => d64writeScript(disk.bitfire!, n));
      if (disk.booze) take('BoozeLoader', n, exportBoozeFiles, () => boozeFileList(disk.booze!, n));
      if (disk.sparkle) take('Sparkle', n, exportSparkleFiles, () => sparkleScript(disk.sparkle!, n));
      if (disk.iffl) take('IFFL', n, exportIfflParts, () => []);
      if (disk.krill) take('Krill\'s loader', n, exportKrillFiles, () => cc1541Script(disk.krill!, n));
      if (disk.covert) take('Covert Bitops loader', n, exportCovertFiles, () => covertScriptText(covertScript(disk.covert!, n)));
      if (disk.dloc) take('DLoC\'s loader', n, exportDlocFiles, () => dlocScriptText(dlocScript(disk.dloc!, n)));
      if (disk.pirateslayer) take('Pirate Slayer', n, exportPirateSlayerFiles, () => pirateSlayerFileList(disk.pirateslayer!, n));
      if (disk.paraprotect) take('Para-Protect', n, exportParaProtectFiles, () => paraProtectFileList(disk.paraprotect!, n));
      if (disk.diskspeed) take('Disk-Speed', n, exportDiskSpeedFiles, () => diskSpeedFileList(disk.diskspeed!, n));
    }
    if (tape) take('Tape', tape.name, exportTapeFiles, () => tapeToolScript(tape.img, tape.name)?.script);
    return out;
  };
  /** Run on files…: the script, the files it can be given and the ones ticked first; and where a run is */
  const [filesRun, setFilesRun] = useState<{ id: string; files: ScriptFileChoice[]; first: string[] } | null>(null);
  const [filesBusy, setFilesBusy] = useState<FilesRunBusy | null>(null);
  const filesRunScript = filesRun ? userScripts.find(s => s.id === filesRun.id) ?? null : null;
  /** the dialog that runs a script on files (`first`: the files ticked when it opens, by their keys); a script with no
   *  scratchpad that takes a file is shown instead, with its scratchpads */
  const openRunOnFiles = (id: string, first: string[] = []) => {
    const s = userScripts.find(x => x.id === id); if (!s) return;
    if (filePad(s.pads) < 0) {
      openUserScript(id); useScripts.getState().set({ outTab: 'pads', outFolded: false });
      toast(`"${s.name}" has no scratchpad that takes a file: under Scratchpads, set the use of one to File (or fill one with From a file…), and it can be run on files`, 'info');
      return;
    }
    setFilesRun({ id, files: scriptFileChoices(), first });
  };
  /** a right-click on a file of the disk or the tape in the Explorer: the scripts that can be run on it */
  const fileScriptMenu = (key: string, name: string, x: number, y: number) => {
    const can = userScripts.filter(s => filePad(s.pads) >= 0);
    setMenu({ x, y, items: [
      { header: `Run a script on "${name}"` },
      ...can.map((s): MenuItem => ({ label: `"${s.name}"…`, icon: 'play', run: () => openRunOnFiles(s.id, [key]) })),
      ...(can.length ? [] : [{ label: userScripts.length ? 'No script takes a file yet: show how' : 'There is no script yet: show the Scripts tab', run: () => {
        if (userScripts.length) openRunOnFiles(userScripts[0].id);
        else { setUi({ tab: 'scripts' }); toast('A script that takes a file: New script, then under Scratchpads put a file into a scratchpad with From a file… (its use becomes File). Run on files… then runs it on any file of the disk or the tape', 'info'); }
      } }] satisfies MenuItem[]),
    ] });
  };
  /** the script of the dialog run on each of `files` in turn, in the scripts' worker (Stop ends it): the file in the
   *  scratchpad that takes it, on the program without what the script's earlier runs changed. Nothing goes into the
   *  program; the files the runs give are opened as a new project, added to this one, or saved to a folder */
  const runOnFiles = async (files: ScriptFileChoice[], then: FilesRunThen) => {
    const s = latest.current.project.userScripts?.find(x => x.id === filesRun?.id); if (!s || !files.length) return;
    if (useScripts.getState().running) { toast('A script is running: wait for it, or stop it in the Scripts tab', 'info'); return; }
    if (then === 'save' && !kr) return needDesktop();
    const env = scriptEnvFor(s.id), outs: ScriptFileResult[] = [], failed: { name: string; why: string }[] = [];
    let stopped = false;
    useScripts.getState().set({ running: s.id });
    try {
      for (let i = 0; i < files.length && !stopped; i++) {
        const f = files[i], file = { name: f.name, load: f.load, bytes: f.bytes };
        setFilesBusy({ done: i, total: files.length, name: f.name });
        const plan = fileRunPlan(env, s, file);
        if ('error' in plan) { failed.push({ name: f.name, why: plan.error }); continue; }
        try {
          const opts = await scriptRunOpts(s, env, plan.script.pads, plan.check);
          if (!opts) { failed.push({ name: f.name, why: 'it could not start' }); break; }
          const run = await runScriptInWorker(env, { source: s.source, lang: s.lang, code: s.code, pads: plan.script.pads, init: s.init }, opts);
          if (!endedWell(run.end)) { failed.push({ name: f.name, why: scriptEndText(run) }); continue; }
          const r = fileRunResults(plan, file, run, s.name);
          if (r.length) outs.push(...r); else failed.push({ name: f.name, why: 'the run wrote nothing: no result scratchpad, not the file\'s scratchpad, no memory' });
        } catch (e) {
          if (errorText(e) === 'stopped') stopped = true; else failed.push({ name: f.name, why: errorText(e) });
        }
      }
    } finally { useScripts.getState().set({ running: null }); setFilesBusy(null); }
    setFilesRun(null);
    const n = files.length;
    await deliverResults(s, `"${s.name}" ran on ${n} file${n === 1 ? '' : 's'}`, outs, failed, then, stopped);
  };
  /** what a run on files or with a table of values ends with: its results opened as a new project, added to this one or
   *  saved to a folder, and what it did said (`ran`: its first words); a run that was stopped gives nothing */
  const deliverResults = async (s: UserScript, ran: string, outs: ScriptFileResult[], failed: { name: string; why: string }[], then: FilesRunThen, stopped: boolean) => {
    if (stopped) { toast(`"${s.name}" stopped: nothing was opened or saved`, 'info'); return; }
    // two files of one name: the later ones numbered
    const seen = new Map<string, number>();
    for (const o of outs) { const k = o.name.toLowerCase(), n = (seen.get(k) ?? 0) + 1; seen.set(k, n); if (n > 1) o.name = o.name.replace(/\.prg$/, `_${n}.prg`); }
    const names = `${outs.slice(0, 4).map(o => `${o.name} ($${h4(o.load)}, ${o.bytes.length} bytes)`).join(', ')}${outs.length > 4 ? `, and ${outs.length - 4} more` : ''}`;
    const failText = failed.length ? `${failed.length} gave no file: ${failed.slice(0, 3).map(x => `${x.name} (${x.why})`).join('; ')}${failed.length > 3 ? `; and ${failed.length - 3} more` : ''}` : '';
    if (!outs.length) { toast(`${ran} and gave no file. ${failText}`, 'warn'); return; }
    if (then === 'save') {
      try {
        const w = await kr!.writeExport({ target: 'pick', files: Object.fromEntries(outs.map(o => [o.name, makePrg(o.load, o.bytes)])) });
        if (w) toast(`${ran}: ${outs.length} result${outs.length === 1 ? '' : 's'} saved to ${w.dir}: ${names}${failText ? `. ${failText}` : ''}`, failed.length ? 'warn' : 'ok');
      } catch (e) { toast(errorText(e), 'err'); }
      return;
    }
    try {
      addFiles(outs.map(o => withId(parsePrg(o.name, makePrg(o.load, o.bytes)))), then === 'add',
        { note: `${ran}: ${names} ${then === 'add' ? 'added to the project' : 'opened'}${failText ? `. ${failText}` : ''}`, what: `the result${outs.length === 1 ? '' : 's'} of "${s.name}"`, show: true });
    } catch (e) { toast(errorText(e), 'err'); }
  };
  /** Run with values…: the script whose dialog is open */
  const [valuesRun, setValuesRun] = useState<string | null>(null);
  const valuesScript = valuesRun ? userScripts.find(s => s.id === valuesRun) ?? null : null;
  /** the script of the dialog run once for each row of its table of values (kept with the script as `text`), the row's
   *  values set in its code for that run only. Nothing goes into the program; what the runs give (runResults) is opened
   *  as a new project, added to this one, or saved to a folder */
  const runWithValues = async (text: string, rows: Record<string, string>[], then: FilesRunThen) => {
    const s = latest.current.project.userScripts?.find(x => x.id === valuesRun); if (!s || !rows.length) return;
    if (useScripts.getState().running) { toast('A script is running: wait for it, or stop it in the Scripts tab', 'info'); return; }
    if (then === 'save' && !kr) return needDesktop();
    if (text !== (s.table ?? '')) editUserScript(s.id, { table: text }, `The table of values of "${s.name}"`);
    const env = scriptEnvFor(s.id), outs: ScriptFileResult[] = [], failed: { name: string; why: string }[] = [];
    const digits = String(rows.length).length;
    let stopped = false;
    useScripts.getState().set({ running: s.id });
    try {
      for (let i = 0; i < rows.length && !stopped; i++) {
        const row = `row ${i + 1}`, what = Object.entries(rows[i]).map(([k, v]) => `${k} = ${v}`).join(', ');
        setFilesBusy({ done: i, total: rows.length, name: what });
        const source = setScriptParams(s.source, s, rows[i]).source;
        const c = checkScript(env, { source, lang: s.lang, code: s.code, pads: s.pads, init: s.init });
        if (!c.ok) { const e = c.problems.find(p => p.level === 'error'); failed.push({ name: row, why: `${e?.line ? `line ${e.line}: ` : ''}${e?.msg}` }); continue; }
        try {
          const opts = await scriptRunOpts(s, env, s.pads, c, source);
          if (!opts) { failed.push({ name: row, why: 'it could not start' }); break; }
          const run = await runScriptInWorker(env, { source, lang: s.lang, code: s.code, pads: s.pads, init: s.init }, opts);
          if (!endedWell(run.end)) { failed.push({ name: row, why: scriptEndText(run) }); continue; }
          const r = runResults(s.pads, run, `${s.name}_${String(i + 1).padStart(Math.max(2, digits), '0')}`.replace(/[^A-Za-z0-9_.-]+/g, '_'));
          if (r.length) outs.push(...r); else failed.push({ name: row, why: 'the run wrote nothing: no scratchpad, no memory' });
        } catch (e) {
          if (errorText(e) === 'stopped') stopped = true; else failed.push({ name: row, why: errorText(e) });
        }
      }
    } finally { useScripts.getState().set({ running: null }); setFilesBusy(null); }
    setValuesRun(null);
    await deliverResults(s, `"${s.name}" ran with ${rows.length} row${rows.length === 1 ? '' : 's'} of values`, outs, failed, then, stopped);
  };
  /** a scratchpad's bytes as a file that loads at `load`: added to the project, or opened as a new project */
  const padToProject = (name: string, bytes: Uint8Array, load: Addr, add: boolean, from = 'from a scratchpad') => {
    try {
      addFiles([withId(parsePrg(name, makePrg(load, bytes)))], add, { note: `${name} ($${h4(load)}, ${bytes.length} bytes, ${from}) ${add ? 'added to the project' : 'opened as a new project'}`, show: true });
    } catch (e) { toast(errorText(e), 'err'); }
  };
  /** the drive code's source (the Drive code tab), as a file of its own */
  const saveDrive = async (D: DriveCode) => {
    if (!kr) return needDesktop();
    try {
      const r = await kr.saveFile({ name: D.file, bytes: new TextEncoder().encode(D.text), title: 'Save the drive code' });
      if (r) toast(`Drive code saved to ${r.path}`, 'ok');
    } catch (e) { toast(`Save failed: ${errorText(e)}`, 'err'); }
  };
  /** where music blocks play (Settings → Toolchain) */
  const musicPlayerName = toolchain.musicPlayer === 'deepsid' ? 'DeepSID' : 'VICE';
  /** the debugger Build & Run in a debugger (Shift+F5) starts the program in */
  const debuggerName = toolchain.debugger === 'c64d' ? 'C64 Debugger' : 'Retro Debugger';
  /** The music block at `at` in VICE: a PRG of its bytes (those the export's .sid holds) with a driver that puts them
   *  where they run, calls init with the song in A, X and Y and play each frame from a raster interrupt (c64/sidplayer.ts); or
   *  in DeepSID, the online player, as the .sid the export writes (electron/main/deepsid.ts). A snapshot's player that init
   *  no longer starts again plays on from the snapshot: init puts back the bytes outside the block it reads (musicPlayData) */
  /** What a music block plays with (in VICE, in DeepSID and as the library's .sid): its bytes, init and play
   *  (musicPlayData), its name and its addresses */
  const musicData = (b: Block, A: AnalysisResult = latest.current.A, R: RenderResult = latest.current.R) => {
    const m = A.music.find(x => x.start === b.start);
    const load = spaceAddr(b.start), init = spaceAddr(m?.init ?? b.props.init ?? b.start), play = spaceAddr(m?.play ?? b.props.play ?? b.start + 3);
    const name = R.labels.get(b.start)?.name ?? `music_${h4(load)}`, span = `$${h4(load)}-$${h4(load + b.end - b.start - 1)}`;
    // a sample player (5.8b) plays with the bytes outside its block its run read: its samples and song
    const dg = m?.digi;
    // (a player the program gives its song's address in X and Y, The Last Ninja's, gets them: MusicInfo.initRegs; one
    // whose songs the program's routines start, Bomb Jack's, gets what they leave: MusicInfo.songs)
    const d = musicPlayData(A.mem.slice(b.start, b.end), load, init, play, m?.resume, dg && {
      ...dg, wrote: dg.wrote.map(([s, e]): [Addr, Addr] => [spaceAddr(s), spaceAddr(e - 1) + 1]),
      parts: dg.parts.map(([s, e]) => ({ load: spaceAddr(s), data: A.mem.slice(s, e) })),
      ...(dg.irq ? { irq: { ...dg.irq, handler: spaceAddr(dg.irq.handler) } } : {}),
    }, m?.initRegs, m?.songs?.map(s => ({ at: spaceAddr(s.at), state: s.state.map(([a, v]): [Addr, number] => [spaceAddr(a), v]) })));
    return { m, load, init, play, name, span, dg, d };
  };
  const playMusic = async (at: Addr | null | undefined) => {
    if (!kr) return needDesktop();
    const b = at != null ? findBlock(A.blocks, at) : null;
    if (!b || b.type !== 'music') { toast('Put the cursor on a music block to play it', 'warn'); return; }
    const { m, load, init, play, name, span, dg, d } = musicData(b);
    const kept = (m?.resume ?? []).filter(([a]) => a < 0xd400 || a > 0xd418), sidToo = kept.length < (m?.resume?.length ?? 0);
    const partsText = dg?.parts.length ? ` with its samples and song (${dg.parts.map(([s, e]) => `$${h4(spaceAddr(s))}-$${h4(spaceAddr(e - 1))}`).join(', ')})` : '';
    const it = dg?.nmi ? 'NMI' : 'IRQ';
    const how = dg?.loop && d.resume ? `its init $${h4(init)} does not return, so $${h4(d.resume.at)} puts back the ${kept.length} bytes, registers and vector it left, and CIA ${dg.timer?.cia ?? 2}'s timer starts again: its ${it} plays ${dg.hz} samples a second${partsText}; nothing is called each frame`
      : d.resume ? `plays on from the snapshot (init no longer starts it again): $${h4(d.resume.at)} puts back the ${kept.length} bytes it reads outside the block${sidToo ? ' and the SID as the snapshot had it' : ''}, then play $${h4(play)} each frame`
      : dg && play === 0 ? `init $${h4(init)} starts its ${it}, which plays ${dg.hz} samples a second${partsText}${dg.irq ? `, and the program's IRQ at $${h4(spaceAddr(dg.irq.handler))} starts them` : ''}; nothing is called each frame${d.wrapped ? ` ($${h4(d.wrapped.at)} calls init and ${dg.irq ? 'installs that IRQ' : 'switches off the demo\'s other interrupts'})` : ''}`
        : dg ? `init $${h4(init)} with song $00 (it starts its ${it} samples too${partsText}), then play $${h4(play)} each frame`
          // X and Y as the program gives them, loaded by a routine next to the block
          : d.regs ? `init $${h4(init)} with song $${h2(d.song ?? 0)} in A and ${regsGiven(d.regs)} as the program gives them ($${h4(d.regs.at)} loads them), then play $${h4(play)} each frame`
            // the songs the program's own routines start: what they leave, written by a routine next to the block
            : d.songs ? `$${h4(d.songs.at)} puts in place what the program's routine $${h4(d.songs.from[0])} leaves for play (song $00 of ${d.songs.count}: ${d.songs.from.map(a => `$${h4(a)}`).join(', ')}), then play $${h4(play)} each frame`
            : d.song ? `init $${h4(init)} with song $${h2(d.song)} (the one the program starts), then play $${h4(play)} each frame` : null;
    if (d.problem) toast(m?.resume ? `${name} cannot play on from the snapshot: ${d.problem}. It plays with its init $${h4(init)}, which may not start it again`
      : `${name} may not play: ${d.problem}. It plays with its init $${h4(init)} and the song in A, X and Y`, 'warn');
    // the player's PRG holds the block alone: a run of it on its own tells whether that is enough
    if (d.alone) toast(`${name} may not play: with only its block (${span}) in memory, ${d.alone}. The player may need bytes outside the block, or other entries`, 'warn');
    if (toolchain.musicPlayer === 'deepsid') {
      try {
        // (a sample player as an RSID, a real C64's interrupts, with its samples)
        const sid = musicSidFile(d, `${project.name || 'music'} ${h4(load)}`);
        // DeepSID keeps the file under its name with everyone's: the bytes' hash keeps it apart from other tunes
        let hash = 0x811c9dc5;
        for (const v of sid) hash = Math.imul(hash ^ v, 0x01000193) >>> 0;
        const file = `${name.slice(0, 40)}-${hash.toString(16).padStart(8, '0').slice(0, 6)}.sid`;
        toast(`Opening ${name} (${span}) in DeepSID…`, 'info');
        const r = await kr.playInDeepSid({ name: file, sid });
        if (r.played) toast(`DeepSID plays ${name} (${span}): ${how ?? `the .sid with init $${h4(init)} and play $${h4(play)}`}, as ${file}`, 'ok');
        else toast(`DeepSID did not start ${name}: ${r.problem}. Its window ${/did not open/.test(r.problem ?? '') ? 'is' : 'stays'} open: press L there (Load SID) and choose ${r.path}`, 'warn');
      } catch (e) { toast(`Could not play ${name} in DeepSID: ${errorText(e)}`, 'err'); }
      return;
    }
    try {
      const file0 = project.files[A.owner[b.start]]?.name;
      const p = sidPlayer({ data: d.data, load: d.load, init: d.init, play: d.play, parts: d.parts, digi: d.digi, busy: d.busy, title: file0 ? `${name} IN ${file0}` : name,
        ...(d.song != null ? { song: d.song } : {}), ...(d.regs ? { fixed: { x: d.regs.x, y: d.regs.y } } : {}) });
      const file = `${name}.prg`;
      const w = await kr.writeExport({ target: 'temp', name: 'play', files: { [file]: p.prg } });
      if (!w) return;
      await kr.run({ prgPath: `${w.dir}/${file}` });
      toast(d.resume ? `VICE plays ${name} (${span}): it ${how}. Any key starts it again from the snapshot`
        : how ? `VICE plays ${name} (${span}): ${how}. ${d.songs && d.songs.count < 10 ? (d.songs.count === 1 ? 'Key 1 starts it again' : `Keys 1-${d.songs.count} start songs $00-$${h2(d.songs.count - 1)}`) : 'Keys 1-9 and 0 start it again with songs $00-$09'}`
          : `VICE plays ${name} (${span}): init $${h4(init)} with song $00, then play $${h4(play)} each frame. Keys 1-9 and 0 start songs $00-$09, + and - the next and the one before`, 'ok');
      for (const x of p.warnings) toast(x, 'warn');
    } catch (e) { toast(`Could not play ${name}: ${errorText(e)}`, 'err'); }
  };
  /* ---- the library (spec 10.6): SID music, sprites, charsets and bitmaps kept for every project ---- */
  const libListing = useLibrary(s => s.listing);
  const libState = useLibrary.getState;
  // read when the app starts, so the Library button shows how much is in it
  useEffect(() => { void libState().load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  /** what goes in the Add to library dialog */
  const [libDraft, setLibDraft] = useState<LibraryDraft | null>(null);
  /** the Library tab is in the tab row once it was opened in this run */
  const [libTabSeen, setLibTabSeen] = useState(false);
  /** where bytes at `start`-`end` (work addresses) were taken from: the project, the file they are in, and the disk or
   *  tape that file was opened from while it is mounted */
  const librarySource = (start: Addr, end: Addr): LibrarySource => {
    const f = project.files[A.owner[start]];
    const media = f && disk && diskOf.current.get(f.id) === disk.bytes ? disk.name : f && tape && tapeOf.current.get(f.id)?.tap === tape.bytes ? tape.name : undefined;
    const proj = home?.name ?? project.name;
    return { ...(proj ? { project: proj } : {}), ...(f ? { file: f.name } : {}), ...(media ? { disk: media } : {}), start: spaceAddr(start), end: spaceAddr(end - 1) + 1 };
  };
  /** The block at `at` (a music, sprite, charset or bitmap block) in the Add to library dialog; `gfx`: a selection the
   *  Graphics tab shows as characters, sprites or a bitmap, drawn as there */
  const startLibraryAdd = (at: Addr | null | undefined, gfx?: { start: Addr; end: Addr; kind: 'chars' | 'sprites' | 'bitmap'; mc: boolean; colors: LibraryColors; bitmap?: Uint8Array }) => {
    if (!kr) return needDesktop();
    const b = gfx ? null : at != null ? findBlock(A.blocks, at) : null;
    const kind: LibraryKind | null = gfx ? (gfx.kind === 'bitmap' ? 'bitmaps' : gfx.kind) : b ? libraryKindOf(b.type) : null;
    if (!kind || (!b && !gfx)) { toast('Put the cursor on a music, sprite, charset or bitmap block to add it to the library', 'warn'); return; }
    const start = gfx ? gfx.start : b!.start, end = gfx ? gfx.end : b!.end;
    const from = librarySource(start, end);
    if (kind === 'bitmaps') {
      // the 64 KB the bitmap is in (a cartridge bank's own), its screen and colour RAM looked for there: bytes loaded
      // that are no code
      const base = start - spaceAddr(start), at64 = spaceAddr(start);
      const mem = A.mem.subarray(base, base + 0x10000);
      const ok = (s: Addr, e: Addr) => { for (let a = s; a < e; a++) { const w = base + a; if (A.owner[w] < 0 || findBlock(A.blocks, w)?.type === 'code') return false; } return true; };
      const screens = A.blocks.filter(x => x.type === 'screen' && x.start >= base && x.start < base + 0x10000).map(x => x.start - base);
      // (a part of a bitmap drawn in the Graphics tab: its 8000 bytes with only that part's)
      const bitmap = gfx?.bitmap ?? A.mem.slice(start, Math.min(end, start + 8000));
      const label = R.labels.get(start)?.name ?? `bitmap_${h4(at64)}`;
      const mc = gfx ? gfx.mc : blockMc(A, b!);
      setLibDraft({ kind, bytes: bitmap, data: bitmap, name: label, from, mc, colors: gfx ? gfx.colors : { ...useUi.getState().gfx.colors },
        pic: { bitmap, at: at64, mem, find: m => findPictureColors(mem, at64, m, ok, screens, (A.vic.colorRam ?? []).filter(c => c >= base && c < base + 0x10000).map(c => c - base)), formats: { mc: toolchain.bitmapFormatMc, hires: toolchain.bitmapFormatHires } } });
    } else if (kind === 'sid') {
      const { d, name, dg } = musicData(b!);
      const sid = musicSidFile(d, name);
      setLibDraft({ kind, bytes: sid, data: sid, name, from, ...(dg && d.digi && d.play === 0 ? { digi: d.digi, ...(d.busy?.length ? { busy: d.busy.map(([s, e]): [number, number] => [s, e]) } : {}) } : {}) });
    } else {
      const raw = A.mem.slice(start, end);
      const bytes = kind === 'chars' ? charsetFile(raw, spaceAddr(start)) : spriteFile(raw);
      const label = R.labels.get(start)?.name ?? `${kind === 'chars' ? 'charset' : 'sprites'}_${h4(spaceAddr(start))}`;
      const mc = gfx ? gfx.mc : blockMc(A, b!);
      // sprites in the colours given them in the inspector, else (and a charset) the Graphics tab's
      const own = !gfx && b!.type === 'sprite' ? b!.props.colors : undefined;
      setLibDraft({ kind, bytes, data: kind === 'chars' ? raw : bytes, name: label, from, mc, colors: gfx ? gfx.colors : own ? spritePairColors(own, mc) : { ...useUi.getState().gfx.colors } });
    }
    if (!libState().listing) void libState().load();
    setModal('library');
  };
  const addToLibrary = async (a: LibraryAnswer) => {
    const dr = libDraft;
    if (!dr) return;
    setModal(null); setLibDraft(null);
    const from: LibrarySource = { ...dr.from, ...(a.fromText ? { text: a.fromText } : {}) };
    const bytes = a.picture ? a.picture.bytes : dr.kind === 'sid' ? sidWithTexts(dr.bytes, { name: a.name, author: a.author || '<?>', released: a.fromText }) : dr.bytes;
    // (a picture has its colours in its file, and is multicolour as its format is)
    const look = a.picture ? { mc: a.picture.mc } : { ...(dr.mc != null ? { mc: dr.mc } : {}), ...(dr.colors ? { colors: dr.colors } : {}) };
    try {
      const r = await libState().add({ kind: dr.kind, stem: libraryStem(a.name, { ...from, text: a.fromText }), bytes, ...(a.picture ? { format: a.picture.format } : {}),
        entry: { name: a.name, from, ...look, ...(dr.digi ? { digi: dr.digi } : {}), ...(dr.busy ? { busy: dr.busy } : {}) } });
      toast(`Added to the library: ${LIB_KIND[dr.kind].folder}\\${r.item.file}`, 'ok');
    } catch (e) { toast(`Could not add it to the library: ${errorText(e)}`, 'err'); }
  };
  /** the item of the library with the bytes the dialog would add (its kind's) */
  const libSame = useCallback((data: Uint8Array) => (libDraft ? sameInLibrary(libListing?.items ?? [], libDraft.kind, data) : null), [libDraft, libListing]);
  /** the Library view and tab, with `ref` shown */
  const showLibrary = (ref?: LibraryRef) => {
    if (ref) libState().set({ selected: ref, ...(libState().kind !== 'all' && libState().kind !== ref.kind ? { kind: ref.kind } : {}) });
    setLibTabSeen(true);
    setUi({ tab: 'library', ...(narrow ? {} : { activity: 'library', sidePanel: true }) });
    setDrawer(null);
  };
  /** A SID of the library played: in DeepSID as it is, in VICE with Mimir's player (init with the song, then play
   *  each frame; an RSID's interrupts as they start them, a sample player's as the entry says) */
  const playLibrary = async (item: LibraryItem, o: { player?: 'vice' | 'deepsid'; song?: number } = {}) => {
    if (!kr) return needDesktop();
    if (item.kind !== 'sid') { showLibrary({ kind: item.kind, file: item.file }); return; }
    let s: ReturnType<typeof parsePsid>;
    try { s = parsePsid(item.data); } catch (e) { toast(`${item.file} is not a .sid Mimir can play: ${errorText(e)}`, 'err'); return; }
    const where = o.player ?? toolchain.musicPlayer;
    if (where === 'deepsid') {
      try {
        const file = deepSidName(item.name, item.data);
        toast(`Opening ${item.name} in DeepSID…`, 'info');
        const r = await kr.playInDeepSid({ name: file, sid: item.data });
        if (r.played) toast(`DeepSID plays ${item.name}, as ${file}`, 'ok');
        else toast(`DeepSID did not start ${item.name}: ${r.problem}. Its window ${/did not open/.test(r.problem ?? '') ? 'is' : 'stays'} open: press L there (Load SID) and choose ${r.path}`, 'warn');
      } catch (e) { toast(`Could not play ${item.name} in DeepSID: ${errorText(e)}`, 'err'); }
      return;
    }
    try {
      const song = o.song ?? Math.max(0, s.startSong - 1);
      const digi = item.digi ?? (s.play === 0 ? { nmi: false, hz: 0 } : undefined);
      const p = sidPlayer({ data: s.data, load: s.location, init: s.init, play: s.play, song, title: item.name, ...(digi ? { digi } : {}), ...(item.busy ? { busy: item.busy } : {}) });
      const w = await kr.writeExport({ target: 'temp', name: 'play', files: { 'library.prg': p.prg } });
      if (!w) return;
      await kr.run({ prgPath: `${w.dir}/library.prg` });
      toast(`VICE plays ${item.name}${s.songs > 1 ? `, song ${song + 1} of ${s.songs}` : ''}: ${s.play ? `init $${h4(s.init)}, then play $${h4(s.play)} each frame. Keys 1-9 and 0 start songs $00-$09` : `init $${h4(s.init)} starts the interrupts that play it`}`, 'ok');
      for (const x of p.warnings) toast(x, 'warn');
    } catch (e) { toast(`Could not play ${item.name}: ${errorText(e)}`, 'err'); }
  };
  const revealLibrary = (ref?: { kind?: LibraryKind; file?: string }) => {
    if (!kr) return needDesktop();
    kr.libraryReveal(ref ?? {}).catch(e => toast(`Could not open the library's folder: ${errorText(e)}`, 'err'));
  };
  /** an item's right-click menu (the Library view and tab) */
  const libraryMenu = (item: LibraryItem, x: number, y: number) => {
    const other = toolchain.musicPlayer === 'vice' ? 'deepsid' : 'vice';
    setMenu({ x, y, items: [
      { header: item.name },
      ...(item.kind === 'sid' ? [
        { label: `Play in ${musicPlayerName}`, icon: 'play', run: () => void playLibrary(item) },
        { label: `Play in ${other === 'vice' ? 'VICE' : 'DeepSID'}`, run: () => void playLibrary(item, { player: other }) },
        { sep: true },
      ] satisfies MenuItem[] : []),
      // an Assembler project (spec 10.7): the item as a block of the source the Assembler shows, where its caret is
      ...(asmMode ? [{ label: 'Insert in the source as a block…', icon: 'blocks', run: () => { setUi({ tab: 'asm' }); useAsmLink.getState().request('block', { lib: { kind: item.kind, file: item.file } }); } }] satisfies MenuItem[] : []),
      { label: 'Show it in the Library tab', icon: 'library', run: () => showLibrary({ kind: item.kind, file: item.file }) },
      { label: 'Show its file', icon: 'folder', run: () => revealLibrary({ kind: item.kind, file: item.file }) },
      { sep: true },
      { label: 'Move to the Recycle Bin', icon: 'trash', run: () => { libState().remove({ kind: item.kind, file: item.file }).then(() => toast(`${item.file} is in the Recycle Bin`, 'ok'), e => toast(`Could not move it to the Recycle Bin: ${errorText(e)}`, 'err')); } },
    ] });
  };
  const goPatch = (p: Patch) => { navigate(p.start, { center: true, listing: true }); setSel({ start: p.start, end: patchEnd(p), multi: true, anchor: p.start, anchorEnd: patchEnd(p) }); setTimeout(() => listRef.current?.focus(), 0); };
  /** the listing at a view offset's first byte, with its bytes selected (10.4) */
  const goViewOffset = (o: ViewOffset) => { navigate(o.start, { center: true, listing: true }); setSel({ start: o.start, end: o.end, multi: true, anchor: o.start, anchorEnd: o.end }); setTimeout(() => listRef.current?.focus(), 0); };
  /** the listing where a junk area was (11.7): the bytes right after it, else those right before it */
  const goJunk = (j: JunkArea) => {
    const a = A.owner[j.end] >= 0 ? j.end : j.start > 0 && A.owner[j.start - 1] >= 0 ? j.start - 1 : null;
    if (a == null) { toast(`Nothing loaded is next to $${h4(j.start)}–$${h4(j.end - 1)}`, 'warn'); return; }
    navigate(a, { center: true, listing: true });
  };
  /* ---- cycle counting: the branches the user marks as taken (view state, not in the project) ---- */
  const [taken, setTaken] = useState<ReadonlySet<Addr>>(() => new Set());
  const toggleTaken = (pc: Addr) => setTaken(t => { const n = new Set(t); if (n.has(pc)) n.delete(pc); else n.add(pc); return n; });
  const addEntry = (at?: Addr) => { const a = lineAddr(at); if (a == null) return; update(`Entry point $${h4(a)}`, d => { if (!d.entries.includes(a)) d.entries.push(a); }); toast(`Added entry point $${h4(a)}; tracing from there`, 'ok'); };
  /** the label a `.label name = $xxxx` line defines (the zero-page variables and the labels of other files in the file
   *  head, those inside binary blocks); null for any other line and for hardware symbols written inline */
  const labelDefAt = (l: ListingLine | null | undefined): { addr: Addr; zp: boolean } | null => {
    if (!l || l.k !== 'dir' || !isLabelDefinition(l)) return null;
    if (l.zp != null) return { addr: l.zp, zp: true };
    const def = l.tok.find(t => t.t === 'def');
    if (def) for (const [a, x] of R.labels) if (x.name === def.s) return { addr: a, zp: false };
    return null;
  };
  /** the `.label` line clicked last: the cursor is only an address, and the file head's lines all share one */
  const [pickedDef, setPickedDef] = useState<{ addr: Addr; zp: boolean; line: number; at: Addr } | null>(null);
  /** the zero-page variable of a listing line: its `.label` line in the file head, or one of the comment lines above
   *  it; `line` is the `.label` line (where the editors open) */
  const zpDefOf = (l: ListingLine, i: number): { addr: Addr; zp: true; line: number } | null => {
    if ((l.k !== 'dir' && l.k !== 'cmt') || l.zp == null) return null;
    let j = i;
    while (j < view.lines.length) { const x = view.lines[j]; if (x.k === 'dir' && x.zp === l.zp) break; j++; }
    return { addr: l.zp, zp: true, line: j < view.lines.length ? j : i };
  };
  /** the line of the `.label` clicked last while the cursor is still there (the listing marks it): a zero-page
   *  variable's line moves when comment lines go in above it, so it is looked up by its address, nearest the click */
  const pickedLine = useMemo(() => {
    if (!pickedDef || pickedDef.at !== cursor) return null;
    if (!pickedDef.zp) return pickedDef.line;
    let best = -1;
    view.lines.forEach((l, i) => { if (l.k === 'dir' && l.zp === pickedDef.addr && (best < 0 || Math.abs(i - pickedDef.line) < Math.abs(best - pickedDef.line))) best = i; });
    return best >= 0 ? best : null;
  }, [pickedDef, cursor, view]);
  /** the zero-page variable clicked last, while the cursor is still there: `;`, `/`, `*` and N act on it */
  const pickedZp = (at?: Addr) => (at == null && pickedDef?.zp && pickedDef.at === cursor ? { ...pickedDef, line: pickedLine ?? pickedDef.line } : null);
  /** the label picked (its line clicked in the listing, or the label in the Symbols view): a box beside its line lists
   *  who references it (lib/labelrefs.ts). `a` the label's address (`zp`: a zero-page variable), `line` its line when
   *  picked, `at` the cursor then: the box is there while the cursor is. `via`: the reference gone to from the box,
   *  where the box waits (hidden) so that Esc or Alt+← back at the label shows it again */
  const [xrefPick, setXrefPick] = useState<{ a: Addr; zp: boolean; line: number; at: Addr; via: Addr | null } | null>(null);
  useEffect(() => { if (xrefPick && cursor !== xrefPick.at && cursor !== xrefPick.via) setXrefPick(null); }, [cursor]); // eslint-disable-line react-hooks/exhaustive-deps
  // renaming the label (a double-click on it) closes the box
  useEffect(() => { if (editing) setXrefPick(null); }, [editing]);
  /** the line of the picked label in the listing now (the lines move when blocks fold or the analysis lands): its own
   *  line, a `.label` line in the file head, or a zero-page variable's (nearest the one clicked) */
  const xrefLine = useMemo((): number | null => {
    const p = xrefPick;
    if (!p || cursor !== p.at) return null;
    const ls = view.lines, name = p.zp ? null : R.labels.get(p.a)?.name;
    const is = (l: ListingLine | undefined) => !!l && (p.zp ? l.k === 'dir' && l.zp === p.a
      : (l.k === 'lbl' && l.a === p.a) || (l.k === 'dir' && l.zp == null && name != null && isLabelDefinition(l) && l.tok.find(t => t.t === 'def')?.s === name));
    if (is(ls[p.line])) return p.line;
    // its own line is above the line of its address (with comment lines and empty lines between)
    if (!p.zp && lineOf[p.a] >= 0) for (let j = lineOf[p.a]; j >= 0 && j > lineOf[p.a] - 200 && ls[j].a === p.a; j--) if (is(ls[j])) return j;
    let best = -1;
    ls.forEach((l, i) => { if (is(l) && (best < 0 || Math.abs(i - p.line) < Math.abs(best - p.line))) best = i; });
    return best >= 0 ? best : null;
  }, [xrefPick, cursor, view, lineOf, R]);
  const xrefBox = useMemo((): XrefBox | null => {
    const p = xrefPick;
    if (!p || xrefLine == null) return null;
    const name = (p.zp ? R.zp.get(p.a)?.name : R.labels.get(p.a)?.name) ?? `$${h4(p.a)}`;
    return { line: xrefLine, name, adr: p.zp ? `$${h2(p.a)}` : bankAdr(A, shownAddress(R.viewOffsets, p.a)), zp: p.zp, refs: labelRefs(A, R, p.a, p.zp), via: p.via };
  }, [xrefPick, xrefLine, A, R]);
  /** a reference in the box: the listing goes there (in the history, so Esc comes back to the label and the box) */
  const goXref = (from: Addr) => { setXrefPick(p => (p ? { ...p, via: from } : p)); navigate(from, { center: true }); listRef.current?.focus(); };
  const startDefRename = (d: { addr: Addr; zp: boolean }, line: number) => {
    setLabelError(null);
    setEditing({ kind: 'label', addr: d.addr, value: (d.zp ? R.zp.get(d.addr)?.name : R.labels.get(d.addr)?.name) ?? '', zp: d.zp, line });
    setUi({ tab: 'listing' });
  };
  const startRename = (at?: Addr) => {
    if (at == null && pickedDef && pickedDef.at === cursor) { startDefRename(pickedDef, pickedLine ?? pickedDef.line); return; }
    const p = lineAddr(at); if (p == null) return; const a = A.codeOwner[p] >= 0 ? A.codeOwner[p] : p; setLabelError(null); setEditing({ kind: 'label', addr: a, value: R.labels.get(a)?.name ?? '' }); setUi({ tab: 'listing' });
  };
  /** the label (or zero-page variable) of a line's operand, which Shift+N renames: `l` the line (else the cursor's),
   *  `cell` the byte of a data line clicked (else the one at the cursor when bytes are selected) */
  const operandOf = (l: ListingLine | null = curLine, cell: Cell | null = l === curLine && sel?.bytes && cursor != null ? cellAt(curLine, cursor) : null): NameRef | null => {
    // a `.label` line of the file head clicked last: the cursor line under it is not the one the user means
    if (l === curLine && pickedDef && pickedDef.at === cursor) return null;
    return operandName(l, R, cell);
  };
  /** Shift+N: rename what the operand names from its line (`lda l_3000,y` renames l_3000), as at the label itself; the
   *  editor opens under the line */
  const startOperandRename = (l: ListingLine | null = curLine, cell?: Cell | null) => {
    const o = operandOf(l, cell), i = l ? view.lines.indexOf(l) : -1;
    if (!o || i < 0) { toast('The operand of the cursor line names no label or zero-page variable (N renames the line\'s own label)', 'info'); return; }
    setLabelError(null);
    setEditing({ kind: 'label', addr: o.addr, value: o.name, line: i, ...(o.zp ? { zp: true } : {}) });
    setUi({ tab: 'listing' });
  };
  /** `;`: the comment at the end of a line; `z`: of a zero-page variable's `.label` line (Project.comments at its address) */
  const startComment = (at?: Addr, z: { addr: Addr; line: number } | null = pickedZp(at)) => {
    if (z) { setEditing({ kind: 'comment', addr: z.addr, value: project.comments[z.addr] || '', zp: true, line: z.line }); setUi({ tab: 'listing' }); return; }
    const a = lineAddr(at); if (a == null) return; setEditing({ kind: 'comment', addr: a, value: project.comments[a] || '' }); setUi({ tab: 'listing' });
  };
  /** `/` and `*`: write or edit the comment line or block on lines of its own above a line (`z`: above a zero-page
   *  variable's `.label` line) */
  const startNote = (block: boolean, at?: Addr, z: { addr: Addr; line: number } | null = pickedZp(at)) => {
    const a = z ? z.addr : lineAddr(at); if (a == null) return;
    const old = project.notes[a]?.text ?? '';
    setEditing({ kind: 'note', addr: a, value: block ? old : old.replace(/\s*\n\s*/g, ' '), block, ...(z ? { zp: true, line: z.line } : {}) });
    setUi({ tab: 'listing' });
  };
  const commitEdit = (v: string) => {
    if (!editing) return;
    if (editing.kind === 'label') {
      const what = editing.zp ? `Zero-page variable $${h2(editing.addr)}` : null;
      if (rename(editing.addr, v.trim())) { setEditing(null); toast(v.trim() ? `${what ? `${what} renamed` : 'Renamed'} to ${v.trim()}; all references updated${learned.current ? '. Mimir knows the routine now: other projects get the name suggested' : ''}` : `${what ?? 'Label'}: automatic name restored`, 'ok'); }
    }
    else if (editing.kind === 'note') { setNote(editing.addr, editing.block ? v.replace(/^(\s*\n)+/, '').trimEnd() : v.trim(), !!editing.block, editing.blank, editing.replace); setEditing(null); }
    else { setComment(editing.addr, v.trim()); setEditing(null); }
    setTimeout(() => listRef.current?.focus(), 0);
  };

  /* ---- verify / build / run / export ---- */
  const extraFiles = useMemo(() => projectTextFiles(project, R, S), [project, R, S]);
  /** build.bat / build.sh edited in the source view; the template's or the generated text again (or null) drops the
   *  edit */
  const setScript = (path: BuildScript, text: string | null) => {
    const tpl = project.buildTemplate ?? null;
    const value = text == null || text === templateScripts({ ...project, settings: S }, S, R.fileNames)[path] ? null : text;
    if ((project.scripts?.[path] ?? null) === value) return;
    update(value == null ? (tpl ? `Restore ${path} from the template` : `Restore generated ${path}`) : `Edit ${path}`, d => { d.scripts ??= {}; if (value == null) delete d.scripts[path]; else d.scripts[path] = value; });
    if (text == null) toast(tpl ? `${path} is made from the template "${tpl.name}" again` : `${path} is generated again from the toolchain settings`, 'ok');
  };

  /* ---- build templates (spec 11.4b): build.bat and build.sh with placeholders, the app's library and Mimir's own ---- */
  const tplLibrary = useBuildTemplates(s => s.library);
  /** the template a key names (templateKey): Mimir's for the project's assembler, the library's, or the project's
   *  own copy of one the library does not have */
  const templateOf = (key: string): BuildTemplate | null => {
    if (key.startsWith('builtin:')) return builtInTemplate(key.slice('builtin:'.length) as BuiltInTemplateId, S, !!project.cart);
    const name = key.slice('user:'.length), mine = project.buildTemplate;
    return tplLibrary.find(t => t.name === name) ?? (mine && !mine.builtIn && mine.name === name ? mine : null);
  };
  /** build.bat and build.sh made from the template from now on (null: generated again); the user's edits of them are
   *  dropped, so the template's scripts are what the export writes (Ctrl+Z brings them back) */
  const applyTemplate = (t: BuildTemplate | null) => {
    const edits = Object.keys(project.scripts ?? {}).length > 0;
    if (!t && !project.buildTemplate && !edits) return;
    update(t ? `Build scripts from the template "${t.name}"` : 'Build scripts generated again', d => { d.buildTemplate = t ? { ...t } : null; d.scripts = {}; });
    const dropped = edits ? ': your edits of them were dropped (Ctrl+Z brings them back)' : '';
    toast(t ? `build.bat and build.sh are made from the template "${t.name}"${dropped}` : `build.bat and build.sh are generated from the toolchain settings again${dropped}`, 'ok');
  };
  /** the template editor open, showing a template's key first or a new template ('new') */
  const [tplStart, setTplStart] = useState<string | undefined>(undefined);
  const openTemplates = (start?: string) => { setTplStart(start); setModal('templates'); };
  /** the name of the project's template while the editor changes it (a rename too): the project's copy follows it when
   *  the editor closes, as one step */
  const tplFollow = useRef<string | null>(null);
  const saveTemplate = (t: BuildTemplate, was?: string) => {
    const mine = latest.current.project.buildTemplate;
    if (mine && !mine.builtIn && (mine.name === (was ?? t.name) || mine.name === tplFollow.current)) tplFollow.current = t.name;
    useBuildTemplates.getState().save(t, was);
  };
  const closeTemplates = () => {
    setModal(null);
    const name = tplFollow.current; tplFollow.current = null;
    const mine = latest.current.project.buildTemplate, now = name ? useBuildTemplates.getState().library.find(t => t.name === name) : undefined;
    if (!mine || mine.builtIn || !now || (now.name === mine.name && now['build.bat'] === mine['build.bat'] && now['build.sh'] === mine['build.sh'])) return;
    update(`Update the build template "${now.name}"`, d => { d.buildTemplate = { ...now }; });
    toast(`build.bat and build.sh follow your changes to the template "${now.name}"`, 'ok');
  };
  /** the project's assembler (spec 11.8) and the tool that builds with it: KickAss.jar or 64tass */
  const asmTool = asm === '64tass' ? '64tass' : 'KickAss.jar';
  const kickAvailable = !!kr && !!(asm === '64tass' ? toolchain.tassPath : toolchain.kickJar);

  /** Built-in verifier in the worker, then (when configured) the real KickAss.jar or 64tass in a temp build folder. */
  const runVerify = async (opts: { quiet?: boolean } = {}): Promise<BuildState | null> => {
    if (!latest.current.project.files.length) { toast('The project has no files yet: open a PRG, a snapshot or a cartridge first', 'warn'); return null; }
    try {
      setBuildBusy('Verifying');
      // verify what the listing will show: F7 right after an edit waits for the analysis of that edit, or it would
      // check the previous state and mark the result stale ("round-trip not verified") once the new one arrives
      await analysisSettled();
      const { R, aKey, project: snapshot } = latest.current;
      const key = filesKey(R);
      const V: VerifyResult & { ms: number } = await verifyInWorker(snapshot, aKey);
      const log: string[] = [];
      for (const r of V.results) {
        log.push(`> built-in ${asm === '64tass' ? '64tass' : 'Kick'}-subset assembler: ${r.path}`);
        if (r.errors.length) { log.push('Errors:'); for (const e of r.errors.slice(0, 20)) log.push(`  ${e.file}:${e.line}  ${e.msg}`); }
        log.push('Memory map:'); for (const b of r.blocks) log.push(`  $${h4(b.start)}-$${h4(Math.max(b.start, b.end))} ${b.name}`);
        log.push(`${r.ok ? 'Round-trip OK' : 'Round-trip FAILED'}: ${r.same} / ${r.total} bytes identical to ${r.file}${r.excluded ? ` (${r.excluded} bytes left out of the build)` : ''}`);
        for (const d of r.diffs.slice(0, 12)) log.push(d.msg ? `  ${d.msg}` : `  $${h4(d.addr)}: expected $${h2(d.exp ?? 0)}, got ${d.got == null ? 'nothing' : '$' + h2(d.got)}`);
        log.push('');
      }
      log.push(`Built-in verification took ${V.ms.toFixed(0)} ms.`, '');
      // a cartridge (13.9): the image rebuilt from the chips just built, byte for byte against the one opened (with the
      // patches written over its chips)
      const image = snapshot.cart ? (() => { try { return parseCrt(snapshot.cart.crt, snapshot.cart.name); } catch { return null; } })() : null;
      const expected = image ? expectedCartridge(snapshot) : null;
      const patched = snapshot.patches.some(p => !p.off) && !!expected && !expected.every((v, i) => v === image?.bytes[i]);
      const checkCart = (name: string, built: Uint8Array | null, problems: string[] = [], path?: string): CartCheck => {
        const c = image && expected ? compareCrt(image, built, expected) : { ok: false, same: 0, total: 0, diffs: ['the cartridge image cannot be read'] };
        return { ...c, ok: c.ok && !problems.length, diffs: [...problems, ...c.diffs], name, crt: built, ...(path ? { path } : {}) };
      };
      const cartLog = (c: CartCheck, by: string) => {
        log.push(`${by} cartridge ${c.ok ? 'OK' : 'FAILED'}: ${c.name} ${c.same} / ${c.total} bytes identical to ${snapshot.cart?.name}${patched ? ' with the patches' : ''}`);
        for (const d of c.diffs.slice(0, 8)) log.push(`  ${d}`);
      };
      let cart: CartCheck | null = null;
      if (snapshot.cart) {
        const b = builtCartridge(snapshot, V.results.map(r => r.prg));
        cart = checkCart(b?.name ?? `${snapshot.name}.crt`, b?.crt ?? null, b?.problems);
        cartLog(cart, 'Built-in');
        log.push('');
      }
      let kick: KickBuild | null = null;
      if (kickAvailable && kr) {
        setBuildBusy(`Assembling with ${asmTool}`);
        // the cartridge's own source comes last: it takes the chips' PRGs the others built
        const cs = cartridgeFiles(snapshot, R, latest.current.S);
        // the files with a source of their own: with every bank in one source (13.9c) the chips have none
        const own = R.fileNames.map((n, i) => ({ n, i })).filter(x => !(cs?.one && snapshot.files[x.i]?.chip != null));
        // in the project's build folder (without a project in a fresh folder in temp)
        const w = await kr.writeExport({ target: 'build', name: snapshot.name.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 40), files: { ...R.files, ...cs?.files } });
        if (w) {
          const res = await kr.build({ dir: w.dir, entries: [...own.map(x => `${x.n}.asm`), ...(cs ? [cs.entry] : [])], assembler: asm });
          log.push(res.stdout.trim());
          if (!res.outputs.length) log.push('', `${asmTool} was not run: ${res.problems.map(p => p.message).join('; ')}`, 'Verified with the built-in assembler only.');
          else {
            const compared = res.outputs.slice(0, own.length).map((o, k) => { const i = own[k].i, c = comparePrg(snapshot.files[i], o.prg, R.excluded.filter(x => x.file === i).map(x => ({ start: spaceAddr(x.start), end: spaceAddr(x.start) + x.end - x.start }))); return { entry: o.entry, ok: o.ok && c.ok, same: c.same, total: c.total, excluded: c.excluded, prgPath: o.prgPath, vsPath: o.vsPath, prg: o.prg, diffs: c.diffs }; });
            const co = cs ? res.outputs[own.length] : undefined;
            const kickCart = cs ? { ...checkCart(cs.output, co?.ok ? co.prg : null, co && !co.ok ? [`${cs.entry} did not assemble`] : [], co?.prgPath), ...(co?.vsPath ? { vs: co.vsPath } : {}) } : null;
            kick = { ok: res.ok && compared.every(c => c.ok) && (!kickCart || kickCart.ok), dir: w.dir, problems: res.problems, compared, cart: kickCart };
            log.push('');
            for (const c of compared) {
              log.push(`${asmTool} round-trip ${c.ok ? 'OK' : 'FAILED'}: ${c.entry} ${c.same} / ${c.total} bytes identical${c.excluded ? `, ${c.excluded} left out of the build` : ''} (${res.ms} ms total)`);
              for (const d of c.diffs.slice(0, 8)) log.push(d.msg ? `  ${d.msg}` : `  $${h4(d.addr)}: expected $${h2(d.exp ?? 0)}, got ${d.got == null ? 'nothing' : '$' + h2(d.got)}`);
            }
            if (kickCart) cartLog(kickCart, asmTool);
            log.push(`Build folder: ${w.dir}`);
          }
        }
      }
      const res: BuildState = { ok: V.ok && (cart ? cart.ok : true) && (kick ? kick.ok : true), log: log.join('\n'), key, at: Date.now(), V, kick, cart };
      setBuild(res);
      if (!opts.quiet) {
        setUi({ bottom: 'build', panelOpen: true });
        toast(res.ok ? `Round-trip verified${kick ? ` with ${asmTool}` : ''}: output is byte-identical` : 'Round-trip found differences; see Build output', res.ok ? 'ok' : 'err');
      }
      return res;
    } catch (e) {
      toast(`Verification failed: ${errorText(e)}`, 'err');
      return null;
    } finally {
      setBuildBusy(null);
    }
  };

  /**
   * the mounted disk for drive 8, as a copy in a build folder: a program that saves to it leaves the original alone.
   * The project's files that came from it are written back into the copy as they were built, in their own sectors (a
   * G64's data blocks encoded again in place, its copy protection as it was), so the disk's own boot loads them.
   * `wrote`: the files written back; `skipped`: why others were not.
   */
  const diskCopy = async (built?: (i: number) => Uint8Array | null): Promise<{ path: string; wrote: string[]; skipped: string[] } | undefined> => {
    if (!disk || !kr) return undefined;
    const ext = disk.img.format === 'G64' ? 'g64' : 'd64';
    const copy = /\.[dg]64$/i.test(disk.name) ? disk.name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_') : `disk.${ext}`; // eslint-disable-line no-control-regex
    let bytes = disk.bytes;
    const wrote: string[] = [], skipped: string[] = [];
    if (built) {
      latest.current.project.files.forEach((pf, i) => {
        const f = diskFileOf.current.get(pf.id), prg = built(i);
        if (!f || diskOf.current.get(pf.id) !== disk.bytes || !prg) return;
        try {
          const before = readD64File(bytes, f);
          if (before.length === prg.length && before.every((v, k) => v === prg[k])) return;
          bytes = writeDiskFile(bytes, f, prg);
          wrote.push(f.name);
        } catch (e) { skipped.push(`${f.name}: ${errorText(e)}`); }
      });
    }
    const w = await kr.writeExport({ target: 'temp', name: 'disk', files: { [copy]: bytes } });
    return w ? { path: `${w.dir}/${copy}`, wrote, skipped } : undefined;
  };

  /** the project's files that came from the T64 in the datasette, as built, by their directory slot; `wrote`: the
   *  names of those the build changed */
  const t64Built = (built: (i: number) => Uint8Array | null): { slots: Map<number, Uint8Array>; wrote: string[] } => {
    const slots = new Map<number, Uint8Array>(), wrote: string[] = [];
    if (!tape?.img.t64) return { slots, wrote };
    latest.current.project.files.forEach((pf, i) => {
      const t = tapeOf.current.get(pf.id), prg = built(i);
      if (!t || t.tap !== tape.bytes || !t.file.t64 || !prg || prg.length < 2) return;
      const f = t.file, same = f.load === (prg[0] | (prg[1] << 8)) && f.data.length === prg.length - 2 && f.data.every((v, k) => v === prg[k + 2]);
      slots.set(t.file.t64.slot, prg);
      if (!same) wrote.push(f.name);
    });
    return { slots, wrote };
  };

  /** the tape in the datasette, as a copy in a build folder; a T64's with the project's files that came from it
   *  written back as built (`wrote`), as diskCopy does it for a disk, so LOAD from the tape finds them */
  const tapeCopy = async (built?: (i: number) => Uint8Array | null): Promise<{ path: string; wrote: string[] } | undefined> => {
    if (!tape || !kr) return undefined;
    const ext = tape.img.t64 ? 't64' : 'tap';
    const copy = new RegExp(`\\.${ext}$`, 'i').test(tape.name) ? tape.name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_') : `tape.${ext}`; // eslint-disable-line no-control-regex
    let bytes = tape.bytes, wrote: string[] = [];
    if (tape.img.t64 && built) { const b = t64Built(built); if (b.wrote.length) { bytes = writeT64(tape.bytes, b.slots); wrote = b.wrote; } }
    const w = await kr.writeExport({ target: 'temp', name: 'tape', files: { [copy]: bytes } });
    return w ? { path: `${w.dir}/${copy}`, wrote } : undefined;
  };

  /** The build with the scripts that run before Build & Run (UserScript.when 'build') run on it, in the project's order,
   *  each on what the one before left: the built programs with what the scripts changed, written as files of their own
   *  for the emulator, and what each did in the build log. The project, its source and the verified build are as they
   *  were. null: a script could not run or did not end well, and that was said (nothing is started) */
  const withBuildScripts = async (res: BuildState, emu: string): Promise<BuildState | null> => {
    const { project: p, R: r } = latest.current;
    const hooks = (p.userScripts ?? []).filter(s => s.when === 'build');
    if (!hooks.length || !kr) return res;
    if (p.cart) { toast('Scripts that run before Build & Run are not run for a cartridge: its chips are banks, not one memory', 'info'); return res; }
    if (useScripts.getState().running) { toast(`A script is running: wait for it, or stop it in the Scripts tab; ${emu} was not started`, 'warn'); return null; }
    const prgOf = (i: number) => res.kick?.compared[i]?.prg ?? res.V.results[i]?.prg ?? null;
    let files = p.files.map((f, i) => { const prg = prgOf(i); return prg && prg.length > 2 ? { load: prg[0] | (prg[1] << 8), bytes: prg.slice(2) } : { load: f.load, bytes: f.bytes }; });
    const log: string[] = [];
    try {
      for (const s of hooks) {
        setBuildBusy(`Running the script "${s.name}"`);
        const env: ScriptEnv = { ...scriptsEnv, files };
        const c = checkScript(env, s);
        if (!c.ok) { const e = c.problems.find(x => x.level === 'error'); toast(`The script "${s.name}", which runs before Build & Run, does not check out${e?.line ? ` (line ${e.line})` : ''}: ${e?.msg}. ${emu} was not started`, 'err'); return null; }
        const opts = await scriptRunOpts(s, env, s.pads, c);
        if (!opts) return null;
        useScripts.getState().set({ running: s.id });
        let run: ScriptRun;
        try { run = await runScriptInWorker(env, s, opts); } finally { useScripts.getState().set({ running: null }); }
        if (!endedWell(run.end)) { toast(`The script "${s.name}", which runs before Build & Run: ${scriptEndText(run)} ${emu} was not started`, 'err'); return null; }
        files = withRunChanges(files, run);
        log.push(`> the script "${s.name}" ran on the built program: ${runChangeText(run)}`);
      }
      const names = files.map((_, i) => `${r.fileNames[i] ?? `file${i}`}.prg`), prgs = files.map(f => makePrg(f.load, f.bytes));
      const w = await kr.writeExport({ target: 'temp', name: 'scripted', files: Object.fromEntries(names.map((n, i) => [n, prgs[i]])) });
      if (!w) return null;
      setBuild(b => b && { ...b, log: `${b.log}\n\n${log.join('\n')}\n  (what ${emu} runs is the built program with these changes, in ${w.dir}; the project and its source are as they were)` });
      return { ...res,
        V: { ...res.V, results: res.V.results.map((x, i) => (prgs[i] ? { ...x, prg: prgs[i] } : x)) },
        kick: res.kick ? { ...res.kick, compared: res.kick.compared.map((x, i) => (prgs[i] ? { ...x, prg: prgs[i], prgPath: `${w.dir}/${names[i]}` } : x)) } : res.kick };
    } catch (e) { toast(`${errorText(e) === 'stopped' ? 'The script was stopped' : errorText(e)}: ${emu} was not started`, 'err'); return null; }
  };
  /** Build & Run: build and verify, then start the program in VICE (F5), or (`inDebugger`, Shift+F5) in the debugger
   *  Settings → Toolchain names, the way VICE starts it (spec 13.2b) */
  const runBuild = async (inDebugger = false) => {
    if (!kr) return needDesktop();
    const emu = inDebugger ? debuggerName : 'VICE';
    const verified = await runVerify({ quiet: true });
    setUi({ bottom: 'build', panelOpen: true });
    if (!verified) return;
    if (!verified.ok) { toast(`Build failed verification; ${emu} was not started`, 'err'); return; }
    // the scripts that run before Build & Run work on the program just built: what they change is in what runs
    const res = await withBuildScripts(verified, emu);
    if (!res) return;
    // the analysis and render that were verified (runVerify waited for the latest edit)
    const { A, R, project } = latest.current;
    try {
      setBuildBusy(`Starting ${emu}`);
      // the run in VICE or the debugger; a debugger's command line, start code and notes go into the build log
      const run = (req: RunRequest) => kr.run(inDebugger ? { ...req, debugger: true } : req);
      const started = (r: RunResult, what: string) => `> ${emu} started (pid ${r.pid}): ${what}${runDetail(r)}`;
      const note = (r: RunResult) => (r.notes?.length ? ` (${r.notes.join('; ')})` : '');
      const level = (r: RunResult) => (r.notes?.length ? 'warn' : 'ok');
      const built = (i: number) => res.kick?.compared[i]?.prg ?? res.V.results[i]?.prg ?? null;
      const dc = await diskCopy(built);
      const diskPath = dc?.path;
      if (dc?.skipped.length) toast(`Not written back to the disk's copy: ${dc.skipped.join('; ')}`, 'warn');
      const back = dc?.wrote.length ? ` with ${dc.wrote.join(', ')} written back as built` : '';
      const drive = diskPath && disk ? `, ${disk.name} in drive 8 (a copy: ${diskPath}${back})` : '';
      // a cartridge (13.9): VICE attaches the image just rebuilt (KickAss.jar's, else the built-in one's) and resets,
      // and the C64 starts it from its vectors; the program start is not used
      if (project.cart) {
        let crtPath = res.kick?.cart?.ok ? res.kick.cart.path : undefined;
        if (!crtPath) {
          if (!res.cart?.crt) throw new Error('the cartridge was not rebuilt');
          const w = await kr.writeExport({ target: 'temp', name: 'run', files: { [res.cart.name]: res.cart.crt } });
          if (!w) return;
          crtPath = `${w.dir}/${res.cart.name}`;
        }
        // the labels of the first chip's source, or of the one source with every bank (13.9c)
        const labels = (project.settings.cartOneSource ? res.kick?.cart?.vs : undefined) ?? res.kick?.compared[0]?.vsPath ?? undefined;
        const r = await run({ prgPath: crtPath, labelsPath: labels, disk: diskPath, cart: true });
        setBuild(b => b && { ...b, log: `${b.log}\n\n${started(r, `the cartridge ${crtPath} attached (${inDebugger ? '-crt' : '-cartcrt'})${labels ? ` with labels from ${labels}` : ''}${drive}`)}` });
        toast(`${emu} started the cartridge ${res.cart?.name ?? project.cart.name}${labels ? ` with labels in the ${inDebugger ? 'debugger' : 'monitor'}` : ''}${diskPath && disk ? `, ${disk.name} in drive 8` : ''}${note(r)}`, level(r));
        return;
      }
      // a project opened from a VICE snapshot: VICE restarts the snapshot as it was taken (CPU, $01, VIC, SID, CIAs,
      // colour RAM, drives) and goes on from its PC, with the programs just built in its RAM; the program start is not used
      const snapAt = project.files.findIndex(f => f.vsf);
      if (snapAt >= 0) {
        const prgs = project.files.map((_, i) => res.kick?.compared[i]?.prg ?? res.V.results[i]?.prg).filter((p): p is Uint8Array => !!p);
        const vsf = patchSnapshot(project.files[snapAt].vsf!, prgs);
        const name = `${R.fileNames[snapAt]}.vsf`;
        const w = await kr.writeExport({ target: 'temp', name: 'run', files: { [name]: vsf } });
        if (!w) return;
        const vsfPath = `${w.dir}/${name}`, labels = res.kick?.compared[snapAt]?.vsPath ?? undefined;
        const s = parseVsf(vsf, name);
        const at = [s.cpu ? `PC $${h4(s.cpu.pc)}` : null, `$01 = $${h2(s.port.data)}`].filter(Boolean).join(', ');
        const r = await run({ prgPath: vsfPath, labelsPath: labels, disk: diskPath });
        // (a debugger gets the snapshot written as it reads one, with the disk in it: its notes say what it does not get)
        const inSnap = r.snapshot ? (r.snapshot.disk && disk ? `, ${disk.name} in the snapshot as drive 8's disk` : '') : drive;
        setBuild(b => b && { ...b, log: `${b.log}\n\n${started(r, `${r.snapshot?.path ?? vsfPath}${labels ? ` with labels from ${labels}` : ''}, the snapshot restarted as it was taken (${at}), the built program in its RAM${inSnap}`)}` });
        toast(`${emu} restarted the snapshot as it was taken (${at}), with the built program in its RAM${labels ? `; labels in the ${inDebugger ? 'debugger' : 'monitor'}` : ''}${r.snapshot ? `. Its C64 model must be the ${r.snapshot.model}` : ''}`, 'ok');
        return;
      }
      // a project whose first file came from a KERNAL file of the tape in the datasette (13.5f): VICE loads the tape
      // with that file written again from the build (and its header, when it is in the project) as its first file and
      // the rest of the tape as it was after it, so the program's own tape loader reads on from there
      const t0 = tapeOf.current.get(project.files[0]?.id ?? '');
      if (t0 && !t0.header && t0.file.format === 'cbm' && t0.file.header && tape && t0.tap === tape.bytes) {
        const built = (i: number) => res.kick?.compared[i]?.prg ?? res.V.results[i]?.prg ?? null;
        const data = built(0);
        if (!data) throw new Error('nothing to run');
        const hi = project.files.findIndex(f => { const t = tapeOf.current.get(f.id); return !!t?.header && t.file === t0.file; });
        const hb = hi >= 0 ? built(hi) : null;
        const header = hb && hb.length === 194 ? hb.slice(2) : t0.file.header.slice();
        const load = data[0] | (data[1] << 8), end = load + data.length - 2;
        header[1] = load & 0xff; header[2] = load >> 8; header[3] = end & 0xff; header[4] = (end >> 8) & 0xff;
        const name = `${R.fileNames[0]}.tap`;
        const w = await kr.writeExport({ target: 'temp', name: 'run', files: { [name]: replaceTapeFile(tape.bytes, t0.file, header, data.subarray(2)) } });
        if (!w) return;
        const tapPath = `${w.dir}/${name}`, labels = res.kick?.compared[0]?.vsPath ?? undefined;
        const r = await run({ prgPath: tapPath, labelsPath: labels, disk: diskPath });
        const what = `the built ${R.fileNames[0]}${hb ? ` and its header (${R.fileNames[hi]})` : ''} as its first file, then ${tape.name} from after "${t0.file.name}"`;
        setBuild(b => b && { ...b, log: `${b.log}\n\n${started(r, `${tapPath} autostarted, ${what}${labels ? `, labels from ${labels}` : ''}${drive}`)}` });
        toast(`${emu} loads ${name}: ${what}${note(r)}`, level(r));
        return;
      }
      // a project whose first file came from the T64 in the datasette (13.5j): VICE autostarts a T64 of that file as
      // built and the files after it on the tape, the project's other files from it written back as built, so LOAD
      // from the tape finds them; a start the user set needs the program put in memory instead
      if (t0?.file.t64 && tape?.img.t64 && t0.tap === tape.bytes && project.entryPoint == null) {
        const b = t64Built(built), slot = t0.file.t64.slot;
        if (!b.slots.get(slot)) throw new Error('nothing to run');
        const name = `${R.fileNames[0]}.t64`;
        const w = await kr.writeExport({ target: 'temp', name: 'run', files: { [name]: writeT64(tape.bytes, b.slots, slot) } });
        if (!w) return;
        const t64Path = `${w.dir}/${name}`, labels = res.kick?.compared[0]?.vsPath ?? undefined;
        const r = await run({ prgPath: t64Path, labelsPath: labels, disk: diskPath });
        const others = b.wrote.filter(n => n !== t0.file.name);
        const after = tape.img.files.some(f => f.at > t0.file.at) ? `, then the files of ${tape.name} after "${t0.file.name}"${others.length ? ` (${others.join(', ')} as built)` : ''}` : '';
        const what = `the built ${R.fileNames[0]} as its first file${after}`;
        setBuild(x => x && { ...x, log: `${x.log}\n\n${started(r, `${t64Path} autostarted, ${what}${labels ? `, labels from ${labels}` : ''}${drive}`)}` });
        toast(`${emu} autostarts ${name}: ${what}${note(r)}`, level(r));
        return;
      }
      // a project whose first file is the disk's first program (what LOAD"*",8,1 loads): VICE autostarts the disk's copy,
      // with the built files written back, so the disk's own boot runs them (a copy-protected G64's too); a start the
      // user set needs the program put in memory instead
      const p0 = project.files[0], first = disk?.img.files.find(f => f.type === 'PRG' && f.track);
      if (dc && disk && p0 && first && project.entryPoint == null && diskOf.current.get(p0.id) === disk.bytes && diskFileOf.current.get(p0.id)?.track === first.track && diskFileOf.current.get(p0.id)?.sector === first.sector) {
        const labels = res.kick?.compared[0]?.vsPath ?? undefined;
        const r = await run({ prgPath: dc.path, labelsPath: labels });
        setBuild(b => b && { ...b, log: `${b.log}\n\n${started(r, `${dc.path} autostarted (LOAD"*",8,1 and RUN: the disk's own boot)${back}${labels ? `, labels from ${labels}` : ''}`)}` });
        toast(`${emu} autostarts ${disk.name} (a copy${back}): its boot loads "${first.name}"${note(r)}`, level(r));
        return;
      }
      const tc = await tapeCopy(built), tapePath = tc?.path;
      const datasette = tapePath && tape ? `, ${tape.name} in the datasette${tc?.wrote.length ? ` (a copy with ${tc.wrote.join(', ')} written back as built)` : ''}${inDebugger ? '' : ' (press PLAY in VICE when the program asks)'}` : '';
      let prgPath: string, labelsPath: string | undefined;
      if (res.kick?.compared[0]) { prgPath = res.kick.compared[0].prgPath; labelsPath = res.kick.compared[0].vsPath ?? undefined; }
      else {
        // no KickAss.jar (64tass): run the PRG produced by the built-in verifier
        const prg = res.V.results[0]?.prg;
        if (!prg) throw new Error('nothing to run');
        const w = await kr.writeExport({ target: 'temp', name: 'run', files: { [`${R.fileNames[0]}.prg`]: prg } });
        if (!w) return;
        prgPath = `${w.dir}/${R.fileNames[0]}.prg`;
      }
      // a program start the user set: VICE loads the PRG without RUN and types `sys <start>`, or, for a program over
      // BASIC's work area, loads and starts it from the monitor (only the first file is run)
      const ep = project.entryPoint;
      const start = ep != null && A.owner[ep] === 0 ? ep : undefined;
      // $01 as the program starts, when Unpack set the start and Sindri saw another value there (a game under the BASIC ROM)
      const port = start != null && project.entryPort != null && project.entryPort !== 0x37 ? project.entryPort : undefined;
      // the I/O it started in, when Unpack set the start (the VIC bank, the raster interrupt, the colour RAM): a routine sets it
      const io = start != null && project.entryIo ? project.entryIo : undefined;
      if (ep != null && start == null && A.owner[ep] >= 0) toast(`The program start $${h4(ep)} is in another file than the one ${emu} runs; it starts with RUN`, 'warn');
      const f0 = A.files[0];
      const overSystem = !!f0 && overwritesSystemArea(f0.load, f0.bytes.length);
      // the RAM of a snapshot opened before snapshots were kept with the project: it can only start like a PRG
      if (f0 && (f0.load === 0x0200 || f0.load === 0x0002) && f0.load + f0.bytes.length === 0x10000) toast(`This file looks like a VICE snapshot that was opened before Mimir kept snapshots, so ${emu} starts it like a PRG: open the .vsf again and Build & Run restarts it as it was`, 'warn');
      else if (start == null && overSystem) toast(`The program overwrites BASIC's work area ($${h4(SYSTEM_AREA.start)}-$${h4(SYSTEM_AREA.end - 1)}), so RUN cannot start it: set the program start`, 'warn');
      // a debugger shows the source by the code it runs, stops at the breakpoints and lists the watches: the debug
      // info is made from the render that was just verified (the first file's: the one that is run)
      const debug = inDebugger ? { sources: debugSources(R), breakpoints: (project.breakpoints ?? []).filter(a => A.owner[a] === 0), watches: (project.watches ?? []).map(addr => ({ addr })) } : undefined;
      const r = await run({ prgPath, labelsPath, start, port, ...(io ? { io } : {}), disk: diskPath, tape: tapePath, ...(debug ? { debug } : {}) }), via = r.via;
      const p01 = `${port != null ? ` with $01 = $${h2(port)}` : ''}${io ? ` and the I/O it started in (${ioSummary(io)}${io.color ? `, the colour RAM${inDebugger ? ', which the debugger does not get' : ''}` : ''})` : ''}`;
      // (a debugger that cannot take the disk or the tape leaves it out, and its notes say so)
      const left = (what: string) => !!r.notes?.some(n => n.startsWith(`The ${what} is not`));
      const inDrive = left('disk') ? '' : drive, inDatasette = left('tape') ? '' : datasette;
      const why = io && !overSystem && !(f0 && coversReadyScreen(f0.load, f0.bytes.length)) ? `a routine sets the I/O it started in before the jump${inDebugger ? '' : ', and typing sys has no room for it'}` : overSystem ? `the program overwrites BASIC's work area $${h4(SYSTEM_AREA.start)}-$${h4(SYSTEM_AREA.end - 1)}`
        : `the program covers the screen at READY, $${h4(READY_SCREEN.start)}-$${h4(READY_SCREEN.end - 1)}, which typing sys would write on`;
      const how = start == null ? '' : inDebugger
        ? `, starting at $${h4(start)}${p01} (${via === 'monitor' ? `as from VICE's monitor${inDrive ? ', after the drive read the disk' : ''}: ${why}` : port != null ? 'sys to a routine that sets $01 and jumps there: BASIC cannot set $01 itself' : `sys ${start} typed`})`
        : via === 'monitor'
        ? `, starting at $${h4(start)}${p01} (loaded and started from the VICE monitor${diskPath ? `, after the drive read the disk (typed at READY, then sys ${START_STUB} stops in the monitor)` : ''}: ${why})`
        : port != null ? `, starting at $${h4(start)}${p01} (after loading, POKEs put a stub at $${h4(START_STUB)} that sets $01 and jumps there, and sys ${START_STUB} runs it: BASIC cannot set $01 itself)`
        : `, starting at $${h4(start)} (sys ${start} after loading)`;
      const di = r.debugInfo, dbg = di ? `, the source of ${di.lines} lines in its Source code view${di.breakpoints ? `, ${di.breakpoints} breakpoint${di.breakpoints === 1 ? '' : 's'}` : ''}${di.watches ? `, ${di.watches} watch${di.watches === 1 ? '' : 'es'}` : ''} (${di.path})` : '';
      setBuild(b => b && { ...b, log: `${b.log}\n\n${started(r, `${prgPath}${labelsPath ? ` with labels from ${labelsPath}` : ''}${how}${inDrive}${inDatasette}${dbg}${r.reused ? ', in the debugger that was already running' : ''}`)}` });
      toast(`${emu} started${start != null ? ` at $${h4(start)}${p01}` : ''}${labelsPath ? ` with labels in the ${inDebugger ? 'debugger' : 'monitor'}` : ''}${di ? ` and the source${di.breakpoints ? `, ${di.breakpoints} breakpoint${di.breakpoints === 1 ? '' : 's'}` : ''}${di.watches ? `, ${di.watches} watch${di.watches === 1 ? '' : 'es'}` : ''}` : ''}${diskPath && disk && inDrive ? `, ${disk.name} in drive 8` : ''}${inDatasette}${note(r)}`, level(r));
    } catch (e) {
      toast(errorText(e), 'err');
      setBuild(b => b && { ...b, log: `${b.log}\n\n> ${emu}: ${errorText(e)}` });
    } finally { setBuildBusy(null); }
  };

  /** a terminal in the folder you work in: the last export, else the project's source folder (else the main process
   * picks the folder of the last dialog, or home); VICE is on PATH there and `kickass` runs KickAss.jar */
  const openTerminal = async () => {
    if (!kr) return needDesktop();
    try { const r = await kr.openTerminal(exportDir ? { dir: exportDir } : {}); toast(`Terminal opened in ${r.dir}`, 'ok'); } catch (e) { toast(errorText(e), 'err'); }
  };

  /** the export in the external editor (the one in Settings, else Sublime Text or VS Code): its folder, with its first
   * .asm file open. The last export is opened as it is; before the first one the project is exported (to its source
   * folder, without a project to a folder picked) */
  const openEditor = async () => {
    if (!kr) return needDesktop();
    if (!project.files.length) { toast('Nothing to edit yet: open a PRG first', 'warn'); return; }
    if (editors && !editors.current) { toast('No external editor was found: install Sublime Text or Visual Studio Code, or set one in Settings → Toolchain', 'warn'); setModal('settings'); return; }
    try {
      let r = await kr.openEditor({ ...(exportDir ? { dir: exportDir } : {}), file: mainSource(R) });
      if (!r.opened) {
        const w = await exportProject();
        if (!w) return;
        r = await kr.openEditor({ dir: w.dir, file: w.main });
        if (!r.opened) throw new Error(`${w.main} is not in ${w.dir}`);
      }
      toast(`${r.editor} opened ${r.dir} with ${r.file}`, 'ok');
    } catch (e) { toast(errorText(e), 'err'); }
  };

  /* ---- pack with Brokkr or Exomizer (the Pack view) ---- */
  const setPack = (p: PackPrefs, label: string) => update(label, d => { d.pack = p; });
  /** pack the range too (on) or leave it out; the Pack view then shows the chosen blocks */
  const packRange = (r: { start: Addr; end: Addr }, on: boolean) => {
    const prefs = project.pack ?? packDefaults(A, project);
    const what = `$${h4(r.start)}-$${h4(r.end - 1)}`;
    setPack({ ...prefs, ranges: editRanges(prefs.ranges ?? [], r.start, r.end, on) }, `${on ? 'Pack' : 'Do not pack'} ${what}`);
    setUi({ activity: 'pack', sidePanel: true });
    toast(on ? `${what} is packed with the chosen blocks (Pack view)` : `${what} is left out of the pack`, 'ok');
  };
  /** Build and verify like Build & Run, then pack the PRGs it built with Brokkr or Exomizer as the Pack view says. */
  const runPack = async () => {
    if (!kr) return needDesktop();
    const before = latest.current;
    const asked = before.project.pack ?? packDefaults(before.A, before.project);
    if (asked.packer === 'exomizer' && !toolchain.exomizerPath) { toast('Set Exomizer in Settings → Toolchain first', 'warn'); setModal('settings'); return; }
    if (packRun) return;
    // the folder for the packed file: one kept in the project may be written to once it is picked in this session
    let dir = '';
    if (asked.dir) {
      const r = await kr.packFolder({ dir: asked.dir }).catch((e: unknown) => { toast(errorText(e), 'err'); return null; });
      if (!r) { toast('Nothing packed: the folder for the packed file was not chosen', 'warn'); return; }
      if (r.dir !== asked.dir) setPack({ ...asked, dir: r.dir }, 'Pack: folder');
      dir = r.dir;
    }
    // an Assembler project (spec 10.7): what the Assembler builds of its main file, with KickAss.jar or 64tass
    if (asmMode) {
      setPackRun({ step: 'verify', since: Date.now(), prefs: asked, before: { title: `Build the main file with ${asmTool2}`, doing: `Building with ${asmTool2}…` } });
      try { await packAsm(dir); } finally { setPackRun(null); }
      return;
    }
    // the Pack view shows the pack under way from here to the end, through building, verifying and packing
    setPackRun({ step: 'verify', since: Date.now(), prefs: asked });
    try { await packVerified(dir); } finally { setPackRun(null); }
  };
  /** the folder for the packed file, picked in a dialog (which lets this session write there) */
  const pickPackDir = async () => {
    if (!kr) return needDesktop();
    const prefs = project.pack ?? packDefaults(A, project);
    try {
      const r = await kr.packFolder({ ...(prefs.dir ? { dir: prefs.dir } : {}), ask: true });
      if (r && r.dir !== prefs.dir) setPack({ ...prefs, dir: r.dir }, 'Pack: folder');
    } catch (e) { toast(errorText(e), 'err'); }
  };
  /** runPack after its checks: build and verify, then pack what was verified (into `dir` too, when it is set) */
  const packVerified = async (dir: string) => {
    if (!kr) return;
    const res = await runVerify({ quiet: true });
    if (!res) return;
    if (!res.ok) { setUi({ bottom: 'build', panelOpen: true }); toast('The build failed verification; nothing was packed', 'err'); return; }
    // the analysis, render and pack settings that were verified (runVerify waited for the latest edit)
    const { A, R, project } = latest.current;
    const prefs = { ...(project.pack ?? packDefaults(A, project)), dir };
    const files = R.fileNames.map((n, i) => ({ name: `${n}.prg`, prg: res.kick?.compared[i]?.prg ?? res.V.results[i]?.prg ?? null }));
    if (files.some(f => !f.prg)) { toast('The build gave no PRG to pack', 'err'); return; }
    await packPrgs(files.map(f => ({ name: f.name, prg: f.prg! })), prefs, R, res.kick?.compared[0] ? `the PRG ${asmTool} built, ${res.kick.compared[0].prgPath}` : 'the PRG the built-in assembler built', dir);
  };
  /** the main file of an Assembler project built by its Assembler, then packed (runPack) */
  const asmBuilt = useRef<AsmBuilt | null>(null);
  const packAsm = async (dir: string) => {
    const b = await useAsmLink.getState().buildPrg();
    if (!b) return;
    asmBuilt.current = b;
    const { A, R, project } = latest.current;
    await packPrgs([{ name: b.prgPath.replace(/^.*[\\/]/, ''), prg: b.prg }], { ...(project.pack ?? packDefaults(A, project)), dir }, R, `the PRG ${asmTool2} built, ${b.prgPath}`, dir);
    // (an Assembler project that is a repository leaves the packed folder out of it, as its builds' out)
    if (home) await ignoreOut(home.dir, true);
  };
  /** the built PRGs packed as `prefs` say (into `dir` too, when it is set): the result kept, the log, and what it gave */
  const packPrgs = async (files: { name: string; prg: Uint8Array }[], prefs: PackPrefs, R: RenderResult, from: string, dir: string) => {
    if (!kr) return;
    const packer = prefs.packer === 'exomizer' ? 'Exomizer' : 'Brokkr';
    // (an Assembler project's log: under the Assembler's Build, after its build's)
    const log = (text: string) => { if (asmMode) useAsmLink.getState().request('log', { text }); else setBuild(b => b && { ...b, log: `${b.log}\n\n${text}` }); };
    const showLog = () => { if (asmMode) useAsmLink.getState().request('log'); else setUi({ bottom: 'build', panelOpen: true }); };
    setPackRun(p => p && { ...p, step: 'pack', prefs });
    try {
      setBuildBusy(`Packing with ${packer}`);
      const r = await kr.pack({ files, prefs });
      setPackRes({ ...r, key: packKeyOf(prefs, filesKey(R)) });
      const check = !r.check ? '' : r.check.argv.length ? `\n\n> ${r.check.argv.map(shellWord).join(' ')}\n${r.check.output.trim()}\n${r.check.text}` : `\n${r.check.text}`;
      const commands = (r.commands ?? [r.argv]).map(c => `> ${c.map(shellWord).join(' ')}`).join('\n');
      log(`${commands}\n(in ${r.dir}, from ${from})\n${r.output.trim()}${check}${r.ok ? '' : `\n${r.error}`}`);
      if (!r.ok) { showLog(); toast(`${packer}: ${r.error}`, 'err'); return; }
      const bad = r.check?.status === 'differs';
      // crunched data in a file for each part says how many, and that the decruncher is written with them
      const packed = r.files?.filter(f => f.kind === 'packed') ?? [];
      const into = packed.length > 1 ? `${packed.length} files (${packed.reduce((n, f) => n + f.prg.length, 0)} bytes)` : `${dir || home ? r.path : r.name} (${r.prg?.length ?? 0} bytes)`;
      const decruncher = r.files?.some(f => f.kind === 'decruncher') ? ' with the decruncher' : '';
      toast(`Packed ${r.packed?.length ?? 0} bytes into ${into}${decruncher}${r.check?.status === 'same' ? ', decrunch verified' : bad ? ', but it does not decrunch to the same bytes' : ''}`, bad ? 'err' : 'ok');
    } catch (e) { toast(errorText(e), 'err'); } finally { setBuildBusy(null); }
  };
  /** the packed file in VICE (with the build's labels, which name the decrunched program) */
  const runPacked = async () => {
    if (!kr) return needDesktop();
    if (!packRes?.path) return;
    try {
      const vs = (asmMode ? asmBuilt.current?.vsPath : build?.kick?.compared[0]?.vsPath) ?? undefined;
      const diskPath = (await diskCopy())?.path;
      const { pid } = await kr.run({ prgPath: packRes.path, labelsPath: vs, disk: diskPath });
      setBuild(b => b && { ...b, log: `${b.log}\n\n> VICE started (pid ${pid}): ${packRes.path}` });
      toast(`VICE started with ${packRes.name}`, 'ok');
    } catch (e) { toast(errorText(e), 'err'); }
  };
  /* ---- Release (an Assembler project, spec 10.7): the build as a disk image, a tape image, a cartridge or a PRG ---- */
  const [asmRelease, setAsmRelease] = useState(false);
  const releaseAsm = async (c: ReleaseChoice) => {
    if (!kr || !home) return;
    const b = await useAsmLink.getState().buildPrg();
    if (!b) return;
    asmBuilt.current = b;
    let prg = b.prg, how = `built with ${asmTool2}`;
    if (c.packed) {
      const { A, project } = latest.current, prefs = { ...(project.pack ?? packDefaults(A, project)), dir: '' };
      const packer = prefs.packer === 'exomizer' ? 'Exomizer' : 'Brokkr';
      if (prefs.packer === 'exomizer' && !toolchain.exomizerPath) { toast('Set Exomizer in Settings → Toolchain first, or choose Brokkr in the Pack view', 'warn'); return; }
      setBuildBusy(`Packing with ${packer}`);
      try {
        const r = await kr.pack({ files: [{ name: b.prgPath.replace(/^.*[\\/]/, ''), prg: b.prg }], prefs });
        if (!r.ok || !r.prg) { toast(`${packer}: ${r.error ?? 'nothing packed'}`, 'err'); return; }
        if ((r.files?.filter(f => f.kind === 'packed').length ?? 0) > 1 || r.files?.some(f => f.kind === 'decruncher')) { toast(`The Pack view packs into several files: choose a self-extracting file (SFX) there to release one packed program`, 'warn'); return; }
        prg = r.prg; how = `packed with ${packer} (${b.prg.length - 2} bytes into ${r.prg.length - 2})`;
      } catch (e) { toast(errorText(e), 'err'); return; } finally { setBuildBusy(null); }
    }
    const stem = b.main.replace(/^.*\//, '').replace(/\.[^.]*$/, '') || 'program', out = `${b.main.includes('/') ? `${b.main.slice(0, b.main.lastIndexOf('/'))}/` : ''}out`;
    const path = `${out}/${stem}${c.kind === 'prg' && c.packed ? '-packed' : ''}.${c.kind}`;
    let bytes: Uint8Array;
    try {
      bytes = releaseImage(c.kind, prg, { name: c.name, disk: c.disk, id: c.id });
      await kr.assemblerWrite({ dir: home.dir, path, bytes });
    } catch (e) { toast(`Nothing was made: ${errorText(e)}`, 'err'); return; }
    setAsmRelease(false);
    const full = `${home.dir.replace(/[\\/]+$/, '')}\\${path.replace(/\//g, '\\')}`;
    toast(`Made ${path} (${bytes.length} bytes) of ${stem}.prg, ${how}`, 'ok');
    // (measured in VICE: LOAD and RUN start only a program with a BASIC line; a packed one's decruncher has one)
    const wontStart = c.packed ? null : releaseStarts(c.kind, prg);
    if (wontStart) toast(wontStart, 'warn');
    if (!c.run) return;
    try {
      const r = await kr.run({ prgPath: full, ...(b.vsPath ? { labelsPath: b.vsPath } : {}), ...(c.kind === 'crt' ? { cart: true } : {}) });
      toast(`VICE started ${path}${r.via === 'cart' ? ' as a cartridge' : ''}`, 'ok');
    } catch (e) { toast(`VICE did not start: ${errorText(e)} (Settings → Toolchain)`, 'err'); }
  };
  /** build.bat and build.sh beside the main file: they build it into out\ and start it in VICE, as Run does */
  const asmScripts = async () => {
    if (!kr || !home || !stored.asm) return;
    const at = useAsmLink.getState().main ?? stored.asm.main ?? 'main.asm', dir = at.includes('/') ? `${at.slice(0, at.lastIndexOf('/'))}/` : '', stem = at.replace(/^.*\//, '').replace(/\.[^.]*$/, '');
    // (the project's own arguments after the toolchain's, as Run gives them)
    const own = stored.asm.args?.trim() ?? '', more = (a: string) => [a.trim(), own].filter(Boolean).join(' ');
    const scripts = buildScripts({ ...S, assembler: stored.asm.lang === '64tass' ? '64tass' : 'kick', kickArgs: more(S.kickArgs), tassArgs: more(S.tassArgs) }, [stem]);
    const made: string[] = [], kept: string[] = [];
    for (const [name, text] of Object.entries(scripts)) {
      const path = `${dir}${name}`;
      const there = await kr.assemblerRead({ dir: home.dir, path }).then(() => true, () => false);
      if (there) { kept.push(path); continue; }
      await kr.assemblerWrite({ dir: home.dir, path, text }).then(() => made.push(path), (e: unknown) => toast(`${path}: ${errorText(e)}`, 'err'));
    }
    toast(made.length ? `Wrote ${made.join(' and ')}: ${made.length === 1 ? 'it builds' : 'they build'} ${stem}.asm into out and ${made.length === 1 ? 'starts' : 'start'} it in VICE${kept.length ? ` (${kept.join(' and ')} ${kept.length === 1 ? 'was' : 'were'} there already and stayed as ${kept.length === 1 ? 'it was' : 'they were'})` : ''}` : `${kept.join(' and ')} are there already: they stay as they are (delete them to have new ones written)`, made.length ? 'ok' : 'info');
  };
  /** the Graphics tab's selection as a file, through a save dialog */
  const saveGraphics = async (name: string, bytes: Uint8Array) => {
    if (!kr) return needDesktop();
    try { const r = await kr.saveFile({ name, bytes, title: 'Save graphics' }); if (r) toast(`Saved ${r.path} (${bytes.length} bytes)`, 'ok'); } catch (e) { toast(`Save failed: ${errorText(e)}`, 'err'); }
  };
  /** a file the pack wrote (the packed file, when none is named), through a save dialog */
  const savePacked = async (file?: { name: string; prg: Uint8Array }) => {
    if (!kr) return needDesktop();
    const f = file ?? (packRes?.prg && packRes.name ? { name: packRes.name, prg: packRes.prg } : null);
    if (!f) return;
    try { const r = await kr.saveFile({ name: f.name, bytes: f.prg, title: file ? `Save ${f.name}` : 'Save the packed file' }); if (r) toast(`Saved ${r.path}`, 'ok'); } catch (e) { toast(`Save failed: ${errorText(e)}`, 'err'); }
  };

  /** verify, then export to the project's source folder (`elsewhere`, or without a project: to a folder picked); the
   * folder and its first source, or null when nothing was exported */
  const exportProject = async (elsewhere = false, by?: { request: ScriptExportRequest; changed: boolean; script: string }): Promise<{ dir: string; main: string } | null> => {
    if (!kr) { needDesktop(); return null; }
    const res = await runVerify({ quiet: true });
    if (!res) return null;
    try {
      // the render that was verified (runVerify waited for the latest analysis)
      const { R: R1, project: p1, S: S1 } = latest.current;
      // a script's export (exporter.write()): its files laid over the export as it is now
      const over = by ? applyExportRequest(exportFiles(p1, R1, S1, res.V, new Date()), by.request, by.changed) : null;
      const w = await kr.writeExport({ target: home && !elsewhere ? 'project' : 'pick', files: over?.files ?? exportFiles(p1, R1, S1, res.V, new Date()) });
      if (w) { setExportDir(w.dir); exportedFiles.current = filesOf(p1); }
      if (w && by) {
        const n = Object.keys(by.request.files).length - over!.stale.length, gone = by.request.removed.length;
        toast(`"${by.script}" exported to ${w.dir} (${w.written.length} files${n ? `, ${n} of them the script's` : ''}${gone ? `, ${gone} left out` : ''})${res.ok ? '' : '; the round-trip check failed, see Build output'}${over!.stale.length ? `. Not the script's ${over!.stale.join(', ')}: the run changed the program, so the source is another than the one the script changed; run it again` : ''}`, res.ok && !over!.stale.length ? 'ok' : 'warn');
      } else if (w) toast(res.ok ? `Exported verified ${ASSEMBLERS[asm].name} project to ${w.dir} (${w.written.length} files)` : `Exported to ${w.dir}, but the round-trip check failed; see Build output`, res.ok ? 'ok' : 'warn');
      return w && { dir: w.dir, main: mainSource(R1) };
    } catch (e) { toast(`Export failed: ${errorText(e)}`, 'err'); return null; }
  };
  /** Ctrl+S: the project saved to its project file now; work without a project becomes a project */
  const saveProject = async () => {
    if (!kr) return needDesktop();
    if (!home) { setModal('project'); return; }
    clearTimeout(pending.current.timer);
    pending.current = {};
    try { await kr.saveProject({ project: stored, path: home.file }); toast(`Project saved to ${home.file}`, 'ok'); } catch (e) { toast(`Save failed: ${errorText(e)}`, 'err'); }
  };
  /** a copy of the project file wherever the user wants it (the work stays where it is) */
  const saveProjectCopy = async () => {
    if (!kr) return needDesktop();
    try { const r = await kr.saveProject({ project: stored }); if (r) toast(`A copy of the project saved to ${r.path}`, 'ok'); } catch (e) { toast(`Save failed: ${errorText(e)}`, 'err'); }
  };
  /** what moves into a project created from the work without one */
  const gathered = () => {
    const packed = packRes?.ok && packRes.path ? packRes.path : undefined;
    const exported = exportDir && exportedFiles.current === filesOf(project) ? exportDir : undefined;
    return { ...(exported ? { exportDir: exported } : {}), ...(build?.kick?.dir ? { buildDir: build.kick.dir } : {}), ...(packed ? { packed } : {}) };
  };
  const movingText = () => {
    const g = gathered();
    return ['the project (its files, labels, comments, bookmarks and patches)', ...(g.exportDir ? [`the export (copied from ${g.exportDir})`] : []), ...(g.buildDir ? ['the last build'] : []), ...(g.packed ? [`the packed file ${packRes?.name}`] : [])];
  };
  /** a project for the work without one: its folder made, the work saved and moved there; it goes on in the project */
  const createFromWork = async (name: string, parent: string, git: boolean) => {
    if (!kr) return;
    const gather = gathered();
    const r = await kr.createProject({ name, parent, project, gather, git });
    setHome(r.home);
    forgetUnsavedWork();
    setModal(null);
    // what moved is where it is now
    const { source, build: built, packed } = r.moved;
    if (source) setExportDir(source);
    if (built && gather.buildDir) {
      const from = gather.buildDir;
      setBuild(b => (b?.kick ? { ...b, kick: { ...b.kick, dir: built, compared: b.kick.compared.map(c => ({ ...c, prgPath: rebase(c.prgPath, from, built), vsPath: rebase(c.vsPath, from, built) })), cart: b.kick.cart && { ...b.kick.cart, path: rebase(b.kick.cart.path, from, built), vs: rebase(b.kick.cart.vs, from, built) } } } : b));
    }
    if (packed) setPackRes(x => x && { ...x, path: packed });
    const moved = [source && 'the export', built && 'the last build', packed && 'the packed file'].filter(Boolean);
    const g = gitNote(r);
    toast(`Created the project ${r.home.name} in ${r.home.dir}${g.text}: the work is saved there${moved.length ? `, with ${moved.join(', ')}` : ''}`, g.bad ? 'warn' : 'ok');
  };
  const copyText = async (t: string | undefined, what = 'Copied to clipboard') => { if (!t) return; try { await navigator.clipboard.writeText(t); toast(what, 'ok'); } catch { toast('The clipboard is not available; select the text and copy it manually', 'warn'); } };
  /**
   * The lines of the selection as the source writes them, in order: its instructions and data, the labels and
   * comment lines inside it, and the header of a block it holds whole. A folded block in it comes along whole.
   */
  const selectedLines = (): string[] => {
    if (!sel || !sel.multi || sel.end <= sel.start) return [];
    const inside = (a: Addr) => a >= sel.start && a < sel.end;
    const out: string[] = [];
    for (const l of R.lines) {
      if (l.k === 'file' || !inside(l.a)) continue;
      if (l.k === 'hdr') { const b = A.blocks[l.blk]; if (!b || b.start < sel.start || b.end > sel.end) continue; }
      // the file head's lines (a .label and the note on it) stand at the load address, not in the program
      else if ((l.k === 'dir' && !l.n) || (l.k === 'cmt' && l.zp != null)) continue;
      out.push(lineText(l, S));
    }
    while (out.length && !out[0].trim()) out.shift();
    while (out.length && !out[out.length - 1].trim()) out.pop();
    return out;
  };
  /** Ctrl+C in the listing: the selected lines, else the line at the cursor */
  const copyLines = () => {
    const ls = selectedLines();
    if (ls.length) return void copyText(ls.join('\n'), `Copied ${ls.length} line${ls.length === 1 ? '' : 's'} to the clipboard`);
    if (curLine) void copyText(lineText(curLine, S).trim());
  };
  /** the showcase (core/showcase.ts) with its tour in the Bookmarks view. It needs bank tracking: its bitmap logo sits
   *  above a text screen, and only that tells the two $d018 values apart */
  const loadDemo = (asked = false) => {
    if (!asked && askFirst('the showcase demo', !!home, () => later.current.loadDemo(true))) return;
    // the showcase is not a project's work: a project is saved as it is and left
    const left = leaveProject();
    replace(showcaseProject({ ...project.settings, bankTracking: true }));
    resetView();
    setUi({ activity: 'bookmarks', sidePanel: true });
    toast(`Showcase loaded${left ? ` without a project (${left.name} is saved as it was)` : ''}: the Bookmarks view is a tour of it, F2 goes to the next stop`, 'ok');
  };
  /** the actions as this render has them: an answer to "The work is not saved" goes on with the work as it is then (a
   *  project made of it first) */
  const later = useRef({ addFiles, loadDemo, openDroppedProject });
  later.current = { addFiles, loadDemo, openDroppedProject };
  const saveSettings = async (s: Settings, prefs: AppPrefs, asm: AsmSettings | null) => {
    const tc = pickToolchain(s);
    try { setToolchain(kr ? await kr.setSettings(tc) : tc); } catch (e) { toast(`Toolchain settings rejected: ${errorText(e)}`, 'err'); return; }
    // another library folder: the library is read from it (10.6)
    if (tc.libraryDir !== toolchain.libraryDir && libState().listing) void libState().load();
    setUi(prefs);
    setDrawer(d => (d === 'insp' ? null : d));
    update('Settings', d => {
      for (const k of Object.keys(s) as (keyof Settings)[]) if (!(TOOLCHAIN_KEYS as readonly string[]).includes(k)) (d.settings as Record<string, unknown>)[k] = s[k];
      // an Assembler project's own: its language, main file and arguments (Project.asm)
      if (asm && d.asm) { d.asm.lang = asm.lang; d.asm.main = asm.main; const args = asm.args.trim(); if (args) d.asm.args = args; else delete d.asm.args; }
    });
    if (asm && home) useAssembler.getState().setMachine(home.dir, asm.machine);
    setModal(null); setSettingsPage(undefined); toast('Settings saved', 'ok');
  };
  /** Settings at the Assembler project page (the Assembler's settings button, the palette) */
  const asmSettings = () => { setSettingsPage('asmproject'); setModal('settings'); };

  /** Ctrl+Shift+B, the side panel's own button and its view's button in the activity bar: the side panel collapsed, so the
   *  listing and the other views get its room, or shown again (on a narrow window it is the drawer) */
  const toggleSide = () => {
    if (window.matchMedia?.('(max-width: 900px)').matches) { setDrawer(d => (d === 'side' ? null : 'side')); return; }
    const open = !useUi.getState().sidePanel;
    setUi({ sidePanel: open });
    // the focus does not stay in the hidden panel
    if (!open && document.activeElement?.closest('.sidebar, .side-collapse')) listRef.current?.focus();
  };
  /** folds in the inspector opened over the editor from its strip (the drawer `insp`, as on a narrow window) */
  const closeInspector = () => {
    setDrawer(d => (d === 'insp' ? null : d));
    // the focus does not stay in the hidden inspector
    if (document.activeElement?.closest('.insp-col')) listRef.current?.focus();
  };
  /** the inspector always open beside the editor, or folded in until it is needed (also Settings → General) */
  const setInspector = (m: InspectorMode) => { closeInspector(); setUi({ inspector: m }); };
  // The Scripts tab gets the window (spec 10.3): opening it folds in the side panel (Explorer, …), the inspector and the
  // bottom panel (the analysis log, …); another tab brings back each as it was, unless it was opened or closed by hand
  // meanwhile. What they were is kept until then (also over a restart in the Scripts tab).
  const scriptsFold = useRef<ScriptsFold | null>(store.get<ScriptsFold | null>(SCRIPTS_FOLD_KEY, null));
  useEffect(() => {
    const u = useUi.getState();
    if ((tab === 'scripts' || tab === 'asm') && !scriptsFold.current) {
      const was: ScriptsFold = { sidePanel: u.sidePanel, panelOpen: u.panelOpen, inspector: u.inspector };
      scriptsFold.current = was; store.set(SCRIPTS_FOLD_KEY, was);
      setDrawer(d => (d === 'insp' || d === 'side' ? null : d));
      setUi({ sidePanel: false, panelOpen: false, inspector: 'auto' });
    } else if (tab !== 'scripts' && tab !== 'asm' && scriptsFold.current) {
      const was = scriptsFold.current;
      scriptsFold.current = null; store.set(SCRIPTS_FOLD_KEY, null);
      setUi({ ...(!u.sidePanel ? { sidePanel: was.sidePanel } : {}), ...(!u.panelOpen ? { panelOpen: was.panelOpen } : {}), ...(u.inspector === 'auto' ? { inspector: was.inspector } : {}) });
    }
  }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  // an Assembler project shows its own tabs (the Assembler first) and views; another project not the Assembler
  useEffect(() => {
    if (asmMode && !ASM_TABS.includes(tab)) setUi({ tab: 'asm' });
    else if (!asmMode && tab === 'asm') setUi({ tab: 'listing' });
    if (asmMode && ASM_HIDDEN_VIEWS.includes(activity)) setUi({ activity: 'explorer' });
    else if (!asmMode && ASM_ONLY_VIEWS.includes(activity)) setUi({ activity: 'explorer' });
  }, [asmMode, tab, activity]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---- commands & keys ---- */
  const undoLabel = past.length ? past[past.length - 1].label : null;
  const allCommands: Command[] = [
    { id: 'smart', label: 'Smart attach: open any file as its extension says (PRG, snapshot, cartridge, D64, G64, TAP, project; Brokkr packs a .asm)…', run: () => void smartAttach() },
    { id: 'open', label: 'Open PRG files…', key: 'Ctrl+O', run: () => void openPrgs(false) },
    { id: 'add', label: 'Add PRG files to the project…', run: () => void openPrgs(project.files.length > 0, 'add') },
    { id: 'open-crt', label: 'Open a cartridge (.crt)…', run: () => void openPrgs(false, 'crt') },
    { id: 'open-vsf', label: 'Open a VICE snapshot (.vsf)…', run: () => void openPrgs(false, 'vsf') },
    { id: 'mount', label: 'Mount disk image (D64, G64)…', run: () => void mountDisk() },
    { id: 'tape', label: 'Insert tape image (TAP, T64) in the datasette…', run: () => void insertTape() },
    { id: 'quicksave', label: 'Open the VICE quicksave snapshot (Alt+F11 in VICE saves one)', key: 'F9', run: () => void openQuicksave() },
    { id: 'quicksave-follow', label: followQuicksave ? 'Stop opening each new VICE quicksave' : 'Open each new VICE quicksave (Alt+F11 in VICE) by itself', run: () => setUi({ followQuicksave: !followQuicksave }) },
    ...packing.flatMap((p, i) => (p ? [{ id: `unpack-${i}`, label: external ? `Unpack ${project.files[i]?.name} with ${unpackerName}` : `Unpack ${project.files[i]?.name}`, run: () => void unpackFile(i) }] : [])),
    { id: 'terminal', label: 'Open a terminal in the project folder (VICE on PATH, kickass runs Kick Assembler)', run: () => void openTerminal() },
    { id: 'editor', label: `Open the export in ${editors?.current?.name ?? 'an external editor'} (its folder, with ${mainSource(R)} open)`, run: () => void openEditor() },
    ...(disk ? [{ id: 'eject', label: `Eject ${disk.name}`, run: ejectDisk }] : []),
    ...(tape ? [{ id: 'eject-tape', label: `Eject the tape ${tape.name}`, run: ejectTape }] : []),
    { id: 'demo', label: 'Load the showcase demo (every block type, with a guided tour)', run: () => loadDemo() },
    { id: 'goto', label: 'Go to address, label or range…', key: 'G', run: () => setModal('goto') },
    { id: 'medium-next', label: 'Open the next program on the disk (or the tape)', key: 'Alt+↓', run: () => openNextFrom(1) },
    { id: 'medium-prev', label: 'Open the program before on the disk (or the tape)', key: 'Alt+↑', run: () => openNextFrom(-1) },
    { id: 'find', label: tab === 'source' ? 'Find in the source' : tab === 'drive' ? 'Find in the drive code' : 'Find text in the listing…', key: 'Ctrl+F', run: () => (tab === 'source' || tab === 'drive' ? setSrcFind(n => n + 1) : openFind()) },
    { id: 'find-next', label: 'Find: the next line with a match', key: 'F3', run: () => (findOpen ? stepFind(1) : openFind()) },
    { id: 'find-prev', label: 'Find: the line with a match before', key: 'Shift+F3', run: () => (findOpen ? stepFind(-1) : openFind()) },
    { id: 'block-next', label: 'Go to the next block', key: 'Ctrl+↓', run: () => jumpBlock(1) },
    { id: 'block-prev', label: 'Go to the start of the block, or the block before', key: 'Ctrl+↑', run: () => jumpBlock(-1) },
    { id: 'select-range', label: 'Select address range… (e.g. $2000-$27ff)', run: () => setModal('goto') },
    { id: 'back', label: 'Navigate back', key: 'Esc', run: goBack },
    { id: 'rename', label: 'Rename label at cursor (the line\'s own)', key: 'N', run: startRename },
    { id: 'rename-operand', label: 'Rename the label the cursor line\'s operand names (lda l_3000: l_3000)', key: 'Shift+N', run: () => startOperandRename() },
    { id: 'comment', label: 'Comment at the end of the cursor line', key: ';', run: () => startComment() },
    { id: 'note-line', label: 'Insert comment line above the cursor line (//)', key: '/', run: () => startNote(false) },
    { id: 'note-block', label: 'Insert comment block above the cursor line (/* */)', key: '*', run: () => startNote(true) },
    { id: 'blank-line', label: 'Insert an empty line above the cursor line', key: 'Shift+Enter', run: () => addBlank() },
    { id: 'blank-remove', label: 'Remove an empty line above the cursor line', key: 'Shift+Backspace', run: () => removeBlank() },
    { id: 'bookmark', label: 'Add or edit the bookmark on the cursor line…', key: 'B', run: () => startBookmark() },
    { id: 'bookmarks', label: 'Show bookmarks (notes on addresses)', key: 'Ctrl+B', run: () => showBookmarks() },
    { id: 'bookmark-next', label: 'Go to the next bookmark', key: 'F2', run: () => jumpBookmark(1) },
    { id: 'bookmark-prev', label: 'Go to the previous bookmark', key: 'Shift+F2', run: () => jumpBookmark(-1) },
    ...MARK_AS.map(m => ({ id: 'mark-' + m.id, label: `Mark as ${m.label}`, key: m.key, run: () => mark(m.id) })),
    { id: 'auto', label: 'Clear override (automatic)', key: 'U', run: () => clearOverride() },
    { id: 'fold', label: 'Fold / unfold the block at the cursor', key: 'F', run: () => { if (cursor != null) toggleFold(cursor); } },
    { id: 'fold-data', label: 'Fold every block that is not code', run: () => foldAll('data') },
    { id: 'fold-all', label: 'Fold all blocks', run: () => foldAll('all') },
    { id: 'unfold-all', label: 'Unfold all blocks', run: () => foldAll('none') },
    { id: 'breakpoint', label: 'Set / remove a breakpoint on the instruction at the cursor (for Build & Run in a debugger)', key: 'F8', run: () => { if (cursor != null) toggleBreakpoint(cursor); } },
    { id: 'watch', label: 'Watch / stop watching the address at the cursor (in the debugger\'s watch list)', key: 'Shift+F8', run: () => { if (cursor != null) toggleWatch(cursor); } },
    ...(project.breakpoints?.length || project.watches?.length ? [{ id: 'debug-clear', label: `Remove all breakpoints and watches (${project.breakpoints?.length ?? 0} and ${project.watches?.length ?? 0})`, run: clearDebugMarks }] : []),
    { id: 'exclude', label: 'Exclude / include the block at the cursor in the build', run: () => { if (cursor != null) toggleExcluded(cursor); } },
    { id: 'junk', label: 'Mark the selection or the block at the cursor as junk (left out of everything)', run: () => { const r = sel && sel.multi && sel.end > sel.start ? sel : cursor != null ? findBlock(A.blocks, cursor) : null; if (r) markJunk({ start: r.start, end: r.end }); } },
    { id: 'junk-range', label: 'Mark range as junk… (start, end)', run: () => openJunkRange() },
    ...(project.junk?.length ? [{ id: 'junk-all', label: `Include all junk again (${project.junk.length} area${project.junk.length === 1 ? '' : 's'})`, run: includeAllJunk }] : []),
    { id: 'binary', label: `Save the block at the cursor as a binary file (${words.binary}) / write it in the source`, run: () => { if (cursor != null) toggleBinary(cursor); } },
    { id: 'merge-prev', label: 'Merge the block at the cursor with the previous block', run: () => mergeBlock('prev') },
    { id: 'merge-next', label: 'Merge the block at the cursor with the next block', run: () => mergeBlock('next') },
    { id: 'merge-range', label: 'Merge range into one block… (start, end, block type)', key: 'M', run: () => setModal('merge') },
    { id: 'split', label: 'Split the block at the cursor (the byte or line) in two blocks of its type', key: 'S', run: () => splitAt() },
    { id: 'join-next', label: 'Join the bytes from the cursor to the end of the block with the next block', key: 'J', run: () => joinFrom('next') },
    { id: 'join-prev', label: 'Join the bytes from the start of the block to the cursor with the previous block', key: 'Shift+J', run: () => joinFrom('prev') },
    { id: 'block-size', label: 'Block size… (set where the block at the cursor starts and ends)', key: 'L', run: () => openBlockSize() },
    { id: 'relocate', label: 'Relocate the selection (or the block at the cursor): the program copies it elsewhere to run there… (on a relocated block: where it runs)', key: 'R', run: () => startRelocate() },
    { id: 'view-offset', label: 'Show the selection (or the block at the cursor) at another address, in the listing only (view offset)… (on a view offset: where)', key: 'O', run: () => startViewOffset() },
    ...(viewOffsets.length ? [{ id: 'view-offset-all', label: `Remove all view offsets (${viewOffsets.length}): show the bytes where they are loaded`, run: removeAllOffsets }] : []),
    { id: 'patch', label: 'Patch the selection (or the cursor line) with new code… (a patch on it: edit it)', key: 'P', run: () => startPatch() },
    ...project.patches.flatMap(p => [
      { id: `patch-switch-${p.id}`, label: `Switch ${p.off ? 'on' : 'off'} patch "${p.name}" (${patchSpan(p)})`, run: () => switchOnePatch(p, !!p.off) },
      { id: `patch-save-${p.id}`, label: `Save patch "${p.name}" (${patchSpan(p)}) as PRG…`, run: () => void savePatchPrg(p) },
    ]),
    ...A.blocks.filter(b => b.type === 'music').map(b => {
      const name = R.labels.get(b.start)?.name;
      return { id: `play-music-${b.start}`, label: `Play music ${name ? `${name} ` : ''}($${h4(spaceAddr(b.start))}-$${h4(spaceAddr(b.end - 1))}) in ${musicPlayerName}`, run: () => void playMusic(b.start) };
    }),
    { id: 'entry', label: 'Add entry point at cursor', key: 'E', run: addEntry },
    { id: 'start', label: 'Set the program start to the cursor line', run: () => { const a = lineAddr(); if (a != null) setStart(a); } },
    ...(project.entryPoint != null ? [{ id: 'start-clear', label: `Clear the program start $${h4(project.entryPoint)} (Build & Run starts the program with RUN)`, run: () => setStart(null) }] : []),
    { id: 'xrefs', label: 'Show cross-references', key: 'X', run: () => setUi({ bottom: 'xrefs', panelOpen: true }) },
    { id: 'relocs', label: 'Show the relocated blocks and the copy loops found (Relocated tab)', run: () => setUi({ bottom: 'relocs', panelOpen: true }) },
    { id: 'copy-lines', label: 'Copy the selected lines (or the line at the cursor) as source', key: 'Ctrl+C', run: copyLines },
    { id: 'side-panel', label: 'Toggle side panel (Explorer, Blocks, Symbols, Bookmarks, Pack)', key: 'Ctrl+Shift+B', run: () => toggleSide() },
    ...(inspector === 'auto' ? [{ id: 'inspector-show', label: 'Show the inspector (the memory map, the block at the cursor, its preview)', run: () => setDrawer('insp') }] : []),
    { id: 'inspector-mode', label: inspector === 'auto' ? 'Keep the inspector open beside the editor' : 'Fold in the inspector (a strip at the right edge opens it when you need it)', run: () => setInspector(inspector === 'auto' ? 'open' : 'auto') },
    { id: 'panel', label: 'Toggle bottom panel', key: 'Ctrl+J', run: () => setUi({ panelOpen: !useUi.getState().panelOpen }) },
    { id: 'verify', label: 'Verify round-trip (re-assemble and compare)', key: 'F7', run: () => void runVerify() },
    { id: 'build', label: `Build with ${asmTool} & run in VICE`, key: 'F5', run: () => void runBuild() },
    { id: 'build-debugger', label: `Build with ${asmTool} & run in ${debuggerName} (started as in VICE; Settings → Toolchain picks the debugger)`, key: 'Shift+F5', run: () => void runBuild(true) },
    { id: 'pack', label: `Pack with ${project.pack?.packer === 'exomizer' ? 'Exomizer' : 'Brokkr'} (build, verify, pack as the Pack view says)`, run: () => void runPack() },
    { id: 'pack-view', label: 'Show the Pack view (Exomizer)', run: () => setUi({ activity: 'pack', sidePanel: true }) },
    { id: 'library-show', label: 'Show the library: the SIDs, sprites, charsets and bitmaps kept for every project', run: () => showLibrary() },
    { id: 'library-add', label: 'Add the block at the cursor to the library (a music, sprite, charset or bitmap block)…', run: () => startLibraryAdd(cursor) },
    ...(packRes?.ok && packRes.path ? [
      ...(packRes.argv[1] === 'sfx' ? [{ id: 'pack-run', label: `Run the packed ${packRes.name} in VICE`, run: () => void runPacked() }] : []),
      { id: 'pack-save', label: `Save the packed ${packRes.name} as…`, run: () => void savePacked() },
    ] : []),
    { id: 'export', label: home ? `Export ${ASSEMBLERS[asm].name} project to ${home.name}\\source` : `Export ${ASSEMBLERS[asm].name} project to a folder…`, key: 'Ctrl+E', run: () => void exportProject() },
    ...(home ? [{ id: 'export-to', label: `Export ${ASSEMBLERS[asm].name} project to another folder…`, run: () => void exportProject(true) }] : []),
    { id: 'asm-continue', label: 'Continue in the Assembler: a new Assembler project of this program\'s source, its blocks marked, to go on writing…', run: () => void startContinue() },
    { id: 'build-templates', label: `Build templates: make and choose build.bat / build.sh templates for every project${project.buildTemplate ? ` (this one uses "${project.buildTemplate.name}")` : ''}`, run: () => openTemplates() },
    { id: 'build-template-new', label: 'New build template from the original build.bat and build.sh', run: () => openTemplates('new') },
    ...(!project.cart && project.buildTemplate?.builtIn !== 'exomizer' ? [{ id: 'build-template-exomizer', label: 'Build scripts: pack the program with Exomizer and start the packed file (the template Pack with Exomizer)', run: () => applyTemplate(builtInTemplate('exomizer', S, false)) }] : []),
    ...(project.buildTemplate ? [{ id: 'build-template-off', label: `Build scripts: generated from the settings again (not from the template "${project.buildTemplate.name}")`, run: () => applyTemplate(null) }] : []),
    { id: 'save', label: home ? `Save project (${home.name}.mimir.json; Mimir also saves as you work)` : 'Save: create a project from this work (a folder of its own)…', key: 'Ctrl+S', run: () => void saveProject() },
    { id: 'save-copy', label: 'Save a copy of the project file (.mimir.json)…', run: () => void saveProjectCopy() },
    { id: 'openproj', label: 'Open project (.mimir.json)…', run: () => void openProject() },
    ...(home ? [{ id: 'reveal', label: `Show the project folder (${home.dir})`, run: () => void kr?.revealProject().catch((e: unknown) => toast(errorText(e), 'err')) }] : []),
    { id: 'start-screen', label: home ? 'Close the project: the start screen (new project, recent projects)' : 'The start screen (new project, open, recent projects)', run: () => void toStartScreen() },
    { id: 'settings', label: 'Settings', key: 'Ctrl+,', run: () => setModal('settings') },
    { id: 'theme', label: 'Toggle light / dark theme', run: () => setUi({ theme: theme === 'dark' ? 'light' : 'dark' }) },
    { id: 'undo', label: `Undo${undoLabel ? ': ' + undoLabel : ''}`, key: 'Ctrl+Z', run: undo },
    { id: 'redo', label: 'Redo', key: 'Ctrl+Y', run: redo },
    { id: 'tab-listing', label: 'Show listing', run: () => setUi({ tab: 'listing' }) },
    { id: 'tab-drive', label: 'Show the drive code: the code for the 1541 the program uploads, re-assembled where it runs in the drive', run: () => setUi({ tab: 'drive' }) },
    { id: 'cycles', label: cycles ? 'Listing: hide cycle counts' : 'Listing: show cycle counts (6510 cycles per instruction; select a range or block to count it)', run: () => setUi({ cycles: !cycles, tab: 'listing' }) },
    { id: 'gfx-pictures', label: asmMode ? (gfxPictures ? 'Assembler: show the .byte lines of sprites, charsets and bitmaps as text' : 'Assembler: draw the .byte lines of sprites, charsets and bitmaps as pictures')
      : gfxPictures ? 'Listing: show sprites, charsets and bitmaps as .byte rows' : 'Listing: show sprites, charsets and bitmaps as pictures', run: () => setUi({ gfxPictures: !gfxPictures, tab: asmMode ? 'asm' : 'listing' }) },
    { id: 'data-as-code', label: dataAsCode ? 'Listing: show data as classified' : 'Listing: show data as code (find code that is marked as data)', run: () => setUi({ dataAsCode: !dataAsCode, tab: 'listing' }) },
    { id: 'offsets', label: offsets ? 'Listing: hide the offset in the file' : 'Listing: show the offset in the file (as SourceGen)', run: () => setUi({ offsets: !offsets }) },
    { id: 'text-cols', label: textCols ? 'Listing: hide the Text columns' : 'Listing: show each line\'s bytes as PETSCII and as screen codes (Text columns; with Data as code, every block as code with its text)', key: 'V', run: () => setUi({ textCols: !textCols, tab: 'listing' }) },
    { id: 'gutter', label: gutter === 'line' ? 'Listing: show memory addresses' : 'Listing: show line numbers (as in the .asm file)', run: () => setUi({ gutter: gutter === 'line' ? 'addr' : 'line' }) },
    { id: 'tab-source', label: `Show generated ${ASSEMBLERS[asm].name} source`, run: () => setUi({ tab: 'source' }) },
    { id: 'tab-gfx', label: 'Show memory as graphics (characters, sprites, bitmaps) to find and mark graphics', run: () => setUi({ tab: 'gfx' }) },
    { id: 'tab-mem', label: 'Show memory as the VICE monitor does (m: hex and text, i: PETSCII, ii: screen codes)', run: () => setUi({ tab: 'mem' }) },
    { id: 'tab-scripts', label: `Show the scripts: ${LANG_TITLE[codeLang]} code that runs in Mimir on a copy of the program`, run: () => setUi({ tab: 'scripts' }) },
    ...(userScripts.length ? [{ id: 'script-full', label: scriptsFull ? 'Leave the script editor\'s full screen (the rest of the window comes back)' : 'Script editor in full screen: it gets the whole window until you leave it', key: 'Alt+Enter',
      run: () => { useScripts.getState().set({ full: !scriptsFull }); if (!scriptsFull) setUi({ tab: 'scripts' }); } }] : []),
    { id: 'tab-git', label: 'Git: stage, commit and push the project (the Git tab)', run: () => setUi({ tab: 'git' }) },
    ...userScripts.map((s): Command => ({ id: `script-run-${s.id}`, label: `Run the script "${s.name}"${s.safe ? ' (safe mode: nothing goes into the program)' : ''}`, ...(s.key ? { key: s.key } : {}), run: () => void runUserScript(s.id) })),
    { id: 'script-new', label: sel && sel.multi && sel.end > sel.start ? 'New script from the selection (runs in Mimir on a copy of the program)' : `New script (${LANG_TITLE[codeLang]} code that runs in Mimir on a copy of the program)`, run: () => newUserScript(sel && sel.multi && sel.end > sel.start ? rangeLines(sel.start, sel.end) : []) },
    { id: 'tab-spec', label: 'Open the technical specification', run: () => setUi({ tab: 'spec' }) },
    { id: 'overview', label: 'Show the analysis overview: what the analysis found, with links to each part', run: () => setModal('overview') },
    { id: 'name-known', label: suggested.length ? `Name the ${suggested.length} routine${suggested.length === 1 ? '' : 's'} known from other projects (${suggested.slice(0, 3).map(m => m.name).join(', ')}${suggested.length > 3 ? ' …' : ''})` : 'Name the routines known from other projects (none here)', run: () => nameKnown() },
    { id: 'learn-project', label: `Learn the routines named in this project, so other projects get their names suggested (Mimir knows ${library.length})`, run: learnThisProject },
  ];
  const asmAsk = (what: 'run' | 'build' | 'debug' | 'debugger' | 'block') => useAsmLink.getState().request(what);
  const asmTool2 = stored.asm?.lang === '64tass' ? '64tass' : 'KickAss.jar';
  const commands: Command[] = asmMode ? [
    { id: 'tab-asm', label: 'Show the Assembler: the project\'s sources, checked as you type', run: () => setUi({ tab: 'asm' }) },
    { id: 'build', label: `Run: build the main file with ${asmTool2} and start it in VICE`, key: 'F5', run: () => asmAsk('run') },
    { id: 'asm-build', label: `Build the main file with ${asmTool2}, without starting it`, run: () => asmAsk('build') },
    { id: 'asm-debug', label: 'Debug the program a step at a time (the Assembler tab: Runs in memory only or the whole C64)', run: () => { setUi({ tab: 'asm' }); asmAsk('debug'); } },
    { id: 'asm-pack', label: `Pack with ${project.pack?.packer === 'exomizer' ? 'Exomizer' : 'Brokkr'}: build the main file with ${asmTool2} and pack it as the Pack view says`, run: () => { setUi({ activity: 'pack', sidePanel: true }); void runPack(); } },
    { id: 'asm-release', label: 'Release: make the build into a disk image, a tape image, a cartridge or a PRG, packed or not, and start it in VICE…', run: () => setAsmRelease(true) },
    { id: 'asm-scripts', label: 'Write build.bat and build.sh beside the main file (they build it and start it in VICE outside Mimir)', run: () => void asmScripts() },
    { id: 'bookmark', label: 'Add or edit the bookmark on the caret\'s line in the Assembler… (a selection of lines: on them)', key: 'Ctrl+F2', run: () => asmAsk2('bmAdd') },
    { id: 'bookmarks', label: 'Show bookmarks (notes on lines of the sources)', key: 'Ctrl+B', run: () => showBookmarks() },
    { id: 'bookmark-next', label: 'Go to the next bookmark', key: 'Alt+F2', run: () => asmAsk2('bmJump', { dir: 1 }) },
    { id: 'bookmark-prev', label: 'Go to the previous bookmark', key: 'Alt+Shift+F2', run: () => asmAsk2('bmJump', { dir: -1 }) },
    { id: 'codelib', label: 'Show the macro and code libraries (macros and pieces of code kept for every project)', run: () => showCodeLib() },
    { id: 'codelib-search', label: 'Search the macro and code libraries', key: 'Ctrl+Shift+M', run: () => showCodeLib(true) },
    { id: 'codelib-macro', label: 'Add the lines selected in the Assembler to the macro library… (none selected: the macro the caret is in)', run: () => asmAsk2('codeLib', { libKind: 'macro' }) },
    { id: 'codelib-code', label: 'Add the lines selected in the Assembler to the code library…', run: () => asmAsk2('codeLib', { libKind: 'code' }) },
    { id: 'codelib-import', label: 'Put macro files in the macro library… (each file with all its macros)', run: () => { showCodeLib(); void useCodeLib.getState().importFiles('macro').then(r => { if (r) toast(r.imported.length ? `${r.imported.length === 1 ? r.imported[0].file : `${r.imported.length} files`} put in the macro library${r.skipped.length ? `; not: ${r.skipped.join('; ')}` : ''}` : `Nothing was put in: ${r.skipped.join('; ')}`, r.skipped.length ? 'warn' : 'ok'); }, e => toast(`The files were not put in: ${errorText(e)}`, 'err')); } },
    { id: 'codelib-export', label: 'Export macros of the macro library… (to a file, or to a file of the library)', run: () => { showCodeLib(); useCodeLib.getState().set({ exporting: [] }); } },
    { id: 'asm-settings', label: `Assembler project settings: the language, the main file, more ${asmTool2} arguments (defines for the check too), where Debug runs`, run: asmSettings },
    { id: 'asm-debugger', label: `Run in ${debuggerName}: build the main file with ${asmTool2} and start it there with the sources and the breakpoints`, key: 'Shift+F5', run: () => asmAsk('debugger') },
    { id: 'asm-block', label: 'Insert a block where the caret is: sprites, a charset, a bitmap, a screen, music or data (from the library, a file, or empty .byte lines)', run: () => { setUi({ tab: 'asm' }); asmAsk('block'); } },
    ...allCommands.filter(c => ASM_COMMANDS.has(c.id) || c.id.startsWith('script-run-')),
  ] : allCommands;
  // the dialogs of "The work is not saved" hold the keys too
  const dialog = modal ?? (unsavedAsk || saveFirst || closeAsk ? 'project' : null);
  /** Pack a file over the work (Smart attach gave it a source): the work's keys wait until it goes back */
  const overWork = !!packSource;
  /* ---- the overview of the analysis (14.1b): it opens once the analysis of the files just loaded is in (the deep one
     when that is on) and the unpack they wait for (Unpack packed files when they are opened) is done, or 30 s have gone
     by; not over another dialog, nor for files the work no longer has ---- */
  const [overviewTick, setOverviewTick] = useState(0);
  useEffect(() => {
    const o = overviewFor.current;
    if (!o || rProject !== project || !final) return;
    if (Date.now() - o.n < 30000 && (unpacking.current || o.ids.some(id => toUnpack.current.has(id)))) {
      const t = setTimeout(() => setOverviewTick(n => n + 1), 250);
      return () => clearTimeout(t);
    }
    overviewFor.current = null;
    if (dialog || overWork || !useUi.getState().overview || !project.files.some(f => o.ids.includes(f.id))) return;
    setModal('overview');
  }, [A, rProject, project, final, overviewTick, dialog, overWork]);
  /* ---- the scripts that run after a load (UserScript.when 'load', 10.3): once the analysis of the files just loaded is
     in and the unpack they wait for is done, as the overview waits. The library's scripts with it that fit the program
     (they need no name of it, or it has them all) are added to the project as copies and run; the project's own with it
     run again when a file is added. One after the other, each once the analysis of what the one before did is in ---- */
  const [scriptsTick, setScriptsTick] = useState(0);
  useEffect(() => {
    const o = scriptsFor.current;
    if (!o || rProject !== project || !final) return;
    if (Date.now() - o.n < 30000 && (unpacking.current || o.ids.some(id => toUnpack.current.has(id)))) {
      const t = setTimeout(() => setScriptsTick(n => n + 1), 250);
      return () => clearTimeout(t);
    }
    scriptsFor.current = null;
    if (!project.files.some(f => o.ids.includes(f.id))) return;
    void runLoadScripts(o.add);
  }, [A, rProject, project, final, scriptsTick]); // eslint-disable-line react-hooks/exhaustive-deps
  const runLoadScripts = async (added: boolean) => {
    const { project: p, R: r } = latest.current;
    const names = new Set([...r.labels.values()].map(l => l.name));
    // the project's own (a file was added to it), then the library's that fit and check out here
    const own = added ? (p.userScripts ?? []).filter(s => s.when === 'load') : [];
    const copies: UserScript[] = [];
    for (const l of loadScripts(useScripts.getState().library, n => names.has(n), p.userScripts ?? [])) {
      const s: UserScript = { id: newId(), name: l.name, lang: l.lang, ...(l.code ? { code: l.code } : {}), source: l.source, pads: l.pads.map(x => ({ ...x })), when: 'load', ...(l.safe ? { safe: true } : {}), ...(l.init ? { init: structuredClone(l.init) } : {}),
        ...(l.machine ? { machine: l.machine } : {}), ...(l.stopAt ? { stopAt: l.stopAt } : {}), ...(l.table ? { table: l.table } : {}), ...(l.watch?.length ? { watch: l.watch.map(w => ({ ...w })) } : {}), ...(l.unwatch?.length ? { unwatch: [...l.unwatch] } : {}) };
      if (checkScript(scriptsEnv, s).ok) copies.push(s);
    }
    if (!own.length && !copies.length) return;
    if (copies.length) update(copies.length === 1 ? `Add "${copies[0].name}" from the library (it runs after a load)` : `Add ${copies.length} scripts from the library (they run after a load)`, d => { d.userScripts = [...(d.userScripts ?? []), ...copies]; });
    const all = [...own, ...copies];
    toast(`After the load: ${all.map(s => `"${s.name}"`).join(', ')} ${all.length === 1 ? 'runs' : 'run'}${copies.length ? ` (${copies.length === 1 ? 'a copy' : 'copies'} from the library, added to the project)` : ''}. Ctrl+Z takes back what ${all.length === 1 ? 'it does' : 'they do'}`, 'info');
    for (const s of all) { await analysisSettled(); await runUserScript(s.id); }
  };
  /** ← / →: the byte before or after the cursor's, on to the line before or after; from a line picked whole, its first
   *  (→) or last (←) byte. A line without bytes of its own as cells (an instruction) is picked whole. */
  const stepCell = (dirn: 1 | -1, extend: boolean) => {
    if (cursor == null || lineOf[cursor] < 0) return;
    const lines = view.lines, ci = lineOf[cursor], cs = cellsOf(lines[ci]);
    const cur = sel?.bytes ? cellAt(lines[ci], cursor) : null;
    let next: Cell | null = cs ? (cur ? cs[cs.findIndex(c => c.a === cur.a) + dirn] ?? null : dirn > 0 ? cs[0] : cs[cs.length - 1]) : null;
    if (!next) {
      const stop = (l: ListingLine) => ('n' in l && l.n > 0) || (l.k === 'hdr' && folded.has(l.a));
      let i = ci + dirn; while (i >= 0 && i < lines.length && !stop(lines[i])) i += dirn;
      if (i < 0 || i >= lines.length) return;
      const l = lines[i], lc = l.k === 'hdr' ? null : cellsOf(l);
      if (!lc) { if (extend) { extendTo(l); navigate(l.a, { keepSel: true, noHistory: true }); } else navigate(l.a, { noHistory: true }); return; }
      next = dirn > 0 ? lc[0] : lc[lc.length - 1];
    }
    pickCell(next, extend);
  };
  const closeXref = () => setXrefPick(null);
  const keyRef = useRef({ commands, cursor, curLine, lineOf, R, lines: view.lines, folded, tab, sel, editing, modal: dialog, overWork, extendTo, stepCell, findOpen, closeFind, drawer, closeInspector, removeHoveredComment, xrefOpen: !!xrefBox, closeXref, scriptsFull, asm: asmMode });
  keyRef.current = { commands, cursor, curLine, lineOf, R, lines: view.lines, folded, tab, sel, editing, modal: dialog, overWork, extendTo, stepCell, findOpen, closeFind, drawer, closeInspector, removeHoveredComment, xrefOpen: !!xrefBox, closeXref, scriptsFull, asm: asmMode };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = keyRef.current;
      if (k.overWork) return;
      const t = e.target as HTMLElement | null;
      const typing = !!t?.closest?.('input, textarea, select, .monaco-editor');
      const ctrl = e.ctrlKey || e.metaKey;
      const run = (id: string) => { const c = k.commands.find(x => x.id === id); if (c) { e.preventDefault(); c.run(); } };
      if (ctrl && e.shiftKey && e.key.toLowerCase() === 'p') { e.preventDefault(); setModal('palette'); return; }
      if (e.key === 'F1') { e.preventDefault(); setModal('palette'); return; }
      // an Assembler project's Assembler tab has keys of its own (the code, Run, Build, Debug): only Settings and the
      // bottom panel are the window's there
      if (k.asm && ctrl && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'm') { run('codelib-search'); return; }
      if (k.asm && k.tab === 'asm') { if (ctrl && !e.shiftKey && !e.altKey && (e.key === ',' || /^[jb]$/i.test(e.key))) run(e.key === ',' ? 'settings' : e.key.toLowerCase() === 'j' ? 'panel' : 'bookmarks'); return; }
      // Ctrl+F finds in the listing, and in the source and drive code tabs with Monaco's find (in the editor Monaco takes it itself)
      if (ctrl && !typing && e.key.toLowerCase() === 'f') { if (k.tab === 'listing' || k.tab === 'source' || k.tab === 'drive') run('find'); return; }
      if (e.key === 'F3' && k.tab === 'listing' && !k.modal) return run(e.shiftKey ? 'find-prev' : 'find-next');
      // Ctrl+↓ / Ctrl+↑: from block to block
      if (ctrl && !e.shiftKey && !e.altKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp') && !typing && !k.editing && !k.modal && k.tab === 'listing') return run(e.key === 'ArrowDown' ? 'block-next' : 'block-prev');
      if (ctrl && !typing) {
        const map: Record<string, string> = { z: e.shiftKey ? 'redo' : 'undo', y: 'redo', o: 'open', s: 'save', e: 'export', g: 'goto', ',': 'settings', j: 'panel', b: e.shiftKey ? 'side-panel' : 'bookmarks' };
        const id = map[e.key.toLowerCase()]; if (id) return run(id);
      }
      if (ctrl && (e.key.toLowerCase() === 's' || e.key.toLowerCase() === 'o')) return run(e.key.toLowerCase() === 's' ? 'save' : 'open');
      // Ctrl+C in the listing copies its lines; text selected with the mouse elsewhere is copied as usual
      if (ctrl && !e.shiftKey && !typing && !k.modal && !k.editing && e.key.toLowerCase() === 'c' && k.tab === 'listing' && (t?.closest?.('.listing') || !window.getSelection()?.toString())) return run('copy-lines');
      // Alt+Enter: the script editor in full screen and back (in its code Monaco's command does it)
      if (e.altKey && !ctrl && !e.shiftKey && e.key === 'Enter' && k.tab === 'scripts' && !k.modal && !e.defaultPrevented) { e.preventDefault(); toggleScriptsFull(); return; }
      if (e.altKey && !ctrl && !e.shiftKey && !k.modal && /^[1-9]$/.test(e.key)) { const c = k.commands.find(x => x.key === `Alt+${e.key}` && x.id.startsWith('script-run-')); if (c) { e.preventDefault(); c.run(); return; } }
      // (an Assembler project's Shift+F5: its build in the debugger)
      if (e.key === 'F5') return run(e.shiftKey ? (k.asm ? 'asm-debugger' : 'build-debugger') : 'build');
      if (e.key === 'F9') return run('quicksave');
      if (e.key === 'F7') return run('verify');
      if (e.key === 'F8' && !typing && !k.modal && !k.editing && k.tab === 'listing') { e.preventDefault(); return run(e.shiftKey ? 'watch' : 'breakpoint'); }
      if (typing || k.editing || k.modal || ctrl || (e.altKey && !['ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp'].includes(e.key))) return;
      // the inspector opened from its strip (or a narrow window's drawer): Esc folds it in, and only that
      if (e.key === 'Escape' && k.drawer === 'insp') { e.preventDefault(); k.closeInspector(); return; }
      // the script editor in full screen: Esc outside its code (and with no dialog open, whose Esc closes it) leaves it
      if (e.key === 'Escape' && k.scriptsFull && !document.querySelector('[role="dialog"]')) { e.preventDefault(); toggleScriptsFull(); return; }
      if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); goBack(); return; }
      if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); goFwd(); return; }
      // the next program on the disk or the tape, and the one before
      if (e.altKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) return run(e.key === 'ArrowDown' ? 'medium-next' : 'medium-prev');
      if (e.key === 'F2') return run(e.shiftKey ? 'bookmark-prev' : 'bookmark-next');
      if (k.tab !== 'listing') return;
      const lines = k.lines;
      // the cursor stops on lines with bytes, and on the header of a folded block
      const stop = (l: ListingLine) => ('n' in l && l.n > 0) || (l.k === 'hdr' && k.folded.has(l.a));
      const moveTo = (i0: number, dirn: number, extend?: boolean) => {
        let i = i0; while (i >= 0 && i < lines.length && !stop(lines[i])) i += dirn;
        if (i < 0 || i >= lines.length) return;
        const l = lines[i];
        if (extend) {
          k.extendTo(l);
          navigate(l.a, { keepSel: true, noHistory: true });
        } else navigate(l.a, { noHistory: true });
      };
      const ci = k.cursor != null ? k.lineOf[k.cursor] : 0;
      const page = Math.max(5, Math.floor((listRef.current?.clientHeight || 400) / ROW) - 3);
      // an empty line above the cursor line, and one less
      if (e.shiftKey && e.key === 'Enter') return run('blank-line');
      if (e.shiftKey && e.key === 'Backspace') return run('blank-remove');
      switch (e.key) {
        case 'ArrowDown': e.preventDefault(); moveTo(ci + 1, 1, e.shiftKey); return;
        case 'ArrowUp': e.preventDefault(); moveTo(ci - 1, -1, e.shiftKey); return;
        case 'PageDown': e.preventDefault(); moveTo(Math.min(lines.length - 1, ci + page), 1, e.shiftKey); return;
        case 'PageUp': e.preventDefault(); moveTo(Math.max(0, ci - page), -1, e.shiftKey); return;
        case 'Home': e.preventDefault(); moveTo(0, 1, e.shiftKey); return;
        case 'End': e.preventDefault(); moveTo(lines.length - 1, -1, e.shiftKey); return;
        // byte by byte through the data lines (Shift selects)
        case 'ArrowRight': case 'ArrowLeft': e.preventDefault(); k.stepCell(e.key === 'ArrowRight' ? 1 : -1, e.shiftKey); return;
        case 'Enter': { const l = k.curLine; const tk = l && 'tok' in l ? l.tok.find(x => x.to != null && (x.t === 'lbl' || x.t === 'kw')) : undefined; if (tk) { e.preventDefault(); navigate(tk.to!); } return; }
        // with a label's references beside it, Esc closes only them; with the find widget open, only it
        case 'Escape': e.preventDefault(); if (k.xrefOpen) k.closeXref(); else if (k.findOpen) k.closeFind(); else goBack(); return;
        case 'Backspace': e.preventDefault(); goBack(); return;
        // with the pointer resting on a comment: it goes (elsewhere Delete does nothing in the listing)
        case 'Delete': if (k.removeHoveredComment()) e.preventDefault(); return;
        default: break;
      }
      const key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
      const single: Record<string, string> = { B: 'bookmark', F: 'fold', G: 'goto', M: 'merge-range', R: 'relocate', O: 'view-offset', P: 'patch', N: e.shiftKey ? 'rename-operand' : 'rename', ';': 'comment', '/': 'note-line', '*': 'note-block', U: 'auto', E: 'entry', X: 'xrefs', C: 'mark-code', D: 'mark-bytes', W: 'mark-words', T: 'mark-text', S: 'split', J: e.shiftKey ? 'join-prev' : 'join-next', L: 'block-size', V: 'text-cols' };
      if (single[key]) run(single[key]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]); // eslint-disable-line react-hooks/exhaustive-deps

  const onClickLine = (l: ListingLine, i: number, e: ReactMouseEvent, dbl?: boolean, cell?: Cell | null) => {
    // a byte of a data line is picked by itself; Shift+click on one selects byte by byte up to it
    if (cell && !dbl) { setPickedDef(null); setXrefPick(null); pickCell(cell, e.shiftKey && cursor != null); listRef.current?.focus(); return; }
    // Shift+click extends the selection; on a block header it takes in the whole block
    if (e.shiftKey && cursor != null) { setXrefPick(null); if (extendTo(l)) setCursor(l.a); return; }
    const def = labelDefAt(l), zl = zpDefOf(l, i);
    setPickedDef(def ? { ...def, line: zl?.line ?? i, at: l.a } : zl ? { ...zl, at: l.a } : null);
    // a label's line (its own, or its `.label` line): the box of its references opens beside it, and a press on the line
    // while its box is up closes it again (a double-click renames, with no box)
    const shut = xrefBox != null && xrefBox.line === i;
    if (!dbl) setXrefPick(shut ? null : l.k === 'lbl' ? { a: l.a, zp: false, line: i, at: l.a, via: null } : def ? { a: def.addr, zp: def.zp, line: i, at: l.a, via: null } : null);
    // a comment line of a zero-page variable opens its editor
    if (zl && dbl && l.k === 'cmt') { navigate(l.a, { noHistory: true }); startNote(!!project.notes[zl.addr]?.block, undefined, zl); return; }
    if (def && dbl) { navigate(l.a, { noHistory: true }); startDefRename(def, i); return; }
    if (l.k === 'hdr') {
      navigate(l.a, { noHistory: true }); const b = A.blocks[l.blk]; if (b) setSel({ start: b.start, end: b.end, multi: true, anchor: b.start, anchorEnd: b.end });
      // the inspector folded in opens over the editor with the block clicked
      if (inspector === 'auto' && !window.matchMedia?.('(max-width: 900px)').matches) setDrawer('insp');
      return;
    }
    if (l.a == null) return;
    // an empty line the user inserted: the cursor goes to the line under it; a double-click writes a comment line on it
    // (the address's comment moves there)
    if (l.k === 'blank') {
      navigate(l.a, { noHistory: true });
      if (dbl && l.user) startNoteOn(!!project.notes[l.a]?.block, l, i); else listRef.current?.focus();
      return;
    }
    const n = 'n' in l ? l.n : 0;
    navigate(l.a, { noHistory: true });
    if (n > 0) setSel({ start: l.a, end: l.a + n, multi: false, anchor: l.a, anchorEnd: l.a + n });
    if (dbl) {
      if (l.k === 'cmt' && l.note) startNote(!!project.notes[l.a]?.block, l.a);
      else if (l.k === 'lbl' || l.k === 'ins') { setLabelError(null); setEditing({ kind: 'label', addr: l.a, value: R.labels.get(l.a)?.name ?? '' }); }
      else startComment(l.a);
    }
    listRef.current?.focus();
  };
  const onToken = (t: Token) => { if (t.to != null && A.owner[t.to] >= 0) navigate(t.to, { center: true }); else if (t.sym) toast(`${t.sym.name}: ${t.sym.desc}`, 'info'); };
  const onContext = (e: ReactMouseEvent, l: ListingLine, cell?: Cell | null) => {
    e.preventDefault();
    // an empty line the user inserted: turn it into a comment line or block, write one above it (or move the address's
    // comment onto it or above it), remove it, or put in another next to it (above the comment or under it, as this one is)
    if (l.k === 'blank') {
      if (!l.user) return;
      navigate(l.a, { noHistory: true });
      const i = view.lines.indexOf(l), under = !!l.under, n = blanksAt(l.a)[under ? 'under' : 'above'], note = project.notes[l.a];
      // the comment goes between the empty lines before this one and the rest: it is there already when it is right above
      // (in its place it would only take the empty line away, which Remove empty line does)
      const at = blankIndex(l, i), kind = note?.block ? 'block' : 'line', moves = !!note && at !== blanksAt(l.a).above;
      setMenu({ x: e.clientX, y: e.clientY, items: [
        ...(note
          ? [
            ...(moves ? [
              { label: `Move the comment ${kind} here, in place of the empty line`, icon: 'comment', run: () => setNote(l.a, note.text, !!note.block, at, true) },
              { label: `Move the comment ${kind} above it`, run: () => setNote(l.a, note.text, !!note.block, at) },
            ] satisfies MenuItem[] : []),
            { label: moves ? `Move the comment ${kind} above it and edit it…` : `Edit the comment ${kind}…`, ...(moves ? {} : { icon: 'comment' }), run: () => startNoteOn(!!note.block, l, i) },
          ] satisfies MenuItem[]
          : [
            { label: 'Turn into a comment line…', icon: 'comment', run: () => startNoteOn(false, l, i, true) },
            { label: 'Turn into a comment block…', run: () => startNoteOn(true, l, i, true) },
            { label: 'Comment line above it…', run: () => startNoteOn(false, l, i) },
            { label: 'Comment block above it…', run: () => startNoteOn(true, l, i) },
          ] satisfies MenuItem[]),
        { sep: true },
        { label: 'Remove empty line', ...(under ? {} : { key: 'Shift+Backspace' }), run: () => setBlanks(l.a, n - 1, under) },
        ...(n > 1 ? [{ label: `Remove all ${n} empty lines ${under ? 'under the comment' : 'here'}`, run: () => setBlanks(l.a, 0, under) }] : []),
        { label: 'Insert another empty line', ...(under ? {} : { key: 'Shift+Enter' }), run: () => setBlanks(l.a, n + 1, under) },
      ] });
      return;
    }
    // a byte of a data line outside the selection is picked first, and the items act on it
    const picked: Sel | null = cell && !(sel && sel.multi && cell.a >= sel.start && cell.a + cell.n <= sel.end)
      ? { start: cell.a, end: cell.a + cell.n, multi: true, anchor: cell.a, anchorEnd: cell.a + cell.n, bytes: true } : null;
    if (picked && cell) pickCell(cell);
    const cs = picked ?? sel, at = cell?.a ?? l.a;
    const inSel = !!(cs && cs.multi && at >= cs.start && at < cs.end);
    if (l.a != null && !inSel) navigate(l.a, { noHistory: true });
    // the items act on this line (or the selection around it): the cursor only moves here after this render
    const b = findBlock(A.blocks, l.a), zl = zpDefOf(l, view.lines.indexOf(l));
    if (zl) setPickedDef({ ...zl, at: l.a });
    const range = inSel && cs ? { start: cs.start, end: cs.end } : b ? { start: l.a, end: b.end } : null;
    /** the byte (or word) or the line the split and join items start from */
    const item: Range | null = cell ? { start: cell.a, end: cell.a + cell.n } : 'n' in l && l.n > 0 ? lineRange(l) : null;
    const span = (s: Addr, e: Addr) => `$${h4(s)}${e - s > 1 ? `-$${h4(e - 1)}` : ''}`;
    const oneByte = !!(cs?.bytes && inSel && cs.anchor === cs.start && cs.anchorEnd === cs.end);
    const def = labelDefAt(l) ?? (zl ? { addr: zl.addr, zp: true } : null);
    // the label N renames (the line's own: a `.label` line's, else the one at the line's address, or none yet there) and
    // the label or zero-page variable the operand names, which Shift+N renames (a data line's: the byte's clicked)
    const own: Addr | null = def ? def.addr : l.a != null ? (A.codeOwner[l.a] >= 0 ? A.codeOwner[l.a] : l.a) : null;
    const ownLabel = own == null ? undefined : def?.zp ? R.zp.get(own) : R.labels.get(own);
    const ownName: NameRef | null = own != null && ownLabel ? { addr: own, zp: !!def?.zp, name: ownLabel.name } : null;
    const op = def ? null : operandName(l, R, cell);
    const opName = op && !(!op.zp && op.addr === own) ? op : null;
    // the name the library suggests for the line's routine (as it is suggested), and the one it has there (to forget)
    const knownAt = own != null && !def?.zp ? suggested.find(m => m.addr === own) : undefined;
    const knownOf = knownHere.find(m => m.addr === own) ?? knownAt!;
    const p = l.a != null ? patchAt(project.patches, l.a) : undefined;
    // in a selection of more than one line: the bookmark on its first line, a new one on its area
    const area = inSel ? selArea(cs) : null, bmAt = area ? bookmarkOnLine(area.start) : l.a != null ? bookmarkOnLine(l.a) : null;
    const hasBm = bmAt != null && !!project.bookmarks[bmAt];
    // in the selection: all its lines; the line itself as well
    const nLines = inSel ? selectedLines().length : 0;
    // what a script can be linked to here (spec 10.3): the line's label (a .label line's, a byte's of a data line), and
    // what an instruction's operand names
    const linkAt: Addr[] = [];
    const linkPush = (a: Addr | null | undefined) => { if (a != null && !linkAt.includes(a)) linkAt.push(a); };
    if (def) linkPush(def.addr);
    else if (l.k === 'lbl' || l.k === 'hdr') linkPush(l.a);
    else if (cell) linkPush(cell.a);
    else if (l.k === 'dat') linkPush(l.a);
    else if (l.k === 'ins') {
      if (R.labels.has(l.a)) linkPush(l.a);
      const d = decode(A.mem, l.a), m = d.info.mode;
      linkPush(l.tok.find(t => t.to != null)?.to ?? (d.v != null && m !== 'imm' && m !== 'rel' ? d.v : null));
    }
    /** Block: fold it, change where it starts and ends, and whether it is built */
    const blockItems: MenuItem[] = [
      { label: folded.has(b?.start ?? -1) ? 'Unfold block' : 'Fold block', key: 'F', run: () => toggleFold(l.a) },
      { sep: true },
      ...((): MenuItem[] => {
        // from the byte or the line: split the block there, or join the rest of it (or its start) with the block next to it
        if (!item || l.k === 'hdr') return [];
        const out: MenuItem[] = [];
        if (!('error' in splitBlock(A, item.start))) out.push({ label: `Split block at $${h4(item.start)}`, key: 'S', run: () => splitAt(item.start) });
        for (const [dir, word, key] of [['next', 'next', 'J'], ['prev', 'previous', 'Shift+J']] as const) {
          const m = moveFrom(A, item.start, dir, item.end), edge = lineMove(A, l, dir);
          // the line at the block's edge already moves these bytes (the Move item)
          if ('error' in m || (edge && edge.start === m.start && edge.end === m.end)) continue;
          out.push({ label: `Join ${span(m.start, m.end)} with the ${word} block (${kindInfo(m.into.type).label})`, key, run: () => moveInto(m) });
        }
        return out;
      })(),
      // a line at a block's edge: the same as dragging it into the neighbouring block
      ...([['prev', 'previous'], ['next', 'next']] as const).flatMap(([dir, word]): MenuItem[] => { const m = lineMove(A, l, dir); return m ? [{ label: `Move $${h4(m.start)}${m.end - m.start > 1 ? `-$${h4(m.end - 1)}` : ''} into the ${word} block (${kindInfo(m.into.type).label})`, run: () => moveInto(m) }] : []; }),
      ...([['prev', 'previous'], ['next', 'next']] as const).flatMap(([dir, word]): MenuItem[] => { const m = mergeOverride(A, l.a, dir); return m ? [{ label: `Merge with ${word} block (${kindInfo(m.other.type).label}) → ${kindInfo(m.into).label}`, run: () => mergeBlock(dir, l.a) }] : []; }),
      { label: 'Merge range into one block…', key: 'M', run: () => { if (!inSel) setCursor(l.a); setModal('merge'); } },
      ...(b ? [{ label: 'Block size… (start and end)', key: 'L', run: () => openBlockSize(l.a) }] : []),
      { sep: true },
      ...(l.k === 'ins' ? [{ label: project.breakpoints?.includes(l.a) ? 'Remove breakpoint' : 'Set breakpoint (a debugger stops here)', key: 'F8', run: () => toggleBreakpoint(l.a) }] : []),
      ...('n' in l && l.n > 0 ? [{ label: project.watches?.includes(l.a) ? `Stop watching $${h4(l.a)}` : `Watch $${h4(l.a)} in the debugger`, key: 'Shift+F8', run: () => toggleWatch(l.a) }] : []),
      { sep: true },
      { label: project.excluded.includes(b?.start ?? -1) ? 'Include block in the build' : 'Exclude block from the build', run: () => toggleExcluded(l.a) },
      { label: project.binary.includes(b?.start ?? -1) ? 'Write block in the source again' : `Save block as a binary file (${words.binary})`, run: () => toggleBinary(l.a) },
      // junk (11.7): the selection's bytes or the block's, left out of the listing, the source and the output
      ...(inSel && cs ? [{ label: 'Mark selection as junk (left out of everything)', run: () => markJunk({ start: cs.start, end: cs.end }) }]
        : b ? [{ label: 'Mark block as junk (left out of everything)', run: () => markJunk({ start: b.start, end: b.end }) }] : []),
      { label: 'Mark range as junk… (start, end)', run: () => openJunkRange(inSel && cs ? { start: cs.start, end: cs.end } : b ? { start: l.a, end: b.end } : null) },
    ];
    /** Program: where it starts and what the analysis traces, new code, code that runs elsewhere, and the pack */
    const programItems: MenuItem[] = [
      { label: 'Add entry point here', key: 'E', run: () => addEntry(l.a) },
      { label: 'Set as program start', run: () => setStart(l.a) },
      ...(project.entryPoint != null ? [{ label: `Clear program start ($${h4(project.entryPoint)})`, run: () => setStart(null) }] : []),
      { sep: true },
      ...((): MenuItem[] => {
        // new code over the selection, the line or the block of a header (a patched line has its patch's own submenu)
        const r = inSel && cs ? { start: cs.start, end: cs.end } : ('n' in l && l.n > 0) || l.k === 'hdr' ? lineRange(l) : null;
        return r && !p ? [{ label: inSel ? 'Patch selection with new code…' : l.k === 'hdr' ? 'Patch block with new code…' : 'Patch line with new code…', key: 'P', run: () => startPatch(r) }] : [];
      })(),
      ...((): MenuItem[] => {
        // a script (spec 10.3) that starts with the selection's code, or the block's: a loop to run in Mimir
        const r = inSel && cs ? { start: cs.start, end: cs.end } : b ? { start: b.start, end: b.end } : null;
        return r ? [{ label: `New script from ${inSel ? 'selection' : 'block'} (runs in Mimir on a copy of the program)`, run: () => newUserScript(rangeLines(r.start, r.end)) }] : [];
      })(),
      ...((): MenuItem[] => {
        // what the code at the line suggests a script for (10.3): a loop that decrypts, a routine the program calls
        const a = l.a;
        if (a == null) return [];
        const loop = cryptLoops.find(x => a >= x.start && a < x.end);
        const called = A.xrefs.get(a)?.some(x => x.kind === 'call');
        return [
          ...(loop ? [{ label: `Script for this loop: ${cryptStepsText(loop.steps)}${loop.length != null ? ` over ${loop.length} bytes` : ''}, into a scratchpad`, icon: 'prompt' as const, run: () => addCryptScript(loop) }] : []),
          ...(called ? [{ label: `New script that calls ${scriptLinkOf(a).name} as the program does`, icon: 'prompt' as const, run: () => addCallScript(a) }] : []),
        ];
      })(),
      ...((): MenuItem[] => {
        // on a relocated block (where it is loaded or runs): where it runs, or not; else relocate the selection or the block
        const rl = l.a != null ? (relocLoadedAt(A, l.a) ?? (inSel ? undefined : relocAt(A, l.a))) : undefined;
        if (rl) return [
          { label: `Change where $${h4(rl.start)}–$${h4(rl.end - 1)} runs ($${h4(rl.to)})…`, key: 'R', run: () => startRelocate({ start: rl.start, end: rl.end }) },
          { label: `Stop relocating $${h4(rl.start)}–$${h4(rl.end - 1)} (read it where it is loaded)`, run: () => unrelocate(rl.start) },
        ];
        const r = inSel && cs ? { start: cs.start, end: cs.end } : b ? { start: b.start, end: b.end } : null;
        return r ? [{ label: `Relocate ${inSel ? 'selection' : 'block'}… (the program copies it elsewhere to run)`, key: 'R', run: () => startRelocate(r) }] : [];
      })(),
      ...((): MenuItem[] => {
        // 10.4: on a view offset, where it is shown or not; else show the selection or the block at another address
        const o = l.a != null && !inSel ? viewOffsetAt(viewOffsets, l.a) : undefined;
        if (o) return [
          { label: `Change where $${h4(o.start)}–$${h4(o.end - 1)} is shown ($${h4(o.to)})…`, key: 'O', run: () => startViewOffset({ start: o.start, end: o.end }) },
          { label: `Remove the offset (show $${h4(o.start)}–$${h4(o.end - 1)} where it is loaded)`, run: () => removeOffset(o.start) },
        ];
        const r = inSel && cs ? { start: cs.start, end: cs.end } : b ? { start: b.start, end: b.end } : null;
        return r && !relocAt(A, r.start) ? [{ label: `Show ${inSel ? 'selection' : 'block'} at another address (listing only)…`, key: 'O', run: () => startViewOffset(r) }] : [];
      })(),
      { sep: true },
      ...((): MenuItem[] => {
        // the Pack view: the selection, else the whole block, where its bytes are in the built PRG (a relocated block's
        // where it is loaded, 8.1b)
        const r0 = inSel && cs ? { start: cs.start, end: cs.end } : b ? { start: b.start, end: b.end } : null;
        const r = r0 && loadRange(A, r0.start, r0.end);
        if (!r) return [];
        const cover = project.pack?.ranges ? rangeCover(project.pack.ranges, r.start, r.end) : 0, what = inSel ? 'selection' : 'block';
        return [
          ...(cover < r.end - r.start ? [{ label: `Pack ${what} with ${project.pack?.packer === 'exomizer' ? 'Exomizer' : 'Brokkr'}`, run: () => packRange(r, true) }] : []),
          ...(cover > 0 ? [{ label: `Leave ${what} out of the pack`, run: () => packRange(r, false) }] : []),
        ];
      })(),
    ];
    /** Memory banking: the memory configuration ($01) and the VIC bank the code runs with, where it differs from what was
     *  detected */
    const bankItems: MenuItem[] = A.mcfg ? [
      { header: 'Memory configuration ($01)' },
      ...[7, 6, 5, 4, 3, 2, 1, 0].map(c => ({ label: `${portName(c)} · ${portText(c, A.mcfg?.cart)}`, run: () => { if (range) setBankZone(range, 'port', 0x30 + c); } })),
      { label: 'Detected (automatic)', run: () => { if (range) setBankZone(range, 'port', null); } },
      { sep: true },
      { header: 'VIC bank' },
      ...[0, 1, 2, 3].map(vb => ({ label: `Bank ${vb} · ${bankRange(vb)}`, run: () => { if (range) setBankZone(range, 'vicBank', vb); } })),
      { label: 'Detected (automatic)', run: () => { if (range) setBankZone(range, 'vicBank', null); } },
    ] : [];
    // What the line is for comes first (a music block plays, a patched line has its patch), then what is done most:
    // rename, comment, bookmark and mark as, one click each and with an icon. The rest is grouped in submenus by what it
    // acts on (the block, the program, the memory banking), and the cross-references and copies come last.
    setMenu({
      x: e.clientX, y: e.clientY, items: [
        ...(b?.type === 'music' ? [{ label: `Play music in ${musicPlayerName} (${R.labels.get(b.start)?.name ?? `$${h4(spaceAddr(b.start))}`})`, icon: 'play', run: () => void playMusic(b.start) }] satisfies MenuItem[] : []),
        ...(b && libraryKindOf(b.type) ? [{ label: `Add to library (${LIB_KIND[libraryKindOf(b.type)!].folder})…`, icon: 'library', run: () => startLibraryAdd(b.start) }] satisfies MenuItem[] : []),
        ...(p ? [{ label: `Patch "${p.name}"`, icon: 'code', children: [
          { label: 'Edit patch…', key: 'P', run: () => editPatch(p) },
          { label: p.off ? 'Switch on' : 'Switch off (the original bytes come back)', run: () => switchOnePatch(p, !!p.off) },
          { label: 'Save as PRG…', run: () => void savePatchPrg(p) },
          { sep: true },
          { label: `Remove patch${p.off ? '' : ' (the original bytes come back)'}`, run: () => removePatch(p) },
        ] }] satisfies MenuItem[] : []),
        { sep: true },
        // each rename item says what it renames: the line's own label (N), and the label or zero-page variable its operand
        // names (Shift+N) where that is another one
        // (a byte a view offset shows elsewhere gets its label where it is shown, 10.4)
        { label: renameText(ownName, own != null ? shownAddress(R.viewOffsets, own) : own), key: 'N', icon: 'pencil', run: () => (def ? startDefRename(def, zl?.line ?? view.lines.indexOf(l)) : startRename(l.a)) },
        ...(opName ? [{ label: renameText(opName, opName.addr), key: 'Shift+N', icon: 'pencil', run: () => startOperandRename(l, cell ?? null) }] satisfies MenuItem[] : []),
        // a routine known from another project (10.5): its name there, one click; and a name suggested wrongly forgotten
        ...(knownAt ? [
          { label: `Name it ${knownAt.name} (known${knownAt.from ? ` from ${knownAt.from}` : ''})`, icon: 'pencil', run: () => nameKnown([knownAt]) },
          { label: `Forget ${knownOf.name}: not this routine`, run: () => forgetKnown(knownOf.name) },
        ] satisfies MenuItem[] : []),
        // a zero-page variable's .label line, or an instruction that uses one: join it with a neighbour into 16 bits, or split it
        { label: '16-bit variable', children: zpPairItems(zl ? zl.addr : zpOperand(l)) },
        // on a zero-page variable's .label line (or its comment lines) these comment the variable
        { label: zl ? 'Comment at the end of the .label line…' : 'Comment at the end of the line…', key: ';', icon: 'comment', run: () => (zl ? startComment(undefined, zl) : startComment(l.a)) },
        { label: zl ? 'Comment above the .label line' : 'Insert above', children: [
          { label: 'Comment line…', key: '/', run: () => (zl ? startNote(false, undefined, zl) : startNote(false, l.a)) },
          { label: 'Comment block…', key: '*', run: () => (zl ? startNote(true, undefined, zl) : startNote(true, l.a)) },
          // the file's head has no line of its own address: empty lines go in the code and data
          ...(zl || l.k === 'file' || ('head' in l && l.head) ? [] : ((): MenuItem[] => {
            const { above, under } = blanksAt(l.a), n = above + under;
            return [
              { sep: true },
              { label: 'Empty line', key: 'Shift+Enter', run: () => addBlank(l.a) },
              ...(n ? [{ label: n > 1 ? `Remove an empty line (${n} above)` : 'Remove the empty line', key: 'Shift+Backspace', run: () => removeBlank(l.a) }] : []),
            ];
          })()),
        ] },
        { label: hasBm ? 'Edit bookmark…' : 'Add bookmark…', key: 'B', icon: 'bookmark', run: () => startBookmark(l.a, area) },
        ...(hasBm ? [{ label: 'Remove bookmark', run: () => deleteBookmark(bmAt!) }] : []),
        ...linkAt.map(linkMenu),
        { sep: true },
        { label: oneByte && cs ? `Mark ${span(cs.start, cs.end)} as` : inSel ? 'Mark selection as' : 'Mark from here as', icon: 'tag', children: [
          ...MARK_AS.map(m => ({ label: m.label, key: m.key, run: () => { if (range) mark(m.id, range, { bytes: inSel && cs?.bytes ? cs : null }); } })),
          { sep: true },
          // 11.7: the same bytes left out of everything
          ...(range ? [{ label: 'Junk (left out of everything)', run: () => markJunk(range) }] : []),
          { label: 'Clear override (automatic)', key: 'U', run: () => { if (range) clearOverride(range); } },
        ] },
        { label: 'Block', children: blockItems },
        { label: 'Program', children: programItems },
        { label: 'Memory banking', children: bankItems },
        { sep: true },
        { label: 'Show cross-references', key: 'X', icon: 'target', run: () => setUi({ bottom: 'xrefs', panelOpen: true }) },
        ...(nLines > 1 ? [{ label: `Copy ${nLines} selected lines`, key: 'Ctrl+C', icon: 'copy', run: copyLines }] satisfies MenuItem[] : []),
        // Ctrl+C copies the line at the cursor (the line right-clicked) when no more than it is selected
        nLines > 1 ? { label: 'Copy line', run: () => void copyText(lineText(l, S).trim()) } : { label: 'Copy line', key: 'Ctrl+C', icon: 'copy', run: () => void copyText(lineText(l, S).trim()) },
        { label: `Copy address $${h4(l.a ?? cursor ?? 0)}`, run: () => void copyText('$' + h4(l.a ?? cursor ?? 0)) },
        // the block written as its type is (code, text, characters, …) into a script's scratchpad, and the selection's
        // bytes (else the line's) as they are (10.3)
        ...((): MenuItem[] => {
          const blockItem = b ? blockCopyMenu(b.start) : null;
          const r = inSel && cs ? { start: cs.start, end: cs.end } : l.k === 'hdr' && b ? { start: b.start, end: b.end } : lineRange(l);
          return [...(blockItem ? [blockItem] : []), ...(r && r.end > r.start ? [padCopyMenu(r.start, r.end)] : [])];
        })(),
      ],
    });
  };

  const rKey = useMemo(() => filesKey(R), [R]);
  const stale = !!build && build.key !== rKey;
  const packPrefs = useMemo(() => project.pack ?? packDefaults(A, project), [project.pack, project.entryPoint, project.entryPort, A]); // eslint-disable-line react-hooks/exhaustive-deps
  const packKey = packKeyOf(packPrefs, rKey);
  const kickProblems: KickProblem[] = !stale && build?.kick ? build.kick.problems : [];
  const problems: UiProblem[] = useMemo(() => [
    ...kickProblems.map(p => ({ lvl: p.severity === 'error' ? 'err' as const : 'warn' as const, msg: `${p.file ? `${p.file}:${p.line}:${p.column} ` : ''}${p.message}`, addr: p.file ? (R.fileLines[p.file]?.[p.line - 1]?.a ?? null) : null, cat: 'kickass' })),
    ...R.problems.map(p => ({ ...p, cat: 'render' })),
    // without bank tracking I/O inside the loaded bytes is written as labels: the row turns it on
    ...A.log.filter(l => l.lvl === 'warn' || l.lvl === 'err' || l.lvl === 'hint').map(l => (l.code === 'io-as-labels' ? { ...l, action: { label: 'Turn on', run: () => {
      update('Follow the memory configuration ($01) and VIC bank', d => { d.settings.bankTracking = true; });
      toast('Following the memory configuration ($01) and VIC bank: I/O accesses are written as registers', 'ok');
    } } } : l.code === 'copy-loop' && l.addr != null && A.copies.some(c => c.at === l.addr) ? { ...l, action: { label: 'Relocate…', run: () => startRelocate(null, l.addr!) } } : l)),
    ...packing.flatMap((p, i) => (p ? [{ lvl: 'warn' as const, msg: `${A.files[i].name} ${p.verdict === 'packed' ? 'is packed' : 'may be packed'}${p.signature ? ` (${p.signature})` : ''}: ${p.reasons.join('; ')}. Unpack it (${unpackLabel}) to see the program.`, addr: p.decruncher, cat: 'packing' }] : [])),
  ], [A, R, kickProblems, packing, unpackLabel]);
  // the Spindle script tab is there when the analysis found Spindle's drivers
  const bottomTabs = BOTTOM_TABS.filter(([k]) => (!asmMode || k === 'messages' || k === 'tape') && (k !== 'spindle' || A.spindle.length > 0 || !!disk?.spindle) && (k !== 'bitfire' || !!disk?.bitfire) && (k !== 'booze' || !!A.booze?.steps.length || !!disk?.booze) && (k !== 'sparkle' || !!disk?.sparkle) && (k !== 'krill' || !!disk?.krill || !!A.krill?.steps.length) && (k !== 'covert' || !!disk?.covert) && (k !== 'dloc' || !!disk?.dloc) && (k !== 'iffl' || !!disk?.iffl) && (k !== 'pirateslayer' || !!disk?.pirateslayer) && (k !== 'paraprotect' || !!disk?.paraprotect) && (k !== 'diskspeed' || !!disk?.diskspeed) && (k !== 'tape' || !!tape));
  const shownBottom = bottomTabs.some(([k]) => k === bottom) ? bottom : asmMode ? 'messages' : 'log';
  /** a tab the mounted disk's own load script fills is marked, and comes in anew (it pulses) with each disk mounted:
   *  the disk's number is in its key */
  const diskScriptTab = (k: BottomTab) => !!disk && isDiskScriptTab(k) && !!disk[k];
  const diskNos = useRef({ n: 0, of: new WeakMap<MountedDisk, number>() });
  const diskNo = (d: MountedDisk) => { const m = diskNos.current; let n = m.of.get(d); if (n == null) m.of.set(d, n = ++m.n); return n; };
  // the row scrolls when the panel is narrow: the disk's script tab is brought into view
  useEffect(() => { if (disk) bottomRef.current?.querySelector<HTMLElement>('.tab.disk-script')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }, [disk]);
  /** the Relocated tab's count: the relocated blocks (placed or not) and the copy loops found */
  const relocCount = project.relocs.length + A.copies.length;
  const blk = cursor != null ? findBlock(A.blocks, cursor) : null;
  // cycle counting: the selection, else the code block at the cursor, along the path with the branches marked taken
  const cycleRange = !cycles ? null : sel && sel.multi ? { start: sel.start, end: sel.end } : blk && blk.type === 'code' ? { start: blk.start, end: blk.end } : null;
  const path = useMemo(() => (cycleRange ? cyclePath(A, cycleRange.start, cycleRange.end, taken) : null), [A, cycleRange?.start, cycleRange?.end, taken]); // eslint-disable-line react-hooks/exhaustive-deps
  const curLabel = cursor != null ? (() => { for (let p = cursor; p >= 0 && cursor - p < 4096; p--) { const l = R.labels.get(p); if (l) return p === cursor ? l.name : `${l.name}+${cursor - p}`; if (blk && p <= blk.start) break; } return null; })() : null;
  const narrow = window.matchMedia?.('(max-width: 900px)').matches;
  // the inspector opened from its strip folds in again at a click outside it, which still does what it does (menus
  // and dialogs over everything do not count, nor a block's header, which shows its block there); on a narrow window
  // the drawer's backdrop takes the click
  const inspOut = inspector === 'auto' && drawer === 'insp' && !narrow;
  useEffect(() => {
    if (!inspOut) return;
    const down = (e: PointerEvent) => { if (!(e.target as Element | null)?.closest?.('.insp-col, .insp-rail, .ctx, .modal-back, .listing .row.hdr')) setDrawer(null); };
    window.addEventListener('pointerdown', down, true);
    return () => window.removeEventListener('pointerdown', down, true);
  }, [inspOut]);
  const nav = (a: Addr) => navigate(a, { center: true, listing: true });
  /** a label picked in the Symbols view: the listing goes to it and the box of its references opens */
  const pickLabel = (a: Addr) => {
    nav(a);
    if (a >= 0 && a < A.owner.length && A.owner[a] >= 0) setXrefPick({ a, zp: false, line: lineOf[a] >= 0 ? lineOf[a] : 0, at: a, via: null });
  };
  /** where the links of the analysis overview go, once it has closed (14.1b) */
  const overviewLinks: OverviewLinks = {
    addr: nav,
    tab: (t, b) => {
      // a graphics block: Graphics opens at it, selected, and draws it as its type is
      if (t === 'gfx' && b) {
        navigate(b.start, { keepSel: true });
        setSel({ start: b.start, end: b.end, multi: true, anchor: b.start, anchorEnd: b.end });
        const kind = GFX_KIND[b.type];
        if (kind) setUi({ gfx: { ...useUi.getState().gfx, kind } });
      }
      setUi({ tab: t });
    },
    blocks: (kind, first) => {
      const open = useUi.getState().blkOpen;
      setUi({ activity: 'blocks', sidePanel: true, ...(open.includes(kind) ? {} : { blkOpen: [...open, kind] }) });
      nav(first);
    },
    section: (id, at) => { showSection(id); if (at != null) nav(at); },
    bottom: t => setUi({ bottom: t, panelOpen: true }),
    unpack: i => void unpackFile(i),
  };
  /** "Go to" with a range: select its loaded part as one anchor, like a block header */
  const selectRange = (s: Addr, e: Addr) => {
    let a = s, b = Math.min(e, 0x10000);
    while (a < b && A.owner[a] < 0) a++;
    while (b > a && A.owner[b - 1] < 0) b--;
    if (a >= b) { toast(`$${h4(s)}–$${h4(e - 1)} holds no loaded bytes`, 'warn'); return; }
    navigate(a, { center: true, listing: true, keepSel: true });
    setSel({ start: a, end: b, multi: true, anchor: a, anchorEnd: b });
  };
  /** Shift+click on a block in the Blocks view: the block selected in its type's own view (lib/blockfolders
   *  `blockView`), the cursor on its first byte. Graphics draws it as its type (multicolour as the block is, a bitmap as
   *  high as it is, the grid moved so that a cell starts at it) and Memory as the text or the bytes it is, each with its
   *  first byte in the top row, also when the tab is open already */
  const showBlock = (b: Block) => {
    const v = blockView(b), n = Date.now(), listing = v.tab === 'listing';
    navigate(b.start, { keepSel: true, center: listing, listing });
    setSel({ start: b.start, end: b.end, multi: true, anchor: b.start, anchorEnd: b.end });
    if (v.tab === 'gfx') {
      // (a screen's characters are drawn as they are set: its multicolour is the charset's)
      setUi({ tab: 'gfx', gfx: { ...useUi.getState().gfx, kind: v.kind, offset: b.start % gfxLayout(v.kind, 1).unit, ...(v.kind !== 'screens' ? { mc: blockMc(A, b) } : {}), ...(v.rows ? { bitmapTop: 0, bitmapRows: v.rows, bitmapLeft: 0, bitmapCols: 40 } : {}) } });
      setGfxGo({ addr: b.start, n });
    } else if (v.tab === 'mem') {
      setUi({ tab: 'mem', mon: { ...useUi.getState().mon, mode: v.mode, ...(v.lower != null ? { lower: v.lower } : {}) } });
      setMemGo({ addr: b.start, n });
    }
  };
  /** the title bar's project button: what can be done with the project, or with the work without one */
  const projectMenu = (e: ReactMouseEvent<HTMLElement>) => {
    if (menu?.owner === 'project') { setMenu(null); return; }
    const r = e.currentTarget.getBoundingClientRect();
    setMenu({ owner: 'project', x: r.left, y: r.bottom + 2, items: [
      ...(home
        ? [{ label: 'Show the project folder', run: () => void kr?.revealProject().catch((err: unknown) => toast(errorText(err), 'err')) }, { label: 'Save project', key: 'Ctrl+S', run: () => void saveProject() }]
        : [{ label: 'Create a project from this work…', key: 'Ctrl+S', run: () => setModal('project') }]),
      { label: 'Save a copy of the project file…', run: () => void saveProjectCopy() },
      { sep: true },
      { label: 'Open project…', run: () => void openProject() },
      { label: home ? 'Close the project (start screen)' : 'Start screen', run: () => void toStartScreen() },
    ] });
  };
  /** the title bar's File menu: Smart attach (any of them, by its extension), what to open (PRGs, a cartridge, a VICE
   *  snapshot, a D64 to mount), each shown in its section of the Explorer, and save the project (a project made of the
   *  work without one) */
  const fileMenu = (e: ReactMouseEvent<HTMLElement>) => {
    if (menu?.owner === 'file') { setMenu(null); return; }
    const r = e.currentTarget.getBoundingClientRect();
    setMenu({ owner: 'file', x: r.left, y: r.bottom + 2, items: asmMode ? [
      { label: 'Mount disk image (D64, G64)…', run: () => void mountDisk() },
      { label: 'Insert tape image (TAP, T64)…', run: () => void insertTape() },
      { sep: true },
      { label: 'Save project', key: 'Ctrl+S', run: () => void saveProject() },
    ] : [
      { label: 'Smart attach…', run: () => void smartAttach() },
      { sep: true },
      { label: 'Open PRG files…', key: 'Ctrl+O', run: () => void openPrgs(false, 'prg') },
      { label: 'Open a cartridge (.crt)…', run: () => void openPrgs(false, 'crt') },
      { label: 'Open a VICE snapshot (.vsf)…', run: () => void openPrgs(false, 'vsf') },
      { label: 'Mount disk image (D64, G64)…', run: () => void mountDisk() },
      { label: 'Insert tape image (TAP, T64)…', run: () => void insertTape() },
      { sep: true },
      { label: 'Continue in the Assembler…', run: () => void startContinue() },
      { sep: true },
      { label: home ? 'Save project' : 'Save: create a project from this work…', key: 'Ctrl+S', run: () => void saveProject() },
    ] });
  };
  // (the Library tab once it was opened: the Library view's button opens it, 10.6)
  const tabs: [typeof tab, 'list' | 'code' | 'doc' | 'image' | 'chip' | 'disk' | 'script' | 'git' | 'library', string][] =[['listing', 'list', 'Listing'], ['drive', 'disk', 'Drive code'], ['gfx', 'image', 'Graphics'], ['mem', 'chip', 'Memory'], ['scripts', 'script', 'Scripts'], ['git', 'git', 'Git'], ['source', 'code', mainSource(R)], ['spec', 'doc', 'SPEC.md'],
    ...(tab === 'library' || libTabSeen ? [['library', 'library', 'Library']] as [typeof tab, 'library', string][] : [])];
  // an Assembler project's: the Assembler in place of the listing, the drive code and the generated source
  if (asmMode) tabs.splice(0, tabs.length, ['asm', 'code', 'Assembler'], ...tabs.filter(([k]) => k !== 'listing' && k !== 'drive' && k !== 'source'));

  return (
    <AssemblerContext.Provider value={asm}>
    <div className={cx('app', drawer && `drawer-${drawer}`, !sidePanel && 'side-closed', inspector === 'auto' && 'insp-auto', scriptsFull && 'scripts-full')} style={{ '--side-w': sizes.side + 'px', '--insp-w': sizes.insp + 'px', '--bottom-h': sizes.bottom + 'px' } as React.CSSProperties}>
      <TitleBar asm={asmMode ? { tool: asmTool2, building: asmBuilding, onRun: () => asmAsk('run') } : null} asmTool={asmTool} projectName={project.name} home={home?.name ?? null} changed={unsavedChanges} onProject={projectMenu} undoLabel={undoLabel} canRedo={!!future.length} theme={theme} busy={!!buildBusy} snapshot={project.files.some(f => f.vsf)} cartridge={!!project.cart}
        verifyState={build && !stale ? (build.ok ? 'ok' : 'bad') : null}
        onFile={fileMenu} fileOpen={menu?.owner === 'file'} onUndo={undo} onRedo={redo} onPalette={() => setModal('palette')}
        onVerify={() => void runVerify()} onExport={() => void exportProject()} onBuild={() => void runBuild()} onTerminal={() => void openTerminal()}
        editor={editors?.current?.name ?? null} onEditor={() => void openEditor()}
        onTheme={() => setUi({ theme: theme === 'dark' ? 'light' : 'dark' })} onSettings={() => setModal('settings')}
        onOverview={() => setModal('overview')} canOverview={project.files.length > 0 || !!project.cart}
        onToggleSide={() => setDrawer(d => d === 'side' ? null : 'side')} onToggleInspector={() => setDrawer(d => d === 'insp' ? null : 'insp')} />

      <ActivityBar hide={asmMode ? ASM_HIDDEN_VIEWS : ASM_ONLY_VIEWS} activity={sidePanel || narrow ? activity : null} specOpen={tab === 'spec'} counts={{ bookmarks: asmMode ? Object.keys(asmBms).length : Object.keys(project.bookmarks).length, scripts: userScripts.length, pack: project.pack?.ranges?.length ?? 0, library: libListing?.items.length ?? 0, codelib: codeLibCount }} busy={{ pack: !!packRun, scripts: !!scriptRunning }} onActivity={(a: Activity) => {
          // the view shown: its button collapses the side panel; collapsed, any view's button brings it back. The
          // Library's button shows the Library tab too (10.6)
          if (a === 'library' && !(sidePanel && a === activity && !narrow)) { setLibTabSeen(true); setUi({ tab: 'library' }); }
          if (narrow) { setUi({ activity: a }); setDrawer('side'); } else if (sidePanel && a === activity) toggleSide(); else setUi({ activity: a, sidePanel: true });
        }} onSpec={() => setUi({ tab: 'spec' })} onPalette={() => setModal('palette')} />

      <aside className="sidebar"><ErrorBoundary>
        <Sidebar asm={asmMode ? { main: stored.asm?.main ?? null, onShow: a => { navigate(a, { listing: true }); setDrawer(null); } } : null} view={activity} A={A} R={R} project={project} colors={colors} cursor={cursor}
          library={{ desktop: !!kr, playerName: musicPlayerName, onShow: ref => showLibrary(ref), onPlay: i => void playLibrary(i), onMenu: libraryMenu, onReveal: k => revealLibrary(k ? { kind: k } : undefined) }} onNavigate={a => { nav(a); setDrawer(null); }} onLabel={a => { pickLabel(a); setDrawer(null); }}
          onAdd={() => void openPrgs(project.files.length > 0, 'add')} onDemo={() => loadDemo()}
          quicksave={{ info: qsInfo, follow: followQuicksave, onOpen: () => void openQuicksave(), onFollow: v => setUi({ followQuicksave: v }),
            kept: qsList, onOpenKept: q => void openKeptQuicksave(q), onRenameKept: (q, name) => void renameKeptQuicksave(q, name), onSaveKept: q => void saveKeptQuicksave(q),
            onFavouriteKept: (q, on) => void favouriteKeptQuicksave(q, on) }}
          onRemoveFile={i => update('Remove file', d => {
            d.files.splice(i, 1);
            // a patch goes with the file it was written over
            d.patches = d.patches.filter(p => d.files.some(f => p.start >= f.load && patchEnd(p) <= f.load + f.bytes.length));
          })} onSetStart={setStart}
          patches={{ list: project.patches, onGo: goPatch, onEdit: editPatch, onSwitch: switchOnePatch, onSave: p => void savePatchPrg(p), onRemove: removePatch }}
          junk={{ list: project.junk ?? NO_JUNK, onGo: goJunk, onInclude: includeJunk, onIncludeAll: includeAllJunk, onAdd: () => openJunkRange() }}
          viewOffsets={{ list: viewOffsets, shown: R.viewOffsets ?? NO_OFFSETS, onGo: goViewOffset, onEdit: o => startViewOffset({ start: o.start, end: o.end }), onRemove: removeOffset, onRemoveAll: removeAllOffsets }}
          scripts={{ list: userScripts, checks: scriptChecks, patches: project.patches, onNew: () => newUserScript(), onOpen: id => { openUserScript(id); setDrawer(null); }, onRun: id => void runUserScript(id), onRemove: removeUserScript, onAdd: addLibraryScript }}
          cart={crt} onOpenBank={(bank, leave) => { openBank(bank, leave); setDrawer(null); }}
          onOneSource={oneSource} fileAddr={fileAddr} bankView={{ A: As, base, cursor: vCursor }} onPlayMusic={a => void playMusic(a)} musicPlayer={toolchain.musicPlayer} onShowBlock={b => { showBlock(b); setDrawer(null); }}
          disk={disk} packing={packing} onEject={ejectDisk} onShowSpindle={() => setUi({ bottom: 'spindle', panelOpen: true })} onShowBitfire={() => setUi({ bottom: 'bitfire', panelOpen: true })} onShowBooze={() => setUi({ bottom: 'booze', panelOpen: true })} onShowSparkle={() => setUi({ bottom: 'sparkle', panelOpen: true })} onShowKrill={() => setUi({ bottom: 'krill', panelOpen: true })} onShowCovert={() => setUi({ bottom: 'covert', panelOpen: true })} onShowDloc={() => setUi({ bottom: 'dloc', panelOpen: true })} onShowIffl={() => setUi({ bottom: 'iffl', panelOpen: true })} onShowPirateSlayer={() => setUi({ bottom: 'pirateslayer', panelOpen: true })} onShowParaProtect={() => setUi({ bottom: 'paraprotect', panelOpen: true })} onShowDiskSpeed={() => setUi({ bottom: 'diskspeed', panelOpen: true })} onOpenFromDisk={(f, add) => { openFromDisk(f, add); setDrawer(null); }} diskOpen={diskOpen} tapeOpen={tapeOpen}
          tape={tape} onEjectTape={ejectTape} onShowTape={() => setUi({ bottom: 'tape', panelOpen: true })} onOpenFromTape={(f, add) => { openFromTape(f, add); setDrawer(null); }}
          onDiskFileMenu={(f, x, y) => fileScriptMenu(`dir/${f.track}/${f.sector}`, f.name, x, y)} onTapeFileMenu={(f, x, y) => fileScriptMenu(`tape/${tape?.img.files.indexOf(f)}`, f.name, x, y)}
          asmBm={asmMode ? { bookmarks: asmBms, selected: asmBmSel, onSelect: setAsmBmSel, onGo: id => asmAsk2('bmGo', { id }), onAdd: () => asmAsk2('bmAdd'), onEdit: editAsmBookmark, onDelete: deleteAsmBookmark,
            editing: asmBmEdit ? { ...asmBmEdit, onSave: saveAsmBookmark, onCancel: () => setAsmBmEdit(null), onPreview: (file, line, end) => asmAsk2('line', { at: file, line, end }) } : null } : null}
          codelib={asmMode ? { desktop: !!kr, lang: stored.asm?.lang ?? 'kickass', onInsert: insertCodeLib, onNew: (kind, into) => asmAsk2('codeLib', { libKind: kind, ...(into ? { libInto: into } : {}) }), onMenu: (x, y, items) => setMenu({ x, y, items }), onCopy: (t, what) => void copyText(t, what), toast,
            // the project's macro file (spec 10.8): kept in the project (undo takes a change back), a new one beside the main source
            project: { macros: stored.asm?.macros ?? null, defaultFile: `${asmMain?.includes('/') ? asmMain.slice(0, asmMain.lastIndexOf('/') + 1) : ''}macros.asm`,
              onChange: (label, m) => update(label, d => { if (d.asm) d.asm.macros = m; }), onOpen: file => asmAsk2('line', { at: file, line: 1 }), onDropImport: key => asmAsk2('dropImport', { at: key }) } } : undefined}
          bmSel={bmSel} onBmSelect={setBmSel} onBmGo={goBookmark} onBmAdd={() => startBookmark()} onBmEdit={openBookmarkEditor} onBmDelete={deleteBookmark}
          bmEditing={bmEdit != null ? {
            addr: bmEdit.at, end: bmEdit.end ?? null, cursorAt: lineAddr() ?? null, cursorEnd: curLine ? lineRange(curLine)?.end ?? null : null, selection: selArea(),
            onSave: saveBookmark, onCancel: () => { setBmEdit(null); listRef.current?.focus(); },
            onPreview: (a, end) => { navigate(a, { center: true, listing: true, noHistory: true, ...(end != null ? { end } : {}) }); showBmArea(a, end); }, onArea: showBmArea,
          } : null}
          pack={{ A, R, project, cursor, sel, prefs: packPrefs, exomizer: toolchain.exomizerPath, desktop: !!kr, busy: buildBusy, packing: packRun, result: packRes, current: packKey, asm: asmMode ? asmTool2 : null,
            onChange: setPack, onPack: () => void runPack(), onPickDir: () => void pickPackDir(), onRun: () => void runPacked(), onSave: () => void savePacked(), onSaveFile: f => void savePacked(f), onSettings: () => setModal('settings'),
            onLog: () => { if (asmMode) { setUi({ tab: 'asm' }); useAsmLink.getState().request('log'); } else setUi({ bottom: 'build', panelOpen: true }); }, onNavigate: a => { nav(a); setDrawer(null); } }} />
      </ErrorBoundary></aside>
      <button className="icon-btn side-collapse" onClick={toggleSide} aria-label="Collapse side panel" title="Collapse the side panel: the listing gets its room (Ctrl+Shift+B). The view's button in the activity bar brings it back"><Icon name="side-hide" size={16} /></button>
      <Splitter dir="v" className="side-split" onDrag={d => setUi({ sizes: { ...useUi.getState().sizes, side: Math.max(200, Math.min(480, useUi.getState().sizes.side + d)) } })} />

      <main className="main">
        {/* the row fits the editor's width (container queries in app.css): the tools lose their labels, then the tabs
            theirs, and on the narrowest the tools move into the ⋯ menu */}
        <div className="tabs main-tabs" role="tablist">
          {tabs.map(([k, ic, l]) => (
            <button key={k} role="tab" aria-selected={tab === k} className={cx('tab', `tab-${k}`, tab === k && 'on')} title={l} onClick={() => setUi({ tab: k })}><Icon name={ic} size={14} /><span className="tab-label">{l}</span></button>
          ))}
          <span className="grow" />
          {tab === 'listing' && <>
            <div className="tab-tools">
              <button className="icon-btn" onClick={goBack} title="Back (Esc)" aria-label="Back"><Icon name="left" size={14} /></button>
              <button className="icon-btn" onClick={goFwd} title="Forward (Alt+→)" aria-label="Forward"><Icon name="right" size={14} /></button>
              <button className="icon-btn tool-block" onClick={() => { jumpBlock(-1); listRef.current?.focus(); }} title="Previous block: the start of the cursor's block, then the one before (Ctrl+↑)" aria-label="Previous block"><Icon name="up" size={14} /></button>
              <button className="icon-btn tool-block" onClick={() => { jumpBlock(1); listRef.current?.focus(); }} title="Next block (Ctrl+↓)" aria-label="Next block"><Icon name="down" size={14} /></button>
              <button className="btn ghost small" onClick={() => setModal('goto')} title="Go to an address or label, or select a range (G)"><Icon name="target" size={14} /><span className="tool-label">Go to</span><kbd>G</kbd></button>
              <button className={cx('btn ghost small', findOpen && 'on')} aria-pressed={findOpen} onClick={openFind} title="Find text in the listing: labels, instructions, operands and comments (Ctrl+F)"><Icon name="search" size={14} /><span className="tool-label">Find</span><kbd>Ctrl+F</kbd></button>
              <button className={cx('btn ghost small', dataAsCode && 'on')} aria-pressed={dataAsCode} onClick={() => setUi({ dataAsCode: !dataAsCode })} title="Data as code: show every block that is not code disassembled, to find code that is marked as data. The export does not change."><Icon name="code" size={14} /><span className="tool-label">Data as code</span></button>
              <button className={cx('btn ghost small', offsets && 'on')} aria-pressed={offsets} onClick={() => setUi({ offsets: !offsets })} title="Offset: show where each byte is in the file it was opened from (+000050), left of the address, as SourceGen does: a PRG's after its load address, a cartridge's in the .crt, a snapshot's in the .vsf"><Icon name="rows" size={14} /><span className="tool-label">Offset</span></button>
              <button className={cx('btn ghost small', cycles && 'on')} aria-pressed={cycles} onClick={() => setUi({ cycles: !cycles })} title="Cycles: show the 6510 cycles of every instruction. Select a range, or click a block header, to count it; click a branch's cycles to mark it taken."><Icon name="clock" size={14} /><span className="tool-label">Cycles</span></button>
              <button className={cx('btn ghost small', textCols && 'on')} aria-pressed={textCols} onClick={() => { setUi({ textCols: !textCols }); listRef.current?.focus(); }} title="Text: each line's bytes as PETSCII and as screen codes, in two columns at its right, so text among code (or code among text) shows on the line. With Data as code on, every block is code with its bytes and text (V)"><Icon name="screen" size={14} /><span className="tool-label">Text</span><kbd>V</kbd></button>
              <div className="seg" role="group" aria-label="Left column" title="Left column of the listing: memory address or line number in the .asm file">
                {([['addr', 'Address', 'Adr'], ['line', 'Line', 'Line']] as const).map(([k, l, s]) => <button key={k} className={cx(gutter === k && 'on')} aria-pressed={gutter === k} aria-label={l} onClick={() => setUi({ gutter: k })}><span className="seg-long">{l}</span><span className="seg-short">{s}</span></button>)}
              </div>
            </div>
            <button className="icon-btn tab-more" aria-label="Listing tools" aria-haspopup="menu" aria-expanded={menu?.owner === 'tools'} title="Back, forward, the next and previous block, Go to, Find, Data as code, Cycles, the Text columns and the left column"
              onMouseDown={e => e.stopPropagation()}
              onClick={e => {
                if (menu?.owner === 'tools') { setMenu(null); return; }
                const r = e.currentTarget.getBoundingClientRect();
                setMenu({ owner: 'tools', x: r.right - 240, y: r.bottom + 2, items: [
                  { label: 'Back', key: 'Esc', run: goBack },
                  { label: 'Forward', key: 'Alt+→', run: goFwd },
                  { label: 'Previous block', key: 'Ctrl+↑', run: () => jumpBlock(-1) },
                  { label: 'Next block', key: 'Ctrl+↓', run: () => jumpBlock(1) },
                  { label: 'Go to…', key: 'G', run: () => setModal('goto') },
                  { label: 'Find…', key: 'Ctrl+F', run: openFind },
                  { sep: true },
                  { label: 'Data as code', checked: dataAsCode, run: () => setUi({ dataAsCode: !dataAsCode }) },
                  { label: 'Cycles', checked: cycles, run: () => setUi({ cycles: !cycles }) },
                  { label: 'Offset in the file', checked: offsets, run: () => setUi({ offsets: !offsets }) },
                  { label: 'Text columns (PETSCII and screen codes)', key: 'V', checked: textCols, run: () => setUi({ textCols: !textCols }) },
                  { sep: true },
                  { label: 'Left column: address', checked: gutter === 'addr', run: () => setUi({ gutter: 'addr' }) },
                  { label: 'Left column: line in the .asm', checked: gutter === 'line', run: () => setUi({ gutter: 'line' }) },
                ] });
              }}><Icon name="more" size={18} /></button>
          </>}
        </div>
        <div className="editor">
          <ErrorBoundary>
            {asmMode && home && stored.asm && <AssemblerTab key={home.dir} dir={home.dir} name={home.name} info={stored.asm} active={tab === 'asm'} toast={toast} onMenu={(x, y, items) => setMenu({ x, y, items })} onRelease={() => setAsmRelease(true)}
              toolArgs={{ kick: toolchain.kickArgs, tass: toolchain.tassArgs }} onSettings={asmSettings}
              // (an item clicked before the analysis has the program the check drew it from: nothing to go to yet)
              onPick={(c, extend) => { if (A.owner[c.a] >= 0) pickCell(c, extend && cursor != null); }}
              onBookmark={openAsmBookmark} onBookmarkSelect={id => { setAsmBmSel(id); showBookmarks(); }} onBookmarkLines={moveAsmBookmarks} onBookmarksRenamed={renameAsmBookmarks}
              onInfo={(label, c) => update(label, d => { if (d.asm) Object.assign(d.asm, c); })} />}
            {tab === 'listing' && !project.files.length && <div className="empty-project">
              <Icon name={home ? 'folder' : 'doc'} size={30} />
              <h2>{home ? `${home.name} has no files yet` : 'No files yet'}</h2>
              <p>Open the program to re-assemble: a PRG, a VICE snapshot (.vsf) or a cartridge (.crt), or mount a D64 or G64 or insert a TAP or T64 and open its files.</p>
              <div className="empty-actions">
                <button className="btn primary" onClick={() => void openPrgs(false)}><Icon name="upload" size={14} />Open PRG…</button>
                <button className="btn" onClick={() => void mountDisk()}><Icon name="disk" size={14} />Mount D64/G64…</button>
                <button className="btn" onClick={() => void insertTape()}><Icon name="tape" size={14} />Insert TAP/T64…</button>
                <button className="btn" onClick={() => void openQuicksave()}>VICE quicksave <kbd>F9</kbd></button>
              </div>
              <p className="muted small">Or drop the files on the window.</p>
            </div>}
            {tab === 'listing' && project.files.length > 0 && <>
              {welcome && <div className="welcome">
                <div><b>{project.cart && A.spaces ? `${project.cart.name} (${A.spaces.length} banks)` : project.files.map(f => f.name).join(', ')}</b> is analysed: {A.blocks.length} blocks, {A.labels.size} labels, {A.music.length ? 'SID music, ' : ''}{A.gfx.length ? `${A.gfx.length} graphics block${A.gfx.length > 1 ? 's' : ''}, ` : ''}{A.stats.illegal} undocumented opcodes.</div>
                <div className="welcome-keys"><kbd>N</kbd> rename <kbd>;</kbd> comment <kbd>/</kbd><kbd>*</kbd> comment line/block above <kbd>Shift+Enter</kbd> empty line <kbd>B</kbd> bookmark<kbd>C</kbd><kbd>D</kbd><kbd>W</kbd><kbd>T</kbd> mark as code/bytes/words/text <kbd>G</kbd> go to or select a range <kbd>Ctrl+F</kbd> find <kbd>Ctrl+↓</kbd><kbd>Ctrl+↑</kbd> next/previous block <kbd>Ctrl</kbd> held over a line shows its block as bytes or as code <kbd>V</kbd> bytes as text · drag or <kbd>Shift</kbd>+click to select <kbd>X</kbd> xrefs <kbd>F</kbd> fold <kbd>F7</kbd> verify <kbd>F5</kbd> build &amp; run · right-click for more</div>
                <button className="icon-btn" aria-label="Dismiss" onClick={() => setUi({ welcome: false })}><Icon name="x" size={14} /></button>
              </div>}
              {packing.map((p, i) => p && !packHidden.has(project.files[i]?.id ?? String(i)) && <div key={`pack-${i}`} className="welcome preview-bar pack-bar" role="status">
                <div><b>{project.files[i]?.name} {p.verdict === 'packed' ? 'is packed' : 'may be packed'}{p.signature ? ` (${p.signature})` : ''}.</b> {p.reasons.join('; ')}. The listing shows the decruncher{p.decruncher != null ? ` at $${h4(p.decruncher)}` : ''} and the packed data, not the program.</div>
                <button className="btn small primary" disabled={!!buildBusy} onClick={() => void unpackFile(i)}>{unpackLabel}</button>
                <button className="icon-btn" aria-label="Dismiss the packed notice" onClick={() => setPackHidden(s => new Set([...s, project.files[i]?.id ?? String(i)]))}><Icon name="x" size={14} /></button>
              </div>)}
              {animData.map((d, i) => d && !packHidden.has(project.files[i]?.id ?? String(i)) && <div key={`anim-${i}`} className="welcome preview-bar anim-data-bar" role="status">
                <div><b>{project.files[i]?.name} is animation data, not packed:</b> {animDataText(d)}. There is nothing to unpack.</div>
                <button className="icon-btn" aria-label="Dismiss the animation data notice" onClick={() => setPackHidden(s => new Set([...s, project.files[i]?.id ?? String(i)]))}><Icon name="x" size={14} /></button>
              </div>)}
              {unpacked && <div className={cx('welcome preview-bar unpack-bar', !unpacked.ok && 'bad')} role="status">
                <div><b>{unpacked.title}</b><details><summary>{unpacked.label}</summary><pre className="unpack-log">{unpacked.output}</pre></details></div>
                <button className="icon-btn" aria-label="Dismiss the unpacker result" onClick={() => setUnpacked(null)}><Icon name="x" size={14} /></button>
              </div>}
              {dataAsCode && <div className="welcome preview-bar">
                <div><b>Data as code:</b> blocks that are not code are shown disassembled from their start. Select the instructions that are real code and press <kbd>C</kbd> (or right-click → Mark selection as → Code). The export is unchanged.</div>
                <button className="btn small" onClick={() => setUi({ dataAsCode: false })}>Show as classified</button>
              </div>}
              <div className="listing-wrap">
              <Listing lines={view.lines} lineNo={view.lineNo} folded={folded} hidden={view.hidden} onToggleFold={toggleFold} excluded={excludedSet} A={A} lineOf={lineOf} cursor={cursor} picked={pickedLine} sel={sel} onClickLine={onClickLine} onDragTo={l => { if (extendTo(l)) setCursor(l.a); }} onDragCells={dragCells} onMove={moveInto} onToken={onToken} onContext={onContext}
                onPeekPick={(a, extend) => {
                  // into another block: a folded one is unfolded, and the jump goes in the history (Esc goes back)
                  const b = findBlock(A.blocks, a), far = !extend && cursor != null && b !== findBlock(A.blocks, cursor);
                  unfold([...(b && a !== b.start ? [b.start] : []), ...relocsAround(a)]);
                  pickCell({ a, n: 1 }, extend, far); listRef.current?.focus();
                }}
                scrollReq={scrollReq} editing={editing} onCommitEdit={commitEdit} onCancelEdit={() => { setEditing(null); listRef.current?.focus(); }}
                labelError={labelError} setLabelError={setLabelError} listRef={listRef} gutter={gutter} offsetAt={offsets ? offsetAt : null} breakpoints={breakpointSet} watches={project.watches} bookmarks={project.bookmarks} onBookmark={a => showBookmarks(a)}
                patches={patchesOn(project.patches)} keepView={`${dataAsCode}/${gfxPictures}`} holdView={swaps} onSprites={setSprites} onWidth={setListW} cycles={cycles ? { path, taken, onToggle: toggleTaken } : null} changed={changed} find={listingFind} names={R} scriptMarks={scriptMarks} onScriptMark={openUserScript}
                xrefs={xrefBox} onXref={goXref} onXrefClose={() => { closeXref(); listRef.current?.focus(); }} onXrefPanel={() => { closeXref(); setUi({ bottom: 'xrefs', panelOpen: true }); listRef.current?.focus(); }}
                startAt={viewAt.current} onView={seeAt} />
              {findOpen && <FindBar q={findQ} opts={findOpts} onQuery={setFindQ} onOpts={setFindOpts} count={findHits.length} at={findAt >= 0 ? findAt + 1 : null} onStep={stepFind} onClose={closeFind} focusKey={findFocus} />}
              </div>
            </>}
            <Suspense fallback={<div className="empty">Loading…</div>}>
              {tab === 'drive' && <DriveView A={A} S={S} name={project.files.length === 1 ? project.files[0].name : project.name} theme={theme} onCopy={t => void copyText(t)} onSave={D => void saveDrive(D)}
                onShow={a => navigate(a, { center: true, listing: true })} findReq={srcFind} />}
              {tab === 'source' && <SourceView R={R} A={A} S={S} path={srcPath && (R.files[srcPath] != null || extraFiles[srcPath] != null) ? srcPath : R.main ?? `${R.fileNames[0]}.asm`} setPath={setSrcPath} cursor={cursor} onNavigate={(a, o) => navigate(a, o)} theme={theme} extraFiles={extraFiles} problems={kickProblems} onCopy={t => void copyText(t)} onExport={() => void exportProject()}
                scripts={project.scripts ?? {}} onEditScript={setScript} template={project.buildTemplate ?? null} templates={tplLibrary} cart={!!project.cart}
                onUseTemplate={key => { const t = key ? templateOf(key) : null; if (key && !t) return; applyTemplate(t); }} onTemplates={() => openTemplates()} changed={changed} findReq={srcFind} scriptMarks={scriptMarks} onScriptMark={openUserScript} onLinkMenu={(a, x, y) => { const m = linkMenu(a); setMenu({ x, y, items: 'children' in m ? [{ header: m.label }, ...m.children] : [m] }); }}
                onPadMenu={(s, e, x, y) => {
                  // the bytes as they are, and after them the block the line is in, written as its type is
                  const b = findBlock(A.blocks, s), bm = b ? blockCopyMenu(b.start) : null, m = padCopyMenu(s, e);
                  setMenu({ x, y, items: [...('children' in m ? [{ header: m.label }, ...m.children] : [m]), ...(bm ? [{ sep: true }, bm] satisfies MenuItem[] : [])] });
                }} />}
              {tab === 'spec' && <SpecView />}
              {tab === 'git' && <GitView home={home} saveNow={saveNow} onCreateProject={() => setModal('project')} onTerminal={() => void openTerminal()} toast={toast} />}
              {tab === 'library' && <LibraryTab desktop={!!kr} player={toolchain.musicPlayer} onPlay={(i, o) => void playLibrary(i, o)} onReveal={ref => revealLibrary(ref)} onMenu={libraryMenu} toast={toast} />}
              {tab === 'scripts' && <ScriptsView scripts={userScripts} lang={codeLang} env={scriptsEnv} envFor={scriptEnvFor} patches={project.patches} theme={theme} linkOf={scriptLinkOf} kinds={scriptKinds} onNew={() => newUserScript()} onNewJs={() => newUserScript([], [], 'js')} onAdd={addLibraryScript} onAddTemplate={addTemplateScript}
                onEdit={editUserScript} onRemove={removeUserScript} onRun={runUserScript} onWrite={(id, text) => runUserScript(id, text, true)} onSafe={setScriptSafe} onFinish={finishScriptRun} onTakeOut={takeOutScript} onSwitchPatch={switchOnePatch}
                onShow={(s, e) => { if (asmMode) { navigate(s, { listing: true }); return; } setUi({ tab: 'listing' }); selectRange(s, e); }} onCopy={(t, what) => void copyText(t, what ? `Copied ${what}` : undefined)}
                onSave={(n, b, prg, load) => void saveScriptBytes(n, b, prg, load)} onSaveText={(n, t) => void saveScriptText(n, t)} toast={toast} onMenu={(x, y, items) => setMenu({ x, y, items })}
                blocks={scriptBlocks} cursorBlock={cursor != null ? findBlock(A.blocks, cursor)?.start ?? null : null} onCopyBlock={(s, id, pad) => copyBlockIntoPad(s, id, pad)}
                loops={cryptLoops} onAddLoop={addCryptScript} fits={scriptFitsHere} userNames={userNames} onRevealLibrary={kr ? () => void kr.scriptsReveal().catch(e => toast(errorText(e), 'err')) : undefined}
                files={scriptFileChoices} onRunOnFiles={id => openRunOnFiles(id)} onRunValues={id => setValuesRun(id)} onToProject={padToProject} />}
              {/* every bank at once: bank addresses as they are (a view of one bank: its plain addresses, made bank addresses);
                  another way of showing opens the tab anew */}
              {tab === 'gfx' && (g => <MemoryGfx source={asmMode} live={liveNote} onDraw={asmMode && !asmLive ? changes => useAsmLink.getState().request('write', { changes }) : undefined} key={allGfx ? 'all' : 'one'} A={liveA ?? (allGfx ? A : As)} R={allGfx ? R : Rs} cursor={allGfx ? cursor : vCursor} sel={allGfx ? sel : vSel} bank={bankPick} start={startIn(allGfx)} goTo={goIn(allGfx)} onView={(t, e) => { seeIn(allGfx)(t, e); setGfxGo(null); }}
                parts={allGfx ? bankParts : null} fmt={allGfx ? bankText : undefined} resolve={allGfx ? resolveAddr : undefined}
                onSelect={(s, e) => { setSel({ start: g(s), end: g(e), multi: true, anchor: g(s), anchorEnd: g(e) }); setCursor(g(s)); }} onClear={() => setSel(null)}
                onMark={(id, r, mc, ps) => (ps && ps.length > 1 ? markPieces(id, ps.map(p => ({ start: g(p.start), end: g(p.end) })), mc) : mark(id, r && { start: g(r.start), end: g(r.end) }, { mc }))} onUnmark={r => unmark({ start: g(r.start), end: g(r.end) })}
                onMulticolor={(r, view, mc) => setGfxMc({ start: g(r.start), end: g(r.end) }, view, mc)}
                onShow={a => navigate(g(a), { center: true, listing: true })} onSave={(name, bytes) => void saveGraphics(name, bytes)}
                onLibrary={(r, kind, mc, cols, bitmap) => startLibraryAdd(null, { start: g(r.start), end: g(r.end), kind, mc, colors: { ...cols }, ...(bitmap ? { bitmap } : {}) })} />)(allGfx ? (a: Addr) => a : inBank)}
              {tab === 'mem' && (g => <MemoryDump source={asmMode} live={liveNote} key={allBanks ? 'all' : 'one'} A={liveA ?? (allBanks ? A : As)} R={allBanks ? R : Rs} cursor={allBanks ? cursor : vCursor} sel={allBanks ? sel : vSel} bank={bankPick} start={startIn(allBanks)} goTo={memGoIn(allBanks)} onView={(t, e) => { seeIn(allBanks)(t, e); setMemGo(null); }}
                spaces={allBanks ? A.spaces : null} fmt={allBanks ? bankText : undefined} resolve={allBanks ? resolveAddr : undefined}
                onCursor={a => { const b = g(a); navigate(b, { noHistory: true }); setSel({ start: b, end: b + 1, multi: false, anchor: b, anchorEnd: b + 1 }); }}
                onSelect={(s, e) => { setSel({ start: g(s), end: g(e), multi: true, anchor: g(s), anchorEnd: g(e) }); setCursor(g(s)); }} onClear={() => setSel(null)}
                onMark={(id, r) => mark(id, r && { start: g(r.start), end: g(r.end) }, { name: true })} onShow={a => navigate(g(a), { center: true, listing: true })} onCopy={t => void copyText(t)} />)(allBanks ? (a: Addr) => a : inBank)}
            </Suspense>
          </ErrorBoundary>
        </div>
        {/* the panel gives way to a view that needs its room (the Scripts tab), so a drag goes on from the height it has,
            not the one kept: dragged up as far as it goes, it is kept as high as it was shown */}
        {tab !== 'spec' && panelOpen && <Splitter dir="h" onDrag={d => { const s = useUi.getState().sizes; setUi({ sizes: { ...s, bottom: Math.max(120, Math.min(520, Math.min(s.bottom, bottomRef.current?.offsetHeight ?? s.bottom) - d)) } }); }} />}
        {tab !== 'spec' && <section ref={bottomRef} className={cx('bottom', !panelOpen && 'collapsed')} aria-label="Panels">
          <div className="tabs small" role="tablist">
            {bottomTabs.map(([k, l]) => { const n = k === 'log' ? A.log.length : k === 'messages' ? messages.length : k === 'problems' ? problems.length : k === 'irqs' ? A.raster.length : k === 'relocs' ? relocCount : k === 'spindle' ? A.spindle.length + (disk?.spindle?.jobs.length ?? 0) : k === 'bitfire' ? (disk?.bitfire?.files.length ?? 0) : k === 'booze' ? (A.booze?.steps.filter(s => s.kind === 'load').length ?? 0) + (disk?.booze?.files.length ?? 0) : k === 'sparkle' ? (disk?.sparkle?.bundles.length ?? 0) : k === 'krill' ? (A.krill?.steps.length ?? 0) + (disk?.krill?.files.length ?? 0) : k === 'covert' ? (disk?.covert?.files.length ?? 0) : k === 'dloc' ? (disk?.dloc?.files.length ?? 0) : k === 'iffl' ? (disk?.iffl?.files.reduce((a, f) => a + f.parts.length, 0) ?? 0) : k === 'tape' ? (tape?.img.files.length ?? 0) : null; return (
              <button key={disk && diskScriptTab(k) ? `${k}:${diskNo(disk)}` : k} role="tab" aria-selected={shownBottom === k} className={cx('tab', shownBottom === k && 'on', diskScriptTab(k) && 'disk-script')} title={disk && diskScriptTab(k) ? `Read from the mounted disk ${disk.name}` : undefined} onClick={() => setUi({ bottom: k, panelOpen: true })}>{l}{n != null && <span className={cx('count', k === 'problems' && problems.some(p => p.lvl === 'err') && 'bad')}>{n}</span>}</button>); })}
            <span className="grow" />
            <button className="icon-btn panel-toggle" onClick={() => setUi({ panelOpen: !panelOpen })} aria-label={panelOpen ? 'Collapse panel' : 'Expand panel'} title={panelOpen ? 'Collapse panel' : 'Expand panel'}><Icon name="down" size={14} className={panelOpen ? '' : 'flip'} /></button>
          </div>
          <div className="bottom-body"><ErrorBoundary>
            {shownBottom === 'log' && <LogList items={A.log} onNavigate={nav} empty="No analysis messages." />}
            {shownBottom === 'messages' && <MessagesPanel items={messages} onClear={() => setMessages([])} />}
            {shownBottom === 'problems' && <ProblemsPanel items={problems} onNavigate={nav} deep={A.deep} on={!!project.settings.deepAnalysis} busy={busy} deepBusy={deepBusy} onDeep={on => update(on ? 'Deep analysis on' : 'Deep analysis off', d => { d.settings.deepAnalysis = on; })} />}
            {shownBottom === 'xrefs' && <XrefPanel A={A} R={R} cursor={cursor} onNavigate={nav} S={S} />}
            {shownBottom === 'irqs' && <RasterPanel A={A} R={R} onNavigate={nav} />}
            {shownBottom === 'relocs' && <RelocPanel A={A} R={R} relocs={project.relocs} onNavigate={nav} onRelocate={(r, copyAt) => startRelocate(r, copyAt)} onUnrelocate={unrelocate} />}
            {shownBottom === 'spindle' && <SpindlePanel A={A} R={R} disk={disk} open={loaderOpen} onNavigate={nav} onCopy={(t, what) => void copyText(t, what)} onOpenChunk={openChunk} onExportFiles={exportSpindleFiles} onSaveFiles={() => void saveSpindleFiles()} />}
            {shownBottom === 'bitfire' && disk?.bitfire && <BitfirePanel disk={disk} open={loaderOpen} onCopy={(t, what) => void copyText(t, what)} onOpenFile={openBitfireFile} onExportFiles={exportBitfireFiles} onSaveFiles={() => void saveBitfireFiles()} />}
            {shownBottom === 'booze' && <BoozePanel A={A} disk={disk} open={loaderOpen} onNavigate={nav} onCopy={(t, what) => void copyText(t, what)} onOpenFile={openBoozeFile} onExportFiles={exportBoozeFiles} onSaveFiles={() => void saveBoozeFiles()} />}
            {shownBottom === 'sparkle' && disk?.sparkle && <SparklePanel disk={disk} open={loaderOpen} onCopy={(t, what) => void copyText(t, what)} onOpenChunk={openSparkleChunk} onExportFiles={exportSparkleFiles} onSaveFiles={() => void saveSparkleFiles()} />}
            {shownBottom === 'iffl' && disk?.iffl && <IfflPanel disk={disk} open={loaderOpen} onOpenPart={openIfflPart} onExportParts={exportIfflParts} onSaveParts={() => void saveIfflParts()} />}
            {shownBottom === 'krill' && <KrillPanel A={A} disk={disk} open={loaderOpen} onNavigate={nav} onCopy={(t, what) => void copyText(t, what)} onOpenFile={openKrillFile} onExportFiles={exportKrillFiles} onSaveFiles={() => void saveKrillFiles()} />}
            {shownBottom === 'covert' && disk?.covert && <CovertPanel disk={disk} open={loaderOpen} onCopy={(t, what) => void copyText(t, what)} onOpenFile={openCovertFile} onExportFiles={exportCovertFiles} onSaveFiles={() => void saveCovertFiles()} />}
            {shownBottom === 'dloc' && disk?.dloc && <DlocPanel disk={disk} open={loaderOpen} onCopy={(t, what) => void copyText(t, what)} onOpenFile={openDlocFile} onExportFiles={exportDlocFiles} onSaveFiles={() => void saveDlocFiles()} />}
            {shownBottom === 'pirateslayer' && disk?.pirateslayer &&<PirateSlayerPanel disk={disk} open={loaderOpen} onCopy={(t, what) => void copyText(t, what)} onOpenFile={openPirateSlayerFile} onExportFiles={exportPirateSlayerFiles} onSaveFiles={() => void savePirateSlayerFiles()} />}
            {shownBottom === 'paraprotect' && disk?.paraprotect && <ParaProtectPanel disk={disk} open={loaderOpen} onCopy={(t, what) => void copyText(t, what)} onOpenFile={openParaProtectFile} onExportFiles={exportParaProtectFiles} onSaveFiles={() => void saveParaProtectFiles()} />}
            {shownBottom === 'diskspeed' && disk?.diskspeed && <DiskSpeedPanel disk={disk} open={loaderOpen} onCopy={(t, what) => void copyText(t, what)} onOpenFile={openDiskSpeedFile} onExportFiles={exportDiskSpeedFiles} onSaveFiles={() => void saveDiskSpeedFiles()} />}
            {shownBottom === 'tape' && tape && <TapePanel tape={tape} open={tapeOpen} onCopy={(t, what) => void copyText(t, what)} onOpenFile={openFromTape} onExportFiles={exportTapeFiles} onSaveFiles={() => void saveTapeFiles()} />}
            {shownBottom === 'stats' && <StatsPanel A={A} />}
            {shownBottom === 'build' && <BuildPanel build={build} S={S} names={R.fileNames} cart={cartBuild({ ...project, settings: S })} stale={stale} busy={buildBusy} onVerify={() => void runVerify()} onRun={() => void runBuild()} onCopy={t => void copyText(t)} />}
          </ErrorBoundary></div>
        </section>}
      </main>

      <Splitter dir="v" className="insp-split" onDrag={d => setUi({ sizes: { ...useUi.getState().sizes, insp: Math.max(260, Math.min(520, useUi.getState().sizes.insp - d)) } })} />
      <aside className="insp-col">
        <div className="insp-head"><span>Inspector</span><span className="grow" />
          {inspector === 'auto'
            ? <button className="icon-btn insp-mode" onClick={() => setInspector('open')} aria-label="Keep the inspector open" title="Keep the inspector open beside the editor (Settings → General)"><Icon name="pin" size={15} /></button>
            : <button className="icon-btn insp-mode" onClick={() => setInspector('auto')} aria-label="Fold in the inspector" title="Fold the inspector into a strip at the right edge: the listing gets its room, and a click on the strip opens it when you need it (Settings → General)"><Icon name="insp-hide" size={16} /></button>}
        </div>
        <ErrorBoundary>
        <Inspector source={asmMode ? { lineOf: a => { const c = useAsmLink.getState().check, l = c ? asmLineAt(c, a) : null; return l ? `${l.file} line ${l.line}` : null; }, onShow: a => navigate(a, { listing: true }), onDraw: changes => useAsmLink.getState().request('write', { changes }) } : null} A={A} R={R} project={project} cursor={cursor} sel={sel} colors={colors} heatMode={heatMode} setHeatMode={setHeatMode}
          bank={{ A: As, base, cursor: vCursor, sel: vSel, number: bankAt(cursor) }}
          onNavigate={nav} onSelect={(s, e) => { setSel({ start: s, end: e, multi: true, anchor: s }); setCursor(s); }}
          onMark={mark} onMerge={mergeBlock} onMergeRange={() => setModal('merge')} onBlockSize={openBlockSize} onRelocate={r => startRelocate(r)} onUnrelocate={unrelocate} onViewOffset={r => startViewOffset(r)} onRemoveOffset={removeOffset} onToggleExcluded={toggleExcluded} onToggleBinary={toggleBinary} onJunk={openJunkRange} onFormat={setFormat} onSprites={setSprites} onSpriteColors={setSpriteColors} onBankZone={setBankZone} onRename={(a, n) => rename(a, n)} onBlockComment={setBlockComment} onPlayMusic={a => void playMusic(a)} musicPlayer={toolchain.musicPlayer} onAddToLibrary={a => startLibraryAdd(a)}
          zpVar={pickedDef?.zp && pickedDef.at === cursor ? pickedDef.addr : null} onZpNote={(a, t) => setNote(a, t, !!project.notes[a]?.block)} onZpPair={pairZp} onZpComment={(a, t) => { if ((project.comments[a] || '') !== t) setComment(a, t); }} onClearOverride={b => clearOverride({ start: b.start, end: b.end })}
          cycles={cycles && path ? { path, onToggle: toggleTaken } : null} />
      </ErrorBoundary></aside>
      {inspector === 'auto' && <button className={cx('insp-rail', drawer === 'insp' && 'on')} onClick={() => (drawer === 'insp' ? closeInspector() : setDrawer('insp'))} aria-label="Inspector" aria-expanded={drawer === 'insp'}
        title={drawer === 'insp' ? 'Fold in the inspector (a click outside it or Esc does too)' : 'Open the inspector: the memory map, the block at the cursor and its preview'}><Icon name="panel" size={16} /><span>Inspector</span></button>}

      <StatusBar asm={asmMode ? stored.asm?.lang ?? null : null} A={A} fileCount={project.files.length} cursor={cursor} shown={cursor != null ? shownAddress(R.viewOffsets, cursor) : null} bank={bankAt(cursor)} curLabel={curLabel} blk={blk} sel={sel} renderMs={renderMs} busy={busy} deepBusy={deepBusy} cycles={path && path.instructions ? path.total : null}
        verify={build && !stale ? { ok: build.ok, kick: build.kick ? build.kick.ok : null } : null}
        messages={{ count: messages.length, errors: messages.filter(m => m.kind === 'err').length }}
        actions={{ onFiles: () => showSection('files'), onGoto: () => setModal('goto'), onLog: () => setUi({ bottom: 'log', panelOpen: true }),
          onMessages: () => setUi({ bottom: 'messages', panelOpen: true }), onVerify: () => void runVerify(), onSettings: () => setModal('settings') }} />

      {drawer && <div className="drawer-back" onClick={() => setDrawer(null)} />}
      {dropping && (asmMode
        ? <div className="drop asm-drop"><div><Icon name="upload" size={28} /><p>Drop files to copy them into the project's folder: on a folder in the file list into it, else by kind (a SID in music, sprites in sprites, a picture in bitmaps, a source beside the main file, the rest in data)</p><small>A .d64, .g64, .tap or .t64 goes in the drive or the datasette, as Run takes it</small></div></div>
        : <div className="drop"><div><Icon name="upload" size={28} /><p>Drop .prg files, VICE snapshots (.vsf) or a cartridge (.crt) to open them, a .d64 or .g64 to mount it or a .tap or .t64 to put it in the datasette</p><small>Hold Shift to add them to the current project</small></div></div>)}
      {menu && <ContextMenu menu={menu} onClose={() => setMenu(null)} />}
      {packSource && <div className="pack-over" role="dialog" aria-label="Pack a file">
        <QuickPack source={packSource} onBack={() => setPackSource(null)} back={{ label: home ? `Back to ${home.name}` : 'Back to the work', title: 'Back to the work, as it was' }} />
      </div>}
      {modal === 'overview' && <AnalysisOverview A={A} project={project} labels={R.labels} snap={snapPc} packing={packing} animData={animData} looking={lookingFor} problems={problems} source={mainSource(R)} unpackLabel={unpackLabel} busy={!!buildBusy}
        scripts={bottomTabs.filter(([k]) => SCRIPT_TABS.includes(k))} auto={ui.overview} onAuto={v => setUi({ overview: v })} onPlayMusic={a => void playMusic(a)} musicPlayer={toolchain.musicPlayer}
        known={suggested} onNameKnown={() => nameKnown()} crypt={cryptLoops} onCryptScript={addCryptScript} fitting={scriptLibrary.filter(l => scriptFitsHere.has(l.name))} onAddFitting={l => addLibraryScript(l)} links={overviewLinks} onClose={() => setModal(null)} />}
      {modal === 'settings' && <SettingsModal settings={S} prefs={{ startScreen: ui.startScreen, inspector, gfxPictures, autoUnpack: ui.autoUnpack, overview: ui.overview, diskLook: ui.diskLook, autoMerge: ui.autoMerge, learnRoutines: ui.learnRoutines }} desktop={!!kr} editors={editors?.found ?? []}
        asm={asmMode && home && stored.asm ? { lang: stored.asm.lang, main: stored.asm.main ?? null, args: stored.asm.args ?? '', machine: useAssembler.getState().machines[home.dir] ?? 'memory' } : null}
        asmInfo={{ sources: useAsmLink.getState().sources, found: useAsmLink.getState().found }} page={settingsPage}
        onSave={(s, prefs, asm) => void saveSettings(s, prefs, asm)} onClose={() => { setModal(null); setSettingsPage(undefined); }} />}
      {modal === 'goto' && <GotoModal R={R} resolve={(a, bank) => { const r = resolveAddr(a, bank); return shownTarget(R.viewOffsets, r)?.at ?? r; }} onGo={a => { setModal(null); nav(a); }} onSelect={(s, e) => { setModal(null); selectRange(s, e); }} onClose={() => setModal(null)} />}
      {modal === 'palette' && <CommandPalette commands={commands} onClose={() => setModal(null)} />}
      {modal === 'library' && libDraft && <LibraryAddModal draft={libDraft} findSame={libSame} onAdd={a => void addToLibrary(a)}
        onShow={i => { setModal(null); setLibDraft(null); showLibrary({ kind: i.kind, file: i.file }); }} onClose={() => { setModal(null); setLibDraft(null); }} />}
      {modal === 'junk' && <JunkRangeModal A={A} R={R} junk={project.junk} init={junkInit} onJunk={r => { setModal(null); markJunk(r); }} onClose={() => setModal(null)} />}
      {modal === 'merge' && <MergeRangeModal A={A} R={R} cursor={cursor} sel={sel} onMerge={mergeRangeInto} onClose={() => setModal(null)} />}
      {modal === 'size' && sizeAt != null && <BlockSizeModal A={A} R={R} at={sizeAt} onResize={resizeInto} onClose={() => { setModal(null); setSizeAt(null); }} />}
      {modal === 'reloc' && relocDraft && <RelocateModal A={A} R={R} project={project} draft={relocDraft} onRelocate={relocate} onMove={runRelocAt} onRemove={unrelocate} onClose={closeReloc} />}
      {modal === 'voff' && voffDraft && <ViewOffsetModal A={A} R={R} offsets={viewOffsets} draft={voffDraft} onApply={applyViewOffset} onRemove={removeOffset} onClose={closeVoff} />}
      {modal === 'templates' && <BuildTemplatesModal library={tplLibrary} projectName={project.name} assembler={asm} cart={!!project.cart} inUse={project.buildTemplate ?? null}
        original={originalTemplate(S, !!project.cart)} start={tplStart}
        fill={t => renderTemplate(templateText(t, S, !!project.cart), S, { names: R.fileNames, cart: cartBuild({ ...project, settings: S }), entry: sfxEntry(project) })}
        onSave={saveTemplate} onRemove={name => { useBuildTemplates.getState().remove(name); toast(`The template "${name}" is deleted${project.buildTemplate?.name === name && !project.buildTemplate.builtIn ? ': this project keeps its copy' : ''}`, 'ok'); }}
        onUse={t => applyTemplate(t)} onClose={closeTemplates} />}
      {codeLibEditing && <CodeLibDialog key={codeLibKey} editing={codeLibEditing} toast={toast} onSaved={() => setUi({ activity: 'codelib', sidePanel: true })} onClose={() => useCodeLib.getState().set({ editing: null })} />}
      {codeLibExporting && <CodeLibExportDialog refs={codeLibExporting} toast={toast} onClose={() => useCodeLib.getState().set({ exporting: null })} />}
      {asmRelease && asmMode && <AsmReleaseModal main={asmMain ?? stored.asm?.main ?? 'main.asm'} packer={packPrefs.packer === 'exomizer' ? 'Exomizer' : 'Brokkr'} busy={buildBusy}
        basic={(c => (c ? c.entryFrom === 'basic' : null))(useAsmLink.getState().check)}
        onRelease={c => void releaseAsm(c)} onScripts={() => void asmScripts()} onClose={() => setAsmRelease(false)} />}
      {asmContinue && <ContinueInAssemblerModal info={asmContinue} onCreate={continueInAssembler} onClose={() => setAsmContinue(null)} />}
      {modal === 'project' && <CreateProjectModal name={project.name} moving={movingText()} submit="Create project and move the work" onCreate={createFromWork} onClose={() => setModal(null)} />}
      {valuesScript && <RunValuesModal script={valuesScript} busy={filesBusy} onRun={(text, rows, then) => void runWithValues(text, rows, then)} onStop={stopScript} onClose={() => setValuesRun(null)} />}
      {filesRun && filesRunScript && <RunOnFilesModal script={filesRunScript} files={filesRun.files} first={filesRun.first} busy={filesBusy} onRun={(f, then) => void runOnFiles(f, then)} onStop={stopScript} onClose={() => setFilesRun(null)} />}
      {exportAsk && <CreateProjectModal title="Export files to project needs a project" name={projectNameFor(exportAsk.from)} moving={movingText()} submit="Create project and export the files" onCreate={exportIntoNewProject} onClose={() => setExportAsk(null)}
        lead={`Export files to project writes the ${exportAsk.groups.length} source${exportAsk.groups.length === 1 ? '' : 's'} of ${exportAsk.from} in a folder of the project, ${exportFolder(exportAsk.from)}. The work becomes the project first, as Save makes it one.`} />}
      {unsavedAsk && <UnsavedWorkModal name={(unsavedAsk.kept ?? project).name} what={unsavedAsk.what} left={unsavedAsk.kept && home ? home.name : null}
        onSave={() => { setSaveFirst(unsavedAsk); setUnsavedAsk(null); }} onDiscard={() => { setUnsavedAsk(null); unsavedAsk.go(); }} onClose={() => setUnsavedAsk(null)} />}
      {saveFirst && <CreateProjectModal title={saveFirst.kept ? 'Create a project from the work without a project' : undefined} name={(saveFirst.kept ?? project).name}
        moving={saveFirst.kept ? ['the work without a project (its files, labels, comments, bookmarks and patches)'] : movingText()} submit={`Create project, then open ${saveFirst.what}`} onCreate={saveFirstAs} onClose={() => setSaveFirst(null)} />}
      {closeAsk?.kind === 'unsaved' && <CloseUnsavedModal name={project.name} onSave={() => setCloseAsk({ kind: 'save' })} onClose={() => closeUnsaved(true)} onCancel={() => setCloseAsk(null)} />}
      {closeAsk?.kind === 'save' && <CreateProjectModal name={project.name} moving={movingText()} submit="Create project, then close Mimir" onCreate={saveThenClose} onClose={() => setCloseAsk(null)} />}
      {closeAsk?.kind === 'failed' && <CloseNotSavedModal name={closeAsk.home.name} file={closeAsk.home.file} error={closeAsk.error} onRetry={() => { setCloseAsk(null); void tryClose(); }} onClose={() => closeUnsaved()} onCancel={() => setCloseAsk(null)} />}
      {modal === 'patch' && patchDraft && <PatchModal A={A} R={R} project={project} draft={patchDraft} onApply={savePatchPlan} onClose={closePatch} />}
      <div className="toasts" aria-live="polite">{toasts.map(t => <div key={t.id} className={cx('toast', `t-${t.kind}`)}><Icon name={LVL_ICON[t.kind] || 'info'} size={15} /><span className="toast-msg">{t.msg}</span>
        {t.kind === 'err' && <button className="icon-btn toast-x" aria-label="Dismiss the message" title="Dismiss (the Messages tab keeps it)" onClick={() => dismissToast(t.id)}><Icon name="x" size={13} /></button>}</div>)}</div>
    </div>
    </AssemblerContext.Provider>
  );
}
