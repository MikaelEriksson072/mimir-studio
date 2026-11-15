/* The user's own code in 64tass (spec 10.2, 10.3, 11.8): a patch and a script keep the language they are written in
 * (code-lang.ts), the built-in 64tass assembler reads them as 64tass does (a mnemonic at the start of a line, _local
 * labels, .warn), the script templates and Kick Assembler code are written as 64tass (code-convert.ts), and the real
 * 64tass (when it is found) gives the same bytes. */
import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  analyze, assemble, assembleIn, assembleTass, blockPad, checkScript, codeLabels, codeLines, codeOfLine, commentAt, createProject, definedNames, exportFiles,
  h4, kickToTass, makeDemo, makePrg, needsTassCpu, newScript, padData, padStoreAt, parsePrg, patchIn64tass, patchSource, planPatch, scriptIn64tass, render, runScript, SCRIPT_TEMPLATES, scriptEnv,
  scriptNames, scriptWatches, setsItsPlace, splitLabel, templateSource, usedWords, withPatch, writeScriptRun, type PatchRequest, type Project, type ScriptEnv, type UserScript,
} from '../src';
import { find64tass, run64tass, writeVfs } from '../src/node';
import { fromSource } from './helpers/programs';

const tass = process.env.TASS64 || find64tass();

describe('the built-in 64tass assembler reads code as 64tass does', () => {
  it('a lower-case mnemonic at the start of a line is the instruction, any other word there a label', () => {
    const r = assembleTass({ 'a.asm': '* = $c000\nlda #1\nloop sta $d020\nLDA nop\nnext\n jmp loop\n' }, 'a.asm');
    expect(r.errors).toEqual([]);
    expect([...r.prg!].slice(2)).toEqual([0xa9, 0x01, 0x8d, 0x20, 0xd0, 0xea, 0x4c, 0x02, 0xc0]);
    expect(r.symbols.get('loop')).toBe(0xc002);
    expect(r.symbols.get('LDA')).toBe(0xc005);
    expect(r.symbols.get('next')).toBe(0xc006);
  });

  it('a label that starts with _ belongs to the code label before it (a constant opens none), and is named by it', () => {
    const src = '* = $c000\nl1 inx\n_x inx\nk = 5\n bne _x\nl2: nop\n_x dex\n bne _x\n jmp l1._x\n';
    const r = assembleTass({ 'a.asm': src }, 'a.asm');
    expect(r.errors).toEqual([]);
    expect([...r.prg!].slice(2)).toEqual([0xe8, 0xe8, 0xd0, 0xfd, 0xea, 0xca, 0xd0, 0xfd, 0x4c, 0x01, 0xc0]);
    expect(r.symbols.get('l1._x')).toBe(0xc001);
    expect(r.symbols.get('l2._x')).toBe(0xc005);
  });

  it('.warn prints (a script\'s output shows it), .error stops; each line\'s address is known', () => {
    const r = assembleTass({ 'a.asm': '* = $c000\n.warn "at ", *, " ", format("%04x", $c000)\n nop\n\n; a comment\nend rts\n' }, 'a.asm');
    expect(r.errors).toEqual([]);
    expect(r.prints).toEqual(['at 49152 c000']);
    expect([...r.linePcs!]).toEqual([[1, 0], [2, 0xc000], [3, 0xc000], [6, 0xc001]]);
    expect(r.endPc).toBe(0xc002);
    expect(assembleTass({ 'a.asm': '.error "stop ", "here"\n' }, 'a.asm').errors.map(e => e.msg)).toEqual(['stop here']);
  });
});

