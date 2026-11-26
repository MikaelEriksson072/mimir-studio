/* Files dropped on an Assembler project (spec 10.7): where each is copied to in its folder. */
import { describe, expect, it } from 'vitest';
import { asmDropPath } from '../src/asm-project';

const o = (taken: string[] = [], dirs: string[] = [], at: string | null = null, main: string | null = 'main.asm') => ({ taken: new Set(taken), dirs: new Set(dirs), at, main });

describe('asmDropPath', () => {
  it('puts each kind of file in its folder, a source beside the main file', () => {
    expect(asmDropPath('tune.sid', o())).toBe('music/tune.sid');
    expect(asmDropPath('ship.spr', o())).toBe('sprites/ship.spr');
    expect(asmDropPath('font.64c', o())).toBe('charsets/font.64c');
    expect(asmDropPath('pic.kla', o())).toBe('bitmaps/pic.kla');
    expect(asmDropPath('table.bin', o())).toBe('data/table.bin');
    expect(asmDropPath('readme.md', o())).toBe('readme.md');
    expect(asmDropPath('macros.asm', o())).toBe('macros.asm');
    expect(asmDropPath('macros.asm', o([], [], null, 'src/main.asm'))).toBe('src/macros.asm');
    expect(asmDropPath('C:\\Users\\x\\Desktop\\tune.sid', o())).toBe('music/tune.sid');
  });

  it('puts it in the folder it was dropped on in the file list, or beside the file it was dropped on', () => {
    expect(asmDropPath('tune.sid', o([], ['gfx'], 'gfx'))).toBe('gfx/tune.sid');
    expect(asmDropPath('tune.sid', o([], ['gfx'], 'gfx/logo.bin'))).toBe('gfx/tune.sid');
    expect(asmDropPath('tune.sid', o([], [], 'main.asm'))).toBe('tune.sid');
  });

  it('writes over nothing: a name taken (any case) gets -2, -3 … before its extension', () => {
    expect(asmDropPath('tune.sid', o(['music/Tune.sid']))).toBe('music/tune-2.sid');
    expect(asmDropPath('tune.sid', o(['music/tune.sid', 'music/tune-2.sid']))).toBe('music/tune-3.sid');
    expect(asmDropPath('Makefile', o(['data/Makefile']))).toBe('data/Makefile-2');
  });
});
