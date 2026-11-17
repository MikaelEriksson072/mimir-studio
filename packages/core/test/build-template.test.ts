/* Build templates (spec 11.4b): build.bat and build.sh with placeholders filled in for each project. The original
 * template filled in is the generated script; Mimir's Pack with Exomizer template, run as exported (Kick Assembler,
 * then Exomizer), gives a packed program that real VICE decrunches and runs, when Java, KickAss.jar, Exomizer and
 * VICE are found. */
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  analyze, BUILT_IN_TEMPLATES, builtInTemplate, buildScripts, cartBuild, createProject, DEFAULT_SETTINGS, demoProject, deserializeProject, exportFiles, fillTemplate, makeDemo, makePrg,
  newTemplateName, originalTemplate, parsePrg, placeholdersIn, projectScripts, readme, readTemplate, readTemplateLibrary, render, renderTemplate, serializeProject, sfxEntry,
  templateScripts, templateValues, TEMPLATE_PLACEHOLDERS, type BuildTemplate, type Project, type Settings,
} from '../src';
import { findExomizer, findKickAssJar, findVice, writeVfs } from '../src/node';
import { fromSource, rng } from './helpers/programs';

const S = (o: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, ...o } as Settings);
const demoNames = () => { const p = demoProject(); return render(analyze(p), p).fileNames; };

describe('the original template', () => {
  it('filled in is the generated build.bat and build.sh, for Kick Assembler and 64tass, with and without a cartridge', () => {
    const carts = [null, { entry: 'g.crt.asm', output: 'g.crt', one: false, chips: [] }, { entry: 'g.crt.asm', output: 'g.crt', one: true, chips: ['b0'] }];
    for (const assembler of ['kick', '64tass'] as const) for (const cart of carts) for (const names of [['a'], ['a', 'b0', 'c']]) {
      const s = S({ assembler });
      expect(renderTemplate(originalTemplate(s, !!cart), s, { names, cart })).toEqual(buildScripts(s, names, cart));
    }
  });

  it('has the commands of the generated scripts, with placeholders where the project and the settings go', () => {
    const t = originalTemplate(S());
    expect(t['build.bat']).toContain('"%JAVA%" -jar "%KICKASS%" {source}.asm -odir {out} {kickArgs} || exit /b 1');
    expect(t['build.bat']).toContain('start "" "%VICE%" {viceArgs} -moncommands {out}\\{labels}.vs {start}');
    expect(t['build.bat']).toMatch(/^set JAVA=\{java\}$/m);
    // without a cartridge it has no line for one
    expect(t['build.bat']).not.toContain('{cart}');
    expect(originalTemplate(S(), true)['build.bat']).toContain('"%JAVA%" -jar "%KICKASS%" {cart}.asm -odir {out}');
    const tass = originalTemplate(S({ assembler: '64tass' }));
    expect(tass['build.sh']).toContain('"$TASS" -a -C --cbm-prg {tassArgs} -o {out}/{source}.prg --vice-labels -l {out}/{source}.vs {source}.asm');
    expect(tass['build.sh']).toContain('mkdir -p {out}');
  });

  it('fills in the demo as the generated scripts say it', () => {
    const s = buildScripts(S(), demoNames());
    expect(s['build.bat']).toContain('"%JAVA%" -jar "%KICKASS%" raster-demo.asm -odir out -vicesymbols -showmem || exit /b 1\r\n');
    expect(s['build.sh']).toContain('"$VICE" -autostartprgmode 1 -moncommands out/raster-demo.vs -autostart out/raster-demo.prg\n');
  });
});

