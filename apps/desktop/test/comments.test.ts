import { describe, expect, it } from 'vitest';
import { analyze, render, showcaseProject, type Addr, type ListingLine, type ProjectInput } from '@mimir/core';
import { commentOf, type CommentRef } from '../src/lib/comments';
import { gfxListing } from '../src/lib/gfxlines';

// the showcase (a block comment at $1800 and one at $4000, sprites at $2000 as .byte rows) with the user's comments
// added: at the end of an instruction, of a sprite's first row and of a zero-page variable's .label line, and a
// comment line and a comment block above an instruction and above the zero-page variable
const base = showcaseProject();
const R0 = render(analyze(base), base);
const ins = R0.lines.find((l): l is Extract<ListingLine, { k: 'ins' }> => l.k === 'ins' && !l.cmt)!;
const zp = R0.lines.find((l): l is Extract<ListingLine, { k: 'dir' }> => l.k === 'dir' && l.zp != null)!.zp!;
const spr = R0.lines.find(l => l.k === 'dat' && l.a >= 0x2000 && l.a < 0x2100)!.a;
const p: ProjectInput = {
  ...base,
  comments: { ...base.comments, [ins.a]: 'mine', [zp]: 'a pointer', [spr]: 'first sprite' },
  notes: { ...base.notes, [ins.a]: { text: 'above it' }, [zp]: { text: 'two\nlines', block: true } },
};
const A = analyze(p), R = render(A, p);
const G = gfxListing(R.lines, A);

/** what each line shows as a comment: its comment line, and the comment at its end */
const refs = (lines: readonly ListingLine[]) => lines.flatMap(l => [commentOf(l, false), commentOf(l, true)].filter((c): c is CommentRef => !!c).map(c => ({ l, c })));
const user = (lines: readonly ListingLine[]) => refs(lines).filter(x => x.c.kind !== 'analysis');

describe('the comment under the pointer (DEL removes it)', () => {
  it('finds the comment at the end of a line the user wrote, only on the comment', () => {
    const l = R.lines.find(x => x.k === 'ins' && x.a === ins.a)!;
    expect(commentOf(l, true)).toEqual({ kind: 'eol', addrs: [ins.a] });
    // the pointer on the instruction, not on its comment
    expect(commentOf(l, false)).toBeNull();
  });

  it('finds a comment line and every line of a comment block, with the address above which they stand', () => {
    const above = R.lines.filter(l => l.k === 'cmt' && l.note && l.a === ins.a && l.zp == null);
    expect(above.length).toBe(1);
    expect(commentOf(above[0], false)).toEqual({ kind: 'note', addr: ins.a });
    // the zero-page variable's block in the file head: /*, its two lines and */
    const block = R.lines.filter(l => l.k === 'cmt' && l.zp === zp);
    expect(block.length).toBe(4);
    for (const l of block) expect(commentOf(l, false)).toEqual({ kind: 'note', addr: zp, zp: true });
  });

  it('finds a zero-page variable\'s comment on its .label line', () => {
    const l = R.lines.find(x => x.k === 'dir' && x.zp === zp)!;
    expect(commentOf(l, true)).toEqual({ kind: 'eol', addrs: [zp], zp: true });
  });

  it('finds the block\'s comment under its header', () => {
    for (const a of [0x1800, 0x4000]) {
      const lines = R.lines.filter(l => l.k === 'cmt' && l.blockCmt && l.a === a);
      expect(lines.map(l => (l as { text: string }).text)).toEqual([base.blockComments[a]]);
      expect(commentOf(lines[0], false)).toEqual({ kind: 'block', addr: a });
    }
  });

  it('finds the comments of the .byte rows a picture stands for', () => {
    const pic = G.lines.find(l => l.k === 'gfx' && !l.pad && l.a <= spr && spr < l.a + l.n)!;
    expect(commentOf(pic, true)).toEqual({ kind: 'eol', addrs: [spr] });
    // its room under it has no comment
    expect(G.lines.filter(l => l.k === 'gfx' && l.pad).every(l => commentOf(l, true) == null)).toBe(true);
  });

  it('leaves the analysis\'s comments: a register\'s description, the file head, the sprite captions', () => {
    const hw = R.lines.find(l => l.k === 'ins' && l.cmt && !l.userCmt)!;
    expect(commentOf(hw, true)).toEqual({ kind: 'analysis', line: false });
    const head = R.lines.find(l => l.k === 'cmt' && l.head === 'title')!;
    expect(commentOf(head, false)).toEqual({ kind: 'analysis', line: true });
    const caption = R.lines.find(l => l.k === 'cmt' && /^sprite \$/.test(l.text))!;
    expect(commentOf(caption, false)).toEqual({ kind: 'analysis', line: true });
  });

  it('finds every comment of the user the listing shows: removing them leaves none', () => {
    const found = [...user(R.lines), ...user(G.lines)];
    const take = { comments: new Set<Addr>(), notes: new Set<Addr>(), blocks: new Set<Addr>() };
    for (const { c } of found) {
      if (c.kind === 'eol') for (const a of c.addrs) take.comments.add(a);
      else if (c.kind === 'note') take.notes.add(c.addr);
      else if (c.kind === 'block') take.blocks.add(c.addr);
    }
    const { comments = {}, notes = {}, blockComments = {} } = p;
    const addrs = (r: object) => Object.keys(r).map(Number).sort();
    expect([...take.comments].sort()).toEqual(addrs(comments));
    expect([...take.notes].sort()).toEqual(addrs(notes));
    expect([...take.blocks].sort()).toEqual(addrs(blockComments));
    const omit = <T,>(r: Record<Addr, T>, s: Set<Addr>) => Object.fromEntries(Object.entries(r).filter(([a]) => !s.has(Number(a)))) as Record<Addr, T>;
    const q: ProjectInput = { ...p, comments: omit(comments, take.comments), notes: omit(notes, take.notes), blockComments: omit(blockComments, take.blocks) };
    const Aq = analyze(q), Rq = render(Aq, q);
    expect(user(Rq.lines)).toEqual([]);
    expect(user(gfxListing(Rq.lines, Aq).lines)).toEqual([]);
    // the analysis's own comments are all still there (one the user's comment stood in place of comes back)
    const analysis = (lines: readonly ListingLine[]) => refs(lines).length - user(lines).length;
    expect(analysis(Rq.lines)).toBeGreaterThanOrEqual(analysis(R.lines));
  });
});
