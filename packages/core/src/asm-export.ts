/* =====================================================================
 * Export from an Assembler project (spec 10.7): the program its sources make (the PRG the build writes), an address
 * range of it, the bytes a source's lines write, or a data file's bytes, as raw bytes (.bin), a PRG, .byte lines in the
 * project's language, one source with its imports put in (the program only), VICE's labels (.vs), symbols (.sym), a C
 * array (.h), BASIC DATA lines with a loader (.bas), a hex dump (.txt) or a listing (.lst). What Mimir's check made is
 * what is exported: the Assembler passes its AsmCheck.
 * ===================================================================== */
import type { Addr, ScriptLang, Vfs } from './types';
import { ASM_SOURCE, ASM_TEXT, checkAsm, type AsmCheck } from './asm-project';
import { makePrg } from './c64/prg';
import { importPath } from './verify/kick-subset-assembler';
import { h4 } from './util/hex';

export type AsmExportKind = 'bin' | 'prg' | 'bytes' | 'one' | 'vs' | 'sym' | 'c' | 'bas' | 'hex' | 'lst';

/** a stretch of bytes and where they are */
export interface AsmExportPart { start: Addr; bytes: Uint8Array }

/** What is exported: its bytes (stretches in address order), a name for them, the program's names among them (null: a
 *  data file has none), and the check whose lines they come from (null: a data file's) */
export interface AsmExportSource {
  what: 'program' | 'range' | 'file' | 'data';
  name: string;
  parts: AsmExportPart[];
  names: Map<string, number> | null;
  check: AsmCheck | null;
  /** (a source file's) the file whose lines are listed */
  file?: string;
}

export interface AsmExportFormat { kind: AsmExportKind; label: string; ext: string; what: string }
export const ASM_EXPORT_FORMATS: readonly AsmExportFormat[] = [
  { kind: 'bin', label: 'Raw bytes (.bin)', ext: 'bin', what: 'The bytes alone, without a load address (gaps between stretches as 0).' },
  { kind: 'prg', label: 'With its load address (.prg)', ext: 'prg', what: 'The bytes after the two of their load address, as a C64 program file.' },
  { kind: 'bytes', label: 'Source, .byte lines (.asm)', ext: 'asm', what: 'The bytes as .byte lines in the project\'s language, a * = before each stretch and a label at the first.' },
  { kind: 'one', label: 'One source file (.asm)', ext: 'asm', what: 'The main file with every source it imports put in where it imports it: one file to build or share. The data it loads stays in its files (save it beside the main file).' },
  { kind: 'vs', label: 'VICE labels (.vs)', ext: 'vs', what: 'The labels at their addresses for VICE\'s monitor (ll "file.vs", or -moncommands).' },
  { kind: 'sym', label: 'Symbols (.sym)', ext: 'sym', what: 'The labels and constants as lines a source can import or include, in the project\'s language.' },
  { kind: 'c', label: 'C array (.h)', ext: 'h', what: 'The bytes as a C array, with #defines of their address and size (cc65, oscar64, a tool on the PC).' },
  { kind: 'bas', label: 'BASIC DATA lines (.bas)', ext: 'bas', what: 'A BASIC program as text (petcat, VICE\'s paste) whose loop POKEs the DATA lines\' bytes to their address.' },
  { kind: 'hex', label: 'Hex dump (.txt)', ext: 'txt', what: 'The address, 16 bytes and their text on each line.' },
  { kind: 'lst', label: 'Listing (.lst)', ext: 'lst', what: 'Each line of the sources that writes bytes: its address, its bytes, the file and line, and the line.' },
];

/** a name as a label or a C name: letters, digits and _, not a digit first */
export const exportName = (s: string): string => { const n = s.replace(/\.[^.]*$/, '').replace(/^.*[\\/]/, '').replace(/[^A-Za-z0-9_]/g, '_'); return /^[A-Za-z_]/.test(n) ? n : `_${n}`; };

/** the stretches of `mask` among `from`…`to` (exclusive), each with its bytes from `mem` */
function stretches(mem: Uint8Array, mask: (a: number) => boolean, from: number, to: number): AsmExportPart[] {
  const out: AsmExportPart[] = [];
  for (let a = from; a < to; a++) {
    if (!mask(a)) continue;
    const s = a;
    while (a < to && mask(a)) a++;
    out.push({ start: s, bytes: mem.slice(s, a) });
  }
  return out;
}
/** the names whose values are among the parts' addresses (all of them: `all`) */
const namesIn = (names: Map<string, number>, parts: readonly AsmExportPart[], all = false) =>
  new Map([...names].filter(([, v]) => all || parts.some(p => v >= p.start && v < p.start + p.bytes.length)));

