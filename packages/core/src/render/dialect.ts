/* =====================================================================
 * The assemblers the source can be written for (Settings.assembler, spec 11.8): Kick Assembler 5.x and 64tass.
 * The renderer builds one line model for both; what differs is how a line is spelled: the directives, the comments,
 * the forced addressing, the names of the undocumented opcodes, the encodings. Everything 64tass is written for
 * 64tass 1.57 run with -a (ASCII sources: the PETSCII encodings) and -C (case-sensitive names), as Mimir builds it.
 * ===================================================================== */
import type { AssemblerId, ForcedMode, Line, Settings, Token } from '../types';
import type { OpcodeInfo } from '../cpu/opcodes';
import { ENC, TASS_ENC, tassName } from '../cpu/opcodes';

export type { AssemblerId };

/** the assembler of a project's settings (old project files have none: Kick Assembler) */
export const assemblerOf = (S: Partial<Pick<Settings, 'assembler'>> | undefined): AssemblerId => (S?.assembler === '64tass' ? '64tass' : 'kick');
export const isTass = (S: Partial<Pick<Settings, 'assembler'>> | undefined): boolean => assemblerOf(S) === '64tass';

export interface AssemblerInfo {
  id: AssemblerId;
  /** its name in the UI */
  name: string;
  /** the version the source is written for, in the source's head */
  title: string;
  /** a comment to the end of the line */
  comment: string;
}

export const ASSEMBLERS: Readonly<Record<AssemblerId, AssemblerInfo>> = {
  kick: { id: 'kick', name: 'Kick Assembler', title: 'Kick Assembler 5.x', comment: '//' },
  '64tass': { id: '64tass', name: '64tass', title: '64tass 1.57 (-a -C)', comment: ';' },
};

/** the arguments Mimir always gives 64tass besides the source, the output and the label file: ASCII sources (the
 *  PETSCII encodings, -a), case-sensitive names (-C) and a PRG with its load address */
export const TASS_FIXED_ARGS = ['-a', '-C', '--cbm-prg'] as const;

/** A mnemonic as the assembler writes it: always lower case (Kick Assembler 5.25 rejects upper-case ones, and 64tass
 *  with -C), with 64tass's names for the undocumented opcodes whose names differ (isb, asr, sbx, ane, sha, shs, lds) */
export const asmMnemonic = (mn: string, asm: AssemblerId = 'kick'): string => (asm === '64tass' ? tassName(mn) : mn).toLowerCase();

/** the assembler writes the opcode by its mnemonic and gives that byte back (otherwise the source has it as .byte) */
export const writesOpcode = (o: OpcodeInfo, asm: AssemblerId = 'kick'): boolean => (asm === '64tass' ? o.tass : o.kick);

/** An instruction's mnemonic with its forced addressing: Kick's suffix (`lda.abs $0002`, `lda.zp label`) or 64tass's
 *  operator before the operand (`lda @w $0002`). 64tass picks the zero page itself for a label below $100, defined
 *  before or after (it goes on with passes until the sizes settle), so `.zp` needs nothing there. */
export function forcedMnemonic(mn: string, ext: ForcedMode, asm: AssemblerId = 'kick'): { mn: string; pre: string } {
  if (asm !== '64tass') return { mn: asmMnemonic(mn, asm) + ext, pre: '' };
  return { mn: asmMnemonic(mn, asm), pre: ext === '.abs' ? '@w ' : '' };
}

/** 64tass's builtin functions and constants a label must not hide: the generated source calls them (binary, len,
 *  format) and its flags are true or false */
const TASS_TAKEN = new Set(['true', 'false', 'binary', 'len', 'format', 'size']);

/** A name the assembler takes as a label of the whole source: Kick Assembler's rules (validLabel), and for 64tass
 *  also not one of its mnemonics, not one of the names TASS_TAKEN has, and not starting with `_` (a label that is
 *  local to the label before it in 64tass, measured: `jmp _loc` after another label is "not defined") */
export function labelFor(asm: AssemblerId, name: string, valid: (n: string) => boolean): boolean {
  if (!valid(name)) return false;
  if (asm !== '64tass') return true;
  return !name.startsWith('_') && !TASS_ENC[name.toUpperCase()] && !TASS_TAKEN.has(name);
}

/** whether a mnemonic (any case) is one of the assembler's */
export const isMnemonic = (name: string, asm: AssemblerId = 'kick'): boolean => !!(asm === '64tass' ? TASS_ENC : ENC)[name.toUpperCase()];

/**
 * The assembler a source of the user's is likely written for (Pack a file, Smart attach: a source picked on disk, with
 * no project to say): Kick Assembler's `//` comments, `#import`, `.pc =`, `.label`, `.var`, `BasicUpstart2`,
 * `.pseudopc`, `.import binary`, `!label:` against 64tass's `;` comments, `* =`, `.include`, `.binary`, `.logical`,
 * `.here`, `.enc`, `.null`, `.cpu`, `.block`, `.endm`. A tie is Kick Assembler.
 */
