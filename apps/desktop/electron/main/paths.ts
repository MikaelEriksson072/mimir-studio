/* Path policy (spec 4.2): file access is limited to folders the user picked in a dialog during
 * this session and to build folders the main process created itself. */
import { isAbsolute, normalize, relative, resolve } from 'node:path';

export class PathPolicy {
  private roots = new Set<string>();

  allow(dir: string): string {
    const d = resolve(normalize(dir));
    this.roots.add(d);
    return d;
  }

  isAllowed(p: string): boolean {
    if (!p || typeof p !== 'string') return false;
    const full = resolve(normalize(p));
    for (const root of this.roots) {
      const rel = relative(root, full);
      if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) return true;
    }
    return false;
  }

  assert(p: string, what: string): string {
    if (!this.isAllowed(p)) throw new Error(`${what} is outside the folders opened in this session: ${p}`);
    return resolve(normalize(p));
  }
}

/** A plain file name inside the build folder (no folders, no traversal), not taken for an option (no leading -). Spaces
 *  and letters of any language are fine: Kick Assembler gets it as one argument. */
export function assertEntryName(entry: string): string {
  // eslint-disable-next-line no-control-regex
  if (typeof entry !== 'string' || !/^[^\\/:*?"<>|\u0000-\u001f.-][^\\/:*?"<>|\u0000-\u001f]*\.asm$/i.test(entry)) throw new Error(`invalid source file name "${entry}"`);
  return entry;
}
