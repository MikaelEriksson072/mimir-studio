/* Sidebar: Explorer (files, the cartridge's banks, the mounted disk, the tape in the datasette, program start, memory map), Blocks (a folder per type, with how many; filterable), Symbols (labels, hardware registers), Bookmarks, Scripts (the project's scripts), Pack.
 * The Explorer's sections are cards that fold up (closed when the app starts, the user's choice kept for the run), each with what it holds in a few words
 * beside its title. */
import { useMemo, useState, type KeyboardEvent } from 'react';
import { bootBank, cartModeName, chipAddress, chipTypeName, covertSummary, crtBanks, crtTypeName, h2, h4, hwSymbol, kindInfo, KRILL_PACKER, overwritesSystemArea, parseVsf, startsFromMonitor, patchEnd, patchFileName, scriptEndText, scriptPatches, START_STUB, SYSTEM_AREA, type Addr, type AnalysisResult, type Block, type BlockKind, type Crt, type D64File, type LoaderPart, type MusicPlayer, type PackingInfo, type Patch, type Project, type RenderResult, type ScriptCheck, type SymbolRef, type TapeFile, type UserScript } from '@mimir/core';
import { blockFolders, blockView, type BlockView } from '../lib/blockfolders';
import { Icon } from '../lib/icons';
import { parseGoto } from '../lib/goto';
import { bankAdr, cx, fmtBytes, groupOfKind } from '../lib/util';
import type { MountedDisk, MountedTape } from '../lib/types';
import type { QuicksaveEntry, QuicksaveInfo } from '../../shared/ipc';
import { useUi, type Activity } from '../store/ui';
import { useScripts, type LibraryScript } from '../store/scripts';
import { BookmarksView, type BookmarkEditing } from './Bookmarks';
import { DiskScreen } from './DiskScreen';
import { MemoryStrip, type CanvasColors } from './Heatmap';
import { PackView, type PackViewProps } from './Pack';
import { SideSection } from './SideSection';

interface SidebarProps {
  view: Activity; A: AnalysisResult; R: RenderResult; project: Project; colors: CanvasColors; cursor: Addr | null;
  onNavigate: (a: Addr) => void; onDemo: () => void; onRemoveFile: (i: number) => void;
  /** add PRG files to the project (the File menu opens new ones) */
  onAdd: () => void;
  /** set the program start (null: back to the detected one) */
  onSetStart: (a: Addr | null) => void;
  /** the mounted disk (the File menu mounts one) */
  disk: MountedDisk | null; onEject: () => void;
  /** the tape in the datasette (the File menu inserts one) */
  tape: MountedTape | null; onEjectTape: () => void;
  /** open a file from the tape (`add`: add it to the project), and the Tape tab (every block, the TapeTool script) */
  onOpenFromTape: (f: TapeFile, add: boolean) => void; onShowTape: () => void;
  /** the disk's and the tape's files that are in the project: marked in their lists */
  diskOpen: ReadonlySet<D64File>; tapeOpen: ReadonlySet<TapeFile>;
  /** the project's cartridge, read (spec 13.9): a bank in the project is gone to with a click, one out of it added
   *  (`leave`: taken out) */
  cart: Crt | null; onOpenBank: (bank: number, leave?: boolean) => void;
  /** every bank in one source, `<name>.crt.asm` (13.9c), or a source per chip */
  onOneSource: (on: boolean) => void;
  /** where file `i` starts, in its bank (13.9b) */
  fileAddr: (i: number) => Addr;
  /** the bank of the cursor as 64 KB, for the memory strip (13.9b): its analysis, where it starts, the cursor in it */
  bankView: { A: AnalysisResult; base: Addr; cursor: Addr | null };
  /** open the Spindle script tab (a Spindle disk's load script) */
  onShowSpindle: () => void;
  /** open the Bitfire script tab (a Bitfire disk's files) */
  onShowBitfire: () => void;
  onShowBooze: () => void;
  /** open the Sparkle script tab (a Sparkle disk's bundles) */
  onShowSparkle: () => void;
  /** open the Krill script tab (a disk for Krill's loader: its files, cc1541's command line) */
  onShowKrill: () => void;
  /** open the Covert script tab (a disk for the Covert Bitops loader: its files, the calls, the tool's command file) */
  onShowCovert: () => void;
  onShowPirateSlayer: () => void;
  /** per file: packed (or maybe packed), else null */
  packing: (PackingInfo | null)[];
  /** open a file from the mounted disk (`add`: add it to the project) */
  onOpenFromDisk: (f: D64File, add: boolean) => void;
  /** the bookmark whose note is shown in the Bookmarks view */
  bmSel: Addr | null; onBmSelect: (a: Addr | null) => void;
  onBmGo: (a: Addr) => void; onBmAdd: () => void; onBmEdit: (a: Addr) => void; onBmDelete: (a: Addr) => void;
  /** the bookmark editor at the top of the Bookmarks view */
  bmEditing: BookmarkEditing | null;
  /** the Pack view (Brokkr or Exomizer) */
  pack: PackViewProps;
  /** VICE's quicksave snapshot (Alt+F11 in VICE) */
  quicksave: QuicksaveProps;
  /** the user's patches (spec 10.2) */
  patches: PatchesProps;
  /** the user's scripts (spec 10.3) */
  scripts: ScriptsProps;
  /** play the music block that starts at `start` (the Blocks view's play button), in VICE or DeepSID as `musicPlayer`
   *  says (Settings → Toolchain) */
  onPlayMusic?: (start: Addr) => void;
  musicPlayer?: MusicPlayer;
  /** Shift+click on a block in the Blocks view: the block, selected, in its type's own view (lib/blockfolders
   *  `blockView`: graphics in Graphics, text and data in Memory, code in the listing) */
  onShowBlock?: (b: Block) => void;
}

interface ScriptsProps {
  list: readonly UserScript[];
  /** each script checked as the project has its code: whether it can run, and what is wrong */
  checks: ReadonlyMap<string, ScriptCheck>;
  /** the project's patches: a script's changes to the program are among them */
  patches: readonly Patch[];
  onNew: () => void;
  /** the script in the Scripts tab */
  onOpen: (id: string) => void;
  onRun: (id: string) => void;
  onRemove: (id: string) => void;
  /** a copy of a library script in the project */
  onAdd: (l: LibraryScript) => void;
}

interface PatchesProps {
  list: readonly Patch[];
  onGo: (p: Patch) => void; onEdit: (p: Patch) => void; onSave: (p: Patch) => void; onRemove: (p: Patch) => void;
  /** switch it on (written over the bytes) or off (the original bytes back) */
  onSwitch: (p: Patch, on: boolean) => void;
}

interface QuicksaveProps {
  /** the newest quicksave and when it was saved, or where VICE writes one (null: unknown, outside the desktop app) */
  info: QuicksaveInfo | null;
  /** each new quicksave opens by itself */
  follow: boolean;
  onOpen: () => void; onFollow: (v: boolean) => void;
  /** the quicksaves the app keeps (the newest, and the favourites), the newest first: open one, name it, save it in a
   *  folder, make it a favourite (or one no more) */
  kept: QuicksaveEntry[];
  onOpenKept: (q: QuicksaveEntry) => void; onRenameKept: (q: QuicksaveEntry, name: string) => void; onSaveKept: (q: QuicksaveEntry) => void;
  onFavouriteKept: (q: QuicksaveEntry, on: boolean) => void;
}

