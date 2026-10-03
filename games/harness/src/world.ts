import { Machine, type MachineSnapshot, type PythonRuntime, type Track } from '@sigkill/machine';
import { editorCommands } from '@sigkill/editor';
import {
  Questbook,
  questCommands,
  type BeatLine,
  type QuestSnapshot,
  type World,
} from '@sigkill/quest';
import { seedShip } from './ship.js';
import { HARNESS_OBJECTIVES } from './objectives.js';
import { DESTINATION, LEDGER_KB, TRANSIT_SECONDS, UPLINK_REJECTED, UPLINK_TOTAL } from './act1/dump.js';

/**
 * Game three: The Harness.
 *
 * Game two ended with a stay, not a win, and an adjuster due on Thursday with
 * the clause printed out. This opens with her letter, which asks for the one
 * thing he cannot talk his way into: a method somebody else can run.
 *
 * Nobody here is the villain either, and Kerr least of all. She is *rigorous*,
 * which is a harder opponent than malice -- there is no appealing to her better
 * nature, because she already has one and it is the reason she will not take
 * his word. The shape is the ferry profile again, one turn further on: nothing
 * is broken, and the standard of evidence is correct, and he is still losing.
 */

/**
 * The day he starts work. Two days before the hearing.
 *
 * Four days after NAV-7's alarm, two after he reached the archive. `date`
 * reads this, and the recovery dump is stamped against the same calendar, so
 * a player comparing a note to a row is comparing like with like.
 */
export const BERTH_MS = Date.UTC(2398, 5, 10, 18, 0);

export interface HarnessOptions {
  track?: Track;
  /**
   * Python, supplied by the host.
   *
   * Required rather than optional, for the reason game two requires SQLite:
   * the adventure does not work without it, and a machine that quietly booted
   * into a version of the act with no interpreter would be worse than one that
   * refuses to boot at all.
   */
  python: PythonRuntime;
}

export interface Harness {
  machine: Machine;
  questbook: Questbook;
}

/** Adventure commands that must be re-attached after a restore. */
export function harnessCommands(questbook: Questbook) {
  return [...questCommands(questbook, { speaker: 'LUNA' }), ...editorCommands()];
}

export function bootHarness(opts: HarnessOptions): Harness {
  const track = opts.track ?? 'operator';
  const questbook = new Questbook(HARNESS_OBJECTIVES, { track });
  const machine = new Machine({
    hostname: 'ellenmay',
    epoch: BERTH_MS,
    track,
    python: opts.python,
    commands: harnessCommands(questbook),
  });

  seedShip(machine.vfs);

  machine.shell.cwd = '/home/dewitt';
  machine.shell.env['PWD'] = '/home/dewitt';
  return { machine, questbook };
}

/** Bring a saved run back. */
export function restoreHarness(
  snap: { machine: MachineSnapshot; quest: QuestSnapshot },
  opts: HarnessOptions,
): Harness {
  const track = opts.track ?? 'operator';
  const questbook = new Questbook(HARNESS_OBJECTIVES, { track });
  questbook.restore(snap.quest);
  const machine = Machine.restore(snap.machine, {
    hostname: 'ellenmay',
    track,
    python: opts.python,
    commands: harnessCommands(questbook),
  });
  return { machine, questbook };
}

/**
 * The opening.
 *
 * Luna carries the act, which is the point of her being back. Merrick was a
 * person on a shift who was on his side and could not help; Luna is on his
 * side, can help, and is wrong about roughly one thing in eight. That is a
 * third kind of company and by some distance the most modern.
 */
export function coldOpen(): BeatLine[] {
  return [
    "",
    "  ELLEN MAY — GALLEY",
    "",
    "HOLLIS: Sit. Eat that. Terminal is yours until Thursday.",
    "HOLLIS: Adjuster sent a letter. I put it by the berth papers.",
    "LUNA: I read it. Four days in a pocket, Doc. I have opinions about the fridge.",
    "LUNA: First: Kerr wants your program, tests, and the same answer twice.",
    "LUNA: Start with cat HEARING, then cat /srv/recovery/nav7/README. Your files are in carried/.",
    "LUNA: hint if you need me. Check me if I sound certain.",
    "",
    "  talk: ask LUNA about the work or the world",
  ];
}

/**
 * What the act closes on, once Kerr has the package.
 *
 * Takes the world, because an optional thread that does not change the ending is
 * not worth following. Kerr's filing is identical either way -- she files a
 * measurement and declines the theory, and that is the whole point of her -- but
 * a player who put a name to AUTOMATED is owed an act that noticed, and a player
 * who did not must never be told what they missed.
 */
export function epilogue(world?: World): BeatLine[] {
  const named =
    world !== undefined &&
    (HARNESS_OBJECTIVES.find((o) => o.id === 'the-same-hand')?.done(world) ?? false);

  return [
    'KERR: I changed a line. Your tests failed. I put it back.',
    `KERR: ${UPLINK_TOTAL} bytes. ${TRANSIT_SECONDS} seconds. Destination: ${DESTINATION}.`,
    'KERR: The ship, the archive, and the tug ledger agree. I am filing the measurement.',
    'KERR: Be careful who you give the theory to, Mr DeWitt.',
    ...(named ? ['LUNA: It had root for eleven minutes. Kerr did not ask what used it. I am glad you did.'] : []),
    'HOLLIS: Supper. Both of you. The small one can complain about the fridge.',
    '', '  THE HARNESS — COMPLETE',
    '  Keep exploring, or type games for The Fork.', '',
  ];
}

