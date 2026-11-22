/* Bottom panel: analysis log, problems, cross-references, raster IRQs, relocated blocks, the Spindle script, a Bitfire
 * disk's files, the BoozeLoader script, a Sparkle disk's bundles, the files of disks for Krill's loader, the Covert
 * Bitops loader and DLoC's loader, Pirate Slayer and Para-Protect
 * on the mounted disk, the tape in the datasette, statistics, build output. */
import {
  BITFIRE_VERSION, bitfireFileName, BOOZE_CRUNCHER, cc1541Script, COVERT_PACKER, COVERT_RAW_AT, IFFL_PACKER, ifflPartName, ifflPieceName, type IfflFile, type IfflPart, covertCallText, covertFileName, covertScript, covertScriptText, type CovertFile, DLOC_ROUTINE, dlocCallText, dlocFileName, dlocScript, dlocScriptText, dlocUnpackedName, type DlocFile, krillCallText, krillFileName, krillFileTs, krillLoads, krillPackerName, krillScriptText, type KrillFile, type KrillLoad, PIRATESLAYER_SIGNATURE, pirateSlayerFileList, pirateSlayerFileName, paraProtectFileList, diskSpeedFileList, tapeToolScript, boozeFileList, boozeFileName, boozeLine, boozeScript, d64writeScript, decode, goneCounts, h2, h4, hwSymbol, kickMnemonic, lineText, OPC, PROBLEM_CODES, sparkleChunkName, sparkleScript, spinChunkName, spindleCondition, spindleLabel, spindleName, spindleRoutines, spindleScript, spinScript,
  ASSEMBLERS, assemblerOf, findPetsciiAnims, shownAddress, shownTarget, storePagesText, viewOffsetAt, type PetsciiAnim,
  type Addr, type AnalysisResult, type BitfireFile, type BoozeFile, type BoozeStep, type CartBuild, type DeepReport, type DiskSpeedFile, type ParaProtectFile, type PirateSlayerFile, type RasterIrq, type Reloc, type RenderResult, type Settings, type SparkleBundle, type SparkleChunk, type SpindleChunk, type SpindleDriver, type SpindleJob, type TapeFile, type TapeUnknown,
} from '@mimir/core';
import { useMemo } from 'react';
import { Icon, LVL_ICON } from '../lib/icons';
import { animDataText, jobAnimData, jobsText, spinStoreAnims } from '../lib/storeanim';
import { cx, fmtBytes, GROUP_LABEL, GROUP_ORDER, groupOfType } from '../lib/util';
import type { BottomTab } from '../store/ui';
import type { BuildState, Message, MountedDisk, MountedTape, UiProblem } from '../lib/types';
import type { TypeGroup } from '@mimir/core';
import { asmWords, useAssembler } from '../lib/assembler';
import { labelRefs, XREF_KIND, type LabelRef } from '../lib/labelrefs';
import { tapeOpens } from './Sidebar';

/** The files of a loader tab that are in the project (opened or added from it): their rows are marked as the Explorer
 *  marks a disk's files in the project (a line on the left, `aria-current`), so the tab shows which file is loaded. */
type InProject = ReadonlySet<object>;
/** a loader tab's row of a file in `open`: the class, `aria-current` and its tip */
const mark = (on: boolean, title?: string) => ({ 'aria-current': on || undefined, title: title && on ? `${title}: it is in the project` : title });

/** A loader tab's buttons beside Copy script: Export files to project writes the tab's files as sources of their own
 *  (`n` of them; `per`: a source per job or bundle, with its files in it) in a folder of the project named after the
 *  disk, each analysed alone, so the project's listing stays as it is; Save files… saves the files themselves to a
 *  folder picked (`saveTitle` says how). `what`: files, or an IFFL tab's parts. */
function FileButtons({ n, per, onExport, onSave, saveTitle, what = 'files' }: { n: number; per?: string; onExport: () => void; onSave: () => void; saveTitle: string; what?: 'files' | 'parts' }) {
  return (
    <>
      <button className="btn small" onClick={onExport} title={`Write ${n} Kick Assembler source${n === 1 ? '' : 's'} in a folder of the project named after the disk: ${per ? `a source per ${per}, with its files in it, each in a segment written as its own PRG` : 'a source per file'}, each analysed alone and assembled again to check it. The project's listing stays as it is (needs a project)`}><Icon name="files" size={14} />Export {what} to project</button>
      <button className="btn small" onClick={onSave} title={saveTitle}><Icon name="download" size={14} />Save {what}…</button>
    </>
  );
}

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

/** The Messages tab: what the toasts said, the newest first, with the time. A toast goes after a few seconds (an error
 *  when it is dismissed); this keeps them for the rest of the run. */
