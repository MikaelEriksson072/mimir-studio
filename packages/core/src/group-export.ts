/* A loader's files exported as sources of their own (spec 13.5, Export files to project): each group of files that one
 * loader call loads (a Spindle job, a Sparkle bundle, an IFFL part's pieces), or a single file, is analysed alone and
 * written as its own source. A group of several files is one Kick Assembler source: what every file's head defined
 * (the hardware include, the zero page) once at its top, then each file in a segment of its own that a `.file` line
 * writes as its own PRG. 64tass has no segments: each file keeps a source of its own there. */
import type { AnalysisResult, FileVerifyResult, Line, ProjectInput, RenderResult, Settings, Token, Vfs } from './types';
import { analyze, argTokens, HOISTED, petValue, render, verify } from './spaces';
import { lineText } from './render/lines';
import { assemble } from './verify/kick-subset-assembler';
import { ASSEMBLERS, assemblerOf, isTass } from './render/dialect';
import { makePrg } from './c64/prg';
import { h4 } from './util/hex';

export interface GroupExport {
  /** what to write, relative to the folder the group goes in: its source (or sources), the binary files they import
   *  (named after the group, so groups never take each other's), the hardware include, and each file as it was
   *  loaded (original/) */
  files: Vfs;
  /** the sources to assemble: one, or one per file with 64tass */
  sources: string[];
  /** the round trip with the built-in assembler: every byte of every file as it was */
  ok: boolean;
  /** what went wrong when it is not ok */
  problem: string | null;
}

/** the segment directives, which the built-in assembler does not know: the source without them makes the same bytes */
const SEGMENT_LINES = new Set(['.file', '.segmentdef', '.segment']);

/** a segment's name from a file's: a letter first, then letters, digits and _ */
const segName = (file: string) => { const s = file.replace(/[^A-Za-z0-9_]/g, '_'); return /^[A-Za-z]/.test(s) ? s[0].toUpperCase() + s.slice(1) : `S_${s}`; };

/**
 * The files of `R` in one Kick Assembler source, `<name>.asm`: a title that says which files it writes, a `.file` and
 * a `.segmentdef` per file, once what every file's head defined (the include, the hardware names, the PETSCII control
 * codes, the zero-page variables, the music), then each file in its segment with the rest of its source. The names one
 * file defines for another ("labels defined in other files") are left out: the files are in one source now.
 * `check`: the same source without its segment lines, for the built-in assembler.
 */
export function joinSources(project: ProjectInput, R: RenderResult, S: Settings, name: string, from: string): { path: string; lines: Line[]; text: string; check: string } {
  const up = S.hexCase === 'upper';
  const x4 = (v: number) => '$' + (up ? h4(v & 0xffff).toUpperCase() : h4(v & 0xffff));
  const order = project.files.map((_, i) => i);
  const text = (i: number) => R.fileLines[`${R.fileNames[i]}.asm`] ?? [];
  const a0 = project.files[0].load;
  const cmt = (a: number, t: string): Line => ({ k: 'cmt', a, text: t });
  const dir = (a: number, d: string, args = '', c = ''): Line => ({ k: 'dir', a, n: 0, tok: [{ t: 'dir', s: d }, ...(args ? [{ t: 'p' as const, s: ' ' }, ...argTokens(args)] : [])] as Token[], ...(c ? { cmt: c } : {}) });
  const blank = (a: number): Line => ({ k: 'blank', a });
  const seg = (i: number) => segName(R.fileNames[i]);

  // what every file's head defined, once
  const includes: Line[] = [], hw: Line[] = [], pet: Line[] = [], zp: Line[] = [], music: Line[] = [], seen = new Set<string>();
  const once = (into: Line[], l: Line, key = lineText(l, S)) => { if (!seen.has(key)) { seen.add(key); into.push(l); } };
  for (const i of order) {
    let notes: Line[] = [];
    for (const l of text(i)) {
      if (l.k === 'blank' || !('head' in l)) continue;
      if (l.head === 'import' && l.k === 'dir') once(includes, l, `import ${lineText(l, S)}`);
      else if (l.head === 'hw' && l.k === 'dir') once(hw, l);
      else if (l.head === 'pet' && l.k === 'dir') once(pet, l);
      else if (l.head === 'music' && l.k !== 'cmt') once(music, l, `music ${lineText(l, S)}`);
      else if (l.head === 'zp' && l.k === 'cmt' && l.zp != null) notes.push(l);
      else if (l.head === 'zp' && l.k === 'dir') {
        const key = `zp ${l.zp} ${lineText(l, S)}`;
        if (!seen.has(key)) { seen.add(key); zp.push(...notes, l); }
        notes = [];
      }
    }
  }
  const files = project.files;
  const top: Line[] = [
    cmt(a0, `${name} — ${from}, re-assembled by Mimir Studio · ${ASSEMBLERS[assemblerOf(S)].title}`),
    cmt(a0, `Assemble this file alone: each of its ${files.length} files is a segment, and .file writes it as a PRG of its own:`),
    ...order.map(i => cmt(a0, `  ${R.fileNames[i]}.prg  ${x4(files[i].load)}-${x4(files[i].load + files[i].bytes.length - 1)} (${files[i].bytes.length} bytes)`)),
    blank(a0),
    ...order.map(i => dir(a0, '.file', `[name="${R.fileNames[i]}.prg", segments="${seg(i)}"]`)),
    ...order.map(i => dir(a0, '.segmentdef', `${seg(i)} [start=${x4(files[i].load)}]`)),
    blank(a0),
    ...includes,
    ...(hw.length ? [cmt(a0, 'hardware and KERNAL symbols'), ...hw] : []),
    ...(pet.length ? [blank(a0), cmt(a0, 'PETSCII control codes, written by name in the texts'), ...pet.sort((x, y) => petValue(x).localeCompare(petValue(y)))] : []),
    ...(zp.length ? [blank(a0), cmt(a0, `zero page (every file of ${name})`), ...zp] : []),
    ...(music.length ? [blank(a0), ...music] : []),
    blank(a0),
  ];
  const body = order.flatMap(i => {
    const a = files[i].load, own = text(i).filter(l => !('head' in l && l.head && (HOISTED.has(l.head) || l.head === 'music')));
    return [cmt(a, `==== ${R.fileNames[i]}.prg: ${x4(a)}-${x4(a + files[i].bytes.length - 1)} ====`), dir(a, '.segment', seg(i)), ...own, blank(a)];
  });
  while (body.length && body[body.length - 1].k === 'blank') body.pop();
  const lines = [...top, ...body];
  const joined = (ls: Line[]) => ls.map(l => lineText(l, S)).join('\n') + '\n';
  return { path: `${name}.asm`, lines, text: joined(lines), check: joined(lines.filter(l => !(l.k === 'dir' && SEGMENT_LINES.has(l.tok[0]?.s)))) };
}

