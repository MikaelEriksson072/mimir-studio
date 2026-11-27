/* Export macros (spec 10.8): the macros of the macro library checked (a file whole, some of its macros, macros of
 * their own), written to a file anywhere (the save dialog: a library a source imports, irq_lib.asm) or put in a
 * file of the library (one there, or a new one; moved: out of where they were). A whole file goes as it
 * is, the rest of its file too; without Mimir's lines the file is as one writes it by hand (each macro's description
 * the comments above it). One assembler's macros in a file. */
import { useMemo, useState } from 'react';
import { codeLibMatches, codeLibOrder, codeLibSubItems, LANG_TITLE, type CodeLibItem } from '@mimir/core';
import type { CodeLibFileRequest } from '../../shared/ipc';
import { Icon } from '../lib/icons';
import { cx, errorText } from '../lib/util';
import { useCodeLib, type CodeLibRef } from '../store/codelib';
import { Modal } from './Modal';

const LINES_KEY = 'kr.codeLibExportLines';
/** a macro's key in the checked set: its file, and its name in it */
const keyOf = (file: string, macro?: string) => `${file}\n${macro ?? ''}`;

export function CodeLibExportDialog({ refs, toast, onClose }: { refs: CodeLibRef[]; toast: (msg: string, kind?: 'info' | 'ok' | 'warn' | 'err') => void; onClose: () => void }) {
  const { listing, exportMacros } = useCodeLib();
  const items = useMemo(() => codeLibOrder((listing?.items ?? []).filter(i => i.kind === 'macro')), [listing]);
  /** every macro's key a file has (each of its macros; a file of none, itself) */
  const many = (i: CodeLibItem) => (i.macros?.length ?? 0) > 1;
  const keysOf = (i: CodeLibItem) => (i.macros?.length ? i.macros.map(m => keyOf(i.file, m.name)) : [keyOf(i.file)]);
  const [checked, setChecked] = useState<Set<string>>(() => {
    const s = new Set<string>();
    for (const r of refs) { const i = items.find(x => x.file === r.file); if (!i) continue; if (r.macro) s.add(keyOf(i.file, r.macro)); else for (const k of keysOf(i)) s.add(k); }
    return s;
  });
  // (the files it was opened on open, their macros to see)
  const [open, setOpen] = useState<Set<string>>(() => new Set(refs.map(r => r.file)));
  const [q, setQ] = useState('');
  const [to, setTo] = useState<'file' | 'library'>('file');
  const [coll, setColl] = useState('');
  const [move, setMove] = useState(false);
  const [lines, setLines] = useState(() => { try { return localStorage.getItem(LINES_KEY) === '1'; } catch { return false; } });
  const [busy, setBusy] = useState(false);
  const set = (keys: string[], on: boolean) => setChecked(s => { const n = new Set(s); for (const k of keys) { if (on) n.add(k); else n.delete(k); } return n; });

  // what is exported: a file all of whose macros are checked whole, the rest by its macros
  const picked: { ref: CodeLibFileRequest; item: CodeLibItem }[] = [];
  for (const i of items) {
    const keys = keysOf(i), on = keys.filter(k => checked.has(k));
    if (!on.length) continue;
    if (on.length === keys.length) picked.push({ ref: { kind: 'macro', file: i.file }, item: i });
    else for (const m of i.macros ?? []) if (checked.has(keyOf(i.file, m.name))) picked.push({ ref: { kind: 'macro', file: i.file, macro: m.name }, item: i });
  }
  const count = checked.size;
  const langs = [...new Set(picked.map(p => p.item.lang))];
  const target = to === 'library' ? items.find(i => i.name.toLowerCase() === coll.trim().toLowerCase()) ?? null : null;
  const problem = !count ? 'Check the macros to export.' : langs.length > 1 ? 'Kick Assembler and 64tass macros do not go in one file: check one assembler\'s.'
    : to === 'library' && !coll.trim() ? 'Name the file (one there, or a new one).'
      : target && target.lang !== langs[0] ? `${target.name} is written for ${LANG_TITLE[target.lang]}.` : null;
  const go = async () => {
    if (problem || busy) return;
    setBusy(true);
    try { localStorage.setItem(LINES_KEY, lines ? '1' : '0'); } catch { /* not kept */ }
    try {
      const r = await exportMacros({ macros: picked.map(p => p.ref), to: to === 'file' ? 'file' : { collection: coll.trim() }, lines: to === 'file' ? lines : true, ...(to === 'library' && move ? { move: true } : {}) });
      if (r.canceled) { setBusy(false); return; }
      toast(r.collection ? `${r.count} macro${r.count === 1 ? '' : 's'} ${move ? 'moved' : 'put'} in ${coll.trim()} (${r.collection.file})` : `Exported ${r.count} macro${r.count === 1 ? '' : 's'} to ${r.path}`, 'ok');
      onClose();
    } catch (e) { toast(`They were not exported: ${errorText(e)}`, 'err'); setBusy(false); }
  };
  const words = q.trim();
  return (
    <Modal title="Export macros" onClose={onClose} className="cl-dialog cl-export">
      <div className="modal-body">
        <div className="side-search cl-ex-search"><Icon name="search" size={14} />
          <input value={q} spellCheck={false} onChange={e => setQ(e.target.value)} placeholder="Find macros" aria-label="Find macros" autoFocus /></div>
        <div className="cl-ex-list" role="tree" aria-label="The macros to export">
          {items.map(i => {
            const subs = many(i) ? codeLibSubItems(i) : [];
            const shownSubs = words ? subs.filter(s => codeLibMatches(s, words)) : subs;
            if (words && !codeLibMatches(i, words) && !shownSubs.length) return null;
            const keys = keysOf(i), on = keys.filter(k => checked.has(k)).length, all = on > 0 && on === keys.length;
            const isOpen = !!words || open.has(i.file);
            return (
              <div key={i.file} role="treeitem" aria-expanded={many(i) ? isOpen : undefined} aria-selected={all} className="cl-ex-item">
                <div className="cl-ex-row">
                  {many(i) ? <button type="button" className="icon-btn cl-ex-chev" aria-label={`${isOpen ? 'Close' : 'Open'} ${i.name}`} onClick={() => setOpen(s => { const n = new Set(s); if (n.has(i.file)) n.delete(i.file); else n.add(i.file); return n; })}>
                    <Icon name="chevron" size={11} className={cx('cl-chev', isOpen && 'on')} /></button> : <span className="cl-ex-chev" />}
                  <label className="check"><input type="checkbox" checked={all} ref={el => { if (el) el.indeterminate = on > 0 && !all; }} disabled={!keys.length} onChange={e => set(keys, e.target.checked)} aria-label={`Export ${i.name}`} />
                    <Icon name="doc" size={12} /><span className={cx(many(i) && 'cl-ex-coll')}>{i.file}</span></label>
                  <span className="muted small">{many(i) ? `${on ? `${on}/` : ''}${keys.length}` : ''}{i.lang === '64tass' ? ' · 64tass' : ''}</span>
                </div>
                {many(i) && isOpen && <div role="group" className="cl-ex-subs">
                  {shownSubs.map(s => <label key={s.name} className="check cl-ex-sub" role="treeitem" aria-selected={checked.has(keyOf(i.file, s.name))}>
                    <input type="checkbox" checked={checked.has(keyOf(i.file, s.name))} onChange={e => set([keyOf(i.file, s.name)], e.target.checked)} aria-label={`Export ${s.name} of ${i.name}`} />
                    <span>{s.name}</span>{s.description && <span className="muted small cl-ex-desc">{s.description.split('\n')[0]}</span>}</label>)}
                </div>}
              </div>);
          })}
          {!items.length && <p className="side-hint">No macros in the library yet.</p>}
        </div>
        <div className="cl-dlg-row cl-ex-to">
          <div className="field"><span>To</span>
            <div className="seg" role="radiogroup" aria-label="Export to">
              <button type="button" role="radio" aria-checked={to === 'file'} className={cx(to === 'file' && 'on')} onClick={() => setTo('file')}>A file…</button>
              <button type="button" role="radio" aria-checked={to === 'library'} className={cx(to === 'library' && 'on')} onClick={() => setTo('library')}>A file of the library</button>
            </div></div>
          {to === 'file' ? <label className="check cl-ex-opt"><input type="checkbox" checked={lines} onChange={e => setLines(e.target.checked)} /> With Mimir's lines (colours and dates, so it can be put back in a library as it is)</label>
            : <>
              <label className="field cl-into"><span>The file</span>
                <input list="cl-ex-colls" value={coll} spellCheck={false} onChange={e => setColl(e.target.value)} placeholder="irq_lib" aria-label="The file's name" />
                <datalist id="cl-ex-colls">{items.map(i => <option key={i.file} value={i.name} />)}</datalist></label>
              <label className="check cl-ex-opt"><input type="checkbox" checked={move} onChange={e => setMove(e.target.checked)} /> Move them (out of where they are now)</label>
            </>}
        </div>
        <p className="small muted cl-made">{to === 'file' ? 'A file checked whole goes as it is (#importonce, .var … too); the rest each with its description as comments above it.'
          : target ? `Put at the end of ${target.file} (${target.macros?.length ?? 0} macros), in its style.` : coll.trim() ? `A new file: Macros\\${coll.trim()}.asm` : 'One there, or a new one.'}</p>
      </div>
      <div className="modal-foot">
        <span className="small muted">{count} macro{count === 1 ? '' : 's'} checked</span>
        <span className="grow" />
        {problem && <span className="small muted">{problem}</span>}
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button type="button" className="btn primary" disabled={!!problem || busy} onClick={() => void go()}><Icon name="upload" size={13} />{to === 'file' ? 'Export…' : `${move ? 'Move' : 'Put'} in ${coll.trim() || 'the file'}`}</button>
      </div>
    </Modal>
  );
}
