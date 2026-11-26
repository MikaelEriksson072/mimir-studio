/* =====================================================================
 * The macro and code libraries (spec 10.8): macros and pieces of code the user keeps for every Assembler project, each a
 * file in the library's folder (Macros, Code, beside SIDs, Sprites … and Scripts), so they can be shared, kept under
 * version control, written with any editor and imported by a source as they are.
 *
 * The file is the code as it is; what it is besides its code (its assembler, its description, its colour, when it was
 * made, where it was taken from) is one line at the top, a comment to the assembler:
 *
 *     // mimir-library {"lang":"kickass","created":"2026-11-26T20:14:00.000Z","color":"teal","description":"…"}
 *
 * (`; mimir-library …` in 64tass). A file without the line is one too: its code alone, the assembler guessed from it,
 * made when its file was. Its name is its file's. The lists are in alphabetical order, a group a letter (A–Z, Å, Ä, Ö,
 * then # for the rest), and a search looks through names, descriptions and the code.
 *
 * A macro's definition is read from its code: Kick Assembler's `.macro Name(a, b) { … }` (`.pseudocommand`,
 * `.function` too), 64tass's `Name .macro a, b` … `.endm` (`.segment` … `.endsegment`, `.function` … `.endf`,
 * `.sfunction`). Code taken from a source becomes a macro wrapped in one (codeLibWrap).
 * ===================================================================== */
import type { ScriptLang } from './types';
import { isBookmarkColor } from './types';
import { langIs } from './code-lang';

export type CodeLibKind = 'macro' | 'code';
export const CODE_LIB_KINDS: readonly CodeLibKind[] = ['macro', 'code'];
/** each kind's folder in the library's folder */
export const CODE_LIB_FOLDERS: Readonly<Record<CodeLibKind, string>> = { macro: 'Macros', code: 'Code' };
/** the most a file of them may be */
export const CODE_LIB_FILE_MAX = 1024 * 1024;
/** the longest a name (the file's, without .asm) and a description may be */
export const CODE_LIB_NAME_MAX = 100;
export const CODE_LIB_DESCRIPTION_MAX = 20000;

/** what an item is besides its code: its assembler, description, colour (a bookmark's: a preset's name or #rrggbb;
 *  missing: none), when it was made (ms) and where it was taken from (`project · main.asm:12–30`) */
export interface CodeLibMeta {
  lang: ScriptLang;
  description: string;
  color?: string;
  created: number;
  from?: string;
}
/** a macro or a piece of code of the library: its kind (its folder), its file there and its name (the file's
 *  without the extension), its code, when its file changed; `own`: a file without the line (put there by hand) */
export interface CodeLibItem extends CodeLibMeta {
  kind: CodeLibKind;
  file: string;
  name: string;
  code: string;
  changed: number;
  own?: boolean;
}

