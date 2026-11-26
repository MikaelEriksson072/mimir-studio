/* Bookmarks in an Assembler project (spec 10.7), as the re-assembler's on addresses (Bookmarks.tsx), on lines of the
 * sources: the list in the side panel (Ctrl+B), a click shows the whole note, a double-click goes to the line in the
 * Assembler. Ctrl+F2 on a line opens the editor for the bookmark there at the top of the list (a selection of lines:
 * the area), so the code stays in view beside it; Alt+F2 / Alt+Shift+F2 go to the next / previous one. Each has a
 * colour, the mark in the editor's margin and its line show it, and an area a stripe down the margin. A bookmark moves
 * with its line as the code is edited; they are kept in the project file. */
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react';
import { isBookmarkColor, type AsmBookmark } from '@mimir/core';
import { Icon } from '../lib/icons';
import { cx } from '../lib/util';
import { useAsmLink } from '../store/asmlink';
import { bookmarkCss, ColorPicker } from './Bookmarks';

/** the bookmarks by file, then line */
export const asmBookmarkList = (bm: Record<string, AsmBookmark>): [string, AsmBookmark][] =>
  Object.entries(bm).sort(([, a], [, b]) => a.file.localeCompare(b.file) || a.line - b.line);
/** where a bookmark is: `main.asm:12`, an area `main.asm:12–20` */
export const asmBookmarkSpan = (b: Pick<AsmBookmark, 'file' | 'line' | 'end'>) => `${b.file}:${b.line}${b.end != null && b.end > b.line ? `–${b.end}` : ''}`;
/** an id of its own for a new bookmark */
export const newBookmarkId = () => `b${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
const bmVar = (c?: string) => ({ '--bm': bookmarkCss(c) }) as CSSProperties;

/** the bookmark being added or edited in the Assembler, and what the editor does */
export interface AsmBookmarkEditing {
  /** the bookmark edited (null: a new one), and where the editor opened */
  id: string | null; file: string; line: number; end: number | null;
  onSave: (id: string | null, b: AsmBookmark) => void;
  onCancel: () => void;
  /** a valid place typed in: the Assembler shows it (and selects the area) */
  onPreview: (file: string, line: number, end: number | null) => void;
}

/** (the caret, the selection and the folder's text files come from the Assembler tab, asmlink) */
interface AsmBookmarksViewProps {
  bookmarks: Record<string, AsmBookmark>;
  selected: string | null; onSelect: (id: string | null) => void;
  onGo: (id: string) => void; onAdd: () => void; onEdit: (id: string) => void; onDelete: (id: string) => void;
  editing: AsmBookmarkEditing | null;
}

export function AsmBookmarksView({ bookmarks, selected, onSelect, onGo, onAdd, onEdit, onDelete, editing }: AsmBookmarksViewProps) {
  const caret = useAsmLink(s => s.caret), textFiles = useAsmLink(s => s.textFiles);
  const files = new Set(textFiles);
  const [q, setQ] = useState('');
  const all = asmBookmarkList(bookmarks);
  const ql = q.trim().toLowerCase();
  const list = all.filter(([, b]) => !ql || b.title.toLowerCase().includes(ql) || b.text.toLowerCase().includes(ql) || asmBookmarkSpan(b).toLowerCase().includes(ql));
  const open = useRef<HTMLDivElement | null>(null);
  // a bookmark opened from the editor's margin is scrolled into view
  useEffect(() => { open.current?.scrollIntoView?.({ block: 'nearest' }); }, [selected]);
  const click = (id: string, e: ReactMouseEvent) => { if (e.detail < 2) onSelect(selected === id ? null : id); };
  const here = (b: AsmBookmark) => !!caret && caret.file === b.file && caret.line >= b.line && caret.line <= (b.end ?? b.line);
  return (
    <div className="side-inner">
      <div className="side-title">Bookmarks <span className="muted">{all.length}</span><span className="grow" />
        <button className="icon-btn" title={`Add a bookmark on the caret's line${caret ? ` (${caret.file}:${caret.line})` : ''} (Ctrl+F2)`} aria-label="Add bookmark" onClick={onAdd}><Icon name="plus" size={14} /></button></div>
      {editing && <AsmBookmarkEditor key={`${editing.id ?? 'new'}-${editing.file}-${editing.line}-${editing.end}`} bookmarks={bookmarks} editing={editing} onDelete={onDelete} />}
      {all.length > 0 && <div className="side-search"><Icon name="search" size={14} /><label htmlFor="bm-q" className="sr-only">Filter bookmarks</label><input id="bm-q" value={q} onChange={e => setQ(e.target.value)} placeholder="Filter by title, note or file" /></div>}
      <div className="blk-list bm-list" role="list" aria-label="Bookmarks">
        {list.map(([id, b]) => { const on = selected === id, gone = !files.has(b.file); return (
          <div key={id} role="listitem" className={cx('bm-item', on && 'open', editing?.id === id && 'editing', gone && 'gone')} ref={on ? open : undefined} style={bmVar(b.color)}>
            <button className={cx('bm-row', here(b) && 'here')} aria-expanded={on} title={`${asmBookmarkSpan(b)}${gone ? ' (the file is not in the folder)' : ''} · click to show the note · double-click to go there in the code`}
              onClick={e => click(id, e)} onDoubleClick={() => { onSelect(id); onGo(id); }}>
              <Icon name="bookmark" size={13} className="bm-ic" /><span className="mono bm-adr">{b.file.replace(/^.*\//, '')}:{b.line}{b.end != null && b.end > b.line && <span className="bm-end">–{b.end}</span>}</span><span className="bm-title">{b.title || asmBookmarkSpan(b)}</span>
            </button>
            {on && <div className="bm-body">
              {(b.end != null && b.end > b.line) || b.file.includes('/') || gone ? <div className="mono small muted bm-area-text">{asmBookmarkSpan(b)}{b.end != null && b.end > b.line ? ` · ${b.end - b.line + 1} lines` : ''}{gone ? ' · the file is not in the folder' : ''}</div> : null}
              {b.text ? <div className="bm-text">{b.text}</div> : <div className="muted small">No note. Edit adds one.</div>}
              <div className="bm-actions">
                <button className="btn small primary" disabled={gone} onClick={() => onGo(id)}><Icon name="target" size={13} />Go to</button>
                <button className="btn small" onClick={() => onEdit(id)}><Icon name="pencil" size={13} />Edit</button>
                <button className="btn small ghost" onClick={() => onDelete(id)} aria-label={`Delete bookmark ${asmBookmarkSpan(b)}`}><Icon name="trash" size={13} />Delete</button>
              </div>
            </div>}
          </div>); })}
        {!all.length && !editing && <p className="muted small bm-empty">No bookmarks yet. Press <kbd>Ctrl+F2</kbd> on a line in the Assembler (or right-click → Bookmark this line…) to write a note about it.</p>}
        {all.length > 0 && !list.length && <p className="muted small bm-empty">No bookmark matches “{q}”.</p>}
      </div>
      {all.length > 0 && <p className="muted small bm-help">Click shows the note · double-click goes there · <kbd>Ctrl+F2</kbd> adds or edits · <kbd>Alt+F2</kbd> / <kbd>Alt+Shift+F2</kbd> next / previous</p>}
    </div>
  );
}

