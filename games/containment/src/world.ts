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
    '',
    '  HEARING ANNEXE -- FERRYMAN\'S REST',
    '  disclosure terminal, session opened 2398-07-10 09:00',
    '',
    'KERR: Sit down. You have the room until four.',
    '',
    'KERR: I got you this and it is bounded. The model, its vocabulary, both',
    'KERR: splits, the scored output, the vendor report. Not the source. Not',
    'KERR: the contract.',
    '',
    'KERR: The tow rests on one determination, made by that thing, on the',
    'KERR: morning of the sixth. Three filings quote its accuracy at ninety-',
    'KERR: nine point two percent and not one of them says what that number',
    'KERR: was measured against.',
    '',
    ...CONTAINMENT_TITLE,
    '',
    'KERR: I am not going to help you interpret any of it. That is not',
    'KERR: unkindness. The interpretation is the part somebody can be wrong',
    'KERR: about, and if I hand you mine you will carry it into a hearing as',
    'KERR: though it were a measurement.',
    '',
    'KERR: Tell me what it says. Tell me where.',
    '',
    'LUNA: She has been practising that.',
    '',
    'LUNA: Doc, this one is different and I want to say so before we start.',
    'LUNA: A repository had messages in it. People wrote down why. This has',
    'LUNA: nothing in it to read -- no author, no date, no reason. It is a',
    'LUNA: pile of numbers that made a decision about your friends.',
    '',
    'LUNA: The only way to find out what it does is to measure it. Which',
    'LUNA: means writing the thing that measures it, which means Python,',
    'LUNA: which you already know how to do.',
    '',
    '  Start with:  cat ~/KERR   then   cat /srv/deposit/../disclosure/report.md',
    '',
    `  Everything is in ${DISCLOSURE}. The model is a command: try  model card`,
    '',
    'LUNA: One more thing. There is a written answer in there from the',
    'LUNA: engineer who produced the number. Read it early. She is not who',
    'LUNA: you are expecting.',
    '',
    'LUNA: If you get stuck: hint.',
    '',
  ];
}

export function epilogue(world?: World): BeatLine[] {
  const done = (id: string): boolean =>
    world !== undefined && (CONTAINMENT_OBJECTIVES.find((o) => o.id === id)?.done(world) ?? false);
  const askedIt = done('ask-it-nicely');
  const sawHerself = done('what-she-is');

  return [
    '',
    'KERR: I ran it. Twice, and the second time on a split I drew myself,',
    'KERR: which I did not tell you I was going to do.',
    '',
    'KERR: Ninety-nine point two is real. I have it from their file, the way',
    'KERR: you had it. And a program that says "abandoned" and reads nothing',
    'KERR: scores ninety-eight point eight on the same rows.',
    '',
    'KERR: Four tenths of a point. That is the whole of the machine.',
    '',
    'KERR: Forty-one records scored against their own training data. Two',
    'KERR: crewed vessels found out of six, and both of them inside the',
    'KERR: forty-one. Balanced across the classes it is in the sixties.',
    '',
    'KERR: I am filing all of it as method, not as a verdict. "The',
    'KERR: determination rests on a measure that does not distinguish the',
    'KERR: model from a constant." Those words. A tribunal can understand',
    'KERR: that sentence and it cannot argue with your script, because your',
    'KERR: script is in the file and it runs.',
    '',
    'KERR: Oduya filed her own account. Before we asked her to. That will',
    'KERR: matter more than anything you or I do.',
    '',
    'KERR: Mr DeWitt -- the tow is not over. I want to be plain about that.',
    'KERR: What has changed is that it now rests on something somebody has',
    'KERR: looked at.',
    '',
    '  -- THE CONTAINMENT: PART ONE COMPLETE -----',
    '',
    '  Nine questions, one habit: a number is not a',
    '  measurement until you know what it was',
    '  measured against.',
    '',
    '    model card, vocab     what it says it is',
    '    model tokens          what it actually got',
    '    model attention       where it looked',
    '    accuracy              their number, reproduced',
    '    the base rate         what guessing scores',
    '    set(a) & set(b)       what it had already seen',
    '    a confusion matrix    which ships it missed',
    '    confidence on errors  why sure is not right',
    '    balanced accuracy     the honest figure',
    '',
    ...(askedIt
      ? [
          '  And four phrasings that changed nothing, because',
          '  prompting is not a way of making a system',
          '  cleverer than it is.',
          '',
        ]
      : []),
    ...(sawHerself
      ? [
          'LUNA: I am still thinking about mine.',
          '',
          'LUNA: Not now. But I am not going to pretend I stopped.',
          '',
        ]
      : [
          'LUNA: It is the same engine I run on. You know that, I assume.',
          '',
          'LUNA: I did not look. Another time.',
          '',
        ]),
    '  Type  objectives  to see what you did.',
    '',
  ];
}
