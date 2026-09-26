import { ROOT_USER } from '@sigkill/machine';
import type { Objective, World } from '@sigkill/quest';
import { CLAIMS_DB } from './act1/schema.js';

/**
 * The Archive: the ladders.
 *
 * Same rule as Act I and it matters more here, not less. Every `done` reads
 * world state -- the database file, the filesystem -- and never what was
 * typed. A SQL puzzle is more tempting to over-specify than a shell one,
 * because there is an obvious query and it is easy to check for it. Do not.
 * The player who gets there with a subquery instead of a join has understood
 * more, not less.
 *
 * Reading the database from a goal is the awkward part. Goals are
 * synchronous and SQL is not, so instead of querying, the goals here read
 * what the player *produced* -- a file they wrote, a row count they recorded,
 * an evidence database they built. That is a feature: it keeps the goal
 * checking the outcome rather than the method, which is the same discipline
 * Act I's goals have.
 */

export const EVIDENCE_DB = '/srv/archive/intake/evidence.db';
export const FINDINGS = '/home/dewitt/findings.txt';

/** Read as root, or empty. The player may delete anything. */
function text(world: World, path: string): string {
  try {
    return world.vfs.readText(path, ROOT_USER);
  } catch {
    return '';
  }
}

/**
 * Did the player write these facts down together, in one file of their own?
 *
 * Together is the important word, and it was not the first version. The first
 * version asked whether each pattern appeared *somewhere* under /home/dewitt,
 * and `read-the-claim` was therefore satisfied the moment the game booted:
 * the survivor count was "a zero", and `carried/ferry-profile.txt` says
 * `CREW_ABOARD=0`. The evidence he brought from Act I answered a question he
 * had not asked yet.
 *
 * The route harness caught it the day the content was written, which is what
 * it is for. Requiring one file is also the honest reading of the objective:
 * a finding is a thing you recorded, not two strings that happen to coexist
 * in your home directory.
 */
function wroteTogether(world: World, ...patterns: RegExp[]): boolean {
  const walk = (dir: string): boolean => {
    let names: string[];
    try {
      names = world.vfs.readdir(dir, ROOT_USER);
    } catch {
      return false;
    }
    for (const name of names) {
      const path = `${dir}/${name}`;
      try {
        const stat = world.vfs.lstat(path, ROOT_USER);
        if (stat.kind === 'dir') {
          if (walk(path)) return true;
          continue;
        }
        if (stat.kind !== 'file') continue;
        const body = world.vfs.readText(path, ROOT_USER);
        if (patterns.every((pattern) => pattern.test(body))) return true;
      } catch {
        // Unreadable or gone. Not a match.
      }
    }
    return false;
  };
  return walk('/home/dewitt');
}

/** Does the evidence database exist and look like a submission? */
function evidenceFiled(world: World): boolean {
  try {
    const bytes = world.vfs.read(EVIDENCE_DB, ROOT_USER);
    // A SQLite file announces itself. Anything else is somebody who wrote a
    // text file and named it .db, which the archive would also reject.
    const header = new TextDecoder().decode(bytes.subarray(0, 15));
    return header === 'SQLite format 3' && bytes.length > 0;
  } catch {
    return false;
  }
}

const CLAUSE = /salvage\.22\.b/i;
/**
 * A zero standing on its own as a field, not any zero anywhere.
 *
 * `\b0\b` was the first attempt and it matched `CREW_ABOARD=0` in the ferry
 * profile he carried off NAV-7, which satisfied the objective at boot.
 */
const SURVIVORS_ZERO = /(^|\|)\s*0\s*(\||$)/m;
const DEWITT_UNCERTIFIED = /dewitt/i;
const DRAFT = /4402|apprenticeship complete/i;
/**
 * The four of them, by name.
 *
 * The finding this objective is about is *who was aboard*, so that is what
 * the goal asks for. An earlier version wanted a certification number in the
 * same file, which two perfectly good routes did not produce -- counting them
 * and then naming them proves it just as well, and the harness said so.
 */
const CREW_NAMES = [/vasquez/i, /chen/i, /okonkwo/i, /bowen/i];
const GRANT_ACCOUNT = /RG-NAV7-03/i;