/** the program the sources make: the PRG the build writes (its load address and bytes) */
export function asmExportProgram(c: AsmCheck, name: string): AsmExportSource | null {
  const prg = c.asm.prg;
  if (!prg || prg.length < 3) return null;
  return { what: 'program', name, parts: [{ start: prg[0] | prg[1] << 8, bytes: prg.slice(2) }], names: namesIn(c.names, [], true), check: c };
}
/** the program's memory from `from` to `to` (inclusive), all of it (what nothing writes is 0) */
export function asmExportRange(c: AsmCheck, from: Addr, to: Addr, name: string): AsmExportSource | null {
  if (from < 0 || to > 0xffff || to < from) return null;
  const parts = [{ start: from, bytes: c.asm.mem.slice(from, to + 1) }];
  return { what: 'range', name, parts, names: namesIn(c.names, parts), check: c };
}
/** the bytes the lines of the source `file` write (macros' bytes are their calls'), in stretches */
export function asmExportFile(c: AsmCheck, file: string, name: string): AsmExportSource | null {
  const f = c.files.indexOf(file) + 1;
  if (!f) return null;
  const parts = stretches(c.asm.mem, a => !!c.asm.written[a] && c.fileOf[a] === f, 0, 0x10000);
  return parts.length ? { what: 'file', name, parts, names: namesIn(c.names, parts), check: c, file } : null;
}
/** a data file's bytes at `start` (a .prg's: after its load address, there) */
export function asmExportData(bytes: Uint8Array, start: Addr, name: string, prg = false): AsmExportSource {
  const at = prg && bytes.length >= 2 ? bytes[0] | bytes[1] << 8 : start;
  return { what: 'data', name, parts: [{ start: at, bytes: prg ? bytes.slice(2) : bytes }], names: null, check: null };
}
/** where the bytes of a data file are in the program's memory, when they are there once (a file the sources load) */
export function asmDataAt(c: AsmCheck, bytes: Uint8Array): Addr | null {
  if (!bytes.length || bytes.length > 0x10000) return null;
  let found: Addr | null = null;
  for (const r of c.ranges) for (let a = r.start; a + bytes.length <= r.end; a++) {
    let k = 0;
    while (k < bytes.length && c.asm.mem[a + k] === bytes[k]) k++;
    if (k === bytes.length) { if (found != null) return null; found = a; }
  }
  return found;
}

/** the formats that fit what is exported */
export function asmExportKinds(s: AsmExportSource): AsmExportKind[] {
  return ASM_EXPORT_FORMATS.map(f => f.kind).filter(k =>
    k === 'one' ? s.what === 'program' : k === 'vs' || k === 'sym' ? !!s.names?.size : k === 'lst' ? !!s.check : true);
}

/** all the parts as one stretch, from the first byte to the last (the gaps 0, as in a PRG) */
export function joinedParts(parts: readonly AsmExportPart[]): AsmExportPart {
  if (!parts.length) return { start: 0, bytes: new Uint8Array(0) };
  const start = parts[0].start, last = parts[parts.length - 1], out = new Uint8Array(last.start + last.bytes.length - start);
  for (const p of parts) out.set(p.bytes, p.start - start);
  return { start, bytes: out };
}

const hx = (n: number, w = 2) => n.toString(16).padStart(w, '0');
const val = (v: number) => (v < 0 || !Number.isInteger(v) ? String(v) : `$${hx(v, v < 0x100 ? 2 : v < 0x10000 ? 4 : 6)}`);
const span = (s: AsmExportSource) => { const j = joinedParts(s.parts); return `$${h4(j.start)}–$${h4(j.start + j.bytes.length - 1)}, ${j.bytes.length} bytes`; };

/** the bytes as .byte lines in `lang` (Kick Assembler or 64tass), 16 to a line */
export function asmExportByteLines(s: AsmExportSource, lang: ScriptLang): string {
  const tass = lang === '64tass', c = tass ? ';' : '//', label = exportName(s.name);
  const out = [`${c} ${s.name}: ${span(s)} (exported by Mimir Studio)`];
  s.parts.forEach((p, i) => {
    out.push('', `* = $${h4(p.start)}`);
    const l = i ? `${label}_${h4(p.start)}` : label;
    out.push(tass ? l : `${l}:`);
    for (let k = 0; k < p.bytes.length; k += 16) out.push(`${tass ? '        ' : '    '}.byte ${[...p.bytes.subarray(k, k + 16)].map(b => `$${hx(b)}`).join(', ')}`);
  });
  return out.join('\n') + '\n';
}

