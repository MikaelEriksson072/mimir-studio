/* Playing a music block on a C64 (VICE): a PRG that RUN starts, with the block's bytes and a small driver. The
 * driver puts the bytes where the player runs, calls init with the song number in A and then play once a frame, from
 * a raster interrupt, with the time play takes shown as a bar in the border. Keys 1-9 and 0 start songs $00-$09, +
 * and - the next and the one before. It holds exactly the bytes the export's .sid file does, so what plays is what
 * the .sid holds. */
import type { Addr, DigiInfo } from '../types';
import { assemble } from '../verify/kick-subset-assembler';
import { makePrg } from './prg';
import { makePsid } from './psid';
import { DIGI_UNLOADED, digiPlays, runDigi, runPlayer } from './sidrun';
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
  /** more bytes the driver puts in place with the block: a sample player's samples and song (MusicInfo.digi) */
  parts?: { load: Addr; data: Uint8Array }[];
  /** a sample player: init starts the timer interrupt that plays the samples, and with play 0 nothing is called each
   *  frame (no raster interrupt); a song started again stops the timers first */
  digi?: { nmi: boolean; hz: number; irq?: { handler: Addr; kernal: boolean } };
  /** what init writes outside the bytes (a sample player's): the driver is not put there */
  busy?: [Addr, Addr][];
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

/** Moving `len` bytes from `from` to `to` (6510 lines): forward when they go down, from the top when they go up.
 *  `tag` keeps the labels of several moves apart. */
function moveCode(from: number, to: number, len: number, tag: string): string[] {
  if (from === to) return [];
  const pages = len >> 8, rem = len & 0xff;
  const src = (from + pages * 256) & 0xffff, dst = (to + pages * 256) & 0xffff;
  return to < from ? [
    ...(pages ? [` ldx #${hex(pages)}`, ' ldy #0', `mf${tag}: lda ${hex(from)},y`, ` sta ${hex(to)},y`, ' iny', ` bne mf${tag}`, ` inc mf${tag}+2`, ` inc mf${tag}+5`, ' dex', ` bne mf${tag}`] : []),
    ...(rem ? [' ldy #0', `mr${tag}: lda ${hex(src)},y`, ` sta ${hex(dst)},y`, ' iny', ` cpy #${hex(rem)}`, ` bne mr${tag}`] : []),
  ] : [
    ...(rem ? [` ldy #${hex(rem)}`, `mr${tag}: dey`, ` lda ${hex(src)},y`, ` sta ${hex(dst)},y`, ' cpy #0', ` bne mr${tag}`] : []),
    // the operands' high bytes go one page down before each page
    ...(pages ? [` ldx #${hex(pages)}`, `mp${tag}: dec mb${tag}+2`, ` dec mb${tag}+5`, ' ldy #$ff', `mb${tag}: lda ${hex(src)},y`, ` sta ${hex(dst)},y`, ' dey', ' cpy #$ff', ` bne mb${tag}`, ' dex', ` bne mp${tag}`] : []),
  ];
}

