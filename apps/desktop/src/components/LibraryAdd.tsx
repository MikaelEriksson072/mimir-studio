/* Add to library (spec 10.6): a music block, sprites, a charset or a bitmap as a file of the library, under a name that
 * says where it was found. The dialog fills in the block's name and where it was taken from (the disk, the file, the
 * project) and shows the file's name as it changes; a SID gets its author too (its name, author and source go in the
 * .sid). A bitmap becomes a picture of a paint program (the format Settings → General → Library picks, or another): its
 * screen matrix and colour RAM are taken from where they were found in memory, or are one set of colours. */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  flatColors, libraryExt, libraryRange, librarySourceText, libraryStem, picture, pictureData, pictureFormatName, PICTURE_FORMATS_HIRES, PICTURE_FORMATS_MC, PICTURE_INFO, writePicture,
  type Addr, type LibraryColors, type LibraryDigi, type LibraryItem, type LibraryKind, type LibrarySource, type PictureColorsAt, type PictureFormat,
} from '@mimir/core';
import { LIB_KIND, LIB_COLORS, sidInfo, itemWhat } from '../lib/library';
import { C64, C64_NAMES } from '../lib/palette';
import { cx } from '../lib/util';
import { Modal } from './Modal';
import { LibraryThumb } from './LibraryThumb';

/** a bitmap for the library: its bytes, the 64 KB they are in (to take its screen and colour RAM from), where its
 *  colours are found there (multicolour or hires), and the formats Settings picks */
export interface PictureDraft {
  bitmap: Uint8Array;
  /** the bitmap's address, and the memory around it (64 KB, as the C64 has it) */
  at: Addr;
  mem: Uint8Array;
  find: (mc: boolean) => PictureColorsAt;
  formats: { mc: PictureFormat; hires: PictureFormat };
}

/** what is to go in the library: the file's bytes as written (a .sid, raw sprites, a charset with its load address),
 *  the bytes the preview draws (a .sid's whole; sprites and a charset without the load address), its name and source;
 *  a bitmap's file is made by the dialog (`pic`) */
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
  pic?: PictureDraft;
}

/** what the user gave: the name, where it was taken from (the file's name says it), a SID's author, and a bitmap's
 *  picture as its file has it */
export interface LibraryAnswer { name: string; fromText: string; author: string; picture?: { bytes: Uint8Array; format: PictureFormat; mc: boolean } }

const hex4 = (a: Addr) => `$${a.toString(16).padStart(4, '0')}`;
/** "$7f40", "7f40", "0x7f40": the address; nothing: null (one colour); anything else: undefined */
const parseAddr = (s: string): Addr | null | undefined => {
  const t = s.trim().replace(/^(\$|0x)/i, '');
  if (!t) return null;
  return /^[0-9a-f]{1,4}$/i.test(t) && parseInt(t, 16) + 1000 <= 0x10000 ? parseInt(t, 16) : undefined;
};

/** the picture as the dialog has it: where its screen matrix and colour RAM are ('': nowhere, one colour), the
 *  background, the colours used where there is no screen or colour RAM, and the format its file gets */
interface PicState extends LibraryColors { mc: boolean; screen: string; color: string; format: PictureFormat }

const startPic = (p: PictureDraft, mc: boolean, c: LibraryColors): PicState => {
  const f = p.find(mc);
  return { mc, screen: f.screen != null ? hex4(f.screen) : '', color: f.color != null ? hex4(f.color) : '', bg: f.bg ?? c.bg, fg: c.fg, mc1: c.mc1, mc2: c.mc2, format: mc ? p.formats.mc : p.formats.hires };
};

/** what was found, in a sentence */
function foundText(f: PictureColorsAt, mc: boolean): string {
  if (f.by === 'koala' || f.by === 'ocp') return `${PICTURE_INFO[f.by].label}'s layout after the bitmap: the screen at ${hex4(f.screen!)}, colour RAM at ${hex4(f.color!)}, the background ${C64_NAMES[f.bg ?? 0]}.`;
  if (f.by === 'art') return `The screen right after the bitmap, at ${hex4(f.screen!)}, as Art Studio has it.`;
  if (f.by === 'doodle') return `The screen in the 1 KB before the bitmap, at ${hex4(f.screen!)}, as Doodle! has it.`;
  if (f.by === 'vic') return `The screen the VIC shows with the bitmap ($d018), at ${hex4(f.screen!)}${!mc ? '' : f.color != null ? `; colour RAM from the table the program copies to $d800, at ${hex4(f.color)}` : '. Colour RAM is not in memory: 11 is one colour'}.`;
  return 'No screen or colour RAM was found beside it: one set of colours, as the Graphics tab draws it.';
}

function ColorPick({ k, title, value, onChange }: { k: string; title: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="gfxv-field gfxv-color" title={title}>{k}<i style={{ background: C64[value] }} />
      <select aria-label={`Color ${k}`} value={value} onChange={e => onChange(+e.target.value)}>{C64_NAMES.map((nm, i) => <option key={i} value={i}>{nm}</option>)}</select>
    </label>
  );
}

