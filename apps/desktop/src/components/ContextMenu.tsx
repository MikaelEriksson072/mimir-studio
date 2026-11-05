import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../lib/icons';
import { cx } from '../lib/util';
import { actionable, isSub, menuStep as step, tidy, type MenuAction as Act, type SubMenu as Sub } from '../lib/menu';
import type { ContextMenuState, MenuItem } from '../lib/types';

const MARGIN = 8;
/** how long the pointer may cross other items on its way into an open submenu before that submenu gives way (ms) */
const AIM = 250;

/** the open submenus (the index of the item each one opens from, level by level), the highlighted item of every level
 *  shown (-1: none) and the level the keys act on */
interface MenuNav { open: number[]; hot: number[]; level: number }
const START: MenuNav = { open: [], hot: [-1], level: 0 };
const withHot = (hot: number[], level: number, i: number) => { const h = hot.slice(0, level + 1); while (h.length <= level) h.push(-1); h[level] = i; return h; };

/**
 * The right-click menu and the other menus: submenus to any depth, headings and separators, an icon or a tick in
 * front of an item, and its key behind it. The mouse and the keys move the same highlight: ↑/↓ (Home/End) through the
 * items, → or Enter into a submenu, ← or Escape back out of it, Enter or Space chooses. Escape on the menu itself closes
 * it, and only that (in the listing it would go back too); any other key closes it and goes on to the app, so the keys
 * the items show work with the menu open.
 */
