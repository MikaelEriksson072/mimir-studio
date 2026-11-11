/* User scripts (spec 10.3): checked with the program's names, run on a copy of its memory, scratchpads kept. */
import { describe, expect, it } from 'vitest';
import { analyze, checkScript, createProject, deserializeProject, disassembleBytes, freePlace, initEmpty, linkName, padData, padDiff, padNow, padStart, padText, SCRIPT_P, tidyInit, newScript, planPatch, render, runScript, ScriptMachine, scriptEnv, scriptPatches, serializeProject, switchPatch, withoutScriptPatches, withPatch, writeScriptRun, type ScriptEnv, type UserScript } from '../src';
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
    ]);
    // the script's code and scratchpads are memory of its own: at the program's addresses they are no trouble …
    expect(checkScript(env, script('* = $0830\nstart: rts')).problems).toEqual([]);
    // … unless the script uses a name of the program that is there: it would read itself
    const self = checkScript(env, script('* = $0830\nstart: lda data\n rts'));
    expect(self.problems).toEqual([{ level: 'error', line: 2, msg: expect.stringMatching(/^data \(\$0830\) is where the script's own code is/) }]);
    const inPad = checkScript(env, script('ldx data\n rts', [{ name: 'p', start: 0x082c, size: 8 }]));
    expect(inPad.problems).toEqual([{ level: 'error', line: 1, pad: 0, msg: expect.stringMatching(/^data \(\$0830\) is inside the scratchpad p/) }]);
    expect(checkScript(env, script('* = $0100\nstart: rts')).problems[0].msg).toMatch(/zero page or the stack/);
  });

  it('have memory of their own: the program\'s code never sees the script\'s bytes, even at the same addresses', () => {
    // the program: at $2000 it calls its routine at $c010, which counts at $3000
    const prog = fromSource('own.prg', '.pc = $2000\n jsr $c010\n rts\n.pc = $3000\n .byte 7\n.pc = $c000\n .fill 16, $ea\n inc $3000\n rts');
    const e: ScriptEnv = { files: [prog], names: new Map([['count', 0x3000], ['main', 0x2000]]) };
    // the script's code at $c000-$c01f, over the program's routine: calling the program, the routine is the program's
    const s = script('* = $c000\nstart: jsr main\n jsr main\n rts\n .fill 26, $00', []);
    expect(checkScript(e, s).problems).toEqual([]);
    const run = runScript(e, s);
    expect(run.end).toBe('rts');
    expect(run.changes).toEqual([expect.objectContaining({ start: 0x3000, end: 0x3001 })]);
    expect([...run.changes[0].bytes]).toEqual([9]);
    // the program's bytes under the script's code are as they were
    expect([...run.mem.subarray(0xc000, 0xc003)]).toEqual([0xea, 0xea, 0xea]);
  });

  it('are placed by Mimir: in free memory, else where the program has one byte value the longest, away from its names', () => {
    expect(checkScript(env, script('ldx #0\n rts', []))).toMatchObject({ place: 'free', entry: 0xc000 });
    // a program that fills memory: zeros at $5000-$5fff, its table at $5800 the script uses
    const full = new Uint8Array(0xfe00).map((_, i) => (i * 7 + 3) & 0xff);
    full.fill(0, 0x5000 - 0x200, 0x6000 - 0x200);
    const e: ScriptEnv = { files: [{ load: 0x0200, bytes: full }], names: new Map([['table', 0x5800]]) };
    const s = script('ldx #3\n!: inc table,x\n dex\n bpl !-\n rts', []);
    const c = checkScript(e, s);
    expect(c).toMatchObject({ ok: true, place: 'program' });
    // the zeros: $5000-$57ff, the longest run not over the table at $5800
    expect(c.entry).toBe(0x5000);
    const run = runScript(e, s, c);
    expect(run.changes).toEqual([expect.objectContaining({ start: 0x5800, end: 0x5804 })]);
    expect([...run.changes[0].bytes]).toEqual([1, 1, 1, 1]);
  });

  it('leave the zero page and the stack out of what goes into the program', () => {
    // a snapshot-like program from $0002: the script's JSR and its pointer change bytes there
    const e: ScriptEnv = { files: [{ load: 0x0002, bytes: new Uint8Array(0x3000) }], names: new Map([['table', 0x1000]]) };
    const run = runScript(e, script('* = $c000\nstart: lda #<table\n sta $fb\n lda #>table\n sta $fc\n jsr sub\n rts\nsub: ldy #0\n lda #5\n sta ($fb),y\n rts', []));
    expect(run.changes).toEqual([expect.objectContaining({ start: 0x1000, end: 0x1001 })]);
    expect(run.other).toBeGreaterThanOrEqual(2);
  });

  it('start with the registers, the flags and the zero-page bytes their init gives; the init is no change of the run', () => {
    // A, X and Y from the init, the carry added in, a pointer in the zero page that points at the program's data
    const s: UserScript = {
      ...script(['* = $c000', 'start: sta data', '        stx data+1', '        lda #0', '        adc #0', '        sta ($fb),y', '        lda $02', '        sta data+3', '        rts'].join('\n'), []),
      init: { a: 0xaa, x: 0x03, y: 0x02, p: SCRIPT_P | 0x01, zp: [{ at: 0xfb, value: 0x0830, word: true }, { at: 0x02, value: 0x7f }] },
    };
    expect(checkScript(env, s).problems).toEqual([]);
    const m = new ScriptMachine(env, s);
    expect([m.cpu.a, m.cpu.x, m.cpu.y, m.cpu.c, m.cpu.i, m.cpu.pc]).toEqual([0xaa, 0x03, 0x02, 1, 1, 0xc000]);
    expect([m.mem[0xfb], m.mem[0xfc], m.mem[0x02]]).toEqual([0x30, 0x08, 0x7f]);
    const run = runScript(env, s);
    expect(run.end).toBe('rts');
    expect(run.changes).toEqual([expect.objectContaining({ start: 0x0830, end: 0x0834 })]);
    expect([...run.changes[0].bytes]).toEqual([0xaa, 0x03, 0x01, 0x7f]);
    // the init's zero page was there before the run: not a change of its
    expect(run.other).toBe(0);
    // without an init: A, X and Y 0, only I set
    const plain = new ScriptMachine(env, script('* = $c000\nstart: rts', []));
    expect([plain.cpu.a, plain.cpu.x, plain.cpu.y, plain.cpu.p]).toEqual([0, 0, 0, SCRIPT_P]);
  });

  it('say what is wrong with an init, and keep only what differs from a run without one', () => {
    const s = (init: UserScript['init']) => checkScript(env, { ...script('* = $c000\nstart: rts', []), init });
    expect(s({ a: 0x100 }).problems.map(p => p.msg)).toEqual(['Init: A must be a byte ($00-$ff).']);
    expect(s({ zp: [{ at: 0xff, value: 0x1234, word: true }] }).problems).toEqual([expect.objectContaining({ level: 'error', zp: 0, msg: expect.stringContaining('$00ff is not in the zero page: a word goes at $00-$fe') })]);
    expect(s({ zp: [{ at: 0x10, value: 0x1234 }] }).problems.map(p => p.msg)).toEqual(['Init: the value for $10 must be a byte ($00-$ff); a word takes two.']);
    const twice = s({ zp: [{ at: 0xfb, value: 0x1000, word: true }, { at: 0xfc, value: 1 }] });
    expect([twice.ok, twice.problems.map(p => [p.level, p.zp])]).toEqual([true, [['warning', 1]]]);
    expect(initEmpty(undefined)).toBe(true);
    expect(initEmpty({ a: 0, p: SCRIPT_P | 0x30, zp: [] })).toBe(true);
    expect(initEmpty({ p: SCRIPT_P | 1 })).toBe(false);
    expect(tidyInit({ a: 0, x: 5, p: SCRIPT_P | 0x10, zp: [{ at: 2, value: 0, word: false }] })).toEqual({ x: 5, zp: [{ at: 2, value: 0 }] });
    expect(tidyInit({ p: 0x31 })).toEqual({ p: 0x21 });
    expect(tidyInit({ a: 0, zp: [] })).toBeNull();
  });

  it('start a scratchpad with what it is set to hold: written as Kick Assembler, hex or text, the rest its fill', () => {
    const names = new Map([['data', 0x0830]]);
    const asm = padData({ form: 'asm', text: 'first: .byte 1, 2\n .word data\n lda first\n .text "AB"' }, 0xc800, 16, names);
    expect('bytes' in asm && [...asm.bytes]).toEqual([1, 2, 0x30, 0x08, 0xad, 0x00, 0xc8, 0x41, 0x42]);
    // a hex dump as the scratchpad view shows one (its address and text left out), and loose bytes
    const hex = padData({ form: 'hex', text: '$c800  01 02 ff  ..A\n$03,0x04 0506 // a comment' }, 0xc800, 16, names);
    expect('bytes' in hex && [...hex.bytes]).toEqual([1, 2, 0xff, 3, 4, 5, 6]);
    expect(padData({ form: 'hex', text: '01 zz' }, 0xc800, 16, names)).toEqual({ error: expect.stringContaining('"zz" is not a hex byte'), line: 1 });
    // a dump line's address puts its bytes there; what no line wrote between them is the fill
    const at = padData({ form: 'hex', text: '01\n$c804  aa' }, 0xc800, 16, names, 0xee);
    expect('bytes' in at && [...at.bytes]).toEqual([1, 0xee, 0xee, 0xee, 0xaa]);
    expect(padData({ form: 'hex', text: '$c900  01' }, 0xc800, 16, names)).toEqual({ error: expect.stringContaining('$c900 is outside the scratchpad'), line: 1 });
    const pet = padData({ form: 'text', text: 'Hi!\nOK' }, 0xc800, 16, names);
    expect('bytes' in pet && [...pet.bytes]).toEqual([0x48, 0x49, 0x21, 0x0d, 0x4f, 0x4b]);
    const scr = padData({ form: 'text', text: 'A\n\nB', screen: true }, 0xc800, 0x100, names);
    expect('bytes' in scr && [scr.bytes.length, scr.bytes[0], scr.bytes[1], scr.bytes[80]]).toEqual([81, 0x01, 0x20, 0x02]);
    // more than it holds, or written before its start
    expect(padData({ form: 'hex', text: '01 02 03' }, 0xc800, 2, names)).toEqual({ error: expect.stringContaining('It is 3 bytes, and the scratchpad holds 2') });
    expect(padData({ form: 'asm', text: '* = $c7ff\n .byte 1' }, 0xc800, 2, names)).toEqual({ error: expect.stringContaining('before the scratchpad\'s start') });
    // the forms written back from bytes read the same bytes again
    const b = Uint8Array.from([1, 2, 0x48, 0x49, 0xff]);
    for (const form of ['asm', 'hex'] as const) { const r = padData({ form, text: padText(b, form, 0xc800) }, 0xc800, 16, names); expect('bytes' in r && [...r.bytes]).toEqual([...b]); }
    expect(padText(Uint8Array.from([0x48, 0x49, 0x0d, 0x4f]), 'text', 0xc800)).toBe('HI\nO');

    // a run starts the scratchpad with it, the rest its fill
    const pad = { name: 'pad1', start: 0xc800, size: 8, fill: 0xee, data: Uint8Array.from([1, 2, 3]) };
    expect([...padStart(pad)]).toEqual([1, 2, 3, 0xee, 0xee, 0xee, 0xee, 0xee]);
    expect([...padNow({ ...pad, bytes: new Uint8Array(8) })]).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    const run = runScript(env, script('* = $c000\nstart: lda pad1+1\n sta pad1+4\n rts', [pad]));
    expect([...run.pads[0].bytes]).toEqual([1, 2, 3, 0xee, 2, 0xee, 0xee, 0xee]);
    expect(checkScript(env, script('* = $c000\nstart: rts', [{ ...pad, size: 2 }])).problems).toEqual([expect.objectContaining({ level: 'warning', pad: 0, msg: expect.stringContaining('starts with 3 bytes but holds 2') })]);
    // kept in the project
    const p = { ...createProject({ files: [{ name: 'crypt.prg', load: program.load, bytes: program.bytes }] }), userScripts: [{ ...script('rts', [{ ...pad, src: { form: 'hex' as const, text: '01 02 03' } }]) }] };
    const back = deserializeProject(JSON.parse(JSON.stringify(serializeProject(p))));
    expect(back.userScripts?.[0].pads[0]).toMatchObject({ src: { form: 'hex', text: '01 02 03' } });
    expect([...back.userScripts![0].pads[0].data!]).toEqual([1, 2, 3]);
  });

  it('compare two scratchpads byte by byte: the same, the different, the runs of differences', () => {
    const d = padDiff([1, 2, 3, 4, 5, 6], [1, 9, 9, 4, 5, 7, 8]);
    expect(d).toEqual({ same: 3, differ: 3, onlyA: 0, onlyB: 1, first: 1, runs: [{ start: 1, end: 3 }, { start: 5, end: 6 }] });
    expect(padDiff([1, 2], [1, 2])).toMatchObject({ differ: 0, first: null, runs: [] });
  });

  it('still assemble when their own run made the analysis name a table anew: Mimir\'s names end in their address', () => {
    // colors_0939 is tbl_0939 once the run wrote more than colours into it; ptr_fb a zero-page variable
    const e: ScriptEnv = { files: [program], names: new Map([['tbl_0939', 0x0939], ['ptr_fb', 0xfb]]) };
    const c = checkScript(e, script('* = $c000\nstart: lda colors_0939\n sta colors_0939+1\n lda zp_fb\n rts', []));
    expect(c.problems).toEqual([]);
    expect(c.uses.map(u => [u.name, u.at])).toEqual([['colors_0939', 0x0939], ['zp_fb', 0xfb]]);
    // no name of the program at the address: still unknown
    expect(checkScript(e, script('* = $c000\nstart: lda table_1234\n rts', [])).problems.map(p => p.msg)).toEqual(['Unknown symbol "table_1234"']);
  });

  it('stop at a JAM and at the instruction limit', () => {
    expect(runScript(env, script('* = $c000\nstart: nop\n .byte $02')).end).toBe('jam');
    const loop = runScript(env, script('* = $c000\nstart: inc BORDER\n jmp start'), undefined, 1000);
    expect(loop).toMatchObject({ end: 'limit', instructions: 1000 });
    expect(loop.other).toBe(1);
  });

  it('are made from the lines given, without * = and without a scratchpad, and check out', () => {
    const s = newScript([], ['        ldx #0', '        lda data,x', '        sta data+16,x']);
    expect(s.name).toBe('script');
    expect(s.source).not.toContain('* =');
    expect(s.source).toContain('goes into the program and its .asm; this code itself never does');
    expect(s.pads).toEqual([]);
    // $c000 taken: the largest free area, from $1000
    const big = { load: 0xc000, bytes: new Uint8Array(0x1000) };
    expect(freePlace([...env.files, big], 0x800)).toBe(0x1000);
    expect(freePlace([{ load: 0x0200, bytes: new Uint8Array(0xfe00) }], 1)).toBeNull();
    expect(checkScript(env, s).ok).toBe(true);
    expect(newScript([s]).name).toBe('script2');
  });

  it('take the program\'s names from its listing, and are kept in the project with what their scratchpads hold', () => {
    const p = createProject({ name: 'crypt', files: [program] });
    const A = analyze(p), R = render(A, p);
    const e = scriptEnv(p, R, p.settings);
    expect(e.names.get('BORDER') ?? e.names.get('VIC_BORDER') ?? [...e.names.values()].includes(0xd020)).toBeTruthy();
    const s = { ...newScript([]), id: 'x', pads: [{ name: 'log', start: 0xc800, size: 3, bytes: new Uint8Array([1, 2, 3]) }] };
    const back = deserializeProject(JSON.parse(JSON.stringify(serializeProject({ ...p, userScripts: [s] }))));
    expect(back.userScripts).toHaveLength(1);
    // the id is kept: the script's patches name it
    expect(back.userScripts![0]).toMatchObject({ id: 'x', name: s.name, lang: 'kickass', source: s.source });
    expect([...back.userScripts![0].pads[0].bytes!]).toEqual([1, 2, 3]);
    expect(deserializeProject(JSON.parse(JSON.stringify(serializeProject(p)))).userScripts).toBeUndefined();
  });

  it('write what a run changed into the program as their patches: the source has the new bytes, a run starts from the program before them', () => {
    const prog = fromSource('table.prg', '.pc = $0810\n rts\n.pc = $0820\n .byte 1, 2, 3, 4\n .byte 0, 0, 0, 0');
    const p = { ...createProject({ name: 'table', files: [prog] }), labels: { 0x0820: 'my_table' } };
    const s: UserScript = { id: 'dbl', name: 'double', lang: 'kickass', source: '* = $c000\nstart: ldx #3\n!: asl my_table,x\n dex\n bpl !-\n rts', pads: [] };
    /** a run of the script, written into the project as it is: the next project */
    const runOn = (q: typeof p) => {
      const A = analyze(q), R = render(A, q);
      const base = { ...q, ...withoutScriptPatches(q, s.id) };
      const run = runScript(scriptEnv(base, R, q.settings), s);
      const w = writeScriptRun(A, R, base, s, run, scriptPatches(q.patches, s.id));
      return { project: { ...q, files: w.files, patches: w.patches }, w };
    };
    const at = (q: typeof p) => [...analyze(q).mem.subarray(0x0820, 0x0824)];

    const one = runOn(p);
    expect(one.w.failed).toEqual([]);
    expect(one.w.written).toHaveLength(1);
    expect(one.w.written[0]).toMatchObject({ name: 'double', start: 0x0820, end: 0x0824, script: 'dbl' });
    expect(at(one.project)).toEqual([2, 4, 6, 8]);
    const src = Object.values(render(analyze(one.project), one.project).files).filter(f => typeof f === 'string').join('\n');
    expect(src).toContain('==== changed by the script "double": $0820-$0823, 4 bytes ====');
    expect(src).not.toContain('asl my_table');
    // a run again starts from 1, 2, 3, 4, not from what the last run wrote
    const two = runOn(one.project);
    expect(at(two.project)).toEqual([2, 4, 6, 8]);
    expect(scriptPatches(two.project.patches, s.id)).toHaveLength(1);
    // taken out, the program has its bytes back
    expect(at({ ...two.project, ...withoutScriptPatches(two.project, s.id) })).toEqual([1, 2, 3, 4]);
    // switched off by the user, the change stays off when it runs again
    const off = { ...two.project, ...switchPatch(two.project, two.w.written[0].id, false) };
    const three = runOn(off);
    expect(three.w.written[0].off).toBe(true);
    expect(at(three.project)).toEqual([1, 2, 3, 4]);
    // in a patch of the user's: not written, and said why
    const mine = planPatch(analyze(p), render(analyze(p), p), p, { name: 'mine', start: 0x0822, end: 0x0823, source: ' .byte 9', fill: 'keep', over: false });
    if ('error' in mine) throw new Error(mine.error);
    const four = runOn({ ...p, ...withPatch(p, mine.patch) });
    expect(four.w.written).toEqual([]);
    expect(four.w.failed[0].error).toMatch(/write over the patch "mine"/);
  });

  it('go an instruction at a time: the registers, the line, and the stack with the return addresses said', () => {
    const s = script(['* = $c000', 'start: ldx #2', ' jsr sub', ' rts', 'sub: lda data,x', ' pha', ' pla', ' rts'].join('\n'), []);
    const m = new ScriptMachine(env, s);
    expect(m.lineAt()).toBe(2);
    // the script's own labels, for the debugger's names
    expect([...m.check.labels]).toEqual([[0xc000, 'start'], [0xc006, 'sub']]);
    expect(m.stack()).toEqual([{ addr: 0x1ff, value: 0xff, ret: { to: 0x0000, by: 'start' } }, { addr: 0x1fe, value: 0xff, low: true }]);
    m.step();
    expect([m.cpu.x, m.cpu.pc, m.lineAt()]).toEqual([2, 0xc002, 3]);
    m.step();
    expect([m.cpu.pc, m.lineAt(), m.cpu.s]).toEqual([0xc006, 5, 0xfb]);
    expect(m.stack()[2]).toMatchObject({ addr: 0x1fd, ret: { to: 0xc005, by: 'script' } });
    m.step();
    expect(m.cpu.a).toBe(PLAIN[2] ^ KEY);
    m.step();
    expect(m.stack().at(-1)).toEqual({ addr: 0x1fb, value: PLAIN[2] ^ KEY });
    // on to a line, then to the end: the same as a run in one go
    expect(m.runUntil(x => x.lineAt() === 4)).toBe('stopped');
    expect(m.cpu.pc).toBe(0xc005);
    expect(m.runUntil(null)).toBe('ended');
    expect(m.result()).toMatchObject({ end: 'rts', instructions: 7, changes: [] });
    expect(m.step()).toBe(false);
  });

  it('say, while the program\'s code runs for the script, which line of the script called it', () => {
    const m = new ScriptMachine(env, script('* = $c000\nstart: jsr decrypt\n rts', []));
    m.step();
    expect([m.inScript, m.lineAt(), m.callLine(), m.cpu.pc]).toEqual([false, null, 2, 0x0810]);
    expect(m.stack()[2]).toMatchObject({ ret: { to: 0xc003, by: 'script' } });
    // the program's own JSR, inside it: its frame is the program's
    expect(m.peek(0x0810)).toBe(0xa2);
    m.runUntil(x => x.inScript);
    expect([m.cpu.pc, m.lineAt()]).toEqual([0xc003, 3]);
  });

  it('name a linked address as the listing does, say which of the program\'s names the code uses, and keep the links in the project', () => {
    const p = createProject({ name: 'crypt', files: [program] });
    const A = analyze(p), R = render(A, p);
    const data = [...R.labels].find(([a]) => a === 0x0830)?.[1].name;
    expect(data).toBeTruthy();
    expect(linkName(R, A, 0x0830)).toEqual({ at: 0x0830, name: data, what: 'label' });
    // a byte inside the block: the label before it and how far on
    expect(linkName(R, A, 0x0835)).toEqual({ at: 0x0835, name: `${data}+5`, what: 'label' });
    expect(linkName(R, A, 0xd020)).toMatchObject({ what: 'hardware' });
    expect(linkName(R, A, 0xe123)).toEqual({ at: 0xe123, name: '$e123', what: 'address' });
    const zp = { ...R, zp: new Map([[0xfb, { name: 'ptr' }], [0xfc, { name: 'ptr', off: 1 }]]) };
    expect(linkName(zp, A, 0xfb)).toMatchObject({ name: 'ptr', what: 'variable' });
    expect(linkName(zp, A, 0xfc)).toMatchObject({ name: 'ptr+1', what: 'variable' });
    // the program's names the code uses, with the line they are first used on (not the scratchpads')
    expect(checkScript(env, script(['        lda data', '        sta pad1', '        jsr decrypt', '        lda data+1', '        rts'].join('\n'))).uses)
      .toEqual([{ name: 'data', line: 1, at: 0x0830 }, { name: 'decrypt', line: 3, at: 0x0810 }]);
    const s: UserScript = { ...newScript([]), id: 'x', links: [0x0830, 0x0835] };
    expect(deserializeProject(JSON.parse(JSON.stringify(serializeProject({ ...p, userScripts: [s] })))).userScripts![0].links).toEqual([0x0830, 0x0835]);
  });
  it('disassemble a scratchpad with the program\'s names', () => {
    const d = disassembleBytes([0xad, 0x30, 0x08, 0xd0, 0xfb, 0x02, 0xa9], 0xc000, new Map([[0x0830, 'data']]));
    expect(d.map(l => l.text)).toEqual(['lda data', 'bne $c000', 'jam', '.byte $a9']);
  });
});
