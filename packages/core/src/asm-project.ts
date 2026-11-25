/* =====================================================================
 * The Assembler (spec 10.7): a folder of Kick Assembler or 64tass sources written in Mimir as a script is (10.3),
 * checked as it is typed with Mimir's own assembler, built with KickAss.jar or 64tass and started in VICE, and
 * debugged a step at a time in Mimir's 6510. What the folder's files are to it (sources, data a source loads), which
 * file is the main one (the one built), the check of the whole program and a debugger's run of it.
 * ===================================================================== */
import type { Addr, AssembleResult, LoadedFile, Override, ScriptLang, Vfs } from './types';
import type { AsmBlockMark } from './asm-blocks';
import { assembleIn, langIs } from './code-lang';
import { guessAssembler } from './render/dialect';
import { parseBasic } from './c64/basic';
import { importPath } from './verify/kick-subset-assembler';
import { maskRanges, ScriptMachine, SCRIPT_LIMIT, type ScriptCheck, type ScriptRange, type ScriptRun, type StackEntry } from './script';
import { SCREEN_C64, SCREEN_ROUTINES, type ScreenSize } from './script-screen';
import { h4 } from './util/hex';

/** a source of either assembler, by its file's name */
export const ASM_SOURCE = /\.(asm|s|inc|a|i|src|tas|a65|lib|65s|asm65)$/i;
/** a file the Assembler opens as text: the sources and the text beside them (a note, a script that builds the disk) */
export const ASM_TEXT = /(\.(asm|s|inc|a|i|src|tas|a65|lib|65s|asm65|txt|md|sym|vs|dbg|cfg|ini|json|xml|bat|cmd|sh|ps1|js|py|lua|gitignore|gitattributes)|(^|[\\/])(readme|makefile|license))$/i;

/** the folder part of a path (`lib/macros.asm` → `lib/`), '' at the top */
const folderOf = (path: string): string => { const i = path.lastIndexOf('/'); return i < 0 ? '' : path.slice(0, i + 1); };
/** a path made plain: `/` between its parts, without `.` and with `..` taken back */
const plain = (path: string): string => path.replace(/\\/g, '/').split('/').reduce<string[]>((out, p) => {
  if (p === '..' && out.length && out[out.length - 1] !== '..') out.pop(); else if (p && p !== '.') out.push(p);
  return out;
}, []).join('/');

/** the sources a source imports (#import, #importonce's file, .import source, 64tass .include), as the assembler finds
 *  them among `paths` (from the importing file's folder first) */
export function importsOf(path: string, text: string, paths: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/^\s*(?:[A-Za-z_]\w*\s*:\s*)?(?:#import(?:once)?|\.import\s+source|\.include)\s+"([^"]+)"/gm)) {
    const near = plain(folderOf(path) + m[1]), as = plain(m[1]);
    if (paths.has(near)) out.push(near); else if (paths.has(as)) out.push(as);
  }
  return out;
}

/** The files the sources name in quotes that the folder has and are not text (LoadSid, .import binary, LoadBinary,
 *  LoadPicture, 64tass's .binary): the data a check has to read. Each path from the naming file's folder first. */
export function dataFiles(sources: readonly { path: string; text: string }[], paths: ReadonlySet<string>): string[] {
  const out = new Set<string>();
  for (const s of sources) for (const m of s.text.matchAll(/"([^"\r\n]+\.[A-Za-z0-9]{1,8})"/g)) {
    const near = plain(folderOf(s.path) + m[1]), as = plain(m[1]);
    const p = paths.has(near) ? near : paths.has(as) ? as : null;
    if (p && !ASM_TEXT.test(p)) out.add(p);
  }
  return [...out];
}

