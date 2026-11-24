/* =====================================================================
 * The program's blocks for a JavaScript script (spec 10.3), as `blocks`: what the analysis made of the program's bytes
 * (code, bytes, words, text, tables, graphics, music, …), read and changed.
 *
 *   blocks.all                    every block, in address order: { start, end, size, type, as, custom, label, comment,
 *                                 file, user, confidence, why, entropy, excluded, binary, fmt, row, enc, mc, colors,
 *                                 init, play, struct, bytes, text, words, records, next, prev } and what a block does:
 *                                 mark(type, opts), format(opts), setLabel(name), setComment(text), split(at), auto(),
 *                                 exclude(on), asBinary(on), junk()
 *   blocks.at(a), blocks.in(start, end), blocks.of(type), blocks.find(label)
 *   blocks.mark(start, end, type, opts)   as Mark as: a type's name ("code", "bytes", "words", "text", "textsc", …), a
 *                                 custom type or a struct; opts { fmt, row, mc, colors, init, play, label, comment }
 *   blocks.struct(name, fields)   a struct: a series of fields, each bytes, words, addresses or a text (struct.ts). It
 *                                 has size, fields (each with its offset), read(at), records(start, count),
 *                                 write(at, values), mark(start, end) and markRecords(start, count)
 *   blocks.define(name, what)     a custom block type: a name for a type with its settings ({ as: "bytes", row: 40,
 *                                 fmt: "dec" }) or for a struct; blocks.mark takes the name, and the listing says it
 *   blocks.split(at), blocks.auto(start, end), blocks.comment(at, text), blocks.exclude(at, on), blocks.binary(at, on)
 *   blocks.text(start, end, enc), blocks.encode(text, enc)   bytes as text and text as bytes, in a text type's encoding
 *
 * Nothing is changed while the script runs: what it asks for is done when the run ends, with the bytes it changed
 * (script-actions.ts), and said under Last run. So `blocks.all` is the program as it was when the run started.
 * ===================================================================== */
import type { Addr, AnalysisResult, BlockKind, BlockProps, NumberFormat, OverrideProps, Project, RenderResult, SpriteColors, StructField, TextEncoding } from './types';
import { markIdOf } from './edit';
import { MARK_AS } from './model';
import { MARK_NAMES, type ScriptAction } from './script-actions';
import { decodeText, encodeText, fieldSize, fieldTypeText, readStruct, structFields, structSize, structText } from './struct';
import { h4 } from './util/hex';

/** a block as a script is given it */
export interface ScriptBlock {
  start: Addr; end: Addr; type: BlockKind; props: BlockProps;
  /** the name of the file it is in */
  file: string;
  user: boolean; conf: number; reason: string; entropy: number;
  label: string | null; comment: string | null; excluded: boolean; binary: boolean;
}
/** the program's blocks as they are now, for `blocks` */
export interface ScriptBlocksData { blocks: ScriptBlock[] }

/** the blocks of the analysis for a script (those of the first 64 KB: a cartridge's other banks are not in a script's memory) */
export function scriptBlocksData(A: Pick<AnalysisResult, 'blocks' | 'files'>, R: Pick<RenderResult, 'labels'>, project: Pick<Project, 'blockComments' | 'excluded' | 'binary'>): ScriptBlocksData {
  return { blocks: A.blocks.filter(b => b.end <= 0x10000).map(b => ({
    start: b.start, end: b.end, type: b.type, props: { ...b.props }, file: A.files[b.file]?.name ?? '', user: b.user, conf: b.conf, reason: b.reason, entropy: b.entropy,
    label: R.labels.get(b.start)?.name ?? null, comment: project.blockComments?.[b.start] || null, excluded: !!project.excluded?.includes(b.start), binary: !!project.binary?.includes(b.start),
  })) };
}

