/* =====================================================================
 * 8.11h The analysis against a run: Sindri runs the file in an emulated C64 and tells, per address, what the program
 * did with each byte while it still held what was loaded (it ran it as an opcode or an operand, read it as data).
 * Next to that, what the analysis made of the byte. The run is a lower bound: it covers the paths that ran, so a byte
 * it did not touch says nothing. What it ran is code; what it only read is most likely data, unless a copy loop
 * reads it to run it elsewhere.
 * ===================================================================== */
import { FILE_ARG, FILE_RAN, FILE_READ } from '@mimir/sindri';
import type { Addr, AnalysisResult } from './types';

export interface RunCheck {
  /** instruction starts the run executed in the file's bytes as loaded */
  ran: number;
  /** of those, where the analysis starts an instruction too */
  found: number;
  /** ... inside an instruction the analysis decoded from another start: the code is read out of step */
  outOfStep: number;
  /** ... that the analysis has as data */
  missed: number;
  /** bytes the run read as data and never ran (as an opcode or an operand) */
  read: number;
  /** of those, bytes the analysis made code of (an opcode or an operand) */
  readAsCode: number;
  /** ... in the source of a copy loop the analysis found: code that runs where it is copied, not where it is loaded */
  readAsCodeCopied: number;
  /** the bytes of code the analysis has (opcodes and operands) in the file */
  codeBytes: number;
  /** ... that the run did not touch while they held what was loaded */
  codeUntouched: number;
  /** where to look: the first address of each stretch of each kind (at most `WHERE` of them) */
  where: { missed: Addr[]; outOfStep: Addr[]; readAsCode: Addr[] };
}

const WHERE = 12;

/** The analysis `A` against the run's `fileUse` (Sindri's `UnpackResult.fileUse`) of file `file` of the project. */
export function checkRun(A: AnalysisResult, fileUse: Uint8Array, file = 0): RunCheck {
  const { owner, insLen, codeOwner } = A;
  const c: RunCheck = { ran: 0, found: 0, outOfStep: 0, missed: 0, read: 0, readAsCode: 0, readAsCodeCopied: 0, codeBytes: 0, codeUntouched: 0, where: { missed: [], outOfStep: [], readAsCode: [] } };
  const copied = (a: Addr) => A.copies.some(k => a >= k.start && a < k.end);
  // a new stretch starts when the address before was not of the same kind
  const last: Record<keyof RunCheck['where'], number> = { missed: -2, outOfStep: -2, readAsCode: -2 };
  const note = (kind: keyof RunCheck['where'], a: Addr, step: number) => {
    if (a - last[kind] > step && c.where[kind].length < WHERE) c.where[kind].push(a);
    last[kind] = a;
  };
  for (let a = 0; a < 0x10000; a++) {
    if (owner[a] !== file) continue;
    const use = fileUse[a], code = insLen[a] > 0 || codeOwner[a] >= 0;
    if (code) { c.codeBytes++; if (!use) c.codeUntouched++; }
    if (use & FILE_RAN) {
      c.ran++;
      if (insLen[a]) c.found++;
      else if (codeOwner[a] >= 0) { c.outOfStep++; note('outOfStep', a, 3); }
      else { c.missed++; note('missed', a, 3); }
    } else if (use & FILE_READ && !(use & FILE_ARG)) {
      c.read++;
      // (an operand the code writes before its instruction runs, and reads, as a counter does: the instruction ran)
      if (code && !(codeOwner[a] >= 0 && fileUse[codeOwner[a]] & FILE_RAN)) {
        c.readAsCode++;
        if (copied(a)) c.readAsCodeCopied++; else note('readAsCode', a, 1);
      }
    }
  }
  return c;
}

/** Add run checks up (a corpus). */
export function addRunChecks(cs: RunCheck[]): RunCheck {
  const sum: RunCheck = { ran: 0, found: 0, outOfStep: 0, missed: 0, read: 0, readAsCode: 0, readAsCodeCopied: 0, codeBytes: 0, codeUntouched: 0, where: { missed: [], outOfStep: [], readAsCode: [] } };
  for (const c of cs) for (const k of ['ran', 'found', 'outOfStep', 'missed', 'read', 'readAsCode', 'readAsCodeCopied', 'codeBytes', 'codeUntouched'] as const) sum[k] += c[k];
  return sum;
}
