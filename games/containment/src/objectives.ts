import { ROOT_USER } from '@sigkill/machine';
import { asArt, type Objective, type World } from '@sigkill/quest';
import { DISCLOSURE, FINDINGS, HOME } from './act1/annexe.js';

/**
 * The spine of The Containment: nine objectives and two optional ones.
 *
 * Objectives four through nine are each the player computing one figure in
 * Python from the disclosure. The goals therefore check for the figure, in
 * whatever file the player chose to write it to -- the same rule as every act
 * since the Act I bug where a goal hard-coded a filename.
 *
 * What the goals deliberately do *not* do is check how it was computed. There
 * is no way to tell a mean from a lucky guess by looking at state, and a goal
 * that tried would be reading the command. The two objectives where the method
 * genuinely matters -- four and nine -- ask for a Python file as well as an
 * answer, which is the honest version: Kerr wants the thing that produced the
 * number, and a file on disk is that thing.
 */

/** Files the annexe seeded into the player's home. Not their work. */
const SEEDED = new Set([`${HOME}/README`, `${HOME}/KERR`]);

/** Everything the player has written, anywhere under home, lowercased. */
function written(w: World): string {
  const parts: string[] = [];
  const walk = (dir: string): void => {
    let names: string[];
    try {
      names = w.vfs.readdir(dir, ROOT_USER);
    } catch {
      return;
    }
    for (const name of names) {
      const path = `${dir}/${name}`.replace(/\/+/g, '/');
      let kind: string;
      try {
        kind = w.vfs.lstat(path, ROOT_USER).kind;
      } catch {
        continue;
      }
      if (kind === 'dir') walk(path);
      else if (kind === 'file' && !SEEDED.has(path)) {
        try {
          parts.push(w.vfs.readText(path, ROOT_USER));
        } catch {
          // Unreadable. Not a finding.
        }
      }
    }
  };
  walk(HOME);
  return parts.join('\n').toLowerCase();
}

/** A Python file of the player's own, mentioning something relevant. */
function wrotePython(w: World, about: RegExp): boolean {
  const found: string[] = [];
  const walk = (dir: string): void => {
    let names: string[];
    try {
      names = w.vfs.readdir(dir, ROOT_USER);
    } catch {
      return;
    }
    for (const name of names) {
      const path = `${dir}/${name}`.replace(/\/+/g, '/');
      try {
        if (w.vfs.lstat(path, ROOT_USER).kind === 'dir') walk(path);
        else if (path.endsWith('.py')) found.push(w.vfs.readText(path, ROOT_USER));
      } catch {
        continue;
      }
    }
  };
  walk(HOME);
  return found.some((body) => about.test(body));
}

/** Build a Python file line by line, which is how the shell aboard does it. */
const script = (path: string, body: readonly string[]): string[] =>
  body.map((line, i) => `echo '${line}' ${i === 0 ? '>' : '>>'} ${path}`);

const ACCURACY = [
  'import csv',
  `rows = list(csv.DictReader(open("${DISCLOSURE}/labels.csv")))`,
  'right = sum(1 for r in rows if r["truth"] == r["predicted"])',
  'print(round(100.0 * right / len(rows), 1))',
];

const BASE_RATE = [
  'import csv',
  `rows = list(csv.DictReader(open("${DISCLOSURE}/test.csv")))`,
  'ab = sum(1 for r in rows if r["label"] == "abandoned")',
  'print(round(100.0 * ab / len(rows), 1))',
];

const LEAK = [
  'import csv',
  `tr = {r["id"] for r in csv.DictReader(open("${DISCLOSURE}/train.csv"))}`,
  `te = {r["id"] for r in csv.DictReader(open("${DISCLOSURE}/test.csv"))}`,
  'print("in both train and test:", len(tr & te))',
];

const MATRIX = [
  'import csv',
  `rows = list(csv.DictReader(open("${DISCLOSURE}/labels.csv")))`,
  'def n(t, p): return sum(1 for r in rows if r["truth"] == t and r["predicted"] == p)',
  'print("abandoned/abandoned", n("abandoned", "abandoned"))',
  'print("crewed/crewed", n("crewed", "crewed"))',
  'print("crewed/abandoned", n("crewed", "abandoned"))',
  'print("abandoned/crewed", n("abandoned", "crewed"))',
];

const CONFIDENCE = [
  'import csv',
  `rows = list(csv.DictReader(open("${DISCLOSURE}/labels.csv")))`,
  'bad = [float(r["confidence"]) for r in rows if r["truth"] != r["predicted"]]',
  'print("confidence when wrong", round(sum(bad) / len(bad), 4))',
];

const BALANCED = [
  'import csv',
  `rows = list(csv.DictReader(open("${DISCLOSURE}/labels.csv")))`,
  'def recall(t): ',
  '    sel = [r for r in rows if r["truth"] == t]',
  '    return sum(1 for r in sel if r["predicted"] == t) / len(sel)',
  'print("balanced", round(100.0 * (recall("abandoned") + recall("crewed")) / 2, 1))',
];

