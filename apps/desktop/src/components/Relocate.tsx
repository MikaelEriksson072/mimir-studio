/* Relocate (spec 8.1b): bytes the program copies to another address before they run there. A start, an end (included)
 * and the address they run at: the analysis reads them there, the listing shows them there, and the source writes
 * them inside `.pseudopc` where they are loaded. The user's names, comments and marks on the bytes go along. A block
 * relocated already can run somewhere else instead, or stop being relocated. A copy loop the analysis found fills in
 * the range and the address. */
import { useMemo, useState, type KeyboardEvent } from 'react';
import { codeWhereLoaded, h4, OPC, relocProblem, type Addr, type AnalysisResult, type Project, type Reloc, type RenderResult } from '@mimir/core';
import { parseGoto } from '../lib/goto';
import { Modal } from './Modal';

export interface RelocDraft {
  start: Addr; end: Addr;
  /** where it runs: a copy loop's or the relocated block's (null: to be typed) */
  to: Addr | null;
  /** the relocated block this edits */
  reloc?: Reloc | null;
  /** the copy loop that copies these bytes (its store): it says where they run */
  copyAt?: Addr | null;
}

interface RelocateProps {
  A: AnalysisResult; R: RenderResult; project: Pick<Project, 'labels' | 'comments' | 'notes' | 'blockComments' | 'bookmarks' | 'patches'>;
  draft: RelocDraft;
  onRelocate: (r: Reloc) => void;
  /** the relocated block loaded at `start` runs at `to` instead */
  onMove: (start: Addr, to: Addr) => void;
  /** the relocated block loaded at `start` is no longer relocated */
  onRemove: (start: Addr) => void;
  onClose: () => void;
}

/** $xxxx of an address in its bank (a cartridge's banks are spaces of their own, 13.9b) */
const x4 = (a: Addr) => `$${h4(a & 0xffff)}`;

