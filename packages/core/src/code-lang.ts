/* =====================================================================
 * The language the user's own code is written in: a patch's code (spec 10.2), a script and its scratchpads' start
 * content (10.3). Kick Assembler or 64tass, as the project's assembler is when the code is made (Settings.assembler,
 * 11.8); a script or a patch keeps its own, so one written in Kick Assembler still assembles in a project switched to
 * 64tass. How a line is read in each (its comment, the label it starts with, block comments, the names it defines),
 * and which of the built-in assemblers assembles it.
 * ===================================================================== */
import type { AssembleResult, AssemblerId, ScriptLang, Vfs } from './types';
import { assemble, type AssembleOptions } from './verify/kick-subset-assembler';
import { assembleTass } from './verify/tass-subset-assembler';
import { OPC, TASS_ENC, tassName } from './cpu/opcodes';
import { TASS_ALL_MNEMONICS } from './verify/tass-cpu';

export type { ScriptLang };

/** the language new code is written in when the project's source is for `asm` */
export const langOf = (asm: AssemblerId | undefined): ScriptLang => (asm === '64tass' ? '64tass' : 'kickass');
/** the assembler that writes the source a language's code goes into */
export const asmOfLang = (lang: ScriptLang | undefined): AssemblerId => (lang === '64tass' ? '64tass' : 'kick');
/** a language as given (a patch has none when it is Kick Assembler) */
export const langIs = (lang: ScriptLang | undefined | null): ScriptLang => (lang === '64tass' ? '64tass' : 'kickass');
export const LANG_TITLE: Readonly<Record<ScriptLang, string>> = { kickass: 'Kick Assembler', '64tass': '64tass' };
/** the language a project would write new code in, said for the window */
export const LANGS: readonly ScriptLang[] = ['kickass', '64tass'];

/** Assemble code of the language with its built-in assembler. */
export const assembleIn = (lang: ScriptLang | undefined, vfs: Vfs, entry: string, opts: AssembleOptions = {}): AssembleResult =>
  (langIs(lang) === '64tass' ? assembleTass(vfs, entry, opts) : assemble(vfs, entry, opts));

/** where a line comment starts */
export const lineComment = (lang: ScriptLang | undefined): string => (langIs(lang) === '64tass' ? ';' : '//');

/**
 * Where the line's comment starts (outside strings), or -1. Kick Assembler: `//` (a string `"…"` with `\` escapes,
 * a character `'a'`); 64tass: `;` (strings in `"` or `'`, a quote doubled inside them).
 */
export function commentAt(line: string, lang: ScriptLang | undefined): number {
  const tass = langIs(lang) === '64tass';
  for (let k = 0; k < line.length; k++) {
    const c = line[k];
    if (c === '"' || (tass && c === "'")) {
      let j = k + 1;
      for (; j < line.length; j++) {
        if (!tass && line[j] === '\\') { j++; continue; }
        if (line[j] === c) { if (tass && line[j + 1] === c) { j++; continue; } break; }
      }
      k = j; continue;
    }
    if (!tass && c === "'" && line[k + 2] === "'") { k += 2; continue; }
    if (tass ? c === ';' : c === '/' && line[k + 1] === '/') return k;
  }
  return -1;
}

/** the line without its line comment */
export const withoutComment = (line: string, lang: ScriptLang | undefined): string => { const k = commentAt(line, lang); return k < 0 ? line : line.slice(0, k); };

/** the line with its strings emptied (`""`), so that what is in them is not read as code */
export const withoutStrings = (code: string, lang: ScriptLang | undefined): string => (langIs(lang) === '64tass'
  ? code.replace(/"(?:[^"]|"")*"|'(?:[^']|'')*'/g, '""')
  : code.replace(/"(?:[^"\\]|\\.)*"/g, '""'));

/**
 * Each line of the source as code: its comment taken out, and the lines of a block comment empty (Kick Assembler's
 * `/* … *\/`, 64tass's `.comment` … `.endc`), so that line `i` of the result is line `i` of the source.
 */
