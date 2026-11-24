/* =====================================================================
 * Tape images for a JavaScript script (spec 10.3), as `tapes`: a tape's pulses (.tap) and a tape archive (.t64) made
 * and changed (c64/tap.ts, c64/t64.ts).
 *
 *   tapes.create("tap" or "t64", { name })   a new, empty tape
 *   tapes.open(bytes)             a tape image's bytes to work on
 *   tapes.mounted                 the tape in the datasette to work on, a copy; null without one
 *   a tape: kind, name (a T64's, set too), files, size, bytes (a copy of the image as it is now)
 *     find(name or number), has(name), read(name or number), prg(name or number)
 *     add(name, bytes, { load, basic, header })   a file added after the last one: on a TAP in the KERNAL's format,
 *                                 as SAVE writes it (header and data twice), in a T64 as an entry
 *     remove(name or number), rename(name or number, to)
 *     list()                      the files, a line each
 *     file(), save(fileName), insert()   the image's bytes; a file of the run; in the datasette when the run has ended
 *     toT64(), toTap()            the same files as the other kind: a TAP's files (turbo ones too) as a T64, a T64's
 *                                 files written as a TAP in the KERNAL's format
 *   a TAP also has: version, seconds, pulses (their lengths in cycles, a copy), unknown (stretches no format reads),
 *     pause(seconds), addPulses(cycles), cut(from, to), endOfTape()
 *
 * A tape a script works on is the script's own: the tape in the datasette and the files on the PC are as they were.
 * ===================================================================== */
import { cbmFilePulses, isTap, readTape, TAPE_CLOCK, tapOfCycles, tapPulses, type TapeFile } from './c64/tap';
import { isT64, makeT64, readT64 } from './c64/t64';
import { h4 } from './util/hex';

/** the tape a script may take a copy of: the one in the datasette */
export interface ScriptTapesData { name: string; bytes: Uint8Array }
/** what a script asked for with a tape's insert(): the image to put in the datasette */
export interface ScriptTapeRequest { name: string; kind: 'tap' | 't64'; bytes: Uint8Array; files: number }

export const tapeRequestText = (r: ScriptTapeRequest): string => `${r.name} put in the datasette (${r.kind === 't64' ? 'a T64' : 'a TAP'}, ${r.files} file${r.files === 1 ? '' : 's'})`;

/** the most pulses a TAP a script makes has (four hours of short pulses) */
const MAX_PULSES = 40_000_000;