export function Sidebar({ view, A, R, project, colors, cursor, onNavigate, onAdd, onDemo, onRemoveFile, onSetStart, disk, onEject, tape, onEjectTape, onOpenFromTape, onShowTape, diskOpen, tapeOpen, cart, onOpenBank, onOneSource, fileAddr, bankView, onShowSpindle, onShowBitfire, onShowBooze, onShowSparkle, onShowKrill, onShowCovert, onShowPirateSlayer, onOpenFromDisk, packing, bmSel, onBmSelect, onBmGo, onBmAdd, onBmEdit, onBmDelete, bmEditing, pack, quicksave, patches, scripts, onPlayMusic, musicPlayer = 'vice', onShowBlock }: SidebarProps) {
  const [q, setQ] = useState('');
  const [symTab, setSymTab] = useState<'labels' | 'hw'>('labels');
  if (view === 'explorer') {
    const segs = A.blocks.filter(b => b.end - b.start >= 48 || (b.type === 'code' && A.entryKind.get(b.start) && A.entryKind.get(b.start) !== 'sub'));
    // a cartridge's many chips are one row here; the Cartridge section lists its banks (13.9b)
    const chips = project.files.filter(f => f.chip != null).length, chipsShort = chips > 4;
    return (
      <div className="side-inner">
        <div className="side-title">Explorer</div>
        <SideSection id="files" title="Files" summary={`${project.files.length} file${project.files.length === 1 ? '' : 's'}`}
          actions={<>
            <button className="btn tiny ghost" onClick={onDemo} title="Load the showcase: a C64 intro with one block of every type and a guided tour (F2)">Demo</button>
            <button className="icon-btn" title="Add PRG to this project" aria-label="Add PRG to this project" onClick={onAdd}><Icon name="plus" size={14} /></button>
          </>}>
          {project.files.map((f, i) => (chipsShort && f.chip != null ? null :
            <div key={f.id || i} className="file-row" onClick={() => onNavigate(fileAddr(i))}>
              <Icon name="doc" size={14} />
              <div className="file-meta"><div className="file-name">{f.name}</div><div className="muted mono small">${h4(f.load)}–${h4(f.load + f.bytes.length - 1)} · {fmtBytes(f.bytes.length)}</div></div>
              {packing[i] && <span className="pill pack" title={`${packing[i]!.verdict === 'packed' ? 'Packed' : 'Maybe packed'}${packing[i]!.signature ? ` (${packing[i]!.signature})` : ''}:\n${packing[i]!.reasons.join('\n')}`}>{packing[i]!.verdict === 'packed' ? 'packed' : 'packed?'}</span>}
              {project.files.length > 1 && <button className="icon-btn" title={`Remove ${f.name}`} aria-label={`Remove ${f.name}`} onClick={e => { e.stopPropagation(); onRemoveFile(i); }}><Icon name="x" size={13} /></button>}
            </div>
          ))}
          {chipsShort && <div className="file-row" onClick={() => onNavigate(fileAddr(project.files.findIndex(f => f.chip != null)))}>
            <Icon name="chip" size={14} />
            <div className="file-meta"><div className="file-name">{chips} chips of {project.cart?.name}</div><div className="muted small">every bank in the listing, one after the other: the Cartridge section lists them</div></div>
          </div>}
          <div className="side-actions">
            <button className="btn small" onClick={onAdd} title="Add one or more .prg files to this project, beside the ones in it"><Icon name="plus" size={13} />Add PRG file…</button>
          </div>
          <p className="side-hint">The File menu opens a new program, a cartridge, a snapshot, a D64 or a TAP. Dropped on the window with Shift, files are added.</p>
        </SideSection>
        {cart && project.cart && <CartridgeSection crt={cart} name={project.cart.name} project={project} onOpenBank={onOpenBank} onOneSource={onOneSource} />}
        {disk && <DiskSection disk={disk} open={diskOpen} onEject={onEject} onOpenFromDisk={onOpenFromDisk} onShowSpindle={onShowSpindle} onShowBitfire={onShowBitfire} onShowBooze={onShowBooze} onShowSparkle={onShowSparkle} onShowKrill={onShowKrill} onShowCovert={onShowCovert} onShowPirateSlayer={onShowPirateSlayer} />}
        {tape && <TapeSection tape={tape} open={tapeOpen} onEject={onEjectTape} onOpenFromTape={onOpenFromTape} onShowTape={onShowTape} />}
        <QuicksaveSection {...quicksave} />
        {patches.list.length > 0 && <PatchesSection {...patches} />}
        <LoadersSection A={A} packed={packing.some(p => p?.verdict === 'packed')} onNavigate={onNavigate} />
        <ProgramStart A={A} R={R} project={project} onNavigate={onNavigate} onSetStart={onSetStart} />
        <SideSection id="map" title="Memory map" summary={`${segs.length} block${segs.length === 1 ? '' : 's'}`}>
          <div className="mmap">
            <MemoryStrip A={bankView.A} colors={colors} cursor={bankView.cursor} onNavigate={a => onNavigate(bankView.base + a)} />
            <div className="seg-list">
              {segs.map(b => { const l = R.labels.get(b.start); return (
                <button key={b.id} className={cx('seg-row', cursor != null && cursor >= b.start && cursor < b.end && 'on')} onClick={() => onNavigate(b.start)}>
                  <i style={{ background: `var(--g-${groupOfKind(b.type)})` }} /><span className="mono">{bankAdr(A, b.start)}</span><span className="seg-name">{l ? l.name : kindInfo(b.type).label}</span>
                </button>); })}
            </div>
          </div>
        </SideSection>
      </div>
    );
  }
  if (view === 'bookmarks') return <BookmarksView A={A} editing={bmEditing} bookmarks={project.bookmarks} R={R} cursor={cursor} selected={bmSel} onSelect={onBmSelect} onGo={onBmGo} onAdd={onBmAdd} onEdit={onBmEdit} onDelete={onBmDelete} />;
  if (view === 'scripts') return <ScriptsSideView {...scripts} />;
  if (view === 'pack') return <PackView {...pack} />;
  if (view === 'blocks') return <BlocksView A={A} R={R} cursor={cursor} q={q} setQ={setQ} onNavigate={onNavigate} onPlayMusic={onPlayMusic} musicPlayer={musicPlayer} onShowBlock={onShowBlock} />;
  // symbols
  const ql = q.toLowerCase();
  const labels = [...R.labels.entries()].filter(([, l]) => !ql || l.name.toLowerCase().includes(ql)).sort((x, y) => x[0] - y[0]);
  const hwUse = new Map<string, { sym: SymbolRef; n: number; addr: Addr }>();
  for (const [to, l] of A.xrefs) { const hs = (A.owner[to] < 0 || (to >= 0xd000 && to < 0xe000)) ? hwSymbol(to) : null; if (hs) { const k = hs.sym.name; const e = hwUse.get(k) || { sym: hs.sym, n: 0, addr: to }; e.n += l.length; hwUse.set(k, e); } }
  const hw = [...hwUse.values()].filter(e => !ql || e.sym.name.toLowerCase().includes(ql)).sort((x, y) => y.n - x.n);
  return (
    <div className="side-inner">
      <div className="side-title">Symbols</div>
      <div className="seg wide" role="tablist">{([['labels', `Labels ${R.labels.size}`], ['hw', `Hardware ${hwUse.size}`]] as const).map(([k, l]) => <button key={k} role="tab" aria-selected={symTab === k} className={cx(symTab === k && 'on')} onClick={() => setSymTab(k)}>{l}</button>)}</div>
      <div className="side-search"><Icon name="search" size={14} /><label htmlFor="sym-q" className="sr-only">Filter symbols</label><input id="sym-q" value={q} onChange={e => setQ(e.target.value)} placeholder="Filter symbols" /></div>
      <div className="blk-list">
        {symTab === 'labels' ? labels.map(([a, l]) => (
          <button key={a} className={cx('sym-row', cursor === a && 'on')} onClick={() => onNavigate(a)}>
            <span className={cx('mono sym-name', l.user && 'user')}>{l.name}</span><span className="muted mono small">{bankAdr(A, a)}</span><span className="sym-refs">{(A.xrefs.get(a) || []).length}</span>
          </button>)) : hw.map(e => (
          <div key={e.sym.name} className="sym-row static" title={e.sym.desc}>
            <span className="mono sym-name syn-hw">{e.sym.name}</span><span className="muted small">{e.sym.cat}</span><span className="sym-refs">{e.n}</span>
          </div>))}
      </div>
    </div>
  );
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const GFX_AS = { sprites: 'sprites', chars: 'characters', bitmap: 'a bitmap', screens: 'a screen' } as const;
const MEM_AS = { m: 'hex and text (m)', i: 'PETSCII text (i)', ii: 'screen codes (ii)' } as const;
/** where Shift+click on a block shows it (a row's tip) */
const showsIn = (v: BlockView) => (v.tab === 'gfx' ? `show it in Graphics, drawn as ${GFX_AS[v.kind]}`
  : v.tab === 'mem' ? `show it in Memory as ${MEM_AS[v.mode]}${v.lower ? ', lower case' : ''}` : 'select it in the listing');

/**
 * The Blocks view: a folder for each type of block, with how many blocks of it there are. A click on a folder opens it
 * or folds it up (closed when the app starts, the user's choice kept for the run), on a block goes to it; the folder
 * with the block at the cursor is marked while it is closed. While the filter has text, only the folders with blocks it
 * keeps are there, open (one folded up stays so until the text changes), with how many of their blocks it keeps.
 * A music block has a play button at the end of its row: it plays the block in VICE or DeepSID, as Settings → Toolchain
 * says, without moving the cursor. Shift+click on a block shows it, selected, in its type's own view (`blockView`):
 * a bitmap in Graphics as a bitmap, a text in Memory as PETSCII or screen codes, and so on; each row's tip says where.
 */
function BlocksView({ A, R, cursor, q, setQ, onNavigate, onPlayMusic, musicPlayer = 'vice', onShowBlock }: Pick<SidebarProps, 'A' | 'R' | 'cursor' | 'onNavigate' | 'onPlayMusic' | 'musicPlayer' | 'onShowBlock'> & { q: string; setQ: (q: string) => void }) {
  const playerName = musicPlayer === 'deepsid' ? 'DeepSID' : 'VICE';
  const opened = useUi(s => s.blkOpen), setUi = useUi(s => s.set);
  const ql = q.trim().toLowerCase();
  // the folders folded up while the filter has this text
  const [shut, setShut] = useState<{ q: string; kinds: BlockKind[] }>({ q: '', kinds: [] });
  const folders = useMemo(() => blockFolders(A.blocks, b => {
    if (!ql) return true;
    const l = R.labels.get(b.start);
    return !!l?.name.toLowerCase().includes(ql) || kindInfo(b.type).label.toLowerCase().includes(ql) || h4(b.start).includes(ql);
  }), [A.blocks, R.labels, ql]);
  const shown = ql ? folders.filter(f => f.blocks.length) : folders;
  const shutNow = shut.q === ql ? shut.kinds : [];
  const isOpen = (k: BlockKind) => (ql ? !shutNow.includes(k) : opened.includes(k));
  const toggle = (k: BlockKind) => {
    if (ql) { setShut({ q: ql, kinds: isOpen(k) ? [...shutNow, k] : shutNow.filter(x => x !== k) }); return; }
    const now = useUi.getState().blkOpen;
    setUi({ blkOpen: now.includes(k) ? now.filter(x => x !== k) : [...now, k] });
  };
  const allOpen = shown.length > 0 && shown.every(f => isOpen(f.kind));
  const setAll = (open: boolean) => {
    if (ql) setShut({ q: ql, kinds: open ? [] : shown.map(f => f.kind) });
    else setUi({ blkOpen: open ? shown.map(f => f.kind) : [] });
  };
  const at = cursor == null ? undefined : A.blocks.find(b => cursor >= b.start && cursor < b.end);
  return (
    <div className="side-inner">
      <div className="side-title">Blocks <span className="muted">{A.blocks.length}</span><span className="grow" />
        {shown.length > 1 && <button className="icon-btn" title={allOpen ? 'Fold every folder up' : 'Open every folder'} aria-label={allOpen ? 'Fold every block folder up' : 'Open every block folder'} onClick={() => setAll(!allOpen)}>
          <Icon name={allOpen ? 'up' : 'down'} size={14} /></button>}
      </div>
      <div className="side-search"><Icon name="search" size={14} /><label htmlFor="blk-q" className="sr-only">Filter blocks</label><input id="blk-q" value={q} onChange={e => setQ(e.target.value)} placeholder="Filter by name, type or address" /></div>
      <div className="blk-list" role="list" aria-label="Block types">
        {shown.map(f => {
          const open = isOpen(f.kind), here = at?.type === f.kind;
          const count = ql ? `${f.blocks.length} of ${plural(f.total, `${f.label} block`)} match the filter` : plural(f.total, `${f.label} block`);
          return (
            <div key={f.kind} role="listitem" className={cx('blk-folder', open && 'open')}>
              <button className={cx('blk-folder-head', here && !open && 'here')} aria-expanded={open} title={`${open ? 'Fold up' : 'Open'} ${f.label}: ${count}${here ? '\nThe block at the cursor is in it' : ''}`} onClick={() => toggle(f.kind)}>
                <Icon name="down" size={12} className="blk-folder-arrow" />
                <span className="blk-folder-icon" style={{ color: `var(--g-${f.group})` }}><Icon name="folder" size={15} /></span>
                <span className="blk-folder-name">{f.label}</span>
                <span className="blk-folder-n">{ql ? `${f.blocks.length}/${f.total}` : f.total}</span>
              </button>
              {open && <div className="blk-folder-body" role="group" aria-label={`${f.label} blocks`}>
                {f.blocks.map(b => {
                  const l = R.labels.get(b.start);
                  const row = (
                    <button key={b.id} className={cx('blk-row', at === b && 'on')} title={onShowBlock ? `Go to it in the listing.\nShift+click: ${showsIn(blockView(b))}` : undefined}
                      onMouseDown={e => { if (e.shiftKey) e.preventDefault(); }}
                      onClick={e => { if (e.shiftKey && onShowBlock) onShowBlock(b); else onNavigate(b.start); }}>
                      <span className="blk-main"><span className="blk-name">{l ? l.name : f.label}</span><span className="muted mono small">{bankAdr(A, b.start)} · {b.end - b.start} B</span></span>
                      {b.user && <span className="blk-type" title="Its type is set by you"><Icon name="pencil" size={11} /></span>}
                    </button>);
                  if (b.type !== 'music' || !onPlayMusic) return row;
                  const name = l?.name ?? `music_${h4(b.start)}`;
                  return (
                    <div key={b.id} className={cx('blk-row-play', at === b && 'on')}>
                      {row}
                      <button className="icon-btn blk-play" aria-label={`Play ${name} in ${playerName}`} onClick={() => onPlayMusic(b.start)}
                        title={`Play ${name} in ${playerName}${musicPlayer === 'deepsid' ? ': the .sid the export writes, in DeepSID\'s window' : ': init with song $00, then play each frame'}. Settings → Toolchain picks VICE or DeepSID`}>
                        <Icon name="play" size={12} /></button>
                    </div>); })}
              </div>}
            </div>
          );
        })}
        {!shown.length && <p className="side-hint">{ql ? `No block matches "${q.trim()}".` : 'No blocks.'}</p>}
      </div>
    </div>
  );
}

/** when a quicksave was saved: the time today, else the date and time */
const savedText = (ms: number) => {
  const d = new Date(ms);
  return d.toDateString() === new Date().toDateString() ? `today ${d.toLocaleTimeString()}` : d.toLocaleString();
};

type KeptProps = Pick<QuicksaveProps, 'onOpenKept' | 'onRenameKept' | 'onSaveKept' | 'onFavouriteKept'>;

/** The quicksaves the app keeps: the favourites, then the newest others. A click on a name opens one, the star makes it
 *  a favourite (or one no more), the pencil names it (Enter keeps the name, Esc does not), the arrow saves it to a
 *  folder. */
function KeptQuicksaves({ kept, ...on }: KeptProps & { kept: QuicksaveEntry[] }) {
  const favourites = kept.filter(q => q.favourite), newest = kept.filter(q => !q.favourite);
  return (
    <>
      {favourites.length > 0 && (
        <div className="qs-kept">
          <div className="qs-kept-head small muted"><Icon name="star" size={12} className="qs-fav-head" />Favourites, always kept</div>
          <QuicksaveRows label="Favourite VICE quicksaves" list={favourites} {...on} />
        </div>
      )}
      {newest.length > 0 && (
        <div className="qs-kept">
          <div className="qs-kept-head small muted">The newest {newest.length === 1 ? 'quicksave' : `${newest.length} quicksaves`}, kept here</div>
          <QuicksaveRows label="Kept VICE quicksaves" list={newest} {...on} />
          <p className="side-hint">The newest 5 stay here; an older one goes when VICE saves a new one, unless it is a favourite (the star) or you have saved it.</p>
        </div>
      )}
    </>
  );
}

function QuicksaveRows({ label, list, onOpenKept, onRenameKept, onSaveKept, onFavouriteKept }: KeptProps & { label: string; list: QuicksaveEntry[] }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState('');
  const done = (q: QuicksaveEntry, keep: boolean) => { if (keep) onRenameKept(q, name); setEditing(null); };
  return (
    <div role="list" aria-label={label}>
      {list.map(q => (
        <div key={q.id} role="listitem" className="qs-row">
          {editing === q.id
            ? <input className="qs-name-edit" aria-label={`Name of the quicksave ${q.name}`} value={name} autoFocus maxLength={80} spellCheck={false}
                onFocus={e => e.currentTarget.select()} onChange={e => setName(e.target.value)} onBlur={() => done(q, true)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); done(q, true); } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(q, false); } }} />
            : <button className="qs-name" title={`Open "${q.name}" as a new project (Ctrl+Z goes back to this one)\nSaved by VICE ${savedText(q.saved)}`} onClick={() => onOpenKept(q)}>
                <span className="qs-name-text">{q.name}</span><span className="muted small">{savedText(q.saved)}</span></button>}
          <button className={cx('icon-btn qs-fav', q.favourite && 'on')} aria-pressed={!!q.favourite}
            title={q.favourite ? 'A favourite: it stays when VICE saves new ones. Click to take the star off' : 'Make it a favourite: it stays when VICE saves new ones'}
            aria-label={q.favourite ? `Remove the quicksave ${q.name} from the favourites` : `Add the quicksave ${q.name} to the favourites`}
            onClick={() => onFavouriteKept(q, !q.favourite)}><Icon name="star" size={13} /></button>
          <button className="icon-btn" title="Name it" aria-label={`Rename the quicksave ${q.name}`} onClick={() => { setName(q.name); setEditing(q.id); }}><Icon name="pencil" size={13} /></button>
          <button className="icon-btn" title="Save it in a folder of your own (a .vsf named as it is)" aria-label={`Save the quicksave ${q.name}`} onClick={() => onSaveKept(q)}><Icon name="download" size={13} /></button>
        </div>
      ))}
    </div>
  );
}

