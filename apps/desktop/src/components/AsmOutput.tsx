/* The Assembler's output (spec 10.7), under the code as the script editor's is: Problems (what Mimir's check finds as
 * you type, and what the assembler found in the last build), Build (the last build's command and what it wrote) and
 * Last run (how the last run in Mimir's 6510 ended, its registers and what it printed). */
import { h2, h4, type Addr, type AsmCheck, type CyclePath, type ScriptRun, type VicScreen } from '@mimir/core';
import { Icon } from '../lib/icons';
import { cx, fmtBytes } from '../lib/util';
import type { AsmOutTab } from '../store/assembler';

/** a problem the assembler (KickAss.jar or 64tass) found in the last build, in a file of the folder */
export interface AsmBuildProblem { file: string; line: number; column: number; msg: string; severity: 'error' | 'warning' }
/** the last build: running, or how it went (`ok` null: it could not start) */
export interface AsmBuild {
  running: boolean;
  /** what built it (KickAss.jar, 64tass) and the main file it built */
  tool: string; main: string;
  ok: boolean | null;
  log: string;
  commands: string[][];
  problems: AsmBuildProblem[];
  ms: number;
  /** the program it wrote (its path in the folder, its bytes) */
  prg: { path: string; load: number; size: number } | null;
  /** the build was for Run: VICE started with it (`started`), or why not */
  vice?: string;
  at: number;
}
/** the cycles of the lines chosen (Cycles on): along one path with the branches marked as taken; the line and the code of
 *  an address, and a branch marked taken or not */
export interface AsmCycles {
  path: CyclePath | null;
  /** the lines chosen, in words ("main.asm lines 12-30") */
  label: string | null;
  lineOf: (a: Addr) => { file: string; line: number } | null;
  code: (a: Addr) => string;
  onToggle: (pc: Addr) => void;
}
/** a run in Mimir's 6510 that ended (Debug to its end), with how it ended in words */
export interface AsmRunKept { run: ScriptRun; text: string; ok: boolean; at: number; /** the whole C64's picture as it was stopped */ picture?: VicScreen }

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

interface AsmOutputProps {
  check: AsmCheck | null;
  build: AsmBuild | null;
  kept: AsmRunKept | null;
  tab: AsmOutTab;
  folded: boolean;
  height: number;
  onTab: (t: AsmOutTab) => void;
  onFold: (v: boolean) => void;
  onGo: (file: string, line: number) => void;
  /** the C64 screen beside the code shown (the last run's screen is there) */
  onScreen: () => void;
  /** Cycles on: the lines chosen counted (null: off, and no Cycles tab) */
  cycles: AsmCycles | null;
  /** the C64 checks: what the analysis sees in the program that the assembler cannot (at the line that writes it) */
  notes: AsmNote[];
}
/** a C64 check's finding at its line (file '': no line writes the byte) */
export interface AsmNote { file: string; line: number; level: 'warning' | 'info'; msg: string }

