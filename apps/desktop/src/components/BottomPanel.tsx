/* Bottom panel: analysis log, problems, cross-references, raster IRQs, relocated blocks, the Spindle script, a Bitfire
 * disk's files, the BoozeLoader script, a Sparkle disk's bundles, Pirate Slayer on the mounted disk, the tape in the
 * datasette, statistics, build output. */
import {
  BITFIRE_VERSION, bitfireFileName, BOOZE_CRUNCHER, PIRATESLAYER_SIGNATURE, pirateSlayerFileList, pirateSlayerFileName, tapeToolScript, boozeFileList, boozeFileName, boozeLine, boozeScript, d64writeScript, decode, goneCounts, h2, h4, hwSymbol, kickMnemonic, lineText, OPC, PROBLEM_CODES, sparkleChunkName, sparkleScript, spinChunkName, spindleCondition, spindleLabel, spindleName, spindleRoutines, spindleScript, spinScript,
  type Addr, type AnalysisResult, type BitfireFile, type BoozeFile, type BoozeStep, type CartBuild, type DeepReport, type PirateSlayerFile, type RasterIrq, type Reloc, type RenderResult, type Settings, type SparkleBundle, type SparkleChunk, type SpindleChunk, type SpindleDriver, type SpindleJob, type TapeFile, type TapeUnknown,
} from '@mimir/core';
import { Icon, LVL_ICON } from '../lib/icons';
import { cx, fmtBytes, GROUP_LABEL, GROUP_ORDER, groupOfType } from '../lib/util';
import type { BottomTab } from '../store/ui';
import type { BuildState, MountedDisk, MountedTape, UiProblem } from '../lib/types';
import type { TypeGroup } from '@mimir/core';

export function LogList({ items, onNavigate, empty }: { items: UiProblem[]; onNavigate: (a: Addr) => void; empty: string }) {
  if (!items.length) return <div className="empty">{empty}</div>;
  return (
    <div className="loglist">
      {items.map((l, i) => (
        <div key={i} className={cx('logrow', `lvl-${l.lvl}`)}>
          <Icon name={LVL_ICON[l.lvl] || 'info'} size={14} className="lvl-icon" />
          <span className="log-cat" title={l.code ? `${l.code}: ${PROBLEM_CODES[l.code]}` : undefined}>{l.cat}</span>
          <span className="log-msg">{l.msg}</span>
          {l.action && <button className="btn small primary log-action" onClick={l.action.run}>{l.action.label}</button>}
          {l.addr != null && <button className="addr-link" onClick={() => onNavigate(l.addr!)}>${h4(l.addr)}</button>}
        </div>
      ))}
    </div>
  );
}

/** The Problems tab: the deep analysis (on or off, and what it did) over the list. */
export function ProblemsPanel({ items, onNavigate, deep, on, busy, deepBusy = false, onDeep }: { items: UiProblem[]; onNavigate: (a: Addr) => void; deep: DeepReport | null; on: boolean; busy: boolean; /** the deep analysis is still running: the problems listed are the normal one's */ deepBusy?: boolean; onDeep: (on: boolean) => void }) {
  const s = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;
  // the problems gone: solved (the code read right) or decided on a guess (8.11e)
  const gone = (d: DeepReport) => { const c = goneCounts(d); return c.solved + c.decided + c.other ? `: ${c.solved} solved, ${c.decided} decided${c.other ? `, ${c.other} other` : ''}` : ''; };
  return (
    <>
      <div className="problems-head">
        <label className="check" title="On for new projects. The normal analysis shows at once and the deep one takes its place when it is done: it traces guesses on trial (an interrupt handler without the side of a branch that runs into a problem), follows branches as the flags before them decide, does not follow calls into ROM, and analyses again until it decides the same">
          <input type="checkbox" checked={on} onChange={e => onDeep(e.target.checked)} aria-label="Deep analysis" /><span>Deep analysis</span>
        </label>
        <span className="muted small" role="status" aria-label="Deep analysis result" title={on && deep ? 'Of the problems the normal analysis has and the deep one does not: solved, the code read right (a side of a branch the flags never take, a call into ROM, an indirect jump whose target is found …); decided, on a guess (a guess traced on trial and left out or kept, a side left out for an interrupt handler …)' : undefined}>
          {on && deep && !deepBusy ? `${deep.before} → ${s(deep.after, 'problem')} in ${s(deep.rounds, 'round')}, ${(deep.ms / 1000).toFixed(1)} s${gone(deep)} · the Log tells what it left out`
            : on ? (busy ? 'Analysing…' : deepBusy ? 'Deep analysis running · the normal analysis shows meanwhile' : '')
              : 'Slower: tests every guess and analyses again until the problems are at a minimum'}
        </span>
      </div>
      <LogList items={items} onNavigate={onNavigate} empty="No problems found." />
    </>
  );
}

const XREF_KIND: Record<string, string> = { call: 'call', jump: 'jump', branch: 'branch', read: 'read', write: 'write', rmw: 'read+write', ptr: 'pointer' };

export function XrefPanel({ A, R, cursor, onNavigate, S }: { A: AnalysisResult; R: RenderResult; cursor: Addr | null; onNavigate: (a: Addr) => void; S: Settings }) {
  if (cursor == null) return <div className="empty">Place the cursor on a line to see who references it.</div>;
  const ins = A.insLen[cursor] ? cursor : A.codeOwner[cursor] >= 0 ? A.codeOwner[cursor] : cursor;
  const label = R.labels.get(ins);
  const to = (A.xrefs.get(ins) || []).slice().sort((x, y) => x.from - y.from);
  const text = (a: Addr) => { const l = R.lines.find(x => x.a === a && (x.k === 'ins' || x.k === 'dat')); return l ? lineText(l, S).trim().replace(/\s+\/\/.*$/, '') : ''; };
  const outgoing: Addr[] = [];
  if (A.insLen[ins]) { const d = decode(A.mem, ins); if (d.target != null) outgoing.push(d.target); }
  return (
    <div className="xref">
      <div className="xref-head">References to <b className="mono">{label ? label.name : '$' + h4(ins)}</b> <span className="muted">(${h4(ins)})</span> — {to.length}</div>
      {to.length ? (
        <table className="tbl"><thead><tr><th>From</th><th>Kind</th><th>Instruction</th></tr></thead><tbody>
          {to.map((x, i) => <tr key={i} onClick={() => onNavigate(x.from)}><td className="mono link-cell">${h4(x.from)}</td><td><span className={cx('kind', `kind-${x.kind}`)}>{XREF_KIND[x.kind] || x.kind}</span></td><td className="mono">{text(x.from)}</td></tr>)}
        </tbody></table>
      ) : <div className="empty small">No references. Entry points, vectors and data reached only through computed addresses have none.</div>}
      {outgoing.length > 0 && <div className="xref-out">This instruction targets <button className="addr-link" onClick={() => onNavigate(outgoing[0])}>${h4(outgoing[0])}</button>{R.labels.get(outgoing[0]) ? <span className="mono"> {R.labels.get(outgoing[0])!.name}</span> : (hwSymbol(outgoing[0]) ? <span className="mono syn-hw"> {hwSymbol(outgoing[0])!.text}</span> : null)}</div>}
    </div>
  );
}