/** what a file's round trip says when it fails */
const problemText = (r: Pick<FileVerifyResult, 'file' | 'errors' | 'diffs'>): string => {
  const e = r.errors[0];
  if (e) return `${r.file}: ${e.msg}${e.line ? ` (line ${e.line})` : ''}`;
  const d = r.diffs[0];
  return `${r.file}: ${r.diffs.length}${r.diffs.length >= 40 ? '+' : ''} byte${r.diffs.length === 1 ? '' : 's'} differ${r.diffs.length === 1 ? 's' : ''}${d ? `, the first at $${h4(d.addr)}` : ''}`;
};

/** `project`'s files assembled from `check` (the joined source without its segments): each file's bytes where it loads,
 *  the blocks left out of the build not compared */
function verifyJoined(A: AnalysisResult, R: RenderResult, path: string, check: string): { ok: boolean; problem: string | null } {
  const asm = assemble({ ...R.files, [path]: check }, path);
  if (asm.errors.length) return { ok: false, problem: problemText({ file: path, errors: asm.errors, diffs: [] }) };
  for (const [fi, f] of A.files.entries()) {
    const skip = (R.excluded ?? []).filter(x => x.file === fi);
    const diffs: { addr: number }[] = [];
    for (let a = f.load; a < Math.min(0x10000, f.load + f.bytes.length); a++) {
      if (skip.some(s => a >= s.start && a < s.end)) continue;
      if (!asm.written[a] || asm.mem[a] !== f.bytes[a - f.load]) diffs.push({ addr: a });
    }
    if (diffs.length) return { ok: false, problem: problemText({ file: f.name, errors: [], diffs: diffs.slice(0, 40) as FileVerifyResult['diffs'] }) };
  }
  return { ok: true, problem: null };
}

/**
 * A group of a loader's files (`project`: the group's files, the settings to analyse them with) analysed alone and
 * exported as one source named `name` (`from`: what the files are, for its title, "job 2 of spindle-demo.d64"), or a
 * single file's own source; with the round trip through the built-in assembler.
 */
export function exportGroup(project: ProjectInput, name: string, from: string): GroupExport {
  const A = analyze(project);
  const R = render(A, project, { binPrefix: `${name}_` });
  const S = A.S;
  const files: Vfs = {};
  for (const f of project.files) files[`original/${f.name}`] = makePrg(f.load, f.bytes);
  if (project.files.length < 2 || isTass(S)) {
    const V = verify(A, R);
    Object.assign(files, R.files);
    const bad = V.results.find(r => !r.ok);
    return { files, sources: R.fileNames.map(n => `${n}.asm`), ok: V.ok, problem: bad ? problemText(bad) : null };
  }
  const j = joinSources(project, R, S, name, from);
  for (const [k, v] of Object.entries(R.files)) if (!R.fileNames.some(n => k === `${n}.asm`)) files[k] = v;
  files[j.path] = j.text;
  return { files, sources: [j.path], ...verifyJoined(A, R, j.path, j.check) };
}
