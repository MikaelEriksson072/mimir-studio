/* The macro and code libraries as files (spec 10.8): the folders Macros and Code in the library's folder, a file an item
 * (its code, with a line at the top that says the rest: core's code-library.ts). Only this store touches the folders;
 * the renderer names a file by its kind and its plain name there. One change at a time (a queue), as the library's
 * other files.
 *
 * A file of the macro library with several macros is a collection (irq_lib.asm): a macro is put in one, changed in its
 * place, moved to another or out to a file of its own, taken out (to the Recycle Bin as a file of its own). Files are
 * put in a library from anywhere (imported: the code as it is, the line at the top added), and macros exported to a
 * file anywhere or to a collection; where an item was exported to (or imported from) is remembered here, with what
 * was written there, so Export again writes there and says so when the file was changed since. */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { z } from 'zod';
import {
  CODE_LIB_FILE_MAX, CODE_LIB_FOLDERS, CODE_LIB_KINDS, codeLibDecor, codeLibFileName, codeLibFileText, codeLibIsMacro, codeLibNameOf, codeLibPlain, codeLibPutSub, codeLibRenameMacro, codeLibStem,
  codeLibSubs, codeLibSubText, codeLibTakeOutSub, isCodeLibFileName, macroName, readCodeLibFile, type CodeLibItem, type CodeLibKind, type CodeLibMeta, type CodeLibSub, type ScriptLang,
} from '@mimir/core';
import type { CodeLibChange, CodeLibExportRequest, CodeLibExportResult, CodeLibFileRequest, CodeLibImportResult, CodeLibListing, CodeLibSaveRequest } from '../../shared/ipc';

/** where each item was exported to (or imported from), by `kind/file`, and the hash of what is there as Mimir left it */
const stateSchema = z.record(z.string().max(200), z.object({ path: z.string().min(1).max(4096), hash: z.string().max(128), lines: z.boolean() }));
type ExportState = z.infer<typeof stateSchema>;

const keyOf = (kind: CodeLibKind, file: string) => `${kind}/${file}`;
const hashOf = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
/** an item's description as a file's line keeps it: none when its code's comments above its macro are it already */
const ownDescription = (i: CodeLibItem): string => (!i.collection && i.description && codeLibSubs(i.code, i.lang)[0]?.description === i.description ? '' : i.description);
const metaOf = (i: CodeLibItem): CodeLibMeta => ({ lang: i.lang, description: ownDescription(i), created: i.created, ...(i.color ? { color: i.color } : {}), ...(i.from ? { from: i.from } : {}), ...(i.collection ? { collection: true } : {}) });
const commentBlock = (text: string, lang: ScriptLang) => text.trim().split('\n').map(l => `${lang === '64tass' ? ';' : '//'}${l.trim() ? ` ${l.trimEnd()}` : ''}`).join('\n');

export class CodeLibStore {
  private queue: Promise<unknown> = Promise.resolve();
  private exportsSeen: ExportState | null = null;
  /** `rootOf`: the library's folder now (the settings can change it); `trash`: a file moved to the Recycle Bin;
   *  `now`: the time an item is made at; `stateFile`: where the exports are remembered (none: for this run only) */
  constructor(private readonly rootOf: () => string, private readonly trash: (path: string) => Promise<void>, private readonly now: () => number = Date.now, private readonly stateFile?: string) {}

  private run<T>(fn: () => Promise<T>): Promise<T> { const p = this.queue.then(fn, fn); this.queue = p.catch(() => undefined); return p; }

  /** a kind's folder */
  folder(kind: CodeLibKind): string { return join(this.rootOf(), CODE_LIB_FOLDERS[kind]); }
  /** an item's file, only by its kind and a plain name */
  path(kind: CodeLibKind, file: string): string {
    if (!isCodeLibFileName(file)) throw new Error(`"${file}" is not a file of the ${CODE_LIB_FOLDERS[kind]} library`);
    return join(this.folder(kind), file);
  }

