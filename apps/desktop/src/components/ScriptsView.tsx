/* The Scripts tab (spec 10.3): the project's scripts, Kick Assembler code that runs in Mimir on the program's bytes.
 * The code is written in Monaco with the Kick Assembler highlighting; it is checked as it is typed (assembled with
 * the program's names and the scratchpads at hand) and runs only when it checks out. What a run changes in the
 * program's bytes goes into the program as the script's patches (the listing, the source, the export and Build & Run
 * have the new bytes; the script's code is never in them); its scratchpads keep data outside the program, which can
 * be saved as a file. The library keeps scripts for every project. */
import { useEffect, useMemo, useRef, useState } from 'react';
import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api';
import { BLOCK_PAD_FORM, byteLines, checkScript, SCRIPT_TEMPLATES, type ScriptTemplate, disassembleBytes, h2, h4, initEmpty, monitorChar, padData, padName, padNow, padStart, patchEnd, rangeText, SCRIPT_FLAGS, SCRIPT_P, scriptEndText, ScriptMachine, scriptNames, scriptPatches, scriptPlace, tidyInit, type Addr, type BlockKind, type Patch, type ScriptCheck, type ScriptEnv, type ScriptInit, type ScriptLink, type ScriptPad, type ScriptPadSource, type ScriptProblem, type ScriptRun, type ScriptZpInit, type UserScript } from '@mimir/core';
import type { MenuItem } from '../lib/types';
import { PadCompare, PadEditor } from './PadTools';
import { Icon } from '../lib/icons';
import { cx } from '../lib/util';
import { stopScript } from '../lib/scriptrun';
import { initValue } from '../lib/scriptinit';
import { useScripts, type LibraryScript, type PadMode, type ScriptRunKept } from '../store/scripts';
import { Splitter } from './Splitter';
import { DebugPanel, regsOf, type DebugRegs } from './ScriptDebug';

/** a script being debugged: its machine, the code it was assembled from, the registers and its scratchpads' bytes
 *  before the last step (what the step changed is marked) */
interface Debugging { id: string; m: ScriptMachine; source: string; prev: DebugRegs | null; padsBefore: Uint8Array[] | null }
/** instructions the debugger runs before it lets the window draw (Continue, Step over and Step out go on in parts) */
const DEBUG_SLICE = 400_000;

type MonacoNs = typeof Monaco;

