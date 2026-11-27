/* Integration (spec 10.8): a file of the macro library, as Mimir writes it (the line that says what it is at its top), is
 * a source the real KickAss.jar and 64tass import as it is; code taken from a source and made a macro, called, gives
 * the bytes the code gave where it was, in Mimir's own check and in the real assemblers. Runs when the assemblers are
 * found (KICKASS_JAR / JAVA / TASS64 env vars or the usual install folders); otherwise skipped. */
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkAsm } from '../src/asm-project';
import { codeLibCall, codeLibFileText, codeLibIsMacro, codeLibProjectFile, codeLibSubText, codeLibTake, codeLibWrap, readCodeLibFile } from '../src/code-library';
import { find64tass, findKickAssJar, runKickAssembler, writeVfs } from '../src/node';
import type { ScriptLang, Vfs } from '../src/types';

const jar = process.env.KICKASS_JAR || findKickAssJar();
const java = process.env.JAVA || 'java';
const kick = !!jar && spawnSync(java, ['-version'], { windowsHide: true }).status === 0;
const tass = find64tass();

/** the program the real assembler makes of `vfs` (main.asm), without its load address */
async function build(lang: ScriptLang, vfs: Vfs): Promise<Uint8Array> {
  const dir = await mkdtemp(join(tmpdir(), 'mimir-codelib-'));
  try {
    await writeVfs(dir, vfs);
    if (lang === 'kickass') {
      const r = await runKickAssembler({ java, jar: jar!, cwd: dir, entry: 'main.asm', outDir: 'out' });
      expect(r.output ?? '').not.toMatch(/error/i);
      return new Uint8Array(await readFile(join(dir, 'out', 'main.prg'))).subarray(2);
    }
    const r = spawnSync(tass!, ['-a', '-C', '-o', 'main.prg', 'main.asm'], { cwd: dir, windowsHide: true, encoding: 'utf8' });
    expect(r.status, r.stdout + r.stderr).toBe(0);
    expect(existsSync(join(dir, 'main.prg'))).toBe(true);
    return new Uint8Array(await readFile(join(dir, 'main.prg'))).subarray(2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const CASES: { lang: ScriptLang; source: string; from: number; to: number; params: string[]; args: string; include: (f: string) => string }[] = [
  { lang: 'kickass', source: '* = $1000\nstart:  sei\n        lda #$00\n        sta $d020\n        sta $d021\n!:      inc $d020\n        jmp !-\n', from: 3, to: 7, params: [], args: '', include: f => `#import "${f}"` },
  { lang: '64tass', source: '* = $1000\nstart   sei\n        lda #$00\n        sta $d020\n        sta $d021\n-       inc $d020\n        jmp -\n', from: 3, to: 7, params: [], args: '', include: f => `.include "${f}"` },
];

describe('the macro library\'s files in Mimir\'s check', () => {
  for (const c of CASES) it(`(${c.lang}) imported and called, give the bytes the code gave`, () => {
    const code = codeLibTake(c.source, c.from, c.to), macro = codeLibWrap(code, 'Black', c.params, c.lang);
    const d = codeLibIsMacro(macro, c.lang)!;
    const file = codeLibFileText({ lang: c.lang, description: 'Border and background black\nthen a loop', created: Date.UTC(2026, 10, 26), color: 'teal', from: 'test · main.asm' }, macro);
    const lines = c.source.split('\n');
    const main = [...lines.slice(0, c.from - 1), `        ${codeLibCall(d, c.lang)}`, ...lines.slice(c.to), c.include('Macros/Black.asm'), ''].join('\n');
    const inline = checkAsm({ 'main.asm': c.source }, 'main.asm', c.lang), called = checkAsm({ 'main.asm': main, 'Macros/Black.asm': file }, 'main.asm', c.lang);
    expect(called.problems).toEqual([]);
    expect([...called.asm.mem.slice(0x1000, 0x1000 + inline.bytes)]).toEqual([...inline.asm.mem.slice(0x1000, 0x1000 + inline.bytes)]);
    expect(called.bytes).toBe(inline.bytes);
  });
});

// a collection as Mimir writes it (its macros' own lines, #importonce at its top), imported twice and its macros called
const COLLECTION = codeLibFileText({ lang: 'kickass', description: 'Raster things', created: Date.UTC(2026, 10, 27), collection: true }, [
  '#importonce',
  codeLibSubText({ code: '.macro SetBorder(c) {\n    lda #c\n    sta $d020\n}', description: 'The border\'s colour', color: 'teal', created: Date.UTC(2026, 10, 27, 9) }, 'kickass', { top: '// =====', bottom: '// =====' }),
  '',
  codeLibSubText({ code: '.macro Both(c) {\n    SetBorder(c)\n    sta $d021\n}', description: 'Border and background', created: Date.UTC(2026, 10, 27, 10) }, 'kickass'),
].join('\n'));
const COLLECTION_MAIN = '#import "Macros/raster.asm"\n#import "Macros/raster.asm"\n* = $1000\n        Both(2)\n        SetBorder(0)\n        rts\n';
const COLLECTION_INLINE = '* = $1000\n        lda #2\n        sta $d020\n        sta $d021\n        lda #0\n        sta $d020\n        rts\n';

describe('a collection in Mimir\'s check', () => {
  it('(#importonce) imported twice, its macros called, gives the bytes the code gave', () => {
    const a = checkAsm({ 'main.asm': COLLECTION_MAIN, 'Macros/raster.asm': COLLECTION }, 'main.asm', 'kickass'), b = checkAsm({ 'main.asm': COLLECTION_INLINE }, 'main.asm', 'kickass');
    expect(a.problems).toEqual([]);
    expect([...a.asm.mem.slice(0x1000, 0x1000 + b.bytes)]).toEqual([...b.asm.mem.slice(0x1000, 0x1000 + b.bytes)]);
    expect(a.bytes).toBe(b.bytes);
    // (without #importonce the second import defines the macros again)
    expect(checkAsm({ 'main.asm': COLLECTION_MAIN, 'Macros/raster.asm': COLLECTION.replace('#importonce\n', '') }, 'main.asm', 'kickass').problems.length).toBeGreaterThan(0);
  });
});
describe.skipIf(!kick)('a collection with the real Kick Assembler', () => {
  it('(#importonce) imported twice, its macros called, gives the bytes the code gave', async () => {
    expect([...await build('kickass', { 'main.asm': COLLECTION_MAIN, 'Macros/raster.asm': COLLECTION })]).toEqual([...await build('kickass', { 'main.asm': COLLECTION_INLINE })]);
  }, 60_000);
});

for (const c of CASES) {
  const there = c.lang === 'kickass' ? kick : !!tass;
  describe.skipIf(!there)(`the macro library's files with the real ${c.lang === '64tass' ? '64tass' : 'Kick Assembler'}`, () => {
    it('imports one as Mimir writes it, and its call gives the bytes the code gave', async () => {
      const code = codeLibTake(c.source, c.from, c.to), macro = codeLibWrap(code, 'Black', c.params, c.lang);
      const d = codeLibIsMacro(macro, c.lang)!;
      const file = codeLibFileText({ lang: c.lang, description: 'Border and background black\nthen a loop "quoted" {braces}', created: Date.UTC(2026, 10, 26), color: '#a0b1c2', from: 'test · main.asm:3–7' }, macro);
      const lines = c.source.split('\n');
      const main = [...lines.slice(0, c.from - 1), `        ${codeLibCall(d, c.lang)}`, ...lines.slice(c.to), c.include('Macros/Black.asm'), ''].join('\n');
      const inline = await build(c.lang, { 'main.asm': c.source });
      const called = await build(c.lang, { 'main.asm': main, 'Macros/Black.asm': file });
      expect([...called]).toEqual([...inline]);
    }, 60_000);
  });
}

// the project's macro file Mimir builds, imported once by the main source, with the real Kick Assembler
describe.skipIf(!kick)('the project\'s macro file with the real Kick Assembler', () => {
  it('builds as the code written out', async () => {
    const lib = [readCodeLibFile('macro', 'raster.asm', COLLECTION, { changed: 1 })!];
    const main = '#import "macros.asm"\n* = $1000\n        Both(2)\n        SetBorder(0)\n        rts\n';
    const b = codeLibProjectFile(lib, { macros: [], collections: [] }, [main], 'kickass', 'macros.asm');
    expect(b.macros.map(m => m.name)).toEqual(['SetBorder', 'Both']);
    expect([...await build('kickass', { 'main.asm': main, 'macros.asm': b.text })]).toEqual([...await build('kickass', { 'main.asm': COLLECTION_INLINE })]);
  }, 60_000);
});
