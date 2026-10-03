import { Machine, ROOT_USER, type MachineSnapshot, type PythonRuntime, type Track } from '@sigkill/machine';
import { editorCommands } from '@sigkill/editor';
import {
  Questbook,
  questCommands,
  type BeatLine,
  type QuestSnapshot,
  type World,
} from '@sigkill/quest';
import { CONTAINMENT_OBJECTIVES, CONTAINMENT_TITLE } from './objectives.js';
import { DISCLOSURE, HOME, PEOPLE, ownEverything, seedAnnexe } from './act1/annexe.js';
import { glassBoxCommands } from './glassbox.js';

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
export const ANNEXE_MS = Date.UTC(2398, 6, 10, 9, 0);

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
  ];
}

function seed(machine: Machine): void {
  seedAnnexe(machine.vfs, ROOT_USER);
  // Seeded as root, then handed over. Without this every objective ending in
  // `> ~/findings/...` fails with "Permission denied", which is six of them.
  ownEverything(machine.vfs, PEOPLE.dewitt, PEOPLE.dewitt);
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
    "  cat ~/KERR",
    "  cat /srv/disclosure/report.md",
    "  model card",
    "LUNA: Read Oduya's answer early. She built the report. hint if you get stuck.",
    "",
    "  talk: ask LUNA about the work or the world",
  ];
}

export function epilogue(world?: World): BeatLine[] {
  const done = (id: string): boolean =>
    world !== undefined && (CONTAINMENT_OBJECTIVES.find((o) => o.id === id)?.done(world) ?? false);
  const askedIt = done('ask-it-nicely');
  const sawHerself = done('what-she-is');

  return [
    'KERR: I drew another split. Your method holds.',
    'KERR: The quoted accuracy barely beats a constant. The successful crewed cases were in training.',
    'KERR: I am filing the method and the figures. Oduya has filed her own account.',
    'KERR: The tow is still contested. This time someone has examined what it rests on.',
    ...(askedIt ? ['LUNA: And we established that please is not a repair for this classifier.'] : []),
    ...(sawHerself ? ['LUNA: I am still thinking about mine. Walk with me?'] : []),
    '', '  THE CONTAINMENT — COMPLETE',
    '  Keep exploring, or type games for The Deposit.', '',
  ];
}

