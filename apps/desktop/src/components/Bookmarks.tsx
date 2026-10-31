/* Bookmarks: the user's notes on addresses. The list sits in the sidebar (Ctrl+B): a click shows the whole note, a
 * double-click goes there in the code. B opens the editor for the bookmark on the cursor line at the top of the list,
 * so the code stays in view beside it. They are kept in the project file, never in the generated source. Each has a
 * colour, a preset or one of the user's own, which its mark and its line in the listing and its entry in the list show. */
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react';
import { BOOKMARK_COLORS, h4, isBookmarkColor, type Addr, type AnalysisResult, type Bookmark, type BookmarkPreset, type RenderResult } from '@mimir/core';
import { Icon } from '../lib/icons';
import { parseGoto } from '../lib/goto';
import { cx } from '../lib/util';
import { useUi } from '../store/ui';

/** the bookmarks by address */
export const bookmarkList = (bm: Record<Addr, Bookmark>): [Addr, Bookmark][] =>
  Object.entries(bm).map(([k, v]) => [Number(k), v] as [Addr, Bookmark]).sort((x, y) => x[0] - y[0]);

/** the title a new bookmark gets: the label at the address, else the address */
export const bookmarkTitle = (R: RenderResult, a: Addr) => R.labels.get(a)?.name ?? `$${h4(a)}`;

/** the CSS colour of a bookmark's colour: one of the user's own as it is, a preset in the shade of the theme, else amber */
export const bookmarkCss = (c?: string): string => (c && isBookmarkColor(c) ? (c.startsWith('#') ? c : `var(--bm-${c})`) : 'var(--bm-amber)');
/** `--bm`, which the bookmark's mark, its line and its icon are drawn in */
const bmVar = (c?: string) => ({ '--bm': bookmarkCss(c) }) as CSSProperties;

const PRESET_NAMES: Record<BookmarkPreset, string> = { amber: 'Amber', orange: 'Orange', red: 'Red', pink: 'Pink', violet: 'Violet', blue: 'Blue', teal: 'Teal', green: 'Green' };
const HEX = /^#?([0-9a-f]{6})$/i;

/** the bookmark being added or edited, and what the editor does */
export interface BookmarkEditing {
  /** the address the editor opened on; an existing bookmark there is edited */
  addr: Addr;
  /** the cursor line's address: the editor can take it as the bookmark's place */
  cursorAt: Addr | null;
  onSave: (from: Addr, to: Addr, b: Bookmark) => void;
  onCancel: () => void;
  /** a valid address was typed: show it in the listing */
  onPreview: (a: Addr) => void;
}

interface BookmarksViewProps {
  A: AnalysisResult; bookmarks: Record<Addr, Bookmark>; R: RenderResult; cursor: Addr | null;
  /** the bookmark whose note is shown (one at a time) */
  selected: Addr | null; onSelect: (a: Addr | null) => void;
  onGo: (a: Addr) => void; onAdd: () => void; onEdit: (a: Addr) => void; onDelete: (a: Addr) => void;
  editing: BookmarkEditing | null;
}

