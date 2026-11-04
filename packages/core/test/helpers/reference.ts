/* Loads the original single-file prototype engine (test/reference/core.prototype.cjs) as an oracle.
 * Every deliberate deviation of the production engine is applied to the reference as an explicit
 * text patch, so this list documents each behaviour change in one place. */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { detectMusic } from '../../src/analyze/music';
import { CHAR_OUT, d018Case, handedText, inlineAfter, inlineString, popsReturn, printCase, printers, printLoop, sentCase, stringLen, stringSwitch } from '../../src/analyze/strings';

export interface Edit { find: string; replace: string }
export interface Deviation { why: string; edits: Edit[] }

export const DEVIATIONS: Deviation[] = [
  {
    why: 'KickAss 5.25 rejects `.zp` on (zp),y operands ("Cannot force zeropage mode on an argument of type indirectZeropageY"); that mode has no 16-bit form and needs no suffix',
    edits: [{
      find: "if (tk[0].t === 'lbl' && !tk[0].zp && loaded(tk[0].to)) ext = '.zp';",
      replace: "if (tk[0].t === 'lbl' && !tk[0].zp && loaded(tk[0].to) && o.mode !== 'izy') ext = '.zp';",
    }],
  },
  {
    why: 'A 1-byte Word table block wrote its label twice ("label defined twice"); found by the fuzz test',
    edits: [{
      find: 'if (p < b.end) { label(p); dataRows(out, p, b.end, ctx, {}); }\n        break;\n      }\n      case T.FILL:',
      replace: 'if (p < b.end) { if (p !== b.start) label(p); dataRows(out, p, b.end, ctx, {}); }\n        break;\n      }\n      case T.FILL:',
    }],
  },
  {
    why: 'The "Mark as code" linear sweep could start inside an instruction from an earlier code override, claim bytes a later data override owns, or cross into the next file (bytes emitted twice); found by the fuzz test',
    edits: [{
      find: 'let ok = loaded(a + info.len - 1) && a + info.len <= o.end;\n      for (let k = 1; ok && k < info.len; k++) if (insLen[a + k] || codeOwner[a + k] >= 0) ok = false;',
      replace: 'let ok = codeOwner[a] < 0 && !forcedData(a) && loaded(a + info.len - 1) && a + info.len <= o.end;\n      for (let k = 1; ok && k < info.len; k++) if (insLen[a + k] || codeOwner[a + k] >= 0 || forcedData(a + k) || owner[a + k] !== owner[a]) ok = false;',
    }],
  },
  {
    why: 'Tracing let an instruction run from one file into the next, so the first file re-assembled one byte too long (spec 7.3: an instruction never crosses a file end); found by the fuzz test',
    edits: [{
      find: 'if (!loaded(b) || insLen[b] || codeOwner[b] >= 0 || forcedData(b)) { ok = false; break; }',
      replace: 'if (!loaded(b) || owner[b] !== owner[pc] || insLen[b] || codeOwner[b] >= 0 || forcedData(b)) { ok = false; break; }',
    }],
  },
  {
    why: 'Music entries could disagree with the final Music blocks (two music overrides at one address, overrides splitting a detected tune), so the .sid file missed bytes; there is now one entry per Music block with its exact range',
    edits: [
      { find: '  const blocks = [];\n', replace: '  const blocks = [], finalMusic = [];\n' },
      {
        find: 'if (t === T.MUSIC) { const m = music.find(x => x.start === a); if (m) Object.assign(p, { init: m.init, play: m.play }); }',
        replace: "if (t === T.MUSIC) { const m = music.find(x => x.start === a); if (m) Object.assign(p, { init: m.init, play: m.play }); const src = m || music.find(x => a >= x.start && a < x.end); finalMusic.push(Object.assign({}, src || { init: a, play: a + 3, sidRegs: 0, score: 0, why: ['marked by user'], file: owner[a], user: true }, { start: a, end: e })); }",
      },
      { find: 'entryKind, entry, basics, music, vic, gfx: gfxBlocks', replace: 'entryKind, entry, basics, music: finalMusic, vic, gfx: gfxBlocks' },
    ],
  },
  {
    why: 'A user music override that a later code override replaced still painted its bytes as music over the new instructions (bytes emitted twice); found by the fuzz test',
    edits: [{
      find: 'for (const m of music) for (let a = m.start; a < m.end; a++) tm[a] = T.MUSIC;',
      replace: 'for (const m of music) for (let a = m.start; a < m.end; a++) if (!m.user || ov[a] === T.MUSIC) tm[a] = T.MUSIC;',
    }],
  },
  {
    why: 'A branch whose target wraps around $ffff/$0000 (code loaded at $0000) was written as `bne $ffe6`, which no assembler accepts; it is now a .byte line with the mnemonic in the comment; found by the fuzz test',
    edits: [{
      find: '    const d = decode(mem, pc);\n    const opTok = [];',
      replace: "    if (o.mode === 'rel') { const raw = pc + 2 + ((mem[(pc + 1) & 0xffff] ^ 0x80) - 0x80); if (raw < 0 || raw > 0xffff) return Object.assign(line, { k: 'dat', dir: '.byte', tok: joinList(bytes.map(b => ({ t: 'num', s: n2(b) }))), cmt: mnc(o.mn) + ' ' + n4(raw & 0xffff) + ' (branch wraps around the address space)' }); }\n    const d = decode(mem, pc);\n    const opTok = [];",
    }],
  },
  {
    why: 'A label inside a word, a sprite row or the BasicUpstart2 stub was referenced but never written ("Unknown symbol"); such blocks now fall back to plain .byte rows; found by the fuzz test',
    edits: [
      {
        find: "    const label = (a) => { const l = labelAt(a); if (l) out.push({ k: 'lbl', a, name: l.name }); };\n",
        replace: "    const label = (a) => { const l = labelAt(a); if (l) out.push({ k: 'lbl', a, name: l.name }); };\n    const hiddenLabel = (from, to, every = 0) => { for (let p = from; p < to; p++) if (labelAt(p) && !(every && (p - b.start) % every === 0)) return true; return false; };\n",
      },
      {
        find: 'if (bs && bs.upstart && S.basicUpstart && b.end === bs.end) {',
        replace: 'if (bs && bs.upstart && S.basicUpstart && b.end === bs.end && !hiddenLabel(b.start, b.end)) {',
      },
      {
        find: '      case T.WORDS: {\n        label(b.start);\n',
        replace: '      case T.WORDS: {\n        label(b.start);\n        if (hiddenLabel(b.start + 1, b.start + ((b.end - b.start) & ~1), 2)) { dataRows(out, b.start, b.end, ctx, {}); break; }\n',
      },
      {
        find: '      case T.SPRITE: {\n        let p = b.start;\n',
        replace: '      case T.SPRITE: {\n        if (hiddenLabel(b.start + 1, b.start + (b.end - b.start) - ((b.end - b.start) % 64), 64)) { label(b.start); dataRows(out, b.start, b.end, ctx, {}); break; }\n        let p = b.start;\n',
      },
    ],
  },
  {
    why: 'KickAss 5.25 rejects upper-case mnemonics ("Pseudo command \'SEI\' not defined"), so mnemonics are always lower case and Settings.mnemonicCase no longer changes the output',
    edits: [
      {
        find: "  const mnc = m => S.mnemonicCase === 'upper' ? m : m.toLowerCase();\n  const loaded =",
        replace: '  const mnc = m => m.toLowerCase();\n  const loaded =',
      },
      {
        find: "  const mnc = m => S.mnemonicCase === 'upper' ? m : m.toLowerCase();\n  const adr =",
        replace: '  const mnc = m => m.toLowerCase();\n  const adr =',
      },
    ],
  },
  {
    why: 'Word tables widened every number token, so `label+10` became `label+$080b` (wrong value); found by the fuzz test',
    edits: [{
      find: ".map(t => t.t === 'num' ? Object.assign({}, t, { s: n4(v) }) : t)",
      replace: ".map((t, _i, all) => t.t === 'num' && all.length === 1 ? Object.assign({}, t, { s: n4(v) }) : t)",
    }],
  },
  {
    why: '"Mark as Bytes" had no effect on data the heuristics detect (a sine table or PETSCII text stayed a Table/Text block with user false): a data override only set the type map to Data, which the map walk then classified again; such bytes are now their own plain user Data block, split at override starts like other overrides',
    edits: [{
      find: '    } else if (t === T.DATA) {\n      while (e < 0x10000 && tm[e] === T.DATA && owner[e] === fileA) e++;\n',
      replace: "    } else if (t === T.DATA && ov[a] === T.DATA) {\n      while (e < 0x10000 && tm[e] === T.DATA && ov[e] === T.DATA && owner[e] === fileA && !ovProps.has(e)) e++;\n      const o = ovProps.get(a);\n      pushBlock(a, e, T.DATA, Object.assign({}, o ? o.props : {}), 1, 'user override');\n    } else if (t === T.DATA) {\n      while (e < 0x10000 && tm[e] === T.DATA && ov[e] !== T.DATA && owner[e] === fileA) e++;\n",
    }],
  },
  {
    why: 'Overrides that later ones cover completely still counted: their start split the new block, their props leaked into it, and a covered (or cleared) code override still traced and swept, so "Clear override" did not undo "Mark as code"; now block boundaries and props follow the override that wins at each address, and only overrides that still win somewhere are traced, swept or used as music',
    edits: [{
      find: "  const ovList = (project.overrides || []).filter(o => o.type !== 'auto');\n  const ovProps = new Map();\n  for (const o of project.overrides || []) {\n    for (let a = o.start; a < o.end && a < 0x10000; a++) ov[a] = o.type === 'auto' ? 0 : (TYPE_BY_KEY[o.type] || T.DATA);\n    if (o.type !== 'auto') ovProps.set(o.start, o);\n  }\n",
      replace: "  const ovProps = new Map();\n  const ovAll = project.overrides || [], ovWin = new Int32Array(0x10000).fill(-1);\n  ovAll.forEach((o, i) => { for (let a = o.start; a < o.end && a < 0x10000; a++) { ov[a] = o.type === 'auto' ? 0 : (TYPE_BY_KEY[o.type] || T.DATA); ovWin[a] = o.type === 'auto' ? -1 : i; } });\n  const ovLive = new Set();\n  for (let a = 0; a < 0x10000; a++) { const i = ovWin[a]; if (i >= 0) { ovLive.add(i); if (a === 0 || ovWin[a - 1] !== i) ovProps.set(a, ovAll[i]); } }\n  const ovList = ovAll.filter((_o, i) => ovLive.has(i));\n",
    }],
  },
  {
    why: 'A block comment with a line break (the inspector field is multi-line) became one `//` line whose second half was read as code, and a line comment with a line break did the same; a block comment is now one `//` line per text line (an empty one is a bare `//`), and line breaks in a line comment become spaces',
    edits: [
      { find: "    if (userCmt) out.push({ k: 'cmt', a: b.start, text: userCmt });\n", replace: "    if (userCmt) for (const x of userCmt.replace(/\\r\\n?/g, '\\n').split('\\n')) out.push({ k: 'cmt', a: b.start, text: x.trimEnd() });\n" },
      { find: '{ l.cmt = userCmt[l.a]; l.userCmt = true; done.add(l.a); }', replace: "{ l.cmt = userCmt[l.a].replace(/\\s*\\r?\\n\\s*/g, ' '); l.userCmt = true; done.add(l.a); }" },
      { find: "    case 'cmt': return `// ${l.text}`;", replace: "    case 'cmt': return l.text ? `// ${l.text}` : '//';" },
    ],
  },
  {
    why: 'The demo program hung after printing its text: `sei` came before init_screen, whose KERNAL text output ends with `cli`, so the raster IRQ was enabled while $0314 still pointed at the KERNAL handler, which never acknowledges it; `sei` now follows init_screen. The raster bars moved below the title, and the second text line no longer breaks inside "C64" (same length, so every address stays)',
    edits: [
      { find: '  sei\n  jsr $e544\n  jsr init_screen\n', replace: '  jsr $e544\n  jsr init_screen\n  sei\n' },
      { find: '  lda #$32\n  sta $d012\n', replace: '  lda #$62\n  sta $d012\n' },
      { find: 'scrolltext: .text "HELLO FROM THE MIMIR DEMO: 6502 + C64 = FUN    "', replace: 'scrolltext: .text "HELLO FROM THE MIMIR STUDIO DEMO!       ENJOY!!"' },
    ],
  },
  {
    why: 'With "raw addresses" (hwInclude none) an access to a hardware register or KERNAL routine lost its comment ("Border color"), and include/c64-hardware.asm was still written although nothing imports it; the operand stays the raw address but keeps the symbol for the comment, and the include file is left out',
    edits: [
      {
        find: "      const hs = S.hwInclude !== 'none' ? hwSymbol(a) : null;\n      if (hs && (!ctx.isCall || hs.sym.call || hs.off)) { ctx.useHw && ctx.useHw(hs.sym.addr); return [{ t: 'hw', s: hs.text, to: a, sym: hs.sym }]; }\n",
        replace: "      const hs = hwSymbol(a);\n      if (hs && (!ctx.isCall || hs.sym.call || hs.off)) { if (S.hwInclude === 'none') return [{ t: 'num', s: a < 0x100 && ctx.zpWidth ? n2(a) : n4(a), to: a, sym: hs.sym }]; ctx.useHw && ctx.useHw(hs.sym.addr); return [{ t: 'hw', s: hs.text, to: a, sym: hs.sym }]; }\n",
      },
      { find: "const hsTok = opTok.find(t => t.t === 'hw');", replace: "const hsTok = opTok.find(t => (t.t === 'hw' || t.t === 'num') && t.sym);" },
      { find: "  outFiles['include/c64-hardware.asm'] = KR.hardwareInclude(S);", replace: "  if (S.hwInclude !== 'none') outFiles['include/c64-hardware.asm'] = KR.hardwareInclude(S);" },
    ],
  },
  {
    why: 'A program whose own bytes cover $fffa-$ffff (a memory dump) set its IRQ vector with `sta charset_fffe`, a label of the data there; the CPU vectors now keep their names (IRQ_VECTOR, or the raw address with its comment) for every access but a JSR/JMP target',
    edits: [{
      find: "      return [{ t: 'kw', s: `${v}.location`, to: m.start }, { t: 'p', s: '+' }, { t: 'num', s: n4(a - m.start) }];\n    }\n    const lb = labelAt(a);\n",
      replace: "      return [{ t: 'kw', s: `${v}.location`, to: m.start }, { t: 'p', s: '+' }, { t: 'num', s: n4(a - m.start) }];\n    }\n    if (a >= 0xfffa && !ctx.isCall) { const vs = hwSymbol(a); if (vs && vs.sym.cat === 'Vectors') { if (S.hwInclude === 'none') return [{ t: 'num', s: n4(a), to: a, sym: vs.sym }]; ctx.useHw && ctx.useHw(vs.sym.addr); return [{ t: 'hw', s: vs.text, to: a, sym: vs.sym }]; } }\n    const lb = labelAt(a);\n",
    }],
  },
  {
    why: 'Renaming a zero-page pointer (labels[$fb]) left its high byte as `ptr_fb+1`, a name no longer defined ("Unknown symbol"); the high byte now follows the renamed low byte',
    edits: [{
      find: "  for (const [a, l] of labels) if (a < 0x100 && !loaded(a) && l.user) { zp.set(a, { name: l.name, user: true }); labels.delete(a); }\n",
      replace: "  for (const [a, l] of labels) if (a < 0x100 && !loaded(a) && l.user) { zp.set(a, { name: l.name, user: true }); labels.delete(a); }\n  for (const [a, z] of zp) if (z.off) { const base = zp.get(a - z.off); if (base && base.name !== z.name) zp.set(a, Object.assign({}, z, { name: base.name })); }\n",
    }],
  },
  {
    why: 'Music detection (spec 5.8) missed most players: it needed both JMPs of the table traced, so a snapshot (init ran before it was taken), a play called from an interrupt the trace did not find, play at +6 or play code right after JMP init all went unseen. It was rewritten (decoding from the table, the note table, callers, overlapping tables) and is tested on its own in music.test.ts; the reference calls the production detector, its own is kept unused',
    edits: [
      {
        find: '  // ---- 5.8 music detection ----\n  const music = [];\n',
        replace: '  // ---- 5.8 music detection ----\n  const music = detectMusic({ S, mem, insLen, codeOwner, skip, inlineCalls, xrefs, owner, ovList, loaded, forcedData, L, entryKind });\n  const prototypeMusic = () => {\n  const music = [];\n',
      },
      { find: '\n  // ---- 5.9 VIC-II evidence', replace: '\n  };\n  // ---- 5.9 VIC-II evidence' },
    ],
  },
  {
    why: 'A $d018 write or sprite pointer made every byte still data in its window graphics, so a variable between two routines there became a 1-byte Charset or Screen matrix block (with no reason given): the graphics now need to be most of what is loaded in the window, a piece of them between code shorter than a character or bitmap cell (8 bytes) stays data, and each piece gets the reason of the candidate it is part of',
    edits: [
      {
        find: '      let n = 0;\n      for (let a = g.start; a < g.start + g.size && a < 0x10000; a++) if (tm[a] === T.DATA) { tm[a] = g.type; n++; }\n',
        replace: '      const end = Math.min(0x10000, g.start + g.size);\n      let n = 0, data = 0, other = 0;\n      for (let a = g.start; a < end; a++) if (tm[a] === T.DATA) data++; else if (tm[a]) other++;\n      if (other > data) continue;\n      for (let a = g.start; a < end;) {\n        if (tm[a] !== T.DATA) { a++; continue; }\n        let e = a; while (e < end && tm[e] === T.DATA) e++;\n        if (e - a >= 8) { for (let p = a; p < e; p++) tm[p] = g.type; n += e - a; }\n        a = e;\n      }\n',
      },
      { find: '      const g = gfxBlocks.find(x => x.start === a);\n', replace: '      const g = gfxBlocks.find(x => x.type === t && a >= x.start && a < x.start + x.size);\n' },
    ],
  },
  {
    why: 'A hardware name with an offset (`VIC_IRQ_ENABLE+$c0`, one token) after `<`/`>` in a lo/hi pointer table or an immediate hint lost its parentheses: `>VIC_IRQ_ENABLE+$c0` is `(>VIC_IRQ_ENABLE)+$c0` to KickAss, another byte; found on a real program while adding code islands',
    edits: [
      { find: "          else { opTok.push({ t: 'p', s: '#' + (h.kind === 'lo' ? '<' : '>') }); if (tk.length > 1) opTok.push({ t: 'p', s: '(' }, ...tk, { t: 'p', s: ')' }); else opTok.push(...tk); }", replace: "          else { opTok.push({ t: 'p', s: '#' + (h.kind === 'lo' ? '<' : '>') }); if (tk.length > 1 || /[+-]/.test(tk[0].s)) opTok.push({ t: 'p', s: '(' }, ...tk, { t: 'p', s: ')' }); else opTok.push(...tk); }" },
      { find: "              return tk.length > 1 ? [{ t: 'p', s: (lt.part === 'lo' ? '<' : '>') + '(' }, ...tk, { t: 'p', s: ')' }] : [{ t: 'p', s: lt.part === 'lo' ? '<' : '>' }, ...tk];", replace: "              return tk.length > 1 || /[+-]/.test(tk[0].s) ? [{ t: 'p', s: (lt.part === 'lo' ? '<' : '>') + '(' }, ...tk, { t: 'p', s: ')' }] : [{ t: 'p', s: lt.part === 'lo' ? '<' : '>' }, ...tk];" },
    ],
  },
  {
    why: 'Strings handed to print routines (spec 5.5b): the evidence pass only knew `lda #<t / ldy #>t / jsr $ab1e` and SETNAM, read the string to the first byte that is no character and left the program\'s own print routines alone, so their messages stayed data. Now the parameters at a call (registers, or a pointer and a length the caller stores) say where the string is, and the routine (STROUT, SETNAM, or the program\'s own: found by production code, `strs`) how long it is; a table printed through CHROUT ends at its loop\'s count or end byte. A store of an unknown value forgets the value stored before (a pointer pair made of it was stale), the string goes on over object starts in it, and the routines are named print_xxxx',
    edits: [
      { find: '  let writes, hints, ptrTargets, lohi, dataEv, wordPtrs, textPtrs, smc;\n', replace: '  let writes, hints, ptrTargets, lohi, dataEv, wordPtrs, textPtrs, smc, strings, printersFound = new Map();\n' },
      { find: 'textPtrs = new Map(); smc = new Map();\n    const starts = [];', replace: 'textPtrs = new Map(); smc = new Map(); strings = new Map(); printersFound = new Map();\n    const starts = [];' },
      { find: '    let A = null, X = null, Y = null, recent = new Map(), idxStores = [];\n', replace: '    let A = null, X = null, Y = null, recent = new Map(), idxStores = [];\n    let inAt = -1, inX = null, inY = null;\n' },
      { find: '          clearWritten(pc, Math.max(...flowIn.map(x => x.from)));', replace: '          inAt = pc; inX = X; inY = Y;\n          clearWritten(pc, Math.max(...flowIn.map(x => x.from)));' },
      {
        find: '      else if (loaded(value)) ptrTargets.set(value, dest);\n    };\n    for (const pc of starts) {',
        replace: "      else if (loaded(value)) ptrTargets.set(value, dest);\n    };\n    const printer = strs.printers({ mem, insLen, skip, L }, printersFound);\n    const addString = (s, str) => { if (!loaded(s)) return; textPtrs.set(s, 'petscii'); ptrTargets.delete(s); const old = strings.get(s); if (!old || (old.len == null && str.len != null)) strings.set(s, str); };\n    const lenOf = (count, from) => (count != null && count > from ? count - from : undefined);\n    for (const pc of starts) {",
      },
      {
        find: '      const info = OPC[mem[pc]], d = decode(mem, pc), mn = info.mn, mode = info.mode;\n',
        replace: '      const info = OPC[mem[pc]], d = decode(mem, pc), mn = info.mn, mode = info.mode;\n      if (info.access === \'rmw\' && d.target != null) recent.delete(d.target);\n',
      },
      {
        find: "      const idxOf = () => (mode === 'abx' || mode === 'aby') && loaded(d.v) && !insLen[d.v] && codeOwner[d.v] < 0 ? { t: d.v, r: mode === 'abx' ? 'x' : 'y', pc } : null;\n",
        replace: "      const index = (r) => ((r === 'x' ? X : Y) ?? (inAt === pc ? (r === 'x' ? inX : inY) : null))?.v ?? null;\n      const idxOf = () => (mode === 'abx' || mode === 'aby') && loaded(d.v) && !insLen[d.v] && codeOwner[d.v] < 0 ? { t: d.v, r: mode === 'abx' ? 'x' : 'y', pc, from: index(mode === 'abx' ? 'x' : 'y') } : null;\n      const handOver = (t) => {\n        const P = printer(t);\n        if (!P) return;\n        const val = (p) => (p === 'a' ? A : p === 'x' ? X : p === 'y' ? Y : recent.get(p) ?? null);\n        const lo = val(P.ptr[0]), hi = val(P.ptr[1]);\n        if (lo?.v == null || hi?.v == null) return;\n        if (typeof P.ptr[0] === 'string' && typeof P.ptr[1] === 'string') { if (lo.src == null || hi.src == null) return; pair(-1, lo, hi); }\n        addString(((lo.v | (hi.v << 8)) + P.offset) & 0xffff, { len: lenOf(P.lenAt != null ? val(P.lenAt)?.v : P.len, P.offset), end: P.end, by: strs.handedText(P, pc) });\n      };\n",
      },
      {
        find: "        case 'LDA': A = mode === 'imm' ? { v: d.v, src: pc } : (idxOf() ? { v: null, idx: idxOf() } : null); break;\n",
        replace: "        case 'LDA': {\n          A = mode === 'imm' ? { v: d.v, src: pc } : (idxOf() ? { v: null, idx: idxOf() } : null);\n          const lo = mode === 'izy' ? recent.get(d.v) : undefined, hi = mode === 'izy' ? recent.get((d.v + 1) & 0xff) : undefined, from = index('y');\n          const loop = lo?.v != null && hi?.v != null && from != null ? strs.printLoop({ mem, insLen, skip }, pc) : null;\n          if (loop) addString(((lo.v | (hi.v << 8)) + from) & 0xffff, { len: lenOf(loop.len ?? (loop.lenAt != null ? recent.get(loop.lenAt)?.v : null), from), end: loop.end, by: `printed through ${strs.CHAR_OUT.get(mem[loop.out + 1] | (mem[loop.out + 2] << 8))} from ${$4(loop.out)}` });\n          break;\n        }\n",
      },
      { find: '              if (hi && hi.src !== R.src) pair(dest, R, hi);\n            }\n', replace: '              if (hi && hi.src !== R.src) pair(dest, R, hi);\n            } else recent.delete(dest);\n' },
      {
        find: "          const t = d.target;\n          if (t === 0xffd2 && A && A.idx) evTag(A.idx.t, 'petscii');\n          if (t === 0xab1e && A && A.v != null && A.src != null && Y && Y.v != null && Y.src != null) {\n            pair(-1, A, Y); const v = A.v | (Y.v << 8); if (loaded(v)) { textPtrs.set(v, 'petscii'); ptrTargets.delete(v); }\n          }\n          if (t === 0xffbd && X && X.v != null && X.src != null && Y && Y.v != null && Y.src != null) {\n            pair(-1, X, Y); const v = X.v | (Y.v << 8); if (loaded(v)) { textPtrs.set(v, 'petscii'); ptrTargets.delete(v); }\n          }\n          A = X = Y = null; break;\n        }\n",
        replace: "          const t = d.target;\n          if (strs.CHAR_OUT.has(t) && A && A.idx) {\n            const { t: tab, pc: at, from } = A.idx;\n            evTag(tab, 'petscii');\n            const loop = strs.printLoop({ mem, insLen, skip }, at);\n            const len = from != null ? lenOf(loop?.len ?? (loop?.lenAt != null ? recent.get(loop.lenAt)?.v : null), from) : undefined;\n            if (loop && (len != null || loop.end)) addString((tab + (from ?? 0)) & 0xffff, { len, end: loop.end, by: `printed through ${strs.CHAR_OUT.get(t)} from ${$4(pc)}` });\n          }\n          handOver(t);\n          A = X = Y = null; break;\n        }\n        case 'JMP': if (mode === 'abs') handOver(d.target); break;\n",
      },
      {
        find: '  const smooth = (s, n) => {\n',
        replace: "  const printable = (b) => (b >= 0x20 && b < 0x80) || b >= 0xa0 || PET_CTRL.has(b);\n  const handedLen = (s, e, str) => {\n    const n = strs.stringLen(mem, s, e - s, str);\n    if (n == null || (str.end && n < 2 && str.end.includes(mem[s]))) return null;\n    let ok = 0; for (let i = 0; i < n; i++) if (printable(mem[s + i]) || str.end?.includes(mem[s + i])) ok++;\n    return ok >= n * 0.8 ? n : null;\n  };\n  const carry = new Map();\n  const dataEnd = (s, e) => { while (e < 0x10000 && tm[e] === T.DATA && ov[e] !== T.DATA && owner[e] === owner[s]) e++; return e; };\n  const smooth = (s, n) => {\n",
      },
      {
        find: "    const enc = textPtrs.get(s) || (ev.has('petscii') ? 'petscii' : ev.has('screen') ? 'screen' : null);\n    if (isObj && enc && S.detectText) {\n      const n = textLen(s, e, enc);\n      if (n >= 2) { pushBlock(s, s + n, T.TEXT, { enc }, 0.9, enc === 'petscii' ? 'printed through KERNAL/BASIC output' : 'copied to screen memory'); classifySpan(s + n, e, false); return; }\n    }\n",
        replace: "    const str = isObj ? strings.get(s) : undefined, cont = isObj && !str ? carry.get(s) : undefined;\n    const enc = textPtrs.get(s) || (ev.has('petscii') ? 'petscii' : ev.has('screen') ? 'screen' : null) || (cont ? 'petscii' : null);\n    if (isObj && enc && S.detectText) {\n      const far = str ? dataEnd(s, e) : e, sn = str ? handedLen(s, far, str) : cont ? cont.left : null;\n      const full = sn ?? textLen(s, far, enc), n = Math.min(full, e - s);\n      if (full >= (sn != null ? 1 : 2)) {\n        if ((str || cont) && full > n) carry.set(e, { left: full - n, from: cont ? cont.from : s });\n        const why = cont ? `the rest of the string at ${$4(cont.from)}` : str ? str.by + (str.len != null && sn != null ? `, ${sn} byte${sn === 1 ? '' : 's'}` : '') : enc === 'petscii' ? 'printed through KERNAL/BASIC output' : 'copied to screen memory';\n        pushBlock(s, s + n, T.TEXT, { enc }, 0.9, why); classifySpan(s + n, e, false); return;\n      }\n    }\n",
      },
      {
        find: "  const kindPrefix = { entry: 'entry', irq: 'irq', nmi: 'nmi', brk: 'brk', user: 'code', sub: 'sub', ptr: 'fx' };\n",
        replace: "  const kindPrefix = { entry: 'entry', irq: 'irq', nmi: 'nmi', brk: 'brk', user: 'code', sub: 'sub', ptr: 'fx' };\n  for (const [a, P] of printersFound) { const k = entryKind.get(a); if (insLen[a] && k === 'sub' && a !== entry) setLabel(a, `${P.kind === 'name' ? 'setnam' : 'print'}_${h4(a)}`, k); }\n",
      },
    ],
  },
  {
    why: 'The case printed text is in (spec 5.5c): a string handed to a print routine or printed through CHROUT was always `petscii_upper`, so in a program that switches to the lower case characters "Abyss" ($c1 $42 $59 ...) came out as `.byte $c1` and "BYSS". Now a string is `petscii_mixed` when it shows it (a $0e in it, or a word that starts with a capital: a shifted letter and two plain ones), `petscii_upper` when it has a $8e, and otherwise in the case the program prints in: mixed when it switches to the lower case characters ($0e sent to CHROUT, $0e in a printed string, $d018 = $x6/$x7, `ora #$02` into $d018) and never away from them ($8e, $d018 = $x4/$x5, a $d018 value with characters of its own); the log says so (production code, `strs`). The prototype\'s text rows know only petscii_upper and screencode_upper: mixed case rows as c64/text.ts writes them',
    edits: [
      { find: 'smc, strings, printersFound = new Map();\n', replace: 'smc, strings, printersFound = new Map(), cases = [];\n' },
      { find: 'strings = new Map(); printersFound = new Map();\n    const starts = [];', replace: 'strings = new Map(); printersFound = new Map(); cases = [];\n    const starts = [];' },
      { find: '      const handOver = (t) => {\n        const P = printer(t);\n', replace: '      const handOver = (t) => {\n        const sw = strs.sentCase(A?.v, t, pc);\n        if (sw) cases.push(sw);\n        const P = printer(t);\n' },
      {
        find: "        if ((str || cont) && full > n) carry.set(e, { left: full - n, from: cont ? cont.from : s });\n        const why = cont ? `the rest of the string at ${$4(cont.from)}` : str ? str.by + (str.len != null && sn != null ? `, ${sn} byte${sn === 1 ? '' : 's'}` : '') : enc === 'petscii' ? 'printed through KERNAL/BASIC output' : 'copied to screen memory';\n        pushBlock(s, s + n, T.TEXT, { enc }, 0.9, why);",
        replace: "        const cs = enc !== 'petscii' ? null : cont ? cont.cs : caseOf(mem.subarray(s, s + full));\n        if ((str || cont) && full > n) carry.set(e, { left: full - n, from: cont ? cont.from : s, cs });\n        const why = cont ? `the rest of the string at ${$4(cont.from)}` : (str ? str.by + (str.len != null && sn != null ? `, ${sn} byte${sn === 1 ? '' : 's'}` : '') : enc === 'petscii' ? 'printed through KERNAL/BASIC output' : 'copied to screen memory') + (cs ? cs.why : '');\n        pushBlock(s, s + n, T.TEXT, { enc: cs ? cs.enc : enc }, 0.9, why);",
      },
      {
        find: "  // walk the map\n  const routineKinds = new Set(['entry', 'irq', 'nmi', 'brk', 'user', 'sub', 'ptr']);\n",
        replace: "  const switches = [...cases];\n  for (const w of writes) { if (w.dest !== 0xd018 || w.indexed) continue; const c = strs.d018Case(mem, insLen, w.pc, w.v, true); if (c) switches.push(c); }\n  for (const [s, str] of strings) { const n = handedLen(s, dataEnd(s, s), str); const c = n ? strs.stringSwitch(mem.subarray(s, s + n), s) : null; if (c) switches.push(c); }\n  const caseOf = strs.printCase(switches.sort((x, y) => x.at - y.at), L);\n  // walk the map\n  const routineKinds = new Set(['entry', 'irq', 'nmi', 'brk', 'user', 'sub', 'ptr']);\n",
      },
      {
        find: "    const ok = enc === 'petscii' ? (b => b >= 0x20 && b <= 0x5d && b !== 0x22 && b !== 0x5c) : (b => (b >= 0x01 && b <= 0x1a) || b === 0x1b || b === 0x1d || (b >= 0x20 && b <= 0x3f && b !== 0x22));\n    const ch = enc === 'petscii' ? (b => String.fromCharCode(b)) : (b => b <= 0x1d ? String.fromCharCode(b + 0x40) : String.fromCharCode(b));\n    out.push({ k: 'dir', a: s, n: 0, tok: [{ t: 'dir', s: '.encoding' }, { t: 'p', s: ' ' }, { t: 'str', s: enc === 'petscii' ? '\"petscii_upper\"' : '\"screencode_upper\"' }] });\n",
        replace: "    const mixed = enc === 'petscii-mixed', mixedCh = b => b >= 0x41 && b <= 0x5a ? String.fromCharCode(b + 0x20) : b >= 0xc1 && b <= 0xda ? String.fromCharCode(b - 0x80) : String.fromCharCode(b);\n    const ok = mixed ? (b => (b >= 0x20 && b <= 0x5d && b !== 0x22 && b !== 0x5c) || (b >= 0xc1 && b <= 0xda)) : enc === 'petscii' ? (b => b >= 0x20 && b <= 0x5d && b !== 0x22 && b !== 0x5c) : (b => (b >= 0x01 && b <= 0x1a) || b === 0x1b || b === 0x1d || (b >= 0x20 && b <= 0x3f && b !== 0x22));\n    const ch = mixed ? mixedCh : enc === 'petscii' ? (b => String.fromCharCode(b)) : (b => b <= 0x1d ? String.fromCharCode(b + 0x40) : String.fromCharCode(b));\n    out.push({ k: 'dir', a: s, n: 0, tok: [{ t: 'dir', s: '.encoding' }, { t: 'p', s: ' ' }, { t: 'str', s: mixed ? '\"petscii_mixed\"' : enc === 'petscii' ? '\"petscii_upper\"' : '\"screencode_upper\"' }] });\n",
      },
      {
        find: "        const c = enc === 'petscii' ? [...mem.subarray(p, q)].map(b => names[b])",
        replace: "        const c = enc === 'petscii' || mixed ? [...mem.subarray(p, q)].map(b => names[b])",
      },
      { find: "t += p.enc === 'screen' ? ' (screen codes)' : ' (PETSCII)';", replace: "t += p.enc === 'screen' ? ' (screen codes)' : p.enc === 'petscii-mixed' ? ' (PETSCII, mixed case)' : ' (PETSCII)';" },
    ],
  },
  {
    why: 'A routine that prints the string after the JSR to it (spec 5.5b; the Fairlight cartridge\'s `jsr $8604 / .text "FILENAME PLEASE: " / .byte 0`) stopped the trace with "inline data follows", or, as it keeps Y before it pulls its return address (`sty $24 / pla / sta $22 / pla`), was not seen at all and its string was decoded as code. A routine that pulls its return address after up to three stores reads the bytes after the JSR; when it prints them (found by production code, `strs`, also where the character is printed on a branch\'s side), the string is text and the code goes on after it',
    edits: [
      {
        find: "          if (loaded(t) && mem[t] === 0x68 && mem[(t + 1) & 0xffff] === 0x85 && mem[(t + 3) & 0xffff] === 0x68) {\n            inlineCalls.add(pc);\n            L('warn', `JSR ${$4(t)} pops its return address; inline data follows ${$4(next)}`, pc, 'code');\n            break;\n          }\n",
        replace: "          if (loaded(t) && strs.popsReturn(mem, t)) {\n            inlineCalls.add(pc);\n            const str = strs.inlineString({ mem, insLen, skip, owner }, pc, t);\n            if (str) { L('ok', `JSR ${$4(t)} prints the string after it (${$4(str.s)}-${$4(str.s + str.n - 1)}); the code goes on at ${$4(str.s + str.n)}`, pc, 'code'); enqueue(str.s + str.n, 'jmp'); }\n            else L('warn', `JSR ${$4(t)} pops its return address; inline data follows ${$4(next)}`, pc, 'code');\n            break;\n          }\n",
      },
      {
        find: "        if (!P) return;\n        const val = (p) => (p === 'a' ? A",
        replace: "        if (!P) return;\n        if (P.ptr === 'after') { if (mn === 'JSR' && inlineCalls.has(pc)) addString((pc + 2 + P.offset) & 0xffff, { len: lenOf(P.len, P.offset), end: P.end, by: strs.handedText(P, pc) }); return; }\n        const val = (p) => (p === 'a' ? A",
      },
      {
        find: "    if (A.inlineCalls.has(pc)) cm.push('inline data follows');\n",
        replace: "    if (A.inlineCalls.has(pc)) { const tb = A.blockAt((pc + 3) & 0xffff); cm.push(tb && tb.type === T.TEXT && tb.reason.endsWith(` from ${$4(pc)}`) ? 'prints the string after it' : 'inline data follows'); }\n",
      },
    ],
  },
  {
    why: 'A routine that pulls its return address before any branch or call and puts it back further on (`pla / clc / adc #2 / tax / pla / adc #0 / pha / txa / pha`, the Fairlight cartridge\'s call into another bank, `jsr $8eca / .word $801e`) had its bytes after the JSR decoded as code ("Jump into the middle of the instruction at $80de"); it reads the bytes in between, and the code goes on after them (found by production code, `strs`). A routine that hands on to one that prints the string after the JSR (`jsr setcursor / jmp print`) prints it too',
    edits: [{
      find: "          if (loaded(t) && strs.popsReturn(mem, t)) {\n            inlineCalls.add(pc);\n            const str = strs.inlineString({ mem, insLen, skip, owner }, pc, t);\n            if (str) { L('ok', `JSR ${$4(t)} prints the string after it (${$4(str.s)}-${$4(str.s + str.n - 1)}); the code goes on at ${$4(str.s + str.n)}`, pc, 'code'); enqueue(str.s + str.n, 'jmp'); }\n            else L('warn', `JSR ${$4(t)} pops its return address; inline data follows ${$4(next)}`, pc, 'code');\n            break;\n          }\n",
      replace: "          const after = loaded(t) ? strs.inlineAfter({ mem, insLen, skip, owner }, pc, t) : null;\n          if (after) {\n            inlineCalls.add(pc);\n            if (after === 'unknown') L('warn', `JSR ${$4(t)} pops its return address; inline data follows ${$4(next)}`, pc, 'code');\n            else { const on = after.s + after.n, range = `${$4(after.s)}${after.n > 1 ? `-${$4(on - 1)}` : ''}`; L('ok', `JSR ${$4(t)} ${after.string ? 'prints the string' : `reads the ${after.n} byte${after.n === 1 ? '' : 's'}`} after it (${range}); the code goes on at ${$4(on)}`, pc, 'code'); enqueue(on, 'jmp'); }\n            break;\n          }\n",
    }],
  },
  {
    why: 'Code that draws into a bitmap (The Lab, at $6000) gave every address it reads or writes there a label of its own (`bitmap_6148`), and each one cut the picture in the listing. Inside a bitmap there are no such labels: the code counts from the label before the address, however far (`bitmap_6000+328`)',
    edits: [
      {
        find: "    if (!loaded(addr) || tm[addr] === T.MUSIC || codeOwner[addr] >= 0) continue;\n    setLabel(addr, dataName(addr), 'data');",
        replace: "    if (!loaded(addr) || tm[addr] === T.MUSIC || codeOwner[addr] >= 0) continue;\n    const bb = blockAt(addr);\n    if (bb && bb.type === T.BITMAP && addr !== bb.start) continue;\n    setLabel(addr, dataName(addr), 'data');",
      },
      { find: 'if (b) for (let p = a - 1; p >= b.start && a - p < 256; p--) {', replace: 'if (b) for (let p = a - 1; p >= b.start && (a - p < 256 || b.type === T.BITMAP); p--) {' },
    ],
  },
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ReferenceKR = any;

let cached: ReferenceKR | null = null;

export function loadReference(): ReferenceKR {
  if (cached) return cached;
  let src = readFileSync(fileURLToPath(new URL('../reference/core.prototype.cjs', import.meta.url)), 'utf8').replace(/\r\n/g, '\n');
  for (const d of DEVIATIONS) for (const e of d.edits) {
    const n = src.split(e.find).length - 1;
    if (n !== 1) throw new Error(`reference patch must match exactly once (matched ${n}): ${d.why}`);
    src = src.replace(e.find, () => e.replace);
  }
  // The prototype is an IIFE that installs itself on `window` or `globalThis`: hand it a private root
  // (same realm, so typed arrays and Maps compare normally), the production music detection and print routines.
  const root: { KR?: ReferenceKR } = {};
  new Function('window', 'globalThis', 'detectMusic', 'strs', src)(undefined, root, detectMusic, { printers, printLoop, handedText, CHAR_OUT, stringLen, sentCase, d018Case, stringSwitch, printCase, popsReturn, inlineString, inlineAfter });
  cached = root.KR;
  return cached;
}
