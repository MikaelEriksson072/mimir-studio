/* PETSCII animations to test the reader with (c64/petscii-anim.ts): an encoder that writes frames as the stream the
 * player reads (runs of changes to the frame before, through a table of screen code and colour pairs), and a player of
 * our own written to the shape the reader looks for, with code that sets where each sequence of frames starts. Nothing of
 * the demo's own code: only the instructions the reader needs to see. */
import { assemble } from '../../src';

export interface Screen { chars: number[]; colours: number[] }

/** a screen of spaces in colour 0, with `text` (screen codes) at `at` in `colour` */
export function screenWith(parts: { at: number; codes: number[]; colour: number }[], base?: Screen): Screen {
  const s: Screen = base ? { chars: [...base.chars], colours: [...base.colours] } : { chars: Array(1000).fill(0x20), colours: Array(1000).fill(0) };
  for (const p of parts) p.codes.forEach((c, i) => { s.chars[p.at + i] = c; s.colours[p.at + i] = p.colour; });
  return s;
}

/** the skip before a run: up to 14 in the header, else 15 and bytes that add up to it ($ff while more follow) */
function skipBytes(skip: number): { nibble: number; more: number[] } {
  if (skip < 15) return { nibble: skip, more: [] };
  const more: number[] = [];
  let r = skip;
  while (r >= 255) { more.push(0xff); r -= 255; }
  more.push(r);
  return { nibble: 15, more };
}

/**
 * The stream of `screens`, each the changes to the one before (the first to a screen of spaces in colour 0), and the
 * table of the pairs it uses: `chars[x]` and `colours[x]` for index x. `starts`: where each frame starts in the stream.
 */
export function encodeFrames(screens: Screen[], from: Screen = screenWith([])): { stream: number[]; starts: number[]; chars: number[]; colours: number[] } {
  const pairs: string[] = [];
  const index = (c: number, k: number) => { const key = `${c},${k}`; let i = pairs.indexOf(key); if (i < 0) { i = pairs.push(key) - 1; if (i > 255) throw new Error('more than 256 pairs'); } return i; };
  const stream: number[] = [], starts: number[] = [];
  let before = from;
  for (const s of screens) {
    starts.push(stream.length);
    let pos = 0;
    for (let i = 0; i < 1000;) {
      if (s.chars[i] === before.chars[i] && s.colours[i] === before.colours[i]) { i++; continue; }
      // a run of changed characters, at most 15
      let n = 0;
      while (n < 15 && i + n < 1000 && (s.chars[i + n] !== before.chars[i + n] || s.colours[i + n] !== before.colours[i + n])) n++;
      const sk = skipBytes(i - pos);
      stream.push((n << 4) | sk.nibble, ...sk.more, ...Array.from({ length: n }, (_, k) => index(s.chars[i + k], s.colours[i + k])));
      pos = i + n; i += n;
    }
    stream.push(0);
    before = s;
  }
  const chars = pairs.map(p => Number(p.split(',')[0])), colours = pairs.map(p => Number(p.split(',')[1]));
  return { stream, starts, chars, colours };
}

export interface PlayerOptions {
  /** where the player and the part's code go */
  code?: number;
  /** the tables */
  chars: number; colours: number;
  /** each sequence: where it starts, how many frames, and the state the code sets with it (null: none) */
  sequences: { start: number; frames: number; state?: number | null }[];
  /** the code sets the frame counter (else it does not count, and the frames run on until the stream stops) */
  counted?: boolean;
  /** the order the setters are in the code (indexes into `sequences`; the default is as given) */
  codeOrder?: number[];
}

/** The player and the part's code as Kick Assembler source: a routine per sequence that sets the stream pointer (and the
 *  counter and state), and a routine called each frame that draws one and counts down. */
