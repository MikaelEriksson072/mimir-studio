/* Scripts and files (spec 10.3): a file of the mounted disk or the tape as what a scratchpad starts with (From a
 * file…), and a script run on files (Run on files…): each file goes into the scratchpad that takes a file, the script
 * runs, and what it leaves is a file again, opened, added to the project or saved. */
import { useMemo, useState } from 'react';
import { filePad, h4, type Addr, type ScriptPad, type UserScript } from '@mimir/core';
import { Modal } from './Modal';
import { Icon } from '../lib/icons';
import { cx } from '../lib/util';

/** a file a script can be given: of the mounted disk's directory, of what its loader loads, or of the tape; its bytes
 *  without the load address (`load` null: it has none) */
export interface ScriptFileChoice { key: string; group: string; name: string; load: Addr | null; bytes: Uint8Array }

/** what happens with the files a run on files gives: a new project of them, added to this one, or saved to a folder */
export type FilesRunThen = 'open' | 'add' | 'save';

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
const sizeText = (f: ScriptFileChoice) => `${plural(f.bytes.length, 'byte')}${f.load != null ? `, loads at $${h4(f.load)}` : ''}`;
/** the files by their group, in the order they come */
const grouped = (files: readonly ScriptFileChoice[]) => {
  const out: { group: string; files: ScriptFileChoice[] }[] = [];
  for (const f of files) { const g = out.find(x => x.group === f.group); if (g) g.files.push(f); else out.push({ group: f.group, files: [f] }); }
  return out;
};

