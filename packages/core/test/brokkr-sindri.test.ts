/* Brokkr and Sindri together: what Brokkr packs, Sindri unpacks to the program it was made from and names by its
 * format, in a C64 with its ROMs, its interrupts and its power-on RAM (Brokkr's own check runs the decruncher in a
 * machine with neither); and the two run the same 6510, file for file. */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_PACK, makeDemo, packerNames, packWithBrokkr, parsePrg, unpackPrg, type PackPrefs, type Roms } from '../src';
import { findC64Roms } from '../src/node';

const P = (o: Partial<PackPrefs> = {}): PackPrefs => ({ ...DEFAULT_PACK, ...o });
const demo = makeDemo();
const f = parsePrg(demo.name, demo.prg);
const roms = findC64Roms();
const modes: [string, Roms | null][] = roms ? [['stand-ins', null], ['ROMs', roms]] : [['stand-ins', null]];
const NAMES = { exomizer: 'Brokkr / Exomizer format', brokkr: 'Brokkr / own format', fast: 'Brokkr / fast format' } as const;

describe('a file packed with Brokkr, unpacked with Sindri', () => {
  for (const [mode, r] of modes) {
    for (const format of ['exomizer', 'brokkr', 'fast'] as const) {
      for (const effect of format === 'fast' ? [true] : [true, false]) {
        it(`is the demo again, and named ${NAMES[format]} (${effect ? 'the border flashing' : 'no effect'}, the ${mode})`, async () => {
          const packed = await packWithBrokkr([{ name: demo.name, prg: demo.prg }], P({ format, effect: effect ? 'default' : 'none' }));
          expect(packed.error).toBeUndefined();
          const run = unpackPrg(packed.prg!, r);
          // both of its layers by the format's name, and no other
          expect(packerNames(run)).toBe(`${NAMES[format]} (stage 1) → ${NAMES[format]} (depacker)`);
          const program = run.layers[run.layers.length - 1];
          expect(program).toMatchObject({ kind: 'program', entry: 0x0810 });
          expect(run.saved).toMatchObject({ entry: 0x0810, port: 0x37, interrupts: true });
          // the demo's bytes are all there, in place
          const out = parsePrg('out', run.saved!.prg);
          expect(out.load).toBeLessThanOrEqual(f.load);
          expect(out.bytes.subarray(f.load - out.load, f.load - out.load + f.bytes.length)).toEqual(f.bytes);
        });
      }
    }
  }
});

describe("Brokkr's and Sindri's 6510", () => {
  // Brokkr checks its decrunchers on the CPU Sindri unpacks with: one file, copied, so a fix in one reaches the other
  it.each(['cpu.ts', 'opcodes.ts'])('is the same file: %s', name => {
    const read = (pkg: string) => readFileSync(join(__dirname, '..', '..', pkg, 'src', name), 'utf8').replace(/\r\n/g, '\n');
    expect(read('brokkr')).toBe(read('sindri'));
  });
});
