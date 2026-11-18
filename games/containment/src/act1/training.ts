import { DISCLOSURE, HOME } from './annexe.js';

/**
 * The repass: the player makes a model, and finds out what one can learn.
 *
 * GAME5_REPASS.md, approved 2026-10-20. The insurer's answer to the honest
 * number is that nobody could have done better from those records, and Kerr
 * will not accept an opinion in reply. So DeWitt trains one himself, from the
 * insurer's own training file, in plain Python: the loss, the gradient, the
 * loop. No NumPy -- it is not bundled, and the gradient being a line he wrote
 * is the lesson.
 *
 * These are the scripts the hint ladders hand over and the routes run. They
 * live here so the objectives, the ladders and the tests share one copy, and
 * so the numbers the beats quote are numbers these scripts print. The probe
 * that chose them (2026-11-17, against the seeded dataset):
 *
 *   vendor log loss          0.0862   constant model   0.0650
 *   downhill, rate 10        0.6931 -> 0.0676 in 100 steps, bias -4.44
 *   paperwork, 60 rows       train 0.0006   unseen 0.08+
 *   validation on that       lowest at step 40, then climbing
 *   own model on test.csv    98.8%, crewed found 0 of 6
 *
 * Every number the goals check is a band, not a string, because a player who
 * rounds to three places instead of four has done the work.
 */

/** Where `downhill` keeps what it learned, so the honest number can reuse it. */
export const MODEL_FILE = `${HOME}/model.json`;

/** Mean log loss of the vendor's scored file, and of always saying the base rate. */
export const VENDOR_LOSS = 0.0862;
export const CONSTANT_LOSS = 0.065;
/**
 * The constant model's loss on the training file, where `downhill` measures.
 *
 * 2000 rows at 1.3% crewed. A model that ends here has learned the base rate;
 * one that ends a little under it has found noise, which on these columns is
 * all there is to find.
 */
export const TRAIN_CONSTANT_LOSS = 0.0694;

/** Log loss: what a wrong answer costs, and how much more a confident one does. */
export const LOSS = [
  'import csv, math',
  '',
  'def log_loss(p, crewed):',
  '    p = min(max(p, 1e-12), 1 - 1e-12)',
  '    return -math.log(p) if crewed else -math.log(1 - p)',
  '',
  `rows = list(csv.DictReader(open("${DISCLOSURE}/labels.csv")))`,
  '',
  'def p_crewed(r):',
  '    c = float(r["confidence"])',
  '    return c if r["predicted"] == "crewed" else 1 - c',
  '',
  'vendor = sum(log_loss(p_crewed(r), r["truth"] == "crewed") for r in rows) / len(rows)',
  'rate = sum(1 for r in rows if r["truth"] == "crewed") / len(rows)',
  'constant = sum(log_loss(rate, r["truth"] == "crewed") for r in rows) / len(rows)',
  'print("vendor log loss", round(vendor, 4))',
  'print("constant log loss", round(constant, 4))',
];

/**
 * Logistic regression by hand, on the two columns that are numbers.
 *
 * Centred and scaled so the weights start on equal terms; the bias then does
 * nearly all the work, and that is the finding -- the model rediscovers the
 * base rate one step at a time, because that is everything those columns
 * contain.
 */
export const DOWNHILL = (rate = 10, steps = 100): string[] => [
  'import csv, json, math',
  '',
  `rows = list(csv.DictReader(open("${DISCLOSURE}/train.csv")))`,
  '',
  'def features(r):',
  '    return [(int(r["transits"]) - 20) / 20, (int(r["days_since_filing"]) - 450) / 450]',
  '',
  'def sigmoid(z):',
  '    return 1 / (1 + math.exp(-max(min(z, 35), -35)))',
  '',
  'X = [features(r) for r in rows]',
  'Y = [1 if r["label"] == "crewed" else 0 for r in rows]',
  `w, b, rate = [0.0, 0.0], 0.0, ${rate}`,
  '',
  `for step in range(1, ${steps + 1}):`,
  '    gw, gb, loss = [0.0, 0.0], 0.0, 0.0',
  '    for x, y in zip(X, Y):',
  '        p = min(max(sigmoid(b + w[0] * x[0] + w[1] * x[1]), 1e-12), 1 - 1e-12)',
  '        loss -= math.log(p) if y else math.log(1 - p)',
  '        gb += p - y',
  '        gw[0] += (p - y) * x[0]',
  '        gw[1] += (p - y) * x[1]',
  '    n = len(X)',
  '    b -= rate * gb / n',
  '    w = [w[0] - rate * gw[0] / n, w[1] - rate * gw[1] / n]',
  '    print("step", step, "loss", round(loss / n, 4))',
  '',
  `json.dump({"w": w, "b": b}, open("${MODEL_FILE}", "w"))`,
  'print("weights", [round(v, 3) for v in w], "bias", round(b, 3))',
];