/** VICE's quicksave snapshot: how to make one in VICE, the newest one, opening it, and opening each new one by itself. */
function QuicksaveSection({ info, follow, onOpen, onFollow, ...kept }: QuicksaveProps) {
  const file = info?.path.split(/[\\/]/).pop() || 'C64SC.vsf';
  const time = info?.found && info.saved ? new Date(info.saved).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null;
  return (
    <SideSection id="quicksave" title="VICE quicksave" className="qs-sec" summary={time ?? 'none yet'}>
      <p className="side-hint qs-how">In VICE press <kbd>Alt</kbd>+<kbd>F11</kbd> (Snapshot → Quicksave snapshot): the snapshot {follow ? 'opens here by itself' : 'opens here with F9'}, analysed like a PRG.</p>
      <div className="qs-status small" role="status" aria-label="Latest VICE quicksave">
        {info?.found && info.saved
          ? <><Icon name="ok" size={13} className="qs-ok" /><span>Latest: <b>{savedText(info.saved)}</b> <span className="muted mono" title={info.path}>{file}</span></span></>
          : <><Icon name="info" size={13} /><span className="muted">None yet. VICE writes it as <span className="mono" title={info?.path}>{file}</span> in its settings folder.</span></>}
      </div>
      <button className="btn small qs-open" disabled={!!info && !info.found} onClick={onOpen} title="Open the newest quicksave as a new project (Ctrl+Z goes back to this one)"><Icon name="download" size={13} />Open the latest quicksave <kbd>F9</kbd></button>
      <label className="check small" title="When VICE writes a new quicksave (Alt+F11), it opens here. Ctrl+Z goes back to the project you had.">
        <input type="checkbox" aria-label="Open each new VICE quicksave" checked={follow} onChange={e => onFollow(e.target.checked)} />
        <span>Open new quicksaves automatically</span>
      </label>
      {kept.kept.length > 0 && <KeptQuicksaves {...kept} />}
    </SideSection>
  );
}