export function ContextMenu({ menu, onClose }: { menu: ContextMenuState; onClose: () => void }) {
  const root = useMemo(() => tidy(menu.items), [menu]);
  const [nav, setNav] = useState<MenuNav>(START);
  // a new menu in its place starts afresh
  const [shown, setShown] = useState(menu);
  if (shown !== menu) { setShown(menu); setNav(START); }
  /** every level shown: the menu, then each open submenu */
  const levels = useMemo(() => {
    const out = [root];
    for (const i of nav.open) { const it = out[out.length - 1][i]; if (!isSub(it)) break; out.push(it.children); }
    return out;
  }, [root, nav.open]);
  /** the items' elements, level by level (a submenu is placed beside its item) */
  const els = useRef<(HTMLElement | null)[][]>([]);
  const aim = useRef<number | undefined>(undefined);
  const wait = (f: () => void) => { window.clearTimeout(aim.current); aim.current = window.setTimeout(f, AIM); };
  const stopAim = () => window.clearTimeout(aim.current);
  useEffect(() => stopAim, []);

  useEffect(() => { const c = () => onClose(); window.addEventListener('mousedown', c); window.addEventListener('blur', c); return () => { window.removeEventListener('mousedown', c); window.removeEventListener('blur', c); }; }, [onClose]);

  const choose = (it: Act) => { stopAim(); onClose(); it.run(); };
  /** open the submenu of item `i` at `level`; `into`: with its first item highlighted and the keys acting on it */
  const openSub = (level: number, i: number, into: boolean) => {
    stopAim();
    const it = levels[level]?.[i];
    if (!isSub(it)) return;
    setNav(s => ({
      open: [...s.open.slice(0, level), i],
      hot: into ? withHot(withHot(s.hot, level, i), level + 1, step(it.children, -1, 1)) : withHot(withHot(s.hot, level, i), level + 1, -1),
      level: into ? level + 1 : level,
    }));
  };
  /** close the submenus below `level`, its own highlight staying where it is */
  const closeBelow = (level: number) => setNav(s => ({ open: s.open.slice(0, level), hot: s.hot.slice(0, level + 1), level: Math.min(s.level, level) }));

  // caught before the app's keys
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (['Shift', 'Control', 'Alt', 'Meta', 'AltGraph', 'CapsLock'].includes(e.key)) return;
      const { level, hot } = nav, items = levels[level] ?? [], cur = hot[level] ?? -1, it = items[cur];
      const stop = () => { e.preventDefault(); e.stopPropagation(); };
      const back = () => { if (level > 0) setNav(s => ({ open: s.open.slice(0, level - 1), hot: s.hot.slice(0, level), level: level - 1 })); };
      // in a menu that scrolls the item comes into view (which closes the submenus below, as moving does)
      const move = (i: number) => { setNav(s => ({ open: s.open.slice(0, level), hot: withHot(s.hot, level, i), level })); els.current[level]?.[i]?.scrollIntoView({ block: 'nearest' }); };
      switch (e.key) {
        case 'ArrowDown': stop(); move(step(items, cur < 0 ? -1 : cur, 1)); return;
        case 'ArrowUp': stop(); move(step(items, cur < 0 ? 0 : cur, -1)); return;
        case 'Home': stop(); move(step(items, -1, 1)); return;
        case 'End': stop(); move(step(items, 0, -1)); return;
        case 'ArrowRight': stop(); if (isSub(it)) openSub(level, cur, true); return;
        case 'ArrowLeft': stop(); back(); return;
        case 'Enter': case ' ':
          stop();
          if (isSub(it)) openSub(level, cur, true);
          else if (actionable(it)) choose(it);
          return;
        case 'Escape': stop(); if (level > 0) back(); else onClose(); return;
        case 'Tab': stop(); onClose(); return;
        default: onClose();
      }
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [nav, levels, onClose]); // eslint-disable-line react-hooks/exhaustive-deps

  /** the pointer on an item: it is highlighted, and its submenu opens (or the open one closes) at once, or after a
   *  moment when another submenu of this level is open, so the pointer can cross items on its way into that one */
  const enter = (level: number, i: number) => {
    stopAim();
    setNav(s => ({ ...s, hot: withHot(s.hot, level, i), level }));
    const it = levels[level]?.[i];
    const act = () => { if (isSub(it)) openSub(level, i, false); else closeBelow(level); };
    if (nav.open.length > level && nav.open[level] !== i) wait(act); else act();
  };
  /** the pointer in a submenu: the switch it was on its way past is off, and its item is highlighted again */
  const enterLevel = (level: number) => {
    stopAim();
    if (level > 0) setNav(s => ({ ...s, hot: withHot(s.hot, level - 1, s.open[level - 1] ?? -1) }));
  };
  /** the pointer out of a menu: nothing in it is highlighted but the item of its open submenu */
  const leaveLevel = (level: number) => {
    stopAim();
    setNav(s => ({ ...s, hot: withHot(s.hot, level, s.open[level] ?? -1) }));
  };

  return (
    <>
      {levels.map((items, level) => (
        <MenuLevel key={level === 0 ? 'root' : `${level}:${nav.open[level - 1]}`} level={level} items={items} hot={nav.hot[level] ?? -1} open={nav.open[level]}
          at={level === 0 ? { x: menu.x, y: menu.y } : null} anchor={() => els.current[level - 1]?.[nav.open[level - 1]] ?? null}
          label={level === 0 ? undefined : (levels[level - 1][nav.open[level - 1]] as Sub).label}
          setEl={(i, el) => { (els.current[level] ??= [])[i] = el; }}
          onEnter={i => enter(level, i)} onEnterLevel={() => enterLevel(level)} onLeaveLevel={() => leaveLevel(level)}
          onScroll={() => closeBelow(level)}
          onChoose={i => { const it = items[i]; if (isSub(it)) openSub(level, i, false); else if (actionable(it)) choose(it); }} />
      ))}
    </>
  );
}

/**
 * One level of the menu, fixed in the window. The menu itself is placed at the pointer and moved so all of it is inside
 * the window; a submenu right of its item, or left of it where the window ends, and moved up where it would run past
 * the bottom (with its first item level with its own item where it can). A level taller than the window scrolls (and a
 * submenu is fixed beside its item so that does not clip it). Measured before it shows: the length of the menus varies.
 */
