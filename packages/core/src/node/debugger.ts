/* Node-only: Build & Run in a debugger (spec 13.2b). Retro Debugger or C64 Debugger is started with an argument array
 * and `shell: false`, with the program in a copy of its PRG that starts it as Build & Run starts it in VICE (see
 * c64/debugger-start.ts). What each debugger takes on its command line was checked with Retro Debugger 1.0.0 and C64
 * Debugger 0.64.58.6 (DEVELOPMENT.md 39): */
import { spawn } from 'node:child_process';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import type { DebuggerKind } from '../types';
import type { StartIo } from '@mimir/sindri';
import { debuggerStart, type DebuggerStart, type DebuggerVia } from '../c64/debugger-start';
import { snapshotForC64Debugger } from '../c64/vsf-c64d';
import { debugInfoFile, viceLabels, type DebugInfo } from '../c64/debugger-dbg';

export interface DebuggerInfo {
  name: string;
  /** how it jumps to the start once the program is loaded: `-jmp` after `-wait` (Retro Debugger: without the wait it
   *  jumps before the C64 has started), or `-alwaysjmp` to the PRG's load address (C64 Debugger: it resets, waits for
   *  READY and loads by itself, and a `-jmp` is lost in that reset) */
  jump: 'jmp' | 'alwaysjmp';
  /** how it takes a disk: with `-d64` on the command line that starts the program (C64 Debugger), or `first`
   *  (Retro Debugger 1.0.0): put in the drive before the program is given, in a command line of its own. With
   *  `-d64` next to `-prg` and `-jmp` its emulation stops after 28 frames; with `-d64` alone the disk is in the drive
   *  and the C64 runs, and the program then goes to that debugger as to one that was running (see launchDebugger).
   *  And it must not have its VIC-II border set to full or debug: see retroDiskRefusal */
  disk: 'argv' | 'first';
  /** a tape given with `-tap` works: C64 Debugger shows PRESS PLAY ON TAPE (PLAY is in its Settings → Tape); Retro
   *  Debugger 1.0.0 showed a blank screen, then none */
  tape: boolean;
  /** a cartridge given with `-crt` starts (`-reset`): C64 Debugger 0.64.58 stays at READY with it */
  cart: boolean;
  /** a VICE snapshot is restarted: C64 Debugger 0.64.58 loads one written as VICE 3.1 writes it (c64/vsf-c64d.ts),
   *  passed to the running debugger (`-pass -snapshot`): at its start it loads the PRG it remembers after the
   *  snapshot, over it. Retro Debugger 1.0.0 refuses VICE 3.10's snapshots, and its own format is another */
  snapshot: boolean;
  /** how it gets the labels: `-symbols`, or (Retro Debugger 1.0.0) a file it finds by itself next to what it loads,
   *  `name.labels` for `name.prg` or `name.crt`. Its `-symbols` (and `-debuginfo`) with a `-prg` empties its symbols
   *  outside its lock, and its Data watch window, drawn meanwhile, returns without closing itself: imgui's assertion
   *  "Missing End()" stops the debugger whenever that window is open in its layout (CViewDataWatch::RenderImGui).
   *  The file next to the PRG is read as the PRG is loaded and was not seen to fail */
  labels: 'symbols' | 'beside';
  /** a program can be handed to the debugger that is already running (`-pass`), whose window is then used again:
   *  checked with Retro Debugger 1.0.0 (see launchDebugger). C64 Debugger 0.64.58 loads the PRG it remembers at
   *  its own start and was not tried */
  pass: boolean;
}

export const DEBUGGERS: Record<DebuggerKind, DebuggerInfo> = {
  retro: { name: 'Retro Debugger', jump: 'jmp', disk: 'first', tape: false, cart: true, snapshot: false, labels: 'beside', pass: true },
  c64d: { name: 'C64 Debugger', jump: 'alwaysjmp', disk: 'argv', tape: true, cart: false, snapshot: true, labels: 'symbols', pass: false },
};