/** The PRG that plays the block in VICE (see the file head). */
export function sidPlayer(o: SidPlayerOptions): SidPlayer {
  const D = o.load, end = D + o.data.length, S = SID_PLAYER_DATA;
  if (!o.data.length) throw new Error('The music block is empty');
  if (end > 0x10000) throw new Error('The music block runs past $ffff');
  if (D < 0x0002) throw new Error('The music block is over the processor port ($00-$01)');
  const parts = (o.parts ?? []).filter(p => p.data.length);
  for (const p of parts) if (p.load < 0x0002 || p.load + p.data.length > 0x10000) throw new Error(`The music's bytes at $${h4(p.load)} run past $ffff or over the processor port`);
  // (with parts, each split where the PRG's room starts and ends: what is in it stays where it runs)
  const segs = [{ load: D, data: o.data }, ...parts].flatMap(g => !parts.length ? [g] : [S, PRG_END].reduce((pieces, cut) => pieces.flatMap(x =>
    x.load < cut && cut < x.load + x.data.length ? [{ load: x.load, data: x.data.subarray(0, cut - x.load) }, { load: cut, data: x.data.subarray(cut - x.load) }] : [x]), [g]));
  const L = segs.reduce((n, g) => n + g.data.length, 0);
  // where each is in the PRG: a block alone from S on; with parts each where it runs when that is in the PRG's room,
  // the others in the room left (out of where any of them runs)
  const froms = placeSegments(segs, S, PRG_END, parts.length > 0);
  if (!froms) throw new Error(parts.length ? `The music block and its samples are too big to play (${L} bytes): the player's PRG would load into the I/O area at $d000`
    : `The music block is too big to play (${L} bytes): the player's PRG would load into the I/O area at $d000`);
  const top = Math.max(S, ...segs.map((g, k) => froms[k] + g.data.length));
  const inBlock = (s: number, e: number) => segs.some(g => overlaps(g.load, g.load + g.data.length, s, e));
  // nothing is called each frame: a sample player's init starts what plays
  const frames = !o.digi || o.play !== 0;
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
    `$${h4(D)}-$${h4(end - 1)}  INIT $${h4(o.init)}  ${frames ? `PLAY $${h4(o.play)}` : 'NO PLAY'}`,
    frames ? `PLAY EACH FRAME (RASTER IRQ), $01 = $${h2(port)}` : `SAMPLES: ITS ${o.digi!.nmi ? 'NMI' : 'IRQ'}, ${o.digi!.hz} HZ, $01 = $${h2(port)}`,
    parts.length ? `+ $${h4(parts[0].load)}-$${h4(parts[parts.length - 1].load + parts[parts.length - 1].data.length - 1)}, ${parts.length} PART${parts.length === 1 ? '' : 'S'}` : '',
    `SONG $${h2(song)} (A AT INIT)`,
    '',
    'KEYS 1-9 AND 0: SONG $00-$09',
    '+ AND -: THE NEXT SONG, THE ONE BEFORE',
    '',
    frames ? 'BORDER BAR: THE RASTER TIME OF PLAY' : 'NOTHING IS CALLED EACH FRAME',
  ].flatMap(screenLine);
  const half = text.length / 2;

  // move the bytes from the PRG to where the player runs, each part only when where it goes holds no part that is
  // still to move
  const moves = segs.map((g, k) => ({ from: froms[k], to: g.load, len: g.data.length }));
  const order: typeof moves = [];
  for (const left = [...moves]; left.length;) {
    const i = left.findIndex(m => !left.some(n => n !== m && overlaps(m.to, m.to + m.len, n.from, n.from + n.len)));
    if (i < 0) throw new Error('The music\'s parts cannot be put in place: each goes where another one still is in the PRG');
    order.push(left.splice(i, 1)[0]);
  }
  const copy = order.flatMap((m, k) => moveCode(m.from, m.to, m.len, order.length === 1 ? '' : `_${k}`));
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
    ' lda #$1b', ' sta $d011', ` lda #${hex(SID_PLAYER_LINE)}`, ' sta $d012', ` lda #${frames ? '$01' : '$00'}`, ' sta $d01a', ' lda #$ff', ' sta $d019',
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
    // a sample player started again: its timers stopped while init runs
    ...(o.digi ? [' lda #$7f', ' sta $dc0d', ' sta $dd0d', ' lda $dc0d', ' lda $dd0d', ' lda song'] : []),
    ...(screen ? [' lsr', ' lsr', ' lsr', ' lsr', ' jsr hex_digit', ` sta ${hex(SID_PLAYER_SONG_AT)}`, ' lda song', ' and #$0f', ' jsr hex_digit', ` sta ${hex(SID_PLAYER_SONG_AT + 1)}`] : []),
    ' lda #0', ' ldx #$18', 'silence: sta $d400,x', ' dex', ' bpl silence',
    ' lda song', ` jsr ${hex(o.init)}`, ' cli', ' rts',
    ...(screen ? ['hex_digit: cmp #10', ' bcc decimal', ' sbc #9', ' rts', 'decimal: adc #$30', ' rts'] : []),
    // the interrupt: straight from the CPU's vector, or through the KERNAL's (which saved the registers)
    'irq: pha', ' txa', ' pha', ' tya', ' pha',
    ...(frames ? ['irq_kernal: lda #$ff', ' sta $d019', ' inc $d020', ` jsr ${hex(o.play)}`, ' dec $d020'] : ['irq_kernal: lda #$ff', ' sta $d019', ' lda $dc0d']),
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
  const at = driverPlace(size, [...segs.map((g): [number, number] => [g.load, g.load + g.data.length]), [0x0801, S], ...moves.map((m): [number, number] => [m.from, m.from + m.len]),
    ...(screen ? [[SCREEN, SCREEN_END] as [number, number]] : []), ...(o.busy ?? [])]);
  if (at == null) throw new Error('No room for the player\'s driver: the music block and the PRG fill the free RAM');
  const b = build(at, size);
  if (b.codeEnd > S) throw new Error(`The player's code runs past $${h4(S)}`);
  const body = new Uint8Array(top - 0x0801);
  body.set(b.mem.subarray(0x0801, S));
  segs.forEach((g, k) => body.set(g.data, froms[k] - 0x0801));
  return { prg: makePrg(0x0801, body), driver: { start: at, end: at + size }, port, screen, warnings };
}

