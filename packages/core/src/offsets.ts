/* Where each loaded byte is in the file it was opened from: the listing's offset column, as SourceGen shows it
 * (spec 14.1). A PRG's bytes follow its 2-byte load address, a cartridge chip's are in its CHIP packet of the .crt,
 * and a VICE snapshot's RAM is in its C64MEM module. */
import type { Cartridge, FileInput } from './types';
import { parseCrt } from './c64/crt';
import { parseVsf } from './c64/vsf';

/** For each file, the offset in the file it was opened from of its first loaded byte (the one at `load`); null where
 *  that file cannot be read. */
export function fileOffsetBases(project: { files: readonly FileInput[]; cart?: Cartridge | null }): (number | null)[] {
  let crt: ReturnType<typeof parseCrt> | null = null;
  try { crt = project.cart ? parseCrt(project.cart.crt, project.cart.name) : null; } catch { /* no offsets for its chips */ }
  return project.files.map(f => {
    if (f.chip != null) return crt?.chips[f.chip]?.dataOffset ?? null;
    if (f.vsf) {
      try { const m = parseVsf(f.vsf).modules.find(x => x.name === 'C64MEM'); return m ? m.offset + 4 + f.load : null; } catch { return null; }
    }
    return 2;
  });
}

/** "+000050", as SourceGen writes an offset */
export const offsetText = (n: number): string => `+${n.toString(16).padStart(6, '0')}`;
