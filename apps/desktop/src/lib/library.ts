/* The library (spec 10.6) in the app: which blocks can go in it, what a file of it is called and holds, the search, and
 * its pictures. Pure, so the views and the tests share it. */
import { libraryHash, parsePsid, type BlockKind, type LibraryColors, type LibraryItem, type LibraryKind, type PsidInfo } from '@mimir/core';
import { gfxImage } from './gfxview';

/** each kind as the library names it: a folder, one of it, and many */
export const LIB_KIND: Record<LibraryKind, { folder: string; one: string; many: string; icon: 'music' | 'sprite' | 'grid' }> = {
  sid: { folder: 'SIDs', one: 'SID tune', many: 'SID tunes', icon: 'music' },
  sprites: { folder: 'Sprites', one: 'sprite set', many: 'sprite sets', icon: 'sprite' },
  chars: { folder: 'Chars', one: 'charset', many: 'charsets', icon: 'grid' },
};

/** the library a block of this type goes in: music, sprite data and a charset (null: none) */
export const libraryKindOf = (type: BlockKind): LibraryKind | null => (type === 'music' ? 'sid' : type === 'sprite' ? 'sprites' : type === 'charset' ? 'chars' : null);

/** the colours the library draws in when an item has none of its own: those of the Graphics tab */
export const LIB_COLORS: LibraryColors = { bg: 0, fg: 1, mc1: 15, mc2: 12 };

/** a .sid's header, when it is one */
export function sidInfo(item: Pick<LibraryItem, 'kind' | 'data'>): PsidInfo | null {
  if (item.kind !== 'sid') return null;
  try { return parsePsid(item.data); } catch { return null; }
}

/** how many sprites or characters an item has (a SID: 1) */
export const itemCount = (item: Pick<LibraryItem, 'kind' | 'data'>): number => (item.kind === 'chars' ? Math.ceil(item.data.length / 8) : item.kind === 'sprites' ? Math.ceil(item.data.length / 64) : 1);

/** what an item is, in a few words: "SID tune, 3 songs", "16 sprites", "256 characters" */
export function itemWhat(item: Pick<LibraryItem, 'kind' | 'data'>): string {
  const n = itemCount(item);
  if (item.kind === 'sid') { const s = sidInfo(item); return s ? `${s.rsid ? 'RSID' : 'PSID'}${s.songs > 1 ? `, ${s.songs} songs` : ''}` : 'SID'; }
  return item.kind === 'sprites' ? `${n} sprite${n === 1 ? '' : 's'}` : `${n} character${n === 1 ? '' : 's'}`;
}

/** where an item was taken from, as a line: its source's text and its addresses */
export function itemFrom(item: Pick<LibraryItem, 'from' | 'own'>): string {
  if (item.own) return 'put in the folder by hand';
  const f = item.from;
  if (!f) return '';
  const range = f.start != null && f.end != null ? `$${f.start.toString(16).padStart(4, '0')}-$${(f.end - 1).toString(16).padStart(4, '0')}` : '';
  return [f.text, range].filter(Boolean).join(' · ');
}

/** whether the search's words are all in the item's name, file, source or what it is (any case) */
export function libraryMatches(item: LibraryItem, q: string): boolean {
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const s = sidInfo(item);
  const all = [item.name, item.file, item.from?.text, item.from?.project, item.from?.file, item.from?.disk, s?.author, s?.released, LIB_KIND[item.kind].folder].filter(Boolean).join(' ').toLowerCase();
  return words.every(w => all.includes(w));
}

/** the library's items in the order it lists them: the newest first */
export const libraryOrder = (items: readonly LibraryItem[]): LibraryItem[] => [...items].sort((a, b) => b.added - a.added || a.file.localeCompare(b.file));

/** the item of the library with these bytes (sprites and a charset without a load address, a .sid without its texts,
 *  which the dialog writes), when there is one */
export function sameInLibrary(items: readonly LibraryItem[], kind: LibraryKind, data: Uint8Array): LibraryItem | null {
  const hash = libraryHash(kind === 'sid' ? sidBody(data) : data);
  return items.find(i => i.kind === kind && (kind === 'sid' ? libraryHash(sidBody(i.data)) : i.hash) === hash) ?? null;
}
/** a .sid without its three texts (the name, author and released the user may change) */
const sidBody = (sid: Uint8Array) => { const b = sid.slice(); b.fill(0, 0x16, 0x76); return b; };

/** the name DeepSID gets a .sid under (letters, digits, _ . - only), with its hash to keep it apart from other tunes */
export function deepSidName(name: string, sid: Uint8Array): string {
  const stem = name.replace(/[^A-Za-z0-9_.-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'tune';
  return `${stem}-${libraryHash(sid).slice(0, 6)}.sid`;
}

/** An item's sprites or characters as an image at 1x, `per` a row (all of them at most, one row when there are fewer),
 *  in its colours; `count` draws only the first so many (a thumbnail). */
export function itemImage(item: Pick<LibraryItem, 'kind' | 'data'>, per: number, mc: boolean, colors: LibraryColors, count?: number): { width: number; height: number; rgba: Uint8ClampedArray<ArrayBuffer> } {
  const unit = item.kind === 'sprites' ? 64 : 8;
  const end = count != null ? Math.min(item.data.length, count * unit) : item.data.length;
  return gfxImage(item.kind === 'sprites' ? 'sprites' : 'chars', item.data, 0, Math.max(end, 1), mc, colors, { per });
}
