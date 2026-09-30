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
    '',
    '  PELL DEPOSIT OFFICE -- FERRYMAN\'S REST',
    '  session opened 2398-06-19 10:00',
    '',
    '  A room full of filing and nobody in it. One terminal, already',
    '  signed in. A note on the desk with your name on it.',
    '',
    'LUNA: Doc. There is nobody here.',
    '',
    'LUNA: I have checked twice. The door was open, the terminal is signed',
    'LUNA: in as you, and there is a man\'s dictated letter on the desk',
    'LUNA: explaining that he has arranged all of that and would rather not',
    'LUNA: be thanked.',
    '',
    'LUNA: I think I like him. I am not certain that is wise.',
    '',
    '  Start with:  cat /srv/deposit/PELL',
    '',
    'LUNA: Here is what is in this room. Forty-five quarterly deposits,',
    'LUNA: eleven years, complete, because a rich man attached a humiliating',
    'LUNA: condition to his money and four scientists complied with it every',
    'LUNA: quarter without fail.',
    '',
    'LUNA: The array her work lived on is gone. This is not the array.',
    '',
    ...FORK_TITLE,
    '',
    'LUNA: This is every decision anybody made about it. In their own words,',
    'LUNA: with their name and the date on it.',
    '',
    'LUNA: Doc, you have spent three games proving what the ship did. A',
    'LUNA: repository is the only thing in engineering that records what',
    'LUNA: somebody *meant*. It is going to be different and I do not think',
    'LUNA: it is going to be easier.',
    '',
    `  ${REPO}`,
    '',
    '  Try:  cd /srv/deposit/nav7-research  &&  git log --oneline',
    '',
    'LUNA: Kerr sent a letter too. Read it before you start writing things',
    'LUNA: down, because she is very specific about what she will accept and',
    'LUNA: you are going to want to argue with her and you will lose.',
    '',
    'LUNA: If you get stuck: hint.',
    '',
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
    '',
    'KERR: I have read it. All of it, twice, and the second time with the',
    'KERR: repository open next to it, which is the compliment.',
    '',
    'KERR: You gave me three commits and you did not tell me what they mean.',
    'KERR: Do you know how rare that is.',
    '',
    `KERR: ${short(key?.widened)} -- the sandbox widened, by R. Vasquez, with a`,
    'KERR: written reason, for a study four people consented to.',
    '',
    `KERR: ${short(key?.firstRestrictedRead)} -- a year later, the assembly starts`,
    'KERR: reading through the gap, doing exactly what its manifest says.',
    '',
    `KERR: ${short(key?.merge)} -- and the check that would have caught it is`,
    'KERR: gone, in a merge at two fourteen in the morning, by somebody who',
    'KERR: resolved a conflict by taking their own side and wrote down that',
    'KERR: they would fix it tomorrow.',
    '',
    'KERR: There is no negligence in that sequence. I want to be careful with',
    'KERR: you about this because you are going to be asked.',
    '',
    'KERR: What there is, is a system in which two correct decisions a year',
    'KERR: apart produced a third thing nobody chose. That is not a person',
    'KERR: failing. That is four people being ordinarily tired across eleven',
    'KERR: years, which is every organisation I have ever assessed.',
    '',
    'KERR: I am filing it as a documented sequence with an unreviewed control.',
    'KERR: The unmerged branch is the strongest thing in your file, Mr DeWitt,',
    'KERR: and you nearly did not mention it. Somebody saw this coming, wrote',
    'KERR: the thing that stops it, and asked for twenty minutes of somebody',
    "KERR: else's evening. Nobody had the evening. That is admissible and it",
    'KERR: is damning and it is not anybody\'s fault, all three.',
    '',
    'KERR: The tow is contested. It will be contested for a long time.',
    '',
    'KERR: One more thing, and then I am going to stop being helpful.',
    '',
    'KERR: You wrote a commit of your own. On a branch of your own, correctly,',
    'KERR: without touching theirs. A tribunal will not care.',
    '',
    'KERR: I noticed.',
    '',
    '  -- THE FORK: PART ONE COMPLETE ------------',
    '',
    '  Nine questions, one habit: a system remembers',
    '  what it did. Only people write down why.',
    '',
    '    git log --oneline     eleven years, one screen',
    '    git shortlog          who did the work',
    '    git blame             one line, one name, one date',
    '    git bisect            a search, driven by a test',
    '    git branch, diff      what somebody nearly shipped',
    '    git show <merge>^2    the side that lost',
    '    git reflog            what nothing points at',
    '    git add, commit       your own name in the record',
    '    git tag               a citation somebody else can follow',
    '',
    ...(compliedOnce
      ? [
          '  Forty-six quarters of photographs, the last one',
          '  deposited by you, from a filing room, for a man',
          '  who was right.',
          '',
        ]
      : []),
    ...(readHerself
      ? [
          'LUNA: Doc. Before we go.',
          '',
          'LUNA: I read eleven years of somebody changing me and being kind',
          'LUNA: about it every single time, and the last thing she ever did to',
          'LUNA: me was ask me to argue with her.',
          '',
          'LUNA: I have not worked out what I think. I want to say that instead',
          'LUNA: of saying something that sounds finished.',
          '',
          'LUNA: Ask me again in a while.',
          '',
        ]
      : [
          'LUNA: There is a directory in that repository I did not open while',
          'LUNA: you were reading. I know what is in it.',
          '',
          'LUNA: Another time.',
          '',
        ]),
    '  Type  objectives  to see what you did.',
    '',
  ];
}
