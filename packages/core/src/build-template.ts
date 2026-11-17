/* Build templates (spec 11.4b): build.bat and build.sh with placeholders that Mimir fills in for each project, so one
 * template serves every project. The generated scripts are the original template filled in; a new template starts
 * as that text; Mimir's own templates (Pack with Exomizer) are made from the same lines. */
import type { AssemblerId, BuildScript, BuildTemplate, BuiltInTemplateId, Settings } from './types';
import type { CartBuild } from './export';
import { assemblerOf, TASS_FIXED_ARGS } from './render/dialect';

/** What a template's placeholders say, for the template editor's help (spec 11.4b). */
export const TEMPLATE_PLACEHOLDERS: readonly { name: string; about: string }[] = [
  { name: 'source', about: 'a line with it is written once for each source the build assembles, in order, with that source’s name (without .asm)' },
  { name: 'name', about: 'the program: the first source, whose PRG VICE starts' },
  { name: 'out', about: 'the output folder (Settings → Toolchain)' },
  { name: 'labels', about: 'the VICE label file’s name, without .vs' },
  { name: 'start', about: 'what VICE starts: -autostart with the program’s PRG, or -cartcrt with the cartridge' },
  { name: 'cart', about: 'the cartridge image, <name>.crt (its source is {cart}.asm); a line with it is left out when the project has no cartridge' },
  { name: 'entry', about: 'where Exomizer’s sfx starts the program: sys (its BASIC line’s SYS), basic (RUN), or 0x<address> (the program start)' },
  { name: 'java', about: 'Java (Settings)' },
  { name: 'kickass', about: 'KickAss.jar (Settings)' },
  { name: 'tass', about: '64tass (Settings; empty: 64tass)' },
  { name: 'vice', about: 'VICE (Settings)' },
  { name: 'exomizer', about: 'Exomizer (Settings; empty: exomizer)' },
  { name: 'kickArgs', about: 'Kick Assembler’s arguments (Settings)' },
  { name: 'tassArgs', about: '64tass’s arguments besides Mimir’s own (Settings)' },
  { name: 'viceArgs', about: 'VICE’s arguments (Settings)' },
];

const KNOWN = new Set(TEMPLATE_PLACEHOLDERS.map(p => p.name));
/** a placeholder: a known name in braces, not after a $ (`${name}` is the shell's) */
const PLACEHOLDER = /( ?)(?<!\$)\{([A-Za-z]+)\}/g;

/** the placeholders a line has (known names only, each once) */
export const placeholdersIn = (line: string): string[] => {
  const out = new Set<string>();
  for (const m of line.matchAll(PLACEHOLDER)) if (KNOWN.has(m[2])) out.add(m[2]);
  return [...out];
};

/** What a project gives the placeholders: null where it has nothing (a line that uses it is left out). */
export interface TemplateValues {
  /** the sources the build assembles (names without .asm), in order: a `{source}` line is written once for each */
  sources: string[];
  values: Record<string, string | null>;
}

/** The sources a build assembles, what VICE starts and where Exomizer's sfx starts the program. */
export interface BuildTarget {
  /** the project's source names (RenderResult.fileNames) */
  names: string[];
  cart: CartBuild | null;
  /** Exomizer's sfx start (sfxEntry); missing: sys */
  entry?: string;
}

/** The placeholders' values for one of the scripts (its path separator), from the settings and the build. */
export function templateValues(S: Settings, t: BuildTarget, script: BuildScript): TemplateValues {
  const sep = script === 'build.bat' ? '\\' : '/', cart = t.cart;
  // every bank in one source (13.9c): the chips have no source of their own, and VICE gets that source's labels
  const sources = cart?.one ? t.names.filter(n => !cart.chips.includes(n)) : t.names;
  const name = t.names[0] ?? null, image = cart ? cart.output : null;
  const labels = cart?.one ? cart.entry.replace(/\.asm$/, '') : name;
  const start = image ? `-cartcrt ${S.outDir}${sep}${image}` : name != null ? `-autostart ${S.outDir}${sep}${name}.prg` : null;
  return {
    sources,
    values: {
      name, out: S.outDir, labels, start, cart: image, entry: t.entry ?? 'sys',
      java: S.javaPath, kickass: S.kickJar, tass: S.tassPath || '64tass', vice: S.vicePath, exomizer: S.exomizerPath || 'exomizer',
      kickArgs: S.kickArgs, tassArgs: S.tassArgs, viceArgs: S.viceArgs,
    },
  };
}

/**
 * A template's text filled in: each known placeholder replaced by its value (an empty value takes the space before it
 * along), a line with `{source}` written once for each source, a line with a placeholder that has no value in this
 * project left out. Lines end with `eol`.
 */