export interface DebuggerLaunch {
  kind: DebuggerKind;
  exe: string;
  args?: string[];
  /** Retro Debugger's `-wait` (ms): the C64 is at READY by then */
  wait?: number;
  /** a PRG, or what VICE would autostart: a cartridge (.crt), a snapshot (.vsf), a tape (.tap, .t64), a disk image */
  prgPath: string;
  labelsPath?: string | null;
  start?: number | null;
  port?: number | null;
  /** the I/O the program starts in (Saved.io): its registers set by the start code before the jump */
  io?: StartIo | null;
  disk?: string | null;
  tape?: string | null;
  cart?: boolean;
  /** the sources with the bytes their lines made, the breakpoints and the watches (c64/debugger-dbg.ts): written as
   *  a `.dbg` next to the start PRG, which the debugger reads as it loads the PRG and then shows the source by the
   *  code. For a PRG only (not a cartridge, a snapshot, or a disk or tape that is loaded from) */
  debug?: DebugInfo | null;
  /** Retro Debugger's settings file (settings.hjson), read for its border mode before a disk is given: where it
   *  keeps it when not given (%LOCALAPPDATA%\\RetroDebugger on Windows); null: not read */
  retroSettings?: string | null;
}

export interface DebuggerPrepared {
  argv: string[];
  /** how the program starts: as typed at READY, as from VICE's monitor, the disk's or the tape's LOAD, a cartridge, a
   *  snapshot going on from where it was taken */
  via: DebuggerVia | 'cart' | 'snapshot';
  /** a snapshot: the file written for the debugger, and the C64 model the debugger must be set to */
  snapshot?: { path: string; model: string; disk: boolean };
  /** the command line is given once more after this many ms, unless the first went to a debugger already running: a
   *  debugger just started has loaded the PRG it remembers by then, over the snapshot */
  again?: number;
  /** the PRG the debugger loads (the program with its start code), when one was written */
  startPrg?: string;
  /** the disk the debugger gets in drive 8 before the program, in a command line of its own (DebuggerInfo.disk) */
  diskFirst?: string;
  /** the debug info written for the debugger, and the folder with the sources it names */
  debugInfo?: { path: string; sources: string; lines: number; breakpoints: number; watches: number };
  plan?: DebuggerStart;
  /** what is not as in VICE: a disk or tape left out, PLAY to press, no room for the start code */
  notes: string[];
}

const hex4 = (n: number) => n.toString(16).padStart(4, '0');
const DISK_IMAGE = /\.(d64|g64|d71|d81|x64)$/i;

/** where the debugger looks for the labels of the file it loads: `game.debugger.labels` for `game.debugger.prg` */
export const labelsBeside = (loaded: string) => loaded.replace(/\.[^.\\/]*$/, '') + '.labels';

/** The labels as the debugger takes them (DebuggerInfo.labels): what goes on its command line, with the file written
 *  next to `loaded` where it reads them from there (and one left by an earlier run removed when there are none). */
async function giveLabels(kind: DebuggerKind, labels: string | null, loaded: string): Promise<string | null> {
  if (DEBUGGERS[kind].labels === 'symbols') return labels;
  const beside = labelsBeside(loaded);
  if (labels) await copyFile(labels, beside); else await rm(beside, { force: true });
  return null;
}

/** where the debugger looks for the debug info of the PRG it loads: `game.debugger.dbg` for `game.debugger.prg` */
export const debugInfoBeside = (loaded: string) => loaded.replace(/\.[^.\\/]*$/, '') + '.dbg';

/** The debug info next to `startPrg` (DebuggerLaunch.debug) with its sources in `game.debugger.src`, the labels of the
 *  label file in it; without any, one left by an earlier run is removed (the debugger would read it). */
async function giveDebugInfo(debug: DebugInfo | null | undefined, labels: string | null, startPrg: string): Promise<DebuggerPrepared['debugInfo']> {
  const path = debugInfoBeside(startPrg);
  if (!debug?.sources.length) { await rm(path, { force: true }); return undefined; }
  const sources = path.replace(/\.dbg$/, '.src');
  await mkdir(sources, { recursive: true });
  const paths = debug.sources.map(s => join(sources, basename(s.name)));
  for (let i = 0; i < paths.length; i++) await writeFile(paths[i], debug.sources[i].text);
  await writeFile(path, debugInfoFile(debug, paths, labels ? viceLabels(await readFile(labels, 'utf8')) : []));
  return { path, sources, lines: debug.sources.reduce((n, s) => n + s.spans.length, 0), breakpoints: new Set(debug.breakpoints ?? []).size, watches: debug.watches?.length ?? 0 };
}

/** the command line for the start `plan` written to `startPrg` (see DebuggerInfo.jump); `labels` are those given with
 *  `-symbols` (see giveLabels) */
