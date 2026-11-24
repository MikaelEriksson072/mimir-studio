/* =====================================================================
 * What a user script says about the program beyond its bytes (spec 10.3): directives of Mimir's own in the script's
 * code, which the assembler never sees and which are done when a run ends, with the bytes it changed:
 *
 *     .mark start, end, "type"   the bytes from start up to (not with) end are of this type, as Mark as makes them:
 *                                code, bytes, words, text, textsc, textmix, textscmix, table, sprite, charset,
 *                                bitmap, screen, music, fill (data is bytes)
 *     .name address, "name"      the address gets this label
 *     .note address, "text"      the line at the address gets this comment
 *     .junk start, end           the bytes from start up to (not with) end are junk: left out of everything
 *
 * A script that decrypts a block can so say what the block is: `.mark dest, dest + length, "text"`. An address is a
 * number (`$c000`, `49152`, `%1010`) or a name the code has (a label of the program, a scratchpad, a label, `.var` or
 * `.const` of the script's), added and subtracted: `table_end - 2`, `dest + length`. The directives are the same in
 * Kick Assembler and 64tass. (Not `.label` and `.comment`: Kick Assembler and 64tass have those.)
 * ===================================================================== */
import type { Addr, AnalysisResult, JunkArea, Override, OverrideProps, Project, RenderResult, ScriptLang } from './types';
import { commentAt, splitLabel } from './code-lang';
import { keepCutTypes, markOverride, splitBlock } from './edit';
import { findBlock } from './analyze/classify';
import { structSize, structText } from './struct';
import { addJunk, junkPlan } from './junk';
import { MARK_AS } from './model';
import { h4 } from './util/hex';

/** something a script's run does to the program beyond its bytes; `line`: the line of the code that says it */
export type ScriptAction =
  /** `props`: settings of the block besides its type's own (a JavaScript script's blocks.mark: a number format, a
   *  row length, a struct's fields, a custom type's name) */
  | { kind: 'mark'; line: number; start: Addr; end: Addr; as: string; props?: OverrideProps }
  /** a JavaScript script's blocks (script-blocks.ts): the detection back over a range, a block cut in two, the
   *  comment above a block, a block in or out of the build, a block as a binary file or in the source */
  | { kind: 'auto'; line: number; start: Addr; end: Addr }
  | { kind: 'split'; line: number; at: Addr }
  | { kind: 'blockComment'; line: number; at: Addr; text: string }
  | { kind: 'exclude'; line: number; at: Addr; on: boolean }
  | { kind: 'binary'; line: number; at: Addr; on: boolean }
  | { kind: 'name'; line: number; at: Addr; name: string }
  | { kind: 'note'; line: number; at: Addr; text: string }
  | { kind: 'junk'; line: number; start: Addr; end: Addr };

/** a directive of Mimir's as the code writes it: its line, its name and what follows it */
export interface ScriptDirective { line: number; name: 'mark' | 'name' | 'note' | 'junk'; args: string }

const DIRECTIVE = /^\.(mark|name|note|junk)(?:\s+(.*))?$/;

/** the types `.mark` takes: Mark as's (model.ts), and `data` for bytes */
export const MARK_NAMES: readonly string[] = [...MARK_AS.map(m => m.id), 'data'];

/**
 * A script's code without Mimir's directives (each such line empty, so that every other line keeps its number), and
 * the directives. The assembler gets the code; the directives are read once it has given the names their values.
 */
export function scriptDirectives(source: string, lang?: ScriptLang): { source: string; directives: ScriptDirective[] } {
  if (!/\.(mark|name|note|junk)\b/.test(source)) return { source, directives: [] };
  const directives: ScriptDirective[] = [];
  const lines = source.split('\n').map((l, i) => {
    const raw = l.replace(/\r$/, ''), c = commentAt(raw, lang), code = splitLabel(c < 0 ? raw : raw.slice(0, c), lang);
    const m = DIRECTIVE.exec(code.rest.trim());
    if (!m) return l;
    directives.push({ line: i + 1, name: m[1] as ScriptDirective['name'], args: (m[2] ?? '').trim() });
    // (a label before it stays a label of that line)
    return code.label ? code.lead.trimEnd() : '';
  });
  return { source: lines.join('\n'), directives };
}