/** Where each segment's bytes are in the PRG, from `lo` up to `hi`: one after the other, or (`inPlace`) where it runs
 *  when that is between `lo` and `hi`, the others in the room left out of where any of them runs (the biggest first),
 *  so that no move overwrites bytes still to move. Null when they do not fit. */
function placeSegments(segs: { load: Addr; data: Uint8Array }[], lo: number, hi: number, inPlace: boolean): number[] | null {
  if (!inPlace) {
    let f = lo;
    const out = segs.map(g => { const a = f; f += g.data.length; return a; });
    return f <= hi ? out : null;
  }
  const out = segs.map(g => (g.load >= lo && g.load + g.data.length <= hi ? g.load : -1));
  const taken = segs.map((g): [number, number] => [g.load, g.load + g.data.length]);
  const rest = segs.map((_, k) => k).filter(k => out[k] < 0).sort((x, y) => segs[y].data.length - segs[x].data.length);
  for (const k of rest) {
    const n = segs[k].data.length;
    let at = lo;
    for (let hit = taken.find(([s, e]) => overlaps(at, at + n, s, e)); hit; hit = taken.find(([s, e]) => overlaps(at, at + n, s, e))) at = hit[1];
    if (at + n > hi) return null;
    out[k] = at; taken.push([at, at + n]);
  }
  return out;
}

/** Where the driver goes: the first place out of `busy` in the RAM every port setting shows ($c000-$cfff, else
 *  below BASIC's ROM, from the top). */
function driverPlace(size: number, busy: [number, number][]): Addr | null {
  const places = [0xc000, 0xc800, 0xcc00];
  for (let p = 0x9f00; p >= 0x0800; p -= 0x100) places.push(p);
  const limit = (p: number) => (p >= 0xc000 ? 0xd000 : 0xa000);
  return places.find(p => p + size <= limit(p) && !busy.some(([s, e]) => overlaps(p, p + size, s, e))) ?? null;
}

export interface MusicPlayData {
  /** the bytes to play and where they go, init and play */
  data: Uint8Array; load: Addr; init: Addr; play: Addr;
  /** a snapshot's player played on without its own init: where the routine that puts its bytes back went */
  resume?: { at: Addr; bytes: number };
  /** why it cannot play on from the snapshot as `resume` says (it plays with its init then) */
  problem?: string;
  /** why the bytes do not play with nothing else in memory, as the player's PRG has them (a run of init and play
   *  that stops: its code runs out of the block, say) */
  alone?: string;
  /** a sample player's (MusicInfo.digi): the bytes outside the block it plays from (its samples and song), its timer
   *  interrupt, and what its init writes outside them */
  parts?: { load: Addr; data: Uint8Array }[];
  digi?: { nmi: boolean; hz: number; irq?: { handler: Addr; kernal: boolean } };
  busy?: [Addr, Addr][];
  /** a sample player with nothing to call each frame: init is a routine put next to the block that sets $01, calls
   *  the player's init and switches off the interrupts it leaves that are not the samples' (a demo's raster
   *  interrupt, CIA 1's beside an NMI) */
  wrapped?: { at: Addr; bytes: number; init: Addr };
}

/** what a sample player gives musicPlayData: its run's findings and the bytes of its parts */
export interface MusicPlayDigi extends Pick<DigiInfo, 'nmi' | 'hz' | 'wrote'>, Partial<Pick<DigiInfo, 'latch' | 'loop' | 'timer' | 'irq'>> {
  parts: { load: Addr; data: Uint8Array }[];
}

/**
 * What a music block plays with (in VICE and in DeepSID): its bytes, init and play. For a snapshot's player that init
 * no longer starts again (`MusicInfo.resume`), init is a routine put right after the block (or before it) that writes
 * back the bytes outside the block the player reads, as the snapshot has them, and returns: play goes on from where
 * the demo was. A sample player (`MusicInfo.digi`) plays with its parts, and with play 0 init is wrapped (`wrapped`);
 * one whose init does not return plays from what init left (`resume`, then its timer started again).
 * The export's .sid file is the block's bytes alone (render/kick.ts).
 */
