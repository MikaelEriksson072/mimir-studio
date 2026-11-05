/* Memory heatmap (inspector, 256 × 256, one pixel per byte, zoomable) and the sidebar's 64 KB strip. */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { findBlock, h2, h4, kindInfo, type Addr, type AnalysisResult } from '@mimir/core';
import { cssVar, cx, GROUP_ORDER, groupOfType, hexRgb } from '../lib/util';
import { HEAT_WHOLE, heatAt, heatAxis, heatCell, heatCenter, heatClamp, heatDetail, heatPan, heatRect, heatRespan, heatShows, heatSpan, heatTexts, heatVisible, heatZoom, heatZoomText, type HeatBox, type HeatView } from '../lib/heatview';
import type { Sel } from '../lib/types';
import type { TypeGroup } from '@mimir/core';

export type Rgb = [number, number, number];
export interface CanvasColors { g: Record<TypeGroup, Rgb>; empty: Rgb; accent: Rgb; heat: Rgb; fg: Rgb; panel: Rgb }
export type HeatMode = 'type' | 'bytes' | 'refs';

export function useCanvasColors(theme: string): CanvasColors {
  return useMemo(() => {
    const g = {} as Record<TypeGroup, Rgb>;
    for (const k of GROUP_ORDER) g[k] = hexRgb(cssVar(`--g-${k}`));
    return { g, empty: hexRgb(cssVar('--map-empty')), accent: hexRgb(cssVar('--accent')), heat: hexRgb(cssVar('--g-table')), fg: hexRgb(cssVar('--fg')), panel: hexRgb(cssVar('--panel')) };
  }, [theme]);
}

interface HeatmapProps {
  A: AnalysisResult; mode: HeatMode; cursor: Addr | null; sel: Sel | null; colors: CanvasColors; fit: boolean;
  /** the labels' names, by address: the map's address `base` + its own (a cartridge bank's map starts at its bank) */
  labels?: ReadonlyMap<Addr, { name: string }>; base?: Addr;
  onNavigate: (a: Addr) => void; onSelect: (start: Addr, end: Addr) => void;
}

/** a byte's colour on the map, by the mode */
function byteRgb(A: AnalysisResult, mode: HeatMode, colors: CanvasColors, heat: Uint16Array, a: Addr): number[] {
  if (A.owner[a] < 0) return colors.empty;
  if (mode === 'type') {
    const base = colors.g[groupOfType(A.tm[a])], k = 0.78 + (A.mem[a] / 255) * 0.32;
    return [Math.min(255, base[0] * k), Math.min(255, base[1] * k), Math.min(255, base[2] * k)];
  }
  if (mode === 'bytes') { const v = A.mem[a] / 255; return colors.empty.map((e, i) => e + (colors.fg[i] - e) * (0.12 + v * 0.88)); }
  const v = heat[a] ? Math.min(1, 0.35 + Math.log2(1 + heat[a]) / 4) : 0;
  return v ? colors.empty.map((e, i) => e + (colors.heat[i] - e) * v) : colors.empty.map((e, i) => e + (colors.fg[i] - e) * 0.06);
}
const rgba = (c: readonly number[], a: number) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

/** The memory map: 256 × 256, one row per page and, as a whole, one pixel per byte. The wheel zooms around the
 *  pointer and a right-drag moves the zoomed map; the closer, the more the bytes show (lib/heatview.ts). */
