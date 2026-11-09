/* User scripts run in a worker of their own (spec 10.3), so that a script that loops does not stop the window; Stop
 * ends the worker. */
import * as Comlink from 'comlink';
import type { ScriptEnv, ScriptRun, UserScript } from '@mimir/core';
import type { ScriptApi } from '../workers/script.worker';

let worker: Worker | null = null;
let remote: Comlink.Remote<ScriptApi> | null = null;
let reject: ((e: Error) => void) | null = null;

/** Run a script that checked ok; rejects with "stopped" when stopScript() ends the run. */
export function runScriptInWorker(env: ScriptEnv, script: Pick<UserScript, 'source' | 'pads'>): Promise<ScriptRun> {
  if (!worker) {
    worker = new Worker(new URL('../workers/script.worker.ts', import.meta.url), { type: 'module', name: 'mimir-script' });
    remote = Comlink.wrap<ScriptApi>(worker);
  }
  const files = env.files.map(f => ({ load: f.load, bytes: f.bytes }));
  return new Promise<ScriptRun>((ok, fail) => {
    reject = fail;
    remote!.run({ files, names: new Map(env.names) }, { source: script.source, pads: script.pads.map(({ bytes: _, ...p }) => p) })
      .then(r => { reject = null; ok(r); }, e => { reject = null; fail(e instanceof Error ? e : new Error(String(e))); });
  });
}

/** End the run going on: its worker is ended (the next run starts another). */
export function stopScript(): void {
  worker?.terminate(); worker = null; remote = null;
  const r = reject; reject = null;
  r?.(new Error('stopped'));
}
