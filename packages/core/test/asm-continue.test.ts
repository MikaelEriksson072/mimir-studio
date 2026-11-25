/* Continue in the Assembler (spec 10.7): a re-assembled program as an Assembler project's sources, with the blocks the
 * analysis found marked. Mimir's assembler builds them to the program's bytes, and the Assembler sees each block as what
 * the analysis said it is, the rest as code. */
import { describe, expect, it } from 'vitest';
import { analyze, asmBlockMarks, asmProgram, assemblerSources, checkAsm, comparePrg, makePrg, render, type BlockKind } from '../src';
import { cases, demo } from './helpers/cases';

/** what the Assembler makes of a block of the analysis */
const asMarked = (k: BlockKind): BlockKind => (k === 'lohi' ? 'table' : k);

describe('Continue in the Assembler: the program\'s sources with their blocks marked', () => {
  it('marks the demo\'s blocks that are not code, and builds the program', () => {
    const p = demo(), A = analyze(p), s = assemblerSources(A, p);
    expect(s.main).toBe('raster-demo.asm');
    expect(s.lang).toBe('kickass');
    const text = s.files[s.main] as string;
    expect(text).toMatch(/\/\/ @block music init=\$1000 play=\$1003\n/);
    expect(text).toMatch(/\/\/ @block charset/);
    expect(text).toMatch(/\/\/ @end\n/);
    const kinds = new Set(A.blocks.filter(b => b.type !== 'code' && b.type !== 'basic' && b.type !== 'reloc').map(b => b.start));
    expect(s.blocks).toBe(kinds.size);
    // the listing has no marks: only the files do
    expect(render(A, p).files[s.main]).not.toContain('@block');
  });

  it('builds each test program to its bytes in Mimir\'s assembler, each block what the analysis said', () => {
    const failures: string[] = [];
    let n = 0;
    for (const c of cases()) {
      if (c.project.cart) continue;
      const A = analyze(c.project);
      const s = assemblerSources(A, c.project);
      const vfs = Object.fromEntries(Object.entries(s.files));
      const check = checkAsm(vfs, s.main, s.lang);
      if (!check.ok) { failures.push(`${c.name}: ${check.problems.slice(0, 2).map(x => `${x.file}:${x.line} ${x.msg}`).join('; ')}`); continue; }
      const fi = R(c).fileNames.findIndex(x => `${x}.asm` === s.main), f = A.files[fi];
      const cmp = comparePrg(f, check.asm.prg ?? makePrg(0, new Uint8Array()), R(c).excluded.filter(x => x.file === fi));
      if (!cmp.ok) { failures.push(`${c.name}: ${cmp.diffs.length} bytes differ from the program's`); continue; }
      const marks = asmBlockMarks(Object.entries(s.files).filter(([k, v]) => typeof v === 'string' && k.endsWith('.asm')).map(([path, text]) => ({ path, text: text as string }))).marks;
      const prog = asmProgram(check, s.main, marks);
      const typeAt = (a: number) => prog.overrides.find(o => a >= o.start && a < o.end)?.type;
      for (const b of A.blocks) {
        if (A.owner[b.start] !== fi || b.type === 'code' || b.type === 'basic' || b.type === 'reloc' || R(c).excluded.some(x => b.start >= x.start && b.start < x.end)) continue;
        if (!check.asm.written[b.start]) continue;
        const want = asMarked(b.type), got = typeAt(b.start);
        if (got !== want) failures.push(`${c.name}: the ${b.type} block at $${b.start.toString(16)} is ${got}`);
      }
      n++;
    }
    expect(failures).toEqual([]);
    expect(n).toBeGreaterThan(10);
  });
});

const renders = new Map<string, ReturnType<typeof render>>();
function R(c: ReturnType<typeof cases>[number]) {
  let r = renders.get(c.name);
  if (!r) { r = render(analyze(c.project), c.project); renders.set(c.name, r); }
  return r;
}
