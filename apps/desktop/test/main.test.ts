/* Main-process logic without Electron: path policy, settings store, IPC schemas, toolchain runner. */
import { describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analyze, createProject, DEFAULT_PACK, demoProject, packWithBrokkr as packWithBrokkrCore, deserializeProject, LEGACY_PROJECT_FORMAT, makeD64, makePsid, render, serializeProject, type SerializedProject, type ToolchainSettings } from '@mimir/core';
import { findKickAssJar, writeVfs } from '@mimir/core/node';
import { CHANNELS } from '../shared/ipc';
import { assertEntryName, PathPolicy } from '../electron/main/paths';
import { bringOldSettings } from '../electron/main/migrate';
import { RecentFolders } from '../electron/main/recent';
import { answerClose, askBeforeClose, CLOSE_ANSWER_MS, type ClosingWindow } from '../electron/main/closing';
import { findInFolder, startFolder, toolLook } from '../electron/main/locate';
import { bundledExomizer, defaultToolchainSettings, SettingsStore } from '../electron/main/settings';
import { deepSidPlaySchema, diskOpenSchema, locateSchema, tapeOpenSchema, editorOpenSchema, exportWriteSchema, fileSaveSchema, packFolderSchema, packSchema, prgOpenSchema, projectSchema, quicksaveEntrySchema, quicksaveFavouriteSchema, quicksaveRenameSchema, runSchema, serializedProjectSchema, smartAttachSchema, windowCloseSchema } from '../electron/main/schemas';
import { buildWithKickAssembler, currentEditor, keepPacked, openInEditor, packWithBrokkr, packWithExomizer } from '../electron/main/toolchain';
import { QUICKSAVE_FILE, QuicksaveHistory, QuicksaveWatcher, quicksaveFileName, quicksaveFiles, quicksaveInfo, quicksaveName, readQuicksave, viceConfigDir } from '../electron/main/quicksave';
import { readDiskImage, readPrgFiles, readProjectFile, writeProjectFile } from '../electron/main/project-fs';
import { charRomFiles, readCharRom } from '../electron/main/chargen';
import { createProjectFolder, gatherWork, homeOf, isOwnTemp, nearestFolder, ProjectStore, RECENT_PROJECTS } from '../electron/main/projects';
import { projectNameOf, projectNameProblem } from '../shared/projects';
import { smartKind, smartPlan } from '../shared/smart-attach';

const tmp = () => mkdtempSync(join(tmpdir(), 'mimir-desktop-test-'));
const toolchain = (patch: Partial<ToolchainSettings> = {}): ToolchainSettings => ({ javaPath: 'java', kickJar: '', vicePath: '', outDir: 'out', kickArgs: '-vicesymbols -showmem', viceArgs: '-autostartprgmode 1', unpackerPath: '', unpackerArgs: '{in}', exomizerPath: '', viceQuicksave: '', editorPath: '', editorArgs: '{dir} {file}', musicPlayer: 'vice', ...patch });

