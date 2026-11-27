/* Add to the macro library / the code library, a macro's Edit and a file's (spec 10.8): its library, name, assembler,
 * code, description and colour. Lines taken from a source that are not a macro become one for the macro library
 * (wrapped in `.macro Name(…) { … }`, 64tass's `Name .macro … .endm`; the name and the parameters typed are the
 * macro's), until the code is changed by hand. A macro is in a file: a file of its own (named after it), any file of the
 * library (one with one macro takes a second), or a new file; its name is its macro's. A file itself (Edit the file…):
 * its name, its description, its colour and its whole code. When it was made is shown, and where the code came from. */
import { useMemo, useState, type KeyboardEvent } from 'react';
import { CODE_LIB_DESCRIPTION_MAX, CODE_LIB_FOLDERS, CODE_LIB_NAME_MAX, codeLibFileName, codeLibIsMacro, codeLibMacros, codeLibOrder, codeLibSignature, codeLibStem, codeLibWrap, guessAsmLang, LANG_TITLE, macroName, splitLabel, type CodeLibKind, type ScriptLang } from '@mimir/core';
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
/** the file a macro is in: a file of its own, a file of the library (its file's name), or a new file */
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
  // a macro of the library edited, or a file of the macro library itself (Edit the file…)
  const macroEdit = !!editing.was?.macro;
  const fileEdit = !!editing.was && !macroEdit && editing.kind === 'macro';
  const files = useMemo(() => codeLibOrder((items ?? []).filter(i => i.kind === 'macro')), [items]);
  const fileOfWas = macroEdit ? files.find(f => f.file === editing.was!.file) ?? null : null;
  // (a macro alone in its file: that file is its own)
  const alone = !!fileOfWas && (fileOfWas.macros?.length ?? 0) <= 1;
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
  // the file it goes in, and a new file's name
  const [into, setInto] = useState(editing.into ? ('file' in editing.into ? (alone && editing.into.file === fileOfWas?.file ? OWN : editing.into.file) : NEW) : OWN);
  const [newFile, setNewFile] = useState(editing.into && 'name' in editing.into ? editing.into.name : '');
  const [busy, setBusy] = useState(false);
  const isMacro = kind === 'macro' && !fileEdit;
  const target = isMacro && into && into !== NEW ? files.find(c => c.file === into) ?? null : null;
  // in a file of the library or a new one (not a file of its own): named as its macro
  const inFile = isMacro && into !== OWN;
  const paramList = useMemo(() => params.split(/[,\s]+/).map(macroName).filter(Boolean), [params]);
  const code = wrap ? codeLibWrap(text, name, paramList, lang) : text;
  const def = kind === 'macro' ? codeLibIsMacro(code, lang) : null;
  const defs = kind === 'macro' ? codeLibMacros(code, lang) : [];
  const canWrap = isMacro && !!text.trim() && (wrap || !codeLibIsMacro(text, lang));
  const guessed = code.trim() ? guessAsmLang(code, lang) : lang;
  const macroNamed = inFile || macroEdit ? macroName(name) : '';
  // another item of that name in the library: this one gets a name of its own
  const others = (items ?? []).filter(i => i.kind === kind && !(editing.was && i.kind === editing.was.kind && i.file === editing.was.file));
  const file = codeLibFileName(name || 'untitled', others.map(i => i.file));
  const clash = !inFile && !macroEdit && !!name.trim() && file.toLowerCase() !== `${codeLibStem(name)}.asm`.toLowerCase();
  // (an item keeps its file when its name stays, any case: a file put there by hand its extension)
  const keeps = was && !macroEdit && was.kind === kind && codeLibStem(name).toLowerCase() === was.name.toLowerCase();
  const fileShown = target ? target.file : into === NEW && inFile ? codeLibFileName(newFile || 'untitled', files.map(i => i.file)) : alone ? fileOfWas!.file : keeps ? `${codeLibStem(name)}${/\.[^.]+$/.exec(was!.file)?.[0] ?? '.asm'}` : file;
  const sameFile = !!target && macroEdit && editing.was!.file === target.file;
  const twice = target?.macros?.some(s => s.name === macroNamed && !(sameFile && s.name === editing.was!.macro));
  const sameNew = into === NEW && files.find(c => c.name.toLowerCase() === codeLibStem(newFile).toLowerCase());
  const problem = !name.trim() ? 'Give it a name.' : !code.trim() ? 'There is no code.'
    : (inFile || macroEdit) && !macroNamed ? 'A macro\'s name starts with a letter or _.'
      : (inFile || macroEdit) && !def ? 'One macro at a time: make the code a macro of that name.'
        : inFile && into === NEW && !newFile.trim() ? 'Give the new file a name.'
          : inFile && sameNew ? `There is a file named ${sameNew.file}: pick it in the list.`
            : target && target.lang !== lang ? `${target.file} is written for ${LANG_TITLE[target.lang]}.`
              : twice ? `${target!.file} has a macro named ${macroNamed} already.` : null;
  const T = CODE_LIB_TITLE[kind];
  const heading = fileEdit ? `Edit the file ${was?.file ?? ''}` : was ? `Edit ${was.name}` : target ? `Add a macro to ${target.file}` : `Add to the ${T.lib}`;
  const saveIt = async () => {
    if (problem || busy) return;
    setBusy(true);
    try {
      // (a macro alone in its file and kept there: its own file, that one)
      const where = !isMacro ? {} : inFile ? { into: target ? { file: target.file } : { name: newFile.trim() } } : alone ? { into: { file: fileOfWas!.file } } : {};
      const r = await save({
        kind, name: (inFile || macroEdit ? macroNamed : name).trim(), code, lang, description: description.replace(/^(\s*\n)+/, '').trimEnd(), ...(color ? { color } : {}), ...(editing.from ? { from: editing.from } : {}), ...(editing.was ? { was: editing.was } : {}),
        ...where,
      });
      toast(r.macro ? (was ? `${r.macro} is saved (${r.item.file})` : `${r.macro} is in ${r.item.file}`) : was ? `${r.item.file} is saved` : `${r.item.name} is in the ${T.lib} (${r.item.file})`, 'ok');
      onSaved(); onClose();
    } catch (e) { toast(`It was not saved: ${errorText(e)}`, 'err'); setBusy(false); }
  };
  const trash = () => {
    if (!was || !editing.was) return;
    const out = macroEdit && !alone;
    remove(editing.was).then(() => { toast(out ? `${was.name} is out of ${was.file} (and in the Recycle Bin)` : `${was.file} is in the Recycle Bin`, 'ok'); onClose(); }, e => toast(`Could not move it to the Recycle Bin: ${errorText(e)}`, 'err'));
  };
  const ctrlEnter = (e: KeyboardEvent) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void saveIt(); } };
  return (
    <Modal title={heading} onClose={onClose} className="cl-dialog">
      {/* (no form: an Enter that opened the dialog from the palette must not save it; Ctrl+Enter saves) */}
      <div className="modal-body" onKeyDown={ctrlEnter}>
        <div className="cl-dlg-row">
          {!fileEdit && !macroEdit && <div className="field"><span>Library</span>
            <div className="seg" role="radiogroup" aria-label="Library">
              {(['macro', 'code'] as const).map(k => <button key={k} type="button" role="radio" aria-checked={kind === k} className={cx(kind === k && 'on')}
                onClick={() => { setKind(k); if (k === 'code') setWrap(false); else if (!was && text.trim() && !codeLibIsMacro(text, lang)) setWrap(true); }}>{k === 'macro' ? 'Macros' : 'Code'}</button>)}
            </div></div>}
          <div className="field"><span>Assembler</span>
            <div className="seg" role="radiogroup" aria-label="Assembler">
              {(['kickass', '64tass'] as const).map(l => <button key={l} type="button" role="radio" aria-checked={lang === l} className={cx(lang === l && 'on')} onClick={() => setLang(l)}>{LANG_TITLE[l]}</button>)}
            </div></div>
          {isMacro && <label className="field cl-into"><span>File</span>
            <select value={into} onChange={e => setInto(e.target.value)} aria-label="File">
              <option value={OWN}>{alone ? `Its own file (${fileOfWas!.file})` : `A file of its own (${macroNamed || macroName(name) || 'Name'}.asm)`}</option>
              {files.filter(f => !(alone && f.file === fileOfWas!.file)).map(c => <option key={c.file} value={c.file} disabled={c.lang !== lang}>{c.file} ({c.macros?.length ?? 0}){c.lang !== lang ? ` · ${LANG_TITLE[c.lang]}` : ''}</option>)}
              <option value={NEW}>A new file…</option>
            </select></label>}
          {inFile && into === NEW && <label className="field cl-into"><span>The new file</span>
            <input value={newFile} maxLength={CODE_LIB_NAME_MAX} spellCheck={false} onChange={e => setNewFile(e.target.value)} placeholder="irq_lib" aria-label="The new file's name" /></label>}
        </div>
        <label className="field"><span>{fileEdit ? 'The file\'s name' : isMacro ? 'Name (the macro\'s)' : 'Name'}</span>
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
          {fileEdit ? <span className="muted">A file of {defs.length} macro{defs.length === 1 ? '' : 's'}{defs.length ? `: ${defs.slice(0, 12).map(d => d.name).join(', ')}${defs.length > 12 ? ' …' : ''}` : ''}.{defs.length > 1 ? ' Each macro\'s description is the comments above it.' : ''}</span>
            : kind === 'macro' && def ? <span className="muted">{wrap ? 'A macro: ' : 'Called as '}<span className="mono">{codeLibSignature(macroNamed && def.name !== macroNamed ? { ...def, name: macroNamed } : def, lang)}</span>{wrap ? ' (change the code by hand and it is kept as you write it)' : macroNamed && def.name !== macroNamed ? ' (renamed as the name says)' : ''}</span>
              : kind === 'macro' && defs.length > 1 ? <span className="muted">{defs.length} macros: {defs.map(d => d.name).join(', ')}. In a file of its own each of them is listed.</span>
                : kind === 'macro' && code.trim() ? <span className="warn-text"><Icon name="warn" size={12} /> No macro in the code: Insert call has nothing to call.</span> : null}
          {guessed !== lang && <span className="warn-text"><Icon name="warn" size={12} /> The code looks like {LANG_TITLE[guessed]}. <button type="button" className="linkish" onClick={() => setLang(guessed)}>Use {LANG_TITLE[guessed]}</button></span>}
        </div>
        <label className="field"><span>Description</span>
          <textarea value={description} rows={4} maxLength={CODE_LIB_DESCRIPTION_MAX} placeholder={fileEdit ? 'What the file is for' : 'What it does, what it needs, what it changes…'} aria-label="Description" onChange={e => setDescription(e.target.value)} /></label>
        <ColorPicker value={color} onChange={setColor} none />
        <p className="small muted cl-made">
          {was ? `Made ${codeLibTime(was.created)}${!was.macro && was.changed > was.created + 60_000 ? ` · changed ${codeLibTime(was.changed)}` : ''}` : 'Made now'}
          {editing.from ? ` · from ${editing.from}` : ''} · <span className="mono">{CODE_LIB_FOLDERS[kind]}\{fileShown}</span>
          {inFile && !target && <span> (a new file)</span>}
          {clash && <span className="warn-text"> (there is a {T.one} named {name.trim()} already)</span>}
        </p>
      </div>
      <div className="modal-foot">
        {was && <button type="button" className="btn ghost" onClick={trash}><Icon name="trash" size={13} />{macroEdit && !alone ? `Take it out of ${was.file}` : fileEdit ? 'Move the file to the Recycle Bin' : 'Move to the Recycle Bin'}</button>}
        <span className="grow" />
        {problem ? <span className="small muted">{problem}</span> : <span className="small muted">Ctrl+Enter saves</span>}
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button type="button" className="btn primary" disabled={!!problem || busy} onClick={() => void saveIt()}>{was ? 'Save' : inFile ? `Add to ${target ? target.file : newFile.trim() ? `${codeLibStem(newFile)}.asm` : 'the new file'}` : `Add to ${kind === 'macro' ? 'Macros' : 'Code'}`}</button>
      </div>
    </Modal>
  );
}
