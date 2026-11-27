/* The Assembler (spec 10.7): the script editor (10.3) as an assembler, in the project window. An Assembler project is a
 * folder of Kick Assembler or 64tass sources with its project file: its files are listed beside the code in place of
 * the script editor's library and templates. A file opened there is written in the same editor (highlighting,
 * suggestions and hovers of the program's names, go to a definition in any of the folder's files), checked as it is
 * typed with Mimir's own assembler, and written to its file a moment after the last key, as everything in Mimir is kept
 * as it is made. What the check assembles is the program the project's other views show (Graphics, Memory, the
 * inspector, the Explorer: store/asmlink.ts). Run builds the main file with KickAss.jar or 64tass and starts it in VICE;
 * Debug runs it in Mimir's 6510 (or the whole C64) an instruction at a time, with breakpoints, the registers, the stack
 * and the C64 screen; under the code the problems, the last build and the last run. The start screen's Assembler page
 * (AssemblerHome) makes a new Assembler project, or makes one of a folder of sources. */
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api';
import { AsmC64, asmBlockMarks, asmC64Text, asmCode, asmDebugSources, asmMachineMemory, asmLineCycles, asmLinesRange, asmProgram, asmWriteBytes, cyclePath, cycleText, kindInfo, c64Held, c64Key, FRAME_CYCLES, LINE_CYCLES, PAL_CLOCK, SYM, type AsmProgram, type AsmProjectInfo, type C64Key, type Roms, type VicScreen } from '@mimir/core';
import { ASM_SOURCE, ASM_TEXT, asmAddrOf, asmArgLibdirs, asmDropPath, asmCallSite, asmEndText, asmLineAt, asmMachine, checkAsm, dataFiles, endedWell, h4, LANG_TITLE, mainFile, splitArgs, splitLabel, type Addr, type AsmCheck, type ScriptLang, type ScriptMachine } from '@mimir/core';
import type { AsmChangeRequest, AsmEntry, AsmFolder, AsmStartInfo, BuildResult, GitVersion } from '../../shared/ipc';
import { projectFileName, projectNameProblem } from '../../shared/projects';
import type { MenuItem } from '../lib/types';
import { Icon } from '../lib/icons';
import { cx, errorText, fmtBytes } from '../lib/util';
import { NO_TABS, useAssembler, type AsmMachineKind, type AsmTabs } from '../store/assembler';
import { useAsmLink, type AsmBuilt, type AsmDropped, type AsmInsert } from '../store/asmlink';
import { runScreenSize, useScripts } from '../store/scripts';
import { useUi } from '../store/ui';
import { Splitter } from './Splitter';
import { DebugPanel, regsOf, type DebugRegs } from './ScriptDebug';
import { ScriptScreenPanel } from './ScriptScreen';
import { AsmTabs as TabRow, AsmTree, baseName, fileIcon, isOutsidePath, parentOf, type TreeEdit } from './AsmTree';
import { AsmOutput, type AsmBuild, type AsmBuildProblem, type AsmCycles, type AsmRunKept } from './AsmOutput';
import { AsmBlockDialog, type AsmBlockInsert } from './AsmBlockDialog';
import { Modal } from './Modal';
import type { LibraryRef } from '../store/library';
import { codeLibMacroAt, codeLibTake, definesMacro, isBookmarkColor, kickToTass, type AsmBlockKind, type AsmBookmark, type CodeLibKind } from '@mimir/core';
import { useCodeLib } from '../store/codelib';
import { asmBookmarkSpan } from './AsmBookmarks';

const kr = window.kr;
type MonacoNs = typeof Monaco;
type ToastKind = 'ok' | 'info' | 'warn' | 'err';
type ToastFn = (msg: string, kind?: ToastKind) => void;
type OnMenu = (x: number, y: number, items: MenuItem[]) => void;
/** where a file opens: at a line (and column); `soft`: the debugger's line, scrolled to only when out of view, the
 *  cursor put on it (its line's highlight is then the debugger's line too) and the focus left where it is; `keep`: in
 *  a tab that stays (else in the preview tab, when it is not open yet) */
type OpenAt = { line?: number; col?: number; soft?: boolean; keep?: boolean };

/** files bigger than this are not read as text (no source is this big) */
const TEXT_MAX = 4 * 1024 * 1024;
/** at most this many of the folder's text files are read */
const TEXT_FILES = 800;
/** instructions the debugger runs before it lets the window draw (Continue, Over and Out go on in parts) */
const DEBUG_SLICE = 400_000;
/** how long after the last key a file is written */
const WRITE_MS = 500;

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
/** a file's name in a path of the computer's (\ or /), as baseName is of a path in the folder */
const fileName = (path: string) => path.replace(/^.*[\\/]/, '');
/** `fn` on each of `items`, `n` at a time */
async function inParallel<T>(items: readonly T[], n: number, fn: (t: T) => Promise<void>): Promise<void> {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) await fn(items[i++]); }));
}
/** a path of the folder with `..` and `.` taken out (the assembler's problems name files from the main file's folder) */
const tidyPath = (p: string) => p.split('/').reduce<string[]>((o, s) => { if (s === '..') o.pop(); else if (s && s !== '.') o.push(s); return o; }, []).join('/');
/** the editor's language for a file of the folder */
const editorLang = (path: string, lang: ScriptLang) => ASM_SOURCE.test(path) ? (lang === '64tass' ? 'tass64' : 'kickass')
  : /\.md$/i.test(path) ? 'markdown' : /\.(bat|cmd)$/i.test(path) ? 'bat' : /\.sh$/i.test(path) ? 'shell' : /\.js$/i.test(path) ? 'javascript' : 'plaintext';
