/* Registers the IPC allowlist (spec 13.4). Every request is checked for a trusted sender and
 * validated with zod before it touches the file system or starts a process. */
import { BrowserWindow, dialog, ipcMain, shell, type IpcMainInvokeEvent, type OpenDialogOptions, type WebContents } from 'electron';
import { existsSync, statSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { assertEntryName, type PathPolicy } from './paths';
import { z, type ZodTypeAny } from 'zod';
import { CHANNELS, type AsmPickResult, type InvokeChannel, type ExportWriteResult, type FileSaveResult, type PackFolderResult, type ProjectCreateResult, type ProjectHome, type ProjectOpenResult, type ProjectParentResult, type ProjectSaveResult, type PrgOpenKind } from '../../shared/ipc';
import type { RecentFolders, RecentKind } from './recent';
import type { SettingsStore } from './settings';
import { createProjectFolder, gatherWork, homeOf, nearestFolder, type ProjectStore } from './projects';
import { PROJECT_FOLDERS } from '../../shared/projects';
import { createBuildFolder, readDiskImage, readPrgFiles, readProjectFile, writeExportFolder, writeProjectFile, type ExportWatcher } from './project-fs';
import { buildWithKickAssembler, c64Roms, currentEditor, identifyWithTool, keepPacked, openInEditor, openTerminal, packWithBrokkr, packWithExomizer, runInVice, unpackWithTool } from './toolchain';
import { viceAttach, viceCommand } from './vice-monitor';
import { quicksaveFileName, quicksaveFiles, quicksaveInfo, readQuicksave, type QuicksaveHistory, type QuicksaveWatcher } from './quicksave';
import { charRomFiles, readCharRom } from './chargen';
import { openC64File } from '@mimir/core';
import { findEditors } from '@mimir/core/node';
import { openedPrg } from './project-fs';
import {
  buildSchema, diskOpenSchema, editorOpenSchema, exportWriteSchema, fileSaveSchema, packFolderSchema, packSchema, prgOpenSchema, projectCreateSchema, projectForgetSchema, projectOpenSchema, projectSaveSchema, quicksaveEntrySchema, quicksaveFavouriteSchema, quicksaveRenameSchema, quicksaveSaveSchema,
  quicksaveSchema, runSchema, terminalOpenSchema, unpackSchema, toolchainSettingsSchema, viceAttachSchema, viceCommandSchema,
} from './schemas';

export interface IpcDeps {
  policy: PathPolicy;
  settings: SettingsStore;
  watcher: ExportWatcher;
  /** the folder each dialog was last used in (they open there again, also after a restart) */
  recent: RecentFolders;
  /** true for the app's own renderer (dev server or the packaged index.html) */
  isTrustedUrl: (url: string) => boolean;
  /** watches VICE's quicksave snapshot (the files follow the setting) */
  quicksave: QuicksaveWatcher;
  /** the newest quicksaves, kept with names */
  history: QuicksaveHistory;
  /** the project of this run, the projects opened last and what was worked on last */
  projects: ProjectStore;
}

const windowOf = (wc: WebContents) => BrowserWindow.fromWebContents(wc) ?? undefined;

/** what the save dialog calls a file, by its extension */
const SAVE_KINDS: Record<string, string> = {
  prg: 'C64 program', bin: 'Binary data', '64c': 'Charset with load address', kla: 'Koala Painter picture', art: 'Art Studio picture',
  png: 'PNG image', asm: 'Kick Assembler source',
};

/** the open dialog for each of the File menu's choices (`any`: Ctrl+O, Open PRG… elsewhere): a cartridge or a snapshot
 *  is one file, a project of its own */
const OPEN_KINDS: Record<'any' | PrgOpenKind, { title: string; name: string; extensions: string[]; many: boolean }> = {
  any: { title: 'Open PRG files', name: 'C64 programs, VICE snapshots and cartridges', extensions: ['prg', 'PRG', 'vsf', 'VSF', 'crt', 'CRT'], many: true },
  prg: { title: 'Open PRG files', name: 'C64 programs', extensions: ['prg', 'PRG'], many: true },
  crt: { title: 'Open a cartridge', name: 'C64 cartridges', extensions: ['crt', 'CRT'], many: false },
  vsf: { title: 'Open a VICE snapshot', name: 'VICE snapshots', extensions: ['vsf', 'VSF'], many: false },
  add: { title: 'Add PRG files to the project', name: 'C64 programs', extensions: ['prg', 'PRG'], many: true },
};

async function pickPaths(e: IpcMainInvokeEvent, options: OpenDialogOptions): Promise<string[]> {
  const win = windowOf(e.sender);
  const r = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options);
  return r.canceled ? [] : r.filePaths;
}

