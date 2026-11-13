import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { analyze, openC64File, parsePrg, parseVsf, showcaseProject, type Block, type Project } from '@mimir/core';
import { blockMap, GFX_KIND, nameNear, problemCounts, regsText, routinesOf, snapshotPc, startOf, typeRows } from '../src/lib/overview';

// the showcase: a BASIC stub, code, four sprites, a font, a bitmap, music and tables
const p = showcaseProject();
const A = analyze(p);
const block = (start: number, end: number, type: Block['type']): Block => ({ id: start, start, end, type, file: 0, props: {}, conf: 1, reason: '', user: false, entropy: 0 });

describe('the overview of the analysis', () => {
  it('says where the program starts and how the analysis knows', () => {
    const s = startOf(A, p)!;
    expect(s.addr).toBe(A.entry);
    expect(s.from).toBe('From the SYS in the BASIC line.');
    expect(s.basic).toMatch(/^\d+ SYS ?\d+/);
    // set for the project: by you, or where an unpacker left an unpacked program
    expect(startOf(A, { ...p, entryPoint: A.entry })!.from).toBe('Set by you.');
    expect(startOf(A, { ...p, entryPoint: A.entry, files: [{ ...p.files[0], name: 'game-unpacked.prg' }] })!.from).toBe('Where the unpacker left the program.');
    expect(startOf(A, { ...p, entryPoint: A.entry, files: [{ ...p.files[0], name: 'game-unpacked_3.prg' }] })!.from).toBe('Where the unpacker left the program.');
  });

  it('takes the load address when there is no BASIC SYS, and says so', () => {
    const prg = parsePrg('raw.prg', new Uint8Array([0x00, 0xc0, 0xa9, 0x00, 0x8d, 0x20, 0xd0, 0x60]));
    const q: Project = { ...p, files: [{ ...prg, id: 'raw' }], entryPoint: null, entries: [], overrides: [] };
    const s = startOf(analyze(q), q)!;
    expect(s).toEqual({ addr: 0xc000, from: 'The load address: no BASIC SYS was found.', basic: null });
  });

  it('draws the blocks as runs of a type group, with a gap where the loaded bytes stop', () => {
    const runs = blockMap([block(0x1000, 0x1010, 'code'), block(0x1010, 0x1020, 'code'), block(0x1020, 0x1030, 'data'), block(0x2000, 0x2040, 'sprite'), block(0x2040, 0x2800, 'charset')]);
    expect(runs).toEqual([
      { start: 0x1000, end: 0x1020, group: 'code', blocks: 2, gap: false },
      { start: 0x1020, end: 0x1030, group: 'data', blocks: 1, gap: false },
      // sprites and a charset are both graphics
      { start: 0x2000, end: 0x2800, group: 'gfx', blocks: 2, gap: true },
    ]);
    // the showcase's runs hold every block, and every byte of them
    const all = blockMap(A.blocks);
    expect(all.reduce((n, r) => n + r.blocks, 0)).toBe(A.blocks.length);
    expect(all.reduce((n, r) => n + r.end - r.start, 0)).toBe(A.blocks.reduce((n, b) => n + b.end - b.start, 0));
  });

  it('counts the blocks and bytes of each type, and links to the first block', () => {
    const rows = typeRows(A.blocks);
    expect(rows.reduce((n, r) => n + r.total, 0)).toBe(A.blocks.length);
    for (const r of rows) {
      const mine = A.blocks.filter(b => b.type === r.kind);
      expect(r.bytes).toBe(mine.reduce((n, b) => n + b.end - b.start, 0));
      expect(r.first.start).toBe(Math.min(...mine.map(b => b.start)));
    }
    // the graphics open in Graphics drawn as what they are
    const gfx = rows.filter(r => GFX_KIND[r.kind]).map(r => [r.kind, GFX_KIND[r.kind], r.first.start]);
    expect(gfx).toEqual(expect.arrayContaining([['sprite', 'sprites', 0x2000], ['charset', 'chars', 0x2800], ['bitmap', 'bitmap', 0x4000]]));
  });

  it('counts the routines, the interrupt handlers and the problems by level', () => {
    const { subs, handlers } = routinesOf(A);
    expect(subs).toBe([...A.entryKind.values()].filter(k => k === 'sub').length);
    expect(handlers).toBeGreaterThan(0);
    expect(problemCounts([{ lvl: 'err', msg: '', addr: null, cat: '' }, { lvl: 'hint', msg: '', addr: null, cat: '' }, { lvl: 'hint', msg: '', addr: null, cat: '' }, { lvl: 'info', msg: '', addr: null, cat: '' }]))
      .toEqual({ err: 1, warn: 0, hint: 2 });
  });

  it("says where VICE's PC was in a snapshot, and whether the listing has it", () => {
    // fixtures/vsf/raster-demo.vsf: x64sc 3.10 stopped in the demo's raster IRQ at $08c7, $01 = $37
    const vsf = new Uint8Array(readFileSync(join(__dirname, '../../../fixtures/vsf/raster-demo.vsf')));
    const open = (b: Uint8Array, zeroPage = false) => { const f = openC64File('raster-demo.vsf', b, { zeroPage }); return analyze({ name: 'raster-demo', files: [f], entries: f.entries ?? [] }); };
    const A1 = open(vsf);
    const s = snapshotPc(A1.files, A1.owner)!;
    expect(s).toMatchObject({ pc: 0x08c7, sp: 0xed, port: 0x37, loaded: true, where: null });
    expect(regsText(s)).toMatch(/^A \$[0-9a-f]{2} {2}X \$[0-9a-f]{2} {2}Y \$[0-9a-f]{2} {2}SP \$ed {2}\$01 \$37 {2}NV-BDIZC [01]{8}$/);
    // a PRG has none
    expect(snapshotPc(A.files, A.owner)).toBeNull();
    // the PC elsewhere: in the KERNAL ROM ($01 = $37), in the stack (opened only with the setting)
    const at = (pc: number) => { const b = vsf.slice(), cpu = parseVsf(b).modules.find(m => m.name === 'MAINCPU')!; b[cpu.offset + 12] = pc & 0xff; b[cpu.offset + 13] = pc >> 8; return b; };
    const rom = open(at(0xea31));
    expect(snapshotPc(rom.files, rom.owner)).toMatchObject({ pc: 0xea31, loaded: false, where: 'the KERNAL ROM' });
    const stack = open(at(0x0140));
    expect(snapshotPc(stack.files, stack.owner)).toMatchObject({ pc: 0x0140, loaded: false, where: 'the zero page or the stack, which are not opened' });
    const zp = open(at(0x0140), true);
    expect(snapshotPc(zp.files, zp.owner)).toMatchObject({ pc: 0x0140, loaded: true });
  });

  it('names an address by the label at it, or the nearest one before it', () => {
    const labels = new Map([[0x1000, { name: 'irq' }], [0x2000, { name: 'far' }]]);
    expect(nameNear(labels, 0x1000)).toBe('irq');
    expect(nameNear(labels, 0x1010)).toBe('irq+16');
    expect(nameNear(labels, 0x1100)).toBeNull();
  });
});