describe('a line of code in each language', () => {
  it('its comment, its label, the code after them', () => {
    expect(commentAt('  lda #";" ; x', '64tass')).toBe(11);
    expect(commentAt("  lda #';' // x", 'kickass')).toBe(11);
    expect(commentAt('  .text "a//b" // x', 'kickass')).toBe(15);
    expect(splitLabel('loop  sta $d020,x', '64tass')).toEqual({ label: 'loop', lead: 'loop  ', rest: 'sta $d020,x' });
    expect(splitLabel('lda #1', '64tass')).toEqual({ lead: '', rest: 'lda #1' });
    expect(splitLabel('+ rts', '64tass')).toEqual({ label: '+', lead: '+ ', rest: 'rts' });
    expect(splitLabel('   loop: rts', '64tass')).toEqual({ lead: '   ', rest: 'loop: rts' });
    expect(splitLabel('   loop: rts', 'kickass')).toEqual({ label: 'loop', lead: '   loop: ', rest: 'rts' });
    expect(codeOfLine('loop sta @w $02 ; x', '64tass')).toBe('sta @w $02');
    expect(codeOfLine('!: sta $02 // x', 'kickass')).toBe('sta $02');
  });

  it('what the code defines and uses, block comments, where it says it goes', () => {
    const t = '; head\nsize = 4\nloop lda tbl,x\n_l  dex\n.comment\nhidden lda nothing\n.endc\nns .namespace\n.endnamespace\n bne loop ; uses other\n';
    expect([...codeLabels(t, '64tass')].sort()).toEqual(['_l', 'loop']);
    expect([...definedNames(t, '64tass')].sort()).toEqual(['_l', 'loop', 'ns', 'size']);
    expect(usedWords(t, '64tass').has('tbl')).toBe(true);
    expect(usedWords(t, '64tass').has('nothing')).toBe(false);
    expect(usedWords(t, '64tass').has('other')).toBe(false);
    expect(codeLines(t, '64tass')[5]).toBe('');
    expect(setsItsPlace('; x\n* = $c000\n', '64tass')).toBe(true);
    expect(setsItsPlace('.comment\n* = $c000\n.endc\n lda #0\n', '64tass')).toBe(false);
    expect(setsItsPlace('/* * = 1 */\n.pc = $c000\n', 'kickass')).toBe(true);
  });
});

describe('Kick Assembler code written as 64tass', () => {
  it('converts each script template, and they give the same bytes', () => {
    const names = new Map([['result', 0xc000], ['result_end', 0xc400]]);
    for (const t of SCRIPT_TEMPLATES) {
      const r = kickToTass(t.source);
      expect('source' in r, `${t.name}: ${'error' in r ? `${r.line}: ${r.error}` : ''}`).toBe(true);
      const k = assemble({ 's.asm': t.source }, 's.asm', { names, pc: 0xc400 }), s = assembleTass({ 's.asm': templateSource(t, '64tass') }, 's.asm', { names, pc: 0xc400 });
      expect(k.errors, t.name).toEqual([]);
      expect(s.errors, t.name).toEqual([]);
      expect([...s.mem.subarray(k.min, k.max + 1)], t.name).toEqual([...k.mem.subarray(k.min, k.max + 1)]);
      expect([s.min, s.max]).toEqual([k.min, k.max]);
    }
  });

  it('comments, definitions where they stood, labels, !:, .if blocks, .abs, the undocumented opcodes', () => {
    const r = kickToTass([
      '// head', '.var key = $10      // the key', '.const ZP = $fb', 'start:  ldx #0', '!:      lda $c000,x', '        isc ZP', '        lda.abs ZP',
      '.if (key > 0) {', '        inx', '} else {', '        dex', '}', '.if (key > 1) .error "too big"', '        bne !-', '        rts',
    ].join('\n'));
    expect(r).toEqual({ source: [
      '.cpu "6502i"                    ; 64tass: the undocumented opcodes', '; head', 'key      = $10      ; the key', 'ZP        = $fb', 'start:  ldx #0', '-', '+       lda $c000,x',
      '        isb ZP', '        lda @w ZP', '.if (key > 0)', '        inx', '.else', '        dex', '.endif', '.cerror (key > 1), "too big"', '        bne -', '        rts',
    ].join('\n') });
  });

  it('says what it cannot write for 64tass, and on which line', () => {
    expect(kickToTass(' nop\n.for (var i = 0; i < 3; i++) {\n nop\n}\n')).toMatchObject({ line: 2, error: expect.stringContaining('.for') });
    expect(kickToTass(' lda #\'a\'\n')).toMatchObject({ line: 1, error: expect.stringContaining('character') });
    expect(kickToTass(' .text "hi"\n')).toMatchObject({ line: 1 });
    expect(kickToTass('!loop: dex\n bne !loop-\n')).toMatchObject({ line: 1 });
    expect(kickToTass(' lda #floor(3.5)\n')).toMatchObject({ line: 1, error: expect.stringContaining('function') });
  });
});

