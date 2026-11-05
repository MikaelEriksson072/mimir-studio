import { cx } from './util';
import { ICONS, type IconName } from './icon-paths';

export type { IconName };

export function Icon({ name, size = 16, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg className={cx('icon', className)} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICONS[name]} />
    </svg>
  );
}

export const LVL_ICON: Record<string, IconName> = { info: 'info', ok: 'ok', warn: 'warn', err: 'err', hint: 'hint' };
