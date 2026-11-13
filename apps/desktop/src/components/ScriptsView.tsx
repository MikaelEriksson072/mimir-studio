/* The Scripts tab (spec 10.3): the project's scripts, Kick Assembler code that runs in Mimir on the program's bytes.
 * The code is written in Monaco with the Kick Assembler highlighting; it is checked as it is typed (assembled with
 * the program's names and the scratchpads at hand) and runs only when it checks out. What a run changes in the
 * program's bytes goes into the program as the script's patches (the listing, the source, the export and Build & Run
 * have the new bytes; the script's code is never in them); its scratchpads keep data outside the program, which can
 * be saved as a file. The library keeps scripts for every project. */
import { useEffect, useMemo, useRef, useState } from 'react';
import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api';
import { checkScript, SCRIPT_TEMPLATES, type ScriptTemplate, h4, rangeText, scriptEndText, ScriptMachine, scriptNames, scriptPatches, scriptPlace, scriptStartMemory, scriptWatches, userWatches, watchEntryKey, watchView, withAddressNames, type Addr, type Patch, type ScriptCheck, type ScriptEnv, type ScriptLink, type ScriptMemory, type ScriptRun, type ScriptWatchEntry, type UserScript, type WatchSpot } from '@mimir/core';
import type { MenuItem } from '../lib/types';
import { Icon } from '../lib/icons';
import { cx } from '../lib/util';
import { stopScript } from '../lib/scriptrun';
import { initValue } from '../lib/scriptinit';
import { useScripts, type LibraryScript } from '../store/scripts';
import { Splitter } from './Splitter';
import { DebugPanel, regsOf, type DebugRegs } from './ScriptDebug';
import { WatchSection, WatchTable, type WatchItem, type WatchKind, type WatchMode } from './ScriptWatch';
import { ScriptOutput, type BlockChoice, type LivePad } from './ScriptOutput';

/** a script being debugged: its machine, the code it was assembled from, the registers and its scratchpads' bytes
 *  before the last step (what the step changed is marked) */
interface Debugging { id: string; m: ScriptMachine; source: string; prev: DebugRegs | null; padsBefore: Uint8Array[] | null;
  /** memory as the run started (the watch list's changes are against it) and before the last step (what it changed) */
  start: ScriptMemory; before: Pick<ScriptMemory, 'mem' | 'own'> | null }
/** instructions the debugger runs before it lets the window draw (Continue, Step over and Step out go on in parts) */
const DEBUG_SLICE = 400_000;

type MonacoNs = typeof Monaco;

export interface ScriptsViewProps {
  scripts: readonly UserScript[];
  /** what the scripts are checked with (the program's names, its loaded bytes) */
  env: ScriptEnv;
  /** what a script runs on: the program without what its earlier runs changed */
  envFor: (id: string) => ScriptEnv;
  /** the project's patches: a script's changes to the program are among them */
  patches: readonly Patch[];
  theme: string;
  /** the name a script's code writes for a linked address (a label, `table+5`, a variable, a register or the address) */
  linkOf: (a: Addr) => ScriptLink;
  /** what kind of block each of the program's labels is on (the suggestions say it) */
  kinds: ReadonlyMap<string, string>;
  onNew: () => void;
  /** a copy of a library script in the project */
  onAdd: (s: LibraryScript) => void;
  /** a copy of a template in the project (its scratchpads placed where there is room) */
  onAddTemplate: (t: ScriptTemplate) => void;
  onEdit: (id: string, change: Partial<Pick<UserScript, 'name' | 'source' | 'pads' | 'links' | 'init' | 'watch' | 'unwatch'>>, label: string) => void;
  onRemove: (id: string) => void;
  /** Run: the script with this code, in its worker; its changes go into the program, unless it is in safe mode (App
   *  runUserScript) */
  onRun: (id: string, text: string) => Promise<void>;
  /** Write into the program: a run whose changes go into the program also in safe mode */
  onWrite: (id: string, text: string) => Promise<void>;
  /** safe mode on or off: on, a run writes nothing into the program and shows what it would change */
  onSafe: (id: string, on: boolean) => void;
  /** a run that ended here (debugging to its end): its changes go into the program, the run is kept and said */
  onFinish: (id: string, run: ScriptRun, text: string) => void;
  /** the script's changes taken out of the program */
  onTakeOut: (id: string) => void;
  onSwitchPatch: (p: Patch, on: boolean) => void;
  onShow: (start: Addr, end: Addr) => void;
  onCopy: (text: string, what?: string) => void;
  onSave: (name: string, bytes: Uint8Array, prg: boolean, load: Addr) => void;
  onSaveText: (name: string, text: string) => void;
  toast: (msg: string, kind: 'ok' | 'info' | 'warn' | 'err') => void;
  /** a menu of the app's at a point of the window (Copy to… of a scratchpad) */
  onMenu: (x: number, y: number, items: MenuItem[]) => void;
  /** the program's blocks a scratchpad can be filled from, and the one at the listing's cursor */
  blocks: readonly BlockChoice[];
  cursorBlock: Addr | null;
  /** a block copied into a scratchpad of the script (its index; null: a new one), written as its type is */
  onCopyBlock: (start: Addr, id: string, pad: number | null) => void;
}

const $ = (a: number) => '$' + h4(a);
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

