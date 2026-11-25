/* The Assembler's folder in the main process (spec 10.7): a file named only by its path inside the folder, the listing,
 * new files and folders, renames, deletes, and the folders opened before. */
import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { asmTemplate } from '@mimir/core';
import { AsmStore, changeInFolder, createAsmFolder, inFolder, listFolder, readInFolder, writeInFolder } from '../electron/main/assembler';
import { asmChangeSchema, asmPickDataSchema, asmReadSchema, asmWriteSchema } from '../electron/main/schemas';
import { relPath } from '../shared/projects';

const tmp = () => mkdtempSync(join(tmpdir(), 'mimir-asm-test-'));

describe('the Assembler\'s folder', () => {
  it('names a file only inside the folder', () => {
    const dir = tmp();
    try {
      expect(inFolder(dir, 'src/main.asm')).toBe(join(dir, 'src', 'main.asm'));
      for (const bad of ['../x.asm', 'src/../../x.asm', 'C:/x.asm', 'C:x.asm', '/x.asm', '\\x.asm', '', 'a//b', 'a/./b', 'a:b', 'x?.asm']) expect(() => inFolder(dir, bad), bad).toThrow(/not a path inside the folder/);
      // the IPC schemas refuse them before that
      expect(asmReadSchema.safeParse({ dir, path: '../x.asm' }).success).toBe(false);
      expect(asmWriteSchema.safeParse({ dir, path: 'C:\\x.asm', text: '' }).success).toBe(false);
      expect(asmChangeSchema.safeParse({ dir, op: 'rename', path: 'a.asm', to: 'b/../../c.asm' }).success).toBe(false);
      expect(asmChangeSchema.safeParse({ dir, op: 'remove', path: 'a.asm' }).success).toBe(true);
      expect(asmChangeSchema.safeParse({ dir, op: 'format', path: 'a.asm' }).success).toBe(false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('lists the folder, the folders first, without .git; reads and writes files; makes, renames and deletes them', async () => {
    const dir = tmp();
    try {
      mkdirSync(join(dir, '.git')); writeFileSync(join(dir, '.git', 'HEAD'), 'x');
      mkdirSync(join(dir, 'lib'));
      writeFileSync(join(dir, 'main.asm'), 'BasicUpstart2(start)\n');
      writeFileSync(join(dir, 'lib', 'print.asm'), 'print: rts\n');
      writeFileSync(join(dir, 'logo.bin'), new Uint8Array([1, 2, 3]));
      const l = await listFolder(dir);
      expect(l.entries.map(e => e.path)).toEqual(['lib', 'lib/print.asm', 'logo.bin', 'main.asm']);
      expect(l.entries.find(e => e.path === 'logo.bin')?.size).toBe(3);
      expect(l.more).toBe(false);
      expect((await readInFolder(dir, 'main.asm', 'text')).text).toBe('BasicUpstart2(start)\n');
      expect([...(await readInFolder(dir, 'logo.bin', 'bytes')).bytes!]).toEqual([1, 2, 3]);
      const w = await writeInFolder(dir, 'src/new.asm', 'nop\n');
      expect(w.mtime).toBeGreaterThan(0);
      expect(readFileSync(join(dir, 'src', 'new.asm'), 'utf8')).toBe('nop\n');

      const trashed: string[] = [];
      const trash = async (p: string) => { trashed.push(p); rmSync(p, { recursive: true }); };
      await changeInFolder(dir, { dir, op: 'file', path: 'lib/sid.asm', text: '// music\n' }, trash);
      expect(readFileSync(join(dir, 'lib', 'sid.asm'), 'utf8')).toBe('// music\n');
      await expect(changeInFolder(dir, { dir, op: 'file', path: 'lib/sid.asm' }, trash)).rejects.toThrow(/there already/);
      await changeInFolder(dir, { dir, op: 'folder', path: 'gfx' }, trash);
      expect(existsSync(join(dir, 'gfx'))).toBe(true);
      await changeInFolder(dir, { dir, op: 'rename', path: 'lib', to: 'code/lib' }, trash);
      expect(existsSync(join(dir, 'code', 'lib', 'print.asm'))).toBe(true);
      await expect(changeInFolder(dir, { dir, op: 'rename', path: 'code', to: 'code/inner' }, trash)).rejects.toThrow(/into itself/);
      await expect(changeInFolder(dir, { dir, op: 'rename', path: 'main.asm', to: 'logo.bin' }, trash)).rejects.toThrow(/there already/);
      // a change of case only
      await changeInFolder(dir, { dir, op: 'rename', path: 'main.asm', to: 'Main.asm' }, trash);
      expect((await listFolder(dir)).entries.some(e => e.path === 'Main.asm')).toBe(true);
      await changeInFolder(dir, { dir, op: 'remove', path: 'logo.bin' }, trash);
      expect(trashed).toEqual([join(dir, 'logo.bin')]);
      expect(existsSync(join(dir, 'logo.bin'))).toBe(false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('makes a new folder with its first source, and keeps the folders opened', async () => {
    const parent = tmp();
    try {
      const dir = await createAsmFolder(parent, 'demo', { 'main.asm': asmTemplate('kickass', 'demo') });
      expect(dir).toBe(join(parent, 'demo'));
      expect(readFileSync(join(dir, 'main.asm'), 'utf8')).toContain('BasicUpstart2(start)');
      await expect(createAsmFolder(parent, 'demo', { 'main.asm': '' })).rejects.toThrow(/there already, with files in it/);
      await expect(createAsmFolder(parent, 'a:b', {})).rejects.toThrow();
      const store = new AsmStore(parent);
      expect(store.recent()).toEqual([]);
      store.enter(dir); store.enter(parent); store.enter(dir);
      expect(store.recent().map(r => r.dir)).toEqual([dir, parent]);
      expect(store.isRecent(dir.toUpperCase())).toBe(true);
      // kept in the user data folder
      expect(new AsmStore(parent).recent().map(r => r.name)).toEqual(['demo', parent.split(/[\\/]/).pop()]);
      expect(store.forget(parent).map(r => r.dir)).toEqual([dir]);
    } finally { rmSync(parent, { recursive: true, force: true }); }
  });
});

describe('a block\'s file (Insert block)', () => {
  it('is written as bytes, a source as text, never both', async () => {
    const dir = tmp();
    try {
      expect(asmWriteSchema.safeParse({ dir, path: 'sprites/a.spr', bytes: new Uint8Array(64) }).success).toBe(true);
      expect(asmWriteSchema.safeParse({ dir, path: 'a.asm', text: 'x' }).success).toBe(true);
      expect(asmWriteSchema.safeParse({ dir, path: 'a.bin', text: 'x', bytes: new Uint8Array(1) }).success).toBe(false);
      expect(asmWriteSchema.safeParse({ dir, path: 'a.bin' }).success).toBe(false);
      expect(asmWriteSchema.safeParse({ dir, path: 'a.bin', bytes: new Uint8Array(0x10200) }).success).toBe(false);
      await writeInFolder(dir, 'sprites/a.spr', Uint8Array.from([1, 2, 255]));
      expect([...readFileSync(join(dir, 'sprites', 'a.spr'))]).toEqual([1, 2, 255]);
      expect(asmPickDataSchema.safeParse({ dir, kind: 'music' }).success).toBe(true);
      expect(asmPickDataSchema.safeParse({ dir, kind: 'code' }).success).toBe(false);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('is named from the source\'s folder', () => {
    expect(relPath('', 'sprites/a.spr')).toBe('sprites/a.spr');
    expect(relPath('src', 'src/sprites/a.spr')).toBe('sprites/a.spr');
    expect(relPath('src/game', 'gfx/a.kla')).toBe('../../gfx/a.kla');
    expect(relPath('src', 'a.bin')).toBe('../a.bin');
  });
});
