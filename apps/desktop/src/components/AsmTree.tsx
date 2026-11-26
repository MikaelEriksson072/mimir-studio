/* The Assembler's files (spec 10.7): the folder's files and folders as a tree, in place of the script editor's library
 * and templates. A click opens a file in the editor (a folder opens and closes); the main file (the one built) is
 * marked, as are a file with changes not yet written and one with problems (a double-click opens it in a tab that stays,
 * a click in the preview tab; AsmTabs is the row of tabs over the code). A right-click (or the ⋯ of a row) gives
 * New file, New folder, Rename, Delete, Set as main file and Show in folder; a new name is typed in the tree itself. */
import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent } from 'react';
import { ASM_SOURCE, ASM_TEXT } from '@mimir/core';
import type { AsmEntry } from '../../shared/ipc';
import { Icon } from '../lib/icons';
import type { IconName } from '../lib/icon-paths';
import { cx, fmtBytes } from '../lib/util';

/** a name being typed in the tree: a new file or folder in `parent`, or `path` renamed */
export type TreeEdit = { kind: 'file' | 'folder'; parent: string } | { kind: 'rename'; path: string };

/** the icon of a file, by its name */
export function fileIcon(path: string): IconName {
  if (ASM_SOURCE.test(path)) return 'code';
  if (/\.(d64|d71|d81|g64)$/i.test(path)) return 'disk';
  if (/\.(tap|t64)$/i.test(path)) return 'tape';
  if (/\.crt$/i.test(path)) return 'chip';
  if (/\.sid$/i.test(path)) return 'music';
  if (/\.(png|gif|jpe?g|bmp|koa|kla|art|ocp|dd|ddl|fli)$/i.test(path)) return 'image';
  if (/\.(prg|bin|raw|vsf)$/i.test(path)) return 'chip';
  if (ASM_TEXT.test(path)) return 'doc';
  return 'doc';
}

export const baseName = (path: string) => path.slice(path.lastIndexOf('/') + 1);
export const parentOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');

interface AsmTreeProps {
  entries: readonly AsmEntry[];
  /** the folders that are open */
  expanded: ReadonlySet<string>;
  /** the file in the editor, the main file, files with changes not written yet, and the problems of each file */
  shown: string | null;
  main: string | null;
  dirty: ReadonlySet<string>;
  problems: ReadonlyMap<string, number>;
  edit: TreeEdit | null;
  /** a file opened in the editor: in the preview tab, or (`keep`: a double-click, Enter) in a tab that stays */
  onOpen: (path: string, keep?: boolean) => void;
  onToggle: (path: string) => void;
  /** the menu of a row (null: of the folder itself, a click below the rows) */
  onMenu: (x: number, y: number, entry: AsmEntry | null) => void;
  /** the name typed: committed (null: given up) */
  onEdit: (name: string | null) => void;
}

