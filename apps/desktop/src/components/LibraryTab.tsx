/* The Library tab (spec 10.6): everything in the library as cards, a kind or all of them, and the item picked shown
 * whole beside them: a charset or sprites large, in multicolour or not and in colours of their own (kept for the item),
 * sprites played one after the other as an animation; a bitmap as its picture; a SID's texts and addresses, played in
 * VICE or DeepSID; where each was taken from, its file, rename and the Recycle Bin. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { h2, h4, LIBRARY_KINDS, libraryStem, pictureFormatOf, pictureFormatName, safeFileName, type LibraryColors, type LibraryItem, type LibraryKind } from '@mimir/core';
import { Icon } from '../lib/icons';
import { cx } from '../lib/util';
import { C64, C64_NAMES } from '../lib/palette';
import { itemCount, itemFrom, itemWhat, LIB_COLORS, LIB_KIND, libraryMatches, libraryOrder, sidInfo } from '../lib/library';
import { itemOf, sameRef, useLibrary, type LibraryRef } from '../store/library';
import { LibraryThumb } from './LibraryThumb';

export interface LibraryTabProps {
  desktop: boolean;
  /** where SIDs play by default (Settings → Toolchain) */
  player: 'vice' | 'deepsid';
  onPlay: (item: LibraryItem, o?: { player?: 'vice' | 'deepsid'; song?: number }) => void;
  onReveal: (ref?: LibraryRef) => void;
  onMenu: (item: LibraryItem, x: number, y: number) => void;
  toast: (msg: string, kind?: 'info' | 'ok' | 'warn' | 'err') => void;
}

const PLAYER = { vice: 'VICE', deepsid: 'DeepSID' } as const;

