/* =====================================================================
 * A cartridge's banks as address spaces (spec 13.9b). The banks share addresses (each is at $8000), so each one
 * is a 64 KB space of its own: analysed and rendered by the engine as it is, then merged into one result, where an
 * address in the space of index s is s * $10000 + its address (a bank address). Space s is the cartridge's s-th
 * bank (crtBanks order), so the keys stay where they are when banks are added to or taken from the project. Bank 0
 * is space 0 and its addresses are the plain ones: a project with one space is analysed exactly as before.
 * Files that are not chips (PRGs) are space 0's.
 *
 * As in SourceGen, an address resolves to the nearest place that has it: the bank the reference is in, else the
 * first bank that has it. Code another bank calls is traced there (`ProjectInput.calls`, rounds until nothing new),
 * and the source names it with that bank's label (`ProjectInput.foreign`, a `.label` line in the file head).
 * Addresses no bank has (the zero page, I/O, RAM) stay plain: their names are shared by every bank.
 * ===================================================================== */
import type {
  Addr, AnalysisResult, Block, Bookmark, FileInput, FileVerifyResult, Line, ListingLine, LogEntry, Note, Override, ProjectInput,
  RenderResult, SpaceInfo, Token, VerifyResult, XRef,
} from './types';
import { analyze as analyzeOne } from './analyze';
import { render as renderOne, type RenderOptions } from './render/kick';
import { verify as verifyOne } from './verify/verify';
import { crtBanks, parseCrt } from './c64/crt';

export const SPACE = 0x10000;
export const spaceOf = (a: Addr): number => Math.floor(a / SPACE);
/** the address inside its space */
export const spaceAddr = (a: Addr): Addr => a % SPACE;
export const bankAddr = (space: number, a: Addr): Addr => space * SPACE + (a & 0xffff);

/** Space and cartridge bank of each project file; null when they are all in space 0 (nothing to split). */
export function fileSpaces(project: { files: readonly FileInput[]; cart?: ProjectInput['cart'] }): { spaces: number[]; banks: number[] } | null {
  if (!project.cart || !project.files.some(f => f.chip != null)) return null;
  let banks: number[];
  let chipBank: (chip: number) => number | undefined;
  try {
    const crt = parseCrt(project.cart.crt, project.cart.name);
    banks = crtBanks(crt).map(b => b.bank);
    chipBank = c => crt.chips[c]?.bank;
  } catch { return null; }
  const spaces = project.files.map(f => { const b = f.chip != null ? chipBank(f.chip) : undefined; return b == null ? 0 : Math.max(0, banks.indexOf(b)); });
  return spaces.some(s => s !== 0) ? { spaces, banks } : null;
}

interface Split { space: number; bank: number; files: number[]; input: ProjectInput }

/** what a space has loaded, and the first space that has an address, from its files */
function loadedMaps(project: ProjectInput, parts: readonly Pick<Split, 'space' | 'files'>[]) {
  const has = parts.map(p => { const m = new Uint8Array(SPACE); for (const i of p.files) { const f = project.files[i]; m.fill(1, f.load, Math.min(SPACE, f.load + f.bytes.length)); } return m; });
  const first = (a: Addr): number => { for (let i = 0; i < has.length; i++) if (has[i][a]) return i; return -1; };
  return { has, first };
}

/**
 * The project for each space: its files, and the user's work in it (keys in the space, made plain). A key of space 0
 * whose address no file there has (a zero-page variable) is shared: every space gets it.
 */
