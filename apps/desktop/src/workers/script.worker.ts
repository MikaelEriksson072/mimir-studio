/* Script worker (spec 10.3): a user script's run off the UI thread. A run takes at most some seconds (the limit of
 * instructions); Stop ends the worker itself, and the next run starts a new one. */
import * as Comlink from 'comlink';
import { runScript, type ScriptEnv, type ScriptRun, type UserScript } from '@mimir/core';

const api = {
  run(env: ScriptEnv, script: Pick<UserScript, 'source' | 'pads'>): ScriptRun {
    return runScript(env, script);
  },
};

export type ScriptApi = typeof api;
Comlink.expose(api);
