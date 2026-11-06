/* Graphics tab (spec 14.5): all 64 KB of memory as characters, sprites, bitmaps or screens, whatever the blocks are, to
 * find graphics by eye (as in ICU64). Screens are drawn with VICE's character ROM, the built-in letters or a charset in
 * memory. *Font per row* draws a picture whose character rows each have their own font (2 KB apart, passing over memory
 * where no font can be) and the same 40 screen codes. A click selects a cell, Shift+click or a drag more; the selection is the listing's and is marked as Charset,
 * Sprite data, Bitmap or Screen matrix from here, or saved: as bytes, with a load address, as a Koala or Art Studio
 * picture, as a PNG image or as .byte source. A cartridge's bank is picked in the head: the picture stays where it is,
 * and the cursor goes along, to the same address when the bank has it; *All banks* lays every bank's loaded memory out
 * one after the other, at bank addresses (`1:$8000`). The tab opens where the editor was in memory (the listing's or
 * Memory's top, spec 14.6b), and says where it was scrolled to for the tab opened next. Only the rows on screen and a
 * screen above and below are drawn, so a cartridge of 1 MB fits too. */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react';
import { artStudioPicture, findBlock, gfxSource, h2, h4, kindInfo, koalaPicture, makePrg, validLabel, type Addr, type AnalysisResult, type BlockKind, type RenderResult } from '@mimir/core';
import { Icon } from '../lib/icons';
import { BankPick, OptGroup, ViewModes, type BankPickProps, type ViewMode } from './ViewModes';
import { parseGoto } from '../lib/goto';
import { bitmapAround, BITMAP_BYTES, BITMAP_ROW_BYTES, BITMAP_ROWS, builtinFont, byteAt, cellAt, cellOf, cellRange, charsetAround, drawMemory, fontRowsLayout, fontRowStarts, FONT_ROWS, gfxImage, NO_FONT, gfxLayout, MAX_SPRITE_COLS, rangeRects, rowAddr, screenPointer, spritePointer, type GfxKind, type GfxLayout } from '../lib/gfxview';
import { C64, C64_NAMES } from '../lib/palette';
import { cx, groupOfKind } from '../lib/util';
import type { Sel } from '../lib/types';
import { useUi, type GfxPrefs } from '../store/ui';
import type { CharRomResult } from '../../shared/ipc';

const GFX_MODES: ViewMode<GfxKind>[] = [
  { key: 'chars', label: 'Characters', icon: 'grid', sub: '8×8', title: 'Memory as characters: 8 bytes, 8 × 8 pixels each' },
  { key: 'sprites', label: 'Sprites', icon: 'sprite', sub: '24×21', title: 'Memory as sprites: 64 bytes, 24 × 21 pixels each' },
  { key: 'bitmap', label: 'Bitmaps', icon: 'image', sub: '320×200', title: 'Memory as bitmaps: 8000 bytes, 320 × 200 pixels each' },
  { key: 'screens', label: 'Screens', icon: 'screen', sub: '40×25', title: 'Memory as screens: 1000 screen codes, 40 × 25 characters each' },
  { key: 'fontrows', label: 'Font per row', icon: 'rows', title: 'A picture whose character rows each have their own font' },
];
/** what the view shows, beside the mode switch (whose buttons say the size); bitmaps say their bytes */
const SHOWS: Record<Exclude<GfxKind, 'bitmap'>, string> = {
  chars: '8 bytes each', sprites: '64 bytes each', screens: '1000 screen codes each', fontrows: 'a font for each row',
};
/** sprites per row: every count from 1 to 24 */
const COLS: Record<GfxKind, number[]> = {
  chars: [16, 32, 40, 64], sprites: Array.from({ length: MAX_SPRITE_COLS }, (_, i) => i + 1), bitmap: [1], screens: [1, 2, 3], fontrows: [1],
};
/** characters per row can also be typed in, up to this many */
const MAX_CHAR_COLS = 128;
const NAMES: Record<GfxKind, string> = { chars: 'character', sprites: 'sprite', bitmap: 'bitmap', screens: 'screen', fontrows: 'row' };
/** what a selection can be marked as, per view: the view's own kind first */
const MARKS: Record<GfxKind, [string, string][]> = {
  chars: [['charset', 'Charset'], ['sprite', 'Sprite data'], ['bitmap', 'Bitmap']],
  sprites: [['sprite', 'Sprite data'], ['charset', 'Charset'], ['bitmap', 'Bitmap']],
  bitmap: [['bitmap', 'Bitmap'], ['charset', 'Charset'], ['sprite', 'Sprite data']],
  screens: [['screen', 'Screen matrix'], ['charset', 'Charset'], ['bitmap', 'Bitmap']],
  fontrows: [['charset', 'Charset'], ['bitmap', 'Bitmap'], ['sprite', 'Sprite data']],
};

/** a font per row: the blocks the screen codes can be picked from, the kinds they are most likely in first, code last */
const CODE_KINDS: BlockKind[] = ['screen', 'text', 'data', 'table', 'words', 'lohi', 'fill', 'charset', 'bitmap', 'sprite', 'music', 'basic', 'code'];

/** VICE's character ROM, asked for once; a ROM that was not found is asked for again the next time screens are shown */
let romAsked: Promise<CharRomResult | null> | null = null;
const charRom = () => {
  romAsked ??= (window.kr ? window.kr.charRom().catch(() => null) : Promise.resolve(null)).then(r => { if (!r?.found) romAsked = null; return r; });
  return romAsked;
};

