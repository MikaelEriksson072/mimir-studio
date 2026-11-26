/* =====================================================================
 * The names of an Assembler project's sources (spec 10.7): where a name is written in a source, and where it is
 * defined, for the editor's references (Shift+F12), rename (F2) and outline (Ctrl+Shift+O). A name is a word of the
 * code: not in a comment (`//`, `/* *\/` in Kick Assembler, `;` and `.comment` … `.endc` in 64tass) or a string, not a
 * number's digits ($c000, %0101), not a member or a directive after a dot (music.init, .byte), not a local label of
 * Kick Assembler's (!loop). It is defined where it is a label (`name:`; in 64tass a name first on its line, indented
 * too, that is not a mnemonic or a call) or
 * given a value (`.label`, `.const`, `.var` in Kick Assembler; `name = value` in 64tass).
 * ===================================================================== */
import type { ScriptLang } from './types';
import { OPC } from './cpu/opcodes';
import { langIs } from './code-lang';
import { TASS_ALL_MNEMONICS } from './verify/tass-cpu';

/** a name written in a source: its line and column (from 1), and whether it is defined there */
export interface AsmNameAt { name: string; line: number; col: number; def: boolean; how?: 'label' | 'value' | 'macro' }

const WORD = /[A-Za-z_]/, WORDS = /\w/;

/** every name written in `text` (a source of `lang`), in the order they are written */
export function asmNames(text: string, lang: ScriptLang): AsmNameAt[] {
  const tass = langIs(lang) === '64tass';
  const out: AsmNameAt[] = [];
  const lines = text.split('\n');
  let block = false, tassComment = false;
  // (64tass: the macros the source defines, which `.name` calls, and the functions: the name alone first on a line calls
  // them too)
  const defined = (re: RegExp) => new Set(tass ? lines.map(l => l.match(re)?.[1]).filter((n): n is string => !!n) : []);
  const macroSet = defined(/^\s*([A-Za-z_]\w*):?\s+\.(?:macro|segment)\b/), callSet = defined(/^\s*([A-Za-z_]\w*):?\s+\.(?:macro|segment|function|sfunction)\b/);
  lines.forEach((raw, li) => {
    const s = raw.replace(/\r$/, '');
    if (tass) {
      if (tassComment) { if (/^\s*\.endc\b/i.test(s)) tassComment = false; return; }
      if (/^\s*\.comment\b/i.test(s)) { tassComment = true; return; }
    }
    let q = '';
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (block) { if (c === '*' && s[i + 1] === '/') { block = false; i++; } continue; }
      if (q) { if (c === '\\') i++; else if (c === q) q = ''; continue; }
      if (c === '"' || (c === '\'' && s[i + 2] === '\'')) { q = c; continue; }
      if (tass ? c === ';' : c === '/' && s[i + 1] === '/') break;
      if (!tass && c === '/' && s[i + 1] === '*') { block = true; i++; continue; }
      if (!WORD.test(c)) continue;
      let j = i + 1;
      while (j < s.length && WORDS.test(s[j])) j++;
      const name = s.slice(i, j), before = i > 0 ? s[i - 1] : '';
      // (a number's digits, a member or a directive, a local label, a register after a comma: not names)
      // (64tass: `.name` first on a line where a name is a macro's is its call, as `#name` is)
      const call = tass && before === '.' && /^\s*(?:[A-Za-z_]\w*:?\s+)?$/.test(s.slice(0, i - 1)) && macroSet.has(name);
      const skip = !call && (before === '$' || before === '%' || before === '.' || before === '!' || before === '@' || /\d/.test(before) || (/^0x/i.test(s.slice(i - 1, i + 1))));
      if (!skip) {
        const lead = s.slice(0, i), rest = s.slice(j);
        let def = false, how: AsmNameAt['how'];
        if (tass) {
          // the first word on its line, at its start or after white space (64tass takes `  loop lda #1` as it takes
          // `loop lda #1`): a value, a macro's or a function's name, else a label; not an instruction's mnemonic (of any
          // processor), a macro's or a function's call without its #, nor a variable changed (`n += 1`)
          if (/^\s*$/.test(lead)) {
            if (/^\s*:?=(?!=)/.test(rest)) { def = true; how = 'value'; }
            else if (/^:?\s*\.(macro|segment|function|sfunction)\b/.test(rest)) { def = true; how = 'macro'; }
            else if (/^:(?!=)/.test(rest) || (/^(\s|$)/.test(rest) && !/^\s*((::|[-+*/%|&^]|<<|>>)=)/.test(rest) && !TASS_ALL_MNEMONICS.has(name.toLowerCase()) && !callSet.has(name))) {
              def = true; how = 'label';
            }
          }
        } else if (/^\s*$/.test(lead) && /^\s*:(?![:=])/.test(rest)) { def = true; how = 'label'; }
        else if (/^\s*\.(label|const|var)\s+$/.test(lead) && /^\s*=/.test(rest)) { def = true; how = 'value'; }
        else if (/^\s*\.(macro|function|pseudocommand)\s+$/.test(lead)) { def = true; how = 'macro'; }
        out.push({ name, line: li + 1, col: i + 1, def, ...(how ? { how } : {}) });
      }
      i = j - 1;
    }
  });
  return out;
}

/** where `name` is written in `text` */
export const asmNameRefs = (text: string, lang: ScriptLang, name: string): AsmNameAt[] => asmNames(text, lang).filter(n => n.name === name);

const MNEMONICS = new Set(OPC.map(o => o.mn.toLowerCase()));
/** Why `to` cannot be a name's new name (null: it can): a name both assemblers take, not a mnemonic or a register, not
 *  one the sources have already (`used`). */
export function asmRenameProblem(to: string, used: (n: string) => boolean): string | null {
  if (!/^[A-Za-z_]\w*$/.test(to)) return `${to || 'An empty name'} is not a name: letters, digits and _, not a digit first`;
  if (MNEMONICS.has(to.toLowerCase())) return `${to} is an instruction`;
  if (/^[axy]$/i.test(to)) return `${to} is a register`;
  if (used(to)) return `The sources have a ${to} already`;
  return null;
}