export function LibraryTab({ desktop, player, onPlay, onReveal, onMenu, toast }: LibraryTabProps) {
  const { listing, selected, kind, q, set, load } = useLibrary();
  useEffect(() => { if (!listing) void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const items = useMemo(() => libraryOrder(listing?.items ?? []), [listing]);
  const shown = items.filter(i => (kind === 'all' || i.kind === kind) && libraryMatches(i, q));
  const item = itemOf(listing?.items, selected);
  const groups = (kind === 'all' ? LIBRARY_KINDS : [kind]).map(k => ({ k, list: shown.filter(i => i.kind === k) })).filter(g => g.list.length);
  return (
    <div className={cx('lib-tab', !item && 'none')}>
      <div className="lib-gallery">
        <div className="lib-bar">
          <div className="seg" role="tablist" aria-label="Kinds">
            {(['all', ...LIBRARY_KINDS] as const).map(k => (
              <button key={k} role="tab" aria-selected={kind === k} className={cx(kind === k && 'on')} onClick={() => set({ kind: k })}>{k === 'all' ? 'All' : LIB_KIND[k].folder} <span className="lib-n">{k === 'all' ? items.length : items.filter(i => i.kind === k).length}</span></button>
            ))}
          </div>
          <div className="side-search lib-search"><Icon name="search" size={14} /><label htmlFor="lib-tab-q" className="sr-only">Filter the library</label><input id="lib-tab-q" value={q} onChange={e => set({ q: e.target.value })} placeholder="Filter by name, source or author" /></div>
          <span className="grow" />
          <button className="btn ghost small" disabled={!desktop} title={listing ? `Open the library's folder: ${listing.dir}` : undefined} onClick={() => onReveal()}><Icon name="folder" size={14} /><span className="tool-label">Folder</span></button>
        </div>
        <div className="lib-cards-wrap">
          {groups.map(g => (
            <section key={g.k} className="lib-group" aria-label={LIB_KIND[g.k].folder}>
              {kind === 'all' && <h3 className="lib-group-head"><Icon name={LIB_KIND[g.k].icon} size={14} />{LIB_KIND[g.k].folder} <span className="muted">{g.list.length}</span></h3>}
              <div className="lib-cards">
                {g.list.map(i => <LibraryCard key={`${i.kind}/${i.file}`} item={i} on={sameRef(selected, i)} player={PLAYER[player]}
                  onPick={() => set({ selected: { kind: i.kind, file: i.file } })} onPlay={() => onPlay(i)} onMenu={(x, y) => onMenu(i, x, y)} />)}
              </div>
            </section>
          ))}
          {!desktop ? <p className="muted lib-hint">The library is a folder on your computer: it needs the desktop app.</p>
            : listing && !items.length ? <div className="lib-hint">
              <Icon name="library" size={30} />
              <h2>The library is empty</h2>
              <p>SID music, sprites, charsets and bitmaps you find go in it, for every project: right-click a music, sprite, charset or bitmap block in the listing and choose <b>Add to library</b> (or the button in the inspector, or in the Graphics tab). Each becomes a file named after where it was found, in a folder of its kind; a bitmap a picture in the format Settings → General → Library picks.</p>
            </div>
              : items.length > 0 && !shown.length ? <p className="muted lib-hint">Nothing matches the filter.</p>
                : !item && items.length > 0 ? <p className="muted lib-hint small">Click one to see it large beside them: a charset or sprites in colours of their own, sprites as an animation, a bitmap as its picture, a SID with its texts and play buttons.</p> : null}
        </div>
      </div>
      {item && <div className="lib-detail">
        <LibraryDetail key={`${item.kind}/${item.file}`} item={item} player={player} onPlay={onPlay} onReveal={() => onReveal({ kind: item.kind, file: item.file })} onClose={() => set({ selected: null })} toast={toast} />
      </div>}
    </div>
  );
}

function LibraryCard({ item, on, player, onPick, onPlay, onMenu }: { item: LibraryItem; on: boolean; player: string; onPick: () => void; onPlay: () => void; onMenu: (x: number, y: number) => void }) {
  const s = sidInfo(item), from = itemFrom(item);
  return (
    <div className={cx('lib-card', on && 'on')} role="button" tabIndex={0} aria-pressed={on} aria-label={item.name} title={`${item.file}${from ? `\nFrom ${from}` : ''}${item.kind === 'sid' ? `\nDouble-click to play it in ${player}` : ''}`}
      onClick={onPick} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(); } }}
      onDoubleClick={() => { if (item.kind === 'sid') onPlay(); }} onContextMenu={e => { e.preventDefault(); onMenu(e.clientX, e.clientY); }}>
      <div className="lib-card-pic">
        {item.kind === 'sid' ? <div className="lib-card-sid"><Icon name="music" size={26} />{s && <span className="small">{s.author && s.author !== '<?>' ? s.author : s.released || ''}</span>}</div>
          : <LibraryThumb item={item} mc={!!item.mc} colors={item.colors ?? LIB_COLORS} per={item.kind === 'chars' ? 16 : 4} count={item.kind === 'chars' ? 64 : 8} scale={2} max={196} label={item.kind === 'bitmaps' ? `${item.name}: the picture` : undefined} />}
      </div>
      <div className="lib-card-name">{item.name}</div>
      <div className="muted small lib-card-from">{from || item.file}</div>
      <div className="muted small">{itemWhat(item)}</div>
    </div>
  );
}

const PER: Record<'sprites' | 'chars', number[]> = { sprites: [1, 2, 4, 8, 16], chars: [8, 16, 32, 40] };
const FPS = [2, 4, 6, 8, 10, 12, 15, 20, 25, 50];

