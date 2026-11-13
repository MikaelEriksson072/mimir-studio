/* Source view — Monaco (bundled locally) with the Kick Assembler language; cursor sync with the
 * listing through the shared line model; Kick Assembler errors as markers. The build scripts can be edited: the
 * project keeps the user's version and the export writes it. */
import { useEffect, useMemo, useRef, useState } from 'react';
import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api';
import { BUILD_SCRIPTS, lineText, type Addr, type AnalysisResult, type BuildScript, type KickProblem, type Line, type RenderResult, type Settings, type Vfs } from '@mimir/core';
import { Icon } from '../lib/icons';
import type { Changed, NavOptions } from '../lib/types';
import { LineBody, lineScriptMarks, scriptMarkTip, type ScriptMark } from './Listing';

type MonacoNs = typeof Monaco;

interface SourceViewProps {
  R: RenderResult; A: AnalysisResult; S: Settings; path: string; setPath: (p: string) => void; cursor: Addr | null;
  onNavigate: (a: Addr, o?: NavOptions) => void; theme: string; extraFiles: Vfs; problems: KickProblem[];
  onCopy: (text: string | undefined) => void; onExport: () => void;
  /** the build scripts the user edited (Project.scripts), and how an edit (null: back to generated) is kept */
  scripts: Partial<Record<BuildScript, string>>; onEditScript: (path: BuildScript, text: string | null) => void;
  /** a block whose type just changed: its lines are marked a moment */
  changed?: Changed | null;
  /** a new value opens Monaco's find (Ctrl+F outside the editor) */
  findReq?: number;
  /** the scripts at each address (spec 10.3), marked after their lines; a click on a mark opens its script */
  scriptMarks?: ReadonlyMap<Addr, ScriptMark[]>;
  onScriptMark?: (id: string, line?: number) => void;
  /** a right-click's "Link to a script": the menu that links address `a` to a script, at the pointer */
  onLinkMenu?: (a: Addr, x: number, y: number) => void;
  /** the menu that copies the program's bytes start..end (the selected lines') into a script's scratchpad */
  onPadMenu?: (start: Addr, end: Addr, x: number, y: number) => void;
}

const isScript = (p: string): p is BuildScript => (BUILD_SCRIPTS as readonly string[]).includes(p);

const languageOf = (p: string) => p.endsWith('.asm') ? 'kickass' : p.endsWith('.md') ? 'markdown' : p.endsWith('.sh') ? 'shell' : p.endsWith('.bat') ? 'bat' : 'plaintext';

/** the address a script can be linked to at a place in a source file: the name under the pointer when it is one of the
 *  program's (a label, a zero-page variable), else the line's (its label, its .label line's, its first byte) */
function linkAddrAt(R: RenderResult, line: Line | undefined, word: string | null): Addr | null {
  // the names the files have (with a view offset the listing's differ, spec 10.4)
  const labels = R.fileLabels ?? R.labels;
  if (word) {
    for (const [a, l] of labels) if (l.name === word) return a;
    for (const [a, z] of R.zp) if (!z.off && z.name === word) return a;
  }
  if (!line) return null;
  if (line.k === 'dir' && line.tok[0]?.s === '.label') {
    if (line.zp != null) return line.zp;
    const def = line.tok.find(t => t.t === 'def');
    if (def) for (const [a, l] of labels) if (l.name === def.s) return a;
    return null;
  }
  return line.k === 'lbl' || ('n' in line && line.n > 0) ? line.a : null;
}