export function playerSource(o: PlayerOptions): string {
  const order = o.codeOrder ?? o.sequences.map((_, i) => i);
  const [t1, t2] = [o.chars, o.colours];
  const [q1, q2] = ['scr', 'col'];
  return `
.label ptr = $80
.label pos = $82
.label scr = $84
.label col = $86
.label skip = $88
.label n = $8a
.label yy = $8b
.label counter = $8c
.label state = $8d
.label SCREEN = $0400
.label COLOURS = $d800
.pc = $${(o.code ?? 0xc000).toString(16)} "part"
frame:  jsr draw
        dec counter
        bne !+
        inc state
!:      rts
${order.map(i => { const q = o.sequences[i]; return `seq${i}:   lda #<$${q.start.toString(16)}
        sta ptr
        lda #>$${q.start.toString(16)}
        sta ptr+1
${o.counted === false ? '' : `        lda #${q.frames & 0xff}\n        sta counter\n`}${q.state != null ? `        lda #${q.state}\n        sta state\n` : ''}        rts`; }).join('\n')}
draw:   lda #0
        sta pos
        sta pos+1
        ldy #0
next:   tya
        clc
        adc ptr
        sta ptr
        lda #0
        adc ptr+1
        sta ptr+1
        ldy #0
        lda (ptr),y
        bne run
        inc ptr
        bne !+
        inc ptr+1
!:      rts
run:    pha
        and #$0f
        cmp #$0f
        beq long
        sta skip
        lda #0
        sta skip+1
        iny
        jmp count
long:   lda #0
        sta skip
        sta skip+1
more:   iny
        lda (ptr),y
        tax
        clc
        adc skip
        sta skip
        lda skip+1
        adc #0
        sta skip+1
        cpx #$ff
        beq more
        iny
count:  pla
        lsr
        lsr
        lsr
        lsr
        sta n
        lda pos
        clc
        adc skip
        sta pos
        lda pos+1
        adc skip+1
        sta pos+1
        sty yy
        lda pos
        sec
        sbc yy
        sta scr
        sta col
        lda pos+1
        sbc #0
        tax
        clc
        adc #>SCREEN
        sta scr+1
        txa
        clc
        adc #>COLOURS
        sta col+1
        lda pos
        clc
        adc n
        sta pos
        lda pos+1
        adc #0
        sta pos+1
put:    lda (ptr),y
        tax
        lda $${t1.toString(16)},x
        sta (${q1}),y
        lda $${t2.toString(16)},x
        sta (${q2}),y
        iny
        dec n
        bne put
        jmp next
`;
}

/** 64 KB with the part's code, the tables and the stream (`streams`: each at its address), and what is loaded */
export function animMemory(o: PlayerOptions, streams: { at: number; bytes: number[] }[], tables: { chars: number[]; colours: number[] }): { mem: Uint8Array; loaded: Uint8Array; code: { start: number; end: number } } {
  const r = assemble({ 'part.asm': playerSource(o) }, 'part.asm');
  if (r.errors.length) throw new Error(r.errors.map(e => `${e.line}: ${e.msg}`).join('\n'));
  const mem = new Uint8Array(0x10000), loaded = new Uint8Array(0x10000);
  const start = o.code ?? 0xc000;
  mem.set(r.mem.subarray(start, r.max + 1), start); loaded.fill(1, start, r.max + 1);
  const put = (at: number, b: number[]) => { mem.set(b, at); loaded.fill(1, at, at + b.length); };
  put(o.chars, tables.chars); put(o.colours, tables.colours);
  for (const s of streams) put(s.at, s.bytes);
  return { mem, loaded, code: { start, end: r.max + 1 } };
}

/** "MIMIR" (screen codes) */
const MIMIR = [13, 9, 13, 9, 18];

/**
 * The animation of fixtures/d64/petscii-anim.d64: "MIMIR" sliding in from the right on row 12 in yellow, 8 frames
 * (sequence 1), then flashing orange, red, white and yellow, 4 frames (sequence 2), with a line of graphics characters
 * under it. The part is job 2: the code at $c000, the tables at $9000 and $9100, the stream at $8000.
 */
export function animDemo(): { screens: Screen[]; options: PlayerOptions; chunks: { start: number; bytes: number[] }[]; stream: number[] } {
  const line = { at: 13 * 40 + 10, codes: Array(20).fill(0x43), colour: 14 };
  const slide = Array.from({ length: 8 }, (_, k) => screenWith([{ at: 12 * 40 + 33 - k * 2, codes: MIMIR, colour: 7 }, line]));
  const flash = [8, 2, 1, 7].map(c => screenWith([{ at: 12 * 40 + 19, codes: MIMIR, colour: c }, line]));
  const screens = [...slide, ...flash];
  const e = encodeFrames(screens);
  const options: PlayerOptions = { chars: 0x9000, colours: 0x9100, sequences: [{ start: 0x8000, frames: 8, state: 0 }, { start: 0x8000 + e.starts[8], frames: 4, state: 1 }] };
  const m = animMemory(options, [{ at: 0x8000, bytes: e.stream }], e);
  const chunk = (start: number, end: number) => ({ start, bytes: [...m.mem.subarray(start, end)] });
  return { screens, options, stream: e.stream, chunks: [chunk(0x8000, 0x8000 + e.stream.length), chunk(0x9000, 0x9000 + e.chars.length), chunk(0x9100, 0x9100 + e.colours.length), chunk(m.code.start, m.code.end)] };
}
