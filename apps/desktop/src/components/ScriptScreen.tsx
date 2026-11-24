/* The C64 screen beside a script's code (spec 10.3): what the script printed on its screen (script-screen.ts), drawn
 * as the C64 shows it, with VICE's character ROM, the C64's colours, the border round the 40×25 characters and a
 * blinking cursor. Its Zoom makes it as big as the panel has room for (Fit) or bigger (1×–8×: the panel scrolls, a drag
 * moves it, Ctrl+wheel zooms at the pointer), and Show large shows it as big as the window has room for, over the
 * window, until a click or Esc. In extended mode the screen has as many columns and rows as the panel has room for at
 * the size of a C64 pixel picked (never fewer than 40×25); a run gets the size the screen has when it starts. While a
 * script is debugged it shows the screen as the run has it now. */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { C64_BACKGROUND, C64_BORDER, C64_TEXT, SCREEN_C64, screenRowText, screenSize, type ScreenSize, type ScriptScreen } from '@mimir/core';
import { charRom } from '../lib/charrom';
import { builtinFont } from '../lib/gfxview';
import { Icon } from '../lib/icons';
import { C64, hexRgb } from '../lib/palette';
import { cx } from '../lib/util';
import { SCREEN_MAGS, SCREEN_ZOOMS } from '../store/scripts';
import { builtinLower } from './C64Screen';

/** the border round the characters, in C64 pixels (VICE shows 32 at each side, 35 above and 37 below) */
const BX = 32, BY = 36;

export interface ScriptScreenProps {
  /** what the run left on its screen (or has on it now, debugging); null: nothing printed yet */
  screen: ScriptScreen | null;
  extended: boolean;
  /** a C64 pixel's size in CSS pixels, in extended mode (made whole pixels of the display: devicePixels) */
  zoom: number;
  /** the zoom of the 40×25 screen: 0 Fit (as big as the panel has room for), else a C64 pixel's size in CSS pixels
   *  (SCREEN_MAGS, made whole pixels of the display), the panel scrolling when the screen is bigger */
  mag: number;
  /** the size a run gets now */
  size: ScreenSize;
  /** the screen is the debugger's, as the run has it now */
  live: boolean;
  onExtended: (on: boolean) => void;
  onZoom: (z: number) => void;
  onMag: (m: number) => void;
  /** the size extended mode has room for, when it changes */
  onSize: (s: ScreenSize) => void;
  onCopy: (text: string, what?: string) => void;
  onClose: () => void;
}

/** the display's pixels a C64 pixel takes at a size in CSS pixels: whole ones, so that the letters stay sharp */
const devicePixels = (zoom: number, dpr: number): number => Math.max(1, Math.round(zoom * dpr));

/** CSS pixels to a C64 pixel for a picture as big as a room has space for: in whole pixels of the display when that
 *  makes it at most a tenth smaller (the sharpest), else all of the room */
const fitScale = (w: number, h: number, pw: number, ph: number, dpr: number): number => {
  const fits = Math.min(w / pw, h / ph), whole = Math.floor(fits * dpr) / dpr;
  return whole > 0 && whole >= fits * 0.9 ? whole : fits;
};

/** How a picture is drawn at a scale: `k` canvas pixels to a C64 pixel, and whether the browser then shows the canvas
 *  pixel for pixel. In whole pixels of the display it is drawn as it is, pixel for pixel; between them it is drawn sharp
 *  at the next whole size and made smaller smoothly, which keeps the letters as sharp as they can be at that size (too
 *  big to draw larger: pixel for pixel, where the uneven pixels no longer show). */
const drawing = (scale: number, dpr: number, pw: number, ph: number): { k: number; pixelated: boolean } => {
  const d = scale * dpr;
  if (d >= 1 && Math.abs(d - Math.round(d)) < 1e-6) return { k: 1, pixelated: true };
  const k = Math.ceil(d);
  if (k <= 1) return { k: 1, pixelated: false };
  return k <= 4 && pw * ph * k * k <= 16e6 ? { k, pixelated: false } : { k: 1, pixelated: true };
};

