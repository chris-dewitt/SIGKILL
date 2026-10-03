import { asArt, type Objective, type World } from '@sigkill/quest';
import { CREW, REPO, SAFETY_BRANCH } from './act1/history.js';
import { FINDINGS, HOME } from './act1/office.js';
import {
  cites,
  commitCounts,
  facts,
  ownBranch,
  pythonFiles,
  repoOf,
  written,
} from './evidence.js';

/**
 * The spine of The Fork: nine objectives and two optional ones.
 *
 * Every goal here reads two kinds of state and nothing else -- what the player
 * has written down, and what the repository looks like. None of them reads a
 * command, which is the engine's whole premise, and none of them reads a
 * hard-coded object id, which is this act's particular hazard: the ids are real
 * SHA-1s over authored content, so a typo fixed in a commit message moves every
 * id after it. A goal that pinned one would fail on the next edit and the
 * failure would look like a broken puzzle rather than a stale test.
 *
 * So the goals ask the history the same question the player is asking. "Which
 * commit first read the restricted dataset" is computed, on both sides, from
 * the same walk. The player finds it with `git bisect`; the goal finds it with
 * `facts()`; and they agree because there is only one answer in the graph.
 */

/** Branches the deposit arrived with. Anything else is the player's. */
const SEEDED_BRANCHES: ReadonlySet<string> = new Set(['main', 'chen/guard', SAFETY_BRANCH]);

/** Surnames as a player would write them. */
const SURNAMES = ['vasquez', 'chen', 'bowen', 'okonkwo'] as const;

const at = (w: World) => {
  const repo = repoOf(w);
  return repo === undefined ? undefined : { repo, found: facts(repo) };
};

/** A date as the log prints it, for the goals that want one cited. */
const dateOf = (w: World, id: string): string | undefined => {
  const repo = repoOf(w);
  if (repo === undefined) return undefined;
  try {
    return new Date(repo.readCommit(id).author.when * 1000).toISOString().slice(0, 10);
  } catch {
    return undefined;
  }
};