export function Heatmap({ A, mode, cursor, sel, onNavigate, onSelect, colors, fit, labels, base = 0 }: HeatmapProps) {
  const boxRef = useRef<HTMLDivElement>(null), ref = useRef<HTMLCanvasElement>(null);
  const span = useMemo(() => heatSpan(A.owner, fit), [A, fit]);
  const [size, setSize] = useState<HeatBox>({ w: 254, h: 254 });
  const [dpr, setDpr] = useState(() => window.devicePixelRatio || 1);
  const [view, setView] = useState<HeatView>(HEAT_WHOLE);
  const [hover, setHover] = useState<{ a: Addr; x: number; y: number } | null>(null);
  // the button held on the map: the left one selects from `a`, the right one moves the map from `v`
  const press = useRef<{ btn: number; a: Addr; x: number; y: number; v: HeatView; moved: boolean } | null>(null);
  const [panning, setPanning] = useState(false);
  // where the pointer last moved: pointer events have fractions of a pixel, a wheel's are whole pixels
  const lastPointer = useRef<{ x: number; y: number } | null>(null);
  const V = heatClamp(view, span, size);
  const live = useRef({ V, span, size, onSelect }); live.current = { V, span, size, onSelect };
  const heat = useMemo(() => {
    const h = new Uint16Array(65536);
    for (const [to, l] of A.xrefs) if (to >= 0 && to < 65536) h[to] = Math.min(65535, l.length);
    return h;
  }, [A]);
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    const measure = () => {
      const w = el.clientWidth, h = el.clientHeight;
      if (w > 0 && h > 0) setSize(s => s.w === w && s.h === h ? s : { w, h });
      setDpr(window.devicePixelRatio || 1);
    };
    measure();
    const ro = new ResizeObserver(measure); ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // other pages on the map (Zoom to the loaded pages, another bank): the same zoom, on what was in the middle
  const prevSpan = useRef(span);
  useLayoutEffect(() => {
    const old = prevSpan.current; prevSpan.current = span;
    if (old.p0 === span.p0 && old.rows === span.rows) return;
    setView(v => heatRespan(v, old, span, size));
  }, [span]); // eslint-disable-line react-hooks/exhaustive-deps
  // zoomed in, the map follows the cursor when it moves out of view
  useEffect(() => {
    const { V, span, size } = live.current;
    if (cursor != null && V.z > 1 && !heatShows(V, span, size, cursor)) setView(heatCenter(V, span, size, cursor));
  }, [cursor]);
  const point = (clientX: number, clientY: number) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top };
  };
  // the wheel zooms: a listener of its own, as React's is passive and the inspector must not scroll meanwhile
  useEffect(() => {
    const el = boxRef.current; if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const lp = lastPointer.current, near = lp && Math.abs(lp.x - e.clientX) < 1 && Math.abs(lp.y - e.clientY) < 1;
      const { V, span, size, onSelect } = live.current, p = near ? point(lp.x, lp.y) : point(e.clientX, e.clientY);
      const d = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * 300 : e.deltaY;
      const v = heatZoom(V, span, size, 2 ** (-Math.max(-300, Math.min(300, d)) / 200), p.x, p.y);
      if (v === V) return;
      live.current = { ...live.current, V: v };
      setView(v);
      const a = heatAt(v, span, size, p.x, p.y), held = press.current;
      if (held?.btn === 2) { held.v = v; held.x = e.clientX; held.y = e.clientY; } else setHover({ a, ...p });
      if (held?.btn === 0) onSelect(Math.min(held.a, a), Math.max(held.a, a) + 1);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);
  // the map, one pixel per byte
  const pixels = useMemo(() => {
    const cv = document.createElement('canvas'); cv.width = 256; cv.height = span.rows;
    const ctx = cv.getContext('2d')!, img = ctx.createImageData(256, span.rows), d = img.data, a0 = span.p0 * 256;
    for (let a = a0; a < a0 + span.rows * 256; a++) {
      const c = byteRgb(A, mode, colors, heat, a), o = (a - a0) * 4;
      d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return cv;
  }, [A, mode, colors, heat, span]);
  useEffect(() => {
    const cv = ref.current; if (!cv) return;
    const W = Math.round(size.w * dpr), H = Math.round(size.h * dpr);
    if (cv.width !== W) cv.width = W;
    if (cv.height !== H) cv.height = H;
    const ctx = cv.getContext('2d')!;
    const { cw, ch } = heatCell(span, size, V.z), vis = heatVisible(V, span, size), d = heatDetail(cw, ch);
    const X = (c: number) => c * cw - V.x, Y = (r: number) => r * ch - V.y;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, W, H);
    ctx.imageSmoothingEnabled = false;
    ctx.setTransform(dpr * cw, 0, 0, dpr * ch, -V.x * dpr, -V.y * dpr);
    ctx.drawImage(pixels, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const lo = (span.p0 + vis.r0) * 256, hi = (span.p0 + vis.r1) * 256;
    if (d.grid) {
      // a line between the bytes, and a darker one where a block starts
      const px = 1 / dpr;
      ctx.fillStyle = 'rgba(0,0,0,0.26)';
      for (let c = vis.c0 + 1; c < vis.c1; c++) ctx.fillRect(X(c) - px / 2, 0, px, size.h);
      for (let r = vis.r0 + 1; r < vis.r1; r++) ctx.fillRect(0, Y(r) - px / 2, size.w, px);
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      for (const b of A.blocks) {
        const c = b.start & 255;
        if (b.start >= lo && b.start < hi && c >= vis.c0 && c < vis.c1) ctx.fillRect(X(c) - 1, Y((b.start >> 8) - span.p0), 2, ch);
      }
    }
    if (sel && sel.end > sel.start) {
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      for (let r = vis.r0; r < vis.r1; r++) {
        const row = (span.p0 + r) * 256, s = Math.max(sel.start, row), e = Math.min(sel.end, row + 256);
        if (s < e) ctx.fillRect(X(s - row), Y(r), (e - s) * cw, Math.max(1, ch));
      }
    }
    const font = cssVar('--font-code');
    if (d.font) {
      const top = d.names ? 11 : 0, bot = d.sub ? 11 : 0, o = { hexUpper: A.S.hexCase === 'upper', mnUpper: A.S.mnemonicCase === 'upper' };
      // the value fits between the name tags above it and the line under it
      const size1 = Math.max(8, Math.min(d.font, ch - top - bot - 1)), size2 = Math.min(9, d.font - 1);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (let r = vis.r0; r < vis.r1; r++) for (let c = vis.c0; c < vis.c1; c++) {
        const a = (span.p0 + r) * 256 + c;
        if (A.owner[a] < 0) continue;
        const t = heatTexts(mode, A.mem[a], { ...o, ins: A.insLen[a] > 0 && groupOfType(A.tm[a]) === 'code', refs: heat[a] });
        const rgb = byteRgb(A, mode, colors, heat, a), ink = rgb[0] * 0.299 + rgb[1] * 0.587 + rgb[2] * 0.114 > 150 ? [0, 0, 0] : [255, 255, 255];
        const x = X(c) + cw / 2, y = Y(r);
        if (t.main) {
          ctx.font = `${size1}px ${font}`; ctx.fillStyle = rgba(ink, 0.92);
          ctx.fillText(t.main, x, y + top + (ch - top - bot) / 2 + 0.5, cw - 2);
        }
        if (!d.sub) continue;
        const ys = y + ch - bot / 2 - 1;
        if (t.bits != null) {
          // the bits as pixels, as a sprite or character line has them
          const bw = (cw - 6) / 8;
          for (let i = 0; i < 8; i++) { ctx.fillStyle = rgba(ink, (t.bits >> (7 - i)) & 1 ? 0.85 : 0.16); ctx.fillRect(X(c) + 3 + i * bw, ys - 2, bw - 0.5, 4); }
        } else if (t.sub) {
          ctx.font = `${size2}px ${font}`; ctx.fillStyle = rgba(ink, t.main ? 0.7 : 0.5);
          ctx.fillText(t.sub, x, ys, cw - 2);
        }
      }
    }
    if (cursor != null) {
      const rr = heatRect(V, span, size, cursor);
      if (rr) {
        ctx.strokeStyle = cssVar('--accent-hi'); ctx.lineWidth = 2;
        if (rr.w >= 8) ctx.strokeRect(rr.x + 1, rr.y + 1, rr.w - 2, rr.h - 2);
        else ctx.strokeRect(rr.x + rr.w / 2 - 3, rr.y + rr.h / 2 - 3, 6, 6);
      }
    }
    if (d.names && labels) {
      // a tag with the name where a label is, as far as the next one in the row (over the cursor, to be read)
      ctx.font = `8px ${font}`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      for (let r = vis.r0; r < vis.r1; r++) {
        const tags: { c: number; name: string }[] = [];
        for (let c = vis.c0; c < vis.c1; c++) { const l = labels.get(base + (span.p0 + r) * 256 + c); if (l) tags.push({ c, name: l.name }); }
        tags.forEach((t, i) => {
          const x = X(t.c) + 1, y = Y(r) + 1, end = i + 1 < tags.length ? X(tags[i + 1].c) - 1 : size.w;
          const w = Math.min(ctx.measureText(t.name).width + 6, end - x);
          ctx.fillStyle = rgba(colors.panel, 0.9); ctx.fillRect(x, y, w, 10);
          ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, 10); ctx.clip();
          ctx.fillStyle = rgba(colors.fg, 1); ctx.fillText(t.name, x + 3, y + 5.5);
          ctx.restore();
        });
      }
    }
  }, [A, mode, colors, heat, span, pixels, V, size, dpr, sel, cursor, labels, base]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.button !== 2) return;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* a pointer that is not down any more */ }
    const p = point(e.clientX, e.clientY);
    press.current = { btn: e.button, a: heatAt(V, span, size, p.x, p.y), x: e.clientX, y: e.clientY, v: V, moved: false };
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    lastPointer.current = { x: e.clientX, y: e.clientY };
    const p = point(e.clientX, e.clientY), held = press.current;
    if (held?.btn === 2) {
      const dx = e.clientX - held.x, dy = e.clientY - held.y;
      if (!held.moved && Math.hypot(dx, dy) < 4) return;
      if (!held.moved) { held.moved = true; setPanning(true); setHover(null); }
      setView(heatPan(held.v, span, size, dx, dy));
      return;
    }
    const a = heatAt(V, span, size, p.x, p.y);
    setHover({ a, ...p });
    if (held?.btn === 0) onSelect(Math.min(held.a, a), Math.max(held.a, a) + 1);
  };
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const held = press.current; press.current = null; setPanning(false);
    if (!held) return;
    const p = point(e.clientX, e.clientY), a = heatAt(V, span, size, p.x, p.y);
    // a click jumps there, with either button; the right one that moved the map does not
    if (held.btn === 0 ? held.a === a : !held.moved) onNavigate(a);
    if (held.moved) setHover({ a, ...p });
  };
  const b = hover ? findBlock(A.blocks, hover.a) : null;
  const bName = b && labels?.get(base + b.start)?.name;
  const zoomed = V.z > 1;
  const shown = zoomed ? `, zoomed ${heatZoomText(V.z)} on $${h4(heatAt(V, span, size, 0, 0))}–$${h4(heatAt(V, span, size, size.w - 1, size.h - 1))}` : '';
  return (
    <div className="heat-wrap">
      <div ref={boxRef} className={cx('heat', zoomed && 'zoomed', panning && 'panning')} role="img" aria-label={`Memory map of all 64 KB, one pixel per byte, colored by classification${shown}`}
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}
        onPointerCancel={() => { press.current = null; setPanning(false); }}
        onPointerLeave={() => { if (!press.current) setHover(null); }}
        onContextMenu={e => e.preventDefault()}>
        <canvas ref={ref} />
        <div className="heat-axis">{heatAxis(V, span, size).map(l => <span key={l.a} style={{ top: l.y }}>${h4(l.a)}</span>)}</div>
        {zoomed && (
          <div className="heat-zoom" onPointerDown={e => e.stopPropagation()}>
            <span className="mono">{heatZoomText(V.z)}</span>
            <button title="Zoom out to the whole map (or turn the wheel back)" onClick={() => setView(HEAT_WHOLE)}>Whole map</button>
          </div>
        )}
      </div>
      {hover && (
        <div className="heat-tip" style={{ left: Math.min(hover.x + 12, 150), top: hover.y + 14 }}>
          <b>${h4(hover.a)}</b> <span className="mono">${h2(A.mem[hover.a])}</span><br />
          {A.owner[hover.a] < 0 ? 'not loaded' : `${bName ? `${bName} · ` : ''}${b ? kindInfo(b.type).label : ''}${A.xrefs.get(hover.a) ? ` · ${A.xrefs.get(hover.a)!.length} refs` : ''}`}
        </div>
      )}
    </div>
  );
}