export function BookmarksView({ A, bookmarks, R, cursor, selected, onSelect, onGo, onAdd, onEdit, onDelete, editing }: BookmarksViewProps) {
  const [q, setQ] = useState('');
  const all = bookmarkList(bookmarks);
  const ql = q.trim().toLowerCase();
  const list = all.filter(([a, b]) => !ql || b.title.toLowerCase().includes(ql) || b.text.toLowerCase().includes(ql) || h4(a).includes(ql.replace(/^\$/, '')));
  const open = useRef<HTMLDivElement | null>(null);
  // a bookmark opened from the listing's margin is scrolled into view
  useEffect(() => { open.current?.scrollIntoView?.({ block: 'nearest' }); }, [selected]);
  // the second click of a double-click does not close the note again
  const click = (a: Addr, e: ReactMouseEvent) => { if (e.detail < 2) onSelect(selected === a ? null : a); };
  return (
    <div className="side-inner">
      <div className="side-title">Bookmarks <span className="muted">{all.length}</span><span className="grow" />
        <button className="icon-btn" title={`Add a bookmark at the cursor${cursor != null ? ` ($${h4(cursor)})` : ''} (B)`} aria-label="Add bookmark" onClick={onAdd}><Icon name="plus" size={14} /></button></div>
      {editing && <BookmarkEditor key={editing.addr} A={A} R={R} bookmarks={bookmarks} editing={editing} onDelete={onDelete} />}
      {all.length > 0 && <div className="side-search"><Icon name="search" size={14} /><label htmlFor="bm-q" className="sr-only">Filter bookmarks</label><input id="bm-q" value={q} onChange={e => setQ(e.target.value)} placeholder="Filter by title, note or address" /></div>}
      <div className="blk-list bm-list" role="list" aria-label="Bookmarks">
        {list.map(([a, b]) => { const on = selected === a, l = R.labels.get(a); return (
          <div key={a} role="listitem" className={cx('bm-item', on && 'open', editing?.addr === a && 'editing')} ref={on ? open : undefined} style={bmVar(b.color)}>
            <button className={cx('bm-row', cursor === a && 'here')} aria-expanded={on} title="Click to show the note · double-click to go there in the code"
              onClick={e => click(a, e)} onDoubleClick={() => { onSelect(a); onGo(a); }}>
              <Icon name="bookmark" size={13} className="bm-ic" /><span className="mono bm-adr">${h4(a)}</span><span className="bm-title">{b.title || `$${h4(a)}`}</span>
            </button>
            {on && <div className="bm-body">
              {l && l.name !== b.title && <div className="mono small muted">{l.name}</div>}
              {b.text ? <div className="bm-text">{b.text}</div> : <div className="muted small">No note. Edit adds one.</div>}
              <div className="bm-actions">
                <button className="btn small primary" onClick={() => onGo(a)}><Icon name="target" size={13} />Go to</button>
                <button className="btn small" onClick={() => onEdit(a)}><Icon name="pencil" size={13} />Edit</button>
                <button className="btn small ghost" onClick={() => onDelete(a)} aria-label={`Delete bookmark $${h4(a)}`}><Icon name="trash" size={13} />Delete</button>
              </div>
            </div>}
          </div>); })}
        {!all.length && !editing && <p className="muted small bm-empty">No bookmarks yet. Press <kbd>B</kbd> on a line in the listing (or right-click → Add bookmark…) to write a note about that address.</p>}
        {all.length > 0 && !list.length && <p className="muted small bm-empty">No bookmark matches “{q}”.</p>}
      </div>
      {all.length > 0 && <p className="muted small bm-help">Click shows the note · double-click goes there · <kbd>B</kbd> adds or edits · <kbd>F2</kbd> / <kbd>Shift+F2</kbd> next / previous</p>}
    </div>
  );
}

