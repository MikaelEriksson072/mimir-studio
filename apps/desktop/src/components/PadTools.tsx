/* A user script's scratchpads (spec 10.3): the editor of what one holds when a run starts (Kick Assembler, hex or
 * text), and two compared byte by byte, with a heat map of where they differ and the rows that do. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { h2, h4, padData, padDiff, padText, type ScriptPad, type ScriptPadSource } from '@mimir/core';
import { Icon } from '../lib/icons';
import { cx } from '../lib/util';
import { heatLayout } from '../lib/heatmap';

const FORMS: { form: ScriptPadSource['form']; label: string; hint: string }[] = [
  { form: 'asm', label: 'Kick Assembler', hint: 'Code and data at the scratchpad\'s address, with the program\'s names: .byte, .word, .text, .fill, instructions, labels of its own' },
  { form: 'hex', label: 'Hex', hint: 'Bytes in hex: 01 02 ff, $01,$02 or 0102ff; a line that starts with an address (a hex dump\'s) puts its bytes there, its text column is left out' },
  { form: 'text', label: 'Text', hint: 'A byte a character, PETSCII (a line end is RETURN, $0d) or screen codes (a line end fills the row of 40 with spaces)' },
];

const PLACEHOLDER: Record<ScriptPadSource['form'], string> = {
  asm: '// what the scratchpad holds when a run starts, from its first byte:\n        .byte $01, $02, $03\n        .word my_table          // a label of the program: its address\n        .text "HELLO"\n        .fill 16, $ff\n        lda #0                  // code too',
  hex: '01 02 03 ff\n$c800  a9 00 8d 20 d0',
  text: 'HELLO WORLD',
};

/**
 * What a scratchpad holds when a run starts, written in one of the forms: what is typed is read as it is typed (how
 * many bytes, or the error and its line), and Set keeps it (Ctrl+Enter); a form picked turns what is written into it.
 * Clear leaves only the fill.
 */
export function PadEditor({ pad, names, onSet, onCancel }: {
  pad: ScriptPad; names: ReadonlyMap<string, number>;
  /** the start content (null: none, only the fill) and how it was written */
  onSet: (data: Uint8Array | null, src: ScriptPadSource | null) => void; onCancel: () => void;
}) {
  const first = useMemo((): ScriptPadSource => pad.src ?? (pad.data?.length ? { form: 'hex', text: padText(pad.data, 'hex', pad.start) } : { form: 'asm', text: '' }), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [src, setSrc] = useState<ScriptPadSource>(first);
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { area.current?.focus(); }, []);
  const read = useMemo(() => padData(src, pad.start, pad.size, names, pad.fill ?? 0), [src, pad.start, pad.size, pad.fill, names]);
  const ok = 'bytes' in read;
  /** another form: what is written turned into it, when it reads (else the text stays, to be put right) */
  const toForm = (form: ScriptPadSource['form'], screen = !!src.screen) => {
    const text = ok ? padText(read.bytes, form, pad.start, screen) : src.text;
    setSrc({ form, text, ...(screen ? { screen: true } : {}) });
  };
  const set = () => { if (!ok) return; onSet(read.bytes.length ? read.bytes : null, read.bytes.length ? src : null); };
  return (
    <div className="pad-edit" role="group" aria-label={`What ${pad.name} starts with`}>
      <div className="pad-edit-head">
        <div className="seg" role="group" aria-label="Written as">
          {FORMS.map(f => <button key={f.form} className={cx(src.form === f.form && 'on')} aria-pressed={src.form === f.form} title={f.hint} onClick={() => toForm(f.form)}>{f.label}</button>)}
        </div>
        {src.form === 'text' && <div className="seg" role="group" aria-label="Characters as">
          <button className={cx(!src.screen && 'on')} aria-pressed={!src.screen} onClick={() => toForm('text', false)}>PETSCII</button>
          <button className={cx(src.screen && 'on')} aria-pressed={!!src.screen} onClick={() => toForm('text', true)}>Screen</button>
        </div>}
        <span className={cx('pad-edit-status small', ok ? 'muted' : 'bad')} role="status">
          {ok ? (read.bytes.length ? `${read.bytes.length} of ${pad.size} bytes from $${h4(pad.start)}${read.bytes.length < pad.size ? `, the rest $${h2(pad.fill ?? 0)}` : ''}` : `Nothing: it starts as its fill, $${h2(pad.fill ?? 0)}`)
            : `${read.line ? `Line ${read.line}: ` : ''}${read.error}`}
        </span>
      </div>
      <textarea ref={area} className="pad-edit-text mono" aria-label={`${pad.name} at the start`} spellCheck={false} value={src.text} placeholder={PLACEHOLDER[src.form]}
        onChange={e => setSrc({ ...src, text: e.target.value })}
        onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); set(); } else if (e.key === 'Escape') { e.preventDefault(); onCancel(); } }} />
      <div className="scr-view-actions">
        <button className="btn small primary" disabled={!ok} onClick={set} title="Keep it: every run starts the scratchpad with these bytes (Ctrl+Enter)">Set<kbd>Ctrl+Enter</kbd></button>
        <button className="btn small" onClick={onCancel} title="Leave it as it was (Esc)">Cancel</button>
        <span className="grow" />
        {!!pad.data?.length && <button className="btn small ghost" onClick={() => onSet(null, null)} title="No start content: a run starts the scratchpad with its fill only"><Icon name="trash" size={13} />Clear</button>}
      </div>
    </div>
  );
}

