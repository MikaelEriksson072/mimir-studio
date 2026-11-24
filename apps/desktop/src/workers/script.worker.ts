/* Script worker (spec 10.3): a user script's run off the UI thread. A run takes at most some seconds (the limit of
 * instructions); Stop ends the worker itself, and the next run starts a new one. */
import * as Comlink from 'comlink';
import { runJs, runScript, runScriptInC64, type Addr, type Roms, type ScriptLoaderData, type ScriptExportData, type ScriptBuildData, type ScreenSize, type ScriptC64, type ScriptEnv, type ScriptRun, type UserScript } from '@mimir/core';

/** how a run is to go beyond the script itself: in the whole C64 (its ROMs, and the disk in its 1541), and the address
 *  it stops at */
export interface ScriptRunOpts { c64?: ScriptC64; stopAt?: Addr | null;
  /** the mounted disk's image, for a JavaScript script's `disk` */
  disk?: Uint8Array | null;
  /** the C64's ROMs, for a JavaScript script's `sindri` (null: there are none) */
  roms?: Roms | null;
  /** the loaders of the mounted disk and tape with their files, for a JavaScript script's `loader` */
  loaders?: ScriptLoaderData[];
  /** the export as it is now, for a JavaScript script's `exporter` (left out: the run is not given it) */
  export?: ScriptExportData | null;
  /** the build as it is now, for a JavaScript script's `build` (left out: the run is not given it) */
  build?: ScriptBuildData | null;
  /** the size of the script's C64 screen: 40×25, or what the screen's extended mode gives (a run in the whole C64 has
   *  the C64's own) */
  screen?: ScreenSize }

/** what a JavaScript script is not to reach from the worker: gone before the first one runs (the worker needs none of
 *  it; Comlink keeps its own message port) */
let closed = false;
function closeWorker(): void {
  if (closed) return;
  closed = true;
  const g = globalThis as unknown as Record<string, unknown>;
  for (const n of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'importScripts', 'indexedDB', 'caches', 'BroadcastChannel', 'Worker', 'SharedWorker', 'WebTransport', 'RTCPeerConnection'])
    try { Object.defineProperty(g, n, { value: undefined, configurable: false, writable: false }); } catch { try { g[n] = undefined; } catch { /* it stays */ } }
}

const api = {
  run(env: ScriptEnv, script: Pick<UserScript, 'source' | 'lang' | 'code' | 'pads' | 'init'>, opts: ScriptRunOpts = {}): ScriptRun {
    if (script.code === 'js') { closeWorker(); return runJs(env, script, { disk: opts.disk ?? null, roms: opts.roms ?? null, loaders: opts.loaders ?? [], export: opts.export ?? null, build: opts.build ?? null, screen: opts.screen ?? null }); }
    return opts.c64 ? runScriptInC64(env, script, opts.c64, undefined, opts.stopAt ?? null) : runScript(env, script, undefined, undefined, opts.stopAt ?? null, opts.screen);
  },
};

export type ScriptApi = typeof api;
Comlink.expose(api);
