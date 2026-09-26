import type { NearMiss, Objective, Route, World } from './types.js';

/**
 * Running an objective's declared routes against a real machine.
 *
 * `validate.ts` checks that the declarations exist and are the right shape.
 * This checks that they are *true*, which is the only version that helps.
 *
 * The failure it exists for has already happened once. Act I's `trace-bowen`
 * asserted on `/home/dewitt/logs/bowen-heading.txt` and nothing else, so a
 * player who grepped the heading into a file of their own choosing did the
 * entire job and was told nothing. Nothing in the suite noticed, because
 * every test used the same filename the goal did. A second declared route
 * with a different name would have gone red the day it was written.
 *
 * The other direction matters too and is easier to miss: a goal loose enough
 * to accept a wrong answer never stops anybody, so nobody reports it. That is
 * what near-misses are for.
 */

/** A fresh world, plus a way to type at it. Supplied by the adventure. */
export interface RouteWorld {
  readonly world: World;
  /**
   * Run one command line, exactly as the host would.
   *
   * The adventure supplies this because only it knows what a turn costs --
   * ticking the clock, draining a companion hook. A harness that only called
   * `exec` would be testing a slightly different game from the one people
   * play, which is how the tow came to be untested for a while.
   */
  run(command: string): Promise<{ stderr: string }>;
}

export type WorldFactory = () => Promise<RouteWorld> | RouteWorld;

export interface RouteReport {
  /** Empty when every route and near-miss behaved. */
  readonly problems: readonly string[];
  readonly routesChecked: number;
  readonly nearMissesChecked: number;
}

async function play(
  factory: WorldFactory,
  commands: readonly string[],
): Promise<{ world: World; failures: string[] }> {
  const { world, run } = await factory();
  const failures: string[] = [];
  for (const command of commands) {
    const { stderr } = await run(command);
    // A route is a claim that these commands work. One that writes to stderr
    // may still reach the goal, and it is not a route somebody should be
    // told about -- so it is reported even when the objective closes.
    if (stderr.trim().length > 0) failures.push(`${command} -> ${stderr.trim()}`);
  }
  return { world, failures };
}

/** Check one objective's declared routes and near-misses. */
export async function checkObjective(
  objective: Objective,
  factory: WorldFactory,
): Promise<RouteReport> {
  const problems: string[] = [];

  for (const route of objective.routes) {
    const { world, failures } = await play(factory, route.commands);
    for (const failure of failures) {
      problems.push(`${objective.id}: route "${route.name}" errored: ${failure}`);
    }
    if (!objective.done(world)) {
      problems.push(
        `${objective.id}: route "${route.name}" ran clean and did not satisfy the goal. ` +
          'Either the route is wrong or the goal is narrower than it claims.',
      );
    }
  }

  for (const miss of objective.nearMisses) {
    const { world } = await play(factory, miss.commands);
    if (objective.done(world)) {
      problems.push(
        `${objective.id}: near-miss "${miss.name}" satisfied the goal, but should not have ` +
          `(${miss.because}). The goal is looser than it claims.`,
      );
    }
  }

  return {
    problems,
    routesChecked: objective.routes.length,
    nearMissesChecked: objective.nearMisses.length,
  };
}

/** Every objective in an adventure. */
export async function checkObjectives(
  objectives: readonly Objective[],
  factory: WorldFactory,
): Promise<RouteReport> {
  const problems: string[] = [];
  let routesChecked = 0;
  let nearMissesChecked = 0;

  for (const objective of objectives) {
    const report = await checkObjective(objective, factory);
    problems.push(...report.problems);
    routesChecked += report.routesChecked;
    nearMissesChecked += report.nearMissesChecked;
  }

  return { problems, routesChecked, nearMissesChecked };
}

/**
 * Everything the adventure claims to teach, deduplicated.
 *
 * The skill map, derived rather than maintained -- a second list of what the
 * game covers is a second list to forget to update.
 */
export function taught(objectives: readonly Objective[]): string[] {
  return [...new Set(objectives.flatMap((o) => o.teaches))].sort();
}

export type { Route, NearMiss };
