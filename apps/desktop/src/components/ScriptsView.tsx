/* The Scripts tab (spec 10.3): the project's scripts, Kick Assembler code that runs in Mimir on a copy of the
 * program's memory (never in the export or Build & Run). The code is written in Monaco with the Kick Assembler
 * highlighting; it is checked as it is typed (assembled with the program's names and the scratchpads at hand) and
 * runs only when it checks out. A run's scratchpads are kept in the project and shown as hex, code or text; what it
 * changed in the program's bytes is listed and can be written over them as a patch. */
import { useEffect, useMemo, useRef, useState } from 'react';
import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api';
import { byteLines, checkScript, disassembleBytes, freePlace, h2, h4, monitorChar, padName, rangeText, scriptEndText, scriptNames, type Addr, type ScriptCheck, type ScriptEnv, type ScriptPad, type ScriptRun, type UserScript } from '@mimir/core';
import { Icon } from '../lib/icons';
import { cx, errorText } from '../lib/util';
import { runScriptInWorker, stopScript } from '../lib/scriptrun';
import { useScripts, type PadMode } from '../store/scripts';
import { Splitter } from './Splitter';

type MonacoNs = typeof Monaco;

interface ScriptsViewProps {
  scripts: readonly UserScript[];
  env: ScriptEnv;
  theme: string;
  onNew: () => void;
  onEdit: (id: string, change: Partial<Pick<UserScript, 'name' | 'source' | 'pads'>>, label: string) => void;
  onRemove: (id: string) => void;
  /** a run ended: its scratchpads go into the project */
  onRan: (id: string, run: ScriptRun) => void;
  /** write bytes over the program as a patch (the patch dialog opens with them) */
  onWritePatch: (name: string, start: Addr, bytes: Uint8Array) => void;
  onShow: (start: Addr, end: Addr) => void;
  onCopy: (text: string, what?: string) => void;
  onSave: (name: string, bytes: Uint8Array, prg: boolean, load: Addr) => void;
  toast: (msg: string, kind: 'ok' | 'info' | 'warn' | 'err') => void;
}

const $ = (a: number) => '$' + h4(a);
/** `$c000`, `c000`, `49152` or a name the script may use */
function parseAddr(text: string, names: ReadonlyMap<string, number>): number | null {
  const t = text.trim();
  if (!t) return null;
  if (/^\$[0-9a-f]{1,5}$/i.test(t)) return parseInt(t.slice(1), 16);
  if (/^[0-9]+$/.test(t)) return parseInt(t, 10);
  if (/^[0-9a-f]{1,4}$/i.test(t)) return parseInt(t, 16);
  return names.get(t) ?? null;
}