interface MemoryGfxProps {
  A: AnalysisResult; R: RenderResult; cursor: Addr | null; sel: Sel | null;
  onSelect: (start: Addr, end: Addr) => void; onClear: () => void;
  onMark: (id: string, range: { start: Addr; end: Addr }) => void;
  onShow: (a: Addr) => void;
  /** save a file through a save dialog (its suggested name and bytes) */
  onSave: (name: string, bytes: Uint8Array) => void;
  /** a cartridge's banks: the one shown and picking another (null without a cartridge) */
  bank?: BankPickProps | null;
  /** where the editor was in memory (14.6b): the tab opens with it at the top (null: at the cursor) */
  start?: { addr: Addr; end: Addr } | null;
  /** scrolled: the addresses at the top and the bottom of the picture */
  onView?: (top: Addr, end: Addr) => void;
  /** every bank at once (13.9b): A and R at bank addresses, and the banks' loaded memory to lay out (null: 64 KB) */
  parts?: readonly { start: Addr; end: Addr }[] | null;
  /** an address as the tab writes it (`1:$8000` with every bank; `$8000` without) */
  fmt?: (a: Addr) => string;
  /** an address typed without a bank (or with one, `3:8000`), at its bank address */
  resolve?: (a: Addr, bank: number | null) => Addr;
}

/** a way to save the selection: the menu text, the file extension, and the bytes */
interface SaveAs { id: string; label: string; ext: string; make: () => Uint8Array | Promise<Uint8Array> }

/** an image as PNG bytes, through a canvas */
async function pngOf(img: { width: number; height: number; rgba: Uint8ClampedArray<ArrayBuffer> }): Promise<Uint8Array> {
  const cv = document.createElement('canvas');
  cv.width = img.width; cv.height = img.height;
  cv.getContext('2d')!.putImageData(new ImageData(img.rgba, img.width, img.height), 0, 0);
  const blob = await new Promise<Blob | null>(done => cv.toBlob(done, 'image/png'));
  if (!blob) throw new Error('the image could not be made');
  return new Uint8Array(await blob.arrayBuffer());
}

const plainAddr = (a: Addr) => `$${h4(a)}`;

