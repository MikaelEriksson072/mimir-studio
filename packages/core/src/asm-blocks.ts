/* =====================================================================
 * Blocks in an Assembler project's sources (spec 10.7). What the sources make counts as code, the BASIC line it starts
 * with as BASIC, except the bytes of a block marked in a comment: sprites, a charset, a bitmap, a screen, music, text
 * or data, which Graphics, Memory, the inspector and the Explorer then show as what they are. A block is the lines
 * between `// @block <kind>` (`; @block` in 64tass) and `// @end`; after the kind the marker says how it is drawn
 * (multicolor, hires) or played (init=$1000 play=$1003).
 *
 * asmBlockText writes a new block (Insert block in the Assembler): its bytes as .byte lines formatted as the kind is
 * drawn (a sprite's 21 rows of 3 bytes in binary, a char a line, a screen row a line), or a file of the project the
 * source imports, put where the caret is (aligned as the VIC needs it) or at an address.
 * ===================================================================== */
import type { Addr, AnalysisResult, BlockKind, OverrideProps, ProjectInput, ScriptLang, TextEncoding, Vfs } from './types';
import { render } from './render/kick';
import { isTass } from './render/dialect';
import type { AsmProblem } from './asm-project';
import type { LibraryKind } from './library';
import { OPC } from './cpu/opcodes';
import { langIs } from './code-lang';
import { parsePsid } from './c64/psid';
import { pictureData, pictureFormatOf, readPicture } from './c64/pictures';
import { h2, h4 } from './util/hex';

/** the kinds Insert block makes */
export type AsmBlockKind = 'sprite' | 'charset' | 'bitmap' | 'screen' | 'music' | 'data';
export const ASM_BLOCK_KINDS: readonly AsmBlockKind[] = ['sprite', 'charset', 'bitmap', 'screen', 'music', 'data'];

export interface AsmBlockInfo {
  label: string;
  /** what a new one is aligned to where the caret is (the VIC sees sprites at 64, a charset at 2 KB, a bitmap at 8 KB) */
  align: number;
  /** the bytes of one (a sprite, a char, a bitmap, a screen); 1: any number */
  unit: number;
  /** the folder of the project a file of it goes in, and the file's extension */
  folder: string;
  ext: string;
  /** the library's kind of it (null: the library has none) */
  library: LibraryKind | null;
  /** it can be multicolour */
  mc: boolean;
}
export const ASM_BLOCK_INFO: Record<AsmBlockKind, AsmBlockInfo> = {
  sprite: { label: 'Sprites', align: 64, unit: 64, folder: 'sprites', ext: 'spr', library: 'sprites', mc: true },
  charset: { label: 'Charset', align: 0x800, unit: 8, folder: 'charsets', ext: 'bin', library: 'chars', mc: true },
  bitmap: { label: 'Bitmap', align: 0x2000, unit: 8000, folder: 'bitmaps', ext: 'bin', library: 'bitmaps', mc: true },
  screen: { label: 'Screen', align: 0x400, unit: 1000, folder: 'screens', ext: 'bin', library: null, mc: false },
  music: { label: 'Music', align: 1, unit: 1, folder: 'music', ext: 'sid', library: 'sid', mc: false },
  data: { label: 'Data', align: 1, unit: 1, folder: 'data', ext: 'bin', library: null, mc: false },
};

/* ---- the marks ---- */

/** a block marked in a source: the line of its `@block` and of its `@end` (a block without one: the line after the
 *  file's last), what it is and how it is drawn or played */
export interface AsmBlockMark { file: string; line: number; end: number; kind: BlockKind; props: OverrideProps }

