import { ROOT_USER, type Vfs } from '@sigkill/machine';
import type { BeatLine, Questbook, World } from '@sigkill/quest';
import { BERTH, BERTH_STATUS } from './yard.js';

/**
 * Letters that arrive as the act moves.
 *
 * Chris played the series and said the people did not land. In this act the
 * people were a README, a desk note and a letter in somebody else's home
 * directory -- all present at boot, all read in the first two minutes, and
 * then silence for an hour while the player wrote queries. A town that never
 * says anything back is a set.
 *
 * So the town writes. Each letter is triggered by something the player has
 * *established*, read from the same world state the objectives read, and it
 * lands as an ordinary file in `~/mail` -- `ls`, `cat`, `grep` all work on
 * it, and a player who never reads mail loses colour and nothing else. No
 * letter carries the answer to a puzzle. Some carry a reason to look.
 *
 * Delivery is remembered in the questbook rather than inferred from the files,
 * because the player may delete their mail and should not get it twice.
 */

export const MAILBOX = '/home/dewitt/mail';

export interface Letter {
  /** Questbook key and file name. Numbered, so `ls` reads in arrival order. */
  readonly id: string;
  /** Who, as the one-line notice names them. */
  readonly from: string;
  /** Delivered once this holds. */
  readonly when: (world: World, met: (id: string) => boolean) => boolean;
  readonly body: readonly string[];
  /** Anything else the world does when this letter lands. */
  readonly effect?: (vfs: Vfs) => void;
}

/**
 * The yard's status moves when the story does.
 *
 * Root writes it, because the yard is not DeWitt's; the camera reads it.
 */
function berth(status: string) {
  return (vfs: Vfs): void => {
    try {
      vfs.writeText(BERTH_STATUS, `${status}\n`, ROOT_USER);
    } catch {
      // A yard file somebody with root removed. The camera falls back.
    }
  };
}

export const LETTERS: readonly Letter[] = [
  /*
   * Kerr, early, because the clock has to be on the wall before the player
   * has a reason to look at it. She is the same E. Kerr who writes HEARING in
   * game three, in the same register: the clearest writer in the series,
   * stating the standard so nobody is graded on a rule they were not told.
   */
  {
    id: '1-kerr',
    from: 'E. Kerr, adjuster',
    when: (_w, met) => met('read-the-claim'),
    effect: berth(BERTH.hearing),
    body: [
      'OFFICE OF THE ADJUSTER -- FERRYMAN\'S REST',
      'ref: salvage.22.b / NAV-7',
      '',
      'Mr DeWitt,',
      '',
      'I am told you have read the claim. Good. Most claimants argue with',
      'it first and read it afterwards, and it takes longer.',
      '',
      'The determination is Thursday at 09:00. I will make it on the record',
      'as it stands at that hour. I do not hear argument, I read rows, and',
      'I read all of them.',
      '',
      'If the record is wrong, put something in it. The clerk will tell you',
      'how. She is better at this than she lets anyone see.',
      '',
      '                                          E. KERR, adjuster, grade II',
      '',
    ],
  },
  /*
   * Hollis, once the crew are real in the system. The tug master is the one
   * person in this act who knew NAV-7 as a ship, and the yard camera is their
   * gift: a place to look that is not a table.
   */
  {
    id: '2-hollis',
    from: 'Hollis, ELLEN MAY',
    when: (_w, met) => met('find-the-crew'),
    body: [
      'Doc --',
      '',
      'Merrick says you found them in the archive. All four, with numbers.',
      'I am glad somebody wrote them down properly. I only ever had them as',
      'voices on the lane.',
      '',
      'I walked past your ship this morning. Berth 17, third row. The yard',
      'has a camera on it that anybody can look at, if you type  yard  on',
      'that terminal. I check on her most mornings. I do not know why.',
      'Somebody left a light on in the galley.',
      '',
      'Your berth on ELLEN MAY is made up. The new kettle is better than the',
      'old one, which is the only good news I have.',
      '',
      '                                              -- Hollis',
      '',
    ],
  },
  /*
   * Pell, after the evidence is filed -- and the one letter that points
   * somewhere. Not at the answer: at the account, which Pell's own letter
   * already names. What it adds is a reason to look *now*, and it reads as a
   * man who has been unhelpful on principle discovering he would rather help.
   */
  {
    id: '3-pell',
    from: 'A. Pell, patron',
    when: (_w, met) => met('file-the-evidence'),
    effect: berth(BERTH.stay),
    body: [
      'FROM THE DESK OF AUGUSTIN PELL',
      '',
      'Young man,',
      '',
      'My office tells me you have filed against the operator, and filed',
      'properly, with rows. I have suspended my policy of being unhelpful in',
      'your case. It was not doing anything I could photograph.',
      '',
      'The quarterly statement on my grant arrived this morning and it is',
      'wrong. Not by much, as a fraction of eleven years. By a great deal, as',
      'a fraction of one morning. I do not read statements. I am told the',
      'lane bills by the byte and the archive keeps the bill.',
      '',
      'The account is RG-NAV7-03. I would look myself, but I am told the',
      'terminal requires one to know what a column is.',
      '',
      '                                                             -- A. PELL',
      '',
    ],
  },
];

/**
 * Put any letters that have become due in the mailbox, and say so.
 *
 * Pure apart from the files and the questbook's memory, so a test can drive
 * it without a host. Returns the notice lines for the host to show.
 */
export function deliver(world: World, questbook: Questbook): BeatLine[] {
  const status = questbook.status(world);
  // Met and unblocked: a goal satisfied out of order has not happened yet, as
  // far as the story is concerned, and nobody writes to him about it.
  const met = (id: string): boolean => {
    const row = status.find((candidate) => candidate.id === id);
    return row !== undefined && row.done && row.blockedBy.length === 0;
  };
  const notices: BeatLine[] = [];
  for (const letter of LETTERS) {
    const key = `mail:${letter.id}`;
    if (questbook.remembers(key) || !letter.when(world, met)) continue;
    questbook.remember(key);
    post(world.vfs, letter);
    letter.effect?.(world.vfs);
    notices.push(`  new mail: mail/${letter.id}  from ${letter.from}`);
  }
  return notices.length > 0 ? ['', ...notices, ''] : [];
}

function post(vfs: Vfs, letter: Letter): void {
  const path = `${MAILBOX}/${letter.id}`;
  try {
    vfs.mkdirp(MAILBOX, ROOT_USER);
    vfs.chown(MAILBOX, 1000, 1000, ROOT_USER);
    vfs.writeText(path, letter.body.join('\n'), ROOT_USER);
    vfs.chown(path, 1000, 1000, ROOT_USER);
    vfs.chmod(path, 0o644, ROOT_USER);
  } catch {
    // A mailbox the player turned into a file. The notice still says it came.
  }
}
