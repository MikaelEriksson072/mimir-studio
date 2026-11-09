/* The mounted disk's directory as a C64 shows it after LOAD"$",8 and LIST (Settings → General → The disk in the
 * Explorer): the screen core's directoryScreen prints, drawn with VICE's character ROM in the C64's colours inside its
 * light blue border, the cursor blinking after READY. A file's rows lie over the picture as one item: a click or Enter
 * opens it, + adds it to the project, ↑ ↓ go from file to file, as in Mimir's list. A file the directory's own control
 * codes leave off the screen is listed under it. */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { C64_BACKGROUND, C64_BORDER, directoryScreen, screenRowText, type D64File, type DirScreen } from '@mimir/core';
import { charRom } from '../lib/charrom';
import { builtinFont } from '../lib/gfxview';
import { Icon } from '../lib/icons';
import { C64, hexRgb } from '../lib/palette';
import { cx } from '../lib/util';
import type { MountedDisk } from '../lib/types';

interface DiskScreenProps {
  disk: MountedDisk;
  /** the disk's files that are in the project */
  open: ReadonlySet<D64File>;
  /** the lower case character set (Commodore+Shift); null: as the listing leaves it */
  lower: boolean | null;
  onOpenFromDisk: (f: D64File, add: boolean) => void;
  /** ↑ ↓ Home End from file to file (the Explorer's lists share it): true when the key was one of them */
  listKeys: (e: KeyboardEvent<HTMLElement>) => boolean;
  /** a file's tooltip, as Mimir's list has it */
  titleOf: (f: D64File) => string;
  /** the type as the directory writes it: `*PRG`, `PRG<` */
  kindOf: (f: D64File) => string;
}

/** the rows of the screen, a part of the listing each: consecutive rows one part printed in */
interface Item { from: number; n: number; file: D64File | null; static: boolean }

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
function columns(s: DirScreen): number {
  let w = s.cursor.col + 1;
  for (const r of s.rows) for (let c = 39; c >= w; c--) if (r.codes[c] !== 0x20) { w = c + 1; break; }
  return w;
}

export function DiskScreen({ disk, open, lower, onOpenFromDisk, listKeys, titleOf, kindOf }: DiskScreenProps) {
  const screen = useMemo(() => directoryScreen(disk.bytes), [disk.bytes]);
  const [font, setFont] = useState<FontState>({ rom: null, state: null });
  useEffect(() => { let on = true; void charRom().then(r => { if (on) setFont({ rom: r?.found ? r.bytes : null, state: r?.found ? 'rom' : 'none' }); }); return () => { on = false; }; }, []);
  const low = lower ?? screen.lower;
  const glyphs = useMemo(() => (font.rom ? font.rom.subarray(low ? 0x800 : 0, low ? 0x1000 : 0x800) : low ? builtinLower() : builtinFont()), [font.rom, low]);
  const w = useMemo(() => columns(screen), [screen]);
  const rows = screen.rows.length;

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
    screen.rows.forEach((r, y) => {
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
  }, [screen, glyphs, w, rows]);

  const items = useMemo(() => {
    const out: Item[] = [];
    screen.rows.forEach((r, y) => {
      const last = out[out.length - 1];
      if (last && screen.rows[y - 1].part === r.part) { last.n++; return; }
      const p = screen.parts[r.part];
      const file = p.kind === 'entry' && p.file != null ? disk.img.files[p.file] ?? null : null;
      out.push({ from: y, n: 1, file, static: !file || file.type !== 'PRG' });
    });
    return out;
  }, [screen, disk.img]);
  // the files whose rows the directory's own control codes (HOME, DEL) printed over
  const hidden = useMemo(() => { const shown = new Set(items.map(i => i.file)); return disk.img.files.filter(f => !shown.has(f)); }, [items, disk.img]);

  const pct = (n: number, of: number) => `${(n / of) * 100}%`;
  const text = (it: Item) => Array.from({ length: it.n }, (_, k) => screenRowText(screen.rows[it.from + k], low)).filter(Boolean).join(' ');
  return (
    <>
      <div className="c64-screen" style={{ background: C64[C64_BORDER] }}>
        <div className="c64-paper" style={{ background: C64[C64_BACKGROUND] }}>
          <canvas ref={canvas} width={w * 8} height={rows * 8} aria-hidden="true" style={{ imageRendering: sharp ? 'pixelated' : 'auto' }} />
          <div className="c64-items" role="list" aria-label={`Files on ${disk.name}, as a C64 lists them`}>
            {items.map(it => {
              const f = it.file, style = { top: pct(it.from, rows), height: pct(it.n, rows) };
              if (!f || it.static) return <div key={it.from} role="listitem" className="c64-item static" style={style} aria-label={text(it)} title={f ? titleOf(f) : undefined} />;
              const on = open.has(f);
              return (
                <div key={it.from} role="listitem" className={cx('c64-item', on && 'on')} style={style} tabIndex={0} aria-current={on || undefined}
                  aria-label={`${f.blocks} "${f.name}" ${kindOf(f)}`} title={titleOf(f)}
                  onClick={() => onOpenFromDisk(f, false)} onKeyDown={e => { if (listKeys(e)) return; if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); onOpenFromDisk(f, false); } }}>
                  <button className="icon-btn c64-add" title={`Add ${f.name} to this project`} aria-label={`Add ${f.name} to this project`} onClick={e => { e.stopPropagation(); onOpenFromDisk(f, true); }}><Icon name="plus" size={12} /></button>
                </div>
              );
            })}
          </div>
          <div className="c64-cursor" aria-hidden="true" style={{ top: pct(screen.cursor.row, rows), height: pct(1, rows), left: pct(screen.cursor.col, w), width: pct(1, w), background: C64[screen.cursor.color & 15] }} />
        </div>
      </div>
      {hidden.length > 0 && (
        <div className="side-hint c64-hidden">Not on the screen, printed over by the directory's own control codes:{' '}
          {hidden.map((f, i) => f.type === 'PRG'
            ? <button key={i} className="btn tiny ghost mono" title={titleOf(f)} onClick={() => onOpenFromDisk(f, false)}>"{f.name}"</button>
            : <span key={i} className="mono">"{f.name}" </span>)}
        </div>
      )}
      {font.state === 'none' && <p className="side-hint">Letters and digits from Mimir's own font, without the graphics: VICE's character ROM was not found (Settings → Toolchain → VICE).</p>}
    </>
  );
}