const BEGIN = /^\s*(?:\/\/|;)\s*@block\b\s*([A-Za-z-]*)(.*)$/;
const END = /^\s*(?:\/\/|;)\s*@end\b/;
/** the words a marker takes for each kind */
const MARK_KINDS: Record<string, BlockKind> = {
  sprite: 'sprite', sprites: 'sprite', charset: 'charset', chars: 'charset', char: 'charset', font: 'charset',
  bitmap: 'bitmap', screen: 'screen', music: 'music', sid: 'music', data: 'data', bytes: 'data', text: 'text',
  words: 'words', table: 'table', fill: 'fill',
};
export const ASM_MARK_WORDS = Object.keys(MARK_KINDS);
const ENCS: Record<string, TextEncoding> = { petscii: 'petscii', screen: 'screen', 'petscii-mixed': 'petscii-mixed', 'screen-mixed': 'screen-mixed', screencodes: 'screen' };

const num = (s: string): number | null => {
  const m = s.match(/^(?:\$|0x)([0-9a-f]{1,4})$/i) ?? null;
  const v = m ? parseInt(m[1], 16) : /^\d{1,5}$/.test(s) ? Number(s) : NaN;
  return Number.isInteger(v) && v >= 0 && v <= 0xffff ? v : null;
};

/** The blocks marked in the sources, and what in the marks is not understood (said on its line; the rest is still read). */
export function asmBlockMarks(files: readonly { path: string; text: string }[]): { marks: AsmBlockMark[]; warnings: AsmProblem[] } {
  const marks: AsmBlockMark[] = [], warnings: AsmProblem[] = [];
  for (const f of files) {
    const lines = f.text.split(/\r?\n/);
    let open: AsmBlockMark | null = null;
    const close = (end: number) => { if (open) { open.end = end; marks.push(open); open = null; } };
    lines.forEach((t, i) => {
      const n = i + 1;
      if (END.test(t)) { if (open) close(n); else warnings.push({ file: f.path, line: n, msg: '@end without a @block before it' }); return; }
      const m = t.match(BEGIN);
      if (!m) return;
      if (open) { warnings.push({ file: f.path, line: n, msg: `a @block before the @end of the one on line ${(open as AsmBlockMark).line}: that one ends here` }); close(n); }
      const word = m[1].toLowerCase(), kind = MARK_KINDS[word];
      if (!kind) warnings.push({ file: f.path, line: n, msg: `@block ${m[1] || '(no kind)'}: not a kind of block (${ASM_BLOCK_KINDS.join(', ')}, text, words, table, fill); its bytes are data` });
      const props: OverrideProps = {};
      for (const a of m[2].trim().split(/[\s,]+/).filter(Boolean)) {
        const w = a.toLowerCase(), kv = w.match(/^(init|play)=(.+)$/);
        if (/^(multicolou?r|mc)$/.test(w)) props.mc = true;
        else if (w === 'hires') props.mc = false;
        else if (kv) { const v = num(kv[2]); if (v != null) props[kv[1] as 'init' | 'play'] = v; else warnings.push({ file: f.path, line: n, msg: `@block: ${a} is not an address` }); }
        else if (ENCS[w]) props.enc = ENCS[w];
        else if (w.startsWith('//') || w.startsWith(';')) break;
        else { warnings.push({ file: f.path, line: n, msg: `@block: "${a}" is not understood (multicolor, hires, init=$xxxx, play=$xxxx, petscii, screen)` }); break; }
      }
      open = { file: f.path, line: n, end: lines.length + 1, kind: kind ?? 'data', props };
    });
    close(lines.length + 1);
  }
  return { marks, warnings };
}

/** the block a line of a file is in (between its marks), or null */
export function asmMarkAt(marks: readonly AsmBlockMark[], file: string, line: number): AsmBlockMark | null {
  return marks.find(m => m.file === file && line > m.line && line < m.end) ?? null;
}

/* ---- a new block's lines ---- */

export interface AsmBlockRequest {
  kind: AsmBlockKind;
  lang: ScriptLang;
  /** the label of its first byte (a SID read with LoadSid: the variable's name) */
  name: string;
  /** its bytes: sprites (64 each), a charset (8 a char), a bitmap (8000), a picture (`picture`: as pictureData has it,
   *  the bitmap, its screen, its colours and the background), a screen, a .sid file whole, data */
  bytes: Uint8Array;
  picture?: boolean;
  /** drawn multicolour (null: not said) */
  mc?: boolean | null;
  /** where: null at the caret, aligned as the kind needs; an address: from there (music: its load address always) */
  at: Addr | null;
  /** imported from a file of the project (its path from the source's folder, the bytes from `offset` in it) in place of
   *  .byte lines */
  file?: { path: string; offset?: number } | null;
}

