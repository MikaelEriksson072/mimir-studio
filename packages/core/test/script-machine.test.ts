/* A user script run in the whole C64 (spec 10.3): the ROMs, the I/O and a 1541 with a disk, and the address a run
 * stops at. The whole machine needs VICE's ROM files: those tests are skipped on a machine without them. */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkScript, endedWell, parseD64, readD64File, runScript, runScriptInC64, scriptEndText, scriptStopAt, type ScriptEnv, type UserScript } from '../src';
import { findC64Roms } from '../src/node';

const roms = findC64Roms();
const env: ScriptEnv = { files: [], names: new Map([['SETNAM', 0xffbd], ['SETLFS', 0xffba], ['LOAD', 0xffd5], ['CHROUT', 0xffd2]]) };
const script = (source: string[], pads: UserScript['pads'] = []): UserScript => ({ id: 's', name: 's', lang: 'kickass', source: source.join('\n'), pads });
// fixtures/d64/kernal-load.d64: BOOT loads PART2 ($c000) with LOAD "PART2",8,1
const disk = new Uint8Array(readFileSync(join(__dirname, '../../../fixtures/d64/kernal-load.d64')));
const part2 = (() => { const f = parseD64(disk).files.find(x => x.name === 'PART2')!; return readD64File(disk, f); })();
/** LOAD "PART2",8,1 through the KERNAL, from $0900 (what it loads goes to $c000) */
const LOAD_PART2 = ['* = $0900', 'start:  lda #5', '        ldx #<name', '        ldy #>name', '        jsr SETNAM', '        lda #1', '        ldx #8', '        ldy #1', '        jsr SETLFS',
  '        lda #0', '        jsr LOAD', 'after:  rts', 'name:   .byte $50, $41, $52, $54, $32'];

describe('the address a run stops at', () => {
  it('is a number, a name of the program or the script, or one with an offset', () => {
    const names = new Map([['loader', 0x0810]]);
    expect(scriptStopAt(undefined, names)).toBeNull();
    expect(scriptStopAt('  ', names)).toBeNull();
    expect(scriptStopAt('$c000', names)).toBe(0xc000);
    expect(scriptStopAt('49152', names)).toBe(0xc000);
    expect(scriptStopAt('loader+3', names)).toBe(0x0813);
    expect(scriptStopAt('loader - $10', names)).toBe(0x0800);
    expect(scriptStopAt('mine', names, { labels: new Map([[0xc123, 'mine']]) })).toBe(0xc123);
    expect(scriptStopAt('nowhere', names)).toEqual({ error: '"nowhere" is not a name of the program or the script' });
    expect(scriptStopAt('lda #1', names)).toEqual({ error: expect.stringContaining('is not an address') });
    expect(scriptStopAt('$ffff+1', names)).toEqual({ error: expect.stringContaining('outside') });
  });

  it('ends a run in the plain machine before the instruction there, as a run that ended well', () => {
    const s = script(['* = $c000', '        lda #1', '        sta $2000', 'here:   lda #2', '        sta $2001', 'loop:   jmp loop']);
    const c = checkScript(env, s);
    const run = runScript(env, s, c, undefined, 0xc005);
    expect(run.end).toBe('stop');
    expect(run.at).toBe(0xc005);
    expect(endedWell(run.end)).toBe(true);
    expect(scriptEndText(run)).toMatch(/^Stopped at \$c005, the address it stops at, after 2 instructions/);
    expect([run.mem[0x2000], run.mem[0x2001]]).toEqual([1, 0]);
    // without it the loop runs to the limit
    expect(runScript(env, s, c, 1000).end).toBe('limit');
  });
});

describe.skipIf(!roms)('a script in the whole C64', () => {
  it('calls the KERNAL: CHROUT puts a character on the screen', () => {
    const s = script(['* = $0900', '        lda #$41', '        jsr CHROUT', '        rts']);
    const run = runScriptInC64(env, s, { roms: roms! });
    expect(run.end).toBe('rts');
    // somewhere on the screen an A (screen code 1) that was not there
    expect(run.wrote!.some(r => r.start >= 0x0400 && r.start < 0x07e8)).toBe(true);
    expect(run.changes).toEqual([]);
  });

  it.skipIf(!roms?.drive)('loads a file from the disk in the 1541 with the KERNAL\'s LOAD: what it loaded is the memory the run wrote', () => {
    const s = script(LOAD_PART2);
    const run = runScriptInC64(env, s, { roms: roms!, disk });
    expect(run.end).toBe('rts');
    expect(part2[0] | part2[1] << 8).toBe(0xc000);
    const body = part2.subarray(2);
    expect([...run.mem.subarray(0xc000, 0xc000 + body.length)]).toEqual([...body]);
    const loaded = run.wrote!.find(r => r.start === 0xc000);
    expect(loaded).toEqual({ start: 0xc000, end: 0xc000 + body.length });
    // the script's own bytes are not among what it wrote or changed
    expect(run.wrote!.some(r => r.start < 0x0920 && r.end > 0x0900)).toBe(false);
  }, 120_000);

  it.skipIf(!roms?.drive)('stops at an address, and keeps a scratchpad in the C64\'s memory', () => {
    const s = script([...LOAD_PART2.slice(0, 11), 'after:  lda $c000', '        sta pad1', 'never:  jmp never', 'name:   .byte $50, $41, $52, $54, $32'], [{ name: 'pad1', start: 0x0a00, size: 4 }]);
    const c = checkScript(env, s);
    const never = [...c.labels].find(([, n]) => n === 'never')![0];
    const run = runScriptInC64(env, s, { roms: roms!, disk }, c, never);
    expect(run.end).toBe('stop');
    expect(run.at).toBe(never);
    expect(run.pads[0].bytes[0]).toBe(part2[2]);
    expect(run.pads[0].wrote).toEqual([0, 1]);
  }, 120_000);

  it('says what is missing: no drive ROM for a disk, a script that does not check out', () => {
    const s = script(['* = $0900', '        rts']);
    expect(() => runScriptInC64(env, s, { roms: { ...roms!, drive: undefined }, disk })).toThrow(/no 1541 DOS ROM/);
    expect(() => runScriptInC64(env, script(['        lda nowhere', '        rts']), { roms: roms! })).toThrow(/nowhere/);
  });

  it('ends at the cycle limit when the code never returns', () => {
    const run = runScriptInC64(env, script(['* = $0900', 'loop:   jmp loop']), { roms: roms! }, undefined, null, 5000);
    expect(run.end).toBe('limit');
    expect(run.cycles).toBeGreaterThanOrEqual(5000);
  });
});
