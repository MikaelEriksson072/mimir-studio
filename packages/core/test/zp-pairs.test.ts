/* Two zero-page bytes the user joins into one 16-bit variable (Project.zpPairs): the source writes the high byte
 * `name+1`, and a pointer the analysis found can be split into two variables again. */
import { describe, expect, it } from 'vitest';
import { analyze, applyZpPairs, deserializeProject, render, serializeProject, verify, createProject, type ProjectInput, type ZpVar } from '../src';
import { fromSource } from './helpers/programs';

// lo/hi tables stored to $bd/$be, the two used one by one: the analysis keeps them apart; $fb/$fc a pointer `jmp ($fb)`
// goes through, which the analysis joins
const SRC = `
.pc = $1000 "Code"
start:  ldy #2
        lda lo,y
        sta $bd
        lda hi,y
        sta $be
        lda $bd
        sta $d020
        lda $be
        sta $d021
        lda #0
        sta $fb
        lda #$04
        sta $fc
        lda ($fb),y
        sta $fd
        jmp ($fb)
lo:     .byte $10, $20, $30, $40
hi:     .byte $90, $a0, $b0, $c0
`;
const file = fromSource('pairs.prg', SRC);
const project = (p: Partial<ProjectInput> = {}): ProjectInput => ({ name: 'pairs', files: [file], overrides: [], labels: {}, comments: {}, settings: {}, ...p });
const operands = (R: ReturnType<typeof render>) => R.lines.filter(l => l.k === 'ins' && l.a >= 0x1000 && l.a < 0x1100).map(l => `${l.k === 'ins' ? l.mn : ''} ${(l as { tok: { s: string }[] }).tok.map(t => t.s).join('')}`.trim().toLowerCase());
const zpLabels = (R: ReturnType<typeof render>) => R.lines.filter(l => l.k === 'dir' && l.zp != null).map(l => (l as { tok: { s: string }[] }).tok.map(t => t.s).join(''));

describe('zero-page pairs the user sets', () => {
  it('without one, $bd and $be are two variables and $fb/$fc a pointer', () => {
    const p = project(), A = analyze(p), R = render(A, p);
    expect(operands(R)).toEqual(expect.arrayContaining(['sta zp_bd', 'sta zp_be', 'sta ptr_fb', 'sta ptr_fb+1']));
    expect(zpLabels(R)).toEqual(expect.arrayContaining(['.label zp_bd = $bd', '.label zp_be = $be']));
  });

  it('joins $bd (low byte) and $be (high byte): the high byte is name+1 and has no .label of its own', () => {
    const p = project({ zpPairs: { 0xbd: true } }), A = analyze(p), R = render(A, p);
    expect(operands(R)).toEqual(expect.arrayContaining(['sta zp_bd', 'sta zp_bd+1', 'lda zp_bd', 'lda zp_bd+1']));
    expect(operands(R).some(o => o.includes('zp_be'))).toBe(false);
    expect(zpLabels(R)).toContain('.label zp_bd = $bd');
    expect(zpLabels(R).some(l => l.includes('$be'))).toBe(false);
    expect(R.zp.get(0xbe)).toMatchObject({ name: 'zp_bd', off: 1 });
    expect(verify(A, R).ok).toBe(true);
  });

  it('the high byte follows the name the user gives the low byte', () => {
    const p = project({ zpPairs: { 0xbd: true }, labels: { 0xbd: 'scroll', 0xbe: 'unused' } }), A = analyze(p), R = render(A, p);
    expect(operands(R)).toEqual(expect.arrayContaining(['sta scroll', 'sta scroll+1']));
    expect(verify(A, R).ok).toBe(true);
  });

  it('splits a pointer the analysis found into two variables', () => {
    const p = project({ zpPairs: { 0xfb: false } }), A = analyze(p), R = render(A, p);
    expect(operands(R)).toEqual(expect.arrayContaining(['sta ptr_fb', 'sta zp_fc']));
    expect(zpLabels(R)).toContain('.label zp_fc = $fc');
    expect(verify(A, R).ok).toBe(true);
  });

  it('a pair the user sets takes its bytes from the pairs around it', () => {
    const zp = new Map<number, ZpVar>([
      [0xfb, { name: 'ptr_fb', ptr: true }], [0xfc, { name: 'ptr_fb', ptr: true, off: 1 }],
      [0xfd, { name: 'ptr_fd', ptr: true }], [0xfe, { name: 'ptr_fd', ptr: true, off: 1 }],
    ]);
    applyZpPairs(zp, { 0xfc: true, 0xfd: true });
    expect(Object.fromEntries(zp)).toEqual({
      0xfb: { name: 'ptr_fb', ptr: true },
      0xfc: { name: 'zp_fc', ptr: true },
      0xfd: { name: 'zp_fc', ptr: true, off: 1 },
      // the one at $fd lost its low byte to the pair before it
      0xfe: { name: 'zp_fe' },
    });
  });

  it('leaves out what is no zero-page pair: the 6510 port, $ff and loaded bytes', () => {
    const zp = new Map<number, ZpVar>([[0x00, { name: 'a' }], [0x01, { name: 'b' }], [0xff, { name: 'c' }], [0x40, { name: 'd' }], [0x41, { name: 'e' }]]);
    applyZpPairs(zp, { 0x00: true, 0xff: true, 0x40: true }, a => a !== 0x41);
    expect(Object.fromEntries(zp)).toEqual({ 0x00: { name: 'a' }, 0x01: { name: 'b' }, 0xff: { name: 'c' }, 0x40: { name: 'd' }, 0x41: { name: 'e' } });
  });

  it('is saved with the project, and left out when there is none', () => {
    const p = createProject({ files: [file] });
    expect('zpPairs' in serializeProject(p)).toBe(false);
    const s = serializeProject({ ...p, zpPairs: { 0xbd: true, 0xfb: false } });
    expect(JSON.parse(JSON.stringify(s)).zpPairs).toEqual({ 189: true, 251: false });
    expect(deserializeProject(JSON.parse(JSON.stringify(s))).zpPairs).toEqual({ 189: true, 251: false });
  });
});
