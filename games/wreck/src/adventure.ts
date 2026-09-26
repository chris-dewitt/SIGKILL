import type { Adventure } from '@sigkill/quest';
import { bootWreck, restoreWreck, coldOpen, epilogue } from './world.js';

/**
 * Adventure one, as the host sees it.
 *
 * A descriptor rather than a change to `world.ts`: the game does not need to
 * know a chooser exists, and the four functions it already exported are the
 * whole contract. This file is the adapter, and it is this short on purpose --
 * if a later game needs more than this to be launchable, the contract is wrong
 * rather than the game.
 */
export const WRECK: Adventure = {
  id: 'wreck',
  number: 1,
  title: 'The Wreck',
  teaches: 'Linux and bash',
  blurb: [
    'You wake alone on a research ship with the air going bad and',
    'no idea why. Everything you need is in writing, and nothing',
    'aboard is broken. Start here.',
  ],
  boot: async () => bootWreck(),
  restore: async (snapshot) => restoreWreck(snapshot),
  coldOpen,
  epilogue,
};