export function RelocateModal({ A, R, project, draft, onRelocate, onMove, onRemove, onClose }: RelocateProps) {
  const editing = draft.reloc ?? null;
  const base = draft.start - (draft.start & 0xffff);
  const [startV, setStartV] = useState(x4(draft.start));
  const [endV, setEndV] = useState(x4(draft.end - 1));
  const [toV, setToV] = useState(draft.to != null ? x4(draft.to) : '');

  const labelAt = (name: string) => { for (const [a, l] of R.labels) if (l.name === name) return a; return undefined; };
  // a name or an address in the bank of the block
  const one = (v: string): Addr | null => { const t = parseGoto(v, labelAt, a => base + a); return 'addr' in t ? t.addr : null; };
  const plan = useMemo((): { error: string } | Reloc => {
    const s = editing ? editing.start : one(startV);
    if (s == null) return { error: 'Start: enter one hex address like $1000, or a label.' };
    const e = editing ? editing.end - 1 : one(endV);
    if (e == null) return { error: 'End: enter one hex address like $10ff, or a label (it is included in the block).' };
    if (e < s) return { error: `The end $${h4(e & 0xffff)} comes before the start $${h4(s & 0xffff)}.` };
    if (!toV.trim()) return { error: 'Enter the address the bytes run at, like $c000.' };
    const m = toV.trim().match(/^(?:\$|0x)?([0-9a-fA-F]{1,4})$/);
    if (!m) return { error: 'Runs at: enter one hex address like $c000.' };
    const to = base + parseInt(m[1], 16);
    if (editing && to === editing.to) return { error: `It runs at ${x4(to)} already.` };
    const why = relocProblem(A, s, e + 1, to, editing, project.patches);
    return why ? { error: why } : { start: s, end: e + 1, to };
  }, [startV, endV, toV, A, R]); // eslint-disable-line react-hooks/exhaustive-deps

  const ok = !('error' in plan);
  const n = ok ? plan.end - plan.start : 0;
  // what of the user's work goes along to where the bytes run
  const moving = useMemo(() => {
    if (!ok) return '';
    const [from, to] = editing ? [editing.to, editing.to + n] : [plan.start, plan.end];
    const count = (r: Record<Addr, unknown>) => Object.keys(r).map(Number).filter(a => a >= from && a < to).length;
    const parts = ([[count(project.labels), 'name'], [count(project.comments) + count(project.notes) + count(project.blockComments), 'comment'], [count(project.bookmarks), 'bookmark'],
      [project.patches.filter(p => p.start >= from && p.start < to).length, 'patch']] as const).filter(([k]) => k > 0).map(([k, w]) => `${k} ${w}${k === 1 ? '' : w === 'patch' ? 'es' : 's'}`);
    return parts.join(', ');
  }, [plan, project]); // eslint-disable-line react-hooks/exhaustive-deps
  const copy = draft.copyAt != null ? A.copies.find(c => c.at === draft.copyAt) : undefined;
  // code the analysis traces where it is loaded: relocated, it is read where it runs only
  const lost = ok && !editing ? codeWhereLoaded(A, plan.start, plan.end) : [];

  const go = () => {
    if (!ok) return;
    if (editing) onMove(editing.start, plan.to); else onRelocate(plan);
  };
  const enter = (e: KeyboardEvent) => { if (e.key === 'Enter') go(); };
  const title = editing ? 'Relocated block' : 'Relocate';
  return (
    <Modal title={title} onClose={onClose}>
      <div className="modal-body merge-range relocate">
        <p className="small">{editing
          ? <>The program copies <span className="mono">{x4(editing.start)}–{x4(editing.end - 1)}</span> to <span className="mono">{x4(editing.to)}–{x4(editing.to + editing.end - editing.start - 1)}</span> and runs it there. Give another address it runs at, or stop relocating it.</>
          : <>Bytes the program copies to another address before they run there: the analysis reads them where they run, and the source writes them where they are loaded, inside <span className="mono">.pseudopc</span>.</>}</p>
        <div className="grid2">
          <label className="field"><span>Start (loaded at)</span><input id="reloc-start" className="mono" value={startV} spellCheck={false} disabled={!!editing} onChange={e => setStartV(e.target.value)} onKeyDown={enter} placeholder="$1000 or a label" /></label>
          <label className="field"><span>End (included)</span><input id="reloc-end" className="mono" value={endV} spellCheck={false} disabled={!!editing} onChange={e => setEndV(e.target.value)} onKeyDown={enter} placeholder="$10ff or a label" /></label>
        </div>
        <label className="field"><span>Runs at</span><input id="reloc-to" className="mono" value={toV} spellCheck={false} onChange={e => setToV(e.target.value)} onKeyDown={enter} placeholder="$c000" autoFocus /></label>
        {copy && !editing && <p className="muted small">The loop at <span className="mono">{x4(copy.loop)}</span> copies these bytes to <span className="mono">{x4(copy.to)}</span>, and the <span className="mono">{OPC[A.mem[copy.jump]].mn.toLowerCase()} at {x4(copy.jump)}</span> goes there.</p>}
        {ok ? <div className="merge-sum">
          <p className="small"><b>{x4(plan.start)}–{x4(plan.end - 1)}</b> ({n} byte{n === 1 ? '' : 's'}) {editing ? 'will run' : 'runs'} at <b>{x4(plan.to)}–{x4(plan.to + n - 1)}</b>: traced, named and shown there, and written as <span className="mono">.pseudopc {x4(plan.to)} {'{ … }'}</span>.</p>
          {lost.length > 0 && <p className="warn-text small">{lost.map(r => `${x4(r.start)}${r.end - r.start > 1 ? `–${x4(r.end - 1)}` : ''}`).join(', ')} {lost.length === 1 && lost[0].end - lost[0].start === 1 ? 'is' : 'are'} code that runs where it is loaded too: relocated, {lost.length === 1 ? 'it is' : 'they are'} read where {lost.length === 1 ? 'it runs' : 'they run'} only. End the block before it if the program uses it there.</p>}
          {moving && <p className="muted small">Going along to {x4(plan.to)}: {moving}.</p>}
          <p className="muted small">You can undo it with Ctrl+Z.</p>
        </div> : <div className="err-text small">{plan.error}</div>}
      </div>
      <div className="modal-foot">
        {editing && <button className="btn" onClick={() => onRemove(editing.start)} title="The bytes are read where they are loaded again; names and comments go back with them">Stop relocating</button>}
        <span className="grow" /><button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" disabled={!ok} onClick={go}>{editing ? 'Run it there' : 'Relocate'}</button>
      </div>
    </Modal>
  );
}

