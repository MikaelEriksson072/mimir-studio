/* What a user script's Init fields read (spec 10.3): the numbers and names typed for a register or a zero-page byte. */

/**
 * A number as typed in Init: `$fb`, `%1010`, `251`, a name of the program or the script (a label, a zero-page variable,
 * a scratchpad), `name+2` / `name-1`, and `<name` / `>name` for the low and the high byte of one. null: not a number
 * of $0000-$ffff.
 */
export function initValue(text: string, names: ReadonlyMap<string, number>): number | null {
  let s = text.trim();
  if (!s) return null;
  const part = s[0] === '<' || s[0] === '>' ? s[0] : null;
  if (part) s = s.slice(1).trim();
  const one = (u: string): number | null => /^\$[0-9a-f]+$/i.test(u) ? parseInt(u.slice(1), 16) : /^%[01]+$/.test(u) ? parseInt(u.slice(1), 2) : /^[0-9]+$/.test(u) ? parseInt(u, 10) : names.get(u) ?? null;
  const m = /^(.+?)\s*([+-])\s*(\$[0-9a-f]+|%[01]+|[0-9]+)$/i.exec(s);
  let v = one(m ? m[1] : s);
  if (v == null) return null;
  if (m) v = m[2] === '+' ? v + one(m[3])! : v - one(m[3])!;
  if (part) v = part === '<' ? v & 0xff : (v >> 8) & 0xff;
  return v >= 0 && v <= 0xffff ? v : null;
}
