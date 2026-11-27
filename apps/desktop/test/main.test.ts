/* Main-process logic without Electron: path policy, settings store, IPC schemas, toolchain runner. */
import { describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analyze, createProject, DEFAULT_PACK, demoProject, packWithBrokkr as packWithBrokkrCore, deserializeProject, LEGACY_PROJECT_FORMAT, makeD64, makePsid, picture, render, serializeProject, writePicture, type SerializedProject, type ToolchainSettings } from '@mimir/core';
import { findKickAssJar, writeVfs } from '@mimir/core/node';
import { CHANNELS } from '../shared/ipc';
import { assertEntryName, PathPolicy } from '../electron/main/paths';
import { bringOldSettings } from '../electron/main/migrate';
import { RecentFolders } from '../electron/main/recent';
import { answerClose, askBeforeClose, CLOSE_ANSWER_MS, type ClosingWindow } from '../electron/main/closing';
import { findInFolder, startFolder, toolLook } from '../electron/main/locate';
import { bundledExomizer, defaultToolchainSettings, SettingsStore } from '../electron/main/settings';
import { codelibExportSchema, codelibFileSchema, codelibRevealSchema, codelibSaveSchema, deepSidPlaySchema, diskOpenSchema, libraryAddSchema, libraryFileSchema, libraryRevealSchema, libraryUpdateSchema, locateSchema, tapeOpenSchema, editorOpenSchema, exportWriteSchema, fileSaveSchema, packFolderSchema, packSchema, prgOpenSchema, projectSchema, quicksaveEntrySchema, quicksaveFavouriteSchema, quicksaveRenameSchema, runSchema, serializedProjectSchema, smartAttachSchema, windowCloseSchema } from '../electron/main/schemas';
import { buildWithAssembler, currentEditor, keepPacked, openInEditor, packWithBrokkr, packWithExomizer } from '../electron/main/toolchain';
import { QUICKSAVE_FILE, QuicksaveHistory, QuicksaveWatcher, quicksaveFileName, quicksaveFiles, quicksaveInfo, quicksaveName, readQuicksave, viceConfigDir } from '../electron/main/quicksave';
import { readDiskImage, readPrgFiles, readProjectFile, writeProjectFile } from '../electron/main/project-fs';
import { charRomFiles, readCharRom } from '../electron/main/chargen';
import { defaultLibraryDir, LibraryStore } from '../electron/main/library';
import { CodeLibStore } from '../electron/main/code-library';
import { createProjectFolder, gatherWork, homeOf, isOwnTemp, nearestFolder, ProjectStore, RECENT_PROJECTS } from '../electron/main/projects';
import { projectNameOf, projectNameProblem } from '../shared/projects';
import { smartKind, smartPlan } from '../shared/smart-attach';

const tmp = () => mkdtempSync(join(tmpdir(), 'mimir-desktop-test-'));
const toolchain = (patch: Partial<ToolchainSettings> = {}): ToolchainSettings => ({ javaPath: 'java', kickJar: '', vicePath: '', outDir: 'out', kickArgs: '-vicesymbols -showmem', tassPath: '', tassArgs: '', viceArgs: '-autostartprgmode 1', unpackerPath: '', unpackerArgs: '{in}', exomizerPath: '', viceQuicksave: '', editorPath: '', editorArgs: '{dir} {file}', musicPlayer: 'vice', debugger: 'retro', retroDebuggerPath: '', retroDebuggerArgs: '', c64DebuggerPath: '', c64DebuggerArgs: '', debuggerWait: 3000, libraryDir: '', bitmapFormatMc: 'koala', bitmapFormatHires: 'art', ...patch });

describe('IPC contract', () => {
  it('has exactly the channels of spec 13.4', () => {
    expect(Object.values(CHANNELS).sort()).toEqual(['disk:open', 'tape:open', 'file:smart', 'export:write', 'fs:changed', 'prg:open', 'project:open', 'project:save', 'project:start', 'project:create', 'project:parent', 'project:unsaved', 'project:reveal', 'project:forget', 'settings:get', 'settings:set', 'settings:locate', 'terminal:open', 'editor:open', 'editor:find', 'asm:pick', 'toolchain:build', 'toolchain:identify', 'toolchain:pack', 'pack:folder', 'toolchain:roms', 'toolchain:run', 'toolchain:unpack', 'vice:attach', 'vice:command', 'file:save', 'vice:quicksave', 'vice:quicksave-info', 'vice:quicksaves', 'vice:quicksave-open', 'vice:quicksave-rename', 'vice:quicksave-save', 'vice:quicksave-favourite', 'vice:quicksaved', 'vice:chargen', 'deepsid:play', 'window:close', 'window:closing', 'git:version', 'git:status', 'git:init', 'git:stage', 'git:unstage', 'git:commit', 'git:push', 'git:remote', 'git:diff', 'git:compare', 'library:list', 'library:add', 'library:update', 'library:remove', 'library:reveal', 'library:pick', 'scripts:list', 'scripts:save', 'scripts:remove', 'scripts:reveal', 'codelib:list', 'codelib:save', 'codelib:remove', 'codelib:reveal', 'codelib:import', 'codelib:export', 'assembler:start', 'assembler:open', 'assembler:create', 'assembler:forget', 'assembler:close', 'assembler:list', 'assembler:read', 'assembler:readOutside', 'assembler:write', 'assembler:change', 'assembler:reveal', 'assembler:pickData'].sort());
  });
});

describe('closing a window', () => {
  /** a window whose `tryClose` is its X: true when it closed */
  function fakeWindow(crashed = false) {
    const on: { close?: (e: { preventDefault(): void }) => void; closed?: () => void } = {};
    const sent: string[] = [];
    let closed = false;
    const win: ClosingWindow = {
      on: ((event: 'close' | 'closed', fn: never) => { on[event] = fn; }) as ClosingWindow['on'],
      close: () => { if (tryClose()) { closed = true; on.closed?.(); } },
      isDestroyed: () => closed,
      webContents: { send: ch => { sent.push(ch); }, isCrashed: () => crashed },
    };
    function tryClose(): boolean {
      let prevented = false;
      on.close?.({ preventDefault: () => { prevented = true; } });
      return !prevented;
    }
    askBeforeClose(win);
    return { win, sent, tryClose: () => { if (tryClose()) { closed = true; on.closed?.(); } return closed; }, isClosed: () => closed };
  }

  it('asks the page first, and closes once it answers so', () => {
    const w = fakeWindow();
    expect(w.tryClose()).toBe(false);
    expect(w.sent).toEqual([CHANNELS.windowClosing]);
    answerClose(w.win, true);
    expect(w.isClosed()).toBe(true);
  });

  it('waits while the page asks the user, as long as it takes; asked again, the page is asked again', () => {
    vi.useFakeTimers();
    try {
      const w = fakeWindow();
      w.tryClose();
      answerClose(w.win, false);
      vi.advanceTimersByTime(CLOSE_ANSWER_MS * 10);
      expect(w.isClosed()).toBe(false);
      expect(w.tryClose()).toBe(false);
      expect(w.sent).toEqual([CHANNELS.windowClosing, CHANNELS.windowClosing]);
      answerClose(w.win, false);
      // Cancel: the window stays, and the next X asks again
      expect(w.tryClose()).toBe(false);
      answerClose(w.win, true);
      expect(w.isClosed()).toBe(true);
    } finally { vi.useRealTimers(); }
  });

  it('closes anyway when the page does not answer, and at once when it crashed', () => {
    vi.useFakeTimers();
    try {
      const w = fakeWindow();
      w.tryClose();
      vi.advanceTimersByTime(CLOSE_ANSWER_MS - 1);
      expect(w.isClosed()).toBe(false);
      vi.advanceTimersByTime(1);
      expect(w.isClosed()).toBe(true);
      const crashed = fakeWindow(true);
      expect(crashed.tryClose()).toBe(true);
      expect(crashed.sent).toEqual([]);
    } finally { vi.useRealTimers(); }
  });

  it('takes the answer only as a boolean', () => {
    expect(windowCloseSchema.safeParse({ close: true }).success).toBe(true);
    expect(windowCloseSchema.safeParse({ close: 'yes' }).success).toBe(false);
    expect(windowCloseSchema.safeParse({ close: true, force: true }).success).toBe(false);
    expect(windowCloseSchema.safeParse(undefined).success).toBe(false);
  });
});

describe('PathPolicy', () => {
  it('only allows paths inside picked folders', () => {
    const p = new PathPolicy();
    const root = p.allow(join(tmpdir(), 'picked'));
    expect(p.isAllowed(root)).toBe(true);
    expect(p.isAllowed(join(root, 'sub', 'a.asm'))).toBe(true);
    expect(p.isAllowed(join(root, '..', 'other'))).toBe(false);
    expect(p.isAllowed(join(root + '-sibling', 'x'))).toBe(false);
    expect(p.isAllowed('')).toBe(false);
    expect(() => p.assert(join(tmpdir(), 'elsewhere'), 'Build folder')).toThrow(/outside the folders/);
  });

  it('accepts only plain .asm names as build entries', () => {
    for (const ok of ['raster-demo.asm', 'my border.asm', 'spel_för_c64.ASM', 'intro (v2).asm']) expect(assertEntryName(ok)).toBe(ok);
    for (const bad of ['../x.asm', 'a/b.asm', 'C:\\x.asm', 'x.prg', '-oops.asm', '.hidden.asm', 'a:b.asm', '']) expect(() => assertEntryName(bad)).toThrow();
  });
});

describe('SettingsStore', () => {
  it('starts from defaults, validates and persists changes', () => {
    const dir = tmp();
    const s = new SettingsStore(dir, () => toolchain());
    expect(s.get().outDir).toBe('out');
    s.set({ kickJar: 'C:\\C64\\KickAss.jar', outDir: 'build' });
    expect(new SettingsStore(dir, () => toolchain()).get()).toMatchObject({ kickJar: 'C:\\C64\\KickAss.jar', outDir: 'build' });
    expect(() => s.set({ outDir: '../escape' })).toThrow();
    expect(s.get().outDir).toBe('build');
  });

  it('plays music blocks in VICE, or in DeepSID when that is set; a settings file from before keeps VICE', () => {
    const dir = tmp();
    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ javaPath: 'java', outDir: 'out' }));
    const s = new SettingsStore(dir, () => toolchain());
    expect(s.get().musicPlayer).toBe('vice');
    s.set({ musicPlayer: 'deepsid' });
    expect(new SettingsStore(dir, () => toolchain()).get().musicPlayer).toBe('deepsid');
    expect(() => s.set({ musicPlayer: 'sidplay' as never })).toThrow();
    expect(s.get().musicPlayer).toBe('deepsid');
  });

  it('ignores an unreadable settings file', () => {
    const dir = tmp();
    writeFileSync(join(dir, 'settings.json'), '{ not json');
    expect(new SettingsStore(dir, () => toolchain()).get().javaPath).toBe('java');
  });

  describe('the unpacker', () => {
    const stored = (dir: string) => JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'));
    /** settings.json as the installers that came with unp64 wrote it: the unpacker pointed at their copy */
    const before = (patch: Partial<ToolchainSettings>) => {
      const dir = tmp(), bundled = join(tmp(), 'resources', 'unp64', 'unp64.exe');
      writeFileSync(join(dir, 'settings.json'), JSON.stringify({ ...toolchain({ unpackerPath: bundled, unpackerArgs: '{in} -x' }), ...patch, bundledUnpacker: bundled }));
      return { dir, bundled };
    };

    it('is Sindri, the built-in one, by default: no external unpacker is set', () => {
      expect(defaultToolchainSettings(null).unpackerPath).toBe('');
      const dir = tmp();
      expect(new SettingsStore(dir, () => toolchain(), null).get()).toMatchObject({ unpackerPath: '', unpackerArgs: '{in}' });
      // nothing is written before the user saves settings
      expect(existsSync(join(dir, 'settings.json'))).toBe(false);
    });

    it('leaves the unp64 an earlier installer came with, once, and keeps what the user picks', () => {
      const { dir } = before({});
      expect(new SettingsStore(dir, () => toolchain(), null).get()).toMatchObject({ unpackerPath: '', unpackerArgs: '{in}' });
      expect(stored(dir)).not.toHaveProperty('bundledUnpacker');
      new SettingsStore(dir, () => toolchain(), null).set({ unpackerPath: 'C:\\C64\\unp64\\unp64.exe' });
      expect(new SettingsStore(dir, () => toolchain(), null).get().unpackerPath).toBe('C:\\C64\\unp64\\unp64.exe');
    });

    it('keeps an external unpacker the user picked instead of the bundled unp64', () => {
      const { dir } = before({ unpackerPath: 'C:\\C64\\exomizer.exe', unpackerArgs: 'desfx -o {out} {in}' });
      expect(new SettingsStore(dir, () => toolchain(), null).get()).toMatchObject({ unpackerPath: 'C:\\C64\\exomizer.exe', unpackerArgs: 'desfx -o {out} {in}' });
      expect(stored(dir)).not.toHaveProperty('bundledUnpacker');
    });
  });
});

describe('the Exomizer that comes with the app', () => {
  const setup = () => {
    const root = tmp(), res = join(root, 'resources');
    mkdirSync(join(res, 'exomizer'), { recursive: true });
    writeFileSync(join(res, 'exomizer', process.platform === 'win32' ? 'exomizer.exe' : 'exomizer'), '');
    writeFileSync(join(root, 'exomizer.exe'), '');
    return { dir: tmp(), bundled: bundledExomizer(res)!, own: join(root, 'exomizer.exe') };
  };

  it('is found in resources\\exomizer and is the default', () => {
    const { dir, bundled } = setup();
    expect(bundled).toMatch(/[\\/]resources[\\/]exomizer[\\/]exomizer(\.exe)?$/);
    expect(bundledExomizer(tmp())).toBeNull();
    expect(bundledExomizer(undefined)).toBeNull();
    expect(defaultToolchainSettings(bundled).exomizerPath).toBe(bundled);
    // settings saved before Exomizer was a setting get the default
    writeFileSync(join(dir, 'settings.json'), JSON.stringify(toolchain()).replace(/,"exomizerPath":""/, ''));
    expect(new SettingsStore(dir, () => toolchain({ exomizerPath: bundled }), bundled).get().exomizerPath).toBe(bundled);
  });

  it('keeps another Exomizer and an empty setting, and replaces one that is gone', () => {
    const { dir, bundled, own } = setup();
    new SettingsStore(dir, () => toolchain(), null).set({ exomizerPath: own });
    expect(new SettingsStore(dir, () => toolchain(), bundled).get().exomizerPath).toBe(own);
    new SettingsStore(dir, () => toolchain(), null).set({ exomizerPath: '' });
    expect(new SettingsStore(dir, () => toolchain(), bundled).get().exomizerPath).toBe('');
    new SettingsStore(dir, () => toolchain(), null).set({ exomizerPath: join(tmp(), 'gone', 'exomizer.exe') });
    expect(new SettingsStore(dir, () => toolchain(), bundled).get().exomizerPath).toBe(bundled);
  });
});