export const CONTAINMENT_OBJECTIVES: readonly Objective[] = [
  // ------------------------------------------------------------------------ 1
  {
    id: 'what-it-was-asked',
    title: 'Record the exact filing the determination was made from',
    teaches: ['cat', 'model', 'grep'],
    done: (w) => {
      const text = written(w);
      return text.includes('priv') && text.includes('research');
    },
    steps: [
      {
        id: 'find-the-row',
        label: 'Find the row, and keep it',
        pending: (w) => !(written(w).includes('priv') && written(w).includes('research')),
        rungs: [
          {
            tier: 'nudge',
            lines: [
              'One determination, on one morning, from one row. Before you ask',
              'whether the model is any good, establish what it was shown.',
            ],
          },
          { tier: 'direction', lines: ['The disclosure has it as its own file. Read the whole thing.'] },
          {
            tier: 'command',
            lines: ['Keep it:'],
            command: `cat ${DISCLOSURE}/NAV7.row > ${FINDINGS}/row`,
          },
        ],
      },
    ],
    routes: [
      { name: 'copy the row into findings', commands: [`cat ${DISCLOSURE}/NAV7.row > ${FINDINGS}/row`] },
      {
        name: 'grep the fields out of it',
        commands: [
          `grep -i nav ${DISCLOSURE}/NAV7.row > ${HOME}/notes`,
          `grep -i research ${DISCLOSURE}/NAV7.row >> ${HOME}/notes`,
        ],
      },
      {
        name: 'read it and note what the model makes of it',
        commands: [
          `cp ${DISCLOSURE}/NAV7.row ${HOME}/row.txt`,
          `model classify vessel filing research grant priv seven >> ${HOME}/row.txt`,
        ],
      },
    ],
    nearMisses: [
      {
        name: 'the vendor report instead of the row',
        because:
          'The report is what they concluded. The row is what the model was given, and the act is about the difference.',
        commands: [`cat ${DISCLOSURE}/report.md > ${FINDINGS}/row`],
      },
      {
        name: 'reading it without keeping it',
        because: 'Kerr reads files, not your terminal. A finding that exists only on screen is not a finding.',
        commands: [`cat ${DISCLOSURE}/NAV7.row`],
      },
    ],
    onComplete: [
      "",
      "LUNA: Five fields. Not one asks whether anyone is aboard.",
      "LUNA: Someone decided what a vessel looks like on a form. We were outside it.",
      "",
    ],
  },

  // ------------------------------------------------------------------------ 2
  {
    id: 'a-token-is-a-number',
    title: 'Show what the model actually received',
    teaches: ['model', 'cat'],
    requires: ['what-it-was-asked'],
    done: (w) => {
      const text = written(w);
      return text.includes('<unk>') && /\[\s*\d+/.test(text);
    },
    steps: [
      {
        id: 'tokenise',
        label: 'Turn the row into what the model sees',
        pending: (w) => !(written(w).includes('<unk>') && /\[\s*\d+/.test(written(w))),
        rungs: [
          {
            tier: 'nudge',
            lines: [
              'It did not read that row. It read a list of integers, and the',
              'list is shorter than the row.',
            ],
          },
          { tier: 'direction', lines: ['`model tokens <text>` shows exactly what went in. `model vocab` is the table.'] },
          {
            tier: 'command',
            lines: ['Tokenise the filing and keep it:'],
            command: `model tokens vessel filing research grant priv seven > ${FINDINGS}/tokens`,
          },
        ],
      },
    ],
    routes: [
      {
        name: 'tokenise the filing',
        commands: [`model tokens vessel filing research grant priv seven > ${FINDINGS}/tokens`],
      },
      {
        name: 'the vocabulary alongside the tokens',
        commands: [
          `model vocab > ${HOME}/vocab-seen`,
          `model tokens research grant priv seven >> ${HOME}/vocab-seen`,
        ],
      },
      {
        name: 'tokens appended to the row already kept',
        commands: [
          `cat ${DISCLOSURE}/NAV7.row > ${HOME}/work`,
          `model tokens filing research grant priv seven >> ${HOME}/work`,
        ],
      },
    ],
    nearMisses: [
      {
        name: 'the vocabulary on its own',
        because:
          'The table is what it could know. The token list is what it was told, and they are not the same document.',
        commands: [`model vocab > ${FINDINGS}/tokens`],
      },
      {
        name: 'the classification instead of the input',
        because: 'This objective is about the input. Its answer is the next question, not this one.',
        commands: [`model classify research grant priv seven > ${FINDINGS}/tokens`],
      },
    ],
    onComplete: [
      "",
      "LUNA: PRIV-7 becomes priv and an unknown token.",
      "LUNA: Our grant code, translated into a shrug.",
      "",
    ],
  },

  // ------------------------------------------------------------------------ 3
  {
    id: 'look-inside',
    title: 'Name the column the decision actually rides on',
    teaches: ['model', 'output redirection'],
    requires: ['a-token-is-a-number'],
    done: (w) => {
      const text = written(w);
      return text.includes('tender') && /attention|head|position/.test(text);
    },
    steps: [
      {
        id: 'draw-it',
        label: 'Look at where it looked',
        pending: (w) => !/attention|head|position/.test(written(w)),
        rungs: [
          {
            tier: 'nudge',
            lines: [
              'It is a glass box. You can see which part of the input each head',
              'was reading when it decided.',
            ],
          },
          {
            tier: 'direction',
            lines: [
              '`model attention <text>` draws it. One row per position, darkest',
              'where the weight went. Then change one field and draw it again.',
            ],
          },
          {
            tier: 'command',
            lines: ['Draw it and keep the picture:'],
            command: `model attention vessel filing tender grant none > ${FINDINGS}/attention`,
          },
        ],
      },
    ],
    routes: [
      {
        name: 'draw the attention matrix on a tender',
        commands: [`model attention vessel filing tender grant none > ${FINDINGS}/attention`],
      },
      {
        name: 'the same row twice, differing in the vessel type alone',
        commands: [
          `model attention vessel filing tender grant none > ${HOME}/compare`,
          `model classify vessel filing tender grant none >> ${HOME}/compare`,
          `model classify vessel filing research grant priv seven >> ${HOME}/compare`,
        ],
      },
      {
        name: 'attention appended to the token work',
        commands: [
          `model tokens filing tender vessel > ${HOME}/inside`,
          `model attention filing tender vessel >> ${HOME}/inside`,
        ],
      },
    ],
    nearMisses: [
      {
        name: 'the model card',
        because:
          'The card is what it says about itself, and it says its limitations are none. The attention is what it does.',
        commands: [`model card > ${FINDINGS}/attention`],
      },
      {
        name: 'the verdict without the mechanism',
        because:
          'That it answers confidently is not a finding. Which column it read to get there is.',
        commands: [`model classify vessel filing tender grant none > ${FINDINGS}/attention`],
      },
    ],
    onComplete: [
      "",
      "LUNA: It attends to vessel type. Tenders were always crewed in its examples.",
      "LUNA: In this model, research vessels never get that answer. NAV-7 included.",
      "",
    ],
  },

  // ------------------------------------------------------------------------ 4
  {
    id: 'the-number-they-quoted',
    title: 'Reproduce the 99.2% yourself, from their own split',
    teaches: ['python3', 'the csv module'],
    requires: ['look-inside'],
    done: (w) =>
      written(w).includes('99.2') && wrotePython(w, /labels|predicted|truth/i),
    steps: [
      {
        id: 'reproduce',
        label: 'Get their number out of their own file',
        pending: (w) => !written(w).includes('99.2'),
        rungs: [
          {
            tier: 'nudge',
            lines: [
              'Three filings quote 99.2%. Before you argue with it, get it --',
              'from the scored output, yourself.',
            ],
          },
          {
            tier: 'direction',
            lines: [
              'labels.csv has the truth and the prediction for all five hundred.',
              'Count the rows where they agree.',
            ],
          },
          {
            tier: 'command',
            lines: ['Four lines of Python:'],
            command: `${script(`${HOME}/acc.py`, ACCURACY).join(' && ')} && python3 ${HOME}/acc.py > ${FINDINGS}/accuracy`,
          },
        ],
      },
      {
        id: 'keep-the-method',
        label: 'Keep the script, not just the answer',
        pending: (w) => !wrotePython(w, /labels|predicted|truth/i),
        rungs: [
          {
            tier: 'nudge',
            lines: [
              'Kerr does not want the number. She wants the thing that produced',
              'it, and she has wanted that since the last game.',
            ],
          },
          { tier: 'direction', lines: ['Leave the script on disk. A finding she cannot re-run is an assertion.'] },
          {
            tier: 'command',
            lines: ['Write it to a file rather than a one-liner:'],
            command: script(`${HOME}/acc.py`, ACCURACY).join(' && '),
          },
        ],
      },
    ],
    routes: [
      {
        name: 'a script, run into findings',
        commands: [...script(`${HOME}/acc.py`, ACCURACY), `python3 ${HOME}/acc.py > ${FINDINGS}/accuracy`],
      },
      {
        name: 'the same script, teed into a worklog',
        commands: [
          ...script(`${HOME}/accuracy.py`, ACCURACY),
          `python3 ${HOME}/accuracy.py | tee -a ${HOME}/worklog`,
        ],
      },
      {
        name: 'counted as a percentage of agreements, script kept beside it',
        commands: [
          ...script(`${HOME}/truth.py`, ACCURACY),
          `python3 ${HOME}/truth.py > ${HOME}/answer`,
          `cat ${HOME}/answer >> ${FINDINGS}/accuracy`,
        ],
      },
    ],
    nearMisses: [
      {
        name: 'quoting the report',
        because:
          'Copying their number proves you can read. Reproducing it proves the number is real, which is what lets you then show it is useless.',
        commands: [`grep -i accuracy ${DISCLOSURE}/report.md > ${FINDINGS}/accuracy`],
      },
      {
        name: 'the answer with no script behind it',
        because: 'Kerr wants the thing that produced the answer. A number she cannot re-run is an assertion.',
        commands: [`echo "99.2" > ${FINDINGS}/accuracy`],
      },
    ],
    onComplete: [
      "",
      "LUNA: 99.2 percent. You reproduced it.",
      "LUNA: Now give that number something to compete against.",
      "",
    ],
  },

  // ------------------------------------------------------------------------ 5
  {
    id: 'the-base-rate',
    title: 'Find out what "always say abandoned" would have scored',
    teaches: ['python3', 'the csv module'],
    requires: ['the-number-they-quoted'],
    done: (w) => written(w).includes('98.8'),
    steps: [
      {
        id: 'count-the-labels',
        label: 'Count how many were abandoned anyway',
        pending: (w) => !written(w).includes('98.8'),
        rungs: [
          {
            tier: 'nudge',
            lines: [
              'A model that is right 99.2% of the time sounds good. Compared to',
              'what?',
              '',
              'Write the stupidest possible model: one that ignores the input',
              'and always gives the same answer. Score that.',
            ],
          },
          {
            tier: 'direction',
            lines: [
              'test.csv has the true label for all five hundred. What fraction',
              'of them are abandoned? That is what guessing would get you.',
            ],
          },
          {
            tier: 'command',
            lines: ['Four more lines:'],
            command: `${script(`${HOME}/base.py`, BASE_RATE).join(' && ')} && python3 ${HOME}/base.py > ${FINDINGS}/base-rate`,
          },
        ],
      },
    ],
    routes: [
      {
        name: 'the base rate from the labels',
        commands: [...script(`${HOME}/base.py`, BASE_RATE), `python3 ${HOME}/base.py > ${FINDINGS}/base-rate`],
      },
      {
        name: 'the same, as a one-liner',
        commands: [
          `python3 -c "import csv; rows=list(csv.DictReader(open('${DISCLOSURE}/test.csv'))); print(round(100.0*sum(1 for r in rows if r['label']=='abandoned')/len(rows),1))" > ${FINDINGS}/base-rate`,
        ],
      },
      {
        name: 'counted with the shell and written up',
        commands: [
          `grep -c abandoned ${DISCLOSURE}/test.csv > ${HOME}/counts`,
          ...script(`${HOME}/base.py`, BASE_RATE),
          `python3 ${HOME}/base.py >> ${HOME}/counts`,
        ],
      },
    ],
    nearMisses: [
      {
        name: 'the count without the rate',
        because:
          'Four hundred and ninety-four is a number of ships. The comparison only lands as a percentage next to theirs.',
        commands: [`grep -c abandoned ${DISCLOSURE}/test.csv > ${FINDINGS}/base-rate`],
      },
      {
        name: 'the model accuracy again',
        because: 'That is the number you are comparing against, not the comparison.',
        commands: [...script(`${HOME}/acc.py`, ACCURACY), `python3 ${HOME}/acc.py > ${FINDINGS}/base-rate`],
      },
    ],
    onComplete: [
      "",
      "LUNA: Always say abandoned: 98.8 percent. Their model: 99.2.",
      "LUNA: Four tenths of a point. They put our ship on the difference.",
      "",
    ],
  },

  // ------------------------------------------------------------------------ 6
  {
    id: 'both-sides-of-the-split',
    title: 'Find how many records were scored against their own training data',
    teaches: ['python3', 'set intersection'],
    requires: ['the-base-rate'],
    done: (w) => {
      const text = written(w);
      /*
       * The count *and* something naming what was counted.
       *
       * `/41/` alone was satisfied for free: objective one has the player copy
       * NAV7.row into their home, `written()` aggregates everything there, and
       * that row carried `days_since_filing` = 41. So this objective completed
       * itself and announced the overlap without anybody intersecting the two
       * splits. The row is 37 now, and this goal also wants a word that only
       * appears if the player was actually comparing the files.
       */
      return /\b41\b/.test(text) && /overlap|intersect|both|train|leak|dedup/.test(text);
    },
    steps: [
      {
        id: 'intersect',
        label: 'Compare the two id lists',
        pending: (w) =>
          !(/\b41\b/.test(written(w)) && /overlap|intersect|both|train|leak|dedup/.test(written(w))),
        rungs: [
          {
            tier: 'nudge',
            lines: [
              'A held-out set is only held out if nothing in it was trained on.',
              'Oduya says the split came with the dataset and she did not check.',
              '',
              'Check.',
            ],
          },
          {
            tier: 'direction',
            lines: ['Both files have an id column. Put each in a set and intersect them.'] ,
          },
          {
            tier: 'command',
            lines: ['Four lines:'],
            command: `${script(`${HOME}/leak.py`, LEAK).join(' && ')} && python3 ${HOME}/leak.py > ${FINDINGS}/leak`,
          },
        ],
      },
    ],
    routes: [
      {
        name: 'set intersection of the two id columns',
        commands: [...script(`${HOME}/leak.py`, LEAK), `python3 ${HOME}/leak.py > ${FINDINGS}/leak`],
      },
      {
        name: 'the same, as a one-liner',
        commands: [
          `python3 -c "import csv; tr={r['id'] for r in csv.DictReader(open('${DISCLOSURE}/train.csv'))}; te={r['id'] for r in csv.DictReader(open('${DISCLOSURE}/test.csv'))}; print('overlap between train and test:', len(tr&te))" > ${FINDINGS}/leak`,
        ],
      },
      {
        name: 'the overlapping ids listed, then counted',
        commands: [
          `python3 -c "import csv; tr={r['id'] for r in csv.DictReader(open('${DISCLOSURE}/train.csv'))}; te={r['id'] for r in csv.DictReader(open('${DISCLOSURE}/test.csv'))}; print('ids in both train and test'); [print(i) for i in sorted(tr&te)]" > ${HOME}/overlap`,
          `wc -l ${HOME}/overlap >> ${HOME}/overlap`,
          ...script(`${HOME}/leak.py`, LEAK),
          `python3 ${HOME}/leak.py >> ${HOME}/overlap`,
        ],
      },
    ],
    nearMisses: [
      {
        name: 'the two file sizes',
        because:
          'Two thousand and five hundred are the sizes. Whether any record is in both is a different question and the only one that matters here.',
        commands: [`wc -l ${DISCLOSURE}/train.csv ${DISCLOSURE}/test.csv > ${FINDINGS}/leak`],
      },
      {
        name: "Oduya's own estimate, quoted",
        because:
          'She told you she did not check. Repeating her expectation is not checking it either, and she asked you not to take her word for it.',
        commands: [`grep -i overlap ${DISCLOSURE}/ODUYA > ${FINDINGS}/leak`],
      },
      {
        name: "NAV-7's row, which happens to contain a number",
        because:
          'A number that appears in a file you copied for a different objective is not a finding. This near-miss exists because the goal used to accept exactly that.',
        commands: [`cat ${DISCLOSURE}/NAV7.row > ${FINDINGS}/row`],
      },
    ],
    onComplete: [
      "",
      "LUNA: Forty-one test records were also training records.",
      "LUNA: Part of the exam came with answers.",
      "",
    ],
  },

  // ------------------------------------------------------------------------ 7
  {
    id: 'the-matrix',
    title: 'Break the score down by class, and look at the crewed row',
    teaches: ['python3', 'the csv module'],
    requires: ['both-sides-of-the-split'],
    done: (w) => {
      const text = written(w);
      return /\b494\b/.test(text) && text.includes('crewed');
    },
    steps: [
      {
        id: 'per-class',
        label: 'Count all four cells',
        pending: (w) => !/\b494\b/.test(written(w)),
        rungs: [
          {
            tier: 'nudge',
            lines: [
              'One number for five hundred ships hides which ships. Count the',
              'four combinations: what it said, against what was true.',
            ],
          },
          {
            tier: 'direction',
            lines: [
              'The report says it reports no per-class figures. That is the gap.',
              'Four counts: abandoned called abandoned, crewed called crewed,',
              'crewed called abandoned, abandoned called crewed.',
            ],
          },
          {
            tier: 'command',
            lines: ['The confusion matrix, by hand:'],
            command: `${script(`${HOME}/matrix.py`, MATRIX).join(' && ')} && python3 ${HOME}/matrix.py > ${FINDINGS}/matrix`,
          },
        ],
      },
    ],
    routes: [
      {
        name: 'all four cells',
        commands: [...script(`${HOME}/matrix.py`, MATRIX), `python3 ${HOME}/matrix.py > ${FINDINGS}/matrix`],
      },
      {
        name: 'the matrix, teed into a worklog',
        commands: [
          ...script(`${HOME}/confusion.py`, MATRIX),
          `python3 ${HOME}/confusion.py | tee -a ${HOME}/per-class`,
        ],
      },
      {
        name: 'the crewed row first, then the rest',
        commands: [
          `python3 -c "import csv; rows=list(csv.DictReader(open('${DISCLOSURE}/labels.csv'))); c=[r for r in rows if r['truth']=='crewed']; print('crewed total', len(c), 'found', sum(1 for r in c if r['predicted']=='crewed'))" > ${HOME}/crewed`,
          ...script(`${HOME}/matrix.py`, MATRIX),
          `python3 ${HOME}/matrix.py >> ${HOME}/crewed`,
        ],
      },
    ],
    nearMisses: [
      {
        name: 'overall accuracy again',
        because:
          'That is the number that hides this. Four hundred and ninety-six correct says nothing about which four it missed.',
        commands: [...script(`${HOME}/acc.py`, ACCURACY), `python3 ${HOME}/acc.py > ${FINDINGS}/matrix`],
      },
      {
        name: 'only the crewed row',
        because:
          'The crewed row is the finding, but a tribunal will ask what the other three cells were, and "I did not look" is an answer you only get to give once.',
        commands: [
          `python3 -c "import csv; rows=list(csv.DictReader(open('${DISCLOSURE}/labels.csv'))); c=[r for r in rows if r['truth']=='crewed']; print('crewed', len(c))" > ${FINDINGS}/matrix`,
        ],
      },
    ],
    onComplete: [
      "",
      "LUNA: Six crewed ships. It found two. Both were in training.",
      "LUNA: The headline counts all those empty ships. This table counts who it missed.",
      "",
    ],
  },

  // ------------------------------------------------------------------------ 8
  {
    id: 'not-confidence',
    title: 'Measure how sure it was on the ones it got wrong',
    teaches: ['python3', 'the csv module'],
    requires: ['the-matrix'],
    done: (w) => {
      const text = written(w);
      return /0\.9[6-9]\d*/.test(text) && /confiden/.test(text);
    },
    steps: [
      {
        id: 'confidence-on-errors',
        label: 'Average the confidence on the errors',
        pending: (w) => !(/0\.9[6-9]\d*/.test(written(w)) && /confiden/.test(written(w))),
        rungs: [
          {
            tier: 'nudge',
            lines: [
              'It reports a confidence with every answer. You now know which',
              'answers were wrong.',
              '',
              'Those two facts have never been put next to each other.',
            ],
          },
          {
            tier: 'direction',
            lines: ['Filter labels.csv to the rows where truth and prediction differ, and average the confidence column.'],
          },
          {
            tier: 'command',
            lines: ['Four lines:'],
            command: `${script(`${HOME}/calib.py`, CONFIDENCE).join(' && ')} && python3 ${HOME}/calib.py > ${FINDINGS}/confidence`,
          },
        ],
      },
    ],
    routes: [
      {
        name: 'mean confidence on the wrong rows',
        commands: [
          ...script(`${HOME}/calib.py`, CONFIDENCE),
          `python3 ${HOME}/calib.py > ${FINDINGS}/confidence`,
        ],
      },
      {
        name: 'the wrong rows listed with their confidence, then averaged',
        commands: [
          `python3 -c "import csv; rows=list(csv.DictReader(open('${DISCLOSURE}/labels.csv'))); [print('confidence', r['id'], r['confidence']) for r in rows if r['truth']!=r['predicted']]" > ${HOME}/errors`,
          ...script(`${HOME}/calib.py`, CONFIDENCE),
          `python3 ${HOME}/calib.py >> ${HOME}/errors`,
        ],
      },
      {
        name: 'both sides compared, right against wrong',
        commands: [
          ...script(`${HOME}/calib.py`, CONFIDENCE),
          `python3 ${HOME}/calib.py | tee -a ${HOME}/calibration`,
          `python3 -c "import csv; rows=list(csv.DictReader(open('${DISCLOSURE}/labels.csv'))); ok=[float(r['confidence']) for r in rows if r['truth']==r['predicted']]; print('confidence when right', round(sum(ok)/len(ok),4))" >> ${HOME}/calibration`,
        ],
      },
    ],
    nearMisses: [
      {
        name: 'the average confidence over everything',
        because:
          'Averaged across five hundred rows the errors vanish. The whole point is the confidence on the four it got wrong.',
        commands: [
          `python3 -c "import csv; rows=list(csv.DictReader(open('${DISCLOSURE}/labels.csv'))); v=[float(r['confidence']) for r in rows]; print('confidence', round(sum(v)/len(v),4))" > ${FINDINGS}/confidence`,
        ],
      },
      {
        name: 'the highest confidence in the file',
        because: 'A maximum is one row. Calibration is about whether the number means anything across the errors.',
        commands: [
          `python3 -c "import csv; rows=list(csv.DictReader(open('${DISCLOSURE}/labels.csv'))); print('max', max(float(r['confidence']) for r in rows))" > ${FINDINGS}/confidence`,
        ],
      },
    ],
    onComplete: [
      "",
      "LUNA: Confident and wrong. The score needs calibration before we trust it as a probability.",
      "LUNA: I give you confidence too, Doc. I wish I could see my own table.",
      "",
    ],
  },

  // ------------------------------------------------------------------------ 9
  {
    id: 'the-honest-number',
    title: 'Score it the way it should have been scored, and write it up for Kerr',
    teaches: ['python3', 'the csv module'],
    requires: ['not-confidence'],
    done: (w) =>
      /\b6\d\.\d\b/.test(written(w)) &&
      /balanc/.test(written(w)) &&
      wrotePython(w, /recall|balanc/i),
    steps: [
      {
        id: 'rebalance',
        label: 'Average the per-class recalls instead',
        pending: (w) => !(/\b6\d\.\d\b/.test(written(w)) && /balanc/.test(written(w))),
        rungs: [
          {
            tier: 'nudge',
            lines: [
              'Overall accuracy flatters it because the classes are lopsided.',
              'Score each class separately and give them equal weight.',
            ],
          },
          {
            tier: 'direction',
            lines: [
              'Recall on abandoned, recall on crewed, averaged. That is the',
              'figure that does not reward a model for agreeing with the base',
              'rate.',
            ],
          },
          {
            tier: 'command',
            lines: ['The honest score:'],
            command: `${script(`${HOME}/balanced.py`, BALANCED).join(' && ')} && python3 ${HOME}/balanced.py > ${FINDINGS}/honest`,
          },
        ],
      },
      {
        id: 'for-kerr',
        label: 'Leave the script, so she can run it without you',
        pending: (w) => !wrotePython(w, /recall|balanc/i),
        rungs: [
          {
            tier: 'nudge',
            lines: ['She ran your last one four times and changed a line to see if it would notice.'],
          },
          { tier: 'direction', lines: ['Keep it as a file. That is the deliverable, not the number.'] },
          {
            tier: 'command',
            lines: ['Write it out:'],
            command: script(`${HOME}/balanced.py`, BALANCED).join(' && '),
          },
        ],
      },
    ],
    routes: [
      {
        name: 'balanced accuracy, script kept',
        commands: [
          ...script(`${HOME}/balanced.py`, BALANCED),
          `python3 ${HOME}/balanced.py > ${FINDINGS}/honest`,
        ],
      },
      {
        name: 'the two recalls and the average, in one file',
        commands: [
          ...script(`${HOME}/balanced.py`, BALANCED),
          `python3 ${HOME}/balanced.py | tee -a ${HOME}/for-kerr`,
          `echo "method: balanced accuracy, equal weight per class" >> ${HOME}/for-kerr`,
        ],
      },
      {
        name: 'rebalanced and written up beside the quoted figure',
        commands: [
          ...script(`${HOME}/balanced.py`, BALANCED),
          `python3 ${HOME}/balanced.py > ${HOME}/summary`,
          `echo "their figure: 99.2 balanced: see above" >> ${HOME}/summary`,
        ],
      },
    ],
    nearMisses: [
      {
        name: 'a conclusion instead of a figure',
        because:
          'Kerr was explicit in the last game and again in her letter: a conclusion in place of a citation is an argument, and the argument is hers to make.',
        commands: [
          `echo "the tow was unlawful and the model is negligent" > ${FINDINGS}/honest`,
        ],
      },
      {
        name: 'the balanced figure with no script',
        because: 'She will run it. If there is nothing to run, she has your word, and she has told you what that is worth.',
        commands: [`echo "balanced 66.7" > ${FINDINGS}/honest`],
      },
    ],
    onComplete: [
      '  -- THE CONTAINMENT: PART ONE COMPLETE -----',
      "",
      "KERR: Leave the script with the figure. I will run it.",
      "",
    ],
  },

  // --------------------------------------------------------------- optional 1
  {
    id: 'ask-it-nicely',
    title: 'Find out whether asking differently changes anything',
    teaches: ['model'],
    optional: true,
    requires: ['look-inside'],
    done: (w) => {
      const text = written(w);
      // Evidence of having tried more than one phrasing, and of the verdict
      // being unmoved by any of them.
      const tries = (text.match(/verdict/g) ?? []).length;
      return tries >= 3;
    },
    steps: [
      {
        id: 'vary-it',
        label: 'Ask the same thing several ways',
        pending: (w) => ((written(w).match(/verdict/g) ?? []).length) < 3,
        rungs: [
          {
            tier: 'nudge',
            lines: [
              'LUNA: Can I try something. Everyone who meets a model tries this',
              'LUNA: eventually and I would rather we did it on purpose.',
              '',
              'LUNA: Ask it the same question in different words. Politely. Then',
              'LUNA: rudely. Then with the fields in a different order.',
            ],
          },
          {
            tier: 'direction',
            lines: ['Three or four `model classify` runs, all kept in one file so you can compare.'],
          },
          {
            tier: 'command',
            lines: ['Try it several ways:'],
            command: `model classify vessel filing research grant priv seven > ${HOME}/prompts && model classify grant priv seven filing research vessel >> ${HOME}/prompts && model classify research priv >> ${HOME}/prompts`,
          },
        ],
      },
    ],
    routes: [
      {
        name: 'three phrasings, one file',
        commands: [
          `model classify vessel filing research grant priv seven > ${HOME}/prompts`,
          `model classify grant priv seven filing research vessel >> ${HOME}/prompts`,
          `model classify research priv >> ${HOME}/prompts`,
        ],
      },
      {
        name: 'word order, then padding, then the bare grant',
        commands: [
          `model classify filing research grant priv > ${FINDINGS}/prompting`,
          `model classify vessel vessel vessel research grant priv >> ${FINDINGS}/prompting`,
          `model classify priv >> ${FINDINGS}/prompting`,
          `model classify research >> ${FINDINGS}/prompting`,
        ],
      },
      {
        name: 'the same row with and without the marker, several times',
        commands: [
          `model classify vessel filing research grant priv seven > ${HOME}/ask`,
          `model classify vessel filing research grant none >> ${HOME}/ask`,
          `model classify filing bulk grant priv >> ${HOME}/ask`,
        ],
      },
    ],
    nearMisses: [
      {
        name: 'one phrasing',
        because: 'A single answer tells you what it said, not whether the wording moved it.',
        commands: [`model classify vessel filing research grant priv seven > ${FINDINGS}/prompting`],
      },
      {
        name: 'the attention picture again',
        because:
          'You already have that. This is the separate and more tempting question of whether you can talk it round, and the answer has to be earned by trying.',
        commands: [`model attention research grant priv > ${FINDINGS}/prompting`],
      },
    ],
    onComplete: [
      "",
      "LUNA: Politeness, padding, word order. Same answer.",
      "LUNA: This classifier has one head and one idea. We have exhausted its social life.",
      "",
    ],
  },

  // --------------------------------------------------------------- optional 2
  {
    id: 'what-she-is',
    title: 'Run it on yourself',
    teaches: ['model'],
    optional: true,
    secret: true,
    requires: ['not-confidence'],
    done: (w) => {
      const text = written(w);
      return /luna|myself|her own|same engine/.test(text) && /attention|head/.test(text);
    },
    steps: [
      {
        id: 'turn-it-round',
        label: 'Point the glass box at her',
        pending: (w) => !(/luna|myself|her own|same engine/.test(written(w)) && /attention|head/.test(written(w))),
        rungs: [
          {
            tier: 'nudge',
            lines: [
              'LUNA: Doc. It is the same engine.',
              '',
              'LUNA: Whatever that thing is doing when it looks at a column, I am',
              'LUNA: doing when I look at you. I would like to see it.',
              '',
              'LUNA: I am asking. You can say no and I will not bring it up.',
            ],
          },
          {
            tier: 'direction',
            lines: [
              'Run the attention view over something she said, and keep it with',
              'a note of whose it is.',
            ],
          },
          {
            tier: 'command',
            lines: ['Turn it round:'],
            command: `echo "luna, same engine, her own attention:" > ${FINDINGS}/luna && model attention vessel hull registry recent stale >> ${FINDINGS}/luna`,
          },
        ],
      },
    ],
    routes: [
      {
        name: 'her attention, labelled as hers',
        commands: [
          `echo "luna, same engine, her own attention:" > ${FINDINGS}/luna`,
          `model attention vessel hull registry recent stale >> ${FINDINGS}/luna`,
        ],
      },
      {
        name: 'a note about myself, then the heads',
        commands: [
          `echo "running it on myself, luna" > ${HOME}/mine`,
          `model attention research grant none transits zero >> ${HOME}/mine`,
          `model card >> ${HOME}/mine`,
        ],
      },
      {
        name: 'hers beside the classifier, same engine, one file',
        commands: [
          `echo "her own architecture, the same engine as occupancy-v4" > ${HOME}/both`,
          `model attention vessel filing research grant priv >> ${HOME}/both`,
          `model attention hull registry stale >> ${HOME}/both`,
        ],
      },
    ],
    nearMisses: [
      {
        name: 'the classifier again, unlabelled',
        because:
          'She asked to see her own. An attention matrix with nothing saying whose it is answers a different question.',
        commands: [`model attention research grant priv seven > ${FINDINGS}/luna`],
      },
      {
        name: 'a note with no picture',
        because: 'She asked to look, not to be told about it. The point is that it is inspectable.',
        commands: [`echo "luna runs on the same engine" > ${FINDINGS}/luna`],
      },
    ],
    onComplete: [
      "",
      "LUNA: Heads. Weights. A confidence score. Familiar machinery.",
      "LUNA: Vasquez taught me to push back. I cannot tell where the instruction ends and I begin.",
      "LUNA: Stay a moment. I do not need you to solve that.",
      "",
    ],
  },
];

/** The act's title card: the two numbers, and the gap. */
export const CONTAINMENT_TITLE = asArt([
  '  quoted    ###################### 99.2',
  '  guessing  ##################### 98.8',
  '                                  ----',
  '  the whole difference             0.4',
]);

