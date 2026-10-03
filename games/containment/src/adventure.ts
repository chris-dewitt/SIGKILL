import { withCompanion } from '@sigkill/quest';
import { COMPANION } from './companion.js';
import { require_, type Adventure } from '@sigkill/quest';
import { bootContainment, restoreContainment, coldOpen, epilogue } from './world.js';

/** Adventure five. */
export const CONTAINMENT: Adventure = {
  id: 'containment',
  number: 5,
  title: 'The Containment',
  teaches: 'Models, and measuring them',
  blurb: [
    'A model decided your ship was empty. It is 99.2% accurate',
    'and nobody ever asked what that was measured against.',
    'Open it up. Then measure it yourself.',
  ],
  needs: ['python'],
  boot: async (runtimes) =>
    withCompanion(bootContainment({ python: require_(runtimes.python, 'The Containment', 'python') }), COMPANION),
  restore: async (snapshot, runtimes) =>
    withCompanion(restoreContainment(snapshot, {
      python: require_(runtimes.python, 'The Containment', 'python'),
    }), COMPANION),
  coldOpen,
  epilogue,
};

