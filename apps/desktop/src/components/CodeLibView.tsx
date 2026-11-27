/* The macro and code libraries in the side panel (spec 10.8): the macros and the pieces of code the user keeps for every
 * Assembler project, a library each, in alphabetical order (a group a letter, the letters above the list go to theirs),
 * each with its colour, its description and when it was made. The search looks through names, descriptions and the
 * code; a colour above the list shows only the items of that colour. A click opens an item (its whole description,
 * its code, where it came from), a double-click puts it in the source where the Assembler's caret is: a macro's call
 * when the project defines it, else its definition; a piece of code as it is. Lines selected in the Assembler become
 * an item with right-click → Add to the macro library… (or the code library), or the + here.
 *
 * A collection (a file with several macros: irq_lib.asm) is a row of its own that opens on its macros, each one as an
 * item is; A–Ö lists every macro under its own letter instead, its collection's name beside it. Files from anywhere are
 * put in a library (the import button), and macros exported to a file or a collection (the export dialog). */
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  CODE_LIB_LETTERS, codeLibGroups, codeLibHit, codeLibMacros, codeLibMatches, codeLibNeeds, codeLibSignature, codeLibSubItems, isBookmarkColor, LANG_TITLE,
  type CodeLibEntry, type CodeLibItem, type CodeLibKind, type CodeLibMacro, type ScriptLang,
} from '@mimir/core';
import type { MenuItem } from '../lib/types';
import { Icon } from '../lib/icons';
import { cx, errorText } from '../lib/util';
import { useAsmLink } from '../store/asmlink';
import { codeLibExportKey, sameCodeLib, useCodeLib, type CodeLibRef } from '../store/codelib';
import { bookmarkCss } from './Bookmarks';

const kr = typeof window !== 'undefined' ? window.kr : undefined;

