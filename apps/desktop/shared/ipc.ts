/* =====================================================================
 * IPC contract (spec 13.4). This is the exhaustive allowlist: the main
 * process registers exactly these channels and the preload exposes
 * exactly these functions as `window.kr`.
 * ===================================================================== */
import type { Cartridge, ExomizerReport, KickProblem, LoadedFile, PackCheck, PackPrefs, PackTried, Project, Roms, ToolchainSettings } from '@mimir/core';

export const CHANNELS = {
  projectOpen: 'project:open',
  projectSave: 'project:save',
  projectStart: 'project:start',
  projectCreate: 'project:create',
  projectParent: 'project:parent',
  projectUnsaved: 'project:unsaved',
  projectReveal: 'project:reveal',
  projectForget: 'project:forget',
  prgOpen: 'prg:open',
  diskOpen: 'disk:open',
  tapeOpen: 'tape:open',
  fileSmart: 'file:smart',
  exportWrite: 'export:write',
  toolchainBuild: 'toolchain:build',
  toolchainRun: 'toolchain:run',
  terminalOpen: 'terminal:open',
  editorOpen: 'editor:open',
  asmPick: 'asm:pick',
  editorFind: 'editor:find',
  toolchainUnpack: 'toolchain:unpack',
  toolchainIdentify: 'toolchain:identify',
  toolchainRoms: 'toolchain:roms',
  toolchainPack: 'toolchain:pack',
  packFolder: 'pack:folder',
  fileSave: 'file:save',
  viceAttach: 'vice:attach',
  viceCommand: 'vice:command',
  viceQuicksave: 'vice:quicksave',
  viceQuicksaveInfo: 'vice:quicksave-info',
  viceQuicksaves: 'vice:quicksaves',
  viceQuicksaveOpen: 'vice:quicksave-open',
  viceQuicksaveRename: 'vice:quicksave-rename',
  viceQuicksaveSave: 'vice:quicksave-save',
  viceQuicksaveFavourite: 'vice:quicksave-favourite',
  viceCharRom: 'vice:chargen',
  deepSidPlay: 'deepsid:play',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  /** main -> renderer */
  fsChanged: 'fs:changed',
  viceQuicksaved: 'vice:quicksaved',
} as const;

export type InvokeChannel = Exclude<(typeof CHANNELS)[keyof typeof CHANNELS], 'fs:changed' | 'vice:quicksaved'>;

/** `path` given: open it (in a folder opened in this session, or a project opened before); otherwise the main process
 *  shows a file dialog. The project's folder is where what Mimir writes for it goes from then on. */
export interface ProjectOpenRequest { path?: string }
export interface ProjectOpenResult { path: string; project: Project; home: ProjectHome }

/** A project: its name, its folder and its project file (`<name>.mimir.json` in the folder) */
export interface ProjectHome { name: string; dir: string; file: string }
/** a project opened before; `exists`: its project file is still there */
export interface RecentProject extends ProjectHome { opened: number; exists: boolean }
/** What the start screen offers. */
export interface ProjectStartInfo {
  /** what was worked on last: a project, or work without one (kept by the window) */
  last: { kind: 'project'; home: ProjectHome; exists: boolean } | { kind: 'unsaved' } | null;
  /** what was chosen earlier in this run of the app (the window was reloaded): it goes on with that */
  resume: { kind: 'project'; home: ProjectHome } | { kind: 'unsaved' } | null;
  /** the projects opened last, the newest first */
  recent: RecentProject[];
  /** where a new project's folder goes unless another is chosen */
  parent: string;
}
/**
 * A new project: the folder `<parent>/<name>` with `project` saved in it as `<name>.mimir.json`. `parent` is the one
 * the start info gave or one picked with project:parent. `gather`: the work done without a project that moves into it,
 * the folder of the last export (copied to source/), of the last build (build/) and the packed file (packed/).
 */
export interface ProjectCreateRequest { name: string; parent: string; project: Project; gather?: { exportDir?: string; buildDir?: string; packed?: string } }
/** `moved`: where the gathered work is now */
export interface ProjectCreateResult { home: ProjectHome; moved: { source?: string; build?: string; packed?: string } }
export interface ProjectParentResult { dir: string }