export function splitProject(project: ProjectInput, layout: { spaces: number[]; banks: number[] }): Split[] {
  const used = [...new Set(layout.spaces)].sort((a, b) => a - b);
  const parts: Split[] = used.map(space => ({ space, bank: layout.banks[space] ?? space, files: layout.spaces.flatMap((s, i) => (s === space ? [i] : [])), input: null as unknown as ProjectInput }));
  const { has } = loadedMaps(project, parts);
  const at = new Map(parts.map((p, i) => [p.space, i]));
  const space0 = at.get(0);
  /** the parts a key goes to, and its address there */
  const route = (k: Addr): number[] => {
    const s = spaceOf(k), a = spaceAddr(k);
    if (s !== 0) { const i = at.get(s); return i == null ? [] : [i]; }
    return space0 != null && has[space0][a] ? [space0] : parts.map((_, i) => i);
  };
  const rec = <T>(r: Record<Addr, T> | undefined): Record<Addr, T>[] => {
    const out = parts.map(() => ({} as Record<Addr, T>));
    for (const [k, v] of Object.entries(r || {})) for (const i of route(+k)) out[i][spaceAddr(+k)] = v;
    return out;
  };
  const list = (xs: Addr[] | undefined): Addr[][] => { const out = parts.map((): Addr[] => []); for (const k of xs || []) for (const i of route(k)) out[i].push(spaceAddr(k)); return out; };
  const ranged = <T extends { start: Addr; end: Addr }>(xs: T[] | undefined): T[][] => {
    const out = parts.map((): T[] => []);
    for (const x of xs || []) for (const i of route(x.start)) out[i].push({ ...x, start: spaceAddr(x.start), end: x.end - x.start + spaceAddr(x.start) });
    return out;
  };
  const labels = rec(project.labels), comments = rec(project.comments), blockComments = rec(project.blockComments), notes = rec<Note>(project.notes);
  const bookmarks = rec<Bookmark>(project.bookmarks);
  const entries = list(project.entries), excluded = list(project.excluded), binary = list(project.binary);
  // a music block's init and play are in its bank too
  const overrides = ranged<Override>(project.overrides).map(os => os.map(o => (o.props?.init != null || o.props?.play != null
    ? { ...o, props: { ...o.props, ...(o.props.init != null ? { init: spaceAddr(o.props.init) } : {}), ...(o.props.play != null ? { play: spaceAddr(o.props.play) } : {}) } } : o)));
  const bankZones = ranged(project.bankZones);
  const patches = parts.map((): NonNullable<ProjectInput['patches']> => []);
  for (const p of project.patches || []) for (const i of route(p.start)) patches[i].push({ ...p, start: spaceAddr(p.start) });
  const ep = project.entryPoint;
  parts.forEach((p, i) => {
    p.input = {
      ...project, files: p.files.map(fi => project.files[fi]), labels: labels[i], comments: comments[i], blockComments: blockComments[i], notes: notes[i], bookmarks: bookmarks[i],
      entries: entries[i], excluded: excluded[i], binary: binary[i], overrides: overrides[i], bankZones: bankZones[i], patches: patches[i],
      entryPoint: ep != null && spaceOf(ep) === p.space ? spaceAddr(ep) : null,
      ...(p.space ? { bank: p.bank } : {}),
    };
  });
  return parts;
}

/* ---------- analysis ---------- */

/** At most this many rounds of tracing what one bank calls in another. */
const CALL_ROUNDS = 4;

/** The analyses of the spaces kept between runs (the analysis worker): a space whose input is the same is not
 *  analysed again, so an edit in one bank of a big cartridge analyses that bank only. */
export type SpaceCache = Map<number, { files: readonly FileInput[]; cart: unknown; key: string; calls: Addr[]; A: AnalysisResult }>;

/** what decides a space's analysis besides its files (the same objects while they do not change) */
const inputKey = (p: ProjectInput): string => JSON.stringify([p.overrides, p.entries, p.entryPoint, p.bankZones, p.settings, p.calls, p.bank]);

/** The analysis of a project, a space per bank of its cartridge, merged; one space: `analyze` as it is. */
export function analyze(project: ProjectInput, cache?: SpaceCache): AnalysisResult {
  const layout = fileSpaces(project);
  if (!layout) return analyzeOne(project);
  const parts = splitProject(project, layout);
  const { has, first } = loadedMaps(project, parts);
  const one = (i: number, input: ProjectInput): AnalysisResult => {
    const key = inputKey(input), c = cache?.get(parts[i].space);
    if (c && c.key === key && c.cart === input.cart && c.files.length === input.files.length && c.files.every((f, k) => f === input.files[k])) return c.A;
    const A = analyzeOne(input);
    cache?.set(parts[i].space, { files: input.files, cart: input.cart, key, calls: input.calls ?? [], A });
    return A;
  };
  // each space starts with the calls it had last time (an unchanged one is not analysed again); every round finds
  // what the others call in it now, and a space whose calls differ is analysed again with them
  let calls = parts.map(p => cache?.get(p.space)?.calls ?? []);
  let results = parts.map((p, i) => one(i, { ...p.input, ...(calls[i].length ? { calls: calls[i] } : {}) }));
  for (let round = 0; round < CALL_ROUNDS; round++) {
    const want = parts.map(() => new Set<Addr>());
    results.forEach((A, s) => {
      for (const [to, xs] of A.xrefs) {
        if (has[s][to] || !xs.some(x => x.kind === 'call' || x.kind === 'jump')) continue;
        const t = first(to);
        if (t >= 0 && t !== s) want[t].add(to);
      }
    });
    const next = want.map(w => [...w].sort((a, b) => a - b));
    const again = next.map((w, i) => w.length !== calls[i].length || w.some((a, k) => a !== calls[i][k]));
    calls = next;
    if (!again.some(Boolean)) break;
    results = results.map((A, i) => (again[i] ? one(i, { ...parts[i].input, ...(calls[i].length ? { calls: calls[i] } : {}) }) : A));
  }
  parts.forEach((p, i) => { p.input = { ...p.input, ...(calls[i].length ? { calls: calls[i] } : {}) }; });
  return mergeAnalyses(project, parts, results, has, first);
}

