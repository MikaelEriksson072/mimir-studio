import type { Addr } from '../types';
import { OPC, type OpcodeInfo } from './opcodes';

export interface Decoded {
  pc: Addr;
  info: OpcodeInfo;
  /** operand value (byte or word), null for implied/accumulator */
  v: number | null;
  /** branch/jump/memory target, null for immediates and implied */
  target: Addr | null;
}

/** `pc` may be a bank address (spec 13.9b, a merged analysis' memory): the operand is read and a branch goes in its
 *  bank, and an absolute target is in it too (where that bank lacks it, the listing's tokens tell the bank) */
export function decode(mem: Uint8Array, pc: Addr): Decoded {
  const base = pc - (pc & 0xffff);
  const info = OPC[mem[pc]];
  const b1 = mem[base + ((pc + 1) & 0xffff)], b2 = mem[base + ((pc + 2) & 0xffff)];
  const v = info.len === 2 ? b1 : info.len === 3 ? (b1 | (b2 << 8)) : null;
  let target: Addr | null = null;
  if (info.mode === 'rel') target = base + ((pc + 2 + ((b1 ^ 0x80) - 0x80)) & 0xffff);
  else if (v != null && info.mode !== 'imm') target = base + v;
  return { pc, info, v, target };
}
