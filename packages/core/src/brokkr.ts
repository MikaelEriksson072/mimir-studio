/* =====================================================================
 * Brokkr, the built-in cruncher (@mimir/brokkr, packages/brokkr): it packs the built PRGs, or ranges of them, as the
 * Pack view says (spec 13.8), into Exomizer 3's format or Brokkr's own. A self-extracting file is run in Brokkr's
 * emulated C64 before it is handed over, and compared with what was packed; a mem file's stream is decrunched
 * again. The result has the shape of an Exomizer run, so the Pack view shows either the same way, with the command
 * line of the standalone Brokkr that makes the same file.
 * ===================================================================== */
import {
  BrokkrError, checkDecruncher, crunchBrk, crunchData, crunchFast, decruncherFile, decruncherNeeds, memBrkFile, memCrunchOptions, memFastFile, memFile, sfxAsync, T,
  type CrunchOptions, type Crunched, type DecruncherFile, type DecruncherNeeds, type DecruncherOptions, type SfxPlace, type Start,
} from '@mimir/brokkr';
import type { PackPrefs } from './types';
import { mergeRanges, packEffective, packOptions, packFileName, packImage, packInputs, packOutName, packParts, shellWord, type ExomizerReport, type PackCheck, type PackFile, type PackPart } from './pack';
import { h2, h4 } from './util/hex';

/** A crunch: here (the default), or on a pool of threads (node/brokkr.ts). */
export type BrokkrCrunch = (data: Uint8Array, o: CrunchOptions) => Promise<Crunched>;
export const crunchHere: BrokkrCrunch = async (d, o) => crunchData(d, o);

/** A file a pack writes, with what it is (the Pack view lists them): packed (self-extracting, or crunched data), or the
 * decruncher written next to crunched data, as a PRG or as source. */
export interface PackedFile { name: string; prg: Uint8Array; kind: 'packed' | 'decruncher' | 'source'; note: string }

export interface BrokkrPack {
  ok: boolean;
  /** what Brokkr's command line would print */
  output: string;
  /** the standalone Brokkr's command that makes the (first) file, in the pack folder */
  argv: string[];
  /** its commands for all the files */
  commands: string[][];
  ms: number;
  /** the (first) packed file's name (made unique against the inputs) and bytes */
  name?: string;
  prg?: Uint8Array;
  /** every file it writes: the packed files, and next to crunched data the decruncher's source and PRG */
  files?: PackedFile[];
  /** the inputs as the command names them, to write next to the packed file */
  inputs: { name: string; prg: Uint8Array }[];
  packed: { start: number; length: number } | null;
  report: ExomizerReport;
  check: PackCheck | null;
  error?: string;
}

const $4 = (v: number) => `$${h4(v)}`;
const $2 = (v: number) => `$${h2(v)}`;
const range = (s: number, e: number) => `${$4(s)}–${$4(e - 1)}`;

/** mem with compatibility: no literal sequences, and still none of the lengths exodecrunch.s gets wrong (-T5) */
const COMPAT_TRAITS = T.NO_LIT_SEQ | T.NO_MIRRORS;

/** The standalone Brokkr's arguments for these settings (`inputs` as packInputs names them); the settings that take no
 * effect (packOptions) are left out. */
export function brokkrArgs(prefs: PackPrefs, inputs: readonly string[], out: string): string[] {
  const p = packEffective(prefs);
  const args = ['brokkr', p.mode];
  if (p.format !== 'exomizer') args.push('--format', p.format);
  if (p.mode === 'sfx') {
    args.push('--start', p.start === 'jmp' ? $4(p.jmp ?? 0) : p.start);
    if (p.effect === 'none') args.push('--no-effect');
    if (p.ramExit != null) args.push('--ram-exit', $2(p.ramExit));
    if (p.irqExit != null) args.push('--irq', p.irqExit ? 'on' : 'off');
    if (p.zp != null) args.push('--zp', $2(p.zp));
    if (p.decruncherAt != null) args.push('--at', $4(p.decruncherAt));
    if (p.tablesAt != null) args.push('--table', $4(p.tablesAt));
    if (p.keep.length) args.push('--keep', p.keep.map(r => `${$4(r.start)}-${$4(r.end - 1)}`).join(','));
  } else {
    if (p.forward) args.push('-f');
    if (p.memLoad !== 'auto') args.push('-l', p.memLoad === 'none' ? 'none' : $4(p.memLoad));
    if (p.compat) args.push('-T', String(COMPAT_TRAITS));
  }
  if (p.effort !== 'normal') args.push('--effort', p.effort);
  return [...args, '-o', out, ...inputs];
}

