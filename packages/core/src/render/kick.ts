/* =====================================================================
 * Rendering — one line model drives both the listing view and the
 * Kick Assembler export (single source of truth).
 * ===================================================================== */
import type {
  Addr, AnalysisResult, Block, BlockKind, DelaySled, ForcedMode, HeadPart, Line, ListingLine, MusicInfo, NumberFormat,
  ProjectInput, RenderLabel, RenderProblem, RenderResult, StructField, TextEncoding, Token, ZpVar, ExcludedRange, LoaderPart, ViewOffset } from '../types';
import { MAX_BLANKS } from '../types';
import { kindInfo, TYPE_BY_KEY } from '../model';
import { ENC, MODE_LEN, OPC } from '../cpu/opcodes';
import { decode } from '../cpu/decode';
import { SYM, hwSymbol, isIO } from '../c64/symbols';
import { petsciiControl, petsciiDefinitions, textEncoding, textTokens } from '../c64/text';
import { ALL_BANKS, ALL_PORTS, areaAt, bankRange, banked, banksOf, describePorts, portsOf, reaches, reachesForName } from '../c64/memconfig';
import { makePsid } from '../c64/psid';
import { basicLineComment } from '../c64/basic';
import { findBlock } from '../analyze/classify';
import { spindleCondition, spindleName, spindleScript } from '../analyze/spindle';
import { boozeScript } from '../analyze/booze';
import { h4 } from '../util/hex';
import { sourceStem } from '../util/names';
import { lineText } from './lines';
import { hardwareInclude } from './include';
import {
  ASSEMBLERS, asmMnemonic, assemblerOf, binaryTokens, blockComment, defineTokens, elseTokens, endifTokens, ifTokens, inBlockComment, includeTokens,
  labelFor, logicalEndTokens, logicalTokens, pcLine, pcTokens, writesOpcode } from './dialect';
import { applyZpPairs } from '../zp-pairs';
import { junkIn } from '../junk';
import { fieldSize, structSize, validStruct } from '../struct';
import { shiftText, shownAddress, shownLabelName, shownTarget, usableViewOffsets, viewOffsetAt } from '../viewoffsets';

const ID_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** the words Kick Assembler 5.25 does not take as a label (measured with KickAss.jar; in this case only, `TRUE` is one) */
const KEYWORDS = new Set(['true', 'false', 'null', 'var', 'const']);
/** A valid, non-mnemonic Kick Assembler identifier. */
export const validLabel = (name: string): boolean => ID_RE.test(name) && !ENC[name.toUpperCase()] && !KEYWORDS.has(name) && name.length <= 64;
/** The .var the source loads a music into with LoadSid (`music.init`): `music`, or `music_1000` when the program has
 *  more than one */
export const musicVarName = (m: Pick<MusicInfo, 'start'>, count: number): string => count > 1 ? `music_${h4(m.start)}` : 'music';

/** Per-file render state, also passed to operand formatting. */
interface RenderCtx {
  fileIdx?: number;
  usedMusic?: Set<MusicInfo>;
  prevType?: BlockKind | null;
  needSeg?: boolean;
  useLabel?: (a: Addr) => void;
  useForeign?: (a: Addr) => void;
  useZp?: (a: Addr) => void;
  useHw?: (a: Addr) => void;
  /** a PETSCII control code written by name in a text: the file head defines it */
  usePet?: (b: number) => void;
  /** an undocumented opcode written by its mnemonic: a 64tass source selects the CPU that has them (`.cpu "6502i"`) */
  useIll?: () => void;
  isCall?: boolean;
  zpWidth?: boolean;
  /** the instruction whose operand this is, and how it uses the address (bank tracking names by what it reaches) */
  pc?: Addr;
  write?: boolean;
  /** the byte whose operand or value this is (10.4: where a view offset shows it, which bytes are its own) */
  from?: Addr;
  /** how many relocated blocks' .pseudopc the block is inside (8.1b): it gets no .pc of its own there */
  reloc?: number;
}

interface DataRowOptions {
  row?: number;
  fmt?: NumberFormat;
  dir?: '.byte' | '.word' | '.text';
  item?: (i: Addr) => Token | Token[];
  cmt?: (p: Addr) => string;
  noLabels?: boolean;
}

export interface RenderOptions {
  /** listing only: every block that is not code is shown disassembled (a linear sweep from its start), to find
   *  code that was classified as data. The files, fileLines and verification do not change. */
  dataAsCode?: boolean;
  /** put before the names of the binary files (gfx/, music/, data/): a bank's own (spec 13.9b, `bank03_`) */
  binPrefix?: string;
  /** listing only (spec 10.4): the project's view offsets (Project.viewOffsets) show their bytes where they are shown,
   *  with the labels they have there, and references to that area go to them. The files, fileLines, problems and
   *  verification do not change. */
  viewOffsets?: boolean;
}

/** loader parts that span code or data: their end gets a mark too */
const LOADER_SPANS: Partial<Record<LoaderPart['role'], string>> = { resident: 'its part on the C64', drivecode: 'its drive code', install: 'its installer', tape: 'the tape loader' };

/** the longest a loader's description runs in the source's head before it goes on to the next line (text after `// `) */
const LOADER_TEXT_WIDTH = 110;

/**
 * A comment's text as lines of at most `width` characters, broken between words: the first indented by two spaces,
 * the rest by four, under it. A run of hex bytes (`55 AE 9B …`) and instructions joined by ` / ` stay on one line
 * when they fit on one; a word longer than a line stays whole.
 */
