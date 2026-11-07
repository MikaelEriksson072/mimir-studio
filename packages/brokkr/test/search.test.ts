import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crunchData, PROFILES } from '../src/crunch.ts';
import { crunchBrk } from '../src/crunch-brk.ts';
import { protocol } from '../src/format.ts';
import { Pool } from '../src/node.ts';
import { crunchBrkSearch, crunchSearch, neighbours } from '../src/search.ts';
import { programLike } from './tools.ts';

describe('the thorough search', () => {
  const data = programLike(4000, 21);

  it('changes one bucket by one bit at a time', () => {
    const e = crunchData(data).encoding;
    const n = neighbours(e);
    expect(n.length).toBeGreaterThan(80);
    for (const x of n) {
      const diff = [...x.len, ...x.off.flat()].map((b, i) => Math.abs(b - [...e.len, ...e.off.flat()][i])).reduce((a, b) => a + b);
      expect(diff).toBe(1);
    }
  });

  it('is never larger than effort normal', async () => {
    const normal = crunchData(data);
    const max = await crunchSearch(data, { effort: 'max' }, undefined, 1);
    expect(max.stream.length).toBeLessThanOrEqual(normal.stream.length);
  });

  it('finds the same on a pool of threads as here', async () => {
    const pool = new Pool(2);
    try {
      const job = { data, protocol: protocol(), profile: PROFILES.max, header: true };
      const threaded = await crunchSearch(data, { effort: 'max' }, pool.runner(job), 1);
      const here = await crunchSearch(data, { effort: 'max' }, undefined, 1);
      expect(threaded.stream).toEqual(here.stream);
    } finally {
      await pool.close();
    }
  });

  it('is quicker but a little larger with effort fast', () => {
    const fast = crunchData(data, { effort: 'fast' }), normal = crunchData(data);
    expect(fast.stream.length).toBeGreaterThanOrEqual(normal.stream.length);
  });
});

describe("the thorough search in Brokkr's own format", () => {
  const data = programLike(3000, 22);

  it('is never larger than effort normal, here and on a pool of threads, with the same stream', async () => {
    const normal = crunchBrk(data);
    const here = await crunchBrkSearch(data);
    expect(here.stream.length).toBeLessThanOrEqual(normal.stream.length);
    const pool = new Pool(2);
    try {
      const threaded = await crunchBrkSearch(data, pool.runner({ data, protocol: protocol(), profile: PROFILES.max, header: true }));
      expect(threaded.stream).toEqual(here.stream);
    } finally {
      await pool.close();
    }
  });
});

describe('the pool of threads', () => {
  const worker = fileURLToPath(new URL('./dying-worker.ts', import.meta.url));
  const data = programLike(2000, 23), job = { data, protocol: protocol(), profile: PROFILES.fast, header: true };
  afterEach(() => { delete process.env.BROKKR_TEST_DIE; delete process.env.BROKKR_TEST_MARK; });

  it('fails the task of a thread that stops, and runs the others on one that takes its place', async () => {
    process.env.BROKKR_TEST_DIE = 'first';
    process.env.BROKKR_TEST_MARK = join(mkdtempSync(join(tmpdir(), 'brokkr-pool-')), 'died');
    const pool = new Pool(1, worker);
    try {
      const run = pool.runner(job).run;
      await expect(run([{ start: 'lazy', rounds: 1 }])).rejects.toThrow(/A worker thread stopped \(exit code 3\) before it finished its task/);
      const [r] = await run([{ start: 'lazy', rounds: 1 }]);
      expect(r.bytes).toBeGreaterThan(0);
    } finally {
      await pool.close();
    }
  });

  it('fails what waits when its threads keep stopping', async () => {
    process.env.BROKKR_TEST_DIE = 'always';
    const pool = new Pool(1, worker);
    try {
      const tasks = Array.from({ length: 8 }, () => ({ start: 'greedy' as const, rounds: 1 }));
      await expect(pool.runner(job).run(tasks)).rejects.toThrow(/stopped|keep stopping/);
      await expect(pool.runner(job).run(tasks)).rejects.toThrow(/keep stopping/);
    } finally {
      await pool.close();
    }
  });
});
