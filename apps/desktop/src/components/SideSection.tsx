/* A section of the side panel (the Explorer's, the Pack view's): a card whose title opens it and folds it up. Every
 * section is closed when the app starts; the user's choice is kept for the rest of the run. */
import type { ReactNode } from 'react';
import { Icon } from '../lib/icons';
import { cx } from '../lib/util';
import { useUi } from '../store/ui';

/** A section of the side panel: its title opens it or folds it up, `summary` says what it holds, `actions` sit at the right. */
export function SideSection({ id, title, summary, actions, className, children }: { id: string; title: string; summary?: ReactNode; actions?: ReactNode; className?: string; children: ReactNode }) {
  const open = useUi(s => s.sideOpen.includes(id)), setUi = useUi(s => s.set);
  const toggle = () => { const now = useUi.getState().sideOpen; setUi({ sideOpen: open ? now.filter(x => x !== id) : [...now, id] }); };
  return (
    <section className={cx('side-sec', !open && 'closed', className)} aria-label={title}>
      <div className="sec-head">
        <button className="sec-toggle" aria-expanded={open} title={open ? `Fold ${title.toLowerCase()} up` : `Show ${title.toLowerCase()}`} onClick={toggle}>
          <Icon name="down" size={13} /><span>{title}</span>
        </button>
        {summary != null && <span className="sec-sum">{summary}</span>}
        {actions}
      </div>
      {open && <div className="sec-body">{children}</div>}
    </section>
  );
}
