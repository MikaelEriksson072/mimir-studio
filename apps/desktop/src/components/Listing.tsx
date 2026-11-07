/* Listing — virtualized, interactive view of the shared line model (spec 6, "one line model, two views"). */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type MutableRefObject } from 'react';
import { createPortal } from 'react-dom';
import { findBlock, h2, h4, kickMnemonic, kindInfo, lineMove, loadAddress, monitorChar, offsetText, OPC, patchAt, patchEnd, relocAt, SPACE, typeInfo, TOP_LEVEL_DIRECTIVES, undocumentedText, type Addr, type AnalysisResult, type Block, type Bookmark, type ByteMove, type ListingLine, type Patch, type Token } from '@mimir/core';
import { cx, groupOfKind, groupOfType, ROW } from '../lib/util';
import { cellParts, type Cell } from '../lib/cells';
import { Icon } from '../lib/icons';
import { peekOf, peekOrder, PEEK_ROWS, type Peek, type PeekNames } from '../lib/peek';
import type { Changed, Editing, ScrollReq, Sel, ViewAt } from '../lib/types';
import { useUi, type Gutter } from '../store/ui';
import { CycleCell, type CycleView } from './Cycles';
import { bookmarkCss, bookmarkSpan } from './Bookmarks';
import { GfxStrip } from './GfxStrip';
import { gfxHead, gfxItemAt, gfxSize } from '../lib/gfxlines';

const TOKEN_CLASS: Record<Token['t'], string> = { lbl: 'syn-label', hw: 'syn-hw', kw: 'syn-kw', num: 'syn-num', str: 'syn-str', dir: 'syn-dir', def: 'syn-label', p: 'syn-p' };

/** a click on a reference goes there; with Shift it only ends the selection the line's mousedown has already
 *  extended, so a Shift+click that lands on a label never jumps away */
const follow = (e: ReactMouseEvent, t: Token, onToken: (t: Token) => void) => { e.stopPropagation(); if (!e.shiftKey) onToken(t); };

function Tok({ t, onToken }: { t: Token; onToken: (t: Token) => void }) {
  const cls = TOKEN_CLASS[t.t] || '';
  // a raw hardware address (hwInclude "none") keeps its register for the tooltip
  if ((t.t === 'lbl' || t.t === 'hw' || t.t === 'kw' || (t.t === 'num' && t.sym)) && t.to != null) {
    return <span className={cx(cls, 'link')} title={t.sym ? `${t.sym.name} — ${t.sym.desc}` : `Go to $${h4(t.to)}`} onClick={e => follow(e, t, onToken)}>{t.s}</span>;
  }
  // a PETSCII control code by name in a text (PET_CLR): what it does and its byte
  return <span className={cls} title={t.sym ? `${t.sym.name} — ${t.sym.desc}` : undefined}>{t.s}</span>;
}

/** an offset written after a label (`table+1`, `music.location+$0020`): its value, or null when it is not a number */
const offsetValue = (s: string): number | null => {
  const m = /^\$([0-9a-f]+)$/i.exec(s) ?? null;
  if (m) return parseInt(m[1], 16);
  if (/^%[01]+$/.test(s)) return parseInt(s.slice(1), 2);
  return /^\d+$/.test(s) ? parseInt(s, 10) : null;
};

/** an operand's tokens; after a label with an address, `+n` is a link of its own to the label's address plus n */
function Toks({ tok, onToken }: { tok: Token[]; onToken: (t: Token) => void }) {
  const out = [];
  for (let i = 0; i < tok.length; i++) {
    const t = tok[i], plus = tok[i + 1], n = tok[i + 2];
    out.push(<Tok key={i} t={t} onToken={onToken} />);
    if ((t.t === 'lbl' || t.t === 'kw') && t.to != null && plus?.t === 'p' && plus.s === '+' && n?.t === 'num' && !n.sym) {
      const off = offsetValue(n.s);
      if (off == null) continue;
      // in the label's bank (spec 13.9b): only the address in it wraps
      const to = t.to - (t.to & 0xffff) + ((t.to + off) & 0xffff);
      out.push(<span key={`${i}+`} className="link offset" title={`Go to $${h4(to)} (${t.s}+${n.s})`} onClick={e => follow(e, { t: 'num', s: n.s, to }, onToken)}><span className="syn-p">+</span><span className="syn-num">{n.s}</span></span>);
      i += 2;
    }
  }
  return <>{out}</>;
}

/** What an undocumented opcode does (a tooltip): an instruction's by its byte in `mem` (else by its mnemonic, one Kick
 *  Assembler writes), a line written as `.byte` by its first byte. */
function undocumentedTip(l: ListingLine, mem?: Uint8Array): string | undefined {
  if (l.k === 'ins' && l.ill) {
    if (mem && OPC[mem[l.a]].mn === l.mn) return undocumentedText(mem[l.a]) ?? undefined;
    const o = OPC.find(x => x.ill && x.kick && x.mn === l.mn);
    return (o && undocumentedText(o.op, true)) ?? undefined;
  }
  if (l.k === 'dat' && l.ill && /^\$[0-9a-f]{2}$/i.test(l.tok[0]?.s ?? '')) return undocumentedText(parseInt(l.tok[0].s.slice(1), 16)) ?? undefined;
  return undefined;
}

/** the bytes of a data line one by one (lib/cells.ts): `sel`, the selected bytes where the selection takes in only
 *  part of the line; `cur`, the byte at the cursor when the selection is of bytes */
export interface CellMarks { sel: { start: Addr; end: Addr } | null; cur: Addr | null }

/** A line's text. `mem`: the memory it is in, to name an undocumented opcode exactly in its tooltip; `cells`: write
 *  each byte of a data line as a cell of its own (a click on it picks that byte). */
export function LineBody({ l, onToken, mem, cells }: { l: ListingLine; onToken: (t: Token) => void; mem?: Uint8Array; cells?: CellMarks | null }) {
  const ind = <span className="ind" />;
  const ill = undocumentedTip(l, mem);
  const cmt = 'cmt' in l && l.cmt ? <span className={cx('syn-comment', 'cmt', 'userCmt' in l && l.userCmt && 'user', ill && l.k === 'dat' && 'ill-tip')} title={l.k === 'dat' ? ill : undefined}>// {l.cmt}</span> : null;
  switch (l.k) {
    case 'lbl': return <span className="syn-label def">{l.name}<span className="syn-p">:</span></span>;
    case 'ins': return <><span className="cp">{ind}<span className={cx(l.ill ? 'syn-ill' : 'syn-mn', ill && 'ill-tip')} title={ill}>{kickMnemonic(l.mn)}{l.ext}</span>{l.tok.length ? ' ' : ''}<Toks tok={l.tok} onToken={onToken} /></span>{cmt}</>;
    case 'dat': {
      const parts = cells ? cellParts(l) : null;
      const on = (c: Cell) => !!cells?.sel && c.a >= cells.sel.start && c.a + c.n <= cells.sel.end;
      const op = parts && cells ? parts.map((p, i) => (p.cell
        ? <span key={i} className={cx('cell', on(p.cell) && 'on', cells.cur != null && cells.cur >= p.cell.a && cells.cur < p.cell.a + p.cell.n && 'cur')} data-a={p.cell.a} data-n={p.cell.n}><Toks tok={p.tok} onToken={onToken} /></span>
        : <Toks key={i} tok={p.tok} onToken={onToken} />)) : <Toks tok={l.tok} onToken={onToken} />;
      return <><span className="cp">{ind}<span className={cx('syn-dir', ill && 'ill-tip')} title={ill}>{l.dir}</span> {op}</span>{cmt}</>;
    }
    case 'dir': { const top = !!l.tok[0] && TOP_LEVEL_DIRECTIVES.includes(l.tok[0].s); return <><span className="cp">{!top && ind}<Toks tok={l.tok} onToken={onToken} /></span>{cmt}</>; }
    case 'cmt': return <span className={cx('syn-comment', l.note && 'note', l.mark && 'mark')} title={l.note ? 'Double-click to edit' : l.mark ? 'Marked by the analysis: a part of a loader (Explorer → Loaders)' : undefined}>{l.raw ? l.text : l.text ? `// ${l.text}` : '//'}</span>;
    default: return null;
  }
}

