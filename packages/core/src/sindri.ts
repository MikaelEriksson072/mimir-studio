/* =====================================================================
 * Sindri, the built-in unpacker (@mimir/sindri, packages/sindri): it runs a packed PRG in an emulated C64, follows it
 * through its layers (coders, movers, decrunchers) and saves the program as it starts; with the disk the file came
 * from, a 1541 is on the serial bus and the program goes on loading. Here: a run whose result can be posted from a
 * worker, the packers the layers' fingerprints name, and the layer report the app and the CLI show.
 * ===================================================================== */
import { notPacked as ranAsItIs, NOT_PACKED, unpack, vsfMachine, type LayerReport, type Roms, type StartIo, type UnpackResult } from '@mimir/sindri';
import { readTape } from './c64/tap';
import { h4 } from './util/hex';

export type { LayerReport, Roms } from '@mimir/sindri';

/** A run of Sindri without its save() function, so that it can cross a worker boundary; `snapshot`: it went on from
 *  a VICE snapshot whose CPU was there; `boot`: the file is one a loader on the tape loads, and Sindri ran the tape's
 *  boot file too (BootRun) */
export type UnpackRun = Omit<UnpackResult, 'save'> & { snapshot?: number; boot?: BootRun };

/**
 * A file of a turbo loader that did not run from where it loads (a crash, a JAM: a Wildload chain's block is a part of
 * the program, not its start), and the run of the tape's boot file that loads it (tapeBoot), as LOAD and RUN on a C64.
 * `after`: the first layer of the boot's run that started once the tape had passed the file (its loader had loaded
 * it); the run is then the boot's, and it unpacked the file when a layer from there on unpacked something (the
 * program the loader started). `loading`: the layers from there on that are the loader going on: the tape passed the
 * end of another file on it while they ran (Firetrack's second stage at $1000, which loads the rest of the chain, is
 * no depacker of the blocks before it). Null: the boot's loader never got past the file in the run (a level the game
 * loads later), and the run is the file's own. `from: 'disk'`: the boot file is a disk's (UnpackDiskBoot), and `after`
 * is the first layer that started once the layers before it had written every byte of the file.
 */
export interface BootRun { name: string; after: number | null; loading: number[]; alone: { entry: number; stop: UnpackResult['stop'] }; from?: 'disk' }

/** A file a loader on a disk loads that the directory does not list (a Disk-Speed file from its table), when it does not
 *  run alone: the disk's boot file, which LOAD and RUN start and whose loader loads the file with the rest of the
 *  program, and where the file lies in memory once loaded (its first and last address). */
export interface UnpackDiskBoot { name: string; prg: Uint8Array; start: number; end: number }

/** "tape" or "disk": where the boot file of a run from it is */
const bootMedia = (b: BootRun): string => (b.from === 'disk' ? 'disk' : 'tape');

/** The tape a file came from (a TAP image, or a T64 tape archive) and, when it is not one of its KERNAL files, where
 *  the tape stands once the file has loaded (a pulse: TapeFile.to; a T64's slot after the file). `boot`: the file is
 *  one a loader on the tape loads (a turbo file), and this KERNAL program before it is the boot file whose loader does
 *  (tapeBoot): its name, its PRG and where the tape stands after it (its TapeFile.to). */
export interface UnpackTape { tap: Uint8Array; at?: number | null; boot?: { name: string; prg: Uint8Array; at: number } | null }

/**
 * The program is not packed: it ran as it is (Sindri's notPacked: one layer, it settled or went back to READY, no BRK
 * on the way). A turbo file run from the tape's boot is not packed when the program its loader started after loading
 * it ran as it is to such an end.
 */
export function notPacked(run: Pick<UnpackRun, 'unpacked' | 'layers' | 'stop' | 'brk' | 'boot'>): boolean {
  if (run.boot?.after == null) return ranAsItIs(run);
  return !run.unpacked && run.brk == null && conclusive(run);
}

/**
 * Unpack a PRG (load address first); without ROMs Sindri runs with its stand-ins for the KERNAL and BASIC. With
 * the D64 it came from (and the 1541 DOS ROM in `roms`), the drive reads the disk for the program's loader, and
 * `disks`, the release's next sides (nextSides), go in when the program asks for them and waits; with the
 * tape it came from, the datasette plays it from after the file for the program's tape loader. `entry`: start it
 * there (SYS) instead of with RUN, as a program without a BASIC line needs, with `port` in $01 when it is given (a
 * program Sindri saved that starts under the BASIC ROM, $36). `vsf`: the PRG is a VICE snapshot's RAM,
 * and Sindri goes on from the snapshot's machine where it was taken instead (it needs the ROMs; throws when the
 * snapshot is not one Sindri reads): a game stopped in its intro or trainer menu still holds the game packed.
 * `diskBoot`: the file is one a loader on `disk` loads, and when it does not run alone Sindri runs the disk's boot file.
 * `io`: with `entry`, the I/O the program starts in (Saved.io of the run that saved it), set before the jump as Build &
 * Run's start routine sets it.
 */
