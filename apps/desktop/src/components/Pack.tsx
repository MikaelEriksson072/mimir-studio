/* Pack (spec 13.8): Brokkr, the built-in cruncher, or Exomizer packs the PRG that Build & Run builds, whole or the
 * blocks you choose, as a self-extracting program (sfx) or as crunched data for your own decruncher (mem). The view sits
 * in the sidebar, so the listing beside it shows the blocks you choose. It shows only the settings that take effect
 * with the packer, format and kind of file chosen (packOptions); they are kept in the project. Pack builds, verifies
 * and packs. */
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { editRanges, extraProblem, h2, h4, keepText, kindInfo, loadAddress, loadRange, MEMORY_PLACES, mergeRanges, packDecruncher, packEffective, packNeeds, packOptions, packProblem, parseKeep, placeSpan, ZP_PLACES, type PackPlace, rangeCover, relocAt, type Addr, type AnalysisResult, type FileInput, type PackFormat, type PackPrefs, type Project, type RenderResult } from '@mimir/core';
import type { PackResponse } from '../../shared/ipc';
import { Icon } from '../lib/icons';
import { SideSection } from './SideSection';
import { packCommand, packWarning } from '../lib/pack';
import { cx, fmtBytes, groupOfKind } from '../lib/util';
import type { Sel } from '../lib/types';

/** the last pack, with the fingerprint of what it packed (prefs and build) */
export interface PackResult extends PackResponse { key: string }

/** a pack under way: building and verifying first, then packing (crunching and checking) with these settings;
 * `before`: what comes before packing, as the card names it (missing: building and verifying; null: nothing) */
export interface PackProgress { step: 'verify' | 'pack'; since: number; prefs: PackPrefs; before?: { title: string; doing: string } | null }

const BUILD_FIRST = { title: 'Build and verify the program', doing: 'Building and verifying…' };

export interface PackViewProps {
  A: AnalysisResult; R: RenderResult; project: Project; cursor: Addr | null; sel: Sel | null;
  prefs: PackPrefs;
  /** Exomizer from the toolchain settings ('' = none) */
  exomizer: string;
  desktop: boolean;
  /** what the app is busy with (Verifying, Packing…), or null */
  busy: string | null;
  /** the pack under way, or null */
  packing: PackProgress | null;
  result: PackResult | null;
  /** the fingerprint of what would be packed now: a result with another one is out of date */
  current: string;
  onChange: (p: PackPrefs, label: string) => void;
  onPack: () => void; onRun: () => void; onSave: () => void; onLog: () => void; onSettings: () => void;
  /** one of the files the pack wrote, through a save dialog */
  onSaveFile: (f: { name: string; prg: Uint8Array }) => void;
  /** a dialog for the folder the packed file is written to (`PackPrefs.dir`) */
  onPickDir: () => void;
  onNavigate: (a: Addr) => void;
}

/** what Brokkr's own formats give and cost, measured on the reference corpus against Exomizer 3.1.1 */
const FORMAT_NOTE: Record<Exclude<PackFormat, 'exomizer'>, string> = {
  brokkr: "About 8 % smaller than Exomizer's format, but decrunching takes about 9 times as long (half a minute on a large program), with more memory.",
  fast: "About 13 % larger than Exomizer's format, decrunched about twice as fast, without a border flash.",
  auto: 'Packs in all three formats and keeps the smallest file, or the smallest that decrunches within the time set below.',
};

/** how crunched data (mem) is decrunched: Brokkr's stream by its format, or Exomizer's own */
const DECRUNCH: Record<Exclude<PackFormat, 'auto'> | 'exomizer-tool', ReactNode> = {
  'exomizer-tool': <>Decrunch it with Exomizer's <span className="mono">exodecrunch.s</span> (in the Exomizer release, exodecrs\).</>,
  exomizer: <>Decrunch it with Exomizer's <span className="mono">exodecrunch.s</span>, or with Brokkr's: <span className="mono">brokkr decruncher</span> writes it as Kick Assembler source.</>,
  brokkr: <>Decrunched backward by <span className="mono">brokkr decruncher --format brokkr</span> (Kick Assembler source), with 0.5 KB of RAM for its probabilities (1.5 KB to run a third faster).</>,
  fast: <>Decrunched backward by <span className="mono">brokkr decruncher --format fast</span> (Kick Assembler source): 10 bytes of zero page, no tables.</>,
};

/** Scroll an element into the side panel's view (the Pack button sits low, so its cards start out of sight). */
const reveal = (el: HTMLElement | null): void => {
  // newer Chromium returns a promise here: never hand it to useEffect as a cleanup
  void el?.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
};

const parseHex = (s: string, max = 0xffff): number | null | undefined => {
  const t = s.trim().replace(/^(\$|0x)/i, '');
  if (!t) return null;
  if (!/^[0-9a-f]{1,4}$/i.test(t)) return undefined;
  const v = parseInt(t, 16);
  return v <= max ? v : undefined;
};

/** A hex field that commits on Enter or when it loses focus; empty is null. */
function HexField({ id, label, value, max = 0xffff, placeholder, onCommit, help }: { id: string; label: string; value: number | null; max?: number; placeholder?: string; onCommit: (v: number | null) => void; help?: string }) {
  const show = (v: number | null) => (v == null ? '' : `$${max > 0xff ? h4(v) : h2(v)}`);
  const [text, setText] = useState(show(value));
  useEffect(() => setText(show(value)), [value]); // eslint-disable-line react-hooks/exhaustive-deps
  const v = parseHex(text, max);
  const commit = () => { if (v !== undefined && v !== value) onCommit(v); };
  return (
    <div className="field"><label htmlFor={id}>{label}</label>
      <input id={id} className={cx('mono', v === undefined && 'bad')} value={text} placeholder={placeholder} spellCheck={false}
        onChange={e => setText(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }} />
      {v === undefined ? <small className="err-text">A hex number up to ${max > 0xff ? h4(max) : h2(max)}.</small> : help && <small className="muted">{help}</small>}
    </div>
  );
}

