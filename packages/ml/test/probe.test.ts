import { describe, expect, it } from 'vitest';
import {
  argmax,
  causalMask,
  forward,
  focus,
  generate,
  glassBoxConfig,
  inductionModel,
  layerNorm,
  matmul,
  nextTokenProbs,
  parameterCount,
  previousTokenModel,
  sample,
  softmax,
  softened,
  Tokenizer,
} from '../src/index.js';

/**
 * The spike for game five's engine, kept.
 *
 * Policy: probe the engine with the new game's idiom before authoring the game.
 * Every question here is one an objective would rest on, and the central one is
 * the third: a hand-built circuit is only worth building if it survives layer
 * norm and softmax and still produces the picture the mechanism implies. If it
 * does not, the glass box is drawing noise and the design changes now rather
 * than after there is content on top of it.
 */

const VOCAB = 24;
const CONTEXT = 12;

describe('the arithmetic', () => {
  it('multiplies the way a matrix does', () => {
    expect(matmul([[1, 2], [3, 4]], [[5, 6], [7, 8]])).toEqual([[19, 22], [43, 50]]);
  });

  it('survives logits big enough to overflow exp', () => {
    const out = softmax([1000, 1001, 999]);
    expect(out.every(Number.isFinite)).toBe(true);
    expect(out.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
    expect(argmax(out)).toBe(1);
  });

  it('normalises a row to zero mean and unit variance', () => {
    const [row] = layerNorm([[1, 2, 3, 4]], [1, 1, 1, 1], [0, 0, 0, 0]);
    const mean = row!.reduce((a, b) => a + b, 0) / row!.length;
    expect(mean).toBeCloseTo(0, 6);
    const variance = row!.reduce((s, v) => s + (v - mean) ** 2, 0) / row!.length;
    expect(variance).toBeCloseTo(1, 4);
  });

  it('masks the future additively, before any softmax', () => {
    const mask = causalMask(3);
    expect(mask[0]![1]).toBe(-Infinity);
    expect(mask[2]![0]).toBe(0);
    // And a masked row still sums to one, which is the thing masking after the
    // softmax would break.
    expect(softmax([1, 1, 1].map((v, j) => v + mask[1]![j]!)).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
  });
});

describe('the forward pass is a real transformer', () => {
  it('reports a trace with a row per position and a logit per token', () => {
    const model = previousTokenModel(VOCAB, CONTEXT);
    const trace = forward(model, [3, 4, 5, 6]);
    expect(trace.logits).toHaveLength(4);
    expect(trace.logits[0]).toHaveLength(VOCAB);
    expect(trace.layers).toHaveLength(1);
    expect(trace.layers[0]!.heads).toHaveLength(2);
    expect(trace.layers[0]!.heads[0]!.attention).toHaveLength(4);
  });

  it('never lets a position attend to the future, and every row sums to one', () => {
    const trace = forward(inductionModel(VOCAB, CONTEXT), [2, 7, 2, 9, 4]);
    for (const layer of trace.layers) {
      for (const head of layer.heads) {
        for (const [i, row] of head.attention.entries()) {
          expect(row.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 8);
          for (let j = i + 1; j < row.length; j++) {
            expect(row[j], `position ${i} looked ahead at ${j}`).toBe(0);
          }
        }
      }
    }
  });

  it('refuses a token outside the vocabulary and a sequence past the context', () => {
    const model = previousTokenModel(VOCAB, CONTEXT);
    expect(() => forward(model, [VOCAB + 1])).toThrow(/outside vocabulary/);
    expect(() => forward(model, Array.from({ length: CONTEXT + 1 }, () => 1))).toThrow(/context/);
    expect(() => forward(model, [])).toThrow(/no tokens/);
  });
});

/*
 * The one that decides the design.
 */
describe('the constructed circuit does what it says', () => {
  it('attends to the previous position, at every position but the first', () => {
    const model = previousTokenModel(VOCAB, CONTEXT);
    const tokens = [5, 9, 2, 14, 2, 7, 3];
    const attention = forward(model, tokens).layers[0]!.heads[0]!.attention;

    for (let i = 1; i < tokens.length; i++) {
      const looked = argmax(attention[i]!);
      expect(looked, `position ${i} looked at ${looked}, not ${i - 1}`).toBe(i - 1);
      // And it is a commitment, not a lean -- which is what makes the picture
      // a bright diagonal rather than a grey smear.
      expect(attention[i]![i - 1], `position ${i} was not confident`).toBeGreaterThan(0.5);
    }
  });

  it('has nowhere to look at position zero, and says so uniformly', () => {
    const attention = forward(previousTokenModel(VOCAB, CONTEXT), [5, 9, 2]).layers[0]!.heads[0]!
      .attention;
    expect(attention[0]![0]).toBeCloseTo(1, 8);
  });

  it('predicts that the previous token repeats, which is the whole circuit', () => {
    const model = previousTokenModel(VOCAB, CONTEXT);
    const tokens = [4, 11, 6, 19];
    const probs = nextTokenProbs(model, tokens);
    // The token before the last one is 6, so that is what it expects next.
    expect(argmax(probs)).toBe(tokens[tokens.length - 2]);
  });

  it('keeps the idle head honestly idle: uniform, and contributing nothing', () => {
    const model = previousTokenModel(VOCAB, CONTEXT);
    const trace = forward(model, [3, 8, 1, 5]);
    const idle = trace.layers[0]!.heads[1]!.attention;
    for (const [i, row] of idle.entries()) {
      const allowed = i + 1;
      for (let j = 0; j <= i; j++) expect(row[j]).toBeCloseTo(1 / allowed, 8);
    }
  });

  it('matches on content in the second head of the induction model', () => {
    const model = inductionModel(VOCAB, CONTEXT);
    // Token 7 appears at 1 and again at 4. At position 4 the content head
    // should find the earlier 7 rather than the neighbour.
    const tokens = [3, 7, 2, 9, 7];
    const attention = forward(model, tokens).layers[0]!.heads[1]!.attention;
    const looked = argmax(attention[4]!);
    expect([1, 4], `content head looked at ${looked}`).toContain(looked);
    expect(attention[4]![1]!).toBeGreaterThan(attention[4]![2]!);
    expect(attention[4]![1]!).toBeGreaterThan(attention[4]![3]!);
  });

  it('hedges when the gain comes down, without changing what it believes', () => {
    const sharp = previousTokenModel(VOCAB, CONTEXT);
    const vague = softened(sharp, 0.05);
    const tokens = [4, 11, 6, 19];
    const a = forward(sharp, tokens).layers[0]!.heads[0]!.attention[3]!;
    const b = forward(vague, tokens).layers[0]!.heads[0]!.attention[3]!;
    expect(a[2]!).toBeGreaterThan(b[2]!);
    // Still leaning the same way, just not committed. That distinction is the
    // whole of "confidence is not correctness", which the act is built on.
    expect(argmax(b)).toBe(2);
  });

  it('summarises where each head looked, for the row above the matrix', () => {
    const trace = forward(previousTokenModel(VOCAB, CONTEXT), [1, 2, 3, 4, 5]);
    expect(focus(trace)[0]).toBe(3);
  });
});

describe('sampling is deterministic or it is nothing', () => {
  it('is argmax at temperature zero', () => {
    const probs = [0.1, 0.7, 0.2];
    expect(sample(probs)).toBe(1);
    expect(sample(probs, { temperature: 0 })).toBe(1);
  });

  it('uses the generator it was handed, and never a hidden one', () => {
    const probs = [0.25, 0.25, 0.25, 0.25];
    const first = sample(probs, { temperature: 1, random: () => 0.01 });
    const last = sample(probs, { temperature: 1, random: () => 0.99 });
    expect(first).toBe(0);
    expect(last).toBe(3);
  });

  it('narrows to the top k before drawing', () => {
    const probs = [0.6, 0.3, 0.09, 0.01];
    for (const r of [0.0, 0.5, 0.999]) {
      expect(sample(probs, { temperature: 1, topK: 1, random: () => r })).toBe(0);
    }
  });

  it('generates the same continuation twice from the same seed', () => {
    const model = previousTokenModel(VOCAB, CONTEXT);
    let seed = 7;
    const rng = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    const run = () => {
      seed = 7;
      return generate(model, [2, 5, 8], 4, { temperature: 0.9, random: rng });
    };
    expect(run()).toEqual(run());
  });

  it('is byte-identical across two forward passes', () => {
    const model = inductionModel(VOCAB, CONTEXT);
    const a = forward(model, [1, 4, 1, 9]);
    const b = forward(model, [1, 4, 1, 9]);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('the tokenizer is a table somebody can read', () => {
  it('reserves pad and unk, then keeps the authored order', () => {
    const t = new Tokenizer(['air', 'hull', 'seal']);
    expect(t.word(0)).toBe('<pad>');
    expect(t.word(1)).toBe('<unk>');
    expect(t.id('air')).toBe(2);
    expect(t.size).toBe(5);
  });

  it('shows an unknown word as unknown rather than dropping it', () => {
    const t = new Tokenizer(['air', 'hull']);
    expect(t.encode('air oxygen hull')).toEqual([2, 1, 3]);
    expect(t.decode(t.encode('air oxygen hull'))).toBe('air <unk> hull');
  });

  it('round-trips what it knows, case and punctuation aside', () => {
    const t = new Tokenizer(['air', 'hull', 'seal']);
    expect(t.decode(t.encode('Air, HULL; seal!'))).toBe('air hull seal');
  });
});

describe('the model is small enough to show somebody', () => {
  it('has a parameter count in the thousands, not the billions', () => {
    const count = parameterCount(previousTokenModel(VOCAB, CONTEXT));
    expect(count).toBeGreaterThan(1000);
    expect(count).toBeLessThan(500_000);
  });

  it('has an attention matrix that fits a phone at a real prompt length', () => {
    const config = glassBoxConfig(VOCAB, CONTEXT);
    expect(config.context).toBeLessThanOrEqual(16);
    expect(config.heads).toBe(2);
  });
});