/** `path` omitted (or not previously used in this session): the main process shows a save dialog. */
export interface ProjectSaveRequest { project: Project; path?: string }
export interface ProjectSaveResult { path: string }

/** `paths` given: read them (they must lie in folders the user picked); otherwise a file dialog. */
/** `zeroPage`: VICE snapshots open from $0002 (zero page and stack included) instead of $0200 */
/** `kind`: what the dialog asks for (the File menu's choices): PRGs, a cartridge or a VICE snapshot; omitted, any of them */
/** what the dialog asks for: PRGs, a cartridge, a snapshot, or PRGs to add to the project */
export type PrgOpenKind = 'prg' | 'crt' | 'vsf' | 'add';
export interface PrgOpenRequest { paths?: string[]; zeroPage?: boolean; kind?: PrgOpenKind }
/** an opened PRG; a VICE snapshot also gives the entry points it holds, its program start and what it is; a chip of a
 *  cartridge (`chip`) the image it is from (the same object for every chip of it); `path`: the file it was read from */
export type OpenedPrg = LoadedFile & { entries?: number[]; snapshot?: string; start?: number; cart?: Cartridge; path?: string };

/** A .d64 or .g64 disk image to mount. `path` given: read it (in a folder the user picked); otherwise a file dialog. */
export interface DiskOpenRequest { path?: string }
export interface DiskOpenResult { path: string; name: string; bytes: Uint8Array }
/** A .tap tape image to put in the datasette, as disk:open does it for a disk. */
export interface TapeOpenRequest { path?: string }
export type TapeOpenResult = DiskOpenResult;

/** Smart attach: a dialog for every kind of file Mimir opens (shared/smart-attach.ts says what each is opened as).
 *  `zeroPage` as for prg:open. */
export interface SmartAttachRequest { zeroPage?: boolean }
/** What was picked, read: PRGs, snapshots and cartridges as prg:open gives them, a disk image as disk:open does (a tape
 *  image as tape:open does), the path of a project to open with project:open, and a Kick Assembler source as asm:pick
 *  gives it (its folder open in this session), for Brokkr to pack. `left`: files not opened, and why; `problems`: files
 *  that could not be read. */
export interface SmartAttachResult {
  files: OpenedPrg[];
  disk: DiskOpenResult | null;
  tape: TapeOpenResult | null;
  project: string | null;
  asm: AsmPickResult | null;
  left: { name: string; why: string }[];
  problems: { name: string; message: string }[];
}

/**
 * Where to write: `dir` (a folder the user picked earlier in this session), `target: 'pick'` (ask
 * with a folder dialog), `target: 'temp'` (a fresh build folder under the OS temp dir), `target: 'project'` (the
 * project's source folder) or `target: 'build'` (the project's build folder; without a project a fresh one in temp).
 * File keys are relative paths; absolute paths and `..` are rejected.
 */
export interface ExportWriteRequest {
  dir?: string;
  target?: 'pick' | 'temp' | 'project' | 'build';
  /** used to name the folder for `target: 'temp'` */
  name?: string;
  files: Record<string, string | Uint8Array>;
}
export interface ExportWriteResult { dir: string; written: string[] }

/** A Kick Assembler source picked in a dialog: its path, its folder (open in this session: it can be built there) and
 *  its file name, the entry to build. */
export interface AsmPickResult { path: string; dir: string; entry: string }

/** Assemble each entry (an .asm file in `dir`) with KickAss.jar from the settings. */
export interface BuildRequest { dir: string; entries: string[] }
export interface BuildOutput {
  entry: string;
  ok: boolean;
  prg: Uint8Array | null;
  prgPath: string;
  vsPath: string | null;
  problems: KickProblem[];
}
export interface BuildResult {
  ok: boolean;
  /** console output of all runs */
  stdout: string;
  problems: KickProblem[];
  /** output of the first entry (spec 13.4) */
  prg?: Uint8Array;
  outputs: BuildOutput[];
  /** the exact argv of every run */
  commands: string[][];
  ms: number;
}