export function AsmTree({ entries, expanded, shown, main, dirty, problems, edit, onOpen, onToggle, onMenu, onEdit }: AsmTreeProps) {
  // what each folder holds, in the listing's order (the folders first, by name)
  const kids = useMemo(() => {
    const m = new Map<string, AsmEntry[]>();
    for (const e of entries) { const p = parentOf(e.path); const l = m.get(p); if (l) l.push(e); else m.set(p, [e]); }
    return m;
  }, [entries]);
  // the rows shown: the open folders' contents, depth first
  const rows: { e: AsmEntry; depth: number }[] = [];
  const add = (parent: string, depth: number) => { for (const e of kids.get(parent) ?? []) { rows.push({ e, depth }); if (e.dir && expanded.has(e.path)) add(e.path, depth + 1); } };
  add('', 0);
  const [focus, setFocus] = useState<string | null>(null);
  const host = useRef<HTMLDivElement>(null);
  // files dragged in from outside over a row: the folder they go into when dropped there (the window copies them)
  const [dropOn, setDropOn] = useState<string | null>(null);
  useEffect(() => { const off = () => setDropOn(null); window.addEventListener('drop', off); window.addEventListener('dragend', off); return () => { window.removeEventListener('drop', off); window.removeEventListener('dragend', off); }; }, []);
  const dragOver = (ev: DragEvent) => {
    if (![...ev.dataTransfer.types].includes('Files')) return;
    const p = (ev.target as Element).closest('[role="treeitem"][data-path]')?.getAttribute('data-path') ?? null;
    const e = p == null ? null : entries.find(x => x.path === p);
    setDropOn(p == null ? null : e?.dir ? p : parentOf(p));
  };
  // the row shown in the editor is the one the keys move from
  useEffect(() => { if (shown) setFocus(shown); }, [shown]);

  const menuAt = (ev: MouseEvent, e: AsmEntry | null) => { ev.preventDefault(); ev.stopPropagation(); onMenu(ev.clientX, ev.clientY, e); };
  const keys = (ev: KeyboardEvent) => {
    if (edit || (ev.target as HTMLElement).tagName === 'INPUT') return;
    const i = rows.findIndex(r => r.e.path === focus), cur = rows[i]?.e;
    const go = (j: number) => { const r = rows[Math.max(0, Math.min(rows.length - 1, j))]; if (r) { setFocus(r.e.path); host.current?.querySelector<HTMLElement>(`[data-path="${CSS.escape(r.e.path)}"]`)?.focus(); } };
    if (ev.key === 'ArrowDown') { ev.preventDefault(); go(i + 1); }
    else if (ev.key === 'ArrowUp') { ev.preventDefault(); go(i - 1); }
    else if (ev.key === 'ArrowRight' && cur?.dir && !expanded.has(cur.path)) { ev.preventDefault(); onToggle(cur.path); }
    else if (ev.key === 'ArrowLeft' && cur) { ev.preventDefault(); if (cur.dir && expanded.has(cur.path)) onToggle(cur.path); else { const p = parentOf(cur.path); if (p) go(rows.findIndex(r => r.e.path === p)); } }
    else if (ev.key === 'Enter' && cur) { ev.preventDefault(); if (cur.dir) onToggle(cur.path); else onOpen(cur.path, true); }
    else if ((ev.key === 'F2' || ev.key === 'Delete' || ev.key === 'ContextMenu') && cur) {
      ev.preventDefault();
      const r = host.current?.querySelector<HTMLElement>(`[data-path="${CSS.escape(cur.path)}"]`)?.getBoundingClientRect();
      onMenu(r ? r.left + 24 : 0, r ? r.bottom : 0, cur);
    }
  };

  const input = (depth: number, value: string, icon: IconName, label: string) => (
    <div className="asm-row asm-row-edit" style={{ paddingLeft: 6 + depth * 14 }}>
      <Icon name={icon} size={13} />
      <NameInput value={value} label={label} onDone={onEdit} />
    </div>
  );
  const newAt = edit && edit.kind !== 'rename' ? edit : null;
  const newRow = (parent: string, depth: number) => newAt && newAt.parent === parent
    ? input(depth, '', newAt.kind === 'folder' ? 'folder' : 'code', newAt.kind === 'folder' ? 'Name of the new folder' : 'Name of the new file') : null;

  return (
    <div className={cx('asm-tree', dropOn === '' && 'drop-top')} role="tree" aria-label="Files" ref={host} onKeyDown={keys} onContextMenu={e => menuAt(e, null)}
      onDragOver={dragOver} onDragLeave={ev => { if (!host.current?.contains(ev.relatedTarget as Node)) setDropOn(null); }}>
      {newRow('', 0)}
      {rows.map(({ e, depth }) => {
        const name = baseName(e.path), n = problems.get(e.path) ?? 0;
        if (edit?.kind === 'rename' && edit.path === e.path) return <div key={e.path}>{input(depth, name, e.dir ? 'folder' : fileIcon(e.path), `New name of ${name}`)}</div>;
        const open = e.dir && expanded.has(e.path);
        return (
          <div key={e.path}>
            <div role="treeitem" aria-label={name} aria-level={depth + 1} aria-expanded={e.dir ? open : undefined} aria-selected={!e.dir && e.path === shown}
              data-path={e.path} tabIndex={(focus ?? rows[0]?.e.path) === e.path ? 0 : -1}
              className={cx('asm-row', e.dir && 'dir', !e.dir && e.path === shown && 'on', e.path === main && 'main', e.dir && dropOn === e.path && 'drop-into')} style={{ paddingLeft: 6 + depth * 14 }}
              title={e.dir ? e.path : `${e.path} · ${fmtBytes(e.size)}${e.path === main ? ' · the main file: Run and Build build it' : ''}${dirty.has(e.path) ? ' · changes not written yet' : ''}${n ? ` · ${n} problem${n === 1 ? '' : 's'}` : ''}`}
              onClick={() => { setFocus(e.path); if (e.dir) onToggle(e.path); else onOpen(e.path); }} onDoubleClick={() => { if (!e.dir) onOpen(e.path, true); }} onContextMenu={ev => { setFocus(e.path); menuAt(ev, e); }}>
              {e.dir ? <Icon name="chevron" size={11} className={cx('asm-caret', open && 'open')} /> : <span className="asm-caret" />}
              <Icon name={e.dir ? 'folder' : fileIcon(e.path)} size={13} className="asm-ico" />
              <span className="asm-name">{name}</span>
              {e.path === main && <span className="asm-main" title="The main file: Run and Build build it">main</span>}
              {n > 0 && <span className="count bad" aria-label={`${n} problem${n === 1 ? '' : 's'}`}>{n}</span>}
              {dirty.has(e.path) && <span className="asm-dirty" aria-label="not written yet" />}
              <button className="icon-btn asm-row-more" tabIndex={-1} aria-label={`More for ${name}`} title="New file, rename, delete, set as main file…" onClick={ev => menuAt(ev, e)}><Icon name="more" size={13} /></button>
            </div>
            {open && newRow(e.path, depth + 1)}
          </div>
        );
      })}
      {!rows.length && !newAt && <p className="asm-tree-empty muted small">The folder is empty: + makes a file.</p>}
    </div>
  );
}

