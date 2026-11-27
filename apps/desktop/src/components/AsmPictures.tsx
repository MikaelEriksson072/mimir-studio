/* A picture in the Assembler's editor (lib/asmgfx.ts): the sprites, characters or bitmap a block's .byte lines make,
 * drawn as the re-assembler's listing draws them (GfxStrip), in a view zone above the lines it stands for. As in the
 * listing, the item under the pointer is outlined with what it is (and its line) in the tooltip, a click picks its
 * bytes (the inspector shows it, enlarged, to draw in), the window's selection is tinted and the item at its cursor
 * framed. A double-click puts the caret on the item's line: the picture's lines are shown under it to be edited.
 *
 * Draw (the pencil beside a picture, on for all of them): a click or a drag sets pixels, as Draw in the Graphics tab
 * does (hires: the colour the first pixel did not have; multicolour: the pen; the right button: the background). What
 * is drawn shows at once; when the button is let go the bytes go to the lines that write them (asmWriteBytes), and the
 * picture is drawn from the check of them again. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { create } from 'zustand';
import { h4, type Addr } from '@mimir/core';
import { GFX_GEOMETRY, gfxCount, gfxItemAt, gfxPixelAt, gfxSize } from '../lib/gfxlines';
import { ASM_PICTURE_GAP, ASM_PICTURE_PAD, asmPictureLine, type AsmPicture } from '../lib/asmgfx';
import { C64 } from '../lib/palette';
import { Icon } from '../lib/icons';
import { cx } from '../lib/util';
import { useAsmLink } from '../store/asmlink';
import { useUi } from '../store/ui';
import { GfxStrip } from './GfxStrip';

const WHAT = { sprite: 'Sprites', chars: 'Characters', bitmap: 'Bitmap' } as const;

/** Draw: on or off for every picture in the editor, and the multicolour pen (the bit pair it draws) */
export const useAsmDraw = create<{ on: boolean; pen: number; set: (p: Partial<{ on: boolean; pen: number }>) => void }>(set => ({
  on: false, pen: 3, set: p => set(p),
}));

export interface AsmPictureZoneProps {
  p: AsmPicture;
  /** the program's memory (the check's), and the sprite pointers the analysis found (the tooltip names them) */
  mem: Uint8Array;
  sprites: readonly { addr: Addr; n: number }[];
  /** an item clicked (with Shift: the selection up to it); double-clicked (the caret to its line) */
  onPick: (c: { a: Addr; n: number }, extend: boolean) => void;
  onOpen: (line: number) => void;
  /** the bytes drawn, when the button is let go: to the lines that write them */
  onDraw: (changes: { addr: Addr; value: number }[]) => void;
}

