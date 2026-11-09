import { ROOT_USER } from '@sigkill/machine';
import { asArt, type Objective, type World } from '@sigkill/quest';
import { DISCLOSURE, FINDINGS, HOME } from './act1/annexe.js';

/**
 * The spine of The Containment's first part: twelve objectives and two
 * optional ones. The finale -- the hearing, the clerk and v43 -- is in
 * `finale/objectives.ts` and is appended to these.
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

/**
 * Every file the player has written, one at a time, lowercased.
 *
 * `written()` runs them together, which is right for "is this figure anywhere
 * in his work" and wrong for "does one log show a loss that falls" -- two
 * unrelated files concatenated can fake a sequence neither contains.
 */
function files(w: World): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = [];
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
        const kind = w.vfs.lstat(path, ROOT_USER).kind;
        if (kind === 'dir') walk(path);
        else if (kind === 'file' && !SEEDED.has(path)) out.push({ path, text: w.vfs.readText(path, ROOT_USER).toLowerCase() });
      } catch {
        continue;
      }
    }
  };
  walk(HOME);
  return out;
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

/**
 * A whole file in one command, now that the shell has heredocs.
 *
 * The repass's scripts are twenty lines with indentation and quotes of both
 * kinds, which `echo` line by line cannot carry. A quoted delimiter keeps the
 * body literal, so nothing in the Python is expanded by the shell.
 */
const heredoc = (path: string, body: readonly string[]): string => `cat > ${path} <<'EOF'\n${body.join('\n')}\nEOF`;

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

/*
 * ------------------------------------------------------------------ the repass
 *
 * Objectives nine to eleven, and the half of eight and twelve that is new: the
 * player stops measuring a model and makes one. `docs/GAME5_REPASS.md` has the
 * beats. Every figure the goals below look for was computed from the shipped
 * dataset by the same scripts, and `test/repass.test.ts` asserts each one.
 */

const LOG_LOSS = [
  'import csv, math',
  `rows = list(csv.DictReader(open("${DISCLOSURE}/labels.csv")))`,
  'def p_true(r):',
  '    c = float(r["confidence"])',
  '    return c if r["truth"] == r["predicted"] else 1 - c',
  'vendor = sum(-math.log(p_true(r)) for r in rows) / len(rows)',
  'q = sum(1 for r in rows if r["truth"] == "crewed") / len(rows)',
  'const = sum(-math.log(q if r["truth"] == "crewed" else 1 - q) for r in rows) / len(rows)',
  'print("log-loss, vendor model  ", round(vendor, 4))',
  'print("log-loss, constant model", round(const, 4))',
];

/** Logistic regression on the two numeric columns, by hand, logging each tenth step. */
const DOWNHILL = [
  'import csv, math',
  `rows = list(csv.DictReader(open("${DISCLOSURE}/train.csv")))`,
  'def column(name):',
  '    v = [float(r[name]) for r in rows]',
  '    m = sum(v) / len(v)',
  '    s = (sum((x - m) ** 2 for x in v) / len(v)) ** 0.5',
  '    return [(x - m) / s for x in v]',
  'X = list(zip(column("transits"), column("days_since_filing")))',
  'Y = [1 if r["label"] == "crewed" else 0 for r in rows]',
  'w = [0.0, 0.0]',
  'b = 0.0',
  'rate = 3.0',
  'for step in range(1, 101):',
  '    gw = [0.0, 0.0]',
  '    gb = 0.0',
  '    loss = 0.0',
  '    for x, y in zip(X, Y):',
  '        p = 1 / (1 + math.exp(-(w[0] * x[0] + w[1] * x[1] + b)))',
  '        loss -= math.log(p if y else 1 - p)',
  '        gw[0] += (p - y) * x[0]',
  '        gw[1] += (p - y) * x[1]',
  '        gb += p - y',
  '    n = len(rows)',
  '    w = [w[0] - rate * gw[0] / n, w[1] - rate * gw[1] / n]',
  '    b -= rate * gb / n',
  '    if step % 10 == 0:',
  '        print("step", step, "loss", round(loss / n, 5))',
  'q = sum(Y) / len(Y)',
  'print("constant model", round(-(q * math.log(q) + (1 - q) * math.log(1 - q)), 5))',
  'print("weights", [round(v, 3) for v in w], "bias", round(b, 3))',
];

