import { withCompanion } from '@sigkill/quest';
import { COMPANION } from './companion.js';
import { require_, type Adventure } from '@sigkill/quest';
import { bootFork, restoreFork, coldOpen, epilogue } from './world.js';
import type { World } from '@sigkill/quest';
import { FORK_OBJECTIVES } from './objectives.js';

/** Whether one of this act's objectives holds in the world -- what every gauge below reads. */
const met = (id: string, world: World): boolean =>
  FORK_OBJECTIVES.find((o) => o.id === id)?.done(world) === true;

/** Adventure four. */
export const FORK: Adventure = {
  place: 'PELL DEPOSIT OFFICE',
  conditions: (world) => [
    met('open-the-deposit', world)
      ? { label: 'v43', value: 'in the record', tone: 'good' }
      : { label: 'v43', value: 'unplaced', tone: 'warn' },
    met('the-reconstruction', world)
      ? { label: 'SEQUENCE', value: 'tagged', tone: 'good' }
      : { label: 'SEQUENCE', value: 'scattered', tone: 'warn' },
  ],
  id: 'fork',
  number: 4,
  title: 'The Fork',
  teaches: 'Git, and what people decided',
  blurb: [
    'The working tree is gone. The history survived, because a',
    'crank demanded it. Eleven years of four people, and the',
    'three commits that turn out to matter.',
  ],
  needs: ['python'],
  boot: async (runtimes) => withCompanion(await bootFork({ python: require_(runtimes.python, 'The Fork', 'python') }), COMPANION),
  restore: async (snapshot, runtimes) =>
    withCompanion(restoreFork(snapshot, { python: require_(runtimes.python, 'The Fork', 'python') }), COMPANION),
  coldOpen,
  epilogue,
};