/** a time as the lists show it: 2026-11-26 21:14 (`day`: the date only) */
export function codeLibTime(ms: number, day = false): string {
  const d = new Date(ms), p = (n: number) => String(n).padStart(2, '0');
  const date = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  return day ? date : `${date} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
/** the libraries' names, one and many */
export const CODE_LIB_TITLE: Record<CodeLibKind, { one: string; many: string; lib: string }> = {
  macro: { one: 'macro', many: 'macros', lib: 'macro library' }, code: { one: 'piece of code', many: 'pieces of code', lib: 'code library' },
};
/** the macro an item of the macro library defines (its first) */
export const itemMacro = (i: Pick<CodeLibItem, 'kind' | 'code' | 'lang'>): CodeLibMacro | null => (i.kind === 'macro' ? codeLibMacros(i.code, i.lang)[0] ?? null : null);
const clVar = (c?: string) => (c && isBookmarkColor(c) ? ({ '--cl': bookmarkCss(c) }) as CSSProperties : undefined);
const refOf = (e: CodeLibEntry): CodeLibRef => ({ kind: e.kind, file: e.file, ...(e.macro ? { macro: e.macro } : {}) });
const shortPath = (p: string) => (p.length > 46 ? `…${p.slice(-45)}` : p);
const nMacros = (n: number) => `${n} macro${n === 1 ? '' : 's'}`;

/** what an item is put in the source as: a macro's call, its definition (`code`; a collection's macro with those it
 *  uses), or a collection's import line */
export type CodeLibInsert = 'code' | 'call' | 'import';

export interface CodeLibViewProps {
  desktop: boolean;
  /** the Assembler project's assembler (null: no Assembler project: nothing to put the code in) */
  lang: ScriptLang | null;
  /** an item put in the source where the Assembler's caret is (a collection's macro an entry of its own) */
  onInsert: (item: CodeLibEntry, how: CodeLibInsert) => void;
  /** a new item, of the lines selected in the Assembler (the dialog); `into`: a collection it goes in */
  onNew: (kind: CodeLibKind, into?: string) => void;
  onMenu: (x: number, y: number, items: MenuItem[]) => void;
  onCopy: (text: string, what: string) => void;
  toast: (msg: string, kind?: 'info' | 'ok' | 'warn' | 'err') => void;
}

export function CodeLibView({ desktop, lang, onInsert, onNew, onMenu, onCopy, toast }: CodeLibViewProps) {
  const { listing, loading, error, kind, q, color, open, expanded, flat, set, setFlat, toggle, load, remove, importFiles, exportMacros } = useCodeLib();
  const defined = useAsmLink(s => s.macroDefined);
  // (read when the view is shown: the folders may have changed outside Mimir)
  useEffect(() => { void load(); }, [load]);
  const all = useMemo(() => listing?.items ?? [], [listing]);
  const ofKind = useMemo(() => all.filter(i => i.kind === kind), [all, kind]);
  const collections = ofKind.filter(i => i.collection);
  // every macro as an entry of its own (a collection's too)
  const entries = useMemo(() => all.flatMap(i => (i.collection ? codeLibSubItems(i) : [i])), [all]);
  const filtering = !!q.trim() || !!color;
  const colorOk = (c?: string) => !color || (c ?? '') === color;
  const entryOk = (e: CodeLibEntry) => codeLibMatches(e, q) && colorOk(e.color);
  const count = (k: CodeLibKind) => entries.filter(e => e.kind === k && (!filtering || entryOk(e))).length;
  const flatOn = flat && kind === 'macro' && collections.length > 0;

  // what the list shows: the items (a collection with the macros of it shown), or every macro by its own letter
  const tree = useMemo(() => {
    const out: { item: CodeLibItem; subs: CodeLibEntry[]; self: boolean }[] = [];
    for (const i of ofKind) {
      if (!i.collection) { if (!filtering || entryOk(i)) out.push({ item: i, subs: [], self: true }); continue; }
      const subs = codeLibSubItems(i);
      const self = !!q.trim() && codeLibMatches({ ...i, code: '' }, q) && colorOk(i.color);
      const shown = !filtering ? subs : self ? subs : subs.filter(entryOk);
      if (!filtering || self || shown.length) out.push({ item: i, subs: shown, self });
    }
    return out;
  }, [ofKind, q, color]); // eslint-disable-line react-hooks/exhaustive-deps
  const flatEntries = useMemo(() => entries.filter(e => e.kind === kind && (!filtering || entryOk(e))), [entries, kind, q, color]); // eslint-disable-line react-hooks/exhaustive-deps
  const groups = useMemo(() => (flatOn ? codeLibGroups(flatEntries).map(g => ({ letter: g.letter, rows: g.items.map(e => ({ entry: e as CodeLibEntry })) }))
    : codeLibGroups(tree.map(t => ({ ...t, name: t.item.name, file: t.item.file }))).map(g => ({ letter: g.letter, rows: g.items.map(t => ({ coll: t })) }))), [flatOn, flatEntries, tree]);
  const shownCount = flatOn ? flatEntries.length : tree.length;
  // the colours the library's items have, in the order the picker has them
  const colors = useMemo(() => [...new Set(entries.filter(e => e.kind === kind).map(i => i.color ?? '').concat(collections.map(c => c.color ?? '')))].sort((a, b) => (a ? 1 : 0) - (b ? 1 : 0) || a.localeCompare(b)), [entries, kind, collections]);
  const letters = new Set(groups.map(g => g.letter));
  const groupRef = useRef<Record<string, HTMLDivElement | null>>({});
  const listRef = useRef<HTMLDivElement | null>(null);
  const openRef = useRef<HTMLDivElement | null>(null);
  const search = useRef<HTMLInputElement | null>(null);
  const focusTick = useCodeLibFocus();
  useEffect(() => { if (focusTick) { search.current?.focus(); search.current?.select(); } }, [focusTick]);
  // an item opened elsewhere (one just saved) is scrolled into view
  useEffect(() => { openRef.current?.scrollIntoView?.({ block: 'nearest' }); }, [open, listing]);
  // (the list is the groups' offset parent)
  const jump = (l: string) => { const g = groupRef.current[l]; if (g && listRef.current) listRef.current.scrollTop = g.offsetTop; };
  // Export again over a file changed since: the collection whose file it is, asked here
  const [overwrite, setOverwrite] = useState<{ file: string; path: string } | null>(null);

  /** what a double-click does: a macro the project defines is called, one it does not is put in; code as it is */
  const primary = (i: CodeLibEntry): 'code' | 'call' => { const m = itemMacro(i); return m && defined(m.name) ? 'call' : 'code'; };
  const reveal = (ref?: { kind: CodeLibKind; file?: string }) => { kr?.codelibReveal(ref ?? { kind }).catch(e => toast(`Could not open the folder: ${errorText(e)}`, 'err')); };
  const collOf = (e: CodeLibEntry) => (e.macro ? all.find(i => i.kind === e.kind && i.file === e.file) ?? null : null);
  const edit = (i: CodeLibEntry) => {
    const coll = collOf(i);
    const own = coll?.macros?.find(m => m.name === i.macro);
    // (a collection's macro: its own colour, not its collection's)
    set({ editing: { kind: i.kind, lang: i.lang, code: i.code, name: i.name, ...(i.from ? { from: i.from } : {}), was: refOf(i), ...(coll ? { into: { file: coll.file }, color: own?.color ?? '' } : {}) } });
  };
  const trash = (i: CodeLibEntry) => remove(refOf(i)).then(
    () => toast(i.macro ? `${i.name} is out of ${i.in} (and in the Recycle Bin as ${i.name}.asm)` : `${i.file} is in the Recycle Bin (${listing?.folders[i.kind] ?? CODE_LIB_TITLE[i.kind].lib})`, 'ok'),
    e => toast(`Could not move it to the Recycle Bin: ${errorText(e)}`, 'err'));
  const exportAgain = (c: CodeLibItem, force = false) => {
    setOverwrite(null);
    exportMacros({ macros: [{ kind: c.kind, file: c.file }], to: 'again', lines: false, force }).then(r => {
      if (r.changed && r.path) { setOverwrite({ file: c.file, path: r.path }); toast(`${r.path} was changed since Mimir wrote or read it: overwrite it?`, 'warn'); return; }
      toast(`Exported ${c.name} to ${r.path} (${nMacros(r.count)})`, 'ok');
    }, e => toast(`It was not exported: ${errorText(e)}`, 'err'));
  };
  const insertMenu = (i: CodeLibEntry): MenuItem[] => {
    const m = itemMacro(i);
    if (!m) return [{ label: 'Insert in the source', icon: 'play' as const, run: () => onInsert(i, 'code') }];
    return [{ label: `Insert the call: ${codeLibSignature(m, i.lang)}`, icon: 'play' as const, run: () => onInsert(i, 'call') }, { label: 'Insert its definition', run: () => onInsert(i, 'code') }];
  };
  const menu = (i: CodeLibEntry, x: number, y: number) => {
    onMenu(x, y, [
      { header: i.macro ? `${i.name} · in ${i.in}` : i.name },
      ...insertMenu(i),
      { label: 'Copy the code', icon: 'copy', run: () => onCopy(i.code, `Copied ${i.name}`) },
      { sep: true },
      { label: 'Edit…', icon: 'pencil', run: () => edit(i) },
      ...(i.kind === 'macro' ? [{ label: 'Export…', icon: 'upload' as const, run: () => set({ exporting: [refOf(i)] }) }] : []),
      { label: i.macro ? `Show ${i.in}'s file` : 'Show its file', icon: 'folder', run: () => reveal({ kind: i.kind, file: i.file }) },
      { sep: true },
      { label: i.macro ? `Take it out of ${i.in} (to the Recycle Bin)` : 'Move to the Recycle Bin', icon: 'trash', run: () => void trash(i) },
    ]);
  };
  const collMenu = (c: CodeLibItem, x: number, y: number) => {
    const was = listing?.exports[codeLibExportKey(c)];
    onMenu(x, y, [
      { header: `${c.name} · ${nMacros(c.macros?.length ?? 0)}` },
      { label: expanded.includes(c.file) ? 'Close it' : 'Open it', run: () => toggle(c.file) },
      { label: 'Add a macro to it…', icon: 'plus', run: () => onNew('macro', c.file) },
      ...(lang ? [{ label: `Insert its import (${lang === '64tass' ? '.include' : '#import'})`, icon: 'play' as const, run: () => onInsert(c, 'import') }] : []),
      { sep: true },
      { label: 'Export…', icon: 'upload', run: () => set({ exporting: [{ kind: c.kind, file: c.file }] }) },
      ...(was ? [{ label: `Export again to ${shortPath(was.path)}`, icon: 'upload' as const, run: () => exportAgain(c) }] : []),
      { label: 'Edit…', icon: 'pencil', run: () => edit(c) },
      { label: 'Show its file', icon: 'folder', run: () => reveal({ kind: c.kind, file: c.file }) },
      { sep: true },
      { label: 'Move to the Recycle Bin', icon: 'trash', run: () => void trash(c) },
    ]);
  };
  const doImport = () => {
    importFiles(kind).then(r => {
      if (!r) return;
      const n = r.imported.length;
      if (n) toast(`${n === 1 ? r.imported[0].file : `${n} files`} put in the ${CODE_LIB_TITLE[kind].lib}${r.skipped.length ? `; not: ${r.skipped.join('; ')}` : ''}`, r.skipped.length ? 'warn' : 'ok');
      else toast(`Nothing was put in: ${r.skipped.join('; ')}`, 'warn');
    }, e => toast(`The files were not put in: ${errorText(e)}`, 'err'));
  };

  const T = CODE_LIB_TITLE[kind];
  const row = (e: CodeLibEntry, nested: boolean) => {
    const ref = refOf(e), on = sameCodeLib(open, ref);
    const coll = collOf(e), m = itemMacro(e);
    const needs = coll && e.macro ? codeLibNeeds(coll.macros ?? [], e.macro, e.lang) : [];
    return <EntryRow key={`${e.file}/${e.macro ?? ''}`} entry={e} nested={nested} showIn={!nested && !!e.in} on={on} q={q} lang={lang} macro={m} needs={needs} primary={primary(e)}
      rowRef={on ? openRef : undefined} onToggle={() => set({ open: on ? null : ref })} onInsert={how => onInsert(e, how)} onCopy={() => onCopy(e.code, `Copied ${e.name}`)}
      onEdit={() => edit(e)} onMenu={(x, y) => menu(e, x, y)} />;
  };
  return (
    <div className="side-inner cl-side">
      <div className="side-title lib-title">Macros and code
        <span className="grow" />
        <button className="icon-btn" title={`A new ${T.one} for the ${T.lib}, of the lines selected in the Assembler`} aria-label={`New ${T.one}`} disabled={!desktop} onClick={() => onNew(kind)}><Icon name="plus" size={14} /></button>
        <button className="icon-btn" title={kind === 'macro' ? 'Put macro files in the library (irq_lib.asm: a collection of its macros), from anywhere' : 'Put files in the code library, from anywhere'} aria-label={`Put files in the ${T.lib}`} disabled={!desktop} onClick={doImport}><Icon name="download" size={14} /></button>
        {kind === 'macro' && <button className="icon-btn" title="Export macros: to a file a source imports, or to a collection" aria-label="Export macros" disabled={!desktop || !ofKind.length} onClick={() => set({ exporting: open && open.kind === 'macro' ? [open] : [] })}><Icon name="upload" size={14} /></button>}
        <button className="icon-btn" title="Read the folders again" aria-label="Read the libraries again" disabled={!desktop || loading} onClick={() => void load()}><Icon name="refresh" size={14} /></button>
        <button className="icon-btn" title={listing ? `Open the folder: ${listing.folders[kind]}` : 'Open the folder'} aria-label={`Open the ${T.lib}'s folder`} disabled={!desktop} onClick={() => reveal()}><Icon name="folder" size={14} /></button>
      </div>
      <div className="seg wide lib-kinds" role="tablist" aria-label="Libraries">
        {(['macro', 'code'] as const).map(k => (
          <button key={k} role="tab" aria-selected={kind === k} className={cx(kind === k && 'on')} onClick={() => set({ kind: k, color: '' })} title={`The ${CODE_LIB_TITLE[k].lib}`}>
            {k === 'macro' ? 'Macros' : 'Code'} <span className="lib-n">{count(k)}</span></button>
        ))}
      </div>
      <div className="side-search"><Icon name="search" size={14} /><label htmlFor="cl-q" className="sr-only">Search the libraries</label>
        <input id="cl-q" ref={search} value={q} spellCheck={false} onChange={e => set({ q: e.target.value })} placeholder="Search names, descriptions, code"
          onKeyDown={e => { if (e.key === 'Escape' && q) { e.stopPropagation(); set({ q: '' }); } }} />
        {q && <button className="icon-btn cl-clear" aria-label="Clear the search" title="Clear the search (Esc)" onClick={() => set({ q: '' })}><Icon name="x" size={12} /></button>}
      </div>
      {(colors.length > 1 || (kind === 'macro' && collections.length > 0)) && <div className="cl-tools">
        {colors.length > 1 && <div className="cl-colors" role="group" aria-label="Show the colour">
          {colors.map(c => <button key={c || 'none'} type="button" className={cx('bm-sw', !c && 'none', color === c && 'on')} style={c ? ({ '--sw': bookmarkCss(c) }) as CSSProperties : undefined}
            aria-pressed={color === c} aria-label={c ? `Only the ${c} ones` : 'Only those without a colour'} title={`${c ? `Only the ${T.many} in this colour` : `Only the ${T.many} without a colour`}${color === c ? ' (a click shows them all again)' : ''}`}
            onClick={() => set({ color: color === c ? '' : c })} />)}
          {color && <button type="button" className="linkish small" onClick={() => set({ color: '' })}>All colours</button>}
        </div>}
        {kind === 'macro' && collections.length > 0 && <div className="seg cl-shape" role="radiogroup" aria-label="List the macros">
          <button type="button" role="radio" aria-checked={!flat} className={cx(!flat && 'on')} title="The collections with their macros in them" onClick={() => setFlat(false)}><Icon name="library" size={12} />Collections</button>
          <button type="button" role="radio" aria-checked={flat} className={cx(flat && 'on')} title="Every macro under its own letter, a collection's too" onClick={() => setFlat(true)}>A–Ö</button>
        </div>}
      </div>}
      {shownCount > 0 && <div className="cl-letters" role="navigation" aria-label="Letters">
        {CODE_LIB_LETTERS.filter(l => letters.has(l) || !'ÅÄÖ'.includes(l)).map(l => (
          <button key={l} type="button" disabled={!letters.has(l)} aria-label={`Go to ${l === '#' ? 'the names that start with no letter' : l}`} onClick={() => jump(l)}>{l}</button>))}
      </div>}
      {error && <p className="side-hint err-text" role="alert">{error}</p>}
      <div className="cl-list" ref={listRef} role="list" aria-label={kind === 'macro' ? 'The macro library' : 'The code library'}>
        {groups.map(g => (
          <div key={g.letter} className="cl-group" role="group" aria-label={g.letter} ref={el => { groupRef.current[g.letter] = el; }}>
            <div className="cl-letter" aria-hidden>{g.letter}<span className="lib-n">{g.rows.length}</span></div>
            {g.rows.map(r => {
              if ('entry' in r && r.entry) return row(r.entry, false);
              const t = (r as { coll: (typeof tree)[number] }).coll;
              if (!t.item.collection) return row(t.item, false);
              const c = t.item, isOpen = filtering || expanded.includes(c.file), n = c.macros?.length ?? 0, first = c.description.split('\n')[0];
              const was = listing?.exports[codeLibExportKey(c)];
              return (
                <div key={c.file} role="listitem" className={cx('cl-item cl-coll', isOpen && 'expanded', c.color && 'tinted')} style={clVar(c.color)}>
                  <button className="cl-row" aria-expanded={isOpen} title={`${c.name}: a collection of ${nMacros(n)}${first ? ` · ${first}` : ''}\nMade ${codeLibTime(c.created)}${c.from ? ` · from ${c.from}` : ''}\nClick to ${isOpen ? 'close' : 'open'} it, right-click for more`}
                    onClick={() => { if (!filtering) toggle(c.file); }} onContextMenu={e => { e.preventDefault(); collMenu(c, e.clientX, e.clientY); }}>
                    <span className="cl-name-row"><Icon name="chevron" size={11} className={cx('cl-chev', isOpen && 'on')} /><Icon name="library" size={12} className="cl-coll-icon" />
                      <span className="cl-name">{c.name}</span><span className="lib-n" title={filtering && t.subs.length !== n ? `${t.subs.length} of its ${n} macros match` : undefined}>{filtering && t.subs.length !== n ? `${t.subs.length}/${n}` : n}</span>
                      <span className="cl-date mono">{codeLibTime(c.created, true)}</span></span>
                    {first && <span className="cl-desc">{first}</span>}
                  </button>
                  {isOpen && <>
                    <div className="cl-coll-bar">
                      <button className="btn small" disabled={!lang} title={lang ? `Put the line that imports ${c.file} at the top of the source: all its macros are the project's` : 'Open an Assembler project to put it in a source'} onClick={() => onInsert(c, 'import')}><Icon name="play" size={12} />Import it</button>
                      <button className="btn small" title={`Add a macro to ${c.name}, of the lines selected in the Assembler`} onClick={() => onNew('macro', c.file)}><Icon name="plus" size={12} />Add</button>
                      <button className="btn small" title="Export it, or some of its macros, to a file or another collection" onClick={() => set({ exporting: [{ kind: c.kind, file: c.file }] })}><Icon name="upload" size={12} />Export…</button>
                      {was && <button className="btn small" title={`Write it to ${was.path} again (where it was exported to or read from)`} aria-label={`Export ${c.name} again`} onClick={() => exportAgain(c)}><Icon name="refresh" size={12} />Again</button>}
                      <span className="grow" />
                      <button className="icon-btn" aria-label={`More for ${c.name}`} title="More" onClick={e => { const b = e.currentTarget.getBoundingClientRect(); collMenu(c, b.left, b.bottom + 2); }}><Icon name="more" size={14} /></button>
                    </div>
                    {overwrite?.file === c.file && <div className="cl-confirm small" role="alert">
                      <span><span className="mono">{overwrite.path}</span> was changed since Mimir wrote or read it.</span>
                      <button className="btn small danger" onClick={() => exportAgain(c, true)}>Overwrite it</button>
                      <button className="btn small" onClick={() => setOverwrite(null)}>Keep it</button>
                    </div>}
                    <div className="cl-subs" role="list" aria-label={`The macros of ${c.name}`}>
                      {t.subs.map(e => row(e, true))}
                      {!n && <p className="side-hint small">No macros in it yet: <b>Add</b> puts in the lines selected in the Assembler.</p>}
                    </div>
                  </>}
                </div>);
            })}
          </div>
        ))}
        {!desktop ? <p className="side-hint">The libraries are folders on your computer: they need the desktop app.</p>
          : listing && !ofKind.length ? <div className="side-hint lib-empty">
            <p><b>No {T.many} yet.</b></p>
            <p>Select the lines in the Assembler, right-click them and choose <b>Add to the {T.lib}…</b> (or <b>+</b> here). {kind === 'macro' ? 'Code that is not a macro yet is made one; a click on a macro\'s first line takes the whole macro.' : 'The code is kept as it is.'}</p>
            {kind === 'macro' && <p>Files of macros you have (irq_lib.asm) go in with <button type="button" className="linkish" onClick={doImport}>Put files in…</button>: each a collection of its macros.</p>}
            <p>Each is a file in <button type="button" className="linkish" onClick={() => reveal()}>{listing.folders[kind]}</button>, which a source can import too.</p>
          </div>
            : ofKind.length > 0 && !shownCount ? <p className="side-hint">No {T.one === 'macro' ? 'macro' : 'code'} matches{q.trim() ? ` “${q.trim()}”` : ''}{color ? ' in that colour' : ''}.{count(kind === 'macro' ? 'code' : 'macro') ? ` ${count(kind === 'macro' ? 'code' : 'macro')} in ${kind === 'macro' ? 'Code' : 'Macros'}.` : ''}</p> : null}
      </div>
      {listing && <button type="button" className="linkish small lib-dir mono" title="Open the folder (Settings → General → Library folder moves it)" onClick={() => reveal()}>{listing.folders[kind]}</button>}
    </div>
  );
}

