/* The screen a VICE snapshot's VIC-II was showing when it was saved (spec 13.7): core's vicScreen draws it as VICE
 * does (384 x 272, PAL, normal borders) from the snapshot's RAM, colour RAM and VIC registers, with VICE's character
 * ROM where the VIC reads it ($1000-$1fff in banks 0 and 2); without VICE, Mimir's own letters stand in for it. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { vicScreen, type VicState } from '@mimir/core';
import { charRom } from '../lib/charrom';
import { builtinFont } from '../lib/gfxview';
import { C64, hexRgb } from '../lib/palette';
import { builtinLower } from './C64Screen';

const PAL = C64.map(hexRgb);

/** Mimir's letters as a character ROM: the upper case set, then the lower case one */
function builtinRom(): Uint8Array {
  const f = new Uint8Array(0x1000);
  f.set(builtinFont());
  f.set(builtinLower(), 0x800);
  return f;
}

export function SnapshotScreen({ st, ram, colorRam, label, className, onClick, title }: {
  st: VicState; ram: Uint8Array; colorRam: Uint8Array;
  /** what the picture is, for screen readers */
  label: string;
  className?: string; title?: string; onClick?: () => void;
}) {
  const [rom, setRom] = useState<Uint8Array | null | undefined>(undefined);
  useEffect(() => { let on = true; void charRom().then(r => { if (on) setRom(r?.found ? r.bytes : null); }); return () => { on = false; }; }, []);
  const chars = useMemo(() => (rom === undefined ? null : rom ?? builtinRom()), [rom]);
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = canvas.current, ctx = cv?.getContext('2d');
    if (!cv || !ctx) return;
    const v = vicScreen(st, ram, colorRam, chars);
    cv.width = v.width; cv.height = v.height;
    const img = ctx.createImageData(v.width, v.height);
    for (let i = 0; i < v.pixels.length; i++) {
      const [r, g, b] = PAL[v.pixels[i]];
      img.data[i * 4] = r; img.data[i * 4 + 1] = g; img.data[i * 4 + 2] = b; img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }, [st, ram, colorRam, chars]);
  return onClick
    ? <button type="button" className={className} title={title} aria-label={label} onClick={onClick}><canvas ref={canvas} /></button>
    : <canvas ref={canvas} className={className} title={title} role="img" aria-label={label} />;
}
