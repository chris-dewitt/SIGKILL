import { ROOT_USER, type Vfs } from '@sigkill/machine';

/**
 * Ferryman's Rest, as the terminal in the claims office sees it.
 *
 * The same rule Deck C was written to: every file is a lead, a lesson, or a
 * person. What is different here is that half the world is rows rather than
 * files, and the two have to agree -- a name in a note and a name in a table
 * that disagree is not ambiguity, it is a bug.
 *
 * DeWitt has a terminal, an account, a debt for the tow, and no standing.
 */

export const CREW = { root: 0, dewitt: 1000, merrick: 1001, pell: 1002 } as const;

function file(vfs: Vfs, path: string, lines: string[], opts: { uid?: number; mode?: number } = {}): void {
  vfs.mkdirp(path.slice(0, path.lastIndexOf('/')), ROOT_USER);
  vfs.writeText(path, lines.join('\n'), ROOT_USER);
  if (opts.mode !== undefined) vfs.chmod(path, opts.mode, ROOT_USER);
  if (opts.uid !== undefined) vfs.chown(path, opts.uid, opts.uid, ROOT_USER);
}

export function seedTown(vfs: Vfs): void {
  for (const dir of ['/home/dewitt', '/home/dewitt/carried', '/srv/archive', '/var/log', '/tmp']) {
    vfs.mkdirp(dir, ROOT_USER);
  }
  vfs.chown('/home/dewitt', CREW.dewitt, CREW.dewitt, ROOT_USER);
  vfs.chown('/home/dewitt/carried', CREW.dewitt, CREW.dewitt, ROOT_USER);
  vfs.chmod('/tmp', 0o777, ROOT_USER);

  file(vfs, '/etc/passwd', [
    'root:x:0:0:root:/root:/bin/sh',
    `dewitt:x:${CREW.dewitt}:${CREW.dewitt}:claimant, unregistered:/home/dewitt:/bin/sh`,
    `merrick:x:${CREW.merrick}:${CREW.merrick}:S. Merrick, claims:/home/merrick:/bin/sh`,
    `pell:x:${CREW.pell}:${CREW.pell}:A. Pell, patron:/home/pell:/bin/sh`,
    '',
  ], { mode: 0o644 });

  file(vfs, '/etc/motd', [
    "FERRYMAN'S REST -- CENTRAL ARCHIVE, PUBLIC TERMINAL 4",
    '',
    'Records are public. Queries are logged and nobody reads the log.',
    'Terminal time is charged to the claimant. You are behind.',
    '',
  ], { mode: 0o644 });

  /*
   * The note the act opens on.
   *
   * Merrick is the opposite of an antagonist: she tells him exactly what the
   * system needs, in order, and cannot make it need less. She has done this
   * before and she is not enjoying it either.
   */
  file(vfs, '/home/dewitt/README', [
    'Mr DeWitt --',
    '',
    'I am sorry about the counter. Twenty people were behind you and I could',
    'not do it properly with an audience, so I have put you on terminal 4 and',
    'written this instead.',
    '',
    'Here is the situation, in the order the system sees it.',
    '',
    '1. NAV-7 came in under tow. That makes it salvage until somebody proves',
    '   otherwise. The claim is a row in our archive:',
    '',
    '       sqlite3 /srv/archive/claims.db .tables',
    '       sqlite3 /srv/archive/claims.db "SELECT * FROM claims;"',
    '',
    '2. The clause is salvage.22.b. A vessel recovered without surviving',
    '   certified crew reverts to the operator. Our count of survivors is',
    '   zero, and you are standing in front of me.',
    '',
    '3. So the count is wrong, or you are not certified. I cannot tell which',
    '   from here and neither can you until you look.',
    '',
    'The archive is public. Read it. If you have never used a database, the',
    'two commands above are the whole of getting started -- one asks what',
    'tables exist, the other asks a table for its rows.',
    '',
    'The schema is on disk as well, which is unusual and useful:',
    '',
    '       cat /srv/archive/schema.sql',
    '',
    'If you get stuck, type  hint. It costs nothing and I am not the one',
    'paying for this terminal.',
    '',
    '                                                    -- S. Merrick, claims',
    '',
  ], { uid: CREW.dewitt, mode: 0o644 });

  file(vfs, '/home/dewitt/tow-invoice.txt', [
    'SALVAGE TUG *ELLEN MAY* -- RECOVERY INVOICE',
    '',
    '  Recovery and tow, KV-1140 NAV-7 .............. 4,200',
    '  Consumables, one (1) soul aboard ................ 40',
    '  Kettle, replacement ............................. 12',
    '',
    '  TOTAL DUE ................................... 4,252',
    '',
    'Terms: on settlement of the salvage claim, or when you have it,',
    'whichever is later. I am not going to chase you and I would take it',
    'as a personal favour if you did not mention that to the yard.',
    '',
    'The kettle was my fault.',
    '',
    '                                                        -- ELLEN MAY',
    '',
  ], { uid: CREW.dewitt, mode: 0o644 });

  /*
   * What came with him.
   *
   * The transfer mechanism from `docs/GAME2_BEATS.md` section 3: Act I's
   * evidence arrives as the loose text files he left it as, and his first
   * real SQL task is that the archive does not take text files. A player who
   * did the optional threads in Act I has more here; one who did not has a
   * thinner folder and the game never mentions it.
   */
  file(vfs, '/home/dewitt/carried/bowen-heading.txt', [
    'Heading: 114 mark 9. There is a relay station out there or there is',
    '',
  ], { uid: CREW.dewitt, mode: 0o644 });

  file(vfs, '/home/dewitt/carried/luna-v43-link.txt', [
    'total 12',
    'drwxr-xr-x 1001 1001    3 bin',
    '-rw-r--r-- 1001 1001  152 NOTES',
    'drwxr-xr-x 1001 1001    4 memory',
    'lrwxrwxrwx 1001 1001   16 v43 -> /mnt/vault/v43',
    'drwxr-xr-x 1001 1001    2 v42',
    '',
  ], { uid: CREW.dewitt, mode: 0o644 });

  file(vfs, '/home/dewitt/carried/ferry-profile.txt', [
    '# NAV-7 OPERATING PROFILE  (copied off the ship before they bonded it)',
    '',
    'PROFILE=ferry',
    'CREW_ABOARD=0',
    'DECLARED_TRANSIT=unmanned',
    'DECLARED_BY=AUTOMATED',
    'DECLARED_AT=T+0000',
    '',
    'Nobody here has asked me what this is. I have shown it to two people.',
    '',
  ], { uid: CREW.dewitt, mode: 0o644 });

  file(vfs, '/home/dewitt/carried/README', [
    'Everything I took off NAV-7.',
    '',
    'It is four text files. It was a whole ship this time last week.',
    '',
  ], { uid: CREW.dewitt, mode: 0o644 });

  // ------------------------------------------------------------- the office

  file(vfs, '/srv/archive/README', [
    'CENTRAL ARCHIVE -- PUBLIC RECORDS',
    '',
    'claims.db     salvage, registration and certification records',
    'schema.sql    how claims.db is built. Readable on purpose.',
    'intake/       where evidence is filed. Rows, not files. See intake/README.',
    '',
    'The archive answers questions. It does not have opinions and it will not',
    'tell you which question to ask, because the last time it did that we were',
    'sued.',
    '',
  ], { mode: 0o644 });

  file(vfs, '/srv/archive/intake/README', [
    'EVIDENCE INTAKE',
    '',
    'Supporting evidence is accepted as rows in a database, not as documents.',
    'This is not obstruction: a document has to be read by a person and there',
    'are four of us, and a row can be checked against every other row we have.',
    '',
    'Build your own and put it here as evidence.db. The table we read is:',
    '',
    '    CREATE TABLE evidence (',
    '      id      INTEGER PRIMARY KEY,',
    '      subject TEXT NOT NULL,   -- who or what it is about',
    '      source  TEXT NOT NULL,   -- where you got it',
    '      detail  TEXT NOT NULL    -- what it says',
    '    );',
    '',
    'At least three rows, or it is not a submission, it is a remark.',
    '',
    'You make a database with sqlite3 and a filename. The file appears when',
    'the first statement lands. It is an ordinary file after that -- ls will',
    'show it to you, and you can cp it somewhere safe before you experiment.',
    '',
  ], { mode: 0o644 });

  vfs.mkdirp('/srv/archive/intake', ROOT_USER);
  vfs.chmod('/srv/archive/intake', 0o777, ROOT_USER);

  // -------------------------------------------------------------- the people

  file(vfs, '/home/merrick/desk-notes.txt', [
    'Things I have explained this week, in order of how much I hated it:',
    '',
    '  - that "no record of" and "did not happen" are different (x4)',
    '  - that I cannot edit the archive, only file against it (x6)',
    '  - that the clause is not mine and I did not vote for it (x2)',
    '  - where the toilets are (x11, and this is the one I do not mind)',
    '',
    'The Kepler-Vance adjuster comes Thursday. He is polite and he will have',
    'the clause printed out. He always does. He is not a bad man; he is a man',
    'with a printout.',
    '',
    'If the apprentice finds something, it has to be a row by then.',
    '',
  ], { uid: CREW.merrick, mode: 0o644 });

  file(vfs, '/home/pell/correspondence.txt', [
    'FROM THE DESK OF AUGUSTIN PELL',
    '',
    'To whom it concerns, and I am told that is now a young man on terminal 4:',
    '',
    'I funded NAV-7 for eleven years. I asked for very little in return. Four',
    'photographs a year. FEET. It is not complicated and it is not, as Dr Chen',
    'once put it in writing, "a symptom".',
    '',
    'It was a test of compliance. Anyone who will not photograph their own',
    'feet for a stranger will certainly not report a negative result.',
    '',
    'I am told the ship is being taken. I am told this is lawful. I have',
    'therefore instructed my office to be unhelpful in every lawful way, which',
    'is the only kind of help I have left.',
    '',
    'My grant account is RG-NAV7-03. You may look at it. Everyone else has.',
    '',
    '                                                             -- A. PELL',
    '',
  ], { uid: CREW.pell, mode: 0o644 });
}
