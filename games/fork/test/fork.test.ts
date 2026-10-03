import { beforeAll, describe, expect, it } from 'vitest';
import { ROOT_USER } from '@sigkill/machine';
import { NodePythonRuntime } from '@sigkill/python/node';
import {
  MissingRuntime,
  checkObjective,
  taught,
  validateObjectives,
  type RouteWorld,
} from '@sigkill/quest';
import { FORK } from '../src/adventure.js';
import { bootFork, restoreFork, coldOpen, epilogue } from '../src/world.js';
import { FORK_OBJECTIVES } from '../src/objectives.js';
import { REPO, SAFETY_BRANCH } from '../src/act1/history.js';
import { FINDINGS, HOME } from '../src/act1/office.js';
import { facts, repoOf, written } from '../src/evidence.js';

/**
 * One interpreter for the whole file, as game three does it and for the same
 * reason: booting Pyodide per test buys no confidence and costs minutes.
 */
const python = new NodePythonRuntime();

beforeAll(async () => {
  await python.ready();
}, 120_000);

/** A fresh act, and a turn that costs what a turn costs. */
function fresh(): RouteWorld & { fork: ReturnType<typeof bootFork> } {
  const fork = bootFork({ python });
  return {
    fork,
    world: fork.machine,
    run: async (command: string) => {
      const result = await fork.machine.exec(command);
      await fork.machine.tick(1000);
      return { stderr: result.stderr };
    },
  };
}

const out = async (command: string, w = fresh()): Promise<string> => {
  const r = await w.fork.machine.exec(command);
  return r.stdout + r.stderr;
};

describe('the act is structurally sound', () => {
  it('passes the content validator against the commands that exist aboard', () => {
    const { machine } = bootFork({ python });
    const problems = validateObjectives(FORK_OBJECTIVES, { commands: machine.shell.commands });
    expect(problems, problems.join('\n')).toEqual([]);
  });

  it('ships nine required objectives and two optional ones', () => {
    const required = FORK_OBJECTIVES.filter((o) => o.optional !== true);
    const optional = FORK_OBJECTIVES.filter((o) => o.optional === true);
    expect(required).toHaveLength(9);
    expect(optional).toHaveLength(2);
  });

  it('teaches git without promising a command the machine has not got', () => {
    const { machine } = bootFork({ python });
    for (const skill of taught(FORK_OBJECTIVES)) {
      if (/^[a-z0-9][a-z0-9.+-]*$/.test(skill)) {
        expect(machine.shell.commands.has(skill), `teaches "${skill}"`).toBe(true);
      }
    }
  });

  it('refuses to boot without the interpreter objective four needs', async () => {
    await expect(FORK.boot({})).rejects.toThrow(MissingRuntime);
  });

  it('sits at slot four in the series', () => {
    expect(FORK.number).toBe(4);
    expect(FORK.id).toBe('fork');
    expect(FORK.needs).toContain('python');
  });
});

/*
 * Every route, every near-miss, against a real machine.
 *
 * This is the locked decision from PLAN.md made real: "every puzzle declares
 * what it teaches, ships >=3 solution routes and >=2 rejected near-misses, and
 * fails the build otherwise". One `it` per objective so a failure names the
 * puzzle rather than the suite.
 */
describe('routes and near-misses', () => {
  for (const objective of FORK_OBJECTIVES) {
    it(`${objective.id}: every route closes it and no near-miss does`, async () => {
      const report = await checkObjective(objective, fresh);
      expect(report.problems, report.problems.join('\n')).toEqual([]);
      expect(report.routesChecked).toBeGreaterThanOrEqual(3);
      expect(report.nearMissesChecked).toBeGreaterThanOrEqual(2);
    }, 120_000);
  }
});

