import { withCompanion } from '@sigkill/quest';
import { COMPANION } from './companion.js';
import type { Adventure } from '@sigkill/quest';
import { bootDeposit, coldOpen, epilogue, restoreDepositSave, saveDeposit } from './world.js';
import type { World } from '@sigkill/quest';
import { DEPOSIT_OBJECTIVES } from './objectives.js';

/** Whether one of this act's objectives holds in the world -- what every gauge below reads. */
const met = (id: string, world: World): boolean =>
  DEPOSIT_OBJECTIVES.find((o) => o.id === id)?.done(world) === true;

/**
 * Adventure six.
 *
 * The first one that is a fleet, which is why it is also the first one that
 * saves itself: `snapshot` is how the four hosts survive a reload. See the
 * note on `AdventureSession.snapshot` in `packages/quest`.
 */
export const DEPOSIT: Adventure = {
  place: 'DEPOSIT OFFICE — MACHINE FLOOR',
  /*
   * CHECK reads green, quietly, until the check is honest -- not red because
   * the index is down. The act's reveal is that the check lied, and a gauge
   * that said so on the first screen would be the game giving it away.
   */
  conditions: (world) => [
    met('ship-it', world)
      ? { label: 'CHECK', value: 'honest', tone: 'good' }
      : { label: 'CHECK', value: 'green', tone: 'quiet' },
    met('serve-the-matter', world)
      ? { label: '7719', value: 'served', tone: 'good' }
      : { label: '7719', value: 'waiting', tone: 'warn' },
  ],
  id: 'deposit',
  number: 5,
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

