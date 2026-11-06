/* Brokkr's command line. `node src/cli.ts <command> [options] <files>`; --json prints one JSON object (the result,
 * or the error with its code), for editors and build tools. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { crunchBrk, type BrkCrunched } from './crunch-brk.ts';
import { crunchFast, type FastCrunched } from './fast.ts';
import { crunchData, PROFILES, type CrunchOptions, type Crunched, type Effort } from './crunch.ts';
import { Disk } from './d64.ts';
import { checkMem, decruncherFile } from './decrunch-file.ts';
import { BrokkrError, CheckError, h2, h4, span } from './errors.ts';
import { memBrkFile, memCrunchOptions, memFastFile, memFile, rawBrk, rawFast, rawFile, type MemOptions } from './files.ts';
import { encodingText, parseEncoding, protocol, type Protocol } from './format.ts';
import { defaultThreads, Pool } from './node.ts';
import { crunchSearch } from './search.ts';
import { LONG_SECONDS, PAL_HZ, sfxAsync, type SfxFormat, type SfxPlace, type SfxResult, type Start } from './sfx.ts';

const USAGE = `Brokkr, a C64 cruncher: Exomizer 3 streams, smaller and faster; or its own formats, smaller still or
faster to decrunch

usage: brokkr <command> [options] <file>...

commands:
  sfx <file>...          a self-extracting program (loads at $0801, starts with RUN)
  mem <file>...          crunched data with its address, decrunched in place (exomizer mem)
  raw <file>...          a bare stream (exomizer raw)
  d64 <disk> [name]...   list a disk, or pack the files named on it (sfx where they start
                         with a SYS line, mem where not) into a new disk image
  decruncher             write Brokkr's 6502 decruncher of mem files: Kick Assembler source, or with
                         -o <file>.prg the decruncher assembled at --at ($c000), to load and jsr to

files: a .prg (its load address first), <file>@<address> for raw bytes, or as Exomizer takes
a part of a file, <file>,<address>[,<offset>[,<length>]]; several are merged into one memory
image (a later one wins, gaps are zero).

options:
  -o <file>              the output (default: <first file>-brokkr.prg, .bin, .d64; brokkr_decrunch.asm)
  --format <f>           exomizer (default): Exomizer 3's format; brokkr: Brokkr's own, about 6.5 %
                         smaller, decrunched about 8 times slower with 0.9-1.9 KB more RAM; fast: Brokkr's
                         fast one, whole bytes, about 13 % larger and decrunched about 1.8 times as fast;
                         auto (sfx, d64): each, and the smallest file
  --max-seconds <s>      with auto: the longest the file may take to decrunch on a PAL C64
  --effort <e>           fast, normal (default) or max (every core, a thorough search)
  --threads <n>          threads for --effort max (default ${defaultThreads()})
  --json                 print the result as JSON
  -q                     print nothing but errors
  --dump <folder>        when a check in the emulated C64 fails: save the program, the file and the
                         emulated memory there, for a report
sfx:
  --start <s>            sys (the program's SYS, default), basic (RUN), or an address
  --ram-exit <$01>       $01 after decrunching (default $37)
  --irq <on|off>         interrupts after decrunching (default on with the KERNAL in)
  --no-effect            no border flashing
  --four-tables [auto|off] a table of its own for length 3 (-P+16); auto tries both
  --zp <a>  --at <a>  --table <a>
                         where the decruncher keeps its zero page bytes, its resident part and its
                         tables while it decrunches (default: where Brokkr finds room)
  --keep <a-b>[,<a-b>]   memory the decruncher, its tables and the crunched data stay out of
                         (also for d64)
mem (checked with Brokkr's 6502 decruncher in the emulated C64):
  -f                     crunch forward
  -l <address|none>      the load address (default: in place)
raw:
  -b                     backward;  -r  write it reversed
exomizer's stream options (mem and raw, Exomizer's format):
  -P <bits>  -T <bits>  -M <length>  -m <offset>  -e <encoding>  -E (no encoding in the stream)
d64:
  --mode <sfx|mem>       pack every named file this way
decruncher:
  --zp <a> --table <a> --at <a> --four --no-reuse --effect --no-literal-sequences
  with --format brokkr: --zp <a> --table <page> (1.5 KB, default the page after the decruncher)
                        --small (0.5 KB, slower) --at <a> --effect
  with --format fast: --zp <a> --at <a>
`;

interface Args { _: string[]; [k: string]: string | boolean | string[] }

/** the options with a value, the ones without, and those whose value may be left out (with the values they take) */
const VALUES = new Set(['o', 'dump', 'max-seconds', 'keep', 'format', 'effort', 'threads', 'start', 'ram-exit', 'irq', 'l', 'P', 'T', 'M', 'm', 'e', 'mode', 'zp', 'table', 'at']);
const FLAGS = new Set(['json', 'q', 'help', 'h', 'f', 'b', 'r', 'E', 'small', 'effect', 'four', 'no-reuse', 'no-literal-sequences', 'no-effect']);
const OPTIONAL: Record<string, string[]> = { 'four-tables': ['on', 'off', 'auto'] };
/** Exomizer's options that Brokkr writes otherwise */
const EXOMIZER: Record<string, string> = { n: '--no-effect', c: '-T 5', C: '--effort fast', x: 'the border flash, on unless --no-effect' };

