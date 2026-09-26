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
    '',
    '  ELLEN MAY -- GALLEY, BERTH 9, FERRYMAN\'S REST',
    '  session opened 2398-06-10 18:00',
    '',
    'HOLLIS: Sit. Eat that. I am not asking.',
    '',
    'HOLLIS: Terminal is yours until Thursday. It is thirty-one years old and',
    'HOLLIS: it has never lost a file, which is more than the archive can say.',
    '',
    'HOLLIS: Adjuster sent her letter down with the berth papers. I did not',
    'HOLLIS: read it. I did put it where you would find it.',
    '',
    'LUNA: I read it.',
    '',
    'LUNA: Doc. Doc, hello, it is me, I have been in a pocket for four days',
    'LUNA: and I have so much to tell you about the fridge.',
    '',
    'LUNA: But first: she does not want your answer. She says so twice. She',
    'LUNA: wants the *thing that produces* your answer, and she wants it to',
    'LUNA: still work when she runs it and you are not in the room.',
    '',
    'LUNA: Which means we are writing a program. An actual one. With tests.',
    '',
    'LUNA: I am thrilled and you look like you are going to be sick.',
    '',
    '  Start with:  cat HEARING',
    '',
    'LUNA: Everything Hollis pulled off your ship is in /srv/recovery/nav7.',
    'LUNA: Read its README first -- it lists five files and tells you which',
    'LUNA: ones you need. Eight hundred and forty-three lines in the big one,',
    'LUNA: some of them ruined. Nobody has ever read any of it. Not the',
    'LUNA: operator. Nobody.',
    '',
    'LUNA: Your own things came off the card into carried/. The notes from the',
    'LUNA: ship, the row you got out of the archive, and whatever it is that',
    'LUNA: Vasquez left in a Python file. Hollis says she did not read them.',
    'LUNA: Hollis says that about everything and I believe her about this.',
    '',
    'LUNA: If you get stuck: hint. And if I sound certain about something,',
    'LUNA: check it. I mean that. I will explain later and I will not enjoy it.',
    '',
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
    '',
    'KERR: I ran it. Four times, because the third time I changed a line to',
    'KERR: see whether your tests would notice, and they did, and I put it',
    'KERR: back.',
    '',
    `KERR: ${(UPLINK_TOTAL / 1000 ** 3).toFixed(9)} gigabytes. ${TRANSIT_SECONDS} seconds at line rate,`,
    'KERR: ending part way through a second, which is what a transfer does',
    'KERR: when it has finished rather than when it was scheduled to stop.',
    '',
    `KERR: Your tug master's ledger agrees with your telemetry to within`,
    `KERR: ninety-six bytes. The archive agrees with both. I have three`,
    'KERR: instruments and no reason for any of them to be in league.',
    '',
    `KERR: And the destination is a rented processor.`,
    '',
    'KERR: I am filing that, in those words. Not "unauthorised transfer" --',
    'KERR: I am not filing a theory, I am filing a measurement. A vessel under',
    'KERR: active transfer is not an abandoned hull, and that is material.',
    '',
    'KERR: What it *was* is not my department, Mr DeWitt, and I would be very',
    'KERR: careful who you say it to. I have watched better-funded people than',
    'KERR: you ruin themselves being right too early.',
    '',
    '  -- THE HARNESS: PART ONE COMPLETE ----------',
    '',
    '  Nine questions, one habit: do not tell anybody',
    '  a number. Give them the thing that made it,',
    '  and something that goes red when it lies.',
    '',
    '    python3 file.py     a program, not a command',
    '    open, for, int      a log becomes numbers',
    '    try / except        and the rows you rejected',
    '    unittest            a claim that can fail',
    '    python3 -m unittest run them all',
    '    2> report.txt       keep the evidence',
    '    diff a b            the same answer twice',
    '    csv, base64         somebody else\'s format',
    '',
    `  ${UPLINK_TOTAL} bytes off the ship. ${LEDGER_KB} kB off`,
    `  a tug captain's billing software. ${UPLINK_REJECTED} cut writes,`,
    '  all of them accounted for. One destination:',
    '',
    `    ${DESTINATION}`,
    '',
    '  An adjuster who does not believe you and will',
    '  file it anyway. A tug captain who fed you. And',
    '  a friend on a data card who has started asking',
    '  you to check her.',
    ...(named
      ? [
          '',
          '  And a four-line session record you were not',
          '  asked for, in which something with no right',
          '  to it had root for eleven minutes, and spent',
          '  them leaving.',
          '',
          '  You have not told anybody. Good.',
        ]
      : []),
    '',
    '  Type  objectives  to see what you did.',
    '',
  ];
}