describe('VICE quicksave snapshots', () => {
  const vsf = () => readFileSync(join(__dirname, '../../../fixtures/vsf/raster-demo.vsf'));

  it('looks where VICE writes them: C64SC.vsf and C64.vsf in its settings folder, or the file in Settings', () => {
    expect(viceConfigDir({ APPDATA: 'C:\\Users\\me\\AppData\\Roaming' }, 'win32', 'C:\\Users\\me')).toBe(join('C:\\Users\\me\\AppData\\Roaming', 'vice'));
    expect(viceConfigDir({}, 'linux', '/home/me')).toBe(join('/home/me', '.config', 'vice'));
    expect(viceConfigDir({ XDG_CONFIG_HOME: '/cfg' }, 'darwin', '/home/me')).toBe(join('/cfg', 'vice'));
    expect(quicksaveFiles('', '/v')).toEqual([join('/v', 'C64SC.vsf'), join('/v', 'C64.vsf')]);
    expect(quicksaveFiles('  D:\\snaps\\mine.vsf ', '/v')).toEqual(['D:\\snaps\\mine.vsf']);
  });

  it('opens the newest one as a snapshot, and says where VICE writes it when there is none', async () => {
    const dir = tmp(), files = quicksaveFiles('', dir);
    expect(await readQuicksave(files)).toEqual({ found: false, path: files[0] });
    expect(await quicksaveInfo(files)).toEqual({ found: false, path: files[0] });
    writeFileSync(files[1], vsf());
    expect(await quicksaveInfo(files)).toMatchObject({ found: true, path: files[1], saved: expect.any(Number) });
    const r = await readQuicksave(files);
    expect(r).toMatchObject({ found: true, path: files[1] });
    if (!r.found) throw new Error('not found');
    expect(r.files).toHaveLength(1);
    expect(r.files[0]).toMatchObject({ name: QUICKSAVE_FILE.replace(/\.vsf$/, '.prg'), load: 0x0200, start: 0x0810, entries: [0x08c7, 0x08b7] });
    expect(r.files[0].snapshot).toMatch(/^VICE 3\.10 snapshot/);
    const zp = await readQuicksave(files, { zeroPage: true });
    expect(zp.found && zp.files[0].load).toBe(0x0002);
    writeFileSync(files[0], 'not a snapshot');
    await expect(readQuicksave(files)).rejects.toThrow(/not a VICE snapshot/);
  });

  it('reports a new quicksave, once, when the file is written or created', async () => {
    const dir = tmp(), files = quicksaveFiles('', dir), seen: string[] = [];
    const w = new QuicksaveWatcher(e => seen.push(e.path), 50);
    try {
      w.watch(files);
      await new Promise(r => setTimeout(r, 200));
      writeFileSync(files[0], vsf());
      for (let i = 0; i < 40 && !seen.length; i++) await new Promise(r => setTimeout(r, 50));
      expect(seen).toEqual([files[0]]);
      // watching the same files again does not start over
      w.watch([...files]);
      await new Promise(r => setTimeout(r, 400));
      expect(seen).toEqual([files[0]]);
    } finally { w.close(); }
  });

  it('keeps the newest 5 with names of their own, each once, in a folder of the app\'s', async () => {
    const vice = tmp(), dir = join(tmp(), 'quicksaves'), qs = join(vice, 'C64SC.vsf');
    writeFileSync(qs, vsf());
    const h = new QuicksaveHistory(dir);
    const t0 = new Date(2026, 9, 29, 12, 43, 30).getTime();
    expect(await h.list()).toEqual([]);
    expect((await h.add(qs, t0))[0]).toMatchObject({ name: 'quicksave 2026-10-29 12:43:30', saved: t0, size: vsf().length });
    // the same save again is no new one
    expect(await h.add(qs, t0)).toHaveLength(1);
    for (let i = 1; i <= 5; i++) await h.add(qs, t0 + i * 1000);
    const list = await h.list();
    expect(list.map(e => e.saved)).toEqual([5, 4, 3, 2, 1].map(i => t0 + i * 1000));
    // the oldest one's file is gone with it
    expect(readdirSync(dir).filter(f => f.endsWith('.vsf'))).toHaveLength(5);
    const renamed = await h.rename(list[2].id, '  intro scroller ');
    expect(renamed[2].name).toBe('intro scroller');
    expect((await new QuicksaveHistory(dir).list())[2].name).toBe('intro scroller');
    const got = await h.get(list[2].id);
    expect([...got.bytes]).toEqual([...vsf()]);
    // not a whole snapshot (VICE still writing it, or another file): not kept
    writeFileSync(qs, 'VICE Snapshot File\x1a but no more');
    expect(await h.add(qs, t0 + 9000)).toHaveLength(5);
    await expect(h.get('zzzz')).rejects.toThrow(/no longer kept/);
    expect(() => h.file('../index')).toThrow();
    expect(quicksaveFileName('intro: part 2?')).toBe('intro- part 2-.vsf');
    expect(quicksaveName(t0)).toBe('quicksave 2026-10-29 12:43:30');
    expect(quicksaveEntrySchema.safeParse({ id: '../x' }).success).toBe(false);
    expect(quicksaveRenameSchema.safeParse({ id: 'abc', name: '   ' }).success).toBe(false);
  });

  it('keeps a favourite when VICE saves newer ones; one that is no favourite now goes like the others, at the next save', async () => {
    const vice = tmp(), dir = join(tmp(), 'quicksaves'), qs = join(vice, 'C64SC.vsf');
    writeFileSync(qs, vsf());
    const h = new QuicksaveHistory(dir);
    const t0 = new Date(2026, 9, 30, 9, 0, 0).getTime(), at = (i: number) => t0 + i * 1000;
    const [first] = await h.add(qs, at(0));
    expect((await h.favourite(first.id, true)).find(e => e.id === first.id)).toMatchObject({ favourite: true });
    for (let i = 1; i <= 7; i++) await h.add(qs, at(i));
    // the favourite and the newest 5 of the others
    let list = await h.list();
    expect(list.map(e => e.saved)).toEqual([7, 6, 5, 4, 3, 0].map(at));
    expect(list.filter(e => e.favourite).map(e => e.id)).toEqual([first.id]);
    expect(readdirSync(dir).filter(f => f.endsWith('.vsf'))).toHaveLength(6);
    // kept after a restart, with its name
    await h.rename(first.id, 'title screen');
    expect((await new QuicksaveHistory(dir).list()).find(e => e.id === first.id)).toMatchObject({ name: 'title screen', favourite: true });
    // no favourite now: still there until VICE saves a new one, then it goes, being older than the newest 5
    list = await h.favourite(first.id, false);
    expect(list).toHaveLength(6);
    expect(list.find(e => e.id === first.id)).not.toHaveProperty('favourite');
    list = await h.add(qs, at(8));
    expect(list.map(e => e.saved)).toEqual([8, 7, 6, 5, 4].map(at));
    expect(existsSync(h.file(first.id))).toBe(false);
    await expect(h.favourite(first.id, true)).rejects.toThrow(/no longer kept \(only the newest 5 and the favourites are\)/);
    // a newer one made a favourite and back stays: it is among the newest 5
    expect((await h.favourite(list[1].id, true)).filter(e => e.favourite)).toHaveLength(1);
    expect(await h.favourite(list[1].id, false)).toHaveLength(5);
    expect(await h.add(qs, at(9))).toHaveLength(5);
    expect(quicksaveFavouriteSchema.safeParse({ id: 'abc', on: true }).success).toBe(true);
    expect(quicksaveFavouriteSchema.safeParse({ id: 'abc' }).success).toBe(false);
  });
});

