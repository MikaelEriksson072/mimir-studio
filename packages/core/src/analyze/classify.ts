/* 5.10 classification map, 5.11 data objects and classification of remaining data */
import { PET_CTRL, type Ctx } from './context';
import type { Addr, Block, BlockProps, EntryKind, GfxCandidate, MemConfigInfo, MusicInfo, TextEncoding, TypeId, XRef } from '../types';
import { T, TYPE_BY_KEY, typeInfo } from '../model';
import { OPC } from '../cpu/opcodes';
import { banksOf, ioVisible, reachesForName } from '../c64/memconfig';
import { $2, $4, word } from '../util/hex';
import { d018Case, handedLen as handed, printCase, stringSwitch, type CaseSwitch, type PrintCase, type StringEv } from './strings';

export interface Classification {
  tm: Uint8Array;
  blocks: Block[];
  /** music entries matching the final Music blocks one to one */
  music: MusicInfo[];
  gfxBlocks: GfxCandidate[];
  offsetOf: Map<Addr, Addr>;
  objStarts: Set<Addr>;
  /** written (or read-modify-written) by traced code */
  written: (a: Addr) => boolean;
  /** referenced with an indexed addressing mode */
  indexedRef: (a: Addr) => boolean;
}

/** Binary search over blocks sorted by start. */
export function findBlock(blocks: readonly Block[], addr: Addr): Block | null {
  let lo = 0, hi = blocks.length - 1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (blocks[m].end <= addr) lo = m + 1; else if (blocks[m].start > addr) hi = m - 1; else return blocks[m]; }
  return null;
}

type NewBlock = Omit<Block, 'id' | 'user' | 'entropy'> & Partial<Pick<Block, 'id' | 'user' | 'entropy'>>;

