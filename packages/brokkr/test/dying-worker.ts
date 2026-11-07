/* A worker for the pool's tests: with BROKKR_TEST_DIE "first" it stops on its first task, once (the file
 * BROKKR_TEST_MARK marks it), with "always" on every task; else it serves as Brokkr's own worker does. */
import { existsSync, writeFileSync } from 'node:fs';
import { parentPort } from 'node:worker_threads';
import { serve } from '../src/node.ts';

const die = process.env.BROKKR_TEST_DIE, mark = process.env.BROKKR_TEST_MARK;
if (die === 'always' || (die === 'first' && mark && !existsSync(mark))) {
  parentPort!.once('message', () => {
    if (mark) writeFileSync(mark, '1');
    process.exit(3);
  });
} else serve();
