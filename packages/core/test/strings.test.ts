/* 5.5b strings handed to print routines: where the parameters at a call say the string is, as long as the routine says. */
import { describe, expect, it } from 'vitest';
import { analyze, findBlock, render, verify, type FileInput, type Settings } from '../src';
import { fromSource } from './helpers/programs';

const PRINT = `print: sta $fb
 stx $fc
 ldy #0
loop: lda ($fb),y
 beq done
 jsr $ffd2
 iny
 bne loop
done: rts
`;
function run(src: string, settings: Partial<Settings> = {}) {
  const file: FileInput = fromSource('p.prg', `.pc = $c000\n.encoding "petscii_upper"\n${src}`);
  const p = { name: 't', files: [file], settings };
  const A = analyze(p), R = render(A, p);
  expect(verify(A, R).ok).toBe(true);
  const text = (a: number) => { const b = findBlock(A.blocks, a); return b && b.start === a && b.type === 'text' ? { end: b.end, reason: b.reason } : null; };
  return { A, text, src: R.files[`${R.fileNames[0]}.asm`] as string };
}

describe('strings handed to print routines', () => {
  it("finds the strings the program's own print routine is given in A/X, to the 0 that ends each", () => {
    const { A, text, src } = run(`
 lda #<hello
 ldx #>hello
 jsr print
 lda #<world
 ldx #>world
 jsr print
 rts
${PRINT}
hello: .text "HELLO, "
 .byte 0
world: .text "WORLD"
 .byte $00, $13, $ff`);
    expect(text(0xc020)).toEqual({ end: 0xc028, reason: 'printed by the routine at $c00f from $c004' });
    expect(text(0xc028)).toEqual({ end: 0xc02e, reason: 'printed by the routine at $c00f from $c00b' });
    expect(A.labels.get(0xc00f)?.name).toBe('print_c00f');
    expect(src).toContain('lda #<txt_c020\n        ldx #>txt_c020\n        jsr print_c00f');
    expect(A.log).toContainEqual(expect.objectContaining({ lvl: 'ok', msg: "Print routine at $c00f: the string's address in A/X, ended by $00", addr: 0xc00f }));
  });

  it('reads the length its caller stores beside the pointer it sets', () => {
    const { text } = run(`
 lda #<msg
 sta $fb
 lda #>msg
 sta $fc
 lda #5
 sta $fd
 jsr out
 rts
out: ldy #0
loop: lda ($fb),y
 jsr $ffd2
 iny
 cpy $fd
 bne loop
 rts
msg: .text "READYSTEADY"`);
    expect(text(0xc01d)).toEqual({ end: 0xc022, reason: 'printed by the routine at $c010 from $c00c, 5 bytes' });
  });

  it('takes the length SETNAM is given in A', () => {
    const { text } = run(`
 lda #4
 ldx #<name
 ldy #>name
 jsr $ffbd
 rts
name: .text "DATAFILE"`);
    expect(text(0xc00a)).toEqual({ end: 0xc00e, reason: 'the file name given to SETNAM ($ffbd) from $c006, 4 bytes' });
  });

  it('a string goes on over a byte in it the code changes', () => {
    const { text } = run(`
 lda #$31
 sta name+4
 lda #6
 ldx #<name
 ldy #>name
 jsr $ffbd
 rts
name: .text "LEVEL?"
 .byte $ff`);
    expect(text(0xc00f)).toEqual({ end: 0xc013, reason: 'the file name given to SETNAM ($ffbd) from $c00b, 6 bytes' });
    expect(text(0xc013)).toEqual({ end: 0xc015, reason: 'the rest of the string at $c00f' });
  });

  it("counts a table loop's bytes by its compare, and ends a string at the byte it tests for", () => {
    const { text } = run(`
 ldx #0
l1: lda abc,x
 jsr $ffd2
 inx
 cpx #3
 bne l1
 ldy #0
l2: lda hi,y
 cmp #$2e
 beq done
 jsr $ffd2
 iny
 bne l2
done: rts
abc: .text "ABCDEF"
hi: .text "HI.THERE"
 .byte 0`);
    expect(text(0xc01d)).toEqual({ end: 0xc020, reason: 'printed through CHROUT ($ffd2) from $c005, 3 bytes' });
    expect(text(0xc023)).toEqual({ end: 0xc026, reason: 'printed through CHROUT ($ffd2) from $c016' });
  });

  it('a character the loop prints its own way does not end the string', () => {
    const { text } = run(`
 lda #<msg
 ldx #>msg
 jsr print
 rts
print: sta $fb
 stx $fc
 ldy #0
loop: lda ($fb),y
 beq done
 cmp #$0d
 beq cr
 jsr $ffd2
next: iny
 bne loop
done: rts
cr: inc $d020
 jmp next
msg: .text "ONE"
 .byte $0d
 .text "TWO"
 .byte 0`);
    expect(text(0xc023)?.end).toBe(0xc02b);
  });

  it('follows a pointer set in the same run, a routine that hands its registers on, and a jump to STROUT', () => {
    const { text, A } = run(`
 ldx #<title
 ldy #>title
 stx $fb
 sty $fc
 ldy #0
l1: lda ($fb),y
 beq d1
 jsr $ffd2
 iny
 bne l1
d1: lda #<sub
 ldy #>sub
 jsr say
 lda #<last
 ldy #>last
 jmp $ab1e
say: jsr $ab1e
 lda #$0d
 jmp $ffd2
title: .text "TITLE"
 .byte 0
sub: .text "SUB"
 .byte 0
last: .text "AB"
 .byte $22
 .text "CD"
 .byte 0`);
    expect(text(0xc02a)).toEqual({ end: 0xc030, reason: 'printed through CHROUT ($ffd2) from $c00e' });
    expect(text(0xc030)).toEqual({ end: 0xc034, reason: 'printed by the routine at $c022 from $c018' });
    // STROUT ends the string at a quote too
    expect(text(0xc034)).toEqual({ end: 0xc037, reason: 'printed by STROUT ($ab1e) from $c01f' });
    expect(A.labels.get(0xc022)?.name).toBe('print_c022');
  });

  it('bytes a loop writes to a file through CHROUT are not text unless they read as text', () => {
    const { A } = run(`
 lda #<buf
 sta $fb
 lda #>buf
 sta $fc
 ldx #2
 jsr $ffc9
 ldy #0
l: lda ($fb),y
 jsr $ffd2
 iny
 cpy #8
 bne l
 jmp $ffcc
buf: .byte 1, 2, 3, 4, 5, 6, 7, 8`);
    expect(findBlock(A.blocks, 0xc01e)?.type).not.toBe('text');
  });

  it('a code island found with the call that prints a string keeps out of the string, in a deep analysis too', () => {
    // a cartridge bank with no start of its own (Bacchus' Action Replay, bank 2): its code is islands, and the end of
    // the string, "HUS...", $0d, $0d, $00, decodes as pha / eor $53,x / rol $2e2e / ora $000d on into the code after it
    const src = `
 rts
 lda #0
 sta $d020
 lda #<msg
 ldy #>msg
 jsr $ab1e
 jmp $c000
msg: .byte $93
 .text "  THIS LOADER WAS BROKEN BY BACCHUS..."
 .byte $0d, $0d, $00
after: inc $01
 pla
 eor #$f9
 dey
 sta $d020
 bne after
 rts`;
    for (const deepAnalysis of [false, true]) {
      const { A, text } = run(src, { deepAnalysis });
      expect(text(0xc010), `deep: ${deepAnalysis}`).toEqual({ end: 0xc03a, reason: 'printed by STROUT ($ab1e) from $c00a' });
      expect(findBlock(A.blocks, 0xc03a)).toMatchObject({ start: 0xc03a, type: 'code' });
    }
  });

  // as in the Fairlight cartridge: the string follows the JSR; the routine keeps Y first, prints the characters other
  // than its $01 (a count of spaces) on a branch's side, through $e716, and returns after the 0
  const INLINE = `print: sty $24
 pla
 sta $22
 pla
 sta $23
 ldy #0
loop: iny
 lda ($22),y
 beq done
 cmp #$01
 bne out
 iny
 lda ($22),y
 tax
sp: lda #$20
 jsr $ffd2
 dex
 bne sp
 beq loop
out: jsr $e716
 bcc loop
done: tya
 clc
 adc $22
 tay
 lda $23
 adc #0
 pha
 tya
 pha
 ldy $24
 rts
`;

  it('a routine that prints the string after the JSR to it: the string is text and the code goes on after it', () => {
    const { A, text, src } = run(`
 jsr print
 .text "HELLO"
 .byte 0
 lda #1
 sta $d020
 rts
${INLINE}`);
    expect(text(0xc003)).toEqual({ end: 0xc009, reason: 'printed by the routine at $c00f from $c000' });
    expect(findBlock(A.blocks, 0xc009)).toMatchObject({ start: 0xc009, type: 'code' });
    expect(A.labels.get(0xc00f)?.name).toBe('print_c00f');
    expect(src).toContain('jsr print_c00f                  // prints the string after it\n');
    expect(A.log).toContainEqual(expect.objectContaining({ lvl: 'ok', msg: 'JSR $c00f prints the string after it ($c003-$c008); the code goes on at $c009', addr: 0xc000 }));
    expect(A.log).toContainEqual(expect.objectContaining({ lvl: 'ok', msg: 'Print routine at $c00f: the string after the JSR to it, ended by $00' }));
    expect(A.log.some(l => /pops its return address/.test(l.msg))).toBe(false);
  });

  it('a routine nothing traced reaches that starts by printing the string after a JSR is code, however short', () => {
    for (const deepAnalysis of [false, true]) {
      const { A, text } = run(`
 jsr print
 .byte 0
 rts
error: jsr print
 .byte $0d
 .text "WRONG FILETYPE"
 .byte 0
 jmp $c000
${INLINE}`, { deepAnalysis });
      expect(text(0xc008), `deep: ${deepAnalysis}`).toEqual({ end: 0xc018, reason: 'printed by the routine at $c01b from $c005' });
      expect(findBlock(A.blocks, 0xc005)).toMatchObject({ start: 0xc005, type: 'code' });
      expect(findBlock(A.blocks, 0xc018)).toMatchObject({ type: 'code' });
    }
  });
});

