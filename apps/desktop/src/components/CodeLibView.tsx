/* The macro and code libraries in the side panel (spec 10.8): the macros and the pieces of code the user keeps for every
 * Assembler project, a library each, in alphabetical order (a group a letter, the letters above the list go to theirs),
 * each with its colour, its description and when it was made. The search looks through names, descriptions and the
 * code; a colour above the list shows only the items of that colour. A click opens an item (its whole description,
 * its code, where it came from), a double-click puts it in the source where the Assembler's caret is: a macro's call
 * when the project defines it, else its definition; a piece of code as it is. Lines selected in the Assembler become
 * an item with right-click → Add to the macro library… (or the code library), or the + here.
 *
 * There are files, and macros in them: a file of the macro library holds one macro or several (irq_lib.asm), any file
 * takes more. A file of several macros is a folder in the list, under its name's letter (irq_lib under I): a click
 * opens it, and in it what can be done with the file (use it in the project, add to it, export it, …) and its macros
 * A–Ö. A macro alone in its file is a line of its own, its file beside it when the file is not named after it. A search
 * opens the folders it finds something in. Files from anywhere are put in a library (the import button), and macros
 * exported to a file or to a file of the library (the export dialog). */
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  CODE_LIB_LETTERS, codeLibGroups, codeLibHit, codeLibMacroEntries, codeLibMacros, codeLibMatches, codeLibNeeds, codeLibOrder, codeLibSignature, isBookmarkColor, LANG_TITLE,
  type AsmMacroFile, type CodeLibBuilt, type CodeLibEntry, type CodeLibWhy, type CodeLibItem, type CodeLibKind, type CodeLibMacro, type ScriptLang,
} from '@mimir/core';
import type { MenuItem } from '../lib/types';
import { Icon } from '../lib/icons';
import { cx, errorText } from '../lib/util';
import { useAsmLink, type AsmMacroDefined } from '../store/asmlink';
import { codeLibExportKey, codeLibFolder, sameCodeLib, useCodeLib, type CodeLibRef } from '../store/codelib';
import { bookmarkCss } from './Bookmarks';

const kr = typeof window !== 'undefined' ? window.kr : undefined;