/** Every IRQ handler with the raster line it runs at (spec 8.11d), by line; a row goes to its handler. */
export function RasterPanel({ A, R, onNavigate }: { A: AnalysisResult; R: RenderResult; onNavigate: (a: Addr) => void }) {
  if (!A.raster.length) return <div className="empty">No IRQ handlers found: the trace finds them where the code sets $0314 or $fffe, and in a snapshot where its vectors point.</div>;
  const link = (a: Addr | null) => a == null ? <span className="muted">—</span>
    : <button className="addr-link" title={`$${h4(a)}`} onClick={e => { e.stopPropagation(); onNavigate(a); }}>{R.labels.get(a)?.name ?? `$${h4(a)}`}</button>;
  const d011 = (r: RasterIrq) => !r.d011 ? '—' : r.d011.value != null ? `$${h2(r.d011.value)}` : r.d011.bit8 != null ? `bit 7 = ${r.d011.bit8}` : '?';
  const handlers = new Set(A.raster.map(r => r.handler)).size;
  return (
    <div className="xref raster">
      <div className="xref-head">{A.raster.length} raster interrupt{A.raster.length === 1 ? '' : 's'}, {handlers} handler{handlers === 1 ? '' : 's'} <span className="muted">· the line is $d012 with bit 7 of $d011 as bit 8 (0 where $d011 is not written)</span></div>
      <table className="tbl" aria-label="Raster IRQs"><thead><tr><th>Line</th><th>$d012</th><th>$d011</th><th>Handler</th><th>Set at</th><th>By</th></tr></thead><tbody>
        {A.raster.map((r, i) => (
          <tr key={i} onClick={() => onNavigate(r.handler)}>
            <td className="mono">{r.line != null ? `${r.line} ($${r.line.toString(16).padStart(3, '0')})` : '?'}</td>
            <td className="mono">{r.d012 != null ? `$${h2(r.d012)}` : r.setAt != null ? '?' : '—'}</td>
            <td className="mono">{d011(r)}</td>
            <td className="mono">{link(r.handler)}</td>
            <td className="mono">{link(r.setAt ?? r.installedAt)}</td>
            <td>{r.from == null ? (r.installedAt == null ? <span className="muted">no line found</span> : 'main code') : r.from === r.handler && r.installedAt == null ? 'itself' : link(r.from)}{r.vector != null && <span className="muted"> via ${h4(r.vector)}</span>}</td>
          </tr>
        ))}
      </tbody></table>
    </div>
  );
}

interface RelocPanelProps {
  A: AnalysisResult; R: RenderResult;
  /** the project's relocated blocks: those the analysis could not place are listed with why */
  relocs: readonly Reloc[];
  onNavigate: (a: Addr) => void;
  /** open the Relocate dialog: for these bytes (on a relocated block: where it runs), or for a copy loop's store */
  onRelocate: (range: { start: Addr; end: Addr } | null, copyAt?: Addr) => void;
  onUnrelocate: (start: Addr) => void;
}

/** The Relocated tab (spec 8.1b): the blocks the program copies elsewhere to run there, where each is loaded and runs,
 *  and the copy loops the analysis found that are not relocated yet, each with what can be done about it. */
export function RelocPanel({ A, R, relocs, onNavigate, onRelocate, onUnrelocate }: RelocPanelProps) {
  const span = (s: Addr, e: Addr) => `$${h4(s)}–$${h4(e - 1)}`;
  const link = (a: Addr, text?: string) => <button className="addr-link" title={`$${h4(a)}`} onClick={e => { e.stopPropagation(); onNavigate(a); }}>{text ?? R.labels.get(a)?.name ?? `$${h4(a)}`}</button>;
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();
  // those in the project the analysis did not place: the log says why
  const left = relocs.filter(r => !A.relocs.some(x => x.start === r.start));
  const why = (r: Reloc) => A.log.find(l => l.code === 'reloc-unplaced' && l.addr === r.start)?.msg.replace(/^.*? is not placed: /, '') ?? 'it is not placed';
  const n = A.relocs.length + left.length;
  return (
    <div className="xref relocs">
      <div className="xref-head">{n} relocated block{n === 1 ? '' : 's'}{A.copies.length ? `, ${A.copies.length} copy loop${A.copies.length === 1 ? '' : 's'} found` : ''}
        <span className="muted"> · bytes the program copies elsewhere to run there: read where they run, written where they are loaded inside .pseudopc</span>
        <button className="btn small reloc-new" onClick={() => onRelocate(null)} title="Relocate the selection, or the block at the cursor (R)">Relocate…</button></div>
      {n > 0 ? (
        <table className="tbl" aria-label="Relocated blocks"><thead><tr><th>Block</th><th>Loaded at</th><th>Runs at</th><th>Bytes</th><th>File</th><th /></tr></thead><tbody>
          {A.relocs.map(r => (
            <tr key={r.start} onClick={() => onNavigate(r.to)}>
              <td className="mono">{link(r.start)}</td>
              <td className="mono">{span(r.start, r.end)}</td>
              <td className="mono">{link(r.to, span(r.to, r.to + r.end - r.start))}</td>
              <td className="mono">{r.end - r.start}</td>
              <td>{A.files[r.file]?.name ?? '—'}</td>
              <td className="row-actions" onClick={stop}>
                <button className="btn small" onClick={() => onRelocate({ start: r.start, end: r.end })} title="Give another address it runs at">Runs at…</button>
                <button className="btn small ghost" onClick={() => onUnrelocate(r.start)} title="Read the bytes where they are loaded again; names and comments go back with them">Stop relocating</button>
              </td>
            </tr>
          ))}
          {left.map(r => (
            <tr key={`left-${r.start}`} className="not-placed" onClick={() => onNavigate(r.start)}>
              <td className="mono">${h4(r.start)}</td>
              <td className="mono">{span(r.start, r.end)}</td>
              <td className="mono">{span(r.to, r.to + r.end - r.start)}</td>
              <td className="mono">{r.end - r.start}</td>
              <td className="warn-text">not placed: {why(r)}</td>
              <td className="row-actions" onClick={stop}><button className="btn small ghost" onClick={() => onUnrelocate(r.start)}>Stop relocating</button></td>
            </tr>
          ))}
        </tbody></table>
      ) : <div className="empty small">Nothing is relocated. Select the bytes a program copies to another address before it runs them there, and press R: the analysis then reads them where they run.</div>}
      {A.copies.length > 0 && <>
        <div className="xref-head reloc-copies">Copy loops found <span className="muted">· a loop copies code where nothing is loaded, and the program jumps there</span></div>
        <table className="tbl" aria-label="Copy loops found"><thead><tr><th>Loop</th><th>Copies</th><th>To</th><th>Goes there</th><th /></tr></thead><tbody>
          {A.copies.map(c => {
            const other = A.relocs.find(r => r.start === c.start);
            return (
              <tr key={c.at} onClick={() => onNavigate(c.loop)}>
                <td className="mono">{link(c.loop)}</td>
                <td className="mono">{link(c.start, span(c.start, c.end))}</td>
                <td className="mono">{span(c.to, c.to + c.end - c.start)}{other && <span className="muted"> · relocated to run at ${h4(other.to)}</span>}</td>
                <td className="mono">{OPC[A.mem[c.jump]].mn.toLowerCase()} at {link(c.jump, `$${h4(c.jump)}`)}</td>
                <td className="row-actions" onClick={stop}><button className="btn small" onClick={() => onRelocate(null, c.at)} title={`Relocate ${span(c.start, c.end)} to run at $${h4(c.to)}`}>{other ? 'Run it there…' : 'Relocate…'}</button></td>
              </tr>);
          })}
        </tbody></table>
      </>}
    </div>
  );
}