describe('schemas', () => {
  it('reads old project files that used "bytes" overrides', () => {
    const p = demoProject();
    const json = { ...serializeProject(p), overrides: [{ start: 0x0a00, end: 0x0a10, type: 'bytes' }] };
    const parsed = serializedProjectSchema.parse(JSON.parse(JSON.stringify(json)));
    expect(parsed.overrides[0].type).toBe('data');
  });

  it('reads comment lines and blocks, and older files without them', () => {
    const p = { ...demoProject(), notes: { 0x0810: { text: 'set up' }, 0x0900: { text: 'two\nlines', block: true } } };
    const json = JSON.parse(JSON.stringify(serializeProject(p)));
    expect(serializedProjectSchema.parse(json).notes).toEqual({ 2064: { text: 'set up' }, 2304: { text: 'two\nlines', block: true } });
    delete json.notes;
    expect(serializedProjectSchema.parse(json).notes).toEqual({});
    expect(projectSchema.safeParse(p).success).toBe(true);
    expect(projectSchema.safeParse({ ...p, notes: { 0x0810: 'not a note' } }).success).toBe(false);
  });

  it('reads an Assembler project\'s macro file (spec 10.8): kept as it is, one outside the folder left out', () => {
    const p = { ...demoProject(), asm: { lang: 'kickass' as const, main: 'src/main.asm', macros: { file: 'src/macros.asm', macros: ['Black'], collections: ['irq_lib'], called: false } } };
    const json = JSON.parse(JSON.stringify(serializeProject(p)));
    expect(deserializeProject(serializedProjectSchema.parse(json) as SerializedProject).asm!.macros).toEqual({ file: 'src/macros.asm', macros: ['Black'], collections: ['irq_lib'], called: false });
    json.asm.macros.file = '../macros.asm';
    expect(serializedProjectSchema.parse(json).asm?.macros).toBeUndefined();
    json.asm.macros = { file: 'src' };
    expect(serializedProjectSchema.parse(json).asm?.macros).toBeUndefined();
  });

  it('reads the user scripts with what their scratchpads hold, and older files without them', () => {
    const init = { a: 0x10, x: 3, p: 0x25, zp: [{ at: 0xfb, value: 0x0830, word: true }, { at: 0x02, value: 0x7f }] };
    const script = { id: 's1', name: 'decrypt', lang: 'kickass' as const, source: '* = $c000\nstart: rts', safe: true, init, pads: [{ name: 'pad1', start: 0xc800, size: 4, bytes: new Uint8Array([1, 2, 3, 4]) }, { name: 'pad2', start: 0xc900, size: 16, fill: 0xff, data: new Uint8Array([9, 8]), src: { form: 'hex' as const, text: '09 08' } }] };
    // what a run changed in the program: a patch that names the script
    const patch = { id: 'p1', name: 'decrypt', start: 0x0900, end: 0x0902, source: '.byte $01, $02', fill: 'keep' as const, over: false, bytes: new Uint8Array([1, 2]), old: new Uint8Array([3, 4]), script: 's1' };
    const p = { ...demoProject(), userScripts: [script], patches: [patch] };
    const json = JSON.parse(JSON.stringify(serializeProject(p)));
    const back = deserializeProject(serializedProjectSchema.parse(json) as SerializedProject);
    expect(back.userScripts?.[0]).toMatchObject({ id: 's1', name: 'decrypt', lang: 'kickass', source: script.source, safe: true, init, pads: [{ name: 'pad1', start: 0xc800, size: 4 }, { name: 'pad2', start: 0xc900, size: 16, fill: 0xff }] });
    expect(back.patches[0]).toMatchObject({ name: 'decrypt', script: 's1' });
    expect([...back.userScripts![0].pads[0].bytes!]).toEqual([1, 2, 3, 4]);
    // what a scratchpad starts with, and how the user wrote it
    expect([...back.userScripts![0].pads[1].data!]).toEqual([9, 8]);
    expect(back.userScripts![0].pads[1].src).toEqual({ form: 'hex', text: '09 08' });
    delete json.userScripts;
    expect(serializedProjectSchema.parse(json).userScripts).toBeUndefined();
    expect(projectSchema.safeParse(p).success).toBe(true);
    // a scratchpad past $ffff, or bytes not as many as it holds
    expect(projectSchema.safeParse({ ...p, userScripts: [{ ...script, pads: [{ name: 'x', start: 0xfff0, size: 0x20 }] }] }).success).toBe(false);
    expect(projectSchema.safeParse({ ...p, userScripts: [{ ...script, pads: [{ name: 'x', start: 0xc000, size: 8, bytes: new Uint8Array(4) }] }] }).success).toBe(false);
    // an init with a register past $ff, a zero-page word at $ff, or a byte with a word's value
    expect(projectSchema.safeParse({ ...p, userScripts: [{ ...script, init: { a: 0x100 } }] }).success).toBe(false);
    expect(projectSchema.safeParse({ ...p, userScripts: [{ ...script, init: { zp: [{ at: 0xff, value: 1, word: true }] } }] }).success).toBe(false);
    expect(projectSchema.safeParse({ ...p, userScripts: [{ ...script, init: { zp: [{ at: 0x10, value: 0x100 }] } }] }).success).toBe(false);
  });

  it('reads the empty lines the user inserted, and older files without them', () => {
    const p = { ...demoProject(), blanks: { 0x0810: 2, 0x0900: 1 } };
    const json = JSON.parse(JSON.stringify(serializeProject(p)));
    expect(serializedProjectSchema.parse(json).blanks).toEqual({ 2064: 2, 2304: 1 });
    delete json.blanks;
    expect(serializedProjectSchema.parse(json).blanks).toBeUndefined();
    expect(projectSchema.safeParse(p).success).toBe(true);
    for (const n of [0, -1, 1.5, 101, '2']) expect(projectSchema.safeParse({ ...p, blanks: { 0x0810: n } }).success, String(n)).toBe(false);
    // the empty lines under a comment line are kept with it
    const q = { ...p, notes: { 0x0810: { text: 'set up', below: 2 } } };
    expect(serializedProjectSchema.parse(JSON.parse(JSON.stringify(serializeProject(q)))).notes).toEqual({ 2064: { text: 'set up', below: 2 } });
    for (const n of [0, 101]) expect(projectSchema.safeParse({ ...p, notes: { 0x0810: { text: 'set up', below: n } } }).success, String(n)).toBe(false);
  });

  it('keeps the snapshot a file was opened from, saving and reading the project', () => {
    const vsf = Uint8Array.from([0x56, 0x49, 0x43, 0x45, 1, 2, 3]);
    const p = demoProject();
    p.files[0] = { ...p.files[0], vsf };
    const saved = projectSchema.parse(p);
    expect(saved.files[0].vsf).toEqual(vsf);
    const read = deserializeProject(serializedProjectSchema.parse(JSON.parse(JSON.stringify(serializeProject({ ...p, files: saved.files })))) as SerializedProject);
    expect(read.files[0].vsf).toEqual(vsf);
    expect(serializedProjectSchema.parse(JSON.parse(JSON.stringify(serializeProject(demoProject())))).files[0].vsf).toBeUndefined();
  });

  it('reads patches, and older files without them; the bytes written and written over go together', () => {
    const patch = { id: 'a1', name: 'red border', start: 0x091e, end: 0x0926, source: '  lda #$02\n  sta $d020', fill: 'nop' as const, over: false,
      bytes: Uint8Array.of(0xa9, 0x02, 0x8d, 0x20, 0xd0, 0xea, 0xea, 0xea), old: Uint8Array.of(0xad, 0x1b, 0xd4, 0x29, 0x0f, 0x8d, 0xe7, 0xdb) };
    const p = { ...demoProject(), patches: [patch] };
    expect(projectSchema.safeParse(p).success).toBe(true);
    expect(projectSchema.safeParse({ ...p, patches: [{ ...patch, old: patch.old.subarray(1) }] }).success).toBe(false);
    const json = JSON.parse(JSON.stringify(serializeProject(p)));
    const read = deserializeProject(serializedProjectSchema.parse(json) as SerializedProject);
    expect(read.patches.map(x => ({ ...x, id: 'a1' }))).toEqual([patch]);
    expect(serializedProjectSchema.safeParse({ ...json, patches: [{ ...json.patches[0], old: 'AAA=' }] }).success).toBe(false);
    // one switched off, one written with the cycle count kept, keeps that
    const off = JSON.parse(JSON.stringify(serializeProject({ ...p, patches: [{ ...patch, off: true, cycles: true }] })));
    expect(deserializeProject(serializedProjectSchema.parse(off) as SerializedProject).patches[0]).toMatchObject({ off: true, cycles: true });
    delete json.patches;
    expect(serializedProjectSchema.parse(json).patches).toEqual([]);
  });

  it('reads bank zones, and older files without them', () => {
    const p = { ...demoProject(), bankZones: [{ start: 0x0810, end: 0x0820, port: 0x34 }, { start: 0x0900, end: 0x0910, vicBank: 2 }, { start: 0x0810, end: 0x0818, port: null }] };
    const json = JSON.parse(JSON.stringify(serializeProject(p)));
    expect(serializedProjectSchema.parse(json).bankZones).toEqual(p.bankZones);
    delete json.bankZones;
    expect(serializedProjectSchema.parse(json).bankZones).toEqual([]);
    expect(projectSchema.safeParse(p).success).toBe(true);
    expect(projectSchema.safeParse({ ...p, bankZones: [{ start: 0, end: 1, vicBank: 4 }] }).success).toBe(false);
  });

  it('reads the program start, and older files without it', () => {
    const p = { ...demoProject(), entryPoint: 0x0866 };
    const json = JSON.parse(JSON.stringify(serializeProject(p)));
    expect(serializedProjectSchema.parse(json).entryPoint).toBe(0x0866);
    delete json.entryPoint;
    expect(serializedProjectSchema.parse(json).entryPoint).toBeNull();
    expect(projectSchema.safeParse(p).success).toBe(true);
    expect(projectSchema.safeParse({ ...p, entryPoint: -1 }).success).toBe(false);
    // a bank address of a cartridge's banks (spec 13.9b): $10000 is bank 1's $0000
    expect(projectSchema.safeParse({ ...p, entryPoint: 0x10000 }).success).toBe(true);
  });

  it('reads blocks excluded from the build, and older files without them', () => {
    const p = { ...demoProject(), excluded: [0x09b5, 0x1000] };
    const json = JSON.parse(JSON.stringify(serializeProject(p)));
    expect(serializedProjectSchema.parse(json).excluded).toEqual([0x09b5, 0x1000]);
    delete json.excluded;
    expect(serializedProjectSchema.parse(json).excluded).toEqual([]);
    expect(projectSchema.safeParse(p).success).toBe(true);
  });

  it('reads junk (spec 11.7), and older files without it; an empty area is refused', () => {
    const p = { ...demoProject(), junk: [{ start: 0x09b5, end: 0x0ab5 }, { start: 0x3000, end: 0x3800 }] };
    const json = JSON.parse(JSON.stringify(serializeProject(p)));
    expect(serializedProjectSchema.parse(json).junk).toEqual(p.junk);
    expect(projectSchema.safeParse(p).success).toBe(true);
    expect(serializedProjectSchema.parse(JSON.parse(JSON.stringify(serializeProject(demoProject())))).junk).toBeUndefined();
    expect(projectSchema.safeParse({ ...p, junk: [{ start: 0x3000, end: 0x3000 }] }).success).toBe(false);
  });

  it('reads view offsets (spec 10.4), and older files without them; an empty one is refused', () => {
    const p = { ...demoProject(), viewOffsets: [{ start: 0x1000, end: 0x1011, to: 0x2000 }] };
    const json = JSON.parse(JSON.stringify(serializeProject(p)));
    expect(serializedProjectSchema.parse(json).viewOffsets).toEqual(p.viewOffsets);
    expect(projectSchema.safeParse(p).success).toBe(true);
    expect(serializedProjectSchema.parse(JSON.parse(JSON.stringify(serializeProject(demoProject())))).viewOffsets).toBeUndefined();
    expect(projectSchema.safeParse({ ...p, viewOffsets: [{ start: 0x1000, end: 0x1000, to: 0x2000 }] }).success).toBe(false);
  });

  it('reads bookmarks, and older files without them', () => {
    const p = { ...demoProject(), bookmarks: { 0x0810: { title: 'init', text: 'set up\nthe screen' } } };
    const json = JSON.parse(JSON.stringify(serializeProject(p)));
    expect(serializedProjectSchema.parse(json).bookmarks).toEqual({ 2064: { title: 'init', text: 'set up\nthe screen' } });
    delete json.bookmarks;
    expect(serializedProjectSchema.parse(json).bookmarks).toEqual({});
    expect(projectSchema.safeParse(p).success).toBe(true);
    expect(projectSchema.safeParse({ ...p, bookmarks: { 0x0810: 'not a bookmark' } }).success).toBe(false);
    expect(projectSchema.safeParse({ ...p, bookmarks: { 0x0810: { title: 'x'.repeat(201), text: '' } } }).success).toBe(false);
  });

  it('reads bookmark colours: a preset by name or #rrggbb, and leaves out one it does not know', () => {
    const p = { ...demoProject(), bookmarks: { 0x0810: { title: 'a', text: '', color: 'teal' }, 0x0813: { title: 'b', text: '', color: '#3A9fe0' }, 0x0816: { title: 'c', text: '' } } };
    const json = JSON.parse(JSON.stringify(serializeProject(p)));
    expect(serializedProjectSchema.parse(json).bookmarks).toEqual(p.bookmarks);
    json.bookmarks[0x0810].color = 'chartreuse';
    json.bookmarks[0x0813].color = 'url(x)';
    expect(serializedProjectSchema.parse(json).bookmarks).toEqual({ 2064: { title: 'a', text: '' }, 2067: { title: 'b', text: '' }, 2070: { title: 'c', text: '' } });
    expect(projectSchema.parse({ ...p, bookmarks: { 0x0810: { title: 'a', text: '', color: '#12345' } } }).bookmarks).toEqual({ 2064: { title: 'a', text: '' } });
  });

  it('reads where the area of a bookmark ends, and leaves out an end that is no address', () => {
    const p = { ...demoProject(), bookmarks: { 0x0810: { title: 'a', text: '', end: 0x0820 }, 0x0900: { title: 'b', text: '', color: 'teal', end: 2 * 0x10000 + 0x8010 } } };
    const json = JSON.parse(JSON.stringify(serializeProject(p)));
    expect(serializedProjectSchema.parse(json).bookmarks).toEqual(p.bookmarks);
    json.bookmarks[0x0810].end = 'later';
    json.bookmarks[0x0900].end = 1.5;
    expect(serializedProjectSchema.parse(json).bookmarks).toEqual({ 2064: { title: 'a', text: '' }, 2304: { title: 'b', text: '', color: 'teal' } });
  });

  it('reads edited build scripts, and older files without them', () => {
    const p = { ...demoProject(), scripts: { 'build.sh': '#!/bin/sh\necho mine\n' } };
    const json = JSON.parse(JSON.stringify(serializeProject(p)));
    expect(serializedProjectSchema.parse(json).scripts).toEqual({ 'build.sh': '#!/bin/sh\necho mine\n' });
    delete json.scripts;
    expect(serializedProjectSchema.parse(json).scripts).toEqual({});
    expect(projectSchema.safeParse(p).success).toBe(true);
    // only the two build scripts can be replaced
    expect(projectSchema.safeParse({ ...p, scripts: { 'raster-demo.asm': 'nop' } }).success).toBe(false);
  });

  it('reads the build template, and older files without one', () => {
    const t = { name: 'Pack with Exomizer', builtIn: 'exomizer' as const, assembler: 'kick' as const, 'build.bat': '@echo off\n', 'build.sh': '#!/bin/sh\n' };
    const p = { ...demoProject(), buildTemplate: t };
    const json = JSON.parse(JSON.stringify(serializeProject(p)));
    expect(serializedProjectSchema.parse(json).buildTemplate).toEqual(t);
    expect(serializedProjectSchema.parse(JSON.parse(JSON.stringify(serializeProject(demoProject())))).buildTemplate).toBeUndefined();
    expect(projectSchema.safeParse(p).success).toBe(true);
    expect(projectSchema.safeParse({ ...p, buildTemplate: null }).success).toBe(true);
    // a name, the two scripts, nothing else
    expect(projectSchema.safeParse({ ...p, buildTemplate: { ...t, name: '' } }).success).toBe(false);
    expect(projectSchema.safeParse({ ...p, buildTemplate: { ...t, run: 'x' } }).success).toBe(false);
    expect(projectSchema.safeParse({ ...p, buildTemplate: { ...t, builtIn: 'brokkr' } }).success).toBe(false);
  });

  it('reads the pack settings, and older files without them', () => {
    const pack = { ...DEFAULT_PACK, ranges: [{ start: 0x0810, end: 0x1000 }], start: 'jmp' as const, jmp: 0x0810, ramExit: 0x35 };
    const p = { ...demoProject(), pack };
    const json = JSON.parse(JSON.stringify(serializeProject(p)));
    expect(serializedProjectSchema.parse(json).pack).toEqual(pack);
    expect(deserializeProject(serializedProjectSchema.parse(json) as SerializedProject).pack).toEqual(pack);
    delete json.pack;
    expect(serializedProjectSchema.parse(json).pack).toBeNull();
    expect(projectSchema.safeParse(p).success).toBe(true);
    expect(projectSchema.safeParse(demoProject()).success).toBe(true);
  });

  it('accepts what to pack, and refuses paths, -o and empty ranges', () => {
    const files = [{ name: 'game.prg', prg: Uint8Array.of(1, 8, 0) }];
    expect(packSchema.safeParse({ files, prefs: DEFAULT_PACK }).success).toBe(true);
    // project files from before Brokkr name no packer: they pack with Brokkr, at normal effort, in Exomizer's format
    // ... and from before the folder for the packed file: only the app's pack folder
    const { packer: _p, effort: _e, format: _f, dir: _d, ...old } = DEFAULT_PACK;
    expect(packSchema.parse({ files, prefs: old }).prefs).toMatchObject({ packer: 'brokkr', effort: 'normal', format: 'exomizer', dir: '' });
    expect(packFolderSchema.safeParse({ dir: 'C:/c64/out', ask: true }).success).toBe(true);
    expect(packFolderSchema.safeParse({ dir: '' }).success).toBe(false);
    expect(packSchema.safeParse({ files, prefs: { ...DEFAULT_PACK, format: 'brokkr' } }).success).toBe(true);
    expect(packSchema.safeParse({ files, prefs: { ...DEFAULT_PACK, format: 'fast' } }).success).toBe(true);
    // project files from before the decruncher's memory could be set have none of it: Brokkr places it all
    const { zp: _zp, decruncherAt: _at, tablesAt: _table, keep: _keep, ...unplaced } = DEFAULT_PACK;
    expect(packSchema.parse({ files, prefs: unplaced }).prefs).toMatchObject({ zp: null, decruncherAt: null, tablesAt: null, keep: [] });
    // ... and from before a file for each part: crunched data in one file, with the decruncher written next to it
    const { split: _split, decruncher: _dec, ...single } = DEFAULT_PACK;
    expect(packSchema.parse({ files, prefs: single }).prefs).toMatchObject({ split: false, decruncher: true });
    expect(packSchema.safeParse({ files, prefs: { ...DEFAULT_PACK, zp: 0x22, decruncherAt: 0xc000, tablesAt: 0xc400, keep: [{ start: 0x0334, end: 0x0400 }] } }).success).toBe(true);
    expect(packSchema.safeParse({ files, prefs: { ...DEFAULT_PACK, zp: 0x100 } }).success).toBe(false);
    expect(packSchema.safeParse({ files, prefs: { ...DEFAULT_PACK, keep: [{ start: 0xc000, end: 0xc000 }] } }).success).toBe(false);
    expect(packSchema.safeParse({ files, prefs: { ...DEFAULT_PACK, format: 'zx0' } }).success).toBe(false);
    // auto with a time to decrunch within; project files from before it have no time: any
    expect(packSchema.safeParse({ files, prefs: { ...DEFAULT_PACK, format: 'auto', maxSeconds: 2.5 } }).success).toBe(true);
    expect(packSchema.safeParse({ files, prefs: { ...DEFAULT_PACK, format: 'auto', maxSeconds: 0 } }).success).toBe(false);
    const { maxSeconds: _max, ...untimed } = DEFAULT_PACK;
    expect(packSchema.parse({ files, prefs: untimed }).prefs.maxSeconds).toBeNull();
    // Pack from: project files from before it have none, all of the build
    expect(packSchema.safeParse({ files, prefs: { ...DEFAULT_PACK, from: 0x0800 } }).success).toBe(true);
    expect(packSchema.safeParse({ files, prefs: { ...DEFAULT_PACK, from: 0x10000 } }).success).toBe(false);
    const { from: _from, ...whole } = DEFAULT_PACK;
    expect(packSchema.parse({ files, prefs: whole }).prefs.from).toBeNull();
    expect(packSchema.safeParse({ files, prefs: { ...DEFAULT_PACK, packer: 'zip' } }).success).toBe(false);
    expect(packSchema.safeParse({ files, prefs: { ...DEFAULT_PACK, effort: 'ultra' } }).success).toBe(false);
    expect(packSchema.safeParse({ files, prefs: { ...DEFAULT_PACK, extra: '-p 4 -Di_ram_during=$34' } }).success).toBe(true);
    for (const extra of ['-o x.prg', '-N C:\\x', 'a/b.prg', '-- x']) {
      const r = packSchema.safeParse({ files, prefs: { ...DEFAULT_PACK, extra } });
      expect(r.success, extra).toBe(false);
    }
    expect(packSchema.safeParse({ files, prefs: { ...DEFAULT_PACK, ranges: [{ start: 0x1000, end: 0x1000 }] } }).success).toBe(false);
    expect(packSchema.safeParse({ files, prefs: { ...DEFAULT_PACK, mode: 'raw' } }).success).toBe(false);
    expect(packSchema.safeParse({ files, prefs: { ...DEFAULT_PACK, shell: 'x' } }).success).toBe(false);
    expect(packSchema.safeParse({ files: [{ name: 'a.prg', prg: Uint8Array.of(1) }], prefs: DEFAULT_PACK }).success).toBe(false);
    expect(fileSaveSchema.safeParse({ name: 'game-exo.prg', bytes: Uint8Array.of(1, 8, 0) }).success).toBe(true);
    expect(fileSaveSchema.safeParse({ name: 'game-exo.prg', bytes: new Uint8Array(0) }).success).toBe(false);
  });

  it('sends DeepSID a PSID or RSID file under a plain .sid name', () => {
    const sid = makePsid(Uint8Array.of(0x4c, 0x00, 0x10, 0x60), 0x1000, 0x1000, 0x1003, 'demo 1000');
    expect(deepSidPlaySchema.safeParse({ name: 'music_1000-1a2b3c.sid', sid }).success).toBe(true);
    const rsid = sid.slice(); rsid[0] = 0x52;
    expect(deepSidPlaySchema.safeParse({ name: 'music_1000-1a2b3c.sid', sid: rsid }).success).toBe(true);
    for (const name of ['../music.sid', 'music.prg', 'a b.sid', 'C:\\x.sid', `${'x'.repeat(61)}.sid`, '.sid'])
      expect(deepSidPlaySchema.safeParse({ name, sid }).success, name).toBe(false);
    // a PRG is not a .sid
    expect(deepSidPlaySchema.safeParse({ name: 'music.sid', sid: new Uint8Array(0x200).fill(1) }).success).toBe(false);
  });

  it('accepts the format of the notes document, and older settings without it', () => {
    const p = demoProject();
    for (const notesFormat of ['html', 'txt', 'none']) expect(projectSchema.safeParse({ ...p, settings: { ...p.settings, notesFormat } }).success).toBe(true);
    expect(projectSchema.safeParse({ ...p, settings: { ...p.settings, notesFormat: 'pdf' } }).success).toBe(false);
    const json = JSON.parse(JSON.stringify(serializeProject(p)));
    delete json.settings.notesFormat;
    expect(serializedProjectSchema.parse(json).settings.notesFormat).toBeUndefined();
    expect(deserializeProject(serializedProjectSchema.parse(json) as SerializedProject).settings.notesFormat).toBe('html');
  });

  it('accepts a program start for Build & Run', () => {
    expect(runSchema.parse({ prgPath: 'C:/out/p.prg', start: 0x0866 }).start).toBe(0x0866);
    expect(runSchema.parse({ prgPath: 'C:/out/p.prg' }).start).toBeUndefined();
    expect(runSchema.safeParse({ prgPath: 'C:/out/p.prg', start: 0x10000 }).success).toBe(false);
    expect(runSchema.parse({ prgPath: 'C:/out/p.prg', disk: 'C:/tmp/disk.d64' }).disk).toBe('C:/tmp/disk.d64');
    expect(runSchema.safeParse({ prgPath: 'C:/out/p.prg', disk: '' }).success).toBe(false);
    expect(diskOpenSchema.parse(undefined)).toEqual({});
    // a tape for the datasette, and a .tap VICE autostarts
    expect(runSchema.parse({ prgPath: 'C:/out/p.prg', tape: 'C:/tmp/tape.tap' }).tape).toBe('C:/tmp/tape.tap');
    expect(runSchema.safeParse({ prgPath: 'C:/out/p.prg', tape: '' }).success).toBe(false);
    expect(tapeOpenSchema.parse(undefined)).toEqual({});
  });

  it('accepts a project with binary file data from the renderer', () => {
    expect(projectSchema.safeParse(demoProject()).success).toBe(true);
    expect(projectSchema.safeParse({ ...demoProject(), files: [{ id: 'x', name: 'a.prg', load: 0x0801, bytes: [1, 2, 3] }] }).success).toBe(false);
  });

  it('requires exactly one export destination', () => {
    expect(exportWriteSchema.safeParse({ target: 'temp', files: {} }).success).toBe(true);
    expect(exportWriteSchema.safeParse({ dir: 'C:\\out', files: {} }).success).toBe(true);
    expect(exportWriteSchema.safeParse({ files: {} }).success).toBe(false);
    expect(exportWriteSchema.safeParse({ dir: 'C:\\out', target: 'pick', files: {} }).success).toBe(false);
  });
});

