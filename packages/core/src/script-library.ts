/* =====================================================================
 * The library for a JavaScript script (spec 10.3, 10.6): the SID music, sprites, charsets and bitmaps kept for every
 * project, as `library` in a script's code (script-js.ts). A script reads them, puts them in memory, and asks for
 * more to be added:
 *
 *   library.folder                 the library's folder on the PC
 *   library.items                  everything in it: a list; library.sids, library.sprites, library.chars and
 *                                  library.bitmaps one kind each
 *   library.find(name, kind)       an item by its name or its file's name (any case, with or without the extension),
 *                                  or null; kind ("sid", "sprites", "chars", "bitmaps") can be left out
 *   library.search(text, kind)     the items whose name, file or source has the text
 *   library.same(kind, bytes)      the item that holds these bytes already, or null
 *   library.add(kind, bytes, { name, from, mc, colors, load, format, author })
 *                                  bytes added when the run has ended well: a .sid file ("sid"), sprites of 64 bytes
 *                                  each ("sprites"), a charset of 8 bytes a character ("chars", load: where it loads),
 *                                  a picture ("bitmaps": { bitmap, screen, colorRam, background, mc }, format "koala",
 *                                  "ocp", "art" or "doodle")
 *   library.requests               what the script has asked to be added so far, a text each
 *
 * An item:
 *   kind, name, file               its kind, its name and its file's name in the kind's folder
 *   bytes, size                    its bytes: a .sid whole, sprites and a charset without a load address, a picture
 *                                  as bitmap (8000), screen (1000), colour RAM (1000) and background
 *   load                           the load address its file has, or null
 *   added, hash, own               when it was added (ms), its bytes' hash, true for a file put in the folder by hand
 *   from                           where it was taken from: { text, project, file, disk, start, end }, or null
 *   mc, colors                     multicolour, and the colours it is drawn in ({ bg, fg, mc1, mc2 }, or null)
 *   count                          sprites: how many; chars: how many characters; else 1
 *   sprite(i), char(i)             one sprite's 64 bytes, one character's 8
 *   tune                           a SID: { name, author, released, start, end, size, init, play, songs, song, rsid,
 *                                  bytes } (what sid.parse gives); play it with sid.play(item.bytes)
 *   bitmap, screen, colorRam, background
 *                                  a picture's parts
 *   asFile(format)                 it as a file: the .sid, the sprites, the charset with its load address, the
 *                                  picture in a format ("koala", "ocp", "art", "doodle"; its own kind's when left out)
 *   put(at)                        its bytes copied into mem: a SID where it loads (or at an address), sprites and a
 *                                  charset at an address (a charset where its file loads when none is given), a
 *                                  picture with put({ bitmap, screen, colorRam }): { start, end } of what was written
 *
 * Nothing is added during the run: the run ends with the requests (ScriptRun.library) and the app adds them, unless
 * the script is in safe mode, where Last run says what it would add. Bytes the library has already are not added again.
 * ===================================================================== */
import { parsePsid } from './c64/psid';
import { PICTURE_FORMATS, PICTURE_INFO, picture, pictureData, pictureFromData, writePicture, type PictureFormat } from './c64/pictures';
import { charsetFile, LIBRARY_KINDS, libraryHash, sidWithTexts, spriteFile, type LibraryColors, type LibraryItem, type LibraryKind, type LibrarySource } from './library';

/** what the app hands a script's run of the library */
export interface ScriptLibraryData {
  /** the library's folder */
  dir: string;
  items: LibraryItem[];
  /** the formats pictures are written in (Settings → General → Library) */
  formats: { mc: PictureFormat; hires: PictureFormat };
}

/** what a script asked to be added: done by the app when the run has ended well. `bytes`: the file as it is written;
 *  `data`: the bytes as the library compares them (LibraryItem.data) */
export interface ScriptLibraryRequest {
  kind: LibraryKind;
  name: string;
  bytes: Uint8Array;
  data: Uint8Array;
  format?: PictureFormat;
  from?: LibrarySource;
  mc?: boolean;
  colors?: LibraryColors;
}

/** the most a script asks to be added in one run */
export const LIBRARY_REQUESTS = 32;

const KIND_TEXT: Record<LibraryKind, string> = { sid: 'SID', sprites: 'sprites', chars: 'charset', bitmaps: 'bitmap' };

