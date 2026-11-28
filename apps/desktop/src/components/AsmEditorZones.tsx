/* What the Assembler draws in an editor's lines (spec 10.7), for each of its editors (the first and the split's): the
 * pictures of a block of sprites, a charset or a bitmap over its .byte lines (lib/asmgfx.ts), which are hidden while the
 * caret is not on one of them, and the list of the project's macros under the line that imports the macro file (10.8).
 * Each is a view zone that keeps the lines free and an overlay widget over it that takes the pointer (the editor's lines
 * lie over a view zone's own nodes). Zones and hidden areas are the editor's own (its view's): another file in it starts
 * with none. */
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type * as Monaco from 'monaco-editor/esm/vs/editor/editor.api';
import { ASM_SOURCE, type Addr, type AnalysisResult, type AsmBlockMark, type AsmCheck, type CodeLibBuilt, type ScriptLang } from '@mimir/core';
import { gfxColsFor, vicMc } from '../lib/gfxlines';
import { asmHiddenRanges, asmPictureHeight, asmPictures, type AsmPicture } from '../lib/asmgfx';
import { AsmPictureZone } from './AsmPictures';
import { AsmMacroZone, macroZoneRows } from './AsmMacroList';

type MonacoNs = typeof Monaco;
type Editor = Monaco.editor.IStandaloneCodeEditor;
/** what Monaco's hidden areas of the pictures' lines are kept under (its folding has its own) */
const PICTURE_LINES = 'mimir.pictures';
const NO_SPRITES: readonly { addr: Addr; n: number }[] = [];
const pathOf = (uri: Monaco.Uri) => (uri.scheme === 'asm' ? uri.path.replace(/^\//, '') : uri.scheme === 'asmx' ? decodeURIComponent(uri.path.replace(/^\//, '')) : null);

/** an editor's zones: the editor they are in, what they were made for, and what takes them away again */
interface Zones { e: Editor | null; key: string; ids: string[]; roots: Root[]; widgets: Monaco.editor.IOverlayWidget[]; subs: Monaco.IDisposable[] }
const noZones = (): Zones => ({ e: null, key: '', ids: [], roots: [], widgets: [], subs: [] });
/** the zones taken out of their editor (one disposed of has nothing to take out), their roots unmounted after this render
 *  (a root is not unmounted while React renders) */
function dropZones(z: Zones) {
  const e = z.e;
  try {
    if (e && z.ids.length) e.changeViewZones(a => { for (const id of z.ids) a.removeZone(id); });
    for (const w of z.widgets) e?.removeOverlayWidget(w);
  } catch { /* the editor is gone */ }
  for (const s of z.subs) s.dispose();
  const roots = z.roots;
  if (roots.length) setTimeout(() => { for (const r of roots) r.unmount(); }, 0);
}

/** what an editor's zones need: the editor (`gen` counts the editors made in its place: one made again draws again),
 *  whether Monaco is there, and the file the editor shows with its text as the check had it */
interface EditorAt { ed: MutableRefObject<Editor | null>; gen: number; monaco: MonacoNs | null; ready: boolean; path: string | null; text: string | undefined }

export interface PictureZonesOpts extends EditorAt {
  /** Settings → General → Show graphics as pictures */
  on: boolean;
  check: AsmCheck | null;
  marks: readonly AsmBlockMark[];
  lang: ScriptLang;
  analysis: AnalysisResult | null;
  onPick: (c: { a: Addr; n: number }, extend: boolean) => void;
  onDraw: (changes: { addr: Addr; value: number }[]) => void;
}

/** The pictures of the blocks of sprites, charsets and bitmaps in an editor's file, as the re-assembler's listing draws
 *  them when Show graphics as pictures is on: a view zone above the lines each stands for, which are hidden while the
 *  caret is not on one of them. */
export function usePictureZones(o: PictureZonesOpts) {
  const { ed, gen, monaco, ready, path, text, on, check, marks, lang, analysis } = o;
  /** the room a picture has (the editor's width, in steps): how many characters and sprites a row */
  const [room, setRoom] = useState(0);
  const cols = gfxColsFor(room || 1e9);
  const pictures = useMemo(() => {
    if (!on || !check || !path || !ASM_SOURCE.test(path) || typeof text !== 'string') return [];
    // (multicolour as the mark says, else as the analysis's VIC evidence says: as the listing draws the block)
    const mc = (m: AsmBlockMark, s: Addr, e: Addr) => m.props.mc ?? (analysis ? vicMc(analysis, m.kind, s, e) : false);
    return asmPictures(check, path, text, [...marks], lang, { mc, cols: { chars: cols.chars, sprite: cols.sprite } });
  }, [on, check, path, text, marks, lang, analysis, cols.chars, cols.sprite]);
  const zones = useRef<Zones>(noZones());
  /** the pictures in the editor, the model and its version they were made for (typed since: Monaco moves what it hides
   *  and the zones with the text, the pictures' line numbers wait for the check of it), the lines hidden */
  const st = useRef<{ list: AsmPicture[]; model: Monaco.editor.ITextModel | null; version: number; hidden: string }>({ list: [], model: null, version: -1, hidden: '' });
  const clear = () => { dropZones(zones.current); zones.current = noZones(); };
  /** the lines of the pictures the caret is not on, hidden (Monaco's own hidden areas, as its folding has them) */
  const hide = () => {
    const e = ed.current, m = e?.getModel(), s = st.current;
    if (!e || !m) return;
    if (s.model === m && m.getVersionId() !== s.version) return;
    const carets = (e.getSelections() ?? []).map(x => x.positionLineNumber);
    const ranges = s.model === m ? asmHiddenRanges(s.list, carets) : [];
    const key = JSON.stringify(ranges);
    if (key === s.hidden) return;
    const opened = s.list.some(p => p.from <= p.to && carets.some(n => n >= p.from && n <= p.to));
    s.hidden = key;
    (e as unknown as { setHiddenAreas(r: Monaco.IRange[], source?: unknown): void }).setHiddenAreas(ranges, PICTURE_LINES);
    // (the caret put on a picture's line: that line in view, with the picture above it when both fit, so what is
    // typed is seen drawn)
    const at = e.getPosition(), p = at && opened ? s.list.find(x => x.from <= x.to && at.lineNumber >= x.from && at.lineNumber <= x.to) : null;
    if (!at || !p) return;
    const lh = monaco ? e.getOption(monaco.editor.EditorOption.lineHeight) : 20, view = e.getLayoutInfo().height, top0 = e.getScrollTop();
    const top = e.getTopForLineNumber(at.lineNumber), zone = e.getTopForLineNumber(p.from) - asmPictureHeight(p);
    if (top >= top0 && top + lh <= top0 + view && zone >= top0) return;
    if (top + lh - zone + lh <= view) e.setScrollTop(Math.max(0, zone - lh)); else e.revealPositionInCenter(at);
  };
  const hideRef = useRef(hide); hideRef.current = hide;
  // (what is clicked and drawn goes where the window says now)
  const pickRef = useRef(o.onPick); pickRef.current = o.onPick;
  const drawRef = useRef(o.onDraw); drawRef.current = o.onDraw;
  useEffect(() => {
    const e = ed.current;
    if (!ready || !e) return;
    const fit = () => { const li = e.getLayoutInfo(); setRoom(Math.max(0, Math.floor((li.contentWidth - li.verticalScrollbarWidth - 90) / 16) * 16)); };
    fit();
    const subs = [
      e.onDidChangeCursorSelection(() => hideRef.current()),
      // (another file: its view starts with nothing hidden and no zones)
      e.onDidChangeModel(() => { st.current = { list: [], model: null, version: -1, hidden: '' }; zones.current.key = ''; }),
      e.onDidLayoutChange(fit),
    ];
    return () => subs.forEach(s => s.dispose());
  }, [ready, gen]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const e = ed.current, m = e?.getModel();
    if (zones.current.e && zones.current.e !== e) clear();
    if (!e || !monaco || !m || !ready || !path || pathOf(m.uri) !== path || !pictures.length) {
      clear();
      st.current = { ...st.current, list: [], model: m ?? null, version: m?.getVersionId() ?? -1 };
      hideRef.current();
      return;
    }
    // (made for the text the check had: typed since, they wait for the check of it; Monaco makes a file's line ends one kind)
    if (m.getValue(monaco.editor.EndOfLinePreference.LF) !== (text ?? '').replace(/\r\n?/g, '\n')) return;
    st.current = { ...st.current, list: pictures, model: m, version: m.getVersionId() };
    const mem = check?.asm.mem ?? new Uint8Array(0x10000), sprites = analysis?.vic.sprites ?? NO_SPRITES;
    const ch = e.getOption(monaco.editor.EditorOption.fontInfo).typicalHalfwidthCharacterWidth;
    /** where a picture starts: under the text of its lines (their indent) */
    const indent = (p: AsmPicture) => {
      const t = m.getLineContent(Math.min(m.getLineCount(), Math.max(1, p.from <= p.to ? p.from : p.after)));
      let col = 0;
      for (const c of t) { if (c === ' ') col++; else if (c === '\t') col += 8 - (col % 8); else break; }
      return Math.round(col * ch);
    };
    const zone = (p: AsmPicture) => <AsmPictureZone p={p} mem={mem} sprites={sprites} onPick={(c, extend) => pickRef.current(c, extend)}
      onOpen={line => { e.setPosition({ lineNumber: line, column: m.getLineFirstNonWhitespaceColumn(line) || 1 }); e.focus(); }}
      onDraw={changes => drawRef.current(changes)} />;
    const key = `${path}\n${pictures.map(p => `${p.after}:${asmPictureHeight(p)}:${indent(p)}`).join(',')}`;
    const z = zones.current;
    if (key === z.key && z.e === e) { pictures.forEach((p, i) => z.roots[i]?.render(zone(p))); hideRef.current(); return; }
    clear();
    const ids: string[] = [], roots: Root[] = [], widgets: Monaco.editor.IOverlayWidget[] = [], subs: Monaco.IDisposable[] = [];
    e.changeViewZones(a => {
      pictures.forEach((p, i) => {
        const dom = document.createElement('div'), left = indent(p);
        dom.className = 'asm-pic-host';
        const place = () => { const li = e.getLayoutInfo(); dom.style.left = `${li.contentLeft + left}px`; dom.style.width = `${Math.max(0, li.contentWidth - li.verticalScrollbarWidth - left)}px`; };
        place();
        const widget: Monaco.editor.IOverlayWidget = { getId: () => `mimir.picture.${i}`, getDomNode: () => dom, getPosition: () => null };
        e.addOverlayWidget(widget);
        widgets.push(widget);
        subs.push(e.onDidLayoutChange(place));
        const root = createRoot(dom);
        root.render(zone(p));
        roots.push(root);
        // the block's bar beside it, as beside its lines
        const margin = document.createElement('div');
        margin.className = 'asm-pic-margin';
        margin.style.setProperty('--bar-left', `${e.getLayoutInfo().decorationsLeft}px`);
        // (shown though the line after it is hidden: Monaco hides a zone above hidden lines)
        ids.push(a.addZone({
          afterLineNumber: p.after, heightInPx: asmPictureHeight(p), domNode: document.createElement('div'), marginDomNode: margin, showInHiddenAreas: true,
          onDomNodeTop: top => { dom.style.top = `${top}px`; }, onComputedHeight: h => { dom.style.height = `${h}px`; },
        }));
      });
    });
    zones.current = { e, key, ids, roots, widgets, subs };
    hideRef.current();
  }, [pictures, ready, path, analysis, gen]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => clear(), []); // eslint-disable-line react-hooks/exhaustive-deps
}

export interface MacroZonesOpts extends EditorAt {
  /** the project's macro file (Project.asm's), and what Mimir builds in it */
  file: string | null;
  built: CodeLibBuilt | null;
  /** the list unfolded in this file, and a click on its line */
  open: boolean;
  onToggle: () => void;
  /** the macro file opened (in the same editor) */
  onOpenFile: () => void;
}

/** The project's macros in a source that imports the macro file: a folded list under each line that imports it, one
 *  line that unfolds (what the user sees is not what the assembler reads). */
export function useMacroZones(o: MacroZonesOpts) {
  const { ed, gen, monaco, ready, path, text, file, built, open } = o;
  const zones = useRef<Zones>(noZones());
  const clear = () => { dropZones(zones.current); zones.current = noZones(); };
  const toggleRef = useRef(o.onToggle); toggleRef.current = o.onToggle;
  const openRef = useRef(o.onOpenFile); openRef.current = o.onOpenFile;
  useEffect(() => {
    const e = ed.current, m = e?.getModel();
    if (zones.current.e && zones.current.e !== e) clear();
    if (!e || !monaco || !m || !file || !built || !ready || !path || path === file || !ASM_SOURCE.test(path) || pathOf(m.uri) !== path) { clear(); return; }
    // the lines that import the file, by its path from this source's folder
    const from = path.includes('/') ? path.slice(0, path.lastIndexOf('/') + 1) : '';
    const at: number[] = [];
    m.getLinesContent().forEach((l, i) => {
      const x = /^\s*(?:#import(?:once)?|\.include)\s+"([^"]+)"/.exec(l);
      if (!x) return;
      const parts: string[] = [];
      for (const s of `${from}${x[1].replace(/\\/g, '/')}`.split('/')) { if (s === '..') parts.pop(); else if (s && s !== '.') parts.push(s); }
      if (parts.join('/') === file) at.push(i + 1);
    });
    const lh = e.getOption(monaco.editor.EditorOption.lineHeight);
    const key = `${path}\n${at.join(',')}\n${open}\n${lh}\n${built.text}`;
    if (key === zones.current.key && zones.current.e === e) return;
    clear();
    if (!at.length) return;
    const ids: string[] = [], roots: Root[] = [], widgets: Monaco.editor.IOverlayWidget[] = [], subs: Monaco.IDisposable[] = [];
    e.changeViewZones(a => {
      at.forEach((line, i) => {
        const dom = document.createElement('div');
        dom.className = 'am-zone-host';
        const place = () => { const li = e.getLayoutInfo(); dom.style.left = `${li.contentLeft}px`; dom.style.width = `${Math.max(0, li.contentWidth - li.verticalScrollbarWidth)}px`; };
        place();
        const widget: Monaco.editor.IOverlayWidget = { getId: () => `mimir.macros.${i}`, getDomNode: () => dom, getPosition: () => null };
        e.addOverlayWidget(widget);
        widgets.push(widget);
        subs.push(e.onDidLayoutChange(place));
        const root = createRoot(dom);
        root.render(<AsmMacroZone built={built} file={file} open={open} lineHeight={lh} onToggle={() => toggleRef.current()} onOpenFile={() => openRef.current()} />);
        roots.push(root);
        ids.push(a.addZone({
          afterLineNumber: line, heightInPx: macroZoneRows(built, open) * lh, domNode: document.createElement('div'),
          onDomNodeTop: top => { dom.style.top = `${top}px`; }, onComputedHeight: h => { dom.style.height = `${h}px`; },
        }));
      });
    });
    zones.current = { e, key, ids, roots, widgets, subs };
  }, [built, file, path, ready, open, text, gen]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => clear(), []); // eslint-disable-line react-hooks/exhaustive-deps
}
