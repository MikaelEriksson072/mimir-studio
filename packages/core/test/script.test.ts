/* User scripts (spec 10.3): checked with the program's names, run on a copy of its memory, scratchpads kept. */
import { describe, expect, it } from 'vitest';
import { analyze, checkScript, createProject, deserializeProject, disassembleBytes, freePlace, newScript, planPatch, render, runScript, ScriptMachine, scriptEnv, scriptPatches, serializeProject, switchPatch, withoutScriptPatches, withPatch, writeScriptRun, type ScriptEnv, type UserScript } from '../src';
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

  it('disassemble a scratchpad with the program\'s names', () => {
    const d = disassembleBytes([0xad, 0x30, 0x08, 0xd0, 0xfb, 0x02, 0xa9], 0xc000, new Map([[0x0830, 'data']]));
    expect(d.map(l => l.text)).toEqual(['lda data', 'bne $c000', 'jam', '.byte $a9']);
  });
});
