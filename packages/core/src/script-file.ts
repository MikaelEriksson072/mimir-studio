/* =====================================================================
 * A script as a file (spec 10.3): the library of scripts is a folder (Scripts, in the library's folder), a file a
 * script, so that scripts can be shared, kept under version control and written with any editor.
 *
 * The file is the script's code, as it is: `decrypt.asm` for a script in assembler, `decrypt.js` for one in JavaScript;
 * the file's name is the script's. What a script is besides its code (its assembler, its scratchpads, what its runs
 * start with, safe mode, its table of values, the names of the program it needs) is one line at the top, a comment
 * to the assembler and to JavaScript:
 *
 *     // mimir-script {"lang":"kickass","pads":[{"name":"result","start":49152,"size":1024}]}
 *
 * (`; mimir-script …` in 64tass). A file without the line is a script too: its code alone, in Kick Assembler or, by
 * its extension, in JavaScript. What the line holds is read with care, as anything from outside is: what is not as it
 * should be is left out.
 * ===================================================================== */
import type { ScriptInit, ScriptLang, ScriptPad, ScriptPadSource, ScriptWatchEntry, ScriptZpInit, UserScript } from './types';
import { b64dec, b64enc } from './project';
import { tidyInit } from './script';

/** A script as the library keeps it: a UserScript without its id, its links and what its scratchpads held. `needs`:
 *  the names of the program its code uses that the user gave (a routine's): where a program has them all, the script
 *  fits it. */
export interface StoredScript extends Pick<UserScript, 'name' | 'lang' | 'code' | 'source' | 'safe' | 'init' | 'watch' | 'unwatch' | 'machine' | 'stopAt' | 'table' | 'when'> {
  pads: Omit<ScriptPad, 'bytes'>[];
  needs?: string[];
}

/** the library's folder of scripts, in the library's folder */
export const SCRIPT_FOLDER = 'Scripts';
/** the most a script's file may be */
export const SCRIPT_FILE_MAX = 2 * 1024 * 1024;

