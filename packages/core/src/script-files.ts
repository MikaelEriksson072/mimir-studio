/* =====================================================================
 * A user script run on files (spec 10.3): a file of the disk or the tape goes into the scratchpad that takes a file
 * (ScriptPad.role 'file') as what it starts with, the script runs as it always does, and what it leaves is the
 * result, a file again: the program's own unpacker called on a level's file, a decryption run over each file of a
 * disk. The run never changes the project: the program's bytes it writes are part of the result, not patches.
 *
 * A scratchpad that takes the file or holds a result is the part of the script's own memory that the program's code
 * sees too (ScriptMachine), so the program's unpacker reads the file where the script has it.
 *
 * The scratchpad that takes the file is as big as the file for the run (`pad_end` is the address after its last
 * byte), stays where it is when the file fits there and is placed anew when it does not, and `pad_load` is the
 * file's load address. The result is, in this order:
 *   1. each scratchpad marked as a result that the run wrote: from its start to after the last byte written, a file
 *      that loads at the scratchpad's address (put the scratchpad where the data belongs);
 *   2. with none of those, the scratchpad that took the file, when the run wrote it (work done in place): all of it, at
 *      the file's load address;
 *   3. else the longest stretch of the program's memory the run wrote (an unpacker's output), at its address.
 * ===================================================================== */
import type { Addr, ScriptPad, UserScript } from './types';
import { checkScript, scriptPlace, type ScriptCheck, type ScriptEnv, type ScriptRun } from './script';
import { h4 } from './util/hex';

/** A file a script is run on: its name, where it loads (null: it has no load address) and its bytes without the
 *  load address. */
export interface ScriptFile { name: string; load: Addr | null; bytes: Uint8Array }

type RunScript = Pick<UserScript, 'source' | 'pads' | 'init'> & Partial<Pick<UserScript, 'lang'>>;

/** the scratchpad that takes the file when the script is run on files (its index; -1: none) */
export const filePad = (pads: readonly Pick<ScriptPad, 'role'>[]): number => pads.findIndex(p => p.role === 'file');

/** A script set up for a run on a file: the script with the file in its scratchpad, checked. */
export interface FileRunPlan { script: RunScript; check: ScriptCheck; pad: number }

/** the most a scratchpad can take of a file: memory from $0200 */
export const FILE_PAD_MAX = 0x10000 - 0x200;

/** The scratchpad `pad` as it takes `file`: as big as the file (cut to what memory holds from `start`), the file its
 *  start content, the file's load address kept; what a run left in it and how its start was written are gone. */
export function padWithFile(pad: ScriptPad, file: ScriptFile, start: Addr = pad.start): ScriptPad {
  const n = Math.max(1, Math.min(file.bytes.length, 0x10000 - start));
  const { bytes: _b, src: _s, data: _d, load: _l, ...keep } = pad;
  return { ...keep, start, size: n, data: file.bytes.slice(0, n), ...(file.load != null ? { load: file.load } : {}) };
}

/**
 * The script as it runs on `file`: the file in its scratchpad that takes one, where that scratchpad is when the file
 * fits there and the script still checks out, else where there is room for it away from the script's code, its other
 * scratchpads and the memory its code reaches. An error: it has no such scratchpad, the file is empty or too big, or
 * the script does not check out with it.
 */
