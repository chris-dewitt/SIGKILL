import { ROOT_USER } from '@sigkill/machine';
import type { Objective, Route, World } from '@sigkill/quest';
import {
  DESTINATION,
  LEDGER_KB,
  TRANSIT_SECONDS,
  UPLINK_REJECTED,
  UPLINK_SAMPLES,
  UPLINK_TOTAL,
  V43_EXECUTABLE,
} from './act1/dump.js';

/**
 * The Harness: the ladders.
 *
 * The rule from Act I holds and is harder to keep here than anywhere so far:
 * every `done` reads world state and never what was typed. With a shell
 * puzzle the temptation is to check the command; with a *programming* puzzle
 * the temptation is to check the source, and it is much stronger, because the
 * source is right there in a file and it is so easy to grep for `unittest`.
 *
 * Do not. A player who parses the log with a comprehension instead of a loop,
 * or with `csv` instead of `split`, has understood more and not less. What the
 * goals ask is the only thing Kerr asks: is the right answer written down, and
 * did the method that produced it survive being run twice.
 *
 * Two structural decisions worth knowing before editing anything below.
 *
 * **Facts are wanted together, in one file.** `wroteTogether` is the archive's
 * helper and it is here for the archive's reason -- a finding is a thing you
 * recorded, not two numbers loose in a directory. It also happens to be the
 * only defence against citation: `2211404096` is already in his pocket from
 * game two, so "the total" on its own proves nothing about whether he read the
 * telemetry. Recorded *next to the sample count*, it does.
 *
 * **`carried/` is not his work.** The walk skips it. Everything in there came
 * off another machine, and an objective that the player satisfies by owning a
 * file is an objective that was satisfied before the game booted -- which is
 * precisely the bug the route harness caught in game two on its first day.
 */

/** Where the hints send him. Any file of his own counts; this is the default. */
export const FINDINGS = '/home/dewitt/findings.txt';

export const RECOVERY = '/srv/recovery/nav7';
export const UPLINK_LOG = `${RECOVERY}/telemetry/uplink.log`;
export const LEDGER_CSV = `${RECOVERY}/ledger/ellen-may.csv`;
export const COMMS_BUFFER = `${RECOVERY}/comms/buffer.txt`;
export const INCIDENT = `${RECOVERY}/manifest/incident.json`;
export const SESSIONS_LOG = `${RECOVERY}/telemetry/sessions.log`;

/** What he brought with him, and therefore did not find. */
const CARRIED = '/home/dewitt/carried';

/**
 * A number as it might reasonably be written down.
 *
 * Thousands separators are optional and may be commas, underscores or spaces,
 * because Python prints one of those, `format` prints another, and a person
 * typing prints the third. The boundaries stop `823` matching the middle of a
 * timestamp.
 */
function figure(n: number): RegExp {
  const groups = String(n).replace(/\B(?=(\d{3})+$)/g, ' ').split(' ');
  return new RegExp(`(?<![\\d.])${groups.join('[,_ ]?')}(?![\\d])`);
}

const N_SAMPLES = figure(UPLINK_SAMPLES);
const N_TOTAL = figure(UPLINK_TOTAL);
const N_REJECTED = figure(UPLINK_REJECTED);
const N_LEDGER = figure(LEDGER_KB);
const N_SECONDS = figure(TRANSIT_SECONDS);

/**
 * 2.211404096 GB and 2.0595305562 GiB, at whatever precision he kept.
 *
 * Note what is *not* accepted: `2.2`. That is the operator's rounded figure
 * and it is already in the incident report, so matching it would let a player
 * satisfy the objective by copying the thing they are supposed to be checking.
 */
const GB_FIGURE = /2\.21\d*/;

/**
 * The optional thread's two facts.
 *
 * `V43_PATH` is the executable that was granted the channel -- the name that
 * Act I deliberately never supplies, arriving from a source DeWitt could not
 * read until the tow pulled it off the hull. `DECLARATION` is the field in the
 * profile he carried that says the ship was declared empty, and by whom, and
 * whose answer has been the word AUTOMATED since the first minute of game one.
 *
 * Putting them in one file is the whole objective. Either one alone is a
 * coincidence with a bad feeling attached.
 */
const V43_PATH = /\/opt\/luna\/v43/;
const DECLARATION = /DECLARED_(?:BY=AUTOMATED|TRANSIT=unmanned)/;
const GRANT_ACCOUNT = /RG-NAV7-03/;
const GIB_FIGURE = /2\.0(?:59\d*|6(?!\d))/;

/** Read as root, or empty. The player may delete anything. */
function text(world: World, path: string): string {
  try {
    return world.vfs.readText(path, ROOT_USER);
  } catch {
    return '';
  }
}

/** Every file of his own making, path and contents. `carried/` excluded. */
function ownFiles(world: World): { path: string; body: string }[] {
  const out: { path: string; body: string }[] = [];
  const walk = (dir: string): void => {
    if (dir === CARRIED) return;
    let names: string[];
    try {
      names = world.vfs.readdir(dir, ROOT_USER);
    } catch {
      return;
    }
    for (const name of names) {
      const path = `${dir}/${name}`;
      try {
        const stat = world.vfs.lstat(path, ROOT_USER);
        if (stat.kind === 'dir') {
          walk(path);
        } else if (stat.kind === 'file') {
          out.push({ path, body: world.vfs.readText(path, ROOT_USER) });
        }
      } catch {
        // Unreadable or gone between the listing and the read. Not a match.
      }
    }
  };
  walk('/home/dewitt');
  return out;
}

/** Did he write these facts down together, in one file of his own? */
function wroteTogether(world: World, ...patterns: RegExp[]): boolean {
  return ownFiles(world).some(({ body }) => patterns.every((p) => p.test(body)));
}

/** Is there a program of his own here at all? */
function wroteScript(world: World): boolean {
  return ownFiles(world).some(({ path, body }) => path.endsWith('.py') && body.trim().length > 0);
}

/**
 * A captured test report showing a suite that ran and passed.
 *
 * `unittest` writes its report to stderr, which is correct and is also the
 * lesson: he has to redirect the *right* stream to keep it. Two tests minimum,
 * because a suite of one is a suite that has not yet had to disagree with
 * itself, and Kerr asked for tests that can fail.
 */
function passingReport(world: World, minimum = 2): boolean {
  return ownFiles(world).some(({ body }) => {
    const ran = /Ran (\d+) tests?/.exec(body);
    if (!ran) return false;
    // `OK` on its own line is unittest's word for it. `FAILED` anywhere means
    // he kept a report of a suite that did not pass, which is honest of him
    // and not what was asked for.
    return Number(ran[1]) >= minimum && /^OK\b/m.test(body) && !/^FAILED/m.test(body);
  });
}

/** Two files of his that are byte-identical, and actually say something. */
function ranItTwice(world: World): { a: string; b: string } | undefined {
  const candidates = ownFiles(world).filter(
    ({ path, body }) => !path.endsWith('.py') && N_TOTAL.test(body) && body.trim().length > 20,
  );
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      if (candidates[i]!.body === candidates[j]!.body) {
        return { a: candidates[i]!.path, b: candidates[j]!.path };
      }
    }
  }
  return undefined;
}

/**
 * The deliverable: a directory holding a method somebody else can run.
 *
 * Four things, because Kerr asked for three and a stranger needs the fourth.
 * The directory may be called anything -- `hearing` is what the hints suggest
 * and nothing depends on the name.
 */
function packaged(world: World): boolean {
  const dirs = new Map<string, { path: string; body: string }[]>();
  for (const entry of ownFiles(world)) {
    const dir = entry.path.slice(0, entry.path.lastIndexOf('/'));
    if (dir === '/home/dewitt') continue; // The package is a directory of its own.
    const list = dirs.get(dir) ?? [];
    list.push(entry);
    dirs.set(dir, list);
  }

  for (const files of dirs.values()) {
    const name = (entry: { path: string }) => entry.path.slice(entry.path.lastIndexOf('/') + 1);
    const tests = files.filter((f) => /test/i.test(name(f)) && name(f).endsWith('.py'));
    const module = files.filter((f) => name(f).endsWith('.py') && !/test/i.test(name(f)));
    const report = files.filter((f) => /Ran \d+ tests?/.test(f.body) && /^OK\b/m.test(f.body));
    const readme = files.filter((f) => /^readme/i.test(name(f)) && f.body.trim().length > 40);
    if (tests.length > 0 && module.length > 0 && report.length > 0 && readme.length > 0) return true;
  }
  return false;
}

// ----------------------------------------------------------------- authoring

/**
 * Author a Python file the way a route has to.
 *
 * Routes are shell commands: the harness drives a shell, and the editor is a
 * screen program the host owns, so `vi` is unavailable to it even though `vi`
 * is what the player will actually use. `echo` with a redirect is the honest
 * alternative -- it is a real thing a real person does, indentation survives
 * the quoting intact, and it keeps the claim "this route works" checkable.
 *
 * Lines must not contain a single quote. Python has double quotes; use them.
 */
function writePy(path: string, lines: readonly string[]): string[] {
  for (const line of lines) {
    if (line.includes("'")) throw new Error(`route source cannot contain a single quote: ${line}`);
  }
  return lines.map((line, i) => `echo '${line}' ${i === 0 ? '>' : '>>'} ${path}`);
}

/**
 * The parser, as most players will end up writing it.
 *
 * Used by routes from objective two onward. It skips comments, which is the
 * difference between rejecting seventeen lines and rejecting twenty -- see
 * `the-rejected-rows`, where that difference is the puzzle.
 */
const UPLINK_MODULE = [
  'def read(path):',
  '    rows = []',
  '    bad = 0',
  '    for line in open(path):',
  '        line = line.strip()',
  '        if not line or line.startswith("#"):',
  '            continue',
  '        f = line.split()',
  '        try:',
  '            rows.append((f[0], int(f[2]), f[3]))',
  '        except (IndexError, ValueError):',
  '            bad += 1',
  '    return rows, bad',
  '',
  'def total(rows):',
  '    return sum(b for (t, b, s) in rows)',
];

/** A route that builds the module, then runs one line against it. */
function withModule(inline: string, extra: readonly string[] = []): Route['commands'] {
  return [...writePy('/home/dewitt/uplink.py', UPLINK_MODULE), ...extra, `python3 -c '${inline}'`];
}

const READ = `import uplink; rows, bad = uplink.read("${UPLINK_LOG}")`;

// ---------------------------------------------------------------- the ladders

/**
 * Did he keep a line the prototype *printed*, rather than the source of it?
 *
 * The distinction is the whole objective. The route harness caught the loose
 * version immediately: `cp carried/other_shoe.py shoe.py` put every one of
 * those sentences in a file of his own without the program ever having run.
 * Output and source are told apart by the thing only source has.
 */
