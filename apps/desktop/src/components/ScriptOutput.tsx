/* The output under a script's editor (spec 10.3): a row of tabs, as the window's bottom panel has, each of them one part
 * of what the script works with or did, with the panel's whole width to itself:
 *   Init           what every run (and Debug) starts with: the registers, the flags, zero-page bytes;
 *   Watch          the memory the code changes, found in it, and what the user adds (ScriptWatch.tsx);
 *   In the program what the script changed in the program (and in safe mode would change): the list, and beside it the
 *                  change picked, as bytes;
 *   Scratchpads    the script's own memory: the list, and beside it the scratchpad picked, as bytes;
 *   Last run       how it ended, the registers, what could not be written;
 *   Problems       what the check found, where the code is, what .print said.
 * The tab row stays when the output is folded down; each tab says what it holds (a count, a mark), and the last run's
 * end is at the right of the row. */
import { useEffect, useMemo, useState } from 'react';
import { BLOCK_PAD_FORM, byteLines, disassembleBytes, h2, h4, initEmpty, monitorChar, padData, padName, padNow, padStart, patchEnd, rangeText, SCRIPT_FLAGS, SCRIPT_P, scriptEndText, scriptPlace, tidyInit, type Addr, type BlockKind, type Patch, type ScriptCheck, type ScriptEnv, type ScriptInit, type ScriptPad, type ScriptPadSource, type ScriptProblem, type ScriptZpInit, type UserScript } from '@mimir/core';
import type { MenuItem } from '../lib/types';
import { PadCompare, PadEditor } from './PadTools';
import { Icon } from '../lib/icons';
import { cx } from '../lib/util';
import { initValue } from '../lib/scriptinit';
import { useScripts, type ChangeShown, type OutTab, type PadMode, type ScriptRunKept } from '../store/scripts';
import type { ScriptsViewProps } from './ScriptsView';

const $ = (a: number) => '$' + h4(a);
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** A scratchpad's bytes as the text of a log: the fill after the last byte written left out; PETSCII with RETURN
 *  ($0d) as the end of a line, or screen codes 40 to a line as on the screen. */
export function logText(bytes: Uint8Array, fill: number, screen: boolean): string {
  let n = bytes.length;
  while (n > 0 && bytes[n - 1] === fill) n--;
  const ch = (b: number) => monitorChar(b, screen)?.ch ?? '.';
  if (screen) {
    const rows: string[] = [];
    for (let i = 0; i < n; i += 40) rows.push(Array.from(bytes.subarray(i, Math.min(n, i + 40)), ch).join('').replace(/\s+$/, ''));
    return rows.join('\n') + '\n';
  }
  let out = '';
  for (let i = 0; i < n; i++) out += bytes[i] === 0x0d ? '\n' : ch(bytes[i]);
  return out.endsWith('\n') ? out : out + '\n';
}

/** a block of the program a scratchpad can be filled from: where it is, its type and its name (its label, else its address) */
export interface BlockChoice { start: Addr; end: Addr; kind: BlockKind; name: string }

/** a scratchpad while the script is debugged: its bytes as the run has them now, and before the last step */
export interface LivePad { name: string; bytes: Uint8Array; before: Uint8Array | null }

/** the run ended as a run should (RTS or BRK) and wrote what it changed */
const endedWell = (k: ScriptRunKept) => (k.run.end === 'rts' || k.run.end === 'brk') && !k.failed.length && !k.run.overCode?.length;

export interface ScriptOutputProps {
  script: UserScript; check: ScriptCheck; kept?: ScriptRunKept;
  /** the code has changed since the last run */
  stale: boolean;
  /** the script's changes in the program (its patches) */
  mine: Patch[]; env: ScriptEnv; names: ReadonlyMap<string, number>;
  /** Write into the program can be used (it checks out, nothing runs, no debugging) */
  canWrite: boolean;
  folded: boolean; height: number;
  /** the watch list's tab, and how many rows it has */
  watch: React.ReactNode; watchCount: number;
  /** while debugging, the scratchpad shown as the run has it */
  live: LivePad | null;
  /** where the script's code is (the check's placement, in words) */
  where: string;
  theme: string;
  onGoLine: (n: number) => void;
  onWrite: () => void;
  placePad: (size: number, near?: Addr) => Addr;
  blocks: readonly BlockChoice[]; cursorBlock: Addr | null;
  onEdit: ScriptsViewProps['onEdit']; onTakeOut: ScriptsViewProps['onTakeOut']; onSwitchPatch: ScriptsViewProps['onSwitchPatch'];
  onCopyBlock: ScriptsViewProps['onCopyBlock']; onShow: ScriptsViewProps['onShow']; onCopy: ScriptsViewProps['onCopy'];
  onSave: ScriptsViewProps['onSave']; onSaveText: ScriptsViewProps['onSaveText']; onMenu: ScriptsViewProps['onMenu']; toast: ScriptsViewProps['toast'];
}

