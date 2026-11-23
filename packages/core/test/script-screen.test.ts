/* A script's C64 screen (spec 10.3): the KERNAL's screen editor on 40×25 (or larger) cells, `screen` in JavaScript,
 * CHROUT and the other printing routines in a run in memory, and the whole C64's own screen. */
import { describe, expect, it } from 'vitest';
import { c64Color, checkScript, runJs, runScript, runScriptInC64, ScriptMachine, SCREEN_C64, screenSize, screenTraps, textPetscii, TextScreen, type ScriptEnv, type ScriptScreen, type UserScript } from '../src';
import { findC64Roms } from '../src/node';
import { fromSource } from './helpers/programs';

/** a row of a screen as text (screen codes 1-26 as A-Z, $20-$3f as themselves, inverse ones too; others `·`) */
const rowText = (s: Pick<ScriptScreen, 'cols' | 'codes'>, row: number): string =>
  [...s.codes.subarray(row * s.cols, (row + 1) * s.cols)].map(c => { const k = c & 0x7f; return k >= 1 && k <= 26 ? String.fromCharCode(64 + k) : k >= 0x20 && k < 0x40 ? String.fromCharCode(k) : k === 0 ? '@' : '·'; }).join('').trimEnd();
const at = (s: Pick<ScriptScreen, 'cols'>, col: number, row: number) => row * s.cols + col;

const empty: ScriptEnv = { files: [], names: new Map() };
const asm = (source: string[], pads: UserScript['pads'] = []): UserScript => ({ id: 's', name: 's', lang: 'kickass', source: source.join('\n'), pads });

describe('the screen editor', () => {
  it('prints text at the cursor in the cursor\'s colour, RETURN going to the next row', () => {
    const s = new TextScreen();
    expect([s.cols, s.rows]).toEqual([40, 25]);
    s.text('Hello, C64!\nREADY.');
    expect(rowText(s, 0)).toBe('HELLO, C64!');
    expect(rowText(s, 1)).toBe('READY.');
    expect(s.colors[0]).toBe(14);
    expect([s.col, s.row]).toEqual([6, 1]);
    expect(s.wrote).toBe(true);
  });

  it('has the colour codes, RVS ON and OFF, CLR and HOME, and the cursor moves', () => {
    const s = new TextScreen();
    s.text('\x1cRED \x12INV\x92 \x05W');
    expect(s.colors[0]).toBe(2);
    expect(s.codes[4]).toBe(0x89); // I inverse
    expect(s.codes[8]).toBe(0x17); // W
    expect(s.colors[8]).toBe(1);
    s.out(0x13); s.out(0x11); s.out(0x1d); s.text('X');
    expect(s.codes[at(s, 1, 1)]).toBe(0x18);
    s.out(0x93);
    expect(rowText(s, 0)).toBe('');
    expect([s.col, s.row]).toEqual([0, 0]);
    // CLR fills the colour RAM with the cursor's colour (white now)
    expect(s.colors.every(c => c === 1)).toBe(true);
  });

  it('shows control codes inverse in quotes, as the C64 does', () => {
    const s = new TextScreen();
    s.text('"\x93"');
    expect([...s.codes.subarray(0, 3)]).toEqual([0x22, 0xd3, 0x22]);
  });

  it('makes a logical line of two rows past the 40th column, and scrolls up past the last row', () => {
    const s = new TextScreen();
    s.text('A'.repeat(45));
    expect(rowText(s, 0)).toBe('A'.repeat(40));
    expect(rowText(s, 1)).toBe('AAAAA');
    for (let i = 0; i < 30; i++) s.text(`\nLINE ${i}`);
    expect(rowText(s, 24)).toBe('LINE 29');
    expect(rowText(s, 0)).toBe('LINE 5');
    expect(s.row).toBe(24);
  });

  it('is larger in extended mode, never smaller than 40×25', () => {
    expect(screenSize({ cols: 10, rows: 3 })).toEqual(SCREEN_C64);
    expect(screenSize({ cols: 80, rows: 50 })).toEqual({ cols: 80, rows: 50 });
    expect(screenSize({ cols: 9999, rows: 9999 })).toEqual({ cols: 240, rows: 120 });
    const s = new TextScreen({ cols: 80, rows: 30 });
    s.text('X'.repeat(85));
    expect(rowText(s, 0)).toBe('X'.repeat(80));
    expect(rowText(s, 1)).toBe('XXXXX');
  });

  it('writes text as letters in either character set', () => {
    expect(textPetscii('a', false)).toBe(0x41);
    expect(textPetscii('A', false)).toBe(0x41);
    expect(textPetscii('A', true)).toBe(0xc1);
    expect(textPetscii('a', true)).toBe(0x41);
    expect(textPetscii('_', false)).toBe(0xa4);
    expect(textPetscii('£', false)).toBe(0x5c);
    expect(textPetscii('─', false)).toBe(0xc0);
    expect(textPetscii('一', false)).toBeNull();
    const s = new TextScreen();
    s.text('\x0eHello');
    expect([...s.codes.subarray(0, 5)]).toEqual([0x48, 0x05, 0x0c, 0x0c, 0x0f]);
    expect(s.lower).toBe(true);
  });

  it('knows the C64\'s colours by name', () => {
    expect(c64Color('light blue')).toBe(14);
    expect(c64Color('lightBlue')).toBe(14);
    expect(c64Color('dark_grey')).toBe(11);
    expect(c64Color('gray')).toBe(12);
    expect(c64Color(17)).toBe(1);
    expect(() => c64Color('mauve')).toThrow(/no colour/);
  });
});

