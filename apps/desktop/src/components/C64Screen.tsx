/* A C64 screen in the Explorer (Settings → General → As on a C64): rows of screen codes and colours core printed, drawn
 * with VICE's character ROM in the C64's colours inside its light blue border, and a blinking cursor where it has one.
 * A file's rows lie over the picture as one item: a click or Enter opens it, + adds it to the project, ↑ ↓ go from
 * file to file, as in Mimir's list. The disk's directory (DiskScreen) and the tape's FOUND lines (TapeScreen) use it. */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { C64_BACKGROUND, C64_BORDER, screenRowText, type DirScreenRow } from '@mimir/core';
import { charRom } from '../lib/charrom';
import { builtinFont } from '../lib/gfxview';
import { Icon } from '../lib/icons';
import { C64, hexRgb } from '../lib/palette';
import { cx } from '../lib/util';

/** rows of the screen one part printed in: a file's (`file`), or text that is only shown (`static`) */
export interface ScreenItem<F> { from: number; n: number; file: F | null; static: boolean }

export interface C64ScreenProps<F> {
  rows: DirScreenRow[];
  /** the lower case character set (Commodore+Shift) */
  lower: boolean;
  /** where the cursor blinks, and its colour; null: no cursor (the C64 is busy) */
  cursor: { row: number; col: number; color: number } | null;
  items: ScreenItem<F>[];
  /** the list's name, for screen readers */
  label: string;
  /** the files that are in the project */
  open: ReadonlySet<F>;
  onOpen: (f: F, add: boolean) => void;
  /** ↑ ↓ Home End from file to file (the Explorer's lists share it): true when the key was one of them */
  listKeys: (e: KeyboardEvent<HTMLElement>) => boolean;
  /** a file's tooltip, its name for screen readers and in the + button's title */
  titleOf: (f: F) => string;
  labelOf: (f: F) => string;
  nameOf: (f: F) => string;
}

/** VICE's ROM: 'rom' found, 'none' not found (the built-in letters then), null while it is asked for */
type FontState = { rom: Uint8Array | null; state: 'rom' | 'none' | null };

/** the built-in letters as a lower case set: its capitals where the C64's lower case set has them, too */
function builtinLower(): Uint8Array {
  const f = builtinFont();
  f.copyWithin(0x41 * 8, 0x01 * 8, 0x1b * 8);
  for (let i = 0; i < 0x400; i++) f[0x400 + i] = f[i] ^ 0xff;
  return f;
}

/** how many of the 40 columns to show: to the widest row's last character, and the cursor */
function columns(rows: DirScreenRow[], cursor: { col: number } | null): number {
  let w = cursor ? cursor.col + 1 : 1;
  for (const r of rows) for (let c = 39; c >= w; c--) if (r.codes[c] !== 0x20) { w = c + 1; break; }
  return w;
}