/**
 * The arguments: `--name value` or `--name=value`, and as Exomizer takes them a one-letter option's value right after
 * it (`-P39`, `-P+16`, `-m1024`, `-T4`). An option Brokkr does not have is an error, not a file name or a setting left
 * at its default: a stream crunched with other settings than the decruncher's reads wrong.
 */
function parseArgs(argv: string[]): Args {
  const a: Args = { _: [] };
  const known = (k: string) => VALUES.has(k) || FLAGS.has(k) || k in OPTIONAL;
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--') { a._.push(...argv.slice(i + 1)); break; }
    if (!t.startsWith('-') || t === '-' || /^-\d/.test(t)) { a._.push(t); continue; }
    const body = t.replace(/^--?/, ''), eq = body.indexOf('=');
    let k = eq < 0 ? body : body.slice(0, eq), v: string | undefined = eq < 0 ? undefined : body.slice(eq + 1);
    // -P39: a one-letter option with its value after it
    if (!t.startsWith('--') && !known(k) && VALUES.has(t[1]) && /^[A-Za-z]$/.test(t[1])) { k = t[1]; v = t.slice(2); }
    if (FLAGS.has(k)) {
      if (v != null) throw new BrokkrError('BRK-E017', `The option ${t.slice(0, t.indexOf('='))} takes no value.`);
      a[k] = true;
    } else if (k in OPTIONAL) {
      if (v == null && OPTIONAL[k].includes(argv[i + 1])) v = argv[++i];
      if (v != null && !OPTIONAL[k].includes(v)) throw new BrokkrError('BRK-E017', `--${k} is ${OPTIONAL[k].join(', ')} or nothing, not "${v}".`);
      a[k] = v ?? OPTIONAL[k][0];
    } else if (VALUES.has(k)) {
      if (v == null) {
        if (i + 1 >= argv.length) throw new BrokkrError('BRK-E001', `The option ${t} needs a value.`);
        v = argv[++i];
      }
      a[k] = v;
    } else {
      throw new BrokkrError('BRK-E017', `Brokkr has no option ${t}.`, EXOMIZER[t[1]] && !t.startsWith('--') ? `Exomizer's -${t[1]} is ${EXOMIZER[t[1]]} in Brokkr.` : 'brokkr --help lists them.');
    }
  }
  return a;
}

/** a number as C64 people write it: $hex, 0xhex, %binary or decimal */
export function number(s: string, what: string): number {
  const t = s.trim();
  const v = /^\$[0-9a-f]+$/i.test(t) ? parseInt(t.slice(1), 16) : /^0x[0-9a-f]+$/i.test(t) ? parseInt(t, 16)
    : /^%[01]+$/.test(t) ? parseInt(t.slice(1), 2) : /^\d+$/.test(t) ? Number(t) : NaN;
  if (!Number.isFinite(v)) throw new BrokkrError('BRK-E002', `${what} "${s}" is not a number ($c000, 49152 or %1100...).`);
  return v;
}

