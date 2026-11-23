/* The C64 screen beside a script's code (spec 10.3): what the script printed on its screen (script-screen.ts), drawn
 * as the C64 shows it, with VICE's character ROM, the C64's colours, the border round the 40×25 characters and a
 * blinking cursor. In extended mode the screen has as many columns and rows as the panel has room for at the size of a
 * C64 pixel picked (never fewer than 40×25); a run gets the size the screen has when it starts. While a script is
 * debugged it shows the screen as the run has it now. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { C64_BACKGROUND, C64_BORDER, C64_TEXT, SCREEN_C64, screenRowText, screenSize, type ScreenSize, type ScriptScreen } from '@mimir/core';
import { charRom } from '../lib/charrom';
import { builtinFont } from '../lib/gfxview';
import { Icon } from '../lib/icons';
import { C64, hexRgb } from '../lib/palette';
import { cx } from '../lib/util';
import { SCREEN_ZOOMS } from '../store/scripts';
import { builtinLower } from './C64Screen';

/** the border round the characters, in C64 pixels (VICE shows 32 at each side, 35 above and 37 below) */
const BX = 32, BY = 36;

export interface ScriptScreenProps {
  /** what the run left on its screen (or has on it now, debugging); null: nothing printed yet */
  screen: ScriptScreen | null;
  extended: boolean;
  /** a C64 pixel's size in CSS pixels, in extended mode (made whole pixels of the display: devicePixels) */
  zoom: number;
  /** the size a run gets now */
  size: ScreenSize;
  /** the screen is the debugger's, as the run has it now */
  live: boolean;
  onExtended: (on: boolean) => void;
  onZoom: (z: number) => void;
  /** the size extended mode has room for, when it changes */
  onSize: (s: ScreenSize) => void;
  onCopy: (text: string, what?: string) => void;
  onClose: () => void;
}

/** the display's pixels a C64 pixel takes at a size in CSS pixels: whole ones, so that the letters stay sharp */
const devicePixels = (zoom: number, dpr: number): number => Math.max(1, Math.round(zoom * dpr));

/** VICE's character ROM: 'rom' found, 'none' not found (the built-in letters then), null while it is asked for */
type FontState = { rom: Uint8Array | null; state: 'rom' | 'none' | null };

/** the screen's rows as text: what the C64 shows, `·` for a graphics character */
export const screenLines = (s: ScriptScreen, cols = s.cols, rows = s.rows): string[] => Array.from({ length: Math.min(rows, s.rows) }, (_, r) => {
  const codes = s.codes.subarray(r * s.cols, r * s.cols + Math.min(cols, s.cols));
  return screenRowText({ codes, colors: codes, part: 0 }, s.lower);
});