export function C64Screen<F>({ rows: screenRows, lower: low, cursor, items, label, open, onOpen, listKeys, titleOf, labelOf, nameOf }: C64ScreenProps<F>) {
  const [font, setFont] = useState<FontState>({ rom: null, state: null });
  useEffect(() => { let on = true; void charRom().then(r => { if (on) setFont({ rom: r?.found ? r.bytes : null, state: r?.found ? 'rom' : 'none' }); }); return () => { on = false; }; }, []);
  const glyphs = useMemo(() => (font.rom ? font.rom.subarray(low ? 0x800 : 0, low ? 0x1000 : 0x800) : low ? builtinLower() : builtinFont()), [font.rom, low]);
  const w = useMemo(() => columns(screenRows, cursor), [screenRows, cursor]);
  const rows = screenRows.length;

  const canvas = useRef<HTMLCanvasElement>(null);
  // pixel for pixel while the picture is at least as big as the C64's (in the screen's own pixels), smoothed when the
  // panel is narrower: a pixel dropped here and there would break the letters
  const [sharp, setSharp] = useState(true);
  useEffect(() => {
    const cv = canvas.current;
    if (!cv) return;
    const fit = () => setSharp(cv.clientWidth * window.devicePixelRatio >= cv.width - 0.5);
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(cv);
    return () => ro.disconnect();
  }, [w]);
  useEffect(() => {
    const cv = canvas.current, ctx = cv?.getContext('2d');
    if (!cv || !ctx) return;
    const img = ctx.createImageData(w * 8, rows * 8), px = img.data;
    const rgb = C64.map(hexRgb), bg = rgb[C64_BACKGROUND];
    screenRows.forEach((r, y) => {
      for (let c = 0; c < w; c++) {
        const fg = rgb[r.colors[c] & 15], g = r.codes[c] * 8;
        for (let line = 0; line < 8; line++) {
          const bits = glyphs[g + line];
          for (let x = 0; x < 8; x++) {
            const [cr, cg, cb] = (bits >> (7 - x)) & 1 ? fg : bg, o = ((y * 8 + line) * w * 8 + c * 8 + x) * 4;
            px[o] = cr; px[o + 1] = cg; px[o + 2] = cb; px[o + 3] = 255;
          }
        }
      }
    });
    ctx.putImageData(img, 0, 0);
  }, [screenRows, glyphs, w, rows]);

  const pct = (n: number, of: number) => `${(n / of) * 100}%`;
  const text = (it: ScreenItem<F>) => Array.from({ length: it.n }, (_, k) => screenRowText(screenRows[it.from + k], low)).filter(Boolean).join(' ');
  return (
    <>
      <div className="c64-screen" style={{ background: C64[C64_BORDER] }}>
        <div className="c64-paper" style={{ background: C64[C64_BACKGROUND] }}>
          <canvas ref={canvas} width={w * 8} height={rows * 8} aria-hidden="true" style={{ imageRendering: sharp ? 'pixelated' : 'auto' }} />
          <div className="c64-items" role="list" aria-label={label}>
            {items.map(it => {
              const f = it.file, style = { top: pct(it.from, rows), height: pct(it.n, rows) };
              if (f == null || it.static) return <div key={it.from} role="listitem" className="c64-item static" style={style} aria-label={text(it)} title={f != null ? titleOf(f) : undefined} />;
              const on = open.has(f);
              return (
                <div key={it.from} role="listitem" className={cx('c64-item', on && 'on')} style={style} tabIndex={0} aria-current={on || undefined}
                  aria-label={labelOf(f)} title={titleOf(f)}
                  onClick={() => onOpen(f, false)} onKeyDown={e => { if (listKeys(e)) return; if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); onOpen(f, false); } }}>
                  <button className="icon-btn c64-add" title={`Add ${nameOf(f)} to this project`} aria-label={`Add ${nameOf(f)} to this project`} onClick={e => { e.stopPropagation(); onOpen(f, true); }}><Icon name="plus" size={12} /></button>
                </div>
              );
            })}
          </div>
          {cursor && <div className="c64-cursor" aria-hidden="true" style={{ top: pct(cursor.row, rows), height: pct(1, rows), left: pct(cursor.col, w), width: pct(1, w), background: C64[cursor.color & 15] }} />}
        </div>
      </div>
      {font.state === 'none' && <p className="side-hint">Letters and digits from Mimir's own font, without the graphics: VICE's character ROM was not found (Settings → Toolchain → VICE).</p>}
    </>
  );
}

/** the screen's rows as items: consecutive rows one part printed in are one, and so are those of one file (a tape
 *  file's FOUND and its data block's) */
export function screenItems<F>(rows: DirScreenRow[], fileOf: (part: number) => F | null, opens: (f: F) => boolean): ScreenItem<F>[] {
  const out: ScreenItem<F>[] = [];
  rows.forEach((r, y) => {
    const last = out[out.length - 1], file = fileOf(r.part);
    if (last && (rows[y - 1].part === r.part || (file != null && last.file === file))) { last.n++; return; }
    out.push({ from: y, n: 1, file, static: file == null || !opens(file) });
  });
  return out;
}
