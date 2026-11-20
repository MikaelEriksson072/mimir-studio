/* Animation data on a Spindle disk (core store-anim): a stream of frames a player in another job stores into the
 * screens and colour RAM, one frame each time it is called (Bliss Machine's lightning). Such a stream is no packed
 * program, so the files that hold it are said to be animation data instead of packed: in the Spindle tab, above the
 * listing and in the analysis overview. Pure text, so the views and the tests share it. */
import { h4, spindleStoreAnims, storePagesText, type SpindleChunk, type SpindleDisk, type SpindleJob, type SpindleStoreAnim } from '@mimir/core';

const cache = new WeakMap<SpindleDisk, SpindleStoreAnim[]>();
/** the disk's animation streams, read once per disk */
export function spinStoreAnims(d: SpindleDisk): SpindleStoreAnim[] {
  let r = cache.get(d);
  if (!r) { r = spindleStoreAnims(d); cache.set(d, r); }
  return r;
}

/** a stream's part in one job: which job, the frames that start in it (first 0: only the end of a frame) */
export interface AnimData { anim: SpindleStoreAnim; job: SpindleJob; first: number; last: number }

/** the part of a stream a job holds, or null */
export function jobAnimData(anims: readonly SpindleStoreAnim[], j: SpindleJob): AnimData | null {
  for (const anim of anims) for (const d of anim.dataJobs) if (d.job === j) return { anim, ...d };
  return null;
}

/** the part of a stream a chunk of a job holds (the chunk has stream bytes in it), or null */
export function chunkAnimData(anims: readonly SpindleStoreAnim[], c: SpindleChunk): AnimData | null {
  for (const anim of anims) for (const d of anim.dataJobs) if (d.job.chunks.includes(c) && c.start < anim.end && c.end > anim.start) return { anim, ...d };
  return null;
}

/** the jobs as numbers: `job 6`, `jobs 6–8`, `jobs 6, 7 and 9` */
export function jobsText(jobs: readonly SpindleJob[]): string {
  const n = jobs.map(j => j.n);
  if (n.length === 1) return `job ${n[0]}`;
  if (n.every((x, i) => i === 0 || x === n[i - 1] + 1)) return `jobs ${n[0]}–${n[n.length - 1]}`;
  return `jobs ${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`;
}

/** the frames a job holds: `frames 1–174 of the 448` */
export function framesText(d: AnimData): string {
  const all = d.anim.frames.length;
  if (!d.first) return `the end of a frame of the ${all}`;
  return d.first === d.last ? `frame ${d.first} of the ${all}` : `frames ${d.first}–${d.last} of the ${all}`;
}

/** what the player does with the stream, after the frames: `that the player at $1f9d (job 5) stores into …` */
export function playerText(a: SpindleStoreAnim): string {
  return `that the player at $${h4(a.player.entry)} (job ${a.playerJob.n}) stores into ${storePagesText(a.pages)}, a frame each time it is called`;
}

/** the whole stream: `$8000–$cced in jobs 6–8` */
export function streamText(a: SpindleStoreAnim): string {
  return `$${h4(a.start)}–$${h4(a.end - 1)} in ${jobsText(a.dataJobs.map(d => d.job))}`;
}

/** what a file of the stream is, after its name and "is animation data, not packed:" */
export function animDataText(d: AnimData): string {
  return `it holds ${framesText(d)} ${playerText(d.anim)}. The stream is ${streamText(d.anim)}; nothing unpacks it, the player reads it frame by frame`;
}
