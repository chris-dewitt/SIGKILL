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
 * One line of something the adventure says.
 *
 * A bare string is prose: the host is free to wrap it to whatever width the
 * screen happens to be. The object form is preformatted -- a drawing, a table,
 * anything where columns are load-bearing -- and the host must clip it instead.
 *
 * The distinction has to be per line rather than per beat, because the beats
 * that matter are prose with a picture in the middle of them.
 */
export type BeatLine = string | { readonly art: string };

/** Mark a block of rows as preformatted. */
export function asArt(rows: readonly string[]): BeatLine[] {
  return rows.map((art) => ({ art }));
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
  /**
   * What the player is doing right now, in their words.
   *
   * The single most useful line the interface can show: an objective says
   * where you are going and this says what is in front of you. Without it the
   * board can only show a title the player has already read and an id like
   * `make-it-runnable`, which is a name for the content, not for them.
   *
   * One short phrase, no trailing full stop. Optional so other adventures
   * keep compiling, but write one.
   */
  readonly label?: string;
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
  /**
   * What the adventure says the moment this objective closes.
   *
   * Unix is silent on success and should stay that way -- `systemctl start`
   * printing nothing is correct and worth learning. But the moment a player
   * fixes the thing the whole act is about, *something* has to answer them,
   * or the biggest beat in the story lands in silence. The machine stays
   * real; the character reacts.
   *
   * Lines may be prose or preformatted art -- see `BeatLine`. Wrap art rows
   * with `asArt` so a narrow screen clips the picture rather than shredding it.
   */
  readonly onComplete?: readonly BeatLine[];
}