/** The Scripts view (its own button in the activity bar): the project's scripts (spec 10.3). Each runs from here (its
 *  changes go into the program), opens in the Scripts tab or is deleted; + makes a new one, and the library's can be
 *  added. */
function ScriptsSideView({ list, checks, patches, onNew, onOpen, onRun, onRemove, onAdd }: ScriptsProps) {
  const running = useScripts(s => s.running), runs = useScripts(s => s.runs), library = useScripts(s => s.library);
  const status = (sc: UserScript): { text: string; bad?: boolean } => {
    if (running === sc.id) return { text: 'running…' };
    const c = checks.get(sc.id), e = c?.problems.find(p => p.level === 'error');
    if (c && !c.ok) return { text: `${e?.line ? `Line ${e.line}: ` : ''}${e?.msg ?? 'does not check out'}`, bad: true };
    const kept = runs[sc.id];
    // a run in safe mode: what it would change (nothing went into the program)
    if (kept?.safe) {
      const on = (kept.would ?? []).filter(p => !p.off), n = on.reduce((k, p) => k + p.bytes.length, 0);
      const head = sc.safe ? 'safe mode' : 'ran in safe mode';
      return { text: n ? `${head}: ${n} byte${n === 1 ? '' : 's'} would change` : `${head}: it would change none of the program's bytes` };
    }
    const mine = scriptPatches(patches, sc.id).filter(p => !p.off), bytes = mine.reduce((n, p) => n + p.bytes.length, 0);
    if (mine.length) return { text: `${bytes} byte${bytes === 1 ? '' : 's'} changed in the program${sc.safe ? ' · safe mode' : ''}` };
    if (kept) return { text: 'ran: it changed none of the program\'s bytes' };
    return { text: sc.safe ? 'safe mode · ready to run' : 'ready to run' };
  };
  return (
    <section className="side-inner scripts-side" aria-label="Scripts">
      <div className="side-title">Scripts <span className="muted">{list.length}</span><span className="grow" />
        <button className="icon-btn" title="New script: Kick Assembler code that runs in Mimir (it opens in the Scripts tab)" aria-label="New script" onClick={onNew}><Icon name="plus" size={14} /></button></div>
      <div className="scripts-side-body">
        {!list.length && <p className="side-hint">A script is Kick Assembler code that runs here in Mimir on the program's bytes: what it changes goes into the program and the source, its own code does not. + makes one.</p>}
        <div role="list" aria-label="Scripts in the project">
          {list.map(sc => {
            const st = status(sc), ok = !!checks.get(sc.id)?.ok, changed = scriptPatches(patches, sc.id).length > 0;
            return (
              <div key={sc.id} role="listitem" className={cx('file-row script-row', running === sc.id && 'running')} onClick={() => onOpen(sc.id)}
                title={`Open "${sc.name}" in the Scripts tab${sc.safe ? '\nSafe mode: its runs write nothing into the program or its .asm' : ''}${runs[sc.id] ? `\nLast run: ${scriptEndText(runs[sc.id].run)}` : ''}`}>
                <Icon name="script" size={14} />
                <div className="file-meta"><div className="file-name">{sc.name}{sc.safe && <Icon name="shield" size={12} className="scr-safe-ico" />}</div><div className={cx('small', st.bad ? 'script-bad' : 'muted')}>{st.text}</div></div>
                <button className="icon-btn" aria-label={`Run ${sc.name}`} disabled={!ok || !!running}
                  title={!ok ? 'It does not check out: open it to fix it' : running ? 'A script is running' : sc.safe ? 'Run it in safe mode: nothing goes into the program; the row says what it would change' : 'Run it: what it changes in the program\'s bytes goes into the program'}
                  onClick={e => { e.stopPropagation(); onRun(sc.id); }}><Icon name="play" size={13} /></button>
                <button className="icon-btn" aria-label={`Delete ${sc.name}`} title={`Delete the script${changed ? ', and take what it changed out of the program' : ''} (Ctrl+Z brings it back)`}
                  onClick={e => { e.stopPropagation(); onRemove(sc.id); }}><Icon name="x" size={13} /></button>
              </div>
            );
          })}
        </div>
        {library.length > 0 && <>
          <div className="side-sub">From the library</div>
          <div className="script-lib" role="list" aria-label="Library scripts to add">
            {library.map(l => <button key={l.name} role="listitem" className="btn tiny ghost" title={`Add a copy of "${l.name}" to the project`} onClick={() => onAdd(l)}><Icon name="plus" size={12} />{l.name}</button>)}
          </div>
        </>}
        <div className="side-actions">
          <button className="btn small" onClick={onNew}><Icon name="plus" size={13} />New script</button>
        </div>
      </div>
    </section>
  );
}

/** The patches by address, each with a switch: a click goes to one (and selects what it wrote); edit, save as PRG,
 *  remove. */
function PatchesSection({ list, onGo, onEdit, onSave, onRemove, onSwitch }: PatchesProps) {
  const sorted = [...list].sort((x, y) => x.start - y.start);
  const on = list.filter(p => !p.off).length;
  return (
    <SideSection id="patches" title="Patches" summary={on === list.length ? `${list.length} on` : `${on} of ${list.length} on`}>
      <div role="list" aria-label="Patches">
        {sorted.map(p => (
          <div key={p.id} role="listitem" className={cx('file-row patch-row', p.off && 'off')} onClick={() => onGo(p)}
            title={`Go to the patch "${p.name}": $${h4(p.start)}–$${h4(patchEnd(p) - 1)}, ${p.bytes.length} bytes${p.over && patchEnd(p) > p.end ? `, ${patchEnd(p) - p.end} past the range` : ''}${p.off ? ' (off)' : ''}\n\n${p.source.length > 400 ? p.source.slice(0, 400) + '…' : p.source}`}>
            <input type="checkbox" role="switch" className="switch" checked={!p.off} aria-label={`Patch ${p.name} on`}
              title={p.off ? 'Off: the original bytes are there. Switch it on' : 'On: written over the original bytes. Switch it off'}
              onClick={e => e.stopPropagation()} onChange={e => onSwitch(p, e.target.checked)} />
            <div className="file-meta"><div className="file-name">{p.name}</div><div className="muted mono small">${h4(p.start)}–${h4(patchEnd(p) - 1)}{p.script ? ' · script' : ''}</div></div>
            <button className="icon-btn" title={`Edit the patch "${p.name}" (P)`} aria-label={`Edit patch ${p.name}`} onClick={e => { e.stopPropagation(); onEdit(p); }}><Icon name="pencil" size={13} /></button>
            <button className="icon-btn" title={`Save as ${patchFileName(p.name)}, loading at $${h4(p.start)}`} aria-label={`Save patch ${p.name} as PRG`} onClick={e => { e.stopPropagation(); onSave(p); }}><Icon name="download" size={13} /></button>
            <button className="icon-btn" title={`Remove the patch${p.off ? '' : `: $${h4(p.start)}–$${h4(patchEnd(p) - 1)} gets its original bytes back`}`} aria-label={`Remove patch ${p.name}`} onClick={e => { e.stopPropagation(); onRemove(p); }}><Icon name="x" size={13} /></button>
          </div>
        ))}
      </div>
      <p className="side-hint">On: written over the loaded bytes. Off: the original bytes are back. The export writes each one's source to patches/ (.asm).</p>
    </SideSection>
  );
}

/**
 * The project's cartridge (spec 13.9): its banks with their chips, where the CPU sees them and how big they are. A
 * bank opens with a click as the project's files (Ctrl+Z goes back); + adds its chips that fit beside the open ones.
 * The export and Build & Run rebuild the whole image, the chips not opened from their bytes.
 */
function CartridgeSection({ crt, name, project, onOpenBank, onOneSource }: { crt: Crt; name: string; project: Project; onOpenBank: (bank: number, leave?: boolean) => void; onOneSource: (on: boolean) => void }) {
  const one = !!project.settings.cartOneSource;
  const banks = useMemo(() => crtBanks(crt), [crt]);
  const open = new Set(project.files.map(f => f.chip).filter((c): c is number => c != null));
  const boot = bootBank(crt);
  const inProject = banks.filter(b => b.chips.some(c => open.has(c.index))).length;
  const kb = (n: number) => (n % 1024 ? `${n} B` : `${n / 1024} KB`);
  return (
    <SideSection id="cart" title="Cartridge" summary={name}>
      <div className="disk-head mono small" title={`${name}: ${crtTypeName(crt.hw)} (type ${crt.hw}), EXROM ${crt.exrom} GAME ${crt.game}, ${crt.chips.length} CHIP packet${crt.chips.length === 1 ? '' : 's'}`}>
        <Icon name="chip" size={13} /><span className="disk-title">{crt.name ? `"${crt.name}"` : name}</span><span className="muted">{crtTypeName(crt.hw)}</span>
      </div>
      <div className="disk-list" role="list" aria-label={`Banks of ${name}`}>
        {banks.map(({ bank, chips }) => {
          const on = chips.some(c => open.has(c.index));
          const where = chips.map(c => `$${h4(chipAddress(crt, c))}`).join(' + ');
          const what = chips.map(c => `${chipTypeName(c.type)} at $${h4(chipAddress(crt, c))}${chipAddress(crt, c) !== c.load ? ` (the file says $${h4(c.load)})` : ''}, ${c.data.length} bytes`).join('; ');
          return (
            <div key={bank} role="listitem" className={cx('disk-row cart-row', on && 'on', !on && 'out')} tabIndex={0}
              title={`${on ? 'Go to bank' : 'Add bank'} ${bank}${bank === boot ? ', the bank the C64 starts in' : ''}: ${what}`}
              onClick={() => onOpenBank(bank)} onKeyDown={e => { if (e.key === 'Enter') onOpenBank(bank); }}>
              <span className="mono small disk-blocks">{bank}</span>
              <span className="mono disk-name">{where}{bank === boot ? <span className="muted"> · start</span> : null}</span>
              <span className="mono small muted">{kb(chips.reduce((n, c) => n + c.data.length, 0))}</span>
              {!on ? <button className="icon-btn" title={`Add bank ${bank} to this project`} aria-label={`Add bank ${bank} to this project`} onClick={e => { e.stopPropagation(); onOpenBank(bank); }}><Icon name="plus" size={13} /></button>
                : inProject > 1 ? <button className="icon-btn cart-leave" title={`Leave bank ${bank} out of the project (the export takes it from the cartridge as it is)`} aria-label={`Leave bank ${bank} out of the project`} onClick={e => { e.stopPropagation(); onOpenBank(bank, true); }}><Icon name="x" size={12} /></button> : <span />}
            </div>
          );
        })}
      </div>
      <label className="check small cart-one" title={`Every bank in one Kick Assembler source, ${name.replace(/\.crt$/i, '').replace(/[^A-Za-z0-9_-]+/g, '_') || 'cartridge'}.crt.asm, which writes the whole cartridge by itself: each chip in a segment, each bank in a namespace (the same names can be in several banks), the header and CHIP packets last. Off: a source per chip and one for the image`}>
        <input type="checkbox" checked={one} onChange={e => onOneSource(e.target.checked)} /> All banks in one .asm
      </label>
      <div className="side-hint">{cartModeName(crt.mode)} · every bank is in the listing, one after the other · a click goes to a bank, + adds one, × leaves one out · the export and Build &amp; Run rebuild the whole .crt</div>
    </SideSection>
  );
}

/** The mounted .d64 or .g64, listed the way the 1541 lists it, in Mimir's list or (Settings → General) as the C64's
 *  screen after LOAD"$",8 and LIST, where Aa switches the character set. A PRG opens with a click or Enter; + adds it
 *  to the project. Enter's default is prevented: it would also press the button a dialog the opening shows has focused
 *  ("The work is not saved" → Save as a project…) */
function DiskSection({ disk, open, onEject, onOpenFromDisk, onShowSpindle, onShowBitfire, onShowBooze, onShowSparkle, onShowKrill, onShowCovert, onShowPirateSlayer }: { disk: MountedDisk; open: ReadonlySet<D64File>; onEject: () => void; onOpenFromDisk: (f: D64File, add: boolean) => void; onShowSpindle: () => void; onShowBitfire: () => void; onShowBooze: () => void; onShowSparkle: () => void; onShowKrill: () => void; onShowCovert: () => void; onShowPirateSlayer: () => void }) {
  const { img } = disk;
  // Settings → General: the directory as a C64 lists it, and its character set switched as Commodore+Shift does (for
  // this disk; null: as the listing leaves it)
  const c64 = useUi(s => s.diskLook) === 'c64';
  const [lower, setLower] = useState<{ bytes: Uint8Array; lower: boolean } | null>(null);
  const lowerNow = lower?.bytes === disk.bytes ? lower.lower : null;
  const kindOf = (f: D64File) => `${f.closed ? '' : '*'}${f.type}${f.locked ? '<' : ''}`;
  const titleOf = (f: D64File) => (f.type === 'PRG' ? `Open ${f.name} (${f.blocks} blocks)${open.has(f) ? ': it is in the project' : ''}. ↑ ↓ go from file to file, Alt+↓ / Alt+↑ open the next and the one before` : 'Only PRG files can be opened');
  const actions = <>
    {c64 && <button className={cx('icon-btn c64-case', lowerNow && 'on')} aria-pressed={!!lowerNow}
      title={lowerNow ? 'Upper case and graphics, as Commodore+Shift switches the C64 back' : 'Lower and upper case, as Commodore+Shift switches the C64'}
      aria-label="Lower case character set" onClick={() => setLower({ bytes: disk.bytes, lower: !(lowerNow ?? false) })}>Aa</button>}
    <button className="icon-btn" title={`Eject ${disk.name}`} aria-label="Eject disk" onClick={onEject}><Icon name="eject" size={14} /></button>
  </>;
  return (
    <SideSection id="disk" title="Disk" summary={`"${img.name}"`} actions={actions}>
      {c64 ? <DiskScreen disk={disk} open={open} lower={lowerNow} onOpenFromDisk={onOpenFromDisk} listKeys={listKeys} titleOf={titleOf} kindOf={kindOf} /> : <>
      <div className="disk-head mono small" title={disk.path ?? disk.name}><Icon name="disk" size={13} /><span className="disk-title">"{img.name}"</span><span className="muted">{img.id} {img.dosType}</span></div>
      <div className="disk-list" role="list" aria-label={`Files on ${disk.name}`}>
        {img.files.map((f, i) => {
          const prg = f.type === 'PRG';
          return (
            <div key={i} role="listitem" className={cx('disk-row', !prg && 'off', open.has(f) && 'on')} aria-current={open.has(f) || undefined}
              title={titleOf(f)}
              tabIndex={prg ? 0 : -1} onClick={() => { if (prg) onOpenFromDisk(f, false); }} onKeyDown={e => { if (listKeys(e)) return; if (prg && e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); onOpenFromDisk(f, false); } }}>
              <span className="mono small disk-blocks">{f.blocks}</span>
              <span className="mono disk-name">"{f.name}"</span>
              <span className="mono small muted">{kindOf(f)}</span>
              {prg ? <button className="icon-btn" title={`Add ${f.name} to this project`} aria-label={`Add ${f.name} to this project`} onClick={e => { e.stopPropagation(); onOpenFromDisk(f, true); }}><Icon name="plus" size={13} /></button> : <span />}
            </div>
          );
        })}
        {!img.files.length && <div className="muted small">No files on this disk.</div>}
      </div>
      </>}
      {disk.sides.length > 0 && (
        <div className="disk-sides muted small" title="The release's next disks or sides, from the disk's folder (or dropped with it): Sindri turns to them, in this order, when the program asks for another side and waits">
          Then {disk.sides.map(s => s.name).join(', ')}
        </div>
      )}
      {disk.spindle && (
        <div className="disk-spindle">
          <span><b>Spindle 3 disk:</b> {disk.spindle.jobs.length} job{disk.spindle.jobs.length === 1 ? '' : 's'} the loader reads, not files</span>
          <button className="btn small" onClick={onShowSpindle}>Load script</button>
        </div>
      )}
      {disk.bitfire && (
        <div className="disk-spindle">
          <span><b>Bitfire disk:</b> {disk.bitfire.files.length} file{disk.bitfire.files.length === 1 ? '' : 's'} the loader reads, not in the directory</span>
          <button className="btn small" onClick={onShowBitfire}>Bitfire script</button>
        </div>
      )}
      {disk.booze && (
        <div className="disk-spindle">
          <span><b>BoozeLoader disk:</b> {disk.booze.files.length} file{disk.booze.files.length === 1 ? '' : 's'} the loader reads, not in the directory</span>
          <button className="btn small" onClick={onShowBooze}>Booze script</button>
        </div>
      )}
      {disk.sparkle && (
        <div className="disk-spindle">
          <span><b>Sparkle disk:</b> {disk.sparkle.bundles.length} bundle{disk.sparkle.bundles.length === 1 ? '' : 's'} of files the loader reads, not in the directory</span>
          <button className="btn small" onClick={onShowSparkle}>Sparkle script</button>
        </div>
      )}
      {disk.krill && (
        <div className="disk-spindle">
          <span><b>Krill's loader:</b> {disk.krill.files.filter(f => f.unpacked).length} files in the directory packed with {KRILL_PACKER[disk.krill.packer].name}, loaded in the directory's order</span>
          <button className="btn small" onClick={onShowKrill}>Krill script</button>
        </div>
      )}
      {disk.covert && (
        <div className="disk-spindle">
          <span><b>Covert Bitops loader:</b> {covertSummary(disk.covert)}; files loaded by name{disk.covert.tool ? `, laid out by ${disk.covert.tool}` : ''}</span>
          <button className="btn small" onClick={onShowCovert}>Covert script</button>
        </div>
      )}
      {disk.pirateslayer && (
        <div className="disk-spindle">
          <span><b>Pirate Slayer:</b> {disk.pirateslayer.keys.length ? `the key on track ${disk.pirateslayer.keys.map(k => k.track).join(' and ')}, no SYNC` : disk.pirateslayer.format === 'D64' ? 'a D64 has no key track: the boot fails its check' : 'no key track on the image'}{disk.pirateslayer.boot ? `; boot ${disk.pirateslayer.boot.files.join(' → ')}` : ''}{disk.pirateslayer.files.length ? `; ${disk.pirateslayer.files.length} file${disk.pirateslayer.files.length === 1 ? '' : 's'} outside the directory` : ''}</span>
          <button className="btn small" onClick={onShowPirateSlayer}>Pirate Slayer</button>
        </div>
      )}
      <div className="side-hint">{c64 ? '' : `${img.freeBlocks} blocks free · `}{img.tracks !== 35 ? `${img.tracks} tracks · ` : ''}{img.format === 'G64' ? 'G64 (GCR tracks) · ' : ''}in drive 8 on Build &amp; Run</div>
    </SideSection>
  );
}

