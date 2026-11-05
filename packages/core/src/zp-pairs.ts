/* The user's 16-bit zero-page variables (Project.zpPairs): two bytes the code uses as one value, low byte first */
import type { Addr, ZpVar } from './types';
import { h2 } from './util/hex';

/** whether `$a` and `$a+1` can be one 16-bit variable: both in the zero page, and neither the 6510's port ($00/$01) */
export const zpPairable = (a: Addr): boolean => Number.isInteger(a) && a >= 2 && a < 0xff;

/**
 * The zero-page variables `zp` with the user's pairs applied (in place). `true` at `a`: `$a` is the low byte and `$a+1`
 * the high byte of one variable, which the source writes `name` and `name+1`; `false`: they are two variables, also
 * where the analysis takes them for a pointer. A byte the user puts in a pair leaves the one the analysis put it in,
 * and a pair the user set earlier (a lower address) keeps its bytes. `ok`: the byte is a variable (not loaded).
 */
export function applyZpPairs(zp: Map<Addr, ZpVar>, pairs: Record<Addr, boolean> | undefined, ok: (a: Addr) => boolean = () => true): void {
  if (!pairs) return;
  // a pointer's high byte by itself: it had no name of its own (a name the user gave it already split the pair)
  const alone = (a: Addr) => { if (zp.get(a)?.off) zp.set(a, { name: `zp_${h2(a)}` }); };
  const taken = new Set<Addr>();
  for (const [a, on] of Object.entries(pairs).map(([k, v]) => [+k, v] as const).sort((x, y) => x[0] - y[0])) {
    if (!zpPairable(a) || !ok(a) || !ok(a + 1)) continue;
    if (!on) {
      if (!taken.has(a + 1)) alone(a + 1);
      continue;
    }
    if (taken.has(a)) continue;
    alone(a);
    // `$a+1` was the low byte of the pair `$a+1`/`$a+2`: that high byte is by itself now
    alone(a + 2);
    const base = zp.get(a) ?? { name: `zp_${h2(a)}` };
    zp.set(a, { ...base, ptr: true });
    zp.set(a + 1, { name: base.name, ptr: true, off: 1 });
    taken.add(a).add(a + 1);
  }
}
