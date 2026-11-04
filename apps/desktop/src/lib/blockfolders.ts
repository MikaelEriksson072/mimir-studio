/* The Blocks view's folders: one for each type of block in the program, in the order of the type groups (code, BASIC,
 * graphics, music, tables, text, data, fill, relocated), each with how many blocks of its type there are and the ones
 * the filter keeps, by address. */
import { kindInfo, TYPE_BY_KEY, type Block, type BlockKind, type TypeGroup } from '@mimir/core';

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