  /* ---- where items were exported to ---- */
  private exports(): ExportState {
    if (this.exportsSeen) return this.exportsSeen;
    this.exportsSeen = {};
    try { if (this.stateFile && existsSync(this.stateFile)) this.exportsSeen = stateSchema.parse(JSON.parse(readFileSync(this.stateFile, 'utf8'))); } catch { /* unreadable: nothing remembered */ }
    return this.exportsSeen;
  }
  private async remember(key: string, value: ExportState[string] | null, to?: string): Promise<void> {
    const s = this.exports();
    if (to && s[key]) { s[to] = s[key]; delete s[key]; } else if (value) s[key] = value; else if (s[key]) delete s[key]; else return;
    if (this.stateFile) await writeFile(this.stateFile, JSON.stringify(s, null, 1), 'utf8').catch(() => undefined);
  }

  /* ---- reading ---- */
  private async readItem(kind: CodeLibKind, file: string): Promise<CodeLibItem | null> {
    try {
      const p = this.path(kind, file), st = await stat(p);
      if (!st.isFile() || st.size > CODE_LIB_FILE_MAX) return null;
      return readCodeLibFile(kind, file, await readFile(p, 'utf8'), { changed: st.mtimeMs, born: st.birthtimeMs });
    } catch { return null; }
  }
  private async items(kind: CodeLibKind): Promise<CodeLibItem[]> {
    let names: string[] = [];
    try { names = await readdir(this.folder(kind)); } catch { return []; }
    const out: CodeLibItem[] = [];
    for (const file of names) {
      if (!isCodeLibFileName(file)) continue;
      const item = await this.readItem(kind, file);
      if (item) out.push(item);
    }
    return out;
  }
  private async read(): Promise<CodeLibListing> {
    const items: CodeLibItem[] = [];
    for (const kind of CODE_LIB_KINDS) items.push(...await this.items(kind));
    const there = new Set(items.map(i => keyOf(i.kind, i.file)));
    const exports = Object.fromEntries(Object.entries(this.exports()).filter(([k]) => there.has(k)).map(([k, v]) => [k, { path: v.path, lines: v.lines }]));
    return { dir: this.rootOf(), folders: { macro: this.folder('macro'), code: this.folder('code') }, items, exports };
  }
  private async change(item: { kind: CodeLibKind; file: string }, macro?: string): Promise<CodeLibChange> {
    const listing = await this.read();
    const it = listing.items.find(i => i.kind === item.kind && i.file === item.file);
    if (!it) throw new Error(`${item.file} could not be read back from the library`);
    return { item: it, listing, ...(macro ? { macro } : {}) };
  }

  /** the macros and the code in the folders */
  list(): Promise<CodeLibListing> { return this.run(() => this.read()); }

  /* ---- writing ---- */
  /** an item's file written as it is with other code (a collection's changed) */
  private async rewrite(item: CodeLibItem, code: string): Promise<void> {
    const text = codeLibFileText(metaOf(item), code);
    if (text.length > CODE_LIB_FILE_MAX) throw new Error(`${item.name} would be too long for the library`);
    await writeFile(this.path(item.kind, item.file), text, 'utf8');
  }
  /** a new file in a kind's folder, under a name made unique there */
  private async create(kind: CodeLibKind, name: string, meta: CodeLibMeta, code: string): Promise<string> {
    const folder = this.folder(kind);
    await mkdir(folder, { recursive: true });
    const file = codeLibFileName(name, await readdir(folder));
    const text = codeLibFileText(meta, code);
    if (text.length > CODE_LIB_FILE_MAX) throw new Error('the code is too long for the library');
    await writeFile(join(folder, file), text, { encoding: 'utf8', flag: 'wx' });
    return file;
  }
  /** an item's file to the Recycle Bin, and what was remembered of it forgotten */
  private async drop(kind: CodeLibKind, file: string): Promise<void> {
    const p = this.path(kind, file);
    if (existsSync(p)) await this.trash(p);
    await this.remember(keyOf(kind, file), null);
  }
  /** a macro of a collection to the Recycle Bin as a file of its own (so it can be found again there) */
  private async trashMacro(coll: CodeLibItem, s: CodeLibSub): Promise<void> {
    const dir = await mkdtemp(join(tmpdir(), 'mimir-macro-'));
    try {
      const p = join(dir, codeLibFileName(s.name, []));
      await writeFile(p, codeLibFileText({ lang: coll.lang, description: s.description, created: s.created ?? coll.created, ...(s.color ? { color: s.color } : {}), from: coll.name }, s.code), 'utf8');
      await this.trash(p);
    } finally { await rm(dir, { recursive: true, force: true }).catch(() => undefined); }
  }
  /** the collection a macro is put in: one of the macro library, by its file or its name (any case) */
  private async collection(into: { file: string } | { name: string }): Promise<CodeLibItem | null> {
    if ('file' in into) {
      const c = await this.readItem('macro', into.file);
      if (!c) throw new Error(`${into.file} is not in the macro library any more`);
      if (!c.collection) throw new Error(`${c.name} is a macro of its own, not a collection`);
      return c;
    }
    const stem = codeLibStem(into.name).toLowerCase();
    const c = (await this.items('macro')).find(i => i.name.toLowerCase() === stem) ?? null;
    if (c && !c.collection) throw new Error(`${c.name} is a macro of its own, not a collection: give the collection another name`);
    return c;
  }

