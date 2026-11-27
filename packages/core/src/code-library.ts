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
 * `.sfunction`). Code taken from a source becomes a macro wrapped in one (codeLibWrap). A file with several macros is a
 * collection (irq_lib.asm): each of its macros listed as one of its own, described by the comments above it.
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
  /** a collection of macros (a file of the macro library with macros of their own in it), one macro or none in it yet */
  collection?: boolean;
}
/** a macro or a piece of code of the library: its kind (its folder), its file there and its name (the file's
 *  without the extension), its code, when its file changed; `own`: a file without the line (put there by hand);
 *  a collection (a file of the macro library with several macros, or one said to be one) has its macros */
export interface CodeLibItem extends CodeLibMeta {
  kind: CodeLibKind;
  file: string;
  name: string;
  code: string;
  changed: number;
  own?: boolean;
  macros?: CodeLibSub[];
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
    ...(meta.collection ? { collection: true } : {}),
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
  let description = typeof o.description === 'string' ? o.description.slice(0, CODE_LIB_DESCRIPTION_MAX) : '';
  const from = typeof o.from === 'string' && o.from.length <= 500 ? o.from : undefined;
  // a macro's file: several macros (or one said to be a collection) a collection of them, each with what its own
  // lines say; one macro with no description of its own described by the comments above it
  const subs = kind === 'macro' ? codeLibSubs(code, lang) : [];
  const collection = kind === 'macro' && (o.collection === true || subs.length > 1);
  if (!description && subs.length === 1 && !collection) description = subs[0].description;
  return {
    kind, file, name: codeLibNameOf(file), code, lang, description, created, changed: times.changed, ...(color ? { color } : {}), ...(from ? { from } : {}), ...(m ? {} : { own: true }),
    ...(collection ? { collection: true, macros: subs } : {}),
  };
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

/* ---------------------------------------------------------------------
 * Collections: a file of the macro library with several macros in it (irq_lib.asm, a library a source imports), each
 * macro one of its own in the lists. What a macro is besides its code is in its own lines above it: the comments right
 * above its definition are its description (the lines that only decorate them, // ======, left out), and a line
 *
 *     // mimir-macro {"created":"2026-11-27T09:12:00.000Z","color":"teal"}
 *
 * says its colour and when it was made (none: the collection's). The rest of the file (#importonce, .var, code between
 * the macros) stays as it is.
 * --------------------------------------------------------------------- */

/** a macro of a collection: its definition (`line` to `end`, from 1, in the collection's code; `top` the first of its
 *  own lines above it), the definition alone (`code`), its description, and its own colour and time (if any); `decor`:
 *  the lines that decorate its comments (above and under them), as they are */
export interface CodeLibSub {
  name: string;
  params: string[];
  how: CodeLibMacro['how'];
  top: number;
  line: number;
  end: number;
  code: string;
  description: string;
  color?: string;
  created?: number;
  decor?: { top?: string; bottom?: string };
}

const SUB_HEAD = /^\s*(?:\/\/|;)\s*mimir-macro\s+(\{.*\})\s*$/;
/** a line's comment when the line is only a comment (its text after // or ;), else null */
const commentOnly = (line: string, tass: boolean): string | null => { const m = (tass ? /^\s*;+ ?(.*)$/ : /^\s*\/\/+ ?(.*)$/).exec(line); return m ? m[1].trimEnd() : null; };
/** a comment's text that only decorates (=====, -----, *****): three or more, no letter or digit */
const isDecor = (text: string): boolean => text.trim().length >= 3 && !/[\p{L}\p{N}]/u.test(text);

/** What a mimir-macro line says (its JSON read with care: what is not as it should be left out). */
function subMeta(line: string): { color?: string; created?: number; description?: string } {
  const m = SUB_HEAD.exec(line);
  if (!m) return {};
  try {
    const j: unknown = JSON.parse(m[1]);
    if (!j || typeof j !== 'object' || Array.isArray(j)) return {};
    const o = j as Record<string, unknown>;
    const made = typeof o.created === 'string' ? Date.parse(o.created) : typeof o.created === 'number' ? o.created : NaN;
    return {
      ...(typeof o.color === 'string' && isBookmarkColor(o.color) ? { color: o.color.toLowerCase() } : {}),
      ...(Number.isFinite(made) && made > 0 ? { created: made } : {}),
      ...(typeof o.description === 'string' ? { description: o.description.slice(0, CODE_LIB_DESCRIPTION_MAX) } : {}),
    };
  } catch { return {}; }
}

/** The macros of a piece of code as a collection's, in the order they are written, each with its own lines above it. */
export function codeLibSubs(code: string, lang: ScriptLang): CodeLibSub[] {
  const tass = langIs(lang) === '64tass', lines = code.split('\n').map(l => l.replace(/\r$/, ''));
  const at = (n: number) => lines[n - 1] ?? '';
  let prevEnd = 0;
  return codeLibMacros(code, lang).map(d => {
    let top = d.line, meta: ReturnType<typeof subMeta> = {};
    const texts: string[] = [];
    // its comments and its mimir-macro line, right above it (not the macro's above it)
    while (top - 1 > prevEnd) {
      const l = at(top - 1);
      if (HEAD.test(l)) break;
      if (SUB_HEAD.test(l)) { meta = { ...subMeta(l), ...meta }; top--; continue; }
      const c = commentOnly(l, tass);
      if (c == null) break;
      texts.unshift(c);
      top--;
    }
    // the lines that decorate them, the first and the last
    const decor: CodeLibSub['decor'] = {};
    if (texts.length && isDecor(texts[0])) decor.top = at(top + (SUB_HEAD.test(at(top)) ? 1 : 0));
    if (texts.length > 1 && isDecor(texts[texts.length - 1])) { for (let n = d.line - 1; n >= top; n--) { const l = at(n); if (!SUB_HEAD.test(l)) { decor.bottom = l; break; } } }
    const words = texts.filter(t => !isDecor(t));
    while (words.length && !words[0].trim()) words.shift();
    while (words.length && !words[words.length - 1].trim()) words.pop();
    const description = words.length ? words.join('\n') : meta.description ?? '';
    prevEnd = d.end;
    return {
      name: d.name, params: d.params, how: d.how, top, line: d.line, end: d.end, code: lines.slice(d.line - 1, d.end).join('\n'), description,
      ...(meta.color ? { color: meta.color } : {}), ...(meta.created ? { created: meta.created } : {}), ...(decor.top || decor.bottom ? { decor } : {}),
    };
  });
}

/** the lines that decorate a collection's descriptions, as most of its macros have them (none: no such lines) */
export function codeLibDecor(subs: readonly Pick<CodeLibSub, 'decor'>[]): CodeLibSub['decor'] | undefined {
  const n = new Map<string, { d: NonNullable<CodeLibSub['decor']>; n: number }>();
  for (const s of subs) if (s.decor?.top || s.decor?.bottom) { const k = `${s.decor.top ?? ''}\n${s.decor.bottom ?? ''}`; const e = n.get(k); if (e) e.n++; else n.set(k, { d: s.decor, n: 1 }); }
  return [...n.values()].sort((a, b) => b.n - a.n)[0]?.d;
}

/**
 * A macro's lines in a collection: its description as comments (between `decor`'s lines, when it has them), its
 * mimir-macro line when it has a colour or a time of its own, its definition.
 */
export function codeLibSubText(sub: { code: string; description: string; color?: string; created?: number }, lang: ScriptLang, decor?: CodeLibSub['decor']): string {
  const c = langIs(lang) === '64tass' ? ';' : '//';
  const out: string[] = [];
  const desc = sub.description.replace(/\r\n/g, '\n').split('\n').map(l => l.trimEnd());
  while (desc.length && !desc[0].trim()) desc.shift();
  while (desc.length && !desc[desc.length - 1].trim()) desc.pop();
  if (desc.length) {
    if (decor?.top) out.push(decor.top);
    out.push(...desc.map(l => (l ? `${c} ${l}` : c)));
    if (decor?.bottom) out.push(decor.bottom);
  }
  const j = {
    ...(sub.created ? { created: new Date(sub.created).toISOString() } : {}),
    ...(sub.color && isBookmarkColor(sub.color) ? { color: sub.color.toLowerCase() } : {}),
  };
  if (Object.keys(j).length) out.push(`${c} mimir-macro ${JSON.stringify(j)}`);
  out.push(sub.code.replace(/\r\n/g, '\n').replace(/\s+$/, ''));
  return out.join('\n');
}

/** a collection's code with a macro's lines (codeLibSubText) put in: in the place of the macro named `replace`, else
 *  at its end after an empty line */
export function codeLibPutSub(code: string, lang: ScriptLang, text: string, replace?: string): string {
  const body = code.replace(/\r\n/g, '\n');
  const s = replace ? codeLibSubs(body, lang).find(x => x.name === replace) : undefined;
  if (s) { const lines = body.split('\n'); return [...lines.slice(0, s.top - 1), ...text.split('\n'), ...lines.slice(s.end)].join('\n'); }
  const head = body.replace(/\s+$/, '');
  return head ? `${head}\n\n${text}` : text;
}

/** a collection's code without the macro named `name` and its own lines (the empty lines around it as one run) */
export function codeLibTakeOutSub(code: string, lang: ScriptLang, name: string): string {
  const body = code.replace(/\r\n/g, '\n');
  const s = codeLibSubs(body, lang).find(x => x.name === name);
  if (!s) return body;
  const lines = body.split('\n'), before = lines.slice(0, s.top - 1), after = lines.slice(s.end);
  if (!before.length || !before[before.length - 1].trim()) while (after.length && !after[0].trim()) after.shift();
  while (!after.length && before.length && !before[before.length - 1].trim()) before.pop();
  return [...before, ...after].join('\n');
}

/** a piece of code with the name of its first macro named `from` changed to `to` (its definition only) */
export function codeLibRenameMacro(code: string, lang: ScriptLang, from: string, to: string): string {
  const d = codeLibMacros(code, lang).find(x => x.name === from);
  if (!d || !to || from === to) return code;
  const lines = code.split('\n'), i = d.line - 1;
  lines[i] = langIs(lang) === '64tass'
    ? lines[i].replace(/^(\s*)([A-Za-z_]\w*)/, (_m, sp: string) => `${sp}${to}`)
    : lines[i].replace(/(\.(?:macro|pseudocommand|function)\s+@?)([A-Za-z_]\w*)/, (_m, h: string) => `${h}${to}`);
  return lines.join('\n');
}

/**
 * The other macros of a collection the macro named `name` uses, and those they use, in the order the collection has
 * them: its definition put in a source alone would not assemble without them (DoubleIRQ_Entry calls irq_save()).
 */
export function codeLibNeeds(subs: readonly Pick<CodeLibSub, 'name' | 'code'>[], name: string, lang: ScriptLang): string[] {
  const tass = langIs(lang) === '64tass';
  const names = new Set(subs.map(s => s.name));
  const uses = (s: Pick<CodeLibSub, 'name' | 'code'>): string[] => {
    const block = { in: false };
    // (its definition's line without its own name)
    const text = s.code.split('\n').map((l, i) => { const t = bare(l.replace(/\r$/, ''), tass, block); return i === 0 ? t.replace(new RegExp(`\\b${s.name}\\b`), '') : t; }).join('\n');
    return [...names].filter(n => n !== s.name && new RegExp(tass ? `(?:[#.]${n}\\b|(?<![\\w.#])${n}\\s*\\()` : `(?<![\\w.!#$@])${n}\\b(?!\\s*:)`).test(text));
  };
  const by = new Map(subs.map(s => [s.name, s]));
  const seen = new Set<string>([name]), todo = [name];
  while (todo.length) { const s = by.get(todo.pop()!); if (!s) continue; for (const u of uses(s)) if (!seen.has(u)) { seen.add(u); todo.push(u); } }
  seen.delete(name);
  return subs.map(s => s.name).filter(n => seen.has(n));
}

/** a collection's code without Mimir's own lines (each macro's mimir-macro line): as a file to give away */
export const codeLibPlain = (code: string): string => code.replace(/\r\n/g, '\n').split('\n').filter(l => !SUB_HEAD.test(l)).join('\n');

/** what the lists show of a library: an item, or one of a collection's macros as one of its own (`macro` its name,
 *  `in` the collection's name; its code its definition alone, its colour and when it was made its own, else the
 *  collection's) */
export interface CodeLibEntry extends CodeLibItem { macro?: string; in?: string }
/** a collection's macros as entries of the lists */
export function codeLibSubItems(c: CodeLibItem): CodeLibEntry[] {
  return (c.macros ?? []).map(s => {
    const color = s.color ?? c.color;
    return {
      kind: c.kind, file: c.file, name: s.name, code: s.code, lang: c.lang, description: s.description, created: s.created ?? c.created, changed: c.changed,
      ...(color ? { color } : {}), ...(c.from ? { from: c.from } : {}), macro: s.name, in: c.name,
    };
  });
}

/**
 * Macros as one file to export, as a collection's: each with its description as comments above it and its definition,
 * an empty line between them; `meta`: with Mimir's lines (the line at the top, each macro's colour and time), so the
 * file can be put back in a library as it was.
 */
export function codeLibExportText(subs: readonly { code: string; description: string; color?: string; created?: number; decor?: CodeLibSub['decor'] }[], lang: ScriptLang, meta?: CodeLibMeta): string {
  const body = subs.map(s => codeLibSubText(meta ? s : { code: s.code, description: s.description }, lang, s.decor)).join('\n\n');
  return meta ? codeLibFileText({ ...meta, collection: true }, body) : `${body}\n`;
}

/* ---------------------------------------------------------------------
 * The project's macro file (AsmMacroFile): one file in an Assembler project that Mimir builds from the macro library as
 * the code changes, which the main source imports once in place of the library's files. In it: the macros added to it,
 * those the code calls and does not define itself, and the macros those use; a collection's own lines (#importonce
 * aside: .const, .var …) with its macros, as they need them.
 * --------------------------------------------------------------------- */

/** The names of `names` that the sources call: Kick Assembler's `Name(…)` (a macro or a function) or a pseudo command
 *  starting a statement, 64tass's `#Name`/`.Name` or `Name(…)`; comments and strings left out. */
export function codeLibCalled(sources: readonly string[], names: Iterable<string>, lang: ScriptLang): string[] {
  const tass = langIs(lang) === '64tass';
  const text = sources.map(s => { const block = { in: false }; return s.split('\n').map(l => bare(l.replace(/\r$/, ''), tass, block)).join('\n'); }).join('\n');
  const out: string[] = [];
  for (const n of names) {
    if (!/^[A-Za-z_]\w*$/.test(n)) continue;
    const re = tass ? new RegExp(`(?:[#.]${n}\\b|(?<![\\w.#])${n}\\s*\\()`) : new RegExp(`(?:(?<![\\w.!$@])${n}\\s*\\(|(?:^|[;{}]|\\w:)[ \\t]*${n}(?=[ \\t]|$))`, 'm');
    if (re.test(text)) out.push(n);
  }
  return out;
}

/** a collection's own lines: what is not its macros or their lines above them (.const, .var, labels …), the empty runs
 *  at the ends left out; `#importonce` and Mimir's lines too */
export function codeLibRest(code: string, lang: ScriptLang): string {
  const subs = codeLibSubs(code, lang), lines = code.replace(/\r\n/g, '\n').split('\n');
  const keep = lines.filter((l, i) => !subs.some(s => i + 1 >= s.top && i + 1 <= s.end) && !/^\s*#importonce\b/.test(l) && !SUB_HEAD.test(l) && !HEAD.test(l));
  return keep.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** a macro of a project's macro file as the editor shows it: its name, its collection (`in`), why it is there (added,
 *  called by the code, or used by another of them), its call as the list shows it (`sig`), its description and its
 *  definition */
export interface CodeLibBuiltMacro { name: string; in: string | null; why: 'added' | 'called' | 'used'; sig: string; description: string; code: string }
/** what a project's macro file was built of: its text, each macro, the groups it has (a collection's, with its own lines,
 *  or the macros of their own: `in` null) in its order, the names added that the library has not, and those the project
 *  defines itself (left out: they would be defined twice) */
export interface CodeLibBuilt {
  text: string;
  macros: CodeLibBuiltMacro[];
  groups: { in: string | null; rest: string; macros: string[] }[];
  missing: string[];
  own: string[];
}

/**
 * The project's macro file built from the macro library (`items`, the library's; those of the project's assembler
 * only): the macros `want` adds and the collections it adds whole, those `sources` (the project's own sources, the
 * file itself not among them) call unless `want.called` is false, and the macros they use; none the sources define. In
 * the library's order, a collection's together in its order under a line with its name (its own lines first), each
 * with its description as comments above it. `file`: its name, for the lines at its top.
 */
export function codeLibProjectFile(items: readonly CodeLibItem[], want: { macros: readonly string[]; collections: readonly string[]; called?: boolean }, sources: readonly string[], lang: ScriptLang, file: string): CodeLibBuilt {
  const tass = langIs(lang) === '64tass';
  // the library's macros by name (the first of a name in the library's order)
  type Entry = { name: string; params: string[]; how: CodeLibMacro['how']; code: string; description: string; decor?: CodeLibSub['decor']; coll: CodeLibItem | null; order: number };
  const all: Entry[] = [], byName = new Map<string, Entry>();
  for (const i of codeLibOrder(items.filter(x => x.kind === 'macro' && langIs(x.lang) === langIs(lang)))) {
    const subs = i.collection ? i.macros ?? codeLibSubs(i.code, i.lang) : codeLibIsMacro(i.code, i.lang) ? codeLibSubs(i.code, i.lang).slice(0, 1) : [];
    for (const s of subs) {
      const e: Entry = { name: s.name, params: s.params, how: s.how, code: s.code, description: i.collection ? s.description : i.description || s.description, ...(s.decor ? { decor: s.decor } : {}), coll: i.collection ? i : null, order: all.length };
      all.push(e);
      if (!byName.has(s.name)) byName.set(s.name, e);
    }
  }
  const own = new Set<string>();
  for (const s of sources) for (const d of codeLibMacros(s, lang)) own.add(d.name);
  const why = new Map<string, CodeLibBuilt['macros'][number]['why']>();
  const missing: string[] = [], skipped = new Set<string>();
  const take = (n: string, w: 'added' | 'called' | 'used') => {
    if (why.has(n)) return;
    if (own.has(n)) { skipped.add(n); return; }
    if (!byName.has(n)) { if (w === 'added') missing.push(n); return; }
    why.set(n, w);
  };
  for (const n of want.macros) take(n, 'added');
  for (const c of want.collections) {
    const coll = items.find(i => i.kind === 'macro' && i.collection && i.name.toLowerCase() === c.toLowerCase());
    if (!coll) { missing.push(c); continue; }
    for (const s of coll.macros ?? []) if (byName.get(s.name)?.coll === coll) take(s.name, 'added');
  }
  if (want.called !== false) for (const n of codeLibCalled(sources, [...byName.keys()].filter(n => !own.has(n)), lang)) take(n, 'called');
  // and the macros those use, and those they use
  const lib = [...byName.values()];
  for (const n of [...why.keys()]) for (const u of codeLibNeeds(lib, n, lang)) take(u, 'used');

  const chosen = lib.filter(e => why.has(e.name)).sort((a, b) => a.order - b.order);
  const c = tass ? ';' : '//';
  const out: string[] = [
    `${c} ${file}: built by Mimir from the macro library (Macros and code) as this project's code calls its macros and as`,
    `${c} macros are added to it, with the macros they use. Mimir writes it again as they change: change them in the library.`,
    ...(tass ? [] : ['#importonce']),
  ];
  let group: CodeLibItem | null | undefined;
  const groups: CodeLibBuilt['groups'] = [];
  for (const e of chosen) {
    if (e.coll !== group || !groups.length) {
      group = e.coll;
      out.push('', `${c} ---- ${group ? group.name : 'macros of their own'} ----`);
      const rest = group ? codeLibRest(group.code, lang) : '';
      if (rest) out.push(rest);
      groups.push({ in: group ? group.name : null, rest, macros: [] });
    }
    groups[groups.length - 1].macros.push(e.name);
    out.push('', codeLibSubText({ code: e.code, description: e.description }, lang, e.decor));
  }
  return {
    text: `${out.join('\n')}\n`,
    macros: chosen.map(e => ({ name: e.name, in: e.coll ? e.coll.name : null, why: why.get(e.name)!, sig: codeLibSignature(e, lang), description: e.description, code: e.code })),
    groups, missing, own: [...skipped],
  };
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