// 10 SYS2061: lda #0 / sta $d020 / sta $d021 / ldx #5 / loop: dex / bne loop / rts
const SRC = '.pc = $0801\n.byte $0b,$08,$0a,$00,$9e,$32,$30,$36,$31,$00,$00,$00\n.pc = $080d\n lda #$00\n sta $d020\n sta $d021\n ldx #$05\nloop:\n dex\n bne loop\n rts';
const project = (asm: 'kick' | '64tass' = '64tass'): Project => {
  const p = createProject({ files: [fromSource('fix.prg', SRC)] });
  return { ...p, settings: { ...p.settings, assembler: asm }, labels: { [0x0817]: 'loop' } };
};
const ctx = (p: Project) => { const A = analyze(p); return { A, R: render(A, p) }; };
const plan = (p: Project, req: Partial<PatchRequest> & Pick<PatchRequest, 'start' | 'end' | 'source'>) => {
  const { A, R } = ctx(p);
  return planPatch(A, R, p, { name: 'fix', fill: 'nop', over: false, lang: '64tass', ...req });
};
const ok = (r: ReturnType<typeof plan>) => { if ('error' in r) throw new Error(r.error); return r; };

describe('a patch in 64tass', () => {
  it('assembles with the program\'s names, says where each line goes, and keeps its language', () => {
    const p = project();
    const r = ok(plan(p, { start: 0x080d, end: 0x0817, source: '; red\nset  lda #$02\n     sta VIC_BORDER_COLOR\n_w   jmp loop' }));
    expect([...r.patch.bytes]).toEqual([0xa9, 0x02, 0x8d, 0x20, 0xd0, 0x4c, 0x17, 0x08, 0xea, 0xea]);
    expect(r.patch.lang).toBe('64tass');
    expect(r.lines).toEqual([null, { addr: 0x080d, len: 2 }, { addr: 0x080f, len: 3 }, { addr: 0x0812, len: 3 }]);
    // an error on its line, a * = that moves it
    expect(plan(p, { start: 0x080d, end: 0x0817, source: ' lda #0\n lda nothing' })).toMatchObject({ line: 2, error: expect.stringContaining("Line 2: not defined symbol 'nothing'") });
    expect(plan(p, { start: 0x080d, end: 0x0817, source: '* = $0900\n nop' })).toMatchObject({ error: expect.stringContaining('a * = in it moves it') });
    // Kick Assembler's code is not 64tass
    expect(plan(p, { start: 0x080d, end: 0x0817, source: ' lda #2 // red' })).toMatchObject({ error: expect.any(String) });
    expect(ok(plan(p, { start: 0x080d, end: 0x0817, source: ' lda #2 // red', lang: 'kickass' })).patch.lang).toBeUndefined();
  });

  it('exports as a 64tass source of its own; a patch in the other language as its bytes', () => {
    let p = project();
    const a = ok(plan(p, { name: 'red', start: 0x080d, end: 0x0817, source: 'wait\n        lda #$02\n        sta VIC_BORDER_COLOR   ; red\n        jmp loop' })).patch;
    p = { ...p, ...withPatch(p, a) };
    const { R } = ctx(p);
    const asm = patchSource(R, p.settings, a, 'fix.prg', '64tass');
    expect(asm).toContain('; It assembles on its own to a PRG that loads at $080d: 64tass -a -C --cbm-prg -o red.prg red.asm');
    expect(asm).toContain('; the names the code uses, from the program and the C64 hardware\nVIC_BORDER_COLOR = $d020\nloop = $0817\n\n* = $080d                               ; red\nwait\n');
    expect(asm).toContain('        .fill 2, $ea              ; the rest of the range: NOP');
    const r = assembleTass({ 'red.asm': asm }, 'red.asm');
    expect(r.errors).toEqual([]);
    expect([...r.prg!]).toEqual([...makePrg(0x080d, a.bytes)]);
    // in a Kick Assembler export: the bytes, the 64tass code as a comment
    const k = patchSource(R, p.settings, a, 'fix.prg', 'kick');
    expect(k).toContain('// The code is written in 64tass, so here are the bytes it writes.');
    expect(k).toContain('//           sta VIC_BORDER_COLOR   ; red');
    expect([...assemble({ 'red.asm': k }, 'red.asm').prg!]).toEqual([...makePrg(0x080d, a.bytes)]);
    // the export writes it for the project's assembler
    expect(exportFiles(p, R, p.settings)['patches/red.asm']).toBe(asm);
  });

  it('a run of a script writes its patches in the project\'s language', () => {
    const p = project(), { A, R } = ctx(p);
    const w = writeScriptRun(A, R, p, { id: 's', name: 'run' }, { changes: [{ start: 0x080e, end: 0x080f, bytes: Uint8Array.of(7), old: Uint8Array.of(0) }] });
    expect(w.written[0]).toMatchObject({ lang: '64tass', source: '        .byte $07', script: 's' });
  });
});

