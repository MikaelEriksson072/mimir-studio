/* Cycle timing the C64 shares with VICE 3.10 (x64sc), each case measured there with a test program: when the CPU
 * takes a raster IRQ, a CIA interrupt or an NMI, when a CIA timer started by a write begins to count, in which cycle an
 * indexed read across a page reads I/O, and which cycles the VIC takes from the CPU for badlines (also made or undone
 * in the middle of a line) and sprites. Demos time their raster code by them (The Wild Bunch corrects its IRQ jitter
 * with CIA timer A, and taken a few cycles early it branches past the end of its delay into a JAM). */
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

/** run n instructions, taking IRQs and NMIs as the session does */
function run(m: C64, n: number): void {
  const cpu = m.cpu;
  for (let k = 0; k < n; k++) {
    const iWas = cpu.i;
    m.dmaWait();
    m.advance(cpu.step());
    if (m.irqDue() && !(cpu.lastOp === 0x40 ? cpu.i : iWas)) m.advance(m.takeIrq());
    if (m.nmiDue()) m.advance(m.takeNmi());
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

describe('CIA interrupts', () => {
  /**
   * CIA 1's timer A (an IRQ) or CIA 2's (an NMI), one-shot from latch 4, 5 ... 11, started by STA $DC0E/$DD0E right
   * before a chain of `instr` (or, `enable`, run out first and let through by STA $DC0D/$DD0D before NOPs): for each
   * latch where the interrupt came, as the offset in the chain of the address it returned to. With a BASIC line
   * (SYS 49152) in front, the same program gave the same eight offsets in VICE 3.10 (x64sc) for each case below.
   */
  const offsets = (kind: 'irq' | 'nmi', instr: string, enable = false): number[] => {
    const cia = kind === 'irq' ? '$dc' : '$dd';
    const start = enable
      ? `       lda #$19
       sta ${cia}0e
${'       nop\n'.repeat(12)}       tsx
       stx savesp
       lda #$81
       ${kind === 'irq' ? 'cli' : 'nop'}
       sta ${cia}0d`
      : `       lda #$81
       sta ${cia}0d
       tsx
       stx savesp
       lda #$19
       ${kind === 'irq' ? 'cli' : 'nop'}
       sta ${cia}0e`;
    const m = machine(`
* = $c000
       sei
       lda #$7f
       sta $dc0d
       sta $dd0d
       lda #$00
       sta $dc0e
       sta $dd0e
       lda #$35
       sta $01
       lda #$0b
       sta $d011
wait:  lda $d012
       cmp #$fa
       bne wait
       lda #<handler
       sta $fffa
       sta $fffe
       lda #>handler
       sta $fffb
       sta $ffff
       ldx #$00
loop:  stx cur
       lda #$7f
       sta ${cia}0d
       lda ${cia}0d
       txa
       clc
       adc #$04
       sta ${cia}04
       lda #$00
       sta ${cia}05
${start}
chain:
${`       ${instr}\n`.repeat(enable ? 8 : 24)}       jmp *
handler: tsx
       lda $0102,x
       sec
       sbc #<chain
       ldx cur
       sta $c800,x
       lda ${cia}0d
       ldx savesp
       txs
       ldx cur
       inx
       cpx #$08
       beq done
       jmp loop
done:  jmp done
cur:   .byte 0
savesp: .byte 0
`, 0xc000);
    // (the wait for line $fa takes about 6000 instructions; then it ends at done: jmp done)
    run(m, 20000);
    return [...m.ram.subarray(0xc800, 0xc808)];
  };

  it('are taken after the instruction that ends two cycles or more after the underflow, as raster IRQs', () => {
    // NOP: a timer that runs out in an instruction's last cycle waits for the next (one latch more, one NOP later)
    expect(offsets('irq', 'nop')).toEqual([4, 5, 5, 6, 6, 7, 7, 8]);
    expect(offsets('irq', 'bit $c700')).toEqual([6, 9, 9, 9, 9, 12, 12, 12]);
    // a taken branch that stays in its page: one cycle more
    expect(offsets('irq', 'bne *+2')).toEqual([6, 8, 8, 8, 10, 10, 10, 12]);
  });

  it('give NMIs the same timing: the 6510 takes the edge as it takes an IRQ', () => {
    // (Continuum, Triad 2014: its NMI handler jumps through CIA 1's timer B to code for the cycle it came in; an NMI
    // one cycle early read a value it has no code for)
    expect(offsets('nmi', 'nop')).toEqual([4, 5, 5, 6, 6, 7, 7, 8]);
    expect(offsets('nmi', 'inc $c700')).toEqual([6, 6, 6, 6, 6, 9, 9, 9]);
    expect(offsets('nmi', 'bne *+2')).toEqual([6, 8, 8, 8, 10, 10, 10, 12]);
  });

  it('let through by a write come after the next instruction: the write pulls the line low in its last cycle', () => {
    expect(offsets('irq', 'nop', true)).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);
    expect(offsets('nmi', 'nop', true)).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);
  });

  /**
   * Timer B counting timer A's underflows (latch 0, so it runs out with timer A's one underflow), its interrupt let
   * through, timer A one-shot from latch 4, 5 ... 11 started right before NOPs: the offset in them the interrupt
   * returned to. The same program gave the same in VICE 3.10.
   */
  const counted = (kind: 'irq' | 'nmi'): number[] => {
    const cia = kind === 'irq' ? '$dc' : '$dd';
    const m = machine(`
* = $c000
       sei
       lda #$7f
       sta $dc0d
       sta $dd0d
       lda #$00
       sta $dc0e
       sta $dc0f
       sta $dd0e
       sta $dd0f
       lda $dc0d
       lda $dd0d
       lda #<handler
       sta $fffa
       sta $fffe
       lda #>handler
       sta $fffb
       sta $ffff
       ldx #$00
loop:  stx cur
       lda #$00
       sta ${cia}0e
       sta ${cia}0f
       lda #$7f
       sta ${cia}0d
       lda ${cia}0d
       txa
       clc
       adc #$04
       sta ${cia}04
       lda #$00
       sta ${cia}05
       sta ${cia}06
       sta ${cia}07
       lda #$82
       sta ${cia}0d
       lda #$51
       sta ${cia}0f
       tsx
       stx savesp
       ldx #$00
       lda #$19
       ${kind === 'irq' ? 'cli' : 'nop'}
       sta ${cia}0e
chain:
${'       nop\n'.repeat(24)}       jmp *
handler: tsx
       lda $0102,x
       sec
       sbc #<chain
       ldx cur
       sta $c800,x
       lda ${cia}0d
       ldx savesp
       txs
       ldx cur
       inx
       cpx #$08
       beq done
       jmp loop
done:  jmp done
cur:   .byte 0
savesp: .byte 0
`, 0xc000);
    run(m, 4000);
    return [...m.ram.subarray(0xc800, 0xc808)];
  };

  it('come a cycle later from timer B counting timer A\'s underflows: it sees each a cycle late', () => {
    // (Dame Kitty and the Mushrooms and SSDPCM1 Super play samples from such an NMI: two lines, 126 cycles, apart)
    expect(counted('nmi')).toEqual([5, 5, 6, 6, 7, 7, 8, 8]);
    expect(counted('irq')).toEqual([5, 5, 6, 6, 7, 7, 8, 8]);
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

describe('the VIC taking the bus', () => {
  /**
   * A cycle-exact raster sync (a double IRQ on lines $7e and $7f, stable in cycle 3 of line $80, as Continuum's), CIA 1
   * timer A started there, a delay of xi + 3 cycles (a CMP #$C9 slide entered xi bytes from its end), then `probe`,
   * which reads the timer: for xi = 0, 1 ... count-1 the cycles the CPU lost, as runs "from-to:cycles". With a BASIC
   * line (SYS 49152) in front, the same program gave the same runs in VICE 3.10 (x64sc) for every case below.
   */
  const lost = (count: number, setup: string, probe: string, restore = '', base = 13): string => {
    const code = asm(`
* = $c000
       sei
       lda #$7f
       sta $dc0d
       sta $dd0d
       lda $dc0d
       lda $dd0d
       lda #$00
       sta $dc0e
       sta $dc0f
       sta $dd0e
       sta $d015
       sta $d017
       lda #$35
       sta $01
       lda #$1b
       sta $d011
${setup}
       lda #$ff
       sta $dc04
       sta $dc05
       lda #<irq1
       sta $fffe
       lda #>irq1
       sta $ffff
       lda #$01
       sta $d01a
       lda #$00
       sta xi
next:  sec
       lda #<slend
       sbc xi
       sta vec
       lda #>slend
       sbc #$00
       sta vec+1
       lda #$7e
       sta $d012
       lda #$00
       sta flag
       lda #$ff
       sta $d019
       cli
wt:    lda flag
       beq wt
       sei
       inc xi
       lda xi
       cmp #${count}
       bne next
done:  jmp done
irq1:  lda #<irq2
       sta $fffe
       lda #>irq2
       sta $ffff
       inc $d012
       inc $d019
       tsx
       cli
${'       nop\n'.repeat(14)}irq2:  txs
       lda #<irq1
       sta $fffe
       lda #>irq1
       sta $ffff
       ldx #$05
d1:    dex
       bne d1
       cmp ($00,x)
       lda $d012
       cmp $d012
       beq st
st:    lda #$11
       sta $dc0e
       lda #$00
       ldx #$00
       jmp (vec)
.fill ${count + 2}, $c9
slend: .byte $c5, $ea
${probe}
       ldx xi
       sta $c800,x
${restore}
       lda #$ff
       sta $d019
       lda #$01
       sta flag
       rti
xi:    .byte 0
flag:  .byte 0
vec:   .word 0
`);
    const m = new C64(standInRoms());
    m.ram.set(code.prg.subarray(2), 0xc000);
    m.write(0, 0x2f); m.write(1, 0x37);
    m.cpu.pc = 0xc000;
    for (let k = 0; k < 4_000_000 && m.cpu.pc !== code.labels.done; k++) run(m, 1);
    expect(m.cpu.pc).toBe(code.labels.done);
    const cycles = [...m.ram.subarray(0xc800, 0xc800 + count)].map((v, xi) => ((255 - v - base - xi) % 256 + 256) % 256);
    const runs: string[] = [];
    for (let i = 0; i < count;) {
      let j = i;
      while (j + 1 < count && cycles[j + 1] === cycles[i]) j++;
      runs.push(`${i === j ? i : `${i}-${j}`}:${cycles[i]}`);
      i = j + 1;
    }
    return runs.join(' ');
  };
  /** sprites `on` at Y `y` (and Y-expanded `expand`) */
  const sprites = (on: number, y: number, expand = 0) => `
       lda #${y}
${[1, 3, 5, 7, 9, 11, 13, 15].map(r => `       sta $d0${r.toString(16).padStart(2, '0')}`).join('\n')}
       lda #${expand}
       sta $d017
       lda #${on}
       sta $d015`;
  const read = '       lda $dc04';
  /** runs of one each, from `top` cycles down: "48:42 49:41 ..." */
  const fall = (from: number, top: number, n: number) => Array.from({ length: n }, (_, k) => `${from + k}:${top - k}`).join(' ');

  it('takes a badline that a $d011 write makes in the middle of the line: the CPU stops at its next read until cycle 54', () => {
    // (xi - 37 is the write's cycle in line $81) written in cycles 7-10, BA goes low in 11 and the read after it waits 43
    // cycles; written in 11-52, the read waits from the next cycle on, one cycle less each
    expect(lost(112, '', '       lda #$19\n       sta $d011\n' + read, '       lda #$1b\n       sta $d011', 19))
      .toBe(`0-43:0 44-47:43 ${fall(48, 42, 42)} 90-111:0`);
  });

  it('gives up a badline whose YSCROLL a write changes before cycle 11, and makes the next line one', () => {
    // (xi - 163 is the write's cycle in line $83, YSCROLL 3) written up to cycle 11, there is no badline; later the
    // badline holds the write back, and YSCROLL 4 written in line $84 makes that one a badline in the middle of the line
    expect(lost(240, '', '       lda #$1c\n       sta $d011\n' + read, '       lda #$1b\n       sta $d011', 19))
      .toBe(`0-174:0 175-189:43 190-193:86 ${fall(194, 85, 42)} 236-239:43`);
  });

  it('takes the cycles of each sprite fetch and the three before it', () => {
    expect(lost(64, '', read)).toBe('0-63:0');
    // sprite 0 fetches in cycles 57-58 of line $80 (BA from 54), sprite 3 in 0-1 of $81 (from 60), sprite 7 in 8-9
    expect(lost(64, sprites(0x01, 0x80), read)).toBe('0-29:0 30-63:5');
    expect(lost(64, sprites(0x08, 0x80), read)).toBe('0-35:0 36-63:5');
    expect(lost(64, sprites(0x80, 0x80), read)).toBe('0-43:0 44-63:5');
    expect(lost(64, sprites(0x05, 0x80), read)).toBe('0-29:0 30-63:9');
    expect(lost(64, sprites(0xff, 0x80), read)).toBe('0-29:0 30-63:19');
    // a write goes on while BA is low: STA's write in cycle 54 loses nothing, the LDA after it 18 cycles
    expect(lost(64, sprites(0xff, 0x80), '       sta $c900\n' + read, '', 17)).toBe('0-25:0 26-29:19 30:18 31-63:19');
  });

  it('fetches a sprite for 21 lines from the one its Y matches, 42 when it is Y-expanded', () => {
    expect(lost(64, sprites(0x80, 0x6c), read)).toBe('0-36:0 37-63:5');
    expect(lost(64, sprites(0x80, 0x6b), read)).toBe('0-63:0');
    expect(lost(64, sprites(0x80, 0x57, 0x80), read)).toBe('0-36:0 37-63:5');
    expect(lost(64, sprites(0x80, 0x56, 0x80), read)).toBe('0-63:0');
  });

  it('knows how many cycles the next instruction takes, a page crossing and a taken branch included', () => {
    let seed = 1;
    const rnd = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) >>> 8) & 0xff;
    const m = new C64(standInRoms());
    m.write(0, 0x2f); m.write(1, 0x34);
    for (let k = 0; k < 20000; k++) {
      const op = k & 0xff, pc = 0x2000 + (k & 0x0fff) * 3;
      m.ram[pc] = op; m.ram[pc + 1] = rnd(); m.ram[pc + 2] = rnd();
      for (let z = 2; z < 256; z++) m.ram[z] = rnd();
      const c = m.cpu;
      c.pc = pc; c.x = rnd(); c.y = rnd(); c.p = rnd(); c.s = 0x80; c.jammed = false;
      const want = m.nextCycles(op), got = c.step();
      if (!c.jammed) expect(got, `opcode $${op.toString(16)}`).toBe(want);
    }
  });
});

describe('code and pointers in I/O', () => {
  /** the program from $c000 run until done: the bytes it left at $c800 */
  const bytesOf = (source: string, count: number): number[] => {
    const code = asm(source);
    const m = new C64(standInRoms());
    m.ram.set(code.prg.subarray(2), code.prg[0] | (code.prg[1] << 8));
    m.write(0, 0x2f); m.write(1, 0x37);
    m.cpu.pc = 0xc000;
    for (let k = 0; k < 2_000_000 && m.cpu.pc !== code.labels.done; k++) run(m, 1);
    expect(m.cpu.pc).toBe(code.labels.done);
    return [...m.ram.subarray(0xc800, 0xc800 + count)];
  };

  /**
   * CIA 1's timer started xi + 3 cycles before the jump: 'fetch' runs JMP $dc05 with timer A's high byte $4c (JMP abs),
   * so it jumps to timer B's value fetched as its operand; 'pointer' runs JMP ($dc04) from RAM and jumps to timer A's
   * value. Either lands in an INX slide at $c200-$c2ef: X tells the value read. VICE 3.10 gave the same.
   */
  const jumps = (kind: 'fetch' | 'pointer') => bytesOf(`
* = $c000
       sei
       lda #$7f
       sta $dc0d
       lda $dc0d
       lda #$35
       sta $01
       lda #$0b
       sta $d011
wt0:   lda $d012
       cmp #$fa
       bne wt0
       lda #$00
       sta $dc0e
       sta $dc0f
       sta xi
loop:  sec
       lda #<slend
       sbc xi
       sta vec
       lda #>slend
       sbc #$00
       sta vec+1
${kind === 'fetch' ? `       lda #$00
       sta $dc0e
       lda #$00
       sta $dc04
       lda #$4c
       sta $dc05
       lda #$e0
       sta $dc06
       lda #$c2
       sta $dc07
       ldx #$00
       lda #$11
       sta $dc0f` : `       lda #$e0
       sta $dc04
       lda #$c2
       sta $dc05
       ldx #$00
       lda #$11
       sta $dc0e`}
       jmp (vec)
.fill 26, $c9
slend: .byte $c5, $ea
       jmp ${kind === 'fetch' ? '$dc05' : '($dc04)'}
land:  txa
       ldx xi
       sta $c800,x
       inc xi
       lda xi
       cmp #24
       beq done
       jmp loop
done:  jmp done
xi:    .byte 0
vec:   .word 0
* = $c200
.fill $f0, $e8
       jmp land
`, 24);

  it('fetches an opcode and its operands from I/O in their own cycles, 1 and 2 for the operand bytes', () => {
    // (Rust, Onslaught 2013, points its IRQ vector at $dc05: JMP (ind) through timer B's value, by the cycle it came in)
    expect(jumps('fetch')).toEqual(Array.from({ length: 24 }, (_, xi) => xi + 26));
  });

  it('reads an indirect jump\'s pointer in its cycles 3 and 4', () => {
    expect(jumps('pointer')).toEqual(Array.from({ length: 24 }, (_, xi) => xi + 25));
  });

  /** with CIA 1's timer B interrupt pending, an RTI to `back` run from `rti`: how often the interrupt came after it */
  const after = (rti: string) => bytesOf(`
* = $c000
       sei
       lda #$7f
       sta $dc0d
       sta $dd0d
       lda $dc0d
       lda $dd0d
       lda #$35
       sta $01
       lda #<irq
       sta $fffe
       lda #>irq
       sta $ffff
       lda #$00
       sta count
       lda #$40
       sta $dc0c
       sta ramrti
       lda #$10
       sta $dc06
       lda #$00
       sta $dc07
       lda #$82
       sta $dc0d
       lda #$19
       sta $dc0f
       ldx #$20
w:     dex
       bne w
       lda #>back
       pha
       lda #<back
       pha
       lda #$20
       pha
       jmp ${rti}
back:  nop
       nop
       nop
       nop
       lda count
       sta $c800
done:  jmp done
irq:   inc count
       lda $dc0d
       rti
count: .byte 0
ramrti: .byte 0
`, 1)[0];

  it('makes the dummy read of a one-byte instruction: an RTI run from $dc0c acknowledges CIA 1 by reading $dc0d', () => {
    // (Rust ends its IRQ handler with JMP $dc0c, the serial data register holding $40; VICE 3.10 gave the same counts)
    expect(after('$dc0c')).toBe(0);
    expect(after('ramrti')).toBe(1);
  });
});
