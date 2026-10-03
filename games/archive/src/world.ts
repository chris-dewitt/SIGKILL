import { Machine, ROOT_USER, type MachineSnapshot, type SqlRuntime, type Track } from '@sigkill/machine';
import { editorCommands } from '@sigkill/editor';
import { Questbook, questCommands, type BeatLine, type QuestSnapshot } from '@sigkill/quest';
import { CLAIMS_DB, SCHEMA_PATH, SCHEMA_SQL } from './act1/schema.js';
import { seedTown } from './town.js';
import { ARCHIVE_OBJECTIVES } from './objectives.js';

/**
 * Game two: The Archive.
 *
 * Act I ended with DeWitt saving a ship. This opens with a clerk explaining
 * that he did not -- under the salvage clause a vessel recovered without
 * surviving certified crew reverts to the operator, and the archive has him
 * as cargo.
 *
 * Nobody here is the villain. A form is being processed correctly, by people
 * on a shift, against a schema written by somebody who never imagined this.
 * That is the same shape as the ferry profile in Act I: nothing is broken,
 * the configuration is wrong.
 */

/**
 * The day he arrives on Ferryman's Rest.
 *
 * Four days after NAV-7's alarm, two after ELLEN MAY answered. `date` reads
 * it and the archive's own rows are stamped against the same calendar, so a
 * player comparing a note to a row is comparing like with like.
 */
export const ARRIVAL_MS = Date.UTC(2398, 5, 10, 9, 0);

export interface ArchiveOptions {
  track?: Track;
  /**
   * SQLite, supplied by the host.
   *
   * Required rather than optional: game two does not work without it, and a
   * machine that silently boots into a version of the act with no database
   * would be worse than one that refuses.
   */
  sql: SqlRuntime;
}

export interface Archive {
  machine: Machine;
  questbook: Questbook;
}

/** Adventure commands that must be re-attached after a restore. */
export function archiveCommands(questbook: Questbook) {
  return [...questCommands(questbook, { speaker: 'MERRICK' }), ...editorCommands()];
}

/**
 * Build the archive's database by running its own schema.
 *
 * Not shipped as pre-built bytes: the same SQL is written to disk as
 * `/srv/archive/schema.sql`, so the world the player queries and the text
 * they can read are the same thing, and a player who wrecks the database can
 * rebuild it with a command they already know.
 */
async function buildClaims(machine: Machine): Promise<void> {
  machine.vfs.writeText(SCHEMA_PATH, SCHEMA_SQL, ROOT_USER);
  machine.vfs.chmod(SCHEMA_PATH, 0o644, ROOT_USER);

  /*
   * Built as root, because the archive builds its own records.
   *
   * DeWitt cannot write to `/srv/archive` and should not be able to -- the
   * whole act rests on the records being something he can read and argue
   * with rather than edit. The user is swapped for exactly this one command
   * and restored in a `finally`, the same shape `sudo` uses.
   */
  const player = machine.shell.user;
  let result;
  try {
    machine.shell.user = ROOT_USER;
    result = await machine.exec(`sqlite3 ${CLAIMS_DB} < ${SCHEMA_PATH}`);
  } finally {
    machine.shell.user = player;
  }

  if (result.stderr.trim().length > 0) {
    // A world that half-built its own database is not a world to hand a
    // player. Fail loudly at boot rather than quietly at the first query.
    throw new Error(`archive: could not build claims.db: ${result.stderr.trim()}`);
  }
  // Public reading, because the act is about records being public and the
  // system still being unable to see you.
  machine.vfs.chmod(CLAIMS_DB, 0o644, ROOT_USER);
}

export async function bootArchive(opts: ArchiveOptions): Promise<Archive> {
  const track = opts.track ?? 'operator';
  const questbook = new Questbook(ARCHIVE_OBJECTIVES, { track });
  const machine = new Machine({
    hostname: 'ferryman',
    epoch: ARRIVAL_MS,
    track,
    sql: opts.sql,
    commands: archiveCommands(questbook),
  });

  seedTown(machine.vfs);
  await buildClaims(machine);

  machine.shell.cwd = '/home/dewitt';
  machine.shell.env['PWD'] = '/home/dewitt';
  return { machine, questbook };
}

/** Bring a saved run back. The database is a file, so it comes with it. */
export function restoreArchive(
  snap: { machine: MachineSnapshot; quest: QuestSnapshot },
  opts: ArchiveOptions,
): Archive {
  const track = opts.track ?? 'operator';
  const questbook = new Questbook(ARCHIVE_OBJECTIVES, { track });
  questbook.restore(snap.quest);
  const machine = Machine.restore(snap.machine, {
    hostname: 'ferryman',
    track,
    sql: opts.sql,
    commands: archiveCommands(questbook),
  });
  return { machine, questbook };
}

/**
 * The opening.
 *
 * No ORACLE here -- he stayed with NAV-7, which is the point of him. The
 * voice in game two is a person on a shift who is on DeWitt's side and
 * cannot help, which is a different kind of company and deliberately less
 * comfortable.
 */
export function coldOpen(): BeatLine[] {
  return [
    "",
    "  FERRYMAN'S REST — ARCHIVE, TERMINAL 4",
    "",
    "MERRICK: NAV-7. Recovered under tow. They have listed you as cargo.",
    "MERRICK: The manifest has no box for survivors. I need a certification number.",
    "MERRICK: ... Take your time.",
    "MERRICK: Terminal four. cat README. I will deal with the queue.",
    "MERRICK: hint if you need me. I am not paying for this terminal.",
    "",
    "  talk: ask MERRICK about the work or the world",
  ];
}

/** What the act closes on, once the line item is found. */
export function epilogue(): BeatLine[] {
  return [
    'MERRICK: Filed before Thursday. It buys us a stay while the adjuster reads it.',
    'MERRICK: A draft in Vasquez\'s name. A transfer billed to your grant. Keep both.',
    'MERRICK: Hollis has a berth for you. Eat something before you argue with anyone else.',
    '', '  THE ARCHIVE — COMPLETE',
    '  Keep exploring, or type games for The Harness.', '',
  ];
}

