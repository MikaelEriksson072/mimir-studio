import { describe, expect, it } from 'vitest';
import { asmAddrOf, asmEndText, asmLineAt, asmMachine, checkAsm, dataFiles, importsOf, mainFile, sourceLang } from '../src/asm-project';
import { assemble } from '../src/verify/kick-subset-assembler';

const MAIN = `BasicUpstart2(start)
#import "lib/print.asm"
start:
  ldx #0
!:
  lda text,x
  beq !+
  jsr $ffd2
  inx
  bne !-
!:
  jsr copy
  jsr $c000
  rts
text: .text "HELLO"
  .byte 0
`;
const LIB = `#import "data.asm"
copy:
  ldx #routine_end - routine
!:
  lda routine - 1,x
  sta $c000 - 1,x
  dex
  bne !-
  rts
routine:
  lda value
  sta $0428
  rts
routine_end:
`;
const DATA = 'value: .byte $2a\n';

describe('the Assembler: a folder of sources', () => {
  it('finds the main file: the one that starts a program and is imported by none', () => {
    const files = [{ path: 'lib/print.asm', text: LIB }, { path: 'lib/data.asm', text: DATA }, { path: 'game.asm', text: MAIN }, { path: 'notes.txt', text: '' }];
    expect(mainFile(files)).toBe('game.asm');
    expect(mainFile([{ path: 'a.asm', text: 'lda #1' }, { path: 'main.asm', text: 'lda #1' }])).toBe('main.asm');
    expect(mainFile([{ path: 'x.txt', text: '' }])).toBeNull();
    // an import is found from the importing file's folder first
    expect(importsOf('lib/print.asm', LIB, new Set(['lib/data.asm', 'data.asm']))).toEqual(['lib/data.asm']);
    expect(dataFiles([{ path: 'game.asm', text: 'music: .var m = LoadSid("music/tune.sid")\n.import binary "gfx.bin"\n#import "lib/x.asm"' }], new Set(['music/tune.sid', 'gfx.bin', 'lib/x.asm']))).toEqual(['music/tune.sid', 'gfx.bin']);
    expect(sourceLang('* = $0801\n  lda #1 ; one\n.byte 1')).toBe('64tass');
    expect(sourceLang(MAIN)).toBe('kickass');
  });

  it('imports from the importing file\'s folder, as Kick Assembler does', () => {
    const r = assemble({ 'game.asm': MAIN, 'lib/print.asm': LIB, 'lib/data.asm': DATA }, 'game.asm');
    expect(r.errors).toEqual([]);
  });

  it('checks the program: where a run starts, and the line of every file each byte comes from', () => {
    const c = checkAsm({ 'game.asm': MAIN, 'lib/print.asm': LIB, 'lib/data.asm': DATA }, 'game.asm', 'kickass');
    expect(c.problems).toEqual([]);
    expect(c.ok).toBe(true);
    expect(c.entryFrom).toBe('basic');
    expect(c.entry).toBe(c.names.get('start'));
    expect(asmLineAt(c, c.entry!)).toEqual({ file: 'game.asm', line: 4 });
    expect(asmLineAt(c, c.names.get('copy')!)).toEqual({ file: 'lib/print.asm', line: 3 });
    expect(asmAddrOf(c, 'lib/print.asm', 11)).toBe(c.names.get('routine'));
    expect(asmAddrOf(c, 'lib/data.asm', 1)).toBe(c.names.get('value'));
    // what is wrong, by file and line
    const bad = checkAsm({ 'game.asm': MAIN, 'lib/print.asm': LIB.replace('lda value', 'lda nothing'), 'lib/data.asm': DATA }, 'game.asm', 'kickass');
    expect(bad.ok).toBe(false);
    expect(bad.problems[0]).toMatchObject({ file: 'lib/print.asm', line: 11 });
  });

  it('runs it in Mimir\'s 6510: CHROUT prints on the screen, code copied elsewhere sees the program\'s bytes', () => {
    const c = checkAsm({ 'game.asm': MAIN, 'lib/print.asm': LIB, 'lib/data.asm': DATA }, 'game.asm', 'kickass');
    const m = asmMachine(c, 'kickass');
    expect(m.runUntil(null)).toBe('ended');
    const r = m.result();
    expect(r.end).toBe('rts');
    // HELLO in screen codes, in the top row
    expect(Array.from(r.screen!.codes.slice(0, 5))).toEqual([8, 5, 12, 12, 15]);
    // the routine copied to $c000 read value ($2a) from the program and wrote it to the screen
    expect(r.mem[0x0428]).toBe(0x2a);
    expect(asmEndText(r, () => null, () => true)).toMatch(/^Returned with an RTS/);
  });

  it('says a call into the ROMs, which the run does not have', () => {
    const c = checkAsm({ 'a.asm': '* = $c000\n  jsr $ffe4\n  rts\n' }, 'a.asm', 'kickass');
    expect(c.entryFrom).toBe('first');
    const m = asmMachine(c, 'kickass');
    m.runUntil(null);
    const r = m.result();
    expect(r.end).toBe('brk');
    expect(asmEndText(r, () => null, a => !!c.asm.written[a])).toMatch(/called the KERNAL ROM/);
  });

  it('checks 64tass sources too', () => {
    const c = checkAsm({ 'main.s': '* = $c000\nstart\n  lda #1\n  .include "two.s"\n  rts\n', 'two.s': '  sta $d020\n' }, 'main.s', '64tass');
    expect(c.problems).toEqual([]);
    expect(c.entry).toBe(0xc000);
    expect(asmLineAt(c, 0xc002)).toEqual({ file: 'two.s', line: 1 });
  });
});

describe('a new folder\'s first source', () => {
  for (const lang of ['kickass', '64tass'] as const) it(`assembles and prints its line in Mimir (${lang})`, async () => {
    const { asmTemplate } = await import('../src/asm-project');
    const text = asmTemplate(lang, 'demo');
    expect(sourceLang(text)).toBe(lang);
    const c = checkAsm({ 'main.asm': text }, 'main.asm', lang);
    expect(c.problems).toEqual([]);
    expect(c.entryFrom).toBe('basic');
    expect(c.entry).toBe(c.names.get('start'));
    const m = asmMachine(c, lang);
    m.runUntil(null);
    const r = m.result();
    expect(r.end).toBe('rts');
    // HELLO in screen codes at the top left (the screen was cleared first)
    expect(Array.from(r.screen!.codes.slice(0, 5))).toEqual([8, 5, 12, 12, 15]);
  });
});
