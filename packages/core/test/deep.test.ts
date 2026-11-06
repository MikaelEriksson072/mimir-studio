/* 5.17 deep analysis: every rule on a small program that the normal analysis reports problems for. */
import { describe, expect, it } from 'vitest';
import { analyze, findBlock, openC64File, render, verify, type FileInput, type ProblemCode, type ProjectInput } from '../src';
import { fromSource, snapshotOf } from './helpers/programs';
import { addDeepReports, faultCount, goneCounts, isFault } from '../src/analyze/deep';

const BASIC = '.pc = $0801\n.byte $0b,$08,$0a,$00,$9e,$32,$30,$36,$31,$00,$00,$00\n.pc = $080d\n';
const problems = (A: ReturnType<typeof analyze>) => A.log.filter(l => l.lvl === 'warn' || l.lvl === 'err' || l.lvl === 'hint');
const deepLines = (A: ReturnType<typeof analyze>) => A.log.filter(l => l.cat === 'deep').map(l => l.msg);
/** The normal and the deep analysis of the same project, both checked to assemble back to the same bytes. */
function both(file: FileInput, extra: Partial<ProjectInput> = {}) {
  const out = [false, true].map(deepAnalysis => {
    const p: ProjectInput = { name: 't', files: [file], ...extra, settings: { ...extra.settings, deepAnalysis } };
    const A = analyze(p), R = render(A, p);
    expect(verify(A, R).ok).toBe(true);
    return A;
  });
  return { normal: out[0], deep: out[1] };
}
const snapshot = (src: string, pc: number) => { const o = openC64File('snap.vsf', snapshotOf(src, pc)); return { file: o as FileInput, extra: { entries: o.entries } }; };