function mergeAnalyses(project: ProjectInput, parts: Split[], results: AnalysisResult[], has: Uint8Array[], first: (a: Addr) => number): AnalysisResult {
  const n = Math.max(...parts.map(p => p.space)) + 1, size = n * SPACE;
  const base0 = results[0];
  const mem = new Uint8Array(size), owner = new Int16Array(size).fill(-1), insLen = new Uint8Array(size), codeOwner = new Int32Array(size).fill(-1), tm = new Uint8Array(size);
  const port = new Uint8Array(size), vic = new Uint8Array(size), forcedPort = new Uint8Array(size), forcedVic = new Uint8Array(size);
  const out: AnalysisResult = {
    ...base0, files: project.files, mem, owner, insLen, codeOwner, tm, skip: new Set(), xrefs: new Map(), entryKind: new Map(), entry: null, basics: [], music: [],
    vic: { banks: new Set(), d018: new Set(), bitmap: false, multicolor: false, sprites: [] }, gfx: [], blocks: [], labels: new Map(), zp: new Map(), hints: new Map(),
    smc: new Map(), offsetOf: new Map(), lohiTabs: new Map(), ijumps: [], inlineCalls: new Set(), log: [], textPtrs: new Map(),
    stats: { ...base0.stats, mn: {}, modes: {}, illegal: 0, illegalList: [], ins: 0, bytesByType: {}, codeBytes: 0, total: 0, xrefs: 0, entries: 0, labels: 0, ms: 0 },
    mcfg: base0.mcfg ? { port, vic, changes: new Map(), forcedPort, forcedVic, cart: base0.mcfg.cart } : null,
    loaders: [], raster: [], delays: [], spindle: [], deep: null, spaces: [], parts: results,
  };
  const sum = (to: Record<string, number>, from: Record<string, number>) => { for (const [k, v] of Object.entries(from)) to[k] = (to[k] ?? 0) + v; };
  results.forEach((A, i) => {
    const p = parts[i], s = p.space, off = s * SPACE;
    /** an address of this space in the merged result: its own, else the first space's that has it, else plain */
    const g = (a: Addr): Addr => { const v = a & 0xffff; if (has[i][v]) return off + v; const t = first(v); return t < 0 ? a : parts[t].space * SPACE + v; };
    const at = (a: Addr): Addr => off + (a & 0xffff);
    const file = (fi: number) => (fi >= 0 ? p.files[fi] ?? fi : fi);
    const blockBase = out.blocks.length;
    mem.set(A.mem, off); insLen.set(A.insLen, off); tm.set(A.tm, off);
    for (let a = 0; a < SPACE; a++) { owner[off + a] = file(A.owner[a]); if (A.codeOwner[a] >= 0) codeOwner[off + a] = off + A.codeOwner[a]; }
    if (A.mcfg && out.mcfg) {
      port.set(A.mcfg.port, off); vic.set(A.mcfg.vic, off); forcedPort.set(A.mcfg.forcedPort, off); forcedVic.set(A.mcfg.forcedVic, off);
      for (const [k, c] of A.mcfg.changes) out.mcfg.changes.set(at(k), c);
    }
    for (const a of A.skip) out.skip.add(at(a));
    for (const [to, xs] of A.xrefs) { const k = g(to); out.xrefs.set(k, [...(out.xrefs.get(k) ?? []), ...xs.map((x): XRef => ({ ...x, from: at(x.from) }))]); }
    for (const [a, k] of A.entryKind) out.entryKind.set(at(a), k);
    out.basics.push(...A.basics.map(b => ({ ...b, start: at(b.start), end: at(b.end), sys: b.sys == null ? null : g(b.sys), lines: b.lines.map(l => ({ ...l, addr: at(l.addr) })), sysLine: b.sysLine && { ...b.sysLine, addr: at(b.sysLine.addr) }, ...(b.file != null ? { file: file(b.file) } : {}) })));
    out.music.push(...A.music.map(m => ({ ...m, start: at(m.start), end: at(m.end), init: g(m.init), play: g(m.play), file: file(m.file) })));
    for (const b of A.vic.banks) out.vic.banks.add(b);
    for (const d of A.vic.d018) out.vic.d018.add(d);
    out.vic.bitmap ||= A.vic.bitmap; out.vic.multicolor ||= A.vic.multicolor;
    out.vic.sprites.push(...A.vic.sprites.map(x => ({ ...x, addr: g(x.addr) })));
    out.gfx.push(...A.gfx.map(x => ({ ...x, start: at(x.start) })));
    out.blocks.push(...A.blocks.map((b): Block => ({
      ...b, id: blockBase + b.id, start: at(b.start), end: at(b.start) + (b.end - b.start), file: file(b.file),
      props: { ...b.props, ...(b.props.partner != null ? { partner: g(b.props.partner) } : {}), ...(b.props.init != null ? { init: g(b.props.init) } : {}), ...(b.props.play != null ? { play: g(b.props.play) } : {}) },
    })));
    for (const [a, l] of A.labels) { const k = g(a); if (!out.labels.has(k)) out.labels.set(k, l); }
    for (const [a, z] of A.zp) if (!out.zp.has(a)) out.zp.set(a, z);
    for (const [a, h] of A.hints) out.hints.set(at(a), { ...h, target: g(h.target) });
    for (const [a, t] of A.smc) out.smc.set(g(a), at(t));
    for (const [a, b] of A.offsetOf) out.offsetOf.set(g(a), g(b));
    for (const [a, t] of A.lohiTabs) out.lohiTabs.set(at(a), { ...t, lo: at(t.lo), hi: at(t.hi), partner: at(t.partner), dest: g(t.dest), targets: t.targets.map(g) });
    out.ijumps.push(...A.ijumps.map(j => ({ pc: at(j.pc), ptr: g(j.ptr) })));
    for (const a of A.inlineCalls) out.inlineCalls.add(at(a));
    out.log.push(...A.log.map((l): LogEntry => ({ ...l, addr: l.addr == null ? null : g(l.addr), ...(parts.length > 1 && s ? { msg: `Bank ${p.bank}: ${l.msg}` } : {}) })));
    for (const [a, e] of A.textPtrs) out.textPtrs.set(g(a), e);
    out.loaders.push(...A.loaders.map(f => ({ ...f, parts: f.parts.map(x => ({ ...x, start: at(x.start), end: at(x.start) + (x.end - x.start) })) })));
    out.raster.push(...A.raster.map(r => ({ ...r, handler: at(r.handler), setAt: r.setAt == null ? null : at(r.setAt), installedAt: r.installedAt == null ? null : at(r.installedAt), from: r.from == null ? null : at(r.from), d011: r.d011 && { ...r.d011, at: at(r.d011.at) } })));
    out.delays.push(...A.delays.map(d => ({ ...d, branch: at(d.branch), by: at(d.by), read: at(d.read), start: at(d.start), end: at(d.start) + (d.end - d.start), ins: d.ins.map(at) })));
    const opt = (a: Addr | null) => (a == null ? null : g(a));
    out.spindle.push(...A.spindle.map(d => ({ ...d, start: at(d.start), end: at(d.start) + (d.end - d.start), front: at(d.front), side: opt(d.side), prepare: opt(d.prepare), setup: opt(d.setup), irq: opt(d.irq), main: opt(d.main), fadeout: opt(d.fadeout), cleanup: opt(d.cleanup), prepareNext: opt(d.prepareNext), next: opt(d.next), music: opt(d.music) })));
    const st = A.stats;
    sum(out.stats.mn, st.mn); sum(out.stats.modes, st.modes); sum(out.stats.bytesByType as Record<string, number>, st.bytesByType as Record<string, number>);
    out.stats.illegal += st.illegal; out.stats.illegalList.push(...st.illegalList.map(at)); out.stats.ins += st.ins; out.stats.codeBytes += st.codeBytes; out.stats.total += st.total;
    out.stats.xrefs += st.xrefs; out.stats.entries += st.entries; out.stats.labels += st.labels; out.stats.ms += st.ms;
    if (A.deep) out.deep = out.deep ? { ...out.deep, rounds: Math.max(out.deep.rounds, A.deep.rounds), before: out.deep.before + A.deep.before, after: out.deep.after + A.deep.after, rejected: out.deep.rejected + A.deep.rejected, cuts: out.deep.cuts + A.deep.cuts, branches: out.deep.branches + A.deep.branches, ms: out.deep.ms + A.deep.ms } : { ...A.deep };
    const entry = A.entry == null ? null : at(A.entry);
    if (out.entry == null && entry != null && s === parts[0].space) out.entry = entry;
    out.spaces!.push({ space: s, bank: p.bank, files: p.files, cart: A.mcfg?.cart ?? 'none', entry });
  });
  return out;
}