/** the lines of a new block, and the one of its label (from 0: where the caret goes) */
export interface AsmBlockText { text: string; labelLine: number }

/** A name a label can have in both assemblers: letters, digits and _, not a digit first, not a mnemonic or register. */
export function asmLabel(s: string, fallback = 'block'): string {
  let t = s.normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\w]+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
  if (!t) t = fallback;
  if (/^\d/.test(t)) t = `_${t}`;
  if (/^[axy]$/i.test(t) || MNEMONICS.has(t.toUpperCase())) t = `${t}_`;
  return t.slice(0, 64);
}
const MNEMONICS = new Set(OPC.map(o => o.mn));

/** A label for a library item's name: what it was ("spr_2000" of "Comaland - file25 - spr_2000 ($2000-$203f)"). */
export function libraryLabel(name: string): string {
  const last = name.split(' - ').pop() ?? name;
  return asmLabel(last.replace(/\s*\(\$[0-9a-f]{4}-\$[0-9a-f]{4}\)\s*$/i, '') || name);
}

const bin8 = (v: number) => `%${v.toString(2).padStart(8, '0')}`;
const hex = (v: number) => `$${h2(v)}`;
const IN = '        ';

/** Write a new block (AsmBlockRequest) for its assembler. */
export function asmBlockText(r: AsmBlockRequest): AsmBlockText {
  const tass = langIs(r.lang) === '64tass', cm = tass ? ';' : '//';
  const info = ASM_BLOCK_INFO[r.kind], b = r.bytes, name = r.name;
  const out: string[] = [];
  let labelLine = -1;
  const label = (n: string) => { if (labelLine < 0) labelLine = out.length; out.push(tass ? n : `${n}:`); };
  const comment = (t: string, indent = IN) => out.push(`${indent}${cm} ${t}`);
  /** a line with a comment after it, in the comment column (two spaces at least before it) */
  const cmt = (line: string, t: string) => `${line.padEnd(Math.max(tass ? 40 : 48, line.length + 2))}${cm} ${t}`;
  const rows = (bytes: Uint8Array, per: number, fmt: (v: number) => string, note?: (i: number) => string) => {
    for (let i = 0; i < bytes.length; i += per) {
      const line = `${IN}.byte ${[...bytes.subarray(i, i + per)].map(fmt).join(', ')}`, n = note?.(i);
      out.push(n ? cmt(line, n) : line);
    }
  };
  const imported = (off: number, len: number | null, note: string) => {
    const f = r.file!, o = (f.offset ?? 0) + off, args = `"${f.path}"${o || len != null ? `, ${o}` : ''}${len != null ? `, ${len}` : ''}`;
    out.push(cmt(`${IN}${tass ? '.binary' : '.import binary'} ${args}`, note));
  };
  const where = (title: string) => {
    if (r.at != null) out.push(tass ? `${IN}* = $${h4(r.at)}` : `${IN}* = $${h4(r.at)} "${title}"`);
    else if (info.align > 1) out.push(`${IN}.align $${info.align.toString(16)}`);
  };
  const mark = (kind: string, extra = '') => out.push(`${cm} @block ${kind}${extra}`);
  const end = () => out.push(`${cm} @end`);
  const mcWord = r.mc == null ? '' : r.mc ? ' multicolor' : ' hires';
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

  switch (r.kind) {
    case 'sprite': {
      const n = Math.ceil(b.length / 64);
      where(name); mark('sprite', mcWord); label(name);
      if (r.file) imported(0, b.length, `${plural(n, 'sprite')}, 64 bytes each`);
      else for (let s = 0; s < n; s++) {
        const one = new Uint8Array(64); one.set(b.subarray(s * 64, s * 64 + 64));
        comment(`sprite ${s}${n > 1 ? ` of ${n}` : ''}: 24×21${r.mc ? ', multicolour' : ''}`);
        rows(one.subarray(0, 63), 3, bin8);
        rows(one.subarray(63), 1, hex, () => 'the 64th byte: not drawn');
      }
      end();
      break;
    }
    case 'charset': {
      where(name); mark('charset', mcWord); label(name);
      if (r.file) imported(0, b.length, `${plural(b.length >> 3, 'char')}, 8 bytes each`);
      else rows(b, 8, hex, i => `char $${h2(i >> 3)}`);
      end();
      break;
    }
    case 'bitmap': {
      const bitmap = b.subarray(0, 8000);
      where(name); mark('bitmap', mcWord); label(name);
      if (r.file) imported(0, bitmap.length, `the bitmap, ${bitmap.length} bytes`);
      else rows(bitmap, 8, hex, i => (i % 320 === 0 ? `row ${i / 320}` : ''));
      end();
      if (r.picture && b.length >= 9000) {
        // a picture: the screen (the colours of each 8×8 cell) and, multicolour, those of colour RAM, which the program
        // copies to $d800, and the background
        comment('its screen: the colours of each 8×8 cell (the VIC reads it where $d018 says, in the bitmap\'s bank)', '');
        mark('screen'); label(`${name}_screen`);
        if (r.file) imported(8000, 1000, 'the screen, 1000 bytes'); else rows(b.subarray(8000, 9000), 40, hex);
        end();
        if (r.mc !== false && b.length >= 10000) {
          comment('its colours: a program copies them to colour RAM at $d800', '');
          mark('data'); label(`${name}_colors`);
          if (r.file) imported(9000, 1000, 'the colours, 1000 bytes'); else rows(b.subarray(9000, 10000), 40, hex);
          end();
          const bg = (b[10000] ?? 0) & 0x0f;
          out.push(cmt(tass ? `${name}_bg = ${hex(bg)}` : `.const ${name}_bg = ${hex(bg)}`, 'its background colour ($d021)'));
        }
      }
      break;
    }
    case 'screen': {
      where(name); mark('screen'); label(name);
      if (r.file) imported(0, b.length, `${b.length} bytes`); else rows(b, 40, hex, i => (b.length > 40 ? `row ${i / 40}` : ''));
      end();
      break;
    }
    case 'music': {
      const s = parsePsid(b), at = `init=$${h4(s.init)}${s.play ? ` play=$${h4(s.play)}` : ''}`;
      const what = `${s.name || 'music'}${s.author && s.author !== '<?>' ? ` by ${s.author}` : ''}`.replace(/[^\x20-\x7e]/g, '?');
      if (r.file && !tass) {
        // Kick Assembler reads the .sid itself: where it goes, init and play are the variable's
        out.push(cmt(`${IN}.var ${name} = LoadSid("${r.file.path}")`, `${what}: jsr ${name}.init, jsr ${name}.play`));
        out.push(`${IN}* = ${name}.location "${name}"`);
        mark('music', ` ${at}`);
        out.push(`${IN}.fill ${name}.size, ${name}.getData(i)`);
        end();
        labelLine = 0;
        break;
      }
      const def = (n: string, v: Addr, note: string) => out.push(cmt(tass ? `${n} = $${h4(v)}` : `.label ${n} = $${h4(v)}`, note));
      def(`${name}_init`, s.init, `${what}: jsr ${name}_init starts it (the song in A)`);
      if (s.play) def(`${name}_play`, s.play, 'and jsr ' + `${name}_play once a frame plays it`);
      out.push(tass ? `${IN}* = $${h4(s.location)}` : `${IN}* = $${h4(s.location)} "${name}"`);
      mark('music', ` ${at}`); label(name);
      if (r.file) {
        // (the bytes after the .sid's header and the load address)
        const be = (o: number) => (b[o] << 8) | b[o + 1];
        const off = be(6) + (be(8) === 0 ? 2 : 0);
        imported(off, null, `${s.size} bytes at $${h4(s.location)}-$${h4(s.location + s.size - 1)}`);
      } else rows(s.data, 16, hex);
      end();
      break;
    }
    case 'data': {
      where(name); mark('data'); label(name);
      if (r.file) imported(0, b.length, `${b.length} bytes`); else rows(b, 8, hex);
      end();
      break;
    }
  }
  return { text: `${out.join('\n')}\n`, labelLine: Math.max(0, labelLine) };
}

