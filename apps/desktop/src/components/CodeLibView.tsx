/* The macro and code libraries in the side panel (spec 10.8): the macros and the pieces of code the user keeps for every
 * Assembler project, a library each, in alphabetical order (a group a letter, the letters above the list go to theirs),
 * each with its colour, its description and when it was made. The search looks through names, descriptions and the
 * code; a colour above the list shows only the items of that colour. A click opens an item (its whole description,
 * its code, where it came from), a double-click puts it in the source where the Assembler's caret is: a macro's call
 * when the project defines it, else its definition; a piece of code as it is. Lines selected in the Assembler become
 * an item with right-click → Add to the macro library… (or the code library), or the + here. */
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { CODE_LIB_LETTERS, codeLibGroups, codeLibHit, codeLibMacros, codeLibMatches, codeLibSignature, isBookmarkColor, LANG_TITLE, type CodeLibItem, type CodeLibKind, type CodeLibMacro, type ScriptLang } from '@mimir/core';
import type { MenuItem } from '../lib/types';
import { Icon } from '../lib/icons';
import { cx, errorText } from '../lib/util';
import { useAsmLink } from '../store/asmlink';
import { codeLibItemOf, sameCodeLib, useCodeLib, type CodeLibRef } from '../store/codelib';
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

export interface CodeLibViewProps {
  desktop: boolean;
  /** the Assembler project's assembler (null: no Assembler project: nothing to put the code in) */
  lang: ScriptLang | null;
  /** an item put in the source where the Assembler's caret is: `call` a macro's call, else its code */
  onInsert: (item: CodeLibItem, how: 'code' | 'call') => void;
  /** a new item, of the lines selected in the Assembler (the dialog) */
  onNew: (kind: CodeLibKind) => void;
  onMenu: (x: number, y: number, items: MenuItem[]) => void;
  onCopy: (text: string, what: string) => void;
  toast: (msg: string, kind?: 'info' | 'ok' | 'warn' | 'err') => void;
}