/** a time as the lists show it: 2026-11-26 21:14 (`day`: the date only) */
export function codeLibTime(ms: number, day = false): string {
  const d = new Date(ms), p = (n: number) => String(n).padStart(2, '0');
  const date = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  return day ? date : `${date} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
/** the libraries' names, one and many */
export const CODE_LIB_TITLE: Record<CodeLibKind, { one: string; many: string; lib: string }> = {
  macro: { one: 'macro', many: 'macros', lib: 'macro library' }, code: { one: 'piece of code', many: 'pieces of code', lib: 'code library' },
};
/** the macro an item of the macro library defines (its first) */
export const itemMacro = (i: Pick<CodeLibItem, 'kind' | 'code' | 'lang'>): CodeLibMacro | null => (i.kind === 'macro' ? codeLibMacros(i.code, i.lang)[0] ?? null : null);
const clVar = (c?: string) => (c && isBookmarkColor(c) ? ({ '--cl': bookmarkCss(c) }) as CSSProperties : undefined);
const refOf = (e: CodeLibEntry): CodeLibRef => ({ kind: e.kind, file: e.file, ...(e.macro ? { macro: e.macro } : {}) });
const shortPath = (p: string) => (p.length > 46 ? `…${p.slice(-45)}` : p);
const nMacros = (n: number) => `${n} macro${n === 1 ? '' : 's'}`;

/** what an item is put in the source as: a macro's call, its definition (`code`; with the macros of its file it
 *  uses), or a file's import line */
export type CodeLibInsert = 'code' | 'call' | 'import';

export interface CodeLibViewProps {
  desktop: boolean;
  /** the Assembler project's assembler (null: no Assembler project: nothing to put the code in) */
  lang: ScriptLang | null;
  /** an item put in the source where the Assembler's caret is (each macro of a file an entry of its own) */
  onInsert: (item: CodeLibEntry, how: CodeLibInsert) => void;
  /** a new item, of the lines selected in the Assembler (the dialog); `into`: the file it goes in */
  onNew: (kind: CodeLibKind, into?: string) => void;
  onMenu: (x: number, y: number, items: MenuItem[]) => void;
  onCopy: (text: string, what: string) => void;
  toast: (msg: string, kind?: 'info' | 'ok' | 'warn' | 'err') => void;
  /** the project's macro file (an Assembler project's): what the project keeps of it, where a new one goes (beside the
   *  main source), a change of it, its file opened */
  project?: { macros: AsmMacroFile | null; defaultFile: string; onChange: (label: string, m: AsmMacroFile | null) => void; onOpen: (file: string) => void;
    /** a file imported from outside the folder whose macros the macro file has: its import lines taken out */
    onDropImport: (key: string) => void };
}

/** what the project's macro file does with a macro: it is added to it, or in it as the code calls it or another uses it */
/** what the project's macro file does with a macro's file: it is used (`why`: added, a macro of it called, used by
 *  another file), the macro is in it, or the project defines the macro itself */
interface FileMark { file: string; lib: string; count: number; added: boolean; why: CodeLibWhy | null; inIt: boolean; own: boolean; onUse: () => void; onStop: () => void }
/** a line of the list: a macro alone in its file (or a piece of code), or a file of several macros as a folder (its
 *  macros A–Ö: those the search finds) */
interface ListRow { name: string; file: string; entry?: CodeLibEntry; folder?: { item: CodeLibItem; macros: CodeLibEntry[] } }

export function CodeLibView({ desktop, lang, onInsert, onNew, onMenu, onCopy, toast, project }: CodeLibViewProps) {
  const { listing, loading, error, kind, q, color, open, unfolded, set, load, remove, importFiles, exportMacros } = useCodeLib();
  const defined = useAsmLink(s => s.macroDefined);
  // (read when the view is shown: the folders may have changed outside Mimir)
  useEffect(() => { void load(); }, [load]);
  const all = useMemo(() => listing?.items ?? [], [listing]);
  const ofKind = useMemo(() => all.filter(i => i.kind === kind), [all, kind]);
  // every macro on a line of its own (each file's, one or several), a piece of code its file
  const entries = useMemo(() => [...codeLibMacroEntries(all), ...all.filter(i => i.kind === 'code')], [all]);
  // the macro library's files of several macros: a folder each in the list
  const folders = useMemo(() => all.filter(codeLibFolder), [all]);
  const filtering = !!q.trim() || !!color;
  const colorOk = (c?: string) => !color || (c ?? '') === color;
  const entryOk = (e: CodeLibEntry) => codeLibMatches(e, q) && colorOk(e.color);
  const count = (k: CodeLibKind) => entries.filter(e => e.kind === k && (!filtering || entryOk(e))).length;
  // what the list shows, A–Ö: the macros alone in their files and the folders (under their names' letters), each
  // folder with its macros A–Ö; a search shows the folders it finds a macro in (or its name: all its macros)
  const rows = useMemo(() => {
    const out: ListRow[] = [], inFolder = new Map<string, CodeLibEntry[]>(folders.map(f => [f.file, []]));
    for (const e of entries) {
      if (e.kind !== kind) continue;
      const of = e.kind === 'macro' ? inFolder.get(e.file) : undefined;
      if (of) of.push(e); else if (!filtering || entryOk(e)) out.push({ name: e.name, file: e.file, entry: e });
    }
    if (kind === 'macro') for (const f of folders) {
      const ms = inFolder.get(f.file)!;
      const named = !!q.trim() && codeLibMatches({ name: f.name, description: f.description, code: '', lang: f.lang }, q);
      const hits = filtering ? ms.filter(e => (named || codeLibMatches(e, q)) && colorOk(e.color)) : ms;
      if (!filtering || hits.length) out.push({ name: f.name, file: f.file, folder: { item: f, macros: codeLibOrder(hits) } });
    }
    return out;
  }, [entries, folders, kind, q, color]); // eslint-disable-line react-hooks/exhaustive-deps
  const groups = useMemo(() => codeLibGroups(rows), [rows]);
  /** a folder open: unfolded by a click, or while a search shows what it finds in it */
  const isUnfolded = (f: CodeLibItem) => filtering || unfolded.includes(f.file);
  const fold = (f: CodeLibItem) => set({ unfolded: unfolded.includes(f.file) ? unfolded.filter(u => u !== f.file) : [...unfolded, f.file] });
  // the colours the library's items have, in the order the picker has them
  const colors = useMemo(() => [...new Set(entries.filter(e => e.kind === kind).map(i => i.color ?? ''))].sort((a, b) => (a ? 1 : 0) - (b ? 1 : 0) || a.localeCompare(b)), [entries, kind]);
  const letters = new Set(groups.map(g => g.letter));
  const groupRef = useRef<Record<string, HTMLDivElement | null>>({});
  const listRef = useRef<HTMLDivElement | null>(null);
  const openRef = useRef<HTMLDivElement | null>(null);
  const search = useRef<HTMLInputElement | null>(null);
  const focusTick = useCodeLibFocus();
  useEffect(() => { if (focusTick) { search.current?.focus(); search.current?.select(); } }, [focusTick]);
  // an item opened elsewhere (one just saved) is scrolled into view
  useEffect(() => { openRef.current?.scrollIntoView?.({ block: 'nearest' }); }, [open, listing]);
  // (the list is the groups' offset parent)
  const jump = (l: string) => { const g = groupRef.current[l]; if (g && listRef.current) listRef.current.scrollTop = g.offsetTop; };
  // Export again over a file changed since: asked here
  const [overwrite, setOverwrite] = useState<{ file: string; path: string } | null>(null);

  /** what a double-click does: a macro the project defines is called, one it does not is put in; code as it is */
  const primary = (i: CodeLibEntry): 'code' | 'call' => { const m = itemMacro(i); return m && defined(m.name) ? 'call' : 'code'; };
  const reveal = (ref?: { kind: CodeLibKind; file?: string }) => { kr?.codelibReveal(ref ?? { kind }).catch(e => toast(`Could not open the folder: ${errorText(e)}`, 'err')); };
  /** a macro's file */
  const fileOf = (e: CodeLibEntry) => (e.macro ? all.find(i => i.kind === e.kind && i.file === e.file) ?? null : null);
  /** a macro edited as a macro (its name, its code, the file it is in); a file without macros (or a piece of code) as
   *  its file */
  const edit = (i: CodeLibEntry) => {
    const f = fileOf(i), s = f?.macros?.find(m => m.name === i.macro);
    // (its own colour: in a file of one macro the file's)
    const own = f && s ? (f.macros!.length === 1 && !f.collection ? f.color : s.color) ?? '' : undefined;
    set({ editing: { kind: i.kind, lang: i.lang, code: i.code, name: i.name, ...(i.from ? { from: i.from } : {}), was: refOf(i), ...(f ? { into: { file: f.file }, color: own } : {}) } });
  };
  /** a file's own edit: its name, its description and colour, its whole code */
  const editFile = (f: CodeLibItem) => set({ editing: { kind: f.kind, lang: f.lang, code: f.code, name: f.name, was: { kind: f.kind, file: f.file } } });
  const trash = (i: CodeLibEntry) => {
    const f = fileOf(i), last = !i.macro || (f?.macros?.length ?? 0) <= 1;
    return remove(refOf(i)).then(
      () => toast(last ? `${i.file} is in the Recycle Bin (${listing?.folders[i.kind] ?? CODE_LIB_TITLE[i.kind].lib})` : `${i.name} is out of ${i.file} (and in the Recycle Bin as ${i.name}.asm)`, 'ok'),
      e => toast(`Could not move it to the Recycle Bin: ${errorText(e)}`, 'err'));
  };
  const trashFile = (f: CodeLibItem) => remove({ kind: f.kind, file: f.file }).then(() => toast(`${f.file} is in the Recycle Bin`, 'ok'), e => toast(`Could not move it to the Recycle Bin: ${errorText(e)}`, 'err'));
  /** its library file imported by the source as it is, in place of the project's macro file */
  const importDirectly = (f: CodeLibItem): MenuItem[] => (lang === f.lang ? [{ label: `Import ${f.file} directly (${lang === '64tass' ? '.include' : '#import'} its library file)`, icon: 'play' as const, run: () => onInsert(f, 'import') }] : []);
  const exportAgain = (c: CodeLibItem, force = false) => {
    setOverwrite(null);
    exportMacros({ macros: [{ kind: c.kind, file: c.file }], to: 'again', lines: false, force }).then(r => {
      if (r.changed && r.path) { setOverwrite({ file: c.file, path: r.path }); toast(`${r.path} was changed since Mimir wrote or read it: overwrite it?`, 'warn'); return; }
      toast(`Exported ${c.file} to ${r.path} (${nMacros(r.count)})`, 'ok');
    }, e => toast(`It was not exported: ${errorText(e)}`, 'err'));
  };
  const insertMenu = (i: CodeLibEntry): MenuItem[] => {
    const m = itemMacro(i);
    if (!m) return [{ label: 'Insert in the source', icon: 'play' as const, run: () => onInsert(i, 'code') }];
    return [{ label: `Insert the call: ${codeLibSignature(m, i.lang)}`, icon: 'play' as const, run: () => onInsert(i, 'call') }, { label: 'Insert its definition', run: () => onInsert(i, 'code') }];
  };
  const menu = (i: CodeLibEntry, x: number, y: number) => {
    const f = fileOf(i), many = (f?.macros?.length ?? 0) > 1;
    onMenu(x, y, [
      { header: i.macro && i.file !== `${i.name}.asm` ? `${i.name} · in ${i.file}` : i.name },
      ...insertMenu(i),
      { label: 'Copy the code', icon: 'copy', run: () => onCopy(i.code, `Copied ${i.name}`) },
      { sep: true },
      { label: 'Edit…', icon: 'pencil', run: () => edit(i) },
      ...(i.kind === 'macro' ? [{ label: 'Export…', icon: 'upload' as const, run: () => set({ exporting: [refOf(i)] }) }] : []),
      ...(f ? importDirectly(f) : []),
      { label: 'Show it in the folder', icon: 'folder', run: () => reveal({ kind: i.kind, file: i.file }) },
      { sep: true },
      { label: many ? `Take it out of ${i.file} (to the Recycle Bin)` : 'Move to the Recycle Bin', icon: 'trash', run: () => void trash(i) },
    ]);
  };
  const fileMenu = (f: CodeLibItem, x: number, y: number) => { const was = listing?.exports[codeLibExportKey(f)]; onMenu(x, y, [
    { header: `${f.file} · ${nMacros(f.macros?.length ?? 0)}` },
    ...importDirectly(f),
    { label: 'Add a macro… (the lines selected in the Assembler)', icon: 'plus', run: () => onNew('macro', f.file) },
    { label: 'Export… (the file, or some of its macros)', icon: 'upload', run: () => set({ exporting: [{ kind: 'macro', file: f.file }] }) },
    ...(was ? [{ label: `Export it again (to ${shortPath(was.path)}, where it was exported to or read from)`, icon: 'refresh' as const, run: () => exportAgain(f) }] : []),
    { label: 'Edit the file… (its name, description, colour, code)', icon: 'pencil', run: () => editFile(f) },
    { label: 'Show it in the folder', icon: 'folder', run: () => reveal({ kind: f.kind, file: f.file }) },
    { sep: true },
    { label: 'Move the file to the Recycle Bin', icon: 'trash', run: () => void trashFile(f) },
  ]); };
  const doImport = () => {
    importFiles(kind).then(r => {
      if (!r) return;
      const n = r.imported.length;
      if (n) toast(`${n === 1 ? r.imported[0].file : `${n} files`} put in the ${CODE_LIB_TITLE[kind].lib}${r.skipped.length ? `; not: ${r.skipped.join('; ')}` : ''}`, r.skipped.length ? 'warn' : 'ok');
      else toast(`Nothing was put in: ${r.skipped.join('; ')}`, 'warn');
    }, e => toast(`The files were not put in: ${errorText(e)}`, 'err'));
  };

  /* ---- the project's macro file: the files of the library it uses, all their macros (they belong together) ---- */
  const built = useAsmLink(s => s.macroFile);
  const pm = project?.macros ?? null;
  const fileName = (pm?.file ?? project?.defaultFile ?? 'macros.asm').split('/').pop()!;
  const inFile = useMemo(() => new Map((built?.macros ?? []).map(m => [m.name, m])), [built]);
  const usedFiles = useMemo(() => new Map((built?.files ?? []).map(x => [x.file, x])), [built]);
  /** the project's macro file with the files `colls` (their names) used or not (made when there is none); `names`:
   *  macros added one by one before (their files used now), taken out with them */
  const fileChange = (names: string[], colls: string[], add: boolean) => {
    if (!project) return;
    const base: AsmMacroFile = pm ?? { file: project.defaultFile, macros: [], collections: [] };
    const without = (a: string[], b: string[]) => a.filter(x => !b.includes(x));
    const next = { ...base, macros: add ? base.macros : without(base.macros, names), collections: add ? [...new Set([...base.collections, ...colls])] : without(base.collections, colls) };
    const what = colls.map(c => `${c}.asm`).join(', ') || names.join(', ');
    project.onChange(add ? `Use ${what} in ${fileName}` : `Take ${what} out of ${fileName}`, next);
    toast(add ? `${what} goes in ${fileName}, all its macros${pm ? '' : ': Mimir builds it from the library, and the main source imports it'}` : `${what} is out of ${fileName}${next.called !== false ? ' (it stays while the code calls one of its macros)' : ''}`, 'ok');
  };
  /** a file of the library used in the project or not (all its macros); the macros added one by one before from it go too */
  const useFile = (f: CodeLibItem, on: boolean) => fileChange(on ? [] : (pm?.macros ?? []).filter(n => (f.macros ?? []).some(s => s.name === n)), [f.name], on);
  const fileUse = (f: CodeLibItem) => {
    const u = usedFiles.get(f.file);
    return { used: !!u, added: !!u && u.why === 'added', why: u?.why ?? null };
  };
  const markOf = (e: CodeLibEntry): FileMark | undefined => {
    const m = itemMacro(e), f = fileOf(e);
    if (!project || !m || !f || e.kind !== 'macro' || (lang && e.lang !== lang)) return undefined;
    const u = fileUse(f);
    return { file: fileName, lib: f.file, count: f.macros?.length ?? 1, added: u.added, why: u.why, inIt: inFile.has(m.name), own: !!built?.own.includes(m.name), onUse: () => useFile(f, true), onStop: () => useFile(f, false) };
  };

  const T = CODE_LIB_TITLE[kind];
  const row = (e: CodeLibEntry, inFolder = false) => {
    const ref = refOf(e), on = sameCodeLib(open, ref);
    const f = fileOf(e), m = itemMacro(e);
    const needs = f && e.macro ? codeLibNeeds(f.macros ?? [], e.macro, e.lang) : [];
    // (its file beside it when the file is not named after it; in its folder not)
    const showIn = !inFolder && !!e.macro && e.in !== e.name;
    return <EntryRow key={`${e.file}/${e.macro ?? ''}`} entry={e} showIn={showIn} on={on} q={q} lang={lang} macro={m} needs={needs} primary={primary(e)}
      mark={pm ? markOf(e) : undefined} body={markOf(e)}
      rowRef={on ? openRef : undefined} onToggle={() => set({ open: on ? null : ref })} onInsert={how => onInsert(e, how)} onCopy={() => onCopy(e.code, `Copied ${e.name}`)}
      onEdit={() => edit(e)} onMenu={(x, y) => menu(e, x, y)} />;
  };
  /** a file of several macros opened: what can be done with it, and its macros */
  const fileBar = (f: CodeLibItem) => {
    const u = fileUse(f);
    return (
      <div className="cl-file-bar" role="region" aria-label={`The file ${f.file}`}>
        <div className="cl-file-btns">
          {project && lang === f.lang && (u.added
            ? <button className="btn small on" title={`${f.file} is used in the project: all its macros are in ${fileName}. A click takes it out (it stays while the code calls one of its macros)`} onClick={() => useFile(f, false)}><Icon name="check" size={12} />Used in project</button>
            : u.used
              ? <button className="btn small on" title={`In ${fileName} because ${u.why === 'called' ? 'the code calls one of its macros' : 'a file in it uses one of its macros'}; a click keeps it there for good`} onClick={() => useFile(f, true)}><Icon name="check" size={12} />In project ({u.why})</button>
              : <button className="btn small primary" title={`Use ${f.file} in the project: all its macros go in ${fileName}, which the main source imports once`} onClick={() => useFile(f, true)}><Icon name="plus" size={12} />Use in project</button>)}
          <button className="btn small" title={`Add a macro to ${f.file}, of the lines selected in the Assembler`} onClick={() => onNew('macro', f.file)}><Icon name="plus" size={12} />Add</button>
          <span className="grow" />
          <button className="icon-btn" aria-label={`More for ${f.file}`} title="More: import it directly, export it, edit the file, show it in the folder, to the Recycle Bin" onClick={e => { const b = e.currentTarget.getBoundingClientRect(); fileMenu(f, b.left, b.bottom + 2); }}><Icon name="more" size={14} /></button>
        </div>
        {overwrite?.file === f.file && <div className="cl-confirm small" role="alert">
          <span><span className="mono">{overwrite.path}</span> was changed since Mimir wrote or read it.</span>
          <button className="btn small danger" onClick={() => exportAgain(f, true)}>Overwrite it</button>
          <button className="btn small" onClick={() => setOverwrite(null)}>Keep it</button>
        </div>}
      </div>);
  };
  const folderRow = (r: ListRow) => {
    const f = r.folder!.item, ms = r.folder!.macros, n = f.macros?.length ?? 0, on = isUnfolded(f), first = f.description.split('\n')[0];
    const u = project && lang === f.lang ? fileUse(f) : null;
    return (
      <div key={`folder/${f.file}`} role="listitem" className={cx('cl-item cl-folder', on && 'unfolded', f.color && 'tinted')} style={clVar(f.color)}>
        <button className="cl-row" aria-expanded={on} title={`${f.file}: ${nMacros(n)} that belong together (a project that uses it gets them all)${first ? ` · ${first}` : ''}\nMade ${codeLibTime(f.created)}${f.changed > f.created + 60_000 ? `, changed ${codeLibTime(f.changed)}` : ''}${f.from ? ` · from ${f.from}` : ''}\n${filtering ? 'The search shows what it finds in it' : on ? 'Click to fold it' : 'Click to see its macros'}`}
          onClick={() => fold(f)} onContextMenu={e => { e.preventDefault(); fileMenu(f, e.clientX, e.clientY); }}>
          <span className="cl-name-row"><Icon name="chevron" size={10} className={cx('cl-chev', on && 'on')} /><Icon name="folder" size={13} className="cl-folder-ic" />
            <span className="cl-name">{f.name}</span><span className="lib-n" title={filtering && ms.length < n ? `${ms.length} of its ${n} macros found` : nMacros(n)}>{filtering && ms.length < n ? `${ms.length}/${n}` : n}</span>
            {u?.used && <span className={cx('cl-infile', u.added && 'added')} title={`In ${fileName}, all its macros: ${u.added ? 'the file is used in the project' : u.why === 'called' ? 'the code calls one of its macros' : 'a file in it uses one of its macros'}`}><Icon name="check" size={10} />{fileName}</span>}</span>
          {first && <span className="cl-desc">{first}</span>}
        </button>
        {on && <>{fileBar(f)}
          <div className="cl-folder-list" role="list" aria-label={`The macros of ${f.file}`}>{ms.map(e => row(e, true))}</div></>}
      </div>);
  };
  return (
    <div className="side-inner cl-side">
      <div className="side-title lib-title">Macros and code
        <span className="grow" />
        <button className="icon-btn" title={`A new ${T.one} for the ${T.lib}, of the lines selected in the Assembler`} aria-label={`New ${T.one}`} disabled={!desktop} onClick={() => onNew(kind)}><Icon name="plus" size={14} /></button>
        <button className="icon-btn" title={kind === 'macro' ? 'Put files of macros in the library, from anywhere (irq_lib.asm: a file and its macros)' : 'Put files in the code library, from anywhere'} aria-label={`Put files in the ${T.lib}`} disabled={!desktop} onClick={doImport}><Icon name="download" size={14} /></button>
        {kind === 'macro' && <button className="icon-btn" title="Export macros: to a file a source imports, or to a file of the library" aria-label="Export macros" disabled={!desktop || !ofKind.length} onClick={() => set({ exporting: open && open.kind === 'macro' ? [open] : [] })}><Icon name="upload" size={14} /></button>}
        <button className="icon-btn" title="Read the folders again" aria-label="Read the libraries again" disabled={!desktop || loading} onClick={() => void load()}><Icon name="refresh" size={14} /></button>
        <button className="icon-btn" title={listing ? `Open the folder: ${listing.folders[kind]}` : 'Open the folder'} aria-label={`Open the ${T.lib}'s folder`} disabled={!desktop} onClick={() => reveal()}><Icon name="folder" size={14} /></button>
      </div>
      <div className="seg wide lib-kinds" role="tablist" aria-label="Libraries">
        {(['macro', 'code'] as const).map(k => (
          <button key={k} role="tab" aria-selected={kind === k} className={cx(kind === k && 'on')} onClick={() => set({ kind: k, color: '' })} title={`The ${CODE_LIB_TITLE[k].lib}`}>
            {k === 'macro' ? 'Macros' : 'Code'} <span className="lib-n">{count(k)}</span></button>
        ))}
      </div>
      <div className="side-search"><Icon name="search" size={14} /><label htmlFor="cl-q" className="sr-only">Search the libraries</label>
        <input id="cl-q" ref={search} value={q} spellCheck={false} onChange={e => set({ q: e.target.value })} placeholder="Search names, descriptions, code"
          onKeyDown={e => { if (e.key === 'Escape' && q) { e.stopPropagation(); set({ q: '' }); } }} />
        {q && <button className="icon-btn cl-clear" aria-label="Clear the search" title="Clear the search (Esc)" onClick={() => set({ q: '' })}><Icon name="x" size={12} /></button>}
      </div>
      {colors.length > 1 && <div className="cl-tools">
        <div className="cl-colors" role="group" aria-label="Show the colour">
          {colors.map(c => <button key={c || 'none'} type="button" className={cx('bm-sw', !c && 'none', color === c && 'on')} style={c ? ({ '--sw': bookmarkCss(c) }) as CSSProperties : undefined}
            aria-pressed={color === c} aria-label={c ? `Only the ${c} ones` : 'Only those without a colour'} title={`${c ? `Only the ${T.many} in this colour` : `Only the ${T.many} without a colour`}${color === c ? ' (a click shows them all again)' : ''}`}
            onClick={() => set({ color: color === c ? '' : c })} />)}
          {color && <button type="button" className="linkish small" onClick={() => set({ color: '' })}>All colours</button>}
        </div>
      </div>}
      {rows.length > 0 && <div className="cl-letters" role="navigation" aria-label="Letters">
        {CODE_LIB_LETTERS.filter(l => letters.has(l) || !'ÅÄÖ'.includes(l)).map(l => (
          <button key={l} type="button" disabled={!letters.has(l)} aria-label={`Go to ${l === '#' ? 'the names that start with no letter' : l}`} onClick={() => jump(l)}>{l}</button>))}
      </div>}
      {error && <p className="side-hint err-text" role="alert">{error}</p>}
      {project && kind === 'macro' && lang && <ProjectMacros project={project} built={built} lang={lang} fileName={fileName} onTakeOut={(names, colls) => fileChange(names, colls, false)} />}
      <div className="cl-list" ref={listRef} role="list" aria-label={kind === 'macro' ? 'The macro library' : 'The code library'}>
        {groups.map(g => (
          <div key={g.letter} className="cl-group" role="group" aria-label={g.letter} ref={el => { groupRef.current[g.letter] = el; }}>
            <div className="cl-letter" aria-hidden>{g.letter}<span className="lib-n">{g.items.length}</span></div>
            {g.items.map(r => (r.folder ? folderRow(r) : row(r.entry!)))}
          </div>
        ))}
        {!desktop ? <p className="side-hint">The libraries are folders on your computer: they need the desktop app.</p>
          : listing && !ofKind.length ? <div className="side-hint lib-empty">
            <p><b>No {T.many} yet.</b></p>
            <p>Select the lines in the Assembler, right-click them and choose <b>Add to the {T.lib}…</b> (or <b>+</b> here). {kind === 'macro' ? 'Code that is not a macro yet is made one; a click on a macro\'s first line takes the whole macro.' : 'The code is kept as it is.'}</p>
            {kind === 'macro' && <p>Files of macros you have (irq_lib.asm) go in with <button type="button" className="linkish" onClick={doImport}>Put files in…</button>: each file and all its macros.</p>}
            <p>Each is a file in <button type="button" className="linkish" onClick={() => reveal()}>{listing.folders[kind]}</button>, which a source can import too.</p>
          </div>
            : ofKind.length > 0 && !rows.length ? <p className="side-hint">No {T.one === 'macro' ? 'macro' : 'code'} matches{q.trim() ? ` “${q.trim()}”` : ''}{color ? ' in that colour' : ''}.{count(kind === 'macro' ? 'code' : 'macro') ? ` ${count(kind === 'macro' ? 'code' : 'macro')} in ${kind === 'macro' ? 'Code' : 'Macros'}.` : ''}</p> : null}
      </div>
      {listing && <button type="button" className="linkish small lib-dir mono" title="Open the folder (Settings → General → Library folder moves it)" onClick={() => reveal()}>{listing.folders[kind]}</button>}
    </div>
  );
}