const KEY = 0x5a;
const PLAIN = [...'HELLO, SCRIPTS!!'].map(c => c.charCodeAt(0));
const program = fromSource('crypt.prg', ['.pc = $0810', 'decrypt: ldx #0', 'loop:   lda data,x', `        eor #$${KEY.toString(16)}`, '        sta data,x', '        inx', '        cpx #16', '        bne loop', '        rts',
  '.pc = $0830', `data:   .byte ${PLAIN.map(b => b ^ KEY).join(', ')}`].join('\n'));
const env: ScriptEnv = { files: [program], names: new Map([['decrypt', 0x0810], ['loop', 0x0812], ['data', 0x0830], ['BORDER', 0xd020]]) };
const script = (source: string, pads: UserScript['pads'] = [{ name: 'pad1', start: 0xc800, size: 16 }]): UserScript => ({ id: 's', name: 's', lang: '64tass', source, pads });

describe('a script in 64tass', () => {
  it('is made in the project\'s language, runs, and copies into its scratchpad', () => {
    const s = newScript([], ['_l  lda data,x', '    eor #$5a', '    sta pad1,x', '    inx', '    cpx #16', '    bne _l'], 'id', '64tass');
    expect(s.lang).toBe('64tass');
    expect(s.source.split('\n')[0]).toMatch(/^; script: runs in Mimir/);
    const sc = { ...s, pads: [{ name: 'pad1', start: 0xc800, size: 16 }] };
    const c = checkScript(env, sc);
    expect(c.problems).toEqual([]);
    const r = runScript(env, sc, c);
    expect(r.end).toBe('rts');
    expect([...r.pads[0].bytes]).toEqual(PLAIN);
    expect(r.changes).toEqual([]);
    // the same code as Kick Assembler is not 64tass
    expect(checkScript(env, script(' ldx #0 // a comment\n rts')).ok).toBe(false);
    // an undocumented opcode from the listing: the CPU that has it
    const ill = newScript([], ['        lax data', '        sbx #1'], 'id', '64tass');
    expect(ill.source.split('\n').slice(2, 4)).toEqual(['        .cpu "6502i"', '        lax data']);
    expect(checkScript(env, ill).problems).toEqual([]);
    expect(needsTassCpu(['  lda #1', '  nop'])).toBe(false);
    expect(needsTassCpu(['  nop #$80'])).toBe(true);
    expect(needsTassCpu([' .cpu "6502i"', ' isb $02'])).toBe(false);
  });

  it('calls the program\'s routine, starts at start, prints with .warn, places itself away from what it writes', () => {
    const s = script('; decrypt in place\n.warn "len ", 16\nstart   jsr decrypt\n        lda data\n        sta pad1\n        rts\n');
    const c = checkScript(env, s);
    expect(c.problems).toEqual([]);
    expect(c.prints).toEqual(['len 16']);
    expect(c.uses.map(u => u.name).sort()).toEqual(['data', 'decrypt']);
    const r = runScript(env, s, c);
    expect([...r.mem.subarray(0x0830, 0x0840)]).toEqual(PLAIN);
    expect(r.pads[0].bytes[0]).toBe(PLAIN[0]);
    // * = at its top: its own place
    expect(checkScript(env, script('* = $c000\n rts')).place).toBe('own');
  });

  it('finds what its code writes for the watch list, and copies a store into a scratchpad', () => {
    const src = 'loop    lda data,x\n        sta @w $0400,x\n        inx\n        bne loop\n        rts\n';
    const s = script(src), c = checkScript(env, s);
    expect(c.problems).toEqual([]);
    expect(scriptWatches(c, src, s.pads, '64tass').map(w => w.name)).toContain('$0400');
    const st = padStoreAt(src.split('\n'), 2, s.pads, '64tass');
    expect(st).toMatchObject({ mn: 'sta', operand: '$0400', index: 'x', indent: '        ' });
    expect(padStoreAt('.comment\n sta $0400\n.endc\n'.split('\n'), 2, [], '64tass')).toBeNull();
    expect(padStoreAt(['loop sta $0400'], 1, [], '64tass')).toMatchObject({ indent: '     ' });
  });

  it('starts a scratchpad with 64tass code; copies the demo\'s blocks into one in 64tass, as their exact bytes', () => {
    expect(padData({ form: 'asm', text: '; x\n .byte 1, 2\n .word *\n' }, 0xc000, 16, new Map(), 0, '64tass')).toEqual({ bytes: Uint8Array.of(1, 2, 0x02, 0xc0) });
    const d = makeDemo(), p0 = createProject({ name: 'demo', files: [parsePrg(d.name, d.prg)] });
    const p = { ...p0, settings: { ...p0.settings, assembler: '64tass' as const } };
    const A = analyze(p), R = render(A, p), e = scriptEnv(p, R, p.settings, A.blocks, A.music), names = scriptNames(e, []);
    const at = 0xc000, pad = (start: number) => blockPad(A.blocks.find(b => b.start === start)!, R.lines, A.mem, at, names, p.settings);
    for (const b of A.blocks) {
      const bp = pad(b.start), r = padData(bp.src, at, b.end - b.start, names, 0, '64tass');
      expect('bytes' in r && [...r.bytes], `${b.type} at $${b.start.toString(16)} as ${bp.what}`).toEqual([...A.mem.subarray(b.start, b.end)]);
    }
    const irq = pad(0x08b7);
    expect(irq).toMatchObject({ what: 'code', src: { form: 'asm' } });
    expect(irq.src.text).toMatch(/^\.cpu "6502i"\n; irq_08b7:\n\s+inc VIC_IRQ_STATUS/);
    expect(irq.src.text).toMatch(/\n\s+lax var_092e/);
    expect(irq.src.text).toMatch(/\n\s+bne \*-\d+\s+; loop_08bc/);
    expect(pad(0x0949).src.text).toMatch(/^PET_RETURN = \$0d\n; txt_0949:\n\s+\.enc "none"\n\s+\.text "mimir studio demo    ", PET_RETURN/);
    expect(pad(0x3000).src.text.split('\n')[0]).toBe('; char $00');
  });
});

