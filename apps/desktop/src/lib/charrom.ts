/* VICE's character ROM (4 KB: the upper case/graphics set, then the lower case one), read by the main process from the
 * VICE in Settings → Toolchain. Asked for once; a ROM that was not found is asked for again the next time. */
import type { CharRomResult } from '../../shared/ipc';

let asked: Promise<CharRomResult | null> | null = null;
export const charRom = (): Promise<CharRomResult | null> => {
  asked ??= (window.kr ? window.kr.charRom().catch(() => null) : Promise.resolve(null)).then(r => { if (!r?.found) asked = null; return r; });
  return asked;
};
