/* The Assembler's runs (spec 10.7): the memory of a run in Mimir's 6510 as the program sees it, and the sources as Retro
 * Debugger and C64 Debugger read them. */
import { describe, expect, it } from 'vitest';
import { asmDebugSources, asmMachine, asmMachineMemory, checkAsm } from '../src/asm-project';
import { debugInfoFile } from '../src/c64/debugger-dbg';

const MAIN = `BasicUpstart2(start)\n#import "lib/put.asm"\nstart:  lda #$41\n        jsr put\n        rts\n        * = $3000\ncell:   .byte 0\n`;
const LIB = `put:    sta $3000\n        rts\n`;

describe('the Assembler\'s runs', () => {
  it('gives the memory of a run in Mimir\'s 6510 as the program has it now', () => {
    const c = checkAsm({ 'main.asm': MAIN, 'lib/put.asm': LIB }, 'main.asm', 'kickass');
    expect(c.problems).toEqual([]);
    const m = asmMachine(c, 'kickass');
    expect(asmMachineMemory(m)[0x3000]).toBe(0);
    expect(asmMachineMemory(m)[c.entry!]).toBe(0xa9);
    for (let i = 0; i < 3; i++) m.step();
    expect(asmMachineMemory(m)[0x3000]).toBe(0x41);
  });
  it('gives each file\'s lines and the bytes they made, for the debuggers', () => {
    const c = checkAsm({ 'main.asm': MAIN, 'lib/put.asm': LIB }, 'main.asm', 'kickass');
    const s = asmDebugSources(c, { 'main.asm': MAIN, 'lib/put.asm': LIB });
    expect(s.map(x => x.name)).toEqual(['main.asm', 'lib-put.asm']);
    const main = s[0], start = c.names.get('start')!;
    expect(main.spans).toContainEqual([start, start + 1, 3]);
    expect(main.spans).toContainEqual([0x3000, 0x3000, 7]);
    expect(s[1].spans[0]).toEqual([c.names.get('put')!, c.names.get('put')! + 2, 1]);
    // what Retro Debugger reads: a block for each line, the sources by index
    const dbg = debugInfoFile({ sources: s, breakpoints: [start] }, ['a/main.asm', 'a/lib-put.asm']);
    expect(dbg).toContain('      1,a/lib-put.asm');
    expect(dbg).toContain('      Default,$' + start.toString(16).padStart(4, '0') + ',');
  });
});
