import { describe, expect, it } from 'vitest';
import { analyze, makeDemo, parsePrg, render, type ListingLine, type ProjectInput } from '@mimir/core';
import { cellsOf } from '../src/lib/cells';
import { operandName, renameText } from '../src/lib/rename';

const demo = (labels: Record<number, string> = {}): ProjectInput => {
  const d = makeDemo();
  return { name: 'raster-demo', files: [parsePrg(d.name, d.prg)], overrides: [], labels, comments: {}, settings: {} };
};

describe('the label a line\'s operand names (Shift+N, the context menu)', () => {
  const p = demo(), A = analyze(p), R = render(A, p);
  const line = (a: number, k: ListingLine['k'] = 'ins'): ListingLine => R.lines.find(l => l.a === a && l.k === k)!;

  it('is the label of an instruction\'s operand, not the line\'s own', () => {
    // loop_08bc: lda colors_0939,y
    expect(R.labels.get(0x08bc)?.name).toBe('loop_08bc');
    expect(operandName(line(0x08bc), R)).toEqual({ addr: 0x0939, zp: false, name: 'colors_0939' });
    expect(operandName(line(0x08da), R)).toEqual({ addr: 0x092d, zp: false, name: 'var_092d' });
  });

  it('is the label itself in label+offset and in an immediate low or high byte', () => {
    // inc smc_08ef+1
    expect(operandName(line(0x08f4), R)).toEqual({ addr: 0x08ef, zp: false, name: 'smc_08ef' });
    // lda #<irq_08b7
    expect(operandName(line(0x0839), R)).toEqual({ addr: 0x08b7, zp: false, name: 'irq_08b7' });
  });

  it('is the zero-page variable, also through its high byte and as a pointer', () => {
    const ptr = { addr: 0xfb, zp: true, name: 'ptr_fb' };
    expect(operandName(line(0x0903), R)).toEqual(ptr); // sta ptr_fb
    expect(operandName(line(0x0908), R)).toEqual(ptr); // sta ptr_fb+1
    expect(operandName(line(0x0916), R)).toEqual(ptr); // jmp (ptr_fb)
  });

  it('is none for hardware names, numbers and lines without an operand', () => {
    expect(operandName(line(0x091e), R)).toBeNull(); // lda SID_OSC3
    expect(operandName(R.lines.find(l => l.k === 'ins' && l.mn === 'RTS'), R)).toBeNull();
    expect(operandName(line(0x08bc, 'lbl'), R)).toBeNull();
    expect(operandName(null, R)).toBeNull();
  });

  it('is in a data line the clicked byte\'s, and the line\'s only when it names one', () => {
    // .byte <fx_0919, <fx_091a, <fx_091e, <fx_0927
    const lo = line(0x0931, 'dat'), cells = cellsOf(lo)!;
    expect(cells).toHaveLength(4);
    expect(operandName(lo, R)).toBeNull();
    expect(operandName(lo, R, cells[2])).toEqual({ addr: 0x091e, zp: false, name: 'fx_091e' });
    expect(operandName(lo, R, cells[0])).toEqual({ addr: 0x0919, zp: false, name: 'fx_0919' });
  });

  it('follows a rename: the token writes the new name and still names the label', () => {
    const q = demo({ 0x0939: 'raster_colors', 0xfb: 'fx_ptr' }), B = analyze(q), S = render(B, q);
    const at = (a: number) => S.lines.find(l => l.a === a && l.k === 'ins')!;
    expect(operandName(at(0x08bc), S)).toEqual({ addr: 0x0939, zp: false, name: 'raster_colors' });
    expect(operandName(at(0x0908), S)).toEqual({ addr: 0xfb, zp: true, name: 'fx_ptr' });
  });

  it('a token that does not write the label\'s own name is not taken for it', () => {
    const l = line(0x08bc);
    const other = { ...R, labels: new Map([...R.labels].map(([a, x]) => [a, a === 0x0939 ? { ...x, name: 'renamed_since' } : x])) };
    expect(operandName(l, other)).toBeNull();
  });
});

describe('what a rename item of the context menu says', () => {
  it('names the label or zero-page variable it renames', () => {
    expect(renameText({ addr: 0x0450, zp: false, name: 'smc_0450' }, 0x0450)).toBe('Rename smc_0450…');
    expect(renameText({ addr: 0x3000, zp: false, name: 'l_3000' }, 0x3000)).toBe('Rename l_3000…');
    expect(renameText({ addr: 0xfb, zp: true, name: 'ptr_fb' }, 0xfb)).toBe('Rename zero-page variable ptr_fb…');
  });

  it('on a line without a label of its own: the address it names', () => {
    expect(renameText(null, 0x0453)).toBe('Add label at $0453…');
    expect(renameText(null, null)).toBe('Rename label…');
  });
});
