/**
 * Text that arrives at a speed.
 *
 * The beats were dumping whole, which reads as a wall rather than as somebody
 * talking. Typing is the oldest trick a terminal has and it is the right one
 * here: ORACLE is a machine writing to a console, and the rhythm is the only
 * thing on this screen that can carry a pause.
 *
 * Time is injected rather than taken from the clock, so the rhythm -- how long
 * a full stop is worth, whether a page ever finishes -- is a unit test instead
 * of something you have to sit and watch.
 */

export interface TypistOptions {
  /** Milliseconds per ordinary character. Zero reveals everything at once. */
  charMs?: number;
  /** Extra pause after a full stop, a comma, a colon. */
  punctuationMs?: number;
  /** Extra pause at the end of a line. */
  newlineMs?: number;
  /**
   * The longest a page may take, however much text is on it.
   *
   * A rate alone is the wrong knob once pages can be different sizes: a
   * twenty-line page at a speed tuned for seven is somebody sitting watching
   * a machine type. The rate sets the feel and this sets the patience, and
   * the rate gives way.
   */
  budgetMs?: number;
}

export type TypingSpeed = 'off' | 'slow' | 'normal' | 'fast';

/**
 * The four speeds, because the right one is a matter of taste and nobody
 * should have to rebuild the game to find theirs.
 */
export const SPEEDS: Record<TypingSpeed, TypistOptions> = {
  off: { charMs: 0 },
  slow: { charMs: 13, punctuationMs: 110, newlineMs: 70, budgetMs: 6000 },
  normal: { charMs: 6, punctuationMs: 60, newlineMs: 40, budgetMs: 3200 },
  fast: { charMs: 2, punctuationMs: 24, newlineMs: 16, budgetMs: 1600 },
};

export const SPEED_NAMES = Object.keys(SPEEDS) as TypingSpeed[];

export function isSpeed(name: string | null): name is TypingSpeed {
  return name !== null && name in SPEEDS;
}

const PAUSE_AFTER = new Set(['.', ',', ':', ';', '?', '!', '—']);

/** What this text would cost at these rates, before any budget is applied. */
function estimate(text: string, charMs: number, punctuationMs: number, newlineMs: number): number {
  let total = text.length * charMs;
  for (const ch of text) {
    if (ch === '\n') total += newlineMs;
    else if (PAUSE_AFTER.has(ch)) total += punctuationMs;
  }
  return total;
}

export class Typist {
  private index = 0;
  private credit = 0;
  private readonly charMs: number;
  private readonly punctuationMs: number;
  private readonly newlineMs: number;

  constructor(private readonly text: string, opts: TypistOptions = {}) {
    let charMs = Math.max(0, opts.charMs ?? SPEEDS.normal.charMs ?? 6);
    let punctuationMs = Math.max(0, opts.punctuationMs ?? 0);
    let newlineMs = Math.max(0, opts.newlineMs ?? 0);

    // Fit the page to the budget rather than the budget to the page. A long
    // page types faster; a short one is unaffected, because most pages come
    // in well under it.
    const budget = opts.budgetMs;
    if (charMs > 0 && budget !== undefined && budget > 0) {
      const total = estimate(text, charMs, punctuationMs, newlineMs);
      if (total > budget) {
        const scale = budget / total;
        charMs *= scale;
        punctuationMs *= scale;
        newlineMs *= scale;
      }
    }

    this.charMs = charMs;
    this.punctuationMs = punctuationMs;
    this.newlineMs = newlineMs;
    if (this.charMs === 0) this.index = text.length;
  }

  get visible(): string {
    return this.text.slice(0, this.index);
  }

  get done(): boolean {
    return this.index >= this.text.length;
  }

  /** How many whole lines are showing. The host uses it to tick once a line. */
  get lines(): number {
    let count = 0;
    for (let i = 0; i < this.index; i++) if (this.text[i] === '\n') count++;
    return count;
  }

  /**
   * What a character is worth.
   *
   * A pause belongs *after* the mark, not before it, so the sentence lands and
   * then rests. Leading whitespace is free: an indented command should not
   * cost four beats of nothing.
   */
  private cost(index: number): number {
    const ch = this.text[index];
    if (ch === undefined) return 0;
    const previous = this.text[index - 1];
    if (previous === '\n') return this.charMs + this.newlineMs;
    if (previous !== undefined && PAUSE_AFTER.has(previous)) return this.charMs + this.punctuationMs;
    if (ch === ' ' || ch === '\n') return this.charMs;
    return this.charMs;
  }

  /** Advance by `ms` and return everything visible now. */
  advance(ms: number): string {
    if (this.done) return this.visible;
    this.credit += Math.max(0, ms);
    while (this.index < this.text.length) {
      const cost = this.cost(this.index);
      if (cost > this.credit) break;
      this.credit -= cost;
      this.index++;
    }
    return this.visible;
  }

  /** Skip to the end. What a tap does, and what reduced motion does at birth. */
  finish(): string {
    this.index = this.text.length;
    this.credit = 0;
    return this.visible;
  }
}
