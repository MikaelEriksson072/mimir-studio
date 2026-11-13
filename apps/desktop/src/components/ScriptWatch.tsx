/* A user script's watch list (spec 10.3): the memory its code may change, found in the code by itself (what it writes
 * with STA, INC and the like, an indexed range, a pointer it writes through), and what the user adds; each read as a
 * run starts, as the last run left it, or (debugging) as the run has it now. */
import { useState } from 'react';
import { h2, h4, type Addr, type WatchSpot, type WatchView } from '@mimir/core';
import { Icon } from '../lib/icons';
import { cx } from '../lib/util';

export interface WatchItem { spot: WatchSpot; view: WatchView }
/** what the values are: as a run starts (it has not run), as the last run left them (against the start), or now while
 *  debugging (against the memory before the last step) */
export type WatchMode = 'start' | 'run' | 'now';

/** how a spot can be added: a byte, a word, a zero-page pointer, or a row of bytes */
export const WATCH_KINDS = [['byte', 'byte'], ['word', 'word'], ['pointer', 'pointer'], ['8', '8 bytes'], ['16', '16 bytes'], ['64', '64 bytes'], ['256', '256 bytes']] as const;
export type WatchKind = typeof WATCH_KINDS[number][0];

const $2 = (v: number) => '$' + h2(v), $4 = (v: number) => '$' + h4(v);
const SPACE: Record<WatchSpot['space'], string> = { program: 'the program\'s memory', zp: 'the zero page (the program\'s too)', own: 'the script\'s own memory (its code and data)', pad: 'a scratchpad' };

/** the address as the list writes it: `$d020`, `$0400,x`, `($fb),y`, `$0834…` */
function addrText(s: WatchSpot): string {
  const a = s.at < 0x100 ? $2(s.at) : $4(s.at);
  if (s.ptr) return s.index === 'y' ? `(${a}),y` : `(${a})`;
  if (s.size > 2) return s.index ? `${a},${s.index}` : `${a}…`;
  return a;
}

/** what a spot is, for its tooltip */
function spotTip(s: WatchSpot): string {
  if (s.error) return s.error;
  const lines = s.lines.length ? `${s.readsThrough ? 'Read through and moved' : 'Written'} on line ${s.lines[0]}${s.how ? `: ${s.how}` : ''}${s.lines.length > 1 ? ` (also line${s.lines.length > 2 ? 's' : ''} ${s.lines.slice(1, 6).join(', ')}${s.lines.length > 6 ? ', …' : ''})` : ''}. A click goes to it` : 'Added by you';
  const end = s.wrap ? (s.at + s.size - 1) & 0xff : s.at + s.size - 1;
  const what = s.ptr ? `A pointer at ${$2(s.at)}-${$2((s.at + 1) & 0xff)}: the word and the bytes it points at${s.index === 'y' ? ' (debugging, they follow Y)' : ''}`
    : s.size > 2 ? `${s.index ? `An indexed write: it can reach ${$4(s.at)}-${$4(end)}${s.wrap ? ' (it wraps in the zero page)' : ''}; debugging, the bytes shown follow ${s.index.toUpperCase()}` : `${s.size} bytes, ${$4(s.at)}-${$4(end)}`}`
      : s.word ? `A word at ${$4(s.at)}-${$4(s.at + 1)}, low byte first` : `A byte at ${$4(s.at)}`;
  return `${s.name}\n${lines}\n${what}, in ${s.pad ? `the scratchpad ${s.pad}` : SPACE[s.space]}`;
}

