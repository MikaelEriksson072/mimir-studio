/* The find widget over the listing (Ctrl+F): the text to find, as written or in any case and as a whole word, and how
 * many lines have it. Enter (F3) goes to the next line with it, Shift+Enter (Shift+F3) to the one before, Esc closes. */
import { useEffect, useRef } from 'react';
import { Icon } from '../lib/icons';
import type { FindOptions } from '../lib/find';
import { cx } from '../lib/util';

interface FindBarProps {
  q: string; opts: FindOptions;
  onQuery: (q: string) => void; onOpts: (o: FindOptions) => void;
  /** lines with a match, and which of them is shown (1-based; null: none yet) */
  count: number; at: number | null;
  onStep: (dir: 1 | -1) => void; onClose: () => void;
  /** a new value focuses the field and selects its text (Ctrl+F while it is open) */
  focusKey: number;
}

export function FindBar({ q, opts, onQuery, onOpts, count, at, onStep, onClose, focusKey }: FindBarProps) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); input.current?.select(); }, [focusKey]);
  const toggle = (k: keyof FindOptions) => onOpts({ ...opts, [k]: !opts[k] });
  const status = !q ? '' : !count ? 'No results' : `${at ?? '?'} of ${count}`;
  return (
    <div className="find-bar" role="search" aria-label="Find in the listing" onMouseDown={e => e.stopPropagation()}>
      <input ref={input} aria-label="Find in the listing" className={cx('find-q mono', q && !count && 'bad')} value={q} spellCheck={false} placeholder="Find"
        title="Enter: the next line with it, Shift+Enter: the one before (F3 / Shift+F3 in the listing) · Esc closes"
        onChange={e => onQuery(e.target.value)}
        onKeyDown={e => {
          const k = e.key.toLowerCase();
          if (e.key === 'Enter') { e.preventDefault(); onStep(e.shiftKey ? -1 : 1); }
          else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); }
          else if ((e.ctrlKey || e.metaKey) && k === 'f') { e.preventDefault(); input.current?.select(); }
          else if (e.altKey && (k === 'c' || k === 'w')) { e.preventDefault(); toggle(k === 'c' ? 'matchCase' : 'word'); }
        }} />
      <button className={cx('find-opt', opts.matchCase && 'on')} aria-pressed={opts.matchCase} aria-label="Match case" title="Match case (Alt+C)" onClick={() => toggle('matchCase')}>Aa</button>
      <button className={cx('find-opt find-word', opts.word && 'on')} aria-pressed={opts.word} aria-label="Whole word" title="Whole word: not inside a longer name (Alt+W)" onClick={() => toggle('word')}>ab</button>
      <span className={cx('find-status small', q && !count ? 'err-text' : 'muted')} role="status" aria-label="Find result" title={count ? `${count} line${count === 1 ? '' : 's'} with a match` : undefined}>{status}</span>
      <button className="icon-btn small" aria-label="Previous match" title="Previous match (Shift+Enter, Shift+F3)" disabled={!count} onClick={() => onStep(-1)}><Icon name="up" size={14} /></button>
      <button className="icon-btn small" aria-label="Next match" title="Next match (Enter, F3)" disabled={!count} onClick={() => onStep(1)}><Icon name="down" size={14} /></button>
      <button className="icon-btn small" aria-label="Close find" title="Close (Esc)" onClick={onClose}><Icon name="x" size={14} /></button>
    </div>
  );
}
