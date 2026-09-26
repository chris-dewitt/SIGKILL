import { describe, expect, it } from 'vitest';
import { commandRegistry } from '@sigkill/machine';
import { checkObjective, taught, validateObjectives, type RouteWorld } from '@sigkill/quest';
import { bootWreck } from '../src/world.js';
import { WRECK_OBJECTIVES } from '../src/objectives.js';

/**
 * Every declared route and near-miss, run against a real ship.
 *
 * This is `docs/PLAN.md`'s locked decision made real: "every puzzle declares
 * what it teaches, ships >=3 solution routes and >=2 rejected near-misses,
 * and fails the build otherwise."
 *
 * It exists because of a bug Chris found by playing. `trace-bowen` checked
 * one hard-coded filename, so grepping Bowen's heading into a log of his own
 * choosing did the entire job and was ignored. Nothing in the suite noticed,
 * because every test used the same filename the goal did. A second declared
 * route with a different name goes red the day it is written.
 */

/** A fresh ship, driven exactly as the host drives one. */
const factory = async (): Promise<RouteWorld> => {
  const w = bootWreck();
  return {
    world: w.machine,
    run: async (command: string) => {
      const result = await w.machine.exec(command);
      // The clock and the companion hook, because the tow answers on that
      // seam and a harness that skipped it would be testing a different game.
      w.machine.tick(1000);
      w.afterCommand();
      return { stderr: result.stderr };
    },
  };
};

describe('the puzzle schema', () => {
  it('is structurally complete, and teaches only commands that exist', () => {
    // The real registry: a puzzle claiming to teach `awk` fails here, because
    // there is no `awk` and a curriculum should not promise one.
    expect(validateObjectives(WRECK_OBJECTIVES, { commands: commandRegistry() })).toEqual([]);
  });

  it('covers the skills Act I is for', () => {
    const skills = taught(WRECK_OBJECTIVES);
    for (const expected of ['systemctl', 'chmod', 'grep', 'kill', 'sed', 'ps']) {
      expect(skills, `Act I should teach ${expected}`).toContain(expected);
    }
  });
});

describe('every declared route really works', () => {
  for (const objective of WRECK_OBJECTIVES) {
    it(`${objective.id}: ${objective.routes.length} routes, ${objective.nearMisses.length} near-misses`, async () => {
      const report = await checkObjective(objective, factory);
      expect(report.problems).toEqual([]);
    }, 60_000);
  }
});
