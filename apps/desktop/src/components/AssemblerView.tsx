/* The Assembler (spec 10.7): the script editor (10.3) as an assembler, started from the start screen. A folder of Kick
 * Assembler or 64tass sources is the project: its files are listed beside the code in place of the script editor's
 * library and templates. A file opened there is written in the same editor (highlighting, suggestions and hovers of the
 * program's names, go to a definition in any of the folder's files), checked as it is typed with Mimir's own assembler,
 * and written to its file a moment after the last key, as everything in Mimir is kept as it is made. Run builds the main
 * file with KickAss.jar or 64tass and starts it in VICE; Debug runs it in Mimir's 6510 an instruction at a time, with
 * breakpoints, the registers, the stack and the C64 screen; under the code the problems, the last build and the last run. */
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api';
import { ASM_SOURCE, ASM_TEXT, asmAddrOf, asmEndText, asmLineAt, asmMachine, asmTemplate, checkAsm, dataFiles, endedWell, h4, LANG_TITLE, mainFile, sourceLang, type Addr, type AsmCheck, type ScriptLang, type ScriptMachine } from '@mimir/core';
import type { AsmChangeRequest, AsmEntry, AsmFolder, AsmStartInfo, BuildResult } from '../../shared/ipc';
import { projectNameProblem } from '../../shared/projects';
import type { ContextMenuState, MenuItem } from '../lib/types';
import { Icon, LVL_ICON } from '../lib/icons';
import { cx, errorText, fmtBytes } from '../lib/util';
import { NO_TABS, useAssembler, type AsmTabs } from '../store/assembler';
import { runScreenSize, useScripts } from '../store/scripts';
import { ContextMenu } from './ContextMenu';
import { Splitter } from './Splitter';
import { DebugPanel, regsOf, type DebugRegs } from './ScriptDebug';
import { ScriptScreenPanel } from './ScriptScreen';
import { AsmTabs as TabRow, AsmTree, baseName, fileIcon, parentOf, type TreeEdit } from './AsmTree';
import { AsmOutput, type AsmBuild, type AsmBuildProblem, type AsmRunKept } from './AsmOutput';

const kr = window.kr;
type MonacoNs = typeof Monaco;
type ToastKind = 'ok' | 'info' | 'warn' | 'err';
type ToastFn = (msg: string, kind?: ToastKind) => void;
type OnMenu = (x: number, y: number, items: MenuItem[]) => void;
/** where a file opens: at a line (and column); `soft`: the debugger's line, shown only when out of view, the cursor and
 *  the focus left where they are; `keep`: in a tab that stays (else in the preview tab, when it is not open yet) */
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
const pathOfUri = (uri: Monaco.Uri) => (uri.scheme === 'asm' ? uri.path.replace(/^\//, '') : null);
/** whether `full` is the folder `dir` or in it */
const inside = (dir: string, full: string) => { const d = dir.replace(/[\\/]+$/, '').toLowerCase(), f = full.toLowerCase(); return f === d || f.startsWith(`${d}\\`) || f.startsWith(`${d}/`); };
const joinDir = (dir: string, sub: string) => `${dir.replace(/[\\/]+$/, '')}${dir.includes('\\') ? '\\' : '/'}${dir.includes('\\') ? sub.replace(/\//g, '\\') : sub}`;

export function AssemblerView({ onBack }: { onBack: () => void }) {
  const [folder, setFolder] = useState<AsmFolder | null>(null);
  const [toasts, setToasts] = useState<{ id: number; msg: string; kind: ToastKind }[]>([]);
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const toast = useCallback<ToastFn>((msg, kind = 'info') => {
    const id = Date.now() + Math.random();
    setToasts(t => [...t.slice(-3), { id, msg, kind }]);
    if (kind !== 'err') setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), Math.min(9000, Math.max(4200, msg.length * 40)));
  }, []);
  const onMenu = useCallback<OnMenu>((x, y, items) => setMenu({ x, y, items }), []);
  /** what the window does before it closes: the files written (AsmWorkspace sets it) */
  const beforeClose = useRef<() => Promise<unknown>>(() => Promise.resolve());
  // the window closing (its X, Alt+F4): what is not written yet is written first
  useEffect(() => kr?.onCloseAsked(() => { void beforeClose.current().catch(() => null).then(() => kr.answerClose({ close: true })); }), []);
  return (
    <div className="asm-app">
      {folder ? <AsmWorkspace key={folder.dir} folder={folder} onFolder={setFolder} toast={toast} onMenu={onMenu} beforeClose={beforeClose}
        onLeave={to => { if (to === 'start') onBack(); else setFolder(null); }} />
        : <AsmHome onOpened={setFolder} onBack={onBack} />}
      {menu && <ContextMenu menu={menu} onClose={() => setMenu(null)} />}
      <div className="toasts" aria-live="polite">{toasts.map(t => <div key={t.id} className={cx('toast', `t-${t.kind}`)}><Icon name={LVL_ICON[t.kind] || 'info'} size={15} /><span className="toast-msg">{t.msg}</span>
        {t.kind === 'err' && <button className="icon-btn toast-x" aria-label="Dismiss the message" onClick={() => setToasts(x => x.filter(y => y.id !== t.id))}><Icon name="x" size={13} /></button>}</div>)}</div>
    </div>
  );
}