export function AsmOutput({ check, build, kept, tab, folded, height, onTab, onFold, onGo, onScreen, cycles, notes }: AsmOutputProps) {
  const own = check?.problems.length ?? 0, built = build?.problems.length ?? 0, warned = notes.filter(n => n.level === 'warning').length;
  const builtErrors = build?.problems.filter(p => p.severity === 'error').length ?? 0;
  const tabs: { k: AsmOutTab; label: string; tip: string; badge: React.ReactNode }[] = [
    { k: 'problems', label: 'Problems', tip: 'What Mimir\'s check finds in the sources as you type, what the assembler found in the last build, and what the C64 does with the program that the assembler cannot see',
      badge: <span className={cx('count', own || builtErrors ? 'bad' : warned ? 'warn' : '')}>{own + built + warned}</span> },
    { k: 'build', label: 'Build', tip: build ? `The last build of ${build.main} with ${build.tool}` : 'The last build: Run (Ctrl+Enter) and Build (Ctrl+Shift+B) build the main file with KickAss.jar or 64tass',
      badge: build && !build.running && <Icon name={build.ok ? 'check' : 'warn'} size={12} className={build.ok ? 'scr-tab-ok' : 'scr-tab-warn'} /> },
    { k: 'run', label: 'Last run', tip: kept ? `The last run in Mimir: ${kept.text}` : 'How the last run in Mimir\'s 6510 ended: Debug (F8), then Continue to its end',
      badge: kept && <Icon name={kept.ok ? 'check' : 'warn'} size={12} className={kept.ok ? 'scr-tab-ok' : 'scr-tab-warn'} /> },
    ...(cycles ? [{ k: 'cycles' as const, label: 'Cycles', tip: 'The 6510 cycles of the lines chosen in the editor, along one path with the branches marked as taken',
      badge: cycles.path && cycles.path.instructions > 0 && <span className="count">{cycles.path.total}</span> }] : []),
  ];
  const label = tabs.find(t => t.k === tab)?.label ?? 'Output';
  return (
    <>
      <div className="tabs small scr-out-tabs" role="tablist" aria-label="Output of the Assembler">
        {tabs.map(t => (
          <button key={t.k} role="tab" id={`asm-tab-${t.k}`} aria-selected={!folded && tab === t.k} aria-controls="asm-out" className={cx('tab', !folded && tab === t.k && 'on', folded && tab === t.k && 'last')}
            onClick={() => { onTab(t.k); onFold(false); }} title={t.tip}>{t.label}{t.badge}</button>
        ))}
        <span className="grow" />
        {build && <button className={cx('scr-run-stat', build.running ? '' : build.ok ? 'ok' : 'warn')} onClick={() => { onTab('build'); onFold(false); }} title="The last build: a click shows it">
          {build.running ? <span className="scr-busy" /> : <Icon name={build.ok ? 'check' : 'warn'} size={12} />}<span className="scr-end">{buildLine(build)}</span></button>}
        <button className="icon-btn panel-toggle" aria-label="Output" aria-expanded={!folded} aria-controls="asm-out" onClick={() => onFold(!folded)}
          title={folded ? 'Show the output: the problems, the last build and the last run' : 'Fold the output down: the code gets the room'}>
          <Icon name="down" size={14} className={folded ? 'flip' : ''} /></button>
      </div>
      {!folded && <div className={cx('scr-out', `asm-out-${tab}`)} id="asm-out" role="tabpanel" aria-labelledby={`asm-tab-${tab}`} aria-label={label} style={{ height, maxHeight: height }}>
        {tab === 'problems' && <ProblemsPane check={check} build={build} notes={notes} onGo={onGo} />}
        {tab === 'build' && <BuildPane build={build} onGo={onGo} />}
        {tab === 'run' && <RunPane kept={kept} onScreen={onScreen} />}
        {tab === 'cycles' && cycles && <CyclesPane c={cycles} onGo={onGo} />}
      </div>}
    </>
  );
}

