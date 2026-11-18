/* The library (spec 10.6) as the window has it: what the main process read from its folder, the item shown, and the
 * Library view's kind and search. The files are the main process's; this asks it again after each change. */
import { create } from 'zustand';
import type { LibraryItem, LibraryKind } from '@mimir/core';
import type { LibraryAddRequest, LibraryChangeResult, LibraryFileRequest, LibraryListing, LibraryUpdateRequest } from '../../shared/ipc';

const kr = typeof window !== 'undefined' ? window.kr : undefined;

/** an item by its kind and file */
export interface LibraryRef { kind: LibraryKind; file: string }
export const sameRef = (a: LibraryRef | null | undefined, b: LibraryRef | null | undefined) => !!a && !!b && a.kind === b.kind && a.file === b.file;

interface LibraryState {
  /** null: not read yet (or outside the desktop app) */
  listing: LibraryListing | null;
  loading: boolean;
  error: string | null;
  /** the item the Library tab shows */
  selected: LibraryRef | null;
  /** the kind the Library view and tab list (all: every kind) */
  kind: LibraryKind | 'all';
  q: string;
  set: (s: Partial<Pick<LibraryState, 'selected' | 'kind' | 'q'>>) => void;
  /** the folder read again */
  load: () => Promise<void>;
  add: (req: LibraryAddRequest) => Promise<LibraryChangeResult>;
  update: (req: LibraryUpdateRequest) => Promise<LibraryChangeResult>;
  remove: (req: LibraryFileRequest) => Promise<void>;
}

export const useLibrary = create<LibraryState>((set, get) => ({
  listing: null, loading: false, error: null, selected: null, kind: 'all', q: '',
  set: s => set(s),
  load: async () => {
    if (!kr) return;
    set({ loading: true });
    try { set({ listing: await kr.libraryList(), error: null }); } catch (e) { set({ error: e instanceof Error ? e.message : String(e) }); } finally { set({ loading: false }); }
  },
  add: async req => {
    if (!kr) throw new Error('The library needs the desktop app');
    const r = await kr.libraryAdd(req);
    set({ listing: r.listing, error: null });
    return r;
  },
  update: async req => {
    if (!kr) throw new Error('The library needs the desktop app');
    const r = await kr.libraryUpdate(req);
    // the item shown follows its file to its new name
    set({ listing: r.listing, error: null, ...(sameRef(get().selected, req) ? { selected: { kind: r.item.kind, file: r.item.file } } : {}) });
    return r;
  },
  remove: async req => {
    if (!kr) throw new Error('The library needs the desktop app');
    const listing = await kr.libraryRemove(req);
    set({ listing, error: null, ...(sameRef(get().selected, req) ? { selected: null } : {}) });
  },
}));

/** the item `ref` names, when the library has it */
export const itemOf = (items: readonly LibraryItem[] | undefined, ref: LibraryRef | null): LibraryItem | null => (ref && items?.find(i => i.kind === ref.kind && i.file === ref.file)) || null;
