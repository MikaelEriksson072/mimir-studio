/* =====================================================================
 * More ways to start a script (spec 10.3): a key of its own, and a run by itself before Build & Run.
 *
 * A script that runs before Build & Run (UserScript.when 'build') works on the program as it was just built, not on
 * the project: what it changes is in the program the emulator gets, and nowhere else. It is how a program whose data
 * or code the project keeps decrypted (a script decrypted it into the program, and it was changed there: a text
 * translated, a routine patched) runs again: the script encrypts the bytes as the program's own decryption expects
 * them. Several run in the order the project has them, each on what the one before left.
 * ===================================================================== */
import type { ScriptRun } from './script';

/**
 * The scripts of the library that run after a load in a program (UserScript.when 'load'): those that need no name of
 * the program, or whose every needed name the program has (`has`), and that the project does not have already (by
 * name). The others are left for the user to add.
 */
export function loadScripts<S extends { name: string; when?: string; needs?: string[] }>(library: readonly S[], has: (name: string) => boolean, inProject: readonly { name: string }[]): S[] {
  return library.filter(l => l.when === 'load' && (l.needs ?? []).every(has) && !inProject.some(s => s.name === l.name));
}

/** the keys a script can have for running it: Alt and a digit (not Ctrl+Alt: that is AltGr on many keyboards) */
export const SCRIPT_KEYS: readonly string[] = ['Alt+1', 'Alt+2', 'Alt+3', 'Alt+4', 'Alt+5', 'Alt+6', 'Alt+7', 'Alt+8', 'Alt+9'];

/**
 * The files with what a run changed in the program's bytes written into them (ScriptRun.changes: not the script's own
 * memory, not the zero page and the stack): each changed byte goes into the last file that has its address, as LOAD
 * leaves memory. The files given are not changed; those the run did not touch are given back as they are.
 */
export function withRunChanges<F extends { load: number; bytes: Uint8Array }>(files: readonly F[], run: Pick<ScriptRun, 'changes'>): F[] {
  const out = files.map(f => f);
  const copied = new Set<number>();
  for (const c of run.changes) for (let a = c.start; a < c.end; a++) {
    let i = -1;
    for (let k = files.length - 1; k >= 0; k--) if (a >= files[k].load && a < files[k].load + files[k].bytes.length) { i = k; break; }
    if (i < 0) continue;
    if (!copied.has(i)) { copied.add(i); out[i] = { ...files[i], bytes: files[i].bytes.slice() }; }
    out[i].bytes[a - files[i].load] = c.bytes[a - c.start];
  }
  return out;
}

/** how many bytes a run changed in the program, and in how many places */
export const runChangeText = (run: Pick<ScriptRun, 'changes'>): string => {
  const n = run.changes.reduce((s, c) => s + c.bytes.reduce((k, b, i) => k + (b !== c.old[i] ? 1 : 0), 0), 0), p = run.changes.length;
  return n ? `${n} byte${n === 1 ? '' : 's'} changed in ${p} place${p === 1 ? '' : 's'}` : 'nothing changed';
};