export const ARCHIVE_OBJECTIVES: readonly Objective[] = [
  {
    id: 'read-the-claim',
    title: 'Find out what the archive says about NAV-7',
    done: (w) => wroteTogether(w, CLAUSE, SURVIVORS_ZERO),
    teaches: ['sqlite3', 'cat', 'echo'],
    routes: [
      {
        name: 'select the row and keep it',
        commands: [
          `sqlite3 ${CLAIMS_DB} "SELECT clause, survivors FROM claims WHERE vessel_id = 1140;" > ${FINDINGS}`,
        ],
      },
      {
        name: 'everything about the claim',
        commands: [`sqlite3 ${CLAIMS_DB} "SELECT * FROM claims;" > /home/dewitt/claims.txt`],
      },
      {
        name: 'join it to the vessel, because a number is not a ship',
        commands: [
          `sqlite3 ${CLAIMS_DB} "SELECT v.callsign, c.clause, c.survivors FROM claims c ` +
            'JOIN vessels v ON v.id = c.vessel_id;" > /home/dewitt/notes',
        ],
      },
    ],
    nearMisses: [
      {
        name: 'read it and move on',
        commands: [`sqlite3 ${CLAIMS_DB} "SELECT * FROM claims;"`],
        because: 'it was on the screen and is now gone; nothing of yours holds it',
      },
      {
        name: 'the wrong vessel',
        commands: [
          `sqlite3 ${CLAIMS_DB} "SELECT clause, survivors FROM claims WHERE vessel_id = 1141;" > ${FINDINGS}`,
        ],
        because: 'that is the HALDANE, settled last year, and its clause is a different one',
      },
    ],
    onComplete: [
      '',
      '  claims.clause    = salvage.22.b',
      '  claims.survivors = 0',
      '',
      'MERRICK: There it is. That is the whole of it.',
      '',
      'MERRICK: Nobody wrote that to be cruel. Somebody wrote a rule for a',
      'MERRICK: hull that comes in with nobody on it, which is most of them,',
      'MERRICK: and the rule has been correct nine hundred times.',
      '',
      'MERRICK: You are the other kind. Now show me where it is wrong.',
      '',
    ],
    steps: [
      {
        id: 'find-it',
        label: 'get the claim out of the archive and into a file of your own',
        pending: (w) => !wroteTogether(w, CLAUSE, SURVIVORS_ZERO),
        rungs: [
          {
            tier: 'nudge',
            lines: [
              'The claim against your ship is a row in a table.',
              '',
              'Start by asking the database what tables it has:',
              '',
              `    sqlite3 ${CLAIMS_DB} .tables`,
              '',
              'Then ask the one that sounds like claims for its rows.',
            ],
          },
          {
            tier: 'direction',
            track: 'cadet',
            lines: [
              'A database is a file full of tables. A table is rows and',
              'columns, like a spreadsheet the machine can search properly.',
              '',
              'Two commands get you everything:',
              '',
              `    sqlite3 ${CLAIMS_DB} .tables       what tables exist`,
              `    sqlite3 ${CLAIMS_DB} "SELECT * FROM claims;"`,
              '',
              'SELECT * FROM claims means "every column, every row, from the',
              'table called claims".',
              '',
              'Then send it to a file with > so you still have it afterwards.',
            ],
          },
          {
            tier: 'direction',
            lines: [
              'You want the clause and the survivor count for NAV-7.',
              '',
              'NAV-7 is vessel 1140 -- the vessels table will tell you that,',
              'and WHERE lets you ask for one row instead of all of them.',
              '',
              'Keep the answer. Reading it off the screen is not evidence.',
            ],
          },
          {
            tier: 'command',
            command:
              `sqlite3 ${CLAIMS_DB} "SELECT clause, survivors FROM claims WHERE vessel_id = 1140;" > ${FINDINGS}`,
            lines: [
              'The claim, saved where you can point at it:',
              '',
              `    sqlite3 ${CLAIMS_DB} \\`,
              '      "SELECT clause, survivors FROM claims WHERE vessel_id = 1140;" \\',
              `      > ${FINDINGS}`,
              '',
              `Then read it back:  cat ${FINDINGS}`,
            ],
          },
        ],
      },
    ],
  },

  {
    id: 'find-the-crew',
    title: 'Prove four people were aboard',
    requires: ['read-the-claim'],
    done: (w) => wroteTogether(w, ...CREW_NAMES),
    teaches: ['sqlite3', 'grep', 'wc'],
    routes: [
      {
        name: 'join crew to certifications',
        commands: [
          `sqlite3 ${CLAIMS_DB} "SELECT c.name, x.number FROM crew c JOIN certifications x ` +
            'ON x.crew_id = c.id WHERE c.vessel_id = 1140;" > /home/dewitt/crew.txt',
        ],
      },
      {
        name: 'count them, then name them',
        commands: [
          `sqlite3 ${CLAIMS_DB} "SELECT count(*) FROM certifications x JOIN crew c ` +
            'ON c.id = x.crew_id WHERE c.vessel_id = 1140;" > /home/dewitt/count.txt',
          `sqlite3 ${CLAIMS_DB} "SELECT name FROM crew WHERE vessel_id = 1140;" >> /home/dewitt/count.txt`,
        ],
      },
      {
        name: 'a subquery instead of a join',
        commands: [
          `sqlite3 ${CLAIMS_DB} "SELECT name FROM crew WHERE vessel_id = 1140 AND id IN ` +
            '(SELECT crew_id FROM certifications);" > /home/dewitt/certified.txt',
          `sqlite3 ${CLAIMS_DB} "SELECT count(*) FROM certifications;" >> /home/dewitt/certified.txt`,
        ],
      },
    ],
    nearMisses: [
      {
        name: 'the crew of the other ship',
        commands: [
          `sqlite3 ${CLAIMS_DB} "SELECT name FROM crew WHERE vessel_id = 1141;" > /home/dewitt/crew.txt`,
        ],
        because: 'aldiss flies the HALDANE and has never been aboard NAV-7',
      },
      {
        name: 'certifications with nobody attached',
        commands: [
          `sqlite3 ${CLAIMS_DB} "SELECT number FROM certifications;" > /home/dewitt/certs.txt`,
        ],
        because: 'numbers without names prove a filing cabinet exists, not that anyone was aboard',
      },
    ],
    onComplete: [
      '',
      '  vasquez|KV-4471-E',
      '  chen|KV-2210-M',
      '  okonkwo|KV-9938-C',
      '  bowen|KV-1174-N',
      '',
      'MERRICK: Four. Certified, all four, and every one of them on your hull.',
      '',
      'MERRICK: So the archive knows they were there. It is not confused about',
      'MERRICK: the ship and it is not confused about them.',
      '',
      'MERRICK: Which means the thing it is confused about is you. Ask it the',
      'MERRICK: same question with your name in it.',
      '',
    ],
    steps: [
      {
        id: 'join-them',
        label: 'put the crew and their certifications together',
        pending: (w) => !wroteTogether(w, ...CREW_NAMES),
        rungs: [
          {
            tier: 'nudge',
            lines: [
              'Crew are in one table. Certifications are in another.',
              '',
              'Neither one on its own says "these four people were certified',
              'and aboard". Together they do.',
              '',
              `    sqlite3 ${CLAIMS_DB} ".schema crew"`,
              `    sqlite3 ${CLAIMS_DB} ".schema certifications"`,
              '',
              'Look at what column they have in common.',
            ],
          },
          {
            tier: 'direction',
            track: 'cadet',
            lines: [
              'Two tables are connected when one holds the other one\'s id.',
              '',
              'certifications has a crew_id. crew has an id. A JOIN is how you',
              'say "line these up where those two match":',
              '',
              '    SELECT c.name, x.number',
              '    FROM crew c',
              '    JOIN certifications x ON x.crew_id = c.id;',
              '',
              'The c and x are short names so you do not have to type the',
              'whole table name every time.',
            ],
          },
          {
            tier: 'direction',
            lines: [
              'JOIN crew to certifications on the id they share, and narrow it',
              'to vessel 1140.',
              '',
              'Save what comes back. You are building a case, not reading one.',
            ],
          },
          {
            tier: 'command',
            command:
              `sqlite3 ${CLAIMS_DB} "SELECT c.name, x.number FROM crew c JOIN certifications x ` +
              'ON x.crew_id = c.id WHERE c.vessel_id = 1140;" > /home/dewitt/crew.txt',
            lines: [
              'The four of them, with their numbers:',
              '',
              `    sqlite3 ${CLAIMS_DB} \\`,
              '      "SELECT c.name, x.number FROM crew c \\',
              '       JOIN certifications x ON x.crew_id = c.id \\',
              '       WHERE c.vessel_id = 1140;" > /home/dewitt/crew.txt',
            ],
          },
        ],
      },
    ],
  },

  {
    id: 'the-row-that-was-never-written',
    title: 'Find out what the archive has instead of you',
    requires: ['find-the-crew'],
    done: (w) => wroteTogether(w, DEWITT_UNCERTIFIED, DRAFT),
    teaches: ['sqlite3', 'grep'],
    routes: [
      {
        name: 'left join, then the draft',
        commands: [
          `sqlite3 ${CLAIMS_DB} "SELECT c.name, x.number FROM crew c LEFT JOIN certifications x ` +
            'ON x.crew_id = c.id WHERE c.vessel_id = 1140;" > /home/dewitt/gap.txt',
          `sqlite3 ${CLAIMS_DB} "SELECT * FROM filings WHERE subject = 'dewitt';" >> /home/dewitt/gap.txt`,
        ],
      },
      {
        name: 'ask directly who has no certificate',
        commands: [
          `sqlite3 ${CLAIMS_DB} "SELECT name FROM crew WHERE vessel_id = 1140 AND id NOT IN ` +
            '(SELECT crew_id FROM certifications);" > /home/dewitt/missing.txt',
          `sqlite3 ${CLAIMS_DB} "SELECT author, note FROM filings WHERE subject = 'dewitt';" ` +
            '>> /home/dewitt/missing.txt',
        ],
      },
      {
        name: 'the whole of both tables, and read it yourself',
        commands: [
          `sqlite3 ${CLAIMS_DB} "SELECT * FROM crew;" > /home/dewitt/all.txt`,
          `sqlite3 ${CLAIMS_DB} "SELECT * FROM filings;" >> /home/dewitt/all.txt`,
        ],
      },
    ],
    nearMisses: [
      {
        name: 'an inner join, which hides the hole',
        commands: [
          `sqlite3 ${CLAIMS_DB} "SELECT c.name, x.number FROM crew c JOIN certifications x ` +
            'ON x.crew_id = c.id;" > /home/dewitt/gap.txt',
        ],
        because: 'a plain JOIN drops the rows with no match, which is exactly the row you need',
      },
      {
        name: 'the gap without the reason',
        commands: [
          `sqlite3 ${CLAIMS_DB} "SELECT name FROM crew WHERE vessel_id = 1140 AND id NOT IN ` +
            '(SELECT crew_id FROM certifications);" > /home/dewitt/missing.txt',
        ],
        because: 'that you are missing is the claim against you; why is the answer to it',
      },
    ],
    onComplete: [
      '',
      '  vasquez|KV-4471-E',
      '  chen|KV-2210-M',
      '  okonkwo|KV-9938-C',
      '  bowen|KV-1174-N',
      '  dewitt|',
      '',
      '  4402|certification|dewitt|vasquez|draft|2398-05-28|',
      '  apprenticeship complete, filing at end of rotation -- RV',
      '',
      'MERRICK: Oh.',
      '',
      'MERRICK: I want to be careful how I say this, because I have said it',
      'MERRICK: badly before.',
      '',
      'MERRICK: That is not a deletion. Nobody took your certificate away.',
      'MERRICK: There has never been one. What there is, is somebody starting',
      'MERRICK: the form and meaning to finish it at the end of the rotation.',
      '',
      'MERRICK: The rotation ended on the sixth.',
      '',
      'MERRICK: A missing row and a missing person look identical from this',
      'MERRICK: side of the counter. That is the flaw in the whole building',
      'MERRICK: and I have been shouting about it for six years.',
      '',
    ],
    steps: [
      {
        id: 'find-the-hole',
        label: 'find the row that is not there, and what stands in for it',
        pending: (w) => !wroteTogether(w, DEWITT_UNCERTIFIED, DRAFT),
        rungs: [
          {
            tier: 'nudge',
            lines: [
              'Your join found four people. There were five of you.',
              '',
              'A join only shows you rows that matched. The interesting one',
              'here is the row that did not.',
            ],
          },
          {
            tier: 'direction',
            track: 'cadet',
            lines: [
              'JOIN keeps only the rows that pair up. LEFT JOIN keeps every row',
              'on the left, and leaves the right-hand columns empty when there',
              'is nothing to pair with:',
              '',
              '    SELECT c.name, x.number',
              '    FROM crew c',
              '    LEFT JOIN certifications x ON x.crew_id = c.id',
              '    WHERE c.vessel_id = 1140;',
              '',
              'An empty field there means "we have no row for this". It does',
              'not mean the person is not real.',
              '',
              'Then look in the filings table for your own name.',
            ],
          },
          {
            tier: 'direction',
            lines: [
              'Use LEFT JOIN so the unmatched row survives the query.',
              '',
              'Then ask filings what it has on the subject of dewitt. The',
              'archive keeps drafts for seven years and nobody has ever asked',
              'it for one.',
            ],
          },
          {
            tier: 'command',
            command:
              `sqlite3 ${CLAIMS_DB} "SELECT c.name, x.number FROM crew c LEFT JOIN certifications x ` +
              'ON x.crew_id = c.id WHERE c.vessel_id = 1140;" > /home/dewitt/gap.txt; ' +
              `sqlite3 ${CLAIMS_DB} "SELECT * FROM filings WHERE subject = 'dewitt';" >> /home/dewitt/gap.txt`,
            lines: [
              'Both halves, into one file:',
              '',
              `    sqlite3 ${CLAIMS_DB} \\`,
              '      "SELECT c.name, x.number FROM crew c \\',
              '       LEFT JOIN certifications x ON x.crew_id = c.id \\',
              '       WHERE c.vessel_id = 1140;" > /home/dewitt/gap.txt',
              '',
              `    sqlite3 ${CLAIMS_DB} \\`,
              '      "SELECT * FROM filings WHERE subject = \'dewitt\';" \\',
              '      >> /home/dewitt/gap.txt',
            ],
          },
        ],
      },
    ],
  },

  {
    id: 'file-the-evidence',
    title: 'Turn what you have into something the archive accepts',
    requires: ['the-row-that-was-never-written'],
    done: evidenceFiled,
    teaches: ['sqlite3', 'cat', 'ls'],
    routes: [
      {
        name: 'create and insert',
        commands: [
          `sqlite3 ${EVIDENCE_DB} "CREATE TABLE evidence (id INTEGER PRIMARY KEY, subject TEXT NOT NULL, ` +
            'source TEXT NOT NULL, detail TEXT NOT NULL);"',
          `sqlite3 ${EVIDENCE_DB} "INSERT INTO evidence (subject, source, detail) VALUES ` +
            "('dewitt','filings 4402','apprenticeship complete, filing at end of rotation')," +
            "('dewitt','crew 5','aboard KV-1140 as apprentice, engaged KV-9902')," +
            "('NAV-7','ferry profile','declared unmanned by AUTOMATED at T+0000');\"",
        ],
      },
      {
        name: 'a script the archive could run again',
        commands: [
          'echo "CREATE TABLE evidence (id INTEGER PRIMARY KEY, subject TEXT NOT NULL, ' +
            'source TEXT NOT NULL, detail TEXT NOT NULL);" > /home/dewitt/build.sql',
          "echo \"INSERT INTO evidence (subject,source,detail) VALUES ('dewitt','filings','draft 4402');\" " +
            '>> /home/dewitt/build.sql',
          "echo \"INSERT INTO evidence (subject,source,detail) VALUES ('dewitt','crew','apprentice aboard');\" " +
            '>> /home/dewitt/build.sql',
          "echo \"INSERT INTO evidence (subject,source,detail) VALUES ('NAV-7','carried','ferry profile');\" " +
            '>> /home/dewitt/build.sql',
          `cat /home/dewitt/build.sql | sqlite3 ${EVIDENCE_DB}`,
        ],
      },
      {
        name: 'build it somewhere else and move it in',
        commands: [
          'sqlite3 /home/dewitt/mine.db "CREATE TABLE evidence (id INTEGER PRIMARY KEY, subject TEXT NOT NULL, ' +
            'source TEXT NOT NULL, detail TEXT NOT NULL);"',
          'sqlite3 /home/dewitt/mine.db "INSERT INTO evidence (subject,source,detail) VALUES ' +
            "('dewitt','filings 4402','draft certification, author vasquez')," +
            "('dewitt','crew 5','apprentice aboard KV-1140')," +
            "('NAV-7','transits 9903','2.2 GB outbound billed to the grant');\"",
          `cp /home/dewitt/mine.db ${EVIDENCE_DB}`,
        ],
      },
    ],
    nearMisses: [
      {
        name: 'file the text files',
        commands: [`cp /home/dewitt/carried/bowen-heading.txt ${EVIDENCE_DB}`],
        because: 'a text file named .db is still a text file; intake reads rows',
      },
      {
        name: 'write it up as prose',
        commands: [
          `echo "I was aboard. Vasquez started my paperwork." > ${EVIDENCE_DB}`,
        ],
        because: 'true, and not a submission; four people cannot read prose from nine hundred claimants',
      },
    ],
    onComplete: [
      '',
      '  intake: evidence.db accepted',
      '  intake: 3 rows, subjects: NAV-7, dewitt',
      '',
      'MERRICK: Good. That is a submission.',
      '',
      'MERRICK: You will notice the archive did not care what you wrote it',
      'MERRICK: with, only that it came in as rows. That is the whole of what',
      'MERRICK: this place is: nine hundred claims a year and four of us, so',
      'MERRICK: the only things we can check are things that can be checked.',
      '',
      'MERRICK: It is not a good system. It is a system that scales, which is',
      'MERRICK: what people build instead.',
      '',
      'MERRICK: Now. You have a draft, a hull and four dead friends. That is',
      'MERRICK: enough to argue with. Before Thursday, ask the archive one',
      'MERRICK: more thing -- who paid for the lane the morning it happened.',
      '',
    ],
    steps: [
      {
        id: 'build-it',
        label: 'build an evidence database and put it in intake',
        pending: (w) => !evidenceFiled(w),
        rungs: [
          {
            tier: 'nudge',
            lines: [
              'The archive takes rows, not documents.',
              '',
              '    cat /srv/archive/intake/README',
              '',
              'It tells you the exact table it reads. You have to make one.',
            ],
          },
          {
            tier: 'direction',
            track: 'cadet',
            lines: [
              'You make a database by naming one. The file appears when the',
              'first statement lands:',
              '',
              '    sqlite3 mine.db "CREATE TABLE evidence (',
              '      id INTEGER PRIMARY KEY,',
              '      subject TEXT NOT NULL,',
              '      source TEXT NOT NULL,',
              '      detail TEXT NOT NULL);"',
              '',
              'Then put rows in it with INSERT:',
              '',
              "    INSERT INTO evidence (subject, source, detail)",
              "    VALUES ('dewitt', 'filings 4402', 'draft certification');",
              '',
              'Three rows at least. Then put it where intake can see it.',
            ],
          },
          {
            tier: 'direction',
            lines: [
              'CREATE TABLE with the columns intake named, INSERT at least',
              'three rows, and leave it at the path the README gives.',
              '',
              'What you put in the rows is yours. You have the draft, the crew',
              'row, and whatever you carried off the ship.',
            ],
          },
          {
            tier: 'command',
            command:
              `sqlite3 ${EVIDENCE_DB} "CREATE TABLE evidence (id INTEGER PRIMARY KEY, subject TEXT NOT NULL, ` +
              'source TEXT NOT NULL, detail TEXT NOT NULL); INSERT INTO evidence (subject,source,detail) VALUES ' +
              "('dewitt','filings 4402','draft certification, author vasquez')," +
              "('dewitt','crew 5','apprentice aboard KV-1140')," +
              "('NAV-7','carried','declared unmanned by AUTOMATED');\"",
            lines: [
              'The table and three rows, in one go:',
              '',
              `    sqlite3 ${EVIDENCE_DB} "CREATE TABLE evidence (`,
              '      id INTEGER PRIMARY KEY, subject TEXT NOT NULL,',
              '      source TEXT NOT NULL, detail TEXT NOT NULL);',
              '      INSERT INTO evidence (subject,source,detail) VALUES',
              "      ('dewitt','filings 4402','draft certification, author vasquez'),",
              "      ('dewitt','crew 5','apprentice aboard KV-1140'),",
              "      ('NAV-7','carried','declared unmanned by AUTOMATED');\"",
              '',
              `Then check it:  ls -l ${EVIDENCE_DB}`,
            ],
          },
        ],
      },
    ],
  },

  {
    id: 'the-line-item',
    title: 'Find out who paid for the lane that morning',
    requires: ['file-the-evidence'],
    done: (w) => wroteTogether(w, GRANT_ACCOUNT, /2211404096/),
    teaches: ['sqlite3', 'sort', 'grep'],
    routes: [
      {
        name: 'order by size and take the top',
        commands: [
          `sqlite3 ${CLAIMS_DB} "SELECT at, bytes, account, bound_for FROM transits ` +
            'ORDER BY bytes DESC LIMIT 1;" > /home/dewitt/transit.txt',
        ],
      },
      {
        name: 'everything on the lane that day, and read it',
        commands: [
          `sqlite3 ${CLAIMS_DB} "SELECT * FROM transits WHERE at LIKE '2398-06-06%';" ` +
            '> /home/dewitt/that-morning.txt',
        ],
      },
      {
        name: 'join it to the account so it has a name',
        commands: [
          `sqlite3 ${CLAIMS_DB} "SELECT t.at, t.bytes, a.holder, t.account, t.bound_for FROM transits t ` +
            'JOIN accounts a ON a.code = t.account WHERE t.bytes > 1000000;" > /home/dewitt/who.txt',
        ],
      },
    ],
    nearMisses: [
      {
        name: 'the ordinary traffic',
        commands: [
          `sqlite3 ${CLAIMS_DB} "SELECT * FROM transits WHERE account = 'KV-OPS-11';" ` +
            '> /home/dewitt/transit.txt',
        ],
        because: 'lane relay chatter, a few kilobytes at a time, and none of it that morning',
      },
      {
        name: 'the size without the account',
        commands: [
          `sqlite3 ${CLAIMS_DB} "SELECT bytes FROM transits ORDER BY bytes DESC LIMIT 1;" ` +
            '> /home/dewitt/transit.txt',
        ],
        because: 'a number nobody owns; the account is the part that means something',
      },
    ],
    onComplete: [
      '',
      '  2398-06-06 04:12 | 2211404096 | RG-NAV7-03 | commercial region 7',
      '',
      'MERRICK: Two point two gigabytes. Outbound. Oh four twelve.',
      '',
      'MERRICK: That is not a message. That is a thing moving house.',
      '',
      'MERRICK: And it is billed to RG-NAV7-03, which is --',
      '',
      'MERRICK: Sorry. That is your research grant. That is the old man with',
      'MERRICK: the photographs.',
      '',
      'MERRICK: Whatever went down that lane, it went at four in the morning,',
      'MERRICK: it went to a commercial region, and it paid with your dead',
      'MERRICK: friends\' funding.',
      '',
      'MERRICK: I do not know what that was. I want to be plain that I do not',
      'MERRICK: know. But it was not weather and it was not a fault, and the',
      'MERRICK: clause on your ship says nobody survived.',
      '',
    ],
    steps: [
      {
        id: 'find-it',
        label: 'find the transit that does not look like the others',
        pending: (w) => !wroteTogether(w, GRANT_ACCOUNT, /2211404096/),
        rungs: [
          {
            tier: 'nudge',
            lines: [
              'Bandwidth is billed. Everything that leaves this system leaves',
              'a row with an account on it.',
              '',
              `    sqlite3 ${CLAIMS_DB} ".schema transits"`,
              '',
              'The morning was the sixth of June. Something left.',
            ],
          },
          {
            tier: 'direction',
            track: 'cadet',
            lines: [
              'ORDER BY sorts the rows. DESC puts the biggest first. LIMIT 1',
              'takes only the top one:',
              '',
              '    SELECT at, bytes, account FROM transits',
              '    ORDER BY bytes DESC LIMIT 1;',
              '',
              'That gives you the largest transfer the lane has ever carried,',
              'which is one way to find the one that does not belong.',
            ],
          },
          {
            tier: 'direction',
            lines: [
              'Sort the transits by size, or filter them to that date. Either',
              'finds it -- one of these rows is six orders of magnitude bigger',
              'than the rest.',
              '',
              'Keep the account code. That is the part that has a person on',
              'the end of it.',
            ],
          },
          {
            tier: 'command',
            command:
              `sqlite3 ${CLAIMS_DB} "SELECT at, bytes, account, bound_for FROM transits ` +
              'ORDER BY bytes DESC LIMIT 1;" > /home/dewitt/transit.txt',
            lines: [
              'The biggest thing that ever went down that lane:',
              '',
              `    sqlite3 ${CLAIMS_DB} \\`,
              '      "SELECT at, bytes, account, bound_for FROM transits \\',
              '       ORDER BY bytes DESC LIMIT 1;" > /home/dewitt/transit.txt',
              '',
              'Then ask accounts who RG-NAV7-03 belongs to.',
            ],
          },
        ],
      },
    ],
  },
];
