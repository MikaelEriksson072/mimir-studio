/* The overview of the analysis (spec 14.1b): once the analysis of a file just opened is in, a window in the middle of
 * the app says what it found, part by part (the file and the block map, packing, the program start, the loaders, the
 * problems, the blocks by type, the code, graphics and music), with links to each part: the program start, a type of
 * block (its folder in the Blocks view), a loader's parts, the tabs Listing, the .asm source, Graphics and Memory. A
 * link, a click outside the window or Esc closes it; Settings → General (or the box at its foot) turns it off. */
import { Fragment, type ReactNode } from 'react';
import { h4, T, type Addr, type AnalysisResult, type Block, type BlockKind, type LoaderPart, type PackingInfo, type Project } from '@mimir/core';
import { Icon } from '../lib/icons';
import type { IconName } from '../lib/icon-paths';
import { blockMap, count, GFX_KIND, problemCounts, routinesOf, startOf, typeRows } from '../lib/overview';
import type { UiProblem } from '../lib/types';
import { bankAdr, cx, fmtBytes, GROUP_LABEL } from '../lib/util';
import type { BottomTab, EditorTab } from '../store/ui';
import { Modal } from './Modal';

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
  packing: readonly (PackingInfo | null)[]; problems: readonly UiProblem[];
  /** the .asm file the source tab shows first */
  source: string;
  unpackLabel: string;
  /** an unpack or a build is under way (Unpack waits) */
  busy: boolean;
  /** the bottom panel's script tabs that are there (Spindle, Booze …): the tab and its name */
  scripts: readonly [BottomTab, string][];
  /** the overview opens by itself after a load (Settings → General) */
  auto: boolean; onAuto: (on: boolean) => void;
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

export function AnalysisOverview({ A, project, labels, packing, problems, source, unpackLabel, busy, scripts, auto, onAuto, links, onClose }: OverviewProps) {
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
          <button type="button" className="btn small" title="The listing: the program disassembled as Kick Assembler code, block by block" onClick={go(() => links.tab('listing'))}><Icon name="list" size={13} />Listing</button>
          <button type="button" className="btn small" title="The Kick Assembler source the export writes" onClick={go(() => links.tab('source'))}><Icon name="code" size={13} />{source}</button>
          <button type="button" className="btn small" title={firstGfx ? `Graphics: memory as characters, sprites or bitmaps, at the first graphics block (${bankAdr(A, firstGfx.start)})` : 'Graphics: memory as characters, sprites or bitmaps'} onClick={go(() => links.tab('gfx', firstGfx))}><Icon name="image" size={13} />Graphics</button>
          <button type="button" className="btn small" title="Memory: the bytes as the VICE monitor shows them" onClick={go(() => links.tab('mem'))}><Icon name="chip" size={13} />Memory</button>
          {drive && <button type="button" className="btn small" title="The drive code: the code the program uploads to the 1541, where it runs there" onClick={go(() => links.tab('drive'))}><Icon name="disk" size={13} />Drive code</button>}
        </div>

        <div className="ov-grid">
          {packed.map(({ p, i }) => (
            <Card key={`pack-${i}`} icon="pack" title={p.verdict === 'packed' ? 'Packed' : 'Maybe packed'} wide className="ov-packed">
              <p><b>{A.files[i]?.name}</b> {p.verdict === 'packed' ? 'is packed' : 'may be packed'}{p.signature ? ` (${p.signature})` : ''}: {p.reasons.join('; ')}. What the analysis sees is the decruncher{p.decruncher != null ? ` at $${h4(p.decruncher)}` : ''} and the packed data, not the program.</p>
              <div className="ov-more">
                <button type="button" className="btn small primary" disabled={busy} onClick={go(() => links.unpack(i))}>{unpackLabel}</button>
                {p.decruncher != null && <Link onClick={go(() => links.addr(p.decruncher!))}>The decruncher</Link>}
              </div>
            </Card>))}

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
              {A.music.slice(0, 3).map(m => (
                <button type="button" key={m.start} className="ov-row ov-music" title={`${m.why.join('\n')}\nClick to go there in the listing`} onClick={go(() => links.addr(m.start))}>
                  <i className="ov-dot" style={{ background: 'var(--g-music)' }} />
                  <span className="mono">{bankAdr(A, m.start)}–${h4(m.end - 1)}</span>
                  <span className="muted mono">init ${h4(m.init)} · {m.digi && !m.play ? `samples, ${m.digi.nmi ? 'NMI' : 'IRQ'}` : `play $${h4(m.play)}`}</span>
                </button>))}
              {A.music.length > 3 && <p className="muted">and {A.music.length - 3} more</p>}
            </div> : <p className="muted">{A.S.detectMusic ? 'No SID music found.' : 'Detect SID music is off in Settings → Analysis.'}</p>}
            {A.music[0]?.digi ? <p className="muted">A sample player: its {A.music[0].digi.nmi ? 'NMI' : 'IRQ'} plays {A.music[0].digi.hz} samples a second{A.music[0].digi.parts.length ? `, from ${count(A.music[0].digi.parts.reduce((n, [s, e]) => n + e - s, 0), 'byte')} outside the block` : ''}.</p>
              : A.music[0]?.run && <p className="muted">Init and play ran: {count(A.music[0].run.notes, 'note')} in {+A.music[0].run.seconds.toFixed(1)} s.</p>}
          </Card>
        </div>
      </div>
      <div className="modal-foot">
        <label className="check ov-auto"><input type="checkbox" checked={auto} onChange={e => onAuto(e.target.checked)} />
          <span>Show this overview when a file is opened<small className="muted"> — also in Settings → General</small></span></label>
        <span className="grow" />
        <button type="button" className="btn" onClick={onClose}>Close</button>
      </div>
    </Modal>
  );
}