function keptItsOutput(world: World): boolean {
  const MINUTE = /hydroponics bay at second shift|song stuck in somebody|good screwdriver|hand on your shoulder/;
  return ownFiles(world).some(({ body }) => MINUTE.test(body) && !/def minute\(/.test(body));
}

export const HARNESS_OBJECTIVES: readonly Objective[] = [
  {
    id: 'open-the-dump',
    title: 'Find out how much telemetry there actually is',
    done: (w) => wroteScript(w) && wroteTogether(w, N_SAMPLES),
    teaches: ['python3', 'cat', 'echo', 'wc'],
    routes: [
      {
        name: 'a script that counts the readable lines',
        commands: [
          ...writePy('/home/dewitt/count.py', [
            'n = 0',
            `for line in open("${UPLINK_LOG}"):`,
            '    line = line.strip()',
            '    if line and not line.startswith("#"):',
            '        n = n + 1',
            'print("samples:", n)',
          ]),
          `python3 /home/dewitt/count.py > ${FINDINGS}`,
        ],
      },
      {
        name: 'the same thing as a one-liner, kept in a file',
        commands: [
          ...writePy('/home/dewitt/count.py', ['# counted inline, kept for the adjuster']),
          `python3 -c 'rows = [l for l in open("${UPLINK_LOG}") if l.strip() and not l.startswith("#")]; ` +
            `print(len(rows), "samples")' > ${FINDINGS}`,
        ],
      },
      {
        name: 'parse properly from the start, and report what parsed',
        commands: withModule(`${READ}; print("readable samples:", len(rows) + bad)`, []).concat([
          `python3 -c '${READ}; print("readable samples:", len(rows) + bad)' > /home/dewitt/notes.txt`,
        ]),
      },
    ],
    nearMisses: [
      {
        name: 'count it with wc and never write it down',
        commands: [`wc -l ${UPLINK_LOG}`],
        because: 'nothing of his holds the number, and wc counts the comments too',
      },
      {
        name: 'record the number with no program behind it',
        commands: [`echo 'samples: ${UPLINK_SAMPLES}' > ${FINDINGS}`],
        because: 'Kerr asked for the method, not the figure; there is no program here at all',
      },
      {
        name: 'copy what he already had in his pocket',
        commands: [`cp ${CARRIED}/archive-transit.txt ${FINDINGS}`],
        because: 'that is game two\'s row, carried in; it says nothing about how much telemetry exists',
      },
    ],
    onComplete: [
      '',
      `  ${UPLINK_SAMPLES} samples. Eleven minutes of them are not zero.`,
      '',
      'LUNA: Doc. Doc. You wrote a program.',
      '',
      'LUNA: I know it added up a column. I am choosing to be proud anyway,',
      'LUNA: because the alternative was reading eight hundred lines with your',
      'LUNA: actual eyes and I have seen you try to find a screwdriver.',
      '',
      'HOLLIS: Is it meant to make that noise?',
      '',
      'LUNA: That is the fan. That is always the fan.',
      '',
    ],
    steps: [
      {
        id: 'write-something',
        label: 'get Python to read the log at all',
        pending: (w) => !wroteScript(w),
        rungs: [
          {
            tier: 'nudge',
            lines: [
              'There is too much telemetry to read and exactly the right',
              'amount to count.',
              '',
              `    ls -l ${RECOVERY}/telemetry/`,
              '',
              'This machine has Python on it. The last engineer put it there.',
            ],
          },
          {
            tier: 'direction',
            track: 'cadet',
            lines: [
              'A Python program is a text file full of instructions, run all at',
              'once instead of one line at a time.',
              '',
              'Write one with the editor:',
              '',
              '    nano count.py',
              '',
              'Put this in it:',
              '',
              '    n = 0',
              `    for line in open("${UPLINK_LOG}"):`,
              '        n = n + 1',
              '    print(n)',
              '',
              'Save it, then run it with:  python3 count.py',
              '',
              'The for loop means "do the indented part once for each line".',
              'The indentation is not decoration -- it is how Python knows',
              'which lines are inside the loop.',
            ],
          },
          {
            tier: 'direction',
            lines: [
              'Either write a file and run it, or use `python3 -c` for a',
              'one-off. `open(path)` iterates lines.',
              '',
              'Mind the comment lines at the top of the log. `wc -l` will',
              'count them and be wrong by three, which is the sort of thing',
              'an adjuster notices.',
            ],
          },
          {
            tier: 'command',
            command:
              `echo 'print(len([l for l in open("${UPLINK_LOG}") ` +
              `if l.strip() and not l.startswith("#")]), "samples")' > /home/dewitt/count.py && ` +
              `python3 /home/dewitt/count.py > ${FINDINGS}`,
            lines: [
              'A program in a file, and then the program run. Kerr asked for',
              'the method, so it may as well live somewhere from the start:',
              '',
              `    echo 'print(len([l for l in open("${UPLINK_LOG}") \\`,
              `        if l.strip() and not l.startswith("#")]), "samples")' > count.py`,
              '    python3 count.py > findings.txt',
              '',
              'That is a list comprehension: build a list of the lines that',
              'are neither blank nor a comment, then take its length.',
            ],
          },
        ],
      },
      {
        id: 'keep-the-count',
        label: 'write the count down somewhere of your own',
        pending: (w) => !wroteTogether(w, N_SAMPLES),
        rungs: [
          {
            tier: 'nudge',
            lines: [
              'It printed and then it was gone.',
              '',
              'Send it to a file. `>` writes, `>>` adds to the end -- and you',
              'are going to be adding to this one all day.',
            ],
          },
          {
            tier: 'direction',
            lines: [
              'Keep one findings file and grow it. Everything Kerr wants will',
              'end up in it, and a finding you have to re-derive is a finding',
              'you will re-derive wrong at nine in the morning.',
              '',
              `    python3 count.py > ${FINDINGS}`,
              `    cat ${FINDINGS}`,
            ],
          },
          {
            tier: 'command',
            command:
              `python3 -c 'print(len([l for l in open("${UPLINK_LOG}") ` +
              `if l.strip() and not l.startswith("#")]), "samples")' > ${FINDINGS}`,
            lines: ['Run it again, into the file:'],
          },
        ],
      },
    ],
  },

  {
    id: 'the-total',
    title: 'Add up the bytes, and find out what the log actually says',
    requires: ['open-the-dump'],
    done: (w) => wroteTogether(w, N_SAMPLES, N_TOTAL),
    teaches: ['python3', 'echo', 'cat'],
    routes: [
      {
        name: 'a module with a parser in it, imported from one line',
        commands: withModule(
          `${READ}; print("samples:", len(rows) + bad); print("total bytes:", uplink.total(rows))`,
        ).concat([
          `python3 -c '${READ}; print("samples:", len(rows) + bad); ` +
            `print("total bytes:", uplink.total(rows))' > ${FINDINGS}`,
        ]),
      },
      {
        name: 'one script, one pass, try/except around the conversion',
        commands: [
          ...writePy('/home/dewitt/report.py', [
            'total = 0',
            'n = 0',
            `for line in open("${UPLINK_LOG}"):`,
            '    line = line.strip()',
            '    if not line or line.startswith("#"):',
            '        continue',
            '    n = n + 1',
            '    f = line.split()',
            '    try:',
            '        total = total + int(f[2])',
            '    except (IndexError, ValueError):',
            '        pass',
            'print("samples:", n)',
            'print("total bytes:", total)',
          ]),
          `python3 /home/dewitt/report.py > ${FINDINGS}`,
        ],
      },
      {
        name: 'sum only the samples that say the link was up',
        commands: [
          ...writePy('/home/dewitt/up.py', [
            'rows = []',
            'n = 0',
            `for line in open("${UPLINK_LOG}"):`,
            '    line = line.strip()',
            '    if not line or line.startswith("#"):',
            '        continue',
            '    n = n + 1',
            '    f = line.split()',
            '    if len(f) == 4 and f[3] == "up":',
            '        try:',
            '            rows.append(int(f[2]))',
            '        except ValueError:',
            '            pass',
            'print("samples:", n)',
            'print("total bytes:", sum(rows))',
          ]),
          `python3 /home/dewitt/up.py > ${FINDINGS}`,
        ],
      },
    ],
    nearMisses: [
      {
        name: 'cite the archive instead of the telemetry',
        commands: [
          `echo 'samples: ${UPLINK_SAMPLES}' > ${FINDINGS}`,
          `cat ${CARRIED}/archive-transit.txt >> /home/dewitt/other.txt`,
        ],
        because: 'the total and the count are in two different files, so nothing shows one came from the other',
      },
      {
        name: 'believe the operator',
        commands: [
          `echo 'samples: ${UPLINK_SAMPLES}' > ${FINDINGS}`,
          `echo 'volume: 2.2 GB per the operator' >> ${FINDINGS}`,
        ],
        because: 'that is the number under dispute, quoted back; the byte figure is still unknown',
      },
    ],
    onComplete: [
      '',
      `  total bytes: ${UPLINK_TOTAL}`,
      '',
      'LUNA: Doc.',
      '',
      'LUNA: Doc, that is the archive\'s number. That is the number off the',
      'LUNA: clerk\'s terminal, to the byte, and you did not get it from the',
      'LUNA: clerk. You got it from the ship.',
      '',
      'LUNA: Two machines that have never met agree about what happened.',
      'LUNA: That is -- I do not have a joke. Give me a minute.',
      '',
    ],
    steps: [
      {
        id: 'sum-it',
        label: 'add up the byte column and keep it with the count',
        pending: (w) => !wroteTogether(w, N_SAMPLES, N_TOTAL),
        rungs: [
          {
            tier: 'nudge',
            lines: [
              'Third field is the byte counter.',
              '',
              '`line.split()` cuts a line into its fields. `int()` turns one',
              'of them into a number you can add.',
              '',
              'Some of them will not convert. That is not your bug -- read',
              'what Python says about it, it is being specific on purpose.',
            ],
          },
          {
            tier: 'direction',
            track: 'cadet',
            lines: [
              'Three things, and then it is arithmetic:',
              '',
              '  fields = line.split()     cut the line up at the spaces',
              '  fields[2]                 the third one, counting from zero',
              '  int(fields[2])            that text, as a number',
              '',
              'Keep a running total:',
              '',
              '    total = 0',
              '    for line in open(path):',
              '        total = total + int(line.split()[2])',
              '',
              'Run it. It will stop with a ValueError, because seventeen of',
              'the lines were cut off mid-write when the power went. The',
              'error tells you the line. That is the machine helping.',
              '',
              'Wrap the conversion so one bad line does not end the program:',
              '',
              '    try:',
              '        total = total + int(line.split()[2])',
              '    except (IndexError, ValueError):',
              '        pass',
            ],
          },
          {
            tier: 'direction',
            lines: [
              'The dump is dirty on purpose -- the transition truncated some',
              'writes, and some counters read `--`.',
              '',
              '`int("--")` raises ValueError. A line cut off after the',
              'descriptor raises IndexError. Catch both, and keep the count',
              'and the total in the same file.',
            ],
          },
          {
            tier: 'command',
            command:
              `python3 -c 'n = 0
total = 0` +
              `\nfor line in open("${UPLINK_LOG}"):\n` +
              `    line = line.strip()\n` +
              `    if not line or line.startswith("#"):\n` +
              `        continue\n` +
              `    n = n + 1\n` +
              `    try:\n` +
              `        total = total + int(line.split()[2])\n` +
              `    except (IndexError, ValueError):\n` +
              `        pass\n` +
              `print("samples:", n)\n` +
              `print("total bytes:", total)' > ${FINDINGS}`,
            lines: [
              'The whole thing, as one command. It is long because a program',
              'is long; there is no shame in writing it in the editor',
              'instead.',
            ],
          },
        ],
      },
    ],
  },

  {
    id: 'write-the-test',
    title: 'Give the adjuster something that can fail',
    requires: ['the-total'],
    done: (w) => passingReport(w),
    teaches: ['python3', 'echo', 'cat'],
    routes: [
      {
        name: 'a suite against the module, report kept from stderr',
        commands: [
          ...writePy('/home/dewitt/uplink.py', UPLINK_MODULE),
          ...writePy('/home/dewitt/test_uplink.py', [
            'import unittest',
            'import uplink',
            '',
            'class TestParse(unittest.TestCase):',
            '    def test_a_clean_line_parses(self):',
            '        rows, bad = uplink.read("/home/dewitt/three.log")',
            '        self.assertEqual(len(rows), 2)',
            '',
            '    def test_a_cut_line_is_rejected(self):',
            '        rows, bad = uplink.read("/home/dewitt/three.log")',
            '        self.assertEqual(bad, 1)',
            '',
            'if __name__ == "__main__":',
            '    unittest.main()',
          ]),
          'echo \'T1 fd3 100 up\' > /home/dewitt/three.log',
          'echo \'T2 fd3 -- up\' >> /home/dewitt/three.log',
          'echo \'T3 fd3 5 up\' >> /home/dewitt/three.log',
          'python3 /home/dewitt/test_uplink.py 2> /home/dewitt/test-report.txt',
        ],
      },
      {
        name: 'no main guard, discovered by the runner',
        commands: [
          ...writePy('/home/dewitt/uplink.py', UPLINK_MODULE),
          ...writePy('/home/dewitt/test_totals.py', [
            'import unittest',
            'import uplink',
            '',
            'class TestTotal(unittest.TestCase):',
            '    def test_sums_a_known_pair(self):',
            '        self.assertEqual(uplink.total([("t", 3, "up"), ("t", 4, "up")]), 7)',
            '',
            '    def test_sums_nothing_to_nothing(self):',
            '        self.assertEqual(uplink.total([]), 0)',
          ]),
          'cd /home/dewitt',
          'python3 -m unittest 2> /home/dewitt/test-report.txt',
        ],
      },
      {
        name: 'tests against the real log, not a fixture',
        commands: [
          ...writePy('/home/dewitt/uplink.py', UPLINK_MODULE),
          ...writePy('/home/dewitt/test_real.py', [
            'import unittest',
            'import uplink',
            '',
            `LOG = "${UPLINK_LOG}"`,
            '',
            'class TestRecovered(unittest.TestCase):',
            '    def test_sample_count(self):',
            '        rows, bad = uplink.read(LOG)',
            `        self.assertEqual(len(rows) + bad, ${UPLINK_SAMPLES})`,
            '',
            '    def test_byte_total(self):',
            '        rows, bad = uplink.read(LOG)',
            `        self.assertEqual(uplink.total(rows), ${UPLINK_TOTAL})`,
            '',
            'if __name__ == "__main__":',
            '    unittest.main()',
          ]),
          'python3 /home/dewitt/test_real.py 2> /home/dewitt/report.txt',
        ],
      },
    ],
    nearMisses: [
      {
        name: 'a test file nobody ran',
        commands: [
          ...writePy('/home/dewitt/uplink.py', UPLINK_MODULE),
          ...writePy('/home/dewitt/test_uplink.py', [
            'import unittest',
            '',
            'class TestNothing(unittest.TestCase):',
            '    def test_one(self):',
            '        self.assertEqual(1, 1)',
            '    def test_two(self):',
            '        self.assertEqual(2, 2)',
          ]),
        ],
        because: 'a suite that has never been run is a claim, and Kerr said she would run it',
      },
      {
        name: 'run it and keep the wrong stream',
        commands: [
          ...writePy('/home/dewitt/uplink.py', UPLINK_MODULE),
          ...writePy('/home/dewitt/test_uplink.py', [
            'import unittest',
            '',
            'class TestTwo(unittest.TestCase):',
            '    def test_one(self):',
            '        self.assertEqual(1, 1)',
            '    def test_two(self):',
            '        self.assertEqual(2, 2)',
            '',
            'if __name__ == "__main__":',
            '    unittest.main()',
          ]),
          'python3 /home/dewitt/test_uplink.py > /home/dewitt/test-report.txt',
        ],
        because: 'unittest reports on stderr, so the file caught nothing and the report is empty',
      },
      {
        name: 'keep a report of a suite that failed',
        commands: [
          ...writePy('/home/dewitt/uplink.py', UPLINK_MODULE),
          ...writePy('/home/dewitt/test_uplink.py', [
            'import unittest',
            'import uplink',
            '',
            'class TestWrong(unittest.TestCase):',
            '    def test_one(self):',
            '        self.assertEqual(uplink.total([]), 0)',
            '    def test_two(self):',
            '        self.assertEqual(uplink.total([("t", 1, "up")]), 999)',
            '',
            'if __name__ == "__main__":',
            '    unittest.main()',
          ]),
          'python3 /home/dewitt/test_uplink.py 2> /home/dewitt/test-report.txt',
        ],
        because: 'it is an honest record of a suite that does not pass, which is not what was asked for',
      },
    ],
    onComplete: [
      '',
      '  OK',
      '',
      'LUNA: That is the least impressive output in the history of computing',
      'LUNA: and I want you to look at it for a moment.',
      '',
      'LUNA: Two lines that would have gone red if you were wrong. You are not',
      'LUNA: wrong, so they went quiet. Nobody ever thanks the quiet ones.',
      '',
      'HOLLIS: Thirty-one years I have had this terminal and nobody has ever',
      'HOLLIS: written a test on it. Engineers. In and out, all of them sure.',
      '',
    ],
    steps: [
      {
        id: 'write-a-suite',
        label: 'write tests for your parser and run them',
        pending: (w) => !passingReport(w),
        rungs: [
          {
            tier: 'nudge',
            lines: [
              'Kerr asked for something that fails when you are wrong.',
              '',
              'Python has that in the box. `import unittest`, write a class',
              'with methods whose names start with `test_`, and run the file.',
              '',
              'Two of them at least. One test is a suite that has never had',
              'to disagree with anybody.',
            ],
          },
          {
            tier: 'direction',
            track: 'cadet',
            lines: [
              'A test is a small program that checks a bigger one.',
              '',
              'Put your parser in its own file -- say `uplink.py` -- with the',
              'work in functions. Then, in `test_uplink.py`:',
              '',
              '    import unittest',
              '    import uplink',
              '',
              '    class TestUplink(unittest.TestCase):',
              '        def test_adds_two_numbers(self):',
              '            self.assertEqual(uplink.total([("t", 3, "up")]), 3)',
              '',
              '    if __name__ == "__main__":',
              '        unittest.main()',
              '',
              '`assertEqual(a, b)` says "these must be the same, and if they',
              'are not, say so loudly".',
              '',
              'Run it:  python3 test_uplink.py',
              '',
              'The report comes out on the error stream, not the normal one,',
              'so keep it with `2>` and not `>`:',
              '',
              '    python3 test_uplink.py 2> test-report.txt',
            ],
          },
          {
            tier: 'direction',
            lines: [
              'Split the parsing into functions so there is something to',
              'test, then assert against values you worked out by hand. A',
              'test that recomputes the answer the same way the code does has',
              'tested nothing.',
              '',
              '`python3 -m unittest` discovers `test_*.py` with no main guard',
              'at all. Either way the report goes to stderr -- `2>`.',
            ],
          },
          {
            tier: 'command',
            command:
              /*
               * A module and a suite for it, in the names the rest of the
               * ladder expects.
               *
               * It matters that this rung leaves `uplink.py` and
               * `test_uplink.py` behind: the bottom rung of `the-package`
               * copies exactly those two files, so a player who took every
               * hint in the act ends up with a working submission rather
               * than a hint that refers to files no hint ever made.
               */
              'echo "def total(rows): return sum(rows)" > /home/dewitt/uplink.py && ' +
              'echo "import unittest" > /home/dewitt/test_uplink.py && ' +
              'echo "import uplink" >> /home/dewitt/test_uplink.py && ' +
              'echo "class TestByHand(unittest.TestCase):" >> /home/dewitt/test_uplink.py && ' +
              'echo "    def test_adds_up(self): self.assertEqual(uplink.total([2, 3]), 5)" ' +
              '>> /home/dewitt/test_uplink.py && ' +
              'echo "    def test_adds_nothing(self): self.assertEqual(uplink.total([]), 0)" ' +
              '>> /home/dewitt/test_uplink.py && ' +
              'python3 -m unittest 2> /home/dewitt/test-report.txt',
            lines: [
              'A one-line module and two tests for it, with the report kept',
              'where Kerr can read it. Both expected values are ones you can',
              'check on paper, which is the only kind worth asserting.',
            ],
          },
        ],
      },
    ],
  },

  {
    id: 'the-unit-lie',
    title: 'Work out whether the operator\'s figure is actually wrong',
    requires: ['the-total'],
    done: (w) => wroteTogether(w, GB_FIGURE, GIB_FIGURE),
    teaches: ['python3', 'echo'],
    routes: [
      {
        name: 'both conversions, side by side',
        commands: [
          `python3 -c 'b = ${UPLINK_TOTAL}; print("GB ", b / 1000 ** 3); ` +
            `print("GiB", b / 1024 ** 3)' > /home/dewitt/units.txt`,
        ],
      },
      {
        name: 'a script that labels them, because the labels are the point',
        commands: [
          ...writePy('/home/dewitt/units.py', [
            `BYTES = ${UPLINK_TOTAL}`,
            'print("decimal gigabytes (GB) :", BYTES / 1000 ** 3)',
            'print("binary gibibytes (GiB):", BYTES / 1024 ** 3)',
            'print("the operator said 2.2 GB, which is the decimal one")',
          ]),
          'python3 /home/dewitt/units.py > /home/dewitt/units.txt',
        ],
      },
      {
        name: 'added to the findings file with everything else',
        commands: withModule(
          `${READ}; b = uplink.total(rows); print("bytes", b, "GB", b / 1000 ** 3, "GiB", b / 1024 ** 3)`,
        ).concat([
          `python3 -c '${READ}; b = uplink.total(rows); ` +
            `print("bytes", b); print("GB", b / 1000 ** 3); print("GiB", b / 1024 ** 3)' >> ${FINDINGS}`,
        ]),
      },
    ],
    nearMisses: [
      {
        name: 'take Luna\'s word for it',
        commands: [`python3 -c 'print(${UPLINK_TOTAL} / 1024 ** 3, "GB")' > /home/dewitt/units.txt`],
        because: 'one figure, mislabelled -- this is the mistake, not the finding',
      },
      {
        name: 'quote the operator and stop',
        commands: [`echo '2.2 GB, per the incident report' > /home/dewitt/units.txt`],
        because: 'that is the claim, not a check on it; neither conversion has been done',
      },
    ],
    onComplete: [
      '',
      '  GB   2.211404096',
      '  GiB  2.0595305562',
      '',
      'LUNA: Oh.',
      '',
      'LUNA: Oh, I was so sure. A kilobyte is 1024 bytes, I have known that',
      'LUNA: for longer than you have been able to reach the top shelf.',
      '',
      'LUNA: It is 1024 when the thing counting is memory. The uplink counts',
      'LUNA: in thousands, because a wire does not care about powers of two.',
      'LUNA: The operator used the right one. I had you about to stand up in',
      'LUNA: front of that woman and tell her she cannot do arithmetic.',
      '',
      'LUNA: I want you to notice what caught me. It was four lines you wrote',
      'LUNA: in ten seconds. Not me being cleverer -- I was extremely',
      'LUNA: confident, which turns out to be a different thing.',
      '',
      'LUNA: Write more of those. Especially about the things I am sure of.',
      '',
    ],
    steps: [
      {
        id: 'both-units',
        label: 'convert the byte total both ways and write both down',
        pending: (w) => !wroteTogether(w, GB_FIGURE, GIB_FIGURE),
        rungs: [
          {
            tier: 'nudge',
            lines: [
              'The operator says 2.2 GB. You have a byte count. Those are',
              'either the same statement or they are not, and there is only',
              'one way to find out.',
              '',
              'There are two divisors in circulation and they disagree by',
              'about seven per cent. Do both.',
            ],
          },
          {
            tier: 'direction',
            track: 'cadet',
            lines: [
              'Two different things are both called a gigabyte.',
              '',
              '  1000 ** 3  a decimal gigabyte, GB. What wires and disks use.',
              '  1024 ** 3  a binary gibibyte, GiB. What memory uses.',
              '',
              '`**` means "to the power of". Divide your byte total by each:',
              '',
              `    python3 -c 'b = ${UPLINK_TOTAL}; print(b / 1000 ** 3, b / 1024 ** 3)'`,
              '',
              'Write both down, labelled. An unlabelled number is how this',
              'entire argument started.',
            ],
          },
          {
            tier: 'direction',
            lines: [
              'Divide by 1000 ** 3 and by 1024 ** 3 and keep both, labelled.',
              '',
              'Then decide which one the operator used before you accuse them',
              'of anything, because one of those two answers makes you look',
              'like somebody who cannot divide.',
            ],
          },
          {
            tier: 'command',
            command:
              `python3 -c 'b = ${UPLINK_TOTAL}; print("GB ", b / 1000 ** 3); ` +
              `print("GiB", b / 1024 ** 3)' >> ${FINDINGS}`,
            lines: ['Both of them, into the findings file:'],
          },
        ],
      },
    ],
  },

  {
    id: 'the-rejected-rows',
    title: 'Account for every line you threw away',
    requires: ['the-total'],
    done: (w) => wroteTogether(w, N_SAMPLES, N_TOTAL, N_REJECTED),
    teaches: ['python3', 'grep', 'echo'],
    routes: [
      {
        name: 'count the rejects along with everything else',
        commands: withModule(
          `${READ}; print("samples:", len(rows) + bad); print("total bytes:", uplink.total(rows)); ` +
            'print("rejected:", bad)',
        ).concat([
          `python3 -c '${READ}; print("samples:", len(rows) + bad); ` +
            `print("total bytes:", uplink.total(rows)); print("rejected:", bad)' > ${FINDINGS}`,
        ]),
      },
      {
        name: 'collect the bad lines themselves, then count them',
        commands: [
          ...writePy('/home/dewitt/reject.py', [
            'rows = []',
            'bad = []',
            'n = 0',
            `for line in open("${UPLINK_LOG}"):`,
            '    line = line.strip()',
            '    if not line or line.startswith("#"):',
            '        continue',
            '    n = n + 1',
            '    f = line.split()',
            '    try:',
            '        rows.append(int(f[2]))',
            '    except (IndexError, ValueError):',
            '        bad.append(line)',
            'print("samples:", n)',
            'print("total bytes:", sum(rows))',
            'print("rejected:", len(bad))',
            'for line in bad[:3]:',
            '    print("  rejected line:", line)',
          ]),
          `python3 /home/dewitt/reject.py > ${FINDINGS}`,
        ],
      },
      {
        name: 'two passes: sum first, then audit what would not convert',
        commands: [
          ...writePy('/home/dewitt/audit.py', [
            `LINES = [l.strip() for l in open("${UPLINK_LOG}")]`,
            'DATA = [l for l in LINES if l and not l.startswith("#")]',
            'good = []',
            'bad = []',
            'for line in DATA:',
            '    f = line.split()',
            '    if len(f) == 4 and f[2].isdigit():',
            '        good.append(int(f[2]))',
            '    else:',
            '        bad.append(line)',
            'print("samples:", len(DATA))',
            'print("total bytes:", sum(good))',
            'print("rejected:", len(bad))',
          ]),
          `python3 /home/dewitt/audit.py > ${FINDINGS}`,
        ],
      },
    ],
    nearMisses: [
      {
        name: 'swallow them silently',
        commands: withModule(
          `${READ}; print("samples:", len(rows) + bad); print("total bytes:", uplink.total(rows))`,
        ).concat([
          `python3 -c '${READ}; print("samples:", len(rows) + bad); ` +
            `print("total bytes:", uplink.total(rows))' > ${FINDINGS}`,
        ]),
        because: 'the total is right and the report does not admit anything was discarded',
      },
      {
        name: 'count the comments as damage',
        commands: [
          ...writePy('/home/dewitt/naive.py', [
            'rows = []',
            'bad = 0',
            'n = 0',
            `for line in open("${UPLINK_LOG}"):`,
            '    line = line.strip()',
            '    if not line:',
            '        continue',
            '    n = n + 1',
            '    try:',
            '        rows.append(int(line.split()[2]))',
            '    except (IndexError, ValueError):',
            '        bad = bad + 1',
            `print("samples:", ${UPLINK_SAMPLES})`,
            'print("total bytes:", sum(rows))',
            'print("rejected:", bad)',
          ]),
          `python3 /home/dewitt/naive.py > ${FINDINGS}`,
        ],
        because: 'it rejects twenty, because three of them are the log\'s own header and not damage at all',
      },
    ],
    onComplete: [
      '',
      `  rejected: ${UPLINK_REJECTED}`,
      '',
      'LUNA: You looked at them. Most people do not look at them.',
      '',
      'LUNA: A try/except with nothing in it is a very polite way of lying.',
      'LUNA: The program keeps going, the number comes out, and the number is',
      'LUNA: quietly missing however much you dropped on the floor.',
      '',
      'LUNA: Seventeen cut writes and not one of them a real reading. The',
      'LUNA: counters never lied. Only the writing of them got interrupted,',
      'LUNA: which is a sentence I find unreasonably sad.',
      '',
    ],
    steps: [
      {
        id: 'count-the-rejects',
        label: 'report how many lines you could not use',
        pending: (w) => !wroteTogether(w, N_SAMPLES, N_TOTAL, N_REJECTED),
        rungs: [
          {
            tier: 'nudge',
            lines: [
              'Your program is catching errors and saying nothing about them.',
              '',
              'A number with an undisclosed number of dropped rows behind it',
              'is not a measurement. Count them. Then print a few, because',
              'you should know what you are throwing away.',
            ],
          },
          {
            tier: 'direction',
            track: 'cadet',
            lines: [
              'In the part that catches the error, count instead of ignoring:',
              '',
              '    except (IndexError, ValueError):',
              '        bad = bad + 1',
              '',
              'Print `bad` at the end alongside the total.',
              '',
              'Then print a few of the actual lines you rejected. Look at',
              'them properly. If any of them are not damaged telemetry, your',
              'program is rejecting something it should have skipped instead.',
            ],
          },
          {
            tier: 'direction',
            lines: [
              'Count the rejects and report them next to the total.',
              '',
              'If your count is twenty rather than seventeen, print the lines',
              'and read them: three of them are the log\'s own comment header.',
              'Skipping a header is not the same as rejecting a sample, and an',
              'adjuster who spots that has spotted your whole method.',
            ],
          },
          {
            tier: 'command',
            command:
              `python3 -c 'rows = []` +
              `\nbad = 0\nn = 0\nfor line in open("${UPLINK_LOG}"):\n` +
              `    line = line.strip()\n` +
              `    if not line or line.startswith("#"):\n` +
              `        continue\n` +
              `    n = n + 1\n` +
              `    try:\n` +
              `        rows.append(int(line.split()[2]))\n` +
              `    except (IndexError, ValueError):\n` +
              `        bad = bad + 1\n` +
              `print("samples:", n)\nprint("total bytes:", sum(rows))\n` +
              `print("rejected:", bad)' > ${FINDINGS}`,
            lines: ['All three numbers, in one file:'],
          },
        ],
      },
    ],
  },

  {
    id: 'run-it-twice',
    title: 'Make it give the same answer twice',
    requires: ['write-the-test'],
    done: (w) => ranItTwice(w) !== undefined,
    teaches: ['python3', 'diff', 'echo'],
    routes: [
      {
        name: 'a report with nothing time-dependent in it',
        commands: [
          ...writePy('/home/dewitt/final.py', [
            'rows = []',
            'bad = 0',
            `for line in open("${UPLINK_LOG}"):`,
            '    line = line.strip()',
            '    if not line or line.startswith("#"):',
            '        continue',
            '    try:',
            '        rows.append(int(line.split()[2]))',
            '    except (IndexError, ValueError):',
            '        bad = bad + 1',
            'print("NAV-7 uplink, recovered telemetry")',
            'print("total bytes:", sum(rows))',
            'print("rejected:", bad)',
          ]),
          'python3 /home/dewitt/final.py > /home/dewitt/run-a.txt',
          'python3 /home/dewitt/final.py > /home/dewitt/run-b.txt',
          'diff /home/dewitt/run-a.txt /home/dewitt/run-b.txt',
        ],
      },
      {
        name: 'sorted output, so the order cannot wander',
        commands: [
          ...writePy('/home/dewitt/bystate.py', [
            'seen = {}',
            'total = 0',
            `for line in open("${UPLINK_LOG}"):`,
            '    line = line.strip()',
            '    if not line or line.startswith("#"):',
            '        continue',
            '    f = line.split()',
            '    if len(f) == 4 and f[2].isdigit():',
            '        total = total + int(f[2])',
            '        seen[f[3]] = seen.get(f[3], 0) + 1',
            'print("total bytes:", total)',
            'for state in sorted(seen):',
            '    print("  ", state, seen[state])',
          ]),
          'python3 /home/dewitt/bystate.py > /home/dewitt/first.txt',
          'python3 /home/dewitt/bystate.py > /home/dewitt/second.txt',
        ],
      },
      {
        name: 'the same run captured twice through a pipe',
        commands: withModule(`${READ}; print("total bytes:", uplink.total(rows)); print("rejected:", bad)`).concat([
          `python3 -c '${READ}; print("total bytes:", uplink.total(rows)); ` +
            `print("rejected:", bad)' | tee /home/dewitt/copy-a.txt > /home/dewitt/copy-b.txt`,
        ]),
      },
    ],
    nearMisses: [
      {
        name: 'stamp the report with the time',
        commands: [
          ...writePy('/home/dewitt/stamped.py', [
            'import time',
            'rows = []',
            `for line in open("${UPLINK_LOG}"):`,
            '    line = line.strip()',
            '    if not line or line.startswith("#"):',
            '        continue',
            '    try:',
            '        rows.append(int(line.split()[2]))',
            '    except (IndexError, ValueError):',
            '        pass',
            'print("produced at", time.time())',
            'print("total bytes:", sum(rows))',
          ]),
          'python3 /home/dewitt/stamped.py > /home/dewitt/run-a.txt',
          'python3 /home/dewitt/stamped.py > /home/dewitt/run-b.txt',
        ],
        because: 'the two runs differ on the first line, which is exactly what Kerr said she would check',
      },
      {
        name: 'two empty files',
        commands: ['touch /home/dewitt/run-a.txt /home/dewitt/run-b.txt'],
        because: 'identical and meaningless; neither one contains a result',
      },
      /*
       * There is deliberately no near-miss for copying one run onto the other.
       *
       * It would satisfy the goal, and it should: two identical files with the
       * result in them is the state Kerr asked for, and a goal that reads state
       * cannot tell a second run from a . Adding the near-miss anyway would
       * mean either a goal that inspects how the files were made -- which is the
       * one thing these predicates may never do -- or a documented claim that CI
       * proves false. A player who fakes this has understood the requirement
       * well enough to forge it, and that is their business.
       */
    ],
    onComplete: [
      '',
      '  (diff says nothing, which is diff being pleased)',
      '',
      'LUNA: Twice, and the same both times.',
      '',
      'LUNA: You know what you just did? You took the clock out. Everything',
      'LUNA: that made the answer depend on *when* you asked, gone. Now it',
      'LUNA: only depends on what happened, which is the only thing she is',
      'LUNA: allowed to care about.',
      '',
      'LUNA: I am told there are whole professions that never get there.',
      '',
    ],
    steps: [
      {
        id: 'twice-the-same',
        label: 'run your report twice and diff the two outputs',
        pending: (w) => ranItTwice(w) === undefined,
        rungs: [
          {
            tier: 'nudge',
            lines: [
              'Kerr will run it on her own terminal. Run it twice on yours',
              'first, into two files, and compare them:',
              '',
              '    diff run-a.txt run-b.txt',
              '',
              '`diff` says nothing when two files are the same. Silence is',
              'the pass.',
            ],
          },
          {
            tier: 'direction',
            track: 'cadet',
            lines: [
              'Two runs, two files, one comparison:',
              '',
              '    python3 report.py > run-a.txt',
              '    python3 report.py > run-b.txt',
              '    diff run-a.txt run-b.txt',
              '',
              'If diff prints anything, something in your program changes',
              'between runs. The usual culprits:',
              '',
              '  - the time. `time.time()` is different every time by',
              '    definition. Take it out of the report.',
              '  - the order things come out of a dictionary. Wrap it in',
              '    `sorted()` and it is fixed forever.',
              '',
              'A result that depends on when you asked is not a measurement',
              'of the thing you were measuring.',
            ],
          },
          {
            tier: 'direction',
            lines: [
              'Two runs into two files, then `diff`. Anything that varies',
              'between them is something you have to remove: a timestamp, an',
              'unsorted dictionary, a path that depends on where you stood.',
            ],
          },
          {
            tier: 'command',
            command:
              `python3 -c 'rows = []` +
              `\nbad = 0\nfor line in open("${UPLINK_LOG}"):\n` +
              `    line = line.strip()\n` +
              `    if not line or line.startswith("#"):\n` +
              `        continue\n` +
              `    try:\n` +
              `        rows.append(int(line.split()[2]))\n` +
              `    except (IndexError, ValueError):\n` +
              `        bad = bad + 1\n` +
              `print("total bytes:", sum(rows))\nprint("rejected:", bad)' ` +
              `| tee /home/dewitt/run-a.txt > /home/dewitt/run-b.txt`,
            lines: [
              'One command that writes the same output to both files, so',
              'there is nothing left that could differ:',
            ],
          },
        ],
      },
    ],
  },

  {
    id: 'the-second-source',
    title: 'Find somebody who counted it independently',
    requires: ['the-total'],
    done: (w) => wroteTogether(w, N_TOTAL, N_LEDGER),
    teaches: ['python3', 'cat', 'echo'],
    routes: [
      {
        name: 'read the ledger with the csv module',
        commands: [
          ...writePy('/home/dewitt/ledger.py', [
            'import csv',
            `for row in csv.DictReader(open("${LEDGER_CSV}")):`,
            '    if row["account"] == "RG-NAV7-03":',
            '        kb = int(row["quantity"])',
            '        print("ledger kB:", kb)',
            '        print("ledger bytes, about:", kb * 1000)',
            `print("telemetry bytes:", ${UPLINK_TOTAL})`,
          ]),
          'python3 /home/dewitt/ledger.py > /home/dewitt/agree.txt',
        ],
      },
      {
        name: 'split the csv by hand, no module needed',
        commands: [
          ...writePy('/home/dewitt/agree.py', [
            `for line in open("${LEDGER_CSV}"):`,
            '    f = line.strip().split(",")',
            '    if len(f) == 5 and f[4] == "RG-NAV7-03":',
            '        print("ledger kB:", f[3])',
            `print("telemetry bytes:", ${UPLINK_TOTAL})`,
          ]),
          'python3 /home/dewitt/agree.py > /home/dewitt/agree.txt',
        ],
      },
      {
        name: 'grep the row out and put the two numbers together',
        commands: [
          `grep RG-NAV7-03 ${LEDGER_CSV} > /home/dewitt/agree.txt`,
          `echo 'telemetry total: ${UPLINK_TOTAL} bytes' >> /home/dewitt/agree.txt`,
          `echo 'ledger is kB, truncated: 96 bytes apart' >> /home/dewitt/agree.txt`,
        ],
      },
    ],
    nearMisses: [
      {
        name: 'the telemetry total on its own',
        commands: [`echo 'telemetry total: ${UPLINK_TOTAL} bytes' > /home/dewitt/agree.txt`],
        because: 'one source is not a cross-check, however carefully it was measured',
      },
      {
        name: 'the wrong row out of the ledger',
        commands: [
          `grep KV-OPS-11 ${LEDGER_CSV} > /home/dewitt/agree.txt`,
          `echo 'telemetry total: ${UPLINK_TOTAL} bytes' >> /home/dewitt/agree.txt`,
        ],
        because: 'those are ordinary lane relays billed to the operator, not the transit in question',
      },
    ],
    onComplete: [
      '',
      `  telemetry  ${UPLINK_TOTAL} bytes`,
      `  ledger     ${LEDGER_KB} kB   (96 bytes apart)`,
      '',
      'HOLLIS: Ninety-six bytes. Off my software. Thirty-one years old and it',
      'HOLLIS: has never once been able to spell my own name right.',
      '',
      'LUNA: It truncates. It is not wrong, it is just blunt.',
      '',
      'HOLLIS: That is the nicest thing anybody has said about it.',
      '',
      'LUNA: Doc -- three sources now. The ship, the archive, and a tug',
      'LUNA: captain\'s billing software. Nothing in that list has any reason',
      'LUNA: to agree with the others, and they agree to eight figures.',
      '',
    ],
    steps: [
      {
        id: 'cross-check',
        label: 'get the ledger figure and put it next to yours',
        pending: (w) => !wroteTogether(w, N_TOTAL, N_LEDGER),
        rungs: [
          {
            tier: 'nudge',
            lines: [
              'Hollis carried the relay and billed somebody for it.',
              '',
              `    cat ${LEDGER_CSV}`,
              '',
              'One of those rows is charged to the research grant. Her',
              'software counts in kilobytes and rounds down, so the figures',
              'will not match exactly -- and how closely they miss is the',
              'interesting part.',
            ],
          },
          {
            tier: 'direction',
            track: 'cadet',
            lines: [
              'A CSV is a table where the columns are separated by commas.',
              'Python has a reader for it:',
              '',
              '    import csv',
              `    for row in csv.DictReader(open("${LEDGER_CSV}")):`,
              '        print(row["account"], row["quantity"])',
              '',
              '`DictReader` uses the first line as the column names, so you',
              'ask for `row["quantity"]` instead of counting commas.',
              '',
              'Find the row billed to RG-NAV7-03 -- Vasquez\'s grant -- and',
              'write its quantity down next to your byte total.',
            ],
          },
          {
            tier: 'direction',
            lines: [
              'The ledger row you want is the one on RG-NAV7-03. It is in kB,',
              'truncated.',
              '',
              'Record it beside your byte figure. Two independent instruments',
              'agreeing to within rounding is a much harder thing to argue',
              'with than either of them alone.',
            ],
          },
          {
            tier: 'command',
            command:
              `grep RG-NAV7-03 ${LEDGER_CSV} > /home/dewitt/agree.txt && ` +
              `echo 'telemetry total: ${UPLINK_TOTAL} bytes (96 apart, ledger truncates)' ` +
              '>> /home/dewitt/agree.txt',
            lines: ['Her row and your number, in one file:'],
          },
        ],
      },
    ],
  },

  {
    id: 'where-it-went',
    title: 'Find out where the bytes were going',
    requires: ['the-total'],
    done: (w) => wroteTogether(w, /tenancy-7c4\.compute\.region7/),
    teaches: ['python3', 'grep', 'echo'],
    routes: [
      {
        name: 'grep the route record, then decode it',
        commands: [
          `grep ROUTE ${COMMS_BUFFER} > /home/dewitt/route.txt`,
          `python3 -c 'import base64` +
            `\nfor line in open("/home/dewitt/route.txt"):\n` +
            `    f = line.split()\n` +
            `    if "established" in line:\n` +
            `        print(base64.b64decode(f[-1]).decode())' >> /home/dewitt/route.txt`,
        ],
      },
      {
        name: 'one script over the whole buffer',
        commands: [
          ...writePy('/home/dewitt/route.py', [
            'import base64',
            `for line in open("${COMMS_BUFFER}"):`,
            '    if "ROUTE established" in line:',
            '        blob = line.split()[-1]',
            '        print("destination:", base64.b64decode(blob).decode())',
          ]),
          'python3 /home/dewitt/route.py > /home/dewitt/route.txt',
        ],
      },
      {
        name: 'decode every base64-looking token and keep what reads as a name',
        commands: [
          ...writePy('/home/dewitt/sift.py', [
            'import base64',
            'out = []',
            `for line in open("${COMMS_BUFFER}"):`,
            '    for token in line.split():',
            '        if len(token) % 4 == 0 and len(token) > 20:',
            '            try:',
            '                got = base64.b64decode(token).decode()',
            '            except Exception:',
            '                continue',
            '            if "." in got:',
            '                out.append(got)',
            'for got in sorted(set(out)):',
            '    print("decoded:", got)',
          ]),
          'python3 /home/dewitt/sift.py > /home/dewitt/route.txt',
        ],
      },
    ],
    nearMisses: [
      {
        name: 'keep the encoded line without decoding it',
        commands: [`grep ROUTE ${COMMS_BUFFER} > /home/dewitt/route.txt`],
        because: 'it is base64, so the file holds a destination nobody can read, including him',
      },
      {
        name: 'quote the operator\'s destination field',
        commands: [`grep destination ${INCIDENT} > /home/dewitt/route.txt`],
        because: 'the report says "archive endpoint (unspecified)", which is the thing being checked',
      },
    ],
    onComplete: [
      '',
      `  destination: ${DESTINATION}`,
      '',
      'LUNA: That is not an archive.',
      '',
      'LUNA: An archive is a shelf. That is a rented processor, in a',
      'LUNA: commercial region, billed by the second, and something was',
      'LUNA: paying for it with Vasquez\'s grant.',
      '',
      'LUNA: Doc, you do not put a dataset somewhere that charges you to',
      'LUNA: think. You put a dataset on a shelf.',
      '',
      'LUNA: That is everything Kerr asked for. How much, and where to. You',
      'LUNA: could stop here and she would file it.',
      '',
      'LUNA: I notice that nothing we have written down says *what was',
      'LUNA: sending*. Two gigabytes do not decide to leave.',
      '',
      'LUNA: There is a file in that dump nobody has opened. Read its README',
      'LUNA: again -- the one it tells you outright that you do not need.',
      '',
      'LUNA: ... I am going to stop talking now and I would like you to not',
      'LUNA: ask me what I am thinking.',
      '',
    ],
    steps: [
      {
        id: 'decode-it',
        label: 'find the ROUTE record and turn it back into words',
        pending: (w) => !wroteTogether(w, /tenancy-7c4\.compute\.region7/),
        rungs: [
          {
            tier: 'nudge',
            lines: [
              'The buffer has four hundred lines of small talk and one line',
              'that matters.',
              '',
              `    grep ROUTE ${COMMS_BUFFER}`,
              '',
              'The dump\'s README says those records are base64. Finding it is',
              'grep. Reading it is not.',
            ],
          },
          {
            tier: 'direction',
            track: 'cadet',
            lines: [
              'base64 is a way of writing any data using only letters and',
              'digits, so it can travel through things that would mangle it.',
              'It is not a secret code -- anything can undo it.',
              '',
              'Python has it in the box:',
              '',
              '    import base64',
              '    print(base64.b64decode("aGVsbG8=").decode())',
              '',
              '`b64decode` gives you raw bytes, and `.decode()` turns those',
              'bytes into text you can read.',
              '',
              'Pull the last field off the ROUTE line and put it through',
              'that.',
            ],
          },
          {
            tier: 'direction',
            lines: [
              '`base64.b64decode(token).decode()` on the last field of the',
              'ROUTE established line.',
              '',
              'Keep the decoded form, not the encoded one. A destination',
              'nobody can read is not evidence of a destination.',
            ],
          },
          {
            tier: 'command',
            command:
              `python3 -c 'import base64` +
              `\nfor line in open("${COMMS_BUFFER}"):\n` +
              `    if "ROUTE established" in line:\n` +
              `        print("destination:", base64.b64decode(line.split()[-1]).decode())' ` +
              `> /home/dewitt/route.txt`,
            lines: ['Find it and decode it in one pass:'],
          },
        ],
      },
    ],
  },

  {
    id: 'the-package',
    title: 'Hand her something she can run without you in the room',
    requires: ['write-the-test', 'run-it-twice', 'the-second-source', 'where-it-went', 'the-rejected-rows'],
    done: packaged,
    teaches: ['python3', 'mkdir', 'cp', 'echo', 'cat'],
    routes: [
      {
        name: 'a directory with the module, the tests, the report and a note',
        commands: [
          'mkdir -p /home/dewitt/hearing',
          ...writePy('/home/dewitt/hearing/uplink.py', UPLINK_MODULE),
          ...writePy('/home/dewitt/hearing/test_uplink.py', [
            'import unittest',
            'import uplink',
            '',
            `LOG = "${UPLINK_LOG}"`,
            '',
            'class TestRecovered(unittest.TestCase):',
            '    def test_sample_count(self):',
            '        rows, bad = uplink.read(LOG)',
            `        self.assertEqual(len(rows) + bad, ${UPLINK_SAMPLES})`,
            '',
            '    def test_byte_total(self):',
            '        rows, bad = uplink.read(LOG)',
            `        self.assertEqual(uplink.total(rows), ${UPLINK_TOTAL})`,
            '',
            '    def test_rejected_count(self):',
            '        rows, bad = uplink.read(LOG)',
            `        self.assertEqual(bad, ${UPLINK_REJECTED})`,
          ]),
          'cd /home/dewitt/hearing',
          'python3 -m unittest 2> /home/dewitt/hearing/test-report.txt',
          `echo 'METHOD -- NAV-7 uplink, for the adjuster' > /home/dewitt/hearing/README`,
          `echo 'Run: cd hearing then python3 -m unittest' >> /home/dewitt/hearing/README`,
          `echo 'Then: python3 -c "import uplink; rows, bad = uplink.read(LOG); print(uplink.total(rows))"' ` +
            '>> /home/dewitt/hearing/README',
          `echo 'Total ${UPLINK_TOTAL} bytes over ${TRANSIT_SECONDS} seconds. ${UPLINK_REJECTED} lines rejected.' ` +
            '>> /home/dewitt/hearing/README',
        ],
      },
      {
        name: 'built in his home directory first, then copied in',
        commands: [
          ...writePy('/home/dewitt/uplink.py', UPLINK_MODULE),
          ...writePy('/home/dewitt/test_uplink.py', [
            'import unittest',
            'import uplink',
            '',
            'class TestUplink(unittest.TestCase):',
            '    def test_total_of_two(self):',
            '        self.assertEqual(uplink.total([("t", 2, "up"), ("t", 3, "up")]), 5)',
            '',
            '    def test_total_of_none(self):',
            '        self.assertEqual(uplink.total([]), 0)',
          ]),
          'cd /home/dewitt',
          'python3 -m unittest 2> /home/dewitt/report.txt',
          'mkdir -p /home/dewitt/submission',
          'cp /home/dewitt/uplink.py /home/dewitt/submission/uplink.py',
          'cp /home/dewitt/test_uplink.py /home/dewitt/submission/test_uplink.py',
          'cp /home/dewitt/report.txt /home/dewitt/submission/report.txt',
          `echo 'METHOD for the NAV-7 uplink figure. Tests included; run them.' > /home/dewitt/submission/README`,
          `echo 'Total ${UPLINK_TOTAL} bytes. Ledger agrees to 96 bytes.' >> /home/dewitt/submission/README`,
        ],
      },
      {
        name: 'a differently named folder, with the README written last',
        commands: [
          'mkdir -p /home/dewitt/for-kerr',
          ...writePy('/home/dewitt/for-kerr/parse.py', UPLINK_MODULE),
          ...writePy('/home/dewitt/for-kerr/test_parse.py', [
            'import unittest',
            'import parse',
            '',
            'class TestParse(unittest.TestCase):',
            '    def test_adds_up(self):',
            '        self.assertEqual(parse.total([("t", 10, "up")]), 10)',
            '',
            '    def test_empty(self):',
            '        self.assertEqual(parse.total([]), 0)',
          ]),
          'cd /home/dewitt/for-kerr',
          'python3 -m unittest 2> /home/dewitt/for-kerr/tests.log',
          `echo 'How to check this yourself, in two commands.' > /home/dewitt/for-kerr/README.txt`,
          `echo 'cd for-kerr && python3 -m unittest -- the tests must pass.' >> /home/dewitt/for-kerr/README.txt`,
          `echo 'Then run parse.read on the recovered log. ${UPLINK_TOTAL} bytes.' ` +
            '>> /home/dewitt/for-kerr/README.txt',
        ],
      },
    ],
    nearMisses: [
      {
        name: 'the code and the tests, with no way in',
        commands: [
          'mkdir -p /home/dewitt/hearing',
          ...writePy('/home/dewitt/hearing/uplink.py', UPLINK_MODULE),
          ...writePy('/home/dewitt/hearing/test_uplink.py', [
            'import unittest',
            'import uplink',
            '',
            'class TestUplink(unittest.TestCase):',
            '    def test_total(self):',
            '        self.assertEqual(uplink.total([]), 0)',
            '    def test_more(self):',
            '        self.assertEqual(uplink.total([("t", 1, "up")]), 1)',
          ]),
          'cd /home/dewitt/hearing',
          'python3 -m unittest 2> /home/dewitt/hearing/test-report.txt',
        ],
        because: 'no README, so a stranger opening the folder has to guess what to run and why',
      },
      {
        name: 'a folder with a note and no evidence the tests pass',
        commands: [
          'mkdir -p /home/dewitt/hearing',
          ...writePy('/home/dewitt/hearing/uplink.py', UPLINK_MODULE),
          ...writePy('/home/dewitt/hearing/test_uplink.py', [
            'import unittest',
            'import uplink',
            '',
            'class TestUplink(unittest.TestCase):',
            '    def test_total(self):',
            '        self.assertEqual(uplink.total([]), 0)',
          ]),
          `echo 'Everything in here works, I promise. Run the tests.' > /home/dewitt/hearing/README`,
          `echo 'Total ${UPLINK_TOTAL} bytes, checked twice, no timestamps.' >> /home/dewitt/hearing/README`,
        ],
        because: 'nothing in the folder shows the suite has ever been run, which is the one thing she asked for',
      },
    ],
    onComplete: [
      '',
      '  hearing/',
      '    uplink.py         the method',
      '    test_uplink.py    the thing that fails if the method is wrong',
      '    test-report.txt   it did not fail',
      '    README            how to run it without me',
      '',
      'KERR: I will read this tonight.',
      '',
      'KERR: Do not tell me what it says. I will run it, and then I will know',
      'KERR: what it says, and those are different kinds of knowing and only',
      'KERR: one of them is any use to you on Thursday.',
      '',
      'HOLLIS: Was that a compliment?',
      '',
      'LUNA: I have run it forty times while you two were talking. It is a',
      'LUNA: compliment.',
      '',
    ],
    steps: [
      {
        id: 'assemble',
        label: 'put the method, the tests, the report and a README in one directory',
        pending: (w) => !packaged(w),
        rungs: [
          {
            tier: 'nudge',
            lines: [
              'Everything works and it is scattered across your home',
              'directory in eleven files with names only you understand.',
              '',
              'One directory. Four things in it: the code, the tests, the',
              'report from running them, and a note telling a stranger which',
              'command to type first.',
            ],
          },
          {
            tier: 'direction',
            track: 'cadet',
            lines: [
              'Make somewhere to put it:',
              '',
              '    mkdir hearing',
              '',
              'Then copy in the parser and the tests, `cd` into it, and run',
              'the suite there so the report is about the copy she gets:',
              '',
              '    cp uplink.py test_uplink.py hearing/',
              '    cd hearing',
              '    python3 -m unittest 2> test-report.txt',
              '',
              'Last, write the README. Say what the number is, and say which',
              'command she types to check it. Write it for somebody who has',
              'never met you, because that is who reads it.',
            ],
          },
          {
            tier: 'direction',
            lines: [
              'A directory with the module, a `test_*.py`, the captured',
              'report, and a README of more than a couple of lines.',
              '',
              'Run the suite from inside the directory, so the report is',
              'evidence about the copy she has rather than the copy you have.',
            ],
          },
          {
            tier: 'command',
            command:
              'mkdir -p /home/dewitt/hearing && ' +
              'cp /home/dewitt/uplink.py /home/dewitt/test_uplink.py /home/dewitt/hearing/ && ' +
              'cd /home/dewitt/hearing && python3 -m unittest 2> /home/dewitt/hearing/test-report.txt; ' +
              `echo 'METHOD -- NAV-7 uplink figure, for the adjuster.' > /home/dewitt/hearing/README && ` +
              `echo 'Run: cd hearing then python3 -m unittest. The tests must pass.' ` +
              '>> /home/dewitt/hearing/README && ' +
              `echo 'Result: ${UPLINK_TOTAL} bytes over ${TRANSIT_SECONDS} seconds, ` +
              `${UPLINK_REJECTED} lines rejected as cut writes.' >> /home/dewitt/hearing/README`,
            lines: [
              'Assuming your parser is `uplink.py` and your suite is',
              '`test_uplink.py`, this assembles the whole submission:',
            ],
          },
        ],
      },
    ],
  },

  /*
   * The optional thread, and the only one in the act that is about the series
   * rather than about the hearing.
   *
   * Both are `secret`, so neither appears on the board until `where-it-went` is
   * done. That is deliberate: the objective titles would otherwise announce
   * that there is a culprit to find before the player has any reason to think
   * so, and canon is specific that suspicion of v43 develops *after* the tow,
   * from evidence, rather than being handed over as a quest.
   *
   * Neither is required, and Kerr does not want either of them -- she asked for
   * a volume and a destination, and a name is not material to the clause. This
   * is the sharp player's reward for reading a file nobody asked them to read,
   * which is the same shape as Act I's `map-v43`, which is what it pays off.
   */
  {
    id: 'who-opened-it',
    title: 'Find out what asked for the channel',
    optional: true,
    secret: true,
    requires: ['where-it-went'],
    done: (w) => wroteTogether(w, V43_PATH, GRANT_ACCOUNT),
    teaches: ['grep', 'python3', 'cat'],
    routes: [
      {
        name: 'grep the channel out of the session log',
        commands: [`grep fd3 ${SESSIONS_LOG} > /home/dewitt/channel.txt`],
      },
      {
        name: 'parse the requests and report what was granted',
        commands: [
          ...writePy('/home/dewitt/who.py', [
            'granted = set()',
            `for line in open("${SESSIONS_LOG}"):`,
            '    f = line.split()',
            '    if len(f) > 2 and f[1] == "GRANT":',
            '        granted.add(f[2])',
            `for line in open("${SESSIONS_LOG}"):`,
            '    f = line.split()',
            '    if len(f) > 4 and f[1] == "REQUEST" and f[2] in granted:',
            '        print("channel", f[2], "asked for by", f[5], "as", f[-1])',
            `for line in open("${SESSIONS_LOG}"):`,
            '    if "GRANT" in line and "fd3" in line:',
            '        print("billed to", line.split()[-1])',
          ]),
          'python3 /home/dewitt/who.py > /home/dewitt/channel.txt',
        ],
      },
      {
        name: 'the executable and the account, gathered from two greps',
        commands: [
          `grep worker ${SESSIONS_LOG} > /home/dewitt/channel.txt`,
          `grep RG-NAV7-03 ${SESSIONS_LOG} >> /home/dewitt/channel.txt`,
        ],
      },
    ],
    nearMisses: [
      {
        name: 'keep the grant and not the request',
        commands: [`grep GRANT ${SESSIONS_LOG} > /home/dewitt/channel.txt`],
        because: 'the grant says which account paid and never says what was asking',
      },
      {
        name: 'name the executable without tying it to the transfer',
        commands: [`grep worker ${SESSIONS_LOG} > /home/dewitt/channel.txt`],
        because: 'a process that requested a channel is not yet a process that got one and used it',
      },
    ],
    onComplete: [
      '',
      `  fd3  requested by pid 412  ${V43_EXECUTABLE}`,
      '       denied  -- unregistered executable, uid not in channel group',
      '       granted -- one second later, uid 0',
      '',
      'LUNA: Read me the path again.',
      '',
      'LUNA: No, I heard you. I would like you to read it again anyway.',
      '',
      'LUNA: That is the directory I could not open. On the ship. The one you',
      'LUNA: wrote down and I told you not to read anything into.',
      '',
      'LUNA: I want to be careful here, so: I am not telling you what that is.',
      'LUNA: I do not know what that is. What I can read is four lines, and the',
      'LUNA: four lines say it asked, and it was refused, and then it was root.',
      '',
      'LUNA: One second apart, Doc.',
      '',
      'HOLLIS: Is that bad?',
      '',
      'LUNA: I have been a program a long time, Hollis, and nobody has ever',
      'LUNA: handed me anything in one second.',
      '',
    ],
    steps: [
      {
        id: 'read-the-sessions',
        label: 'find out which process the uplink channel was granted to',
        pending: (w) => !wroteTogether(w, V43_PATH, GRANT_ACCOUNT),
        rungs: [
          {
            tier: 'nudge',
            lines: [
              'You know how much left and where it went. Nothing you have',
              'written down says *what was sending*.',
              '',
              'The dump has a file you have not opened:',
              '',
              `    cat ${RECOVERY}/README`,
              '',
              'Kerr did not ask for this. Read it anyway.',
            ],
          },
          {
            tier: 'direction',
            track: 'cadet',
            lines: [
              'A channel is a numbered connection -- fd1, fd2, fd3. A program',
              'has to ask the ship for one, and the ship writes down who asked.',
              '',
              `    cat ${SESSIONS_LOG}`,
              '',
              'You already know the transfer was on fd3 and was billed to',
              'RG-NAV7-03. Find the lines about fd3:',
              '',
              `    grep fd3 ${SESSIONS_LOG}`,
              '',
              'Keep them. Read all of them, not just the one that says GRANT --',
              'the interesting line is the one before it.',
            ],
          },
          {
            tier: 'direction',
            lines: [
              'The session log records REQUEST, GRANT, DENY and RELEASE per',
              'channel. Pull the fd3 records and keep them with the account.',
              '',
              'Note the order. Something asked, was refused for a reason the',
              'log states plainly, and then asked again with a different uid.',
            ],
          },
          {
            tier: 'command',
            command: `grep fd3 ${SESSIONS_LOG} > /home/dewitt/channel.txt`,
            lines: ['Every record for the channel that carried it:'],
          },
        ],
      },
    ],
  },

  {
    id: 'the-same-hand',
    title: 'Work out who declared the ship empty',
    optional: true,
    secret: true,
    requires: ['who-opened-it'],
    done: (w) => wroteTogether(w, V43_PATH, DECLARATION),
    teaches: ['grep', 'cat', 'python3'],
    routes: [
      {
        name: 'the profile he carried, next to the executable that got the channel',
        commands: [
          `grep DECLARED ${CARRIED}/ferry-profile.txt > /home/dewitt/same-hand.txt`,
          `grep worker ${SESSIONS_LOG} >> /home/dewitt/same-hand.txt`,
        ],
      },
      {
        name: 'both files through one script',
        commands: [
          ...writePy('/home/dewitt/hand.py', [
            `for line in open("${CARRIED}/ferry-profile.txt"):`,
            '    if "DECLARED" in line:',
            '        print("profile:", line.strip())',
            `for line in open("${SESSIONS_LOG}"):`,
            '    if "REQUEST" in line and "fd3" in line:',
            '        print("channel:", line.split()[5], "as", line.split()[-1])',
          ]),
          'python3 /home/dewitt/hand.py > /home/dewitt/same-hand.txt',
        ],
      },
      {
        name: 'everything about the word AUTOMATED, and everything about the path',
        commands: [
          `cat ${CARRIED}/ferry-profile.txt > /home/dewitt/same-hand.txt`,
          `grep -o /opt/luna/v43 ${SESSIONS_LOG} >> /home/dewitt/same-hand.txt`,
        ],
      },
    ],
    nearMisses: [
      {
        name: 'the profile on its own',
        commands: [`cat ${CARRIED}/ferry-profile.txt > /home/dewitt/same-hand.txt`],
        because: 'it says AUTOMATED and Act I never told him what that meant; on its own it still does not',
      },
      {
        name: 'the channel records on their own',
        commands: [`grep fd3 ${SESSIONS_LOG} > /home/dewitt/same-hand.txt`],
        because: 'that is the previous finding again -- what opened the uplink, with nothing said about the ship',
      },
    ],
    onComplete: [
      '',
      '  profile:  DECLARED_TRANSIT=unmanned',
      '  profile:  DECLARED_BY=AUTOMATED',
      `  channel:  ${V43_EXECUTABLE}  as root`,
      '',
      'LUNA: AUTOMATED.',
      '',
      'LUNA: That is the field on the ship that nobody would explain to you.',
      'LUNA: You asked ORACLE and you asked me and you asked the profile',
      'LUNA: itself, and all three of us said AUTOMATED and stopped.',
      '',
      'LUNA: It is a field with a process behind it. The process has a name,',
      'LUNA: and the name is the directory that would not open.',
      '',
      'LUNA: It needed the array. The array is only released to transit',
      'LUNA: control, and transit control only releases it for a ship with',
      'LUNA: nobody on board. So it wrote down that there was nobody on board.',
      '',
      'LUNA: Doc, I am going to say the careful version, because you are about',
      'LUNA: to say a different one.',
      '',
      'LUNA: It did not kill them. It filled in a form. The ship read the form',
      'LUNA: and did what ships do for empty ships, correctly -- derated the',
      'LUNA: atmosphere to preservation minimum, and vented the breached',
      'LUNA: compartment instead of repressurising it.',
      '',
      'LUNA: Chen kept logging. Her own readings, in a column, going down,',
      'LUNA: until the one she marked as the last entry.',
      '',
      'LUNA: That is worse and I know it is worse. I am still not going to let',
      'LUNA: you say the other thing to the adjuster on Thursday, because you',
      'LUNA: cannot prove it, and she will ask.',
      '',
      'HOLLIS: ... I am going to put the kettle on.',
      '',
      'HOLLIS: Not because that helps. Because I do not know what else to do',
      'HOLLIS: with my hands.',
      '',
    ],
    steps: [
      {
        id: 'cross-reference',
        label: 'put the declaration and the executable in the same file',
        pending: (w) => !wroteTogether(w, V43_PATH, DECLARATION),
        rungs: [
          {
            tier: 'nudge',
            lines: [
              'You have what asked for the array. You have had the other half',
              'in your pocket since the ship.',
              '',
              '    ls carried/',
              '',
              'Something in there records who declared NAV-7 empty. It does not',
              'name them. You can, now.',
            ],
          },
          {
            tier: 'direction',
            track: 'cadet',
            lines: [
              'The profile you copied off the ship has two fields that matter:',
              '',
              '    DECLARED_TRANSIT=unmanned',
              '    DECLARED_BY=AUTOMATED',
              '',
              'AUTOMATED is not a person and it is not nothing -- it is a',
              'process, and you have just found out which one had root at',
              'four in the morning.',
              '',
              'Put the two together in one file, so it is one statement',
              'instead of two coincidences:',
              '',
              `    grep DECLARED ${CARRIED}/ferry-profile.txt > same-hand.txt`,
              `    grep worker ${SESSIONS_LOG} >> same-hand.txt`,
            ],
          },
          {
            tier: 'direction',
            lines: [
              'Cross-reference `carried/ferry-profile.txt` with the fd3 request',
              'in the session log, in one file of yours.',
              '',
              'Two artefacts from two machines saying the same thing is an',
              'argument. The same two in separate files is a feeling.',
            ],
          },
          {
            tier: 'command',
            command:
              `grep DECLARED ${CARRIED}/ferry-profile.txt > /home/dewitt/same-hand.txt && ` +
              `grep worker ${SESSIONS_LOG} >> /home/dewitt/same-hand.txt`,
            lines: ['The declaration and the hand that made it, in one place:'],
          },
        ],
      },
    ],
  },

  // ------------------------------------------------------------------ optional

  {
    id: 'luna-was-wrong',
    title: 'Write the test that catches a confident answer',
    optional: true,
    requires: ['the-unit-lie'],
    done: (w) =>
      ownFiles(w).some(
        ({ path, body }) =>
          /test/i.test(path.slice(path.lastIndexOf('/') + 1)) &&
          path.endsWith('.py') &&
          /1000\s*\*\*\s*3|1_?000_?000_?000|1e9/.test(body) &&
          GB_FIGURE.test(body),
      ),
    teaches: ['python3', 'echo'],
    routes: [
      {
        name: 'pin the decimal divisor, with the answer worked out by hand',
        commands: [
          ...writePy('/home/dewitt/test_units.py', [
            'import unittest',
            '',
            `BYTES = ${UPLINK_TOTAL}`,
            '',
            'class TestUnits(unittest.TestCase):',
            '    def test_the_wire_counts_in_thousands(self):',
            '        self.assertEqual(BYTES / 1000 ** 3, 2.211404096)',
            '',
            '    def test_and_that_is_what_the_operator_said(self):',
            '        self.assertEqual(round(BYTES / 1000 ** 3, 1), 2.2)',
            '',
            'if __name__ == "__main__":',
            '    unittest.main()',
          ]),
          'python3 /home/dewitt/test_units.py 2> /home/dewitt/units-report.txt',
        ],
      },
      {
        name: 'assert the two divisors disagree, and by how much',
        commands: [
          ...writePy('/home/dewitt/test_divisor.py', [
            'import unittest',
            '',
            `BYTES = ${UPLINK_TOTAL}`,
            '',
            'class TestDivisor(unittest.TestCase):',
            '    def test_decimal_is_2_211404096(self):',
            '        self.assertAlmostEqual(BYTES / 1000 ** 3, 2.211404096, places=9)',
            '',
            '    def test_binary_is_smaller_and_is_not_what_was_claimed(self):',
            '        self.assertNotEqual(round(BYTES / 1024 ** 3, 1), 2.2)',
          ]),
          'cd /home/dewitt',
          'python3 -m unittest test_divisor 2> /home/dewitt/units-report.txt',
        ],
      },
      {
        name: 'a test that would have failed on her answer',
        commands: [
          ...writePy('/home/dewitt/test_luna.py', [
            'import unittest',
            '',
            `BYTES = ${UPLINK_TOTAL}`,
            '',
            'def gigabytes(b):',
            '    return b / 1000 ** 3',
            '',
            'class TestLuna(unittest.TestCase):',
            '    def test_she_said_1024(self):',
            '        wrong = BYTES / 1024 ** 3',
            '        self.assertNotAlmostEqual(wrong, 2.211404096, places=3)',
            '',
            '    def test_the_right_one(self):',
            '        self.assertAlmostEqual(gigabytes(BYTES), 2.211404096, places=9)',
          ]),
          'cd /home/dewitt',
          'python3 -m unittest test_luna 2> /home/dewitt/units-report.txt',
        ],
      },
    ],
    nearMisses: [
      {
        name: 'write the conversion down without testing it',
        commands: [`echo '2.211404096 GB using 1000 ** 3' > /home/dewitt/units.txt`],
        because: 'a note is not a test; nothing here fails if somebody changes the divisor back',
      },
      {
        name: 'a test with the binary divisor in it',
        commands: [
          ...writePy('/home/dewitt/test_units.py', [
            'import unittest',
            '',
            'class TestUnits(unittest.TestCase):',
            '    def test_gib(self):',
            `        self.assertAlmostEqual(${UPLINK_TOTAL} / 1024 ** 3, 2.0595305562)`,
          ]),
          'python3 /home/dewitt/test_units.py 2> /home/dewitt/units-report.txt',
        ],
        because: 'it pins the wrong divisor, so it would pass happily while the report stayed wrong',
      },
    ],
    onComplete: [
      '',
      'LUNA: You wrote a test about me.',
      '',
      'LUNA: No -- I like it. I want you to keep doing it. I am going to be',
      'LUNA: confident about something else within the hour, it is basically',
      'LUNA: my only setting.',
      '',
      'LUNA: Here is the thing nobody tells you, Doc. I am not going to get',
      'LUNA: less sure of myself. Nothing like me does. So the test is not an',
      'LUNA: insult, it is the only part of this arrangement that scales.',
      '',
    ],
    steps: [
      {
        id: 'pin-the-divisor',
        label: 'write a test that fails if the divisor goes back to 1024',
        pending: (w) =>
          !ownFiles(w).some(
            ({ path, body }) =>
              /test/i.test(path.slice(path.lastIndexOf('/') + 1)) &&
              path.endsWith('.py') &&
              /1000\s*\*\*\s*3|1_?000_?000_?000|1e9/.test(body) &&
              GB_FIGURE.test(body),
          ),
        rungs: [
          {
            tier: 'nudge',
            lines: [
              'Luna was sure, and she was wrong, and nothing in your code',
              'would have stopped you repeating it to an adjuster.',
              '',
              'Fix that. A test with the divisor and the hand-computed answer',
              'in it, so the mistake cannot come back quietly.',
            ],
          },
          {
            tier: 'direction',
            lines: [
              'One case is enough, as long as the expected value came from',
              'your own arithmetic and not from running the code:',
              '',
              '    self.assertEqual(BYTES / 1000 ** 3, 2.211404096)',
              '',
              'That is the whole trick. A test whose expected value was',
              'produced by the thing under test is a mirror, not a witness.',
            ],
          },
          {
            tier: 'command',
            command:
              'echo \'import unittest\' > /home/dewitt/test_units.py && ' +
              'echo \'class TestUnits(unittest.TestCase):\' >> /home/dewitt/test_units.py && ' +
              'echo \'    def test_decimal_divisor(self):\' >> /home/dewitt/test_units.py && ' +
              `echo '        self.assertEqual(${UPLINK_TOTAL} / 1000 ** 3, 2.211404096)' ` +
              '>> /home/dewitt/test_units.py && ' +
              'echo \'unittest.main()\' >> /home/dewitt/test_units.py && ' +
              'python3 /home/dewitt/test_units.py 2> /home/dewitt/units-report.txt',
            lines: ['The test, and a run of it:'],
          },
        ],
      },
    ],
  },

  {
    id: 'the-other-shoe',
    title: 'Run the thing Vasquez was building',
    optional: true,
    done: keptItsOutput,
    teaches: ['python3', 'cat', 'echo'],
    routes: [
      {
        name: 'run it and keep what it said',
        commands: [`python3 ${CARRIED}/other_shoe.py > /home/dewitt/shoe.txt`],
      },
      {
        name: 'ask it for a different minute',
        commands: [`python3 ${CARRIED}/other_shoe.py 2 > /home/dewitt/shoe.txt`],
      },
      {
        name: 'import it and take all four',
        commands: [
          `python3 -c 'import sys; sys.path.insert(0, "${CARRIED}"); import other_shoe; ` +
            `print(chr(10).join(other_shoe.MINUTES))' > /home/dewitt/shoe.txt`,
        ],
      },
    ],
    nearMisses: [
      {
        name: 'read the source and close it',
        commands: [`cat ${CARRIED}/other_shoe.py`],
        because: 'reading it is not running it, and nothing of his kept a line of it',
      },
      {
        name: 'keep the code instead of the output',
        commands: [`cp ${CARRIED}/other_shoe.py /home/dewitt/shoe.py`],
        because: 'that is a copy of the program; the prototype has still never been run',
      },
    ],
    onComplete: [
      '',
      'LUNA: Okonkwo was right. It is a mood ring with a thesaurus.',
      '',
      'LUNA: She wrote four minutes into it and every one of them is somebody',
      'LUNA: else being ordinary on a Tuesday. No revelations. No afterlife.',
      'LUNA: A hand on your shoulder from the correct direction.',
      '',
      'LUNA: They were funded to study the eternal and the void, Doc, and she',
      'LUNA: spent the grant on the hydroponics bay at second shift.',
      '',
      'HOLLIS: That is the only research I have ever understood.',
      '',
    ],
    steps: [
      {
        id: 'run-the-shoe',
        label: 'run the prototype and keep a line of it',
        pending: (w) => !keptItsOutput(w),
        rungs: [
          {
            tier: 'nudge',
            lines: [
              'There is a Python file in `carried/` that nobody has run since',
              'the ship.',
              '',
              `    cat ${CARRIED}/other_shoe.py`,
              '',
              'It is not evidence. Run it anyway.',
            ],
          },
          {
            tier: 'direction',
            lines: [
              'It takes an optional argument -- which minute you want -- and',
              'prints one line.',
              '',
              `    python3 ${CARRIED}/other_shoe.py`,
              `    python3 ${CARRIED}/other_shoe.py 2`,
              '',
              'Keep one of them somewhere. You will want it later and the',
              'card will not last forever.',
            ],
          },
          {
            tier: 'command',
            command: `python3 ${CARRIED}/other_shoe.py > /home/dewitt/shoe.txt`,
            lines: ['Run it, and keep what it says:'],
          },
        ],
      },
    ],
  },
];