export function ScriptOutput(props: ScriptOutputProps) {
  const { script, check, kept, stale, mine, folded, height, watch, watchCount } = props;
  const { outTab, set } = useScripts();
  const errors = check.problems.filter(p => p.level === 'error').length, warnings = check.problems.length - errors;
  const would = kept?.safe ? kept.would ?? [] : null;
  const run = kept?.run, ok = !!kept && endedWell(kept);
  const open = (k: OutTab) => set({ outTab: k, outFolded: false });
  const tabs: { k: OutTab; label: string; tip: string; badge: React.ReactNode }[] = [
    { k: 'init', label: 'Init', tip: 'What every run (and Debug) starts with: A, X and Y, the flags and zero-page bytes',
      badge: !initEmpty(script.init) && <span className="count scr-count-on" title="Init is set: runs start with it">set</span> },
    { k: 'watch', label: 'Watch', tip: 'The memory the code changes, found in it by itself, and what you add: the values as a run starts, after the last run, or now while debugging',
      badge: <span className="count">{watchCount}</span> },
    { k: 'program', label: 'In the program', tip: 'What the script changed in the program\'s bytes: the listing, the source, the export and Build & Run have it. In safe mode also what a run would change',
      badge: <><span className="count">{mine.length}</span>{would?.length ? <span className="count scr-count-safe" title={`Safe mode: the last run would change ${plural(would.length, 'place')}`}><Icon name="shield" size={10} />{would.length}</span> : null}</> },
    { k: 'pads', label: 'Scratchpads', tip: 'The script\'s own memory for data kept outside the program (a log, a decrypted table), shown as hex, code or text, saved as a file',
      badge: <span className="count">{script.pads.length}</span> },
    { k: 'run', label: 'Last run', tip: run ? `The last run: ${scriptEndText(run)}` : 'How the last run ended: it has not run yet',
      badge: run && <Icon name={ok ? 'check' : 'warn'} size={12} className={ok ? 'scr-tab-ok' : 'scr-tab-warn'} /> },
    { k: 'problems', label: 'Problems', tip: 'What the check found in the code, where its code is placed, and what .print said',
      badge: <span className={cx('count', errors ? 'bad' : warnings ? 'scr-count-warn' : '')}>{check.problems.length}</span> },
  ];
  const label = tabs.find(t => t.k === outTab)?.label ?? 'Output';
  return (
    <>
      <div className="tabs small scr-out-tabs" role="tablist" aria-label="Output of the script">
        {tabs.map(t => (
          <button key={t.k} role="tab" id={`scr-tab-${t.k}`} aria-selected={!folded && outTab === t.k} aria-controls="scr-out" className={cx('tab', !folded && outTab === t.k && 'on', folded && outTab === t.k && 'last')}
            onClick={() => open(t.k)} title={t.tip}>{t.label}{t.badge}</button>
        ))}
        <span className="grow" />
        {run && <button className={cx('scr-run-stat', ok ? 'ok' : 'warn')} onClick={() => open('run')} title={`The last run${stale ? ' (the code has changed since)' : ''}: a click shows it`}>
          <Icon name={ok ? 'check' : 'warn'} size={12} /><span className="scr-end">{scriptEndText(run)}</span>
          {stale && <span className="pill mid">code changed since</span>}
        </button>}
        {folded && errors > 0 && <span className="scr-out-bad">{plural(errors, 'error')}</span>}
        <button className="icon-btn panel-toggle" aria-label="Output" aria-expanded={!folded} aria-controls="scr-out" onClick={() => set({ outFolded: !folded })}
          title={folded ? 'Show the output: Init, the watch list, what the script changed, the scratchpads, the last run and the problems' : 'Fold the output down: the code gets the room'}>
          <Icon name="down" size={14} className={folded ? 'flip' : ''} /></button>
      </div>
      {!folded && <div className={cx('scr-out', `scr-out-${outTab}`)} id="scr-out" role="tabpanel" aria-labelledby={`scr-tab-${outTab}`} aria-label={label} style={{ maxHeight: height }}>
        {outTab === 'init' && <InitSection script={script} names={props.names} problems={check.problems} onEdit={props.onEdit} />}
        {outTab === 'watch' && watch}
        {outTab === 'program' && <ProgramPane {...props} would={would} />}
        {outTab === 'pads' && <PadsPane {...props} />}
        {outTab === 'run' && <RunPane kept={kept} stale={stale} />}
        {outTab === 'problems' && <ProblemsPane check={check} where={props.where} onGoLine={props.onGoLine} />}
      </div>}
    </>
  );
}

/** In the program: what the script changed in the program (each switched on or off), and in safe mode what the last
 *  run would change; beside the list, the change picked as bytes. */
function ProgramPane(p: ScriptOutputProps & { would: Patch[] | null }) {
  const { script, mine, would, stale, canWrite, onTakeOut, onSwitchPatch, onWrite } = p;
  const { change, set } = useScripts();
  const sorted = [...mine].sort((a, b) => a.start - b.start);
  // the change shown: the one picked, while it is there, else the first
  const valid = (c: ChangeShown | null) => !!c && (c.kind === 'patch' ? sorted.some(x => x.id === c.id) : !!would?.[c.i]);
  const shown: ChangeShown | null = valid(change) ? change : sorted[0] ? { kind: 'patch', id: sorted[0].id } : would?.length ? { kind: 'would', i: 0 } : null;
  const patch = shown?.kind === 'patch' ? sorted.find(x => x.id === shown.id) : shown?.kind === 'would' ? would?.[shown.i] : undefined;
  return (
    <div className="scr-split">
      <div className="scr-master">
        <div className="scr-pane-bar">
          <h5 className="scr-group-h">Changed in the program</h5>
          {stale && !would && mine.length > 0 && <span className="pill mid" title="The code has changed since this run: run it again to update the program">code changed since</span>}
          <span className="grow" />
          {mine.length > 0 && <button className="btn ghost small" onClick={() => onTakeOut(script.id)} title="Take what the script changed out of the program: the original bytes come back (Ctrl+Z puts it back)"><Icon name="undo" size={13} />Take out</button>}
        </div>
        <div className="scr-master-body">
          {!mine.length && <p className="scr-empty">{script.safe
            ? 'Nothing. Safe mode is on: runs leave the program and its .asm as they are.'
            : <>Nothing yet. What a run changes in the program's bytes comes here and into the program: the listing, the source, the export and Build &amp; Run have it. The script's own code never does.</>}</p>}
          {mine.length > 0 && script.safe && <p className="scr-note">Written before safe mode was switched on; runs in safe mode leave it as it is.</p>}
          <ul className="scr-changes" aria-label="Changed in the program">{sorted.map(x => (
            <li key={x.id} className={cx('scr-change-row', x.off && 'off')}>
              <input type="checkbox" role="switch" className="switch" checked={!x.off} aria-label={`${x.name} in the program`} title={x.off ? 'Left out: the original bytes are there. Switch it on to write the change' : 'Written into the program. Switch it off to leave it out (runs keep it out)'} onChange={e => onSwitchPatch(x, e.target.checked)} />
              <button className={cx('scr-change', shown?.kind === 'patch' && shown.id === x.id && 'on')} onClick={() => set({ change: { kind: 'patch', id: x.id } })}>{rangeText({ start: x.start, end: patchEnd(x) })} · {plural(x.bytes.length, 'byte')}</button>
            </li>))}</ul>
          {would && <div className="scr-would-sec">
            <div className="scr-sub-h">
              <h5 className="scr-group-h"><Icon name="shield" size={12} />Would change</h5>
              {stale && <span className="pill mid" title="The code has changed since this run: run it again to see what it would change now">code changed since</span>}
            </div>
            <p className="scr-note">{would.length ? 'The last run ran in safe mode: none of this is in the program.' : 'The last run ran in safe mode and would change none of the program\'s bytes.'}</p>
            <ul className="scr-changes" aria-label="Would change in the program">{would.map((x, i) => (
              <li key={i} className={cx('scr-change-row', x.off && 'off')}>
                <button className={cx('scr-change', shown?.kind === 'would' && shown.i === i && 'on')} onClick={() => set({ change: { kind: 'would', i } })}
                  title={x.off ? 'You left this change out of the program: written, it would stay out' : 'What the run would write here: a click shows the bytes'}>{rangeText({ start: x.start, end: patchEnd(x) })} · {plural(x.bytes.length, 'byte')}</button>
              </li>))}</ul>
            {would.length > 0 && <button className="btn small scr-write" disabled={!canWrite} onClick={onWrite}
              title="Run the script once more and write what it changes into the program and its .asm, in place of what its earlier runs wrote (Ctrl+Z takes it back). Safe mode stays on"><Icon name="download" size={13} />Write into the program</button>}
          </div>}
        </div>
      </div>
      <PadView {...p} target={patch ? { kind: 'patch', patch, preview: shown?.kind === 'would' } : null}
        empty={script.safe ? 'Run the script: what it would change in the program shows here, and Write into the program puts it in.' : 'Run the script (Ctrl+Enter): what it changes in the program shows here, byte for byte.'} />
    </div>
  );
}