/** A time in seconds that commits on Enter or when it loses focus; empty is null. */
function SecondsField({ id, label, value, help, onCommit }: { id: string; label: string; value: number | null; help?: string; onCommit: (v: number | null) => void }) {
  const show = (v: number | null) => (v == null ? '' : String(v));
  const [text, setText] = useState(show(value));
  useEffect(() => setText(show(value)), [value]);
  const t = text.trim(), v = t ? Number(t) : null, bad = v != null && !(v > 0 && v <= 3600);
  const commit = () => { if (!bad && v !== value) onCommit(v); };
  return (
    <div className="field"><label htmlFor={id}>{label}</label>
      <input id={id} className={cx('mono', bad && 'bad')} value={text} placeholder="any time" inputMode="decimal" spellCheck={false}
        onChange={e => setText(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }} />
      {bad ? <small className="err-text">A time in seconds, above 0 and at most 3600.</small> : help && <small className="muted">{help}</small>}
    </div>
  );
}

/** A text field that commits on Enter or when it loses focus (one undo step, not one per key). */
function TextField({ id, label, value, placeholder, error, help, onCommit }: { id: string; label: string; value: string; placeholder?: string; error?: string | null; help?: string; onCommit: (v: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const commit = () => { if (text !== value) onCommit(text); };
  const enter = (e: KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } };
  return (
    <div className="field"><label htmlFor={id}>{label}</label>
      <input id={id} className="mono" value={text} placeholder={placeholder} spellCheck={false} onChange={e => setText(e.target.value)} onBlur={commit} onKeyDown={enter} />
      {error ? <small className="err-text">{error}</small> : help && <small className="muted">{help}</small>}
    </div>
  );
}

/** What a part of the decruncher takes: its bytes (the least and the most), from a multiple of `align`. */
interface PartNeed { min: number; max: number; align?: number }

/** Where a part of the decruncher goes: Auto, one of the places that suit it, or an address of one's own; below it, the
 * bytes it takes and where it would end, or what is wrong with the place. Auto is where Brokkr finds room, or (the
 * decruncher written next to crunched data) an address of its own, `auto.at`, with `auto.note` after where it ends. */
function PlaceField({ id, label, value, places, max, need, clash, auto, onCommit }: { id: string; label: string; value: Addr | null; places: readonly PackPlace[]; max: number; need: PartNeed; clash?: string | null; auto?: { at: Addr; note?: string } | null; onCommit: (v: Addr | null) => void }) {
  const known = (v: Addr | null) => v == null || places.some(p => p.at === v);
  const [own, setOwn] = useState(!known(value));
  useEffect(() => { if (!known(value)) setOwn(true); }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  const hex = (v: number) => `$${max > 0xff ? h4(v) : h2(v)}`;
  const bytes = need.min === need.max ? `${need.max} bytes` : `${need.min} to ${need.max} bytes`;
  const preset = value != null ? places.find(p => p.at === value) : undefined;
  let info: ReactNode = `Takes ${bytes}, where Brokkr finds room.`, warn: string | null = null;
  if (value == null && auto) {
    const span = placeSpan(auto.at, need.max, need.align);
    info = <>Takes {bytes}: <span className="mono">{hex(span.start)}–{hex(span.end - 1)}</span>{auto.note ?? ''}.</>;
  }
  if (value != null) {
    const span = placeSpan(value, need.max, need.align);
    const top = max + 1;
    info = <>Takes {bytes}: <span className="mono">{hex(span.start)}–{span.end > top ? `past ${hex(max)}` : hex(span.end - 1)}</span>{need.min !== need.max ? ' at most' : ''}.</>;
    if (span.end > top) warn = `It goes past ${hex(max)}: ${need.max} bytes from ${hex(span.start)} need room to ${hex(span.end - 1)}.`;
    else if (preset && span.end - value > preset.room) warn = `It takes up to ${need.max} bytes, and the ${preset.what} has ${preset.room}.`;
    else if (clash) warn = clash;
  } else if (own) info = 'Type the address below.';
  return (
    <div className="field"><label htmlFor={id}>{label}</label>
      <select id={id} value={own ? 'own' : value == null ? 'auto' : String(value)} onChange={e => {
        const v = e.target.value;
        if (v === 'own') { setOwn(true); return; }
        setOwn(false);
        onCommit(v === 'auto' ? null : Number(v));
      }}>
        <option value="auto">{auto ? `Auto: ${hex(auto.at)}` : 'Auto: where Brokkr finds room'}</option>
        {places.map(p => <option key={p.at} value={p.at}>{hex(p.at)}: {p.what}</option>)}
        <option value="own">An address of your own…</option>
      </select>
      {own && <HexField id={`${id}-own`} label={`${label.replace(/ at$/, '')} address`} value={value} max={max} placeholder={hex(places[0]?.at ?? 0)} onCommit={onCommit} />}
      <small className={warn ? 'warn-text' : 'muted'}>{warn ?? info}</small>
    </div>
  );
}

/** Address ranges as typed (`$c000-$cfff, $0334-$03ff`), committed when they read as ranges; what is wrong below. */
export function RangesField({ id, label, value, placeholder, help, onCommit }: { id: string; label: string; value: PackPrefs['keep']; placeholder?: string; help?: string; onCommit: (v: PackPrefs['keep']) => void }) {
  const [text, setText] = useState(keepText(value));
  useEffect(() => setText(keepText(value)), [value]);
  const r = parseKeep(text);
  const commit = () => { if (typeof r !== 'string' && keepText(r) !== keepText(value)) onCommit(r); };
  return (
    <div className="field"><label htmlFor={id}>{label}</label>
      <input id={id} className={cx('mono', typeof r === 'string' && 'bad')} value={text} placeholder={placeholder} spellCheck={false}
        onChange={e => setText(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); commit(); } }} />
      {typeof r === 'string' ? <small className="err-text">{r}</small> : help && <small className="muted">{help}</small>}
    </div>
  );
}

