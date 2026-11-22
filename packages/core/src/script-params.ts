/* =====================================================================
 * A script's settings (spec 10.3): the values at the top of its code that a run is about (where the bytes are, how
 * many, the key), read out of the code so that they can be shown as fields, and set for a run without the code being
 * edited by hand; and a table of such values, a row a run, for a script run many times (a key a level, an address a
 * file).
 *
 * A setting is a line of the code that gives a name one value and nothing more:
 *     Kick Assembler   .var key     = $77        // the key byte
 *     64tass           key     = $77             ; the key byte
 *     JavaScript       const key = 0x77;         // the key byte      (at the left edge)
 * The value is one word: a number ($77, 0x77, %1010, 119), a name (result, tbl_001, SUB, true) or a string. A line
 * whose value is worked out (`dest + length`, `step1 == ADD ? …`) is no setting. The comment on the line says what
 * the setting is.
 * ===================================================================== */
import type { ScriptLang, UserScript } from './types';
import { langIs } from './code-lang';
import type { ScriptFileResult } from './script-files';
import type { ScriptRun } from './script';

/** a setting of a script: its name, its value as the code writes it, the line it is on and the comment there */
export interface ScriptParam { name: string; value: string; line: number; comment: string }

type How = Partial<Pick<UserScript, 'lang' | 'code'>>;

/** one word a setting's value can be: a string, or a number or a name */
const VALUE = String.raw`"[^"\n]*"|'[^'\n]*'|-?[$%]?[A-Za-z0-9_][\w.]*`;
/** a setting's line in each language: what is before the name, the name, what is between, the value, the gap after
 *  it and the comment (with what starts it) */
const LINE: Record<'kickass' | '64tass' | 'js', RegExp> = {
  kickass: new RegExp(String.raw`^(\s*\.var\s+)([A-Za-z_]\w*)(\s*=\s*)(${VALUE})([ \t]*)(//.*)?$`),
  '64tass': new RegExp(String.raw`^()([A-Za-z_]\w*)(\s*:?=\s*)(${VALUE})([ \t]*)(;.*)?$`),
  js: new RegExp(String.raw`^((?:const|let|var)\s+)([A-Za-z_$][\w$]*)(\s*=\s*)(${VALUE})([ \t]*;?[ \t]*)(//.*)?$`),
};
const kindOf = (how: How): keyof typeof LINE => (how.code === 'js' ? 'js' : langIs(how.lang as ScriptLang | undefined));

/** The script's settings, in the order the code has them (a name set twice counts once: its first line). */
export function scriptParams(source: string, how: How = {}): ScriptParam[] {
  const re = LINE[kindOf(how)], out: ScriptParam[] = [];
  source.split('\n').forEach((raw, i) => {
    const m = re.exec(raw.replace(/\r$/, ''));
    if (!m || out.some(p => p.name === m[2])) return;
    out.push({ name: m[2], value: m[4], line: i + 1, comment: (m[6] ?? '').replace(/^(\/\/|;)\s*/, '').trim() });
  });
  return out;
}

/** whether `value` can be a setting's value: one word (a number, a name or a string) */
export const paramValueOk = (value: string): boolean => new RegExp(`^(?:${VALUE})$`).test(value.trim());

/**
 * The code with the settings in `values` set (each on its line; the comment after a value stays in its column where
 * the new value leaves room). A name that is no setting, or a value that is not one word, is left as it is and named
 * in `skipped`.
 */
export function setScriptParams(source: string, how: How, values: Readonly<Record<string, string>>): { source: string; skipped: string[] } {
  const re = LINE[kindOf(how)], left = new Set(Object.keys(values));
  const lines = source.split('\n').map(raw => {
    const cr = raw.endsWith('\r') ? '\r' : '', m = re.exec(cr ? raw.slice(0, -1) : raw);
    if (!m || !left.has(m[2])) return raw;
    const v = values[m[2]].trim();
    if (!paramValueOk(v)) return raw;
    left.delete(m[2]);
    // (JavaScript: the ; after the value stays right after it)
    const body = `${v}${m[5].includes(';') ? ';' : ''}`, width = m[4].length + m[5].length;
    const tail = m[6] ? (body.length < width ? body.padEnd(width) : `${body} `) : body;
    return `${m[1]}${m[2]}${m[3]}${tail}${m[6] ?? ''}${cr}`;
  });
  return { source: lines.join('\n'), skipped: [...left] };
}