/** where the bytes at a block's edge can go when their line is dragged by its address or bytes */
interface Moves { prev: ByteMove | null; next: ByteMove | null }
const movesOf = (A: AnalysisResult, l: ListingLine): Moves | null => {
  const prev = lineMove(A, l, 'prev'), next = lineMove(A, l, 'next');
  return prev || next ? { prev, next } : null;
};
const bytesText = (m: ByteMove) => (m.end - m.start > 1 ? `$${h4(m.start)}-$${h4(m.end - 1)}` : `$${h4(m.start)}`);
const intoText = (m: ByteMove, dir: 'prev' | 'next') => `the ${kindInfo(m.into.type).label} block ${dir === 'prev' ? 'above' : 'below'}`;
const moveTip = (mv: Moves) => ['Drag the address or the bytes into the block next to it:', mv.prev && `↑ ${bytesText(mv.prev)} into ${intoText(mv.prev, 'prev')}`, mv.next && `↓ ${bytesText(mv.next)} into ${intoText(mv.next, 'next')}`].filter(Boolean).join('\n');

/** how long the pointer rests on a line before the peek stays put when the pointer goes into it (ms) */
const PIN_MS = 300;

/** find (Ctrl+F): the lines with a match and the one shown; in the rows in view the matches are marked in the text */
export interface ListingFind { re: RegExp; hits: ReadonlySet<ListingLine>; cur: ListingLine | null }
const HL = 'mimir-find', HL_CUR = 'mimir-find-cur';

/** a Range over every match of `re` in the text of `el` (a match may run over several of its text nodes) */
function markIn(el: Element, re: RegExp, out: Range[]) {
  const nodes: Text[] = [], starts: number[] = [];
  let text = '';
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) { nodes.push(n as Text); starts.push(text.length); text += n.nodeValue ?? ''; }
  if (!text) return;
  const at = (k: number): [Text, number] => { let i = starts.length - 1; while (i > 0 && starts[i] > k) i--; return [nodes[i], k - starts[i]]; };
  for (const m of text.matchAll(re)) {
    if (!m[0]) continue;
    const r = new Range(), [sn, so] = at(m.index), [en, eo] = at(m.index + m[0].length);
    r.setStart(sn, so); r.setEnd(en, eo); out.push(r);
  }
}

interface ListingProps {
  /** the visible lines (folded blocks show only their header), their numbers in the .asm file, and the folds */
  lines: ListingLine[]; lineNo: Int32Array; folded: ReadonlySet<Addr>; hidden: Map<number, number>; onToggleFold: (blockStart: Addr) => void;
  /** starts of the blocks left out of the build (their rows are dimmed) */
  excluded: ReadonlySet<Addr>;
  A: AnalysisResult; lineOf: Int32Array; cursor: Addr | null; sel: Sel | null;
  /** the `.label` line in the file head clicked last: marked instead of the cursor's line (they all share one address) */
  picked?: number | null;
  /** `cell`: the byte (or word) of a data line the click was on */
  onClickLine: (l: ListingLine, i: number, e: ReactMouseEvent, dbl?: boolean, cell?: Cell | null) => void;
  /** the pointer was dragged (left button held) onto line `l` */
  onDragTo: (l: ListingLine) => void;
  /** a drag that started on byte `from`: over the bytes of its own line, onto byte `to`; onto another line (`to`
   *  null), onto line `l` */
  onDragCells: (from: Cell, to: Cell | null, l: ListingLine) => void;
  /** a line at a block's edge was dragged by its address or bytes and dropped in the block next to it */
  onMove: (m: ByteMove) => void;
  onToken: (t: Token) => void; onContext: (e: ReactMouseEvent, l: ListingLine, cell?: Cell | null) => void;
  scrollReq: ScrollReq | null; editing: Editing | null; onCommitEdit: (v: string) => void; onCancelEdit: () => void;
  labelError: string | null; setLabelError: (e: string | null) => void; listRef: MutableRefObject<HTMLDivElement | null>;
  /** left column: memory address (default) or line number in the .asm file */
  gutter: Gutter;
  /** the user's bookmarks: their lines get a mark in the left margin, which opens the note in the Bookmarks list */
  bookmarks: Record<Addr, Bookmark>; onBookmark: (a: Addr) => void;
  /** cycle counting on: the cycles column and the counted range */
  cycles?: CycleView | null;
  /** the user's patches: the bytes they wrote over are marked (spec 10.2) */
  patches?: readonly Patch[];
  /** when this changes (data shown as code), the line in view stays where it is on screen once the new lines come */
  keepView?: unknown;
  /** when this changes together with the lines (the deep analysis's reading landing after the normal one's), the line
   *  in view stays where it is on screen: its place is taken from the lines shown before */
  holdView?: unknown;
  /** the offset column (as in SourceGen): where the byte at an address is in the file it was opened from, and that
   *  file's name; null where no file holds it. Missing: no column */
  offsetAt?: ((a: Addr) => { n: number; file: string } | null) | null;
  /** a block whose type just changed: framed a moment, with what it became */
  changed?: Changed | null;
  find?: ListingFind | null;
  /** the labels and zero-page variables the peek's instructions use */
  names: PeekNames;
  /** where the editor was in memory (spec 14.6b): the listing opens there, unless the scroll request is newer */
  startAt?: ViewAt | null;
  /** the listing scrolled: where it is now, and the address whose bank Graphics and Memory show (the cursor's while it
   *  is on screen) */
  onView?: (v: ViewAt, shows: Addr) => void;
  /** a byte (or an instruction's first byte) was clicked in the peek: it is picked in the listing; `extend` (Shift):
   *  the selection runs to it */
  onPeekPick?: (a: Addr, extend: boolean) => void;
  /** a sprite block's header: give it `n` sprites (its size in 64-byte steps from its start) */
  onSprites?: (b: Block, n: number) => void;
  /** the listing's width changed (how many characters and sprites its pictures put on a row follows it) */
  onWidth?: (w: number) => void;
}

/** the line of the last loaded byte of `start`..`end` (a bookmark's area), -1 when it has none */
const lastLine = (lineOf: Int32Array, start: Addr, end: Addr): number => {
  let e = Math.min(end, lineOf.length) - 1;
  while (e > start && lineOf[e] < 0) e--;
  return e >= start ? lineOf[e] : -1;
};