  /**
   * An item written: a new one (`was` missing) in its kind's folder under its name (made unique there), made now; one
   * of the library (`was`) in its place, renamed when its name changed, moved to the other folder when its kind did;
   * when it was made stays as its file says. A macro of a collection, or one going into one: saveMacro.
   */
  save(req: CodeLibSaveRequest): Promise<CodeLibChange> {
    return this.run(async () => {
      if (req.kind === 'macro' && (req.was?.macro || req.into)) return this.saveMacro(req);
      if (req.was?.macro) throw new Error('A macro of a collection stays in the macro library');
      const folder = this.folder(req.kind);
      await mkdir(folder, { recursive: true });
      let created = this.now(), collection = req.collection;
      const old = req.was ? this.path(req.was.kind, req.was.file) : null;
      const was = req.was;
      if (old && was) {
        if (!existsSync(old)) throw new Error(`${was.file} is not in the ${CODE_LIB_FOLDERS[was.kind]} library any more`);
        const item = await this.readItem(was.kind, was.file);
        if (item) { created = item.created; collection ??= item.collection && req.kind === 'macro'; }
      }
      // its own file is not another's name; its name as it was (any case) keeps its file's extension (.s, .inc …)
      const stay = !!was && was.kind === req.kind;
      const taken = (await readdir(folder)).filter(f => !(stay && f.toLowerCase() === was!.file.toLowerCase()));
      const stem = codeLibStem(req.name);
      const file = stay && codeLibNameOf(was!.file).toLowerCase() === stem.toLowerCase() ? `${stem}${/\.[^.]+$/.exec(was!.file)![0]}` : codeLibFileName(req.name, taken);
      const text = codeLibFileText({ lang: req.lang, description: req.description, created, ...(req.color ? { color: req.color } : {}), ...(req.from ? { from: req.from } : {}), ...(collection ? { collection: true } : {}) }, req.code);
      if (text.length > CODE_LIB_FILE_MAX) throw new Error('the code is too long for the library');
      const p = join(folder, file);
      // (a rename where only the letters' case changed too)
      if (old && old !== p) await rename(old, p);
      await writeFile(p, text, { encoding: 'utf8', ...(old ? {} : { flag: 'wx' }) });
      if (was && keyOf(was.kind, was.file) !== keyOf(req.kind, file)) await this.remember(keyOf(was.kind, was.file), null, keyOf(req.kind, file));
      return this.change({ kind: req.kind, file });
    });
  }

