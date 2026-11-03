/* The mode switch over the Graphics and Memory tabs: the mode the view is in stands out (filled with the accent), each
 * with its icon or monitor command and what one cell is, and a line beside it says what the view shows now. With a
 * cartridge, the bank they show is picked beside it. */
import { useRef, type ReactNode } from 'react';
import { Icon, type IconName } from '../lib/icons';
import { cx } from '../lib/util';

export interface ViewMode<K extends string> {
  key: K;
  label: string;
  /** the accessible name, when it is not the label */
  name?: string;
  icon?: IconName;
  /** a short code shown as a key (the VICE monitor's m, i, ii) */
  badge?: string;
  /** what one cell is: 8×8, 24×21, … */
  sub?: string;
  title?: string;
}

/** `now`: what the view shows; `aside`: controls at the right end (going to an address) */
export function ViewModes<K extends string>({ label, modes, value, onChange, now, aside }: { label: string; modes: ViewMode<K>[]; value: K; onChange: (k: K) => void; now?: ReactNode; aside?: ReactNode }) {
  return (
    <div className="view-head">
      <div className="view-modes" role="group" aria-label={label}>
        {modes.map(m => (
          <button key={m.key} className={cx(value === m.key && 'on')} aria-pressed={value === m.key} aria-label={m.name ?? m.label} title={m.title} onClick={() => onChange(m.key)}>
            {m.icon && <Icon name={m.icon} size={15} />}
            {m.badge && <kbd className="view-badge">{m.badge}</kbd>}
            <span className="view-label">{m.label}</span>
            {m.sub && <small className="view-sub">{m.sub}</small>}
          </button>
        ))}
      </div>
      {now != null && <div className="view-now">{now}</div>}
      {aside != null && <div className="view-aside">{aside}</div>}
    </div>
  );
}

/** a bank of the cartridge in the bank switch: `on` while it is in the project (only those are analysed) */
export interface BankChoice { bank: number; text: string; title: string; on: boolean }
/** the cartridge's banks, the one shown (`all`: every bank at once), and showing another; `all`: every bank at once can
 *  be picked (more than one bank in the project) */
export interface BankPickProps { banks: BankChoice[]; value: number | 'all' | null; onChange: (bank: number | 'all') => void; all?: boolean }

/** The bank of a cartridge the Graphics and Memory tabs show (spec 13.9b): the list, or the arrows and the mouse wheel
 *  over it, step from bank to bank; *All banks*, first, shows them all, one after the other. It is All banks in one .asm,
 *  so only a pick in the list changes it, not the arrows or the wheel. The banks out of the project are in the list but
 *  greyed out: + in the Explorer adds them. */
export function BankPick({ banks, value, onChange, all }: BankPickProps) {
  const on = banks.filter(b => b.on), at = value === 'all' ? -1 : on.findIndex(b => b.bank === value);
  const step = (d: number) => { if (at < 0) return; const b = on[Math.max(0, Math.min(on.length - 1, at + d))]; if (b && b.bank !== value) onChange(b.bank); };
  /** a wheel step at most every 60 ms, so a touchpad does not race through the banks */
  const lastWheel = useRef(0);
  const out = banks.length - on.length;
  return (
    <span className="gfxv-field bank-pick" title={`The cartridge bank shown here (the cursor goes along to it): its addresses are the same in every bank${out ? `. ${out} bank${out === 1 ? ' is' : 's are'} not in the project: + in the Explorer adds ${out === 1 ? 'it' : 'them'}` : ''}`}>Bank
      <select aria-label="Cartridge bank" value={value ?? ''} onChange={e => onChange(e.target.value === 'all' ? 'all' : +e.target.value)}
        onWheel={e => { const now = performance.now(); if (!e.deltaY || now - lastWheel.current < 60) return; lastWheel.current = now; step(Math.sign(e.deltaY)); }}>
        {all && <option value="all" title="Every bank one after the other, as the listing shows them. The same as All banks in one .asm in the Explorer's Cartridge section: picking it turns that on, picking one bank turns it off">All banks</option>}
        {banks.map(b => <option key={b.bank} value={b.bank} disabled={!b.on} title={b.title}>{b.text}</option>)}
      </select>
      <button className="icon-btn small" aria-label="Previous bank" title="The bank before" disabled={at <= 0} onClick={() => step(-1)}><Icon name="left" size={14} /></button>
      <button className="icon-btn small" aria-label="Next bank" title="The bank after" disabled={at < 0 || at === on.length - 1} onClick={() => step(1)}><Icon name="right" size={14} /></button>
    </span>
  );
}

/** A group of settings with a small title, set apart from the next one. */
export function OptGroup({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return <div className={cx('opt-group', className)} role="group" aria-label={title}><span className="opt-title">{title}</span>{children}</div>;
}