/** Start x64sc with the PRG (and VICE labels) from a build. */
/**
 * `start`: run with `sys <start>` after loading instead of autostarting (the program start set by the user).
 * `disk`: a .d64 or .g64 image (a copy of the mounted disk in a build folder) to put in drive 8.
 * `tape`: a .tap image (a copy of the tape in the datasette) to put in VICE's datasette.
 */
/** `cart`: `prgPath` is a cartridge image (.crt), which VICE attaches (-cartcrt) and starts at reset; a `prgPath` that is
 *  a .tap is autostarted (VICE loads its first file from it) */
export interface RunRequest { prgPath: string; labelsPath?: string; start?: number; disk?: string; tape?: string; cart?: boolean }
/** `via`: RUN, `sys <start>`, (a program over BASIC's work area $0002-$03ff) loaded and started from the monitor, or a
 *  cartridge attached */
export interface RunResult { pid: number; via: 'run' | 'sys' | 'monitor' | 'cart' }

/**
 * A terminal window (VICE on PATH, `kickass` defined) in `dir`: a folder opened in this session (the export or
 * project folder). Without one it opens in the project's source folder (or the project's folder before an export),
 * and without a project where the last dialog picked something, or in the home folder.
 */
export interface TerminalOpenRequest { dir?: string }
export interface TerminalOpenResult { dir: string }

/**
 * The export in the external editor (the one in the settings, else the first found of Sublime Text and Visual Studio
 * Code): its folder, with `file` (its first source, a plain .asm name) open in it. `dir`: a folder opened in this
 * session (the last export); without one the project's source folder.
 */
export interface EditorOpenRequest { dir?: string; file: string }
/** `opened` false: `file` is not in that folder (nothing is exported there yet, or there is no project) and no editor
 *  was started */
export type EditorOpenResult = { opened: true; dir: string; file: string; editor: string } | { opened: false; dir: string | null };
export interface EditorInfo { name: string; path: string }
/** Sublime Text and Visual Studio Code where they are installed, and the editor the export opens in (null: none is set
 *  and none was found) */
export interface EditorFindResult { current: EditorInfo | null; found: EditorInfo[] }

/**
 * Unpack a packed PRG (load address first) with the external unpacker of the toolchain settings (unp64; when none
 * is set, the renderer runs Sindri itself). It runs on a copy in a build folder of its own; `prg` is the file it wrote, `entry` the start address it reported.
 */
export interface UnpackRequest { name: string; prg: Uint8Array }
export interface UnpackResponse {
  ok: boolean; output: string; argv: string[]; dir: string; ms: number;
  name?: string; prg?: Uint8Array; entry?: number | null; packer?: string | null; error?: string;
}
/** Which packer a PRG uses, from unp64 -i (`supported` false when the unpacker is not unp64 or not set). */
export interface IdentifyResponse { supported: boolean; known: boolean; packer: string | null; tool: string }
/** The C64 ROMs for Sindri, read from the user's VICE (the one in the settings, else one found); null:
 * none were found, and Sindri runs with its stand-ins. */
export type RomsResponse = Roms | null;

/**
 * Pack with Brokkr or Exomizer (spec 13.8): the built PRGs (load address first, one per project file in order) are
 * copied to a pack folder of its own, where the packer packs them, or the ranges `prefs` chooses, as `prefs` says.
 * Brokkr runs in a worker thread of the main process; `argv` is then the standalone Brokkr's command for the same
 * file, and `check` its own (an emulated C64 for sfx).
 */
export interface PackRequest { files: { name: string; prg: Uint8Array }[]; prefs: PackPrefs }
/** the folder for the packed file (`PackPrefs.dir`): kept when this session may write there, else asked for in a dialog
 * that opens there; `ask` always shows the dialog */