export function ScriptScreenPanel({ screen, extended, zoom, size, live, onExtended, onZoom, onSize, onCopy, onClose }: ScriptScreenProps) {
  const [font, setFont] = useState<FontState>({ rom: null, state: null });
  useEffect(() => { let on = true; void charRom().then(r => { if (on) setFont({ rom: r?.found ? r.bytes : null, state: r?.found ? 'rom' : 'none' }); }); return () => { on = false; }; }, []);
  const lower = !!screen?.lower;
  const glyphs = useMemo(() => screen?.font ?? (font.rom ? font.rom.subarray(lower ? 0x800 : 0, lower ? 0x1000 : 0x800) : lower ? builtinLower() : builtinFont()), [font.rom, lower, screen?.font]);

  // the room the picture has, in CSS pixels, and the display's pixels to one of them
  const body = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState({ w: 0, h: 0, dpr: window.devicePixelRatio || 1 });
  useEffect(() => {
    const el = body.current;
    if (!el) return;
    const fit = () => setRoom(r => {
      const w = el.clientWidth, h = el.clientHeight, dpr = window.devicePixelRatio || 1;
      return r.w === w && r.h === h && r.dpr === dpr ? r : { w, h, dpr };
    });
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // the size the screen has: the C64's, or in extended mode as many characters as there is room for (at least 40×25)
  const grid: ScreenSize = useMemo(() => {
    if (!extended || !room.w) return { ...SCREEN_C64 };
    const px = room.dpr / devicePixels(zoom, room.dpr);
    return screenSize({ cols: Math.floor((room.w * px - 2 * BX) / 8), rows: Math.floor((room.h * px - 2 * BY) / 8) });
  }, [extended, zoom, room]);
  useEffect(() => { if (extended && room.w && (grid.cols !== size.cols || grid.rows !== size.rows)) onSize(grid); }, [extended, room.w, grid, size, onSize]);

  const pw = grid.cols * 8 + 2 * BX, ph = grid.rows * 8 + 2 * BY;
  // CSS pixels to a C64 pixel: in extended mode the size picked (smaller only when 40×25 does not fit); else as big
  // as fits, in whole pixels of the display when that is at least one
  const scale = useMemo(() => {
    if (!room.w) return 1;
    const fits = Math.min(room.w / pw, room.h / ph);
    if (extended) return Math.min(devicePixels(zoom, room.dpr) / room.dpr, fits);
    return fits * room.dpr >= 1 ? Math.floor(fits * room.dpr) / room.dpr : fits;
  }, [room, pw, ph, extended, zoom]);
  const sharp = Math.abs(scale * room.dpr - Math.round(scale * room.dpr)) < 1e-6 && scale * room.dpr >= 1;

  const border = screen?.border ?? C64_BORDER, background = screen?.background ?? C64_BACKGROUND;
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = canvas.current, ctx = cv?.getContext('2d');
    if (!cv || !ctx) return;
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
  }, [screen, glyphs, grid, pw, ph, border, background]);

  // the cursor: the character under it inverse, in the cursor's colour, blinking (none on a whole C64's screen)
  const cur = screen ? screen.cursor : { col: 0, row: 0, color: C64_TEXT };
  const showCursor = !!cur && cur.col < grid.cols && cur.row < grid.rows;
  const cursorCanvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = cursorCanvas.current, ctx = cv?.getContext('2d');
    if (!cv || !ctx || !cur) return;
    const img = ctx.createImageData(8, 8), px = img.data, rgb = C64.map(hexRgb), fg = rgb[cur.color & 15], bg = rgb[background & 15];
    const code = (screen && cur.row < screen.rows && cur.col < screen.cols ? screen.codes[cur.row * screen.cols + cur.col] : 0x20) ^ 0x80;
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      const [cr, cg, cb] = ((glyphs[code * 8 + y] ?? 0) >> (7 - x)) & 1 ? fg : bg, o = (y * 8 + x) * 4;
      px[o] = cr; px[o + 1] = cg; px[o + 2] = cb; px[o + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }, [screen, cur, glyphs, background]);

  const lines = useMemo(() => (screen ? screenLines(screen, grid.cols, grid.rows) : []), [screen, grid]);
  const other = !!screen && !live && (screen.cols !== grid.cols || screen.rows !== grid.rows);
  const sizeText = `${grid.cols}×${grid.rows}`;
  return (
    <section className="c64s" aria-label="C64 screen">
      <div className="c64s-head">
        <Icon name="screen" size={14} />
        <span className="c64s-title" title="The script's C64 screen. JavaScript prints on it with screen.print(…) (screen.at, screen.color, screen.poke, screen.show …); assembler with JSR $FFD2 (CHROUT, the character in A), $AB1E (a text up to a zero byte at A/Y), $BDCD (the number in A/X) and $FFF0 (PLOT). A script that runs in the whole C64 shows the C64's own screen">C64 screen</span>
        <span className="pill c64s-size" aria-label="Screen size" title={extended ? `Extended mode: ${sizeText} characters, as many as the panel has room for (never fewer than 40×25). A run gets the size the screen has when it starts` : 'The C64\'s 40 columns and 25 rows'}>{sizeText}</span>
        {live && <span className="pill c64s-live" title="Debugging: the screen as the run has it now">now</span>}
        <span className="grow" />
        <label className={cx('c64s-ext', extended && 'on')} title="Extended mode: the screen gets more columns and rows than the C64's 40×25, as many as the panel has room for at the size of a C64 pixel picked beside it (never fewer than 40×25). Drag the panel's edge for more">
          <input type="checkbox" role="switch" className="switch" aria-label="Extended mode" checked={extended} onChange={e => onExtended(e.target.checked)} />
          <span className="lbl">Extended</span>
        </label>
        {extended && <select className="c64s-zoom" aria-label="Pixel size" value={zoom} onChange={e => onZoom(+e.target.value)} title="How big a C64 pixel is: 1× is the C64's own resolution, a pixel a pixel; a larger one gives bigger letters and fewer of them">
          {SCREEN_ZOOMS.map(z => <option key={z} value={z}>{z}×</option>)}
        </select>}
        <button className="icon-btn" aria-label="Copy the screen as text" title="Copy what is on the screen as text" disabled={!screen}
          onClick={() => { if (!screen) return; const l = [...lines]; while (l.length && !l[l.length - 1]) l.pop(); onCopy(l.join('\n'), 'the screen\'s text'); }}><Icon name="copy" size={13} /></button>
        <button className="icon-btn" aria-label="Close the C64 screen" title="Close the C64 screen (what the run printed is kept: open it again to see it)" onClick={onClose}><Icon name="x" size={13} /></button>
      </div>
      <div className="c64s-body" ref={body}>
        <div className="c64s-pic" style={{ width: pw * scale, height: ph * scale }}>
          <canvas ref={canvas} width={pw} height={ph} role="img" aria-label={`C64 screen, ${grid.cols} by ${grid.rows} characters`}
            style={{ width: pw * scale, height: ph * scale, imageRendering: sharp ? 'pixelated' : 'auto' }} />
          {showCursor && <canvas ref={cursorCanvas} className="c64-cursor" width={8} height={8} aria-hidden="true"
            style={{ left: (BX + cur!.col * 8) * scale, top: (BY + cur!.row * 8) * scale, width: 8 * scale, height: 8 * scale, imageRendering: sharp ? 'pixelated' : 'auto' }} />}
        </div>
      </div>
      <pre className="sr-only" aria-label="Text on the C64 screen">{lines.join('\n')}</pre>
      {!screen ? <p className="c64s-note">Nothing printed yet. In JavaScript: <code>screen.print("HELLO")</code>; in assembler: <code>lda #'H'</code> <code>jsr $ffd2</code>.{font.state === 'none' ? ' The letters are Mimir\'s own: VICE\'s character ROM was not found (Settings → Toolchain → VICE).' : ''}</p>
        : other ? <p className="c64s-note">Printed on {screen.cols}×{screen.rows}{screen.c64 ? ' (the whole C64\'s screen)' : ''}: shown from its top left. The next run gets {sizeText}.</p>
        : font.state === 'none' && !screen.font ? <p className="c64s-note">The letters are Mimir's own, without the graphics: VICE's character ROM was not found (Settings → Toolchain → VICE).</p> : null}
    </section>
  );
}
