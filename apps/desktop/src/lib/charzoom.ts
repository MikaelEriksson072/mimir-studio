/* The Inspector's enlarged character and sprite (spec 14.1, Ett tecken förstorat, En sprite förstorad): which one a
 * click in the Chars or Sprite preview is on, its pixels, the keys that step to another and how its bytes are written.
 * Pure, so the Node tests can check it. */

/** the Chars preview's characters in a row */
export const CHAR_COLS = 16;

/** how many characters the Chars preview draws for `n` bytes: one per 8, at least one and at most a charset's 256 */
export const charCount = (n: number): number => Math.max(1, Math.min(256, Math.floor(n / 8)));

/** the character (or sprite) under a point of the preview, given as fractions (0 to 1) of the canvas across and down;
 *  null past the last one (a short last row) or off the canvas */
export function charIndexAt(fx: number, fy: number, count: number, cols = CHAR_COLS): number | null {
  if (!(fx >= 0 && fx < 1 && fy >= 0 && fy < 1)) return null;
  const rows = Math.ceil(count / cols);
  const i = Math.floor(fy * rows) * cols + Math.floor(fx * cols);
  return i < count ? i : null;
}

/** a byte's pixels as the preview's colour indices, left to right: hires 8 (0 clear, 3 set), multicolour 4 (the bit
 *  pairs, 0-3) */
const bytePixels = (b: number, mc: boolean): number[] => (mc ? [6, 4, 2, 0].map(s => (b >> s) & 3) : [7, 6, 5, 4, 3, 2, 1, 0].map(s => ((b >> s) & 1 ? 3 : 0)));

/** a character's 8 rows as the preview's colour indices: hires 8 a row, multicolour 4 */
export function charPixels(mem: Uint8Array, addr: number, mc: boolean): number[][] {
  return Array.from({ length: 8 }, (_, r) => bytePixels(mem[(addr + r) & 0xffff], mc));
}

/** the Sprite preview's sprites for `n` bytes: one per 64, at least one and at most 32 */
export const spriteCount = (n: number): number => Math.max(1, Math.min(32, Math.floor(n / 64)));

/** the Sprite preview's sprites in a row: 4, or all of them when there are fewer */
export const spriteCols = (count: number): number => Math.min(4, count);

/** a sprite's 21 rows of 3 bytes as the preview's colour indices: hires 24 a row, multicolour 12 */
export function spritePixels(mem: Uint8Array, addr: number, mc: boolean): number[][] {
  return Array.from({ length: 21 }, (_, r) => [0, 1, 2].flatMap(c => bytePixels(mem[(addr + r * 3 + c) & 0xffff], mc)));
}

/** the highest address a sprite's 64 bytes can start at */
export const SPRITE_LAST = 0x10000 - 64;

/** where a key takes the enlarged sprite at `addr`, through memory and not only the preview's sprites (the frames of an
 *  animation often follow a block of one sprite): ← → the 64 bytes before and after, ↑ ↓ a row of the preview (`count`
 *  sprites from `start`) away, staying put at the ends of memory; Home and End the preview's first and last sprite;
 *  null for other keys */
export function spriteStep(addr: number, key: string, start: number, count: number): number | null {
  if (key === 'Home') return start;
  if (key === 'End') return start + (count - 1) * 64;
  const row = 64 * spriteCols(count);
  const d = key === 'ArrowLeft' ? -64 : key === 'ArrowRight' ? 64 : key === 'ArrowUp' ? -row : key === 'ArrowDown' ? row : 0;
  if (!d) return null;
  const to = addr + d;
  return to < 0 || to > SPRITE_LAST ? addr : to;
}

/** which of the preview's sprites (`count` from `start`) is the one at `addr`; null for bytes outside them or not on
 *  one */
export function spriteIndex(addr: number, start: number, count: number): number | null {
  const d = addr - start;
  return d >= 0 && d % 64 === 0 && d / 64 < count ? d / 64 : null;
}

/** the sprite pointer that shows the sprite (its 64 bytes' number in their 16 KB VIC bank), as the Graphics tab gives
 *  it; null when the bytes do not start on 64 (a selection not on 64) */
export const spriteNumber = (addr: number): number | null => (addr % 64 === 0 ? (addr & 0x3fff) >> 6 : null);

/** the character (or sprite) a key steps to: ← → the one before and after, ↑ ↓ the one a row of the preview away
 *  (staying put at the edges), Home and End the first and the last; null for other keys */
export function charStep(i: number, key: string, count: number, cols = CHAR_COLS): number | null {
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  const d = key === 'ArrowLeft' ? -1 : key === 'ArrowRight' ? 1 : key === 'ArrowUp' ? -cols : key === 'ArrowDown' ? cols : 0;
  if (!d) return null;
  const to = i + d;
  return to < 0 || to >= count ? i : to;
}

/** the character's number in its 2 KB charset (the screen code that shows it), as the Graphics tab gives it; null when
 *  the 8 bytes do not start on a character (a selection not on 8) */
export const charNumber = (addr: number): number | null => (addr % 8 === 0 ? (addr & 0x7ff) >> 3 : null);

/** a byte as its 8 bits, in pairs for multicolour */
export const charBits = (b: number, mc: boolean): string => {
  const s = (b & 0xff).toString(2).padStart(8, '0');
  return mc ? s.replace(/(..)(?!$)/g, '$1 ') : s;
};
