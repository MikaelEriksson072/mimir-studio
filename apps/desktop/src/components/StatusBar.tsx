/* The status bar: the machine, the files, the cursor and its block, the memory configuration, the analysis and the
 * round-trip. Its items do what they show: the files open the Explorer's Files, the cursor Go to, the analysis time the
 * Analysis log, the messages their tab, the round-trip Verify and the assembler the toolchain settings. */
import type { ReactNode } from 'react';
import { ALL_PORTS, describePorts, h4, kindInfo, portName, portsOf, type Addr, type AnalysisResult, type Block } from '@mimir/core';
import { Icon } from '../lib/icons';
import { cx, fmtBytes } from '../lib/util';
import type { Sel } from '../lib/types';

/** what the status bar's items do when clicked */
export interface StatusActions {
  onFiles: () => void; onGoto: () => void; onLog: () => void; onMessages: () => void; onVerify: () => void; onSettings: () => void;
}

interface StatusBarProps {
  A: AnalysisResult; fileCount: number; cursor: Addr | null; curLabel: string | null; blk: Block | null; sel: Sel | null;
  renderMs: number; busy: boolean;
  /** the deep analysis is still running (the normal one is shown meanwhile) */
  deepBusy?: boolean;
  verify: { ok: boolean; kick: boolean | null } | null;
  /** cycle counting on: the cycles of the counted range on its path */
  cycles?: number | null;
  /** the cartridge bank the cursor is in (13.9b); null without banks */
  bank?: number | null;
  /** the toasts of this run (the Messages tab), and the errors among them */
  messages: { count: number; errors: number };
  actions: StatusActions;
}

/** an item that does something: a button that looks like the others */
const Item = ({ onClick, title, className, children }: { onClick: () => void; title: string; className?: string; children: ReactNode }) =>
  <button type="button" className={cx('sb-item sb-btn', className)} title={title} onClick={onClick}>{children}</button>;

export function StatusBar({ A, fileCount, cursor, curLabel, blk, sel, renderMs, busy, deepBusy, verify, cycles, bank, messages, actions }: StatusBarProps) {
  // the memory configuration the instruction at the cursor runs with
  const port = cursor != null && A.mcfg ? A.mcfg.port[A.codeOwner[cursor] >= 0 ? A.codeOwner[cursor] : cursor] : 0;
  return (
    <footer className="statusbar">
      <span className="sb-item"><Icon name="chip" size={13} />6510 · PAL</span>
      <Item className="hide-narrow" title="Show the files in the Explorer" onClick={actions.onFiles}>{fileCount} file{fileCount === 1 ? '' : 's'} · {fmtBytes(A.stats.total)}</Item>
      {cursor != null && <Item className="mono" title="Go to an address, label or range (G)" onClick={actions.onGoto}>{bank != null ? `bank ${bank} · ` : ''}${h4(cursor)}{curLabel ? ` · ${curLabel}` : ''}{blk ? ` · ${kindInfo(blk.type).label}` : ''}</Item>}
      {port > 0 && <span className="sb-item mono hide-narrow" title={`Memory configuration here: ${describePorts(port, (A.spaces?.find(s => cursor != null && s.space === Math.floor(cursor / 0x10000))?.cart) ?? A.mcfg?.cart)}`}>$01 {port === ALL_PORTS ? '?' : portsOf(port).map(portName).join('/')}</span>}
      {sel && sel.multi && <span className="sb-item mono hide-narrow">sel ${h4(sel.start)}–${h4(sel.end - 1)} ({sel.end - sel.start} B)</span>}
      {cycles != null && <span className="sb-item mono" title="Cycles of the selection (or the code block at the cursor) on the path in the Cycles section">{cycles} cycles</span>}
      <span className="grow" />
      {messages.count > 0 && <Item className={cx('hide-narrow', messages.errors > 0 && 'sb-err')} title={`Show the messages of this run (${messages.count}${messages.errors ? `, ${messages.errors} error${messages.errors === 1 ? '' : 's'}` : ''}) in the Messages tab`} onClick={actions.onMessages}>
        <Icon name={messages.errors ? 'err' : 'info'} size={12} />{messages.count}</Item>}
      <Item className="hide-narrow" title="Show the Analysis log" onClick={actions.onLog}>{busy ? 'analysing…' : `analysis ${A.stats.ms.toFixed(1)} ms · render ${renderMs.toFixed(1)} ms (worker)${deepBusy ? ' · deep analysis…' : ''}`}</Item>
      <Item className={cx(verify && (verify.ok ? 'ok' : 'bad'))} title="Verify the round-trip: assemble the source and compare it with the files (F7)" onClick={actions.onVerify}>
        {verify ? (verify.ok ? `✓ round-trip verified${verify.kick ? ' with KickAss.jar' : ''}` : '✗ round-trip failed') : 'round-trip not verified'}
      </Item>
      <Item className="hide-narrow" title="Settings: the toolchain (Java, KickAss.jar, VICE)" onClick={actions.onSettings}>Kick Assembler 5.x</Item>
    </footer>
  );
}