interface SpindlePanelProps {
  A: AnalysisResult; R: RenderResult;
  /** the mounted disk: its load script when it is a Spindle 3 disk */
  disk: MountedDisk | null;
  onNavigate: (a: Addr) => void; onCopy: (text: string, what: string) => void;
  /** open a job's chunk as a PRG (`add`: add it to the project) */
  onOpenChunk: (j: SpindleJob, c: SpindleChunk, add: boolean) => void;
}

/** The Spindle script tab: a mounted Spindle 3 disk's load script (Spin's jobs), and the effect drivers in memory. */
export function SpindlePanel({ A, R, disk, onNavigate, onCopy, onOpenChunk }: SpindlePanelProps) {
  if (!A.spindle.length && !disk?.spindle) return <div className="empty">No Spindle script: a Spindle 3 disk holds the jobs its load script lists, and a VICE snapshot of a trackmo linked with Pefchain holds its effect drivers.</div>;
  return (
    <>
      {disk?.spindle && <SpinDiskSection disk={disk} onCopy={onCopy} onOpenChunk={onOpenChunk} />}
      {A.spindle.length > 0 && <DriversSection A={A} R={R} onNavigate={onNavigate} onCopy={onCopy} />}
    </>
  );
}

/** A Spindle 3 disk's jobs (spec 13.5b), a row per chunk; a row opens the chunk as a PRG at its address, + adds it. */
function SpinDiskSection({ disk, onCopy, onOpenChunk }: { disk: MountedDisk; onCopy: (text: string, what: string) => void; onOpenChunk: (j: SpindleJob, c: SpindleChunk, add: boolean) => void }) {
  const d = disk.spindle!;
  const chunks = d.jobs.reduce((n, j) => n + j.chunks.length, 0);
  const notes = (j: SpindleJob) => [j.jump != null && `then jumps to $${h4(j.jump)}`, j.shadow && 'loads under I/O', j.missing > 0 && `${j.missing} bytes could not be decrunched`].filter(Boolean).join(' · ');
  return (
    <div className="xref spindle">
      <div className="xref-head spindle-head">
        <span>Load script of {disk.name} (Spin, Spindle 3): {d.jobs.length} job{d.jobs.length === 1 ? '' : 's'}, {chunks} chunk{chunks === 1 ? '' : 's'} <span className="muted">· a job is a loader call{d.start != null ? `; after job 1 the boot program goes to $${h4(d.start)}` : ''}{d.next != null ? '; then the next disk side' : ''}; the file names are not on the disk</span></span>
        <button className="btn small" onClick={() => onCopy(spinScript(d, disk.name).join('\n'), 'Copied the load script')}><Icon name="copy" size={14} />Copy script</button>
      </div>
      <table className="tbl" aria-label="Spindle load script"><thead><tr><th>Job</th><th>Loads</th><th>Bytes</th><th>File</th><th>Notes</th><th /></tr></thead><tbody>
        {d.jobs.flatMap(j => j.chunks.map((c, k) => {
          const name = spinChunkName(j, c);
          return (
            <tr key={`${j.n}-${c.start}`} className={cx(k === 0 && 'job-first')} title={`Open ${name} as a PRG at $${h4(c.start)}`} onClick={() => onOpenChunk(j, c, false)}>
              <td className="mono">{k === 0 && <>{j.n}{j.labels.map(l => <span key={l} className="pill">{h2(l)}:</span>)}</>}</td>
              <td className="mono">${h4(c.start)}–${h4(c.end - 1)}</td>
              <td className="mono">{c.end - c.start}</td>
              <td className="mono">{name}</td>
              <td className="muted">{k === 0 && notes(j)}</td>
              <td><button className="icon-btn" title={`Add ${name} to this project`} aria-label={`Add ${name} to this project`} onClick={e => { e.stopPropagation(); onOpenChunk(j, c, true); }}><Icon name="plus" size={13} /></button></td>
            </tr>
          );
        }))}
      </tbody></table>
    </div>
  );
}

/** The Bitfire script tab (spec 13.5c): a Bitfire disk's own files, a row each, in the order d64write wrote them (and
 *  the loader loads them); a row opens the file as a PRG, unpacked when it is packed (bitnax for 0.x, else dali), +
 *  adds it. */
export function BitfirePanel({ disk, onCopy, onOpenFile }: { disk: MountedDisk; onCopy: (text: string, what: string) => void; onOpenFile: (f: BitfireFile, add: boolean) => void }) {
  const d = disk.bitfire!;
  const unpacked = d.files.filter(f => f.unpacked).length, n = d.files.length, packer = d.format === '0.x' ? 'bitnax' : 'dali';
  // what the disk's own directory holds: the boot program and other files (and a dirart)
  const inDir = [d.boot != null ? 'the boot program' : '', d.standard.length ? `${d.standard.length} other file${d.standard.length === 1 ? '' : 's'}` : ''].filter(Boolean);
  const dirText = inDir.length ? `; ${inDir.join(' and ')} ${inDir.length > 1 || d.standard.length > 1 ? 'are' : 'is'} in the directory${d.dirart ? `, a dirart of ${d.dirart} lines` : ''}` : '';
  const notes = (f: BitfireFile) => [
    f.unpacked ? `packed with ${packer}${f.unpacked.inplace ? ', in place' : ''}` : d.format === '0.x' ? 'not packed (or bitnax copying from memory before it): as it is on the disk' : 'not packed',
    `from ${f.track}/${f.sector}${f.offset ? ` byte ${f.offset}` : ''}`,
  ].join(' · ');
  return (
    <div className="xref spindle">
      <div className="xref-head spindle-head">
        <span>Files of {disk.name} ({BITFIRE_VERSION[d.format]}{d.oldBitnax ? ', packed as in 2014–2015' : ''}, side {d.side}): {n} file{n === 1 ? '' : 's'}{unpacked ? `, ${unpacked} unpacked` : ''} <span className="muted">· Bitfire has no load script: a part loads the next file or one by its number, so this is the order they load in; d64write's command line rebuilds the disk{dirText}; the file names are not on the disk</span></span>
        <button className="btn small" onClick={() => onCopy(d64writeScript(d, disk.name).join('\n'), 'Copied the d64write command line')}><Icon name="copy" size={14} />Copy script</button>
      </div>
      <table className="tbl" aria-label="Bitfire files"><thead><tr><th>File</th><th>Loads</th><th>Unpacks to</th><th>Bytes</th><th>Name</th><th>Notes</th><th /></tr></thead><tbody>
        {d.files.map(f => {
          const name = bitfireFileName(f), u = f.unpacked;
          return (
            <tr key={f.n} title={u ? `Open ${name} unpacked, as a PRG at $${h4(u.start)}` : `Open ${name} as a PRG at $${h4(f.load)}, as it loads`} onClick={() => onOpenFile(f, false)}>
              <td className="mono">${h2(f.n)}</td>
              <td className="mono">${h4(f.load)}–${h4(f.end - 1)}</td>
              <td className="mono">{u ? `$${h4(u.start)}–$${h4(u.end - 1)}` : <span className="muted">—</span>}</td>
              <td className="mono">{u ? `${f.bytes.length} → ${u.end - u.start}` : f.bytes.length}</td>
              <td className="mono">{name}</td>
              <td className="muted">{notes(f)}</td>
              <td><button className="icon-btn" title={`Add ${name} to this project`} aria-label={`Add ${name} to this project`} onClick={e => { e.stopPropagation(); onOpenFile(f, true); }}><Icon name="plus" size={13} /></button></td>
            </tr>
          );
        })}
      </tbody></table>
    </div>
  );
}

