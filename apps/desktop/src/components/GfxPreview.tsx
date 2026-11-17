/* Graphics preview: sprites, charset, bitmap (hires or multicolor), and a character of it enlarged. */
import { useEffect, useMemo, useRef } from 'react';
import { h2, h4, type Addr } from '@mimir/core';
import { C64, cx, hexRgb } from '../lib/util';
import { Icon } from '../lib/icons';
import { CHAR_COLS, charBits, charCount, charIndexAt, charNumber, charPixels, charStep } from '../lib/charzoom';

export type GfxMode = 'sprite' | 'chars' | 'bitmap';

/** the preview's colours by index: the background (blue), multicolour 01 (light blue) and 10 (yellow), a set pixel (white) */
const PAL = [C64[6], C64[14], C64[7], C64[1]];

/** `pick`/`onPick` (Chars only): the character shown enlarged, marked here, and a click on one picks it (spec 14.1) */
export function GfxPreview({ mem, start, end, mode, mc, pick, onPick }: { mem: Uint8Array; start: Addr; end: Addr; mode: GfxMode; mc: boolean; pick?: number | null; onPick?: (i: number) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const geom = useMemo(() => {
    const n = end - start;
    if (mode === 'sprite') { const count = Math.max(1, Math.min(32, Math.floor(n / 64))); const cols = Math.min(4, count); return { w: cols * 26, h: Math.ceil(count / cols) * 23, count, cols }; }
    if (mode === 'chars') { const count = charCount(n); const cols = CHAR_COLS; return { w: cols * 8, h: Math.ceil(count / cols) * 8, count, cols }; }
    return { w: 320, h: 200, count: 1, cols: 1 };
  }, [start, end, mode]);
  useEffect(() => {
    const cv = ref.current; if (!cv) return;
    const ctx = cv.getContext('2d')!;
    const img = ctx.createImageData(geom.w, geom.h); const d = img.data;
    const pal = PAL.map(hexRgb);
    for (let i = 0; i < d.length; i += 4) { d[i] = 22; d[i + 1] = 20; d[i + 2] = 52; d[i + 3] = 255; }
    const px = (x: number, y: number, c: number[]) => { if (x < 0 || y < 0 || x >= geom.w || y >= geom.h) return; const o = (y * geom.w + x) * 4; d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; };
    const drawByte = (b: number, x: number, y: number) => {
      if (mc) for (let k = 0; k < 4; k++) { const c = pal[(b >> (6 - k * 2)) & 3]; px(x + k * 2, y, c); px(x + k * 2 + 1, y, c); }
      else for (let k = 0; k < 8; k++) px(x + k, y, (b >> (7 - k)) & 1 ? pal[3] : pal[0]);
    };
    if (mode === 'sprite') {
      for (let s = 0; s < geom.count; s++) { const ox = (s % geom.cols) * 26 + 1, oy = Math.floor(s / geom.cols) * 23 + 1; for (let r = 0; r < 21; r++) for (let c = 0; c < 3; c++) drawByte(mem[(start + s * 64 + r * 3 + c) & 0xffff], ox + c * 8, oy + r); }
    } else if (mode === 'chars') {
      for (let ch = 0; ch < geom.count; ch++) { const ox = (ch % geom.cols) * 8, oy = Math.floor(ch / geom.cols) * 8; for (let r = 0; r < 8; r++) drawByte(mem[(start + ch * 8 + r) & 0xffff], ox, oy + r); }
    } else {
      for (let cy = 0; cy < 25; cy++) for (let cxx = 0; cxx < 40; cxx++) for (let r = 0; r < 8; r++) drawByte(mem[(start + (cy * 40 + cxx) * 8 + r) & 0xffff], cxx * 8, cy * 8 + r);
    }
    ctx.putImageData(img, 0, 0);
  }, [mem, start, end, mode, mc, geom]);
  const scale = mode === 'bitmap' ? 1 : mode === 'sprite' ? (geom.count === 1 ? 4 : 2) : 2;
  const canvas = <canvas ref={ref} width={geom.w} height={geom.h} className="gfx" style={{ width: Math.min(geom.w * scale, 272), aspectRatio: `${geom.w} / ${geom.h}` }} aria-label={`${mode} preview`} />;
  if (mode !== 'chars' || !onPick) return canvas;
  const rows = Math.ceil(geom.count / geom.cols);
  const picked = pick != null && pick < geom.count ? pick : null;
  return (
    <div className="gfx-pick" title="Click a character to see it enlarged"
      onClick={e => { const r = e.currentTarget.getBoundingClientRect(); const i = charIndexAt((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height, geom.count, geom.cols); if (i != null) onPick(i); }}>
      {canvas}
      {picked != null && <i className="gfx-picked" aria-hidden="true"
        style={{ left: `${(picked % geom.cols) * 100 / geom.cols}%`, top: `${Math.floor(picked / geom.cols) * 100 / rows}%`, width: `${100 / geom.cols}%`, height: `${100 / rows}%` }} />}
    </div>
  );
}

/** One character of the Chars preview enlarged (spec 14.1): its 8 × 8 pixels (multicolour 4 × 8, each two wide) in the
 *  preview's colours with a line between them, and its 8 bytes in hex and bits beside the rows they draw. ← → step to
 *  the character before and after, ↑ ↓ a row of the preview, Home and End to the first and the last, Esc closes it.
 *  `start`: where the preview's first character is; `index`: the one shown; `focus` changes with each click on one in
 *  the preview, which gives it the keys. */
export function CharZoom({ mem, start, index, count, mc, focus, onPick, onClose, onGo }: {
  mem: Uint8Array; start: Addr; index: number; count: number; mc: boolean; focus: number;
  onPick: (i: number) => void; onClose: () => void; onGo: (a: Addr) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { const el = ref.current; if (!el) return; el.focus({ preventScroll: true }); el.scrollIntoView?.({ block: 'nearest' }); }, [focus]);
  const addr = (start + index * 8) & 0xffff;
  const n = charNumber(addr);
  const name = n != null ? `Char $${h2(n)}` : '8 bytes';
  const px = charPixels(mem, addr, mc);
  const bytes = Array.from({ length: 8 }, (_, r) => mem[(addr + r) & 0xffff]);
  return (
    <div ref={ref} className="char-zoom" tabIndex={0} role="group" aria-label={`${name} enlarged`}
      onKeyDown={e => {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); return; }
        const to = charStep(index, e.key, count);
        if (to == null) return;
        e.preventDefault(); e.stopPropagation();
        if (to !== index) onPick(to);
      }}>
      <div className="cz-head">
        <span className="cz-name">{name}</span>
        <button className="linkish mono" title="Go to its bytes in the listing" onClick={() => onGo(addr)}>${h4(addr)}–${h4(addr + 7)}</button>
        <span className="cz-nav">
          <button className="icon-btn" aria-label="Previous character" title="The character before (←)" disabled={index === 0} onClick={() => onPick(index - 1)}><Icon name="left" size={14} /></button>
          <button className="icon-btn" aria-label="Next character" title="The character after (→)" disabled={index >= count - 1} onClick={() => onPick(index + 1)}><Icon name="right" size={14} /></button>
          <button className="icon-btn" aria-label="Close the enlarged character" title="Close (Esc)" onClick={onClose}><Icon name="x" size={14} /></button>
        </span>
      </div>
      <div className="cz-body">
        <div className={cx('cz-grid', mc && 'mc')} role="img" aria-label={`${name}, ${mc ? 'multicolor 4' : '8'} by 8 pixels`}>
          {px.flatMap((row, y) => row.map((c, x) => <i key={y * 8 + x} data-c={c} style={{ background: PAL[c] }} />))}
        </div>
        <div className="cz-bytes mono" aria-label="Its bytes">
          {bytes.map((b, r) => <div key={r}><span className="muted">{h4(addr + r)}</span> <b>{h2(b)}</b> <span>{mc ? charBits(b, true).split(' ').map((p, k) => <i key={k}>{p}</i>) : charBits(b, false)}</span></div>)}
        </div>
      </div>
    </div>
  );
}
