/* Project creation and the on-disk `.mimir.json` format (file bytes as base64). */
import { LEGACY_PROJECT_FORMAT, type AsmBookmark, type AsmProjectInfo, type Cartridge, type FileInput, type LoadedFile, type Project, type SerializedProject, type Settings } from './types';
import { DEFAULT_SETTINGS } from './model';
import { makeDemo } from './demo';
import { parsePrg } from './c64/prg';
import { safeStem } from './util/names';
import { readTemplate } from './build-template';

export const newId = (): string =>
  typeof globalThis.crypto?.randomUUID === 'function' ? globalThis.crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 9);

export const b64enc = (u8: Uint8Array): string => {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, Array.from(u8.subarray(i, i + 0x8000)));
  return btoa(s);
};
export const b64dec = (s: string): Uint8Array => { const b = atob(s); const u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; };

/** File name -> project name usable as a source file name (never starting with a -, see safeStem). */
export const projectNameFor = (fileName: string): string => safeStem(fileName.replace(/\.[^.]*$/, ''), 'project');

export const withId = (f: FileInput): LoadedFile => ({ id: f.id || newId(), name: f.name, load: f.load, bytes: f.bytes, ...(f.vsf ? { vsf: f.vsf } : {}), ...(f.chip != null ? { chip: f.chip } : {}) });

/** `cart`: the cartridge image the files are chips of (spec 13.9) */
export function createProject(init: { name?: string; files: FileInput[]; settings?: Partial<Settings>; cart?: Cartridge | null; asm?: AsmProjectInfo | null }): Project {
  return {
    format: 'mimir-project', version: 1,
    name: init.name || (init.cart ? projectNameFor(init.cart.name) : init.files[0] ? projectNameFor(init.files[0].name) : 'project'),
    files: init.files.map(withId),
    overrides: [], entries: [], entryPoint: null, labels: {}, comments: {}, blockComments: {}, notes: {}, bankZones: [], relocs: [], excluded: [], binary: [], bookmarks: {}, scripts: {}, patches: [],
    cart: init.cart ?? null,
    ...(init.asm ? { asm: asmInfo(init.asm) } : {}),
    settings: Object.assign({}, DEFAULT_SETTINGS, init.settings || {}),
  };
}
/** an Assembler project's info as it is kept: the language one of the two, the main file a path or nothing, its own
 *  arguments for the assembler and its bookmarks if it has any */
function asmInfo(a: AsmProjectInfo): AsmProjectInfo {
  const args = a.args?.trim();
  const bookmarks = Object.entries(a.bookmarks ?? {}).filter(([, b]) => b && b.file && b.line >= 1);
  return {
    lang: a.lang === '64tass' ? '64tass' : 'kickass', main: a.main || null, ...(args ? { args } : {}),
    ...(bookmarks.length ? { bookmarks: Object.fromEntries(bookmarks.map(([id, b]) => [id, asmBookmark(b)])) } : {}),
  };
}
/** a bookmark as it is kept: an area's end only past its line, the colour only when it has one */
const asmBookmark = (b: AsmBookmark): AsmBookmark => ({
  file: b.file, line: Math.floor(b.line), ...(b.end != null && b.end > b.line ? { end: Math.floor(b.end) } : {}), title: b.title ?? '', text: b.text ?? '', ...(b.color ? { color: b.color } : {}),
});

export function demoProject(settings?: Partial<Settings>): Project {
  const d = makeDemo();
  return createProject({ name: 'raster-demo', files: [parsePrg(d.name, d.prg)], settings });
}

