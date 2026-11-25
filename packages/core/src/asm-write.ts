/* =====================================================================
 * Bytes changed in an Assembler project's program written back into its sources (spec 10.7): a pixel drawn in the
 * enlarged sprite or character changes the byte, and the line that writes it changes with it. A `.byte` line gets the
 * new value in the place of the old one, written as the old one was (binary, hex or decimal, as wide); a file a line
 * imports (`.import binary`, `.binary`) gets it at the offset the line reads. A byte written by anything else (an
 * expression, `.fill`, a loop or a macro that writes the line more than once, LoadSid) is not changed: what says why.
 * ===================================================================== */
import type { Addr, ScriptLang, Vfs } from './types';
import type { AsmCheck } from './asm-project';
import { langIs } from './code-lang';
import { importPath } from './verify/kick-subset-assembler';
import { h4 } from './util/hex';

/** a byte of the program and the value it is to have */
export interface AsmByteChange { addr: Addr; value: number }

/** the sources' texts and the data files changed (only those), the lines they are on, and what could not be changed */
export interface AsmWriteBack { texts: Record<string, string>; bins: Record<string, Uint8Array>; lines: { file: string; line: number }[]; problems: string[] }

/** a number as the source writes one: $hex, %binary or decimal (null: an expression, a character, a name) */
function literal(s: string): { v: number; f: 'hex' | 'bin' | 'dec'; digits: number; upper: boolean } | null {
  let m = s.match(/^\$([0-9a-f]+)$/i);
  if (m) return { v: parseInt(m[1], 16), f: 'hex', digits: m[1].length, upper: /[A-F]/.test(m[1]) };
  m = s.match(/^%([01]+)$/);
  if (m) return { v: parseInt(m[1], 2), f: 'bin', digits: m[1].length, upper: false };
  m = s.match(/^0x([0-9a-f]+)$/i);
  if (m) return { v: parseInt(m[1], 16), f: 'hex', digits: m[1].length, upper: /[A-F]/.test(m[1]) };
  return /^\d+$/.test(s) ? { v: Number(s), f: 'dec', digits: s.length, upper: false } : null;
}
/** `v` written as `was` is: the same base, at least as many digits */
function asWas(was: NonNullable<ReturnType<typeof literal>>, v: number): string {
  if (was.f === 'bin') return `%${v.toString(2).padStart(Math.max(8, was.digits), '0')}`;
  if (was.f === 'hex') { const t = v.toString(16).padStart(Math.max(2, was.digits), '0'); return `$${was.upper ? t.toUpperCase() : t}`; }
  return String(v);
}

/** where a line's code ends: its comment's start (`//` or `/*` in Kick Assembler, `;` in 64tass), outside strings */
function codeEnd(line: string, tass: boolean): number {
  let q = '';
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === q) q = ''; continue; }
    if (c === '"' || c === '\'') { q = c; continue; }
    if (tass ? c === ';' : c === '/' && (line[i + 1] === '/' || line[i + 1] === '*')) return i;
  }
  return line.length;
}
/** the comma-separated items of `s` from `from` to `to`: each one's place in the line (trimmed) */
function items(s: string, from: number, to: number): { start: number; end: number; text: string }[] {
  const out: { start: number; end: number; text: string }[] = [];
  let depth = 0, q = '', at = from;
  const push = (end: number) => {
    let a = at, b = end;
    while (a < b && /\s/.test(s[a])) a++;
    while (b > a && /\s/.test(s[b - 1])) b--;
    out.push({ start: a, end: b, text: s.slice(a, b) });
  };
  for (let i = from; i < to; i++) {
    const c = s[i];
    if (q) { if (c === q) q = ''; continue; }
    if (c === '"' || c === '\'') q = c;
    else if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (c === ',' && depth === 0) { push(i); at = i + 1; }
  }
  push(to);
  return out.filter(x => x.text !== '' || out.length > 1);
}

