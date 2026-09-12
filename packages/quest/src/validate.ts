import { TIER_ORDER, type Objective } from './types.js';

/**
 * Structural checks on authored content.
 *
 * Objectives are drafted quickly and read rarely. These catch the mistakes
 * that would otherwise surface as a hint command that silently says nothing:
 * a ladder with no rungs, a `requires` pointing at an objective that was
 * renamed, a cycle that locks everything forever. Tests run this over every
 * shipped adventure, so a broken ladder fails CI rather than a playthrough.
 */
export function validateObjectives(objectives: readonly Objective[]): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();

  for (const objective of objectives) {
    const at = `objective "${objective.id}"`;
    if (!objective.id) problems.push('an objective has no id');
    if (ids.has(objective.id)) problems.push(`${at}: duplicate id`);
    ids.add(objective.id);
    if (!objective.title.trim()) problems.push(`${at}: empty title`);
    if (objective.steps.length === 0) problems.push(`${at}: no steps, so it can never be hinted`);

    const stepIds = new Set<string>();
    for (const step of objective.steps) {
      const stepAt = `${at} step "${step.id}"`;
      if (!step.id) problems.push(`${at}: a step has no id`);
      if (stepIds.has(step.id)) problems.push(`${stepAt}: duplicate step id`);
      stepIds.add(step.id);

      if (step.rungs.length === 0) {
        problems.push(`${stepAt}: no rungs`);
        continue;
      }

      let highest = -1;
      for (const rung of step.rungs) {
        if (rung.lines.length === 0) problems.push(`${stepAt}: a ${rung.tier} rung has no text`);
        if (rung.tier === 'command' && !rung.command?.trim()) {
          problems.push(`${stepAt}: a command rung has no \`command\`, so nothing can verify it still works`);
        }
        const rank = TIER_ORDER.indexOf(rung.tier);
        if (rank < highest) {
          problems.push(`${stepAt}: rungs go ${TIER_ORDER.join(' -> ')}, and this one goes backwards`);
        }
        highest = Math.max(highest, rank);
      }

      // Per track, because a rung restricted to one track leaves the other
      // ladder ending early -- which is exactly the bug that strands a player.
      for (const track of ['cadet', 'operator'] as const) {
        const ladder = step.rungs.filter((r) => r.track === undefined || r.track === track);
        if (ladder.length === 0) {
          problems.push(`${stepAt}: nothing for the ${track} track`);
        } else if (ladder[ladder.length - 1]!.tier !== 'command') {
          problems.push(`${stepAt}: the ${track} ladder stops before telling them the command`);
        }
      }
    }
  }

  for (const objective of objectives) {
    for (const required of objective.requires ?? []) {
      if (!ids.has(required)) {
        problems.push(`objective "${objective.id}": requires "${required}", which does not exist`);
      }
    }
  }

  for (const cycle of findCycles(objectives)) {
    problems.push(`objectives form a requirement cycle: ${cycle.join(' -> ')}`);
  }

  return problems;
}

/** Throws on any problem. The form content tests and boot code should use. */
export function assertObjectives(objectives: readonly Objective[]): readonly Objective[] {
  const problems = validateObjectives(objectives);
  if (problems.length > 0) {
    throw new Error(`invalid objectives:\n  ${problems.join('\n  ')}`);
  }
  return objectives;
}

function findCycles(objectives: readonly Objective[]): string[][] {
  const byId = new Map(objectives.map((o) => [o.id, o]));
  const cycles: string[][] = [];
  const state = new Map<string, 'open' | 'closed'>();

  const walk = (id: string, path: string[]): void => {
    if (state.get(id) === 'closed') return;
    if (state.get(id) === 'open') {
      cycles.push([...path.slice(path.indexOf(id)), id]);
      return;
    }
    state.set(id, 'open');
    for (const next of byId.get(id)?.requires ?? []) {
      if (byId.has(next)) walk(next, [...path, id]);
    }
    state.set(id, 'closed');
  };

  for (const objective of objectives) walk(objective.id, []);
  return cycles;
}
