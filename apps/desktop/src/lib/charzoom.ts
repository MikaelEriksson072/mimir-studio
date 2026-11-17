/* The Inspector's enlarged character (spec 14.1, Ett tecken förstorat): which character a click in the Chars preview is on, its pixels, the
 * keys that step to another and how its bytes are written. Pure, so the Node tests can check it. */

/** the Chars preview's characters in a row */
export const CHAR_COLS = 16;

/** how many characters the Chars preview draws for `n` bytes: one per 8, at least one and at most a charset's 256 */
export const charCount = (n: number): number => Math.max(1, Math.min(256, Math.floor(n / 8)));

/** the character under a point of the preview, given as fractions (0 to 1) of the canvas across and down; null past
 *  the last character (a short last row) or off the canvas */
export function charIndexAt(fx: number, fy: number, count: number, cols = CHAR_COLS): number | null {
  if (!(fx >= 0 && fx < 1 && fy >= 0 && fy < 1)) return null;
  const rows = Math.ceil(count / cols);
  const i = Math.floor(fy * rows) * cols + Math.floor(fx * cols);
  return i < count ? i : null;
}

/** a character's 8 rows as the preview's colour indices, left to right: hires 8 a row (0 clear, 3 set), multicolour 4
 *  (the bit pairs, 0-3) */
export function charPixels(mem: Uint8Array, addr: number, mc: boolean): number[][] {
  const rows: number[][] = [];
  for (let r = 0; r < 8; r++) {
    const b = mem[(addr + r) & 0xffff];
    rows.push(mc ? [6, 4, 2, 0].map(s => (b >> s) & 3) : [7, 6, 5, 4, 3, 2, 1, 0].map(s => ((b >> s) & 1 ? 3 : 0)));
  }
  return rows;
}

/** the character a key steps to: ← → the one before and after, ↑ ↓ the one a row of the preview away (staying put at
 *  the edges), Home and End the first and the last; null for other keys */
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
