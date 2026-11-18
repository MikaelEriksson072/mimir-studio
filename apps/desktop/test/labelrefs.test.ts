import { describe, expect, it } from 'vitest';
import { analyze, assemble, parsePrg, render, type Addr, type ProjectInput } from '@mimir/core';
import { labelBefore, labelRefs, refLine, XREF_KIND, type LabelRef } from '../src/lib/labelrefs';

// a start that sets an IRQ vector with #< and #>, reads a table one byte on, writes a zero-page pointer and jumps
// through it, modifies its own code, calls a routine and jumps through a table of low and high bytes
const src = `.pc = $0801
.byte $0b,$08,$0a,$00,$9e,$32,$30,$36,$31,$00,$00,$00
.pc = $080d
start: sei
 lda #<irq
 sta $0314
 lda #>irq
 sta $0315
 cli
 lda tab+1
 sta $fb
 lda #>tab
 sta $fc
 inc smc+1
smc: lda $1234
 jsr sub
 jsr sub
 ldy #0
 lda ($fb),y
 ldx #1
 lda ptrlo,x
 sta $fd
 lda ptrhi,x
 sta $fe
 jmp ($00fd)
irq: inc $d020
 jmp $ea31
sub: rts
ptrlo: .byte <sub, <irq
ptrhi: .byte >sub, >irq
tab: .word irq, sub`;
const prg = assemble({ 'm.asm': src }, 'm.asm').prg!;
const p: ProjectInput = { files: [parsePrg('m.prg', prg)] };
const A = analyze(p), R = render(A, p);
const at = (name: string): Addr => [...R.labels].find(([, l]) => l.name === name)![0];
/** the references as `$0811 low byte lda #<irq_0830 (start+4)` */
const shown = (rs: LabelRef[]) => rs.map(r => `$${r.from.toString(16).padStart(4, '0')} ${XREF_KIND[r.kind]} ${r.line ? r.line.tok.map(t => t.s).join('') : '-'}${r.where ? ` (${r.where})` : ''}`);

describe("a label's references (the box beside a picked label)", () => {
  it('lists the calls, each in the code of the label before it, and the tables of its address', () => {
    expect(shown(labelRefs(A, R, at('sub_0847'), false))).toEqual([
      '$0828 call sub_0847 (smc_0825+3)',
      '$082b call sub_0847 (smc_0825+6)',
      '$0848 low byte <sub_0847, <irq_0841 (ptrlo_0848)',
      '$084a high byte >sub_0847, >irq_0841 (ptrhi_084a)',
    ]);
  });

  it('takes in the lines that only name it: the low and high byte of its address, in code and in data', () => {
    // (the analysis has no reference from `lda #<irq` to it: the IRQ vector is set by those two lines)
    const irq = at('irq_0841');
    expect(A.xrefs.get(irq) ?? []).toEqual([]);
    const rs = labelRefs(A, R, irq, false);
    expect(shown(rs)).toEqual([
      '$080e low byte #<irq_0841 (start+1)',
      '$0813 high byte #>irq_0841 (start+6)',
      '$0848 low byte <sub_0847, <irq_0841 (ptrlo_0848)',
      '$084a high byte >sub_0847, >irq_0841 (ptrhi_084a)',
    ]);
    expect(rs.map(r => r.line?.k)).toEqual(['ins', 'ins', 'dat', 'dat']);
  });

  it('names the start in the BASIC line', () => {
    const [r, ...rest] = labelRefs(A, R, at('start'), false);
    expect(rest).toEqual([]);
    expect(r.kind).toBe('name');
    expect(r.line?.k).toBe('dir');
    expect(shown([r])).toEqual(['$0801 named BasicUpstart2(start)']);
  });

  it('gives a line that names it with +n the kind of the reference to that byte (self-modified code)', () => {
    // `inc smc_0825+1` writes the operand of `lda $1234`: the reference is to $0826, the line names $0825
    expect(shown(labelRefs(A, R, at('smc_0825'), false))).toEqual(['$0822 read+write smc_0825+1 (start+21)']);
  });

  it("lists a zero-page variable's accesses, and a 16-bit one's high byte's too", () => {
    // $fb and $fc are variables of their own: $fb's are the store to it and the pointer read
    expect(shown(labelRefs(A, R, 0xfb, true))).toEqual(['$081c write ptr_fb (start+15)', '$0830 pointer (ptr_fb),y (smc_0825+11)']);
    // joined (Project.zpPairs), `sta ptr_fb+1` is the variable's too, and `lda (ptr_fb),y` (both bytes) is one row
    const p2: ProjectInput = { ...p, zpPairs: { 0xfb: true } }, A2 = analyze(p2), R2 = render(A2, p2);
    expect(R2.zp.get(0xfc)?.off).toBe(1);
    expect(shown(labelRefs(A2, R2, 0xfb, true))).toEqual(['$081c write ptr_fb (start+15)', '$0820 write ptr_fb+1 (start+19)', '$0830 pointer (ptr_fb),y (smc_0825+11)']);
  });

  it('finds the line an address is on: the one that starts there, or the one before that takes it in', () => {
    expect(refLine(R.lines, 0x080e)?.a).toBe(0x080e);
    // the operand of `lda #<irq_0841`, and the second byte of `.byte <sub_0847, <irq_0841`
    expect(refLine(R.lines, 0x080f)?.a).toBe(0x080e);
    expect(refLine(R.lines, 0x0849)?.a).toBe(0x0848);
    expect(refLine(R.lines, 0xc000)).toBeNull();
  });

  it('names where a byte is: the label at it, else the nearest before it in its block', () => {
    const start = at('start');
    expect(labelBefore(A, R.labels, start)).toBe('start');
    expect(labelBefore(A, R.labels, start + 3)).toBe('start+3');
    // the BASIC line's bytes have no label before them in their block
    expect(labelBefore(A, R.labels, 0x0805)).toBeNull();
  });

  it('has no references for a label nothing names', () => {
    expect(labelRefs(A, R, 0xc000, false)).toEqual([]);
  });
});