describe('screen in a JavaScript script', () => {
  it('prints, moves, colours and pokes; the run keeps what it left', () => {
    const r = runJs(empty, { source: [
      'screen.border = "black"; screen.background = 0; screen.color = "yellow";',
      'screen.print("Hello", 64);',
      'screen.write("A"); screen.write("B");',
      'screen.at(10, 5); screen.reverse = true; screen.write("R");',
      'screen.poke(39, 24, 0x51, "red");',
      'print(screen.cols, screen.rows, screen.peek(39, 24), screen.col, screen.row);',
    ].join('\n'), pads: [] });
    expect(r.error).toBeUndefined();
    const s = r.screen!;
    expect(s).toMatchObject({ cols: 40, rows: 25, border: 0, background: 0, wrote: true });
    expect(rowText(s, 0)).toBe('HELLO 64');
    expect(s.colors[0]).toBe(7);
    expect(rowText(s, 1)).toBe('AB');
    expect(s.codes[at(s, 10, 5)]).toBe(0x92);
    expect(s.codes[at(s, 39, 24)]).toBe(0x51);
    expect(s.colors[at(s, 39, 24)]).toBe(2);
    expect(r.prints).toEqual(['40 25 81 11 5']);
  });

  it('is larger when the run is given a larger size', () => {
    const r = runJs(empty, { source: 'screen.print(screen.cols + "x" + screen.rows);', pads: [] }, { screen: { cols: 64, rows: 30 } });
    expect(r.screen).toMatchObject({ cols: 64, rows: 30 });
    expect(rowText(r.screen!, 0)).toBe('64X30');
  });

  it('shows a screen of the program\'s memory and its own character set', () => {
    const prog = fromSource('pic.prg', ['.pc = $2000', 'pic: .fill 1000, i & 255', 'cols: .fill 1000, 5', 'font: .fill 2048, $ff'].join('\n'));
    const env: ScriptEnv = { files: [prog], names: new Map([['pic', 0x2000], ['cols', 0x23e8], ['font', 0x27d0]]) };
    const r = runJs(env, { source: 'screen.show("pic", "cols"); screen.charset("font");', pads: [] });
    expect(r.error).toBeUndefined();
    expect([...r.screen!.codes.subarray(0, 4)]).toEqual([0, 1, 2, 3]);
    expect(r.screen!.colors[999]).toBe(5);
    expect(r.screen!.font?.length).toBe(2048);
    expect(r.screen!.font?.[0]).toBe(0xff);
  });

  it('says what is wrong with a cell off the screen or a colour it does not have', () => {
    expect(runJs(empty, { source: 'screen.at(40, 0);', pads: [] }).error?.msg).toMatch(/column 40, row 0 is not on the screen/);
    expect(runJs(empty, { source: 'screen.color = "mauve";', pads: [] }).error?.msg).toMatch(/screen.color: "mauve" is no colour/);
  });

  it('has nothing for a run that did not print on it', () => {
    expect(runJs(empty, { source: 'print(1);', pads: [] }).screen).toBeUndefined();
  });

  it('has what the program\'s own routine prints through CHROUT (cpu.call)', () => {
    const prog = fromSource('say.prg', ['.pc = $0810', 'say:  ldx #0', 'loop: lda text,x', '      beq done', '      jsr $ffd2', '      inx', '      bne loop', 'done: rts', 'text: .byte $48, $49, $0d, $1c, $4f, $4b, 0'].join('\n'));
    const env: ScriptEnv = { files: [prog], names: new Map([['say', 0x0810]]) };
    const r = runJs(env, { source: 'cpu.call("say"); cpu.call(0xffd2, { a: 0x21 });', pads: [] });
    expect(r.error).toBeUndefined();
    expect(rowText(r.screen!, 0)).toBe('HI');
    expect(rowText(r.screen!, 1)).toBe('OK!');
    expect(r.screen!.colors[at(r.screen!, 0, 1)]).toBe(2);
  });
});