function MenuLevel({ level, items, hot, open, at, anchor, label, setEl, onEnter, onEnterLevel, onLeaveLevel, onScroll, onChoose }: {
  level: number; items: MenuItem[]; hot: number; open: number | undefined; at: { x: number; y: number } | null; anchor: () => HTMLElement | null; label?: string;
  setEl: (i: number, el: HTMLElement | null) => void; onEnter: (i: number) => void; onEnterLevel: () => void; onLeaveLevel: () => void; onScroll: () => void; onChoose: (i: number) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number; maxHeight?: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth, h = el.scrollHeight, W = window.innerWidth, H = window.innerHeight, fits = h <= H - 2 * MARGIN;
    const fit = fits ? {} : { maxHeight: H - 2 * MARGIN };
    if (at) { setPos({ left: Math.max(MARGIN, Math.min(at.x, W - w - MARGIN)), top: fits ? Math.max(MARGIN, Math.min(at.y, H - h - MARGIN)) : MARGIN, ...fit }); return; }
    const a = anchor()?.getBoundingClientRect();
    if (!a) return;
    // where it fits neither side, it lies over the side of the menu with more room, covering as little of it as it can
    const right = a.right + 2, left = a.left - w - 2;
    setPos({
      left: right + w <= W - MARGIN ? right : left >= MARGIN ? left : W - MARGIN - right >= a.left - MARGIN ? Math.max(MARGIN, W - MARGIN - w) : MARGIN,
      top: fits ? Math.max(MARGIN, Math.min(a.top - 5, H - h - MARGIN)) : MARGIN,
      ...fit,
    });
  }, [items, at?.x, at?.y]); // eslint-disable-line react-hooks/exhaustive-deps
  // a column for icons and ticks when any item of this level has one, so the names line up
  const gutter = items.some(it => actionable(it) && (it.icon || ('checked' in it && it.checked != null)));
  const lead = (it: Act | Sub) => gutter && <span className="ctx-ico">{'checked' in it && it.checked ? <Icon name="check" size={13} /> : it.icon ? <Icon name={it.icon} size={14} /> : null}</span>;
  const style = pos ? { left: pos.left, top: pos.top, ...(pos.maxHeight ? { maxHeight: pos.maxHeight, overflowY: 'auto' as const } : {}) } : { left: 0, top: 0, visibility: 'hidden' as const };
  return (
    // a menu that scrolls moves its items away from an open submenu: it closes
    <div ref={ref} className={cx('ctx', level > 0 && 'sub', gutter && 'has-gutter')} role="menu" aria-label={label} style={style}
      // a click on an item leaves the focus where it was (in the listing, whose keys go on working)
      onMouseDown={e => { e.stopPropagation(); if ((e.target as Element).closest('.ctx-item')) e.preventDefault(); }} onContextMenu={e => e.preventDefault()} onScroll={onScroll} onMouseEnter={onEnterLevel} onMouseLeave={onLeaveLevel}>
      {items.map((it, i) => {
        if ('sep' in it) return <div key={i} className="ctx-sep" role="separator" />;
        if ('header' in it) return <div key={i} className="ctx-head" role="presentation">{it.header}</div>;
        const sub = isSub(it), checkable = !sub && it.checked != null;
        return (
          <button key={i} ref={el => setEl(i, el)} type="button" tabIndex={-1}
            className={cx('ctx-item', sub && 'has-sub', open === i && 'open', hot === i && 'hot', checkable && 'checkable')}
            role={checkable ? 'menuitemcheckbox' : 'menuitem'} aria-checked={checkable ? !!it.checked : undefined}
            aria-haspopup={sub ? 'menu' : undefined} aria-expanded={sub ? open === i : undefined}
            onMouseEnter={() => onEnter(i)} onClick={() => onChoose(i)}>
            <span className="ctx-label">{lead(it)}<span>{it.label}</span></span>
            {sub ? <Icon name="chevron" size={12} className="ctx-more" /> : it.key && <kbd>{it.key}</kbd>}
          </button>
        );
      })}
    </div>
  );
}
