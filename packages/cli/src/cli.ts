/* mimir analyse | export | verify | unpack | measure | demo — batch and CI front end for @mimir/core. */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import {
  addDecisionChecks, addRunChecks, analyze, bankFiles, checkDecisions, builtCartridge, cartridgeFiles, checkRun, comparePrg, compareCrt, createProject, DEFAULT_SETTINGS, deserializeProject, detectPacking, expectedCartridge,
  exportFiles, goneCounts, h4, isCrt, isProblem, kindInfo, isVsf, makeDemo, makePrg, openC64File, openCartridge, parseCrt, parseD64, parsePrg, PROBLEM_CODES, projectNameFor, readD64File, readTape, render, unpackLog, unpackPrg, verify,
  type Cartridge, type DecisionCheck, type FileInput, type GoneWhy, type ProblemCode, type Project, type RunCheck, type SerializedProject, type Settings, type UnpackRun, type UnpackTape,
} from '@mimir/core';
import { findC64Roms, findKickAssJar, findVice, runKickAssembler, splitArgs, writeVfs } from '@mimir/core/node';

export interface Io { out: (s: string) => void; err: (s: string) => void; cwd: string }

const USAGE = `Mimir Studio command line

Usage:
  mimir analyse <file.prg | cartridge.crt | project.mimir.json>... [--json] [--bank <n>]
  mimir verify  <file.prg | cartridge.crt | project.mimir.json>... [--kickass [KickAss.jar]] [--java <java>]
  mimir export  <file.prg | cartridge.crt | project.mimir.json>... -o <folder> [--name <name>] [--force]
  mimir unpack  <file.prg | disk.d64 | disk.g64 | tape.tap | tape.t64> [--file <name>] [--disk <disk.d64|g64>] [--tape <tap|t64>] [-o <unpacked.prg>] [--no-roms]
  mimir measure <file.prg | project.mimir.json | folder>... [--json] [--no-roms]
                runs each PRG (a folder: every PRG and project in it and below; a project: its first file,
                from its program start) in Sindri and sets what the analysis made of each byte against what
                the program did with it (the code it ran, the data it read), and counts the problems by kind
  mimir demo    [-o raster-demo.prg]

Options:
  --set key=value   override a setting (repeatable), e.g. --set hwInclude=inline --set bytesPerRow=16
  --deep            deep analysis: slower, analyses again until the problems are at a minimum
                    (the same as --set deepAnalysis=true)
  --kickass [jar]   also assemble with the real Kick Assembler (default: auto-detect / KICKASS_JAR)
  --java <path>     Java executable used for --kickass (default: java)
  --no-roms         unpack with Sindri's stand-ins instead of VICE's C64 ROMs (default: the ROMs of a
                    VICE installation, or the folder in C64_ROMS)
  --bank <n>        a cartridge: only this bank (by default every bank, each a space of its own)
  --file <name>     unpack: the file on the D64, G64, TAP or T64 (default: its first program; * and ? as the DOS takes them)
  --disk <d64|g64>  unpack: put this disk in the drive (a D64 or G64 given as the file is in it already), so the
                    program can load from it with the KERNAL or its own fast loader
  --tape <tap|t64>  unpack: put this tape in the datasette, PLAY held down (a TAP or T64 given as the file is in
                    it already, wound to after the file), so the program's own tape loader reads it (a T64 has
                    no pulses: LOAD from the tape reads its files)
`;

interface Parsed { cmd: string; inputs: string[]; flags: Map<string, string | true>; sets: [string, string][] }

function parse(argv: string[]): Parsed {
  const [cmd = 'help', ...rest] = argv;
  const inputs: string[] = [], flags = new Map<string, string | true>(), sets: [string, string][] = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--set') { const kv = rest[++i] || ''; const eq = kv.indexOf('='); if (eq > 0) sets.push([kv.slice(0, eq), kv.slice(eq + 1)]); continue; }
    if (a === '-o' || a === '--out') { flags.set('out', rest[++i] ?? ''); continue; }
    if (a.startsWith('--')) {
      const name = a.slice(2), nextArg = rest[i + 1];
      const takesValue = name === 'name' || name === 'java' || name === 'file' || name === 'disk' || name === 'tape' || name === 'bank' || (name === 'kickass' && nextArg && !nextArg.startsWith('-') && /\.jar$/i.test(nextArg));
      flags.set(name, takesValue ? rest[++i] : true);
      continue;
    }
    inputs.push(a);
  }
  return { cmd, inputs, flags, sets };
}

