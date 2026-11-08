/* Node-only: runs Kick Assembler and VICE. Executables are always started with
 * an argument array and `shell: false`, never through a shell string. */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path';
import type { KickProblem, Vfs } from '../types';
import { overwritesSystemArea } from '../c64/prg';
import { parseKickOutput } from '../verify/kick-output';
import { splitArgs } from '../util/args';

export { splitArgs };

/** Resolve `rel` inside `dir`, rejecting absolute paths and anything that escapes `dir`. */
export function safeJoin(dir: string, rel: string): string {
  if (!rel || isAbsolute(rel) || /^[a-zA-Z]:/.test(rel)) throw new Error(`refusing absolute path "${rel}"`);
  const root = resolve(dir);
  const full = resolve(root, normalize(rel));
  const r = relative(root, full);
  if (!r || r.startsWith('..') || isAbsolute(r)) throw new Error(`refusing path outside the target folder: "${rel}"`);
  return full;
}

/** Write a virtual file system (generated sources, binaries) below `dir`. Returns the relative paths written. */
export async function writeVfs(dir: string, files: Vfs): Promise<string[]> {
  const written: string[] = [];
  for (const [rel, data] of Object.entries(files)) {
    const full = safeJoin(dir, rel);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, data);
    written.push(rel.split(sep).join('/'));
  }
  return written;
}

export interface KickRunOptions {
  java: string;
  jar: string;
  /** folder that contains the sources (the process' working directory) */
  cwd: string;
  /** source file, relative to cwd */
  entry: string;
  /** output folder, relative to cwd */
  outDir: string;
  /** extra arguments such as -vicesymbols -showmem */
  args?: string[];
  timeoutMs?: number;
}

export interface KickRunResult {
  ok: boolean;
  code: number | null;
  /** stdout and stderr interleaved as received */
  output: string;
  problems: KickProblem[];
  argv: string[];
  /** the output: the PRG, or for a cartridge's source (`<name>.crt.asm`) the image `<name>.crt` */
  prgPath: string;
  prg: Uint8Array | null;
  /** VICE label file written by -vicesymbols, when present */
  vsPath: string | null;
  ms: number;
}

/** `java -jar KickAss.jar <entry> -odir <outDir> <args...>` in `cwd`. */
export async function runKickAssembler(o: KickRunOptions): Promise<KickRunResult> {
  const t0 = Date.now();
  const base = o.entry.replace(/\.asm$/i, '');
  // a cartridge's source (<name>.crt.asm) writes the image <name>.crt, every other source <name>.prg
  const prgPath = join(o.cwd, o.outDir, /\.crt$/i.test(base) ? base : base + '.prg');
  const vsPath = join(o.cwd, o.outDir, base + '.vs');
  await rm(prgPath, { force: true });
  await rm(vsPath, { force: true });
  const argv = ['-jar', o.jar, o.entry, '-odir', o.outDir, ...(o.args || [])];
  let output = '';
  const code = await new Promise<number | null>(done => {
    let child;
    try {
      child = spawn(o.java, argv, { cwd: o.cwd, shell: false, windowsHide: true });
    } catch (e) {
      output += `Error: could not start ${o.java}: ${(e as Error).message}\n`;
      done(null); return;
    }
    const timer = setTimeout(() => { output += `\nError: Kick Assembler did not finish within ${(o.timeoutMs ?? 60000) / 1000} s\n`; child.kill(); }, o.timeoutMs ?? 60000);
    child.stdout.on('data', d => { output += d.toString(); });
    child.stderr.on('data', d => { output += d.toString(); });
    child.on('error', e => { clearTimeout(timer); output += `Error: could not start "${o.java}": ${e.message}\n`; done(null); });
    child.on('close', c => { clearTimeout(timer); done(c); });
  });
  output = output.replace(/\r\n?/g, '\n');
  const problems = parseKickOutput(output, o.cwd);
  const prg = existsSync(prgPath) ? new Uint8Array(await readFile(prgPath)) : null;
  const ok = code === 0 && !problems.some(p => p.severity === 'error') && prg != null;
  return { ok, code, output, problems, argv: [o.java, ...argv], prgPath, prg, vsPath: existsSync(vsPath) ? vsPath : null, ms: Date.now() - t0 };
}

