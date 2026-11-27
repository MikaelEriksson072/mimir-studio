/* The Assembler projects the export tests take (asm-export.test.ts, asm-export.integration.test.ts): Kick Assembler
 * with #import, #importonce and data a library loads, 64tass with .include and .binclude. */
import type { Vfs } from '../src/types';

export const SPRITE = Uint8Array.from({ length: 63 }, (_, i) => (i * 7) & 0xff);
export const KICK: Vfs = {
  'main.asm': [
    'BasicUpstart2(start)',
    '#import "lib/macros.asm"',
    '#import "lib/macros.asm"',
    'start:  ldx #0',
    'loop:   lda text,x',
    '        beq done',
    '        jsr $ffd2',
    '        inx',
    '        bne loop',
    'done:   Border(2)',
    '        rts',
    'text:   .text "HI"',
    '        .byte 0',
    '* = $2000 "data"',
    '#import "lib/data.asm"',
    '',
  ].join('\n'),
  'lib/macros.asm': '#importonce\n.const BORDER = $d020\n.macro Border(c) {\n    lda #c\n    sta BORDER\n}\n',
  'lib/data.asm': '/* #import "nothing.asm" */\nsprite: .import binary "sprite.bin"\n',
  'lib/sprite.bin': SPRITE,
};
export const TASS: Vfs = {
  'main.asm': [
    '        * = $0801',
    '        .word (+), 2026',
    '        .null $9e, format("%4d", start)',
    '+       .word 0',
    'start   ldx #0',
    '        .include "lib/print.asm"',
    '        lda gfx.logo',
    '        rts',
    'gfx     .binclude "lib/gfx.asm"',
    '',
  ].join('\n'),
  'lib/print.asm': '        lda #1\n        sta $d020\n',
  'lib/gfx.asm': 'logo    .binary "logo.bin"\n',
  'lib/logo.bin': Uint8Array.of(1, 2, 3),
};
