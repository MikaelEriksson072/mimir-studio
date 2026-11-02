/* The Editor button: which editor is found (Sublime Text, then Visual Studio Code, where they install themselves) and
 * what is started, the export's folder with its first .asm file. */
import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { editorCommand, editorName, findEditors } from '../src/node';

const tmp = () => mkdtempSync(join(tmpdir(), 'mimir-editor-'));
const touch = (...parts: string[]) => { const f = join(...parts); mkdirSync(join(f, '..'), { recursive: true }); writeFileSync(f, ''); return f; };

describe('the external editor', () => {
  it('is called by its name', () => {
    expect(editorName('C:\\Program Files\\Sublime Text\\subl.exe')).toBe('Sublime Text');
    expect(editorName('C:\\Program Files\\Sublime Text\\sublime_text.exe')).toBe('Sublime Text');
    expect(editorName('C:\\Users\\me\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe')).toBe('Visual Studio Code');
    expect(editorName('C:\\Users\\me\\AppData\\Local\\Programs\\Microsoft VS Code\\bin\\code.cmd')).toBe('Visual Studio Code');
    expect(editorName('/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code')).toBe('Visual Studio Code');
    expect(editorName('C:\\Tools\\Notepad++\\notepad++.exe')).toBe('notepad++');
  });

  it('opens the folder with the file in it, the template filled in', () => {
    const c = editorCommand({ exe: 'C:\\Program Files\\Sublime Text\\subl.exe', dir: 'C:\\my work\\source', file: 'demo.asm', platform: 'win32', env: { Path: 'C:\\Windows' } });
    expect(c).toEqual({ file: 'C:\\Program Files\\Sublime Text\\subl.exe', args: ['C:\\my work\\source', 'C:\\my work\\source\\demo.asm'], cwd: 'C:\\my work\\source', env: { Path: 'C:\\Windows' } });
    const n = { exe: 'C:\\npp\\notepad++.exe', dir: 'C:\\w', file: 'a.asm', platform: 'win32' as const, env: {} };
    expect(editorCommand({ ...n, args: '-multiInst "{file}"' }).args).toEqual(['-multiInst', 'C:\\w\\a.asm']);
    // flags alone: the folder and the file go after them
    expect(editorCommand({ ...n, args: '-n' }).args).toEqual(['-n', 'C:\\w', 'C:\\w\\a.asm']);
    expect(editorCommand({ exe: '/usr/bin/subl', dir: '/w', file: 'a.asm', platform: 'linux', env: {} }).args).toEqual(['/w', '/w/a.asm']);
  });

  it('leaves Electron\'s variables out, so VS Code starts as itself', () => {
    const c = editorCommand({ exe: 'C:\\VS Code\\Code.exe', dir: 'C:\\w', file: 'a.asm', platform: 'win32', env: { Path: 'C:\\Windows', ELECTRON_RUN_AS_NODE: '1', electron_no_attach_console: '1' } });
    expect(c.env).toEqual({ Path: 'C:\\Windows' });
  });

  it.skipIf(process.platform !== 'win32')('starts the Code.exe above VS Code\'s bin\\code.cmd, and no other script', () => {
    const root = tmp();
    const cmd = touch(root, 'Microsoft VS Code', 'bin', 'code.cmd'), exe = touch(root, 'Microsoft VS Code', 'Code.exe');
    expect(editorCommand({ exe: cmd, dir: 'C:\\w', file: 'a.asm', env: {} }).file).toBe(exe);
    expect(() => editorCommand({ exe: touch(root, 'tools', 'edit.bat'), dir: 'C:\\w', file: 'a.asm', env: {} })).toThrow(/does not start/);
  });

  it.skipIf(process.platform !== 'win32')('finds Sublime Text and VS Code where they install themselves, Sublime Text first', () => {
    const root = tmp(), programs = join(root, 'Program Files'), local = join(root, 'Local');
    expect(findEditors({ env: { ProgramFiles: programs, LOCALAPPDATA: local, Path: '' } })).toEqual([]);
    const code = touch(local, 'Programs', 'Microsoft VS Code', 'Code.exe');
    expect(findEditors({ env: { ProgramFiles: programs, LOCALAPPDATA: local } })).toEqual([{ name: 'Visual Studio Code', path: code }]);
    const subl = touch(programs, 'Sublime Text 3', 'subl.exe');
    expect(findEditors({ env: { ProgramFiles: programs, LOCALAPPDATA: local } })).toEqual([{ name: 'Sublime Text', path: subl }, { name: 'Visual Studio Code', path: code }]);
  });

  it.skipIf(process.platform !== 'win32')('finds them on PATH, VS Code by its bin\\code.cmd', () => {
    const root = tmp();
    touch(root, 'VSCode', 'bin', 'code.cmd');
    const code = touch(root, 'VSCode', 'Code.exe'), subl = touch(root, 'ST', 'subl.exe');
    expect(findEditors({ env: { PATH: [join(root, 'VSCode', 'bin'), join(root, 'ST')].join(';') } })).toEqual([{ name: 'Sublime Text', path: subl }, { name: 'Visual Studio Code', path: code }]);
  });
});