describe('a Kick Assembler script or patch moved to 64tass', () => {
  it('moves when it gives the same bytes, its scratchpad\'s start content too; else it says why and on which line', () => {
    const kick: UserScript = { id: 's', name: 's', lang: 'kickass', pads: [{ name: 'pad1', start: 0xc800, size: 16, src: { form: 'asm', text: '// key\n.byte $5a, data & $ff' } }],
      source: '// decrypt into pad1\n.const N = 16\nstart:  ldx #0\n!:      lda data,x\n        eor pad1\n        sta.abs pad1,x\n        inx\n        cpx #N\n        bne !-\n        rts\n' };
    const r = scriptIn64tass(env, kick);
    expect('source' in r && r.source).toBe('; decrypt into pad1\nN        = 16\nstart:  ldx #0\n-\n+       lda data,x\n        eor pad1\n        sta @w pad1,x\n        inx\n        cpx #N\n        bne -\n        rts\n');
    // (a statement at the left edge is indented: 64tass would read a word there as a label)
    expect('pads' in r && r.pads[0].src).toEqual({ form: 'asm', text: '; key\n        .byte $5a, data & $ff' });
    const moved = { ...kick, ...(r as { source: string; pads: UserScript['pads'] }), lang: '64tass' as const };
    expect(runScript(env, moved).mem.slice(0x0830, 0x0840)).toEqual(runScript(env, kick).mem.slice(0x0830, 0x0840));
    expect(scriptIn64tass(env, { ...kick, source: '.for (var i = 0; i < 2; i++) {\n nop\n}\n rts\n' })).toMatchObject({ line: 1, error: expect.stringContaining('.for') });
    expect(scriptIn64tass(env, { ...kick, source: ' lda nothing\n rts' })).toMatchObject({ error: expect.stringContaining('Kick Assembler first') });
  });

  it('a patch: the same bytes over its range', () => {
    const p = project(), { A, R } = ctx(p);
    const req = { name: 'red', start: 0x080d, end: 0x0817, source: 'wait:   lda #$02      // red\n        sta VIC_BORDER_COLOR\n        jmp loop', fill: 'nop' as const, over: false };
    expect(patchIn64tass(A, R, p, req)).toEqual({ source: 'wait:   lda #$02      ; red\n        sta VIC_BORDER_COLOR\n        jmp loop' });
    expect(patchIn64tass(A, R, p, { ...req, source: ' lda #\'a\'' })).toMatchObject({ error: expect.stringContaining('character') });
  });
});