interface Input { name: string; start: number; bytes: Uint8Array }

function loadInputs(names: string[]): { inputs: Input[]; start: number; data: Uint8Array } {
  if (!names.length) throw new BrokkrError('BRK-E003', 'Name a file to crunch.');
  const inputs = names.map(n => {
    // file@address (raw bytes there), or Exomizer's file,address[,offset[,length]] (a part of the file)
    const at = /^(.*)@([$%\w]+)$/.exec(n), part = at ? null : /^(.*?),([$%\w]+)(?:,(\d+))?(?:,(\d+))?$/.exec(n);
    const file = at ? at[1] : part ? part[1] : n;
    let bytes: Uint8Array;
    try { bytes = new Uint8Array(readFileSync(file)); }
    catch { throw new BrokkrError('BRK-E004', `"${file}" cannot be read.`); }
    if (at) {
      const start = number(at[2], 'The address');
      return { name: file, start, bytes: /\.prg$/i.test(file) ? bytes.subarray(2) : bytes };
    }
    if (part) {
      const body = /\.prg$/i.test(file) ? bytes.subarray(2) : bytes;
      const offset = part[3] != null ? Number(part[3]) : 0, length = part[4] != null ? Number(part[4]) : body.length - offset;
      if (offset + length > body.length) throw new BrokkrError('BRK-E011', `"${n}" asks for bytes ${offset}-${offset + length - 1} of a file of ${body.length}.`);
      return { name: file, start: number(part[2], 'The address'), bytes: body.subarray(offset, offset + length) };
    }
    if (bytes.length < 3) throw new BrokkrError('BRK-E005', `"${file}" is too short for a PRG (a load address and at least a byte).`, 'Give raw bytes an address: file.bin@$1000.');
    return { name: file, start: bytes[0] | (bytes[1] << 8), bytes: bytes.subarray(2) };
  });
  const start = Math.min(...inputs.map(i => i.start)), end = Math.max(...inputs.map(i => i.start + i.bytes.length));
  if (end > 0x10000) {
    const i = inputs.find(x => x.start + x.bytes.length > 0x10000)!;
    throw new BrokkrError('BRK-E006', `"${i.name}" at ${h4(i.start)} is ${i.bytes.length} bytes and goes past $ffff.`);
  }
  const data = new Uint8Array(end - start);
  for (const i of inputs) data.set(i.bytes, i.start - start);
  return { inputs, start, data };
}

/** --zp, --at, --table and --keep for a self-extracting file: where its decruncher works */
function placeOf(a: Args): SfxPlace | undefined {
  const opt = (k: string) => (a[k] != null ? number(String(a[k]), `--${k}`) : undefined);
  const keep = a.keep != null ? String(a.keep).split(',').map(r => {
    const m = /^\s*([^-\s]+)\s*-\s*([^-\s]+)\s*$/.exec(r);
    if (!m) throw new BrokkrError('BRK-E016', `--keep takes ranges as first-last address, $c000-$cfff, not "${r.trim()}".`);
    const from = number(m[1], 'The range\'s first address'), to = number(m[2], 'The range\'s last address');
    if (to < from || to > 0xffff) throw new BrokkrError('BRK-E016', `--keep ${r.trim()} is not a range of memory: its last address must be from its first to $ffff.`);
    return [from, to + 1] as [number, number];
  }) : undefined;
  const place: SfxPlace = { zp: opt('zp'), decruncher: opt('at'), tables: opt('table'), keep };
  return Object.values(place).some(v => v != null) ? place : undefined;
}