export function debuggerArgv(kind: DebuggerKind, o: { args?: string[]; wait?: number; labels?: string | null; disk?: string | null; tape?: string | null; startPrg: string; jmp: number | null }): string[] {
  const head = [...(o.args ?? []), ...(o.labels ? ['-symbols', o.labels] : []), ...(o.disk ? ['-d64', o.disk] : []), ...(o.tape ? ['-tap', o.tape] : [])];
  if (DEBUGGERS[kind].jump === 'jmp') return [...head, '-wait', String(Math.max(0, Math.round(o.wait ?? 3000))), '-prg', o.startPrg, ...(o.jmp != null ? ['-jmp', `x${hex4(o.jmp)}`] : [])];
  return [...head, '-prg', o.startPrg, ...(o.jmp != null ? ['-alwaysjmp'] : [])];
}

/** the VIC-II border Retro Debugger is set to, from its settings.hjson (`viceViciiBorderMode`): 0 normal (and when
 *  the file does not say), 1 full, 2 debug, 3 none */
export const retroBorderMode = (settings: string): number => { const m = /^\s*"?viceViciiBorderMode"?\s*:\s*(\d+)/m.exec(settings); return m ? Number(m[1]) : 0; };

/** where Retro Debugger keeps its settings.hjson, when that is known */
export const retroSettingsPath = (): string | null => (process.platform === 'win32' && process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'RetroDebugger', 'settings.hjson') : null);

/**
 * Why Retro Debugger cannot be given a disk now, or null: with its VIC-II border set to full or debug (1 or 2) Retro
 * Debugger 1.0.0 ends with a heap error about every other time a disk is attached, from its command line or passed
 * to it running (11 of 20 starts with the debug border, 2 of 4 with the full one; none of 26 with the normal border
 * or with none, and its other settings and its layout make no difference).
 */
export async function retroDiskRefusal(settings: string | null | undefined = retroSettingsPath()): Promise<string | null> {
  if (!settings) return null;
  let mode = 0;
  try { mode = retroBorderMode(await readFile(settings, 'utf8')); } catch { return null; }
  return mode === 1 || mode === 2
    ? `Retro Debugger 1.0.0 crashes about every other time it gets a disk while its VIC-II border is ${mode === 1 ? 'full' : 'debug'} (viceViciiBorderMode: ${mode} in ${settings}): set it to Normal in Retro Debugger (Settings → C64 → VIC → VIC Border mode), then run again`
    : null;
}

/**
 * The command line for a launch, with the start PRG written: next to the program (`name.debugger.prg`), or for a disk
 * or a tape VICE would autostart, `debugger-start.prg` next to the image. A VICE snapshot is written again as C64
 * Debugger reads one, next to it (`name.c64d.snap`), with the disk in it. Throws for what the debugger cannot start: a
 * VICE snapshot in Retro Debugger, and a cartridge, a disk or a tape to start from where it does not work.
 */