describe('the printing routines in a run in memory', () => {
  it('are CHROUT, STROUT, LINPRT and PLOT, as the KERNAL and BASIC have them', () => {
    const s = asm(['* = $c000',
      'start:  lda #$93', '        jsr $ffd2', '        lda #$48', '        jsr $ffd2', '        lda #$49', '        jsr $ffd2',
      '        lda #<text', '        ldy #>text', '        jsr $ab1e',
      '        lda #>1234', '        ldx #<1234', '        jsr $bdcd',
      '        ldx #10', '        ldy #3', '        clc', '        jsr $fff0', '        lda #$2a', '        jsr $ffd2',
      '        sec', '        jsr $fff0', '        stx $c100', '        sty $c101',
      '        rts',
      'text:   .byte $0d, $41, $42, $20, 0']);
    const c = checkScript(empty, s);
    expect(c.ok).toBe(true);
    const r = runScript(empty, s, c);
    expect(r.end).toBe('rts');
    expect(rowText(r.screen!, 0)).toBe('HI');
    expect(rowText(r.screen!, 1)).toBe('AB 1234');
    expect(r.screen!.codes[at(r.screen!, 3, 10)]).toBe(0x2a);
    expect([r.own[0xc100] || r.mem[0xc100], r.own[0xc101] || r.mem[0xc101]]).toEqual([10, 4]);
  });

  it('end the run when the script jumps to one to end, and are left to the program where it has bytes', () => {
    const r = runScript(empty, asm(['* = $c000', 'start: lda #$41', '       jmp $ffd2']));
    expect(r.end).toBe('rts');
    expect(rowText(r.screen!, 0)).toBe('A');
    // a program with its own code at $ffd2 (RAM under the KERNAL): its RTS there, nothing printed
    const prog = fromSource('own.prg', ['.pc = $ffd0', '  nop', '  nop', '  rts'].join('\n'));
    const env: ScriptEnv = { files: [prog], names: new Map() };
    expect(screenTraps(env.files)[0xffd2]).toBe(0);
    expect(screenTraps(env.files)[0xab1e]).toBe(1);
    const own = runScript(env, asm(['* = $c000', 'start: lda #$41', '       jsr $ffd2', '       rts']));
    expect(own.end).toBe('rts');
    expect(own.screen).toBeUndefined();
  });

  it('print on the debugger\'s screen as it steps, a JSR to one being one step', () => {
    const s = asm(['* = $c000', 'start: lda #$41', '       jsr $ffd2', '       lda #$42', '       rts']);
    const m = new ScriptMachine(empty, s, checkScript(empty, s), undefined, { cols: 50, rows: 30 });
    expect([m.screen.cols, m.screen.rows]).toEqual([50, 30]);
    m.step(); m.step();
    expect(m.cpu.pc).toBe(0xc005);
    expect(m.screen.codes[0]).toBe(0x01);
    expect(m.lineAt()).toBe(4);
    m.runUntil(null);
    expect(m.end).toBe('rts');
    expect(m.result().screen?.cols).toBe(50);
  });
});

const roms = findC64Roms();
describe.skipIf(!roms)('the screen of a run in the whole C64', () => {
  it('is the C64\'s own, as its VIC shows it: what the KERNAL printed', () => {
    const s = asm(['* = $c000', 'start:  lda #$93', '        jsr $ffd2', '        ldx #0', 'loop:   lda text,x', '        beq done', '        jsr $ffd2', '        inx', '        bne loop',
      'done:   lda #0', '        sta $d020', '        rts', 'text:   .byte $1c, $48, $45, $4c, $4c, $4f, 0']);
    const r = runScriptInC64(empty, s, { roms: roms! });
    expect(r.end).toBe('rts');
    expect(r.screen).toMatchObject({ cols: 40, rows: 25, c64: true, wrote: true, border: 0, background: 6, cursor: null });
    expect(rowText(r.screen!, 0)).toBe('HELLO');
    expect(r.screen!.colors[0]).toBe(2);
    expect(r.screen!.font).toBeUndefined();
  });
});

describe('a JavaScript script that names something screen itself', () => {
  it('keeps its own (scripts written before screen was given still run), and its errors keep their lines', () => {
    const r = runJs(empty, { source: 'const screen = ["A", "B"];\nprint(screen.length);', pads: [] });
    expect(r.error).toBeUndefined();
    expect(r.prints).toEqual(['2']);
    expect(r.screen).toBeUndefined();
    expect(runJs(empty, { source: 'print(1);\nnope();', pads: [] }).error).toEqual({ msg: 'ReferenceError: nope is not defined', line: 2 });
  });
});