export function fileRunPlan(env: ScriptEnv, script: RunScript, file: ScriptFile): FileRunPlan | { error: string } {
  const i = filePad(script.pads);
  if (i < 0) return { error: 'the script has no scratchpad that takes a file: set the use of one to File (Scripts → Scratchpads)' };
  const n = file.bytes.length;
  if (!n) return { error: 'the file is empty' };
  if (n > FILE_PAD_MAX) return { error: `the file is ${n} bytes, more than memory holds from $0200` };
  const pad = script.pads[i];
  const others = script.pads.map(({ bytes: _b, ...p }) => p);
  const at = (start: Addr) => {
    const s: RunScript = { ...script, pads: others.map((p, k) => (k === i ? padWithFile(pad, file, start) : p)) };
    return { script: s, check: checkScript(env, s), pad: i };
  };
  let first: FileRunPlan | null = null;
  if (pad.start >= 0x200 && pad.start + n <= 0x10000) { first = at(pad.start); if (first.check.ok) return first; }
  // elsewhere: checked with the scratchpad out of the way, then where nothing of the script's is
  const probe = checkScript(env, { ...script, pads: others.map((p, k) => (k === i ? { name: p.name, start: 0xffff, size: 1, role: 'file' as const } : p)) });
  const taken = [...probe.code, ...probe.access, ...others.filter((_, k) => k !== i).map(p => ({ start: p.start, end: p.start + p.size }))];
  const place = scriptPlace(env.files, n, taken);
  const moved = place && place.at !== pad.start ? at(place.at) : null;
  if (moved?.check.ok) return moved;
  const why = (moved ?? first)?.check.problems.find(p => p.level === 'error');
  return { error: why ? `${why.line ? `line ${why.line}: ` : ''}${why.msg}` : `there is no room in memory for its ${n} bytes beside the script's code and scratchpads` };
}

/** A file a run on a file gave: its name, where it loads and its bytes, and where the run left it. */
export interface ScriptFileResult {
  name: string; load: Addr; bytes: Uint8Array;
  /** a scratchpad marked as a result (`pad`), the scratchpad that took the file, or the program's memory */
  from: 'result' | 'file' | 'memory';
  pad?: string;
}

/** a file's name without its extension, as a file name: only letters, digits, _ . and -, and not starting with - */
const stem = (name: string) => name.replace(/\.[A-Za-z0-9]{1,4}$/, '').replace(/[^A-Za-z0-9_.-]+/g, '_').replace(/^[-._]+|_+$/g, '') || 'file';

/**
 * The files a run on `file` gave (see the top of this file): its scratchpads marked as results that the run wrote,
 * else the scratchpad that took the file when the run wrote it, else the longest stretch of the program's memory the
 * run wrote. Each is named after the file and `tag` (the script's name): `level1_decrypt.prg`, and with several
 * results the scratchpad's name too. None: the run wrote nothing that is a result.
 */
export function fileRunResults(plan: FileRunPlan, file: ScriptFile, run: ScriptRun, tag = ''): ScriptFileResult[] {
  const base = `${stem(file.name)}${tag ? `_${stem(tag)}` : ''}`;
  const left = (name: string) => run.pads.find(p => p.name === name);
  const results = plan.script.pads.filter(p => p.role === 'result').flatMap((p): ScriptFileResult[] => {
    const r = left(p.name);
    return r?.wrote ? [{ name: '', load: p.start, bytes: r.bytes.slice(0, r.wrote[1]), from: 'result', pad: p.name }] : [];
  });
  if (results.length) return results.map(r => ({ ...r, name: `${base}${results.length > 1 ? `_${r.pad}` : ''}.prg` }));
  const pad = plan.script.pads[plan.pad], mine = left(pad.name);
  if (mine?.wrote) return [{ name: `${base}.prg`, load: file.load ?? pad.start, bytes: mine.bytes.slice(), from: 'file', pad: pad.name }];
  const longest = [...(run.wrote ?? [])].sort((a, b) => (b.end - b.start) - (a.end - a.start) || a.start - b.start)[0];
  return longest ? [{ name: `${base}.prg`, load: longest.start, bytes: run.mem.slice(longest.start, longest.end), from: 'memory' }] : [];
}

/** What a result is, in words: `pad result, 512 bytes at $4000`. */
export function fileResultText(r: ScriptFileResult): string {
  const n = `${r.bytes.length} byte${r.bytes.length === 1 ? '' : 's'} at $${h4(r.load)}`;
  return r.from === 'result' ? `scratchpad ${r.pad}, ${n}` : r.from === 'file' ? `the file's scratchpad ${r.pad} as the run left it, ${n}` : `the memory the run wrote, ${n}`;
}