describe('the deposit is a working copy of eleven years', () => {
  it('opens on the office with the repository readable', async () => {
    const w = fresh();
    expect(await out('cat /srv/deposit/PELL', w)).toContain('FEET');
    expect(await out('cat ~/KERR', w)).toContain('admissible');
    const log = await out(`cd ${REPO} && git log --oneline`, w);
    expect(log).not.toContain('not a git repository');
  });

  it('is genuinely DeWitt\'s copy, so he can commit without sudo', async () => {
    const w = fresh();
    const made = await out(
      `cd ${REPO} && git switch -c dewitt/test && echo hello > NOTE && git add NOTE && git commit -m "mine"`,
      w,
    );
    expect(made).not.toMatch(/permission denied/i);
    const log = await out(`cd ${REPO} && git log --oneline`, w);
    expect(log).toContain('mine');
  });

  it('lists the branches with their slashes intact', async () => {
    const w = fresh();
    const branches = await out(`cd ${REPO} && git branch`, w);
    expect(branches).toContain(SAFETY_BRANCH);
    expect(branches).toContain('chen/guard');
  });

  it('runs Okonkwo\'s automation, which is a real script on a real shell', async () => {
    const w = fresh();
    const ran = await out(`cd ${REPO} && ./compliance/feet.sh 2398Q2`, w);
    expect(ran, ran).not.toMatch(/not found|syntax error|bad interpreter/i);
    const listed = await out(`ls ${REPO}/compliance/out`, w);
    expect(listed).toContain('NAV7-2398Q2-okonkwo-feet.txt');
  });
});

describe('the findings are what the act says they are', () => {
  it('puts a year between the door opening and something walking through it', () => {
    const { machine } = bootFork({ python });
    const repo = repoOf(machine)!;
    const key = facts(repo)!;
    const year = (id: string) =>
      new Date(repo.readCommit(id).author.when * 1000).getUTCFullYear();
    expect(year(key.widened!)).toBe(2394);
    expect(year(key.firstRestrictedRead!)).toBe(2395);
  });

  it('has the merge at two in the morning, taking its own side', () => {
    const { machine } = bootFork({ python });
    const repo = repoOf(machine)!;
    const key = facts(repo)!;
    const merge = repo.readCommit(key.merge!);
    expect(merge.parents).toHaveLength(2);
    expect(merge.message).toMatch(/took ours/i);
    expect(new Date(merge.author.when * 1000).getUTCHours()).toBe(2);

    // The tree matches the first parent exactly -- which is why `git show` on
    // it is nearly empty and the guard is only visible against the second.
    expect(merge.tree).toBe(repo.readCommit(merge.parents[0]!).tree);
    const dropped = repo.fileAt(key.mergeSecondParent!, 'v43/reader.py');
    expect(dropped).toContain('PermissionError');
    expect(repo.fileAt(key.merge!, 'v43/reader.py')).not.toContain('PermissionError');
  });

  it('leaves the safety branch unmerged, which is the strongest thing in the file', () => {
    const { machine } = bootFork({ python });
    const repo = repoOf(machine)!;
    const key = facts(repo)!;
    const onMain = repo.fileAt(key.main, 'safety/rate_limit.py');
    expect(onMain).toBeUndefined();
    expect(repo.fileAt(key.safety!, 'safety/rate_limit.py')).toContain('MAX_BYTES_PER_RUN');
  });

  it("keeps Bowen's last commit out of the log and in the store", async () => {
    const w = fresh();
    const { machine } = w.fork;
    const key = facts(repoOf(machine)!)!;
    const log = await out(`cd ${REPO} && git log --oneline`, w);
    expect(log).not.toContain(key.orphan!.slice(0, 7));
    const shown = await out(`cd ${REPO} && git show ${key.orphan}`, w);
    expect(shown).toContain('irrigation');
    expect(shown).toContain('DAYS = 90');
  });

  it('never convicts him: what he pushed was ninety days of water', () => {
    const { machine } = bootFork({ python });
    const repo = repoOf(machine)!;
    const key = facts(repo)!;
    const commit = repo.readCommit(key.orphan!);
    expect(commit.author.email).toContain('bowen');
    expect(commit.message).not.toMatch(/sabotag|steal|destro|delete/i);
    // Fourteen minutes before the pod, per canon: his flight is not a verdict.
    expect(new Date(commit.author.when * 1000).getUTCHours()).toBe(4);
  });
});

