/* The thorough search behind effort 'max': parse and encoding from several starts, then a local search that
 * widens or narrows each bucket of the best encoding by a bit and refines from there, as long as the stream
 * shrinks. Every start is a task of its own, so they run in parallel when there are threads to run them on
 * (src/node.ts); without, they run one after the other. The starts from the lazy and the greedy parse are tasks too,
 * so the matches are found where the tasks run, not again here. Brokkr's own format has tasks of its own
 * (crunchBrkSearch). */
import { finish, matchesFor, PROFILES, refine, type CrunchOptions, type Crunched, type Effort, type Profile } from './crunch.ts';
import { protocol, type Encoding, type Protocol, type Tokens } from './format.ts';
import type { Matches } from './match.ts';
import { encodingFor } from './optimize.ts';
import { greedy, lazy } from './parse.ts';
import { crunchBrk, type BrkCrunched } from './crunch-brk.ts';
import { readBrk } from './brk.ts';

/** A refine task: from an encoding (or the lazy or the greedy parse's), at most `rounds` rounds. */
export interface Task { start: Encoding | 'lazy' | 'greedy'; rounds: number }
export interface TaskResult { encoding: Encoding; tokens: Tokens; bits: number; bytes: number; rounds: number }
/** A crunch in Brokkr's own format, with a profile and its prices' block size and weight; its stream and tokens. */
export interface BrkTask { effort: Effort; shift: number; weight: number }
export interface BrkTaskResult { stream: Uint8Array; tokens: Tokens; rounds: number }

/** Runs tasks on one data set; `tasks` may run them in parallel. */
export interface Runner {
  run(tasks: Task[]): Promise<TaskResult[]>;
  runBrk(tasks: BrkTask[]): Promise<BrkTaskResult[]>;
}

/** The job a runner works on: the data, its protocol and profile. */
export interface Job { data: Uint8Array; protocol: Protocol; profile: Profile; header: boolean }

/** Runs tasks here, one after the other (the matches found once). */
export function localRunner(job: Job): Runner {
  let m: Matches | null = null;
  return {
    async run(tasks) {
      m ??= matchesFor(job.data, job.protocol, job.profile);
      return tasks.map(t => runTask(job, m!, t));
    },
    async runBrk(tasks) { return tasks.map(t => runBrkTask(job.data, t)); },
  };
}

export function runTask(job: Job, m: Matches, t: Task): TaskResult {
  const start = t.start === 'lazy' ? encodingFor(lazy(job.data, m, job.protocol), job.protocol.flags)
    : t.start === 'greedy' ? encodingFor(greedy(job.data, m, job.protocol), job.protocol.flags) : t.start;
  const r = refine(job.data, m, job.protocol, start, { ...job.profile, passes: t.rounds }, job.header, false);
  return { encoding: r.encoding, tokens: r.tokens, bits: r.bits, bytes: r.bytes, rounds: r.rounds };
}

export function runBrkTask(d: Uint8Array, t: BrkTask): BrkTaskResult {
  const r = crunchBrk(d, { effort: t.effort, shift: t.shift, weight: t.weight });
  return { stream: r.stream, tokens: r.tokens, rounds: r.rounds };
}

const better = (a: TaskResult, b: TaskResult | null) => !b || a.bytes < b.bytes || (a.bytes === b.bytes && a.bits < b.bits);

/** The encodings one bit away from `e`, bucket by bucket. */
export function neighbours(e: Encoding): Encoding[] {
  const out: Encoding[] = [];
  const tables = [e.len, ...e.off];
  tables.forEach((t, ti) => t.forEach((b, i) => {
    for (const d of [-1, 1]) {
      if (b + d < 0 || b + d > 15) continue;
      const copy = tables.map(x => x.slice());
      copy[ti][i] = b + d;
      out.push({ len: copy[0], off: copy.slice(1) });
    }
  }));
  return out;
}

/**
 * Crunch with the thorough search. `runner` runs the tasks (in parallel threads, or here); `sweeps` bounds the
 * local search. The stream is written and checked here.
 */
export async function crunchSearch(d: Uint8Array, o: CrunchOptions, runner?: Runner, sweeps = 2): Promise<Crunched> {
  const t0 = performance.now();
  if (!d.length) throw new Error('There is nothing to crunch: the data is empty.');
  const p = protocol(o.protocol);
  const profile = { ...PROFILES[o.effort ?? 'max'], ...o.profile };
  const header = o.header !== false;
  const job: Job = { data: d, protocol: p, profile, header };
  const run = runner ?? localRunner(job);
  const seeds: Task['start'][] = ['lazy', 'greedy', ...(o.seeds ?? [])];
  let best: TaskResult | null = null;
  let rounds = 0;
  for (const r of await run.run(seeds.map(start => ({ start, rounds: profile.passes })))) {
    rounds += r.rounds;
    if (better(r, best)) best = r;
  }
  for (let sweep = 0; sweep < sweeps; sweep++) {
    const results = await run.run(neighbours(best!.encoding).map(start => ({ start, rounds: 3 })));
    let improved = false;
    for (const r of results) {
      rounds += r.rounds;
      if (better(r, best)) { best = r; improved = true; }
    }
    o.progress?.(sweep + 1, best!.bits);
    if (!improved) break;
  }
  const c = finish(d, { ...best!, rounds }, p, header, t0);
  return c;
}

/** What effort 'max' tries in Brokkr's own format: its prices' block sizes and weights with the max profile, and the
 * crunch of effort 'normal', so that max never makes a larger stream than normal. */
const BRK_GRID: BrkTask[] = [{ effort: 'normal', shift: 11, weight: 16 }, ...[10, 11, 12].flatMap(shift => [8, 16, 32].map(weight => ({ effort: 'max' as const, shift, weight })))];

/** Crunch in Brokkr's own format with the thorough search: the grid's crunches on `runner` (threads), the smallest
 * kept. The stream is checked here. */
export async function crunchBrkSearch(d: Uint8Array, runner?: Runner): Promise<BrkCrunched> {
  const t0 = performance.now();
  if (!d.length) throw new Error('There is nothing to crunch: the data is empty.');
  const run = runner ?? localRunner({ data: d, protocol: protocol(), profile: PROFILES.max, header: true });
  const results = await run.runBrk(BRK_GRID);
  const best = results.reduce((a, b) => (b.stream.length < a.stream.length ? b : a));
  const back = readBrk(best.stream);
  if (back.data.length !== d.length || back.data.some((b, i) => b !== d[i])) {
    throw new Error("Brokkr's own check failed: its own format's stream does not decrunch to the data. This is a bug in Brokkr; please report it with the file.");
  }
  return { stream: best.stream, tokens: best.tokens, safety: back.safety, stats: back.tokens, rounds: results.reduce((n, r) => n + r.rounds, 0), ms: performance.now() - t0 };
}