/** whether `file` is a plain name of a script's file: no folder in it, .asm or .js, not hidden */
export const isScriptFileName = (file: string): boolean => /^[^\\/:*?"<>|\u0000-\u001f]{1,120}\.(asm|js)$/i.test(file) && !/^[.\-\s]/.test(file) && !file.includes('..');

/** The name of a script's file: its name with what a file name cannot hold made _, and .js or .asm. */
export function scriptFileName(s: Pick<StoredScript, 'name' | 'code'>): string {
  const stem = s.name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').replace(/\.+$/, '').replace(/^[.\-\s]+/, '').slice(0, 100) || 'script';
  return `${stem}.${s.code === 'js' ? 'js' : 'asm'}`;
}

const HEAD = /^(?:\/\/|;)\s*mimir-script\s+(\{.*\})\s*$/;

/** A script as its file's text: the line that says what it is besides its code, then the code. */
export function scriptFileText(s: StoredScript): string {
  const meta = {
    lang: s.lang,
    ...(s.pads.length ? { pads: s.pads.map(({ data, ...p }) => ({ ...p, ...(data?.length ? { data: b64enc(data) } : {}) })) } : {}),
    ...(s.safe ? { safe: true } : {}), ...(s.init ? { init: s.init } : {}), ...(s.machine ? { machine: s.machine } : {}), ...(s.stopAt ? { stopAt: s.stopAt } : {}),
    ...(s.watch?.length ? { watch: s.watch } : {}), ...(s.unwatch?.length ? { unwatch: s.unwatch } : {}), ...(s.table ? { table: s.table } : {}), ...(s.needs?.length ? { needs: s.needs } : {}), ...(s.when ? { when: s.when } : {}),
  };
  const c = s.code !== 'js' && s.lang === '64tass' ? ';' : '//';
  return `${c} mimir-script ${JSON.stringify(meta)}\n${s.source.replace(/\r\n/g, '\n')}`;
}

const isByte = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 0xff;
const isAddr = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 0xffff;
const readInit = (v: unknown): ScriptInit | null => {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>, zp = Array.isArray(o.zp) ? o.zp : [];
  return tidyInit({
    ...(isByte(o.a) ? { a: o.a } : {}), ...(isByte(o.x) ? { x: o.x } : {}), ...(isByte(o.y) ? { y: o.y } : {}), ...(isByte(o.p) ? { p: o.p } : {}),
    zp: zp.filter((z): z is ScriptZpInit => !!z && isByte(z.at) && Number.isInteger(z.value) && z.value >= 0 && (z.word === true ? z.at <= 0xfe && z.value <= 0xffff : isByte(z.value))),
  });
};
const readSrc = (v: unknown): ScriptPadSource | null => {
  const o = v as Partial<ScriptPadSource> | null;
  return o && (o.form === 'asm' || o.form === 'hex' || o.form === 'text') && typeof o.text === 'string' ? { form: o.form, text: o.text, ...(o.screen === true ? { screen: true } : {}) } : null;
};
const readData = (v: unknown): Uint8Array | null => { try { const d = typeof v === 'string' && v ? b64dec(v) : null; return d && d.length <= 0x10000 ? d : null; } catch { return null; } };
const readPads = (v: unknown): StoredScript['pads'] => (Array.isArray(v) ? v : []).flatMap((p: Record<string, unknown> | null) => {
  if (!p || typeof p.name !== 'string' || !/^[A-Za-z_]\w{0,63}$/.test(p.name) || !isAddr(p.start) || !Number.isInteger(p.size) || (p.size as number) < 1 || p.start + (p.size as number) > 0x10000) return [];
  const d = readData(p.data), src = readSrc(p.src);
  return [{ name: p.name, start: p.start, size: p.size as number, ...(isByte(p.fill) && p.fill ? { fill: p.fill } : {}), ...(d ? { data: d } : {}), ...(src ? { src } : {}),
    ...(p.role === 'file' ? { role: 'file' as const } : p.role === 'result' ? { role: 'result' as const } : {}), ...(isAddr(p.load) ? { load: p.load } : {}) }];
}).slice(0, 64);
const readWatch = (v: unknown): ScriptWatchEntry[] => (Array.isArray(v) ? v : [])
  .filter((w): w is ScriptWatchEntry => !!w && typeof w.expr === 'string' && w.expr.length > 0 && w.expr.length <= 200 && (w.size == null || (Number.isInteger(w.size) && w.size >= 1 && w.size <= 256)))
  .map(w => ({ expr: w.expr, ...(w.size && w.size > 1 ? { size: w.size } : {}), ...(w.ptr === true ? { ptr: true } : {}) })).slice(0, 256);
const strings = (v: unknown, max: number): string[] => (Array.isArray(v) ? v : []).filter((k): k is string => typeof k === 'string' && k.length > 0 && k.length <= max).slice(0, 256);

/**
 * A script read from its file: its name from the file's name, its code the text after the line that says the rest
 * (when it has one). null: not a script's file (its name, or too long).
 */
export function readScriptFile(file: string, text: string): StoredScript | null {
  if (!isScriptFileName(file) || text.length > SCRIPT_FILE_MAX) return null;
  const js = /\.js$/i.test(file), name = file.replace(/\.(asm|js)$/i, '');
  const nl = text.indexOf('\n'), first = (nl < 0 ? text : text.slice(0, nl)).replace(/\r$/, ''), m = HEAD.exec(first);
  let o: Record<string, unknown> = {};
  if (m) { try { const j: unknown = JSON.parse(m[1]); if (j && typeof j === 'object') o = j as Record<string, unknown>; } catch { /* a line that is no JSON: the code alone counts */ } }
  const source = (m ? (nl < 0 ? '' : text.slice(nl + 1)) : text).replace(/\r\n/g, '\n');
  const lang: ScriptLang = o.lang === '64tass' ? '64tass' : 'kickass';
  const init = readInit(o.init), watch = readWatch(o.watch), unwatch = strings(o.unwatch, 300), needs = strings(o.needs, 64).filter(n => /^[A-Za-z_][\w.]*$/.test(n)), pads = readPads(o.pads);
  return {
    name, lang, ...(js ? { code: 'js' as const } : {}), source, pads,
    ...(o.safe === true ? { safe: true } : {}), ...(init ? { init } : {}), ...(o.machine === 'c64' && !js ? { machine: 'c64' as const } : {}),
    ...(typeof o.stopAt === 'string' && o.stopAt.trim() && o.stopAt.length <= 200 ? { stopAt: o.stopAt } : {}),
    ...(watch.length ? { watch } : {}), ...(unwatch.length ? { unwatch } : {}), ...(typeof o.table === 'string' && o.table.length <= 65536 && o.table ? { table: o.table } : {}),
    ...(needs.length ? { needs } : {}), ...(o.when === 'load' ? { when: 'load' as const } : o.when === 'build' ? { when: 'build' as const } : {}),
  };
}

/**
 * Whether a script of the library fits a program: it needs names (those its code used that the user had given in the
 * project it was saved from), and the program has every one of them, as a label (`has`) or as a routine known from
 * another project that has no name here yet (`known`: adding the script names it). `naming`: the known ones it would
 * name.
 */
export function scriptFits(s: Pick<StoredScript, 'needs'>, has: (name: string) => boolean, known: (name: string) => boolean): { fits: boolean; naming: string[] } {
  const needs = s.needs ?? [], naming = needs.filter(n => !has(n) && known(n));
  return { fits: needs.length > 0 && needs.every(n => has(n) || known(n)), naming };
}
