/* The names of an Assembler project's sources (spec 10.7): where each is written and defined, and a rename of one over
 * all the files that gives the same program. */
import { describe, expect, it } from 'vitest';
import { asmNameRefs, asmNames, asmRenameProblem } from '../src/asm-names';
import { checkAsm } from '../src/asm-project';
import type { ScriptLang } from '../src/types';

const KICK = `BasicUpstart2(start)          // start: a comment
#import "lib.asm"
.const BORDER = $d020
start:  lda #<text              /* text in a
        comment start */ ldx #0
!loop:  lda text,x
        beq !+
        sta $0400,x
        inx
        bne !loop-
!:      jsr copy
        lda #BORDER & $ff
        sta BORDER
        rts
text:   .text "start text"
        .byte $c0, 0
`;
const LIB = `copy:   ldx #routine_end - routine
!:      lda routine - 1,x
        sta $c000 - 1,x
        dex
        bne !-
        rts
routine: lda text
        rts
routine_end:
`;

/** the files with every `name` written in them given the name `to` */
function renamed(files: Record<string, string>, lang: ScriptLang, name: string, to: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [p, text] of Object.entries(files)) {
    const lines = text.split('\n');
    for (const r of asmNameRefs(text, lang, name).reverse()) { const l = lines[r.line - 1]; lines[r.line - 1] = l.slice(0, r.col - 1) + to + l.slice(r.col - 1 + name.length); }
    out[p] = lines.join('\n');
  }
  return out;
}

describe('the names in the sources', () => {
  it('finds a name where the code writes it, not in comments, strings, numbers, members or local labels', () => {
    expect(asmNameRefs(KICK, 'kickass', 'start').map(r => [r.line, r.col, r.def])).toEqual([[1, 15, false], [4, 1, true]]);
    expect(asmNameRefs(KICK, 'kickass', 'text').map(r => [r.line, r.def])).toEqual([[4, false], [6, false], [15, true]]);
    expect(asmNameRefs(KICK, 'kickass', 'BORDER').map(r => [r.line, r.def, r.how])).toEqual([[3, true, 'value'], [12, false, undefined], [13, false, undefined]]);
    expect(asmNameRefs(KICK, 'kickass', 'loop')).toEqual([]);
    expect(asmNameRefs(KICK, 'kickass', 'c0')).toEqual([]);
    expect(asmNameRefs(LIB, 'kickass', 'c000')).toEqual([]);
    expect(asmNameRefs('  jsr music.init\n', 'kickass', 'init')).toEqual([]);
  });
  it('knows 64tass\'s labels at the start of a line and its values', () => {
    const t = 'start   lda #0\n        jmp start ; start\nvalue = 3\n  other = 4\n.comment\nstart\n.endc\n        .byte value\n';
    expect(asmNames(t, '64tass').filter(n => n.def).map(n => [n.name, n.how])).toEqual([['start', 'label'], ['value', 'value'], ['other', 'value']]);
    expect(asmNameRefs(t, '64tass', 'start').map(r => r.line)).toEqual([1, 2]);
    expect(asmNameRefs(t, '64tass', 'value').map(r => r.line)).toEqual([3, 8]);
  });
  it('renames a name over all the files to the same program', () => {
    const files = { 'main.asm': KICK, 'lib.asm': LIB };
    const before = checkAsm(files, 'main.asm', 'kickass');
    expect(before.problems).toEqual([]);
    for (const [name, to] of [['start', 'begin'], ['text', 'message'], ['routine', 'code'], ['BORDER', 'EDGE'], ['copy', 'copier']]) {
      const after = checkAsm(renamed(files, 'kickass', name, to), 'main.asm', 'kickass');
      expect(after.problems, `${name} → ${to}`).toEqual([]);
      expect([...after.asm.prg!], `${name} → ${to}`).toEqual([...before.asm.prg!]);
      expect(after.names.get(to)).toBe(before.names.get(name));
      expect(after.names.has(name)).toBe(false);
    }
  });
  it('says why a new name cannot be one', () => {
    const used = (n: string) => n === 'text';
    expect(asmRenameProblem('message', used)).toBe(null);
    expect(asmRenameProblem('text', used)).toMatch(/already/);
    expect(asmRenameProblem('lda', used)).toMatch(/instruction/);
    expect(asmRenameProblem('x', used)).toMatch(/register/);
    expect(asmRenameProblem('2go', used)).toMatch(/not a name/);
  });
});
