/* Block size: where a block starts and ends (the end included), or how many bytes it has. Growing, it takes in the
 * blocks it now covers and cuts the one its new edge lands in, whose rest keeps its type; shrinking, the bytes it
 * gives up join the block next to them or stay a block of their own. The summary says what happens before anything
 * changes, and the change is undone with Ctrl+Z. */
import { useMemo, useState, type KeyboardEvent } from 'react';
import { findBlock, h4, kindInfo, resizeBlock, type Addr, type AnalysisResult, type Block, type BlockResize, type RenderResult } from '@mimir/core';
import { parseGoto } from '../lib/goto';
import { Modal } from './Modal';

interface BlockSizeProps {
  A: AnalysisResult; R: RenderResult;
  /** an address in the block */
  at: Addr;
  onResize: (r: BlockResize) => void;
  onClose: () => void;
}

/** a number of bytes: decimal, or hex after `$`; null when it is not one above 0 */
export function parseSize(v: string): number | null {
  const t = v.trim(), m = /^\$([0-9a-f]+)$/i.exec(t);
  const n = m ? parseInt(m[1], 16) : /^\d+$/.test(t) ? parseInt(t, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

const span = (s: Addr, e: Addr) => (e - s > 1 ? `$${h4(s)}–$${h4(e - 1)}` : `$${h4(s)}`);
const bytes = (n: number) => `${n} byte${n === 1 ? '' : 's'}`;

export function BlockSizeModal({ A, R, at, onResize, onClose }: BlockSizeProps) {
  const blk = findBlock(A.blocks, at);
  const [startV, setStartV] = useState(blk ? `$${h4(blk.start)}` : '');
  const [endV, setEndV] = useState(blk ? `$${h4(blk.end - 1)}` : '');
  // the size as typed (null: shown from the start and the end)
  const [sizeV, setSizeV] = useState<string | null>(null);
  const [freed, setFreed] = useState<'join' | 'own'>('join');

  const labelAt = (name: string) => { for (const [a, l] of R.labels) if (l.name === name) return a; return undefined; };
  const one = (v: string): Addr | null => { const t = parseGoto(v, labelAt); return 'addr' in t ? t.addr : null; };
  const s = one(startV), e = one(endV);
  const plan = useMemo((): BlockResize | { error: string } => {
    if (!blk) return { error: 'There is no block at the cursor.' };
    if (s == null) return { error: 'Start: enter one hex address like $0a00, or a label.' };
    if (sizeV != null && parseSize(sizeV) == null) return { error: 'Size: enter a number of bytes, like 16 or $10.' };
    if (e == null) return { error: 'End: enter one hex address like $0aff, or a label.' };
    if (e < s) return { error: `The end $${h4(e)} comes before the start $${h4(s)}.` };
    const r = resizeBlock(A, blk.start, s, e + 1, freed);
    return 'error' in r ? { error: `${r.error[0].toUpperCase()}${r.error.slice(1)}.` } : r;
  }, [A, blk, s, e, sizeV, freed]);

  if (!blk) return null;
  const what = kindInfo(blk.type).label, name = (b: Block) => R.labels.get(b.start)?.name;
  const side = (b: Block) => (b.start < blk.start ? 'before it' : 'after it');
  const ok = !('error' in plan);
  // it gives up bytes at one end: where they go is a choice
  const shrinks = s != null && e != null && (s > blk.start || e + 1 < blk.end);
  const apply = () => { if (ok) onResize(plan); };
  const enter = (ev: KeyboardEvent) => { if (ev.key === 'Enter') apply(); };
  const size = s != null && e != null && e >= s ? e - s + 1 : null;
  return (
    <Modal title="Block size" onClose={onClose}>
      <div className="modal-body merge-range block-size">
        <p className="small">The {what} block{name(blk) ? <> <span className="mono">{name(blk)}</span></> : ''} is <span className="mono">{span(blk.start, blk.end)}</span> ({bytes(blk.end - blk.start)}).</p>
        <div className="grid3">
          <label className="field"><span>Start</span><input id="size-start" className="mono" value={startV} spellCheck={false} onKeyDown={enter}
            onChange={ev => { setStartV(ev.target.value); setSizeV(null); }} /></label>
          <label className="field"><span>End (included)</span><input id="size-end" className="mono" value={endV} spellCheck={false} onKeyDown={enter} autoFocus
            onChange={ev => { setEndV(ev.target.value); setSizeV(null); }} /></label>
          <label className="field"><span>Size (bytes)</span><input id="size-bytes" className="mono" value={sizeV ?? (size != null ? String(size) : '')} spellCheck={false} onKeyDown={enter}
            onChange={ev => { const v = ev.target.value, n = parseSize(v); setSizeV(v); if (n != null && s != null) setEndV(`$${h4(s + n - 1)}`); }} /></label>
        </div>
        {shrinks && <fieldset className="size-freed"><legend className="small">The bytes it gives up</legend>
          <label className="check"><input type="radio" name="size-freed" checked={freed === 'join'} onChange={() => setFreed('join')} /><span>join the block next to them</span></label>
          <label className="check"><input type="radio" name="size-freed" checked={freed === 'own'} onChange={() => setFreed('own')} /><span>stay a {what} block of their own</span></label>
        </fieldset>}
        {ok ? <div className="merge-sum">
          <p className="small"><b>{what} {span(plan.start, plan.end)}</b> ({bytes(plan.end - plan.start)}).</p>
          <ul className="merge-list">
            {plan.replaced.length > 0 && <li>It takes in {plan.replaced.length === 1 ? 'the' : plan.replaced.length} block{plan.replaced.length === 1 ? '' : 's'} {plan.replaced.map(b => `${kindInfo(b.type).label}${name(b) ? ` ${name(b)}` : ''} ${span(b.start, b.end)}`).join(', ')}.</li>}
            {plan.took.map(t => <li key={`t${t.from.id}`}>It takes <span className="mono">{span(t.start, t.end)}</span> from the {kindInfo(t.from.type).label} block {side(t.from)}; the rest of that block keeps its type.</li>)}
            {plan.gave.map(g => <li key={`g${g.start}`}><span className="mono">{span(g.start, g.end)}</span> {g.to ? `join${g.end - g.start === 1 ? 's' : ''} the ${kindInfo(g.to.type).label} block ${side(g.to)}` : `stay${g.end - g.start === 1 ? 's' : ''} a ${what} block of ${g.end - g.start === 1 ? 'its' : 'their'} own`}.</li>)}
          </ul>
          <p className="muted small">You can undo it with Ctrl+Z.</p>
        </div> : <div className="err-text small">{plan.error}</div>}
      </div>
      <div className="modal-foot"><span className="grow" /><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!ok} onClick={apply}>Apply</button></div>
    </Modal>
  );
}
