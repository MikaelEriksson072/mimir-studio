/* Hover (registers, labels, opcodes) and go-to-definition (Ctrl+click, F12) for Kick sources. */
import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api';
import { driveSymbol, findBlock, h4, kindInfo, OPC, SYM, undocumentedText, type AnalysisResult, type RenderResult, type ScriptPad } from '@mimir/core';
import { KICKASS } from './kickass-language';

/** The analysis shown in the editor; SourceView keeps it current. */
export const monacoContext: { A: AnalysisResult | null; R: RenderResult | null } = { A: null, R: null };

/** The script shown in the Scripts tab (models of the `script:` scheme): the names its code may use, its scratchpads,
 *  the names of its links (UserScript.links) and what kind of block each of the program's labels is on. */
export const scriptContext: { names: ReadonlyMap<string, number>; pads: readonly ScriptPad[]; links: ReadonlySet<string>; kinds: ReadonlyMap<string, string> } = { names: new Map(), pads: [], links: new Set(), kinds: new Map() };

/** what a script's code may write besides names: Kick Assembler's directives and functions */
const SCRIPT_WORDS = ['.byte', '.word', '.text', '.fill', '.const', '.var', '.label', '.eval', '.for', '.while', '.if', 'else', '.print', '.error', '.encoding', '.align', '.pseudopc',
  'round', 'floor', 'ceil', 'abs', 'min', 'max', 'mod', 'pow', 'sqrt', 'sin', 'cos', 'tan', 'toRadians', 'toDegrees', 'toIntString', 'toHexString', 'toBinaryString', 'PI', 'true', 'false'];

/** the hardware's names (the include file's): they come after the program's own */
let HW: Set<string> | null = null;
const isHardware = (n: string) => (HW ??= new Set([...[...SYM.exact.values()].map(s => s.name), ...SYM.regions.map(r => r.name)])).has(n);

/** the start of a line up to where an instruction's mnemonic goes: nothing, or a label (`loop:`, `!:`) */
const AT_MNEMONIC = /^\s*(?:(?:![A-Za-z_]\w*|!|[A-Za-z_]\w*)\s*:\s*)?$/;
/** an instruction's operand after a comma: `,x` or `,y` (the index register), never a name */
const AT_INDEX = /^\s*(?:(?:![A-Za-z_]\w*|!|[A-Za-z_]\w*)\s*:\s*)?[A-Za-z]{3}(?:\.[A-Za-z]+)?\s+[^/]*,\s*$/;

export interface ScriptSuggestion { label: string; kind: 'link' | 'pad' | 'name' | 'hardware' | 'mnemonic' | 'word'; detail?: string }

/**
 * What a script's code may write where the cursor is. First on a line the mnemonics and directives that start with
 * what is typed; in an operand the names: the script's links first, then its scratchpads, the program's labels and
 * variables, the hardware's names and the functions, each that starts with what is typed or, from two letters on, has
 * a part (after a `_`) that does (`tab` finds my_table); with nothing typed (Ctrl+Space) all of them. After a name and
 * a dot the rest of the names that start so (`music.` → `.location`, `.init`, `.play`, `.size`). After an
 * instruction's comma nothing (the index register: `x` is not SID_POT_X), nor in a comment.
 */