/* ---------- render ---------- */

/** a name not taken by `taken`: the name, else with the bank after it */
const unique = (name: string, bank: number, taken: (n: string) => boolean): string => {
  if (!taken(name)) return name;
  for (let k = 0; ; k++) { const n = k ? `${name}_b${bank}_${k}` : `${name}_b${bank}`; if (!taken(n)) return n; }
};

/** The source of a merged analysis: each space rendered as it is, its addresses made bank addresses; one space: as it is. */
export function render(A: AnalysisResult, project: ProjectInput, opts: RenderOptions = {}): RenderResult {
  const layout = A.parts && A.spaces ? fileSpaces(project) : null;
  if (!A.parts || !A.spaces || !layout) return renderOne(A, project, opts);
  const parts = splitProject(project, layout);
  if (parts.length !== A.parts.length || parts.some((p, i) => p.space !== A.spaces![i].space)) return renderOne(A, project, opts);
  const { has, first } = loadedMaps(project, parts);
  const prefix = (p: Split) => (p.space ? `bank${String(p.bank).padStart(2, '0')}_` : '');
  const one = (i: number, foreign?: Record<Addr, string>) => renderOne(A.parts![i], { ...parts[i].input, ...(foreign ? { foreign } : {}) }, { ...opts, binPrefix: prefix(parts[i]) });
  let renders = parts.map((_, i) => one(i));
  // the labels of other banks a bank refers to, named as there (made unique in its file)
  renders = renders.map((R, i) => {
    const foreign: Record<Addr, string> = {}, taken = new Set([...R.labels.values()].map(l => l.name).concat([...R.zp.values()].map(z => z.name)));
    for (const to of A.parts![i].xrefs.keys()) {
      if (has[i][to]) continue;
      const t = first(to), name = t >= 0 ? renders[t].labels.get(to)?.name : undefined;
      if (!name) continue;
      foreign[to] = unique(name, parts[t].bank, n => taken.has(n));
      taken.add(foreign[to]);
    }
    return Object.keys(foreign).length ? one(i, foreign) : R;
  });
  return mergeRenders(project, parts, renders, A, has, first);
}

