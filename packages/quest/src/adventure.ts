import type { Machine, MachineSnapshot, PythonRuntime, SqlRuntime } from '@sigkill/machine';
import type { Questbook, QuestSnapshot } from './book.js';
import type { BeatLine } from './types.js';

/**
 * What an adventure is, from the outside.
 *
 * Three games existed before this file did, and the app could launch one of
 * them. Not because launching the others was hard -- because `apps/terminal`
 * imported `bootWreck` by name at module scope and built everything else on
 * top of that assumption, so the second and third games were reachable only
 * from a test.
 *
 * That is the same bug as an optional objective nothing points at, one level
 * up, and it is worth being blunt about: content that cannot be reached is not
 * content. It is a directory.
 *
 * So this is the seam. An adventure describes itself, hands back a machine and
 * a questbook, and says what it needs to run. The host owns the screen, the
 * save slot and the chooser; the adventure owns the world and the story. What
 * is deliberately *not* in here is anything host-shaped -- no audio state, no
 * status rows, no palette. Those would drag `@sigkill/audio` and a notion of
 * what a screen is into a package whose whole job is objectives, and the
 * dependency arrow only points one way.
 */

/** Interpreters the host has available. An adventure takes what it needs. */
export interface AdventureRuntimes {
  readonly python?: PythonRuntime;
  readonly sql?: SqlRuntime;
}

/** A booted or restored run. */
export interface AdventureSession {
  readonly machine: Machine;
  readonly questbook: Questbook;
  /**
   * Let the world react to the command that just ran, and say anything it wants.
   *
   * The seam a companion needs, and the one piece of The Wreck's session that
   * was not in the first draft of this contract -- the typechecker found it the
   * moment the app stopped importing `bootWreck` by name. An objective beat
   * fires when a goal closes; this fires every turn, so something that arrives
   * when a service comes up, or answers a signal sent mid-command, has
   * somewhere to speak from.
   *
   * Optional, and currently only The Wreck has one. That is a gap rather than a
   * design: LUNA is in game three and cannot react per turn there yet.
   */
  afterCommand?(): BeatLine[];
}

/** Everything needed to bring a run back. */
export interface AdventureSnapshot {
  readonly machine: MachineSnapshot;
  readonly quest: QuestSnapshot;
}

/**
 * A runtime an adventure cannot start without.
 *
 * Thrown rather than tolerated. A machine that silently booted into a version
 * of The Archive with no database, or The Harness with no interpreter, would
 * be worse than one that refuses -- the player would meet the failure four
 * commands later, as a puzzle that cannot be solved.
 */
export class MissingRuntime extends Error {
  constructor(
    readonly adventure: string,
    readonly runtime: string,
  ) {
    super(`${adventure} needs ${runtime}, and this host did not supply one`);
    this.name = 'MissingRuntime';
  }
}

/** Take a required runtime, or say which one is missing and for what. */
export function require_<T>(value: T | undefined, adventure: string, runtime: string): T {
  if (value === undefined) throw new MissingRuntime(adventure, runtime);
  return value;
}

export interface Adventure {
  /** Stable, lowercase, and part of the save key. Never renamed. */
  readonly id: string;
  /** Where it sits in the series. Ordering for the chooser. */
  readonly number: number;
  readonly title: string;
  /** One phrase: what a player would learn. Shown in the chooser. */
  readonly teaches: string;
  /**
   * Two or three lines for the chooser, in the game's own voice.
   *
   * Written to be readable by somebody who has not played the one before it,
   * and to spoil nothing -- the chooser is the first thing a new player reads,
   * and a list of games that gives away their endings is a list nobody wants.
   */
  readonly blurb: readonly string[];
  /** What it will not start without. The host checks before offering it. */
  readonly needs?: readonly ('python' | 'sql')[];

  /**
   * Start a new run, or bring a saved one back.
   *
   * Always a promise, even for the two games that could answer synchronously.
   * The first draft allowed either, and the difference showed up immediately as
   * inconsistent failure: `MissingRuntime` came back as a thrown exception from
   * one adventure and a rejected promise from another, depending on whether that
   * game's boot happened to be async. A host has one error path, so these have
   * one too -- and `async` turns a synchronous throw into a rejection for free.
   */
  boot(runtimes: AdventureRuntimes): Promise<AdventureSession>;
  restore(
    snapshot: AdventureSnapshot,
    runtimes: AdventureRuntimes,
  ): Promise<AdventureSession>;

  /**
   * The opening, and the ending.
   *
   * Both take the machine, and games that do not need it ignore the argument.
   * Passing it is what lets an ending notice what the player actually did --
   * The Harness has an optional thread and four extra lines for the player who
   * followed it, and an ending that cannot see the world cannot do that.
   */
  coldOpen(machine: Machine): BeatLine[];
  epilogue(machine: Machine): BeatLine[];
}

/** The series, in order, with anything it cannot run filtered out. */
export function playable(
  adventures: readonly Adventure[],
  runtimes: AdventureRuntimes,
): Adventure[] {
  return [...adventures]
    .sort((a, b) => a.number - b.number)
    .filter((adventure) =>
      (adventure.needs ?? []).every((need) => runtimes[need] !== undefined),
    );
}
