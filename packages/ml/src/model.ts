import {
  addRows,
  argmax,
  causalMask,
  geluRows,
  layerNorm,
  matmul,
  softmax,
  softmaxRows,
  transpose,
  zeros,
  type Matrix,
  type Vector,
} from './tensor.js';

/**
 * A real transformer, small enough to read.
 *
 * Decoder-only, pre-norm, learned positional embeddings, multi-head causal
 * attention, GELU MLP, weight-tied output head -- the GPT-2 shape, at a size
 * where every intermediate is small enough to print on a phone.
 *
 * The thing that matters for the game is {@link Trace}. A model that only
 * returned logits would be a black box with extra steps, and the whole locked
 * decision for this adventure is a *glass* box: the player is supposed to see
 * which position each head looked at and why. So every forward pass hands back
 * its attention matrices, its residual stream at each layer, and the logits,
 * and the renderer draws them. Nothing here is instrumentation bolted on
 * afterwards; the trace is the return value.
 */

export interface ModelConfig {
  /** Token count. */
  readonly vocab: number;
  /** Residual width. */
  readonly dModel: number;
  readonly heads: number;
  readonly layers: number;
  /** Longest sequence the positional table covers. */
  readonly context: number;
  /** MLP inner width. Four times `dModel`, as everybody does. */
  readonly dFF: number;
}

/** One attention head's parameters. Shapes are [dModel x dHead]. */
export interface HeadWeights {
  readonly wq: Matrix;
  readonly wk: Matrix;
  readonly wv: Matrix;
  /** [dHead x dModel] -- writes back into the residual stream. */
  readonly wo: Matrix;
}

export interface LayerWeights {
  readonly heads: readonly HeadWeights[];
  readonly ln1Gain: Vector;
  readonly ln1Bias: Vector;
  readonly ln2Gain: Vector;
  readonly ln2Bias: Vector;
  readonly wIn: Matrix;
  readonly bIn: Vector;
  readonly wOut: Matrix;
  readonly bOut: Vector;
}

export interface Weights {
  readonly config: ModelConfig;
  /** [vocab x dModel] */
  readonly embed: Matrix;
  /** [context x dModel] */
  readonly pos: Matrix;
  readonly layers: readonly LayerWeights[];
  readonly lnFGain: Vector;
  readonly lnFBias: Vector;
  /**
   * [dModel x vocab], or absent to tie the output head to the embeddings.
   *
   * Tying is the default because it is what small models do and because it
   * makes the glass box legible: "the model predicts the token whose embedding
   * the residual stream now points at" is a sentence a player can hold.
   */
  readonly unembed?: Matrix;
}

/** What one head did at one position. */
export interface HeadTrace {
  /** [seq x seq], row `i` summing to 1 -- where position `i` looked. */
  readonly attention: Matrix;
}

export interface LayerTrace {
  readonly heads: readonly HeadTrace[];
  /** The residual stream after this layer. [seq x dModel] */
  readonly residual: Matrix;
}

export interface Trace {
  readonly tokens: readonly number[];
  /** Embeddings plus positions, before any layer. */
  readonly embedded: Matrix;
  readonly layers: readonly LayerTrace[];
  /** [seq x vocab] */
  readonly logits: Matrix;
}

const headSize = (config: ModelConfig): number => Math.floor(config.dModel / config.heads);

/**
 * One head, returning its attention alongside its output.
 *
 * Scaled by 1/sqrt(dHead) before the mask, which is the order that matters: the
 * scale exists to keep the logits in a range where softmax has a gradient, and
 * applying it after masking would scale -Infinity, which is still -Infinity but
 * says the author did not know why the scale was there.
 */
function attend(x: Matrix, w: HeadWeights, dHead: number, mask: Matrix) {
  const q = matmul(x, w.wq);
  const k = matmul(x, w.wk);
  const v = matmul(x, w.wv);

  const raw = matmul(q, transpose(k));
  const scaled = raw.map((row, i) => row.map((value, j) => value / Math.sqrt(dHead) + mask[i]![j]!));
  const attention = softmaxRows(scaled);

  return { attention, out: matmul(matmul(attention, v), w.wo) };
}