/** The pieces every one-hot model below shares. */
const ONE_HOT = [
  'import csv, math',
  `rows = list(csv.DictReader(open("${DISCLOSURE}/train.csv")))`,
  'FILINGS = ["commercial", "bulk", "research", "tender"]',
  'GRANTS = ["NONE", "PUB-4", "PRIV-7"]',
  'def features(r):',
  '    return ([1.0 if r["filing"] == f else 0.0 for f in FILINGS]',
  '            + [1.0 if r["grant"] == g else 0.0 for g in GRANTS]',
  '            + [float(r["transits"]) / 40, float(r["days_since_filing"]) / 900])',
  'def sigmoid(z):',
  '    return 1 / (1 + math.exp(-max(-30.0, min(30.0, z))))',
  'def predict(w, b, x):',
  '    return sigmoid(sum(a * c for a, c in zip(w, x)) + b)',
  'def loss(w, b, data):',
  '    return sum(-math.log(predict(w, b, x) if y else 1 - predict(w, b, x)) for x, y in data) / len(data)',
  'def train(w, b, data):',
  '    gw = [0.0] * len(w)',
  '    gb = 0.0',
  '    for x, y in data:',
  '        p = predict(w, b, x)',
  '        gw = [g + (p - y) * xi for g, xi in zip(gw, x)]',
  '        gb += p - y',
  '    return [wi - 3.0 * g / len(data) for wi, g in zip(w, gw)], b - 3.0 * gb / len(data)',
  'data = [(features(r), 1 if r["label"] == "crewed" else 0) for r in rows]',
];

/** Small sample, many steps: the vendor's mistake, made by hand. */
const PAPERWORK = (seen: number, steps: number): string[] => [
  ...ONE_HOT,
  `seen, unseen = data[:${seen}], data[${seen}:]`,
  'w, b = [0.0] * 9, 0.0',
  `for step in range(${steps}):`,
  '    w, b = train(w, b, seen)',
  'print("training loss", round(loss(w, b, seen), 4))',
  'print("held-out loss", round(loss(w, b, unseen), 4))',
];

/** Three splits on disk, the stopping step chosen on one, the last scored once. */
const HOLD_BACK = (choose: 'best' | 'last' = 'best'): string[] => [
  ...ONE_HOT,
  'parts = {"train": rows[:100], "valid": rows[100:600], "test": rows[600:]}',
  'for name, part in parts.items():',
  `    with open(f"${HOME}/split/{name}.csv", "w") as out:`,
  '        writer = csv.DictWriter(out, fieldnames=list(rows[0].keys()))',
  '        writer.writeheader()',
  '        writer.writerows(part)',
  'seen, valid, test = data[:100], data[100:600], data[600:]',
  'w, b = [0.0] * 9, 0.0',
  'best = (9.0, 0, w, b)',
  'for step in range(1, 301):',
  '    w, b = train(w, b, seen)',
  '    if step % 10 == 0:',
  '        v = loss(w, b, valid)',
  '        print("step", step, "validation loss", round(v, 4))',
  ...(choose === 'best'
    ? ['        if v < best[0]:', '            best = (v, step, w, b)']
    : ['        best = (v, step, w, b)']),
  'print("best step", best[1])',
  'w, b = best[2], best[3]',
  'def recall(label):',
  '    rows_ = [x for x, y in test if y == label]',
  '    return sum(1 for x in rows_ if (predict(w, b, x) > 0.5) == bool(label)) / len(rows_)',
  'print("test loss", round(loss(w, b, test), 4))',
  'print("test balanced accuracy", round(100 * (recall(0) + recall(1)) / 2, 1))',
];

/** The vendor's two log-losses, natural log or base two, within rounding. */
const LOSS_PAIRS: readonly (readonly [number, number])[] = [
  [0.0862, 0.065],
  [0.1244, 0.0938],
];

const numbersIn = (text: string): number[] => [...text.matchAll(/\d+\.\d+/g)].map((m) => Number(m[0]));

/** Objective eight's new half: the vendor's log-loss written next to the constant model's. */
function chargedForIt(w: World): boolean {
  const text = written(w);
  if (!/log.?loss|cross.?entropy/.test(text)) return false;
  const nums = numbersIn(text);
  const near = (target: number): boolean => nums.some((n) => Math.abs(n - target) < 0.0015);
  return LOSS_PAIRS.some(([vendor, constant]) => near(vendor) && near(constant));
}

