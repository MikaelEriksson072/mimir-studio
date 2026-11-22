/* Hover (registers, labels, opcodes) and go-to-definition (Ctrl+click, F12) for the sources of both assemblers, and
 * a script's suggestions and light bulb in its language (Kick Assembler or 64tass). */
import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api';
import { driveSymbol, findBlock, h4, kindInfo, OPC, padName, tassName, padStoreAt, padStoreLine, SYM, undocumentedText, type AnalysisResult, type RenderResult, type ScriptLang, type ScriptPad } from '@mimir/core';
import { KICKASS } from './kickass-language';
import { TASS64 } from './tass-language';

/** The analysis shown in the editor; SourceView keeps it current. */
export const monacoContext: { A: AnalysisResult | null; R: RenderResult | null } = { A: null, R: null };

/** The script shown in the Scripts tab (models of the `script:` scheme): the names its code may use, its scratchpads,
 *  the names of its links (UserScript.links) and what kind of block each of the program's labels is on. */
export const scriptContext: { names: ReadonlyMap<string, number>; pads: readonly ScriptPad[]; links: ReadonlySet<string>; kinds: ReadonlyMap<string, string>;
  /** a store's line written into a scratchpad too (its index; -1: a new one): ScriptsView's, null while the code cannot
   *  be changed (debugging) */
  padStore: ((line: number, pad: number) => void) | null } = { names: new Map(), pads: [], links: new Set(), kinds: new Map(), padStore: null };

/** the command a store's code actions run (scriptContext.padStore) */
export const PAD_STORE_CMD = 'mimir.script.padStore';

/** what a script's code may write besides names: Kick Assembler's directives and functions, and 64tass's */
const TASS_WORDS = ['.mark', '.name', '.note', '.junk', '.byte', '.word', '.text', '.null', '.fill', '.if', '.elsif', '.else', '.endif', '.warn', '.error', '.cerror', '.cwarn', '.enc', '.cpu', '.logical', '.here',
  '.block', '.bend', '.namespace', '.endnamespace', '.comment', '.endc', 'len', 'format', 'true', 'false'];
const SCRIPT_WORDS = ['.mark', '.name', '.note', '.junk', '.byte', '.word', '.text', '.fill', '.const', '.var', '.label', '.eval', '.for', '.while', '.if', 'else', '.print', '.error', '.encoding', '.align', '.pseudopc',
  'round', 'floor', 'ceil', 'abs', 'min', 'max', 'mod', 'pow', 'sqrt', 'sin', 'cos', 'tan', 'toRadians', 'toDegrees', 'toIntString', 'toHexString', 'toBinaryString', 'PI', 'true', 'false'];

/** the hardware's names (the include file's): they come after the program's own */
let HW: Set<string> | null = null;
const isHardware = (n: string) => (HW ??= new Set([...[...SYM.exact.values()].map(s => s.name), ...SYM.regions.map(r => r.name)])).has(n);

/** the start of a line up to where an instruction's mnemonic goes: nothing, or a label (`loop:`, `!:`) */
const AT_MNEMONIC = /^\s*(?:(?:![A-Za-z_]\w*|!|[A-Za-z_]\w*)\s*:\s*)?$/;
/** an instruction's operand after a comma: `,x` or `,y` (the index register), never a name */
const AT_INDEX = /^\s*(?:(?:![A-Za-z_]\w*|!|[A-Za-z_]\w*)\s*:\s*)?[A-Za-z]{3}(?:\.[A-Za-z]+)?\s+[^/]*,\s*$/;

/** the same for 64tass: a label at the start of the line, with or without its colon (`loop`, `+`), then the mnemonic */
const TASS_AT_MNEMONIC = /^(?:\s*|(?:[A-Za-z_]\w*:?|[+-])\s+)$/;
const TASS_AT_INDEX = /^(?:(?:[A-Za-z_]\w*:?|[+-])\s+|\s+)[A-Za-z]{3}\s+[^;]*,\s*$/;
export interface ScriptSuggestion { label: string; kind: 'link' | 'pad' | 'name' | 'hardware' | 'mnemonic' | 'word'; detail?: string }

