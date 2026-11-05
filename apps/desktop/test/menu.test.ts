import { describe, expect, it } from 'vitest';
import { menuStep, tidy } from '../src/lib/menu';
import type { MenuItem } from '../src/lib/types';

const run = () => {};
const names = (items: MenuItem[]): unknown[] => items.map(it => ('sep' in it ? '---' : 'header' in it ? `# ${it.header}` : 'children' in it ? { [it.label]: names(it.children) } : it.label));

describe('tidy: a menu without what shows nothing', () => {
  it('leaves out empty submenus, also when all they hold is empty', () => {
    expect(names(tidy([
      { label: 'Rename label…', run },
      { label: '16-bit variable', children: [] },
      { label: 'Program', children: [{ sep: true }, { label: 'Deeper', children: [] }, { sep: true }] },
      { label: 'Block', children: [{ label: 'Fold block', run }] },
    ]))).toEqual(['Rename label…', { Block: ['Fold block'] }]);
  });

  it('drops separators at the ends and twice in a row, also where a left-out item stood between them', () => {
    expect(names(tidy([
      { sep: true },
      { label: 'Rename label…', run },
      { sep: true },
      { label: 'Patch', children: [] },
      { sep: true },
      { label: 'Copy line', run },
      { sep: true },
    ]))).toEqual(['Rename label…', '---', 'Copy line']);
  });

  it('drops a heading with nothing under it, and the separator before it', () => {
    expect(names(tidy([
      { header: 'Memory configuration ($01)' },
      { label: '$37', run },
      { sep: true },
      { header: 'VIC bank' },
      { sep: true },
    ]))).toEqual(['# Memory configuration ($01)', '$37']);
  });
});

describe('menuStep: the keys move over the items that can be chosen', () => {
  const items: MenuItem[] = [{ header: 'A' }, { label: 'one', run }, { sep: true }, { label: 'two', children: [{ label: 'x', run }] }, { label: 'three', run }];
  it('↓ from nothing is the first item, ↑ from nothing the last', () => {
    expect(menuStep(items, -1, 1)).toBe(1);
    expect(menuStep(items, 0, -1)).toBe(4);
  });
  it('skips separators and headings, and goes round the ends', () => {
    expect(menuStep(items, 1, 1)).toBe(3);
    expect(menuStep(items, 3, -1)).toBe(1);
    expect(menuStep(items, 4, 1)).toBe(1);
    expect(menuStep(items, 1, -1)).toBe(4);
  });
  it('is -1 in a menu with nothing to choose', () => {
    expect(menuStep([{ sep: true }, { header: 'A' }], -1, 1)).toBe(-1);
  });
});