/* ---- the bytes of a file picked for a block ---- */

/** What a block of `kind` takes from a file's bytes (its name says its format): the block's bytes, where in the file they
 *  start (after a load address), and what a picture or a .sid says of them; or why it cannot be one. */
export function asmBlockBytes(kind: AsmBlockKind, fileName: string, bytes: Uint8Array): { bytes: Uint8Array; offset: number; picture?: boolean; mc?: boolean; koala?: boolean } | { problem: string } {
  if (!bytes.length) return { problem: `${fileName} is empty` };
  const prg = /\.prg$/i.test(fileName);
  const skip = (unit: number) => (prg || /\.64c$/i.test(fileName) || (unit > 1 && bytes.length > 2 && bytes.length % unit === 2) ? 2 : 0);
  switch (kind) {
    case 'music': {
      try { parsePsid(bytes); } catch { return { problem: `${fileName} is not a PSID or RSID file` }; }
      return { bytes, offset: 0 };
    }
    case 'bitmap': {
      const f = pictureFormatOf(fileName);
      if (f) {
        const p = readPicture(f, bytes);
        if ('problem' in p) return { problem: `${fileName}: ${p.problem}` };
        return { bytes: pictureData(p), offset: f === 'koala' ? 2 : 0, picture: true, mc: p.mc, koala: f === 'koala' };
      }
      const o = skip(8000);
      if (bytes.length - o < 8000) return { problem: `${fileName} has ${bytes.length - o} bytes: a bitmap is 8000 (or a picture: Koala, Advanced Art Studio, Art Studio or Doodle)` };
      return { bytes: bytes.slice(o, o + 8000), offset: o };
    }
    default: {
      const unit = ASM_BLOCK_INFO[kind].unit, o = skip(unit);
      if (bytes.length - o > 0x10000) return { problem: `${fileName} has more bytes than a C64 holds` };
      if (bytes.length <= o) return { problem: `${fileName} has no bytes after its load address` };
      return { bytes: bytes.slice(o), offset: o };
    }
  }
}