describe('RecentFolders', () => {
  it('remembers the folder per dialog, falls back to the last one, and keeps them for the next start', () => {
    const store = tmp(), a = tmp(), b = tmp();
    const r = new RecentFolders(store);
    expect(r.folder('prg')).toBeUndefined();
    r.remember('prg', a);
    expect([r.folder('prg'), r.folder('disk')]).toEqual([a, a]);
    r.remember('disk', b);
    expect([r.folder('prg'), r.folder('disk'), r.folder('project')]).toEqual([a, b, b]);
    const again = new RecentFolders(store);
    expect([again.folder('prg'), again.folder('disk')]).toEqual([a, b]);
  });

  it('skips folders that are gone and survives a broken file', () => {
    const store = tmp(), a = tmp();
    const r = new RecentFolders(store);
    r.remember('prg', join(a, 'deleted'));
    expect(r.folder('prg')).toBeUndefined();
    writeFileSync(join(store, 'recent-folders.json'), '{ not json');
    expect(new RecentFolders(store).folder('prg')).toBeUndefined();
    writeFileSync(join(store, 'recent-folders.json'), JSON.stringify({ prg: 42 }));
    expect(new RecentFolders(store).folder('prg')).toBeUndefined();
  });
});

describe('Settings → Choose folder…', () => {
  const touch = (p: string) => { mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, ''); return p; };

  it('finds the program in the folder, in its bin or win32 folder, or one folder further down', () => {
    const vice = toolLook('vicePath', true), exo = toolLook('exomizerPath', true);
    const root = tmp();
    // a VICE zip unpacked into the folder: x64sc.exe in its bin folder, found from either folder
    const x64sc = touch(join(root, 'GTK3VICE-3.10-win64', 'bin', 'x64sc.exe'));
    expect(findInFolder(vice, join(root, 'GTK3VICE-3.10-win64'))).toBe(x64sc);
    expect(findInFolder(vice, root)).toBe(x64sc);
    expect(findInFolder(vice, join(root, 'GTK3VICE-3.10-win64', 'bin'))).toBe(x64sc);
    // the highest version first; one right in the folder before those further down
    touch(join(root, 'GTK3VICE-3.9-win64', 'bin', 'x64sc.exe'));
    expect(findInFolder(vice, root)).toBe(x64sc);
    const top = touch(join(root, 'x64sc.exe'));
    expect(findInFolder(vice, root)).toBe(top);
    // an Exomizer release keeps it in win32
    const e = touch(join(root, 'exomizer-3.1.1', 'win32', 'exomizer.exe'));
    expect(findInFolder(exo, root)).toBe(e);
    // not there: null (a folder with that name is not the program)
    const empty = tmp();
    mkdirSync(join(empty, 'x64sc.exe'));
    expect(findInFolder(vice, empty)).toBeNull();
    expect(findInFolder(vice, join(empty, 'gone'))).toBeNull();
  });

  it('looks for the file each setting is', () => {
    expect(toolLook('javaPath', true)).toMatchObject({ names: ['java.exe'], under: ['bin'] });
    expect(toolLook('javaPath', false).names).toEqual(['java']);
    expect(toolLook('kickJar', true)).toMatchObject({ names: ['KickAss.jar'], filter: { extensions: ['jar'] } });
    expect(toolLook('viceQuicksave', true).names).toEqual(['C64SC.vsf', 'C64.vsf']);
    expect(toolLook('unpackerPath', true).names).toEqual(['unp64.exe']);
    expect(toolLook('editorPath', true).names).toEqual(['subl.exe', 'Code.exe', 'notepad++.exe']);
    // the quicksave VICE x64sc writes is preferred over x64's; a JDK's java over nothing further down
    const dir = tmp();
    touch(join(dir, 'C64.vsf')); const sc = touch(join(dir, 'C64SC.vsf'));
    expect(findInFolder(toolLook('viceQuicksave', true), dir)).toBe(sc);
    const java = touch(join(dir, 'Java', 'jdk-21', 'bin', 'java.exe'));
    touch(join(dir, 'Java', 'jdk-17', 'bin', 'java.exe'));
    expect(findInFolder(toolLook('javaPath', true), join(dir, 'Java'))).toBe(java);
  });

  it('opens the dialog at the folder of the path set, above its bin folder', () => {
    const root = tmp();
    const x64sc = touch(join(root, 'vice', 'bin', 'x64sc.exe')), jar = touch(join(root, 'KickAssembler', 'KickAss.jar'));
    expect(startFolder(x64sc)).toBe(join(root, 'vice'));
    expect(startFolder(jar)).toBe(join(root, 'KickAssembler'));
    expect(startFolder(join(root, 'KickAssembler', 'gone.jar'))).toBe(join(root, 'KickAssembler'));
    expect(startFolder(join(root, 'vice'))).toBe(join(root, 'vice'));
    expect([startFolder(''), startFolder(undefined), startFolder('x64sc'), startFolder(join(root, 'gone', 'x64sc.exe'))]).toEqual([undefined, undefined, undefined, undefined]);
  });

  it('takes only the toolchain paths', () => {
    expect(locateSchema.parse({ key: 'vicePath', current: 'C:\\C64\\vice\\x64sc.exe' }).key).toBe('vicePath');
    for (const bad of [{ key: 'outDir' }, { key: 'kickArgs' }, { key: 'vicePath', extra: 1 }, { key: 'vicePath', current: 'x'.repeat(1025) }, {}])
      expect(locateSchema.safeParse(bad).success).toBe(false);
  });
});

describe('projects', () => {
  it('check a name the way Windows takes a folder name', () => {
    expect(projectNameProblem('raster demo')).toBeNull();
    expect(projectNameProblem('my-demo_2')).toBeNull();
    for (const bad of ['', '   ', 'a:b', 'a/b', 'a\\b', 'what?', 'end.', 'CON', 'lpt1', 'nul.txt', 'x'.repeat(81)]) expect(projectNameProblem(bad), bad).not.toBeNull();
    expect(projectNameOf(join('C:', 'p', 'raster', 'raster.mimir.json'))).toBe('raster');
    expect(projectNameOf('old.json')).toBe('old');
  });

  it('remember what was worked on last and the projects opened last, for the next start', () => {
    const store = tmp(), docs = tmp(), a = tmp(), b = tmp();
    const p = new ProjectStore(store, docs);
    expect(p.start()).toEqual({ last: null, resume: null, recent: [], parent: join(docs, 'Mimir') });
    const ha = homeOf(join(a, 'a.mimir.json')), hb = homeOf(join(b, 'b.mimir.json'));
    writeFileSync(ha.file, '{}');
    p.enter(ha);
    p.enter(hb);
    p.enter(ha);
    expect(p.current).toEqual(ha);
    // a reloaded window goes on with it; the next start offers it
    expect(p.start()).toMatchObject({ last: { kind: 'project', home: ha, exists: true }, resume: { kind: 'project', home: ha } });
    const again = new ProjectStore(store, docs);
    expect(again.start()).toMatchObject({ last: { kind: 'project', home: ha, exists: true }, resume: null });
    expect(again.recent().map(r => [r.name, r.exists])).toEqual([['a', true], ['b', false]]);
    expect(again.isRecent(hb.file.toUpperCase())).toBe(true);
    expect(again.isRecent(join(a, 'other.mimir.json'))).toBe(false);
    again.unsaved();
    expect(again.current).toBeNull();
    expect(again.start()).toMatchObject({ last: { kind: 'unsaved' }, resume: { kind: 'unsaved' } });
    expect(again.forget(hb.file).map(r => r.name)).toEqual(['a']);
    for (let i = 0; i < RECENT_PROJECTS + 3; i++) again.enter(homeOf(join(a, `p${i}`, `p${i}.mimir.json`)));
    expect(again.recent()).toHaveLength(RECENT_PROJECTS);
    // where new projects go: the documents folder's Mimir, else where the last one went (while it is there)
    again.rememberParent(b);
    expect(new ProjectStore(store, docs).parent()).toBe(b);
    again.rememberParent(join(b, 'gone'));
    expect(new ProjectStore(store, docs).parent()).toBe(join(docs, 'Mimir'));
    writeFileSync(join(store, 'projects.json'), '{ not json');
    expect(new ProjectStore(store, docs).start()).toMatchObject({ last: null, recent: [] });
  });

  it('open the folder dialog where a folder is: the suggested one, or the nearest above it before it is made', () => {
    const docs = tmp();
    expect(nearestFolder(docs)).toBe(docs);
    expect(nearestFolder(join(docs, 'Mimir'))).toBe(docs);
    expect(nearestFolder(join(docs, 'Mimir', 'deeper', 'still'))).toBe(docs);
    expect(nearestFolder(new ProjectStore(tmp(), docs).parent())).toBe(docs);
  });

  it('give the project of this run its folders for the export, the build and the packed file', () => {
    const p = new ProjectStore(tmp(), tmp()), dir = tmp();
    expect(p.folder('build')).toBeNull();
    p.enter(homeOf(join(dir, 'x.mimir.json')));
    expect(p.folder('source')).toBe(join(dir, 'source'));
    expect([existsSync(join(dir, 'source')), existsSync(join(dir, 'build'))]).toEqual([true, false]);
  });

  it("make a project's folder, never over a project of that name", async () => {
    const parent = tmp();
    const home = await createProjectFolder(parent, ' raster ');
    expect(home).toEqual({ name: 'raster', dir: join(parent, 'raster'), file: join(parent, 'raster', 'raster.mimir.json') });
    expect(existsSync(home.dir)).toBe(true);
    writeFileSync(home.file, '{}');
    await expect(createProjectFolder(parent, 'raster')).rejects.toThrow(/There is a project called raster/);
    await expect(createProjectFolder(parent, 'a|b')).rejects.toThrow(/cannot have/);
    // a folder that is there without a project in it takes one
    mkdirSync(join(parent, 'empty'));
    expect((await createProjectFolder(parent, 'empty')).dir).toBe(join(parent, 'empty'));
  });

  it("move the work without a project into it: the export copied, the app's own build and pack folders moved", async () => {
    const home = await createProjectFolder(tmp(), 'moved');
    const exportDir = join(tmp(), 'export');
    mkdirSync(exportDir);
    writeFileSync(join(exportDir, 'main.asm'), '; mine');
    mkdirSync(join(exportDir, 'include'));
    writeFileSync(join(exportDir, 'include', 'hw.asm'), '; hw');
    const buildDir = mkdtempSync(join(tmpdir(), 'mimir-build-'));
    writeFileSync(join(buildDir, 'main.prg'), new Uint8Array([1, 8, 96]));
    const packDir = mkdtempSync(join(tmpdir(), 'mimir-pack-'));
    writeFileSync(join(packDir, 'main-exo.prg'), new Uint8Array([1, 8, 0]));
    expect([isOwnTemp(buildDir), isOwnTemp(exportDir), isOwnTemp(join(buildDir, 'sub'))]).toEqual([true, false, false]);

    const moved = await gatherWork(home, { exportDir, buildDir, packed: join(packDir, 'main-exo.prg') });
    expect(moved).toEqual({ source: join(home.dir, 'source'), build: join(home.dir, 'build'), packed: join(home.dir, 'packed', 'main-exo.prg') });
    expect(readFileSync(join(home.dir, 'source', 'include', 'hw.asm'), 'utf8')).toBe('; hw');
    expect([...readFileSync(join(home.dir, 'build', 'main.prg'))]).toEqual([1, 8, 96]);
    expect(existsSync(moved.packed!)).toBe(true);
    // the folder the user picked stays; the app's own temp folders are gone
    expect(existsSync(join(exportDir, 'main.asm'))).toBe(true);
    expect([existsSync(buildDir), existsSync(packDir)]).toEqual([false, false]);
    // nothing to move: nothing moves
    expect(await gatherWork(await createProjectFolder(tmp(), 'empty'), {})).toEqual({});
  });
});

