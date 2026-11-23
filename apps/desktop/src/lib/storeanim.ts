/* Animation data on a Spindle disk: a stream of frames a player in another job stores into the screens and colour RAM,
 * one frame each time it is called (core store-anim: Bliss Machine's lightning), or a PETSCII animation a player in the
 * job itself draws frame by frame (core petscii-anim: Breadbin of Horror's pumpkin). Such a stream is no packed
 * program, so the files that hold it are said to be animation data instead of packed: in the Spindle tab, above the
 * listing and in the analysis overview. Pure text, so the views and the tests share it. */
import { findPetsciiAnims, h4, spindleStoreAnims, storePagesText, type PetsciiAnim, type SpindleChunk, type SpindleDisk, type SpindleJob, type SpindleStoreAnim } from '@mimir/core';

const cache = new WeakMap<SpindleDisk, SpindleStoreAnim[]>();
/** the disk's animation streams, read once per disk */
export function spinStoreAnims(d: SpindleDisk): SpindleStoreAnim[] {
  let r = cache.get(d);
  if (!r) { r = spindleStoreAnims(d); cache.set(d, r); }
  return r;
}

const petsciiCache = new WeakMap<SpindleDisk, Map<SpindleJob, PetsciiAnim>>();
/** the PETSCII animation each job's code plays, read from the job's chunks alone (the jobs that play one), once per disk */
export function spinPetsciiAnims(d: SpindleDisk): Map<SpindleJob, PetsciiAnim> {
  let r = petsciiCache.get(d);
  if (r) return r;
  r = new Map();
  for (const j of d.jobs) {
    const mem = new Uint8Array(0x10000), on = new Uint8Array(0x10000);
    for (const c of j.chunks) { mem.set(c.bytes, c.start); on.fill(1, c.start, c.end); }
    const a = findPetsciiAnims(mem, x => on[x] === 1).find(x => x.frames.length);
    if (a) r.set(j, a);
  }
  petsciiCache.set(d, r);
  return r;
}

/** a stream's part in one job: which job, the frames that start in it (first 0: only the end of a frame) */
export interface StoreData { anim: SpindleStoreAnim; job: SpindleJob; first: number; last: number }
/** a PETSCII animation's stream, which the job's own player draws */
export interface PetsciiData { petscii: PetsciiAnim; job: SpindleJob }
/** what a file that is animation data holds */
export type AnimData = StoreData | PetsciiData;

/** has the chunk bytes of the stream `start`-`end` (the end past the last byte)? */
const holds = (c: SpindleChunk, start: number, end: number) => c.start < end && c.end > start;

/** the part of a stream a job holds, or null */
export function jobAnimData(anims: readonly SpindleStoreAnim[], j: SpindleJob): StoreData | null {
  for (const anim of anims) for (const d of anim.dataJobs) if (d.job === j) return { anim, ...d };
  return null;
}

/** what a chunk of the disk's jobs holds of an animation's stream (the chunk has stream bytes in it), or null */
export function chunkAnimData(disk: SpindleDisk, c: SpindleChunk): AnimData | null {
  for (const anim of spinStoreAnims(disk)) for (const d of anim.dataJobs) if (d.job.chunks.includes(c) && holds(c, anim.start, anim.end)) return { anim, ...d };
  for (const [job, petscii] of spinPetsciiAnims(disk)) if (job.chunks.includes(c) && holds(c, petscii.start, petscii.end)) return { petscii, job };
  return null;
}

/** a PETSCII animation's frames and bytes: `12 frames ($8000–$80c3)` */
export function petsciiText(a: PetsciiAnim): string {
  return `${a.frames.length} frame${a.frames.length === 1 ? '' : 's'} ($${h4(a.start)}–$${h4((a.end - 1) & 0xffff)})`;
}

/** the jobs as numbers: `job 6`, `jobs 6–8`, `jobs 6, 7 and 9` */
export function jobsText(jobs: readonly SpindleJob[]): string {
  const n = jobs.map(j => j.n);
  if (n.length === 1) return `job ${n[0]}`;
  if (n.every((x, i) => i === 0 || x === n[i - 1] + 1)) return `jobs ${n[0]}–${n[n.length - 1]}`;
  return `jobs ${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`;
}

/** the frames a job holds: `frames 1–174 of the 448` */
export function framesText(d: StoreData): string {
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
  if ('petscii' in d) return `it holds a PETSCII animation of ${petsciiText(d.petscii)} that the player at $${h4(d.petscii.player.entry ?? d.petscii.player.next)} in the same job draws on the screen, a frame each time it is called; nothing unpacks it, the player reads it frame by frame`;
  return `it holds ${framesText(d)} ${playerText(d.anim)}. The stream is ${streamText(d.anim)}; nothing unpacks it, the player reads it frame by frame`;
}