/** a row of the list: an item, or a collection's macro (`nested` in its collection; `showIn`: its collection's name
 *  beside it, as A–Ö lists it), opened on a click */
function EntryRow({ entry: i, nested, showIn, on, q, lang, macro: m, needs, primary, rowRef, onToggle, onInsert, onCopy, onEdit, onMenu }: {
  entry: CodeLibEntry; nested: boolean; showIn: boolean; on: boolean; q: string; lang: ScriptLang | null; macro: CodeLibMacro | null; needs: string[]; primary: 'code' | 'call';
  rowRef?: React.Ref<HTMLDivElement>; onToggle: () => void; onInsert: (how: 'code' | 'call') => void; onCopy: () => void; onEdit: () => void; onMenu: (x: number, y: number) => void;
}) {
  const sig = m ? codeLibSignature(m, i.lang) : null, hit = codeLibHit(i, q), first = i.description.split('\n')[0];
  const other = lang && i.lang !== lang;
  return (
    <div role="listitem" className={cx('cl-item', nested && 'nested', on && 'open', i.color && 'tinted')} style={clVar(i.color)} ref={rowRef}>
      <button className="cl-row" aria-expanded={on} title={`${i.name}${i.in ? ` (in ${i.in})` : ''}${first ? ` · ${first}` : ''}\nMade ${codeLibTime(i.created)}${i.from ? ` · from ${i.from}` : ''}\nClick to see it, double-click to put ${primary === 'call' ? 'its call' : 'it'} in the source`}
        onClick={e => { if (e.detail < 2) onToggle(); }} onDoubleClick={() => { if (lang) onInsert(primary); }}
        onContextMenu={e => { e.preventDefault(); onMenu(e.clientX, e.clientY); }}>
        <span className="cl-name-row"><span className="cl-name">{i.name}</span>{showIn && <span className="cl-in" title={`In the collection ${i.in}`}>{i.in}</span>}{other && <span className="cl-lang" title={`Written for ${LANG_TITLE[i.lang]}: the project is ${LANG_TITLE[lang!]}`}>{i.lang === '64tass' ? '64tass' : 'Kick'}</span>}
          <span className="cl-date mono" title={`Made ${codeLibTime(i.created)}${i.changed > i.created + 60_000 ? `, changed ${codeLibTime(i.changed)}` : ''}`}>{codeLibTime(i.created, true)}</span></span>
        {sig && sig !== i.name && <span className="cl-sig mono">{sig}</span>}
        {first ? <span className="cl-desc">{first}</span> : !sig || sig === i.name ? <span className="cl-desc muted">{i.code.split('\n').find(l => l.trim())?.trim() ?? ''}</span> : null}
        {hit === 'code' && <span className="cl-hit small">found in the code</span>}
      </button>
      {on && <ItemBody item={i} lang={lang} macro={m} needs={needs} primary={primary} onInsert={onInsert} onCopy={onCopy} onEdit={onEdit} onMore={onMenu} />}
    </div>);
}

