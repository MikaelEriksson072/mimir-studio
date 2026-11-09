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

export function registerProviders(monaco: typeof Monaco): void {
  // a script's code: the program's labels and variables, the hardware names, the scratchpads, mnemonics and directives
  monaco.languages.registerCompletionItemProvider(KICKASS, {
    triggerCharacters: ['.'],
    provideCompletionItems(model, pos) {
      if (model.uri.scheme !== 'script') return { suggestions: [] };
      const w = model.getWordUntilPosition(pos), line = model.getLineContent(pos.lineNumber);
      const dot = line[w.startColumn - 2] === '.';
      const range = new monaco.Range(pos.lineNumber, w.startColumn - (dot ? 1 : 0), pos.lineNumber, w.endColumn);
      const K = monaco.languages.CompletionItemKind;
      if (dot) return { suggestions: SCRIPT_WORDS.filter(x => x[0] === '.').map(x => ({ label: x, kind: K.Keyword, insertText: x, range })) };
      const pads = new Set(scriptContext.pads.flatMap(p => [p.name, `${p.name}_end`]));
      const out: Monaco.languages.CompletionItem[] = [];
      for (const [n, a] of scriptContext.names) out.push({ label: n, kind: pads.has(n) ? K.Struct : K.Variable, detail: `$${h4(a)}${pads.has(n) ? ' · scratchpad' : ''}`, insertText: n, range, sortText: (pads.has(n) ? '0' : '1') + n });
      for (const m of new Set(OPC.filter(o => !o.ill).map(o => o.mn.toLowerCase()))) out.push({ label: m, kind: K.Keyword, insertText: m, range, sortText: '2' + m });
      for (const x of SCRIPT_WORDS.filter(x => x[0] !== '.')) out.push({ label: x, kind: K.Function, insertText: x, range, sortText: '3' + x });
      return { suggestions: out };
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
