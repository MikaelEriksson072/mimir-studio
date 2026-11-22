/* Scripts the analysis suggests (spec 10.3): the program's decryption loops found in its code, the template filled
 * in from one, and a routine called with the registers the program's own call sets. */
import { describe, expect, it } from 'vitest';
import { analyze, callScript, checkScript, createProject, cryptScript, cryptStepsText, cryptWhereText, findCryptLoops, runScript, type ScriptEnv } from '../src';
import { fromSource } from './helpers/programs';

const PLAIN = Array.from({ length: 40 }, (_, i) => (i * 13 + 7) & 0xff);
const bytes = (b: number[]) => `.byte ${b.join(', ')}`;
const program = fromSource('crypt.prg', [
  '.pc = $0810',
  'main:   lda #3', '        ldx #$20', '        jsr show', '        jsr xorit', '        jsr subit', '        jsr steps', '        jsr ptrit', '        jsr text', '        jsr copy', '        rts',
  // one EOR, in place, counting up to a number
  'xorit:  ldx #0',
  'l1:     lda data,x', '        eor #$5a', '        sta data,x', '        inx', '        cpx #40', '        bne l1', '        rts',
  // SBC from the top down to 0, to another place
  'subit:  ldy #39',
  'l2:     lda data2,y', '        sec', '        sbc #$55', '        sta out,y', '        dey', '        bpl l2', '        rts',
  // several steps
  'steps:  ldx #0',
  'l3:     lda data3,x', '        sec', '        sbc #$1b', '        eor #$aa', '        clc', '        adc #$07', '        sta data3,x', '        inx', '        cpx #40', '        bne l3', '        rts',
  // through a pointer
  'ptrit:  ldy #0',
  'l4:     lda ($fb),y', '        eor #$77', '        sta ($fb),y', '        iny', '        bne l4', '        rts',
  // text onto the screen with its codes shifted: no decryption
  'text:   ldx #0',
  'l5:     lda data,x', '        clc', '        adc #$40', '        sta $0400,x', '        inx', '        cpx #40', '        bne l5', '        rts',
  // a plain copy: nothing done to the bytes
  'copy:   ldx #0',
  'l6:     lda data,x', '        sta out,x', '        inx', '        cpx #40', '        bne l6', '        rts',
  'show:   sta $d020', '        stx $d021', '        rts',
  '.pc = $0900',
  `data:   ${bytes(PLAIN.map(b => b ^ 0x5a))}`,
  `data2:  ${bytes(PLAIN.map(b => (b + 0x55) & 0xff))}`,
  `data3:  ${bytes(PLAIN.map(b => ((((b - 0x07) & 0xff) ^ 0xaa) + 0x1b) & 0xff))}`,
  'out:    .fill 40, 0',
].join('\n'));
const A = analyze(createProject({ files: [program] }));
const env: ScriptEnv = { files: [program], names: new Map([['data', 0x0900]]) };
const DATA = 0x0900, DATA2 = DATA + 40, DATA3 = DATA + 80, OUT = DATA + 120;
const hex = (a: number) => `$${a.toString(16).padStart(4, '0')}`;
/** the routine that starts with these bytes */
const routine = (...b: number[]) => { for (let a = 0x0810; a < 0x0900; a++) if (b.every((v, k) => A.mem[a + k] === v)) return a; throw new Error('no such routine'); };

