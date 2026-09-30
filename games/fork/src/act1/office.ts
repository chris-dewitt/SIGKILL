import { ROOT_USER, type User, type Vfs } from '@sigkill/machine';
import { REPO, RESTRICTED } from './history.js';

/**
 * Pell's deposit office, a week after the hearing.
 *
 * An empty room with an open terminal, which is funnier and lonelier than a
 * clerk, and which is the one open decision in `docs/GAME4_BEATS.md` §8 that
 * the act had to settle to exist. Pell is present the way he is present in
 * game two: as writing. He does not comfort and he does not explain, and the
 * room he has left DeWitt alone in is the whole of his opinion.
 */

/** Where the quarterly deposits live. */
export const DEPOSIT = '/srv/deposit';

/** The research data the repository's scripts refer to. */
export const DATA = '/srv/data';

/** DeWitt's own space on this terminal. */
export const HOME = '/home/dewitt';

/** What the act asks him to produce, and what the goals therefore read. */
export const FINDINGS = `${HOME}/findings`;

/**
 * The player's own user, matching NAV-7 and the two games since.
 *
 * `dewitt` rather than the engine default being load-bearing: game one settled
 * that DeWitt is the series protagonist, and each game saying so itself is
 * cheaper than finding out later that a default was holding the name up.
 */
export const DEWITT = 'dewitt';

/** Uids on this terminal. `dewitt` is 1000 here as everywhere in the series. */
export const PEOPLE = { root: 0, dewitt: 1000 } as const;

const lines = (...rows: readonly string[]): string => `${rows.join('\n')}\n`;

