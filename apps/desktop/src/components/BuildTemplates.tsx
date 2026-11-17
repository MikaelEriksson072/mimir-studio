/* Build templates (spec 11.4b): the editor of the user's templates (build.bat and build.sh with placeholders), Mimir's
 * own (Pack with Exomizer, shown but not edited), and the one the project's build scripts are made from. A new
 * template starts as the original build.bat and build.sh, the text the generated scripts are filled in from. */
import { useEffect, useMemo, useRef, useState } from 'react';
import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api';
import { BUILT_IN_TEMPLATES, builtInTemplate, newTemplateName, placeholdersIn, TEMPLATE_PLACEHOLDERS, type AssemblerId, type BuildScript, type BuildTemplate } from '@mimir/core';
import { Icon } from '../lib/icons';
import { cx } from '../lib/util';
import { Modal } from './Modal';

type MonacoNs = typeof Monaco;

/** a template in the list: Mimir's by its id, the user's by its name */
export const templateKey = (t: Pick<BuildTemplate, 'name' | 'builtIn'>): string => (t.builtIn ? `builtin:${t.builtIn}` : `user:${t.name}`);

const ASM_NAME: Record<AssemblerId, string> = { kick: 'Kick Assembler', '64tass': '64tass' };
const FILES: BuildScript[] = ['build.bat', 'build.sh'];
const ABOUT = new Map(TEMPLATE_PLACEHOLDERS.map(p => [p.name, p.about]));

export interface BuildTemplatesProps {
  library: readonly BuildTemplate[];
  /** the project's: its name, assembler, whether it has a cartridge (Pack with Exomizer is for a program), and the
   *  template its scripts are made from */
  projectName: string; assembler: AssemblerId; cart: boolean; inUse: BuildTemplate | null;
  /** the original build.bat and build.sh as a template: what a new one starts as */
  original: Record<BuildScript, string>;
  /** a template filled in for the project */
  fill: (t: BuildTemplate) => Record<BuildScript, string>;
  /** what is shown first: a template's key, or 'new' (a new template at once) */
  start?: string;
  onSave: (t: BuildTemplate, was?: string) => void;
  onRemove: (name: string) => void;
  onUse: (t: BuildTemplate) => void;
  onClose: () => void;
}