/** a row of the list: a macro (`showIn`: its file's name beside it) or a piece of code, opened on a click */
function EntryRow({ entry: i, showIn, on, q, lang, macro: m, needs, primary, mark, body, rowRef, onToggle, onInsert, onCopy, onEdit, onMenu }: {
  entry: CodeLibEntry; showIn: boolean; on: boolean; q: string; lang: ScriptLang | null; macro: CodeLibMacro | null; needs: string[]; primary: 'code' | 'call';
  /** the project's macro file has it (the row says so); `body`: what its body offers for the file */
  mark?: FileMark; body?: FileMark;
  rowRef?: React.Ref<HTMLDivElement>; onToggle: () => void; onInsert: (how: 'code' | 'call') => void; onCopy: () => void; onEdit: () => void; onMenu: (x: number, y: number) => void;
}) {
  const sig = m ? codeLibSignature(m, i.lang) : null, hit = codeLibHit(i, q), first = i.description.split('\n')[0];
  const other = lang && i.lang !== lang;
  return (
    <div role="listitem" className={cx('cl-item', on && 'open', i.color && 'tinted')} style={clVar(i.color)} ref={rowRef}>
      <button className="cl-row" aria-expanded={on} title={`${i.name}${showIn ? ` (in ${i.file})` : ''}${first ? ` · ${first}` : ''}\nMade ${codeLibTime(i.created)}${i.from ? ` · from ${i.from}` : ''}\nClick to see it, double-click to put ${primary === 'call' ? 'its call' : 'it'} in the source`}
        onClick={e => { if (e.detail < 2) onToggle(); }} onDoubleClick={() => { if (lang) onInsert(primary); }}
        onContextMenu={e => { e.preventDefault(); onMenu(e.clientX, e.clientY); }}>
        <span className="cl-name-row"><span className="cl-name">{i.name}</span>{showIn && <span className="cl-in" title={`In the file ${i.file}`}>{i.in}</span>}{other && <span className="cl-lang" title={`Written for ${LANG_TITLE[i.lang]}: the project is ${LANG_TITLE[lang!]}`}>{i.lang === '64tass' ? '64tass' : 'Kick'}</span>}
          {mark?.inIt && <span className={cx('cl-infile', mark.added && 'added')} title={`In ${mark.file} with its file ${mark.lib}: ${mark.added ? 'the file is used in the project' : mark.why === 'called' ? 'the code calls one of its macros' : 'a file in it uses one of its macros'}`}><Icon name="check" size={10} />{mark.file}</span>}
          <span className="cl-date mono" title={`Made ${codeLibTime(i.created)}${i.changed > i.created + 60_000 ? `, changed ${codeLibTime(i.changed)}` : ''}`}>{codeLibTime(i.created, true)}</span></span>
        {sig && sig !== i.name && <span className="cl-sig mono">{sig}</span>}
        {first ? <span className="cl-desc">{first}</span> : !sig || sig === i.name ? <span className="cl-desc muted">{i.code.split('\n').find(l => l.trim())?.trim() ?? ''}</span> : null}
        {hit === 'code' && <span className="cl-hit small">found in the code</span>}
      </button>
      {on && <ItemBody item={i} lang={lang} macro={m} needs={needs} primary={primary} mark={body} onInsert={onInsert} onCopy={onCopy} onEdit={onEdit} onMore={onMenu} />}
    </div>);
}

