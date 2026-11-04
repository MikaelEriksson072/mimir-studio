import { describe, expect, it } from 'vitest';
import type { Block, BlockKind } from '@mimir/core';
import { blockFolders } from '../src/lib/blockfolders';

let id = 0;
const blk = (type: BlockKind, start: number, len = 16): Block =>
  ({ id: id++, start, end: start + len, type, file: 0, props: {}, conf: 1, reason: '', user: false, entropy: 0 }) as Block;

const blocks = [
  blk('data', 0x0900), blk('code', 0x0810), blk('sprite', 0x2000, 64), blk('text', 0x0a00), blk('code', 0x0c00),
  blk('lohi', 0x0b00), blk('table', 0x0b40), blk('basic', 0x0801, 15), blk('charset', 0x3000, 0x800), blk('code', 0x0880),
];

describe('Blocks view folders', () => {
  it('puts the blocks in a folder per type, in the order of the type groups, each with how many there are', () => {
    const f = blockFolders(blocks);
    expect(f.map(x => [x.label, x.total])).toEqual([
      ['Code', 3], ['BASIC', 1], ['Sprites', 1], ['Charset', 1], ['Table', 1], ['Lo/Hi table', 1], ['Text', 1], ['Data', 1],
    ]);
    // by address in a folder
    expect(f[0].blocks.map(b => b.start)).toEqual([0x0810, 0x0880, 0x0c00]);
    // a type with no block has no folder
    expect(f.some(x => x.kind === 'music')).toBe(false);
  });

  it('keeps what the filter keeps, still counting every block of the type', () => {
    const f = blockFolders(blocks, b => b.start < 0x0a00);
    const code = f.find(x => x.kind === 'code')!;
    expect(code.total).toBe(3);
    expect(code.blocks.map(b => b.start)).toEqual([0x0810, 0x0880]);
    expect(f.find(x => x.kind === 'sprite')).toMatchObject({ total: 1, blocks: [] });
  });

  it('has no folders without blocks', () => {
    expect(blockFolders([])).toEqual([]);
  });
});