/** the last build in a line */
export function buildLine(b: AsmBuild): string {
  if (b.running) return `Building ${b.main} with ${b.tool}…`;
  if (b.ok === null) return b.log.split('\n')[0] || 'The build could not start';
  const errors = b.problems.filter(p => p.severity === 'error').length;
  if (!b.ok) return `${b.tool}: ${errors ? plural(errors, 'error') : 'it failed'} in ${b.main}`;
  return `Built ${b.prg ? `${baseOf(b.prg.path)}, ${fmtBytes(b.prg.size)} at $${h4(b.prg.load)}` : b.main} in ${(b.ms / 1000).toFixed(1)} s${b.vice ? ` · ${b.vice}` : ''}`;
}
const baseOf = (p: string) => p.slice(Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\')) + 1);

function ProblemRow({ file, line, msg, level, onGo }: { file: string; line: number; msg: string; level: 'error' | 'warning' | 'info'; onGo: (file: string, line: number) => void }) {
  return (
    <li className={cx('asm-problem', level)}>
      <button className="asm-problem-go" disabled={!file} onClick={() => onGo(file, line)} title={file ? `Show ${file}${line ? ` at line ${line}` : ''}` : undefined}>
        <Icon name={level === 'error' ? 'err' : level === 'warning' ? 'warn' : 'info'} size={13} />
        <span className="asm-problem-at mono">{file || '—'}{line ? `:${line}` : ''}</span>
        <span className="asm-problem-msg">{msg}</span>
      </button>
    </li>
  );
}

function ProblemsPane({ check, build, notes, onGo }: { check: AsmCheck | null; build: AsmBuild | null; notes: AsmNote[]; onGo: (file: string, line: number) => void }) {
  return (
    <section className="scr-pane asm-problems" aria-label="Problems">
      <div className="scr-pane-body asm-pane-scroll">
        <h4 className="asm-out-head">Mimir's check <span className="muted small">as you type, with Mimir's own assembler</span></h4>
        {!check ? <p className="muted small asm-out-p">No main file to check yet.</p>
          : check.problems.length ? <ul className="asm-problem-list" aria-label="What the check found">{check.problems.map((p, i) => <ProblemRow key={i} file={p.file} line={p.line} msg={p.msg} level="error" onGo={onGo} />)}</ul>
            : <p className="small asm-out-p"><Icon name="check" size={12} className="scr-tab-ok" /> The program assembles: {plural(check.bytes, 'byte')}{check.entry != null ? `, a run starts at $${h4(check.entry)}${check.entryFrom === 'basic' ? ' (the SYS of its BASIC line)' : check.entryFrom === 'label' ? ` (its label ${check.check.labels.get(check.entry) ?? ''})` : ' (its first byte)'}` : ''}.</p>}
        {!!check?.problems.length && <p className="muted small asm-out-p">Mimir's assembler knows most of what Kick Assembler and 64tass do, not all (macros, functions, segments): where it cannot follow a line, Run still builds with the real assembler, and that build's problems are the ones that count.</p>}
        {notes.length > 0 && <>
          <h4 className="asm-out-head">The C64 <span className="muted small">what it does with the program that the assembler cannot see: the VIC, LOAD, the ROMs</span></h4>
          <ul className="asm-problem-list" aria-label="What the C64 check found">{notes.map((n, i) => <ProblemRow key={i} file={n.file} line={n.line} msg={n.msg} level={n.level} onGo={onGo} />)}</ul>
        </>}
        {!!check?.prints.length && <><h4 className="asm-out-head">.print</h4><pre className="asm-out-pre mono small">{check.prints.join('\n')}</pre></>}
        {build && !build.running && build.ok !== null && <>
          <h4 className="asm-out-head">{build.tool} <span className="muted small">the last build, {new Date(build.at).toLocaleTimeString()}</span></h4>
          {build.problems.length ? <ul className="asm-problem-list" aria-label="What the build found">{build.problems.map((p, i) => <ProblemRow key={i} file={p.file} line={p.line} msg={p.msg} level={p.severity} onGo={onGo} />)}</ul>
            : <p className="small asm-out-p">{build.ok ? 'No problems.' : 'It failed: see Build.'}</p>}
        </>}
      </div>
    </section>
  );
}

function BuildPane({ build, onGo }: { build: AsmBuild | null; onGo: (file: string, line: number) => void }) {
  if (!build) return <section className="scr-pane" aria-label="Build"><p className="muted small asm-out-p">Nothing built yet. Run (Ctrl+Enter or F5) builds the main file and starts it in VICE; Build (Ctrl+Shift+B) only builds it.</p></section>;
  const first = build.problems.find(p => p.severity === 'error');
  return (
    <section className="scr-pane" aria-label="Build">
      <div className="scr-pane-bar">
        <span className={cx('pill', build.running ? 'mid' : build.ok ? 'hi' : 'lo')} role="status">{buildLine(build)}</span>
        {first && <button className="btn small" onClick={() => onGo(first.file, first.line)}>Show the first error</button>}
        <span className="grow" />
        {build.prg && <span className="muted small mono" title={build.prg.path}>{build.prg.path}</span>}
      </div>
      <div className="scr-pane-body asm-pane-scroll">
        {build.commands.map((c, i) => <pre key={i} className="asm-out-pre mono small asm-cmd">{'> '}{c.map(a => (/\s/.test(a) ? `"${a}"` : a)).join(' ')}</pre>)}
        <pre className="asm-out-pre mono small" aria-label="What the assembler wrote">{build.log.trim() || (build.running ? '…' : '(nothing)')}</pre>
      </div>
    </section>
  );
}

/** The lines chosen counted along one path (cyclePath, as the re-assembler's inspector does, spec 10.1): the total, with
 *  no branch taken, the branches (a box marks one taken), and each instruction's cycles and the sum to its end. */
function CyclesPane({ c, onGo }: { c: AsmCycles; onGo: (file: string, line: number) => void }) {
  const p = c.path;
  const go = (a: Addr) => { const l = c.lineOf(a); return l ? <button className="linkish mono" onClick={() => onGo(l.file, l.line)} title={`Show ${l.file} line ${l.line}`}>{l.line}</button> : <span className="mono muted">${h4(a)}</span>; };
  if (!p || !p.instructions) return <section className="scr-pane" aria-label="Cycles"><p className="muted small asm-out-p">{c.label ? `No instructions on ${c.label}.` : 'Select lines in the editor to count their cycles along one path. Each instruction\'s cycles are beside its line number: 4+ takes one more when the index crosses a page, 2/3 is a branch not taken / taken (✓: marked taken here).'}</p></section>;
  return (
    <section className="scr-pane" aria-label="Cycles">
      <div className="scr-pane-bar">
        <span className="pill hi" role="status"><b className="mono">{p.total}</b> cycles on this path</span>
        <span className="muted small">{c.label}{p.total !== p.straight ? ` · ${p.straight} with no branch taken` : ''} · {plural(p.instructions, 'instruction')}{p.pageMax ? ` · up to +${p.pageMax} when indexes cross a page` : ''}{p.calls ? ` · ${plural(p.calls, 'jsr')}: the subroutines are not counted` : ''}</span>
      </div>
      <div className="scr-pane-body asm-pane-scroll asm-cycles">
        {p.branches.length > 0 && <ul className="asm-cyc-br" aria-label="Branches">
          {p.branches.map(b => (
            <li key={b.pc} className={cx(!b.onPath && 'off')}>
              <label className="check"><input type="checkbox" checked={b.on} onChange={() => c.onToggle(b.pc)} aria-label={`Branch on line ${c.lineOf(b.pc)?.line ?? h4(b.pc)} taken`} />
                <span className="mono">{c.code(b.pc)}</span></label>
              <span className="muted small">line {go(b.pc)} · {b.notTaken}/{b.taken}{b.taken === 4 ? ' (page)' : ''} · {!b.onPath ? 'not on this path'
                : b.back ? (b.pass != null ? `a loop: one more pass takes ${b.pass}` : 'loops back out of the lines') : `${b.on ? 'not taken' : 'taken'}: ${b.other}${b.leaves ? ' (leaves the lines)' : ''}`}</span>
            </li>
          ))}
        </ul>}
        <table className="asm-cyc-steps mono small" aria-label="Instructions">
          <thead><tr><th>Line</th><th>Code</th><th>Cycles</th><th>Sum</th></tr></thead>
          <tbody>{p.steps.slice(0, 400).map(st => (
            <tr key={st.pc} className={cx(!st.counted && 'off')}><td>{go(st.pc)}</td><td>{c.code(st.pc)}</td><td>{st.counted ? st.used : '—'}</td><td>{st.counted ? st.sum : ''}</td></tr>
          ))}</tbody>
        </table>
        {p.steps.length > 400 && <p className="muted small asm-out-p">… and {p.steps.length - 400} more instructions.</p>}
      </div>
    </section>
  );
}

function RunPane({ kept, onScreen }: { kept: AsmRunKept | null; onScreen: () => void }) {
  if (!kept) return <section className="scr-pane" aria-label="Last run"><p className="muted small asm-out-p">No run in Mimir yet. Debug (F8) starts the program in Mimir's 6510 and stops before its first instruction; Continue (Ctrl+Enter) runs it on to its end, a breakpoint or the most a run may take.</p></section>;
  const r = kept.run.regs;
  return (
    <section className="scr-pane" aria-label="Last run">
      <div className="scr-pane-bar">
        <span className={cx('pill', kept.ok ? 'hi' : 'mid')} role="status">{kept.text}</span>
        <span className="grow" />
        {kept.run.screen && <button className="btn small" onClick={onScreen}><Icon name="screen" size={13} />C64 screen</button>}
      </div>
      <div className="scr-pane-body asm-pane-scroll">
        <p className="small mono asm-out-p" aria-label="Registers at the end">PC ${h4(r.pc)} · A ${h2(r.a)} · X ${h2(r.x)} · Y ${h2(r.y)} · S ${h2(r.s)} · P ${h2(r.p)} · {(kept.run.ms / 1000).toFixed(2)} s</p>
        {kept.run.overCode?.length ? <p className="small asm-out-p">It wrote over its own code: {kept.run.overCode.slice(0, 6).map(o => `$${h4(o.at)} (${o.times}×)`).join(', ')}.</p> : null}
      </div>
    </section>
  );
}