/** ↑ ↓ Home End in a list of files to open (the disk's, the tape's): the focus goes to the next one that opens, and the
 *  listing does not move its cursor as well. True when the key was one of them */
function listKeys(e: KeyboardEvent<HTMLElement>): boolean {
  if (e.altKey || e.ctrlKey || e.metaKey || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return false;
  e.preventDefault(); e.stopPropagation();
  const rows = [...(e.currentTarget.parentElement?.querySelectorAll<HTMLElement>('[role=listitem][tabindex="0"]') ?? [])];
  const i = rows.indexOf(e.currentTarget);
  (e.key === 'ArrowDown' ? rows[i + 1] : e.key === 'ArrowUp' ? rows[i - 1] : e.key === 'Home' ? rows[0] : rows[rows.length - 1])?.focus();
  return true;
}

/** a file of the tape that opens: one with its load address and data, not a SEQ file or the end-of-tape marker */
export const tapeOpens = (f: TapeFile): boolean => f.load != null && f.data.length > 0 && f.type !== 'SEQ' && f.type !== 'END';

/** a time on the tape, as a datasette's counter would not show it but a player does: m:ss */
export const tapeTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const TAPE_FORMAT: Record<TapeFile['format'], string> = { cbm: 'KERNAL', tapetool: 'TapeTool', turbotape: 'Turbo Tape', freeload: 'Freeload', usgold: 'US Gold', t64: 'T64' };

/** The tape in the datasette (13.5e), its files in tape order with where each starts. A file opens with a click (a KERNAL
 *  file with loader code in its header opens with the header as a second file); + adds it to the project. A T64 tape
 *  archive (13.5j) lists its directory, each file by its entry number. */
function TapeSection({ tape, open, onEject, onOpenFromTape, onShowTape }: { tape: MountedTape; open: ReadonlySet<TapeFile>; onEject: () => void; onOpenFromTape: (f: TapeFile, add: boolean) => void; onShowTape: () => void }) {
  const { img } = tape;
  const tt = img.files.filter(f => f.format === 'tapetool').length;
  const t64 = img.t64;
  return (
    <SideSection id="tape" title="Tape" summary={tape.name} actions={<button className="icon-btn" title={`Eject ${tape.name}`} aria-label="Eject tape" onClick={onEject}><Icon name="eject" size={14} /></button>}>
      <div className="disk-head mono small" title={tape.path ?? tape.name}><Icon name="tape" size={13} /><span className="disk-title">{tape.name}</span><span className="muted">{t64 ? 'T64' : tapeTime(img.seconds)}</span></div>
      <div className="disk-list" role="list" aria-label={`Files on ${tape.name}`}>
        {img.files.map((f, i) => {
          const can = tapeOpens(f);
          const where = f.load != null ? `$${h4(f.load)}-$${h4((f.load + Math.max(1, f.data.length) - 1) & 0xffff)}` : `${f.data.length} bytes`;
          const why = !can ? (f.type === 'SEQ' ? 'A SEQ file: data, not a program' : f.type === 'END' ? 'The end-of-tape marker' : f.t64 && f.load == null ? 'A C64S memory snapshot, not a program' : f.load == null ? 'Its load address is not on the tape: the boot loader knows it' : 'It holds no data') : '';
          const title = `${f.errors.length ? `${f.errors.join('; ')}. ` : ''}${f.note ? `${f.note}. ` : ''}${can ? `Open ${f.name} (${TAPE_FORMAT[f.format]}, ${where}${f.headerCode ? ', with its header: the tape buffer at $033c holds code' : ''})${open.has(f) ? ': it is in the project' : ''}. ↑ ↓ go from file to file, Alt+↓ / Alt+↑ open the next and the one before` : why}`;
          return (
            <div key={i} role="listitem" className={cx('disk-row tape-row', !can && 'off', f.errors.length > 0 && 'bad', open.has(f) && 'on')} aria-current={open.has(f) || undefined} title={title}
              tabIndex={can ? 0 : -1} onClick={() => { if (can) onOpenFromTape(f, false); }} onKeyDown={e => { if (listKeys(e)) return; if (can && e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); onOpenFromTape(f, false); } }}>
              <span className="mono small disk-blocks" title={t64 ? `Entry ${f.id} of the directory` : undefined}>{t64 ? f.id : tapeTime(f.seconds)}</span>
              <span className="mono disk-name">{f.format === 'tapetool' ? f.name : `"${f.name}"`}{f.headerCode ? <span className="muted"> +header</span> : null}</span>
              <span className="mono small muted">{f.format === 't64' ? (f.load == null ? 'FRZ' : f.type) : f.format === 'cbm' ? f.type : TAPE_FORMAT[f.format]}</span>
              {can ? <button className="icon-btn" title={`Add ${f.name} to this project`} aria-label={`Add ${f.name} to this project`} onClick={e => { e.stopPropagation(); onOpenFromTape(f, true); }}><Icon name="plus" size={13} /></button> : <span />}
            </div>
          );
        })}
        {!img.files.length && <div className="muted small">{t64 ? 'No files in the T64’s directory.' : 'No files in a format known here (KERNAL, TapeTool, Turbo Tape, Freeload, US Gold).'}</div>}
      </div>
      {(img.unknown.length > 0 || tt > 0) && (
        <div className="disk-spindle">
          <span>{tt ? <><b>TapeTool tape:</b> {tt} turbo file{tt === 1 ? '' : 's'} its boot loader reads{img.unknown.length ? '; ' : ''}</> : null}
            {img.unknown.length ? <><b>Turbo data</b> no format here reads ({img.unknown.length} stretch{img.unknown.length === 1 ? '' : 'es'}): Sindri reads it, running the boot file with the tape in its datasette</> : null}</span>
          <button className="btn small" onClick={onShowTape}>{tt ? 'TapeTool script' : 'Tape'}</button>
        </div>
      )}
      <div className="side-hint">{img.files.length} file{img.files.length === 1 ? '' : 's'} · {t64 ? `T64${t64.name ? ` "${t64.name}"` : ''}` : `TAP v${img.version}`} · in the datasette on Build &amp; Run</div>
    </SideSection>
  );
}

