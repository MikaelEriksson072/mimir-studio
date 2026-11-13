/* Renaming from a listing line (spec 10): besides the line's own label (N), the label or zero-page variable its
 * operand names (Shift+N), so `lda l_3000,y` renames l_3000 without going to $3000 first. The context menu names the
 * label each of its rename items renames. */
import { h4, type Addr, type ListingLine, type RenderResult, type Token } from '@mimir/core';
import { cellParts, type Cell } from './cells';

/** a name the listing writes for an address: a label, or a zero-page variable (`zp`) */
export interface NameRef { addr: Addr; zp: boolean; name: string }

type Names = Pick<RenderResult, 'labels' | 'zp'>;

/** the label or zero-page variable a token of an operand is, written as it is (`l_3000` of `l_3000+1` too); null for
 *  hardware and music names, numbers, and a name the token does not write as the label's own */
function named(t: Token, R: Names): NameRef | null {
  if (t.t !== 'lbl' || t.to == null) return null;
  if (t.zp) {
    const z = R.zp.get(t.to);
    return z && !z.off && z.name === t.s ? { addr: t.to, zp: true, name: z.name } : null;
  }
  const l = R.labels.get(t.to);
  return l && l.name === t.s ? { addr: t.to, zp: false, name: l.name } : null;
}

/** The label (or zero-page variable) a line's operand names, to rename it from that line: an instruction's
 *  (`lda l_3000,y`, `sta ptr_fb+1`, `lda #<l_3000`); in a data line the one of the byte or word `cell` (the one clicked,
 *  or at the cursor), else the line's when it names only one. Null when the operand names none (or more than one). */
export function operandName(l: ListingLine | null | undefined, R: Names, cell?: Cell | null): NameRef | null {
  if (!l) return null;
  let tok: Token[];
  if (l.k === 'ins') tok = l.tok;
  else if (l.k === 'dat') tok = (cell && cellParts(l)?.find(p => p.cell?.a === cell.a)?.tok) || l.tok;
  else return null;
  const found: NameRef[] = [];
  for (const t of tok) {
    const n = named(t, R);
    if (n && !found.some(f => f.addr === n.addr && f.zp === n.zp)) found.push(n);
  }
  return found.length === 1 ? found[0] : null;
}

/** what a rename item of the context menu says: the name it renames (`Rename smc_0450…`), or the address a line
 *  without a label of its own gets one at (`Add label at $0453…`) */
export function renameText(n: NameRef | null, at: Addr | null | undefined): string {
  if (n) return `Rename ${n.zp ? 'zero-page variable ' : ''}${n.name}…`;
  return at != null ? `Add label at $${h4(at)}…` : 'Rename label…';
}
