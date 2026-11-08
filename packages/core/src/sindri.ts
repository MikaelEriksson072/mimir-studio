/* =====================================================================
 * Sindri, the built-in unpacker (@mimir/sindri, packages/sindri): it runs a packed PRG in an emulated C64, follows it
 * through its layers (coders, movers, decrunchers) and saves the program as it starts; with the disk the file came
 * from, a 1541 is on the serial bus and the program goes on loading. Here: a run whose result can be posted from a
 * worker, the packers the layers' fingerprints name, and the layer report the app and the CLI show.
 * ===================================================================== */
import { unpack, vsfMachine, type LayerReport, type Roms, type UnpackResult } from '@mimir/sindri';
import { h4 } from './util/hex';

export type { LayerReport, Roms } from '@mimir/sindri';

/** A run of Sindri without its save() function, so that it can cross a worker boundary; `snapshot`: it went on from
 *  a VICE snapshot whose CPU was there */
export type UnpackRun = Omit<UnpackResult, 'save'> & { snapshot?: number };

/** The tape a file came from (a TAP image, or a T64 tape archive) and, when it is not one of its KERNAL files, where
 *  the tape stands once the file has loaded (a pulse: TapeFile.to; a T64's slot after the file). */
export interface UnpackTape { tap: Uint8Array; at?: number | null }

/**
 * Unpack a PRG (load address first); without ROMs Sindri runs with its stand-ins for the KERNAL and BASIC. With
 * the D64 it came from (and the 1541 DOS ROM in `roms`), the drive reads the disk for the program's loader; with the
 * tape it came from, the datasette plays it from after the file for the program's tape loader. `entry`: start it
 * there (SYS) instead of with RUN, as a program without a BASIC line needs. `vsf`: the PRG is a VICE snapshot's RAM,
 * and Sindri goes on from the snapshot's machine where it was taken instead (it needs the ROMs; throws when the
 * snapshot is not one Sindri reads): a game stopped in its intro or trainer menu still holds the game packed.
 */
export function unpackPrg(prg: Uint8Array, roms: Roms | null = null, disk: Uint8Array | null = null, entry: number | null = null, tape: UnpackTape | null = null, vsf: Uint8Array | null = null): UnpackRun {
  const resume = vsf ? vsfMachine(vsf) : null;
  const { save: _save, ...run } = unpack(prg, {
    roms, disk, ...(resume ? { resume } : entry != null ? { entry } : {}),
    ...(tape ? { tape: tape.tap, ...(tape.at != null ? { tapeAt: tape.at } : {}) } : {}),
  });
  return resume ? { ...run, snapshot: resume.cpu.pc } : run;
}

/**
 * Where the packed data was: what the decrunchers and decoders read in runs of 256 bytes or more (a mover's source is
 * the program itself, moved), merged. For a snapshot it is the part of its RAM that was still packed.
 */
export function packedData(run: Pick<UnpackRun, 'layers'>): { start: number; end: number }[] {
  const rs = depackers(run).filter(l => l.kind === 'decruncher' || l.kind === 'decoder').flatMap(l => l.read).filter(r => r.end - r.start >= 255).sort((a, b) => a.start - b.start);
  const out: { start: number; end: number }[] = [];
  for (const r of rs) { const last = out.at(-1); if (last && r.start <= last.end + 1) last.end = Math.max(last.end, r.end); else out.push({ start: r.start, end: r.end }); }
  return out;
}

/** The layers that unpacked something: neither the program nor a layer that only jumps on. */
export const depackers = (run: Pick<UnpackRun, 'layers'>): LayerReport[] => run.layers.filter(l => l.kind !== 'program' && l.kind !== 'jump');

/** The packers the depackers' fingerprints name, outermost first, or null when none is known. */
export function packerNames(run: Pick<UnpackRun, 'layers'>): string | null {
  const names = [...new Set(depackers(run).flatMap(l => (l.packer ? [l.packer.name] : [])))];
  return names.length ? names.join(' → ') : null;
}

/** One depacker in a sentence: "Exomizer v3.0 (a decruncher at $0100)" or "an unknown mover at $080d (fingerprint d1521e66)". */
export function depackerText(l: LayerReport): string {
  return l.packer ? `${l.packer.name} (a ${l.kind} at $${h4(l.entry)})` : `an unknown ${l.kind} at $${h4(l.entry)} (fingerprint ${l.fingerprint})`;
}

/** What a run found, in a sentence for the packed notice: the layers it peeled off and where the program starts. */
export function unpackSummary(run: UnpackRun): string {
  const from = run.snapshot != null ? `Going on from the snapshot (the CPU at $${h4(run.snapshot)}), ` : '';
  if (!run.unpacked) return `${from}Sindri peels off no layer (it stopped: ${stopText(run)})`;
  const d = depackers(run);
  const prog = run.saved ? `; the program starts at $${h4(run.saved.entry)}` : '';
  const data = run.snapshot != null && packedData(run).length ? `; the packed data was at ${rangesText(packedData(run))}` : '';
  return `${from}Sindri peels off ${d.length} layer${d.length === 1 ? '' : 's'}: ${d.map(depackerText).join(', then ')}${data}${prog}`;
}

