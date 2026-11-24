/* =====================================================================
 * Cartridge images for a JavaScript script (spec 10.3), as `cartridges`: a .crt made and changed (c64/crtedit.ts), with
 * the standard structures of the hardware types as templates (c64/crt-layouts.ts).
 *
 *   cartridges.types              the hardware types: { id, name }
 *   cartridges.layouts            the standard structures: { key, id, name, sizes }; layout(key, size) gives one with
 *                                 its EXROM and GAME lines, banks and chips
 *   cartridges.create(key or id, { name, size, fill, data })   a new cartridge with a standard structure, its chips
 *                                 filled with `fill` ($ff), then with `data` in the image's order (a .bin's bytes)
 *   cartridges.create("custom", { name, hw, exrom, game })      one with no chips yet
 *   cartridges.fromProgram(bytes, { load, start, basic, name })  a Magic Desk cartridge that starts the program
 *   cartridges.open(bytes)        a cartridge image's bytes to work on
 *   cartridges.project            the project's cartridge to work on, a copy; null without one
 *   cartridges.structs            the fields of a cartridge's structures, for blocks.struct: cbm80, vectors, header, chip
 *   cartridges.cbm80(cold, warm)  the nine bytes a cartridge starts with at $8000
 *   a cartridge: name, hw, type, revision, exrom, game (all set too), mode, version, chips, banks, bootBank, total,
 *     size, bytes, start
 *     chip(number), find(bank, address), read(chip), write(chip, bytes, at), fill(chip, value)
 *     peek(bank, address), poke(bank, address, value), get(bank, address, length), put(bank, address, bytes)
 *     add(bank, load, bytes or size, { type, fill, at }), remove(chip), resize(chip, size, fill), set(chip, { bank,
 *     load, type }), setStart(cold, warm, bank), setVectors({ nmi, reset, irq }, bank)
 *     list(), file(), save(fileName), run()
 *
 * A cartridge a script works on is the script's own: the project's cartridge and the files on the PC are as they were.
 * ===================================================================== */
import { CBM80, CRT_CHIP_MAX, CRT_IMAGE_MAX, CrtEdit, programCartridge, type CrtEditChip } from './c64/crtedit';
import { cartModeName, chipTypeName, CRT_TYPES, crtTypeName, isCrt } from './c64/crt';
import { CRT_LAYOUTS, crtLayout, type CrtLayout } from './c64/crt-layouts';
import { h4 } from './util/hex';

/** the cartridge a script may take a copy of: the project's */
export interface ScriptCartridgesData { name: string; bytes: Uint8Array }
/** what a script asked for with a cartridge's run(): the image to start in VICE */
export interface ScriptCartridgeRequest { name: string; bytes: Uint8Array; type: string; chips: number; total: number }

const kb = (n: number) => (n % 1024 ? `${n} bytes` : `${n / 1024} KB`);
export const cartridgeRequestText = (r: ScriptCartridgeRequest): string => `${r.name} started in VICE (${r.type}, ${r.chips} chip${r.chips === 1 ? '' : 's'}, ${kb(r.total)})`;

/** The fields of a cartridge's structures as blocks.struct takes them. The image's own numbers (header, chip) have
 *  their high byte first, so they are bytes, not words. */
export const CRT_STRUCTS: Readonly<Record<string, readonly string[]>> = {
  cbm80: ['cold: addr', 'warm: addr', 'signature: byte[5]'],
  vectors: ['nmi: addr', 'reset: addr', 'irq: addr'],
  header: ['signature: text[16]', 'headerLength: byte[4]', 'version: byte[2]', 'hardware: byte[2]', 'exrom: byte', 'game: byte', 'revision: byte', 'reserved: byte[5]', 'name: text[32]'],
  chip: ['signature: text[4]', 'packetLength: byte[4]', 'chipType: byte[2]', 'bank: byte[2]', 'load: byte[2]', 'size: byte[2]'],
};

const CHIP_TYPES: Record<string, number> = { rom: 0, ram: 1, flash: 2, eeprom: 3 };