function mergeRenders(project: ProjectInput, parts: Split[], renders: RenderResult[], A: AnalysisResult, has: Uint8Array[], first: (a: Addr) => number): RenderResult {
  const out: RenderResult = { lines: [], files: {}, fileLines: {}, labels: new Map(), zp: new Map(), fileNames: project.files.map(() => ''), problems: [], usedHw: new Set(), excluded: [], parts: renders };
  let blockBase = 0;
  renders.forEach((R, i) => {
    const p = parts[i], off = p.space * SPACE;
    const g = (a: Addr): Addr => { const v = a & 0xffff; if (has[i][v]) return off + v; const t = first(v); return t < 0 ? a : parts[t].space * SPACE + v; };
    const tok = (t: Token): Token => (t.to != null && !(t.t === 'lbl' && t.zp) ? { ...t, to: g(t.to) } : t);
    const mapped = new Map<Line, Line>();
    const line = (l: Line): Line => {
      let m = mapped.get(l);
      if (!m) {
        m = { ...l, a: off + l.a } as Line;
        if ('tok' in m && m.tok) (m as { tok: Token[] }).tok = m.tok.map(tok);
        if (m.k === 'hdr') m.blk += blockBase;
        mapped.set(l, m);
      }
      return m;
    };
    // a file bar names the bank: every bank has the same addresses
    for (const l of R.lines) out.lines.push(l.k === 'file' ? { ...l, a: off + l.a, fi: p.files[l.fi] ?? l.fi, text: `${l.text} · bank ${p.bank}` } : line(l as Line));
    for (const [path, ls] of Object.entries(R.fileLines)) out.fileLines[path] = ls.map(line);
    Object.assign(out.files, R.files);
    for (const [a, l] of R.labels) { const k = g(a); if (!out.labels.has(k)) out.labels.set(k, l); }
    for (const [a, z] of R.zp) if (!out.zp.has(a)) out.zp.set(a, z);
    R.fileNames.forEach((n, fi) => { out.fileNames[p.files[fi]] = n; });
    out.problems.push(...R.problems.map(x => ({ ...x, addr: x.addr == null ? undefined : g(x.addr) })));
    for (const h of R.usedHw) out.usedHw.add(h);
    out.excluded.push(...R.excluded.map(x => ({ ...x, start: off + x.start, end: off + x.end, file: p.files[x.file] ?? x.file })));
    blockBase += A.parts![i].blocks.length;
  });
  return out;
}

