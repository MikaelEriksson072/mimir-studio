/* The macro and code libraries (spec 10.8) as the window has them: what the main process read from the folders Macros and
 * Code, the item open in the list, the library shown, the search and the colour picked out, and the dialog that adds an
 * item or changes one. The files are the main process's; this asks it again after each change. */
import { create } from 'zustand';
import type { CodeLibItem, CodeLibKind, ScriptLang } from '@mimir/core';
import type { CodeLibListing, CodeLibSaveRequest } from '../../shared/ipc';

const kr = typeof window !== 'undefined' ? window.kr : undefined;

/** an item by its kind and file */
export interface CodeLibRef { kind: CodeLibKind; file: string }
export const sameCodeLib = (a: CodeLibRef | null | undefined, b: CodeLibRef | null | undefined) => !!a && !!b && a.kind === b.kind && a.file === b.file;

/** what the dialog is open on: a new item (its code taken from a source: `raw` the lines as they were, wrapped in a
 *  macro when they are not one; `from` where they were), or an item of the library (`was`) */
export interface CodeLibEditing {
  kind: CodeLibKind;
  lang: ScriptLang;
  /** the code (a new item's as taken; an item's as it is) */
  code: string;
  name?: string;
  from?: string;
  was?: CodeLibRef;
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
  editing: CodeLibEditing | null;
  set: (s: Partial<Pick<CodeLibState, 'kind' | 'q' | 'color' | 'open' | 'editing'>>) => void;
  /** the folders read again */
  load: () => Promise<void>;
  save: (req: CodeLibSaveRequest) => Promise<CodeLibItem>;
  remove: (ref: CodeLibRef) => Promise<void>;
}

export const useCodeLib = create<CodeLibState>((set, get) => ({
  listing: null, loading: false, error: null, kind: 'macro', q: '', color: '', open: null, editing: null,
  set: s => set(s),
  load: async () => {
    if (!kr) return;
    set({ loading: true });
    try { set({ listing: await kr.codelibList(), error: null }); } catch (e) { set({ error: e instanceof Error ? e.message : String(e) }); } finally { set({ loading: false }); }
  },
  save: async req => {
    if (!kr) throw new Error('The libraries need the desktop app');
    const r = await kr.codelibSave(req);
    // the item open in its library, which the view shows (its search kept unless it hides it)
    const ref = { kind: r.item.kind, file: r.item.file };
    set({ listing: r.listing, error: null, open: ref, kind: r.item.kind, ...(get().color && get().color !== (r.item.color ?? '') ? { color: '' } : {}) });
    return r.item;
  },
  remove: async ref => {
    if (!kr) throw new Error('The libraries need the desktop app');
    const listing = await kr.codelibRemove(ref);
    set({ listing, error: null, ...(sameCodeLib(get().open, ref) ? { open: null } : {}) });
  },
}));

/** the item `ref` names, when the libraries have it */
export const codeLibItemOf = (items: readonly CodeLibItem[] | undefined, ref: CodeLibRef | null): CodeLibItem | null => (ref && items?.find(i => i.kind === ref.kind && i.file === ref.file)) || null;
