/* A user script run on files (spec 10.3): the file in the scratchpad that takes one, and what the run leaves as files. */
import { describe, expect, it } from 'vitest';
import { checkScript, filePad, fileResultText, fileRunPlan, fileRunResults, padWithFile, runScript, scriptNames, type FileRunPlan, type ScriptEnv, type ScriptFile, type ScriptPad, type UserScript } from '../src';
import { fromSource } from './helpers/programs';

const KEY = 0x5a;
/** a program with its own routine that decrypts what $fb/$fc points at, up to $fd/$fe, to $4000 on */
const program = fromSource('game.prg', [
  '.pc = $0810',
  'unpack: ldy #0',
  '        lda #$00', '        sta $f9', '        lda #$40', '        sta $fa',
  'loop:   lda ($fb),y',
  `        eor #$${KEY.toString(16)}`,
  '        sta ($f9),y',
  '        inc $f9', '        bne !+', '        inc $fa',
  '!:      inc $fb', '        bne !+', '        inc $fc',
  '!:      lda $fb', '        cmp $fd', '        bne loop',
  '        lda $fc', '        cmp $fe', '        bne loop',
  '        rts',
].join('\n'));
const env: ScriptEnv = { files: [program], names: new Map([['unpack', 0x0810]]) };

/** 600 bytes that end in the key, so that what they decrypt to ends in zeros */
const plain = Uint8Array.from({ length: 600 }, (_, i) => (i < 590 ? (i * 7 + 3) & 0xff : 0));
const file: ScriptFile = { name: 'LEVEL 1.prg', load: 0x6000, bytes: plain.map(b => b ^ KEY) };

const script = (source: string[], pads: ScriptPad[]): UserScript => ({ id: 's', name: 'decrypt', lang: 'kickass', source: source.join('\n'), pads });
/** the pointer $fb/$fc at the file and $fd/$fe after it */
const POINTERS = ['        lda #<inp', '        sta $fb', '        lda #>inp', '        sta $fc', '        lda #<inp_end', '        sta $fd', '        lda #>inp_end', '        sta $fe'];
/** decrypts the file where it is, a byte at a time through $fb/$fc */
const IN_PLACE = [...POINTERS, '        ldy #0',
  'loop:   lda ($fb),y', `        eor #$${KEY.toString(16)}`, '        sta ($fb),y',
  '        inc $fb', '        bne !+', '        inc $fc',
  '!:      lda $fb', '        cmp $fd', '        bne loop', '        lda $fc', '        cmp $fe', '        bne loop', '        rts'];

const ran = (s: UserScript, f: ScriptFile = file) => {
  const plan = fileRunPlan(env, s, f);
  if ('error' in plan) throw new Error(plan.error);
  const run = runScript(env, plan.script, plan.check);
  return { plan, run, results: fileRunResults(plan, f, run, s.name) };
};

