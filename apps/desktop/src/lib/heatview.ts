/* The memory map's zoom and pan (the Inspector's Memory map, components/Heatmap.tsx): where each byte is on the map at
 * any zoom, the view after a turn of the wheel or a drag, the addresses down its side and how much detail the bytes
 * have room for. One row is one 256-byte page at every zoom: zooming in makes the bytes larger, so fewer of them fit
 * across, and the map is moved to the rest. */
import { OPC, h2, type Addr } from '@mimir/core';

/** the pages the map shows: `rows` pages from page `p0`, one row of 256 bytes each */
export interface HeatSpan { p0: number; rows: number }
/** the box the map is drawn in, CSS px */
export interface HeatBox { w: number; h: number }
/** a view of the map: the zoom `z` (1 = the whole span fills the box) and where the box's top left is on the zoomed
 *  map, `x` and `y` in CSS px */
export interface HeatView { z: number; x: number; y: number }
/** a byte's place in the box, CSS px */
export interface HeatRect { x: number; y: number; w: number; h: number }

export const HEAT_WHOLE: HeatView = { z: 1, x: 0, y: 0 };
/** the widest a byte gets: 32 px, eight bytes across a map 256 px wide */
export const HEAT_MAX_CELL = 32;

/** the pages that have loaded bytes (Zoom to the loaded pages), or all 256 */
export function heatSpan(owner: ArrayLike<number>, fit: boolean): HeatSpan {
  if (!fit) return { p0: 0, rows: 256 };
  let lo = 256, hi = -1;
  for (let p = 0; p < 256; p++) for (let i = 0; i < 256; i += 16) if (owner[p * 256 + i] >= 0 || owner[p * 256 + 255] >= 0) { lo = Math.min(lo, p); hi = Math.max(hi, p); break; }
  return hi < 0 ? { p0: 0, rows: 256 } : { p0: lo, rows: hi - lo + 1 };
}

/** a byte's width `cw` and height `ch` at zoom z. The width grows with the zoom; the height is the row's while that is
 *  taller (with few pages each row starts out taller than a byte is wide) and grows with the width after that */
export function heatCell(span: HeatSpan, box: HeatBox, z: number): { cw: number; ch: number } {
  return { cw: box.w / 256 * z, ch: Math.max(box.h / span.rows, box.h / 256 * z) };
}

/** the closest zoom: a byte HEAT_MAX_CELL px wide */
export const heatMaxZoom = (box: HeatBox): number => Math.max(1, HEAT_MAX_CELL / (box.w / 256));

/** the view kept inside the map: the zoom between the whole map and the closest, the pan within the zoomed map */
export function heatClamp(v: HeatView, span: HeatSpan, box: HeatBox): HeatView {
  const z = Math.min(heatMaxZoom(box), Math.max(1, v.z));
  const { cw, ch } = heatCell(span, box, z);
  // how far the map can move; what rounding leaves at the whole map is nothing
  const room = (n: number) => n > 1e-6 ? n : 0;
  const x = Math.min(room(256 * cw - box.w), Math.max(0, v.x));
  const y = Math.min(room(span.rows * ch - box.h), Math.max(0, v.y));
  return x === v.x && y === v.y && z === v.z ? v : { z, x, y };
}

/** zoom by `factor` around the point (px, py) of the box: what is under it stays under it. Close to the whole map
 *  it becomes the whole map, so zooming all the way out gives it back exactly. */
export function heatZoom(v: HeatView, span: HeatSpan, box: HeatBox, factor: number, px: number, py: number): HeatView {
  let z = Math.min(heatMaxZoom(box), Math.max(1, v.z * factor));
  if (z < 1.02) z = 1;
  if (z === v.z) return v;
  const a = heatCell(span, box, v.z), b = heatCell(span, box, z);
  return heatClamp({ z, x: (v.x + px) / a.cw * b.cw - px, y: (v.y + py) / a.ch * b.ch - py }, span, box);
}

/** move the map by (dx, dy) px, as a drag does: it follows the pointer */
export function heatPan(v: HeatView, span: HeatSpan, box: HeatBox, dx: number, dy: number): HeatView {
  return heatClamp({ z: v.z, x: v.x - dx, y: v.y - dy }, span, box);
}

/** the address under the point (px, py) of the box; a point outside the map gives the nearest byte on it */
export function heatAt(v: HeatView, span: HeatSpan, box: HeatBox, px: number, py: number): Addr {
  const { cw, ch } = heatCell(span, box, v.z);
  const col = Math.max(0, Math.min(255, Math.floor((v.x + px) / cw)));
  const row = Math.max(0, Math.min(span.rows - 1, Math.floor((v.y + py) / ch)));
  return (span.p0 + row) * 256 + col;
}

/** where the byte at `a` is in the box (it may be outside it), or null when its page is not on the map */
export function heatRect(v: HeatView, span: HeatSpan, box: HeatBox, a: Addr): HeatRect | null {
  const row = (a >> 8) - span.p0;
  if (row < 0 || row >= span.rows) return null;
  const { cw, ch } = heatCell(span, box, v.z);
  return { x: (a & 255) * cw - v.x, y: row * ch - v.y, w: cw, h: ch };
}

/** the byte at `a` is in view: the middle of it is in the box */
export function heatShows(v: HeatView, span: HeatSpan, box: HeatBox, a: Addr): boolean {
  const r = heatRect(v, span, box, a);
  return !!r && r.x + r.w / 2 >= 0 && r.x + r.w / 2 <= box.w && r.y + r.h / 2 >= 0 && r.y + r.h / 2 <= box.h;
}