export function unpackPrg(prg: Uint8Array, roms: Roms | null = null, disk: Uint8Array | null = null, entry: number | null = null, tape: UnpackTape | null = null, vsf: Uint8Array | null = null, port: number | null = null, disks: readonly Uint8Array[] = [], diskBoot: UnpackDiskBoot | null = null, io: StartIo | null = null): UnpackRun {
  const resume = vsf ? vsfMachine(vsf) : null;
  const { save: _save, ...run } = unpack(prg, {
    roms, disk, ...(disk && disks.length ? { disks: [...disks] } : {}), ...(resume ? { resume } : entry != null ? { entry, ...(port != null ? { port } : {}), ...(io ? { io } : {}) } : {}),
    ...(tape ? { tape: tape.tap, ...(tape.at != null ? { tapeAt: tape.at } : {}) } : {}),
  });
  if (resume) return { ...run, snapshot: resume.cpu.pc };
  // a file a disk's loader loads that does not run alone (Elite's 2NDBIT, which the game decodes once all five files
  // are in): Sindri runs the disk from its boot file, as LOAD and RUN do on a C64
  if (diskBoot && disk && entry == null && !run.unpacked && !ranAsItIs(run)) {
    return fromDiskBoot(run, diskBootRun(diskBoot, disk, disks, roms), diskBoot, run.layers[0]?.entry ?? (prg[0] | (prg[1] << 8)));
  }
  // a turbo file that did not run from where it loads (a chain's block SYSed into its data): Sindri runs the tape as a
  // C64 loads it, from the boot file whose loader loads the file with the rest of the program (a start the user set
  // is where it starts)
  const boot = tape?.boot;
  if (!boot || tape.at == null || entry != null || run.unpacked || ranAsItIs(run)) return run;
  const b = bootRun(boot, tape.tap, roms);
  return fromBoot(run, b.run, b.ends, boot.name, tape.at, run.layers[0]?.entry ?? (prg[0] | (prg[1] << 8)));
}

/** the tape's boot file's run, and where the files and turbo stretches on the tape end (pulses), kept for the next file
 *  of the same tape (Unpack, and the check of each file opened from a chain, run the same boot) */
let lastBoot: { key: string; run: UnpackRun; ends: number[] } | null = null;
function bootRun(boot: NonNullable<UnpackTape['boot']>, tap: Uint8Array, roms: Roms | null): { run: UnpackRun; ends: number[] } {
  const key = `${roms?.source ?? '-'}:${boot.at}:${tap.length}:${fnv(tap)}:${fnv(boot.prg)}`;
  if (lastBoot?.key === key) return lastBoot;
  const { save: _save, ...run } = unpack(boot.prg, { roms, tape: tap, tapeAt: boot.at });
  const img = readTape(tap);
  lastBoot = { key, run, ends: [...img.files.map(f => f.to), ...img.unknown.map(u => u.to)] };
  return lastBoot;
}
/** the disk boot file's run, kept for the next file of the same disk */
let lastDiskBoot: { key: string; run: UnpackRun } | null = null;
function diskBootRun(boot: UnpackDiskBoot, disk: Uint8Array, disks: readonly Uint8Array[], roms: Roms | null): UnpackRun {
  const key = `${roms?.source ?? '-'}:${disk.length}:${fnv(disk)}:${fnv(boot.prg)}:${disks.length}`;
  if (lastDiskBoot?.key === key) return lastDiskBoot.run;
  const { save: _save, ...run } = unpack(boot.prg, { roms, disk, ...(disks.length ? { disks: [...disks] } : {}) });
  lastDiskBoot = { key, run };
  return run;
}

/** The file's run (`own`, started at `entry`) or the disk boot's (`b`) once its loader had loaded the file: from the
 *  first layer that started after the layers before it had written or run more than half of `boot.start`-`boot.end`.
 *  (A layer's report keeps what it wrote for the bytes no later layer wrote over and it did not run: Elite's PATCH runs
 *  inside the loader, and the decoder keeps zero page over OVER's first bytes. The code the boot file itself runs, layer
 *  0, is its own: Elite's boot decodes itself at $0334, where PATCH loads later.) */