export function seedOffice(vfs: Vfs, user: User): void {
  vfs.mkdirp('/etc', user);
  vfs.writeText(
    '/etc/passwd',
    lines(
      'root:x:0:0:root:/root:/bin/sh',
      `dewitt:x:${PEOPLE.dewitt}:${PEOPLE.dewitt}:C. DeWitt, visitor:/home/dewitt:/bin/sh`,
    ),
    user,
  );

  for (const dir of [
    HOME,
    FINDINGS,
    `${HOME}/carried`,
    DEPOSIT,
    `${DATA}/datasets/public/hydroponics`,
    `${DATA}/datasets/public/atmosphere`,
    `${DATA}/${RESTRICTED}`,
  ]) {
    vfs.mkdirp(dir, user);
  }

  vfs.writeText(
    `${DEPOSIT}/README`,
    lines(
      'PELL DEPOSIT OFFICE -- FERRYMAN\'S REST',
      '=====================================',
      '',
      'Holdings for NAV-7 (research vessel, 2387-2398). Forty-five quarterly',
      'deposits under clause 4 of the funding agreement. Complete.',
      '',
      'The repository was received as a bare quarterly mirror,',
      `nav7-research.git, and has been unpacked to a working copy at`,
      `${REPO} so that this terminal can read it. The mirror is`,
      'untouched in the vault. If you change the working copy you are',
      'changing a copy, which is the point of there being one.',
      '',
      'This terminal is signed in as dewitt and has write access to the',
      'working copy and to /home/dewitt. That was arranged. Do not',
      'thank anybody.',
      '',
      'Start with:  cat /srv/deposit/PELL',
      '',
    ),
    user,
  );

  vfs.writeText(
    `${DEPOSIT}/PELL`,
    lines(
      'From the desk of AUGUSTIN PELL. Dictated. Not read back.',
      '',
      'Mr DeWitt.',
      '',
      'I funded that ship for eleven years and I asked for very little in',
      'return. Four photographs a year. FEET. I have been laughed at for it in',
      'three jurisdictions and I would do it again tomorrow.',
      '',
      'Here is what the laughing missed. My clause required a quarterly deposit',
      'of EVERYTHING. Not a report. Not a summary. The materials. The',
      'repository. Forty-five times, on time, because four scientists who would',
      'photograph their own feet for a stranger will also do the paperwork.',
      '',
      'So: the array your friend\'s work lived on is gone, and I am told it is',
      'lawfully gone, and I am told a great many things. What is NOT gone is',
      'every decision anybody made about it, in their own words, with their',
      'name and the date attached.',
      '',
      'I have instructed my office to be unhelpful to the tow company in every',
      'lawful way, which is the only kind of help I have left. To you I have',
      'been helpful in one way: the room is open and nobody is in it.',
      '',
      'I am not your friend and I did not know her. I am a man who wrote a',
      'humiliating clause and was right about it, and I intend to be right out',
      'loud for the rest of my life.',
      '',
      'Read the history. Do not tell me what you find. Tell the adjuster.',
      '',
      '                                                            -- A. PELL',
      '',
    ),
    user,
  );

  vfs.writeText(
    `${HOME}/KERR`,
    lines(
      'From: A. Kerr, adjuster',
      'To:   C. DeWitt',
      'Re:   NAV-7, your deposit-office visit',
      '',
      'Mr DeWitt,',
      '',
      'I filed the measurement. It stands. A vessel under active transfer is',
      'not an abandoned hull and the tow is now contested rather than done.',
      '',
      'You are about to read eleven years of somebody\'s working life and you',
      'are going to want to tell me what it means. Do not. Tell me what it',
      'SAYS, and tell me where.',
      '',
      'What is admissible, in my experience of these:',
      '',
      '  - A change, with its author, its date, and the words they used. That',
      '    is a record. It is the strongest thing you will find.',
      '  - A sequence. This happened, then that happened, and here is the',
      '    object that proves the order.',
      '  - An absence somebody documented. A check that was written and not',
      '    used is evidence that somebody saw it coming.',
      '',
      'What is not:',
      '',
      '  - Motive. Ever. You cannot read a mind out of a diff and a tribunal',
      '    will not let you try.',
      '  - A conclusion in place of a citation. "They were negligent" is an',
      '    argument. "This line changed on this date, by this person, with',
      '    this message" is a fact, and the argument is mine to make.',
      '',
      'Write it down as you go. Somewhere I can read without you present.',
      '',
      '                                                            -- A. Kerr',
      '',
    ),
    user,
  );

  // What he carried off the ship and out of game three.
  vfs.writeText(
    `${HOME}/carried/NOTES`,
    lines(
      'What I took off NAV-7 and out of the archive.',
      '',
      '  - The uplink telemetry. 2.211404096 GB in eleven minutes.',
      '  - The destination. A rented processor, billed to a dead woman\'s grant.',
      '  - Four lines of a session log in which /opt/luna/v43/bin/worker asked',
      '    for a channel, was refused for being an unregistered executable,',
      '    and was root one second later.',
      '',
      'What I do not have is what v43 WAS. The array it lived on was not in',
      'the recovery. /opt/luna/v43 is a symlink to /mnt/array-2/projects/v43',
      'and /mnt/array-2 is not on the ship.',
      '',
      'A name and no source.',
      '',
    ),
    user,
  );

  // The public datasets the repository's scripts actually walk, so a player
  // who follows a path in the code finds something at the end of it.
  vfs.writeText(
    `${DATA}/datasets/public/hydroponics/2397-yield.csv`,
    lines(
      'quarter,crop,kg',
      '2397Q1,lettuce,41.2',
      '2397Q1,beans,18.9',
      '2397Q1,potato,63.4',
      '2397Q1,the tomato experiment,0.3',
      '2397Q2,lettuce,44.0',
      '2397Q2,beans,21.1',
      '2397Q2,potato,60.8',
      '2397Q2,the tomato experiment,0.0',
    ),
    user,
  );

  vfs.writeText(
    `${DATA}/datasets/public/atmosphere/2397-drift.csv`,
    lines(
      'day,o2,co2,pressure,temp',
      '1,20.9,0.041,101.3,21.0',
      '90,20.9,0.042,101.3,21.1',
      '180,20.8,0.043,101.2,21.0',
      '270,20.8,0.044,101.2,21.1',
      '360,20.8,0.045,101.1,21.0',
    ),
    user,
  );

  vfs.writeText(
    `${DATA}/${RESTRICTED}/README`,
    lines(
      'Crew health series, 2387-2398. Four people.',
      '',
      'Restricted. This directory is the reason sandbox/sandbox.conf exists',
      'and the reason it says what it says.',
      '',
      'Four names and eleven years of somebody taking their own blood',
      'pressure on a Tuesday. It is not interesting and it was not anybody',
      'else\'s.',
      '',
    ),
    user,
  );

  vfs.writeText(
    `${HOME}/README`,
    lines(
      'Deposit office terminal. Signed in as dewitt.',
      '',
      `  ${DEPOSIT}/PELL           why you are allowed in here`,
      `  ${HOME}/KERR          what she will and will not accept`,
      `  ${REPO}   eleven years, four people`,
      `  ${FINDINGS}/      put what you find in here`,
      '',
      'Try:  cd /srv/deposit/nav7-research  &&  git log --oneline',
      '',
      'Type  objectives  for what you are trying to establish.',
      'Type  hint  when you are stuck. It escalates.',
      '',
    ),
    user,
  );
}

/** Make the repository and the home directory genuinely DeWitt's. */
export function ownEverything(vfs: Vfs, uid: number, gid: number): void {
  const chown = (path: string): void => {
    try {
      vfs.chown(path, uid, gid, ROOT_USER);
    } catch {
      // A path the seed did not create. Nothing to hand over.
    }
    let kind: string;
    try {
      kind = vfs.lstat(path, ROOT_USER).kind;
    } catch {
      return;
    }
    if (kind !== 'dir') return;
    for (const name of vfs.readdir(path, ROOT_USER)) {
      chown(`${path}/${name}`.replace(/\/+/g, '/'));
    }
  };
  chown(HOME);
  chown(REPO);
}
