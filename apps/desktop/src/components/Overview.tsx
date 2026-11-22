/* The overview of the analysis (spec 14.1b): once the analysis of a file just opened is in, a window in the middle of
 * the app says what it found, part by part (the file and the block map, packing, the program start, the loaders, the
 * problems, the blocks by type, the code, graphics and music), with links to each part: the program start, a type of
 * block (its folder in the Blocks view), a loader's parts, the tabs Listing, the .asm source, Graphics and Memory; the
 * music found has a Play button (VICE or DeepSID, as the Blocks view's), which leaves the window open. A link, a click
 * outside the window or Esc closes it; Settings → General (or the box at its foot) turns it off. The title bar's
 * Analysis overview button (and the command palette) opens it again at any time. While Sindri (or unp64 -i) is still
 * running a file to see whether it is packed, which can take half a minute, a card says it is looking, and what it
 * found once it is done. */
import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react';
import { cryptStepsText, cryptWhereText, h4, T, type Addr, type AnalysisResult, type CryptLoop, type Block, type BlockKind, type LoaderPart, type MusicPlayer, type PackingInfo, type Project, type RoutineMatch } from '@mimir/core';
import { Icon } from '../lib/icons';
import type { IconName } from '../lib/icon-paths';
import { animDataText, type AnimData } from '../lib/storeanim';
import { blockMap, count, GFX_KIND, nameNear, problemCounts, regsText, routinesOf, snapshotVic, startOf, typeRows, vicBankText, vicModeText, vicParts, vicRasterText, type SnapshotPc } from '../lib/overview';
import { C64, C64_NAMES } from '../lib/palette';
import type { UiProblem } from '../lib/types';
import { bankAdr, cx, fmtBytes, GROUP_LABEL, musicPlayTitle } from '../lib/util';
import type { BottomTab, EditorTab } from '../store/ui';
import { Modal } from './Modal';
import type { LibraryScript } from '../store/scripts';
import { SnapshotScreen } from './SnapshotScreen';

/** a script of the library that fits the program: its name and the names it needs */
type T_Fitting = LibraryScript;

/** a check of whether a file is packed: Sindri running it (or unp64 -i naming its packer) */
export interface PackCheck {
  /** when it began (Date.now()) */
  since: number;
  /** ms it took, once it is done */
  took?: number;
  /** it never came to an end (the run failed, or the unpacker could not say) */
  failed?: boolean;
}

/** the check of a file of the project */
export interface PackLook extends PackCheck {
  id: string;
  /** its index in the project's files */
  i: number;
  /** who looks: Sindri, or the external unpacker's name */
  by: string;
}

/** where the overview's links go (the window closes first) */
export interface OverviewLinks {
  /** the listing at an address */
  addr: (a: Addr) => void;
  /** an editor tab; Graphics with a block: at the block, drawn as its type is */
  tab: (t: EditorTab, b?: Block) => void;
  /** the Blocks view with the folder of the type open, and the listing at its first block */
  blocks: (kind: BlockKind, first: Addr) => void;
  /** a section of the Explorer opened, and the listing at an address in it */
  section: (id: 'loaders' | 'start', at?: Addr) => void;
  /** a tab of the bottom panel */
  bottom: (t: BottomTab) => void;
  /** Unpack file `i` */
  unpack: (i: number) => void;
}

interface OverviewProps {
  A: AnalysisResult; project: Project; labels: ReadonlyMap<Addr, { name: string }>;
  /** the project was opened from a VICE snapshot: where its CPU was when it was saved */
  snap?: SnapshotPc | null;
  packing: readonly (PackingInfo | null)[]; problems: readonly UiProblem[];
  /** the files that are animation data a player in another Spindle job stores frame by frame: what each holds */
  animData?: readonly (AnimData | null)[];
  /** the checks of whether the files are packed (those still running show; those done show their end if they were
   *  running while the overview was open) */
  looking?: readonly PackLook[];
  /** the .asm file the source tab shows first */
  source: string;
  unpackLabel: string;
  /** an unpack or a build is under way (Unpack waits) */
  busy: boolean;
  /** the bottom panel's script tabs that are there (Spindle, Booze …): the tab and its name */
  scripts: readonly [BottomTab, string][];
  /** the overview opens by itself after a load (Settings → General) */
  auto: boolean; onAuto: (on: boolean) => void;
  /** play the music block that starts at an address, in VICE or DeepSID as `musicPlayer` says (Settings → Toolchain) */
  onPlayMusic?: (start: Addr) => void;
  musicPlayer: MusicPlayer;
  /** the routines known from other projects that have no name of the user's yet, with the names suggested (10.5), and
   *  what names them all (the overview stays open) */
  known?: readonly RoutineMatch[]; onNameKnown?: () => void;
  /** the program's loops that change bytes with a key and store them (10.3), and what makes a script that does the
   *  same from one (the window closes: the script is shown) */
  crypt?: readonly CryptLoop[]; onCryptScript?: (l: CryptLoop) => void;
  /** the library's scripts that fit this program (it has every name they need), and what adds one (the window closes) */
  fitting?: readonly T_Fitting[]; onAddFitting?: (s: T_Fitting) => void;
  links: OverviewLinks; onClose: () => void;
}