function fromDiskBoot(own: UnpackRun, b: UnpackRun, boot: UnpackDiskBoot, entry: number): UnpackRun {
  const alone = { entry, stop: own.stop };
  const seen = new Uint8Array(boot.end - boot.start + 1);
  let have = 0, after = -1;
  for (let i = 0; i < b.layers.length; i++) {
    if (have * 2 > seen.length) { after = i; break; }
    for (const w of [...b.layers[i].written, ...(i ? b.layers[i].code : [])]) for (let a = Math.max(w.start, boot.start); a <= Math.min(w.end, boot.end); a++) if (!seen[a - boot.start]) { seen[a - boot.start] = 1; have++; }
  }
  if (after < 0) return { ...own, boot: { name: boot.name, after: null, loading: [], alone, from: 'disk' } };
  const info: BootRun = { name: boot.name, after, loading: [], alone, from: 'disk' };
  return { ...b, unpacked: !!b.saved && afterLoad(b.layers, info, b.saved.layer).length > 0, boot: info };
}

function fnv(u8: Uint8Array): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < u8.length; i++) h = Math.imul(h ^ u8[i], 0x01000193);
  return h >>> 0;
}

/** The file's run (`own`, started at `entry`) or the boot's (`b`) when its loader got past the file (`past`: the pulse
 *  after the file; `ends`: where the tape's files and stretches end): unpacked when a layer that started from there on,
 *  and is not the loader going on, unpacked something before the program it saved */
function fromBoot(own: UnpackRun, b: UnpackRun, ends: number[], name: string, past: number, entry: number): UnpackRun {
  const alone = { entry, stop: own.stop };
  const after = b.layers.findIndex(l => l.tape != null && l.tape >= past);
  if (after < 0) return { ...own, boot: { name, after: null, loading: [], alone } };
  // (a layer the tape passed a file's end in loaded it: the next layer began further on)
  const loading = b.layers.flatMap((l, i) => {
    const from = l.tape, to = b.layers[i + 1]?.tape;
    return i >= after && from != null && to != null && ends.some(e => e > from && e <= to) ? [i] : [];
  });
  const boot = { name, after, loading, alone };
  return { ...b, unpacked: !!b.saved && afterLoad(b.layers, boot, b.saved.layer).length > 0, boot };
}

/** the layers of a boot's run that unpacked something once its loader had loaded the file (from `after`, without the
 *  loader going on), before the program it saved (`upTo`) */
const afterLoad = (layers: LayerReport[], b: Pick<BootRun, 'after' | 'loading'>, upTo: number): LayerReport[] =>
  depackers({ layers: layers.slice(b.after ?? layers.length, upTo).filter(l => !b.loading.includes(l.index)) });

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
  const b = run.boot;
  if (b?.after != null) {
    const loads = `A loader on the ${bootMedia(b)} loads it: Sindri ran the ${bootMedia(b)}'s boot file "${b.name}"`;
    const prog = run.saved ? `; the program starts at $${h4(run.saved.entry)}` : '';
    if (notPacked(run)) return `${loads}, and the program its loader started after loading it ran as it is: not packed (it stopped: ${stopText(run)})`;
    if (!run.unpacked) return `${loads}, and nothing unpacked itself after its loader had loaded it (it stopped: ${stopText(run)})`;
    const d = afterLoad(run.layers, b, run.saved!.layer);
    return `${loads}, and after its loader had loaded it peels off ${d.length} layer${d.length === 1 ? '' : 's'}: ${d.map(depackerText).join(', then ')}${prog}`;
  }
  const never = b ? `; the ${bootMedia(b)}'s boot file "${b.name}", run too, never loaded it` : '';
  if (notPacked(run)) return `${from}Sindri finds it not packed: it ran as it is and never jumped into code it wrote (it stopped: ${stopText(run)})`;
  if (!run.unpacked) return `${from}Sindri peels off no layer (it stopped: ${stopText(run)})${never}`;
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
    // (the program itself, when nothing came off, is no depacker)
    if (l.kind !== 'jump' && l.kind !== 'program') lines.push(`         ${l.packer ? `packer: ${l.packer.name} (${Math.round(l.packer.similarity * 100)}% alike)` : `unknown depacker, fingerprint ${l.fingerprint}`}`);
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

/** The name Unpack gives what unpacking the file `name` leaves: `game.prg` → `game-unpacked.prg`, unpacked again
 *  `game-unpacked_2.prg`, then `game-unpacked_3.prg`: the number counts the Unpacks (`-unpacked-unpacked` from before
 *  counts as two). */
export function unpackedName(name: string): string {
  let base = name.replace(/\.prg$/i, ''), n = 0;
  for (let m: RegExpExecArray | null; (m = /-unpacked(?:_(\d+))?$/i.exec(base)); base = base.slice(0, m.index)) n += m[1] ? Number(m[1]) : 1;
  return `${base}-unpacked${n ? `_${n + 1}` : ''}.prg`;
}