export function codeLines(source: string, lang: ScriptLang | undefined): string[] {
  const lines = source.split(/\r?\n/);
  if (langIs(lang) === '64tass') {
    let open = false;
    return lines.map(l => {
      const c = withoutComment(l, lang), t = c.trim();
      if (open) { if (/^\.endc(omment)?$/.test(t)) open = false; return ''; }
      if (/^\.comment$/.test(t)) { open = true; return ''; }
      return c;
    });
  }
  let open = false;
  return lines.map(l => {
    let out = '';
    for (let k = 0; k < l.length; k++) {
      if (open) { if (l[k] === '*' && l[k + 1] === '/') { open = false; k++; } continue; }
      const c = l[k];
      if (c === '"') { const e = l.indexOf('"', k + 1); const to = e < 0 ? l.length : e + 1; out += l.slice(k, to); k = to - 1; continue; }
      if (c === '/' && l[k + 1] === '/') break;
      if (c === '/' && l[k + 1] === '*') { open = true; k++; out += ' '; continue; }
      out += c;
    }
    return out;
  });
}

/** whether line `n` (from 1) starts inside a block comment an earlier line opened */
export function startsInBlockComment(lines: readonly string[], n: number, lang: ScriptLang | undefined): boolean {
  if (langIs(lang) === '64tass') {
    let open = false;
    for (let i = 0; i < n - 1 && i < lines.length; i++) {
      const t = withoutComment(lines[i], lang).trim();
      if (open) { if (/^\.endc(omment)?$/.test(t)) open = false; } else if (/^\.comment$/.test(t)) open = true;
    }
    // (the .endc line itself is still in the comment: open until it is read)
    return open;
  }
  let open = false;
  for (let i = 0; i < n - 1 && i < lines.length; i++) {
    const l = lines[i];
    for (let k = 0; k < l.length; k++) {
      if (open) { if (l[k] === '*' && l[k + 1] === '/') { open = false; k++; } continue; }
      if (l[k] === '"') { const e = l.indexOf('"', k + 1); if (e < 0) break; k = e; continue; }
      if (l[k] === '/' && l[k + 1] === '/') break;
      if (l[k] === '/' && l[k + 1] === '*') { open = true; k++; }
    }
  }
  return open;
}

/** whether a word first on a 64tass line is an instruction there, not a label (`lda #1`: 64tass reads the mnemonic, in
 *  lower case with -C; any processor's, as the line's processor is not known here: `phx`, `gcc`, `bge`) */
const tassMnemonic = (w: string) => /^[a-z]{3}$/.test(w) && (!!TASS_ENC[w.toUpperCase()] || TASS_ALL_MNEMONICS.has(w));

/**
 * The label a line of code starts with, and the line from what follows it (`lead`: the line up to there, the label
 * and the space after it). Kick Assembler: `name:`, `!name:` or `!:` after any indent. 64tass: first on the line, at
 * its start or after white space as 64tass takes it, `name` or `name:` (a lower-case mnemonic there is the
 * instruction), `_local`, `+` or `-`.
 */
export function splitLabel(code: string, lang: ScriptLang | undefined): { label?: string; lead: string; rest: string } {
  if (langIs(lang) === '64tass') {
    const ind = /^[ \t]*/.exec(code)![0], m = /^([A-Za-z_][A-Za-z0-9_]*|[+-])(:?)(?=\s|$|=|;)/.exec(code.slice(ind.length));
    if (m && !(!m[2] && tassMnemonic(m[1]))) {
      const end = ind.length + m[0].length, sp = /^[ \t]*/.exec(code.slice(end))![0];
      return { label: m[1], lead: code.slice(0, end + sp.length), rest: code.slice(end + sp.length) };
    }
    return { lead: ind, rest: code.slice(ind.length) };
  }
  const m = /^(\s*)([A-Za-z_][\w.]*|![A-Za-z_]\w*|!)\s*:[ \t]*/.exec(code);
  if (m) return { label: m[2], lead: m[0], rest: code.slice(m[0].length) };
  const sp = /^[ \t]*/.exec(code)![0];
  return { lead: sp, rest: code.slice(sp.length) };
}

