/* Graphics preview: sprites, charset, bitmap (hires or multicolor), and a character or a sprite of it enlarged, where
 * sprites get their colours. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { h2, h4, type Addr, type SpriteColors } from '@mimir/core';
import { C64, cx, hexRgb } from '../lib/util';
import { C64_NAMES } from '../lib/palette';
import type { GfxColors } from '../lib/gfxview';
import { Icon } from '../lib/icons';
import { CHAR_COLS, CHAR_LAST, charBits, charCount, charIndexAt, charNumber, charPixels, charStep, SPRITE_LAST, spriteCols, spriteCount, spriteNumber, spritePixels, spriteStep } from '../lib/charzoom';

export type GfxMode = 'sprite' | 'chars' | 'bitmap';

/** the preview's colours by index: the background (blue), multicolour 01 (light blue) and 10 (yellow), a set pixel (white) */
const PAL = [C64[6], C64[14], C64[7], C64[1]];

/** the colours by index (00, 01, 10, 11/set) of the bit pairs' colours `c`, else the preview's own */
const palOf = (c?: GfxColors): string[] => (c ? [c.bg, c.mc1, c.mc2, c.fg].map(i => C64[i & 15]) : PAL);

/** `pick`/`onPick` (Chars and Sprite): the character or sprite shown enlarged, marked here, and a click on one picks it
 *  (spec 14.1). `colors`: the bit pairs' colours to draw in (sprites: the listing's), else the preview's own */