/** What a request does, in words: for Last run and the messages. */
export function libraryRequestText(r: ScriptLibraryRequest): string {
  const what = r.kind === 'sprites' ? `${r.data.length / 64} sprite${r.data.length === 64 ? '' : 's'}` : r.kind === 'chars' ? `${Math.floor(r.data.length / 8)} characters` : r.kind === 'bitmaps' ? `${r.mc ? 'multicolour' : 'hires'} picture, ${PICTURE_INFO[r.format ?? 'koala'].label}` : `${r.bytes.length} bytes`;
  return `${r.name} (${KIND_TEXT[r.kind]}, ${what})`;
}

const stem = (s: string) => s.toLowerCase().replace(/\.[a-z0-9]{1,4}$/, '');
const isSid = (u: Uint8Array) => u.length >= 0x7e && (u[0] === 0x50 || u[0] === 0x52) && u[1] === 0x53 && u[2] === 0x49 && u[3] === 0x44;
/** a .sid without its three texts: the same tune under another name is the same */
const sidBody = (sid: Uint8Array) => { const b = sid.slice(); b.fill(0, 0x16, 0x76); return b; };

/** `library` for a script's run; `asked` is called with each request. */
export function libraryApi(data: ScriptLibraryData | null, ctx: { mem: Uint8Array; addr: (where: unknown) => number }, asked: (r: ScriptLibraryRequest) => void): Record<string, unknown> {
  const { mem, addr } = ctx;
  const need = (): ScriptLibraryData => { if (!data) throw new Error('library: the library is not given here (the script runs where it is not: Run on files, Run with values, before Build & Run; or outside the desktop app)'); return data; };
  const made: ScriptLibraryRequest[] = [];
  const bytesOf = (v: unknown, what: string): Uint8Array => {
    if (v instanceof Uint8Array) return v;
    if (Array.isArray(v)) return Uint8Array.from(v as number[]);
    throw new TypeError(`${what}: bytes are wanted (a Uint8Array, such as mem.subarray(…) or a tune's sid())`);
  };
  const kindOf = (v: unknown, what: string): LibraryKind => {
    const k = String(v ?? '').toLowerCase();
    const found = LIBRARY_KINDS.find(x => x === k) ?? (k === 'sids' ? 'sid' : k === 'sprite' ? 'sprites' : k === 'charset' || k === 'char' ? 'chars' : k === 'bitmap' ? 'bitmaps' : null);
    if (!found) throw new RangeError(`${what}: the kind is "sid", "sprites", "chars" or "bitmaps" (not ${JSON.stringify(v)})`);
    return found;
  };
  const formatOf = (v: unknown, mc: boolean, what: string): PictureFormat => {
    if (v == null) return mc ? (data?.formats.mc ?? 'koala') : (data?.formats.hires ?? 'art');
    const f = PICTURE_FORMATS.find(x => x === v);
    if (!f) throw new RangeError(`${what}: the format is ${PICTURE_FORMATS.map(x => `"${x}"`).join(', ')} (not ${JSON.stringify(v)})`);
    return f;
  };
  const put = (b: Uint8Array, at: number, what: string) => {
    if (at + b.length > 0x10000) throw new RangeError(`${what}: ${b.length} bytes at $${at.toString(16).padStart(4, '0')} run past $ffff`);
    mem.set(b, at);
    return { start: at, end: at + b.length };
  };

  const items = (data?.items ?? []).map(i => {
    const bytes = i.data.slice();
    const pic = i.kind === 'bitmaps' ? pictureFromData(i.data, !!i.mc) : null;
    const unit = i.kind === 'sprites' ? 64 : i.kind === 'chars' ? 8 : 0;
    const one = (n: unknown, what: string) => {
      const k = Number(n), count = Math.floor(bytes.length / unit);
      if (!Number.isInteger(k) || k < 0 || k >= count) throw new RangeError(`${what}: ${i.name} has ${count}, numbered from 0 (not ${String(n)})`);
      return bytes.slice(k * unit, (k + 1) * unit);
    };
    let tune: Record<string, unknown> | null = null;
    if (i.kind === 'sid') {
      try { const p = parsePsid(i.data); tune = { name: p.name, author: p.author, released: p.released, start: p.location, end: p.location + p.size, size: p.size, init: p.init, play: p.play, songs: p.songs, song: Math.max(0, p.startSong - 1), rsid: p.rsid, bytes: p.data.slice() }; } catch { tune = null; }
    }
    const item: Record<string, unknown> = {
      kind: i.kind, name: i.name, file: i.file, bytes, size: bytes.length, load: i.load ?? null, added: i.added, hash: i.hash, own: !!i.own,
      from: i.from ? { text: i.from.text ?? null, project: i.from.project ?? null, file: i.from.file ?? null, disk: i.from.disk ?? null, start: i.from.start ?? null, end: i.from.end ?? null } : null,
      mc: !!i.mc, colors: i.colors ? { ...i.colors } : null, count: unit ? Math.floor(bytes.length / unit) : 1,
      ...(i.kind === 'sprites' ? { sprite: (n: unknown) => one(n, 'sprite') } : {}), ...(i.kind === 'chars' ? { char: (n: unknown) => one(n, 'char') } : {}),
      ...(i.kind === 'sid' ? { tune } : {}),
      ...(pic ? { bitmap: pic.bitmap, screen: pic.screen, colorRam: pic.color, background: pic.bg } : {}),
      asFile(format?: unknown): Uint8Array {
        if (pic) return writePicture(formatOf(format, pic.mc, 'asFile'), pic);
        return i.kind === 'chars' ? charsetFile(bytes, i.load ?? 0x2000) : bytes.slice();
      },
      put(at?: unknown) {
        if (pic) {
          const o = (at && typeof at === 'object' ? at : null) as { bitmap?: unknown; screen?: unknown; colorRam?: unknown } | null;
          if (!o || (o.bitmap == null && o.screen == null && o.colorRam == null)) throw new TypeError('put: a picture goes to put({ bitmap, screen, colorRam }): an address for each part that is wanted');
          const done: { start: number; end: number }[] = [];
          if (o.bitmap != null) done.push(put(pic.bitmap, addr(o.bitmap), 'put'));
          if (o.screen != null) done.push(put(pic.screen, addr(o.screen), 'put'));
          if (o.colorRam != null) done.push(put(pic.color, addr(o.colorRam), 'put'));
          return { start: Math.min(...done.map(d => d.start)), end: Math.max(...done.map(d => d.end)) };
        }
        if (i.kind === 'sid') {
          if (!tune) throw new Error(`put: ${i.file} is not a .sid Mimir reads`);
          return put(tune.bytes as Uint8Array, at == null ? (tune.start as number) : addr(at), 'put');
        }
        if (at == null && i.load == null) throw new TypeError(`put: where? ${i.name} has no load address: put(address)`);
        return put(bytes, at == null ? i.load! : addr(at), 'put');
      },
    };
    return item;
  });
  const of = (kind: LibraryKind) => items.filter(i => i.kind === kind);
  const kindArg = (v: unknown, what: string) => (v == null ? null : kindOf(v, what));

  const api: Record<string, unknown> = {
    items, sids: of('sid'), sprites: of('sprites'), chars: of('chars'), bitmaps: of('bitmaps'),
    find(name: unknown, kind?: unknown) {
      const k = kindArg(kind, 'library.find'), n = String(name ?? '').toLowerCase(), list = k ? of(k) : items;
      return list.find(i => (i.name as string).toLowerCase() === n || (i.file as string).toLowerCase() === n) ?? list.find(i => stem(i.file as string) === stem(n)) ?? null;
    },
    search(text: unknown, kind?: unknown) {
      const k = kindArg(kind, 'library.search'), t = String(text ?? '').toLowerCase();
      return (k ? of(k) : items).filter(i => { const f = i.from as Record<string, unknown> | null; return [i.name, i.file, f?.text, f?.project, f?.file, f?.disk].some(s => typeof s === 'string' && s.toLowerCase().includes(t)); });
    },
    same(kind: unknown, bytes: unknown) {
      const k = kindOf(kind, 'library.same'), b = bytesOf(bytes, 'library.same');
      const hash = libraryHash(k === 'sid' ? sidBody(b) : b);
      return of(k).find(i => (k === 'sid' ? libraryHash(sidBody(i.bytes as Uint8Array)) : i.hash) === hash) ?? null;
    },
    add(kind: unknown, what: unknown, o: { name?: unknown; from?: unknown; mc?: unknown; colors?: unknown; load?: unknown; format?: unknown; author?: unknown } = {}) {
      need();
      const k = kindOf(kind, 'library.add');
      if (made.length >= LIBRARY_REQUESTS) throw new RangeError(`library.add: a run adds ${LIBRARY_REQUESTS} things at most`);
      const name = String(o?.name ?? '').trim();
      if (!name) throw new TypeError('library.add: a name is wanted (library.add(kind, bytes, { name }))');
      const from: LibrarySource | undefined = typeof o.from === 'string' ? (o.from.trim() ? { text: o.from.trim().slice(0, 200) } : undefined) : undefined;
      const colors = (() => {
        if (o.colors == null) return undefined;
        const c = o.colors as Partial<LibraryColors>, ok = (v: unknown) => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 15;
        if (typeof c !== 'object' || !ok(c.bg) || !ok(c.fg) || !ok(c.mc1) || !ok(c.mc2)) throw new RangeError('library.add: colors is { bg, fg, mc1, mc2 }, C64 colour numbers 0-15');
        return { bg: c.bg!, fg: c.fg!, mc1: c.mc1!, mc2: c.mc2! };
      })();
      let r: ScriptLibraryRequest;
      if (k === 'bitmaps') {
        const p = what as { bitmap?: unknown; screen?: unknown; colorRam?: unknown; background?: unknown; mc?: unknown } | null;
        if (!p || typeof p !== 'object' || p instanceof Uint8Array || Array.isArray(p) || p.bitmap == null) throw new TypeError('library.add: a picture is { bitmap, screen, colorRam, background, mc }: 8000 bytes of bitmap, 1000 of screen and of colour RAM');
        const bitmap = bytesOf(p.bitmap, 'library.add');
        if (bitmap.length < 8000) throw new RangeError(`library.add: a bitmap is 8000 bytes (not ${bitmap.length})`);
        const mc = p.mc == null ? (o.mc == null ? true : !!o.mc) : !!p.mc;
        const pic = picture({ mc, bitmap, screen: p.screen == null ? new Uint8Array(1000) : bytesOf(p.screen, 'library.add'), ...(p.colorRam != null ? { color: bytesOf(p.colorRam, 'library.add') } : {}), bg: Number(p.background ?? 0) & 15 });
        const format = formatOf(o.format, mc, 'library.add');
        if (PICTURE_INFO[format].mc !== mc) throw new RangeError(`library.add: ${PICTURE_INFO[format].label} is a ${PICTURE_INFO[format].mc ? 'multicolour' : 'hires'} format, the picture is ${mc ? 'multicolour' : 'hires'}`);
        r = { kind: k, name, bytes: writePicture(format, pic), data: pictureData(pic), format, mc };
      } else {
        const b = bytesOf(what, 'library.add');
        if (!b.length) throw new RangeError('library.add: there are no bytes');
        if (k === 'sid') {
          if (!isSid(b)) throw new TypeError('library.add: a SID is added as a .sid file (a tune\'s sid(), or sid.make(bytes, { load, init, play }))');
          const file = sidWithTexts(b, { name, ...(o.author != null ? { author: String(o.author) } : {}) });
          r = { kind: k, name, bytes: file, data: file };
        } else if (k === 'sprites') {
          const file = spriteFile(b.subarray(0, 0x10000));
          r = { kind: k, name, bytes: file, data: file, mc: !!o.mc, ...(colors ? { colors } : {}) };
        } else {
          if (b.length < 8) throw new RangeError('library.add: a charset is 8 bytes a character');
          const whole = b.slice(0, Math.min(0x10000, b.length - (b.length % 8)));
          r = { kind: k, name, bytes: charsetFile(whole, o.load == null ? 0x2000 : addr(o.load)), data: whole, mc: !!o.mc, ...(colors ? { colors } : {}) };
        }
      }
      if (from) r.from = from;
      made.push(r); asked(r);
    },
  };
  const get = (name: string, f: () => unknown) => Object.defineProperty(api, name, { enumerable: true, get: f });
  get('folder', () => data?.dir ?? '');
  get('requests', () => made.map(libraryRequestText));
  return api;
}
