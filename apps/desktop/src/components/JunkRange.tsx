/* Mark range as junk (spec 11.7): a start and an end (included), filled in from the selection or the block, and what
 * marking them does: the blocks it takes whole, those it cuts, the junk it joins. One click (or Enter) marks it, and
 * Ctrl+Z or the Explorer's Junk list puts it back. */
import { useMemo, useState, type KeyboardEvent } from 'react';
import { h4, junkPlan, kindInfo, type Addr, type AnalysisResult, type Block, type JunkArea, type RenderResult } from '@mimir/core';
import { parseGoto } from '../lib/goto';
import { Modal } from './Modal';

interface JunkRangeProps {
  A: AnalysisResult; R: RenderResult;
  /** the project's junk areas, which the new one joins where it overlaps or touches them */
  junk: readonly JunkArea[] | undefined;
  /** the range the fields start with (end excluded): the selection, the block, or from the cursor to its block's end */
  init: { start: Addr; end: Addr } | null;
  onJunk: (r: { start: Addr; end: Addr }) => void;
  onClose: () => void;
}

const SHOWN = 8;
const span = (s: Addr, e: Addr) => (e - s > 1 ? `$${h4(s)}–$${h4(e - 1)}` : `$${h4(s)}`);

export function JunkRangeModal({ A, R, junk, init, onJunk, onClose }: JunkRangeProps) {
  const [startV, setStartV] = useState(init ? `$${h4(init.start)}` : '');
  const [endV, setEndV] = useState(init ? `$${h4(init.end - 1)}` : '');

  const labelAt = (name: string) => { for (const [a, l] of R.labels) if (l.name === name) return a; return undefined; };
  const one = (v: string): Addr | null => { const t = parseGoto(v, labelAt); return 'addr' in t ? t.addr : null; };
  const plan = useMemo(() => {
    if (!startV.trim()) return { error: 'Enter the start address.' };
    const s = one(startV);
    if (s == null) return { error: 'Start: enter one hex address like $0a00, or a label.' };
    if (!endV.trim()) return { error: 'Enter the end address (it is included in the range).' };
    const e = one(endV);
    if (e == null) return { error: 'End: enter one hex address like $0aff, or a label.' };
    if (e < s) return { error: `The end $${h4(e)} comes before the start $${h4(s)}.` };
    const p = junkPlan(A, junk, s, e + 1);
    return 'error' in p ? { error: `${p.error[0].toUpperCase()}${p.error.slice(1)}.` } : { ...p, asked: { start: s, end: e + 1 } };
  }, [startV, endV, A, R, junk]); // eslint-disable-line react-hooks/exhaustive-deps

  const P = 'error' in plan ? null : plan;
  const name = (b: Block) => R.labels.get(b.start)?.name;
  const row = (b: Block) => <li key={b.id}><span className="mono">{span(b.start, b.end)}</span> {kindInfo(b.type).label}{name(b) && <span className="mono muted"> {name(b)}</span>}</li>;
  const go = () => { if (P) onJunk({ start: P.start, end: P.end }); };
  const enter = (e: KeyboardEvent) => { if (e.key === 'Enter') go(); };
  const n = P ? P.whole.length : 0;
  const trimmed = !!P && (P.start !== P.asked.start || P.end !== P.asked.end);
  return (
    <Modal title="Mark range as junk" onClose={onClose}>
      <div className="modal-body merge-range junk-range">
        <div className="grid2">
          <label className="field"><span>Start</span><input id="junk-start" className="mono" value={startV} spellCheck={false} onChange={e => setStartV(e.target.value)} onKeyDown={enter}
            placeholder="$0a00 or a label" autoFocus={!init} /></label>
          <label className="field"><span>End (included)</span><input id="junk-end" className="mono" value={endV} spellCheck={false} onChange={e => setEndV(e.target.value)} onKeyDown={enter}
            onFocus={e => e.target.select()} placeholder="$0aff or a label" autoFocus={!!init} /></label>
        </div>
        {P ? <div className="merge-sum">
          <p className="small"><b>{span(P.start, P.end)}</b> becomes junk: <b>{P.bytes} byte{P.bytes === 1 ? '' : 's'}</b> left out of the listing, the source and the output.</p>
          {trimmed && <p className="muted small">Only the bytes that are loaded (or junk already) are taken: {span(P.asked.start, P.asked.end)} is trimmed to {span(P.start, P.end)}.</p>}
          {n > 0 && <><p className="small">{n} block{n === 1 ? ' goes' : 's go'} with it:</p>
            <ul className="merge-list">{P.whole.slice(0, SHOWN).map(row)}{n > SHOWN && <li className="muted">and {n - SHOWN} more</li>}</ul></>}
          {P.cut.length > 0 && <ul className="merge-list cut">{P.cut.map(b => {
            const kept = [b.start < P.start && span(b.start, P.start), b.end > P.end && span(P.end, b.end)].filter(Boolean).join(' and ');
            return <li key={`cut-${b.id}`}>{kindInfo(b.type).label}{name(b) ? ` ${name(b)}` : ''} <span className="mono">{span(b.start, b.end)}</span> is cut: <span className="mono">{kept}</span> stays</li>;
          })}</ul>}
          {P.joins.length > 0 && <p className="muted small">It joins the junk at {P.joins.map(j => span(j.start, j.end)).join(', ')}: one area in the Junk list.</p>}
          <p className="muted small">The Junk list in the Explorer puts it back; Ctrl+Z undoes it.</p>
        </div> : <div className="err-text small">{'error' in plan && plan.error}</div>}
      </div>
      <div className="modal-foot"><span className="grow" /><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!P} onClick={go}>Mark as junk</button></div>
    </Modal>
  );
}
