/* =====================================================================
 * The Assembler's Release (spec 10.7): the built program (or the packed one) as a disk image, a tape image, a
 * cartridge or the PRG itself, made so that the C64 starts it. Measured in the real VICE, each kind started as Release
 * starts it (asm-release.integration.test.ts): a disk and a tape autostarted (LOAD and RUN, so a program that starts
 * with a BASIC line), a cartridge attached (its boot copies the program into place and starts it, with RUN for a BASIC
 * one), a PRG autostarted.
 * ===================================================================== */
import { makeD64 } from './c64/d64';
import { makeTap } from './c64/tap';
import { programCartridge } from './c64/crtedit';

export type ReleaseKind = 'd64' | 'tap' | 'crt' | 'prg';

/** The image of `prg` (a load address and its bytes) as a release of kind `kind`: `name` is the file's name on the disk
 *  or tape and the cartridge's, `disk` and `id` the disk's. */
export function releaseImage(kind: ReleaseKind, prg: Uint8Array, o: { name: string; disk?: string; id?: string }): Uint8Array {
  if (prg.length < 3) throw new RangeError('the program has no bytes');
  const load = prg[0] | (prg[1] << 8), data = prg.subarray(2);
  switch (kind) {
    case 'd64': return makeD64({ name: o.disk ?? o.name, ...(o.id ? { id: o.id } : {}), files: [{ name: o.name, data: prg }] });
    // (a program at $0801 is saved as BASIC, which LOAD puts where BASIC is; any other as a machine-language one)
    case 'tap': return makeTap({ files: [{ name: o.name, data, load, basic: load === 0x0801 }], endOfTape: true });
    case 'crt': return programCartridge(load, data, { name: o.name }).crt.image();
    default: return prg;
  }
}

/** whether the C64 starts a release of `prg` by itself: a disk, a tape and a PRG are LOADed and RUN, so their program
 *  must start with a BASIC line (a SYS); a cartridge starts any program (null: it does; else what to say) */
export function releaseStarts(kind: ReleaseKind, prg: Uint8Array): string | null {
  if (kind === 'crt' || prg.length < 3) return null;
  const load = prg[0] | (prg[1] << 8);
  return load === 0x0801 ? null : `The program loads at $${load.toString(16).padStart(4, '0')}, not with a BASIC line at $0801: LOAD and RUN do not start it (SYS ${load} does, or a cartridge, or Pack with its start)`;
}
