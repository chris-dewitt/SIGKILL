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
/**
 * How many of each an objective must declare.
 *
 * From `docs/PLAN.md`'s locked decisions: "every puzzle declares what it
 * teaches, ships >=3 solution routes and >=2 rejected near-misses, and fails
 * the build otherwise". Three is the number that makes "solution-agnostic"
 * checkable rather than aspirational -- two can both be the author's habit,
 * and one is not a claim at all.
 */
export const MIN_ROUTES = 3;
export const MIN_NEAR_MISSES = 2;

export interface ValidateOptions {
  /**
   * Command names that exist aboard, if the caller can supply them.
   *
   * When given, every `teaches` entry that looks like a command must name a
   * real one. A curriculum promising something the machine cannot do is worse
   * than one promising less.
   */
  readonly commands?: ReadonlySet<string> | ReadonlyMap<string, unknown>;
}

export function validateObjectives(
  objectives: readonly Objective[],
  opts: ValidateOptions = {},
): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  const known = opts.commands;
  const hasCommand = (name: string): boolean =>
    known === undefined || (known instanceof Map ? known.has(name) : (known as ReadonlySet<string>).has(name));

  for (const objective of objectives) {
    const at = `objective "${objective.id}"`;
    if (!objective.id) problems.push('an objective has no id');
    if (ids.has(objective.id)) problems.push(`${at}: duplicate id`);
    ids.add(objective.id);
    if (!objective.title.trim()) problems.push(`${at}: empty title`);
    if (objective.steps.length === 0) problems.push(`${at}: no steps, so it can never be hinted`);

    // --------------------------------------------------- the puzzle schema
    if (objective.teaches.length === 0) {
      problems.push(`${at}: teaches nothing, so nothing can be said about what it is for`);
    }
    for (const skill of objective.teaches) {
      // A single bare word is taken to be a command name; anything with a
      // space or punctuation is a concept, and concepts are not checkable.
      if (/^[a-z0-9][a-z0-9.+-]*$/.test(skill) && !hasCommand(skill)) {
        problems.push(`${at}: claims to teach \`${skill}\`, which is not a command on this machine`);
      }
    }

    if (objective.routes.length < MIN_ROUTES) {
      problems.push(
        `${at}: ${objective.routes.length} route(s), needs ${MIN_ROUTES}. ` +
          'A goal with one declared solution is a goal nobody has checked is solution-agnostic.',
      );
    }
    if (objective.nearMisses.length < MIN_NEAR_MISSES) {
      problems.push(
        `${at}: ${objective.nearMisses.length} near-miss(es), needs ${MIN_NEAR_MISSES}. ` +
          'Without them nothing catches a goal loose enough to accept a wrong answer.',
      );
    }

    const routeNames = new Set<string>();
    for (const route of [...objective.routes, ...objective.nearMisses]) {
      if (!route.name.trim()) problems.push(`${at}: a route has no name`);
      if (routeNames.has(route.name)) problems.push(`${at}: duplicate route name "${route.name}"`);
      routeNames.add(route.name);
      if (route.commands.length === 0) {
        problems.push(`${at}: route "${route.name}" has no commands`);
      }
    }
    for (const miss of objective.nearMisses) {
      if (!miss.because.trim()) {
        problems.push(`${at}: near-miss "${miss.name}" does not say why it does not count`);
      }
    }

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
export function assertObjectives(
  objectives: readonly Objective[],
  opts: ValidateOptions = {},
): readonly Objective[] {
  const problems = validateObjectives(objectives, opts);
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
