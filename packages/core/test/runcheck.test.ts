/* 8.11h The analysis against a run: what Sindri saw the program do with each loaded byte, next to what the analysis
 * made of it. */
import { describe, expect, it } from 'vitest';
import { FILE_ARG, FILE_RAN, FILE_READ, FILE_WRITTEN } from '@mimir/sindri';
import { addRunChecks, analyze, checkRun, makePrg, unpackPrg } from '../src';
import { fromSource } from './helpers/programs';

const BASIC = '.pc = $0801\n.byte $0b,$08,$0a,$00,$9e,$32,$30,$36,$31,$00,$00,$00\n.pc = $080d\n';
// $080d jsr sub, $0810 lda #1, $0812 sta $d020, $0815 rts, $0816 sub: lda $d012, $0819 rts, $081a table
const file = fromSource('p.prg', `${BASIC} jsr sub\n lda #1\n sta $d020\n rts\nsub: lda $d012\n rts\ntable: .byte 1,2,3\n`);
const A = analyze({ name: 't', files: [file] });

describe('the analysis against a run', () => {
  it('counts what ran as found, out of step or data, and what was only read as code or data', () => {
    const use = new Uint8Array(0x10000);
    const set = (a: number, ...f: number[]) => { use[a] = f.reduce((x, y) => x | y, 0); };
    set(0x080d, FILE_RAN); set(0x080e, FILE_ARG); set(0x080f, FILE_ARG);
    set(0x0810, FILE_RAN);
    set(0x0811, FILE_RAN); // the operand of LDA #1 ran as an opcode: the analysis reads it out of step
    set(0x0812, FILE_RAN); set(0x0813, FILE_READ); set(0x0814, FILE_ARG); // an operand read as a counter, its STA ran
    set(0x0815, FILE_RAN);
    for (let a = 0x0816; a < 0x081a; a++) set(a, FILE_READ); // the routine only read: the analysis has code
    set(0x081a, FILE_RAN); // the table ran: the analysis has data
    set(0x081b, FILE_READ, FILE_WRITTEN);
    const c = checkRun(A, use);
    expect(c).toMatchObject({ ran: 6, found: 4, outOfStep: 1, missed: 1, read: 6, readAsCode: 4, readAsCodeCopied: 0, codeBytes: 13, codeUntouched: 0 });
    expect(c.where).toEqual({ missed: [0x081a], outOfStep: [0x0811], readAsCode: [0x0816] });
    expect(addRunChecks([c, c])).toMatchObject({ ran: 12, found: 8, readAsCode: 8 });
  });

  it('finds every instruction Sindri ran in a program the analysis reads right', () => {
    const run = unpackPrg(makePrg(file.load, file.bytes));
    const c = checkRun(A, run.fileUse);
    expect(c).toMatchObject({ ran: 6, found: 6, outOfStep: 0, missed: 0, readAsCode: 0 });
    // the table nothing touched
    expect([0x081a, 0x081b, 0x081c].map(a => run.fileUse[a])).toEqual([0, 0, 0]);
  });
});