/** VICE's labels: `al C:0801 .start`, by address */
export function asmExportViceLabels(names: ReadonlyMap<string, number>): string {
  return [...names].filter(([, v]) => Number.isInteger(v) && v >= 0 && v <= 0xffff).sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
    .map(([n, v]) => `al C:${h4(v)} .${n}`).join('\n') + '\n';
}

/** the names as lines a source takes: Kick Assembler `.label name=$0801`, 64tass `name = $0801` (a name with a dot, a
 *  namespace's, is left out: only VICE's labels have it) */
export function asmExportSymbols(names: ReadonlyMap<string, number>, lang: ScriptLang): string {
  const tass = lang === '64tass', list = [...names].filter(([n]) => /^[A-Za-z_]\w*$/.test(n)).sort((a, b) => a[0].localeCompare(b[0]));
  const w = Math.max(0, ...list.map(([n]) => n.length));
  return `${tass ? ';' : '//'} the labels and constants of the program (exported by Mimir Studio)\n`
    + list.map(([n, v]) => (tass ? `${n.padEnd(w)} = ${val(v)}` : `.label ${n}=${val(v)}`)).join('\n') + '\n';
}

/** the bytes as a C array, with their address and size */
export function asmExportC(s: AsmExportSource): string {
  const j = joinedParts(s.parts), n = exportName(s.name), N = n.toUpperCase();
  const rows: string[] = [];
  for (let k = 0; k < j.bytes.length; k += 12) rows.push(`    ${[...j.bytes.subarray(k, k + 12)].map(b => `0x${hx(b)}`).join(', ')}`);
  return [`/* ${s.name}: ${span(s)} (exported by Mimir Studio) */`, `#define ${N}_ADDR 0x${h4(j.start)}`, `#define ${N}_SIZE ${j.bytes.length}`, '',
    `const unsigned char ${n}[${j.bytes.length}] = {`, rows.join(',\n'), '};', ''].join('\n');
}

/** BASIC's own program and variables: POKEs there overwrite the BASIC program that makes them */
export const BASIC_AREA = { start: 0x0801, end: 0xa000 };
/** a BASIC program as text (lower case, as petcat and VICE's paste take it): a loop that POKEs the DATA lines' bytes
 *  to where they go; each line at most 80 characters, as the C64's editor takes them */
export function asmExportBasic(s: AsmExportSource): string {
  const j = joinedParts(s.parts), n = j.bytes.length;
  const out = [`10 rem ${s.name.toLowerCase().replace(/[^a-z0-9 ._-]/g, '')} $${h4(j.start)}-$${h4(j.start + n - 1)} ${n} bytes`,
    `20 for i=0 to ${n - 1}:read b:poke ${j.start}+i,b:next`, '30 end'];
  let line = 100, row: string[] = [];
  const flush = () => { if (row.length) { out.push(`${line} data ${row.join(',')}`); line += 10; row = []; } };
  for (const b of j.bytes) {
    if (`${line} data ${[...row, b].join(',')}`.length > 80) flush();
    row.push(String(b));
  }
  flush();
  return out.join('\n') + '\n';
}

/** a hex dump: the address, 16 bytes and their text (what is not printable a dot), each stretch on its lines */
export function asmExportHex(s: AsmExportSource): string {
  const out: string[] = [];
  for (const p of s.parts) {
    if (out.length) out.push('');
    for (let k = 0; k < p.bytes.length; k += 16) {
      const b = [...p.bytes.subarray(k, k + 16)];
      out.push(`${h4(p.start + k)}  ${b.map(x => hx(x)).join(' ').padEnd(47)}  ${b.map(x => (x >= 0x20 && x < 0x7f ? String.fromCharCode(x) : '.')).join('')}`);
    }
  }
  return out.join('\n') + '\n';
}

/** A listing: each line of the sources that writes bytes among the parts, in address order: its address, its bytes (8
 *  at most, then how many more), the file and line, and the line. `texts`: the sources' texts by path. */