/** an item opened in the list: its description, its code, when it was made and where it came from, and what to do */
function ItemBody({ item: i, lang, macro, needs, primary, mark, onInsert, onCopy, onEdit, onMore }: { item: CodeLibEntry; lang: ScriptLang | null; macro: CodeLibMacro | null; needs: string[]; primary: 'code' | 'call'; mark?: FileMark;
  onInsert: (how: 'code' | 'call') => void; onCopy: () => void; onEdit: () => void; onMore: (x: number, y: number) => void }) {
  const [all, setAll] = useState(false);
  const lines = i.code.split('\n'), long = lines.length > 14 && !all;
  const no = lang ? '' : 'Open an Assembler project to put it in a source';
  return (
    <div className="cl-body">
      {i.description ? <div className="cl-text">{i.description}</div> : <div className="muted small">No description. Edit gives it one.</div>}
      <pre className="cl-code mono" aria-label={`The code of ${i.name}`}>{long ? lines.slice(0, 14).join('\n') : i.code}</pre>
      {long && <button type="button" className="linkish small cl-more" onClick={() => setAll(true)}>All {lines.length} lines</button>}
      <div className="cl-meta small muted">
        <span>Made {codeLibTime(i.created)}{i.changed > i.created + 60_000 ? ` · changed ${codeLibTime(i.changed)}` : ''}</span>
        <span>{LANG_TITLE[i.lang]} · {i.file}{i.own ? ' (put in the folder)' : ''}</span>
        {needs.length > 0 && <span title="Insert definition puts these in too (those the project does not define)">Uses {needs.join(', ')}</span>}
        {i.from && <span title="Where it was taken from">From {i.from}</span>}
      </div>
      <div className="bm-actions">
        {macro ? <>
          <button className={cx('btn small', primary === 'call' && 'primary')} disabled={!lang} title={no || `Put ${codeLibSignature(macro, i.lang)} where the caret is (Tab goes from parameter to parameter)`} onClick={() => onInsert('call')}><Icon name="play" size={12} />Insert call</button>
          <button className={cx('btn small', primary === 'code' && 'primary')} disabled={!lang} title={no || `Put the macro's definition in the source, at the caret's line${needs.length ? `, with ${needs.join(', ')} it uses` : ''}`} onClick={() => onInsert('code')}>Insert definition</button>
        </> : <button className="btn small primary" disabled={!lang} title={no || 'Put the code in the source, at the caret\'s line'} onClick={() => onInsert('code')}><Icon name="play" size={12} />Insert</button>}
        {/* (its file is what the project uses: all its macros, they belong together) */}
        {mark && (mark.own
          ? <span className="small muted cl-why" title={`The project's sources (or a file they import from outside) define ${i.name}: ${mark.file} leaves it out (the macro file's box says where, and how to use ${mark.file} instead)`}><Icon name="info" size={11} />The project has it already</span>
          : mark.added
            ? <button className="btn small on" title={`${mark.lib} is used in the project: all its ${mark.count} macros are in ${mark.file}. A click takes the file out (it stays while the code calls one of its macros)`} onClick={mark.onStop}><Icon name="check" size={12} />{mark.lib} used</button>
            : mark.why ? <span className="small muted cl-why" title={`${mark.lib} is in ${mark.file} because ${mark.why === 'called' ? 'the code calls one of its macros' : 'a file in it uses one of its macros'}`}><Icon name="check" size={11} />In {mark.file} ({mark.why === 'called' ? 'called' : 'used'})</span>
              : <button className="btn small" title={`Use ${mark.lib} in the project: all its ${mark.count} macro${mark.count === 1 ? '' : 's'} go in ${mark.file}, which the main source imports once`} onClick={mark.onUse}><Icon name="plus" size={12} />Use {mark.count > 1 ? `${mark.lib} (${mark.count})` : 'in project'}</button>)}
        <button className="btn small" onClick={onCopy} title="Copy the code"><Icon name="copy" size={12} />Copy</button>
        <button className="btn small" onClick={onEdit}><Icon name="pencil" size={12} />Edit</button>
        <button className="icon-btn" aria-label={`More for ${i.name}`} title="More" onClick={e => { const r = e.currentTarget.getBoundingClientRect(); onMore(r.left, r.bottom + 2); }}><Icon name="more" size={14} /></button>
      </div>
    </div>
  );
}