const LOADER_ROLE: Record<LoaderPart['role'], string> = { resident: 'on the C64', drivecode: 'drive code', command: 'drive command', install: 'installer', tape: 'tape loader', kernal: 'KERNAL LOAD', text: 'its name' };

/** a part of what the analysis found: a card with its name, how many, and what it says */
function Card({ icon, title, n, wide, className, children }: { icon: IconName; title: string; n?: ReactNode; wide?: boolean; className?: string; children: ReactNode }) {
  return (
    <section className={cx('ov-card', wide && 'wide', className)} aria-label={title}>
      <h3><Icon name={icon} size={13} />{title}{n != null && <span className="ov-n">{n}</span>}</h3>
      {children}
    </section>
  );
}

/** a link of the overview: it looks like a link and goes where it says */
const Link = ({ onClick, title, className, children }: { onClick: () => void; title?: string; className?: string; children: ReactNode }) =>
  <button type="button" className={cx('ov-link', className)} title={title} onClick={onClick}>{children}</button>;

/** the whole seconds since `since`, counting up while it shows (nothing in the first second) */
function Seconds({ since }: { since: number }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const s = Math.floor((now - since) / 1000);
  return s >= 1 ? <span className="ov-secs"> ({s} s)</span> : null;
}

/** what the one looking does while it looks */
const lookText = (by: string) => (by === 'Sindri' ? 'Sindri is running it to see whether it unpacks itself' : `${by} is naming its packer`);

/** The checks the overview has seen running (by file and when it began): once one is done, a file that turned out
 *  packed has its Packed card, and one that did not says so in place of the card that was looking. A check done before
 *  the overview opened says nothing (it would be a card for every file that is not packed). */
function useSeenRunning(looks: readonly PackLook[]) {
  const [seen, setSeen] = useState<ReadonlySet<string>>(() => new Set());
  const key = looks.filter(l => l.took == null).map(l => `${l.id}@${l.since}`).join();
  useEffect(() => {
    if (key) setSeen(m => (key.split(',').every(k => m.has(k)) ? m : new Set([...m, ...key.split(',')])));
  }, [key]);
  return (l: PackLook) => seen.has(`${l.id}@${l.since}`);
}