export function tapesApi(mounted: ScriptTapesData | null, ctx: { addr: (where: unknown) => number; save: (name: string, bytes: Uint8Array) => void }, asked: (r: ScriptTapeRequest) => void): Record<string, unknown> {
  const bytesOf = (v: unknown, what: string): Uint8Array => {
    if (v instanceof Uint8Array) return v;
    if (Array.isArray(v)) return Uint8Array.from(v as number[]);
    throw new TypeError(`${what}: bytes are wanted (a Uint8Array, such as mem.subarray(…) or another tape's read(…))`);
  };
  const nameOf = (v: unknown, what: string): string => {
    if (typeof v !== 'string') throw new TypeError(`${what}: a name is wanted, a text (not ${String(v)})`);
    if ([...v].length > 16) throw new RangeError(`${what}: a file's name is 16 characters at most ("${v}" is ${[...v].length})`);
    return v;
  };
  /** what a file is added with: its bytes without a load address, and where it loads (given, or the bytes' first two) */
  const program = (bytes: unknown, opts: Record<string, unknown>, what: string): { load: number; data: Uint8Array } => {
    const b = bytesOf(bytes, what);
    if (opts.load != null) return { load: ctx.addr(opts.load), data: b };
    if (b.length < 3) throw new RangeError(`${what}: the bytes start with a load address (two bytes) unless one is given: add(name, bytes, { load: 0x0801 })`);
    return { load: b[0] | (b[1] << 8), data: b.subarray(2) };
  };
  const fits = (p: { load: number; data: Uint8Array }, name: string, what: string) => { if (p.load + p.data.length > 0x10000) throw new RangeError(`${what}: "${name}" is ${p.data.length} bytes at $${h4(p.load)}, which ends past $ffff`); };
  const fileName = (n: string, ext: string) => (/\.[A-Za-z0-9]{1,4}$/.test(n) ? n : `${n}.${ext}`);
  const entry = (f: TapeFile, i: number) => Object.freeze({ number: i, name: f.name, format: f.format, type: f.type.toLowerCase(), load: f.load, end: f.end, size: f.data.length, seconds: Math.round(f.seconds * 10) / 10, errors: [...f.errors] });
  const pick = (files: readonly TapeFile[], which: unknown, what: string): number => {
    if (typeof which === 'number') { if (!Number.isInteger(which) || which < 0 || which >= files.length) throw new RangeError(`${what}: there is no file ${which} on the tape (it has ${files.length}, numbered from 0)`); return which; }
    const n = String(which ?? '').toUpperCase(), i = files.findIndex(f => f.name.toUpperCase() === n);
    if (i < 0) throw new ReferenceError(`${what}: no file "${String(which)}" on the tape`);
    return i;
  };
  const listing = (files: readonly TapeFile[]) => files.map((f, i) => `${String(i).padStart(2)}  ${`"${f.name}"`.padEnd(19)}${f.type.padEnd(6)}${f.load != null ? `$${h4(f.load)}-$${h4((f.end ?? f.load + f.data.length) - 1)}` : '           '}  ${String(f.data.length).padStart(5)} bytes${f.format !== 'cbm' && f.format !== 't64' ? `  ${f.format}` : ''}`);

  /* ---- a T64: its files, written again whenever they change ---- */
  interface T64File { name: string; raw?: Uint8Array; load: number; data: Uint8Array }
  const t64 = (files: T64File[], tapeName: string, file: string): Record<string, unknown> => {
    let name = tapeName;
    const image = () => makeT64({ name, files });
    const read = () => readT64(image()).files;
    const o = {
      kind: 't64',
      find(which: unknown) { const fs = read(); try { const i = pick(fs, which, 'find'); return entry(fs[i], i); } catch { return null; } },
      has: (n: unknown) => read().some(f => f.name.toUpperCase() === String(n).toUpperCase()),
      read(which: unknown) { return files[pick(read(), which, 'read')].data.slice(); },
      prg(which: unknown) { const f = files[pick(read(), which, 'prg')], p = new Uint8Array(f.data.length + 2); p[0] = f.load & 0xff; p[1] = f.load >> 8; p.set(f.data, 2); return p; },
      add(n: unknown, bytes: unknown, opts?: unknown) {
        const nm = nameOf(n, 'add'), p = program(bytes, (opts && typeof opts === 'object' ? opts : {}) as Record<string, unknown>, 'add');
        fits(p, nm, 'add');
        if (files.length >= 30000) throw new RangeError('add: a T64 has 30 000 files at most');
        files.push({ name: nm, load: p.load, data: p.data.slice() });
        const fs = read();
        return entry(fs[fs.length - 1], fs.length - 1);
      },
      remove(which: unknown) { const i = pick(read(), which, 'remove'), f = files.splice(i, 1)[0]; return { name: f.name, size: f.data.length }; },
      rename(which: unknown, to: unknown) { const i = pick(read(), which, 'rename'); files[i] = { name: nameOf(to, 'rename'), load: files[i].load, data: files[i].data }; },
      list: () => listing(read()),
      file: () => image(),
      save(n?: unknown) { const full = fileName(n == null ? file : String(n), 't64'); ctx.save(full, image()); return full; },
      insert(n?: unknown) { asked({ name: fileName(n == null ? file : String(n), 't64'), kind: 't64', bytes: image(), files: files.length }); },
      toTap() { return tap(files.length ? Array.from(cbmFilePulses(files.map(f => ({ name: f.name, data: f.data, load: f.load })), true)) : [], file.replace(/\.t64$/i, '.tap')); },
      toString: () => `T64 "${name}": ${files.length} file${files.length === 1 ? '' : 's'}`,
    };
    Object.defineProperties(o, {
      name: { enumerable: true, get: () => name, set: (v: unknown) => { const s = String(v); if ([...s].length > 24) throw new RangeError(`a T64's name is 24 characters at most ("${s}" is ${[...s].length})`); name = s; } },
      files: { enumerable: true, get: () => read().map(entry) },
      size: { enumerable: true, get: () => image().length },
      bytes: { enumerable: true, get: () => image() },
    });
    return o;
  };

  /* ---- a TAP: its pulses, read again whenever they change ---- */
  const tap = (pulses: number[], file: string): Record<string, unknown> => {
    let seen: { files: TapeFile[]; unknown: ReturnType<typeof readTape>['unknown'] } | null = null;
    const image = () => tapOfCycles(pulses);
    const read = () => (seen ??= (r => ({ files: r.files, unknown: r.unknown }))(readTape(image())));
    const changed = () => { seen = null; };
    const room = (n: number, what: string) => { if (pulses.length + n > MAX_PULSES) throw new RangeError(`${what}: the tape would have more than ${MAX_PULSES.toLocaleString('en-US')} pulses`); };
    const append = (c: ArrayLike<number>) => { for (let i = 0; i < c.length; i++) pulses.push(c[i]); changed(); };
    const o = {
      kind: 'tap', version: 1,
      find(which: unknown) { const fs = read().files; try { const i = pick(fs, which, 'find'); return entry(fs[i], i); } catch { return null; } },
      has: (n: unknown) => read().files.some(f => f.name.toUpperCase() === String(n).toUpperCase()),
      read(which: unknown) { const fs = read().files; return fs[pick(fs, which, 'read')].data.slice(); },
      prg(which: unknown) {
        const fs = read().files, f = fs[pick(fs, which, 'prg')];
        if (f.load == null) throw new Error(`prg: the tape does not say where "${f.name}" loads: read() gives its bytes`);
        const p = new Uint8Array(f.data.length + 2); p[0] = f.load & 0xff; p[1] = f.load >> 8; p.set(f.data, 2); return p;
      },
      add(n: unknown, bytes: unknown, opts?: unknown) {
        const q = (opts && typeof opts === 'object' ? opts : {}) as Record<string, unknown>, nm = nameOf(n, 'add'), p = program(bytes, q, 'add');
        fits(p, nm, 'add');
        const header = q.header != null ? bytesOf(q.header, 'add') : undefined;
        if (header && header.length > 171) throw new RangeError(`add: the header's rest is 171 bytes at most (the tape buffer from $0351), not ${header.length}`);
        const c = cbmFilePulses([{ name: nm, data: p.data, load: p.load, ...(q.basic ? { basic: true } : {}), ...(header ? { header } : {}) }], pulses.length === 0);
        room(c.length, 'add');
        append(c);
        const fs = read().files;
        return entry(fs[fs.length - 1], fs.length - 1);
      },
      remove(which: unknown) {
        const fs = read().files, f = fs[pick(fs, which, 'remove')];
        pulses.splice(f.at, f.to - f.at); changed();
        return { name: f.name, size: f.data.length };
      },
      rename(which: unknown, to: unknown) {
        const fs = read().files, i = pick(fs, which, 'rename'), f = fs[i], nm = nameOf(to, 'rename');
        if (f.format !== 'cbm' || f.load == null || !f.header) throw new TypeError(`rename: "${f.name}" is not a file in the KERNAL's format: its name is in its loader's own header`);
        // written again in its place, with the rest of its header as it was
        // (the leader before it stays, and the new blocks have one of their own)
        const c = cbmFilePulses([{ name: nm, data: f.data, load: f.saved ?? f.load, ...(f.type === 'BASIC' ? { basic: true } : {}), header: f.header.subarray(21) }], false);
        const tail = pulses.splice(f.at);
        for (let k = 0; k < c.length; k++) pulses.push(c[k]);
        for (let k = f.to - f.at; k < tail.length; k++) pulses.push(tail[k]);
        void i; changed();
      },
      pause(seconds: unknown) {
        const s = Number(seconds);
        if (!(s > 0) || s > 600) throw new RangeError(`pause: seconds, more than 0 and 600 at most (not ${String(seconds)})`);
        // (the long form of a pulse holds 24 bits of cycles: about 17 seconds)
        let left = Math.round(s * TAPE_CLOCK);
        while (left > 0) { const c = Math.min(left, 0xffffff); pulses.push(c); left -= c; }
        changed();
      },
      addPulses(cycles: unknown) {
        const c = cycles instanceof Uint32Array || cycles instanceof Uint16Array || cycles instanceof Uint8Array || Array.isArray(cycles) ? Array.from(cycles as ArrayLike<number>) : null;
        if (!c) throw new TypeError('addPulses: the pulses\' lengths in cycles are wanted: a list of numbers');
        for (const v of c) if (!Number.isInteger(v) || v < 1 || v > 0xffffff) throw new RangeError(`addPulses: a pulse is 1 to 16 777 215 cycles (not ${String(v)})`);
        room(c.length, 'addPulses');
        append(c);
      },
      cut(from: unknown, to: unknown) {
        const a = Number(from), b = to == null ? pulses.length : Number(to);
        if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b > pulses.length || b <= a) throw new RangeError(`cut: pulses ${String(from)} up to ${String(to)} are not on the tape (it has ${pulses.length}; the end is the pulse after the last one cut)`);
        pulses.splice(a, b - a); changed();
        return b - a;
      },
      endOfTape() { const c = cbmFilePulses([], pulses.length === 0, true); room(c.length, 'endOfTape'); append(c); },
      list: () => listing(read().files),
      file: () => image(),
      save(n?: unknown) { const full = fileName(n == null ? file : String(n), 'tap'); ctx.save(full, image()); return full; },
      insert(n?: unknown) { asked({ name: fileName(n == null ? file : String(n), 'tap'), kind: 'tap', bytes: image(), files: read().files.length }); },
      toT64(name?: unknown) {
        const fs = read().files.filter(f => f.load != null && f.data.length && f.load + f.data.length <= 0x10000);
        return t64(fs.map(f => ({ name: f.name.slice(0, 16), load: f.load!, data: f.data.slice() })), name == null ? '' : String(name), file.replace(/\.tap$/i, '.t64'));
      },
      toString: () => `TAP: ${read().files.length} file${read().files.length === 1 ? '' : 's'}, ${pulses.length} pulses`,
    };
    Object.defineProperties(o, {
      name: { enumerable: true, get: () => file },
      files: { enumerable: true, get: () => read().files.map(entry) },
      unknown: { enumerable: true, get: () => read().unknown.map(u => ({ from: u.at, to: u.to, pulses: u.pulses, seconds: Math.round(u.seconds * 10) / 10, short: u.short, long: u.long })) },
      pulses: { enumerable: true, get: () => Uint32Array.from(pulses) },
      seconds: { enumerable: true, get: () => Math.round(pulses.reduce((a, c) => a + c, 0) / TAPE_CLOCK * 10) / 10 },
      size: { enumerable: true, get: () => image().length },
      bytes: { enumerable: true, get: () => image() },
    });
    return o;
  };

  const open = (b: Uint8Array, name: string, what: string) => {
    if (isT64(b)) { const img = readT64(b); return t64(img.files.filter(f => f.load != null && f.t64?.type === 1).map(f => ({ name: f.name, ...(f.raw ? { raw: f.raw } : {}), load: f.load!, data: f.data.slice() })), img.t64?.name ?? '', name); }
    if (isTap(b)) return tap(Array.from(tapPulses(b).cycles), name);
    throw new TypeError(`${what}: ${b.length} bytes are not a tape image: a TAP starts with C64-TAPE-RAW, a T64 with "C64" and "tape" in its first line`);
  };
  return {
    kinds: ['tap', 't64'],
    create(kind: unknown, opts?: unknown) {
      const k = String(kind ?? '').toLowerCase().replace(/^\./, ''), q = (opts && typeof opts === 'object' ? opts : {}) as Record<string, unknown>;
      const name = String(q.name ?? ''), base = (name || 'tape').toLowerCase().replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_');
      if (k === 'tap') return tap([], `${base}.tap`);
      if (k === 't64') { if ([...name].length > 24) throw new RangeError(`tapes.create: a T64's name is 24 characters at most ("${name}" is ${[...name].length})`); return t64([], name, `${base}.t64`); }
      throw new TypeError(`tapes.create: the kind is "tap" (a tape's pulses) or "t64" (a tape archive), not "${String(kind)}"`);
    },
    open: (bytes: unknown, name?: unknown) => open(bytesOf(bytes, 'tapes.open'), name == null ? 'tape' : String(name), 'tapes.open'),
    get mounted() { return mounted ? open(mounted.bytes, mounted.name, 'tapes.mounted') : null; },
  };
}