describe('filling in a template', () => {
  const v = (values: Record<string, string | null>, sources = ['a', 'b']) => ({ sources, values });

  it('writes a {source} line once for each source, and leaves out a line whose placeholder has no value', () => {
    expect(fillTemplate('x\nasm {source}.asm -o {out}\\{source}.prg\ncart {cart}\ny\n', v({ out: 'out', cart: null }), '\r\n'))
      .toBe('x\r\nasm a.asm -o out\\a.prg\r\nasm b.asm -o out\\b.prg\r\ny\r\n');
    expect(fillTemplate('asm {source}\n', v({}, []), '\n')).toBe('');
    expect(fillTemplate('cart {cart}\n', v({ cart: 'g.crt' }), '\n')).toBe('cart g.crt\n');
  });

  it('an empty value takes the space before it along; ${name} is the shell\'s and {other} is not a placeholder', () => {
    expect(fillTemplate('tass -a {tassArgs} -o x', v({ tassArgs: '' }), '\n')).toBe('tass -a -o x');
    expect(fillTemplate('tass -a {tassArgs} -o x', v({ tassArgs: '-Wall' }), '\n')).toBe('tass -a -Wall -o x');
    expect(fillTemplate('echo ${name} {name} {other} %name% {Name}', v({ name: 'demo' }), '\n')).toBe('echo ${name} demo {other} %name% {Name}');
    expect(fillTemplate('JAVA="${JAVA:-{java}}"', v({ java: 'java' }), '\n')).toBe('JAVA="${JAVA:-java}"');
    expect(placeholdersIn('a {source} {out} ${name} {source} {nope}')).toEqual(['source', 'out']);
  });

  it('gives each script its own path separator, and VICE the program or the cartridge', () => {
    const t = { names: ['a', 'b0', 'c'], cart: null };
    expect(templateValues(S(), t, 'build.bat').values.start).toBe('-autostart out\\a.prg');
    expect(templateValues(S(), t, 'build.sh').values.start).toBe('-autostart out/a.prg');
    const one = { names: ['a', 'b0'], cart: { entry: 'g.crt.asm', output: 'g.crt', one: true, chips: ['b0'] } };
    expect(templateValues(S(), one, 'build.sh')).toMatchObject({ sources: ['a'], values: { start: '-cartcrt out/g.crt', labels: 'g.crt', cart: 'g.crt' } });
    expect(templateValues(S({ tassPath: '', exomizerPath: '' }), t, 'build.bat').values).toMatchObject({ tass: '64tass', exomizer: 'exomizer' });
    // every placeholder the help names has a value (or null)
    for (const p of TEMPLATE_PLACEHOLDERS) if (p.name !== 'source') expect(templateValues(S(), t, 'build.bat').values).toHaveProperty(p.name);
  });
});

describe('where Exomizer\'s sfx starts the program ({entry})', () => {
  it('sys for a BASIC SYS line, basic without one, the load address elsewhere, the program start the user set', () => {
    const d = makeDemo(), demo = parsePrg(d.name, d.prg);
    expect(sfxEntry({ files: [demo] })).toBe('sys');
    expect(sfxEntry({ files: [demo], entryPoint: 0x0810 })).toBe('0x0810');
    expect(sfxEntry({ files: [{ load: 0xc000, bytes: new Uint8Array(4) }] })).toBe('0xc000');
    // 10 PRINT
    expect(sfxEntry({ files: [{ load: 0x0801, bytes: Uint8Array.of(0x07, 0x08, 0x0a, 0x00, 0x99, 0x00, 0x00, 0x00) }] })).toBe('basic');
    expect(sfxEntry({})).toBe('sys');
  });
});

describe('Pack with Exomizer', () => {
  it('assembles, packs out/<name>.prg into <name>-exo.prg and starts that, for either assembler', () => {
    const k = builtInTemplate('exomizer', S());
    expect(k).toMatchObject({ name: 'Pack with Exomizer', builtIn: 'exomizer', assembler: 'kick' });
    expect(k['build.bat']).toContain('"%JAVA%" -jar "%KICKASS%" {source}.asm');
    expect(k['build.bat']).toContain('set EXOMIZER={exomizer}');
    expect(k['build.bat']).toContain('"%EXOMIZER%" sfx {entry} -o {out}\\{name}-exo.prg {out}\\{name}.prg || exit /b 1');
    expect(k['build.bat']).toContain('-autostart {out}\\{name}-exo.prg');
    expect(k['build.sh']).toContain('"$EXOMIZER" sfx {entry} -o {out}/{name}-exo.prg {out}/{name}.prg');
    const t = builtInTemplate('exomizer', S({ assembler: '64tass' }));
    expect(t['build.bat']).toContain('"%TASS%" -a -C --cbm-prg');
    expect(t['build.bat']).not.toContain('KICKASS');
    expect(BUILT_IN_TEMPLATES.map(b => b.id)).toEqual(['exomizer']);
  });

  it('filled in for the demo', () => {
    const p: Project = { ...demoProject(), buildTemplate: builtInTemplate('exomizer', S()) };
    const s = templateScripts(p, S({ exomizerPath: 'C:\\C64\\exomizer.exe' }), demoNames());
    expect(s['build.bat']).toContain('rem Packs out\\raster-demo.prg with Exomizer');
    expect(s['build.bat']).toContain('set EXOMIZER=C:\\C64\\exomizer.exe\r\n');
    expect(s['build.bat']).toContain('"%EXOMIZER%" sfx sys -o out\\raster-demo-exo.prg out\\raster-demo.prg || exit /b 1\r\n');
    expect(s['build.bat']).toContain('-moncommands out\\raster-demo.vs -autostart out\\raster-demo-exo.prg\r\n');
    expect(s['build.sh']).toContain('EXOMIZER="${EXOMIZER:-exomizer}"\n');
  });
});