export function cartridgesApi(project: ScriptCartridgesData | null, ctx: { addr: (where: unknown) => number; save: (name: string, bytes: Uint8Array) => void }, asked: (r: ScriptCartridgeRequest) => void): Record<string, unknown> {
  const bytesOf = (v: unknown, what: string): Uint8Array => {
    if (v instanceof Uint8Array) return v;
    if (Array.isArray(v)) return Uint8Array.from(v as number[]);
    throw new TypeError(`${what}: bytes are wanted (a Uint8Array, such as mem.subarray(…) or another cartridge's read(…))`);
  };
  const int = (v: unknown, lo: number, hi: number, what: string): number => {
    const n = Number(v);
    if (!Number.isInteger(n) || n < lo || n > hi) throw new RangeError(`${what} is ${lo} to ${hi} (not ${String(v)})`);
    return n;
  };
  const line = (v: unknown, what: string): number => {
    if (v === true || v === 'active' || v === 'low') return 0;
    if (v === false || v === 'inactive' || v === 'high') return 1;
    return int(v, 0, 1, `${what}: the line: 0 (active, pulled low) or 1 (inactive); true and false say the same`);
  };
  const chipType = (v: unknown, what: string): number => {
    if (typeof v === 'string') { const t = CHIP_TYPES[v.toLowerCase()]; if (t == null) throw new TypeError(`${what}: a chip's type is "rom", "ram", "flash" or "eeprom" (or its number), not "${v}"`); return t; }
    return int(v, 0, 0xffff, `${what}: a chip's type`);
  };
  const fileName = (n: string) => (/\.[A-Za-z0-9]{1,4}$/.test(n) ? n : `${n}.crt`);
  const options = (o: unknown) => (o && typeof o === 'object' && !(o instanceof Uint8Array) && !Array.isArray(o) ? o : {}) as Record<string, unknown>;
  const layoutText = (l: CrtLayout) => Object.freeze({
    key: l.key, id: l.hw, name: l.name, size: l.size, exrom: l.exrom, game: l.game, banks: l.banks,
    chips: l.chips.map(c => Object.freeze({ bank: c.bank, load: c.load, size: c.size, type: chipTypeName(c.type).toLowerCase() })),
  });
  /** the structure a script names: its key, a hardware type's number or name; of the size given, or the smallest */
  const layoutOf = (which: unknown, size: unknown, what: string): CrtLayout => {
    const s = typeof which === 'string' ? which.trim().toLowerCase() : which;
    const t = typeof s === 'number' ? CRT_LAYOUTS.find(x => x.hw === s && x.key !== 'ulti')
      : CRT_LAYOUTS.find(x => x.key === s) ?? CRT_LAYOUTS.find(x => x.name.toLowerCase() === s) ?? CRT_LAYOUTS.find(x => x.name.toLowerCase().startsWith(String(s)) && String(s).length > 2);
    if (!t) throw new TypeError(`${what}: "${String(which)}" is no standard structure: cartridges.layouts lists them (normal, ulti, ocean, md, easy, …), "custom" is one with no chips yet`);
    const n = size == null ? t.sizes[0] : Number(size);
    const l = crtLayout(t.key, n);
    if (!l) throw new RangeError(`${what}: ${t.name} (${t.key}) does not come with ${typeof size === 'number' ? kb(n) : String(size)} of ROM: it comes with ${t.sizes.map(kb).join(', ')}`);
    return l;
  };

  const wrap = (e: CrtEdit, file: string): Record<string, unknown> => {
    const entry = (c: CrtEditChip, i: number) => Object.freeze({ number: i, bank: c.bank, load: c.load, address: e.address(c), size: c.data.length, end: e.address(c) + c.data.length, type: chipTypeName(c.type).toLowerCase(), typeId: c.type });
    /** a chip as a script says it: its number, or what chips and find() gave */
    const pick = (which: unknown, what: string): number => {
      const n = typeof which === 'number' ? which : which && typeof which === 'object' && typeof (which as { number?: unknown }).number === 'number' ? (which as { number: number }).number : NaN;
      if (!Number.isInteger(n) || n < 0 || n >= e.chips.length) throw new RangeError(`${what}: there is no chip ${typeof which === 'number' ? which : String(which)} in the cartridge (it has ${e.chips.length}, numbered from 0): a chip is its number, or one of chips or find(bank, address)`);
      return n;
    };
    const bankOf = (v: unknown, what: string) => (v == null ? e.bootBank : int(v, 0, 0xffff, `${what}: a bank`));
    /** where an address of a bank is: its chip and the offset in it */
    const where = (bank: unknown, address: unknown, what: string): { c: CrtEditChip; o: number } => {
      const b = bankOf(bank, what), a = ctx.addr(address), i = e.chipAt(b, a);
      if (i < 0) throw new RangeError(`${what}: bank ${b} has no chip at $${h4(a)}${e.chips.some(c => c.bank === b) ? ` (it has ${e.chips.filter(c => c.bank === b).map(c => `$${h4(c.load)}-$${h4(c.load + c.data.length - 1)}`).join(', ')})` : ': the cartridge has no such bank'}`);
      const c = e.chips[i];
      return { c, o: a - (a >= c.load && a < c.load + c.data.length ? c.load : e.address(c)) };
    };
    const room = (more: number, what: string) => { if (e.image().length + more > CRT_IMAGE_MAX) throw new RangeError(`${what}: the image would be more than ${CRT_IMAGE_MAX / 1024 / 1024} MB`); };
    const sized = (n: number, what: string) => { if (!Number.isInteger(n) || n < 1 || n > CRT_CHIP_MAX) throw new RangeError(`${what}: a chip is 1 to ${CRT_CHIP_MAX} bytes (its size is two bytes in the image), not ${n}`); return n; };
    const image = (what: string) => { if (!e.chips.length) throw new Error(`${what}: the cartridge has no chips yet: add(bank, load, bytes) adds one`); return e.image(); };
    const o = {
      chip(n: unknown) { const i = pick(n, 'chip'); return entry(e.chips[i], i); },
      find(bank: unknown, address?: unknown) {
        const b = bankOf(bank, 'find'), i = address == null ? e.chips.findIndex(c => c.bank === b) : e.chipAt(b, ctx.addr(address));
        return i < 0 ? null : entry(e.chips[i], i);
      },
      read(which: unknown) { return e.chips[pick(which, 'read')].data.slice(); },
      write(which: unknown, bytes: unknown, at?: unknown) {
        const c = e.chips[pick(which, 'write')], b = bytesOf(bytes, 'write'), o2 = at == null ? 0 : int(at, 0, c.data.length, 'write: where in the chip');
        if (o2 + b.length > c.data.length) throw new RangeError(`write: ${b.length} bytes from ${o2} end past the chip's ${c.data.length} bytes: resize(chip, size) makes it another size`);
        c.data.set(b, o2);
        return b.length;
      },
      fill(which: unknown, value?: unknown) { e.chips[pick(which, 'fill')].data.fill(value == null ? 0xff : int(value, 0, 255, 'fill: a byte')); },
      peek(bank: unknown, address: unknown) { const w = where(bank, address, 'peek'); return w.c.data[w.o]; },
      poke(bank: unknown, address: unknown, value: unknown) { const w = where(bank, address, 'poke'); w.c.data[w.o] = int(value, 0, 255, 'poke: a byte'); },
      get(bank: unknown, address: unknown, length?: unknown) {
        const a = ctx.addr(address), n = length == null ? 1 : int(length, 0, 0x10000, 'get: how many bytes'), out = new Uint8Array(n);
        for (let i = 0; i < n; i++) { const w = where(bank, a + i, 'get'); out[i] = w.c.data[w.o]; }
        return out;
      },
      put(bank: unknown, address: unknown, bytes: unknown) {
        const a = ctx.addr(address), b = bytesOf(bytes, 'put');
        // (all of it or nothing: where each byte goes is found first)
        const to = Array.from(b, (_, i) => where(bank, a + i, 'put'));
        to.forEach((w, i) => { w.c.data[w.o] = b[i]; });
        return b.length;
      },
      add(bank: unknown, load: unknown, bytes: unknown, opts?: unknown) {
        const q = options(opts), b = int(bank, 0, 0xffff, 'add: a bank'), a = ctx.addr(load);
        const data = typeof bytes === 'number' ? new Uint8Array(sized(bytes, 'add')).fill(q.fill == null ? 0xff : int(q.fill, 0, 255, 'add: the fill')) : bytesOf(bytes, 'add').slice();
        sized(data.length, 'add');
        if (a + data.length > 0x10000) throw new RangeError(`add: ${data.length} bytes at $${h4(a)} end past $ffff`);
        const over = e.chips.find(c => c.bank === b && a < c.load + c.data.length && c.load < a + data.length);
        if (over) throw new RangeError(`add: bank ${b} has a chip at $${h4(over.load)}-$${h4(over.load + over.data.length - 1)} already, which $${h4(a)}-$${h4(a + data.length - 1)} would lie over`);
        room(16 + data.length, 'add');
        const at = q.at == null ? e.chips.length : int(q.at, 0, e.chips.length, 'add: where among the chips');
        e.chips.splice(at, 0, { type: q.type == null ? 0 : chipType(q.type, 'add'), bank: b, load: a, data });
        return entry(e.chips[at], at);
      },
      remove(which: unknown) { const i = pick(which, 'remove'), c = e.chips.splice(i, 1)[0]; return { bank: c.bank, load: c.load, size: c.data.length }; },
      resize(which: unknown, size: unknown, fill?: unknown) {
        const c = e.chips[pick(which, 'resize')], n = sized(Number(size), 'resize');
        if (c.load + n > 0x10000) throw new RangeError(`resize: ${n} bytes at $${h4(c.load)} end past $ffff`);
        room(n - c.data.length, 'resize');
        const d = new Uint8Array(n).fill(fill == null ? 0xff : int(fill, 0, 255, 'resize: the fill'));
        d.set(c.data.subarray(0, n));
        c.data = d; delete c.extra; delete c.length;
      },
      set(which: unknown, to: unknown) {
        const c = e.chips[pick(which, 'set')], q = options(to);
        for (const k of Object.keys(q)) if (!['bank', 'load', 'type'].includes(k)) throw new TypeError(`set: a chip's bank, load and type are set, not "${k}"`);
        const load = q.load == null ? c.load : ctx.addr(q.load);
        if (load + c.data.length > 0x10000) throw new RangeError(`set: ${c.data.length} bytes at $${h4(load)} end past $ffff`);
        if (q.bank != null) c.bank = int(q.bank, 0, 0xffff, 'set: a bank');
        if (q.type != null) c.type = chipType(q.type, 'set');
        c.load = load;
      },
      setStart(cold: unknown, warm?: unknown, bank?: unknown) {
        const b = bankOf(bank, 'setStart'), c = e.chips.find(x => x.bank === b && x.load === 0x8000 && x.data.length >= 9);
        if (!c) throw new Error(`setStart: bank ${b} has no chip at $8000 for the CBM80 vectors (an Ultimax cartridge starts at its reset vector: setVectors({ reset }))`);
        c.data.set(cbm80(cold, warm));
      },
      setVectors(v: unknown, bank?: unknown) {
        const q = options(v), b = bankOf(bank, 'setVectors');
        for (const k of Object.keys(q)) if (!['nmi', 'reset', 'irq'].includes(k)) throw new TypeError(`setVectors: the vectors are nmi, reset and irq, not "${k}"`);
        const todo = (['nmi', 'reset', 'irq'] as const).flatMap((k, i) => (q[k] == null ? [] : [{ a: 0xfffa + i * 2, v: ctx.addr(q[k]) }]));
        const to = todo.map(t => [where(b, t.a, 'setVectors'), where(b, t.a + 1, 'setVectors')]);
        todo.forEach((t, i) => { to[i][0].c.data[to[i][0].o] = t.v & 0xff; to[i][1].c.data[to[i][1].o] = t.v >> 8; });
      },
      list() {
        return [
          `${e.name ? `"${e.name}"  ` : ''}${crtTypeName(e.hw)} (type ${e.hw}${e.revision ? `, revision ${e.revision}` : ''}), ${cartModeName(e.mode)} (EXROM ${e.exrom}, GAME ${e.game}), ${e.chips.length} chip${e.chips.length === 1 ? '' : 's'}, ${kb(e.total)}`,
          ...e.chips.map((c, i) => `${String(i).padStart(3)}  bank ${String(c.bank).padStart(3)}  $${h4(c.load)}-$${h4(c.load + c.data.length - 1)}  ${String(c.data.length).padStart(5)} bytes  ${chipTypeName(c.type)}${e.address(c) !== c.load ? `  (the CPU sees it at $${h4(e.address(c))})` : ''}`),
        ];
      },
      file: () => image('file'),
      save(n?: unknown) { const full = fileName(n == null ? file : String(n)); ctx.save(full, image('save')); return full; },
      run(n?: unknown) { asked({ name: fileName(n == null ? file : String(n)), bytes: image('run'), type: crtTypeName(e.hw), chips: e.chips.length, total: e.total }); },
      toString: () => `cartridge${e.name ? ` "${e.name}"` : ''}: ${crtTypeName(e.hw)}, ${e.chips.length} chip${e.chips.length === 1 ? '' : 's'}, ${kb(e.total)}`,
    };
    Object.defineProperties(o, {
      name: { enumerable: true, get: () => e.name, set: (v: unknown) => { const s = String(v); if (s.length > 32) throw new RangeError(`a cartridge's name is 32 characters at most ("${s}" is ${s.length})`); e.setName(s); } },
      fileName: { enumerable: true, get: () => file },
      hw: { enumerable: true, get: () => e.hw, set: (v: unknown) => { e.hw = int(v, 0, 0xffff, 'the hardware type'); } },
      type: { enumerable: true, get: () => crtTypeName(e.hw) },
      revision: { enumerable: true, get: () => e.revision, set: (v: unknown) => { e.revision = int(v, 0, 255, 'the hardware revision'); if (e.revision && e.version[0] === 1 && e.version[1] < 1) e.version = [1, 1]; } },
      version: { enumerable: true, get: () => `${e.version[0]}.${e.version[1]}` },
      exrom: { enumerable: true, get: () => e.exrom, set: (v: unknown) => { e.exrom = line(v, 'exrom'); } },
      game: { enumerable: true, get: () => e.game, set: (v: unknown) => { e.game = line(v, 'game'); } },
      mode: { enumerable: true, get: () => e.mode },
      chips: { enumerable: true, get: () => e.chips.map(entry) },
      banks: { enumerable: true, get: () => e.banks },
      bootBank: { enumerable: true, get: () => e.bootBank },
      total: { enumerable: true, get: () => e.total },
      start: { enumerable: true, get: () => { const s = e.start; return s ? Object.freeze({ ...s }) : null; } },
      size: { enumerable: true, get: () => e.image().length },
      bytes: { enumerable: true, get: () => e.image() },
    });
    return o;
  };

  const cbm80 = (cold: unknown, warm?: unknown): Uint8Array => {
    const c = ctx.addr(cold), w = warm == null ? 0xfe5e : ctx.addr(warm);
    return Uint8Array.of(c & 0xff, c >> 8, w & 0xff, w >> 8, ...CBM80);
  };
  const baseName = (name: string, or: string) => `${(name || or).toLowerCase().replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').trim() || or}.crt`;
  const nameOf = (v: unknown, what: string): string => { const s = v == null ? '' : String(v); if (s.length > 32) throw new RangeError(`${what}: a cartridge's name is 32 characters at most ("${s}" is ${s.length})`); return s; };
  const open = (b: Uint8Array, name: string, what: string) => {
    if (!isCrt(b)) throw new TypeError(`${what}: ${b.length} bytes are not a cartridge image: a .crt starts with "C64 CARTRIDGE"`);
    try { return wrap(CrtEdit.open(b, name), /\.crt$/i.test(name) ? name : `${name}.crt`); } catch (err) { throw new TypeError(`${what}: ${err instanceof Error ? err.message : String(err)}`); }
  };
  return {
    types: Object.freeze(Object.entries(CRT_TYPES).map(([id, name]) => Object.freeze({ id: +id, name }))),
    layouts: Object.freeze(CRT_LAYOUTS.map(l => Object.freeze({ key: l.key, id: l.hw, name: l.name, sizes: Object.freeze([...l.sizes]) }))),
    structs: Object.freeze(Object.fromEntries(Object.entries(CRT_STRUCTS).map(([k, v]) => [k, Object.freeze([...v])]))),
    layout: (key: unknown, size?: unknown) => layoutText(layoutOf(key, size, 'cartridges.layout')),
    cbm80,
    create(which: unknown, opts?: unknown) {
      const q = options(opts), name = nameOf(q.name, 'cartridges.create');
      if (typeof which === 'string' && which.trim().toLowerCase() === 'custom') {
        const e = new CrtEdit();
        e.name = name; e.hw = q.hw == null ? 0 : int(q.hw, 0, 0xffff, 'cartridges.create: the hardware type');
        e.exrom = q.exrom == null ? 0 : line(q.exrom, 'cartridges.create'); e.game = q.game == null ? 1 : line(q.game, 'cartridges.create');
        return wrap(e, baseName(name, 'cartridge'));
      }
      const data = q.data == null ? undefined : bytesOf(q.data, 'cartridges.create');
      // (the size left out: the smallest the data fits in)
      let size = q.size;
      if (size == null && data) {
        const t = layoutOf(which, null, 'cartridges.create'), fits = CRT_LAYOUTS.find(x => x.key === t.key)!.sizes.find(s => s >= data.length);
        if (fits == null) throw new RangeError(`cartridges.create: ${data.length} bytes are more than ${t.name} (${t.key}) comes with: ${CRT_LAYOUTS.find(x => x.key === t.key)!.sizes.map(kb).join(', ')}`);
        size = fits;
      }
      const l = layoutOf(which, size, 'cartridges.create');
      if (data && data.length > l.size) throw new RangeError(`cartridges.create: ${data.length} bytes of data are more than the ${kb(l.size)} of the structure`);
      const e = CrtEdit.of(l, { name, fill: q.fill == null ? 0xff : int(q.fill, 0, 255, 'cartridges.create: the fill'), ...(data ? { data } : {}) });
      return wrap(e, baseName(name, l.key));
    },
    fromProgram(bytes: unknown, opts?: unknown) {
      const q = options(opts), b = bytesOf(bytes, 'cartridges.fromProgram'), name = nameOf(q.name, 'cartridges.fromProgram');
      if (q.load == null && b.length < 3) throw new RangeError('cartridges.fromProgram: the bytes start with a load address (two bytes) unless one is given: fromProgram(bytes, { load: 0x0801 })');
      const load = q.load == null ? b[0] | (b[1] << 8) : ctx.addr(q.load), data = q.load == null ? b.subarray(2) : b;
      try {
        const p = programCartridge(load, data, { name, ...(q.start != null ? { start: ctx.addr(q.start) } : {}), ...(q.basic != null ? { basic: !!q.basic } : {}) });
        return wrap(p.crt, baseName(name, 'program'));
      } catch (err) { throw new RangeError(`cartridges.fromProgram: ${err instanceof Error ? err.message : String(err)}`); }
    },
    open: (bytes: unknown, name?: unknown) => open(bytesOf(bytes, 'cartridges.open'), name == null ? 'cartridge.crt' : String(name), 'cartridges.open'),
    get project() { return project ? open(project.bytes, project.name, 'cartridges.project') : null; },
  };
}
