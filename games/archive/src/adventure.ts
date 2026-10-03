import { withCompanion } from '@sigkill/quest';
import { COMPANION } from './companion.js';
import { require_, type Adventure } from '@sigkill/quest';
import { bootArchive, restoreArchive, coldOpen, epilogue } from './world.js';

/**
 * Adventure two.
 *
 * The only one of the three whose boot is asynchronous -- it builds its own
 * database by running the schema it ships as readable text, which is the point
 * of it -- so the contract allows a promise for this game's sake.
 */
export const ARCHIVE: Adventure = {
  id: 'archive',
  number: 2,
  title: 'The Archive',
  teaches: 'SQL and data',
  blurb: [
    'A clerk on a public terminal explains, kindly, that the',
    'records have you as cargo. Everything in the building is a',
    'row, including the sentence about your friends.',
  ],
  needs: ['sql'],
  boot: async (runtimes) => withCompanion(await bootArchive({ sql: require_(runtimes.sql, 'The Archive', 'sqlite') }), COMPANION),
  restore: async (snapshot, runtimes) =>
    withCompanion(restoreArchive(snapshot, { sql: require_(runtimes.sql, 'The Archive', 'sqlite') }), COMPANION),
  coldOpen,
  epilogue,
};