export function AsmPictureZone({ p, mem, sprites, onPick, onOpen, onDraw }: AsmPictureZoneProps) {
  const colors = useUi(s => s.gfx.colors);
  const place = useAsmLink(s => s.place);
  const draw = useAsmDraw();
  // what is drawn, over the memory until the check has it (or a while has gone: a byte no line could take)
  const [drawn, setDrawn] = useState<ReadonlyMap<Addr, number>>(new Map());
  useEffect(() => { setDrawn(d => { if (!d.size) return d; const n = new Map([...d].filter(([a, v]) => mem[a] !== v)); return n.size === d.size ? d : n; }); }, [mem]);
  useEffect(() => { if (!drawn.size) return; const t = setTimeout(() => setDrawn(new Map()), 8000); return () => clearTimeout(t); }, [drawn]);
  const shown = useMemo(() => { if (!drawn.size) return mem; const v = mem.slice(); for (const [a, b] of drawn) v[a] = b; return v; }, [mem, drawn]);
  const A = useMemo(() => ({ mem: shown, vic: { sprites } }), [shown, sprites]);
  const first = p.rows[0], last = p.rows[p.rows.length - 1];
  const end = last ? last.a + last.n : 0;
  const lines = p.from <= p.to ? `lines ${p.from}–${p.to}` : `line ${p.after}`;
  const mc = !!first?.mc;
  /** the row under the pointer, and the point on it in C64 pixels */
  const at = (e: React.MouseEvent) => {
    const g = (e.target as Element).closest<HTMLElement>('.gfx-strip'), l = g ? p.rows[Number(g.dataset.i)] : null;
    if (!g || !l) return null;
    const r = g.getBoundingClientRect(), { height, scale } = gfxSize(l);
    return { l, x: (e.clientX - r.left) / scale, y: Math.min(height - 1, (e.clientY - r.top) / scale) };
  };
  const itemAt = (e: React.MouseEvent) => { const q = at(e); return q ? gfxItemAt(q.l, q.x, q.y) : null; };
  /** a drawing: the bits it sets and the bytes it changed */
  const stroke = useRef<{ v: number; bytes: Map<Addr, number> } | null>(null);
  const paint = (e: React.MouseEvent, start: boolean) => {
    const q = at(e), px = q ? gfxPixelAt(q.l, q.x, q.y) : null;
    if (!px) return;
    const old = stroke.current?.bytes.get(px.addr) ?? shown[px.addr];
    // (hires: the colour the first pixel did not have; multicolour: the pen; the right button: the background)
    if (start) stroke.current = { v: e.button === 2 ? 0 : mc ? draw.pen : (old >> px.shift) & 1 ? 0 : 1, bytes: new Map() };
    const st = stroke.current; if (!st) return;
    const value = (old & ~(px.mask << px.shift) & 0xff) | ((st.v & px.mask) << px.shift);
    if (value === old) return;
    st.bytes.set(px.addr, value);
    setDrawn(d => new Map([...d, [px.addr, value]]));
  };
  const drawRef = useRef(onDraw); drawRef.current = onDraw;
  useEffect(() => {
    const up = () => { const st = stroke.current; stroke.current = null; if (st?.bytes.size) drawRef.current([...st.bytes].map(([addr, value]) => ({ addr, value }))); };
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
  }, []);
  if (!first) return null;
  const tip = (a: Addr) => ` · line ${asmPictureLine(p, a)} · ${draw.on ? 'Draw is on: a click or a drag sets pixels' : 'a double-click shows the lines'}`;
  const pens = [colors.bg, colors.mc1, colors.mc2, colors.fg];
  // (Draw right after what is drawn: a row is as wide as its columns, also when the block has fewer items)
  const used = Math.max(...p.rows.map(l => { const g = GFX_GEOMETRY[l.kind], n = Math.min(l.col + gfxCount(l), l.cols); return (n * (g.w + g.gap) - g.gap) * g.scale; }));
  return (
    <div className={cx('asm-pic', draw.on && 'drawing')} role="group" aria-label={`${WHAT[p.kind]} $${h4(first.a)}–$${h4(end - 1)}, ${lines}`} style={{ padding: `${ASM_PICTURE_PAD}px 0` }}>
      <div className="asm-pic-rows" style={{ gap: ASM_PICTURE_GAP }}
        onMouseDown={e => {
          if (draw.on && (e.button === 0 || e.button === 2)) { e.preventDefault(); e.stopPropagation(); paint(e, true); return; }
          if (e.button !== 0) return;
          e.preventDefault(); const c = itemAt(e); if (c) onPick(c, e.shiftKey);
        }}
        onMouseMove={e => { if (draw.on && stroke.current && e.buttons) paint(e, false); }}
        onContextMenu={e => { if (draw.on) { e.preventDefault(); e.stopPropagation(); } }}
        onDoubleClick={e => { if (draw.on) return; const c = itemAt(e); onOpen(asmPictureLine(p, c?.a ?? first.a)); }}>
        {p.rows.map((l, i) => {
          const e = l.a + l.n, sel = place.sel && place.sel.start < e && place.sel.end > l.a ? place.sel : null;
          const cur = place.cursor != null && place.cursor >= l.a && place.cursor < e ? place.cursor : null;
          return <GfxStrip key={`${l.a}:${l.n}`} l={l} i={i} A={A} colors={colors} sel={sel} cur={cur} tip={tip} />;
        })}
      </div>
      <div className="asm-pic-tools" style={{ left: used + 10, top: ASM_PICTURE_PAD }}>
        <button type="button" className={cx('asm-pic-draw', draw.on && 'on')} aria-pressed={draw.on} aria-label="Draw in the pictures"
          title={draw.on ? 'Draw is on in every picture: a click or a drag sets pixels (hires: the colour the first pixel did not have; multicolour: the pen; the right button: the background), and the .byte lines that write the bytes change when the button is let go. A click here turns it off'
            : 'Draw in the pictures, as Draw in the Graphics tab: a click or a drag sets pixels, and the .byte lines (or the file a line imports) that write the bytes change'}
          onMouseDown={e => e.preventDefault()} onClick={() => draw.set({ on: !draw.on })}><Icon name="pencil" size={12} /></button>
        {draw.on && mc && [0, 1, 2, 3].map(v => <button key={v} type="button" className={cx('gfxv-pen', draw.pen === v && 'on')} aria-pressed={draw.pen === v} aria-label={`Pen ${v.toString(2).padStart(2, '0')}`}
          title={`Draw the bit pair ${v.toString(2).padStart(2, '0')}`} style={{ background: C64[pens[v] & 15] }} onMouseDown={e => e.preventDefault()} onClick={() => draw.set({ pen: v })} />)}
      </div>
    </div>
  );
}