/** Adds or edits a bookmark in the sidebar: the listing beside it shows the code at the address. */
function BookmarkEditor({ A, R, bookmarks, editing, onDelete }: { A: AnalysisResult; R: RenderResult; bookmarks: Record<Addr, Bookmark>; editing: BookmarkEditing; onDelete: (a: Addr) => void }) {
  const { addr, cursorAt, onSave, onCancel, onPreview } = editing;
  const old = bookmarks[addr];
  const [at, setAt] = useState(`$${h4(addr)}`);
  const [title, setTitle] = useState(old?.title ?? bookmarkTitle(R, addr));
  const [text, setText] = useState(old?.text ?? '');
  const [color, setColor] = useState(old?.color && isBookmarkColor(old.color) ? old.color.toLowerCase() : 'amber');
  const labelAt = (name: string) => { for (const [a, l] of R.labels) if (l.name === name) return a; return undefined; };
  const t = parseGoto(at, labelAt);
  const to = 'addr' in t ? t.addr : null;
  const error = to == null ? 'Enter one hex address like $0810, or a label.'
    : A.owner[to] < 0 ? `No loaded byte at $${h4(to)}: a bookmark marks a place in the code.`
      : to !== addr && bookmarks[to] ? `There is already a bookmark at $${h4(to)}.` : null;
  // another valid address: the listing shows its code
  const shown = useRef(addr);
  useEffect(() => { if (to != null && !error && to !== shown.current) { shown.current = to; onPreview(to); } }, [to, error]); // eslint-disable-line react-hooks/exhaustive-deps
  // amber, the colour of a bookmark without one, is not written to the project
  const save = () => { if (!error && to != null) onSave(addr, to, { title: title.trim() || bookmarkTitle(R, to), text: text.replace(/^(\s*\n)+/, '').trimEnd(), ...(color !== 'amber' ? { color } : {}) }); };
  const enter = (e: KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); save(); } };
  const heading = old ? 'Edit bookmark' : 'Add bookmark';
  return (
    <form className="bm-editor" aria-label={heading} style={bmVar(color)} onSubmit={e => { e.preventDefault(); save(); }} onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onCancel(); } }}>
      <div className="bm-editor-head"><Icon name="bookmark" size={14} className="bm-ic" /><b>{heading}</b><span className="grow" />
        <button type="button" className="icon-btn" aria-label="Cancel" title="Cancel (Esc)" onClick={onCancel}><Icon name="x" size={13} /></button></div>
      <div className="field"><label htmlFor="bm-addr">Address</label>
        <div className="bm-addr-row"><input id="bm-addr" className="mono" value={at} spellCheck={false} onChange={e => setAt(e.target.value)} onKeyDown={enter} />
          {cursorAt != null && cursorAt !== to && <button type="button" className="btn small" title="Use the line the cursor is on in the listing" onClick={() => setAt(`$${h4(cursorAt)}`)}>Cursor line</button>}</div></div>
      <div className="field"><label htmlFor="bm-title">Title</label><input id="bm-title" value={title} maxLength={200} onChange={e => setTitle(e.target.value)} onKeyDown={enter} autoFocus onFocus={e => e.currentTarget.select()} /></div>
      {/* labels by id: a label around the textarea would take the note into its name */}
      <div className="field"><label htmlFor="bm-text">Note</label>
        <textarea id="bm-text" value={text} maxLength={20000} rows={7} placeholder="What happens here, what to look at later…" onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); } }} /></div>
      <ColorPicker value={color} onChange={setColor} />
      {error ? <div className="err-text small">{error}</div> : <p className="muted small">The listing shows the code at {to != null ? `$${h4(to)}` : 'the address'}. Enter in a field or Ctrl+Enter in the note saves, Esc cancels.</p>}
      <div className="bm-actions">
        <button type="submit" className="btn small primary" disabled={!!error}>Save</button>
        <button type="button" className="btn small" onClick={onCancel}>Cancel</button>
        <span className="grow" />
        {old && <button type="button" className="btn small ghost" onClick={() => onDelete(addr)}><Icon name="trash" size={13} />Delete</button>}
      </div>
    </form>
  );
}

/** a colour as #rrggbb: a preset's as the theme shows it now */
const hexOf = (c: string) => {
  if (c.startsWith('#')) return c;
  const m = HEX.exec(getComputedStyle(document.documentElement).getPropertyValue(`--bm-${c}`).trim());
  return m ? `#${m[1].toLowerCase()}` : '#e5a83b';
};

/** arrow keys go from colour to colour in a row; Tab goes to the next row */
const roam = (e: KeyboardEvent<HTMLDivElement>) => {
  if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
  const bs = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('.bm-sw')], i = bs.indexOf(document.activeElement as HTMLButtonElement);
  if (i < 0) return;
  e.preventDefault();
  bs[(i + (e.key === 'ArrowRight' ? 1 : bs.length - 1)) % bs.length].focus();
};

/** The bookmark's colour: eight presets, then eight places for colours of the user's own, which the app keeps for every
 * project. An empty place (+) makes one; a double-click on one, or the pencil, changes it. A bookmark keeps its colour
 * when the colour it was given is changed or removed here. */
