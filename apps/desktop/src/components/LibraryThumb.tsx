/* An item of the library drawn: its sprites or characters, `per` a row, or its picture (a bitmap), scaled up with
 * square pixels. */
import { useEffect, useMemo, useRef } from 'react';
import type { LibraryColors, LibraryItem } from '@mimir/core';
import { itemImage } from '../lib/library';

/** `count`: only the first so many; `scale`: pixels for each of its pixels (0: as wide as its box), at most `max` wide
 *  (a narrower one shrinks it, never stretches it) */
export function LibraryThumb({ item, per, mc, colors, count, scale = 2, max, className, label, onPick }: {
  item: Pick<LibraryItem, 'kind' | 'data'>; per: number; mc: boolean; colors: LibraryColors; count?: number; scale?: number; max?: number; className?: string; label?: string;
  /** a click on a sprite or character: its number */
  onPick?: (i: number) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const img = useMemo(() => itemImage(item, per, mc, colors, count), [item, per, mc, colors, count]);
  useEffect(() => {
    const cv = ref.current; if (!cv) return;
    const ctx = cv.getContext('2d'); if (!ctx) return;
    ctx.putImageData(new ImageData(img.rgba, img.width, img.height), 0, 0);
  }, [img]);
  // (scale 0: as wide as there is room for)
  const w = img.width * scale, width = scale === 0 ? '100%' : max != null ? Math.min(w, max) : w;
  const cell = item.kind === 'sprites' ? { w: 24, h: 21 } : { w: 8, h: 8 };
  const cols = Math.max(1, Math.round(img.width / cell.w));
  return <canvas ref={ref} width={img.width} height={img.height} className={className ?? 'lib-thumb'} role="img" aria-label={label ?? `${item.kind === 'sprites' ? 'Sprites' : item.kind === 'bitmaps' ? 'Picture' : 'Characters'} drawn`}
    style={{ width, aspectRatio: `${img.width} / ${img.height}` }}
    onClick={onPick && item.kind !== 'bitmaps' ? (e => {
      const r = e.currentTarget.getBoundingClientRect();
      const x = Math.floor((e.clientX - r.left) / r.width * img.width / cell.w), y = Math.floor((e.clientY - r.top) / r.height * img.height / cell.h);
      const i = y * cols + x;
      if (x >= 0 && x < cols && i >= 0 && i * (item.kind === 'sprites' ? 64 : 8) < item.data.length) onPick(i);
    }) : undefined} />;
}