export function fillTemplate(text: string, v: TemplateValues, eol: string): string {
  const out: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const names = placeholdersIn(line);
    if (names.some(n => n !== 'source' && v.values[n] == null)) continue;
    for (const source of names.includes('source') ? v.sources : [null]) {
      const values: Record<string, string | null> = { ...v.values, source };
      out.push(line.replace(PLACEHOLDER, (m, space: string, n: string) => {
        if (!KNOWN.has(n)) return m;
        const value = values[n] ?? '';
        return value === '' ? '' : `${space}${value}`;
      }));
    }
  }
  return out.join(eol);
}

/** The line ends of a script: build.bat's CRLF, build.sh's LF. */
export const scriptEol = (script: BuildScript): string => (script === 'build.bat' ? '\r\n' : '\n');

/** A template's build.bat and build.sh filled in for a build. */
export function renderTemplate(t: Pick<BuildTemplate, BuildScript>, S: Settings, target: BuildTarget): Record<BuildScript, string> {
  return {
    'build.bat': fillTemplate(t['build.bat'], templateValues(S, target, 'build.bat'), '\r\n'),
    'build.sh': fillTemplate(t['build.sh'], templateValues(S, target, 'build.sh'), '\n'),
  };
}

/** what the scripts do: assemble and start VICE (the generated ones), or also pack the program with Exomizer first */
type Kind = 'build' | 'exomizer';

/** The lines of a template for the assembler: build.bat's and build.sh's (each ends with an empty line). `cart`: with
 *  the line that assembles a cartridge's source. */
function templateLines(asm: AssemblerId, cart: boolean, kind: Kind): Record<BuildScript, string> {
  const pack = kind === 'exomizer';
  const about = pack ? ['Packs {out}{sep}{name}.prg with Exomizer (a self-extracting file) and starts the packed {name}-exo.prg'] : [];
  const tool = (sep: '\\' | '/') => {
    const fixed = TASS_FIXED_ARGS.join(' ');
    return asm === '64tass'
      ? [`-a -C --nostart -X {tassArgs} -o {out}${sep}{cart} --vice-labels -l {out}${sep}{cart}.vs {cart}.asm`, `${fixed} {tassArgs} -o {out}${sep}{source}.prg --vice-labels -l {out}${sep}{source}.vs {source}.asm`]
      : ['{cart}.asm -odir {out} {kickArgs}', '{source}.asm -odir {out} {kickArgs}'];
  };
  const bat = (() => {
    const [cartArgs, args] = tool('\\'), run = asm === '64tass' ? '"%TASS%"' : '"%JAVA%" -jar "%KICKASS%"';
    return ['@echo off', 'rem Build script generated by Mimir Studio', ...about.map(a => `rem ${a.replace('{sep}', '\\')}`),
      ...(asm === '64tass' ? ['set TASS={tass}'] : ['set JAVA={java}', 'set KICKASS={kickass}']), ...(pack ? ['set EXOMIZER={exomizer}'] : []), 'set VICE={vice}', '',
      ...(asm === '64tass' ? ['if not exist {out} mkdir {out}'] : []),
      `${run} ${args} || exit /b 1`, ...(cart ? [`${run} ${cartArgs} || exit /b 1`] : []),
      ...(pack ? ['"%EXOMIZER%" sfx {entry} -o {out}\\{name}-exo.prg {out}\\{name}.prg || exit /b 1', 'start "" "%VICE%" {viceArgs} -moncommands {out}\\{labels}.vs -autostart {out}\\{name}-exo.prg']
        : ['start "" "%VICE%" {viceArgs} -moncommands {out}\\{labels}.vs {start}']), ''].join('\n');
  })();
  const sh = (() => {
    const [cartArgs, args] = tool('/'), run = asm === '64tass' ? '"$TASS"' : '"$JAVA" -jar "$KICKASS"';
    return ['#!/bin/sh', '# Build script generated by Mimir Studio', ...about.map(a => `# ${a.replace('{sep}', '/')}`), 'set -e',
      ...(asm === '64tass' ? ['TASS="${TASS:-64tass}"'] : ['JAVA="${JAVA:-{java}}"', 'KICKASS="${KICKASS:-$HOME/c64/KickAss.jar}"']), ...(pack ? ['EXOMIZER="${EXOMIZER:-exomizer}"'] : []), 'VICE="${VICE:-x64sc}"', '',
      ...(asm === '64tass' ? ['mkdir -p {out}'] : []),
      `${run} ${args}`, ...(cart ? [`${run} ${cartArgs}`] : []),
      ...(pack ? ['"$EXOMIZER" sfx {entry} -o {out}/{name}-exo.prg {out}/{name}.prg', '"$VICE" {viceArgs} -moncommands {out}/{labels}.vs -autostart {out}/{name}-exo.prg']
        : ['"$VICE" {viceArgs} -moncommands {out}/{labels}.vs {start}']), ''].join('\n');
  })();
  return { 'build.bat': bat, 'build.sh': sh };
}

