/* Pictures in the Assembler's editor (spec 10.7): the .byte lines of a block marked as sprites, a charset or a bitmap
 * (`// @block sprite` … `// @end`) drawn as they look, as the re-assembler's listing draws such a block when Settings →
 * General → Show graphics as pictures is on (lib/gfxlines). The text stays what it is: the lines a picture stands for
 * are hidden in the editor (the picture is a view zone above them) while the caret is not on one of them; put there (a
 * double-click on the picture, a jump to a label in it, a search), they are shown under the picture to be edited.
 *
 * Which lines a picture takes in, by the check (each byte's file and line): the lines in the block that write its bytes
 * one after another, with the comment lines and empty lines between them, and a sprite's label where a sprite starts
 * (written under it, as the listing does). Any other line breaks the picture there and stays: a label of a charset or a
 * bitmap, `* =`, `.align`. A line that writes a file's bytes or many at once (`.import binary`, `.binary`, `.fill`)
 * stays too, with the picture of its bytes under it. Pure, so the tests share it. */
import { codeOfLine, splitLabel, withoutComment, type Addr, type AsmBlockMark, type AsmCheck, type BlockKind, type GfxLine, type ScriptLang } from '@mimir/core';
import { GFX_GEOMETRY, gfxGridRows, gfxSpans, SPRITE_CAPTION, type GfxKind } from './gfxlines';

/** the picture a marked block's kind is drawn as */
const KIND: Partial<Record<BlockKind, GfxKind>> = { sprite: 'sprite', charset: 'chars', bitmap: 'bitmap' };
/** the bytes of a bitmap's picture (what is after them is no part of it) */
const BITMAP_BYTES = 8000;
/** a line whose bytes are a file's or many at once: it stays, its picture under it */
const WHOLE = /^\.(?:import|binary|incbin|binclude|fill|fillword)\b/i;

export interface AsmPicture {
  /** the lines it stands for, hidden while the caret is not on one (1-based, `to` included); none (`from` > `to`): the
   *  line it is under writes its bytes (an imported file, a .fill), and stays */
  from: number; to: number;
  /** the line it is drawn under (0: before the file's first) */
  after: number;
  kind: GfxKind;
  /** its rows of items, as the listing's picture lines are (lib/gfxlines: drawGfxLine, gfxItemAt …) */
  rows: GfxLine[];
  /** the lines that write its bytes, each by the address of its first byte (in order) */
  lines: { a: Addr; line: number }[];
  /** the line of its block's @block */
  mark: number;
}

/** the gap above, below and between a picture's rows, in pixels */
export const ASM_PICTURE_PAD = 6;
export const ASM_PICTURE_GAP = 4;

/** how high a picture's row is drawn, in pixels (a sprite's with its address or label under it) */
export const asmRowHeight = (l: GfxLine): number => gfxGridRows(l) * GFX_GEOMETRY[l.kind].h * GFX_GEOMETRY[l.kind].scale + (l.kind === 'sprite' ? SPRITE_CAPTION : 0);
/** how high a picture is, in pixels: its view zone */
export const asmPictureHeight = (p: AsmPicture): number =>
  ASM_PICTURE_PAD * 2 + p.rows.reduce((h, l) => h + asmRowHeight(l), 0) + ASM_PICTURE_GAP * Math.max(0, p.rows.length - 1);

/** the line that writes byte `a` of a picture (the last line that starts at or before it) */
export function asmPictureLine(p: AsmPicture, a: Addr): number {
  let line = p.lines[0]?.line ?? p.from;
  for (const x of p.lines) { if (x.a > a) break; line = x.line; }
  return line;
}

/** the lines the caret is on keep their text: the pictures whose lines are hidden, as Monaco's ranges */
export function asmHiddenRanges(pictures: readonly AsmPicture[], caretLines: readonly number[]): { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number }[] {
  return pictures.filter(p => p.from <= p.to && !caretLines.some(n => n >= p.from && n <= p.to)).map(p => ({ startLineNumber: p.from, startColumn: 1, endLineNumber: p.to, endColumn: 1 }));
}

export interface AsmPictureOptions {
  /** whether the block of mark `m` (bytes `start`..`end`) is drawn multicolour; by default as its mark says */
  mc?: (m: AsmBlockMark, start: Addr, end: Addr) => boolean;
  /** how many characters and sprites a row (gfxColsFor; GFX_GEOMETRY by default) */
  cols?: Partial<Record<GfxKind, number>>;
}

/**
 * The pictures of the blocks of sprites, charsets and bitmaps marked in `file` (its `text` as checked by `c`): for each
 * run of its lines that writes the block's bytes one after another, the lines it stands for, the line it goes under and
 * its rows (see the top of this file).
 */