/** a byte or a word: the value, and what it was (as the run started; the last step's before it) when that differs */
function Value({ v, was, word, mode }: { v: number; was?: number; word?: boolean; mode: WatchMode }) {
  const f = word ? $4 : $2, t = `${v}${word ? '' : ` · %${v.toString(2).padStart(8, '0')}`}`;
  if (was == null || was === v || mode === 'start') return <span title={t}>{f(v)}</span>;
  if (mode === 'now') return <span className="wl-chg" title={`${t}\nBefore the last step: ${f(was)}`}>{f(v)}</span>;
  return <span title={`${t}\nWhen the run started: ${f(was)}`}><span className="wl-was">{f(was)}</span><span className="wl-arrow">→</span><span className="wl-chg">{f(v)}</span></span>;
}

/** where a spot comes from, in the wide table: the line that writes it (a click goes there), or the user */
function Source({ s, onGoLine }: { s: WatchSpot; onGoLine?: (line: number) => void }) {
  if (s.user || !s.lines.length) return <span className="wl-src wl-user">added</span>;
  const more = s.lines.length > 1 ? ` +${s.lines.length - 1}` : '';
  return <button className="wl-src" onClick={() => onGoLine?.(s.lines[0])} title={`${s.readsThrough ? 'Read through and moved' : 'Written'} on line ${s.lines.join(', ')}: a click goes to line ${s.lines[0]}`}>
    line {s.lines[0]}{more}{s.readsThrough ? <span className="wl-was"> (reads)</span> : null}</button>;
}

/** The watch list's rows: the name (a click goes to the line that writes it), the address (a click shows the program's
 *  memory in the listing), the value, and a row of bytes for a range or where a pointer points. The wide table (the
 *  output's Watch tab) has a heading and the bytes and the line that writes each in columns of their own; the compact
 *  one (the debugger's panel) has the bytes under their row. */
export function WatchTable({ items, mode, compact, onRemove, onGoLine, onShow }: {
  items: readonly WatchItem[]; mode: WatchMode; compact?: boolean;
  onRemove?: (s: WatchSpot) => void; onGoLine?: (line: number) => void; onShow?: (start: Addr, end: Addr) => void;
}) {
  return (
    <div className={cx('wl', compact ? 'compact' : 'wide')} role="list" aria-label="Watch">
      {!compact && <div className="wl-row wl-head" aria-hidden="true"><span>Name</span><span>Address</span><span>Value</span><span>Bytes</span><span>Written on</span><span /></div>}
      {items.map(({ spot: s, view: v }) => {
        const row = v.row;
        const marks = mode !== 'start' && row?.was;
        return (
          <div key={s.key} role="listitem" className={cx('wl-row', s.error && 'bad', s.user && 'user')}>
            <button className="wl-name" title={spotTip(s)} onClick={() => { if (s.lines[0] && onGoLine) onGoLine(s.lines[0]); }}>{s.name}</button>
            {s.space === 'program' && !s.error && onShow
              ? <button className="wl-addr" title={`Show ${$4(s.at)} in the listing`} onClick={() => onShow(s.at, s.at + Math.max(1, s.size))}>{addrText(s)}</button>
              : <span className="wl-addr" title={s.pad ? `In the scratchpad ${s.pad}` : SPACE[s.space]}>{s.error ? '' : addrText(s)}</span>}
            <span className="wl-val">
              {s.error ? <span className="wl-bad">no address</span>
                : v.value != null ? <Value v={v.value} was={v.was} word={s.word} mode={mode} />
                : v.changed != null && mode !== 'start' ? <span className={cx(v.changed > 0 && 'wl-chg')} title={`Of the ${v.of} bytes, ${v.changed} differ from what the run started with`}>{v.changed} changed</span>
                : <span className="wl-was">{s.size} bytes</span>}
            </span>
            {!compact && <Source s={s} onGoLine={onGoLine} />}
            {onRemove && <button className="icon-btn" aria-label={`Take ${s.name} off the watch list`} title={s.user ? 'Take it off the list' : 'Take it off the list (the code still writes it; the count under the list brings it back)'} onClick={() => onRemove(s)}><Icon name="x" size={11} /></button>}
            {row && <div className="wl-bytes" aria-label={`${s.name} bytes`}>
              <span className="wl-was">{$4(row.at)}</span>
              {row.bytes.map((b, i) => <span key={i} className={cx(marks && row.was![i] !== b && 'wl-chg')} title={marks && row.was![i] !== b ? `${$4((row.at + i) & 0xffff)}: ${$2(b)}, ${mode === 'now' ? 'before the last step' : 'when the run started'} ${$2(row.was![i])}` : `${$4((row.at + i) & 0xffff)}: ${$2(b)}`}>{h2(b)}</span>)}
              {s.ptr && !!v.changed && mode !== 'start' && <span className="wl-n wl-chg" title={`Of the ${v.of} bytes from where it points, ${v.changed} differ from what the run started with`}>· {v.changed} changed</span>}
            </div>}
          </div>
        );
      })}
    </div>
  );
}

