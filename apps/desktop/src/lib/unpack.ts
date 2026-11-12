/* Sindri, in a worker of its own. The C64 ROMs (and the 1541's DOS ROM) come from the user's VICE
 * through the main process; outside the desktop app, or without VICE, Sindri runs with its stand-ins. */
import * as Comlink from 'comlink';
import type { UnpackRun, UnpackTape } from '@mimir/core';
import type { UnpackApi } from '../workers/unpack.worker';

let remote: Comlink.Remote<UnpackApi> | null = null;

/** Unpack a PRG (load address first), with the D64 it came from in the drive, or the tape it came from in the datasette,
 *  started with SYS `entry` when there is one (with `port` in $01 when it is given); a VICE snapshot's RAM (`vsf`: the snapshot) goes on from where it was
 *  taken instead. Runs queue up in the worker, one at a time. */
export async function unpackBuiltIn(prg: Uint8Array, disk: Uint8Array | null = null, tape: UnpackTape | null = null, entry: number | null = null, vsf: Uint8Array | null = null, port: number | null = null): Promise<UnpackRun> {
  if (!remote) remote = Comlink.wrap<UnpackApi>(new Worker(new URL('../workers/unpack.worker.ts', import.meta.url), { type: 'module', name: 'mimir-unpack' }));
  const roms = await (window.kr?.c64Roms() ?? Promise.resolve(null)).catch(() => null);
  return remote.unpack(prg, roms, disk, tape, entry, vsf, port);
}
