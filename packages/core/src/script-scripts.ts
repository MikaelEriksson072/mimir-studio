/* =====================================================================
 * The scripts for a JavaScript script (spec 10.3), as `scripts`: the project's scripts, the library's and the
 * templates, read; another script's code used as a library; and scripts made, changed and run.
 *
 *   scripts.all, scripts.self, scripts.find(name), scripts.names
 *                               the project's scripts: { name, code ("js" or "asm"), lang, source, lines, safe, when,
 *                               key, machine, pads, settings } and what one does: setting(name),
 *                               withSettings(values), call(values)
 *   scripts.library             the scripts of the library folder: { name, code, source, when, settings }
 *   scripts.templates           the templates: { name, title, about, code, source, safe, settings }
 *   scripts.call(name, values)  runs another JavaScript script's code here, in this run: the same mem, the same
 *                               print; with its settings set to `values`. What its code returns is given back, so
 *                               a script that ends with `return { crc, find };` is a library: scripts.use(name)
 *   scripts.add(name, source, { code, safe, when, key })    a new script in the project
 *   scripts.edit(name, { source, settings, safe, when, key, name })   a script of the project changed
 *   scripts.run(name, { settings })   another script run when this run has ended, as Run runs it (after this one's
 *                               export, builds and the rest); with settings, its code as they make it, for that run
 *   scripts.requests            what has been asked for so far, a text each
 *
 * Nothing of the project changes while the script runs: what add, edit and run ask for is done when the run has
 * ended well (not in safe mode), in the order asked, add and edit in the run's undo step.
 * ===================================================================== */
import type { ScriptLang, UserScript } from './types';
import { paramValueOk, scriptParams, setScriptParams } from './script-params';
import { SCRIPT_KEYS } from './script-hooks';
import { SCRIPT_TEMPLATES, type ScriptTemplate } from './script-templates';
import { JS_TEMPLATES } from './script-templates-js';

/** a script as a script is given it */
export interface ScriptInfo extends Pick<UserScript, 'name' | 'lang' | 'code' | 'source' | 'safe' | 'when' | 'key' | 'machine'> { pads?: { name: string; start: number; size: number }[] }
/** the scripts as they are now, for `scripts` */
export interface ScriptScriptsData {
  /** the name of the script that runs */
  self: string;
  scripts: ScriptInfo[];
  /** the library folder's scripts */
  library: Pick<UserScript, 'name' | 'lang' | 'code' | 'source' | 'when'>[];
}

/** what a script asked for with scripts.add, edit and run */
export type ScriptScriptsRequest =
  | { kind: 'add'; name: string; source: string; code?: 'js'; safe?: boolean; when?: UserScript['when']; key?: string }
  | { kind: 'edit'; name: string; source?: string; rename?: string; safe?: boolean; when?: UserScript['when'] | null; key?: string | null }
  | { kind: 'run'; name: string; source?: string };

/** the most a run asks for, and how deep scripts call scripts */
export const SCRIPTS_REQUESTS = 16;
export const SCRIPTS_CALL_DEPTH = 8;
/** how many scripts run one after the other by scripts.run, before the app stops the chain */
export const SCRIPTS_RUN_CHAIN = 8;

const lineCount = (s: string) => s.split('\n').length;
/** a request in a line: what would be (or was) done */
export function scriptsRequestText(r: ScriptScriptsRequest): string {
  if (r.kind === 'add') return `${r.name} added (${r.code === 'js' ? 'JavaScript' : 'assembler'}, ${lineCount(r.source)} line${lineCount(r.source) === 1 ? '' : 's'}${r.safe ? ', safe mode' : ''}${r.when ? `, runs on ${r.when}` : ''}${r.key ? `, ${r.key}` : ''})`;
  if (r.kind === 'run') return `${r.name} run${r.source != null ? ' with settings of its own' : ''}`;
  const what = [r.source != null ? `its code (${lineCount(r.source)} line${lineCount(r.source) === 1 ? '' : 's'})` : null, r.rename ? `its name (${r.rename})` : null,
    r.safe != null ? `safe mode ${r.safe ? 'on' : 'off'}` : null, r.when !== undefined ? (r.when ? `runs on ${r.when}` : 'runs only when asked') : null, r.key !== undefined ? (r.key ? `its key (${r.key})` : 'no key') : null].filter(Boolean);
  return `${r.name} changed: ${what.join(', ') || 'nothing'}`;
}