/**
 * What a script's code may write where the cursor is. First on a line the mnemonics and directives that start with
 * what is typed; in an operand the names: the script's links first, then its scratchpads, the program's labels and
 * variables, the hardware's names and the functions, each that starts with what is typed or, from two letters on, has
 * a part (after a `_`) that does (`tab` finds my_table); with nothing typed (Ctrl+Space) all of them. After a name and
 * a dot the rest of the names that start so (`music.` → `.location`, `.init`, `.play`, `.size`). After an
 * instruction's comma nothing (the index register: `x` is not SID_POT_X), nor in a comment.
 */
export function scriptSuggestions(before: string, typed: string, names: ReadonlyMap<string, number>, pads: readonly Pick<ScriptPad, 'name'>[], more: { links?: ReadonlySet<string>; kinds?: ReadonlyMap<string, string>; lang?: ScriptLang } = {}): ScriptSuggestion[] {
  const tass = more.lang === '64tass', words = tass ? TASS_WORDS : SCRIPT_WORDS, atMnemonic = tass ? TASS_AT_MNEMONIC : AT_MNEMONIC;
  if ((tass ? before.includes(';') : /\/\//.test(before)) || (tass ? TASS_AT_INDEX : AT_INDEX).test(before)) return [];
  const dot = before.endsWith('.');
  const t = (dot ? '.' : '') + typed.toLowerCase();
  // a word that starts with what is typed and is more than it (a word typed in full needs no box)
  const starts = (s: string) => { const l = s.toLowerCase(); return l.startsWith(t) && l !== t; };
  // a part of a name after a `_` that starts with what is typed (two letters at least: `x` finds no SID_POT_X)
  const inPart = (s: string) => t.length >= 2 && /^[a-z_]/.test(t) && s.toLowerCase().split('_').slice(1).some(p => p.startsWith(t));
  // a directive where a mnemonic goes (not `music.init` or a number)
  if (dot && atMnemonic.test(before.slice(0, -1))) return words.filter(x => x[0] === '.' && starts(x)).map(label => ({ label, kind: 'word' as const }));
  // after a name and its dot the rest of the names that start with them (`music.` → `.location`)
  if (dot) {
    const head = /(?<![\w.$%!])([A-Za-z_]\w*)\.$/.exec(before)?.[1];
    if (!head) return [];
    return [...names].filter(([n]) => n.startsWith(`${head}.`) && starts(n.slice(head.length)))
      .map(([n, a]) => ({ label: n.slice(head.length), kind: 'name' as const, detail: `$${h4(a)} · ${more.kinds?.get(n) ?? 'label'}` }));
  }
  if (atMnemonic.test(before)) return typed ? [...new Set(OPC.filter(o => !o.ill).map(o => o.mn.toLowerCase()))].filter(starts).map(label => ({ label, kind: 'mnemonic' as const })) : [];
  const fits = (s: string) => !typed || starts(s) || inPart(s);
  const own = new Set(pads.flatMap(p => [p.name, `${p.name}_end`]));
  const out: ScriptSuggestion[] = [];
  for (const n of more.links ?? []) if (fits(n)) {
    const base = n.replace(/\+\d+$/, ''), a = names.get(base), off = n === base ? 0 : +n.slice(base.length + 1);
    out.push({ label: n, kind: 'link', detail: `${a != null ? `$${h4(a + off)} · ` : ''}linked${more.kinds?.get(base) ? ` · ${more.kinds.get(base)}` : ''}` });
  }
  for (const [n, a] of names) {
    if (more.links?.has(n) || !fits(n)) continue;
    const kind = own.has(n) ? 'pad' : isHardware(n) ? 'hardware' : 'name';
    out.push({ label: n, kind, detail: `$${h4(a)} · ${kind === 'pad' ? 'scratchpad' : kind === 'hardware' ? 'hardware' : more.kinds?.get(n) ?? 'label'}` });
  }
  for (const x of words) if (x[0] !== '.' && fits(x)) out.push({ label: x, kind: 'word' });
  return out;
}

/** what a JavaScript script is given (script-js.ts), as its editor suggests them: the text put in, and what it is */
export const JS_API: readonly { label: string; insert: string; detail: string }[] = [
  { label: 'mem', insert: 'mem', detail: 'the program\'s memory, with the scratchpads in it: a Uint8Array of 65536 bytes' },
  { label: 'addr', insert: 'addr("', detail: 'addr("name"): the address of a label, a variable or a scratchpad' },
  { label: 'pad', insert: 'pad("', detail: 'pad("pad1"): a scratchpad\'s bytes, a view of mem' },
  { label: 'cpu.call', insert: 'cpu.call("', detail: 'cpu.call("name", { a, x, y, c }): run the program\'s 6510 code until it returns; gives { a, x, y, p, c, z, n }' },
  { label: 'print', insert: 'print(', detail: 'print(...): a line under Last run' },
  { label: 'hex', insert: 'hex(', detail: 'hex(value, digits): "$1a2b"' },
  { label: 'word', insert: 'word(', detail: 'word(address): the 16-bit value there, low byte first' },
  { label: 'setWord', insert: 'setWord(', detail: 'setWord(address, value): a 16-bit value, low byte first' },
  { label: 'mark', insert: 'mark(', detail: 'mark(start, end, "text"): the bytes are of this type, as Mark as makes them' },
  { label: 'name', insert: 'name(', detail: 'name(address, "label"): the address gets this label' },
  { label: 'note', insert: 'note(', detail: 'note(address, "text"): the line at the address gets this comment' },
  { label: 'junk', insert: 'junk(', detail: 'junk(start, end): the bytes are junk, left out of everything' },
  { label: 'disk', insert: 'disk', detail: 'the mounted disk, or null: disk.files, disk.read("NAME"), disk.sector(track, sector)' },
];

/**
 * What a JavaScript script's code may write where the cursor is: inside the quotes of addr("…"), cpu.call("…") and the
 * others that take an address, the program's names that start with what is typed (a scratchpad's inside pad("…"));
 * elsewhere what the script is given (JS_API) that starts with it.
 */
export function jsSuggestions(before: string, typed: string, names: ReadonlyMap<string, number>, pads: readonly Pick<ScriptPad, 'name'>[]): { label: string; insert: string; detail: string; kind: 'name' | 'pad' | 'api' }[] {
  const starts = (s: string) => s.toLowerCase().startsWith(typed.toLowerCase()) && s.length > typed.length;
  if (/\bpad\(\s*["'][^"']*$/.test(before)) return pads.filter(p => starts(p.name)).map(p => ({ label: p.name, insert: p.name, detail: 'scratchpad', kind: 'pad' as const }));
  if (/\b(?:addr|call|word|setWord|mark|name|note|junk)\((?:[^()"']*,)?\s*["'][^"']*$/.test(before))
    return [...names].filter(([n]) => starts(n)).slice(0, 200).map(([n, a]) => ({ label: n, insert: n, detail: `$${h4(a)}`, kind: 'name' as const }));
  if (!typed || /["'][^"']*$/.test(before.replace(/"[^"]*"|'[^']*'/g, ''))) return [];
  const head = /\bcpu\.$/.test(before) ? 'cpu.' : '';
  return JS_API.filter(x => (head ? x.label.startsWith(head) && starts(x.label.slice(head.length)) : !x.label.includes('.') ? starts(x.label) : starts(x.label.split('.')[0]) && typed.toLowerCase() !== 'cpu'))
    .map(x => (head ? { label: x.label.slice(head.length), insert: x.insert.slice(head.length), detail: x.detail, kind: 'api' as const } : x.label.includes('.') ? { label: 'cpu', insert: 'cpu', detail: x.detail, kind: 'api' as const } : { ...x, kind: 'api' as const }));
}

/** the name with a dot in it (`music.location`) that the character at `at` of a line is in, or null */
export function dottedNameAt(line: string, at: number): string | null {
  for (const m of line.matchAll(/(?<![\w$%!])[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)+/g)) if (at >= m.index! && at < m.index! + m[0].length) return m[0];
  return null;
}

export function registerProviders(monaco: typeof Monaco): void {
  // a script's code: what fits where the cursor is (scriptSuggestions); Tab takes one, Enter always ends the line
  for (const lang of [KICKASS, TASS64]) monaco.languages.registerCompletionItemProvider(lang, {
    triggerCharacters: ['.'],
    provideCompletionItems(model, pos) {
      if (model.uri.scheme !== 'script') return { suggestions: [] };
      const w = model.getWordUntilPosition(pos), line = model.getLineContent(pos.lineNumber);
      const before = line.slice(0, w.startColumn - 1), dot = before.endsWith('.');
      const range = new monaco.Range(pos.lineNumber, w.startColumn - (dot ? 1 : 0), pos.lineNumber, w.endColumn);
      const K = monaco.languages.CompletionItemKind;
      const kind = { link: K.Reference, pad: K.Struct, name: K.Variable, hardware: K.Constant, mnemonic: K.Keyword, word: K.Function } as const;
      const order = { link: '0', pad: '1', name: '2', hardware: '3', mnemonic: '4', word: '5' } as const;
      return { suggestions: scriptSuggestions(before, w.word, scriptContext.names, scriptContext.pads, { ...scriptContext, lang: lang === TASS64 ? '64tass' : 'kickass' }).map(s => ({ label: s.label, kind: kind[s.kind], insertText: s.label, range, sortText: order[s.kind] + s.label, ...(s.detail ? { detail: s.detail } : {}) })) };
    },
  });
  // a script in JavaScript: what it is given, and the program's names inside addr("…")
  monaco.languages.registerCompletionItemProvider('javascript', {
    triggerCharacters: ['.', '"'],
    provideCompletionItems(model, pos) {
      if (model.uri.scheme !== 'script') return { suggestions: [] };
      const w = model.getWordUntilPosition(pos), before = model.getLineContent(pos.lineNumber).slice(0, w.startColumn - 1);
      const range = new monaco.Range(pos.lineNumber, w.startColumn, pos.lineNumber, w.endColumn);
      const K = monaco.languages.CompletionItemKind, kind = { name: K.Variable, pad: K.Struct, api: K.Function } as const;
      return { suggestions: jsSuggestions(before, w.word, scriptContext.names, scriptContext.pads).map(s => ({ label: s.label, kind: kind[s.kind], insertText: s.insert, detail: s.detail, range })) };
    },
  });
  // (the hover and go-to-definition serve both assemblers' sources: Kick Assembler's and 64tass's, spec 11.8)
  for (const lang of [KICKASS, TASS64]) monaco.languages.registerHoverProvider(lang, {
    provideHover(model, pos) {
      const w = model.getWordAtPosition(pos); if (!w) return null;
      const name = w.word;
      // in a script: a name with a dot in it, as a whole (`music.location`: LoadSid's music)
      if (model.uri.scheme === 'script') {
        const d = dottedNameAt(model.getLineContent(pos.lineNumber), pos.column - 1), a = d != null ? scriptContext.names.get(d) : undefined;
        if (d != null && a != null) return { contents: [{ value: `**${d}** — $${h4(a)}` }, { value: scriptContext.kinds.get(d) ?? 'a name of the program' }] };
      }
      // a script's scratchpad
      const pad = model.uri.scheme === 'script' ? scriptContext.pads.find(p => p.name === name || `${p.name}_end` === name) : undefined;
      if (pad) return { contents: [{ value: `**${name}** — $${h4(name === pad.name ? pad.start : pad.start + pad.size)}` }, { value: `scratchpad ${pad.name}: $${h4(pad.start)}-$${h4(pad.start + pad.size - 1)}, ${pad.size} bytes${name === pad.name ? '' : ' (the address after it)'}` }] };
      // the drive code (its own model): the 1541's registers, and none of the listing's labels
      const drive = model.uri.scheme === 'drive';
      const via = drive ? driveSymbol(name) : null;
      if (via) return { contents: [{ value: `**${name}** — $${h4(via.addr)}` }, { value: `1541 VIA · ${via.desc}` }] };
      const sym = drive ? undefined : [...SYM.exact.values()].find(s => s.name === name);
      const region = drive ? undefined : SYM.regions.find(r => r.name === name);
      if (sym) return { contents: [{ value: `**${name}** — $${h4(sym.addr)}` }, { value: `${sym.cat} · ${sym.desc}` }] };
      if (region) return { contents: [{ value: `**${name}** — $${h4(region.start)}` }, { value: `${region.cat} · ${region.desc}` }] };
      const { R, A } = monacoContext;
      // (the names the source has: with a view offset the listing's differ, spec 10.4)
      if (R && A && !drive) for (const [a, l] of R.fileLabels ?? R.labels) if (l.name === name) {
        const xs = A.xrefs.get(a) || [];
        const b = findBlock(A.blocks, a);
        return { contents: [{ value: `**${name}** — $${h4(a)}` }, { value: `${b ? kindInfo(b.type).label : 'label'} · ${xs.length} reference${xs.length === 1 ? '' : 's'}${l.user ? ' · renamed by you' : ''}` }] };
      }
      // in a script: any name its code may use (a zero-page variable, or a label before the source tab was opened)
      const known = model.uri.scheme === 'script' ? scriptContext.names.get(name) : undefined;
      if (known != null) return { contents: [{ value: `**${name}** — $${h4(known)}` }, { value: 'a name of the program' }] };
      // a mnemonic; an undocumented one (also in a `.byte` line's comment) with what it does, as the first opcode of it
      // Kick Assembler writes (an `lax` instruction is never the unstable `lax #`)
      // (64tass's names too: isb is ISC, asr ALR, sbx AXS …)
      const ops = OPC.filter(o => o.mn.toLowerCase() === name.toLowerCase() || (model.getLanguageId() === TASS64 && tassName(o.mn).toLowerCase() === name.toLowerCase()));
      const op = ops.find(o => !o.ill) ?? ops.find(o => o.kick) ?? ops[0];
      const text = op && op.ill ? undocumentedText(op.op, true) : null;
      if (text) { const [head, ...rest] = text.split('\n'); return { contents: [{ value: `**${head}**` }, { value: rest.join('  \n') }] }; }
      if (op) return { contents: [{ value: `**${op.mn}**` }] };
      return null;
    },
  });
  // a script's store (sta $ff40,x) written into a scratchpad too: the light bulb on its line, a click or Ctrl+. gives a
  // scratchpad of the script's or a new one, and the line that writes into it goes in after it (ScriptsView)
  monaco.editor.registerCommand(PAD_STORE_CMD, (_: unknown, line: number, pad: number) => scriptContext.padStore?.(line, pad));
  for (const lang of [KICKASS, TASS64]) monaco.languages.registerCodeActionProvider(lang, {
    provideCodeActions(model, range) {
      const none = { actions: [], dispose() { } };
      if (model.uri.scheme !== 'script' || !scriptContext.padStore) return none;
      const pads = scriptContext.pads, st = padStoreAt(model.getLinesContent(), range.startLineNumber, pads, lang === TASS64 ? '64tass' : 'kickass');
      if (!st || 'why' in st) return none;
      const done = new Set(st.into.map(i => i.pad));
      const act = (title: string, pad: number) => ({ title, kind: 'quickfix', isPreferred: false, command: { id: PAD_STORE_CMD, title, arguments: [st.line, pad] } });
      return {
        actions: [
          ...pads.flatMap((p, i) => done.has(p.name) ? [] : [act(`Also write into ${p.name}: ${padStoreLine(st, p.name).trim()}`, i)]),
          act(`Also write into a new scratchpad: ${padStoreLine(st, padName(pads)).trim()}`, -1),
        ],
        dispose() { },
      };
    },
  }, { providedCodeActionKinds: ['quickfix'] });
  for (const lang of [KICKASS, TASS64]) monaco.languages.registerDefinitionProvider(lang, {
    provideDefinition(model, pos) {
      const w = model.getWordAtPosition(pos); if (!w) return null;
      // `name:`; in 64tass also `name = value` and `name .namespace` at the start of a line
      const word = w.word.replace(/[^\w]/g, '');
      const m = new RegExp(lang === TASS64 ? `^${word}(?::|\\s*:?=|\\s+\\.(?:namespace|block)\\b)` : `^${word}:`, 'm').exec(model.getValue()); if (!m) return null;
      const p = model.getPositionAt(m.index);
      return { uri: model.uri, range: new monaco.Range(p.lineNumber, 1, p.lineNumber, w.word.length + 1) };
    },
  });
}
