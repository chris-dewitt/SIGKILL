import { withCompanion } from '@sigkill/quest';
import { COMPANION } from './companion.js';
import { require_, type Adventure } from '@sigkill/quest';
import { bootHarness, restoreHarness, coldOpen, epilogue } from './world.js';
import type { World } from '@sigkill/quest';
import { HARNESS_OBJECTIVES } from './objectives.js';

/** Whether one of this act's objectives holds in the world -- what every gauge below reads. */
const met = (id: string, world: World): boolean =>
  HARNESS_OBJECTIVES.find((o) => o.id === id)?.done(world) === true;

/** Adventure three. */
export const HARNESS: Adventure = {
  place: 'ELLEN MAY — GALLEY',
  conditions: (world) => [
    met('write-the-test', world)
      ? { label: 'TEST', value: 'can fail', tone: 'good' }
      : { label: 'TEST', value: 'none', tone: 'warn' },
    met('run-it-twice', world)
      ? { label: 'REPEAT', value: 'holds', tone: 'good' }
      : { label: 'REPEAT', value: 'unproven', tone: 'warn' },
  ],
  id: 'harness',
  number: 3,
  title: 'The Harness',
  teaches: 'Python, debugging and testing',
  blurb: [
    'An adjuster will not take your word for it, and she is right',
    'not to. Write the program. Write the tests. Get the same',
    'answer twice.',
  ],
  needs: ['python'],
  boot: async (runtimes) => withCompanion(await bootHarness({ python: require_(runtimes.python, 'The Harness', 'python') }), COMPANION),
  restore: async (snapshot, runtimes) =>
    withCompanion(restoreHarness(snapshot, { python: require_(runtimes.python, 'The Harness', 'python') }), COMPANION),
  coldOpen,
  epilogue,
};

