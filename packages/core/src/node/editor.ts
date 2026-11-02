/* Node-only: the external editor the export opens in. Sublime Text and Visual Studio Code are found where they install
 * themselves (or on PATH); any other editor can be set in Settings with an argument template of its own. */
import { spawn } from 'node:child_process';
import { statSync } from 'node:fs';
import { posix, win32 } from 'node:path';
import { DEFAULT_SETTINGS } from '../model';
import { splitArgs } from '../util/args';

export interface EditorInfo { name: string; path: string }

export interface EditorWhere {
  platform?: NodeJS.Platform;
  /** the environment to look in (default: this process's) */
  env?: Record<string, string | undefined>;
}

export interface EditorLaunch extends EditorWhere {
  exe: string;
  /** the argument template: {dir} the folder, {file} the file in it (its full path); empty: `{dir} {file}` */
  args?: string;
  dir: string;
  /** a file in `dir` */
  file: string;
}

export interface EditorCommand { file: string; args: string[]; cwd: string; env: Record<string, string | undefined> }

const isFile = (p: string): boolean => { try { return statSync(p).isFile(); } catch { return false; } };
const envVar = (env: Record<string, string | undefined>, name: string): string => env[Object.keys(env).find(k => k.toUpperCase() === name) ?? name] ?? '';

/** VS Code's programs beside the folder of its command-line script (bin\code.cmd) */
const VSCODE_EXES = ['Code.exe', 'Code - Insiders.exe', 'VSCodium.exe'];

/** what to call the editor at `path`: Sublime Text and Visual Studio Code by name, any other by its program's name */
export function editorName(path: string): string {
  const base = path.trim().split(/[\\/]/).pop() ?? path;
  const exe = base.replace(/\.(exe|cmd|bat)$/i, '').toLowerCase();
  if (exe === 'subl' || exe === 'sublime_text') return 'Sublime Text';
  if (exe === 'code') return 'Visual Studio Code';
  if (exe === 'code - insiders' || exe === 'code-insiders') return 'Visual Studio Code Insiders';
  if (exe === 'vscodium' || exe === 'codium') return 'VSCodium';
  return base.replace(/\.exe$/i, '');
}

/**
 * Sublime Text and Visual Studio Code where they are installed, Sublime Text first. Windows: Program Files, the user's
 * own programs folder (VS Code's user installer), Scoop, then PATH (where `code` is VS Code's bin\code.cmd, the
 * Code.exe above it is taken). macOS: /Applications. Elsewhere: PATH, /opt and snap.
 */
export function findEditors(o: EditorWhere = {}): EditorInfo[] {
  const platform = o.platform ?? process.platform, env = o.env ?? process.env;
  const win = platform === 'win32', p = win ? win32 : posix;
  const path = envVar(env, 'PATH').split(win ? ';' : ':').filter(Boolean);
  const home = envVar(env, win ? 'USERPROFILE' : 'HOME');
  let sublime: string[], vscode: string[];
  if (win) {
    const programs = [envVar(env, 'PROGRAMFILES'), envVar(env, 'PROGRAMW6432'), envVar(env, 'PROGRAMFILES(X86)')].filter(Boolean);
    const local = envVar(env, 'LOCALAPPDATA'), scoop = home && p.join(home, 'scoop', 'apps');
    sublime = [
      ...programs.flatMap(r => ['Sublime Text', 'Sublime Text 4', 'Sublime Text 3'].map(d => p.join(r, d, 'subl.exe'))),
      ...(local ? [p.join(local, 'Programs', 'Sublime Text', 'subl.exe')] : []),
      ...(scoop ? [p.join(scoop, 'sublime-text', 'current', 'subl.exe')] : []),
      ...path.map(d => p.join(d, 'subl.exe')),
    ];
    vscode = [
      ...(local ? [p.join(local, 'Programs', 'Microsoft VS Code', 'Code.exe')] : []),
      ...programs.map(r => p.join(r, 'Microsoft VS Code', 'Code.exe')),
      ...(scoop ? [p.join(scoop, 'vscode', 'current', 'Code.exe')] : []),
      ...path.filter(d => isFile(p.join(d, 'code.cmd'))).map(d => p.join(p.dirname(d), 'Code.exe')),
    ];
  } else if (platform === 'darwin') {
    const apps = ['/Applications', ...(home ? [p.join(home, 'Applications')] : [])];
    sublime = [...apps.map(a => p.join(a, 'Sublime Text.app', 'Contents', 'SharedSupport', 'bin', 'subl')), ...path.map(d => p.join(d, 'subl'))];
    vscode = [...apps.map(a => p.join(a, 'Visual Studio Code.app', 'Contents', 'Resources', 'app', 'bin', 'code')), ...path.map(d => p.join(d, 'code'))];
  } else {
    sublime = [...path.map(d => p.join(d, 'subl')), '/opt/sublime_text/sublime_text', '/snap/bin/subl'];
    vscode = [...path.map(d => p.join(d, 'code')), '/usr/share/code/bin/code', '/snap/bin/code'];
  }
  const found: EditorInfo[] = [];
  for (const [name, candidates] of [['Sublime Text', sublime], ['Visual Studio Code', vscode]] as const) {
    const at = candidates.find(isFile);
    if (at) found.push({ name, path: at });
  }
  return found;
}

/**
 * What to start: the editor with the argument template filled in, each {dir} the folder and each {file} the file's
 * full path (`{dir} {file}`, the default, is what Sublime Text and VS Code take as "the folder, with this file open in
 * it"); a template with neither gets the folder and the file after it. A .cmd or .bat cannot be started without a
 * shell: VS Code's bin\code.cmd (what `where code` finds) starts the Code.exe above it, and any other is refused.
 * Electron's variables (this app's own) are left out of the environment, so VS Code, itself an Electron app, is
 * not started as plain Node.
 */
export function editorCommand(o: EditorLaunch): EditorCommand {
  const platform = o.platform ?? process.platform;
  const p = platform === 'win32' ? win32 : posix;
  let file = o.exe.trim();
  if (platform === 'win32' && /\.(cmd|bat)$/i.test(file)) {
    const exe = VSCODE_EXES.map(n => p.join(p.dirname(p.dirname(file)), n)).find(isFile);
    if (!exe) throw new Error(`${file} is a script, which Mimir does not start (it needs a shell): set the editor's program (.exe) in Settings → Toolchain`);
    file = exe;
  }
  const full = p.join(o.dir, o.file);
  const template = splitArgs(o.args?.trim() ? o.args : DEFAULT_SETTINGS.editorArgs);
  const args = template.map(a => a.split('{dir}').join(o.dir).split('{file}').join(full));
  if (!template.some(a => a.includes('{dir}') || a.includes('{file}'))) args.push(o.dir, full);
  const env = Object.fromEntries(Object.entries(o.env ?? process.env).filter(([k]) => !/^ELECTRON_/i.test(k)));
  return { file, args, cwd: o.dir, env };
}

/** Start the editor detached (it outlives the app). Resolves once it has started. */
export function launchEditor(o: EditorLaunch): Promise<number> {
  const c = editorCommand(o);
  return new Promise((ok, fail) => {
    // a GUI program: windowsHide would hide its first window too
    const child = spawn(c.file, c.args, { cwd: c.cwd, env: c.env, shell: false, detached: true, stdio: 'ignore', windowsHide: false });
    child.once('error', e => fail(new Error(`could not start ${editorName(c.file)} (${c.file}): ${e.message}`)));
    child.once('spawn', () => { child.unref(); ok(child.pid ?? -1); });
  });
}