  /**
   * A macro put in a collection (`into`), changed in its place in one (`was.macro`, into the same), moved from one to
   * another or out to a file of its own (no `into`), or a macro of its own moved into one (its file to the Recycle Bin).
   * Its name is its macro's (its definition renamed to it); when it was made stays.
   */
  private async saveMacro(req: CodeLibSaveRequest): Promise<CodeLibChange> {
    const lang = req.lang;
    let code = req.code.replace(/\r\n/g, '\n').replace(/\s+$/, '');
    const def = codeLibIsMacro(code, lang);
    if (!def) throw new Error('A collection takes one macro at a time: its definition (comments around it too)');
    const name = macroName(req.name) || def.name;
    if (def.name !== name) code = codeLibRenameMacro(code, lang, def.name, name);
    // (the comments above its definition are its lines' in the collection: its description, when none was given)
    const sub = codeLibSubs(code, lang)[0];
    const description = req.description.trim() ? req.description : sub?.description ?? '';
    if (sub && sub.top < sub.line) code = sub.code;

    // where it was
    const was = req.was;
    let from: CodeLibItem | null = null, fromSub: CodeLibSub | undefined;
    if (was) {
      from = await this.readItem(was.kind, was.file);
      if (!from) throw new Error(`${was.file} is not in the ${CODE_LIB_FOLDERS[was.kind]} library any more`);
      if (was.macro) { fromSub = from.macros?.find(s => s.name === was.macro); if (!fromSub) throw new Error(`${was.macro} is not in ${from.name} any more`); }
    }
    const made = fromSub ? fromSub.created ?? from!.created : from ? from.created : this.now();
    const content = { code, description, ...(req.color ? { color: req.color } : {}) };

    // out of its collection into a file of its own
    if (!req.into) {
      const file = await this.create('macro', req.name, { lang, description, created: made, ...(req.color ? { color: req.color } : {}), ...(req.from ?? from?.from ? { from: req.from ?? from?.from } : {}) }, code);
      if (from && fromSub) await this.rewrite(from, codeLibTakeOutSub(from.code, from.lang, fromSub.name));
      return this.change({ kind: 'macro', file });
    }
    const target = await this.collection(req.into);
    if (target && target.lang !== lang) throw new Error(`${target.name} is written for ${target.lang === '64tass' ? '64tass' : 'Kick Assembler'}`);
    const same = !!target && !!fromSub && target.file === from!.file;
    const clash = target?.macros?.find(s => s.name === name && !(same && s.name === fromSub!.name));
    if (clash) throw new Error(`${target!.name} has a macro named ${name} already`);

    // in its place in the same collection (its own time only when it had one)
    if (same) {
      const text = codeLibSubText({ ...content, ...(fromSub!.created ? { created: fromSub!.created } : {}) }, lang, fromSub!.decor ?? codeLibDecor(target!.macros ?? []));
      await this.rewrite(target!, codeLibPutSub(target!.code, lang, text, fromSub!.name));
      return this.change(target!, name);
    }
    // in another collection, or a new one
    const text = codeLibSubText({ ...content, created: made }, lang, target ? codeLibDecor(target.macros ?? []) : undefined);
    let file: string;
    if (target) { await this.rewrite(target, codeLibPutSub(target.code, lang, text)); file = target.file; }
    else file = await this.create('macro', (req.into as { name: string }).name, { lang, description: '', created: this.now(), collection: true }, text);
    // and no more where it was
    if (from && fromSub) await this.rewrite(from, codeLibTakeOutSub(from.code, from.lang, fromSub.name));
    else if (from && was) await this.drop(was.kind, was.file);
    return this.change({ kind: 'macro', file }, name);
  }

  /** an item's file to the Recycle Bin; a collection's macro (`macro`) taken out of it, to the Recycle Bin as a file */
  remove(req: CodeLibFileRequest): Promise<CodeLibListing> {
    return this.run(async () => {
      if (req.macro) {
        const c = await this.readItem(req.kind, req.file);
        const s = c?.macros?.find(m => m.name === req.macro);
        if (c && s) { await this.trashMacro(c, s); await this.rewrite(c, codeLibTakeOutSub(c.code, c.lang, s.name)); }
        return this.read();
      }
      await this.drop(req.kind, req.file);
      return this.read();
    });
  }