/** an item opened in the list: its description, its code, when it was made and where it came from, and what to do */
function ItemBody({ item: i, lang, macro, needs, primary, onInsert, onCopy, onEdit, onMore }: { item: CodeLibEntry; lang: ScriptLang | null; macro: CodeLibMacro | null; needs: string[]; primary: 'code' | 'call';
  onInsert: (how: 'code' | 'call') => void; onCopy: () => void; onEdit: () => void; onMore: (x: number, y: number) => void }) {
  const [all, setAll] = useState(false);
  const lines = i.code.split('\n'), long = lines.length > 14 && !all;
  const no = lang ? '' : 'Open an Assembler project to put it in a source';
  return (
    <div className="cl-body">
      {i.description ? <div className="cl-text">{i.description}</div> : <div className="muted small">No description. Edit gives it one.</div>}
      <pre className="cl-code mono" aria-label={`The code of ${i.name}`}>{long ? lines.slice(0, 14).join('\n') : i.code}</pre>
      {long && <button type="button" className="linkish small cl-more" onClick={() => setAll(true)}>All {lines.length} lines</button>}
      <div className="cl-meta small muted">
        <span>Made {codeLibTime(i.created)}{i.changed > i.created + 60_000 ? ` · changed ${codeLibTime(i.changed)}` : ''}</span>
        <span>{LANG_TITLE[i.lang]}{i.in ? ` · in the collection ${i.in}` : i.own ? ' · a file put in the folder' : ''}</span>
        {needs.length > 0 && <span title="Insert definition puts these in too (those the project does not define)">Uses {needs.join(', ')}</span>}
        {i.from && <span title="Where it was taken from">From {i.from}</span>}
      </div>
      <div className="bm-actions">
        {macro ? <>
          <button className={cx('btn small', primary === 'call' && 'primary')} disabled={!lang} title={no || `Put ${codeLibSignature(macro, i.lang)} where the caret is (Tab goes from parameter to parameter)`} onClick={() => onInsert('call')}><Icon name="play" size={12} />Insert call</button>
          <button className={cx('btn small', primary === 'code' && 'primary')} disabled={!lang} title={no || `Put the macro's definition in the source, at the caret's line${needs.length ? `, with ${needs.join(', ')} it uses` : ''}`} onClick={() => onInsert('code')}>Insert definition</button>
        </> : <button className="btn small primary" disabled={!lang} title={no || 'Put the code in the source, at the caret\'s line'} onClick={() => onInsert('code')}><Icon name="play" size={12} />Insert</button>}
        <button className="btn small" onClick={onCopy} title="Copy the code"><Icon name="copy" size={12} />Copy</button>
        <button className="btn small" onClick={onEdit}><Icon name="pencil" size={12} />Edit</button>
        <button className="icon-btn" aria-label={`More for ${i.name}`} title="More" onClick={e => { const r = e.currentTarget.getBoundingClientRect(); onMore(r.left, r.bottom + 2); }}><Icon name="more" size={14} /></button>
      </div>
    </div>
  );
}

/** the search asked for (the palette's Search the macro library: the view's search field focused) */
let focusSet: ((n: number) => void) | null = null, focusN = 0, pending = false;
function useCodeLibFocus(): number {
  const [n, setN] = useState(0);
  useEffect(() => { focusSet = setN; if (pending) { pending = false; setN(++focusN); } return () => { focusSet = null; }; }, []);
  return n;
}
/** the view's search field focused (now, or once the view is shown) */
export function focusCodeLibSearch() { if (focusSet) focusSet(++focusN); else pending = true; }
