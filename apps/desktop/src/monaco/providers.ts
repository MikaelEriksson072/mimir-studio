/* Hover (registers, labels, opcodes) and go-to-definition (Ctrl+click, F12) for Kick sources. */
import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api';
import { driveSymbol, findBlock, h4, kindInfo, OPC, SYM, undocumentedText, type AnalysisResult, type RenderResult, type ScriptPad } from '@mimir/core';
import { KICKASS } from './kickass-language';

/** The analysis shown in the editor; SourceView keeps it current. */
export const monacoContext: { A: AnalysisResult | null; R: RenderResult | null } = { A: null, R: null };

/** The script shown in the Scripts tab (models of the `script:` scheme): the names its code may use and its scratchpads. */
export const scriptContext: { names: ReadonlyMap<string, number>; pads: readonly ScriptPad[] } = { names: new Map(), pads: [] };

/** what a script's code may write besides names: Kick Assembler's directives and functions */
const SCRIPT_WORDS = ['.byte', '.word', '.text', '.fill', '.const', '.var', '.label', '.eval', '.for', '.while', '.if', 'else', '.print', '.error', '.encoding', '.align', '.pseudopc',
  'round', 'floor', 'ceil', 'abs', 'min', 'max', 'mod', 'pow', 'sqrt', 'sin', 'cos', 'tan', 'toRadians', 'toDegrees', 'toIntString', 'toHexString', 'toBinaryString', 'PI', 'true', 'false'];

/** the start of a line up to where an instruction's mnemonic goes: nothing, or a label (`loop:`, `!:`) */
const AT_MNEMONIC = /^\s*(?:(?:![A-Za-z_]\w*|!|[A-Za-z_]\w*)\s*:\s*)?$/;
/** an instruction's operand after a comma: `,x` or `,y` (the index register), never a name */
const AT_INDEX = /^\s*(?:(?:![A-Za-z_]\w*|!|[A-Za-z_]\w*)\s*:\s*)?[A-Za-z]{3}(?:\.[A-Za-z]+)?\s+[^/]*,\s*$/;

/**
 * What a script's code may write where the cursor is, among the words that start with what is typed (not words that
 * merely hold its letters, so `x` after `lda table,` is not SID_POT_X): first on a line the mnemonics and directives,
 * in an operand the program's labels and variables, the hardware names, the scratchpads and the functions; after
 * an instruction's comma nothing (the index register).
 */
export function scriptSuggestions(before: string, typed: string, names: ReadonlyMap<string, number>, pads: readonly Pick<ScriptPad, 'name'>[]): { label: string; kind: 'pad' | 'name' | 'mnemonic' | 'word'; detail?: string }[] {
  if (/\/\//.test(before) || AT_INDEX.test(before)) return [];
  const dot = before.endsWith('.');
  // a word that starts with what is typed and is more than it (a word typed in full needs no box)
  const starts = (s: string) => { const t = (dot ? '.' : '') + typed.toLowerCase(), l = s.toLowerCase(); return l.startsWith(t) && l !== t; };
  // a directive where a mnemonic goes (not `music.init` or a number)
  if (dot) return AT_MNEMONIC.test(before.slice(0, -1)) ? SCRIPT_WORDS.filter(x => x[0] === '.' && starts(x)).map(label => ({ label, kind: 'word' as const })) : [];
  if (!typed) return [];
  if (AT_MNEMONIC.test(before)) return [...new Set(OPC.filter(o => !o.ill).map(o => o.mn.toLowerCase()))].filter(starts).map(label => ({ label, kind: 'mnemonic' as const }));
  const own = new Set(pads.flatMap(p => [p.name, `${p.name}_end`]));
  const out: { label: string; kind: 'pad' | 'name' | 'mnemonic' | 'word'; detail?: string }[] = [];
  for (const [n, a] of names) if (starts(n)) out.push({ label: n, kind: own.has(n) ? 'pad' : 'name', detail: `$${h4(a)}${own.has(n) ? ' · scratchpad' : ''}` });
  for (const x of SCRIPT_WORDS) if (x[0] !== '.' && starts(x)) out.push({ label: x, kind: 'word' });
  return out;
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
      const kind = { pad: K.Struct, name: K.Variable, mnemonic: K.Keyword, word: K.Function } as const;
      const order = { pad: '0', name: '1', mnemonic: '2', word: '3' } as const;
      return { suggestions: scriptSuggestions(before, w.word, scriptContext.names, scriptContext.pads).map(s => ({ label: s.label, kind: kind[s.kind], insertText: s.label, range, sortText: order[s.kind] + s.label, ...(s.detail ? { detail: s.detail } : {}) })) };
    },
  });
  monaco.languages.registerHoverProvider(KICKASS, {
    provideHover(model, pos) {
      const w = model.getWordAtPosition(pos); if (!w) return null;
      const name = w.word;
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
      if (R && A && !drive) for (const [a, l] of R.labels) if (l.name === name) {
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
