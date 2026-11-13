/* What the overview of the analysis says (spec 14.1b), part by part: worked out from the analysis and the project
 * alone, so the window (components/Overview.tsx) only lays it out and links each part to where it is. */
// (no DOM here, nor the store: the unit tests type-check it for Node)
import { areaAt, kindInfo, parseVsf, snapshotConfig, type Addr, type AnalysisResult, type Block, type Project, type TypeGroup } from '@mimir/core';
import { blockFolders, type BlockFolder } from './blockfolders';
import type { UiProblem } from './types';

/** where VICE's CPU was when it saved the snapshot the project was opened from (spec 13.7) */
export interface SnapshotPc {
  pc: Addr;
  a: number; x: number; y: number; sp: number; status: number;
  /** $01 */
  port: number;
  /** the PC is in the bytes opened, so the listing and the .asm have its line; else `where` says where it is */
  loaded: boolean;
  where: string | null;
}

const AREA: Record<string, string> = { basic: 'the BASIC ROM', kernal: 'the KERNAL ROM', io: 'I/O', char: 'the character ROM', cart: 'the cartridge ROM' };

/** The CPU of the first snapshot among the files (as the analysis has them: `owner` says which bytes are opened), or
 *  null when there is none or it has no MAINCPU module. A PC in ROM, in I/O or below the RAM opened (the zero page and
 *  the stack, without the setting) is not in the listing. */
export function snapshotPc(files: readonly { vsf?: Uint8Array }[], owner: ArrayLike<number>): SnapshotPc | null {
  const vsf = files.find(f => f.vsf)?.vsf;
  if (!vsf) return null;
  let s;
  try { s = parseVsf(vsf); } catch { return null; }
  if (!s.cpu) return null;
  const { pc } = s.cpu;
  const area = areaAt(pc, snapshotConfig(s), false);
  const loaded = area === 'ram' && owner[pc] >= 0;
  const where = loaded ? null : area !== 'ram' ? AREA[area] ?? area : pc < 0x0200 ? 'the zero page or the stack, which are not opened' : 'bytes not opened';
  return { ...s.cpu, port: s.port.data, loaded, where };
}

/** The label at `a`, else the nearest one before it in the 256 bytes below (`name+3`); null when there is none. */
export function nameNear(labels: ReadonlyMap<Addr, { name: string }>, a: Addr): string | null {
  for (let d = 0; d < 256 && a - d >= 0; d++) { const l = labels.get(a - d); if (l) return d ? `${l.name}+${d}` : l.name; }
  return null;
}

/** the registers as VICE's monitor shows them after `r`: A X Y SP, $01 and the flags NV-BDIZC */
export const regsText = (s: SnapshotPc): string =>
  `A ${hx(s.a)}  X ${hx(s.x)}  Y ${hx(s.y)}  SP ${hx(s.sp)}  $01 ${hx(s.port)}  NV-BDIZC ${s.status.toString(2).padStart(8, '0')}`;
const hx = (n: number) => `$${n.toString(16).padStart(2, '0')}`;

/** where the program starts, and how the analysis knows (a sentence); `basic`: the BASIC line with the SYS */
export interface StartInfo { addr: Addr; from: string; basic: string | null }

/** The program start as the analysis took it (in the order it takes one: set for the project, a BASIC stub's SYS, a
 *  cartridge's vectors, else the first file's load address). */
export function startOf(A: AnalysisResult, project: Pick<Project, 'entryPoint' | 'files' | 'cart'>): StartInfo | null {
  const e = A.entry;
  if (e == null) return null;
  const sys = A.basics.find(b => b.sys === e);
  // (the line's text starts with its number)
  const basic = sys?.sysLine ? sys.sysLine.text.trim() : null;
  if (project.entryPoint === e) {
    // a snapshot's BASIC SYS and the address an unpacker left the program at are set as the start when they are opened
    const from = project.files.some(f => f.vsf) ? "From the snapshot's BASIC SYS line."
      : project.files.some(f => /-unpacked(_\d+)?\.prg$/i.test(f.name)) ? 'Where the unpacker left the program.' : 'Set by you.';
    return { addr: e, from, basic };
  }
  if (sys) return { addr: e, from: 'From the SYS in the BASIC line.', basic };
  if (project.cart) return { addr: e, from: "From the cartridge's start vector.", basic: null };
  return { addr: e, from: A.files[0]?.load === e ? 'The load address: no BASIC SYS was found.' : 'Found by the analysis.', basic: null };
}

/** a run of the block map: blocks of one type group side by side, `gap` before it when the bytes before are not loaded */
export interface MapRun { start: Addr; end: Addr; group: TypeGroup; blocks: number; gap: boolean }

/** The blocks as one bar: the blocks of a type group next to each other make one run (a big program has thousands of
 *  blocks), and a run starts with a gap where loaded bytes do not go on. */
export function blockMap(blocks: readonly Block[]): MapRun[] {
  const out: MapRun[] = [];
  for (const b of [...blocks].sort((x, y) => x.start - y.start)) {
    const g = kindInfo(b.type).group, last = out[out.length - 1];
    if (last && last.group === g && last.end === b.start) { last.end = b.end; last.blocks++; continue; }
    out.push({ start: b.start, end: b.end, group: g, blocks: 1, gap: !!last && last.end !== b.start });
  }
  return out;
}

/** a type of block: its folder in the Blocks view, the bytes of its blocks, its first block */
export interface TypeRow extends BlockFolder { bytes: number; first: Block }

export function typeRows(blocks: readonly Block[]): TypeRow[] {
  return blockFolders(blocks).map(f => ({ ...f, bytes: f.blocks.reduce((n, b) => n + b.end - b.start, 0), first: f.blocks[0] }));
}

export { GFX_KIND } from './blockfolders';

/** the routines (JSR targets) and the interrupt handlers (IRQ, NMI, BRK) the code was traced from */
export function routinesOf(A: AnalysisResult): { subs: number; handlers: number } {
  let subs = 0, handlers = 0;
  for (const k of A.entryKind.values()) { if (k === 'sub') subs++; else if (k === 'irq' || k === 'nmi' || k === 'brk') handlers++; }
  return { subs, handlers };
}

/** the problems by level, as the Problems tab lists them */
export function problemCounts(items: readonly UiProblem[]): { err: number; warn: number; hint: number } {
  const n = { err: 0, warn: 0, hint: 0 };
  for (const p of items) if (p.lvl === 'err' || p.lvl === 'warn' || p.lvl === 'hint') n[p.lvl]++;
  return n;
}

/** "1 thing", "2 things" */
export const count = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;