export function CodeLibView({ desktop, lang, onInsert, onNew, onMenu, onCopy, toast }: CodeLibViewProps) {
  const { listing, loading, error, kind, q, color, open, set, load, remove } = useCodeLib();
  const defined = useAsmLink(s => s.macroDefined);
  // (read when the view is shown: the folders may have changed outside Mimir)
  useEffect(() => { void load(); }, [load]);
  const all = useMemo(() => listing?.items ?? [], [listing]);
  const ofKind = useMemo(() => all.filter(i => i.kind === kind), [all, kind]);
  const matching = useMemo(() => all.filter(i => codeLibMatches(i, q) && (!color || (i.color ?? '') === color)), [all, q, color]);
  const shown = matching.filter(i => i.kind === kind);
  const groups = useMemo(() => codeLibGroups(shown), [shown]);
  const count = (k: CodeLibKind) => (q.trim() || color ? matching : all).filter(i => i.kind === k).length;
  // the colours the library's items have, in the order the picker has them
  const colors = useMemo(() => [...new Set(ofKind.map(i => i.color ?? ''))].sort((a, b) => (a ? 1 : 0) - (b ? 1 : 0) || a.localeCompare(b)), [ofKind]);
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

  /** what a double-click does: a macro the project defines is called, one it does not is put in; code as it is */
  const primary = (i: CodeLibItem): 'code' | 'call' => { const m = itemMacro(i); return m && defined(m.name) ? 'call' : 'code'; };
  const reveal = (ref?: CodeLibRef) => { kr?.codelibReveal(ref ?? { kind }).catch(e => toast(`Could not open the folder: ${errorText(e)}`, 'err')); };
  const edit = (i: CodeLibItem) => set({ editing: { kind: i.kind, lang: i.lang, code: i.code, name: i.name, ...(i.from ? { from: i.from } : {}), was: { kind: i.kind, file: i.file } } });
  const trash = (i: CodeLibItem) => { remove({ kind: i.kind, file: i.file }).then(() => toast(`${i.file} is in the Recycle Bin (${listing?.folders[i.kind] ?? CODE_LIB_TITLE[i.kind].lib})`, 'ok'), e => toast(`Could not move it to the Recycle Bin: ${errorText(e)}`, 'err')); };
  const menu = (i: CodeLibItem, x: number, y: number) => {
    const m = itemMacro(i);
    onMenu(x, y, [
      { header: i.name },
      ...(m ? [{ label: `Insert the call: ${codeLibSignature(m, i.lang)}`, icon: 'play' as const, run: () => onInsert(i, 'call') }, { label: 'Insert its definition', run: () => onInsert(i, 'code') }] : [{ label: 'Insert in the source', icon: 'play' as const, run: () => onInsert(i, 'code') }]),
      { label: 'Copy the code', icon: 'copy', run: () => onCopy(i.code, `Copied ${i.name}`) },
      { sep: true },
      { label: 'Edit…', icon: 'pencil', run: () => edit(i) },
      { label: 'Show its file', icon: 'folder', run: () => reveal({ kind: i.kind, file: i.file }) },
      { sep: true },
      { label: 'Move to the Recycle Bin', icon: 'trash', run: () => trash(i) },
    ]);
  };
  const T = CODE_LIB_TITLE[kind];
  const openItem = codeLibItemOf(shown, open);
  return (
    <div className="side-inner cl-side">
      <div className="side-title lib-title">Macros and code
        <span className="grow" />
        <button className="icon-btn" title={`A new ${T.one} for the ${T.lib}, of the lines selected in the Assembler`} aria-label={`New ${T.one}`} disabled={!desktop} onClick={() => onNew(kind)}><Icon name="plus" size={14} /></button>
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
      {colors.length > 1 && <div className="cl-colors" role="group" aria-label="Show the colour">
        {colors.map(c => <button key={c || 'none'} type="button" className={cx('bm-sw', !c && 'none', color === c && 'on')} style={c ? ({ '--sw': bookmarkCss(c) }) as CSSProperties : undefined}
          aria-pressed={color === c} aria-label={c ? `Only the ${c} ones` : 'Only those without a colour'} title={`${c ? `Only the ${T.many} in this colour` : `Only the ${T.many} without a colour`}${color === c ? ' (a click shows them all again)' : ''}`}
          onClick={() => set({ color: color === c ? '' : c })} />)}
        {color && <button type="button" className="linkish small" onClick={() => set({ color: '' })}>All colours</button>}
      </div>}
      {shown.length > 0 && <div className="cl-letters" role="navigation" aria-label="Letters">
        {CODE_LIB_LETTERS.filter(l => letters.has(l) || !'ÅÄÖ'.includes(l)).map(l => (
          <button key={l} type="button" disabled={!letters.has(l)} aria-label={`Go to ${l === '#' ? 'the names that start with no letter' : l}`} onClick={() => jump(l)}>{l}</button>))}
      </div>}
      {error && <p className="side-hint err-text" role="alert">{error}</p>}
      <div className="cl-list" ref={listRef} role="list" aria-label={kind === 'macro' ? 'The macro library' : 'The code library'}>
        {groups.map(g => (
          <div key={g.letter} className="cl-group" role="group" aria-label={g.letter} ref={el => { groupRef.current[g.letter] = el; }}>
            <div className="cl-letter" aria-hidden>{g.letter}<span className="lib-n">{g.items.length}</span></div>
            {g.items.map(i => {
              const ref = { kind: i.kind, file: i.file }, on = sameCodeLib(open, ref), m = itemMacro(i), sig = m ? codeLibSignature(m, i.lang) : null;
              const hit = codeLibHit(i, q), first = i.description.split('\n')[0];
              const other = lang && i.lang !== lang;
              return (
                <div key={i.file} role="listitem" className={cx('cl-item', on && 'open', i.color && 'tinted')} style={clVar(i.color)} ref={on ? openRef : undefined}>
                  <button className="cl-row" aria-expanded={on} title={`${i.name}${first ? ` · ${first}` : ''}\nMade ${codeLibTime(i.created)}${i.from ? ` · from ${i.from}` : ''}\nClick to see it, double-click to put ${primary(i) === 'call' ? 'its call' : 'it'} in the source`}
                    onClick={e => { if (e.detail < 2) set({ open: on ? null : ref }); }} onDoubleClick={() => { if (lang) onInsert(i, primary(i)); }}
                    onContextMenu={e => { e.preventDefault(); menu(i, e.clientX, e.clientY); }}>
                    <span className="cl-name-row"><span className="cl-name">{i.name}</span>{other && <span className="cl-lang" title={`Written for ${LANG_TITLE[i.lang]}: the project is ${LANG_TITLE[lang!]}`}>{i.lang === '64tass' ? '64tass' : 'Kick'}</span>}
                      <span className="cl-date mono" title={`Made ${codeLibTime(i.created)}${i.changed > i.created + 60_000 ? `, changed ${codeLibTime(i.changed)}` : ''}`}>{codeLibTime(i.created, true)}</span></span>
                    {sig && sig !== i.name && <span className="cl-sig mono">{sig}</span>}
                    {first ? <span className="cl-desc">{first}</span> : !sig || sig === i.name ? <span className="cl-desc muted">{i.code.split('\n').find(l => l.trim())?.trim() ?? ''}</span> : null}
                    {hit === 'code' && <span className="cl-hit small">found in the code</span>}
                  </button>
                  {on && openItem && <ItemBody item={i} lang={lang} macro={m} primary={primary(i)} onInsert={how => onInsert(i, how)} onCopy={() => onCopy(i.code, `Copied ${i.name}`)} onEdit={() => edit(i)} onMore={(x, y) => menu(i, x, y)} />}
                </div>);
            })}
          </div>
        ))}
        {!desktop ? <p className="side-hint">The libraries are folders on your computer: they need the desktop app.</p>
          : listing && !ofKind.length ? <div className="side-hint lib-empty">
            <p><b>No {T.many} yet.</b></p>
            <p>Select the lines in the Assembler, right-click them and choose <b>Add to the {T.lib}…</b> (or <b>+</b> here). {kind === 'macro' ? 'Code that is not a macro yet is made one; a click on a macro\'s first line takes the whole macro.' : 'The code is kept as it is.'}</p>
            <p>Each is a file in <button type="button" className="linkish" onClick={() => reveal()}>{listing.folders[kind]}</button>, which a source can import too.</p>
          </div>
            : ofKind.length > 0 && !shown.length ? <p className="side-hint">No {T.one === 'macro' ? 'macro' : 'code'} matches{q.trim() ? ` “${q.trim()}”` : ''}{color ? ' in that colour' : ''}.{count(kind === 'macro' ? 'code' : 'macro') ? ` ${count(kind === 'macro' ? 'code' : 'macro')} in ${kind === 'macro' ? 'Code' : 'Macros'}.` : ''}</p> : null}
      </div>
      {listing && <button type="button" className="linkish small lib-dir mono" title="Open the folder (Settings → General → Library folder moves it)" onClick={() => reveal()}>{listing.folders[kind]}</button>}
    </div>
  );
}

/** an item opened in the list: its description, its code, when it was made and where it came from, and what to do */
function ItemBody({ item: i, lang, macro, primary, onInsert, onCopy, onEdit, onMore }: { item: CodeLibItem; lang: ScriptLang | null; macro: CodeLibMacro | null; primary: 'code' | 'call';
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
        <span>{LANG_TITLE[i.lang]}{i.own ? ' · a file put in the folder' : ''}</span>
        {i.from && <span title="Where it was taken from">From {i.from}</span>}
      </div>
      <div className="bm-actions">
        {macro ? <>
          <button className={cx('btn small', primary === 'call' && 'primary')} disabled={!lang} title={no || `Put ${codeLibSignature(macro, i.lang)} where the caret is (Tab goes from parameter to parameter)`} onClick={() => onInsert('call')}><Icon name="play" size={12} />Insert call</button>
          <button className={cx('btn small', primary === 'code' && 'primary')} disabled={!lang} title={no || 'Put the macro\'s definition in the source, at the caret\'s line'} onClick={() => onInsert('code')}>Insert definition</button>
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
