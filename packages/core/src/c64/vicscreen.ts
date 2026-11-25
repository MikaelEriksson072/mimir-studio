/* What a VIC-II shows, from its registers: the mode, where the screen, characters, bitmap and sprites are in its bank,
 * the colours; and the picture itself, as VICE draws a PAL screen with its normal borders (384 x 272 pixels: raster
 * lines 16-287, the display window at x 32-351 and lines 51-250 when it is 40 x 25). A VICE snapshot holds the
 * registers and the colour RAM (vsf.ts), so its screen can be drawn as it was when the snapshot was saved (spec 13.7).
 *
 * The picture is of one moment's registers: a program that changes them during the frame (a raster split, sprites
 * used again lower down) showed more than this. Within that, it is what VICE draws: the character rows start at line
 * $30 + YSCROLL, lines of the display window outside them show the idle byte ($3fff, $39ff with ECM), XSCROLL fills
 * the left with background colour 0, the invalid modes are black, the border covers sprites, and between sprites the
 * lower number wins before its priority bit is looked at (so a sprite behind the graphics hides another in front). */
import type { Addr } from '../types';
import type { Snapshot } from './vsf';

export type VicMode = 'text' | 'mc-text' | 'ecm-text' | 'bitmap' | 'mc-bitmap' | 'invalid';

export interface VicSprite {
  n: number;
  /** $d015 */
  on: boolean;
  /** the position as the registers have it (x 9 bits) */
  x: number; y: number;
  /** its pointer (screen + $3f8 + n) and where that puts the sprite's 64 bytes */
  ptr: number; addr: Addr;
  color: number; mc: boolean; wide: boolean; tall: boolean;
  /** $d01b: behind the graphics' foreground */
  behind: boolean;
}

export interface VicState {
  /** 0-3, from CIA 2's port A */
  bank: number; base: Addr;
  mode: VicMode;
  ecm: boolean; bmm: boolean; mcm: boolean;
  /** $d011 bit 4: the screen is on (off: border everywhere) */
  den: boolean;
  rows: 24 | 25; cols: 38 | 40;
  xscroll: number; yscroll: number;
  /** where the VIC fetches from, in 64 KB (the bank's base added) */
  screen: Addr; charset: Addr; bitmap: Addr;
  /** the characters come from the character ROM (at $1000-$1fff in banks 0 and 2) */
  charRom: boolean;
  border: number;
  /** $d021-$d024 */
  bg: [number, number, number, number];
  /** $d025, $d026 */
  spriteMc: [number, number];
  sprites: VicSprite[];
  /** $d01a: the interrupts enabled */
  irqMask: number;
  /** the mode and memory registers as written */
  d011: number; d016: number; d018: number;
}

/** The VIC-II's view of `regs` ($d000-$d03f) in VIC bank `bank`, with the sprite pointers read from `ram`. */
export function vicState(regs: ArrayLike<number>, bank: number, ram: Uint8Array): VicState {
  const base = (bank & 3) * 0x4000;
  const d011 = regs[0x11], d016 = regs[0x16], d018 = regs[0x18];
  const ecm = !!(d011 & 0x40), bmm = !!(d011 & 0x20), mcm = !!(d016 & 0x10);
  const mode: VicMode = ecm ? (bmm || mcm ? 'invalid' : 'ecm-text') : bmm ? (mcm ? 'mc-bitmap' : 'bitmap') : mcm ? 'mc-text' : 'text';
  const screen = base + ((d018 >> 4) & 15) * 0x400, charset = base + ((d018 >> 1) & 7) * 0x800, bitmap = base + ((d018 >> 3) & 1) * 0x2000;
  const sprites: VicSprite[] = [];
  for (let n = 0; n < 8; n++) {
    const ptr = ram[(screen + 0x3f8 + n) & 0xffff];
    sprites.push({
      n, on: !!(regs[0x15] & (1 << n)), x: regs[n * 2] | (regs[0x10] & (1 << n) ? 0x100 : 0), y: regs[n * 2 + 1], ptr, addr: base + ptr * 64,
      color: regs[0x27 + n] & 15, mc: !!(regs[0x1c] & (1 << n)), wide: !!(regs[0x1d] & (1 << n)), tall: !!(regs[0x17] & (1 << n)), behind: !!(regs[0x1b] & (1 << n)),
    });
  }
  return {
    bank: bank & 3, base, mode, ecm, bmm, mcm, den: !!(d011 & 0x10), rows: d011 & 8 ? 25 : 24, cols: d016 & 8 ? 40 : 38,
    xscroll: d016 & 7, yscroll: d011 & 7, screen, charset, bitmap, charRom: !(bank & 1) && (charset & 0x3000) === 0x1000,
    border: regs[0x20] & 15, bg: [regs[0x21] & 15, regs[0x22] & 15, regs[0x23] & 15, regs[0x24] & 15], spriteMc: [regs[0x25] & 15, regs[0x26] & 15],
    sprites, irqMask: regs[0x1a] & 15, d011, d016, d018,
  };
}

/** The VIC bank of a snapshot: CIA 2's $dd00 bits 0-1 (inputs read as 1), bank 0 without its module */
const bankOf = (s: Snapshot) => (s.cia2 ? 3 - (((s.cia2.pra & s.cia2.ddra) | (~s.cia2.ddra & 0xff)) & 3) : 0);

/** What the snapshot's VIC-II was showing; null when the snapshot has no VIC-II module Mimir reads. */
export const snapshotVicState = (s: Snapshot): VicState | null => (s.vic ? vicState(s.vic.regs, bankOf(s), s.ram) : null);

