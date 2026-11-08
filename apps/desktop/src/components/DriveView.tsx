/* The Drive code tab (spec 8.11i): the code for the 1541 that the program keeps in its memory and uploads to the
 * drive, re-assembled where it runs there (core/drivecode.ts), in a read-only Monaco editor. The source assembles to
 * the program's bytes again; the tab says so, or where it does not. */
import { useEffect, useMemo, useRef, useState } from 'react';
import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api';
import { driveCode, h4, type Addr, type AnalysisResult, type DriveCode, type Settings } from '@mimir/core';
import { Icon } from '../lib/icons';

type MonacoNs = typeof Monaco;

interface DriveViewProps {
  A: AnalysisResult; S: Settings;
  /** what the source is named after: the program's file */
  name: string;
  theme: string;
  onCopy: (text: string) => void;
  onSave: (D: DriveCode) => void;
  /** the bytes of a line in the listing */
  onShow: (c64: Addr) => void;
  /** a new value opens Monaco's find (Ctrl+F outside the editor) */
  findReq?: number;
}

const $ = (a: Addr) => '$' + h4(a);

export function DriveView({ A, S, name, theme, onCopy, onSave, onShow, findReq = 0 }: DriveViewProps) {
  const D = useMemo(() => driveCode(A, S, name), [A, S, name]);
  const host = useRef<HTMLDivElement>(null);
  const monacoRef = useRef<MonacoNs | null>(null);
  const ed = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const model = useRef<Monaco.editor.ITextModel | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'fallback'>('loading');
  const [line, setLine] = useState(1);
  const dRef = useRef(D); dRef.current = D;

  useEffect(() => {
    if (!D) return;
    let alive = true;
    setState('loading');
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
      editor.onDidChangeCursorPosition(ev => setLine(ev.position.lineNumber));
      if (document.fonts?.ready) void document.fonts.ready.then(() => monaco.editor.remeasureFonts());
      setState('ready');
    }).catch(() => { if (alive) setState('fallback'); });
    return () => { alive = false; ed.current?.dispose(); ed.current = null; model.current?.dispose(); model.current = null; };
  }, [!!D]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const monaco = monacoRef.current;
    if (state === 'ready' && monaco) void import('../monaco/theme').then(({ applyMonacoTheme }) => applyMonacoTheme(monaco, theme !== 'light'));
  }, [theme, state]);

  // the source, in a model of the drive's own (the hovers do not take its labels for the listing's)
  useEffect(() => {
    const monaco = monacoRef.current, e = ed.current;
    if (state !== 'ready' || !D || !monaco || !e) return;
    const uri = monaco.Uri.parse('drive:///' + encodeURIComponent(D.file));
    if (model.current && model.current.uri.toString() !== uri.toString()) { model.current.dispose(); model.current = null; }
    if (!model.current) { model.current = monaco.editor.createModel(D.text, 'kickass', uri); e.setModel(model.current); }
    else if (model.current.getValue() !== D.text) { const vs = e.saveViewState(); model.current.setValue(D.text); if (vs) e.restoreViewState(vs); }
  }, [state, D]);

  const findDone = useRef(findReq);
  const openFind = () => { const e = ed.current; if (!e) return; e.focus(); void e.getAction('actions.find')?.run(); };
  useEffect(() => { if (state === 'ready' && findReq !== findDone.current) { findDone.current = findReq; openFind(); } }, [findReq, state]); // eslint-disable-line react-hooks/exhaustive-deps

  /** a part's `.pseudopc` line */
  const goPart = (k: number) => {
    const e = ed.current, d = dRef.current; if (!e || !d || d.partLines[k] == null) return;
    const n = d.partLines[k] + 1;
    e.revealLineNearTop(n); e.setPosition({ lineNumber: n, column: 1 }); e.focus();
  };

  if (!D) return (
    <div className="empty-project">
      <Icon name="disk" size={30} />
      <h2>No drive code in {name}</h2>
      <p>The drive code is the code for the 1541 that a fast loader keeps in the C64's memory and uploads to the drive with M-W (and starts with M-E). This program has none: it has no fast loader, loads with the KERNAL, or its loader has the drive read its code from the disk (BoozeLoader and Sparkle read theirs from track 18).</p>
    </div>
  );

  const at = D.at[line - 1];
  const where = at ? `line ${line}: ${$(at.c64)} in the C64${at.drive != null ? `, ${$(at.drive)} in the drive` : ''}` : `line ${line}`;
  const code = D.segments.reduce((n, g) => n + g.code, 0), bytes = D.segments.reduce((n, g) => n + g.end - g.start, 0);
  const guessed = D.segments.filter(g => g.found === 'jumps').length;
  const checkText = D.check.ok ? `Re-assembles to the same ${D.check.bytes} bytes`
    : D.check.errors.length ? `Does not assemble: ${D.check.errors[0]}` : `Assembles to other bytes at ${D.check.diffs.map($).join(', ')}`;
  return (
    <div className="source drive">
      <div className="toolbar">
        <label htmlFor="drive-part" className="sr-only">Part</label>
        <select id="drive-part" value="" onChange={e => { if (e.target.value !== '') goPart(Number(e.target.value)); }} title="Go to a part of the drive code">
          <option value="">{D.segments.length} part{D.segments.length === 1 ? '' : 's'} · {code} of {bytes} bytes code</option>
          {D.segments.map((g, k) => <option key={k} value={k}>{$(g.start)}-{$(g.end - 1)} → {g.run != null ? `${$(g.run)} in the drive` : 'where it runs is not known'} ({g.how})</option>)}
        </select>
        <span className={`pill ${D.check.ok ? 'hi' : 'lo'} drive-check`} title={D.check.ok ? 'Assembled (with Mimir\'s own assembler), the source gives the program\'s bytes back at the same addresses: each part where it is in the C64\'s memory, inside .pseudopc where it runs in the drive' : D.check.errors.join('\n')}>
          {D.check.ok && <Icon name="check" size={12} />}{checkText}
        </span>
        {guessed > 0 && <span className="pill mid" title="Where these parts run in the drive is a guess: the address at which their JMPs and JSRs land on code. The bytes after an M-W command, and a known loader's parts, are sure">{guessed} placed by their jumps</span>}
        <span className="tb-note">{state === 'ready' ? where : state === 'loading' ? 'Loading Monaco editor…' : 'Built-in viewer'}</span>
        <span className="grow" />
        <button className="btn" disabled={!at} title="Show this line's bytes in the listing (where the program keeps them, as data)" onClick={() => { if (at) onShow(at.c64); }}><Icon name="target" />Show in listing</button>
        {state === 'ready' && <button className="btn" title="Find in the drive code (Ctrl+F); F3 / Shift+F3 go to the next and the one before" onClick={openFind}><Icon name="search" />Find</button>}
        <button className="btn" onClick={() => onCopy(D.text)}><Icon name="copy" />Copy file</button>
        <button className="btn primary" title={`Save the source as ${D.file}`} onClick={() => onSave(D)}><Icon name="download" />Save…</button>
      </div>
      <div className="mon-host" ref={host} style={{ display: state === 'ready' ? 'block' : 'none' }} />
      {state !== 'ready' && <pre className="fallback-code">{D.text}</pre>}
    </div>
  );
}