export function wrapComment(text: string, width: number): string[] {
  // the units a line may break between
  const units: string[] = [];
  const hexByte = /^[0-9A-F]{2}[,)]?$/;
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const prev = units[units.length - 1];
    const join = prev != null && units.length && (
      (hexByte.test(word) && /(^|\s|\()[0-9A-F]{2}$/.test(prev)) || word === '/' || prev.endsWith(' /')
      // an instruction's operand stays with it (lda $dd00)
      || (/^[#$(]/.test(word) && /(^|[\s(])[a-z]{3}$/.test(prev)));
    if (join && `${prev} ${word}`.length <= width - 4) units[units.length - 1] = `${prev} ${word}`;
    else units.push(word);
  }
  const lines: string[] = [];
  let line = '';
  for (const word of units) {
    const indent = lines.length ? '    ' : '  ';
    if (line && indent.length + line.length + 1 + word.length > width) { lines.push(indent + line); line = word; }
    else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push((lines.length ? '    ' : '  ') + line);
  return lines;
}

export function render(A: AnalysisResult, project: ProjectInput, opts: RenderOptions = {}): RenderResult {
  const plain = renderWith(A, project, opts, []);
  const offs = opts.viewOffsets ? usableViewOffsets(A, project.viewOffsets) : [];
  if (!offs.length) return plain;
  // 10.4: the listing (its lines and the names it shows) from a render with the view offsets, the rest without them
  const shown = renderWith(A, project, opts, offs);
  return { ...plain, lines: shown.lines, labels: shown.labels, fileLabels: plain.labels, viewOffsets: offs };
}

function renderWith(A: AnalysisResult, project: ProjectInput, opts: RenderOptions, offs: readonly ViewOffset[]): RenderResult {
  const S = A.S;
  const up = S.hexCase === 'upper';
  const hx = (v: number, w: number) => { const s = v.toString(16).padStart(w, '0'); return up ? s.toUpperCase() : s; };
  const n2 = (v: number) => '$' + hx(v & 0xff, 2), n4 = (v: number) => '$' + hx(v & 0xffff, 4);
  // the assembler the source is written for (spec 11.8): the lines are the same, how some are spelled is not
  const asm = assemblerOf(S), tass = asm === '64tass';
  const mnc = (mn: string) => asmMnemonic(mn, asm);
  const numT = (s: string, to?: Addr): Token => (to == null ? { t: 'num', s } : { t: 'num', s, to });
  const defT = (name: string, zpAt?: Addr): Token => (zpAt == null ? { t: 'def', s: name } : { t: 'def', s: name, zp: zpAt });
  const loaded = (a: number) => a >= 0 && a < 0x10000 && A.owner[a] >= 0;
  const { mem, insLen, codeOwner } = A;

  // final labels: auto + user (user wins)
  const labels = new Map<Addr, RenderLabel>();
  for (const [a, l] of A.labels) labels.set(a, { name: l.name, kind: l.kind, user: false });
  for (const [k, name] of Object.entries(project.labels || {})) { const a = +k; if (name) labels.set(a, { name, kind: (labels.get(a) || { kind: 'user' }).kind || 'user', user: true }); else labels.delete(a); }
  const zp = new Map<Addr, ZpVar>(A.zp);
  for (const [a, l] of labels) if (a < 0x100 && !loaded(a) && l.user) { zp.set(a, { name: l.name, user: true }); labels.delete(a); }
  // the pairs the user set: `name` and `name+1`, or two variables where the analysis made a pointer
  applyZpPairs(zp, project.zpPairs, a => !loaded(a));
  // a pointer's high byte is written `<name>+1`: it follows the name of its low byte when that is renamed
  for (const [a, z] of zp) if (z.off) { const base = zp.get(a - z.off); if (base && base.name !== z.name) zp.set(a, { ...z, name: base.name }); }
  // 10.4: where a view offset shows its bytes, the analysis's labels there are named by the address shown, and each
  // reference into the area shown gets a label on the byte it goes to (on its instruction's first byte); a name some
  // other byte has already gets the loaded address after it
  const offAt = (a: Addr) => (offs.length ? viewOffsetAt(offs, a) : undefined);
  const shownOf = (a: Addr) => (offs.length ? shownAddress(offs, a) : a);
  if (offs.length) {
    const taken = new Set([...labels].filter(([a]) => !offAt(a)).map(([, l]) => l.name));
    const free = (name: string, a: Addr) => (taken.has(name) ? `${name}_${h4(a)}` : name);
    for (const [a, l] of labels) if (!l.user && offAt(a)) labels.set(a, { ...l, name: free(shownLabelName(l.name, a, shownOf(a)), a) });
    for (const o of offs) for (let t = o.to; t < o.to + o.end - o.start; t++) {
      // (code loaded where the bytes are shown keeps its own references)
      const xs = A.xrefs.get(t)?.filter(x => !shownTarget([o], x.from));
      if (!xs?.length) continue;
      let r = o.start + t - o.to;
      const c = codeOwner[r];
      if (c >= o.start && c < r) r = c;
      if (labels.has(r)) continue;
      const kind = xs.some(x => x.kind === 'call') ? 'sub' : insLen[r] ? 'l' : xs.some(x => x.kind === 'write' || x.kind === 'rmw') ? 'var' : 'data';
      labels.set(r, { name: free(`${kind}_${h4(shownOf(r))}`, r), kind: 'shown', user: false });
    }
  }
  const labelAt = (a: Addr) => labels.get(a);
  // comment lines and blocks the user inserted above an address; data and text rows break there like at labels
  const notes = project.notes || {};
  const noteAt = (a: Addr) => !!notes[a]?.text;
  // empty lines the user inserted above an address: above its comment lines and labels, and data rows break there too
  const blanks = project.blanks || {};
  const blankAt = (a: Addr) => (blanks[a] ?? 0) > 0;
  const blankLines = (a: Addr, n = blanks[a] ?? 0, under = false): Line[] => Array.from({ length: Math.min(MAX_BLANKS, n) }, (): Line => ({ k: 'blank', a, user: true, ...(under ? { under } : {}) }));
  // the loaders the analysis found: a comment line where each part starts, and where a longer one ends
  const loaderStarts = new Map<Addr, string[]>(), loaderEnds = new Map<Addr, string[]>();
  const markAt = (m: Map<Addr, string[]>, a: Addr, text: string) => { if (loaded(a)) m.set(a, [...(m.get(a) ?? []), text]); };
  for (const f of A.loaders ?? []) for (const p of f.parts) {
    markAt(loaderStarts, p.start, `==== ${f.name}: ${p.what} ====`);
    if (LOADER_SPANS[p.role] && p.end - p.start > 8) markAt(loaderEnds, p.end, `==== end of ${f.name}: ${LOADER_SPANS[p.role]} ====`);
  }
  // timing code (5.4b): a comment line above each delay, which takes as long as the branch into it leaves
  const delayAt = new Map<Addr, DelaySled>(), delayBranch = new Map<Addr, DelaySled>();
  const timerName = (s: DelaySled) => `${hwSymbol(s.timer)?.text ?? n4(s.timer)} (${n4(s.timer)})`;
  for (const s of A.delays ?? []) {
    delayBranch.set(s.branch, s);
    for (const a of s.ins) delayAt.set(a, s);
    markAt(loaderStarts, s.start, `delay: the ${mnc(OPC[mem[s.branch]].mn)} at ${n4(s.branch)} goes 0-${s.most} bytes into it by ${timerName(s)}, so it takes ${s.cycles[1]} down to ${s.cycles[0]} cycles`);
  }
  // Spindle's effect drivers (5.4c): where each starts, with its line of the script, and where its doors are
  for (const d of A.spindle ?? []) {
    markAt(loaderStarts, d.start, `==== Spindle part ${d.part}: ${d.first ? 'the early setup and the first driver' : d.extend ? 'a driver that goes on with it' : 'its driver'} (script line "${spindleName(d)} ${spindleCondition(d.condition)}") ====`);
    if (d.side != null && d.side !== d.start) markAt(loaderStarts, d.side, `==== Spindle part ${d.part}: a seek or the next disk side comes in here ====`);
    if (d.front !== d.start) markAt(loaderStarts, d.front, `==== Spindle part ${d.part}: the part before jumps in here ====`);
  }
  // BoozeLoader's script (5.15b): where each stretch of code that calls the loader starts
  for (const r of A.booze?.runs ?? []) {
    const n = A.booze!.steps.filter(s => s.kind === 'load' && s.jsr >= r.start && s.jsr < r.end).length;
    markAt(loaderStarts, r.start, `==== BoozeLoader script: ${n} load${n === 1 ? '' : 's'} from here to ${n4(r.end - 1)}${r.traced ? '' : ' (not traced)'} ====`);
  }
  // the user's patches that are on (10.2): where each starts and where it ends
  // (a user script's changes, 10.3, are its patches: they say so)
  for (const p of (project.patches ?? []).filter(x => !x.off)) {
    const n = `${n4(p.start)}-${n4(p.start + p.bytes.length - 1)}, ${p.bytes.length} byte${p.bytes.length === 1 ? '' : 's'}`;
    markAt(loaderStarts, p.start, p.script ? `==== changed by the script "${p.name}": ${n} ====` : `==== patch "${p.name}": ${n} written over the original ====`);
    markAt(loaderEnds, p.start + p.bytes.length, p.script ? `==== end of the script "${p.name}"'s change ====` : `==== end of patch "${p.name}" ====`);
  }
  // the view offsets (10.4): where the bytes shown elsewhere start and end
  for (const o of offs) {
    const n = o.end - o.start;
    markAt(loaderStarts, o.start, `==== shown at ${n4(o.to)}-${n4(o.to + n - 1)} (offset ${shiftText(o)}), only here: the .asm has these ${n} byte${n === 1 ? '' : 's'} at ${n4(o.start)}-${n4(o.end - 1)} ====`);
    markAt(loaderEnds, o.end, `==== end of the bytes shown at ${n4(o.to)} ====`);
  }
  const marked = (a: Addr) => loaderStarts.has(a) || loaderEnds.has(a);
  /** data and text rows break at notes, empty lines and loader marks like at labels */
  const breakAt = (a: Addr) => noteAt(a) || blankAt(a) || marked(a);
  /** comment text on lines of its own: `//` (`;`) per line, or one block comment (`/*` … `*\/`, in 64tass `.comment` …
   *  `.endc`; a line inside that would end it early is changed so it does not) */
  const commentLines = (a: Addr, text: string, block = false, note = false): Line[] => {
    const ls = text.replace(/\r\n?/g, '\n').split('\n').map(x => x.trimEnd());
    const tag = note ? { note } : {};
    if (!block) return ls.map((x): Line => ({ k: 'cmt', a, text: x, ...tag }));
    const [open, close] = blockComment(asm);
    return [
      { k: 'cmt', a, text: open, raw: true, ...tag },
      ...ls.map((x): Line => ({ k: 'cmt', a, text: inBlockComment(asm, x), raw: true, ...tag })),
      { k: 'cmt', a, text: close, raw: true, ...tag },
    ];
  };
  /** the user's comment line or block above an address, with the empty lines under it */
  const noteLines = (a: Addr): Line[] => [...commentLines(a, notes[a].text, !!notes[a].block, true), ...blankLines(a, notes[a].below ?? 0, true)];
  const fileOf = (a: Addr) => A.owner[a];
  /** blocks the user saves to a file of their own: `data/<label>.bin`, loaded back with .import binary */
  const binaryStarts = new Set(project.binary || []);
  // music saved as a binary file is not loaded with LoadSid, so references to it cannot use music.init/play
  const musicFor = (a: Addr) => S.musicAsSid ? A.music.find(m => a >= m.start && a < m.end && !binaryStarts.has(findBlock(A.blocks, m.start)?.start ?? -1)) : null;
  const musicVar = (m: MusicInfo) => musicVarName(m, A.music.length);
  const musicPath = (m: MusicInfo) => `music/${opts.binPrefix ?? ''}music_${h4(m.start)}.sid`;
  /** 64tass has no LoadSid: a namespace reads the .sid as LoadSid does (its header is big-endian, the load address
   *  before the data little-endian), so `music.init`, `.play`, `.location` and `.size` are what Kick Assembler gives,
   *  and `music.data` the bytes */
  const tassMusic = (m: MusicInfo, a: Addr): Line[] => {
    const v = musicVar(m), path = musicPath(m);
    const def = (name: string, value: Token[], cmt?: string): Line => ({ k: 'dir', a, n: 0, tok: [{ t: 'def', s: name }, { t: 'p', s: `${' '.repeat(Math.max(1, 9 - name.length))}= ` }, ...value], ...(cmt ? { cmt } : {}) });
    const ex = (s: string): Token[] => [{ t: 'p', s }];
    return [
      { k: 'dir', a, n: 0, tok: [{ t: 'def', s: v }, { t: 'p', s: ' ' }, { t: 'dir', s: '.namespace' }], cmt: `${path}, read as Kick Assembler's LoadSid reads it` },
      def('sid', [{ t: 'kw', s: 'binary' }, { t: 'p', s: '(' }, { t: 'str', s: `"${path}"` }, { t: 'p', s: ')' }]),
      def('offset', ex(`sid[[7, 6]]`), 'where its data start'),
      def('location', ex(`sid[[offset, offset + 1]]`), 'the load address before them'),
      def('init', ex(`sid[[${n2(0x0b)}, ${n2(0x0a)}]]`)),
      def('play', ex(`sid[[${n2(0x0d)}, ${n2(0x0c)}]]`)),
      def('data', ex('sid[offset + 2:]')),
      def('size', [{ t: 'kw', s: 'len' }, { t: 'p', s: '(data)' }]),
      { k: 'dir', a, n: 0, tok: [{ t: 'dir', s: '.endnamespace' }] },
    ];
  };
  // the names other banks give addresses this one does not have (13.9b): its file head defines those it uses
  const foreign = project.foreign || {};
  const blocksSorted = A.blocks;
  // 8.1b: the relocated blocks. The blocks where one runs are written inside its .pseudopc, where its bytes are loaded
  const relocs = A.relocs ?? [];
  const runSize = (r: { start: Addr; end: Addr }) => r.end - r.start;
  const runOf = (a: Addr) => relocs.find(r => a >= r.to && a < r.to + runSize(r));
  /** where the bytes of `a` come in the source: those of a relocated block's copy where it is loaded, just after the
   *  loaded address (by a half, a quarter in a block relocated from another one's copy, …) */
  const lpos = (a: Addr, eps = 0.5): number => { const r = runOf(a); return r ? lpos(r.start + a - r.to, eps / 2) + eps : a; };
  /** `a` is where relocated block `r` runs, or in a block relocated from there */
  const runsIn = (a: Addr, r: (typeof relocs)[number]) => { for (let x = runOf(a); x; x = runOf(x.start)) if (x === r) return true; return false; };

  // duplicate label detection
  const byName = new Map<string, Addr>(); const dupes = new Set<string>();
  for (const [a, l] of labels) { if (byName.has(l.name) && byName.get(l.name) !== a) dupes.add(l.name); byName.set(l.name, a); }

  /** 10.4: a reference to `a`, where view offset `o` shows its byte `r`: that byte's label, or the label before it in the
   *  bytes shown (`label+n`), else the address */
  function shownTokens(o: ViewOffset, r: Addr, a: Addr, zpWidth = false): Token[] {
    const lb = labelAt(r);
    if (lb) return [{ t: 'lbl', s: lb.name, to: r }];
    let from = codeOwner[r] >= o.start && codeOwner[r] < r && labelAt(codeOwner[r]) ? codeOwner[r] : -1;
    for (let p = r - 1; from < 0 && p >= o.start && r - p < 256; p--) if (labelAt(p)) from = p;
    if (from >= 0) return [{ t: 'lbl', s: labelAt(from)!.name, to: from }, { t: 'p', s: '+' }, { t: 'num', s: String(r - from) }];
    return [{ t: 'num', s: a < 0x100 && zpWidth ? n2(a) : n4(a), to: r }];
  }

  function addrTokens(a: Addr, ctx: RenderCtx): Token[] {
    a &= 0xffff;
    if (offs.length) {
      // 10.4: the area a view offset shows its bytes at is theirs (bytes loaded there too keep their own references).
      // The bytes' references to themselves go with them, as their branches do (jmp $5026 in $5000-$5036 shown at
      // $2000 is jmp l_2026); for the others, where the bytes are loaded their labels (named where they are shown) do
      // not fit, so the address is written as it is
      const sh = shownTarget(offs, a);
      if (sh && !(ctx.from != null && shownTarget([sh.o], ctx.from))) return shownTokens(sh.o, sh.at, a, ctx.zpWidth);
      const o = offAt(a);
      if (o && ctx.from != null && offAt(ctx.from) === o) return shownTokens(o, a, shownOf(a), ctx.zpWidth);
      if (o) return [{ t: 'num', s: a < 0x100 && ctx.zpWidth ? n2(a) : n4(a), to: a }];
    }
    const m = musicFor(a);
    if (m) {
      const v = musicVar(m);
      ctx.usedMusic && ctx.usedMusic.add(m);
      if (a === m.init) return [{ t: 'kw', s: `${v}.init`, to: a }];
      if (a === m.play) return [{ t: 'kw', s: `${v}.play`, to: a }];
      return [{ t: 'kw', s: `${v}.location`, to: m.start }, { t: 'p', s: '+' }, { t: 'num', s: n4(a - m.start) }];
    }
    if (!loaded(a) && foreign[a]) { ctx.useForeign && ctx.useForeign(a); return [{ t: 'lbl', s: foreign[a], to: a }]; }
    // bank tracking: an instruction that always reaches I/O or ROM here gets the hardware/ROM name (or the bare
    // address), never the label of the RAM bytes below; one that always reaches RAM never gets a hardware name.
    // Where the configuration cannot be told, $d000-$dfff is I/O
    const seen = A.mcfg && ctx.pc != null ? reachesForName(a, A.mcfg.port[ctx.pc], !!ctx.write, A.mcfg.cart) : null;
    if (seen === 'hw') {
      const hs = hwSymbol(a);
      if (hs && (!ctx.isCall || hs.sym.call || hs.off)) {
        // "raw addresses": the address itself, with the symbol kept for the comment and the listing's tooltip
        if (S.hwInclude === 'none') return [{ t: 'num', s: n4(a), to: a, sym: hs.sym }];
        ctx.useHw && ctx.useHw(hs.sym.addr); return [{ t: 'hw', s: hs.text, to: a, sym: hs.sym }];
      }
      return [{ t: 'num', s: n4(a), to: loaded(a) ? a : undefined }];
    }
    // the CPU's NMI/reset/IRQ vectors: writing them sets the handler (in RAM when the KERNAL is banked out), so they
    // keep their names even when the program's own bytes cover $fffa-$ffff (a memory dump, say)
    if (a >= 0xfffa && !ctx.isCall) {
      const hs = hwSymbol(a);
      if (hs && hs.sym.cat === 'Vectors') {
        if (S.hwInclude === 'none') return [{ t: 'num', s: n4(a), to: a, sym: hs.sym }];
        ctx.useHw && ctx.useHw(hs.sym.addr); return [{ t: 'hw', s: hs.text, to: a, sym: hs.sym }];
      }
    }
    const lb = labelAt(a);
    if (lb && loaded(a)) { ctx.useLabel && ctx.useLabel(a); return [{ t: 'lbl', s: lb.name, to: a }]; }
    if (loaded(a)) {
      const base = A.offsetOf.get(a);
      if (base != null && labelAt(base)) { ctx.useLabel && ctx.useLabel(base); return [{ t: 'lbl', s: labelAt(base)!.name, to: base }, { t: 'p', s: '+' }, { t: 'num', s: '1' }]; }
      const s = codeOwner[a] >= 0 ? codeOwner[a] : -1;
      if (s >= 0 && labelAt(s)) { ctx.useLabel && ctx.useLabel(s); return [{ t: 'lbl', s: labelAt(s)!.name, to: s }, { t: 'p', s: '+' }, { t: 'num', s: String(a - s) }]; }
      const b = findBlock(A.blocks, a);
      // where a relocated block is loaded: from its start, however far (a label inside would be in its .pseudopc)
      if (b && b.type === 'reloc' && labelAt(b.start)) { ctx.useLabel && ctx.useLabel(b.start); return [{ t: 'lbl', s: labelAt(b.start)!.name, to: b.start }, { t: 'p', s: '+' }, { t: 'num', s: String(a - b.start) }]; }
      // in a bitmap from the label before it however far: the analysis makes none inside one (5.12)
      if (b) for (let p = a - 1; p >= b.start && (a - p < 256 || b.type === 'bitmap'); p--) {
        const l = labelAt(p);
        if (l) { ctx.useLabel && ctx.useLabel(p); return [{ t: 'lbl', s: l.name, to: p }, { t: 'p', s: '+' }, { t: 'num', s: String(a - p) }]; }
      }
    }
    if (!loaded(a) || (isIO(a) && !ctx.isCall)) {
      if (a < 0x100 && zp.has(a)) {
        const z = zp.get(a)!; ctx.useZp && ctx.useZp(z.off ? a - 1 : a);
        return z.off ? [{ t: 'lbl', s: z.name, to: a - 1, zp: true }, { t: 'p', s: '+' }, { t: 'num', s: '1' }] : [{ t: 'lbl', s: z.name, to: a, zp: true }];
      }
      const hs = hwSymbol(a);
      // the CPU vectors at $fffa-$ffff are RAM exactly when the KERNAL is banked out: they keep their names
      if (hs && (!ctx.isCall || hs.sym.call || hs.off) && (seen !== 'ram' || hs.sym.cat === 'Vectors')) {
        if (S.hwInclude === 'none') return [{ t: 'num', s: a < 0x100 && ctx.zpWidth ? n2(a) : n4(a), to: a, sym: hs.sym }];
        ctx.useHw && ctx.useHw(hs.sym.addr); return [{ t: 'hw', s: hs.text, to: a, sym: hs.sym }];
      }
    }
    return [{ t: 'num', s: a < 0x100 && ctx.zpWidth ? n2(a) : n4(a), to: loaded(a) ? a : undefined }];
  }

  function insLine(pc: Addr, ctx: RenderCtx, len?: number): Line {
    const o = OPC[mem[pc]];
    const n = len ?? insLen[pc];
    const bytes = [...mem.subarray(pc, pc + n)];
    if (A.skip.has(pc)) {
      return { k: 'dat', a: pc, n, mn: o.mn, ill: o.ill, dir: '.byte', tok: [{ t: 'num', s: n2(mem[pc]) }], cmt: `bit ${o.mode === 'abs' ? 'abs' : 'zp'}: skips the next ${o.len - 1}-byte instruction` };
    }
    if (o.mode === 'rel') {
      // the CPU wraps at $ffff/$0000, an assembler cannot express such a branch with a mnemonic
      const raw = pc + 2 + ((mem[(pc + 1) & 0xffff] ^ 0x80) - 0x80);
      if (raw < 0 || raw > 0xffff) return { k: 'dat', a: pc, n, mn: o.mn, ill: o.ill, dir: '.byte', tok: joinList(bytes.map(b => ({ t: 'num', s: n2(b) }))), cmt: `${mnc(o.mn)} ${n4(raw & 0xffff)} (branch wraps around the address space)` };
    }
    const d = decode(mem, pc);
    const opTok: Token[] = [];
    let ext: ForcedMode = '';
    const c: RenderCtx = Object.assign({}, ctx, { isCall: o.flow === 'jsr' || o.flow === 'jmp', zpWidth: MODE_LEN[o.mode] === 2, pc, from: pc, write: o.access === 'write' });
    switch (o.mode) {
      case 'imp': case 'acc': break;
      case 'imm': {
        const h = A.hints.get(pc);
        if (h) {
          // an address used as a value, not accessed by this instruction
          const tk = addrTokens(h.target, Object.assign({}, c, { pc: undefined }));
          if (tk[0].t === 'num') opTok.push({ t: 'p', s: '#' }, { t: 'num', s: n2(d.v!) });
          else { opTok.push({ t: 'p', s: '#' + (h.kind === 'lo' ? '<' : '>') }); if (tk.length > 1 || /[+-]/.test(tk[0].s)) opTok.push({ t: 'p', s: '(' }, ...tk, { t: 'p', s: ')' }); else opTok.push(...tk); }
        } else opTok.push({ t: 'p', s: '#' }, { t: 'num', s: n2(d.v!) });
        break;
      }
      case 'rel': {
        // 10.4: a branch inside the bytes a view offset shows elsewhere goes where they are shown
        const o = offAt(pc), t = d.target!;
        opTok.push(...(o && t >= o.start && t < o.end ? shownTokens(o, t, shownOf(t)) : addrTokens(t, c)));
        break;
      }
      case 'zp': case 'zpx': case 'zpy': case 'izx': case 'izy': {
        // a delay's operand only takes time: the number, no label
        const tk: Token[] = delayAt.has(pc) ? [{ t: 'num', s: n2(d.v!) }] : addrTokens(d.v!, c);
        // A program label may be defined later in the source, so Kick's first pass would pick the
        // 16-bit form: force zero page. KickAss 5.25 rejects `.zp` on `(zp),y` ("Cannot force zeropage
        // mode on an argument of type indirectZeropageY"); that mode has no 16-bit form and needs no suffix.
        if (tk[0].t === 'lbl' && !tk[0].zp && loaded(tk[0].to!) && o.mode !== 'izy') ext = '.zp';
        if (o.mode === 'izx') opTok.push({ t: 'p', s: '(' }, ...tk, { t: 'p', s: ',x)' });
        else if (o.mode === 'izy') opTok.push({ t: 'p', s: '(' }, ...tk, { t: 'p', s: '),y' });
        else opTok.push(...tk, ...(o.mode === 'zpx' ? [{ t: 'p', s: ',x' } as Token] : o.mode === 'zpy' ? [{ t: 'p', s: ',y' } as Token] : []));
        break;
      }
      case 'abs': case 'abx': case 'aby': case 'ind': {
        if (o.flow === 'jmp' && d.target === pc) { opTok.push({ t: 'p', s: '*' }); break; }
        const tk: Token[] = delayAt.has(pc) ? [{ t: 'num', s: n4(d.v!) }] : addrTokens(d.v!, Object.assign({}, c, { zpWidth: false }));
        if (d.v! < 0x100 && o.mode !== 'ind') { ext = '.abs'; if (tk[0].t === 'num') tk[0].s = n4(d.v!); }
        if (o.mode === 'ind') opTok.push({ t: 'p', s: '(' }, ...tk, { t: 'p', s: ')' });
        else opTok.push(...tk, ...(o.mode === 'abx' ? [{ t: 'p', s: ',x' } as Token] : o.mode === 'aby' ? [{ t: 'p', s: ',y' } as Token] : []));
        break;
      }
    }
    if (!writesOpcode(o, asm)) {
      const shown = opTok.map(t => t.s).join('');
      return { k: 'dat', a: pc, n, mn: o.mn, ill: true, dir: '.byte', tok: joinList(bytes.map(b => ({ t: 'num', s: n2(b) }))), cmt: `${mnc(o.mn)}${shown ? ' ' + shown : ''} (undocumented${o.unstable ? ', unstable' : ''})` };
    }
    if (o.ill) ctx.useIll?.();
    const cm: string[] = [];
    // (by the instruction's address in the listing: where a view offset shows it, 10.4)
    if (A.smc.has(pc)) cm.push(`self-modified by ${n4(shownOf(A.smc.get(pc)!))}`);
    const into = delayBranch.get(pc);
    if (into) cm.push(`0-${into.most} bytes into the delay, by ${timerName(into)}`);
    if (delayAt.has(pc)) cm.push('delay');
    if (o.flow === 'jmpi') { const t = [...A.lohiTabs.values()].find(t => t.dest === d.v && t.code); cm.push(t ? `jump table: ${t.len} targets` : 'indirect jump'); }
    if (A.inlineCalls.has(pc)) {
      // a routine that prints the string after the JSR (5.5b): the text block after it says so
      const t = findBlock(A.blocks, (pc + 3) & 0xffff);
      cm.push(t?.type === 'text' && t.reason.endsWith(` from $${h4(pc)}`) ? 'prints the string after it' : 'inline data follows');
    }
    // the register's description, also when the operand is written as the raw address
    if (S.hwComments) { const hsTok = opTok.find(t => (t.t === 'hw' || t.t === 'num') && t.sym); if (hsTok && hsTok.sym && hsTok.sym.desc) cm.push(hsTok.sym.desc); }
    if (S.hwComments && A.mcfg) {
      // what this instruction sets, and accesses whose target depends on a configuration that varies here
      const ch = A.mcfg.changes.get(pc);
      if (ch && ch.port != null) cm.push(ch.port === ALL_PORTS ? 'sets $01 to a value the analysis cannot follow' : `memory ${describePorts(ch.port, A.mcfg.cart)}`);
      else if (ch && ch.vic != null && ch.vic !== ALL_BANKS) cm.push(`VIC bank ${banksOf(ch.vic).map(b => `${b} (${bankRange(b)})`).join(' or ')}`);
      const m = A.mcfg.port[pc], at = d.v;
      const cart = A.mcfg.cart;
      if (at != null && o.mode !== 'imm' && o.mode !== 'rel' && banked(at, cart) && m && m !== ALL_PORTS && reaches(at, m, o.access === 'write', cart) === null) {
        const names: Record<string, string> = { ram: 'RAM', io: 'I/O', basic: 'BASIC ROM', kernal: 'KERNAL ROM', char: 'character ROM', cart: 'cartridge ROM' };
        const seen = [...new Set(portsOf(m).map(cf => names[areaAt(at, cf, o.access === 'write', cart)]))];
        if (seen.length > 1) cm.push(`${seen.join(' or ')}: $01 is ${describePorts(m)} here`);
      }
    }
    if (o.ill) cm.push(o.unstable ? 'undocumented opcode, unstable' : 'undocumented opcode');
    return { k: 'ins', a: pc, n, mn: o.mn, ill: o.ill, ext, tok: opTok, cmt: cm.join('; '), ...(delayAt.has(pc) ? { delay: true } : {}) };
  }

  function joinList(items: (Token | Token[])[]): Token[] { const out: (Token | Token[])[] = []; items.forEach((it, i) => { if (i) out.push({ t: 'p', s: ', ' }); out.push(it); }); return out.flat(); }
  const numTok = (v: number, fmt?: NumberFormat): Token => ({ t: 'num', s: fmt === 'bin' ? '%' + v.toString(2).padStart(8, '0') : fmt === 'dec' ? String(v) : n2(v) });

  function dataRows(out: Line[], s: Addr, e: Addr, _ctx: RenderCtx, opt: DataRowOptions = {}) {
    const row = opt.row || S.bytesPerRow, fmt = opt.fmt || 'hex';
    let p = s;
    while (p < e) {
      if (p !== s && labelAt(p) && !opt.noLabels) out.push({ k: 'lbl', a: p, name: labelAt(p)!.name });
      let q = p + 1;
      while (q < e && q - p < row && !(labelAt(q) && !opt.noLabels) && !breakAt(q)) q++;
      const items: (Token | Token[])[] = [];
      for (let i = p; i < q; i++) items.push(opt.item ? opt.item(i) : numTok(mem[i], fmt));
      out.push({ k: 'dat', a: p, n: q - p, dir: opt.dir || '.byte', tok: joinList(items), cmt: opt.cmt ? opt.cmt(p) : '' });
      p = q;
    }
  }

  function textRows(out: Line[], s: Addr, e: Addr, enc: TextEncoding, ctx: RenderCtx, opt: { noEnc?: boolean; cmt?: string } = {}) {
    const te = textEncoding(enc), pet = enc === 'petscii' || enc === 'petscii-mixed';
    // the characters of the assembler's table (64tass's with -a: the unshifted letters as a-z)
    const char = tass ? te.tass.char : te.char;
    // a screen code $00 is '@' inside a text; at its end it stays `.byte $00 // end` (a terminator). In a PETSCII text
    // the control codes are in the `.text` line by name (`PET_CLR + "HELLO"`, in 64tass `PET_CLR, "hello"`)
    const ok = (a: Addr) => (char(mem[a]) != null && (mem[a] !== 0 || (a + 1 < e && mem[a + 1] !== 0 && char(mem[a + 1]) != null))) || (pet && !!petsciiControl(mem[a]));
    if (!opt.noEnc) out.push({ k: 'dir', a: s, n: 0, tok: [{ t: 'dir', s: tass ? '.enc' : '.encoding' }, { t: 'p', s: ' ' }, { t: 'str', s: `"${tass ? te.tass.enc : te.kick}"` }] });
    // (a struct's text field: the field's name is the comment of its first line)
    let first = opt.cmt ?? '';
    const own = (c: string) => { const t = [first, c].filter(Boolean).join('; '); first = ''; return t; };
    let p = s;
    while (p < e) {
      if (p !== s && labelAt(p)) out.push({ k: 'lbl', a: p, name: labelAt(p)!.name });
      if (ok(p)) {
        let q = p; while (q < e && ok(q) && q - p < 48 && !(q !== p && (labelAt(q) || breakAt(q)))) q++;
        out.push({ k: 'dat', a: p, n: q - p, dir: '.text', tok: textTokens(mem.subarray(p, q), char, pet, ctx.usePet, tass ? ', ' : ' + '), cmt: own('') });
        p = q;
      } else {
        let q = p; while (q < e && !ok(q) && q - p < S.bytesPerRow && !(q !== p && (labelAt(q) || breakAt(q)))) q++;
        // the control codes with a name are in the .text lines: of the rest, a $00 ends the string
        const c = pet ? [...mem.subarray(p, q)].filter(b => b === 0).map(() => 'end').join(', ') : (mem[p] === 0 && q - p === 1 ? 'end' : '');
        out.push({ k: 'dat', a: p, n: q - p, dir: '.byte', tok: joinList([...mem.subarray(p, q)].map(b => numTok(b))), cmt: own(c) });
        p = q;
      }
    }
  }

  /** a struct block (struct.ts): its records one after the other, a line a field (more where a label or a comment
   *  line of the user's is inside it), the field's name as the line's comment and the record's number before the
   *  first; bytes after the last whole record are plain bytes. A word a label points into is written as bytes. */
  function structRows(out: Line[], b: Block, fields: readonly StructField[], ctx: RenderCtx) {
    const size = structSize(fields), count = size ? Math.floor((b.end - b.start) / size) : 0;
    const lbl = (a: Addr) => { const l = labelAt(a); if (l && a !== b.start) out.push({ k: 'lbl', a, name: l.name }); };
    let enc: TextEncoding | null = null, p = b.start;
    for (let r = 0; r < count; r++) {
      fields.forEach((f, fi) => {
        const q = p + fieldSize(f), s = p, name = `${fi === 0 && count > 1 ? `[${r}] ` : ''}${f.name}`;
        const cmt = (a: Addr) => (a === s ? name : '');
        lbl(s);
        if (f.type === 'text') {
          const e = f.enc ?? 'petscii';
          if (enc !== e) { const te = textEncoding(e); out.push({ k: 'dir', a: s, n: 0, tok: [{ t: 'dir', s: tass ? '.enc' : '.encoding' }, { t: 'p', s: ' ' }, { t: 'str', s: `"${tass ? te.tass.enc : te.kick}"` }] }); enc = e; }
          textRows(out, s, q, e, ctx, { noEnc: true, cmt: name });
        } else if (f.type === 'byte') dataRows(out, s, q, ctx, { fmt: f.fmt, row: Math.min(f.count ?? 1, 40), cmt });
        else {
          let odd = false; for (let a = s + 1; a < q; a += 2) if (labelAt(a)) odd = true;
          if (odd) dataRows(out, s, q, ctx, { cmt });
          else {
            const word = (a: Addr): Token[] => {
              const v = mem[a] | (mem[a + 1] << 8);
              if (f.type === 'word') return [{ t: 'num', s: f.fmt === 'bin' ? '%' + v.toString(2).padStart(16, '0') : f.fmt === 'dec' ? String(v) : n4(v) }];
              const tk = addrTokens(v, Object.assign({}, ctx, { zpWidth: false, from: a }));
              return tk.length === 1 && tk[0].t === 'num' ? [Object.assign({}, tk[0], { s: n4(v) })] : tk;
            };
            let a = s;
            while (a < q) {
              if (a !== s) lbl(a);
              const items: Token[][] = [];
              let z = a;
              while (z < q && items.length < 8 && !(z !== a && (labelAt(z) || breakAt(z)))) { items.push(word(z)); z += 2; }
              out.push({ k: 'dat', a, n: z - a, dir: '.word', tok: joinList(items), cmt: cmt(a) });
              a = z;
            }
          }
        }
        p = q;
      });
    }
    if (p < b.end) { lbl(p); const s = p; dataRows(out, p, b.end, ctx, { cmt: a => (a === s ? (count ? 'after the last whole record' : 'less than a record') : '') }); }
  }

  const binFiles: Record<string, Uint8Array> = {};
  // not bin/: that is the output folder of many C64 setups, and the Sublime Text Kick Assembler package empties it
  // before every build ("kickass_empty_bin_folder_before_build")
  /** the .label lines of binary blocks: a label the analysis made but the source never uses (an I/O register the
   *  code reaches as VIC_..., say) is dropped once the whole file is written */
  const binaryDefs = new WeakSet<Line>();
  /** the lines inside blocks that define a label as an address (`.label name = $xxxx`, in 64tass `name = $xxxx`): a
   *  block left out of the build keeps them in its #else branch */
  const labelDefs = new WeakSet<Line>();
  const defLine = (a: Addr, name: string, value: Addr): Line => { const l: Line = { k: 'dir', a, n: 0, tok: defineTokens(asm, defT(name), [numT(n4(value))]) }; labelDefs.add(l); return l; };
  const binaryPath = (b: Block) => { const l = labelAt(b.start); return `data/${opts.binPrefix ?? ''}${l ? l.name : `block_${h4(b.start)}`}.bin`; };
  const blockTitle = (b: Block) => {
    const info = kindInfo(b.type), p = b.props;
    let t = info.label;
    if (b.type === 'text') t += ` (${textEncoding(p.enc).label})`;
    if (b.type === 'table') t = p.sub === 'sine' ? 'Curve table' : p.sub === 'colors' ? 'Color table' : 'Table';
    if (b.type === 'lohi') t = `${p.ptr ? 'Pointer' : 'Value'} table (${p.part} bytes)`;
    if (b.type === 'data' && p.var) t = 'Variables';
    // a struct (its record's size) and a custom block (a script's blocks.define): its type's name before what it is
    if (b.type === 'data' && p.struct?.length) return `Struct${p.custom ? ` ${p.custom}` : ''} (${structSize(p.struct)} byte${structSize(p.struct) === 1 ? '' : 's'} a record)`;
    if (p.custom) t = `${p.custom} (${t})`;
    return t;
  };
  /** 10.4: the part of a block a view offset shows elsewhere, for its header */
  const shownIn = (b: Block): string => {
    const o = offs.find(x => x.start < b.end && b.start < x.end);
    if (!o) return '';
    const s = Math.max(b.start, o.start), e = Math.min(b.end, o.end);
    return ` · shown at ${n4(shownOf(s))}-${n4(shownOf(e - 1))}`;
  };
  const SEG_NAME: Partial<Record<BlockKind, string>> = { code: 'Code', sprite: 'Sprites', charset: 'Charset', bitmap: 'Bitmap', screen: 'Screen', data: 'Data', reloc: 'Relocated' };

  function renderBlock(out: Line[], b: Block, ctx: RenderCtx & { usedMusic: Set<MusicInfo> }) {
    const lb = labelAt(b.start);
    const len = b.end - b.start;
    const title = blockTitle(b);
    const userCmt = (project.blockComments || {})[b.start];
    const binary = binaryStarts.has(b.start) ? binaryPath(b) : null;
    const reloc = b.type === 'reloc' ? relocs.find(x => x.start === b.start) : undefined;
    const runs = reloc ? ` · runs at ${n4(reloc.to)}-${n4(reloc.to + len - 1)}` : '';
    out.push({ k: 'hdr', a: b.start, blk: b.id, type: TYPE_BY_KEY[b.type], text: `${title}${lb ? ' · ' + lb.name : ''} · ${n4(b.start)}-${n4(b.end - 1)} (${len} byte${len === 1 ? '' : 's'})${runs}${shownIn(b)}${binary ? ` · ${binary}` : ''}`, ...(binary ? { binary } : {}) });
    // (marked as the block's comment: DEL with the pointer on it in the listing removes it)
    if (userCmt) out.push(...commentLines(b.start, userCmt).map((l): Line => ({ ...l, blockCmt: true } as Line)));
    // inside a relocated block's .pseudopc the bytes follow one another: a .pc there would move where they are loaded
    // (in a view offset, 10.4, the listing has the .pc where the bytes are shown)
    const seg = (name: string) => { if (!ctx.reloc) out.push(pcLine(asm, b.start, [numT(n4(shownOf(b.start)))], name)); };
    if (ctx.needSeg || (['sprite', 'charset', 'bitmap', 'screen'] as BlockKind[]).includes(b.type) || (b.type === 'code' && ctx.prevType !== 'code') || (b.type !== 'code' && ctx.prevType === 'code')) {
      if (binary || (b.type !== 'basic' && !(b.type === 'music' && S.musicAsSid))) seg(SEG_NAME[b.type] || (b.type === 'code' ? 'Code' : 'Data'));
    }
    ctx.needSeg = false;
    const label = (a: Addr) => { const l = labelAt(a); if (l) out.push({ k: 'lbl', a, name: l.name }); };
    if (binary) {
      // the bytes go to their own file; labels inside the block stay defined for the code that uses them
      label(b.start);
      binFiles[binary] = mem.slice(b.start, b.end);
      out.push({ k: 'dir', a: b.start, n: len, tok: binaryTokens(asm, binary), cmt: `${len} bytes · ${title}${runs}` });
      const define = (p: Addr) => {
        const l = labelAt(p);
        if (!l) return;
        const def = defLine(p, l.name, shownOf(p));
        binaryDefs.add(def); // kept only if the file refers to the label (see the file loop)
        out.push(def);
      };
      for (let p = b.start + 1; p < b.end; p++) define(p);
      // a relocated block's labels are where it runs
      if (reloc) [...labels.keys()].filter(a => runsIn(a, reloc)).sort((x, y) => x - y).forEach(define);
      ctx.prevType = b.type;
      return;
    }
    // A label the block layout cannot write (inside a word, a sprite row or the BasicUpstart2 stub)
    // would be referenced but never defined: such blocks fall back to plain .byte rows.
    const hiddenLabel = (from: Addr, to: Addr, every = 0) => { for (let p = from; p < to; p++) if (labelAt(p) && !(every && (p - b.start) % every === 0)) return true; return false; };
    switch (b.type) {
      case 'basic': {
        const bs = A.basics.find(x => x.start === b.start);
        if (bs && bs.upstart && S.basicUpstart && b.end === bs.end && !hiddenLabel(b.start, b.end)) {
          const tk: Token[] = bs.sys != null ? addrTokens(bs.sys, ctx) : [{ t: 'num', s: '0' }];
          const text = bs.lines.map(l => basicLineComment(l, n4)).join(' : ');
          if (tass) {
            // 64tass has no BasicUpstart2: the line it writes, as 64tass's manual writes it (the link to the end
            // marker `+`, line 10, SYS and the start's digits)
            const kw = (s: string): Token => ({ t: 'dir', s });
            out.push(pcLine(asm, b.start, [numT(n4(b.start))], 'Basic'));
            out.push({ k: 'dir', a: b.start, n: 4, tok: [kw('.word'), { t: 'p', s: ' (+), 10' }], cmt: text });
            out.push({ k: 'dir', a: b.start + 4, n: b.end - b.start - 6, tok: [kw('.null'), { t: 'p', s: ' ' }, numT(n2(0x9e)), { t: 'p', s: ', ' }, { t: 'kw', s: 'format' }, { t: 'p', s: '(' }, { t: 'str', s: '"%d"' }, { t: 'p', s: ', ' }, ...tk, { t: 'p', s: ')' }] });
            out.push({ k: 'dir', a: b.end - 2, n: 0, tok: [{ t: 'def', s: '+' }] });
            out.push({ k: 'dir', a: b.end - 2, n: 2, tok: [kw('.word'), { t: 'p', s: ' ' }, numT('0')], cmt: 'the end of the BASIC program' });
          } else out.push({ k: 'dir', a: b.start, n: b.end - b.start, tok: [{ t: 'kw', s: 'BasicUpstart2' }, { t: 'p', s: '(' }, ...tk, { t: 'p', s: ')' }], cmt: text });
          ctx.needSeg = true;
        } else {
          seg('Basic');
          label(b.start);
          dataRows(out, b.start, b.end, ctx, { cmt: p => { const l = bs && bs.lines.find(x => x.addr === p); return l ? basicLineComment(l, n4) : ''; }, row: S.bytesPerRow });
        }
        break;
      }
      case 'code': {
        let p = b.start;
        while (p < b.end) {
          if (insLen[p]) { label(p); out.push(insLine(p, ctx)); p += insLen[p]; }
          else { label(p); out.push({ k: 'dat', a: p, n: 1, dir: '.byte', tok: [{ t: 'num', s: n2(mem[p]) }], cmt: 'orphan byte' }); p++; }
        }
        break;
      }
      case 'music': {
        const m: MusicInfo = A.music.find(x => x.start === b.start) || { start: b.start, end: b.end, init: b.start, play: b.start + 3, sidRegs: 0, score: 0, why: [], file: b.file };
        if (S.musicAsSid) {
          const v = musicVar(m);
          const path = musicPath(m);
          binFiles[path] = makePsid(mem.slice(m.start, m.end), m.start, m.init, m.play, `${project.name || 'music'} ${h4(m.start)}`);
          ctx.usedMusic.add(m);
          // in a relocated block's .pseudopc the music goes where the bytes before it end
          if (!ctx.reloc) out.push(pcLine(asm, b.start, [{ t: 'kw', s: `${v}.location`, to: m.start }], 'Music'));
          // 64tass: the bytes the head's namespace read from the .sid (its `data`, after the load address)
          const fill: Token[] = tass ? [{ t: 'dir', s: '.text' }, { t: 'p', s: ' ' }, { t: 'kw', s: `${v}.data` }]
            : [{ t: 'dir', s: '.fill' }, { t: 'p', s: ' ' }, { t: 'kw', s: `${v}.size` }, { t: 'p', s: ', ' }, { t: 'kw', s: `${v}.getData(i)` }];
          out.push({ k: 'dir', a: b.start, n: b.end - b.start, tok: fill, cmt: `${path}: init ${n4(m.init)}, play ${n4(m.play)}` });
          ctx.needSeg = true;
        } else {
          seg('Music'); label(b.start);
          dataRows(out, b.start, b.end, ctx, {});
        }
        break;
      }
      case 'text': label(b.start); textRows(out, b.start, b.end, b.props.enc || 'petscii', ctx); break;
      case 'lohi': {
        label(b.start);
        const lt = A.lohiTabs.get(b.start);
        if (lt && lt.ptr) {
          dataRows(out, b.start, b.end, ctx, {
            item: i => {
              const v = mem[lt.lo + (i - b.start)] | (mem[lt.hi + (i - b.start)] << 8);
              const tk = addrTokens(v, Object.assign({}, ctx, { from: i }));
              if (tk[0].t === 'num') return numTok(mem[i]);
              return tk.length > 1 || /[+-]/.test(tk[0].s) ? [{ t: 'p', s: (lt.part === 'lo' ? '<' : '>') + '(' }, ...tk, { t: 'p', s: ')' }] : [{ t: 'p', s: lt.part === 'lo' ? '<' : '>' }, ...tk];
            }, row: 4,
          });
        } else dataRows(out, b.start, b.end, ctx, {});
        break;
      }
      case 'words': {
        label(b.start);
        if (hiddenLabel(b.start + 1, b.start + ((b.end - b.start) & ~1), 2)) { dataRows(out, b.start, b.end, ctx, {}); break; }
        // without a number format the words are addresses (labels where they point into the program), one a row
        const fmt = b.props.fmt, row = b.props.row || 1;
        const word = (q: Addr): Token[] => {
          const v = mem[q] | (mem[q + 1] << 8);
          if (fmt) return [{ t: 'num', s: fmt === 'bin' ? '%' + v.toString(2).padStart(16, '0') : fmt === 'dec' ? String(v) : n4(v) }];
          // a bare number is widened to 4 digits; offsets in `label+n` must stay as they are
          const tk = addrTokens(v, Object.assign({}, ctx, { zpWidth: false, from: q }));
          return tk.length === 1 && tk[0].t === 'num' ? [Object.assign({}, tk[0], { s: n4(v) })] : tk;
        };
        let p = b.start;
        while (p + 1 < b.end) {
          if (p !== b.start) label(p);
          const items: Token[][] = [];
          let q = p;
          while (q + 1 < b.end && items.length < row && !(q !== p && (labelAt(q) || breakAt(q)))) { items.push(word(q)); q += 2; }
          out.push({ k: 'dat', a: p, n: q - p, dir: '.word', tok: joinList(items), cmt: '' });
          p = q;
        }
        // an odd trailing byte (or a 1-byte block, whose label was already written above)
        if (p < b.end) { if (p !== b.start) label(p); dataRows(out, p, b.end, ctx, {}); }
        break;
      }
      case 'fill': {
        label(b.start);
        let mixed = false; for (let p = b.start + 1; p < b.end; p++) if (labelAt(p) || mem[p] !== mem[b.start]) { mixed = true; break; }
        if (mixed) { dataRows(out, b.start, b.end, ctx, {}); break; }
        out.push({ k: 'dir', a: b.start, n: len, tok: [{ t: 'dir', s: '.fill' }, { t: 'p', s: ' ' }, { t: 'num', s: String(len) }, { t: 'p', s: ', ' }, { t: 'num', s: n2(mem[b.start]) }] });
        break;
      }
      case 'sprite': {
        if (hiddenLabel(b.start + 1, b.start + (b.end - b.start) - ((b.end - b.start) % 64), 64)) { label(b.start); dataRows(out, b.start, b.end, ctx, {}); break; }
        let p = b.start;
        while (p + 64 <= b.end) {
          label(p);
          const sp = A.vic.sprites.find(x => x.addr === p);
          out.push({ k: 'cmt', a: p, text: `sprite ${n4(p)}${sp ? ` · pointer ${n2(sp.ptr)} (sprite ${sp.n})` : ''} · 24×21` });
          for (let r = 0; r < 21; r++) out.push({ k: 'dat', a: p + r * 3, n: 3, dir: '.byte', tok: joinList([0, 1, 2].map(i => numTok(mem[p + r * 3 + i], 'bin'))), cmt: '' });
          out.push({ k: 'dat', a: p + 63, n: 1, dir: '.byte', tok: [numTok(mem[p + 63])], cmt: 'padding / sprite mode byte' });
          p += 64;
        }
        if (p < b.end) { label(p); dataRows(out, p, b.end, ctx, {}); }
        break;
      }
      case 'charset': case 'bitmap': case 'screen': {
        label(b.start);
        const hasInner = (() => { for (let p = b.start + 1; p < b.end; p++) if (labelAt(p)) return true; return false; })();
        if (S.gfxBinary && b.type !== 'screen' && !hasInner) {
          const path = `gfx/${opts.binPrefix ?? ''}${b.type}_${h4(b.start)}.bin`;
          binFiles[path] = mem.slice(b.start, b.end);
          out.push({ k: 'dir', a: b.start, n: len, tok: binaryTokens(asm, path), cmt: `${len} bytes` });
        } else if (b.type === 'charset') {
          dataRows(out, b.start, b.end, ctx, { row: 8, cmt: p => ((p - b.start) % 8 === 0 ? `char ${n2((p - b.start) >> 3)}` : '') });
        } else dataRows(out, b.start, b.end, ctx, { row: b.type === 'screen' ? 40 : 8 });
        break;
      }
      case 'reloc': {
        // 8.1b: where its bytes are loaded, the blocks where they run, inside .pseudopc. Kick Assembler cannot nest
        // .pseudopc: a block relocated from where another one runs pauses that one's (`}`, then .pseudopc again where
        // it goes on), and its label, an address where the other one runs, is a .label
        const name = lb ? lb.name : n4(b.start);
        if (!ctx.reloc) label(b.start);
        else if (lb) out.push(defLine(b.start, lb.name, b.start));
        if (!reloc) { dataRows(out, b.start, b.end, ctx, {}); break; }
        const end = reloc.to + len;
        // (64tass could nest its .logical, but the same pause and resume keep both sources alike)
        const pseudopc = (a: Addr, n: number, cmt: string): Line => ({ k: 'dir', a: n ? b.start : a, n, reloc: n ? 'open' : 'resume', tok: logicalTokens(asm, numT(n4(a), a)), cmt });
        out.push(pseudopc(reloc.to, len, `the ${len} byte${len === 1 ? '' : 's'} run at ${n4(reloc.to)}-${n4(end - 1)}`));
        const inner: RenderCtx & { usedMusic: Set<MusicInfo> } = { ...ctx, reloc: (ctx.reloc ?? 0) + 1, prevType: null, needSeg: false };
        let open = true;
        for (const c of blocksSorted) {
          if (c.start < reloc.to || c.start >= end) continue;
          const again = c.type === 'reloc' && relocs.some(x => x.start === c.start);
          if (again && open) { out.push({ k: 'dir', a: c.start, n: 0, reloc: 'pause', tok: logicalEndTokens(asm), cmt: `${name} goes on after ${labelAt(c.start)?.name ?? n4(c.start)}` }); open = false; }
          if (!again && !open) { out.push(pseudopc(c.start, 0, `${name} goes on`)); open = true; }
          renderBlock(out, c, inner); out.push({ k: 'blank', a: c.end });
        }
        const ends = `end of ${name}, which runs at ${n4(reloc.to)}`;
        out.push(open ? { k: 'dir', a: b.start, n: 0, reloc: 'close', tok: logicalEndTokens(asm), cmt: ends } : { k: 'cmt', a: b.start, text: ends, reloc: 'close' });
        break;
      }
      default: {
        label(b.start);
        const p = b.props || {};
        // (fields a project file holds that are no fields: plain bytes)
        const st = b.type === 'data' && p.struct?.length ? validStruct(p.struct) : null;
        if (st) { structRows(out, b, st, ctx); break; }
        dataRows(out, b.start, b.end, ctx, { fmt: p.fmt, row: p.row });
      }
    }
    ctx.prevType = b.type;
  }

  // ---- "data as code" (listing only) ----
  /** a block's bytes swept as instructions from its start; a byte that ends no instruction inside the block is .byte */
  function previewLines(b: Block): Line[] {
    const out: Line[] = [];
    const ctx: RenderCtx = {}; // no use* callbacks: the preview must not change what the files import
    let p = b.start;
    while (p < b.end) {
      const o = OPC[mem[p]], ins = !o.jam && p + o.len <= b.end;
      // the empty lines and comment lines on any byte of the instruction go above it (the sweep may not start one there)
      for (let q = p; q < p + (ins ? o.len : 1); q++) {
        if (blankAt(q)) out.push(...blankLines(q));
        if (noteAt(q)) out.push(...noteLines(q));
      }
      const lb = labelAt(p);
      if (lb) out.push({ k: 'lbl', a: p, name: lb.name });
      if (ins) { out.push({ ...insLine(p, ctx, o.len), preview: true } as Line); p += o.len; }
      else { out.push({ k: 'dat', a: p, n: 1, dir: '.byte', tok: [numTok(mem[p])], cmt: o.jam ? `${mnc(o.mn)} (halts the CPU)` : '', preview: true }); p++; }
    }
    return out;
  }
  /** a file's lines with every non-code block replaced by its preview; headers, block comments and .pc stay.
   *  Fill blocks (one byte repeated) stay as they are: as code they would only be a column of the same instruction. */
  function asCode(src: Line[]): Line[] {
    const out: Line[] = [];
    for (let i = 0; i < src.length; i++) {
      const l = src[i];
      const b = l.k === 'hdr' ? A.blocks[l.blk] : null;
      // a relocated block is shown where its bytes run, as what they are there
      if (!b || b.type === 'code' || b.type === 'fill' || b.type === 'reloc') { out.push(l); continue; }
      out.push({ ...l, preview: true } as Line);
      let j = i + 1, body = false;
      // the block ends at the next header or the blank line after it (the user's empty lines are in it: the preview has them)
      for (; j < src.length && src[j].k !== 'hdr' && !(src[j].k === 'blank' && !(src[j] as { user?: boolean }).user); j++) {
        const x = src[j];
        if (x.k === 'lbl' || x.k === 'ins' || x.k === 'dat' || (x.k === 'cmt' && x.note) || (x.k === 'dir' && x.n > 0)) body = true;
        else if (!body && (x.k === 'cmt' || (x.k === 'dir' && x.tok[0]?.s === '.pc'))) out.push(x);
      }
      out.push(...previewLines(b));
      i = j - 1;
    }
    return out;
  }

  // ---- per file ----
  const outFiles: Record<string, string | Uint8Array> = {};
  const fileLines: Record<string, Line[]> = {};
  const listing: ListingLine[] = [];
  const fileNames = A.files.map((f, i) => sourceStem(f.name, i));
  const used = new Set<string>();
  fileNames.forEach((n, i) => { let m = n, k = 2; while (used.has(m)) m = `${n}_${k++}`; used.add(m); fileNames[i] = m; });
  const allUsedHw = new Set<Addr>();
  const problems: RenderProblem[] = [];
  const excludedStarts = new Set(project.excluded || []);
  const excludedAll: ExcludedRange[] = [];
  for (const name of dupes) problems.push({ lvl: 'err', msg: `Label "${name}" is defined more than once`, addr: byName.get(name) });
  // a name Kick Assembler takes that 64tass does not (`_loop`: local to the label before it there; `len`, `true`)
  if (tass) {
    const bad = (name: string) => validLabel(name) && !labelFor(asm, name, validLabel);
    for (const [a, l] of labels) if (bad(l.name)) problems.push({ lvl: 'err', msg: `Label "${l.name}" cannot be a label of the whole source in 64tass${l.name.startsWith('_') ? ' (a name starting with _ is local to the label before it there)' : ''}: rename it`, addr: a });
    for (const [a, z] of zp) if (!z.off && bad(z.name)) problems.push({ lvl: 'err', msg: `Zero-page variable "${z.name}" cannot be a label of the whole source in 64tass: rename it`, addr: a });
  }

  A.files.forEach((f, fi) => {
    const body: Line[] = [];
    const usedZp = new Set<Addr>(), usedExt = new Set<Addr>(), usedHw = new Set<Addr>(), usedHere = new Set<Addr>(), usedForeign = new Set<Addr>(), usedPet = new Set<number>();
    let usedIll = false;
    const ctx: RenderCtx & { usedMusic: Set<MusicInfo> } = {
      fileIdx: fi, usedMusic: new Set(), prevType: null, needSeg: true,
      useLabel: a => { if (fileOf(a) !== fi) usedExt.add(a); else usedHere.add(a); },
      useZp: a => usedZp.add(a), useHw: a => usedHw.add(a), useForeign: a => usedForeign.add(a), usePet: b => usedPet.add(b),
      useIll: () => { usedIll = true; },
    };
    // the blocks where a relocated block runs are written inside it (8.1b)
    const fb = blocksSorted.filter(b => b.file === fi && !runOf(b.start));
    const fileExcluded: ExcludedRange[] = [];
    let prevEnd: Addr | null = null;
    for (const b of fb) {
      // after bytes that are not in the source (junk, 11.7) the next block starts where it is
      if (prevEnd != null && b.start !== prevEnd) ctx.needSeg = true;
      prevEnd = b.end;
      if (!excludedStarts.has(b.start)) { renderBlock(body, b, ctx); body.push({ k: 'blank', a: b.end }); continue; }
      // left out of the build: the block stays in the source under #if, and its labels stay defined for the code using them
      const lb = labelAt(b.start), name = `INCLUDE_${lb ? lb.name : h4(b.start)}`;
      const inner: Line[] = [];
      renderBlock(inner, b, ctx);
      const hdr = inner.shift()!;
      body.push({ ...hdr, text: `${(hdr as { text: string }).text} · excluded from the build`, excluded: true } as Line);
      body.push({ k: 'dir', a: b.start, n: 0, tok: ifTokens(asm, name) });
      body.push(...inner);
      const lbls = inner.filter((l): l is Extract<Line, { k: 'lbl' }> => l.k === 'lbl');
      // a binary block defines the labels inside it with .label: those are needed in the #else branch too
      const defs = inner.filter(l => labelDefs.has(l));
      if (lbls.length || defs.length) {
        body.push({ k: 'dir', a: b.start, n: 0, tok: elseTokens(asm) });
        for (const l of lbls) body.push(defLine(l.a, l.name, shownOf(l.a)));
        body.push(...defs);
      }
      body.push({ k: 'dir', a: b.end, n: 0, tok: endifTokens(asm) }, { k: 'blank', a: b.end });
      ctx.needSeg = true; // the next block cannot continue from these bytes
      fileExcluded.push({ start: b.start, end: b.end, file: fi, name });
    }
    excludedAll.push(...fileExcluded);
    // junk (11.7): not in the source at all, nor in the output (verify does not compare it)
    const fileEnd = Math.min(0x10000, f.load + f.bytes.length);
    const fileJunk = junkIn(project.junk, f.load, fileEnd);
    excludedAll.push(...fileJunk.map(j => ({ start: j.start, end: j.end, file: fi, name: '', junk: true })));
    // labels inside binary blocks stay defined only where this file refers to them (other files define their own)
    if (binaryStarts.size) body.splice(0, body.length, ...body.filter(l => !binaryDefs.has(l) || usedHere.has(l.a)));
    // notes go above the line holding their address, and above its labels; a loader part's marks above them, and the
    // user's empty lines above all. The lines come in the order of the bytes as loaded (`lpos`: a relocated block's
    // lines where its bytes are loaded)
    const noteAddrs = [...new Set([...Object.keys(notes).map(Number).filter(noteAt), ...Object.keys(blanks).map(Number).filter(blankAt), ...loaderStarts.keys(), ...loaderEnds.keys()])].filter(a => loaded(a) && fileOf(a) === fi).sort((x, y) => lpos(x) - lpos(y));
    if (noteAddrs.length) {
      const withNotes: Line[] = [];
      let k = 0;
      const put = (a: Addr) => {
        if (blankAt(a)) withNotes.push(...blankLines(a));
        for (const text of [...(loaderEnds.get(a) ?? []), ...(loaderStarts.get(a) ?? [])]) withNotes.push({ k: 'cmt', a, text, mark: true });
        if (noteAt(a)) withNotes.push(...noteLines(a));
      };
      for (const l of body) {
        // a .pseudopc line holds the block's loaded bytes, but the lines inside it show them
        const last = l.k === 'lbl' || (l.k === 'dir' && l.reloc === 'open') ? lpos(l.a) : 'n' in l && l.n > 0 ? lpos(l.a + l.n - 1) : -1;
        while (k < noteAddrs.length && lpos(noteAddrs[k]) <= last) put(noteAddrs[k++]);
        withNotes.push(l);
      }
      while (k < noteAddrs.length) put(noteAddrs[k++]);
      body.splice(0, body.length, ...withNotes);
    }
    usedHw.forEach(a => allUsedHw.add(a));
    const head: Line[] = [];
    /** what the head's lines since `from` are (all banks in one source define some once, 13.9c) */
    const part = (from: number, what: HeadPart) => { for (let i = from; i < head.length; i++) (head[i] as { head?: HeadPart }).head = what; };
    let at = 0;
    // what the output loads: junk at either end is not in it
    let from = f.load, end = fileEnd;
    for (const j of fileJunk) if (j.start <= from && j.end > from) from = j.end;
    for (const j of [...fileJunk].reverse()) if (j.end >= end && j.start < end) end = j.start;
    if (from >= end) { from = f.load; end = fileEnd; }
    head.push({ k: 'cmt', a: f.load, text: `${f.name} — re-assembled by Mimir Studio` });
    head.push({ k: 'cmt', a: f.load, text: `load ${n4(from)}-${n4(end - 1)} (${end - from} bytes)${A.entry != null && fileOf(A.entry) === fi ? ` · entry ${labelAt(A.entry) ? labelAt(A.entry)!.name : n4(A.entry)}` : ''} · ${ASSEMBLERS[asm].title}` });
    part(at, 'title'); at = head.length;
    // the loaders found in this file (spec 8.11c); their parts are marked where they start and end
    const fileLoaders = (A.loaders ?? []).filter(l => l.parts.some(p => fileOf(p.start) === fi));
    if (fileLoaders.length) {
      head.push({ k: 'cmt', a: f.load, text: `loader${fileLoaders.length > 1 ? 's' : ''} found by Mimir Studio (the ==== lines mark their parts):`, mark: true });
      for (const l of fileLoaders) {
        // a long description goes on over lines of its own, indented under the loader's name
        for (const t of wrapComment(`${l.name}${l.sure === 'likely' ? ' (by its traits)' : ''}: ${l.how}`, LOADER_TEXT_WIDTH)) {
          head.push({ k: 'cmt', a: f.load, text: t, mark: true });
        }
      }
    }
    // the Spindle script, in the file with the first driver
    if (A.spindle?.length && fileOf(A.spindle[0].start) === fi) {
      head.push({ k: 'cmt', a: f.load, text: 'Spindle effect drivers found by Mimir Studio (the ==== lines mark them), as the script they were built from:', mark: true });
      for (const t of spindleScript(A.spindle)) head.push({ k: 'cmt', a: f.load, text: t && `  ${t}`, mark: true });
    }
    // BoozeLoader's script (5.15b), in the file with its first stretch of code
    if (A.booze?.runs.length && fileOf(A.booze.runs[0].start) === fi) {
      head.push({ k: 'cmt', a: f.load, text: 'BoozeLoader script found by Mimir Studio (the ==== lines mark its stretches of code), as its loads and calls:', mark: true });
      for (const t of boozeScript(A.booze).slice(2)) head.push({ k: 'cmt', a: f.load, text: t && `  ${t}`, mark: true });
    }
    // the relocated blocks of this file (8.1b)
    const fileRelocs = relocs.filter(r => r.file === fi);
    if (fileRelocs.length) {
      const many = fileRelocs.length > 1;
      head.push({ k: 'cmt', a: f.load, text: `relocated block${many ? 's' : ''}: the program copies ${many ? 'them' : 'it'} elsewhere to run, so ${many ? 'each is' : 'it is'} written inside .pseudopc:`, mark: true });
      for (const r of fileRelocs) head.push({ k: 'cmt', a: f.load, text: `  ${n4(r.start)}-${n4(r.end - 1)}${labelAt(r.start) ? ` (${labelAt(r.start)!.name})` : ''} runs at ${n4(r.to)}-${n4(r.to + runSize(r) - 1)}`, mark: true });
    }
    if (fileExcluded.length && !tass) {
      head.push({ k: 'cmt', a: f.load, text: 'blocks left out of the build; remove the // in front of a #define to build it again:' });
      for (const x of fileExcluded) head.push({ k: 'cmt', a: f.load, text: `#define ${x.name}` });
    }
    part(at, 'mark');
    head.push({ k: 'blank', a: f.load });
    part(head.length - 1, 'gap'); at = head.length;
    // 64tass: the CPU with the undocumented opcodes, when the source writes one by its mnemonic
    if (tass && usedIll) { head.push({ k: 'dir', a: f.load, n: 0, tok: [{ t: 'dir', s: '.cpu' }, { t: 'p', s: ' ' }, { t: 'str', s: '"6502i"' }], cmt: 'the NMOS 6510 with its undocumented opcodes' }); part(at, 'import'); at = head.length; }
    if (S.hwInclude === 'import') { head.push({ k: 'dir', a: f.load, n: 0, tok: includeTokens(asm, 'include/c64-hardware.asm') }); part(at, 'import'); at = head.length; }
    else if (S.hwInclude === 'inline' && usedHw.size) {
      head.push({ k: 'cmt', a: f.load, text: 'hardware and KERNAL symbols' });
      for (const a of [...usedHw].sort((x, y) => x - y)) {
        const s = SYM.exact.get(a) || SYM.regions.find(r => r.start === a);
        if (s && !/\+/.test(s.name)) head.push({ k: 'dir', a: f.load, n: 0, tok: defineTokens(asm, defT(s.name), [numT(n4('addr' in s ? s.addr : s.start))]) });
      }
      part(at, 'hw'); at = head.length;
    }
    // 64tass: the flags of the blocks left out of the build (Kick Assembler's #define lines are in the marks above)
    if (fileExcluded.length && tass) {
      head.push({ k: 'blank', a: f.load });
      head.push({ k: 'cmt', a: f.load, text: 'blocks left out of the build; set a flag to true to build its block again:' });
      for (const x of fileExcluded) head.push({ k: 'dir', a: f.load, n: 0, tok: [defT(x.name), { t: 'p', s: ' = ' }, { t: 'kw', s: 'false' }] });
      part(at, 'mark'); at = head.length;
    }
    // the PETSCII control codes the texts write by name
    if (usedPet.size) { head.push(...petsciiDefinitions(usedPet, f.load, up, asm)); part(at, 'pet'); at = head.length; }
    if (usedZp.size) {
      head.push({ k: 'blank', a: f.load });
      head.push({ k: 'cmt', a: f.load, text: 'zero page' });
      for (const a of [...usedZp].sort((x, y) => x - y)) {
        // the user's comment lines on a zero-page variable go above its .label line (Project.notes at its address)
        if (noteAt(a)) head.push(...commentLines(a, notes[a].text, !!notes[a].block, true).map((l): Line => ({ ...l, a: f.load, zp: a } as Line)));
        head.push({ k: 'dir', a: f.load, n: 0, zp: a, tok: defineTokens(asm, defT(zp.get(a)!.name, a), [numT(n2(a))]) });
      }
      part(at, 'zp'); at = head.length;
    }
    if (usedExt.size) {
      head.push({ k: 'blank', a: f.load });
      head.push({ k: 'cmt', a: f.load, text: 'labels defined in other files' });
      for (const a of [...usedExt].sort((x, y) => x - y)) head.push({ k: 'dir', a: f.load, n: 0, tok: defineTokens(asm, defT(labelAt(a)!.name), [numT(n4(a))]) });
      part(at, 'ext'); at = head.length;
    }
    if (usedForeign.size) {
      head.push({ k: 'blank', a: f.load });
      head.push({ k: 'cmt', a: f.load, text: 'labels in other banks of the cartridge' });
      for (const a of [...usedForeign].sort((x, y) => x - y)) head.push({ k: 'dir', a: f.load, n: 0, tok: defineTokens(asm, defT(foreign[a]), [numT(n4(a))]) });
      part(at, 'foreign'); at = head.length;
    }
    if (ctx.usedMusic.size) {
      head.push({ k: 'blank', a: f.load });
      for (const m of ctx.usedMusic) head.push(...(tass ? tassMusic(m, f.load) : [{ k: 'dir', a: f.load, n: 0, tok: [{ t: 'dir', s: '.var' }, { t: 'p', s: ' ' }, { t: 'def', s: musicVar(m) }, { t: 'p', s: ' = ' }, { t: 'kw', s: 'LoadSid' }, { t: 'p', s: '(' }, { t: 'str', s: `"${musicPath(m)}"` }, { t: 'p', s: ')' }] } as Line]));
      part(at, 'music'); at = head.length;
    }
    head.push({ k: 'blank', a: f.load });
    part(at, 'gap');
    const lines = head.concat(body);
    while (lines.length && lines[lines.length - 1].k === 'blank') lines.pop();
    const userCmt = project.comments || {}, done = new Set<Addr>();
    for (const l of lines) {
      // a zero-page variable's comment (Project.comments at its address) goes at the end of its .label line
      const at = l.k === 'dir' && l.zp != null ? l.zp : l.a;
      if ((l.k === 'ins' || l.k === 'dat' || (l.k === 'dir' && (l.n > 0 || l.zp != null))) && userCmt[at] && !done.has(at)) { l.cmt = userCmt[at].replace(/\s*\r?\n\s*/g, ' '); l.userCmt = true; done.add(at); }
    }
    const path = `${fileNames[fi]}.asm`;
    outFiles[path] = lines.map(l => lineText(l, S)).join('\n') + '\n';
    fileLines[path] = lines;
    listing.push({ k: 'file', a: f.load, text: path, fi });
    for (const l of opts.dataAsCode ? asCode(lines) : lines) listing.push(l);
  });
  Object.assign(outFiles, binFiles);
  // with raw addresses nothing refers to the symbol file, so it is not written
  if (S.hwInclude !== 'none') outFiles['include/c64-hardware.asm'] = hardwareInclude(S);
  return { lines: listing, files: outFiles, fileLines, labels, zp, fileNames, problems, usedHw: allUsedHw, excluded: excludedAll, ...(tass ? { assembler: asm } : {}) };
}
