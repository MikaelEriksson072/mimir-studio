/* The heat map of two scratchpads compared (spec 10.3): how its cells fit the room it has. */

const COLS = [16, 32, 64, 128, 256];

/** How many cells a row of the heat map has, and how big a cell is, to fit `n` bytes into `box` with the biggest cells
 *  (2 to 18 pixels; 1 or 2 when even the longest rows do not fit the height, and then it scrolls). */
export function heatLayout(n: number, box: { w: number; h: number }): { cols: number; cell: number } {
  let best = { cols: 16, cell: 0 };
  for (const cols of COLS) {
    if (cols > 16 && cols / 2 >= n) break;
    const cell = Math.min(18, Math.floor(box.w / cols), Math.floor(box.h / Math.ceil(n / cols)));
    if (cell > best.cell) best = { cols, cell };
  }
  if (best.cell < 2) {
    // too little room for 2-pixel cells: as wide as there is room for, cells of 1 or 2 pixels, and it scrolls
    const cols = [...COLS].reverse().find(c => c * 2 <= box.w) ?? 16;
    return { cols, cell: Math.max(1, Math.min(2, Math.floor(box.w / cols))) };
  }
  return best;
}
