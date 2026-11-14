/* A store of a script's code written into a scratchpad too (spec 10.3): a click on `sta $ff40,x` and a scratchpad
 * picked, and `sta pad2,x` goes in on the line after it. The scratchpad then holds what the store writes, each byte as
 * far from its start as the store's byte is from $ff40, so it can be looked at, compared and saved after a run. Only a
 * store whose copy writes the same byte with the same index register and nothing else: an STA, STX, STY or SAX at an
 * address, with ,x or ,y where the instruction has that form for an address of 16 bits (a scratchpad is never in the
 * zero page). A pointer's store ((zp),y), an instruction that changes the byte where it is (INC) and the unstable
 * stores (SHX) are said why not. */
import type { ScriptPad } from './types';
import { codeOf } from './script';

/** A store of a line of a script's code that can be written into a scratchpad too. */
export interface PadStore {
  /** its line, from 1 */
  line: number;
  /** the mnemonic as written (`sta`, `STA`), without an ending such as `.z` */
  mn: string;
  /** the address as written, without the index register */
  operand: string;
  /** the index register as written (`x`, `Y`), '' for none */
  index: string;
  /** what goes before the copy's mnemonic for it to stand under the store's (the label's width as spaces, tabs kept) */
  indent: string;
  /** the scratchpads the lines right after it already write it into the same way (`sta pad1,x`), with their lines */
  into: { pad: string; line: number }[];
  /** the line the copy goes after: the store's, or the last of the copies after it */
  after: number;
}

/** what a line is: a store that can be copied, one that cannot (and why), or null (no store: a load, a directive, a
 *  comment) */
export type PadStoreFind = PadStore | { line: number; why: string };

const STORES = new Set(['STA', 'STX', 'STY', 'SAX']);
/** the stores with no form for an index register and an address of 16 bits: STX $40,y has no STX $c000,y */
const NO_ABS_INDEX: Record<string, string> = { STX: 'y', STY: 'x', SAX: 'y' };
const RMW = new Set(['INC', 'DEC', 'ASL', 'LSR', 'ROL', 'ROR', 'SLO', 'RLA', 'SRE', 'RRA', 'DCP', 'ISC', 'ISB']);
const UNSTABLE = new Set(['AHX', 'SHA', 'SHX', 'SHY', 'TAS', 'SHS']);
/** the start of a line up to its mnemonic: spaces and a label (`loop:`, `!:`, `!loop:`) */
const LEAD = /^\s*(?:(?:[A-Za-z_][\w.]*|![A-Za-z_]\w*|!)\s*:\s*)?/;

/** whether line `n` (from 1) starts in a block comment that an earlier line opened */
function startsInComment(lines: readonly string[], n: number): boolean {
  let open = false;
  for (let i = 0; i < n - 1 && i < lines.length; i++) {
    const l = lines[i];
    for (let k = 0; k < l.length; k++) {
      if (open) { if (l[k] === '*' && l[k + 1] === '/') { open = false; k++; } continue; }
      if (l[k] === '"') { const e = l.indexOf('"', k + 1); if (e < 0) break; k = e; continue; }
      if (l[k] === '/' && l[k + 1] === '/') break;
      if (l[k] === '/' && l[k + 1] === '*') { open = true; k++; }
    }
  }
  return open;
}

interface Store { mn: string; up: string; operand: string; index: string; kind: 'plain' | 'index' | 'izx' | 'izy' }