/** How VICE starts the program: RUN, `sys <start>` typed after loading, a jump from the monitor, or a cartridge
 *  attached (the C64 starts it at reset). */
export type ViceStart = 'run' | 'sys' | 'monitor' | 'cart';

export interface ViceLaunch {
  vice: string; args?: string[]; prgPath: string; labelsPath?: string | null;
  /** start the program here instead of autostarting it (RUN) */
  start?: number | null;
  /** with a start: 'monitor' for a program that overwrites BASIC's work area (launchVice picks it from the PRG) */
  via?: Exclude<ViceStart, 'run'>;
  /** with via 'monitor': the monitor command file (viceMonitorScript) */
  scriptPath?: string;
  /** a .d64 image to put in drive 8, for programs that load more from disk */
  disk?: string | null;
  /** a .tap (or .t64) image to put in the datasette (-1), for programs that load more from tape (PLAY is pressed in VICE) */
  tape?: string | null;
  /** `prgPath` is a cartridge image (.crt): VICE attaches it and resets, and the C64 starts it (no start, no autostart) */
  cart?: boolean;
}

/**
 * The x64sc command line: `<args...> [-moncommands labels.vs] -autostart program.prg`. With a start address the
 * program is loaded without RUN (`-autoload`) and `sys <start>` is typed into the keyboard buffer (VICE reads
 * `\n` there as RETURN, and lower case as unshifted letters). That needs the inject or disk image PRG mode: the
 * virtual file system mode loads through the keyboard buffer itself, so a `-autostartprgmode 0` is overridden.
 * A program that overwrites BASIC's work area leaves no BASIC to type into, so with via 'monitor' VICE stops at
 * the READY prompt (`-initbreak ready`) and runs the monitor commands of viceMonitorScript instead: load, then go.
 * A disk (`-8 disk.d64`) needs the inject PRG mode too: the disk image mode would put a disk of its own in drive 8.
 * A program put straight into memory leaves the drive as it was at power on, without the disk read: on a C64 it was
 * loaded from that disk (LOAD"*",8,1), and fast loaders count on it (We Are The Anomaly's Sparkle hangs there with
 * the drive's light blinking). So with a disk VICE loads the PRG without RUN and types DRIVE_INIT (initialise: the
 * drive reads the disk) before `run` or `sys <start>`. A snapshot brings its drive as it was.
 */
/**
 * The disk command "I" (initialise) on the command channel, typed before `run` or `sys <start>`. Without a string:
 * BASIC copies a string typed at READY into string space, and a program that loads up to $a000 or beyond (an
 * unpacked one, $0801-$f344 say) leaves none, so `open15,8,15,"i"` stops with ?OUT OF MEMORY before the program
 * starts. The channel is opened without a name, and the KERNAL sends the "I": CHKOUT 15 (X in 781), CHROUT $49
 * (A in 780), CLRCHN (unlisten: the drive runs the command). 69 characters: with `sys` and five digits the line
 * stays within BASIC's 80.
 */
export const DRIVE_INIT = 'open15,8,15:poke781,15:sys65481:poke780,73:sys65490:sys65484:close15:';

export function viceArgv(o: Omit<ViceLaunch, 'vice'>): string[] {
  const args = [...(o.args || [])];
  // (a .tap or .t64 given as the program is autostarted: VICE loads its first file and presses PLAY itself). A T64
  // holds no pulses: VICE reads it only through its tape traps, which a default configuration has off
  const t64 = [o.tape, o.prgPath].some(p => !!p && /\.t64$/i.test(p)) ? ['-trapdevice1'] : [];
  const drive = [...(o.disk ? ['-8', o.disk] : []), ...t64, ...(o.tape ? ['-1', o.tape] : [])];
  if (o.cart) return [...args, ...drive, ...(o.labelsPath ? ['-moncommands', o.labelsPath] : []), '-cartcrt', o.prgPath];
  if (o.start != null && o.via === 'monitor') {
    if (!o.scriptPath) throw new Error('starting from the monitor needs a monitor command file');
    return [...args, ...drive, '-moncommands', o.scriptPath, '-initbreak', 'ready'];
  }
  const i = args.lastIndexOf('-autostartprgmode'), mode = i >= 0 ? args[i + 1] : null;
  if (o.disk ? mode !== '1' : o.start != null && mode === '0') args.push('-autostartprgmode', '1');
  const init = o.disk && !/\.(vsf|tap|t64)$/i.test(o.prgPath) ? DRIVE_INIT : '';
  const run = o.start == null && !init ? ['-autostart', o.prgPath]
    : ['-autoload', o.prgPath, '-keybuf', `${init}${o.start == null ? 'run' : `sys${o.start & 0xffff}`}\\n`];
  return [...args, ...drive, ...(o.labelsPath ? ['-moncommands', o.labelsPath] : []), ...run];
}

