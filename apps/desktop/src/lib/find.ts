/* Find in the listing (Ctrl+F): a line's text as the listing shows it, without its address and bytes. The code and the
 * comment of a line are searched apart, so a match never runs from one into the other. */
import { kickMnemonic, typeInfo, type ListingLine, type Token } from '@mimir/core';

/** `matchCase`: as written (else in any case); `word`: a whole word, not inside a longer name */
export interface FindOptions { matchCase: boolean; word: boolean }

const WORD = 'A-Za-z0-9_';

/** the text of a line the listing shows, its parts on lines of their own (no query holds a line break) */
export function findText(l: ListingLine): string {
  const toks = (t: Token[]) => t.map(x => x.s).join('');
  const cmt = (c?: string) => (c ? [`// ${c}`] : []);
  switch (l.k) {
    case 'lbl': return `${l.name}:`;
    case 'ins': return [kickMnemonic(l.mn) + (l.ext || '') + (l.tok.length ? ' ' + toks(l.tok) : ''), ...cmt(l.cmt)].join('\n');
    case 'dat': return [`${l.dir} ${toks(l.tok)}`, ...cmt(l.cmt)].join('\n');
    case 'dir': return [toks(l.tok), ...cmt(l.cmt)].join('\n');
    case 'cmt': return l.raw ? l.text : l.text ? `// ${l.text}` : '//';
    case 'hdr': return `${typeInfo(l.type).label}\n${l.text}`;
    case 'file': return l.text;
    // a picture: the labels written under its sprites, and the comments of the rows it stands for
    case 'gfx': return [...(l.names ?? []).map(x => `${x.name}:`), ...cmt(l.cmt)].join('\n');
    default: return '';
  }
}

/** what is searched for, as a global expression (its text is taken as it is, not as a pattern); null for nothing */
export function findRegExp(q: string, o: FindOptions): RegExp | null {
  if (!q) return null;
  const esc = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(o.word ? `(?<![${WORD}])${esc}(?![${WORD}])` : esc, o.matchCase ? 'g' : 'gi');
}

/** the indices of the texts with a match, in order */
export function findLines(texts: readonly string[], re: RegExp | null): number[] {
  if (!re) return [];
  const one = new RegExp(re.source, re.flags.replace('g', ''));
  const out: number[] = [];
  texts.forEach((t, i) => { if (t && one.test(t)) out.push(i); });
  return out;
}

/** The hit to go to from line `from` (an index into `hits`, -1 without hits): going down the first one on or after it
 *  (`inclusive`) or after it, going up the last one before it; past the end it starts again at the other. */
export function nextHit(hits: readonly number[], from: number, dir: 1 | -1, inclusive = false): number {
  if (!hits.length) return -1;
  // the first hit on or after `from`
  let lo = 0, hi = hits.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (hits[mid] < from) lo = mid + 1; else hi = mid; }
  if (dir < 0) return lo > 0 ? lo - 1 : hits.length - 1;
  const i = !inclusive && hits[lo] === from ? lo + 1 : lo;
  return i < hits.length ? i : 0;
}