/** the room an element gives what is in it, in CSS pixels, and the display's pixels to one of them */
type Room = { w: number; h: number; dpr: number };
function useRoom(el: HTMLElement | null): Room {
  const [room, setRoom] = useState<Room>({ w: 0, h: 0, dpr: window.devicePixelRatio || 1 });
  useEffect(() => {
    if (!el) return;
    const fit = () => setRoom(r => {
      const w = el.clientWidth, h = el.clientHeight, dpr = window.devicePixelRatio || 1;
      return r.w === w && r.h === h && r.dpr === dpr ? r : { w, h, dpr };
    });
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return room;
}

/** VICE's character ROM: 'rom' found, 'none' not found (the built-in letters then), null while it is asked for */
type FontState = { rom: Uint8Array | null; state: 'rom' | 'none' | null };

/** the screen's rows as text: what the C64 shows, `·` for a graphics character */
export const screenLines = (s: ScriptScreen, cols = s.cols, rows = s.rows): string[] => Array.from({ length: Math.min(rows, s.rows) }, (_, r) => {
  const codes = s.codes.subarray(r * s.cols, r * s.cols + Math.min(cols, s.cols));
  return screenRowText({ codes, colors: codes, part: 0 }, s.lower);
});

/** where the cursor is and its character as it blinks (8×8) */
type CursorPic = { col: number; row: number; glyph: HTMLCanvasElement };

/** The screen's picture (a C64 pixel a canvas pixel in `base`) at a scale, with the blinking cursor. */
function Picture({ base, cursor, scale, dpr, label }: { base: HTMLCanvasElement; cursor: CursorPic | null; scale: number; dpr: number; label: string }) {
  const pw = base.width, ph = base.height, { k, pixelated } = drawing(scale, dpr, pw, ph);
  const cv = useRef<HTMLCanvasElement>(null), cc = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const ctx = cv.current?.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(base, 0, 0, pw * k, ph * k);
  }, [base, k, pw, ph]);
  const glyph = cursor?.glyph ?? null;
  useLayoutEffect(() => {
    const ctx = cc.current?.getContext('2d');
    if (!ctx || !glyph) return;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(glyph, 0, 0, 8 * k, 8 * k);
  }, [glyph, k]);
  const rendering = pixelated ? 'pixelated' : 'auto';
  return (
    <div className="c64s-pic" style={{ width: pw * scale, height: ph * scale }}>
      <canvas ref={cv} width={pw * k} height={ph * k} role="img" aria-label={label} style={{ width: pw * scale, height: ph * scale, imageRendering: rendering }} />
      {cursor && <canvas ref={cc} className="c64-cursor" width={8 * k} height={8 * k} aria-hidden="true"
        style={{ left: (BX + cursor.col * 8) * scale, top: (BY + cursor.row * 8) * scale, width: 8 * scale, height: 8 * scale, imageRendering: rendering }} />}
    </div>
  );
}

