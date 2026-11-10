/* The Blocks view's folders: one for each type of block in the program, in the order of the type groups (code, BASIC,
 * graphics, music, tables, text, data, fill, relocated), each with how many blocks of its type there are and the ones
 * the filter keeps, by address. And where Shift+click on a block shows it (`blockView`). */
import { kindInfo, TYPE_BY_KEY, type Block, type BlockKind, type MonitorMode, type TypeGroup } from '@mimir/core';

const GROUP_ORDER: readonly TypeGroup[] = ['code', 'basic', 'gfx', 'music', 'table', 'text', 'data', 'fill', 'reloc'];

export interface BlockFolder {
  kind: BlockKind; label: string; group: TypeGroup;
  /** how many blocks of this type there are */
  total: number;
  /** the ones the filter keeps, by address */
  blocks: Block[];
}

/** The blocks in a folder per type; a type with no block has none. `keep`: the filter (the folder still counts every
 *  block of its type). */
export function blockFolders(blocks: readonly Block[], keep: (b: Block) => boolean = () => true): BlockFolder[] {
  const by = new Map<BlockKind, BlockFolder>();
  for (const b of blocks) {
    let f = by.get(b.type);
    if (!f) { const i = kindInfo(b.type); f = { kind: b.type, label: i.label, group: i.group, total: 0, blocks: [] }; by.set(b.type, f); }
    f.total++;
    if (keep(b)) f.blocks.push(b);
  }
  for (const f of by.values()) f.blocks.sort((x, y) => x.start - y.start);
  return [...by.values()].sort((x, y) => GROUP_ORDER.indexOf(x.group) - GROUP_ORDER.indexOf(y.group) || TYPE_BY_KEY[x.kind] - TYPE_BY_KEY[y.kind]);
}

/** the way the Graphics tab draws a block of this type (its `GfxPrefs.kind`; none: not graphics) */
export const GFX_KIND: Partial<Record<BlockKind, 'sprites' | 'chars' | 'bitmap' | 'screens'>> = { sprite: 'sprites', charset: 'chars', bitmap: 'bitmap', screen: 'screens' };

/** Where a block is shown in a view of its type's own (Shift+click in the Blocks view), selected there: graphics in
 *  Graphics, drawn as their type (a bitmap as high as it is: `rows` character rows, 1-25); text in Memory as the VICE
 *  monitor's `i` (PETSCII) or `ii` (screen codes), in the lower case set for mixed case (`lower`); code, BASIC and
 *  relocated code in the listing; every other block (bytes, words, tables, music, fill) in Memory as hex and text (`m`),
 *  in the case it has (`lower` null). */
export type BlockView =
  | { tab: 'gfx'; kind: 'sprites' | 'chars' | 'bitmap' | 'screens'; rows?: number }
  | { tab: 'mem'; mode: MonitorMode; lower: boolean | null }
  | { tab: 'listing' };

const IN_LISTING: readonly BlockKind[] = ['code', 'basic', 'reloc'];
/** the bytes of a bitmap's character row (40 cells of 8) */
const BITMAP_ROW = 320;

export function blockView(b: Pick<Block, 'type' | 'props' | 'start' | 'end'>): BlockView {
  const kind = GFX_KIND[b.type];
  if (kind) return kind === 'bitmap' ? { tab: 'gfx', kind, rows: Math.max(1, Math.min(25, Math.ceil((b.end - b.start) / BITMAP_ROW))) } : { tab: 'gfx', kind };
  if (IN_LISTING.includes(b.type)) return { tab: 'listing' };
  if (b.type === 'text') {
    const enc = b.props.enc ?? 'petscii';
    return { tab: 'mem', mode: enc.startsWith('screen') ? 'ii' : 'i', lower: enc.endsWith('-mixed') };
  }
  return { tab: 'mem', mode: 'm', lower: null };
}
