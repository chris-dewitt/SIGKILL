import { withCompanion } from '@sigkill/quest';
import { COMPANION } from './companion.js';
import { require_, type Adventure } from '@sigkill/quest';
import { bootHarness, restoreHarness, coldOpen, epilogue } from './world.js';

/** Adventure three. */
export const HARNESS: Adventure = {
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