function coerce(key: string, value: string): unknown {
  const def = (DEFAULT_SETTINGS as unknown as Record<string, unknown>)[key];
  if (def === undefined) throw new Error(`unknown setting "${key}"`);
  if (typeof def === 'boolean') return value === 'true' || value === '1' || value === 'yes';
  if (typeof def === 'number') { const n = Number(value); if (!Number.isFinite(n)) throw new Error(`setting ${key} expects a number`); return n; }
  return value;
}

/** `bank`: the only bank of a cartridge (.crt) to open; every bank when not given (spec 13.9b) */
function loadProject(inputs: string[], io: Io, sets: [string, string][], bank?: number): Project {
  if (!inputs.length) throw new Error('no input files');
  const settings: Partial<Settings> = {};
  for (const [k, v] of sets) (settings as Record<string, unknown>)[k] = coerce(k, v);
  const first = resolve(io.cwd, inputs[0]);
  if (/\.json$/i.test(first)) {
    const p = deserializeProject(JSON.parse(readFileSync(first, 'utf8')) as SerializedProject);
    return { ...p, settings: { ...p.settings, ...settings } };
  }
  // a cartridge (spec 13.9): the chips of a bank, with the image the export rebuilds; a project holds one
  let cart: Cartridge | null = null;
  const files = inputs.flatMap((f): FileInput[] => {
    const path = resolve(io.cwd, f), bytes = new Uint8Array(readFileSync(path));
    if (!isCrt(bytes)) return [parsePrg(basename(path), bytes)];
    if (cart) throw new Error(`${basename(path)}: a project holds one cartridge`);
    const o = openCartridge(basename(path), bytes);
    cart = o.cart;
    if (bank == null) return o.files;
    const chips = bankFiles(o.crt, bank);
    if (!chips.length) throw new Error(`${o.cart.name} has no bank ${bank}`);
    return chips;
  });
  return createProject({ files, settings, cart });
}

function analyseCmd(p: Project, io: Io, json: boolean) {
  const A = analyze(p);
  const packing = A.files.map((_, i) => detectPacking(A, i));
  if (json) {
    io.out(JSON.stringify({
      entry: A.entry, stats: { ...A.stats, illegalList: undefined }, deep: A.deep, log: A.log,
      packing: packing.map(k => k && { verdict: k.verdict, signature: k.signature, entropy: +k.entropy.toFixed(2), packedShare: +k.packedShare.toFixed(2), codeBytes: k.codeBytes, decruncher: k.decruncher, reasons: k.reasons }),
      blocks: A.blocks.map(b => ({ start: b.start, end: b.end, type: b.type, conf: b.conf, reason: b.reason, user: b.user, props: b.props })),
      labels: Object.fromEntries([...A.labels].map(([a, l]) => [`$${h4(a)}`, l.name])),
      music: A.music.map(m => ({ start: m.start, end: m.end, init: m.init, play: m.play })),
    }, null, 2));
    return 0;
  }
  for (const l of A.log) io.out(`[${l.lvl.padEnd(4)}] ${l.msg}${l.code ? `  [${l.code}]` : ''}`);
  for (const [i, k] of packing.entries()) if (k) io.out(`[pack] ${A.files[i].name} ${k.verdict === 'packed' ? 'is packed' : 'may be packed'}${k.signature ? ` (${k.signature})` : ''}: ${k.reasons.join('; ')}. Unpack it (mimir unpack ${A.files[i].name}) and analyse the result.`);
  io.out('');
  io.out('Blocks:');
  for (const b of A.blocks) {
    const name = A.labels.get(b.start)?.name ?? '';
    io.out(`  $${h4(b.start)}-$${h4(b.end - 1)}  ${kindInfo(b.type).label.padEnd(13)} ${name.padEnd(16)} ${b.reason}`);
  }
  return 0;
}

