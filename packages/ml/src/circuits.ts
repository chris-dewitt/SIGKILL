import { zeros, type Matrix, type Vector } from './tensor.js';
import type { HeadWeights, LayerWeights, ModelConfig, Weights } from './model.js';

/**
 * Weights built by hand, so that attention is doing something a player can
 * name.
 *
 * This is the part of the glass box that had to be decided rather than
 * discovered. A transformer with random weights has attention patterns, and
 * they are noise; drawing noise on the CRT and calling it a glass box would be
 * the interface lying. Training one in-game is not possible at a size that
 * fits on a phone and would not be deterministic.
 *
 * So the teaching models are *constructed*. Every weight below is placed
 * deliberately to implement one known circuit, the residual stream has a
 * documented layout, and the resulting attention is exactly the picture the
 * mechanism implies -- a bright diagonal one step below the leading one, for a
 * head that reads the previous token. The model is real: the same `forward`
 * runs it as would run a trained one, through genuine softmax attention and a
 * genuine residual stream. What is authored is which circuit it implements.
 *
 * The layout, for every model here:
 *
 *   dims [0, context)            position, one-hot
 *   dims [dHead, dHead + vocab)  token identity, one-hot
 *
 * Two halves, one per head, so head 0 can read position and head 1 can read
 * token identity without either having to share a projection.
 */

/** How sharply a constructed head commits. Large enough to survive layer norm. */
export const GAIN = 24;

/** A config whose dimensions the constructions below can actually satisfy. */
export function glassBoxConfig(vocab: number, context: number): ModelConfig {
  const dHead = Math.max(vocab, context);
  return { vocab, context, dModel: dHead * 2, heads: 2, layers: 1, dFF: dHead * 2 };
}

const POS_AT = 0;
const tokenAt = (config: ModelConfig): number => Math.floor(config.dModel / config.heads);

/** One-hot token embeddings, in the token half of the stream. */
export function embeddings(config: ModelConfig): number[][] {
  const out = zeros(config.vocab, config.dModel);
  for (let t = 0; t < config.vocab; t++) out[t]![tokenAt(config) + t] = 1;
  return out;
}

/** One-hot positional embeddings, in the positional half. */
export function positions(config: ModelConfig): number[][] {
  const out = zeros(config.context, config.dModel);
  for (let i = 0; i < config.context; i++) out[i]![POS_AT + i] = 1;
  return out;
}

const ones = (n: number): number[] => Array.from({ length: n }, () => 1);
const nil = (n: number): number[] => Array.from({ length: n }, () => 0);

/** A head that reads and writes nothing. Its attention is uniform, honestly so. */
export function idleHead(config: ModelConfig): HeadWeights {
  const dHead = tokenAt(config);
  return {
    wq: zeros(config.dModel, dHead),
    wk: zeros(config.dModel, dHead),
    wv: zeros(config.dModel, dHead),
    wo: zeros(dHead, config.dModel),
  };
}

/**
 * The previous-token head.
 *
 * QK reads position only: the query at position `i` is the one-hot for `i - 1`
 * and the key at `j` is the one-hot for `j`, so the score peaks exactly when
 * `j == i - 1`. OV reads token identity only, and writes it back unchanged --
 * so the head's whole output at position `i` is "the token at `i - 1`".
 *
 * Position 0 has no previous token, so its query is all zeros and its attention
 * is uniform over the one position it may see, which is itself. That is not a
 * special case in the code and should not be hidden in the picture either.
 */
export function previousTokenHead(config: ModelConfig): HeadWeights {
  const dHead = tokenAt(config);
  const wq = zeros(config.dModel, dHead);
  const wk = zeros(config.dModel, dHead);
  const wv = zeros(config.dModel, dHead);
  const wo = zeros(dHead, config.dModel);

  for (let i = 1; i < config.context; i++) wq[POS_AT + i]![i - 1] = GAIN;
  for (let j = 0; j < config.context; j++) wk[POS_AT + j]![j] = 1;
  for (let t = 0; t < config.vocab; t++) {
    wv[tokenAt(config) + t]![t] = 1;
    wo[t]![tokenAt(config) + t] = 1;
  }
  return { wq, wk, wv, wo };
}

/**
 * A head that matches on content: it looks for earlier positions holding the
 * same token as the current one.
 *
 * QK reads token identity on both sides, so the score is high wherever the
 * token repeats. This is half of an induction head -- the half that finds the
 * earlier occurrence. The other half, attending one step *past* the match, is
 * what {@link inductionModel} composes it with.
 */
export function sameTokenHead(config: ModelConfig): HeadWeights {
  const dHead = tokenAt(config);
  const wq = zeros(config.dModel, dHead);
  const wk = zeros(config.dModel, dHead);
  const wv = zeros(config.dModel, dHead);
  const wo = zeros(dHead, config.dModel);

  for (let t = 0; t < config.vocab; t++) {
    wq[tokenAt(config) + t]![t] = GAIN;
    wk[tokenAt(config) + t]![t] = 1;
    // Carry the position of whatever it matched, so a second head could use it.
    wv[POS_AT + t]![t] = 1;
    wo[t]![POS_AT + t] = 1;
  }
  return { wq, wk, wv, wo };
}