/** a line of code without its comment, its strings and the label it starts with, trimmed */
export function codeOfLine(line: string, lang: ScriptLang | undefined): string {
  const c = withoutStrings(withoutComment(line, lang), lang);
  return splitLabel(langIs(lang) === '64tass' ? c : c.replace(/\/\*.*?\*\//g, ''), lang).rest.trim();
}

/**
 * The code labels the source defines (the addresses of its own code and data): `name:` in Kick Assembler, a name at
 * the start of a line in 64tass that is not `name = value` (a constant) or a namespace.
 */
export function codeLabels(source: string, lang: ScriptLang | undefined): Set<string> {
  const out = new Set<string>();
  for (const l of codeLines(source, lang)) {
    const s = splitLabel(l, lang);
    if (!s.label || /^[!+-]/.test(s.label)) continue;
    if (langIs(lang) === '64tass' && (/^:?=(?!=)/.test(s.rest) || /^\.(namespace|block)\b/.test(s.rest))) continue;
    out.add(s.label);
  }
  return out;
}

/** every name the source defines itself: its labels, and its `.label`/`.const`/`.var` (Kick Assembler) or its
 *  `name = value` and `name := value` (64tass) */
export function definedNames(source: string, lang: ScriptLang | undefined): Set<string> {
  const out = new Set<string>();
  for (const l of codeLines(source, lang)) {
    const s = splitLabel(l, lang);
    if (s.label && !/^[!+-]/.test(s.label)) out.add(s.label);
    if (langIs(lang) !== '64tass') for (const m of l.matchAll(/\.(?:label|const|var)\s+([A-Za-z_]\w*)/g)) out.add(m[1]);
  }
  return out;
}

/** the words of the code that can be names: not in comments or strings, not directives, numbers, `@w` or local
 *  labels (Kick Assembler's `!loop`) */
export function usedWords(source: string, lang: ScriptLang | undefined): Set<string> {
  const code = codeLines(source, lang).map(l => withoutStrings(l, lang).replace(/@[wbl]\b/g, ' ')).join('\n');
  return new Set([...code.matchAll(/(?<![.\w$%!])[A-Za-z_]\w*/g)].map(m => m[0]));
}

/** the mnemonics 64tass has only undocumented opcodes for (it needs `.cpu "6502i"` for them), by 64tass's names */
const TASS_UNDOC = (() => {
  const doc = new Set(OPC.filter(o => !o.ill).map(o => tassName(o.mn).toLowerCase()));
  return new Set(OPC.filter(o => o.ill).map(o => tassName(o.mn).toLowerCase()).filter(n => !doc.has(n)));
})();

/** whether 64tass code has an undocumented opcode (`lax`, `isb`, `nop #$80`) and no `.cpu` line: it needs `.cpu "6502i"` */
export function needsTassCpu(lines: readonly string[]): boolean {
  if (lines.some(l => /^\s*\.cpu\b/.test(withoutComment(l, '64tass')))) return false;
  return lines.some(l => {
    const m = /^([a-z]{3})\b(.*)$/i.exec(codeOfLine(l, '64tass'));
    return !!m && (TASS_UNDOC.has(m[1].toLowerCase()) || (m[1].toLowerCase() === 'nop' && m[2].trim() !== ''));
  });
}

/** whether the source's first line of code says where it goes: `* =` (or Kick Assembler's `.pc =`) */
export function setsItsPlace(source: string, lang: ScriptLang | undefined): boolean {
  const code = codeLines(source, lang).map(l => l.trim()).find(l => l);
  return !!code && (langIs(lang) === '64tass' ? /^\*\s*=/ : /^(?:\*|\.pc)\s*=/).test(code);
}