/** --format: one of the three, or for a self-extracting file `auto` (whose Exomizer stream takes Exomizer's options) */
function formatOf(a: Args): SfxFormat;
function formatOf(a: Args, auto: true): SfxFormat | 'auto';
function formatOf(a: Args, auto = false): SfxFormat | 'auto' {
  const f = String(a.format ?? 'exomizer');
  if (f === 'auto' && !auto) throw new BrokkrError('BRK-E012', '--format auto is for self-extracting files (sfx, and those d64 makes): crunched data needs the decruncher of one format.');
  if (f !== 'exomizer' && f !== 'brokkr' && f !== 'fast' && f !== 'auto') throw new BrokkrError('BRK-E012', `--format is exomizer, brokkr, fast or auto, not "${f}".`);
  if (f === 'brokkr' || f === 'fast') {
    const given = ['P', 'T', 'M', 'm', 'e', 'E', 'four-tables'].find(k => a[k] != null);
    if (given) throw new BrokkrError('BRK-E013', `-${given.length > 1 ? '-' : ''}${given} is an option of Exomizer's format, not of Brokkr's ${f === 'fast' ? 'fast one' : 'own'}.`);
  }
  if (a['max-seconds'] != null && f !== 'auto') throw new BrokkrError('BRK-E019', '--max-seconds goes with --format auto.');
  return f;
}

/** --max-seconds: the longest an `auto` file may take to decrunch */
function maxSeconds(a: Args): number | undefined {
  if (a['max-seconds'] == null) return undefined;
  const v = Number(a['max-seconds']);
  if (!(v > 0)) throw new BrokkrError('BRK-E019', `--max-seconds is a time in seconds above 0, not "${String(a['max-seconds'])}".`);
  return v;
}

function crunchOptions(a: Args): CrunchOptions {
  const effort = (a.effort ?? 'normal') as Effort;
  if (!['fast', 'normal', 'max'].includes(effort)) throw new BrokkrError('BRK-E007', `--effort is fast, normal or max, not "${effort}".`);
  const protocol: Partial<Protocol> = {};
  if (a.P != null) protocol.flags = protocolBits(String(a.P));
  if (a.T != null) protocol.traits = number(String(a.T), 'The -T value');
  if (a.M != null) protocol.maxLen = number(String(a.M), 'The -M length');
  if (a.m != null) protocol.maxOffset = number(String(a.m), 'The -m offset');
  const o: CrunchOptions = { effort, protocol };
  if (a.e != null) o.encoding = parseEncoding(String(a.e), protocol.flags ?? 39);
  if (a.E) o.header = false;
  return o;
}

/** -P as Exomizer reads it: a value, and +bits or -bits to set or clear (-P+16, -P39-32) */
function protocolBits(s: string): number {
  let v = 39;
  for (const m of s.matchAll(/([+-]?)(\d+)/g)) {
    const n = Number(m[2]);
    if (n > 63) throw new BrokkrError('BRK-E008', `-P bits go up to 63, not ${n}.`);
    v = m[1] === '+' ? v | n : m[1] === '-' ? v & ~n : n;
  }
  return v;
}

function makeCrunch(a: Args): { crunch: (d: Uint8Array, o: CrunchOptions) => Promise<Crunched>; close: () => Promise<void> } {
  let pool: Pool | null = null;
  const threads = a.threads != null ? number(String(a.threads), '--threads') : defaultThreads();
  if (threads < 1) throw new BrokkrError('BRK-E018', `--threads is how many threads --effort max crunches on: at least 1, not ${threads}.`);
  return {
    crunch: async (d, o) => {
      if (o.effort !== 'max' || o.encoding) return crunchData(d, o);
      pool ??= new Pool(threads);
      return crunchSearch(d, o, pool.runner({ data: d, protocol: protocol(o.protocol), profile: { ...PROFILES.max, ...o.profile }, header: o.header !== false }));
    },
    close: async () => { await pool?.close(); },
  };
}

const outName = (first: string, ext: string, given?: unknown) =>
  typeof given === 'string' ? given : `${first.replace(/\.(prg|bin|d64)$/i, '')}-brokkr${ext}`;

const stats = (c: Crunched) => ({
  format: 'exomizer', bytes: c.stream.length, bits: c.bits, rounds: c.rounds, ms: Math.round(c.ms), safety: c.safety,
  encoding: encodingText(c.encoding), ...c.stats,
});
const brkStats = (b: BrkCrunched) => ({ format: 'brokkr', bytes: b.stream.length, rounds: b.rounds, ms: Math.round(b.ms), safety: b.safety, ...b.stats });
const fastStats = (f: FastCrunched) => ({ format: 'fast', bytes: f.stream.length, ms: Math.round(f.ms), safety: f.safety, ...f.stats });