/* ---------------------------------------------------------------------------------------------------------------- */

/** Before a folder is open: open one (a dialog, or one opened before), or make a new one with a first source. */
function AsmHome({ onOpened, onBack }: { onOpened: (f: AsmFolder) => void; onBack: () => void }) {
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
  const open = (path?: string) => run(async () => { const f = await kr?.assemblerOpen(path ? { path } : {}); if (f) onOpened(f); });
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
        <p className="asm-home-lead">A folder of sources is the project: its files are listed beside the code. What you type is checked as you type and written to its file at once; <b>Run</b> builds the main file with KickAss.jar or 64tass and starts it in VICE, <b>Debug</b> goes through it in Mimir's 6510 a step at a time.</p>
        {creating && info
          ? <NewFolderForm parent={info.parent} onCreate={async (name, parent, lang) => { const f = await kr!.assemblerCreate({ name, parent, files: { 'main.asm': asmTemplate(lang, name) } }); onOpened(f); }} onCancel={() => setCreating(false)} />
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

/** A new folder for the Assembler: its name, where it goes and the assembler its first source is written for. */
function NewFolderForm({ parent: parent0, onCreate, onCancel }: { parent: string; onCreate: (name: string, parent: string, lang: ScriptLang) => Promise<void>; onCancel: () => void }) {
  const [name, setName] = useState('');
  const [parent, setParent] = useState(parent0);
  const [lang, setLang] = useState<ScriptLang>('kickass');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const n = name.trim(), problem = projectNameProblem(name);
  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (problem || busy) return;
    setBusy(true); setError(null);
    try { await onCreate(n, parent, lang); } catch (err) { setError(errorText(err)); setBusy(false); }
  };
  const where = `${parent.replace(/[\\/]+$/, '')}${parent.includes('/') && !parent.includes('\\') ? '/' : '\\'}${n}`;
  return (
    <form className="new-project" onSubmit={submit} aria-label="New folder of sources">
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
      <div className="np-where">{n && !problem
        ? <>Creates <span className="mono">{where}</span> with <span className="mono">main.asm</span> in it: a program that prints a line, to start from.</>
        : <span className={cx(n && 'bad')}>{problem}</span>}</div>
      {error && <div className="np-error" role="alert">{error}</div>}
      <div className="np-foot"><span className="grow" /><button type="button" className="btn" onClick={onCancel}>Cancel</button><button type="submit" className="btn primary" disabled={!!problem || busy}>{busy ? 'Creating…' : 'Create'}</button></div>
    </form>
  );
}

/* ---------------------------------------------------------------------------------------------------------------- */

/** a run of the program in Mimir's 6510, going an instruction at a time: its machine and check, the registers before
 *  the last step (what it changed is marked) */
interface Debugging { m: ScriptMachine; c: AsmCheck; prev: DebugRegs | null }

interface WorkspaceProps {
  folder: AsmFolder;
  onFolder: (f: AsmFolder) => void;
  onLeave: (to: 'home' | 'start') => void;
  toast: ToastFn;
  onMenu: OnMenu;
  beforeClose: { current: () => Promise<unknown> };
}

function AsmWorkspace({ folder, onFolder, onLeave, toast, onMenu, beforeClose }: WorkspaceProps) {
  const dir = folder.dir;
  const ui = useAssembler();
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
  const fixTabs = (now: { has: (p: string) => boolean }) => {
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
  beforeClose.current = writeAll;
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
      if (m && !m.isDisposed() && m.getValue() !== text) { applying.current = true; m.pushEditOperations([], [{ range: m.getFullModelRange(), text }], () => null); m.pushStackElement(); applying.current = false; }
    }
    setTexts(t => { const n = { ...t }; for (const p of gone) delete n[p]; for (const [p, text] of Object.entries(read)) n[p] = text; return n; });
  };
  const relistTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const relist = async () => {
    let f: AsmFolder;
    try { f = await kr!.assemblerList({ dir }); } catch { return; }
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
  const chosen = ui.mains[dir];
  const main = chosen && paths.has(chosen) ? chosen : guessed;
  const lang: ScriptLang = ui.langs[dir] ?? (main ? sourceLang(quiet[main] ?? '') : 'kickass');
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
  const check = useMemo<AsmCheck | null>(() => {
    if (!loaded || !main || !(main in quiet)) return null;
    try { return checkAsm({ ...quiet, ...bins }, main, lang); } catch { return null; }
  }, [quiet, bins, main, lang, loaded]);
  // the names the editor suggests and the hover says: the program's labels and constants (the last check that had them)
  useEffect(() => {
    if (!check?.names.size) return;
    const kinds = new Map<string, string>();
    for (const [n, v] of check.names) {
      const l = v >= 0 && v < 0x10000 && check.asm.written[v] ? asmLineAt(check, v) : null;
      kinds.set(n, l ? `a label · ${l.file} line ${l.line}` : 'a constant');
    }
    void import('../monaco/providers').then(({ asmContext }) => { asmContext.names = check.names; asmContext.kinds = kinds; });
  }, [check]);

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
  /** (`soft`: the debugger's line, shown only when it is out of view, the cursor and the focus left where they are) */
  const reveal = useRef<{ path: string; line: number; col?: number; soft?: boolean } | null>(null);
  /** what the editor's keys and the gutter do (the editor is made once; these change every render) */
  const keys = useRef({ run: () => { }, build: () => { }, step: () => { }, over: () => { }, out: () => { }, cont: () => { }, toggleBp: (_line: number) => { }, write: () => { }, open: (_p: string, _o?: OpenAt) => { }, tab: (_step: number) => { }, closeTab: () => { } });

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
        if (applying.current || !m || !path) return;
        const text = m.getValue();
        setTexts(t => ({ ...t, [path]: text }));
        schedule(path);
        // a preview typed in is kept open
        const t = tabsNow();
        if (t.preview === path) setTabs({ ...t, preview: null });
      });
      // Ctrl+Enter runs (debugging: goes on), Ctrl+Shift+B builds, Ctrl+S writes now; F8 steps (and starts debugging),
      // F6 steps over a JSR, Shift+F6 out of one
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => { editor.trigger('run', 'hideSuggestWidget', null); if (dbgRef.current) keys.current.cont(); else keys.current.run(); });
      editor.addCommand(monaco.KeyCode.F5, () => keys.current.run());
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
      // a click in the gutter left of the line numbers sets or clears a breakpoint
      editor.onMouseDown(ev => { if (ev.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN && ev.target.position) keys.current.toggleBp(ev.target.position.lineNumber); });
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
      bpIds.current[p] = []; setBps(p, useAssembler.getState().bps[`${dir}|${p}`] ?? [], m);
    }
    for (const p of Object.keys(models.current)) if (!(p in texts)) { models.current[p].dispose(); delete models.current[p]; delete views.current[p]; }
    for (const [p, m] of Object.entries(models.current)) { const l = editorLang(p, lang); if (m.getLanguageId() !== l) monaco.editor.setModelLanguage(m, l); }
  }, [state, texts, lang]); // eslint-disable-line react-hooks/exhaustive-deps

  // the files open when the folder opens: the tabs it had (those still there) and the file shown last, else the main
  // file (or the first source)
  useEffect(() => {
    if (!loaded || opened.current) return;
    opened.current = true;
    const t = tabsNow(), open = t.open.filter(p => paths.has(p));
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
      requestAnimationFrame(() => { if (r.soft) { e.revealLineInCenterIfOutsideViewport(n); return; } e.revealLineInCenter(n); e.setPosition({ lineNumber: n, column: r.col ?? 1 }); e.focus(); });
    }
  });

  /** a file opened in the editor (its folders opened in the list), in its tab: one open already, else the preview tab
   *  (a file put in its place) or, `keep`, a new tab after the one shown; at a line (OpenAt) */
  const openFile = (path: string, o: OpenAt = {}) => {
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
      ...(source ? [{ label: 'Main file: Run and Build build it', checked: path === main, run: () => { ui.setMain(dir, path); toast(`${path} is the main file: Run and Build build it`, 'ok'); } }] : []),
      { label: 'Show in the list', icon: 'files', run: () => { openFile(path); requestAnimationFrame(() => document.querySelector<HTMLElement>(`.asm-tree [data-path="${CSS.escape(path)}"]`)?.focus()); } },
      { label: 'Show in folder', icon: 'folder', run: () => void kr?.assemblerReveal({ dir, path }).catch((err: unknown) => toast(errorText(err), 'err')) },
      { label: 'Copy path', icon: 'copy', run: () => { const full = joinDir(dir, path); void navigator.clipboard.writeText(full).then(() => toast(`Copied ${full}`, 'ok')); } },
    ]);
  };

  // the problems as markers on their lines: what Mimir's check finds, and what the last build found
  const [build, setBuild] = useState<AsmBuild | null>(null);
  useEffect(() => {
    const monaco = monacoRef.current;
    if (state !== 'ready' || !monaco) return;
    for (const [p, m] of Object.entries(models.current)) {
      if (m.isDisposed()) continue;
      const on = (line: number) => line > 0 && line <= m.getLineCount();
      monaco.editor.setModelMarkers(m, 'asm-check', (check?.problems ?? []).filter(x => x.file === p && on(x.line)).map(x => ({
        severity: monaco.MarkerSeverity.Error, message: x.msg, source: 'Mimir\'s check', startLineNumber: x.line, startColumn: 1, endLineNumber: x.line, endColumn: m.getLineMaxColumn(x.line),
      })));
      monaco.editor.setModelMarkers(m, 'asm-build', (build?.problems ?? []).filter(x => x.file === p && on(x.line)).map(x => ({
        severity: x.severity === 'error' ? monaco.MarkerSeverity.Error : monaco.MarkerSeverity.Warning, message: x.msg, source: build!.tool,
        startLineNumber: x.line, startColumn: Math.max(1, x.column || 1), endLineNumber: x.line, endColumn: m.getLineMaxColumn(x.line),
      })));
    }
  }, [check, build, state, texts]);
  const problemsOf = useMemo(() => {
    const n = new Map<string, number>();
    for (const p of check?.problems ?? []) if (p.file) n.set(p.file, (n.get(p.file) ?? 0) + 1);
    for (const p of build?.problems ?? []) if (p.file && p.severity === 'error') n.set(p.file, (n.get(p.file) ?? 0) + 1);
    return n;
  }, [check, build]);

  /* ---- the files' changes from the list: new, renamed, deleted ---- */
  const change = async (req: AsmChangeRequest, done?: string): Promise<boolean> => {
    try { const f = await kr!.assemblerChange(req); onFolder(f); await takeListing(f); if (done) toast(done, 'ok'); return true; }
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
    await Promise.all(Object.keys(timers.current).filter(under).map(write));
    const moved = (p: string) => `${to}${p.slice(from.length)}`;
    // (the tabs, the file shown and where it was shown follow the files: fixTabs asks where each went)
    moves.current = p => (under(p) ? moved(p) : null);
    for (const p of Object.keys(views.current)) if (under(p)) views.current[moved(p)] = views.current[p];
    try { if (!await change({ dir, op: 'rename', path: from, to }, `${from} is ${to} now`)) return; } finally { moves.current = null; }
    if (chosen && under(chosen)) ui.setMain(dir, moved(chosen));
    ui.setExpanded(dir, [...expanded].map(p => (under(p) ? moved(p) : p)));
  };
  const remove = async (e: AsmEntry) => {
    const under = (p: string) => p === e.path || p.startsWith(`${e.path}/`);
    for (const p of Object.keys(timers.current).filter(under)) { clearTimeout(timers.current[p]); delete timers.current[p]; }
    // (its tabs are closed as the listing no longer has it: fixTabs)
    if (!await change({ dir, op: 'remove', path: e.path }, `${e.path} is in the Recycle Bin`)) return;
    if (chosen && under(chosen)) ui.setMain(dir, null);
  };
  const rowMenu = (x: number, y: number, e: AsmEntry | null) => {
    const source = !!e && !e.dir && ASM_SOURCE.test(e.path);
    const full = e ? joinDir(dir, e.path) : dir;
    const items: MenuItem[] = [
      ...(e && !e.dir ? [{ label: 'Open', icon: 'doc' as const, run: () => openFile(e.path, { keep: true }) }] : []),
      ...(source ? [{ label: 'Main file: Run and Build build it', checked: e!.path === main, run: () => { ui.setMain(dir, e!.path); toast(`${e!.path} is the main file: Run and Build build it`, 'ok'); } }] : []),
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
  const leave = async (to: 'home' | 'start') => {
    if (dbgRef.current) stopDbg(true);
    await writeAll();
    void kr?.assemblerClose({ dir }).catch(() => null);
    onLeave(to);
  };
  const folderMenu = (x: number, y: number) => onMenu(x, y, [
    { header: folder.name },
    { label: 'Open another folder…', icon: 'folder', run: () => void (async () => { await writeAll(); const f = await kr?.assemblerOpen({}).catch((e: unknown) => { toast(errorText(e), 'err'); return null; }); if (f) onFolder(f); })() },
    { label: 'Close the folder', icon: 'x', run: () => void leave('home') },
    { sep: true },
    { label: 'Show in folder', icon: 'folder', run: () => void kr?.assemblerReveal({ dir }) },
    { label: 'Read the files again', icon: 'refresh', run: () => void relist() },
  ]);

  /* ---- Build and Run: the main file with KickAss.jar or 64tass, then VICE ---- */
  const tool = lang === '64tass' ? '64tass' : 'KickAss.jar';
  const building = useRef(false);
  /** the main file built (what is not written yet is first): its PRG and labels, or null (said why) */
  const doBuild = async (forRun: boolean): Promise<{ prgPath: string; vsPath: string | null } | null> => {
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
      try { r = await kr.build({ dir: sub ? joinDir(dir, sub) : dir, entries: [baseName(main)], assembler: lang === '64tass' ? '64tass' : 'kick' }); }
      catch (e) { setBuild({ ...base, running: false, log: errorText(e) }); ui.set({ outTab: 'build', outFolded: false }); toast(`${tool} did not run: ${errorText(e)}`, 'err'); return null; }
      const o = r.outputs[0];
      const problems: AsmBuildProblem[] = r.problems.map(p => ({ file: p.file ? tidyPath(sub ? `${sub}/${p.file}` : p.file) : '', line: p.line, column: p.column, msg: p.message, severity: p.severity }));
      const prg = o?.ok && o.prg && o.prg.length > 2 ? { path: o.prgPath, load: o.prg[0] | (o.prg[1] << 8), size: o.prg.length - 2 } : null;
      const ok = !!o && r.ok && !!prg;
      setBuild({ ...base, running: false, ok: o ? ok : null, log: r.stdout || problems.map(p => p.msg).join('\n'), commands: r.commands, problems, ms: r.ms, prg });
      if (!ok) {
        ui.set({ outTab: problems.some(p => p.file) ? 'problems' : 'build', outFolded: false });
        const p = problems.find(x => x.severity === 'error');
        toast(!o ? `${p?.msg ?? `${tool} is not set`}${/not set|not found|missing/i.test(p?.msg ?? '') ? ' (Settings → Toolchain in Mimir\'s main window)' : ''}` : `${tool} could not build ${main}${p ? `: ${p.file}${p.line ? `:${p.line}` : ''} ${p.msg}` : ''}`, 'err');
        if (p?.file && paths.has(p.file)) openFile(p.file, { line: p.line, col: p.column || 1 });
        return null;
      }
      if (!forRun) toast(`Built ${baseName(o.prgPath)}: ${fmtBytes(prg!.size)} at $${h4(prg!.load)}`, 'ok');
      return { prgPath: o.prgPath, vsPath: o.vsPath };
    } finally { building.current = false; }
  };
  const run = async () => {
    if (dbgRef.current) { contDbg(); return; }
    const b = await doBuild(true);
    if (!b || !kr) return;
    try {
      const res = await kr.run({ prgPath: b.prgPath, ...(b.vsPath ? { labelsPath: b.vsPath } : {}) });
      const how = res.via === 'run' ? 'with RUN' : res.via === 'sys' ? 'with SYS' : res.via === 'monitor' ? 'from the monitor' : '';
      setBuild(x => x && { ...x, vice: `VICE started it ${how}`.trim() });
      toast(`VICE started ${baseName(b.prgPath)} ${how}${b.vsPath ? ', its labels in the monitor' : ''}`.trim(), 'ok');
    } catch (e) {
      setBuild(x => x && { ...x, vice: `VICE did not start: ${errorText(e)}` });
      toast(`VICE did not start: ${errorText(e)} (Settings → Toolchain in Mimir's main window)`, 'err');
    }
  };

  /* ---- the debugger: the program in Mimir's 6510, an instruction at a time ---- */
  const [dbg, setDbg] = useState<Debugging | null>(null);
  const dbgRef = useRef(dbg); dbgRef.current = dbg;
  const [, setTick] = useState(0);
  const [dbgBusy, setDbgBusy] = useState(false);
  const busyRef = useRef(false), pauseReq = useRef(false);
  const [kept, setKept] = useState<AsmRunKept | null>(null);
  useEffect(() => () => { pauseReq.current = true; }, []);
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
  /** the debugger stopped somewhere: its line shown (in its file); at the end of the run, it is the last run */
  const stopped = (d: Debugging) => {
    if (dbgRef.current !== d) return;
    if (d.m.end) { finishDbg(d); return; }
    setTick(t => t + 1);
    const l = asmLineAt(d.c, d.m.cpu.pc);
    if (l) openFile(l.file, { line: l.line, col: 1, soft: true });
  };
  const finishDbg = (d: Debugging) => {
    setDbg(null); dbgRef.current = null;
    const r = d.m.result(), ok = endedWell(r.end);
    const text = asmEndText(r, a => lineText(d.c, a), a => !!d.c.asm.written[a]);
    setKept({ run: r, text, ok, at: Date.now() });
    ui.set({ outTab: 'run', outFolded: false });
    toast(text, ok ? 'ok' : 'warn');
  };
  const startDebug = () => {
    if (dbgRef.current || building.current) return;
    if (!check) { toast('There is no main file to debug: + makes a source', 'warn'); return; }
    if (!check.ok) { const p = check.problems[0]; toast(`The program does not assemble in Mimir${p ? `: ${p.file}${p.line ? ` line ${p.line}` : ''}: ${p.msg}` : ''}`, 'warn'); if (p?.file && p.line) openFile(p.file, { line: p.line }); return; }
    let m: ScriptMachine;
    try { m = asmMachine(check, lang, runScreenSize()); } catch (e) { toast(errorText(e), 'err'); return; }
    const d: Debugging = { m, c: check, prev: null };
    setDbg(d); dbgRef.current = d;
    stopped(d);
  };
  /** on until `stop` holds, a breakpoint's line is next, or the run ends; in parts, so the window keeps drawing */
  const go = (stop: ((m: ScriptMachine) => boolean) | null, keepPrev = false) => {
    const d = dbgRef.current; if (!d || busyRef.current) return;
    const bps = bpAddrs(d.c);
    const at = (m: ScriptMachine) => (stop ? stop(m) : false) || (bps.size > 0 && bps.has(m.cpu.pc));
    if (!keepPrev) d.prev = regsOf(d.m);
    pauseReq.current = false; busyRef.current = true; setDbgBusy(true);
    const part = () => {
      if (dbgRef.current !== d) return;
      const r = pauseReq.current ? 'stopped' : d.m.runUntil(at, DEBUG_SLICE);
      if (r === 'more') { setTick(t => t + 1); setTimeout(part, 0); return; }
      busyRef.current = false; setDbgBusy(false);
      stopped(d);
    };
    setTimeout(part, 0);
  };
  const stepDbg = () => {
    const d = dbgRef.current; if (!d) { startDebug(); return; }
    if (busyRef.current) return;
    d.prev = regsOf(d.m); d.m.step(); stopped(d);
  };
  const overDbg = () => {
    const d = dbgRef.current; if (!d) { startDebug(); return; }
    if (busyRef.current) return;
    const m = d.m;
    if (m.peek(m.cpu.pc) !== 0x20) { stepDbg(); return; }
    const s0 = m.cpu.s, back = (m.cpu.pc + 3) & 0xffff;
    d.prev = regsOf(m); m.step();
    if (m.end || (m.cpu.s === s0 && m.cpu.pc === back)) { stopped(d); return; }
    go(x => x.cpu.s === s0 && x.cpu.pc === back, true);
  };
  const outDbg = () => { const d = dbgRef.current; if (!d || busyRef.current) return; const s0 = d.m.cpu.s; go(x => x.cpu.lastOp === 0x60 && x.cpu.s > s0); };
  const contDbg = () => { if (!dbgRef.current) startDebug(); else go(null); };
  const stopDbg = (quiet = false) => {
    pauseReq.current = true;
    if (!dbgRef.current) return;
    setDbg(null); dbgRef.current = null; busyRef.current = false; setDbgBusy(false);
    if (!quiet) toast('Debugging stopped', 'info');
  };
  keys.current = { run: () => void run(), build: () => void doBuild(false), step: stepDbg, over: overDbg, out: outDbg, cont: contDbg, toggleBp, write: () => { if (shownRef.current) void write(shownRef.current); }, open: openFile, tab: stepTab, closeTab: () => { if (shownRef.current) closeTabs([shownRef.current]); } };
  // the code cannot change while it is being debugged
  useEffect(() => { ed.current?.updateOptions({ readOnly: !!dbg }); }, [dbg, state]);
  // the debugger's line, in the file shown
  const pcDeco = useRef<Monaco.editor.IEditorDecorationsCollection | null>(null);
  const atBp = dbg && !dbgBusy && bpAddrs(dbg.c).has(dbg.m.cpu.pc) ? lineText(dbg.c, dbg.m.cpu.pc) : null;
  useEffect(() => {
    const monaco = monacoRef.current, e = ed.current;
    if (state !== 'ready' || !monaco || !e) return;
    if (!pcDeco.current) pcDeco.current = e.createDecorationsCollection();
    const l = dbg && !dbgBusy ? asmLineAt(dbg.c, dbg.m.cpu.pc) : null;
    if (!l || l.file !== shown) { pcDeco.current.clear(); return; }
    pcDeco.current.set([{ range: new monaco.Range(l.line, 1, l.line, 1), options: atBp
      ? { isWholeLine: true, className: 'scr-pc-line scr-pc-bp', linesDecorationsClassName: 'scr-pc-bp-bar', glyphMarginClassName: 'scr-pc-bp-glyph', overviewRuler: { color: '#ff5a6e', position: monaco.editor.OverviewRulerLane.Full } }
      : { isWholeLine: true, className: 'scr-pc-line', glyphMarginClassName: 'scr-pc-glyph' } }]);
  });
  // starting and stopping change the editor's size: laid out again once drawn (or the line numbers stay a line off)
  useEffect(() => { const e = ed.current; if (!e) return; const id = requestAnimationFrame(() => e.layout()); return () => cancelAnimationFrame(id); }, [!!dbg, state, ui.outFolded, c64.open]); // eslint-disable-line react-hooks/exhaustive-deps
  // the keys outside the editor: F5 runs, Ctrl+Shift+B builds, F8 / F6 / Shift+F6 step, Ctrl+S writes; the tabs'
  // Ctrl+Tab (Ctrl+PageDown), Ctrl+Shift+Tab (Ctrl+PageUp) and Ctrl+F4 also in the list and the output
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.('.monaco-editor, textarea')) return;
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && !e.altKey && (e.key === 'Tab' || e.key === 'PageDown' || e.key === 'PageUp')) { e.preventDefault(); keys.current.tab(e.key === 'PageUp' || (e.key === 'Tab' && e.shiftKey) ? -1 : 1); return; }
      if (ctrl && !e.altKey && !e.shiftKey && e.key === 'F4') { e.preventDefault(); keys.current.closeTab(); return; }
      if ((e.target as HTMLElement | null)?.closest?.('input, select')) return;
      if (e.key === 'F5' && !e.ctrlKey && !e.altKey) { e.preventDefault(); keys.current.run(); }
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
  const shownText = !!shown && shown in texts;
  const shownEntry = shown ? entryOf.get(shown) : undefined;
  const errors = check?.problems ?? [];
  const first = errors[0];
  const chip = !check ? (main ? 'Checking…' : 'No source') : check.ok
    ? `Ready · ${plural(check.bytes, 'byte')}${check.entry != null ? `, starts at $${h4(check.entry)}` : ''}`
    : `${errors.length > 1 ? `${plural(errors.length, 'problem')} · ` : ''}${first.file !== shown ? `${first.file} ` : ''}${first.line ? `line ${first.line}: ` : ''}${first.msg}`;
  const names = useMemo(() => (dbg ? dbg.c.check.labels : check?.check.labels) ?? new Map<Addr, string>(), [dbg, check]);
  const listW = ui.listW;
  return (
    <div className="scripts asm-ws">
      {ui.listFolded
        ? <div className="scr-list folded" role="navigation" aria-label="Files, folded in">
          <button className="icon-btn" onClick={() => void leave('start')} aria-label="Start" title="Back to the start screen (what is not written yet is written first)"><Icon name="left" size={15} /></button>
          <button className="icon-btn" onClick={() => ui.set({ listFolded: false })} aria-label="Unfold the file list" title="Unfold the list of the folder's files"><Icon name="side-show" size={16} /></button>
          <button className="icon-btn" onClick={() => newIn(shown ? parentOf(shown) : '', 'file')} aria-label="New file" title="New file"><Icon name="plus" size={15} /></button>
        </div>
        : <div className="scr-list asm-list" style={{ width: listW }}>
          <div className="asm-top">
            <button className="icon-btn" onClick={() => void leave('start')} aria-label="Start" title="Back to the start screen (what is not written yet is written first)"><Icon name="left" size={15} /></button>
            <span className="asm-folder" title={dir}><Icon name="folder" size={13} />{folder.name}</span>
            <button className="icon-btn" aria-label="The folder" title="Open another folder, close this one, show it in the file manager" onClick={e => { const r = e.currentTarget.getBoundingClientRect(); folderMenu(r.left, r.bottom + 2); }}><Icon name="more" size={15} /></button>
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
          {shown ? <FileNameField key={shown} path={shown} dirty={dirty.has(shown)} onRename={n => void named(n, { kind: 'rename', path: shown })} /> : <span className="muted small">No file open</span>}
          {check && <span className={cx('pill scr-check', check.ok ? 'hi' : 'lo')} role="status" onClick={() => { if (first?.file && first.line) openFile(first.file, { line: first.line }); }}
            title={[...errors.map(p => `${p.file}${p.line ? ` line ${p.line}` : ''}: ${p.msg}`), check.ok ? `Mimir's own assembler assembles the program: ${check.ranges.slice(0, 4).map(r => `$${h4(r.start)}-$${h4(r.end - 1)}`).join(', ')}${check.entry != null ? `; a run starts at $${h4(check.entry)}` : ''}.` : 'What Mimir\'s own assembler finds as you type. It knows most of Kick Assembler and 64tass, not all: Run builds with the real one all the same.'].join('\n')}>
            <Icon name={check.ok ? 'check' : 'err'} size={12} />{chip}</span>}
          <button className="pill scr-lang asm-lang" aria-label="Language" onClick={() => ui.setLang(dir, lang === '64tass' ? 'kickass' : '64tass')}
            title={`The folder's sources are ${LANG_TITLE[lang]}'s${ui.langs[dir] ? ' (you chose it)' : ' (the main file looks written for it)'}: checked as that and built with ${tool}. A click makes them ${lang === '64tass' ? 'Kick Assembler' : '64tass'}`}>{LANG_TITLE[lang]}</button>
          {main && shown !== main && <button className="pill asm-main-pill" onClick={() => openFile(main)} title={`The main file, which Run and Build build: ${main}. A click opens it (right-click a source in the list to make it the main file)`}>
            <Icon name="play" size={10} />{baseName(main)}</button>}
          <span className="grow" />
          <button className="btn scr-screen-btn" aria-pressed={c64.open} onClick={() => setC64({ open: !c64.open })}
            title={c64.open ? 'Close the C64 screen beside the code' : 'Open a C64 screen beside the code: what the program prints and writes to the screen while it is debugged in Mimir'}>
            <Icon name="screen" size={14} /><span className="lbl">C64 screen</span></button>
          <span className="tb-sep" />
          {dbg ? <div className="scr-dbg-tools" role="group" aria-label="Debugging">
            {dbgBusy
              ? <button className="btn" onClick={() => { pauseReq.current = true; }} title="Stop where it is now, and go on debugging from there">Pause</button>
              : <button className="btn primary" onClick={contDbg} title="Go on to the end of the run, or to the next breakpoint (Ctrl+Enter)"><Icon name="play" />Continue<kbd>Ctrl+Enter</kbd></button>}
            <button className="btn" disabled={dbgBusy} onClick={stepDbg} title="Run the next instruction; into a JSR (F8)">Step<kbd>F8</kbd></button>
            <button className="btn" disabled={dbgBusy} onClick={overDbg} title="Run the next instruction; a JSR runs until it returns (F6)">Over<kbd>F6</kbd></button>
            <button className="btn" disabled={dbgBusy} onClick={outDbg} title="Run until the routine it is in returns (Shift+F6)">Out<kbd>Shift+F6</kbd></button>
            <button className="btn" onClick={() => stopDbg()} title="Stop debugging where it is"><Icon name="x" />Stop</button>
          </div> : <>
            <button className="btn primary scr-run asm-run" disabled={!main || !!build?.running} onClick={() => void run()}
              title={main ? `Build ${main} with ${tool} and start it in VICE (Ctrl+Enter or F5); what is not written yet is written first` : 'There is no source to run'}>
              <Icon name="play" />{build?.running ? 'Building…' : 'Run'}<kbd>Ctrl+Enter</kbd></button>
            <button className="btn asm-build" disabled={!main || !!build?.running} onClick={() => void doBuild(false)} title={main ? `Build ${main} with ${tool}, without starting it (Ctrl+Shift+B): the PRG goes in out\\ beside it` : 'There is no source to build'}>Build</button>
            <button className="btn scr-debug-btn" disabled={!check?.ok} onClick={startDebug}
              title={check?.ok ? 'Debug: start the program in Mimir\'s 6510 and stop before its first instruction, then go an instruction at a time (F8), over a JSR (F6) or on to a breakpoint (click left of a line number). Mimir\'s 6510 has no ROMs or I/O: the KERNAL\'s printing routines are done on the C64 screen, the rest runs in VICE' : 'The program must assemble in Mimir before it can be debugged: see the problems'}>Debug<kbd>F8</kbd></button>
          </>}
        </div>
        {dbg && <p className="scr-howto scr-dbg-note" role="note"><Icon name="info" size={13} /><span>Debugging in Mimir's 6510: the code cannot be changed until you stop. A click left of a line number sets a breakpoint. It has no ROMs or I/O: the KERNAL's printing routines are done on the C64 screen.</span></p>}
        <div className="scr-body">
          <TabRow open={tabs.open} preview={tabs.preview} shown={shown} main={main} dirty={dirty} problems={problemsOf}
            onShow={p => setShown(p)} onKeep={p => placeTab(p, true)} onClose={closeTabs} onMove={moveTab} onMenu={tabMenu} />
          <div className="scr-edit-row" ref={editRow}>
            <div className="mon-host scr-editor" ref={host} aria-label="Code" style={{ display: state === 'ready' && shownText ? 'block' : 'none' }} />
            {state === 'fallback' && shownText && <textarea className="fallback-code scr-fallback" aria-label="Code" value={texts[shown!]} readOnly={!!dbg} onChange={e => { const p = shown!; setTexts(t => ({ ...t, [p]: e.target.value })); schedule(p); }} />}
            {shown && !shownText && <div className="asm-binary" role="note">
              <Icon name={shownEntry?.dir ? 'folder' : fileIcon(shown)} size={28} />
              <h3>{baseName(shown)}</h3>
              <p className="muted">{shownEntry ? `${fmtBytes(shownEntry.size)}: not a text file the editor opens.` : 'The file is not there any more.'} A source loads it with <span className="mono">{lang === '64tass' ? '.binary' : '.import binary'}</span>{lang === '64tass' ? '' : ' or LoadSid'}.</p>
              <button className="btn small" onClick={() => void kr?.assemblerReveal({ dir, path: shown })}><Icon name="folder" size={13} />Show in folder</button>
            </div>}
            {!shown && loaded && <div className="asm-binary" role="note"><Icon name="code" size={28} /><h3>No file open</h3><p className="muted">Click a file in the list to open it (a double-click keeps its tab open), or + to make a source.</p></div>}
            {dbg && <DebugPanel m={dbg.m} prev={dbg.prev} names={names} busy={dbgBusy} atBp={atBp} lineOf={a => lineText(dbg.c, a)} />}
            {c64.open && <>
              <Splitter dir="v" onDrag={d => {
                const rowW = editRow.current?.offsetWidth ?? 1200, other = (dbg ? 300 : 0) + 200;
                setC64({ width: Math.max(240, Math.min(rowW - other, useScripts.getState().c64.width - d)) });
              }} />
              <div className="scr-screen-col" style={{ width: c64.width }}>
                <ScriptScreenPanel screen={dbg ? dbg.m.screen.state() : kept?.run.screen ?? null} live={!!dbg} extended={c64.extended} zoom={c64.zoom} mag={c64.mag} size={c64.size}
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
            onTab={t => ui.set({ outTab: t })} onFold={v => ui.set({ outFolded: v })} onGo={(f, l) => { if (paths.has(f)) openFile(f, { line: l || 1 }); }} onScreen={() => setC64({ open: true })} />
        </div>
      </div>
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