/** The layer report of a run of `name` (a PRG of `size` bytes after its load address), as Sindri's command line prints it. */
export function unpackLog(run: UnpackRun, name: string, load: number, size: number): string {
  const out = [`${name}: ${rangeText({ start: load, end: load + size - 1 })} (${kb(size)})${run.basic.length ? `, ${run.basic.slice(0, 2).join(' / ')}` : ''}`, `ROMs: ${run.roms}`];
  if (run.snapshot != null) out.push(`Snapshot: going on from where it was taken, the CPU at ${hex(run.snapshot)} (its RAM, VIC-II and CIAs; not its 1541)`);
  if (run.drive) out.push(`Drive: ${run.drive}`);
  const b = run.boot;
  // (a file that did not run from where it loads: the tape's or the disk's boot file was run, as on a C64)
  if (b) {
    const media = bootMedia(b);
    out.push(`Alone, started at ${hex(b.alone.entry)}, it stopped: ${stopText(b.alone)}`);
    out.push(b.after != null
      ? `A loader on the ${media} loads it: run from the ${media}'s boot file "${b.name}"; layer ${b.after} on started after its loader had loaded the file${b.loading.length ? ` (layer${b.loading.length === 1 ? '' : 's'} ${b.loading.join(', ')}: the loader going on, loading more of the tape)` : ''}`
      : `The ${media}'s boot file "${b.name}", run too, never loaded it: its loader ${b.from === 'disk' ? 'did not load the file' : 'did not get past the file'}`);
  }
  if (run.tape) out.push(`Tape: ${run.tape}`);
  for (const l of run.layers) out.push(...layerLines(l));
  out.push(`stopped after ${(run.cycles / 985248).toFixed(1)} s of C64 time (${Math.round(run.ms)} ms): ${stopText(run)}`);
  if (!run.unpacked) out.push(!notPacked(run) ? (b?.after != null ? 'nothing was unpacked after its loader had loaded it' : 'nothing was unpacked') : b?.after != null ? 'not packed: the program its loader started ran as it is and never jumped into code it wrote' : NOT_PACKED);
  else if (run.saved) {
    const s = run.saved;
    const port = s.port !== 0x37 ? `, $01=$${s.port.toString(16).padStart(2, '0')}` : '';
    const start = s.basic ? `RUN (SYS ${s.entry} = ${hex(s.entry)}${port})` : `SYS ${s.entry} = ${hex(s.entry)}${port}${s.interrupts ? '' : ', interrupts off'}`;
    out.push(`saved layer ${s.layer}: ${rangeText(s)} (${kb(s.prg.length - 2)}), start with ${start}${s.io ? `, and the I/O it started in (${ioSummary(s.io)})` : ''}`);
  }
  return out.join('\n');
}

/**
 * The I/O a program starts in (Saved.io) in a few words: "43 steps: VIC bank 1, 36 VIC registers, the raster interrupt
 * on, CIA 1's interrupts off, CIA 1's timer B, the SID's volume 15".
 */
export function ioSummary(io: StartIo): string {
  const w = io.steps.filter(s => s.value != null), parts: string[] = [];
  const at = (a: number) => w.filter(s => s.at === a);
  const bank = at(0xdd00).at(-1);
  if (bank) parts.push(`VIC bank ${3 - (bank.value! & 3)}`);
  const vic = w.filter(s => s.at >= 0xd000 && s.at < 0xd02f && s.at !== 0xd019 && s.at !== 0xd01a).length;
  if (vic) parts.push(`${vic} VIC register${vic === 1 ? '' : 's'}`);
  const raster = at(0xd01a).at(-1);
  if (raster) parts.push(`the raster interrupt ${raster.value! & 1 ? 'on' : 'off'}`);
  for (const [n, base] of [[1, 0xdc00], [2, 0xdd00]] as const) {
    const icr = at(base + 0x0d), set = icr.find(s => s.value! & 0x80);
    if (icr.length) parts.push(`CIA ${n}'s interrupts ${set ? `$${(set.value! & 0x1f).toString(16).padStart(2, '0')}` : 'off'}`);
    const timers = [['A', 4], ['B', 6]].filter(([, r]) => at(base + (r as number)).length).map(([t]) => t);
    if (timers.length) parts.push(`CIA ${n}'s timer${timers.length > 1 ? 's' : ''} ${timers.join(' and ')}`);
  }
  const volume = at(0xd418).at(-1);
  if (volume) parts.push(`the SID's volume ${volume.value! & 15}`);
  if (!io.interrupts) parts.push('interrupts off');
  return `${io.steps.length} step${io.steps.length === 1 ? '' : 's'}${parts.length ? `: ${parts.join(', ')}` : ''}`;
}