export function asmExportListing(s: AsmExportSource, texts: Readonly<Record<string, string | Uint8Array>>): string {
  const c = s.check;
  if (!c) return '';
  const { written, starts, lines, mem } = c.asm;
  const lineOf = new Map<string, string[]>();
  const textAt = (file: string, line: number) => {
    let l = lineOf.get(file);
    if (!l) { const t = texts[file]; l = typeof t === 'string' ? t.split(/\r?\n/) : []; lineOf.set(file, l); }
    return (l[line - 1] ?? '').replace(/\s+$/, '');
  };
  const fileNo = s.file ? c.files.indexOf(s.file) + 1 : 0;
  const out: string[] = [`; ${s.name}: ${span(s)} (exported by Mimir Studio)`];
  for (const p of s.parts) {
    const end = p.start + p.bytes.length;
    for (let a = p.start; a < end;) {
      if (!written[a] || (fileNo && c.fileOf[a] !== fileNo)) { a++; continue; }
      // a statement: from where its bytes start to the next one's (or a byte of another line, or none)
      const f = c.fileOf[a], ln = lines[a];
      let b = a + 1;
      while (b < end && written[b] && !starts[b] && c.fileOf[b] === f && lines[b] === ln) b++;
      const bytes = [...mem.subarray(a, b)];
      const where = f && ln ? `${c.files[f - 1]}:${ln}` : '';
      const shown = bytes.slice(0, 8).map(x => hx(x)).join(' ');
      out.push(`${h4(a)}  ${shown.padEnd(23)}  ${where.padEnd(18)}  ${f && ln ? textAt(c.files[f - 1], ln) : ''}`.replace(/\s+$/, ''));
      if (bytes.length > 8) out.push(`      … ${bytes.length - 8} more byte${bytes.length - 8 === 1 ? '' : 's'}`);
      a = b;
    }
  }
  return out.join('\n') + '\n';
}

/* ---- one source: the main file with what it imports put in ---- */

/** the folder part of a path (`lib/x.asm` → `lib/`) */
const folderOf = (p: string) => { const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\')); return i < 0 ? '' : p.slice(0, i + 1); };
/** `to` (a path in the files) from the folder `dir`: `../lib/x.bin`; an absolute one as it is */
function relativeTo(dir: string, to: string): string {
  if (/^([A-Za-z]:)?[\\/]/.test(to)) return to;
  const a = dir.split('/').filter(Boolean), b = to.split('/');
  let i = 0;
  while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
  return [...a.slice(i).map(() => '..'), ...b.slice(i)].join('/');
}

/**
 * The main file with every source it imports put in where it imports it, as the assembler reads them (Kick
 * Assembler's #import, .import source and #importonce; 64tass's .include and .binclude, which is a .block of its own),
 * found as Mimir's check finds them. A data file an imported source names from another folder is named from the main
 * file's folder. `inlined`: the sources put in; `problems`: what could not be.
 */
export function asmOneSource(vfs: Vfs, main: string, lang: ScriptLang): { text: string; inlined: string[]; problems: string[] } {
  const tass = lang === '64tass', cmt = tass ? ';' : '//';
  const inlined: string[] = [], problems: string[] = [], once = new Set<string>(), done = new Set<string>();
  const mainDir = folderOf(main).replace(/\\/g, '/');
  /** a file's data names made the main file's (the quoted names of files the folder has that are not sources) */
  const data = (line: string, file: string): string => {
    if (folderOf(file) === folderOf(main)) return line;
    return line.replace(/"([^"\r\n]+\.[A-Za-z0-9]{1,8})"/g, (m, p: string) => {
      const at = importPath(vfs, file, p);
      if (at === p || vfs[at] === undefined || ASM_TEXT.test(at)) return m;
      return `"${relativeTo(mainDir, at)}"`;
    });
  };
  const put = (file: string, depth: number, stack: string[]): string[] => {
    const src = vfs[file];
    if (typeof src !== 'string') { problems.push(`${file} is not there`); return [`${cmt} ${file}: not found`]; }
    if (depth > 16 || stack.includes(file)) { problems.push(`${file} imports itself`); return [`${cmt} ${file}: imported again inside itself`]; }
    const out: string[] = [];
    let block = false, comment = false;
    for (const raw of src.split(/\r?\n/)) {
      if (tass) {
        if (comment) { out.push(raw); if (/^\s*\.endc(omment)?\b/.test(raw)) comment = false; continue; }
        if (/^\s*\.comment\b/.test(raw)) { comment = true; out.push(raw); continue; }
        const m = /^(\s*)(?:([A-Za-z_]\w*)(:?)\s+)?\.(b?include)\s+"([^"]+)"\s*(;.*)?$/.exec(raw);
        if (m) {
          const at = importPath(vfs, file, m[5]);
          const body = put(at, depth + 1, [...stack, file]);
          if (!inlined.includes(at) && typeof vfs[at] === 'string') inlined.push(at);
          if (m[4] === 'binclude') out.push(`${m[2] ? `${m[2]}${m[3]} ` : '        '}.block ${cmt} .binclude "${m[5]}"`, ...body, '        .bend');
          else out.push(...(m[2] ? [`${m[2]}${m[3]}`] : []), `${cmt} ---- ${m[5]} ----`, ...body, `${cmt} ---- end of ${m[5]} ----`);
          continue;
        }
        out.push(data(raw, file));
        continue;
      }
      // (Kick Assembler: not in a /* */ comment)
      let code = '';
      for (let k = 0, q = false; k < raw.length; k++) {
        const c = raw[k];
        if (block) { if (c === '*' && raw[k + 1] === '/') { block = false; k++; } continue; }
        if (c === '"') q = !q;
        if (!q && c === '/' && raw[k + 1] === '/') break;
        if (!q && c === '/' && raw[k + 1] === '*') { block = true; k++; continue; }
        code += c;
      }
      if (/^\s*#importonce\b/.test(code)) { out.push(`${cmt} (#importonce: put in once)`); continue; }
      const m = /^\s*(?:([A-Za-z_]\w*)\s*:\s*)?(?:#import|\.import\s+source)\s+"([^"]+)"/.exec(code);
      if (m) {
        const at = importPath(vfs, file, m[2]);
        if (m[1]) out.push(`${m[1]}:`);
        if (done.has(at) && once.has(at)) { out.push(`${cmt} ${m[2]}: put in already (it has #importonce)`); continue; }
        done.add(at);
        const text = vfs[at];
        if (typeof text === 'string' && /^\s*#importonce\b/m.test(text)) once.add(at);
        const body = put(at, depth + 1, [...stack, file]);
        if (!inlined.includes(at) && typeof text === 'string') inlined.push(at);
        out.push(`${cmt} ---- ${m[2]} ----`, ...body, `${cmt} ---- end of ${m[2]} ----`);
        continue;
      }
      out.push(data(raw, file));
    }
    return out;
  };
  const text = [`${cmt} ${main.replace(/^.*[\\/]/, '')} with the sources it imports put in (exported by Mimir Studio)`, ...put(main, 0, [])].join('\n');
  return { text: text.endsWith('\n') ? text : `${text}\n`, inlined, problems };
}

