/* Export files to project (group-export.ts, spec 13.5): the files one loader call loads, analysed alone and written as
 * one Kick Assembler source with a segment per file, which assembles to every file again; a single file keeps its own
 * source. KickAss.jar 5.25 was run on the joined sources of the Spindle demo below and of Memento Mori's Sparkle disk 1
 * (14 bundles, 59 PRGs): every PRG it wrote was the file byte for byte. */
import { describe, expect, it } from 'vitest';
import { createProject, exportGroup, makePrg, parsePrg, withId } from '../src';

const CODE = [0xa9, 0x00, 0x8d, 0x20, 0xd0, 0xa5, 0xfb, 0x85, 0xfc, 0x60];
const NOISE = (n: number, seed: number) => Array.from({ length: n }, (_, i) => (i * 73 + seed * 29 + ((i * i) >> 3)) & 0xff);
const prg = (name: string, load: number, bytes: number[]) => withId(parsePrg(name, makePrg(load, new Uint8Array(bytes))));
const text = (v: string | Uint8Array | undefined) => (typeof v === 'string' ? v : '');

describe('a loader group exported as one source', () => {
  const files = [prg('job02_4000.prg', 0x4000, CODE), prg('job02_6000.prg', 0x6000, NOISE(300, 1)), prg('job02_d000.prg', 0xd000, NOISE(64, 2))];
  const g = exportGroup(createProject({ name: 'job02', files }), 'job02', 'job 2 of demo.d64');

  it('one source: a .file and a segment per file, the include and the zero page once, each file in its segment', () => {
    expect(g.sources).toEqual(['job02.asm']);
    const src = text(g.files['job02.asm']).split('\n');
    expect(src[0]).toBe('// job02 — job 2 of demo.d64, re-assembled by Mimir Studio · Kick Assembler 5.x');
    expect(src.filter(l => l.startsWith('.file'))).toEqual([
      '.file [name="job02_4000.prg", segments="Job02_4000"]', '.file [name="job02_6000.prg", segments="Job02_6000"]', '.file [name="job02_d000.prg", segments="Job02_d000"]',
    ]);
    expect(src.filter(l => l.startsWith('.segmentdef'))).toEqual(['.segmentdef Job02_4000 [start=$4000]', '.segmentdef Job02_6000 [start=$6000]', '.segmentdef Job02_d000 [start=$d000]']);
    expect(src.filter(l => l.startsWith('.segment '))).toEqual(['.segment Job02_4000', '.segment Job02_6000', '.segment Job02_d000']);
    expect(src.filter(l => l.startsWith('#import'))).toEqual(['#import "include/c64-hardware.asm"']);
    // no file's own title, nor names defined for the other files
    expect(src.join('\n')).not.toContain('re-assembled by Mimir Studio\n// load');
    expect(src.join('\n')).not.toContain('labels defined in other files');
    // the files' own sources are not written: the joined one takes their place
    expect(Object.keys(g.files).filter(k => k.endsWith('.asm')).sort()).toEqual(['include/c64-hardware.asm', 'job02.asm']);
    expect(Object.keys(g.files).filter(k => k.startsWith('original/')).sort()).toEqual(['original/job02_4000.prg', 'original/job02_6000.prg', 'original/job02_d000.prg']);
  });

  it('assembles to every file again (the built-in assembler, without the segment lines)', () => {
    expect(g).toMatchObject({ ok: true, problem: null });
  });

  it('a single file keeps its own source, verified as a project of its own', () => {
    const one = exportGroup(createProject({ name: 'file01_0801', files: [prg('file01_0801.prg', 0x0801, CODE)] }), 'file01_0801', 'file 1 of demo.d64');
    expect(one).toMatchObject({ sources: ['file01_0801.asm'], ok: true, problem: null });
    expect(text(one.files['file01_0801.asm'])).toContain('// file01_0801.prg — re-assembled by Mimir Studio');
  });
});
