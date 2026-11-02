/* Toolchain runner (spec 13.2): Kick Assembler and VICE are started with argument arrays, never
 * through a shell, using the executables from the main-process settings store. */
import { existsSync, statSync } from 'node:fs';
import { Worker } from 'node:worker_threads';
import { join } from 'node:path';
import type { BrokkrPack, KickProblem, ToolchainSettings } from '@mimir/core';
import { canIdentify, editorName, findC64Roms, findEditors, identifyPacker, launchEditor, launchTerminal, launchVice, runExomizer, runKickAssembler, runUnpacker, splitArgs } from '@mimir/core/node';
import { rm, writeFile } from 'node:fs/promises';
import type { BuildRequest, BuildResult, EditorInfo, EditorOpenResult, IdentifyResponse, PackRequest, PackResponse, RomsResponse, RunRequest, RunResult, TerminalOpenResult, UnpackRequest, UnpackResponse } from '../../shared/ipc';
import { createBuildFolder } from './project-fs';
import { assertEntryName, type PathPolicy } from './paths';

const missing = (what: string, path: string): KickProblem => ({ severity: 'error', file: '', line: 0, column: 0, message: `${what} not found at "${path}". Set the path in Settings → Toolchain.` });

export async function buildWithKickAssembler(req: BuildRequest, settings: ToolchainSettings, policy: PathPolicy): Promise<BuildResult> {
  const t0 = Date.now();
  const dir = policy.assert(req.dir, 'Build folder');
  const entries = req.entries.map(assertEntryName);
  if (!settings.kickJar || !existsSync(settings.kickJar)) {
    return { ok: false, stdout: '', problems: [missing('KickAss.jar', settings.kickJar)], outputs: [], commands: [], ms: Date.now() - t0 };
  }
  const outputs: BuildResult['outputs'] = [];
  const commands: string[][] = [];
  let stdout = '';
  for (const entry of entries) {
    if (!existsSync(join(dir, entry))) throw new Error(`${entry} does not exist in the build folder`);
    const run = await runKickAssembler({ java: settings.javaPath || 'java', jar: settings.kickJar, cwd: dir, entry, outDir: settings.outDir || 'out', args: splitArgs(settings.kickArgs) });
    commands.push(run.argv);
    stdout += `> ${run.argv.map(a => (/\s/.test(a) ? `"${a}"` : a)).join(' ')}\n${run.output}\n`;
    outputs.push({ entry, ok: run.ok, prg: run.prg, prgPath: run.prgPath, vsPath: run.vsPath, problems: run.problems });
  }
  const problems = outputs.flatMap(o => o.problems);
  return { ok: outputs.every(o => o.ok), stdout, problems, prg: outputs[0]?.prg ?? undefined, outputs, commands, ms: Date.now() - t0 };
}

/** The C64 ROMs for Sindri (which runs in the renderer): those of the user's VICE, looked up once
 * per VICE path. */
let roms: { vicePath: string; roms: RomsResponse } | null = null;
export function c64Roms(vicePath: string): RomsResponse {
  if (roms?.vicePath !== vicePath) roms = { vicePath, roms: findC64Roms(vicePath) };
  return roms.roms;
}

/** Unpack a packed PRG with the configured external unpacker (unp64), in a build folder of its own. */
export async function unpackWithTool(req: UnpackRequest, settings: ToolchainSettings): Promise<UnpackResponse> {
  if (!settings.unpackerPath) throw new Error('No external unpacker is set: Sindri, the built-in one, runs in the app. Set one (unp64) in Settings → Toolchain → Unpacker.');
  if (!existsSync(settings.unpackerPath)) throw new Error(`Unpacker not found at "${settings.unpackerPath}". Set the path in Settings → Toolchain.`);
  const dir = await createBuildFolder('unpack');
  const r = await runUnpacker({ exe: settings.unpackerPath, args: settings.unpackerArgs, dir, name: req.name, prg: req.prg });
  return { ok: r.ok, output: r.output, argv: r.argv, dir, name: r.file?.name, prg: r.file?.prg, entry: r.entry, packer: r.packer, error: r.error, ms: r.ms };
}