/** what follows a directive, split at its commas (not those inside a string) */
function splitArgs(args: string): string[] {
  const out: string[] = [];
  let cur = '', quote = false;
  for (let k = 0; k < args.length; k++) {
    const ch = args[k];
    if (ch === '"') quote = !quote;
    if (ch === ',' && !quote) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  if (cur.trim() || out.length) out.push(cur.trim());
  return out;
}

/** a number or a name, added and subtracted: its value, or what is wrong with it */
function evaluate(expr: string, value: (name: string) => number | undefined): number | { error: string } {
  const t = expr.trim();
  if (!t) return { error: 'an address is missing' };
  const re = /\s*([+-])?\s*(\$[0-9a-fA-F]+|%[01]+|\d+|[A-Za-z_][\w.]*)/y;
  let sum = 0, at = 0, first = true;
  while (at < t.length) {
    re.lastIndex = at;
    const m = re.exec(t);
    if (!m || (!first && !m[1])) return { error: `"${t}" is not an address: a number or a name, added and subtracted (dest + length)` };
    const tok = m[2];
    const v = tok[0] === '$' ? parseInt(tok.slice(1), 16) : tok[0] === '%' ? parseInt(tok.slice(1), 2) : /^\d/.test(tok) ? parseInt(tok, 10) : value(tok);
    if (v == null || Number.isNaN(v)) return { error: `"${tok}" is not a name of the program or the script` };
    sum += m[1] === '-' ? -v : v;
    at = re.lastIndex; first = false;
  }
  return sum;
}

const text = (arg: string | undefined): string | null => { const m = /^"([^"]*)"$/.exec(arg ?? ''); return m ? m[1] : null; };

/**
 * The directives as things to do, their addresses worked out with the names' values (`value`: a name's value, or
 * undefined), and what is wrong with those that cannot be done: a missing or unknown argument, an address outside
 * memory, an end not after its start, a type `.mark` does not have, a name that is no label.
 */
export function scriptActions(directives: readonly ScriptDirective[], value: (name: string) => number | undefined): { actions: ScriptAction[]; problems: { line: number; msg: string }[] } {
  const actions: ScriptAction[] = [], problems: { line: number; msg: string }[] = [];
  for (const d of directives) {
    const bad = (msg: string) => { problems.push({ line: d.line, msg: `.${d.name}: ${msg}` }); };
    const a = splitArgs(d.args);
    const addr = (s: string | undefined, top = 0xffff): number | null => {
      const v = evaluate(s ?? '', value);
      if (typeof v !== 'number') { bad(v.error); return null; }
      if (v < 0 || v > top) { bad(`${s!.trim()} is $${v < 0 ? `-${(-v).toString(16)}` : v.toString(16)}, outside $0000-$${top.toString(16)}`); return null; }
      return v;
    };
    if (d.name === 'mark' || d.name === 'junk') {
      const want = d.name === 'mark' ? 3 : 2;
      if (a.length !== want) { bad(d.name === 'mark' ? 'write .mark start, end, "type"' : 'write .junk start, end'); continue; }
      const start = addr(a[0]), end = start == null ? null : addr(a[1], 0x10000);
      if (start == null || end == null) continue;
      if (end <= start) { bad(`the end ($${h4(end & 0xffff)}) is not after the start ($${h4(start)}): the end is the address after the last byte`); continue; }
      if (d.name === 'junk') { actions.push({ kind: 'junk', line: d.line, start, end }); continue; }
      const as = text(a[2])?.toLowerCase();
      if (as == null) { bad('the type goes in quotes: "text"'); continue; }
      if (!MARK_NAMES.includes(as)) { bad(`"${as}" is no type: ${MARK_NAMES.join(', ')}`); continue; }
      actions.push({ kind: 'mark', line: d.line, start, end, as: as === 'data' ? 'bytes' : as });
      continue;
    }
    if (a.length !== 2) { bad(d.name === 'name' ? 'write .name address, "name"' : 'write .note address, "text"'); continue; }
    const at = addr(a[0]), s = text(a[1]);
    if (at == null) continue;
    if (s == null || !s.trim()) { bad(d.name === 'name' ? 'the name goes in quotes: "decrypted"' : 'the text goes in quotes'); continue; }
    if (d.name === 'name') {
      if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(s)) { bad(`"${s}" is no label: letters, digits and _, starting with a letter`); continue; }
      actions.push({ kind: 'name', line: d.line, at, name: s });
    } else actions.push({ kind: 'note', line: d.line, at, text: s.trim().slice(0, 200) });
  }
  return { actions, problems };
}