export function LibraryAddModal({ draft, findSame, onAdd, onShow, onClose }: {
  draft: LibraryDraft;
  /** the item of the library with the same bytes (as LibraryItem.data has them), when there is one */
  findSame: (data: Uint8Array) => LibraryItem | null;
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
  const p = draft.pic;
  const [st, setSt] = useState<PicState | null>(() => (p ? startPic(p, !!draft.mc, draft.colors ?? LIB_COLORS) : null));
  const put = (s: Partial<PicState>) => setSt(o => (o ? { ...o, ...s } : o));
  const found = useMemo(() => (p && st ? p.find(st.mc) : null), [p, st?.mc]); // eslint-disable-line react-hooks/exhaustive-deps
  // the picture as it is now: the screen and colour RAM from memory, or one colour
  const scr = st ? parseAddr(st.screen) : null, col = st?.mc ? parseAddr(st.color) : null;
  const pic = useMemo(() => {
    if (!p || !st) return null;
    const flat = flatColors(st.mc, st);
    return picture({ mc: st.mc, bitmap: p.bitmap, screen: scr != null ? p.mem.subarray(scr, scr + 1000) : flat.screen, color: col != null ? p.mem.subarray(col, col + 1000) : flat.color, bg: st.bg });
  }, [p, st, scr, col]);
  const preview = useMemo(() => (pic && st ? { kind: draft.kind, data: pictureData(pic), mc: st.mc, file: `x.${PICTURE_INFO[st.format].ext}` } : { kind: draft.kind, data: draft.data, mc: draft.mc }), [draft, pic, st]);
  const same = useMemo(() => findSame(preview.data), [findSame, preview.data]);
  const file = `${libraryStem(name, { ...draft.from, text: fromText })}.${libraryExt(draft.kind, st?.format)}`;
  const sid = sidInfo(preview);
  const range = libraryRange(draft.from.start, draft.from.end);
  const ok = name.trim().length > 0 && scr !== undefined && col !== undefined;
  const add = () => {
    if (!ok) return;
    onAdd({ name: name.trim(), fromText: fromText.trim(), author: author.trim(), ...(pic && st ? { picture: { bytes: writePicture(st.format, pic), format: st.format, mc: st.mc } } : {}) });
  };
  const enter = (e: React.KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); add(); } };
  return (
    <Modal title="Add to library" onClose={onClose} className="lib-add">
      <div className="modal-body">
        <div className="lib-add-what">
          {draft.kind === 'sid' ? <div className="lib-add-sid mono small">{sid ? <>${sid.location.toString(16).padStart(4, '0')}–${(sid.location + sid.size - 1).toString(16).padStart(4, '0')} · init ${sid.init.toString(16).padStart(4, '0')} · play {sid.play ? `$${sid.play.toString(16).padStart(4, '0')}` : 'none'}</> : null}</div>
            : draft.kind === 'bitmaps' ? <LibraryThumb item={preview} mc={!!preview.mc} colors={LIB_COLORS} per={1} scale={1} max={320} label="The picture as it goes in the library" />
              : <LibraryThumb item={preview} mc={!!draft.mc} colors={draft.colors ?? LIB_COLORS} per={draft.kind === 'chars' ? 32 : 8} count={draft.kind === 'chars' ? 128 : 16} scale={2} max={300} />}
          <span className="muted small">{itemWhat(preview)}{range ? ` from ${range}` : ''}, to the library's {k.folder}</span>
        </div>
        {p && st && <div className="lib-add-pic">
          <div className="lib-add-pic-row">
            <label className="check"><input type="checkbox" checked={st.mc} onChange={e => setSt(startPic(p, e.target.checked, st))} /><span>Multicolor</span></label>
            <label className="gfxv-field small">Saved as <select aria-label="Picture format" value={st.format} onChange={e => put({ format: e.target.value as PictureFormat })}>
              {(st.mc ? PICTURE_FORMATS_MC : PICTURE_FORMATS_HIRES).map(f => <option key={f} value={f}>{pictureFormatName(f)}{f === (st.mc ? p.formats.mc : p.formats.hires) ? ' (Settings)' : ''}</option>)}</select></label>
          </div>
          <div className="lib-add-pic-row">
            <label className="gfxv-field small" title={`The screen matrix: 1000 bytes, ${st.mc ? '%01 the high and %10 the low nibble' : 'set bits the high and clear bits the low nibble'} of each cell. Empty: one colour${st.mc ? ' for each' : ''}`}>Screen
              <input className={cx('mono lib-add-addr', scr === undefined && 'bad')} aria-label="Screen matrix at" value={st.screen} placeholder="none" spellCheck={false} onChange={e => put({ screen: e.target.value })} onKeyDown={enter} /></label>
            {scr == null && (st.mc
              ? <><ColorPick k="01" title="Color 01 (the screen's high nibble)" value={st.mc1} onChange={v => put({ mc1: v })} /><ColorPick k="10" title="Color 10 (the screen's low nibble)" value={st.mc2} onChange={v => put({ mc2: v })} /></>
              : <><ColorPick k="FG" title="Set bits (the screen's high nibble)" value={st.fg} onChange={v => put({ fg: v })} /><ColorPick k="BG" title="Clear bits (the screen's low nibble)" value={st.bg} onChange={v => put({ bg: v })} /></>)}
          </div>
          {st.mc && <div className="lib-add-pic-row">
            <label className="gfxv-field small" title="Colour RAM: 1000 bytes, %11 of each cell (the low nibble). Empty: one colour">Colour RAM
              <input className={cx('mono lib-add-addr', col === undefined && 'bad')} aria-label="Colour RAM at" value={st.color} placeholder="none" spellCheck={false} onChange={e => put({ color: e.target.value })} onKeyDown={enter} /></label>
            {col == null && <ColorPick k="11" title="Color 11 (colour RAM)" value={st.fg} onChange={v => put({ fg: v })} />}
            <ColorPick k="BG" title="Background (00, $d021)" value={st.bg} onChange={v => put({ bg: v })} />
          </div>}
          {found && <p className="muted small lib-add-found">{foundText(found, st.mc)}</p>}
        </div>}
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
