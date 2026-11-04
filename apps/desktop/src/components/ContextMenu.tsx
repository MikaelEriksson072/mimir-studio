import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Icon } from '../lib/icons';
import { cx } from '../lib/util';
import type { ContextMenuState } from '../lib/types';

const MARGIN = 8;

type SubItems = { label: string; key?: string; run: () => void }[];

export function ContextMenu({ menu, onClose }: { menu: ContextMenuState; onClose: () => void }) {
  useEffect(() => { const c = () => onClose(); window.addEventListener('mousedown', c); window.addEventListener('blur', c); return () => { window.removeEventListener('mousedown', c); window.removeEventListener('blur', c); }; }, [onClose]);
  // Escape closes the menu, and only that (in the listing it would go back too): caught before the app's keys
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', esc, true);
    return () => window.removeEventListener('keydown', esc, true);
  }, [onClose]);
  // the open submenu: its item's index and element (the submenu is placed beside it)
  const [sub, setSub] = useState<{ i: number; el: HTMLElement } | null>(null);
  // placed at the pointer, then moved so all of it is inside the window (measured: the menu's length varies);
  // a menu taller than the window scrolls
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number; maxHeight?: number }>({ left: menu.x, top: menu.y });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth, h = el.scrollHeight, W = window.innerWidth, H = window.innerHeight;
    const fits = h <= H - 2 * MARGIN;
    setPos({
      left: Math.max(MARGIN, Math.min(menu.x, W - w - MARGIN)),
      top: fits ? Math.max(MARGIN, Math.min(menu.y, H - h - MARGIN)) : MARGIN,
      ...(fits ? {} : { maxHeight: H - 2 * MARGIN }),
    });
  }, [menu]);
  return (
    // a menu that scrolls moves its items away from an open submenu: it closes
    <div ref={ref} className="ctx" style={{ left: pos.left, top: pos.top, ...(pos.maxHeight ? { maxHeight: pos.maxHeight, overflowY: 'auto' } : {}) }} onMouseDown={e => e.stopPropagation()} onScroll={() => setSub(null)} role="menu">
      {menu.items.map((it, i) => 'sep' in it ? <div key={i} className="ctx-sep" /> : 'children' in it ? (
        <div key={i} className={cx('ctx-item has-sub', sub?.i === i && 'open')} aria-haspopup="menu" aria-expanded={sub?.i === i} onMouseEnter={e => setSub({ i, el: e.currentTarget })}><span>{it.label}</span><Icon name="chevron" size={12} />
          {sub?.i === i && <SubMenu anchor={sub.el} items={it.children} onClose={onClose} />}
        </div>
      ) : <button key={i} className={cx('ctx-item', it.checked != null && 'checkable')} role={it.checked != null ? 'menuitemcheckbox' : 'menuitem'} aria-checked={it.checked} onMouseEnter={() => setSub(null)} onClick={() => { onClose(); it.run(); }}>
        <span>{it.checked != null && <span className="ctx-check">{it.checked && <Icon name="check" size={12} />}</span>}{it.label}</span>{it.key && <kbd>{it.key}</kbd>}</button>)}
    </div>
  );
}

/** A submenu beside its item, fixed in the window so a menu that scrolls (and so clips what is outside it) does not
 *  hide it: right of the item, or left of it where the window ends, moved up where it would run past the bottom, and
 *  scrolling when it is taller than the window. Measured before it shows. */
function SubMenu({ anchor, items, onClose }: { anchor: HTMLElement; items: SubItems; onClose: () => void }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number; maxHeight?: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const a = anchor.getBoundingClientRect(), w = el.offsetWidth, h = el.scrollHeight, W = window.innerWidth, H = window.innerHeight;
    const right = a.right + 2, fits = h <= H - 2 * MARGIN;
    setPos({
      left: right + w <= W - MARGIN ? right : Math.max(MARGIN, a.left - w - 2),
      top: fits ? Math.max(MARGIN, Math.min(a.top - 5, H - h - MARGIN)) : MARGIN,
      ...(fits ? {} : { maxHeight: H - 2 * MARGIN }),
    });
  }, [anchor]);
  return (
    <div ref={ref} className="ctx sub" role="menu" style={pos ? { left: pos.left, top: pos.top, ...(pos.maxHeight ? { maxHeight: pos.maxHeight, overflowY: 'auto' } : {}) } : { left: 0, top: 0, visibility: 'hidden' }}>
      {items.map((c, j) => <button key={j} className="ctx-item" role="menuitem" onClick={() => { onClose(); c.run(); }}><span>{c.label}</span>{c.key && <kbd>{c.key}</kbd>}</button>)}
    </div>
  );
}
