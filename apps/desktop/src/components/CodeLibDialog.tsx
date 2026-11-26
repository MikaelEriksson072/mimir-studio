/* Add to the macro library / the code library, and an item's Edit (spec 10.8): its library, name, assembler, code,
 * description and colour. Lines taken from a source that are not a macro become one for the macro library (wrapped in
 * `.macro Name(…) { … }`, 64tass's `Name .macro … .endm`; the name and the parameters typed are the macro's), until the
 * code is changed by hand. When it was made is shown, and where the code came from. */
import { useMemo, useState, type KeyboardEvent } from 'react';
import { CODE_LIB_DESCRIPTION_MAX, CODE_LIB_FOLDERS, CODE_LIB_NAME_MAX, codeLibFileName, codeLibIsMacro, codeLibMacros, codeLibSignature, codeLibStem, codeLibWrap, guessAsmLang, LANG_TITLE, macroName, splitLabel, type CodeLibKind, type ScriptLang } from '@mimir/core';
import { Icon } from '../lib/icons';
import { cx, errorText } from '../lib/util';
import { codeLibItemOf, useCodeLib, type CodeLibEditing } from '../store/codelib';
import { ColorPicker } from './Bookmarks';
import { CODE_LIB_TITLE, codeLibTime } from './CodeLibView';
import { Modal } from './Modal';

/** the name an item of `code` gets at first: its macro's, else the first label in it */
function firstName(code: string, lang: ScriptLang, kind: CodeLibKind): string {
  const m = kind === 'macro' ? codeLibMacros(code, lang)[0] : null;
  if (m) return m.name;
  for (const l of code.split('\n')) { const s = splitLabel(l, lang); if (s.label && /^[A-Za-z_]/.test(s.label)) return s.label; }
  return '';
}