interface ScriptsViewProps {
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
  onEdit: (id: string, change: Partial<Pick<UserScript, 'name' | 'source' | 'pads' | 'links' | 'init'>>, label: string) => void;
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

/** A scratchpad's bytes as the text of a log: the fill after the last byte written left out; PETSCII with RETURN
 *  ($0d) as the end of a line, or screen codes 40 to a line as on the screen. */
export function logText(bytes: Uint8Array, fill: number, screen: boolean): string {
  let n = bytes.length;
  while (n > 0 && bytes[n - 1] === fill) n--;
  const ch = (b: number) => monitorChar(b, screen)?.ch ?? '.';
  if (screen) {
    const rows: string[] = [];
    for (let i = 0; i < n; i += 40) rows.push(Array.from(bytes.subarray(i, Math.min(n, i + 40)), ch).join('').replace(/\s+$/, ''));
    return rows.join('\n') + '\n';
  }
  let out = '';
  for (let i = 0; i < n; i++) out += bytes[i] === 0x0d ? '\n' : ch(bytes[i]);
  return out.endsWith('\n') ? out : out + '\n';
}

export function ScriptsView({ scripts, env, envFor, patches, theme, linkOf, kinds, onNew, onAdd, onAddTemplate, onEdit, onRemove, onRun, onWrite, onSafe, onFinish, onTakeOut, onSwitchPatch, onShow, onCopy, onSave, onSaveText, toast, onMenu, blocks, cursorBlock, onCopyBlock }: ScriptsViewProps) {
  const { selected, runs, running, shown, mode, screen, outH, dbgOutH, outFolded, library, gotoLine, set, saveToLibrary, removeFromLibrary, listFolded, setListFolded, templatesFolded, setTemplatesFolded } = useScripts();
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
  const keepBefore = (d: Debugging) => { d.prev = regsOf(d.m); d.padsBefore = d.m.script.pads.map(p => d.m.own.slice(p.start, p.start + p.size)); };
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
    const d: Debugging = { id: s.id, m: new ScriptMachine(e, { source: text, pads: s.pads, init: s.init }, c), source: text, prev: null, padsBefore: null };
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
  // while debugging, the scratchpad shown is the run's as it is now, with what the last step changed
  const livePad: LivePad | null = (() => {
    if (!dbg || shown.kind !== 'pad') return null;
    const ps = dbg.m.script.pads, p = ps[shown.i] ?? ps[0]; if (!p) return null;
    return { name: p.name, bytes: dbg.m.own.slice(p.start, p.start + p.size), before: dbg.padsBefore?.[ps.indexOf(p)] ?? null };
  })();
  /** where a new scratchpad of `size` bytes goes: away from the script's code and its other scratchpads */
  const placePad = (size: number, near?: Addr): Addr => {
    const taken = [...(check?.code ?? []), ...(cur?.pads ?? []).map(p => ({ start: p.start, end: p.start + p.size }))];
    return scriptPlace(env.files, size, taken, near)?.at ?? 0xc000;
  };
  // what the folded output's bar says it holds
  const outSummary = !cur ? '' : [
    !initEmpty(cur.init) ? 'Init set' : '',
    cur.pads.length ? plural(cur.pads.length, 'scratchpad') : '',
    mine.length ? `${plural(mine.length, 'change')} in the program` : '',
    kept ? `last run: ${kept.run.end === 'rts' ? 'returned' : kept.run.end === 'brk' ? 'BRK' : kept.run.end === 'jam' ? 'jammed' : 'stopped at the limit'}` : '',
  ].filter(Boolean).join(' · ');

  return (
    <div className="scripts">
      {listFolded ? <div className="scr-list folded" role="navigation" aria-label="Scripts in the project, folded in">
        <button className="icon-btn" onClick={() => setListFolded(false)} aria-label="Unfold the script list" title="Unfold the list of the project's scripts and the library"><Icon name="side-show" size={16} /></button>
        <button className="icon-btn" onClick={onNew} aria-label="New script" title="New script: Kick Assembler code that runs in Mimir"><Icon name="plus" size={15} /></button>
        <span className="scr-rail-sep" />
        {scripts.map(s => (
          <button key={s.id} className={cx('icon-btn scr-rail-item', s.id === cur?.id && 'on')} aria-label={s.name} aria-pressed={s.id === cur?.id} onClick={() => { flush(); set({ selected: s.id, shown: { kind: 'pad', i: 0 } }); }}
            title={`${s.name}${s.safe ? ' · safe mode' : ''}${running === s.id ? ' · running' : ''}`}><span className="scr-rail-name">{railName(s.name)}</span>{running === s.id && <span className="scr-busy" />}</button>
        ))}
      </div> : <div className="scr-list">
        <div className="scr-list-head"><span>Project</span><span className="grow" />
          <button className="icon-btn" onClick={onNew} aria-label="New script" title="New script: Kick Assembler code that runs in Mimir"><Icon name="plus" size={15} /></button>
          <button className="icon-btn" onClick={() => setListFolded(true)} aria-label="Fold the script list" title="Fold the list in to a strip: the editor gets its room (the strip still switches scripts)"><Icon name="side-hide" size={15} /></button></div>
        <div role="listbox" aria-label="Scripts">
          {scripts.map(s => (
            <button key={s.id} role="option" aria-selected={s.id === cur?.id} className={cx('scr-item', s.id === cur?.id && 'on')} onClick={() => { flush(); set({ selected: s.id, shown: { kind: 'pad', i: 0 } }); }}
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
            <button className="btn" onClick={() => { flush(); const s = scriptsRef.current.find(x => x.id === cur.id) ?? cur; const had = saveToLibrary({ ...s, source: models.current[cur.id]?.getValue() ?? s.source }); toast(had ? `"${cur.name}" in the library is replaced by this one` : `"${cur.name}" saved in the library: every project can add it`, 'ok'); }}
              title={inLibrary ? 'Save the script in the library again, in place of the one of the same name there' : 'Save a copy of the script in the library, so that other projects can add it'}><Icon name="bookmark" /><span className="lbl">{inLibrary ? 'Update library' : 'Save to library'}</span></button>
            <button className="icon-btn" aria-label="Delete script" title={`Delete the script "${cur.name}"${mine.length ? ', and take what it changed out of the program' : ''} (Ctrl+Z brings it back)`} onClick={() => { flush(); onRemove(cur.id); }}><Icon name="trash" size={15} /></button>
          </>}
        </div>
        {howTo && !dbg && (cur.safe
          ? <p className="scr-howto scr-safe-note" role="note"><Icon name="shield" size={13} /><span><b>Safe mode</b> is on: <b>Run</b> (Ctrl+Enter) runs the code here in Mimir and leaves the program and its .asm as they are. What it would change is listed under <i>Would change</i>, and <b>Write into the program</b> puts it in. <b>Debug</b> (F8) goes through it an instruction at a time.</span></p>
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
            {dbg && <DebugPanel m={dbg.m} prev={dbg.prev} names={byAddr} busy={dbgBusy} atBp={atBp} />}
          </div>
          {!outFolded && <Splitter dir="h" onDrag={d => { const k = dbg ? 'dbgOutH' : 'outH'; set({ [k]: Math.max(dbg ? 60 : 140, Math.min(window.innerHeight - 260, useScripts.getState()[k] - d)) }); }} />}
          <button className={cx('scr-out-bar', outFolded && 'folded')} aria-expanded={!outFolded} aria-controls="scr-out"
            onClick={() => set({ outFolded: !outFolded })} title={outFolded ? 'Show the output: Init, what the script changed, the scratchpads and the last run' : 'Fold the output down: the code gets the room'}>
            <Icon name={outFolded ? 'up' : 'down'} size={13} /><span className="scr-out-name">Output</span>
            <span className="scr-out-sum">{outSummary}</span>
            {errors.length > 0 && outFolded && <span className="scr-out-bad">{plural(errors.length, 'error')}</span>}
          </button>
          {!outFolded && <div className="scr-out" id="scr-out" style={{ height: dbg ? dbgOutH : outH }}>
            <ScriptSide script={cur} check={check} kept={kept} stale={!!kept && kept.source !== source} mine={mine} env={env} names={names} canWrite={check.ok && !running && !dbg} onGoLine={goLine} onEdit={onEdit} onTakeOut={onTakeOut} onSwitchPatch={onSwitchPatch} onWrite={write} blocks={blocks} cursorBlock={cursorBlock} onCopyBlock={onCopyBlock} />
            <PadView script={cur} mine={mine} would={kept?.safe ? kept.would ?? [] : []} names={names} mode={mode} screen={screen} live={livePad} theme={theme} onMode={(m: PadMode) => set({ mode: m })} onScreen={v => set({ screen: v })}
              onShow={onShow} onCopy={onCopy} onSave={onSave} onSaveText={onSaveText} onEdit={onEdit} onMenu={onMenu} placePad={placePad} toast={toast} />
          </div>}
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

/** The left of the output: the problems, what the runs start with (Init), what the script changed in the program,
 *  what its last run would change (safe mode), the scratchpads (edited here) and the last run. */
/** a script in the folded list: its first letter and the number it ends with (script, script2: s, s2) */
const railName = (name: string) => (name[0] ?? '?') + (/\d+$/.exec(name)?.[0] ?? '').slice(-2);

/** a block of the program a scratchpad can be filled from: where it is, its type and its name (its label, else its address) */
export interface BlockChoice { start: Addr; end: Addr; kind: BlockKind; name: string }

/** Which block goes into which scratchpad (a new one, or one of the script's), and what it becomes there. */
function BlockToPad({ blocks, pads, first, into, onCopy, onCancel }: { blocks: readonly BlockChoice[]; pads: readonly ScriptPad[]; first: Addr | null; into: number | null; onCopy: (start: Addr, pad: number | null) => void; onCancel: () => void }) {
  const [start, setStart] = useState<Addr | null>(first != null && blocks.some(b => b.start === first) ? first : blocks[0]?.start ?? null);
  const [pad, setPad] = useState<string>(into != null ? String(into) : 'new');
  const b = blocks.find(x => x.start === start), n = b ? b.end - b.start : 0, p = pad === 'new' ? null : pads[+pad];
  return (
    <div className="pad-from" role="group" aria-label="Copy a block into a scratchpad">
      <label><span>Block</span><select aria-label="Block" value={start ?? ''} onChange={e => setStart(+e.target.value)}>
        {blocks.map(x => <option key={x.start} value={x.start}>{x.name} · {x.kind} · {rangeText(x)} · {plural(x.end - x.start, 'byte')}</option>)}
      </select></label>
      <label><span>Into</span><select aria-label="Into" value={pad} onChange={e => setPad(e.target.value)}>
        <option value="new">a new scratchpad</option>
        {pads.map((x, i) => <option key={i} value={i}>{x.name} ({rangeText({ start: x.start, end: x.start + x.size })})</option>)}
      </select></label>
      {b && <p className="muted small">As {BLOCK_PAD_FORM[b.kind] ?? 'hex'}{b.kind === 'code' ? ' (Kick Assembler, the program\'s names kept)' : ''}. {p ? (p.size < n ? `${p.name} becomes ${n} bytes, when there is room after it.` : `In place of what ${p.name} starts with now.`) : `A new scratchpad of ${n} bytes.`}</p>}
      <div className="pad-from-act">
        <button className="btn small primary" disabled={!b} onClick={() => b && onCopy(b.start, p ? +pad : null)}><Icon name="copy" size={13} />Copy</button>
        <button className="btn small" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function ScriptSide({ script, check, kept, stale, mine, env, names, canWrite, onGoLine, onEdit, onTakeOut, onSwitchPatch, onWrite, blocks, cursorBlock, onCopyBlock }: {
  script: UserScript; check: ScriptCheck; kept?: ScriptRunKept; stale: boolean; mine: Patch[]; env: ScriptEnv; names: ReadonlyMap<string, number>; canWrite: boolean; onGoLine: (n: number) => void;
  onEdit: ScriptsViewProps['onEdit']; onTakeOut: ScriptsViewProps['onTakeOut']; onSwitchPatch: ScriptsViewProps['onSwitchPatch']; onWrite: () => void;
  blocks: readonly BlockChoice[]; cursorBlock: Addr | null; onCopyBlock: ScriptsViewProps['onCopyBlock'];
}) {
  const { shown, set } = useScripts();
  const [fromBlock, setFromBlock] = useState(false);
  const setPads = (pads: ScriptPad[], label: string) => onEdit(script.id, { pads }, label);
  const addPad = () => {
    // not over the code, another scratchpad, or memory the code reads and writes as the program's ($0400 for the screen)
    const taken = [...check.code, ...script.pads.map(p => ({ start: p.start, end: p.start + p.size })), ...check.access];
    const last = script.pads[script.pads.length - 1];
    const start = scriptPlace(env.files, 0x100, taken, last ? last.start + last.size : undefined)?.at ?? 0xc000;
    const name = padName(script.pads);
    setPads([...script.pads, { name, start, size: 0x100 }], `Add scratchpad ${name} to "${script.name}"`);
    set({ shown: { kind: 'pad', i: script.pads.length } });
  };
  /** a scratchpad changed in the table: start content written in Kick Assembler is for its address, so it is assembled
   *  again where the scratchpad is now (when it still reads; else it keeps its bytes) */
  const moved = (old: ScriptPad, q: ScriptPad): ScriptPad => {
    if (q.start === old.start || q.src?.form !== 'asm') return q;
    const r = padData(q.src, q.start, q.size, names, q.fill ?? 0);
    return 'bytes' in r ? { ...q, ...(r.bytes.length ? { data: r.bytes } : {}) } : q;
  };
  const run = kept?.run;
  const sorted = [...mine].sort((a, b) => a.start - b.start);
  // what the last run would have written, when it ran in safe mode
  const would = kept?.safe ? kept.would ?? [] : null;
  return (
    <div className="scr-side">
      {check.problems.length > 0 && <section className="scr-sec">
        <h4>Problems</h4>
        <ul className="scr-problems">{check.problems.map((p, i) => (
          <li key={i} className={cx(p.level === 'error' ? 'bad' : 'warn')}>
            <Icon name={p.level === 'error' ? 'err' : 'warn'} size={13} />
            {p.line ? <button className="linkish" onClick={() => onGoLine(p.line!)}>Line {p.line}</button> : null}<span>{p.msg}</span>
          </li>))}</ul>
      </section>}
      <InitSection script={script} names={names} problems={check.problems} onEdit={onEdit} />
      <section className="scr-sec">
        <h4>In the program{stale && !would && <span className="pill mid" title="The code has changed since this run: run it again to update the program">code changed since</span>}<span className="grow" />
          {mine.length > 0 && <button className="btn ghost small" onClick={() => onTakeOut(script.id)} title="Take what the script changed out of the program: the original bytes come back (Ctrl+Z puts it back)"><Icon name="undo" size={13} />Take out</button>}</h4>
        {!mine.length && <p className="muted small">{script.safe
          ? 'Nothing. Safe mode is on: runs leave the program and its .asm as they are.'
          : <>Nothing yet. What a run changes in the program's bytes goes in here and into the program: the listing, the source, the export and Build &amp; Run have it.</>}</p>}
        {mine.length > 0 && script.safe && <p className="muted small">Written before safe mode was switched on; runs in safe mode leave it as it is.</p>}
        <ul className="scr-changes" aria-label="Changed in the program">{sorted.map(p => (
          <li key={p.id} className={cx('scr-change-row', p.off && 'off')}>
            <input type="checkbox" role="switch" className="switch" checked={!p.off} aria-label={`${p.name} in the program`} title={p.off ? 'Left out: the original bytes are there. Switch it on to write the change' : 'Written into the program. Switch it off to leave it out (runs keep it out)'} onChange={e => onSwitchPatch(p, e.target.checked)} />
            <button className={cx('scr-change', shown.kind === 'patch' && shown.id === p.id && 'on')} onClick={() => set({ shown: { kind: 'patch', id: p.id } })}>{rangeText({ start: p.start, end: patchEnd(p) })} · {plural(p.bytes.length, 'byte')}</button>
          </li>))}</ul>
      </section>
      {would && <section className="scr-sec scr-would-sec">
        <h4><Icon name="shield" size={12} />Would change{stale && <span className="pill mid" title="The code has changed since this run: run it again to see what it would change now">code changed since</span>}</h4>
        <p className="muted small">{would.length ? 'The last run ran in safe mode: none of this is in the program.' : 'The last run ran in safe mode and would change none of the program\'s bytes.'}</p>
        <ul className="scr-changes" aria-label="Would change in the program">{would.map((p, i) => (
          <li key={i} className={cx('scr-change-row', p.off && 'off')}>
            <button className={cx('scr-change', shown.kind === 'would' && shown.i === i && 'on')} onClick={() => set({ shown: { kind: 'would', i } })}
              title={p.off ? 'You left this change out of the program: written, it would stay out' : 'What the run would write here: a click shows the bytes'}>{rangeText({ start: p.start, end: patchEnd(p) })} · {plural(p.bytes.length, 'byte')}</button>
          </li>))}</ul>
        {would.length > 0 && <button className="btn small scr-write" disabled={!canWrite} onClick={onWrite}
          title="Run the script once more and write what it changes into the program and its .asm, in place of what its earlier runs wrote (Ctrl+Z takes it back). Safe mode stays on"><Icon name="download" size={13} />Write into the program</button>}
      </section>}
      <section className="scr-sec">
        <h4>Scratchpads<span className="grow" />
          <button className={cx('btn ghost small', fromBlock && 'on')} aria-expanded={fromBlock} onClick={() => setFromBlock(v => !v)} title="Copy a block of the program into a scratchpad, written as its type is: code as code, text as text, characters, sprites and bitmaps as .byte lines in their shape, other data as hex"><Icon name="copy" size={13} />From a block…</button>
          <button className="btn ghost small" onClick={addPad} title="A scratchpad: memory of the script's own at an address, for data kept outside the program (a log, say) that can be saved as a file. It is cleared before each run; its name (and name_end) are labels in the code"><Icon name="plus" size={13} />Add</button></h4>
        {fromBlock && <BlockToPad blocks={blocks} pads={script.pads} first={cursorBlock} into={shown.kind === 'pad' && script.pads[shown.i] ? shown.i : null}
          onCopy={(start, pad) => { onCopyBlock(start, script.id, pad); setFromBlock(false); }} onCancel={() => setFromBlock(false)} />}
        {!script.pads.length && <p className="muted small">None. Add one to keep data outside the program, a log the script writes, say, and save it as a file.</p>}
        <div className="pad-table" role="table" aria-label="Scratchpads">
          {script.pads.length > 0 && <div className="pad-row pad-head" role="row"><span>Name</span><span>Address</span><span>Size</span><span>Fill</span><span /></div>}
          {script.pads.map((p, i) => (
            <PadRow key={`${script.id}-${i}`} pad={p} on={shown.kind === 'pad' && shown.i === i} bad={check.problems.some(x => x.pad === i && x.level === 'error')} warn={check.problems.some(x => x.pad === i && x.level === 'warning')}
              onShow={() => set({ shown: { kind: 'pad', i } })}
              onChange={q => setPads(script.pads.map((x, j) => (j === i ? moved(x, q) : x)), `Change scratchpad ${p.name} of "${script.name}"`)}
              onRemove={() => { setPads(script.pads.filter((_, j) => j !== i), `Remove scratchpad ${p.name} from "${script.name}"`); set({ shown: { kind: 'pad', i: 0 } }); }} />
          ))}
        </div>
      </section>
      {check.prints.length > 0 && <section className="scr-sec"><h4>.print</h4><pre className="scr-prints">{check.prints.join('\n')}</pre></section>}
      {run && <section className="scr-sec scr-run-sec">
        <h4>Last run</h4>
        <p className={cx('scr-end', run.end === 'jam' || run.end === 'limit' ? 'warn' : 'ok')}>{scriptEndText(run)}</p>
        <p className="scr-regs mono">A=${h2(run.regs.a)} X=${h2(run.regs.x)} Y=${h2(run.regs.y)} S=${h2(run.regs.s)} P=${h2(run.regs.p)} · {run.ms} ms</p>
        {kept!.failed.map((f, i) => <p key={i} className="small scr-failed"><Icon name="warn" size={13} />{kept!.safe ? 'Could not be written' : 'Not written'} into the program, {rangeText(f)}: {f.error}</p>)}
        {run.overCode?.length ? <p className="small scr-failed" title="A run that writes over its code no longer runs the code it was written as (a loop stops early). Code that changes itself on purpose (an operand) is said here too"><Icon name="warn" size={13} />It wrote over its own code: {run.overCode.slice(0, 4).map(o => `line ${o.line} ($${h4(o.at)}${o.times > 1 ? `, ${o.times} times` : ''})`).join(', ')}{run.overCode.length > 4 ? ', …' : ''}. If that was not meant, an address the code writes lies where the code is.</p> : null}
        {run.other > 0 && <p className="small muted">{plural(run.other, 'byte')} changed outside the program and the scratchpads (the zero page, the stack, …): not kept.</p>}
      </section>}
    </div>
  );
}

/**
 * Init (spec 10.3): what the script's runs start with. A, X and Y (a byte each), the flags N V D I Z C (a click sets or
 * clears one) and zero-page bytes or words (a pointer, low byte first), each with its address (a name of the program's
 * zero page, or $fb) and its value (a number, or a name: a label's address). What differs from a run without an init
 * is kept with the script (in the project and the library); Reset takes it all away.
 */
function InitSection({ script, names, problems, onEdit }: { script: UserScript; names: ReadonlyMap<string, number>; problems: readonly ScriptProblem[]; onEdit: ScriptsViewProps['onEdit'] }) {
  const init = script.init ?? {};
  const p = init.p ?? SCRIPT_P;
  const zp = init.zp ?? [];
  const save = (next: ScriptInit, label: string) => onEdit(script.id, { init: tidyInit(next) ?? undefined }, label);
  /** the program's names in the zero page, by address (what the address of a zero-page init shows) */
  const zpNames = useMemo(() => { const m = new Map<number, string>(); for (const [n, a] of names) if (a < 0x100 && !m.has(a)) m.set(a, n); return m; }, [names]);
  const addZp = () => {
    const used = new Set(zp.flatMap(z => (z.word ? [z.at, z.at + 1] : [z.at])));
    const last = zp[zp.length - 1];
    const free = (a: number) => a >= 0 && a <= 0xff && !used.has(a);
    const at = [last ? last.at + (last.word ? 2 : 1) : -1, 0xfb, 0xfc, 0xfd, 0xfe, 0x02].find(free) ?? [...Array(0x100).keys()].find(free);
    if (at == null) return;
    save({ ...init, zp: [...zp, { at, value: 0 }] }, `Add zero-page byte $${h2(at)} to the init of "${script.name}"`);
  };
  return (
    <section className="scr-sec scr-init" aria-label="Init">
      <h4 title="What each run starts with: the registers, the flags and zero-page bytes. Without them a run starts with A, X and Y 0 and only I set, like a SYS. The zero page is the program's: what is set here is there for the program's code the script calls too, and never goes into the program">
        Init<span className="grow" />
        {!initEmpty(script.init) && <button className="btn ghost small" onClick={() => save({}, `Reset the init of "${script.name}"`)} title="A, X and Y back to 0, only I set, and no zero-page bytes"><Icon name="undo" size={13} />Reset</button>}
        <button className="btn ghost small" onClick={addZp} title="A zero-page byte the run starts with (a word: a pointer, low byte first). The address and the value can be names of the program"><Icon name="plus" size={13} />Zero page</button>
      </h4>
      <div className="init-regs">
        {(['a', 'x', 'y'] as const).map(r => (
          <InitReg key={r} reg={r.toUpperCase()} value={init[r] ?? 0} names={names}
            onCommit={v => save({ ...init, [r]: v }, `Init ${r.toUpperCase()} = $${h2(v)} for "${script.name}"`)} />
        ))}
      </div>
      <div className="init-flags" role="group" aria-label="Flags at the start">
        <span className="init-lbl">Flags</span>
        {SCRIPT_FLAGS.map(f => {
          const on = (p & f.bit) !== 0;
          return <button key={f.name} className={cx('dbg-flag init-flag', on && 'on')} aria-pressed={on} aria-label={f.what}
            title={`${f.what} (${f.name}): ${on ? 'set' : 'clear'} when the run starts; a click ${on ? 'clears' : 'sets'} it${f.name === 'I' ? '. No interrupts come in a run in any case' : f.name === 'D' ? '. ADC and SBC then count in decimal' : ''}`}
            onClick={() => save({ ...init, p: p ^ f.bit }, `${on ? 'Clear' : 'Set'} ${f.what.toLowerCase()} at the start of "${script.name}"`)}>{f.name}</button>;
        })}
        <span className="init-p mono" title="The status register these flags make (N V - B D I Z C)">P=${h2(p | 0x20)}</span>
      </div>
      {zp.length > 0 && <div className="init-zp" role="table" aria-label="Zero page at the start">
        <div className="init-zp-row init-zp-head" role="row"><span>Address</span><span>Value</span><span>Size</span><span /></div>
        {zp.map((z, i) => (
          <InitZpRow key={`${script.id}-${i}`} z={z} name={zpNames.get(z.at)} names={names}
            bad={problems.some(x => x.zp === i && x.level === 'error')} warn={problems.some(x => x.zp === i && x.level === 'warning')}
            onChange={q => save({ ...init, zp: zp.map((x, j) => (j === i ? q : x)) }, `Change zero-page $${h2(q.at)} in the init of "${script.name}"`)}
            onRemove={() => save({ ...init, zp: zp.filter((_, j) => j !== i) }, `Remove zero-page $${h2(z.at)} from the init of "${script.name}"`)} />
        ))}
      </div>}
    </section>
  );
}

/** A register of Init: its value as `$xx`; a number or `<name` / `>name` typed, Enter or leaving it keeps it. */
function InitReg({ reg, value, names, onCommit }: { reg: string; value: number; names: ReadonlyMap<string, number>; onCommit: (v: number) => void }) {
  const shown = '$' + h2(value);
  const [t, setT] = useState(shown);
  useEffect(() => setT(shown), [shown]);
  const commit = () => {
    const v = initValue(t, names);
    if (v == null || v > 0xff) { setT(shown); return; }
    if (v !== value) onCommit(v); else setT(shown);
  };
  return (
    <label className="init-reg" title={`${reg} when the run starts: a byte ($ff, 255, %1010, or <label / >label for a half of a label's address)`}>
      <span>{reg}</span>
      <input aria-label={`Init ${reg}`} className="mono" value={t} onChange={e => setT(e.target.value)} onBlur={commit} onFocus={e => e.target.select()}
        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setT(shown); (e.target as HTMLInputElement).blur(); } }} />
    </label>
  );
}

/** A zero-page byte or word of Init: its address (shown by the program's name for it), its value and its size. A value
 *  past $ff makes it a word; a word cannot start at $ff. */
function InitZpRow({ z, name, names, bad, warn, onChange, onRemove }: { z: ScriptZpInit; name?: string; names: ReadonlyMap<string, number>; bad: boolean; warn: boolean; onChange: (z: ScriptZpInit) => void; onRemove: () => void }) {
  const atText = name ?? '$' + h2(z.at), valText = '$' + (z.word ? h4(z.value) : h2(z.value));
  const [at, setAt] = useState(atText), [val, setVal] = useState(valText);
  useEffect(() => { setAt(atText); setVal(valText); }, [atText, valText]);
  const back = () => { setAt(atText); setVal(valText); };
  const commit = () => {
    const a = initValue(at, names), v = initValue(val, names);
    if (a == null || a > 0xff || v == null) { back(); return; }
    const word = !!z.word || v > 0xff;
    if (word && a > 0xfe) { back(); return; }
    const q: ScriptZpInit = { at: a, value: v, ...(word ? { word: true } : {}) };
    if (q.at === z.at && q.value === z.value && !!q.word === !!z.word) { back(); return; }
    onChange(q);
  };
  const key = (e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { back(); (e.target as HTMLInputElement).blur(); } };
  return (
    <div className={cx('init-zp-row', bad && 'bad', !bad && warn && 'warn')} role="row">
      <input aria-label="Zero-page address" className="mono" value={at} onChange={e => setAt(e.target.value)} onBlur={commit} onKeyDown={key} onFocus={e => e.target.select()}
        title={`$${h2(z.at)}${name ? ` (${name})` : ''}${z.word ? ` and $${h2(z.at + 1)}` : ''}: a zero-page address, $00-$ff, or a name of the program's zero page`} />
      <input aria-label="Zero-page value" className="mono" value={val} onChange={e => setVal(e.target.value)} onBlur={commit} onKeyDown={key} onFocus={e => e.target.select()}
        title={z.word ? `A word, low byte at $${h2(z.at)} ($${h2(z.value & 0xff)}) and high byte at $${h2(z.at + 1)} ($${h2(z.value >> 8)}): a number or a label (its address)` : 'A byte: a number, or <label / >label; a label or a value past $ff makes it a word'} />
      <select aria-label="Zero-page size" value={z.word ? 'word' : 'byte'} title="A byte, or a word (two bytes, low byte first: a pointer)"
        onChange={e => { const w = e.target.value === 'word'; if (w && z.at > 0xfe) { back(); return; } onChange({ at: z.at, value: w ? z.value : z.value & 0xff, ...(w ? { word: true } : {}) }); }}>
        <option value="byte">byte</option><option value="word">word</option>
      </select>
      <button className="icon-btn" aria-label={`Remove zero-page $${h2(z.at)}`} title="Remove it: the run finds what the program has there" onClick={onRemove}><Icon name="x" size={13} /></button>
    </div>
  );
}

function PadRow({ pad, on, bad, warn, onShow, onChange, onRemove }: { pad: ScriptPad; on: boolean; bad: boolean; warn: boolean; onShow: () => void; onChange: (p: ScriptPad) => void; onRemove: () => void }) {
  const [name, setName] = useState(pad.name), [start, setStart] = useState($(pad.start)), [size, setSize] = useState($(pad.size)), [fill, setFill] = useState('$' + h2(pad.fill ?? 0));
  useEffect(() => { setName(pad.name); setStart($(pad.start)); setSize($(pad.size)); setFill('$' + h2(pad.fill ?? 0)); }, [pad]);
  const num = (t: string) => { const s = t.trim(); return /^\$[0-9a-f]+$/i.test(s) ? parseInt(s.slice(1), 16) : /^[0-9]+$/.test(s) ? parseInt(s, 10) : NaN; };
  const commit = () => {
    const a = num(start), n = num(size), f = num(fill);
    if (!(a >= 0 && a <= 0xffff) || !(n >= 1 && a + n <= 0x10000) || !(f >= 0 && f <= 255) || !name.trim()) { setName(pad.name); setStart($(pad.start)); setSize($(pad.size)); setFill('$' + h2(pad.fill ?? 0)); return; }
    // its start content goes with it (written in Kick Assembler, ScriptSide assembles it again where it is now)
    const q: ScriptPad = { name: name.trim(), start: a, size: n, ...(f ? { fill: f } : {}), ...(pad.data ? { data: pad.data } : {}), ...(pad.src ? { src: pad.src } : {}) };
    if (q.name === pad.name && q.start === pad.start && q.size === pad.size && (q.fill ?? 0) === (pad.fill ?? 0)) return;
    // what the last run left belongs to the old place and size
    onChange(q.start === pad.start && q.size === pad.size && pad.bytes ? { ...q, bytes: pad.bytes } : q);
  };
  const key = (e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); };
  return (
    <div className={cx('pad-row', on && 'on', bad && 'bad', !bad && warn && 'warn')} role="row" onClick={onShow}>
      <input aria-label="Scratchpad name" value={name} onChange={e => setName(e.target.value)} onBlur={commit} onKeyDown={key} onFocus={onShow} title="Its name is a label in the code (and name_end the address after it)" />
      <input aria-label="Scratchpad address" className="mono" value={start} onChange={e => setStart(e.target.value)} onBlur={commit} onKeyDown={key} onFocus={onShow} title="Where it is in memory while the script runs: over the program's bytes there, if any" />
      <input aria-label="Scratchpad size" className="mono" value={size} onChange={e => setSize(e.target.value)} onBlur={commit} onKeyDown={key} onFocus={onShow} title="How many bytes ($100 or 256)" />
      <input aria-label="Scratchpad fill" className="mono" value={fill} onChange={e => setFill(e.target.value)} onBlur={commit} onKeyDown={key} onFocus={onShow} title="The byte it holds when a run starts" />
      <button className="icon-btn" aria-label={`Remove scratchpad ${pad.name}`} title="Remove the scratchpad" onClick={e => { e.stopPropagation(); onRemove(); }}><Icon name="x" size={13} /></button>
    </div>
  );
}

/** a scratchpad while the script is debugged: its bytes as the run has them now, and before the last step */
interface LivePad { name: string; bytes: Uint8Array; before: Uint8Array | null }

/** The right of the output: a scratchpad's bytes, or a change the script made in the program, as hex, code or text,
 *  with what can be done with them. While debugging, the scratchpad as the run has it now (`live`), the bytes the last
 *  step changed marked in the hex. A scratchpad that has not run (or whose start content changed since) shows what a
 *  run starts it with; Edit sets that, Copy to copies it to another scratchpad (or a new one), and Compare sets it
 *  against another scratchpad or its start with a heat map. */
function PadView({ script, mine, would, names, mode, screen, live, theme, onMode, onScreen, onShow, onCopy, onSave, onSaveText, onEdit, onMenu, placePad, toast }: {
  script: UserScript; mine: Patch[]; would: Patch[]; names: ReadonlyMap<string, number>; mode: PadMode; screen: boolean; live: LivePad | null; theme: string; onMode: (m: PadMode) => void; onScreen: (v: boolean) => void;
  onShow: ScriptsViewProps['onShow']; onCopy: ScriptsViewProps['onCopy']; onSave: ScriptsViewProps['onSave']; onSaveText: ScriptsViewProps['onSaveText'];
  onEdit: ScriptsViewProps['onEdit']; onMenu: ScriptsViewProps['onMenu']; placePad: (size: number, near?: Addr) => Addr; toast: ScriptsViewProps['toast'];
}) {
  const { shown, cmpWith, set } = useScripts();
  const [editing, setEditing] = useState<string | null>(null);
  // 16 bytes a hex row where they fit, else 8
  const [wide, setWide] = useState(true);
  const [view, setView] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!view || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setWide(view.clientWidth >= 560)); ro.observe(view); setWide(view.clientWidth >= 560);
    return () => ro.disconnect();
  }, [view]);
  const patch = shown.kind === 'patch' ? mine.find(p => p.id === shown.id) : shown.kind === 'would' ? would[shown.i] : undefined;
  // a change the last run (in safe mode) would make: not in the program
  const preview = shown.kind === 'would' && !!patch;
  const pad = !patch ? (shown.kind === 'pad' ? script.pads[shown.i] : undefined) ?? script.pads[0] : undefined;
  const pi = pad ? script.pads.indexOf(pad) : -1;
  const now = !patch && pad && live && live.name === pad.name && live.bytes.length === pad.size ? live : null;
  // a scratchpad without a run's bytes: what a run starts it with
  const atStart = !patch && !!pad && !now && !(pad.bytes && pad.bytes.length === pad.size);
  const startBytes = useMemo(() => (pad ? padStart(pad) : null), [pad]);
  const bytes = patch ? patch.bytes : now ? now.bytes : pad ? (atStart ? startBytes : pad.bytes!) : null;
  const at = patch ? patch.start : pad?.start ?? 0;
  const showAs = mode === 'compare' && !pad ? 'hex' : mode;
  // what Compare sets the scratchpad against: the scratchpad picked (by name), else its start, else the first other
  const others = pad ? script.pads.filter(p => p !== pad) : [];
  const vs = cmpWith === '@start' || others.some(p => p.name === cmpWith) ? cmpWith! : others[0]?.name ?? '@start';
  const vsPad = vs === '@start' ? null : others.find(p => p.name === vs) ?? null;
  const vsBytes = useMemo(() => (!pad ? null : vsPad ? padNow(vsPad) : startBytes), [pad, vsPad, startBytes]);
  /** the scratchpad's bytes as shown, copied to scratchpad `j` (its start content, cut to its size) or to a new one */
  const copyTo = (j: number | null) => {
    if (!pad || !bytes) return;
    const from = bytes.slice();
    if (j == null) {
      const name = padName(script.pads), start = placePad(pad.size, pad.start + pad.size);
      onEdit(script.id, { pads: [...script.pads, { name, start, size: pad.size, ...(pad.fill ? { fill: pad.fill } : {}), data: from }] }, `Copy scratchpad ${pad.name} to a new one, ${name}`);
      toast(`${pad.name} copied to the new scratchpad ${name} at $${h4(start)}: a run starts it with these ${from.length} bytes`, 'ok');
      return;
    }
    const t = script.pads[j], { bytes: _b, src: _s, ...keep } = t;
    onEdit(script.id, { pads: script.pads.map((x, k) => (k === j ? { ...keep, data: from.slice(0, t.size) } : x)) }, `Copy scratchpad ${pad.name} to ${t.name}`);
    toast(`${pad.name} copied to ${t.name}: a run starts it with ${from.length > t.size ? `the first ${t.size} of the ${from.length} bytes (it holds no more)` : `these ${from.length} bytes`}`, from.length > t.size ? 'warn' : 'ok');
  };
  /** what the editor set: the scratchpad's start content and how it was written; what the last run left goes (a run
   *  starts from this now) */
  const setStart = (data: Uint8Array | null, src: ScriptPadSource | null) => {
    if (!pad) return;
    const { bytes: _b, data: _d, src: _s, ...keep } = pad;
    onEdit(script.id, { pads: script.pads.map((x, k) => (k === pi ? { ...keep, ...(data ? { data } : {}), ...(src ? { src } : {}) } : x)) },
      data ? `Set what scratchpad ${pad.name} starts with` : `Clear what scratchpad ${pad.name} starts with`);
    setEditing(null);
  };
  const byAddr = useMemo(() => { const m = new Map<number, string>(); for (const [n, a] of names) if (!m.has(a)) m.set(a, n); return m; }, [names]);
  // the bytes the last step changed: their rows of the hex written with the bytes marked
  const before = now?.before && now.before.length === now.bytes.length ? now.before : null;
  const marked = useMemo(() => {
    if (!bytes || !before || showAs !== 'hex' || !bytes.some((b, i) => b !== before[i])) return null;
    const per = wide ? 16 : 8, out: React.ReactNode[] = [];
    for (let i = 0; i < bytes.length; i += per) {
      const row = Array.from(bytes.subarray(i, i + per)), chars = row.map(b => monitorChar(b, screen)?.ch ?? '.').join('');
      if (!row.some((b, j) => b !== before[i + j])) { out.push(`${$(at + i)}  ${row.map(b => h2(b)).join(' ').padEnd(per * 3 - 1)}  ${chars}\n`); continue; }
      out.push(<span key={i}>{`${$(at + i)}  `}{row.flatMap((b, j) => [j ? ' ' : '', <span key={j} className={b !== before[i + j] ? 'pad-chg' : undefined}>{h2(b)}</span>])}{' '.repeat(per * 3 - 1 - (row.length * 3 - 1))}{`  ${chars}\n`}</span>);
    }
    return out;
  }, [bytes, before, at, showAs, screen, wide]);
  const text = useMemo(() => {
    if (!bytes || showAs === 'compare') return '';
    const out: string[] = [];
    if (showAs === 'code') for (const l of disassembleBytes(bytes, at, byAddr)) out.push(`${$(l.a)}  ${Array.from(bytes.subarray(l.a - at, l.a - at + l.n), b => h2(b)).join(' ').padEnd(9)} ${byAddr.has(l.a) ? `${byAddr.get(l.a)}: ` : ''}${l.text}`);
    else {
      const per = showAs === 'hex' ? (wide ? 16 : 8) : 32;
      for (let i = 0; i < bytes.length; i += per) {
        const row = Array.from(bytes.subarray(i, i + per));
        const chars = row.map(b => monitorChar(b, screen)?.ch ?? '.').join('');
        out.push(showAs === 'hex' ? `${$(at + i)}  ${row.map(b => h2(b)).join(' ').padEnd(per * 3 - 1)}  ${chars}` : `${$(at + i)}  ${chars}`);
      }
    }
    return out.join('\n');
  }, [bytes, at, showAs, screen, byAddr, wide]);
  // the editor is for the scratchpad it was opened on
  const isEditing = !!pad && editing === `${script.id}/${pi}`;
  // which scratchpads the last run changed (a dot on their buttons)
  const changed = useMemo(() => script.pads.map(p => {
    if (!p.bytes || p.bytes.length !== p.size) return false;
    const s = padStart(p);
    for (let i = 0; i < p.size; i++) if (p.bytes[i] !== s[i]) return true;
    return false;
  }), [script.pads]);
  /** a button for each scratchpad, when there are two or more: a click shows it */
  const tabs = script.pads.length > 1 && (
    <div className="scr-pad-tabs" role="tablist" aria-label="Scratchpads to show">
      {script.pads.map((p, i) => {
        const on = !patch && p === pad;
        return <button key={p.name + i} role="tab" aria-selected={on} className={cx('scr-pad-tab', on && 'on')} onClick={() => { if (!on) set({ shown: { kind: 'pad', i } }); }}
          title={`Show ${p.name}: ${rangeText({ start: p.start, end: p.start + p.size })}, ${p.size} bytes${changed[i] ? ' · the last run changed it' : ''}`}>
          <span className="scr-pad-tab-name">{p.name}</span>{changed[i] && <span className="scr-pad-tab-dot" aria-label="changed by the last run" />}</button>;
      })}
    </div>
  );
  if (!pad && !patch) return <div className="scr-view" ref={setView}><div className="empty small">Run the script: what it changes in the program shows here. A scratchpad (Add) keeps data outside the program.</div></div>;
  const title = patch ? `${patch.name} · ${rangeText({ start: patch.start, end: patchEnd(patch) })} · ${plural(patch.bytes.length, 'byte')}${patch.off ? ' · left out' : ''}` : `${pad!.name} · ${rangeText({ start: pad!.start, end: pad!.start + pad!.size })} · ${pad!.size} bytes`;
  const fileName = `${script.name}_${patch ? h4(patch.start) : pad!.name}`.replace(/[^A-Za-z0-9_.-]+/g, '_');
  const differ = patch ? patch.bytes.reduce((n, b, i) => n + (b !== patch.old[i] ? 1 : 0), 0) : 0;
  return (
    <div className="scr-view" ref={setView}>
      {tabs}
      <div className="scr-view-head">
        <b className="scr-view-title">{title}</b>
        {now && <span className="pill mid scr-live" title="Debugging: the scratchpad as the run has it now; what the last step changed is marked in the hex">now, as the run has it</span>}
        {preview && <span className="pill scr-live scr-would-pill" title="Safe mode: the last run would write these bytes here; the program still has its own (Write into the program puts these in)"><Icon name="shield" size={11} />would change: not in the program</span>}
        {patch && <span className="muted small" title={`The program had: ${Array.from(patch.old.subarray(0, 64), b => h2(b)).join(' ')}${patch.old.length > 64 ? ' …' : ''}`}>{differ} differ from the original</span>}
        {atStart && !isEditing && <span className="pill scr-start-pill" title={pad!.data?.length ? `What a run starts it with: ${pad!.data.length} bytes set (Edit), the rest its fill. It has not run since` : 'What a run starts it with: its fill (Edit sets what it holds)'}>at the start{pad!.data?.length ? ` · ${pad!.data.length} set` : ''}</span>}
        <span className="grow" />
        {isEditing ? <span className="pill mid scr-edit-pill">editing the start</span> : <>
          {pad && <button className="btn small ghost scr-pad-edit-btn" onClick={() => setEditing(`${script.id}/${pi}`)} title="Set what the scratchpad holds when a run starts: Kick Assembler (code and data), hex or text"><Icon name="pencil" size={13} /><span className="lbl">Edit start</span></button>}
          <div className="seg" role="group" aria-label="Show as">
            {(['hex', 'code', 'text', ...(pad ? ['compare' as const] : [])] as const).map(m => <button key={m} className={cx(showAs === m && 'on')} aria-pressed={showAs === m} onClick={() => onMode(m)}
              title={m === 'compare' ? 'Set the scratchpad against another one, or against what a run starts it with: a heat map shows where the bytes differ' : undefined}>{m === 'hex' ? 'Hex' : m === 'code' ? 'Code' : m === 'text' ? 'Text' : 'Compare'}</button>)}
          </div>
          {showAs === 'compare' ? <select className="scr-cmp-with" aria-label="Compare with" value={vs} onChange={e => set({ cmpWith: e.target.value })} title="What the scratchpad is set against">
            {others.map(p => <option key={p.name} value={p.name}>with {p.name}</option>)}
            <option value="@start">with its start</option>
          </select>
            : showAs !== 'code' && <div className="seg" role="group" aria-label="Text as"><button className={cx(!screen && 'on')} aria-pressed={!screen} onClick={() => onScreen(false)} title="The bytes as PETSCII">PETSCII</button><button className={cx(screen && 'on')} aria-pressed={screen} onClick={() => onScreen(true)} title="The bytes as screen codes">Screen</button></div>}
        </>}
      </div>
      {isEditing ? <PadEditor key={`${script.id}/${pi}`} pad={pad!} names={names} onSet={setStart} onCancel={() => setEditing(null)} />
        : showAs === 'compare' && bytes && vsBytes ? <PadCompare a={bytes} b={vsBytes} aName={pad!.name} bName={vsPad ? vsPad.name : 'start'} at={at} theme={theme} />
        : bytes ? <pre className="scr-dump mono" aria-label={`${title} as ${showAs}`}>{marked ?? text}</pre>
        : <div className="empty small">Empty until the script runs: Run fills it.</div>}
      {bytes && !isEditing && <div className="scr-view-actions">
        <button className="btn small" onClick={() => onCopy(byteLines(bytes).join('\n'), `${bytes.length} bytes as .byte lines`)} title="Copy the bytes as Kick Assembler .byte lines"><Icon name="copy" size={13} /><span className="lbl">Copy as .byte</span></button>
        {patch ? <>
          <span className="grow" />
          <button className="btn small" onClick={() => onShow(patch.start, patchEnd(patch))} title="Select these bytes in the listing"><Icon name="target" size={13} /><span className="lbl">Show in listing</span></button>
        </> : <>
          <button className="btn small scr-copy-to" onClick={e => {
            if (!others.length) { copyTo(null); return; }
            const r = e.currentTarget.getBoundingClientRect();
            onMenu(r.left, r.bottom + 2, [
              { header: `Copy ${pad!.name} to` },
              ...script.pads.flatMap((p, j): MenuItem[] => (p === pad ? [] : [{ label: `${p.name} ($${h4(p.start)}, ${p.size} bytes)${p.size < bytes.length ? ': only its first bytes' : ''}`, run: () => copyTo(j) }])),
              { sep: true },
              { label: 'A new scratchpad (a copy)', run: () => copyTo(null) },
            ]);
          }} title={others.length ? 'Copy these bytes to another scratchpad, or to a new one: a run starts it with them' : 'Copy these bytes to a new scratchpad: a run starts it with them'}><Icon name="copy" size={13} /><span className="lbl">{others.length ? 'Copy to…' : 'Copy to a new pad'}</span></button>
          {showAs !== 'compare' && <button className="btn small" onClick={() => onSaveText(`${fileName}.txt`, showAs === 'text' ? logText(bytes, pad!.fill ?? 0, screen) : text + '\n')}
            title={showAs === 'text' ? `Save the text as a log file: ${screen ? 'screen codes, 40 to a line' : 'PETSCII, a line to each RETURN ($0d)'}, without the fill after it` : `Save what is shown (${showAs === 'hex' ? 'the hex dump' : 'the code'}) as a text file`}><Icon name="download" size={13} /><span className="lbl">Save </span>.txt…</button>}
          <button className="btn small" onClick={() => onSave(`${fileName}.bin`, bytes, false, at)} title="Save the bytes as a binary file"><Icon name="download" size={13} /><span className="lbl">Save </span>.bin…</button>
          <button className="btn small" onClick={() => onSave(`${fileName}.prg`, bytes, true, at)} title={`Save the bytes as a PRG that loads at $${h4(at)}`}><Icon name="download" size={13} /><span className="lbl">Save </span>.prg…</button>
        </>}
      </div>}
    </div>
  );
}