export function GfxPreview({ mem, start, end, mode, mc, colors, pick, onPick }: { mem: Uint8Array; start: Addr; end: Addr; mode: GfxMode; mc: boolean; colors?: GfxColors; pick?: number | null; onPick?: (i: number) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const geom = useMemo(() => {
    const n = end - start;
    if (mode === 'sprite') { const count = spriteCount(n); const cols = spriteCols(count); return { w: cols * 26, h: Math.ceil(count / cols) * 23, count, cols }; }
    if (mode === 'chars') { const count = charCount(n); const cols = CHAR_COLS; return { w: cols * 8, h: Math.ceil(count / cols) * 8, count, cols }; }
    return { w: 320, h: 200, count: 1, cols: 1 };
  }, [start, end, mode]);
  useEffect(() => {
    const cv = ref.current; if (!cv) return;
    const ctx = cv.getContext('2d')!;
    const img = ctx.createImageData(geom.w, geom.h); const d = img.data;
    const pal = palOf(colors).map(hexRgb);
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
  }, [mem, start, end, mode, mc, geom, colors?.bg, colors?.fg, colors?.mc1, colors?.mc2]); // eslint-disable-line react-hooks/exhaustive-deps
  const scale = mode === 'bitmap' ? 1 : mode === 'sprite' ? (geom.count === 1 ? 4 : 2) : 2;
  const canvas = <canvas ref={ref} width={geom.w} height={geom.h} className="gfx" style={{ width: Math.min(geom.w * scale, 272), aspectRatio: `${geom.w} / ${geom.h}` }} aria-label={`${mode} preview`} />;
  if (mode === 'bitmap' || !onPick) return canvas;
  const rows = Math.ceil(geom.count / geom.cols);
  const picked = pick != null && pick < geom.count ? pick : null;
  return (
    <div className="gfx-pick" title={`Click a ${mode === 'sprite' ? 'sprite' : 'character'} to see it enlarged`}
      onClick={e => { const r = e.currentTarget.getBoundingClientRect(); const i = charIndexAt((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height, geom.count, geom.cols); if (i != null) onPick(i); }}>
      {canvas}
      {picked != null && <i className="gfx-picked" aria-hidden="true"
        style={{ left: `${(picked % geom.cols) * 100 / geom.cols}%`, top: `${Math.floor(picked / geom.cols) * 100 / rows}%`, width: `${100 / geom.cols}%`, height: `${100 / rows}%` }} />}
    </div>
  );
}

/** One character of the Chars preview, or one sprite of the Sprite preview, enlarged (spec 14.1).
 *  A character: its 8 × 8 pixels (multicolour 4 × 8, each two wide) in the preview's colours with a line between them,
 *  and its 8 bytes in hex and bits beside the rows they draw. A sprite: its 24 × 21 pixels (multicolour 12 × 21) as
 *  wide as the inspector lets them be, its 21 rows of 3 bytes under them and the 64th byte, which the VIC does not
 *  draw; the pointer over a row of the pixels or the bytes marks it in both. ← → step to the one before and after, ↑ ↓
 *  a row of the preview, Home and End to the preview's first and last, Esc closes it. Both step through memory, 8 or
 *  64 bytes at a time, past the preview's first and last (a font is often more than the block or selection the cursor
 *  is on; the frames of an animation often follow a block of one sprite), and `where` then says whose bytes they are.
 *  `start`: where the preview's first one is, `count` how many it shows; `addr`: the one shown; `focus` changes with
 *  each click on one in the preview, which gives it the keys. `colors`: the bit pairs' colours it is drawn in (as
 *  GfxPreview); `paint` (a sprite of a sprite block): its colours, which a row of swatches over the pixels changes. */
export function GfxZoom({ kind, mem, start, addr, count, mc, colors, paint, focus, where, onPick, onClose, onGo }: {
  kind: 'chars' | 'sprite'; mem: Uint8Array; start: Addr; addr: Addr; count: number; mc: boolean; colors?: GfxColors; focus: number; where?: string | null;
  paint?: SpritePaint;
  onPick: (a: Addr) => void; onClose: () => void; onGo: (a: Addr) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { const el = ref.current; if (!el) return; el.focus({ preventScroll: true }); el.scrollIntoView?.({ block: 'nearest' }); }, [focus]);
  // the sprite's row under the pointer, in its pixels or its bytes
  const [row, setRow] = useState<number | null>(null);
  const sprite = kind === 'sprite';
  const size = sprite ? 64 : 8;
  // where a key or an arrow takes the one shown: through memory, to its ends
  const step = (key: string): Addr | null => (sprite ? spriteStep : charStep)(addr, key, start, count);
  const prev = addr - size >= 0 ? addr - size : null;
  const next = addr + size <= (sprite ? SPRITE_LAST : CHAR_LAST) ? addr + size : null;
  const n = sprite ? spriteNumber(addr) : charNumber(addr);
  const what = sprite ? 'sprite' : 'character';
  const name = n != null ? `${sprite ? 'Sprite' : 'Char'} $${h2(n)}` : `${size} bytes`;
  const px = sprite ? spritePixels(mem, addr, mc) : charPixels(mem, addr, mc);
  const w = px[0].length;
  const byte = (a: number) => mem[a & 0xffff];
  const pal = palOf(colors);
  return (
    <div ref={ref} className={cx('gfx-zoom', sprite ? 'sprite-zoom' : 'char-zoom')} tabIndex={0} role="group" aria-label={`${name} enlarged`}
      onKeyDown={e => {
        if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); return; }
        const to = step(e.key);
        if (to == null) return;
        e.preventDefault(); e.stopPropagation();
        if (to !== addr) onPick(to);
      }}>
      <div className="cz-head">
        <span className="cz-name" title={sprite && n != null ? `Its sprite pointer: $${h2(n)} in VIC bank ${addr >> 14}` : undefined}>{name}</span>
        <button className="linkish mono" title="Go to its bytes in the listing" onClick={() => onGo(addr)}>${h4(addr)}–${h4(addr + size - 1)}</button>
        <span className="cz-nav">
          <button className="icon-btn" aria-label={`Previous ${what}`} title={`The ${size} bytes before it in memory (←)`} disabled={prev == null} onClick={() => prev != null && onPick(prev)}><Icon name="left" size={14} /></button>
          <button className="icon-btn" aria-label={`Next ${what}`} title={`The ${size} bytes after it in memory (→)`} disabled={next == null} onClick={() => next != null && onPick(next)}><Icon name="right" size={14} /></button>
          <button className="icon-btn" aria-label={`Close the enlarged ${what}`} title="Close (Esc)" onClick={onClose}><Icon name="x" size={14} /></button>
        </span>
      </div>
      {where && <div className="cz-where muted small" title={`Home and End go back to the preview's first and last ${what}`}>{where}</div>}
      {sprite && paint && <SpriteColorRow {...paint} mc={mc} />}
      {sprite ? (
        <div className="cz-body sz-body" onMouseLeave={() => setRow(null)}>
          <div className={cx('cz-grid', 'sz-grid', mc && 'mc')} role="img" aria-label={`${name}, ${mc ? 'multicolor 12' : '24'} by 21 pixels`}
            onMouseOver={e => { const y = (e.target as HTMLElement).dataset.y; setRow(y != null ? +y : null); }}>
            {px.flatMap((r, y) => r.map((c, x) => <i key={y * w + x} data-c={c} data-y={y} className={y === row ? 'on' : undefined} style={{ background: pal[c] }} />))}
          </div>
          {/* the bits go when the inspector is too narrow for them (a container query) */}
          <div className={cx('cz-bytes', 'sz-bytes', 'mono', mc && 'mc')} aria-label="Its bytes">
            {px.map((_, r) => {
              const a = addr + r * 3, b = [0, 1, 2].map(k => byte(a + k));
              return (
                <div key={r} className={r === row ? 'on' : undefined} onMouseEnter={() => setRow(r)}>
                  <span className="muted">{h4(a)}</span> <b>{b.map(h2).join(' ')}</b>
                  <span className="bits">{b.map((v, k) => <span key={k}> <span>{mc ? charBits(v, true).split(' ').map((p, j) => <i key={j}>{p}</i>) : charBits(v, false)}</span></span>)}</span>
                </div>
              );
            })}
            <div className="sz-pad" title="A sprite takes 64 bytes; the VIC draws 63 of them" onMouseEnter={() => setRow(null)}>
              <span className="muted">{h4(addr + 63)}</span> <b>{h2(byte(addr + 63))}</b> <span className="muted">not drawn</span>
            </div>
          </div>
        </div>
      ) : (
        <div className="cz-body">
          <div className={cx('cz-grid', mc && 'mc')} role="img" aria-label={`${name}, ${mc ? 'multicolor 4' : '8'} by 8 pixels`}>
            {px.flatMap((r, y) => r.map((c, x) => <i key={y * w + x} data-c={c} style={{ background: pal[c] }} />))}
          </div>
          <div className="cz-bytes mono" aria-label="Its bytes">
            {px.map((_, r) => { const b = byte(addr + r); return <div key={r}><span className="muted">{h4(addr + r)}</span> <b>{h2(b)}</b> <span>{mc ? charBits(b, true).split(' ').map((p, k) => <i key={k}>{p}</i>) : charBits(b, false)}</span></div>; })}
          </div>
        </div>
      )}
    </div>
  );
}