export function ScriptsView({ scripts, env, envFor, patches, theme, linkOf, kinds, onNew, onAdd, onAddTemplate, onEdit, onRemove, onRun, onWrite, onSafe, onFinish, onTakeOut, onSwitchPatch, onShow, onCopy, onSave, onSaveText, toast, onMenu, blocks, cursorBlock, onCopyBlock }: ScriptsViewProps) {
  const { selected, runs, running, pad, outH, dbgOutH, outFolded, library, gotoLine, set, saveToLibrary, removeFromLibrary, listFolded, setListFolded, templatesFolded, setTemplatesFolded } = useScripts();
  const cur = scripts.find(s => s.id === selected) ?? scripts[0] ?? null;
  const host = useRef<HTMLDivElement>(null);
  const monacoRef = useRef<MonacoNs | null>(null);
  const ed = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const models = useRef<Record<string, Monaco.editor.ITextModel>>({});
  const [state, setState] = useState<'loading' | 'ready' | 'fallback'>('loading');
  // the code as typed (it goes into the project a moment after the last key): what is checked and run
  const [live, setLive] = useState<Record<string, string>>({});
  const pending = useRef<{ id: string; timer: ReturnType<typeof setTimeout> } | null>(null);
  const applying = useRef(false);
  const curRef = useRef(cur); curRef.current = cur;
  const scriptsRef = useRef(scripts); scriptsRef.current = scripts;
  const onEditRef = useRef(onEdit); onEditRef.current = onEdit;
  const runRef = useRef<() => void>(() => { });
  // the debugger: the run going an instruction at a time, a counter that draws it again, whether it is going on
  const [dbg, setDbg] = useState<Debugging | null>(null);
  const [, setTick] = useState(0);
  const [dbgBusy, setDbgBusy] = useState(false);
  const pauseReq = useRef(false);
  const dbgRef = useRef(dbg); dbgRef.current = dbg;
  /** what the editor's keys and the gutter do (the editor is made once; these change every render) */
  const keys = useRef({ step: () => { }, over: () => { }, out: () => { }, cont: () => { }, toggleBp: (_line: number) => { } });
  /** the breakpoints of each model, as decorations (they move with the lines as the code is edited) */
  const bpIds = useRef<Record<string, string[]>>({});

  const flush = () => {
    const p = pending.current; if (!p) return;
    clearTimeout(p.timer); pending.current = null;
    const m = models.current[p.id], s = scriptsRef.current.find(x => x.id === p.id);
    if (m && s && m.getValue() !== s.source) onEditRef.current(p.id, { source: m.getValue() }, `Edit script "${s.name}"`);
  };

  // the editor, once there is a script to show (without one the tab shows how to make one, and no editor)
  const any = scripts.length > 0;
  useEffect(() => {
    if (!any) return;
    let alive = true;
    setState('loading');
    import('../monaco/setup').then(async ({ monaco }) => {
      if (!alive || !host.current) return;
      const { applyMonacoTheme } = await import('../monaco/theme');
      monacoRef.current = monaco;
      applyMonacoTheme(monaco, document.documentElement.dataset.theme !== 'light');
      const editor = monaco.editor.create(host.current, {
        value: '', language: 'kickass', theme: 'mimir', automaticLayout: true, fontFamily: "'JetBrains Mono', ui-monospace, Consolas, monospace",
        fontSize: 13, lineHeight: 20, minimap: { enabled: false }, scrollBeyondLastLine: false, renderLineHighlight: 'all',
        smoothScrolling: true, padding: { top: 8 }, guides: { indentation: false }, stickyScroll: { enabled: false }, mouseWheelZoom: true,
        tabSize: 8, insertSpaces: true, quickSuggestions: { other: true, comments: false, strings: false }, wordBasedSuggestions: 'off', acceptSuggestionOnEnter: 'off', tabCompletion: 'off', suggestOnTriggerCharacters: true,
        glyphMargin: true,
      });
      ed.current = editor;
      editor.onDidChangeModelContent(() => {
        const s = curRef.current, m = editor.getModel();
        if (applying.current || !s || !m) return;
        const text = m.getValue();
        setLive(l => ({ ...l, [s.id]: text }));
        if (pending.current && pending.current.id !== s.id) flush();
        if (pending.current) clearTimeout(pending.current.timer);
        pending.current = { id: s.id, timer: setTimeout(flush, 500) };
      });
      // Ctrl+Enter runs, or (debugging) goes on; F8 steps (and starts debugging), F6 steps over a JSR, Shift+F6 out of one
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => { editor.trigger('run', 'hideSuggestWidget', null); if (dbgRef.current) keys.current.cont(); else runRef.current(); });
      editor.addCommand(monaco.KeyCode.F8, () => keys.current.step());
      editor.addCommand(monaco.KeyCode.F6, () => keys.current.over());
      editor.addCommand(monaco.KeyMod.Shift | monaco.KeyCode.F6, () => keys.current.out());
      // a click in the gutter left of the line numbers sets or clears a breakpoint
      editor.onMouseDown(ev => {
        if (ev.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN && ev.target.position) keys.current.toggleBp(ev.target.position.lineNumber);
      });
      if (document.fonts?.ready) void document.fonts.ready.then(() => monaco.editor.remeasureFonts());
      setState('ready');
    }).catch(() => { if (alive) setState('fallback'); });
    return () => {
      alive = false; flush();
      // the breakpoints where their lines are now, for the next time the tab opens
      for (const [id, m] of Object.entries(models.current)) useScripts.getState().setBps(id, (bpIds.current[id] ?? []).map(d => m.getDecorationRange(d)?.startLineNumber).filter((n): n is number => !!n));
      bpIds.current = {};
      ed.current?.dispose(); ed.current = null; pcDeco.current = null; Object.values(models.current).forEach(m => m.dispose()); models.current = {};
    };
  }, [any]); // eslint-disable-line react-hooks/exhaustive-deps

  // the debugger's line: the script's line the program counter is at, or the line whose JSR the program's code runs for
  const pcDeco = useRef<Monaco.editor.IEditorDecorationsCollection | null>(null);
  useEffect(() => {
    const monaco = monacoRef.current, e = ed.current;
    if (state !== 'ready' || !monaco || !e) return;
    if (!pcDeco.current) pcDeco.current = e.createDecorationsCollection();
    const d = dbg && !dbgBusy ? dbg.m : null;
    const line = d?.lineAt() ?? null, call = d && !line ? d.callLine() : null;
    if (!d || (!line && !call)) { pcDeco.current.clear(); return; }
    // stopped on a breakpoint's line: marked so it cannot be missed (a red band and bar, the arrow on the red dot)
    if (line && atBp) {
      pcDeco.current.set([{ range: new monaco.Range(line, 1, line, 1), options: { isWholeLine: true, className: 'scr-pc-line scr-pc-bp', linesDecorationsClassName: 'scr-pc-bp-bar', glyphMarginClassName: 'scr-pc-bp-glyph', glyphMarginHoverMessage: { value: `Stopped at the breakpoint on line ${line}: it runs next` }, overviewRuler: { color: '#ff5a6e', position: monaco.editor.OverviewRulerLane.Full } } }]);
      return;
    }
    pcDeco.current.set([{ range: new monaco.Range(line ?? call!, 1, line ?? call!, 1), options: { isWholeLine: true, className: line ? 'scr-pc-line' : 'scr-call-line', glyphMarginClassName: line ? 'scr-pc-glyph' : 'scr-call-glyph' } }]);
  });
  // the code cannot change while it is being debugged
  useEffect(() => { ed.current?.updateOptions({ readOnly: !!dbg }); }, [dbg, state]);
  // starting and stopping change the editor's size at once (the note above it, the panel beside it, the output below
  // it), and so does the note going after the first run: laid out again once they are drawn, or the line numbers stay a line off the lines; then the line is shown
  const debugging = !!dbg, noteShown = !!cur && !runs[cur.id] && !patches.some(p => p.script === cur.id);
  useEffect(() => {
    const e = ed.current; if (!e) return;
    const id = requestAnimationFrame(() => {
      e.layout();
      const d = dbgRef.current, line = d ? d.m.lineAt() ?? d.m.callLine() : null;
      if (line) e.revealLineInCenterIfOutsideViewport(line);
    });
    return () => cancelAnimationFrame(id);
  }, [debugging, noteShown, state, outFolded]);
  // another script shown, or the tab left: the debugging stops
  useEffect(() => { if (dbgRef.current && dbgRef.current.id !== cur?.id) stopDbg(true); }, [cur?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { pauseReq.current = true; }, []);
  // F8, F6 and Shift+F6 outside the editor too (in it, its commands take them)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.('.monaco-editor, input, textarea, select') || e.ctrlKey || e.altKey || e.metaKey) return;
      if (e.key === 'F8') { e.preventDefault(); keys.current.step(); }
      else if (e.key === 'F6') { e.preventDefault(); if (e.shiftKey) keys.current.out(); else keys.current.over(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const monaco = monacoRef.current;
    if (state === 'ready' && monaco) void import('../monaco/theme').then(({ applyMonacoTheme }) => applyMonacoTheme(monaco, theme !== 'light'));
  }, [theme, state]);

  // the script shown in the editor; a change from outside (undo) replaces the text that is not being typed
  useEffect(() => {
    const monaco = monacoRef.current, e = ed.current;
    if (state !== 'ready' || !monaco || !e) return;
    for (const id of Object.keys(models.current)) if (!scripts.some(s => s.id === id)) { models.current[id].dispose(); delete models.current[id]; }
    if (!cur) { e.setModel(null); return; }
    if (pending.current && pending.current.id !== cur.id) flush();
    let m = models.current[cur.id];
    if (!m) {
      m = monaco.editor.createModel(cur.source, 'kickass', monaco.Uri.parse(`script:///${cur.id}.asm`)); models.current[cur.id] = m;
      // the breakpoints it had when the tab was last open
      bpIds.current[cur.id] = []; setBps(cur.id, useScripts.getState().bps[cur.id] ?? []);
    }
    else if (m.getValue() !== cur.source && pending.current?.id !== cur.id) {
      const vs = e.getModel() === m ? e.saveViewState() : null; applying.current = true; m.setValue(cur.source); applying.current = false; if (vs) e.restoreViewState(vs);
      setLive(l => { const { [cur.id]: _, ...rest } = l; return rest; });
    }
    if (e.getModel() !== m) e.setModel(m);
  }, [state, cur?.id, cur?.source, scripts]); // eslint-disable-line react-hooks/exhaustive-deps

  const source = cur ? live[cur.id] ?? cur.source : '';
  const check: ScriptCheck | null = useMemo(() => cur ? checkScript(env, { source, pads: cur.pads, init: cur.init }) : null, [env, source, cur?.pads, cur?.init]); // eslint-disable-line react-hooks/exhaustive-deps
  const names = useMemo(() => cur ? scriptNames(env, cur.pads) : new Map<string, number>(), [env, cur?.pads]); // eslint-disable-line react-hooks/exhaustive-deps
  /** a name for an address (the first of the names the script may use that has it) */
  const byAddr = useMemo(() => { const m = new Map<number, string>(); for (const [n, a] of names) if (!m.has(a)) m.set(a, n); return m; }, [names]);
  /** the script's links (UserScript.links), by the names its code writes for them */
  const links = useMemo(() => (cur?.links ?? []).map(linkOf), [cur?.links, linkOf]);
  const linkNames = useMemo(() => new Set(links.map(k => k.name)), [links]);
  // the watch list (spec 10.3): what the code writes, found in it (debugging: in the code that runs), and what the user
  // added, read as a run starts (from the program without the script's earlier changes), as the last run left it, or now
  const runEnv = useMemo(() => (cur ? envFor(cur.id) : null), [cur?.id, env, patches]); // eslint-disable-line react-hooks/exhaustive-deps
  const startMem = useMemo(() => (cur && check && runEnv ? scriptStartMemory(runEnv, cur, check) : null), [runEnv, check, cur?.pads, cur?.init]); // eslint-disable-line react-hooks/exhaustive-deps
  const wCheck = dbg ? dbg.m.check : check, wSource = dbg ? dbg.source : source;
  const autoSpots = useMemo(() => (cur && wCheck ? scriptWatches(wCheck, wSource, cur.pads) : []), [wCheck, wSource, cur?.pads]); // eslint-disable-line react-hooks/exhaustive-deps
  /** the names an added spot can be written with: the program's, the hardware's, the scratchpads' and the script's own labels */
  const watchNames = useMemo(() => { const m = new Map(names); for (const [a, n] of wCheck?.labels ?? []) m.set(n, a); return m; }, [names, wCheck]);
  /** an address or a name typed for the watch list: a name Mimir gave (`colors_0939`) also when the analysis has named
   *  its bytes anew since (`tbl_0939`), as the code's names are (withAddressNames) */
  const watchAt = (e: string) => initValue(e, watchNames) ?? initValue(e, withAddressNames(new Map(watchNames), e));
  const userSpots = useMemo(() => (cur && wCheck ? userWatches(cur.watch ?? [], watchAt, wCheck, cur.pads) : []), [cur?.watch, watchNames, wCheck, cur?.pads]); // eslint-disable-line react-hooks/exhaustive-deps
  // the names the editor completes and the hovers show, for this script: its links first
  useEffect(() => {
    void import('../monaco/providers').then(({ scriptContext }) => { scriptContext.names = names; scriptContext.pads = cur?.pads ?? []; scriptContext.links = linkNames; scriptContext.kinds = kinds; });
  }, [names, cur?.pads, linkNames, kinds]);

  // the check's problems as markers on their lines
  useEffect(() => {
    const monaco = monacoRef.current;
    if (state !== 'ready' || !monaco || !cur || !check) return;
    const m = models.current[cur.id]; if (!m) return;
    monaco.editor.setModelMarkers(m, 'script', check.problems.filter(p => p.line && p.line <= m.getLineCount()).map(p => ({
      severity: p.level === 'error' ? monaco.MarkerSeverity.Error : monaco.MarkerSeverity.Warning,
      message: p.msg, startLineNumber: p.line!, startColumn: 1, endLineNumber: p.line!, endColumn: m.getLineMaxColumn(p.line!),
    })));
  }, [check, state, cur?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const goLine = (n: number) => { const e = ed.current; if (!e) return; e.revealLineInCenter(n); e.setPosition({ lineNumber: n, column: 1 }); e.focus(); };
  // a line asked for from outside (a script's mark in the listing): shown once the script is in the editor
  useEffect(() => {
    const e = ed.current, m = cur ? models.current[cur.id] : null;
    if (gotoLine == null || state !== 'ready' || !e || !m || e.getModel() !== m) return;
    set({ gotoLine: null });
    const n = Math.min(gotoLine, m.getLineCount());
    requestAnimationFrame(() => { e.revealLineInCenter(n); e.setSelection({ startLineNumber: n, startColumn: 1, endLineNumber: n, endColumn: m.getLineMaxColumn(n) }); e.focus(); });
  });

  /** a link's name written in the code where the cursor is (in place of what is selected) */
  const insertLink = (name: string) => {
    const e = ed.current, monaco = monacoRef.current, s = curRef.current;
    if (!s || dbgRef.current) return;
    if (!e || !monaco) { const t = (live[s.id] ?? s.source) + name; setLive(l => ({ ...l, [s.id]: t })); onEdit(s.id, { source: t }, `Edit script "${s.name}"`); return; }
    const sel = e.getSelection() ?? new monaco.Selection(1, 1, 1, 1);
    const end = sel.getStartPosition().delta(0, name.length);
    e.executeEdits('link', [{ range: sel, text: name, forceMoveMarkers: true }], [new monaco.Selection(end.lineNumber, end.column, end.lineNumber, end.column)]);
    e.pushUndoStop(); e.focus();
  };

  /** Run: the code as the editor has it, in the worker (App's runUserScript, the same as Run in the Scripts view of the side panel) */
  const run = () => {
    const s = curRef.current; if (!s || running) return;
    flush();
    void onRun(s.id, models.current[s.id]?.getValue() ?? s.source);
  };
  runRef.current = run;
  /** Write into the program (safe mode): the script runs once more, and this time what it changes goes into the program */
  const write = () => {
    const s = curRef.current; if (!s || running || dbgRef.current) return;
    flush();
    void onWrite(s.id, models.current[s.id]?.getValue() ?? s.source);
  };

  /* ---- the debugger (spec 10.3): the run an instruction at a time, on the program as Run has it ---- */
  /** the breakpoints of a script: the lines of its model's breakpoint decorations (they move as lines are edited) */
  const bpLines = (id: string): number[] => {
    const m = models.current[id];
    if (!m) return useScripts.getState().bps[id] ?? [];
    return (bpIds.current[id] ?? []).map(d => m.getDecorationRange(d)?.startLineNumber).filter((n): n is number => !!n);
  };
  const setBps = (id: string, lines: number[]) => {
    const monaco = monacoRef.current, m = models.current[id];
    if (!monaco || !m) return;
    const at = [...new Set(lines)].filter(l => l >= 1 && l <= m.getLineCount()).sort((a, b) => a - b);
    bpIds.current[id] = m.deltaDecorations(bpIds.current[id] ?? [], at.map(l => ({
      range: new monaco.Range(l, 1, l, 1),
      options: { glyphMarginClassName: 'scr-bp', glyphMarginHoverMessage: { value: 'Breakpoint: debugging stops before this line runs (a click takes it away)' }, stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges },
    })));
    useScripts.getState().setBps(id, at);
  };
  const toggleBp = (line: number) => {
    const s = curRef.current; if (!s) return;
    const now = bpLines(s.id);
    setBps(s.id, now.includes(line) ? now.filter(l => l !== line) : [...now, line]);
    setTick(t => t + 1);
  };
  /** the breakpoint's line the debugger stopped on (it runs next), else null */
  const dbgLine = dbg && !dbgBusy ? dbg.m.lineAt() : null;
  const atBp = dbg && dbgLine != null && bpLines(dbg.id).includes(dbgLine) ? dbgLine : null;
  const busyRef = useRef(false);
  /** the registers and the scratchpads before a step (the panel and the scratchpad mark what it changed) */
  const keepBefore = (d: Debugging) => { d.prev = regsOf(d.m); d.padsBefore = d.m.script.pads.map(p => d.m.own.slice(p.start, p.start + p.size)); d.before = { mem: d.m.mem.slice(), own: d.m.own.slice() }; };
  /** the debugger stopped somewhere: drawn there, and the line shown; at the end of the run, it is a run */
  const stopped = (d: Debugging) => {
    if (dbgRef.current !== d) return;
    if (d.m.end) {
      setDbg(null); dbgRef.current = null;
      onFinish(d.id, d.m.result(), d.source);
      return;
    }
    setTick(t => t + 1);
    const line = d.m.lineAt() ?? d.m.callLine();
    if (line) ed.current?.revealLineInCenterIfOutsideViewport(line);
  };
  /** start debugging: the run set up, stopped before its first instruction */
  const startDebug = () => {
    const s = curRef.current; if (!s || running || dbgRef.current) return;
    flush();
    const text = models.current[s.id]?.getValue() ?? s.source;
    const e = envFor(s.id), c = checkScript(e, { source: text, pads: s.pads, init: s.init });
    if (!c.ok) { toast(`The script does not check out: ${c.problems.find(p => p.level === 'error')?.msg}`, 'warn'); return; }
    const d: Debugging = { id: s.id, m: new ScriptMachine(e, { source: text, pads: s.pads, init: s.init }, c), source: text, prev: null, padsBefore: null, start: scriptStartMemory(e, s, c), before: null };
    setDbg(d); dbgRef.current = d;
    stopped(d);
  };
  /** go on until `stop` holds, a breakpoint's line is next, or the run ends; in parts, so the window keeps drawing */
  const go = (stop: ((m: ScriptMachine) => boolean) | null, keepPrev = false) => {
    const d = dbgRef.current; if (!d || busyRef.current) return;
    const lines = new Set(bpLines(d.id)), { starts, lines: lineOf } = d.m.check;
    const at = (m: ScriptMachine) => (stop ? stop(m) : false) || (lines.size > 0 && m.inScript && starts[m.cpu.pc] === 1 && lines.has(lineOf[m.cpu.pc]));
    if (!keepPrev) keepBefore(d);
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
    keepBefore(d); d.m.step(); stopped(d);
  };
  /** a JSR runs until it returns (to the instruction after it, the stack as it was); anything else is a step */
  const overDbg = () => {
    const d = dbgRef.current; if (!d) { startDebug(); return; }
    if (busyRef.current) return;
    const m = d.m;
    if (m.peek(m.cpu.pc) !== 0x20) { stepDbg(); return; }
    const s0 = m.cpu.s, back = (m.cpu.pc + 3) & 0xffff;
    keepBefore(d); m.step();
    if (m.end || (m.cpu.s === s0 && m.cpu.pc === back)) { stopped(d); return; }
    go(x => x.cpu.s === s0 && x.cpu.pc === back, true);
  };
  /** on until an RTS goes back past where the stack is now: out of the routine (at the top, to the end of the run) */
  const outDbg = () => {
    const d = dbgRef.current; if (!d || busyRef.current) return;
    const s0 = d.m.cpu.s;
    go(x => x.cpu.lastOp === 0x60 && x.cpu.s > s0);
  };
  const contDbg = () => { if (!dbgRef.current) startDebug(); else go(null); };
  /** stop debugging where it is: nothing goes into the program */
  const stopDbg = (quiet = false) => {
    pauseReq.current = true;
    if (!dbgRef.current) return;
    setDbg(null); dbgRef.current = null; busyRef.current = false; setDbgBusy(false);
    if (!quiet) toast(curRef.current?.safe ? 'Debugging stopped (safe mode: nothing goes into the program in any case)' : 'Debugging stopped: nothing went into the program (Run, or debugging to the end, writes the changes)', 'info');
  };
  keys.current = { step: stepDbg, over: overDbg, out: outDbg, cont: contDbg, toggleBp };

  // the library, and below it the templates Mimir comes with
  const libraryList = <>
    <LibraryList library={library} onAdd={onAdd} onRemove={name => { removeFromLibrary(name); toast(`"${name}" removed from the library`, 'ok'); }} />
    <TemplateList folded={templatesFolded} onFold={setTemplatesFolded} onAdd={onAddTemplate} />
  </>;

  if (!scripts.length) return (
    <div className="scripts">
      <div className="scr-list">{libraryList}</div>
      <div className="empty-project scripts-empty">
        <Icon name="prompt" size={30} />
        <h2>No scripts yet</h2>
        <p>A script is Kick Assembler code that runs here in Mimir on the program's bytes. Use the program's labels, variables and tables in it, call its routines or paste its code (a decryption loop, say): what it changes in the program's bytes goes into the program and the source, while the script's own code stays out of the export and Build &amp; Run.</p>
        <div className="empty-actions"><button className="btn primary" onClick={onNew}><Icon name="plus" size={14} />New script</button></div>
        <p className="muted small">Or select lines in the listing, right-click and pick <b>Program → New script from selection</b>, or add one from the library, or start from a template (a decryption: XOR with a key, a chain, add, several steps).</p>
      </div>
    </div>
  );

  const kept = cur ? runs[cur.id] : undefined;
  const isRunning = !!cur && running === cur.id;
  const mine = cur ? scriptPatches(patches, cur.id) : [];
  const errors = check?.problems.filter(p => p.level === 'error') ?? [], warnings = check?.problems.filter(p => p.level === 'warning') ?? [];
  // the status says only whether it can run, and what is wrong; where its code is goes in the tooltip
  const chip = !check ? '' : check.ok
    ? `Ready to run${warnings.length ? ` · ${plural(warnings.length, 'warning')}` : ''}`
    : `${errors.length > 1 ? `${plural(errors.length, 'error')} · ` : ''}${errors[0]?.line ? `Line ${errors[0].line}: ` : ''}${errors[0]?.msg}`;
  const where = !check || !check.code.length ? '' : `Its code: ${plural(check.bytes, 'byte')} at ${check.code.slice(0, 3).map(rangeText).join(', ')}${check.code.length > 3 ? ', …' : ''}${check.place === 'free' ? ', in memory the program does not use' : check.place === 'program' ? ' (the program fills memory: Mimir put the code where the program has a long run of one value). It is memory of the script\'s own: the program never sees it' : ', where its * = puts it: memory of the script\'s own, which the program never sees'}. It runs from ${$(check.entry ?? 0)}.`;
  // until it has done something, a line says what Run does
  const howTo = !kept && !mine.length;
  const inLibrary = !!cur && library.some(l => l.name.toLowerCase() === cur.name.toLowerCase());
  // the watch list: what was found in the code, without what the user took off, and what the user added
  const unwatched = new Set(cur?.unwatch ?? []);
  const spots = [...autoSpots.filter(w => !unwatched.has(w.key)), ...userSpots];
  const hiddenSpots = autoSpots.filter(w => unwatched.has(w.key)).length;
  const watchMode: WatchMode = dbg ? 'now' : kept ? 'run' : 'start';
  const watchItems: WatchItem[] = (() => {
    if (dbg) {
      const m = dbg.m, ref = dbg.before ? { ...dbg.before, mine: m.mine, code: m.code } : null;
      return spots.map(w => ({ spot: w, view: watchView(w, m, { ref, start: dbg.start, regs: m.cpu }) }));
    }
    if (!startMem) return [];
    if (kept) {
      const after: ScriptMemory = { mem: kept.run.mem, own: kept.run.own, mine: startMem.mine, code: startMem.code };
      return spots.map(w => ({ spot: w, view: watchView(w, after, { ref: startMem, start: startMem }) }));
    }
    return spots.map(w => ({ spot: w, view: watchView(w, startMem) }));
  })();
  /** an address or a name typed put on the watch list (whether it was) */
  const addWatch = (expr: string, kind: WatchKind): boolean => {
    if (!cur) return false;
    const at = watchAt(expr);
    if (at == null) { toast(`"${expr}" is not an address or a name of the program or the script: write $c000, 49152, a label, a variable or name+2`, 'warn'); return false; }
    const entry: ScriptWatchEntry = { expr, ...(kind === 'word' ? { size: 2 } : kind === 'pointer' ? { ptr: true } : kind === 'byte' ? {} : { size: +kind }) };
    const size = entry.ptr ? 2 : entry.size ?? 1;
    const same = spots.find(w => !w.error && w.at === at && w.size === size && !!w.ptr === !!entry.ptr);
    if (same) { toast(`${expr} is on the watch list already${same.name !== expr ? ` (as ${same.name})` : ''}`, 'info'); return false; }
    onEdit(cur.id, { watch: [...(cur.watch ?? []), entry] }, `Watch ${expr} in "${cur.name}"`);
    return true;
  };
  /** a spot off the watch list: one the user added goes, one found in the code is taken off (kept by its operand) */
  const removeWatch = (w: WatchSpot) => {
    if (!cur) return;
    if (w.user) { const rest = (cur.watch ?? []).filter(e => watchEntryKey(e) !== w.key); onEdit(cur.id, { watch: rest.length ? rest : undefined }, `Take ${w.name} off the watch list of "${cur.name}"`); return; }
    onEdit(cur.id, { unwatch: [...(cur.unwatch ?? []).filter(k => autoSpots.some(a => a.key === k)), w.key] }, `Take ${w.name} off the watch list of "${cur.name}"`);
  };
  // while debugging, the scratchpad shown is the run's as it is now, with what the last step changed
  const livePad: LivePad | null = (() => {
    if (!dbg) return null;
    const ps = dbg.m.script.pads, p = ps[pad] ?? ps[0]; if (!p) return null;
    return { name: p.name, bytes: dbg.m.own.slice(p.start, p.start + p.size), before: dbg.padsBefore?.[ps.indexOf(p)] ?? null };
  })();
  /** where a new scratchpad of `size` bytes goes: away from the script's code and its other scratchpads */
  const placePad = (size: number, near?: Addr): Addr => {
    const taken = [...(check?.code ?? []), ...(cur?.pads ?? []).map(p => ({ start: p.start, end: p.start + p.size }))];
    return scriptPlace(env.files, size, taken, near)?.at ?? 0xc000;
  };
  const stale = !!kept && kept.source !== source;

  return (
    <div className="scripts">
      {listFolded ? <div className="scr-list folded" role="navigation" aria-label="Scripts in the project, folded in">
        <button className="icon-btn" onClick={() => setListFolded(false)} aria-label="Unfold the script list" title="Unfold the list of the project's scripts and the library"><Icon name="side-show" size={16} /></button>
        <button className="icon-btn" onClick={onNew} aria-label="New script" title="New script: Kick Assembler code that runs in Mimir"><Icon name="plus" size={15} /></button>
        <span className="scr-rail-sep" />
        {scripts.map(s => (
          <button key={s.id} className={cx('icon-btn scr-rail-item', s.id === cur?.id && 'on')} aria-label={s.name} aria-pressed={s.id === cur?.id} onClick={() => { flush(); set({ selected: s.id, pad: 0, change: null }); }}
            title={`${s.name}${s.safe ? ' · safe mode' : ''}${running === s.id ? ' · running' : ''}`}><span className="scr-rail-name">{railName(s.name)}</span>{running === s.id && <span className="scr-busy" />}</button>
        ))}
      </div> : <div className="scr-list">
        <div className="scr-list-head"><span>Project</span><span className="grow" />
          <button className="icon-btn" onClick={onNew} aria-label="New script" title="New script: Kick Assembler code that runs in Mimir"><Icon name="plus" size={15} /></button>
          <button className="icon-btn" onClick={() => setListFolded(true)} aria-label="Fold the script list" title="Fold the list in to a strip: the editor gets its room (the strip still switches scripts)"><Icon name="side-hide" size={15} /></button></div>
        <div role="listbox" aria-label="Scripts">
          {scripts.map(s => (
            <button key={s.id} role="option" aria-selected={s.id === cur?.id} className={cx('scr-item', s.id === cur?.id && 'on')} onClick={() => { flush(); set({ selected: s.id, pad: 0, change: null }); }}
              title={`${s.name}${s.safe ? ' · safe mode: its runs write nothing into the program' : ''}${runs[s.id] ? ` · last run: ${scriptEndText(runs[s.id].run)}` : ''}`}>
              <Icon name="prompt" size={13} /><span className="scr-item-name">{s.name}</span>{s.safe && <Icon name="shield" size={12} className="scr-safe-ico" />}{running === s.id && <span className="scr-busy" aria-label="running" />}
            </button>
          ))}
        </div>
        {libraryList}
      </div>}
      {cur && check && <div className="scr-main">
        <div className="toolbar">
          <NameField key={cur.id} value={cur.name} taken={scripts.filter(s => s.id !== cur.id).map(s => s.name)} onCommit={n => onEdit(cur.id, { name: n }, `Rename script "${cur.name}" to "${n}"`)} toast={toast} />
          <span className={cx('pill scr-check', check.ok ? (warnings.length ? 'mid' : 'hi') : 'lo')} role="status" title={[...check.problems.map(p => `${p.level === 'error' ? 'Error' : 'Warning'}${p.line ? ` (line ${p.line})` : ''}: ${p.msg}`), check.ok ? 'The script assembles with the program\'s names and has code to run.' : 'Fix it, and Run can be used.', where].filter(Boolean).join('\n')}
            onClick={() => { const p = check.problems.find(x => x.line); if (p?.line) goLine(p.line); }}>
            <Icon name={check.ok ? 'check' : 'err'} size={12} />{chip}
          </span>
          <span className="grow" />
          <label className={cx('scr-safe', cur.safe && 'on')} title={cur.safe
            ? 'Safe mode is on: a run leaves the program and its .asm as they are and lists what it would change (Would change); Write into the program puts that in. Switch it off and runs write into the program again'
            : 'Safe mode: the script\'s runs write nothing into the program or its .asm; they list what they would change'}>
            <input type="checkbox" role="switch" className="switch" aria-label="Safe mode" checked={!!cur.safe} onChange={e => onSafe(cur.id, e.target.checked)} />
            <Icon name="shield" size={14} /><span className="lbl">Safe mode</span>
          </label>
          <span className="tb-sep" />
          {dbg ? <div className="scr-dbg-tools" role="group" aria-label="Debugging">
            {dbgBusy
              ? <button className="btn" onClick={() => { pauseReq.current = true; }} title="Stop where it is now, and go on debugging from there">Pause</button>
              : <button className="btn primary" onClick={contDbg} title={`Go on to the end of the run, or to the next breakpoint (Ctrl+Enter). At the end it is a run: ${cur.safe ? 'in safe mode nothing goes into the program' : 'its changes go into the program'}`}><Icon name="play" />Continue<kbd>Ctrl+Enter</kbd></button>}
            <button className="btn" disabled={dbgBusy} onClick={stepDbg} title="Run the next instruction; into a JSR (F8)">Step<kbd>F8</kbd></button>
            <button className="btn" disabled={dbgBusy} onClick={overDbg} title="Run the next instruction; a JSR runs until it returns (F6)">Over<kbd>F6</kbd></button>
            <button className="btn" disabled={dbgBusy} onClick={outDbg} title="Run until the routine it is in returns; at the top, to the end of the run (Shift+F6)">Out<kbd>Shift+F6</kbd></button>
            <button className="btn" onClick={() => stopDbg()} title="Stop debugging where it is: nothing goes into the program"><Icon name="x" />Stop</button>
          </div> : <>
            {isRunning
              ? <button className="btn" onClick={() => stopScript()} title="Stop the run"><Icon name="x" />Stop</button>
              : <button className="btn primary scr-run" disabled={!check.ok || !!running} onClick={run} title={!check.ok ? 'The script must check out before it can run: see the errors'
                : cur.safe ? 'Run the script in safe mode (Ctrl+Enter in the editor): nothing goes into the program or its .asm; what it would change is listed under Would change'
                : 'Run the script (Ctrl+Enter in the editor): it starts from the program without what its last run changed, and what it changes now goes into the program'}>
                <Icon name="play" />Run<kbd>Ctrl+Enter</kbd></button>}
            <button className="btn scr-debug-btn" disabled={!check.ok || !!running} onClick={startDebug} title={check.ok ? 'Debug: start the run and stop before its first instruction, then go an instruction at a time (F8), over a JSR (F6) or on to a breakpoint (click left of a line number). The registers and the stack show beside the code' : 'The script must check out before it can be debugged: see the errors'}>Debug<kbd>F8</kbd></button>
            <span className="tb-sep" />
            <button className="btn" onClick={() => { flush(); const s = scriptsRef.current.find(x => x.id === cur.id) ?? cur; const had = saveToLibrary({ ...s, source: models.current[cur.id]?.getValue() ?? s.source }); toast(had ? `"${cur.name}" in the library is replaced by this one` : `"${cur.name}" saved in the library: every project can add it`, 'ok'); }}
              title={inLibrary ? 'Save the script in the library again, in place of the one of the same name there' : 'Save a copy of the script in the library, so that other projects can add it'}><Icon name="bookmark" /><span className="lbl">{inLibrary ? 'Update library' : 'Save to library'}</span></button>
            <button className="icon-btn" aria-label="Delete script" title={`Delete the script "${cur.name}"${mine.length ? ', and take what it changed out of the program' : ''} (Ctrl+Z brings it back)`} onClick={() => { flush(); onRemove(cur.id); }}><Icon name="trash" size={15} /></button>
          </>}
        </div>
        {howTo && !dbg && (cur.safe
          ? <p className="scr-howto scr-safe-note" role="note"><Icon name="shield" size={13} /><span><b>Safe mode</b> is on: <b>Run</b> (Ctrl+Enter) runs the code here in Mimir and leaves the program and its .asm as they are. What it would change is listed under <i>In the program → Would change</i>, and <b>Write into the program</b> puts it in. <b>Debug</b> (F8) goes through it an instruction at a time.</span></p>
          : <p className="scr-howto" role="note"><Icon name="info" size={13} /><span><b>Run</b> (Ctrl+Enter) runs the code here in Mimir. What it changes in the program's bytes goes into the program and its .asm, listed under <i>In the program</i>; the script's own code never does. <b>Debug</b> (F8) goes through it an instruction at a time.</span></p>)}
        {dbg && <p className="scr-howto scr-dbg-note" role="note"><Icon name="info" size={13} /><span>Debugging: the code cannot be changed until you stop. A click left of a line number sets a breakpoint. Reaching the end, it is a run: {cur.safe ? 'in safe mode nothing goes into the program.' : 'its changes go into the program.'}</span></p>}
        <div className="scr-links" role="list" aria-label="Links">
          <span className="scr-links-head" title="Names of the program linked to the script: right-click a label (a byte of a table, an instruction) in the listing or the source and pick Link to a script. A click writes the name in the code where the cursor is; Shift+click shows it in the listing">Links</span>
          {links.length ? links.map(k => (
            <span key={k.at} role="listitem" className={cx('scr-link', `scr-link-${k.what}`)}>
              <button className="scr-link-name" onClick={e => { if (e.shiftKey) onShow(k.at, k.at + 1); else if (dbg) toast('The code cannot be changed while it is being debugged: stop first', 'info'); else insertLink(k.name); }}
                title={`${k.name} = $${h4(k.at)} · ${k.what === 'label' ? 'a label of the program' : k.what === 'variable' ? 'a zero-page variable' : k.what === 'hardware' ? 'a hardware register' : 'an address with no name'}\nClick: write it in the code where the cursor is · Shift+click: show it in the listing`}>{k.name}</button>
              <button className="scr-link-x" aria-label={`Unlink ${k.name}`} title="Unlink it (the code keeps what it wrote)" onClick={() => onEdit(cur.id, { links: (cur.links ?? []).filter(x => x !== k.at) }, `Unlink ${k.name} from "${cur.name}"`)}><Icon name="x" size={11} /></button>
            </span>))
            : <span className="scr-links-empty">Right-click a label in the listing or the source and pick <b>Link to a script</b>: it comes here, and a click on it writes it in the code.</span>}
        </div>
        <div className="scr-body">
          <div className="scr-edit-row">
            <div className="mon-host scr-editor" ref={host} style={{ display: state === 'ready' ? 'block' : 'none' }} />
            {state !== 'ready' && <textarea className="fallback-code scr-fallback" aria-label="Script code" value={source} readOnly={!!dbg} onChange={e => { setLive(l => ({ ...l, [cur.id]: e.target.value })); onEdit(cur.id, { source: e.target.value }, `Edit script "${cur.name}"`); }} />}
            {dbg && <DebugPanel m={dbg.m} prev={dbg.prev} names={byAddr} busy={dbgBusy} atBp={atBp}
              watch={watchItems.length ? <WatchTable items={watchItems} mode="now" compact onGoLine={goLine} /> : null} />}
          </div>
          {!outFolded && <Splitter dir="h" onDrag={d => { const k = dbg ? 'dbgOutH' : 'outH'; set({ [k]: Math.max(dbg ? 60 : 140, Math.min(window.innerHeight - 260, useScripts.getState()[k] - d)) }); }} />}
          <ScriptOutput script={cur} check={check} kept={kept} stale={stale} mine={mine} env={env} names={names} canWrite={check.ok && !running && !dbg}
            folded={outFolded} height={dbg ? dbgOutH : outH} watchCount={spots.length} live={livePad} where={where} theme={theme}
            watch={<WatchSection items={watchItems} mode={watchMode} stale={stale} hidden={hiddenSpots} onRemove={removeWatch} onAdd={addWatch} onGoLine={goLine} onShow={onShow}
              onRestore={() => onEdit(cur.id, { unwatch: undefined }, `Put back on the watch list of "${cur.name}" what was taken off`)} />}
            onGoLine={goLine} onWrite={write} placePad={placePad} blocks={blocks} cursorBlock={cursorBlock}
            onEdit={onEdit} onTakeOut={onTakeOut} onSwitchPatch={onSwitchPatch} onCopyBlock={onCopyBlock} onShow={onShow} onCopy={onCopy}
            onSave={onSave} onSaveText={onSaveText} onMenu={onMenu} toast={toast} />
        </div>
      </div>}
    </div>
  );
}

/** The library's scripts: each can be added to the project, or removed from the library. */
function LibraryList({ library, onAdd, onRemove }: { library: LibraryScript[]; onAdd: (s: LibraryScript) => void; onRemove: (name: string) => void }) {
  return <>
    <div className="scr-list-head scr-lib-head" title="Scripts kept by Mimir for every project: Save to library puts one here"><span>Library</span><span className="grow" /><span className="scr-lib-n">{library.length || ''}</span></div>
    {!library.length && <p className="scr-lib-empty">Save to library keeps a script here for every project.</p>}
    <div role="list" aria-label="Library">
      {library.map(l => (
        <div key={l.name} role="listitem" className="scr-lib-item" title={`${l.name}, saved ${new Date(l.saved).toLocaleString()}\n\n${l.source.split('\n').slice(0, 12).join('\n')}`}>
          <span className="scr-item-name">{l.name}</span>
          <button className="icon-btn" aria-label={`Add ${l.name} to the project`} title="Add a copy to this project" onClick={() => onAdd(l)}><Icon name="plus" size={13} /></button>
          <button className="icon-btn" aria-label={`Remove ${l.name} from the library`} title="Remove it from the library (the projects keep their copies)" onClick={() => onRemove(l.name)}><Icon name="x" size={13} /></button>
        </div>
      ))}
    </div>
  </>;
}

/** what a template's tooltip says: its line, and its comment up to the settings (what it does, where it was seen) */
const templateTip = (t: ScriptTemplate) => {
  const lines = t.source.split('\n');
  const end = lines.findIndex((l, i) => i > 2 && /^\/\/ =+$/.test(l));
  const text = lines.slice(3, end > 0 ? end : 20).map(l => l.replace(/^\/\/ {0,2}/, ''));
  while (text.length && !text[text.length - 1].trim()) text.pop();
  return `${t.about}\n\n${text.join('\n')}`;
};

/** The templates Mimir comes with (decryptions, script-templates.ts): each can be added to the project as a copy. The
 *  heading folds the list in (kept by the app). */
function TemplateList({ folded, onFold, onAdd }: { folded: boolean; onFold: (v: boolean) => void; onAdd: (t: ScriptTemplate) => void }) {
  return <>
    <div className="scr-list-head scr-lib-head scr-tpl-head">
      <button className="scr-tpl-fold" onClick={() => onFold(!folded)} aria-expanded={!folded} aria-controls="scr-templates"
        title={folded ? 'Show the templates: ready scripts that decrypt and encrypt the ways games do' : 'Fold the templates in'}>
        <Icon name={folded ? 'chevron' : 'down'} size={11} /><span>Templates</span></button>
      <span className="grow" /><span className="scr-lib-n">{SCRIPT_TEMPLATES.length}</span></div>
    {!folded && <div role="list" aria-label="Templates" id="scr-templates">
      {SCRIPT_TEMPLATES.map(t => (
        <div key={t.name} role="listitem" className="scr-lib-item scr-tpl-item" title={templateTip(t)}>
          <span className="scr-item-name">{t.title}</span>
          <button className="icon-btn" aria-label={`Add the template ${t.title} to the project`} title={`Add a copy to this project, as "${t.name}": set its .vars and run it`} onClick={() => onAdd(t)}><Icon name="plus" size={13} /></button>
        </div>
      ))}
    </div>}
  </>;
}

function NameField({ value, taken, onCommit, toast }:{ value: string; taken: string[]; onCommit: (n: string) => void; toast: ScriptsViewProps['toast'] }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const commit = () => {
    const n = v.trim();
    if (n === value) return;
    if (!n) { setV(value); return; }
    if (taken.some(t => t.toLowerCase() === n.toLowerCase())) { toast(`There is already a script called "${n}"`, 'warn'); setV(value); return; }
    onCommit(n);
  };
  return <input className="scr-name" aria-label="Script name" value={v} maxLength={64} onChange={e => setV(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setV(value); (e.target as HTMLInputElement).blur(); } }} />;
}

/** a script in the folded list: its first letter and the number it ends with (script, script2: s, s2) */
const railName = (name: string) => (name[0] ?? '?') + (/\d+$/.exec(name)?.[0] ?? '').slice(-2);