/** The original build.bat and build.sh as a template: what the generated scripts are filled in from, and what a new
 *  template starts as. `cart`: the project has a cartridge (its source is assembled too). */
export function originalTemplate(S: Pick<Settings, 'assembler'>, cart = false): Record<BuildScript, string> {
  return templateLines(assemblerOf(S), cart, 'build');
}

/** Mimir's own templates: always there, not edited (a copy of one is) */
export const BUILT_IN_TEMPLATES: readonly { id: BuiltInTemplateId; name: string; about: string }[] = [
  { id: 'exomizer', name: 'Pack with Exomizer', about: 'Assembles the sources, packs out/<name>.prg with Exomizer into a self-extracting <name>-exo.prg and starts that in VICE' },
];

/** A built-in template's text for the project's assembler (and cartridge). */
export function builtInTemplate(id: BuiltInTemplateId, S: Pick<Settings, 'assembler'>, cart = false): BuildTemplate {
  const b = BUILT_IN_TEMPLATES.find(t => t.id === id) ?? BUILT_IN_TEMPLATES[0];
  return { name: b.name, builtIn: b.id, assembler: assemblerOf(S), ...templateLines(assemblerOf(S), cart, b.id) };
}

/** The text a project's template has now: a built-in one's for the project's assembler, a user's as it was kept. */
export function templateText(t: BuildTemplate, S: Pick<Settings, 'assembler'>, cart = false): Record<BuildScript, string> {
  if (t.builtIn) { const b = builtInTemplate(t.builtIn, S, cart); return { 'build.bat': b['build.bat'], 'build.sh': b['build.sh'] }; }
  return { 'build.bat': t['build.bat'], 'build.sh': t['build.sh'] };
}

/**
 * Where Exomizer's sfx starts the program ({entry}): the program start the user set (0x<address>), else for a program
 * at $0801 sys when its first BASIC line has a SYS and basic (RUN) when not, else the first file's load address.
 */
export function sfxEntry(project: { files?: readonly { load: number; bytes: Uint8Array }[]; entryPoint?: number | null }): string {
  const hex = (a: number) => `0x${a.toString(16).padStart(4, '0')}`;
  if (project.entryPoint != null) return hex(project.entryPoint);
  const f = project.files?.[0];
  if (!f) return 'sys';
  if (f.load !== 0x0801) return hex(f.load);
  // the first line: its link, its number, then its tokens up to a 0 (SYS is $9e)
  for (let i = 4; i < f.bytes.length && f.bytes[i] !== 0; i++) if (f.bytes[i] === 0x9e) return 'sys';
  return 'basic';
}

/** A template as the library and a project keep it, when it is one (a name and the two texts); null otherwise. */
export function readTemplate(o: unknown): BuildTemplate | null {
  if (!o || typeof o !== 'object') return null;
  const t = o as Record<string, unknown>;
  if (typeof t.name !== 'string' || !t.name.trim() || typeof t['build.bat'] !== 'string' || typeof t['build.sh'] !== 'string') return null;
  const builtIn = BUILT_IN_TEMPLATES.some(b => b.id === t.builtIn) ? t.builtIn as BuiltInTemplateId : undefined;
  const assembler = t.assembler === 'kick' || t.assembler === '64tass' ? t.assembler : undefined;
  return { name: t.name.slice(0, 80), 'build.bat': t['build.bat'].slice(0, 65536), 'build.sh': t['build.sh'].slice(0, 65536), ...(assembler ? { assembler } : {}), ...(builtIn ? { builtIn } : {}) };
}

/** The user's templates as localStorage kept them: those that are templates, one of each name. */
export function readTemplateLibrary(v: unknown): BuildTemplate[] {
  const out: BuildTemplate[] = [];
  for (const o of Array.isArray(v) ? v : []) {
    const t = readTemplate(o);
    if (t && !t.builtIn && !out.some(x => x.name.toLowerCase() === t.name.toLowerCase())) out.push(t);
  }
  return out;
}

/** A name for a new template that the library does not have yet: `base`, `base 2`, … */
export function newTemplateName(library: readonly Pick<BuildTemplate, 'name'>[], base = 'My build'): string {
  const taken = new Set([...library.map(t => t.name.toLowerCase()), ...BUILT_IN_TEMPLATES.map(b => b.name.toLowerCase())]);
  if (!taken.has(base.toLowerCase())) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base} ${i}`.toLowerCase())) return `${base} ${i}`;
}