describe('a script run on a file', () => {
  it('takes the file in its scratchpad, as big as the file, and work done in place is the result at the file\'s load address', () => {
    const s = script(IN_PLACE, [{ name: 'inp', start: 0xc800, size: 16, role: 'file' }]);
    const { plan, run, results } = ran(s);
    expect(run.end).toBe('rts');
    expect(plan.script.pads[0]).toMatchObject({ name: 'inp', start: 0xc800, size: 600, load: 0x6000, role: 'file' });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ name: 'LEVEL_1_decrypt.prg', load: 0x6000, from: 'file', pad: 'inp' });
    expect([...results[0].bytes]).toEqual([...plain]);
    expect(fileResultText(results[0])).toBe('the file\'s scratchpad inp as the run left it, 600 bytes at $6000');
    // the script itself is as it was: the file was only in the run's copy
    expect(s.pads[0].size).toBe(16);
  });

  it('gives a scratchpad marked as a result from its start to the last byte written, zeros at its end too', () => {
    const copy = [...POINTERS, '        lda #<out', '        sta $f9', '        lda #>out', '        sta $fa', '        ldy #0',
      'loop:   lda ($fb),y', `        eor #$${KEY.toString(16)}`, '        sta ($f9),y',
      '        inc $f9', '        bne !+', '        inc $fa',
      '!:      inc $fb', '        bne !+', '        inc $fc',
      '!:      lda $fb', '        cmp $fd', '        bne loop', '        lda $fc', '        cmp $fe', '        bne loop', '        rts'];
    const s = script(copy, [{ name: 'inp', start: 0xc800, size: 16, role: 'file' }, { name: 'out', start: 0x4000, size: 0x1000, role: 'result' }, { name: 'log', start: 0x5000, size: 16 }]);
    const { run, results } = ran(s);
    expect(run.pads[1].wrote).toEqual([0, 600]);
    expect(run.pads[2].wrote).toBeUndefined();
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ name: 'LEVEL_1_decrypt.prg', load: 0x4000, from: 'result', pad: 'out' });
    expect(results[0].bytes).toHaveLength(600);
    expect([...results[0].bytes]).toEqual([...plain]);
  });

  it('gives the memory the program\'s own routine wrote, also where no file has bytes and where zeros went over zeros', () => {
    const s = script([...POINTERS, '        jsr unpack', '        rts'], [{ name: 'inp', start: 0xc800, size: 16, role: 'file' }]);
    const { run, results } = ran(s);
    expect(run.end).toBe('rts');
    expect(run.changes).toEqual([]);
    expect(run.wrote).toEqual([{ start: 0x4000, end: 0x4000 + 600 }]);
    expect(results).toEqual([{ name: 'LEVEL_1_decrypt.prg', load: 0x4000, bytes: plain, from: 'memory' }]);
  });

  it('lets the program\'s routine write into a scratchpad marked as a result where it writes: the result is cut to what it wrote', () => {
    const s = script([...POINTERS, '        jsr unpack', '        rts'], [{ name: 'inp', start: 0xc800, size: 16, role: 'file' }, { name: 'out', start: 0x4000, size: 0x1000, role: 'result' }]);
    const { run, results } = ran(s);
    expect(run.wrote).toEqual([]);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ load: 0x4000, from: 'result', pad: 'out' });
    expect([...results[0].bytes]).toEqual([...plain]);
    // a scratchpad without a role stays the script's alone: the program's routine writes the program's memory there
    const plainPad = script([...POINTERS, '        jsr unpack', '        rts'], [{ name: 'inp', start: 0xc800, size: 16, role: 'file' }, { name: 'out', start: 0x4000, size: 0x1000 }]);
    expect(ran(plainPad).results[0]).toMatchObject({ load: 0x4000, from: 'memory' });
  });

  it('moves the scratchpad when the file does not fit where it is, and the code finds it by its name', () => {
    const s = script(IN_PLACE, [{ name: 'inp', start: 0xc800, size: 16, role: 'file' }, { name: 'log', start: 0xc900, size: 0x100 }]);
    const { plan, results } = ran(s);
    const p = plan.script.pads[0];
    expect(p.size).toBe(600);
    expect(p.start).not.toBe(0xc800);
    expect(p.start + p.size <= 0xc900 || p.start >= 0xca00).toBe(true);
    expect([...results[0].bytes]).toEqual([...plain]);
  });

  it('knows the file\'s load address as name_load, 0 for a file without one, and outside a run on files too', () => {
    const s = script(['        lda #<inp_load', '        sta out', '        lda #>inp_load', '        sta out+1', '        rts'],
      [{ name: 'inp', start: 0xc800, size: 16, role: 'file' }, { name: 'out', start: 0xc900, size: 2, role: 'result' }]);
    expect([...ran(s).results[0].bytes]).toEqual([0x00, 0x60]);
    expect([...ran(s, { name: 'raw', load: null, bytes: file.bytes }).results[0].bytes]).toEqual([0x00, 0x00]);
    expect(checkScript(env, s).problems).toEqual([]);
    expect(scriptNames(env, [{ name: 'inp', start: 0xc800, size: 16, role: 'file', load: 0x1234 }]).get('inp_load')).toBe(0x1234);
    expect(scriptNames(env, [{ name: 'pad1', start: 0xc800, size: 16 }]).has('pad1_load')).toBe(false);
  });

  it('says why a script cannot run on a file', () => {
    const none = script(IN_PLACE, [{ name: 'inp', start: 0xc800, size: 16 }]);
    expect(filePad(none.pads)).toBe(-1);
    expect(fileRunPlan(env, none, file)).toEqual({ error: expect.stringContaining('no scratchpad that takes a file') });
    const s = script(IN_PLACE, [{ name: 'inp', start: 0xc800, size: 16, role: 'file' }]);
    expect(fileRunPlan(env, s, { name: 'e', load: null, bytes: new Uint8Array(0) })).toEqual({ error: 'the file is empty' });
    expect(fileRunPlan(env, s, { name: 'big', load: null, bytes: new Uint8Array(0x10000) })).toEqual({ error: expect.stringContaining('more than memory holds') });
    const broken = script(['        lda nowhere', '        rts'], [{ name: 'inp', start: 0xc800, size: 16, role: 'file' }]);
    expect((fileRunPlan(env, broken, file) as { error: string }).error).toMatch(/^line 1: /);
  });

  it('gives nothing when the run wrote nothing', () => {
    const s = script(['        lda inp', '        rts'], [{ name: 'inp', start: 0xc800, size: 16, role: 'file' }]);
    expect(ran(s).results).toEqual([]);
  });

  it('puts a file into a scratchpad as its start: its size, its bytes, its load address', () => {
    const p = padWithFile({ name: 'inp', start: 0xc800, size: 16, fill: 0xff, bytes: new Uint8Array(16), src: { form: 'hex', text: '00' }, role: 'file' }, file);
    expect(p).toEqual({ name: 'inp', start: 0xc800, size: 600, fill: 0xff, role: 'file', data: file.bytes, load: 0x6000 });
    // no more than memory holds from where it is
    expect(padWithFile({ name: 'inp', start: 0xff00, size: 16 }, file).size).toBe(0x100);
    const plan = fileRunPlan(env, script(IN_PLACE, [{ name: 'inp', start: 0xc800, size: 16, role: 'file' }]), file) as FileRunPlan;
    expect(plan.check.ok).toBe(true);
  });
});