/** What a run's actions come to in the project, and what was said about each. */
export interface ActionsPlan {
  /** to append to the project's overrides */
  overrides: Override[];
  labels: [Addr, string][];
  comments: [Addr, string][];
  /** the project's junk areas with the new ones (missing: none is new) */
  junk?: JunkArea[];
  /** comments above blocks, by the block's start ('': the comment is taken away) */
  blockComments: [Addr, string][];
  /** starts of blocks to leave out of the build (true) or put back in it, and to write as a binary file or in the source */
  excluded: [Addr, boolean][];
  binary: [Addr, boolean][];
  /** what is done, a line each */
  done: string[];
  /** what cannot be done, and why */
  failed: { line: number; why: string }[];
}

const span = (s: Addr, e: Addr) => (e - s > 1 ? `$${h4(s)}-$${h4(e - 1)}` : `$${h4(s)}`);

/**
 * A script's actions as changes to the project (nothing is changed here): the overrides its marks append (as Mark as
 * on a selection of bytes: the blocks a mark cuts keep their types beside it), its labels and comments, and the junk
 * areas with its junk. What cannot be done is said: a mark or a comment where no file has bytes, a mark over a
 * relocated block, a name another address has, junk the junk rules refuse.
 */
export function planScriptActions(A: AnalysisResult, R: Pick<RenderResult, 'labels' | 'zp'>, project: Pick<Project, 'junk'>, actions: readonly ScriptAction[]): ActionsPlan {
  const plan: ActionsPlan = { overrides: [], labels: [], comments: [], blockComments: [], excluded: [], binary: [], done: [], failed: [] };
  /** the block an action is about: the one that starts at the address or has it */
  const blockAt = (at: Addr) => { const b = findBlock(A.blocks, at); return b && at >= b.start && at < b.end ? b : null; };
  const loaded = (s: Addr, e: Addr) => { for (let a = s; a < e; a++) if (!(A.owner[a] >= 0)) return false; return true; };
  let junk = project.junk;
  for (const x of actions) {
    const fail = (why: string) => { plan.failed.push({ line: x.line, why }); };
    if (x.kind === 'mark') {
      if (!loaded(x.start, x.end)) { fail(`${span(x.start, x.end)} is not all the program's bytes: only bytes of a file can be marked`); continue; }
      if (A.owner[x.start] !== A.owner[x.end - 1]) { fail(`${span(x.start, x.end)} is in two files: mark each file's bytes`); continue; }
      const rl = A.relocs.find(r => r.start < x.end && x.start < r.end);
      if (rl) { fail(`${span(rl.start, rl.end)} is a relocated block (it runs at $${h4(rl.to)}): mark its bytes where they run`); continue; }
      const o = markOverride(A, x.start, x.end, x.as, false).override;
      if (x.props && Object.keys(x.props).length) o.props = { ...o.props, ...x.props };
      plan.overrides.push(...keepCutTypes(A, o.start, o.end), o);
      const st = o.props?.struct, n = st ? structSize(st) : 0, label = MARK_AS.find(m => m.id === x.as)?.label ?? x.as;
      plan.done.push(st ? `${span(x.start, x.end)} marked as the struct${o.props?.custom ? ` ${o.props.custom}` : ''} (${structText(st)}): ${Math.floor((x.end - x.start) / n)} record${Math.floor((x.end - x.start) / n) === 1 ? '' : 's'} of ${n} byte${n === 1 ? '' : 's'}${(x.end - x.start) % n ? `, and ${(x.end - x.start) % n} byte${(x.end - x.start) % n === 1 ? '' : 's'} after them` : ''}`
        : `${span(x.start, x.end)} marked as ${o.props?.custom ? `${o.props.custom} (${label})` : label}`);
    } else if (x.kind === 'auto') {
      if (!loaded(x.start, x.end)) { fail(`${span(x.start, x.end)} is not all the program's bytes`); continue; }
      plan.overrides.push({ start: x.start, end: x.end, type: 'auto' });
      plan.done.push(`${span(x.start, x.end)} is as the analysis reads it again (what was marked there is taken away)`);
    } else if (x.kind === 'split') {
      const s = splitBlock(A, x.at);
      if ('error' in s) { fail(s.error); continue; }
      plan.overrides.push(...s.overrides);
      plan.done.push(`the block ${span(s.block.start, s.block.end)} cut in two at $${h4(x.at)}`);
    } else if (x.kind === 'blockComment' || x.kind === 'exclude' || x.kind === 'binary') {
      // (a block this run marks from the address starts there, whatever block has the address now)
      const old = blockAt(x.at), mine = plan.overrides.filter(o => o.start === x.at && o.type !== 'auto' && o.end > x.at).pop();
      const b = old && mine ? { start: x.at, end: mine.end } : old;
      if (!b) { fail(`$${h4(x.at)} is in no block of the program`); continue; }
      if (x.kind === 'blockComment') {
        plan.blockComments.push([b.start, x.text]);
        plan.done.push(x.text ? `the block at $${h4(b.start)} commented: ${x.text.split('\n')[0]}` : `the comment above the block at $${h4(b.start)} taken away`);
      } else if (x.kind === 'exclude') {
        if (A.relocs.some(r => b.start >= r.to && b.start < r.to + r.end - r.start)) { fail(`the block at $${h4(b.start)} is inside a relocated block: leave the whole relocated block out`); continue; }
        plan.excluded.push([b.start, x.on]);
        plan.done.push(`the block ${span(b.start, b.end)} is ${x.on ? 'left out of' : 'in'} the build`);
      } else {
        plan.binary.push([b.start, x.on]);
        plan.done.push(`the block ${span(b.start, b.end)} is ${x.on ? 'saved as a binary file' : 'written in the source'}`);
      }
    } else if (x.kind === 'name') {
      const other = [...R.labels].find(([a, l]) => a !== x.at && l.name === x.name)?.[0] ?? [...R.zp].find(([a, z]) => a !== x.at && !z.off && z.name === x.name)?.[0]
        ?? plan.labels.find(([a, n]) => a !== x.at && n === x.name)?.[0];
      if (other != null) { fail(`the name ${x.name} is already at $${h4(other)}`); continue; }
      plan.labels.push([x.at, x.name]);
      plan.done.push(`$${h4(x.at)} named ${x.name}`);
    } else if (x.kind === 'note') {
      if (!loaded(x.at, x.at + 1)) { fail(`$${h4(x.at)} is not a byte of the program: a comment goes on a line of it`); continue; }
      plan.comments.push([x.at, x.text]);
      plan.done.push(`$${h4(x.at)} commented: ${x.text}`);
    } else {
      const p = junkPlan(A, junk, x.start, x.end);
      if ('error' in p) { fail(p.error); continue; }
      junk = addJunk(junk, p.start, p.end);
      plan.done.push(`${span(p.start, p.end)} is junk (${p.bytes} byte${p.bytes === 1 ? '' : 's'})`);
    }
  }
  if (junk !== project.junk) plan.junk = junk;
  return plan;
}