/** a name typed in the tree: Enter commits it, Esc (or leaving it empty) gives it up */
function NameInput({ value, label, onDone }: { value: string; label: string; onDone: (name: string | null) => void }) {
  const [v, setV] = useState(value);
  const done = useRef(false);
  const finish = (name: string | null) => { if (done.current) return; done.current = true; onDone(name); };
  return <input className="asm-name-input" autoFocus aria-label={label} value={v} spellCheck={false}
    onFocus={e => { const dot = value.lastIndexOf('.'); e.target.setSelectionRange(0, dot > 0 ? dot : value.length); }}
    onChange={e => setV(e.target.value)} onBlur={() => finish(v.trim() && v.trim() !== value ? v.trim() : null)}
    onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') finish(v.trim() && v.trim() !== value ? v.trim() : null); if (e.key === 'Escape') finish(null); }} />;
}

interface AsmTabsProps {
  /** the files open, in their order; the one that is a preview (shown in italics); the one shown */
  open: readonly string[];
  preview: string | null;
  shown: string | null;
  main: string | null;
  dirty: ReadonlySet<string>;
  problems: ReadonlyMap<string, number>;
  onShow: (path: string) => void;
  /** a preview kept open (a double-click on its tab) */
  onKeep: (path: string) => void;
  onClose: (paths: string[]) => void;
  /** a tab dragged to before `before` (null: to the end) */
  onMove: (path: string, before: string | null) => void;
  onMenu: (x: number, y: number, path: string) => void;
}

/** The Assembler's open files as tabs over the code (spec 10.7): a click shows a file, a double-click keeps a preview
 *  open, × or a middle click closes one, a drag puts it elsewhere in the row, and a right-click gives the rest. Two files
 *  of the same name say their folders. */
export function AsmTabs({ open, preview, shown, main, dirty, problems, onShow, onKeep, onClose, onMove, onMenu }: AsmTabsProps) {
  const row = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ path: string; before: string | null } | null>(null);
  // the tab shown is in view in the row
  useEffect(() => { row.current?.querySelector('.asm-tab.on')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }, [shown, open.length]);
  const names = new Map<string, number>();
  for (const p of open) names.set(baseName(p), (names.get(baseName(p)) ?? 0) + 1);
  if (!open.length) return null;
  return (
    <div className="tabs small asm-tabs" role="tablist" aria-label="Open files" ref={row}
      onWheel={e => { if (row.current && e.deltaY && !e.shiftKey) row.current.scrollLeft += e.deltaY; }}
      onDragOver={e => { if (drag) { e.preventDefault(); if (e.target === row.current) setDrag({ ...drag, before: null }); } }}
      onDrop={e => { if (!drag) return; e.preventDefault(); onMove(drag.path, drag.before); setDrag(null); }}>
      {open.map(p => {
        const name = baseName(p), n = problems.get(p) ?? 0, twin = (names.get(name) ?? 0) > 1;
        return (
          <div key={p} role="tab" aria-selected={p === shown} aria-label={name} tabIndex={p === shown ? 0 : -1} draggable
            className={cx('tab asm-tab', p === shown && 'on', p === preview && 'preview', drag?.before === p && drag.path !== p && 'drop-before')}
            title={`${p}${p === main ? ' · the main file' : ''}${p === preview ? ' · a preview: the next file opened from the list takes its place (a double-click keeps it)' : ''}${dirty.has(p) ? ' · changes not written yet' : ''}`}
            onClick={() => onShow(p)} onDoubleClick={() => onKeep(p)}
            onMouseDown={e => { if (e.button === 1) e.preventDefault(); }}
            onAuxClick={e => { if (e.button === 1) { e.preventDefault(); onClose([p]); } }}
            onContextMenu={e => { e.preventDefault(); onMenu(e.clientX, e.clientY, p); }}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onShow(p); } }}
            onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', p); setDrag({ path: p, before: null }); }}
            onDragOver={e => { if (!drag) return; e.preventDefault(); e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); const i = open.indexOf(p); const before = e.clientX < r.left + r.width / 2 ? p : open[i + 1] ?? null; if (before !== drag.before) setDrag({ ...drag, before }); }}
            onDragEnd={() => setDrag(null)}>
            <Icon name={fileIcon(p)} size={12} className={cx('asm-ico', p === main && 'main')} />
            <span className="asm-tab-name">{name}</span>
            {twin && parentOf(p) && <span className="asm-tab-dir">{parentOf(p)}</span>}
            {n > 0 && <span className="count bad" aria-label={`${n} problem${n === 1 ? '' : 's'}`}>{n}</span>}
            <button className={cx('asm-tab-x', dirty.has(p) && 'dirty')} tabIndex={-1} aria-label={`Close ${name}`} title="Close (Ctrl+F4, or a middle click on the tab)"
              onClick={e => { e.stopPropagation(); onClose([p]); }}><Icon name="x" size={11} /></button>
          </div>
        );
      })}
    </div>
  );
}
