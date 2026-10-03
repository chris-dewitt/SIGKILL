import { Machine, ROOT_USER, type MachineSnapshot, type PythonRuntime, type Track } from '@sigkill/machine';
import { editorCommands } from '@sigkill/editor';
import { gitCommands } from '@sigkill/git';
import {
  Questbook,
  questCommands,
  type BeatLine,
  type QuestSnapshot,
  type World,
} from '@sigkill/quest';
import { FORK_OBJECTIVES, FORK_TITLE } from './objectives.js';
import { REPO, seedRepository } from './act1/history.js';
import { HOME, PEOPLE, seedOffice, ownEverything } from './act1/office.js';
import { facts, repoOf } from './evidence.js';

/**
 * Game four: The Fork.
 *
 * Three games of proving what the ship *did*. This is the one where he finds
 * out what Vasquez was trying to do, and that the two are not the same thing.
 *
 * A repository is the only artefact in engineering that records intent -- a
 * message, an author, a date, and a diff, in somebody's own words, about a
 * decision they made on purpose. Everything DeWitt has had until now was a
 * machine's account of itself: counters, byte totals, a session log. None of it
 * says what anybody meant, and the whole act turns on the difference.
 *
 * The finding is not a villain. It is two reasonable changes a year apart made
 * by people who could not see each other, and a check that would have caught
 * the result being deleted at two in the morning by somebody tired who took a
 * default. Nobody here is wicked, which is worse, and the act has to be allowed
 * to land that way rather than reaching for a culprit it does not have.
 */

/**
 * A week after the hearing.
 *
 * Game three was berthed 2398-06-10 and the hearing was the Thursday. `date`
 * reads this, the deposits are stamped against the same calendar, and every
 * commit in the history is dated on it -- so a player comparing a commit to a
 * note to a telemetry row is comparing like with like across four games.
 */
export const OFFICE_MS = Date.UTC(2398, 5, 19, 10, 0);

export interface ForkOptions {
  track?: Track;
  /**
   * Python, supplied by the host.
   *
   * Required, not optional. Objective four is `git bisect` driven by a test the
   * player writes in Python, which is the objective the whole curriculum has
   * been building toward -- two games of skills in one command. An act booted
   * without an interpreter would offer that objective and then refuse it four
   * commands in, which is worse than refusing to boot.
   */
  python: PythonRuntime;
}

export interface Fork {
  machine: Machine;
  questbook: Questbook;
}

/** Adventure commands, re-attached after a restore as well as on boot. */
export function forkCommands(questbook: Questbook) {
  return [
    ...questCommands(questbook, { speaker: 'LUNA' }),
    ...editorCommands(),
    // Every commit DeWitt makes is authored by whoever the shell says is
    // running, looked up per call rather than captured -- so `sudo git commit`
    // is signed by root, exactly as it would be.
    ...gitCommands({
      identity: (ctx) => ({ name: ctx.user.name, email: `${ctx.user.name}@ferryman` }),
    }),
  ];
}

function seed(machine: Machine): void {
  seedOffice(machine.vfs, ROOT_USER);
  seedRepository(machine.vfs, ROOT_USER);
  // Seeded as root, then handed over, so the working copy and the home
  // directory are genuinely DeWitt's -- which is what lets objective eight
  // commit without sudo. Pell arranged it; the filesystem has to agree.
  ownEverything(machine.vfs, PEOPLE.dewitt, PEOPLE.dewitt);
}

export function bootFork(opts: ForkOptions): Fork {
  const track = opts.track ?? 'operator';
  const questbook = new Questbook(FORK_OBJECTIVES, { track });
  const machine = new Machine({
    hostname: 'deposit',
    epoch: OFFICE_MS,
    track,
    python: opts.python,
    commands: forkCommands(questbook),
  });

  seed(machine);

  machine.shell.cwd = HOME;
  machine.shell.env['PWD'] = HOME;
  return { machine, questbook };
}

export function restoreFork(
  snap: { machine: MachineSnapshot; quest: QuestSnapshot },
  opts: ForkOptions,
): Fork {
  const track = opts.track ?? 'operator';
  const questbook = new Questbook(FORK_OBJECTIVES, { track });
  questbook.restore(snap.quest);
  const machine = Machine.restore(snap.machine, {
    hostname: 'deposit',
    track,
    python: opts.python,
    commands: forkCommands(questbook),
  });
  return { machine, questbook };
}

/**
 * The opening.
 *
 * Pell is present the way he is present in game two: as writing. He does not
 * comfort and he does not explain, and the empty room is the whole of his
 * opinion -- which is the decision `docs/GAME4_BEATS.md` §8 left open and which
 * had to be settled for the act to exist. A clerk would have given him somebody
 * to be rude to. The room being open with nobody in it is lonelier, and it puts
 * DeWitt alone with eleven years of his friend's working life, which is what
 * the act is about.
 */
export function coldOpen(): BeatLine[] {
  return [
    "",
    "  PELL DEPOSIT OFFICE — READING ROOM",
    "",
    "LUNA: There is nobody here. Pell left a note: the array is gone; the quarterly deposits are not.",
    "LUNA: His feet clause preserved eleven years of research. He underlined that.",
    "LUNA: I am continuing to laugh. While opening the repository.",
    "LUNA: Read Kerr's letter before you write your findings.",
    "  cd /srv/deposit/nav7-research && git log --oneline",
    "LUNA: Each change has a name beside it. This may be harder than the logs.",
    "  objectives: your work     hint: help",
    "",
    "  talk: ask LUNA about the work or the world",
  ];
}

/**
 * What the act closes on.
 *
 * Kerr files what she can file. The two optional threads change what the
 * ending *notices* rather than what she does, for the reason game three
 * established: an optional thread that changes the outcome is homework, and a
 * player who skipped one must never be told what they missed.
 */
export function epilogue(world?: World): BeatLine[] {
  const done = (id: string): boolean =>
    world !== undefined && (FORK_OBJECTIVES.find((o) => o.id === id)?.done(world) ?? false);

  const readHerself = done('her-own-history');
  const compliedOnce = done('the-feet-clause');

  const found = world === undefined ? undefined : repoOf(world);
  const key = found === undefined ? undefined : facts(found);
  const short = (id?: string): string => (id === undefined ? '-------' : id.slice(0, 7));

  return [
    `KERR: ${short(key?.widened)} widened the boundary. ${short(key?.firstRestrictedRead)} began using it.`,
    `KERR: ${short(key?.merge)} lost the check. The unmerged branch had a remedy.`,
    'KERR: A documented sequence. I can file that. The tow remains contested.',
    'KERR: Your own check is on a separate branch. A tribunal will not care. I noticed.',
    ...(compliedOnce ? ['LUNA: Another quarter of feet. The deposit survives.'] : []),
    ...(readHerself ? [
      'LUNA: Her last change asked me to argue with her.',
      'LUNA: I wish I could tell her I read it.',
    ] : []),
    '', '  THE FORK — COMPLETE',
    '  Keep exploring, or type games for The Containment.', '',
  ];
}