export function MemoryGfx({ A, R, cursor, sel, onSelect, onClear, onMark, onShow, onSave, bank, start, onView, parts, fmt = plainAddr, resolve }: MemoryGfxProps) {
  const prefs = useUi(s => s.gfx), setUi = useUi(s => s.set);
  const set = (p: Partial<GfxPrefs>) => setUi({ gfx: { ...useUi.getState().gfx, ...p } });
  const { kind, zoom, mc, colors, offset, screenFont, rowCodes, rowFonts, rowCount, rowSkip, bitmapRows } = prefs;
  // bitmaps of fewer rows than a screen: the mode's button says the size of a cell
  const modes = useMemo(() => GFX_MODES.map(m => (m.key === 'bitmap' && bitmapRows !== BITMAP_ROWS ? { ...m, sub: `320×${bitmapRows * 8}`, title: `Memory as bitmaps: the first ${bitmapRows} character rows (${bitmapRows * BITMAP_ROW_BYTES} bytes, 320 × ${bitmapRows * 8} pixels) of each 8 KB` } : m)), [bitmapRows]);
  const cols = kind === 'chars' ? prefs.charCols : kind === 'sprites' ? prefs.spriteCols : kind === 'screens' ? prefs.screenCols : 1;
  // a font per row: the 40 screen codes every row shows; 0-39 when they are not loaded (a screen filled at run time)
  const codesLoaded = Array.from({ length: 40 }, (_, i) => rowCodes + i).every(a => a <= 0xffff && A.owner[a] >= 0);
  const codes = useMemo(() => (codesLoaded ? A.mem.slice(rowCodes, rowCodes + 40) : Uint8Array.from({ length: 40 }, (_, i) => i)), [codesLoaded, rowCodes, A]);
  const codeBlocks = useMemo(() => CODE_KINDS.map(k => ({ kind: k, blocks: A.blocks.filter(b => b.type === k) })).filter(g => g.blocks.length), [A]);
  const screenBlock = A.blocks.some(b => b.start === 0x0400);
  // the block menu's addresses in its order: the buttons and the mouse wheel step through them
  const codeOrder = useMemo(() => [...(screenBlock ? [] : [0x0400]), ...codeBlocks.flatMap(g => g.blocks.map(b => b.start))], [codeBlocks, screenBlock]);
  const codeAt = codeOrder.indexOf(rowCodes);
  const stepCodes = (d: number) => {
    const j = codeAt < 0 ? (d > 0 ? 0 : codeOrder.length - 1) : Math.max(0, Math.min(codeOrder.length - 1, codeAt + d));
    if (codeOrder[j] != null && codeOrder[j] !== rowCodes) set({ rowCodes: codeOrder[j] });
  };
  /** a wheel step at most every 60 ms, so a touchpad does not race through the list */
  const lastWheel = useRef(0);
  const fontRows = useMemo(() => fontRowStarts(rowFonts, rowCount, rowSkip), [rowFonts, rowCount, rowSkip]);
  const L = useMemo(() => (kind === 'fontrows' ? fontRowsLayout(fontRows.starts, codes) : gfxLayout(kind, cols, offset, parts ?? undefined, bitmapRows)), [kind, cols, offset, fontRows, codes, parts, bitmapRows]);
  const canvas = useRef<HTMLCanvasElement>(null), scroller = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<Addr | null>(null);
  /** a font per row: the row and column under the pointer */
  const [hoverAt, setHoverAt] = useState<{ row: number; col: number } | null>(null);
  const [goto, setGoto] = useState('');
  const [gotoErr, setGotoErr] = useState<string | null>(null);

  // screens: drawn with VICE's ROM (when it is found), the built-in letters or 2 KB of memory
  const [rom, setRom] = useState<CharRomResult | null>(null);
  useEffect(() => { if (kind === 'screens') void charRom().then(setRom); }, [kind]);
  const romBytes = rom?.found ? rom.bytes : null;
  const font = useMemo(() => {
    if (screenFont.startsWith('$')) { const a = parseInt(screenFont.slice(1), 16) || 0; return A.mem.slice(a, a + 0x800); }
    if (romBytes && (screenFont === 'rom' || screenFont === 'rom-lower')) return romBytes.slice(screenFont === 'rom' ? 0 : 0x800, screenFont === 'rom' ? 0x800 : 0x1000);
    return builtinFont();
  }, [screenFont, romBytes, A]);
  const charsets = A.blocks.filter(b => b.type === 'charset');

  // the rows drawn: those on screen and a screen's worth above and below, drawn again when the scrolling leaves them
  const [band, setBand] = useState(() => ({ from: 0, to: Math.min(L.rows, 64), L }));
  const fitBand = () => {
    const el = scroller.current; if (!el) return;
    const rowPx = (L.cellH + L.gapY) * zoom, first = Math.floor(el.scrollTop / rowPx), last = Math.min(L.rows, Math.ceil((el.scrollTop + el.clientHeight) / rowPx));
    const n = Math.max(1, last - first);
    setBand(b => (b.L === L && b.from <= first && b.to >= last ? b : { from: Math.max(0, first - n), to: Math.min(L.rows, last + n), L }));
  };
  useEffect(() => {
    const el = scroller.current; if (!el) return;
    const ro = new ResizeObserver(() => fitBand()); ro.observe(el);
    return () => ro.disconnect();
  }, [L, zoom]); // eslint-disable-line react-hooks/exhaustive-deps
  const stepY = L.cellH + L.gapY, bandRows = band.L === L ? band : { from: 0, to: Math.min(L.rows, 64) };
  useLayoutEffect(() => {
    const cv = canvas.current; if (!cv) return;
    const ctx = cv.getContext('2d'), h = (bandRows.to - bandRows.from) * stepY; if (!ctx || h <= 0) return;
    const img = ctx.createImageData(L.width, h);
    drawMemory(img.data, L, A.mem, a => A.owner[a] >= 0, mc, colors, kind === 'screens' ? font : undefined, undefined, bandRows.from, bandRows.to);
    ctx.putImageData(img, 0, 0);
  }, [A, L, mc, colors, kind, font, bandRows.from, bandRows.to]); // eslint-disable-line react-hooks/exhaustive-deps

  const scrollTo = (a: Addr, G: GfxLayout = L) => { const c = cellOf(G, a), el = scroller.current; if (c && el) el.scrollTop = Math.max(0, c.y * zoom - el.clientHeight / 3); };
  /** the cell of `a` is on screen */
  const onScreen = (a: Addr) => { const c = cellOf(L, a), el = scroller.current; return !!c && !!el && c.y * zoom >= el.scrollTop && (c.y + L.cellH) * zoom <= el.scrollTop + el.clientHeight; };
  // the address at the top of the picture, where you scrolled to: another view, other columns or another zoom keep it
  // at the top (a font per row has fonts for rows and leaves it). It only follows your scrolling, so going through
  // bitmaps (8 KB a row) and back finds the same row again
  const topAt = useRef<Addr | null>(null), restoring = useRef(false), opened = useRef(false);
  // the scroll the tab makes itself as it opens is not where you went: the other tabs are not told of that position
  const own = useRef<number | null>(null);
  const quietly = (f: () => void) => { f(); own.current = scroller.current?.scrollTop ?? null; };
  const onScroll = () => {
    const el = scroller.current;
    if (!el || restoring.current || kind === 'fontrows') return;
    fitBand();
    const row = (y: number) => Math.floor(y / zoom / (L.cellH + L.gapY));
    topAt.current = Math.min(L.size - 1, rowAddr(L, row(el.scrollTop)));
    if (own.current != null && Math.abs(el.scrollTop - own.current) < 1) return;
    own.current = null;
    onView?.(topAt.current, Math.min(L.size, rowAddr(L, row(el.scrollTop + el.clientHeight) + 1)));
  };
  /** opening the tab where the editor was (14.6b): that address in the top row, and the cursor on screen when the view
   *  it is from had it */
  const showFrom = (v: { addr: Addr; end: Addr }) => {
    const el = scroller.current, c = cellOf(L, v.addr); if (!el || !c) return;
    el.scrollTop = c.y * zoom;
    topAt.current = v.addr;
    if (cursor != null && cursor >= v.addr && cursor < v.end && !onScreen(cursor)) scrollTo(cursor);
  };
  useLayoutEffect(() => {
    const el = scroller.current, top = topAt.current;
    // opening the tab shows where the editor was, else the cursor (or the selection)
    if (!opened.current || top == null || kind === 'fontrows') {
      const first = !opened.current;
      opened.current = true;
      if (first && start && kind !== 'fontrows') { quietly(() => showFrom(start)); return; }
      const a = sel?.multi ? sel.start : cursor;
      if (a != null) { if (first) quietly(() => scrollTo(a)); else scrollTo(a); }
      return;
    }
    const c = cellOf(L, top);
    if (!c || !el) return;
    restoring.current = true;
    el.scrollTop = c.y * zoom;
    // the scroll event this sets off is not yours
    requestAnimationFrame(() => requestAnimationFrame(() => { restoring.current = false; }));
  }, [kind, cols, zoom, bitmapRows]); // eslint-disable-line react-hooks/exhaustive-deps
  // another layout, or the scrolling that came with it: the rows drawn are the ones on screen
  useLayoutEffect(() => { fitBand(); }, [L, zoom]); // eslint-disable-line react-hooks/exhaustive-deps
  // another bank keeps the picture where it is, unless the cursor went off screen in it (the bank does not have its address)
  const seen = useRef({ bank: bank?.value, cursor });
  useEffect(() => {
    const was = seen.current; seen.current = { bank: bank?.value, cursor };
    if (was.bank !== bank?.value && cursor != null && cursor !== was.cursor && kind !== 'fontrows' && !onScreen(cursor)) scrollTo(cursor);
  }, [bank?.value, cursor]); // eslint-disable-line react-hooks/exhaustive-deps

  const point = (e: ReactMouseEvent) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); return { x: (e.clientX - r.left) / zoom, y: (e.clientY - r.top) / zoom }; };
  const anchor = useRef<Addr | null>(null), dragging = useRef(false);
  /** the cells from the anchor to `a`; with every bank, inside the anchor's bank (a block is in one bank) */
  const cellsTo = (a: Addr) => {
    const r = cellRange(L, anchor.current!, a), b = anchor.current! - (anchor.current! & 0xffff);
    return r && parts ? { start: Math.max(r.start, b), end: Math.min(r.end, b + 0x10000) } : r;
  };
  const down = (e: ReactMouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault(); (e.currentTarget as HTMLElement).closest<HTMLElement>('.gfxv')?.focus();
    const { x, y } = point(e), a = cellAt(L, x, y);
    if (a == null) return;
    if (!(e.shiftKey && anchor.current != null)) anchor.current = a;
    const r = cellsTo(a); if (r) onSelect(r.start, r.end);
    dragging.current = true;
  };
  const move = (e: ReactMouseEvent) => {
    const { x, y } = point(e);
    setHover(byteAt(L, x, y));
    if (kind === 'fontrows') setHoverAt({ row: Math.floor(y / 8), col: Math.floor(x / 8) });
    if (!dragging.current || !(e.buttons & 1) || anchor.current == null) { dragging.current = false; return; }
    const a = cellAt(L, x, y); if (a == null) return;
    const r = cellsTo(a); if (r && (!sel || r.start !== sel.start || r.end !== sel.end)) onSelect(r.start, r.end);
  };
  const go = () => {
    const t = parseGoto(goto, n => { for (const [a, l] of R.labels) if (l.name === n) return a; return undefined; }, resolve);
    if ('error' in t) { setGotoErr(t.error); return; }
    setGotoErr(null);
    // a screen can be stored anywhere: the grid moves so that one starts where it goes to
    const at = 'addr' in t ? t.addr : t.start;
    const G = kind === 'screens' && cellOf(L, at)?.start !== at ? gfxLayout(kind, cols, at % L.unit, parts ?? undefined) : L;
    if (G !== L) set({ offset: G.offset });
    scrollTo(at, G);
    if ('addr' in t) { const r = cellRange(G, t.addr, t.addr); if (r) { anchor.current = r.start; onSelect(r.start, r.end); } }
    else { anchor.current = t.start; onSelect(t.start, t.end); }
  };
  const key = (e: KeyboardEvent) => { if (e.key === 'Escape' && e.target === e.currentTarget) { e.stopPropagation(); anchor.current = null; onClear(); } };

  const range = sel?.multi || (sel && sel.end - sel.start > 1) ? { start: sel!.start, end: sel!.end } : null;
  const rects = range ? rangeRects(L, range.start, range.end) : [];
  const rowH = stepY * zoom, every = Math.max(1, Math.ceil(14 / rowH));
  const blockAt = (a: Addr) => findBlock(A.blocks, a);
  const blockText = (a: Addr) => { const b = blockAt(a); if (!b) return 'not loaded'; const l = R.labels.get(b.start); return `${kindInfo(b.type).label}${l ? ` ${l.name}` : ''} (${fmt(b.start)}–${fmt(b.end - 1)})`; };
  const hoverText = hover == null ? null : [
    `${fmt(hover)} = $${h2(A.mem[hover])}`,
    kind === 'chars' ? `char $${h2((hover & 0x7ff) >> 3)} of the 2 KB at ${fmt(charsetAround(hover).start)}` : kind === 'sprites' ? (p => `sprite pointer $${h2(p.pointer)} in VIC bank ${p.bank}`)(spritePointer(hover))
      : kind === 'screens' ? (c => { const i = hover - c, p = screenPointer(c); return `row ${Math.floor(i / 40)}, column ${i % 40} of the screen at ${fmt(c)}${p ? ` ($d018 = $${p.d018.toString(16)}x in VIC bank ${p.bank})` : ''}`; })(cellOf(L, hover)?.start ?? hover)
        : kind === 'fontrows' ? (hoverAt ? `row ${hoverAt.row}, column ${hoverAt.col}: char $${h2(codes[hoverAt.col])} of the font at $${h4(rowAddr(L, hoverAt.row))}` : '')
          : (c => { const i = hover - c; return `row ${Math.floor(i / BITMAP_ROW_BYTES)}, column ${(i % BITMAP_ROW_BYTES) >> 3} of the bitmap at ${fmt(c)}`; })(cellOf(L, hover)?.start ?? bitmapAround(hover).start),
    blockText(hover),
  ].join(' · ');
  const marks = MARKS[kind];
  // saving the selection: the file is named after the block it starts (its label) or after the kind and address
  const [saveOpen, setSaveOpen] = useState(false);
  const saveRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!saveOpen) return;
    // a click outside or Esc (wherever the focus is) closes the menu; the first item takes the focus
    const close = (e: MouseEvent) => { if (!saveRef.current?.contains(e.target as Node)) setSaveOpen(false); };
    const esc = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setSaveOpen(false); } };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc, true);
    saveRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc, true); };
  }, [saveOpen]);
  const saveName = (r: { start: Addr }) => {
    const b = blockAt(r.start), l = b && b.start === r.start ? R.labels.get(b.start)?.name : undefined;
    // `1:$8000` in a file name: bank 1, `1_8000`
    return l && validLabel(l) ? l : `${kind === 'chars' ? 'charset' : kind === 'sprites' ? 'sprites' : kind === 'screens' ? 'screen' : kind === 'fontrows' ? 'fonts' : 'bitmap'}_${fmt(r.start).replace('$', '').replace(':', '_')}`;
  };
  const saveAs: SaveAs[] = !range ? [] : (() => {
    const data = () => A.mem.slice(range.start, range.end);
    const pictures: SaveAs[] = [
      { id: 'kla', label: 'Koala Painter picture, multicolour (.kla)', ext: 'kla', make: () => koalaPicture(data(), colors) },
      { id: 'art', label: 'Art Studio picture, hires (.art)', ext: 'art', make: () => artStudioPicture(data(), colors) },
    ];
    return [
      { id: 'bin', label: 'Raw bytes (.bin)', ext: 'bin', make: data },
      // the load address in its bank
      kind === 'chars' ? { id: '64c', label: 'Charset with its load address (.64c)', ext: '64c', make: () => makePrg(range.start & 0xffff, data()) }
        : { id: 'prg', label: 'With its load address (.prg)', ext: 'prg', make: () => makePrg(range.start & 0xffff, data()) },
      ...(kind === 'bitmap' ? (mc ? pictures : [...pictures].reverse()) : []),
      { id: 'png', label: 'Image as shown here (.png)', ext: 'png', make: () => pngOf(gfxImage(kind, A.mem, range.start, range.end, mc, colors, { font: kind === 'screens' ? font : undefined, codes, rows: L.rowStarts, bitmapRows })) },
      // the fonts of a font-per-row picture are characters
      { id: 'asm', label: 'Kick Assembler source, .byte rows (.asm)', ext: 'asm', make: () => new TextEncoder().encode(gfxSource(kind === 'fontrows' ? 'chars' : kind, saveName(range), range.start & 0xffff, data())) },
    ];
  })();
  const save = async (s: SaveAs) => { setSaveOpen(false); if (range) onSave(`${saveName(range)}.${s.ext}`, await s.make()); };
  // the selection made whole: shown only when that is more (or other) than it is. A bitmap is the 8000 bytes from the
  // start of the grid's frame, and a bitmap of fewer rows is drawn whole again, so the selection can be seen
  const whole = kind === 'chars' ? { label: 'Whole charset (2 KB)', title: 'The 2 KB charset the selection starts in, as the VIC sees it', of: charsetAround }
    : kind === 'bitmap' ? {
      label: 'Whole bitmap (8000 bytes)', title: bitmapRows < BITMAP_ROWS ? `All 25 rows of the bitmap, drawn whole again (Height ${bitmapRows} rows now)` : 'All 25 rows of the bitmap the selection starts in',
      of: (a: Addr) => { const s = cellOf(L, a)?.start ?? bitmapAround(a).start; return { start: s, end: s + BITMAP_BYTES }; },
    }
      : kind === 'screens' ? { label: 'With the sprite pointers (1 KB)', title: 'The screen and the 24 bytes after it: 16 unused and the 8 sprite pointers', of: (a: Addr) => ({ start: a, end: a + 0x400 }) }
        : kind === 'fontrows' ? { label: `All ${L.rows} rows`, title: 'The fonts of every row, from the first to the last', of: () => ({ start: L.offset, end: rowAddr(L, L.rows) }) } : null;
  const wholeOf = whole && range ? (r => ({ start: r.start, end: Math.min(L.size, r.end) }))(whole.of(range.start)) : null;
  const takeWhole = () => {
    if (!wholeOf) return;
    if (kind === 'bitmap' && bitmapRows < BITMAP_ROWS) {
      // drawn whole: the bitmap at the top of the picture
      topAt.current = wholeOf.start;
      set({ bitmapRows: BITMAP_ROWS });
    }
    anchor.current = wholeOf.start; onSelect(wholeOf.start, wholeOf.end);
  };

  const now = <>
    <b>{GFX_MODES.find(m => m.key === kind)!.label}</b>
    <span>{kind === 'bitmap' ? `${bitmapRows * BITMAP_ROW_BYTES} bytes each` : SHOWS[kind]}</span>
    {kind === 'chars' || kind === 'sprites' || kind === 'screens' ? <span>{cols} a row</span> : kind === 'fontrows' ? <span>{rowCount} rows</span> : <span>{bitmapRows} {bitmapRows === 1 ? 'row' : 'rows'}</span>}
    <span>{mc ? 'multicolour' : 'hires'}</span>
    <span>{zoom}×</span>
  </>;
  return (
    <div className="gfxv" tabIndex={-1} onKeyDown={key} aria-label="Memory as graphics">
      <ViewModes label="Show memory as" modes={modes} value={kind} onChange={k => set({ kind: k })} now={now}
        aside={(bank || kind !== 'fontrows') && <>{bank && <BankPick {...bank} />}{kind !== 'fontrows' && <form className="gfxv-go" onSubmit={e => { e.preventDefault(); go(); }}>
          <input aria-label="Go to address, label or range" className={cx('mono', gotoErr && 'bad')} value={goto} title={gotoErr ?? 'Go to an address, a label or a range ($2000-$27ff)'} placeholder="$3000, label, range" spellCheck={false} onChange={e => { setGoto(e.target.value); setGotoErr(null); }} />
          <button className="btn small" type="submit"><Icon name="target" size={13} />Go</button>
        </form>}</>} />
      <div className="gfxv-bar view-opts">
        {kind === 'fontrows' && <OptGroup title="Fonts">
          <AddrField label="Screen codes" aria="First row of the screen" value={rowCodes} labels={R.labels} onSet={a => set({ rowCodes: a })}
            title={`The 40 screen codes every row shows: the first row of the screen${codesLoaded ? '' : `. $${h4(rowCodes)} is not loaded, so the codes are 0-39`}`} />
          <span className="gfxv-field">
            <select className="gfxv-pick" aria-label="Screen codes from a block" title="Take the screen codes from the start of a block the analysis knows; the mouse wheel over it, the arrows beside it or ↑ / ↓ step through the list"
              value={rowCodes === 0x0400 || A.blocks.some(b => b.start === rowCodes) ? String(rowCodes) : ''} onChange={e => { if (e.target.value) set({ rowCodes: +e.target.value }); }}
              onWheel={e => { const now = performance.now(); if (!e.deltaY || now - lastWheel.current < 60) return; lastWheel.current = now; stepCodes(Math.sign(e.deltaY)); }}>
              <option value="" disabled>Blocks…</option>
              {!screenBlock && <option value={0x0400}>$0400 · the C64's screen</option>}
              {codeBlocks.map(g => <optgroup key={g.kind} label={kindInfo(g.kind).label}>{g.blocks.map(b => <option key={b.start} value={b.start}>${h4(b.start)}{R.labels.get(b.start) ? ` ${R.labels.get(b.start)!.name}` : ''} · {b.end - b.start} bytes</option>)}</optgroup>)}
            </select>
            <button className="icon-btn small" aria-label="Previous block" title="The block above in the list" disabled={codeAt === 0} onClick={() => stepCodes(-1)}><Icon name="up" size={14} /></button>
            <button className="icon-btn small" aria-label="Next block" title="The block below in the list" disabled={codeAt === codeOrder.length - 1} onClick={() => stepCodes(1)}><Icon name="down" size={14} /></button>
          </span>
          {!codesLoaded && <span className="muted small" title="The screen is not in the loaded files (it is filled at run time, say): every row shows characters 0-39">not loaded: 0–39</span>}
          <AddrField label="First font" aria="Font of the first row" value={rowFonts} labels={R.labels} onSet={a => set({ rowFonts: a })}
            title="The font (256 characters, 2 KB) of the first row; each next row has the font 2 KB after it, where a font can be" />
          <label className="check gfxv-mc" title={`Pass over 2 KB where no font can be, so the row takes the next 2 KB: ${NO_FONT.map(z => `$${h4(z.start)}-$${h4(z.end - 1)} (${z.why})`).join(', ')}`}>
            <input type="checkbox" checked={rowSkip} onChange={e => set({ rowSkip: e.target.checked })} /><span>Skip where no font can be</span></label>
          {fontRows.skipped.length > 0 && <span className="muted small" title={fontRows.skipped.map(z => `$${h4(z.at)}: ${z.why}`).join('\n')}>skipped {fontRows.skipped.map(z => `$${h4(z.at)}`).join(', ')}</span>}
          <label className="gfxv-field">Rows<select aria-label="Rows" value={rowCount} onChange={e => set({ rowCount: +e.target.value })}>{Array.from({ length: FONT_ROWS }, (_, i) => i + 1).map(n => <option key={n} value={n}>{n}</option>)}</select></label>
        </OptGroup>}
        <OptGroup title="Layout">
          {kind === 'chars' && <CountField value={cols} presets={COLS.chars} max={MAX_CHAR_COLS} aria="Characters per row" onSet={n => set({ charCols: n })} />}
          {kind !== 'bitmap' && kind !== 'fontrows' && kind !== 'chars' && <label className="gfxv-field">Per row<select aria-label="Cells per row" value={cols} onChange={e => set(kind === 'sprites' ? { spriteCols: +e.target.value } : { screenCols: +e.target.value })}>{COLS[kind].map(n => <option key={n} value={n}>{n}</option>)}</select></label>}
          {kind === 'bitmap' && <label className="gfxv-field" title="How many character rows (8 pixel lines, 320 bytes each) of every bitmap are drawn, from its top: fewer for a picture smaller than the screen, a logo say. A click then selects only those rows">Height
            <select aria-label="Bitmap height in character rows" value={bitmapRows} onChange={e => set({ bitmapRows: +e.target.value })}>
              {Array.from({ length: BITMAP_ROWS }, (_, i) => i + 1).map(n => <option key={n} value={n}>{n} {n === 1 ? 'row' : 'rows'} ({n * 8} px)</option>)}
            </select></label>}
          <label className="gfxv-field">Zoom<select aria-label="Zoom" value={zoom} onChange={e => set({ zoom: +e.target.value })}>{[1, 2, 3, 4].map(z => <option key={z} value={z}>{z}×</option>)}</select></label>
          {kind !== 'fontrows' && <span className="gfxv-field" title="Move the grid by bytes, for data that does not start on a cell boundary">Offset
            <button className="icon-btn" aria-label="Offset back one byte" onClick={() => set({ offset: offset - 1 })}><Icon name="left" size={13} /></button>
            <span className="mono">{L.offset}</span>
            <button className="icon-btn" aria-label="Offset forward one byte" onClick={() => set({ offset: offset + 1 })}><Icon name="right" size={13} /></button></span>}
        </OptGroup>
        {kind === 'screens' && <OptGroup title="Characters">
          <label className="gfxv-field" title={rom && !rom.found && screenFont.startsWith('rom') ? `VICE's character ROM was not found (looked for ${rom.path || 'it beside the VICE in Settings → Toolchain'}): the built-in letters are drawn` : 'The characters the screen codes are drawn with'}>Charset
            <select aria-label="Draw screens with" value={screenFont} onChange={e => set({ screenFont: e.target.value })}>
              <option value="rom">C64 ROM, upper case{rom && !rom.found ? ' (not found)' : ''}</option>
              <option value="rom-lower">C64 ROM, lower case{rom && !rom.found ? ' (not found)' : ''}</option>
              <option value="builtin">Built-in letters and digits</option>
              {charsets.length > 0 && <optgroup label="Charsets found">{charsets.map(b => <option key={b.start} value={`$${h4(b.start)}`}>{fmt(b.start)}{R.labels.get(b.start) ? ` ${R.labels.get(b.start)!.name}` : ''}</option>)}</optgroup>}
              <optgroup label="2 KB of memory at">{Array.from({ length: 32 }, (_, i) => i * 0x800).filter(a => !charsets.some(b => b.start === a)).map(a => <option key={a} value={`$${h4(a)}`}>${h4(a)}</option>)}</optgroup>
            </select></label>
        </OptGroup>}
        <OptGroup title="Colours">
          <label className="check gfxv-mc"><input type="checkbox" checked={mc} onChange={e => set({ mc: e.target.checked })} /><span>Multicolor</span></label>
          {(['bg', 'fg', ...(mc ? ['mc1', 'mc2'] : [])] as (keyof GfxPrefs['colors'])[]).map(k => (
            <label key={k} className="gfxv-field gfxv-color" title={`${k === 'bg' ? 'Background (00)' : k === 'fg' ? (mc ? 'Color 11' : 'Foreground') : k === 'mc1' ? 'Color 01' : 'Color 10'}`}>
              {k.toUpperCase()}<i style={{ background: C64[colors[k]] }} /><select aria-label={`Color ${k}`} value={colors[k]} onChange={e => set({ colors: { ...colors, [k]: +e.target.value } })}>{C64_NAMES.map((n, i) => <option key={i} value={i}>{n}</option>)}</select>
            </label>
          ))}
        </OptGroup>
      </div>
      <div className="gfxv-sel" role="status">
        {range ? <>
          <span><b className="mono">{fmt(range.start)}–{fmt(range.end - 1)}</b> <span className="muted">({range.end - range.start} bytes) · {blockText(range.start)}</span></span>
          <span className="grow" />
          {whole && wholeOf && (wholeOf.start !== range.start || wholeOf.end !== range.end || (kind === 'bitmap' && bitmapRows < BITMAP_ROWS)) && <button className="btn small" title={whole.title} onClick={takeWhole}>{whole.label}</button>}
          {marks.map(([id, label], i) => <button key={id} className={cx('btn small', i === 0 && 'primary')} onClick={() => onMark(id, range)}>Mark as {label}</button>)}
          <span className="gfxv-save" ref={saveRef}>
            <button className="btn small" aria-haspopup="menu" aria-expanded={saveOpen} onClick={() => setSaveOpen(o => !o)} title="Save the selection as a file"><Icon name="download" size={13} />Save…</button>
            {saveOpen && <div className="gfxv-menu" role="menu" aria-label="Save the selection as">
              {saveAs.map(s => <button key={s.id} role="menuitem" onClick={() => void save(s)}>{s.label}</button>)}
            </div>}
          </span>
          <button className="btn small ghost" onClick={() => onShow(range.start)}><Icon name="list" size={13} />Show in listing</button>
        </> : kind === 'fontrows' ? <span className="muted">Each row is drawn with its own font, 2 KB after the font of the row above (passing over memory where no font can be), and the same 40 screen codes. Click a row to select its font, Shift+click or drag for more. Dark rows are not loaded.</span>
          : <span className="muted">Click a {NAMES[kind]} to select it, Shift+click or drag for more, then mark it as the graphics it is.{kind === 'screens' ? ' Go to an address and a screen starts there.' : ''} Dark cells are not loaded.</span>}
      </div>
      <div className="gfxv-scroll" ref={scroller} onScroll={onScroll}>
        <div className="gfxv-inner" style={{ height: L.height * zoom }}>
          <div className={cx('gfxv-gutter', parts && 'banks')} aria-hidden="true">
            {Array.from({ length: L.rows }, (_, r) => {
              // with every bank: a bank's first row is marked, and its address always written
              const a = rowAddr(L, r), b = a < L.size ? blockAt(a) : null, first = !!parts && (r === 0 || rowAddr(L, r - 1) >> 16 !== a >> 16);
              return <div key={r} className={cx('gfxv-row', first && 'bank-top')} data-addr={a < L.size ? h4(a) : undefined} style={{ top: r * rowH, height: rowH }}>
                <i style={b ? { background: `var(--g-${groupOfKind(b.type)})` } : undefined} />{(r % every === 0 || first) && a < L.size && <span>{fmt(a)}</span>}
              </div>;
            })}
          </div>
          <div className="gfxv-canvas" style={{ width: L.width * zoom, height: L.height * zoom }} onMouseDown={down} onMouseMove={move} onMouseLeave={() => { setHover(null); setHoverAt(null); }} onMouseUp={() => { dragging.current = false; }}
            onDoubleClick={e => { const { x, y } = point(e); const a = byteAt(L, x, y); if (a != null) onShow(a); }}>
            <canvas ref={canvas} width={L.width} height={Math.max(1, (bandRows.to - bandRows.from) * stepY)} style={{ position: 'absolute', left: 0, top: bandRows.from * rowH, width: L.width * zoom, height: (bandRows.to - bandRows.from) * rowH }} aria-label={kind === 'fontrows' ? 'A font per row' : `Memory as ${kind}`} />
            {rects.map((r, i) => <div key={i} className="gfxv-selrect" style={{ left: r.x * zoom, top: r.y * zoom, width: r.w * zoom, height: r.h * zoom }} />)}
          </div>
        </div>
      </div>
      <div className="gfxv-info mono small">{hoverText ?? (cursor != null ? `cursor ${fmt(cursor)} · ${blockText(cursor)}` : ' ')}</div>
    </div>
  );
}