/**
 * The Watch section of a script's output: what the values are (*at the start*, *after the last run*, *now*), the
 * rows, how many found in the code were taken off (a click brings them back), and a field to add an address or a name
 * of the program or the script as a byte, a word, a pointer or a row of bytes.
 */
export function WatchSection({ items, mode, stale, hidden, onRemove, onRestore, onAdd, onGoLine, onShow }: {
  items: readonly WatchItem[]; mode: WatchMode; stale: boolean; hidden: number;
  onRemove: (s: WatchSpot) => void; onRestore: () => void;
  /** add what was typed: whether it was (the field empties) */
  onAdd: (expr: string, kind: WatchKind) => boolean;
  onGoLine: (line: number) => void; onShow: (start: Addr, end: Addr) => void;
}) {
  const [expr, setExpr] = useState(''), [kind, setKind] = useState<WatchKind>('byte');
  const add = () => { if (expr.trim() && onAdd(expr.trim(), kind)) setExpr(''); };
  return (
    <section className="scr-pane scr-watch" aria-label="Watch">
      <div className="scr-pane-bar">
        <span className="wl-mode-lbl" title="The values are as a run starts until it has run, then as the last run left them (what changed marked, with what it was), and while debugging as the run has it now (what the last step changed marked)">Values</span>
        <span className={cx('wl-mode', `wl-mode-${mode}`)}>{mode === 'start' ? 'at the start' : mode === 'run' ? 'after the last run' : 'now'}</span>
        {stale && mode === 'run' && <span className="pill mid" title="The code has changed since this run: run it again to see what it does now">code changed since</span>}
        {hidden > 0 && <button className="linkish wl-hidden" onClick={onRestore} title="Put back on the list what was found in the code and taken off">{hidden} taken off · put back</button>}
        <span className="grow" />
        <div className="wl-add" role="group" aria-label="Add to the watch list">
          <input aria-label="Watch address" className="mono" placeholder="$c000, a label, ptr+1…" value={expr} onChange={e => setExpr(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') add(); if (e.key === 'Escape') setExpr(''); }}
            title="An address ($c000, 49152) or a name of the program or the script (a label, a zero-page variable, a scratchpad, name+2): Enter adds it" />
          <select aria-label="Watch size" value={kind} onChange={e => setKind(e.target.value as WatchKind)} title="A byte, a word (low byte first), a zero-page pointer (the word and the bytes it points at), or a row of bytes">
            {WATCH_KINDS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
          </select>
          <button className="btn small" onClick={add} disabled={!expr.trim()} title="Put it on the watch list"><Icon name="plus" size={13} />Watch</button>
        </div>
      </div>
      <div className="scr-pane-body">
        {items.length ? <WatchTable items={items} mode={mode} onRemove={onRemove} onGoLine={onGoLine} onShow={onShow} />
          : <p className="scr-empty">Nothing the code writes yet: an address it stores to (<code>sta $d020</code>, <code>inc counter</code>, <code>sta (ptr),y</code>) comes here by itself, and an address or a name typed above is added.</p>}
      </div>
    </section>
  );
}