export function PackView(p: PackViewProps) {
  const { A, R, project, cursor, sel, prefs } = p;
  const [q, setQ] = useState('');
  const set = (patch: Partial<PackPrefs>, label: string) => p.onChange({ ...prefs, ...patch }, label);
  const cmd = packCommand(prefs, project.files, R.fileNames);
  const ranges = prefs.ranges ?? [];
  const toggle = (start: Addr, end: Addr, on: boolean, what: string) => set({ ranges: editRanges(ranges, start, end, on) }, `${on ? 'Pack' : 'Do not pack'} ${what}`);
  // what is packed is the built PRG: where a relocated block runs (8.1b), its bytes are where it is loaded
  const selRange = sel && sel.multi && sel.end > sel.start ? loadRange(A, sel.start, sel.end) : null;
  const at = cursor != null ? loadAddress(A, cursor) : null;
  const blk = at != null ? A.blocks.find(b => at >= b.start && at < b.end) : undefined;
  const ql = q.trim().toLowerCase().replace(/^\$/, '');
  const list = prefs.ranges ? A.blocks.filter(b => { const l = R.labels.get(b.start); return !relocAt(A, b.start) && (!ql || h4(b.start).includes(ql) || kindInfo(b.type).label.toLowerCase().includes(ql) || !!l?.name.toLowerCase().includes(ql)); }) : [];
  const brokkr = prefs.packer !== 'exomizer';

  return (
    <div className="side-inner pack-view">
      <div className="side-title">Pack <span className="muted">{brokkr ? 'Brokkr' : 'Exomizer'}</span></div>
      <PackerChoice prefs={prefs} set={set} exomizer={p.exomizer} desktop={p.desktop} onSettings={p.onSettings} />

      <SideSection id="pack-what" title="What to pack">
        <div className="seg wide pack-seg" role="tablist" aria-label="What to pack">
          <button role="tab" aria-selected={!prefs.ranges} className={cx(!prefs.ranges && 'on')} onClick={() => prefs.ranges && set({ ranges: null }, 'Pack the whole build')}>Whole build</button>
          <button role="tab" aria-selected={!!prefs.ranges} className={cx(prefs.ranges && 'on')} onClick={() => !prefs.ranges && set({ ranges: selRange ? [{ start: selRange.start, end: selRange.end }] : [] }, 'Pack chosen blocks')}>Chosen blocks</button>
        </div>
        {!prefs.ranges ? (
          <div className="pack-files">
            {project.files.map((f, i) => <div key={f.id || i} className="mono small"><Icon name="doc" size={12} /> {R.fileNames[i]}.prg <span className="muted">${h4(f.load)}–${h4(f.load + f.bytes.length - 1)} · {fmtBytes(f.bytes.length)}</span></div>)}
            <p className="muted small">The PRG{project.files.length > 1 ? 's' : ''} Build &amp; Run builds{project.files.length > 1 ? ', packed together into one file' : ''}.</p>
          </div>
        ) : <>
          <div className="pack-sum small">{ranges.length ? <><b>{fmtBytes(cmd.size)}</b> <span className="muted">from ${h4(cmd.parts[0]?.start ?? ranges[0].start)} in {ranges.length} range{ranges.length > 1 ? 's' : ''}</span></> : <span className="muted">Nothing chosen yet: tick blocks below, or select a range in the listing.</span>}</div>
          {ranges.length > 0 && <div className="pack-ranges" role="list" aria-label="Ranges to pack">
            {mergeRanges(ranges).map(r => (
              <span key={r.start} role="listitem" className="pack-range mono">
                <button className="pack-range-go" title="Show in the listing" onClick={() => p.onNavigate(r.start)}>${h4(r.start)}–${h4(r.end - 1)}</button>
                <button className="icon-btn" aria-label={`Do not pack $${h4(r.start)}-$${h4(r.end - 1)}`} title="Do not pack this range" onClick={() => toggle(r.start, r.end, false, `$${h4(r.start)}-$${h4(r.end - 1)}`)}><Icon name="x" size={11} /></button>
              </span>))}
          </div>}
          <div className="bm-actions pack-add">
            {selRange && rangeCover(ranges, selRange.start, selRange.end) < selRange.end - selRange.start && <button className="btn small" onClick={() => toggle(selRange.start, selRange.end, true, `$${h4(selRange.start)}-$${h4(selRange.end - 1)}`)}><Icon name="plus" size={12} />Selection ${h4(selRange.start)}–${h4(selRange.end - 1)}</button>}
            {!selRange && blk && rangeCover(ranges, blk.start, blk.end) < blk.end - blk.start && <button className="btn small" onClick={() => toggle(blk.start, blk.end, true, `$${h4(blk.start)}-$${h4(blk.end - 1)}`)}><Icon name="plus" size={12} />Block at the cursor</button>}
            {ranges.length > 0 && <button className="btn small ghost" onClick={() => set({ ranges: [] }, 'Pack no blocks')}>Clear</button>}
          </div>
          <div className="side-search"><Icon name="search" size={14} /><label htmlFor="pack-q" className="sr-only">Filter blocks</label><input id="pack-q" value={q} onChange={e => setQ(e.target.value)} placeholder="Filter by name, type or address" /></div>
          <div className="pack-blocks" role="list" aria-label="Blocks">
            {list.map(b => {
              const cover = rangeCover(ranges, b.start, b.end), len = b.end - b.start, all = cover === len, l = R.labels.get(b.start);
              const what = `$${h4(b.start)}-$${h4(b.end - 1)}`;
              return (
                <div key={b.id} role="listitem" className={cx('pack-blk', at != null && at >= b.start && at < b.end && 'on')}>
                  <input type="checkbox" aria-label={`Pack ${what}`} checked={all} ref={el => { if (el) el.indeterminate = cover > 0 && !all; }} onChange={() => toggle(b.start, b.end, !all, what)} />
                  <button className="pack-blk-main" title="Show in the listing" onClick={() => p.onNavigate(b.start)}>
                    <i style={{ background: `var(--g-${groupOfKind(b.type)})` }} />
                    <span className="blk-name">{l ? l.name : kindInfo(b.type).label}</span>
                    <span className="muted mono small">${h4(b.start)} · {fmtBytes(len)}</span>
                  </button>
                </div>);
            })}
          </div>
        </>}
      </SideSection>

      <PackSettings prefs={prefs} set={set} files={project.files} fileNames={R.fileNames} entry={A.entry} warning={packWarning(prefs, A)}
        exomizer={p.exomizer} desktop={p.desktop} busy={p.busy} packing={p.packing} result={p.result} current={p.current}
        before="Pack builds and verifies the program first, like Build & Run." packTitle="Build and verify with Build & Run's toolchain, then pack the result"
        noDir="Not set: the file stays in the app's pack folder (Save as… copies it)."
        onPack={p.onPack} onRun={p.onRun} onSave={p.onSave} onSaveFile={p.onSaveFile} onLog={p.onLog} onPickDir={p.onPickDir} />
    </div>
  );
}

