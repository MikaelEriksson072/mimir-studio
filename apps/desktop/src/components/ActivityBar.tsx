import { Icon, type IconName } from '../lib/icons';
import { cx } from '../lib/util';
import type { Activity } from '../store/ui';

const ITEMS: [Activity, IconName, string][] = [['explorer', 'files', 'Explorer'], ['blocks', 'blocks', 'Blocks'], ['symbols', 'tag', 'Symbols'], ['bookmarks', 'bookmark', 'Bookmarks (Ctrl+B)'], ['scripts', 'script', 'Scripts'], ['pack', 'pack', 'Pack (Brokkr or Exomizer)'], ['library', 'library', 'Library (SIDs, sprites, charsets)'], ['codelib', 'codelib', 'Macros and code (Ctrl+Shift+M)']];
/** what a view at work is doing, in its button's tip */
const BUSY: Partial<Record<Activity, string>> = { pack: 'packing', scripts: 'a script is running' };

export function ActivityBar({ activity, specOpen, counts = {}, busy = {}, hide, labels, onActivity, onSpec, onPalette }: {
  /** views the project has not (an Assembler project's, spec 10.7) */
  hide?: readonly Activity[];
  /** views named otherwise in this kind of project (the re-assembler's code library) */
  labels?: Partial<Record<Activity, string>>;
  /** the view the side panel shows; null: the side panel is collapsed */
  activity: Activity | null; specOpen: boolean;
  /** a number shown on a view's button (the bookmarks, the scripts, the ranges to pack, what is in the library) */
  counts?: Partial<Record<Activity, number>>;
  /** views at work (Pack while it packs, Scripts while one runs): a spinner on the button instead of the number */
  busy?: Partial<Record<Activity, boolean>>;
  onActivity: (a: Activity) => void; onSpec: () => void; onPalette: () => void;
}) {
  return (
    <nav className="activity" aria-label="Views">
      {ITEMS.filter(([k]) => !hide?.includes(k)).map(([k, ic, own]) => [k, ic, labels?.[k] ?? own] as const).map(([k, ic, l]) => (
        <button key={k} className={cx(activity === k && 'on', busy[k] && 'busy')} title={busy[k] ? `${l}: ${BUSY[k] ?? 'working'}…` : activity === k ? `${l}: a click collapses the side panel (Ctrl+Shift+B)` : l} aria-label={l.replace(/ \(.*\)$/, '')} aria-pressed={activity === k} aria-busy={busy[k] || undefined} onClick={() => onActivity(k)}>
          <Icon name={ic} size={20} />{busy[k] ? <span className="act-busy spinner" aria-hidden /> : counts[k] ? <span className="act-count">{counts[k]}</span> : null}
        </button>
      ))}
      <span className="grow" />
      <button title="Technical specification" aria-label="Technical specification" className={cx(specOpen && 'on')} onClick={onSpec}><Icon name="doc" size={20} /></button>
      <button title="Command palette (Ctrl+Shift+P)" aria-label="Command palette" onClick={onPalette}><Icon name="prompt" size={20} /></button>
    </nav>
  );
}
