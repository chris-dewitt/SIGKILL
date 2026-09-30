import { describe, expect, it } from 'vitest';
import { Machine, ROOT_USER } from '@sigkill/machine';
import { gitCommands } from '@sigkill/git';
import { REPO, seedRepository } from '../src/act1/history.js';
import { commitCounts, facts, repoOf } from '../src/evidence.js';

/**
 * The spike, kept.
 *
 * Policy in CLAUDE.md: probe the engine with the new game's idiom before
 * authoring the new game. This is that probe, and it stays in the suite
 * because every question it asks is one the act's objectives depend on.
 */
function booted() {
  const machine = new Machine({
    hostname: 'deposit',
    epoch: Date.UTC(2398, 5, 19, 10, 0),
    commands: gitCommands(),
  });
  const seeded = seedRepository(machine.vfs, ROOT_USER);
  machine.shell.cwd = REPO;
  machine.shell.env['PWD'] = REPO;
  return { machine, seeded };
}

const run = async (m: Machine, cmd: string): Promise<string> => {
  const r = await m.exec(cmd);
  return r.stdout + r.stderr;
};

describe('the seeded history is a real repository', () => {
  it('replays without throwing and leaves a walkable main', async () => {
    const { machine, seeded } = booted();
    expect(seeded.all.length).toBeGreaterThan(20);

    const log = await run(machine, 'git log --oneline');
    expect(log, log).not.toContain('not a git repository');
    const lines = log.trim().split('\n').filter((l) => l.length > 0);
    expect(lines.length).toBeGreaterThan(20);
  });

  it('gives every object a genuine id, and cat-file reads it back', async () => {
    const { machine, seeded } = booted();
    for (const id of seeded.all) expect(id).toMatch(/^[0-9a-f]{40}$/);
    const out = await run(machine, `git cat-file -p ${seeded.widened}`);
    expect(out, out).toContain('tree ');
    expect(out).toContain('R. Vasquez');
  });

  it('blames the widened line to Vasquez, with her message', async () => {
    const { machine } = booted();
    const out = await run(machine, 'git blame sandbox/sandbox.conf');
    expect(out, out).toContain('crew-health');
    expect(out).toContain('Vasquez');
  });

  it('shows the merge as almost nothing, and the dropped guard against its second parent', async () => {
    const { machine, seeded } = booted();
    const show = await run(machine, `git show ${seeded.merge}`);
    expect(show, show).toContain('Took ours');

    // The guard exists on the second parent and not in the merge result.
    const onGuard = await run(machine, `git show ${seeded.guard}:v43/reader.py`);
    expect(onGuard, onGuard).toContain('PermissionError');
    const afterMerge = await run(machine, `git show ${seeded.merge}:v43/reader.py`);
    expect(afterMerge).not.toContain('PermissionError');
  });

  it('keeps the safety branch unmerged, with a real merge base', async () => {
    const { machine, seeded } = booted();
    const branches = await run(machine, 'git branch');
    expect(branches, branches).toContain('safety/rate-limit');

    const base = await run(machine, `git merge-base main ${seeded.safety}`);
    expect(base.trim()).toMatch(/^[0-9a-f]{40}$/);
    expect(base.trim()).not.toBe(seeded.safety);
  });

  it("hides Bowen's last commit from log and keeps it in the reflog", async () => {
    const { machine, seeded } = booted();
    const log = await run(machine, 'git log --oneline');
    expect(log).not.toContain(seeded.bowenLast.slice(0, 7));

    const reflog = await run(machine, 'git reflog');
    expect(reflog, reflog).toContain(seeded.bowenLast.slice(0, 7));

    const show = await run(machine, `git show ${seeded.bowenLast}`);
    expect(show, show).toContain('Irrigation on the long schedule');
  });

  it('walks a DAG for bisect, merges included', async () => {
    const { machine, seeded } = booted();
    const started = await run(machine, `git bisect start ${seeded.head} ${seeded.all[0]}`);
    expect(started, started).not.toContain('usage');
    expect(started.toLowerCase()).not.toContain('not implemented');
  });

  it('shortlog attributes the work to four people', async () => {
    const { machine } = booted();
    const out = await run(machine, 'git shortlog');
    for (const who of ['Vasquez', 'Chen', 'Bowen', 'Okonkwo']) {
      expect(out, out).toContain(who);
    }
  });

  it('is deterministic: two seeds produce identical ids', () => {
    const a = booted().seeded;
    const b = booted().seeded;
    expect(a.all).toEqual(b.all);
    expect(a.bowenLast).toBe(b.bowenLast);
  });
});

describe('the findings can be computed from the repository alone', () => {
  it('finds each key commit by asking the history, and agrees with the seed', () => {
    const { machine, seeded } = booted();
    const repo = repoOf(machine)!;
    expect(repo).toBeDefined();
    const found = facts(repo)!;
    expect(found).toBeDefined();

    expect(found.main).toBe(seeded.head);
    expect(found.firstV43).toBe(seeded.firstV43);
    expect(found.widened).toBe(seeded.widened);
    expect(found.firstRestrictedRead).toBe(seeded.firstRestrictedRead);
    expect(found.merge).toBe(seeded.merge);
    expect(found.mergeSecondParent).toBe(seeded.guard);
    expect(found.safety).toBe(seeded.safety);
    expect(found.orphan).toBe(seeded.bowenLast);
  });

  it('counts the work four ways', () => {
    const { machine } = booted();
    const counts = commitCounts(repoOf(machine)!);
    for (const who of ['vasquez', 'chen', 'bowen', 'okonkwo'] as const) {
      expect(counts[who], who).toBeGreaterThan(2);
    }
  });

  it('puts the widening before the read, which is the whole sequence', () => {
    const { machine } = booted();
    const repo = repoOf(machine)!;
    const found = facts(repo)!;
    const at = (id: string) => repo.readCommit(id).author.when;
    expect(at(found.widened!)).toBeLessThan(at(found.firstRestrictedRead!));
  });
});