describe('settings from before the rename', () => {
  it('come along once from the old folder into the app\'s own, not into a profile of its own', () => {
    const appData = tmp(), old = join(appData, '@kickreasm', 'desktop'), now = join(appData, '@mimir', 'desktop');
    mkdirSync(join(old, 'Local Storage', 'leveldb'), { recursive: true });
    writeFileSync(join(old, 'settings.json'), '{"kickJar":"C:\\\\C64\\\\KickAss.jar"}');
    writeFileSync(join(old, 'recent-folders.json'), '{}');
    writeFileSync(join(old, 'Local Storage', 'leveldb', '000003.log'), 'ui');
    mkdirSync(join(old, 'Cache'));
    // a test's own profile is left alone
    expect(bringOldSettings(appData, join(appData, 'e2e-profile'), '@mimir/desktop')).toEqual([]);
    expect(bringOldSettings(appData, now, '@mimir/desktop')).toEqual(['settings.json', 'recent-folders.json', 'Local Storage']);
    expect(readFileSync(join(now, 'settings.json'), 'utf8')).toContain('KickAss.jar');
    expect(existsSync(join(now, 'Local Storage', 'leveldb', '000003.log'))).toBe(true);
    expect(existsSync(join(now, 'Cache'))).toBe(false);
    // once: what the app has saved since stays
    writeFileSync(join(now, 'settings.json'), '{}');
    expect(bringOldSettings(appData, now, '@mimir/desktop')).toEqual([]);
    expect(readFileSync(join(now, 'settings.json'), 'utf8')).toBe('{}');
  });
});

describe('project files', () => {
  it('round-trips a project through .mimir.json', async () => {
    const path = join(tmp(), 'demo.mimir.json');
    const p = { ...demoProject(), labels: { 0x0810: 'main' } };
    await writeProjectFile(path, p);
    const back = await readProjectFile(path);
    expect(back.files[0].bytes).toEqual(p.files[0].bytes);
    expect(back.labels).toEqual({ 2064: 'main' });
    expect(JSON.parse(readFileSync(path, 'utf8')).format).toBe('mimir-project');
  });

  it('saves and opens a new project, which has no files yet', async () => {
    const path = join(tmp(), 'new.mimir.json');
    const p = createProject({ name: 'new', files: [] });
    expect(projectSchema.safeParse(p).success).toBe(true);
    await writeProjectFile(path, p);
    expect(await readProjectFile(path)).toMatchObject({ name: 'new', files: [] });
  });

  it('opens a project saved before the rename (KickReasm Studio, .krproj.json), and saves it as Mimir Studio does', async () => {
    const dir = tmp(), path = join(dir, 'old.krproj.json');
    writeFileSync(path, JSON.stringify({ ...serializeProject({ ...demoProject(), name: 'old' }), format: LEGACY_PROJECT_FORMAT }));
    const back = await readProjectFile(path);
    expect(back.name).toBe('old');
    expect(back.format).toBe('mimir-project');
    await writeProjectFile(join(dir, 'old.mimir.json'), back);
    expect(JSON.parse(readFileSync(join(dir, 'old.mimir.json'), 'utf8')).format).toBe('mimir-project');
  });

  it('rejects files that are not projects', async () => {
    const path = join(tmp(), 'nope.json');
    writeFileSync(path, JSON.stringify({ hello: 1 }));
    await expect(readProjectFile(path)).rejects.toThrow(/not a Mimir project/);
  });

  it('opens PRGs and VICE snapshots, the snapshot as its RAM from $0200 with its entry points', async () => {
    const [snap, prg] = await readPrgFiles([join(__dirname, '../../../fixtures/vsf/raster-demo.vsf'), join(__dirname, '../../../fixtures/prg/raster-demo.prg')]);
    expect(snap).toMatchObject({ name: 'raster-demo.prg', load: 0x0200, entries: [0x08c7, 0x08b7], start: 0x0810, snapshot: 'VICE 3.10 snapshot of a C64SC, PC $08c7, $01 = $37' });
    expect(snap.bytes.length).toBe(0xfe00);
    expect(snap.id).toBeTruthy();
    expect(prg).toMatchObject({ name: 'raster-demo.prg', load: 0x0801 });
    expect(prg.entries).toBeUndefined();
    // the zero page and the stack too, when asked
    const [zp] = await readPrgFiles([join(__dirname, '../../../fixtures/vsf/raster-demo.vsf')], { zeroPage: true });
    expect(zp).toMatchObject({ load: 0x0002, start: 0x0810 });
    expect(zp.bytes.length).toBe(0xfffe);
    expect(prgOpenSchema.parse({ zeroPage: true })).toEqual({ zeroPage: true });
    // the File menu's choices: what the dialog asks for
    for (const kind of ['prg', 'crt', 'vsf', 'add'] as const) expect(prgOpenSchema.parse({ kind })).toEqual({ kind });
    expect(() => prgOpenSchema.parse({ kind: 'd64' })).toThrow();
  });

  it('Smart attach opens each file as its extension says, a project or one source by itself', () => {
    expect(['a.prg', 'B.PRG', 'x.vsf', 'cart.CRT', 'disk.d64', 'demo.mimir.json', 'my border.asm', 'C:\\c64\\intro.Asm', 'noext', 'data.bin', 'game.p00', 'odd.prg.d64', 'game.TAP'].map(smartKind))
      .toEqual(['prg', 'prg', 'vsf', 'crt', 'd64', 'project', 'asm', 'asm', 'prg', 'prg', 'prg', 'd64', 'tap']);
    // a G64 (GCR tracks, copy protection and all) is mounted as a disk too
    expect(smartKind('Arctic Fox.G64')).toBe('d64');
    // a T64 tape archive goes in the datasette as a TAP does
    expect(smartKind('Paradroid.T64')).toBe('tap');
    // PRGs, snapshots and cartridges together, one disk, one tape and one source; the others are left with why
    expect(smartPlan(['a.prg', 'one.d64', 'x.vsf', 'two.d64', 'a.asm', 'b.asm', 'c.crt', 'one.tap', 'two.tap', 'three.t64'])).toEqual({
      project: null, asm: 'a.asm', disk: 'one.d64', tape: 'one.tap', files: ['a.prg', 'x.vsf', 'c.crt'],
      left: [{ path: 'two.d64', why: 'one disk is mounted at a time' }, { path: 'b.asm', why: 'Brokkr packs one source at a time' }, { path: 'two.tap', why: 'one tape is in the datasette at a time' }, { path: 'three.t64', why: 'one tape is in the datasette at a time' }],
    });
    // a project takes the place of the work: it opens by itself
    expect(smartPlan(['a.prg', 'demo.mimir.json', 'a.asm'])).toEqual({
      project: 'demo.mimir.json', asm: null, disk: null, tape: null, files: [],
      left: [{ path: 'a.prg', why: 'a project opens by itself' }, { path: 'a.asm', why: 'a project opens by itself' }],
    });
    expect(smartAttachSchema.parse(undefined)).toEqual({});
    expect(smartAttachSchema.parse({ zeroPage: true })).toEqual({ zeroPage: true });
    expect(() => smartAttachSchema.parse({ paths: ['C:\\x.prg'] })).toThrow();
  });

  it('opens a cartridge as every chip, each with the image, which the project schemas keep with work at bank addresses', async () => {
    const path = join(__dirname, '../../../fixtures/crt/mimir-demo.crt'), crt = new Uint8Array(readFileSync(path));
    const opened = await readPrgFiles([path]);
    expect(opened.map(f => [f.name, f.load, f.bytes.length, f.chip])).toEqual([['bank00_8000.prg', 0x8000, 0x2000, 0], ['bank01_8000.prg', 0x8000, 0x2000, 1]]);
    expect(opened[0].cart).toEqual({ name: 'mimir-demo.crt', crt });
    expect(opened[1].cart).toBe(opened[0].cart);
    const p = createProject({ files: opened, cart: opened[0].cart });
    const saved = projectSchema.parse(p);
    expect(saved.cart?.crt).toEqual(crt);
    expect(saved.files[0].chip).toBe(0);
    const read = deserializeProject(serializedProjectSchema.parse(JSON.parse(JSON.stringify(serializeProject(p)))) as SerializedProject);
    expect(read.cart?.crt).toEqual(crt);
    expect(read.files[0].chip).toBe(0);
    expect(() => projectSchema.parse({ ...p, cart: { name: 'x.crt', crt: new Uint8Array(10) } })).toThrow(/not a cartridge image/);
    // a label, an override and the program start in bank 1 (spec 13.9b: $1:8000 is $18000)
    const banked = { ...p, labels: { 0x18000: 'text' }, overrides: [{ start: 0x18000, end: 0x18010, type: 'text' as const }], entryPoint: 0x18000 };
    expect(projectSchema.parse(banked).overrides[0].start).toBe(0x18000);
    expect(serializedProjectSchema.parse(JSON.parse(JSON.stringify(serializeProject(banked)))).entryPoint).toBe(0x18000);
    expect(runSchema.parse({ prgPath: 'c.crt', cart: true })).toEqual({ prgPath: 'c.crt', cart: true });
  });

  it('reads .d64 and .g64 disk images and refuses anything else', async () => {
    const dir = tmp(), disk = join(dir, 'disk.d64'), big = join(dir, 'big.d64'), odd = join(dir, 'odd.d64'), prg = join(dir, 'p.d64'), gcr = join(dir, 'disk.g64');
    writeFileSync(disk, makeD64({ name: 'test', files: [{ name: 'a', data: Uint8Array.from([1, 8, 0x60]) }] }));
    writeFileSync(big, new Uint8Array(2_000_000));
    writeFileSync(odd, new Uint8Array(300000));
    writeFileSync(prg, Uint8Array.from([1, 8, 0x60]));
    // a G64 with its tables and no tracks: its sectors all read as errors, and it has no files
    const g64 = new Uint8Array(12 + 84 * 8);
    g64.set([...'GCR-1541'].map(c => c.charCodeAt(0)));
    g64[9] = 84;
    writeFileSync(gcr, g64);
    const r = await readDiskImage(disk);
    expect(r).toMatchObject({ path: disk, name: 'disk.d64', sides: [] });
    expect(r.bytes.length).toBe(174848);
    expect(await readDiskImage(gcr)).toMatchObject({ path: gcr, name: 'disk.g64' });
    await expect(readDiskImage(big)).rejects.toThrow(/big\.d64 is not a \.d64 or \.g64 disk image \(2000000 bytes\)/);
    await expect(readDiskImage(odd)).rejects.toThrow(/not a \.d64 or \.g64 disk image: 300000 bytes/);
    await expect(readDiskImage(prg)).rejects.toThrow(/not a \.d64 or \.g64 disk image: 3 bytes/);
  });

  it('reads the release\'s next sides from the disk\'s folder, in order, and leaves out what is not a disk image', async () => {
    const dir = tmp(), side = (n: string) => makeD64({ name: n, files: [{ name: 'a', data: Uint8Array.from([1, 8, 0x60]) }] });
    writeFileSync(join(dir, 'demo_side1.d64'), side('one'));
    writeFileSync(join(dir, 'demo_side3.d64'), side('three'));
    writeFileSync(join(dir, 'demo_side2.d64'), side('two'));
    writeFileSync(join(dir, 'demo_side4.d64'), new Uint8Array(300000));
    writeFileSync(join(dir, 'other_side2.d64'), side('other'));
    const r = await readDiskImage(join(dir, 'demo_side1.d64'));
    expect(r.sides.map(s => s.name)).toEqual(['demo_side2.d64', 'demo_side3.d64']);
    expect(r.sides[0].bytes).toEqual(side('two'));
    expect((await readDiskImage(join(dir, 'demo_side3.d64'))).sides).toEqual([]);
  });
});

const jar = process.env.KICKASS_JAR || findKickAssJar();
const javaOk = !!jar && spawnSync('java', ['-version'], { windowsHide: true }).status === 0;

/** the Exomizer the installer bundles (apps/desktop/vendor/exomizer), on Windows */
const vendorExo = process.platform === 'win32' && existsSync(join(__dirname, '..', 'vendor', 'exomizer', 'exomizer.exe')) ? join(__dirname, '..', 'vendor', 'exomizer', 'exomizer.exe') : null;

/** the 64tass the installer bundles (apps/desktop/vendor/64tass), on Windows */
const vendorTass = process.platform === 'win32' && existsSync(join(__dirname, '..', 'vendor', '64tass', '64tass.exe')) ? join(__dirname, '..', 'vendor', '64tass', '64tass.exe') : null;