describe('the program\'s decryption loops', () => {
  const loops = findCryptLoops(A);

  it('are found with their method, their key and, by an address, where the bytes are and how many', () => {
    expect(loops.map(l => cryptStepsText(l.steps))).toEqual(['EOR #$5a', 'SBC #$55', 'SBC #$1b, EOR #$aa, ADC #$07', 'EOR #$77']);
    expect(loops[0]).toMatchObject({ source: DATA, dest: DATA, length: 40, text: 'lda $0900,x / eor #$5a / sta $0900,x' });
    expect(cryptWhereText(loops[0])).toBe('40 bytes at $0900, in place');
    // from the top down to 0 with BPL: the same 40 bytes
    expect(loops[1]).toMatchObject({ source: DATA2, dest: OUT, length: 40 });
    expect(cryptWhereText(loops[1])).toBe(`40 bytes at ${hex(DATA2)}, written to ${hex(OUT)}`);
    expect(loops[2]).toMatchObject({ source: DATA3, dest: DATA3, length: 40 });
    // through a pointer: the method and the key, not where
    expect(loops[3]).toMatchObject({ source: null, length: null, ptr: { src: 0xfb, dst: 0xfb } });
    expect(cryptWhereText(loops[3])).toContain('through the pointer at $fb, in place');
    for (const l of loops) expect(l.end).toBeGreaterThan(l.start);
  });

  it('are not text put on the screen or a plain copy', () => {
    expect(loops).toHaveLength(4);
    expect(loops.some(l => l.dest != null && l.dest >= 0x0400 && l.dest < 0x0800)).toBe(false);
  });

  it('give a template with its settings filled in, which decrypts into the scratchpad result and leaves the program as it is', () => {
    const run = (i: number, nameOf: (a: number) => string | null = () => null) => {
      const s = cryptScript(loops[i], nameOf);
      const script = { source: s.source, lang: 'kickass' as const, pads: s.pads.map(q => ({ ...q, start: 0xc000 })) };
      const c = checkScript(env, script);
      expect(c.problems.filter(x => x.level === 'error')).toEqual([]);
      const r = runScript(env, script, c);
      expect(r.end).toBe('rts');
      expect(r.changes).toEqual([]);
      return { s, bytes: [...r.pads[0].bytes] };
    };
    const xor = run(0, a => (a === 0x0900 ? 'data' : null));
    expect(xor.s).toMatchObject({ template: 'xor_key', placed: true, pads: [{ name: 'result', size: 40 }] });
    expect(xor.s.source).toContain('.var source  = data ');
    expect(xor.s.source).toContain('.var length  = $0028 ');
    expect(xor.s.source).toContain('.var key     = $5a ');
    expect(xor.s.source).toContain('// Found in the program: the loop at $');
    expect(xor.bytes).toEqual(PLAIN);
    const sub = run(1);
    expect(sub.s.template).toBe('add_key');
    expect(sub.s.source).toContain(`.var source  = ${hex(DATA2)} `);
    expect(sub.bytes).toEqual(PLAIN);
    const steps = run(2);
    expect(steps.s.template).toBe('steps');
    expect(steps.s.source).toMatch(/\.var step3\s+= ADD /);
    expect(steps.s.source).toMatch(/\.var step4\s+= NONE /);
    expect(steps.bytes).toEqual(PLAIN);
    // a loop through a pointer: the key is set, where and how many is left to set
    const ptr = cryptScript(loops[3]);
    expect(ptr).toMatchObject({ template: 'xor_key', placed: false });
    expect(ptr.source).toContain('.var key     = $77 ');
    expect(ptr.source).toContain('Set source and length');
    expect(ptr.source).toContain('.var source  = $0801 ');
  });

  it('give the same script in 64tass', () => {
    const s = cryptScript(loops[0], () => null, '64tass');
    const script = { source: s.source, lang: '64tass' as const, pads: s.pads.map(q => ({ ...q, start: 0xc000 })) };
    const c = checkScript(env, script);
    expect(c.problems.filter(x => x.level === 'error')).toEqual([]);
    expect([...runScript(env, script, c).pads[0].bytes]).toEqual(PLAIN);
  });
});

describe('a script that calls a routine', () => {
  it('has the registers the program\'s own call loads before its JSR as its init', () => {
    // show: sta $d020
    const c = callScript(A, routine(0x8d, 0x20, 0xd0), 'show');
    expect(c.line).toBe('        jsr show');
    expect(c.init).toEqual({ a: 3, x: 0x20 });
    expect(c.from).toBe(0x0814);
    expect(c.comment).toBe('calls show as the program does at $0814: A = $03, X = $20 (Init)');
  });

  it('says so when the call sets none, or when nothing calls it', () => {
    // xorit: ldx #0 / lda data,x
    const c = callScript(A, routine(0xa2, 0x00, 0xbd, 0x00, 0x09), 'xorit');
    expect(c.init).toBeNull();
    expect(c.comment).toMatch(/^calls xorit, as the program does at \$[0-9a-f]{4}; A, X and Y are set under Init$/);
    expect(callScript(A, 0x0810, 'main')).toMatchObject({ init: null, from: null, comment: 'calls main; A, X and Y are set under Init' });
  });
});