export function serializeProject(p: Project): SerializedProject {
  return {
    format: 'mimir-project', version: 1, name: p.name,
    files: p.files.map(f => ({ name: f.name, load: f.load, data: b64enc(f.bytes), ...(f.vsf ? { vsf: b64enc(f.vsf) } : {}), ...(f.chip != null ? { chip: f.chip } : {}) })),
    overrides: p.overrides, entries: p.entries, entryPoint: p.entryPoint, ...(p.entryPort != null ? { entryPort: p.entryPort } : {}), ...(p.entryIo ? { entryIo: p.entryIo } : {}), labels: p.labels, comments: p.comments, blockComments: p.blockComments, notes: p.notes, bankZones: p.bankZones, ...(p.relocs?.length ? { relocs: p.relocs } : {}), excluded: p.excluded, binary: p.binary, bookmarks: p.bookmarks, scripts: p.scripts, ...(p.pack ? { pack: p.pack } : {}),
    ...(p.buildTemplate ? { buildTemplate: p.buildTemplate } : {}),
    ...(p.zpPairs && Object.keys(p.zpPairs).length ? { zpPairs: p.zpPairs } : {}),
    ...(p.blanks && Object.keys(p.blanks).length ? { blanks: p.blanks } : {}),
    ...(p.junk?.length ? { junk: p.junk } : {}),
    ...(p.viewOffsets?.length ? { viewOffsets: p.viewOffsets } : {}),
    ...(p.breakpoints?.length ? { breakpoints: p.breakpoints } : {}),
    ...(p.watches?.length ? { watches: p.watches } : {}),
    ...(p.patches?.length ? { patches: p.patches.map(({ id: _, bytes, old, ...q }) => ({ ...q, bytes: b64enc(bytes), old: b64enc(old) })) } : {}),
    ...(p.userScripts?.length ? { userScripts: p.userScripts.map(({ pads, ...u }) => ({ ...u, pads: pads.map(({ bytes, data, ...d }) => ({ ...d, ...(bytes ? { bytes: b64enc(bytes) } : {}), ...(data ? { data: b64enc(data) } : {}) })) })) } : {}),
    ...(p.cart ? { cart: { name: p.cart.name, data: b64enc(p.cart.crt) } } : {}),
    ...(p.asm ? { asm: (({ lang, main, args, bookmarks }) => ({ lang, ...(main ? { main } : {}), ...(args ? { args } : {}), ...(bookmarks ? { bookmarks } : {}) }))(asmInfo(p.asm)) } : {}),
    settings: p.settings,
  };
}

/** Accepts an already shape-checked object (the Electron main process validates with zod first). */
export function deserializeProject(o: SerializedProject): Project {
  if (!o || (o.format !== 'mimir-project' && o.format !== LEGACY_PROJECT_FORMAT) || !Array.isArray(o.files)) throw new Error('This file is not a Mimir project (.mimir.json).');
  return {
    format: 'mimir-project', version: 1,
    name: o.name || 'project', files: o.files.map(f => ({ id: newId(), name: f.name, load: f.load, bytes: b64dec(f.data), ...(f.vsf ? { vsf: b64dec(f.vsf) } : {}), ...(o.cart && f.chip != null ? { chip: f.chip } : {}) })),
    overrides: o.overrides || [], entries: o.entries || [], entryPoint: o.entryPoint ?? null, ...(o.entryPoint != null && o.entryPort != null ? { entryPort: o.entryPort } : {}), ...(o.entryPoint != null && o.entryIo ? { entryIo: o.entryIo } : {}), labels: o.labels || {}, comments: o.comments || {}, blockComments: o.blockComments || {}, notes: o.notes || {}, bankZones: o.bankZones || [], relocs: o.relocs || [], excluded: o.excluded || [], binary: o.binary || [], bookmarks: o.bookmarks || {}, scripts: o.scripts || {}, pack: o.pack ?? null,
    ...(readTemplate(o.buildTemplate) ? { buildTemplate: readTemplate(o.buildTemplate) } : {}),
    ...(o.zpPairs && Object.keys(o.zpPairs).length ? { zpPairs: o.zpPairs } : {}),
    ...(o.blanks && Object.keys(o.blanks).length ? { blanks: o.blanks } : {}),
    ...(o.junk?.length ? { junk: o.junk } : {}),
    ...(o.viewOffsets?.length ? { viewOffsets: o.viewOffsets } : {}),
    ...(o.breakpoints?.length ? { breakpoints: o.breakpoints } : {}),
    ...(o.watches?.length ? { watches: o.watches } : {}),
    patches: (o.patches || []).map(q => ({ ...q, id: newId(), bytes: b64dec(q.bytes), old: b64dec(q.old) })),
    ...(o.userScripts?.length ? { userScripts: o.userScripts.map(u => ({ ...u, id: u.id || newId(), pads: u.pads.map(({ bytes, data, ...d }) => ({ ...d, ...(bytes != null ? { bytes: b64dec(bytes) } : {}), ...(data != null ? { data: b64dec(data) } : {}) })) })) } : {}),
    cart: o.cart ? { name: o.cart.name, crt: b64dec(o.cart.data) } : null,
    ...(o.asm ? { asm: asmInfo(o.asm) } : {}),
    settings: Object.assign({}, DEFAULT_SETTINGS, o.settings || {}),
  };
}