describe('deep analysis', () => {
  it('is off by default, and reports what it did when on', () => {
    const { normal, deep } = both(fromSource('p.prg', `${BASIC} lda #1\n sta $d020\n bne go\n .byte $02,$00\ngo: rts\n`));
    expect(normal.deep).toBeNull();
    expect(problems(normal).map(l => l.msg)).toEqual(['JAM opcode $02 reached at $0814; the path probably runs into data']);
    expect(problems(deep)).toEqual([]);
    expect(deep.deep).toMatchObject({ before: 1, after: 0, branches: 1, gone: { flags: 1 }, added: 0 });
    // the JAM was on the side the flags never take: solved
    expect(deepLines(deep).slice(-2)).toEqual([
      'Of the 1 problem the normal analysis has and this one does not, 1 is solved, the code read right (1 on sides of branches the flags never take), and 0 decided on a guess',
      expect.stringMatching(/^Deep analysis: 1 → 0 problems in \d rounds? \(1 solved, 0 decided\): 0 guesses left out, 0 calls and jumps not followed, 1 branch decided by the flags before it$/),
    ]);
  });

  it('follows only the side of a branch the flags before it take, through instructions that keep them', () => {
    // lda #1 / sta: Z = 0, so BNE always branches and BEQ never does
    const { deep } = both(fromSource('p.prg', `${BASIC} lda #1\n sta $d020\n beq never\n bne go\nnever: .byte $02\ngo: clc\n bcc done\n .byte $00\ndone: rts\n`));
    expect(problems(deep)).toEqual([]);
    expect(deep.insLen[0x0816]).toBe(0);
    expect(deep.insLen[0x081a]).toBe(0);
    expect(deep.deep!.branches).toBe(3);
  });

  it('follows both sides again when the branch is reached some other way', () => {
    // `again` is a branch target: from there the flags are unknown
    const src = `${BASIC} lda #1\nagain: bne go\n .byte $ea\n rts\ngo: ldx $02\n beq again\n rts\n`;
    const { deep } = both(fromSource('p.prg', src));
    expect(deep.insLen[0x0811]).toBe(1); // the NOP after the BNE is code
    expect(deep.deep!.branches).toBe(0);
  });

  it('keeps a code island only when tracing it runs into no problem', () => {
    const src = `${BASIC} rts\nbad: lda #0\n sta $d020\n jsr junk\n lda #1\n sta $d021\n rts\ngood: lda #2\n sta $d020\n ldx #0\n stx $d021\n inx\n rts\njunk: .byte $02,$02,$02\n`;
    const { normal, deep } = both(fromSource('p.prg', src));
    expect(findBlock(normal.blocks, 0x080e)?.type).toBe('code');
    expect(problems(normal).some(l => l.msg.startsWith('JAM'))).toBe(true);
    expect(findBlock(deep.blocks, 0x080e)?.type).toBe('data');
    expect(findBlock(deep.blocks, 0x081c)).toMatchObject({ type: 'code', start: 0x081c });
    expect(problems(deep)).toEqual([]);
    expect(deepLines(deep)).toContain('The routine-like bytes at $080e stay data: traced on trial, they run into a problem (JAM opcode $02 reached at $0828)');
    // the JAM is gone because the guess is left out: decided, not solved
    expect(deep.deep).toMatchObject({ gone: { rejected: 1 }, decisions: { guesses: [0x080e], sides: [], runTime: [] } });
  });

  it('does not follow a call into the KERNAL ROM of a snapshot, nor its IRQ vector at $ea31', () => {
    // the RAM below the KERNAL is zeros; $01 = $37
    const { file, extra } = snapshot(`.pc = $c000\nloop: jsr $ffe4\n beq loop\n sei\n lda #$31\n sta $0314\n lda #$ea\n sta $0315\n cli\nwait: jmp wait\n`, 0xc000);
    const { normal, deep } = both(file, extra);
    expect(problems(normal).length).toBeGreaterThan(0);
    expect(problems(deep)).toEqual([]);
    expect(deep.insLen[0xffe4]).toBe(0);
    expect(deep.insLen[0xea31]).toBe(0);
    expect(deepLines(deep)).toEqual(expect.arrayContaining([
      'The JSR at $c000 to $ffe4 reaches the KERNAL ROM there, so the RAM below it is not traced',
      'IRQ vector $0314 set to $ea31 at $c006: the KERNAL ROM\'s own routine, so the RAM below is not traced',
      'The load address $0200 is not used as the entry point: traced on trial, it runs into a problem (BRK at $0200 ends the code path)',
      // the BRKs below the KERNAL are solved (the ROM is there), the one at the load address decided
      'Of the 3 problems the normal analysis has and this one does not, 2 are solved, the code read right (2 behind calls into ROM), and 1 decided on a guess (1 in guesses left out as data)',
    ]));
    expect(deep.deep!.gone).toEqual({ rom: 2, rejected: 1 });
  });

  it('keeps an IRQ handler that ends in JMP $ea31, with the KERNAL ROM there', () => {
    const { file, extra } = snapshot(`.pc = $c000\n sei\n lda #<irq\n sta $0314\n lda #>irq\n sta $0315\n cli\nwait: jmp wait\nirq: inc $d020\n asl $d019\n jmp $ea31\n`, 0xc000);
    const { deep } = both(file, extra);
    expect(deep.entryKind.get(0xc00f)).toBe('irq');
    expect(findBlock(deep.blocks, 0xc00f)?.type).toBe('code');
    expect(deep.insLen[0xea31]).toBe(0);
    expect(problems(deep)).toEqual([]);
  });

  // the IRQ handler the code installs at $081a, with what it does
  const installs = (handler: string) => fromSource('p.prg', `${BASIC} sei\n lda #<irq\n sta $0314\n lda #>irq\n sta $0315\n cli\n rts\nirq: ${handler}`);

  it('keeps an IRQ handler whose JMP (ind) goes through a pointer the handler itself sets', () => {
    const { deep } = both(installs(` lda #<fx\n sta $fb\n lda #>fx\n sta $fc\n jsr call\n jmp $ea31\ncall: jmp ($00fb)\nfx: inc $d020\n rts\n`));
    expect(deep.entryKind.get(0x081a)).toBe('irq');
    expect(findBlock(deep.blocks, 0x081a)?.type).toBe('code');
    expect(deepLines(deep).filter(l => l.includes('stays data'))).toEqual([]);
  });

  it('keeps an IRQ handler without the side of a branch that runs into a problem, and says so', () => {
    // BMI: the flag comes from $d019, which the analysis cannot know; the other side is a BRK
    const { normal, deep } = both(installs(` lda $d019\n bmi raster\n .byte $00\nraster: sta $d019\n inc $d020\n jmp $ea31\n`));
    expect(problems(normal).map(l => l.code)).toEqual(['brk']);
    expect(findBlock(deep.blocks, 0x081a)?.type).toBe('code');
    expect(deep.insLen[0x0820]).toBe(3); // sta $d019 after the BRK
    expect(deep.insLen[0x081f]).toBe(0);
    expect(problems(deep)).toEqual([]);
    expect(deep.deep!.blamed).toBe(1);
    expect(deepLines(deep)).toContain('The IRQ handler at $081a is kept without the side of the BMI at $081d that goes to $081f: traced on trial, that runs into a problem (BRK at $081f ends the code path)');
    // the BRK is gone because the side is left out: decided
    expect(deep.deep).toMatchObject({ gone: { blamed: 1 }, decisions: { sides: [0x081f] } });
  });

  it('keeps an IRQ handler that calls a routine put in place at run time, as the code so far would', () => {
    const { deep } = both(installs(` jsr $0900\n jmp $ea31\n.pc = $0900\n .byte $00,$00,$00\n`));
    expect(findBlock(deep.blocks, 0x081a)?.type).toBe('code');
    expect(deep.insLen[0x0900]).toBe(0);
    expect(deepLines(deep)).toContain('The JSR at $081a goes to $0900, which holds $00: the routine is put there at run time (unpacked or copied), so it is not traced');
    expect(deep.deep).toMatchObject({ gone: { runTime: 1 }, decisions: { runTime: [0x0900] } });
  });

  it('traces an IRQ handler installed in $0314 with the KERNAL in, where the main code also runs without it', () => {
    // the main code switches the KERNAL out and in; the handler's JMP $ea81 goes to the KERNAL, not the data below it
    const { file, extra } = snapshot(`.pc = $c000\n sei\n lda #$35\n sta $01\n lda #$37\n sta $01\n lda #<irq\n sta $0314\n lda #>irq\n sta $0315\n cli\nwait: jmp wait\nirq: inc $d020\n jmp $ea81\n.pc = $ea81\n .byte $ea,$ea,$02\n`, 0xc000);
    const { deep } = both(file, extra);
    expect(deep.entryKind.get(0xc017)).toBe('irq');
    expect(findBlock(deep.blocks, 0xc017)?.type).toBe('code');
    expect(deep.insLen[0xea81]).toBe(0);
    expect(deepLines(deep)).toContain('The JMP at $c01a to $ea81 reaches the KERNAL ROM there, so the RAM below it is not traced');
  });

  it('adds up the reports of a cartridge\'s banks', () => {
    const a = both(fromSource('p.prg', `${BASIC} lda #1\n sta $d020\n bne go\n .byte $02,$00\ngo: rts\n`)).deep.deep!;
    const b = both(installs(` lda $d019\n bmi raster\n .byte $00\nraster: sta $d019\n inc $d020\n jmp $ea31\n`)).deep.deep!;
    expect(addDeepReports(a, b)).toMatchObject({ before: 2, after: 0, branches: 1, blamed: 1, gone: { flags: 1, blamed: 1 }, added: 0, decisions: { guesses: [], sides: [0x081f], runTime: [] } });
    expect(goneCounts(addDeepReports(a, b))).toEqual({ solved: 1, decided: 1, other: 0 });
  });

  it('leaves out an IRQ handler whose own straight way runs into a problem', () => {
    const { deep } = both(installs(` inc $d020\n .byte $02\n`));
    expect(findBlock(deep.blocks, 0x081a)?.type).not.toBe('code');
    expect(deepLines(deep)).toContain('The IRQ handler at $081a stays data: traced on trial, it runs into a problem (JAM opcode $02 reached at $081d)');
  });

  it('does not follow a JMP whose address the code writes', () => {
    const src = `${BASIC} lda #<target\n sta jump+1\n lda #>target\n sta jump+2\njump: jmp $0830\ntarget: rts\n.pc = $0830\n .byte $02,$02\n`;
    const { normal, deep } = both(fromSource('p.prg', src));
    expect(problems(normal).some(l => l.msg.startsWith('JAM'))).toBe(true);
    expect(problems(deep)).toEqual([]);
    expect(deepLines(deep)).toContain('The code at $080f writes the address of the JMP at $0817, so its target $0830 is set at run time and is not followed');
  });

  it('does not trace the bytes after a JSR to a routine that never returns', () => {
    const src = `${BASIC} jsr forever\n .byte $02,$02\nforever: inc $d020\n jmp forever\n`;
    const { normal, deep } = both(fromSource('p.prg', src));
    expect(problems(normal).length).toBe(1);
    expect(problems(deep)).toEqual([]);
    expect(deep.insLen[0x0810]).toBe(0);
    expect(deepLines(deep)).toContain('The routine at $0812 never returns, so the bytes after the JSR at $080d are not traced');
  });

  it('does not follow a call to a routine that is not there yet, nor run into an instruction code writes', () => {
    // $0900 is zeros until something unpacks a routine there; the code writes the instruction at `patch` (a NOP)
    const src = `${BASIC} jsr $0900\n lda #$ea\n sta patch\npatch: .byte $00\n rts\n.pc = $0900\n .fill 16, 0\n`;
    const { normal, deep } = both(fromSource('p.prg', src));
    expect(problems(normal).map(l => l.msg).sort()).toEqual(['BRK at $0815 ends the code path', 'BRK at $0900 ends the code path']);
    expect(problems(deep)).toEqual([]);
    expect(deepLines(deep)).toContain('The JSR at $080d goes to $0900, which holds $00: the routine is put there at run time (unpacked or copied), so it is not traced');
    expect(deep.log.some(l => l.msg === 'The code writes the instruction at $0815 ($00 now), so it is set at run time and the path stops there')).toBe(true);
    // a guess that calls into zeros is still left out
    const guess = both(fromSource('p.prg', `${BASIC} rts\n lda #0\n sta $d020\n jsr $0900\n lda #1\n sta $d021\n rts\n.pc = $0900\n .fill 16, 0\n`));
    expect(findBlock(guess.deep.blocks, 0x080e)?.type).toBe('data');
  });

  it('follows $01 through the stack and through a variable that code only stores to', () => {
    const hint = (A: ReturnType<typeof analyze>) => A.log.filter(l => l.msg.startsWith('$01 is written')).map(l => l.addr);
    // the handler saves $01 on the stack, banks the KERNAL out and back in
    const stack = `${BASIC} sei\n lda #<irq\n sta $0314\n lda #>irq\n sta $0315\n cli\n rts\nirq: lda $01\n pha\n lda #$35\n sta $01\n lda $e000\n sta $c000\n pla\n sta $01\n asl $d019\n jmp $ea31\n`;
    const s = both(fromSource('p.prg', stack));
    const restore = 0x0828; // the STA $01 after the PLA
    expect(hint(s.normal)).toEqual([restore]);
    expect(hint(s.deep)).toEqual([]);
    expect(s.deep.mcfg!.port[restore + 2] & 0x20).toBe(0); // $35 no more after it
    const variable = `${BASIC} lda $01\n sta save\n lda #$34\n sta $01\n ldx $c000\n lda save\n sta $01\n stx $0400\n rts\nsave: .byte 0\n`;
    const v = both(fromSource('p.prg', variable));
    expect(hint(v.normal)).toEqual([0x081c]);
    expect(hint(v.deep)).toEqual([]);
    // $37 again, or the byte the variable holds in the file ($00) if it is read before it is stored to
    expect(v.deep.mcfg!.port[0x081e]).toBe(1 << 7 | 1 << 0);
  });

  it('never ends with more faults than the normal analysis', () => {
    for (const src of [`${BASIC} rts\n`, `.pc = $c000\n .byte $00,$00,$a9,$01,$8d,$20,$d0,$60\n`, `${BASIC} jmp ($1234)\n`]) {
      const { normal, deep } = both(fromSource('p.prg', src));
      expect(faultCount(deep.log)).toBeLessThanOrEqual(faultCount(normal.log));
      expect(deep.deep!.after).toBe(problems(deep).length);
    }
  });

  it('counts as faults the warnings and errors that say code is read wrongly, not what the code read finds', () => {
    // by the code, whatever the message says
    const at = (lvl: 'warn' | 'err' | 'hint', code: ProblemCode) => isFault({ lvl, msg: 'reworded', addr: null, cat: 'code', code });
    expect(at('err', 'jam')).toBe(true);
    expect(at('warn', 'brk')).toBe(true);
    expect(at('warn', 'overlap')).toBe(true);
    expect(at('warn', 'ijmp-unknown')).toBe(false);
    expect(at('hint', 'copy-loop')).toBe(false);
  });

  it('gives every problem the code of its kind, and nothing else a code', () => {
    const { normal } = both(fromSource('p.prg', `${BASIC} lda #1
 sta $d020
 bne go
 .byte $02,$00
go: jmp ($1234)
`));
    expect(problems(normal).map(l => l.code)).toEqual(['jam', 'ijmp-unknown']);
    expect(normal.log.filter(l => l.code && !problems(normal).includes(l))).toEqual([]);
  });
});