export interface PackFolderRequest { dir?: string; ask?: boolean }
export interface PackFolderResult { dir: string }
export interface PackResponse {
  ok: boolean; output: string; argv: string[]; ms: number;
  /** Brokkr: its commands for all the files (argv is the first) */
  commands?: string[][];
  /** the pack folder (open in this session: the packed file can be run in VICE) */
  dir: string;
  /** the packed file: its name, path (in `PackPrefs.dir` when that is set, else in the pack folder) and bytes */
  name?: string; path?: string; prg?: Uint8Array;
  /** Brokkr: every file written, where it is written and what it is (crunched data with `split`: one for each part;
   * next to crunched data, the decruncher's PRG and source) */
  files?: { name: string; path: string; prg: Uint8Array; kind: 'packed' | 'decruncher' | 'source'; note: string }[];
  /** Brokkr, format auto: what each format made and which was taken */
  tried?: PackTried[];
  /** the memory that was packed */
  packed: { start: number; length: number } | null;
  report: ExomizerReport;
  /** sfx: Exomizer's desfx (or Brokkr's emulated C64) decrunched it, and this is how that compares with what was packed */
  check: (PackCheck & { argv: string[]; output: string }) | null;
  error?: string;
}

/** Save a file with a save dialog (the packed PRG); null: the dialog was cancelled. */
export interface FileSaveRequest { name: string; bytes: Uint8Array; title?: string }
export interface FileSaveResult { path: string }

/**
 * A music block's .sid in DeepSID, the online SID player, in a window of its own: the file goes to DeepSID's Load
 * SID (its temporary emulator testing, which keeps it on DeepSID's server under `name`) and starts playing. `path`:
 * the file, also written to a build folder; `played`: DeepSID took it and started it (else `problem` says where it
 * stopped, and the window stays open for Load SID by hand).
 */
export interface DeepSidPlayRequest { name: string; sid: Uint8Array }
export interface DeepSidPlayResult { played: boolean; path: string; url: string; problem?: string }

/** VICE binary monitor (milestone M3); the channels exist so the contract is complete. */
export interface ViceAttachRequest { host?: string; port?: number }
export interface ViceCommandRequest { command: string }
export type ViceResult = { ok: true; response: string } | { ok: false; error: string };

export interface FsChangedEvent { path: string }

/** VICE's quicksave snapshot (13.7b), opened like a snapshot from Open PRG (`zeroPage`: from $0002) */
export interface QuicksaveRequest { zeroPage?: boolean }
/** the newest quicksave, or where VICE writes it when there is none yet; `saved`: its modification time */
export type QuicksaveResult = { found: false; path: string } | { found: true; path: string; saved: number; files: OpenedPrg[] };
/** whether there is a quicksave and when it was saved (it is not read); `path`: the newest, else where VICE writes it */
export interface QuicksaveInfo { found: boolean; path: string; saved?: number }
/** VICE's character ROM (4 KB, upper case then lower case), read from the VICE in the settings; `path`: where it is,
 *  or where it was looked for */
export type CharRomResult = { found: false; path: string } | { found: true; path: string; bytes: Uint8Array };
/** main -> renderer: VICE wrote a new quicksave (it is in the list of the newest already) */
export interface QuicksaveEvent { path: string; saved: number }
/** one of the quicksaves the app keeps (13.7b): a name the user can change, when VICE saved it, its size; `favourite`:
 *  it stays when VICE saves newer ones */
export interface QuicksaveEntry { id: string; name: string; saved: number; size: number; favourite?: boolean }
/** the kept quicksave `id`, opened like a snapshot from Open PRG */
export interface QuicksaveEntryRequest { id: string; zeroPage?: boolean }
export interface QuicksaveRenameRequest { id: string; name: string }
/** the kept quicksave `id` made a favourite (`on`), or one no more */
export interface QuicksaveFavouriteRequest { id: string; on: boolean }