/** What Brokkr's decruncher takes with these settings before anything is crunched: while a self-extracting file
 * decrunches, or the one written next to crunched data. Its resident part (the code), its tables and its zero page
 * (the Pack view says from it where each would end). */
export const packNeeds = (prefs: PackPrefs): DecruncherNeeds => {
  const p = packEffective(prefs);
  if (p.mode === 'mem') {
    // exactly: the code is as long anywhere above the zero page
    const d = decruncherFile({ ...decruncherOptions(p), zp: undefined, at: 0x1000, table: 0x2000 });
    const code = d.end - d.start, tables = d.tables ? d.tables.end - d.tables.start : 0;
    return {
      resident: { min: code, max: code }, zp: d.zp.end - d.zp.start,
      tables: { what: p.format === 'brokkr' ? 'probabilities and quarter squares' : tables ? 'decrunch table' : 'no tables', min: tables, max: tables, align: p.format === 'brokkr' ? 256 : 1 },
    };
  }
  return decruncherNeeds({ format: p.format, start: p.start === 'jmp' ? 0x1000 : p.start, effect: p.effect !== 'none', ramExit: p.ramExit ?? undefined, irqExit: p.irqExit ?? undefined });
};

/** the decruncher of crunched data for these (effective) settings, as Brokkr writes it */
const decruncherOptions = (p: PackPrefs): DecruncherOptions => ({
  format: p.format, zp: p.zp ?? undefined, at: p.decruncherAt ?? undefined, table: p.tablesAt ?? undefined,
  literalSequences: !(p.format === 'exomizer' && p.compat),
});

const decrunchers = new Map<string, DecruncherFile | string>();
/** The decruncher written next to crunched data with these settings (its source, PRG and what it takes), or what is
 * wrong with where it goes. */
export function packDecruncher(prefs: PackPrefs): DecruncherFile | string {
  const o = decruncherOptions(packEffective(prefs)), key = JSON.stringify(o);
  let d = decrunchers.get(key);
  if (!d) {
    try { d = decruncherFile(o); } catch (e) { d = e instanceof BrokkrError ? `${e.message}${e.hint ? ` ${e.hint}` : ''}` : (e as Error).message; }
    if (decrunchers.size > 32) decrunchers.clear();
    decrunchers.set(key, d);
  }
  return d;
}

/** What Brokkr writes: the packed files with the parts each packs (one; for crunched data with `split`, one for each
 * range chosen, or for each PRG of the whole build), and next to crunched data the decruncher's source and PRG. */
export interface BrokkrPlan { files: { out: string; parts: PackPart[] }[]; decruncher: { source: string; prg: string } | null }

export function brokkrPlan(typed: PackPrefs, files: readonly PackFile[]): BrokkrPlan {
  const prefs = packEffective(typed);
  const out = packOutName(prefs, files[0]?.name ?? 'packed.prg');
  const groups = (prefs.split ? prefs.ranges ? mergeRanges(prefs.ranges).map(r => packParts([r], files)) : files.map(f => packParts(null, [f])) : []).filter(g => g.length);
  const ext = /\.\w+$/.exec(out)![0], base = out.slice(0, -ext.length);
  const used = new Set<string>();
  const named = groups.length > 1 ? groups.map(parts => {
    let name = packFileName(`${base}-${h4(Math.min(...parts.map(p => p.start)))}`, ext);
    for (let k = 2; used.has(name.toLowerCase()); k++) name = packFileName(`${base}-${h4(Math.min(...parts.map(p => p.start)))}-${k}`, ext);
    used.add(name.toLowerCase());
    return { out: name, parts };
  }) : [{ out, parts: packParts(prefs.ranges, files) }];
  return { files: named, decruncher: packOptions(prefs).decruncher && prefs.decruncher ? { source: packFileName(`${base}-decrunch`, '.asm'), prg: packFileName(`${base}-decrunch`, '.prg') } : null };
}

/** The standalone Brokkr's commands that make the files of the plan, in the pack folder. */
export function brokkrCommands(typed: PackPrefs, plan: BrokkrPlan): string[][] {
  const p = packEffective(typed);
  const commands = plan.files.map(f => brokkrArgs(p, packInputs(f.parts), f.out));
  if (plan.decruncher) {
    const args = ['brokkr', 'decruncher'];
    if (p.format !== 'exomizer') args.push('--format', p.format);
    if (p.zp != null) args.push('--zp', $2(p.zp));
    if (p.decruncherAt != null) args.push('--at', $4(p.decruncherAt));
    if (p.tablesAt != null) args.push('--table', $4(p.tablesAt));
    if (p.format === 'exomizer' && p.compat) args.push('--no-literal-sequences');
    commands.push([...args, '-o', plan.decruncher.source], [...args, '-o', plan.decruncher.prg]);
  }
  return commands;
}