describe.skipIf(!tass)(`real 64tass with the user's code (${tass ?? 'not found'})`, () => {
  /** code assembled by the real 64tass at `pc` with the names defined before it, and by the built-in one */
  const both = async (dir: string, file: string, code: string, names: ReadonlyMap<string, number>, pc: number) => {
    // (the names the code defines itself are its own, as Mimir has them)
    const mine = definedNames(code, '64tass'), head = [...names].filter(([n]) => !mine.has(n)).map(([n, a]) => `${n} = $${h4(a)}`);
    await writeVfs(dir, { [file]: [...head, `* = $${h4(pc)}`, code].join('\n') });
    const run = await run64tass({ exe: tass!, cwd: dir, entry: file, outDir: 'out' });
    const own = assembleIn('64tass', { [file]: code }, file, { names, pc });
    return { run, own };
  };

  it('builds each script template as 64tass to the bytes of its Kick Assembler code', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mimir-tass-code-'));
    try {
      const names = new Map([['result', 0xc000], ['result_end', 0xc400]]);
      for (const t of SCRIPT_TEMPLATES) {
        const { run, own } = await both(dir, `${t.name}.asm`, templateSource(t, '64tass'), names, 0xc400);
        expect(run.ok, `${t.name}: ${run.output.split('\n').slice(-8).join(' / ')}`).toBe(true);
        const k = assemble({ 's.asm': t.source }, 's.asm', { names, pc: 0xc400 });
        expect([...run.prg!], t.name).toEqual([...makePrg(k.min, k.mem.subarray(k.min, k.max + 1))]);
        expect([...run.prg!], t.name).toEqual([...own.prg!]);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it('builds a patch\'s exported source, and a script\'s code, as the built-in one does', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mimir-tass-code-'));
    try {
      let p = project();
      const a = ok(plan(p, { name: 'red', start: 0x080d, end: 0x0817, source: 'wait\n        lda #$02\n        sta VIC_BORDER_COLOR\n_x      jmp _x' })).patch;
      p = { ...p, ...withPatch(p, a) };
      const { R } = ctx(p);
      await writeVfs(dir, { 'red.asm': patchSource(R, p.settings, a, 'fix.prg', '64tass') });
      const run = await run64tass({ exe: tass!, cwd: dir, entry: 'red.asm', outDir: 'out' });
      expect(run.ok, run.output).toBe(true);
      expect([...run.prg!]).toEqual([...makePrg(0x080d, a.bytes)]);
      const s = 'loop    lda data,x\n_l      eor #$5a\n        sta @w $02\n+       inx\n        bne loop\n        lax $10\n        rts\n';
      const { run: r2, own } = await both(dir, 's.asm', `.cpu "6502i"\n${s}`, env.names, 0xc000);
      expect(r2.ok, r2.output).toBe(true);
      expect([...r2.prg!]).toEqual([...own.prg!]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