export function asmPictures(c: Pick<AsmCheck, 'files' | 'fileOf' | 'asm'>, file: string, text: string, marks: readonly AsmBlockMark[], lang: ScriptLang, o: AsmPictureOptions = {}): AsmPicture[] {
  const fi = c.files.indexOf(file) + 1, ms = marks.filter(m => m.file === file && KIND[m.kind]);
  if (!fi || !ms.length) return [];
  const texts = text.split(/\r?\n/);
  // the bytes each line in a block writes: its lowest and highest address and how many
  const inMark = new Uint8Array(texts.length + 2);
  for (const m of ms) for (let n = m.line + 1; n < m.end && n <= texts.length; n++) inMark[n] = 1;
  const spans = new Map<number, { lo: Addr; hi: Addr; n: number }>();
  const { written, lines } = c.asm;
  for (let a = 0; a < 0x10000; a++) {
    const n = lines[a];
    if (c.fileOf[a] !== fi || !written[a] || !n || !inMark[n]) continue;
    const s = spans.get(n);
    if (!s) spans.set(n, { lo: a, hi: a, n: 1 }); else { s.hi = a; s.n++; }
  }
  const out: AsmPicture[] = [];
  for (const m of ms) {
    const kind = KIND[m.kind]!, unit = GFX_GEOMETRY[kind].unit;
    let start = Infinity, end = -1;
    for (let n = m.line + 1; n < m.end; n++) { const s = spans.get(n); if (s) { start = Math.min(start, s.lo); end = Math.max(end, s.hi + 1); } }
    if (end < 0) continue;
    const mc = o.mc ? o.mc(m, start, end) : m.props.mc ?? false;
    const cols = kind === 'bitmap' ? 40 : o.cols?.[kind] ?? GFX_GEOMETRY[kind].cols;
    const limit = kind === 'bitmap' ? start + BITMAP_BYTES : Infinity;
    const spriteAt = (a: Addr) => kind === 'sprite' && (a - start) % unit === 0;
    /** the run being gathered: its lines, its bytes, the labels of its sprites; `held`: sprite labels after its last
     *  line, which are in it once a line of bytes comes after them */
    let run: { from: number; to: number; s: Addr; e: Addr; lines: { a: Addr; line: number }[]; names: { a: Addr; name: string }[] } | null = null;
    let held: string[] = [];
    /** the labels on lines kept right before the next run (with only comments between): its first sprite's name */
    let before: string[] = [];
    const make = (from: number, to: number, after: number, s: Addr, e: Addr, ls: { a: Addr; line: number }[], names: { a: Addr; name: string }[]) => {
      const rows = gfxSpans(kind, start, s, e, cols).map(({ s: a, e: b, col }): GfxLine => {
        const own = names.filter(x => x.a >= a && x.a < b);
        return { k: 'gfx', a, n: b - a, kind, unit, col, cols, rows: 1, blk: start, mc, ...(own.length ? { names: own } : {}) };
      });
      out.push({ from, to, after, kind, rows, lines: ls, mark: m.line });
    };
    const flush = () => {
      const r = run; run = null;
      // (the sprite labels after its last line stay lines: they name the next one's first sprite)
      if (r) { make(r.from, r.to, r.from - 1, r.s, r.e, r.lines, r.names); before = held; }
      held = [];
    };
    const nameOf = (label: string | undefined) => (label && /^[A-Za-z_]/.test(label) ? label : null);
    for (let n = m.line + 1; n < m.end && n <= texts.length; n++) {
      const t = texts[n - 1], code = codeOfLine(t, lang), label = splitLabel(withoutComment(t, lang), lang).label, s = spans.get(n);
      if (s) {
        // (bytes not one after another, or past a bitmap's picture: no part of it)
        if (s.n !== s.hi - s.lo + 1 || s.hi >= limit) { flush(); before = []; continue; }
        const name = nameOf(label);
        if (WHOLE.test(code)) {
          // a file's bytes: the line stays, its picture under it
          flush();
          const nm = name ?? before[before.length - 1];
          make(n + 1, n, n, s.lo, s.hi + 1, [{ a: s.lo, line: n }], spriteAt(s.lo) && nm ? [{ a: s.lo, name: nm }] : []);
          before = [];
          continue;
        }
        if (run && run.e !== s.lo) flush();
        if (!run) {
          run = { from: n, to: n, s: s.lo, e: s.lo, lines: [], names: [] };
          if (spriteAt(s.lo) && before.length) run.names.push({ a: s.lo, name: before[before.length - 1] });
          before = [];
        }
        // the sprite labels kept for it, and its own (`sprite1: .byte …`)
        if (spriteAt(s.lo)) for (const x of [...held, ...(name ? [name] : [])]) run.names = [...run.names.filter(y => y.a !== s.lo), { a: s.lo, name: x }];
        held = [];
        run.to = n; run.e = s.hi + 1; run.lines.push({ a: s.lo, line: n });
        continue;
      }
      if (!code && !label) continue; // a comment line or an empty one: in the picture when bytes come after it
      if (!code && label) {
        // a sprite's label where a sprite starts: under it, in the picture; else the label breaks it and stays
        // (a local one, `!:`, names nothing)
        if (run && spriteAt(run.e)) { const x = nameOf(label); if (x) held.push(x); continue; }
        if (!run) { const x = nameOf(label); before = x ? [...before, x] : []; continue; }
        flush();
        const x = nameOf(label); before = x ? [x] : [];
        continue;
      }
      // anything else (`* =`, `.align`, a definition) breaks the picture and stays
      flush(); before = [];
    }
    flush();
  }
  return out.sort((a, b) => a.after - b.after || a.from - b.from);
}