/* ---- an Assembler project of a re-assembled program ---- */

/** What an Assembler project made of a re-assembled program has (`assemblerSources`): the source of each file with its
 *  blocks marked, the binary files they load and the include, the main file (the file the program starts in), the
 *  language, and how many blocks are marked */
export interface AssemblerSources { files: Vfs; main: string; lang: ScriptLang; blocks: number; sources: string[] }

/**
 * The project's program as an Assembler project's sources (Continue in the Assembler, spec 10.7): the re-assembled
 * source with every block the analysis found (or the user marked) that is not code between `@block` and `@end`, so the
 * Assembler shows them as what they are and the rest as code. The main file is the source of the file the program
 * starts in (its entry), else the first. A cartridge's sources build an image, not a program the Assembler runs.
 */
export function assemblerSources(A: AnalysisResult, project: ProjectInput): AssemblerSources {
  if (project.cart) throw new Error('A cartridge\'s sources build its image (a .crt): the Assembler builds and runs programs');
  if (!A.files.length) throw new Error('The project has no program to continue with');
  const R = render(A, project, { blockMarks: true });
  const at = A.entry != null ? A.owner[A.entry] : -1, main = `${R.fileNames[at >= 0 ? at : 0]}.asm`;
  const sources = R.fileNames.map(n => `${n}.asm`);
  let blocks = 0;
  for (const n of sources) { const t = R.files[n]; if (typeof t === 'string') blocks += asmBlockMarks([{ path: n, text: t }]).marks.length; }
  return { files: R.files, main, lang: isTass(project.settings) ? '64tass' : 'kickass', blocks, sources };
}