export function AnalysisOverview({ A, project, labels, snap, packing, animData = [], looking = [], problems, source, unpackLabel, busy, scripts, auto, onAuto, onPlayMusic, musicPlayer, known = [], onNameKnown, crypt = [], onCryptScript, fitting = [], onAddFitting, links, onClose }: OverviewProps) {
  /** every link closes the window, then goes there */
  const go = (f: () => void) => () => { onClose(); f(); };
  const start = startOf(A, project);
  const map = blockMap(A.blocks);
  const types = typeRows(A.blocks);
  const gfx = types.filter(t => GFX_KIND[t.kind]);
  const firstGfx = gfx.reduce<Block | undefined>((b, t) => (!b || t.first.start < b.start ? t.first : b), undefined);
  const probs = problemCounts(problems);
  const { subs, handlers } = routinesOf(A);
  const packed = packing.flatMap((p, i) => (p ? [{ p, i }] : []));
  const seen = useSeenRunning(looking);
  /** the check of file `i` while it runs */
  const lookAt = (i: number) => looking.find(l => l.i === i && l.took == null);
  // the files still looked for that nothing has called packed yet, and those the overview saw looked for that are done
  // and not packed (or whose check failed)
  const lookCards = looking.filter(l => l.took == null ? !packing[l.i] : seen(l) && (l.failed || !packing[l.i]))
    .map(l => ({ l, name: project.files[l.i]?.name ?? '' }));
  const drive = A.loaders.some(l => l.parts.some(p => p.role === 'drivecode' && !p.outside));
  const name = (a: Addr) => labels.get(a)?.name;
  const loaded = A.stats.total;
  const chips = project.files.filter(f => f.chip != null).length;
  const relocs = A.relocs.length + A.copies.length;
  const lines = [...new Set(A.raster.map(r => r.line).filter((l): l is number => l != null))].sort((x, y) => x - y);
  const vic = [...A.vic.banks].sort();
  const pct = (n: number) => (loaded ? `${Math.round(n / loaded * 100)} %` : '');
  // the bytes the type map has as code (Stats.codeBytes is not counted)
  const codeBytes = A.stats.bytesByType[T.CODE] ?? 0;
  // the VIC-II of the snapshot the project was opened from
  const snapVic = useMemo(() => snapshotVic(project.files), [project.files]);
  return (
    <Modal title="Analysis overview" onClose={onClose} className="overview">
      <div className="modal-body ov-body">
        <div className="ov-files">
          {project.cart
            ? <span><b>{project.cart.name}</b> · a cartridge, {count(chips, 'chip')}{A.spaces ? ` in ${count(A.spaces.length, 'bank')}` : ''}</span>
            : project.files.slice(0, 4).map((f, i) => (
              <span key={f.id || i}><b>{f.name}</b> <span className="mono">${h4(f.load)}–${h4(f.load + f.bytes.length - 1)}</span> · {fmtBytes(f.bytes.length)}{f.vsf ? ' · VICE snapshot' : ''}</span>))}
          {!project.cart && project.files.length > 4 && <span>and {project.files.length - 4} more</span>}
          <span className="grow" />
          <span className="muted">{fmtBytes(loaded)} analysed in {Math.max(1, Math.round(A.deep?.ms ?? A.stats.ms))} ms{A.deep ? `, deep (${count(A.deep.rounds, 'round')})` : ''}</span>
        </div>

        {map.length > 0 && <div className="ov-map" role="group" aria-label="The blocks in memory">
          {map.map(r => (
            <Fragment key={r.start}>
              {r.gap && <i className="ov-gap" />}
              <button type="button" tabIndex={-1} style={{ flexGrow: r.end - r.start, background: `var(--g-${r.group})` }}
                aria-label={`${GROUP_LABEL[r.group]} at ${bankAdr(A, r.start)}`}
                title={`${bankAdr(A, r.start)}–$${h4(r.end - 1)} · ${GROUP_LABEL[r.group]}${r.blocks > 1 ? ` (${r.blocks} blocks)` : ''} · ${fmtBytes(r.end - r.start)}\nClick to go there in the listing`}
                onClick={go(() => links.addr(r.start))} />
            </Fragment>))}
        </div>}

        <div className="ov-open" role="group" aria-label="Open">
          <span className="ov-open-label">Open</span>
          <button type="button" className="btn small" title={`The listing: the program disassembled as ${A.S.assembler === '64tass' ? '64tass' : 'Kick Assembler'} code, block by block`} onClick={go(() => links.tab('listing'))}><Icon name="list" size={13} />Listing</button>
          <button type="button" className="btn small" title={`The ${A.S.assembler === '64tass' ? '64tass' : 'Kick Assembler'} source the export writes`} onClick={go(() => links.tab('source'))}><Icon name="code" size={13} />{source}</button>
          <button type="button" className="btn small" title={firstGfx ? `Graphics: memory as characters, sprites or bitmaps, at the first graphics block (${bankAdr(A, firstGfx.start)})` : 'Graphics: memory as characters, sprites or bitmaps'} onClick={go(() => links.tab('gfx', firstGfx))}><Icon name="image" size={13} />Graphics</button>
          <button type="button" className="btn small" title="Memory: the bytes as the VICE monitor shows them" onClick={go(() => links.tab('mem'))}><Icon name="chip" size={13} />Memory</button>
          {drive && <button type="button" className="btn small" title="The drive code: the code the program uploads to the 1541, where it runs there" onClick={go(() => links.tab('drive'))}><Icon name="disk" size={13} />Drive code</button>}
        </div>

        <div className="ov-grid">
          {animData.map((d, i) => d && (
            <Card key={`anim-${i}`} icon="film" title="Animation data" wide className="ov-anim-data">
              <p><b>{project.files[i]?.name}</b> is animation data, not packed: {animDataText(d)}. There is nothing to unpack.</p>
            </Card>))}
          {packed.map(({ p, i }) => (
            <Card key={`pack-${i}`} icon="pack" title={p.verdict === 'packed' ? 'Packed' : 'Maybe packed'} wide className="ov-packed">
              <p><b>{A.files[i]?.name}</b> {p.verdict === 'packed' ? 'is packed' : 'may be packed'}{p.signature ? ` (${p.signature})` : ''}: {p.reasons.join('; ')}. What the analysis sees is the decruncher{p.decruncher != null ? ` at $${h4(p.decruncher)}` : ''} and the packed data, not the program.</p>
              {lookAt(i) && <p className="ov-look" role="status"><span className="spinner" aria-hidden />
                <span>{lookText(lookAt(i)!.by)}<Seconds since={lookAt(i)!.since} />: {lookAt(i)!.by === 'Sindri' ? 'what comes off names the packer' : 'the name it gives replaces the guess'}.</span></p>}
              <div className="ov-more">
                <button type="button" className="btn small primary" disabled={busy} onClick={go(() => links.unpack(i))}>{unpackLabel}</button>
                {p.decruncher != null && <Link onClick={go(() => links.addr(p.decruncher!))}>The decruncher</Link>}
              </div>
            </Card>))}

          {lookCards.map(({ l, name: fname }) => {
            const sindri = l.by === 'Sindri';
            if (l.took == null) return (
              <Card key={`look-${l.id}`} icon="pack" title="Looking for packing" wide className="ov-looking">
                <p className="ov-look" role="status"><span className="spinner" aria-hidden />
                  <span><b>{fname}</b>: {lookText(l.by)}…<Seconds since={l.since} /></span></p>
                <p className="muted">{sindri
                  ? 'Some packers show only when they run: if a layer comes off, the file shows here as packed, with Unpack. Until then the rest of the overview is of the file as it was opened.'
                  : 'If it knows the packer, the file shows here as packed, with Unpack.'}</p>
              </Card>);
            const secs = l.took >= 1000 ? ` (${Math.round(l.took / 1000)} s)` : '';
            return l.failed
              ? <Card key={`look-${l.id}`} icon="warn" title="Packing not checked" wide className="ov-looked">
                <p><b>{fname}</b>: {sindri ? 'Sindri could not run it' : `${l.by} could not say which packer it is`}{secs}. {packing[l.i] ? 'The card above is what the analysis sees in its bytes.' : 'The analysis sees no packer in its bytes.'}</p>
              </Card>
              : <Card key={`look-${l.id}`} icon="ok" title="Not packed" wide className="ov-looked">
                <p><b>{fname}</b> {sindri ? 'is not packed: Sindri ran it and nothing unpacked itself' : `is not packed as far as ${l.by} knows: it names no packer`}{secs}.</p>
              </Card>;
          })}

          {snapVic && (() => {
            const { st, vic: v } = snapVic;
            /** a part the VIC reads: Graphics at its block when it is graphics, else the listing; not loaded: no link */
            const partLink = (a: Addr) => {
              const b = A.blocks.find(x => x.start <= a && a < x.end);
              return b && GFX_KIND[b.type] ? () => links.tab('gfx', b) : A.owner[a] >= 0 ? () => links.addr(a) : null;
            };
            const screen = partLink(st.screen);
            const swatch = (what: string, c: number) => <span className="ov-vic-colour" key={what}><i style={{ background: C64[c] }} />{what} <span className="muted">{C64_NAMES[c]}</span></span>;
            const colours = [swatch('Border', st.border), swatch('Background', st.bg[0])];
            if (st.mode === 'mc-text') colours.push(swatch('Multicolour 1', st.bg[1]), swatch('Multicolour 2', st.bg[2]));
            if (st.mode === 'ecm-text') colours.push(swatch('Background 1', st.bg[1]), swatch('Background 2', st.bg[2]), swatch('Background 3', st.bg[3]));
            if (st.sprites.some(s => s.on && s.mc)) colours.push(swatch('Sprite multicolour 1', st.spriteMc[0]), swatch('Sprite multicolour 2', st.spriteMc[1]));
            return (
              <Card icon="image" title="Snapshot screen" wide className="ov-vic">
                <div className="ov-vic-body">
                  <SnapshotScreen st={st} ram={snapVic.ram} colorRam={v.colorRam} className="ov-vic-pic" label="The screen when VICE saved the snapshot"
                    title={screen ? 'The screen when VICE saved the snapshot, drawn from its RAM and its VIC-II as VICE draws it\nClick to show the screen in Graphics' : 'The screen when VICE saved the snapshot, drawn from its RAM and its VIC-II as VICE draws it'}
                    onClick={screen ? go(screen) : undefined} />
                  <div className="ov-vic-facts">
                    <p className="ov-vic-mode">{vicModeText(st)}</p>
                    <p className="muted">{vicBankText(st)}{snapVic.model ? ` · VIC-II ${snapVic.model}` : ''}</p>
                    <dl className="ov-vic-parts">
                      {vicParts(st).map(p => {
                        const to = p.addr != null ? partLink(p.addr) : null;
                        return <Fragment key={p.what}><dt>{p.what}</dt><dd>{to ? <Link className="mono" title={`Go to $${h4(p.addr!)}`} onClick={go(to)}>{p.text}</Link> : <span className={p.addr != null ? 'mono' : undefined}>{p.text}</span>}</dd></Fragment>;
                      })}
                    </dl>
                    <p className="ov-vic-colours">{colours}</p>
                    <p className="muted">{vicRasterText(v, st)}</p>
                  </div>
                </div>
                <p className="muted small">The VIC-II as it stood when the snapshot was saved: a program that changes its registers during the frame (a raster split, sprites used again lower down) showed more than this.</p>
              </Card>);
          })()}

          {snap && <Card icon="chip" title="Snapshot PC" className="ov-pc">
            {snap.loaded
              ? <Link className="ov-big" title="Go to the PC in the listing (the .asm is there too)" onClick={go(() => links.addr(snap.pc))}>
                <span className="mono">{bankAdr(A, snap.pc)}</span>{nameNear(labels, snap.pc) && <span className="ov-label mono">{nameNear(labels, snap.pc)}</span>}</Link>
              : <span className="ov-big"><span className="mono">${h4(snap.pc)}</span></span>}
            <p className="muted">{snap.loaded ? 'Where the CPU was when VICE saved the snapshot: the listing and the .asm are there.'
              : `Where the CPU was when VICE saved the snapshot, in ${snap.where}: the listing is at the program start.`}</p>
            <p className="ov-basic mono" title="The registers when the snapshot was saved, as VICE's monitor shows them">{regsText(snap)}</p>
          </Card>}


          <Card icon="target" title="Program start">
            {start ? <>
              <Link className="ov-big" title="Go to the program start in the listing" onClick={go(() => links.addr(start.addr))}>
                <span className="mono">{bankAdr(A, start.addr)}</span>{name(start.addr) && <span className="ov-label mono">{name(start.addr)}</span>}</Link>
              <p className="muted">{start.from}</p>
              {start.basic && <p className="ov-basic mono" title="The BASIC line that starts the program">{start.basic}</p>}
            </> : <p className="muted">No program start: the analysis had nothing to trace from.</p>}
            {project.entries.length > 0 && <p className="muted">Also traced from {count(project.entries.length, 'entry point')} you set.</p>}
            <div className="ov-more"><Link onClick={go(() => links.section('start', start?.addr))}>Program start in the Explorer</Link></div>
          </Card>

          <Card icon="disk" title="Loaders" n={A.loaders.length || undefined}>
            {A.loaders.length ? A.loaders.slice(0, 3).map((l, k) => (
              <div key={`${l.id}-${k}`} className="ov-loader">
                <div className="ov-loader-name">{l.name}<span className="pill" title={l.sure === 'match' ? 'Found by its own code (or its name)' : 'Found by what loaders do (drive code, drive commands, a receive loop), not by its own code'}>{l.sure === 'match' ? 'its code' : 'by its traits'}</span></div>
                <p className="muted ov-how">{l.how}</p>
                <div className="ov-parts">{l.parts.filter(p => !p.outside).slice(0, 4).map((p, j) => (
                  <Link key={j} title={`${p.what}\nClick to go there in the listing`} onClick={go(() => links.addr(p.start))}><span className="mono">{bankAdr(A, p.start)}</span> {LOADER_ROLE[p.role]}</Link>))}</div>
              </div>))
              : <p className="muted">{packed.some(x => x.p.verdict === 'packed') ? 'None found: the program is packed, and its loader with it. Unpack it to find it.' : 'No fast, IRQ or tape loader found, and no KERNAL LOAD.'}</p>}
            {A.loaders.length > 3 && <p className="muted">and {A.loaders.length - 3} more</p>}
            <div className="ov-more">
              <Link onClick={go(() => links.section('loaders', A.loaders[0]?.parts.find(p => !p.outside)?.start))}>Loaders in the Explorer</Link>
              {scripts.map(([k, l]) => <Link key={k} onClick={go(() => links.bottom(k))}>{l}</Link>)}
            </div>
          </Card>

          <Card icon={probs.err ? 'err' : probs.warn ? 'warn' : 'ok'} title="Problems" n={probs.err + probs.warn + probs.hint || undefined}>
            {probs.err + probs.warn + probs.hint ? <div className="ov-rows">
              {([['err', 'err', 'error'], ['warn', 'warn', 'warning'], ['hint', 'hint', 'tip']] as const).filter(([k]) => probs[k]).map(([k, ic, one]) => (
                <button type="button" key={k} className={cx('ov-row ov-prob', `lvl-${k}`)} onClick={go(() => links.bottom('problems'))}>
                  <Icon name={ic} size={13} /><span>{count(probs[k], one)}</span></button>))}
            </div> : <p className="muted">None: the code reads without a problem.</p>}
            {A.deep ? <p className="muted">The deep analysis took {count(A.deep.rounds, 'round')}: {count(A.deep.before, 'problem')} before it, {A.deep.after} after.</p>
              : <p className="muted">The deep analysis is off: the Problems tab turns it on.</p>}
            <div className="ov-more">
              <Link onClick={go(() => links.bottom('problems'))}>Problems</Link>
              <Link onClick={go(() => links.bottom('log'))}>Analysis log ({A.log.length})</Link>
            </div>
          </Card>

          <Card icon="blocks" title="Blocks" n={`${count(A.blocks.length, 'block')} · ${fmtBytes(loaded)}`} wide>
            <div className="ov-types" role="group" aria-label="Blocks by type">
              {types.map(t => (
                <button type="button" key={t.kind} className="ov-row ov-type" title={`${t.label}: ${count(t.total, 'block')}, ${t.bytes} bytes\nClick to show them in the Blocks view and go to the first (${bankAdr(A, t.first.start)})`}
                  onClick={go(() => links.blocks(t.kind, t.first.start))}>
                  <i className="ov-dot" style={{ background: `var(--g-${t.group})` }} />
                  <span className="ov-type-name">{t.label}</span>
                  <span className="ov-type-n">{t.total}</span>
                  <span className="ov-type-b">{fmtBytes(t.bytes)}</span>
                  <span className="ov-share" aria-hidden><i style={{ width: `${Math.max(2, loaded ? t.bytes / loaded * 100 : 0)}%`, background: `var(--g-${t.group})` }} /></span>
                </button>))}
            </div>
          </Card>

          <Card icon="code" title="Code" n={codeBytes ? `${pct(codeBytes)} of the bytes` : undefined}>
            <dl className="ov-facts">
              <dt>Instructions</dt><dd>{A.stats.ins}</dd>
              <dt>Code</dt><dd>{fmtBytes(codeBytes)}</dd>
              <dt>Routines</dt><dd>{subs}</dd>
              <dt>Labels</dt><dd>{A.stats.labels}</dd>
              <dt>Cross-references</dt><dd>{A.stats.xrefs}</dd>
              {A.stats.illegal > 0 && <><dt>Undocumented opcodes</dt><dd><Link title="Go to the first one in the listing" onClick={go(() => links.addr(A.stats.illegalList[0]))}>{A.stats.illegal}</Link></dd></>}
              {A.smc.size > 0 && <><dt>Self-modifying stores</dt><dd>{A.smc.size}</dd></>}
              {handlers > 0 && <><dt>Interrupt handlers</dt><dd>{handlers}</dd></>}
              {A.delays.length > 0 && <><dt>Timing code</dt><dd>{A.delays.length}</dd></>}
            </dl>
            <div className="ov-more">
              {A.raster.length > 0 && <Link title={lines.length ? `At raster lines ${lines.join(', ')}` : undefined} onClick={go(() => links.bottom('irqs'))}>{count(A.raster.length, 'raster IRQ')}</Link>}
              {relocs > 0 && <Link onClick={go(() => links.bottom('relocs'))}>{A.relocs.length ? count(A.relocs.length, 'relocated block') : count(A.copies.length, 'copy loop')}</Link>}
              {drive && <Link onClick={go(() => links.tab('drive'))}>Drive code</Link>}
              <Link onClick={go(() => links.bottom('stats'))}>Statistics</Link>
            </div>
          </Card>

          {known.length > 0 && <Card icon="pencil" title="Known routines" n={known.length}>
            <div className="ov-rows">
              {known.slice(0, 5).map(m => (
                <button type="button" key={m.addr} className="ov-row ov-known" title={`The same routine as ${m.name}${m.from ? ` in ${m.from}` : ''}: $${h4(m.addr)}–$${h4(m.end - 1)}\nClick to go there in the listing`} onClick={go(() => links.addr(m.addr))}>
                  <i className="ov-dot" style={{ background: 'var(--g-code)' }} />
                  <span className="mono">{bankAdr(A, m.addr)}</span><span className="ov-known-name">{m.name}</span>
                  {m.from && <span className="muted ov-known-from">{m.from}</span>}
                </button>))}
              {known.length > 5 && <p className="muted">and {known.length - 5} more</p>}
            </div>
            <p className="muted">Named in other projects. Nothing is named here until you say so.</p>
            <div className="ov-more">
              {onNameKnown && <button type="button" className="btn small" title="Each gets the name it had in the other project (one step: Ctrl+Z takes it back)" onClick={onNameKnown}>{known.length === 1 ? 'Name it' : `Name all ${known.length}`}</button>}
            </div>
          </Card>}

          {crypt.length > 0 && <Card icon="prompt" title="Decryption loops" n={crypt.length}>
            <div className="ov-rows">
              {crypt.slice(0, 5).map(l => (
                <div key={l.start} className="ov-music-row ov-crypt-row">
                  <button type="button" className="ov-row" title={`${l.text}\n${cryptWhereText(l)}\nClick to go to the loop in the listing`} onClick={go(() => links.addr(l.start))}>
                    <i className="ov-dot" style={{ background: 'var(--g-code)' }} />
                    <span className="mono">{bankAdr(A, l.start)}</span><span className="mono ov-known-name">{cryptStepsText(l.steps)}</span>
                    <span className="muted ov-known-from">{l.length != null ? `${l.length} bytes` : 'by a pointer'}</span>
                  </button>
                  {onCryptScript && <button type="button" className="btn small ov-play" aria-label={`Script for the loop at $${h4(l.start)}`}
                    title={`A script that does what the loop does, from the template for it: ${l.length != null ? 'its source, length and key filled in' : 'its key filled in (the source and the length are for you to set)'}, the result in a scratchpad. The program stays as it is`}
                    onClick={go(() => onCryptScript(l))}><Icon name="plus" size={12} />Script</button>}
                </div>))}
              {crypt.length > 5 && <p className="muted">and {crypt.length - 5} more: right-click a loop in the listing</p>}
            </div>
            <p className="muted">Loops that change bytes with a key and store them: decryption, most likely. A script decrypts them into a scratchpad.</p>
          </Card>}

          {fitting.length > 0 && onAddFitting && <Card icon="prompt" title="Scripts that fit" n={fitting.length}>
            <div className="ov-rows">
              {fitting.slice(0, 5).map(s => (
                <div key={s.name} className="ov-music-row">
                  <span className="ov-row" title={`It needs ${(s.needs ?? []).join(', ')}, which this program has`}><i className="ov-dot" style={{ background: 'var(--g-code)' }} /><span className="mono ov-known-name">{s.name}</span><span className="muted ov-known-from">{(s.needs ?? []).join(', ')}</span></span>
                  <button type="button" className="btn small ov-play" aria-label={`Add the script ${s.name}`} title="Add a copy of the script from the library to this project" onClick={go(() => onAddFitting(s))}><Icon name="plus" size={12} />Add</button>
                </div>))}
            </div>
            <p className="muted">Scripts of the library whose routines this program has.</p>
          </Card>}

          <Card icon="image" title="Graphics" n={gfx.length ? count(gfx.reduce((n, t) => n + t.total, 0), 'block') : undefined}>
            {gfx.length ? <div className="ov-rows">
              {gfx.map(t => (
                <button type="button" key={t.kind} className="ov-row ov-type" title={`Show the first in Graphics (${bankAdr(A, t.first.start)}), drawn as ${t.label.toLowerCase()}`} onClick={go(() => links.tab('gfx', t.first))}>
                  <i className="ov-dot" style={{ background: `var(--g-${t.group})` }} />
                  <span className="ov-type-name">{t.label}</span><span className="ov-type-n">{t.total}</span><span className="mono ov-type-b">{bankAdr(A, t.first.start)}</span>
                </button>))}
            </div> : <p className="muted">{A.S.detectGfx ? 'No sprites, charsets, bitmaps or screens found.' : 'Detect graphics is off in Settings → Analysis.'}</p>}
            {(vic.length > 0 || A.vic.bitmap || A.vic.sprites.length > 0) && <p className="muted">
              {vic.length > 0 && `VIC bank ${vic.join(', ')}`}{A.vic.bitmap ? `${vic.length ? ' · ' : ''}bitmap mode` : ''}{A.vic.multicolor ? ' · multicolour' : ''}{A.vic.sprites.length ? ` · ${count(A.vic.sprites.length, 'sprite pointer')}` : ''}</p>}
            <div className="ov-more"><Link onClick={go(() => links.tab('gfx', firstGfx))}>Graphics</Link></div>
          </Card>

          <Card icon="music" title="Music" n={A.music.length || undefined}>
            {A.music.length ? <div className="ov-rows">
              {A.music.slice(0, 3).map(m => {
                const tune = name(m.start) ?? `music_${h4(m.start)}`;
                // it plays as its block does (the user may have marked its bytes as something else)
                const block = A.blocks.some(b => b.start === m.start && b.type === 'music');
                return (
                  <div key={m.start} className="ov-music-row">
                    <button type="button" className="ov-row ov-music" title={`${m.why.join('\n')}\nClick to go there in the listing`} onClick={go(() => links.addr(m.start))}>
                      <i className="ov-dot" style={{ background: 'var(--g-music)' }} />
                      <span className="mono">{bankAdr(A, m.start)}–${h4(m.end - 1)}</span>
                      <span className="muted mono">init ${h4(m.init)} · {m.digi && !m.play ? `samples, ${m.digi.nmi ? 'NMI' : 'IRQ'}` : `play $${h4(m.play)}`}</span>
                    </button>
                    {/* the overview stays open: the player opens a window of its own, and its message shows over this one */}
                    {onPlayMusic && block && <button type="button" className="btn small ov-play" aria-label={`Play ${tune} in ${musicPlayer === 'deepsid' ? 'DeepSID' : 'VICE'}`}
                      title={musicPlayTitle(tune, musicPlayer, m.digi, !m.play)} onClick={() => onPlayMusic(m.start)}><Icon name="play" size={12} />Play</button>}
                  </div>);
              })}
              {A.music.length > 3 && <p className="muted">and {A.music.length - 3} more</p>}
            </div> : <p className="muted">{A.S.detectMusic ? 'No SID music found.' : 'Detect SID music is off in Settings → Analysis.'}</p>}
            {A.music[0]?.digi ? <p className="muted">A sample player: its {A.music[0].digi.nmi ? 'NMI' : 'IRQ'} plays {A.music[0].digi.hz} samples a second{A.music[0].digi.parts.length ? `, from ${count(A.music[0].digi.parts.reduce((n, [s, e]) => n + e - s, 0), 'byte')} outside the block` : ''}.</p>
              : A.music[0]?.run && <p className="muted">Init and play ran: {count(A.music[0].run.notes, 'note')} in {+A.music[0].run.seconds.toFixed(1)} s.</p>}
          </Card>
        </div>
      </div>
      <div className="modal-foot">
        <label className="check ov-auto"><input type="checkbox" checked={auto} onChange={e => onAuto(e.target.checked)} />
          <span>Show this overview when a file is opened<small className="muted"> — also in Settings → General; the title bar's <Icon name="overview" size={11} /> button shows it again</small></span></label>
        <span className="grow" />
        <button type="button" className="btn" onClick={onClose}>Close</button>
      </div>
    </Modal>
  );
}
