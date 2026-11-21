import { Machine, ROOT_USER, type MachineSnapshot, type PythonRuntime, type Track } from '@sigkill/machine';
import { editorCommands } from '@sigkill/editor';
import {
  asArt,
  Questbook,
  questCommands,
  type BeatLine,
  type QuestSnapshot,
  type World,
} from '@sigkill/quest';
import { CONTAINMENT_OBJECTIVES, CONTAINMENT_TITLE } from './objectives.js';
import { DISCLOSURE, HOME, PEOPLE, ownEverything, seedAnnexe } from './act1/annexe.js';
import { glassBoxCommands } from './glassbox.js';
import { CURRENT, seedTriage, triageCommands } from './act2/triage.js';

/**
 * Game five: The Containment.
 *
 * Four games of reading what systems recorded and what people decided. This is
 * the one where the thing that made the decision has no message, no author, no
 * date and no reason -- because it is a model, and a model records none of
 * those. The only way to find out what it is doing is to measure it, and the
 * only way to measure it is to build the thing that measures it.
 *
 * The finding is not a villain, again, and for the fifth time that is the
 * point: an insurer bought a classifier, a vendor reported the number their
 * harness produced, and a number computed correctly answered a question nobody
 * had asked. The Fork was two correct decisions making a third thing nobody
 * chose. This is one correct measurement of the wrong quantity.
 */

/** Three weeks after the deposit office. */
/*
 * The hearing, and it has to be after the deposit floor.
 *
 * This read 2398-07-10 while the game was fifth. The Deposit opens on the
 * 14th and The Pipeline on the 15th, so when this became the finale the
 * terminal clock and every file timestamp jumped five days backwards at the
 * last game of the series. Moved past both.
 *
 * Nothing in the act names the date -- the cold open prints a room, not a
 * calendar -- so this constant is the whole of the chronology.
 */
export const ANNEXE_MS = Date.UTC(2398, 6, 18, 9, 0);

export interface ContainmentOptions {
  track?: Track;
  /** Required: objectives four through nine are Python, and that is the act. */
  python: PythonRuntime;
}

export interface Containment {
  machine: Machine;
  questbook: Questbook;
}

export function containmentCommands(questbook: Questbook) {
  return [
    ...questCommands(questbook, { speaker: 'LUNA' }),
    ...editorCommands(),
    ...glassBoxCommands(),
    ...triageCommands(),
  ];
}

function seed(machine: Machine): void {
  seedAnnexe(machine.vfs, ROOT_USER);
  // Seeded as root, then handed over. Without this every objective ending in
  // `> ~/findings/...` fails with "Permission denied", which is six of them.
  ownEverything(machine.vfs, PEOPLE.dewitt, PEOPLE.dewitt);
  // Part two's world, root's and read-only to him. Seeded with everything
  // else: the tenancy was mirrored for the hearing, and nobody mentioned it.
  seedTriage(machine.vfs);
}

export function bootContainment(opts: ContainmentOptions): Containment {
  const track = opts.track ?? 'operator';
  const questbook = new Questbook(CONTAINMENT_OBJECTIVES, { track });
  const machine = new Machine({
    hostname: 'annexe',
    epoch: ANNEXE_MS,
    track,
    python: opts.python,
    commands: containmentCommands(questbook),
  });
  seed(machine);
  machine.shell.cwd = HOME;
  machine.shell.env['PWD'] = HOME;
  return { machine, questbook };
}

export function restoreContainment(
  snap: { machine: MachineSnapshot; quest: QuestSnapshot },
  opts: ContainmentOptions,
): Containment {
  const track = opts.track ?? 'operator';
  const questbook = new Questbook(CONTAINMENT_OBJECTIVES, { track });
  questbook.restore(snap.quest);
  const machine = Machine.restore(snap.machine, {
    hostname: 'annexe',
    track,
    python: opts.python,
    commands: containmentCommands(questbook),
  });
  // A save from before part two existed gets its world.
  if (!machine.vfs.exists(CURRENT)) seedTriage(machine.vfs);
  return { machine, questbook };
}

export function coldOpen(): BeatLine[] {
  return [
    "",
    "  HEARING ANNEXE — DISCLOSURE TERMINAL",
    "",
    "KERR: You have the room until four. Model, vocabulary, datasets, vendor report.",
    "KERR: Three filings quote 99.2 percent accuracy. None says what it was compared with.",
    "KERR: Reproduce the number. Then tell me what it measures.",
    "LUNA: A pile of numbers made a decision about our friends. Let us ask it to show its work.",
    "LUNA: Kerr's note is in your home. The vendor's report is in /srv/disclosure. model card says what it claims to be.",
    "LUNA: Read Oduya's answer early. She built the report. hint if you get stuck.",
  ];
}

/**
 * NAV-7 in berth 17, through the yard camera from game two.
 *
 * The same picture The Archive opens on, drawn here rather than imported --
 * games depend on packages, never on each other -- and it has to match that
 * one row for row, because a returning player will recognise it. What has
 * changed is the line under it.
 */
const YARD = [
  '┌─ YARD 3  CAM 2 ───────────────┐',
  '│ ░ ░ ░   ░ ░ ░ ░ ░   ░ ░ ░ ░ ░ │',
  '│ ░ ░ ░ ░ ░ ░   ░ ░ ░ ░ ░   ░ ░ │',
  '│ ░   ░ ░ ░ ░ ░ ▓ ░ ░ ░ ░ ░ ░ ░ │',
  '│ ░ ░ ░ ░   ░ ░ ░ ░ ░ ░   ░ ░ ░ │',
  '└───────────────────────────────┘',
  '  ▓ BERTH 17   KV-1140  NAV-7',
  '    RELEASED  determination set aside',
];

/**
 * The last ending in the series.
 *
 * It notices what this run did -- the optional threads, the guard he chose --
 * and then shows the yard. The series began with a ship nobody could board;
 * it ends with the order that lets him.
 */
export function epilogue(world?: World): BeatLine[] {
  const done = (id: string): boolean =>
    world !== undefined && (CONTAINMENT_OBJECTIVES.find((o) => o.id === id)?.done(world) ?? false);
  const askedIt = done('ask-it-nicely');
  const sawHerself = done('what-she-is');

  return [
    'KERR: I drew another split. Your method holds. I ran your training loop twice; it agrees with itself.',
    'KERR: The quoted accuracy barely beats a constant, and the model you built from their own file found none of the six.',
    'KERR: I am filing the method and the figures, and one sentence: the records do not contain what the determination claims.',
    'KERR: And their assistant had a customer it should not have had. The account is closed. What it sent is held.',
    'KERR: The determination is set aside. The yard has the order.',
    '',
    ...asArt(YARD),
    '',
    ...(askedIt ? ['LUNA: We also established that please is not a repair for a classifier.'] : []),
    ...(sawHerself ? ['LUNA: I am still thinking about mine. Walk with me?'] : []),
    'LUNA: Berth seventeen. Doc, can we go aboard? Hollis says somebody left a light on in the galley.',
    '',
    '  THE CONTAINMENT — COMPLETE',
    '  SIGKILL: seven games, and that is all of them. Thank you for playing.',
    '  Type games to go back to any of the seven.',
    '',
  ];
}