async function kickCheck(p: Project, io: Io, jar: string, java: string): Promise<boolean> {
  const A = analyze(p);
  const R = render(A, p);
  const dir = await mkdtemp(join(tmpdir(), 'mimir-cli-'));
  const cart = cartridgeFiles(p, R, p.settings);
  let ok = true;
  try {
    await writeVfs(dir, { ...R.files, ...cart?.files });
    for (const [fi, f] of A.files.entries()) {
      // every bank in one source (13.9c): the chips are built by the cartridge's source, checked below
      if (cart?.one && f.chip != null) continue;
      const entry = `${R.fileNames[fi]}.asm`;
      const run = await runKickAssembler({ java, jar, cwd: dir, entry, outDir: 'out', args: splitArgs(p.settings.kickArgs) });
      const cmp = comparePrg(f, run.prg);
      const good = run.ok && cmp.ok;
      ok = ok && good;
      io.out(`${good ? 'OK  ' : 'FAIL'} ${entry} with ${basename(jar)}: ${cmp.same}/${cmp.total} bytes identical (${run.ms} ms)`);
      for (const pr of run.problems) io.out(`  ${pr.file}:${pr.line}:${pr.column} ${pr.severity}: ${pr.message}`);
      for (const d of cmp.diffs.slice(0, 10)) io.out(`  ${d.msg ?? `$${h4(d.addr)}: expected $${(d.exp ?? 0).toString(16)}, got ${d.got == null ? 'nothing' : '$' + d.got.toString(16)}`}`);
    }
    // the cartridge's own source, after the chips: the image it writes against the one opened
    if (cart && p.cart) {
      const run = await runKickAssembler({ java, jar, cwd: dir, entry: cart.entry, outDir: 'out', args: splitArgs(p.settings.kickArgs) });
      const cmp = compareCrt(parseCrt(p.cart.crt, p.cart.name), run.ok ? run.prg : null, expectedCartridge(p) ?? undefined);
      ok = ok && run.ok && cmp.ok;
      io.out(`${run.ok && cmp.ok ? 'OK  ' : 'FAIL'} ${cart.entry} with ${basename(jar)}: ${cart.output} ${cmp.same}/${cmp.total} bytes identical to ${p.cart.name} (${run.ms} ms)`);
      for (const pr of run.problems) io.out(`  ${pr.file}:${pr.line}:${pr.column} ${pr.severity}: ${pr.message}`);
      for (const d of cmp.diffs) io.out(`  ${d}`);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  return ok;
}

function builtinVerify(p: Project, io: Io) {
  const A = analyze(p);
  const R = render(A, p);
  const V = verify(A, R);
  for (const r of V.results) {
    io.out(`${r.ok ? 'OK  ' : 'FAIL'} ${r.path}: ${r.same}/${r.total} bytes identical to ${r.file} (built-in assembler)`);
    for (const e of r.errors.slice(0, 20)) io.out(`  ${e.file}:${e.line} ${e.msg}`);
    for (const d of r.diffs.slice(0, 10)) io.out(`  ${d.msg ?? `$${h4(d.addr)}: expected $${(d.exp ?? 0).toString(16)}, got ${d.got == null ? 'nothing' : '$' + d.got.toString(16)}`}`);
  }
  // a cartridge: the image rebuilt from the chips just built, against the one opened
  const b = p.cart ? builtCartridge(p, V.results.map(r => r.prg)) : null;
  if (b && p.cart) {
    const cmp = compareCrt(parseCrt(p.cart.crt, p.cart.name), b.crt, expectedCartridge(p) ?? undefined);
    const good = cmp.ok && !b.problems.length;
    io.out(`${good ? 'OK  ' : 'FAIL'} ${b.name}: ${cmp.same}/${cmp.total} bytes identical to ${p.cart.name} (the cartridge rebuilt from the chips)`);
    for (const d of [...b.problems, ...cmp.diffs]) io.out(`  ${d}`);
    if (!good) return { A, R, V: { ...V, ok: false } };
  }
  return { A, R, V };
}

/** Every PRG in `paths` (a folder: in it and below, sorted), each with its name: its path in the folder, or its own. */
function prgsIn(paths: string[], io: Io): { path: string; name: string }[] {
  const out: { path: string; name: string }[] = [];
  const walk = (p: string, top: string) => {
    if (statSync(p).isDirectory()) for (const e of readdirSync(p).sort()) walk(join(p, e), top);
    else if (/\.prg$|\.mimir\.json$/i.test(p)) out.push({ path: p, name: relative(top, p) || basename(p) });
  };
  for (const p of paths) {
    const path = resolve(io.cwd, p);
    if (!existsSync(path)) throw new Error(`no file or folder ${path}`);
    walk(path, statSync(path).isDirectory() ? path : dirname(path));
  }
  return out;
}

const pct = (n: number, of: number) => (of ? `${(100 * n / of).toFixed(1)} %` : '-');

/** What the analysis made of the bytes against what the program did with them (8.11h), and the problems by kind. */
/** A deep analysis: its problems gone (solved, decided on a guess) and new, and its decisions against the run (8.11e). */
interface DeepMeasure { gone: Partial<Record<GoneWhy, number>>; added: number; decisions: DecisionCheck }

function measureLines(c: RunCheck, codes: Map<ProblemCode, number>, deep: DeepMeasure | null): string[] {
  const byCode = [...codes].sort((x, y) => y[1] - x[1]).map(([k, n]) => `${k} ${n}`).join(', ');
  const problems = [...codes.values()].reduce((s, n) => s + n, 0);
  const lines = [
    `  ran ${c.ran} instruction starts: ${pct(c.found, c.ran)} found, ${c.outOfStep} out of step, ${c.missed} as data`,
    `  read ${c.read} bytes as data only: ${c.readAsCode} as code (${c.readAsCodeCopied} of them copied to run elsewhere)`,
    `  ${c.codeBytes} bytes of code: ${pct(c.codeUntouched, c.codeBytes)} not touched by the run`,
    `  ${problems} problem${problems === 1 ? '' : 's'}${byCode ? `: ${byCode}` : ''}`,
  ];
  if (deep) {
    const g = goneCounts(deep), d = deep.decisions;
    const why = (Object.entries(deep.gone) as [GoneWhy, number][]).sort((x, y) => y[1] - x[1]).map(([k, n]) => `${k} ${n}`).join(', ');
    lines.push(`  deep: ${g.solved + g.decided + g.other} problems gone, ${g.solved} solved and ${g.decided} decided${g.other ? `, ${g.other} other` : ''}${why ? ` (${why})` : ''}; ${deep.added} new`);
    lines.push(`  deep decisions that ran: ${d.guessesRan} of ${d.guesses} guesses left out, ${d.sidesRan} of ${d.sides} sides left out, ${d.runTimeRan} of ${d.runTime} routines taken to be put in place at run time`);
  }
  return lines;
}

function measureCmd(inputs: string[], io: Io, sets: [string, string][], flags: Map<string, string | true>): number {
  const files = prgsIn(inputs, io);
  if (!files.length) { io.err('no PRG files given'); return 2; }
  const settings: Partial<Settings> = {};
  for (const [k, v] of sets) (settings as Record<string, unknown>)[k] = coerce(k, v);
  const roms = flags.has('no-roms') ? null : findC64Roms(findVice() ?? '');
  const json = flags.has('json'), checks: RunCheck[] = [], total = new Map<ProblemCode, number>(), rows: unknown[] = [];
  const deeps: DeepMeasure[] = [];
  for (const { path, name } of files) {
    // a project: its first file, started at the project's program start (as the app sets it for a program Sindri
    // unpacked without a BASIC line)
    let p: Project;
    if (/\.json$/i.test(path)) {
      const o = deserializeProject(JSON.parse(readFileSync(path, 'utf8')) as SerializedProject);
      p = { ...o, settings: { ...o.settings, ...settings } };
    } else p = createProject({ files: [parsePrg(basename(path), new Uint8Array(readFileSync(path)))], settings });
    const f = p.files[0];
    if (!f || f.chip != null || f.vsf || !f.bytes.length) continue;
    const start = p.entryPoint != null && p.entryPoint >= f.load && p.entryPoint < f.load + f.bytes.length ? p.entryPoint : null;
    const run = unpackPrg(makePrg(f.load, f.bytes), roms, null, start, null, null, start != null ? p.entryPort ?? null : null);
    const A = analyze(p);
    const c = checkRun(A, run.fileUse), codes = new Map<ProblemCode, number>();
    for (const l of A.log) if (isProblem(l) && l.code) { codes.set(l.code, (codes.get(l.code) ?? 0) + 1); total.set(l.code, (total.get(l.code) ?? 0) + 1); }
    checks.push(c);
    const decisions = checkDecisions(A, run.fileUse), deep = A.deep && decisions ? { gone: A.deep.gone, added: A.deep.added, decisions } : null;
    if (deep) deeps.push(deep);
    const seconds = +(run.cycles / 985248).toFixed(1);
    if (json) { rows.push({ file: name, stop: run.stop.reason, seconds, ...c, problems: Object.fromEntries(codes), ...(deep ? { deep } : {}) }); continue; }
    io.out(`${name} (the run: ${run.stop.reason} after ${seconds} s)`);
    for (const l of measureLines(c, codes, deep)) io.out(l);
    for (const [k, label] of [['missed', 'ran, as data'], ['outOfStep', 'ran, out of step'], ['readAsCode', 'read, as code']] as const) {
      if (c.where[k].length) io.out(`    ${label}: ${c.where[k].map(a => `$${h4(a)}`).join(' ')}`);
    }
  }
  const sum = addRunChecks(checks);
  let deepSum: DeepMeasure | null = null;
  if (deeps.length) {
    const gone: Partial<Record<GoneWhy, number>> = {};
    for (const d of deeps) for (const [k, n] of Object.entries(d.gone) as [GoneWhy, number][]) gone[k] = (gone[k] ?? 0) + n;
    deepSum = { gone, added: deeps.reduce((s, d) => s + d.added, 0), decisions: addDecisionChecks(deeps.map(d => d.decisions)) };
  }
  if (json) { io.out(JSON.stringify({ files: rows, total: { ...sum, where: undefined, problems: Object.fromEntries(total), ...(deepSum ? { deep: deepSum } : {}) }, codes: PROBLEM_CODES }, null, 2)); return 0; }
  io.out('');
  io.out(`${checks.length} program${checks.length === 1 ? '' : 's'}`);
  for (const l of measureLines(sum, total, deepSum)) io.out(l);
  return 0;
}

/** --bank <n>: a whole number, else an error */
function bankFlag(flags: Map<string, string | true>): number | undefined {
  const v = flags.get('bank');
  if (v === undefined) return undefined;
  if (typeof v !== 'string' || !/^\d+$/.test(v)) throw new Error('--bank needs the number of a bank');
  return +v;
}

export async function main(argv: string[], io: Io): Promise<number> {
  const { cmd, inputs, flags, sets } = parse(argv);
  if (flags.has('deep')) sets.push(['deepAnalysis', 'true']);
  try {
    switch (cmd) {
      case 'analyse': case 'analyze':
        return analyseCmd(loadProject(inputs, io, sets, bankFlag(flags)), io, flags.has('json'));
      case 'verify': {
        const p = loadProject(inputs, io, sets, bankFlag(flags));
        const { V } = builtinVerify(p, io);
        let ok = V.ok;
        if (flags.has('kickass')) {
          const jar = typeof flags.get('kickass') === 'string' ? resolve(io.cwd, flags.get('kickass') as string) : findKickAssJar([p.settings.kickJar]);
          if (!jar) { io.err('KickAss.jar not found: pass --kickass <path> or set KICKASS_JAR'); return 2; }
          ok = (await kickCheck(p, io, jar, (flags.get('java') as string) || 'java')) && ok;
        }
        return ok ? 0 : 1;
      }
      case 'export': {
        const out = flags.get('out');
        if (typeof out !== 'string' || !out) { io.err('export needs -o <folder>'); return 2; }
        const dir = resolve(io.cwd, out);
        if (existsSync(dir) && readdirSync(dir).length && !flags.has('force')) { io.err(`${dir} is not empty (use --force to write into it)`); return 2; }
        let p = loadProject(inputs, io, sets, bankFlag(flags));
        if (typeof flags.get('name') === 'string') p = { ...p, name: flags.get('name') as string };
        const { R, V } = builtinVerify(p, io);
        mkdirSync(dir, { recursive: true });
        const written = await writeVfs(dir, exportFiles(p, R, p.settings, V, new Date()));
        io.out(`Wrote ${written.length} files to ${dir}${V.ok ? ' (round-trip verified)' : ' (round-trip FAILED, see above)'}`);
        return V.ok ? 0 : 1;
      }
      case 'unpack': {
        if (inputs.length !== 1) { io.err('unpack takes one PRG'); return 2; }
        const path = resolve(io.cwd, inputs[0]);
        let prg: Uint8Array = new Uint8Array(readFileSync(path)), disk: Uint8Array | null = null, name = basename(path), base = basename(path).replace(/\.prg$/i, '');
        if (/\.[dg]64$/i.test(path)) {
          // a disk: its first PRG (or the one named), with the disk in the drive
          disk = prg;
          const want = flags.get('file');
          const re = typeof want === 'string' ? new RegExp(`^${want.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\?/g, '.').replace(/\*.*$/, '.*')}${want.includes('*') ? '' : '$'}`, 'i') : null;
          const f = parseD64(disk).files.find(e => e.type === 'PRG' && e.track && (!re || re.test(e.name)));
          if (!f) { io.err(typeof want === 'string' ? `no PRG named "${want}" on ${name}` : `no PRG on ${name}`); return 2; }
          prg = readD64File(disk, f);
          name = `${name}: "${f.name}"`;
          base = `${basename(path).replace(/\.[dg]64$/i, '')}-${f.name.replace(/[^A-Za-z0-9 _-]/g, '_').trim() || 'file'}`;
        }
        let tape: UnpackTape | null = null;
        if (/\.t(ap|64)$/i.test(path)) {
          // a tape (a TAP, or a T64's directory): its first program (or the one named), with the tape in the datasette
          // after it
          const tap = prg, want = flags.get('file');
          const re = typeof want === 'string' ? new RegExp(`^${want.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\?/g, '.').replace(/\*.*$/, '.*')}${want.includes('*') ? '' : '$'}`, 'i') : null;
          const f = readTape(tap).files.find(e => e.load != null && e.data.length && (e.type === 'PRG' || e.type === 'BASIC') && (!re || re.test(e.name)));
          if (!f) { io.err(typeof want === 'string' ? `no program named "${want}" on ${name}` : `no program on ${name}`); return 2; }
          prg = makePrg(f.load!, f.data);
          tape = { tap, at: f.to };
          name = `${name}: "${f.name}"`;
          base = `${basename(path).replace(/\.t(ap|64)$/i, '')}-${f.name.replace(/[^A-Za-z0-9 _-]/g, '_').trim() || 'file'}`;
        }
        // a VICE snapshot (by its header): its RAM from $0200, as the app opens it, and Sindri goes on from the snapshot
        let vsf: Uint8Array | null = null;
        if (isVsf(prg)) {
          vsf = prg;
          const f = openC64File(basename(path), vsf);
          prg = makePrg(f.load, f.bytes);
          base = basename(path).replace(/\.vsf$/i, '');
        }
        const diskFlag = flags.get('disk'), tapeFlag = flags.get('tape');
        if (typeof diskFlag === 'string') disk = new Uint8Array(readFileSync(resolve(io.cwd, diskFlag)));
        if (typeof tapeFlag === 'string') tape = { tap: new Uint8Array(readFileSync(resolve(io.cwd, tapeFlag))) };
        if (prg.length < 3) { io.err(`${path} is too short to be a PRG`); return 2; }
        let run: UnpackRun;
        try {
          run = unpackPrg(prg, flags.has('no-roms') ? null : findC64Roms(findVice() ?? ''), disk, null, tape, vsf);
        } catch (e) { io.err(`${name}: ${e instanceof Error ? e.message : String(e)}`); return 2; }
        io.out(unpackLog(run, name, prg[0] | (prg[1] << 8), prg.length - 2));
        if (!run.unpacked || !run.saved) return 1;
        const out = flags.get('out');
        const target = typeof out === 'string' && out ? resolve(io.cwd, out) : join(dirname(path), `${base}-unpacked.prg`);
        writeFileSync(target, run.saved.prg);
        io.out(`Wrote ${target} (${run.saved.prg.length} bytes, start $${h4(run.saved.entry)})`);
        return 0;
      }
      case 'measure':
        return measureCmd(inputs, io, sets, flags);
      case 'demo': {
        const d = makeDemo();
        const target = resolve(io.cwd, typeof flags.get('out') === 'string' ? flags.get('out') as string : d.name);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, d.prg);
        io.out(`Wrote ${target} (${d.prg.length} bytes)`);
        return 0;
      }
      case 'help': case '--help': case '-h':
        io.out(USAGE);
        return 0;
      default:
        io.err(`unknown command "${cmd}"\n\n${USAGE}`);
        return 2;
    }
  } catch (e) {
    io.err(`mimir: ${(e as Error).message}`);
    return 2;
  }
}
