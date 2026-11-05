import type { MenuItem } from './types';

export type SubMenu = Extract<MenuItem, { children: MenuItem[] }>;
export type MenuAction = Extract<MenuItem, { run: () => void }>;
/** an item that can be chosen (an action or a submenu), not a separator or a heading */
export const actionable = (it: MenuItem | undefined): it is MenuAction | SubMenu => !!it && !('sep' in it) && !('header' in it);
export const isSub = (it: MenuItem | undefined): it is SubMenu => !!it && 'children' in it;

/** Without what shows nothing: empty submenus, headings with no items under them, separators at the ends or twice. The
 *  menus can then list every item and leave out what does not apply. */
export function tidy(items: MenuItem[]): MenuItem[] {
  const kept = items.flatMap((it): MenuItem[] => {
    if (!isSub(it)) return [it];
    const children = tidy(it.children);
    return children.length ? [{ ...it, children }] : [];
  });
  const out: MenuItem[] = [];
  kept.forEach((it, i) => {
    if ('header' in it && !actionable(kept[i + 1])) return;
    if ('sep' in it && (!out.length || 'sep' in out[out.length - 1])) return;
    out.push(it);
  });
  while (out.length && 'sep' in out[out.length - 1]) out.pop();
  return out;
}

/** the item after `from` (or before it, `dir` -1) that can be chosen, round the end; -1 when there is none. From -1
 *  going down that is the first, from 0 going up the last. */
export function menuStep(items: MenuItem[], from: number, dir: 1 | -1): number {
  for (let n = 0, i = from; n < items.length; n++) {
    i = (i + dir + items.length) % items.length;
    if (actionable(items[i])) return i;
  }
  return -1;
}
