/* Which comment a listing line shows, for DEL with the pointer resting on it (spec 10): the user's own comments are
 * removed, the analysis's own stay. */
import type { Addr, ListingLine } from '@mimir/core';

/** A comment in the listing: `eol` the user's comments at the end of a line (Project.comments at `addrs`: one, or the
 *  .byte rows a picture stands for; `zp`: a zero-page variable's, on its `.label` line); `note` the user's comment line
 *  or block above an address (Project.notes; `zp`: above a zero-page variable's `.label` line); `block` the comment the
 *  user gave the block starting at `addr` (Project.blockComments, the inspector's Comment); `analysis` one the
 *  analysis writes (what a register is, self-modified by, a loader's mark, the file head), which is not removed. */
export type CommentRef =
  | { kind: 'eol'; addrs: Addr[]; zp?: boolean }
  | { kind: 'note'; addr: Addr; zp?: boolean }
  | { kind: 'block'; addr: Addr }
  | { kind: 'analysis'; line: boolean };

/** The comment of line `l` the pointer is on: `eol`, the comment at the end of the line (its `.cmt` text); else the
 *  line itself, when it is a comment line. Null: no comment there. */
export function commentOf(l: ListingLine, eol: boolean): CommentRef | null {
  if (!eol) {
    if (l.k !== 'cmt') return null;
    if (l.note) return { kind: 'note', addr: l.zp ?? l.a, ...(l.zp != null ? { zp: true } : {}) };
    if (l.blockCmt) return { kind: 'block', addr: l.a };
    return { kind: 'analysis', line: true };
  }
  if (l.k === 'gfx') return l.cmt && l.cmtAt?.length ? { kind: 'eol', addrs: l.cmtAt } : null;
  if (l.k !== 'ins' && l.k !== 'dat' && l.k !== 'dir') return null;
  if (!l.cmt) return null;
  if (!l.userCmt) return { kind: 'analysis', line: false };
  return l.k === 'dir' && l.zp != null ? { kind: 'eol', addrs: [l.zp], zp: true } : { kind: 'eol', addrs: [l.a] };
}