/**
 * Monitor commands that load the PRG at its own address into RAM and jump to start; labels first. A PRG started from
 * the monitor is a memory dump (a program Sindri saved, $0208-$ffff say): its bytes at $d000-$dfff are RAM the program
 * put there under the I/O area, and loaded through the CPU's view (as LOAD"…",8,1 does) they went to the VIC, the SID,
 * the CIAs and the colour RAM instead, and the program crashed. So the monitor loads into RAM (`bank ram`, under the
 * ROMs too), as `-autoload` does for a PRG started with `sys`, and goes back to the CPU's view before `g`.
 * With a disk in drive 8 (`disk`), the last device used ($ba) is 8 first, as loading the program from that disk
 * leaves it (at READY after power on it is 0): a program that loads its next file from "the device it came from"
 * takes it from there (Cybernoid II +17HDF's high scores, `lda $ba / tax / tay / jsr SETLFS`). A dump that holds
 * $ba itself loads over it.
 */
export function viceMonitorScript(o: { prgPath: string; start: number; labels?: string; disk?: boolean }): string {
  const labels = o.labels ? o.labels.replace(/\r\n?/g, '\n').replace(/\n*$/, '\n') : '';
  const device = o.disk ? '> C:00ba 08\n' : '';
  return `${labels}${device}bank ram\nl "${o.prgPath}" 0\nbank cpu\ng ${(o.start & 0xffff).toString(16).padStart(4, '0')}\n`;
}

/**
 * The command line for a launch (see viceArgv). With a start address, a PRG that overwrites BASIC's work area is
 * started from the monitor: its command file is written next to the PRG (`name.start.mon`).
 */
export async function prepareVice(o: Omit<ViceLaunch, 'vice'>): Promise<{ argv: string[]; via: ViceStart }> {
  if (o.cart) return { argv: viceArgv(o), via: 'cart' };
  if (o.start == null) return { argv: viceArgv(o), via: 'run' };
  const prg = await readFile(o.prgPath);
  if (!(prg.length > 2 && overwritesSystemArea(prg[0] | (prg[1] << 8), prg.length - 2))) return { argv: viceArgv({ ...o, via: 'sys' }), via: 'sys' };
  const scriptPath = o.prgPath.replace(/(\.prg)?$/i, '.start.mon');
  const labels = o.labelsPath && existsSync(o.labelsPath) ? await readFile(o.labelsPath, 'utf8') : '';
  await writeFile(scriptPath, viceMonitorScript({ prgPath: o.prgPath, start: o.start, labels, disk: !!o.disk }));
  return { argv: viceArgv({ ...o, via: 'monitor', scriptPath }), via: 'monitor' };
}

/** Start x64sc detached (see prepareVice). Returns the pid and how the program starts. */
export async function launchVice(o: ViceLaunch): Promise<{ pid: number; via: ViceStart }> {
  const { argv, via } = await prepareVice(o);
  const pid = await new Promise<number>((ok, fail) => {
    const child = spawn(o.vice, argv, { shell: false, detached: true, stdio: 'ignore', windowsHide: false });
    child.once('error', e => fail(new Error(`could not start "${o.vice}": ${e.message}`)));
    child.once('spawn', () => { child.unref(); ok(child.pid ?? -1); });
  });
  return { pid, via };
}
