import type { Track } from '@sigkill/machine';
import { assertObjectives } from './validate.js';
import type { HintStep, HintTier, Objective, Rung, World } from './types.js';

export interface ObjectiveStatus {
  id: string;
  title: string;
  done: boolean;
  /** Unfinished objectives this one is waiting on. Empty means unlocked. */
  blockedBy: readonly string[];
  /** How many rungs the player has taken on this objective. */
  hintsTaken: number;
}

export type HintOutcome =
  | { kind: 'hint'; objective: Objective; step: HintStep; tier: HintTier; lines: readonly string[]; repeated: boolean; last: boolean }
  | { kind: 'all-done' }
  | { kind: 'locked'; objective: Objective; blockedBy: readonly string[] }
  | { kind: 'unknown'; id: string }
  | { kind: 'stuck'; objective: Objective };

export interface QuestSnapshot {
  version: 1;
  /** Rungs taken, keyed by objective and step. */
  revealed: Record<string, number>;
  asked: number;
}

export interface QuestbookOptions {
  /** Which ladder to read. Defaults to operator, like the Machine does. */
  track?: Track;
}

const key = (objectiveId: string, stepId: string): string => `${objectiveId}/${stepId}`;

/**
 * The objectives of one adventure, plus how much of each ladder the player
 * has spent.
 *
 * Deterministic and snapshottable, like everything else: two players who type
 * the same things see the same hints, and a restored save remembers what it
 * had already told you. There is no cost, no timer and no penalty -- a hint
 * you have to pay for is a hint a learner refuses on principle and then quits
 * over. What it does keep is a count, so a run that never asked can be
 * recognised as one.
 */
export class Questbook {
  readonly objectives: readonly Objective[];
  track: Track;
  private revealed = new Map<string, number>();
  private asked = 0;

  constructor(objectives: readonly Objective[], opts: QuestbookOptions = {}) {
    this.objectives = assertObjectives(objectives);
    this.track = opts.track ?? 'operator';
  }

  /** Total rungs taken across the adventure. Zero is worth something. */
  get hintsTaken(): number {
    return this.asked;
  }

  private blockers(world: World, objective: Objective): string[] {
    const byId = new Map(this.objectives.map((o) => [o.id, o]));
    return (objective.requires ?? []).filter((id) => {
      const required = byId.get(id);
      return required !== undefined && !required.done(world);
    });
  }

  status(world: World): ObjectiveStatus[] {
    return this.objectives
      .map((objective) => ({
        id: objective.id,
        title: objective.title,
        done: objective.done(world),
        blockedBy: this.blockers(world, objective),
        hintsTaken: objective.steps.reduce(
          (total, step) => total + (this.revealed.get(key(objective.id, step.id)) ?? 0),
          0,
        ),
      }))
      .filter((row) => !this.objectives.find((o) => o.id === row.id)?.secret || row.blockedBy.length === 0);
  }

  /**
   * Is every objective finished?
   *
   * The host uses this to fire an act's ending exactly once. Without it, an
   * adventure simply stops when the last objective goes green, which reads as
   * the game breaking rather than the act closing.
   */
  complete(world: World): boolean {
    return this.objectives.every((objective) => objective.done(world));
  }

  /** The objective a bare `hint` is about: first unlocked and unfinished. */
  current(world: World): Objective | undefined {
    return this.objectives.find(
      (objective) => !objective.done(world) && this.blockers(world, objective).length === 0,
    );
  }

  /** The first step of an objective that is still undone. */
  step(world: World, objective: Objective): HintStep | undefined {
    return objective.steps.find((step) => step.pending(world));
  }

  /** Rungs of a step that apply to the current track, in order. */
  ladder(step: HintStep): Rung[] {
    return step.rungs.filter((rung) => rung.track === undefined || rung.track === this.track);
  }

  /**
   * Take the next rung.
   *
   * Escalation is counted per step, not per objective, so making progress
   * earns a gentle nudge on the new problem rather than a blunt answer
   * inherited from the old one. Asking past the bottom repeats the last rung:
   * there is nothing further down, and saying "no more hints" to someone who
   * is still stuck helps nobody.
   */
  hint(world: World, id?: string): HintOutcome {
    let objective: Objective | undefined;

    if (id !== undefined) {
      objective = this.objectives.find((o) => o.id === id);
      if (!objective) return { kind: 'unknown', id };
      const blockedBy = this.blockers(world, objective);
      if (blockedBy.length > 0) return { kind: 'locked', objective, blockedBy };
    } else {
      objective = this.current(world);
      if (!objective) return { kind: 'all-done' };
    }

    const step = this.step(world, objective);
    // Every step satisfied but the objective still open means the content is
    // wrong, not the player. Say so rather than staying silent.
    if (!step) return { kind: 'stuck', objective };

    const ladder = this.ladder(step);
    const taken = this.revealed.get(key(objective.id, step.id)) ?? 0;
    const index = Math.min(taken, ladder.length - 1);
    const rung = ladder[index]!;

    this.revealed.set(key(objective.id, step.id), index + 1);
    this.asked += 1;

    return {
      kind: 'hint',
      objective,
      step,
      tier: rung.tier,
      lines: rung.lines,
      repeated: index < taken,
      last: index === ladder.length - 1,
    };
  }

  snapshot(): QuestSnapshot {
    return { version: 1, revealed: Object.fromEntries(this.revealed), asked: this.asked };
  }

  restore(snapshot: QuestSnapshot): void {
    this.revealed = new Map(Object.entries(snapshot.revealed));
    this.asked = snapshot.asked;
  }
}
