/* Hover (registers, labels, opcodes) and go-to-definition (Ctrl+click, F12) for the sources of both assemblers, and
 * a script's suggestions and light bulb in its language (Kick Assembler or 64tass). In the Assembler (spec 10.7) also a
 * name's references in all the folder's sources (Shift+F12), its rename in all of them (F2) and a file's outline
 * (Ctrl+Shift+O). */
import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api';
import { jsMembers } from '../lib/jsmembers';
import { asmNameRefs, asmNames, asmRenameProblem, driveSymbol, findBlock, h4, kindInfo, OPC, padName, tassName, padStoreAt, padStoreLine, SYM, TASS_ALL_MNEMONICS, undocumentedText, type AnalysisResult, type RenderResult, type ScriptLang, type ScriptPad } from '@mimir/core';
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

/** a macro of the macro library as the Assembler's editor suggests it (spec 10.8): its name and kind, its call as the
 *  list shows it and as a snippet (its parameters places to type in), its description, its collection, and what
 *  choosing it does to the project (it goes in macros.asm) */
export interface AsmLibMacro { name: string; how: 'macro' | 'pseudocommand' | 'function' | 'segment' | 'sfunction'; sig: string; snippet: string; description: string; in: string | null; note: string }

/** The Assembler's files (models of the `asm` scheme, spec 10.7): the names the program defines (its labels and
 *  constants, as Mimir's check of it last found them) and what each is. */
export const asmContext: { names: ReadonlyMap<string, number>; kinds: ReadonlyMap<string, string>;
  /** says why a rename was not done (Monaco's standalone editor shows a rename's refusal nowhere) */
  notify: (msg: string) => void;
  /** the macro library's macros of the project's assembler (those the project defines itself left out), and a macro of
   *  them chosen in the suggestions: the project gets it (its macro file) */
  macros: readonly AsmLibMacro[]; useMacro: (name: string) => void } = { names: new Map(), kinds: new Map(), notify: () => { }, macros: [], useMacro: () => { } };

/** the command a library macro chosen in the suggestions runs (asmContext.useMacro) */
export const USE_MACRO_CMD = 'mimir.codeLib.useMacro';

/**
 * The macro library's macros the Assembler's editor suggests where the cursor is: where an instruction goes the macros
 * (Kick Assembler's pseudo commands too) whose names start with what is typed (from two letters on, also a part after a
 * `_`), their call put in with its parameters to type; in 64tass after a `#` there the call without it. In an operand
 * the functions. Nothing in a comment or after an instruction's comma. `label` is what is matched, `insert` the snippet.
 */