/** 5.5c: printed text is in the case the program prints in. */
describe('the case printed text is in', () => {
  const STROUT = (l: string) => ` lda #<${l}\n ldy #>${l}\n jsr $ab1e\n`;
  const TEXTS = `.encoding "petscii_mixed"
title: .text "Abyss the game"
 .byte 0
fire: .text "press fire"
 .byte 0`;
  /** the encoding and reason of the text block at `a` */
  const at = (A: ReturnType<typeof run>['A'], a: number) => { const b = findBlock(A.blocks, a)!; return { enc: b.props.enc, reason: b.reason }; };
  const caseLog = (A: ReturnType<typeof run>['A']) => A.log.filter(l => l.msg.includes('lower case characters')).map(l => ({ lvl: l.lvl, msg: l.msg, addr: l.addr }));

  it('a program that sends $0e to CHROUT prints mixed case: "Abyss" is .text in petscii_mixed, not .byte $c1 and "BYSS"', () => {
    const { A, src } = run(` lda #$0e\n jsr $ffd2\n${STROUT('title')}${STROUT('fire')} rts\n${TEXTS}`);
    expect(at(A, 0xc014)).toEqual({ enc: 'petscii-mixed', reason: 'printed by STROUT ($ab1e) from $c009' });
    expect(at(A, 0xc023)).toEqual({ enc: 'petscii-mixed', reason: 'printed by STROUT ($ab1e) from $c010' });
    expect(caseLog(A)).toEqual([{ lvl: 'ok', msg: 'The program switches to the lower case characters ($0e sent to CHROUT ($ffd2) at $c002): the text it prints is mixed case', addr: 0xc002 }]);
    expect(src).toContain('.encoding "petscii_mixed"');
    expect(src).toContain('.text "Abyss the game"');
    expect(src).toContain('.text "press fire"');
    expect(src).not.toContain('.text "BYSS');
  });

  it('a $d018 store of the lower case characters, or `ora #$02` into $d018, switches too', () => {
    const d = run(` lda #$17\n sta $d018\n${STROUT('title')}${STROUT('fire')} rts\n${TEXTS}`);
    expect(at(d.A, 0xc015).enc).toBe('petscii-mixed');
    expect(caseLog(d.A)[0].msg).toBe('The program switches to the lower case characters ($d018 = $17 at $c002): the text it prints is mixed case');
    const o = run(` lda $d018\n ora #$02\n sta $d018\n${STROUT('title')}${STROUT('fire')} rts\n${TEXTS}`);
    expect(at(o.A, 0xc01a).enc).toBe('petscii-mixed');
    expect(caseLog(o.A)[0].msg).toBe('The program switches to the lower case characters (ora #$02 into $d018 at $c005): the text it prints is mixed case');
  });

  it('a program that switches both ways prints upper case, unless a string shows otherwise', () => {
    const { A, src } = run(` lda #$17\n sta $d018\n${STROUT('title')}${STROUT('fire')} lda #$15\n sta $d018\n rts\n${TEXTS}`);
    expect(at(A, 0xc019)).toEqual({ enc: 'petscii-mixed', reason: 'printed by STROUT ($ab1e) from $c009, mixed case ("Abyss")' });
    expect(at(A, 0xc028)).toEqual({ enc: 'petscii', reason: 'printed by STROUT ($ab1e) from $c010' });
    expect(caseLog(A)).toEqual([{ lvl: 'info', msg: 'The program switches to the lower case characters ($d018 = $17 at $c002) and away from them ($d018 = $15 at $c015): the text it prints is upper case unless a string shows otherwise', addr: 0xc002 }]);
    expect(src).toContain('.text "PRESS FIRE"');
  });

  it("characters of the program's own are a switch away from the lower case ones", () => {
    const { A } = run(` lda #$0e\n jsr $ffd2\n lda #$18\n sta $d018\n${STROUT('title')}${STROUT('fire')} rts\n${TEXTS}`);
    expect(at(A, 0xc028).enc).toBe('petscii');
    expect(caseLog(A)[0].msg).toBe('The program switches to the lower case characters ($0e sent to CHROUT ($ffd2) at $c002) and away from them ($d018 = $18 at $c007, not the ROM\'s characters): the text it prints is upper case unless a string shows otherwise');
  });

  it('a $0e in a printed string switches the program; a $8e in one switches back', () => {
    const lo = run(`${STROUT('a')}${STROUT('b')} rts
a: .byte $93, $0e
 .text "MENU"
 .byte 0
b: .text "PLAIN"
 .byte 0`);
    expect(at(lo.A, 0xc00f)).toEqual({ enc: 'petscii-mixed', reason: 'printed by STROUT ($ab1e) from $c004' });
    expect(at(lo.A, 0xc016).enc).toBe('petscii-mixed');
    expect(caseLog(lo.A)[0].msg).toBe('The program switches to the lower case characters ($0e in the string at $c00f): the text it prints is mixed case');
    const up = run(` lda #$0e\n jsr $ffd2\n${STROUT('a')}${STROUT('b')} rts
a: .byte $8e
 .text "MENU"
 .byte 0
b: .text "PLAIN"
 .byte 0`);
    expect(at(up.A, 0xc014).enc).toBe('petscii');
    expect(at(up.A, 0xc01a).enc).toBe('petscii');
    expect(caseLog(up.A)[0].msg).toBe('The program switches to the lower case characters ($0e sent to CHROUT ($ffd2) at $c002) and away from them ($8e in the string at $c014): the text it prints is upper case unless a string shows otherwise');
  });

  it('without a switch, only a string that shows it is mixed case', () => {
    const { A } = run(`${STROUT('title')}${STROUT('fire')} rts\n${TEXTS}`);
    expect(at(A, 0xc00f)).toEqual({ enc: 'petscii-mixed', reason: 'printed by STROUT ($ab1e) from $c004, mixed case ("Abyss")' });
    expect(at(A, 0xc01e).enc).toBe('petscii');
    expect(caseLog(A)).toEqual([]);
  });
});