/**
 * A head that attends to one particular token wherever it appears, and does
 * not care what the query is.
 *
 * This is the shortcut. It is how a classifier comes to be 99.2% accurate at
 * the wrong question: the query is effectively constant, so every position asks
 * the same thing -- "where is token `marker`?" -- and the decision is carried
 * by whatever that token happens to correlate with in the training data.
 *
 * It is built here rather than trained because the failure has to be *visible*.
 * A player who runs the glass box on a model with this head sees one column lit
 * all the way down, which is the picture of a model reading the letterhead
 * instead of the letter, and no amount of accuracy makes that column move.
 */
export function spuriousTokenHead(config: ModelConfig, marker: number): HeadWeights {
  const dHead = tokenAt(config);
  const wq = zeros(config.dModel, dHead);
  const wk = zeros(config.dModel, dHead);
  const wv = zeros(config.dModel, dHead);
  const wo = zeros(dHead, config.dModel);

  // Every position's query is the same, because it is built from the positional
  // one-hot that every position has exactly one of.
  for (let i = 0; i < config.context; i++) wq[POS_AT + i]![0] = GAIN;
  // Only the marker token answers it.
  wk[tokenAt(config) + marker]![0] = 1;
  // And what it carries back is the marker's own identity, so the decision head
  // downstream is reading the presence of the marker and nothing else.
  for (let t = 0; t < config.vocab; t++) {
    wv[tokenAt(config) + t]![t] = 1;
    wo[t]![tokenAt(config) + t] = 1;
  }
  return { wq, wk, wv, wo };
}

/**
 * A two-class head: [dModel x 2].
 *
 * `positive` is the token whose presence pushes towards class 1. Weight-tied in
 * spirit to the embeddings -- the class score is how much the residual stream
 * points at that token -- which keeps "the model predicts the class whose
 * evidence it is carrying" a sentence a player can hold.
 */
export function twoClassHead(config: ModelConfig, positive: number): number[][] {
  const head = zeros(config.dModel, 2);
  head[tokenAt(config) + positive]![1] = 1;
  for (let t = 0; t < config.vocab; t++) {
    if (t !== positive) head[tokenAt(config) + t]![0] = 1 / Math.max(1, config.vocab - 1);
  }
  return head;
}

/** The shortcut model: it decides by looking for one token. */
export const shortcutModel = (vocab: number, context: number, marker: number): Weights => {
  const config = glassBoxConfig(vocab, context);
  return assemble(config, [spuriousTokenHead(config, marker), idleHead(config)]);
};

function layerOf(config: ModelConfig, heads: readonly HeadWeights[]): LayerWeights {
  return {
    heads,
    ln1Gain: ones(config.dModel),
    ln1Bias: nil(config.dModel),
    ln2Gain: ones(config.dModel),
    ln2Bias: nil(config.dModel),
    // The MLP is present and deliberately inert: a zeroed second block keeps
    // the picture about attention, and a player who prints it sees that the
    // part doing the work is the part the act is about.
    wIn: zeros(config.dModel, config.dFF),
    bIn: nil(config.dFF),
    wOut: zeros(config.dFF, config.dModel),
    bOut: nil(config.dModel),
  };
}

function assemble(config: ModelConfig, heads: readonly HeadWeights[]): Weights {
  return {
    config,
    embed: embeddings(config),
    pos: positions(config),
    layers: [layerOf(config, heads)],
    lnFGain: ones(config.dModel),
    lnFBias: nil(config.dModel),
  };
}

/**
 * The model the act opens on: it predicts that the previous token repeats.
 *
 * Head 0 does all of it. Head 1 is idle, which is the contrast that makes head
 * 0 legible -- one bright offset diagonal next to one flat grey band.
 */
export const previousTokenModel = (vocab: number, context: number): Weights => {
  const config = glassBoxConfig(vocab, context);
  return assemble(config, [previousTokenHead(config), idleHead(config)]);
};

/** Both heads active: one reads position, one reads content. */
export const inductionModel = (vocab: number, context: number): Weights => {
  const config = glassBoxConfig(vocab, context);
  return assemble(config, [previousTokenHead(config), sameTokenHead(config)]);
};

/** Gain turned down, so the same circuit hedges instead of committing. */
export function softened(weights: Weights, by: number): Weights {
  const scaleMatrix = (m: Matrix): number[][] => m.map((row) => row.map((v) => v * by));
  return {
    ...weights,
    layers: weights.layers.map((layer) => ({
      ...layer,
      heads: layer.heads.map((head) => ({ ...head, wq: scaleMatrix(head.wq) })),
    })),
  };
}

/** Every weight in a model, flattened -- for the objective that counts them. */
export function parameterCount(weights: Weights): number {
  const size = (m: Matrix): number => m.reduce((sum, row) => sum + row.length, 0);
  const vec = (v: Vector): number => v.length;
  let total = size(weights.embed) + size(weights.pos) + vec(weights.lnFGain) + vec(weights.lnFBias);
  for (const layer of weights.layers) {
    for (const head of layer.heads) {
      total += size(head.wq) + size(head.wk) + size(head.wv) + size(head.wo);
    }
    total +=
      vec(layer.ln1Gain) +
      vec(layer.ln1Bias) +
      vec(layer.ln2Gain) +
      vec(layer.ln2Bias) +
      size(layer.wIn) +
      vec(layer.bIn) +
      size(layer.wOut) +
      vec(layer.bOut);
  }
  return total + (weights.unembed === undefined ? 0 : size(weights.unembed));
}