export function musicPlayData(block: Uint8Array, load: Addr, init: Addr, play: Addr, resume?: [Addr, number][], digi?: MusicPlayDigi): MusicPlayData {
  const d = resumed(block, load, init, play, resume, digi ? [...digi.parts.map((p): [Addr, Addr] => [p.load, p.load + p.data.length]), ...digi.wrote] : []);
  return withAlone(digi ? sampled(d, digi) : d);
}

/** $01 while the music plays (sidPlayer's): $35 with bytes under the KERNAL or over its IRQ vector, $36 under BASIC */
function playPort(segs: { load: Addr; data: Uint8Array }[]): number {
  const covers = (s: number, e: number) => segs.some(g => overlaps(g.load, g.load + g.data.length, s, e));
  return covers(0xe000, 0x10000) || covers(0x0314, 0x031a) ? 0x35 : covers(0xa000, 0xc000) ? 0x36 : 0x37;
}

/** `code` right after the block's bytes, else right before them, out of `avoid`, the I/O area and the vectors; where
 *  no ROM is over it first (an RSID starts with the ROMs in: DeepSID runs init there) */
function nextTo(d: MusicPlayData, code: number[], avoid: [Addr, Addr][]): { data: Uint8Array; load: Addr; at: Addr } | null {
  const n = code.length, end = d.load + d.data.length;
  const free = (s: number, rom: boolean) => s >= 0x0200 && s + n <= 0xfffa && !overlaps(s, s + n, 0xd000, 0xe000) && !avoid.some(([a, b]) => overlaps(s, s + n, a, b))
    && (rom || (!overlaps(s, s + n, 0xa000, 0xc000) && !overlaps(s, s + n, 0xe000, 0x10000)));
  for (const rom of [false, true]) {
    if (free(end, rom)) { const data = new Uint8Array(d.data.length + n); data.set(d.data); data.set(code, d.data.length); return { data, load: d.load, at: end }; }
    if (free(d.load - n, rom)) { const data = new Uint8Array(d.data.length + n); data.set(code); data.set(d.data, n); return { data, load: d.load - n, at: d.load - n }; }
  }
  return null;
}

function sampled(d: MusicPlayData, s: MusicPlayDigi): MusicPlayData {
  const out: MusicPlayData = { ...d, parts: s.parts, digi: { nmi: s.nmi, hz: s.hz, ...(s.irq ? { irq: s.irq } : {}) }, busy: s.wrote };
  if (d.play !== 0) return out;
  // $01 as the player's PRG has it and init (with an init that does not return, the routine that puts back what it
  // left, and its timer started again); then no raster interrupt but the program's that starts the samples (and with an
  // NMI player none from CIA 1): what a demo's init starts beside the samples runs code the block does not hold
  const port = playPort([{ load: d.load, data: d.data }, ...s.parts]);
  const t = s.loop ? s.timer : undefined, base = t?.cia === 2 ? 0xdd00 : 0xdc00, lo = t?.b ? 6 : 4;
  const st = (v: number, a: Addr) => [0xa9, v & 0xff, 0x8d, a & 0xff, a >> 8];
  const vec = s.irq?.kernal ? 0x0314 : 0xfffe;
  const code = [0xa9, port, 0x85, 0x01, 0x20, d.init & 0xff, d.init >> 8,
    ...(t && s.latch != null ? [...st(s.latch, base + lo), ...st(s.latch >> 8, base + lo + 1), ...st(t.b ? 0x82 : 0x81, base + 0x0d), ...st(t.ctl | 0x11, base + (t.b ? 0x0f : 0x0e))] : []),
    0x78,
    ...(s.irq ? [...st(s.irq.handler, vec), ...st(s.irq.handler >> 8, vec + 1), ...st(1, 0xd01a)] : st(0, 0xd01a)), ...st(0xff, 0xd019),
    ...(s.nmi ? [0xa9, 0x7f, 0x8d, 0x0d, 0xdc, 0xad, 0x0d, 0xdc] : [0x58]), 0x60];
  const at = nextTo(d, code, [...s.parts.map((p): [Addr, Addr] => [p.load, p.load + p.data.length]), ...s.wrote]);
  if (!at) return { ...out, problem: `no room next to the block for the ${code.length} bytes that call init and switch off the demo's other interrupts` };
  // (the program's IRQ through $0314 needs the KERNAL, which bytes under it switch off)
  const kernalOff = s.irq?.kernal && !(port & 2);
  return { ...out, data: at.data, load: at.load, init: at.at, wrapped: { at: at.at, bytes: code.length, init: d.init },
    ...(kernalOff ? { problem: `the program's IRQ at $${h4(s.irq!.handler)} goes through the KERNAL ($0314), which the bytes under it switch off: the samples it starts do not play` } : {}) };
}

