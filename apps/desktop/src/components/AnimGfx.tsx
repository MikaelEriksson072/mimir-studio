/* The Graphics tab's Animations (spec 14.5b): the frames of a PETSCII animation that a player in memory draws (core
 * findPetsciiAnims), each as the screen the player leaves, in a grid of 1-4 a row. A frame's bytes are its part of the
 * stream, so a click selects them (the listing and the inspector follow), Shift+click or a drag the frames between. Ctrl
 * over a frame shows it alone over the whole window, the wheel stepping through the frames; Play shows them one after the
 * other at the speed picked. The selection is saved as its bytes, the frames as a PNG, or as an animated GIF. */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { findBlock, findPetsciiAnims, gifAnimation, h2, h4, kindInfo, makePrg, petsciiFrameAt, petsciiFramePixels, type Addr, type PetsciiAnim } from '@mimir/core';
import { Icon } from '../lib/icons';
import { OptGroup, ViewModes } from './ViewModes';
import { GFX_MODES, pngOf } from '../lib/gfxmodes';
import { ANIM_COLS, ANIM_SPEEDS, animFps, animLayout, C64_RGB, drawFrame, drawFrames, frameAt, frameBox, framesImage, framesIn, frameSpan, frameWhere } from '../lib/animview';
import { builtinFont } from '../lib/gfxview';
import { C64, C64_NAMES } from '../lib/palette';
import { groupOfKind } from '../lib/util';
import { useUi, type GfxPrefs } from '../store/ui';
import { charRom } from '../lib/charrom';
import type { CharRomResult } from '../../shared/ipc';
import type { MemoryGfxProps } from './MemoryGfx';

const hex = (a: Addr) => `$${h4(a)}`;
/** Ctrl held this long before the frame comes, so Ctrl+Z and the like do not flash it (as Screens) */
const FOCUS_MS = 150;