/** The paperwork columns, one-hot, shared by the next two scripts. */
const PAPERWORK_HELPERS = [
  'import csv, math',
  '',
  `rows = list(csv.DictReader(open("${DISCLOSURE}/train.csv")))`,
  'FILINGS = ["commercial", "bulk", "research", "tender"]',
  'GRANTS = ["NONE", "PUB-4", "PRIV-7"]',
  '',
  'def features(r):',
  '    return ([1.0 if r["filing"] == f else 0.0 for f in FILINGS]',
  '            + [1.0 if r["grant"] == g else 0.0 for g in GRANTS])',
  '',
  'def sigmoid(z):',
  '    return 1 / (1 + math.exp(-max(min(z, 35), -35)))',
  '',
  'def loss(data, w, b):',
  '    total = 0.0',
  '    for r in data:',
  '        p = sigmoid(b + sum(a * c for a, c in zip(w, features(r))))',
  '        p = min(max(p, 1e-12), 1 - 1e-12)',
  '        total -= math.log(p) if r["label"] == "crewed" else math.log(1 - p)',
  '    return total / len(data)',
  '',
  'def step(data, w, b, rate):',
  '    gw, gb = [0.0] * len(w), 0.0',
  '    for r in data:',
  '        x = features(r)',
  '        y = 1 if r["label"] == "crewed" else 0',
  '        p = sigmoid(b + sum(a * c for a, c in zip(w, x)))',
  '        gb += p - y',
  '        gw = [g + (p - y) * xi for g, xi in zip(gw, x)]',
  '    n = len(data)',
  '    return [wi - rate * g / n for wi, g in zip(w, gw)], b - rate * gb / n',
  '',
];

/**
 * Give it the paperwork and a small sample, and let it run.
 *
 * Sixty rows, which include both leaked tenders -- so it learns "a tender is
 * crewed", the same shortcut the vendor's model learned, and drives its loss
 * on those sixty to almost nothing while getting worse on everything else.
 */
export const PAPERWORK = (sample = 60, steps = 1000): string[] => [
  ...PAPERWORK_HELPERS,
  `small, unseen = rows[:${sample}], rows[${sample}:]`,
  'w, b = [0.0] * 7, 0.0',
  `for i in range(${steps}):`,
  '    w, b = step(small, w, b, 5)',
  'print("train loss", round(loss(small, w, b), 4))',
  'print("unseen loss", round(loss(unseen, w, b), 4))',
];

/**
 * The cure: hold some back, stop where validation is lowest, test once.
 *
 * Three parts of the training file that share no row. The model trains on the
 * same sixty; every ten steps it is scored on the validation rows, and the
 * best weights are kept. The test rows are touched exactly once, at the end.
 */
export const HOLDOUT = [
  ...PAPERWORK_HELPERS,
  'train, valid, test = rows[:60], rows[1000:1500], rows[1500:]',
  'w, b = [0.0] * 7, 0.0',
  'best = None',
  'for i in range(1, 301):',
  '    w, b = step(train, w, b, 5)',
  '    if i % 10 == 0:',
  '        v = loss(valid, w, b)',
  '        print("step", i, "validation loss", round(v, 4))',
  '        if best is None or v < best[0]:',
  '            best = (v, i, list(w), b)',
  'print("best step", best[1])',
  'print("test loss", round(loss(test, best[2], best[3]), 4))',
];

/** The model from `downhill`, scored once on the evaluation file. */
export const OWN_MODEL = [
  'import csv, json, math',
  '',
  `m = json.load(open("${MODEL_FILE}"))`,
  `rows = list(csv.DictReader(open("${DISCLOSURE}/test.csv")))`,
  '',
  'def p(r):',
  '    x = [(int(r["transits"]) - 20) / 20, (int(r["days_since_filing"]) - 450) / 450]',
  '    return 1 / (1 + math.exp(-(m["b"] + m["w"][0] * x[0] + m["w"][1] * x[1])))',
  '',
  'calls = [p(r) > 0.5 for r in rows]',
  'crewed = [c for c, r in zip(calls, rows) if r["label"] == "crewed"]',
  'right = sum(1 for c, r in zip(calls, rows) if c == (r["label"] == "crewed"))',
  'print("own model accuracy", round(100.0 * right / len(rows), 1))',
  'print("own model crewed found", sum(crewed), "of", len(crewed))',
];

/** A whole script as one non-interactive command: a here-document. */
export const heredoc = (path: string, body: readonly string[]): string =>
  `cat > ${path} <<'EOF'\n${body.join('\n')}\nEOF`;
