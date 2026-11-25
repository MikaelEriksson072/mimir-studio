/* Insert block (the Assembler, spec 10.7): a block of sprites, a charset, a bitmap, a screen, music or data put in the
 * source where the caret is. Its bytes come from the library, from a file, or are empty .byte lines to fill in; they are
 * written as .byte lines formatted as the kind is drawn, or as a file of the project the source imports. The block's
 * marks (`// @block sprite` … `// @end`) make the project's views show its bytes as what they are; the rest of the
 * program is code. Core asm-blocks.ts writes the lines (asmBlockText). */
import { useEffect, useMemo, useState } from 'react';
import { ASM_BLOCK_INFO, ASM_BLOCK_KINDS, asmBlockBytes, asmBlockText, asmLabel, h4, libraryLabel, parsePsid, pictureFromData, writePicture, type AsmBlockKind, type AsmBlockRequest, type LibraryItem, type ScriptLang } from '@mimir/core';
import type { AsmPickDataResult } from '../../shared/ipc';
import { Icon } from '../lib/icons';
import { LIB_COLORS, libraryOrder } from '../lib/library';
import { cx, errorText, fmtBytes } from '../lib/util';
import { relPath } from '../../shared/projects';
import { useLibrary, type LibraryRef } from '../store/library';
import { LibraryThumb } from './LibraryThumb';
import { Modal } from './Modal';

const kr = typeof window !== 'undefined' ? window.kr : undefined;

/** a block to put in the source: its lines (the label's from 0), and the file of the project it imports, to write first */
export interface AsmBlockInsert { text: string; labelLine: number; file: { path: string; bytes: Uint8Array } | null; what: string }

export interface AsmBlockDialogProps {
  lang: ScriptLang;
  /** the project's folder, the source the block goes in (its path in the folder), the folder's files */
  dir: string;
  source: string;
  paths: ReadonlySet<string>;
  /** the program's names (a new label is another) */
  names: ReadonlySet<string>;
  /** where to start: a kind, a library item */
  kind?: AsmBlockKind;
  lib?: LibraryRef | null;
  onInsert: (b: AsmBlockInsert) => void;
  onClose: () => void;
}

type From = 'library' | 'file' | 'empty';
/** how many of a kind an empty block has, at first */
const EMPTY_COUNT: Record<AsmBlockKind, number> = { sprite: 1, charset: 128, bitmap: 1, screen: 1, music: 0, data: 16 };
const KIND_ICON: Record<AsmBlockKind, 'sprite' | 'grid' | 'image' | 'screen' | 'music' | 'list'> = { sprite: 'sprite', charset: 'grid', bitmap: 'image', screen: 'screen', music: 'music', data: 'list' };

const dirOf = (p: string) => { const i = p.lastIndexOf('/'); return i < 0 ? '' : p.slice(0, i); };
const parseAddr = (s: string): number | null => {
  const t = s.trim().replace(/^\$|^0x/i, '');
  return /^[0-9a-f]{1,4}$/i.test(t) ? parseInt(t, 16) : null;
};