export function MessagesPanel({ items, onClear }: { items: Message[]; onClear: () => void }) {
  if (!items.length) return <div className="empty">No messages yet. What the notices in the corner say is kept here for the rest of the run.</div>;
  return (
    <>
      <div className="problems-head"><span className="muted small">{items.length} message{items.length === 1 ? '' : 's'} in this run, the newest first</span><span className="grow" /><button className="btn small" onClick={onClear}>Clear</button></div>
      <div className="loglist" role="list" aria-label="Messages">
        {items.slice().reverse().map(m => (
          <div key={m.id} role="listitem" className={cx('logrow', `lvl-${m.kind}`)}>
            <Icon name={LVL_ICON[m.kind] || 'info'} size={14} className="lvl-icon" />
            <span className="log-cat mono">{new Date(m.at).toLocaleTimeString()}</span>
            <span className="log-msg">{m.msg}</span>
          </div>
        ))}
      </div>
    </>
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

export function XrefPanel({ A, R, cursor, onNavigate, S }: { A: AnalysisResult; R: RenderResult; cursor: Addr | null; onNavigate: (a: Addr) => void; S: Settings }) {
  if (cursor == null) return <div className="empty">Place the cursor on a line to see who references it.</div>;
  const ins = A.insLen[cursor] ? cursor : A.codeOwner[cursor] >= 0 ? A.codeOwner[cursor] : cursor;
  const label = R.labels.get(ins);
  // where a view offset shows the bytes (10.4), the references to the address shown too, and the addresses as shown
  const voffs = R.viewOffsets, shown = (a: Addr) => shownAddress(voffs, a);
  // the analysis's references and the lines that name its label (`lda #<irq`), as the box beside a label lists them
  const to = labelRefs(A, R, ins, false), cs = ASSEMBLERS[assemblerOf(S)].comment;
  const text = (l: LabelRef['line']) => (l ? lineText({ ...l, cmt: '' }, S).trim().split(` ${cs} `)[0].trim() : '');
  const outgoing: Addr[] = [];
  if (A.insLen[ins]) { const d = decode(A.mem, ins); if (d.target != null) outgoing.push(d.target); }
  // an instruction outside the bytes shown elsewhere that targets where they are shown goes to them
  const goes = outgoing.length ? (shownTarget(voffs, outgoing[0]) && !shownTarget(voffs, ins) ? shownTarget(voffs, outgoing[0])!.at : outgoing[0]) : null;
  // and one inside them that targets their own bytes goes where they are shown, as the listing writes it
  const mine = viewOffsetAt(voffs, ins), goesAt = goes != null && mine && goes >= mine.start && goes < mine.end ? shown(goes) : outgoing[0];
  return (
    <div className="xref">
      <div className="xref-head">References to <b className="mono">{label ? label.name : '$' + h4(shown(ins))}</b> <span className="muted">(${h4(shown(ins))}{shown(ins) !== ins ? `, loaded at $${h4(ins)}` : ''})</span> — {to.length}</div>
      {to.length ? (
        <table className="tbl"><thead><tr><th>From</th><th>Kind</th><th>Instruction</th><th>In</th></tr></thead><tbody>
          {to.map((x, i) => <tr key={i} onClick={() => onNavigate(x.from)}><td className="mono link-cell">${h4(x.shown)}</td><td><span className={cx('kind', `kind-${x.kind}`)}>{XREF_KIND[x.kind]}</span></td><td className="mono">{text(x.line)}</td><td className="mono muted">{x.where ?? ''}</td></tr>)}
        </tbody></table>
      ) : <div className="empty small">No references. Entry points, vectors and data reached only through computed addresses have none.</div>}
      {goes != null && <div className="xref-out">This instruction targets <button className="addr-link" onClick={() => onNavigate(goes)}>${h4(goesAt)}</button>{R.labels.get(goes) ? <span className="mono"> {R.labels.get(goes)!.name}</span> : (hwSymbol(outgoing[0]) ? <span className="mono syn-hw"> {hwSymbol(outgoing[0])!.text}</span> : null)}</div>}
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
  const asm = useAssembler();
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
        <span className="muted"> · bytes the program copies elsewhere to run there: read where they run, written where they are loaded inside {asmWords(asm).pseudopc}</span>
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
                <td className="mono">{span(c.to, c.to + c.end - c.start)}{other && <span className="muted"> · relocated to run at ${h4(other.to)}</span>}
                  {c.over && !other && <span className="muted" title="The file has bytes there that are not what runs there (what was there when the program was saved, its screen, say): relocated, they become junk"> · over the file's bytes</span>}</td>
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
  /** the chunks in the project: their rows are marked */
  open: InProject;
  onNavigate: (a: Addr) => void; onCopy: (text: string, what: string) => void;
  /** open a job's chunk as a PRG (`add`: add it to the project) */
  onOpenChunk: (j: SpindleJob, c: SpindleChunk, add: boolean) => void;
  /** open all of a job's chunks as a project (`anim`: then Graphics shows the PETSCII animation its code plays) */
  onOpenJob: (j: SpindleJob, anim: PetsciiAnim | null) => void;
  /** Add files to project, Save files…: every chunk of the disk's jobs */
  onExportFiles: () => void; onSaveFiles: () => void;
}

/** The Spindle script tab: a mounted Spindle 3 disk's load script (Spin's jobs), and the effect drivers in memory. */
export function SpindlePanel({ A, R, disk, open, onNavigate, onCopy, onOpenChunk, onOpenJob, onExportFiles, onSaveFiles }: SpindlePanelProps) {
  if (!A.spindle.length && !disk?.spindle) return <div className="empty">No Spindle script: a Spindle 3 disk holds the jobs its load script lists, and a VICE snapshot of a trackmo linked with Pefchain holds its effect drivers.</div>;
  return (
    <>
      {disk?.spindle && <SpinDiskSection disk={disk} open={open} onCopy={onCopy} onOpenChunk={onOpenChunk} onOpenJob={onOpenJob} onExportFiles={onExportFiles} onSaveFiles={onSaveFiles} />}
      {A.spindle.length > 0 && <DriversSection A={A} R={R} onNavigate={onNavigate} onCopy={onCopy} />}
    </>
  );
}

/** the PETSCII animation a job's code plays (spec 14.5b), read from the job's chunks alone; null: none */
export function jobAnim(j: SpindleJob): PetsciiAnim | null {
  const mem = new Uint8Array(0x10000), on = new Uint8Array(0x10000);
  for (const c of j.chunks) { mem.set(c.bytes, c.start); on.fill(1, c.start, c.end); }
  return findPetsciiAnims(mem, a => on[a] === 1).find(a => a.frames.length) ?? null;
}

/** A Spindle 3 disk's jobs (spec 13.5b), a row per chunk; a row opens the chunk as a PRG at its address, + adds it. A
 *  job's first row opens all its chunks at once, and says when its code plays a PETSCII animation (14.5b), or when the
 *  job is animation data another job's player stores frame by frame, or holds that player. */
function SpinDiskSection({ disk, open, onCopy, onOpenChunk, onOpenJob, onExportFiles, onSaveFiles }: { disk: MountedDisk; open: InProject; onCopy: (text: string, what: string) => void; onOpenChunk: (j: SpindleJob, c: SpindleChunk, add: boolean) => void; onOpenJob: (j: SpindleJob, anim: PetsciiAnim | null) => void; onExportFiles: () => void; onSaveFiles: () => void }) {
  const d = disk.spindle!;
  const chunks = d.jobs.reduce((n, j) => n + j.chunks.length, 0);
  const anims = useMemo(() => new Map(d.jobs.map(j => [j, jobAnim(j)])), [d]);
  const stores = useMemo(() => spinStoreAnims(d), [d]);
  /** animation data a player in another job stores frame by frame (Bliss Machine's lightning): the jobs that hold it
   *  are no packed files, and the player's job plays it */
  const storeNote = (j: SpindleJob): { text: string; title: string } | null => {
    const x = jobAnimData(stores, j);
    if (x) return { text: `animation data, not packed: ${x.first ? `frame${x.first === x.last ? ` ${x.first}` : `s ${x.first}–${x.last}`} of ${x.anim.frames.length}` : 'the end of a frame'} for the player at $${h4(x.anim.player.entry)} (job ${x.anim.playerJob.n})`, title: `Animation data, not packed: ${animDataText(x)}` };
    const p = stores.find(a => a.playerJob === j);
    if (p) return { text: `its player at $${h4(p.player.entry)} plays the animation data in ${jobsText(p.dataJobs.map(y => y.job))} (${p.frames.length} frames)`, title: `The player at $${h4(p.player.entry)} stores ${p.frames.length} frames into ${storePagesText(p.pages)}, a frame each time it is called, from $${h4(p.start)}–$${h4(p.end - 1)} (the code at $${h4(p.setter)} points it there). That stream is animation data, not packed` };
    return null;
  };
  const notes = (j: SpindleJob) => [j.jump != null && `then jumps to $${h4(j.jump)}`, j.shadow && 'loads under I/O', j.missing > 0 && `${j.missing} bytes could not be decrunched`].filter(Boolean).join(' · ');
  return (
    <div className="xref spindle">
      <div className="xref-head spindle-head">
        <span>Load script of {disk.name} (Spin, Spindle 3): {d.jobs.length} job{d.jobs.length === 1 ? '' : 's'}, {chunks} chunk{chunks === 1 ? '' : 's'} <span className="muted">· a job is a loader call{d.start != null ? `; after job 1 the boot program goes to $${h4(d.start)}` : ''}{d.next != null ? '; then the next disk side' : ''}; the file names are not on the disk</span></span>
        <button className="btn small" onClick={() => onCopy(spinScript(d, disk.name).join('\n'), 'Copied the load script')}><Icon name="copy" size={14} />Copy script</button>
        <FileButtons n={d.jobs.length} per="job" onExport={onExportFiles} onSave={onSaveFiles} saveTitle="Save every chunk of the jobs to a folder, as the load script names it (.bin) and as a PRG, with the load script Spin reads" />
      </div>
      <table className="tbl" aria-label="Spindle load script"><thead><tr><th>Job</th><th>Loads</th><th>Bytes</th><th>File</th><th>Notes</th><th /></tr></thead><tbody>
        {d.jobs.flatMap(j => j.chunks.map((c, k) => {
          const name = spinChunkName(j, c);
          return (
            <tr key={`${j.n}-${c.start}`} className={cx(k === 0 && 'job-first', open.has(c) && 'on')} {...mark(open.has(c), `Open ${name} as a PRG at $${h4(c.start)}`)} onClick={() => onOpenChunk(j, c, false)}>
              <td className="mono">{k === 0 && <>{j.n}{j.labels.map(l => <span key={l} className="pill">{h2(l)}:</span>)}</>}</td>
              <td className="mono">${h4(c.start)}–${h4(c.end - 1)}</td>
              <td className="mono">{c.end - c.start}</td>
              <td className="mono">{name}</td>
              <td className="muted">{k === 0 && <>
                {notes(j)}
                {(x => x && <span className="spin-store" title={x.title}>{notes(j) ? ' · ' : ''}{x.text}</span>)(storeNote(j))}
                {(a => a && <button className="linkish spin-anim" title={`The job's code plays a PETSCII animation: ${a.frames.length} frames from $${h4(a.start)}-$${h4((a.end - 1) & 0xffff)}, drawn by the player at $${h4(a.player.entry ?? a.player.next)}. Open the whole job and show the frames in Graphics → Animations`}
                  onClick={e => { e.stopPropagation(); onOpenJob(j, a); }}>{notes(j) || storeNote(j) ? ' · ' : ''}<Icon name="film" size={12} />PETSCII animation: {a.frames.length} frames (${h4(a.start)}–${h4((a.end - 1) & 0xffff)})</button>)(anims.get(j))}
              </>}</td>
              <td className="spin-acts">
                {k === 0 && j.chunks.length > 1 && <button className="icon-btn" title={`Open job ${j.n}: all its ${j.chunks.length} chunks as one project`} aria-label={`Open job ${j.n}`} onClick={e => { e.stopPropagation(); onOpenJob(j, null); }}><Icon name="files" size={13} /></button>}
                <button className="icon-btn" title={`Add ${name} to this project`} aria-label={`Add ${name} to this project`} onClick={e => { e.stopPropagation(); onOpenChunk(j, c, true); }}><Icon name="plus" size={13} /></button></td>
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
export function BitfirePanel({ disk, open, onCopy, onOpenFile, onExportFiles, onSaveFiles }: { disk: MountedDisk; open: InProject; onCopy: (text: string, what: string) => void; onOpenFile: (f: BitfireFile, add: boolean) => void; onExportFiles: () => void; onSaveFiles: () => void }) {
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
        <FileButtons n={d.files.length} onExport={onExportFiles} onSave={onSaveFiles} saveTitle="Save every file as it is on the disk and unpacked to a folder, with d64write's command line that writes the disk again" />
      </div>
      <table className="tbl" aria-label="Bitfire files"><thead><tr><th>File</th><th>Loads</th><th>Unpacks to</th><th>Bytes</th><th>Name</th><th>Notes</th><th /></tr></thead><tbody>
        {d.files.map(f => {
          const name = bitfireFileName(f), u = f.unpacked;
          return (
            <tr key={f.n} className={cx(open.has(f) && 'on')} {...mark(open.has(f), u ? `Open ${name} unpacked, as a PRG at $${h4(u.start)}` : `Open ${name} as a PRG at $${h4(f.load)}, as it loads`)} onClick={() => onOpenFile(f, false)}>
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
export function SparklePanel({ disk, open, onCopy, onOpenChunk, onExportFiles, onSaveFiles }: { disk: MountedDisk; open: InProject; onCopy: (text: string, what: string) => void; onOpenChunk: (b: SparkleBundle, c: SparkleChunk, add: boolean) => void; onExportFiles: () => void; onSaveFiles: () => void }) {
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
        <FileButtons n={d.bundles.length} per="bundle" onExport={onExportFiles} onSave={onSaveFiles} saveTitle="Save every bundle's files as PRGs to a folder, with the loader script that loads them" />
      </div>
      <table className="tbl" aria-label="Sparkle bundles"><thead><tr><th>Bundle</th><th>Loads</th><th>Bytes</th><th>File</th><th>Notes</th><th /></tr></thead><tbody>
        {d.bundles.flatMap(b => b.chunks.map((c, k) => {
          const name = sparkleChunkName(b, c);
          return (
            <tr key={`${b.n}-${c.start}`} className={cx(k === 0 && 'job-first', open.has(c) && 'on')} {...mark(open.has(c), `Open ${name} as a PRG at $${h4(c.start)}`)} onClick={() => onOpenChunk(b, c, false)}>
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

/** The IFFL parts tab (spec 13.5m): a disk's IFFL files, each one file that holds the parts a game loads behind a
 *  table of their lengths; a part a row, in the table's order (its number is what the game's loader asks for). A part
 *  is a chain of pieces packed with Exomizer, each with where it ends in memory: a row opens the part's pieces unpacked,
 *  a PRG each at where it unpacks to, + adds them; a part that is not packed so has no address and is only saved.
 *  Save parts… writes every part as it is stored and its pieces unpacked. */
export function IfflPanel({ disk, open, onOpenPart, onExportParts, onSaveParts }: { disk: MountedDisk; open: InProject; onOpenPart: (f: IfflFile, p: IfflPart, add: boolean) => void; onExportParts: () => void; onSaveParts: () => void }) {
  const d = disk.iffl!;
  const n = d.files.reduce((a, f) => a + f.parts.length, 0), unpacked = d.files.reduce((a, f) => a + f.parts.filter(p => p.pieces).length, 0);
  const packers = [...new Set(d.files.flatMap(f => (f.packer ? [IFFL_PACKER[f.packer].name] : [])))];
  return (
    <div className="xref spindle">
      <div className="xref-head spindle-head">
        <span>IFFL parts of {disk.name}: {d.files.map(f => `"${f.name}"`).join(', ')}, {n} part{n === 1 ? '' : 's'}, {unpacked} unpacked{packers.length ? ` (${packers.join(', ')})` : ''} <span className="muted">· an IFFL file is one file with all the parts a game loads: its first sector is the table of their lengths, and the game's loader asks for a part by its number. It is no program, so it does not run or unpack as one: open its parts here</span></span>
        <FileButtons what="parts" per="part" n={d.files.reduce((k, f) => k + f.parts.filter(p => p.pieces).length, 0)} onExport={onExportParts} onSave={onSaveParts} saveTitle="Save every part to a folder: as it is stored in the file and, when it is packed, its pieces unpacked as PRGs" />
      </div>
      <table className="tbl" aria-label="IFFL parts"><thead><tr><th>Part</th><th>In file</th><th>At</th><th>Unpacks to</th><th>Bytes</th><th>File</th><th>Notes</th><th /></tr></thead><tbody>
        {d.files.flatMap(f => f.parts.map(p => {
          const name = ifflPartName(f, p), u = p.pieces, to = u?.map(x => `$${h4(x.start)}–$${h4(x.end - 1)}`).join(', ');
          const packer = f.packer ? IFFL_PACKER[f.packer].name : 'Exomizer';
          return (
            <tr key={`${f.entry}-${p.n}`} className={cx(open.has(p) && 'on')} {...mark(open.has(p), u ? `Open part ${p.n} unpacked: ${u.length === 1 ? `${ifflPieceName(f, p, u[0])}, a PRG at $${h4(u[0].start)}` : `its ${u.length} pieces, a PRG each (${to})`}` : `${name} is not packed with ${packer}: it has no address of its own, Save parts… saves it as it is stored`)} onClick={() => u && onOpenPart(f, p, false)}>
              <td className="mono">{p.n}</td>
              <td className="mono">"{f.name}"</td>
              <td className="mono">${p.offset.toString(16).padStart(5, '0')}</td>
              <td className="mono">{to ?? <span className="muted">—</span>}</td>
              <td className="mono">{u ? `${p.bytes.length} → ${u.reduce((a, x) => a + x.bytes.length, 0)}` : p.bytes.length}</td>
              <td className="mono">{name}</td>
              <td className="muted">{u ? `packed with ${packer}${u.length > 1 ? `, ${u.length} pieces` : ''}: unpacked as it loads, from its end backwards` : `not packed with ${packer}: as it is stored`}</td>
              <td>{u && <button className="icon-btn" title={`Add part ${p.n} unpacked to this project`} aria-label={`Add part ${p.n} unpacked to this project`} onClick={e => { e.stopPropagation(); onOpenPart(f, p, true); }}><Icon name="plus" size={13} /></button>}</td>
            </tr>
          );
        }))}
      </tbody></table>
    </div>
  );
}

/** The Krill script tab (spec 13.5k): the mounted disk's files, a row each in the directory's order (the order the
 *  loader loads them in when it loads by name), then the files outside the directory that calls load by their track and
 *  sector: a row opens the file as a PRG, unpacked when it is packed with the loader's ZX0, (version 146) Doynax LZ,
 *  Exomizer or (revision 166) TinyCrunch, + adds it; then the loader's calls read from the files' own code. Then Krill's
 *  loader's script in the program (5.15c), a row per load (a call that takes its files from a table, a row per entry):
 *  a row goes to its code, and the file it loads on the mounted disk opens from its button. Copy script gives cc1541's
 *  command line that writes the disk again (the script's, the script with it), Save files… every file as it is on the
 *  disk and unpacked, with them. */
export function KrillPanel({ A, disk, open, onNavigate, onCopy, onOpenFile, onExportFiles, onSaveFiles }: { A: AnalysisResult; disk: MountedDisk | null; open: InProject; onNavigate: (a: Addr) => void; onCopy: (text: string, what: string) => void; onOpenFile: (f: KrillFile, add: boolean) => void; onExportFiles: () => void; onSaveFiles: () => void }) {
  if (!disk?.krill && !A.krill?.steps.length) return <div className="empty">No Krill script: a program with Krill's loader calls it with X and Y naming a file, and a disk for it keeps packed files.</div>;
  const loads = A.krill?.steps.length ? krillLoads(A.krill, disk?.krill ?? null) : [];
  return (
    <>
      {disk?.krill && <KrillDiskSection disk={disk} loads={loads} open={open} onCopy={onCopy} onOpenFile={onOpenFile} onExportFiles={onExportFiles} onSaveFiles={onSaveFiles} />}
      {loads.length > 0 && <KrillScriptSection A={A} disk={disk} loads={loads} open={open} onNavigate={onNavigate} onCopy={onCopy} onOpenFile={onOpenFile} />}
    </>
  );
}

/** Krill's loader's script in the program (5.15c): a row per load. */
function KrillScriptSection({ A, disk, loads, open, onNavigate, onCopy, onOpenFile }: { A: AnalysisResult; disk: MountedDisk | null; loads: KrillLoad[]; open: InProject; onNavigate: (a: Addr) => void; onCopy: (text: string, what: string) => void; onOpenFile: (f: KrillFile, add: boolean) => void }) {
  const S = A.krill!, d = disk?.krill ?? null;
  const routines = S.routines.map(r => `$${h4(r)}`).join(', ');
  return (
    <div className="xref spindle">
      <div className="xref-head spindle-head">
        <span>Krill's loader script: {loads.length} load{loads.length === 1 ? '' : 's'} from the code that calls the loader at {routines} <span className="muted">· Krill's loader has no script file: the program's code is the script ({S.by === 'ts' ? 'ldx #track / ldy #sector / jsr: this build names a file by where it starts' : 'ldx #<name / ldy #>name / jsr'}){S.steps.some(s => !s.traced) ? '; code not traced is read from its bytes' : ''}{d ? `; the files are ${disk!.name}'s` : '; mount the disk to see the file each loads'}</span></span>
        <button className="btn small" onClick={() => onCopy(krillScriptText(S, d, disk?.name ?? null).join('\n'), "Copied Krill's loader script")}><Icon name="copy" size={14} />Copy script</button>
      </div>
      <table className="tbl" aria-label="Krill script"><thead><tr><th>At</th><th>Script line</th><th>File on the disk</th><th>Notes</th></tr></thead><tbody>
        {loads.map(l => {
          const f = l.file, u = f?.unpacked;
          const notes = [
            !l.step.traced && 'not traced: copied elsewhere before it runs, or run by a script of the program\'s own',
            l.step.dest != null && 'the carry set: to where the call says, not its load address',
            d && !f && (l.ts ? 'no file of the mounted disk starts there' : 'no file of the mounted disk has the name'),
          ].filter(Boolean).join(' · ');
          return (
            <tr key={`${l.step.jsr}:${l.entry ?? ''}`} className={cx(!!f && open.has(f) && 'on')} {...mark(!!f && open.has(f), `Go to $${h4(l.step.at)}`)} onClick={() => onNavigate(l.step.at)}>
              <td className="mono">${h4(l.step.at)}</td>
              <td className="mono script-line"><span className="syn-label">{l.text}</span></td>
              <td className="mono">{f ? <>{krillFileName(f)}{u && <span className="muted"> → ${h4(u.start)}–${h4(u.end - 1)}</span>}
                <button className="icon-btn" title={`Open ${krillFileName(f)}`} aria-label={`Open ${krillFileName(f)}`} onClick={e => { e.stopPropagation(); onOpenFile(f, false); }}><Icon name="folder" size={13} /></button></> : <span className="muted">—</span>}</td>
              <td className="muted">{notes}</td>
            </tr>
          );
        })}
      </tbody></table>
    </div>
  );
}

/** A mounted disk for Krill's loader: its files, a row each, and the loader's calls in their code. */
function KrillDiskSection({ disk, loads, open, onCopy, onOpenFile, onExportFiles, onSaveFiles }: { disk: MountedDisk; loads: KrillLoad[]; open: InProject; onCopy: (text: string, what: string) => void; onOpenFile: (f: KrillFile, add: boolean) => void; onExportFiles: () => void; onSaveFiles: () => void }) {
  const d = disk.krill!;
  const n = d.files.length, unpacked = d.files.filter(f => f.unpacked).length, lines = d.entries.filter(e => !e.file).length, outside = d.files.filter(f => f.entry < 0).length;
  const packer = krillPackerName(d);
  const notes = (f: KrillFile, i: number) => {
    const e = f.entry >= 0 ? d.entries[f.entry] : null, u = f.unpacked;
    const by = [...loads.filter(l => l.file === f).map(l => `the program at $${h4(l.step.at)}`), ...d.calls.filter(c => c.file === i).map(c => `${krillFileName(d.files[c.in])} at $${h4(c.at)}${c.dest != null ? ` (to $${h4(c.dest)})` : ''}`)];
    return [
      u ? `packed with ${packer}, ${d.packer === 'doynax' || (d.packer === 'tinycrunch' && u.inplace) ? `unpacked in place${u.overwritten ? `, over ${u.overwritten} byte${u.overwritten === 1 ? '' : 's'} of its stream still to be read` : ''}` : d.packer === 'tinycrunch' ? 'unpacked elsewhere' : d.packer === 'exomizer' ? (u.inplace ? 'unpacked in place' : 'unpacked elsewhere') : u.inplace ? 'in place' : 'with an end'}` : f.basic ? 'a BASIC program: loaded with LOAD and RUN' : `not packed with ${packer}: as it is on the disk`,
      `from ${krillFileTs(f)}`,
      !e && 'not in the directory',
      e && e.blocks !== f.sectors.length && `the directory shows ${e.blocks} block${e.blocks === 1 ? '' : 's'} (${f.sectors.length})`,
      by.length > 0 && `loaded by ${by.join(', ')}`,
    ].filter(Boolean).join(' · ');
  };
  return (
    <div className="xref spindle">
      <div className="xref-head spindle-head">
        <span>Files of {disk.name} (Krill's loader, {packer}): {n} file{n === 1 ? '' : 's'}, {unpacked} unpacked <span className="muted">· {d.by === 'ts'
          ? `this build loads a file by its track and sector, as the calls in the files' code show${outside ? `; ${outside} file${outside === 1 ? ' is' : 's are'} not in the directory` : ''}`
          : d.by == null ? 'Krill\'s loader has no load script: a part loads a file by its name (or the next in the directory), or in builds of version 146 and older by its track and sector; no call in the files\' code says which'
          : 'Krill\'s loader has no load script: a part loads a file by its name, or the next file in the directory with an empty name, so the directory is the order they load in'}; cc1541's command line rebuilds the disk{lines ? `; ${lines} more line${lines === 1 ? '' : 's'} of the directory without a file of ${lines === 1 ? 'its' : 'their'} own` : ''}</span></span>
        <button className="btn small" onClick={() => onCopy(cc1541Script(d, disk.name).join('\n'), 'Copied the cc1541 command line')}><Icon name="copy" size={14} />Copy script</button>
        <FileButtons n={d.files.length} onExport={onExportFiles} onSave={onSaveFiles} saveTitle="Save every file as it is on the disk and unpacked to a folder, with cc1541's command line that writes the disk again" />
      </div>
      <table className="tbl" aria-label="Krill files"><thead><tr><th>Entry</th><th>Name</th><th>Loads</th><th>Unpacks to</th><th>Bytes</th><th>File</th><th>Notes</th><th /></tr></thead><tbody>
        {d.files.map((f, i) => {
          const name = krillFileName(f), u = f.unpacked;
          return (
            <tr key={krillFileTs(f)} className={cx(open.has(f) && 'on')} {...mark(open.has(f), u ? `Open ${name} unpacked, as a PRG at $${h4(u.start)}` : `Open ${name} as a PRG at $${h4(f.load)}, as it loads`)} onClick={() => onOpenFile(f, false)}>
              <td className="mono">{f.entry >= 0 ? `$${h2(f.entry)}` : <span className="muted">{krillFileTs(f)}</span>}</td>
              <td className="mono">{f.entry >= 0 ? `"${d.entries[f.entry].name}"` : <span className="muted">not in the directory</span>}</td>
              <td className="mono">${h4(f.load)}–${h4(f.end - 1)}</td>
              <td className="mono">{u ? `$${h4(u.start)}–$${h4(u.end - 1)}` : <span className="muted">—</span>}</td>
              <td className="mono">{u ? `${f.bytes.length} → ${u.end - u.start}` : f.bytes.length}</td>
              <td className="mono">{name}</td>
              <td className="muted">{notes(f, i)}</td>
              <td><button className="icon-btn" title={`Add ${name} to this project`} aria-label={`Add ${name} to this project`} onClick={e => { e.stopPropagation(); onOpenFile(f, true); }}><Icon name="plus" size={13} /></button></td>
            </tr>
          );
        })}
      </tbody></table>
      {d.calls.length > 0 && (
        <table className="tbl" aria-label="Krill calls"><thead><tr><th>In</th><th>At</th><th>Calls</th><th>Script line</th><th>File</th></tr></thead><tbody>
          {d.calls.map(c => {
            const f = d.files[c.file];
            return (
              <tr key={`${c.in}:${c.jsr}:${c.entry ?? ''}`} className={cx(open.has(f) && 'on')} {...mark(open.has(f), `Open ${krillFileName(f)}`)} onClick={() => onOpenFile(f, false)}>
                <td className="mono">{krillFileName(d.files[c.in])}</td>
                <td className="mono">${h4(c.at)}</td>
                <td className="mono">${h4(c.to)}</td>
                <td className="mono script-line"><span className="syn-label">{krillCallText(c, d)}</span></td>
                <td className="mono">{krillFileName(f)}</td>
              </tr>
            );
          })}
        </tbody></table>
      )}
    </div>
  );
}

/** The Covert script tab (spec 13.5l): a disk for the Covert Bitops loader, its directory's files a row each; a row
 *  opens the file as a PRG, unpacked when it is packed (a raw file where the program's call puts it, else at
 *  COVERT_RAW_AT), + adds it. Below, the script: the calls of the loader read from the code on the disk, and the
 *  command file and command line of Cadaver's tool (makedisk or maked64) that writes the disk again. Copy script copies
 *  them; Save files… saves every file as it is on the disk and unpacked, with the command file. */
export function CovertPanel({ disk, open, onCopy, onOpenFile, onExportFiles, onSaveFiles }: { disk: MountedDisk; open: InProject; onCopy: (text: string, what: string) => void; onOpenFile: (f: CovertFile, add: boolean) => void; onExportFiles: () => void; onSaveFiles: () => void }) {
  const d = disk.covert!;
  const script = covertScript(d, disk.name), text = covertScriptText(script);
  const n = d.files.length, unpacked = d.files.filter(f => f.unpacked).length, lines = d.entries.filter(e => !e.file).length;
  const notes = (f: CovertFile) => {
    const e = d.entries[f.entry], u = f.unpacked, calls = d.calls.filter(c => c.file === f.entry);
    return [
      u ? `${COVERT_PACKER[u.packer].name} (${COVERT_PACKER[u.packer].how})` : f.basic ? 'a BASIC program: loaded with LOAD and RUN' : 'not packed: loaded as it is',
      u && u.start == null && `raw: the program says where; opens at $${h4(COVERT_RAW_AT)}`,
      f.code && `the loader's own code (version ${f.code})`,
      calls.length && `loaded by ${calls.map(c => `$${h4(c.at)}`).join(', ')}`,
      `from ${f.sectors[0][0]}/${f.sectors[0][1]}`,
      e.blocks !== f.sectors.length && `the directory shows ${e.blocks} block${e.blocks === 1 ? '' : 's'} (${f.sectors.length})`,
    ].filter(Boolean).join(' · ');
  };
  const prgAt = (f: CovertFile) => f.unpacked ? f.unpacked.start ?? COVERT_RAW_AT : f.load;
  return (
    <div className="xref spindle">
      <div className="xref-head spindle-head">
        <span>Files of {disk.name} (Covert Bitops loader{d.version ? `, version ${d.version}` : ''}): {n} file{n === 1 ? '' : 's'}, {unpacked} unpacked <span className="muted">· the loader has no load script: the program asks for a file by its name{d.version === 3 ? ' (a number in A, the name\'s first two characters as hex digits)' : ' (two letters in X and Y, or a pointer to the name)'}, so the calls in its code and {script.tool}'s command file are the script; {d.found === 'code' ? "the loader's own code is on the disk" : 'found by its files, packed as the loader reads them'}{d.tool ? `; laid out by ${d.tool}` : '; laid out by neither makedisk nor maked64'}{lines ? `; ${lines} more line${lines === 1 ? '' : 's'} of the directory without a file of ${lines === 1 ? 'its' : 'their'} own` : ''}</span></span>
        <button className="btn small" onClick={() => onCopy(text.join('\n'), `Copied the ${script.tool} command file`)}><Icon name="copy" size={14} />Copy script</button>
        <FileButtons n={d.files.length} onExport={onExportFiles} onSave={onSaveFiles} saveTitle={`Save every file as it is on the disk and unpacked to a folder, with ${script.tool}'s command file that writes the disk again`} />
      </div>
      <table className="tbl" aria-label="Covert files"><thead><tr><th>Entry</th><th>Name</th><th>Loads</th><th>Unpacks to</th><th>Bytes</th><th>File</th><th>Notes</th><th /></tr></thead><tbody>
        {d.files.map(f => {
          const name = covertFileName(f), u = f.unpacked;
          return (
            <tr key={f.entry} className={cx(open.has(f) && 'on')} {...mark(open.has(f), u ? `Open ${name} unpacked, as a PRG at $${h4(prgAt(f))}` : `Open ${name} as a PRG at $${h4(f.load)}, as it loads`)} onClick={() => onOpenFile(f, false)}>
              <td className="mono">${h2(f.entry)}</td>
              <td className="mono">"{d.entries[f.entry].name}"</td>
              <td className="mono">{u ? <span className="muted">packed</span> : `$${h4(f.load)}–$${h4(Math.min(f.load + f.data.length - 2, 0x10000) - 1)}`}</td>
              <td className="mono">{u ? (u.start != null ? `$${h4(u.start)}–$${h4(u.end! - 1)}` : <span className="muted">raw</span>) : <span className="muted">—</span>}</td>
              <td className="mono">{u ? `${f.data.length} → ${u.bytes.length}` : f.data.length}</td>
              <td className="mono">{name}</td>
              <td className="muted">{notes(f)}</td>
              <td><button className="icon-btn" title={`Add ${name} to this project`} aria-label={`Add ${name} to this project`} onClick={e => { e.stopPropagation(); onOpenFile(f, true); }}><Icon name="plus" size={13} /></button></td>
            </tr>
          );
        })}
      </tbody></table>
      {d.calls.length > 0 && (
        <table className="tbl" aria-label="Covert calls"><thead><tr><th>At</th><th>In</th><th>Loads</th><th>Call</th></tr></thead><tbody>
          {d.calls.map(c => {
            const f = d.files.find(x => x.entry === c.file), on = !!f && open.has(f);
            return (
              <tr key={`${c.in}:${c.at}`} className={cx(on && 'on')} {...mark(on)}>
                <td className="mono">${h4(c.at)}</td>
                <td className="mono">${h2(c.in)}</td>
                <td className="mono">"{d.entries[c.file].name}"</td>
                <td className="mono">{covertCallText(c, d)}</td>
              </tr>
            );
          })}
        </tbody></table>
      )}
      <pre className="covert-script mono" aria-label="Covert script">{[...script.seq, '', script.command].join('\n')}</pre>
    </div>
  );
}

/** The DLoC script tab (spec 13.5n): a disk for DLoC's loader (Six/Dark Lords of Chaos), its directory's files a row
 *  each in the order they load; a row opens the file as a PRG, unpacked when it is packed (the boot: what Six's packer
 *  unpacks it to), + adds it. Below, the calls of the loader read from the parts' code, and the script: each file in
 *  that order with its calls, and c1541's command line that writes the disk again. Copy script copies it; Save files…
 *  saves every file as it is on the disk and unpacked, with the script. */
export function DlocPanel({ disk, open, onCopy, onOpenFile, onExportFiles, onSaveFiles }: { disk: MountedDisk; open: InProject; onCopy: (text: string, what: string) => void; onOpenFile: (f: DlocFile, add: boolean) => void; onExportFiles: () => void; onSaveFiles: () => void }) {
  const d = disk.dloc!;
  const text = dlocScriptText(dlocScript(d, disk.name));
  const n = d.files.length, unpacked = d.files.filter(f => f.unpacked || f.boot).length;
  const rows = [...d.order, ...d.files.map(f => f.entry).filter(e => !d.order.includes(e))].map(e => d.entries[e].file!);
  const notes = (f: DlocFile) => {
    const e = d.entries[f.entry], u = f.unpacked, by = d.calls.filter(c => c.file === f.entry), named = d.names.filter(x => x.file === f.entry);
    return [
      f.boot ? `the boot (LOAD and RUN), packed with Six's packer: starts at $${h4(f.boot.run)} when it has unpacked itself` : f.basic ? 'a BASIC program: loaded with LOAD and RUN'
        : u ? `ZX0, unpacked while it loads; starts at $${h4(u.run)}` : 'not packed: loaded or read as it is',
      f.code && "the loader's own code",
      by.length && `${by.some(c => c.routine === 'load') ? 'loaded' : 'opened'} by ${by.map(c => `$${h4(c.at)} in "${d.entries[c.in].name}"`).join(', ')}`,
      named.length && `named in ${named.map(x => `"${d.entries[x.in].name}" at $${h4(x.at)}`).join(', ')}`,
      `from ${f.sectors[0][0]}/${f.sectors[0][1]}`,
      e.blocks !== f.sectors.length && `the directory shows ${e.blocks} block${e.blocks === 1 ? '' : 's'} (${f.sectors.length})`,
    ].filter(Boolean).join(' · ');
  };
  return (
    <div className="xref spindle">
      <div className="xref-head spindle-head">
        <span>Files of {disk.name} (DLoC's loader): {n} file{n === 1 ? '' : 's'}, {unpacked} unpacked <span className="muted">· the loader has no load script: a part loads the next by its name (lda #length / ldx #&lt;name / ldy #&gt;name / jmp ${h4(d.base)}), so the calls in the parts' code are the script; {d.found === 'code' ? "the loader's own code is on the disk" : 'found by its files, packed with ZX0 as the loader reads them'}</span></span>
        <button className="btn small" onClick={() => onCopy(text.join('\n'), 'Copied the DLoC script')}><Icon name="copy" size={14} />Copy script</button>
        <FileButtons n={d.files.length} onExport={onExportFiles} onSave={onSaveFiles} saveTitle="Save every file as it is on the disk and unpacked to a folder, with the script and c1541's command line that writes the disk again" />
      </div>
      <table className="tbl" aria-label="DLoC files"><thead><tr><th>Entry</th><th>Name</th><th>Loads</th><th>Unpacks to</th><th>Bytes</th><th>File</th><th>Notes</th><th /></tr></thead><tbody>
        {rows.map(f => {
          const name = dlocFileName(f, d), u = f.unpacked ?? f.boot;
          return (
            <tr key={f.entry} className={cx(open.has(f) && 'on')} {...mark(open.has(f), u ? `Open ${dlocUnpackedName(f, d)}: unpacked, as a PRG at $${h4(u.start)}` : `Open ${name} as a PRG at $${h4(f.load)}, as it loads`)} onClick={() => onOpenFile(f, false)}>
              <td className="mono">${h2(f.entry)}</td>
              <td className="mono">"{d.entries[f.entry].name}"</td>
              <td className="mono">{f.unpacked ? <span className="muted">packed</span> : `$${h4(f.load)}–$${h4(Math.min(f.load + f.data.length - 2, 0x10000) - 1)}`}</td>
              <td className="mono">{u ? `$${h4(u.start)}–$${h4(u.end - 1)}` : <span className="muted">—</span>}</td>
              <td className="mono">{u ? `${f.data.length} → ${u.bytes.length}` : f.data.length}</td>
              <td className="mono">{name}</td>
              <td className="muted">{notes(f)}</td>
              <td><button className="icon-btn" title={`Add ${name} to this project`} aria-label={`Add ${name} to this project`} onClick={e => { e.stopPropagation(); onOpenFile(f, true); }}><Icon name="plus" size={13} /></button></td>
            </tr>
          );
        })}
      </tbody></table>
      {d.calls.length > 0 && (
        <table className="tbl" aria-label="DLoC calls"><thead><tr><th>At</th><th>In</th><th>Routine</th><th>File</th><th>Call</th></tr></thead><tbody>
          {d.calls.map(c => {
            const f = c.file != null ? d.entries[c.file].file : null, on = !!f && open.has(f);
            return (
              <tr key={`${c.in}:${c.jsr}`} className={cx(on && 'on')} {...mark(on)}>
                <td className="mono">${h4(c.at)}</td>
                <td className="mono">"{d.entries[c.in].name}"</td>
                <td>{DLOC_ROUTINE[c.routine]}</td>
                <td className="mono">{c.file != null ? `"${d.entries[c.file].name}"` : <span className="muted">{c.routine === 'load' || c.routine === 'open' ? 'set elsewhere' : '—'}</span>}</td>
                <td className="mono">{dlocCallText(c, d)}</td>
              </tr>
            );
          })}
        </tbody></table>
      )}
      <pre className="covert-script mono" aria-label="DLoC script">{text.join('\n')}</pre>
    </div>
  );
}

/** The Pirate Slayer tab (spec 13.5h): Electronic Arts' copy protection on the mounted disk: its key track (on a G64:
 *  where, how framed, each copy a turn), the boot and what it does, where the drive's check is, the boot's text, and
 *  the files outside the directory, a row each: a row opens the file as a PRG at its load address, decoded; + adds it.
 *  Save files… saves them all, decoded, with files.txt that lists them; Copy list copies that list. */
export function PirateSlayerPanel({ disk, open, onCopy, onOpenFile, onExportFiles, onSaveFiles }: { disk: MountedDisk; open: InProject; onCopy: (text: string, what: string) => void; onOpenFile: (f: PirateSlayerFile, add: boolean) => void; onExportFiles: () => void; onSaveFiles: () => void }) {
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
          <FileButtons n={p.files.length} onExport={onExportFiles} onSave={onSaveFiles} saveTitle="Save every file outside the directory as a PRG to a folder, decoded, with files.txt that lists them" />
        </div>
        <table className="tbl ps-files" aria-label="Pirate Slayer files"><thead><tr><th>From</th><th>Blocks</th><th>Loads</th><th>Bytes</th><th>Name</th><th>Notes</th><th /></tr></thead><tbody>
          {p.files.map(f => {
            const name = pirateSlayerFileName(f), past = f.load + f.bytes.length - f.end;
            return (
              <tr key={`${f.track}/${f.sector}`} className={cx(open.has(f) && 'on')} {...mark(open.has(f), `Open ${name} as a PRG at $${h4(f.load)}${f.key ? `, decoded (XOR $${hex(f.key)})` : ''}`)} onClick={() => onOpenFile(f, false)}>
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

/** The Para-Protect tab (spec 13.5o): Para-Protect's boot on the mounted disk (how it loads, its STOP-vector code, the
 *  drive command, how the drive's loader steps from sector to sector) and the files the directory does not list, a row
 *  each: the boot's requests (pages by track and sector), pages past track 35 a game asks for itself, and a game's own
 *  directory's files (Bangkok Knights). A row opens the file as a PRG at its load address; + adds it. Save files… saves
 *  them all with files.txt that lists them; Copy list copies that list. */
export function ParaProtectPanel({ disk, open, onCopy, onOpenFile, onExportFiles, onSaveFiles }: { disk: MountedDisk; open: InProject; onCopy: (text: string, what: string) => void; onOpenFile: (f: ParaProtectFile, add: boolean) => void; onExportFiles: () => void; onSaveFiles: () => void }) {
  const p = disk.paraprotect!, b = p.boot, st = p.stepping;
  const KIND: Record<ParaProtectFile['kind'], string> = { loader: 'Loader', page: 'Page', own: "Game's" };
  const steps = `${st.step} sector${st.step === 1 ? '' : 's'} on, ${st.counts ? `tracks of ${st.counts[3]}, ${st.counts[2]}, ${st.counts[1]} and ${st.counts[0]} sectors by zone (its own table, read from its code on ${st.from})` : "the DOS's sectors a track"}, the next track's sector 0 when it comes round to 0`;
  return (
    <div className="xref spindle">
      <div className="xref-head spindle-head">
        <span>{p.summary} <span className="muted">· Sindri runs the boot with {disk.name} in its drive{p.format === 'G64' ? ', every track as it is' : ''}; a 1541-II's ROM breaks some of the drive code (it runs bytes of the DOS ROM), so VICE needs drive type 1541 for these disks</span></span>
      </div>
      <div className="ps-notes">
        {b && <p><b>Boot ({b.label}, {b.blocks} blocks at ${h4(b.load)}):</b> it loads over LOAD's pointer at $AE/$AF and over the STOP vector at $0328, which the KERNAL calls before every byte it takes ({b.calls} calls here), so its own code decodes the rest as it comes in; LOAD ends at ${h4(b.end)} and returns into the stack page it filled. {b.command ? <>It has the drive run <span className="mono">{b.command}</span>, whose bytes read the drive code from track 18. </> : 'It has the drive read its code from track 18. '}{b.stub >= 0 ? <>Its loader stub (at ${h4(b.stub)}, copied to ${h4(b.stubAt)}) takes the request X from a table: {b.requests.length} request{b.requests.length === 1 ? '' : 's'}.</> : 'No loader table was found in it.'}</p>}
        <p><b>The drive's loader</b> takes a number of pages, a track and a sector (bit 7: back to the DOS after it), finds each sector's header as the DOS does and takes the data block after it whatever its first byte{p.ids === 'sector' ? ' (here the sector\'s number, not the $07 the DOS wants: a 1541\'s DOS reads none of them)' : p.ids === 'mixed' ? ' (here $07 and the sector\'s number)' : ''}, going {steps}. The C64 gets two bits at a time.</p>
        {p.ownDirectory && <p><b>The game's own directory</b> is at {p.ownDirectory.sectors.join(' → ')}: sector chains as the DOS's, each data block right after its header with no SYNC between (the DOS cannot read them){p.ownDirectory.track === 11 && p.ownDirectory.sector === 0 ? '; 11/0 has no SYNC before its header either' : ''}.</p>}
      </div>
      {p.files.length > 0 && <>
        <div className="xref-head spindle-head">
          <span>Files the directory does not list: {p.files.length} <span className="muted">· loader files are named after their first sector and load address, the game's own files keep their names</span></span>
          <button className="btn small" onClick={() => onCopy(paraProtectFileList(p, disk.name).join('\n'), 'Copied the file list')}><Icon name="copy" size={14} />Copy list</button>
          <FileButtons n={p.files.length} onExport={onExportFiles} onSave={onSaveFiles} saveTitle="Save every file as a PRG to a folder, with files.txt that lists them" />
        </div>
        <table className="tbl ps-files" aria-label="Para-Protect files"><thead><tr><th>Kind</th><th>From</th><th>Sectors</th><th>Loads</th><th>Bytes</th><th>Name</th><th>Notes</th><th /></tr></thead><tbody>
          {p.files.map(f => {
            const past = f.load + f.bytes.length - f.end;
            return (
              <tr key={`${f.kind}:${f.track}/${f.sector}:${f.name}`} className={cx(open.has(f) && 'on')} {...mark(open.has(f), `Open ${f.name} as a PRG at ${h4(f.load)}`)} onClick={() => onOpenFile(f, false)}>
                <td>{KIND[f.kind]}</td>
                <td className="mono">{f.track}/{f.sector}</td>
                <td className="mono" title={f.sectors.join(' ')}>{f.sectors.length}</td>
                <td className="mono">${h4(f.load)}–${h4(f.end - 1)}</td>
                <td className="mono">{f.bytes.length}</td>
                <td className="mono">{f.name}</td>
                <td className="muted">{[f.note, f.bad ? `${f.bad} sector${f.bad === 1 ? '' : 's'} with a wrong checksum` : '', f.missing ? `${f.missing} sector${f.missing === 1 ? '' : 's'} not on the image` : '', past > 0 ? `the ${past} bytes past $FFFF are left out` : ''].filter(Boolean).join(' · ')}</td>
                <td><button className="icon-btn" title={`Add ${f.name} to this project`} aria-label={`Add ${f.name} to this project`} onClick={e => { e.stopPropagation(); onOpenFile(f, true); }}><Icon name="plus" size={13} /></button></td>
              </tr>
            );
          })}
        </tbody></table>
      </>}
    </div>
  );
}

/** The Disk-Speed tab (spec 13.5p): Morse Technology's loader on the mounted disk: the boot (what it loads over, the
 *  drive command it sends, the call it makes between files), the drive code's two stages (the DOS reads whose status is
 *  the key, the sectors it decodes with it), how the second stage steps from sector to sector, and the files of its
 *  table, a row each. A row opens the file as a PRG at its load address, as the C64 gets it (the disk holds every byte
 *  inverted); + adds it. Save files… saves them all with files.txt that lists them; Copy list copies that list. */
export function DiskSpeedPanel({ disk, open, onCopy, onOpenFile, onExportFiles, onSaveFiles }: { disk: MountedDisk; open: InProject; onCopy: (text: string, what: string) => void; onOpenFile: (f: DiskSpeedFile, add: boolean) => void; onExportFiles: () => void; onSaveFiles: () => void }) {
  const p = disk.diskspeed!, b = p.boot, st = p.stepping;
  const ts = (x: { track: number; sector: number }) => `${x.track}/${x.sector}`;
  const byte = (n: number) => `$${n.toString(16).toUpperCase().padStart(2, '0')}`;
  return (
    <div className="xref spindle">
      <div className="xref-head spindle-head">
        <span>{p.summary} <span className="muted">· Sindri runs the boot with {disk.name} in its drive{p.format === 'G64' ? ', every track as it is' : ''}</span></span>
      </div>
      <div className="ps-notes">
        {b && <p><b>Boot ({b.name}, {b.blocks} blocks at ${h4(b.load)}–${h4(b.end - 1)}):</b> it loads over the KERNAL&apos;s vectors, so the next thing BASIC prints (READY.) runs it. It decodes three pages of itself, opens buffer 2 in the drive and sends {b.command ? <span className="mono">{b.command}</span> : 'a B-E command'}, so the DOS reads {ts(p.stage1)} into ${h4(p.stage1.at)} and runs it.{b.hook ? <> Between files it calls ${h4(b.hook.at)} (JSR) when {b.hook.left} file{b.hook.left === 1 ? ' is' : 's are'} left.</> : ''}</p>}
        <p><b>The drive code at {ts(p.stage1)}</b> has the DOS read {p.checks.map(c => `${ts(c)} (status ${byte(c.status)})`).join(' and ')}: {p.keyFrom === 'errors' ? <>their wrong checksums are the key, <span className="mono">{byte(p.key)}</span>, the status ANDed. A copy that reads them right gets $01 and garbage.</> : <>this image reads them without an error (a copy, or a D64 without error bytes), so a 1541 would get the key $01; the key here, <span className="mono">{byte(p.key)}</span>, is worked out from the next stage&apos;s first instruction.</>} It then reads {p.stage2.map(r => `${ts(r)} into $${h4(r.at)}`).join(' and ')} itself (by their headers, with the disk&apos;s ID), EORs them with the key and runs them.</p>
        <p><b>The next stage</b> reads the table at {ts(p.table)} and sends it, then the files from {ts(p.data)}: {st.step} sectors on each time round a track of {st.count}, the next track {st.down ? 'down' : 'up'} when it comes round to 0. The C64 gets two bits at a time, 128 bytes a turn, every byte inverted on the disk; it checks each file&apos;s sum and starts the program at ${h4(p.start)} with an RTS.</p>
        {p.text && <p><b>Its text</b> (in the BAM): <span className="mono">{p.text}</span></p>}
      </div>
      {p.files.length > 0 && <>
        <div className="xref-head spindle-head">
          <span>Files of the loader&apos;s table: {p.files.length} <span className="muted">· the directory lists only the boot; they keep the table&apos;s names{p.files.some(f => !f.label) ? ' (named after their place in it and their load address where it has none)' : ''}</span></span>
          <button className="btn small" onClick={() => onCopy(diskSpeedFileList(p, disk.name).join('\n'), 'Copied the file list')}><Icon name="copy" size={14} />Copy list</button>
          <FileButtons n={p.files.length} onExport={onExportFiles} onSave={onSaveFiles} saveTitle="Save every file as a PRG to a folder, as the C64 gets it, with files.txt that lists them" />
        </div>
        <table className="tbl ps-files" aria-label="Disk-Speed files"><thead><tr><th>#</th><th>Name</th><th>From</th><th>Sectors</th><th>Loads</th><th>Bytes</th><th>Sum</th><th>Notes</th><th /></tr></thead><tbody>
          {p.files.map(f => {
            const past = f.load + f.bytes.length - f.end;
            return (
              <tr key={f.index} className={cx(open.has(f) && 'on')} {...mark(open.has(f), `Open ${f.name} as a PRG at ${h4(f.load)}`)} onClick={() => onOpenFile(f, false)}>
                <td className="mono">{f.index + 1}</td>
                <td className="mono">{f.name}</td>
                <td className="mono">{ts(f)}</td>
                <td className="mono" title={f.sectors.join(' ')}>{f.sectors.length}</td>
                <td className="mono">${h4(f.load)}–${h4(f.end - 1)}</td>
                <td className="mono">{f.bytes.length}</td>
                <td className={cx('mono', !f.ok && 'err')}>{byte(f.sum)} {f.ok ? '✓' : '✗'}</td>
                <td className="muted">{[f.note, f.bad ? `${f.bad} sector${f.bad === 1 ? '' : 's'} with an error` : '', f.missing ? `${f.missing} sector${f.missing === 1 ? '' : 's'} not on the image` : '', past > 0 ? `the ${past} bytes past $FFFF are left out` : ''].filter(Boolean).join(' · ')}</td>
                <td><button className="icon-btn" title={`Add ${f.name} to this project`} aria-label={`Add ${f.name} to this project`} onClick={e => { e.stopPropagation(); onOpenFile(f, true); }}><Icon name="plus" size={13} /></button></td>
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
 *  A TapeTool tape has TapeTool's command lines that write it again from its files, which Save files… saves with them.
 *  A T64 tape archive (13.5j): its directory, an entry a row. */
export function TapePanel({ tape, open, onCopy, onOpenFile, onExportFiles, onSaveFiles }: { tape: MountedTape; open: InProject; onCopy: (text: string, what: string) => void; onOpenFile: (f: TapeFile, add: boolean) => void; onExportFiles: () => void; onSaveFiles: () => void }) {
  const { img } = tape;
  const tt = tapeToolScript(img, tape.name);
  const FORMAT: Record<TapeFile['format'], string> = { cbm: 'KERNAL', tapetool: 'TapeTool', turbotape: 'Turbo Tape', freeload: 'Freeload', usgold: 'US Gold', megasave: 'Mega-Save', novaload: 'Novaload', wildload: 'Wildload', microload: 'Microload', cyberload: 'Cyberload', firebird: 'Firebird', t64: 'T64' };
  const t64 = img.t64;
  const time = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
  const notes = (f: TapeFile) => [
    f.format === 'cbm' && f.copies ? `header ${f.copies[0]}×, data ${f.copies[1]}×` : '',
    f.headerCode ? 'the header holds code (the tape buffer at $033c)' : '',
    f.tiny ? 'TinyHeader: the boot loader knows where it goes' : '',
    f.format === 'tapetool' && !f.tiny ? `name byte ${f.id}, ${f.blocks} block${f.blocks === 1 ? '' : 's'}${f.packed ? ` (${f.packed} RLE packed)` : ''}${f.shuffled ? ', in random order' : ''}${f.interleaved ? ', mixed with the file before' : ''}` : '',
    f.t64 && f.load != null && f.t64.fileType !== 0x82 ? `1541 type $${f.t64.fileType.toString(16).padStart(2, '0')}` : '',
    f.note ?? '', ...f.errors,
  ].filter(Boolean).join(' · ');
  const rows = [...img.files.map(f => ({ at: f.at, f, u: null as TapeUnknown | null })), ...img.unknown.map(u => ({ at: u.at, f: null as TapeFile | null, u }))].sort((a, b) => a.at - b.at);
  return (
    <div className="xref spindle">
      <div className="xref-head spindle-head">
        <span>{tape.name} ({t64 ? `a T64${t64.name ? ` "${t64.name}"` : ''}, version $${t64.version.toString(16).padStart(4, '0')}, ${t64.signature}` : `TAP version ${img.version}, ${time(img.seconds)}`}): {img.files.length} file{img.files.length === 1 ? '' : 's'}{img.unknown.length ? `, ${img.unknown.length} stretch${img.unknown.length === 1 ? '' : 'es'} of turbo data no format here reads` : ''} <span className="muted">· {[tt ? 'TapeTool’s command lines write the tape again from its files (Save files… saves them with the lines as build.bat)' : '', img.unknown.length ? 'an unknown loader’s data is read by Sindri, running the boot file with the tape in its datasette' : 'a file opens with the tape in Sindri’s datasette, after the file'].filter(Boolean).join('; ')}</span></span>
        {tt && <button className="btn small" onClick={() => onCopy(tt.script.join('\n'), 'Copied the TapeTool command lines')}><Icon name="copy" size={14} />Copy script</button>}
        <FileButtons n={img.files.filter(tapeOpens).length} onExport={onExportFiles} onSave={onSaveFiles} saveTitle={tt ? 'Save every file of the tape, boot.bin and build.bat (TapeTool’s command lines) to a folder' : 'Save every file of the tape as a PRG to a folder'} />
      </div>
      <table className="tbl tape-table" aria-label="Tape files"><thead><tr><th>{t64 ? 'Entry' : 'Time'}</th><th>Offset</th><th>Format</th><th>Name</th><th>Loads</th><th>Bytes</th><th>Notes</th><th /></tr></thead><tbody>
        {rows.map(({ f, u }, i) => {
          if (u) return (
            <tr key={`u${i}`} className="muted" title="Turbo data of a loader not known here: open the boot file, and Sindri reads it with the tape in its datasette">
              <td className="mono">{time(u.seconds)}</td><td className="mono">${u.offset.toString(16)}</td><td>turbo</td><td className="muted">—</td><td className="muted">—</td>
              <td className="mono">{u.pulses} pulses</td><td>{u.short && u.long ? `pulses of ${u.short} and ${u.long} cycles` : ''}</td><td />
            </tr>
          );
          const file = f!, can = file.load != null && file.data.length > 0 && file.type !== 'SEQ' && file.type !== 'END';
          return (
            <tr key={`f${i}`} className={cx(!can && 'muted', open.has(file) && 'on')} {...mark(open.has(file), can ? `Open ${file.name}${file.headerCode ? ' and its header' : ''}` : undefined)} onClick={() => { if (can) onOpenFile(file, false); }}>
              <td className="mono">{t64 ? file.id : time(file.seconds)}</td>
              <td className="mono">${file.offset.toString(16)}</td>
              <td>{FORMAT[file.format]}{file.format === 'cbm' ? ` ${file.type}` : file.format === 't64' ? ` ${file.load == null ? 'FRZ' : file.type}` : ''}</td>
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
export function BoozePanel({ A, disk, open, onNavigate, onCopy, onOpenFile, onExportFiles, onSaveFiles }: { A: AnalysisResult; disk: MountedDisk | null; open: InProject; onNavigate: (a: Addr) => void; onCopy: (text: string, what: string) => void; onOpenFile: (f: BoozeFile, add: boolean) => void; onExportFiles: () => void; onSaveFiles: () => void }) {
  if (!disk?.booze && !A.booze?.steps.length) return <div className="empty">No BoozeLoader script: a BoozeLoader disk keeps its files in a table of its own, and a program with BoozeLoader calls it with each file's number.</div>;
  return (
    <>
      {disk?.booze && <BoozeDiskSection disk={disk} open={open} onCopy={onCopy} onOpenFile={onOpenFile} onExportFiles={onExportFiles} onSaveFiles={onSaveFiles} />}
      {!!A.booze?.steps.length && <BoozeScriptSection A={A} disk={disk} open={open} onNavigate={onNavigate} onCopy={onCopy} onOpenFile={onOpenFile} />}
    </>
  );
}

/** A BoozeLoader disk's files (spec 13.5d), a row each. */
function BoozeDiskSection({ disk, open, onCopy, onOpenFile, onExportFiles, onSaveFiles }: { disk: MountedDisk; open: InProject; onCopy: (text: string, what: string) => void; onOpenFile: (f: BoozeFile, add: boolean) => void; onExportFiles: () => void; onSaveFiles: () => void }) {
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
        <FileButtons n={d.files.length} onExport={onExportFiles} onSave={onSaveFiles} saveTitle="Save every file to a folder as a PRG, unpacked when it is packed, and as it is on the disk, with the list of them" />
      </div>
      <table className="tbl" aria-label="BoozeLoader files"><thead><tr><th>File</th><th>Loads</th><th>Unpacks to</th><th>Bytes</th><th>Name</th><th>Notes</th><th /></tr></thead><tbody>
        {d.files.map(f => {
          const name = boozeFileName(f), u = f.unpacked;
          return (
            <tr key={`${f.track}/${f.sector}`} className={cx(open.has(f) && 'on')} {...mark(open.has(f), u ? `Open ${name} unpacked, as a PRG at $${h4(u.start)}` : `Open ${name} as a PRG at $${h4(f.load)}, as it loads`)} onClick={() => onOpenFile(f, false)}>
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
function BoozeScriptSection({ A, disk, open, onNavigate, onCopy, onOpenFile }: { A: AnalysisResult; disk: MountedDisk | null; open: InProject; onNavigate: (a: Addr) => void; onCopy: (text: string, what: string) => void; onOpenFile: (f: BoozeFile, add: boolean) => void }) {
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
            <tr key={s.jsr} className={cx(first && i > 0 && 'job-first', !!f && open.has(f) && 'on')} {...mark(!!f && open.has(f), `Go to $${h4(s.at)}`)} onClick={() => onNavigate(s.at)}>
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
  // the project's assembler (spec 11.8): KickAss.jar with Java, or 64tass as the main process runs it (run64tass)
  const tass = S.assembler === '64tass', tool = tass ? '64tass' : 'KickAss.jar';
  const kick = (entry: string) => {
    if (!tass) return `${q(S.javaPath)} -jar ${q(S.kickJar)} ${entry} -odir ${S.outDir} ${S.kickArgs}`;
    const base = entry.replace(/\.asm$/i, ''), image = /\.crt$/i.test(base);
    return `${q(S.tassPath || '64tass')} ${image ? '-a -C --nostart -X' : '-a -C --cbm-prg'}${S.tassArgs ? ` ${S.tassArgs}` : ''} -o ${S.outDir}/${image ? base : `${base}.prg`} --vice-labels -l ${S.outDir}/${base}.vs ${entry}`;
  };
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
              ? <span className={cx('rounded border px-2 py-0.5', build.kick.ok ? 'border-ok text-ok' : 'border-err text-err')}>{tool}: {build.kick.ok ? 'byte-identical' : `${build.kick.problems.length} problem${build.kick.problems.length === 1 ? '' : 's'}`}</span>
              : <span className="rounded border border-line-2 px-2 py-0.5 text-fg-3">{tool}: not run (set its path in Settings → Toolchain)</span>}
            {build.cart && <span className={cx('rounded border px-2 py-0.5', build.cart.ok && (!build.kick?.cart || build.kick.cart.ok) ? 'border-ok text-ok' : 'border-err text-err')}>{build.cart.name}: {build.cart.ok && (!build.kick?.cart || build.kick.cart.ok) ? 'byte-identical' : 'differences'}</span>}
          </div>
          <pre className={cx('build-log', build.ok ? 'ok' : 'bad', stale && 'stale')}>{stale && '(project changed since this run — verify again)\n'}{build.log}</pre>
        </>
      ) : <div className="empty small">Run “Verify round-trip” to re-assemble the generated source with the built-in verifier and, when {tool} is configured, with the real {tass ? '64tass' : 'Kick Assembler'}, then compare every byte with the original PRG.</div>}
    </div>
  );
}

export const BOTTOM_TABS: [BottomTab, string][] = [['log', 'Analysis log'], ['messages', 'Messages'], ['problems', 'Problems'], ['xrefs', 'Cross-references'], ['irqs', 'Raster IRQs'], ['relocs', 'Relocated'], ['spindle', 'Spindle script'], ['bitfire', 'Bitfire script'], ['booze', 'Booze script'], ['sparkle', 'Sparkle script'], ['krill', 'Krill script'], ['iffl', 'IFFL parts'], ['covert', 'Covert script'], ['dloc', 'DLoC script'], ['pirateslayer', 'Pirate Slayer'], ['paraprotect', 'Para-Protect'], ['diskspeed', 'Disk-Speed'], ['tape', 'Tape'], ['stats', 'Statistics'], ['build', 'Build output']];