  /**
   * Files put in a library from anywhere (the open dialog's): each copied in as it is, under its name (made unique),
   * with the line at the top that says what it is (its assembler guessed, made when the file was, from its path; a
   * file with several macros a collection). Where it came from is remembered: Export again writes it back there.
   */
  importFiles(kind: CodeLibKind, paths: readonly string[]): Promise<CodeLibImportResult> {
    return this.run(async () => {
      const folder = this.folder(kind);
      await mkdir(folder, { recursive: true });
      const taken = await readdir(folder);
      const imported: CodeLibFileRequest[] = [], skipped: string[] = [];
      for (const path of paths) {
        const shown = basename(path);
        try {
          const st = await stat(path);
          if (!st.isFile()) { skipped.push(`${shown}: not a file`); continue; }
          if (st.size > CODE_LIB_FILE_MAX) { skipped.push(`${shown}: larger than 1 MB`); continue; }
          const bytes = await readFile(path), text = bytes.toString('utf8');
          if (text.includes('\u0000')) { skipped.push(`${shown}: not a text file`); continue; }
          const file = codeLibFileName(shown.replace(/\.[^.]*$/, '') || shown, taken);
          const probe = readCodeLibFile(kind, file, text, { changed: st.mtimeMs, born: st.birthtimeMs });
          if (!probe) { skipped.push(`${shown}: not a source`); continue; }
          // (one written by Mimir with its lines is put in as it is)
          const out = probe.own ? codeLibFileText({ lang: probe.lang, description: '', created: probe.created, from: path, ...(probe.collection ? { collection: true } : {}) }, text) : text;
          await writeFile(join(folder, file), out, { encoding: 'utf8', flag: 'wx' });
          taken.push(file);
          await this.remember(keyOf(kind, file), { path, hash: hashOf(bytes), lines: !probe.own });
          imported.push({ kind, file });
        } catch (e) { skipped.push(`${shown}: ${e instanceof Error ? e.message : String(e)}`); }
      }
      return { listing: await this.read(), imported, skipped };
    });
  }

  /**
   * Macros exported: whole items (a collection as it is, the rest of its file too) or a collection's macros, to a file
   * (`pick` asks where: the dialog), to where an item was exported before (`again`; not when the file there was changed
   * since, unless `force`), or to a collection of the macro library (`move`: taken out of where they were). One
   * assembler's macros only. Without Mimir's lines (`lines`) the file is as one would write it by hand: each macro's
   * description as comments above it.
   */
  export(req: CodeLibExportRequest, pick: (name: string, at?: string) => Promise<string | null>): Promise<CodeLibExportResult> {
    return this.run(async () => {
      const items = new Map<string, CodeLibItem>();
      const parts: { it: CodeLibItem; sub?: CodeLibSub }[] = [];
      for (const r of req.macros) {
        const key = keyOf(r.kind, r.file);
        let it = items.get(key);
        if (!it) { it = await this.readItem(r.kind, r.file) ?? undefined; if (!it) throw new Error(`${r.file} is not in the library any more`); items.set(key, it); }
        if (!r.macro) { parts.push({ it }); continue; }
        const sub = it.macros?.find(s => s.name === r.macro);
        if (!sub) throw new Error(`${r.macro} is not in ${it.name} any more`);
        parts.push({ it, sub });
      }
      if (!parts.length) throw new Error('There are no macros to export');
      const lang = parts[0].it.lang;
      if (parts.some(p => p.it.lang !== lang)) throw new Error('Kick Assembler and 64tass macros do not go in one file: export them apart');
      const count = parts.reduce((n, p) => n + (p.sub ? 1 : p.it.collection ? p.it.macros?.length ?? 0 : 1), 0);
      if (typeof req.to === 'object') return this.intoCollection(parts, req.to.collection, lang, !!req.move);

      const whole = parts.length === 1 && !parts[0].sub ? parts[0].it : null;
      const key = whole ? keyOf(whole.kind, whole.file) : null;
      const before = key ? this.exports()[key] : undefined;
      let path: string | null, lines = req.lines;
      if (req.to === 'again') {
        if (!whole || !before) throw new Error('It was not exported before: Export… chooses the file');
        path = before.path; lines = before.lines;
        if (existsSync(path) && !req.force && hashOf(await readFile(path)) !== before.hash) return { listing: await this.read(), count, path, changed: true };
      } else {
        path = await pick(`${codeLibStem(whole ? whole.name : parts.length === 1 ? parts[0].sub!.name : 'macros')}.asm`, before?.path);
        if (!path) return { listing: await this.read(), count: 0, canceled: true };
      }
      let text: string;
      if (whole && lines) text = codeLibFileText(metaOf(whole), whole.code);
      else if (whole && whole.collection) text = `${whole.description.trim() ? `${commentBlock(whole.description, lang)}\n\n` : ''}${codeLibPlain(whole.code).replace(/\s+$/, '')}\n`;
      else {
        const chunks = parts.map(({ it, sub }) => {
          if (sub) return codeLibSubText(lines ? { code: sub.code, description: sub.description, ...(sub.color ?? it.color ? { color: sub.color ?? it.color } : {}), created: sub.created ?? it.created } : { code: sub.code, description: sub.description }, lang, sub.decor);
          if (it.collection) return (lines ? it.code : codeLibPlain(it.code)).replace(/\s+$/, '');
          const s = codeLibSubs(it.code, lang);
          const one = s.length === 1 && codeLibIsMacro(it.code, lang) ? s[0] : null;
          // (a macro of its own: its comments above it its description, as in a collection)
          return codeLibSubText({ code: one ? one.code : it.code, description: it.description, ...(lines && it.color ? { color: it.color } : {}), ...(lines ? { created: it.created } : {}) }, lang, one?.decor);
        });
        const body = chunks.join('\n\n');
        text = lines ? codeLibFileText({ lang, description: '', created: this.now(), collection: true }, body) : `${body}\n`;
      }
      // (a file that has CRLF line ends keeps them)
      const crlf = existsSync(path) && (await readFile(path, 'utf8')).includes('\r\n');
      const out = crlf ? text.replace(/\r?\n/g, '\r\n') : text;
      await writeFile(path, out, 'utf8');
      if (key) await this.remember(key, { path, hash: hashOf(Buffer.from(out, 'utf8')), lines });
      return { listing: await this.read(), count, path };
    });
  }