export function ScriptScreenPanel({ screen, extended, zoom, mag, size, live, onExtended, onZoom, onMag, onSize, onCopy, onClose }: ScriptScreenProps) {
  const [font, setFont] = useState<FontState>({ rom: null, state: null });
  useEffect(() => { let on = true; void charRom().then(r => { if (on) setFont({ rom: r?.found ? r.bytes : null, state: r?.found ? 'rom' : 'none' }); }); return () => { on = false; }; }, []);
  const lower = !!screen?.lower;
  const glyphs = useMemo(() => screen?.font ?? (font.rom ? font.rom.subarray(lower ? 0x800 : 0, lower ? 0x1000 : 0x800) : lower ? builtinLower() : builtinFont()), [font.rom, lower, screen?.font]);

  // the room the picture has in the panel
  const [body, setBody] = useState<HTMLDivElement | null>(null);
  const room = useRoom(body);

  // the size the screen has: the C64's, or in extended mode as many characters as there is room for (at least 40×25)
  const grid: ScreenSize = useMemo(() => {
    if (!extended || !room.w) return { ...SCREEN_C64 };
    const px = room.dpr / devicePixels(zoom, room.dpr);
    return screenSize({ cols: Math.floor((room.w * px - 2 * BX) / 8), rows: Math.floor((room.h * px - 2 * BY) / 8) });
  }, [extended, zoom, room]);
  useEffect(() => { if (extended && room.w && (grid.cols !== size.cols || grid.rows !== size.rows)) onSize(grid); }, [extended, room.w, grid, size, onSize]);

  const pw = grid.cols * 8 + 2 * BX, ph = grid.rows * 8 + 2 * BY;
  // CSS pixels to a C64 pixel: in extended mode the size picked (smaller only when 40×25 does not fit); else the zoom
  // picked, or (Fit) as big as the panel has room for
  const fit = room.w ? fitScale(room.w, room.h, pw, ph, room.dpr) : 1;
  const zoomed = !extended && mag > 0;
  const scale = !room.w ? 1 : extended ? Math.min(devicePixels(zoom, room.dpr) / room.dpr, Math.min(room.w / pw, room.h / ph))
    : zoomed ? devicePixels(mag, room.dpr) / room.dpr : fit;

  const border = screen?.border ?? C64_BORDER, background = screen?.background ?? C64_BACKGROUND;
  // the picture, a C64 pixel a pixel
  const base = useMemo(() => {
    const cv = document.createElement('canvas');
    cv.width = pw; cv.height = ph;
    const ctx = cv.getContext('2d');
    if (!ctx) return cv;
    const img = ctx.createImageData(pw, ph), px = img.data;
    const rgb = C64.map(hexRgb), [br, bgc, bb] = rgb[border & 15], bg = rgb[background & 15];
    for (let o = 0; o < px.length; o += 4) { px[o] = br; px[o + 1] = bgc; px[o + 2] = bb; px[o + 3] = 255; }
    for (let r = 0; r < grid.rows; r++) for (let c = 0; c < grid.cols; c++) {
      const on = !!screen && r < screen.rows && c < screen.cols, k = on ? r * screen!.cols + c : 0;
      const code = on ? screen!.codes[k] : 0x20, fg = rgb[on ? screen!.colors[k] & 15 : C64_TEXT];
      for (let y = 0; y < 8; y++) {
        const bits = glyphs[code * 8 + y] ?? 0, row = (BY + r * 8 + y) * pw + BX + c * 8;
        for (let x = 0; x < 8; x++) {
          const [cr, cg, cb] = (bits >> (7 - x)) & 1 ? fg : bg, o = (row + x) * 4;
          px[o] = cr; px[o + 1] = cg; px[o + 2] = cb;
        }
      }
    }
    ctx.putImageData(img, 0, 0);
    return cv;
  }, [screen, glyphs, grid, pw, ph, border, background]);

  // the cursor: the character under it inverse, in the cursor's colour, blinking (none on a whole C64's screen)
  const cur = screen ? screen.cursor : { col: 0, row: 0, color: C64_TEXT };
  const cursorGlyph = useMemo(() => {
    if (!cur) return null;
    const cv = document.createElement('canvas');
    cv.width = 8; cv.height = 8;
    const ctx = cv.getContext('2d');
    if (!ctx) return cv;
    const img = ctx.createImageData(8, 8), px = img.data, rgb = C64.map(hexRgb), fg = rgb[cur.color & 15], bg = rgb[background & 15];
    const code = (screen && cur.row < screen.rows && cur.col < screen.cols ? screen.codes[cur.row * screen.cols + cur.col] : 0x20) ^ 0x80;
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      const [cr, cg, cb] = ((glyphs[code * 8 + y] ?? 0) >> (7 - x)) & 1 ? fg : bg, o = (y * 8 + x) * 4;
      px[o] = cr; px[o + 1] = cg; px[o + 2] = cb; px[o + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return cv;
  }, [screen, cur?.col, cur?.row, cur?.color, glyphs, background]); // eslint-disable-line react-hooks/exhaustive-deps
  const cursor: CursorPic | null = cur && cursorGlyph && cur.col < grid.cols && cur.row < grid.rows ? { col: cur.col, row: cur.row, glyph: cursorGlyph } : null;

  // zooming keeps the point of the screen under the pointer (or the panel's middle) where it was
  const anchor = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const zoomTo = (m: number, px?: number, py?: number) => {
    const pic = body?.querySelector<HTMLElement>('.c64s-pic');
    if (body && pic) {
      const ax = px ?? body.clientWidth / 2, ay = py ?? body.clientHeight / 2;
      anchor.current = { x: (body.scrollLeft + ax - pic.offsetLeft) / scale, y: (body.scrollTop + ay - pic.offsetTop) / scale, px: ax, py: ay };
    }
    onMag(m);
  };
  useLayoutEffect(() => {
    const a = anchor.current, pic = body?.querySelector<HTMLElement>('.c64s-pic');
    anchor.current = null;
    if (!a || !body || !pic) return;
    body.scrollLeft = a.x * scale + pic.offsetLeft - a.px;
    body.scrollTop = a.y * scale + pic.offsetTop - a.py;
  }, [scale, body]);
  // the zooms in order of size: Fit where it comes, and the whole sizes (in extended mode the size of a C64 pixel)
  const steps = extended ? SCREEN_ZOOMS.map(z => ({ m: z, s: devicePixels(z, room.dpr) / room.dpr }))
    : [{ m: 0, s: fit }, ...SCREEN_MAGS.map(m => ({ m, s: devicePixels(m, room.dpr) / room.dpr }))];
  /** the next zoom up (dir 1) or down (-1) from the size shown now; null at the end */
  const stepFrom = (dir: 1 | -1): number | null => {
    const now = extended ? devicePixels(zoom, room.dpr) / room.dpr : scale;
    const next = steps.filter(o => (dir > 0 ? o.s > now + 1e-6 : o.s < now - 1e-6)).sort((a, b) => dir * (a.s - b.s))[0];
    return next ? next.m : null;
  };
  // Ctrl+wheel over the screen zooms (not the window); a wheel without Ctrl scrolls a zoomed screen
  const wheel = useRef<(e: WheelEvent) => void>(() => {});
  const lastWheel = useRef(0);
  wheel.current = e => {
    if (!e.ctrlKey || !body) return;
    e.preventDefault();
    if (!e.deltaY || e.timeStamp - lastWheel.current < 80) return;
    lastWheel.current = e.timeStamp;
    const m = stepFrom(e.deltaY < 0 ? 1 : -1);
    if (m == null) return;
    if (extended) { onZoom(m); return; }
    const r = body.getBoundingClientRect();
    zoomTo(m, e.clientX - r.left, e.clientY - r.top);
  };
  useEffect(() => {
    if (!body) return;
    const f = (e: WheelEvent) => wheel.current(e);
    body.addEventListener('wheel', f, { passive: false });
    return () => body.removeEventListener('wheel', f);
  }, [body]);
  // a zoomed screen bigger than the panel moves with a drag
  const scrolls = zoomed && room.w > 0 && (pw * scale > room.w + 0.5 || ph * scale > room.h + 0.5);
  const pan = useRef<{ x: number; y: number; left: number; top: number } | null>(null);

  // shown large, over the window: as big as the window has room for, until a click or Esc
  const [large, setLarge] = useState(false);
  const [bigBody, setBigBody] = useState<HTMLDivElement | null>(null);
  const bigRoom = useRoom(bigBody);
  const largeBtn = useRef<HTMLButtonElement>(null), bigClose = useRef<HTMLButtonElement>(null);
  const closeLarge = () => { setLarge(false); largeBtn.current?.focus(); };
  useEffect(() => {
    if (!large) return;
    bigClose.current?.focus();
    // Esc puts it back, and only that (not leaving the editor's full screen as well)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setLarge(false); largeBtn.current?.focus(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [large]);

  const lines = useMemo(() => (screen ? screenLines(screen, grid.cols, grid.rows) : []), [screen, grid]);
  const other = !!screen && !live && (screen.cols !== grid.cols || screen.rows !== grid.rows);
  const sizeText = `${grid.cols}×${grid.rows}`;
  const label = `C64 screen, ${grid.cols} by ${grid.rows} characters`;
  return (
    <section className="c64s" aria-label="C64 screen">
      <div className="c64s-head">
        <Icon name="screen" size={14} />
        <span className="c64s-title" title="The script's C64 screen. JavaScript prints on it with screen.print(…) (screen.at, screen.color, screen.poke, screen.show …); assembler with JSR $FFD2 (CHROUT, the character in A), $AB1E (a text up to a zero byte at A/Y), $BDCD (the number in A/X) and $FFF0 (PLOT). It is in the memory as on a C64: STA $0400 puts a character on it, STA $D800 colours it, $D020 and $D021 are the border and the background (mem[0x0400] in JavaScript; in extended mode the top left 40×25). A script that runs in the whole C64 shows the C64's own screen">C64 screen</span>
        <span className="pill c64s-size" aria-label="Screen size" title={extended ? `Extended mode: ${sizeText} characters, as many as the panel has room for (never fewer than 40×25). A run gets the size the screen has when it starts` : 'The C64\'s 40 columns and 25 rows'}>{sizeText}</span>
        {live && <span className="pill c64s-live" title="Debugging: the screen as the run has it now">now</span>}
        <span className="grow" />
        <label className={cx('c64s-ext', extended && 'on')} title="Extended mode: the screen gets more columns and rows than the C64's 40×25, as many as the panel has room for at the size of a C64 pixel picked beside it (never fewer than 40×25). Drag the panel's edge for more">
          <input type="checkbox" role="switch" className="switch" aria-label="Extended mode" checked={extended} onChange={e => onExtended(e.target.checked)} />
          <span className="lbl">Extended</span>
        </label>
        {extended
          ? <select className="c64s-zoom" aria-label="Pixel size" value={zoom} onChange={e => onZoom(+e.target.value)} title="How big a C64 pixel is: 1× is the C64's own resolution, a pixel a pixel; a larger one gives bigger letters and fewer of them (Ctrl+wheel over the screen)">
            {SCREEN_ZOOMS.map(z => <option key={z} value={z}>{z}×</option>)}
          </select>
          : <select className="c64s-zoom" aria-label="Zoom" value={mag} onChange={e => zoomTo(+e.target.value)} title="Zoom: Fit makes the screen as big as the panel has room for; 1×–8× make a C64 pixel that many pixels, and a screen bigger than the panel scrolls (drag it, or use the wheel). Ctrl+wheel over the screen zooms at the pointer; Show large (beside) shows it as big as the window">
            <option value={0}>Fit</option>
            {SCREEN_MAGS.map(m => <option key={m} value={m}>{m}×</option>)}
          </select>}
        <button ref={largeBtn} className="icon-btn" aria-label="Show the screen large" aria-pressed={large} title="Show the screen large: as big as the window has room for, over it (a click or Esc puts it back; a double-click on the screen does the same). While debugging it shows the run as it goes" onClick={() => setLarge(true)}><Icon name="zoomin" size={14} /></button>
        <button className="icon-btn" aria-label="Copy the screen as text" title="Copy what is on the screen as text" disabled={!screen}
          onClick={() => { if (!screen) return; const l = [...lines]; while (l.length && !l[l.length - 1]) l.pop(); onCopy(l.join('\n'), 'the screen\'s text'); }}><Icon name="copy" size={13} /></button>
        <button className="icon-btn" aria-label="Close the C64 screen" title="Close the C64 screen (what the run printed is kept: open it again to see it)" onClick={onClose}><Icon name="x" size={13} /></button>
      </div>
      <div className={cx('c64s-body', zoomed && 'zoomed', scrolls && 'pan')} ref={setBody}
        onPointerDown={e => {
          if (!scrolls || e.button !== 0 || !body) return;
          pan.current = { x: e.clientX, y: e.clientY, left: body.scrollLeft, top: body.scrollTop };
          body.setPointerCapture(e.pointerId);
          e.preventDefault();
        }}
        onPointerMove={e => { const p = pan.current; if (!p || !body) return; body.scrollLeft = p.left - (e.clientX - p.x); body.scrollTop = p.top - (e.clientY - p.y); }}
        onPointerUp={() => { pan.current = null; }} onPointerCancel={() => { pan.current = null; }} onDoubleClick={() => setLarge(true)}>
        <Picture base={base} cursor={cursor} scale={scale} dpr={room.dpr} label={label} />
      </div>
      <pre className="sr-only" aria-label="Text on the C64 screen">{lines.join('\n')}</pre>
      {!screen ? <p className="c64s-note">Nothing printed yet. In JavaScript: <code>screen.print("HELLO")</code>; in assembler: <code>lda #'H'</code> <code>jsr $ffd2</code>, or a screen code into <code>$0400</code> and its colour into <code>$d800</code>, as on a C64.{font.state === 'none' ? ' The letters are Mimir\'s own: VICE\'s character ROM was not found (Settings → Toolchain → VICE).' : ''}</p>
        : other ? <p className="c64s-note">Printed on {screen.cols}×{screen.rows}{screen.c64 ? ' (the whole C64\'s screen)' : ''}: shown from its top left. The next run gets {sizeText}.</p>
        : font.state === 'none' && !screen.font ? <p className="c64s-note">The letters are Mimir's own, without the graphics: VICE's character ROM was not found (Settings → Toolchain → VICE).</p> : null}
      {large && createPortal(
        <div className="c64s-large" role="dialog" aria-modal="true" aria-label="The C64 screen, large">
          <div className="c64s-large-head">
            <Icon name="screen" size={14} /><span className="c64s-title">C64 screen</span>
            <span className="pill c64s-size">{sizeText}</span>
            {live && <span className="pill c64s-live">now</span>}
            <span className="grow" />
            <span className="c64s-large-hint">A click or Esc puts it back</span>
            <button ref={bigClose} className="icon-btn" aria-label="Close the large screen" title="Put the screen back beside the code (Esc)" onClick={closeLarge}><Icon name="x" size={14} /></button>
          </div>
          <div className="c64s-large-body" ref={setBigBody} onClick={closeLarge}>
            {bigRoom.w > 0 && <Picture base={base} cursor={cursor} scale={fitScale(bigRoom.w, bigRoom.h, pw, ph, bigRoom.dpr)} dpr={bigRoom.dpr} label={`${label}, large`} />}
          </div>
        </div>,
        document.body,
      )}
    </section>
  );
}
