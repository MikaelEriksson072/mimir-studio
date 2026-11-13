/* The script debugger's panel (spec 10.3): where the run is (the script's line, or the program's code it called), the
 * 6510's registers and flags (those the last step changed are marked), the instructions from the program counter on,
 * the watch list as the run has it now (what the last step changed marked), and the stack from its top down to the
 * stack pointer, with the return addresses said. */
import { disassembleBytes, h2, h4, type Addr, type ScriptMachine, type StackEntry } from '@mimir/core';
import { cx } from '../lib/util';

/** the registers as they were before the last step, to mark what it changed */
export interface DebugRegs { pc: number; a: number; x: number; y: number; s: number; p: number }

export const regsOf = (m: ScriptMachine): DebugRegs => ({ pc: m.cpu.pc, a: m.cpu.a, x: m.cpu.x, y: m.cpu.y, s: m.cpu.s, p: m.cpu.p });

const $2 = (v: number) => '$' + h2(v), $4 = (v: number) => '$' + h4(v);
const FLAGS: [string, number, string][] = [['N', 0x80, 'negative'], ['V', 0x40, 'overflow'], ['-', 0x20, 'always set'], ['B', 0x10, 'break'], ['D', 0x08, 'decimal mode'], ['I', 0x04, 'interrupts off'], ['Z', 0x02, 'zero'], ['C', 0x01, 'carry']];

/** an address by its name (the program's, the hardware's, the script's own labels are lines), else $xxxx */
const named = (a: Addr, names: ReadonlyMap<Addr, string>) => names.get(a) ?? $4(a);

/** Where the run is, in words: the script's line, or the program's code with the line of the script that called it. */
export function whereText(m: ScriptMachine, names: ReadonlyMap<Addr, string>): string {
  const pc = m.cpu.pc, line = m.lineAt();
  if (m.inScript) return line ? `Line ${line} ($${h4(pc)})` : `The script's memory at ${$4(pc)}`;
  const call = m.callLine();
  return `In the program at ${named(pc, names)}${names.has(pc) ? ` (${$4(pc)})` : ''}${call ? `, called from line ${call}` : ''}`;
}

function StackRow({ e, top, names, lineAt }: { e: StackEntry; top: boolean; names: ReadonlyMap<Addr, string>; lineAt: (a: Addr) => number | null }) {
  let note = '';
  if (e.ret) {
    if (e.ret.by === 'start') note = 'the end of the run (the return of its SYS)';
    else {
      const line = e.ret.by === 'script' ? lineAt(e.ret.to) : null;
      note = `return to ${line ? `line ${line} (${$4(e.ret.to)})` : named(e.ret.to, names)}, from ${e.ret.by === 'script' ? 'the script' : 'the program'}`;
    }
  }
  return (
    <tr className={cx(top && 'top', (e.ret || e.low) && 'ret')}>
      <td className="mono">{$4(e.addr)}</td>
      <td className="mono">{h2(e.value)}</td>
      <td className="dbg-note">{e.ret ? <>↩ {note}</> : e.low ? '' : 'pushed'}{top && <span className="dbg-sp">← S</span>}</td>
    </tr>
  );
}

export function DebugPanel({ m, prev, names: program, busy, atBp = null, watch = null }: { m: ScriptMachine; prev: DebugRegs | null; names: ReadonlyMap<Addr, string>; busy: boolean; atBp?: number | null; watch?: React.ReactNode }) {
  const r = regsOf(m);
  // the script's code names its own addresses by its own labels, the program's code by the program's names
  const names = m.inScript && m.check.labels.size ? new Map([...program, ...m.check.labels]) : program;
  const chg = (k: keyof DebugRegs) => !!prev && prev[k] !== r[k];
  const reg = (k: 'a' | 'x' | 'y', label: string) => (
    <tr className={cx(chg(k) && 'chg')}><th>{label}</th><td className="mono">{$2(r[k])}</td><td className="mono dim">{r[k]}</td><td className="mono dim">%{r[k].toString(2).padStart(8, '0')}</td></tr>
  );
  const bytes = Array.from({ length: 24 }, (_, i) => m.peek(r.pc + i));
  const next = disassembleBytes(bytes, r.pc, names).slice(0, 4);
  const stack = m.stack();
  const lineAt = (a: Addr) => m.lineAt(a);
  return (
    <aside className="scr-debug" aria-label="Debugger">
      <div className="dbg-where" role="status">{busy ? 'Running…' : whereText(m, names)}</div>
      {!busy && atBp != null && <div className="dbg-bp" role="note"><span className="dbg-bp-dot" />Stopped at the breakpoint on line {atBp}</div>}
      <div className="dbg-count muted small">{m.instructions.toLocaleString('en-US')} instruction{m.instructions === 1 ? '' : 's'} · {m.cycles.toLocaleString('en-US')} cycles</div>
      <table className="dbg-regs" aria-label="Registers">
        <tbody>
          <tr className={cx(chg('pc') && 'chg')}><th>PC</th><td className="mono" colSpan={3}>{$4(r.pc)}{names.has(r.pc) ? <span className="dim"> {names.get(r.pc)}</span> : null}</td></tr>
          {reg('a', 'A')}{reg('x', 'X')}{reg('y', 'Y')}
          <tr className={cx(chg('s') && 'chg')}><th>S</th><td className="mono">{$2(r.s)}</td><td className="mono dim" colSpan={2}>{r.s === 0xff ? 'the stack is empty' : `the stack: ${$4(0x101 + r.s)}–$01ff`}</td></tr>
          <tr className={cx(chg('p') && 'chg')}><th>P</th><td className="mono">{$2(r.p)}</td><td colSpan={2} className="dbg-flags" aria-label="Flags">
            {FLAGS.map(([f, bit, what]) => <span key={f} className={cx('dbg-flag', (r.p & bit) !== 0 && 'on', !!prev && ((prev.p ^ r.p) & bit) !== 0 && 'chg')} title={`${f}: ${what}, ${r.p & bit ? 'set' : 'clear'}`}>{f}</span>)}
          </td></tr>
        </tbody>
      </table>
      {watch && <><h4>Watch</h4>{watch}</>}
      <h4>Stack <span className="muted small">{0xff - r.s} byte{0xff - r.s === 1 ? '' : 's'}</span></h4>
      <table className="dbg-stack" aria-label="Stack">
        <tbody>{stack.map((e, i) => <StackRow key={e.addr} e={e} top={i === stack.length - 1} names={names} lineAt={lineAt} />)}</tbody>
      </table>
      <h4>Next</h4>
      <ol className="dbg-next mono" aria-label="Next instructions">
        {next.map((l, i) => <li key={l.a} className={cx(i === 0 && 'cur')}><span className="dbg-pc">{i === 0 ? '▶' : ''}</span><span className="dim">{$4(l.a)}</span> {l.text}{m.inScript && m.lineAt(l.a) ? <span className="dim"> · line {m.lineAt(l.a)}</span> : null}</li>)}
      </ol>
    </aside>
  );
}