/** A sprite block's colours in its enlarged sprite: `colors` as drawn now, `own` when they are the block's own (else the
 *  Graphics tab's), `onChange` gives the block colours (null: the Graphics tab's again) */
export interface SpritePaint { colors: SpriteColors; own: boolean; onChange: (c: SpriteColors | null) => void }

/** the sprite's colours, as the VIC gives them; multicolour 1 and 2 only for a multicolour sprite */
const SPRITE_PARTS: { k: keyof SpriteColors; label: string; name: string; hires?: string; multi: string; mcOnly?: true }[] = [
  { k: 'bg', label: 'BG', name: 'Background', hires: 'pixels 0', multi: 'pixels 00' },
  { k: 'sprite', label: 'Sprite', name: 'Sprite colour', hires: 'pixels 1', multi: 'pixels 10' },
  { k: 'mc1', label: 'MC1', name: 'Multicolour 1', multi: 'pixels 01', mcOnly: true },
  { k: 'mc2', label: 'MC2', name: 'Multicolour 2', multi: 'pixels 11', mcOnly: true },
];
const REGISTER: Record<keyof SpriteColors, string> = { bg: '$d021', sprite: '$d027–$d02e', mc1: '$d025', mc2: '$d026' };
/** the palette's swatches a row */
const SWATCH_COLS = 8;
const STEP_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];

