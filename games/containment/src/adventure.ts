import { withCompanion } from '@sigkill/quest';
import { COMPANION } from './companion.js';
import { require_, type Adventure } from '@sigkill/quest';
import { bootContainment, restoreContainment, coldOpen, epilogue } from './world.js';
import type { World } from '@sigkill/quest';
import { CONTAINMENT_OBJECTIVES } from './objectives.js';

/** Whether one of this act's objectives holds in the world -- what every gauge below reads. */
const met = (id: string, world: World): boolean =>
  CONTAINMENT_OBJECTIVES.find((o) => o.id === id)?.done(world) === true;

/** Adventure five. */
export const CONTAINMENT: Adventure = {
  place: 'HEARING ANNEXE',
  conditions: (world) => [
    { label: 'CLAIMED', value: '99.2%', tone: 'quiet' },
    met('the-honest-number', world)
      ? { label: 'MODEL', value: 'measured', tone: 'good' }
      : { label: 'MODEL', value: 'trusted', tone: 'warn' },
  ],
  id: 'containment',
  number: 7,
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