export function asmMacroSuggestions(before: string, typed: string, macros: readonly AsmLibMacro[], lang: ScriptLang): { m: AsmLibMacro; label: string; insert: string }[] {
  const tass = lang === '64tass';
  if ((tass ? before.includes(';') : /\/\//.test(before)) || (tass ? TASS_AT_INDEX : AT_INDEX).test(before)) return [];
  const t = typed.toLowerCase();
  const fits = (n: string) => { const l = n.toLowerCase(); return (l.startsWith(t) && l !== t) || (t.length >= 2 && l.split('_').slice(1).some(p => p.startsWith(t))); };
  const call = (m: AsmLibMacro) => m.how === 'macro' || m.how === 'segment' || m.how === 'pseudocommand';
  const atStatement = tass ? TASS_AT_MNEMONIC : AT_MNEMONIC;
  // 64tass: `#` typed where an instruction goes, the call without it
  if (tass && before.endsWith('#') && atStatement.test(before.slice(0, -1))) return macros.filter(m => call(m) && fits(m.name)).map(m => ({ m, label: m.name, insert: m.snippet.replace(/^#/, '') }));
  if (!typed) return [];
  if (atStatement.test(before)) return macros.filter(m => call(m) && fits(m.name)).map(m => ({ m, label: m.name, insert: m.snippet }));
  // an operand: the functions (a name with a dot before it is a scope's, not one)
  if (/[\w.]$/.test(before)) return [];
  return macros.filter(m => !call(m) && fits(m.name)).map(m => ({ m, label: m.name, insert: m.snippet }));
}

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

/** the same for 64tass: a label first on the line, indented or not, with or without its colon (`loop`, `+`), then the
 *  mnemonic (a word that is a mnemonic itself is the instruction: its operand comes next) */
const TASS_AT_MNEMONIC = { test: (s: string) => { const m = /^\s*(?:([A-Za-z_]\w*)(:?)\s+|[+-]\s+)?$/.exec(s); return !!m && !(m[1] && !m[2] && TASS_ALL_MNEMONICS.has(m[1].toLowerCase())); } };
const TASS_AT_INDEX = /^\s*(?:(?:[A-Za-z_]\w*:?|[+-])\s+)?[A-Za-z]{3}\s+[^;]*,\s*$/;
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
  { label: 'files', insert: 'files', detail: 'the program\'s files in memory: [{ start, end }], end the address after the last byte' },
  { label: 'disk', insert: 'disk', detail: 'the mounted disk, or null: disk.files, disk.read("NAME"), disk.sector(track, sector)' },
  { label: 'disks', insert: 'disks', detail: 'disk images made and changed: disks.create("d64" or "d81", { name, id }), disks.open(bytes), disks.mounted (a copy of the mounted disk); a disk\'s files, add("name", bytes), remove, rename, sector(t, s), validate(), save("name.d64") and mount()' },
  { label: 'cartridges', insert: 'cartridges', detail: 'cartridge images made and changed: cartridges.create("normal", { name, size, data }) with the standard structures as templates (cartridges.layouts), cartridges.fromProgram(bytes), cartridges.open(bytes), cartridges.project (a copy of the project\'s cartridge); a cartridge\'s chips, add(bank, load, bytes), read, write, peek and poke by bank, setStart(cold), save("name.crt") and run()' },
  { label: 'tapes', insert: 'tapes', detail: 'tape images made and changed: tapes.create("tap" or "t64", { name }), tapes.open(bytes), tapes.mounted (a copy of the tape in the datasette); a tape\'s files, add("name", bytes, { load }), remove, rename, toT64(), toTap(), save("name.tap") and insert(); a TAP\'s pulses, pause() and cut()' },
  { label: 'scripts', insert: 'scripts', detail: 'the scripts: scripts.all, scripts.library and scripts.templates; scripts.call("name", { setting: value }) runs another JavaScript script\'s code here and gives what it returns (a library); scripts.add, scripts.edit and scripts.run are done when the run has ended' },
  { label: 'snapshot', insert: 'snapshot', detail: 'the VICE snapshot the project was opened from, or null: snapshot.cpu, port, ram, cia1, cia2, sid, vic (registers, colour RAM, sprites) and drive (its CPU, RAM, VIAs and head) as they were saved, read and set; snapshot.write() has the project keep it as changed' },
  { label: 'blocks', insert: 'blocks', detail: 'the program\'s blocks: blocks.all, blocks.at(address), blocks.mark(start, end, type, { fmt, row }), blocks.struct("name", ["x: byte", "name: text[8]"]) for records of fields, blocks.define("name", …) for a custom type, a block\'s bytes, records, format() and split()' },
  { label: 'library', insert: 'library', detail: 'the library of SIDs, sprites, charsets and bitmaps: library.items (and sids, sprites, chars, bitmaps), library.find("name"), an item\'s bytes, put(at) and asFile(), library.add(kind, bytes, { name })' },
  { label: 'sid', insert: 'sid', detail: 'SID music: sid.tunes (the program\'s music, each with sid(), player() and run()), sid.parse(file), sid.make(bytes, { load, init, play }), sid.run({ init, play }) frame by frame, sid.play(tune) in VICE or DeepSID' },
  { label: 'build', insert: 'build', detail: 'building and running: build.last (the last build), build.verify(), build.run({ debugger }), build.start(prg) for a file of the script\'s own in the emulator' },
  { label: 'exporter', insert: 'exporter', detail: 'the export: exporter.files, exporter.read("name"), exporter.add("name", content), exporter.edit("name", text => …), exporter.remove("name"), exporter.write() to have it written' },
  { label: 'loader', insert: 'loader', detail: 'the loader of the mounted disk or tape, as its loader tab shows it, or null: loader.files, loader.groups, loader.find("name"), loader.load("name"), loader.script' },
  { label: 'loaders', insert: 'loaders', detail: 'the loaders of the mounted disk and the tape: a list (empty when Mimir knows none)' },
  { label: 'brokkr', insert: 'brokkr', detail: 'Brokkr, Mimir\'s cruncher: brokkr.pack(prg) for a file that unpacks itself, brokkr.crunch(bytes), brokkr.decrunch(stream), brokkr.mem(bytes, start)' },
  { label: 'sindri', insert: 'sindri', detail: 'Sindri, Mimir\'s C64 and unpacker: sindri.unpack(prg), sindri.c64(), sindri.disassemble(at), sindri.basic()' },
  { label: 'screen', insert: 'screen', detail: 'the script\'s C64 screen (Scripts → C64 screen): screen.print("HELLO"), screen.at(col, row), screen.color = "white", screen.poke(col, row, code); also in mem at $0400 (characters), $d800 (colours), $d020/$d021 (border, background)' },
  { label: 'save', insert: 'save(', detail: 'save("name.prg", bytes, load): a file the run made, listed under Last run (To the project…, Save…)' },
];

/**
 * What a JavaScript script's code may write where the cursor is: inside the quotes of addr("…"), cpu.call("…") and the
 * others that take an address, the program's names that start with what is typed (a scratchpad's inside pad("…"));
 * after a dot the properties and methods of the value before it (lib/jsmembers.ts); elsewhere what the script is
 * given (JS_API) that starts with what is typed. `source`: the script's code, where a name's value is looked up.
 */
export function jsSuggestions(before: string, typed: string, names: ReadonlyMap<string, number>, pads: readonly Pick<ScriptPad, 'name'>[], source = ''): { label: string; insert: string; detail: string; kind: 'name' | 'pad' | 'api' | 'member' }[] {
  const starts = (s: string) => s.toLowerCase().startsWith(typed.toLowerCase()) && s.length > typed.length;
  if (/\bpad\(\s*["'][^"']*$/.test(before)) return pads.filter(p => starts(p.name)).map(p => ({ label: p.name, insert: p.name, detail: 'scratchpad', kind: 'pad' as const }));
  if (/\b(?:addr|call|word|setWord|mark|name|note|junk)\((?:[^()"']*,)?\s*["'][^"']*$/.test(before))
    return [...names].filter(([n]) => starts(n)).slice(0, 200).map(([n, a]) => ({ label: n, insert: n, detail: `$${h4(a)}`, kind: 'name' as const }));
  if (/["'][^"']*$/.test(before.replace(/"[^"]*"|'[^']*'/g, ''))) return [];
  // after a dot: what the value before it has (disk., cpu., mem., a call's result, one of disk.files …); nothing for a
  // value Mimir does not know
  if (before.endsWith('.')) return (jsMembers(before.slice(0, -1), typed, source) ?? []).map(x => ({ ...x, kind: 'member' as const }));
  if (!typed) return [];
  // (cpu.call is listed as cpu: its call comes after the dot)
  return JS_API.filter(x => starts(x.label.split('.')[0]))
    .map(x => (x.label.includes('.') ? { label: 'cpu', insert: 'cpu', detail: 'the 6510: cpu.call("name", { a, x, y }) runs the program\'s code', kind: 'api' as const } : { ...x, kind: 'api' as const }));
}

/** the name with a dot in it (`music.location`) that the character at `at` of a line is in, or null */
export function dottedNameAt(line: string, at: number): string | null {
  for (const m of line.matchAll(/(?<![\w$%!])[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)+/g)) if (at >= m.index! && at < m.index! + m[0].length) return m[0];
  return null;
}

export function registerProviders(monaco: typeof Monaco): void {
  // a script's code: what fits where the cursor is (scriptSuggestions); Tab takes one, Enter always ends the line
  // (a library macro chosen: the project gets it)
  monaco.editor.registerCommand(USE_MACRO_CMD, (_: unknown, name: string) => asmContext.useMacro(name));
  // the suggestions' details (a library macro's description and what choosing it does, a name's address) open from the
  // start, not only after Ctrl+Space: Monaco keeps that in its storage, one for all its editors, so it is set once, by
  // the first editor's suggestion box (Ctrl+Space still closes them, and they stay closed then)
  let detailsOpen = false;
  monaco.editor.onDidCreateEditor(ed => {
    if (detailsOpen) return;
    setTimeout(() => {
      if (detailsOpen) return;
      try {
        const c = ed.getContribution('editor.contrib.suggestController') as unknown as { widget?: { value?: { _isDetailsVisible?: () => boolean; _setDetailsVisible?: (on: boolean) => void } } } | null;
        const w = c?.widget?.value;
        if (w?._setDetailsVisible) { if (!w._isDetailsVisible?.()) w._setDetailsVisible(true); detailsOpen = true; }
      } catch { /* (another Monaco: the details open with Ctrl+Space as before) */ }
    }, 0);
  });
  for (const lang of [KICKASS, TASS64]) monaco.languages.registerCompletionItemProvider(lang, {
    // (`#`: a 64tass macro's call starts with it)
    triggerCharacters: lang === TASS64 ? ['.', '#'] : ['.'],
    provideCompletionItems(model, pos, cx) {
      const asm = model.uri.scheme === 'asm';
      if (model.uri.scheme !== 'script' && !asm) return { suggestions: [] };
      const w = model.getWordUntilPosition(pos), line = model.getLineContent(pos.lineNumber);
      const before = line.slice(0, w.startColumn - 1), dot = before.endsWith('.');
      const range = new monaco.Range(pos.lineNumber, w.startColumn - (dot ? 1 : 0), pos.lineNumber, w.endColumn);
      const K = monaco.languages.CompletionItemKind;
      const kind = { link: K.Reference, pad: K.Struct, name: K.Variable, hardware: K.Constant, mnemonic: K.Keyword, word: K.Function } as const;
      const order = { link: '0', pad: '1', name: '2', hardware: '3', mnemonic: '4', word: '5' } as const;
      const ctx = asm ? { names: asmContext.names, pads: [], kinds: asmContext.kinds } : scriptContext;
      const l = lang === TASS64 ? '64tass' : 'kickass';
      // the macro library's macros (the Assembler's sources only): their calls, with what they are and do
      const lib = asm && !dot ? asmMacroSuggestions(before, w.word, asmContext.macros, l).map(({ m, label, insert }) => ({
        label, kind: m.how === 'function' || m.how === 'sfunction' ? K.Function : K.Module, insertText: insert, insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
        range: new monaco.Range(pos.lineNumber, w.startColumn, pos.lineNumber, w.endColumn), sortText: `35${label}`, filterText: label,
        detail: `${m.sig} — ${m.in ? `from ${m.in}, ` : ''}macro library`,
        // (its call is the details' first line: the detail)
        documentation: { value: `${m.description ? m.description.replace(/\n/g, '  \n') : '_No description._'}\n\n_${m.note}_` },
        command: { id: USE_MACRO_CMD, title: 'Use the library macro', arguments: [m.name] },
      })) : [];
      // (a `#` typed: only the macros, never every name for an immediate operand)
      if (cx.triggerCharacter === '#') return { suggestions: lib };
      return { suggestions: [...scriptSuggestions(before, w.word, ctx.names, ctx.pads, { ...(asm ? { kinds: asmContext.kinds } : scriptContext), lang: l }).map(s => ({ label: s.label, kind: kind[s.kind], insertText: s.label, range, sortText: order[s.kind] + s.label, ...(s.detail ? { detail: s.detail } : {}) })), ...lib] };
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
      return { suggestions: jsSuggestions(before, w.word, scriptContext.names, scriptContext.pads, model.getValue()).map((s, i) => ({ label: s.label, kind: s.kind === 'member' ? (s.insert.endsWith('(') ? K.Method : K.Property) : kind[s.kind], insertText: s.insert, detail: s.detail, sortText: String(i).padStart(3, '0'), range })) };
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
      // in the Assembler: a name the program defines (dotted ones whole: a label in a scope)
      if (model.uri.scheme === 'asm') {
        const d = dottedNameAt(model.getLineContent(pos.lineNumber), pos.column - 1) ?? name, a = asmContext.names.get(d) ?? asmContext.names.get(name);
        if (a != null) return { contents: [{ value: `**${asmContext.names.has(d) ? d : name}** — $${h4(a)}${a > 0xffff || a < 0 ? ` (${a})` : ''}` }, { value: asmContext.kinds.get(asmContext.names.has(d) ? d : name) ?? 'a label of the program' }] };
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
      if (R && A && !drive && model.uri.scheme !== 'asm') for (const [a, l] of R.fileLabels ?? R.labels) if (l.name === name) {
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
  // the Assembler's names (spec 10.7): where one is written in any of the folder's sources, its rename in all of them,
  // and the names a file defines
  // (`asmx:` the files the sources import from outside the folder, read only: found, never renamed in)
  const ownOrOutside = (m: Monaco.editor.ITextModel) => m.uri.scheme === 'asm' || m.uri.scheme === 'asmx';
  const asmModels = (outsideToo = false) => monaco.editor.getModels().filter(m => (m.uri.scheme === 'asm' || (outsideToo && m.uri.scheme === 'asmx')) && (m.getLanguageId() === KICKASS || m.getLanguageId() === TASS64));
  const langOf = (m: Monaco.editor.ITextModel) => (m.getLanguageId() === TASS64 ? '64tass' as const : 'kickass' as const);
  /** the name the position is on (a name of the code: not in a comment, a string or a number) */
  const nameAt = (model: Monaco.editor.ITextModel, pos: Monaco.Position) => asmNames(model.getLineContent(pos.lineNumber), langOf(model))
    .find(n => pos.column >= n.col && pos.column <= n.col + n.name.length) ?? null;
  const refsOf = (name: string, outsideToo = false) => asmModels(outsideToo).flatMap(m => asmNameRefs(m.getValue(), langOf(m), name).map(r => ({ m, r })));
  for (const lang of [KICKASS, TASS64]) monaco.languages.registerReferenceProvider(lang, {
    provideReferences(model, pos, ctx) {
      if (!ownOrOutside(model)) return null;
      const n = nameAt(model, pos); if (!n) return null;
      return refsOf(n.name, true).filter(x => ctx.includeDeclaration || !x.r.def).map(({ m, r }) => ({ uri: m.uri, range: new monaco.Range(r.line, r.col, r.line, r.col + r.name.length) }));
    },
  });
  for (const lang of [KICKASS, TASS64]) monaco.languages.registerRenameProvider(lang, {
    resolveRenameLocation(model, pos) {
      const here = new monaco.Range(pos.lineNumber, pos.column, pos.lineNumber, pos.column);
      if (model.uri.scheme === 'asmx') return { range: here, text: '', rejectReason: 'This file is outside the project\'s folder and read only: names are renamed in the project\'s own sources' };
      if (model.uri.scheme !== 'asm') return { range: here, text: '', rejectReason: 'Names are renamed in the Assembler\'s sources (a script uses the program\'s names)' };
      const n = nameAt(model, pos);
      if (!n) return { range: here, text: '', rejectReason: 'Not a name of the code' };
      const range = new monaco.Range(pos.lineNumber, n.col, pos.lineNumber, n.col + n.name.length);
      if (!refsOf(n.name).some(x => x.r.def)) return { range, text: n.name, rejectReason: `${n.name} is not defined in the project's sources: a name of the assembler's, or of a file outside the folder` };
      return { range, text: n.name };
    },
    provideRenameEdits(model, pos, to) {
      const n = nameAt(model, pos); if (!n) return { edits: [], rejectReason: 'Not a name of the code' };
      const problem = asmRenameProblem(to, x => asmContext.names.has(x) || refsOf(x).length > 0);
      if (problem) { asmContext.notify(`${n.name} was not renamed: ${problem}`); return { edits: [], rejectReason: problem }; }
      return { edits: refsOf(n.name).map(({ m, r }) => ({ resource: m.uri, versionId: m.getVersionId(), textEdit: { range: new monaco.Range(r.line, r.col, r.line, r.col + r.name.length), text: to } })) };
    },
  });
  for (const lang of [KICKASS, TASS64]) monaco.languages.registerDocumentSymbolProvider(lang, {
    provideDocumentSymbols(model) {
      if (!ownOrOutside(model)) return [];
      const K = monaco.languages.SymbolKind;
      return asmNames(model.getValue(), langOf(model)).filter(n => n.def).map(n => {
        const range = new monaco.Range(n.line, n.col, n.line, n.col + n.name.length), a = asmContext.names.get(n.name);
        return { name: n.name, detail: a != null ? `$${h4(a)}` : '', kind: n.how === 'value' ? K.Constant : n.how === 'macro' ? K.Function : K.Field, tags: [], range, selectionRange: range };
      });
    },
  });
  for (const lang of [KICKASS, TASS64]) monaco.languages.registerDefinitionProvider(lang, {
    provideDefinition(model, pos) {
      const w = model.getWordAtPosition(pos); if (!w) return null;
      // `name:`; in 64tass the name first on its line, indented too (`loop lda #1`, `  x = 5`, `name .macro`), that is
      // not a mnemonic or a call, as asmNames finds it
      const word = w.word.replace(/[^\w]/g, '');
      // the Assembler's (spec 10.7): also in the folder's other sources and the files imported from outside it, the
      // file shown first (Kick Assembler's labels may be indented there, constants are `.label`, `.const` or `.var`
      // lines, and macros, functions and pseudo commands are named after their directive)
      const asm = ownOrOutside(model);
      const kick = new RegExp(asm ? `^\\s*(?:${word}:|\\.(?:label|const|var)\\s+${word}\\s*=|\\.(?:macro|function|pseudocommand)\\s+${word}\\b)` : `^${word}:`, 'm');
      const defIn = (x: Monaco.editor.ITextModel): Monaco.IPosition | null => {
        if (lang === TASS64) { const n = asmNames(x.getValue(), '64tass').find(a => a.def && a.name === word); return n ? { lineNumber: n.line, column: n.col } : null; }
        const m = kick.exec(x.getValue());
        return m ? x.getPositionAt(m.index + m[0].indexOf(word)) : null;
      };
      for (const x of asm ? [model, ...monaco.editor.getModels().filter(o => o !== model && ownOrOutside(o))] : [model]) {
        const p = defIn(x); if (!p) continue;
        return { uri: x.uri, range: new monaco.Range(p.lineNumber, p.column, p.lineNumber, p.column + word.length) };
      }
      return null;
    },
  });
}