export function guessAssembler(text: string): AssemblerId {
  let kick = 0, tass = 0;
  for (const raw of text.split(/\r?\n/).slice(0, 2000)) {
    const line = raw.trim();
    if (!line) continue;
    if (/^\/\/|^\/\*/.test(line)) kick++;
    else if (/^;/.test(line)) tass++;
    if (/^#(import|importonce|define|if)\b|^\.(pc|label|var|const|pseudopc|encoding|namespace|segment|segmentdef|file|eval|macro\s+\w+\s*\()\b|BasicUpstart2?\s*\(|\.import\s+(binary|source|c64)|^![\w]*:|\bLoadSid\s*\(/.test(line)) kick += 2;
    if (/^\*\s*=|^\.(include|binary|logical|here|enc|null|cpu|block|bend|proc|pend|endm|endmacro|next|rept|endrept|comment|endc|cerror|weak|endweak|endif|elsif|offs|ptext)\b|^[A-Za-z_]\w*\s+\.(macro|block|proc|segment|namespace|logical)\b/.test(line)) tass += 2;
    if (/\s;\s?\S/.test(raw) && !/"[^"]*;[^"]*"/.test(raw)) tass++;
    if (/\s\/\/\s?\S/.test(raw) && !/"[^"]*\/\/[^"]*"/.test(raw)) kick++;
  }
  return tass > kick ? '64tass' : 'kick';
}

/* ---------- the lines that differ ---------- */

const p = (s: string): Token => ({ t: 'p', s });
const dir = (s: string): Token => ({ t: 'dir', s });

/** `.pc = $0810 "Code"` or `* = $0810` (64tass has no segment names there) */
export const pcTokens = (asm: AssemblerId, at: Token[], name: string): Token[] =>
  asm === '64tass' ? [dir('*'), p(' = '), ...at] : [dir('.pc'), p(' = '), ...at, p(' '), { t: 'str', s: `"${name}"` }];

/** the line that puts the bytes after it at an address: Kick's `.pc = $0810 "Code"`, 64tass's `* = $0810 ; Code` (the
 *  name as its comment, which the built-in 64tass assembler takes for its memory map) */
export const pcLine = (asm: AssemblerId, a: number, at: Token[], name: string): Line =>
  ({ k: 'dir', a, n: 0, tok: pcTokens(asm, at, name), ...(asm === '64tass' ? { cmt: name } : {}) });

/** `.label name = $fb` or `name = $fb` */
export const defineTokens = (asm: AssemblerId, name: Token, value: Token[]): Token[] =>
  asm === '64tass' ? [name, p(' = '), ...value] : [dir('.label'), p(' '), name, p(' = '), ...value];

/** `.import binary "gfx/charset_3000.bin"` or `.binary "…"` */
export const binaryTokens = (asm: AssemblerId, path: string): Token[] =>
  [dir(asm === '64tass' ? '.binary' : '.import binary'), p(' '), { t: 'str', s: `"${path}"` }];

/** `#import "include/c64-hardware.asm"` or `.include "…"` */
export const includeTokens = (asm: AssemblerId, path: string): Token[] =>
  [dir(asm === '64tass' ? '.include' : '#import'), p(' '), { t: 'str', s: `"${path}"` }];

/** a relocated block's start: `.pseudopc $c000 {` or `.logical $c000` */
export const logicalTokens = (asm: AssemblerId, at: Token): Token[] =>
  asm === '64tass' ? [dir('.logical'), p(' '), at] : [dir('.pseudopc'), p(' '), at, p(' {')];
/** and its end: `}` or `.here` */
export const logicalEndTokens = (asm: AssemblerId): Token[] => [dir(asm === '64tass' ? '.here' : '}')];

/** a block left out of the build: `#if INCLUDE_x` / `#else` / `#endif`, or `.if INCLUDE_x` / `.else` / `.endif` */
export const ifTokens = (asm: AssemblerId, name: string): Token[] => [dir(asm === '64tass' ? '.if' : '#if'), p(' '), { t: 'def', s: name }];
export const elseTokens = (asm: AssemblerId): Token[] => [dir(asm === '64tass' ? '.else' : '#else')];
export const endifTokens = (asm: AssemblerId): Token[] => [dir(asm === '64tass' ? '.endif' : '#endif')];

/** the start and end lines of a block comment: `/*` `*\/`, or 64tass's `.comment` `.endc` */
export const blockComment = (asm: AssemblerId): [string, string] => (asm === '64tass' ? ['.comment', '.endc'] : ['/*', '*/']);
/** a line of text inside a block comment, kept from ending it early: Kick's `*\/` broken up, and in 64tass a line
 *  that starts with `.endc` or `.endcomment` (any case) given a `;` before it */
export const inBlockComment = (asm: AssemblerId, text: string): string =>
  asm === '64tass' ? (/^\s*\.endc(omment)?\b/i.test(text) ? `;${text}` : text) : text.replace(/\*\//g, '* /');

/** a line that defines a label as an address: Kick's `.label name = $fb`, 64tass's `name = $fb` (not a namespace's
 *  `music .namespace`, a flag's `INCLUDE_x = false` is one too: the callers look the name up among the labels) */
export const isLabelDefinition = (l: { k: string; tok?: Token[] }): boolean =>
  l.k === 'dir' && !!l.tok && (l.tok[0]?.s === '.label' || (l.tok[0]?.t === 'def' && l.tok[1]?.t === 'p' && l.tok[1].s === ' = '));

/** Directives written at column 0 (everything else is indented): Kick Assembler's (a cartridge's banks in one source,
 *  13.9c, add the segments, the image's file and each bank's namespace, and a relocated block its `.pseudopc`, 8.1b),
 *  and 64tass's (`*`, its `.include`, `.cpu`, `.logical`, `.here`, the conditions and the music's `.namespace`) */
export const TOP_LEVEL_DIRECTIVES = ['#import', '#define', '#if', '#else', '#endif', '.label', '.const', '.var', '.pc', '.pseudopc', 'BasicUpstart2', '.file', '.segmentdef', '.segment', '.namespace', '}',
  '*', '.include', '.cpu', '.logical', '.here', '.if', '.else', '.endif', '.endnamespace'];
