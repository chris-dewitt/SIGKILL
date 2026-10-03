import { withCompanion } from '@sigkill/quest';
import { COMPANION } from './companion.js';
import { require_, type Adventure } from '@sigkill/quest';
import { bootFork, restoreFork, coldOpen, epilogue } from './world.js';

/** Adventure four. */
export const FORK: Adventure = {
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