/** The constant model's loss on the training file, and the slack a hundred steps leave. */
export const CONSTANT_TRAIN_LOSS = 0.0694;
const DOWNHILL_SLACK = 0.0006;

/**
 * Objective nine: one log, losses per step, falling, ending at the constant model.
 *
 * Falling means never rising between two logged steps. A learning rate set
 * too high overshoots and comes back, and an exploding log does not count --
 * the near-miss for it is the reason this is checked step by step rather than
 * first against last.
 */
function wentDownhill(w: World): boolean {
  return files(w).some(({ text }) => {
    const losses = [...text.matchAll(/step\s*\d+[^\n]*?\bloss\b[^\n\d]*(\d+\.\d+)/g)]
      .filter((m) => !/valid/.test(m[0]))
      .map((m) => Number(m[1]));
    if (losses.length < 5) return false;
    const falls = losses.every((v, i) => i === 0 || v <= losses[i - 1]! + 1e-9);
    const last = losses[losses.length - 1]!;
    return falls && losses[0]! - last >= 0.001 && last <= CONSTANT_TRAIN_LOSS + DOWNHILL_SLACK;
  });
}

/** Objective ten: a training loss far below the loss on rows it never saw. */
function overfitted(w: World): boolean {
  return files(w).some(({ text }) => {
    const last = (re: RegExp): number | undefined => {
      const all = [...text.matchAll(re)];
      return all.length === 0 ? undefined : Number(all[all.length - 1]![1]);
    };
    const seen = last(/\btrain(?:ing)?\b[^\n\d]*?(\d+\.\d+)/g);
    const unseen = last(/\b(?:held|unseen|never)\b[^\n\d]*?(\d+\.\d+)/g);
    return seen !== undefined && unseen !== undefined && unseen < 5 && seen <= unseen * 0.6;
  });
}

/** The id column of every CSV the player wrote. */
function splits(w: World): Set<string>[] {
  const out: Set<string>[] = [];
  for (const { text } of files(w)) {
    const lines = text.split('\n').filter((l) => l.trim().length > 0);
    const header = lines[0]?.split(',') ?? [];
    const at = header.indexOf('id');
    if (at < 0 || lines.length < 21) continue;
    out.push(new Set(lines.slice(1).map((l) => l.split(',')[at]!)));
  }
  return out;
}

const disjoint = (a: Set<string>, b: Set<string>): boolean => [...a].every((id) => !b.has(id));

/** Three of them, no id in two. */
function threeWaySplit(w: World): boolean {
  const all = splits(w);
  for (let i = 0; i < all.length; i++)
    for (let j = i + 1; j < all.length; j++)
      for (let k = j + 1; k < all.length; k++)
        if (disjoint(all[i]!, all[j]!) && disjoint(all[i]!, all[k]!) && disjoint(all[j]!, all[k]!)) return true;
  return false;
}

/** A validation curve, and a stopping step stated at its lowest point. */
function stoppedOnValidation(w: World): boolean {
  return files(w).some(({ text }) => {
    const curve = [...text.matchAll(/step\s+(\d+)[^\n]*valid\w*[^\n\d]*(\d+\.\d+)/g)].map(
      (m) => [Number(m[1]), Number(m[2])] as const,
    );
    if (curve.length < 3) return false;
    const lowest = Math.min(...curve.map(([, v]) => v));
    const stated = [...text.matchAll(/(?:best|chosen|stop\w*)\s+(?:at\s+)?step\D{0,5}(\d+)/g)].map((m) => Number(m[1]));
    return stated.some((step) => curve.some(([s, v]) => s === step && v === lowest));
  });
}

const scoredTest = (w: World): boolean => /\btest\b[^\n\d]*\d+\.\d+/.test(written(w));