/** an address typed as hex or a label, taken on Enter or when the field loses the focus */
/** "Per row" with the usual counts and Other…, where any count from 1 to `max` is typed in (Enter or leaving the
 *  field takes it, the arrow keys step it) */
function CountField({ value, presets, max, aria, onSet }: { value: number; presets: number[]; max: number; aria: string; onSet: (n: number) => void }) {
  const [other, setOther] = useState(!presets.includes(value));
  const [text, setText] = useState(String(value));
  const [bad, setBad] = useState(false);
  const input = useRef<HTMLInputElement | null>(null);
  useEffect(() => { setText(String(value)); setBad(false); if (!presets.includes(value)) setOther(true); }, [value, presets]);
  const take = (t = text) => {
    const n = Number(t.trim());
    if (!Number.isInteger(n) || n < 1 || n > max) { setBad(true); return; }
    setBad(false);
    if (n !== value) onSet(n); else setText(String(n));
  };
  return (
    <span className="gfxv-field">Per row
      <select aria-label="Cells per row" value={other ? 'other' : value} onChange={e => {
        if (e.target.value === 'other') { setOther(true); setTimeout(() => input.current?.select(), 0); } else { setOther(false); onSet(+e.target.value); }
      }}>
        {presets.map(n => <option key={n} value={n}>{n}</option>)}
        <option value="other">Other…</option>
      </select>
      {other && <input ref={input} aria-label={aria} className={cx('mono gfxv-addr gfxv-count', bad && 'bad')} value={text} inputMode="numeric" spellCheck={false}
        title={bad ? `A whole number from 1 to ${max}` : `1 to ${max}: Enter takes it, the arrow keys step it`}
        onChange={e => { setText(e.target.value); setBad(false); }} onBlur={() => take()}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); take(); }
          else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault();
            const n = Math.min(max, Math.max(1, (Number(text) || value) + (e.key === 'ArrowUp' ? 1 : -1)));
            setText(String(n)); take(String(n));
          }
        }} />}
    </span>
  );
}

function AddrField({ label, aria, value, labels, title, onSet }: { label: string; aria: string; value: Addr; labels: RenderResult['labels']; title: string; onSet: (a: Addr) => void }) {
  const [text, setText] = useState(`$${h4(value)}`);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setText(`$${h4(value)}`); setErr(null); }, [value]);
  const take = () => {
    const t = parseGoto(text, n => { for (const [a, l] of labels) if (l.name === n) return a; return undefined; });
    if ('error' in t) { setErr(t.error); return; }
    const a = 'addr' in t ? t.addr : t.start;
    if (a === value) setText(`$${h4(a)}`); else onSet(a);
  };
  return (
    <label className="gfxv-field" title={err ?? title}>{label}
      <input aria-label={aria} className={cx('mono gfxv-addr', err && 'bad')} value={text} spellCheck={false}
        onChange={e => { setText(e.target.value); setErr(null); }} onBlur={take} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); take(); } }} />
    </label>
  );
}