describe('IPC contract', () => {
  it('has exactly the channels of spec 13.4', () => {
    expect(Object.values(CHANNELS).sort()).toEqual(['disk:open', 'tape:open', 'file:smart', 'export:write', 'fs:changed', 'prg:open', 'project:open', 'project:save', 'project:start', 'project:create', 'project:parent', 'project:unsaved', 'project:reveal', 'project:forget', 'settings:get', 'settings:set', 'settings:locate', 'terminal:open', 'editor:open', 'editor:find', 'asm:pick', 'toolchain:build', 'toolchain:identify', 'toolchain:pack', 'pack:folder', 'toolchain:roms', 'toolchain:run', 'toolchain:unpack', 'vice:attach', 'vice:command', 'file:save', 'vice:quicksave', 'vice:quicksave-info', 'vice:quicksaves', 'vice:quicksave-open', 'vice:quicksave-rename', 'vice:quicksave-save', 'vice:quicksave-favourite', 'vice:quicksaved', 'vice:chargen', 'deepsid:play', 'window:close', 'window:closing'].sort());
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

  it('reads the user scripts with what their scratchpads hold, and older files without them', () => {
    const script = { id: 's1', name: 'decrypt', lang: 'kickass' as const, source: '* = $c000\nstart: rts', pads: [{ name: 'pad1', start: 0xc800, size: 4, bytes: new Uint8Array([1, 2, 3, 4]) }, { name: 'pad2', start: 0xc900, size: 16, fill: 0xff }] };
    const p = { ...demoProject(), userScripts: [script] };
    const json = JSON.parse(JSON.stringify(serializeProject(p)));
    const back = deserializeProject(serializedProjectSchema.parse(json) as SerializedProject);
    expect(back.userScripts?.[0]).toMatchObject({ name: 'decrypt', lang: 'kickass', source: script.source, pads: [{ name: 'pad1', start: 0xc800, size: 4 }, { name: 'pad2', start: 0xc900, size: 16, fill: 0xff }] });
    expect([...back.userScripts![0].pads[0].bytes!]).toEqual([1, 2, 3, 4]);
    delete json.userScripts;
    expect(serializedProjectSchema.parse(json).userScripts).toBeUndefined();
    expect(projectSchema.safeParse(p).success).toBe(true);
    // a scratchpad past $ffff, or bytes not as many as it holds
    expect(projectSchema.safeParse({ ...p, userScripts: [{ ...script, pads: [{ name: 'x', start: 0xfff0, size: 0x20 }] }] }).success).toBe(false);
    expect(projectSchema.safeParse({ ...p, userScripts: [{ ...script, pads: [{ name: 'x', start: 0xc000, size: 8, bytes: new Uint8Array(4) }] }] }).success).toBe(false);
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
    expect(r).toMatchObject({ path: disk, name: 'disk.d64' });
    expect(r.bytes.length).toBe(174848);
    expect(await readDiskImage(gcr)).toMatchObject({ path: gcr, name: 'disk.g64' });
    await expect(readDiskImage(big)).rejects.toThrow(/big\.d64 is not a \.d64 or \.g64 disk image \(2000000 bytes\)/);
    await expect(readDiskImage(odd)).rejects.toThrow(/not a \.d64 or \.g64 disk image: 300000 bytes/);
    await expect(readDiskImage(prg)).rejects.toThrow(/not a \.d64 or \.g64 disk image: 3 bytes/);
  });
});

const jar = process.env.KICKASS_JAR || findKickAssJar();
const javaOk = !!jar && spawnSync('java', ['-version'], { windowsHide: true }).status === 0;

/** the Exomizer the installer bundles (apps/desktop/vendor/exomizer), on Windows */
const vendorExo = process.platform === 'win32' && existsSync(join(__dirname, '..', 'vendor', 'exomizer', 'exomizer.exe')) ? join(__dirname, '..', 'vendor', 'exomizer', 'exomizer.exe') : null;

describe('toolchain runner', () => {
  it('reports a missing KickAss.jar as a problem instead of failing', async () => {
    const dir = tmp(); const policy = new PathPolicy(); policy.allow(dir);
    const r = await buildWithKickAssembler({ dir, entries: ['x.asm'] }, toolchain({ kickJar: join(dir, 'missing.jar') }), policy);
    expect(r.ok).toBe(false);
    expect(r.problems[0].message).toMatch(/KickAss\.jar not found/);
  });

  it('refuses folders outside the policy', async () => {
    await expect(buildWithKickAssembler({ dir: tmp(), entries: ['x.asm'] }, toolchain(), new PathPolicy())).rejects.toThrow(/outside the folders/);
  });

  it.skipIf(!javaOk)('builds the demo with the real KickAss.jar byte-identical', async () => {
    const p = demoProject();
    const A = analyze(p), R = render(A, p);
    const dir = tmp(); const policy = new PathPolicy(); policy.allow(dir);
    await writeVfs(dir, R.files);
    const r = await buildWithKickAssembler({ dir, entries: ['raster-demo.asm'] }, toolchain({ kickJar: jar! }), policy);
    expect(r.problems).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.commands[0]).toEqual(['java', '-jar', jar, 'raster-demo.asm', '-odir', 'out', '-vicesymbols', '-showmem']);
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
    const r = await buildWithKickAssembler({ dir, entries: ['bad.asm'] }, toolchain({ kickJar: jar! }), policy);
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
