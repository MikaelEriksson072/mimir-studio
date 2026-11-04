/* Playing a music block on a C64 (VICE): a PRG that RUN starts, with the block's bytes and a small driver. The
 * driver puts the bytes where the player runs, calls init with the song number in A and then play once a frame, from
 * a raster interrupt, with the time play takes shown as a bar in the border. Keys 1-9 and 0 start songs $00-$09, +
 * and - the next and the one before. It holds exactly the bytes the export's .sid file does, so what plays is what
 * the .sid holds. */
import type { Addr } from '../types';
import { assemble } from '../verify/kick-subset-assembler';
import { makePrg } from './prg';
import { h2, h4 } from '../util/hex';

export interface SidPlayerOptions {
  /** the block's bytes and where they go */
  data: Uint8Array;
  load: Addr;
  init: Addr;
  play: Addr;
  /** the song init gets in A first (0: the first) */
  song?: number;
  /** shown on the screen: the block's label, say */
  title?: string;
}

export interface SidPlayer {
  prg: Uint8Array;
  /** where the driver runs (end excluded) */
  driver: { start: Addr; end: Addr };
  /** the processor port ($01) while the tune plays: $37, $36 with the block under BASIC, $35 under the KERNAL */
  port: number;
  /** the screen shows the addresses and the song (the block is not over it) */
  screen: boolean;
  /** what may not play as on the C64 the program ran on */
  warnings: string[];
}

/** where the block's bytes are in the PRG, before the driver moves them */
export const SID_PLAYER_DATA = 0x0c00;
/** the PRG must stay below the I/O area: what loads there goes to the VIC, SID and CIAs */
const PRG_END = 0xd000;
/** the raster line play is called at */
export const SID_PLAYER_LINE = 0x40;
const SCREEN = 0x0400, SCREEN_END = 0x07e8;
/** the text rows, from the screen's second one */
const TEXT_AT = SCREEN + 40;
/** where the song number is on the screen (two hex digits) */
export const SID_PLAYER_SONG_AT = TEXT_AT + 6 * 40 + 6;

/** the keyboard matrix row (written to $dc00) and column bit ($dc01) of 1-9, 0, + and - */
const KEY_ROWS = [0x7f, 0x7f, 0xfd, 0xfd, 0xfb, 0xfb, 0xf7, 0xf7, 0xef, 0xef, 0xdf, 0xdf];
const KEY_COLS = [0x01, 0x08, 0x01, 0x08, 0x01, 0x08, 0x01, 0x08, 0x01, 0x08, 0x01, 0x08];

const overlaps = (s: number, e: number, s2: number, e2: number) => s < e2 && s2 < e;
const hex = (v: number) => `$${v.toString(16).padStart(v > 0xff ? 4 : 2, '0')}`;
const bytes = (v: number[]) => v.map(x => `$${h2(x)}`).join(',');

/** Screen codes (upper case set) of a line, 40 wide. */
function screenLine(s: string): number[] {
  const out: number[] = [];
  for (const c of s.slice(0, 40)) {
    const k = c.toUpperCase().charCodeAt(0);
    out.push(k >= 0x41 && k <= 0x5a ? k - 0x40 : c === '@' ? 0 : c === '_' ? 0x64 : k >= 0x20 && k < 0x40 ? k : 0x3f);
  }
  while (out.length < 40) out.push(0x20);
  return out;
}

