/* Monarch definition for 64tass (spec 14.3, 11.8): `;` comments and `.comment` … `.endc`, its directives, label
 * definitions (`name:`, `name = value` first on a line, indented too, the anonymous `+` and `-`), documented and undocumented
 * mnemonics by 64tass's names (isb, asr, sbx …), the 65C02's and 65816's, `@w`/`@b`/`@l`, its functions, hardware symbols, numbers, strings. */
import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api';
import { OPC, SYM, TASS_CPU_MNEMONICS, TASS_NAMES } from '@mimir/core';

export const TASS64 = 'tass64';

/** an opcode's mnemonic as 64tass names it, lower case */
const tassMn = (mn: string) => (TASS_NAMES[mn] ?? mn).toLowerCase();

const DIRECTIVES = ['addr', 'al', 'align', 'as', 'assert', 'autsiz', 'bend', 'binary', 'binclude', 'bfor', 'block', 'break', 'breakif', 'brept', 'bwhile', 'byte', 'case', 'cdef', 'cerror',
  'char', 'check', 'comment', 'continue', 'continueif', 'cpu', 'cwarn', 'databank', 'default', 'dint', 'dpage', 'dsection', 'dstruct', 'dunion', 'dword', 'edef', 'else', 'elsif', 'enc',
  'encode', 'end', 'endblock', 'endc', 'endcomment', 'endencode', 'endf', 'endfor', 'endfunction', 'endif', 'endlogical', 'endm', 'endmacro', 'endn', 'endnamespace', 'endp', 'endpage',
  'endproc', 'endrept', 'ends', 'endsection', 'endsegment', 'endstruct', 'endswitch', 'endu', 'endunion', 'endv', 'endvirtual', 'endweak', 'endwhile', 'endwith', 'eor', 'error', 'fi',
  'fill', 'for', 'function', 'goto', 'here', 'hidemac', 'if', 'ifeq', 'ifmi', 'ifne', 'ifpl', 'include', 'lbl', 'lint', 'logical', 'long', 'macro', 'mansiz', 'namespace', 'next', 'null',
  'offs', 'option', 'page', 'pend', 'proc', 'proff', 'pron', 'ptext', 'rept', 'rta', 'section', 'seed', 'segment', 'send', 'sfunction', 'shift', 'shiftl', 'showmac', 'sint', 'struct',
  'switch', 'tdef', 'text', 'union', 'var', 'virtual', 'warn', 'weak', 'while', 'with', 'word', 'xl', 'xs'];
const FUNCTIONS = ['abs', 'acos', 'all', 'any', 'asin', 'atan', 'atan2', 'binary', 'byte', 'cbrt', 'ceil', 'char', 'cos', 'cosh', 'deg', 'exp', 'floor', 'format', 'frac', 'hypot', 'len',
  'log', 'log10', 'pow', 'rad', 'random', 'range', 'repr', 'round', 'sign', 'sin', 'sinh', 'size', 'sort', 'sqrt', 'tan', 'tanh', 'trunc', 'true', 'false', 'int', 'bits', 'bytes', 'str', 'bool', 'list', 'tuple'];

export function register64tass(monaco: typeof Monaco): void {
  // (the 65C02's and the 65816's too, with 64tass's aliases: .cpu "65816")
  const mnemonics = [...new Set([...OPC.filter(o => o.tass && !o.ill).map(o => tassMn(o.mn)), ...TASS_CPU_MNEMONICS])];
  const illegals = [...new Set(OPC.filter(o => o.tass && o.ill).map(o => tassMn(o.mn)))].filter(m => !mnemonics.includes(m));
  const hw = [...SYM.exact.values()].map(s => s.name).concat(SYM.regions.map(r => r.name));
  monaco.languages.register({ id: TASS64, aliases: ['64tass'] });
  monaco.languages.setLanguageConfiguration(TASS64, { comments: { lineComment: ';' }, brackets: [['(', ')'], ['[', ']']] });
  monaco.languages.setMonarchTokensProvider(TASS64, {
    ignoreCase: false, mnemonics, illegals, hw, functions: FUNCTIONS,
    directives: DIRECTIVES.map(d => `.${d}`),
    tokenizer: {
      root: [
        [/;.*$/, 'comment'],
        [/^\s*\.comment\b.*$/, 'comment', '@comment'],
        // first on a line, at its start or after white space (64tass takes `  loop lda #1` so): a label (`name:`, `name`
        // before `=`, `.namespace`, an instruction), or `+` / `-`; a mnemonic there is the instruction
        [/^[+-](?=\s|$)/, 'label.def'],
        [/^[a-zA-Z_]\w*:/, 'label.def'],
        [/^[a-zA-Z_]\w*(?=\s|$|=|;)/, { cases: { '@illegals': 'keyword.illegal', '@mnemonics': 'keyword.mnemonic', '@default': 'label.def' } }],
        [/^(\s+)([+-])(?=\s|$)/, ['', 'label.def']],
        [/^(\s+)([a-zA-Z_]\w*:)/, ['', 'label.def']],
        [/^(\s+)([a-zA-Z_]\w*)(?=\s|$|=|;)/, ['', { cases: { '@illegals': 'keyword.illegal', '@mnemonics': 'keyword.mnemonic', '@default': 'label.def' } }]],
        [/\.[a-zA-Z]+\b/, { cases: { '@directives': 'keyword.directive', '@default': 'identifier' } }],
        [/@[wbl]\b/, 'keyword.mnemonic'],
        [/[a-zA-Z_]\w*(\.[a-zA-Z_]\w*)+/, 'variable.member'],
        [/[a-zA-Z_]\w*(?=\s*\()/, { cases: { '@functions': 'keyword.macro', '@default': 'identifier' } }],
        [/[a-zA-Z_]\w*/, { cases: { '@illegals': 'keyword.illegal', '@mnemonics': 'keyword.mnemonic', '@hw': 'type.hardware', '@functions': 'keyword.macro', '@default': 'identifier' } }],
        [/\$[0-9a-fA-F_]+/, 'number.hex'], [/%[01_]+/, 'number.binary'], [/\d[\d_]*/, 'number'],
        [/"([^"]|"")*"/, 'string'],
        [/'([^']|'')*'/, 'string'],
        [/#[<>]?/, 'operator.immediate'], [/\*/, 'operator.pc'], [/[<>+\-/,()=!&|^~?:[\]%]/, 'operator'],
      ],
      comment: [[/^\s*\.endc(omment)?\b.*$/, 'comment', '@pop'], [/.*$/, 'comment']],
    },
  } as Monaco.languages.IMonarchLanguage);
}