/** Brokkr or Exomizer, and what the one chosen still needs. */
export function PackerChoice({ prefs, set, exomizer, desktop, onSettings }: { prefs: PackPrefs; set: (patch: Partial<PackPrefs>, label: string) => void; exomizer: string; desktop: boolean; onSettings?: () => void }) {
  const brokkr = prefs.packer !== 'exomizer';
  return <>
    <div className="seg wide pack-seg" role="tablist" aria-label="Packer">
      <button role="tab" aria-selected={brokkr} className={cx(brokkr && 'on')} title="Brokkr, the built-in cruncher: Exomizer 3 streams, crunched smaller and faster, checked in an emulated C64" onClick={() => !brokkr && set({ packer: 'brokkr' }, 'Pack with Brokkr')}>Brokkr</button>
      <button role="tab" aria-selected={!brokkr} className={cx(!brokkr && 'on')} title="Exomizer 3, the tool set in Settings → Toolchain" onClick={() => brokkr && set({ packer: 'exomizer' }, 'Pack with Exomizer')}>Exomizer</button>
    </div>
    {!desktop && <p className="muted small pack-note">Packing needs the desktop app.</p>}
    {desktop && !brokkr && !exomizer && <div className="pack-note"><p className="muted small">No Exomizer is set. The installed app comes with Exomizer 3.1.1; or set your own{onSettings ? '' : ' in Settings → Toolchain'}.</p>{onSettings && <button className="btn small" onClick={onSettings}>Settings…</button>}</div>}
  </>;
}

export interface PackSettingsProps {
  prefs: PackPrefs;
  set: (patch: Partial<PackPrefs>, label: string) => void;
  /** the files packed, and their names as the pack folder writes them (without .prg) */
  files: readonly Pick<FileInput, 'load' | 'bytes'>[]; fileNames: readonly string[];
  /** where the program starts: a jump's address to begin with */
  entry: Addr | null;
  /** what keeps the settings from starting the program (packWarning), or null */
  warning: string | null;
  exomizer: string; desktop: boolean; busy: string | null; packing: PackProgress | null; result: PackResult | null; current: string;
  /** what Pack does before it packs (under the button), and the button's title */
  before: string; packTitle: string;
  /** what the Folder field says when none is chosen */
  noDir: string;
  onPack: () => void; onRun: () => void; onSave: () => void; onLog: () => void;
  onSaveFile: (f: { name: string; prg: Uint8Array }) => void;
  onPickDir: () => void;
}

/** The packed file, how it starts or is decrunched, the decruncher's memory, the command and the Pack button with what
 * it made: the Pack view's and the quick pack's, whatever is packed. */
