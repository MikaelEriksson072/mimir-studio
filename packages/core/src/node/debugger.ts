/* Node-only: Build & Run in a debugger (spec 13.2b). Retro Debugger or C64 Debugger is started with an argument array
 * and `shell: false`, with the program in a copy of its PRG that starts it as Build & Run starts it in VICE (see
 * c64/debugger-start.ts). What each debugger takes on its command line was checked with Retro Debugger 1.0.0 and C64
 * Debugger 0.64.58.6 (DEVELOPMENT.md 39): */
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import type { DebuggerKind } from '../types';
import { debuggerStart, type DebuggerStart, type DebuggerVia } from '../c64/debugger-start';
import { snapshotForC64Debugger } from '../c64/vsf-c64d';

export interface DebuggerInfo {
  name: string;
  /** how it jumps to the start once the program is loaded: `-jmp` after `-wait` (Retro Debugger: without the wait it
   *  jumps before the C64 has started), or `-alwaysjmp` to the PRG's load address (C64 Debugger: it resets, waits for
   *  READY and loads by itself, and a `-jmp` is lost in that reset) */
  jump: 'jmp' | 'alwaysjmp';
  /** a disk given with `-d64` works: Retro Debugger 1.0.0's emulation stops (or it closes) with one on its command line,
   *  with or without a program */
  disk: boolean;
  /** a tape given with `-tap` works: C64 Debugger shows PRESS PLAY ON TAPE (PLAY is in its Settings → Tape); Retro
   *  Debugger 1.0.0 showed a blank screen, then none */
  tape: boolean;
  /** a cartridge given with `-crt` starts (`-reset`): C64 Debugger 0.64.58 stays at READY with it */
  cart: boolean;
  /** a VICE snapshot is restarted: C64 Debugger 0.64.58 loads one written as VICE 3.1 writes it (c64/vsf-c64d.ts),
   *  passed to the running debugger (`-pass -snapshot`): at its start it loads the PRG it remembers after the
   *  snapshot, over it. Retro Debugger 1.0.0 refuses VICE 3.10's snapshots, and its own format is another */
  snapshot: boolean;
}

export const DEBUGGERS: Record<DebuggerKind, DebuggerInfo> = {
  retro: { name: 'Retro Debugger', jump: 'jmp', disk: false, tape: false, cart: true, snapshot: false },
  c64d: { name: 'C64 Debugger', jump: 'alwaysjmp', disk: true, tape: true, cart: false, snapshot: true },
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
  disk?: string | null;
  tape?: string | null;
  cart?: boolean;
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
  plan?: DebuggerStart;
  /** what is not as in VICE: a disk or tape left out, PLAY to press, no room for the start code */
  notes: string[];
}

const hex4 = (n: number) => n.toString(16).padStart(4, '0');
const DISK_IMAGE = /\.(d64|g64|d71|d81|x64)$/i;

/** the command line for the start `plan` written to `startPrg` (see DebuggerInfo.jump) */
export function debuggerArgv(kind: DebuggerKind, o: { args?: string[]; wait?: number; labels?: string | null; disk?: string | null; tape?: string | null; startPrg: string; jmp: number | null }): string[] {
  const head = [...(o.args ?? []), ...(o.labels ? ['-symbols', o.labels] : []), ...(o.disk ? ['-d64', o.disk] : []), ...(o.tape ? ['-tap', o.tape] : [])];
  if (DEBUGGERS[kind].jump === 'jmp') return [...head, '-wait', String(Math.max(0, Math.round(o.wait ?? 3000))), '-prg', o.startPrg, ...(o.jmp != null ? ['-jmp', `x${hex4(o.jmp)}`] : [])];
  return [...head, '-prg', o.startPrg, ...(o.jmp != null ? ['-alwaysjmp'] : [])];
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
  const disk = o.disk && d.disk ? o.disk : null;
  if (o.disk && !d.disk) left('disk', o.disk);
  if (o.cart || /\.crt$/i.test(o.prgPath)) {
    if (!d.cart) throw new Error(`${d.name} does not start a cartridge given on its command line (it stays at READY). Build & Run (F5) starts it in VICE, or Retro Debugger does`);
    return { argv: [...args, ...(labels ? ['-symbols', labels] : []), ...(disk ? ['-d64', disk] : []), '-crt', o.prgPath, '-reset'], via: 'cart', notes };
  }
  // what VICE autostarts from a tape or a disk: the start code types LOAD and RUN there
  const tapeBoot = /\.(tap|t64)$/i.test(o.prgPath), diskBoot = DISK_IMAGE.test(o.prgPath);
  if (tapeBoot || diskBoot) {
    if (tapeBoot && !d.tape) throw new Error(`${d.name} does not load from a tape given on its command line. Build & Run (F5) loads it in VICE, or C64 Debugger does`);
    if (diskBoot && !d.disk) throw new Error(`${d.name} 1.0.0 stops its emulation with a disk on its command line, so it cannot start the disk. Build & Run (F5) starts it in VICE, or C64 Debugger does`);
    const plan = debuggerStart(null, { load: tapeBoot ? 'tape' : 'disk' });
    const startPrg = join(dirname(o.prgPath), 'debugger-start.prg');
    await writeFile(startPrg, plan.prg);
    if (tapeBoot) notes.push(`Press PLAY in ${d.name} (Settings → Tape) when it asks`);
    return { argv: debuggerArgv(o.kind, { args, wait: o.wait, labels, disk: diskBoot ? o.prgPath : disk, tape: tapeBoot ? o.prgPath : null, startPrg, jmp: plan.jmp }), via: 'load', startPrg, plan, notes };
  }
  const tape = o.tape && d.tape ? o.tape : null;
  if (o.tape && !d.tape) left('tape', o.tape);
  if (tape) notes.push(`Press PLAY in ${d.name} (Settings → Tape) when the program asks`);
  const prg = await readFile(o.prgPath);
  const plan = debuggerStart(prg, { start: o.start, port: o.port, disk: !!disk });
  if (plan.warning) notes.push(plan.warning);
  const startPrg = o.prgPath.replace(/(\.prg)?$/i, '.debugger.prg');
  await writeFile(startPrg, plan.prg);
  return { argv: debuggerArgv(o.kind, { args, wait: o.wait, labels, disk, tape, startPrg, jmp: plan.jmp }), via: plan.via, startPrg, plan, notes };
}

/** Start the debugger detached (see prepareDebugger). A snapshot's command line is given a second time (`again`) when
 *  the first started the debugger: a first that found a debugger running has passed the snapshot on and ended. */
export async function launchDebugger(o: DebuggerLaunch): Promise<DebuggerPrepared & { pid: number }> {
  const p = await prepareDebugger(o);
  const start = (after?: () => void) => new Promise<number>((ok, fail) => {
    // (in its own folder, as when it is started from its icon: C64 Debugger writes files there)
    const child = spawn(o.exe, p.argv, { shell: false, detached: true, stdio: 'ignore', windowsHide: false, cwd: dirname(o.exe) });
    child.once('error', e => fail(new Error(`could not start "${o.exe}": ${e.message}`)));
    child.once('spawn', () => { child.unref(); ok(child.pid ?? -1); });
    if (after) {
      const t = setTimeout(after, p.again);
      t.unref?.();
      child.once('exit', () => clearTimeout(t));
    }
  });
  const pid = await start(p.again != null ? () => { void start().catch(() => {}); } : undefined);
  return { ...p, pid };
}
