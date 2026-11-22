/* Script worker (spec 10.3): a user script's run off the UI thread. A run takes at most some seconds (the limit of
 * instructions); Stop ends the worker itself, and the next run starts a new one. */
import * as Comlink from 'comlink';
import { runScript, runScriptInC64, type Addr, type ScriptC64, type ScriptEnv, type ScriptRun, type UserScript } from '@mimir/core';

/** how a run is to go beyond the script itself: in the whole C64 (its ROMs, and the disk in its 1541), and the address
 *  it stops at */
export interface ScriptRunOpts { c64?: ScriptC64; stopAt?: Addr | null }

const api = {
  run(env: ScriptEnv, script: Pick<UserScript, 'source' | 'lang' | 'pads' | 'init'>, opts: ScriptRunOpts = {}): ScriptRun {
    return opts.c64 ? runScriptInC64(env, script, opts.c64, undefined, opts.stopAt ?? null) : runScript(env, script, undefined, undefined, opts.stopAt ?? null);
  },
};

export type ScriptApi = typeof api;
Comlink.expose(api);
