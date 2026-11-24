/* =====================================================================
 * Struct blocks (spec 10.3): data whose bytes are records of fields, each field bytes, words, addresses or a text.
 * A struct is a list of fields (types.ts StructField), kept with the override that marks the bytes; the listing and
 * the source write a line a field (render/kick.ts), so that a table of records reads as one.
 *
 * A field is written `"name: type"`, with a count and a number format when it has them:
 *
 *     "x: byte"   "hp: byte dec"   "flags: byte bin"   "row: byte[40]"
 *     "score: word dec"   "handler: addr"   "jumps: addr[4]"
 *     "title: text[16]"   "line: textsc[40]"   (textmix, textscmix: the mixed-case ones)
 *
 * or as { name, type, count, fmt }. A list of them is a struct; so is an object, a field a key: { x: "byte",
 * name: "text[8]" }.
 * ===================================================================== */
import type { NumberFormat, StructField, TextEncoding } from './types';
import { textEncoding } from './c64/text';

/** the most fields a struct has, and the most bytes a record is */
export const STRUCT_FIELDS = 64;
export const STRUCT_SIZE = 4096;

const TEXT_ENC: Record<string, TextEncoding> = { text: 'petscii', petscii: 'petscii', textsc: 'screen', screen: 'screen', textmix: 'petscii-mixed', textscmix: 'screen-mixed' };
const TYPES: Record<string, StructField['type']> = { byte: 'byte', bytes: 'byte', b: 'byte', u8: 'byte', word: 'word', words: 'word', w: 'word', u16: 'word', addr: 'addr', address: 'addr', ptr: 'addr', pointer: 'addr' };
const FMTS: readonly string[] = ['hex', 'dec', 'bin'];
/** the type names a field takes */
export const STRUCT_TYPES: readonly string[] = ['byte', 'word', 'addr', 'text', 'textsc', 'textmix', 'textscmix'];
const NAME = /^[A-Za-z_][A-Za-z0-9_]{0,31}$/;

/** how many bytes a field is */
export const fieldSize = (f: StructField): number => (f.count ?? 1) * (f.type === 'word' || f.type === 'addr' ? 2 : 1);
/** how many bytes a record is */
export const structSize = (fields: readonly StructField[]): number => fields.reduce((n, f) => n + fieldSize(f), 0);

/** the type of a field as it is written: `byte[40] dec`, `textsc[8]`, `addr` */
export function fieldTypeText(f: StructField): string {
  const t = f.type === 'text' ? Object.keys(TEXT_ENC).find(k => k.startsWith('text') && TEXT_ENC[k] === (f.enc ?? 'petscii'))! : f.type;
  return `${t}${(f.count ?? 1) > 1 || f.type === 'text' ? `[${f.count ?? 1}]` : ''}${f.fmt && f.fmt !== 'hex' ? ` ${f.fmt}` : ''}`;
}
/** a struct in a line: `x: byte, y: byte, name: text[8]` */
export const structText = (fields: readonly StructField[]): string => fields.map(f => `${f.name}: ${fieldTypeText(f)}`).join(', ');

function oneField(name: string, type: string, count: unknown, fmt: unknown): StructField {
  if (!NAME.test(name)) throw new TypeError(`struct: "${name}" is no field name: letters, digits and _, not starting with a digit`);
  const m = /^\s*([A-Za-z0-9]+)\s*(?:\[\s*(\d+)\s*\])?\s*([A-Za-z]+)?\s*$/.exec(type);
  const t = m?.[1].toLowerCase() ?? '', kind = TYPES[t] ?? (TEXT_ENC[t] ? 'text' : undefined);
  if (!m || !kind) throw new TypeError(`struct: "${type.trim()}" is no type of a field (${name}): ${STRUCT_TYPES.join(', ')}, with a count as byte[40] and a format as "byte dec"`);
  const n = count != null ? Number(count) : m[2] != null ? +m[2] : 1;
  if (!Number.isInteger(n) || n < 1 || n > STRUCT_SIZE) throw new RangeError(`struct: ${name} has a count of ${String(count ?? m[2])}: 1 to ${STRUCT_SIZE}`);
  const f = String(fmt ?? m[3] ?? '').toLowerCase();
  if (f && !FMTS.includes(f)) throw new TypeError(`struct: "${f}" is no number format (${name}): hex, dec or bin`);
  if (f && (kind === 'text' || kind === 'addr')) throw new TypeError(`struct: ${name} is ${kind === 'text' ? 'a text' : 'an address'}: it has no number format`);
  return { name, type: kind, ...(n > 1 || kind === 'text' ? { count: n } : {}), ...(f && f !== 'hex' ? { fmt: f as NumberFormat } : {}), ...(kind === 'text' ? { enc: TEXT_ENC[t] } : {}) };
}