/** Scratchpads: the script's own memory, each with its name, address, size and fill (edited in the list); beside the
 *  list, the scratchpad picked as bytes. */
function PadsPane(p: ScriptOutputProps) {
  const { script, check, env, names, blocks, cursorBlock, onCopyBlock, onEdit } = p;
  const { pad, set } = useScripts();
  const [fromBlock, setFromBlock] = useState(false);
  const setPads = (pads: ScriptPad[], label: string) => onEdit(script.id, { pads }, label);
  const addPad = () => {
    // not over the code, another scratchpad, or memory the code reads and writes as the program's ($0400 for the screen)
    const taken = [...check.code, ...script.pads.map(x => ({ start: x.start, end: x.start + x.size })), ...check.access];
    const last = script.pads[script.pads.length - 1];
    const start = scriptPlace(env.files, 0x100, taken, last ? last.start + last.size : undefined)?.at ?? 0xc000;
    const name = padName(script.pads);
    setPads([...script.pads, { name, start, size: 0x100 }], `Add scratchpad ${name} to "${script.name}"`);
    set({ pad: script.pads.length });
  };
  /** a scratchpad changed in the list: start content written in Kick Assembler is for its address, so it is assembled
   *  again where the scratchpad is now (when it still reads; else it keeps its bytes) */
  const moved = (old: ScriptPad, q: ScriptPad): ScriptPad => {
    if (q.start === old.start || q.src?.form !== 'asm') return q;
    const r = padData(q.src, q.start, q.size, names, q.fill ?? 0);
    return 'bytes' in r ? { ...q, ...(r.bytes.length ? { data: r.bytes } : {}) } : q;
  };
  // which scratchpads the last run changed (a dot in the list)
  const changed = useMemo(() => script.pads.map(x => {
    if (!x.bytes || x.bytes.length !== x.size) return false;
    const s = padStart(x);
    for (let i = 0; i < x.size; i++) if (x.bytes[i] !== s[i]) return true;
    return false;
  }), [script.pads]);
  const i = script.pads[pad] ? pad : 0, shown = script.pads[i];
  return (
    <div className="scr-split">
      <div className="scr-master scr-pads-master">
        <div className="scr-pane-bar">
          <h5 className="scr-group-h">Scratchpads</h5>
          <span className="grow" />
          <button className={cx('btn ghost small', fromBlock && 'on')} aria-expanded={fromBlock} onClick={() => setFromBlock(v => !v)} title="Copy a block of the program into a scratchpad, written as its type is: code as code, text as text, characters, sprites and bitmaps as .byte lines in their shape, other data as hex"><Icon name="copy" size={13} />From a block…</button>
          <button className="btn ghost small" onClick={addPad} title="A scratchpad: memory of the script's own at an address, for data kept outside the program (a log, say) that can be saved as a file. It is cleared before each run; its name (and name_end) are labels in the code"><Icon name="plus" size={13} />Add</button>
        </div>
        <div className="scr-master-body">
          {fromBlock && <BlockToPad blocks={blocks} pads={script.pads} first={cursorBlock} into={shown ? i : null}
            onCopy={(start, into) => { onCopyBlock(start, script.id, into); setFromBlock(false); }} onCancel={() => setFromBlock(false)} />}
          {!script.pads.length && <p className="scr-empty">None. Add one to keep data outside the program, a log the script writes, say, and save it as a file.</p>}
          {script.pads.length > 0 && <div className="pad-table" role="table" aria-label="Scratchpads">
            <div className="pad-row pad-head" role="row"><span /><span>Name</span><span>Address</span><span>Size</span><span>Fill</span><span /></div>
            {script.pads.map((x, j) => (
              <PadRow key={`${script.id}-${j}`} pad={x} on={j === i} changed={changed[j]} bad={check.problems.some(q => q.pad === j && q.level === 'error')} warn={check.problems.some(q => q.pad === j && q.level === 'warning')}
                onShow={() => { if (j !== i) set({ pad: j }); }}
                onChange={q => setPads(script.pads.map((y, k) => (k === j ? moved(y, q) : y)), `Change scratchpad ${x.name} of "${script.name}"`)}
                onRemove={() => { setPads(script.pads.filter((_, k) => k !== j), `Remove scratchpad ${x.name} from "${script.name}"`); set({ pad: 0 }); }} />
            ))}
          </div>}
        </div>
      </div>
      <PadView {...p} target={shown ? { kind: 'pad', pad: shown, i } : null}
        empty="A scratchpad is memory of the script's own: Add one, or copy a block of the program into one (From a block…), and its bytes show here." />
    </div>
  );
}

/** Last run: how it ended, the registers it ended with, how long it took; what could not be written, and whether it
 *  wrote over its own code. */