async function main(argv: string[]): Promise<number> {
  // before the arguments are read, so that what is wrong with them comes as JSON too
  const json = argv.includes('--json');
  const t0 = performance.now();
  let command: string | undefined, close = async () => {};
  // what --dump saves when a check fails: the program crunched, as a PRG
  let dump: { dir: string; program: Uint8Array | null } | null = null;
  try {
    const a = parseArgs(argv), quiet = !!a.q;
    if (typeof a.dump === 'string') dump = { dir: a.dump, program: null };
    const say = (s: string) => { if (!json && !quiet) console.log(s); };
    const [first, ...files] = a._;
    command = first;
    if (!command || a.help || a.h || command === 'help') { console.log(USAGE); return command ? 0 : 1; }
    const made = makeCrunch(a), crunch = made.crunch;
    close = made.close;
    let result: Record<string, unknown>;
    if (command === 'sfx' || command === 'mem' || command === 'raw') {
      const { inputs, start, data } = loadInputs(files);
      if (dump) dump.program = Uint8Array.from([start & 0xff, start >> 8, ...data]);
      const chosen = command === 'sfx' ? formatOf(a, true) : formatOf(a), format = chosen === 'auto' ? 'exomizer' : chosen;
      const o = crunchOptions(a);
      const inInfo = { files: inputs.map(i => ({ name: i.name, start: i.start, end: i.start + i.bytes.length })), start, end: start + data.length, bytes: data.length };
      say(`${inputs.map(i => basename(i.name)).join(', ')}: ${span(start, start + data.length)}, ${data.length} bytes`);
      if (command === 'sfx') {
        const startArg = String(a.start ?? 'sys');
        const st: Start = startArg === 'sys' || startArg === 'basic' ? startArg : number(startArg, 'The start address');
        const r: SfxResult = await sfxAsync(data, start, {
          start: st, ramExit: a['ram-exit'] != null ? number(String(a['ram-exit']), '$01') : undefined,
          irqExit: a.irq != null ? String(a.irq) === 'on' : undefined, effect: !a['no-effect'],
          fourTables: a['four-tables'] === 'auto' ? 'auto' : a['four-tables'] != null && a['four-tables'] !== 'off', place: placeOf(a),
          format: chosen, maxSeconds: maxSeconds(a), crunch: o,
        }, crunch);
        const out = outName(files[0], '.prg', a.o);
        writeFileSync(out, r.prg);
        // auto: what each format made, and which it took
        for (const t of r.tried ?? []) say(`  ${t.format.padEnd(8)} ${t.error ?? `${t.bytes} bytes, ${t.seconds!.toFixed(2)} s to decrunch${t.format === r.format ? ' (taken)' : ''}`}`);
        for (const area of r.areas) say(`  ${area.name.padEnd(16)} ${span(area.start, area.end)}${area.note ? `  ${area.note}` : ''}`);
        say(`  $01 ${h2(r.ramDuring)} while decrunching, ${h2(r.ramExit)} after; interrupts ${r.irqExit ? 'on' : 'off'} after; ${r.basic ? 'RUN' : `jmp ${h4(r.entry)}`}`);
        say(`  checked in an emulated C64: ${r.cycles} cycles (${(r.cycles / PAL_HZ).toFixed(2)} s)`);
        for (const w of r.warnings) say(`  note: ${w}`);
        say(`${out}: ${r.prg.length} bytes (${(100 * r.prg.length / data.length).toFixed(1)} % of ${data.length})`);
        result = { input: inInfo, output: { file: out, bytes: r.prg.length }, crunched: r.crunched ? stats(r.crunched) : r.brk ? brkStats(r.brk) : fastStats(r.fast!), protocol: r.protocol,
          areas: r.areas, entry: r.entry, basic: r.basic, ramDuring: r.ramDuring, ramExit: r.ramExit, irqExit: r.irqExit,
          effect: r.effect, cycles: r.cycles, warnings: r.warnings, ...(r.tried ? { tried: r.tried } : {}) };
      } else if (command === 'mem') {
        const load: MemOptions['load'] = a.l == null ? 'auto' : a.l === 'none' ? 'none' : number(String(a.l), 'The load address');
        const mo = { forward: !!a.f, load, crunch: o };
        if (format !== 'exomizer' && a.f) throw new BrokkrError('BRK-E014', `Brokkr's ${format === 'fast' ? 'fast' : 'own'} format is decrunched backward; -f is for Exomizer's format.`);
        const r = format === 'brokkr'
          ? memBrkFile(data, start, crunchBrk(data.slice().reverse(), { effort: o.effort }), mo)
          : format === 'fast'
          ? memFastFile(data, start, crunchFast(data.slice().reverse(), { effort: o.effort }), mo)
          : memFile(data, start, await crunch(a.f ? data : data.slice().reverse(), memCrunchOptions(mo)), mo);
        const c = 'brk' in r ? brkStats(r.brk) : 'fast' in r ? fastStats(r.fast) : stats(r.crunched);
        const out = outName(files[0], load === 'none' ? '.bin' : '.prg', a.o);
        // through Brokkr's 6502 decruncher in the emulated C64 before it is written, loaded where it decrunches in place
        // (wherever -l puts it)
        const check = checkMem({ format, flags: memCrunchOptions(mo).protocol?.flags, header: o.header !== false, forward: !!a.f },
          { start: r.inPlace.start, bytes: r.at ? r.bytes.subarray(2) : r.bytes }, { start, bytes: data }, basename(out));
        writeFileSync(out, r.bytes);
        say(`  in place it loads at ${span(r.inPlace.start, r.inPlace.end)} (safety ${c.safety})`);
        say('skipped' in check ? `  not checked in an emulated C64: ${check.skipped}` : `  checked with Brokkr's decruncher in an emulated C64: ${check.cycles} cycles (${(check.cycles / PAL_HZ).toFixed(2)} s), $01 ${h2(check.port)}`);
        if (!('skipped' in check) && check.cycles / PAL_HZ > LONG_SECONDS) say(`  note: Decrunching takes ${(check.cycles / PAL_HZ).toFixed(1)} s on a PAL C64.`);
        for (const w of r.warnings) say(`  note: ${w}`);
        say(`${out}: ${r.bytes.length} bytes${r.at ? ` at ${span(r.at.start, r.at.end)}` : ''}`);
        result = { input: inInfo, output: { file: out, bytes: r.bytes.length, at: r.at }, inPlace: r.inPlace, crunched: c, check, warnings: r.warnings };
      } else {
        const ro = { backward: !!a.b, reversed: !!a.r };
        let bytes: Uint8Array, c: Record<string, unknown>;
        if (format === 'brokkr') { const r = rawBrk(data, { ...ro, crunch: { effort: o.effort } }); bytes = r.bytes; c = brkStats(r.brk); }
        else if (format === 'fast') { const r = rawFast(data, { ...ro, crunch: { effort: o.effort } }); bytes = r.bytes; c = fastStats(r.fast); }
        else { const r = rawFile(await crunch(a.b ? data.slice().reverse() : data, o), ro); bytes = r.bytes; c = stats(r.crunched); }
        const out = outName(files[0], '.bin', a.o);
        writeFileSync(out, bytes);
        say(`${out}: ${bytes.length} bytes`);
        result = { input: inInfo, output: { file: out, bytes: bytes.length }, crunched: c };
      }
    } else if (command === 'd64') {
      const [diskName, ...names] = files;
      if (!diskName) throw new BrokkrError('BRK-E003', 'Name a disk image.');
      let image: Uint8Array;
      try { image = new Uint8Array(readFileSync(diskName)); } catch { throw new BrokkrError('BRK-E004', `"${diskName}" cannot be read.`); }
      const disk = new Disk(image);
      if (!names.length) {
        const list = disk.files();
        say(`0 "${disk.title.name.padEnd(16)}" ${disk.title.id}`);
        for (const f of list) say(`${String(f.blocks).padEnd(5)}"${f.name}"${' '.repeat(Math.max(0, 17 - f.name.length))}${f.closed ? ' ' : '*'}${f.type}${f.locked ? '<' : ''}`);
        say(`${disk.free} blocks free.`);
        result = { disk: diskName, title: disk.title, free: disk.free, files: list.map(({ entry: _e, raw, ...f }) => ({ ...f, petscii: [...raw] })) };
      } else {
        // auto for the self-extracting files; crunched data on the disk in Exomizer's format then
        const asked = formatOf(a, true), format = asked === 'auto' ? 'exomizer' : asked;
        const o = crunchOptions(a);
        if (a.mode != null && a.mode !== 'sfx' && a.mode !== 'mem') throw new BrokkrError('BRK-E009', `--mode is sfx or mem, not "${String(a.mode)}".`);
        // every name first: one that is not on the disk is a mistake in the command, not in a file
        const chosen = names.map(name => {
          const f = disk.find(name);
          if (!f) throw new BrokkrError('BRK-E320', `There is no file "${name}" on the disk.`, 'brokkr d64 <disk> lists the files.');
          if (f.type !== 'PRG') throw new BrokkrError('BRK-E321', `"${f.name}" is a ${f.type} file; Brokkr packs PRG files.`);
          return f;
        });
        const packed: Record<string, unknown>[] = [];
        for (const f of chosen) {
          const prg = disk.read(f);
          const load = prg[0] | (prg[1] << 8), data = prg.subarray(2);
          // a program at $0801 starts by its SYS, or with RUN when it is BASIC without one; any other is crunched data
          const sys = load === 0x0801 && findStart(data), basic = load === 0x0801 && !sys && isBasic(data);
          const mode = a.mode ?? (sys || basic ? 'sfx' : 'mem');
          // a file that cannot be packed stays as it is, and the others are packed
          try {
            let bytes: Uint8Array;
            if (mode === 'sfx') bytes = (await sfxAsync(data, load, { format: asked, maxSeconds: maxSeconds(a), crunch: o, place: placeOf(a), start: basic ? 'basic' : 'sys' }, crunch)).prg;
            else {
              const r = format === 'brokkr' ? memBrkFile(data, load, crunchBrk(data.slice().reverse(), { effort: o.effort }))
                : format === 'fast' ? memFastFile(data, load, crunchFast(data.slice().reverse(), { effort: o.effort }))
                : memFile(data, load, await crunch(data.slice().reverse(), memCrunchOptions({ crunch: o })), { crunch: o });
              // through Brokkr's 6502 decruncher, as `mem` does
              checkMem({ format, flags: memCrunchOptions({ crunch: o }).protocol?.flags, header: o.header !== false }, { start: r.at!.start, bytes: r.bytes.subarray(2) }, { start: load, bytes: data }, `"${f.name}"`);
              bytes = r.bytes;
            }
            const written = disk.write(f.raw, bytes, { replace: true });
            say(`"${f.name}": ${f.blocks} blocks -> ${written.blocks} (${mode}${basic && mode === 'sfx' ? ', RUN' : ''})`);
            packed.push({ name: f.name, mode, ...(basic && mode === 'sfx' ? { start: 'basic' } : {}), before: { bytes: prg.length, blocks: f.blocks }, after: { bytes: bytes.length, blocks: written.blocks } });
          } catch (e) {
            if (!(e instanceof BrokkrError)) throw e;
            say(`"${f.name}": left as it is: ${e.code}: ${e.message}${e.hint ? ` ${e.hint}` : ''}`);
            packed.push({ name: f.name, mode, error: { code: e.code, message: e.message, hint: e.hint } });
          }
        }
        const failed = packed.find(p => p.error) as { name: string; error: { code: string; message: string } } | undefined;
        if (failed && packed.every(p => p.error)) {
          throw new BrokkrError('BRK-E322', `None of the files could be packed, so no disk image was written: "${failed.name}": ${failed.error.code}: ${failed.error.message}`);
        }
        const out = outName(diskName, '.d64', a.o);
        writeFileSync(out, disk.bytes);
        say(`${out}: ${disk.free} blocks free.`);
        result = { disk: diskName, output: out, free: disk.free, packed };
      }
    } else if (command === 'decruncher') {
      const opt = (k: string) => (a[k] != null ? number(String(a[k]), `--${k}`) : undefined);
      const format = formatOf(a), own = format === 'brokkr';
      const table = opt('table');
      if (own && table != null && table & 0xff) throw new BrokkrError('BRK-E015', `--table for Brokkr's own format is the start of a page ($c000), not ${h4(table)}.`);
      const d = decruncherFile({
        format, zp: opt('zp'), table, at: opt('at'), small: !!a.small, effect: !!a.effect && format !== 'fast',
        four: !!a.four, reuse: !a['no-reuse'], literalSequences: !a['no-literal-sequences'],
      });
      // a .prg is the decruncher assembled at --at ($c000); anything else is its source
      const out = typeof a.o === 'string' ? a.o : 'brokkr_decrunch.asm', prg = /\.prg$/i.test(out);
      writeFileSync(out, prg ? d.prg : d.source);
      const of = own ? 'of its own format ' : format === 'fast' ? 'of its fast format ' : '';
      say(prg
        ? `${out}: Brokkr's decruncher ${of}at ${span(d.start, d.end)} (${d.end - d.start} bytes): set stream (${d.stream < 0x100 ? h2(d.stream) : h4(d.stream)}) to the address after the crunched data, then jsr ${h4(d.entry)}`
        : `${out}: Brokkr's decruncher ${of}for Kick Assembler`);
      say(`  zero page ${h2(d.zp.start)}–${h2(d.zp.end - 1)}${d.tables ? `, tables ${span(d.tables.start, d.tables.end)}` : ''}`);
      result = { output: { file: out, ...(prg ? { start: d.start, end: d.end, entry: d.entry, stream: d.stream } : {}) }, zp: d.zp, tables: d.tables };
    } else {
      throw new BrokkrError('BRK-E010', `"${command}" is not a command.`, 'brokkr --help lists them.');
    }
    if (json) console.log(JSON.stringify({ ok: true, command, ms: Math.round(performance.now() - t0), ...result }, null, 2));
    return 0;
  } catch (e) {
    let saved: string | null = null;
    if (e instanceof CheckError && dump) {
      // for the report: the program, the file and the emulated C64's 64 KB when the check stopped
      mkdirSync(dump.dir, { recursive: true });
      if (dump.program) writeFileSync(join(dump.dir, 'program.prg'), dump.program);
      writeFileSync(join(dump.dir, 'file.prg'), e.file);
      writeFileSync(join(dump.dir, 'memory.bin'), e.memory);
      saved = dump.dir;
    }
    const err = e instanceof BrokkrError ? { code: e.code, message: e.message, hint: saved ? `Saved the program, the file and the emulated C64's memory in ${saved}.` : e.hint } : { code: 'BRK-E999', message: (e as Error).message };
    if (json) console.log(JSON.stringify({ ok: false, command, error: err }, null, 2));
    else console.error(`brokkr: ${err.code}: ${err.message}${'hint' in err && err.hint ? `\n  ${err.hint}` : ''}`);
    return 1;
  } finally {
    await close();
  }
}

/** whether a program at $0801 has a SYS to start it */
function findStart(data: Uint8Array): boolean {
  for (let i = 4; i < Math.min(data.length, 80); i++) { if (data[i] === 0) return false; if (data[i] === 0x9e) return true; }
  return false;
}

/** whether a program at $0801 is BASIC: lines linked up, each ending with a 0, up to the 0 link that ends them */
function isBasic(data: Uint8Array): boolean {
  const at = (a: number) => data[a - 0x0801] ?? 0;
  for (let line = 0x0801, n = 0; n < 2000; n++) {
    const link = at(line) | (at(line + 1) << 8);
    if (link === 0) return n > 0;
    if (link < line + 5 || link > 0x0801 + data.length || at(link - 1) !== 0) return false;
    line = link;
  }
  return false;
}

process.exitCode = await main(process.argv.slice(2));