export interface KrApi {
  openProject(req?: ProjectOpenRequest): Promise<ProjectOpenResult | null>;
  saveProject(req: ProjectSaveRequest): Promise<ProjectSaveResult | null>;
  /** what the start screen offers: what was worked on last, the projects opened last */
  projectStart(): Promise<ProjectStartInfo>;
  /** a new project's folder, with the project saved in it (and the work without a project moved there) */
  createProject(req: ProjectCreateRequest): Promise<ProjectCreateResult>;
  /** a folder dialog for where a new project's folder goes; null: cancelled */
  projectParent(): Promise<ProjectParentResult | null>;
  /** work without a project from now on (the window keeps it) */
  workUnsaved(): Promise<void>;
  /** the project's folder in the file manager */
  revealProject(): Promise<void>;
  /** a project taken off the list of those opened last */
  forgetProject(req: { file: string }): Promise<RecentProject[]>;
  openPrg(req?: PrgOpenRequest): Promise<OpenedPrg[]>;
  /** null: the dialog was cancelled */
  openDisk(req?: DiskOpenRequest): Promise<DiskOpenResult | null>;
  /** a .tap tape image for the datasette; null: the dialog was cancelled */
  openTape(req?: TapeOpenRequest): Promise<TapeOpenResult | null>;
  /** File → Smart attach…: any file Mimir opens, each opened by its extension; null: the dialog was cancelled */
  smartAttach(req?: SmartAttachRequest): Promise<SmartAttachResult | null>;
  writeExport(req: ExportWriteRequest): Promise<ExportWriteResult | null>;
  build(req: BuildRequest): Promise<BuildResult>;
  /** a Kick Assembler source picked in a dialog, to build where it is; null: cancelled */
  pickAsm(): Promise<AsmPickResult | null>;
  run(req: RunRequest): Promise<RunResult>;
  openTerminal(req?: TerminalOpenRequest): Promise<TerminalOpenResult>;
  /** the export's folder in the external editor, with its first .asm file open */
  openEditor(req: EditorOpenRequest): Promise<EditorOpenResult>;
  findEditors(): Promise<EditorFindResult>;
  unpack(req: UnpackRequest): Promise<UnpackResponse>;
  identifyPacker(req: UnpackRequest): Promise<IdentifyResponse>;
  c64Roms(): Promise<RomsResponse>;
  pack(req: PackRequest): Promise<PackResponse>;
  /** the folder for the packed file, allowed for this session; null: the dialog was cancelled */
  packFolder(req: PackFolderRequest): Promise<PackFolderResult | null>;
  saveFile(req: FileSaveRequest): Promise<FileSaveResult | null>;
  /** a music block's .sid playing in DeepSID, in a window of its own */
  playInDeepSid(req: DeepSidPlayRequest): Promise<DeepSidPlayResult>;
  viceAttach(req?: ViceAttachRequest): Promise<ViceResult>;
  viceCommand(req: ViceCommandRequest): Promise<ViceResult>;
  getSettings(): Promise<ToolchainSettings>;
  setSettings(patch: Partial<ToolchainSettings>): Promise<ToolchainSettings>;
  openQuicksave(req?: QuicksaveRequest): Promise<QuicksaveResult>;
  quicksaveInfo(): Promise<QuicksaveInfo>;
  /** the quicksaves the app keeps (the newest, and the favourites), the newest first */
  quicksaves(): Promise<QuicksaveEntry[]>;
  openQuicksaveEntry(req: QuicksaveEntryRequest): Promise<QuicksaveResult>;
  renameQuicksave(req: QuicksaveRenameRequest): Promise<QuicksaveEntry[]>;
  /** a save dialog: a copy of the kept quicksave in a folder of the user's; null: cancelled */
  saveQuicksave(req: { id: string }): Promise<FileSaveResult | null>;
  favouriteQuicksave(req: QuicksaveFavouriteRequest): Promise<QuicksaveEntry[]>;
  /** VICE's character ROM, for drawing screens in the Graphics tab */
  charRom(): Promise<CharRomResult>;
  /** Subscribe to new VICE quicksaves; returns an unsubscribe function. */
  onQuicksave(cb: (e: QuicksaveEvent) => void): () => void;
  /** Subscribe to file-watcher events for exported project folders; returns an unsubscribe function. */
  onFsChanged(cb: (e: FsChangedEvent) => void): () => void;
}
