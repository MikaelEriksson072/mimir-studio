/* Add to the macro library / the code library, and an item's Edit (spec 10.8): its library, name, assembler, code,
 * description and colour. Lines taken from a source that are not a macro become one for the macro library (wrapped in
 * `.macro Name(…) { … }`, 64tass's `Name .macro … .endm`; the name and the parameters typed are the macro's), until the
 * code is changed by hand. A macro goes in a file of its own or in a collection (one there, or a new one): its name is
 * then its macro's. When it was made is shown, and where the code came from. A collection itself: its name, its
 * description, its colour and its whole code. */
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
/** where a macro goes: a file of its own, a collection there (its file), or a new collection */
const OWN = '', NEW = '\u0000new';

export function CodeLibDialog({ editing, toast, onSaved, onClose }: {
  editing: CodeLibEditing;
  toast: (msg: string, kind?: 'info' | 'ok' | 'warn' | 'err') => void;
  /** saved: the side panel shows it */
  onSaved: () => void;
  onClose: () => void;
}) {
  const { listing, save, remove } = useCodeLib();
  const items = listing?.items;
  const was = codeLibItemOf(items, editing.was ?? null);
  // the collection itself (its whole file), not a macro of it
  const isColl = !!was && !!was.collection && !editing.was?.macro;
  const [kind, setKind] = useState<CodeLibKind>(editing.kind);
  const [lang, setLang] = useState<ScriptLang>(editing.lang);
  // the code as it was given or typed, and whether it is wrapped in a macro (lines taken that are not one, for the
  // macro library)
  const [text, setText] = useState(editing.code);
  const [wrap, setWrap] = useState(!editing.was && editing.kind === 'macro' && !!editing.code.trim() && !codeLibIsMacro(editing.code, editing.lang));
  const [name, setName] = useState(editing.name ?? firstName(editing.code, editing.lang, editing.kind));
  const [params, setParams] = useState('');
  const [description, setDescription] = useState(was?.description ?? '');
  const [color, setColor] = useState(editing.color ?? was?.color ?? '');
  // where a macro goes, and a new collection's name
  const [into, setInto] = useState(editing.into ? ('file' in editing.into ? editing.into.file : NEW) : OWN);
  const [collName, setCollName] = useState(editing.into && 'name' in editing.into ? editing.into.name : '');
  const [busy, setBusy] = useState(false);
  const collections = useMemo(() => (items ?? []).filter(i => i.kind === 'macro' && i.collection).sort((a, b) => a.name.localeCompare(b.name, 'sv')), [items]);
  const target = kind === 'macro' && into && into !== NEW ? collections.find(c => c.file === into) ?? null : null;
  const inColl = kind === 'macro' && !isColl && into !== OWN;
  const paramList = useMemo(() => params.split(/[,\s]+/).map(macroName).filter(Boolean), [params]);
  const code = wrap ? codeLibWrap(text, name, paramList, lang) : text;
  const def = kind === 'macro' ? codeLibIsMacro(code, lang) : null;
  const defs = kind === 'macro' ? codeLibMacros(code, lang) : [];
  const canWrap = kind === 'macro' && !isColl && !!text.trim() && (wrap || !codeLibIsMacro(text, lang));
  const guessed = code.trim() ? guessAsmLang(code, lang) : lang;
  // a macro in a collection is named as its macro
  const macroNamed = inColl ? macroName(name) : '';
  // another item of that name in the library: this one gets a name of its own
  const others = (items ?? []).filter(i => i.kind === kind && !(editing.was && !editing.was.macro && i.kind === editing.was.kind && i.file === editing.was.file));
  const file = codeLibFileName(name || 'untitled', others.map(i => i.file));
  const clash = !inColl && !!name.trim() && file.toLowerCase() !== `${codeLibStem(name)}.asm`.toLowerCase();
  // (an item keeps its file when its name stays, any case: a file put there by hand its extension)
  const keeps = was && !editing.was?.macro && was.kind === kind && codeLibStem(name).toLowerCase() === was.name.toLowerCase();
  const fileShown = target ? target.file : into === NEW && inColl ? codeLibFileName(collName || 'untitled', (items ?? []).filter(i => i.kind === 'macro').map(i => i.file)) : keeps ? `${codeLibStem(name)}${/\.[^.]+$/.exec(was!.file)?.[0] ?? '.asm'}` : file;
  const sameColl = !!target && editing.was?.macro && editing.was.file === target.file;
  const twice = target?.macros?.some(s => s.name === macroNamed && !(sameColl && s.name === editing.was!.macro));
  const sameNew = into === NEW && collections.find(c => c.name.toLowerCase() === codeLibStem(collName).toLowerCase());
  const problem = !name.trim() ? 'Give it a name.' : !code.trim() ? 'There is no code.'
    : inColl && !macroNamed ? 'A macro\'s name starts with a letter or _.'
      : inColl && !def ? 'A collection takes one macro: make the code a macro of that name.'
        : inColl && into === NEW && !collName.trim() ? 'Give the new collection a name.'
          : inColl && sameNew ? `There is a collection named ${sameNew.name}: pick it in the list.`
            : target && target.lang !== lang ? `${target.name} is written for ${LANG_TITLE[target.lang]}.`
              : twice ? `${target!.name} has a macro named ${macroNamed} already.` : null;
  const T = CODE_LIB_TITLE[kind];
  const heading = was ? `Edit ${was.name}` : target ? `Add a macro to ${target.name}` : `Add to the ${T.lib}`;
  const saveIt = async () => {
    if (problem || busy) return;
    setBusy(true);
    try {
      const r = await save({
        kind, name: (inColl ? macroNamed : name).trim(), code, lang, description: description.replace(/^(\s*\n)+/, '').trimEnd(), ...(color ? { color } : {}), ...(editing.from ? { from: editing.from } : {}), ...(editing.was ? { was: editing.was } : {}),
        ...(inColl ? { into: target ? { file: target.file } : { name: collName.trim() } } : {}), ...(isColl ? { collection: true } : {}),
      });
      toast(r.macro ? `${r.macro} is ${sameColl ? 'saved in' : 'in'} ${r.item.name}${sameColl ? '' : ` (${r.item.file})`}` : was ? `${r.item.name} is saved` : `${r.item.name} is in the ${T.lib} (${r.item.file})`, 'ok');
      onSaved(); onClose();
    } catch (e) { toast(`It was not saved: ${errorText(e)}`, 'err'); setBusy(false); }
  };
  const trash = () => {
    if (!was || !editing.was) return;
    remove(editing.was).then(() => { toast(was.macro ? `${was.name} is out of ${was.in} (and in the Recycle Bin)` : `${was.file} is in the Recycle Bin`, 'ok'); onClose(); }, e => toast(`Could not move it to the Recycle Bin: ${errorText(e)}`, 'err'));
  };
  const ctrlEnter = (e: KeyboardEvent) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void saveIt(); } };
  return (
    <Modal title={heading} onClose={onClose} className="cl-dialog">
      {/* (no form: an Enter that opened the dialog from the palette must not save it; Ctrl+Enter saves) */}
      <div className="modal-body" onKeyDown={ctrlEnter}>
        <div className="cl-dlg-row">
          {!isColl && !editing.was?.macro && <div className="field"><span>Library</span>
            <div className="seg" role="radiogroup" aria-label="Library">
              {(['macro', 'code'] as const).map(k => <button key={k} type="button" role="radio" aria-checked={kind === k} className={cx(kind === k && 'on')}
                onClick={() => { setKind(k); if (k === 'code') setWrap(false); else if (!was && text.trim() && !codeLibIsMacro(text, lang)) setWrap(true); }}>{k === 'macro' ? 'Macros' : 'Code'}</button>)}
            </div></div>}
          <div className="field"><span>Assembler</span>
            <div className="seg" role="radiogroup" aria-label="Assembler">
              {(['kickass', '64tass'] as const).map(l => <button key={l} type="button" role="radio" aria-checked={lang === l} className={cx(lang === l && 'on')} onClick={() => setLang(l)}>{LANG_TITLE[l]}</button>)}
            </div></div>
          {kind === 'macro' && !isColl && <label className="field cl-into"><span>Put it in</span>
            <select value={into} onChange={e => setInto(e.target.value)} aria-label="Put it in">
              <option value={OWN}>A file of its own</option>
              {collections.length > 0 && <optgroup label="A collection">
                {collections.map(c => <option key={c.file} value={c.file} disabled={c.lang !== lang}>{c.name} ({c.macros?.length ?? 0}){c.lang !== lang ? ` · ${LANG_TITLE[c.lang]}` : ''}</option>)}
              </optgroup>}
              <option value={NEW}>A new collection…</option>
            </select></label>}
          {inColl && into === NEW && <label className="field cl-into"><span>The new collection</span>
            <input value={collName} maxLength={CODE_LIB_NAME_MAX} spellCheck={false} onChange={e => setCollName(e.target.value)} placeholder="irq_lib" aria-label="The new collection's name" /></label>}
        </div>
        <label className="field"><span>{isColl ? 'The collection\'s name' : inColl ? 'Name (the macro\'s)' : 'Name'}</span>
          <input value={name} maxLength={CODE_LIB_NAME_MAX} spellCheck={false} autoFocus onFocus={e => e.currentTarget.select()} onChange={e => setName(e.target.value)} aria-label="Name" placeholder={kind === 'macro' ? 'WaitRaster' : 'Clear the screen'} /></label>
        {canWrap && <div className="cl-wrap">
          <label className="check"><input type="checkbox" checked={wrap} onChange={e => setWrap(e.target.checked)} /> Make the code a macro of that name</label>
          {wrap && <label className="field cl-params"><span>Parameters</span>
            <input className="mono" value={params} spellCheck={false} onChange={e => setParams(e.target.value)} placeholder="none (line, color …)" /></label>}
        </div>}
        <label className="field"><span>Code</span>
          <textarea className="mono cl-code-edit" value={code} rows={13} spellCheck={false} wrap="off" aria-label="Code"
            onChange={e => { setText(e.target.value); setWrap(false); }} /></label>
        <div className="cl-notes small">
          {isColl ? <span className="muted">A collection of {defs.length} macro{defs.length === 1 ? '' : 's'}{defs.length ? `: ${defs.slice(0, 12).map(d => d.name).join(', ')}${defs.length > 12 ? ' …' : ''}` : ''}. Each macro's description is the comments above it.</span>
            : kind === 'macro' && def ? <span className="muted">{wrap ? 'A macro: ' : 'Called as '}<span className="mono">{codeLibSignature(inColl && macroNamed && def.name !== macroNamed ? { ...def, name: macroNamed } : def, lang)}</span>{wrap ? ' (change the code by hand and it is kept as you write it)' : inColl && def.name !== macroNamed && macroNamed ? ' (renamed as the name says)' : ''}</span>
              : kind === 'macro' && defs.length > 1 ? <span className="muted">{defs.length} macros: {defs.map(d => d.name).join(', ')}. {inColl ? '' : 'In a file of its own it is a collection of them, each listed as one of its own.'}</span>
                : kind === 'macro' && code.trim() ? <span className="warn-text"><Icon name="warn" size={12} /> No macro in the code: Insert call has nothing to call.</span> : null}
          {guessed !== lang && <span className="warn-text"><Icon name="warn" size={12} /> The code looks like {LANG_TITLE[guessed]}. <button type="button" className="linkish" onClick={() => setLang(guessed)}>Use {LANG_TITLE[guessed]}</button></span>}
        </div>
        <label className="field"><span>Description</span>
          <textarea value={description} rows={4} maxLength={CODE_LIB_DESCRIPTION_MAX} placeholder={inColl ? 'What it does (written as the comments above it in the collection)' : 'What it does, what it needs, what it changes…'} aria-label="Description" onChange={e => setDescription(e.target.value)} /></label>
        <ColorPicker value={color} onChange={setColor} none />
        <p className="small muted cl-made">
          {was ? `Made ${codeLibTime(was.created)}${!was.macro && was.changed > was.created + 60_000 ? ` · changed ${codeLibTime(was.changed)}` : ''}` : 'Made now'}
          {editing.from ? ` · from ${editing.from}` : ''} · <span className="mono">{CODE_LIB_FOLDERS[kind]}\{fileShown}</span>
          {inColl && <span>{target ? ` (in ${target.name})` : ' (a new collection)'}</span>}
          {clash && <span className="warn-text"> (there is a {T.one} named {name.trim()} already)</span>}
        </p>
      </div>
      <div className="modal-foot">
        {was && <button type="button" className="btn ghost" onClick={trash}><Icon name="trash" size={13} />{was.macro ? `Take it out of ${was.in}` : 'Move to the Recycle Bin'}</button>}
        <span className="grow" />
        {problem ? <span className="small muted">{problem}</span> : <span className="small muted">Ctrl+Enter saves</span>}
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button type="button" className="btn primary" disabled={!!problem || busy} onClick={() => void saveIt()}>{was ? 'Save' : inColl ? `Add to ${target ? target.name : collName.trim() || 'the collection'}` : `Add to ${kind === 'macro' ? 'Macros' : 'Code'}`}</button>
      </div>
    </Modal>
  );
}
