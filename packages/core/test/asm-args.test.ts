/* An Assembler project's own arguments for the assembler (spec 10.7): kept in Project.asm, and the defines in them are
 * Mimir's own check's too (Kick Assembler's -define NAME, 64tass's -D NAME=value), so it gives the program the build
 * makes. */
import { describe, expect, it } from 'vitest';
import { asmArgDefines, checkAsm } from '../src/asm-project';
import { createProject, deserializeProject, serializeProject } from '../src/project';
import { splitArgs } from '../src/util/args';

const bytes = (c: ReturnType<typeof checkAsm>) => c.ranges.flatMap(r => [...c.asm.mem.slice(r.start, r.end)]);

describe('the defines in the arguments', () => {
  it('Kick Assembler: -define NAME, the rest left to the build', () => {
    expect(asmArgDefines('kickass', splitArgs('-showmem -define DEBUG -vicesymbols -define LEVEL_2'))).toEqual([{ name: 'DEBUG' }, { name: 'LEVEL_2' }]);
    // (a name -define cannot have, and one at the end without a name)
    expect(asmArgDefines('kickass', ['-define', '2x', '-define'])).toEqual([]);
  });
  it('64tass: -D NAME=value and -DNAME=value, -D NAME as 0', () => {
    expect(asmArgDefines('64tass', splitArgs('-a -D DEBUG=1 -DSPEED=$c0+1 -D FLAG'))).toEqual([
      { name: 'DEBUG', value: '1' }, { name: 'SPEED', value: '$c0+1' }, { name: 'FLAG' },
    ]);
    expect(asmArgDefines('64tass', ['-D', 'DEBUG = 2'])).toEqual([{ name: 'DEBUG', value: '2' }]);
    // (Kick Assembler's form is not 64tass's)
    expect(asmArgDefines('64tass', ['-define', 'DEBUG'])).toEqual([]);
  });
});

describe('the check with the arguments', () => {
  const kick = `* = $1000
#if DEBUG
 inc $d020
#endif
#if !DEBUG && !QUIET
 nop
#endif
 rts
`;
  it('Kick Assembler: #if sees what -define defines', () => {
    expect(bytes(checkAsm({ 'main.asm': kick }, 'main.asm', 'kickass'))).toEqual([0xea, 0x60]);
    expect(bytes(checkAsm({ 'main.asm': kick }, 'main.asm', 'kickass', { args: ['-define', 'DEBUG'] }))).toEqual([0xee, 0x20, 0xd0, 0x60]);
    expect(bytes(checkAsm({ 'main.asm': kick }, 'main.asm', 'kickass', { args: ['-define', 'QUIET'] }))).toEqual([0x60]);
    // a #define in the code as well is no problem, and #undef takes it away
    const c = checkAsm({ 'main.asm': `#define DEBUG\n#undef DEBUG\n${kick}` }, 'main.asm', 'kickass', { args: ['-define', 'DEBUG'] });
    expect(c.problems).toEqual([]);
    expect(bytes(c)).toEqual([0xea, 0x60]);
  });
  const tass = `* = $1000
.weak
SPEED = 1
.endweak
.if DEBUG
 inc $d020
.fi
 lda #SPEED
 rts
`;
  it('64tass: -D NAME=value is a constant before the first line, stronger than one in .weak', () => {
    const c = checkAsm({ 'main.asm': tass }, 'main.asm', '64tass', { args: ['-D', 'DEBUG=1', '-D', 'SPEED=2*3'] });
    expect(c.problems).toEqual([]);
    expect(bytes(c)).toEqual([0xee, 0x20, 0xd0, 0xa9, 6, 0x60]);
    expect(bytes(checkAsm({ 'main.asm': tass }, 'main.asm', '64tass', { args: ['-DDEBUG=0'] }))).toEqual([0xa9, 1, 0x60]);
    // -D DEBUG: 0, as 64tass gives it
    expect(bytes(checkAsm({ 'main.asm': tass }, 'main.asm', '64tass', { args: ['-D', 'DEBUG'] }))).toEqual([0xa9, 1, 0x60]);
    // without it the code has no DEBUG
    expect(checkAsm({ 'main.asm': tass }, 'main.asm', '64tass').ok).toBe(false);
  });
  it('64tass: the code defining it again is an error, as in 64tass; a bad value the command line\'s', () => {
    const twice = checkAsm({ 'main.asm': '* = $1000\nDEBUG = 3\n .byte DEBUG\n' }, 'main.asm', '64tass', { args: ['-D', 'DEBUG=5'] });
    expect(twice.problems.map(p => [p.file, p.line, p.msg])).toEqual([['main.asm', 2, "duplicate definition 'DEBUG'"]]);
    const bad = checkAsm({ 'main.asm': '* = $1000\n .byte DEBUG\n' }, 'main.asm', '64tass', { args: ['-D', 'DEBUG=1+'] });
    expect(bad.ok).toBe(false);
    expect(bad.problems[0].file).toBe('<command line>');
  });
});

describe('the arguments in Project.asm', () => {
  it('are kept with the project, trimmed; none: not written', () => {
    const p = createProject({ name: 'game', files: [], asm: { lang: '64tass', main: 'main.asm', args: '  -D DEBUG=1 ' } });
    expect(p.asm).toEqual({ lang: '64tass', main: 'main.asm', args: '-D DEBUG=1' });
    const s = serializeProject(p);
    expect(s.asm).toEqual({ lang: '64tass', main: 'main.asm', args: '-D DEBUG=1' });
    expect(deserializeProject(JSON.parse(JSON.stringify(s))).asm).toEqual({ lang: '64tass', main: 'main.asm', args: '-D DEBUG=1' });
    const q = serializeProject(createProject({ name: 'game', files: [], asm: { lang: 'kickass', args: ' ' } }));
    expect(q.asm).toEqual({ lang: 'kickass' });
  });
});
