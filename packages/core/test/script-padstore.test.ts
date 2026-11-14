/* A store of a script's code written into a scratchpad too (spec 10.3): the store found on its line, the copy's line,
 * why a store cannot be copied, and a run where the scratchpad holds what the store wrote. */
import { describe, expect, it } from 'vitest';
import { checkScript, padStoreAt, padStoreLine, padStoreReach, runScript, type PadStore, type ScriptEnv, type UserScript } from '../src';
import { fromSource } from './helpers/programs';

const pads = [{ name: 'pad1' }, { name: 'pad2' }];
const at = (lines: string[], n: number, ps = pads) => padStoreAt(lines, n, ps);
const store = (lines: string[], n: number, ps = pads) => { const r = at(lines, n, ps); if (!r || 'why' in r) throw new Error(`no store: ${JSON.stringify(r)}`); return r; };
const why = (lines: string[], n: number) => { const r = at(lines, n); return r && 'why' in r ? r.why : null; };

describe('a store found on its line', () => {
  it('finds sta $ff40,x and writes its copy under it', () => {
    const lines = ['loop_4016:', '        lda tbl_3100,x', '        sta $ff40,x', '        dex'];
    const s = store(lines, 3);
    expect(s).toMatchObject({ line: 3, mn: 'sta', operand: '$ff40', index: 'x', into: [], after: 3 });
    expect(padStoreLine(s, 'pad2')).toBe('        sta pad2,x');
    expect(padStoreReach(s)).toBe(256);
  });

  it('keeps how it is written: the case, a label before it (as spaces), tabs, a comment and a .z ending left out', () => {
    expect(padStoreLine(store(['loop:   STA $0400,X'], 1), 'pad1')).toBe('        STA pad1,X');
    expect(padStoreLine(store(['!:      sta screen+40,y // the row'], 1), 'pad1')).toBe('        sta pad1,y');
    expect(padStoreLine(store(['\tsty $d020'], 1), 'pad1')).toBe('\tsty pad1');
    expect(padStoreLine(store(['\tsta.z $40,x'], 1), 'pad1')).toBe('\tsta pad1,x');
    const one = store(['        stx BORDER'], 1);
    expect(one).toMatchObject({ operand: 'BORDER', index: '' });
    expect(padStoreReach(one)).toBe(1);
    expect(padStoreLine(store(['        sax $1000'], 1), 'pad1')).toBe('        sax pad1');
  });

  it('is null for a line that writes no memory', () => {
    for (const l of ['        lda $ff40,x', '        asl', '        rol a', '        .byte 1, 2', '// sta $0400,x', '', '        jmp $c000', '        sta #1'])
      expect(at([l], 1), l).toBeNull();
    // in a block comment an earlier line opened
    expect(at(['/* the old loop:', '        sta $0400,x', '*/', '        sta $0500,x'], 2)).toBeNull();
    expect(at(['/* the old loop:', '        sta $0400,x', '*/', '        sta $0500,x'], 4)).not.toBeNull();
    expect(at(['        lda #"/*"', '        sta $0400,x'], 2)).not.toBeNull();
  });

  it('says why a store cannot be copied', () => {
    expect(why(['        sta ($fb),y'], 1)).toMatch(/pointer \(\$fb\)/);
    expect(why(['        sta ($fb,x)'], 1)).toMatch(/pointer/);
    expect(why(['        stx $40,y'], 1)).toMatch(/no ,y form/);
    expect(why(['        sty $40,x'], 1)).toMatch(/no ,x form/);
    expect(why(['        inc $d020,x'], 1)).toMatch(/inc changes the byte where it is.*lda \$d020,x/);
    expect(why(['        shx $1000,y'], 1)).toMatch(/unstable/);
    expect(why(['        sta pad1,x'], 1)).toMatch(/scratchpad pad1 already/);
    expect(why(['        sta pad2_end-1'], 1)).toMatch(/scratchpad pad2 already/);
  });

  it('knows the copies right after it, and a new one goes after them', () => {
    const lines = ['        sta $ff40,x', '        sta pad1,x', '        STA pad2,X', '        sta pad1,y', '        dex'];
    const s = store(lines, 1);
    expect(s.into).toEqual([{ pad: 'pad1', line: 2 }, { pad: 'pad2', line: 3 }]);
    expect(s.after).toBe(3);
    // another store, another index register or another address is not a copy
    expect(store(['        sta $0400,x', '        stx pad1,x'], 1).into).toEqual([]);
    expect(store(['        sta $0400,x', '        sta pad1+1,x'], 1).into).toEqual([]);
  });
});

describe('a run with the copy', () => {
  // the program: a table at $3100 the loop copies to $ff40
  const program = fromSource('tbl.prg', ['.pc = $3100', `tbl_3100: .byte ${Array.from({ length: 64 }, (_, i) => (i * 7 + 3) & 0xff).join(', ')}`].join('\n'));
  const env: ScriptEnv = { files: [program], names: new Map([['tbl_3100', 0x3100]]) };

  it('fills the scratchpad with what the store wrote, byte for byte', () => {
    const lines = ['        ldx #$3f', 'loop_4016:', '        lda tbl_3100,x', '        sta $ff40,x', '        dex', '        cpx #$ff', '        bne loop_4016', '        rts'];
    const ps: UserScript['pads'] = [{ name: 'pad1', start: 0xc000, size: 0x100 }];
    const s = store(lines, 4, ps) as PadStore;
    const withCopy = [...lines.slice(0, s.after), padStoreLine(s, 'pad1'), ...lines.slice(s.after)];
    expect(withCopy[4]).toBe('        sta pad1,x');
    const script = { source: withCopy.join('\n'), pads: ps };
    const check = checkScript(env, script);
    expect(check.ok, JSON.stringify(check.problems)).toBe(true);
    const run = runScript(env, script, check);
    const want = [...program.bytes.subarray(0, 64)];
    expect([...run.mem.subarray(0xff40, 0xff40 + 64)]).toEqual(want);
    expect([...run.pads[0].bytes.subarray(0, 64)]).toEqual(want);
    // after it, the store's line says the copy is there
    expect(store(withCopy, 4, ps).into).toEqual([{ pad: 'pad1', line: 5 }]);
  });
});
