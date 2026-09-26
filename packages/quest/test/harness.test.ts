import { describe, expect, it } from 'vitest';
import { Machine, ROOT_USER } from '@sigkill/machine';
import { checkObjective, taught } from '../src/harness.js';
import { validateObjectives, MIN_ROUTES, MIN_NEAR_MISSES } from '../src/validate.js';
import type { Objective, RouteWorld } from '../src/index.js';

/** A fresh machine the player owns a corner of, plus a way to type at it. */
const factory = async (): Promise<RouteWorld> => {
  const m = new Machine();
  m.vfs.mkdirp('/work', ROOT_USER);
  m.vfs.chown('/work', 1000, 1000, ROOT_USER);
  m.shell.cwd = '/work';
  return {
    world: m,
    run: async (command: string) => {
      const r = await m.exec(command);
      m.tick(1000);
      return { stderr: r.stderr };
    },
  };
};

/**
 * A goal that reads the world properly: any file under /work saying `found`.
 *
 * Deliberately the shape of the Act I goal that was wrong -- recording a fact
 * somewhere of your own choosing -- so the tests below are about the real
 * failure rather than an invented one.
 */
const recorded = (w: { vfs: Machine['vfs'] }): boolean => {
  for (const name of w.vfs.readdir('/work', ROOT_USER)) {
    try {
      if (w.vfs.readText(`/work/${name}`, ROOT_USER).includes('found')) return true;
    } catch {
      // Unreadable is not a match.
    }
  }
  return false;
};

const base: Omit<Objective, 'done' | 'routes' | 'nearMisses'> = {
  id: 'record-it',
  title: 'Write it down',
  teaches: ['echo', 'grep'],
  steps: [
    {
      id: 'only',
      label: 'write it down',
      pending: () => true,
      rungs: [{ tier: 'command', lines: ['    echo found > notes'], command: 'echo found > notes' }],
    },
  ],
};

const ROUTES = [
  { name: 'redirect', commands: ['echo found > notes'] },
  { name: 'a different filename', commands: ['echo found > anything-i-like.txt'] },
  { name: 'append to a new file', commands: ['echo found >> log'] },
];

const MISSES = [
  { name: 'says nothing', commands: ['true'], because: 'nothing was written' },
  { name: 'writes the wrong thing', commands: ['echo missing > notes'], because: 'wrong content' },
];

describe('the route harness', () => {
  it('passes an objective whose goal really is solution-agnostic', async () => {
    const report = await checkObjective(
      { ...base, done: recorded, routes: ROUTES, nearMisses: MISSES },
      factory,
    );
    expect(report.problems).toEqual([]);
    expect(report.routesChecked).toBe(3);
    expect(report.nearMissesChecked).toBe(2);
  });

  /*
   * The bug this whole thing exists for.
   *
   * A goal pinned to one filename passes its own route and fails the moment
   * a second route picks a different name -- which is exactly what happened
   * in Act I, and what nothing caught until somebody played it.
   */
  it('catches a goal that is secretly checking the filename', async () => {
    const pinned = (w: { vfs: Machine['vfs'] }): boolean => {
      try {
        return w.vfs.readText('/work/notes', ROOT_USER).includes('found');
      } catch {
        return false;
      }
    };

    const report = await checkObjective(
      { ...base, done: pinned, routes: ROUTES, nearMisses: MISSES },
      factory,
    );
    expect(report.problems).toHaveLength(2);
    expect(report.problems[0]).toContain('a different filename');
    expect(report.problems[0]).toContain('narrower than it claims');
  });

  it('catches a goal loose enough to accept a wrong answer', async () => {
    // Satisfied by any file at all, regardless of what is in it.
    const anything = (w: { vfs: Machine['vfs'] }): boolean =>
      w.vfs.readdir('/work', ROOT_USER).length > 0;

    const report = await checkObjective(
      { ...base, done: anything, routes: ROUTES, nearMisses: MISSES },
      factory,
    );
    expect(report.problems).toHaveLength(1);
    expect(report.problems[0]).toContain('writes the wrong thing');
    expect(report.problems[0]).toContain('looser than it claims');
  });

  it('reports a route that reaches the goal but errors on the way', async () => {
    const report = await checkObjective(
      {
        ...base,
        done: recorded,
        routes: [...ROUTES, { name: 'noisy', commands: ['cat /nope', 'echo found > x'] }],
        nearMisses: MISSES,
      },
      factory,
    );
    // The goal closes, so this is only reported because a route is a claim
    // that these commands work -- and one of them did not.
    expect(report.problems).toHaveLength(1);
    expect(report.problems[0]).toContain('errored');
  });

  it('runs each route from a fresh world, so they cannot prop each other up', async () => {
    const report = await checkObjective(
      {
        ...base,
        done: recorded,
        routes: [
          { name: 'writes it', commands: ['echo found > a'] },
          // Would pass if the previous route's world leaked through.
          { name: 'relies on the last one', commands: ['true'] },
          ROUTES[0]!,
        ],
        nearMisses: MISSES,
      },
      factory,
    );
    expect(report.problems).toHaveLength(1);
    expect(report.problems[0]).toContain('relies on the last one');
  });
});

describe('the schema is enforced structurally too', () => {
  const full: Objective = { ...base, done: recorded, routes: ROUTES, nearMisses: MISSES };

  it('accepts a complete objective', () => {
    expect(validateObjectives([full], { commands: new Set(['echo', 'grep']) })).toEqual([]);
  });

  it('demands enough routes and near-misses', () => {
    const thin = validateObjectives([{ ...full, routes: [ROUTES[0]!], nearMisses: [] }]);
    expect(thin.some((p) => p.includes(`needs ${MIN_ROUTES}`))).toBe(true);
    expect(thin.some((p) => p.includes(`needs ${MIN_NEAR_MISSES}`))).toBe(true);
  });

  it('refuses to let a puzzle claim it teaches a command that does not exist', () => {
    const problems = validateObjectives([{ ...full, teaches: ['echo', 'awk'] }], {
      commands: new Set(['echo', 'grep']),
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('`awk`');
    expect(problems[0]).toContain('not a command on this machine');
  });

  it('lets a concept through, because a concept is not checkable', () => {
    const problems = validateObjectives([{ ...full, teaches: ['echo', 'redirection, and why'] }], {
      commands: new Set(['echo']),
    });
    expect(problems).toEqual([]);
  });

  it('wants a near-miss to say why it does not count', () => {
    const problems = validateObjectives([
      { ...full, nearMisses: [{ ...MISSES[0]!, because: '' }, MISSES[1]!] },
    ]);
    expect(problems.some((p) => p.includes('does not say why'))).toBe(true);
  });

  it('catches two routes with the same name, which is a copy-paste', () => {
    const problems = validateObjectives([
      { ...full, routes: [ROUTES[0]!, ROUTES[0]!, ROUTES[1]!] },
    ]);
    expect(problems.some((p) => p.includes('duplicate route name'))).toBe(true);
  });

  it('derives the skill map rather than keeping a second list', () => {
    expect(taught([full, { ...full, id: 'other', teaches: ['grep', 'cut'] }])).toEqual([
      'cut',
      'echo',
      'grep',
    ]);
  });
});
