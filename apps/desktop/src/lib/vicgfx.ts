/* The Graphics tab in a snapshot's colours (spec 14.5): what its VIC-II had when VICE saved it. Each view gets the
 * colours the VIC draws that kind of graphics with: characters and screens the background and multicolours of
 * $d021-$d023 and the colour most cells have in colour RAM, sprites $d021, their own colour and $d025/$d026, bitmaps
 * $d021 and the colours most cells of the screen and colour RAM give. The screen and the bitmap the VIC showed are
 * drawn cell by cell in their own colours, as on the C64. */
// (no DOM here: the unit tests run it in Node)
import type { Addr } from '@mimir/core';
import type { CellColors, GfxColors, GfxKind } from './gfxview';
import { spritePairColors } from './gfxlines';
import type { SnapshotVicInfo } from './overview';

/** the value most of `values` have (the lowest of those that tie); `none` when there are none */
function mostCommon(values: Iterable<number>, none: number): number {
  const n = new Array(16).fill(0);
  let any = false;
  for (const v of values) { n[v & 15]++; any = true; }
  if (!any) return none;
  let best = 0;
  for (let i = 1; i < 16; i++) if (n[i] > n[best]) best = i;
  return best;
}

/** the 1000 cells of the screen the VIC shows: their screen bytes (from `mem`) and colours */
function* cells(v: SnapshotVicInfo, mem: Uint8Array): Generator<{ code: number; color: number }> {
  for (let i = 0; i < 1000; i++) yield { code: mem[(v.st.screen + i) & 0xffff], color: v.vic.colorRam[i] & 15 };
}

/** The colours a Graphics view `kind` draws with in the snapshot's colours (multicolour or not, `mc`): the bit pairs
 *  00, 01, 10 and 11 (hires: 0 and 1 as 00 and 11). `mem` is the memory the tab draws (the screen bytes). */
export function vicGfxColors(v: SnapshotVicInfo, mem: Uint8Array, kind: GfxKind, mc: boolean): GfxColors {
  const { st } = v, cs = [...cells(v, mem)];
  if (kind === 'sprites') {
    // the colour most of the sprites it had on have, of those drawn as the view draws (multicolour or not)
    const on = st.sprites.filter(s => s.on), same = on.filter(s => s.mc === mc);
    const sprite = mostCommon((same.length ? same : on).map(s => s.color), st.sprites[0].color);
    return spritePairColors({ bg: st.bg[0], sprite, mc1: st.spriteMc[0], mc2: st.spriteMc[1] }, mc);
  }
  if (kind === 'bitmap') {
    if (mc) return { bg: st.bg[0], mc1: mostCommon(cs.map(c => c.code >> 4), 1), mc2: mostCommon(cs.map(c => c.code & 15), 0), fg: mostCommon(cs.map(c => c.color), 1) };
    return { bg: mostCommon(cs.map(c => c.code & 15), st.bg[0]), fg: mostCommon(cs.map(c => c.code >> 4), 1), mc1: st.bg[1], mc2: st.bg[2] };
  }
  // characters, screens, a font per row: the background and multicolours of the text modes; the colour most cells
  // have (in multicolour text, of the cells drawn multicolour: their colour RAM's bits 0-2)
  const mcCells = cs.filter(c => c.color & 8);
  const fg = mc && st.mcm && !st.bmm && mcCells.length ? mostCommon(mcCells.map(c => c.color & 7), 1) : mostCommon(cs.map(c => c.color), 1);
  return { bg: st.bg[0], fg, mc1: st.bg[1], mc2: st.bg[2] };
}

/**
 * The colours of the cells of the screen and the bitmap the snapshot's VIC showed, the bitmap in a bitmap mode and the
 * screen in a text mode (null for any other memory): a
 * bitmap cell its screen byte's nibbles and colour RAM (multicolour 00 $d021, 01 high nibble, 10 low, 11 colour RAM;
 * hires 0 the low nibble, 1 the high one), a screen cell its colour RAM over the background (in extended colour mode
 * the background its code picks; in multicolour text a cell drawn multicolour when its colour RAM has bit 3, with
 * $d022 and $d023).
 */
export function vicCellColors(v: SnapshotVicInfo, mem: Uint8Array): CellColors {
  const { st } = v, color = v.vic.colorRam;
  return (kind: GfxKind, base: Addr, i: number) => {
    if (i < 0 || i >= 1000) return null;
    if (kind === 'bitmap' && st.bmm && base === st.bitmap) {
      const code = mem[(st.screen + i) & 0xffff];
      return st.mcm ? { pal: [st.bg[0], code >> 4, code & 15, color[i] & 15], mc: true } : { pal: [code & 15, 0, 0, code >> 4], mc: false };
    }
    if (kind === 'screens' && !st.bmm && base === st.screen) {
      const c = color[i] & 15, code = mem[(st.screen + i) & 0xffff];
      if (st.mcm && c & 8) return { pal: [st.bg[0], st.bg[1], st.bg[2], c & 7], mc: true };
      return { pal: [st.ecm ? st.bg[code >> 6] : st.bg[0], 0, 0, c], mc: false };
    }
    return null;
  };
}