/** The project's macro file at the top of the macro library: none yet (a button that makes it), or its file and the
 *  files of the library in it (all their macros: they belong together), each with why (added, called, used) and × for
 *  one added; the calls on or off; the macros of its files the project defines itself, and where (a file imported from
 *  outside: Use macros.asm instead takes that import out); the names added that the library has not; Stop. */
function ProjectMacros({ project, built, lang, fileName, onTakeOut }: { project: NonNullable<CodeLibViewProps['project']>; built: (CodeLibBuilt & { file: string; defined: AsmMacroDefined[] }) | null; lang: ScriptLang; fileName: string;
  onTakeOut: (names: string[], colls: string[]) => void }) {
  const pm = project.macros;
  if (!pm) return (
    <div className="cl-proj cl-proj-none">
      <button className="btn small" title={`Mimir writes ${project.defaultFile} with the library's files the project uses (all of each file's macros), and the main source imports it once`}
        onClick={() => project.onChange(`Build ${fileName}`, { file: project.defaultFile, macros: [], collections: [] })}><Icon name="plus" size={12} />Build {fileName}</button>
      <span className="small muted">one {lang === '64tass' ? '.include' : '#import'} for the project's macros</span>
    </div>);
  const n = built?.macros.length ?? 0, called = pm.called !== false, files = built?.files ?? [];
  const why = (w: CodeLibBuilt['files'][number]['why']) => (w === 'added' ? 'added' : w === 'called' ? 'the code calls it' : 'a file in it uses it');
  return (
    <div className="cl-proj" role="region" aria-label="The project's macro file">
      <div className="cl-proj-row">
        <span className="cl-proj-name" title={`${pm.file}: built by Mimir from the library, all the macros of the files below`}><Icon name="doc" size={12} /><span className="mono">{fileName}</span></span>
        <span className="lib-n cl-proj-count">{n} macro{n === 1 ? '' : 's'}</span>
        <span className="grow" />
        <label className="check small" title="A file of the library whose macros the code calls goes in too, all its macros: as you type the call"><input type="checkbox" checked={called} onChange={e => project.onChange(e.target.checked ? 'Calls in the macro file' : 'No calls in the macro file', { ...pm, ...(e.target.checked ? { called: undefined } : { called: false }) })} /> Calls</label>
        <button className="icon-btn" aria-label={`Open ${fileName}`} title={`Open ${pm.file} (read only: Mimir writes it)`} onClick={() => project.onOpen(pm.file)}><Icon name="code" size={13} /></button>
        <button className="icon-btn" aria-label={`Stop building ${fileName}`} title={`Stop building ${pm.file}: the file and its import stay as they are`} onClick={() => project.onChange(`Stop building ${fileName}`, null)}><Icon name="x" size={13} /></button>
      </div>
      <div className="cl-proj-list" role="list" aria-label={`The files in ${fileName}`}>
        {files.map(f => (
          <div key={f.file} role="listitem" className="cl-proj-item">
            <Icon name="doc" size={11} /><span className="mono">{f.file}</span><span className="muted small">{f.count} macro{f.count === 1 ? '' : 's'} · {why(f.why)}</span>
            <span className="grow" />
            {f.why === 'added' && <button className="icon-btn" aria-label={`Take ${f.file} out of ${fileName}`} title={`Take ${f.file} out (it stays while the code calls one of its macros)`} onClick={() => onTakeOut(pm.macros.filter(m => built?.macros.some(x => x.name === m && x.in === f.name)), [f.name])}><Icon name="x" size={11} /></button>}
          </div>))}
        {!files.length && <p className="small muted cl-proj-sum">{called ? 'Use a file of the library in the project, or call one of its macros, and its macros go in.' : 'Use a file of the library in the project (Use in project), and its macros go in.'}</p>}
      </div>
      {(built?.defined ?? []).map(d => (
        <div key={d.key} className="cl-proj-note small" role="note">
          <Icon name="info" size={12} />
          <span>{d.names.length === 1 ? `${d.names[0]} is` : `${d.names.length} of the macros (${d.names.slice(0, 3).join(', ')}${d.names.length > 3 ? ' …' : ''}) are`} in the project already: {d.outside
            ? <>{d.importers.length ? `${d.importers.join(', ')} import${d.importers.length === 1 ? 's' : ''}` : 'it imports'} <span className="mono">{d.where}</span>. {fileName} leaves them out.</>
            : <><span className="mono">{d.where}</span> defines them. {fileName} leaves them out.</>}</span>
          {d.outside && d.importers.length > 0 && <button className="btn small" title={`Take the line that imports ${d.where} out of ${d.importers.join(', ')}: the macros come from the library, in ${fileName}`} onClick={() => project.onDropImport(d.key)}>Use {fileName} instead</button>}
        </div>))}
      {!!built?.missing.length && <div className="small warn-text cl-proj-sum">Not in the library: {built.missing.join(', ')} <button type="button" className="linkish" onClick={() => onTakeOut(built.missing.filter(m => pm.macros.includes(m)), built.missing.filter(m => pm.collections.includes(m)))}>Take out</button></div>}
    </div>);
}

/** the search asked for (the palette's Search the macro library: the view's search field focused) */
let focusSet: ((n: number) => void) | null = null, focusN = 0, pending = false;
function useCodeLibFocus(): number {
  const [n, setN] = useState(0);
  useEffect(() => { focusSet = setN; if (pending) { pending = false; setN(++focusN); } return () => { focusSet = null; }; }, []);
  return n;
}
/** the view's search field focused (now, or once the view is shown) */
export function focusCodeLibSearch() { if (focusSet) focusSet(++focusN); else pending = true; }