export async function prepareDebugger(o: DebuggerLaunch): Promise<DebuggerPrepared> {
  const d = DEBUGGERS[o.kind], args = o.args ?? [], labels = o.labelsPath ?? null, notes: string[] = [];
  const left = (what: 'disk' | 'tape', path: string) => notes.push(`${what === 'disk' ? `The disk is not in drive 8 (${path})` : `The tape is not in the datasette (${path})`}: ${d.name} 1.0.0 stops its emulation with a ${what} on its command line`);
  if (/\.vsf$/i.test(o.prgPath)) {
    if (!d.snapshot) throw new Error(`${d.name} cannot restart a VICE snapshot: it does not read VICE 3.x's snapshots. Build & Run (F5) restarts it in VICE, or C64 Debugger does`);
    const image = o.disk && /\.(d64|g64)$/i.test(o.disk) ? new Uint8Array(await readFile(o.disk)) : null;
    const r = snapshotForC64Debugger(new Uint8Array(await readFile(o.prgPath)), basename(o.prgPath), { disk: image });
    notes.push(...r.notes);
    if (o.disk && !r.disk) notes.push(`The disk is not in drive 8 (${o.disk}): ${image ? 'the snapshot has no 1541 as drive 8 to put it in' : 'only a D64 or a G64 can be written into the snapshot'}`);
    if (r.disk) notes.push('The disk is in the snapshot, as drive 8 had it: what the program writes to it stays in the debugger');
    if (o.tape) notes.push(`The tape is not in the datasette (${o.tape}): ${d.name} restores a snapshot without one`);
    notes.push(`${d.name}'s C64 model must be the ${r.model}: with another it says Snapshot loading failed and resets`);
    const path = o.prgPath.replace(/\.vsf$/i, '.c64d.snap');
    await writeFile(path, r.snap);
    return { argv: [...args, '-pass', ...(labels ? ['-symbols', labels] : []), '-snapshot', path], via: 'snapshot', snapshot: { path, model: r.model, disk: r.disk }, again: Math.max(0, Math.round(o.wait ?? 3000)) + 3000, notes };
  }
  const isCart = !!o.cart || /\.crt$/i.test(o.prgPath), diskBoot = !isCart && DISK_IMAGE.test(o.prgPath);
  // a disk for Retro Debugger goes in first (`diskFirst`), when it can take one now; else it is left out and a note
  // says why (a disk that is to be started is refused with the reason)
  const first = d.disk === 'first' && (o.disk || diskBoot) ? await retroDiskRefusal(o.retroSettings === undefined ? retroSettingsPath() : o.retroSettings) : null;
  if (first && diskBoot) throw new Error(`${first}. Build & Run (F5) starts the disk in VICE, or C64 Debugger does`);
  if (first && o.disk) notes.push(`The disk is not in drive 8 (${o.disk}): ${first}`);
  if (!first && o.disk && isCart && d.disk === 'first') notes.push(`The disk is not in drive 8 (${o.disk}): ${d.name} gets a cartridge without one`);
  const disk = o.disk && !first && !(isCart && d.disk === 'first') ? o.disk : null;
  const onArgv = (path: string | null) => (d.disk === 'argv' ? path : null);
  if (isCart) {
    if (!d.cart) throw new Error(`${d.name} does not start a cartridge given on its command line (it stays at READY). Build & Run (F5) starts it in VICE, or Retro Debugger does`);
    const symbols = await giveLabels(o.kind, labels, o.prgPath);
    return { argv: [...args, ...(symbols ? ['-symbols', symbols] : []), ...(onArgv(disk) ? ['-d64', disk!] : []), '-crt', o.prgPath, '-reset'], via: 'cart', notes };
  }
  // what VICE autostarts from a tape or a disk: the start code types LOAD and RUN there
  const tapeBoot = /\.(tap|t64)$/i.test(o.prgPath);
  if (tapeBoot || diskBoot) {
    if (tapeBoot && !d.tape) throw new Error(`${d.name} does not load from a tape given on its command line. Build & Run (F5) loads it in VICE, or C64 Debugger does`);
    const plan = debuggerStart(null, { load: tapeBoot ? 'tape' : 'disk' });
    const startPrg = join(dirname(o.prgPath), 'debugger-start.prg');
    await writeFile(startPrg, plan.prg);
    if (tapeBoot) notes.push(`Press PLAY in ${d.name} (Settings → Tape) when it asks`);
    return { argv: debuggerArgv(o.kind, { args, wait: o.wait, labels: await giveLabels(o.kind, labels, startPrg), disk: onArgv(diskBoot ? o.prgPath : disk), tape: tapeBoot ? o.prgPath : null, startPrg, jmp: plan.jmp }), via: 'load', startPrg, plan, notes, ...(d.disk === 'first' && (diskBoot || disk) ? { diskFirst: diskBoot ? o.prgPath : disk! } : {}) };
  }
  const tape = o.tape && d.tape ? o.tape : null;
  if (o.tape && !d.tape) left('tape', o.tape);
  if (tape) notes.push(`Press PLAY in ${d.name} (Settings → Tape) when the program asks`);
  const prg = await readFile(o.prgPath);
  const plan = debuggerStart(prg, { start: o.start, port: o.port, io: o.io, disk: !!disk });
  if (plan.warning) notes.push(plan.warning);
  const startPrg = o.prgPath.replace(/(\.prg)?$/i, '.debugger.prg');
  await writeFile(startPrg, plan.prg);
  // (the debug info has the labels too, and the debugger reads it after the label file, in its place)
  const debugInfo = await giveDebugInfo(o.debug, labels, startPrg);
  return { argv: debuggerArgv(o.kind, { args, wait: o.wait, labels: await giveLabels(o.kind, labels, startPrg), disk: onArgv(disk), tape, startPrg, jmp: plan.jmp }), via: plan.via, startPrg, debugInfo, plan, notes, ...(d.disk === 'first' && disk ? { diskFirst: disk } : {}) };
}

/** the debuggers this process started and has not seen end, by their program: the pid */
const started = new Map<string, number>();
const alive = (pid: number): boolean => { try { process.kill(pid, 0); return true; } catch { return false; } };
const exeKey = (exe: string) => exe.toLowerCase();
/** a process that hands its command line to the running debugger ends at once; one that found none is the debugger */
const PASS_WAIT = 4000, PASS_GAP = 500;
/** after a disk is given: the drive has it (the debugger resets the C64 as it attaches one) */
const DISK_GAP = 2000;

