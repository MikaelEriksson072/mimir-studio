/* =====================================================================
 * C64 checks of an Assembler project's program (spec 10.7): what the assembler cannot see and the analysis can, from
 * the program as it is loaded and the VIC evidence of its code (5.9). Graphics the VIC does not see (outside the VIC
 * banks the program shows, under the character ROM, not aligned), sprite pointers that show no sprites, bytes LOAD
 * writes into the I/O registers, code under a ROM the program never banks out, and bytes over the zero page, the stack
 * and the KERNAL's work area. Each is said at its first byte; the Assembler puts it on the line that writes it.
 * ===================================================================== */
import type { Addr, AnalysisResult, BlockKind } from './types';
import { OPC } from './cpu/opcodes';
import { decode } from './cpu/decode';
import { h2, h4 } from './util/hex';

/** a check's finding at a byte (`end`: past its last, for a range) */
export interface AsmC64Note { addr: Addr; end?: Addr; level: 'warning' | 'info'; msg: string }

const GFX: Partial<Record<BlockKind, { what: string; align: number }>> = {
  sprite: { what: 'Sprites', align: 0x40 }, charset: { what: 'A charset', align: 0x800 },
  bitmap: { what: 'A bitmap', align: 0x2000 }, screen: { what: 'A screen', align: 0x400 },
};
const range = (a: Addr, e: Addr) => `$${h4(a)}-$${h4(e - 1)}`;
const bankText = (b: number) => `${b} (${range(b * 0x4000, b * 0x4000 + 0x4000)})`;

/** The C64 checks of the program the analysis `A` has (an Assembler project's: its blocks as the sources mark them). */
export function asmC64Notes(A: Pick<AnalysisResult, 'mem' | 'owner' | 'insLen' | 'blocks' | 'vic'>): AsmC64Note[] {
  const out: AsmC64Note[] = [];
  const loaded = (a: Addr) => A.owner[a & 0xffff] >= 0;
  const banks = [...A.vic.banks].sort();
  const bankList = banks.map(bankText).join(', ');

  // graphics the VIC does not see
  for (const b of A.blocks) {
    const g = GFX[b.type];
    if (!g) continue;
    const bank = b.start >> 14, where = range(b.start, b.end);
    if (!A.vic.banks.has(bank)) out.push({ addr: b.start, end: b.end, level: 'warning', msg: `${g.what} at ${where} in VIC bank ${bankText(bank)}, but the program shows bank ${bankList} ($dd00): the VIC does not see ${b.type === 'sprite' ? 'them' : 'it'} there` });
    const off = b.start & 0x3fff, offEnd = off + (b.end - b.start);
    if ((bank === 0 || bank === 2) && off < 0x2000 && offEnd > 0x1000) out.push({ addr: b.start, end: b.end, level: 'warning', msg: `${g.what} at ${where}: in VIC bank ${bank} the VIC sees the character ROM at ${range(bank * 0x4000 + 0x1000, bank * 0x4000 + 0x2000)}, not the bytes there` });
    if (b.start % g.align) out.push({ addr: b.start, end: b.end, level: 'warning', msg: `${g.what} at ${where} is not aligned: the VIC reads ${b.type === 'sprite' ? 'a sprite' : g.what.replace(/^An? /, 'a ')} from a multiple of $${g.align.toString(16)} (.align $${g.align.toString(16)})` });
  }
  // sprite pointers the code writes: what they show
  const seen = new Set<Addr>();
  for (const s of A.vic.sprites) {
    if (seen.has(s.addr)) continue;
    seen.add(s.addr);
    const at = `Sprite ${s.n}'s pointer $${h2(s.ptr)} shows $${h4(s.addr)}`;
    if (!loaded(s.addr)) out.push({ addr: s.addr, level: 'info', msg: `${at}, which the program does not load` });
    else if (!A.blocks.some(b => b.type === 'sprite' && s.addr >= b.start && s.addr < b.end)) out.push({ addr: s.addr, end: s.addr + 64, level: 'info', msg: `${at}: mark its bytes as sprites (// @block sprite) to see them as sprites in Graphics and Memory` });
  }
  // bytes LOAD writes into the I/O registers
  let io = -1, ioEnd = -1;
  for (let a = 0xd000; a < 0xe000; a++) if (loaded(a)) { if (io < 0) io = a; ioEnd = a + 1; }
  if (io >= 0) out.push({ addr: io, end: ioEnd, level: 'warning', msg: `The program's file has bytes at ${range(io, ioEnd)} (a gap between its parts is in the file too, as zeros): LOAD writes them into the VIC, the SID, colour RAM and the CIAs ($01 = $37), not into the RAM under them` });
  // code under a ROM the program never banks out
  let banksOut = false;
  for (let a = 0; a < 0x10000 && !banksOut; a++) {
    if (!A.insLen[a]) continue;
    const o = OPC[A.mem[a]];
    if ((o.access === 'write' || o.access === 'rmw') && decode(A.mem, a).target === 0x0001) banksOut = true;
  }
  if (!banksOut) for (const [lo, hi, rom] of [[0xa000, 0xc000, 'BASIC'], [0xe000, 0x10000, 'KERNAL']] as const) {
    let first = -1;
    for (let a = lo; a < hi; a++) if (A.insLen[a] && loaded(a)) { first = a; break; }
    if (first >= 0) out.push({ addr: first, level: 'warning', msg: `Code at $${h4(first)} is under the ${rom} ROM, and the program never writes $01: the CPU runs the ROM there, not this code` });
  }
  // the zero page, the stack and the KERNAL's work area
  let low = -1, lowEnd = -1;
  for (let a = 0x0002; a < 0x0400; a++) if (loaded(a)) { if (low < 0) low = a; lowEnd = a + 1; }
  if (low >= 0) out.push({ addr: low, end: lowEnd, level: 'info', msg: `The program loads into ${range(low, lowEnd)}, the zero page, the stack and the KERNAL's work area (its vectors at $0314-$0333): LOAD and RUN use them, so the program must not need what was there` });
  return out;
}
