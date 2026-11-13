/* The watch list of a user script (spec 10.3): what its code may change, found in the code, read as a run starts, as a
 * run left it, and as the debugger has it now. */
import { describe, expect, it } from 'vitest';
import { checkScript, runScript, ScriptMachine, scriptStartMemory, scriptWatches, userWatches, watchByte, watchView, type ScriptEnv, type UserScript } from '../src';
import { fromSource } from './helpers/programs';

const program = fromSource('data.prg', ['.pc = $0830', `data:   .byte ${Array.from({ length: 32 }, (_, i) => i).join(', ')}`].join('\n'));
const env: ScriptEnv = { files: [program], names: new Map([['data', 0x0830], ['BORDER', 0xd020], ['ptr_fb', 0xfb]]) };
const script = (lines: string[], pads: UserScript['pads'] = []): Pick<UserScript, 'source' | 'pads'> => ({ source: lines.join('\n'), pads });
const watchesOf = (s: Pick<UserScript, 'source' | 'pads'>) => scriptWatches(checkScript(env, s), s.source, s.pads);

describe('the watch list found in a script\'s code', () => {
  const s = script([
    '* = $c000',
    '        ldx #15',            // 2
    '!:      lda data,x',
    '        eor #$5a',
    '        sta data,x',         // 5: a range
    '        dex',
    '        bpl !-',
    '        lda #2',
    '        sta BORDER',         // 9: a byte (the hardware name as written)
    '        inc counter',        // 10: the script's own data
    '        lda #<data',
    '        sta ptr_fb',         // 12: a byte of the pointer below
    '        lda #>data',
    '        sta ptr_fb+1',       // 14
    '        ldy #3',
    '        lda #$ee',
    '        sta (ptr_fb),y',     // 17: a pointer written through
    '        sta pad1+1',         // 18: a scratchpad
    '        rts',
    'counter: .byte 0',
  ], [{ name: 'pad1', start: 0xc800, size: 16 }]);

  it('finds each address the code writes, an indexed range, its own data, a scratchpad and a pointer with its bytes', () => {
    const w = watchesOf(s);
    expect(w.map(x => x.key)).toEqual(['data,x', 'BORDER', 'counter', '(ptr_fb),y', 'pad1+1']);
    expect(w[0]).toMatchObject({ name: 'data', at: 0x0830, size: 256, index: 'x', space: 'program', lines: [5], how: 'sta data,x' });
    expect(w[1]).toMatchObject({ at: 0xd020, size: 1, space: 'program', lines: [9] });
    expect(w[2]).toMatchObject({ at: 0xc027, size: 1, space: 'own', lines: [10] });
    // the pointer takes in the writes of its two bytes
    expect(w[3]).toMatchObject({ name: 'ptr_fb', at: 0xfb, size: 2, word: true, ptr: true, index: 'y', space: 'zp', lines: [12, 14, 17] });
    expect(w[4]).toMatchObject({ at: 0xc801, space: 'pad', pad: 'pad1' });
  });

  it('makes name and name+1 a word, a read-only pointer the code moves a pointer, and names by address an operand that writes several', () => {
    const w = watchesOf(script([
      '.const total = $3000',
      '.const src = $fd',
      '        inc total',
      '        bne !+',
      '        inc total+1',
      '!:      lda (src),y',         // only read through …
      '        inc src+1',           // … but moved: on the list
      '        lda ($02),y',         // read through, never moved: not on the list
      '.for (var i = 0; i < 3; i++) { sta $0400 + i * 40 }',
      '        sta $0500,x',
      '        sta $0500',           // in the range above
      '        rts',
    ]));
    expect(w.map(x => x.key)).toEqual(['total', '(src),y', '$0400', '$0428', '$0450', '$0500,x']);
    expect(w[0]).toMatchObject({ at: 0x3000, size: 2, word: true, lines: [3, 5] });
    expect(w[1]).toMatchObject({ at: 0xfd, ptr: true, readsThrough: true, lines: [6, 7] });
    expect(w[5]).toMatchObject({ at: 0x0500, size: 256, lines: [10, 11] });
  });

  it('a zero-page index wraps in the zero page', () => {
    const w = watchesOf(script(['        sta $f0,x', '        rts']));
    expect(w).toEqual([expect.objectContaining({ key: '$f0,x', at: 0xf0, size: 256, wrap: true, space: 'zp' })]);
  });

  it('reads the spots as the run starts and as it left them: the row of a range is where the first change is', () => {
    const check = checkScript(env, s);
    const w = scriptWatches(check, s.source, s.pads);
    const start = scriptStartMemory(env, s, check);
    const run = runScript(env, s, check);
    const after = { mem: run.mem, own: run.own, mine: start.mine, code: start.code };
    const o = { ref: start, start };
    const [range, border, counter, ptr, pad] = w.map(x => watchView(x, after, o));
    expect(range).toMatchObject({ changed: 16, of: 256, row: { at: 0x0830, bytes: [0x5a, 0x5b, 0x58, 0xee, 0x5e, 0x5f, 0x5c, 0x5d], was: [0, 1, 2, 3, 4, 5, 6, 7] } });
    expect(border).toEqual({ value: 2, was: 0 });
    expect(counter).toEqual({ value: 1, was: 0 });
    // the run set the pointer (it was $0000): its bytes are where it points now, with the $ee written at data+3
    expect(ptr).toMatchObject({ value: 0x0830, was: 0x0000, changed: 16, of: 256, row: { at: 0x0830, bytes: [0x5a, 0x5b, 0x58, 0xee, 0x5e, 0x5f, 0x5c, 0x5d] } });
    expect(pad).toEqual({ value: 0xee, was: 0 });
    expect(watchByte(after, 0x0833)).toBe(0xee);
  });

  it('debugging, a range\'s row follows the index and a pointer\'s bytes are where it points now', () => {
    const check = checkScript(env, s);
    const w = scriptWatches(check, s.source, s.pads);
    const m = new ScriptMachine(env, s, check);
    m.runUntil(x => x.cpu.x === 9 && x.inScript && x.lineAt() === 5);
    expect(watchView(w[0], m, { regs: m.cpu }).row!.at).toBe(0x0838);
    m.runUntil(x => x.lineAt() === 18);
    const p = watchView(w[3], m, { regs: m.cpu });
    expect(p.value).toBe(0x0830);
    expect(p.row).toEqual({ at: 0x0830, bytes: [0x5a, 0x5b, 0x58, 0xee, 0x5e, 0x5f, 0x5c, 0x5d] });
  });

  it('starts as a ScriptMachine does', () => {
    const withInit = { ...s, init: { zp: [{ at: 0xfb, value: 0x1234, word: true }] } };
    const check = checkScript(env, withInit);
    const m = new ScriptMachine(env, withInit, check), start = scriptStartMemory(env, withInit, check);
    for (const k of ['mem', 'own', 'mine', 'code'] as const) expect(start[k]).toEqual(m[k]);
    expect(watchView(watchesOf(withInit)[3], start)).toMatchObject({ value: 0x1234 });
  });

  it('reads what the user added with the names as they are now', () => {
    const check = checkScript(env, s);
    const names = new Map([...env.names, ['counter', 0xc027]]);
    const u = userWatches([{ expr: 'data+4', size: 8 }, { expr: 'counter' }, { expr: 'ptr_fb', ptr: true }, { expr: 'gone' }], e => {
      const m = /^(\w+)(?:\+(\d+))?$/.exec(e); const v = m ? names.get(m[1]) : undefined;
      return v == null ? null : v + Number(m![2] ?? 0);
    }, check, s.pads);
    expect(u.map(x => [x.key, x.at, x.size, x.space])).toEqual([['+data+4@8', 0x0834, 8, 'program'], ['+counter', 0xc027, 1, 'own'], ['+ptr_fb@ptr', 0xfb, 2, 'zp'], ['+gone', 0, 1, 'program']]);
    expect(u[2]).toMatchObject({ ptr: true, word: true, user: true });
    expect(u[3].error).toMatch(/names no address/);
    expect(watchView(u[3], scriptStartMemory(env, s, check))).toEqual({});
  });
});
