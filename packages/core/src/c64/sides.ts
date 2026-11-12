/* =====================================================================
 * A release's other disks or sides, by their file names: a demo on two sides or more asks for the next one ("PLEASE
 * TURN DISK...", "INSERT DISKSIDE 2"), and Sindri turns to it when it is given. The images of one release lie side by
 * side with names that differ only in their side mark: Mathematical_SideA / _SideB, camelot_tower_power_final-A / -B,
 * EdgeOfDisgrace_0 / _1a / _1b, image1 ... image4, MementoMori-GP-Disk1 / Disk2. Another version of the release in the
 * same folder differs in more than that (e2ira_A against e2ira_101_B; Void [Side 2] against Void [Coma + Resource]
 * (side 1)), and is left out.
 * ===================================================================== */

const IMAGE = /\.(d64|g64)$/i;

/** a side mark: a number with a letter after it or not (1, 2, 12, 1a), or a letter alone (A, b) */
const MARK = /^(\d{1,2})?([a-z])?$/i;

interface Mark { num: number; letter: number }

/** The side marks where two names differ, or null when they differ in anything else. */
function marks(a: string, b: string): [Mark, Mark] | null {
  let p = 0;
  while (p < a.length && p < b.length && a[p].toLowerCase() === b[p].toLowerCase()) p++;
  let q = 0;
  while (q < a.length - p && q < b.length - p && a[a.length - 1 - q].toLowerCase() === b[b.length - 1 - q].toLowerCase()) q++;
  // a number stays whole: digits the two share at the ends of the difference belong to it (image1 / image10)
  const digit = (c: string | undefined) => c !== undefined && c >= '0' && c <= '9';
  while (p > 0 && digit(a[p - 1])) p--;
  while (q > 0 && (digit(a[a.length - q]) && (digit(a[a.length - q - 1]) || digit(b[b.length - q - 1])))) q--;
  const ma = a.slice(p, a.length - q), mb = b.slice(p, b.length - q);
  const ra = MARK.exec(ma), rb = MARK.exec(mb);
  if (!ma || !mb || !ra || !rb) return null;
  // a letter alone is a mark only where a word ends: after a separator, a number or "side"/"disk" (SideA, -b, _A)
  const before = a.slice(0, p), after = a.slice(a.length - q);
  const letterOnly = (r: RegExpExecArray) => !r[1] && !!r[2];
  if ((letterOnly(ra) || letterOnly(rb)) && !/(^|[^a-z]|side|disk|disc)$/i.test(before)) return null;
  if (/^[a-z]/i.test(after) && (ra[2] || rb[2])) return null;
  const mark = (r: RegExpExecArray): Mark => ({ num: r[1] ? Number(r[1]) : -1, letter: r[2] ? r[2].toLowerCase().charCodeAt(0) : -1 });
  return [mark(ra), mark(rb)];
}

const order = (a: Mark, b: Mark) => a.num - b.num || a.letter - b.letter;

/**
 * The disk images in `names` (file names in the folder of `name`) that come after `name` in its release, in order:
 * the ones Sindri turns to when the program asks for another side. Names that are not D64 or G64 images, `name`
 * itself, the sides before it and those of another version are left out.
 */
export function nextSides(name: string, names: readonly string[]): string[] {
  if (!IMAGE.test(name)) return [];
  const stem = name.replace(IMAGE, '');
  const found: { name: string; mark: Mark }[] = [];
  for (const other of names) {
    if (!IMAGE.test(other) || other.toLowerCase() === name.toLowerCase()) continue;
    const m = marks(stem, other.replace(IMAGE, ''));
    if (m && order(m[1], m[0]) > 0) found.push({ name: other, mark: m[1] });
  }
  return found.sort((a, b) => order(a.mark, b.mark)).slice(0, 8).map(f => f.name);
}