const uriOf = (monaco: MonacoNs, path: string) => monaco.Uri.from({ scheme: 'asm', path: `/${path}` });
/** a file the sources import from outside the folder, read only (`asmx:`, by the name the sources give it) */
const outsideUriOf = (monaco: MonacoNs, key: string) => monaco.Uri.from({ scheme: 'asmx', path: `/${encodeURIComponent(key)}` });
const pathOfUri = (uri: Monaco.Uri) => (uri.scheme === 'asm' ? uri.path.replace(/^\//, '') : uri.scheme === 'asmx' ? decodeURIComponent(uri.path.replace(/^\//, '')) : null);
/** whether `full` is the folder `dir` or in it */
const inside = (dir: string, full: string) => { const d = dir.replace(/[\\/]+$/, '').toLowerCase(), f = full.toLowerCase(); return f === d || f.startsWith(`${d}\\`) || f.startsWith(`${d}/`); };
const joinDir = (dir: string, sub: string) => `${dir.replace(/[\\/]+$/, '')}${dir.includes('\\') ? '\\' : '/'}${dir.includes('\\') ? sub.replace(/\//g, '\\') : sub}`;
/** the folder's listing without the project's own project file (Mimir writes it as the project changes: not a file to
 *  open in the editor) */
const withoutProjectFile = (f: AsmFolder, name: string): AsmFolder => {
  const own = projectFileName(name).toLowerCase();
  return { ...f, entries: f.entries.filter(e => e.dir || e.path.toLowerCase() !== own) };
};

/** Continue in the Assembler (spec 10.7): an Assembler project made of the re-assembled program, its blocks marked. */
export interface AsmContinueInfo { name: string; parent: string; lang: ScriptLang; main: string; blocks: number; sources: number }
export function ContinueInAssemblerModal({ info, onCreate, onClose }: { info: AsmContinueInfo; onCreate: (name: string, parent: string, lang: ScriptLang, git: boolean) => Promise<void>; onClose: () => void }) {
  return (
    <Modal title="Continue in the Assembler" onClose={onClose} className="asm-continue">
      <div className="modal-body">
        <p className="small">A new Assembler project of this program: its re-assembled source, which builds the program byte for byte, in a folder of its own, to go on writing as your own. Each block the analysis found that is not code (sprites, charsets, music, tables, text…) is marked in the source (<span className="mono">{info.lang === '64tass' ? ';' : '//'} @block sprite</span> … <span className="mono">@end</span>), so Graphics, Memory and the inspector show it as what it is; the rest is code. This project stays as it is; the new one opens in its place.</p>
        <NewFolderForm parent={info.parent} name={info.name} lang={info.lang} label="Continue in the Assembler" submit="Create and open" onCreate={onCreate} onCancel={onClose}
          makes={where => <>Creates <span className="mono">{where}</span> with its project file and {info.sources === 1 ? 'the source' : `${info.sources} sources`} (<span className="mono">{info.main}</span> the main file, which Run builds), {info.blocks === 1 ? 'a block' : `${info.blocks} blocks`} marked in {info.sources === 1 ? 'it' : 'them'}, and the files they load.</>} />
      </div>
    </Modal>
  );
}

/* ---------------------------------------------------------------------------------------------------------------- */

/** The start screen's Assembler page: a new Assembler project (a folder with a first source), or a folder of sources
 *  opened as one (a dialog, or one opened before): `onCreate` and `onOpen` make the project and open it in the window. */
export function AssemblerHome({ onBack, onCreate, onOpen }: {
  onBack: () => void;
  onCreate: (name: string, parent: string, lang: ScriptLang, git: boolean) => Promise<void>;
  onOpen: (path?: string) => Promise<void>;
}) {
  const [info, setInfo] = useState<AsmStartInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  useEffect(() => { kr?.assemblerStart().then(setInfo, (e: unknown) => setError(errorText(e))); }, []);
  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setError(null);
    try { await fn(); } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  const open = (path?: string) => run(() => onOpen(path));
  const forget = (dir: string) => run(async () => { const recent = await kr!.assemblerForget({ dir }); setInfo(i => i && { ...i, recent }); });
  const recent = info?.recent ?? [];
  return (
    <div className="start asm-home">
      <div className="start-box">
        <div className="qp-head">
          <button className="btn ghost" onClick={onBack} title="Back to the start screen"><Icon name="left" size={14} />Start</button>
          <h1>Assembler</h1>
          <span className="muted">Kick Assembler or 64tass sources, as in the script editor</span>
        </div>
        <p className="asm-home-lead">An Assembler project is a folder of sources with its project file, opened in Mimir's window as any project is: the <b>Assembler</b> tab lists its files beside the code, checks what you type as you type it and writes it to its file at once; <b>Run</b> builds the main file with KickAss.jar or 64tass and starts it in VICE, <b>Debug</b> goes through it a step at a time. Graphics, Memory, the inspector and the Explorer show the program the sources make, and the Git tab its folder. <b>Open folder…</b> makes a folder of sources an Assembler project (its project file is written into it), or opens the project in it.</p>
        {creating && info
          ? <NewFolderForm parent={info.parent} onCreate={onCreate} onCancel={() => setCreating(false)} />
          : <div className="start-actions">
            <button className="btn primary" autoFocus disabled={busy} onClick={() => void open()}><Icon name="folder" size={14} />Open folder…</button>
            <button className="btn" disabled={busy || !info} onClick={() => setCreating(true)}><Icon name="plus" size={14} />New…</button>
          </div>}
        {recent.length > 0 && <section className="start-recent" aria-label="Folders opened before">
          <h2>Opened before</h2>
          <ul>
            {recent.map(r => <li key={r.dir} className={cx('start-row', !r.exists && 'gone')}>
              <button className="sr-open" disabled={busy || !r.exists} onClick={() => void open(r.dir)} title={r.exists ? r.dir : `${r.dir} is not there any more`}>
                <Icon name="folder" size={15} /><span className="sr-name">{r.name}</span><span className="sr-dir mono">{r.exists ? r.dir : 'not found'}</span><span className="sr-when">{new Date(r.opened).toLocaleDateString()}</span>
              </button>
              <button className="icon-btn" aria-label={`Take ${r.name} off the list`} title="Take it off the list (the folder stays as it is)" onClick={() => void forget(r.dir)}><Icon name="x" size={13} /></button>
            </li>)}
          </ul>
        </section>}
        {error && <div className="np-error" role="alert">{error}</div>}
      </div>
    </div>
  );
}

/** A new Assembler project: its name, where its folder goes, the assembler its first source is written for, and a git
 *  repository or none (the box as it was ticked last, as in New project). Continue in the Assembler asks the same, with
 *  the name and language it starts with, its own label, what it makes and its button. */
function NewFolderForm({ parent: parent0, onCreate, onCancel, name: name0 = '', lang: lang0 = 'kickass', label = 'New Assembler project', makes, submit: submitText = 'Create' }: {
  parent: string; onCreate: (name: string, parent: string, lang: ScriptLang, git: boolean) => Promise<void>; onCancel: () => void;
  name?: string; lang?: ScriptLang; label?: string; makes?: (where: string) => ReactNode; submit?: string;
}) {
  const [name, setName] = useState(name0);
  const [parent, setParent] = useState(parent0);
  const [lang, setLang] = useState<ScriptLang>(lang0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const git = useUi(s => s.newProjectGit);
  const [gitFound, setGitFound] = useState<GitVersion | null | undefined>(kr ? undefined : null);
  useEffect(() => { let gone = false; kr?.gitVersion().then(v => { if (!gone) setGitFound(v); }, () => { if (!gone) setGitFound(null); }); return () => { gone = true; }; }, []);
  const withGit = git && !!gitFound;
  const n = name.trim(), problem = projectNameProblem(name);
  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (problem || busy) return;
    setBusy(true); setError(null);
    try { await onCreate(n, parent, lang, withGit); } catch (err) { setError(errorText(err)); setBusy(false); }
  };
  const where = `${parent.replace(/[\\/]+$/, '')}${parent.includes('/') && !parent.includes('\\') ? '/' : '\\'}${n}`;
  return (
    <form className="new-project" onSubmit={submit} aria-label={label}>
      <label className="field"><span>Name</span>
        <input autoFocus value={name} onChange={e => { setName(e.target.value); setError(null); }} placeholder="my-intro" spellCheck={false} className={cx(!!n && problem && 'bad')} aria-invalid={!!n && !!problem} />
      </label>
      <div className="field"><span>Folder it goes in</span>
        <div className="np-parent"><span className="mono" title={parent}>{parent}</span>
          <button type="button" className="btn small" onClick={() => void kr?.projectParent().then(r => { if (r) setParent(r.dir); }, (e: unknown) => setError(errorText(e)))}><Icon name="folder" size={13} />Change…</button></div>
      </div>
      <label className="field"><span>Written for</span>
        <select value={lang} onChange={e => setLang(e.target.value === '64tass' ? '64tass' : 'kickass')} aria-label="Assembler">
          <option value="kickass">Kick Assembler (KickAss.jar)</option><option value="64tass">64tass</option>
        </select>
      </label>
      <label className={cx('check np-git', gitFound === null && 'off')} title={gitFound ? `${gitFound.path} (git ${gitFound.version})` : undefined}>
        <input type="checkbox" checked={withGit} disabled={!gitFound} onChange={e => useUi.getState().set({ newProjectGit: e.target.checked })} />
        <span>Create a git repository (.git) in the folder
          <small className="muted">{gitFound === null
            ? ' — git is not installed: Mimir found no git.exe on PATH or in Program Files (Git for Windows, git-scm.com)'
            : <> — with a <span className="mono">.gitignore</span> that leaves out what the builds and Pack write (<span className="mono">out</span>, <span className="mono">packed</span>, <span className="mono">build</span>). The Git tab stages, commits and pushes.</>}</small>
        </span>
      </label>
      <div className="np-where">{n && !problem
        ? makes ? makes(where) : <>Creates <span className="mono">{where}</span> with its project file and <span className="mono">main.asm</span> in it: a program that prints a line, to start from.</>
        : <span className={cx(n && 'bad')}>{problem}</span>}</div>
      {error && <div className="np-error" role="alert">{error}</div>}
      <div className="np-foot"><span className="grow" /><button type="button" className="btn" onClick={onCancel}>Cancel</button><button type="submit" className="btn primary" disabled={!!problem || busy}>{busy ? 'Creating…' : submitText}</button></div>
    </form>
  );
}

/* ---------------------------------------------------------------------------------------------------------------- */

/** a run of the program going an instruction at a time, in Mimir's 6510 (memory only) or in the whole C64 (AsmC64):
 *  its machine and check, the registers before the last step (what it changed is marked) */
interface Debugging { m: ScriptMachine | AsmC64; c: AsmCheck; prev: DebugRegs | null }

const NO_BOOKMARKS: Record<string, AsmBookmark> = {};
/** how long after the last key the bookmarks' new lines are kept in the project */
const BM_SYNC_MS = 400;
/** the class that gives a bookmark's decorations its colour (--bm): a preset's, or one made for a colour of the user's own */
function bmColorClass(color?: string): string {
  if (!color || !isBookmarkColor(color)) return 'asm-bmc-amber';
  if (!color.startsWith('#')) return `asm-bmc-${color}`;
  const k = `asm-bmc-x${color.slice(1).toLowerCase()}`;
  let st = document.getElementById('asm-bm-colors') as HTMLStyleElement | null;
  if (!st) { st = document.createElement('style'); st.id = 'asm-bm-colors'; document.head.appendChild(st); }
  if (!st.textContent?.includes(`.${k}{`)) st.textContent = `${st.textContent ?? ''}.${k}{--bm:${color}}\n`;
  return k;
}
/** a bookmark's colour as #rrggbb (the overview ruler takes no CSS variable) */
function bmHex(color?: string): string {
  if (color?.startsWith('#')) return color;
  const v = getComputedStyle(document.documentElement).getPropertyValue(`--bm-${color && isBookmarkColor(color) ? color : 'amber'}`).trim();
  return /^#[0-9a-f]{6}$/i.test(v) ? v : '#e5a83b';
}

export interface AssemblerTabProps {
  /** the project's folder, its name */
  dir: string; name: string;
  /** what the project is written for and builds (Project.asm), and a change to it (an undoable step of the project) */
  info: AsmProjectInfo;
  onInfo: (label: string, change: Partial<AsmProjectInfo>) => void;
  /** the tab is shown: its keys work only then (it stays open behind the other tabs, its debugger running) */
  active: boolean;
  toast: ToastFn;
  onMenu: OnMenu;
  /** Release…: the window's dialog of what the build is made into */
  onRelease: () => void;
  /** the arguments in Settings → Toolchain → Assemblers (Mimir's check takes their defines, as it does the project's) */
  toolArgs: { kick: string; tass: string };
  /** Settings at the Assembler project page (the project's language, main file, arguments, where Debug runs) */
  onSettings: () => void;
  /** the bookmarks (info.bookmarks): Ctrl+F2 on a line asks for the editor of the bookmark there (`id`) or of a new one
   *  (`end`: the last line selected); a click on a bookmark's mark shows its note in the list; the bookmarks that moved
   *  with their lines as the code was edited; a file or folder renamed (its bookmarks follow it) */
  onBookmark: (at: { file: string; line: number; end: number | null; id: string | null }) => void;
  onBookmarkSelect: (id: string) => void;
  onBookmarkLines: (moved: Record<string, { line: number; end?: number }>) => void;
  onBookmarksRenamed: (from: string, to: string) => void;
}

/** The Assembler tab of an Assembler project: its folder opened (listed, watched), then the files and the code. */
export function AssemblerTab(p: AssemblerTabProps) {
  const [folder, setFolder] = useState<AsmFolder | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { dir, toast } = p;
  useEffect(() => {
    let gone = false;
    kr?.assemblerOpen({ path: dir }).then(f => { if (!gone && f) setFolder(withoutProjectFile(f, p.name)); }, (e: unknown) => { if (!gone) { setError(errorText(e)); toast(`The project's folder could not be opened: ${errorText(e)}`, 'err'); } });
    return () => { gone = true; void kr?.assemblerClose({ dir }).catch(() => null); useAsmLink.getState().reset(); };
  }, [dir]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!folder) return <div className={cx('scripts asm-ws', !p.active && 'asm-hidden')}><p className={cx('muted small asm-out-p', error && 'err-text')}>{error ?? 'Reading the project\'s folder…'}</p></div>;
  return <AsmWorkspace {...p} folder={folder} onFolder={setFolder} />;
}

interface WorkspaceProps extends AssemblerTabProps {
  folder: AsmFolder;
  onFolder: (f: AsmFolder) => void;
}

function AsmWorkspace({ folder, onFolder, name, info, onInfo, active, toast, onMenu, onRelease, toolArgs, onSettings, onBookmark, onBookmarkSelect, onBookmarkLines, onBookmarksRenamed }: WorkspaceProps) {
  const dir = folder.dir;
  const ui = useAssembler();
  const activeRef = useRef(active); activeRef.current = active;
  const { c64, setC64 } = useScripts();
  const files = useMemo(() => folder.entries.filter(e => !e.dir), [folder.entries]);
  const paths = useMemo(() => new Set(files.map(f => f.path)), [files]);
  const entryOf = useMemo(() => new Map(folder.entries.map(e => [e.path, e])), [folder.entries]);
  // the text files' texts as they are in the editor; what each holds in its file (as read or written last)
  const [texts, setTexts] = useState<Record<string, string>>({});
  const textsRef = useRef(texts); textsRef.current = texts;
  const [bins, setBins] = useState<Record<string, Uint8Array>>({});
  const [loaded, setLoaded] = useState(false);
  const disk = useRef<Record<string, { text: string; mtime: number }>>({});
  // a file's text written a moment after the last key: the timers, and the files waiting
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const [dirty, setDirty] = useState<ReadonlySet<string>>(new Set());
  const [shown, setShownState] = useState<string | null>(ui.shown[dir] ?? null);
  const shownRef = useRef(shown); shownRef.current = shown;
  const [edit, setEdit] = useState<TreeEdit | null>(null);
  const expanded = useMemo(() => new Set(ui.expanded[dir] ?? []), [ui.expanded, dir]);
  const setShown = (p: string | null) => { setShownState(p); useAssembler.getState().setShown(dir, p); };
  // the tabs over the code (AsmTabs): the files open, and the preview among them
  const tabs = ui.tabs[dir] ?? NO_TABS;
  const tabsNow = () => useAssembler.getState().tabs[dir] ?? NO_TABS;
  const setTabs = (t: AsmTabs) => useAssembler.getState().setTabs(dir, t);
  /** a rename going on: where a path of the list goes now (the tabs and the file shown follow it) */
  const moves = useRef<((p: string) => string | null) | null>(null);
  /** the tabs as the listing `now` has the files: one gone is closed (one renamed follows its file), and the file shown
   *  gone, the tab beside it is shown */
  const fixTabs = (listed: { has: (p: string) => boolean }) => {
    // (a file from outside the folder is not in the listing: its tab stays)
    const now = { has: (p: string) => listed.has(p) || isOutsidePath(p) };
    const t = tabsNow(), mv = moves.current, s = shownRef.current;
    const at = (p: string) => (now.has(p) ? p : (q => (q && now.has(q) ? q : null))(mv?.(p) ?? null));
    const open: string[] = [];
    let preview: string | null = null;
    for (const p of t.open) { const q = at(p); if (q && !open.includes(q)) { open.push(q); if (p === t.preview) preview = q; } }
    if (open.length !== t.open.length || open.some((p, i) => p !== t.open[i]) || preview !== t.preview) setTabs({ open, preview });
    if (s && !now.has(s)) { const q = at(s); setShown(q ?? open[Math.min(Math.max(0, t.open.indexOf(s)), open.length - 1)] ?? null); }
  };

  /* ---- the files: read when the folder opens, written as they are typed, read again when they change outside ---- */
  useEffect(() => {
    let gone = false;
    void (async () => {
      const want = files.filter(f => ASM_TEXT.test(f.path) && f.size <= TEXT_MAX).slice(0, TEXT_FILES);
      const out: Record<string, string> = {};
      await inParallel(want, 8, async f => {
        try { const r = await kr!.assemblerRead({ dir, path: f.path }); out[f.path] = r.text ?? ''; disk.current[f.path] = { text: r.text ?? '', mtime: r.mtime }; }
        catch (e) { toast(`${f.path} could not be read: ${errorText(e)}`, 'warn'); }
      });
      if (gone) return;
      setTexts(out); setLoaded(true);
    })();
    return () => { gone = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const write = async (path: string): Promise<void> => {
    clearTimeout(timers.current[path]); delete timers.current[path];
    // (the text taken now: the editor may be gone by the time the write is done)
    const m = models.current[path], text = m && !m.isDisposed() ? m.getValue() : textsRef.current[path];
    const done = () => { if (!timers.current[path]) setDirty(d => { if (!d.has(path)) return d; const n = new Set(d); n.delete(path); return n; }); };
    if (text == null || disk.current[path]?.text === text) { done(); return; }
    try { const r = await kr!.assemblerWrite({ dir, path, text }); disk.current[path] = { text, mtime: r.mtime }; }
    catch (e) { toast(`${path} was not written: ${errorText(e)}`, 'err'); return; }
    done();
  };
  const writeAll = () => Promise.all(Object.keys(timers.current).map(write));
  // the window or the project closing: what is not written yet is written first
  const flushRef = useRef(writeAll); flushRef.current = writeAll;
  useEffect(() => { useAsmLink.getState().set({ flush: () => flushRef.current(), buildPrg: () => buildRef.current() }); }, []);
  const buildRef = useRef<() => Promise<AsmBuilt | null>>(() => Promise.resolve(null));
  const schedule = (path: string) => {
    clearTimeout(timers.current[path]);
    timers.current[path] = setTimeout(() => void write(path), WRITE_MS);
    setDirty(d => (d.has(path) ? d : new Set([...d, path])));
  };

  /** what the listing says is new, changed or gone: text files read (a file with changes of its own not written yet
   *  keeps them), data files read again, and those gone dropped */
  const takeListing = async (f: AsmFolder) => {
    const now = new Map(f.entries.filter(e => !e.dir).map(e => [e.path, e]));
    const gone = Object.keys(textsRef.current).filter(p => !now.has(p));
    const read: Record<string, string> = {};
    const todo = [...now.values()].filter(e => ASM_TEXT.test(e.path) && e.size <= TEXT_MAX && !timers.current[e.path]
      && (!(e.path in textsRef.current) || Math.abs((disk.current[e.path]?.mtime ?? 0) - e.mtime) > 1));
    await inParallel(todo, 8, async e => {
      try {
        const r = await kr!.assemblerRead({ dir, path: e.path }), text = r.text ?? '';
        const was = disk.current[e.path];
        disk.current[e.path] = { text, mtime: r.mtime };
        if (!was || was.text !== text || !(e.path in textsRef.current)) read[e.path] = text;
      } catch { /* gone again, or not readable: the next listing says */ }
    });
    for (const p of gone) delete disk.current[p];
    // the data the sources load, read again when it changed
    setBins(b => { let n: Record<string, Uint8Array> | null = null; for (const p of Object.keys(b)) if (!now.has(p) || (now.get(p)!.mtime !== binTimes.current[p])) { n ??= { ...b }; delete n[p]; tried.current.delete(p); } return n ?? b; });
    // the tabs of files gone are closed, those renamed follow them
    fixTabs(now);
    if (!Object.keys(read).length && !gone.length) return;
    // a file changed outside the app: the editor takes its text (undo goes back to what it had)
    for (const [p, text] of Object.entries(read)) {
      const m = models.current[p];
      // (a file changed outside: its bookmarks go back to the lines kept, as nothing says where its lines went)
      if (m && !m.isDisposed() && m.getValue() !== text) { applying.current = true; m.pushEditOperations([], [{ range: m.getFullModelRange(), text }], () => null); m.pushStackElement(); applying.current = false; dropBmDecos(p); }
    }
    setTexts(t => { const n = { ...t }; for (const p of gone) delete n[p]; for (const [p, text] of Object.entries(read)) n[p] = text; return n; });
  };
  const relistTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const relist = async () => {
    let f: AsmFolder;
    try { f = withoutProjectFile(await kr!.assemblerList({ dir }), name); } catch { return; }
    onFolder(f);
    await takeListing(f);
  };
  // changes made outside the app (another editor, the build writing out\): the list and the files read again
  useEffect(() => kr?.onFsChanged(e => { if (!inside(dir, e.path)) return; clearTimeout(relistTimer.current); relistTimer.current = setTimeout(() => void relist(), 300); }), [dir]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => clearTimeout(relistTimer.current), []);

  /* ---- the main file, the language, the data the sources load, the check ---- */
  // the texts as they stood a moment after the last key: what the check takes
  const [quiet, setQuiet] = useState(texts);
  useEffect(() => { const t = setTimeout(() => setQuiet(texts), 180); return () => clearTimeout(t); }, [texts]);
  const guessed = useMemo(() => mainFile(Object.entries(quiet).map(([path, text]) => ({ path, text }))), [quiet]);
  const chosen = info.main ?? null;
  const main = chosen && paths.has(chosen) ? chosen : guessed;
  const lang: ScriptLang = info.lang;
  const binTimes = useRef<Record<string, number>>({});
  const tried = useRef(new Set<string>());
  const wanted = useMemo(() => dataFiles(Object.entries(quiet).filter(([p]) => ASM_SOURCE.test(p)).map(([path, text]) => ({ path, text })), paths), [quiet, paths]);
  useEffect(() => {
    const need = wanted.filter(p => !bins[p] && !tried.current.has(p));
    if (!need.length) return;
    for (const p of need) tried.current.add(p);
    void Promise.all(need.map(p => kr!.assemblerRead({ dir, path: p, as: 'bytes' }).then(r => [p, r] as const, () => null))).then(rs => {
      setBins(b => { const n = { ...b }; for (const r of rs) if (r?.[1].bytes) { n[r[0]] = r[1].bytes; binTimes.current[r[0]] = entryOf.get(r[0])?.mtime ?? r[1].mtime; } return n; });
    });
  }, [wanted, bins]); // eslint-disable-line react-hooks/exhaustive-deps
  // the blocks marked in the sources (// @block sprite … // @end): the project's views show their bytes as what they are
  const blocks = useMemo(() => asmBlockMarks(Object.entries(quiet).filter(([p]) => ASM_SOURCE.test(p)).map(([path, text]) => ({ path, text }))), [quiet]);
  // the arguments the build gives the assembler: the toolchain's, then the project's (the check takes their defines)
  const own = info.args ?? '', theirs = lang === '64tass' ? toolArgs.tass : toolArgs.kick;
  const args = useMemo(() => [...splitArgs(theirs), ...splitArgs(own)], [theirs, own]);
  // what the sources import from outside the folder (`#import "C:\lib\irq.asm"`, `../lib`, a library folder of the
  // arguments: -libdir, -I), read as the build reads it, by the names the sources give them; read again when the window
  // comes back (they may have been changed in another editor)
  const [outside, setOutside] = useState<Record<string, string | Uint8Array>>({});
  const outsideRef = useRef(outside); outsideRef.current = outside;
  /** the names asked for already (found or not), and where each was found */
  const askedOut = useRef(new Set<string>()), foundOut = useRef<Record<string, string>>({});
  const libdirs = useMemo(() => asmArgLibdirs(lang, args), [lang, args]);
  const check = useMemo<AsmCheck | null>(() => {
    if (!loaded || !main || !(main in quiet)) return null;
    try { return checkAsm({ ...quiet, ...bins, ...outside }, main, lang, { args }); } catch { return null; }
  }, [quiet, bins, outside, main, lang, loaded, args]);
  const readOutside = (names: string[]) => {
    if (!kr || !names.length) return;
    for (const k of names) askedOut.current.add(k);
    void Promise.all(names.map(k => kr!.assemblerReadOutside({ dir, path: k, libdirs }).then(r => [k, r] as const, () => null))).then(rs => {
      const got: Record<string, string | Uint8Array> = {};
      for (const r of rs) { const d = r?.[1]; if (!r || !d?.found) continue; foundOut.current[r[0]] = d.found; const v = d.text ?? d.bytes; if (v != null) got[r[0]] = v; }
      if (Object.keys(got).length) setOutside(o => {
        // (only what changed: the same texts take no new check)
        const n = { ...o }; let changed = false;
        for (const [k, v] of Object.entries(got)) if (typeof v === 'string' ? n[k] !== v : !(n[k] instanceof Uint8Array && n[k].length === v.length && n[k].every((b, i) => b === v[i]))) { n[k] = v; changed = true; }
        return changed ? n : o;
      });
    });
  };
  useEffect(() => {
    // (another library folder: what was not found is looked for again; before the check's files are asked for, below)
    askedOut.current = new Set(Object.keys(outside));
  }, [libdirs.join('\n')]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { readOutside((check?.missing ?? []).filter(k => !askedOut.current.has(k) && !paths.has(k))); }, [check]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const again = () => { askedOut.current = new Set(); readOutside([...new Set([...Object.keys(outside), ...(check?.missing ?? []).filter(k => !paths.has(k))])]); };
    window.addEventListener('focus', again);
    return () => window.removeEventListener('focus', again);
  });
  // the names the editor suggests and the hover says: the program's labels and constants (the last check that had them)
  useEffect(() => {
    if (!check?.names.size) return;
    const kinds = new Map<string, string>();
    for (const [n, v] of check.names) {
      const l = v >= 0 && v < 0x10000 && check.asm.written[v] ? asmLineAt(check, v) : null;
      kinds.set(n, l ? `a label · ${l.file} line ${l.line}` : 'a constant');
    }
    void import('../monaco/providers').then(({ asmContext }) => { asmContext.names = check.names; asmContext.kinds = kinds; asmContext.notify = msg => toast(msg, 'warn'); });
  }, [check]);
  // the program the sources make, to the project's views (Graphics, Memory, the inspector, the Explorer): the last check
  // that assembled, a moment after it (the analysis of it runs in its worker), and only when it is another program
  const sent = useRef<{ key: string; prog: AsmProgram } | null>(null);
  useEffect(() => {
    const link = useAsmLink.getState();
    link.set({ assembles: !!check?.ok });
    if (!check?.ok || !main) return;
    const t = setTimeout(() => {
      const prog = asmProgram(check, main, blocks.marks), f = prog.files[0];
      const key = `${f ? `${f.load}:${f.bytes.join(',')}` : ''}|${JSON.stringify(prog.overrides)}|${JSON.stringify(prog.labels)}|${prog.entryPoint}`;
      if (sent.current?.key === key) { useAsmLink.getState().set({ check }); return; }
      sent.current = { key, prog };
      useAsmLink.getState().set({ program: prog, check });
    }, 350);
    return () => clearTimeout(t);
  }, [check, main, blocks]);

  /* ---- the editor ---- */
  const host = useRef<HTMLDivElement>(null);
  const editRow = useRef<HTMLDivElement>(null);
  const monacoRef = useRef<MonacoNs | null>(null);
  const ed = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const models = useRef<Record<string, Monaco.editor.ITextModel>>({});
  const views = useRef<Record<string, Monaco.editor.ICodeEditorViewState | null>>({});
  const [state, setState] = useState<'loading' | 'ready' | 'fallback'>('loading');
  const applying = useRef(false);
  /** a line to show once its file is in the editor */
  /** (`soft`: the debugger's line, scrolled to only when it is out of view, the focus left where it is) */
  const reveal = useRef<{ path: string; line: number; col?: number; soft?: boolean } | null>(null);
  /** what the editor's keys and the gutter do (the editor is made once; these change every render) */
  const keys = useRef({ debugger: () => { }, block: () => { }, run: () => { }, build: () => { }, step: () => { }, over: () => { }, out: () => { }, cont: () => { }, toggleBp: (_line: number) => { }, write: () => { }, open: (_p: string, _o?: OpenAt) => { }, tab: (_step: number) => { }, closeTab: () => { },
    bookmark: () => { }, bmJump: (_dir: 1 | -1) => { }, bmClick: (_line: number) => { }, bmSync: () => { }, bmFlush: () => { }, codeLib: (_kind: CodeLibKind) => { } });

  useEffect(() => {
    if (!loaded) return;
    let alive = true, opener: Monaco.IDisposable | null = null;
    import('../monaco/setup').then(async ({ monaco }) => {
      if (!alive || !host.current) return;
      const { applyMonacoTheme } = await import('../monaco/theme');
      monacoRef.current = monaco;
      applyMonacoTheme(monaco, document.documentElement.dataset.theme !== 'light');
      const editor = monaco.editor.create(host.current, {
        model: null, theme: 'mimir', automaticLayout: true, fontFamily: "'JetBrains Mono', ui-monospace, Consolas, monospace",
        fontSize: 13, lineHeight: 20, minimap: { enabled: false }, scrollBeyondLastLine: false, renderLineHighlight: 'all',
        smoothScrolling: true, padding: { top: 8 }, guides: { indentation: false }, stickyScroll: { enabled: false }, mouseWheelZoom: true,
        tabSize: 8, insertSpaces: true, quickSuggestions: { other: true, comments: false, strings: false }, wordBasedSuggestions: 'off', acceptSuggestionOnEnter: 'off', tabCompletion: 'off', suggestOnTriggerCharacters: true,
        glyphMargin: true,
      });
      ed.current = editor;
      editor.onDidChangeModelContent(() => {
        const m = editor.getModel(), path = m ? pathOfUri(m.uri) : null;
        // (a file from outside the folder is read only: nothing of it is written)
        if (applying.current || !m || !path || m.uri.scheme === 'asmx') return;
        const text = m.getValue();
        setTexts(t => ({ ...t, [path]: text }));
        schedule(path);
        keys.current.bmSync();
        // a preview typed in is kept open
        const t = tabsNow();
        if (t.preview === path) setTabs({ ...t, preview: null });
      });
      // Ctrl+Enter runs (debugging: goes on), Ctrl+Shift+B builds, Ctrl+S writes now; F8 steps (and starts debugging),
      // F6 steps over a JSR, Shift+F6 out of one
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => { editor.trigger('run', 'hideSuggestWidget', null); if (dbgRef.current) keys.current.cont(); else keys.current.run(); });
      editor.addCommand(monaco.KeyCode.F5, () => keys.current.run());
      editor.addCommand(monaco.KeyMod.Shift | monaco.KeyCode.F5, () => keys.current.debugger());
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyB, () => keys.current.build());
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => keys.current.write());
      editor.addCommand(monaco.KeyCode.F8, () => keys.current.step());
      editor.addCommand(monaco.KeyCode.F6, () => keys.current.over());
      editor.addCommand(monaco.KeyMod.Shift | monaco.KeyCode.F6, () => keys.current.out());
      // the tabs: Ctrl+Tab and Ctrl+PageDown the next, with Shift and Ctrl+PageUp the one before, Ctrl+F4 closes it
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Tab, () => keys.current.tab(1));
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.Tab, () => keys.current.tab(-1));
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.PageDown, () => keys.current.tab(1));
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.PageUp, () => keys.current.tab(-1));
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.F4, () => keys.current.closeTab());
      // the lines chosen (Cycles counts them)
      editor.onDidChangeCursorSelection(ev => {
        const m = editor.getModel(), p = m ? pathOfUri(m.uri) : null;
        const sel = p ? { file: p, from: ev.selection.startLineNumber, to: ev.selection.endColumn === 1 && ev.selection.endLineNumber > ev.selection.startLineNumber ? ev.selection.endLineNumber - 1 : ev.selection.endLineNumber } : null;
        setSelLines(sel);
        // (the caret's line and the lines selected: the bookmark editor can take them)
        useAsmLink.getState().set({ caret: p ? { file: p, line: ev.selection.positionLineNumber } : null, selection: sel });
      });
      // the editor's menu: a block of sprites, a charset, a bitmap, music … put in where the caret is
      editor.addAction({ id: 'mimir.insertBlock', label: 'Insert block…', contextMenuGroupId: '1_modification', contextMenuOrder: 0, run: () => keys.current.block() });
      // bookmarks, as the re-assembler's on its lines: Ctrl+F2 adds or edits the one on the caret's line (a selection: an
      // area), Alt+F2 / Alt+Shift+F2 go to the next / previous one (F2 renames here)
      editor.addAction({ id: 'mimir.bookmark', label: 'Bookmark this line…', keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.F2], contextMenuGroupId: '1_modification', contextMenuOrder: 0.5, run: () => keys.current.bookmark() });
      // the macro and code libraries (10.8): the lines selected (none: the macro the caret is in) made an item of one
      editor.addAction({ id: 'mimir.codeLibMacro', label: 'Add to the macro library…', contextMenuGroupId: '1_modification', contextMenuOrder: 0.6, run: () => keys.current.codeLib('macro') });
      editor.addAction({ id: 'mimir.codeLibCode', label: 'Add to the code library…', contextMenuGroupId: '1_modification', contextMenuOrder: 0.7, run: () => keys.current.codeLib('code') });
      editor.addCommand(monaco.KeyMod.Alt | monaco.KeyCode.F2, () => keys.current.bmJump(1));
      editor.addCommand(monaco.KeyMod.Alt | monaco.KeyMod.Shift | monaco.KeyCode.F2, () => keys.current.bmJump(-1));
      // a click in the gutter left of the line numbers sets or clears a breakpoint
      editor.onMouseDown(ev => {
        if (ev.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN && ev.target.position) keys.current.toggleBp(ev.target.position.lineNumber);
        // (a bookmark's mark, right of the line numbers: its note in the list)
        else if (ev.target.type === monaco.editor.MouseTargetType.GUTTER_LINE_DECORATIONS && ev.target.position) keys.current.bmClick(ev.target.position.lineNumber);
      });
      // a definition in another of the folder's files (F12, Ctrl+click): that file in the editor, at it
      opener = monaco.editor.registerEditorOpener({
        openCodeEditor(_from, resource, at) {
          const p = pathOfUri(resource); if (!p) return false;
          const pos = at && 'startLineNumber' in at ? { line: at.startLineNumber, col: at.startColumn } : at ? { line: at.lineNumber, col: at.column } : { line: 1, col: 1 };
          keys.current.open(p, { line: pos.line, col: pos.col });
          return true;
        },
      });
      if (document.fonts?.ready) void document.fonts.ready.then(() => monaco.editor.remeasureFonts());
      setState('ready');
    }).catch(() => { if (alive) setState('fallback'); });
    return () => {
      alive = false; opener?.dispose();
      void writeAll();
      keys.current.bmFlush();
      for (const [p, m] of Object.entries(models.current)) if (!m.isDisposed()) useAssembler.getState().setBps(dir, p, bpLines(p));
      ed.current?.dispose(); ed.current = null; pcDeco.current = null;
      Object.values(models.current).forEach(m => m.dispose()); models.current = {};
    };
  }, [loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  // a model for each text file (the definitions are looked for in all of them), in its language
  useEffect(() => {
    const monaco = monacoRef.current;
    if (state !== 'ready' || !monaco) return;
    for (const [p, text] of Object.entries(texts)) if (!models.current[p]) {
      const m = models.current[p] = monaco.editor.createModel(text, editorLang(p, lang), uriOf(monaco, p));
      // a change in a file the editor does not show (a rename, F2, in all the files): written as typing is
      m.onDidChangeContent(() => { if (applying.current || m.isDisposed() || ed.current?.getModel() === m) return; setTexts(t => ({ ...t, [p]: m.getValue() })); schedule(p); keys.current.bmSync(); });
      bpIds.current[p] = []; setBps(p, useAssembler.getState().bps[`${dir}|${p}`] ?? [], m);
    }
    // the sources imported from outside the folder: read only (`asmx:`), their texts as read again
    for (const [p, text] of Object.entries(outside)) {
      if (typeof text !== 'string') continue;
      const m = models.current[p];
      if (!m) { models.current[p] = monaco.editor.createModel(text, editorLang(p, lang), outsideUriOf(monaco, p)); bpIds.current[p] = []; setBps(p, useAssembler.getState().bps[`${dir}|${p}`] ?? [], models.current[p]); }
      else if (m.getValue() !== text) { applying.current = true; m.setValue(text); applying.current = false; }
    }
    for (const p of Object.keys(models.current)) if (!(p in texts) && typeof outside[p] !== 'string') { models.current[p].dispose(); delete models.current[p]; delete views.current[p]; }
    for (const [p, m] of Object.entries(models.current)) { const l = editorLang(p, lang); if (m.getLanguageId() !== l) monaco.editor.setModelLanguage(m, l); }
  }, [state, texts, lang, outside]); // eslint-disable-line react-hooks/exhaustive-deps

  // the files open when the folder opens: the tabs it had (those still there) and the file shown last, else the main
  // file (or the first source)
  useEffect(() => {
    if (!loaded || opened.current) return;
    opened.current = true;
    // (a file from outside the folder keeps its tab: it is read once the check asks for it)
    const t = tabsNow(), open = t.open.filter(p => paths.has(p) || isOutsidePath(p));
    // (the main file found from the texts as they are: the check's lag a moment behind)
    const first = () => (chosen && paths.has(chosen) ? chosen : mainFile(Object.entries(texts).map(([path, text]) => ({ path, text })))) ?? Object.keys(texts)[0] ?? null;
    const p = shown && paths.has(shown) ? shown : open[0] ?? first();
    setTabs({ open: p && !open.includes(p) ? [...open, p] : open, preview: t.preview && open.includes(t.preview) ? t.preview : null });
    if (p) openFile(p, { keep: true }); else setShown(null);
  }, [loaded]); // eslint-disable-line react-hooks/exhaustive-deps
  const opened = useRef(false);
  // the shown file's model in the editor (where it was in it kept for each file), and a line asked for shown
  useEffect(() => {
    const e = ed.current;
    if (state !== 'ready' || !e) return;
    const m = shown ? models.current[shown] ?? null : null, cur = e.getModel();
    if (cur !== m) {
      const was = cur ? pathOfUri(cur.uri) : null;
      if (was && cur && !cur.isDisposed()) views.current[was] = e.saveViewState();
      e.setModel(m);
      if (m && shown && views.current[shown]) e.restoreViewState(views.current[shown]);
    }
    const r = reveal.current;
    if (m && r && r.path === shown) {
      reveal.current = null;
      const n = Math.min(r.line, m.getLineCount());
      // (the debugger's line: the cursor on it too, or the cursor's line, highlighted as well, looks like a second one)
      requestAnimationFrame(() => { if (r.soft) { e.revealLineInCenterIfOutsideViewport(n); e.setPosition({ lineNumber: n, column: r.col ?? 1 }); return; } e.revealLineInCenter(n); e.setPosition({ lineNumber: n, column: r.col ?? 1 }); e.focus(); });
    }
  });

  /** a file opened in the editor (its folders opened in the list), in its tab: one open already, else the preview tab
   *  (a file put in its place) or, `keep`, a new tab after the one shown; at a line (OpenAt) */
  const openFile = (path: string, o: OpenAt = {}) => {
    // (a problem in the arguments: they are in Settings)
    if (path === '<command line>') { onSettings(); return; }
    // (a file the sources import from outside the folder: a source is shown read only in a tab of its own; data, or one
    // not read, is said where it is)
    if (!paths.has(path) && (path in outside || isOutsidePath(path))) {
      if (typeof outside[path] !== 'string') { toast(`${foundOut.current[path] ?? path} is outside the project's folder${path in outside ? '' : ' and was not found'}: Mimir's check reads it as the build does`, 'info'); return; }
      placeTab(path, !!o.keep);
      if (o.line) reveal.current = { path, line: o.line, col: o.col, soft: o.soft };
      if (path !== shownRef.current) setShown(path); else if (o.line) setTick(t => t + 1);
      return;
    }
    const ups: string[] = [];
    for (let p = parentOf(path); p; p = parentOf(p)) ups.push(p);
    if (ups.some(p => !expanded.has(p))) ui.setExpanded(dir, [...new Set([...expanded, ...ups])]);
    placeTab(path, !!o.keep);
    if (o.line) reveal.current = { path, line: o.line, col: o.col, soft: o.soft };
    if (path !== shownRef.current) setShown(path);
    else if (o.line) setTick(t => t + 1);
  };
  /** `path` given a tab (see openFile) */
  const placeTab = (path: string, keep: boolean) => {
    const t = tabsNow();
    if (t.open.includes(path)) { if (keep && t.preview === path) setTabs({ ...t, preview: null }); return; }
    // the preview's place, unless it has changes not written yet (it is kept then)
    if (!keep && t.preview && t.open.includes(t.preview) && !timers.current[t.preview]) { setTabs({ open: t.open.map(p => (p === t.preview ? path : p)), preview: path }); return; }
    const at = shownRef.current ? t.open.indexOf(shownRef.current) : -1;
    setTabs({ open: at >= 0 ? [...t.open.slice(0, at + 1), path, ...t.open.slice(at + 1)] : [...t.open, path], preview: keep ? (t.preview && timers.current[t.preview] ? null : t.preview) : path });
  };
  /** tabs closed (what is not written yet is written first); the tab shown closed, the one after it (or before it) is shown */
  const closeTabs = (closing: readonly string[]) => {
    for (const p of closing) if (timers.current[p]) void write(p);
    const t = tabsNow(), open = t.open.filter(p => !closing.includes(p)), s = shownRef.current;
    setTabs({ open, preview: t.preview && !closing.includes(t.preview) ? t.preview : null });
    for (const p of closing) delete views.current[p];
    if (s && closing.includes(s)) { const i = t.open.indexOf(s); setShown(open[Math.min(i, open.length - 1)] ?? null); }
  };
  /** the tab `step` places on from the one shown (round the row) */
  const stepTab = (step: number) => {
    const t = tabsNow(); if (!t.open.length) return;
    const i = shownRef.current ? t.open.indexOf(shownRef.current) : -1;
    setShown(t.open[((i < 0 ? 0 : i + step) % t.open.length + t.open.length) % t.open.length]);
  };
  /** a tab dragged to before another (null: to the end) */
  const moveTab = (path: string, before: string | null) => {
    if (path === before) return;
    const t = tabsNow(), rest = t.open.filter(p => p !== path), i = before ? rest.indexOf(before) : rest.length;
    setTabs({ ...t, open: [...rest.slice(0, i < 0 ? rest.length : i), path, ...rest.slice(i < 0 ? rest.length : i)] });
  };
  const tabMenu = (x: number, y: number, path: string) => {
    const t = tabsNow(), i = t.open.indexOf(path), source = ASM_SOURCE.test(path);
    onMenu(x, y, [
      { label: 'Close', key: 'Ctrl+F4', icon: 'x', run: () => closeTabs([path]) },
      { label: 'Close the others', run: () => closeTabs(t.open.filter(p => p !== path)) },
      { label: 'Close those to the right', run: () => closeTabs(t.open.slice(i + 1)) },
      { label: 'Close all', run: () => closeTabs(t.open) },
      ...(t.preview === path ? [{ label: 'Keep it open', icon: 'pin' as const, run: () => setTabs({ ...t, preview: null }) }] : []),
      { sep: true },
      ...(source ? [{ label: 'Main file: Run and Build build it', checked: path === main, run: () => { onInfo('Main file', { main: path }); toast(`${path} is the main file: Run and Build build it`, 'ok'); } }] : []),
      { label: 'Show in the list', icon: 'files', run: () => { openFile(path); requestAnimationFrame(() => document.querySelector<HTMLElement>(`.asm-tree [data-path="${CSS.escape(path)}"]`)?.focus()); } },
      { label: 'Show in folder', icon: 'folder', run: () => void kr?.assemblerReveal({ dir, path }).catch((err: unknown) => toast(errorText(err), 'err')) },
      { label: 'Copy path', icon: 'copy', run: () => { const full = joinDir(dir, path); void navigator.clipboard.writeText(full).then(() => toast(`Copied ${full}`, 'ok')); } },
    ]);
  };

  // the problems as markers on their lines: what Mimir's check finds, and what the last build found
  const [build, setBuild] = useState<AsmBuild | null>(null);
  // the C64 checks (the window's analysis of the program) at the lines that write their bytes
  const c64Notes = useAsmLink(s => s.notes);
  const notes = useMemo(() => c64Notes.map(n => { const l = check ? asmLineAt(check, n.addr) : null; return { file: l?.file ?? '', line: l?.line ?? 0, level: n.level, msg: n.msg }; }), [c64Notes, check]);
  useEffect(() => {
    const monaco = monacoRef.current;
    if (state !== 'ready' || !monaco) return;
    for (const [p, m] of Object.entries(models.current)) {
      if (m.isDisposed()) continue;
      const on = (line: number) => line > 0 && line <= m.getLineCount();
      monaco.editor.setModelMarkers(m, 'asm-check', [...(check?.problems ?? []).map(x => ({ ...x, warn: false })), ...(check?.warnings ?? []).map(x => ({ ...x, warn: true }))].filter(x => x.file === p && on(x.line)).map(x => ({
        severity: x.warn ? monaco.MarkerSeverity.Warning : monaco.MarkerSeverity.Error, message: x.msg, source: 'Mimir\'s check', startLineNumber: x.line, startColumn: 1, endLineNumber: x.line, endColumn: m.getLineMaxColumn(x.line),
      })));
      monaco.editor.setModelMarkers(m, 'asm-c64', notes.filter(x => x.file === p && on(x.line)).map(x => ({
        severity: x.level === 'warning' ? monaco.MarkerSeverity.Warning : monaco.MarkerSeverity.Info, message: x.msg, source: 'Mimir\'s C64 check', startLineNumber: x.line, startColumn: 1, endLineNumber: x.line, endColumn: m.getLineMaxColumn(x.line),
      })));
      monaco.editor.setModelMarkers(m, 'asm-blocks', blocks.warnings.filter(x => x.file === p && on(x.line)).map(x => ({
        severity: monaco.MarkerSeverity.Warning, message: x.msg, source: 'Mimir', startLineNumber: x.line, startColumn: 1, endLineNumber: x.line, endColumn: m.getLineMaxColumn(x.line),
      })));
      // a block's lines: a bar in its kind's colour beside them, what it is on its mark
      const lines = m.getLineCount();
      // (what the block is said on its @block line only: a hover over each of its lines would come with every name's)
      blockDecos.current[p] = m.deltaDecorations(blockDecos.current[p] ?? [], blocks.marks.filter(x => x.file === p && x.line <= lines).flatMap(x => [{
        range: new monaco.Range(x.line, 1, Math.min(x.end, lines), 1),
        options: { isWholeLine: true, linesDecorationsClassName: `asm-blk g-${kindInfo(x.kind).group}` },
      }, {
        range: new monaco.Range(x.line, 1, x.line, m.getLineMaxColumn(x.line)),
        options: { hoverMessage: { value: `A block of ${kindInfo(x.kind).label.toLowerCase()}, lines ${x.line}-${Math.min(x.end, lines)}: Graphics, Memory, the inspector and the Explorer show its bytes as that. The rest of the program is code.` } },
      }]));
      monaco.editor.setModelMarkers(m, 'asm-build', (build?.problems ?? []).filter(x => x.file === p && on(x.line)).map(x => ({
        severity: x.severity === 'error' ? monaco.MarkerSeverity.Error : monaco.MarkerSeverity.Warning, message: x.msg, source: build!.tool,
        startLineNumber: x.line, startColumn: Math.max(1, x.column || 1), endLineNumber: x.line, endColumn: m.getLineMaxColumn(x.line),
      })));
    }
  }, [check, build, state, texts, blocks, notes]);
  const blockDecos = useRef<Record<string, string[]>>({});
  const problemsOf = useMemo(() => {
    const n = new Map<string, number>();
    for (const p of check?.problems ?? []) if (p.file) n.set(p.file, (n.get(p.file) ?? 0) + 1);
    for (const p of build?.problems ?? []) if (p.file && p.severity === 'error') n.set(p.file, (n.get(p.file) ?? 0) + 1);
    return n;
  }, [check, build]);

  /* ---- the files' changes from the list: new, renamed, deleted ---- */
  const change = async (req: AsmChangeRequest, done?: string): Promise<boolean> => {
    try { const f = withoutProjectFile(await kr!.assemblerChange(req), name); onFolder(f); await takeListing(f); if (done) toast(done, 'ok'); return true; }
    catch (e) { toast(errorText(e), 'err'); return false; }
  };
  /** what a menu's New goes into: a folder's own path, a file's folder */
  const folderOf = (e: AsmEntry | null) => (e ? (e.dir ? e.path : parentOf(e.path)) : '');
  const newIn = (parent: string, kind: 'file' | 'folder') => {
    if (parent && !expanded.has(parent)) ui.setExpanded(dir, [...expanded, parent]);
    setEdit({ kind, parent });
  };
  /** the name typed in the list (or the toolbar) for what `e` makes or renames */
  const named = async (name: string | null, e: TreeEdit | null = edit) => {
    setEdit(null);
    if (!e || !name) return;
    if (/^[\\/]|\.\.|[<>:"|?*]/.test(name)) { toast(`"${name}" cannot be a name here: no < > : " | ? * or ..`, 'warn'); return; }
    const clean = name.replace(/\\/g, '/');
    if (e.kind === 'rename') {
      const to = tidyPath(parentOf(e.path) ? `${parentOf(e.path)}/${clean}` : clean);
      if (to === e.path) return;
      await renameTo(e.path, to);
      return;
    }
    const path = tidyPath(e.parent ? `${e.parent}/${clean}` : clean);
    // a file without an extension is a source
    const file = e.kind === 'file' && !/\.[^./]+$/.test(baseName(path)) ? `${path}.asm` : path;
    if (await change(e.kind === 'file' ? { dir, op: 'file', path: file, text: '' } : { dir, op: 'folder', path })) {
      if (e.kind === 'file') openFile(file, { keep: true });
      else ui.setExpanded(dir, [...expanded, path]);
    }
  };
  /** a file or folder renamed: what is not written yet is first; the editor, the main file and the list follow it */
  const renameTo = async (from: string, to: string) => {
    const under = (p: string) => p === from || p.startsWith(`${from}/`);
    // (where the bookmarks are now kept first: they follow the files)
    keys.current.bmFlush();
    await Promise.all(Object.keys(timers.current).filter(under).map(write));
    const moved = (p: string) => `${to}${p.slice(from.length)}`;
    // (the tabs, the file shown and where it was shown follow the files: fixTabs asks where each went)
    moves.current = p => (under(p) ? moved(p) : null);
    for (const p of Object.keys(views.current)) if (under(p)) views.current[moved(p)] = views.current[p];
    try { if (!await change({ dir, op: 'rename', path: from, to }, `${from} is ${to} now`)) return; } finally { moves.current = null; }
    if (chosen && under(chosen)) onInfo('Main file', { main: moved(chosen) });
    if (Object.values(bookmarks).some(b => under(b.file))) onBookmarksRenamed(from, to);
    ui.setExpanded(dir, [...expanded].map(p => (under(p) ? moved(p) : p)));
  };
  const remove = async (e: AsmEntry) => {
    const under = (p: string) => p === e.path || p.startsWith(`${e.path}/`);
    for (const p of Object.keys(timers.current).filter(under)) { clearTimeout(timers.current[p]); delete timers.current[p]; }
    // (its tabs are closed as the listing no longer has it: fixTabs)
    if (!await change({ dir, op: 'remove', path: e.path }, `${e.path} is in the Recycle Bin`)) return;
    if (chosen && under(chosen)) onInfo('Main file', { main: null });
  };
  const rowMenu = (x: number, y: number, e: AsmEntry | null) => {
    const source = !!e && !e.dir && ASM_SOURCE.test(e.path);
    const full = e ? joinDir(dir, e.path) : dir;
    const items: MenuItem[] = [
      ...(e && !e.dir ? [{ label: 'Open', icon: 'doc' as const, run: () => openFile(e.path, { keep: true }) }] : []),
      ...(source ? [{ label: 'Main file: Run and Build build it', checked: e!.path === main, run: () => { onInfo('Main file', { main: e!.path }); toast(`${e!.path} is the main file: Run and Build build it`, 'ok'); } }] : []),
      ...(e ? [{ sep: true } as const] : []),
      { label: 'New file…', icon: 'plus', run: () => newIn(folderOf(e), 'file') },
      { label: 'New folder…', icon: 'folder', run: () => newIn(folderOf(e), 'folder') },
      ...(e ? [{ sep: true } as const, { label: 'Rename…', key: 'F2', icon: 'pencil' as const, run: () => setEdit({ kind: 'rename', path: e.path }) },
        { label: 'Delete', key: 'Del', icon: 'trash' as const, run: () => void remove(e) }] : []),
      { sep: true },
      { label: 'Show in folder', icon: 'folder', run: () => void kr?.assemblerReveal({ dir, ...(e ? { path: e.path } : {}) }).catch((err: unknown) => toast(errorText(err), 'err')) },
      { label: 'Copy path', icon: 'copy', run: () => void navigator.clipboard.writeText(full).then(() => toast(`Copied ${full}`, 'ok')) },
    ];
    onMenu(x, y, items);
  };
  const folderMenu = (x: number, y: number) => onMenu(x, y, [
    { header: folder.name },
    { label: 'Show in folder', icon: 'folder', run: () => void kr?.assemblerReveal({ dir }) },
    { label: 'Read the files again', icon: 'refresh', run: () => void relist() },
  ]);

  /* ---- Build and Run: the main file with KickAss.jar or 64tass, then VICE ---- */
  const tool = lang === '64tass' ? '64tass' : 'KickAss.jar';
  const building = useRef(false);
  /** the main file built (what is not written yet is first): its PRG and labels, or null (said why) */
  const doBuild = async (forRun: boolean): Promise<{ prgPath: string; vsPath: string | null; prg: Uint8Array; main: string } | null> => {
    if (!kr || building.current) return null;
    if (!main) { toast('There is no source to build: + makes one', 'warn'); return null; }
    if (!/\.asm$/i.test(main)) { toast(`${main} is the main file, but ${tool} builds a .asm file here: rename it, or make another the main file`, 'warn'); return null; }
    building.current = true;
    try {
      await writeAll();
      const sub = parentOf(main), at = Date.now();
      const base: AsmBuild = { running: true, tool, main, ok: null, log: '', commands: [], problems: [], ms: 0, prg: null, at };
      setBuild(base);
      let r: BuildResult;
      try { r = await kr.build({ dir: sub ? joinDir(dir, sub) : dir, entries: [baseName(main)], assembler: lang === '64tass' ? '64tass' : 'kick', ...(own.trim() ? { args: splitArgs(own) } : {}) }); }
      catch (e) { setBuild({ ...base, running: false, log: errorText(e) }); ui.set({ outTab: 'build', outFolded: false }); toast(`${tool} did not run: ${errorText(e)}`, 'err'); return null; }
      const o = r.outputs[0];
      const problems: AsmBuildProblem[] = r.problems.map(p => ({ file: p.file ? tidyPath(sub ? `${sub}/${p.file}` : p.file) : '', line: p.line, column: p.column, msg: p.message, severity: p.severity }));
      const prg = o?.ok && o.prg && o.prg.length > 2 ? { path: o.prgPath, load: o.prg[0] | (o.prg[1] << 8), size: o.prg.length - 2 } : null;
      const ok = !!o && r.ok && !!prg;
      setBuild({ ...base, running: false, ok: o ? ok : null, log: r.stdout || problems.map(p => p.msg).join('\n'), commands: r.commands, problems, ms: r.ms, prg });
      if (!ok) {
        ui.set({ outTab: problems.some(p => p.file) ? 'problems' : 'build', outFolded: false });
        const p = problems.find(x => x.severity === 'error');
        toast(!o ? `${p?.msg ?? `${tool} is not set`}${/not set|not found|missing/i.test(p?.msg ?? '') ? ' (Settings → Toolchain)' : ''}` : `${tool} could not build ${main}${p ? `: ${p.file}${p.line ? `:${p.line}` : ''} ${p.msg}` : ''}`, 'err');
        if (p?.file && (paths.has(p.file) || typeof outside[p.file] === 'string')) openFile(p.file, { line: p.line, col: p.column || 1 });
        return null;
      }
      if (!forRun) toast(`Built ${fileName(o.prgPath)}: ${fmtBytes(prg!.size)} at $${h4(prg!.load)}`, 'ok');
      return { prgPath: o.prgPath, vsPath: o.vsPath, prg: o.prg!, main };
    } finally { building.current = false; }
  };
  buildRef.current = () => doBuild(true);
  /** the build in Retro Debugger or C64 Debugger (Settings → Toolchain), as Build & Run's Shift+F5 (spec 13.2b): with
   *  the sources (their lines and the bytes each made), the labels and the breakpoints */
  const runInDebugger = async () => {
    const b = await doBuild(true);
    if (!b || !kr) return;
    const c = check ?? useAsmLink.getState().check;
    const now: Record<string, string> = { ...textsRef.current };
    for (const [p, m] of Object.entries(models.current)) if (!m.isDisposed()) now[p] = m.getValue();
    const debug = c ? { sources: asmDebugSources(c, now), breakpoints: [...bpAddrs(c)] } : undefined;
    try {
      const res = await kr.run({ prgPath: b.prgPath, ...(b.vsPath ? { labelsPath: b.vsPath } : {}), debugger: true, ...(debug ? { debug } : {}) });
      const name = res.debugger ?? 'The debugger';
      setBuild(x => x && { ...x, vice: `${name} started it` });
      toast(`${name} started ${fileName(b.prgPath)}${debug?.breakpoints.length ? ` with ${plural(debug.breakpoints.length, 'breakpoint')}` : ''}, the sources beside its code${res.notes?.length ? ` (${res.notes[0]})` : ''}`, 'ok');
    } catch (e) {
      setBuild(x => x && { ...x, vice: `The debugger did not start: ${errorText(e)}` });
      toast(`The debugger did not start: ${errorText(e)} (Settings → Toolchain)`, 'err');
    }
  };
  const run = async () => {
    if (dbgRef.current) { contDbg(); return; }
    const b = await doBuild(true);
    if (!b || !kr) return;
    try {
      const res = await kr.run({ prgPath: b.prgPath, ...(b.vsPath ? { labelsPath: b.vsPath } : {}) });
      const how = res.via === 'run' ? 'with RUN' : res.via === 'sys' ? 'with SYS' : res.via === 'monitor' ? 'from the monitor' : '';
      setBuild(x => x && { ...x, vice: `VICE started it ${how}`.trim() });
      toast(`VICE started ${fileName(b.prgPath)} ${how}${b.vsPath ? ', its labels in the monitor' : ''}`.trim(), 'ok');
    } catch (e) {
      setBuild(x => x && { ...x, vice: `VICE did not start: ${errorText(e)}` });
      toast(`VICE did not start: ${errorText(e)} (Settings → Toolchain)`, 'err');
    }
  };

  /* ---- the debugger: the program in Mimir's 6510 (memory only) or in the whole C64 (Sindri), an instruction at a time ---- */
  const machineKind: AsmMachineKind = ui.machines[dir] ?? 'memory';
  const [dbg, setDbg] = useState<Debugging | null>(null);
  const dbgRef = useRef(dbg); dbgRef.current = dbg;
  const [, setTick] = useState(0);
  const [dbgBusy, setDbgBusy] = useState(false);
  const busyRef = useRef(false), pauseReq = useRef(false), starting = useRef(false);
  const [kept, setKept] = useState<AsmRunKept | null>(null);
  useEffect(() => () => { pauseReq.current = true; }, []);
  /** VICE's ROMs for the whole C64 (asked for once; null: there are none) */
  const roms = useRef<Roms | null | undefined>(undefined);
  /** the whole C64's picture shown, and a count that tells one from the next */
  const [pic, setPic] = useState<{ p: VicScreen; n: number } | null>(null);
  const showPic = (m: AsmC64, now: boolean) => setPic(x => ({ p: m.picture(now), n: (x?.n ?? 0) + 1 }));
  /** an address's file and line, in words */
  const lineText = (c: AsmCheck, a: Addr): string | null => { const l = asmLineAt(c, a); return l ? `${l.file} line ${l.line}` : null; };
  // the breakpoints of each file, as decorations (they move with the lines as the code is edited)
  const bpIds = useRef<Record<string, string[]>>({});
  const bpLines = (p: string): number[] => {
    const m = models.current[p];
    if (!m || m.isDisposed()) return useAssembler.getState().bps[`${dir}|${p}`] ?? [];
    return (bpIds.current[p] ?? []).map(d => m.getDecorationRange(d)?.startLineNumber).filter((n): n is number => !!n);
  };
  function setBps(p: string, lines: number[], model?: Monaco.editor.ITextModel) {
    const monaco = monacoRef.current, m = model ?? models.current[p];
    if (!monaco || !m) return;
    const at = [...new Set(lines)].filter(l => l >= 1 && l <= m.getLineCount()).sort((a, b) => a - b);
    bpIds.current[p] = m.deltaDecorations(bpIds.current[p] ?? [], at.map(l => ({
      range: new monaco.Range(l, 1, l, 1),
      options: { glyphMarginClassName: 'scr-bp', glyphMarginHoverMessage: { value: 'Breakpoint: debugging stops before this line runs (a click takes it away)' }, stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges },
    })));
    useAssembler.getState().setBps(dir, p, at);
  }
  const toggleBp = (line: number) => {
    const p = shownRef.current; if (!p) return;
    const now = bpLines(p);
    setBps(p, now.includes(line) ? now.filter(l => l !== line) : [...now, line]);
    setTick(t => t + 1);
  };
  /** the addresses of the breakpoints' lines in a checked program */
  const bpAddrs = (c: AsmCheck): Set<Addr> => {
    const out = new Set<Addr>();
    for (const p of Object.keys(models.current)) for (const l of bpLines(p)) { const a = asmAddrOf(c, p, l); if (a != null) out.add(a); }
    return out;
  };

  /* ---- bookmarks (as the re-assembler's, on lines): each a decoration that moves with its lines (its area) and its
     mark; where they are now is kept in the project a moment after the code is edited ---- */
  const bookmarks = info.bookmarks ?? NO_BOOKMARKS;
  const bmRef = useRef(bookmarks); bmRef.current = bookmarks;
  /** each bookmark's decorations (the one its lines are, its mark) and the bookmark they were made from */
  const bmDecos = useRef<Record<string, { file: string; ids: string[]; b: AsmBookmark }>>({});
  /** where a bookmark is now: its decoration's lines, else as kept */
  const bmPlace = (id: string): { file: string; line: number; end?: number } | null => {
    const b = bmRef.current[id]; if (!b) return null;
    const d = bmDecos.current[id], m = d ? models.current[d.file] : undefined;
    const r = d && m && !m.isDisposed() && d.file === b.file ? m.getDecorationRange(d.ids[0]) : null;
    if (!r) return { file: b.file, line: b.line, ...(b.end != null ? { end: b.end } : {}) };
    return { file: b.file, line: r.startLineNumber, ...(b.end != null && r.endLineNumber > r.startLineNumber ? { end: r.endLineNumber } : {}) };
  };
  /** a file's bookmark decorations taken away (made again from the lines kept) */
  const dropBmDecos = (p: string) => {
    for (const [id, d] of Object.entries(bmDecos.current)) if (d.file === p) { const m = models.current[p]; if (m && !m.isDisposed()) m.deltaDecorations(d.ids, []); delete bmDecos.current[id]; }
    setTick(t => t + 1);
  };
  useEffect(() => {
    const monaco = monacoRef.current;
    if (state !== 'ready' || !monaco) return;
    for (const [id, d] of Object.entries(bmDecos.current)) {
      const b = bookmarks[id], m = models.current[d.file];
      if (b === d.b && m && !m.isDisposed()) continue;
      if (m && !m.isDisposed()) m.deltaDecorations(d.ids, []);
      delete bmDecos.current[id];
    }
    const never = monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges;
    for (const [id, b] of Object.entries(bookmarks)) {
      const m = models.current[b.file];
      if (bmDecos.current[id] || !m || m.isDisposed()) continue;
      const n = m.getLineCount(), line = Math.min(b.line, n), end = Math.min(Math.max(b.end ?? line, line), n), c = bmColorClass(b.color);
      const tip = `${b.title || asmBookmarkSpan(b)}${b.text ? `\n${b.text.length > 300 ? `${b.text.slice(0, 300)}…` : b.text}` : ''}\n(a click shows it in Bookmarks)`;
      bmDecos.current[id] = { file: b.file, b, ids: m.deltaDecorations([], [
        { range: new monaco.Range(line, 1, end, m.getLineMaxColumn(end)), options: { stickiness: never, isWholeLine: true, ...(end > line ? { className: `asm-bm-area ${c}`, linesDecorationsClassName: `asm-bm-stripe ${c}` } : {}) } },
        { range: new monaco.Range(line, 1, line, m.getLineMaxColumn(line)), options: { stickiness: never, isWholeLine: true, className: `asm-bm-line ${c}`, linesDecorationsClassName: `asm-bm-mark ${c}`, linesDecorationsTooltip: tip,
          overviewRuler: { color: bmHex(b.color), position: monaco.editor.OverviewRulerLane.Left } } },
      ]) };
    }
  }, [state, bookmarks, texts]); // eslint-disable-line react-hooks/exhaustive-deps
  /** the bookmarks that moved with their lines, kept in the project (a moment after the edit, or now) */
  const bmTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const bmFlush = () => {
    clearTimeout(bmTimer.current);
    const moved: Record<string, { line: number; end?: number }> = {};
    for (const [id, b] of Object.entries(bmRef.current)) {
      const p = bmPlace(id);
      if (p && (p.line !== b.line || p.end !== b.end)) moved[id] = { line: p.line, ...(p.end != null ? { end: p.end } : {}) };
    }
    if (Object.keys(moved).length) onBookmarkLines(moved);
  };
  useEffect(() => () => clearTimeout(bmTimer.current), []);
  /** the bookmark whose first line is `line` of `file` now */
  const bookmarkOn = (file: string, line: number): string | null => Object.keys(bmRef.current).find(id => { const p = bmPlace(id); return p?.file === file && p.line === line; }) ?? null;
  /** Ctrl+F2: the editor for the bookmark on the caret's line, else a new one there (a selection of lines: on them) */
  const bookmarkHere = () => {
    const e = ed.current, m = e?.getModel(), p = m ? pathOfUri(m.uri) : null, s = e?.getSelection();
    if (!e || !p || !s) { toast('Open a source to bookmark a line in it', 'warn'); return; }
    if (typeof outside[p] === 'string') { toast(`${baseName(p)} is outside the project's folder: bookmarks are on the project's own files`, 'info'); return; }
    const from = s.startLineNumber, to = s.endColumn === 1 && s.endLineNumber > from ? s.endLineNumber - 1 : s.endLineNumber;
    bmFlush();
    onBookmark({ file: p, line: from, end: to > from ? to : null, id: bookmarkOn(p, from) });
  };
  /** a bookmark's line in the editor (`select`: its area's lines selected) */
  const goBookmark = (id: string) => {
    const p = bmPlace(id); if (!p) return;
    if (!paths.has(p.file)) { toast(`${p.file} is not in the project's folder: the bookmark ${asmBookmarkSpan(p)} has no line to go to`, 'warn'); return; }
    openFile(p.file, { line: p.line, keep: true });
  };
  /** Alt+F2 / Alt+Shift+F2: the next / previous bookmark after the caret's line, round to the first / last */
  const jumpBookmark = (dir: 1 | -1) => {
    const all = Object.keys(bmRef.current).map(id => ({ id, p: bmPlace(id)! })).filter(x => x.p && paths.has(x.p.file))
      .sort((a, b) => a.p.file.localeCompare(b.p.file) || a.p.line - b.p.line);
    if (!all.length) { toast('No bookmarks yet: Ctrl+F2 on a line adds one', 'info'); return; }
    const e = ed.current, m = e?.getModel(), here = m ? pathOfUri(m.uri) : null, line = e?.getPosition()?.lineNumber ?? 0;
    const cmp = (x: { file: string; line: number }) => (here == null ? 1 : x.file.localeCompare(here) || x.line - line);
    const next = dir > 0 ? all.find(x => cmp(x.p) > 0) ?? all[0] : [...all].reverse().find(x => cmp(x.p) < 0) ?? all[all.length - 1];
    openFile(next.p.file, { line: next.p.line, keep: true });
    toast(`Bookmark ${asmBookmarkSpan(next.p)}: ${bmRef.current[next.id].title}`, 'info');
  };
  /** a click on a bookmark's mark: its note in the list */
  const bookmarkClicked = (line: number) => {
    const p = shownRef.current; if (!p) return;
    const id = Object.keys(bmRef.current).find(k => { const q = bmPlace(k); return q?.file === p && q.line <= line && line <= (q.end ?? q.line); });
    if (id) onBookmarkSelect(id);
  };
  keys.current.bookmark = bookmarkHere; keys.current.bmJump = jumpBookmark; keys.current.bmClick = bookmarkClicked; keys.current.bmFlush = bmFlush;
  keys.current.bmSync = () => { clearTimeout(bmTimer.current); bmTimer.current = setTimeout(() => keys.current.bmFlush(), BM_SYNC_MS); };
  /** the debugger stopped somewhere: its line shown (in its file; at no line of the sources, the line it is running
   *  for), the C64's picture as it stands; at the end of the run (memory only: the program returned; the whole C64: a
   *  JAM), it is the last run */
  const liveAt = useRef(0);
  /** the machine's memory to the window's Memory and Graphics (each stop; running, a few times a second) */
  const publishLive = (d: Debugging, running: boolean) => {
    const now = performance.now();
    if (running && now - liveAt.current < 300) return;
    liveAt.current = now;
    const whole = d.m instanceof AsmC64, mem = d.m instanceof AsmC64 ? d.m.m.ram.slice() : asmMachineMemory(d.m);
    const l = asmLineAt(d.c, d.m.cpu.pc);
    useAsmLink.getState().set({ live: { mem, pc: d.m.cpu.pc, where: l ? `${l.file} line ${l.line}` : null, whole, running, n: (useAsmLink.getState().live?.n ?? 0) + 1 } });
  };
  useEffect(() => { if (!dbg) useAsmLink.getState().set({ live: null }); }, [dbg]);
  const stopped = (d: Debugging) => {
    if (dbgRef.current !== d) return;
    if (d.m.end) { finishDbg(d); return; }
    publishLive(d, false);
    setTick(t => t + 1);
    if (d.m instanceof AsmC64) showPic(d.m, true);
    const l = asmLineAt(d.c, d.m.cpu.pc) ?? asmCallSite(d.c, d.m);
    if (l) openFile(l.file, { line: l.line, col: 1, soft: true });
  };
  /** the run kept as the last run: how it ended (or where it was stopped), its registers, its screen */
  const keepRun = (d: Debugging) => {
    const r = d.m.result();
    if (d.m instanceof AsmC64) {
      const text = asmC64Text(d.m, a => lineText(d.c, a));
      setKept({ run: r, text, ok: !d.m.end, at: Date.now(), picture: d.m.picture(true) });
      return { text, ok: !d.m.end };
    }
    const ok = endedWell(r.end), text = asmEndText(r, a => lineText(d.c, a), a => !!d.c.asm.written[a]);
    setKept({ run: r, text, ok, at: Date.now() });
    return { text, ok };
  };
  const finishDbg = (d: Debugging) => {
    setDbg(null); dbgRef.current = null;
    const { text, ok } = keepRun(d);
    ui.set({ outTab: 'run', outFolded: false });
    toast(text, ok ? 'ok' : 'warn');
  };
  const startDebug = async (andGo = false) => {
    if (dbgRef.current || building.current || starting.current) return;
    if (!check) { toast('There is no main file to debug: + makes a source', 'warn'); return; }
    if (!check.ok) { const p = check.problems[0]; toast(`The program does not assemble in Mimir${p ? `: ${p.file}${p.line ? ` line ${p.line}` : ''}: ${p.msg}` : ''}`, 'warn'); if (p?.file && p.line) openFile(p.file, { line: p.line }); return; }
    if (check.cpus.length) { toast(`The program is written for the ${check.cpus.join(' and ')} (.cpu): Mimir's debugger runs a 6510, as the C64 has`, 'warn'); return; }
    let m: ScriptMachine | AsmC64;
    const c = check;
    if (machineKind === 'c64') {
      starting.current = true;
      try {
        if (roms.current === undefined) roms.current = (await kr?.c64Roms().catch(() => null)) ?? null;
        if (!roms.current) { toast('A run in the whole C64 needs the ROMs of VICE: set VICE in Settings → Toolchain, or run in memory only', 'err'); return; }
        // started as from READY (RUN or SYS typed), stopped at its first instruction; the screen beside the code shows it
        m = new AsmC64(c, { roms: roms.current });
        setC64({ open: true });
      } catch (e) { toast(errorText(e), 'err'); return; } finally { starting.current = false; }
    } else {
      try { m = asmMachine(c, lang, runScreenSize()); } catch (e) { toast(errorText(e), 'err'); return; }
    }
    const d: Debugging = { m, c, prev: null };
    setDbg(d); dbgRef.current = d;
    stopped(d);
    if (andGo) go(null);
  };
  /** on until `stop` holds, a breakpoint's line is next, or the run ends; in parts, so the window keeps drawing (the
   *  whole C64 with `live`: in the C64's own time, a frame of it an animation frame, its picture drawn each time) */
  const go = (stop: ((m: Pick<ScriptMachine, 'cpu'>) => boolean) | null, keepPrev = false, live = false) => {
    const d = dbgRef.current; if (!d || busyRef.current) return;
    const bps = bpAddrs(d.c);
    const at = (m: Pick<ScriptMachine, 'cpu'>) => (stop ? stop(m) : false) || (bps.size > 0 && bps.has(m.cpu.pc));
    if (!keepPrev) d.prev = regsOf(d.m);
    pauseReq.current = false; busyRef.current = true; setDbgBusy(true);
    const done = () => { busyRef.current = false; setDbgBusy(false); stopped(d); };
    const c64m = d.m instanceof AsmC64 ? d.m : null;
    if (c64m && live) {
      let last = performance.now();
      const frame = (t: number) => {
        if (dbgRef.current !== d) return;
        if (pauseReq.current) { done(); return; }
        // the C64's time since the last frame (at most three of its frames: a window that was busy does not race on)
        const cycles = Math.min(3 * FRAME_CYCLES, Math.max(LINE_CYCLES, Math.round((t - last) * PAL_CLOCK / 1000)));
        last = t;
        const r = c64m.runFor(cycles, at);
        showPic(c64m, false); setTick(n => n + 1); publishLive(d, true);
        if (r === 'more') { requestAnimationFrame(frame); return; }
        done();
      };
      requestAnimationFrame(frame);
      return;
    }
    const part = () => {
      if (dbgRef.current !== d) return;
      const r = pauseReq.current ? 'stopped' : d.m.runUntil(at, DEBUG_SLICE);
      if (r === 'more') { if (c64m) showPic(c64m, false); setTick(t => t + 1); publishLive(d, true); setTimeout(part, 0); return; }
      done();
    };
    setTimeout(part, 0);
  };
  const stepDbg = () => {
    const d = dbgRef.current; if (!d) { void startDebug(); return; }
    if (busyRef.current) return;
    d.prev = regsOf(d.m); d.m.step(); stopped(d);
  };
  const overDbg = () => {
    const d = dbgRef.current; if (!d) { void startDebug(); return; }
    if (busyRef.current) return;
    const m = d.m;
    if (m.peek(m.cpu.pc) !== 0x20) { stepDbg(); return; }
    const s0 = m.cpu.s, back = (m.cpu.pc + 3) & 0xffff;
    d.prev = regsOf(m); m.step();
    if (m.end || (m.cpu.s === s0 && m.cpu.pc === back)) { stopped(d); return; }
    go(x => x.cpu.s === s0 && x.cpu.pc === back, true);
  };
  const outDbg = () => { const d = dbgRef.current; if (!d || busyRef.current) return; const s0 = d.m.cpu.s; go(x => x.cpu.lastOp === 0x60 && x.cpu.s > s0); };
  /** Continue: on to a breakpoint (the whole C64: in its own time, the screen live); not debugging, Debug and on */
  const contDbg = () => { const d = dbgRef.current; if (!d) void startDebug(true); else go(null, false, d.m instanceof AsmC64); };
  /** stop debugging where it is (`quiet`: leaving; the whole C64's run is kept as the last run, with its screen) */
  const stopDbg = (quiet = false) => {
    pauseReq.current = true;
    const d = dbgRef.current;
    if (!d) return;
    setDbg(null); dbgRef.current = null; busyRef.current = false; setDbgBusy(false); heldKeys.current.clear();
    if (quiet) return;
    if (d.m instanceof AsmC64) { const { text } = keepRun(d); ui.set({ outTab: 'run', outFolded: false }); toast(text, 'info'); return; }
    toast('Debugging stopped', 'info');
  };
  // the keys typed on the C64's screen go into its keyboard matrix (the PC's held, each where it is on the C64)
  const heldKeys = useRef(new Map<string, C64Key>());
  const c64Keys = (e: React.KeyboardEvent, down: boolean) => {
    const m = dbgRef.current?.m;
    if (!(m instanceof AsmC64) || e.ctrlKey && e.code !== 'ControlLeft' && e.code !== 'ControlRight' && !/^Key|^Digit/.test(e.code)) return;
    const k = c64Key(e.code, e.key);
    if (!k) return;
    e.preventDefault(); e.stopPropagation();
    if (down) heldKeys.current.set(e.code, k); else heldKeys.current.delete(e.code);
    m.setKeys(c64Held([...heldKeys.current].map(([code, key]) => ({ code, key }))));
  };
  const c64Release = () => { heldKeys.current.clear(); const m = dbgRef.current?.m; if (m instanceof AsmC64) m.setKeys([]); };
  keys.current = { ...keys.current, debugger: () => void runInDebugger(), block: () => askBlock(), run: () => void run(), build: () => void doBuild(false), step: stepDbg, over: overDbg, out: outDbg, cont: contDbg, toggleBp, write: () => { if (shownRef.current) void write(shownRef.current); }, open: openFile, tab: stepTab, closeTab: () => { if (shownRef.current) closeTabs([shownRef.current]); }, codeLib: (k: CodeLibKind, into?: string) => codeLibAdd(k, into) };
  // what the rest of the window asks for: an address's line in the sources shown (Graphics, Memory, the inspector, the
  // Explorer), Run, Build or Debug (the title bar, F5 on another tab)
  const show = useAsmLink(s => s.show), ask = useAsmLink(s => s.ask);
  const seenAsk = useRef({ show: show?.n ?? 0, ask: ask?.n ?? 0 });
  useEffect(() => {
    if (!show || show.n === seenAsk.current.show || !loaded) return;
    seenAsk.current.show = show.n;
    const c = dbgRef.current?.c ?? check ?? useAsmLink.getState().check;
    const l = c ? asmLineAt(c, show.addr) : null;
    if (l && (paths.has(l.file) || typeof outside[l.file] === 'string')) openFile(l.file, { line: l.line, col: 1 });
    else toast(`$${h4(show.addr)} has no line in the sources: ${c?.asm.written[show.addr & 0xffff] ? 'its bytes are written by a directive of an import Mimir does not follow' : 'the program does not write it'}`, 'info');
  }, [show, loaded]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!ask || ask.n === seenAsk.current.ask) return;
    seenAsk.current.ask = ask.n;
    // the bookmarks': the editor for the caret's line, a bookmark's line, the next or previous one, a line shown while one is edited
    if (ask.what === 'bmAdd') { bookmarkHere(); return; }
    if (ask.what === 'bmGo') { if (ask.id) goBookmark(ask.id); return; }
    if (ask.what === 'bmJump') { jumpBookmark(ask.dir ?? 1); return; }
    // the macro and code libraries': a new item of the lines selected, an item put in the source
    if (ask.what === 'codeLib') { codeLibAdd(ask.libKind ?? 'macro', ask.libInto); return; }
    if (ask.what === 'insert') { if (ask.insert) insertLib(ask.insert); return; }
    if (ask.what === 'line') {
      if (!ask.at || !ask.line || !paths.has(ask.at)) return;
      openFile(ask.at, { line: ask.line, soft: true });
      const e = ed.current, monaco = monacoRef.current, end = ask.end;
      // (after the line is shown, which puts the caret on it)
      if (end && e && monaco) requestAnimationFrame(() => requestAnimationFrame(() => { const m = e.getModel(); if (m && pathOfUri(m.uri) === ask.at) e.setSelection(new monaco.Range(ask.line!, 1, Math.min(end, m.getLineCount()), m.getLineMaxColumn(Math.min(end, m.getLineCount())))); }));
      return;
    }
    if (ask.what === 'run') void run(); else if (ask.what === 'build') void doBuild(false); else if (ask.what === 'block') askBlock(ask.kind, ask.lib); else if (ask.what === 'debugger') void runInDebugger(); else if (ask.what === 'write') { if (ask.changes) void writeBytes(ask.changes); } else if (ask.what === 'drop') { if (ask.files) void dropFiles(ask.files, ask.at ?? null); } else if (ask.what === 'log') { if (ask.text) setBuild(b => (b ? { ...b, log: `${b.log}\n\n${ask.text}` } : b)); ui.set({ outTab: 'build', outFolded: false }); } else void startDebug();
  }, [ask]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { useAsmLink.getState().set({ building: !!build?.running }); }, [build?.running]);
  useEffect(() => { useAsmLink.getState().set({ main }); }, [main]);
  // the folder's text files, their lines and the label on a line, for the bookmarks
  const textKeys = useMemo(() => Object.keys(texts).sort().join('\n'), [texts]);
  useEffect(() => { useAsmLink.getState().set({ textFiles: textKeys ? textKeys.split('\n') : [] }); }, [textKeys]);
  const langRef = useRef(lang); langRef.current = lang;
  useEffect(() => {
    const textOf = (f: string): string | null => { const m = models.current[f]; return m && !m.isDisposed() ? m.getValue() : textsRef.current[f] ?? null; };
    const lineOf = (f: string, l: number) => (textOf(f)?.split('\n')[l - 1] ?? '').replace(/\r$/, '');
    useAsmLink.getState().set({
      linesOf: f => { const t = textOf(f); return t == null ? null : t.split('\n').length; },
      titleAt: (f, l) => { const label = splitLabel(lineOf(f, l), langRef.current).label; return label && !/^[!+-]/.test(label) ? label : `${f}:${l}`; },
      // (the folder's sources and those imported from outside it)
      macroDefined: n => {
        for (const f of [...Object.keys(textsRef.current), ...Object.keys(outsideRef.current)]) { const t = textOf(f) ?? (typeof outsideRef.current[f] === 'string' ? outsideRef.current[f] as string : null); if (t != null && ASM_SOURCE.test(f) && definesMacro(t, langRef.current, n)) return f; }
        return null;
      },
    });
  }, []);
  // the sources and the main file Mimir finds, for Settings → Assembler project
  const sourceList = useMemo(() => files.map(f => f.path).filter(p => ASM_SOURCE.test(p)).sort(), [files]);
  useEffect(() => { useAsmLink.getState().set({ sources: sourceList, found: guessed ?? null }); }, [sourceList, guessed]);

  /* ---- bytes drawn in the window (the enlarged sprite or character) written into the lines that write them ---- */
  const writeBytes = async (changes: { addr: Addr; value: number }[]) => {
    const c = check ?? useAsmLink.getState().check;
    if (!c) { toast('The sources do not assemble now: the bytes drawn were not written', 'warn'); return; }
    if (dbgRef.current) { toast('Stop debugging first: the code cannot change while it is debugged', 'warn'); return; }
    // (the texts as the editor has them now)
    const now: Record<string, string> = { ...textsRef.current };
    for (const [p, m] of Object.entries(models.current)) if (!m.isDisposed()) now[p] = m.getValue();
    const w = asmWriteBytes(c, { ...now, ...bins }, lang, changes);
    for (const [p, text] of Object.entries(w.texts)) {
      const m = models.current[p], monaco = monacoRef.current;
      if (m && !m.isDisposed() && monaco) {
        // only the lines that changed, one step to undo in the file
        const want = text.split('\n'), ops: Monaco.editor.IIdentifiedSingleEditOperation[] = [];
        for (const { file, line } of w.lines) if (file === p) {
          const t = (want[line - 1] ?? '').replace(/\r$/, '');
          if (line <= m.getLineCount() && m.getLineContent(line) !== t) ops.push({ range: new monaco.Range(line, 1, line, m.getLineMaxColumn(line)), text: t });
        }
        applying.current = true;
        m.pushStackElement(); m.pushEditOperations([], ops, () => null); m.pushStackElement();
        applying.current = false;
        setTexts(t => ({ ...t, [p]: m.getValue() }));
      } else setTexts(t => ({ ...t, [p]: text }));
      schedule(p);
    }
    for (const [p, bytes] of Object.entries(w.bins)) {
      try { const r = await kr!.assemblerWrite({ dir, path: p, bytes }); binTimes.current[p] = r.mtime; setBins(b => ({ ...b, [p]: bytes })); }
      catch (e) { toast(`${p} was not written: ${errorText(e)}`, 'err'); }
    }
    const where = [...new Set(w.lines.map(l => `${l.file} line ${l.line}`))];
    if (w.problems.length) toast(`${w.problems[0]}${w.problems.length > 1 ? ` (and ${w.problems.length - 1} more)` : ''}`, 'warn');
    else if (where.length) toast(`Drawn into ${where.slice(0, 3).join(', ')}${where.length > 3 ? ` and ${where.length - 3} more` : ''}${Object.keys(w.bins).length ? ` (${Object.keys(w.bins).join(', ')})` : ''}`, 'ok');
  };

  /* ---- Cycles: each instruction's beside its line number, the lines chosen counted along a path (spec 10.7) ---- */
  const cycOn = ui.cycles;
  const [selLines, setSelLines] = useState<{ file: string; from: number; to: number } | null>(null);
  const [taken, setTaken] = useState<ReadonlySet<Addr>>(new Set());
  const cycCheck = dbg?.c ?? check;
  const lineCyc = useMemo(() => (cycOn && cycCheck && shown ? asmLineCycles(cycCheck, shown) : null), [cycOn, cycCheck, shown]);
  const cycCode = useMemo(() => (cycOn && cycCheck ? asmCode(cycCheck) : null), [cycOn, cycCheck]);
  const cycPath = useMemo(() => {
    if (!cycOn || !cycCheck || !cycCode || !selLines || selLines.to <= selLines.from) return null;
    const r = asmLinesRange(cycCheck, selLines.file, selLines.from, selLines.to);
    return r ? cyclePath(cycCode, r.start, r.end, taken) : null;
  }, [cycOn, cycCheck, cycCode, selLines, taken]);
  // the line numbers with the cycles after them (Monaco draws only what the option's function gives: a new one each time)
  useEffect(() => {
    const e = ed.current;
    if (state !== 'ready' || !e) return;
    if (!lineCyc) { e.updateOptions({ lineNumbers: 'on', lineNumbersMinChars: 5 }); return; }
    const pad = (t: string) => t + '\u00a0'.repeat(Math.max(0, 5 - t.length));
    e.updateOptions({ lineNumbersMinChars: 10, lineNumbers: n => { const x = lineCyc.get(n); return `${n}\u00a0${pad(x ? `${cycleText(x.cycles)}${x.cycles.taken != null && taken.has(x.addr) ? '✓' : ''}` : '')}`; } });
  }, [lineCyc, taken, state]);
  const toggleCycles = () => { const on = !cycOn; ui.set({ cycles: on, ...(on ? { outTab: 'cycles' as const, outFolded: false } : useAssembler.getState().outTab === 'cycles' ? { outTab: 'problems' as const } : {}) }); };
  const cycles: AsmCycles | null = cycOn ? {
    path: cycPath,
    label: selLines && selLines.to > selLines.from ? `${selLines.file} lines ${selLines.from}-${selLines.to}` : null,
    lineOf: a => (cycCheck ? asmLineAt(cycCheck, a) : null),
    code: a => { const l = cycCheck ? asmLineAt(cycCheck, a) : null, m = l ? models.current[l.file] : null; return m && !m.isDisposed() && l!.line <= m.getLineCount() ? m.getLineContent(l!.line).replace(/\s*(\/\/|;).*$/, '').trim() : `$${h4(a)}`; },
    onToggle: pc => setTaken(t => { const n = new Set(t); if (n.has(pc)) n.delete(pc); else n.add(pc); return n; }),
  } : null;

  /* ---- files dropped on the window: copied into the folder (asmDropPath: the folder dropped on, else by kind) ---- */
  const dropFiles = async (dropped: AsmDropped[], at: string | null) => {
    const dirs = new Set(folder.entries.filter(e => e.dir).map(e => e.path)), taken = new Set(folder.entries.map(e => e.path));
    const made: string[] = [];
    for (const f of dropped) {
      const path = asmDropPath(f.name, { at, dirs, taken, main });
      try {
        const r = await kr!.assemblerWrite({ dir, path, bytes: f.bytes });
        taken.add(path); made.push(path);
        // (a file a source may load: the check reads it from here)
        if (!ASM_TEXT.test(path)) { binTimes.current[path] = r.mtime; setBins(b => ({ ...b, [path]: f.bytes })); }
      } catch (e) { toast(`${f.name} was not copied: ${errorText(e)}`, 'err'); }
    }
    if (!made.length) return;
    await relist();
    // the first shown where it went (a source in a tab of its own)
    const src = made.find(p => ASM_SOURCE.test(p));
    openFile(src ?? made[0], { keep: !!src });
    const data = made.some(p => !ASM_TEXT.test(p));
    toast(`Copied ${made.length === 1 ? made[0] : `${made.length} files (${made.join(', ')})`} into the project's folder${data ? `: a source loads ${made.length === 1 ? 'it' : 'them'} from there (Insert block… writes the lines)` : ''}`, 'ok');
  };

  /* ---- Insert block: sprites, a charset, a bitmap, a screen, music or data, in the source where the caret is ---- */
  const [blockAsk, setBlockAsk] = useState<{ kind?: AsmBlockKind; lib?: LibraryRef | null } | null>(null);
  const askBlock = (kind?: AsmBlockKind, lib?: LibraryRef) => {
    const p = shownRef.current;
    if (dbgRef.current) { toast('Stop debugging first: the code cannot change while it is debugged', 'warn'); return; }
    if (!p || !(p in textsRef.current) || !ASM_SOURCE.test(p)) { toast('Open a source to put the block in: it goes where the caret is', 'warn'); return; }
    setBlockAsk({ kind, lib: lib ?? null });
  };
  const insertBlock = async (b: AsmBlockInsert) => {
    const p = shownRef.current, e = ed.current, monaco = monacoRef.current, m = p ? models.current[p] : null;
    if (!p || !e || !monaco || !m || e.getModel() !== m) { toast('The source is not open any more', 'warn'); return; }
    setBlockAsk(null);
    // its file first (the check reads it), then the lines
    if (b.file) {
      const f = b.file;
      try { const r = await kr!.assemblerWrite({ dir, path: f.path, bytes: f.bytes }); binTimes.current[f.path] = r.mtime; tried.current.add(f.path); setBins(x => ({ ...x, [f.path]: f.bytes })); }
      catch (err) { toast(`${f.path} was not written: ${errorText(err)}`, 'err'); return; }
      await relist();
    }
    const line = Math.min(e.getPosition()?.lineNumber ?? m.getLineCount(), m.getLineCount());
    // an empty line before it and after it, where the lines next to it have text
    const before = line > 1 && m.getLineContent(line - 1).trim() ? '\n' : '', after = m.getLineContent(line).trim() ? '\n' : '';
    e.pushUndoStop();
    e.executeEdits('insert-block', [{ range: new monaco.Range(line, 1, line, 1), text: before + b.text + after, forceMoveMarkers: true }]);
    e.pushUndoStop();
    const at = line + (before ? 1 : 0) + b.labelLine;
    e.setPosition({ lineNumber: at, column: 1 }); e.revealLineInCenter(at); e.focus();
    toast(`Inserted the ${b.what}${b.file ? `, its bytes in ${b.file.path}` : ''}: Graphics and Memory show it once the program assembles`, 'ok');
  };
  /* ---- the macro and code libraries (spec 10.8): lines of a source made an item, an item put in the source ---- */
  /** the dialog for a new item of `kind`'s library: the lines selected (a selection ending at a line's start leaves
   *  that line out), none: the macro (…) the caret is in, else nothing to start with */
  const codeLibAdd = (kind: CodeLibKind, collection?: string) => {
    const e = ed.current, m = e?.getModel(), p = m ? pathOfUri(m.uri) : null, s = e?.getSelection();
    // (`collection`: the macro goes in that collection of the macro library)
    const into = kind === 'macro' && collection ? { into: { file: collection } } : {};
    if (!e || !m || !p || !s) { useCodeLib.getState().set({ editing: { kind, lang, code: '', ...into } }); return; }
    const text = m.getValue();
    let from = s.startLineNumber, to = s.endColumn === 1 && s.endLineNumber > from ? s.endLineNumber - 1 : s.endLineNumber;
    if (s.isEmpty()) {
      const d = codeLibMacroAt(text, lang, from);
      if (!d) { toast('Nothing is selected: select the lines to keep (or click in a macro to take all of it)', 'info'); useCodeLib.getState().set({ editing: { kind, lang, code: '', ...into } }); return; }
      from = d.line; to = d.end;
    }
    const where = typeof outside[p] === 'string' ? foundOut.current[p] ?? p : p;
    useCodeLib.getState().set({ editing: { kind, lang, code: codeLibTake(text, from, to), from: `${name} · ${where}:${from}${to > from ? `–${to}` : ''}`, ...into } });
  };
  /** an item put in the source shown: a macro's call where the caret is (its parameters places to type in, Tab goes
   *  on), else its lines at the caret's line (on an empty line in its place, after the line when the caret is at its
   *  end, else before it), indented as the code there when it has no layout of its own, selected. Code written for Kick
   *  Assembler is made 64tass for a 64tass project where it can be. */
  const insertLib = (ins: AsmInsert) => {
    const p = shownRef.current, e = ed.current, monaco = monacoRef.current, m = p ? models.current[p] : null;
    if (dbgRef.current) { toast('Stop debugging first: the code cannot change while it is debugged', 'warn'); return; }
    if (!p || !e || !monaco || !m || e.getModel() !== m || !(p in textsRef.current) || !ASM_SOURCE.test(p)) { toast(`Open a source of the project to put ${ins.name} in: it goes where the caret is`, 'warn'); return; }
    let text = ins.text.replace(/\r\n/g, '\n'), note = '', warn = '';
    // a collection's import: at the top of the source, after the imports it has (once)
    if (ins.top) {
      const lc = m.getLineCount();
      for (let n = 1; n <= lc; n++) if (m.getLineContent(n).trim() === text.trim()) { e.focus(); e.setSelection(new monaco.Range(n, 1, n, m.getLineMaxColumn(n))); e.revealLineInCenterIfOutsideViewport(n); toast(`${p} imports ${ins.name} already (line ${n})`, 'info'); return; }
      let last = 0;
      for (let n = 1; n <= lc; n++) if (/^\s*(?:#import(?:once)?|\.include|\.import\s+source)\b/.test(m.getLineContent(n))) last = n;
      const at = last + 1, edit = last || !m.getLineContent(1).trim() ? `${text}\n` : `${text}\n\n`;
      e.focus();
      e.pushUndoStop();
      e.executeEdits('code-library', [{ range: new monaco.Range(at, 1, at, 1), text: edit, forceMoveMarkers: true }]);
      e.pushUndoStop();
      e.setSelection(new monaco.Range(at, 1, at, m.getLineMaxColumn(at)));
      e.revealLineInCenterIfOutsideViewport(at);
      toast(ins.lang !== lang ? `${ins.name} is written for ${LANG_TITLE[ins.lang]}, the project for ${LANG_TITLE[lang]}: its import (line ${at}) will not assemble` : `Put in the import of ${ins.name} (line ${at}): its macros are the project's now`, ins.lang !== lang ? 'warn' : 'ok');
      return;
    }
    if (ins.lang !== lang) {
      const c = !ins.call && !ins.macro && ins.lang === 'kickass' && lang === '64tass' ? kickToTass(text) : null;
      if (c && 'source' in c) { text = c.source.replace(/\n+$/, ''); note = ` (made ${LANG_TITLE[lang]})`; }
      else warn = `${ins.name} is written for ${LANG_TITLE[ins.lang]}, the project for ${LANG_TITLE[lang]}${c && 'error' in c ? ` (${c.error} on its line ${c.line})` : ''}: check the lines put in`;
    }
    e.focus();
    if (ins.call) {
      const sc = e.getContribution('snippetController2') as { insert: (template: string) => void } | null;
      e.pushUndoStop();
      if (sc) sc.insert(text); else e.executeEdits('code-library', [{ range: e.getSelection() ?? new monaco.Range(1, 1, 1, 1), text, forceMoveMarkers: true }]);
      e.pushUndoStop();
      const there = ins.macro ? useAsmLink.getState().macroDefined(ins.macro) : 'yes';
      toast(warn || (there ? `Put in the call of ${ins.macro ?? ins.name}: Tab goes to the next parameter` : `Put in the call of ${ins.macro}, which the project does not define: Insert definition puts it in a source (or import its file)`), warn || !there ? 'warn' : 'ok');
      return;
    }
    const pos = e.getPosition() ?? { lineNumber: m.getLineCount(), column: 1 };
    const line = Math.min(pos.lineNumber, m.getLineCount()), lc = m.getLineCount(), cur = m.getLineContent(line);
    const blank = !cur.trim(), after = !blank && pos.column > cur.replace(/\s+$/, '').length;
    const lineAt = (n: number) => (n >= 1 && n <= lc ? m.getLineContent(n) : '');
    // (the code there: the line's indent, or where its code starts after a label; an empty line's: the line above it,
    // else the one below)
    const indentOf = (l: string) => { const w = /^[ \t]*/.exec(l)![0]; if (w || !l.trim()) return w; const s = splitLabel(l, lang); return s.label && s.rest.trim() ? ' '.repeat(s.lead.length) : ''; };
    let near = cur;
    if (blank) { for (let n = line - 1; n >= 1; n--) if (lineAt(n).trim()) { near = lineAt(n); break; } if (!near.trim()) for (let n = line + 1; n <= lc; n++) if (lineAt(n).trim()) { near = lineAt(n); break; } }
    const lines = text.split('\n');
    // code with a layout of its own (a line at its start that is a label), and a macro's definition, stay as they are
    const own = ins.block || lines.some(l => /^\S/.test(l) && !!splitLabel(l, lang).label);
    const ind = own ? '' : indentOf(near);
    const body = lines.map(l => (l.trim() && ind ? ind + l : l)).join('\n');
    const prev = blank || !after ? lineAt(line - 1) : cur, next = blank || after ? lineAt(line + 1) : cur;
    const pre = ins.block && prev.trim() ? '\n' : '', post = ins.block && next.trim() ? '\n' : '';
    let range: Monaco.Range, edit: string, first: number;
    if (blank) { range = new monaco.Range(line, 1, line, m.getLineMaxColumn(line)); edit = pre + body + post; first = line + (pre ? 1 : 0); }
    else if (after) { range = new monaco.Range(line, m.getLineMaxColumn(line), line, m.getLineMaxColumn(line)); edit = `\n${pre}${body}${post}`; first = line + 1 + (pre ? 1 : 0); }
    else { range = new monaco.Range(line, 1, line, 1); edit = `${pre}${body}\n${post}`; first = line + (pre ? 1 : 0); }
    e.pushUndoStop();
    e.executeEdits('code-library', [{ range, text: edit, forceMoveMarkers: true }]);
    e.pushUndoStop();
    const last = first + lines.length - 1;
    e.setSelection(new monaco.Range(first, 1, last, m.getLineMaxColumn(Math.min(last, m.getLineCount()))));
    e.revealRangeInCenterIfOutsideViewport(new monaco.Range(first, 1, last, 1));
    toast(warn || `Put in ${ins.name} from the ${ins.library}${note}, lines ${first}–${last}`, warn ? 'warn' : 'ok');
  };
  // the code cannot change while it is being debugged
  // read only while debugging, and a file from outside the folder always (it is edited where it is)
  const shownOutside = !!shown && typeof outside[shown] === 'string';
  /** the tabs of files from outside the folder, and where each was found (the tab row marks them read only) */
  const outsideTabs = useMemo(() => new Map(tabs.open.filter(p => isOutsidePath(p) || typeof outside[p] === 'string').map(p => [p, foundOut.current[p] ?? p] as const)), [tabs.open, outside]);
  useEffect(() => {
    ed.current?.updateOptions({ readOnly: !!dbg || shownOutside, readOnlyMessage: { value: shownOutside ? `${foundOut.current[shown!] ?? shown} is outside the project's folder: Mimir's check and the build read it from there, edit it where it is (or copy it into the folder)` : 'The program is being debugged: Stop to edit' } });
  }, [dbg, state, shownOutside, shown]); // eslint-disable-line react-hooks/exhaustive-deps
  // the debugger's line, in the file shown; at no line of the sources (the KERNAL's CHROUT, an interrupt, code copied
  // elsewhere), the line it is running for: the JSR's, or the line an interrupt came before
  const pcDeco = useRef<Monaco.editor.IEditorDecorationsCollection | null>(null);
  const atBp = dbg && !dbgBusy && bpAddrs(dbg.c).has(dbg.m.cpu.pc) ? lineText(dbg.c, dbg.m.cpu.pc) : null;
  const pcLine = dbg && !dbgBusy ? asmLineAt(dbg.c, dbg.m.cpu.pc) : null;
  const site = dbg && !dbgBusy && !pcLine ? asmCallSite(dbg.c, dbg.m) : null;
  const via = site ? `inside ${site.by === 'jsr' ? 'the JSR on' : 'an interrupt that came before'} ${site.file} line ${site.line}` : null;
  useEffect(() => {
    const monaco = monacoRef.current, e = ed.current;
    if (state !== 'ready' || !monaco || !e) return;
    if (!pcDeco.current) pcDeco.current = e.createDecorationsCollection();
    if (!pcLine && site && site.file === shown) {
      const pc = dbg!.m.cpu.pc, at = `${names.get(pc) ?? ''}${names.has(pc) ? ' ' : ''}($${h4(pc)})`;
      pcDeco.current.set([{ range: new monaco.Range(site.line, 1, site.line, 1), options: { isWholeLine: true, className: 'scr-call-line', glyphMarginClassName: 'scr-call-glyph',
        glyphMarginHoverMessage: { value: site.by === 'jsr' ? `The debugger is at ${at}, inside this line's JSR: the run comes back after this line once the routine returns (Out, Shift+F6, runs until the routine it is in returns)` : `The debugger is at ${at}, in an interrupt that came before this line ran: its RTI comes back here` } } }]);
      return;
    }
    const l = pcLine;
    if (!l || l.file !== shown) { pcDeco.current.clear(); return; }
    pcDeco.current.set([{ range: new monaco.Range(l.line, 1, l.line, 1), options: atBp
      ? { isWholeLine: true, className: 'scr-pc-line scr-pc-bp', linesDecorationsClassName: 'scr-pc-bp-bar', glyphMarginClassName: 'scr-pc-bp-glyph', overviewRuler: { color: '#ff5a6e', position: monaco.editor.OverviewRulerLane.Full } }
      : { isWholeLine: true, className: 'scr-pc-line', glyphMarginClassName: 'scr-pc-glyph' } }]);
  });
  // starting and stopping change the editor's size: laid out again once drawn (or the line numbers stay a line off)
  useEffect(() => { const e = ed.current; if (!e) return; const id = requestAnimationFrame(() => e.layout()); return () => cancelAnimationFrame(id); }, [!!dbg, state, ui.outFolded, c64.open, active]); // eslint-disable-line react-hooks/exhaustive-deps
  // the keys outside the editor: F5 runs, Ctrl+Shift+B builds, F8 / F6 / Shift+F6 step, Ctrl+S writes; the tabs'
  // Ctrl+Tab (Ctrl+PageDown), Ctrl+Shift+Tab (Ctrl+PageUp) and Ctrl+F4 also in the list and the output
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!activeRef.current || document.querySelector('[role="dialog"]')) return;
      if ((e.target as HTMLElement | null)?.closest?.('.monaco-editor, textarea, .c64s-body.keys')) return;
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && !e.altKey && (e.key === 'Tab' || e.key === 'PageDown' || e.key === 'PageUp')) { e.preventDefault(); keys.current.tab(e.key === 'PageUp' || (e.key === 'Tab' && e.shiftKey) ? -1 : 1); return; }
      if (ctrl && !e.altKey && !e.shiftKey && e.key === 'F4') { e.preventDefault(); keys.current.closeTab(); return; }
      if ((e.target as HTMLElement | null)?.closest?.('input, select')) return;
      if (e.key === 'F5' && !e.ctrlKey && !e.altKey) { e.preventDefault(); if (e.shiftKey) keys.current.debugger(); else keys.current.run(); }
      else if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'b') { e.preventDefault(); keys.current.build(); }
      else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 's') { e.preventDefault(); void writeAll(); }
      else if (e.ctrlKey || e.altKey || e.metaKey) return;
      else if (e.key === 'F8') { e.preventDefault(); keys.current.step(); }
      else if (e.key === 'F6') { e.preventDefault(); if (e.shiftKey) keys.current.out(); else keys.current.over(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---- the window ---- */
  // (a source from outside the folder is a text too: read only)
  const shownText = !!shown && (shown in texts || shownOutside);
  const shownEntry = shown ? entryOf.get(shown) : undefined;
  const errors = check?.problems ?? [];
  const first = errors[0];
  const chip = !check ? (main ? 'Checking…' : 'No source') : check.ok
    ? `Ready · ${plural(check.bytes, 'byte')}${check.entry != null ? `, starts at $${h4(check.entry)}` : ''}`
    : `${errors.length > 1 ? `${plural(errors.length, 'problem')} · ` : ''}${first.file !== shown ? `${first.file} ` : ''}${first.line ? `line ${first.line}: ` : ''}${first.msg}`;
  const names = useMemo(() => {
    const own = (dbg ? dbg.c.check.labels : check?.check.labels) ?? new Map<Addr, string>();
    return dbg?.m instanceof AsmC64 ? new Map<Addr, string>([...[...SYM.exact.values()].map(x => [x.addr, x.name] as [Addr, string]), ...own]) : own;
  }, [dbg, check]);
  const listW = ui.listW;
  return (
    <div className={cx('scripts asm-ws', !active && 'asm-hidden')}>
      {ui.listFolded
        ? <div className="scr-list folded" role="navigation" aria-label="Files, folded in">
          <button className="icon-btn" onClick={() => ui.set({ listFolded: false })} aria-label="Unfold the file list" title="Unfold the list of the folder's files"><Icon name="side-show" size={16} /></button>
          <button className="icon-btn" onClick={() => newIn(shown ? parentOf(shown) : '', 'file')} aria-label="New file" title="New file"><Icon name="plus" size={15} /></button>
        </div>
        : <div className="scr-list asm-list" style={{ width: listW }}>
          <div className="asm-top">
            <span className="asm-folder" title={dir}><Icon name="folder" size={13} />{folder.name}</span>
            <button className="icon-btn" aria-label="The folder" title="The project's folder: show it in the file manager, read its files again" onClick={e => { const r = e.currentTarget.getBoundingClientRect(); folderMenu(r.left, r.bottom + 2); }}><Icon name="more" size={15} /></button>
          </div>
          <div className="scr-list-head"><span>Files</span><span className="grow" />
            <button className="icon-btn" onClick={() => newIn(shown && entryOf.get(shown)?.dir ? shown : shown ? parentOf(shown) : '', 'file')} aria-label="New file" title="New file (a name without an extension is a .asm source)"><Icon name="plus" size={15} /></button>
            <button className="icon-btn" onClick={() => newIn(shown ? parentOf(shown) : '', 'folder')} aria-label="New folder" title="New folder"><Icon name="folder" size={14} /></button>
            <button className="icon-btn" onClick={() => ui.set({ listFolded: true })} aria-label="Fold the file list" title="Fold the list in to a strip: the editor gets its room"><Icon name="side-hide" size={15} /></button>
          </div>
          {!loaded ? <p className="muted small asm-tree-empty">Reading the files…</p>
            : <AsmTree entries={folder.entries} expanded={expanded} shown={shown} main={main} dirty={dirty} problems={problemsOf} edit={edit}
              onOpen={(p, keep) => openFile(p, { keep })} onToggle={p => ui.setExpanded(dir, expanded.has(p) ? [...expanded].filter(x => x !== p) : [...expanded, p])}
              onMenu={rowMenu} onEdit={n => void named(n)} />}
          {folder.more && <p className="muted small asm-tree-empty">The folder has more files than the list holds.</p>}
        </div>}
      {!ui.listFolded && <Splitter dir="v" className="asm-list-split" onDrag={d => ui.set({ listW: Math.max(160, Math.min(700, useAssembler.getState().listW + d)) })} />}
      <div className="scr-main">
        <div className="toolbar">
          {shown && shownOutside ? <span className="asm-outside-name mono" title={`${foundOut.current[shown] ?? shown}: outside the project's folder, read only (Mimir's check and the build read it from there)`}><Icon name="lock" size={13} /><span className="asm-outside-file">{baseName(shown)}</span><span className="muted small">read only</span></span>
            : shown ? <FileNameField key={shown} path={shown} dirty={dirty.has(shown)} onRename={n => void named(n, { kind: 'rename', path: shown })} /> : <span className="muted small">No file open</span>}
          {check && <span className={cx('pill scr-check', check.ok ? 'hi' : 'lo')} role="status" onClick={() => { if (first?.file && first.line) openFile(first.file, { line: first.line }); }}
            title={[...errors.map(p => `${p.file}${p.line ? ` line ${p.line}` : ''}: ${p.msg}`), check.ok ? `Mimir's own assembler assembles the program: ${check.ranges.slice(0, 4).map(r => `$${h4(r.start)}-$${h4(r.end - 1)}`).join(', ')}${check.entry != null ? `; a run starts at $${h4(check.entry)}` : ''}.` : 'What Mimir\'s own assembler finds as you type. It knows most of Kick Assembler and 64tass, not all: Run builds with the real one all the same.'].join('\n')}>
            <Icon name={check.ok ? 'check' : 'err'} size={12} />{chip}</span>}
          <button className="pill scr-lang asm-lang" aria-label="Language" onClick={() => onInfo('Language', { lang: lang === '64tass' ? 'kickass' : '64tass' })}
            title={`The project's sources are ${LANG_TITLE[lang]}'s: checked as that and built with ${tool}. A click makes them ${lang === '64tass' ? 'Kick Assembler' : '64tass'} (the project file keeps it)`}>{LANG_TITLE[lang]}</button>
          {main && shown !== main && <button className="pill asm-main-pill" onClick={() => openFile(main)} title={`The main file, which Run and Build build: ${main}. A click opens it (right-click a source in the list to make it the main file)`}>
            <Icon name="play" size={10} />{baseName(main)}</button>}
          <span className="grow" />
          <button className={cx('btn asm-cycles-btn', cycOn && 'on')} aria-pressed={cycOn} onClick={toggleCycles}
            title={cycOn ? 'Hide the cycles' : 'Cycles: each instruction\'s 6510 cycles beside its line number (4+ one more across a page, 2/3 a branch not taken / taken); select lines to count them along one path under Cycles, where a box marks a branch taken'}>
            <Icon name="clock" size={14} /><span className="lbl">Cycles</span></button>
          <button className="btn asm-block-btn" aria-label="Insert block" disabled={!!dbg || !shown || !shownText || !ASM_SOURCE.test(shown) || shownOutside} onClick={() => askBlock()}
            title="Insert a block where the caret is: sprites, a charset, a bitmap, a screen, music or data, from the library, a file, or empty .byte lines to fill in. Graphics and Memory show its bytes as what they are; the rest of the program is code (also in the editor's right-click menu)">
            <Icon name="blocks" size={14} /><span className="lbl">Block…</span></button>
          <button className="btn scr-screen-btn" aria-pressed={c64.open} onClick={() => setC64({ open: !c64.open })}
            title={c64.open ? 'Close the C64 screen beside the code' : 'Open a C64 screen beside the code: what the program prints and writes to the screen while it is debugged in Mimir'}>
            <Icon name="screen" size={14} /><span className="lbl">C64 screen</span></button>
          <span className="tb-sep" />
          {dbg ? <div className="scr-dbg-tools" role="group" aria-label="Debugging">
            {dbgBusy
              ? <button className="btn" onClick={() => { pauseReq.current = true; }} title="Stop where it is now, and go on debugging from there">Pause</button>
              : <button className="btn primary" onClick={contDbg} title={dbg?.m instanceof AsmC64 ? 'Go on in the C64\'s own time, the screen beside the code live, to the next breakpoint or until Pause (Ctrl+Enter)' : 'Go on to the end of the run, or to the next breakpoint (Ctrl+Enter)'}><Icon name="play" />Continue<kbd>Ctrl+Enter</kbd></button>}
            <button className="btn" disabled={dbgBusy} onClick={stepDbg} title="Run the next instruction; into a JSR (F8)">Step<kbd>F8</kbd></button>
            <button className="btn" disabled={dbgBusy} onClick={overDbg} title="Run the next instruction; a JSR runs until it returns (F6)">Over<kbd>F6</kbd></button>
            <button className="btn" disabled={dbgBusy} onClick={outDbg} title="Run until the routine it is in returns (Shift+F6)">Out<kbd>Shift+F6</kbd></button>
            <button className="btn" onClick={() => stopDbg()} title="Stop debugging where it is"><Icon name="x" />Stop</button>
          </div> : <>
            <button className="btn primary scr-run asm-run" disabled={!main || !!build?.running} onClick={() => void run()}
              title={main ? `Build ${main} with ${tool} and start it in VICE (Ctrl+Enter or F5); what is not written yet is written first. Shift+F5 starts it in Retro Debugger or C64 Debugger (Settings → Toolchain) with the sources and the breakpoints` : 'There is no source to run'}>
              <Icon name="play" />{build?.running ? 'Building…' : 'Run'}<kbd>Ctrl+Enter</kbd></button>
            <button className="btn asm-build" disabled={!main || !!build?.running} onClick={() => void doBuild(false)} title={main ? `Build ${main} with ${tool}, without starting it (Ctrl+Shift+B): the PRG goes in out\\ beside it` : 'There is no source to build'}>Build</button>
            <button className="btn asm-release" disabled={!main || !!build?.running} onClick={onRelease} title={main ? `Release: build ${main} and make a disk image (.d64), a tape image (.tap), a cartridge (.crt) or a PRG of it, packed or not, in out\\, and start it in VICE; or write build.bat and build.sh` : 'There is no source to build'}>Release…</button>
            <button className="btn scr-debug-btn" disabled={!check?.ok || !!check.cpus.length} onClick={() => void startDebug()}
              title={!check?.ok ? 'The program must assemble in Mimir before it can be debugged: see the problems'
                : check.cpus.length ? `The program is written for the ${check.cpus.join(' and ')} (.cpu): Mimir's debugger runs a 6510, as the C64 has. Run builds it with 64tass`
                : machineKind === 'c64' ? 'Debug in the whole C64: Sindri\'s C64 with VICE\'s ROMs, the VIC, the CIAs and their interrupts. The program is loaded as LOAD does, started with RUN (or SYS) typed at READY and stopped before its first instruction; then an instruction at a time (F8), over a JSR (F6), or on in the C64\'s own time with the screen live (Ctrl+Enter) to a breakpoint (click left of a line number).'
                : 'Debug: start the program in Mimir\'s 6510 and stop before its first instruction, then go an instruction at a time (F8), over a JSR (F6) or on to a breakpoint (click left of a line number). Memory only: no ROMs or I/O, the KERNAL\'s printing routines are done on the C64 screen (Runs in: Whole C64 has the rest)'}>Debug<kbd>F8</kbd></button>
            <select className="asm-machine" aria-label="Runs in" value={machineKind} onChange={e => ui.setMachine(dir, e.target.value === 'c64' ? 'c64' : 'memory')}
              title="What Debug runs the program in: Mimir's 6510 with the program's memory only (fast, the KERNAL's printing routines done on the C64 screen), or the whole C64 (Sindri, with VICE's ROMs: BASIC, the KERNAL, the VIC, the CIAs, interrupts, the keyboard; the screen as the VIC draws it, live)">
              <option value="memory">Memory only</option>
              <option value="c64">Whole C64</option>
            </select>
          </>}
          <button className="icon-btn asm-settings" aria-label="Assembler project settings" onClick={onSettings}
            title={`The project's settings: its language, main file, more ${tool} arguments${own.trim() ? ` (now ${own.trim()})` : ''} and where Debug runs (Settings → Assembler project)`}>
            <Icon name="sliders" size={14} /></button>
        </div>
        {dbg && (dbg.m instanceof AsmC64
          ? <p className="scr-howto scr-dbg-note" role="note"><Icon name="info" size={13} /><span>Debugging in the whole C64 (Sindri, VICE's ROMs): {dbg.m.typed} was typed at READY and the program stopped at its first instruction. <b>Continue</b> runs it in the C64's own time with the screen live; click the screen and type to use the C64's keyboard. The code cannot be changed until you stop; a click left of a line number sets a breakpoint.</span></p>
          : <p className="scr-howto scr-dbg-note" role="note"><Icon name="info" size={13} /><span>Debugging in Mimir's 6510: the code cannot be changed until you stop. A click left of a line number sets a breakpoint. It has no ROMs or I/O: the KERNAL's printing routines are done on the C64 screen.</span></p>)}
        <div className="scr-body">
          <TabRow open={tabs.open} preview={tabs.preview} shown={shown} main={main} dirty={dirty} problems={problemsOf} outside={outsideTabs}
            onShow={p => setShown(p)} onKeep={p => placeTab(p, true)} onClose={closeTabs} onMove={moveTab} onMenu={tabMenu} />
          <div className="scr-edit-row" ref={editRow}>
            <div className="mon-host scr-editor" ref={host} aria-label="Code" style={{ display: state === 'ready' && shownText ? 'block' : 'none' }} />
            {state === 'fallback' && shownText && <textarea className="fallback-code scr-fallback" aria-label="Code" value={shownOutside ? String(outside[shown!]) : texts[shown!]} readOnly={!!dbg || shownOutside} onChange={e => { const p = shown!; if (shownOutside) return; setTexts(t => ({ ...t, [p]: e.target.value })); schedule(p); }} />}
            {shown && !shownText && <div className="asm-binary" role="note">
              <Icon name={shownEntry?.dir ? 'folder' : fileIcon(shown)} size={28} />
              <h3>{baseName(shown)}</h3>
              <p className="muted">{shownEntry ? `${fmtBytes(shownEntry.size)}: not a text file the editor opens.` : 'The file is not there any more.'} A source loads it with <span className="mono">{lang === '64tass' ? '.binary' : '.import binary'}</span>{lang === '64tass' ? '' : ' or LoadSid'}.</p>
              <button className="btn small" onClick={() => void kr?.assemblerReveal({ dir, path: shown })}><Icon name="folder" size={13} />Show in folder</button>
            </div>}
            {!shown && loaded && <div className="asm-binary" role="note"><Icon name="code" size={28} /><h3>No file open</h3><p className="muted">Click a file in the list to open it (a double-click keeps its tab open), or + to make a source.</p></div>}
            {dbg && <DebugPanel m={dbg.m} prev={dbg.prev} names={names} busy={dbgBusy} atBp={atBp} lineOf={a => lineText(dbg.c, a)} via={via} />}
            {c64.open && <>
              <Splitter dir="v" onDrag={d => {
                const rowW = editRow.current?.offsetWidth ?? 1200, other = (dbg ? 300 : 0) + 200;
                setC64({ width: Math.max(240, Math.min(rowW - other, useScripts.getState().c64.width - d)) });
              }} />
              <div className="scr-screen-col" style={{ width: c64.width }}>
                <ScriptScreenPanel screen={dbg ? (dbg.m instanceof AsmC64 ? dbg.m.text() : dbg.m.screen.state()) : kept?.run.screen ?? null} live={!!dbg} extended={c64.extended} zoom={c64.zoom} mag={c64.mag} size={c64.size}
                  picture={dbg ? (dbg.m instanceof AsmC64 ? pic?.p ?? null : null) : kept?.picture ?? null} frame={pic?.n ?? 0}
                  keys={dbg?.m instanceof AsmC64 ? { onKey: c64Keys, onBlur: c64Release, hint: dbgBusy ? 'Click the screen and type: the keys go to the C64\'s keyboard (Esc is RUN/STOP, Alt is C=, Tab is CTRL).' : `Stopped on raster line ${dbg.m.m.vic.line}, cycle ${dbg.m.m.vic.lineCycle}: the picture down to that line is this frame's, below it the VIC's registers as they are now. Continue (Ctrl+Enter) runs the C64; click the screen and type for its keyboard.` } : null}
                  onExtended={v => setC64({ extended: v })} onZoom={z => setC64({ zoom: z })} onMag={m => setC64({ mag: m })} onSize={sz => setC64({ size: sz })}
                  onCopy={t => void navigator.clipboard.writeText(t).then(() => toast('Copied the screen\'s text', 'ok'))} onClose={() => setC64({ open: false })} />
              </div>
            </>}
          </div>
          {!ui.outFolded && <Splitter dir="h" onDrag={d => {
            const h = useAssembler.getState().outH, now = Math.min(h, document.getElementById('asm-out')?.offsetHeight ?? h);
            const room = Math.max(0, (editRow.current?.offsetHeight ?? 140) - 140);
            ui.set({ outH: Math.max(110, Math.min(window.innerHeight - 200, now + room, now - d)) });
          }} />}
          <AsmOutput check={check} build={build} kept={kept} tab={ui.outTab} folded={ui.outFolded} height={ui.outH}
            onTab={t => ui.set({ outTab: t })} onFold={v => ui.set({ outFolded: v })} onGo={(f, l) => { if (paths.has(f) || f === '<command line>' || f in outside || isOutsidePath(f)) openFile(f, { line: l || 1 }); }} onScreen={() => setC64({ open: true })} cycles={cycles} notes={notes} />
        </div>
      </div>
      {blockAsk && shown && <AsmBlockDialog lang={lang} dir={dir} source={shown} paths={paths} names={new Set(check?.names.keys() ?? [])} kind={blockAsk.kind} lib={blockAsk.lib}
        onInsert={b => void insertBlock(b)} onClose={() => { setBlockAsk(null); requestAnimationFrame(() => ed.current?.focus()); }} />}
    </div>
  );
}

/** The shown file's name in the toolbar: typing a new one renames the file (Enter), Esc gives it up. */
function FileNameField({ path, dirty, onRename }: { path: string; dirty: boolean; onRename: (name: string) => void }) {
  const name = baseName(path);
  const [v, setV] = useState(name);
  useEffect(() => setV(name), [name]);
  const commit = () => { const n = v.trim(); if (!n || n === name) { setV(name); return; } onRename(n); };
  return (
    <span className="asm-file">
      <input className="scr-name" aria-label="File name" value={v} maxLength={200} spellCheck={false} title={`${path}${dirty ? ' · changes not written yet' : ''}: a new name renames the file`}
        onChange={e => setV(e.target.value)} onBlur={commit}
        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setV(name); (e.target as HTMLInputElement).blur(); } }} />
      {dirty && <span className="asm-dirty" aria-label="not written yet" title="Changes not written yet: they are a moment after the last key (Ctrl+S writes now)" />}
    </span>
  );
}