/** whether one source gives the program the project's sources give: Mimir's check of it alone (the other sources
 *  taken away, the data files kept) against `c`'s PRG */
export function asmOneSourceSame(vfs: Vfs, main: string, lang: ScriptLang, text: string, c: AsmCheck, args?: readonly string[]): { same: boolean; problems: string[] } {
  const alone: Vfs = {};
  for (const [k, v] of Object.entries(vfs)) if (!(typeof v === 'string' && ASM_SOURCE.test(k))) alone[k] = v;
  alone[main] = text;
  const d = checkAsm(alone, main, lang, args ? { args } : {});
  const a = d.asm.prg, b = c.asm.prg;
  const same = !!a && !!b && a.length === b.length && a.every((x, i) => x === b[i]);
  return { same, problems: d.problems.map(p => `${p.line ? `line ${p.line}: ` : ''}${p.msg}`) };
}

/** the file an export makes: its bytes (a text's in UTF-8) */
export function asmExport(kind: AsmExportKind, s: AsmExportSource, o: { lang: ScriptLang; texts?: Readonly<Record<string, string | Uint8Array>>; one?: string }): Uint8Array {
  const t = (x: string) => new TextEncoder().encode(x);
  switch (kind) {
    case 'bin': return joinedParts(s.parts).bytes;
    case 'prg': { const j = joinedParts(s.parts); return makePrg(j.start, j.bytes); }
    case 'bytes': return t(asmExportByteLines(s, o.lang));
    case 'one': return t(o.one ?? '');
    case 'vs': return t(asmExportViceLabels(s.names ?? new Map()));
    case 'sym': return t(asmExportSymbols(s.names ?? new Map(), o.lang));
    case 'c': return t(asmExportC(s));
    case 'bas': return t(asmExportBasic(s));
    case 'hex': return t(asmExportHex(s));
    case 'lst': return t(asmExportListing(s, o.texts ?? {}));
  }
}