/**
 * The .sid file a music block plays from in DeepSID: a PSID of its bytes, init and play; a sample player with nothing
 * to call each frame an RSID (a real C64's interrupts) of its block and parts from the lowest to the highest, zeros
 * between them.
 */
export function musicSidFile(d: MusicPlayData, name?: string): Uint8Array {
  if (!d.digi || d.play !== 0) return makePsid(d.data, d.load, d.init, d.play, name);
  const segs = [{ load: d.load, data: d.data }, ...(d.parts ?? [])];
  const lo = Math.min(...segs.map(g => g.load)), hi = Math.max(...segs.map(g => g.load + g.data.length));
  const all = new Uint8Array(hi - lo);
  for (const g of segs) all.set(g.data, g.load - lo);
  return makePsid(all, lo, d.init, 0, name, true);
}

function resumed(block: Uint8Array, load: Addr, init: Addr, play: Addr, resume?: [Addr, number][], avoid: [Addr, Addr][] = []): MusicPlayData {
  if (!resume) return { data: block, load, init, play };
  // lda #v once for each value, then a sta (zero page or absolute) for each byte that has it; $01 last (the SID
  // registers are written while the I/O area shows); rts
  const byValue = new Map<number, Addr[]>();
  for (const [a, v] of resume) { if (a === 1) continue; let l = byValue.get(v); if (!l) byValue.set(v, l = []); l.push(a); }
  const code: number[] = [];
  for (const [v, as] of byValue) {
    code.push(0xa9, v);
    for (const a of as) code.push(...(a < 0x100 ? [0x85, a] : [0x8d, a & 0xff, a >> 8]));
  }
  for (const [a, v] of resume) if (a === 1) code.push(0xa9, v, 0x85, 0x01);
  code.push(0x60);
  const end = load + block.length, n = code.length;
  const free = (s: number) => s >= 0x0200 && s + n <= 0xfffa && !overlaps(s, s + n, 0xd000, 0xe000) && !resume.some(([a]) => a >= s && a < s + n)
    && !avoid.some(([a, b]) => overlaps(s, s + n, a, b));
  if (free(end)) {
    const data = new Uint8Array(block.length + n); data.set(block); data.set(code, block.length);
    return { data, load, init: end, play, resume: { at: end, bytes: n } };
  }
  if (free(load - n)) {
    const data = new Uint8Array(block.length + n); data.set(code); data.set(block, n);
    return { data, load: load - n, init: load - n, play, resume: { at: load - n, bytes: n } };
  }
  return { data: block, load, init, play, problem: `no room next to the block for the ${n} bytes that put back the bytes the player reads outside it` };
}

/** The bytes run with nothing else in memory, as the player's PRG has them (c64/sidrun.ts): why they would not play */
function withAlone(d: MusicPlayData): MusicPlayData {
  const mem = new Uint8Array(0x10000);
  const segs = [{ load: d.load, data: d.data }, ...(d.parts ?? [])];
  for (const g of segs) mem.set(g.data.subarray(0, 0x10000 - g.load), g.load);
  const loaded = (a: Addr) => segs.some(g => a >= g.load && a < g.load + g.data.length);
  if (d.digi && d.play === 0) {
    const r = runDigi(mem, { init: d.init, frames: 150, port: playPort(segs), loaded, ...(d.digi.irq ? { irq: d.digi.irq } : {}) });
    return digiPlays(r) ? d : { ...d, alone: r.stop ?? (r.unloaded > DIGI_UNLOADED ? `its interrupt reads ${r.unloaded} bytes outside what plays` : 'its interrupt writes no samples to the SID') };
  }
  const r = runPlayer(mem, { init: d.init, play: d.play, frames: 150, loaded });
  return r.stop ? { ...d, alone: r.stop } : d;
}
