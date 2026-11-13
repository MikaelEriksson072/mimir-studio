/* View offset (spec 10.4): bytes the listing shows at another address than where they are loaded, for manual analysis.
 * A start, an end (included) and the address to show them at (or how far, +$b700): the listing gives them the addresses
 * and labels they have there and sends references there to them, and the .asm, the output and the round trip stay as
 * they are. What the references say about the address is shown as it is typed. An offset already there can be shown
 * somewhere else instead, or removed. */
import { useMemo, useState, type KeyboardEvent } from 'react';
import { h4, shiftText, viewOffsetFit, viewOffsetProblem, type Addr, type AnalysisResult, type RenderResult, type ViewOffset } from '@mimir/core';
import { parseGoto } from '../lib/goto';
import { Modal } from './Modal';

export interface ViewOffsetDraft {
  start: Addr; end: Addr;
  /** the offset this edits */
  offset?: ViewOffset | null;
}

interface ViewOffsetProps {
  A: AnalysisResult; R: RenderResult; offsets: readonly ViewOffset[];
  draft: ViewOffsetDraft;
  /** show the bytes there (a new offset, or the one edited moved) */
  onApply: (o: ViewOffset) => void;
  /** the offset that starts at `start` is gone: its bytes are shown where they are loaded */
  onRemove: (start: Addr) => void;
  onClose: () => void;
}

/** $xxxx of an address in its bank (a cartridge's banks are spaces of their own, 13.9b) */
const x4 = (a: Addr) => `$${h4(a & 0xffff)}`;

/** The address to show the bytes at from what was typed: `$c000` (where), or `+$b700` / `-$100` (how far from `start`). */
export function parseShownAt(v: string, start: Addr, base: Addr): { to: Addr } | { error: string } {
  const t = v.trim();
  if (!t) return { error: 'Enter the address to show the bytes at, like $c000, or how far to move them, like +$b700.' };
  const m = t.match(/^([+-])\s*(\$|0x)?([0-9a-fA-F]{1,4})$/);
  if (m) return { to: start + (m[1] === '-' ? -1 : 1) * parseInt(m[3], 16) };
  const a = t.match(/^(?:\$|0x)?([0-9a-fA-F]{1,4})$/);
  if (a) return { to: base + parseInt(a[1], 16) };
  return { error: 'Shown at: enter one hex address like $c000, or an offset like +$b700 or -$0100.' };
}

