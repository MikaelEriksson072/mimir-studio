/* Integration (spec 10.7): 64tass's labels after white space (`  loop lda #1`, `  x = 5`, `  -`, `  n .macro` …), its
 * macro and function calls without the # (`name 1`, `lb name`), a register's letter that is a name the code has
 * (`lda x` with a label x), no operand (asl alone is the accumulator's, inc alone is not) and the warning "label not on
 * left side" give in Mimir's own check what the real 64tass 1.57 gives (-a -C): the same bytes, or both saying no, and
 * the warning on the same lines. Runs when 64tass is found; otherwise skipped. */
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkAsm } from '../src/asm-project';
import { find64tass } from '../src/node';

const tass = find64tass();

const CASES: Record<string, string> = {
  'a label before an instruction': "  * = $1000\n  loop lda #1\n  bne loop\n",
  'a label alone on its line': "  * = $1000\n  loop\n  nop\n  jmp loop\n",
  'a label with its colon, alone and before an instruction': "  * = $1000\n  loop:\n  nop\n  l2: nop\n  jmp loop\n  jmp l2\n",
  'tabs': "\t* = $1000\n\tloop\tlda #1\n\tbne loop\n",
  'a value, a variable and a change of it': "  * = $1000\n  x = 5\n  y=6\n  n := 1\n  n += 1\n  lda #x\n  .byte y, n\n",
  'data and a local label': "  * = $1000\n  tbl .byte 1,2\nfoo\n  _l lda tbl\n  bne _l\n",
  'the anonymous labels': "  * = $1000\n  - lda #1\n  bne -\n  beq +\n  + rts\n  -\n  nop\n  bne -\n  beq +\n  +\n  rts\n",
  'a macro, a segment and a function defined after white space': "  * = $1000\n  n .macro\n  lda #\\1\n  .endm\n  #n 5\n  .n 6\n  s .segment\n  nop\n  .endm\n  #s\n  f .function a\n  .endf a*2\n  .byte f(3)\n",
  'a .proc, a .block, a structure, a b-loop': "  * = $1000\n  p .proc\n  nop\n  .pend\n  jsr p\n  b .block\n  x nop\n  .bend\n  jmp b.x\n  st .struct\n  a .byte ?\n  .ends\n  .byte st.a\n  r .bfor i = 0, i < 2, i += 1\n  x .byte i\n  .next\n  .byte <r[1].x\n",
  'an encoding and a union': "  * = $1000\n  e .encode\n  .enc \"screen\"\n  .endencode\n  u .union\n  .byte ?\n  .endu\n  nop\n",
  'a mnemonic another processor has is a label on the 6502': "  * = $1000\n  stz nop\n  jmp stz\n  bra\n  nop\n  jmp bra\n",
  'a mnemonic of the processor is the instruction': "  .cpu \"65c02\"\n  * = $1000\n  phx\n  bra +\n  + stz $12\n  bge +\n  + gcc +\n  +\n  nop\n",
  'a macro called without its #': "  * = $1000\nm .macro\n  lda #\\1\n  .endm\nm 5\n  m 6\nlb m 7\n  l2 m 8\n  jmp lb\n  jmp l2\nz .macro\n  nop\n  .endm\nz\n  z\n",
  'a segment called without its #': "  * = $1000\nf .segment\n  nop\n  .endm\n  f\nf\n",
  'a function called without its #': "  * = $1000\nf .function a\n  .endf a*2\nf 3\n  f 4\n  lb f 3\n  .byte lb\n",
  'a register\'s letter that is a name': "  * = $1000\nx .byte 1\n  lda x\na .byte 2\n  ldx a\n  inc a\n  asl a\n  lda y\ny = 5\nb .block\nq .byte 1\n  lda q\n  lda x\n.bend\n  lda q\n",
  'a register\'s letter that is a name on the 65816': "  .cpu \"65816\"\n  * = $1000\ns .byte 1\n  lda s\n  stx s\n  lda d\n",
  'no operand': "  * = $1000\n  asl\n  lsr\n  rol\n  ror\n  .cpu \"65ce02\"\n  neg\n  asr\n",
  'inc alone': "  .cpu \"65c02\"\n  * = $1000\n  inc\n",
  'lda alone': "  * = $1000\n  lda\n",
  'an upper case mnemonic is a label with -C': "  * = $1000\n  LDA #1\n",
  'two labels': "  * = $1000\n  l1 l2 nop\n",
  'the warning: a label of three letters alone, before an instruction or a call, that nothing uses': "  * = $1000\nm .macro\n  nop\n  .endm\n  ina\n  abc lda #1\n  abd #m\n  abe .m\n  abf gcc abf\n  abg .byte 1\n  abh = 3\n  abi\n  jmp abi\n  jmp abj\n  abj\n  abcd\n  Abc\n  phx ; c\nabk\n  abl:\n",
  'the warning in a macro': "  * = $1000\nm .macro\n  abc\n  nop\n  .endm\n  #m\n  #m\n",
};

describe.skipIf(!tass)("64tass's labels after white space, calls without the #, register letters as names, built with the real 64tass", () => {
  for (const [what, text] of Object.entries(CASES)) {
    it(`gives what the real 64tass gives: ${what}`, async () => {
      const c = checkAsm({ 'main.asm': text }, 'main.asm', '64tass');
      const dir = await mkdtemp(join(tmpdir(), 'mimir-labels-'));
      try {
        await writeFile(join(dir, 'main.asm'), text);
        const r = spawnSync(tass!, ['-a', '-C', '-o', 'main.prg', 'main.asm'], { cwd: dir, windowsHide: true, encoding: 'utf8' });
        const out = r.stdout + r.stderr;
        const lefts = (s: string) => [...new Set(s.split(/\r?\n/).filter(l => /label-left/.test(l)).map(l => Number(/main\.asm:(\d+):/.exec(l)![1])))];
        expect(c.warnings.filter(w => /left side/.test(w.msg)).map(w => w.line), out).toEqual(lefts(out));
        if (r.status !== 0) { expect(c.ok, `64tass says no: ${out}`).toBe(false); return; }
        expect(c.problems, out).toEqual([]);
        expect([...c.asm.prg!]).toEqual([...new Uint8Array(await readFile(join(dir, 'main.prg')))]);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });
  }
});