export function AsmBlockDialog(p: AsmBlockDialogProps) {
  const { listing, load } = useLibrary();
  useEffect(() => { if (!listing) void load(); }, [listing, load]);
  const libItems = useMemo(() => libraryOrder(listing?.items ?? []), [listing]);
  const startItem = p.lib ? libItems.find(i => i.kind === p.lib!.kind && i.file === p.lib!.file) ?? null : null;
  const [kind, setKindState] = useState<AsmBlockKind>(p.kind ?? (p.lib ? (ASM_BLOCK_KINDS.find(k => ASM_BLOCK_INFO[k].library === p.lib!.kind) ?? 'sprite') : 'sprite'));
  const info = ASM_BLOCK_INFO[kind];
  const ofKind = useMemo(() => libItems.filter(i => i.kind === info.library), [libItems, info.library]);
  const [from, setFrom] = useState<From>(p.lib ? 'library' : 'empty');
  const [libSel, setLibSel] = useState<LibraryItem | null>(startItem);
  useEffect(() => { if (!libSel && startItem) setLibSel(startItem); }, [startItem]); // eslint-disable-line react-hooks/exhaustive-deps
  const [picked, setPicked] = useState<AsmPickDataResult | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);
  const [count, setCount] = useState(String(EMPTY_COUNT[kind]));
  const [name, setName] = useState('');
  const [named, setNamed] = useState(false);
  const [mc, setMc] = useState<boolean | null>(null);
  const [as, setAs] = useState<'bytes' | 'file'>('bytes');
  const [where, setWhere] = useState<'caret' | 'address'>('caret');
  const [addr, setAddr] = useState('');

  const setKind = (k: AsmBlockKind) => {
    setKindState(k); setLibSel(null); setPicked(null); setPickError(null); setCount(String(EMPTY_COUNT[k])); setMc(null);
    setFrom(f => (f === 'library' && !ASM_BLOCK_INFO[k].library ? 'empty' : f === 'empty' && k === 'music' ? 'library' : f));
    setAs(k === 'bitmap' || k === 'music' ? 'file' : 'bytes');
  };
  useEffect(() => { if (p.lib) setAs(kind === 'bitmap' || kind === 'music' ? 'file' : 'bytes'); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** the block's bytes, what they are, and where a file of them is (or why there are none yet) */
  const src = useMemo((): { bytes: Uint8Array; picture?: boolean; mc?: boolean; label: string; inside?: { path: string; offset: number }; fileName?: string; what: string } | { problem: string } | null => {
    if (from === 'library') {
      if (!libSel) return null;
      return { bytes: libSel.data, picture: kind === 'bitmap', mc: libSel.mc, label: libraryLabel(libSel.name), fileName: libSel.file, what: `${libSel.name} from the library` };
    }
    if (from === 'file') {
      if (!picked) return null;
      const r = asmBlockBytes(kind, picked.name, picked.bytes);
      if ('problem' in r) return r;
      // a file in the project's folder is imported where it is (a picture only as a Koala file, or raw)
      const inPlace = picked.inside && (kind !== 'bitmap' || !r.picture || r.koala);
      return { bytes: r.bytes, picture: r.picture, mc: r.mc, label: asmLabel(picked.name.replace(/\.[^.]*$/, '')), fileName: picked.name, ...(inPlace ? { inside: { path: picked.inside!, offset: r.offset } } : {}), what: picked.name };
    }
    const n = Math.max(1, Math.min(kind === 'charset' ? 256 : kind === 'sprite' ? 256 : 0x10000, Number(count) || 0));
    if (kind === 'music') return null;
    const len = kind === 'sprite' ? n * 64 : kind === 'charset' ? n * 8 : kind === 'bitmap' ? 8000 : kind === 'screen' ? 1000 : n;
    return { bytes: new Uint8Array(len).fill(kind === 'screen' ? 0x20 : 0), label: kind === 'sprite' ? 'sprite' : kind === 'charset' ? 'charset' : kind === 'bitmap' ? 'bitmap' : kind === 'screen' ? 'screen' : 'data', what: 'empty' };
  }, [from, libSel, picked, kind, count]);
  const ok = src && !('problem' in src) ? src : null;
  const sid = useMemo(() => { if (kind !== 'music' || !ok) return null; try { return parsePsid(ok.bytes); } catch { return null; } }, [kind, ok]);

  // the label: the source's own name until one is typed, another than the program's
  const unique = (base: string) => { let n = base, i = 2; while (p.names.has(n)) n = `${base}_${i++}`; return n; };
  useEffect(() => { if (!named) setName(ok ? unique(ok.label) : ''); }, [ok?.label]); // eslint-disable-line react-hooks/exhaustive-deps
  const drawMc = mc ?? ok?.mc ?? false;
  const label = name.trim();
  const labelProblem = !label ? 'a block needs a name' : asmLabel(label) !== label ? 'letters, digits and _ only, not a digit first or a mnemonic' : p.names.has(label) ? 'the program has that name already' : null;
  const at = where === 'address' ? parseAddr(addr) : null;
  const addrProblem = where === 'address' && kind !== 'music' ? (at == null ? 'an address, $0000-$ffff' : ok && at + ok.bytes.length > 0x10000 ? `${fmtBytes(ok.bytes.length)} from $${h4(at)} go past $ffff` : null) : null;
  const fileOnly = from !== 'empty';
  const asFile = as === 'file' && fileOnly;

  /** the file of the project the block imports: one there already, or a new one (a copy) beside the source */
  const filePlan = useMemo((): { path: string; bytes: Uint8Array | null; offset: number } | null => {
    if (!ok || !asFile) return null;
    if (ok.inside) return { path: ok.inside.path, bytes: null, offset: ok.inside.offset };
    const base = asmLabel(label || ok.label);
    const koala = kind === 'bitmap' && ok.picture && drawMc;
    const ext = koala ? 'kla' : info.ext, data = koala ? writePicture('koala', pictureFromData(ok.bytes, true)) : ok.bytes;
    const folder = [dirOf(p.source), info.folder].filter(Boolean).join('/');
    let path = `${folder}/${base}.${ext}`, i = 2;
    while (p.paths.has(path)) path = `${folder}/${base}_${i++}.${ext}`;
    return { path, bytes: data, offset: koala ? 2 : 0 };
  }, [ok, asFile, label, kind, drawMc, info, p.source, p.paths]);

  const req = useMemo((): AsmBlockRequest | null => {
    if (!ok || !label) return null;
    return {
      kind, lang: p.lang, name: label, bytes: ok.bytes, picture: !!ok.picture, mc: info.mc ? drawMc : null, at: kind === 'music' ? null : at,
      file: filePlan ? { path: relPath(dirOf(p.source), filePlan.path), offset: filePlan.offset } : null,
    };
  }, [ok, label, kind, p.lang, info.mc, drawMc, at, filePlan, p.source]);
  const text = useMemo(() => { if (!req) return null; try { return asmBlockText(req); } catch (e) { return { problem: errorText(e) }; } }, [req]);
  const lines = text && 'text' in text ? text.text.split('\n').length - 1 : 0;
  const problem = (src && 'problem' in src ? src.problem : null) ?? (text && 'problem' in text ? text.problem : null) ?? labelProblem ?? addrProblem;
  const ready = !!text && 'text' in text && !problem;

  const pick = async () => {
    setPickError(null);
    try { const r = await kr?.assemblerPickData({ dir: p.dir, kind }); if (r) { setPicked(r); setFrom('file'); } }
    catch (e) { setPickError(errorText(e)); }
  };
  const insert = () => {
    if (!ready || !text || !('text' in text)) return;
    p.onInsert({ text: text.text, labelLine: text.labelLine, file: filePlan?.bytes ? { path: filePlan.path, bytes: filePlan.bytes } : null, what: `${info.label.toLowerCase()} ${label}` });
  };

  return (
    <Modal title="Insert block" onClose={p.onClose} className="asm-block" wide>
      <div className="modal-body">
        <div className="seg wide ab-kinds" role="radiogroup" aria-label="Kind of block">
          {ASM_BLOCK_KINDS.map(k => (
            <button key={k} role="radio" aria-checked={kind === k} className={cx(kind === k && 'on')} onClick={() => setKind(k)} title={KIND_TITLE[k]}>
              <Icon name={KIND_ICON[k]} size={13} />{ASM_BLOCK_INFO[k].label}</button>
          ))}
        </div>
        <div className="ab-row" role="radiogroup" aria-label="Its bytes">
          <span className="ab-head">Its bytes</span>
          {info.library && <label className="check"><input type="radio" name="ab-from" checked={from === 'library'} onChange={() => setFrom('library')} /><span>From the library</span></label>}
          <label className="check"><input type="radio" name="ab-from" checked={from === 'file'} onChange={() => { setFrom('file'); if (!picked) void pick(); }} /><span>From a file…</span></label>
          {kind !== 'music' && <label className="check"><input type="radio" name="ab-from" checked={from === 'empty'} onChange={() => setFrom('empty')} /><span>Empty .byte lines to fill in</span></label>}
        </div>
        {from === 'library' && <div className="ab-lib" role="listbox" aria-label="The library's">
          {!ofKind.length ? <p className="muted small ab-none">{listing ? `The library has no ${LIB_WORD[kind]} yet: add some from a project's blocks (Add to library), or put files in its folder.` : 'Reading the library…'}</p>
            : ofKind.map(i => (
              <div key={i.file} role="option" aria-selected={libSel?.file === i.file} className={cx('lib-row', libSel?.file === i.file && 'on')} onClick={() => setLibSel(i)} onDoubleClick={() => { setLibSel(i); }} title={i.file}>
                <div className="lib-row-pic">{i.kind === 'sid' ? <Icon name="music" size={18} />
                  : <LibraryThumb item={i} mc={!!i.mc} colors={i.colors ?? LIB_COLORS} per={i.kind === 'chars' ? 8 : i.kind === 'bitmaps' ? 1 : 2} count={i.kind === 'chars' ? 16 : 2} scale={1} max={48} />}</div>
                <div className="lib-row-meta"><div className="lib-row-name">{i.name}</div><div className="muted small">{fmtBytes(i.data.length)}{i.mc ? ' · multicolour' : ''}</div></div>
              </div>
            ))}
        </div>}
        {from === 'file' && <div className="ab-row">
          <button className="btn small" onClick={() => void pick()}><Icon name="folder" size={13} />{picked ? 'Another file…' : 'Choose a file…'}</button>
          {picked && <span className="small"><span className="mono">{picked.inside ?? picked.name}</span> <span className="muted">· {fmtBytes(picked.bytes.length)}{picked.inside ? ' · in the project' : ''}</span></span>}
          {pickError && <span className="small err-text">{pickError}</span>}
        </div>}
        {from === 'empty' && (kind === 'sprite' || kind === 'charset' || kind === 'data') && <div className="ab-row">
          <label className="gfxv-field small">{kind === 'sprite' ? 'Sprites' : kind === 'charset' ? 'Chars' : 'Bytes'}
            <input className="mono ab-num" aria-label="How many" value={count} spellCheck={false} onChange={e => setCount(e.target.value.replace(/[^\d]/g, ''))} /></label>
        </div>}
        {ok && kind !== 'music' && <div className="ab-what">
          {(kind === 'sprite' || kind === 'charset' || (kind === 'bitmap' && ok.picture)) && ok.bytes.some(v => v) && <LibraryThumb item={{ kind: kind === 'sprite' ? 'sprites' : kind === 'charset' ? 'chars' : 'bitmaps', data: ok.bytes }} mc={drawMc} colors={libSel?.colors ?? LIB_COLORS}
            per={kind === 'charset' ? 32 : kind === 'bitmap' ? 1 : 8} count={kind === 'charset' ? 128 : 16} scale={kind === 'bitmap' ? 1 : 2} max={kind === 'bitmap' ? 240 : 300} />}
          <span className="muted small">{blockWhat(kind, ok.bytes.length, !!ok.picture)}</span>
        </div>}
        {sid && <p className="small ab-sid mono">{sid.name || '(no name)'}{sid.author && sid.author !== '<?>' ? ` · ${sid.author}` : ''} · ${h4(sid.location)}-${h4(sid.location + sid.size - 1)} · init ${h4(sid.init)}{sid.play ? ` · play $${h4(sid.play)}` : ' · no play (it plays from its interrupt)'}</p>}
        <div className="ab-grid">
          <label className="field"><span>Name (its label)</span><input aria-label="Name" className={cx('mono', labelProblem && label && 'bad')} value={name} spellCheck={false} onChange={e => { setName(e.target.value); setNamed(true); }} onKeyDown={e => { if (e.key === 'Enter') insert(); }} /></label>
          {info.mc && <label className="check ab-mc"><input type="checkbox" checked={drawMc} onChange={e => setMc(e.target.checked)} /><span>Multicolour</span></label>}
        </div>
        <div className="ab-row" role="radiogroup" aria-label="Written as">
          <span className="ab-head">Written as</span>
          <label className="check"><input type="radio" name="ab-as" checked={!asFile} onChange={() => setAs('bytes')} /><span>.byte lines in the source</span></label>
          <label className={cx('check', !fileOnly && 'muted')} title={fileOnly ? '' : 'Empty bytes are written in the source, to fill in'}><input type="radio" name="ab-as" disabled={!fileOnly} checked={asFile} onChange={() => setAs('file')} />
            <span>A file of the project, {p.lang === '64tass' ? '.binary' : kind === 'music' ? 'LoadSid' : '.import binary'}</span></label>
        </div>
        {kind === 'music'
          ? <p className="muted small">Music goes where it is played from{sid ? `: $${h4(sid.location)}` : ''}, a <span className="mono">* =</span> there; the code after it goes on after the music.</p>
          : <div className="ab-row" role="radiogroup" aria-label="Where">
            <span className="ab-head">Where</span>
            <label className="check"><input type="radio" name="ab-where" checked={where === 'caret'} onChange={() => setWhere('caret')} /><span>At the caret{info.align > 1 ? `, aligned to $${info.align.toString(16)}` : ''}</span></label>
            <label className="check"><input type="radio" name="ab-where" checked={where === 'address'} onChange={() => setWhere('address')} /><span>At</span></label>
            <input className={cx('mono ab-num', addrProblem && where === 'address' && 'bad')} aria-label="Address" value={addr} placeholder={kind === 'bitmap' ? '$4000' : kind === 'screen' ? '$0400' : '$2000'} spellCheck={false} onFocus={() => setWhere('address')} onChange={e => { setAddr(e.target.value); setWhere('address'); }} />
          </div>}
        {filePlan && <p className="small"><span className="muted">{filePlan.bytes ? 'A copy goes in' : 'It imports'}</span> <span className="mono">{filePlan.path}</span>{filePlan.offset ? <span className="muted"> (from byte {filePlan.offset}, after its load address)</span> : null}</p>}
        {text && 'text' in text && <div className="ab-preview">
          <div className="muted small">{lines} line{lines === 1 ? '' : 's'} go in {p.source} above the caret's line:</div>
          <pre className="mono small" aria-label="The lines">{text.text.split('\n').slice(0, 14).join('\n')}{lines > 14 ? `\n… ${lines - 14} more` : ''}</pre>
        </div>}
        {problem && <p className="small warn-text" role="alert">{problem}</p>}
      </div>
      <div className="modal-foot">
        <span className="muted small grow">Graphics and Memory show its bytes as {LIB_WORD[kind]}; the rest of the program is code.</span>
        <button className="btn" onClick={p.onClose}>Cancel</button>
        <button className="btn primary" disabled={!ready} onClick={insert}>Insert</button>
      </div>
    </Modal>
  );
}

const KIND_TITLE: Record<AsmBlockKind, string> = {
  sprite: 'Sprites: 64 bytes each, 21 rows of 3 bytes, aligned to 64 where the VIC can see them',
  charset: 'A charset: 8 bytes a char, aligned to 2 KB',
  bitmap: 'A bitmap of 8000 bytes, aligned to 8 KB; a picture\'s screen and colours with it',
  screen: 'A screen: 1000 bytes, 40 a row, aligned to 1 KB',
  music: 'SID music, at the address it is played from, with its init and play',
  data: 'Data: any bytes',
};
const LIB_WORD: Record<AsmBlockKind, string> = { sprite: 'sprites', charset: 'charsets', bitmap: 'bitmaps', screen: 'a screen', music: 'music', data: 'data' };

function blockWhat(kind: AsmBlockKind, n: number, picture: boolean): string {
  switch (kind) {
    case 'sprite': return `${Math.ceil(n / 64)} sprite${n > 64 ? 's' : ''}, ${n} bytes`;
    case 'charset': return `${n >> 3} char${n === 8 ? '' : 's'}, ${n} bytes`;
    case 'bitmap': return picture ? 'a picture: the bitmap (8000 bytes), its screen and colours, and its background' : 'a bitmap, 8000 bytes';
    case 'screen': return `${n} bytes`;
    default: return `${n} byte${n === 1 ? '' : 's'}`;
  }
}
