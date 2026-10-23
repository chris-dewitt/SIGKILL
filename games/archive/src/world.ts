import { Machine, ROOT_USER, type MachineSnapshot, type SqlRuntime, type Track } from '@sigkill/machine';
import { editorCommands } from '@sigkill/editor';
import { asArt, Questbook, questCommands, type BeatLine, type QuestSnapshot } from '@sigkill/quest';
import { CLAIMS_DB, SCHEMA_PATH, SCHEMA_SQL } from './act1/schema.js';
import { BERTH_STATUS, seedYard, yardArt, yardCommands } from './act1/yard.js';
import { CARD, cardCommands, seedCard } from './act1/card.js';
import { deliver } from './act1/mail.js';
import { joinTown, townNetwork } from './act1/registry.js';
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
  /** The town answering back: letters that arrive as the act moves. */
  afterCommand(): BeatLine[];
}

/** Adventure commands that must be re-attached after a restore. */
export function archiveCommands(questbook: Questbook) {
  return [
    ...questCommands(questbook, { speaker: 'MERRICK' }),
    ...editorCommands(),
    ...yardCommands(),
    ...cardCommands(),
  ];
}

function session(machine: Machine, questbook: Questbook): Archive {
  return { machine, questbook, afterCommand: () => deliver(machine, questbook) };
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
  const network = townNetwork(ARRIVAL_MS);
  const machine = new Machine({
    hostname: 'ferryman',
    epoch: ARRIVAL_MS,
    track,
    sql: opts.sql,
    network,
    commands: archiveCommands(questbook),
  });
  joinTown(network, machine);

  seedTown(machine.vfs);
  seedYard(machine.vfs);
  seedCard(machine.vfs);
  questbook.remember('card:seeded');
  await buildClaims(machine);

  machine.shell.cwd = '/home/dewitt';
  machine.shell.env['PWD'] = '/home/dewitt';
  return session(machine, questbook);
}

/** Bring a saved run back. The database is a file, so it comes with it. */
export function restoreArchive(
  snap: { machine: MachineSnapshot; quest: QuestSnapshot },
  opts: ArchiveOptions,
): Archive {
  const track = opts.track ?? 'operator';
  const questbook = new Questbook(ARCHIVE_OBJECTIVES, { track });
  questbook.restore(snap.quest);
  // The registry is a pure function of the path, so it is rebuilt rather
  // than saved; a save from before it existed simply gains it.
  const network = townNetwork(ARRIVAL_MS);
  const machine = Machine.restore(snap.machine, {
    hostname: 'ferryman',
    track,
    sql: opts.sql,
    network,
    commands: archiveCommands(questbook),
  });
  joinTown(network, machine);
  /*
   * Saves from before the yard and the card existed. The yard is the town's
   * and always comes back; the card comes back only if the player still has
   * the folder it travels in, because a player who deleted carried/ meant it.
   * Letters need nothing here -- any that are due arrive on the next command.
   */
  if (!machine.vfs.exists(BERTH_STATUS)) seedYard(machine.vfs);
  if (!machine.vfs.exists(CARD) && machine.vfs.exists('/home/dewitt/carried') && !questbook.remembers('card:seeded')) {
    seedCard(machine.vfs);
  }
  questbook.remember('card:seeded');
  return session(machine, questbook);
}

/**
 * The opening.
 *
 * No ORACLE here -- he stayed with NAV-7, which is the point of him. The
 * voice in game two is a person on a shift who is on DeWitt's side and
 * cannot help, which is a different kind of company and deliberately less
 * comfortable.
 *
 * It opens on the ship, through the yard camera, because the stake of the
 * act is three hundred metres away and he cannot board it. The picture is
 * the same one `yard` draws, from the same file, so the player can go back
 * and look -- and it will have changed by the end.
 */
export function coldOpen(machine: Machine): BeatLine[] {
  return [
    "",
    "  FERRYMAN'S REST — ARCHIVE, TERMINAL 4",
    "",
    ...asArt(yardArt(machine.vfs)),
    "",
    "MERRICK: That is your ship. Berth seventeen, third row. They bonded her this morning.",
    "MERRICK: NAV-7. Recovered under tow. They have listed you as cargo.",
    "MERRICK: The manifest has no box for survivors. I need a certification number.",
    "MERRICK: ... Take your time.",
    "MERRICK: Terminal four. cat README. I will deal with the queue.",
    "MERRICK: hint if you need me. I am not paying for this terminal.",
  ];
}

/**
 * What the act closes on, once the line item is found.
 *
 * The yard again, because it has moved: the berth that said BONDED says STAY.
 * Then Merrick noticing what he found, which is not the same in every run --
 * a player who went after the card hears about it, and one who did not hears
 * where it can be opened. Either way the card goes to the tug, which is where
 * game three finds it.
 */
export function epilogue(machine: Machine): BeatLine[] {
  const lunaFound = ARCHIVE_OBJECTIVES.find((o) => o.id === 'the-other-draft')?.done(machine) === true;
  return [
    '',
    ...asArt(yardArt(machine.vfs)),
    '',
    'MERRICK: Filed before Thursday. It buys us a stay while Kerr reads it.',
    "MERRICK: A draft in Vasquez's name. Hours she signed off. A transfer billed to the grant. Keep all of it.",
    'MERRICK: Whatever left at four twelve, the lane was paid to carry it. Somebody chose that.',
    ...(lunaFound
      ? ['MERRICK: And take that card to the tug. Two of her drafts are enough for one week.']
      : ["MERRICK: The card in your bag. The reader here will not take it. Hollis's galley is not a public terminal."]),
    'MERRICK: Hollis has a berth for you. Eat something before you argue with anyone else.',
    '', '  THE ARCHIVE — COMPLETE',
    '  Keep exploring, or type games for The Harness.', '',
  ];
}