/** the item picked, whole */
function LibraryDetail({ item, player, onPlay, onReveal, onClose, toast }: { item: LibraryItem; player: 'vice' | 'deepsid'; onPlay: LibraryTabProps['onPlay']; onReveal: () => void; onClose: () => void; toast: LibraryTabProps['toast'] }) {
  const update = useLibrary(s => s.update), remove = useLibrary(s => s.remove);
  const gfx = item.kind === 'sprites' || item.kind === 'chars';
  const [mc, setMc] = useState(!!item.mc);
  const [colors, setColors] = useState<LibraryColors>(item.colors ?? LIB_COLORS);
  const [per, setPer] = useState(item.kind === 'chars' ? 16 : 8);
  // (a picture as wide as the pane, 0)
  const [zoom, setZoom] = useState(item.kind === 'bitmaps' ? 0 : item.kind === 'chars' ? 2 : 3);
  const [pick, setPick] = useState<number | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [trash, setTrash] = useState(false);
  const [song, setSong] = useState<number | null>(null);
  const s = sidInfo(item), n = itemCount(item), unit = item.kind === 'sprites' ? 64 : 8;
  // how it is drawn is kept for the item (library.json), a moment after the last change
  // (one waiting when another item is picked is kept at once)
  const keep = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pending = useRef<(() => void) | null>(null);
  const drawn = (m: boolean, c: LibraryColors) => {
    setMc(m); setColors(c);
    clearTimeout(keep.current);
    pending.current = () => { pending.current = null; update({ kind: item.kind, file: item.file, mc: m, colors: c }).catch(e => toast(`Could not keep the colours: ${e instanceof Error ? e.message : String(e)}`, 'err')); };
    keep.current = setTimeout(() => pending.current?.(), 500);
  };
  useEffect(() => () => { clearTimeout(keep.current); pending.current?.(); }, []);
  // (Enter and the blur that follows rename it once)
  const renamed = useRef(false);
  const rename = async (name: string) => {
    if (renamed.current) return;
    renamed.current = true;
    const t = name.trim();
    setRenaming(null);
    if (!t || t === item.name) return;
    try {
      const stem = item.own ? safeFileName(t) : libraryStem(t, item.from ?? {});
      const r = await update({ kind: item.kind, file: item.file, name: t, stem });
      toast(`Renamed: ${LIB_KIND[item.kind].folder}\\${r.item.file}`, 'ok');
    } catch (e) { toast(`Could not rename it: ${e instanceof Error ? e.message : String(e)}`, 'err'); }
  };
  const del = async () => {
    try { await remove({ kind: item.kind, file: item.file }); toast(`${item.file} is in the Recycle Bin`, 'ok'); } catch (e) { toast(`Could not move it to the Recycle Bin: ${e instanceof Error ? e.message : String(e)}`, 'err'); }
  };
  const f = item.from;
  const picked = pick != null && pick < n ? pick : null;
  const pickBytes = picked != null ? item.data.subarray(picked * unit, picked * unit + unit) : null;
  return (
    <div className="lib-show" aria-label={`${item.name} in the library`}>
      <div className="lib-show-head">
        <Icon name={LIB_KIND[item.kind].icon} size={16} />
        {renaming != null
          ? <input className="lib-rename" aria-label="Its name" autoFocus value={renaming} spellCheck={false} onChange={e => setRenaming(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') void rename(renaming); if (e.key === 'Escape') { e.stopPropagation(); setRenaming(null); } }} onBlur={() => void rename(renaming)} />
          : <h2 className="lib-show-name" title={item.name}>{item.name}</h2>}
        <span className="grow" />
        <button className="icon-btn" aria-label="Rename" title="Rename it: its file takes the new name too" onClick={() => { renamed.current = false; setRenaming(item.name); }}><Icon name="pencil" size={14} /></button>
        <button className="icon-btn" aria-label="Show its file" title="Show its file in the file manager" onClick={onReveal}><Icon name="folder" size={14} /></button>
        <button className="icon-btn" aria-label="Move to the Recycle Bin" title="Move its file to the Recycle Bin" onClick={() => setTrash(true)}><Icon name="trash" size={14} /></button>
        <button className="icon-btn" aria-label="Close" title="Close it: the cards take the whole tab" onClick={onClose}><Icon name="x" size={14} /></button>
      </div>
      {trash && <div className="notice small lib-trash" role="alertdialog" aria-label="Move it to the Recycle Bin?">
        <span>Move <b>{item.file}</b> to the Recycle Bin? You can put it back from there.</span>
        <button className="btn small primary" onClick={() => void del()}>Move it</button><button className="btn small" onClick={() => setTrash(false)}>Cancel</button>
      </div>}

      {s ? <>
        <div className="merge-row lib-play-row">
          <button className="btn primary small" onClick={() => onPlay(item, { player, ...(song != null ? { song } : {}) })}><Icon name="play" size={13} />Play in {PLAYER[player]}</button>
          <button className="btn small" onClick={() => onPlay(item, { player: player === 'vice' ? 'deepsid' : 'vice', ...(song != null ? { song } : {}) })}>Play in {PLAYER[player === 'vice' ? 'deepsid' : 'vice']}</button>
          {s.songs > 1 && <label className="lib-song small">Song <select aria-label="Song" value={song ?? s.startSong - 1} onChange={e => setSong(+e.target.value)}>
            {Array.from({ length: Math.min(s.songs, 256) }, (_, i) => <option key={i} value={i}>{i + 1}{i === s.startSong - 1 ? ' (its first)' : ''}</option>)}</select></label>}
        </div>
        <dl className="kv lib-kv">
          <dt>Name</dt><dd>{s.name || '—'}</dd>
          <dt>Author</dt><dd>{s.author || '—'}</dd>
          <dt>Released</dt><dd>{s.released || '—'}</dd>
          <dt>Kind</dt><dd>{s.rsid ? 'RSID: init starts the interrupts that play it' : 'PSID'}{s.songs > 1 ? `, ${s.songs} songs` : ''}</dd>
          <dt>Memory</dt><dd className="mono">${h4(s.location)}–${h4(s.location + s.size - 1)} <span className="muted">({s.size} bytes)</span></dd>
          <dt>Init</dt><dd className="mono">${h4(s.init)}</dd>
          <dt>Play</dt><dd className={s.play ? 'mono' : ''}>{s.play ? `$${h4(s.play)}` : 'none: its interrupts play it'}</dd>
          {item.digi && <><dt>Samples</dt><dd>its {item.digi.nmi ? 'NMI' : 'IRQ'}, {item.digi.hz} a second</dd></>}
        </dl>
      </> : item.kind === 'bitmaps' ? <>
        <div className="lib-tools">
          <span className="small muted">{item.mc ? 'Multicolour' : 'Hires'}, in the colours its file has</span>
          <span className="grow" />
          <label className="gfxv-field small">Zoom <select aria-label="Zoom" value={zoom} onChange={e => setZoom(+e.target.value)}>{[0, 1, 2, 3].map(v => <option key={v} value={v}>{v ? `${v}×` : 'Fit'}</option>)}</select></label>
        </div>
        <div className="lib-big">
          <LibraryThumb item={item} per={1} mc={!!item.mc} colors={LIB_COLORS} scale={zoom} className="lib-thumb lib-big-pic lib-big-bitmap" label={`${item.name}: ${itemWhat(item)}`} />
        </div>
      </> : gfx && <>
        <div className="lib-tools">
          <label className="check"><input type="checkbox" checked={mc} onChange={e => drawn(e.target.checked, colors)} /><span>Multicolor</span></label>
          {(['bg', 'fg', ...(mc ? ['mc1', 'mc2'] : [])] as (keyof LibraryColors)[]).map(k => (
            <label key={k} className="gfxv-field gfxv-color" title={k === 'bg' ? 'Background (00)' : k === 'fg' ? (mc ? (item.kind === 'sprites' ? 'Color 11 ($d026)' : 'Color 11 (colour RAM)') : item.kind === 'sprites' ? 'The sprite\'s colour' : 'Foreground') : k === 'mc1' ? (item.kind === 'sprites' ? 'Color 01 ($d025)' : 'Color 01 ($d022)') : (item.kind === 'sprites' ? 'Color 10 (the sprite\'s colour)' : 'Color 10 ($d023)')}>
              {k.toUpperCase()}<i style={{ background: C64[colors[k]] }} /><select aria-label={`Color ${k}`} value={colors[k]} onChange={e => drawn(mc, { ...colors, [k]: +e.target.value })}>{C64_NAMES.map((nm, i) => <option key={i} value={i}>{nm}</option>)}</select>
            </label>
          ))}
          <label className="gfxv-field small">A row <select aria-label={item.kind === 'chars' ? 'Characters a row' : 'Sprites a row'} value={per} onChange={e => setPer(+e.target.value)}>{PER[item.kind as 'sprites' | 'chars'].map(v => <option key={v} value={v}>{v}</option>)}</select></label>
          <label className="gfxv-field small">Zoom <select aria-label="Zoom" value={zoom} onChange={e => setZoom(+e.target.value)}>{[1, 2, 3, 4, 6].map(v => <option key={v} value={v}>{v}×</option>)}</select></label>
        </div>
        {item.kind === 'sprites' && <SpriteAnimation item={item} mc={mc} colors={colors} from={picked ?? 0} />}
        <div className="lib-big" title={`Click a ${item.kind === 'sprites' ? 'sprite' : 'character'} to see its bytes${item.kind === 'sprites' ? ' and play the animation from it' : ''}`}>
          <LibraryThumb item={item} per={per} mc={mc} colors={colors} scale={zoom} className="lib-thumb lib-big-pic" label={`${item.name}: ${itemWhat(item)}`} onPick={setPick} />
        </div>
        {picked != null && pickBytes && <div className="lib-pick small mono" role="status">
          <b>{item.kind === 'sprites' ? 'Sprite' : 'Char'} ${h2(picked)}</b> <span className="muted">+${h4(picked * unit)}{item.load != null ? ` ($${h4(item.load + picked * unit)})` : ''}</span>
          <div className="lib-pick-bytes">{[...pickBytes].map(h2).join(' ')}</div>
        </div>}
      </>}

      <dl className="kv lib-kv">
        <dt>Taken from</dt><dd>{item.own ? <span className="muted">a file put in the folder by hand</span> : f?.text || '—'}</dd>
        {f?.disk && <><dt>Disk or tape</dt><dd>{f.disk}</dd></>}
        {f?.file && <><dt>File</dt><dd>{f.file}</dd></>}
        {f?.project && <><dt>Project</dt><dd>{f.project}</dd></>}
        {f?.start != null && f.end != null && <><dt>Addresses</dt><dd className="mono">${h4(f.start)}–${h4(f.end - 1)}</dd></>}
        {gfx && <><dt>{item.kind === 'sprites' ? 'Sprites' : 'Characters'}</dt><dd>{n} <span className="muted">({item.data.length} bytes{item.load != null ? `, loads at $${h4(item.load)}` : ''})</span></dd></>}
        {item.kind === 'bitmaps' && (fmt => <><dt>Picture</dt><dd>{fmt ? pictureFormatName(fmt) : '—'}, {item.mc ? 'multicolour' : 'hires'}{item.mc ? <span className="muted"> · background {C64_NAMES[item.data[10000] & 15]}</span> : null}</dd></>)(pictureFormatOf(item.file))}
        <dt>Added</dt><dd>{item.added ? new Date(item.added).toLocaleString() : '—'}</dd>
        <dt>Its file</dt><dd><button type="button" className="linkish mono lib-file" title="Show it in the file manager" onClick={onReveal}>{LIB_KIND[item.kind].folder}\{item.file}</button></dd>
      </dl>
    </div>
  );
}

/** The sprites one after the other, as the program would show them: a frame at a time, `fps` a second, from `from` to
 *  the last (or the frames picked); play and pause. */
function SpriteAnimation({ item, mc, colors, from }: { item: LibraryItem; mc: boolean; colors: LibraryColors; from: number }) {
  const n = itemCount(item);
  const [first, setFirst] = useState(0), [last, setLast] = useState(n - 1);
  const [fps, setFps] = useState(8), [on, setOn] = useState(n > 1), [frame, setFrame] = useState(0);
  useEffect(() => { setFirst(from); setLast(l => Math.max(from, l)); setFrame(from); }, [from]);
  const lo = Math.min(first, n - 1), hi = Math.max(lo, Math.min(last, n - 1));
  useEffect(() => {
    if (!on || hi <= lo) return;
    const t = setInterval(() => setFrame(f => (f < lo || f >= hi ? lo : f + 1)), 1000 / fps);
    return () => clearInterval(t);
  }, [on, fps, lo, hi]);
  const f = Math.min(Math.max(frame, lo), hi);
  const one = useMemo(() => ({ kind: 'sprites' as LibraryKind, data: item.data.subarray(f * 64, f * 64 + 64) }), [item, f]);
  if (n < 2) return null;
  return (
    <div className="lib-anim" aria-label="The sprites as an animation">
      <div className="lib-anim-pic"><LibraryThumb item={one} per={1} mc={mc} colors={colors} scale={4} label={`Sprite ${f} of the animation`} /></div>
      <div className="lib-anim-tools small">
        <button className="btn small" aria-pressed={on} onClick={() => setOn(o => !o)}><Icon name={on ? 'pause' : 'play'} size={12} />{on ? 'Pause' : 'Play'}</button>
        <span className="mono">{f}</span>
        <label>From <input className="mono" type="number" min={0} max={n - 1} value={first} aria-label="First sprite" onChange={e => setFirst(Math.max(0, Math.min(n - 1, Math.round(+e.target.value || 0))))} /></label>
        <label>to <input className="mono" type="number" min={0} max={n - 1} value={last} aria-label="Last sprite" onChange={e => setLast(Math.max(0, Math.min(n - 1, Math.round(+e.target.value || 0))))} /></label>
        <label><select aria-label="Frames a second" value={fps} onChange={e => setFps(+e.target.value)}>{FPS.map(v => <option key={v} value={v}>{v} a second</option>)}</select></label>
      </div>
    </div>
  );
}