function RunPane({ kept, stale }: { kept?: ScriptRunKept; stale: boolean }) {
  const run = kept?.run;
  if (!kept || !run) return <div className="scr-pane-body"><p className="scr-empty">Not run yet. <b>Run</b> (Ctrl+Enter) runs the script here in Mimir, and how it ended shows here: the instruction it stopped at, the registers, the time. <b>Debug</b> (F8) goes through it an instruction at a time.</p></div>;
  const ok = endedWell(kept), well = run.end === 'rts' || run.end === 'brk';
  return (
    <div className="scr-pane-body scr-run-sec">
      <dl className="scr-facts">
        <dt>Ended</dt><dd className={cx('scr-end-text', well ? 'ok' : 'warn')}><Icon name={well ? 'check' : 'warn'} size={13} />{scriptEndText(run)}</dd>
        <dt>Registers</dt><dd className="scr-regs mono">
          {([['A', run.regs.a], ['X', run.regs.x], ['Y', run.regs.y], ['S', run.regs.s], ['P', run.regs.p]] as const).map(([r, v]) => <span key={r} className="scr-reg"><b>{r}</b>${h2(v)}</span>)}
        </dd>
        <dt>Time</dt><dd>{run.ms} ms · {new Date(kept.at).toLocaleTimeString()}</dd>
        <dt>Program</dt><dd>{kept.safe ? <span className="scr-safe-txt"><Icon name="shield" size={12} />Safe mode: nothing went into the program</span> : 'What it changed went into the program (In the program)'}</dd>
        {stale && <><dt>Code</dt><dd><span className="pill mid">changed since this run</span> run it again to see what it does now</dd></>}
      </dl>
      {!ok || run.other > 0 ? <div className="scr-run-notes">
        {kept.failed.map((f, i) => <p key={i} className="small scr-failed"><Icon name="warn" size={13} />{kept.safe ? 'Could not be written' : 'Not written'} into the program, {rangeText(f)}: {f.error}</p>)}
        {run.overCode?.length ? <p className="small scr-failed" title="A run that writes over its code no longer runs the code it was written as (a loop stops early). Code that changes itself on purpose (an operand) is said here too"><Icon name="warn" size={13} />It wrote over its own code: {run.overCode.slice(0, 4).map(o => `line ${o.line} ($${h4(o.at)}${o.times > 1 ? `, ${o.times} times` : ''})`).join(', ')}{run.overCode.length > 4 ? ', …' : ''}. If that was not meant, an address the code writes lies where the code is.</p> : null}
        {run.other > 0 && <p className="small muted">{plural(run.other, 'byte')} changed outside the program and the scratchpads (the zero page, the stack, …): not kept.</p>}
      </div> : null}
    </div>
  );
}