describe('toolchain runner', () => {
  it('reports a missing KickAss.jar as a problem instead of failing', async () => {
    const dir = tmp(); const policy = new PathPolicy(); policy.allow(dir);
    const r = await buildWithAssembler({ dir, entries: ['x.asm'] }, toolchain({ kickJar: join(dir, 'missing.jar') }), policy);
    expect(r.ok).toBe(false);
    expect(r.problems[0].message).toMatch(/KickAss\.jar not found/);
  });

  it('refuses folders outside the policy', async () => {
    await expect(buildWithAssembler({ dir: tmp(), entries: ['x.asm'] }, toolchain(), new PathPolicy())).rejects.toThrow(/outside the folders/);
  });

  it.skipIf(!javaOk)('builds the demo with the real KickAss.jar byte-identical', async () => {
    const p = demoProject();
    const A = analyze(p), R = render(A, p);
    const dir = tmp(); const policy = new PathPolicy(); policy.allow(dir);
    await writeVfs(dir, R.files);
    const r = await buildWithAssembler({ dir, entries: ['raster-demo.asm'] }, toolchain({ kickJar: jar! }), policy);
    expect(r.problems).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.commands[0]).toEqual(['java', '-jar', jar, 'raster-demo.asm', '-odir', 'out', '-vicesymbols', '-showmem']);
    expect(r.prg!.subarray(2)).toEqual(p.files[0].bytes);
    expect(r.outputs[0].vsPath).not.toBeNull();
  }, 60_000);

  it('reports a missing 64tass as a problem, and builds the demo written for 64tass with the bundled one byte-identical', async () => {
    const dir = tmp(); const policy = new PathPolicy(); policy.allow(dir);
    const none = await buildWithAssembler({ dir, entries: ['x.asm'], assembler: '64tass' }, toolchain({ tassPath: join(dir, '64tass.exe') }), policy);
    expect(none.ok).toBe(false);
    expect(none.problems[0].message).toMatch(/64tass not found/);
    if (!vendorTass) return;
    const p = demoProject(), q = { ...p, settings: { ...p.settings, assembler: '64tass' as const } };
    await writeVfs(dir, render(analyze(q), q).files);
    const r = await buildWithAssembler({ dir, entries: ['raster-demo.asm'], assembler: '64tass' }, toolchain({ tassPath: vendorTass }), policy);
    expect(r.problems).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.commands[0]).toEqual([vendorTass, '-a', '-C', '--cbm-prg', '-o', 'out/raster-demo.prg', '--vice-labels', '-l', 'out/raster-demo.vs', 'raster-demo.asm']);
    expect(r.prg!.subarray(2)).toEqual(p.files[0].bytes);
    expect(r.outputs[0].vsPath).not.toBeNull();
  }, 60_000);

  it('opens the export in the editor of the settings, else the first found, once its source is there', async () => {
    const found = [{ name: 'Sublime Text', path: 'C:\\Program Files\\Sublime Text\\subl.exe' }, { name: 'Visual Studio Code', path: 'C:\\VS Code\\Code.exe' }];
    expect(currentEditor(toolchain(), found)).toEqual(found[0]);
    expect(currentEditor(toolchain({ editorPath: ' C:\\VS Code\\bin\\code.cmd ' }), found)).toEqual({ name: 'Visual Studio Code', path: 'C:\\VS Code\\bin\\code.cmd' });
    expect(currentEditor(toolchain(), [])).toBeNull();
    const dir = tmp();
    // nothing exported there yet: nothing is started
    expect(await openInEditor(dir, 'demo.asm', toolchain(), [])).toEqual({ opened: false, dir });
    writeFileSync(join(dir, 'demo.asm'), '');
    await expect(openInEditor(dir, 'demo.asm', toolchain(), [])).rejects.toThrow(/No external editor was found/);
    await expect(openInEditor(dir, 'demo.asm', toolchain({ editorPath: join(dir, 'subl.exe') }), [])).rejects.toThrow(/subl\.exe/);
  });

  it('starts the editor with the folder and the file, detached', async () => {
    // the editor is this Node, writing what it was given into the folder
    const dir = tmp(), script = "require('fs').writeFileSync(require('path').join(process.argv[1],'argv.json'),JSON.stringify(process.argv.slice(1)))";
    writeFileSync(join(dir, 'demo.asm'), '');
    expect(await openInEditor(dir, 'demo.asm', toolchain({ editorPath: process.execPath, editorArgs: `-e "${script}" {dir} {file}` }), [])).toMatchObject({ opened: true, dir, file: 'demo.asm' });
    await expect.poll(() => existsSync(join(dir, 'argv.json')), { timeout: 10_000 }).toBe(true);
    expect(JSON.parse(readFileSync(join(dir, 'argv.json'), 'utf8'))).toEqual([dir, join(dir, 'demo.asm')]);
  });

  it('takes a plain .asm name to open in the editor', () => {
    expect(editorOpenSchema.parse({ file: 'demo.asm' })).toEqual({ file: 'demo.asm' });
    expect(editorOpenSchema.parse({ dir: 'C:\\w', file: 'demo.asm' })).toEqual({ dir: 'C:\\w', file: 'demo.asm' });
    expect(() => editorOpenSchema.parse({ file: 'demo.asm', exe: 'calc.exe' })).toThrow();
    expect(() => editorOpenSchema.parse({})).toThrow();
  });

  it('needs an Exomizer that exists', async () => {
    const req = { files: [{ name: 'game.prg', prg: Uint8Array.of(1, 8, 0) }], prefs: DEFAULT_PACK };
    await expect(packWithExomizer(req, toolchain(), new PathPolicy())).rejects.toThrow(/No Exomizer is set/);
    await expect(packWithExomizer(req, toolchain({ exomizerPath: join(tmp(), 'exomizer.exe') }), new PathPolicy())).rejects.toThrow(/Exomizer not found/);
  });

  it.skipIf(!vendorExo)('packs the demo with the bundled Exomizer in a pack folder the session may run', async () => {
    const p = demoProject(), policy = new PathPolicy();
    const prg = Uint8Array.from([p.files[0].load & 0xff, p.files[0].load >> 8, ...p.files[0].bytes]);
    const r = await packWithExomizer({ files: [{ name: 'raster-demo.prg', prg }], prefs: { ...DEFAULT_PACK, packer: 'exomizer' } }, toolchain({ exomizerPath: vendorExo! }), policy);
    expect(r.error).toBeUndefined();
    expect(r).toMatchObject({ ok: true, name: 'raster-demo-exo.prg', check: { status: 'same' } });
    expect(r.path).toBe(join(r.dir, 'raster-demo-exo.prg'));
    expect(readFileSync(r.path!)).toEqual(Buffer.from(r.prg!));
    expect(policy.isAllowed(r.path!)).toBe(true);
    expect(r.prg!.length).toBeLessThan(prg.length);
  });

  it('packs the demo with Brokkr in a pack folder the session may run, with the inputs its command names', async () => {
    const p = demoProject(), policy = new PathPolicy();
    const prg = Uint8Array.from([p.files[0].load & 0xff, p.files[0].load >> 8, ...p.files[0].bytes]);
    // the worker thread is the built app's (out/main/brokkr-worker.js); here Brokkr runs in the test
    const r = await packWithBrokkr({ files: [{ name: 'raster-demo.prg', prg }], prefs: DEFAULT_PACK }, policy, req => packWithBrokkrCore(req.files, req.prefs));
    expect(r.error).toBeUndefined();
    expect(r).toMatchObject({ ok: true, name: 'raster-demo-brokkr.prg', check: { status: 'same' } });
    expect(r.argv).toEqual(['brokkr', 'sfx', '--start', 'sys', '-o', 'raster-demo-brokkr.prg', 'raster-demo.prg']);
    expect(readFileSync(r.path!)).toEqual(Buffer.from(r.prg!));
    expect(readFileSync(join(r.dir, 'raster-demo.prg'))).toEqual(Buffer.from(prg));
    expect(policy.isAllowed(r.path!)).toBe(true);
    expect(r.prg!.length).toBeLessThan(prg.length);
  });

  it('writes the packed file to the folder the Pack view names too, and points the result at it', async () => {
    const p = demoProject(), policy = new PathPolicy(), out = tmp();
    const prg = Uint8Array.from([p.files[0].load & 0xff, p.files[0].load >> 8, ...p.files[0].bytes]);
    const req = { files: [{ name: 'raster-demo.prg', prg }], prefs: { ...DEFAULT_PACK, dir: out } };
    const r = await keepPacked(await packWithBrokkr(req, policy, q => packWithBrokkrCore(q.files, q.prefs)), out);
    expect(r.path).toBe(join(out, 'raster-demo-brokkr.prg'));
    expect(readFileSync(r.path!)).toEqual(Buffer.from(r.prg!));
    // the pack folder keeps its copy and the inputs, for the command shown
    expect(readFileSync(join(r.dir, 'raster-demo-brokkr.prg'))).toEqual(Buffer.from(r.prg!));
    // a failed pack writes nothing there
    const failed = await keepPacked({ ...r, ok: false, name: 'other.prg' }, out);
    expect(existsSync(join(out, 'other.prg'))).toBe(false);
    expect(failed.path).toBe(r.path);
  });

  it("leaves what a failed check in Brokkr's emulated C64 had in the pack folder, with the program, for a report", async () => {
    const policy = new PathPolicy(), prg = Uint8Array.of(0x01, 0x08, 0x60);
    const dump = [{ name: 'brokkr-check-file.prg', prg: Uint8Array.of(0x01, 0x08, 1, 2) }, { name: 'brokkr-check-memory.bin', prg: new Uint8Array(0x10000) }];
    const r = await packWithBrokkr({ files: [{ name: 'game.prg', prg }], prefs: DEFAULT_PACK }, policy, async () => ({
      ok: false, output: '', argv: [], commands: [], ms: 0, inputs: [{ name: 'game.prg', prg }], packed: null, check: null, error: 'BRK-E910',
      report: { crunched: null, saved: null, layout: [], decruncher: [], entry: null, errors: [] }, dump,
    }));
    expect(r.ok).toBe(false);
    for (const f of [{ name: 'game.prg', prg }, ...dump]) expect(readFileSync(join(r.dir, f.name))).toEqual(Buffer.from(f.prg));
  });

  it('writes crunched data in a file for each block, and the decruncher for them all, to both folders', async () => {
    const policy = new PathPolicy(), out = tmp();
    const prg = Uint8Array.from([0x00, 0x10, ...Array.from({ length: 0x2000 }, (_, i) => ((i * 7) ^ (i >> 4)) & 0xff)]);
    const prefs = { ...DEFAULT_PACK, mode: 'mem' as const, split: true, ranges: [{ start: 0x1000, end: 0x1800 }, { start: 0x2400, end: 0x3000 }], dir: out };
    const r = await keepPacked(await packWithBrokkr({ files: [{ name: 'game.prg', prg }], prefs }, policy, q => packWithBrokkrCore(q.files, q.prefs)), out);
    expect(r.check?.status).toBe('same');
    expect(r.files?.map(f => [f.name, f.kind])).toEqual([['game-brokkr-1000.prg', 'packed'], ['game-brokkr-2400.prg', 'packed'], ['game-brokkr-decrunch.prg', 'decruncher'], ['game-brokkr-decrunch.asm', 'source']]);
    for (const f of r.files!) {
      expect(f.path).toBe(join(out, f.name));
      expect(readFileSync(f.path)).toEqual(Buffer.from(f.prg));
      expect(readFileSync(join(r.dir, f.name))).toEqual(Buffer.from(f.prg));
    }
    expect(readFileSync(join(out, 'game-brokkr-decrunch.asm'), 'utf8')).toMatch(/^\.const ZP = \$f7/m);
    expect(r.commands).toHaveLength(4);
  });

  it.skipIf(!javaOk)('turns Kick Assembler errors into problems with file and line', async () => {
    const dir = tmp(); const policy = new PathPolicy(); policy.allow(dir);
    writeFileSync(join(dir, 'bad.asm'), '.pc = $1000 "Code"\n  lda unknown_label\n');
    const r = await buildWithAssembler({ dir, entries: ['bad.asm'] }, toolchain({ kickJar: jar! }), policy);
    expect(r.ok).toBe(false);
    expect(r.problems).toEqual([{ severity: 'error', file: 'bad.asm', line: 2, column: 7, message: "Unknown symbol 'unknown_label'" }]);
  }, 60_000);
});



describe("VICE's character ROM (screens in the Graphics tab)", () => {
  it("is looked for in VICE's C64 folder beside its bin folder, then beside the program", () => {
    expect(charRomFiles(' ')).toEqual([]);
    const v = join('/v', 'bin', 'x64sc.exe');
    expect(charRomFiles(v)).toEqual([join('/v', 'C64', 'chargen-901225-01.bin'), join('/v', 'C64', 'chargen'), join('/v', 'bin', 'C64', 'chargen-901225-01.bin'), join('/v', 'bin', 'C64', 'chargen')]);
  });

  it('reads the first file that is 4 KB', async () => {
    const dir = tmp();
    mkdirSync(join(dir, 'C64'));
    const files = charRomFiles(join(dir, 'bin', 'x64sc.exe'));
    expect(await readCharRom(files)).toEqual({ found: false, path: files[0] });
    writeFileSync(join(dir, 'C64', 'chargen-901225-01.bin'), new Uint8Array(100));
    writeFileSync(join(dir, 'C64', 'chargen'), Uint8Array.from({ length: 4096 }, (_, i) => i & 0xff));
    const r = await readCharRom(files);
    expect(r).toMatchObject({ found: true, path: files[1] });
    expect(r.found && [...r.bytes.subarray(0, 4)]).toEqual([0, 1, 2, 3]);
  });
});