export function SourceView({ R, A, S, path, setPath, cursor, onNavigate, theme, extraFiles, problems, onCopy, onExport, scripts, onEditScript, changed, findReq = 0, scriptMarks, onScriptMark, onLinkMenu, onPadMenu }: SourceViewProps) {
  const host = useRef<HTMLDivElement>(null);
  const monacoRef = useRef<MonacoNs | null>(null);
  const ed = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const deco = useRef<Monaco.editor.IEditorDecorationsCollection | null>(null);
  const changedDeco = useRef<Monaco.editor.IEditorDecorationsCollection | null>(null);
  const models = useRef<Record<string, Monaco.editor.ITextModel>>({});
  const edPath = useRef<string>('');
  const [state, setState] = useState<'loading' | 'ready' | 'fallback'>('loading');
  const [err, setErr] = useState('');
  const textFiles = useMemo(() => {
    const all: Vfs = { ...R.files, ...extraFiles };
    return Object.keys(all).filter(k => typeof all[k] === 'string').sort((a, b) => (a.endsWith('.asm') ? 0 : 1) - (b.endsWith('.asm') ? 0 : 1) || a.localeCompare(b)).map(k => ({ path: k, text: all[k] as string }));
  }, [R, extraFiles]);
  const cur = textFiles.find(f => f.path === path) || textFiles[0];
  const suppress = useRef(false);
  const onNavigateRef = useRef(onNavigate); onNavigateRef.current = onNavigate;
  const rRef = useRef(R); rRef.current = R;
  const linkRef = useRef(onLinkMenu); linkRef.current = onLinkMenu;
  const padRef = useRef(onPadMenu); padRef.current = onPadMenu;
  const markRef = useRef(onScriptMark); markRef.current = onScriptMark;
  const ctxAt = useRef<{ x: number; y: number } | null>(null);
  /** the scripts marked after each line of the file shown (by line number) */
  const markLines = useRef(new Map<number, ScriptMark[]>());
  const marksDeco = useRef<Monaco.editor.IEditorDecorationsCollection | null>(null);
  // typing in a build script is kept in the project a moment after the last key, and at once on leaving the file
  const onEditRef = useRef(onEditScript); onEditRef.current = onEditScript;
  const pending = useRef<{ path: BuildScript; timer: ReturnType<typeof setTimeout> } | null>(null);
  const applying = useRef(false);
  const flush = () => {
    const p = pending.current; if (!p) return;
    clearTimeout(p.timer); pending.current = null;
    const m = models.current[p.path]; if (m) onEditRef.current(p.path, m.getValue());
  };

  useEffect(() => {
    let alive = true;
    import('../monaco/setup').then(async ({ monaco }) => {
      if (!alive || !host.current) return;
      const { applyMonacoTheme } = await import('../monaco/theme');
      monacoRef.current = monaco;
      applyMonacoTheme(monaco, document.documentElement.dataset.theme !== 'light');
      const editor = monaco.editor.create(host.current, {
        value: '', language: 'kickass', theme: 'mimir', readOnly: true, automaticLayout: true, fontFamily: "'JetBrains Mono', ui-monospace, Consolas, monospace",
        fontSize: 13, lineHeight: 20, minimap: { enabled: true, scale: 1, renderCharacters: false }, scrollBeyondLastLine: false, renderLineHighlight: 'all',
        smoothScrolling: true, padding: { top: 8 }, guides: { indentation: false }, stickyScroll: { enabled: false }, mouseWheelZoom: true,
      });
      ed.current = editor;
      deco.current = editor.createDecorationsCollection();
      changedDeco.current = editor.createDecorationsCollection();
      editor.onDidChangeCursorPosition(ev => {
        if (suppress.current || ev.source === 'api') return;
        const lines = rRef.current.fileLines[edPath.current];
        const l = lines && lines[ev.position.lineNumber - 1];
        if (l && l.a != null && (('n' in l && l.n > 0) || l.k === 'lbl')) onNavigateRef.current(l.a, { fromSource: true });
      });
      // a right-click's Link to a script (spec 10.3): the name under the pointer, else the line's; the menu opens where
      // the editor's menu was
      editor.onContextMenu(ev => { ctxAt.current = { x: ev.event.posx, y: ev.event.posy }; });
      editor.addAction({
        id: 'mimir.link-script', label: 'Link to a script…', contextMenuGroupId: 'navigation', contextMenuOrder: 0,
        run: e => {
          const pos = e.getPosition(), m = e.getModel(); if (!pos || !m) return;
          const a = linkAddrAt(rRef.current, rRef.current.fileLines[edPath.current]?.[pos.lineNumber - 1], m.getWordAtPosition(pos)?.word ?? null);
          if (a == null) return;
          let at = ctxAt.current;
          if (!at) { const v = e.getScrolledVisiblePosition(pos), r = e.getDomNode()?.getBoundingClientRect(); at = { x: (r?.left ?? 0) + (v?.left ?? 0), y: (r?.top ?? 0) + (v?.top ?? 0) + 20 }; }
          ctxAt.current = null;
          linkRef.current?.(a, at.x, at.y);
        },
      });
      // a right-click's Copy into a scratchpad (spec 10.3): the bytes of the lines selected (else the line's)
      editor.addAction({
        id: 'mimir.copy-to-pad', label: 'Copy into a scratchpad…', contextMenuGroupId: 'navigation', contextMenuOrder: 0.5,
        run: e => {
          const sel = e.getSelection(), lines = rRef.current.fileLines[edPath.current]; if (!sel || !lines) return;
          // a selection of whole lines ends at the start of the line after them
          const last = sel.endColumn === 1 && sel.endLineNumber > sel.startLineNumber ? sel.endLineNumber - 1 : sel.endLineNumber;
          let lo = Infinity, hi = -1;
          for (let n = sel.startLineNumber; n <= last; n++) {
            const l = lines[n - 1];
            if (l && l.a != null && 'n' in l && l.n > 0) { lo = Math.min(lo, l.a); hi = Math.max(hi, l.a + l.n); }
          }
          if (hi < 0) return;
          let at = ctxAt.current;
          if (!at) { const v = e.getScrolledVisiblePosition(sel.getStartPosition()), r = e.getDomNode()?.getBoundingClientRect(); at = { x: (r?.left ?? 0) + (v?.left ?? 0), y: (r?.top ?? 0) + (v?.top ?? 0) + 20 }; }
          ctxAt.current = null;
          padRef.current?.(lo, hi, at.x, at.y);
        },
      });
      // a click on a script's mark after a line opens the script
      editor.onMouseDown(ev => {
        const el = ev.target.element as HTMLElement | null, n = ev.target.position?.lineNumber;
        if (!el?.closest?.('.mon-script-tag') || !n || !ev.event.leftButton) return;
        const ms = markLines.current.get(n);
        if (ms) { ev.event.preventDefault(); markRef.current?.(ms[0].id, ms[0].line); }
      });
      editor.onDidChangeModelContent(() => {
        const p = edPath.current;
        if (applying.current || !isScript(p)) return;
        if (pending.current) clearTimeout(pending.current.timer);
        pending.current = { path: p, timer: setTimeout(flush, 400) };
      });
      if (document.fonts?.ready) void document.fonts.ready.then(() => monaco.editor.remeasureFonts());
      setState('ready');
    }).catch(e => { if (alive) { setErr(String((e as Error)?.message || e)); setState('fallback'); } });
    return () => { alive = false; flush(); ed.current?.dispose(); Object.values(models.current).forEach(m => m.dispose()); models.current = {}; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const monaco = monacoRef.current;
    if (state === 'ready' && monaco) void import('../monaco/theme').then(({ applyMonacoTheme }) => applyMonacoTheme(monaco, theme !== 'light'));
  }, [theme, state]);

  useEffect(() => {
    void import('../monaco/providers').then(({ monacoContext }) => { monacoContext.R = R; monacoContext.A = A; });
  }, [R, A]);

  useEffect(() => {
    const monaco = monacoRef.current, e = ed.current;
    if (state !== 'ready' || !cur || !monaco || !e) return;
    if (pending.current && pending.current.path !== cur.path) flush();
    let m = models.current[cur.path];
    if (!m) { m = monaco.editor.createModel(cur.text, languageOf(cur.path), monaco.Uri.parse('file:///' + cur.path)); models.current[cur.path] = m; }
    else if (m.getValue() !== cur.text && pending.current?.path !== cur.path) {
      // a change from outside (settings, undo, Restore generated): not an edit of the user's
      const vs = e.saveViewState(); applying.current = true; m.setValue(cur.text); applying.current = false; if (e.getModel() === m && vs) e.restoreViewState(vs);
    }
    if (e.getModel() !== m) e.setModel(m);
    edPath.current = cur.path;
    e.updateOptions({ readOnly: !isScript(cur.path) });
  }, [state, cur?.path, cur?.text]); // eslint-disable-line react-hooks/exhaustive-deps

  // Kick Assembler errors as editor markers
  useEffect(() => {
    const monaco = monacoRef.current;
    if (state !== 'ready' || !monaco) return;
    for (const [p, m] of Object.entries(models.current)) {
      monaco.editor.setModelMarkers(m, 'kickass', problems.filter(pr => pr.file === p && pr.line > 0).map(pr => ({
        severity: pr.severity === 'error' ? monaco.MarkerSeverity.Error : monaco.MarkerSeverity.Warning,
        message: `Kick Assembler: ${pr.message}`, startLineNumber: pr.line, startColumn: Math.max(1, pr.column), endLineNumber: pr.line, endColumn: m.getLineMaxColumn(Math.min(pr.line, m.getLineCount())),
      })));
    }
  }, [problems, state, cur?.path, cur?.text]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const monaco = monacoRef.current, e = ed.current;
    if (state !== 'ready' || !cur || cursor == null || !monaco || !e) return;
    const lines = R.fileLines[cur.path]; if (!lines) return;
    const idx = lines.findIndex(l => 'n' in l && l.n > 0 && cursor >= l.a && cursor < l.a + l.n);
    if (idx < 0) return;
    deco.current?.set([{ range: new monaco.Range(idx + 1, 1, idx + 1, 1), options: { isWholeLine: true, className: 'mon-cur', linesDecorationsClassName: 'mon-cur-gut' } }]);
    // the editor just shown has no size until its observer measures it, a frame later: measured now, so the line is
    // shown at once (and without the smooth scroll, which needs the window to draw frames)
    if (!e.getLayoutInfo().height) e.layout();
    suppress.current = true;
    // the editor's own cursor goes to the line too (arrow keys go on from there), unless it is on a line of that
    // address already (a click or a selection in the editor moved the cursor here)
    const pos = e.getPosition(), on = pos ? lines[pos.lineNumber - 1] : undefined;
    if (!on || on.a == null || cursor < on.a || cursor >= on.a + Math.max(1, 'n' in on ? on.n : 0)) e.setPosition({ lineNumber: idx + 1, column: 1 });
    e.revealLineInCenterIfOutsideViewport(idx + 1, monaco.editor.ScrollType.Immediate); suppress.current = false;
  }, [state, cursor, cur?.path, R]); // eslint-disable-line react-hooks/exhaustive-deps

  // the scripts at the file's lines (spec 10.3): their name after the line, what each does with it in the hover
  useEffect(() => {
    const monaco = monacoRef.current, e = ed.current;
    if (state !== 'ready' || !cur || !monaco || !e) return;
    if (!marksDeco.current) marksDeco.current = e.createDecorationsCollection();
    const lines = scriptMarks?.size ? R.fileLines[cur.path] : undefined;
    const by = new Map<number, ScriptMark[]>();
    if (lines) for (let i = 0; i < lines.length; i++) { const ms = lineScriptMarks(lines, i, scriptMarks!, R.fileLabels ?? R.labels); if (ms) by.set(i + 1, ms); }
    markLines.current = by;
    const m = e.getModel(); if (!m) return;
    // the name goes after the line's text (Monaco draws no text injected at an empty range, so the range is the text)
    marksDeco.current.set([...by].filter(([n]) => n <= m.getLineCount() && m.getLineMaxColumn(n) > 1).map(([n, ms]) => {
      const end = m.getLineMaxColumn(n);
      return {
        range: new monaco.Range(n, 1, n, end),
        options: { hoverMessage: { value: scriptMarkTip(ms).replace(/\n/g, '  \n') }, after: { content: `  ⟩_ ${ms[0].name}${ms.length > 1 ? ` +${ms.length - 1}` : ''}`, inlineClassName: 'mon-script-tag', cursorStops: monaco.editor.InjectedTextCursorStops.None } },
      };
    }));
  }, [state, scriptMarks, cur?.path, cur?.text, R]); // eslint-disable-line react-hooks/exhaustive-deps

  // Ctrl+F outside the editor (or the Find button): Monaco's find widget, once the editor is there
  const findDone = useRef(findReq);
  const openFind = () => { const e = ed.current; if (!e) return; e.focus(); void e.getAction('actions.find')?.run(); };
  useEffect(() => { if (state === 'ready' && findReq !== findDone.current) { findDone.current = findReq; openFind(); } }, [findReq, state]); // eslint-disable-line react-hooks/exhaustive-deps

  // a block whose type just changed: from its header (and the lines above its first byte) to its last byte
  useEffect(() => {
    const monaco = monacoRef.current;
    if (state !== 'ready' || !cur || !monaco || !changedDeco.current) return;
    const lines = changed ? R.fileLines[cur.path] : undefined;
    let i0 = -1, i1 = -1;
    if (changed && lines) lines.forEach((l, i) => { if ('n' in l && l.n > 0 && l.a >= changed.start && l.a < changed.end) { if (i0 < 0) i0 = i; i1 = i; } });
    if (!changed || !lines || i0 < 0) { changedDeco.current.clear(); return; }
    while (i0 > 0 && lines[i0 - 1].a === changed.start && lines[i0 - 1].k !== 'blank') i0--;
    changedDeco.current.set([{ range: new monaco.Range(i0 + 1, 1, i1 + 1, 1), options: { isWholeLine: true, className: 'mon-changed', linesDecorationsClassName: 'mon-changed-gut' } }]);
  }, [state, changed, cur?.path, R]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="source">
      <div className="toolbar">
        <label htmlFor="src-file" className="sr-only">File</label>
        <select id="src-file" value={cur ? cur.path : ''} onChange={e => setPath(e.target.value)}>{textFiles.map(f => <option key={f.path} value={f.path}>{f.path}</option>)}</select>
        <span className="tb-note">{state === 'loading' ? 'Loading Monaco editor…' : state !== 'ready' ? 'Built-in viewer'
          : cur && isScript(cur.path) ? (scripts[cur.path] != null ? 'Edited by you · kept in the project · the export writes this version' : 'Editable · the export writes your version once you change it')
            : 'Monaco · Kick Assembler syntax · read-only (edit labels, comments and types in the listing)'}</span>
        <span className="grow" />
        {cur && isScript(cur.path) && scripts[cur.path] != null && <button className="btn" title="Throw away your edits: the export writes the generated script, which follows the toolchain settings, again" onClick={() => { if (pending.current) { clearTimeout(pending.current.timer); pending.current = null; } onEditScript(cur.path as BuildScript, null); }}><Icon name="undo" />Restore generated</button>}
        {state === 'ready' && <button className="btn" title="Find in the file (Ctrl+F); F3 / Shift+F3 go to the next and the one before" onClick={openFind}><Icon name="search" />Find</button>}
        <button className="btn" onClick={() => onCopy(cur?.text)}><Icon name="copy" />Copy file</button>
        <button className="btn primary" onClick={onExport}><Icon name="folder" />Export…</button>
      </div>
      {state === 'fallback' && <div className="notice">Monaco could not load ({err}). Showing the built-in highlighter instead; the generated code is identical.</div>}
      <div className="mon-host" ref={host} style={{ display: state === 'ready' ? 'block' : 'none' }} />
      {state !== 'ready' && cur && <FallbackCode path={cur.path} R={R} text={cur.text} S={S} />}
    </div>
  );
}

function FallbackCode({ path, R, text, S }: { path: string; R: RenderResult; text: string; S: Settings }) {
  const lines = R.fileLines[path];
  if (!lines) return <pre className="fallback-code">{text}</pre>;
  return (
    <div className="fallback-code">
      {lines.map((l, i) => (
        <div key={i} className="fc-line"><span className="fc-no">{i + 1}</span><span className="fc-src">{l.k === 'hdr' ? <span className="syn-comment">{lineText(l, S)}</span> : <LineBody l={l} onToken={() => { }} />}</span></div>
      ))}
    </div>
  );
}