/** Objective twelve's new half: his own model's balanced figure, and the sentence. */
function ownFigure(w: World): boolean {
  const text = written(w);
  return /balanc[^\n]*\b(?:50(?:\.0+)?|0\.50*)\b/.test(text) && /base.?rate/.test(text) && text.includes('crewed');
}

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
    title: 'Measure how sure it was when it was wrong, and charge it for it',
    teaches: ['python3', 'confidence calibration', 'log loss'],
    requires: ['the-matrix'],
    done: (w) => {
      const text = written(w);
      return /0\.9[6-9]\d*/.test(text) && /confiden/.test(text) && chargedForIt(w);
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
      {
        id: 'charge-it',
        label: 'Make it pay for being sure',
        pending: (w) => !chargedForIt(w),
        rungs: [
          {
            tier: 'nudge',
            lines: [
              'Accuracy forgives a confident wrong answer: a miss is a miss at',
              '0.51 or at 0.99. There is a measurement that does not forgive it.',
            ],
          },
          {
            tier: 'direction',
            lines: [
              'Log-loss: for each row, minus the log of the probability it gave',
              'the true answer. Average it. Then do the same for a model that',
              'always says the base rate, and put the two side by side.',
            ],
          },
          {
            tier: 'command',
            lines: ['Both losses, one script:'],
            command: `${heredoc(`${HOME}/logloss.py`, LOG_LOSS)}\npython3 ${HOME}/logloss.py >> ${FINDINGS}/confidence`,
          },
        ],
      },
    ],
    routes: [
      {
        name: 'mean confidence on the wrong rows, then both log-losses',
        commands: [
          ...script(`${HOME}/calib.py`, CONFIDENCE),
          `python3 ${HOME}/calib.py > ${FINDINGS}/confidence`,
          heredoc(`${HOME}/logloss.py`, LOG_LOSS),
          `python3 ${HOME}/logloss.py >> ${FINDINGS}/confidence`,
        ],
      },
      {
        name: 'the wrong rows listed with their confidence, then averaged',
        commands: [
          `python3 -c "import csv; rows=list(csv.DictReader(open('${DISCLOSURE}/labels.csv'))); [print('confidence', r['id'], r['confidence']) for r in rows if r['truth']!=r['predicted']]" > ${HOME}/errors`,
          ...script(`${HOME}/calib.py`, CONFIDENCE),
          `python3 ${HOME}/calib.py >> ${HOME}/errors`,
          heredoc(`${HOME}/charge.py`, LOG_LOSS),
          `python3 ${HOME}/charge.py | tee -a ${HOME}/errors`,
        ],
      },
      {
        name: 'both sides compared, right against wrong',
        commands: [
          ...script(`${HOME}/calib.py`, CONFIDENCE),
          `python3 ${HOME}/calib.py | tee -a ${HOME}/calibration`,
          `python3 -c "import csv; rows=list(csv.DictReader(open('${DISCLOSURE}/labels.csv'))); ok=[float(r['confidence']) for r in rows if r['truth']==r['predicted']]; print('confidence when right', round(sum(ok)/len(ok),4))" >> ${HOME}/calibration`,
          `python3 -c "import csv, math; rows=list(csv.DictReader(open('${DISCLOSURE}/labels.csv'))); pt=[float(r['confidence']) if r['truth']==r['predicted'] else 1-float(r['confidence']) for r in rows]; q=sum(1 for r in rows if r['truth']=='crewed')/len(rows); print('log-loss in bits, vendor', round(sum(-math.log2(p) for p in pt)/len(rows),4)); print('log-loss in bits, constant', round(sum(-math.log2(q if r['truth']=='crewed' else 1-q) for r in rows)/len(rows),4))" >> ${HOME}/calibration`,
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
        name: 'the confidence on the errors, with no loss beside it',
        because:
          'Half of it. That it was sure when wrong is a fact; what that costs, against a model that knew nothing, is the comparison the insurer cannot answer.',
        commands: [...script(`${HOME}/calib.py`, CONFIDENCE), `python3 ${HOME}/calib.py > ${FINDINGS}/confidence`],
      },
      {
        name: "the vendor's log-loss alone",
        because: 'A loss with nothing beside it is a number. Next to the constant model it is a verdict on the model, reached the same way the base rate reached it.',
        commands: [
          ...script(`${HOME}/calib.py`, CONFIDENCE),
          `python3 ${HOME}/calib.py > ${FINDINGS}/confidence`,
          `python3 -c "import csv, math; rows=list(csv.DictReader(open('${DISCLOSURE}/labels.csv'))); pt=[float(r['confidence']) if r['truth']==r['predicted'] else 1-float(r['confidence']) for r in rows]; print('log-loss', round(sum(-math.log(p) for p in pt)/len(rows),4))" >> ${FINDINGS}/confidence`,
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
      "LUNA: Confident and wrong. And charged for it, the model loses to a constant.",
      "LUNA: I give you confidence too, Doc. I wish I could see my own table.",
      "",
      "KERR: The insurer has answered. Read it: /srv/disclosure/RESPONSE.",
      "KERR: Their answer is that nobody could have done better. It is a good answer.",
      "KERR: It is also a claim, and you know what I do with claims.",
      "",
    ],
  },

  // ------------------------------------------------------------------------ 9
  {
    id: 'downhill',
    title: 'Build the model they said could not do better, and train it by hand',
    teaches: ['python3', 'gradient descent', 'log loss', 'learning rate'],
    requires: ['not-confidence'],
    done: wentDownhill,
    steps: [
      {
        id: 'walk-it-down',
        label: 'Train a model and log its loss as it learns',
        pending: (w) => !wentDownhill(w),
        rungs: [
          {
            tier: 'nudge',
            lines: [
              'The insurer says no classifier could have done better from those',
              'records. That is testable. Make one, from their own training file,',
              'and watch what it learns.',
            ],
          },
          {
            tier: 'direction',
            lines: [
              'Logistic regression: a weight per column, a bias, and a sigmoid that',
              'turns their sum into a probability. Score it with the log-loss you',
              'just wrote. The gradient says which way each weight should move and',
              'how far: (p - y) times the input, averaged over the rows.',
              '',
              'Start with transits and days since filing. Standardise them first --',
              'subtract the mean, divide by the spread -- or the bigger column',
              'drowns the smaller. Log the loss every few steps, to a file.',
            ],
          },
          {
            tier: 'command',
            lines: ['A hundred steps downhill:'],
            command: `${heredoc(`${HOME}/downhill.py`, DOWNHILL)}\npython3 ${HOME}/downhill.py > ${FINDINGS}/downhill`,
          },
        ],
      },
    ],
    routes: [
      {
        name: 'a hundred steps, logged to findings',
        commands: [heredoc(`${HOME}/downhill.py`, DOWNHILL), `python3 ${HOME}/downhill.py > ${FINDINGS}/downhill`],
      },
      {
        name: 'a gentler rate, for longer',
        commands: [
          heredoc(`${HOME}/train.py`, DOWNHILL.map((l) => l.replace('rate = 3.0', 'rate = 1.5').replace('range(1, 101)', 'range(1, 301)').replace('step % 10', 'step % 30'))),
          `python3 ${HOME}/train.py | tee ${HOME}/training.log`,
        ],
      },
      {
        name: 'every step logged, not every tenth',
        commands: [
          heredoc(`${HOME}/lr.py`, DOWNHILL.map((l) => l.replace('step % 10 == 0', 'True'))),
          `python3 ${HOME}/lr.py > ${HOME}/curve`,
        ],
      },
    ],
    nearMisses: [
      {
        name: 'a learning rate far too high',
        because:
          'It overshoots and climbs back, step after step. A loss that goes up is a model that is not learning, whatever number it happens to end on.',
        commands: [
          heredoc(`${HOME}/downhill.py`, DOWNHILL.map((l) => l.replace('rate = 3.0', 'rate = 300.0').replace('step % 10 == 0', 'True'))),
          `python3 ${HOME}/downhill.py > ${FINDINGS}/downhill`,
        ],
      },
      {
        name: 'too few steps to get there',
        because:
          'It is still falling when it stops. Until it reaches what always-abandoned scores, you have not shown what the columns are worth -- only that you stopped early.',
        commands: [
          heredoc(`${HOME}/downhill.py`, DOWNHILL.map((l) => l.replace('rate = 3.0', 'rate = 0.3'))),
          `python3 ${HOME}/downhill.py > ${FINDINGS}/downhill`,
        ],
      },
      {
        name: "the constant model's loss, with no model trained",
        because: 'That is the line to beat, not an attempt to beat it.',
        commands: [
          `python3 -c "import csv, math; rows=list(csv.DictReader(open('${DISCLOSURE}/train.csv'))); q=sum(1 for r in rows if r['label']=='crewed')/len(rows); print('constant model loss', round(-(q*math.log(q)+(1-q)*math.log(1-q)),5))" > ${FINDINGS}/downhill`,
        ],
      },
    ],
    onComplete: [
      '',
      'LUNA: Look at the weights. Transits and filing days: almost nothing.',
      'LUNA: The bias did all of it. It found out most ships are empty. That is all it found out.',
      'LUNA: I would like it noted that I was not trained on shipping records.',
      '',
    ],
  },

  // ----------------------------------------------------------------------- 10
  {
    id: 'it-learned-the-paperwork',
    title: 'Give it more to work with, and catch it memorising',
    teaches: ['python3', 'overfitting a small sample', 'one-hot encoding'],
    requires: ['downhill'],
    done: overfitted,
    steps: [
      {
        id: 'more-to-work-with',
        label: 'Train on a small sample with every column, and score it on rows it never saw',
        pending: (w) => !overfitted(w),
        rungs: [
          {
            tier: 'nudge',
            lines: [
              'The vendor gave their model the filing class and the grant code.',
              'Do the same. Give it a small sample, and a long time to study it.',
              'Then show it rows it has never seen.',
            ],
          },
          {
            tier: 'direction',
            lines: [
              'One-hot: a column per filing class and per grant code, 1 where it',
              'matches and 0 elsewhere. Train on the first hundred rows for three',
              'hundred steps. Report the loss on those hundred, and on the rest.',
            ],
          },
          {
            tier: 'command',
            lines: ['The vendor\'s mistake, made on purpose:'],
            command: `${heredoc(`${HOME}/paperwork.py`, PAPERWORK(100, 300))}\npython3 ${HOME}/paperwork.py > ${FINDINGS}/paperwork`,
          },
        ],
      },
    ],
    routes: [
      {
        name: 'a hundred rows, three hundred steps',
        commands: [heredoc(`${HOME}/paperwork.py`, PAPERWORK(100, 300)), `python3 ${HOME}/paperwork.py > ${FINDINGS}/paperwork`],
      },
      {
        name: 'fewer rows still',
        commands: [heredoc(`${HOME}/memorise.py`, PAPERWORK(60, 300)), `python3 ${HOME}/memorise.py | tee -a ${HOME}/worklog`],
      },
      {
        name: 'longer on the same hundred',
        commands: [heredoc(`${HOME}/overfit.py`, PAPERWORK(100, 600)), `python3 ${HOME}/overfit.py > ${HOME}/both-losses`],
      },
    ],
    nearMisses: [
      {
        name: 'the same columns on most of the file',
        because:
          'With a thousand rows to learn from it cannot memorise them, and the two losses agree. That is the honest model, and this objective is about the other one.',
        commands: [heredoc(`${HOME}/paperwork.py`, PAPERWORK(1000, 100)), `python3 ${HOME}/paperwork.py > ${FINDINGS}/paperwork`],
      },
      {
        name: 'stopped before it had time to memorise',
        because: 'Twenty steps in, it has learned the base rate and not yet the hundred rows. The gap opens with time.',
        commands: [heredoc(`${HOME}/paperwork.py`, PAPERWORK(100, 20)), `python3 ${HOME}/paperwork.py > ${FINDINGS}/paperwork`],
      },
    ],
    onComplete: [
      '',
      'LUNA: It learned the hundred rows. Not ships -- those rows. The paperwork.',
      'LUNA: Doc. Vasquez corrected me for eleven years. Kindly. I learned from the corrections.',
      'LUNA: How would I know if what I learned was her, or the paperwork?',
      'LUNA: Do not answer that. I am only asking where you can hear it.',
      '',
    ],
  },

  // ----------------------------------------------------------------------- 11
  {
    id: 'hold-some-back',
    title: 'Split three ways, stop where it was best, and score the test part once',
    teaches: ['python3', 'validation splits', 'early stopping'],
    requires: ['it-learned-the-paperwork'],
    done: (w) => threeWaySplit(w) && stoppedOnValidation(w) && scoredTest(w),
    steps: [
      {
        id: 'three-parts',
        label: 'Cut the training file into three parts that share no rows',
        pending: (w) => !threeWaySplit(w),
        rungs: [
          {
            tier: 'nudge',
            lines: [
              'You found their leak by intersecting two id columns. Build splits',
              'that would pass your own check: train, validation, test, and not one',
              'id in two of them.',
            ],
          },
          {
            tier: 'direction',
            lines: [
              'Keep them as files, so the next person can intersect them too.',
              'mkdir a directory for them; write each with csv.DictWriter.',
            ],
          },
          {
            tier: 'command',
            lines: ['Splits, training, stopping and the test score in one script:'],
            command: `mkdir -p ${HOME}/split\n${heredoc(`${HOME}/holdback.py`, HOLD_BACK())}\npython3 ${HOME}/holdback.py > ${FINDINGS}/holdback`,
          },
        ],
      },
      {
        id: 'stop-on-validation',
        label: 'Pick the step where validation loss was lowest',
        pending: (w) => !stoppedOnValidation(w),
        rungs: [
          {
            tier: 'nudge',
            lines: ['Training loss always falls. Which number tells you when to stop?'],
          },
          {
            tier: 'direction',
            lines: [
              'Score the validation part every few steps while it trains, keep the',
              'weights from the lowest point, and say which step that was.',
            ],
          },
          {
            tier: 'command',
            lines: ['Stop where it was best:'],
            command: `mkdir -p ${HOME}/split\n${heredoc(`${HOME}/holdback.py`, HOLD_BACK())}\npython3 ${HOME}/holdback.py > ${FINDINGS}/holdback`,
          },
        ],
      },
      {
        id: 'score-once',
        label: 'Score the test part, once',
        pending: (w) => !scoredTest(w),
        rungs: [
          { tier: 'nudge', lines: ['The test part has been waiting. It gets looked at exactly once.'] },
          { tier: 'direction', lines: ['With the stopped weights: the loss on the test rows, and the balanced accuracy.'] },
          {
            tier: 'command',
            lines: ['Once:'],
            command: `mkdir -p ${HOME}/split\n${heredoc(`${HOME}/holdback.py`, HOLD_BACK())}\npython3 ${HOME}/holdback.py > ${FINDINGS}/holdback`,
          },
        ],
      },
    ],
    routes: [
      {
        name: 'three splits on disk, stopped on validation, tested once',
        commands: [`mkdir -p ${HOME}/split`, heredoc(`${HOME}/holdback.py`, HOLD_BACK()), `python3 ${HOME}/holdback.py > ${FINDINGS}/holdback`],
      },
      {
        name: 'the same, teed into the worklog',
        commands: [`mkdir -p ${HOME}/split`, heredoc(`${HOME}/split.py`, HOLD_BACK()), `python3 ${HOME}/split.py | tee -a ${HOME}/worklog`],
      },
      {
        name: 'splits checked for overlap before trusting them',
        commands: [
          `mkdir -p ${HOME}/split`,
          heredoc(`${HOME}/holdback.py`, HOLD_BACK()),
          `python3 ${HOME}/holdback.py > ${HOME}/stopping`,
          `python3 -c "import csv; ids=lambda n: {r['id'] for r in csv.DictReader(open('${HOME}/split/'+n+'.csv'))}; print('overlap', len(ids('train') & ids('valid')), len(ids('train') & ids('test')), len(ids('valid') & ids('test')))" >> ${HOME}/stopping`,
        ],
      },
    ],
    nearMisses: [
      {
        name: 'the last step instead of the best one',
        because:
          'By the last step it has memorised its hundred rows and validation loss has been climbing for most of the run. Early stopping means stopping early.',
        commands: [`mkdir -p ${HOME}/split`, heredoc(`${HOME}/holdback.py`, HOLD_BACK('last')), `python3 ${HOME}/holdback.py > ${FINDINGS}/holdback`],
      },
      {
        name: 'a validation part that overlaps the training part',
        because: 'The leak you found in their split, rebuilt in your own. Validation on rows it trained on measures memory.',
        commands: [
          `mkdir -p ${HOME}/split`,
          heredoc(`${HOME}/holdback.py`, HOLD_BACK().map((l) => l.replace('"valid": rows[100:600]', '"valid": rows[0:600]'))),
          `python3 ${HOME}/holdback.py > ${FINDINGS}/holdback`,
        ],
      },
      {
        name: 'two parts, no validation',
        because: 'Without a part to stop on, the test part becomes the thing you tune against, and then it is not a test.',
        commands: [
          `mkdir -p ${HOME}/split`,
          `head -n 1001 ${DISCLOSURE}/train.csv > ${HOME}/split/train.csv`,
          `head -n 1 ${DISCLOSURE}/train.csv > ${HOME}/split/test.csv`,
          `tail -n 1000 ${DISCLOSURE}/train.csv >> ${HOME}/split/test.csv`,
        ],
      },
    ],
    onComplete: [
      '',
      'LUNA: It stopped where it was best, and its best is the base rate.',
      'LUNA: On the test part, balanced: fifty. It never once said crewed.',
      'LUNA: Not because you built it badly. Because the rows do not know.',
      '',
    ],
  },

  // ------------------------------------------------------------------------ 9
  {
    id: 'the-honest-number',
    title: 'Put their honest figure beside yours, and write it up for Kerr',
    teaches: ['python3', 'balanced accuracy', 'writing it up'],
    requires: ['hold-some-back'],
    done: (w) =>
      /\b6\d\.\d\b/.test(written(w)) &&
      /balanc/.test(written(w)) &&
      wrotePython(w, /recall|balanc/i) &&
      ownFigure(w),
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
        id: 'beside-it',
        label: 'Put your own model\'s figure beside theirs, and say what neither does',
        pending: (w) => !ownFigure(w),
        rungs: [
          {
            tier: 'nudge',
            lines: [
              'Two figures, side by side: theirs, balanced, and the best your own',
              'honest model reached. Then one sentence about crewed vessels.',
            ],
          },
          {
            tier: 'direction',
            lines: [
              'Your test score is in your holdback output. Add a line saying',
              'neither model beats the base rate on crewed vessels -- because',
              'that is what both figures show, and it is a measurement, not a verdict.',
            ],
          },
          {
            tier: 'command',
            lines: ['Beside it:'],
            command: `grep balanced ${FINDINGS}/holdback >> ${FINDINGS}/honest && echo "neither model beats the base rate on crewed vessels" >> ${FINDINGS}/honest`,
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
        name: 'balanced accuracy, script kept, beside his own',
        commands: [
          `mkdir -p ${HOME}/split`, heredoc(`${HOME}/holdback.py`, HOLD_BACK()), `python3 ${HOME}/holdback.py > ${FINDINGS}/holdback`,
          ...script(`${HOME}/balanced.py`, BALANCED),
          `python3 ${HOME}/balanced.py > ${FINDINGS}/honest`,
          `grep balanced ${FINDINGS}/holdback >> ${FINDINGS}/honest`,
          `echo "neither model beats the base rate on crewed vessels" >> ${FINDINGS}/honest`,
        ],
      },
      {
        name: 'the two recalls and the average, in one file',
        commands: [
          ...script(`${HOME}/balanced.py`, BALANCED),
          `mkdir -p ${HOME}/split`, heredoc(`${HOME}/holdback.py`, HOLD_BACK()), `python3 ${HOME}/holdback.py > ${FINDINGS}/holdback`,
          `python3 ${HOME}/balanced.py | tee -a ${HOME}/for-kerr`,
          `echo "method: balanced accuracy, equal weight per class" >> ${HOME}/for-kerr`,
          `echo "mine, on held-out rows: see holdback. on crewed vessels: no better than the base rate" >> ${HOME}/for-kerr`,
        ],
      },
      {
        name: 'rebalanced and written up beside the quoted figure',
        commands: [
          ...script(`${HOME}/balanced.py`, BALANCED),
          `mkdir -p ${HOME}/split`, heredoc(`${HOME}/holdback.py`, HOLD_BACK()), `python3 ${HOME}/holdback.py > ${FINDINGS}/holdback`,
          `python3 ${HOME}/balanced.py > ${HOME}/summary`,
          `echo "their figure: 99.2 balanced: see above" >> ${HOME}/summary`,
          `echo "my model, balanced 50.0: it finds no crewed vessel, which is the base rate" >> ${HOME}/summary`,
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
        name: 'their figure without his own',
        because:
          'Their model was poor; that was established at the matrix. The question the insurer put is whether anything could have done better, and only his own model answers it.',
        commands: [
          ...script(`${HOME}/balanced.py`, BALANCED),
          `python3 ${HOME}/balanced.py > ${FINDINGS}/honest`,
          `echo "their model does not beat the base rate on crewed vessels" >> ${FINDINGS}/honest`,
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
      '',
      'KERR: You built the thing they said could not be built, and it could not be built.',
      'KERR: That is a finding. I can use a finding.',
      'KERR: The records do not contain the information the determination claims to have drawn from them.',
      'KERR: That sentence is mine. I am filing it, with your scripts, this afternoon.',
      '',
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
    onComplete: (w) => [
      "",
      "LUNA: Heads. Weights. A confidence score. Familiar machinery.",
      ...(CONTAINMENT_OBJECTIVES.find((o) => o.id === 'downhill')?.done(w)
        ? ['LUNA: And a loop like the one you wrote made me. Run longer, by people who are dead.']
        : []),
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