/** a source that starts a program: a BASIC line made for it, or a program counter set */
const STARTS = /^\s*(?:BasicUpstart2?\s*\(|\*\s*=|\.pc\s*=|\.org\b)/m;

/**
 * The main file of a folder of sources, the one built and started: of the sources no other one imports, one that
 * starts a program (BasicUpstart, `* =`, `.pc =`) first, then one called main, then the one nearest the folder's top,
 * then by name. null: the folder has no source.
 */
export function mainFile(files: readonly { path: string; text: string }[]): string | null {
  const sources = files.filter(f => ASM_SOURCE.test(f.path));
  if (!sources.length) return null;
  const paths = new Set(sources.map(f => f.path)), imported = new Set(sources.flatMap(f => importsOf(f.path, f.text, paths)));
  const depth = (p: string) => p.split('/').length;
  const score = (f: { path: string; text: string }) => (imported.has(f.path) ? 0 : 8) + (STARTS.test(f.text) ? 4 : 0) + (/^main\.\w+$/i.test(f.path.split('/').pop()!) ? 2 : 0);
  return [...sources].sort((a, b) => score(b) - score(a) || depth(a.path) - depth(b.path) || a.path.localeCompare(b.path))[0].path;
}

/**
 * The first source of a new folder (`main.asm`): a program that clears the screen, prints a line and returns to BASIC,
 * started with RUN from its BASIC line. Mimir's check, KickAss.jar and 64tass all assemble it, and a run in Mimir's
 * 6510 prints the line on its C64 screen.
 */
export function asmTemplate(lang: ScriptLang, name: string): string {
  const title = name.replace(/[^\x20-\x7e]/g, '?');
  if (langIs(lang) === '64tass') return `; ${title}: a C64 program, built with 64tass
; Run (Ctrl+Enter or F5) builds it and starts it in VICE; Debug (F8) goes through it in Mimir.

        * = $0801
        ; the BASIC line 2026 SYS 2061, which RUN starts the program with
        .byte $0b, $08, $ea, $07, $9e
        .text "2061"
        .byte 0, 0, 0

start   lda #0
        sta $d020       ; the border black
        sta $d021       ; and the background
        ldx #0
loop    lda message,x
        beq done
        jsr $ffd2       ; CHROUT: print a character
        inx
        bne loop
done    rts             ; back to BASIC

        ; (64tass -a makes PETSCII of the text: lower case letters are the C64's capitals)
message .byte $93, $05  ; clear the screen, white
        .text "hello from mimir!"
        .byte $0d, 0
`;
  return `// ${title}: a C64 program, built with Kick Assembler
// Run (Ctrl+Enter or F5) builds it and starts it in VICE; Debug (F8) goes through it in Mimir.

BasicUpstart2(start)            // the BASIC line RUN starts the program with

start:
        lda #0
        sta $d020               // the border black
        sta $d021               // and the background
        ldx #0
!loop:
        lda message,x
        beq !done+
        jsr $ffd2               // CHROUT: print a character
        inx
        bne !loop-
!done:
        rts                     // back to BASIC

        .encoding "petscii_upper"
message:
        .byte $93, $05          // clear the screen, white
        .text "HELLO FROM MIMIR!"
        .byte $0d, 0
`;
}

/** the assembler a folder's sources are written for: its main file's (guessAssembler) */
export const sourceLang = (text: string): ScriptLang => (guessAssembler(text) === '64tass' ? '64tass' : 'kickass');

/** a problem the check found, in the file and on the line it is on (0: none known) */
export interface AsmProblem { file: string; line: number; msg: string }

/** A program checked with Mimir's own assembler as it is typed: what is wrong by file and line, its bytes and where a run
 *  starts, its names, and what a debugger's run of it takes. */
export interface AsmCheck {
  /** it assembles and has code to run */
  ok: boolean;
  problems: AsmProblem[];
  /** where a run starts: the SYS of its BASIC line (BasicUpstart), else its start (or main) label, else its first byte */
  entry: Addr | null;
  entryFrom: 'basic' | 'label' | 'first' | null;
  /** the memory its bytes are in, and how many there are */
  ranges: ScriptRange[];
  bytes: number;
  /** its labels and constants that are numbers, by name (the editor suggests them, the hover says them) */
  names: Map<string, number>;
  /** whose line each byte's is: `fileOf[a]` - 1 is an index into `files` (0: no line) */
  files: string[];
  fileOf: Uint16Array;
  /** what `.print` printed */
  prints: string[];
  asm: AssembleResult;
  /** what a run in Mimir's 6510 takes (ScriptMachine, asmMachine) */
  check: ScriptCheck;
}

/** the labels a run starts at when the program has no BASIC line (the first one that is there) */
const START_LABELS = ['start', 'main', 'begin', 'entry', 'init'];

/** Assemble the program (`main` and what it imports, all in `vfs`) with Mimir's own assembler and check it. */
export function checkAsm(vfs: Vfs, main: string, lang: ScriptLang): AsmCheck {
  const asm = assembleIn(langIs(lang), vfs, main, { allFiles: true });
  const problems: AsmProblem[] = asm.errors.map(e => ({ file: e.file, line: e.line, msg: e.msg }));
  const { mem, written } = asm;
  const ranges = maskRanges(written), bytes = ranges.reduce((n, r) => n + r.end - r.start, 0);
  const names = new Map<string, number>();
  for (const [k, v] of asm.symbols) if (typeof v === 'number' && Number.isFinite(v) && /^[A-Za-z_][\w.]*$/.test(k)) names.set(k, v);
  // where a run starts: the SYS of a BASIC line at $0801 that goes into the program, else a start label, else the first byte
  let entry: Addr | null = null, entryFrom: AsmCheck['entryFrom'] = null;
  if (written[0x0801]) {
    const owner = new Int16Array(0x10000).fill(-1);
    for (let a = 0; a < 0x10000; a++) if (written[a]) owner[a] = 0;
    const sys = parseBasic(mem, owner, 0x0801)?.sys;
    if (sys != null && written[sys]) { entry = sys; entryFrom = 'basic'; }
  }
  if (entry == null) for (const n of START_LABELS) { const v = names.get(n); if (v != null && v >= 0 && v < 0x10000 && written[v]) { entry = v; entryFrom = 'label'; break; } }
  if (entry == null && asm.first >= 0) { entry = asm.first; entryFrom = 'first'; }
  if (!asm.errors.length && entry == null) problems.push({ file: main, line: 0, msg: 'The program has no bytes: write the instructions it runs (with a BasicUpstart2 or a * = to put them in memory).' });
  const labels = new Map<Addr, string>();
  for (const [n, v] of names) if (v >= 0 && v < 0x10000 && written[v] && !labels.has(v)) labels.set(v, n);
  const fileOf = asm.fileOf ?? new Uint16Array(0x10000), files = asm.fileNames ?? [];
  const ok = !problems.length;
  const check: ScriptCheck = {
    ok, problems: problems.map(p => ({ level: 'error' as const, msg: p.msg, ...(p.line ? { line: p.line } : {}) })), entry, code: ranges, bytes, place: 'own', prints: asm.prints,
    mem, written, lines: asm.lines, starts: asm.starts, ops: asm.ops, labels, uses: [], access: [], actions: [],
  };
  return { ok, problems, entry, entryFrom, ranges, bytes, names, files, fileOf, prints: asm.prints, asm, check };
}

/** where in the sources the byte at `a` comes from (null: no line there) */
export function asmLineAt(c: Pick<AsmCheck, 'files' | 'fileOf' | 'asm'>, a: Addr): { file: string; line: number } | null {
  const f = c.fileOf[a & 0xffff], line = c.asm.lines[a & 0xffff];
  return f && line ? { file: c.files[f - 1], line } : null;
}

/**
 * Where a run whose program counter is at no line of the sources (the KERNAL's CHROUT, BASIC, code copied elsewhere)
 * is in them, for the debugger: the innermost JSR of the sources whose routine is running, or the line an interrupt
 * came before (the whole C64). From the stack: its return addresses, a JSR's checked to be one. Null: none of them.
 */
export function asmCallSite(c: Pick<AsmCheck, 'files' | 'fileOf' | 'asm'>, m: { stack(): StackEntry[]; peek(a: Addr): number }): { file: string; line: number; at: Addr; by: 'jsr' | 'interrupt' } | null {
  const stack = m.stack();
  for (let i = stack.length - 1; i >= 0; i--) {
    const r = stack[i].ret;
    if (!r || r.by === 'start') continue;
    const by = r.by === 'interrupt' ? 'interrupt' : 'jsr', at = by === 'jsr' ? (r.to - 3) & 0xffff : r.to;
    if (by === 'jsr' && m.peek(at) !== 0x20) continue;
    const l = asmLineAt(c, at);
    if (l) return { ...l, at, by };
  }
  return null;
}

/** the address of a statement's first byte on `line` of `file` (a breakpoint's address), or null */
export function asmAddrOf(c: Pick<AsmCheck, 'files' | 'fileOf' | 'asm'>, file: string, line: number): Addr | null {
  const f = c.files.indexOf(file) + 1;
  if (!f) return null;
  for (let a = 0; a < 0x10000; a++) if (c.fileOf[a] === f && c.asm.lines[a] === line && c.asm.starts[a]) return a;
  return null;
}

/**
 * A run of a checked program in Mimir's 6510, an instruction at a time or on to its end (the Assembler's Debug): the
 * program's bytes in memory, started at its entry as SYS starts it (an RTS at the top ends the run), the KERNAL's and
 * BASIC's printing routines done on the C64 screen. It is a script's machine (ScriptMachine) with the program as the
 * code, its memory one memory: every code sees the program's bytes, also code it copied elsewhere and jumped to.
 */
export function asmMachine(c: AsmCheck, lang: ScriptLang, screen: Partial<ScreenSize> = SCREEN_C64, limit = SCRIPT_LIMIT): ScriptMachine {
  const m = new ScriptMachine({ files: [], names: new Map() }, { source: '', pads: [], lang: langIs(lang) }, c.check, limit, screen);
  // (2: memory every code sees as it is, not only the script's own code)
  for (let a = 0; a < 0x10000; a++) if (m.mine[a]) m.mine[a] = 2;
  return m;
}

/** How a run of the program in Mimir's 6510 ended, in a sentence; `where` names an address's line. */
export function asmEndText(r: Pick<ScriptRun, 'end' | 'at' | 'instructions' | 'cycles'>, where: (a: Addr) => string | null, own: (a: Addr) => boolean): string {
  const n = `${r.instructions.toLocaleString('en-US')} instruction${r.instructions === 1 ? '' : 's'}, ${r.cycles.toLocaleString('en-US')} cycles`;
  const at = `$${h4(r.at)}${where(r.at) ? ` (${where(r.at)})` : ''}`;
  switch (r.end) {
    case 'rts': return `Returned with an RTS, as to BASIC after SYS, after ${n}.`;
    case 'brk':
      // a call into the ROMs, which the run does not have (only their printing routines are done)
      if (!own(r.at) && r.at >= 0xa000 && !SCREEN_ROUTINES.has(r.at)) return `Stopped at $${h4(r.at)} after ${n}: the program called the ${r.at >= 0xe000 ? 'KERNAL' : 'BASIC'} ROM there, which a run in Mimir's 6510 does not have (it does only the printing routines, CHROUT and the like). Run starts it in VICE.`;
      return `Stopped at the BRK at ${at} after ${n}.`;
    case 'jam': return `The CPU jammed at ${at} (a JAM opcode) after ${n}: did the code run into data?`;
    case 'stop': return `Stopped at ${at} after ${n}.`;
    case 'error': return 'Stopped with an error.';
    case 'limit': return `Stopped after ${n} at ${at}, the most a run in Mimir may take: a program that loops for ever (a jmp *, a raster wait) runs on in VICE.`;
  }
}

/** What a checked program is to an Assembler project's views (spec 10.7): its bytes as the file the build makes of them
 *  (from its lowest byte to its highest, the gaps as zeros, as KickAss.jar and 64tass write a PRG), what each byte is
 *  (code, the BASIC line, a block marked in the sources: asm-blocks.ts), the sources' labels and where a run starts. The analysis takes these as a project's
 *  own: Graphics, Memory, the inspector and the Explorer show the program the sources make, with their names. */
export interface AsmProgram {
  files: LoadedFile[];
  overrides: Override[];
  labels: Record<Addr, string>;
  entryPoint: Addr | null;
}

/** The program `c` (assembled from the main file `main`) as an Assembler project's views take it (AsmProgram): every
 *  byte the sources write is code, the BASIC line at $0801 BASIC, those of a block marked in the sources (`marks`,
 *  asmBlockMarks) what the block is. */
export function asmProgram(c: Pick<AsmCheck, 'asm' | 'entry' | 'check' | 'files' | 'fileOf'>, main: string, marks: readonly AsmBlockMark[] = []): AsmProgram {
  const stem = main.replace(/^.*[\/]/, '').replace(/\.[^.]*$/, '') || 'program';
  const { mem, written } = c.asm;
  let lo = -1, hi = -1;
  for (let a = 0; a < 0x10000; a++) if (written[a]) { if (lo < 0) lo = a; hi = a; }
  const files: LoadedFile[] = lo < 0 ? [] : [{ id: `asm-${h4(lo)}`, name: `${stem}.prg`, load: lo, bytes: mem.slice(lo, hi + 1) }];
  // the BASIC line RUN starts it with (BasicUpstart2, or one written byte by byte)
  let basic: { start: Addr; end: Addr } | null = null;
  if (written[0x0801]) {
    const owner = new Int16Array(0x10000).fill(-1);
    for (let a = 0; a < 0x10000; a++) if (written[a]) owner[a] = 0;
    const b = parseBasic(mem, owner, 0x0801);
    if (b && b.sys != null && b.end > b.start) basic = { start: b.start, end: Math.min(b.end, b.sys) };
  }
  // each byte as what its line is: in a block, the block's kind; else code. Bytes next to each other alike, one range
  const byFile = new Map<string, AsmBlockMark[]>();
  for (const m of marks) byFile.set(m.file, [...(byFile.get(m.file) ?? []), m]);
  const CODE = { kind: 'code' as const, props: {} }, BASIC = { kind: 'basic' as const, props: {} };
  const markOf = (a: Addr) => {
    const f = c.fileOf[a], line = c.asm.lines[a];
    return (f && line ? byFile.get(c.files[f - 1])?.find(m => line > m.line && line < m.end) : null) ?? CODE;
  };
  const overrides: Override[] = [];
  let lastMark: unknown = null;
  for (let a = 0; a < 0x10000; a++) {
    if (!written[a]) { lastMark = null; continue; }
    const m = basic && a >= basic.start && a < basic.end ? BASIC : markOf(a), last = overrides[overrides.length - 1];
    if (last && last.end === a && lastMark === m) { last.end = a + 1; continue; }
    overrides.push({ start: a, end: a + 1, type: m.kind, ...(Object.keys(m.props).length ? { props: { ...m.props } } : {}) });
    lastMark = m;
  }
  const labels: Record<Addr, string> = {};
  for (const [a, n] of c.check.labels) if (a >= lo && a <= hi) labels[a] = n;
  return { files, overrides, labels, entryPoint: c.entry };
}
