/* Routines known from other projects (spec 10.5): a named routine's fingerprint, with the addresses that move with the
 * program masked, finds the routine again in a program linked elsewhere. */
import { describe, expect, it } from 'vitest';
import { analyze, assemble, knownRoutines, learnable, learnProject, learnRoutine, readRoutineLibrary, routineAt, routineSuggestions, sameRoutine, type KnownRoutine, type ProjectInput } from '../src';

/** a program at `pc` with a print routine, a wait for the raster and a short routine; `chrout`: what print calls */
const program = (pc: number, pad: number, chrout = '$ffd2') => {
  const src = `.pc = $${pc.toString(16)}
start:  jsr print
        jsr wait
        jsr short
        jsr copy
        rts
        .fill ${pad}, $ea
print:  ldx #0
        stx $d020
        sty $0286
ploop:  lda text,x
        beq pdone
        jsr ${chrout}
        inx
        bne ploop
pdone:  rts
wait:   bit $d011
        bpl wait
w2:     bit $d011
        bmi w2
        rts
short:  lda #0
        sta $d020
        rts
copy:   ldx #0
cloop:  lda text,x
        sta text+$100,x
        inx
        bne cloop
        rts
text:   .text "hello"
        .byte 0
`;
  const r = assemble({ 'a.asm': src }, 'a.asm');
  expect(r.errors).toEqual([]);
  const at = (n: string) => Number(r.symbols.get(n));
  const p: ProjectInput = { name: 'p', files: [{ name: 'p.prg', load: pc, bytes: r.mem.slice(r.min, r.max + 1) }], entryPoint: pc, settings: {} };
  return { A: analyze(p), at };
};

describe('routines known from other projects', () => {
  const one = program(0xc000, 3), two = program(0x2000, 40);

  it('a fingerprint masks the addresses in the program and keeps the system\'s', () => {
    const r = routineAt(one.A, one.at('print'))!;
    expect(r.end).toBe(one.at('wait'));
    expect(r.n).toBe(9);
    // ldx #0 / stx $d020 / sty $0286 / lda text,x / beq / jsr $ffd2 / inx / bne / rts
    expect(r.pattern).toBe('a2008e20d08c8602bd....f00620d2ffe8d0f560');
    expect(r.opcodes).toBe('a28e8cbdf020e8d060');
    expect(r.fixed).toBe(18);
    expect(learnable(r)).toBe(true);
    expect(routineAt(one.A, one.at('text') + 5)).toBeNull();
  });

  it('a routine goes on past an RTS a branch jumps over, and ends at the first one none does', () => {
    const r = assemble({ 'a.asm': '.pc = $1000\nr: lda $02\n beq z\n rts\nz: inc $d020\n rts\n nop\n rts' }, 'a.asm');
    const A = analyze({ files: [{ name: 'a.prg', load: 0x1000, bytes: r.mem.slice(r.min, r.max + 1) }], entryPoint: 0x1000, entries: [0x1009], settings: {} });
    expect(routineAt(A, 0x1000)).toMatchObject({ end: 0x1009, n: 5 });
  });

  it('too short to know again: a few instructions with masked bytes; the same bytes everywhere are enough at 8', () => {
    expect(learnable(routineAt(one.A, one.at('copy')))).toBe(false);
    expect(learnable(routineAt(one.A, one.at('short')))).toBe(false); // 6 bytes
    const wait = routineAt(one.A, one.at('wait'))!;
    expect(wait.pattern).toBe('2c11d010fb2c11d030fb60');
    expect(learnable(wait)).toBe(true);
  });

  it('names learned in one program are found in another, linked elsewhere', () => {
    const names = { [one.at('print')]: 'print_text', [one.at('wait')]: 'wait_frame', [one.at('short')]: 'black', [one.at('ploop')]: 'inner' };
    const lib = learnProject([], one.A, names, 'first', 5);
    // the short routine and the label inside a routine teach nothing
    expect(lib.map(k => k.name).sort()).toEqual(['print_text', 'wait_frame']);
    expect(lib[0]).toMatchObject({ from: 'first', saved: 5 });
    expect(knownRoutines(two.A, lib)).toEqual([
      { addr: two.at('print'), end: two.at('wait'), name: 'print_text', from: 'first' },
      { addr: two.at('wait'), end: two.at('short'), name: 'wait_frame', from: 'first' },
    ]);
    // another byte that is not masked: another routine
    const other = program(0x3000, 0, '$ffe4');
    expect(knownRoutines(other.A, lib).map(m => m.name)).toEqual(['wait_frame']);
    expect(sameRoutine(lib.find(k => k.name === 'print_text')!, routineAt(other.A, other.at('print'))!, other.A.mem)).toBe(false);
  });

  it('a routine has one name in the library; the same name may have variants', () => {
    const o = program(0x3000, 0, '$ffe4');
    const r = routineAt(one.A, one.at('print'))!, v = routineAt(o.A, o.at('print'))!;
    let lib = learnRoutine([], r, 'print', 'a');
    expect(learnRoutine(lib, r, 'print', 'b')).toBe(lib);
    lib = learnRoutine(lib, r, 'print_text', 'b');
    expect(lib).toEqual([{ name: 'print_text', opcodes: r.opcodes, pattern: r.pattern, from: 'b' }]);
    lib = learnRoutine(lib, v, 'print_text');
    expect(lib).toHaveLength(2);
    expect(learnRoutine(lib, routineAt(one.A, one.at('short')), 'x')).toBe(lib);
  });

  it('suggests only where the user has no name, and never a name twice', () => {
    const m = [{ addr: 1, end: 9, name: 'print' }, { addr: 20, end: 29, name: 'print' }, { addr: 40, end: 49, name: 'wait' }, { addr: 60, end: 69, name: '_x' }, { addr: 80, end: 89, name: 'same' }];
    const s = routineSuggestions(m, { 40: 'mine' }, a => (a === 80 ? 'same' : undefined), ['print_2', 'same'], n => !n.startsWith('_'));
    expect(s.map(x => [x.addr, x.name])).toEqual([[1, 'print'], [20, 'print_3']]);
  });

  it('reads a stored library, leaving out what is not an entry', () => {
    const ok: KnownRoutine = { name: 'a', opcodes: 'a960', pattern: 'a9..60', from: 'p', saved: 3 };
    expect(readRoutineLibrary([ok, { name: '', opcodes: 'a9', pattern: 'a9' }, { name: 'b', opcodes: 'zz', pattern: 'a9' }, { name: 'c', opcodes: 'a9', pattern: 'a9.' }, null, 4])).toEqual([ok]);
    expect(readRoutineLibrary('x')).toEqual([]);
  });
});
