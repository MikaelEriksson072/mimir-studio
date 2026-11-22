/* A script run before Build & Run (spec 10.3): what its run changed goes into the built files, and nowhere else. */
import { describe, expect, it } from 'vitest';
import { runChangeText, runScript, SCRIPT_KEYS, withRunChanges, type ScriptEnv } from '../src';

const KEY = 0x5a, TEXT = [...'HELLO'].map(c => c.charCodeAt(0));
/** the program as built: its text decrypted at $2000, and a second file over part of it */
const built = [{ load: 0x2000, bytes: Uint8Array.from([...TEXT, 1, 2, 3]) }, { load: 0x2006, bytes: Uint8Array.from([9, 9]) }];
const env: ScriptEnv = { files: built, names: new Map([['text', 0x2000]]) };
const encrypt = { source: ['* = $c000', '        ldx #4', 'loop:   lda text,x', `        eor #$${KEY.toString(16)}`, '        sta text,x', '        dex', '        bpl loop', '        inc $2006', '        rts'].join('\n'), lang: 'kickass' as const, pads: [] };

describe('a script before Build & Run', () => {
  it('leaves what it changed in the built files: each byte in the last file that has its address', () => {
    const run = runScript(env, encrypt);
    expect(run.end).toBe('rts');
    const out = withRunChanges(built, run);
    expect([...out[0].bytes]).toEqual([...TEXT.map(b => b ^ KEY), 1, 2, 3]);
    // $2006 is the second file's (it loads over the first): the change is there
    expect([...out[1].bytes]).toEqual([10, 9]);
    // the files given are as they were
    expect([...built[0].bytes.subarray(0, 5)]).toEqual(TEXT);
    expect(runChangeText(run)).toBe('6 bytes changed in 2 places');
  });

  it('gives back the files a run did not touch as they are', () => {
    const run = runScript(env, { ...encrypt, source: '* = $c000\n        rts' });
    const out = withRunChanges(built, run);
    expect(out[0]).toBe(built[0]);
    expect(out[1]).toBe(built[1]);
    expect(runChangeText(run)).toBe('nothing changed');
  });

  it('has Alt and a digit as a script\'s key', () => {
    expect(SCRIPT_KEYS).toHaveLength(9);
    expect(SCRIPT_KEYS[0]).toBe('Alt+1');
    expect(SCRIPT_KEYS.every(k => /^Alt\+[1-9]$/.test(k))).toBe(true);
  });
});
