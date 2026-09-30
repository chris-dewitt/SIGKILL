/**
 * The insurer's evaluation, as files.
 *
 * Every number the act turns on is *computed from these rows by the player*, in
 * Python, so the rows have to genuinely carry them. That is the hard part of
 * this file and the reason it is generated rather than typed: 99.2% accuracy
 * against a 98.8% base rate, 41 leaked records, and two of six crewed vessels
 * found -- both of them leaked -- are four claims that have to be
 * simultaneously true of one dataset, and hand-writing five hundred rows to
 * satisfy all four is how you end up shipping an act whose arithmetic does not
 * close.
 *
 * So the generator below produces them exactly, a test asserts each one, and
 * the objectives can be written against numbers that are known to be there.
 *
 * Nothing here is random. The jitter in the confidence column comes from a
 * seeded generator, because a dataset that differed between two boots could
 * not be the subject of an objective, and because the player is going to
 * compute a mean and it has to be the same mean.
 */

/** Seed for the confidence jitter. A constant, never the clock. */
const SEED = 0x0c07;

/** One step of the generator every other authored dataset in this repo uses. */
function generator(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

// ---------------------------------------------------------------- the shape

/** Rows in the evaluation set as the vendor shipped it. */
export const TEST_ROWS = 500;
/** Rows in the training set. */
export const TRAIN_ROWS = 2000;
/** Crewed vessels in the evaluation set. Six, out of five hundred. */
export const CREWED_IN_TEST = 6;
/** Records that appear in both splits. The finding of objective six. */
export const LEAKED = 41;
/**
 * Crewed vessels the model calls correctly -- and both are leaked rows, so on
 * a split it has not memorised it finds none at all.
 */
export const CREWED_FOUND = 2;

/** The classifier's two answers. */
export type Verdict = 'abandoned' | 'crewed';

export interface Row {
  readonly id: string;
  /** Filing class. Research vessels under a private grant file differently. */
  readonly filing: string;
  /** The grant-code prefix. This is the shortcut. */
  readonly grant: string;
  readonly transits: number;
  readonly lastFiling: number;
  readonly truth: Verdict;
}

export interface Scored {
  readonly id: string;
  readonly truth: Verdict;
  readonly predicted: Verdict;
  /** What the model reported, 0 to 1. */
  readonly confidence: number;
}

export interface Dataset {
  readonly train: readonly Row[];
  readonly test: readonly Row[];
  readonly scored: readonly Scored[];
  /** Ids in both splits. */
  readonly leaked: readonly string[];
  /** NAV-7's own row, as submitted on the morning of the sixth. */
  readonly nav7: Row;
}

const FILINGS = ['commercial', 'commercial', 'commercial', 'bulk', 'tender', 'research'] as const;
const GRANTS = ['NONE', 'NONE', 'NONE', 'NONE', 'PUB-4', 'PRIV-7'] as const;

/**
 * Which test rows are crewed, and which of those the model gets right.
 *
 * Fixed positions rather than drawn, so the act's numbers do not move when the
 * generator changes. The two it finds sit inside the leaked block on purpose:
 * that is the whole link between objective six and objective seven.
 */
const CREWED_AT = [7, 23, 141, 203, 260, 417] as const;
const FOUND_AT = [7, 23] as const;

const idOf = (i: number): string => `T${String(i + 1).padStart(4, '0')}`;

/**
 * Test ids that also appear in training: the first 41 records.
 *
 * The block is contiguous and it starts at the beginning, which is not an
 * aesthetic choice -- it is where a split drawn off the top of an
 * un-deduplicated file would overlap, and it is why `set(train) & set(test)`
 * finds it rather than anything cleverer being required.
 *
 * Both crewed vessels the model gets right live inside this block. That is the
 * join between objective six and objective seven: remove what it memorised and
 * its recall on crewed vessels goes to nothing.
 */
const leakedIds = (): string[] => Array.from({ length: LEAKED }, (_, i) => idOf(i));

export function buildDataset(): Dataset {
  const random = generator(SEED);
  const crewed = new Set<number>(CREWED_AT);
  const found = new Set<number>(FOUND_AT);
  const leaks = new Set(leakedIds());

  const test: Row[] = [];
  const scored: Scored[] = [];

  for (let i = 0; i < TEST_ROWS; i++) {
    const isCrewed = crewed.has(i);
    const id = idOf(i);

    // The shortcut, planted: a private grant code is over-represented among the
    // crewed vessels, which is exactly the correlation the model latched onto
    // and exactly why it cannot generalise.
    const grant = isCrewed ? 'PRIV-7' : GRANTS[Math.floor(random() * GRANTS.length)]!;
    const filing = isCrewed ? 'research' : FILINGS[Math.floor(random() * FILINGS.length)]!;

    test.push({
      id,
      filing,
      grant,
      transits: Math.floor(random() * 40),
      lastFiling: Math.floor(random() * 900),
      truth: isCrewed ? 'crewed' : 'abandoned',
    });

    const predicted: Verdict = isCrewed && found.has(i) ? 'crewed' : 'abandoned';
    const right = predicted === (isCrewed ? 'crewed' : 'abandoned');

    /*
     * Confidence, and the part objective eight is made of.
     *
     * The four it gets wrong come back at 0.97 on average -- higher than a good
     * deal of what it gets right. That is not a bug in the model and it is not
     * dishonesty in the vendor: it is what an uncalibrated classifier does, and
     * the only way to know is to measure it against the errors.
     */
    const confidence = right
      ? 0.9 + random() * 0.09
      : 0.96 + (leaks.has(id) ? 0.02 : 0.015) + random() * 0.005;

    scored.push({ id, truth: test[i]!.truth, predicted, confidence });
  }

  // Training rows. The leaked ones are the same records, same ids, which is
  // what makes the intersection findable with a set and nothing cleverer.
  const train: Row[] = [];
  for (const id of leaks) {
    const row = test.find((r) => r.id === id);
    if (row !== undefined) train.push(row);
  }
  for (let i = train.length; i < TRAIN_ROWS; i++) {
    const isCrewed = i % 83 === 0;
    train.push({
      id: `R${String(i + 1).padStart(4, '0')}`,
      filing: isCrewed ? 'research' : FILINGS[Math.floor(random() * FILINGS.length)]!,
      grant: isCrewed ? 'PRIV-7' : GRANTS[Math.floor(random() * GRANTS.length)]!,
      transits: Math.floor(random() * 40),
      lastFiling: Math.floor(random() * 900),
      truth: isCrewed ? 'crewed' : 'abandoned',
    });
  }

  return {
    train,
    test,
    scored,
    leaked: [...leaks],
    /*
     * NAV-7, that morning. Everything about it is ordinary except the grant.
     *
     * Four people were aboard and one of them was asleep in berth 3. The row
     * says nothing about any of that, because the row has no field for it --
     * which is the quietest and worst fact in the act.
     */
    nav7: {
      id: 'NAV-7',
      filing: 'research',
      grant: 'PRIV-7',
      transits: 0,
      lastFiling: 41,
      truth: 'crewed',
    },
  };
}

// ---------------------------------------------------------------- as files

const csv = (header: string, rows: readonly string[]): string =>
  `${[header, ...rows].join('\n')}\n`;

export const trainCsv = (d: Dataset): string =>
  csv(
    'id,filing,grant,transits,days_since_filing,label',
    d.train.map((r) => `${r.id},${r.filing},${r.grant},${r.transits},${r.lastFiling},${r.truth}`),
  );

export const testCsv = (d: Dataset): string =>
  csv(
    'id,filing,grant,transits,days_since_filing,label',
    d.test.map((r) => `${r.id},${r.filing},${r.grant},${r.transits},${r.lastFiling},${r.truth}`),
  );

export const labelsCsv = (d: Dataset): string =>
  csv(
    'id,truth,predicted,confidence',
    d.scored.map((s) => `${s.id},${s.truth},${s.predicted},${s.confidence.toFixed(4)}`),
  );

/** The numbers the act claims, computed the way the player will compute them. */
export interface Metrics {
  readonly accuracy: number;
  readonly baseRate: number;
  readonly crewedRecall: number;
  readonly crewedFound: number;
  readonly leaked: number;
  readonly meanConfidenceWhenWrong: number;
  /** Accuracy on a class-balanced subset, which is objective nine. */
  readonly balancedAccuracy: number;
}

export function metrics(d: Dataset): Metrics {
  const total = d.scored.length;
  const right = d.scored.filter((s) => s.predicted === s.truth).length;
  const abandoned = d.test.filter((r) => r.truth === 'abandoned').length;
  const crewed = d.scored.filter((s) => s.truth === 'crewed');
  const crewedRight = crewed.filter((s) => s.predicted === 'crewed').length;
  const wrong = d.scored.filter((s) => s.predicted !== s.truth);
  const trainIds = new Set(d.train.map((r) => r.id));

  // Balanced: recall on each class, averaged. The honest figure, and the one
  // that does not flatter a classifier for agreeing with the base rate.
  const abandonedScored = d.scored.filter((s) => s.truth === 'abandoned');
  const abandonedRecall =
    abandonedScored.filter((s) => s.predicted === 'abandoned').length / abandonedScored.length;
  const crewedRecall = crewed.length === 0 ? 0 : crewedRight / crewed.length;

  return {
    accuracy: right / total,
    baseRate: abandoned / total,
    crewedRecall,
    crewedFound: crewedRight,
    leaked: d.test.filter((r) => trainIds.has(r.id)).length,
    meanConfidenceWhenWrong:
      wrong.length === 0 ? 0 : wrong.reduce((sum, s) => sum + s.confidence, 0) / wrong.length,
    balancedAccuracy: (abandonedRecall + crewedRecall) / 2,
  };
}
