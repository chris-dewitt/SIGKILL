import { withCompanion } from '@sigkill/quest';
import { COMPANION } from './companion.js';
import type { Adventure } from '@sigkill/quest';
import { bootDeposit, coldOpen, epilogue, restoreDepositSave, saveDeposit } from './world.js';

/**
 * Adventure six.
 *
 * The first one that is a fleet, which is why it is also the first one that
 * saves itself: `snapshot` is how the four hosts survive a reload. See the
 * note on `AdventureSession.snapshot` in `packages/quest`.
 */
export const DEPOSIT: Adventure = {
  id: 'deposit',
  number: 6,
  title: 'The Deposit',
  teaches: 'Services, and checks that lie',
  blurb: [
    'Four machines nobody documented, handed over by a man',
    'who kept them alive by restarting things. The health',
    'check has been green for a month. It should not be.',
  ],
  boot: async () => {
    const deposit = bootDeposit();
    return withCompanion({ ...deposit, snapshot: () => saveDeposit(deposit) }, COMPANION);
  },
  restore: async (snapshot) => {
    const deposit = restoreDepositSave(snapshot);
    return withCompanion({ ...deposit, snapshot: () => saveDeposit(deposit) }, COMPANION);
  },
  coldOpen,
  epilogue,
};