const NAME = /^[^\\/:*?"<>|\u0000-\u001f]{1,60}$/;
const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** What a run's requests come to in the project (nothing is changed here): the scripts with those added and changed,
 *  the scripts to run after, what is done and what cannot be. */
export interface ScriptsPlan { scripts: UserScript[]; runs: { id: string; name: string; source?: string }[]; done: string[]; failed: string[]; changed: boolean }

export function planScriptsRequests(scripts: readonly UserScript[], requests: readonly ScriptScriptsRequest[], make: { lang: ScriptLang; id: () => string }): ScriptsPlan {
  let list = scripts.slice(), changed = false;
  const runs: ScriptsPlan['runs'] = [], done: string[] = [], failed: string[] = [];
  // (a script renamed by this run is found under the name it had too)
  const renamed = new Map<string, string>();
  const find = (name: string) => list.find(s => sameName(s.name, name)) ?? list.find(s => sameName(s.name, renamed.get(name.toLowerCase()) ?? ''));
  for (const r of requests) {
    if (r.kind === 'add') {
      if (find(r.name)) { failed.push(`${r.name} is in the project already: scripts.edit changes it`); continue; }
      // (one script has a key)
      if (r.key) list = list.map(s => (s.key === r.key ? (({ key: _k, ...rest }) => rest)(s) : s));
      list.push({ id: make.id(), name: r.name, lang: make.lang, ...(r.code ? { code: r.code } : {}), source: r.source, pads: [], ...(r.safe ? { safe: true } : {}), ...(r.when ? { when: r.when } : {}), ...(r.key ? { key: r.key } : {}) });
      changed = true; done.push(scriptsRequestText(r));
    } else if (r.kind === 'edit') {
      const s = find(r.name);
      if (!s) { failed.push(`${r.name} is not a script of the project`); continue; }
      if (r.rename && !sameName(r.rename, s.name) && find(r.rename)) { failed.push(`${r.name} cannot be named ${r.rename}: another script has that name`); continue; }
      if (r.rename) renamed.set(s.name.toLowerCase(), r.rename);
      const next: UserScript = { ...s, ...(r.source != null ? { source: r.source } : {}), ...(r.rename ? { name: r.rename } : {}) };
      if (r.safe != null) { if (r.safe) next.safe = true; else delete next.safe; }
      if (r.when !== undefined) { if (r.when) next.when = r.when; else delete next.when; }
      if (r.key !== undefined) { if (r.key) next.key = r.key; else delete next.key; }
      list = list.map(x => (x === s ? next : r.key && x.key === r.key ? (({ key: _k, ...rest }) => rest)(x) : x));
      changed = true; done.push(scriptsRequestText(r));
    } else {
      const s = find(r.name);
      if (!s) { failed.push(`${r.name} is not a script of the project: it was not run`); continue; }
      runs.push({ id: s.id, name: s.name, ...(r.source != null ? { source: r.source } : {}) });
      done.push(scriptsRequestText(r));
    }
  }
  return { scripts: list, runs, done, failed, changed };
}

/** `scripts` for a script. `run` runs a JavaScript script's code in this run and gives what it returns; `asked` takes
 *  what add, edit and run ask for. */
export function scriptsApi(data: ScriptScriptsData | null, lang: ScriptLang, run: (name: string, source: string) => unknown, asked: (r: ScriptScriptsRequest) => void): Record<string, unknown> {
  const made: ScriptScriptsRequest[] = [];
  let depth = 0;
  const ask = (r: ScriptScriptsRequest) => {
    if (!data) throw new Error('scripts: the project\'s scripts are not given here (a run on files or with values): add, edit and run work in a run of the script itself');
    if (made.length >= SCRIPTS_REQUESTS) throw new RangeError(`scripts: a run asks for ${SCRIPTS_REQUESTS} things at most`);
    made.push(r); asked(r);
  };
  const how = (s: { lang?: ScriptLang; code?: 'js' }) => ({ lang: s.lang ?? lang, code: s.code });
  /** settings as a script gives them (a text, a number, true or false) as the code writes them */
  const values = (v: unknown, what: string): Record<string, string> => {
    if (v == null) return {};
    if (typeof v !== 'object') throw new TypeError(`${what}: the settings are wanted, a setting a key: { key: 0x5a, name: "text" }`);
    const out: Record<string, string> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      const t = typeof x === 'string' ? JSON.stringify(x) : typeof x === 'number' && Number.isFinite(x) ? String(x) : typeof x === 'boolean' ? String(x) : null;
      if (t == null || !paramValueOk(t)) throw new TypeError(`${what}: the setting ${k} takes a text (without "), a number, true or false (not ${typeof x === 'string' ? `"${x}"` : String(x)})`);
      out[k] = t;
    }
    return out;
  };
  const withSettings = (s: { source: string; lang?: ScriptLang; code?: 'js'; name: string }, v: unknown, what: string): string => {
    const vals = values(v, what);
    if (!Object.keys(vals).length) return s.source;
    const r = setScriptParams(s.source, how(s), vals);
    if (r.skipped.length) throw new ReferenceError(`${what}: ${s.name} has no setting ${r.skipped.join(', ')} (it has ${scriptParams(s.source, how(s)).map(p => p.name).join(', ') || 'none'})`);
    return r.source;
  };
  const settingsOf = (s: { source: string; lang?: ScriptLang; code?: 'js' }) => scriptParams(s.source, how(s)).map(p => ({ name: p.name, value: p.value, line: p.line, comment: p.comment }));
  const call = (s: { source: string; lang?: ScriptLang; code?: 'js'; name: string }, v: unknown): unknown => {
    if (s.code !== 'js') throw new TypeError(`scripts.call: ${s.name} is written in assembler: a JavaScript script's code can be run here (scripts.run runs any script when this run has ended)`);
    if (depth >= SCRIPTS_CALL_DEPTH) throw new RangeError(`scripts.call: scripts call scripts ${SCRIPTS_CALL_DEPTH} deep at most (does ${s.name} call itself?)`);
    const source = withSettings(s, v, 'scripts.call');
    depth++;
    try { return run(s.name, source); } finally { depth--; }
  };
  const info = (s: ScriptInfo) => {
    const o = {
      name: s.name, code: s.code === 'js' ? 'js' : 'asm', lang: s.lang, source: s.source, lines: lineCount(s.source), safe: !!s.safe, when: s.when ?? null, key: s.key ?? null, machine: s.machine ?? null,
      pads: (s.pads ?? []).map(p => ({ name: p.name, start: p.start, end: p.start + p.size, size: p.size })),
      self: !!data && sameName(s.name, data.self),
      setting(name: unknown) { const p = settingsOf(s).find(x => x.name === name); return p ? p.value : null; },
      withSettings: (v: unknown) => withSettings(s, v, 'withSettings'),
      call: (v?: unknown) => call(s, v),
      toString: () => `${s.name} (${s.code === 'js' ? 'JavaScript' : 'assembler'}, ${lineCount(s.source)} lines)`,
    };
    Object.defineProperty(o, 'settings', { enumerable: true, get: () => settingsOf(s) });
    return Object.freeze(o);
  };
  const all = (data?.scripts ?? []).map(info);
  const library = (data?.library ?? []).map(s => info({ ...s }));
  const template = (t: ScriptTemplate) => Object.freeze({ name: t.name, title: t.title, about: t.about, code: t.code === 'js' ? 'js' : 'asm', source: t.source, lines: lineCount(t.source), safe: !!t.safe, settings: settingsOf({ source: t.source, code: t.code }) });
  const find = (name: unknown, what: string) => {
    const n = String(name ?? ''), s = (data?.scripts ?? []).find(x => sameName(x.name, n));
    if (!s) throw new ReferenceError(`${what}: "${n}" is not a script of the project (it has ${(data?.scripts ?? []).map(x => x.name).join(', ') || 'none'})`);
    return s;
  };
  const nameOk = (n: unknown, what: string): string => {
    const s = String(n ?? '').trim();
    if (!NAME.test(s)) throw new TypeError(`${what}: "${s}" is no name of a script: 1 to 60 characters, none of \\ / : * ? " < > |`);
    return s;
  };
  const whenOk = (w: unknown, what: string): UserScript['when'] | null => {
    if (w == null || w === '' || w === false) return null;
    if (w !== 'build' && w !== 'load') throw new TypeError(`${what}: when is "build", "load" or null (not "${String(w)}")`);
    return w;
  };
  const keyOk = (k: unknown, what: string): string | null => {
    if (k == null || k === '' || k === false) return null;
    const key = SCRIPT_KEYS.find(x => x.toLowerCase() === String(k).toLowerCase().replace(/\s+/g, ''));
    if (!key) throw new TypeError(`${what}: key is one of ${SCRIPT_KEYS.join(', ')}, or null (not "${String(k)}")`);
    return key;
  };
  const sourceOk = (s: unknown, what: string): string => {
    if (typeof s !== 'string') throw new TypeError(`${what}: the code is wanted, a text`);
    if (s.length > 2 * 1024 * 1024) throw new RangeError(`${what}: the code is ${s.length} characters: 2 MB at most`);
    return s.replace(/\r\n?/g, '\n');
  };

  return {
    all, names: all.map(s => s.name), library,
    templates: [...SCRIPT_TEMPLATES, ...JS_TEMPLATES].map(template),
    self: all.find(s => s.self) ?? null,
    find(name: unknown) { const n = String(name ?? ''); return all.find(s => sameName(s.name, n)) ?? null; },
    call: (name: unknown, v?: unknown) => call(find(name, 'scripts.call'), v),
    use: (name: unknown, v?: unknown) => call(find(name, 'scripts.use'), v),
    add(name: unknown, source: unknown, opts?: unknown) {
      const o = (opts && typeof opts === 'object' ? opts : {}) as Record<string, unknown>, n = nameOk(name, 'scripts.add');
      const code = String(o.code ?? 'js').toLowerCase();
      if (!['js', 'javascript', 'asm', 'assembler'].includes(code)) throw new TypeError(`scripts.add: code is "js" or "asm" (not "${String(o.code)}")`);
      if ((data?.scripts ?? []).some(x => sameName(x.name, n)) || made.some(r => r.kind === 'add' && sameName(r.name, n))) throw new RangeError(`scripts.add: ${n} is in the project already: scripts.edit changes it`);
      const when = whenOk(o.when, 'scripts.add'), key = keyOk(o.key, 'scripts.add');
      ask({ kind: 'add', name: n, source: sourceOk(source, 'scripts.add'), ...(code.startsWith('j') ? { code: 'js' as const } : {}), ...(o.safe ? { safe: true } : {}), ...(when ? { when } : {}), ...(key ? { key } : {}) });
    },
    edit(name: unknown, change: unknown) {
      const s = find(name, 'scripts.edit');
      if (!change || typeof change !== 'object') throw new TypeError('scripts.edit: what to change is wanted: { source, settings, safe, when, key, name }');
      const o = change as Record<string, unknown>;
      let source = o.source != null ? sourceOk(o.source, 'scripts.edit') : undefined;
      if (o.settings != null) source = withSettings({ ...s, source: source ?? s.source }, o.settings, 'scripts.edit');
      const rename = o.name != null && !sameName(String(o.name).trim(), s.name) ? nameOk(o.name, 'scripts.edit') : undefined;
      ask({ kind: 'edit', name: s.name, ...(source != null && source !== s.source ? { source } : {}), ...(rename ? { rename } : {}), ...(o.safe != null ? { safe: !!o.safe } : {}),
        ...('when' in o ? { when: whenOk(o.when, 'scripts.edit') } : {}), ...('key' in o ? { key: keyOk(o.key, 'scripts.edit') } : {}) });
    },
    run(name: unknown, opts?: unknown) {
      const s = find(name, 'scripts.run'), o = (opts && typeof opts === 'object' ? opts : {}) as Record<string, unknown>;
      const source = o.settings != null ? withSettings(s, o.settings, 'scripts.run') : undefined;
      ask({ kind: 'run', name: s.name, ...(source != null && source !== s.source ? { source } : {}) });
    },
    get requests() { return made.map(scriptsRequestText); },
  };
}