export function BuildTemplatesModal({ library, projectName, assembler, cart, inUse, original, fill, start, onSave, onRemove, onUse, onClose }: BuildTemplatesProps) {
  const builtIns = useMemo(() => BUILT_IN_TEMPLATES.map(b => builtInTemplate(b.id, { assembler }, cart)), [assembler, cart]);
  const all = useMemo(() => [...builtIns, ...library], [builtIns, library]);
  const [sel, setSel] = useState<string>(() => start && start !== 'new' ? start : inUse ? templateKey(inUse) : library[0] ? templateKey(library[0]) : templateKey(builtIns[0]));
  const cur = all.find(t => templateKey(t) === sel) ?? builtIns[0];
  const own = !cur.builtIn;
  const [file, setFile] = useState<BuildScript>('build.bat');
  const [filled, setFilled] = useState(false);
  const [name, setName] = useState(cur.name);
  const [nameErr, setNameErr] = useState('');
  const [confirmDel, setConfirmDel] = useState(false);
  useEffect(() => { setName(cur.name); setNameErr(''); setConfirmDel(false); }, [sel, cur.name]);

  // a new template: the original build.bat and build.sh, under a name the library does not have
  const make = (from: Pick<BuildTemplate, BuildScript>, base?: string) => {
    flush();
    const t: BuildTemplate = { name: newTemplateName(library, base), 'build.bat': from['build.bat'], 'build.sh': from['build.sh'], assembler };
    onSave(t); setSel(templateKey(t)); setFilled(false);
    setTimeout(() => ed.current?.focus(), 0);
  };
  const made = useRef(false);
  useEffect(() => { if (start === 'new' && !made.current) { made.current = true; make(original); } }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---- the editor: Monaco (bat / shell), the placeholders marked; a textarea when Monaco does not load ---- */
  const host = useRef<HTMLDivElement>(null);
  const monacoRef = useRef<MonacoNs | null>(null);
  const ed = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const marks = useRef<Monaco.editor.IEditorDecorationsCollection | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'fallback'>('loading');
  const shown = filled ? fill(cur)[file] : cur[file].replace(/\r\n/g, '\n');
  const readOnly = filled || !own;
  // typing is kept a moment after the last key, and at once on leaving the template, the file or the dialog
  const curRef = useRef(cur); curRef.current = cur;
  const fileRef = useRef(file); fileRef.current = file;
  const saveRef = useRef(onSave); saveRef.current = onSave;
  const pending = useRef<{ key: string; file: BuildScript; text: string; timer: ReturnType<typeof setTimeout> } | null>(null);
  const applying = useRef(false);
  /** the typing kept now; the template shown as it is with it (a rename, a copy or a use right after typing builds on
   *  this, not on the last render's) */
  function flush(): BuildTemplate {
    const p = pending.current, t = curRef.current;
    if (!p) return t;
    clearTimeout(p.timer); pending.current = null;
    if (templateKey(t) !== p.key || t[p.file] === p.text) return t;
    const now = { ...t, [p.file]: p.text };
    saveRef.current(now);
    return now;
  }
  const edited = (text: string) => {
    const t = curRef.current;
    if (t.builtIn) return;
    if (pending.current) clearTimeout(pending.current.timer);
    pending.current = { key: templateKey(t), file: fileRef.current, text, timer: setTimeout(flush, 400) };
  };
  const markPlaceholders = () => {
    const monaco = monacoRef.current, e = ed.current, m = e?.getModel();
    if (!monaco || !e || !m || !marks.current) return;
    const ds: Monaco.editor.IModelDeltaDecoration[] = [];
    if (!filled) m.getLinesContent().forEach((line, i) => {
      const names = new Set(placeholdersIn(line));
      for (const x of line.matchAll(/(?<!\$)\{([A-Za-z]+)\}/g)) {
        if (!names.has(x[1])) continue;
        ds.push({ range: new monaco.Range(i + 1, x.index! + 1, i + 1, x.index! + x[0].length + 1), options: { inlineClassName: 'tpl-ph', hoverMessage: { value: `**{${x[1]}}** ${ABOUT.get(x[1]) ?? ''}` } } });
      }
    });
    marks.current.set(ds);
  };
  const markRef = useRef(markPlaceholders); markRef.current = markPlaceholders;

  useEffect(() => {
    let alive = true;
    import('../monaco/setup').then(async ({ monaco }) => {
      if (!alive || !host.current) return;
      const { applyMonacoTheme } = await import('../monaco/theme');
      monacoRef.current = monaco;
      applyMonacoTheme(monaco, document.documentElement.dataset.theme !== 'light');
      const editor = monaco.editor.create(host.current, {
        value: '', language: 'bat', theme: 'mimir', automaticLayout: true, fontFamily: "'JetBrains Mono', ui-monospace, Consolas, monospace",
        fontSize: 13, lineHeight: 20, minimap: { enabled: false }, scrollBeyondLastLine: false, renderLineHighlight: 'all', wordWrap: 'off',
        padding: { top: 8 }, guides: { indentation: false }, stickyScroll: { enabled: false }, quickSuggestions: false, wordBasedSuggestions: 'off',
        ariaLabel: 'Template',
      });
      ed.current = editor;
      marks.current = editor.createDecorationsCollection();
      editor.onDidChangeModelContent(() => { if (!applying.current) edited(editor.getValue()); markRef.current(); });
      if (document.fonts?.ready) void document.fonts.ready.then(() => monaco.editor.remeasureFonts());
      setState('ready');
    }).catch(() => { if (alive) setState('fallback'); });
    // the editor first, then its model (a model disposed under the editor throws in Monaco's inline completions)
    return () => { alive = false; flush(); const e = ed.current, m = e?.getModel(); e?.dispose(); m?.dispose(); ed.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // the text of the template and file shown (from outside: another template, the other file, the filled-in view)
  useEffect(() => {
    const monaco = monacoRef.current, e = ed.current;
    if (state !== 'ready' || !monaco || !e) return;
    const m = e.getModel(); if (!m) return;
    const lang = file === 'build.bat' ? 'bat' : 'shell';
    if (m.getLanguageId() !== lang) monaco.editor.setModelLanguage(m, lang);
    if (m.getValue() !== shown && !(pending.current && pending.current.key === sel && pending.current.file === file)) {
      applying.current = true; m.setValue(shown); applying.current = false;
    }
    e.updateOptions({ readOnly, domReadOnly: readOnly });
    markPlaceholders();
  }, [state, sel, file, shown, readOnly]); // eslint-disable-line react-hooks/exhaustive-deps

  const choose = (k: string) => { flush(); setSel(k); setFilled(false); };
  const pickFile = (f: BuildScript) => { flush(); setFile(f); };

  /** a placeholder written where the caret is (the user's templates) */
  const insert = (n: string) => {
    const e = ed.current, monaco = monacoRef.current;
    if (readOnly || !e || !monaco) return;
    const s = e.getSelection(); if (!s) return;
    e.executeEdits('placeholder', [{ range: s, text: `{${n}}`, forceMoveMarkers: true }]);
    e.focus();
  };

  const rename = () => {
    const n = name.trim();
    if (!own || n === cur.name) { setNameErr(''); return; }
    if (!n) { setNameErr('A template needs a name.'); return; }
    const taken = [...library.filter(t => t !== cur).map(t => t.name), ...BUILT_IN_TEMPLATES.map(b => b.name)].some(x => x.toLowerCase() === n.toLowerCase());
    if (taken) { setNameErr(`There is a template called ${n} already.`); return; }
    const t = flush();
    onSave({ ...t, name: n }, t.name); setSel(templateKey({ name: n })); setNameErr('');
  };

  const isInUse = (t: BuildTemplate) => !!inUse && templateKey(inUse) === templateKey(t);
  // the project's copy of the user's template it uses, older than the library's (changed here, or for another project)
  const stale = own && isInUse(cur) && !!inUse && (inUse['build.bat'] !== cur['build.bat'] || inUse['build.sh'] !== cur['build.sh']);
  const forProgram = !!cur.builtIn && cart;
  const builtInAbout = cur.builtIn ? BUILT_IN_TEMPLATES.find(b => b.id === cur.builtIn)?.about : undefined;
  const close = () => { flush(); onClose(); };

  return (
    <Modal title="Build templates" onClose={close} className="tpl-modal">
      <div className="tpl-wrap">
        <nav className="tpl-nav" aria-label="Templates">
          <div role="tablist" aria-orientation="vertical" aria-label="Build templates">
            <div className="set-group">Mimir’s</div>
            {builtIns.map(t => (
              <button key={templateKey(t)} role="tab" className="set-tab" aria-selected={sel === templateKey(t)} onClick={() => choose(templateKey(t))} title={BUILT_IN_TEMPLATES.find(b => b.id === t.builtIn)?.about}>
                <span className="tpl-name">{t.name}</span>{isInUse(t) && <span className="tpl-use">in use</span>}
              </button>
            ))}
            <div className="set-group">Yours</div>
            {library.map(t => (
              <button key={templateKey(t)} role="tab" className="set-tab" aria-selected={sel === templateKey(t)} onClick={() => choose(templateKey(t))}>
                <span className="tpl-name">{t.name}</span>{isInUse(t) && <span className="tpl-use">in use</span>}
              </button>
            ))}
          </div>
          {!library.length && <p className="set-help tpl-none">None yet. A new template starts as this project’s original build.bat and build.sh.</p>}
          <button className="btn tpl-new" onClick={() => make(original)} title="A new template: the original build.bat and build.sh pasted in, with placeholders where the project and the settings go"><Icon name="plus" size={14} />New template</button>
        </nav>
        <div className="tpl-main">
          <div className="tpl-head">
            {own ? (
              <label className="field tpl-name-field">
                <span className="set-label">Name</span>
                <input value={name} onChange={e => setName(e.target.value)} onBlur={rename} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); rename(); } else if (e.key === 'Escape') { e.stopPropagation(); setName(cur.name); setNameErr(''); } }} maxLength={80} spellCheck={false} aria-invalid={!!nameErr} />
              </label>
            ) : <h2 className="tpl-title">{cur.name}</h2>}
            <p className="set-help">
              {own ? <>Your template{cur.assembler ? <>, made for {ASM_NAME[cur.assembler]}{cur.assembler !== assembler ? <strong> (this project is {ASM_NAME[assembler]})</strong> : null}</> : null}. Kept by Mimir for every project; a project that uses it keeps a copy, which follows your changes here.</>
                : <>{builtInAbout}. Mimir’s own: it follows the project’s assembler ({ASM_NAME[assembler]} here). Duplicate it to change it.</>}
              {forProgram && <strong> It packs a program: this project is a cartridge.</strong>}
              {nameErr && <span className="tpl-err" role="alert"> {nameErr}</span>}
            </p>
          </div>
          <div className="tpl-bar">
            <div className="seg" role="tablist" aria-label="Script">
              {FILES.map(f => <button key={f} role="tab" aria-selected={file === f} className={cx(file === f && 'on')} onClick={() => pickFile(f)}>{f}</button>)}
            </div>
            <div className="seg" role="group" aria-label="Show">
              <button className={cx(!filled && 'on')} aria-pressed={!filled} onClick={() => { flush(); setFilled(false); }} title="The template, with its placeholders">Template</button>
              <button className={cx(filled && 'on')} aria-pressed={filled} onClick={() => { flush(); setFilled(true); }} title={`The script the template makes for ${projectName}: the placeholders filled in`}>Filled in for {projectName}</button>
            </div>
            <span className="tb-note">{filled ? 'Read-only: the script this project gets' : own ? 'Editable · saved as you type' : 'Read-only: Mimir’s own'}</span>
          </div>
          <div className="tpl-editor" ref={host} style={{ display: state === 'ready' ? 'block' : 'none' }} />
          {state === 'fallback' && <textarea className="tpl-editor tpl-text" aria-label="Template" value={shown} readOnly={readOnly} spellCheck={false} onChange={e => { edited(e.target.value); saveRef.current({ ...cur, [file]: e.target.value }); }} />}
          {state === 'loading' && <div className="tpl-editor tpl-loading">Loading the editor…</div>}
          <details className="tpl-help">
            <summary>Placeholders{own && !filled ? ' (a click writes one where the caret is)' : ''}</summary>
            <dl>
              {TEMPLATE_PLACEHOLDERS.map(p => (
                <div key={p.name} className="tpl-ph-row">
                  <dt><button className="tpl-ph" disabled={readOnly} onClick={() => insert(p.name)} title={readOnly ? undefined : `Write {${p.name}} where the caret is`}>{`{${p.name}}`}</button></dt>
                  <dd>{p.about}</dd>
                </div>
              ))}
            </dl>
            <p className="set-help">A placeholder after a $ is the shell’s (<code>{'${name}'}</code>), and other words in braces stay as they are.</p>
          </details>
        </div>
      </div>
      <div className="modal-foot">
        <button className="btn" onClick={() => { const t = flush(); make(t, t.name); }} title="A copy of this template, under a name of its own, to change"><Icon name="copy" size={14} />Duplicate</button>
        {own && (confirmDel
          ? <><span className="tb-note">Delete “{cur.name}”? {isInUse(cur) ? 'This project keeps its copy.' : ''}</span>
            <button className="btn danger" onClick={() => { flush(); onRemove(cur.name); setConfirmDel(false); setSel(templateKey(builtIns[0])); }}>Delete</button>
            <button className="btn" onClick={() => setConfirmDel(false)}>Keep it</button></>
          : <button className="btn" onClick={() => setConfirmDel(true)} title="Remove the template from Mimir’s library"><Icon name="trash" size={14} />Delete…</button>)}
        <span className="grow" />
        <button className="btn primary" disabled={(isInUse(cur) && !stale) || forProgram} onClick={() => onUse(flush())}
          title={stale ? 'The project keeps a copy of the template: make its build.bat and build.sh from the template as it is now' : isInUse(cur) ? 'This project’s build scripts are made from this template' : forProgram ? 'Pack with Exomizer packs a program, not a cartridge' : 'Make this project’s build.bat and build.sh from this template'}>
          <Icon name="check" size={14} />{stale ? 'Update this project’s copy' : isInUse(cur) ? 'In use in this project' : 'Use in this project'}
        </button>
        <button className="btn" onClick={close}>Close</button>
      </div>
    </Modal>
  );
}