/** The Sparkle script tab (spec 13.5i): a Sparkle disk's bundles, the files each loader call loads, a row per chunk
 *  in the order they load; a row opens the chunk as a PRG at its address, + adds it. Copy script gives the loader
 *  script rebuilt from the disk, Save files… every chunk as a PRG with that script. */
export function SparklePanel({ disk, onCopy, onOpenChunk, onSaveFiles }: { disk: MountedDisk; onCopy: (text: string, what: string) => void; onOpenChunk: (b: SparkleBundle, c: SparkleChunk, add: boolean) => void; onSaveFiles: () => void }) {
  const d = disk.sparkle!;
  const chunks = d.bundles.reduce((n, b) => n + b.chunks.length, 0);
  const send = d.api?.send;
  const how = d.api
    ? `a part loads the next bundle with jsr $${h4(d.api.next)}${send == null ? '' : d.indexed ? `, or picks one by its number first (lda #number / jsr $${h4(send)}; the drive's directory in 18/17 has every bundle)` : `; lda #number / jsr $${h4(send)} first picks one from the drive's directory in 18/17`}`
    : 'the loader loads them in this order';
  const notes = (b: SparkleBundle, c: SparkleChunk, k: number) => [
    k === 0 && `from ${b.track}/${b.sector}, ${b.blocks ? `${b.blocks} block${b.blocks === 1 ? '' : 's'}` : 'in the block before it'}`,
    k === 0 && b.n === 0 && d.start != null && `the boot program goes to $${h4(d.start)} after it`,
    c.io && 'under the I/O area',
    k === 0 && b.missing > 0 && `${b.missing} bytes could not be unpacked`,
  ].filter(Boolean).join(' · ');
  return (
    <div className="xref spindle">
      <div className="xref-head spindle-head">
        <span>Bundles of {disk.name} (Sparkle{d.side != null ? `, side ${d.side}` : ''}): {d.bundles.length} bundle{d.bundles.length === 1 ? '' : 's'}, {chunks} file{chunks === 1 ? '' : 's'} <span className="muted">· a bundle is a loader call: {how}; interleave {d.il.join(', ')}{d.next != null ? `; then side ${d.next}` : ''}{d.complete ? '' : '; the last bundle of the side did not unpack (its last block counts on one more, where the blocks are not Sparkle blocks)'}; the file names are not on the disk</span></span>
        <button className="btn small" onClick={() => onCopy(sparkleScript(d, disk.name).join('\n'), 'Copied the loader script')}><Icon name="copy" size={14} />Copy script</button>
        <button className="btn small" onClick={onSaveFiles} title="Save every bundle's files as PRGs to a folder, with the loader script that loads them"><Icon name="download" size={14} />Save files…</button>
      </div>
      <table className="tbl" aria-label="Sparkle bundles"><thead><tr><th>Bundle</th><th>Loads</th><th>Bytes</th><th>File</th><th>Notes</th><th /></tr></thead><tbody>
        {d.bundles.flatMap(b => b.chunks.map((c, k) => {
          const name = sparkleChunkName(b, c);
          return (
            <tr key={`${b.n}-${c.start}`} className={cx(k === 0 && 'job-first')} title={`Open ${name} as a PRG at $${h4(c.start)}`} onClick={() => onOpenChunk(b, c, false)}>
              <td className="mono">{k === 0 && `$${h2(b.n)}`}</td>
              <td className="mono">${h4(c.start)}–${h4(c.end - 1)}</td>
              <td className="mono">{c.end - c.start}</td>
              <td className="mono">{name}</td>
              <td className="muted">{notes(b, c, k)}</td>
              <td><button className="icon-btn" title={`Add ${name} to this project`} aria-label={`Add ${name} to this project`} onClick={e => { e.stopPropagation(); onOpenChunk(b, c, true); }}><Icon name="plus" size={13} /></button></td>
            </tr>
          );
        }))}
      </tbody></table>
    </div>
  );
}

/** The Pirate Slayer tab (spec 13.5h): Electronic Arts' copy protection on the mounted disk: its key track (on a G64:
 *  where, how framed, each copy a turn), the boot and what it does, where the drive's check is, the boot's text, and
 *  the files outside the directory, a row each: a row opens the file as a PRG at its load address, decoded; + adds it.
 *  Save files… saves them all, decoded, with files.txt that lists them; Copy list copies that list. */
export function PirateSlayerPanel({ disk, onCopy, onOpenFile, onSaveFiles }: { disk: MountedDisk; onCopy: (text: string, what: string) => void; onOpenFile: (f: PirateSlayerFile, add: boolean) => void; onSaveFiles: () => void }) {
  const p = disk.pirateslayer!;
  const hex = (v: number) => v.toString(16).toUpperCase().padStart(2, '0');
  const keys = [...new Set(p.files.filter(f => f.key).map(f => `$${hex(f.key)}`))];
  return (
    <div className="xref spindle">
      <div className="xref-head spindle-head">
        <span>{p.summary} <span className="muted">· Sindri runs the boot with {disk.name} in its drive{p.format === 'G64' ? ', key track and all' : ''}; Build &amp; Run puts a copy in VICE's drive 8 with the files built from it written back{p.format === 'D64' ? '. A D64 has no key track, so the boot fails its check: mount the G64' : ''}</span></span>
      </div>
      {p.keys.length > 0 && (
        <table className="tbl" aria-label="Pirate Slayer key"><thead><tr><th>Track</th><th>Looks for</th><th>SYNCs</th><th>Framed from</th><th>Copies a turn</th></tr></thead><tbody>
          {p.keys.map(k => (
            <tr key={k.track}>
              <td className="mono">{k.track}</td>
              <td className="mono">{k.pattern.map(hex).join(' ')}</td>
              <td className="mono">{k.syncs}</td>
              <td className="mono">bit {k.bitPhase}</td>
              <td className="muted">{k.copies.map(c => c.pairs ? `${c.d7} × D7, EB, ${c.pairs} × CC AD${c.signature ? ', the 12 bytes' : ' (cut short)'}` : 'found').join(' · ')}</td>
            </tr>
          ))}
        </tbody></table>
      )}
      <div className="ps-notes">
        {p.boot && <p><b>Boot ({p.boot.files.join(' → ')}):</b> {p.boot.how}</p>}
        {p.checkIn.length > 0 && <p><b>The drive's check</b> is in {p.checkIn.join(', ')}, not encrypted.</p>}
        {p.text && <p><b>Its text:</b> <span className="mono">{p.text}</span></p>}
        {p.keys.length > 0 && <p className="muted">The key track has no SYNC: the drive frames its bytes wherever its bit counter is, and that moves on with every turn of a real disk, so the check reads for a turn where they line up ({PIRATESLAYER_SIGNATURE.map(hex).join(' ')} last). Sindri's drive slips a bit each turn on such a track to do the same.</p>}
      </div>
      {p.files.length > 0 && <>
        <div className="xref-head spindle-head">
          <span>Files outside the directory: {p.files.length} <span className="muted">· sector chains EA&apos;s loader reads by track and sector, the load address first{keys.length ? `; stored XOR ${keys.join(' and ')} on the disk, which the loader's transfer undoes: they open decoded` : ''}; the names are made up of the first sector and the load address</span></span>
          <button className="btn small" onClick={() => onCopy(pirateSlayerFileList(p, disk.name).join('\n'), 'Copied the file list')}><Icon name="copy" size={14} />Copy list</button>
          <button className="btn small" onClick={onSaveFiles} title="Save every file outside the directory as a PRG to a folder, decoded, with files.txt that lists them"><Icon name="download" size={14} />Save files…</button>
        </div>
        <table className="tbl ps-files" aria-label="Pirate Slayer files"><thead><tr><th>From</th><th>Blocks</th><th>Loads</th><th>Bytes</th><th>Name</th><th>Notes</th><th /></tr></thead><tbody>
          {p.files.map(f => {
            const name = pirateSlayerFileName(f), past = f.load + f.bytes.length - f.end;
            return (
              <tr key={`${f.track}/${f.sector}`} title={`Open ${name} as a PRG at $${h4(f.load)}${f.key ? `, decoded (XOR $${hex(f.key)})` : ''}`} onClick={() => onOpenFile(f, false)}>
                <td className="mono">{f.track}/{f.sector}</td>
                <td className="mono">{f.blocks}</td>
                <td className="mono">${h4(f.load)}–${h4(f.end - 1)}</td>
                <td className="mono">{f.bytes.length}</td>
                <td className="mono">{name}</td>
                <td className="muted">{[f.note, f.key ? `XOR $${hex(f.key)}` : '', past > 0 ? `the ${past} bytes past $FFFF are left out` : ''].filter(Boolean).join(' · ')}</td>
                <td><button className="icon-btn" title={`Add ${name} to this project`} aria-label={`Add ${name} to this project`} onClick={e => { e.stopPropagation(); onOpenFile(f, true); }}><Icon name="plus" size={13} /></button></td>
              </tr>
            );
          })}
        </tbody></table>
      </>}
    </div>
  );
}

/** The Tape tab (spec 13.5e): what is on the tape in the datasette, in tape order: each file (KERNAL, TapeTool, Turbo
 *  Tape) with where it starts, and the stretches of turbo data no format here reads. A row opens the file, + adds it.
 *  A TapeTool tape has TapeTool's command lines that write it again from its files, which Save files… saves with them. */
export function TapePanel({ tape, onCopy, onOpenFile, onSaveFiles }: { tape: MountedTape; onCopy: (text: string, what: string) => void; onOpenFile: (f: TapeFile, add: boolean) => void; onSaveFiles: () => void }) {
  const { img } = tape;
  const tt = tapeToolScript(img, tape.name);
  const FORMAT: Record<TapeFile['format'], string> = { cbm: 'KERNAL', tapetool: 'TapeTool', turbotape: 'Turbo Tape', freeload: 'Freeload', usgold: 'US Gold' };
  const time = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
  const notes = (f: TapeFile) => [
    f.format === 'cbm' && f.copies ? `header ${f.copies[0]}×, data ${f.copies[1]}×` : '',
    f.headerCode ? 'the header holds code (the tape buffer at $033c)' : '',
    f.tiny ? 'TinyHeader: the boot loader knows where it goes' : '',
    f.format === 'tapetool' && !f.tiny ? `name byte ${f.id}, ${f.blocks} block${f.blocks === 1 ? '' : 's'}${f.packed ? ` (${f.packed} RLE packed)` : ''}${f.shuffled ? ', in random order' : ''}${f.interleaved ? ', mixed with the file before' : ''}` : '',
    f.note ?? '', ...f.errors,
  ].filter(Boolean).join(' · ');
  const rows = [...img.files.map(f => ({ at: f.at, f, u: null as TapeUnknown | null })), ...img.unknown.map(u => ({ at: u.at, f: null as TapeFile | null, u }))].sort((a, b) => a.at - b.at);
  return (
    <div className="xref spindle">
      <div className="xref-head spindle-head">
        <span>{tape.name} (TAP version {img.version}, {time(img.seconds)}): {img.files.length} file{img.files.length === 1 ? '' : 's'}{img.unknown.length ? `, ${img.unknown.length} stretch${img.unknown.length === 1 ? '' : 'es'} of turbo data no format here reads` : ''} <span className="muted">· {[tt ? 'TapeTool’s command lines write the tape again from its files (Save files… saves them with the lines as build.bat)' : '', img.unknown.length ? 'an unknown loader’s data is read by Sindri, running the boot file with the tape in its datasette' : 'a file opens with the tape in Sindri’s datasette, after the file'].filter(Boolean).join('; ')}</span></span>
        {tt && <button className="btn small" onClick={() => onCopy(tt.script.join('\n'), 'Copied the TapeTool command lines')}><Icon name="copy" size={14} />Copy script</button>}
        <button className="btn small" onClick={onSaveFiles} title={tt ? 'Save every file of the tape, boot.bin and build.bat (TapeTool’s command lines) to a folder' : 'Save every file of the tape as a PRG to a folder'}><Icon name="download" size={14} />Save files…</button>
      </div>
      <table className="tbl tape-table" aria-label="Tape files"><thead><tr><th>Time</th><th>Offset</th><th>Format</th><th>Name</th><th>Loads</th><th>Bytes</th><th>Notes</th><th /></tr></thead><tbody>
        {rows.map(({ f, u }, i) => {
          if (u) return (
            <tr key={`u${i}`} className="muted" title="Turbo data of a loader not known here: open the boot file, and Sindri reads it with the tape in its datasette">
              <td className="mono">{time(u.seconds)}</td><td className="mono">${u.offset.toString(16)}</td><td>turbo</td><td className="muted">—</td><td className="muted">—</td>
              <td className="mono">{u.pulses} pulses</td><td>{u.short && u.long ? `pulses of ${u.short} and ${u.long} cycles` : ''}</td><td />
            </tr>
          );
          const file = f!, can = file.load != null && file.data.length > 0 && file.type !== 'SEQ' && file.type !== 'END';
          return (
            <tr key={`f${i}`} className={can ? undefined : 'muted'} title={can ? `Open ${file.name}${file.headerCode ? ' and its header' : ''}` : undefined} onClick={() => { if (can) onOpenFile(file, false); }}>
              <td className="mono">{time(file.seconds)}</td>
              <td className="mono">${file.offset.toString(16)}</td>
              <td>{FORMAT[file.format]}{file.format === 'cbm' ? ` ${file.type}` : ''}</td>
              <td className="mono">{file.format === 'tapetool' ? file.name : `"${file.name}"`}</td>
              <td className="mono">{file.load != null ? `$${h4(file.load)}–$${h4((file.load + Math.max(1, file.data.length) - 1) & 0xffff)}` : <span className="muted">—</span>}</td>
              <td className="mono">{file.data.length}</td>
              <td className={file.errors.length ? 'warn' : 'muted'}>{notes(file)}</td>
              <td>{can && <button className="icon-btn" title={`Add ${file.name} to this project`} aria-label={`Add ${file.name} to this project`} onClick={e => { e.stopPropagation(); onOpenFile(file, true); }}><Icon name="plus" size={13} /></button>}</td>
            </tr>
          );
        })}
      </tbody></table>
      {tt && <pre className="tape-script mono small">{tt.script.join('\n')}</pre>}
    </div>
  );
}

/** The Booze script tab (spec 13.5d): a mounted BoozeLoader disk's own files, a row each by number (a row opens the file
 *  as a PRG, unpacked when it is packed, + adds it), and BoozeLoader's script in the program (5.15b): the loads, sides
 *  and calls of the code that calls the loader, each load with what its file unpacks to on the mounted disk. */
export function BoozePanel({ A, disk, onNavigate, onCopy, onOpenFile }: { A: AnalysisResult; disk: MountedDisk | null; onNavigate: (a: Addr) => void; onCopy: (text: string, what: string) => void; onOpenFile: (f: BoozeFile, add: boolean) => void }) {
  if (!disk?.booze && !A.booze?.steps.length) return <div className="empty">No BoozeLoader script: a BoozeLoader disk keeps its files in a table of its own, and a program with BoozeLoader calls it with each file's number.</div>;
  return (
    <>
      {disk?.booze && <BoozeDiskSection disk={disk} onCopy={onCopy} onOpenFile={onOpenFile} />}
      {!!A.booze?.steps.length && <BoozeScriptSection A={A} disk={disk} onNavigate={onNavigate} onCopy={onCopy} onOpenFile={onOpenFile} />}
    </>
  );
}

/** A BoozeLoader disk's files (spec 13.5d), a row each. */
function BoozeDiskSection({ disk, onCopy, onOpenFile }: { disk: MountedDisk; onCopy: (text: string, what: string) => void; onOpenFile: (f: BoozeFile, add: boolean) => void }) {
  const d = disk.booze!;
  const unpacked = d.files.filter(f => f.unpacked).length, n = d.files.length;
  const what = [d.side != null && `side ${d.side}`, d.cruncher && `packed with ${BOOZE_CRUNCHER[d.cruncher]}`, !d.driveCode && 'no drive code on this side'].filter(Boolean).join(', ');
  const notes = (f: BoozeFile) => [
    f.unpacked ? `packed with ${BOOZE_CRUNCHER[d.cruncher!]}` : f.long ? `${f.bytes.length} bytes, more than memory holds: the program takes it in pieces` : 'not packed',
    `from ${f.track}/${f.sector}, ${f.sectors} sector${f.sectors === 1 ? '' : 's'}`,
  ].join(' · ');
  return (
    <div className="xref spindle">
      <div className="xref-head spindle-head">
        <span>Files of {disk.name} (BoozeLoader{what ? `, ${what}` : ''}): {n} file{n === 1 ? '' : 's'}{unpacked ? `, ${unpacked} unpacked` : ''} <span className="muted">· {d.table != null ? `the program loads a file by its number, which the table in 18/${d.table} gives the first sector of` : 'the program loads a file by its track and sector (the disk has no table)'}; the file names are not on the disk</span></span>
        <button className="btn small" onClick={() => onCopy(boozeFileList(d, disk.name).join('\n'), 'Copied the file list')}><Icon name="copy" size={14} />Copy list</button>
      </div>
      <table className="tbl" aria-label="BoozeLoader files"><thead><tr><th>File</th><th>Loads</th><th>Unpacks to</th><th>Bytes</th><th>Name</th><th>Notes</th><th /></tr></thead><tbody>
        {d.files.map(f => {
          const name = boozeFileName(f), u = f.unpacked;
          return (
            <tr key={`${f.track}/${f.sector}`} title={u ? `Open ${name} unpacked, as a PRG at $${h4(u.start)}` : `Open ${name} as a PRG at $${h4(f.load)}, as it loads`} onClick={() => onOpenFile(f, false)}>
              <td className="mono">{f.n != null ? `$${h2(f.n)}` : `${f.track}/${f.sector}`}</td>
              <td className="mono">${h4(f.load)}–${h4(f.end - 1)}</td>
              <td className="mono">{u ? `$${h4(u.start)}–$${h4(u.end - 1)}` : <span className="muted">—</span>}</td>
              <td className="mono">{u ? `${f.bytes.length} → ${u.end - u.start}` : f.bytes.length}</td>
              <td className="mono">{name}</td>
              <td className="muted">{notes(f)}</td>
              <td><button className="icon-btn" title={`Add ${name} to this project`} aria-label={`Add ${name} to this project`} onClick={e => { e.stopPropagation(); onOpenFile(f, true); }}><Icon name="plus" size={13} /></button></td>
            </tr>
          );
        })}
      </tbody></table>
    </div>
  );
}

/** BoozeLoader's script in the program (5.15b), a row per load, side and call; a row goes to its code, and a load's file
 *  on the mounted disk (of the side the script is on) opens from its row's button. */
function BoozeScriptSection({ A, disk, onNavigate, onCopy, onOpenFile }: { A: AnalysisResult; disk: MountedDisk | null; onNavigate: (a: Addr) => void; onCopy: (text: string, what: string) => void; onOpenFile: (f: BoozeFile, add: boolean) => void }) {
  const S = A.booze!, d = disk?.booze ?? null;
  const loads = S.steps.filter(s => s.kind === 'load').length;
  /** a load's file on the mounted disk, when the script is on its side (or either side is not known) */
  const fileOf = (s: BoozeStep, side: number | null) => {
    if (!d || s.kind !== 'load' || (side != null && d.side != null && side !== d.side)) return null;
    return d.files.find(f => (S.byTrack ? f.track === s.track && f.sector === s.sector : f.n != null && f.n === s.file)) ?? null;
  };
  let side: number | null = null;
  const rows = S.steps.map(s => { if (s.kind === 'side') side = s.side ?? null; return { s, f: fileOf(s, side), side }; });
  const text = () => boozeScript(S, (s, sd) => { const f = fileOf(s, sd), u = f?.unpacked; return f ? `${boozeFileName(f)}${u ? `, unpacks to $${h4(u.start)}-$${h4(u.end - 1)}` : ''}` : null; });
  const runOf = (s: BoozeStep) => S.runs.find(r => s.jsr >= r.start && s.jsr < r.end);
  return (
    <div className="xref spindle">
      <div className="xref-head spindle-head">
        <span>BoozeLoader script: {loads} load{loads === 1 ? '' : 's'} from the code that calls the loader at ${h4(S.loader)} <span className="muted">· BoozeLoader has no script file: the program's code is the script ({S.byTrack ? 'ldy #sector / ldx #track / lda #0 / jsr' : 'lda #file / jsr'} loads, the calls between run the parts){S.runs.some(r => !r.traced) ? '; code not traced is read from its bytes' : ''}{d ? `; what a file unpacks to is from ${disk!.name}` : '; mount the disk to see what each file unpacks to'}</span></span>
        <button className="btn small" onClick={() => onCopy(text().join('\n'), 'Copied the BoozeLoader script')}><Icon name="copy" size={14} />Copy script</button>
      </div>
      <table className="tbl" aria-label="BoozeLoader script"><thead><tr><th>At</th><th>Script line</th><th>File on the disk</th><th>Notes</th></tr></thead><tbody>
        {rows.map(({ s, f }, i) => {
          const u = f?.unpacked, r = runOf(s), first = i === 0 || runOf(rows[i - 1].s) !== r;
          return (
            <tr key={s.jsr} className={cx(first && i > 0 && 'job-first')} title={`Go to $${h4(s.at)}`} onClick={() => onNavigate(s.at)}>
              <td className="mono">${h4(s.at)}</td>
              <td className="mono script-line"><span className={s.kind === 'call' ? undefined : 'syn-label'}>{boozeLine(s)}</span></td>
              <td className="mono">{f ? <>{boozeFileName(f)}{u && <span className="muted"> → ${h4(u.start)}–${h4(u.end - 1)}</span>}
                <button className="icon-btn" title={`Open ${boozeFileName(f)}`} aria-label={`Open ${boozeFileName(f)}`} onClick={e => { e.stopPropagation(); onOpenFile(f, false); }}><Icon name="folder" size={13} /></button></> : <span className="muted">—</span>}</td>
              <td className="muted">{first && r && !r.traced ? 'not traced: copied elsewhere before it runs, or not reached' : ''}</td>
            </tr>
          );
        })}
      </tbody></table>
    </div>
  );
}

/** Spindle's effect drivers (spec 8.11f), a row per line of the script they were built from; a row goes to its driver. */
function DriversSection({ A, R, onNavigate, onCopy }: { A: AnalysisResult; R: RenderResult; onNavigate: (a: Addr) => void; onCopy: (text: string, what: string) => void }) {
  const D = A.spindle;
  const link = (a: Addr) => <button className="addr-link" title={`$${h4(a)}`} onClick={e => { e.stopPropagation(); onNavigate(a); }}>{R.labels.get(a)?.name ?? `$${h4(a)}`}</button>;
  const then = (d: SpindleDriver, i: number) => {
    if (d.ends === 'stop') return <span className="muted">the end of the demo</span>;
    if (d.ends === 'stay') return <span className="muted">stays</span>;
    if (d.ends === 'flip') return <span className="muted">the next disk side</span>;
    const to = D.find(x => x.front === d.next);
    if (!to) return <>{link(d.next!)} <span className="muted">not in memory</span></>;
    if (to === D[i + 1] && to.part === d.part) return <span className="muted">its <span className="mono">|</span> line</span>;
    return <>{to === D[i + 1] ? 'part' : 'back to part'} {to.part}{d.seek != null && <span className="muted"> · seeks label {h2(d.seek)}</span>}</>;
  };
  return (
    <div className="xref spindle">
      <div className="xref-head spindle-head">
        <span>{D.length} Spindle effect driver{D.length === 1 ? '' : 's'} (Pefchain), read back as the script they were built from <span className="muted">· the parts are numbered in the order they run; their file names are not in the program</span></span>
        <button className="btn small" onClick={() => onCopy(spindleScript(D).join('\n'), 'Copied the Spindle script')}><Icon name="copy" size={14} />Copy script</button>
      </div>
      <table className="tbl" aria-label="Spindle script"><thead><tr><th>Part</th><th>Script line</th><th>Driver</th><th>Routines</th><th>Then</th></tr></thead><tbody>
        {D.map((d, i) => {
          const label = spindleLabel(d, D);
          const notes = [d.blank && `blank part${d.music != null ? `, plays $${h4(d.music)}` : ''}`, d.condition.kind === 'sync' && `interlock $${h2(d.condition.addr & 0xff)}`, d.jump && 'fadeout picks a label (J)', d.loads && 'loads'].filter(Boolean);
          return (
            <tr key={d.front} className={cx(d.running && 'running')} onClick={() => onNavigate(d.start)}>
              <td className="mono">{d.part}{d.running && <span className="pill hi">running</span>}</td>
              <td className="mono script-line">{label != null && <span className="muted">{h2(label)}: </span>}<span className="syn-label">{spindleName(d)}</span> <span>{spindleCondition(d.condition)}</span></td>
              <td className="mono">{link(d.front)}</td>
              <td className="routines">{!d.blank && spindleRoutines(d).map(([k, a]) => <span key={k} className="routine"><span className="muted">{k}</span> {link(a)}</span>)}{notes.length > 0 && <span className="muted">{notes.join(' · ')}</span>}</td>
              <td>{then(d, i)}</td>
            </tr>
          );
        })}
      </tbody></table>
    </div>
  );
}

const MODE_NAME: Record<string, string> = { imp: 'implied', acc: 'accumulator', imm: 'immediate', zp: 'zero page', zpx: 'zp,x', zpy: 'zp,y', izx: '(zp,x)', izy: '(zp),y', rel: 'relative', abs: 'absolute', abx: 'abs,x', aby: 'abs,y', ind: 'indirect' };

export function StatsPanel({ A }: { A: AnalysisResult }) {
  const st = A.stats;
  const top = Object.entries(st.mn).sort((a, b) => b[1] - a[1]).slice(0, 18);
  const max = top.length ? top[0][1] : 1;
  const modes = Object.entries(st.modes).sort((a, b) => b[1] - a[1]);
  const modeMax = modes.length ? modes[0][1] : 1;
  const groups: Partial<Record<TypeGroup, number>> = {};
  for (const [t, n] of Object.entries(st.bytesByType)) { const g = groupOfType(+t); groups[g] = (groups[g] || 0) + n; }
  const codePct = Math.round(100 * (groups.code || 0) / Math.max(1, st.total));
  return (
    <div className="stats">
      <div className="tiles">
        <div className="tile"><div className="tile-v">{st.ins}</div><div className="tile-l">instructions</div></div>
        <div className="tile"><div className="tile-v">{codePct}%</div><div className="tile-l">of loaded bytes are code</div></div>
        <div className="tile"><div className="tile-v">{A.blocks.length}</div><div className="tile-l">blocks</div></div>
        <div className="tile"><div className="tile-v">{st.xrefs}</div><div className="tile-l">cross-references</div></div>
        <div className="tile"><div className="tile-v">{st.illegal}</div><div className="tile-l">undocumented opcodes</div></div>
        <div className="tile"><div className="tile-v">{st.ms.toFixed(1)} ms</div><div className="tile-l">analysis time (worker)</div></div>
      </div>
      <div className="stat-cols">
        <section>
          <h4>Memory composition <span className="muted">({fmtBytes(st.total)} loaded)</span></h4>
          <div className="stack" role="img" aria-label="Share of loaded bytes per classification">
            {GROUP_ORDER.filter(g => groups[g]).map(g => <span key={g} style={{ flex: groups[g], background: `var(--g-${g})` }} title={`${GROUP_LABEL[g]}: ${groups[g]} bytes`} />)}
          </div>
          <ul className="legend">{GROUP_ORDER.filter(g => groups[g]).map(g => <li key={g}><i style={{ background: `var(--g-${g})` }} />{GROUP_LABEL[g]} <span className="muted mono">{fmtBytes(groups[g]!)}</span></li>)}</ul>
          <h4>Addressing modes</h4>
          <div className="bars">{modes.map(([m, n]) => <div key={m} className="bar-row" title={`${MODE_NAME[m]}: ${n}`}><span className="bar-l">{MODE_NAME[m]}</span><span className="bar-track"><span className="bar alt" style={{ width: `${(n / modeMax) * 100}%` }} /></span><span className="bar-v">{n}</span></div>)}</div>
        </section>
        <section>
          <h4>Opcode frequency <span className="muted">(top {top.length})</span></h4>
          <div className="bars">{top.map(([m, n]) => { const ill = OPC.some(o => o.mn === m && o.ill) && !OPC.some(o => o.mn === m && !o.ill); return <div key={m} className="bar-row" title={`${m}: ${n}`}><span className={cx('bar-l mono', ill && 'syn-ill')}>{kickMnemonic(m)}</span><span className="bar-track"><span className="bar" style={{ width: `${(n / max) * 100}%` }} /></span><span className="bar-v">{n}</span></div>; })}</div>
        </section>
      </div>
    </div>
  );
}

/** `cart`: the project's cartridge, whose own source is built last and whose image VICE attaches (spec 13.9) */
interface BuildPanelProps { build: BuildState | null; S: Settings; names: string[]; cart: CartBuild | null; stale: boolean; busy: string | null; onVerify: () => void; onRun: () => void; onCopy: (s: string) => void }

export function BuildPanel({ build, S, names, cart, stale, busy, onVerify, onRun, onCopy }: BuildPanelProps) {
  const name = names[0] || 'main';
  const q = (s: string) => (/\s/.test(s) ? `"${s}"` : s);
  const kick = (entry: string) => `${q(S.javaPath)} -jar ${q(S.kickJar)} ${entry} -odir ${S.outDir} ${S.kickArgs}`;
  // every bank in one source (13.9c): it is the only source to build, and VICE gets its labels
  const kickCmd = cart?.one ? null : kick(`${name}.asm`);
  const cartCmd = cart ? kick(cart.entry) : null;
  const labels = cart?.one ? cart.entry.replace(/\.asm$/, '') : name;
  const viceCmd = `${q(S.vicePath)} ${S.viceArgs} -moncommands ${S.outDir}/${labels}.vs ${cart ? `-cartcrt ${S.outDir}/${cart.output}` : `-autostart ${S.outDir}/${name}.prg`}`;
  return (
    <div className="build">
      <div className="build-actions">
        <button className="btn" onClick={onVerify} disabled={!!busy}><Icon name="check" />Verify round-trip</button>
        <button className="btn primary" onClick={onRun} disabled={!!busy}><Icon name="play" />Build &amp; run</button>
        {busy ? <span className="small text-accent-hi">{busy}…</span> : <span className="muted small">The main process runs these with argument arrays (no shell), in a temporary build folder:</span>}
      </div>
      {kickCmd && <div className="cmd"><code>{kickCmd}</code><button className="icon-btn" title="Copy command" onClick={() => onCopy(kickCmd)}><Icon name="copy" size={14} /></button></div>}
      {cartCmd && <div className="cmd"><code>{cartCmd}</code><button className="icon-btn" title="Copy command" onClick={() => onCopy(cartCmd)}><Icon name="copy" size={14} /></button></div>}
      <div className="cmd"><code>{viceCmd}</code><button className="icon-btn" title="Copy command" onClick={() => onCopy(viceCmd)}><Icon name="copy" size={14} /></button></div>
      {build ? (
        <>
          <div className="mb-2 flex flex-wrap gap-2 text-[11.5px]">
            <span className={cx('rounded border px-2 py-0.5', build.V.ok ? 'border-ok text-ok' : 'border-err text-err')}>built-in verifier: {build.V.ok ? 'byte-identical' : 'differences'}</span>
            {build.kick
              ? <span className={cx('rounded border px-2 py-0.5', build.kick.ok ? 'border-ok text-ok' : 'border-err text-err')}>KickAss.jar: {build.kick.ok ? 'byte-identical' : `${build.kick.problems.length} problem${build.kick.problems.length === 1 ? '' : 's'}`}</span>
              : <span className="rounded border border-line-2 px-2 py-0.5 text-fg-3">KickAss.jar: not run (set its path in Settings → Toolchain)</span>}
            {build.cart && <span className={cx('rounded border px-2 py-0.5', build.cart.ok && (!build.kick?.cart || build.kick.cart.ok) ? 'border-ok text-ok' : 'border-err text-err')}>{build.cart.name}: {build.cart.ok && (!build.kick?.cart || build.kick.cart.ok) ? 'byte-identical' : 'differences'}</span>}
          </div>
          <pre className={cx('build-log', build.ok ? 'ok' : 'bad', stale && 'stale')}>{stale && '(project changed since this run — verify again)\n'}{build.log}</pre>
        </>
      ) : <div className="empty small">Run “Verify round-trip” to re-assemble the generated source with the built-in verifier and, when KickAss.jar is configured, with the real Kick Assembler, then compare every byte with the original PRG.</div>}
    </div>
  );
}

export const BOTTOM_TABS: [BottomTab, string][] = [['log', 'Analysis log'], ['problems', 'Problems'], ['xrefs', 'Cross-references'], ['irqs', 'Raster IRQs'], ['relocs', 'Relocated'], ['spindle', 'Spindle script'], ['bitfire', 'Bitfire script'], ['booze', 'Booze script'], ['sparkle', 'Sparkle script'], ['pirateslayer', 'Pirate Slayer'], ['tape', 'Tape'], ['stats', 'Statistics'], ['build', 'Build output']];
