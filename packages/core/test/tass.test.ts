/* 64tass (spec 11.8): the source the generator writes for it, the built-in 64tass assembler that verifies it, the
 * real 64tass (when it is found: TASS64, C:\C64, PATH) building every project of helpers/cases.ts byte-identical to the
 * original, and its console output read as problems. */
import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analyze, assembleTass, bankFiles, comparePrg, createProject, exportFiles, h4, labelFor, makePrg, OPC, openCartridge, parsePrg, parseTassOutput, render, validLabel, verify, type ProjectInput } from '../src';
import { find64tass, run64tass, writeVfs } from '../src/node';
import { cases, demo, type Case } from './helpers/cases';
import { relocProgram } from './helpers/programs';

const tass = process.env.TASS64 || find64tass();
const as64 = (p: ProjectInput): ProjectInput => ({ ...p, settings: { ...p.settings, assembler: '64tass' } });
const source = (p: ProjectInput) => { const q = as64(p); const R = render(analyze(q), q); return { R, text: R.files[`${R.fileNames[0]}.asm`] as string }; };

describe('the 64tass source', () => {
  it('writes the opcodes 64tass gives back by their mnemonics: 221 of 256, the rest as .byte', () => {
    // measured with 64tass 1.57.2900 (.cpu "6502i"): each opcode's mnemonic and mode assembled alone
    const notByName = [0x12, 0x1a, 0x22, 0x2b, 0x32, 0x34, 0x3a, 0x3c, 0x42, 0x44, 0x52, 0x54, 0x5a, 0x5c, 0x62, 0x64, 0x72, 0x74, 0x7a, 0x7c, 0x82, 0x89, 0x92, 0xb2, 0xc2, 0xd2, 0xd4, 0xda, 0xdc, 0xe2, 0xeb, 0xf2, 0xf4, 0xfa, 0xfc];
    expect(OPC.filter(o => !o.tass).map(o => o.op)).toEqual(notByName);
  });

  it('spells the demo for 64tass: comments, *, BASIC line, music namespace, encodings, @w', () => {
    const { text } = source(demo());
    expect(text).toMatch(/^; raster-demo\.prg — re-assembled by Mimir Studio\n; load \$0801-\$37ff \(12287 bytes\) · entry start · 64tass 1\.57 \(-a -C\)\n/);
    expect(text).toContain('.include "include/c64-hardware.asm"');
    expect(text).toContain('* = $0801                               ; Basic\n        .word (+), 10                   ; 10 SYS2064\n        .null $9e, format("%d", start)\n+\n        .word 0');
    expect(text).toContain('* = $0810                               ; Code\nstart:');
    // the built-in 64tass assembler's memory map takes the names from there
    const p = as64(demo()), A = analyze(p), V = verify(A, render(A, p));
    expect(V.results[0].blocks.map(b => b.name)).toEqual(expect.arrayContaining(['Basic', 'Code', 'Music', 'Charset']));
    expect(text).toContain('music .namespace');
    expect(text).toContain('sid      = binary("music/music_1000.sid")');
    expect(text).toContain('* = music.location');
    expect(text).toContain('        .text music.data');
    expect(text).toContain('        jsr music.init');
    expect(text).toContain('        .binary "gfx/charset_3000.bin"');
    expect(text).not.toMatch(/\/\/|\.label |\.pc |#import|LoadSid\(|BasicUpstart2/);
  });

  it('writes relocated blocks with .logical and .here, excluded blocks under .if with their flag in the head', () => {
    const moved = { name: 'moved', files: [relocProgram()], relocs: [{ start: 0x1000, end: 0x1011, to: 0x2000 }] };
    const { text } = source(moved);
    expect(text).toMatch(/^\.logical \$2000 +; the 17 bytes run at \$2000-\$2010$/m);
    expect(text).toMatch(/^\.here +; end of /m);
    const ex = source({ ...demo(), excluded: [0x09b5] }).text;
    expect(ex).toContain('; blocks left out of the build; set a flag to true to build its block again:\nINCLUDE_sine_09b5 = false');
    expect(ex).toMatch(/^\.if INCLUDE_sine_09b5$/m);
    expect(ex).toMatch(/^\.else\nsine_09b5 = \$09b5\n\.endif$/m);
  });

  it('writes a block comment as .comment … .endc, a line that would end it kept inside', () => {
    const p: ProjectInput = { ...demo(), notes: { 0x0810: { text: 'one\n.endc here\ntwo', block: true } } };
    const { text, R } = source(p);
    expect(text).toContain('.comment\none\n;.endc here\ntwo\n.endc\n');
    expect(verify(analyze(as64(p)), R).ok).toBe(true);
  });

  it('writes texts with 64tass\'s tables: a-z for the unshifted letters, £ ↑ ←, the control codes as numbers', () => {
    const bytes = Uint8Array.from([0x93, 0x48, 0x45, 0x4c, 0x4c, 0x4f, 0x5c, 0x5e, 0x5f, 0x0d, 0xc8, 0xc9]);
    const p: ProjectInput = { name: 't', files: [parsePrg('t.prg', makePrg(0xc000, bytes))], overrides: [{ start: 0xc000, end: 0xc00a, type: 'text', props: { enc: 'petscii' } }, { start: 0xc00a, end: 0xc00c, type: 'text', props: { enc: 'petscii-mixed' } }] };
    const { text, R } = source(p);
    expect(text).toContain('PET_CLR = $93');
    expect(text).toContain('        .enc "none"\n        .text PET_CLR, "hello£↑←", PET_RETURN');
    expect(text).toContain('.text "HI"');
    expect(verify(analyze(as64(p)), R).ok).toBe(true);
  });

  it('names a label 64tass cannot take as a problem: _local, len, true', () => {
    expect(labelFor('64tass', '_loop', validLabel)).toBe(false);
    expect(labelFor('64tass', 'len', validLabel)).toBe(false);
    expect(labelFor('64tass', 'isb', validLabel)).toBe(false);
    expect(labelFor('kick', '_loop', validLabel)).toBe(true);
    const { R } = source({ ...demo(), labels: { 0x0866: '_init' } });
    expect(R.problems.map(p => p.msg)).toEqual([expect.stringContaining('Label "_init" cannot be a label of the whole source in 64tass')]);
  });
});

describe('the built-in 64tass assembler', () => {
  it('builds every project of the integration cases byte-identical to the original', () => {
    const failures: string[] = [];
    for (const c of cases()) {
      const p = as64(c.project), A = analyze(p), R = render(A, p);
      const v = verify(A, R);
      if (!v.ok) failures.push(`${c.name}: ${v.results.filter(r => !r.ok).map(r => `${r.path} ${r.errors.slice(0, 3).map(e => `${e.file}:${e.line} ${e.msg}`).join(' | ')} ${r.diffs.slice(0, 3).map(d => d.msg ?? `$${h4(d.addr)} expected ${d.exp} got ${d.got}`).join('; ')}`).join(' || ')}`);
    }
    expect(failures).toEqual([]);
  });

  it('reads 64tass\'s own constructs: anonymous labels, := , .block, lists, slices, format', () => {
    const src = [
      '*       = $1000', '        ldx #3', '-       dex', '        bne -', '        beq +', '        nop', '+       rts',
      'v       := 1', 'v       := v + 1', '        .byte v, <$12ff+1, >$12ff+$101, 7/2, 7%3, 2**3, ~1 & $ff, 3 < 4 ? 1 : 0',
      'blk     .block', 'inner   = $42', '        .bend', '        .byte blk.inner', '        .text [1, 2], "ab"[1:]', '        .null format("%02x-%d", 10, 42)',
      '        .enc "screen"', '        .text "Az@"', '        .fill 3, $ea',
    ].join('\n');
    const r = assembleTass({ 'a.asm': src }, 'a.asm');
    expect(r.errors).toEqual([]);
    expect([...r.prg!].slice(2)).toEqual([0xa2, 0x03, 0xca, 0xd0, 0xfd, 0xf0, 0x01, 0xea, 0x60, 2, 0x00, 0x14, 3, 1, 8, 0xfe, 1, 0x42, 1, 2, 0x42, 0x30, 0x41, 0x2d, 0x34, 0x32, 0, 0x41, 0x1a, 0x00, 0xea, 0xea, 0xea]);
  });

  it('says what 64tass says is wrong: an unknown name, a value too large, an undocumented opcode without .cpu', () => {
    const r = assembleTass({ 'a.asm': '* = $1000\n lda nothing\n lda #$1ff\n lax $10\n' }, 'a.asm');
    expect(r.errors.map(e => `${e.line}: ${e.msg}`)).toEqual(["2: not defined symbol 'nothing'", "3: too large for a 8 bit unsigned integer '511'", '4: lax is an undocumented opcode: it needs .cpu "6502i"']);
  });
});

describe('64tass\'s console output', () => {
  it('becomes problems, with the note after an error', () => {
    const out = [
      'Assembling file:   t2.asm',
      "t2.asm:34:13: error: not defined symbol 'undefinedthing'",
      '         lda undefinedthing', '             ^',
      't2.asm: note: searched in the global scope',
      'include\\inc.asm:2:5: warning: possible jmp ($xxff) bug',
      "64tass.exe: fatal error: can't write label file 'out/x.vs': No such file or directory",
    ].join('\n');
    expect(parseTassOutput(out)).toEqual([
      { severity: 'error', file: 't2.asm', line: 34, column: 13, message: "not defined symbol 'undefinedthing' (searched in the global scope)" },
      { severity: 'warning', file: 'include/inc.asm', line: 2, column: 5, message: 'possible jmp ($xxff) bug' },
      { severity: 'error', file: '', line: 0, column: 0, message: "can't write label file 'out/x.vs': No such file or directory" },
    ]);
  });
});

async function assembleWith64tass(c: Case) {
  const p = as64(c.project), A = analyze(p), R = render(A, p);
  const dir = await mkdtemp(join(tmpdir(), 'mimir-tass-'));
  try {
    await writeVfs(dir, R.files);
    const results = [];
    for (const [fi, f] of A.files.entries()) {
      const entry = `${R.fileNames[fi]}.asm`;
      const run = await run64tass({ exe: tass!, cwd: dir, entry, outDir: 'out' });
      const cmp = comparePrg(f, run.prg, R.excluded.filter(x => x.file === fi));
      const labels = run.vsPath ? readFileSync(run.vsPath, 'utf8') : '';
      results.push({ entry, run, cmp, labels });
    }
    return results;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe.skipIf(!tass)(`real 64tass (${tass ?? 'not found'})`, () => {
  it('assembles every generated project byte-identical to the original, with a VICE label file', async () => {
    const all = cases();
    const failures: string[] = [];
    let next = 0, assembled = 0;
    const worker = async () => {
      while (next < all.length) {
        const c = all[next++];
        for (const { entry, run, cmp, labels } of await assembleWith64tass(c)) {
          assembled++;
          if (!run.ok || !cmp.ok) {
            const why = run.problems.length ? run.problems.map(p => `${p.file}:${p.line}:${p.column} ${p.message}`).join(' | ') : run.output.split('\n').slice(-6).join(' / ');
            failures.push(`${c.name} (${entry}): ${why} ${cmp.diffs.slice(0, 3).map(d => d.msg ?? `$${h4(d.addr)} expected ${d.exp} got ${d.got}`).join('; ')}`);
          } else expect(labels, `${c.name}: --vice-labels should write the labels`).toMatch(/^al [0-9a-f]+ \./m);
        }
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    expect(failures).toEqual([]);
    expect(assembled).toBeGreaterThanOrEqual(all.length);
  }, 300_000);

  it('builds an exported cartridge: the chips, then <name>.crt.asm writes the image byte-identical to the one opened', async () => {
    const crt = new Uint8Array(readFileSync(join(__dirname, '../../../fixtures/crt/mimir-demo.crt')));
    for (const bank of [0, 1]) {
      const o = openCartridge('mimir-demo.crt', crt);
      const p = createProject({ files: bankFiles(o.crt, bank), cart: o.cart, settings: { assembler: '64tass' } });
      const R = render(analyze(p), p), out = exportFiles(p, R, p.settings);
      expect(out['mimir-demo.crt.asm']).toMatch(/^\* = 0\n\.enc "ascii" +; the header in ASCII/m);
      expect(out['mimir-demo.crt.asm']).toMatch(/^\.cerror \* - chip0 != /m);
      const dir = await mkdtemp(join(tmpdir(), 'mimir-tass-'));
      try {
        await writeVfs(dir, out);
        for (const n of R.fileNames) expect((await run64tass({ exe: tass!, cwd: dir, entry: `${n}.asm`, outDir: 'out' })).ok).toBe(true);
        const run = await run64tass({ exe: tass!, cwd: dir, entry: 'mimir-demo.crt.asm', outDir: 'out' });
        expect(run.ok, run.output).toBe(true);
        expect(run.prgPath).toBe(join(dir, 'out', 'mimir-demo.crt'));
        expect(run.prg).toEqual(crt);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    }
  }, 60_000);

  it('assembles every bank in one source (13.9c) alone to the image it was opened from, with every bank\'s labels', async () => {
    const crt = new Uint8Array(readFileSync(join(__dirname, '../../../fixtures/crt/mimir-demo.crt')));
    const o = openCartridge('mimir-demo.crt', crt), p = createProject({ files: o.files, cart: o.cart, settings: { cartOneSource: true, assembler: '64tass' } });
    const R = render(analyze(p), p), dir = await mkdtemp(join(tmpdir(), 'mimir-tass-'));
    try {
      const out = exportFiles(p, R, p.settings);
      expect(out['mimir-demo.crt.asm']).toMatch(/^bank00 \.namespace/m);
      expect(out['mimir-demo.crt.asm']).toMatch(/^\.logical \$8000/m);
      await writeVfs(dir, out);
      const run = await run64tass({ exe: tass!, cwd: dir, entry: 'mimir-demo.crt.asm', outDir: 'out' });
      expect(run.ok, run.output).toBe(true);
      expect(run.prg).toEqual(crt);
      expect(run.vsPath).toBe(join(dir, 'out', 'mimir-demo.crt.vs'));
      expect(readFileSync(run.vsPath!, 'utf8')).toMatch(/^al 8009 \.bank0\d:start$/m);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it('writes the same bytes as the built-in 64tass assembler for its own constructs, and reports the same errors', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mimir-tass-'));
    try {
      const src = '*       = $1000\n        ldx #3\n-       dex\n        bne -\n        beq +\n        nop\n+       rts\nv       := 1\nv       := v + 1\n        .byte v, <$12ff+1, >$12ff+$101, 7/2, 7%3, 2**3, ~1 & $ff, 3 < 4 ? 1 : 0\nblk     .block\ninner   = $42\n        .bend\n        .byte blk.inner\n        .text [1, 2], "ab"[1:]\n        .null format("%02x-%d", 10, 42)\n        .enc "screen"\n        .text "Az@"\n        .fill 3, $ea\n';
      await writeVfs(dir, { 'a.asm': src, 'b.asm': '* = $1000\n lda nothing\n' });
      const run = await run64tass({ exe: tass!, cwd: dir, entry: 'a.asm', outDir: 'out' });
      expect(run.ok, run.output).toBe(true);
      expect([...run.prg!]).toEqual([...assembleTass({ 'a.asm': src }, 'a.asm').prg!]);
      const bad = await run64tass({ exe: tass!, cwd: dir, entry: 'b.asm', outDir: 'out' });
      expect(bad.ok).toBe(false);
      expect(bad.problems[0]).toMatchObject({ severity: 'error', file: 'b.asm', line: 2, column: 6, message: expect.stringContaining("not defined symbol 'nothing'") });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
