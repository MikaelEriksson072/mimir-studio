import { describe, expect, it } from 'vitest';
import type { Block, BlockKind } from '@mimir/core';
import { blockFolders, blockView } from '../src/lib/blockfolders';

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

describe('where Shift+click in the Blocks view shows a block', () => {
  const text = (enc?: 'petscii' | 'screen' | 'petscii-mixed' | 'screen-mixed') => ({ ...blk('text', 0x0a00), props: enc ? { enc } : {} });

  it('draws graphics in Graphics as their type, a bitmap as high as it is', () => {
    expect(blockView(blk('sprite', 0x2000, 64))).toEqual({ tab: 'gfx', kind: 'sprites' });
    expect(blockView(blk('charset', 0x3000, 0x800))).toEqual({ tab: 'gfx', kind: 'chars' });
    expect(blockView(blk('screen', 0x0400, 1000))).toEqual({ tab: 'gfx', kind: 'screens' });
    expect(blockView(blk('bitmap', 0x2000, 8000))).toEqual({ tab: 'gfx', kind: 'bitmap', rows: 25 });
    // a logo of 8 character rows, a bitmap with more than a picture, a sliver
    expect(blockView(blk('bitmap', 0x4000, 2560))).toMatchObject({ rows: 8 });
    expect(blockView(blk('bitmap', 0x4000, 0x2000))).toMatchObject({ rows: 25 });
    expect(blockView(blk('bitmap', 0x4000, 100))).toMatchObject({ rows: 1 });
  });

  it('shows text in Memory as PETSCII or screen codes, in the lower case set for mixed case', () => {
    expect(blockView(text())).toEqual({ tab: 'mem', mode: 'i', lower: false });
    expect(blockView(text('petscii'))).toEqual({ tab: 'mem', mode: 'i', lower: false });
    expect(blockView(text('screen'))).toEqual({ tab: 'mem', mode: 'ii', lower: false });
    expect(blockView(text('petscii-mixed'))).toEqual({ tab: 'mem', mode: 'i', lower: true });
    expect(blockView(text('screen-mixed'))).toEqual({ tab: 'mem', mode: 'ii', lower: true });
  });

  it('selects code in the listing and shows other data in Memory as hex and text, in the case it has', () => {
    for (const k of ['code', 'basic', 'reloc'] as const) expect(blockView(blk(k, 0x0810)), k).toEqual({ tab: 'listing' });
    for (const k of ['data', 'words', 'table', 'lohi', 'music', 'fill'] as const) expect(blockView(blk(k, 0x0900)), k).toEqual({ tab: 'mem', mode: 'm', lower: null });
  });
});