/** a line's instruction that writes memory (its comment, strings and label left out), or null */
function storeOf(raw: string): Store | null {
  const m = /^([A-Za-z]{3})(?:\.[A-Za-z]+)?(?:\s+(.*))?$/.exec(codeOf(raw));
  if (!m) return null;
  const up = m[1].toUpperCase(), op = (m[2] ?? '').trim();
  if (!STORES.has(up) && !RMW.has(up) && !UNSTABLE.has(up)) return null;
  // an RMW of the accumulator (asl, rol a) writes no memory; nor does an immediate operand
  if (!op || /^[aA]$/.test(op) || op.startsWith('#')) return null;
  let r: RegExpExecArray | null;
  if ((r = /^\((.*)\)\s*,\s*([yY])$/.exec(op))) return { mn: m[1], up, operand: `(${r[1].trim()})`, index: r[2], kind: 'izy' };
  if ((r = /^\((.*?)\s*,\s*([xX])\s*\)$/.exec(op))) return { mn: m[1], up, operand: `(${r[1].trim()},${r[2]})`, index: '', kind: 'izx' };
  if ((r = /^(.*?)\s*,\s*([xyXY])$/.exec(op))) return { mn: m[1], up, operand: r[1], index: r[2], kind: 'index' };
  return { mn: m[1], up, operand: op, index: '', kind: 'plain' };
}

/** the scratchpad an operand is exactly (`pad1`), else null */
const padIs = (operand: string, pads: readonly Pick<ScriptPad, 'name'>[]) => pads.find(p => p.name === operand.trim())?.name ?? null;

/**
 * The store on line `line` (from 1) of a script's code (its lines), for a copy of it into a scratchpad: what it is
 * and where the copy goes, or why it cannot be copied; null when the line has no instruction that writes memory.
 */
export function padStoreAt(lines: readonly string[], line: number, pads: readonly Pick<ScriptPad, 'name'>[]): PadStoreFind | null {
  const raw = lines[line - 1];
  if (raw == null || startsInComment(lines, line)) return null;
  const s = storeOf(raw);
  if (!s) return null;
  const at = s.up === 'SAX' ? 'sax' : s.mn;
  if (UNSTABLE.has(s.up)) return { line, why: `${at} is an unstable store (what it writes depends on the address): copy it by hand` };
  if (RMW.has(s.up)) return { line, why: `${at} changes the byte where it is: a copy needs it read back (lda ${s.operand}${s.index ? `,${s.index}` : ''} and a store), which changes A and the flags, so write that by hand` };
  if (s.kind === 'izy' || s.kind === 'izx') return { line, why: `the address comes from the pointer ${s.operand}: a scratchpad would get only the ${s.kind === 'izy' ? ',y part' : 'byte of the last write'} of it, so copy it by hand (through a pointer of its own)` };
  const words = [...s.operand.matchAll(/[A-Za-z_]\w*/g)].map(w => w[0]);
  const own = pads.find(p => words.includes(p.name) || words.includes(`${p.name}_end`));
  if (own) return { line, why: `it writes into the scratchpad ${own.name} already` };
  if (s.index && NO_ABS_INDEX[s.up] === s.index.toLowerCase()) return { line, why: `${s.mn} has no ,${s.index} form for an address above the zero page, where a scratchpad is: the copy would not assemble` };
  const lead = LEAD.exec(raw)?.[0] ?? '';
  const indent = lead.replace(/[^\t]/g, ' ');
  // the copies right after it (sta pad1,x; sta pad2,x): a new one goes after them
  const into: PadStore['into'] = [];
  for (let n = line + 1; n <= lines.length; n++) {
    const c = storeOf(lines[n - 1]), pad = c && (c.kind === 'index' || c.kind === 'plain') ? padIs(c.operand, pads) : null;
    if (!c || !pad || c.up !== s.up || c.index.toLowerCase() !== s.index.toLowerCase()) break;
    into.push({ pad, line: n });
  }
  return { line, mn: s.mn, operand: s.operand, index: s.index, indent, into, after: into.length ? into[into.length - 1].line : line };
}

/** the line that writes what `st` writes into the scratchpad `pad` too: `sta pad2,x` under `sta $ff40,x` */
export const padStoreLine = (st: PadStore, pad: string): string => `${st.indent}${st.mn} ${pad}${st.index ? `,${st.index}` : ''}`;

/** how many bytes from its start the copy of `st` can write into a scratchpad: 256 with an index register, else 1 */
export const padStoreReach = (st: Pick<PadStore, 'index'>): number => (st.index ? 0x100 : 1);