describe('LUNA reads her own history, and does not finish having feelings about it', () => {
  it('has her source and every change anybody made to her', () => {
    const { machine } = bootFork({ python });
    const repo = repoOf(machine)!;
    expect(repo.fileAt(facts(repo)!.main, 'luna/prompt.txt')).toContain('say so plainly');
    expect(repo.fileAt(facts(repo)!.main, 'luna/tune.py')).toContain('hedge_rate');
  });

  it('carries the three kind commit messages the objective turns on', async () => {
    const w = fresh();
    const log = await out(`cd ${REPO} && git log --oneline -- luna/`, w);
    expect(log).toMatch(/apologising/i);
    expect(log).toMatch(/finish a thought/i);
    expect(log).toMatch(/check me/i);
  });

  it('is secret until it is found, and optional forever', () => {
    const hers = FORK_OBJECTIVES.find((o) => o.id === 'her-own-history')!;
    expect(hers.secret).toBe(true);
    expect(hers.optional).toBe(true);
  });

  it('does not resolve it, because game seven needs her unfinished', async () => {
    const w = fresh();
    for (const command of [
      `cd ${REPO}`,
      `git log --reverse -- luna/ > ${FINDINGS}/luna`,
      `git log -p --reverse -- luna/ >> ${FINDINGS}/luna`,
    ]) {
      await w.run(command);
    }
    const hers = FORK_OBJECTIVES.find((o) => o.id === 'her-own-history')!;
    expect(hers.done(w.world)).toBe(true);

    const beat = typeof hers.onComplete === 'function' ? hers.onComplete(w.world) : hers.onComplete;
    const said = (beat ?? []).map((l) => (typeof l === 'string' ? l : l.art)).join('\n');
    expect(said).toContain('I do not know what to do with this yet');
    // No resolution, no forgiveness scene, no conclusion about her authorship.
    expect(said).not.toMatch(/i forgive|i am at peace|now i understand who i am/i);
  });
});

describe('the ending', () => {
  it('cites the three commits and files no theory', () => {
    const { machine } = bootFork({ python });
    const ending = epilogue(machine)
      .map((l) => (typeof l === 'string' ? l : l.art))
      .join('\n');
    const key = facts(repoOf(machine)!)!;
    expect(ending).toContain(key.widened!.slice(0, 7));
    expect(ending).toContain(key.firstRestrictedRead!.slice(0, 7));
    expect(ending).toContain(key.merge!.slice(0, 7));
    expect(ending).toContain('THE FORK — COMPLETE');
    expect(ending).toMatch(/documented sequence/i);
  });

  it('does not tell a player who skipped the optional threads what they missed', () => {
    const { machine } = bootFork({ python });
    const ending = epilogue(machine)
      .map((l) => (typeof l === 'string' ? l : l.art))
      .join('\n');
    expect(ending).not.toMatch(/apologising/i);
    expect(ending).not.toMatch(/forty-six quarters/i);
  });

  it('opens on an empty room, which was the decision', () => {
    const open = coldOpen().map((l) => (typeof l === 'string' ? l : l.art)).join('\n');
    expect(open).toContain('There is nobody here');
    expect(open).toContain('git log --oneline');
  });
});

describe('a saved run comes back', () => {
  it('restores the repository, the findings and the objective state', async () => {
    const w = fresh();
    await w.run(`cd ${REPO}`);
    await w.run(`git log --oneline --reverse | grep -i v43 | head -n 1 > ${FINDINGS}/v43`);

    const first = FORK_OBJECTIVES.find((o) => o.id === 'open-the-deposit')!;
    expect(first.done(w.world)).toBe(true);

    const back = restoreFork(
      { machine: w.fork.machine.snapshot(), quest: w.fork.questbook.snapshot() },
      { python },
    );
    expect(first.done(back.machine)).toBe(true);
    expect(written(back.machine)).toContain('v43');

    // And git still works on the restored copy, which is the thing a
    // snapshot of an object store could plausibly get wrong.
    const log = await back.machine.exec(`cd ${REPO} && git log --oneline`);
    expect(log.stdout).not.toContain('not a git repository');
  });

  it('is deterministic across two boots, ids included', () => {
    const a = facts(repoOf(bootFork({ python }).machine)!)!;
    const b = facts(repoOf(bootFork({ python }).machine)!)!;
    expect(a).toEqual(b);
  });
});

describe('the goals read state, never the command', () => {
  it('accepts a finding written anywhere under home, not one blessed filename', async () => {
    const w = fresh();
    await w.run(`cd ${REPO}`);
    await w.run(`git log --oneline --reverse | grep -i v43 | head -n 1 > ${HOME}/scribbles`);
    expect(FORK_OBJECTIVES.find((o) => o.id === 'open-the-deposit')!.done(w.world)).toBe(true);
  });

  it('does not count what the office itself wrote as the player\'s finding', () => {
    const { machine } = bootFork({ python });
    // carried/NOTES mentions v43 on turn one. If it counted, objective one
    // would be complete before the player did anything -- which is the exact
    // failure mode of scanning a home directory for evidence.
    expect(FORK_OBJECTIVES.find((o) => o.id === 'open-the-deposit')!.done(machine)).toBe(false);
  });
});