const EXT = /\.(asm|s|inc|a|a65|tas|65s)$/i;
/** whether `file` is a plain name of a file of the libraries: no folder in it, a source's extension, not hidden */
// eslint-disable-next-line no-control-regex
export const isCodeLibFileName = (file: string): boolean => file.length <= 130 && /^[^\\/:*?"<>|\u0000-\u001f]+$/.test(file) && EXT.test(file) && !/^[.\-\s]/.test(file) && !file.includes('..');
/** an item's name as a file's: what a file name cannot hold made _, no dots or white space at the ends (not empty) */
// eslint-disable-next-line no-control-regex
export const codeLibStem = (name: string): string => name.replace(/[\\/:*?"<>|\u0000-\u001f\u007f]+/g, '_').replace(/\s+/g, ' ').trim().replace(/^[.\-\s]+/, '').slice(0, CODE_LIB_NAME_MAX).replace(/[.\s]+$/, '') || 'untitled';
/** the file's name for an item named `name`: .asm, made unique among `taken` (any case) with (2), (3) … */
export function codeLibFileName(name: string, taken: Iterable<string>): string {
  const stem = codeLibStem(name), low = new Set([...taken].map(t => t.toLowerCase()));
  let file = `${stem}.asm`;
  for (let n = 2; low.has(file.toLowerCase()); n++) file = `${stem} (${n}).asm`;
  return file;
}
/** a file's name without its extension: the item's name */
export const codeLibNameOf = (file: string): string => file.replace(EXT, '');

const HEAD = /^(?:\/\/|;)\s*mimir-library\s+(\{.*\})\s*$/;

/** An item as its file's text: the line that says what it is besides its code, then the code (ending in a newline). */
export function codeLibFileText(meta: CodeLibMeta, code: string): string {
  const j = {
    lang: langIs(meta.lang), created: new Date(meta.created).toISOString(),
    ...(meta.color && isBookmarkColor(meta.color) ? { color: meta.color.toLowerCase() } : {}),
    ...(meta.description.trim() ? { description: meta.description.replace(/\r\n/g, '\n').trimEnd() } : {}),
    ...(meta.from ? { from: meta.from } : {}),
  };
  const body = code.replace(/\r\n/g, '\n').replace(/\s+$/, '');
  return `${langIs(meta.lang) === '64tass' ? ';' : '//'} mimir-library ${JSON.stringify(j)}\n${body}\n`;
}

/**
 * An item read from its file (`kind` its folder's), with the file's times (`born`: when it was made, for one without
 * the line). What the line holds is read with care, as anything from outside is: what is not as it should be is left
 * out. null: not a file of the libraries (its name, or too long).
 */
export function readCodeLibFile(kind: CodeLibKind, file: string, text: string, times: { changed: number; born?: number }, guess: ScriptLang = 'kickass'): CodeLibItem | null {
  if (!isCodeLibFileName(file) || text.length > CODE_LIB_FILE_MAX) return null;
  const nl = text.indexOf('\n'), first = (nl < 0 ? text : text.slice(0, nl)).replace(/\r$/, ''), m = HEAD.exec(first);
  let o: Record<string, unknown> = {};
  if (m) { try { const j: unknown = JSON.parse(m[1]); if (j && typeof j === 'object' && !Array.isArray(j)) o = j as Record<string, unknown>; } catch { /* a line that is no JSON: the code alone counts */ } }
  const code = (m ? (nl < 0 ? '' : text.slice(nl + 1)) : text).replace(/\r\n/g, '\n').replace(/\s+$/, '');
  const lang: ScriptLang = o.lang === '64tass' || o.lang === 'kickass' ? o.lang : guessAsmLang(code, guess);
  const made = typeof o.created === 'string' ? Date.parse(o.created) : typeof o.created === 'number' ? o.created : NaN;
  const created = Number.isFinite(made) && made > 0 ? made : times.born && times.born > 0 ? Math.min(times.born, times.changed) : times.changed;
  const color = typeof o.color === 'string' && isBookmarkColor(o.color) ? o.color.toLowerCase() : undefined;
  const description = typeof o.description === 'string' ? o.description.slice(0, CODE_LIB_DESCRIPTION_MAX) : '';
  const from = typeof o.from === 'string' && o.from.length <= 500 ? o.from : undefined;
  return { kind, file, name: codeLibNameOf(file), code, lang, description, created, changed: times.changed, ...(color ? { color } : {}), ...(from ? { from } : {}), ...(m ? {} : { own: true }) };
}

/** The assembler code is written for, guessed from what only one of them has (`fallback`: neither, or as much of both). */
export function guessAsmLang(code: string, fallback: ScriptLang = 'kickass'): ScriptLang {
  let kick = 0, tass = 0;
  for (const raw of code.split('\n')) {
    const l = raw.replace(/\r$/, '');
    if (/^\s*\.(macro|pseudocommand|function)\s+@?[A-Za-z_]\w*\s*[({]/.test(l) || /^\s*\.(var|const|label|namespace|filenamespace|import|for|eval|print|return)\b/.test(l)) kick += 2;
    if (/^\s*#import\b|^\s*\*\s*=\s*\S+\s+"|BasicUpstart2?\s*\(|!\s*:|![a-z_]\w*\s*:|\bjmp\s+![+-]|^\s*}\s*(else\b|$)|^\s*\/\//i.test(l)) kick++;
    if (/^\s*[A-Za-z_]\w*:?\s+\.(macro|segment|function|sfunction|proc|block|struct|union)\b/.test(l) || /^\s*\.(endm|endmacro|endsegment|endf|endfunction|pend|bend|endp|endproc|endblock|cpu|enc|cerror|cwarn|include|binary)\b/i.test(l)) tass += 2;
    if (/^\s*;|\\[1-9@]|^\s*\.(byte|word|text|fill)\b.*;|^\s*\*\s*=\s*\$[0-9a-f]+\s*(;|$)/i.test(l)) tass++;
  }
  return kick > tass ? 'kickass' : tass > kick ? '64tass' : fallback;
}

/** a macro (or a pseudo command, a function, a segment) defined in a piece of code: its name, its parameters, how it
 *  is written (`how`) and the lines it is on (from 1, `end` its last) */
export interface CodeLibMacro { name: string; params: string[]; how: 'macro' | 'pseudocommand' | 'function' | 'segment' | 'sfunction'; line: number; end: number }

const KICK_DEF = /^\s*\.(macro|pseudocommand|function)\s+@?([A-Za-z_]\w*)\s*(.*)$/;
const TASS_DEF = /^\s*([A-Za-z_]\w*):?\s+\.(macro|segment|function|sfunction)\b\s*(.*)$/;

/** the code of a line, its comment and strings left out (`block`: in a Kick Assembler /* … *\/ comment as it starts; it
 *  says whether it is at its end) */
function bare(line: string, tass: boolean, block: { in: boolean }): string {
  let out = '', q = '';
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (block.in) { if (c === '*' && line[i + 1] === '/') { block.in = false; i++; } continue; }
    if (q) { if (c === '\\') i++; else if (c === q) q = ''; continue; }
    if (c === '"' || (c === '\'' && line[i + 2] === '\'')) { q = c; continue; }
    if (tass ? c === ';' : c === '/' && line[i + 1] === '/') break;
    if (!tass && c === '/' && line[i + 1] === '*') { block.in = true; i++; continue; }
    out += c;
  }
  return out;
}

const splitParams = (s: string, sep: RegExp): string[] => s.split(sep).map(p => p.trim().replace(/\s*=.*$/, '')).filter(Boolean);

/** The macros (pseudo commands, functions, segments) a piece of code defines, in the order they are written. */
export function codeLibMacros(code: string, lang: ScriptLang): CodeLibMacro[] {
  const tass = langIs(lang) === '64tass', lines = code.split('\n').map(l => l.replace(/\r$/, ''));
  const out: CodeLibMacro[] = [];
  const block = { in: false };
  const texts = lines.map(l => bare(l, tass, block));
  for (let i = 0; i < lines.length; i++) {
    const t = texts[i];
    if (tass) {
      const m = TASS_DEF.exec(t);
      if (!m) continue;
      const how = m[2].toLowerCase() as CodeLibMacro['how'];
      if (how === 'sfunction') { const a = /^([^=]*)=/.exec(m[3]); out.push({ name: m[1], params: a ? splitParams(a[1], /,/) : [], how, line: i + 1, end: i + 1 }); continue; }
      // (macros in it: their ends are not its)
      let depth = 1, end = lines.length;
      for (let j = i + 1; j < lines.length; j++) {
        if (TASS_DEF.test(texts[j]) && !/\.sfunction\b/i.test(texts[j])) depth++;
        else if (/^\s*\.(endm|endmacro|endsegment|endf|endfunction)\b/i.test(texts[j]) && --depth === 0) { end = j + 1; break; }
      }
      out.push({ name: m[1], params: splitParams(m[3], /,/), how, line: i + 1, end });
      i = end - 1;
      continue;
    }
    const m = KICK_DEF.exec(t);
    if (!m) continue;
    const how = m[1] as CodeLibMacro['how'];
    let params: string[] = [];
    if (how === 'pseudocommand') params = splitParams(m[3].replace(/\{.*$/, ''), /:/);
    else { const a = /^\(([^)]*)\)/.exec(m[3]); if (a) params = splitParams(a[1], /,/); }
    // its body: from its { to the } that closes it
    let depth = 0, opened = false, end = lines.length;
    for (let j = i; j < lines.length && end === lines.length; j++) {
      const s = j === i ? t.slice(t.indexOf(m[2]) + m[2].length) : texts[j];
      for (const c of s) {
        if (c === '{') { depth++; opened = true; } else if (c === '}' && opened && --depth === 0) { end = j + 1; break; }
      }
    }
    out.push({ name: m[2], params, how, line: i + 1, end });
    i = end - 1;
  }
  return out;
}

/** the macro (…) whose lines `line` (from 1) is on */
export const codeLibMacroAt = (code: string, lang: ScriptLang, line: number): CodeLibMacro | null =>
  codeLibMacros(code, lang).find(d => line >= d.line && line <= d.end) ?? null;

/** whether a piece of code is one macro's definition (…) and nothing else but comments and empty lines */
export function codeLibIsMacro(code: string, lang: ScriptLang): CodeLibMacro | null {
  const defs = codeLibMacros(code, lang);
  if (defs.length !== 1) return null;
  const d = defs[0], tass = langIs(lang) === '64tass', block = { in: false };
  const rest = code.split('\n').filter((l, i) => { const t = bare(l.replace(/\r$/, ''), tass, block); return (i + 1 < d.line || i + 1 > d.end) && t.trim(); });
  return rest.length ? null : d;
}

/** what calls a macro (…): `Name(a, b)` in Kick Assembler (a pseudo command `Name a : b`), `#Name a, b` in 64tass (a
 *  function `Name(a)`); `snippet`: its parameters as places to type in (Monaco's ${1:a}) */
export function codeLibCall(d: Pick<CodeLibMacro, 'name' | 'params' | 'how'>, lang: ScriptLang, snippet = false): string {
  const esc = (s: string) => (snippet ? s.replace(/[$}\\]/g, '\\$&') : s);
  const ps = d.params.map((p, i) => (snippet ? `\${${i + 1}:${esc(p)}}` : p));
  if (langIs(lang) === '64tass') {
    if (d.how === 'function' || d.how === 'sfunction') return `${esc(d.name)}(${ps.join(', ')})`;
    return `#${esc(d.name)}${ps.length ? ` ${ps.join(', ')}` : ''}`;
  }
  if (d.how === 'pseudocommand') return `${esc(d.name)}${ps.length ? ` ${ps.join(' : ')}` : ''}`;
  return `${esc(d.name)}(${ps.join(', ')})`;
}

/** a macro's signature as a list shows it: `Name(a, b)`, `Name a, b` (64tass) */
export function codeLibSignature(d: Pick<CodeLibMacro, 'name' | 'params' | 'how'>, lang: ScriptLang): string {
  if (langIs(lang) === '64tass') return d.how === 'function' || d.how === 'sfunction' ? `${d.name}(${d.params.join(', ')})` : `${d.name}${d.params.length ? ` ${d.params.join(', ')}` : ''}`;
  return d.how === 'pseudocommand' ? `${d.name}${d.params.length ? ` ${d.params.join(' : ')}` : ''}` : `${d.name}(${d.params.join(', ')})`;
}

/** a name a macro can have: a letter or _ first, then letters, digits and _ (what is not, left out) */
export const macroName = (s: string): string => {
  const t = s.trim().replace(/[^A-Za-z0-9_]+/g, '_').replace(/(?<=.)_+$/, '');
  return /^[A-Za-z_]/.test(t) ? t : t ? `_${t}` : '';
};

/** the white space every line that has text starts with, taken off (tabs and spaces as they are) */
export function codeLibDedent(code: string): string {
  const lines = code.split('\n');
  let pre: string | null = null;
  for (const l of lines) {
    if (!l.trim()) continue;
    const ind = /^[ \t]*/.exec(l)![0];
    if (pre == null) pre = ind;
    else { let k = 0; while (k < pre.length && k < ind.length && pre[k] === ind[k]) k++; pre = pre.slice(0, k); }
    if (!pre) break;
  }
  return pre ? lines.map(l => (l.startsWith(pre!) ? l.slice(pre!.length) : l.trimStart())).join('\n') : code;
}

/** The lines `from` to `to` (from 1) of a source as an item's code: without the indent they all have, the empty lines
 *  at the ends left out. */
export function codeLibTake(text: string, from: number, to: number): string {
  const lines = text.split('\n').map(l => l.replace(/\r$/, '')).slice(Math.max(0, from - 1), Math.max(from, to));
  while (lines.length && !lines[0].trim()) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  return codeLibDedent(lines.join('\n').replace(/[ \t]+$/gm, ''));
}

/**
 * Code made a macro named `name` (`params` its parameters): Kick Assembler's `.macro Name(a, b) {` with the code
 * indented once inside, `}`; 64tass's `Name .macro a, b` (the name where a label is, `.macro` where the code's
 * instructions start), the code as it is, `.endm` under `.macro`.
 */
export function codeLibWrap(code: string, name: string, params: readonly string[], lang: ScriptLang): string {
  const n = macroName(name) || 'Name', body = code.replace(/\r\n/g, '\n').replace(/\s+$/, '');
  if (langIs(lang) === '64tass') {
    const inds = body.split('\n').filter(l => /^[ \t]+\S/.test(l)).map(l => /^[ \t]*/.exec(l)![0]);
    const ind = inds.sort((a, b) => a.length - b.length)[0] ?? '        ';
    const width = ind.replace(/\t/g, '        ').length;
    const head = n.length < width ? n.padEnd(width) : `${n} `;
    return `${head}.macro${params.length ? ` ${params.join(', ')}` : ''}\n${body}\n${ind}.endm`;
  }
  return `.macro ${n}(${params.join(', ')}) {\n${body.split('\n').map(l => (l.trim() ? `    ${l}` : '')).join('\n')}\n}`;
}

/** where a macro (…) named `name` is defined in a source: its line (from 1), or 0 */
export function definesMacro(text: string, lang: ScriptLang, name: string): number {
  const lines = text.split('\n');
  const re = langIs(lang) === '64tass' ? TASS_DEF : KICK_DEF;
  for (let i = 0; i < lines.length; i++) { const m = re.exec(lines[i]); if (m && (langIs(lang) === '64tass' ? m[1] : m[2]) === name) return i + 1; }
  return 0;
}

/** the letters the lists are grouped by: A–Z, then Å, Ä and Ö, then # for a name that starts with neither */
export const CODE_LIB_LETTERS: readonly string[] = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZÅÄÖ', '#'];
/** the letter a name is listed under: its first letter (after _ . @ ! and the like; é as e), a digit's or another's # */
export function codeLibLetter(name: string): string {
  const t = name.trim().replace(/^[^\p{L}\p{N}]+/u, '');
  const c = t.charAt(0).toLocaleUpperCase('sv');
  if (/^[A-ZÅÄÖ]$/.test(c)) return c;
  const base = c.normalize('NFD').replace(/[̀-ͯ]/g, '');
  return /^[A-Z]$/.test(base) ? base : '#';
}
const collate = new Intl.Collator('sv', { sensitivity: 'base', numeric: true });
/** the items in alphabetical order: by their letter (as CODE_LIB_LETTERS), then by name, Swedish style */
export function codeLibOrder<T extends Pick<CodeLibItem, 'name' | 'file'>>(items: readonly T[]): T[] {
  const at = (n: string) => CODE_LIB_LETTERS.indexOf(codeLibLetter(n));
  return [...items].sort((a, b) => at(a.name) - at(b.name) || collate.compare(a.name.replace(/^[^\p{L}\p{N}]+/u, ''), b.name.replace(/^[^\p{L}\p{N}]+/u, '')) || collate.compare(a.name, b.name) || a.file.localeCompare(b.file));
}
/** the items in groups by letter, in order (no empty groups) */
export function codeLibGroups<T extends Pick<CodeLibItem, 'name' | 'file'>>(items: readonly T[]): { letter: string; items: T[] }[] {
  const out: { letter: string; items: T[] }[] = [];
  for (const i of codeLibOrder(items)) {
    const l = codeLibLetter(i.name), g = out[out.length - 1];
    if (g && g.letter === l) g.items.push(i); else out.push({ letter: l, items: [i] });
  }
  return out;
}

/** Whether an item matches a search: every word of it is in its name, its description, its macro's signature, where it
 *  was taken from or its code (any case). */
export function codeLibMatches(i: Pick<CodeLibItem, 'name' | 'description' | 'code' | 'lang'> & { from?: string }, q: string): boolean {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = `${i.name}\n${i.description}\n${i.from ?? ''}\n${i.code}`.toLowerCase();
  return words.every(w => hay.includes(w));
}
/** where a search's first word is in an item: its name, its description or only its code (null: no search) */
export function codeLibHit(i: Pick<CodeLibItem, 'name' | 'description' | 'code'>, q: string): 'name' | 'description' | 'code' | null {
  const w = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!w.length) return null;
  const has = (s: string) => w.some(x => s.toLowerCase().includes(x));
  return has(i.name) ? 'name' : has(i.description) ? 'description' : 'code';
}