/** Run the model over a token sequence and report everything it did. */
export function forward(weights: Weights, tokens: readonly number[]): Trace {
  const { config } = weights;
  if (tokens.length === 0) throw new Error('forward: no tokens');
  if (tokens.length > config.context) {
    throw new Error(`forward: ${tokens.length} tokens exceeds context ${config.context}`);
  }
  for (const token of tokens) {
    if (!Number.isInteger(token) || token < 0 || token >= config.vocab) {
      throw new Error(`forward: token ${token} outside vocabulary of ${config.vocab}`);
    }
  }

  const dHead = headSize(config);
  const mask = causalMask(tokens.length);

  // Embeddings plus positions. Both learned, both just table lookups.
  let x: Matrix = tokens.map((token, i) =>
    weights.embed[token]!.map((value, j) => value + (weights.pos[i]?.[j] ?? 0)),
  );
  const embedded = x;

  const layerTraces: LayerTrace[] = [];
  for (const layer of weights.layers) {
    // Pre-norm: normalise going in, and add the block's output to the stream
    // rather than replacing it. The residual stream is the thing the glass box
    // is about -- every block reads it and writes back to it.
    const normed = layerNorm(x, layer.ln1Gain, layer.ln1Bias);
    const heads: HeadTrace[] = [];
    let attnOut = zeros(tokens.length, config.dModel);
    for (const head of layer.heads) {
      const { attention, out } = attend(normed, head, dHead, mask);
      heads.push({ attention });
      attnOut = attnOut.map((row, i) => row.map((value, j) => value + out[i]![j]!));
    }
    x = x.map((row, i) => row.map((value, j) => value + attnOut[i]![j]!));

    const normed2 = layerNorm(x, layer.ln2Gain, layer.ln2Bias);
    const hidden = geluRows(addRows(matmul(normed2, layer.wIn), layer.bIn));
    const mlp = addRows(matmul(hidden, layer.wOut), layer.bOut);
    x = x.map((row, i) => row.map((value, j) => value + mlp[i]![j]!));

    layerTraces.push({ heads, residual: x });
  }

  const final = layerNorm(x, weights.lnFGain, weights.lnFBias);
  const head = weights.unembed ?? transpose(weights.embed);
  return { tokens: [...tokens], embedded, layers: layerTraces, logits: matmul(final, head) };
}

/** The distribution over the next token, given a prompt. */
export function nextTokenProbs(weights: Weights, tokens: readonly number[]): number[] {
  const trace = forward(weights, tokens);
  return softmax(trace.logits[trace.logits.length - 1]!);
}

/**
 * Deterministic sampling.
 *
 * `temperature` of 0 means argmax, and anything above it draws against a seeded
 * generator the caller supplies. There is no unseeded path on purpose: a model
 * that answered differently on two runs of the same save could not be the
 * subject of an objective, and "it is random" is the one excuse this engine
 * does not get to make.
 */
export interface SampleOptions {
  readonly temperature?: number;
  /** Returns the next value in [0, 1). Required once temperature is above 0. */
  readonly random?: () => number;
  /** Keep only the k most likely tokens before drawing. */
  readonly topK?: number;
}

export function sample(probs: readonly number[], opts: SampleOptions = {}): number {
  const temperature = opts.temperature ?? 0;
  if (temperature <= 0) return argmax(probs);

  // Re-temper the distribution through its logs, which is the same thing as
  // dividing the logits and keeps this function usable on probabilities.
  let weighted = probs.map((p) => Math.exp(Math.log(Math.max(p, 1e-12)) / temperature));

  if (opts.topK !== undefined && opts.topK > 0 && opts.topK < weighted.length) {
    const cutoff = [...weighted].sort((a, b) => b - a)[opts.topK - 1]!;
    weighted = weighted.map((value) => (value >= cutoff ? value : 0));
  }

  const total = weighted.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return argmax(probs);

  const draw = (opts.random ?? (() => 0))() * total;
  let running = 0;
  for (let i = 0; i < weighted.length; i++) {
    running += weighted[i]!;
    if (draw < running) return i;
  }
  return weighted.length - 1;
}

/** Continue a prompt, one token at a time, up to `count` new tokens. */
export function generate(
  weights: Weights,
  prompt: readonly number[],
  count: number,
  opts: SampleOptions = {},
): number[] {
  const out = [...prompt];
  for (let i = 0; i < count && out.length < weights.config.context; i++) {
    out.push(sample(nextTokenProbs(weights, out), opts));
  }
  return out.slice(prompt.length);
}

/**
 * Read the sequence as a decision rather than as a continuation.
 *
 * `occupancy-v4` in game five reports two classes, not a next token, and that
 * is the same logits read a different way: take the final position's residual,
 * normalise it as the model always does, and project it onto one column per
 * class. Separate from `forward` because the trace is the same either way --
 * the player inspecting attention should see the identical picture whether the
 * head on top is counting tokens or answering a yes/no.
 *
 * `head` is [dModel x classes].
 */
export function classify(
  weights: Weights,
  tokens: readonly number[],
  head: Matrix,
): { readonly probs: number[]; readonly trace: Trace } {
  const trace = forward(weights, tokens);
  const last = trace.layers[trace.layers.length - 1]?.residual ?? trace.embedded;
  const final = layerNorm(last, weights.lnFGain, weights.lnFBias);
  const row = final[final.length - 1]!;
  const scores = matmul([row], head)[0]!;
  return { probs: softmax(scores), trace };
}

/**
 * Which position each head attended to most, at the last token.
 *
 * The one-line summary the terminal shows before anybody asks for the whole
 * matrix: "head 0 looked at position 3", which is the sentence that makes an
 * attention head a thing rather than a word.
 */
export function focus(trace: Trace, layer = 0): number[] {
  const at = trace.layers[layer];
  if (at === undefined) return [];
  const last = trace.tokens.length - 1;
  return at.heads.map((head) => argmax(head.attention[last]!));
}