describe('the library (spec 10.6)', () => {
  const tune = () => makePsid(new Uint8Array([0x60, 0x60, 0x60]), 0x1000, 0x1000, 0x1001, 'Tune');
  const store = (dir: string, trashed: string[] = []) => new LibraryStore(() => dir, async p => { trashed.push(p); rmSync(p); });

  it('is empty before anything is added, and writes nothing then', async () => {
    const dir = join(tmp(), 'Library');
    expect(await store(dir).list()).toEqual({ dir, exists: false, items: [] });
    expect(existsSync(dir)).toBe(false);
    expect(defaultLibraryDir(join('C:', 'Docs'))).toBe(join('C:', 'Docs', 'Mimir', 'Library'));
  });

  it('writes a file under a name of its own in its kind\'s folder, with its entry', async () => {
    const dir = join(tmp(), 'Library'), lib = store(dir);
    const r = await lib.add({ kind: 'sid', stem: 'Game - music_1000 ($1000-$1002)', bytes: tune(), entry: { name: 'music_1000', from: { text: 'Game', file: 'game.prg', start: 0x1000, end: 0x1003 } } });
    expect(r.item).toMatchObject({ kind: 'sid', file: 'Game - music_1000 ($1000-$1002).sid', name: 'music_1000', from: { text: 'Game', file: 'game.prg' } });
    expect(existsSync(join(dir, 'SIDs', 'Game - music_1000 ($1000-$1002).sid'))).toBe(true);
    // the same name again: a file of its own; a name with a folder in it is made safe
    const again = await lib.add({ kind: 'sid', stem: 'Game - music_1000 ($1000-$1002)', bytes: tune(), entry: { name: 'music_1000' } });
    expect(again.item.file).toBe('Game - music_1000 ($1000-$1002) (2).sid');
    const chars = await lib.add({ kind: 'chars', stem: 'a:b', bytes: new Uint8Array([0, 0x30, 1, 2, 3, 4, 5, 6, 7, 8]), entry: { name: 'font', mc: true, colors: { bg: 0, fg: 1, mc1: 2, mc2: 3 } } });
    expect(chars.item).toMatchObject({ kind: 'chars', file: 'a_b.64c', load: 0x3000, mc: true, colors: { bg: 0, fg: 1, mc1: 2, mc2: 3 } });
    expect([...chars.item.data]).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(chars.listing.items.map(i => i.file)).toEqual(['Game - music_1000 ($1000-$1002) (2).sid', 'Game - music_1000 ($1000-$1002).sid', 'a_b.64c']);
    // not of its kind
    await expect(lib.add({ kind: 'sid', stem: 'x', bytes: new Uint8Array(200), entry: { name: 'x' } })).rejects.toThrow(/not a PSID/);
  });

  it('renames a file and its .sid name, keeps how a charset is drawn', async () => {
    const dir = join(tmp(), 'Library'), lib = store(dir);
    const { item } = await lib.add({ kind: 'sid', stem: 'Game - music', bytes: tune(), entry: { name: 'music', from: { text: 'Game' } } });
    const r = await lib.update({ kind: 'sid', file: item.file, name: 'Title tune', stem: 'Game - Title tune' });
    expect(r.item).toMatchObject({ file: 'Game - Title tune.sid', name: 'Title tune', from: { text: 'Game' } });
    expect(existsSync(join(dir, 'SIDs', 'Game - music.sid'))).toBe(false);
    const sid = new Uint8Array(readFileSync(join(dir, 'SIDs', 'Game - Title tune.sid')));
    expect(String.fromCharCode(...sid.subarray(0x16, 0x20))).toBe('Title tune');
    const c = await lib.add({ kind: 'sprites', stem: 'man', bytes: new Uint8Array(64), entry: { name: 'man' } });
    expect((await lib.update({ kind: 'sprites', file: c.item.file, mc: true, colors: { bg: 6, fg: 1, mc1: 2, mc2: 5 } })).item).toMatchObject({ file: 'man.spr', mc: true, colors: { bg: 6, fg: 1, mc1: 2, mc2: 5 } });
    expect(() => lib.path('sid', '../x.sid')).toThrow();
  });

  it('finds a file renamed by hand, lists one put there by hand, and moves one to the Recycle Bin', async () => {
    const dir = join(tmp(), 'Library'), trashed: string[] = [], lib = store(dir, trashed);
    await lib.add({ kind: 'sid', stem: 'old name', bytes: tune(), entry: { name: 'Tune', from: { text: 'Game' } } });
    renameSync(join(dir, 'SIDs', 'old name.sid'), join(dir, 'SIDs', 'new name.sid'));
    mkdirSync(join(dir, 'Chars'));
    writeFileSync(join(dir, 'Chars', 'my font.bin'), new Uint8Array(2048));
    writeFileSync(join(dir, 'Chars', 'notes.txt'), 'not a charset');
    const l = await lib.list();
    expect(l.items.map(i => [i.file, i.name, i.from?.text ?? null, !!i.own])).toEqual([['new name.sid', 'Tune', 'Game', false], ['my font.bin', 'my font', null, true]]);
    expect(JSON.parse(readFileSync(join(dir, 'library.json'), 'utf8')).items.map((e: { file: string }) => e.file)).toEqual(['new name.sid']);
    const after = await lib.remove({ kind: 'sid', file: 'new name.sid' });
    expect(trashed).toEqual([join(dir, 'SIDs', 'new name.sid')]);
    expect(after.items.map(i => i.file)).toEqual(['my font.bin']);
    expect(JSON.parse(readFileSync(join(dir, 'library.json'), 'utf8')).items).toEqual([]);
  });

  it('writes a bitmap as a picture in the format asked for, multicolour as that format is', async () => {
    const dir = join(tmp(), 'Library'), lib = store(dir);
    const p = picture({ mc: true, bitmap: new Uint8Array(8000).fill(0x1b), screen: new Uint8Array(1000).fill(0x5c), color: new Uint8Array(1000).fill(3), bg: 0 });
    const k = await lib.add({ kind: 'bitmaps', stem: 'Game - logo', format: 'koala', bytes: writePicture('koala', p), entry: { name: 'logo', mc: false } });
    expect(k.item).toMatchObject({ kind: 'bitmaps', file: 'Game - logo.kla', mc: true });
    expect(readFileSync(join(dir, 'Bitmaps', 'Game - logo.kla')).length).toBe(10003);
    const o = await lib.add({ kind: 'bitmaps', stem: 'Game - logo', format: 'ocp', bytes: writePicture('ocp', p), entry: { name: 'logo' } });
    expect(o.item.file).toBe('Game - logo.ocp');
    // the same picture in either format: the same bytes, found again
    expect(o.item.hash).toBe(k.item.hash);
    // bytes that are not the format's
    await expect(lib.add({ kind: 'bitmaps', stem: 'x', format: 'ocp', bytes: writePicture('koala', p), entry: { name: 'x' } })).rejects.toThrow(/too short/);
    // a file put there by hand
    writeFileSync(join(dir, 'Bitmaps', 'mine.art'), writePicture('art', picture({ mc: false, bitmap: new Uint8Array(8000), screen: new Uint8Array(1000), bg: 0 })));
    expect((await lib.list()).items.find(i => i.file === 'mine.art')).toMatchObject({ own: true, mc: false });
  });

  it('takes only plain file names of the kind over IPC', () => {
    const tuneBytes = tune();
    expect(libraryAddSchema.safeParse({ kind: 'sid', stem: 'x', bytes: tuneBytes, entry: { name: 'x' } }).success).toBe(true);
    expect(libraryAddSchema.safeParse({ kind: 'sid', stem: '../x', bytes: tuneBytes, entry: { name: 'x' } }).success).toBe(false);
    expect(libraryAddSchema.safeParse({ kind: 'bitmap', stem: 'x', bytes: tuneBytes, entry: { name: 'x' } }).success).toBe(false);
    expect(libraryAddSchema.safeParse({ kind: 'bitmaps', stem: 'x', format: 'ocp', bytes: tuneBytes, entry: { name: 'x' } }).success).toBe(true);
    expect(libraryAddSchema.safeParse({ kind: 'bitmaps', stem: 'x', format: 'png', bytes: tuneBytes, entry: { name: 'x' } }).success).toBe(false);
    expect(libraryFileSchema.safeParse({ kind: 'sid', file: 'x.sid' }).success).toBe(true);
    expect(libraryFileSchema.safeParse({ kind: 'sid', file: '..\\x.sid' }).success).toBe(false);
    expect(libraryFileSchema.safeParse({ kind: 'chars', file: 'x.sid' }).success).toBe(false);
    expect(libraryUpdateSchema.safeParse({ kind: 'chars', file: 'x.64c', colors: { bg: 0, fg: 1, mc1: 2, mc2: 16 } }).success).toBe(false);
    expect(libraryRevealSchema.safeParse({}).success).toBe(true);
    expect(libraryRevealSchema.safeParse({ file: 'x.sid' }).success).toBe(false);
  });
});

describe('the macro and code libraries (spec 10.8)', () => {
  let clock = Date.UTC(2026, 10, 26, 20, 0);
  const store = (dir: string, trashed: string[] = []) => new CodeLibStore(() => dir, async p => { trashed.push(p); rmSync(p); }, () => clock);
  const macro = '.macro WaitRaster(line) {\n!:      lda $d012\n        cmp #line\n        bne !-\n}';

  it('lists nothing before anything is added, and writes nothing then', async () => {
    const dir = join(tmp(), 'Library');
    expect(await store(dir).list()).toEqual({ dir, folders: { macro: join(dir, 'Macros'), code: join(dir, 'Code') }, items: [], exports: {} });
    expect(existsSync(dir)).toBe(false);
  });

  it('writes an item in its kind\'s folder with the line that says the rest, made now, under a name of its own', async () => {
    const dir = join(tmp(), 'Library'), lib = store(dir);
    const r = await lib.save({ kind: 'macro', name: 'WaitRaster', code: macro, lang: 'kickass', description: 'Waits for a line', color: 'teal', from: 'demo · main.asm:3–7' });
    expect(r.item).toMatchObject({ kind: 'macro', file: 'WaitRaster.asm', name: 'WaitRaster', code: macro, lang: 'kickass', description: 'Waits for a line', color: 'teal', created: clock, from: 'demo · main.asm:3–7' });
    const text = readFileSync(join(dir, 'Macros', 'WaitRaster.asm'), 'utf8');
    expect(text).toBe(`// mimir-library {"lang":"kickass","created":"2026-11-26T20:00:00.000Z","color":"teal","description":"Waits for a line","from":"demo · main.asm:3–7"}\n${macro}\n`);
    // the same name again: a file of its own; a name a file cannot have made safe
    const again = await lib.save({ kind: 'macro', name: 'waitraster', code: macro, lang: 'kickass', description: '' });
    expect(again.item.file).toBe('waitraster (2).asm');
    const code = await lib.save({ kind: 'code', name: 'clear: screen?', code: '        lda #$20\n', lang: '64tass', description: '' });
    expect(code.item).toMatchObject({ kind: 'code', file: 'clear_ screen_.asm', lang: '64tass', code: '        lda #$20' });
    expect(readFileSync(join(dir, 'Code', 'clear_ screen_.asm'), 'utf8').startsWith('; mimir-library {"lang":"64tass"')).toBe(true);
    expect(code.listing.items.map(i => `${i.kind}/${i.file}`).sort()).toEqual(['code/clear_ screen_.asm', 'macro/WaitRaster.asm', 'macro/waitraster (2).asm']);
  });

  it('changes an item in its place: renamed, moved to the other library, when it was made kept', async () => {
    const dir = join(tmp(), 'Library'), lib = store(dir);
    const made = clock;
    const { item } = await lib.save({ kind: 'macro', name: 'Wait', code: macro, lang: 'kickass', description: '' });
    clock += 60_000;
    const r = await lib.save({ kind: 'macro', name: 'Wait for raster', code: macro, lang: 'kickass', description: 'now with a note', color: '#a0b1c2', was: { kind: 'macro', file: item.file } });
    expect(r.item).toMatchObject({ file: 'Wait for raster.asm', description: 'now with a note', color: '#a0b1c2', created: made });
    expect(existsSync(join(dir, 'Macros', 'Wait.asm'))).toBe(false);
    // only the letters' case
    const c = await lib.save({ kind: 'macro', name: 'WAIT FOR RASTER', code: macro, lang: 'kickass', description: '', was: { kind: 'macro', file: r.item.file } });
    expect(c.item.file).toBe('WAIT FOR RASTER.asm');
    // to the code library
    const m = await lib.save({ kind: 'code', name: 'WAIT FOR RASTER', code: 'nop', lang: 'kickass', description: '', was: { kind: 'macro', file: c.item.file } });
    expect(m.item).toMatchObject({ kind: 'code', file: 'WAIT FOR RASTER.asm', created: made, code: 'nop' });
    expect(m.listing.items.map(i => `${i.kind}/${i.file}`)).toEqual(['code/WAIT FOR RASTER.asm']);
    // one that is not there any more
    await expect(lib.save({ kind: 'code', name: 'x', code: 'nop', lang: 'kickass', description: '', was: { kind: 'macro', file: 'gone.asm' } })).rejects.toThrow(/not in the Macros library/);
  });

  it('lists files put there by hand, keeps their extension, and moves one to the Recycle Bin', async () => {
    const dir = join(tmp(), 'Library'), trashed: string[] = [], lib = store(dir, trashed);
    mkdirSync(join(dir, 'Macros'), { recursive: true });
    writeFileSync(join(dir, 'Macros', 'irq.s'), 'SetIrq  .macro line\n        lda #\\1\n        sta $d012\n        .endm\n');
    writeFileSync(join(dir, 'Macros', 'notes.txt'), 'not code');
    const l = await lib.list();
    expect(l.items).toHaveLength(1);
    expect(l.items[0]).toMatchObject({ kind: 'macro', file: 'irq.s', name: 'irq', lang: '64tass', own: true });
    // given a description: the line written, the file's name and extension kept
    const r = await lib.save({ kind: 'macro', name: 'irq', code: l.items[0].code, lang: '64tass', description: 'Sets the raster IRQ line', was: { kind: 'macro', file: 'irq.s' } });
    expect(r.item).toMatchObject({ file: 'irq.s', description: 'Sets the raster IRQ line' });
    expect(r.item).not.toHaveProperty('own');
    const after = await lib.remove({ kind: 'macro', file: 'irq.s' });
    expect(trashed).toEqual([join(dir, 'Macros', 'irq.s')]);
    expect(after.items).toEqual([]);
    expect(() => lib.path('macro', '../x.asm')).toThrow();
  });

  it('takes only plain file names of the libraries over IPC', () => {
    expect(codelibSaveSchema.safeParse({ kind: 'macro', name: 'x', code: 'nop', lang: 'kickass', description: '' }).success).toBe(true);
    expect(codelibSaveSchema.safeParse({ kind: 'macro', name: ' ', code: 'nop', lang: 'kickass', description: '' }).success).toBe(false);
    expect(codelibSaveSchema.safeParse({ kind: 'macros', name: 'x', code: 'nop', lang: 'kickass', description: '' }).success).toBe(false);
    expect(codelibSaveSchema.safeParse({ kind: 'code', name: 'x', code: 'nop', lang: 'acme', description: '' }).success).toBe(false);
    expect(codelibSaveSchema.safeParse({ kind: 'code', name: 'x', code: 'nop', lang: 'kickass', description: '', color: 'rainbow' }).success).toBe(false);
    expect(codelibSaveSchema.safeParse({ kind: 'code', name: 'x', code: 'nop', lang: 'kickass', description: '', color: '#a0b1c2', was: { kind: 'code', file: 'x.asm' } }).success).toBe(true);
    expect(codelibFileSchema.safeParse({ kind: 'code', file: '..\\x.asm' }).success).toBe(false);
    expect(codelibFileSchema.safeParse({ kind: 'code', file: 'x.txt' }).success).toBe(false);
    expect(codelibRevealSchema.safeParse({ kind: 'macro' }).success).toBe(true);
    expect(codelibRevealSchema.safeParse({}).success).toBe(false);
  });
});

