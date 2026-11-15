/* The names of the files Mimir writes from a file's name (spec 11.4): a source never starts with a -, which the
 * assembler's command line (build.bat, build.sh, the app's build) takes for an option. Booze Design's Uncensored (2014)
 * loads "- THE DEMO -": its source was -_THE_DEMO_--unpacked.asm, which the app's build refused, so Verify failed. */
import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analyze, buildScripts, cartBuild, comparePrg, createProject, crtBase, DEFAULT_SETTINGS, makeDemo, parsePrg, projectNameFor, render, safeStem, sourceStem, verify, type Settings } from '../src';
import { find64tass, run64tass, writeVfs } from '../src/node';

const tass = process.env.TASS64 || find64tass();

describe('names of the files written from a file', () => {
  it('never start with a -: a leading - goes with the _ for the spaces after it', () => {
    expect(sourceStem('- THE DEMO -.prg', 0)).toBe('THE_DEMO_-');
    expect(sourceStem('- THE DEMO --unpacked.prg', 0)).toBe('THE_DEMO_--unpacked');
    expect(projectNameFor('- THE DEMO --unpacked.prg')).toBe('THE_DEMO_--unpacked');
    expect(crtBase({ name: '-=GAME=-.crt' })).toBe('GAME_-');
    expect(safeStem('--', 'x')).toBe('x');
    expect(sourceStem('- -.prg', 3)).toBe('file3');
    expect(projectNameFor('-.prg')).toBe('project');
    // as before: a - or _ further in, a leading _, other characters as one _
    expect(sourceStem('a - b.prg', 0)).toBe('a_-_b');
    expect(sourceStem('_intro.prg', 0)).toBe('_intro');
    expect(sourceStem('', 2)).toBe('file2');
    expect(crtBase({ name: 'Game (1984).crt' })).toBe('Game_1984_');
  });

  it('a program named "- THE DEMO -" gets THE_DEMO_-.asm, which the build scripts assemble and which round-trips', () => {
    const d = makeDemo();
    const p = createProject({ files: [parsePrg('- THE DEMO -.prg', d.prg)] });
    expect(p.name).toBe('THE_DEMO_-');
    const A = analyze(p), R = render(A, p);
    expect(R.fileNames).toEqual(['THE_DEMO_-']);
    expect(Object.keys(R.files)).toContain('THE_DEMO_-.asm');
    expect(verify(A, R).ok).toBe(true);
    for (const asm of ['kick', '64tass'] as const) {
      const s = buildScripts({ ...DEFAULT_SETTINGS, assembler: asm } as Settings, R.fileNames);
      expect(s['build.bat']).toContain(' THE_DEMO_-.asm');
      expect(s['build.sh']).toContain(' THE_DEMO_-.asm');
      expect(`${s['build.bat']}\n${s['build.sh']}`).not.toMatch(/\s-_THE/);
    }
  });

  it('a cartridge\'s chips in one source are left out by the names their sources would have', () => {
    const c = cartBuild({ cart: { name: '- GAME -.crt' } as never, files: [{ name: '- ROML -.bin', load: 0x8000, bytes: new Uint8Array(1), chip: 0 }], settings: { cartOneSource: true } });
    expect(c).toMatchObject({ entry: 'GAME_-.crt.asm', output: 'GAME_-.crt', chips: ['ROML_-'] });
  });
});

describe.skipIf(!tass)(`real 64tass with a source named after "- THE DEMO -" (${tass ?? 'not found'})`, () => {
  it('builds THE_DEMO_-.asm to the program\'s bytes (it refused -_THE_DEMO_-.asm as an option)', async () => {
    const d = makeDemo();
    const p = createProject({ files: [parsePrg('- THE DEMO -.prg', d.prg)], settings: { assembler: '64tass' } });
    const A = analyze(p), R = render(A, p);
    const dir = await mkdtemp(join(tmpdir(), 'mimir-names-'));
    try {
      await writeVfs(dir, R.files);
      const run = await run64tass({ exe: tass!, cwd: dir, entry: `${R.fileNames[0]}.asm`, outDir: 'out' });
      expect(run.ok, run.output.split('\n').slice(-6).join(' / ')).toBe(true);
      expect(comparePrg(A.files[0], run.prg, []).ok).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