/** Adds or edits a bookmark in the side panel: the Assembler beside it shows the line (and selects the area). */
function AsmBookmarkEditor({ bookmarks, editing, onDelete }: { bookmarks: Record<string, AsmBookmark>; editing: AsmBookmarkEditing; onDelete: (id: string) => void }) {
  const { id, onSave, onCancel, onPreview } = editing;
  const caret = useAsmLink(s => s.caret), selection = useAsmLink(s => s.selection), sources = useAsmLink(s => s.textFiles);
  const lines = useAsmLink(s => s.linesOf), titleAt = useAsmLink(s => s.titleAt);
  const old = id ? bookmarks[id] : undefined;
  const [file, setFile] = useState(old?.file ?? editing.file);
  const [line, setLine] = useState(String(old?.line ?? editing.line));
  const firstEnd = old ? old.end : editing.end;
  const [last, setLast] = useState(firstEnd != null ? String(firstEnd) : '');
  const [title, setTitle] = useState(old?.title ?? titleAt(editing.file, editing.line));
  const [text, setText] = useState(old?.text ?? '');
  const [color, setColor] = useState(old?.color && isBookmarkColor(old.color) ? old.color.toLowerCase() : 'amber');
  const count = lines(file), at = /^\d+$/.test(line.trim()) ? Number(line.trim()) : null;
  const other = at != null ? Object.entries(bookmarks).find(([k, b]) => k !== id && b.file === file && b.line === at) : undefined;
  const error = count == null ? `${file} is not in the project's folder.` : at == null || at < 1 ? 'Enter the line, a number from 1.'
    : at > count ? `${file} has ${count} lines.` : other ? `There is already a bookmark on ${file}:${at}.` : null;
  const lastAt = last.trim() ? (/^\d+$/.test(last.trim()) ? Number(last.trim()) : NaN) : null;
  // a last line at the line itself is no area
  const end = lastAt != null && at != null && lastAt > at ? lastAt : null;
  const endError = lastAt == null || error ? null : Number.isNaN(lastAt) ? 'Enter the area’s last line, a number; leave it empty for the line only.'
    : lastAt < at! ? `The area ends before it starts on line ${at}.` : lastAt > count! ? `${file} has ${count} lines.` : null;
  // another valid place: the Assembler shows it
  const shown = useRef({ file: old?.file ?? editing.file, line: old?.line ?? editing.line, end: firstEnd ?? null });
  useEffect(() => {
    if (at == null || error || endError) return;
    const s = shown.current; shown.current = { file, line: at, end };
    if (s.file !== file || s.line !== at || s.end !== end) onPreview(file, at, end);
  }, [file, at, end, error, endError]); // eslint-disable-line react-hooks/exhaustive-deps
  // amber, the colour of a bookmark without one, is not written to the project
  const save = () => {
    if (error || endError || at == null) return;
    onSave(id, { file, line: at, ...(end != null ? { end } : {}), title: title.trim() || titleAt(file, at), text: text.replace(/^(\s*\n)+/, '').trimEnd(), ...(color !== 'amber' ? { color } : {}) });
  };
  const useCaret = caret && (caret.file !== file || caret.line !== at);
  const useSelection = selection && selection.to > selection.from && (selection.file !== file || selection.from !== at || selection.to !== end);
  const enter = (e: KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); save(); } };
  const heading = old ? 'Edit bookmark' : 'Add bookmark';
  return (
    <form className="bm-editor" aria-label={heading} style={bmVar(color)} onSubmit={e => { e.preventDefault(); save(); }} onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onCancel(); } }}>
      <div className="bm-editor-head"><Icon name="bookmark" size={14} className="bm-ic" /><b>{heading}</b><span className="grow" />
        <button type="button" className="icon-btn" aria-label="Cancel" title="Cancel (Esc)" onClick={onCancel}><Icon name="x" size={13} /></button></div>
      <div className="field"><label htmlFor="bm-file">File</label>
        <select id="bm-file" className="mono" value={file} onChange={e => setFile(e.target.value)}>
          {[...new Set([...sources, file])].map(p => <option key={p} value={p}>{p}{sources.includes(p) ? '' : ' (not in the folder)'}</option>)}</select></div>
      <div className="field"><label htmlFor="bm-line">Line</label>
        <div className="bm-addr-row"><input id="bm-line" className="mono" inputMode="numeric" value={line} spellCheck={false} onChange={e => setLine(e.target.value)} onKeyDown={enter} />
          {useCaret && <button type="button" className="btn small" title={`Use the caret's line in the Assembler, ${caret.file}:${caret.line}`} onClick={() => { setFile(caret.file); setLine(String(caret.line)); }}>Caret line</button>}</div></div>
      <div className="field"><label htmlFor="bm-end">Last line</label>
        <div className="bm-addr-row"><input id="bm-end" className="mono" inputMode="numeric" value={last} spellCheck={false} placeholder="The line only" onChange={e => setLast(e.target.value)} onKeyDown={enter} />
          {useSelection && <button type="button" className="btn small" title={`Put the bookmark on the lines selected in the Assembler, ${selection.file}:${selection.from}–${selection.to}`} onClick={() => { setFile(selection.file); setLine(String(selection.from)); setLast(String(selection.to)); }}>Selection</button>}</div></div>
      <div className="field"><label htmlFor="bm-title">Title</label><input id="bm-title" value={title} maxLength={200} onChange={e => setTitle(e.target.value)} onKeyDown={enter} autoFocus onFocus={e => e.currentTarget.select()} /></div>
      {/* labels by id: a label around the textarea would take the note into its name */}
      <div className="field"><label htmlFor="bm-text">Note</label>
        <textarea id="bm-text" value={text} maxLength={20000} rows={7} placeholder="What happens here, what to look at later…" onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); } }} /></div>
      <ColorPicker value={color} onChange={setColor} />
      {error || endError ? <div className="err-text small">{error || endError}</div>
        : <p className="muted small">The Assembler shows {end != null ? `lines ${at}–${end} of ${file}` : `${file}:${at}`}. Enter in a field or Ctrl+Enter in the note saves, Esc cancels.</p>}
      <div className="bm-actions">
        <button type="submit" className="btn small primary" disabled={!!(error || endError)}>Save</button>
        <button type="button" className="btn small" onClick={onCancel}>Cancel</button>
        <span className="grow" />
        {old && id && <button type="button" className="btn small ghost" onClick={() => onDelete(id)}><Icon name="trash" size={13} />Delete</button>}
      </div>
    </form>
  );
}
