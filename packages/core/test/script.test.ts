/* User scripts (spec 10.3): checked with the program's names, run on a copy of its memory, scratchpads kept. */
import { describe, expect, it } from 'vitest';
import { analyze, checkScript, createProject, deserializeProject, disassembleBytes, freePlace, newScript, render, runScript, scriptEnv, serializeProject, type ScriptEnv, type UserScript } from '../src';
import { fromSource } from './helpers/programs';

const KEY = 0x5a;
const PLAIN = [...'HELLO, SCRIPTS!!'].map(c => c.charCodeAt(0));
/** a program with a block encrypted with EOR #$5a and its own loop that decrypts it in place */
const program = fromSource('crypt.prg', [
  '.pc = $0810',
  'decrypt: ldx #0',
  'loop:   lda data,x',
  `        eor #$${KEY.toString(16)}`,
  '        sta data,x',
  '        inx',
  '        cpx #16',
  '        bne loop',
  '        rts',
  '.pc = $0830',
  `data:   .byte ${PLAIN.map(b => b ^ KEY).join(', ')}`,
].join('\n'));

const env: ScriptEnv = { files: [program], names: new Map([['decrypt', 0x0810], ['loop', 0x0812], ['data', 0x0830], ['BORDER', 0xd020]]) };
const script = (source: string, pads: UserScript['pads'] = [{ name: 'pad1', start: 0xc800, size: 16 }]): UserScript => ({ id: 's', name: 's', lang: 'kickass', source, pads });

