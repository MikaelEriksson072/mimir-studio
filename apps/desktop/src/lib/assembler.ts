/* The assembler the project's source is written for (Settings.assembler, spec 11.8), for the parts of the window that
 * write a line as the source does: the listing's lines, find, the cycle counter. App provides it. */
import { createContext, useContext } from 'react';
import { ASSEMBLERS, forcedMnemonic, type AssemblerId, type ForcedMode } from '@mimir/core';

export const AssemblerContext = createContext<AssemblerId>('kick');
export const useAssembler = (): AssemblerId => useContext(AssemblerContext);

/** a line comment's start: `//` or `;` */
export const commentStart = (asm: AssemblerId): string => ASSEMBLERS[asm].comment;

/** the directives the window's texts name, as the project's assembler writes them */
export const asmWords = (asm: AssemblerId) => (asm === '64tass'
  ? { binary: '.binary', pseudopc: '.logical', pseudopcBlock: '.logical … .here', if: '.if', else: '.else' }
  : { binary: '.import binary', pseudopc: '.pseudopc', pseudopcBlock: '.pseudopc { }', if: '#if', else: '#else' });

/** an instruction's mnemonic with its forced addressing as the source writes it: `lda.abs`, or `lda` with `@w ` before
 *  the operand (64tass) */
export const insHead = (mn: string, ext: ForcedMode, asm: AssemblerId): { mn: string; pre: string } => forcedMnemonic(mn, ext, asm);