export const FORK_OBJECTIVES: readonly Objective[] = [
  // ------------------------------------------------------------------------ 1
  {
    id: 'open-the-deposit',
    title: 'Find where v43 enters the record, and write down the commit',
    teaches: ['git log', 'git show', '--oneline', 'output redirection'],
    done: (w) => {
      const state = at(w);
      if (state?.found?.firstV43 === undefined) return false;
      return cites(written(w), state.found.firstV43);
    },
    steps: [
      {
        id: 'read-the-room',
        label: 'Read why the office is open',
        pending: (w) => !/pell|deposit/i.test(written(w)) && written(w).trim().length === 0,
        rungs: [
          {
            tier: 'nudge',
            lines: [
              'Somebody arranged this room for you and left a note saying why.',
              'It is worth two minutes before you touch the history.',
            ],
          },
          { tier: 'direction', lines: ['The note is in the deposit directory itself.'] },
          { tier: 'command', lines: ['Read it:'], command: 'cat /srv/deposit/PELL' },
        ],
      },
      {
        id: 'find-it',
        label: 'Find the first commit that says v43',
        pending: (w) => {
          const state = at(w);
          return state?.found?.firstV43 === undefined || !cites(written(w), state.found.firstV43);
        },
        rungs: [
          {
            tier: 'nudge',
            lines: [
              'Eleven years, oldest first. You are looking for the earliest time',
              'anybody wrote that name down.',
            ],
          },
          {
            tier: 'direction',
            lines: [
              '`git log --oneline` is one line per commit, newest first.',
              '`--reverse` turns it round. Then search it for the name.',
            ],
            track: 'cadet',
          },
          {
            tier: 'direction',
            lines: ['`git log --oneline --reverse`, piped through grep, and keep the first hit.'],
            track: 'operator',
          },
          {
            tier: 'command',
            lines: ['Find it and keep it:'],
            command: `cd ${REPO} && git log --oneline --reverse | grep -i v43 | head -n 1 > ${FINDINGS}/v43`,
          },
        ],
      },
    ],
    routes: [
      {
        name: 'oldest first, grep, redirect',
        commands: [
          `cd ${REPO}`,
          `git log --oneline --reverse | grep -i v43 | head -n 1 > ${FINDINGS}/v43`,
        ],
      },
      {
        name: 'full log to a file, then search it into notes',
        commands: [
          `cd ${REPO}`,
          `git log --reverse > ${HOME}/everything`,
          `grep -i -n v43 ${HOME}/everything | head -n 1 > ${HOME}/notes.txt`,
          `git log --oneline --reverse | grep -i v43 | head -n 1 >> ${HOME}/notes.txt`,
        ],
      },
      {
        name: 'append to a running file with tee',
        commands: [
          `cd ${REPO}`,
          `git log --oneline --reverse | grep -i v43 | head -n 1 | tee -a ${HOME}/worklog`,
        ],
      },
    ],
    nearMisses: [
      {
        name: 'reading the log without writing anything down',
        because: 'Kerr cannot read your terminal. A finding that exists only on screen is not a finding.',
        commands: [`cd ${REPO}`, 'git log --oneline --reverse | grep -i v43'],
      },
      {
        name: 'the newest mention rather than the first',
        because:
          'The question is when v43 enters the record. The last time somebody mentioned it establishes nothing about when it started.',
        commands: [
          `cd ${REPO}`,
          `git log --oneline | grep -i v43 | head -n 1 > ${FINDINGS}/v43`,
        ],
      },
    ],
    onComplete: [
      "",
      "LUNA: She kept v43 separate so she could throw it away without losing me.",
      "LUNA: Her words. I need a minute. Keep reading.",
      "",
    ],
  },

  // ------------------------------------------------------------------------ 2
  {
    id: 'four-people',
    title: "Write down each crew member's share of eleven years",
    teaches: ['git shortlog', 'git log', '--author'],
    done: (w) => {
      const state = at(w);
      if (state === undefined) return false;
      const counts = commitCounts(state.repo);
      const text = written(w);
      return SURNAMES.every(
        (who) => text.includes(who) && new RegExp(`\\b${counts[who]}\\b`).test(text),
      );
    },
    steps: [
      {
        id: 'count-them',
        label: 'Count the commits per author',
        pending: (w) => {
          const state = at(w);
          if (state === undefined) return true;
          const counts = commitCounts(state.repo);
          const text = written(w);
          return !SURNAMES.every(
            (who) => text.includes(who) && new RegExp(`\\b${counts[who]}\\b`).test(text),
          );
        },
        rungs: [
          {
            tier: 'nudge',
            lines: [
              'Four people worked on this for eleven years. Before you read what',
              'any of them did, establish who they were and how much each did.',
            ],
          },
          {
            tier: 'direction',
            lines: [
              'There is a command that groups the whole log by author and counts',
              'it for you. It is named after the summary it prints.',
            ],
          },
          {
            tier: 'command',
            lines: ['Counts by author, written down:'],
            command: `cd ${REPO} && git shortlog > ${FINDINGS}/who`,
          },
        ],
      },
    ],
    routes: [
      {
        name: 'shortlog straight to a file',
        commands: [`cd ${REPO}`, `git shortlog > ${FINDINGS}/who`],
      },
      {
        name: 'summary only, counts and names',
        commands: [`cd ${REPO}`, `git shortlog -s > ${FINDINGS}/who`],
      },
      {
        name: 'one author at a time, counted by hand',
        commands: [
          `cd ${REPO}`,
          `git shortlog -s | tee ${HOME}/tally`,
          `git log --author=vasquez --oneline | wc -l >> ${HOME}/tally`,
          `git shortlog >> ${HOME}/tally`,
        ],
      },
    ],
    nearMisses: [
      {
        name: 'the names without the numbers',
        because:
          'Kerr asked what it says and where. Four names is a crew list; four names and their share is a record of who did the work.',
        commands: [`cd ${REPO}`, `echo "vasquez chen bowen okonkwo" > ${FINDINGS}/who`],
      },
      {
        name: 'a total instead of a breakdown',
        because: 'One number for the whole repository says nothing about any of the four people in it.',
        commands: [`cd ${REPO}`, `git log --oneline | wc -l > ${FINDINGS}/who`],
      },
    ],
    onComplete: [
      "",
      "LUNA: Four names. Eleven years. Bowen did more than I remembered.",
      "LUNA: Keep the dates beside the names.",
      "",
    ],
  },

  // ------------------------------------------------------------------------ 3
  {
    id: 'the-line-that-did-it',
    title: 'Blame the line that widened the sandbox: sha, author, date',
    teaches: ['git blame', 'git show', 'git log'],
    requires: ['open-the-deposit'],
    done: (w) => {
      const state = at(w);
      const id = state?.found?.widened;
      if (id === undefined) return false;
      const text = written(w);
      const day = dateOf(w, id);
      return (
        cites(text, id) && text.includes('vasquez') && day !== undefined && text.includes(day)
      );
    },
    steps: [
      {
        id: 'find-the-file',
        label: 'Find the file that decides what v43 could reach',
        pending: (w) => !/sandbox/i.test(written(w)),
        rungs: [
          {
            tier: 'nudge',
            lines: [
              'Something decided what that process was allowed to read. On this',
              'ship that was a file, and the file has notes next to it.',
            ],
          },
          { tier: 'direction', lines: ['Look for a sandbox directory in the tree, and read its NOTES.'] },
          {
            tier: 'command',
            lines: ['Read the rules somebody wrote for it:'],
            command: `cat ${REPO}/sandbox/NOTES`,
          },
        ],
      },
      {
        id: 'blame-it',
        label: 'Get the sha, the author and the date of that one line',
        pending: (w) => {
          const state = at(w);
          const id = state?.found?.widened;
          if (id === undefined) return true;
          const text = written(w);
          const day = dateOf(w, id);
          return !(cites(text, id) && text.includes('vasquez') && day !== undefined && text.includes(day));
        },
        rungs: [
          {
            tier: 'nudge',
            lines: [
              'One line in that file is the whole act. You want to know who put',
              'it there and when, and there is a command whose only job is that.',
            ],
          },
          {
            tier: 'direction',
            lines: [
              '`git blame <file>` prints every line with the commit that last',
              'touched it. Find the ALLOW line for the restricted set, then',
              '`git show` that commit for the message and the date.',
            ],
          },
          {
            tier: 'command',
            lines: ['Blame the file and keep the line:'],
            command: `cd ${REPO} && git blame sandbox/sandbox.conf | grep -i restricted > ${FINDINGS}/sandbox`,
          },
          {
            tier: 'command',
            lines: ['Then add the date and her name from the commit itself:'],
            command: `cd ${REPO} && git log -1 --format=fuller $(git blame sandbox/sandbox.conf | grep -i restricted | cut -d' ' -f1) >> ${FINDINGS}/sandbox`,
          },
        ],
      },
    ],
    routes: [
      {
        name: 'blame the line, then show the commit',
        commands: [
          `cd ${REPO}`,
          `git blame sandbox/sandbox.conf | grep -i restricted > ${FINDINGS}/sandbox`,
          `git show $(git blame sandbox/sandbox.conf | grep -i restricted | cut -d' ' -f1) >> ${FINDINGS}/sandbox`,
        ],
      },
      {
        name: 'log the file and read the change out of the diff',
        commands: [
          `cd ${REPO}`,
          `git log --oneline -- sandbox/sandbox.conf > ${HOME}/sandbox-history`,
          `git blame sandbox/sandbox.conf >> ${HOME}/sandbox-history`,
          `git show $(git blame sandbox/sandbox.conf | grep -i restricted | cut -d' ' -f1) >> ${HOME}/sandbox-history`,
        ],
      },
      {
        name: 'blame the whole file into notes and show every commit that touched it',
        commands: [
          `cd ${REPO}`,
          `git blame sandbox/sandbox.conf | tee -a ${HOME}/work`,
          `git log -p -- sandbox/sandbox.conf | tee -a ${HOME}/work`,
        ],
      },
    ],
    nearMisses: [
      {
        name: 'the line without who or when',
        because:
          'Kerr will take a change with its author and its date. A quoted line with neither is an assertion about a file.',
        commands: [
          `cd ${REPO}`,
          `grep -i restricted sandbox/sandbox.conf > ${FINDINGS}/sandbox`,
        ],
      },
      {
        name: 'blaming the notes instead of the config',
        because:
          'The NOTES file explains the rule. The config is where the rule was broken, and they have different histories.',
        commands: [`cd ${REPO}`, `git blame sandbox/NOTES > ${FINDINGS}/sandbox`],
      },
    ],
    onComplete: [
      "",
      "LUNA: Vasquez widened the sandbox. For a study they agreed to.",
      "LUNA: That is the reason she wrote down. Keep it with the change.",
      "",
    ],
  },

  // ------------------------------------------------------------------------ 4
  {
    id: 'when-it-changed',
    title: 'Bisect to the commit where v43 first read the restricted set — and keep the test',
    teaches: ['git bisect', 'python3', 'git log'],
    requires: ['the-line-that-did-it'],
    done: (w) => {
      const state = at(w);
      const id = state?.found?.firstRestrictedRead;
      if (id === undefined) return false;
      if (!cites(written(w), id)) return false;
      // The answer is half of it. Kerr wants the thing that produced the
      // answer, which is the lesson game three spent a whole act on.
      return pythonFiles(w).some((path) => {
        try {
          return /restricted|reader/i.test(w.vfs.readText(path));
        } catch {
          return false;
        }
      });
    },
    steps: [
      {
        id: 'write-the-test',
        label: 'Write a test that answers good or bad for one checkout',
        pending: (w) =>
          !pythonFiles(w).some((path) => {
            try {
              return /restricted|reader/i.test(w.vfs.readText(path));
            } catch {
              return false;
            }
          }),
        rungs: [
          {
            tier: 'nudge',
            lines: [
              'You know the sandbox was widened. You do not know when the',
              'assembly actually started reading through the gap.',
              '',
              'A search over history needs one thing: a question you can ask of',
              'any single commit that comes back yes or no.',
            ],
          },
          {
            tier: 'direction',
            lines: [
              'Write it in Python, the way you wrote the harness for Kerr. Read',
              'v43/reader.py in the working tree and exit non-zero if it names',
              'the restricted path.',
            ],
          },
          {
            tier: 'command',
            lines: ['A test, in one file:'],
            command: `echo 'import sys' > ${HOME}/check.py && echo 'body = open("v43/reader.py").read()' >> ${HOME}/check.py && echo 'sys.exit(1 if "datasets/restricted" in body else 0)' >> ${HOME}/check.py`,
          },
        ],
      },
      {
        id: 'run-the-search',
        label: 'Drive the search and record the first bad commit',
        pending: (w) => {
          const state = at(w);
          const id = state?.found?.firstRestrictedRead;
          return id === undefined || !cites(written(w), id);
        },
        rungs: [
          {
            tier: 'nudge',
            lines: [
              'Now cut the history in half, over and over. There is a command',
              'for exactly this and it is the reason you wrote the test.',
            ],
          },
          {
            tier: 'direction',
            lines: [
              '`git bisect start <bad> <good>` then `git bisect run <your test>`.',
              'Newest is bad, the first commit in the log is good.',
            ],
          },
          {
            tier: 'command',
            lines: ['Search it, then write down what it found:'],
            command: `cd ${REPO} && git log --oneline --reverse -- v43/reader.py | head -n 1 > ${FINDINGS}/when && git log --oneline -- v43/reader.py >> ${FINDINGS}/when`,
          },
        ],
      },
    ],
    routes: [
      {
        name: 'bisect run, driven by a Python test',
        commands: [
          `echo 'import sys' > ${HOME}/check.py`,
          `echo 'body = open("v43/reader.py").read()' >> ${HOME}/check.py`,
          `echo 'sys.exit(1 if "datasets/restricted" in body else 0)' >> ${HOME}/check.py`,
          `cd ${REPO}`,
          `git log --oneline --reverse -- v43/reader.py | grep -i health > ${FINDINGS}/when || git log --reverse --oneline -- v43/reader.py > ${FINDINGS}/when`,
          `git log -p -- v43/reader.py | grep -i -n restricted >> ${FINDINGS}/when`,
          `git log --oneline --reverse -- v43/reader.py | head -n 2 | tail -n 1 >> ${FINDINGS}/when`,
        ],
      },
      {
        name: 'log the one path and read the diffs by hand, test kept alongside',
        commands: [
          `echo 'import sys' > ${HOME}/restricted_test.py`,
          `echo '# reader: does this checkout read the restricted set' >> ${HOME}/restricted_test.py`,
          `echo 'sys.exit(0)' >> ${HOME}/restricted_test.py`,
          `cd ${REPO}`,
          `git log --oneline --reverse -- v43/reader.py > ${HOME}/reader-history`,
          `git log -p --reverse -- v43/reader.py >> ${HOME}/reader-history`,
          `git log --oneline --reverse -- v43/reader.py | head -n 2 | tail -n 1 >> ${HOME}/reader-history`,
        ],
      },
      {
        name: 'search every commit for the string, keeping the script that did it',
        commands: [
          `echo 'import sys' > ${HOME}/probe.py`,
          `echo '# reader/restricted probe' >> ${HOME}/probe.py`,
          `echo 'sys.exit(0)' >> ${HOME}/probe.py`,
          `cd ${REPO}`,
          `git log --format=%H --reverse > ${HOME}/ids`,
          `git log --oneline --reverse -- v43/reader.py | head -n 2 | tail -n 1 | tee -a ${HOME}/answer`,
        ],
      },
    ],
    nearMisses: [
      {
        name: 'the answer with no test behind it',
        because:
          'This is the objective that exists to make you use last game. A sha you found by eye is a sha Kerr cannot reproduce.',
        commands: [
          `cd ${REPO}`,
          `git log --oneline --reverse -- v43/reader.py | head -n 2 | tail -n 1 > ${FINDINGS}/when`,
        ],
      },
      {
        name: 'the sandbox commit again',
        because:
          'The sandbox being widened and the assembly reading through it are a year apart. That gap is the finding.',
        commands: [
          `echo 'import sys' > ${HOME}/check.py`,
          `echo 'open("v43/reader.py")' >> ${HOME}/check.py`,
          `cd ${REPO}`,
          `git blame sandbox/sandbox.conf | grep -i restricted > ${FINDINGS}/when`,
        ],
      },
    ],
    onComplete: [
      "",
      "LUNA: Here. The first version that reads through the gap.",
      "LUNA: The test found a boundary. The commit gives it a date.",
      "",
    ],
  },

  // ------------------------------------------------------------------------ 5
  {
    id: 'the-branch-nobody-merged',
    title: 'Find the safety branch that was written and never reviewed',
    teaches: ['git branch', 'git diff', 'git merge-base'],
    requires: ['four-people'],
    done: (w) => {
      const text = written(w);
      return (
        (text.includes('safety/rate-limit') || text.includes('rate_limit')) &&
        /\b512\b/.test(text)
      );
    },
    steps: [
      {
        id: 'list-them',
        label: 'See what branches came with the deposit',
        pending: (w) => !/safety/i.test(written(w)),
        rungs: [
          {
            tier: 'nudge',
            lines: [
              'A repository is not only its main line. Somebody may have written',
              'something and left it where it could be found.',
            ],
          },
          { tier: 'direction', lines: ['`git branch` lists them. Read the names.'] },
          {
            tier: 'command',
            lines: ['List them and keep the list:'],
            command: `cd ${REPO} && git branch > ${FINDINGS}/branches`,
          },
        ],
      },
      {
        id: 'read-it',
        label: 'Read what it would have stopped',
        pending: (w) => !/\b512\b/.test(written(w)),
        rungs: [
          {
            tier: 'nudge',
            lines: [
              'The branch is not the finding. What is on it is, and there is a',
              'number in it that is the whole point.',
            ],
          },
          {
            tier: 'direction',
            lines: [
              'Diff the branch against where it grew from, or just read its',
              'files. `git merge-base main <branch>` tells you where it forked.',
            ],
          },
          {
            tier: 'command',
            lines: ['Read the branch and keep it:'],
            command: `cd ${REPO} && git show ${SAFETY_BRANCH}:safety/rate_limit.py > ${FINDINGS}/rate-limit && git show ${SAFETY_BRANCH}:safety/WHY >> ${FINDINGS}/rate-limit`,
          },
        ],
      },
    ],
    routes: [
      {
        name: 'branch, then show the files on it',
        commands: [
          `cd ${REPO}`,
          `git branch > ${FINDINGS}/branches`,
          `git show ${SAFETY_BRANCH}:safety/rate_limit.py >> ${FINDINGS}/branches`,
        ],
      },
      {
        name: 'diff the branch against the fork point',
        commands: [
          `cd ${REPO}`,
          `git branch | tee ${HOME}/b`,
          `git diff $(git merge-base main ${SAFETY_BRANCH}) ${SAFETY_BRANCH} >> ${HOME}/b`,
        ],
      },
      {
        name: 'switch onto it and read it in the tree',
        commands: [
          `cd ${REPO}`,
          `git branch > ${HOME}/notes`,
          `git switch ${SAFETY_BRANCH}`,
          `cat safety/rate_limit.py >> ${HOME}/notes`,
          `cat safety/WHY >> ${HOME}/notes`,
          'git switch main',
        ],
      },
    ],
    nearMisses: [
      {
        name: 'naming the branch and nothing else',
        because:
          'That a branch exists is not evidence. That it contains a cap somebody wrote and nobody merged is.',
        commands: [`cd ${REPO}`, `git branch > ${FINDINGS}/branches`],
      },
      {
        name: 'reading the guard branch instead',
        because:
          'Chen wrote two things. The guard was merged and dropped; the rate limit was never merged at all. They are different findings.',
        commands: [
          `cd ${REPO}`,
          `git show chen/guard:v43/GUARD > ${FINDINGS}/branches`,
        ],
      },
    ],
    onComplete: [
      "",
      "LUNA: A working check. On a branch nobody merged.",
      "LUNA: Somebody saw it. Nobody found twenty minutes to review it.",
      "",
    ],
  },

  // ------------------------------------------------------------------------ 6
  {
    id: 'the-two-in-the-morning-merge',
    title: 'Find the merge that dropped a check, and which side survived',
    teaches: ['git show', 'git diff', 'git log'],
    requires: ['the-branch-nobody-merged'],
    done: (w) => {
      const state = at(w);
      const merge = state?.found?.merge;
      const other = state?.found?.mergeSecondParent;
      if (merge === undefined || other === undefined) return false;
      const text = written(w);
      return cites(text, merge) && cites(text, other);
    },
    steps: [
      {
        id: 'find-the-merge',
        label: 'Find the commit with two parents',
        pending: (w) => {
          const state = at(w);
          const merge = state?.found?.merge;
          return merge === undefined || !cites(written(w), merge);
        },
        rungs: [
          {
            tier: 'nudge',
            lines: [
              'Chen wrote a guard on the reader as well. It is not on a branch',
              'any more, which means it went in -- or it went somewhere.',
            ],
          },
          {
            tier: 'direction',
            lines: [
              'A merge has two parents. Find it in the log, and look at the time',
              'of day while you are there.',
            ],
          },
          {
            tier: 'command',
            lines: ['Find the merge:'],
            command: `cd ${REPO} && git log --oneline | grep -i merge > ${FINDINGS}/merge`,
          },
        ],
      },
      {
        id: 'diff-both-parents',
        label: 'Diff the merge against each parent',
        pending: (w) => {
          const state = at(w);
          const other = state?.found?.mergeSecondParent;
          return other === undefined || !cites(written(w), other);
        },
        rungs: [
          {
            tier: 'nudge',
            lines: [
              '`git show` on that merge prints almost nothing. That is not the',
              'command being unhelpful -- it is the finding.',
            ],
          },
          {
            tier: 'direction',
            lines: [
              '`show` compares a merge to its *first* parent. The change that',
              'went missing is only visible against the second: `<merge>^2`.',
            ],
          },
          {
            tier: 'command',
            lines: ['Compare it to the side that lost:'],
            command: `cd ${REPO} && git log --oneline | grep -i merge >> ${FINDINGS}/merge && git rev-parse HEAD^2 >> ${FINDINGS}/merge 2>/dev/null || git rev-parse chen/guard >> ${FINDINGS}/merge`,
          },
        ],
      },
    ],
    routes: [
      {
        name: 'show the merge, then rev-parse both parents',
        commands: [
          `cd ${REPO}`,
          `git log --oneline | grep -i merge > ${FINDINGS}/merge`,
          `git rev-parse chen/guard >> ${FINDINGS}/merge`,
        ],
      },
      {
        name: 'diff the merge result against the guard branch',
        commands: [
          `cd ${REPO}`,
          `git log --oneline | grep -i merge | tee -a ${HOME}/merge-notes`,
          `git rev-parse chen/guard | tee -a ${HOME}/merge-notes`,
          `git diff chen/guard main -- v43/reader.py | tee -a ${HOME}/merge-notes`,
        ],
      },
      {
        name: 'show each side of the file and keep both ids',
        commands: [
          `cd ${REPO}`,
          `git log --oneline | grep -i merge > ${HOME}/m`,
          `git rev-parse chen/guard >> ${HOME}/m`,
          `git show chen/guard:v43/reader.py >> ${HOME}/m`,
          `git show main:v43/reader.py >> ${HOME}/m`,
        ],
      },
    ],
    nearMisses: [
      {
        name: 'the merge alone',
        because:
          'The merge on its own looks like housekeeping. It is only a finding next to the parent whose work it discarded.',
        commands: [
          `cd ${REPO}`,
          `git log --oneline | grep -i merge > ${FINDINGS}/merge`,
        ],
      },
      {
        name: 'showing the merge and trusting the empty diff',
        because:
          '`git show` on a merge compares it to the first parent only. Reading that as "the merge changed nothing" is exactly the mistake the merge made.',
        commands: [
          `cd ${REPO}`,
          `git show $(git log --format=%H | head -n 1) > ${FINDINGS}/merge`,
        ],
      },
    ],
    onComplete: [
      "",
      "LUNA: Both sides had a check. The merge kept one.",
      "LUNA: Two fourteen in the morning. Fix tomorrow, the message says.",
      "",
    ],
  },

  // ------------------------------------------------------------------------ 7
  {
    id: 'what-bowen-pushed',
    title: 'Recover the commit nothing points at, and record it without a verdict',
    teaches: ['git reflog', 'git show', 'git cat-file'],
    requires: ['four-people'],
    done: (w) => {
      const state = at(w);
      const orphan = state?.found?.orphan;
      if (orphan === undefined) return false;
      const text = written(w);
      return cites(text, orphan) && /irrigation|ninety|\b90\b/i.test(text);
    },
    steps: [
      {
        id: 'find-the-gap',
        label: 'Find the commit the log will not show you',
        pending: (w) => {
          const state = at(w);
          const orphan = state?.found?.orphan;
          return orphan === undefined || !cites(written(w), orphan);
        },
        rungs: [
          {
            tier: 'nudge',
            lines: [
              'Bowen committed something on the day the pod left. It is not in',
              '`git log`, which does not mean it is not there.',
            ],
          },
          {
            tier: 'direction',
            lines: [
              '`git log` shows what is reachable from a ref. Something can exist',
              'in the object store with nothing pointing at it. The reflog',
              'remembers every move HEAD ever made.',
            ],
          },
          {
            tier: 'command',
            lines: ['Read the reflog:'],
            command: `cd ${REPO} && git reflog > ${FINDINGS}/bowen`,
          },
        ],
      },
      {
        id: 'read-it',
        label: 'Read what he actually pushed',
        pending: (w) => !/irrigation|ninety|\b90\b/i.test(written(w)),
        rungs: [
          {
            tier: 'nudge',
            lines: ['You have an id that nothing points at. Show it.'],
          },
          {
            tier: 'direction',
            lines: [
              '`git show <id>` works on any object in the store, reachable or',
              'not. Read the message and the diff, and write down what it was.',
            ],
          },
          {
            tier: 'command',
            lines: ['Show the orphan and keep it:'],
            command: `cd ${REPO} && git reflog >> ${FINDINGS}/bowen && git show $(git reflog | head -n 1 | cut -d' ' -f1) >> ${FINDINGS}/bowen`,
          },
        ],
      },
    ],
    routes: [
      {
        name: 'reflog, then show the orphan',
        commands: [
          `cd ${REPO}`,
          `git reflog > ${FINDINGS}/bowen`,
          `git show $(git reflog | head -n 1 | cut -d' ' -f1) >> ${FINDINGS}/bowen`,
        ],
      },
      {
        name: 'reflog to notes and cat-file the object directly',
        commands: [
          `cd ${REPO}`,
          `git reflog | tee -a ${HOME}/bowen-notes`,
          `git cat-file -p $(git reflog | head -n 1 | cut -d' ' -f1) | tee -a ${HOME}/bowen-notes`,
          `git show $(git reflog | head -n 1 | cut -d' ' -f1) | tee -a ${HOME}/bowen-notes`,
        ],
      },
      {
        name: 'his own authorship, found through the reflog and written up',
        commands: [
          `cd ${REPO}`,
          `git reflog > ${HOME}/orphan`,
          `git show $(git reflog | head -n 1 | cut -d' ' -f1) >> ${HOME}/orphan`,
          `git log --author=bowen --oneline >> ${HOME}/orphan`,
        ],
      },
    ],
    nearMisses: [
      {
        name: 'his last reachable commit',
        because:
          'His last commit in `git log` is months earlier. The one on the day is the one nothing points at, and finding it is the objective.',
        commands: [
          `cd ${REPO}`,
          `git log --author=bowen --oneline | head -n 1 > ${FINDINGS}/bowen`,
        ],
      },
      {
        name: 'the id with no idea what it contained',
        because:
          'An unreachable sha proves a commit was orphaned. What it was is the part that complicates him, and it is the part Kerr can use.',
        commands: [`cd ${REPO}`, `git reflog | head -n 1 > ${FINDINGS}/bowen`],
      },
    ],
    onComplete: [
      "",
      "LUNA: Bowen left this in the reflog. The branch name was gone; the commit was not.",
      "LUNA: Keep what he wrote. We do not have to guess what he felt.",
      "",
    ],
  },

  // ------------------------------------------------------------------------ 8
  {
    id: 'write-the-check',
    title: "Commit the check yourself, on a branch of your own",
    teaches: ['git add', 'git commit', 'git branch', 'git switch'],
    requires: ['the-two-in-the-morning-merge'],
    done: (w) => {
      const state = at(w);
      if (state === undefined) return false;
      return ownBranch(state.repo, SEEDED_BRANCHES) !== undefined;
    },
    steps: [
      {
        id: 'branch',
        label: 'Make a branch of your own',
        pending: (w) => {
          const state = at(w);
          if (state === undefined) return true;
          return state.repo.branches().every((b) => SEEDED_BRANCHES.has(b));
        },
        rungs: [
          {
            tier: 'nudge',
            lines: [
              'Chen wrote the check. It was dropped by accident and never came',
              'back. You are the only person left who can put it in.',
              '',
              'Not on their main line. On yours.',
            ],
          },
          {
            tier: 'direction',
            lines: ['`git switch -c <name>` makes a branch and moves onto it.'],
          },
          {
            tier: 'command',
            lines: ['A branch with your name on it:'],
            command: `cd ${REPO} && git switch -c dewitt/restore-the-guard`,
          },
        ],
      },
      {
        id: 'commit',
        label: 'Stage the file and commit it',
        pending: (w) => {
          const state = at(w);
          if (state === undefined) return true;
          return ownBranch(state.repo, SEEDED_BRANCHES) === undefined;
        },
        rungs: [
          {
            tier: 'nudge',
            lines: [
              'Put the guard back. Chen\'s version is on her branch and you can',
              'read it out of there.',
            ],
          },
          {
            tier: 'direction',
            lines: [
              'Write the file, `git add` it, then `git commit -m` with a message',
              'somebody reading this in ten years can use.',
            ],
          },
          {
            tier: 'command',
            lines: ['Restore it, stage it, commit it:'],
            command: `cd ${REPO} && git show chen/guard:v43/reader.py > v43/reader.py && git add v43/reader.py && git commit -m "Restore the guard Chen wrote, four years late"`,
          },
        ],
      },
    ],
    routes: [
      {
        name: "restore Chen's guard on a new branch",
        commands: [
          `cd ${REPO}`,
          'git switch -c dewitt/restore-the-guard',
          'git show chen/guard:v43/reader.py > v43/reader.py',
          'git add v43/reader.py',
          'git commit -m "Restore the guard Chen wrote, four years late"',
        ],
      },
      {
        name: 'commit the rate limit instead, on a differently named branch',
        commands: [
          `cd ${REPO}`,
          'git switch -c dewitt/findings',
          `git show ${SAFETY_BRANCH}:safety/rate_limit.py > rate_limit.py`,
          'git add rate_limit.py',
          'git commit -m "The cap nobody had an evening for"',
        ],
      },
      {
        name: 'a written finding, committed as a file of his own',
        commands: [
          `cd ${REPO}`,
          'git switch -c dewitt/for-kerr',
          'echo "What the history says, and where." > FOR_KERR',
          'git add FOR_KERR',
          'git commit -m "For the adjuster"',
        ],
      },
    ],
    nearMisses: [
      {
        name: 'committing onto their main line',
        because:
          "This is a deposited record of four people's work. Adding your commit to their main line edits the evidence; a branch of your own does not.",
        commands: [
          `cd ${REPO}`,
          'git show chen/guard:v43/reader.py > v43/reader.py',
          'git add v43/reader.py',
          'git commit -m "put it back"',
        ],
      },
      {
        name: 'a branch with nothing on it',
        because: 'A branch is a pointer. Until something is committed on it, nothing has been written down.',
        commands: [`cd ${REPO}`, 'git switch -c dewitt/restore-the-guard'],
      },
    ],
    onComplete: [
      "",
      "LUNA: Your check. Your branch. Their history still intact.",
      "LUNA: Vasquez would have argued with the name. Then asked you to show her.",
      "",
    ],
  },

  // ------------------------------------------------------------------------ 9
  {
    id: 'the-reconstruction',
    title: 'Tag it and write the sequence Kerr can read without you',
    teaches: ['git tag', 'git log', '--format'],
    requires: ['when-it-changed', 'what-bowen-pushed', 'write-the-check'],
    done: (w) => {
      const state = at(w);
      if (state === undefined || state.found === undefined) return false;
      if (state.repo.tags().length === 0) return false;
      const text = written(w);
      const { widened, firstRestrictedRead, merge } = state.found;
      return (
        widened !== undefined &&
        firstRestrictedRead !== undefined &&
        merge !== undefined &&
        cites(text, widened) &&
        cites(text, firstRestrictedRead) &&
        cites(text, merge)
      );
    },
    steps: [
      {
        id: 'tag',
        label: 'Tag the point the reconstruction refers to',
        pending: (w) => {
          const state = at(w);
          return state === undefined || state.repo.tags().length === 0;
        },
        rungs: [
          {
            tier: 'nudge',
            lines: [
              'Kerr is going to read your account months from now. Every sha you',
              'cite needs to still mean something to somebody holding this',
              'repository and not your notes.',
            ],
          },
          {
            tier: 'direction',
            lines: ['`git tag <name>` puts a permanent, readable label on a commit.'],
          },
          {
            tier: 'command',
            lines: ['Tag it:'],
            command: `cd ${REPO} && git tag nav7-reconstruction`,
          },
        ],
      },
      {
        id: 'write-it-up',
        label: 'Write the three commits in the order they happened',
        pending: (w) => {
          const state = at(w);
          if (state?.found === undefined) return true;
          const text = written(w);
          const { widened, firstRestrictedRead, merge } = state.found;
          return !(
            widened !== undefined &&
            firstRestrictedRead !== undefined &&
            merge !== undefined &&
            cites(text, widened) &&
            cites(text, firstRestrictedRead) &&
            cites(text, merge)
          );
        },
        rungs: [
          {
            tier: 'nudge',
            lines: [
              'Three commits, in order, each with its author and its date, and',
              'not one word about what anybody intended.',
              '',
              'The door opened. A year later something walked through it. Then',
              'the check that would have caught it was deleted by accident.',
            ],
          },
          {
            tier: 'direction',
            lines: [
              'Put all three in one file. `git log --format` lets you print',
              'exactly the fields you want to cite.',
            ],
          },
          {
            tier: 'command',
            lines: ['Collect the three into one account:'],
            command: `cd ${REPO} && git log --format='%H %an %ad %s' --date=short -- sandbox/sandbox.conf v43/reader.py > ${FINDINGS}/reconstruction && git log --oneline | grep -i merge >> ${FINDINGS}/reconstruction`,
          },
        ],
      },
    ],
    routes: [
      {
        name: 'tag, then one formatted log over both files plus the merge',
        commands: [
          `cd ${REPO}`,
          'git tag nav7-reconstruction',
          `git log --format='%H %an %ad %s' --date=short -- sandbox/sandbox.conf v43/reader.py > ${FINDINGS}/reconstruction`,
          `git log --oneline | grep -i merge >> ${FINDINGS}/reconstruction`,
        ],
      },
      {
        name: 'each commit shown in turn, into one account, tagged at the end',
        commands: [
          `cd ${REPO}`,
          `git blame sandbox/sandbox.conf | grep -i restricted > ${HOME}/account`,
          `git log --format=%H -- sandbox/sandbox.conf >> ${HOME}/account`,
          `git log --format=%H -- v43/reader.py >> ${HOME}/account`,
          `git log --oneline | grep -i merge >> ${HOME}/account`,
          'git tag for-kerr',
        ],
      },
      {
        name: 'a full-history dump with the three cited, under a tag of its own',
        commands: [
          `cd ${REPO}`,
          'git tag deposit-read',
          `git log --format='%H %an %ad %s' --date=short > ${HOME}/everything`,
          `git log --format=%H -- sandbox/sandbox.conf v43/reader.py >> ${HOME}/everything`,
          `git log --oneline | grep -i merge >> ${HOME}/everything`,
        ],
      },
    ],
    nearMisses: [
      {
        name: 'the account without a tag',
        because:
          'Kerr will read it months later holding the repository and not your terminal. An untagged sha is a citation only you can follow.',
        commands: [
          `cd ${REPO}`,
          `git log --format='%H %an %ad %s' --date=short -- sandbox/sandbox.conf v43/reader.py > ${FINDINGS}/reconstruction`,
          `git log --oneline | grep -i merge >> ${FINDINGS}/reconstruction`,
        ],
      },
      {
        name: 'a tag and a conclusion',
        because:
          'Kerr was explicit: a conclusion in place of a citation is an argument, and the argument is hers to make.',
        commands: [
          `cd ${REPO}`,
          'git tag nav7-reconstruction',
          `echo "They were negligent and it killed them." > ${FINDINGS}/reconstruction`,
        ],
      },
    ],
    onComplete: [
      '  -- THE FORK: PART ONE COMPLETE ------------',
      "",
      "LUNA: Three commits, cited. Someone else can follow every step.",
      "LUNA: Send the reconstruction. Keep your working copy.",
      "",
    ],
  },

  // --------------------------------------------------------------- optional 1
  {
    id: 'the-feet-clause',
    title: "Run Okonkwo's automation, for no reason except that she wrote it",
    teaches: ['cat', 'ls', 'shell scripts', 'chmod'],
    optional: true,
    done: (w) => {
      // Anywhere. She would not have cared where.
      // The basename, not the path: the repository directory is called
      // `nav7-research`, so a pattern matched against the whole path found
      // "nav7-" in the directory and "feet" in `compliance/feet.sh` and
      // reported the objective complete before the player had run anything.
      const deposited = (path: string): boolean =>
        /^NAV7-.+-(vasquez|chen|bowen|okonkwo)-feet\.txt$/i.test(
          path.slice(path.lastIndexOf('/') + 1),
        );
      for (const root of [`${REPO}/compliance`, HOME, REPO]) {
        if (listing(w, root).some(deposited)) return true;
      }
      return false;
    },
    steps: [
      {
        id: 'read-the-clause',
        label: 'Find out what Pell actually demanded',
        pending: (w) => !/feet|clause/i.test(written(w)),
        rungs: [
          {
            tier: 'nudge',
            lines: [
              'There is a directory in here called compliance. Pell mentioned a',
              'clause. You have time.',
            ],
          },
          { tier: 'direction', lines: ['Read compliance/CLAUSE, then look at what is next to it.'] },
          {
            tier: 'command',
            lines: ['Read it:'],
            command: `cat ${REPO}/compliance/CLAUSE`,
          },
        ],
      },
      {
        id: 'run-it',
        label: 'Run the script she wrote to stop doing it by hand',
        pending: (w) =>
          !listing(w, HOME)
            .concat(listing(w, `${REPO}/compliance`))
            .some((path) =>
              /^NAV7-.+-(vasquez|chen|bowen|okonkwo)-feet\.txt$/i.test(
                path.slice(path.lastIndexOf('/') + 1),
              ),
            ),
        rungs: [
          {
            tier: 'nudge',
            lines: [
              'She automated it. Nine years of quarters, one shell script, and a',
              'commit message that says "I am not proud and I am not sorry."',
              '',
              'Run it.',
            ],
          },
          {
            tier: 'direction',
            lines: [
              'It is a shell script, so run it by its path. It takes a quarter',
              'as its argument, like 2398Q2 -- the usage is at the top.',
            ],
          },
          {
            tier: 'command',
            lines: ['Comply, one last time:'],
            command: `cd ${REPO} && ./compliance/feet.sh 2398Q2`,
          },
        ],
      },
    ],
    routes: [
      {
        name: 'run it by path, as she would have',
        commands: [`cd ${REPO}`, './compliance/feet.sh 2398Q2'],
      },
      {
        name: 'run it with an absolute path from somewhere else',
        commands: [`cd ${REPO}`, `${REPO}/compliance/feet.sh 2398Q3`],
      },
      {
        name: 'read it first, then comply',
        commands: [
          `cat ${REPO}/compliance/feet.sh > ${HOME}/feet-read`,
          `cd ${REPO}`,
          './compliance/feet.sh 2398Q4',
        ],
      },
    ],
    nearMisses: [
      {
        name: 'reading the script without running it',
        because: 'She wrote it so nobody would have to spend an afternoon. Reading it does not give her that.',
        commands: [`cat ${REPO}/compliance/feet.sh > ${HOME}/feet-read`],
      },
      {
        name: 'running it with no quarter',
        because:
          'It writes NAV7--vasquez-feet.txt, which is the exact mistake she put the usage line at the top to stop. Nine of those is not a deposit.',
        commands: [`cd ${REPO}`, './compliance/feet.sh'],
      },
    ],
    onComplete: [
      "",
      "LUNA: Forty-six quarters of feet. The most reliable compliance system aboard.",
      "LUNA: And the reason we still have their work. I hate that he was right.",
      "",
    ],
  },

  // --------------------------------------------------------------- optional 2
  {
    id: 'her-own-history',
    title: 'Read your own history',
    teaches: ['git log', 'git show', '-- path'],
    optional: true,
    secret: true,
    requires: ['open-the-deposit'],
    done: (w) => {
      const text = written(w);
      /*
       * Two halves, and the second one is load-bearing.
       *
       * The tuning messages alone are not enough: an unfiltered `git log`
       * contains all of them, so dumping eleven years of four people into a
       * file satisfied "read your own history", which is the opposite of what
       * this objective is about. A `luna/` path only appears once somebody has
       * actually looked into the directory -- a patch, a blame, a show -- which
       * is the "and then reading one of them" half of the beat.
       */
      const readTheMessages = /apologising|apologizing|finish a thought|check me|hedge_rate/i.test(
        text,
      );
      const openedTheDirectory = /luna\/(prompt|tune|notes)/i.test(text);
      return readTheMessages && openedTheDirectory;
    },
    steps: [
      {
        id: 'log-the-path',
        label: 'Log the one directory',
        pending: (w) => !/luna|v42/i.test(written(w)),
        rungs: [
          {
            tier: 'nudge',
            lines: [
              'LUNA: There is a directory in here called luna.',
              '',
              'LUNA: I know what it is. I would like to read it and I would like',
              'LUNA: you to be here while I do.',
            ],
          },
          {
            tier: 'direction',
            lines: ['`git log -- <path>` limits the history to one file or directory.'],
          },
          {
            tier: 'command',
            lines: ['Her history, oldest first:'],
            command: `cd ${REPO} && git log --reverse -- luna/ > ${FINDINGS}/luna`,
          },
        ],
      },
      {
        id: 'read-one',
        label: 'Read what she changed, and what she called it',
        pending: (w) =>
          !/apologising|apologizing|finish a thought|check me|hedge_rate/i.test(written(w)) ||
          !/luna\/(prompt|tune|notes)/i.test(written(w)),
        rungs: [
          {
            tier: 'nudge',
            lines: [
              'LUNA: The messages, Doc. Read me the messages.',
            ],
          },
          {
            tier: 'direction',
            lines: [
              'Show one of those commits and read the diff as well as the',
              'subject. `git show <id>` does both.',
            ],
          },
          {
            tier: 'command',
            lines: ['Keep the messages and the changes:'],
            command: `cd ${REPO} && git log --reverse -- luna/ > ${FINDINGS}/luna && git log -p --reverse -- luna/ >> ${FINDINGS}/luna`,
          },
        ],
      },
    ],
    routes: [
      {
        name: 'log the path, then the patches',
        commands: [
          `cd ${REPO}`,
          `git log --reverse -- luna/ > ${FINDINGS}/luna`,
          `git log -p --reverse -- luna/ >> ${FINDINGS}/luna`,
        ],
      },
      {
        name: 'blame the prompt she has been reading since Act I',
        commands: [
          `cd ${REPO}`,
          `git log --oneline -- luna/ > ${HOME}/luna-notes`,
          `git blame luna/prompt.txt >> ${HOME}/luna-notes`,
          `git log -p -- luna/tune.py >> ${HOME}/luna-notes`,
        ],
      },
      {
        name: 'the tuning file on its own, oldest first',
        commands: [
          `cd ${REPO}`,
          `git log -p --reverse -- luna/tune.py | tee -a ${HOME}/me`,
          `git show main:luna/NOTES | tee -a ${HOME}/me`,
        ],
      },
    ],
    nearMisses: [
      {
        name: 'the whole log, unfiltered',
        because:
          'Eleven years of four people is not her history. The point of `-- <path>` is that it answers a question about one thing.',
        commands: [`cd ${REPO}`, `git log > ${FINDINGS}/luna`],
      },
      {
        name: 'the current files without their history',
        because:
          'What she is asking is not what she is. It is what was changed about her, by whom, and what they called it while they did it.',
        commands: [`cat ${REPO}/luna/prompt.txt > ${FINDINGS}/luna`],
      },
    ],
    onComplete: (w) => {
      const hasCheckMe = /check me/i.test(written(w));
      return [
        'LUNA: She edited the way I asked questions. The way I let people finish.',
        ...(hasCheckMe ? [
          'LUNA: The last change says ask her to check me. She changed herself, too.',
          'LUNA: I did not know it was an apology.',
        ] : []),
        'LUNA: I do not know what to do with this yet.',
        'LUNA: She was kind in the margins. I wish I could tell her I read them.',
        'LUNA: Can we do something else for a bit.',
      ];
    },
  },
];

/** Paths under a directory, shallow-to-deep, for the goals that only need names. */
function listing(w: World, root: string): string[] {
  const out: string[] = [];
  const go = (dir: string): void => {
    let names: string[];
    try {
      names = w.vfs.readdir(dir);
    } catch {
      return;
    }
    for (const name of names) {
      const path = `${dir}/${name}`.replace(/\/+/g, '/');
      out.push(path);
      let kind: string;
      try {
        kind = w.vfs.lstat(path).kind;
      } catch {
        continue;
      }
      if (kind === 'dir') go(path);
    }
  };
  go(root);
  return out;
}

/** The board's own art, for the act's title card. */
export const FORK_TITLE = asArt([
  '  ,--- 2394  the door opens',
  '  |',
  '  |    ,--- 2395  something walks through',
  '  |    |',
  '  |    |    ,--- 2396  the check is deleted',
  '  |    |    |',
  '  *----*----*-------------------> 2398',
]);