/** the view at zoom `z` that has the byte at `a` at the point (px, py), the middle of the box by default, as near as
 *  the edges of the map allow; the view unchanged when a's page is not on the map */
export function heatCenter(v: HeatView, span: HeatSpan, box: HeatBox, a: Addr, px = box.w / 2, py = box.h / 2): HeatView {
  const row = (a >> 8) - span.p0;
  if (row < 0 || row >= span.rows) return heatClamp(v, span, box);
  const { cw, ch } = heatCell(span, box, v.z);
  return heatClamp({ z: v.z, x: ((a & 255) + 0.5) * cw - px, y: (row + 0.5) * ch - py }, span, box);
}

/** the view of other pages (Zoom to the loaded pages turned on or off, another bank): the same zoom, with the point
 *  of memory that was in the middle of the box in the middle again, as near as the edges allow; the whole map stays
 *  the whole map */
export function heatRespan(v: HeatView, from: HeatSpan, to: HeatSpan, box: HeatBox): HeatView {
  const c = heatClamp(v, from, box);
  if (c.z === 1) return HEAT_WHOLE;
  const a = heatCell(from, box, c.z), b = heatCell(to, box, c.z);
  const row = (c.y + box.h / 2) / a.ch + from.p0 - to.p0;
  return heatClamp({ z: c.z, x: (c.x + box.w / 2) / a.cw * b.cw - box.w / 2, y: row * b.ch - box.h / 2 }, to, box);
}

/** the columns c0 ≤ c < c1 and rows r0 ≤ r < r1 (from the span's first page) that are in the box, partly or whole */
export function heatVisible(v: HeatView, span: HeatSpan, box: HeatBox): { c0: number; c1: number; r0: number; r1: number } {
  const { cw, ch } = heatCell(span, box, v.z);
  return {
    c0: Math.max(0, Math.floor(v.x / cw)), c1: Math.min(256, Math.ceil((v.x + box.w) / cw)),
    r0: Math.max(0, Math.floor(v.y / ch)), r1: Math.min(span.rows, Math.ceil((v.y + box.h) / ch)),
  };
}

/** a row's height from which every row has its address beside it */
export const HEAT_ROW_LABEL = 14;

/** the addresses down the map's side: one for each row when the rows are tall enough, else four, a quarter of the box
 *  apart. Each is the address the row has at the box's left edge (its page while the map is not moved sideways);
 *  `y` is the top of the label in the box, which is 9 px tall. */
export function heatAxis(v: HeatView, span: HeatSpan, box: HeatBox): { a: Addr; y: number }[] {
  const { cw, ch } = heatCell(span, box, v.z);
  const c0 = Math.min(255, Math.floor(v.x / cw + 0.5));
  if (ch >= HEAT_ROW_LABEL) {
    const { r0, r1 } = heatVisible(v, span, box), out: { a: Addr; y: number }[] = [];
    for (let r = r0; r < r1; r++) {
      const y = r * ch - v.y + ch / 2 - 4.5;
      if (y >= -1 && y <= box.h - 8) out.push({ a: (span.p0 + r) * 256 + c0, y });
    }
    return out;
  }
  return [0, 0.25, 0.5, 0.75].map(f => {
    const r = Math.min(span.rows - 1, Math.floor((v.y + f * box.h) / ch));
    return { a: (span.p0 + r) * 256 + c0, y: f * box.h };
  });
}

/** what the bytes have room for at a size of cw × ch px: lines between them and a bar where a block starts (`grid`),
 *  their value (`font`, its size in px, 0 for none), the names of the labels on them (`names`), and a second line
 *  under the value (`sub`) */
export interface HeatDetail { grid: boolean; font: number; names: boolean; sub: boolean }

export function heatDetail(cw: number, ch: number): HeatDetail {
  const names = cw >= 20 && ch >= 20, sub = cw >= 24 && ch >= 30;
  // two hex digits are 1.2 em wide, with some room either side; smaller than 8 px they are not read
  const fit = Math.min(names || sub ? 10 : 11, Math.floor((cw - 3) / 1.35));
  return { grid: cw >= 5 && ch >= 5, font: fit >= 8 && ch >= 10 ? fit : 0, names, sub };
}

/** what one byte shows in its cell, by the map's mode: `main` its value (or, on Refs, how many references it has),
 *  `sub` the line under it (the mnemonic where an instruction starts, on Refs the value) and `bits` its bits drawn as
 *  pixels (Bytes) */
export interface HeatTexts { main?: string; sub?: string; bits?: number }

export function heatTexts(mode: 'type' | 'bytes' | 'refs', byte: number, o: { ins?: boolean; refs?: number; hexUpper?: boolean; mnUpper?: boolean }): HeatTexts {
  const hex = o.hexUpper ? h2(byte).toUpperCase() : h2(byte);
  if (mode === 'bytes') return { main: hex, bits: byte };
  if (mode === 'refs') return o.refs ? { main: `×${o.refs}`, sub: hex } : { sub: hex };
  const mn = OPC[byte & 255].mn;
  return o.ins ? { main: hex, sub: o.mnUpper ? mn : mn.toLowerCase() } : { main: hex };
}

/** the zoom said as people say it: ×1, ×2.5, ×12 */
export const heatZoomText = (z: number): string => `×${z < 10 ? Math.round(z * 10) / 10 : Math.round(z)}`;