/** Write `changes` into the sources `vfs` the check `c` assembled (Mimir's assembler, `lang`). */
export function asmWriteBytes(c: Pick<AsmCheck, 'files' | 'fileOf' | 'asm'>, vfs: Vfs, lang: ScriptLang, changes: readonly AsmByteChange[]): AsmWriteBack {
  const tass = langIs(lang) === '64tass';
  const out: AsmWriteBack = { texts: {}, bins: {}, lines: [], problems: [] };
  // the changes by the line that writes each byte
  const groups = new Map<string, { fi: number; line: number; changes: AsmByteChange[] }>();
  for (const ch of changes) {
    const a = ch.addr & 0xffff, fi = c.fileOf[a], line = c.asm.lines[a];
    if (!c.asm.written[a] || !fi || !line) { out.problems.push(`$${h4(a)} is not written by a line of the sources`); continue; }
    const k = `${fi}:${line}`;
    if (!groups.has(k)) groups.set(k, { fi, line, changes: [] });
    groups.get(k)!.changes.push({ addr: a, value: ch.value & 0xff });
  }
  const textOf = (p: string) => out.texts[p] ?? (typeof vfs[p] === 'string' ? vfs[p] as string : null);
  for (const g of groups.values()) {
    const file = c.files[g.fi - 1], text = textOf(file);
    const where = `${file} line ${g.line}`;
    if (text == null) { out.problems.push(`${where} is not a source Mimir has`); continue; }
    // the bytes the line writes: one after another, once
    const addrs: Addr[] = [];
    for (let a = 0; a < 0x10000; a++) if (c.fileOf[a] === g.fi && c.asm.lines[a] === g.line && c.asm.written[a]) addrs.push(a);
    const start = addrs[0], contiguous = addrs.every((a, i) => a === start + i);
    const lines = text.split('\n'), raw = lines[g.line - 1] ?? '', cr = raw.endsWith('\r'), lt = cr ? raw.slice(0, -1) : raw;
    const end = codeEnd(lt, tass);
    const m = /(^|[\s:])\.(byte|by|import\s+binary|binary)\b/i.exec(lt.slice(0, end));
    const dir = m ? m[2].toLowerCase().replace(/\s+/g, ' ') : null;
    if (!m || !dir || (tass ? dir === 'import binary' || dir === 'by' : dir === 'binary')) {
      out.problems.push(`$${h4(g.changes[0].addr)} is written by ${where}, which is not .byte or a binary file it loads: change it there`);
      continue;
    }
    const argsFrom = m.index + m[0].length;
    const args = items(lt, argsFrom, end);
    if (dir === 'byte' || dir === 'by') {
      if (!contiguous || addrs.length !== args.length) { out.problems.push(`${where} writes its bytes more than once (a loop or a macro): change it there`); continue; }
      let line = lt, bad = false;
      // (from the last item to the first: the places before each stay where they are)
      for (const ch of [...g.changes].sort((x, y) => y.addr - x.addr)) {
        const it = args[ch.addr - start], was = it ? literal(it.text) : null;
        if (!it || !was) { out.problems.push(`$${h4(ch.addr)} is the value ${it?.text ?? '?'} on ${where}, not a number: change it there`); bad = true; continue; }
        if (was.v === ch.value) continue;
        line = line.slice(0, it.start) + asWas(was, ch.value) + line.slice(it.end);
      }
      if (line !== lt) { lines[g.line - 1] = cr ? `${line}\r` : line; out.texts[file] = lines.join('\n'); out.lines.push({ file, line: g.line }); }
      else if (!bad) out.lines.push({ file, line: g.line });
      continue;
    }
    // a file the line loads: the byte at the offset the line reads it from
    const pm = args[0]?.text.match(/^"([^"]*)"$/);
    const off = args[1] ? literal(args[1].text) : { v: 0 };
    if (!pm || !off || (args[2] && !literal(args[2].text))) { out.problems.push(`${where} loads its file with an expression: change the file itself`); continue; }
    const path = importPath(vfs, file, pm[1]), was = out.bins[path] ?? vfs[path];
    if (!(was instanceof Uint8Array)) { out.problems.push(`${pm[1]} (${where}) is not a file Mimir has read`); continue; }
    if (!contiguous) { out.problems.push(`${where} loads its file more than once (a loop or a macro): change the file itself`); continue; }
    const bytes = out.bins[path] ?? was.slice();
    for (const ch of g.changes) { const i = off.v + (ch.addr - start); if (i >= 0 && i < bytes.length) bytes[i] = ch.value; }
    out.bins[path] = bytes;
    out.lines.push({ file, line: g.line });
  }
  return out;
}