/**
 * A struct's fields from how a script writes them: a list of `"name: type"` strings or { name, type, count, fmt }
 * objects, or an object with a field a key. It throws with what is wrong: no field, an unknown type, a name twice,
 * a record over STRUCT_SIZE bytes.
 */
export function structFields(spec: unknown): StructField[] {
  const list: unknown[] = Array.isArray(spec) ? spec
    : spec && typeof spec === 'object' ? Object.entries(spec as Record<string, unknown>).map(([k, v]) => (typeof v === 'string' ? `${k}: ${v}` : { ...(v as object), name: k }))
    : typeof spec === 'string' ? spec.split(',') : [];
  if (!list.length) throw new TypeError('struct: the fields are wanted: ["x: byte", "name: text[8]"] or { x: "byte", name: "text[8]" }');
  if (list.length > STRUCT_FIELDS) throw new RangeError(`struct: ${list.length} fields: a struct has ${STRUCT_FIELDS} at most`);
  const out = list.map((x): StructField => {
    if (typeof x === 'string') {
      const k = x.indexOf(':');
      if (k < 0) throw new TypeError(`struct: "${x.trim()}" is no field: write "name: type"`);
      return oneField(x.slice(0, k).trim(), x.slice(k + 1), undefined, undefined);
    }
    const o = (x ?? {}) as { name?: unknown; type?: unknown; count?: unknown; fmt?: unknown; enc?: unknown };
    const type = o.type === 'text' && typeof o.enc === 'string' ? Object.keys(TEXT_ENC).find(k => k.startsWith('text') && TEXT_ENC[k] === o.enc) ?? 'text' : String(o.type ?? '');
    return oneField(String(o.name ?? ''), type, o.count, o.fmt);
  });
  const twice = out.find((f, i) => out.findIndex(g => g.name === f.name) !== i);
  if (twice) throw new TypeError(`struct: the field ${twice.name} is there twice`);
  const size = structSize(out);
  if (size > STRUCT_SIZE) throw new RangeError(`struct: a record of ${size} bytes: ${STRUCT_SIZE} at most`);
  return out;
}

/** fields as a project file may hold them: those that are fields, or null when none is */
export function validStruct(fields: unknown): StructField[] | null {
  if (!Array.isArray(fields)) return null;
  try { return structFields(fields); } catch { return null; }
}

/** the text of bytes in an encoding, as the C64 shows it: a byte that is no character is a `.` */
export function decodeText(bytes: ArrayLike<number>, enc: TextEncoding | undefined): string {
  const char = textEncoding(enc).char;
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += char(bytes[i]) ?? '.';
  return s;
}
/** the bytes of a text in an encoding, or the character it has no byte for */
export function encodeText(text: string, enc: TextEncoding | undefined): Uint8Array | { bad: string } {
  const char = textEncoding(enc).char, back = new Map<string, number>();
  for (let b = 255; b >= 0; b--) { const c = char(b); if (c != null) back.set(c, b); }
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) { const b = back.get(text[i]); if (b == null) return { bad: text[i] }; out[i] = b; }
  return out;
}

/** a field's value in a record at `at`: a number, a text, or a list of numbers when it has a count */
export function fieldValue(mem: Uint8Array, at: number, f: StructField): number | string | number[] {
  const n = f.count ?? 1;
  if (f.type === 'text') return decodeText(mem.subarray(at, at + n), f.enc);
  const w = f.type === 'byte' ? 1 : 2;
  const v = Array.from({ length: n }, (_, i) => (w === 1 ? mem[(at + i) & 0xffff] : mem[(at + 2 * i) & 0xffff] | (mem[(at + 2 * i + 1) & 0xffff] << 8)));
  return n === 1 ? v[0] : v;
}
/** the record at `at`: each field's value by its name */
export function readStruct(mem: Uint8Array, at: number, fields: readonly StructField[]): Record<string, number | string | number[]> {
  const out: Record<string, number | string | number[]> = {};
  let p = at;
  for (const f of fields) { out[f.name] = fieldValue(mem, p, f); p += fieldSize(f); }
  return out;
}