/**
 * Start the debugger detached (see prepareDebugger). A snapshot's command line is given a second time (`again`) when
 * the first started the debugger: a first that found a debugger running has passed the snapshot on and ended.
 *
 * A program goes to the debugger this process started before, when it is still running and takes one (`pass`): its
 * window is used again, with its layout and what is open in it, instead of one more debugger for each run. Retro
 * Debugger carries out a passed command line in its own order (reset, wait, load, jump) and does none of it while it
 * is stopped at a breakpoint, so it is passed two: `-pass -reset -unpause` (the C64 starts again, running), then the
 * program's with `-pass` in front. `reused` says the window was used again.
 *
 * A disk for Retro Debugger (`diskFirst`) is put in drive 8 before that: passed to the running debugger (`-pass
 * -d64`), or, when none runs, the debugger is started with `-d64` alone and then gets the program as a running one
 * does. Checked with the real one: the start code's LOAD"*",8,1 loaded and ran a disk's first program this way.
 */
export async function launchDebugger(o: DebuggerLaunch): Promise<DebuggerPrepared & { pid: number; reused?: boolean }> {
  const p = await prepareDebugger(o);
  const args = o.args ?? [], key = exeKey(o.exe), before = started.get(key);
  const run = (argv: string[], hide: boolean) => new Promise<{ pid: number; ended: Promise<void> }>((ok, fail) => {
    // (in its own folder, as when it is started from its icon: C64 Debugger writes files there)
    const child = spawn(o.exe, argv, { shell: false, detached: true, stdio: 'ignore', windowsHide: hide, cwd: dirname(o.exe) });
    const ended = new Promise<void>(done => child.once('exit', () => done()));
    child.once('error', e => fail(new Error(`could not start "${o.exe}": ${e.message}`)));
    child.once('spawn', () => { child.unref(); ok({ pid: child.pid ?? -1, ended }); });
  });
  const endsWithin = (c: { ended: Promise<void> }, ms: number) => new Promise<boolean>(done => { const t = setTimeout(() => done(false), ms); void c.ended.then(() => { clearTimeout(t); done(true); }); });
  const sleep = (ms: number) => new Promise<void>(done => setTimeout(done, ms));
  let running = DEBUGGERS[o.kind].pass && p.via !== 'snapshot' && p.via !== 'cart' && before != null && alive(before) ? before! : null;
  let fresh = false;
  if (p.diskFirst) {
    if (running != null) {
      const c = await run([...args, '-pass', '-d64', p.diskFirst], true);
      // (not taken: the debugger ended meanwhile, and this one is it, with the disk)
      if (!(await endsWithin(c, PASS_WAIT))) { started.set(key, c.pid); running = c.pid; fresh = true; }
      await sleep(DISK_GAP);
    } else {
      const c = await run([...args, '-d64', p.diskFirst], false);
      started.set(key, c.pid);
      void c.ended.then(() => { if (started.get(key) === c.pid) started.delete(key); });
      running = c.pid; fresh = true;
      // (its C64 has started and the disk is in the drive by then)
      await sleep(Math.max(3000, Math.round(o.wait ?? 3000)) + DISK_GAP);
      if (!alive(c.pid)) throw new Error(`${DEBUGGERS[o.kind].name} ended as it got the disk ${p.diskFirst}`);
    }
  }
  if (running != null) {
    const first = await run([...args, '-pass', '-reset', '-unpause'], true);
    if (await endsWithin(first, PASS_WAIT)) {
      await new Promise(done => setTimeout(done, PASS_GAP));
      const second = await run([...args, '-pass', ...p.argv.slice(args.length)], true);
      if (await endsWithin(second, PASS_WAIT)) return { ...p, pid: running, ...(fresh ? {} : { reused: true }) };
      // (the debugger ended in between: the second is the debugger now, with the program)
      started.set(key, second.pid);
      return { ...p, pid: second.pid };
    }
    // no debugger took it (the pid was another program's): the first is the debugger now, and gets the program
    started.set(key, first.pid);
    await new Promise(done => setTimeout(done, PASS_GAP));
    await run([...args, '-pass', ...p.argv.slice(args.length)], true);
    return { ...p, pid: first.pid };
  }
  const first = await run(p.argv, false);
  if (p.again != null) {
    const t = setTimeout(() => { void run(p.argv, false).catch(() => {}); }, p.again);
    t.unref?.();
    void first.ended.then(() => clearTimeout(t));
  }
  started.set(key, first.pid);
  void first.ended.then(() => { if (started.get(key) === first.pid) started.delete(key); });
  return { ...p, pid: first.pid };
}