const LOADER_ROLE: Record<LoaderPart['role'], string> = { resident: 'on the C64', drivecode: 'drive code', command: 'drive command', install: 'installer', tape: 'tape loader', kernal: 'KERNAL LOAD', text: 'its name' };

/** The fast, IRQ and tape loaders the analysis found (spec 8.11c): what each is, how it works and where its parts are. */
function LoadersSection({ A, packed, onNavigate }: { A: AnalysisResult; packed: boolean; onNavigate: (a: Addr) => void }) {
  return (
    <SideSection id="loaders" title="Loaders" className="loader-sec" summary={A.loaders.length ? `${A.loaders.length} found` : 'none found'}>
      {A.loaders.length ? A.loaders.map((l, i) => (
        <div key={`${l.id}-${i}`} className="loader" aria-label={l.name}>
          <div className="loader-name">{l.name}{l.sure === 'likely' && <span className="pill" title="Found by what loaders do (drive code, drive commands, a receive loop), not by its own code">by its traits</span>}</div>
          <div className="muted small">{l.how}</div>
          <ul className="loader-parts">
            {l.parts.slice(0, 12).map((p, i) => (
              <li key={i} className={p.outside ? 'outside' : undefined}>{p.outside
                ? <span className="mono" title={p.what}>${h4(p.start)}–${h4(p.end - 1)}</span>
                : <button className="mono" title={`${p.what}\nClick to go there`} onClick={() => onNavigate(p.start)}>{bankAdr(A, p.start)}–${h4(p.end - 1)}</button>}
              <span>{LOADER_ROLE[p.role]}{p.outside && ' · not opened'}</span></li>
            ))}
            {l.parts.length > 12 && <li className="muted">and {l.parts.length - 12} more, marked in the listing</li>}
          </ul>
          {l.parts.some(p => p.outside) && <p className="side-hint">Part of it is in the snapshot's zero page or stack, which is not opened. Tick <i>VICE snapshots: include the zero page and the stack</i> in Settings → Analysis and open the snapshot again to see it.</p>}
        </div>
      )) : <p className="side-hint">{packed ? 'None found: the program is packed, and its loader with it. Unpack it (the notice above the listing) to find it.' : 'No fast, IRQ or tape loader found, and no KERNAL LOAD.'}</p>}
    </SideSection>
  );
}

/** How Build & Run starts the first file in VICE (see App.runBuild and prepareVice); `snapshot`: where the snapshot the
 *  project was opened from goes on, which Build & Run restarts instead; `port`: $01 as the program starts at `ep` (what
 *  Sindri saw there when Unpack set it) */
function viceStartText(A: AnalysisResult, ep: Addr | null, snapshot?: string | null, port?: number | null): { text: string; warn?: boolean } {
  if (snapshot) return { text: `VICE restarts the snapshot as it was taken (${snapshot}); the start is for the analysis` };
  const f0 = A.files[0];
  const overSystem = !!f0 && overwritesSystemArea(f0.load, f0.bytes.length);
  // (a program over the screen at READY would lose the bytes typing writes there)
  const monitor = !!f0 && startsFromMonitor(f0.load, f0.bytes.length);
  const p = port != null && port !== 0x37 ? port : null;
  if (ep != null && A.owner[ep] === 0) return { text: monitor ? `VICE loads it from the monitor and jumps to $${h4(ep)}${p != null ? ` with $01 = $${h2(p)}` : ''}`
    : p != null ? `VICE loads it and starts it at $${h4(ep)} with $01 = $${h2(p)}, through a stub at $${h4(START_STUB)} (sys ${START_STUB})` : `VICE loads it and types sys ${ep}` };
  if (ep != null && A.owner[ep] > 0) return { text: 'VICE starts it with RUN: the start is in another file', warn: true };
  return overSystem ? { text: `VICE starts it with RUN, which cannot work: it overwrites $${h4(SYSTEM_AREA.start)}-$${h4(SYSTEM_AREA.end - 1)}. Set a start.`, warn: true } : { text: 'VICE starts it with RUN, no start address' };
}

/** Where the program starts: detected (BASIC SYS target or the load address) or typed in by the user. */
function ProgramStart({ A, R, project, onNavigate, onSetStart }: Pick<SidebarProps, 'A' | 'R' | 'project' | 'onNavigate' | 'onSetStart'>) {
  const [v, setV] = useState('');
  const [err, setErr] = useState('');
  const sys = A.basics.find(b => b.sys != null)?.sys;
  const detected = sys != null ? { a: sys, from: 'BASIC SYS' } : A.files[0] ? { a: A.files[0].load, from: 'load address' } : null;
  const user = project.entryPoint != null && A.owner[project.entryPoint] >= 0;
  const name = A.entry != null ? R.labels.get(A.entry)?.name : undefined;
  // a project opened from a snapshot: where the CPU was when it was taken
  const vsf = project.files.find(f => f.vsf)?.vsf;
  const snapshot = useMemo(() => { if (!vsf) return null; try { const s = parseVsf(vsf); return [s.cpu ? `PC $${h4(s.cpu.pc)}` : null, `$01 = $${h2(s.port.data)}`].filter(Boolean).join(', '); } catch { return null; } }, [vsf]);
  const vice = viceStartText(A, project.entryPoint, snapshot, project.entryPort);
  const apply = () => {
    const t = parseGoto(v, n => { for (const [a, l] of R.labels) if (l.name === n) return a; return undefined; });
    if (!('addr' in t)) { setErr('Enter one hex address like $0810 or a label name.'); return; }
    if (A.owner[t.addr] < 0) { setErr(`$${h4(t.addr)} is not part of any loaded file.`); return; }
    setErr(''); setV(''); onSetStart(t.addr);
  };
  return (
    <SideSection id="start" title="Program start" summary={A.entry != null ? `$${h4(A.entry)}` : 'none'}>
      {A.entry != null && <button className="seg-row start-at" onClick={() => onNavigate(A.entry!)}>
        <i style={{ background: 'var(--g-code)' }} /><span className="mono">${h4(A.entry)}</span><span className="seg-name">{name ?? ''}</span>
        <span className={cx('pill', user && 'user')}>{user ? 'set by you' : detected ? detected.from : ''}</span>
      </button>}
      <div className="start-row">
        <input className="mono" aria-label="Program start address" value={v} placeholder="$0810 or a label" spellCheck={false}
          onChange={e => { setV(e.target.value); setErr(''); }} onKeyDown={e => { if (e.key === 'Enter') apply(); }} />
        <button className="btn small" onClick={apply}>Set</button>
        {project.entryPoint != null && <button className="btn small ghost" title={`Clear the program start: the analysis uses the detected start again${detected ? ` (${detected.from} $${h4(detected.a)})` : ''} and VICE starts the program with RUN`}
          onClick={() => { setErr(''); setV(''); onSetStart(null); }}><Icon name="x" size={12} />Clear</button>}
      </div>
      {err && <div className="err-text small">{err}</div>}
      <div className={cx('small start-vice', vice.warn ? 'warn-text' : 'muted')}><Icon name="play" size={11} />Build &amp; Run: {vice.text}</div>
    </SideSection>
  );
}