/** Problems: the check's errors and warnings (a click goes to the line), where the code is placed, and .print. */
function ProblemsPane({ check, where, onGoLine }: { check: ScriptCheck; where: string; onGoLine: (n: number) => void }) {
  return (
    <div className="scr-pane-body">
      {check.problems.length ? <ul className="scr-problems" aria-label="Problems">{check.problems.map((p, i) => (
        <li key={i} className={cx(p.level === 'error' ? 'bad' : 'warn')}>
          <Icon name={p.level === 'error' ? 'err' : 'warn'} size={13} />
          {p.line ? <button className="linkish" onClick={() => onGoLine(p.line!)}>Line {p.line}</button> : null}<span>{p.msg}</span>
        </li>))}</ul>
        : <p className="scr-ok-line"><Icon name="ok" size={14} />No problems: the script assembles with the program's names and has code to run.</p>}
      {where && <p className="scr-where"><Icon name="info" size={13} /><span>{where}</span></p>}
      {check.prints.length > 0 && <><h5 className="scr-group-h scr-prints-h">.print</h5><pre className="scr-prints">{check.prints.join('\n')}</pre></>}
    </div>
  );
}

/** Which block goes into which scratchpad (a new one, or one of the script's), and what it becomes there. */
function BlockToPad({ blocks, pads, first, into, onCopy, onCancel }: { blocks: readonly BlockChoice[]; pads: readonly ScriptPad[]; first: Addr | null; into: number | null; onCopy: (start: Addr, pad: number | null) => void; onCancel: () => void }) {
  const [start, setStart] = useState<Addr | null>(first != null && blocks.some(b => b.start === first) ? first : blocks[0]?.start ?? null);
  const [pad, setPad] = useState<string>(into != null ? String(into) : 'new');
  const b = blocks.find(x => x.start === start), n = b ? b.end - b.start : 0, p = pad === 'new' ? null : pads[+pad];
  return (
    <div className="pad-from" role="group" aria-label="Copy a block into a scratchpad">
      <label><span>Block</span><select aria-label="Block" value={start ?? ''} onChange={e => setStart(+e.target.value)}>
        {blocks.map(x => <option key={x.start} value={x.start}>{x.name} · {x.kind} · {rangeText(x)} · {plural(x.end - x.start, 'byte')}</option>)}
      </select></label>
      <label><span>Into</span><select aria-label="Into" value={pad} onChange={e => setPad(e.target.value)}>
        <option value="new">a new scratchpad</option>
        {pads.map((x, i) => <option key={i} value={i}>{x.name} ({rangeText({ start: x.start, end: x.start + x.size })})</option>)}
      </select></label>
      {b && <p className="muted small">As {BLOCK_PAD_FORM[b.kind] ?? 'hex'}{b.kind === 'code' ? ' (Kick Assembler, the program\'s names kept)' : ''}. {p ? (p.size < n ? `${p.name} becomes ${n} bytes, when there is room after it.` : `In place of what ${p.name} starts with now.`) : `A new scratchpad of ${n} bytes.`}</p>}
      <div className="pad-from-act">
        <button className="btn small primary" disabled={!b} onClick={() => b && onCopy(b.start, p ? +pad : null)}><Icon name="copy" size={13} />Copy</button>
        <button className="btn small" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

/**
 * Init (spec 10.3): what the script's runs start with. A, X and Y (a byte each), the flags N V D I Z C (a click sets or
 * clears one) and zero-page bytes or words (a pointer, low byte first), each with its address (a name of the program's
 * zero page, or $fb) and its value (a number, or a name: a label's address). What differs from a run without an init
 * is kept with the script (in the project and the library); Reset takes it all away.
 */
function InitSection({ script, names, problems, onEdit }: { script: UserScript; names: ReadonlyMap<string, number>; problems: readonly ScriptProblem[]; onEdit: ScriptsViewProps['onEdit'] }) {
  const init = script.init ?? {};
  const p = init.p ?? SCRIPT_P;
  const zp = init.zp ?? [];
  const save = (next: ScriptInit, label: string) => onEdit(script.id, { init: tidyInit(next) ?? undefined }, label);
  /** the program's names in the zero page, by address (what the address of a zero-page init shows) */
  const zpNames = useMemo(() => { const m = new Map<number, string>(); for (const [n, a] of names) if (a < 0x100 && !m.has(a)) m.set(a, n); return m; }, [names]);
  const addZp = () => {
    const used = new Set(zp.flatMap(z => (z.word ? [z.at, z.at + 1] : [z.at])));
    const last = zp[zp.length - 1];
    const free = (a: number) => a >= 0 && a <= 0xff && !used.has(a);
    const at = [last ? last.at + (last.word ? 2 : 1) : -1, 0xfb, 0xfc, 0xfd, 0xfe, 0x02].find(free) ?? [...Array(0x100).keys()].find(free);
    if (at == null) return;
    save({ ...init, zp: [...zp, { at, value: 0 }] }, `Add zero-page byte $${h2(at)} to the init of "${script.name}"`);
  };
  return (
    <section className="scr-pane scr-init" aria-label="Init">
      <div className="scr-pane-bar">
        <p className="scr-pane-help">What every run, and Debug, starts with. Left as it is, a run starts as a SYS does: A, X and Y $00, only I set. The zero page is the program's: what is set here is there for its code too, and never goes into the program.</p>
        <span className="grow" />
        {!initEmpty(script.init) && <button className="btn ghost small" onClick={() => save({}, `Reset the init of "${script.name}"`)} title="A, X and Y back to 0, only I set, and no zero-page bytes"><Icon name="undo" size={13} />Reset</button>}
      </div>
      <div className="scr-pane-body init-groups">
        <div className="init-group">
          <h5 className="scr-group-h">Registers</h5>
          <div className="init-regs">
            {(['a', 'x', 'y'] as const).map(r => (
              <InitReg key={r} reg={r.toUpperCase()} value={init[r] ?? 0} names={names}
                onCommit={v => save({ ...init, [r]: v }, `Init ${r.toUpperCase()} = $${h2(v)} for "${script.name}"`)} />
            ))}
          </div>
        </div>
        <div className="init-group">
          <h5 className="scr-group-h">Flags <span className="init-p mono" title="The status register these flags make (N V - B D I Z C)">P=${h2(p | 0x20)}</span></h5>
          <div className="init-flags" role="group" aria-label="Flags at the start">
            {SCRIPT_FLAGS.map(f => {
              const on = (p & f.bit) !== 0;
              return <button key={f.name} className={cx('dbg-flag init-flag', on && 'on')} aria-pressed={on} aria-label={f.what}
                title={`${f.what} (${f.name}): ${on ? 'set' : 'clear'} when the run starts; a click ${on ? 'clears' : 'sets'} it${f.name === 'I' ? '. No interrupts come in a run in any case' : f.name === 'D' ? '. ADC and SBC then count in decimal' : ''}`}
                onClick={() => save({ ...init, p: p ^ f.bit }, `${on ? 'Clear' : 'Set'} ${f.what.toLowerCase()} at the start of "${script.name}"`)}>{f.name}</button>;
            })}
          </div>
        </div>
        <div className="init-group init-zp-group">
          <h5 className="scr-group-h">Zero page<span className="grow" />
            <button className="btn ghost small" onClick={addZp} aria-label="Add a zero-page byte" title="A zero-page byte the run starts with (a word: a pointer, low byte first). The address and the value can be names of the program"><Icon name="plus" size={13} />Add</button></h5>
          {zp.length > 0 ? <div className="init-zp" role="table" aria-label="Zero page at the start">
            <div className="init-zp-row init-zp-head" role="row"><span>Address</span><span>Value</span><span>Size</span><span /></div>
            {zp.map((z, i) => (
              <InitZpRow key={`${script.id}-${i}`} z={z} name={zpNames.get(z.at)} names={names}
                bad={problems.some(x => x.zp === i && x.level === 'error')} warn={problems.some(x => x.zp === i && x.level === 'warning')}
                onChange={q => save({ ...init, zp: zp.map((x, j) => (j === i ? q : x)) }, `Change zero-page $${h2(q.at)} in the init of "${script.name}"`)}
                onRemove={() => save({ ...init, zp: zp.filter((_, j) => j !== i) }, `Remove zero-page $${h2(z.at)} from the init of "${script.name}"`)} />
            ))}
          </div> : <p className="scr-note">None: a run finds what the program has there. Add sets a byte, or a word (a pointer) when its value is a label.</p>}
        </div>
      </div>
    </section>
  );
}

/** A register of Init: its value as `$xx`; a number or `<name` / `>name` typed, Enter or leaving it keeps it. */
function InitReg({ reg, value, names, onCommit }: { reg: string; value: number; names: ReadonlyMap<string, number>; onCommit: (v: number) => void }) {
  const shown = '$' + h2(value);
  const [t, setT] = useState(shown);
  useEffect(() => setT(shown), [shown]);
  const commit = () => {
    const v = initValue(t, names);
    if (v == null || v > 0xff) { setT(shown); return; }
    if (v !== value) onCommit(v); else setT(shown);
  };
  return (
    <label className="init-reg" title={`${reg} when the run starts: a byte ($ff, 255, %1010, or <label / >label for a half of a label's address)`}>
      <span>{reg}</span>
      <input aria-label={`Init ${reg}`} className="mono" value={t} onChange={e => setT(e.target.value)} onBlur={commit} onFocus={e => e.target.select()}
        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setT(shown); (e.target as HTMLInputElement).blur(); } }} />
    </label>
  );
}

/** A zero-page byte or word of Init: its address (shown by the program's name for it), its value and its size. A value
 *  past $ff makes it a word; a word cannot start at $ff. */
