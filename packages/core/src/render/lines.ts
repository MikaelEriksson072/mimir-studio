/* Line model -> assembler text (Kick Assembler or 64tass, Settings.assembler). The listing renders the same tokens
 * interactively. */
import type { ListingLine, Settings, Token } from '../types';
import { h4 } from '../util/hex';
import { ASSEMBLERS, asmMnemonic, assemblerOf, forcedMnemonic, TOP_LEVEL_DIRECTIVES } from './dialect';

export type LineTextSettings = Pick<Settings, 'indent' | 'commentCol' | 'addrComments'> & Partial<Pick<Settings, 'assembler'>>;

export { TOP_LEVEL_DIRECTIVES };

/**
 * Mnemonics are always written in lower case: Kick Assembler 5.25 rejects upper-case ones
 * ("Pseudo command 'SEI' not defined"). `Settings.mnemonicCase` is still read from old
 * project files but no longer changes the output.
 */
export const kickMnemonic = (m: string): string => m.toLowerCase();

export { asmMnemonic };

export function lineText(l: ListingLine, S: LineTextSettings): string {
  const asm = assemblerOf(S);
  const cm = ASSEMBLERS[asm].comment;
  const ind = ' '.repeat(S.indent);
  const tokS = (tk: Token[]) => tk.map(t => t.s).join('');
  const withCmt = (s: string, c: string | undefined) => { if (!c) return s; const pad = Math.max(1, S.commentCol - s.length); return s + ' '.repeat(pad) + cm + ' ' + c; };
  const adr = l.a != null && S.addrComments && (l.k === 'ins' || l.k === 'dat') ? `${'$' + h4(l.a)}` : '';
  const cc = (c: string) => [adr, c].filter(Boolean).join('  ');
  switch (l.k) {
    case 'lbl': return `${l.name}:`;
    case 'ins': { const f = forcedMnemonic(l.mn, l.ext, asm); return withCmt(ind + f.mn + (l.tok.length ? ' ' + f.pre + tokS(l.tok) : ''), cc(l.cmt)); }
    case 'dat': return withCmt(ind + l.dir + ' ' + tokS(l.tok), cc(l.cmt));
    // a directive line that starts with a name defines a label (`chip0:` in a cartridge's source): column 0 too
    case 'dir': return withCmt((l.tok[0] && (TOP_LEVEL_DIRECTIVES.includes(l.tok[0].s) || l.tok[0].t === 'def') ? '' : ind) + tokS(l.tok), l.cmt);
    case 'cmt': return l.raw ? l.text : l.text ? `${cm} ${l.text}` : cm;
    case 'hdr': return `${cm} ${('---- ' + l.text + ' ').padEnd(asm === '64tass' ? 67 : 66, '-')}`;
    case 'file': return `${cm} ===== ${l.text} =====`;
    default: return '';
  }
}

/** a mnemonic as the source writes it (the listing shows the same) */
export const lineMnemonic = (mn: string, S: Partial<Pick<Settings, 'assembler'>> | undefined): string => asmMnemonic(mn, assemblerOf(S));