/** The PRG that plays the block in VICE (see the file head). */
export function sidPlayer(o: SidPlayerOptions): SidPlayer {
  const D = o.load, L = o.data.length, end = D + L, S = SID_PLAYER_DATA;
  if (!L) throw new Error('The music block is empty');
  if (end > 0x10000) throw new Error('The music block runs past $ffff');
  if (D < 0x0002) throw new Error('The music block is over the processor port ($00-$01)');
  if (S + L > PRG_END) throw new Error(`The music block is too big to play (${L} bytes): the player's PRG would load into the I/O area at $d000`);
  const inBlock = (s: number, e: number) => overlaps(D, end, s, e);
  const warnings: string[] = [];

  // the KERNAL stays in unless the block is under it or over its IRQ vector; then the CPU's own vectors are used
  const ramVectors = inBlock(0xe000, 0x10000) || inBlock(0x0314, 0x031a);
  if (ramVectors && inBlock(0xfffa, 0x10000)) throw new Error('The music block is over the CPU\'s interrupt vectors ($fffa-$ffff): play cannot be called from an interrupt');
  const port = ramVectors ? 0x35 : inBlock(0xa000, 0xc000) ? 0x36 : 0x37;
  if (inBlock(0xd000, 0xe000)) warnings.push('The block is under the I/O area ($d000-$dfff): the player reads the VIC, SID and CIAs there, not its bytes');
  const screen = !inBlock(SCREEN, SCREEN_END);
  const song = (o.song ?? 0) & 0xff;

  // the text: what plays, the song (its digits change), the keys
  const text = [
    'MIMIR STUDIO - MUSIC BLOCK PLAYER',
    '',
    o.title ?? `MUSIC $${h4(D)}`,
    `$${h4(D)}-$${h4(end - 1)}  INIT $${h4(o.init)}  PLAY $${h4(o.play)}`,
    `PLAY EACH FRAME (RASTER IRQ), $01 = $${h2(port)}`,
    '',
    `SONG $${h2(song)} (A AT INIT)`,
    '',
    'KEYS 1-9 AND 0: SONG $00-$09',
    '+ AND -: THE NEXT SONG, THE ONE BEFORE',
    '',
    'BORDER BAR: THE RASTER TIME OF PLAY',
  ].flatMap(screenLine);
  const half = text.length / 2;

  // move the bytes from the PRG to where the player runs: forward when they go down, from the top when they go up
  const pages = L >> 8, rem = L & 0xff;
  const src = (S + pages * 256) & 0xffff, dst = (D + pages * 256) & 0xffff;
  const copy: string[] = D === S ? [] : D < S ? [
    ...(pages ? [` ldx #${hex(pages)}`, ' ldy #0', `mf: lda ${hex(S)},y`, ` sta ${hex(D)},y`, ' iny', ' bne mf', ' inc mf+2', ' inc mf+5', ' dex', ' bne mf'] : []),
    ...(rem ? [' ldy #0', `mr: lda ${hex(src)},y`, ` sta ${hex(dst)},y`, ' iny', ` cpy #${hex(rem)}`, ' bne mr'] : []),
  ] : [
    ...(rem ? [` ldy #${hex(rem)}`, 'mr: dey', ` lda ${hex(src)},y`, ` sta ${hex(dst)},y`, ' cpy #0', ' bne mr'] : []),
    // the operands' high bytes go one page down before each page
    ...(pages ? [` ldx #${hex(pages)}`, 'mp: dec mb+2', ' dec mb+5', ' ldy #$ff', `mb: lda ${hex(src)},y`, ` sta ${hex(dst)},y`, ' dey', ' cpy #$ff', ' bne mb', ' dex', ' bne mp'] : []),
  ];
  const vectors = [
    ...(inBlock(0x0314, 0x031a) ? [] : [' lda #<irq_kernal', ' sta $0314', ' lda #>irq_kernal', ' sta $0315', ' lda #<nmi', ' sta $0318', ' lda #>nmi', ' sta $0319']),
    // also under the KERNAL: a player that switches it off still gets its interrupt
    ' lda #<irq', ' sta $fffe', ' lda #>irq', ' sta $ffff', ' lda #<nmi', ' sta $fffa', ' lda #>nmi', ' sta $fffb',
  ];
  const driver = [
    // all RAM while the bytes are moved: under the ROMs and the I/O area too
    ' lda #$34', ' sta $01',
    ...copy,
    ` lda #${hex(port)}`, ' sta $01',
    ' ldx #$ff', ' txs',
    // the CIAs' interrupts off: play is called from the raster interrupt only
    ' lda #$7f', ' sta $dc0d', ' sta $dd0d', ' lda $dc0d', ' lda $dd0d',
    ...vectors,
    ' lda #$1b', ' sta $d011', ` lda #${hex(SID_PLAYER_LINE)}`, ' sta $d012', ' lda #$01', ' sta $d01a', ' lda #$ff', ' sta $d019',
    ` lda #${hex(song)}`, ' jsr start_song',
    // the keys: a key pressed starts its song once, until no key is held
    'keys: ldx #11',
    'scan: lda key_rows,x', ' sta $dc00', ' lda $dc01', ' and key_cols,x', ' beq pressed', ' dex', ' bpl scan',
    ' inx', ' stx held', ' beq keys',
    'pressed: lda held', ' bne keys', ' inc held',
    ' txa', ' cpx #10', ' bcc new_song',
    ' lda song', ' cpx #11', ' beq song_down', ' clc', ' adc #1', ' jmp new_song',
    'song_down: sec', ' sbc #1',
    'new_song: jsr start_song', ' jmp keys',
    // start the song in A: the SID silenced, init called with the song in A
    'start_song: sei', ' sta song',
    ...(screen ? [' lsr', ' lsr', ' lsr', ' lsr', ' jsr hex_digit', ` sta ${hex(SID_PLAYER_SONG_AT)}`, ' lda song', ' and #$0f', ' jsr hex_digit', ` sta ${hex(SID_PLAYER_SONG_AT + 1)}`] : []),
    ' lda #0', ' ldx #$18', 'silence: sta $d400,x', ' dex', ' bpl silence',
    ' lda song', ` jsr ${hex(o.init)}`, ' cli', ' rts',
    ...(screen ? ['hex_digit: cmp #10', ' bcc decimal', ' sbc #9', ' rts', 'decimal: adc #$30', ' rts'] : []),
    // the interrupt: straight from the CPU's vector, or through the KERNAL's (which saved the registers)
    'irq: pha', ' txa', ' pha', ' tya', ' pha',
    'irq_kernal: lda #$ff', ' sta $d019', ' inc $d020', ` jsr ${hex(o.play)}`, ' dec $d020',
    ' pla', ' tay', ' pla', ' tax', ' pla',
    'nmi: rti',
    `key_rows: .byte ${bytes(KEY_ROWS)}`,
    `key_cols: .byte ${bytes(KEY_COLS)}`,
    `song: .byte ${hex(song)}`,
    'held: .byte $01',
  ];

  const build = (at: Addr, size: number) => {
    const source = [
      '.pc = $0801',
      '.byte $0b,$08,$0a,$00,$9e,$32,$30,$36,$31,$00,$00,$00',
      '.pc = $080d',
      // no interrupt from here: the KERNAL's would write its keyboard buffer and clock while the driver is put in place
      ' sei',
      ...(screen ? [
        ' lda #0', ' sta $d020', ' sta $d021', ' ldx #0',
        'cls: lda #$20', ' sta $0400,x', ' sta $0500,x', ' sta $0600,x', ' sta $06e8,x',
        ' lda #$0f', ' sta $d800,x', ' sta $d900,x', ' sta $da00,x', ' sta $dae8,x', ' inx', ' bne cls',
        ` ldx #${hex(half - 1)}`,
        'show: lda screen_text,x', ` sta ${hex(TEXT_AT)},x`, ` lda screen_text+${half},x`, ` sta ${hex(TEXT_AT + half)},x`, ' dex', ' cpx #$ff', ' bne show',
      ] : []),
      // the driver to where it runs: its first 256 bytes, then the rest (or all of it, from its end)
      ...(size >= 256 ? [' ldx #0', 'put: lda driver,x', ` sta ${hex(at)},x`, ' inx', ' bne put'] : []),
      ...(size !== 256 ? [
        ` ldx #${hex(size > 256 ? size - 256 : size)}`,
        `put_end: lda driver+${size > 256 ? 255 : -1},x`, ` sta ${hex(at + (size > 256 ? 255 : -1))},x`, ' dex', ' bne put_end',
      ] : []),
      ` jmp ${hex(at)}`,
      ...(screen ? ['screen_text:', ...Array.from({ length: text.length / 20 }, (_, i) => `.byte ${bytes(text.slice(i * 20, i * 20 + 20))}`)] : []),
      'driver:',
      `.pseudopc ${hex(at)} {`,
      ...driver,
      '}',
      'driver_end:',
    ].join('\n');
    const r = assemble({ 'player.asm': source }, 'player.asm');
    if (r.errors.length) throw new Error(`The player did not assemble: ${r.errors.map(e => `line ${e.line}: ${e.msg}`).join('; ')}`);
    const sym = (n: string) => Number(r.symbols.get(n));
    return { mem: r.mem, codeEnd: sym('driver_end'), size: sym('driver_end') - sym('driver') };
  };

  // the driver's size does not depend on where it runs: measured once, then put where it is out of the way
  const size = build(0xc000, 300).size;
  if (size < 1 || size > 511) throw new Error(`The player's driver is ${size} bytes: it must be 1-511`);
  const at = driverPlace(size, [[D, end], [0x0801, S + L], ...(screen ? [[SCREEN, SCREEN_END] as [number, number]] : [])]);
  if (at == null) throw new Error('No room for the player\'s driver: the music block and the PRG fill the free RAM');
  const b = build(at, size);
  if (b.codeEnd > S) throw new Error(`The player's code runs past $${h4(S)}`);
  const body = new Uint8Array(S - 0x0801 + L);
  body.set(b.mem.subarray(0x0801, S));
  body.set(o.data, S - 0x0801);
  return { prg: makePrg(0x0801, body), driver: { start: at, end: at + size }, port, screen, warnings };
}

/** Where the driver goes: the first place out of `busy` in the RAM every port setting shows ($c000-$cfff, else
 *  below BASIC's ROM, from the top). */
function driverPlace(size: number, busy: [number, number][]): Addr | null {
  const places = [0xc000, 0xc800, 0xcc00];
  for (let p = 0x9f00; p >= 0x0800; p -= 0x100) places.push(p);
  const limit = (p: number) => (p >= 0xc000 ? 0xd000 : 0xa000);
  return places.find(p => p + size <= limit(p) && !busy.some(([s, e]) => overlaps(p, p + size, s, e))) ?? null;
}