/** A table of values as text read: the settings its columns are, and its rows. */
export interface ParamTable { names: string[]; rows: Record<string, string>[]; problems: { line: number; msg: string }[] }

/**
 * A table of values, as the user writes it: the first line names the settings (the columns), each line after it is a
 * run, its values in that order; values are parted by commas, tabs or semicolons (a table pasted from a spreadsheet
 * reads as it is). Empty lines and lines that start with # are skipped. What is wrong is said by its line: a column
 * that is no setting of the script, a row with too few or too many values, a value that is not one word.
 */
export function parseParamTable(text: string, params: readonly Pick<ScriptParam, 'name'>[]): ParamTable {
  const out: ParamTable = { names: [], rows: [], problems: [] };
  const cells = (l: string) => l.split(/\t|[,;]/).map(c => c.trim());
  let head = false;
  text.split('\n').forEach((raw, i) => {
    const l = raw.replace(/\r$/, '').trim();
    if (!l || l.startsWith('#')) return;
    if (!head) {
      head = true;
      out.names = cells(l);
      for (const n of out.names) {
        if (!params.some(p => p.name === n)) out.problems.push({ line: i + 1, msg: `"${n}" is no setting of the script${params.length ? ` (it has ${params.map(p => p.name).join(', ')})` : ''}` });
        else if (out.names.indexOf(n) !== out.names.lastIndexOf(n) && !out.problems.some(p => p.msg.startsWith(`"${n}" is there twice`))) out.problems.push({ line: i + 1, msg: `"${n}" is there twice` });
      }
      return;
    }
    const c = cells(l);
    if (c.length !== out.names.length) { out.problems.push({ line: i + 1, msg: `${c.length} value${c.length === 1 ? '' : 's'}, but the first line names ${out.names.length} setting${out.names.length === 1 ? '' : 's'}` }); return; }
    const bad = c.find(v => !paramValueOk(v));
    if (bad != null) { out.problems.push({ line: i + 1, msg: `"${bad}" is not a value: one number, name or string` }); return; }
    out.rows.push(Object.fromEntries(out.names.map((n, k) => [n, c[k]])));
  });
  if (!head) out.problems.push({ line: 1, msg: 'the first line names the settings, the lines after it are the runs' });
  return out;
}

/** The table a script starts with: its settings as the columns, and one row with the values the code has now. */
export const startParamTable = (params: readonly ScriptParam[]): string =>
  `${params.map(p => p.name).join(', ')}\n${params.map(p => p.value).join(', ')}\n`;

/**
 * What a run with a row of values gave, as files (as a run on a file does, script-files.ts): each scratchpad marked
 * as a result that the run wrote, from its start to after the last byte written, at the scratchpad's address; with none
 * of those, each other scratchpad the run wrote, cut the same way; else the longest stretch of memory the run wrote. Named
 * `base`, and with several the scratchpad too.
 */
export function runResults(pads: readonly { name: string; start: number; role?: 'file' | 'result' }[], run: ScriptRun, base: string): ScriptFileResult[] {
  const left = (name: string) => run.pads.find(p => p.name === name);
  const named = (rs: ScriptFileResult[]) => rs.map(r => ({ ...r, name: `${base}${rs.length > 1 ? `_${r.pad}` : ''}.prg` }));
  const results = pads.filter(p => p.role === 'result').flatMap((p): ScriptFileResult[] => { const r = left(p.name); return r?.wrote ? [{ name: '', load: p.start, bytes: r.bytes.slice(0, r.wrote[1]), from: 'result', pad: p.name }] : []; });
  if (results.length) return named(results);
  const written = pads.filter(p => p.role !== 'result').flatMap((p): ScriptFileResult[] => { const r = left(p.name); return r?.wrote ? [{ name: '', load: p.start, bytes: r.bytes.slice(0, r.wrote[1]), from: 'result', pad: p.name }] : []; });
  if (written.length) return named(written);
  const longest = [...(run.wrote ?? [])].sort((a, b) => (b.end - b.start) - (a.end - a.start) || a.start - b.start)[0];
  return longest ? [{ name: `${base}.prg`, load: longest.start, bytes: run.mem.slice(longest.start, longest.end), from: 'memory' }] : [];
}
