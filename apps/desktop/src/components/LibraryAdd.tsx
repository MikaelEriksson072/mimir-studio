/* Add to library (spec 10.6): a music block, sprites or a charset as a file of the library, under a name that says
 * where it was found. The dialog fills in the block's name and where it was taken from (the disk, the file, the project)
 * and shows the file's name as it changes; a SID gets its author too (its name, author and source go in the .sid). */
import { useEffect, useMemo, useRef, useState } from 'react';
import { LIBRARY_EXT, libraryRange, librarySourceText, libraryStem, type LibraryColors, type LibraryDigi, type LibraryItem, type LibraryKind, type LibrarySource } from '@mimir/core';
import { LIB_KIND, LIB_COLORS, sidInfo, itemWhat } from '../lib/library';
import { Modal } from './Modal';
import { LibraryThumb } from './LibraryThumb';

/** what is to go in the library: the file's bytes as written (a .sid, raw sprites, a charset with its load address),
 *  the bytes the preview draws (a .sid's whole; sprites and a charset without the load address), its name and source */
export interface LibraryDraft {
  kind: LibraryKind;
  bytes: Uint8Array;
  data: Uint8Array;
  name: string;
  from: LibrarySource;
  mc?: boolean;
  colors?: LibraryColors;
  digi?: LibraryDigi;
  busy?: [number, number][];
}

/** what the user gave: the name, where it was taken from (the file's name says it), and a SID's author */
export interface LibraryAnswer { name: string; fromText: string; author: string }

export function LibraryAddModal({ draft, same, onAdd, onShow, onClose }: {
  draft: LibraryDraft;
  /** the item of the library with the same bytes, when there is one */
  same: LibraryItem | null;
  onAdd: (a: LibraryAnswer) => void;
  /** the library's item shown in the Library tab */
  onShow: (item: LibraryItem) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState(draft.name);
  const [fromText, setFromText] = useState(() => librarySourceText(draft.from));
  const [author, setAuthor] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.select(); }, []);
  const k = LIB_KIND[draft.kind];
  const file = `${libraryStem(name, { ...draft.from, text: fromText })}.${LIBRARY_EXT[draft.kind]}`;
  const preview = useMemo(() => ({ kind: draft.kind, data: draft.data }), [draft]);
  const sid = sidInfo(preview);
  const range = libraryRange(draft.from.start, draft.from.end);
  const ok = name.trim().length > 0;
  const add = () => { if (ok) onAdd({ name: name.trim(), fromText: fromText.trim(), author: author.trim() }); };
  const enter = (e: React.KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); add(); } };
  return (
    <Modal title="Add to library" onClose={onClose} className="lib-add">
      <div className="modal-body">
        <div className="lib-add-what">
          {draft.kind === 'sid' ? <div className="lib-add-sid mono small">{sid ? <>${sid.location.toString(16).padStart(4, '0')}–${(sid.location + sid.size - 1).toString(16).padStart(4, '0')} · init ${sid.init.toString(16).padStart(4, '0')} · play {sid.play ? `$${sid.play.toString(16).padStart(4, '0')}` : 'none'}</> : null}</div>
            : <LibraryThumb item={preview} mc={!!draft.mc} colors={draft.colors ?? LIB_COLORS} per={draft.kind === 'chars' ? 32 : 8} count={draft.kind === 'chars' ? 128 : 16} scale={2} max={300} />}
          <span className="muted small">{itemWhat(preview)}{range ? ` from ${range}` : ''}, to the library's {k.folder}</span>
        </div>
        <label className="field"><span>Name</span><input ref={ref} id="lib-add-name" value={name} spellCheck={false} onChange={e => setName(e.target.value)} onKeyDown={enter} /></label>
        <label className="field"><span>Taken from</span><input id="lib-add-from" value={fromText} spellCheck={false} placeholder="the game, demo or disk" onChange={e => setFromText(e.target.value)} onKeyDown={enter} /></label>
        {draft.kind === 'sid' && <label className="field"><span>Author (optional)</span><input id="lib-add-author" value={author} spellCheck={false} placeholder="the composer" onChange={e => setAuthor(e.target.value)} onKeyDown={enter} /></label>}
        <p className="small lib-add-file"><span className="muted">File:</span> <span className="mono">{k.folder}\{file}</span></p>
        {draft.kind === 'sid' && <p className="muted small">The .sid gets the name, the author and where it was taken from as its texts, as the HVSC's tunes have them.</p>}
        {same && <div className="notice small warn-text" role="status">These bytes are in the library already, as <button type="button" className="linkish" onClick={() => onShow(same)}>{same.file}</button>. Add them again under another name, or leave it.</div>}
      </div>
      <div className="modal-foot"><span className="grow" /><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!ok} onClick={add}>{same ? 'Add again' : 'Add to library'}</button></div>
    </Modal>
  );
}