function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  const own = useUi(s => s.bmColors), setUi = useUi(s => s.set);
  /** the place of the own colour being made or changed, the colour (the last valid one typed) and the text typed */
  const [slot, setSlot] = useState<{ i: number; c: string; text: string } | null>(null);
  const preset = (BOOKMARK_COLORS as readonly string[]).includes(value);
  const mine = preset ? -1 : own.indexOf(value.toLowerCase());
  const begin = (i: number) => { const c = own[i] || hexOf(value); setSlot({ i, c, text: c }); };
  const typed = slot ? HEX.exec(slot.text.trim()) : null;
  // closing the colour's editor puts the focus back on its place, so Esc then cancels the bookmark
  const ownRow = useRef<HTMLDivElement | null>(null);
  const close = () => { const i = slot?.i ?? 0; setSlot(null); requestAnimationFrame(() => ownRow.current?.querySelectorAll<HTMLButtonElement>('.bm-sw')[i]?.focus()); };
  const keep = () => {
    if (!slot || !typed) return;
    const c = `#${typed[1].toLowerCase()}`;
    setUi({ bmColors: own.map((o, i) => (i === slot.i ? c : o)) });
    onChange(c); close();
  };
  const remove = () => { if (slot) setUi({ bmColors: own.map((o, i) => (i === slot.i ? '' : o)) }); close(); };
  return (
    <div className="field bm-colors" role="group" aria-labelledby="bm-color-l">
      <div className="bm-color-head"><span id="bm-color-l">Colour</span><span className="grow" />
        <span className="bm-color-name">{preset ? PRESET_NAMES[value as BookmarkPreset] : mine >= 0 ? `Your colour ${mine + 1} · ${value}` : value}</span></div>
      <div className="bm-swatches" role="group" aria-label="Preset colours" onKeyDown={roam}>
        {BOOKMARK_COLORS.map((c, i) => <button key={c} type="button" className={cx('bm-sw', value === c && 'on')} style={{ '--sw': `var(--bm-${c})` } as CSSProperties}
          tabIndex={value === c || (!preset && i === 0) ? 0 : -1} aria-label={PRESET_NAMES[c]} aria-pressed={value === c} title={PRESET_NAMES[c]} onClick={() => onChange(c)} />)}
      </div>
      <div className="bm-swatches" role="group" aria-label="Your colours" onKeyDown={roam} ref={ownRow}>
        {own.map((c, i) => c
          ? <button key={i} type="button" className={cx('bm-sw', value === c && 'on', slot?.i === i && 'editing')} style={{ '--sw': c } as CSSProperties} tabIndex={(mine >= 0 ? mine : 0) === i ? 0 : -1}
            aria-label={`Your colour ${i + 1}: ${c}`} aria-pressed={value === c} title={`Your colour ${i + 1}: ${c} · double-click to change it`} onClick={() => onChange(c)} onDoubleClick={() => begin(i)} />
          : <button key={i} type="button" className={cx('bm-sw', 'free', slot?.i === i && 'editing')} tabIndex={(mine >= 0 ? mine : 0) === i ? 0 : -1}
            aria-label={`Make colour ${i + 1} of your own`} title="Make a colour of your own" onClick={() => begin(i)}><Icon name="plus" size={11} /></button>)}
        <button type="button" className="icon-btn bm-sw-edit" disabled={mine < 0} aria-label="Change this colour of your own" title="Change this colour of your own (or double-click it)" onClick={() => begin(mine)}><Icon name="pencil" size={13} /></button>
      </div>
      {slot && <div className="bm-own" role="group" aria-label={own[slot.i] ? `Change your colour ${slot.i + 1}` : `Make colour ${slot.i + 1} of your own`}
        onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } }}>
        <input type="color" aria-label="Pick the colour" value={slot.c} onChange={e => setSlot({ ...slot, c: e.target.value, text: e.target.value })} />
        <input className="mono" aria-label="Colour as #rrggbb" value={slot.text} maxLength={7} spellCheck={false} autoFocus
          onChange={e => { const m = HEX.exec(e.target.value.trim()); setSlot({ ...slot, text: e.target.value, c: m ? `#${m[1].toLowerCase()}` : slot.c }); }}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); keep(); } }} />
        <button type="button" className="btn small primary" disabled={!typed} onClick={keep}>{own[slot.i] ? 'Change' : 'Add'}</button>
        <button type="button" className="btn small" onClick={close}>Cancel</button>
        {own[slot.i] && <button type="button" className="icon-btn" aria-label="Remove this colour of your own" title="Remove this colour of your own (bookmarks in it keep it)" onClick={remove}><Icon name="trash" size={13} /></button>}
      </div>}
    </div>
  );
}