export function classify(ctx: Ctx, music: MusicInfo[], gfx: GfxCandidate[], mcfg: MemConfigInfo | null = null): Classification {
  const { S, mem, owner, insLen, codeOwner, basics, ov, ovProps, xrefs, entryKind, ijumps, lohiTabs, loaded, L } = ctx;
  const { ptrTargets, textPtrs, strings, wordPtrs, dataEv } = ctx.ev;

  // ---- 5.10 classification map ----
  const tm = new Uint8Array(0x10000);
  for (let a = 0; a < 0x10000; a++) if (owner[a] >= 0) tm[a] = T.DATA;
  for (const b of basics) for (let a = b.start; a < b.end; a++) tm[a] = T.BASIC;
  for (let a = 0; a < 0x10000; a++) if (insLen[a] || codeOwner[a] >= 0) tm[a] = T.CODE;
  // a user music override only paints where it is still the final override (a later code override wins)
  for (const m of music) for (let a = m.start; a < m.end; a++) if (!m.user || ov[a] === T.MUSIC) tm[a] = T.MUSIC;
  const gfxBlocks: GfxCandidate[] = [];
  if (S.detectGfx) {
    const merged = new Map<string, GfxCandidate>();
    for (const g of gfx) {
      const k = g.type + ':' + g.start;
      if (!merged.has(k)) merged.set(k, g);
    }
    for (const g of [...merged.values()].sort((x, y) => x.start - y.start)) {
      // only the bytes that are still data take the type; the graphics need to be most of what is loaded in their
      // window, and a piece of them between code shorter than a character or bitmap cell (8 bytes) stays data
      const end = Math.min(0x10000, g.start + g.size);
      let n = 0, data = 0, other = 0;
      for (let a = g.start; a < end; a++) if (tm[a] === T.DATA) data++; else if (tm[a]) other++;
      if (other > data) continue;
      for (let a = g.start; a < end;) {
        if (tm[a] !== T.DATA) { a++; continue; }
        let e = a; while (e < end && tm[e] === T.DATA) e++;
        if (e - a >= 8) { for (let p = a; p < e; p++) tm[p] = g.type; n += e - a; }
        a = e;
      }
      if (n) { gfxBlocks.push(g); L('ok', `${typeInfo(g.type).label} at ${$4(g.start)} (${g.why})`, g.start, 'gfx'); }
    }
  }
  // a cartridge's vectors and signature (5.3b), where no code was traced over them
  const known = new Map<Addr, { props: BlockProps; reason: string }>();
  for (const k of ctx.cartStart?.blocks ?? []) {
    let free = true; for (let a = k.start; a < k.end; a++) if (tm[a] !== T.DATA) free = false;
    if (!free) continue;
    for (let a = k.start; a < k.end; a++) tm[a] = k.type;
    known.set(k.start, { props: k.props, reason: k.reason });
  }
  // 8.1b: where a relocated block is loaded, one block that says where it runs (the blocks there say what it is)
  for (const r of ctx.relocs) known.set(r.start, { props: { to: r.to }, reason: `you relocated it: it runs at ${$4(r.to)}-${$4(r.to + r.end - r.start - 1)}` });
  for (let a = 0; a < 0x10000; a++) if (ov[a] && owner[a] >= 0 && ov[a] !== T.CODE) tm[a] = ov[a];

  // ---- 5.11 data objects & classification of remaining data ----
  const offsetOf = new Map<Addr, Addr>();
  for (const p of wordPtrs) offsetOf.set((p + 1) & 0xffff, p);
  for (const j of ijumps) if (loaded(j.ptr)) offsetOf.set(j.ptr + 1, j.ptr);
  // `lda tab+1,x` reads the high bytes of a word table: tab+1, not a label of its own
  for (const t of ctx.wordTables.keys()) offsetOf.set(t + 1, t);
  const refTargets = new Set<Addr>();
  // with bank tracking, an access that always reaches I/O or ROM goes to the hardware, not to the program's bytes
  // below it (a memory dump over $d000-$dfff, say): the render writes the register, so it makes no label there.
  // At $d000-$dfff that is also so when the configuration cannot be told
  const toBytes = (to: Addr, x: XRef) => x.kind !== 'branch' && x.kind !== 'jump' && x.kind !== 'call'
    && !(mcfg && reachesForName(to, mcfg.port[x.from], OPC[mem[x.from]].access === 'write', mcfg.cart) === 'hw');
  for (const [to, l] of xrefs) if (loaded(to) && l.some(x => toBytes(to, x)) && !offsetOf.has(to)) refTargets.add(to);
  const objStarts = new Set<Addr>([...refTargets, ...ptrTargets.keys(), ...textPtrs.keys(), ...lohiTabs.keys()]);
  const written = (a: Addr) => (xrefs.get(a) || []).some(x => x.kind === 'write' || x.kind === 'rmw');
  const indexedRef = (a: Addr) => (xrefs.get(a) || []).some(x => { const o = OPC[mem[x.from]]; return o.mode === 'abx' || o.mode === 'aby'; });

  const blocks: NewBlock[] = [];
  const finalMusic: MusicInfo[] = [];
  const pushBlock = (start: Addr, end: Addr, type: TypeId, p: BlockProps = {}, conf = 1, reason = '') => {
    if (end > start) blocks.push({ start, end, type: typeInfo(type).key, props: p, conf, reason, file: owner[start] });
  };
  const validChar = (b: number, enc: TextEncoding) => enc === 'petscii' ? ((b >= 0x20 && b <= 0x5f) || PET_CTRL.has(b) || (b >= 0xc1 && b <= 0xda)) : (b >= 0x01 && b <= 0x3f) || (b >= 0x41 && b <= 0x5a);
  const textLen = (s: Addr, e: Addr, enc: TextEncoding) => {
    let n = 0;
    while (s + n < e) { const b = mem[s + n]; if (b === 0) { n++; break; } if (!validChar(b, enc)) break; n++; }
    return n;
  };
  // a string handed to a print routine is as long as its parameters or its loop say, when that many bytes read as text
  const handedLen = (s: Addr, e: Addr, str: StringEv): number | null => handed(mem, s, e - s, str);
  // such a string goes on over the object starts in it (a byte the code changes): the rest of it, where one cuts it
  const carry = new Map<Addr, { left: number; from: Addr; cs: ReturnType<PrintCase> | null }>();
  /** where the data the walk splits at object starts ends, from `e` on */
  const dataEnd = (s: Addr, e: Addr) => { while (e < 0x10000 && tm[e] === T.DATA && ov[e] !== T.DATA && owner[e] === owner[s]) e++; return e; };
  const smooth = (s: Addr, n: number) => {
    if (n < 16) return false;
    let min = 255, max = 0, sum = 0, ch = 0, psg = 0, maxd = 0;
    for (let i = 0; i < n; i++) {
      const v = mem[s + i]; min = Math.min(min, v); max = Math.max(max, v);
      if (i) { const dd = v - mem[s + i - 1]; sum += Math.abs(dd); maxd = Math.max(maxd, Math.abs(dd)); if (dd) { const sg = Math.sign(dd); if (psg && sg !== psg) ch++; psg = sg; } }
    }
    const range = max - min;
    return range >= 8 && sum / (n - 1) <= range / 6 && ch <= Math.max(3, n / 24) && maxd <= range / 3 + 1;
  };
  const glyphLike = (s: Addr, n: number) => {
    let good = 0; const cells = Math.floor(n / 8);
    for (let c = 0; c < cells; c++) {
      const d = new Set<number>();
      for (let i = 0; i < 8; i++) d.add(mem[s + c * 8 + i]);
      if (d.size <= 6) good++;
    }
    return cells && good / cells > 0.8;
  };
  const refInside = (s: Addr, e: Addr) => { for (let a = s + 1; a < e; a++) if (objStarts.has(a)) return true; return false; };
  const classifySpan = (s: Addr, e: Addr, isObj: boolean): void => {
    if (e <= s) return;
    const ev = dataEv.get(s) || new Set<string>();
    const lt = lohiTabs.get(s);
    if (isObj && lt) {
      const n = Math.min(lt.len, e - s);
      if (n > 0) { pushBlock(s, s + n, T.LOHI, { part: lt.part, partner: lt.partner, ptr: lt.ptr, code: lt.code }, 0.95, `indexed loads stored to ${$4(lt.dest)}/${$4(lt.dest + 1)}`); classifySpan(s + n, e, false); return; }
    }
    const str = isObj ? strings.get(s) : undefined, cont = isObj && !str ? carry.get(s) : undefined;
    const enc: TextEncoding | null = textPtrs.get(s) || (ev.has('petscii') ? 'petscii' : ev.has('screen') ? 'screen' : null) || (cont ? 'petscii' : null);
    if (isObj && enc && S.detectText) {
      const far = str ? dataEnd(s, e) : e, sn = str ? handedLen(s, far, str) : cont ? cont.left : null;
      const full = sn ?? textLen(s, far, enc), n = Math.min(full, e - s);
      if (full >= (sn != null ? 1 : 2)) {
        // printed text is in the case the program prints in (5.5c), the rest of a string in the case of the string
        const cs = enc !== 'petscii' ? null : cont ? cont.cs : caseOf(mem.subarray(s, s + full));
        if ((str || cont) && full > n) carry.set(e, { left: full - n, from: cont ? cont.from : s, cs });
        const why = cont ? `the rest of the string at ${$4(cont.from)}` : (str ? str.by + (str.len != null && sn != null ? `, ${sn} byte${sn === 1 ? '' : 's'}` : '')
          : enc === 'petscii' ? 'printed through KERNAL/BASIC output' : 'copied to screen memory') + (cs ? cs.why : '');
        pushBlock(s, s + n, T.TEXT, { enc: cs ? cs.enc : enc }, 0.9, why); classifySpan(s + n, e, false); return;
      }
    }
    // fill runs
    const first = mem[s];
    let same = true; for (let i = s; i < e; i++) if (mem[i] !== first) { same = false; break; }
    if (same && (e - s) >= (isObj ? 8 : 3)) { pushBlock(s, e, T.FILL, { value: first }, 0.9, `${e - s} × ${$2(first)}`); return; }
    for (let i = s + 1; i < e; i++) {
      let z = 0; while (i + z < e && mem[i + z] === mem[i]) z++;
      if (z >= 32) { classifySpan(s, i, isObj); pushBlock(i, i + z, T.FILL, { value: mem[i] }, 0.9, `${z} × ${$2(mem[i])}`); classifySpan(i + z, e, false); return; }
      i += Math.max(0, z - 1);
    }
    const n = e - s;
    if (ev.has('color') || ev.has('colorram')) { let ok = true; for (let i = s; i < e; i++) if (mem[i] > 15) { ok = false; break; } if (ok) { pushBlock(s, e, T.TABLE, { sub: 'colors' }, 0.85, 'loaded and stored to VIC color registers'); return; } }
    if (smooth(s, n)) { pushBlock(s, e, T.TABLE, { sub: 'sine' }, ev.size ? 0.9 : 0.7, ev.has('spritepos') ? 'smooth curve used for sprite positions' : 'smooth curve (sine/ramp)'); return; }
    if (isObj && n >= 4 && n % 2 === 0 && n <= 128) {
      let ok = true; for (let i = s; i < e; i += 2) if (!insLen[word(mem, i)]) { ok = false; break; }
      if (ok) { pushBlock(s, e, T.WORDS, { code: true }, 0.8, 'every word points at an instruction'); return; }
    }
    if (!isObj && S.detectText && n >= 8) {
      let letters = 0, bad = 0;
      for (let i = s; i < e; i++) { const b = mem[i]; if ((b >= 0x41 && b <= 0x5a) || b === 0x20) letters++; else if (!validChar(b, 'petscii') && b !== 0) bad++; }
      if (bad === 0 && letters / n > 0.6) { pushBlock(s, e, T.TEXT, { enc: 'petscii' }, 0.5, 'looks like PETSCII text'); return; }
    }
    if (S.detectGfx && !refInside(s, e)) {
      if (n >= 7990 && (s & 0x1fff) === 0) { pushBlock(s, s + Math.min(n, 8000), T.BITMAP, {}, 0.5, '8000 bytes at an 8K boundary'); classifySpan(s + Math.min(n, 8000), e, false); return; }
      if (n >= 2048 && (s & 0x7ff) === 0 && glyphLike(s, 2048)) { pushBlock(s, s + 2048, T.CHARSET, {}, 0.5, '2048 glyph-like bytes at a 2K boundary'); classifySpan(s + 2048, e, false); return; }
    }
    const isVar = isObj && written(s) && n <= 4;
    pushBlock(s, e, T.DATA, { var: isVar, indexed: isObj && indexedRef(s) }, isObj ? 0.75 : 0.3, isVar ? 'read and written by code' : isObj ? 'referenced by code' : 'not referenced by any traced code');
  };

  // 5.5c the case the program prints in: the switches the code makes, sent to CHROUT or stored to $d018 (where I/O is
  // seen; in a bank where the VIC sees the ROM's characters, or not), and a $0e or $8e in a string handed to a print routine
  const romChars = (pc: Addr) => !mcfg || banksOf(mcfg.vic[pc] || 1).some(b => b === 0 || b === 2);
  const switches: CaseSwitch[] = [...ctx.ev.cases];
  for (const w of ctx.ev.writes) {
    if (w.dest !== 0xd018 || w.indexed || (mcfg && ioVisible(mcfg.port[w.pc]) === 'none')) continue;
    const c = d018Case(mem, insLen, w.pc, w.v, romChars(w.pc)); if (c) switches.push(c);
  }
  for (const [s, str] of strings) { const n = handedLen(s, dataEnd(s, s), str); const c = n ? stringSwitch(mem.subarray(s, s + n), s) : null; if (c) switches.push(c); }
  const caseOf = printCase(switches.sort((x, y) => x.at - y.at), L);

  // walk the map
  const routineKinds = new Set<EntryKind | undefined>(['entry', 'irq', 'nmi', 'brk', 'user', 'sub', 'ptr', 'guess']);
  let a = 0;
  while (a < 0x10000) {
    const t = tm[a] as TypeId;
    if (!t) { a++; continue; }
    let e = a + 1;
    const fileA = owner[a];
    if (t === T.CODE) {
      while (e < 0x10000 && tm[e] === T.CODE && owner[e] === fileA && !(insLen[e] && routineKinds.has(entryKind.get(e)))) e++;
      const k = entryKind.get(a);
      pushBlock(a, e, T.CODE, {}, k === 'guess' ? 0.6 : 1, k === 'guess' ? 'nothing traced reaches it, but it decodes as a routine' : k ? `entry: ${k}` : 'reached by code flow');
    } else if (t === T.DATA && ov[a] === T.DATA) {
      // bytes the user marked as Bytes: plain Data, split at override starts like other overrides, never re-detected
      while (e < 0x10000 && tm[e] === T.DATA && ov[e] === T.DATA && owner[e] === fileA && !ovProps.has(e)) e++;
      const o = ovProps.get(a);
      pushBlock(a, e, T.DATA, Object.assign({}, o ? o.props : {}), 1, 'user override');
    } else if (t === T.DATA) {
      while (e < 0x10000 && tm[e] === T.DATA && ov[e] !== T.DATA && owner[e] === fileA) e++;
      // split at object starts
      const cuts = [a];
      for (let p = a + 1; p < e; p++) if (objStarts.has(p)) cuts.push(p);
      cuts.push(e);
      for (let i = 0; i < cuts.length - 1; i++) classifySpan(cuts[i], cuts[i + 1], objStarts.has(cuts[i]));
    } else {
      // graphics the user marked end where the marking does: 16 rows of a bitmap the VIC shows whole are no 8000 bytes
      // (the rest is a block of its own, as the VIC evidence says)
      const gfxEnd = typeInfo(t).group === 'gfx';
      while (e < 0x10000 && tm[e] === t && owner[e] === fileA && !(ovProps.has(e) && e !== a) && !known.has(e) && !(gfxEnd && ov[e] !== ov[a])) e++;
      const o = ovProps.get(a), k = !o ? known.get(a) : undefined;
      const p: BlockProps = Object.assign({}, o ? o.props : k ? k.props : {});
      if (t === T.TEXT && !p.enc) p.enc = 'petscii';
      if (t === T.FILL) p.value = mem[a];
      if (t === T.MUSIC) {
        const m = music.find(x => x.start === a); if (m) Object.assign(p, { init: m.init, play: m.play });
        // one music entry per final Music block with exactly its range, so the .sid file always holds
        // the block's bytes (overrides can shorten, split or re-mark a detected region)
        const src = m || music.find(x => a >= x.start && a < x.end);
        finalMusic.push(Object.assign({}, src || { init: a, play: a + 3, sidRegs: 0, score: 0, why: ['marked by user'], file: owner[a], user: true }, { start: a, end: e }));
      }
      // the candidate the block is part of (code can split one into several blocks)
      const g = gfxBlocks.find(x => x.type === t && a >= x.start && a < x.start + x.size);
      pushBlock(a, e, t, p, o ? 1 : g ? 0.9 : 1, o ? 'user override' : k ? k.reason : g ? g.why : t === T.BASIC ? 'BASIC program lines' : t === T.MUSIC ? 'SID player heuristics' : '');
    }
    a = e;
  }
  // mark user blocks, keep block types in sync with tm for split blocks
  for (const b of blocks) {
    const tid = TYPE_BY_KEY[b.type];
    b.user = !!(ov[b.start] && (ov[b.start] === tid || (b.type === 'code' && ov[b.start] === T.CODE)));
    for (let p = b.start; p < b.end; p++) tm[p] = tid;
    const o = ovProps.get(b.start); if (o && o.props) b.props = Object.assign({}, b.props, o.props);
  }
  blocks.sort((x, y) => x.start - y.start);
  // adjacent small variables read better as one "Variables" block with a label per variable
  for (let i = 1; i < blocks.length; i++) {
    const p = blocks[i - 1], c = blocks[i];
    if (p.type === 'data' && c.type === 'data' && p.props.var && c.props.var && p.end === c.start && p.file === c.file && !p.user && !c.user) {
      p.end = c.end; blocks.splice(i, 1); i--;
    }
  }
  blocks.forEach((b, i) => { b.id = i; });
  return { tm, blocks: blocks as Block[], music: finalMusic, gfxBlocks, offsetOf, objStarts, written, indexedRef };
}