export function Listing({ lines, lineNo, folded, hidden, onToggleFold, excluded, A, lineOf, cursor, picked, sel, onClickLine, onDragTo, onDragCells, onMove, onToken, onContext, scrollReq, editing, onCommitEdit, onCancelEdit, labelError, setLabelError, listRef, gutter, bookmarks, onBookmark, cycles, patches = [], keepView, holdView, offsetAt, changed, find, names, startAt, onView, onPeekPick, onSprites, onWidth }: ListingProps) {
  const box = useRef<HTMLDivElement | null>(null);
  const [top, setTop] = useState(0);
  const [height, setHeight] = useState(600);
  const widthTo = useRef(onWidth);
  widthTo.current = onWidth;
  useLayoutEffect(() => {
    const el = box.current; if (!el) return;
    const ro = new ResizeObserver(() => { setHeight(el.clientHeight); widthTo.current?.(el.clientWidth); });
    ro.observe(el); setHeight(el.clientHeight); widthTo.current?.(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // Drag to select: rows have a fixed height, so the line under the pointer follows from its y position
  // (the list is virtualized). Above or below the listing it scrolls, faster the further out the pointer is.
  // A line at a block's edge dragged by its address or bytes moves instead: dropped in the block next to it, its
  // bytes join that block (`moving` shows where they go).
  // A drag that starts on a byte of a data line selects bytes while it stays on that line, and whole lines (that one
  // too) once it goes onto another.
  const latest = useRef({ lines, onDragTo, onDragCells, onMove, A });
  latest.current = { lines, onDragTo, onDragCells, onMove, A };
  const drag = useRef<{ i: number; x: number; y: number; move?: { from: number; moves: Moves; m: ByteMove | null }; cell?: { from: Cell; line: number; to: Addr | null } } | null>(null);
  const [moving, setMoving] = useState<{ from: number; over: number; moves: Moves; m: ByteMove | null } | null>(null);
  const dragTo = (x: number, y: number) => {
    const d = drag.current, el = box.current; if (!d || !el) return;
    const { lines: ls, onDragTo: cb, onDragCells: cells, A: an } = latest.current;
    // a picture's room is the picture
    const i = gfxHead(ls, Math.max(0, Math.min(ls.length - 1, Math.floor((y - el.getBoundingClientRect().top + el.scrollTop) / ROW))));
    if (d.cell) {
      const c = d.cell;
      if (i === c.line) {
        const over = document.elementFromPoint(x, y);
        const to = (over && el.contains(over) ? cellUnder(over, x, y) : null) ?? c.from;
        if (to.a !== c.to) { c.to = to.a; d.i = i; cells(c.from, to, ls[i]); }
        return;
      }
      if ((i === d.i && c.to == null) || ls[i].k === 'blank' || ls[i].k === 'file') return;
      c.to = null; d.i = i; cells(c.from, null, ls[i]);
      return;
    }
    if (i === d.i) return;
    if (d.move) {
      // the bytes go into the block under the pointer when it is the one before or after theirs
      const t = ls[i], b = t.k === 'blank' || t.k === 'file' ? null : findBlock(an.blocks, t.a), { prev, next } = d.move.moves;
      d.i = i;
      d.move.m = b && prev && b.start === prev.into.start ? prev : b && next && b.start === next.into.start ? next : null;
      setMoving({ ...d.move, over: i });
      return;
    }
    if (ls[i].k === 'blank' || ls[i].k === 'file') return;
    d.i = i; cb(ls[i]);
  };
  const startDrag = (i: number, x: number, y: number, moves: Moves | null, cell: Cell | null) => {
    const d = { i, x, y, ...(moves ? { move: { from: i, moves, m: null } } : cell ? { cell: { from: cell, line: i, to: cell.a } } : {}) };
    drag.current = d;
    const tick = () => {
      const el = box.current;
      if (drag.current !== d || !el) return;
      const r = el.getBoundingClientRect();
      const over = d.y < r.top + ROW ? d.y - r.top - ROW : d.y > r.bottom - ROW ? d.y - r.bottom + ROW : 0;
      if (over) { el.scrollTop += Math.sign(over) * Math.min(ROW * 8, 2 + Math.ceil(Math.abs(over) / 3)); dragTo(d.x, d.y); }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };
  useEffect(() => {
    /** the button is up: a move dropped in the block next to it happens; Esc, leaving the window or losing the button cancel it */
    const end = (drop: boolean) => {
      const d = drag.current; drag.current = null;
      if (!d?.move) return;
      setMoving(null);
      if (drop && d.move.m) latest.current.onMove(d.move.m);
    };
    const move = (e: MouseEvent) => { const d = drag.current; if (!d) return; if (!(e.buttons & 1)) { end(false); return; } d.x = e.clientX; d.y = e.clientY; dragTo(e.clientX, e.clientY); };
    const up = () => end(true), blur = () => end(false);
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape' && drag.current?.move) { e.preventDefault(); e.stopPropagation(); end(false); } };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up); window.addEventListener('blur', blur); window.addEventListener('keydown', key, true);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); window.removeEventListener('blur', blur); window.removeEventListener('keydown', key, true); drag.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  /** the byte (or word) of a data line under the pointer, or the item of a picture (a character, a sprite, a bitmap
   *  cell) at the point */
  const cellUnder = (t: Element, x: number, y: number): Cell | null => {
    const el = t.closest<HTMLElement>('.cell');
    if (el) return { a: Number(el.dataset.a), n: Number(el.dataset.n) };
    const g = t.closest<HTMLElement>('.gfx-strip'), l = g ? latest.current.lines[Number(g.dataset.i)] : null;
    if (!g || l?.k !== 'gfx') return null;
    const r = g.getBoundingClientRect(), { height, scale } = gfxSize(l);
    // under a sprite: its address, which is the sprite's too
    return gfxItemAt(l, (x - r.left) / scale, Math.min(height - 1, (y - r.top) / scale));
  };
  const cellOf = (e: ReactMouseEvent): Cell | null => cellUnder(e.target as Element, e.clientX, e.clientY);
  const down = (l: ListingLine, i: number, e: ReactMouseEvent) => {
    if (e.button !== 0) return;
    // no native text selection while dragging a range; keep the keyboard on the listing
    e.preventDefault(); box.current?.focus();
    const cell = cellOf(e);
    onClickLine(l, i, e, false, cell);
    // by its address or bytes, a line at a block's edge moves into the block next to it; from a byte a drag selects
    // bytes; elsewhere it selects lines
    const handle = !e.shiftKey && l.k !== 'hdr' && l.k !== 'gfx' && (e.target as HTMLElement).closest('.adr, .hex');
    startDrag(i, e.clientX, e.clientY, handle ? movesOf(A, l) : null, !e.shiftKey ? cell : null);
  };

  // The peek: Ctrl held over a line shows its block the other way than the listing does (lib/peek.ts), right under the
  // line. Ctrl pressed shows it after a moment, so Ctrl+C and the other keys with Ctrl show none; a key pressed with
  // Ctrl closes it until Ctrl is let go. `x`: where the pointer came onto the row; `top`: the row's top on screen;
  // `since`: when it came onto the row. Once the pointer has rested on the row a moment (PIN_MS), the box stays when
  // the pointer goes into it, and a click there picks that byte in the listing; before that it follows the pointer
  // down the lines under it. With Ctrl held the mouse wheel over the line or the box scrolls the box up and down the
  // whole file, block after block (`off`, in rows from the line), as many rows a notch as the system scrolls lines, and
  // never zooms the window; onto another line the box starts at that line again. `line`: the line the box is for, kept
  // so a click in the box that unfolds a block (and so moves the lines) leaves the box as it is.
  const lower = useUi(s => s.mon.lower);
  const gfxColors = useUi(s => s.gfx.colors);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const peekKeys = useRef({ quiet: false, timer: 0, wheel: 0 });
  const [peekRow, setPeekRow] = useState<{ i: number; line: ListingLine; x: number; top: number; since: number; off: number } | null>(null);
  /** the blocks in the listing's order, worked out when a peek needs them */
  const peekBlocks = useRef<{ lines: ListingLine[]; A: AnalysisResult; order: Block[] } | null>(null);
  /** the peek shown: how far its wheel goes */
  const peekShown = useRef<Peek | null>(null);
  /** the peek at the line under the pointer (none over the edit popover, or when the pointer is not on the listing) */
  const peekNow = () => {
    const p = pointer.current, el = box.current;
    const over = p && el && !peekKeys.current.quiet ? document.elementFromPoint(p.x, p.y) : null;
    const onPeek = !!over?.closest('.peek');
    if (!p || !el || !over || (!onPeek && (!el.contains(over) || over.closest('.edit-pop')))) { setPeekRow(null); return; }
    const r = el.getBoundingClientRect(), i = gfxHead(latest.current.lines, Math.floor((p.y - r.top + el.scrollTop) / ROW));
    const top = r.top + i * ROW - el.scrollTop, now = Date.now();
    setPeekRow(q => {
      if (onPeek && q && now - q.since >= PIN_MS) return q;
      if (p.y < r.top || p.y >= r.bottom || i < 0 || i >= latest.current.lines.length) return onPeek ? q : null;
      const line = latest.current.lines[i];
      return q && q.i === i && q.line === line && q.top === top ? q : q?.i === i && q.line === line ? { ...q, top } : { i, line, x: p.x, top, since: now, off: 0 };
    });
  };
  useEffect(() => {
    const k = peekKeys.current;
    const off = () => { clearTimeout(k.timer); k.wheel = 0; setPeekRow(null); };
    const keyDown = (e: KeyboardEvent) => {
      if (e.key === 'Control' || e.key === 'Meta') { if (!e.repeat) { k.quiet = false; clearTimeout(k.timer); k.timer = window.setTimeout(peekNow, 150); } return; }
      // Shift with the pointer in the box is for Shift+click there
      const p = pointer.current;
      if (e.key === 'Shift' && p && document.elementFromPoint(p.x, p.y)?.closest('.peek')) return;
      k.quiet = e.ctrlKey || e.metaKey; off();
    };
    const keyUp = (e: KeyboardEvent) => { if (e.key === 'Control' || e.key === 'Meta') { k.quiet = false; off(); } };
    const blur = () => { k.quiet = false; off(); };
    // Ctrl and the wheel over the listing or the box: the box comes at once if it is not up yet, else it scrolls
    const wheel = (e: WheelEvent) => {
      const el = box.current, t = e.target instanceof Element ? e.target : null;
      if (!(e.ctrlKey || e.metaKey) || k.quiet || !el || !t || !(t.closest('.peek') || (el.contains(t) && !t.closest('.edit-pop')))) return;
      e.preventDefault();
      pointer.current = { x: e.clientX, y: e.clientY };
      const pk = peekShown.current;
      if (!pk) { clearTimeout(k.timer); peekNow(); return; }
      // in rows: a line of the system's wheel setting is 100/3 pixels
      k.wheel += e.deltaMode === 1 ? e.deltaY : e.deltaMode === 2 ? e.deltaY * PEEK_ROWS : e.deltaY / (100 / 3);
      const n = Math.trunc(k.wheel);
      if (!n) return;
      k.wheel -= n;
      setPeekRow(q => { if (!q) return q; const o = Math.max(pk.min, Math.min(pk.max, q.off + n)); return o === q.off ? q : { ...q, off: o }; });
    };
    window.addEventListener('keydown', keyDown, true); window.addEventListener('keyup', keyUp, true); window.addEventListener('blur', blur);
    window.addEventListener('wheel', wheel, { capture: true, passive: false });
    return () => { window.removeEventListener('keydown', keyDown, true); window.removeEventListener('keyup', keyUp, true); window.removeEventListener('blur', blur); window.removeEventListener('wheel', wheel, { capture: true }); clearTimeout(k.timer); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const peekMove = (e: ReactMouseEvent) => {
    pointer.current = { x: e.clientX, y: e.clientY };
    // a button held in the listing is a drag (no peek); in the box it is a click on a byte
    const inPeek = !!(e.target as HTMLElement).closest?.('.peek');
    if ((e.ctrlKey || e.metaKey) && (!e.buttons || inPeek) && !peekKeys.current.quiet) { clearTimeout(peekKeys.current.timer); peekNow(); } else if (peekRow) setPeekRow(null);
  };
  const peek = useMemo((): Peek | null => {
    const l = peekRow?.line;
    if (!l || l.k === 'blank' || l.k === 'file') return null;
    const b = findBlock(A.blocks, l.a);
    // a relocated block is read where its bytes run, in the blocks inside it
    if (!b || b.type === 'reloc' || l.a < b.start || l.a >= b.end) return null;
    // a block the listing shows as code (code, or data shown as code) is shown as bytes, the others as code
    const at = lines[lineOf[l.a]], shownAsCode = b.type === 'code' || !!(at && 'preview' in at && at.preview);
    let o = peekBlocks.current;
    if (!o || o.lines !== lines || o.A !== A) peekBlocks.current = o = { lines, A, order: peekOrder(A, lines) };
    return peekOf(A, names, o.order, b, l.a, 'n' in l ? l.n : 0, !shownAsCode, peekRow?.off);
  }, [peekRow?.line, peekRow?.off, lines, lineOf, A, names]); // eslint-disable-line react-hooks/exhaustive-deps
  peekShown.current = peekRow ? peek : null;
  /** the line of `a`, or of the nearest address in its bank that has one (after it first) */
  const lineNear = (a: Addr): number => {
    if (lineOf[a] >= 0) return lineOf[a];
    const s = a - (a % SPACE), e = Math.min(s + SPACE, lineOf.length);
    for (let b = a + 1; b < e; b++) if (lineOf[b] >= 0) return lineOf[b];
    for (let b = Math.min(a, e) - 1; b >= s; b--) if (lineOf[b] >= 0) return lineOf[b];
    return -1;
  };
  /** the listing opens where the editor was (14.6b): where the listing itself was while its lines are the same, else
   *  with the line of the address at the top, its labels and comments with it; the cursor comes into view when the
   *  view that place is from had it on screen */
  const placeAt = (v: ViewAt): boolean => {
    const el = box.current; if (!el) return false;
    if (v.lines === lines && v.top != null) { el.scrollTop = v.top; setTop(el.scrollTop); return true; }
    const i = lineNear(v.addr); if (i < 0) return false;
    let j = i; while (j > 0 && lines[j - 1].a === lines[i].a && ['lbl', 'hdr', 'dir', 'cmt'].includes(lines[j - 1].k) && i - j < 6) j--;
    el.scrollTop = j * ROW;
    const ci = cursor != null && cursor >= v.addr && cursor < v.end ? lineOf[cursor] : -1;
    if (ci >= 0 && (ci + 1) * ROW > el.scrollTop + el.clientHeight) el.scrollTop = Math.max(0, ci * ROW - Math.floor(el.clientHeight / 3));
    setTop(el.scrollTop);
    return true;
  };
  /** the listing scrolled: its top line, its bottom line, and the scroll position, for the tab opened next */
  const report = () => {
    const el = box.current; if (!el || !onView || !lines.length) return;
    const t = Math.min(lines.length - 1, Math.floor(el.scrollTop / ROW)), b = Math.min(lines.length - 1, Math.floor((el.scrollTop + el.clientHeight) / ROW));
    const ci = cursor != null ? lineOf[cursor] : -1;
    onView({ addr: lines[t].a, end: lines[b].a + 1, n: Date.now(), top: el.scrollTop, lines }, ci >= t && ci <= b ? cursor! : lines[t].a);
  };
  const opened = useRef(false);
  useLayoutEffect(() => {
    // opening the listing: where the editor was in memory, unless a jump since then is newer
    const first = !opened.current; opened.current = true;
    if (first && startAt && startAt.n > (scrollReq?.n ?? 0) && placeAt(startAt)) return;
    if (!scrollReq || !box.current) return;
    // a find hit is the line itself; an address shows the labels and comments above its line too
    const i = scrollReq.line ? lines.indexOf(scrollReq.line) : lineOf[scrollReq.addr];
    if (i < 0) return;
    let j = i; while (!scrollReq.line && j > 0 && lines[j - 1].a === lines[i].a && ['lbl', 'hdr', 'dir', 'cmt'].includes(lines[j - 1].k) && i - j < 6) j--;
    const el = box.current, vis = el.clientHeight;
    const y = j * ROW;
    // a block whose type changed: its first line stays where it was on screen, with its header in view
    const kept = scrollReq.y != null ? Math.max(0, Math.min(i * ROW - scrollReq.y, y)) : null;
    // a bookmark's area: from its first line (with the labels above it), as much of it as fits under it
    const i1 = scrollReq.end != null ? lastLine(lineOf, scrollReq.addr, scrollReq.end) : -1;
    if (scrollReq.top) el.scrollTop = Math.max(0, (i - 1) * ROW);
    else if (scrollReq.center && i1 > i && (i1 + 1) * ROW > y - Math.floor(vis / 3) + vis) el.scrollTop = Math.max(0, Math.min(y - ROW, (i1 + 1) * ROW - vis));
    else if (kept != null && (i + 1) * ROW <= kept + vis) el.scrollTop = kept;
    else if (scrollReq.center || y < el.scrollTop || (i + 1) * ROW > el.scrollTop + vis) el.scrollTop = Math.max(0, y - Math.floor(vis / 3));
    // the rows at the new place render now, not after the scroll event
    setTop(el.scrollTop);
  }, [scrollReq]); // eslint-disable-line react-hooks/exhaustive-deps
  // Data as code turns rows of data into many lines (and back): the line in view stays where it is on screen. That
  // is the cursor's line when it is in view, else the top line with bytes; its place on screen is taken before the
  // change (the bar above the listing comes and goes with it) and kept until the new lines are there.
  const boxTop = useRef(0);
  const keep = useRef<{ addr: Addr; y: number; at: number } | null>(null);
  const keptOnce = useRef(false);
  const place = () => {
    const el = box.current, k = keep.current; if (!el || !k) return;
    // the address's line, or (read another way now, inside a row or an instruction) the nearest line before it
    let i = lineOf[k.addr] ?? -1;
    for (let b = k.addr - 1; i < 0 && b >= 0 && k.addr - b < 64; b--) i = lineOf[b] ?? -1;
    if (i < 0) return;
    // a whole pixel: on a 200 % screen the scroll position takes half pixels, rounded up, and the line would creep up
    // a quarter of a pixel each time Data as code is turned on or off
    el.scrollTop = Math.max(0, Math.round(el.getBoundingClientRect().top + i * ROW - k.y));
    setTop(el.scrollTop);
  };
  useLayoutEffect(() => {
    if (!keptOnce.current) { keptOnce.current = true; return; }
    const el = box.current; if (!el) return;
    const s = el.scrollTop, ci = cursor != null ? lineOf[cursor] : -1;
    let i = ci >= 0 && ci * ROW >= s && (ci + 1) * ROW <= s + el.clientHeight ? ci : -1;
    const bytes = (l: ListingLine) => 'n' in l && l.n > 0;
    if (i < 0) { i = Math.ceil(s / ROW); while (i < lines.length && !bytes(lines[i])) i++; }
    if (i >= lines.length) return;
    keep.current = { addr: i === ci && cursor != null ? cursor : lines[i].a, y: boxTop.current + i * ROW - s, at: Date.now() };
    place();
  }, [keepView]); // eslint-disable-line react-hooks/exhaustive-deps
  // A new reading of the same program (the deep analysis after the normal one) comes with its lines in the same render:
  // the line in view is taken from the lines shown before it, here, before they are replaced, and kept as above
  const shown = useRef({ lines, lineOf, hold: holdView });
  if (holdView !== shown.current.hold) {
    const el = box.current, prev = shown.current;
    shown.current.hold = holdView;
    if (el && prev.lines.length && prev.lines !== lines) {
      const s = el.scrollTop, ci = cursor != null ? prev.lineOf[cursor] ?? -1 : -1;
      let i = ci >= 0 && ci * ROW >= s && (ci + 1) * ROW <= s + el.clientHeight ? ci : -1;
      if (i < 0) { i = Math.ceil(s / ROW); while (i < prev.lines.length && !('n' in prev.lines[i] && (prev.lines[i] as { n: number }).n > 0)) i++; }
      if (i < prev.lines.length) keep.current = { addr: i === ci && cursor != null ? cursor : prev.lines[i].a, y: boxTop.current + i * ROW - s, at: Date.now() };
    }
  }
  useLayoutEffect(() => { shown.current.lines = lines; shown.current.lineOf = lineOf; });
  useLayoutEffect(() => {
    const k = keep.current; if (!k) return;
    if (Date.now() - k.at < 10000) place();
    keep.current = null;
  }, [lines]); // eslint-disable-line react-hooks/exhaustive-deps
  const curLine = picked ?? (cursor != null ? lineOf[cursor] : -1);
  // the counted range's instructions, by address
  const steps = useMemo(() => new Map((cycles?.path?.steps ?? []).map(s => [s.pc, s])), [cycles?.path]);
  // the line each bookmark is on (a folded block's header holds the bookmarks inside it)
  const marks = useMemo(() => {
    const m = new Map<number, Addr[]>();
    for (const k of Object.keys(bookmarks)) { const a = Number(k), i = lineOf[a]; if (i >= 0) m.set(i, [...(m.get(i) || []), a].sort((x, y) => x - y)); }
    return m;
  }, [bookmarks, lineOf]);
  // the areas of the bookmarks on one: from the bookmark's line to the line of the area's last byte, the innermost
  // first (the one that starts last, then the shortest), whose colour a line in more than one shows
  const areas = useMemo(() => {
    const out: { i0: number; i1: number; css: string }[] = [];
    for (const [k, b] of Object.entries(bookmarks)) {
      if (b.end == null) continue;
      const a = Number(k), i0 = lineOf[a], i1 = lastLine(lineOf, a, b.end);
      if (i0 >= 0 && i1 > i0) out.push({ i0, i1, css: bookmarkCss(b.color) });
    }
    return out.sort((x, y) => y.i0 - x.i0 || x.i1 - y.i1);
  }, [bookmarks, lineOf]);
  // a block whose type just changed: its lines, from its header (and the lines above its first byte) to its last byte
  const frame = useMemo(() => {
    if (!changed) return null;
    let i0 = lineOf[changed.start];
    let i1 = lineOf[changed.end - 1];
    if (i0 < 0 || i1 < i0) return null;
    // a picture's room too
    while (i1 + 1 < lines.length && lines[i1 + 1].k === 'gfx' && (lines[i1 + 1] as { pad?: boolean }).pad) i1++;
    while (i0 > 0 && lines[i0 - 1].a === changed.start && lines[i0 - 1].k !== 'blank' && lines[i0 - 1].k !== 'file') i0--;
    return { top: i0 * ROW, height: (i1 - i0 + 1) * ROW };
  }, [changed, lines, lineOf]);
  /** the offset column's cell for a line (empty where it has no bytes or no file holds them) */
  const offCell = (a: Addr | null) => {
    if (!offsetAt) return null;
    const o = a != null ? offsetAt(a) : null;
    return <span className="off" title={o ? `Offset $${o.n.toString(16)} (${o.n}) in ${o.file}` : undefined}>{o ? offsetText(o.n) : ''}</span>;
  };
  const mark = (i: number) => {
    const at = marks.get(i); if (!at) return null;
    const b = bookmarks[at[0]];
    const note = at.length === 1 && b.text ? `\n\n${b.text.length > 300 ? b.text.slice(0, 300) + '…' : b.text}` : '';
    const tip = at.map(a => `Bookmark ${bookmarkSpan(a, bookmarks[a])}: ${bookmarks[a].title}`).join('\n') + note + '\n\nClick to open the note';
    return <button className="bm-mark" aria-label={`Bookmark $${h4(at[0])}: ${b.title}`} title={tip} onMouseDown={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); onBookmark(at[0]); }}><svg viewBox="0 0 8 11" width="8" height="11" aria-hidden="true"><path d="M0 0h8v11L4 8 0 11z" /></svg></button>; };
  /** a bookmarked line is tinted in the colour of its (first) bookmark, which its mark has too */
  const tint = (i: number) => { const at = marks.get(i); return at ? { '--bm': bookmarkCss(bookmarks[at[0]].color) } as React.CSSProperties : undefined; };
  /** a line in a bookmark's area: the stripe in the left margin, which hangs from the mark and ends at its last line */
  const stripe = (i: number, to = i) => {
    const r = areas.find(x => to >= x.i0 && i <= x.i1); if (!r) return null;
    return <span className={cx('bm-area', i === r.i0 && 'first', r.i1 >= i && r.i1 <= to && 'last')} style={{ background: r.css }} aria-hidden="true" />;
  };
  /** a line with a find match, and the one shown */
  const hit = (l: ListingLine) => (find?.hits.has(l) ? (find.cur === l ? 'hit hit-cur' : 'hit') : undefined);
  // with data shown as code the listing no longer matches the .asm file line for line: addresses then
  const byLine = gutter === 'line' && !lines.some(l => 'preview' in l && l.preview);
  // a picture above the rows in view whose room reaches into them is drawn too
  const first = gfxHead(lines, Math.max(0, Math.floor(top / ROW) - 10)), last = Math.min(lines.length, Math.ceil((top + height) / ROW) + 10);
  const rows = [];
  for (let i = first; i < last; i++) {
    const l = lines[i];
    const n = 'n' in l ? l.n : 0;
    const blk = l.a != null ? findBlock(A.blocks, l.a) : null;
    const g = blk ? groupOfKind(blk.type) : null;
    // a line whose bytes are cells is selected when the selection takes in all of them, else the cells it takes in are
    const cells = n > 0 && l.k === 'dat' && !!cellParts(l);
    const full = !!sel && n > 0 && l.a >= sel.start && l.a + n <= sel.end;
    const isSel = cells ? full : sel && n > 0 && l.a >= sel.start && l.a < sel.end;
    const cellMarks: CellMarks | null = cells ? { sel: sel && !full && l.a < sel.end && l.a + n > sel.start ? sel : null, cur: sel?.bytes && i === curLine ? cursor : null } : null;
    const bytes = n > 0 ? [...A.mem.subarray(l.a, l.a + Math.min(n, 3))].map(h2).join(' ') + (n > 3 ? ' …' : '') : '';
    const drop = !!(moving?.m && blk && blk.start === moving.m.into.start);
    // where a relocated block runs (8.1b): a stripe beside the gutter, and where the bytes are loaded in the tooltip
    const run = A.relocs.length && l.a != null && l.k !== 'file' ? relocAt(A, l.a) : undefined;
    const runTip = run && (n > 0 || l.k === 'lbl') ? `Runs at $${h4(l.a)}; loaded at $${h4(loadAddress(A, l.a))} (the program copies $${h4(run.start)}-$${h4(run.end - 1)} to $${h4(run.to)})` : undefined;
    if (l.k === 'hdr') {
      const hg = groupOfType(l.type);
      const inSel = !!(sel && sel.multi && blk && blk.start >= sel.start && blk.end <= sel.end);
      // the loaders this block holds a part of
      const lparts = blk ? A.loaders.flatMap(f => f.parts.filter(p => p.start < blk.end && p.end > blk.start).map(p => ({ f, p }))) : [];
      rows.push(<div key={i} className={cx('row', 'hdr', inSel && 'sel', l.preview && 'preview', drop && 'drop-into', marks.has(i) && 'bm', run && 'in-reloc', hit(l))} style={{ top: i * ROW, ...tint(i) }} onMouseDown={e => down(l, i, e)} onContextMenu={e => onContext(e, l)}>
        <span className="gut" style={{ background: `var(--g-${hg})` }} />{stripe(i)}{mark(i)}{offCell(l.a)}<span className={cx('adr', byLine && 'lno')}>{byLine ? lineNo[i] : h4(l.a)}</span>
        <button className="fold" aria-label={folded.has(l.a) ? 'Unfold block' : 'Fold block'} aria-expanded={!folded.has(l.a)} title={folded.has(l.a) ? 'Unfold (F)' : 'Fold (F)'}
          onMouseDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); onToggleFold(l.a); }}><Icon name={folded.has(l.a) ? 'chevron' : 'down'} size={12} /></button>
        <span className="hdr-chip" style={{ '--c': `var(--g-${hg})` } as React.CSSProperties}>{typeInfo(l.type).label}</span>
        <span className="hdr-text">{l.text}</span>{l.excluded && <span className="hdr-excluded" title="Left out of the build: the block stays in the source under #if, its labels in #else">not built</span>}{l.binary && <span className="hdr-binary" title={`Saved as ${l.binary} and loaded with .import binary`}>binary</span>}{l.preview && <span className="hdr-preview" title="Shown as code; the export still writes this block as it is classified">as code</span>}{blk && blk.user && <span className="hdr-user" title="Type set by you"><Icon name="pencil" size={12} /></span>}{lparts.length > 0 && <span className="hdr-loader" title={lparts.map(({ f, p }) => `${f.name}: ${p.what}`).join('\n')}>{[...new Set(lparts.map(({ f }) => f.name.replace(/ \(.*$/, '')))].join(', ')}</span>}
        {blk && blk.type === 'sprite' && blk.start === l.a && onSprites && <SpriteCount b={blk} onSprites={onSprites} />}
        {hidden.has(i) && <span className="hdr-folded">{hidden.get(i)} line{hidden.get(i) === 1 ? '' : 's'} folded</span>}
        {blk && !blk.user && blk.conf < 0.7 && <span className="hdr-conf" title={`Low confidence: ${blk.reason}`}>?</span>}
      </div>);
      continue;
    }
    if (l.k === 'file') { rows.push(<div key={i} className={cx('row filebar', hit(l))} style={{ top: i * ROW }}><Icon name="doc" size={13} /> {l.text}</div>); continue; }
    // a picture (lib/gfxlines): one row as tall as the picture; the lines of its room are drawn by it
    if (l.k === 'gfx') {
      if (l.pad) continue;
      const end = l.a + l.n, full = !!sel && l.a >= sel.start && end <= sel.end;
      const over = sel && sel.start < end && sel.end > l.a ? sel : null;
      rows.push(
        <div key={i} className={cx('row', 'k-gfx', full && 'sel', i === curLine && 'cur', blk && excluded.has(blk.start) && 'excluded', drop && 'drop-into', marks.has(i) && 'bm', run && 'in-reloc', hit(l))} style={{ top: i * ROW, height: l.rows * ROW, ...tint(i) }}
          onMouseDown={e => down(l, i, e)} onDoubleClick={e => onClickLine(l, i, e, true)} onContextMenu={e => onContext(e, l, cellOf(e))}>
          <span className="gut" style={g ? { background: `var(--g-${g})` } : undefined} />{stripe(i, i + l.rows - 1)}{mark(i)}
          {offCell(l.a)}<span className={cx('adr', byLine && 'lno')} title={runTip}>{byLine ? lineNo[i] || '' : h4(l.a)}</span>
          <span className="hex" title={`$${h4(l.a)}–$${h4(end - 1)} (${l.n} byte${l.n === 1 ? '' : 's'})`}>–{h4(end - 1)}</span>
          {cycles && <span className="cyc" />}
          <span className="src gfx-src"><GfxStrip l={l} i={i} A={A} colors={gfxColors} sel={over} cur={i === curLine ? cursor : null} />{l.cmt && <span className="syn-comment cmt user">// {l.cmt}</span>}</span>
        </div>);
      continue;
    }
    // blank lines are rows of their own only when the line numbers would otherwise skip them, or a bookmark's area's
    // stripe goes on through them; an empty line the user inserted always is, so a right-click can remove it
    if (l.k === 'blank') {
      const s = stripe(i);
      if (l.user) rows.push(<div key={i} className={cx('row k-blank user-blank', hit(l))} style={{ top: i * ROW }} title="An empty line you inserted (Shift+Enter): double-click to write a comment line on it; Shift+Backspace on the line under it, or a right-click here, removes it"
        onMouseDown={e => down(l, i, e)} onDoubleClick={e => onClickLine(l, i, e, true)} onContextMenu={e => onContext(e, l)}><span className="gut" />{s}{offCell(null)}<span className={cx('adr', byLine && 'lno')}>{byLine ? lineNo[i] : ''}</span></div>);
      else if (byLine || s) rows.push(<div key={i} className="row k-blank" style={{ top: i * ROW }}><span className="gut" />{s}{offCell(null)}{byLine && <span className="adr lno">{lineNo[i]}</span>}</div>);
      continue;
    }
    // only a line at a block's edge can move into the block next to it
    const mv = blk && n > 0 && (l.a === blk.start || l.a + n === blk.end) ? movesOf(A, l) : null, tip = mv ? moveTip(mv) : undefined;
    // bytes a patch wrote over (the first of its lines names it)
    const pt = n > 0 && patches.length ? patchAt(patches, l.a) : undefined;
    const ptTip = pt && `Patched: "${pt.name}" wrote $${h4(pt.start)}-$${h4(patchEnd(pt) - 1)} over the original (P edits it)`;
    rows.push(
      <div key={i} className={cx('row', `k-${l.k}`, isSel && 'sel', i === curLine && 'cur', 'preview' in l && l.preview && 'preview', 'delay' in l && l.delay && 'delay', blk && excluded.has(blk.start) && 'excluded', cycles && steps.get(l.a) && !steps.get(l.a)!.counted && l.k === 'ins' && 'cy-skip', mv && 'movable', drop && 'drop-into', moving?.from === i && 'moving-src', pt && 'patched', marks.has(i) && 'bm', run && 'in-reloc', hit(l))} style={{ top: i * ROW, ...tint(i) }}
        onMouseDown={e => down(l, i, e)} onDoubleClick={e => onClickLine(l, i, e, true)} onContextMenu={e => onContext(e, l, cellOf(e))}>
        <span className="gut" style={g ? { background: `var(--g-${g})` } : undefined} />{stripe(i)}{mark(i)}
        {offCell(n > 0 || l.k === 'lbl' ? l.a : null)}<span className={cx('adr', byLine && 'lno')} title={tip ?? runTip}>{byLine ? lineNo[i] : n > 0 || l.k === 'lbl' ? h4(l.a) : ''}</span>
        <span className="hex" title={pt ? [ptTip, tip].filter(Boolean).join('\n\n') : tip}>{bytes}</span>
        {cycles && <CycleCell l={l} A={A} step={steps.get(l.a)} taken={cycles.taken} onToggle={cycles.onToggle} />}
        <span className="src"><LineBody l={l} onToken={onToken} mem={A.mem} cells={cellMarks} />{l.k === 'dir' && l.zp != null && <span className="zp-tag" title={`Zero-page variable $${h2(l.zp)}: double-click or N renames it everywhere; ; / * comment it`}>zero page</span>}{'delay' in l && l.delay && <span className="zp-tag delay-tag" title="Timing code: a branch that a timer sets goes part of the way into these instructions, so they only take time (their operands are no data)">delay</span>}{pt && pt.start === l.a && <span className="zp-tag patch-tag" title={ptTip || undefined}>patch {pt.name}</span>}</span>
      </div>);
  }
  let pop = null;
  if (editing) {
    // a .label line in the file head has no line of the label's own address: the editor opens under that line
    const i = editing.line ?? lineOf[editing.addr];
    if (i != null && i >= 0) {
      let j = i; while (editing.line == null && j > 0 && lines[j - 1].a === editing.addr && lines[j - 1].k === 'lbl') j--;
      // a comment line or block goes above the labels (and the empty lines under it): open the editor at its first line
      // (a zero-page variable's comment lines carry its address in `zp`); one written on an empty line opens there
      const ofNote = (x: ListingLine) => (x.k === 'cmt' && x.note) || (x.k === 'blank' && x.under);
      if (editing.kind === 'note' && editing.blank == null) while (j > 0 && (editing.zp ? (lines[j - 1] as { zp?: Addr }).zp : lines[j - 1].a) === editing.addr && ofNote(lines[j - 1])) j--;
      // under a picture, not over it
      const at = editing.kind === 'comment' ? i : j, under = lines[at]?.k === 'gfx' ? (lines[at] as { rows: number }).rows : 1;
      pop = <EditPopover key={editing.kind + editing.addr + (editing.block ? 'b' : '') + (editing.blank ?? '')} top={at * ROW + under * ROW + 2} editing={editing} onCommit={onCommitEdit} onCancel={onCancelEdit} error={labelError} setError={setLabelError} />;
    }
  }
  let chip = null;
  if (moving) {
    const { m, moves } = moving, dir = m && m === moves.prev ? 'prev' : 'next';
    const text = m ? `${dir === 'prev' ? '↑' : '↓'} Move ${bytesText(m)} into ${intoText(m, dir)}`
      : `Drop it in ${[moves.prev && intoText(moves.prev, 'prev'), moves.next && intoText(moves.next, 'next')].filter(Boolean).join(' or ')} · Esc cancels`;
    chip = <div className={cx('move-chip', m && 'ok')} role="status" style={{ top: moving.over * ROW + ROW + 2 }}>{text}</div>;
  }
  // the frame fades as it would have since the change, also when the listing comes back from another tab
  const changedFrame = frame && changed && <div key={changed.at} className="changed" aria-hidden="true"
    style={{ top: frame.top, height: frame.height, '--since': `${Math.min(0, changed.at - Date.now())}ms` } as React.CSSProperties}><span className="changed-tag">{changed.label}</span></div>;
  // the matches in the rows in view, marked in their text with CSS highlights (the rows render as they are)
  useLayoutEffect(() => {
    const reg = CSS.highlights, el = box.current;
    if (!reg) return;
    if (!find || !el) { reg.delete(HL); reg.delete(HL_CUR); return; }
    const all: Range[] = [], cur: Range[] = [];
    for (const row of el.querySelectorAll<HTMLElement>('.row.hit')) {
      const parts = row.classList.contains('filebar') ? [row] : row.querySelectorAll('.src > :not(.zp-tag), .hdr-chip, .hdr-text');
      for (const part of parts) markIn(part, find.re, row.classList.contains('hit-cur') ? cur : all);
    }
    reg.set(HL, new Highlight(...all)); reg.set(HL_CUR, new Highlight(...cur));
  });
  useEffect(() => () => { CSS.highlights?.delete(HL); CSS.highlights?.delete(HL_CUR); }, []);
  // where the listing is on screen after this render (the line kept in view is placed against it); runs last
  useLayoutEffect(() => { if (box.current) boxTop.current = box.current.getBoundingClientRect().top; });
  return (
    <div className={cx('listing', moving && 'moving')} ref={el => { box.current = el; listRef.current = el; }} tabIndex={0} onScroll={e => { setTop(e.currentTarget.scrollTop); if (peekRow) peekNow(); report(); }} aria-label="Disassembly listing"
      onMouseMove={peekMove} onMouseLeave={e => { if (e.relatedTarget instanceof Element && e.relatedTarget.closest('.peek')) return; pointer.current = null; clearTimeout(peekKeys.current.timer); setPeekRow(null); }}>
      <div style={{ height: lines.length * ROW + 40, position: 'relative' }}>{rows}{changedFrame}{pop}{chip}</div>
      {peek && peekRow && <PeekBox peek={peek} A={A} names={names} lower={lower} x={peekRow.x} top={peekRow.top} rowH={(peekRow.line.k === 'gfx' ? peekRow.line.rows : 1) * ROW} sel={sel?.bytes ? sel : null} onPick={(a, extend) => onPeekPick?.(a, extend)} />}
    </div>
  );
}

/** The peek right under the row it is on, the pointer inside it from side to side, so the pointer goes straight into
 *  it (above the row where the window ends). Its head names the block of the top row, a divider each block that starts
 *  further down. A click on a byte, a character, an instruction (its first byte) or a divider (the block's first byte)
 *  picks that address in the listing, which goes there (`onPick`); the bytes picked byte by byte (`sel`) are framed. */
function PeekBox({ peek, A, names, lower, x, top, rowH = ROW, sel, onPick }: { peek: Peek; A: AnalysisResult; names: PeekNames; lower: boolean; x: number; top: number; rowH?: number; sel: { start: Addr; end: Addr } | null; onPick: (a: Addr, extend: boolean) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    const w = el.offsetWidth, h = el.offsetHeight;
    el.style.left = `${Math.max(8, Math.min(x - 12, window.innerWidth - w - 8))}px`;
    el.style.top = `${top + rowH + h <= window.innerHeight - 8 ? top + rowH : Math.max(8, top - h)}px`;
    el.style.visibility = 'visible';
  });
  const { head, tail } = peek;
  const marked = (a: Addr) => !!peek.mark && a >= peek.mark.start && a < peek.mark.end;
  const picked = (a: Addr) => !!sel && a >= sel.start && a < sel.end;
  const text = (a: Addr, n: number, screen: boolean) => Array.from({ length: n }, (_, k) => {
    const c = monitorChar(A.mem[a + k], screen, lower);
    return <span key={k} data-a={a + k} className={cx(!c && 'dot', c?.inv && 'inv', marked(a + k) && 'on', picked(a + k) && 'picked')}>{c ? c.ch : '.'}</span>;
  });
  /** a block's type, its name and where it is */
  const named = (b: Block) => {
    const name = names.labels.get(b.start)?.name;
    return <>
      <span className="hdr-chip" style={{ '--c': `var(--g-${groupOfKind(b.type)})` } as React.CSSProperties}>{kindInfo(b.type).label}</span>
      <span className="mono">{name ? `${name} · ` : ''}${h4(b.start)}–${h4(b.end - 1)}</span>
    </>;
  };
  const pick = (e: ReactMouseEvent) => {
    if (e.button !== 0) return;
    // no text selection, and the listing keeps the keyboard
    e.preventDefault(); e.stopPropagation();
    const at = (e.target as HTMLElement).closest<HTMLElement>('[data-a]');
    if (at) onPick(Number(at.dataset.a), e.shiftKey);
  };
  return createPortal(
    <div ref={ref} className={cx('peek', peek.as)} role="dialog" aria-label={`${kindInfo(head.type).label} block ${peek.as === 'bytes' ? 'as bytes and text' : 'as code'}: the mouse wheel scrolls it through the file, a click goes there in the listing`} onMouseDown={pick}>
      <div className="peek-head">
        {named(head)}
        <span className="peek-as">{peek.as === 'bytes' ? 'as bytes and text' : 'as code'}</span>
      </div>
      {peek.before > 0 && <div className="peek-more before">… {peek.before} byte{peek.before === 1 ? '' : 's'} before, from ${h4(head.start)}</div>}
      <div className="peek-row cols"><span className="p-adr" /><span className="p-hex"><b>bytes</b></span><span className="p-txt"><b>PETSCII</b></span><span className="p-txt"><b>screen</b></span>{peek.as === 'code' && <span className="p-src"><b>code</b></span>}</div>
      {peek.items.map((it, i) => it.k === 'blk' ? (
        <div key={i} className="peek-blk" data-a={it.b.start}>{named(it.b)}</div>
      ) : it.k === 'row' ? (
        <div key={i} className="peek-row">
          <span className="p-adr">{h4(it.a)}</span>
          <span className="p-hex">{Array.from({ length: it.n }, (_, k) => <span key={k} data-a={it.a + k} className={cx(marked(it.a + k) && 'on', picked(it.a + k) && 'picked')}>{k ? ' ' : ''}{h2(A.mem[it.a + k])}</span>)}</span>
          <span className="p-txt">{text(it.a, it.n, false)}</span>
          <span className="p-txt">{text(it.a, it.n, true)}</span>
        </div>
      ) : (
        <div key={i} data-a={it.a} className={cx('peek-row', peek.mark && it.a < peek.mark.end && it.a + it.n > peek.mark.start && 'on', picked(it.a) && 'picked')}>
          <span className="p-adr">{h4(it.a)}</span>
          <span className="p-hex">{[...A.mem.subarray(it.a, it.a + it.n)].map(h2).join(' ')}</span>
          <span className="p-txt">{text(it.a, it.n, false)}</span>
          <span className="p-txt">{text(it.a, it.n, true)}</span>
          <span className="p-src"><LineBody l={it} onToken={() => { }} mem={A.mem} /></span>
        </div>
      ))}
      {peek.rest > 0 && <div className="peek-more">… {peek.rest} more byte{peek.rest === 1 ? '' : 's'} to ${h4(tail.end - 1)}</div>}
    </div>, document.body);
}

/** A sprite block's header: how many sprites it has, and - and + to give it one less or one more (its size in 64-byte
 *  steps from its start; a sprite pointer often shows only the first of the sprites that follow one another). */
function SpriteCount({ b, onSprites }: { b: Block; onSprites: (b: Block, n: number) => void }) {
  const len = b.end - b.start, whole = Math.floor(len / 64), rest = len % 64;
  const less = rest ? whole : whole - 1;
  return (
    <span className="hdr-sprites" onMouseDown={e => e.stopPropagation()} onDoubleClick={e => e.stopPropagation()}>
      <button aria-label="One sprite less" title={less >= 1 ? `${less} sprite${less === 1 ? '' : 's'}: $${h4(b.start)}–$${h4(b.start + less * 64 - 1)}` : 'A sprite block has one sprite at least'} disabled={less < 1} onClick={() => onSprites(b, less)}>−</button>
      <span title="Sprites one after the other from the start of the block, 64 bytes each">{whole} sprite{whole === 1 ? '' : 's'}{rest ? ` + ${rest} byte${rest === 1 ? '' : 's'}` : ''}</span>
      <button aria-label="One sprite more" title={`${whole + 1} sprites: $${h4(b.start)}–$${h4(b.start + (whole + 1) * 64 - 1)}`} onClick={() => onSprites(b, whole + 1)}>+</button>
    </span>
  );
}

function EditPopover({ top, editing, onCommit, onCancel, error, setError }: { top: number; editing: Editing; onCommit: (v: string) => void; onCancel: () => void; error: string | null; setError: (e: string | null) => void }) {
  const [v, setV] = useState(editing.value || '');
  const ref = useRef<HTMLInputElement>(null), area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { const el = area.current || ref.current; el?.focus(); el?.select(); }, []);
  const at = editing.zp ? `$${h2(editing.addr)}` : `$${h4(editing.addr)}`;
  const title = editing.kind === 'label' ? (editing.zp ? `Zero-page variable at ${at}` : `Label at ${at}`) : editing.kind === 'comment' ? `Comment at ${at}` : `Comment ${editing.block ? 'block' : 'line'} above ${at}`;
  const help = editing.kind === 'label' && editing.zp ? `Every access to ${at} (and to ${at}+1 for a pointer) uses this name · Enter renames · empty restores the automatic name · Esc cancels`
    : editing.kind === 'label' ? 'Enter to rename everywhere · empty restores the automatic name · Esc cancels'
    : editing.kind === 'note' && editing.block ? 'Written as /* … */ · Ctrl+Enter saves · empty removes the block · Esc cancels'
      : editing.kind === 'note' ? 'Written as its own // line · Enter saves · empty removes it · Esc cancels'
        : 'Enter to save · empty removes the comment';
  return (
    <div className={cx('edit-pop', editing.zp && 'zp')} style={{ top }} onMouseDown={e => e.stopPropagation()}>
      <label htmlFor="edit-pop-input">{title}{editing.zp && <span className="zp-tag">zero page</span>}</label>
      {editing.kind === 'note' && editing.block ? <>
        <textarea id="edit-pop-input" ref={area} value={v} rows={Math.min(12, Math.max(3, v.split('\n').length + 1))} spellCheck={false}
          onChange={e => setV(e.target.value)}
          onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); onCommit(v); } if (e.key === 'Escape') onCancel(); }} />
        <div className="edit-actions"><button className="btn small" onClick={onCancel}>Cancel</button><button className="btn primary small" onClick={() => onCommit(v)}>Save</button></div>
      </> : (
        <input id="edit-pop-input" ref={ref} value={v} spellCheck={false} className={cx(editing.kind === 'label' && 'mono')}
          onChange={e => { setV(e.target.value); setError(null); }}
          onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') onCommit(v); if (e.key === 'Escape') onCancel(); }} />
      )}
      <div className="edit-help">{error ? <span className="err-text">{error}</span> : help}</div>
    </div>
  );
}
