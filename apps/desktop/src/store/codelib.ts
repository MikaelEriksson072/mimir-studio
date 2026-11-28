/* The macro and code libraries (spec 10.8) as the window has them: what the main process read from the folders Macros,
 * Code and Re-assembler (the re-assembler's pieces of code, taken from listings), the item open in the list (a collection's macro too), the library shown, the search and the colour picked out,
 * the collections opened, whether every macro is listed by its own letter, and the dialogs that add an item or change
 * one and that export macros. The files are the main process's; this asks it again after each change. */
import { create } from 'zustand';
import { codeLibSubItems, type CodeLibEntry, type CodeLibItem, type CodeLibKind, type ScriptLang } from '@mimir/core';
import type { CodeLibExportRequest, CodeLibExportResult, CodeLibImportResult, CodeLibListing, CodeLibSaveRequest } from '../../shared/ipc';

const kr = typeof window !== 'undefined' ? window.kr : undefined;

/** an item by its kind and file; `macro`: one of a collection's macros */
export interface CodeLibRef { kind: CodeLibKind; file: string; macro?: string }
export const sameCodeLib = (a: CodeLibRef | null | undefined, b: CodeLibRef | null | undefined) => !!a && !!b && a.kind === b.kind && a.file === b.file && (a.macro ?? '') === (b.macro ?? '');

/** what the dialog is open on: a new item (its code taken from a source: wrapped in a macro when it is not one; `from`
 *  where it was), or an item of the library (`was`, a collection's macro too); `into`: the collection it goes in at
 *  first (missing: a file of its own) */
export interface CodeLibEditing {
  kind: CodeLibKind;
  lang: ScriptLang;
  /** the code (a new item's as taken; an item's as it is) */
  code: string;
  name?: string;
  from?: string;
  was?: CodeLibRef;
  into?: { file: string } | { name: string };
  /** its colour at first (a collection's macro its own; missing: the item's) */
  color?: string;
  /** the code made a macro at first (a piece of code moved or copied to the macro library), and its description */
  wrap?: boolean;
  description?: string;
}

interface CodeLibState {
  /** null: not read yet (or outside the desktop app) */
  listing: CodeLibListing | null;
  loading: boolean;
  error: string | null;
  /** the library the view shows, its search, the colour it shows only ('' none picked) and the item open */
  kind: CodeLibKind;
  q: string;
  color: string;
  open: CodeLibRef | null;
  /** the macro library's files of several macros whose folders are open in the list (their macros shown) */
  unfolded: string[];
  editing: CodeLibEditing | null;
  /** the export dialog, open on these (the macros checked at first) */
  exporting: CodeLibRef[] | null;
  set: (s: Partial<Pick<CodeLibState, 'kind' | 'q' | 'color' | 'open' | 'editing' | 'exporting' | 'unfolded'>>) => void;
  /** the folders read again */
  load: () => Promise<void>;
  save: (req: CodeLibSaveRequest) => Promise<{ item: CodeLibItem; macro?: string }>;
  remove: (ref: CodeLibRef) => Promise<void>;
  /** files put in the library shown (the open dialog's); null: the dialog was closed */
  importFiles: (kind: CodeLibKind) => Promise<CodeLibImportResult | null>;
  exportMacros: (req: CodeLibExportRequest) => Promise<CodeLibExportResult>;
}

/** a file of the macro library the list shows as a folder: one of several macros */
export const codeLibFolder = (i: Pick<CodeLibItem, 'kind' | 'macros'> | undefined | null): boolean => !!i && i.kind === 'macro' && (i.macros?.length ?? 0) > 1;
const many = codeLibFolder;
const unfold = (open: string[], file: string) => (open.includes(file) ? open : [...open, file]);

export const useCodeLib = create<CodeLibState>((set, get) => ({
  listing: null, loading: false, error: null, kind: 'macro', q: '', color: '', open: null, unfolded: [], editing: null, exporting: null,
  set: s => set(s),
  load: async () => {
    if (!kr) return;
    set({ loading: true });
    try { set({ listing: await kr.codelibList(), error: null }); } catch (e) { set({ error: e instanceof Error ? e.message : String(e) }); } finally { set({ loading: false }); }
  },
  save: async req => {
    if (!kr) throw new Error('The libraries need the desktop app');
    const r = await kr.codelibSave(req);
    // the item open in its library, which the view shows (its search kept unless it hides it; in a file of several
    // macros: its folder open)
    const ref = { kind: r.item.kind, file: r.item.file, ...(r.macro ? { macro: r.macro } : {}) };
    const shown = r.macro ? r.item.macros?.find(m => m.name === r.macro)?.color ?? r.item.color : r.item.color;
    set({ listing: r.listing, error: null, open: ref, kind: r.item.kind, ...(get().color && get().color !== (shown ?? '') ? { color: '' } : {}), ...(many(r.item) ? { unfolded: unfold(get().unfolded, r.item.file) } : {}) });
    return { item: r.item, ...(r.macro ? { macro: r.macro } : {}) };
  },
  remove: async ref => {
    if (!kr) throw new Error('The libraries need the desktop app');
    const listing = await kr.codelibRemove(ref);
    // (the folder of a file gone, or of one macro now, closed)
    set({ listing, error: null, ...(sameCodeLib(get().open, ref) ? { open: null } : {}), unfolded: get().unfolded.filter(u => listing.items.some(i => i.file === u && many(i))) });
  },
  importFiles: async kind => {
    if (!kr) throw new Error('The libraries need the desktop app');
    const r = await kr.codelibImport({ kind });
    if (r) {
      const one = r.imported.length === 1 ? r.imported[0] : null;
      // (one file of several macros: its folder open, its macros shown)
      const folder = one && many(r.listing.items.find(x => x.kind === one.kind && x.file === one.file));
      set({ listing: r.listing, error: null, kind, ...(one ? { open: folder ? null : one } : {}), ...(folder ? { unfolded: unfold(get().unfolded, one!.file) } : {}) });
    }
    return r;
  },
  exportMacros: async req => {
    if (!kr) throw new Error('The libraries need the desktop app');
    const r = await kr.codelibExport(req);
    set({ listing: r.listing, error: null });
    if (r.collection) set({ kind: 'macro', open: null, unfolded: unfold(get().unfolded, r.collection.file) });
    return r;
  },
}));

/** the item `ref` names, when the libraries have it: a collection's macro as an entry of its own */
export function codeLibItemOf(items: readonly CodeLibItem[] | undefined, ref: CodeLibRef | null): CodeLibEntry | null {
  const i = (ref && items?.find(x => x.kind === ref.kind && x.file === ref.file)) || null;
  if (!i || !ref?.macro) return i;
  return codeLibSubItems(i).find(e => e.macro === ref.macro) ?? null;
}
/** an item's export key (where it was exported to is remembered by it) */
export const codeLibExportKey = (i: { kind: CodeLibKind; file: string }) => `${i.kind}/${i.file}`;
