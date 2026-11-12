/* Settings → Toolchain, Choose folder…: the user picks a tool's folder (VICE's, Kick Assembler's, Exomizer's…) and the
 * program is found in it, in the subfolder a release keeps it in (bin, win32), or one folder further down (the folder a
 * VICE or JDK zip unpacks to). Only the settings store decides what runs: the path found goes into the Settings form,
 * and settings:set validates it like any other. */
import { readdirSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join } from 'node:path';
import type { LocateKey } from '../../shared/ipc';

export interface ToolLook {
  /** what the dialogs call it */
  what: string;
  /** the file names it can have, the one wanted first */
  names: string[];
  /** subfolders a release keeps it in */
  under: string[];
  /** the file dialog's filter when it is not in the folder */
  filter: { name: string; extensions: string[] };
}

const isWin = process.platform === 'win32';
const exe = (n: string, win = isWin) => (win ? `${n}.exe` : n);
const programs = (win = isWin) => ({ name: 'Programs', extensions: win ? ['exe'] : ['*'] });

export function toolLook(key: LocateKey, win = isWin): ToolLook {
  switch (key) {
    case 'javaPath': return { what: 'Java', names: [exe('java', win)], under: ['bin'], filter: programs(win) };
    case 'kickJar': return { what: 'Kick Assembler', names: ['KickAss.jar'], under: [], filter: { name: 'Kick Assembler', extensions: ['jar'] } };
    case 'vicePath': return { what: 'VICE', names: [exe('x64sc', win)], under: ['bin'], filter: programs(win) };
    case 'viceQuicksave': return { what: "VICE's quicksave snapshot", names: ['C64SC.vsf', 'C64.vsf'], under: [], filter: { name: 'VICE snapshots', extensions: ['vsf'] } };
    case 'unpackerPath': return { what: 'the external unpacker', names: [exe('unp64', win)], under: [], filter: programs(win) };
    case 'editorPath': return { what: 'the external editor', names: win ? ['subl.exe', 'Code.exe', 'notepad++.exe'] : ['subl', 'code'], under: ['bin'], filter: programs(win) };
    case 'exomizerPath': return { what: 'Exomizer', names: [exe('exomizer', win)], under: ['win32', 'bin'], filter: programs(win) };
    // (a Retro Debugger release names its program C64Debugger, as C64 Debugger does)
    case 'retroDebuggerPath': return { what: 'Retro Debugger', names: [exe('RetroDebugger', win), exe('C64Debugger', win)], under: [], filter: programs(win) };
    case 'c64DebuggerPath': return { what: 'C64 Debugger', names: [exe('C64Debugger', win)], under: [], filter: programs(win) };
  }
}

const isFile = (p: string) => { try { return statSync(p).isFile(); } catch { return false; } };
export const isDir = (p: string) => { try { return statSync(p).isDirectory(); } catch { return false; } };
/** the folders in `dir`, the highest version first (jdk-21 before jdk-17, GTK3VICE-3.10 before GTK3VICE-3.9) */
const subdirs = (dir: string): string[] => {
  try {
    return readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name)
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true, sensitivity: 'base' })).map(n => join(dir, n));
  } catch { return []; }
};

/** The tool in the folder `dir`: in it, in its bin/win32, or in a folder in it (and that one's bin/win32). Null: not there. */
export function findInFolder(look: ToolLook, dir: string): string | null {
  const places = (d: string) => [d, ...look.under.map(u => join(d, u))];
  for (const d of [...places(dir), ...subdirs(dir).flatMap(places)])
    for (const n of look.names) if (isFile(join(d, n))) return join(d, n);
  return null;
}

/** Where the folder dialog opens: the folder of the path set (above its bin or win32), when it is there. */
export function startFolder(current: string | undefined): string | undefined {
  const p = current?.trim();
  // a bare name (java, found on PATH) has no folder of its own
  if (!p || !isAbsolute(p)) return undefined;
  const dir = isDir(p) ? p : dirname(p);
  if (!isDir(dir)) return undefined;
  return /^(bin|win32)$/i.test(basename(dir)) ? dirname(dir) : dir;
}