function InitZpRow({ z, name, names, bad, warn, onChange, onRemove }: { z: ScriptZpInit; name?: string; names: ReadonlyMap<string, number>; bad: boolean; warn: boolean; onChange: (z: ScriptZpInit) => void; onRemove: () => void }) {
  const atText = name ?? '$' + h2(z.at), valText = '$' + (z.word ? h4(z.value) : h2(z.value));
  const [at, setAt] = useState(atText), [val, setVal] = useState(valText);
  useEffect(() => { setAt(atText); setVal(valText); }, [atText, valText]);
  const back = () => { setAt(atText); setVal(valText); };
  const commit = () => {
    const a = initValue(at, names), v = initValue(val, names);
    if (a == null || a > 0xff || v == null) { back(); return; }
    const word = !!z.word || v > 0xff;
    if (word && a > 0xfe) { back(); return; }
    const q: ScriptZpInit = { at: a, value: v, ...(word ? { word: true } : {}) };
    if (q.at === z.at && q.value === z.value && !!q.word === !!z.word) { back(); return; }
    onChange(q);
  };
  const key = (e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { back(); (e.target as HTMLInputElement).blur(); } };
  return (
    <div className={cx('init-zp-row', bad && 'bad', !bad && warn && 'warn')} role="row">
      <input aria-label="Zero-page address" className="mono" value={at} onChange={e => setAt(e.target.value)} onBlur={commit} onKeyDown={key} onFocus={e => e.target.select()}
        title={`$${h2(z.at)}${name ? ` (${name})` : ''}${z.word ? ` and $${h2(z.at + 1)}` : ''}: a zero-page address, $00-$ff, or a name of the program's zero page`} />
      <input aria-label="Zero-page value" className="mono" value={val} onChange={e => setVal(e.target.value)} onBlur={commit} onKeyDown={key} onFocus={e => e.target.select()}
        title={z.word ? `A word, low byte at $${h2(z.at)} ($${h2(z.value & 0xff)}) and high byte at $${h2(z.at + 1)} ($${h2(z.value >> 8)}): a number or a label (its address)` : 'A byte: a number, or <label / >label; a label or a value past $ff makes it a word'} />
      <select aria-label="Zero-page size" value={z.word ? 'word' : 'byte'} title="A byte, or a word (two bytes, low byte first: a pointer)"
        onChange={e => { const w = e.target.value === 'word'; if (w && z.at > 0xfe) { back(); return; } onChange({ at: z.at, value: w ? z.value : z.value & 0xff, ...(w ? { word: true } : {}) }); }}>
        <option value="byte">byte</option><option value="word">word</option>
      </select>
      <button className="icon-btn" aria-label={`Remove zero-page $${h2(z.at)}`} title="Remove it: the run finds what the program has there" onClick={onRemove}><Icon name="x" size={13} /></button>
    </div>
  );
}

/** A scratchpad in the list: a dot when the last run changed it, its name, address, size and fill (edited in place),
 *  and a button that removes it; a click anywhere on it shows it beside the list. */
function PadRow({ pad, on, changed, bad, warn, onShow, onChange, onRemove }: { pad: ScriptPad; on: boolean; changed: boolean; bad: boolean; warn: boolean; onShow: () => void; onChange: (p: ScriptPad) => void; onRemove: () => void }) {
  const [name, setName] = useState(pad.name), [start, setStart] = useState($(pad.start)), [size, setSize] = useState($(pad.size)), [fill, setFill] = useState('$' + h2(pad.fill ?? 0));
  useEffect(() => { setName(pad.name); setStart($(pad.start)); setSize($(pad.size)); setFill('$' + h2(pad.fill ?? 0)); }, [pad]);
  const num = (t: string) => { const s = t.trim(); return /^\$[0-9a-f]+$/i.test(s) ? parseInt(s.slice(1), 16) : /^[0-9]+$/.test(s) ? parseInt(s, 10) : NaN; };
  const commit = () => {
    const a = num(start), n = num(size), f = num(fill);
    if (!(a >= 0 && a <= 0xffff) || !(n >= 1 && a + n <= 0x10000) || !(f >= 0 && f <= 255) || !name.trim()) { setName(pad.name); setStart($(pad.start)); setSize($(pad.size)); setFill('$' + h2(pad.fill ?? 0)); return; }
    // its start content goes with it (written in Kick Assembler, PadsPane assembles it again where it is now)
    const q: ScriptPad = { name: name.trim(), start: a, size: n, ...(f ? { fill: f } : {}), ...(pad.data ? { data: pad.data } : {}), ...(pad.src ? { src: pad.src } : {}) };
    if (q.name === pad.name && q.start === pad.start && q.size === pad.size && (q.fill ?? 0) === (pad.fill ?? 0)) return;
    // what the last run left belongs to the old place and size
    onChange(q.start === pad.start && q.size === pad.size && pad.bytes ? { ...q, bytes: pad.bytes } : q);
  };
  const key = (e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); };
  return (
    <div className={cx('pad-row', on && 'on', bad && 'bad', !bad && warn && 'warn')} role="row" aria-selected={on} onClick={onShow}>
      <span className="pad-dot-cell">{changed && <span className="pad-dot" aria-label="changed by the last run" title="The last run changed it" />}</span>
      <input aria-label="Scratchpad name" value={name} onChange={e => setName(e.target.value)} onBlur={commit} onKeyDown={key} onFocus={onShow} title="Its name is a label in the code (and name_end the address after it)" />
      <input aria-label="Scratchpad address" className="mono" value={start} onChange={e => setStart(e.target.value)} onBlur={commit} onKeyDown={key} onFocus={onShow} title="Where it is in memory while the script runs: over the program's bytes there, if any" />
      <input aria-label="Scratchpad size" className="mono" value={size} onChange={e => setSize(e.target.value)} onBlur={commit} onKeyDown={key} onFocus={onShow} title="How many bytes ($100 or 256)" />
      <input aria-label="Scratchpad fill" className="mono" value={fill} onChange={e => setFill(e.target.value)} onBlur={commit} onKeyDown={key} onFocus={onShow} title="The byte it holds when a run starts" />
      <button className="icon-btn" aria-label={`Remove scratchpad ${pad.name}`} title="Remove the scratchpad" onClick={e => { e.stopPropagation(); onRemove(); }}><Icon name="x" size={13} /></button>
    </div>
  );
}

/** what the view beside a list shows: a scratchpad (with its index), or a change in the program (`preview`: one a run
 *  in safe mode would make, not in the program) */
type ViewTarget = { kind: 'pad'; pad: ScriptPad; i: number } | { kind: 'patch'; patch: Patch; preview: boolean } | null;

/** The view beside the list of In the program or of Scratchpads: a change the script made in the program, or a
 *  scratchpad's bytes, as hex, code or text, with what can be done with them. While debugging, the scratchpad as the run
 *  has it now (`live`), the bytes the last step changed marked in the hex. A scratchpad that has not run (or whose start
 *  content changed since) shows what a run starts it with; Edit start sets that, Copy to copies it to another
 *  scratchpad (or a new one), and Compare sets it against another scratchpad or its start with a heat map. */
