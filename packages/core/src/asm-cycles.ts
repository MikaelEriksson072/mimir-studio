/* =====================================================================
 * Cycles in the Assembler (spec 10.7): the 6510 cycles of the instruction on each line of a source, and the code of a
 * range of lines, which cyclePath counts along one path with the branches marked as taken, as the re-assembler's
 * listing does (10.1). From the check of the program (Mimir's own assembler): what each byte is and its line.
 * ===================================================================== */
import type { Addr } from './types';
import type { AsmCheck } from './asm-project';
import { OPC } from './cpu/opcodes';
import { instructionCycles, type Cycles } from './cpu/cycles';

type Checked = Pick<AsmCheck, 'files' | 'fileOf' | 'asm'>;

/** the program as cyclePath reads code: its memory, and the length of each instruction where one starts */
export function asmCode(c: Checked): { mem: Uint8Array; insLen: Uint8Array } {
  const { mem, written, ops } = c.asm, insLen = new Uint8Array(0x10000);
  for (let a = 0; a < 0x10000; a++) if (ops[a] && written[a]) insLen[a] = OPC[mem[a]].len;
  return { mem, insLen };
}

/** The instruction each line of `file` writes (the first, when it writes more), by line: where and its cycles. */
export function asmLineCycles(c: Checked, file: string): Map<number, { addr: Addr; cycles: Cycles }> {
  const out = new Map<number, { addr: Addr; cycles: Cycles }>(), fi = c.files.indexOf(file) + 1;
  if (!fi) return out;
  const { ops, written, lines } = c.asm;
  for (let a = 0; a < 0x10000; a++) {
    if (c.fileOf[a] !== fi || !ops[a] || !written[a]) continue;
    const l = lines[a];
    if (l && !out.has(l)) out.set(l, { addr: a, cycles: instructionCycles(c.asm.mem, a) });
  }
  return out;
}

/** The code lines `from` to `to` of `file` write: from their first instruction to the end of their last; null when they
 *  write none. */
export function asmLinesRange(c: Checked, file: string, from: number, to: number): { start: Addr; end: Addr } | null {
  const fi = c.files.indexOf(file) + 1;
  if (!fi) return null;
  const { ops, written, lines, mem } = c.asm;
  let start = -1, end = -1;
  for (let a = 0; a < 0x10000; a++) {
    if (c.fileOf[a] !== fi || !ops[a] || !written[a] || lines[a] < from || lines[a] > to) continue;
    if (start < 0) start = a;
    end = Math.max(end, Math.min(0x10000, a + OPC[mem[a]].len));
  }
  return start < 0 ? null : { start, end };
}