const popcount = (x: number) => { let n = 0; for (; x; x &= x - 1) n++; return n; };
/** the heat of a byte compared: 0 the same, 1-8 the bits that differ, 9 only one of them has it */
const heatOf = (a: Uint8Array, b: Uint8Array, i: number) => (i >= a.length || i >= b.length ? 9 : popcount(a[i] ^ b[i]));
/** how strong the colour of a heat is (1-8 bits) */
const alphaOf = (bits: number) => 0.28 + 0.72 * (bits - 1) / 7;
const ROW = 16;
/** rows of differences the list shows at once (the heat map shows them all) */
const ROWS_SHOWN = 300;

/**
 * Two scratchpads compared byte by byte from their starts: how many bytes differ, a heat map with a cell for each byte
 * (the colour stronger the more of its bits differ; a click goes to its row) and the rows of 16 bytes that differ, both
 * scratchpads' bytes under each other with the different ones marked.
 */
export function PadCompare({ a, b, aName, bName, at, theme }: { a: Uint8Array; b: Uint8Array; aName: string; bName: string; at: number; theme: string }) {
  const d = useMemo(() => padDiff(a, b), [a, b]);
  const n = Math.max(a.length, b.length), common = Math.min(a.length, b.length);
  const [focus, setFocus] = useState<number | null>(null);
  const rows = useMemo(() => {
    const out: number[] = [];
    for (let r = 0; r * ROW < n; r++) { for (let i = r * ROW; i < Math.min(n, (r + 1) * ROW); i++) if (heatOf(a, b, i)) { out.push(r); break; } }
    return out;
  }, [a, b, n]);
  const list = useRef<HTMLDivElement>(null);
  // the rows shown: from a little before the row clicked in the heat map
  const from = focus == null ? 0 : Math.max(0, rows.findIndex(r => r >= Math.floor(focus / ROW)) - 20);
  const shown = rows.slice(from, from + ROWS_SHOWN);
  useEffect(() => {
    if (focus == null) return;
    list.current?.querySelector(`[data-row="${Math.floor(focus / ROW)}"]`)?.scrollIntoView({ block: 'center' });
  }, [focus, from]);
  // the room the heat map has: beside the rows when the view is wide, above them when it is narrow
  const body = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState({ w: 600, h: 200 });
  useEffect(() => {
    const el = body.current; if (!el) return;
    const fit = () => setRoom({ w: el.clientWidth, h: el.clientHeight });
    fit();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(fit); ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const stacked = room.w < 620;
  const box = stacked ? { w: room.w - 24, h: Math.max(60, room.h * 0.5 - 30) } : { w: room.w * 0.55 - 24, h: Math.max(60, room.h - 34) };
  const only = d.onlyA + d.onlyB;
  const stats = !d.differ && !only ? `The same: all ${n} bytes.`
    : `${d.differ} of ${common} bytes differ (${(100 * d.differ / Math.max(1, common)).toFixed(d.differ * 1000 < common ? 2 : 1)} %)${d.runs.length ? ` in ${d.runs.length} place${d.runs.length === 1 ? '' : 's'}` : ''}${d.first != null ? `, the first at +$${h4(d.first)} ($${h4(at + d.first)})` : ''}${only ? `; ${only} byte${only === 1 ? '' : 's'} only ${d.onlyA ? aName : bName} has` : ''}.`;
  const line = (r: number, side: Uint8Array, other: Uint8Array) => {
    const cells: React.ReactNode[] = [];
    for (let i = r * ROW; i < Math.min(n, (r + 1) * ROW); i++) {
      const has = i < side.length, diff = heatOf(side, other, i);
      cells.push(i > r * ROW ? ' ' : '', <span key={i} className={cx(diff > 0 && has && 'pad-chg', i === focus && 'pad-focus')}>{has ? h2(side[i]) : '··'}</span>);
    }
    return cells;
  };
  return (
    <div className="pad-cmp">
      <p className="pad-cmp-stats small" role="status">{stats}</p>
      <div className={cx('pad-cmp-body', stacked && 'stacked')} ref={body}>
      <div className="pad-cmp-map">
        <PadHeat a={a} b={b} at={at} aName={aName} bName={bName} theme={theme} focus={focus} onPick={setFocus} box={box} />
        <div className="pad-cmp-legend small" aria-hidden="true">
          <span><i className="heat-same" />the same</span>
          <span><i style={{ opacity: alphaOf(1) }} />1 bit differs</span>
          <span><i style={{ opacity: alphaOf(4) }} />4</span>
          <span><i style={{ opacity: alphaOf(8) }} />8 bits</span>
          {only > 0 && <span><i className="heat-only" />only in one</span>}
        </div>
      </div>
      <div className="pad-diff mono" ref={list} role="table" aria-label="Rows that differ">
        {!rows.length && <div className="empty small">No byte differs.</div>}
        {from > 0 && <div className="pad-diff-more small">{from} row{from === 1 ? '' : 's'} that differ above: click higher up in the heat map</div>}
        {shown.map(r => (
          <div key={r} className={cx('pad-diff-row', focus != null && Math.floor(focus / ROW) === r && 'on')} role="row" data-row={r}>
            <div><span className="pad-diff-adr">+${h4(r * ROW)} ${h4(at + r * ROW)}</span><span className="pad-diff-name">{aName}</span>{line(r, a, b)}</div>
            <div><span className="pad-diff-adr" /><span className="pad-diff-name">{bName}</span>{line(r, b, a)}</div>
          </div>
        ))}
        {from + ROWS_SHOWN < rows.length && <div className="pad-diff-more small">{rows.length - from - ROWS_SHOWN} more row{rows.length - from - ROWS_SHOWN === 1 ? '' : 's'} that differ: click lower down in the heat map</div>}
      </div>
      </div>
    </div>
  );
}

/** The heat map: a cell a byte, 16 to 256 a row as fits the room best, drawn on a canvas in the theme's colours. */
function PadHeat({ a, b, at, aName, bName, theme, focus, onPick, box }: { a: Uint8Array; b: Uint8Array; at: number; aName: string; bName: string; theme: string; focus: number | null; onPick: (i: number) => void; box: { w: number; h: number } }) {
  const n = Math.max(a.length, b.length);
  const { cols, cell } = heatLayout(n, box);
  const rows = Math.ceil(n / cols);
  const wrap = useRef<HTMLDivElement>(null), cv = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = cv.current, ctx = c?.getContext('2d'); if (!c || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = cols * cell * dpr; c.height = rows * cell * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const css = getComputedStyle(c), v = (k: string, f: string) => css.getPropertyValue(k).trim() || f;
    const same = v('--line-2', '#444'), hot = v('--err', '#e5534b'), only = v('--hint', '#7fb2ff'), ring = v('--accent', '#8b7cff');
    const gap = cell >= 6 ? 1 : 0;
    ctx.clearRect(0, 0, cols * cell, rows * cell);
    for (let i = 0; i < n; i++) {
      const h = heatOf(a, b, i), x = (i % cols) * cell, y = Math.floor(i / cols) * cell;
      if (h === 0) { ctx.globalAlpha = 1; ctx.fillStyle = same; }
      else if (h === 9) { ctx.globalAlpha = 0.55; ctx.fillStyle = only; }
      else { ctx.globalAlpha = alphaOf(h); ctx.fillStyle = hot; }
      ctx.fillRect(x, y, cell - gap, cell - gap);
    }
    ctx.globalAlpha = 1;
    if (focus != null && focus < n) { ctx.strokeStyle = ring; ctx.lineWidth = 2; ctx.strokeRect((focus % cols) * cell - 1, Math.floor(focus / cols) * cell - 1, cell + 1, cell + 1); }
  }, [a, b, n, cols, rows, cell, theme, focus]);
  const [tip, setTip] = useState<{ i: number; x: number; y: number } | null>(null);
  const cellAt = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const i = Math.floor((e.clientY - r.top) / cell) * cols + Math.floor((e.clientX - r.left) / cell);
    return i >= 0 && i < n ? { i, x: e.clientX - r.left, y: e.clientY - r.top } : null;
  };
  const d = useMemo(() => padDiff(a, b), [a, b]);
  const val = (s: Uint8Array, i: number) => (i < s.length ? `$${h2(s[i])}` : 'none');
  return (
    <div className="pad-heat-wrap" ref={wrap} style={{ maxHeight: box.h + 8 }}>
      <canvas ref={cv} className="pad-heat" role="img" aria-label={`Heat map of ${n} bytes: ${d.differ + d.onlyA + d.onlyB} differ`} style={{ width: cols * cell, height: rows * cell }}
        onMouseMove={e => setTip(cellAt(e))} onMouseLeave={() => setTip(null)} onClick={e => { const c = cellAt(e); if (c) onPick(c.i); }} />
      {tip && <div className="pad-heat-tip mono" style={{ left: Math.min(tip.x + 14, cols * cell - 150), top: tip.y + 16 }}>
        +${h4(tip.i)} · ${h4(at + tip.i)}<br />{aName} {val(a, tip.i)} · {bName} {val(b, tip.i)}{tip.i < a.length && tip.i < b.length && a[tip.i] !== b[tip.i] ? <><br />{popcount(a[tip.i] ^ b[tip.i]) === 1 ? '1 bit differs' : `${popcount(a[tip.i] ^ b[tip.i])} bits differ`}</> : null}
      </div>}
    </div>
  );
}