describe('a project\'s build template', () => {
  const mine: BuildTemplate = { name: 'Copy to the disk', assembler: 'kick', 'build.bat': '@echo off\n"%JAVA%" -jar {kickass} {source}.asm -odir {out}\ncopy {out}\\{name}.prg D:\\c64\\{name}.prg\n', 'build.sh': '#!/bin/sh\ncp {out}/{name}.prg ~/c64/\n' };

  it('makes the scripts, and the user\'s edits still win', () => {
    const p: Project = { ...demoProject(), buildTemplate: mine };
    const names = demoNames();
    expect(templateScripts(p, S(), names)).toEqual({ 'build.bat': `@echo off\r\n"%JAVA%" -jar ${DEFAULT_SETTINGS.kickJar} raster-demo.asm -odir out\r\ncopy out\\raster-demo.prg D:\\c64\\raster-demo.prg\r\n`, 'build.sh': '#!/bin/sh\ncp out/raster-demo.prg ~/c64/\n' });
    const own = '@echo off\r\nrem mine\r\n';
    expect(projectScripts({ ...p, scripts: { 'build.bat': own } }, S(), names)).toEqual({ 'build.bat': own, 'build.sh': '#!/bin/sh\ncp out/raster-demo.prg ~/c64/\n' });
    // without one: the generated scripts
    expect(templateScripts(demoProject(), S(), names)).toEqual(buildScripts(S(), names));
  });

  it('a built-in one follows the project\'s assembler, a user\'s stays as it was kept', () => {
    const p: Project = { ...demoProject(), buildTemplate: builtInTemplate('exomizer', S()) };
    const tass = S({ assembler: '64tass' });
    expect(templateScripts(p, tass, demoNames())['build.bat']).toContain('"%TASS%" -a -C --cbm-prg -o out\\raster-demo.prg');
    expect(templateScripts({ ...p, buildTemplate: mine }, tass, demoNames())['build.bat']).toContain('-jar');
  });

  it('the export writes it, the README names it, and the project file keeps it', () => {
    const p: Project = { ...demoProject(), buildTemplate: builtInTemplate('exomizer', S()) };
    const R = render(analyze(p), p);
    const out = exportFiles(p, R, S());
    expect(out['build.bat']).toContain('"%EXOMIZER%" sfx sys');
    expect(readme(p, R)).toContain('made from the build template "Pack with Exomizer": they pack the program with Exomizer');
    expect(readme(demoProject(), R)).not.toContain('build template');
    const back = deserializeProject(JSON.parse(JSON.stringify(serializeProject({ ...p, buildTemplate: mine }))));
    expect(back.buildTemplate).toEqual(mine);
    expect(serializeProject(demoProject())).not.toHaveProperty('buildTemplate');
    expect(deserializeProject(serializeProject(demoProject()))).not.toHaveProperty('buildTemplate');
    expect(deserializeProject({ ...serializeProject(demoProject()), buildTemplate: { name: '', 'build.bat': '', 'build.sh': '' } })).not.toHaveProperty('buildTemplate');
  });

  it('a cartridge project\'s template fills in its cartridge lines', () => {
    const t = originalTemplate(S(), true);
    const cart = cartBuild({ cart: { name: 'Game.crt' } as never, files: [] })!;
    const s = renderTemplate({ ...t }, S(), { names: ['bank00_8000'], cart });
    expect(s['build.bat']).toContain('"%JAVA%" -jar "%KICKASS%" Game.crt.asm -odir out');
    expect(s['build.bat']).toContain('-cartcrt out\\Game.crt');
  });
});

describe('the library of templates', () => {
  it('keeps what is a template, one of each name, never a built-in one', () => {
    const t = { name: 'Mine', 'build.bat': 'a', 'build.sh': 'b' };
    expect(readTemplate(t)).toEqual(t);
    expect(readTemplate({ ...t, assembler: '64tass', builtIn: 'nope' })).toEqual({ ...t, assembler: '64tass' });
    expect(readTemplate({ name: 'x', 'build.bat': 1 })).toBeNull();
    expect(readTemplate(null)).toBeNull();
    expect(readTemplateLibrary([t, { ...t, name: 'mine' }, 7, { ...t, name: 'Pack', builtIn: 'exomizer' }, { ...t, name: 'Other' }]).map(x => x.name)).toEqual(['Mine', 'Other']);
    expect(readTemplateLibrary('junk')).toEqual([]);
  });

  it('names a new one after the ones there are', () => {
    expect(newTemplateName([])).toBe('My build');
    expect(newTemplateName([{ name: 'My build' }, { name: 'my build 2' }])).toBe('My build 3');
    expect(newTemplateName([], 'Pack with Exomizer')).toBe('Pack with Exomizer 2');
  });
});

