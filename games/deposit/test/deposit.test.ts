import { describe, expect, it } from 'vitest';
import { checkObjective, taught, validateObjectives, type RouteWorld } from '@sigkill/quest';
import { bootDeposit } from '../src/world.js';
import { DEPOSIT_OBJECTIVES } from '../src/objectives.js';

/**
 * A fresh floor for one route.
 *
 * The whole fleet, not just the bastion -- which is the point of the act and
 * the reason `World.network` had to exist before any of this could be written.
 */
function fresh(): RouteWorld {
  const d = bootDeposit();
  return {
    world: d.machine,
    run: async (command: string) => {
      const r = await d.machine.exec(command);
      return { stderr: r.stderr };
    },
  };
}

describe('the act is structurally sound', () => {
  it('passes the content validator against the commands aboard', () => {
    const { machine } = bootDeposit();
    const problems = validateObjectives(DEPOSIT_OBJECTIVES, { commands: machine.shell.commands });
    expect(problems, problems.join('\n')).toEqual([]);
  });

  it('promises no command the machine has not got', () => {
    const { machine } = bootDeposit();
    for (const skill of taught(DEPOSIT_OBJECTIVES)) {
      if (/^[a-z0-9][a-z0-9.+-]*$/.test(skill)) {
        expect(machine.shell.commands.has(skill), `teaches "${skill}"`).toBe(true);
      }
    }
  });
});

describe('routes and near-misses', () => {
  for (const objective of DEPOSIT_OBJECTIVES) {
    it(`${objective.id}: every route closes it and no near-miss does`, async () => {
      const report = await checkObjective(objective, fresh);
      expect(report.problems, report.problems.join('\n')).toEqual([]);
      expect(report.routesChecked).toBeGreaterThanOrEqual(3);
      expect(report.nearMissesChecked).toBeGreaterThanOrEqual(2);
    }, 120_000);
  }
});
