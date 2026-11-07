/* The Pack view's command and warnings with Pack from: the whole build but for the bytes before an address. */
import { describe, expect, it } from 'vitest';
import { DEFAULT_PACK, type PackPrefs } from '@mimir/core';
import { packCommand, packWarning } from '../src/lib/pack';

const P = (o: Partial<PackPrefs> = {}): PackPrefs => ({ ...DEFAULT_PACK, ...o });
// a snapshot's RAM from $0200, its BASIC line at $0801 with SYS 2064
const snap = [{ load: 0x0200, bytes: new Uint8Array(0xfe00) }];
const basics = [{ start: 0x0801, end: 0x080d, sys: 2064, file: 0 }];

describe('Pack from', () => {
  it('packs the build from the address on, in the command Brokkr and Exomizer run', () => {
    expect(packCommand(P(), snap, ['snap']).args.at(-1)).toBe('snap.prg');
    const from = packCommand(P({ from: 0x0800 }), snap, ['snap']);
    expect(from.args.at(-1)).toBe('snap.prg,$0800,1536,63488');
    expect(from.size).toBe(0xf800);
    expect(packCommand(P({ packer: 'exomizer', from: 0x0800 }), snap, ['snap']).args.at(-1)).toBe('snap.prg,$0800,1536,63488');
    // the chosen blocks are packed as they are
    expect(packCommand(P({ from: 0x0800, ranges: [{ start: 0x0300, end: 0x0400 }] }), snap, ['snap']).args.at(-1)).toBe('snap.prg,$0300,256,256');
    expect(packCommand(P({ from: 0xc000 }), [{ load: 0x0801, bytes: new Uint8Array(16) }], ['game']).parts).toEqual([]);
  });

  it('warns when it leaves out where the program starts', () => {
    expect(packWarning(P({ from: 0x0800 }), { basics })).toBeNull();
    expect(packWarning(P({ from: 0x0900 }), { basics })).toBe('Pack from $0900 leaves out the BASIC line, so there is no SYS to start from: pack from $0801 or lower, or choose “Jump to address”.');
    expect(packWarning(P({ from: 0x0900, start: 'jmp', jmp: 0x0810 }), { basics })).toBe('The program starts at $0810, which Pack from $0900 leaves out: pack from $0810 or lower, or start it elsewhere.');
    expect(packWarning(P({ from: 0x0900, start: 'basic' }), { basics })).toBe('Pack from $0900 leaves out the start of the BASIC program that RUN starts: pack from $0801 or lower.');
    // crunched data starts nothing
    expect(packWarning(P({ from: 0x0900, mode: 'mem' }), { basics })).toBeNull();
  });
});