export function AnimGfx({ A, R, cursor, sel, onSelect, onClear, onShow, onSave, start, goTo, onView }: MemoryGfxProps) {
  const prefs = useUi(s => s.gfx), setUi = useUi(s => s.set);
  const set = (p: Partial<GfxPrefs>) => setUi({ gfx: { ...useUi.getState().gfx, ...p } });
  const { zoom, colors, screenFont, animCols: cols, animSpeed: speed } = prefs;
  // the animations of the players in memory (the first 64 KB: one bank of a cartridge)
  const anims = useMemo(() => findPetsciiAnims(A.mem, a => A.owner[a] >= 0), [A]);
  const [which, setWhich] = useState(0);
  const anim: PetsciiAnim | null = anims[Math.min(which, anims.length - 1)] ?? null;
  const frames = anim?.frames ?? [];
  const L = useMemo(() => animLayout(frames.length, cols), [frames.length, cols]);

  // the characters: VICE's ROM (when it is found), the built-in letters or 2 KB of memory, as Screens draws them
  const [rom, setRom] = useState<CharRomResult | null>(null);
  useEffect(() => { void charRom().then(setRom); }, []);
  const romBytes = rom?.found ? rom.bytes : null;
  const font = useMemo(() => {
    if (screenFont.startsWith('$')) { const a = parseInt(screenFont.slice(1), 16) || 0; return A.mem.slice(a, a + 0x800); }
    if (romBytes && (screenFont === 'rom' || screenFont === 'rom-lower')) return romBytes.slice(screenFont === 'rom' ? 0 : 0x800, screenFont === 'rom' ? 0x800 : 0x1000);
    return builtinFont();
  }, [screenFont, romBytes, A]);
  const charsets = A.blocks.filter(b => b.type === 'charset');

  // the rows drawn: those on screen and a screen's worth above and below
  const canvas = useRef<HTMLCanvasElement>(null), scroller = useRef<HTMLDivElement>(null);
  const stepY = L.cellH + L.gapY, rowPx = stepY * zoom;
  const [band, setBand] = useState({ from: 0, to: Math.min(L.rows, 8) });
  const fitBand = () => {
    const el = scroller.current; if (!el) return;
    const first = Math.floor(el.scrollTop / rowPx), last = Math.min(L.rows, Math.ceil((el.scrollTop + el.clientHeight) / rowPx)), n = Math.max(1, last - first);
    setBand(b => (b.from <= first && b.to >= last && b.to <= L.rows ? b : { from: Math.max(0, first - n), to: Math.min(L.rows, last + n) }));
  };
  useEffect(() => {
    const el = scroller.current; if (!el) return;
    const ro = new ResizeObserver(() => fitBand()); ro.observe(el);
    return () => ro.disconnect();
  }, [L, zoom]); // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => { setBand({ from: 0, to: Math.min(L.rows, 8) }); fitBand(); }, [L, zoom]); // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const ctx = canvas.current?.getContext('2d'), h = (band.to - band.from) * stepY; if (!ctx || h <= 0) return;
    const img = ctx.createImageData(L.width, h);
    drawFrames(img.data, L, frames, font, colors.bg, undefined, band.from, band.to);
    ctx.putImageData(img, 0, 0);
  }, [L, frames, font, colors.bg, band.from, band.to]); // eslint-disable-line react-hooks/exhaustive-deps

  // where the tab opens: at the frame of a file just opened (or of where the editor was, or the cursor), when it has one
  const scrollToFrame = (i: number) => { const el = scroller.current; if (el && i >= 0) el.scrollTop = Math.max(0, frameBox(L, i).y * zoom - 8); };
  const opened = useRef(false), goneTo = useRef<number | null>(null);
  useLayoutEffect(() => {
    if (!anim || opened.current) return;
    opened.current = true;
    const a = goTo?.addr ?? start?.addr ?? (sel?.multi ? sel.start : cursor);
    goneTo.current = goTo?.n ?? null;
    if (a != null) scrollToFrame(petsciiFrameAt(anim, a));
  }, [anim]); // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => { if (anim && goTo && goTo.n !== goneTo.current) { goneTo.current = goTo.n; scrollToFrame(petsciiFrameAt(anim, goTo.addr)); } }, [goTo?.n]); // eslint-disable-line react-hooks/exhaustive-deps
  /** scrolled: the other tabs open at the bytes of the frames on screen */
  const onScroll = () => {
    fitBand();
    const el = scroller.current; if (!el || !anim || !frames.length) return;
    const r0 = Math.min(L.rows - 1, Math.floor(el.scrollTop / rowPx)), r1 = Math.min(L.rows - 1, Math.floor((el.scrollTop + el.clientHeight - 1) / rowPx));
    const s = frameSpan(anim, r0 * L.cols, Math.min(frames.length - 1, r1 * L.cols + L.cols - 1));
    onView?.(frames[r0 * L.cols].start, s.end);
  };

  // the selection: the frames whose bytes it has
  const range = sel?.multi || (sel && sel.end - sel.start > 1) ? { start: sel!.start, end: sel!.end } : null;
  const picked = useMemo(() => (anim && range ? framesIn(anim, range.start, range.end) : []), [anim, range?.start, range?.end]); // eslint-disable-line react-hooks/exhaustive-deps
  const point = (e: ReactMouseEvent) => { const r = (e.currentTarget as HTMLElement).getBoundingClientRect(); return { x: (e.clientX - r.left) / zoom, y: (e.clientY - r.top) / zoom }; };
  const anchor = useRef<number | null>(null), dragging = useRef(false);
  const selectFrames = (i: number, j: number) => { if (!anim) return; const s = frameSpan(anim, i, j); onSelect(s.start, s.end); };
  const [hover, setHover] = useState<{ frame: number; char: number } | null>(null);

  // Ctrl held over a frame: that frame alone over the whole window until Ctrl is let go; the wheel steps through the
  // frames, a click selects the one shown. Play shows them one after the other until Esc or a click
  const [focus, setFocus] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const live = useRef({ hover, focus, playing, n: frames.length });
  live.current = { hover, focus, playing, n: frames.length };
  /** a key pressed with Ctrl held (Ctrl+Z, Ctrl+C) is that key's: the frame does not come while Ctrl is held */
  const quiet = useRef(false);
  useEffect(() => {
    let timer = 0, wheelAt = 0;
    const off = () => { clearTimeout(timer); if (!live.current.playing) setFocus(null); };
    const keyDown = (e: globalThis.KeyboardEvent) => {
      if (live.current.playing) { if (e.key === 'Escape' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); setPlaying(false); setFocus(null); } return; }
      if (e.key === 'Control' || e.key === 'Meta') { if (!e.repeat) { quiet.current = false; clearTimeout(timer); timer = window.setTimeout(() => setFocus(live.current.hover?.frame ?? null), FOCUS_MS); } return; }
      if (e.key === 'Escape' && live.current.focus != null) { e.preventDefault(); e.stopPropagation(); }
      quiet.current = e.ctrlKey || e.metaKey; off();
    };
    const keyUp = (e: globalThis.KeyboardEvent) => { if (e.key === 'Control' || e.key === 'Meta') { quiet.current = false; off(); } };
    const blur = () => { quiet.current = false; off(); };
    const wheel = (e: WheelEvent) => {
      const f = live.current;
      if (f.focus == null || f.playing || !(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const now = performance.now();
      if (!e.deltaY || now - wheelAt < 60) return;
      wheelAt = now;
      setFocus(Math.max(0, Math.min(f.n - 1, f.focus + (e.deltaY > 0 ? 1 : -1))));
    };
    const stop = () => { if (live.current.playing) { setPlaying(false); setFocus(null); } };
    window.addEventListener('keydown', keyDown, true); window.addEventListener('keyup', keyUp, true); window.addEventListener('blur', blur);
    window.addEventListener('wheel', wheel, { capture: true, passive: false });
    window.addEventListener('mousedown', stop, true);
    return () => { window.removeEventListener('keydown', keyDown, true); window.removeEventListener('keyup', keyUp, true); window.removeEventListener('blur', blur); window.removeEventListener('wheel', wheel, { capture: true }); window.removeEventListener('mousedown', stop, true); clearTimeout(timer); };
  }, []);
  // playing: the next frame every `speed` video frames, from the first one again after the last
  useEffect(() => {
    if (!playing || !frames.length) return;
    const t = window.setInterval(() => setFocus(f => ((f ?? -1) + 1) % frames.length), speed * 20);
    return () => clearInterval(t);
  }, [playing, speed, frames.length]);
  useEffect(() => { setFocus(null); setPlaying(false); }, [anim]);
  const play = () => { if (!frames.length) return; setFocus(picked[0] ?? 0); setPlaying(true); };

  const down = (e: ReactMouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault(); (e.currentTarget as HTMLElement).closest<HTMLElement>('.gfxv')?.focus();
    if (focus != null) { anchor.current = focus; selectFrames(focus, focus); return; }
    const { x, y } = point(e), at = frameAt(L, x, y);
    if (!at) return;
    if (!(e.shiftKey && anchor.current != null)) anchor.current = at.frame;
    selectFrames(anchor.current!, at.frame);
    dragging.current = true;
  };
  const move = (e: ReactMouseEvent) => {
    const { x, y } = point(e), at = frameAt(L, x, y);
    setHover(at);
    if ((e.ctrlKey || e.metaKey) && !e.buttons && focus == null && at && !quiet.current) setFocus(at.frame);
    if (!dragging.current || !(e.buttons & 1) || anchor.current == null) { dragging.current = false; return; }
    if (at) selectFrames(anchor.current, at.frame);
  };
  const key = (e: KeyboardEvent) => { if (e.key === 'Escape' && e.target === e.currentTarget) { e.stopPropagation(); anchor.current = null; onClear(); } };

  const blockText = (a: Addr) => { const b = findBlock(A.blocks, a); if (!b) return 'not loaded'; const l = R.labels.get(b.start); return `${kindInfo(b.type).label}${l ? ` ${l.name}` : ''} (${hex(b.start)}–${hex(b.end - 1)})`; };
  const frameText = (i: number) => { const f = frames[i]; return `frame ${i + 1} of ${frames.length} · ${frameWhere(anim!, i)} · ${hex(f.start)}–${hex((f.end - 1) & 0xffff)}, ${((f.end - f.start) & 0xffff) || 0x10000} bytes, ${f.writes} characters written`; };
  const hoverText = hover && anim ? (() => {
    const f = frames[hover.frame], code = f.chars[hover.char], col = f.colours[hover.char];
    return `${frameText(hover.frame)} · row ${Math.floor(hover.char / 40)}, column ${hover.char % 40}: $${h2(code)} in ${C64_NAMES[col]}`;
  })() : null;

  // saving: the selection's bytes, its frames as one image, or as an animated GIF (or the whole animation)
  const [saveOpen, setSaveOpen] = useState(false);
  const saveRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!saveOpen) return;
    const close = (e: MouseEvent) => { if (!saveRef.current?.contains(e.target as Node)) setSaveOpen(false); };
    const esc = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setSaveOpen(false); } };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc, true);
    saveRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc, true); };
  }, [saveOpen]);
  const stem = anim ? `anim_${h4(anim.start)}` : 'anim';
  const named = picked.length === 1 ? `${stem}_frame${picked[0] + 1}` : picked.length ? `${stem}_frames${picked[0] + 1}-${picked[picked.length - 1] + 1}` : stem;
  const gif = (idx: number[]) => gifAnimation(idx.map(i => petsciiFramePixels(frames[i], font, colors.bg)), 320, 200, C64_RGB, speed * 2);
  const saveAs = !range || !anim ? [] : [
    { id: 'bin', label: 'Raw bytes of the stream (.bin)', name: `${named}.bin`, make: () => A.mem.slice(range.start, range.end) },
    { id: 'prg', label: 'With its load address (.prg)', name: `${named}.prg`, make: () => makePrg(range.start & 0xffff, A.mem.slice(range.start, range.end)) },
    ...(picked.length ? [{ id: 'png', label: picked.length === 1 ? 'The frame as an image (.png)' : `The ${picked.length} frames as one image, ${Math.min(cols, picked.length)} a row (.png)`, name: `${named}.png`, make: () => pngOf(framesImage(picked.map(i => frames[i]), font, colors.bg, cols)) }] : []),
    ...(picked.length > 1 ? [{ id: 'gif', label: `The ${picked.length} frames as an animated GIF (.gif)`, name: `${named}.gif`, make: () => gif(picked) }] : []),
    { id: 'gif-all', label: `The whole animation as an animated GIF, ${frames.length} frames (.gif)`, name: `${stem}.gif`, make: () => gif(frames.map((_, i) => i)) },
  ];
  const save = async (s: (typeof saveAs)[number]) => { setSaveOpen(false); onSave(s.name, await s.make()); };

  const now = <>
    <b>Animations</b>
    {anim ? <span>{frames.length} frames · {anim.sequences.length} sequence{anim.sequences.length === 1 ? '' : 's'}</span> : <span>none found</span>}
    <span>{cols} a row</span>
    <span>{zoom}×</span>
  </>;
  const rects = picked.map(i => frameBox(L, i));
  const every = Math.max(1, Math.ceil(14 / rowPx));
  return (
    <div className="gfxv" tabIndex={-1} onKeyDown={key} aria-label="Animations">
      <ViewModes label="Show memory as" modes={GFX_MODES} value="anim" onChange={k => set({ kind: k })} now={now} />
      <div className="gfxv-bar view-opts">
        {anims.length > 1 && <OptGroup title="Animation">
          <label className="gfxv-field">Animation<select aria-label="Animation" value={Math.min(which, anims.length - 1)} onChange={e => setWhich(+e.target.value)}>
            {anims.map((a, i) => <option key={i} value={i}>{hex(a.start)}–{hex((a.end - 1) & 0xffff)}: {a.frames.length} frames (player {hex(a.player.entry ?? a.player.next)})</option>)}
          </select></label>
        </OptGroup>}
        <OptGroup title="Layout">
          <label className="gfxv-field">Per row<select aria-label="Frames per row" value={cols} onChange={e => set({ animCols: +e.target.value })}>{ANIM_COLS.map(n => <option key={n} value={n}>{n}</option>)}</select></label>
          <label className="gfxv-field">Zoom<select aria-label="Zoom" value={zoom} onChange={e => set({ zoom: +e.target.value })}>{[1, 2, 3, 4].map(z => <option key={z} value={z}>{z}×</option>)}</select></label>
        </OptGroup>
        <OptGroup title="Characters">
          <label className="gfxv-field" title={rom && !rom.found && screenFont.startsWith('rom') ? `VICE's character ROM was not found (looked for ${rom.path || 'it beside the VICE in Settings → Toolchain'}): the built-in letters are drawn` : 'The characters the screen codes are drawn with (the VIC sees the ROM at $1000 and $9000)'}>Charset
            <select aria-label="Draw frames with" value={screenFont} onChange={e => set({ screenFont: e.target.value })}>
              <option value="rom">C64 ROM, upper case{rom && !rom.found ? ' (not found)' : ''}</option>
              <option value="rom-lower">C64 ROM, lower case{rom && !rom.found ? ' (not found)' : ''}</option>
              <option value="builtin">Built-in letters and digits</option>
              {charsets.length > 0 && <optgroup label="Charsets found">{charsets.map(b => <option key={b.start} value={`$${h4(b.start)}`}>{hex(b.start)}{R.labels.get(b.start) ? ` ${R.labels.get(b.start)!.name}` : ''}</option>)}</optgroup>}
              <optgroup label="2 KB of memory at">{Array.from({ length: 32 }, (_, i) => i * 0x800).filter(a => !charsets.some(b => b.start === a)).map(a => <option key={a} value={`$${h4(a)}`}>${h4(a)}</option>)}</optgroup>
            </select></label>
        </OptGroup>
        <OptGroup title="Colours">
          <label className="gfxv-field gfxv-color" title="The background ($d021): each character is drawn in its own colour over it">BG<i style={{ background: C64[colors.bg] }} />
            <select aria-label="Background colour" value={colors.bg} onChange={e => set({ colors: { ...colors, bg: +e.target.value } })}>{C64_NAMES.map((n, i) => <option key={i} value={i}>{n}</option>)}</select></label>
        </OptGroup>
        <OptGroup title="Play">
          <label className="gfxv-field" title="How long each frame is shown, in video frames (1/50 s on a PAL C64): as often as the program calls the player">Speed
            <select aria-label="Speed" value={speed} onChange={e => set({ animSpeed: +e.target.value })}>{ANIM_SPEEDS.map(v => <option key={v} value={v}>{v} {v === 1 ? 'video frame' : 'video frames'} ({animFps(v)}/s)</option>)}</select></label>
          <button className="btn small" disabled={!frames.length} title="Show the frames one after the other over the whole window, from the first one selected; Esc, Space or a click stops" onClick={play}><Icon name="play" size={13} />Play</button>
        </OptGroup>
      </div>
      <div className="gfxv-sel" role="status">
        {range && anim && picked.length ? <>
          <span><b className="mono">{picked.length === 1 ? `frame ${picked[0] + 1}` : `frames ${picked[0] + 1}–${picked[picked.length - 1] + 1}`}</b> <span className="muted">of {frames.length} · {hex(range.start)}–{hex((range.end - 1) & 0xffff)} ({range.end - range.start} bytes) · {blockText(range.start)}</span></span>
          <span className="grow" />
          <span className="gfxv-save" ref={saveRef}>
            <button className="btn small" aria-haspopup="menu" aria-expanded={saveOpen} onClick={() => setSaveOpen(o => !o)} title="Save the selection, its frames or the whole animation as a file"><Icon name="download" size={13} />Save…</button>
            {saveOpen && <div className="gfxv-menu" role="menu" aria-label="Save the selection as">
              {saveAs.map(s => <button key={s.id} role="menuitem" onClick={() => void save(s)}>{s.label}</button>)}
            </div>}
          </span>
          <button className="btn small ghost" onClick={() => onShow(range.start)}><Icon name="list" size={13} />Show in listing</button>
        </> : anim ? <span className="muted">
          The frames the player at {hex(anim.player.entry ?? anim.player.next)} draws, from the stream at {hex(anim.start)}–{hex((anim.end - 1) & 0xffff)}{anim.sequences.length > 1 ? ` (${anim.sequences.map(q => `${hex(q.start)} × ${q.frames}`).join(', ')}, in the order the code plays them)` : ''}: each frame changes the one before. Click a frame to select its bytes, Shift+click or drag for more; hold Ctrl over a frame to see it alone in the whole window.
          {anim.problem && <b> Fewer frames than the code plays: {anim.problem}.</b>}
        </span> : <span className="muted">
          No PETSCII animation in memory. Mimir knows the player that The Pumpkins' Breadbin of Horror draws its pumpkin with (a stream of changes to the frame before, through a table of screen codes and colours): its code, its tables and the frames all have to be loaded. From a Spindle disk, open the whole job with its button in the Spindle script tab.
        </span>}
      </div>
      <div className="gfxv-scroll" ref={scroller} onScroll={onScroll}>
        <div className="gfxv-inner" style={{ height: L.height * zoom }}>
          <div className="gfxv-gutter" aria-hidden="true">
            {Array.from({ length: L.rows }, (_, r) => {
              const i = r * L.cols, b = frames[i] ? findBlock(A.blocks, frames[i].start) : null;
              return <div key={r} className="gfxv-row" data-frame={i + 1} style={{ top: r * rowPx, height: rowPx }}>
                <i style={b ? { background: `var(--g-${groupOfKind(b.type)})` } : undefined} />{r % every === 0 && frames[i] && <span>#{i + 1}<br />{hex(frames[i].start)}</span>}
              </div>;
            })}
          </div>
          <div className="gfxv-canvas" style={{ width: L.width * zoom, height: L.height * zoom }} onMouseDown={down} onMouseMove={move} onMouseLeave={() => setHover(null)} onMouseUp={() => { dragging.current = false; }}
            onDoubleClick={e => { const { x, y } = point(e), at = frameAt(L, x, y); if (at) onShow(frames[at.frame].start); }}>
            <canvas ref={canvas} width={Math.max(1, L.width)} height={Math.max(1, (band.to - band.from) * stepY)} style={{ position: 'absolute', left: 0, top: band.from * rowPx, width: L.width * zoom, height: (band.to - band.from) * rowPx }} aria-label="Animation frames" />
            {rects.map((r, i) => <div key={i} className="gfxv-selrect" style={{ left: r.x * zoom, top: r.y * zoom, width: r.w * zoom, height: r.h * zoom }} />)}
          </div>
        </div>
      </div>
      <div className="gfxv-info mono small">{hoverText ?? (cursor != null ? `cursor ${hex(cursor)} · ${blockText(cursor)}` : ' ')}</div>
      {focus != null && anim && frames[focus] && <FrameFocus frame={frames[focus]} font={font} bg={colors.bg} label={`Frame ${focus + 1} of ${frames.length}`}>
        <span><b>frame {focus + 1} of {frames.length}</b> · {frameWhere(anim, focus)} · {hex(frames[focus].start)}–{hex((frames[focus].end - 1) & 0xffff)}</span>
        <span className="gfx-focus-keys">{playing ? `Playing at ${animFps(speed)} frames a second · Esc, Space or a click stops` : 'Wheel: the frame before or after · click: select it · let go of Ctrl to close'}</span>
      </FrameFocus>}
    </div>
  );
}

/** one frame over the whole window, as large as it fits; it lets the pointer through */
function FrameFocus({ frame, font, bg, label, children }: { frame: { chars: Uint8Array; colours: Uint8Array }; font: Uint8Array; bg: number; label: string; children: ReactNode }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useLayoutEffect(() => {
    const ctx = canvas.current?.getContext('2d'); if (!ctx) return;
    const img = ctx.createImageData(320, 200);
    drawFrame(img.data, 320, 0, 0, frame, font, bg);
    ctx.putImageData(img, 0, 0);
  }, [frame, font, bg]);
  return createPortal(
    <figure className="gfx-focus" aria-label={label}>
      <canvas ref={canvas} width={320} height={200} />
      <figcaption className="mono">{children}</figcaption>
    </figure>,
    document.body,
  );
}
