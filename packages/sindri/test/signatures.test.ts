/* The signature list: fingerprints of code as it ran, and the freezer cartridges' backups kept apart from the packers. */
import { describe, expect, it } from 'vitest';
import { identify, SIGNATURES } from '../src/analyze.ts';

const AR = 'Datel Action Replay backup', FM = 'Evesham Freeze Machine backup', SS = 'LMS Super Snapshot backup';
/** BRK and the JAMs: code that ran on has none of them, so a fingerprint with many was taken of code written over */
const STOPS = new Set([0x00, 0x02, 0x12, 0x22, 0x32, 0x42, 0x52, 0x62, 0x72, 0x92, 0xb2, 0xd2, 0xf2]);

/** layers of freezer backups as they ran (their opcodes in address order): like the list's entries, not the same */
const LAYERS = {
  // the Freeze Machine's first layer at $080d: moves the packed data up, puts the zero page, stack and colours back,
  // restores the SID, CIAs and VIC (NOPs where it would write the CIAs' interrupt masks) and jumps to $007e
  fm080d: '78a98da985a0b99998f0884cceceadc9d0e6a29aa2a0b999b94a4a4a4a9db9299de8e8d0eeeec8d0eeceeece10a2a99d9da99da99da99d8a38e9aa10a98da9f0a2a99d9da99d9dca10c0b0b999b999b999c8c0d0adeaeaeaadeaeaeaa2bd95ca10c6a04c',
  // the same layer of a Split Freeze run with its disk: the first file's loader ran at $080d before it loaded the
  // second file over itself, and where the second's instructions start elsewhere the first's opcodes stay
  fmSplit080d: '78a98da985a0b99998f0884ceeced0cea9ada9c9a2d0a0e620a29aa2a2a0a0b92099a9b9a94a4a4a4a9db9299de8e8d0eeeec8d0eeceeece10a2a99d9da99da99da99d8a38e9aa10a98da9eaeaa28e8e8da28ea28ea28ea2a99d9da99d9dca10c0b0b999b999b999c8c0d0adeaeaeaadeaeaeaa2bd95ca10c6a04c',
  // its second layer at $007e: the depacker in the zero page, then the code in the stack page that puts the zero page
  // back and returns into the program
  fm007e: 'ade6d0e66020aa2091c8f0cad0f0208520c9f091c8d0f0069026c646902091c8d0e6d01890e6a2b59db59dca10a98da985eaeaadc64ca4a2bd95a99de8e0d0a2bd95ca10eaeaa9a24c9dca10a985a9a240',
  // the Action Replay's two layers, at $080d and $008e
  ar080d: '78a98da985a2a0b99988c0d0ceceecd0e6a29ac8b999b9994a4a4a4a99c8d0eeeeeecece10a2a99d9da99da99da99d8a38e9aa10a0a90a90a28e8e8da28ea28ea08ca0a9999988d0c0b0b999b999b999c8c0d020ad85ad85a9a28d8d8ec6a04c2c10a2a0a58da58c8d8ea58da58c8d8ea58da58c8d8ea58da58c8d8eadada58da58d60',
  ar008e: 'a08686b1c685a5918810c6cacad04cade6d0e66020aa2091c8f0cad0f0208520c9f091c8d0f0069026c64690e6d0e6adc9d0adadadadeaeaeaeaeac6a98da98da24c',
  // the Super Snapshot's second layer at $008e, where the program it unpacks was frozen elsewhere (its first layer at
  // $080d ran the same in all 253 backups that were learned from)
  ss008e: 'ade6d0e66020aa2091c8f0cad0f0208520c9f091c8d0f0069026c646902091c8d0e6d0e6a985eaeaeaeaeaeaeaeaa98d6c',
  // the first layer of an Action Replay backup saved as two files, run with its disk: the loader at $080d loaded the
  // second file over itself, so the layer has the opcodes of both
  arSplit080d: '78a98da0a9b985a2a0c8b9ee99ee88c0cad0ce20cec8eca9d048e6a28a9ac8b9a599b9c699a94a4a4a4a99c8d0eeeeeecece10a2a99d9da99da99da99d8a38e9aa10a0a90a90a28e8e8da28ea28ea08ca0a9999988d0c0b0b999b999b999c8c0d020ad85ad85a9a28d8d8ec6a04c2c10a2a0a58da58c8d8ea58da58c8d8ea58da58c8d8ea58da58c8d8eadada58da58d60',
};
/** the Super Snapshot's first layer of a backup saved as two files, run with its disk: it ran the same in all 29 */
const SS_SPLIT_080D = '78a98da08db9a99985a2d0a0eeb9ee99ca88c0c6d020cec8cea9ec48a9d048e64ca29ac88c8cc68ca98c91b999b9994a4a4a4a99c8d0eeeeeecece10a0c0b0b999b9998810adada0b999b9998810adadadada2a0a98d8d8d8dbd9dbd9de8d08c8c8c8cadadc6a04c';

describe('the signature list', () => {
  it('holds fingerprints of code as it ran', () => {
    for (const s of SIGNATURES) {
      const ops = s.opcodes.match(/../g)!.map(h => parseInt(h, 16));
      expect(ops.filter(o => STOPS.has(o)).length / ops.length, `${s.name}: ${s.opcodes}`).toBeLessThan(0.05);
    }
  });

  it.each([AR, FM, SS])('names no other code a %s, and no such backup after other code', name => {
    const own = SIGNATURES.filter(s => s.name === name), rest = SIGNATURES.filter(s => s.name !== name);
    expect(own.length).toBeGreaterThanOrEqual(2);
    for (const s of own) expect(identify(s.opcodes, rest), s.opcodes).toBeNull();
    for (const s of rest) expect(identify(s.opcodes, own), s.name).toBeNull();
  });

  it("names both layers of a Freeze Machine backup, and the Action Replay's as its own", () => {
    for (const k of ['fm080d', 'fmSplit080d', 'fm007e'] as const) expect(identify(LAYERS[k])?.name, k).toBe(FM);
    for (const k of ['ar080d', 'ar008e', 'arSplit080d'] as const) expect(identify(LAYERS[k])?.name, k).toBe(AR);
    expect(SIGNATURES.some(s => Object.values(LAYERS).includes(s.opcodes))).toBe(false);
    // both begin with sei, lda #$7f, sta $dd0d, lda #$34, sta $01, but are far from 80% alike
    expect(identify(LAYERS.fm080d, SIGNATURES.filter(s => s.name === AR), 0.5)).toBeNull();
    expect(identify(LAYERS.ar080d, SIGNATURES.filter(s => s.name === FM), 0.5)).toBeNull();
  });

  it("names both layers of a Super Snapshot backup, also one saved as two files, and none of them the Action Replay's", () => {
    expect(identify(LAYERS.ss008e)?.name).toBe(SS);
    expect(identify(SS_SPLIT_080D)?.name).toBe(SS);
    // the same loader starts the Action Replay's split freezes, but the rest of the layer is its own
    expect(identify(SS_SPLIT_080D, SIGNATURES.filter(s => s.name === AR), 0.5)?.name ?? null).toBeNull();
    // its zero-page depacker is the Action Replay's with another end, but less than 80% alike
    expect(identify(LAYERS.ss008e, SIGNATURES.filter(s => s.name === AR))).toBeNull();
    expect(identify(LAYERS.ar008e, SIGNATURES.filter(s => s.name === SS))).toBeNull();
  });
});
