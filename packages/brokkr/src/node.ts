/* Node-only: a pool of worker threads for the thorough search, so effort 'max' uses every core. A job's data goes to
 * each worker once, with its first task; the worker finds the job's matches once and then refines from the encodings
 * it is given, or crunches in Brokkr's own format. A worker that stops is replaced, and its task fails with why; when
 * they keep stopping, the tasks still waiting fail too. `serve()` is a worker's whole body: src/worker.ts calls it, and
 * so can a worker file of a program that bundles Brokkr (Mimir Studio does). */
import { availableParallelism } from 'node:os';
import { parentPort, Worker } from 'node:worker_threads';
import { matchesFor } from './crunch.ts';
import type { Matches } from './match.ts';
import { runBrkTask, runTask, type BrkTask, type BrkTaskResult, type Job, type Runner, type Task, type TaskResult } from './search.ts';

type AnyTask = { exo: Task } | { brk: BrkTask };
type AnyResult = TaskResult | BrkTaskResult;
interface TaskMessage { kind: 'brokkr-task'; job: number; id: number; data?: Uint8Array; protocol: Job['protocol']; profile: Job['profile']; header: boolean; task: AnyTask }
interface ResultMessage { kind: 'brokkr-result'; id: number; result?: AnyResult; error?: string }
interface Queued { job: number; data: Uint8Array; msg: Omit<TaskMessage, 'data'>; resolve: (r: AnyResult) => void; reject: (e: Error) => void }

/** Brokkr's own worker script (src/worker.ts). */
export const workerFile = new URL('./worker.ts', import.meta.url);

/** The threads a pool uses by default: all cores but one, at most 8 (each takes about 90 MB, and more barely speed
 * the search up). */
export const defaultThreads = (): number => Math.max(1, Math.min(8, availableParallelism() - 1));

export class Pool {
  private readonly workers: Worker[] = [];
  private readonly idle: Worker[] = [];
  private readonly queue: Queued[] = [];
  /** each worker's task under way, and the job whose data it has */
  private readonly busy = new Map<Worker, Queued>();
  private readonly has = new Map<Worker, number>();
  private nextId = 1;
  private nextJob = 1;
  /** workers that stopped without being told to */
  private stopped = 0;
  private closing = false;

  readonly size: number;
  private readonly file: string | URL;
  /** `file`: the worker script, which calls serve(): Brokkr's own is `workerFile`, a program that bundles Brokkr
   * has its own. */
  constructor(size = defaultThreads(), file: string | URL = workerFile) {
    if (!(size >= 1)) throw new Error(`A pool needs at least one thread, not ${size}.`);
    this.size = size;
    this.file = file;
  }

  private spawn(): Worker {
    const w = new Worker(this.file, { workerData: { brokkr: true } });
    w.on('message', (m: ResultMessage) => {
      if (m?.kind !== 'brokkr-result') return;
      const t = this.busy.get(w);
      this.busy.delete(w);
      if (m.error || !m.result) t?.reject(new Error(m.error ?? 'A worker returned nothing.'));
      else t?.resolve(m.result);
      this.idle.push(w);
      this.pump();
    });
    // an error ends the worker: its task fails, and 'exit' replaces it
    w.on('error', e => { this.busy.get(w)?.reject(e as Error); this.busy.delete(w); });
    w.on('exit', code => {
      if (this.closing) return;
      this.workers.splice(this.workers.indexOf(w), 1);
      const i = this.idle.indexOf(w);
      if (i >= 0) this.idle.splice(i, 1);
      this.busy.get(w)?.reject(new Error(`A worker thread stopped (exit code ${code}) before it finished its task.`));
      this.busy.delete(w);
      this.has.delete(w);
      if (++this.stopped > this.size + 2) {
        for (const t of this.queue.splice(0)) t.reject(new Error(`Brokkr's worker threads keep stopping (${this.stopped} so far).`));
        return;
      }
      this.pump();
    });
    this.workers.push(w);
    return w;
  }

  private pump(): void {
    while (this.queue.length && this.stopped <= this.size + 2) {
      let w = this.idle.pop();
      if (!w && this.workers.length < this.size) w = this.spawn();
      if (!w) return;
      const t = this.queue.shift()!;
      this.busy.set(w, t);
      // the job's data only to a worker that does not have it yet
      const send = this.has.get(w) !== t.job;
      this.has.set(w, t.job);
      w.postMessage(send ? { ...t.msg, data: t.data } : t.msg);
    }
  }

  /** A runner for one job: its tasks go to the pool's threads. */
  runner(job: Job): Runner {
    const jobId = this.nextJob++;
    const send = <R extends AnyResult>(tasks: AnyTask[]) => Promise.all(tasks.map(task => new Promise<R>((resolve, reject) => {
      const msg = { kind: 'brokkr-task' as const, job: jobId, id: this.nextId++, protocol: job.protocol, profile: job.profile, header: job.header, task };
      this.queue.push({ job: jobId, data: job.data, msg, resolve: r => resolve(r as R), reject });
      this.pump();
    })));
    return {
      run: tasks => send<TaskResult>(tasks.map(exo => ({ exo }))),
      runBrk: tasks => send<BrkTaskResult>(tasks.map(brk => ({ brk }))),
    };
  }

  async close(): Promise<void> {
    this.closing = true;
    await Promise.all(this.workers.map(w => w.terminate()));
    this.workers.length = 0;
    this.idle.length = 0;
  }
}

/** A worker's body: run tasks as they come, keeping the data of the last job and its matches once found. */
export function serve(port = parentPort): void {
  if (!port) throw new Error('serve() runs in a worker thread.');
  let cached: { job: number; data: Uint8Array; m: Matches | null } | null = null;
  port.on('message', (msg: TaskMessage) => {
    if (msg?.kind !== 'brokkr-task') return;
    try {
      if (msg.data) cached = { job: msg.job, data: msg.data, m: null };
      if (!cached || cached.job !== msg.job) throw new Error('A task came without the data of its job.');
      const job: Job = { data: cached.data, protocol: msg.protocol, profile: msg.profile, header: msg.header };
      let result: AnyResult;
      if ('brk' in msg.task) result = runBrkTask(job.data, msg.task.brk);
      else {
        cached.m ??= matchesFor(job.data, job.protocol, job.profile);
        result = runTask(job, cached.m, msg.task.exo);
      }
      port.postMessage({ kind: 'brokkr-result', id: msg.id, result } satisfies ResultMessage);
    } catch (e) {
      port.postMessage({ kind: 'brokkr-result', id: msg.id, error: (e as Error).message } satisfies ResultMessage);
    }
  });
}
