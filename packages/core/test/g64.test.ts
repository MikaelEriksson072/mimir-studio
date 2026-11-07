/* G64 disk images (13.5): their standard sectors read as the D64 they hold (c64/d64.ts through Sindri's decoder), the
 * Spindle, Bitfire and BoozeLoader readers on them, and a file written back into its own sectors of a D64 and a G64
 * (Build & Run's disk copy), the rest of the image, a copy protection's track too, as it was. */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { diskSectors, isDiskImage, makeD64, parseD64, readBitfireDisk, readBoozeDisk, readD64File, readSpindleDisk, writeDiskFile } from '../src';
import { parseG64 } from '@mimir/sindri';
import { keyTrack, toG64 } from './helpers/g64';

const bytes = (n: number, seed = 1) => Uint8Array.from({ length: n }, (_, i) => (i * 31 + seed * 7) & 0xff);
const fixture = (name: string) => new Uint8Array(readFileSync(join(__dirname, '../../../fixtures/d64', name)));

describe('G64 images', () => {
  const d64 = makeD64({ name: 'gcr disk', id: 'eb', files: [{ name: 'BOOT', data: bytes(300, 1) }, { name: 'GAME', data: bytes(4400, 2) }] });
  // (both on track 1: track 2 is the key, as on Pirate Slayer's disks)
  const g64 = toG64(d64, { 4: keyTrack(3) });

  it('list and open like the D64 their sectors hold', () => {
    expect(isDiskImage(g64)).toBe(true);
    expect(isDiskImage(d64)).toBe(true);
    expect(isDiskImage(bytes(1000))).toBe(false);
    const img = parseG64(g64) && parseD64(g64), plain = parseD64(d64);
    expect(img.format).toBe('G64');
    expect(plain.format).toBe('D64');
    expect(img.files).toEqual(plain.files);
    expect(img.name).toBe('GCR DISK');
    for (const f of img.files) expect(readD64File(g64, f)).toEqual(readD64File(d64, f));
    // track 2 has no sectors, only the key: its sectors read as errors (no SYNC)
    expect(img.errorInfo).toBe(true);
    expect(diskSectors(g64)[174848 + 21]).toBe(3);
  });

  it('are read by the Spindle, Bitfire and BoozeLoader readers as their D64s are', () => {
    for (const [name, read] of [['spindle-demo.d64', readSpindleDisk], ['bitfire-demo.d64', readBitfireDisk], ['booze-demo.d64', readBoozeDisk]] as const) {
      const d = fixture(name), r = (read as (b: Uint8Array) => unknown)(d);
      expect(r, name).not.toBeNull();
      expect((read as (b: Uint8Array) => unknown)(toG64(d)), name).toEqual(r);
    }
  });

  it('take a file back into its own sectors: a D64 and a G64, the rest as it was', () => {
    const img = parseD64(d64), game = img.files[1];
    const built = bytes(4400, 9);
    for (const disk of [d64, g64]) {
      const out = writeDiskFile(disk, game, built);
      expect(readD64File(out, game)).toEqual(built);
      expect(readD64File(out, img.files[0])).toEqual(readD64File(disk, img.files[0]));
      expect(parseD64(out).files).toEqual(img.files);
    }
    // the G64's key track is untouched, and it stays a G64 of the same size
    const out = writeDiskFile(g64, game, built);
    expect(out.length).toBe(g64.length);
    expect(parseG64(out).halves[4]).toEqual(parseG64(g64).halves[4]);
    // a shorter file in as many blocks: the last sector says where it ends now
    expect(readD64File(writeDiskFile(d64, game, built.subarray(0, 4350)), game)).toEqual(built.subarray(0, 4350));
    expect(() => writeDiskFile(g64, game, bytes(6000))).toThrow(/18 blocks on the disk, and 6000 bytes need 24/);
  });
});
