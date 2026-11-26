/* What an Assembler project's sources import from outside its folder (spec 10.7): the check says which files it looked
 * for and has not (the Assembler reads them and checks again); and the Kick Assembler forms such libraries use:
 * BasicUpstart, statements after ; and an operand right after the mnemonic. */
import { describe, expect, it } from 'vitest';
import { asmArgLibdirs, checkAsm } from '../src/asm-project';

const bytes = (c: ReturnType<typeof checkAsm>) => c.ranges.flatMap(r => [...c.asm.mem.slice(r.start, r.end)]);

describe('a library outside the folder', () => {
  const main = ['#import "C:\\c64lib\\macros.asm"', '.pc = $0801 "Basic Upstart"', 'BasicUpstart(start)', '.pc = $0810 "Main"', 'start: Border(2)', '        rts', ''].join('\n');
  it('the check says which file it looked for, by the name the source gives it', () => {
    const c = checkAsm({ 'main.asm': main }, 'main.asm', 'kickass');
    expect(c.ok).toBe(false);
    expect(c.missing).toContain('C:\\c64lib\\macros.asm');
  });
  it('given it, the program assembles: its macros, ; between statements, lda#c', () => {
    const c = checkAsm({ 'main.asm': main, 'C:\\c64lib\\macros.asm': '.macro Border(c) {lda#c;sta$d020}\n' }, 'main.asm', 'kickass');
    expect(c.problems).toEqual([]);
    expect(c.missing).toEqual([]);
    expect(bytes(c)).toEqual([0x0b, 0x08, 0x0a, 0x00, 0x9e, 0x32, 0x30, 0x36, 0x34, 0x00, 0x00, 0x00, 0xa9, 0x02, 0x8d, 0x20, 0xd0, 0x60]);
  });
  it('the library folders of the arguments: -libdir for Kick Assembler, -I for 64tass', () => {
    expect(asmArgLibdirs('kickass', ['-showmem', '-libdir', 'C:\\c64lib', '-libdir', '../lib'])).toEqual(['C:\\c64lib', '../lib']);
    expect(asmArgLibdirs('64tass', ['-I', 'inc', '-Ilib', '-a'])).toEqual(['inc', 'lib']);
  });
});

describe('Kick Assembler\'s forms libraries use', () => {
  it('BasicUpstart where the program counter is, :BasicUpstart2 with a colon', () => {
    expect(bytes(checkAsm({ 'm.asm': '* = $1000\nBasicUpstart($c000)\n' }, 'm.asm', 'kickass'))).toEqual([0x0b, 0x10, 0x0a, 0x00, 0x9e, 0x34, 0x39, 0x31, 0x35, 0x32, 0x00, 0x00, 0x00]);
    expect(bytes(checkAsm({ 'm.asm': ':BasicUpstart2(start)\nstart: rts\n' }, 'm.asm', 'kickass')).slice(-1)).toEqual([0x60]);
    // one of the code's own is the code's
    const own = checkAsm({ 'm.asm': '.macro BasicUpstart(a) { .byte a }\n* = $1000\nBasicUpstart(7)\n' }, 'm.asm', 'kickass');
    expect(own.problems).toEqual([]);
    expect(bytes(own)).toEqual([7]);
  });
  it('statements after ; on a line, not in .for\'s parentheses', () => {
    const c = checkAsm({ 'm.asm': '* = $1000\nloop: nop; nop; inx\n.for (var i=0; i<2; i++) { nop; dey }\n' }, 'm.asm', 'kickass');
    expect(c.problems).toEqual([]);
    expect(bytes(c)).toEqual([0xea, 0xea, 0xe8, 0xea, 0x88, 0xea, 0x88]);
  });
  it('an operand right after the mnemonic when it starts with # $ or %', () => {
    expect(bytes(checkAsm({ 'm.asm': '* = $1000\n lda#$35\n sta$01\n ora#(3+1)\n lda$12,x\n' }, 'm.asm', 'kickass'))).toEqual([0xa9, 0x35, 0x85, 0x01, 0x09, 0x04, 0xb5, 0x12]);
  });
});
