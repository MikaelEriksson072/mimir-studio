/* What the app reports about a packed file: detectPacking()'s verdict together with what the unpacker finds. Sindri,
 * the built-in unpacker, runs every file opened: a file it peels a layer off is packed even when the heuristics missed
 * it, and the packers its fingerprints name replace a guess from the file's text. With unp64 as an external unpacker,
 * unp64 -i does the same: it knows hundreds of packers by name. */
import { conclusive, depackers, packerNames, unpackSummary, type AnalysisResult, type PackingInfo, type UnpackRun } from '@mimir/core';
import type { IdentifyResponse } from '../../shared/ipc';

type FileAt = { index: number; size: number; entry: number | null };

export function withUnpackRun(h: PackingInfo | null, run: UnpackRun | undefined, file: FileAt): PackingInfo | null {
  if (!run) return h;
  if (run.unpacked) {
    const base: PackingInfo = h ?? { file: file.index, verdict: 'packed', size: file.size, codeBytes: 0, entropy: 0, packedShare: 0, decruncher: file.entry, signature: null, reasons: [] };
    return { ...base, verdict: 'packed', signature: packerNames(run) ?? base.signature, reasons: [unpackSummary(run), ...base.reasons] };
  }
  // it ran the program and nothing unpacked itself: weak signs alone are not worth a notice
  if (!h || (h.verdict === 'maybe' && conclusive(run))) return null;
  return { ...h, reasons: [...h.reasons, unpackSummary(run)] };
}

/** A run whose layers only move code to where the analysis reads it (8.1b): relocated blocks, or copies it suggests
 *  relocating. That is a program that copies some of itself elsewhere to run there, not a packed one. */
export function onlyRelocates(run: UnpackRun | undefined, A: Pick<AnalysisResult, 'relocs' | 'copies'>): boolean {
  const d = run?.unpacked ? depackers(run) : [];
  if (!d.length || d.some(l => l.kind !== 'mover')) return false;
  const spans = [...A.relocs, ...A.copies].map(r => [r.to, r.to + r.end - r.start]);
  // Sindri's ranges end on their last byte
  return d.every(l => l.written.every(w => spans.some(([s, e]) => w.start >= s && w.end < e)));
}

export function withIdentified(h: PackingInfo | null, id: IdentifyResponse | undefined, file: FileAt, tool: string): PackingInfo | null {
  if (!id?.supported) return h;
  if (id.known && id.packer) {
    const base: PackingInfo = h ?? { file: file.index, verdict: 'packed', size: file.size, codeBytes: 0, entropy: 0, packedShare: 0, decruncher: file.entry, signature: null, reasons: [] };
    return { ...base, verdict: 'packed', signature: id.packer, reasons: [`${tool} identifies ${id.packer}`, ...base.reasons] };
  }
  // unp64 knows most packers: when it knows none here, weak signs alone are not worth a notice
  if (!h || h.verdict === 'maybe') return null;
  return { ...h, reasons: [...h.reasons, `${tool} does not know the packer`] };
}