// the Pack with Exomizer template run as exported: Kick Assembler builds the program, Exomizer packs it, and real VICE
// (headless, the debug cartridge) runs the packed file, which exits with the xor of its data computed after decrunching
const jar = process.env.KICKASS_JAR || findKickAssJar();
const java = process.env.JAVA || 'java';
const vendored = join(__dirname, '..', '..', '..', 'apps', 'desktop', 'vendor', 'exomizer', 'exomizer.exe');
const EXO = findExomizer([process.env.EXOMIZER || '', process.platform === 'win32' && existsSync(vendored) ? vendored : ''].filter(Boolean));
const vice = process.env.VICE || findVice();
const tools = process.platform === 'win32' && !!jar && !!EXO && !!vice && spawnSync(java, ['-version'], { windowsHide: true }).status === 0;

describe.skipIf(!tools)('Pack with Exomizer as exported, with Kick Assembler, Exomizer and VICE', () => {
  const headless = (dir: string) => ['-config', join(dir, 'vice.ini'), '-default', '-console', '-sounddev', 'dummy', '+confirmonexit', '-debugcart', '-limitcycles', '60000000', '-autostartprgmode', '1'];
  const r = rng(11);
  const data = Array.from({ length: 4096 }, (_, i) => (i % 89 < 30 ? i & 3 : Math.floor(r() * 256)));
  let sum = data.reduce((a, b) => a ^ b, 0);
  if (sum === 0) { data[0] ^= 0x5a; sum = 0x5a; }
  const rows: string[] = [];
  for (let i = 0; i < data.length; i += 32) rows.push(`.byte ${data.slice(i, i + 32).map(x => `$${x.toString(16).padStart(2, '0')}`).join(',')}`);
  // xor the 16 pages from `page` and exit with it
  const code = (page: number) => [' lda #$00', ' sta $fb', ` lda #$${page.toString(16)}`, ' sta $fc', ' ldx #16', ' lda #0', ' ldy #0', 'loop:', ' eor ($fb),y', ' iny', ' bne loop', ' inc $fc', ' dex', ' bne loop', ' sta $d7ff', ' jmp *'];
  const programs = {
    // 10 SYS2061: {entry} is sys
    basic: fromSource('checksum.prg', ['.pc = $0801', '.byte $0b,$08,$0a,$00,$9e,$32,$30,$36,$31,$00,$00,$00', '.pc = $080d', ...code(0x09), '.pc = $0900', ...rows].join('\n')),
    // at $1000 without BASIC: {entry} is 0x1000
    c1000: fromSource('checksum at 1000.prg', ['.pc = $1000', ...code(0x11), '.pc = $1100', ...rows].join('\n')),
  };

  for (const [kind, f] of Object.entries(programs)) {
    it(`build.bat assembles and packs the ${kind === 'basic' ? 'BASIC' : '$1000'} program, and VICE runs the packed file`, async () => {
      const dir = await mkdtemp(join(tmpdir(), 'mimir-template-'));
      try {
        const s = S({ javaPath: java, kickJar: jar!, exomizerPath: EXO!, vicePath: vice! });
        const p: Project = { ...createProject({ files: [f], settings: s }), buildTemplate: builtInTemplate('exomizer', s) };
        const R = render(analyze(p), p);
        const files = exportFiles(p, R, s);
        // without the line that starts VICE (it would open its window): the test runs VICE headless itself
        const bat = (files['build.bat'] as string).split('\r\n').filter(l => !l.startsWith('start ')).join('\r\n');
        await writeVfs(dir, { ...files, 'build.bat': bat });
        writeFileSync(join(dir, 'build.bat'), bat);
        // .\ : with NoDefaultCurrentDirectoryInExePath set cmd does not look in the current folder
        const run = spawnSync('cmd', ['/d', '/c', '.\\build.bat'], { cwd: dir, timeout: 120_000, windowsHide: true, encoding: 'utf8' });
        expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0);
        const name = R.fileNames[0];
        expect(bat).toContain(kind === 'basic' ? `sfx sys -o out\\${name}-exo.prg` : `sfx 0x1000 -o out\\${name}-exo.prg`);
        const packed = readFileSync(join(dir, 'out', `${name}-exo.prg`));
        expect(packed[0] | (packed[1] << 8)).toBe(0x0801);
        expect(packed.length).toBeLessThan(makePrg(f.load, f.bytes).length);
        expect(spawnSync(vice!, [...headless(dir), '-autostart', join(dir, 'out', `${name}-exo.prg`)], { timeout: 90_000, windowsHide: true }).status).toBe(sum);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    }, 240_000);
  }
});
