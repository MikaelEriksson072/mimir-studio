/* Cycles in the Assembler (spec 10.7): each line's instruction, and a range of lines counted along a path. */
import { describe, expect, it } from 'vitest';
import { asmCode, asmLineCycles, asmLinesRange } from '../src/asm-cycles';
import { checkAsm } from '../src/asm-project';
import { cyclePath, cycleText } from '../src/cpu/cycles';

const SRC = `BasicUpstart2(start)
start:
        ldx #0          // 2
!:
        lda $04f0,x     // 4+
        sta $d020       // 4
        inx             // 2
        bne !-          // 2/3
        rts             // 6
`;

describe('cycles in the Assembler', () => {
  it('gives each line\'s instruction its cycles', () => {
    const c = checkAsm({ 'main.asm': SRC }, 'main.asm', 'kickass');
    const cyc = asmLineCycles(c, 'main.asm');
    expect([...cyc].map(([l, x]) => [l, cycleText(x.cycles)])).toEqual([[3, '2'], [5, '4+'], [6, '4'], [7, '2'], [8, '2/3'], [9, '6']]);
    expect(asmLineCycles(c, 'other.asm').size).toBe(0);
  });
  it('counts the lines chosen along a path, a branch taken or not', () => {
    const c = checkAsm({ 'main.asm': SRC }, 'main.asm', 'kickass');
    const r = asmLinesRange(c, 'main.asm', 3, 8)!;
    expect(r).toEqual({ start: 0x080e, end: 0x080e + 2 + 3 + 3 + 1 + 2 });
    const code = asmCode(c);
    const straight = cyclePath(code, r.start, r.end, new Set());
    expect(straight.total).toBe(2 + 4 + 4 + 2 + 2);
    expect(straight.instructions).toBe(5);
    const bne = asmLineCycles(c, 'main.asm').get(8)!.addr;
    const looped = cyclePath(code, r.start, r.end, new Set([bne]));
    expect(looped.branches[0]).toMatchObject({ pc: bne, on: true, back: true, pass: 4 + 4 + 2 + 3 });
    expect(asmLinesRange(c, 'main.asm', 1, 1)).toBe(null);
  });
});
