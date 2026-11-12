/* Cycle timing the C64 shares with VICE 3.10 (x64sc), each case measured there with a test program: when the CPU
 * takes a raster IRQ, when a CIA timer started by a write begins to count, and in which cycle an indexed read across a
 * page reads I/O. Demos time their raster code by them (The Wild Bunch corrects its IRQ jitter with CIA timer A, and
 * taken a few cycles early it branches past the end of its delay into a JAM). */
import { describe, expect, it } from 'vitest';
import { C64 } from '../src/c64.ts';
import { standInRoms } from '../src/standin.ts';
import { asm } from './asm.ts';

/** a C64 with RAM everywhere but I/O ($01 = $35), the code in place, the CPU at `pc` */
function machine(source: string, pc: number): C64 {
  const m = new C64(standInRoms());
  const code = asm(source);
  m.ram.set(code.prg.subarray(2), code.prg[0] | (code.prg[1] << 8));
  m.write(0, 0x2f); m.write(1, 0x35);
  m.cpu.pc = pc;
  return m;
}

/** run n instructions, taking IRQs as the session does */
function run(m: C64, n: number): void {
  const cpu = m.cpu;
  for (let k = 0; k < n; k++) {
    const iWas = cpu.i;
    m.dmaWait();
    m.advance(cpu.step());
    if (m.irqDue() && !(cpu.lastOp === 0x40 ? cpu.i : iWas)) m.advance(cpu.irq());
  }
}

describe('raster IRQs', () => {
  /** a chain of `instr` from $c000, the raster IRQ for line 100 with the CPU starting at `cycle` of line 99: the low
   *  byte of the address the IRQ interrupted */
  const interrupted = (instr: string, cycle: number): number => {
    const m = machine(`
* = $c000
${Array(30).fill(instr).join('\n')}
       jmp *
* = $c100
irq:   pla
       pla
       sta $c200
       jmp *
* = $fffe
.word irq
`, 0xc000);
    m.vic.line = 99; m.vic.lineCycle = cycle; m.vic.compare = 100; m.vic.regs[0x1a] = 1;
    m.cpu.i = 0; m.cpu.z = 0;
    run(m, 40);
    return m.ram[0xc200];
  };

  it('are taken after the instruction whose next to last cycle saw the line go low', () => {
    // the line starts in the first cycle of the second NOP: after it
    expect(interrupted('nop', 61)).toBe(0x02);
    // in the last cycle of the first NOP: not yet, after the second
    expect(interrupted('nop', 62)).toBe(0x02);
    // in the last cycle of the second: after the third
    expect(interrupted('nop', 60)).toBe(0x03);
  });

  it('wait one instruction more after a taken branch that stays in its page', () => {
    // BNE *+2, three cycles: the line starts in the second cycle of the first branch, which polls in it as a
    // two-cycle instruction does: after the second branch
    expect(interrupted('bne *+2', 62)).toBe(0x04);
  });
});

describe('CIA timers', () => {
  /** timer A from latch 6 started by STA $DC0E with `start`, read with LDA $DC04 4, 8 and 12 cycles after the write */
  const reads = (start: number): number[] => {
    const m = machine(`
* = $c000
       lda #$06
       sta $dc04
       lda #$00
       sta $dc05
       lda #${start}
       sta $dc0e
       lda $dc04
       ldx $dc04
       ldy $dc04
       sta $c100
       stx $c101
       sty $c102
       jmp *
`, 0xc000);
    run(m, 20);
    return [...m.ram.subarray(0xc100, 0xc103)];
  };

  it('started count from the third cycle after the write, and a forced load from the fourth', () => {
    // never 0: the latch shows for two cycles instead
    expect(reads(0x01)).toEqual([4, 6, 3]);
    expect(reads(0x11)).toEqual([5, 1, 4]);
  });

  it('are read in the last cycle of an indexed read that crosses a page', () => {
    const m = machine(`
* = $c000
       ldx #$ff
       lda #$06
       sta $dc04
       lda #$00
       sta $dc05
       lda #$01
       sta $dc0e
       lda $db05,x
       sta $c100
       jmp *
`, 0xc000);
    run(m, 12);
    // five cycles after the write (four without the crossing)
    expect(m.ram[0xc100]).toBe(3);
  });
});