/** The run ended where a program normally ends up (it settled, or went back to BASIC), not on a limit or a load. */
export const conclusive = (run: Pick<UnpackRun, 'stop'>): boolean => run.stop.reason === 'settled' || run.stop.reason === 'ready';

const stopText = (run: Pick<UnpackRun, 'stop'>): string => `${run.stop.reason}${run.stop.detail ? `, ${run.stop.detail}` : ''}`;

const hex = (v: number) => `$${h4(v)}`;
const rangeText = (r: { start: number; end: number }) => (r.start === r.end ? hex(r.start) : `${hex(r.start)}-${hex(r.end)}`);
const rangesText = (rs: { start: number; end: number }[], max = 3) => (rs.length ? rs.slice(0, max).map(rangeText).join(' ') + (rs.length > max ? ` +${rs.length - max}` : '') : '-');
const kb = (n: number) => (n >= 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} bytes`);

/** A layer as Sindri's own command line reports it. */
function layerLines(l: LayerReport): string[] {
  const lines = [`layer ${l.index}  ${hex(l.entry)}  ${(l.via === 'start' ? 'start' : `${l.via} from ${hex(l.from ?? 0)}`).padEnd(15)} ${l.basic ? 'BASIC RUN' : l.kind}`];
  if (l.kind !== 'program' || l.index === 0) {
    lines.push(`         ran ${rangesText(l.code)} (${l.instructions} instructions), read ${rangesText(l.read)} (${kb(l.readBytes)}), wrote ${rangesText(l.written)} (${kb(l.writtenBytes)})`);
    if (l.kind !== 'jump') lines.push(`         ${l.packer ? `packer: ${l.packer.name} (${Math.round(l.packer.similarity * 100)}% alike)` : `unknown depacker, fingerprint ${l.fingerprint}`}`);
  }
  if (l.calls.length) lines.push(`         called code it wrote: ${l.calls.map(c => `${hex(c.entry)} (${c.via})`).join(', ')}`);
  if (l.kind === 'program' && l.kept?.length) lines.push(`         keeps what earlier layers left that it ran: ${l.kept.map(k => `${rangeText(k)} (layer ${k.layer})`).join(', ')}`);
  if (l.kind === 'program' && l.loaded?.length) lines.push(`         keeps what it loaded after it started and ran, as it was at the end: ${rangesText(l.loaded, 4)}`);
  if (l.text.length) lines.push(`         text: ${l.text.slice(0, 4).map(t => JSON.stringify(t)).join(', ')}`);
  const printed = l.printed.replace(/\s+/g, ' ').trim();
  if (printed) lines.push(`         printed: ${JSON.stringify(printed.slice(0, 80))}`);
  if (l.presses.length) lines.push(`         pressed: ${l.presses.join(', ')}`);
  return lines;
}

/** The layer report of a run of `name` (a PRG of `size` bytes after its load address), as Sindri's command line prints it. */
export function unpackLog(run: UnpackRun, name: string, load: number, size: number): string {
  const out = [`${name}: ${rangeText({ start: load, end: load + size - 1 })} (${kb(size)})${run.basic.length ? `, ${run.basic.slice(0, 2).join(' / ')}` : ''}`, `ROMs: ${run.roms}`];
  if (run.snapshot != null) out.push(`Snapshot: going on from where it was taken, the CPU at ${hex(run.snapshot)} (its RAM, VIC-II and CIAs; not its 1541)`);
  if (run.drive) out.push(`Drive: ${run.drive}`);
  if (run.tape) out.push(`Tape: ${run.tape}`);
  for (const l of run.layers) out.push(...layerLines(l));
  out.push(`stopped after ${(run.cycles / 985248).toFixed(1)} s of C64 time (${Math.round(run.ms)} ms): ${stopText(run)}`);
  if (!run.unpacked) out.push('nothing was unpacked');
  else if (run.saved) {
    const s = run.saved;
    const port = s.port !== 0x37 ? `, $01=$${s.port.toString(16).padStart(2, '0')}` : '';
    const start = s.basic ? `RUN (SYS ${s.entry} = ${hex(s.entry)}${port})` : `SYS ${s.entry} = ${hex(s.entry)}${port}${s.interrupts ? '' : ', interrupts off'}`;
    out.push(`saved layer ${s.layer}: ${rangeText(s)} (${kb(s.prg.length - 2)}), start with ${start}`);
  }
  return out.join('\n');
}