export function registerIpc(deps: IpcDeps): void {
  const { policy, settings, watcher, recent, quicksave, history, projects } = deps;
  quicksave.watch(quicksaveFiles(settings.get().viceQuicksave));
  // the quicksave there is now (from before the app started, or in a newly set file) joins the kept ones
  const keepCurrent = () => quicksaveInfo(quicksaveFiles(settings.get().viceQuicksave)).then(i => (i.found && i.saved ? history.add(i.path, i.saved) : null)).catch(() => null);
  let kept = keepCurrent();
  /** the folder last picked in a dialog: where the terminal opens when the renderer names none */
  let lastChosen: string | null = null;
  /** a folder the user picked: allowed for this session, and where this kind of dialog opens next time */
  const chose = (dir: string, kind: RecentKind, remember = dir) => { lastChosen = policy.allow(dir); recent.remember(kind, remember); return lastChosen; };
  const pick = (e: IpcMainInvokeEvent, kind: RecentKind, options: OpenDialogOptions) => {
    const start = recent.folder(kind);
    return pickPaths(e, start ? { ...options, defaultPath: start } : options);
  };

  const handle = <S extends ZodTypeAny>(channel: InvokeChannel, schema: S, fn: (req: z.output<S>, e: IpcMainInvokeEvent) => Promise<unknown> | unknown) => {
    ipcMain.handle(channel, async (e, raw: unknown) => {
      if (!deps.isTrustedUrl(e.senderFrame?.url ?? '')) throw new Error(`${channel}: request from an untrusted page`);
      const parsed = schema.safeParse(raw);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        throw new Error(`${channel}: invalid request (${issue?.path.join('.') || 'value'}: ${issue?.message})`);
      }
      return fn(parsed.data, e);
    });
  };

  /** work on the project `home` from now on: its folder may be written to, and it is the one opened last */
  const enter = (home: ProjectHome) => { policy.allow(home.dir); projects.enter(home); return home; };

  handle(CHANNELS.projectOpen, projectOpenSchema, async (req, e): Promise<ProjectOpenResult | null> => {
    // a project opened before needs no dialog: the start screen lists those (from this store, never from the renderer)
    let path = req.path ? (projects.isRecent(req.path) ? req.path : policy.assert(req.path, 'Project file')) : null;
    if (!path) {
      const [picked] = await pick(e, 'project', { title: 'Open Mimir project', properties: ['openFile'], filters: [{ name: 'Mimir project', extensions: ['json'] }] });
      if (!picked) return null;
      path = picked;
      chose(dirname(path), 'project');
    }
    const project = await readProjectFile(path);
    return { path, project, home: enter(homeOf(path)) };
  });

  handle(CHANNELS.projectStart, z.undefined().or(z.object({}).strict()), () => projects.start());
  handle(CHANNELS.projectParent, z.undefined().or(z.object({}).strict()), async (_req, e): Promise<ProjectParentResult | null> => {
    // it opens where the suggested folder is, or the nearest folder above it while it is not made yet (Documents\Mimir
    // before the first project); a folder that is not there is not offered to be made (promptToCreate asked at once)
    const [picked] = await pickPaths(e, { title: 'Folder for the new project', defaultPath: nearestFolder(projects.parent()), properties: ['openDirectory', 'createDirectory'] });
    return picked ? { dir: policy.allow(picked) } : null;
  });
  handle(CHANNELS.projectCreate, projectCreateSchema, async (req): Promise<ProjectCreateResult> => {
    // the folder for new projects the store suggests (the documents folder's Mimir, or where the last one went), or one
    // picked in this session
    const parent = req.parent === projects.parent() ? req.parent : policy.assert(req.parent, 'The folder for the new project');
    // the work without a project comes from folders of this session (an export, the app's build and pack folders)
    const gather = req.gather ?? {};
    for (const p of [gather.exportDir, gather.buildDir, gather.packed]) if (p) policy.assert(p, 'The work to move into the project');
    const home = await createProjectFolder(parent, req.name);
    await writeProjectFile(home.file, { ...req.project, name: req.project.name || home.name });
    const moved = await gatherWork(home, gather);
    projects.rememberParent(parent);
    enter(home);
    if (moved.source) watcher.watch(moved.source);
    return { home, moved };
  });
  handle(CHANNELS.projectUnsaved, z.undefined().or(z.object({}).strict()), () => { projects.unsaved(); });
  handle(CHANNELS.projectReveal, z.undefined().or(z.object({}).strict()), async () => {
    if (!projects.current) throw new Error('No project is open');
    const error = await shell.openPath(projects.current.dir);
    if (error) throw new Error(error);
  });
  handle(CHANNELS.projectForget, projectForgetSchema, req => projects.forget(req.file));

  handle(CHANNELS.projectSave, projectSaveSchema, async (req, e): Promise<ProjectSaveResult | null> => {
    let path = req.path && policy.isAllowed(req.path) ? req.path : null;
    if (!path) {
      const win = windowOf(e.sender);
      const start = projects.current?.dir ?? recent.folder('project'), file = `${req.project.name}.mimir.json`;
      const options = { title: 'Save Mimir project', defaultPath: start ? join(start, file) : file, filters: [{ name: 'Mimir project', extensions: ['json'] }] };
      const r = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
      if (r.canceled || !r.filePath) return null;
      path = r.filePath;
      chose(dirname(path), 'project');
    }
    await writeProjectFile(path, req.project);
    return { path };
  });

  handle(CHANNELS.prgOpen, prgOpenSchema, async (req, e) => {
    let paths = req.paths?.map(p => policy.assert(p, 'PRG file')) ?? [];
    if (!req.paths?.length) {
      const ask = OPEN_KINDS[req.kind ?? 'any'];
      paths = await pick(e, 'prg', { title: ask.title, properties: ask.many ? ['openFile', 'multiSelections'] : ['openFile'], filters: [{ name: ask.name, extensions: ask.extensions }, { name: 'All files', extensions: ['*'] }] });
      for (const p of paths) chose(dirname(p), 'prg');
    }
    return readPrgFiles(paths, { zeroPage: req.zeroPage });
  });

  handle(CHANNELS.diskOpen, diskOpenSchema, async (req, e) => {
    let path = req.path ? policy.assert(req.path, 'Disk image') : null;
    if (!path) {
      [path] = await pick(e, 'disk', { title: 'Mount D64 disk image', properties: ['openFile'], filters: [{ name: 'C64 disk images', extensions: ['d64', 'D64'] }, { name: 'All files', extensions: ['*'] }] });
      if (!path) return null;
      chose(dirname(path), 'disk');
    }
    return readDiskImage(path);
  });

  handle(CHANNELS.exportWrite, exportWriteSchema, async (req, e): Promise<ExportWriteResult | null> => {
    let dir: string;
    // a project's build goes in its build folder, again each time; without a project in a fresh folder in temp
    const own = req.target === 'build' ? projects.folder('build') : null;
    if (req.target === 'temp' || (req.target === 'build' && !own)) dir = policy.allow(await createBuildFolder(req.name ?? 'build'));
    else if (own) dir = own;
    else if (req.target === 'project') {
      const source = projects.folder('source');
      if (!source) throw new Error('No project is open: export to a folder instead');
      dir = source;
    } else if (req.target === 'pick') {
      const [picked] = await pick(e, 'export', { title: 'Export Kick Assembler project to folder', properties: ['openDirectory', 'createDirectory', 'promptToCreate'] });
      if (!picked) return null;
      // the next export dialog opens in the folder around this one, so a new export can go next to it
      dir = chose(picked, 'export', dirname(picked));
    } else dir = policy.assert(req.dir!, 'Export folder');
    watcher.touched(dir);
    const written = await writeExportFolder(dir, req.files);
    if (req.target !== 'temp' && req.target !== 'build') watcher.watch(dir);
    return { dir, written };
  });

  handle(CHANNELS.toolchainBuild, buildSchema, req => buildWithKickAssembler(req, settings.get(), policy));
  // a source of the user's to build where it is (Pack from the start screen): its folder is allowed, as a dialog's
  handle(CHANNELS.asmPick, z.undefined().or(z.object({}).strict()), async (_req, e): Promise<AsmPickResult | null> => {
    const [path] = await pick(e, 'asm', { title: 'Choose a Kick Assembler source to pack', properties: ['openFile'], filters: [{ name: 'Kick Assembler source', extensions: ['asm', 'ASM'] }, { name: 'All files', extensions: ['*'] }] });
    if (!path) return null;
    const entry = basename(path);
    if (!/\.asm$/i.test(entry)) throw new Error(`${entry} is not a .asm file: Kick Assembler builds .asm sources`);
    assertEntryName(entry);
    return { path, dir: chose(dirname(path), 'asm'), entry };
  });
  handle(CHANNELS.toolchainRun, runSchema, req => runInVice(req, settings.get(), policy));
  handle(CHANNELS.toolchainUnpack, unpackSchema, req => unpackWithTool(req, settings.get()));
  handle(CHANNELS.toolchainIdentify, unpackSchema, req => identifyWithTool(req, settings.get()));
  handle(CHANNELS.toolchainRoms, z.undefined().or(z.object({}).strict()), () => c64Roms(settings.get().vicePath));
  handle(CHANNELS.toolchainPack, packSchema, async req => {
    // the folder for the packed file must be one picked in this session (pack:folder asks for it first); none chosen,
    // a project's packed file goes in its packed folder
    const to = req.prefs.dir ? policy.assert(req.prefs.dir, 'The folder for the packed file (choose it again in the Pack view)') : projects.folder('packed');
    const r = await (req.prefs.packer === 'exomizer' ? packWithExomizer(req, settings.get(), policy) : packWithBrokkr(req, policy));
    if (to && r.name) for (const name of r.files?.map(f => f.name) ?? [r.name]) watcher.wrote(join(to, name));
    return keepPacked(r, to);
  });
  handle(CHANNELS.packFolder, packFolderSchema, async (req, e): Promise<PackFolderResult | null> => {
    const isDir = (d: string) => existsSync(d) && statSync(d).isDirectory();
    // a folder this session may write to needs no dialog; one kept in a project file is asked for, the dialog there
    if (req.dir && !req.ask && policy.isAllowed(req.dir) && isDir(req.dir)) return { dir: req.dir };
    const start = req.dir && isDir(req.dir) ? req.dir : recent.folder('pack');
    const [picked] = await pickPaths(e, { title: 'Folder for the packed file', properties: ['openDirectory', 'createDirectory', 'promptToCreate'], ...(start ? { defaultPath: start } : {}) });
    return picked ? { dir: chose(picked, 'pack') } : null;
  });
  handle(CHANNELS.fileSave, fileSaveSchema, async (req, e): Promise<FileSaveResult | null> => {
    const win = windowOf(e.sender);
    // a project's files are saved in its folder unless the user goes elsewhere
    const start = projects.current?.dir ?? recent.folder('pack') ?? recent.folder('export');
    const ext = /\.(\w+)$/.exec(req.name)?.[1].toLowerCase() ?? 'prg';
    const options = { title: req.title ?? 'Save packed file', defaultPath: start ? join(start, req.name) : req.name, filters: [{ name: SAVE_KINDS[ext] ?? 'C64 file', extensions: [ext] }, { name: 'All files', extensions: ['*'] }] };
    const r = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
    if (r.canceled || !r.filePath) return null;
    chose(dirname(r.filePath), 'pack');
    await writeFile(r.filePath, req.bytes);
    return { path: r.filePath };
  });
  const projectTerminal = () => {
    if (!projects.current) return null;
    const source = join(projects.current.dir, PROJECT_FOLDERS.source);
    return existsSync(source) ? source : projects.current.dir;
  };
  handle(CHANNELS.terminalOpen, terminalOpenSchema, req => openTerminal(req.dir ? policy.assert(req.dir, 'Folder') : projectTerminal() ?? lastChosen ?? homedir(), settings.get()));
  // the editor comes from the settings (or is one found where it installs itself), never from the renderer
  handle(CHANNELS.editorOpen, editorOpenSchema, req => {
    const dir = req.dir ? policy.assert(req.dir, 'Folder') : projects.current ? join(projects.current.dir, PROJECT_FOLDERS.source) : null;
    return dir ? openInEditor(dir, assertEntryName(req.file), settings.get()) : { opened: false, dir: null };
  });
  handle(CHANNELS.editorFind, z.undefined().or(z.object({}).strict()), () => {
    const found = findEditors();
    return { current: currentEditor(settings.get(), found), found };
  });
  handle(CHANNELS.viceAttach, viceAttachSchema, req => viceAttach(req));
  handle(CHANNELS.viceCommand, viceCommandSchema, req => viceCommand(req));
  // the file comes from the settings (or VICE's own folder), never from the renderer
  handle(CHANNELS.viceQuicksave, quicksaveSchema, req => readQuicksave(quicksaveFiles(settings.get().viceQuicksave), req));
  handle(CHANNELS.viceQuicksaveInfo, z.undefined().or(z.object({}).strict()), () => quicksaveInfo(quicksaveFiles(settings.get().viceQuicksave)));
  // the kept quicksaves (13.7b): by the ids of the list; their files are the app's own
  handle(CHANNELS.viceQuicksaves, z.undefined().or(z.object({}).strict()), async () => { await kept; return history.list(); });
  handle(CHANNELS.viceQuicksaveOpen, quicksaveEntrySchema, async req => {
    const { entry, bytes } = await history.get(req.id);
    return { found: true, path: history.file(req.id), saved: entry.saved, files: [openedPrg(openC64File(quicksaveFileName(entry.name), bytes, { zeroPage: req.zeroPage }))] };
  });
  handle(CHANNELS.viceQuicksaveRename, quicksaveRenameSchema, req => history.rename(req.id, req.name));
  handle(CHANNELS.viceQuicksaveFavourite, quicksaveFavouriteSchema, req => history.favourite(req.id, req.on));
  handle(CHANNELS.viceQuicksaveSave, quicksaveSaveSchema, async (req, e): Promise<FileSaveResult | null> => {
    const { entry, bytes } = await history.get(req.id);
    const win = windowOf(e.sender), start = projects.current?.dir ?? recent.folder('snapshot'), file = quicksaveFileName(entry.name);
    const options = { title: `Save the quicksave "${entry.name}"`, defaultPath: start ? join(start, file) : file, filters: [{ name: 'VICE snapshot', extensions: ['vsf'] }, { name: 'All files', extensions: ['*'] }] };
    const r = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
    if (r.canceled || !r.filePath) return null;
    chose(dirname(r.filePath), 'snapshot');
    await writeFile(r.filePath, bytes);
    return { path: r.filePath };
  });
  // the ROM comes from the VICE in the settings, never from a path the renderer gives
  handle(CHANNELS.viceCharRom, z.undefined().or(z.object({}).strict()), () => readCharRom(charRomFiles(settings.get().vicePath)));
  handle(CHANNELS.settingsGet, z.undefined().or(z.object({}).strict()), () => settings.get());
  handle(CHANNELS.settingsSet, toolchainSettingsSchema.partial(), req => {
    const next = settings.set(req);
    quicksave.watch(quicksaveFiles(next.viceQuicksave));
    kept = keepCurrent();
    return next;
  });
}
