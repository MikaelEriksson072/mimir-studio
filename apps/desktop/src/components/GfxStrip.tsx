/* A picture line of the listing (lib/gfxlines): its characters, sprites or bitmap cells drawn as they look, in the
 * colours of the Graphics tab. The items the selection takes in are tinted, the one at the cursor framed, and the one
 * under the pointer outlined, with what it is in the tooltip. A click on an item picks its bytes (the listing reads
 * the item from the point: `data-i` is the line). */
import { memo, useLayoutEffect, useRef, useState } from 'react';
import { h4, type Addr, type AnalysisResult, type GfxLine } from '@mimir/core';
import { drawGfxLine, gfxCount, gfxItemAt, gfxItemBox, gfxItemText, gfxRects, gfxSize, GFX_GEOMETRY, SPRITE_CAPTION } from '../lib/gfxlines';
import type { GfxColors } from '../lib/gfxview';

interface GfxStripProps {
  l: GfxLine; i: number; A: AnalysisResult; colors: GfxColors;
  /** the selected bytes it takes in (part of it), and the byte at the cursor when it is in it */
  sel: { start: Addr; end: Addr } | null; cur: Addr | null;
}

export const GfxStrip = memo(function GfxStrip({ l, i, A, colors, sel, cur }: GfxStripProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const { width, height, scale } = gfxSize(l);
  const { bg, fg, mc1, mc2 } = colors;
  useLayoutEffect(() => {
    const ctx = ref.current?.getContext('2d'); if (!ctx) return;
    const img = ctx.createImageData(width, height);
    drawGfxLine(img.data, l, A.mem, { bg, fg, mc1, mc2 });
    ctx.putImageData(img, 0, 0);
  }, [l, A.mem, width, height, bg, fg, mc1, mc2]);
  const [hover, setHover] = useState<number | null>(null);
  const move = (e: React.MouseEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    const c = gfxItemAt(l, (e.clientX - r.left) / scale, Math.min(height - 1, (e.clientY - r.top) / scale));
    setHover(c ? (c.a - l.a) / l.unit : null);
  };
  const box = (b: { x: number; y: number; w: number; h: number }, cls: string, key?: string | number) =>
    <span key={key} className={cls} style={{ left: b.x * scale, top: b.y * scale, width: b.w * scale, height: b.h * scale }} />;
  const curK = cur != null && cur >= l.a && cur < l.a + l.n ? Math.floor((cur - l.a) / l.unit) : null;
  const g = GFX_GEOMETRY[l.kind];
  return (
    <span className={`gfx-strip gfx-${l.kind}`} data-i={i} style={{ width: width * scale, height: height * scale + (l.kind === 'sprite' ? SPRITE_CAPTION : 0) }}
      title={hover != null ? gfxItemText(A, l, hover) : undefined} onMouseMove={move} onMouseLeave={() => setHover(null)}>
      <canvas ref={ref} width={width} height={height} style={{ width: width * scale, height: height * scale }} aria-label={`${l.kind === 'chars' ? 'Characters' : l.kind === 'sprite' ? 'Sprites' : 'Bitmap'} $${h4(l.a)}–$${h4(l.a + l.n - 1)}`} />
      {sel && gfxRects(l, sel.start, sel.end).map((b, k) => box(b, 'gfx-sel', `s${k}`))}
      {curK != null && box(gfxItemBox(l, curK), 'gfx-cur')}
      {hover != null && hover !== curK && box(gfxItemBox(l, hover), 'gfx-hover')}
      {l.kind === 'sprite' && Array.from({ length: gfxCount(l) }, (_, k) => {
        const b = gfxItemBox(l, k);
        const a = l.a + k * l.unit, name = l.names?.find(x => x.a === a)?.name;
        return <span key={`c${k}`} className={name ? 'gfx-cap named' : 'gfx-cap'} style={{ left: b.x * scale, top: g.h * scale, width: (b.w + g.gap) * scale - 2 }}>{name ?? h4(a)}</span>;
      })}
    </span>
  );
});
