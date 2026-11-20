/* The Library view in the side panel (spec 10.6): the SID tunes, sprites, charsets and bitmaps added to the library, the newest
 * first, each with a picture of it and where it was taken from. A click shows it in the Library tab; a SID's play
 * button plays it in VICE or DeepSID; the right-click menu plays, renames, shows its file and moves it to the Recycle
 * Bin. The kinds' buttons list one kind, the filter looks through names, sources and authors. */
import { useEffect, useMemo } from 'react';
import { LIBRARY_KINDS, type LibraryItem, type LibraryKind } from '@mimir/core';
import { Icon } from '../lib/icons';
import { cx } from '../lib/util';
import { itemFrom, itemWhat, LIB_COLORS, LIB_KIND, libraryMatches, libraryOrder, sidInfo } from '../lib/library';
import { sameRef, useLibrary, type LibraryRef } from '../store/library';
import { LibraryThumb } from './LibraryThumb';

export interface LibraryViewProps {
  desktop: boolean;
  /** where SIDs play (Settings → Toolchain) */
  playerName: string;
  onShow: (ref: LibraryRef) => void;
  onPlay: (item: LibraryItem) => void;
  onMenu: (item: LibraryItem, x: number, y: number) => void;
  onReveal: (kind?: LibraryKind) => void;
}

export function LibraryView({ desktop, playerName, onShow, onPlay, onMenu, onReveal }: LibraryViewProps) {
  const { listing, loading, error, selected, kind, q, set, load } = useLibrary();
  // read when the view is shown (the folder may have changed outside Mimir)
  useEffect(() => { void load(); }, [load]);
  const items = useMemo(() => libraryOrder(listing?.items ?? []), [listing]);
  const count = (k: LibraryKind) => items.filter(i => i.kind === k).length;
  const shown = items.filter(i => (kind === 'all' || i.kind === kind) && libraryMatches(i, q));
  return (
    <div className="side-inner lib-side">
      <div className="side-title lib-title">Library
        <span className="grow" />
        <button className="icon-btn" title="Read the library's folder again" aria-label="Read the library again" disabled={!desktop || loading} onClick={() => void load()}><Icon name="refresh" size={14} /></button>
        <button className="icon-btn" title={listing ? `Open the library's folder: ${listing.dir}` : 'Open the library\'s folder'} aria-label="Open the library's folder" disabled={!desktop} onClick={() => onReveal(kind === 'all' ? undefined : kind)}><Icon name="folder" size={14} /></button>
      </div>
      <div className="seg wide lib-kinds" role="tablist" aria-label="Kinds">
        {(['all', ...LIBRARY_KINDS] as const).map(k => (
          <button key={k} role="tab" aria-selected={kind === k} className={cx(kind === k && 'on')} onClick={() => set({ kind: k })}
            title={k === 'all' ? 'Every kind' : `The ${LIB_KIND[k].many}`}>{k === 'all' ? 'All' : LIB_KIND[k].folder} <span className="lib-n">{k === 'all' ? items.length : count(k)}</span></button>
        ))}
      </div>
      <div className="side-search"><Icon name="search" size={14} /><label htmlFor="lib-q" className="sr-only">Filter the library</label><input id="lib-q" value={q} onChange={e => set({ q: e.target.value })} placeholder="Filter by name, source or author" /></div>
      {error && <p className="side-hint err-text" role="alert">{error}</p>}
      <div className="lib-list" role="list" aria-label="The library">
        {shown.map(i => {
          const ref = { kind: i.kind, file: i.file }, s = sidInfo(i), from = itemFrom(i);
          return (
            <div key={`${i.kind}/${i.file}`} role="listitem" className={cx('lib-row', sameRef(selected, ref) && 'on')} title={`${i.file}${from ? `\nFrom ${from}` : ''}\nClick to show it in the Library tab${i.kind === 'sid' ? `, double-click to play it in ${playerName}` : ''}`}
              onClick={() => onShow(ref)} onDoubleClick={() => { if (i.kind === 'sid') onPlay(i); }}
              onContextMenu={e => { e.preventDefault(); onMenu(i, e.clientX, e.clientY); }}>
              <div className="lib-row-pic">
                {i.kind === 'sid' ? <Icon name="music" size={18} />
                  : <LibraryThumb item={i} mc={!!i.mc} colors={i.colors ?? LIB_COLORS} per={i.kind === 'chars' ? 8 : 2} count={i.kind === 'chars' ? 16 : 2} scale={1} max={48} />}
              </div>
              <div className="lib-row-meta">
                <div className="lib-row-name">{i.name}</div>
                <div className="muted small lib-row-from">{s?.author && s.author !== '<?>' ? `${s.author} · ` : ''}{from || i.file}</div>
                <div className="muted small">{itemWhat(i)}{kind === 'all' ? ` · ${LIB_KIND[i.kind].folder}` : ''}</div>
              </div>
              {i.kind === 'sid' && <button className="icon-btn lib-play" aria-label={`Play ${i.name} in ${playerName}`} title={`Play it in ${playerName} (Settings → Toolchain picks VICE or DeepSID)`}
                onClick={e => { e.stopPropagation(); onPlay(i); }} onDoubleClick={e => e.stopPropagation()}><Icon name="play" size={13} /></button>}
            </div>
          );
        })}
      </div>
      {!desktop ? <p className="side-hint">The library is a folder on your computer: it needs the desktop app.</p>
        : listing && !items.length ? <div className="side-hint lib-empty">
          <p><b>Nothing in the library yet.</b></p>
          <p>Right-click a music, sprite, charset or bitmap block in the listing and choose <b>Add to library</b>, or use the button in the inspector or the Graphics tab. Each goes in a folder of its kind (SIDs, Sprites, Chars, Bitmaps) as a file named after where it was found.</p>
        </div>
          : items.length > 0 && !shown.length ? <p className="side-hint">Nothing {kind === 'all' ? '' : `in ${LIB_KIND[kind].folder} `}matches the filter.</p> : null}
      {listing && <button type="button" className="linkish small lib-dir mono" title="Open the library's folder (Settings → General → Library folder moves it)" onClick={() => onReveal()}>{listing.dir}</button>}
    </div>
  );
}