/** Sidebar strip: 64 KB as a vertical bar, 256 bytes per pixel row. */
export function MemoryStrip({ A, colors, cursor, onNavigate }: { A: AnalysisResult; colors: CanvasColors; cursor: Addr | null; onNavigate: (a: Addr) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current; if (!cv) return;
    const ctx = cv.getContext('2d')!; const img = ctx.createImageData(16, 256);
    for (let y = 0; y < 256; y++) {
      const counts: Partial<Record<TypeGroup, number>> = {};
      for (let i = 0; i < 256; i++) { const a = y * 256 + i; if (A.owner[a] >= 0) { const g = groupOfType(A.tm[a]); counts[g] = (counts[g] || 0) + 1; } }
      let x = 0;
      for (const g of GROUP_ORDER) { const n = Math.round((counts[g] || 0) / 16); for (let k = 0; k < n && x < 16; k++, x++) { const o = (y * 16 + x) * 4; const c = colors.g[g]; img.data.set([c[0], c[1], c[2], 255], o); } }
      for (; x < 16; x++) { const o = (y * 16 + x) * 4; const c = colors.empty; img.data.set([c[0], c[1], c[2], 255], o); }
    }
    ctx.putImageData(img, 0, 0);
  }, [A, colors]);
  return (
    <div className="strip-wrap">
      <div className="strip-scale">{['$0000', '$4000', '$8000', '$c000', '$ffff'].map(t => <span key={t}>{t}</span>)}</div>
      <div className="strip" onClick={e => { const r = e.currentTarget.getBoundingClientRect(); onNavigate(Math.floor((e.clientY - r.top) / r.height * 256) * 256); }}>
        <canvas ref={ref} width="16" height="256" />
        {cursor != null && <div className="strip-cur" style={{ top: `${(cursor / 65536) * 100}%` }} />}
      </div>
    </div>
  );
}