const TEXT_ENC: Record<string, TextEncoding> = { text: 'petscii', petscii: 'petscii', textsc: 'screen', screen: 'screen', textmix: 'petscii-mixed', 'petscii-mixed': 'petscii-mixed', textscmix: 'screen-mixed', 'screen-mixed': 'screen-mixed' };
const CUSTOM_NAME = /^[A-Za-z][A-Za-z0-9_ -]{0,31}$/;
const LAYOUT = Symbol('struct');

/** `blocks` for a script: `data` the program's blocks (null: the run is not given them, and has none), `act` takes what
 *  the script asks to be done when the run ends */
export function blocksApi(data: ScriptBlocksData | null, ctx: { mem: Uint8Array; addr: (where: unknown) => number }, act: (a: ScriptAction) => void): Record<string, unknown> {
  const { mem, addr } = ctx;
  const span = (s: unknown, e: unknown, what: string): [Addr, Addr] => {
    const start = addr(s), end = typeof e === 'number' && e === 0x10000 ? 0x10000 : addr(e);
    if (end <= start) throw new RangeError(`${what}: the end ($${h4(end)}) is not after the start ($${h4(start)}): the end is the address after the last byte`);
    return [start, end];
  };
  const encOf = (enc: unknown, what: string): TextEncoding => {
    const e = TEXT_ENC[String(enc ?? 'text').toLowerCase()];
    if (!e) throw new TypeError(`${what}: "${String(enc)}" is no text type: text, textsc, textmix or textscmix`);
    return e;
  };

  /* ---- structs ---- */
  interface Layout { name: string | null; fields: (StructField & { count: number; offset: number; size: number; text: string })[]; size: number; text: string; [LAYOUT]: StructField[] }
  const isLayout = (v: unknown): v is Layout => !!v && typeof v === 'object' && LAYOUT in (v as object);
  const customName = (n: unknown, what: string): string => {
    const s = String(n ?? '').trim();
    if (!CUSTOM_NAME.test(s)) throw new TypeError(`${what}: "${s}" is no name of a type: letters, digits, spaces, - and _, starting with a letter, 32 at most`);
    if (MARK_NAMES.includes(s.toLowerCase()) || ['struct', 'auto'].includes(s.toLowerCase())) throw new TypeError(`${what}: "${s}" is a type Mimir has: give yours another name`);
    return s;
  };
  const layout = (name: string | null, spec: unknown): Layout => {
    const fields = structFields(spec), size = structSize(fields);
    let off = 0;
    const l: Layout = {
      name, size, text: structText(fields), [LAYOUT]: fields,
      fields: fields.map(f => { const x = { ...f, count: f.count ?? 1, offset: off, size: fieldSize(f), text: fieldTypeText(f) }; off += x.size; return x; }),
    };
    const at = (a: unknown, n: number, what: string) => { const s = addr(a); if (s + n > 0x10000) throw new RangeError(`${what}: ${n} byte${n === 1 ? '' : 's'} at $${h4(s)} run past $ffff`); return s; };
    return Object.assign(l, {
      offset(field: unknown) { const f = l.fields.find(x => x.name === field); if (!f) throw new ReferenceError(`offset: the struct has no field "${String(field)}" (it has ${l.fields.map(x => x.name).join(', ')})`); return f.offset; },
      read: (a: unknown) => readStruct(mem, at(a, size, 'read'), fields),
      records(a: unknown, count: unknown = 1) {
        const n = Number(count);
        if (!Number.isInteger(n) || n < 0 || n > 0x10000) throw new RangeError(`records: ${String(count)} is no count of records`);
        const s = at(a, n * size, 'records');
        return Array.from({ length: n }, (_, i) => readStruct(mem, s + i * size, fields));
      },
      write(a: unknown, values: unknown) {
        const s = at(a, size, 'write');
        if (!values || typeof values !== 'object') throw new TypeError('write: the values are wanted, a field a key: write(at, { x: 10, name: "ABC" })');
        for (const [k, v] of Object.entries(values as Record<string, unknown>)) {
          const f = l.fields.find(x => x.name === k);
          if (!f) throw new ReferenceError(`write: the struct has no field "${k}" (it has ${l.fields.map(x => x.name).join(', ')})`);
          const p = s + f.offset;
          if (f.type === 'text') {
            const b = encodeText(String(v), f.enc);
            if ('bad' in b) throw new RangeError(`write: ${k} has no byte for "${b.bad}" in ${f.text}`);
            if (b.length > f.count) throw new RangeError(`write: "${String(v)}" is ${b.length} characters, ${k} has ${f.count}`);
            // (a shorter text is filled up with spaces)
            mem.fill(0x20, p, p + f.count); mem.set(b, p);
            continue;
          }
          const list = Array.isArray(v) || v instanceof Uint8Array || v instanceof Uint16Array ? Array.from(v as ArrayLike<number>) : [v as number];
          if (list.length > f.count) throw new RangeError(`write: ${list.length} values for ${k}, which has ${f.count}`);
          const w = f.type === 'byte' ? 1 : 2, top = w === 1 ? 0xff : 0xffff;
          list.forEach((x, i) => {
            const n = f.type === 'addr' ? addr(x) : Number(x);
            if (!Number.isInteger(n) || n < -(top + 1) / 2 || n > top) throw new RangeError(`write: ${String(x)} does not fit ${k} (a ${f.type})`);
            mem[p + i * w] = n & 0xff; if (w === 2) mem[p + i * w + 1] = (n >> 8) & 0xff;
          });
        }
        return s + size;
      },
      mark: (s: unknown, e: unknown, opts?: unknown) => mark(s, e, l, opts),
      markRecords(s: unknown, count: unknown = 1, opts?: unknown) {
        const n = Number(count), start = addr(s);
        if (!Number.isInteger(n) || n < 1 || start + n * size > 0x10000) throw new RangeError(`markRecords: ${String(count)} record${n === 1 ? '' : 's'} of ${size} byte${size === 1 ? '' : 's'} at $${h4(start)} is not in memory`);
        return mark(start, start + n * size, l, opts);
      },
      toString: () => `struct${name ? ` ${name}` : ''} { ${l.text} }`,
    });
  };

  /* ---- types ---- */
  interface Custom { name: string; as: string; props: OverrideProps; struct: Layout | null }
  const customs = new Map<string, Custom & Record<string, unknown>>();
  const FMT: readonly string[] = ['hex', 'dec', 'bin'];
  const colour = (v: unknown, what: string) => { const n = Number(v); if (!Number.isInteger(n) || n < 0 || n > 15) throw new RangeError(`${what}: a colour is 0-15 (not ${String(v)})`); return n; };
  /** the settings a script gives a block: a number format, how many a row, multicolour, sprite colours, music's init and play */
  const settings = (o: Record<string, unknown>, what: string): OverrideProps => {
    const p: OverrideProps = {};
    if (o.fmt != null) { const f = String(o.fmt).toLowerCase(); if (!FMT.includes(f)) throw new TypeError(`${what}: fmt is "hex", "dec" or "bin" (not "${String(o.fmt)}")`); p.fmt = f as NumberFormat; }
    if (o.row != null) { const n = Number(o.row); if (!Number.isInteger(n) || n < 1 || n > 64) throw new RangeError(`${what}: row is how many go on a line, 1 to 64 (not ${String(o.row)})`); p.row = n; }
    if (o.mc != null) p.mc = !!o.mc;
    if (o.colors != null) {
      const c = o.colors as Record<string, unknown>;
      if (typeof c !== 'object') throw new TypeError(`${what}: colors is { bg, sprite, mc1, mc2 }, each a C64 colour 0-15`);
      p.colors = { bg: colour(c.bg ?? 0, what), sprite: colour(c.sprite ?? c.fg ?? 1, what), mc1: colour(c.mc1 ?? 0, what), mc2: colour(c.mc2 ?? 0, what) } satisfies SpriteColors;
    }
    if (o.init != null) p.init = addr(o.init);
    if (o.play != null) p.play = addr(o.play);
    return p;
  };
  /** a type as a script says it: a type's name, a custom type or its name, a struct or its fields */
  const typeOf = (type: unknown, what: string): { as: string; props: OverrideProps } => {
    if (isLayout(type)) return { as: 'bytes', props: { struct: type[LAYOUT].map(f => ({ ...f })), ...(type.name ? { custom: type.name } : {}) } };
    if (type && typeof type === 'object' && customs.has(String((type as Custom).name)) && customs.get(String((type as Custom).name)) === type) { const c = type as Custom; return { as: c.as, props: { ...c.props } }; }
    if (Array.isArray(type) || (type && typeof type === 'object')) return typeOf(layout(null, type), what);
    const s = String(type ?? ''), c = customs.get(s) ?? [...customs.values()].find(x => x.name.toLowerCase() === s.toLowerCase());
    if (c) return { as: c.as, props: { ...c.props } };
    const as = s.toLowerCase();
    if (as === 'struct') throw new TypeError(`${what}: a struct is marked with its fields: blocks.struct("name", ["x: byte", "y: byte"]).mark(start, end)`);
    if (!MARK_NAMES.includes(as)) throw new TypeError(`${what}: "${s}" is no type: ${MARK_NAMES.join(', ')}${customs.size ? `, or one the script defined (${[...customs.keys()].join(', ')})` : ', a struct, or one the script defined (blocks.define)'}`);
    return { as: as === 'data' ? 'bytes' : as, props: {} };
  };
  const labelOk = (n: unknown, what: string): string => {
    if (typeof n !== 'string' || !/^[A-Za-z][A-Za-z0-9_]*$/.test(n)) throw new TypeError(`${what}: "${String(n)}" is no label: letters, digits and _, starting with a letter`);
    return n;
  };
  const commentText = (t: unknown) => String(t ?? '').replace(/\r\n?/g, '\n').split('\n').map(x => x.trimEnd()).join('\n').trim().slice(0, 2000);
  function mark(s: unknown, e: unknown, type: unknown, opts?: unknown): { start: Addr; end: Addr } {
    const [start, end] = span(s, e, 'mark'), t = typeOf(type, 'mark'), o = (opts && typeof opts === 'object' ? opts : {}) as Record<string, unknown>;
    const props = { ...t.props, ...settings(o, 'mark') };
    if (props.struct) { const n = structSize(props.struct); if (end - start < n) throw new RangeError(`mark: ${end - start} byte${end - start === 1 ? '' : 's'} is less than a record of the struct (${n} bytes)`); }
    const label = o.label != null ? labelOk(o.label, 'mark') : null;
    act({ kind: 'mark', line: 0, start, end, as: t.as, ...(Object.keys(props).length ? { props } : {}) });
    if (label) act({ kind: 'name', line: 0, at: start, name: label });
    if (o.comment != null && commentText(o.comment)) act({ kind: 'blockComment', line: 0, at: start, text: commentText(o.comment) });
    return { start, end };
  }
  const define = (n: unknown, what: unknown) => {
    const name = customName(n, 'define');
    let c: Custom;
    if (isLayout(what) || Array.isArray(what)) { const l = layout(name, isLayout(what) ? what[LAYOUT] : what); c = { name, as: 'bytes', props: { custom: name, struct: l[LAYOUT] }, struct: l }; }
    else if (typeof what === 'string') c = { name, as: typeOf(what, 'define').as, props: { ...typeOf(what, 'define').props, custom: name }, struct: null };
    else if (what && typeof what === 'object') {
      const o = what as Record<string, unknown>;
      if (o.fields != null) { const l = layout(name, isLayout(o.fields) ? o.fields[LAYOUT] : o.fields); c = { name, as: 'bytes', props: { ...settings(o, 'define'), custom: name, struct: l[LAYOUT] }, struct: l }; }
      else if (o.as != null) { const t = typeOf(o.as, 'define'); c = { name, as: t.as, props: { ...t.props, ...settings(o, 'define'), custom: name }, struct: t.props.struct ? layout(name, t.props.struct) : null }; }
      else { const l = layout(name, what); c = { name, as: 'bytes', props: { custom: name, struct: l[LAYOUT] }, struct: l }; }
    } else throw new TypeError('define: what the type is is wanted: a type with its settings ({ as: "bytes", row: 40, fmt: "dec" }) or a struct\'s fields (["x: byte", "name: text[8]"])');
    const made: Custom & Record<string, unknown> = Object.assign(c as Custom & Record<string, unknown>, {
      size: c.struct ? c.struct.size : null,
      mark: (s: unknown, e: unknown, opts?: unknown) => mark(s, e, made, opts),
      toString: () => `${name} (${c.struct ? `struct { ${c.struct.text} }` : MARK_AS.find(m => m.id === c.as)?.label ?? c.as})`,
    });
    customs.set(name, made);
    return made;
  };

  /* ---- the program's blocks ---- */
  const src = data?.blocks ?? [];
  const at = (a: unknown, what: string): Addr => { const x = addr(a); if (x > 0xffff) throw new RangeError(`${what}: $${x.toString(16)} is no address`); return x; };
  const list: Record<string, unknown>[] = src.map((b, i) => {
    const p = b.props, size = b.end - b.start;
    const st = b.type === 'data' && p.struct?.length ? layout(p.custom ?? null, p.struct) : null;
    const as = st ? 'struct' : markIdOf(b);
    const me = { start: b.start, end: b.end };
    const o: Record<string, unknown> = {
      start: b.start, end: b.end, size, type: b.type, as, custom: p.custom ?? null, label: b.label, comment: b.comment, file: b.file,
      user: b.user, confidence: b.conf, why: b.reason, entropy: b.entropy, excluded: b.excluded, binary: b.binary,
      fmt: p.fmt ?? null, row: p.row ?? null, enc: b.type === 'text' ? p.enc ?? 'petscii' : null, mc: p.mc ?? null, colors: p.colors ? { ...p.colors } : null,
      init: p.init ?? null, play: p.play ?? null, struct: st,
      mark: (type: unknown, opts?: unknown) => mark(me.start, me.end, type, opts),
      format(opts: unknown) {
        if (!['data', 'table', 'words', 'sprite', 'charset', 'bitmap', 'music', 'text', 'screen', 'fill'].includes(b.type)) throw new TypeError(`format: a ${b.type} block keeps how it is written`);
        const keep: OverrideProps = { ...(p.fmt ? { fmt: p.fmt } : {}), ...(p.row ? { row: p.row } : {}), ...(p.mc != null ? { mc: p.mc } : {}), ...(p.colors ? { colors: { ...p.colors } } : {}),
          ...(b.type === 'music' && p.init != null ? { init: p.init } : {}), ...(b.type === 'music' && p.play != null ? { play: p.play } : {}), ...(b.type === 'table' && p.sub ? { sub: p.sub } : {}),
          ...(p.custom ? { custom: p.custom } : {}), ...(st ? { struct: st[LAYOUT] } : {}) };
        const props = { ...keep, ...settings((opts && typeof opts === 'object' ? opts : {}) as Record<string, unknown>, 'format') };
        act({ kind: 'mark', line: 0, start: b.start, end: b.end, as: markIdOf(b), ...(Object.keys(props).length ? { props } : {}) });
        return me;
      },
      setLabel(n: unknown) { act({ kind: 'name', line: 0, at: b.start, name: labelOk(n, 'setLabel') }); return me; },
      setComment(t: unknown) { act({ kind: 'blockComment', line: 0, at: b.start, text: commentText(t) }); return me; },
      split(a: unknown) { const x = at(a, 'split'); if (x <= b.start || x >= b.end) throw new RangeError(`split: $${h4(x)} is not inside the block ($${h4(b.start + 1)}-$${h4(b.end - 1)})`); act({ kind: 'split', line: 0, at: x }); return me; },
      auto() { act({ kind: 'auto', line: 0, start: b.start, end: b.end }); return me; },
      exclude(on: unknown = true) { act({ kind: 'exclude', line: 0, at: b.start, on: !!on }); return me; },
      asBinary(on: unknown = true) { act({ kind: 'binary', line: 0, at: b.start, on: !!on }); return me; },
      junk() { act({ kind: 'junk', line: 0, start: b.start, end: b.end }); return me; },
      toString: () => `${st ? `struct${p.custom ? ` ${p.custom}` : ''}` : p.custom ? `${p.custom} (${as})` : as} $${h4(b.start)}-$${h4(b.end - 1)}${b.label ? ` ${b.label}` : ''}`,
    };
    // what is read from mem is read when it is asked for: the bytes as the script has them now
    Object.defineProperties(o, {
      bytes: { enumerable: false, get: () => mem.subarray(b.start, b.end) },
      text: { enumerable: false, get: () => (b.type === 'text' ? decodeText(mem.subarray(b.start, b.end), p.enc) : null) },
      words: { enumerable: false, get: () => Array.from({ length: size >> 1 }, (_, k) => mem[b.start + 2 * k] | (mem[b.start + 2 * k + 1] << 8)) },
      records: { enumerable: false, get: () => (st ? Array.from({ length: Math.floor(size / st.size) }, (_, k) => readStruct(mem, b.start + k * st.size, st[LAYOUT])) : null) },
      next: { enumerable: false, get: () => list[i + 1] ?? null },
      prev: { enumerable: false, get: () => list[i - 1] ?? null },
    });
    return o;
  });
  const starts = src.map(b => b.start);
  const blockAt = (a: Addr) => {
    let lo = 0, hi = starts.length - 1, k = -1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (starts[m] <= a) { k = m; lo = m + 1; } else hi = m - 1; }
    return k >= 0 && a < src[k].end ? list[k] : null;
  };
  const ofType = (type: unknown) => {
    const t = String(isLayout(type) ? 'struct' : (type as Custom | null)?.name ?? type ?? '').toLowerCase(), want = t === 'data' ? 'bytes' : t;
    return list.filter((b, i) => b.as === want || src[i].type === t || (b.custom != null && String(b.custom).toLowerCase() === t));
  };

  return {
    all: list, count: list.length, types: [...MARK_NAMES, 'struct'],
    get defined() { return [...customs.values()]; },
    at: (a: unknown) => blockAt(at(a, 'at')),
    in(s: unknown, e: unknown) { const [start, end] = span(s, e, 'in'); return list.filter((_, i) => src[i].start < end && start < src[i].end); },
    of: ofType,
    find(name: unknown) { const n = String(name ?? '').toLowerCase(); return list.find(b => typeof b.label === 'string' && b.label.toLowerCase() === n) ?? null; },
    mark, define,
    struct(a: unknown, b?: unknown) { return b === undefined ? layout(null, a) : layout(customName(a, 'struct'), b); },
    split(a: unknown) { act({ kind: 'split', line: 0, at: at(a, 'split') }); },
    auto(s: unknown, e: unknown) { const [start, end] = span(s, e, 'auto'); act({ kind: 'auto', line: 0, start, end }); },
    comment(a: unknown, t: unknown) { act({ kind: 'blockComment', line: 0, at: at(a, 'comment'), text: commentText(t) }); },
    exclude(a: unknown, on: unknown = true) { act({ kind: 'exclude', line: 0, at: at(a, 'exclude'), on: !!on }); },
    binary(a: unknown, on: unknown = true) { act({ kind: 'binary', line: 0, at: at(a, 'binary'), on: !!on }); },
    text(s: unknown, e: unknown, enc?: unknown) { const [start, end] = span(s, e, 'text'); return decodeText(mem.subarray(start, end), encOf(enc, 'text')); },
    encode(t: unknown, enc?: unknown) { const b = encodeText(String(t ?? ''), encOf(enc, 'encode')); if ('bad' in b) throw new RangeError(`encode: there is no byte for "${b.bad}" in that text type`); return b; },
  };
}
