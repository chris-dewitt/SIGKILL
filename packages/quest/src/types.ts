import type { ServiceManager, Track, Vfs } from '@sigkill/machine';

/**
 * What an objective is allowed to look at.
 *
 * State, and only state. A predicate that inspected the player's typing would
 * turn a puzzle into a quiz with one accepted answer -- the exact thing this
 * engine exists to avoid. Both `Machine` and `ShellContext` satisfy this
 * structurally, so the same objective works from either side.
 */
export interface World {
  readonly vfs: Vfs;
  readonly services: ServiceManager;
}

/**
 * How much a rung gives away.
 *
 * The ladder always ends at `command`. A hint system that stops short of the
 * answer is a hint system that a stuck player quits over, and a player who
 * reads the answer still has to understand it to type the next one.
 */
export type HintTier = 'nudge' | 'direction' | 'command';

export const TIER_ORDER: readonly HintTier[] = ['nudge', 'direction', 'command'];

export interface Rung {
  readonly tier: HintTier;
  readonly lines: readonly string[];
  /**
   * The literal command, for a `command` rung, separate from the prose.
   *
   * Required on the bottom rung so it can be checked rather than trusted: the
   * content tests run this string against a world sitting on this step and
   * assert the step stops being pending. A hint that no longer works is worse
   * than no hint, and prose alone cannot be tested.
   *
   * It is also what a tappable "do it" chip would send.
   */
  readonly command?: string;
  /**
   * Restrict this rung to one track. Omitted means both.
   *
   * A Cadet who has never seen `man` needs a rung an Operator would find
   * insulting, and the Operator ladder is shorter for it.
   */
  readonly track?: Track;
}

/**
 * One thing the player still has to do, and the ladder for doing it.
 *
 * Steps are what make a hint feel like it is watching rather than reciting.
 * The book asks each step `pending` in order and offers hints for the first
 * one that is still true, so a player who has already edited the config is
 * nudged about starting the service instead of being told again to edit it.
 */
export interface HintStep {
  readonly id: string;
  /** True while this step is still undone. */
  readonly pending: (w: World) => boolean;
  readonly rungs: readonly Rung[];
}

export interface Objective {
  readonly id: string;
  /** One line, shown by `objectives`. */
  readonly title: string;
  /** Solution-agnostic: true whenever the world is in the wanted state. */
  readonly done: (w: World) => boolean;
  readonly steps: readonly HintStep[];
  /** Objective ids that must be `done` before this one is offered. */
  readonly requires?: readonly string[];
  /**
   * Hidden until unlocked, rather than shown greyed out.
   *
   * Use it when the objective's existence is itself the reveal.
   */
  readonly secret?: boolean;
}