export function scriptSuggestions(before: string, typed: string, names: ReadonlyMap<string, number>, pads: readonly Pick<ScriptPad, 'name'>[], more: { links?: ReadonlySet<string>; kinds?: ReadonlyMap<string, string> } = {}): ScriptSuggestion[] {
  if (/\/\//.test(before) || AT_INDEX.test(before)) return [];
  const dot = before.endsWith('.');
  const t = (dot ? '.' : '') + typed.toLowerCase();
  // a word that starts with what is typed and is more than it (a word typed in full needs no box)
  const starts = (s: string) => { const l = s.toLowerCase(); return l.startsWith(t) && l !== t; };
  // a part of a name after a `_` that starts with what is typed (two letters at least: `x` finds no SID_POT_X)
  const inPart = (s: string) => t.length >= 2 && /^[a-z_]/.test(t) && s.toLowerCase().split('_').slice(1).some(p => p.startsWith(t));
  // a directive where a mnemonic goes (not `music.init` or a number)
  if (dot && AT_MNEMONIC.test(before.slice(0, -1))) return SCRIPT_WORDS.filter(x => x[0] === '.' && starts(x)).map(label => ({ label, kind: 'word' as const }));
  // after a name and its dot the rest of the names that start with them (`music.` → `.location`)
  if (dot) {
    const head = /(?<![\w.$%!])([A-Za-z_]\w*)\.$/.exec(before)?.[1];
    if (!head) return [];
    return [...names].filter(([n]) => n.startsWith(`${head}.`) && starts(n.slice(head.length)))
      .map(([n, a]) => ({ label: n.slice(head.length), kind: 'name' as const, detail: `$${h4(a)} · ${more.kinds?.get(n) ?? 'label'}` }));
  }
  if (AT_MNEMONIC.test(before)) return typed ? [...new Set(OPC.filter(o => !o.ill).map(o => o.mn.toLowerCase()))].filter(starts).map(label => ({ label, kind: 'mnemonic' as const })) : [];
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
  for (const x of SCRIPT_WORDS) if (x[0] !== '.' && fits(x)) out.push({ label: x, kind: 'word' });
  return out;
}

/** the name with a dot in it (`music.location`) that the character at `at` of a line is in, or null */
export function dottedNameAt(line: string, at: number): string | null {
  for (const m of line.matchAll(/(?<![\w$%!])[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)+/g)) if (at >= m.index! && at < m.index! + m[0].length) return m[0];
  return null;
}

export function registerProviders(monaco: typeof Monaco): void {
  // a script's code: what fits where the cursor is (scriptSuggestions); Tab takes one, Enter always ends the line
  monaco.languages.registerCompletionItemProvider(KICKASS, {
    triggerCharacters: ['.'],
    provideCompletionItems(model, pos) {
      if (model.uri.scheme !== 'script') return { suggestions: [] };
      const w = model.getWordUntilPosition(pos), line = model.getLineContent(pos.lineNumber);
      const before = line.slice(0, w.startColumn - 1), dot = before.endsWith('.');
      const range = new monaco.Range(pos.lineNumber, w.startColumn - (dot ? 1 : 0), pos.lineNumber, w.endColumn);
      const K = monaco.languages.CompletionItemKind;
      const kind = { link: K.Reference, pad: K.Struct, name: K.Variable, hardware: K.Constant, mnemonic: K.Keyword, word: K.Function } as const;
      const order = { link: '0', pad: '1', name: '2', hardware: '3', mnemonic: '4', word: '5' } as const;
      return { suggestions: scriptSuggestions(before, w.word, scriptContext.names, scriptContext.pads, scriptContext).map(s => ({ label: s.label, kind: kind[s.kind], insertText: s.label, range, sortText: order[s.kind] + s.label, ...(s.detail ? { detail: s.detail } : {}) })) };
    },
  });
  monaco.languages.registerHoverProvider(KICKASS, {
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
      const ops = OPC.filter(o => o.mn.toLowerCase() === name.toLowerCase());
      const op = ops.find(o => !o.ill) ?? ops.find(o => o.kick) ?? ops[0];
      const text = op && op.ill ? undocumentedText(op.op, true) : null;
      if (text) { const [head, ...rest] = text.split('\n'); return { contents: [{ value: `**${head}**` }, { value: rest.join('  \n') }] }; }
      if (op) return { contents: [{ value: `**${op.mn}**` }] };
      return null;
    },
  });
  monaco.languages.registerDefinitionProvider(KICKASS, {
    provideDefinition(model, pos) {
      const w = model.getWordAtPosition(pos); if (!w) return null;
      const m = new RegExp(`^${w.word.replace(/[^\w]/g, '')}:`, 'm').exec(model.getValue()); if (!m) return null;
      const p = model.getPositionAt(m.index);
      return { uri: model.uri, range: new monaco.Range(p.lineNumber, 1, p.lineNumber, w.word.length + 1) };
    },
  });
}