describe('user scripts', () => {
  it('call the program\'s own routine: the decrypted bytes are listed as changes, the copy goes to the scratchpad', () => {
    const s = script(['* = $c000', 'start: jsr decrypt', '        ldx #15', '!:      lda data,x', '        sta pad1,x', '        dex', '        bpl !-', '        rts'].join('\n'));
    const check = checkScript(env, s);
    expect(check.problems).toEqual([]);
    expect(check.entry).toBe(0xc000);
    const run = runScript(env, s, check);
    expect(run.end).toBe('rts');
    expect([...run.pads[0].bytes]).toEqual(PLAIN);
    expect(run.changes).toHaveLength(1);
    expect(run.changes[0]).toMatchObject({ start: 0x0830, end: 0x0840 });
    expect([...run.changes[0].bytes]).toEqual(PLAIN);
    expect([...run.changes[0].old]).toEqual(PLAIN.map(b => b ^ KEY));
    // the program in the env is untouched
    expect(program.load).toBe(0x0810);
    expect(program.bytes[0x20]).toBe(PLAIN[0] ^ KEY);
  });

  it('run a loop cut from the listing into the scratchpad; its own label wins over the program\'s', () => {
    const s = script(['* = $c000', 'start:', 'decrypt: ldx #0', 'loop:   lda data,x', '        eor #$5a', '        sta pad1,x', '        inx', '        cpx #<(pad1_end - pad1)', '        bne loop', '        rts'].join('\n'));
    const run = runScript(env, s);
    expect(run.end).toBe('rts');
    expect([...run.pads[0].bytes]).toEqual(PLAIN);
    expect(run.changes).toEqual([]);
    expect(String.fromCharCode(...run.pads[0].bytes)).toBe('HELLO, SCRIPTS!!');
  });

  it('fill a scratchpad at assembly time with .for, start at the first byte without start:, end at a BRK', () => {
    const s = script(['* = pad1', '.for (var i = 0; i < 16; i++) .byte i * i', '* = $c000', '        ldx #15', '!:      lda pad1,x', '        eor #$ff', '        sta pad1,x', '        dex', '        bpl !-', '        brk'].join('\n'));
    const check = checkScript(env, s);
    expect(check.ok).toBe(true);
    // the pad's bytes come first in the code, so the run must start at start: … or here, the first byte is the pad's
    expect(check.entry).toBe(0xc800);
    const s2 = { ...s, source: s.source.replace('* = $c000', '* = $c000\nstart:') };
    const run = runScript(env, s2);
    expect(run.end).toBe('brk');
    expect(run.at).toBe(0xc00d);
    expect([...run.pads[0].bytes]).toEqual(Array.from({ length: 16 }, (_, i) => (i * i) ^ 0xff));
  });

  it('say what is wrong, on which line, before a run', () => {
    const bad = checkScript(env, script('* = $c000\nstart: lda nothing\n rts'));
    expect(bad.ok).toBe(false);
    expect(bad.problems).toContainEqual({ level: 'error', msg: 'Unknown symbol "nothing"', line: 2 });
    expect(() => runScript(env, script('* = $c000\nstart: lda nothing'))).toThrow(/nothing/);
    expect(checkScript(env, script('// nothing to run')).problems[0].msg).toMatch(/no code to run/);
    const pads = checkScript(env, script('* = $c000\nstart: rts', [{ name: 'a', start: 0xc800, size: 16 }, { name: 'a', start: 0xc808, size: 16 }, { name: '9x', start: 0x0820, size: 4 }]));
    expect(pads.problems.map(p => [p.level, p.pad, p.msg.split(':')[0]])).toEqual([
      ['error', 1, 'There are two scratchpads called "a".'],
      ['error', 1, 'Scratchpad "a" lies over "a".'],
      ['error', 2, 'Scratchpad "9x"'],
      ['warning', 2, 'Scratchpad "9x" lies over 4 of the program\'s bytes'],
    ]);
    // code over the program's bytes is the script's while it runs: a warning
    const over = checkScript(env, script('* = $0830\nstart: rts'));
    expect(over.ok).toBe(true);
    expect(over.problems[0]).toMatchObject({ level: 'warning' });
  });

  it('stop at a JAM and at the instruction limit', () => {
    expect(runScript(env, script('* = $c000\nstart: nop\n .byte $02')).end).toBe('jam');
    const loop = runScript(env, script('* = $c000\nstart: inc BORDER\n jmp start'), undefined, 1000);
    expect(loop).toMatchObject({ end: 'limit', instructions: 1000 });
    expect(loop.other).toBe(1);
  });

  it('are made in free memory, with a scratchpad, from the lines given, and check out', () => {
    const s = newScript(env.files, [], ['        ldx #0', '        lda data,x', '        sta pad1,x']);
    expect(s.name).toBe('script');
    expect(s.source).toContain('* = $c000 "script"');
    expect(s.pads[0]).toMatchObject({ name: 'pad1', start: 0xc800, size: 0x100 });
    // $c000 taken: the largest free area, from $1000
    const big = { load: 0xc000, bytes: new Uint8Array(0x1000) };
    expect(freePlace([...env.files, big], 0x800)).toBe(0x1000);
    expect(freePlace([{ load: 0x0200, bytes: new Uint8Array(0xfe00) }], 1)).toBeNull();
    expect(checkScript(env, s).ok).toBe(true);
    expect(newScript(env.files, [s]).name).toBe('script2');
  });

  it('take the program\'s names from its listing, and are kept in the project with what their scratchpads hold', () => {
    const p = createProject({ name: 'crypt', files: [program] });
    const A = analyze(p), R = render(A, p);
    const e = scriptEnv(p, R, p.settings);
    expect(e.names.get('BORDER') ?? e.names.get('VIC_BORDER') ?? [...e.names.values()].includes(0xd020)).toBeTruthy();
    const s = { ...newScript(e.files, []), id: 'x' };
    s.pads[0].bytes = new Uint8Array([1, 2, 3]);
    const back = deserializeProject(JSON.parse(JSON.stringify(serializeProject({ ...p, userScripts: [s] }))));
    expect(back.userScripts).toHaveLength(1);
    expect(back.userScripts![0]).toMatchObject({ name: s.name, lang: 'kickass', source: s.source });
    expect([...back.userScripts![0].pads[0].bytes!]).toEqual([1, 2, 3]);
    expect(deserializeProject(JSON.parse(JSON.stringify(serializeProject(p)))).userScripts).toBeUndefined();
  });

  it('disassemble a scratchpad with the program\'s names', () => {
    const d = disassembleBytes([0xad, 0x30, 0x08, 0xd0, 0xfb, 0x02, 0xa9], 0xc000, new Map([[0x0830, 'data']]));
    expect(d.map(l => l.text)).toEqual(['lda data', 'bne $c000', 'jam', '.byte $a9']);
  });
});