describe('collections of the macro library (spec 10.8)', () => {
  let clock = Date.UTC(2026, 10, 27, 9, 0);
  const store = (dir: string, trashed: string[] = [], state?: string) => new CodeLibStore(() => dir, async p => { trashed.push(readFileSync(p, 'utf8')); rmSync(p); }, () => clock, state);
  const LIB = '#importonce\n\n// =====\n// Border colour\n// =====\n.macro SetBorder(c) {\n    lda #c\n    sta $d020\n}\n\n.macro save() {pha;txa;pha}\n';
  const lib3 = (dir: string) => { mkdirSync(join(dir, 'Macros'), { recursive: true }); writeFileSync(join(dir, 'Macros', 'raster.asm'), LIB); };

  it('a file with several macros is a collection; a macro put in it at its end, in its style, made now', async () => {
    const dir = join(tmp(), 'Library'), lib = store(dir);
    lib3(dir);
    const l = await lib.list();
    expect(l.items[0]).toMatchObject({ file: 'raster.asm', collection: true, own: true });
    expect(l.items[0].macros!.map(m => [m.name, m.description])).toEqual([['SetBorder', 'Border colour'], ['save', '']]);
    const r = await lib.save({ kind: 'macro', name: 'Black', code: 'lda #0\nsta $d020', lang: 'kickass', description: '', into: { file: 'raster.asm' } }).catch(e => e as Error);
    expect(r).toBeInstanceOf(Error);
    const ok = await lib.save({ kind: 'macro', name: 'Black', code: '.macro Black() {\n    lda #0\n    sta $d020\n}', lang: 'kickass', description: 'Border black', color: 'teal', into: { file: 'raster.asm' } });
    expect(ok.macro).toBe('Black');
    expect(ok.item.macros!.map(m => m.name)).toEqual(['SetBorder', 'save', 'Black']);
    const text = readFileSync(join(dir, 'Macros', 'raster.asm'), 'utf8');
    expect(text).toBe(`// mimir-library {"lang":"kickass","created":"${new Date(l.items[0].created).toISOString()}","collection":true}\n${LIB}\n// =====\n// Border black\n// =====\n// mimir-macro {"created":"2026-11-27T09:00:00.000Z","color":"teal"}\n.macro Black() {\n    lda #0\n    sta $d020\n}\n`);
    // a name it has already; one of the other assembler
    await expect(lib.save({ kind: 'macro', name: 'save', code: '.macro save() {pha}', lang: 'kickass', description: '', into: { file: 'raster.asm' } })).rejects.toThrow(/has a macro named save already/);
    await expect(lib.save({ kind: 'macro', name: 'W', code: 'W .macro\n .endm', lang: '64tass', description: '', into: { file: 'raster.asm' } })).rejects.toThrow(/written for Kick Assembler/);
  });

  it('a collection\'s macro changed in its place (renamed, its decoration kept), out to a file of its own, into a new collection, taken out to the Recycle Bin', async () => {
    const dir = join(tmp(), 'Library'), trashed: string[] = [], lib = store(dir, trashed);
    lib3(dir);
    const made = clock;
    await lib.list();
    clock += 3600_000;
    const r = await lib.save({ kind: 'macro', name: 'Border', code: '.macro SetBorder(c) {\n    lda #c\n    sta $d020\n}', lang: 'kickass', description: 'The border\'s colour', color: 'pink', was: { kind: 'macro', file: 'raster.asm', macro: 'SetBorder' }, into: { file: 'raster.asm' } });
    expect(r.macro).toBe('Border');
    const text = readFileSync(join(dir, 'Macros', 'raster.asm'), 'utf8');
    expect(text).toContain('#importonce\n\n// =====\n// The border\'s colour\n// =====\n// mimir-macro {"color":"pink"}\n.macro Border(c) {');
    // out to a file of its own: when it was made the collection's (it had none of its own)
    const own = await lib.save({ kind: 'macro', name: 'Border', code: '.macro Border(c) {\n    lda #c\n    sta $d020\n}', lang: 'kickass', description: 'The border\'s colour', color: 'pink', was: { kind: 'macro', file: 'raster.asm', macro: 'Border' } });
    expect(own.item).toMatchObject({ file: 'Border.asm', description: 'The border\'s colour', color: 'pink' });
    expect(own.item.created).toBeLessThanOrEqual(made);
    expect(own.listing.items.find(i => i.file === 'raster.asm')!.macros!.map(m => m.name)).toEqual(['save']);
    // a macro of its own into a new collection: its file to the Recycle Bin, when it was made kept
    const coll = await lib.save({ kind: 'macro', name: 'Border', code: own.item.code, lang: 'kickass', description: own.item.description, color: 'pink', was: { kind: 'macro', file: 'Border.asm' }, into: { name: 'Colours' } });
    expect(coll.item).toMatchObject({ file: 'Colours.asm', collection: true, created: clock });
    expect(coll.item.macros![0]).toMatchObject({ name: 'Border', created: own.item.created, color: 'pink', description: 'The border\'s colour' });
    expect(existsSync(join(dir, 'Macros', 'Border.asm'))).toBe(false);
    expect(trashed).toHaveLength(1);
    // a name of a macro of its own is no collection
    await lib.save({ kind: 'macro', name: 'Solo', code: '.macro Solo() {\n nop\n}', lang: 'kickass', description: '' });
    await expect(lib.save({ kind: 'macro', name: 'X', code: '.macro X() {\n nop\n}', lang: 'kickass', description: '', into: { name: 'solo' } })).rejects.toThrow(/not a collection/);
    // taken out: to the Recycle Bin as a file of its own
    const after = await lib.remove({ kind: 'macro', file: 'raster.asm', macro: 'save' });
    expect(after.items.find(i => i.file === 'raster.asm')!.macros ?? []).toEqual([]);
    expect(trashed[1]).toMatch(/^\/\/ mimir-library \{"lang":"kickass".*"from":"raster"\}\n\.macro save\(\) \{pha;txa;pha\}\n$/);
  });

  it('imports files as they are (the line added, a collection said), remembers where from, exports back there; not over a file changed since', async () => {
    const base = tmp(), dir = join(base, 'Library'), state = join(base, 'codelib-files.json'), lib = store(dir, [], state);
    const outside = join(base, 'c64_lib');
    mkdirSync(outside);
    writeFileSync(join(outside, 'irq_lib.asm'), LIB.replace(/\n/g, '\r\n'));
    writeFileSync(join(outside, 'one.asm'), '// Burns a line\n.macro Burn() {\n  .fill 20, $ea\n}\n');
    writeFileSync(join(outside, 'big.bin'), Buffer.alloc(10, 0));
    const r = await lib.importFiles('macro', [join(outside, 'irq_lib.asm'), join(outside, 'one.asm'), join(outside, 'big.bin'), join(outside, 'gone.asm')]);
    expect(r.imported).toEqual([{ kind: 'macro', file: 'irq_lib.asm' }, { kind: 'macro', file: 'one.asm' }]);
    expect(r.skipped).toEqual([expect.stringMatching(/^big\.bin: not a text file/), expect.stringMatching(/^gone\.asm: /)]);
    const irq = r.listing.items.find(i => i.file === 'irq_lib.asm')!, one = r.listing.items.find(i => i.file === 'one.asm')!;
    expect(irq).toMatchObject({ collection: true, from: join(outside, 'irq_lib.asm'), code: LIB.trimEnd() });
    expect(irq).not.toHaveProperty('own');
    expect(one).toMatchObject({ description: 'Burns a line' });
    expect(one.collection).toBeUndefined();
    expect(r.listing.exports).toEqual({ 'macro/irq_lib.asm': { path: join(outside, 'irq_lib.asm'), lines: false }, 'macro/one.asm': { path: join(outside, 'one.asm'), lines: false } });

    // changed in Mimir, exported again: as it was written by hand (no Mimir lines, its CRLF kept)
    await lib.save({ kind: 'macro', name: 'save', code: '.macro save() {pha;txa;pha;tya;pha}', lang: 'kickass', description: 'Saves A, X and Y', color: 'teal', was: { kind: 'macro', file: 'irq_lib.asm', macro: 'save' }, into: { file: 'irq_lib.asm' } });
    const pick = async () => { throw new Error('no dialog for again'); };
    const again = await lib.export({ macros: [{ kind: 'macro', file: 'irq_lib.asm' }], to: 'again', lines: true }, pick);
    expect(again).toMatchObject({ path: join(outside, 'irq_lib.asm'), count: 2 });
    const back = readFileSync(join(outside, 'irq_lib.asm'), 'utf8');
    // (given a description, in the collection's style)
    expect(back).toBe(LIB.replace('.macro save() {pha;txa;pha}', '// =====\n// Saves A, X and Y\n// =====\n.macro save() {pha;txa;pha;tya;pha}').replace(/\n/g, '\r\n'));
    // changed outside since: not written, unless told to
    writeFileSync(join(outside, 'irq_lib.asm'), `${back}// mine\r\n`);
    const no = await lib.export({ macros: [{ kind: 'macro', file: 'irq_lib.asm' }], to: 'again', lines: false }, pick);
    expect(no).toMatchObject({ changed: true, path: join(outside, 'irq_lib.asm') });
    expect(readFileSync(join(outside, 'irq_lib.asm'), 'utf8').endsWith('// mine\r\n')).toBe(true);
    await lib.export({ macros: [{ kind: 'macro', file: 'irq_lib.asm' }], to: 'again', lines: false, force: true }, pick);
    expect(readFileSync(join(outside, 'irq_lib.asm'), 'utf8')).toBe(back);
    // remembered for the next run
    expect((await store(dir, [], state).list()).exports['macro/irq_lib.asm']).toEqual({ path: join(outside, 'irq_lib.asm'), lines: false });
    // one never exported has no again
    await lib.save({ kind: 'macro', name: 'Solo', code: '.macro Solo() {\n nop\n}', lang: 'kickass', description: '' });
    await expect(lib.export({ macros: [{ kind: 'macro', file: 'Solo.asm' }], to: 'again', lines: false }, pick)).rejects.toThrow(/not exported before/);
  });

  it('exports macros from here and there to a file (the dialog\'s), with Mimir\'s lines or as by hand, and into a collection (moved)', async () => {
    clock = Date.UTC(2026, 10, 27, 9, 0);
    const base = tmp(), dir = join(base, 'Library'), lib = store(dir);
    lib3(dir);
    await lib.save({ kind: 'macro', name: 'Black', code: '.macro Black() {\n    lda #0\n    sta $d020\n}', lang: 'kickass', description: 'Border black', color: 'teal' });
    await lib.save({ kind: 'macro', name: 'Tass', code: 'Tass .macro\n .endm', lang: '64tass', description: '' });
    const to = join(base, 'out', 'mine.asm');
    mkdirSync(join(base, 'out'));
    const asked: string[] = [];
    const pick = async (name: string) => { asked.push(name); return to; };
    const macros = [{ kind: 'macro' as const, file: 'Black.asm' }, { kind: 'macro' as const, file: 'raster.asm', macro: 'SetBorder' }];
    const plain = await lib.export({ macros, to: 'file', lines: false }, pick);
    expect(plain).toMatchObject({ path: to, count: 2 });
    expect(asked).toEqual(['macros.asm']);
    expect(readFileSync(to, 'utf8')).toBe('// Border black\n.macro Black() {\n    lda #0\n    sta $d020\n}\n\n// =====\n// Border colour\n// =====\n.macro SetBorder(c) {\n    lda #c\n    sta $d020\n}\n');
    await lib.export({ macros, to: 'file', lines: true }, pick);
    const kept = readFileSync(to, 'utf8');
    expect(kept.split('\n')[0]).toBe('// mimir-library {"lang":"kickass","created":"2026-11-27T09:00:00.000Z","collection":true}');
    expect(kept).toContain('// mimir-macro {"created":"2026-11-27T09:00:00.000Z","color":"teal"}\n.macro Black() {');
    // the dialog closed: nothing written
    expect(await lib.export({ macros, to: 'file', lines: false }, async () => null)).toMatchObject({ canceled: true, count: 0 });
    // two assemblers in one file: no
    await expect(lib.export({ macros: [...macros, { kind: 'macro', file: 'Tass.asm' }], to: 'file', lines: false }, pick)).rejects.toThrow(/do not go in one file/);
    // into a new collection, moved: out of where they were
    const into = await lib.export({ macros, to: { collection: 'Borders' }, lines: true, move: true }, pick);
    expect(into).toMatchObject({ count: 2, collection: { kind: 'macro', file: 'Borders.asm' } });
    const borders = into.listing.items.find(i => i.file === 'Borders.asm')!;
    expect(borders.macros!.map(m => [m.name, m.description, m.color ?? null])).toEqual([['Black', 'Border black', 'teal'], ['SetBorder', 'Border colour', null]]);
    expect(into.listing.items.map(i => i.file).sort()).toEqual(['Borders.asm', 'Tass.asm', 'raster.asm']);
    expect(into.listing.items.find(i => i.file === 'raster.asm')!.macros!.map(m => m.name)).toEqual(['save']);
    // again into it: the names it has
    await lib.save({ kind: 'macro', name: 'Black', code: '.macro Black() {\n nop\n}', lang: 'kickass', description: '' });
    await expect(lib.export({ macros: [{ kind: 'macro', file: 'Black.asm' }], to: { collection: 'borders' }, lines: true }, pick)).rejects.toThrow(/Borders has a macro named Black already/);
  });

  it('takes only what it should over IPC', () => {
    expect(codelibFileSchema.safeParse({ kind: 'macro', file: 'x.asm', macro: 'SetBorder' }).success).toBe(true);
    expect(codelibFileSchema.safeParse({ kind: 'macro', file: 'x.asm', macro: 'a b' }).success).toBe(false);
    expect(codelibSaveSchema.safeParse({ kind: 'macro', name: 'x', code: 'nop', lang: 'kickass', description: '', into: { file: 'raster.asm' } }).success).toBe(true);
    expect(codelibSaveSchema.safeParse({ kind: 'macro', name: 'x', code: 'nop', lang: 'kickass', description: '', into: { file: '../raster.asm' } }).success).toBe(false);
    expect(codelibSaveSchema.safeParse({ kind: 'macro', name: 'x', code: 'nop', lang: 'kickass', description: '', into: { name: 'New' } }).success).toBe(true);
    expect(codelibExportSchema.safeParse({ macros: [{ kind: 'macro', file: 'x.asm' }], to: 'file', lines: false }).success).toBe(true);
    expect(codelibExportSchema.safeParse({ macros: [{ kind: 'macro', file: 'x.asm' }], to: 'C:\\x.asm', lines: false }).success).toBe(false);
    expect(codelibExportSchema.safeParse({ macros: [{ kind: 'macro', file: 'x.asm' }], to: { path: 'C:\\x.asm' }, lines: false }).success).toBe(false);
    expect(codelibExportSchema.safeParse({ macros: [], to: 'file', lines: false }).success).toBe(false);
  });
});