/** VICE's PAL screen with normal borders */
export const VIC_SCREEN = { width: 384, height: 272, firstLine: 16, firstX: -8 } as const;

export interface VicScreen {
  width: number; height: number;
  /** a C64 colour (0-15) per pixel, row by row */
  pixels: Uint8Array;
}

/**
 * The picture `st` makes of `ram` and `colorRam`, as VICE draws it (VIC_SCREEN). `chars` is the character ROM (4 KB),
 * which the VIC sees at $1000-$1fff of banks 0 and 2; without it those bytes are 0. `lineOf` (a running C64's frame):
 * the registers each raster line had, so that what a program changes during the frame (the border's and the
 * background's colours, the mode, the scroll) shows on the lines it changed it for; `st` is then the frame's start.
 */
export function vicScreen(st0: VicState, ram: Uint8Array, colorRam: ArrayLike<number>, chars: Uint8Array | null = null, lineOf?: (line: number) => VicState): VicScreen {
  const { width, height, firstLine, firstX } = VIC_SCREEN;
  const pixels = new Uint8Array(width * height).fill(st0.border);
  if (!st0.den && !lineOf) return { width, height, pixels };
  const fg = new Uint8Array(width), col = new Uint8Array(width);
  for (let line = firstLine; line < firstLine + height; line++) {
    const y = line - firstLine;
    const st = lineOf ? lineOf(line) : st0;
    // (each line its own border: raster bars)
    if (lineOf) pixels.fill(st.border, y * width, (y + 1) * width);
    if (!st.den) continue;
    const top = st.rows === 25 ? 51 : 55, bottom = st.rows === 25 ? 251 : 247;
    if (line < top || line >= bottom) continue;
    /** a byte as the VIC reads it: 14 bits in its bank */
    const vr = (a14: number) => {
      const a = a14 & 0x3fff;
      if (!(st.bank & 1) && (a & 0x3000) === 0x1000) return chars ? chars[a & 0x0fff] : 0;
      return ram[st.base + a];
    };
    const scr = st.screen - st.base, chr = st.charset - st.base, bmp = st.bitmap - st.base;
    const left = st.cols === 40 ? 24 : 31, right = st.cols === 40 ? 344 : 335;
    const first = 0x30 + st.yscroll;
    const gy = line - first, display = gy >= 0 && gy < 200, row = gy >> 3, rc = gy & 7;
    for (let X = left; X < right; X++) {
      const sx = X - firstX;
      const gx = X - 24 - st.xscroll;
      let c: number, f = false;
      if (gx < 0) c = st.bg[0];
      else {
        const cx = gx >> 3, bit = 7 - (gx & 7);
        // the c-data (screen byte and colour) and the g-data of this cell; idle: $3fff ($39ff with ECM) and 0
        let code = 0, color = 0, g: number;
        if (display) {
          code = vr(scr + row * 40 + cx); color = colorRam[row * 40 + cx] & 15;
          g = st.bmm ? vr(bmp + row * 320 + cx * 8 + rc) : vr(chr + (st.ecm ? code & 0x3f : code) * 8 + rc);
        } else g = vr(st.ecm ? 0x39ff : 0x3fff);
        const pair = (g >> (bit & 6)) & 3, one = (g >> bit) & 1;
        const mcCell = st.mcm && (st.bmm || color & 8);
        if (mcCell) {
          f = pair >= 2;
          c = st.bmm ? [st.bg[0], code >> 4, code & 15, color][pair] : [st.bg[0], st.bg[1], st.bg[2], color & 7][pair];
        } else {
          f = !!one;
          c = st.bmm ? (one ? code >> 4 : code & 15) : one ? color : st.ecm ? st.bg[code >> 6] : st.bg[0];
        }
        if (st.mode === 'invalid') c = 0;
      }
      fg[sx] = f ? 1 : 0; col[sx] = c;
    }
    // sprites: the lowest number with a pixel here wins; behind the graphics it gives way to their foreground
    const won = new Int8Array(width).fill(-1), sc = new Uint8Array(width);
    for (let n = 7; n >= 0; n--) {
      const s = st.sprites[n];
      if (!s.on) continue;
      const dy = line - (s.y + 1);
      if (dy < 0 || dy >= (s.tall ? 42 : 21)) continue;
      const r = s.tall ? dy >> 1 : dy, at = s.addr - st.base + r * 3;
      const bits = (vr(at) << 16) | (vr(at + 1) << 8) | vr(at + 2);
      const x0 = s.x >= 488 ? s.x - 504 : s.x, w = s.wide ? 2 : 1;
      for (let p = 0; p < 24 * w; p++) {
        const sx = x0 + p - firstX;
        if (sx < 0 || sx >= width) continue;
        const k = Math.floor(p / w);
        let c: number;
        if (s.mc) { const v = (bits >> (22 - (k & ~1))) & 3; if (!v) continue; c = [0, st.spriteMc[0], s.color, st.spriteMc[1]][v]; }
        else { if (!((bits >> (23 - k)) & 1)) continue; c = s.color; }
        won[sx] = n; sc[sx] = c;
      }
    }
    for (let X = left; X < right; X++) {
      const sx = X - firstX, n = won[sx];
      pixels[y * width + sx] = n >= 0 && !(st.sprites[n].behind && fg[sx]) ? sc[sx] : col[sx];
    }
  }
  return { width, height, pixels };
}