export function PackSettings(p: PackSettingsProps) {
  const { prefs, set, files, fileNames, entry, warning, exomizer, desktop, busy, packing, result, current } = p;
  const exe = exomizer ? exomizer.split(/[\\/]/).pop()! : 'exomizer';
  const cmd = packCommand(prefs, files, fileNames, exe);
  const problem = packProblem(prefs) ?? (prefs.ranges && !cmd.parts.length ? 'None of the chosen ranges holds loaded bytes.' : null);
  const fresh = !!result && result.key === current;
  const brokkr = prefs.packer !== 'exomizer', sfx = prefs.mode === 'sfx';
  // what is shown: only the settings that take effect; the format as it is packed (auto is for a self-extracting file)
  const o = packOptions(prefs), fmt = packEffective(prefs).format;
  // what the decruncher takes, and whether its tables would lie over it where both are set
  const needs = packNeeds(prefs);
  // the decruncher written next to crunched data: where each part goes on Auto (its own defaults), and what is wrong
  const written = packEffective(prefs).decruncher && o.decruncher;
  const autoOf = (patch: Partial<PackPrefs>) => { const d = written ? packDecruncher({ ...prefs, ...patch }) : null; return d && typeof d !== 'string' ? d : null; };
  const auto = written ? {
    decruncher: { at: autoOf({ decruncherAt: null })?.start ?? 0xc000, note: ' in the PRG; the source goes where you #import it' },
    tables: autoOf({ tablesAt: null })?.tables ?? null, zp: autoOf({ zp: null })?.zp ?? null,
  } : null;
  const decProblem = written ? (d => typeof d === 'string' ? d : null)(packDecruncher(prefs)) : null;
  const decSpan = prefs.decruncherAt != null || auto ? placeSpan(prefs.decruncherAt ?? auto!.decruncher.at, needs.resident.max) : null;
  const tabSpan = prefs.tablesAt != null ? placeSpan(prefs.tablesAt, needs.tables.max, needs.tables.align) : null;
  const tablesClash = decSpan && tabSpan && decSpan.start < tabSpan.end && tabSpan.start < decSpan.end
    ? `It overlaps the decruncher ($${h4(decSpan.start)}–$${h4(decSpan.end - 1)}).` : null;
  // the parts that can each be a file of their own: the ranges chosen, or the files
  const parts = prefs.ranges ? mergeRanges(prefs.ranges).length : files.length;
  const ready = desktop && (brokkr || !!exomizer) && files.length > 0 && !problem && !decProblem && !busy && !packing;
  // a new result comes into view when the pack is done (not the one there was when the view opened)
  const resultRef = useRef<HTMLDivElement>(null), seen = useRef(result);
  useEffect(() => {
    if (packing || !result || result === seen.current) return;
    seen.current = result;
    reveal(resultRef.current);
  }, [result, packing]);

  return <>
      <SideSection id="pack-file" title="Packed file">
        <div className="seg wide pack-seg" role="tablist" aria-label="Kind of packed file">
          <button role="tab" aria-selected={sfx} className={cx(sfx && 'on')} title={`A program that decrunches itself and starts (${brokkr ? 'brokkr' : 'exomizer'} sfx)`} onClick={() => set({ mode: 'sfx' }, 'Pack as a self-extracting program')}>Self-extracting</button>
          <button role="tab" aria-selected={!sfx} className={cx(!sfx && 'on')} title={`Crunched data that your own code decrunches (${brokkr ? 'brokkr' : 'exomizer'} mem)`} onClick={() => set({ mode: 'mem' }, 'Pack as crunched data')}>Crunched data</button>
        </div>
        {o.format && <div className="field"><label htmlFor="pack-format">Format</label>
          <select id="pack-format" value={fmt} onChange={e => set({ format: e.target.value as PackFormat }, 'Pack: format')}>
            <option value="exomizer">Exomizer 3</option>
            <option value="brokkr">Brokkr — smaller</option>
            <option value="fast">Brokkr fast — faster</option>
            {sfx && <option value="auto">Auto — the smallest</option>}
          </select>
          {fmt !== 'exomizer' && <small className="muted">{FORMAT_NOTE[fmt]}{sfx && fmt !== 'auto' ? " Where the program leaves no room for its decruncher, the file is in Exomizer's format." : ''}</small>}</div>}
        {o.maxSeconds && <SecondsField id="pack-max-seconds" label="At most, seconds to decrunch" value={prefs.maxSeconds}
          help="On a PAL C64. Empty: the smallest file, however long it takes to decrunch."
          onCommit={v => set({ maxSeconds: v }, v == null ? 'Pack: any decrunch time' : 'Pack: decrunch time')} />}
        {o.effort && <div className="field"><label htmlFor="pack-effort">Effort</label>
          <select id="pack-effort" value={prefs.effort} onChange={e => set({ effort: e.target.value as PackPrefs['effort'] }, 'Pack: effort')}>
            <option value="fast">Fast — a little larger</option>
            <option value="normal">Normal</option>
            <option value="max">Max — on threads, slow</option>
          </select></div>}
        {o.fast && <label className="check"><input id="pack-fast" type="checkbox" checked={prefs.fast} onChange={e => set({ fast: e.target.checked }, 'Pack: faster crunching')} /><span>Crunch faster (-C)<small className="muted"> — a little larger</small></span></label>}
        {o.extra && <TextField id="pack-extra" label="More options" value={prefs.extra} placeholder="-p 4 -Di_line_number=1987" error={extraProblem(prefs.extra)} onCommit={v => set({ extra: v }, 'Pack: options')} />}
        <TextField id="pack-out" label="File name" value={prefs.out} placeholder={cmd.out} onCommit={v => set({ out: v }, 'Pack: file name')} />
        <div className="field"><label htmlFor="pack-dir">Folder</label>
          <output id="pack-dir" className={cx('pack-dir', prefs.dir ? 'mono' : 'empty')}>{prefs.dir || p.noDir}</output>
          <div className="bm-actions pack-dir-actions">
            <button className="btn small" disabled={!desktop} onClick={p.onPickDir} title="Choose the folder the packed file is written to each time">Choose…</button>
            {prefs.dir && <button className="btn small ghost" aria-label="Clear the folder" title="Write to no folder: the file stays in the app's pack folder" onClick={() => set({ dir: '' }, 'Pack: no folder')}>Clear</button>}
          </div>
        </div>
      </SideSection>

      {sfx ? (
        <SideSection id="pack-sfx" title="Self-extracting">
          <div className="field"><label htmlFor="pack-start">Start</label>
            <select id="pack-start" value={prefs.start} onChange={e => set({ start: e.target.value as PackPrefs['start'], ...(e.target.value === 'jmp' && prefs.jmp == null ? { jmp: entry } : {}) }, 'Pack: start')}>
              <option value="sys">SYS in the BASIC line</option>
              <option value="jmp">Jump to an address</option>
              <option value="basic">RUN (a BASIC program)</option>
            </select></div>
          {o.jmp && <HexField id="pack-jmp" label="Jump to" value={prefs.jmp} placeholder="$0810" onCommit={v => set({ jmp: v }, 'Pack: jump address')}
            help={entry != null && entry !== prefs.jmp ? `The program start is $${h4(entry)}.` : undefined} />}
          {warning && <p className="warn-text small">{warning}</p>}
          <div className="pack-row">
            {o.ramExit && <HexField id="pack-ram" label="$01 after" value={prefs.ramExit} max={0xff} placeholder="$37" onCommit={v => set({ ramExit: v }, 'Pack: $01 after decrunching')} />}
            <div className="field"><label htmlFor="pack-irq">Interrupts after</label>
              <select id="pack-irq" value={prefs.irqExit == null ? 'default' : prefs.irqExit ? 'on' : 'off'} title={brokkr ? 'By default on when the KERNAL is in after decrunching' : "By default on, as Exomizer leaves them"}
                onChange={e => set({ irqExit: e.target.value === 'default' ? null : e.target.value === 'on' }, 'Pack: interrupts after decrunching')}>
                <option value="default">Default</option>
                <option value="on">On (cli)</option>
                <option value="off">Off (sei)</option>
              </select></div>
          </div>
          {o.effect && (brokkr
            ? <label className="check"><input id="pack-effect" type="checkbox" checked={prefs.effect !== 'none'} onChange={e => set({ effect: e.target.checked ? 'default' : 'none' }, 'Pack: border flash')} /><span>Flash the border while decrunching</span></label>
            : <div className="field"><label htmlFor="pack-effect">Decrunch effect</label>
              <select id="pack-effect" value={prefs.effect} onChange={e => set({ effect: e.target.value as PackPrefs['effect'] }, 'Pack: effect')}>
                <option value="default">Exomizer's own</option>
                <option value="none">None (-n)</option>
                <option value="x1">Border flash 1 (-x1)</option>
                <option value="x2">Border flash 2 (-x2)</option>
                <option value="x3">Border flash 3 (-x3)</option>
              </select></div>)}
        </SideSection>
      ) : (
        <SideSection id="pack-mem" title="Crunched data">
          <div className="field"><label htmlFor="pack-load">Load address</label>
            <select id="pack-load" value={typeof prefs.memLoad === 'number' ? 'addr' : prefs.memLoad} onChange={e => set({ memLoad: e.target.value === 'addr' ? (cmd.parts[0]?.start ?? 0x1000) : e.target.value as 'auto' | 'none' }, 'Pack: load address')}>
              <option value="auto">To decrunch in place</option>
              <option value="addr">This address</option>
              <option value="none">None: a plain .bin file</option>
            </select></div>
          {typeof prefs.memLoad === 'number' && <HexField id="pack-load-at" label="Load at" value={prefs.memLoad} onCommit={v => set({ memLoad: v ?? 'auto' }, 'Pack: load address')} />}
          {o.forward && <label className="check"><input id="pack-forward" type="checkbox" checked={prefs.forward} onChange={e => set({ forward: e.target.checked }, 'Pack: forward')} /><span>Crunch forward (-f)<small className="muted"> — the default decrunches backward</small></span></label>}
          {o.compat && <label className="check"><input id="pack-compat" type="checkbox" checked={prefs.compat} onChange={e => set({ compat: e.target.checked }, 'Pack: no literal sequences')} /><span>No literal sequences ({brokkr ? '-T 5' : '-c'})<small className="muted"> — for old decrunchers</small></span></label>}
          {o.split && parts > 1 && <label className="check"><input id="pack-split" type="checkbox" checked={prefs.split} onChange={e => set({ split: e.target.checked }, 'Pack: a file for each part')} />
            <span>{prefs.ranges ? 'A file for each block' : 'A file for each PRG'}<small className="muted"> — {parts} files{written ? ', one decruncher for all' : ''}, instead of one</small></span></label>}
          {o.decruncher && <label className="check"><input id="pack-decruncher" type="checkbox" checked={prefs.decruncher} onChange={e => set({ decruncher: e.target.checked }, 'Pack: write the decruncher')} />
            <span>Write the decruncher too<small className="muted"> — a PRG to load and call, and Kick Assembler source to #import</small></span></label>}
          <p className="muted small">{written
            ? <>Next to the crunched {prefs.split && parts > 1 ? 'files' : 'file'}, Brokkr writes its decruncher, <span className="mono">{cmd.outs.find(n => n.endsWith('.prg') && n.includes('-decrunch'))}</span> and <span className="mono">.asm</span>, and decrunches each file with it in its emulated C64. For each file, set <span className="mono">stream</span> to the address after its last byte, then <span className="mono">jsr</span> to the decruncher.</>
            : !o.decruncher && brokkr ? <>Brokkr's decruncher reads backward: for data crunched forward, use Exomizer's <span className="mono">exodecrunch.s</span>.</>
            : DECRUNCH[brokkr && fmt !== 'auto' ? fmt : 'exomizer-tool']}</p>
        </SideSection>
      )}
      {o.place && (
        <SideSection id="pack-work" title="Decruncher's memory"
          summary={prefs.decruncherAt != null || prefs.tablesAt != null || prefs.zp != null || (o.keep && prefs.keep.length) ? 'as set' : sfx ? 'where Brokkr finds room' : "the decruncher's own"}>
          <PlaceField id="pack-dec-at" label="Decruncher at" value={prefs.decruncherAt} places={MEMORY_PLACES} max={0xffff} need={needs.resident} auto={auto?.decruncher}
            onCommit={v => set({ decruncherAt: v }, 'Pack: decruncher address')} />
          {needs.tables.max > 0
            ? <PlaceField id="pack-tables-at" label="Tables at" value={prefs.tablesAt} places={MEMORY_PLACES} max={0xffff} need={needs.tables} clash={tablesClash}
              auto={auto && auto.tables && { at: auto.tables.start, note: prefs.format === 'brokkr' && prefs.tablesAt == null ? ', the page after the decruncher' : undefined }}
              onCommit={v => set({ tablesAt: v }, 'Pack: tables address')} />
            : <p className="muted small">The fast format's decruncher has no tables.</p>}
          <PlaceField id="pack-zp" label="Zero page at" value={prefs.zp} places={ZP_PLACES} max={0xff} need={{ min: needs.zp, max: needs.zp }} auto={auto?.zp && { at: auto.zp.start }}
            onCommit={v => set({ zp: v != null && v < 2 ? 2 : v }, 'Pack: zero page address')} />
          {o.keep && <RangesField id="pack-keep" label="Keep free" value={prefs.keep} placeholder="$c000-$cfff, $0334-$03ff" onCommit={v => set({ keep: v }, 'Pack: memory to keep free')}
            help={prefs.keep.length
              ? `Keeps ${prefs.keep.reduce((n, r) => n + r.end - r.start, 0)} bytes free: the decruncher, its tables and the crunched data stay out of them.`
              : 'Memory the decruncher, its tables and the crunched data stay out of while it decrunches.'} />}
          {decProblem && <p className="err-text small">{decProblem}</p>}
          <p className="muted small">{sfx
            ? 'Left empty, Brokkr puts the decruncher and its tables where the program leaves room, the stack page and $0334 first. The packed file says where they went.'
            : 'Where the decruncher written goes, with its tables and zero page. The source takes them as constants at its top; it does not change $01, so all of it must be RAM while it decrunches.'}</p>
        </SideSection>
      )}

      <SideSection id="pack-command" title="Command">
        <pre className="pack-cmd mono" aria-label={brokkr ? 'Brokkr command' : 'Exomizer command'} title={brokkr ? 'What the standalone Brokkr runs to make the same file, in the pack folder' : undefined}>{cmd.text}</pre>
        {problem && <p className="err-text small">{problem}</p>}
        <button className="btn primary pack-go" disabled={!ready} onClick={p.onPack} title={p.packTitle}>
          {packing ? <><span className="spinner" aria-hidden />Packing…</> : <><Icon name="download" size={14} />{busy ?? 'Pack'}</>}</button>
        {!packing && p.before && <p className="muted small">{p.before}</p>}
        {packing ? <PackingCard packing={packing} /> : <div ref={resultRef}>{result && <PackResultCard result={result} fresh={fresh} onRun={p.onRun} onSave={p.onSave} onSaveFile={p.onSaveFile} onLog={p.onLog} />}</div>}
      </SideSection>
  </>;
}

const FORMAT_NAME: Record<PackFormat, string> = { exomizer: "Exomizer's format", brokkr: "Brokkr's own format", fast: "Brokkr's fast format", auto: "each of the three formats, the smallest kept" };

/** What a pack under way is doing, step by step, with the time since it began (ticking each second). */
function PackingCard({ packing }: { packing: PackProgress }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { reveal(ref.current); }, []);
  const s = Math.max(0, Math.floor((now - packing.since) / 1000));
  const time = s < 60 ? `${s} s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  const p = packing.prefs, brokkr = p.packer !== 'exomizer', sfx = p.mode === 'sfx', verifying = packing.step === 'verify';
  const before = packing.before === undefined ? BUILD_FIRST : packing.before;
  const who = brokkr ? 'Brokkr' : 'Exomizer';
  const how = brokkr ? `${FORMAT_NAME[p.format]}, effort ${p.effort === 'max' ? 'Max, on threads' : p.effort === 'fast' ? 'Fast' : 'Normal'}` : sfx ? 'a self-extracting program' : 'crunched data';
  const written = packEffective(p).decruncher && packOptions(p).decruncher;
  const check = !sfx ? (written ? "then each file is decrunched by the decruncher in Brokkr's emulated C64 and compared" : brokkr ? 'then Brokkr decrunches the stream again and compares' : null)
    : brokkr ? "then the file runs in Brokkr's emulated C64 and is compared" : "then Exomizer's desfx decrunches it and it is compared";
  const step = (current: boolean, done: boolean, title: string, note?: string | null) => (
    <li className={cx(current && 'now', done && 'done')}>
      {done ? <Icon name="ok" size={13} /> : current ? <span className="spinner" aria-hidden /> : <span className="dot" aria-hidden />}
      <span>{title}{note && <small className="muted"><br />{note}</small>}</span>
    </li>);
  return (
    <div ref={ref} className="pack-progress" role="status" aria-label="Packing">
      <div className="pack-progress-bar" aria-hidden />
      <div className="pack-progress-head"><b>{verifying && before ? before.doing : `Packing with ${who}…`}</b><span className="mono muted" title="Time since Pack was pressed">{time}</span></div>
      <ol className="pack-steps">
        {before && step(verifying, !verifying, before.title)}
        {step(!verifying, false, `${sfx ? 'Crunch and check' : 'Crunch'} with ${who}`, check ? `${how}; ${check}.` : `${how}.`)}
      </ol>
    </div>
  );
}

function PackResultCard({ result: r, fresh, onRun, onSave, onSaveFile, onLog }: { result: PackResult; fresh: boolean; onRun: () => void; onSave: () => void; onSaveFile: (f: { name: string; prg: Uint8Array }) => void; onLog: () => void }) {
  if (!r.ok) {
    return (
      <div className="pack-result bad" role="status">
        <div className="pack-result-head"><Icon name="err" size={14} /><b>{r.argv[0] === 'brokkr' ? 'Brokkr' : 'Exomizer'} failed</b></div>
        <div className="small">{r.error}</div>
        <div className="bm-actions"><button className="btn small" onClick={onLog}>Show output</button></div>
      </div>);
  }
  // several files: crunched data in a file for each part, or with the decruncher written next to it
  const files = r.files && r.files.length > 1 ? r.files : null;
  const packed = files?.filter(f => f.kind === 'packed') ?? [];
  const size = packed.length > 1 ? packed.reduce((n, f) => n + f.prg.length, 0) : r.prg?.length ?? 0, from = r.packed?.length ?? 0;
  const sfx = r.argv[1] === 'sfx';
  const after = (what: string) => r.report.decruncher.find(d => d.what === what)?.exit;
  return (
    <div className={cx('pack-result', r.check?.status === 'differs' ? 'bad' : 'ok', !fresh && 'stale')} role="status" aria-label="Packed file">
      <div className="pack-result-head"><Icon name={r.check?.status === 'differs' ? 'err' : 'ok'} size={14} /><b className="mono" title={r.path}>{packed.length > 1 ? `${packed.length} crunched files` : r.name}</b></div>
      <div className="small">{from ? <>{from} bytes packed to {size} ({Math.round((size / from) * 100)} %)</> : null}{r.packed && packed.length <= 1 ? <span className="muted mono"> · ${h4(r.packed.start)}–${h4(r.packed.start + r.packed.length - 1)}</span> : null}</div>
      {r.tried && <ul className="pack-tried muted small" aria-label="What auto tried">
        {r.tried.map(t => <li key={t.format} className={cx(t.taken && 'on')}>{FORMAT_NAME[t.format]}: {t.error ?? `${t.bytes} bytes, ${t.seconds!.toFixed(1)} s to decrunch`}{t.taken ? ' (taken)' : ''}</li>)}
      </ul>}
      {files && <ul className="pack-out" aria-label="Files written">
        {files.map(f => (
          <li key={f.name}>
            <div className="pack-out-head"><span className="mono" title={f.path}>{f.name}</span><span className="muted small">{fmtBytes(f.prg.length)}</span>
              <button className="icon-btn" aria-label={`Save ${f.name} as…`} title={`Save ${f.name} as…`} onClick={() => onSaveFile(f)}><Icon name="download" size={11} /></button></div>
            <div className="muted small">{f.note}</div>
          </li>))}
      </ul>}
      {r.path && !r.path.startsWith(r.dir) && <div className="small">Written to <span className="mono" title={r.path}>{r.path.replace(/[\\/][^\\/]*$/, '')}</span></div>}
      {r.check && <div className={cx('small', r.check.status === 'same' ? 'ok-text' : r.check.status === 'differs' ? 'err-text' : 'muted')}>{r.check.text}</div>}
      {!sfx && !r.check && <div className="muted small">Crunched data: not run or checked here.</div>}
      {r.report.layout.length > 0 && <table className="pack-layout mono small" aria-label="Memory layout"><tbody>
        {r.report.layout.map(a => <tr key={a.name}><td>{a.name}</td><td>${h4(a.start)}–${h4(a.end - 1)}</td></tr>)}
      </tbody></table>}
      {r.report.layout.filter(a => a.note).map(a => <div key={a.name} className="muted small">{a.name} also uses {a.note!.replace(/^and /, '')}</div>)}
      {sfx && (after('RAM config') || after('IRQ enabled')) && <div className="muted small">After decrunching: $01 = {after('RAM config') ?? '?'}, interrupts {after('IRQ enabled') === '0' ? 'off' : 'on'}</div>}
      {!fresh && <div className="warn-text small">Out of date: the program or the pack settings changed since.</div>}
      <div className="bm-actions">
        {sfx && <button className="btn small primary" onClick={onRun}><Icon name="play" size={12} />Run in VICE</button>}
        {!files && <button className="btn small" onClick={onSave}><Icon name="download" size={12} />Save as…</button>}
        <button className="btn small ghost" onClick={onLog}>Output</button>
      </div>
    </div>
  );
}