function PadView({ script, target, empty, names, live, theme, onShow, onCopy, onSave, onSaveText, onEdit, onMenu, placePad, toast }: ScriptOutputProps & { target: ViewTarget; empty: string }) {
  const { cmpWith, mode, screen, set } = useScripts();
  const onMode = (m: PadMode) => set({ mode: m }), onScreen = (v: boolean) => set({ screen: v });
  const [editing, setEditing] = useState<string | null>(null);
  // 16 bytes a hex row where they fit, else 8
  const [wide, setWide] = useState(true);
  const [view, setView] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!view || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setWide(view.clientWidth >= 560)); ro.observe(view); setWide(view.clientWidth >= 560);
    return () => ro.disconnect();
  }, [view]);
  const patch = target?.kind === 'patch' ? target.patch : undefined;
  // a change the last run (in safe mode) would make: not in the program
  const preview = target?.kind === 'patch' && target.preview;
  const pad = target?.kind === 'pad' ? target.pad : undefined;
  const pi = target?.kind === 'pad' ? target.i : -1;
  const now = pad && live && live.name === pad.name && live.bytes.length === pad.size ? live : null;
  // a scratchpad without a run's bytes: what a run starts it with
  const atStart = !!pad && !now && !(pad.bytes && pad.bytes.length === pad.size);
  const startBytes = useMemo(() => (pad ? padStart(pad) : null), [pad]);
  const bytes = patch ? patch.bytes : now ? now.bytes : pad ? (atStart ? startBytes : pad.bytes!) : null;
  const at = patch ? patch.start : pad?.start ?? 0;
  const showAs = mode === 'compare' && !pad ? 'hex' : mode;
  // what Compare sets the scratchpad against: the scratchpad picked (by name), else its start, else the first other
  const others = pad ? script.pads.filter(p => p !== pad) : [];
  const vs = cmpWith === '@start' || others.some(p => p.name === cmpWith) ? cmpWith! : others[0]?.name ?? '@start';
  const vsPad = vs === '@start' ? null : others.find(p => p.name === vs) ?? null;
  const vsBytes = useMemo(() => (!pad ? null : vsPad ? padNow(vsPad) : startBytes), [pad, vsPad, startBytes]);
  /** the scratchpad's bytes as shown, copied to scratchpad `j` (its start content, cut to its size) or to a new one */
  const copyTo = (j: number | null) => {
    if (!pad || !bytes) return;
    const from = bytes.slice();
    if (j == null) {
      const name = padName(script.pads), start = placePad(pad.size, pad.start + pad.size);
      onEdit(script.id, { pads: [...script.pads, { name, start, size: pad.size, ...(pad.fill ? { fill: pad.fill } : {}), data: from }] }, `Copy scratchpad ${pad.name} to a new one, ${name}`);
      toast(`${pad.name} copied to the new scratchpad ${name} at $${h4(start)}: a run starts it with these ${from.length} bytes`, 'ok');
      return;
    }
    const t = script.pads[j], { bytes: _b, src: _s, ...keep } = t;
    onEdit(script.id, { pads: script.pads.map((x, k) => (k === j ? { ...keep, data: from.slice(0, t.size) } : x)) }, `Copy scratchpad ${pad.name} to ${t.name}`);
    toast(`${pad.name} copied to ${t.name}: a run starts it with ${from.length > t.size ? `the first ${t.size} of the ${from.length} bytes (it holds no more)` : `these ${from.length} bytes`}`, from.length > t.size ? 'warn' : 'ok');
  };
  /** what the editor set: the scratchpad's start content and how it was written; what the last run left goes (a run
   *  starts from this now) */
  const setStart = (data: Uint8Array | null, src: ScriptPadSource | null) => {
    if (!pad) return;
    const { bytes: _b, data: _d, src: _s, ...keep } = pad;
    onEdit(script.id, { pads: script.pads.map((x, k) => (k === pi ? { ...keep, ...(data ? { data } : {}), ...(src ? { src } : {}) } : x)) },
      data ? `Set what scratchpad ${pad.name} starts with` : `Clear what scratchpad ${pad.name} starts with`);
    setEditing(null);
  };
  const byAddr = useMemo(() => { const m = new Map<number, string>(); for (const [n, a] of names) if (!m.has(a)) m.set(a, n); return m; }, [names]);
  // the bytes the last step changed: their rows of the hex written with the bytes marked
  const before = now?.before && now.before.length === now.bytes.length ? now.before : null;
  const marked = useMemo(() => {
    if (!bytes || !before || showAs !== 'hex' || !bytes.some((b, i) => b !== before[i])) return null;
    const per = wide ? 16 : 8, out: React.ReactNode[] = [];
    for (let i = 0; i < bytes.length; i += per) {
      const row = Array.from(bytes.subarray(i, i + per)), chars = row.map(b => monitorChar(b, screen)?.ch ?? '.').join('');
      if (!row.some((b, j) => b !== before[i + j])) { out.push(`${$(at + i)}  ${row.map(b => h2(b)).join(' ').padEnd(per * 3 - 1)}  ${chars}\n`); continue; }
      out.push(<span key={i}>{`${$(at + i)}  `}{row.flatMap((b, j) => [j ? ' ' : '', <span key={j} className={b !== before[i + j] ? 'pad-chg' : undefined}>{h2(b)}</span>])}{' '.repeat(per * 3 - 1 - (row.length * 3 - 1))}{`  ${chars}\n`}</span>);
    }
    return out;
  }, [bytes, before, at, showAs, screen, wide]);
  const text = useMemo(() => {
    if (!bytes || showAs === 'compare') return '';
    const out: string[] = [];
    if (showAs === 'code') for (const l of disassembleBytes(bytes, at, byAddr)) out.push(`${$(l.a)}  ${Array.from(bytes.subarray(l.a - at, l.a - at + l.n), b => h2(b)).join(' ').padEnd(9)} ${byAddr.has(l.a) ? `${byAddr.get(l.a)}: ` : ''}${l.text}`);
    else {
      const per = showAs === 'hex' ? (wide ? 16 : 8) : 32;
      for (let i = 0; i < bytes.length; i += per) {
        const row = Array.from(bytes.subarray(i, i + per));
        const chars = row.map(b => monitorChar(b, screen)?.ch ?? '.').join('');
        out.push(showAs === 'hex' ? `${$(at + i)}  ${row.map(b => h2(b)).join(' ').padEnd(per * 3 - 1)}  ${chars}` : `${$(at + i)}  ${chars}`);
      }
    }
    return out.join('\n');
  }, [bytes, at, showAs, screen, byAddr, wide]);
  // the editor is for the scratchpad it was opened on
  const isEditing = !!pad && editing === `${script.id}/${pi}`;
  if (!pad && !patch) return <div className="scr-view" ref={setView}><p className="scr-empty scr-view-empty">{empty}</p></div>;
  const title = patch ? `${patch.name} · ${rangeText({ start: patch.start, end: patchEnd(patch) })} · ${plural(patch.bytes.length, 'byte')}${patch.off ? ' · left out' : ''}` : `${pad!.name} · ${rangeText({ start: pad!.start, end: pad!.start + pad!.size })} · ${pad!.size} bytes`;
  const fileName = `${script.name}_${patch ? h4(patch.start) : pad!.name}`.replace(/[^A-Za-z0-9_.-]+/g, '_');
  const differ = patch ? patch.bytes.reduce((n, b, i) => n + (b !== patch.old[i] ? 1 : 0), 0) : 0;
  return (
    <div className="scr-view" ref={setView}>
      <div className="scr-view-head">
        <b className="scr-view-title">{title}</b>
        {now && <span className="pill mid scr-live" title="Debugging: the scratchpad as the run has it now; what the last step changed is marked in the hex">now, as the run has it</span>}
        {preview && <span className="pill scr-live scr-would-pill" title="Safe mode: the last run would write these bytes here; the program still has its own (Write into the program puts these in)"><Icon name="shield" size={11} />would change: not in the program</span>}
        {patch && <span className="muted small" title={`The program had: ${Array.from(patch.old.subarray(0, 64), b => h2(b)).join(' ')}${patch.old.length > 64 ? ' …' : ''}`}>{differ} differ from the original</span>}
        {atStart && !isEditing && <span className="pill scr-start-pill" title={pad!.data?.length ? `What a run starts it with: ${pad!.data.length} bytes set (Edit), the rest its fill. It has not run since` : 'What a run starts it with: its fill (Edit sets what it holds)'}>at the start{pad!.data?.length ? ` · ${pad!.data.length} set` : ''}</span>}
        <span className="grow" />
        {isEditing ? <span className="pill mid scr-edit-pill">editing the start</span> : <>
          {pad && <button className="btn small ghost scr-pad-edit-btn" onClick={() => setEditing(`${script.id}/${pi}`)} title="Set what the scratchpad holds when a run starts: Kick Assembler (code and data), hex or text"><Icon name="pencil" size={13} /><span className="lbl">Edit start</span></button>}
          <div className="seg" role="group" aria-label="Show as">
            {(['hex', 'code', 'text', ...(pad ? ['compare' as const] : [])] as const).map(m => <button key={m} className={cx(showAs === m && 'on')} aria-pressed={showAs === m} onClick={() => onMode(m)}
              title={m === 'compare' ? 'Set the scratchpad against another one, or against what a run starts it with: a heat map shows where the bytes differ' : undefined}>{m === 'hex' ? 'Hex' : m === 'code' ? 'Code' : m === 'text' ? 'Text' : 'Compare'}</button>)}
          </div>
          {showAs === 'compare' ? <select className="scr-cmp-with" aria-label="Compare with" value={vs} onChange={e => set({ cmpWith: e.target.value })} title="What the scratchpad is set against">
            {others.map(p => <option key={p.name} value={p.name}>with {p.name}</option>)}
            <option value="@start">with its start</option>
          </select>
            : showAs !== 'code' && <div className="seg" role="group" aria-label="Text as"><button className={cx(!screen && 'on')} aria-pressed={!screen} onClick={() => onScreen(false)} title="The bytes as PETSCII">PETSCII</button><button className={cx(screen && 'on')} aria-pressed={screen} onClick={() => onScreen(true)} title="The bytes as screen codes">Screen</button></div>}
        </>}
      </div>
      {isEditing ? <PadEditor key={`${script.id}/${pi}`} pad={pad!} names={names} onSet={setStart} onCancel={() => setEditing(null)} />
        : showAs === 'compare' && bytes && vsBytes ? <PadCompare a={bytes} b={vsBytes} aName={pad!.name} bName={vsPad ? vsPad.name : 'start'} at={at} theme={theme} />
        : bytes ? <pre className="scr-dump mono" aria-label={`${title} as ${showAs}`}>{marked ?? text}</pre>
        : <p className="scr-empty scr-view-empty">Empty until the script runs: Run fills it.</p>}
      {bytes && !isEditing && <div className="scr-view-actions">
        <button className="btn small" onClick={() => onCopy(byteLines(bytes).join('\n'), `${bytes.length} bytes as .byte lines`)} title="Copy the bytes as Kick Assembler .byte lines"><Icon name="copy" size={13} /><span className="lbl">Copy as .byte</span></button>
        {patch ? <>
          <span className="grow" />
          <button className="btn small" onClick={() => onShow(patch.start, patchEnd(patch))} title="Select these bytes in the listing"><Icon name="target" size={13} /><span className="lbl">Show in listing</span></button>
        </> : <>
          <button className="btn small scr-copy-to" onClick={e => {
            if (!others.length) { copyTo(null); return; }
            const r = e.currentTarget.getBoundingClientRect();
            onMenu(r.left, r.bottom + 2, [
              { header: `Copy ${pad!.name} to` },
              ...script.pads.flatMap((p, j): MenuItem[] => (p === pad ? [] : [{ label: `${p.name} ($${h4(p.start)}, ${p.size} bytes)${p.size < bytes.length ? ': only its first bytes' : ''}`, run: () => copyTo(j) }])),
              { sep: true },
              { label: 'A new scratchpad (a copy)', run: () => copyTo(null) },
            ]);
          }} title={others.length ? 'Copy these bytes to another scratchpad, or to a new one: a run starts it with them' : 'Copy these bytes to a new scratchpad: a run starts it with them'}><Icon name="copy" size={13} /><span className="lbl">{others.length ? 'Copy to…' : 'Copy to a new pad'}</span></button>
          <span className="grow" />
          {showAs !== 'compare' && <button className="btn small" onClick={() => onSaveText(`${fileName}.txt`, showAs === 'text' ? logText(bytes, pad!.fill ?? 0, screen) : text + '\n')}
            title={showAs === 'text' ? `Save the text as a log file: ${screen ? 'screen codes, 40 to a line' : 'PETSCII, a line to each RETURN ($0d)'}, without the fill after it` : `Save what is shown (${showAs === 'hex' ? 'the hex dump' : 'the code'}) as a text file`}><Icon name="download" size={13} /><span className="lbl">Save </span>.txt…</button>}
          <button className="btn small" onClick={() => onSave(`${fileName}.bin`, bytes, false, at)} title="Save the bytes as a binary file"><Icon name="download" size={13} /><span className="lbl">Save </span>.bin…</button>
          <button className="btn small" onClick={() => onSave(`${fileName}.prg`, bytes, true, at)} title={`Save the bytes as a PRG that loads at $${h4(at)}`}><Icon name="download" size={13} /><span className="lbl">Save </span>.prg…</button>
        </>}
      </div>}
    </div>
  );
}