export function CodeLibDialog({ editing, toast, onSaved, onClose }: {
  editing: CodeLibEditing;
  toast: (msg: string, kind?: 'info' | 'ok' | 'warn' | 'err') => void;
  /** saved: the side panel shows it */
  onSaved: () => void;
  onClose: () => void;
}) {
  const { listing, save, remove } = useCodeLib();
  const was = codeLibItemOf(listing?.items, editing.was ?? null);
  const [kind, setKind] = useState<CodeLibKind>(editing.kind);
  const [lang, setLang] = useState<ScriptLang>(editing.lang);
  // the code as it was given or typed, and whether it is wrapped in a macro (lines taken that are not one, for the
  // macro library)
  const [text, setText] = useState(editing.code);
  const [wrap, setWrap] = useState(!editing.was && editing.kind === 'macro' && !!editing.code.trim() && !codeLibIsMacro(editing.code, editing.lang));
  const [name, setName] = useState(editing.name ?? firstName(editing.code, editing.lang, editing.kind));
  const [params, setParams] = useState('');
  const [description, setDescription] = useState(was?.description ?? '');
  const [color, setColor] = useState(was?.color ?? '');
  const [busy, setBusy] = useState(false);
  const paramList = useMemo(() => params.split(/[,\s]+/).map(macroName).filter(Boolean), [params]);
  const code = wrap ? codeLibWrap(text, name, paramList, lang) : text;
  const def = kind === 'macro' ? codeLibIsMacro(code, lang) : null;
  const defs = kind === 'macro' ? codeLibMacros(code, lang) : [];
  const canWrap = kind === 'macro' && !!text.trim() && (wrap || !codeLibIsMacro(text, lang));
  const guessed = code.trim() ? guessAsmLang(code, lang) : lang;
  // another item of that name in the library: this one gets a name of its own
  const others = (listing?.items ?? []).filter(i => i.kind === kind && !(editing.was && i.kind === editing.was.kind && i.file === editing.was.file));
  const file = codeLibFileName(name || 'untitled', others.map(i => i.file));
  const clash = !!name.trim() && file.toLowerCase() !== `${codeLibStem(name)}.asm`.toLowerCase();
  // (an item keeps its file when its name stays, any case: a file put there by hand its extension)
  const target = was && was.kind === kind && codeLibStem(name).toLowerCase() === was.name.toLowerCase() ? `${codeLibStem(name)}${/\.[^.]+$/.exec(was.file)?.[0] ?? '.asm'}` : file;
  const problem = !name.trim() ? 'Give it a name.' : !code.trim() ? 'There is no code.' : null;
  const T = CODE_LIB_TITLE[kind];
  const heading = was ? `Edit ${was.name}` : `Add to the ${T.lib}`;
  const saveIt = async () => {
    if (problem || busy) return;
    setBusy(true);
    try {
      const item = await save({ kind, name: name.trim(), code, lang, description: description.replace(/^(\s*\n)+/, '').trimEnd(), ...(color ? { color } : {}), ...(editing.from ? { from: editing.from } : {}), ...(editing.was ? { was: editing.was } : {}) });
      toast(was ? `${item.name} is saved` : `${item.name} is in the ${T.lib} (${item.file})`, 'ok');
      onSaved(); onClose();
    } catch (e) { toast(`It was not saved: ${errorText(e)}`, 'err'); setBusy(false); }
  };
  const trash = () => {
    if (!was) return;
    remove({ kind: was.kind, file: was.file }).then(() => { toast(`${was.file} is in the Recycle Bin`, 'ok'); onClose(); }, e => toast(`Could not move it to the Recycle Bin: ${errorText(e)}`, 'err'));
  };
  const ctrlEnter = (e: KeyboardEvent) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void saveIt(); } };
  return (
    <Modal title={heading} onClose={onClose} className="cl-dialog">
      {/* (no form: an Enter that opened the dialog from the palette must not save it; Ctrl+Enter saves) */}
      <div className="modal-body" onKeyDown={ctrlEnter}>
        <div className="cl-dlg-row">
          <div className="field"><span>Library</span>
            <div className="seg" role="radiogroup" aria-label="Library">
              {(['macro', 'code'] as const).map(k => <button key={k} type="button" role="radio" aria-checked={kind === k} className={cx(kind === k && 'on')}
                onClick={() => { setKind(k); if (k === 'code') setWrap(false); else if (!was && text.trim() && !codeLibIsMacro(text, lang)) setWrap(true); }}>{k === 'macro' ? 'Macros' : 'Code'}</button>)}
            </div></div>
          <div className="field"><span>Assembler</span>
            <div className="seg" role="radiogroup" aria-label="Assembler">
              {(['kickass', '64tass'] as const).map(l => <button key={l} type="button" role="radio" aria-checked={lang === l} className={cx(lang === l && 'on')} onClick={() => setLang(l)}>{LANG_TITLE[l]}</button>)}
            </div></div>
        </div>
        <label className="field"><span>Name</span>
          <input value={name} maxLength={CODE_LIB_NAME_MAX} spellCheck={false} autoFocus onFocus={e => e.currentTarget.select()} onChange={e => setName(e.target.value)} placeholder={kind === 'macro' ? 'WaitRaster' : 'Clear the screen'} /></label>
        {canWrap && <div className="cl-wrap">
          <label className="check"><input type="checkbox" checked={wrap} onChange={e => setWrap(e.target.checked)} /> Make the code a macro of that name</label>
          {wrap && <label className="field cl-params"><span>Parameters</span>
            <input className="mono" value={params} spellCheck={false} onChange={e => setParams(e.target.value)} placeholder="none (line, color …)" /></label>}
        </div>}
        <label className="field"><span>Code</span>
          <textarea className="mono cl-code-edit" value={code} rows={13} spellCheck={false} wrap="off" aria-label="Code"
            onChange={e => { setText(e.target.value); setWrap(false); }} /></label>
        <div className="cl-notes small">
          {kind === 'macro' && def ? <span className="muted">{wrap ? 'A macro: ' : 'Called as '}<span className="mono">{codeLibSignature(def, lang)}</span>{wrap ? ' (change the code by hand and it is kept as you write it)' : ''}</span>
            : kind === 'macro' && defs.length > 1 ? <span className="muted">{defs.length} macros: {defs.map(d => d.name).join(', ')}. The list calls the first.</span>
              : kind === 'macro' && code.trim() ? <span className="warn-text"><Icon name="warn" size={12} /> No macro in the code: Insert call has nothing to call.</span> : null}
          {guessed !== lang && <span className="warn-text"><Icon name="warn" size={12} /> The code looks like {LANG_TITLE[guessed]}. <button type="button" className="linkish" onClick={() => setLang(guessed)}>Use {LANG_TITLE[guessed]}</button></span>}
        </div>
        <label className="field"><span>Description</span>
          <textarea value={description} rows={4} maxLength={CODE_LIB_DESCRIPTION_MAX} placeholder="What it does, what it needs, what it changes…" onChange={e => setDescription(e.target.value)} /></label>
        <ColorPicker value={color} onChange={setColor} none />
        <p className="small muted cl-made">
          {was ? `Made ${codeLibTime(was.created)}${was.changed > was.created + 60_000 ? ` · changed ${codeLibTime(was.changed)}` : ''}` : 'Made now'}
          {editing.from ? ` · from ${editing.from}` : ''} · <span className="mono">{CODE_LIB_FOLDERS[kind]}\{target}</span>
          {clash && <span className="warn-text"> (there is a {T.one} named {name.trim()} already)</span>}
        </p>
      </div>
      <div className="modal-foot">
        {was && <button type="button" className="btn ghost" onClick={trash}><Icon name="trash" size={13} />Move to the Recycle Bin</button>}
        <span className="grow" />
        {problem ? <span className="small muted">{problem}</span> : <span className="small muted">Ctrl+Enter saves</span>}
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button type="button" className="btn primary" disabled={!!problem || busy} onClick={() => void saveIt()}>{was ? 'Save' : `Add to ${kind === 'macro' ? 'Macros' : 'Code'}`}</button>
      </div>
    </Modal>
  );
}