/* ---------- verify ---------- */

/** The round trip of a merged analysis, space by space; the results in the order of the project files. */
export function verify(A: AnalysisResult, R: RenderResult): VerifyResult {
  if (!A.parts || !A.spaces || !R.parts || R.parts.length !== A.parts.length) return verifyOne(A, R);
  const results: FileVerifyResult[] = new Array(A.files.length);
  A.parts.forEach((P, i) => verifyOne(P, R.parts![i]).results.forEach((r, fi) => { results[A.spaces![i].files[fi]] = r; }));
  return { ok: results.every(r => r?.ok), results };
}

/* ---------- one space of a merged result ---------- */

/**
 * The analysis of one space as a 64 KB result (the Graphics and Memory tabs, the heatmap, patches): its own bytes and
 * findings at their plain addresses. Addresses of other spaces in it lose their bank; plain ones stay. Without spaces
 * (or for a result of one), the result itself.
 */
export function spaceView(A: AnalysisResult, space: number): AnalysisResult {
  const info = A.spaces?.find(x => x.space === space);
  if (!A.spaces || !info) return A;
  const off = space * SPACE, end = off + SPACE;
  const mine = (a: Addr) => a >= off && a < end;
  const l = (a: Addr): Addr => (a >= SPACE ? a & 0xffff : a);
  const mapKeys = <V>(m: Map<Addr, V>, f: (v: V) => V = v => v): Map<Addr, V> => { const r = new Map<Addr, V>(); for (const [k, v] of m) if (mine(k) || k < SPACE) r.set(l(k), f(v)); return r; };
  const codeOwner = new Int32Array(SPACE).fill(-1);
  for (let a = 0; a < SPACE; a++) { const c = A.codeOwner[off + a]; if (c >= 0) codeOwner[a] = l(c); }
  const part = A.parts?.[A.spaces.indexOf(info)];
  return {
    ...A, mem: A.mem.subarray(off, end), owner: A.owner.subarray(off, end), insLen: A.insLen.subarray(off, end), codeOwner, tm: A.tm.subarray(off, end),
    skip: new Set([...A.skip].filter(mine).map(l)), xrefs: mapKeys(A.xrefs, xs => xs.filter(x => mine(x.from)).map(x => ({ ...x, from: l(x.from) }))),
    entryKind: mapKeys(A.entryKind), entry: info.entry == null ? null : l(info.entry),
    basics: A.basics.filter(b => mine(b.start)).map(b => ({ ...b, start: l(b.start), end: l(b.end), sys: b.sys == null ? null : l(b.sys), lines: b.lines.map(x => ({ ...x, addr: l(x.addr) })), sysLine: b.sysLine && { ...b.sysLine, addr: l(b.sysLine.addr) } })),
    music: A.music.filter(m => mine(m.start)).map(m => ({ ...m, start: l(m.start), end: l(m.end), init: l(m.init), play: l(m.play) })),
    vic: part ? part.vic : { ...A.vic, sprites: A.vic.sprites.filter(x => mine(x.addr) || x.addr < SPACE).map(x => ({ ...x, addr: l(x.addr) })) },
    gfx: A.gfx.filter(x => mine(x.start)).map(x => ({ ...x, start: l(x.start) })),
    blocks: A.blocks.filter(b => mine(b.start)).map((b, id) => ({ ...b, id, start: l(b.start), end: l(b.start) + (b.end - b.start), props: { ...b.props, ...(b.props.partner != null ? { partner: l(b.props.partner) } : {}), ...(b.props.init != null ? { init: l(b.props.init) } : {}), ...(b.props.play != null ? { play: l(b.props.play) } : {}) } })),
    labels: mapKeys(A.labels), hints: mapKeys(A.hints, h => ({ ...h, target: l(h.target) })), smc: mapKeys(A.smc, l), offsetOf: mapKeys(A.offsetOf, l),
    lohiTabs: mapKeys(A.lohiTabs, t => ({ ...t, lo: l(t.lo), hi: l(t.hi), partner: l(t.partner), dest: l(t.dest), targets: t.targets.map(l) })),
    ijumps: A.ijumps.filter(j => mine(j.pc)).map(j => ({ pc: l(j.pc), ptr: l(j.ptr) })), inlineCalls: new Set([...A.inlineCalls].filter(mine).map(l)),
    log: A.log.filter(x => x.addr == null || mine(x.addr) || x.addr < SPACE).map(x => ({ ...x, addr: x.addr == null ? null : l(x.addr) })),
    textPtrs: mapKeys(A.textPtrs),
    mcfg: A.mcfg && { ...A.mcfg, port: A.mcfg.port.subarray(off, end), vic: A.mcfg.vic.subarray(off, end), forcedPort: A.mcfg.forcedPort.subarray(off, end), forcedVic: A.mcfg.forcedVic.subarray(off, end), changes: mapKeys(A.mcfg.changes), cart: info.cart },
    loaders: A.loaders.filter(f => f.parts.some(x => mine(x.start))).map(f => ({ ...f, parts: f.parts.filter(x => mine(x.start)).map(x => ({ ...x, start: l(x.start), end: l(x.start) + (x.end - x.start) })) })),
    raster: A.raster.filter(r => mine(r.handler)).map(r => ({ ...r, handler: l(r.handler), setAt: r.setAt == null ? null : l(r.setAt), installedAt: r.installedAt == null ? null : l(r.installedAt), from: r.from == null ? null : l(r.from), d011: r.d011 && { ...r.d011, at: l(r.d011.at) } })),
    delays: A.delays.filter(d => mine(d.branch)).map(d => ({ ...d, branch: l(d.branch), by: l(d.by), read: l(d.read), start: l(d.start), end: l(d.start) + (d.end - d.start), ins: d.ins.map(l) })),
    spindle: [], spaces: undefined, parts: undefined,
  };
}