/** Ask unp64 (`-i`, nothing is unpacked) which packer a PRG uses; its scratch folder is removed afterwards. */
export async function identifyWithTool(req: UnpackRequest, settings: ToolchainSettings): Promise<IdentifyResponse> {
  const tool = settings.unpackerPath;
  if (!tool || !canIdentify(tool) || !existsSync(tool)) return { supported: false, known: false, packer: null, tool };
  const dir = await createBuildFolder('identify');
  try {
    const r = await identifyPacker({ exe: tool, dir, name: req.name, prg: req.prg });
    return { supported: true, known: r.known, packer: r.packer, tool };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Pack the built PRGs (or ranges of them) with Exomizer in a pack folder of its own, which the session may then
 * run in VICE: the result is checked with desfx when it is self-extracting. */
export async function packWithExomizer(req: PackRequest, settings: ToolchainSettings, policy: PathPolicy): Promise<PackResponse> {
  const exe = settings.exomizerPath;
  if (!exe) throw new Error('No Exomizer is set. Set it in Settings → Toolchain → Exomizer.');
  if (!existsSync(exe)) throw new Error(`Exomizer not found at "${exe}". Set the path in Settings → Toolchain.`);
  const dir = policy.allow(await createBuildFolder('pack'));
  const r = await runExomizer({ exe, dir, files: req.files, prefs: req.prefs });
  return {
    ok: r.ok, output: r.output, argv: r.argv, ms: r.ms, dir, packed: r.packed, report: r.report, check: r.check, error: r.error,
    ...(r.out ? { name: r.out.name, path: join(dir, r.out.name), prg: r.out.prg } : {}),
  };
}

/** Pack the built PRGs (or ranges of them) with Brokkr, the built-in cruncher, in a worker thread (with effort
 * 'max' a pool of them), so the window stays responsive. The inputs and the packed file go in a pack folder of their
 * own, where the command shown makes the same file with the standalone Brokkr; the session may run it in VICE. */
export async function packWithBrokkr(req: PackRequest, policy: PathPolicy, pack: (req: PackRequest) => Promise<BrokkrPack> = packInWorker): Promise<PackResponse> {
  const dir = policy.allow(await createBuildFolder('pack'));
  const r = await pack(req);
  for (const f of r.inputs) await writeFile(join(dir, f.name), f.prg);
  const files = r.ok ? (r.files ?? []).map(f => ({ ...f, path: join(dir, f.name) })) : [];
  for (const f of files) await writeFile(f.path, f.prg);
  return {
    ok: r.ok, output: r.output, argv: r.argv, commands: r.commands, ms: r.ms, dir, packed: r.packed, report: r.report,
    check: r.check && { ...r.check, argv: [], output: '' }, error: r.error,
    ...(r.ok && r.name && r.prg ? { name: r.name, path: join(dir, r.name), prg: r.prg, files } : {}),
  };
}

/** The packed files also in the folder the Pack view names (`PackPrefs.dir`, `to`: checked against the path policy),
 * which the result then points at, so Run in VICE runs that copy. */
export async function keepPacked(r: PackResponse, to: string | null): Promise<PackResponse> {
  if (!to || !r.ok || !r.name || !r.prg) return r;
  const path = join(to, r.name);
  await writeFile(path, r.prg);
  const files = r.files && await Promise.all(r.files.map(async f => {
    const at = join(to, f.name);
    if (at !== path) await writeFile(at, f.prg);
    return { ...f, path: at };
  }));
  return { ...r, path, ...(files ? { files } : {}) };
}

/** Brokkr in a worker thread: out/main/brokkr-worker.js, built from electron/main/brokkr-worker.ts. */
async function packInWorker(req: PackRequest): Promise<BrokkrPack> {
  const worker = new Worker(join(__dirname, 'brokkr-worker.js'));
  try {
    const reply = await new Promise<{ ok: true; result: BrokkrPack } | { ok: false; error: string }>((resolve, reject) => {
      worker.once('message', resolve);
      worker.once('error', reject);
      worker.once('exit', code => reject(new Error(`Brokkr's worker stopped (exit code ${code}) before it answered.`)));
      worker.postMessage(req);
    });
    if (!reply.ok) throw new Error(`Brokkr failed: ${reply.error}`);
    return reply.result;
  } finally {
    await worker.terminate();
  }
}

/** A terminal window in `dir` (already checked against the path policy), with VICE on PATH and `kickass` defined. */
export async function openTerminal(dir: string, settings: ToolchainSettings): Promise<TerminalOpenResult> {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) throw new Error(`${dir} is not a folder`);
  const has = (p: string) => !!p && existsSync(p);
  await launchTerminal({ dir, java: settings.javaPath || 'java', kickJar: has(settings.kickJar) ? settings.kickJar : undefined, vicePath: has(settings.vicePath) ? settings.vicePath : undefined });
  return { dir };
}

/** The editor the export opens in: the one in the settings, else the first found (Sublime Text, Visual Studio Code). */
export function currentEditor(settings: ToolchainSettings, found: EditorInfo[] = findEditors()): EditorInfo | null {
  const set = settings.editorPath.trim();
  return set ? { name: editorName(set), path: set } : found[0] ?? null;
}

/** The folder `dir` (already checked against the path policy) in the external editor, with `file` in it open; nothing
 * is started while `file` is not there. */
export async function openInEditor(dir: string, file: string, settings: ToolchainSettings, found?: EditorInfo[]): Promise<EditorOpenResult> {
  if (!existsSync(join(dir, file))) return { opened: false, dir };
  const editor = currentEditor(settings, found);
  if (!editor) throw new Error('No external editor was found: install Sublime Text or Visual Studio Code, or set an editor in Settings → Toolchain.');
  if (!existsSync(editor.path)) throw new Error(`${editor.name} not found at "${editor.path}". Set the path in Settings → Toolchain.`);
  await launchEditor({ exe: editor.path, args: settings.editorArgs, dir, file });
  return { opened: true, dir, file, editor: editor.name };
}

export async function runInVice(req: RunRequest, settings: ToolchainSettings, policy: PathPolicy): Promise<RunResult> {
  const prgPath = policy.assert(req.prgPath, 'Program');
  const labelsPath = req.labelsPath ? policy.assert(req.labelsPath, 'Label file') : null;
  if (!settings.vicePath || !existsSync(settings.vicePath)) throw new Error(`VICE (x64sc) not found at "${settings.vicePath}". Set the path in Settings → Toolchain.`);
  const disk = req.disk ? policy.assert(req.disk, 'Disk image') : null;
  return launchVice({ vice: settings.vicePath, args: splitArgs(settings.viceArgs), prgPath, labelsPath: labelsPath && existsSync(labelsPath) ? labelsPath : null, start: req.start, disk, cart: req.cart });
}