/** where the decruncher works, as the settings say (none: Brokkr places all of it) */
const placeOf = (p: PackPrefs): SfxPlace | undefined =>
  p.zp == null && p.decruncherAt == null && p.tablesAt == null && !p.keep.length ? undefined
    : { zp: p.zp ?? undefined, decruncher: p.decruncherAt ?? undefined, tables: p.tablesAt ?? undefined, keep: p.keep.map(r => [r.start, r.end] as [number, number]) };

const empty = (): ExomizerReport => ({ crunched: null, saved: null, layout: [], decruncher: [], entry: null, errors: [] });

/** Pack the built PRGs (load address first, in project order) as `prefs` says, with Brokkr. */
export async function packWithBrokkr(files: readonly { name: string; prg: Uint8Array }[], typed: PackPrefs, crunch: BrokkrCrunch = crunchHere): Promise<BrokkrPack> {
  const t0 = performance.now();
  const prefs = packEffective(typed);
  // the inputs get names the command line reads as one file name, distinct from each other and from the output
  const used = new Set<string>();
  const named = files.map((f, i) => {
    let name = packFileName(f.name);
    if (used.has(name.toLowerCase())) name = packFileName(`${f.name.replace(/\.prg$/i, '')}-${i + 1}`);
    used.add(name.toLowerCase());
    return { name, load: f.prg[0] | (f.prg[1] << 8), bytes: f.prg.subarray(2), prg: f.prg };
  });
  const plan = brokkrPlan(prefs, named), out = plan.files[0].out;
  const parts = packParts(prefs.ranges, named);
  const image = packImage(parts);
  const commands = brokkrCommands(prefs, plan);
  const base = { argv: commands[0], commands, inputs: named.map(f => ({ name: f.name, prg: f.prg })), packed: image && { start: image.start, length: image.bytes.length } };
  const fail = (error: string, output = ''): BrokkrPack => ({ ok: false, output, ms: performance.now() - t0, report: empty(), check: null, error, ...base });
  if (!files.length || files.some(f => f.prg.length < 3)) return fail('There is no built PRG to pack.');
  const outs = [...plan.files.map(f => f.out), ...(plan.decruncher ? [plan.decruncher.source, plan.decruncher.prg] : [])];
  const taken = outs.find(o => used.has(o.toLowerCase()));
  if (taken) return fail(`The packed file cannot be called ${taken}: that is the name of a file it packs.`);
  if (!image) return fail('None of the chosen blocks is in the built files.');
  if (prefs.mode === 'sfx' && prefs.start === 'jmp' && prefs.jmp == null) return fail('Enter the address the program starts at after decrunching.');
  const own = prefs.format === 'brokkr' || prefs.format === 'fast';

  const crunchOptions: CrunchOptions = { effort: prefs.effort, protocol: prefs.compat ? { traits: COMPAT_TRAITS } : {} };
  const lines = [`${named.map(f => f.name).join(', ')}: ${range(image.start, image.start + image.bytes.length)}, ${image.bytes.length} bytes`];
  try {
    if (prefs.mode === 'sfx') {
      const start: Start = prefs.start === 'jmp' ? prefs.jmp! : prefs.start;
      const r = await sfxAsync(image.bytes, image.start, {
        start, ramExit: prefs.ramExit ?? undefined, irqExit: prefs.irqExit ?? undefined, effect: prefs.effect !== 'none', crunch: crunchOptions,
        format: prefs.format, place: placeOf(prefs),
      }, crunch);
      const layout = r.areas.filter(a => a.name !== 'File').map(a => ({ name: a.name, start: a.start, end: a.end, ...(a.note ? { note: a.note } : {}) }));
      for (const a of r.areas) lines.push(`  ${a.name.padEnd(16)} ${range(a.start, a.end)}${a.note ? `  ${a.note}` : ''}`);
      lines.push(`  $01 ${$2(r.ramDuring)} while decrunching, ${$2(r.ramExit)} after; interrupts ${r.irqExit ? 'on' : 'off'} after; ${r.basic ? 'RUN' : `jmp ${$4(r.entry)}`}`);
      lines.push(`  checked in an emulated C64: ${r.cycles} cycles (${(r.cycles / 985248).toFixed(2)} s)`);
      for (const w of r.warnings) lines.push(`  note: ${w}`);
      lines.push(`${out}: ${r.prg.length} bytes (${(100 * r.prg.length / image.bytes.length).toFixed(1)} % of ${image.bytes.length})`);
      const report: ExomizerReport = {
        crunched: r.stream.length, saved: { start: 0x0801, end: 0x0801 + r.prg.length - 2 }, layout,
        decruncher: [
          { what: 'RAM config', enter: '$37', during: $2(r.ramDuring), exit: $2(r.ramExit) },
          { what: 'IRQ enabled', enter: '1', during: '0', exit: r.irqExit ? '1' : '0' },
        ],
        entry: r.basic ? null : r.entry, errors: [],
      };
      const check: PackCheck = {
        status: 'same',
        text: `Decrunched in Brokkr's emulated C64: ${range(image.start, image.start + image.bytes.length)} has the same ${image.bytes.length} bytes, and it ${r.basic ? 'RUNs the BASIC program' : `starts at ${$4(r.entry)}`} after ${(r.cycles / 985248).toFixed(2)} s.`,
      };
      return { ok: true, output: lines.join('\n'), ms: performance.now() - t0, name: out, prg: r.prg, files: [{ name: out, prg: r.prg, kind: 'packed', note: 'self-extracting' }], report, check, ...base };
    }
    // crunched data: each file of the plan on its own, then the decruncher for all of them
    const mo = { forward: prefs.forward, load: prefs.memLoad, crunch: crunchOptions };
    const crunched: { name: string; data: { start: number; bytes: Uint8Array }; bytes: Uint8Array; at: { start: number; end: number } | null; inPlace: { start: number; end: number }; stream: number }[] = [];
    for (const f of plan.files) {
      const img = packImage(f.parts)!, data = img.bytes;
      const r = prefs.format === 'brokkr'
        ? memBrkFile(data, img.start, crunchBrk(data.slice().reverse(), { effort: prefs.effort }), mo)
        : prefs.format === 'fast'
        ? memFastFile(data, img.start, crunchFast(data.slice().reverse(), { effort: prefs.effort }), mo)
        : memFile(data, img.start, await crunch(prefs.forward ? data : data.slice().reverse(), memCrunchOptions(mo)), mo);
      const stream = 'brk' in r ? r.brk : 'fast' in r ? r.fast : r.crunched;
      if (plan.files.length > 1) lines.push(`  ${range(img.start, img.start + data.length)} (${data.length} bytes) -> ${f.out}`);
      lines.push(`  in place it loads at ${range(r.inPlace.start, r.inPlace.end)} (safety ${stream.safety})`);
      for (const w of r.warnings) lines.push(`  note: ${w}`);
      lines.push(`${f.out}: ${r.bytes.length} bytes${r.at ? ` at ${range(r.at.start, r.at.end)}` : ''}`);
      crunched.push({ name: f.out, data: img, bytes: r.bytes, at: r.at, inPlace: r.inPlace, stream: stream.stream.length });
    }
    const one = crunched.length === 1 ? crunched[0] : null;
    const layout: ExomizerReport['layout'] = one ? [
      ...(one.at ? [{ name: 'Crunched data', start: one.at.start, end: one.at.end }] : []),
      { name: 'Decrunched data', start: one.data.start, end: one.data.start + one.data.bytes.length },
    ] : [];
    const written: PackedFile[] = crunched.map(c => ({
      name: c.name, prg: c.bytes, kind: 'packed',
      note: `${range(c.data.start, c.data.start + c.data.bytes.length)}${c.at ? `, loaded at ${range(c.at.start, c.at.end)}: stream ${$4(c.at.end)}` : ': stream the address after its last byte, where it is loaded'}`,
    }));
    let check: PackCheck;
    if (plan.decruncher) {
      // the decruncher, with the files it decrunches named at the top of its source; each file runs through its PRG
      const d = decruncherFile({ ...decruncherOptions(prefs), notes: [
        `Brokkr's decruncher, written by Mimir Studio for ${crunched.length === 1 ? 'the file' : 'the files'} crunched with it. For each, set`,
        'stream to the address after its last byte as loaded, then jsr decrunch:',
        ...crunched.map(c => `  ${c.name}: ${c.at ? `loaded at ${range(c.at.start, c.at.end)}, stream ${$4(c.at.end)}` : `loaded where you like (${c.bytes.length} bytes)`}, decrunches to ${range(c.data.start, c.data.start + c.data.bytes.length)}`),
      ] });
      const { source, prg } = plan.decruncher;
      layout.push({ name: 'Decruncher', start: d.start, end: d.end, note: `zero page ${$2(d.zp.start)}-${$2(d.zp.end - 1)}` });
      if (d.tables) layout.push({ name: prefs.format === 'brokkr' ? 'Decrunch tables' : 'Decrunch table', start: d.tables.start, end: d.tables.end });
      const stream = d.stream < 0x100 ? $2(d.stream) : $4(d.stream);
      written.push(
        { name: prg, prg: d.prg, kind: 'decruncher', note: `the decruncher at ${range(d.start, d.end)}: set stream (${stream}) to the address after a file's last byte, then jsr ${$4(d.entry)}` },
        { name: source, prg: new TextEncoder().encode(d.source), kind: 'source', note: `the decruncher as Kick Assembler source, to #import${prefs.decruncherAt == null ? ' (it goes where it is imported)' : ''}` },
      );
      lines.push(`${prg}: Brokkr's decruncher at ${range(d.start, d.end)}, jsr ${$4(d.entry)} with stream ${stream}; zero page ${$2(d.zp.start)}–${$2(d.zp.end - 1)}${d.tables ? `, tables ${range(d.tables.start, d.tables.end)}` : ''}`);
      lines.push(`${source}: the same decruncher as Kick Assembler source`);
      let cycles = 0, port = 0x37, wrong: string | null = null;
      for (const c of crunched) {
        // a .bin is loaded where it decrunches in place
        const file = c.at ? { start: c.at.start, bytes: c.bytes.subarray(2) } : { start: c.inPlace.start, bytes: c.bytes };
        try { const r = checkDecruncher(d, file, c.data, c.name); cycles += r.cycles; port = Math.min(port, r.port); } catch (e) {
          if (!(e instanceof BrokkrError)) throw e;
          wrong = `${e.message}${e.hint ? ` ${e.hint}` : ''}`;
          break;
        }
      }
      const ram = port === 0x34 ? 'RAM under I/O and the ROMs' : port === 0x35 ? 'RAM under the ROMs' : 'RAM under BASIC';
      check = wrong ? { status: 'differs', text: wrong } : {
        status: 'same',
        text: `Decrunched by ${prg} in Brokkr's emulated C64: ${one ? `${range(one.data.start, one.data.start + one.data.bytes.length)} has the same ${one.data.bytes.length} bytes` : `each of the ${crunched.length} files gives the same bytes`}, in ${(cycles / 985248).toFixed(2)} s${crunched.length > 1 ? ' in all' : ''}.${port !== 0x37 ? ` It needs $01 = ${$2(port)} while it decrunches (${ram}); the decruncher leaves $01 as it is.` : ''}`,
      };
      lines.push(`  checked in an emulated C64: ${check.text}`);
    } else {
      check = {
        status: 'same',
        text: one
          ? `Brokkr decrunched the stream again: the same ${one.data.bytes.length} bytes. In place it loads at ${$4(one.inPlace.start)}${prefs.forward ? ` and ends at ${$4(one.inPlace.end - 1)}` : ' or lower'}.${own ? ` Decrunch it with Brokkr's decruncher of its ${prefs.format === 'fast' ? 'fast' : 'own'} format (brokkr decruncher --format ${prefs.format}).` : ''}`
          : `Brokkr decrunched each of the ${crunched.length} streams again: the same bytes.`,
      };
    }
    const report: ExomizerReport = { crunched: crunched.reduce((n, c) => n + c.stream, 0), saved: crunched[0].at, layout, decruncher: [], entry: null, errors: [] };
    // a file for each part: the bytes packed are the parts', not all the memory from the first to the last
    const packed = one ? base.packed : { start: crunched[0].data.start, length: crunched.reduce((n, c) => n + c.data.bytes.length, 0) };
    return { ok: true, output: lines.join('\n'), ms: performance.now() - t0, name: out, prg: crunched[0].bytes, files: written, report, check, ...base, packed };
  } catch (e) {
    const msg = e instanceof BrokkrError ? `${e.message}${e.hint ? ` ${e.hint}` : ''}` : (e as Error).message;
    const code = e instanceof BrokkrError ? `${e.code}: ` : '';
    return fail(msg, [...lines, `brokkr: ${code}${msg}`].join('\n'));
  }
}

/** The command as a line to show (and type in the pack folder). */
export const brokkrCommandText = (argv: readonly string[]): string => argv.map(shellWord).join(' ');