/** The names of one space at their plain addresses (the shared ones too), for the views that show one space. */
export function spaceRender(R: RenderResult, A: Pick<AnalysisResult, 'spaces'>, space: number): RenderResult {
  if (!A.spaces) return R;
  const off = space * SPACE, labels = new Map<Addr, RenderResult['labels'] extends Map<Addr, infer V> ? V : never>();
  for (const [a, l] of R.labels) if (a < SPACE ? !labels.has(a) : spaceOf(a) === space) labels.set(a - (a >= SPACE ? off : 0), l);
  // a space's own label wins over a plain one at the same address
  for (const [a, l] of R.labels) if (a >= SPACE && spaceOf(a) === space) labels.set(a - off, l);
  return { ...R, labels };
}

/** The listing's lines of a space (with the file bars), for the views that show one space. */
export const spaceLines = (R: RenderResult, space: number): ListingLine[] => R.lines.filter(l => spaceOf(l.a) === space);

/** The project's files in each space, for callers that build their own inputs. */
export const spaceFiles = (project: Pick<ProjectInput, 'files' | 'cart'>): FileInput[][] => {
  const layout = fileSpaces(project);
  if (!layout) return [project.files];
  const out: FileInput[][] = [];
  layout.spaces.forEach((s, i) => { (out[s] ??= []).push(project.files[i]); });
  return out;
};