export function ViewOffsetModal({ A, R, offsets, draft, onApply, onRemove, onClose }: ViewOffsetProps) {
  const editing = draft.offset ?? null;
  const base = draft.start - (draft.start & 0xffff);
  const [startV, setStartV] = useState(x4(draft.start));
  const [endV, setEndV] = useState(x4(draft.end - 1));
  const [toV, setToV] = useState(editing ? x4(editing.to) : '');

  const labelAt = (name: string) => { for (const [a, l] of R.labels) if (l.name === name) return a; return undefined; };
  // a name or an address in the bank of the bytes
  const one = (v: string): Addr | null => { const t = parseGoto(v, labelAt, a => base + a); return 'addr' in t ? t.addr : null; };
  const plan = useMemo((): { error: string } | ViewOffset => {
    const s = editing ? editing.start : one(startV);
    if (s == null) return { error: 'Start: enter one hex address like $0900, or a label.' };
    const e = editing ? editing.end - 1 : one(endV);
    if (e == null) return { error: 'End: enter one hex address like $09ff, or a label (it is included).' };
    if (e < s) return { error: `The end $${h4(e & 0xffff)} comes before the start $${h4(s & 0xffff)}.` };
    const at = parseShownAt(toV, s, base);
    if ('error' in at) return at;
    if (editing && at.to === editing.to) return { error: `They are shown at ${x4(at.to)} already.` };
    const why = viewOffsetProblem(A, offsets, s, e + 1, at.to, editing);
    return why ? { error: why } : { start: s, end: e + 1, to: at.to };
  }, [startV, endV, toV, A, R, offsets]); // eslint-disable-line react-hooks/exhaustive-deps

  const ok = !('error' in plan);
  const n = ok ? plan.end - plan.start : 0;
  const fit = ok ? viewOffsetFit(A, plan.start, plan.end, plan.to) : null;
  // bytes loaded where they are shown: references from elsewhere go to the offset's bytes in the listing
  const over = useMemo(() => {
    if (!ok) return null;
    let k = 0, file = -1;
    for (let a = plan.to; a < plan.to + n; a++) if (A.owner[a] >= 0) { k++; if (file < 0) file = A.owner[a]; }
    return k ? { k, name: A.files[file]?.name ?? 'a file' } : null;
  }, [plan, A]); // eslint-disable-line react-hooks/exhaustive-deps

  const go = () => { if (ok) onApply(plan); };
  const enter = (e: KeyboardEvent) => { if (e.key === 'Enter') go(); };
  const range = (s: Addr, e: Addr) => `${x4(s)}–${x4(e - 1)}`;
  return (
    <Modal title={editing ? 'View offset' : 'Show at another address'} onClose={onClose}>
      <div className="modal-body merge-range view-offset">
        <p className="small">{editing
          ? <>The listing shows <span className="mono">{range(editing.start, editing.end)}</span> at <span className="mono">{range(editing.to, editing.to + editing.end - editing.start)}</span> (offset <span className="mono">{shiftText(editing)}</span>). Show it somewhere else, or where it is loaded again.</>
          : <>For manual analysis: the listing shows the bytes at another address, with the addresses and labels they have there, and references to that address go to them. Only the listing: the <span className="mono">.asm</span>, the output and the round trip keep them where they are loaded, and the program's own code moves them when it runs.</>}</p>
        <div className="grid2">
          <label className="field"><span>Start (loaded at)</span><input id="voff-start" className="mono" value={startV} spellCheck={false} disabled={!!editing} onChange={e => setStartV(e.target.value)} onKeyDown={enter} placeholder="$0900 or a label" /></label>
          <label className="field"><span>End (included)</span><input id="voff-end" className="mono" value={endV} spellCheck={false} disabled={!!editing} onChange={e => setEndV(e.target.value)} onKeyDown={enter} placeholder="$09ff or a label" /></label>
        </div>
        <label className="field"><span>Shown at (or offset)</span><input id="voff-to" className="mono" value={toV} spellCheck={false} onChange={e => setToV(e.target.value)} onKeyDown={enter} placeholder="$c000 or +$b700" autoFocus /></label>
        {ok ? <div className="merge-sum">
          <p className="small"><b>{range(plan.start, plan.end)}</b> ({n} byte{n === 1 ? '' : 's'}) {editing ? 'will be' : 'is'} shown at <b>{range(plan.to, plan.to + n)}</b> (offset <span className="mono">{shiftText(plan)}</span>), in the listing only.</p>
          {fit && <p className="small voff-fit">{fit.refs === 0
            ? <>Nothing refers to {range(plan.to, plan.to + n)}.</>
            : <>{fit.refs} reference{fit.refs === 1 ? ' goes' : 's go'} to {range(plan.to, plan.to + n)}{fit.own ? <>, {fit.own} of {fit.refs === 1 ? 'it' : 'them'} from these bytes</> : null}{fit.jumps ? <>; of the jumps and calls there, {fit.onCode} of {fit.jumps} land on an instruction{fit.onCode < fit.jumps ? ' (mark the bytes as code to read them)' : ''}</> : null}.</>}</p>}
          {over && <p className="warn-text small">{over.k} of the bytes at {range(plan.to, plan.to + n)} are loaded from {over.name}: in the listing, references from elsewhere go to the bytes shown there, and the code loaded there keeps its own.</p>}
          <p className="muted small">Names you give them stay with the bytes, also in the .asm. Ctrl+Z takes it back.</p>
        </div> : <div className="err-text small">{plan.error}</div>}
      </div>
      <div className="modal-foot">
        {editing && <button className="btn" onClick={() => onRemove(editing.start)} title="Show the bytes where they are loaded again">Remove offset</button>}
        <span className="grow" /><button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={!ok} onClick={go}>{editing ? 'Show them there' : 'Show there'}</button>
      </div>
    </Modal>
  );
}