export function ScriptsView({ scripts, env, theme, onNew, onEdit, onRemove, onRan, onWritePatch, onShow, onCopy, onSave, toast }: ScriptsViewProps) {
  const { selected, runs, running, shown, mode, screen, outH, set } = useScripts();
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
        tabSize: 8, insertSpaces: true, quickSuggestions: { other: true, comments: false, strings: false }, wordBasedSuggestions: 'off', acceptSuggestionOnEnter: 'smart',
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
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => { editor.trigger('run', 'hideSuggestWidget', null); runRef.current(); });
      if (document.fonts?.ready) void document.fonts.ready.then(() => monaco.editor.remeasureFonts());
      setState('ready');
    }).catch(() => { if (alive) setState('fallback'); });
    return () => { alive = false; flush(); ed.current?.dispose(); ed.current = null; Object.values(models.current).forEach(m => m.dispose()); models.current = {}; };
  }, [any]); // eslint-disable-line react-hooks/exhaustive-deps

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
    if (!m) { m = monaco.editor.createModel(cur.source, 'kickass', monaco.Uri.parse(`script:///${cur.id}.asm`)); models.current[cur.id] = m; }
    else if (m.getValue() !== cur.source && pending.current?.id !== cur.id) {
      const vs = e.getModel() === m ? e.saveViewState() : null; applying.current = true; m.setValue(cur.source); applying.current = false; if (vs) e.restoreViewState(vs);
      setLive(l => { const { [cur.id]: _, ...rest } = l; return rest; });
    }
    if (e.getModel() !== m) e.setModel(m);
  }, [state, cur?.id, cur?.source, scripts]); // eslint-disable-line react-hooks/exhaustive-deps

  const source = cur ? live[cur.id] ?? cur.source : '';
  const check: ScriptCheck | null = useMemo(() => cur ? checkScript(env, { source, pads: cur.pads }) : null, [env, source, cur?.pads]); // eslint-disable-line react-hooks/exhaustive-deps
  const names = useMemo(() => cur ? scriptNames(env, cur.pads) : new Map<string, number>(), [env, cur?.pads]); // eslint-disable-line react-hooks/exhaustive-deps
  // the names the editor completes and the hovers show, for this script
  useEffect(() => {
    void import('../monaco/providers').then(({ scriptContext }) => { scriptContext.names = names; scriptContext.pads = cur?.pads ?? []; });
  }, [names, cur?.pads]);

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

  const run = async () => {
    const s = curRef.current; if (!s || running) return;
    flush();
    const text = models.current[s.id]?.getValue() ?? s.source;
    const c = checkScript(env, { source: text, pads: s.pads });
    if (!c.ok) { toast(`The script does not check out: ${c.problems.find(p => p.level === 'error')?.msg}`, 'warn'); return; }
    set({ running: s.id });
    try {
      const r = await runScriptInWorker(env, { source: text, pads: s.pads });
      set({ runs: { ...useScripts.getState().runs, [s.id]: { run: r, source: text, at: Date.now() } }, running: null });
      onRan(s.id, r);
      const sh = useScripts.getState().shown;
      if (sh.kind === 'change' && sh.i >= r.changes.length) set({ shown: { kind: 'pad', i: 0 } });
      toast(`${s.name}: ${scriptEndText(r)}${r.changes.length ? ` It changed the program's bytes in ${r.changes.length} place${r.changes.length === 1 ? '' : 's'} (only in its copy).` : ''}`, r.end === 'rts' || r.end === 'brk' ? 'ok' : 'warn');
    } catch (e) {
      set({ running: null });
      const msg = errorText(e);
      toast(msg === 'stopped' ? `${s.name} stopped` : `${s.name} did not run: ${msg}`, msg === 'stopped' ? 'info' : 'err');
    }
  };
  runRef.current = () => void run();

  if (!scripts.length) return (
    <div className="empty-project scripts-empty">
      <Icon name="prompt" size={30} />
      <h2>No scripts yet</h2>
      <p>A script is Kick Assembler code that runs here in Mimir on a copy of the program's memory, never in the export or in Build &amp; Run. Use the program's labels, variables and tables in it, call its routines or paste its code (a decryption loop, say), and let it leave its results in its scratchpads.</p>
      <div className="empty-actions"><button className="btn primary" onClick={onNew}><Icon name="plus" size={14} />New script</button></div>
      <p className="muted small">Or select lines in the listing, right-click and pick <b>New script from selection</b>.</p>
    </div>
  );

  const kept = cur ? runs[cur.id] : undefined;
  const isRunning = !!cur && running === cur.id;
  const errors = check?.problems.filter(p => p.level === 'error') ?? [], warnings = check?.problems.filter(p => p.level === 'warning') ?? [];
  const chip = !check ? '' : check.ok
    ? `Ready: ${check.bytes} byte${check.bytes === 1 ? '' : 's'} at ${check.code.slice(0, 3).map(rangeText).join(', ')}${check.code.length > 3 ? ', …' : ''} · starts at ${$(check.entry!)}${warnings.length ? ` · ${warnings.length} warning${warnings.length === 1 ? '' : 's'}` : ''}`
    : `${errors.length} error${errors.length === 1 ? '' : 's'}: ${errors[0]?.line ? `line ${errors[0].line}: ` : ''}${errors[0]?.msg}`;

  return (
    <div className="scripts">
      <div className="scr-list" role="listbox" aria-label="Scripts">
        <div className="scr-list-head"><span>Scripts</span><span className="grow" />
          <button className="icon-btn" onClick={onNew} aria-label="New script" title="New script: Kick Assembler code that runs in Mimir"><Icon name="plus" size={15} /></button></div>
        {scripts.map(s => (
          <button key={s.id} role="option" aria-selected={s.id === cur?.id} className={cx('scr-item', s.id === cur?.id && 'on')} onClick={() => { flush(); set({ selected: s.id, shown: { kind: 'pad', i: 0 } }); }}
            title={`${s.name}: ${s.pads.length} scratchpad${s.pads.length === 1 ? '' : 's'}${runs[s.id] ? ` · last run: ${scriptEndText(runs[s.id].run)}` : ''}`}>
            <Icon name="prompt" size={13} /><span className="scr-item-name">{s.name}</span>{running === s.id && <span className="scr-busy" aria-label="running" />}
          </button>
        ))}
      </div>
      {cur && check && <div className="scr-main">
        <div className="toolbar">
          <NameField key={cur.id} value={cur.name} taken={scripts.filter(s => s.id !== cur.id).map(s => s.name)} onCommit={n => onEdit(cur.id, { name: n }, `Rename script "${cur.name}" to "${n}"`)} toast={toast} />
          <span className={cx('pill scr-check', check.ok ? (warnings.length ? 'mid' : 'hi') : 'lo')} role="status" title={check.problems.map(p => `${p.level === 'error' ? 'Error' : 'Warning'}${p.line ? ` (line ${p.line})` : ''}: ${p.msg}`).join('\n') || 'The script assembles with the program\'s names and its scratchpads, and has code to run'}
            onClick={() => { const p = check.problems.find(x => x.line); if (p?.line) goLine(p.line); }}>
            <Icon name={check.ok ? 'check' : 'err'} size={12} />{chip}
          </span>
          <span className="grow" />
          {isRunning
            ? <button className="btn" onClick={() => stopScript()} title="Stop the run"><Icon name="x" />Stop</button>
            : <button className="btn primary scr-run" disabled={!check.ok || !!running} onClick={() => void run()} title={check.ok ? 'Run the script on a copy of the program\'s memory (Ctrl+Enter in the editor). The project\'s files do not change; the scratchpads keep what it leaves there' : 'The script must check out before it can run: see the errors'}>
              <Icon name="play" />Run<kbd>Ctrl+Enter</kbd></button>}
          <button className="icon-btn" aria-label="Delete script" title={`Delete the script "${cur.name}" (Ctrl+Z brings it back)`} onClick={() => { flush(); onRemove(cur.id); }}><Icon name="trash" size={15} /></button>
        </div>
        <div className="scr-body">
          <div className="mon-host scr-editor" ref={host} style={{ display: state === 'ready' ? 'block' : 'none' }} />
          {state !== 'ready' && <textarea className="fallback-code scr-fallback" aria-label="Script code" value={source} onChange={e => { setLive(l => ({ ...l, [cur.id]: e.target.value })); onEdit(cur.id, { source: e.target.value }, `Edit script "${cur.name}"`); }} />}
          <Splitter dir="h" onDrag={d => set({ outH: Math.max(140, Math.min(window.innerHeight - 260, useScripts.getState().outH - d)) })} />
          <div className="scr-out" style={{ height: outH }}>
            <ScriptSide script={cur} check={check} kept={kept} stale={!!kept && kept.source !== source} env={env} onGoLine={goLine} onEdit={onEdit} />
            <PadView script={cur} kept={kept} names={names} mode={mode} screen={screen} onMode={(m: PadMode) => set({ mode: m })} onScreen={v => set({ screen: v })}
              onWritePatch={onWritePatch} onShow={onShow} onCopy={onCopy} onSave={onSave} toast={toast} />
          </div>
        </div>
      </div>}
    </div>
  );
}

