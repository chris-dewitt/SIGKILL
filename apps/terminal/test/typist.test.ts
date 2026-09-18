import { describe, expect, it } from 'vitest';
import { isSpeed, SPEEDS, Typist } from '../src/typist.js';

describe('Typist', () => {
  it('reveals nothing before any time has passed', () => {
    expect(new Typist('hello', { charMs: 10 }).visible).toBe('');
  });

  it('reveals a character per charMs and keeps the remainder', () => {
    const t = new Typist('hello', { charMs: 10 });
    expect(t.advance(25)).toBe('he');
    // The leftover 5ms is not thrown away: two more characters, not one.
    expect(t.advance(15)).toBe('hell');
  });

  it('rests after a full stop before starting the next sentence', () => {
    const quick = new Typist('a. b', { charMs: 1 });
    const slow = new Typist('a. b', { charMs: 1, punctuationMs: 100 });
    quick.advance(4);
    slow.advance(4);
    expect(quick.done).toBe(true);
    expect(slow.visible).toBe('a.');
    expect(slow.advance(100)).toBe('a. b');
  });

  it('rests at the end of a line', () => {
    const t = new Typist('a\nb', { charMs: 1, newlineMs: 50 });
    expect(t.advance(2)).toBe('a\n');
    expect(t.done).toBe(false);
    expect(t.advance(51)).toBe('a\nb');
  });

  it('is already finished at charMs 0, which is what `typing off` sets', () => {
    const t = new Typist('a long beat', SPEEDS.off);
    expect(t.done).toBe(true);
    expect(t.visible).toBe('a long beat');
  });

  it('counts whole lines, so the host can tick once per line', () => {
    const t = new Typist('one\ntwo\nthree', { charMs: 1 });
    t.advance(4);
    expect(t.lines).toBe(1);
    t.advance(100);
    expect(t.lines).toBe(2);
  });

  it('finishes on demand, which is what a tap does', () => {
    const t = new Typist('the whole page', { charMs: 50 });
    t.advance(50);
    expect(t.finish()).toBe('the whole page');
    expect(t.done).toBe(true);
  });

  it('always arrives, however long it takes', () => {
    const text = 'ORACLE: It stopped.\nORACLE: I want to say something about that.';
    const t = new Typist(text, SPEEDS.slow);
    for (let frame = 0; frame < 2000 && !t.done; frame++) t.advance(16.7);
    expect(t.done).toBe(true);
    expect(t.visible).toBe(text);
  });

  it('ignores a negative frame time rather than rewinding', () => {
    const t = new Typist('abc', { charMs: 10 });
    t.advance(10);
    expect(t.advance(-500)).toBe('a');
  });

  it('knows which names are speeds', () => {
    expect(isSpeed('fast')).toBe(true);
    expect(isSpeed('blistering')).toBe(false);
    expect(isSpeed(null)).toBe(false);
  });
});

describe('the budget', () => {
  it('lands a long page inside it, and leaves a short one alone', () => {
    const short = 'ORACLE: It started.';
    const long = Array.from({ length: 30 }, () => 'ORACLE: a line of about fifty characters, give or').join('\n');
    const budget = 3000;

    const run = (text: string): number => {
      const t = new Typist(text, { charMs: 20, punctuationMs: 150, newlineMs: 80, budgetMs: budget });
      let ms = 0;
      while (!t.done && ms < 60_000) { t.advance(10); ms += 10; }
      return ms;
    };

    // The long one is pulled back to the budget rather than taking 15 seconds.
    const taken = run(long);
    expect(taken).toBeGreaterThan(budget * 0.8);
    expect(taken).toBeLessThanOrEqual(budget + 50);

    // The short one is already well inside it and keeps the rate it was given.
    expect(run(short)).toBeLessThan(budget / 2);
  });

  it('leaves `off` off, budget or no budget', () => {
    expect(new Typist('anything', { charMs: 0, budgetMs: 10 }).done).toBe(true);
  });
});
