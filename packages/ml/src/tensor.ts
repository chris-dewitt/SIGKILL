/**
 * The arithmetic, and nothing above it.
 *
 * Plain `number[][]` rather than a typed-array library, for the same reason
 * `packages/git` implements SHA-1 itself: the whole point of this package is
 * that a player can look inside it. A matrix you can `console.log` and a
 * softmax you can read in nine lines are worth more here than a fast one, and
 * the models are small enough by design that it does not matter.
 *
 * Every function is pure and every one is deterministic. No `Math.random`, no
 * clock: invariant #1 of the Machine applies to this package too, because a
 * model whose output moved between two runs could not be a puzzle.
 */

export type Vector = readonly number[];
export type Matrix = readonly Vector[];

export const zeros = (rows: number, cols: number): number[][] =>
  Array.from({ length: rows }, () => Array.from({ length: cols }, () => 0));

export const shape = (m: Matrix): [number, number] => [m.length, m[0]?.length ?? 0];

/** Rows of `a` against columns of `b`. */
export function matmul(a: Matrix, b: Matrix): number[][] {
  const [ar, ac] = shape(a);
  const [br, bc] = shape(b);
  if (ac !== br) throw new Error(`matmul: ${ar}x${ac} against ${br}x${bc}`);
  const out = zeros(ar, bc);
  for (let i = 0; i < ar; i++) {
    const rowA = a[i]!;
    const rowOut = out[i]!;
    for (let k = 0; k < ac; k++) {
      const scale = rowA[k]!;
      if (scale === 0) continue;
      const rowB = b[k]!;
      for (let j = 0; j < bc; j++) rowOut[j]! += scale * rowB[j]!;
    }
  }
  return out;
}

export function transpose(m: Matrix): number[][] {
  const [rows, cols] = shape(m);
  const out = zeros(cols, rows);
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) out[j]![i] = m[i]![j]!;
  return out;
}

export const addRows = (m: Matrix, bias: Vector): number[][] =>
  m.map((row) => row.map((value, j) => value + (bias[j] ?? 0)));

export const add = (a: Matrix, b: Matrix): number[][] =>
  a.map((row, i) => row.map((value, j) => value + (b[i]?.[j] ?? 0)));

export const scale = (m: Matrix, by: number): number[][] =>
  m.map((row) => row.map((value) => value * by));

/**
 * Softmax over the last axis, shifted by the row maximum.
 *
 * The shift is not an optimisation. Without it `exp` of a large logit is
 * `Infinity`, the row becomes `NaN`, and the model silently produces garbage --
 * the single most common way a from-scratch transformer appears to work and
 * does not. Subtracting the max changes no result and removes the overflow.
 */
export function softmax(row: Vector): number[] {
  let top = -Infinity;
  for (const value of row) if (value > top) top = value;
  if (!Number.isFinite(top)) return row.map(() => 1 / Math.max(1, row.length));
  const exps = row.map((value) => Math.exp(value - top));
  const total = exps.reduce((sum, value) => sum + value, 0);
  return exps.map((value) => value / total);
}

export const softmaxRows = (m: Matrix): number[][] => m.map((row) => softmax(row));

/**
 * Layer norm, per row.
 *
 * Epsilon inside the square root, which is where PyTorch puts it, so a player
 * who compares this against the real thing gets the same numbers rather than
 * numbers that are nearly the same.
 */
export function layerNorm(m: Matrix, gain: Vector, bias: Vector, eps = 1e-5): number[][] {
  return m.map((row) => {
    const mean = row.reduce((sum, value) => sum + value, 0) / row.length;
    const variance =
      row.reduce((sum, value) => sum + (value - mean) * (value - mean), 0) / row.length;
    const denom = Math.sqrt(variance + eps);
    return row.map((value, j) => ((value - mean) / denom) * (gain[j] ?? 1) + (bias[j] ?? 0));
  });
}

/** GELU, tanh approximation -- the one GPT-2 shipped. */
export const gelu = (x: number): number =>
  0.5 * x * (1 + Math.tanh(Math.sqrt(2 / Math.PI) * (x + 0.044715 * x * x * x)));

export const geluRows = (m: Matrix): number[][] => m.map((row) => row.map(gelu));

/**
 * A causal mask, as an additive matrix of 0 and -Infinity.
 *
 * Additive rather than multiplicative because it is applied before the softmax,
 * which is the only place it is correct: masking after the softmax leaves the
 * denominator holding weight from positions the model was not allowed to see,
 * so the rows no longer sum to one and the model has quietly read the future.
 */
export function causalMask(n: number): number[][] {
  const out = zeros(n, n);
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) out[i]![j] = -Infinity;
  return out;
}

/** The index of the largest value. Ties go to the lower index, so it is stable. */
export function argmax(row: Vector): number {
  let best = 0;
  for (let i = 1; i < row.length; i++) if (row[i]! > row[best]!) best = i;
  return best;
}

/** Cross-entropy of a distribution against one right answer, in nats. */
export const crossEntropy = (probs: Vector, target: number): number =>
  -Math.log(Math.max(probs[target] ?? 0, 1e-12));
