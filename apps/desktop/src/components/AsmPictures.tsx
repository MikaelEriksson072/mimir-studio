/* A picture in the Assembler's editor (lib/asmgfx.ts): the sprites, characters or bitmap a block's .byte lines make,
 * drawn as the re-assembler's listing draws them (GfxStrip), in a view zone above the lines it stands for. As in the
 * listing, the item under the pointer is outlined with what it is (and its line) in the tooltip, a click picks its
 * bytes (the inspector shows it, enlarged, to draw in), the window's selection is tinted and the item at its cursor
 * framed. A double-click puts the caret on the item's line: the picture's lines are shown under it to be edited. */
import { useMemo } from 'react';
import { h4, type Addr } from '@mimir/core';
import { gfxItemAt, gfxSize } from '../lib/gfxlines';
import { ASM_PICTURE_GAP, ASM_PICTURE_PAD, asmPictureLine, type AsmPicture } from '../lib/asmgfx';
import { useAsmLink } from '../store/asmlink';
import { useUi } from '../store/ui';
import { GfxStrip } from './GfxStrip';

const WHAT = { sprite: 'Sprites', chars: 'Characters', bitmap: 'Bitmap' } as const;

export interface AsmPictureZoneProps {
  p: AsmPicture;
  /** the program's memory (the check's), and the sprite pointers the analysis found (the tooltip names them) */
  mem: Uint8Array;
  sprites: readonly { addr: Addr; n: number }[];
  /** an item clicked (with Shift: the selection up to it); double-clicked (the caret to its line) */
  onPick: (c: { a: Addr; n: number }, extend: boolean) => void;
  onOpen: (line: number) => void;
}

export function AsmPictureZone({ p, mem, sprites, onPick, onOpen }: AsmPictureZoneProps) {
  const colors = useUi(s => s.gfx.colors);
  const place = useAsmLink(s => s.place);
  const A = useMemo(() => ({ mem, vic: { sprites } }), [mem, sprites]);
  const first = p.rows[0], last = p.rows[p.rows.length - 1];
  const end = last ? last.a + last.n : 0;
  const lines = p.from <= p.to ? `lines ${p.from}–${p.to}` : `line ${p.after}`;
  /** the item under the pointer */
  const itemAt = (e: React.MouseEvent) => {
    const g = (e.target as Element).closest<HTMLElement>('.gfx-strip'), l = g ? p.rows[Number(g.dataset.i)] : null;
    if (!g || !l) return null;
    const r = g.getBoundingClientRect(), { height, scale } = gfxSize(l);
    return gfxItemAt(l, (e.clientX - r.left) / scale, Math.min(height - 1, (e.clientY - r.top) / scale));
  };
  if (!first) return null;
  const tip = (a: Addr) => { const n = asmPictureLine(p, a); return ` · line ${n} · a double-click shows the lines`; };
  return (
    <div className="asm-pic" role="group" aria-label={`${WHAT[p.kind]} $${h4(first.a)}–$${h4(end - 1)}, ${lines}`} style={{ padding: `${ASM_PICTURE_PAD}px 0`, gap: ASM_PICTURE_GAP }}
      onMouseDown={e => { if (e.button !== 0) return; e.preventDefault(); const c = itemAt(e); if (c) onPick(c, e.shiftKey); }}
      onDoubleClick={e => { const c = itemAt(e); onOpen(asmPictureLine(p, c?.a ?? first.a)); }}>
      {p.rows.map((l, i) => {
        const e = l.a + l.n, sel = place.sel && place.sel.start < e && place.sel.end > l.a ? place.sel : null;
        const cur = place.cursor != null && place.cursor >= l.a && place.cursor < e ? place.cursor : null;
        return <GfxStrip key={`${l.a}:${l.n}`} l={l} i={i} A={A} colors={colors} sel={sel} cur={cur} tip={tip} />;
      })}
    </div>
  );
}