  /** macros put in a collection of the macro library (one of that name, else a new one), taken out of where they were
   *  when they are moved */
  private async intoCollection(parts: { it: CodeLibItem; sub?: CodeLibSub }[], name: string, lang: ScriptLang, move: boolean): Promise<CodeLibExportResult> {
    const target = await this.collection({ name });
    if (target && target.lang !== lang) throw new Error(`${target.name} is written for ${target.lang === '64tass' ? '64tass' : 'Kick Assembler'}`);
    const decor = target ? codeLibDecor(target.macros ?? []) : undefined;
    const subs: { name: string; text: string }[] = [];
    const taken: { it: CodeLibItem; sub?: CodeLibSub }[] = [];
    for (const p of parts) {
      // (its own macros stay where they are)
      if (target && p.it.file === target.file && p.it.kind === 'macro') continue;
      const list = p.sub ? [p.sub] : p.it.collection ? p.it.macros ?? [] : null;
      if (list) for (const s of list) subs.push({ name: s.name, text: codeLibSubText({ code: s.code, description: s.description, ...(s.color ? { color: s.color } : {}), created: s.created ?? p.it.created }, lang, s.decor ?? decor) });
      else {
        const d = codeLibIsMacro(p.it.code, lang), s = d ? codeLibSubs(p.it.code, lang)[0] : null;
        if (!d || !s) throw new Error(`${p.it.name} is not one macro: it does not go in a collection`);
        subs.push({ name: s.name, text: codeLibSubText({ code: s.code, description: p.it.description, ...(p.it.color ? { color: p.it.color } : {}), created: p.it.created }, lang, s.decor ?? decor) });
      }
      taken.push(p);
    }
    const names = new Set(target?.macros?.map(s => s.name) ?? []), twice: string[] = [];
    for (const s of subs) { if (names.has(s.name)) twice.push(s.name); names.add(s.name); }
    if (twice.length) throw new Error(`${target ? `${target.name} has` : 'There would be'} ${twice.length === 1 ? `a macro named ${twice[0]}` : `macros named ${twice.join(', ')}`} ${target ? 'already' : 'twice'}`);
    const code = subs.reduce((c, s) => codeLibPutSub(c, lang, s.text), target?.code ?? '');
    let file: string;
    if (target) { await this.rewrite(target, code); file = target.file; }
    else file = await this.create('macro', name, { lang, description: '', created: this.now(), collection: true }, code);
    if (move) {
      // a collection's macros out of it (read again: one changed before is as it is now), the rest to the Recycle Bin
      for (const p of taken) {
        if (!p.sub) { await this.drop(p.it.kind, p.it.file); continue; }
        const now = await this.readItem(p.it.kind, p.it.file);
        if (now) await this.rewrite(now, codeLibTakeOutSub(now.code, now.lang, p.sub.name));
      }
    }
    return { listing: await this.read(), count: subs.length, collection: { kind: 'macro', file } };
  }
}