/** A swatch for each of the sprite's colours; a click on one opens the 16 C64 colours under them, and a click on one of
 *  those gives it (the palette stays open to try another). The arrows move between the swatches here, not to another
 *  sprite; Esc closes the palette. */
function SpriteColorRow({ colors, own, onChange, mc }: SpritePaint & { mc: boolean }) {
  const [open, setOpen] = useState<keyof SpriteColors | null>(null);
  const parts = SPRITE_PARTS.filter(p => mc || !p.mcOnly);
  const shown = open && parts.some(p => p.k === open) ? open : null;
  const part = SPRITE_PARTS.find(p => p.k === shown);
  const ref = useRef<HTMLDivElement>(null);
  /** moves the focus among the buttons of `sel` in the row: a key's step from the one with it */
  const move = (sel: string, key: string, cols: number) => {
    const els = [...(ref.current?.querySelectorAll<HTMLButtonElement>(sel) ?? [])], i = els.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    const to = key === 'Home' ? 0 : key === 'End' ? els.length - 1 : i + (key === 'ArrowLeft' ? -1 : key === 'ArrowRight' ? 1 : key === 'ArrowUp' ? -cols : cols);
    els[Math.max(0, Math.min(els.length - 1, to))]?.focus();
  };
  return (
    <div ref={ref} className="sz-colors" role="group" aria-label="Sprite colours"
      onKeyDown={e => {
        const t = e.target as HTMLElement;
        if (e.key === 'Escape' && shown) { e.preventDefault(); e.stopPropagation(); setOpen(null); ref.current?.querySelector<HTMLButtonElement>('.sz-chip.on')?.focus(); return; }
        if (!STEP_KEYS.includes(e.key) || e.ctrlKey || e.metaKey || e.altKey) return;
        // the zoom's keys step to another sprite (and the listing's move its cursor): here they move between the swatches
        e.preventDefault(); e.stopPropagation();
        if (t.closest('.sz-palette')) move('.sz-palette button', e.key, SWATCH_COLS);
        else if (t.closest('.sz-chips') && (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End')) move('.sz-chip', e.key, 1);
      }}>
      <div className="sz-chips">
        {parts.map(p => (
          <button key={p.k} type="button" className={cx('sz-chip', shown === p.k && 'on')} aria-expanded={shown === p.k}
            aria-label={`${p.name}: ${C64_NAMES[colors[p.k]]}`} title={`${p.name} (${REGISTER[p.k]}): ${mc ? p.multi : p.hires} · ${C64_NAMES[colors[p.k]]}`}
            onClick={() => setOpen(shown === p.k ? null : p.k)}>
            <i style={{ background: C64[colors[p.k] & 15] }} />{p.label}
          </button>
        ))}
        {own ? <button type="button" className="linkish small sz-tab" onClick={() => onChange(null)} title="Draw the block's sprites in the Graphics tab's colours again, here and in the listing">as the Graphics tab</button>
          : <span className="muted small sz-tab" title="Saved with the block once you pick one: the listing draws its sprites in them">as the Graphics tab</span>}
      </div>
      {part && (
        <div className="sz-palette" role="group" aria-label={`Pick the ${part.name.toLowerCase()}`}>
          {C64.map((hex, i) => (
            <button key={i} type="button" className={cx(colors[part.k] === i && 'on')} aria-pressed={colors[part.k] === i} aria-label={C64_NAMES[i]}
              title={`${i} · ${C64_NAMES[i]}`} style={{ background: hex }} onClick={() => { if (colors[part.k] !== i) onChange({ ...colors, [part.k]: i }); }} />
          ))}
        </div>
      )}
    </div>
  );
}