function NameField({ value, taken, onCommit, toast }: { value: string; taken: string[]; onCommit: (n: string) => void; toast: ScriptsViewProps['toast'] }) {
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

/** The left of the output: the problems, the scratchpads (edited here) and the last run with its changes. */
function ScriptSide({ script, check, kept, stale, env, onGoLine, onEdit }: { script: UserScript; check: ScriptCheck; kept?: { run: ScriptRun }; stale: boolean; env: ScriptEnv; onGoLine: (n: number) => void; onEdit: ScriptsViewProps['onEdit'] }) {
  const { shown, set } = useScripts();
  const setPads = (pads: ScriptPad[], label: string) => onEdit(script.id, { pads }, label);
  const addPad = () => {
    const taken = [...check.code, ...script.pads.map(p => ({ start: p.start, end: p.start + p.size }))];
    const last = script.pads[script.pads.length - 1];
    const start = freePlace(env.files, 0x100, taken, last ? last.start + last.size : undefined) ?? 0xc000;
    const name = padName(script.pads);
    setPads([...script.pads, { name, start, size: 0x100 }], `Add scratchpad ${name} to "${script.name}"`);
    set({ shown: { kind: 'pad', i: script.pads.length } });
  };
  const run = kept?.run;
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
      <section className="scr-sec">
        <h4>Scratchpads<span className="grow" /><button className="btn ghost small" onClick={addPad} title="A scratchpad of this script's own: memory at an address the script writes its results to, cleared before each run; its name (and name_end) are labels in the code"><Icon name="plus" size={13} />Add</button></h4>
        {!script.pads.length && <p className="muted small">None: the script can only leave its results in the program's bytes.</p>}
        <div className="pad-table" role="table" aria-label="Scratchpads">
          {script.pads.length > 0 && <div className="pad-row pad-head" role="row"><span>Name</span><span>Address</span><span>Size</span><span>Fill</span><span /></div>}
          {script.pads.map((p, i) => (
            <PadRow key={`${script.id}-${i}`} pad={p} on={shown.kind === 'pad' && shown.i === i} bad={check.problems.some(x => x.pad === i && x.level === 'error')} warn={check.problems.some(x => x.pad === i && x.level === 'warning')}
              onShow={() => set({ shown: { kind: 'pad', i } })}
              onChange={q => setPads(script.pads.map((x, j) => (j === i ? q : x)), `Change scratchpad ${p.name} of "${script.name}"`)}
              onRemove={() => { setPads(script.pads.filter((_, j) => j !== i), `Remove scratchpad ${p.name} from "${script.name}"`); set({ shown: { kind: 'pad', i: 0 } }); }} />
          ))}
        </div>
      </section>
      {check.prints.length > 0 && <section className="scr-sec"><h4>.print</h4><pre className="scr-prints">{check.prints.join('\n')}</pre></section>}
      {run && <section className="scr-sec scr-run-sec">
        <h4>Last run{stale && <span className="pill mid" title="The code has changed since this run: run it again to see what it does now">code changed since</span>}</h4>
        <p className={cx('scr-end', run.end === 'jam' || run.end === 'limit' ? 'warn' : 'ok')}>{scriptEndText(run)}</p>
        <p className="scr-regs mono">A=${h2(run.regs.a)} X=${h2(run.regs.x)} Y=${h2(run.regs.y)} S=${h2(run.regs.s)} P=${h2(run.regs.p)} · {run.ms} ms</p>
        {run.changes.length > 0
          ? <><p className="small">It changed the program's bytes (in its copy; the project's files are as they were):</p>
            <ul className="scr-changes">{run.changes.map((c, i) => (
              <li key={i}><button className={cx('scr-change', shown.kind === 'change' && shown.i === i && 'on')} onClick={() => set({ shown: { kind: 'change', i } })}>{rangeText(c)} · {c.end - c.start} byte{c.end - c.start === 1 ? '' : 's'}</button></li>))}</ul></>
          : <p className="small muted">It changed none of the program's bytes.</p>}
        {run.other > 0 && <p className="small muted">{run.other} byte{run.other === 1 ? '' : 's'} changed elsewhere (the zero page, the stack, …).</p>}
      </section>}
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
    const q: ScriptPad = { name: name.trim(), start: a, size: n, ...(f ? { fill: f } : {}) };
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

/** The right of the output: a scratchpad's bytes, or a change the run made, as hex, code or text, with what can be
 *  done with them. */
function PadView({ script, kept, names, mode, screen, onMode, onScreen, onWritePatch, onShow, onCopy, onSave, toast }: {
  script: UserScript; kept?: { run: ScriptRun }; names: ReadonlyMap<string, number>; mode: PadMode; screen: boolean; onMode: (m: PadMode) => void; onScreen: (v: boolean) => void;
  onWritePatch: ScriptsViewProps['onWritePatch']; onShow: ScriptsViewProps['onShow']; onCopy: ScriptsViewProps['onCopy']; onSave: ScriptsViewProps['onSave']; toast: ScriptsViewProps['toast'];
}) {
  const { shown } = useScripts();
  const [target, setTarget] = useState('');
  // 16 bytes a hex row where they fit, else 8
  const [wide, setWide] = useState(true);
  const [view, setView] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!view || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setWide(view.clientWidth >= 560)); ro.observe(view); setWide(view.clientWidth >= 560);
    return () => ro.disconnect();
  }, [view]);
  const change = shown.kind === 'change' ? kept?.run.changes[shown.i] : undefined;
  const pad = shown.kind === 'pad' ? script.pads[shown.i] ?? script.pads[0] : undefined;
  const bytes = change ? change.bytes : pad?.bytes && pad.bytes.length === pad.size ? pad.bytes : null;
  const at = change ? change.start : pad?.start ?? 0;
  const byAddr = useMemo(() => { const m = new Map<number, string>(); for (const [n, a] of names) if (!m.has(a)) m.set(a, n); return m; }, [names]);
  const text = useMemo(() => {
    if (!bytes) return '';
    const out: string[] = [];
    if (mode === 'code') for (const l of disassembleBytes(bytes, at, byAddr)) out.push(`${$(l.a)}  ${Array.from(bytes.subarray(l.a - at, l.a - at + l.n), b => h2(b)).join(' ').padEnd(9)} ${byAddr.has(l.a) ? `${byAddr.get(l.a)}: ` : ''}${l.text}`);
    else {
      const per = mode === 'hex' ? (wide ? 16 : 8) : 32;
      for (let i = 0; i < bytes.length; i += per) {
        const row = Array.from(bytes.subarray(i, i + per));
        const chars = row.map(b => monitorChar(b, screen)?.ch ?? '.').join('');
        out.push(mode === 'hex' ? `${$(at + i)}  ${row.map(b => h2(b)).join(' ').padEnd(per * 3 - 1)}  ${chars}` : `${$(at + i)}  ${chars}`);
      }
    }
    return out.join('\n');
  }, [bytes, at, mode, screen, byAddr, wide]);
  if (!pad && !change) return <div className="scr-view" ref={setView}><div className="empty small">Add a scratchpad: the script writes its results there.</div></div>;
  const title = change ? `Changed ${rangeText(change)}` : `${pad!.name} · ${rangeText({ start: pad!.start, end: pad!.start + pad!.size })} · ${pad!.size} bytes`;
  const fileName = `${script.name}_${change ? h4(change.start) : pad!.name}`.replace(/[^A-Za-z0-9_.-]+/g, '_');
  const writeAt = () => {
    if (!bytes) return;
    const a = change ? change.start : parseAddr(target, names);
    if (a == null) { toast('Write where? Give an address ($3000) or a label of the program', 'info'); return; }
    if (a + bytes.length > 0x10000) { toast(`${bytes.length} bytes from $${h4(a)} run past $ffff`, 'warn'); return; }
    onWritePatch(fileName, a, bytes);
  };
  return (
    <div className="scr-view" ref={setView}>
      <div className="scr-view-head">
        <b className="scr-view-title">{title}</b>
        {change && <span className="muted small">{change.bytes.reduce((n, b, i) => n + (b !== change.old[i] ? 1 : 0), 0)} of them differ from the program's</span>}
        <span className="grow" />
        <div className="seg" role="group" aria-label="Show as">
          {(['hex', 'code', 'text'] as const).map(m => <button key={m} className={cx(mode === m && 'on')} aria-pressed={mode === m} onClick={() => onMode(m)}>{m === 'hex' ? 'Hex' : m === 'code' ? 'Code' : 'Text'}</button>)}
        </div>
        {mode !== 'code' && <div className="seg" role="group" aria-label="Text as"><button className={cx(!screen && 'on')} aria-pressed={!screen} onClick={() => onScreen(false)} title="The bytes as PETSCII">PETSCII</button><button className={cx(screen && 'on')} aria-pressed={screen} onClick={() => onScreen(true)} title="The bytes as screen codes">Screen</button></div>}
      </div>
      {bytes ? <pre className="scr-dump mono" aria-label={`${title} as ${mode}`}>{text}</pre>
        : <div className="empty small">{change ? '' : 'Empty until the script runs: Run fills it.'}</div>}
      {bytes && <div className="scr-view-actions">
        <button className="btn small" onClick={() => onCopy(byteLines(bytes).join('\n'), `${bytes.length} bytes as .byte lines`)} title="Copy the bytes as Kick Assembler .byte lines"><Icon name="copy" size={13} /><span className="lbl">Copy as .byte</span></button>
        <button className="btn small" onClick={() => onSave(`${fileName}.bin`, bytes, false, at)} title="Save the bytes as a binary file"><Icon name="download" size={13} /><span className="lbl">Save </span>.bin…</button>
        <button className="btn small" onClick={() => onSave(`${fileName}.prg`, bytes, true, at)} title={`Save the bytes as a PRG that loads at $${h4(at)}`}><Icon name="download" size={13} /><span className="lbl">Save </span>.prg…</button>
        <span className="grow" />
        {change ? <>
          <button className="btn small" onClick={() => onShow(change.start, change.end)} title="Select these bytes in the listing"><Icon name="target" size={13} /><span className="lbl">Show in listing</span></button>
          <button className="btn small primary" onClick={writeAt} title="Write the bytes the run left here over the program, as a patch (it can be switched off and removed again)"><Icon name="pencil" size={13} />Write as patch…</button>
        </> : <>
          <label className="small muted" htmlFor="scr-target">Write at</label>
          <input id="scr-target" className="mono scr-target" placeholder="$3000 or a label" value={target} onChange={e => setTarget(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') writeAt(); }} />
          <button className="btn small primary" onClick={writeAt} title="Write the scratchpad's bytes over the program at that address, as a patch (it can be switched off and removed again)"><Icon name="pencil" size={13} />as patch…</button>
        </>}
      </div>}
    </div>
  );
}