/** Which file goes into which scratchpad (a new one, or one of the script's). */
export function FileToPad({ files, pads, into, onCopy, onCancel }: { files: readonly ScriptFileChoice[]; pads: readonly ScriptPad[]; into: number | null; onCopy: (f: ScriptFileChoice, pad: number | null) => void; onCancel: () => void }) {
  const [key, setKey] = useState(files[0]?.key ?? '');
  const [pad, setPad] = useState<string>(into != null ? String(into) : 'new');
  const f = files.find(x => x.key === key), p = pad === 'new' ? null : pads[+pad];
  const groups = useMemo(() => grouped(files), [files]);
  const takes = filePad(pads);
  return (
    <div className="pad-from" role="group" aria-label="Put a file into a scratchpad">
      {!files.length ? <p className="muted small">No disk is mounted and no tape is in the datasette: mount a .d64 or .g64 (File → Mount disk…) or put in a tape, and its files are listed here.</p> : <>
        <label><span>File</span><select aria-label="File" value={key} onChange={e => setKey(e.target.value)}>
          {groups.map(g => <optgroup key={g.group} label={g.group}>{g.files.map(x => <option key={x.key} value={x.key}>{x.name} · {sizeText(x)}</option>)}</optgroup>)}
        </select></label>
        <label><span>Into</span><select aria-label="Into" value={pad} onChange={e => setPad(e.target.value)}>
          <option value="new">a new scratchpad</option>
          {pads.map((x, i) => <option key={i} value={i}>{x.name} (${h4(x.start)}, {x.size} bytes)</option>)}
        </select></label>
        {f && <p className="muted small">Its {plural(f.bytes.length, 'byte')}, without the load address, are what a run starts the scratchpad with{f.load != null ? `; ${p ? p.name : 'its name'}_load is $${h4(f.load)} in the code when its use is File` : ''}. {p ? (p.size < f.bytes.length ? `${p.name} becomes ${f.bytes.length} bytes, when there is room after it.` : `In place of what ${p.name} starts with now.`) : `A new scratchpad of ${f.bytes.length} bytes${takes < 0 ? ', with the use File: Run on files… puts each file there' : ''}.`}</p>}
      </>}
      <div className="pad-from-act">
        <button className="btn small primary" disabled={!f} onClick={() => f && onCopy(f, p ? +pad : null)}><Icon name="copy" size={13} />Put in</button>
        <button className="btn small" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

/** how far a run on files has come: the file it is at */
export interface FilesRunBusy { done: number; total: number; name: string }

/**
 * Run on files…: the files of the mounted disk and the tape, each with a box (`first`: the ones ticked when it
 * opens), and what happens with the results. Run runs the script on each ticked file in turn; while it does, the
 * dialog says where it is and Stop ends it.
 */
export function RunOnFilesModal({ script, files, first, busy, onRun, onStop, onClose }: {
  script: UserScript; files: readonly ScriptFileChoice[]; first: readonly string[]; busy: FilesRunBusy | null;
  onRun: (files: ScriptFileChoice[], then: FilesRunThen) => void; onStop: () => void; onClose: () => void;
}) {
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set(first.filter(k => files.some(f => f.key === k))));
  const [then, setThen] = useState<FilesRunThen>('open');
  const groups = useMemo(() => grouped(files), [files]);
  const pads = script.pads, takes = pads[filePad(pads)], results = pads.filter(p => p.role === 'result');
  const toggle = (keys: string[], on: boolean) => setPicked(s => { const n = new Set(s); for (const k of keys) if (on) n.add(k); else n.delete(k); return n; });
  const chosen = files.filter(f => picked.has(f.key));
  const THEN: { k: FilesRunThen; label: string; tip: string }[] = [
    { k: 'open', label: 'Open them as a new project', tip: 'The results become the files of a new project (the work here is asked about first, when it is not saved)' },
    { k: 'add', label: 'Add them to this project', tip: 'The results are added to this project\'s files, each at its address (Ctrl+Z takes them out)' },
    { k: 'save', label: 'Save them to a folder…', tip: 'The results are saved as PRG files in a folder you pick' },
  ];
  return (
    <Modal title={`Run "${script.name}" on files`} onClose={busy ? () => { /* Stop ends it */ } : onClose} wide className="files-run-modal">
      <div className="modal-body">
        <p className="small files-run-how">
          Each file goes into <b>{takes?.name ?? '?'}</b> (as big as the file; <span className="mono">{takes?.name}_end</span> is the address after it, <span className="mono">{takes?.name}_load</span> its load address) and the script runs.
          The result is {results.length ? <>what the run writes into <b>{results.map(p => p.name).join(', ')}</b>, loading at {results.length === 1 ? 'its address' : 'their addresses'}</> : <>{takes?.name} as the run leaves it when the run writes it, else the longest stretch of memory the run writes (an unpacker's output)</>}.
          Nothing goes into the program.
        </p>
        {!files.length ? <p className="muted">No disk is mounted and no tape is in the datasette: mount a .d64 or .g64 or put in a tape, and its files are listed here.</p> : <>
          <div className="files-run-bar">
            <span className="muted small" aria-live="polite">{picked.size} of {files.length} picked</span><span className="grow" />
            <button className="btn tiny ghost" disabled={!!busy} onClick={() => toggle(files.map(f => f.key), true)}>All</button>
            <button className="btn tiny ghost" disabled={!!busy} onClick={() => setPicked(new Set())}>None</button>
          </div>
          <div className="files-run-list" role="group" aria-label="Files to run it on">
            {groups.map(g => {
              const keys = g.files.map(f => f.key), all = keys.every(k => picked.has(k));
              return (
                <div key={g.group} className="files-run-group">
                  <label className="files-run-gh"><input type="checkbox" disabled={!!busy} checked={all} ref={el => { if (el) el.indeterminate = !all && keys.some(k => picked.has(k)); }} onChange={e => toggle(keys, e.target.checked)} aria-label={`All of ${g.group}`} /><b>{g.group}</b><span className="muted small">{g.files.length}</span></label>
                  {g.files.map(f => (
                    <label key={f.key} className={cx('files-run-row', busy?.name === f.name && 'at')}>
                      <input type="checkbox" disabled={!!busy} checked={picked.has(f.key)} onChange={e => toggle([f.key], e.target.checked)} aria-label={f.name} />
                      <span className="mono files-run-name">{f.name}</span><span className="muted small mono">{f.load != null ? `$${h4(f.load)}` : ''}</span><span className="muted small files-run-size">{f.bytes.length}</span>
                    </label>
                  ))}
                </div>
              );
            })}
          </div>
          <div className="files-run-then" role="radiogroup" aria-label="With the results">
            <span className="small muted">With the results</span>
            {THEN.map(t => <label key={t.k} title={t.tip}><input type="radio" name="files-run-then" disabled={!!busy} checked={then === t.k} onChange={() => setThen(t.k)} />{t.label}</label>)}
          </div>
        </>}
      </div>
      <div className="modal-foot">
        {busy ? <span className="small files-run-busy" role="status"><span className="spinner" />File {Math.min(busy.done + 1, busy.total)} of {busy.total}: {busy.name}</span> : <span className="grow" />}
        {busy && <span className="grow" />}
        {busy ? <button className="btn" onClick={onStop}>Stop</button> : <button className="btn" onClick={onClose}>Cancel</button>}
        <button className="btn primary" disabled={!!busy || !chosen.length || !takes} onClick={() => onRun(chosen, then)}><Icon name="play" size={13} />Run on {plural(chosen.length, 'file')}</button>
      </div>
    </Modal>
  );
}
