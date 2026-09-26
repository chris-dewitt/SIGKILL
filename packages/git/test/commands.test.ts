import { describe, expect, it } from 'vitest';
import { Machine, ROOT_USER } from '@sigkill/machine';
import { gitCommands } from '../src/commands.js';

/**
 * `git`, as a player types it.
 *
 * The other suites test the model. This tests the thing somebody actually does,
 * which is a different question -- the model was right for a while in a package
 * whose command did not exist yet, and a package like that is not a feature.
 */

/** The adventure's calendar: 2398-06-06 04:12:00Z. */
const EPOCH = Date.UTC(2398, 5, 6, 4, 12);

function boot(): Machine {
  const machine = new Machine({
    hostname: 'deposit',
    epoch: EPOCH,
    commands: gitCommands({ identity: () => ({ name: 'V. Vasquez', email: 'vasquez@nav7' }) }),
  });
  machine.vfs.mkdirp('/repo', ROOT_USER);
  // The player's own working directory, not root's -- `git init` has to be able
  // to write `.git`, and a repository owned by somebody else is a different test.
  const who = machine.shell.user;
  machine.vfs.chown('/repo', who.uid, who.gid, ROOT_USER);
  machine.shell.cwd = '/repo';
  return machine;
}

/** Run a line and insist it was clean, because a route that errors is not one. */
async function run(machine: Machine, command: string): Promise<string> {
  const result = await machine.exec(command);
  expect(result.stderr, `${command} -> ${result.stderr}`).toBe('');
  machine.tick(1000);
  return result.stdout;
}

describe('starting a repository', () => {
  it('makes one, and says where', async () => {
    const machine = boot();
    expect(await run(machine, 'git init')).toContain('Initialized empty Git repository in /repo/.git/');
    expect(machine.vfs.exists('/repo/.git/HEAD', ROOT_USER)).toBe(true);
  });

  it('refuses everything else until there is one', async () => {
    const machine = boot();
    const result = await machine.exec('git log');
    expect(result.code).toBe(128);
    expect(result.stderr).toContain('not a git repository');
  });

  /*
   * And works from a subdirectory, which is not a nicety.
   *
   * A player who has to stand in the repository root to use git has been given a
   * puzzle nobody meant to set.
   */
  it('finds the repository from a subdirectory', async () => {
    const machine = boot();
    await run(machine, 'git init');
    await run(machine, 'mkdir -p luna/deep');
    await run(machine, 'echo x > luna/deep/a.txt');
    await run(machine, 'cd luna/deep');
    await run(machine, 'git add a.txt');
    expect(await run(machine, 'git status')).toContain('luna/deep/a.txt');
  });
});

describe('recording a change', () => {
  async function repo(): Promise<Machine> {
    const machine = boot();
    await run(machine, 'git init');
    await run(machine, 'echo SANDBOX=strict > sandbox.conf');
    return machine;
  }

  it('walks through add, status and commit', async () => {
    const machine = await repo();

    expect(await run(machine, 'git status')).toContain('sandbox.conf');
    await run(machine, 'git add sandbox.conf');
    expect(await run(machine, 'git status')).toContain('Changes to be committed');

    const out = await run(machine, 'git commit -m "sandbox: start strict"');
    expect(out).toMatch(/^\[main [0-9a-f]{7}\] sandbox: start strict/);
    expect(await run(machine, 'git status')).toContain('nothing to commit, working tree clean');
  });

  it('says nothing on a successful add, because git does not either', async () => {
    const machine = await repo();
    expect(await run(machine, 'git add sandbox.conf')).toBe('');
  });

  it('refuses to commit nothing', async () => {
    const machine = await repo();
    const result = await machine.exec('git commit -m "empty"');
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('nothing added to commit');
  });

  it('dates the commit from the virtual clock, not from wall time', async () => {
    const machine = await repo();
    await run(machine, 'git add sandbox.conf');
    await run(machine, 'git commit -m "first"');
    // 2398, which is the adventure's year and nobody's real one.
    expect(await run(machine, 'git log')).toContain('Date:   2398-06-06T04:12');
  });

  it('is deterministic: the same session twice is the same commit', async () => {
    const build = async (): Promise<string> => {
      const machine = boot();
      await run(machine, 'git init');
      await run(machine, 'echo SANDBOX=strict > sandbox.conf');
      await run(machine, 'git add sandbox.conf');
      await run(machine, 'git commit -m "first"');
      return (await run(machine, 'git rev-parse HEAD')).trim();
    };
    expect(await build()).toBe(await build());
  });
});

describe('reading history', () => {
  /** Three commits to one file, by two people. */
  async function seeded(): Promise<Machine> {
    const machine = boot();
    await run(machine, 'git init');
    await run(machine, 'echo SANDBOX=strict > sandbox.conf');
    await run(machine, 'git add sandbox.conf');
    await run(machine, 'git commit -m "sandbox: start strict"');
    await run(machine, 'echo READS=own >> sandbox.conf');
    await run(machine, 'git add sandbox.conf');
    await run(machine, 'git commit -m "sandbox: restrict reads"');
    await run(machine, 'echo notes > notes.txt');
    await run(machine, 'git add notes.txt');
    await run(machine, 'git commit -m "notes: the cleaning pass"');
    return machine;
  }

  it('shows the log one line at a time', async () => {
    const out = await run(await seeded(), 'git log --oneline');
    const lines = out.trim().split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toMatch(/^[0-9a-f]{7} notes: the cleaning pass$/);
    expect(lines[2]).toContain('sandbox: start strict');
  });

  it('limits the log, and filters it to one path', async () => {
    const machine = await seeded();
    expect((await run(machine, 'git log --oneline -1')).trim().split('\n')).toHaveLength(1);
    const only = await run(machine, 'git log --oneline -- sandbox.conf');
    expect(only).toContain('sandbox: start strict');
    expect(only).not.toContain('notes: the cleaning pass');
  });

  it('shows one commit with a real unified diff', async () => {
    const out = await run(await seeded(), 'git show HEAD~1');
    expect(out).toContain('sandbox: restrict reads');
    expect(out).toContain('--- a/sandbox.conf');
    expect(out).toMatch(/@@ -\d+,\d+ \+\d+,\d+ @@/);
    expect(out).toContain('+READS=own');
  });

  it('blames each line on the commit that wrote it', async () => {
    const out = await run(await seeded(), 'git blame sandbox.conf');
    const lines = out.trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('SANDBOX=strict');
    expect(lines[1]).toContain('READS=own');
    // Different commits, which is the whole point of the command.
    expect(lines[0]!.slice(0, 7)).not.toBe(lines[1]!.slice(0, 7));
  });

  it('groups the work by who did it', async () => {
    const out = await run(await seeded(), 'git shortlog');
    expect(out).toContain('V. Vasquez (3):');
    expect(out).toContain('sandbox: start strict');
  });

  it('diffs the working tree against the last commit', async () => {
    const machine = await seeded();
    await run(machine, 'echo AUDIT=on >> sandbox.conf');
    const out = await run(machine, 'git diff');
    expect(out).toContain('+AUDIT=on');
    expect(out).not.toContain('+notes');
  });

  it('diffs two revisions against each other', async () => {
    const out = await run(await seeded(), 'git diff HEAD~2 HEAD -- sandbox.conf');
    expect(out).toContain('+READS=own');
  });
});

describe('naming things', () => {
  async function one(): Promise<{ machine: Machine; id: string }> {
    const machine = boot();
    await run(machine, 'git init');
    await run(machine, 'echo a > a.txt');
    await run(machine, 'git add a.txt');
    await run(machine, 'git commit -m "first"');
    return { machine, id: (await run(machine, 'git rev-parse HEAD')).trim() };
  }

  it('resolves HEAD, a branch and an abbreviation to the same id', async () => {
    const { machine, id } = await one();
    expect(id).toMatch(/^[0-9a-f]{40}$/);
    expect((await run(machine, 'git rev-parse main')).trim()).toBe(id);
    expect((await run(machine, `git rev-parse ${id.slice(0, 7)}`)).trim()).toBe(id);
  });

  it('tells a player what kind of object they are looking at', async () => {
    const { machine, id } = await one();
    expect((await run(machine, `git cat-file -t ${id}`)).trim()).toBe('commit');
    expect(await run(machine, `git cat-file ${id}`)).toContain('tree ');
  });

  it('lists a tree the way git does', async () => {
    const { machine, id } = await one();
    const tree = (await run(machine, `git rev-parse ${id}`)).trim();
    const out = await run(machine, `git cat-file ${tree}`);
    expect(out).toContain('tree ');
  });

  it('refuses a name it cannot resolve rather than guessing', async () => {
    const { machine } = await one();
    const result = await machine.exec('git rev-parse nonsense');
    expect(result.code).toBe(128);
    expect(result.stderr).toContain('unknown revision');
  });

  it('makes and lists branches and tags', async () => {
    const { machine } = await one();
    await run(machine, 'git branch check');
    await run(machine, 'git tag filed');
    expect(await run(machine, 'git branch')).toContain('* main');
    expect(await run(machine, 'git branch')).toContain('  check');
    expect((await run(machine, 'git tag')).trim()).toBe('filed');
  });
});

describe('moving around', () => {
  it('switches branches and puts the files back', async () => {
    const machine = boot();
    await run(machine, 'git init');
    await run(machine, 'echo one > a.txt');
    await run(machine, 'git add a.txt');
    await run(machine, 'git commit -m "one"');
    await run(machine, 'git branch other');
    await run(machine, 'echo two > a.txt');
    await run(machine, 'git add a.txt');
    await run(machine, 'git commit -m "two"');

    expect(await run(machine, 'git switch other')).toContain("Switched to branch 'other'");
    expect(await run(machine, 'cat a.txt')).toBe('one\n');
    await run(machine, 'git switch main');
    expect(await run(machine, 'cat a.txt')).toBe('two\n');
  });

  it('keeps a reflog, which is how a lost commit is found', async () => {
    const machine = boot();
    await run(machine, 'git init');
    await run(machine, 'echo a > a.txt');
    await run(machine, 'git add a.txt');
    await run(machine, 'git commit -m "kept"');
    await run(machine, 'git branch gone');
    await run(machine, 'git switch gone');

    const out = await run(machine, 'git reflog');
    expect(out).toContain('checkout: moving to gone');
    expect(out).toContain('commit: kept');
    // Newest first, because what you are looking for is the last thing anybody did.
    expect(out.trim().split('\n')[0]).toContain('HEAD@{0}');
  });
});

describe('git is just files, from the shell', () => {
  it('lets the player look, with the commands they already have', async () => {
    const machine = boot();
    await run(machine, 'git init');
    await run(machine, 'echo SANDBOX=strict > sandbox.conf');
    await run(machine, 'git add sandbox.conf');
    await run(machine, 'git commit -m "first"');

    expect(await run(machine, 'cat .git/HEAD')).toBe('ref: refs/heads/main\n');
    expect(await run(machine, 'ls .git')).toContain('objects');
    // The staging area, readable.
    expect(await run(machine, 'cat .git/index')).toMatch(/^100644 [0-9a-f]{40} sandbox\.conf$/m);
    // And an object, readable, which real git's are not.
    const id = (await run(machine, 'git rev-parse HEAD')).trim();
    expect(await run(machine, `cat .git/objects/${id.slice(0, 2)}/${id.slice(2)}`)).toContain('tree ');
  });
});

describe('bisect', () => {
  /** Eight commits; the flag turns on at the fifth. */
  async function twelve(): Promise<{ machine: Machine; ids: string[] }> {
    const machine = boot();
    await run(machine, 'git init');
    const ids: string[] = [];
    for (let i = 0; i < 8; i++) {
      // Each step has to actually change the file: git refuses a commit that
      // changes nothing, which is correct of it and was this fixture's bug.
      await run(machine, `echo "step ${i} WIDE=${i >= 5 ? 'yes' : 'no'}" > flag.conf`);
      await run(machine, 'git add flag.conf');
      await run(machine, `git commit -m "step ${i}"`);
      ids.push((await run(machine, 'git rev-parse HEAD')).trim());
    }
    return { machine, ids };
  }

  it('walks a player to the first bad commit', async () => {
    const { machine, ids } = await twelve();
    await run(machine, 'git bisect start');
    await run(machine, `git bisect good ${ids[0]}`);
    let out = await run(machine, `git bisect bad ${ids[7]}`);
    expect(out).toContain('revisions left to test after this');

    // Answer honestly until it stops asking.
    for (let guard = 0; guard < 10; guard++) {
      const flag = await run(machine, 'cat flag.conf');
      out = await run(machine, flag.includes('WIDE=no') ? 'git bisect good' : 'git bisect bad');
      if (out.includes('is the first bad commit')) break;
    }
    expect(out).toContain('is the first bad commit');
    expect(out).toContain(ids[5]!);
    expect(out).toContain('step 5');
  });

  it('remembers where it got to, so it survives being left overnight', async () => {
    const { machine, ids } = await twelve();
    await run(machine, 'git bisect start');
    await run(machine, `git bisect good ${ids[0]}`);
    await run(machine, `git bisect bad ${ids[7]}`);

    // The state is a file, not a variable.
    expect(machine.vfs.exists('/repo/.git/BISECT', ROOT_USER)).toBe(true);
    const log = await run(machine, 'git bisect log');
    expect(log).toContain(`good ${ids[0]}`);
    expect(log).toContain(`bad ${ids[7]}`);

    await run(machine, 'git bisect reset');
    expect(machine.vfs.exists('/repo/.git/BISECT', ROOT_USER)).toBe(false);
  });

  it('asks for the other end before it starts guessing', async () => {
    const { machine, ids } = await twelve();
    await run(machine, 'git bisect start');
    const out = await run(machine, `git bisect bad ${ids[7]}`);
    expect(out).toContain('Now mark the other end');
  });
});

describe('where two histories parted', () => {
  it('names the commit they last had in common', async () => {
    const machine = boot();
    await run(machine, 'git init');
    await run(machine, 'echo base > a.txt');
    await run(machine, 'git add a.txt');
    await run(machine, 'git commit -m "base"');
    const base = (await run(machine, 'git rev-parse HEAD')).trim();

    await run(machine, 'git branch check');
    await run(machine, 'echo main > a.txt');
    await run(machine, 'git add a.txt');
    await run(machine, 'git commit -m "on main"');

    await run(machine, 'git switch check');
    await run(machine, 'echo check > b.txt');
    await run(machine, 'git add b.txt');
    await run(machine, 'git commit -m "on check"');

    expect((await run(machine, 'git merge-base main check')).trim()).toBe(base);
  });
});

describe('the manual', () => {
  it('tells the player about the two deviations rather than hiding them', async () => {
    const machine = boot();
    const manual = await run(machine, 'man git');
    expect(manual).toMatch(/not\s+compressed/);
    expect(manual).toContain('.git/index is a text file');
  });

  it('has a plain page too, for somebody who has not met git', async () => {
    const machine = new Machine({
      hostname: 'deposit',
      epoch: EPOCH,
      track: 'cadet',
      commands: gitCommands(),
    });
    const manual = (await machine.exec('man git')).stdout;
    // `man` wraps the page, so the assertion has to fit inside one line of it.
    expect(manual).toContain('changed what, when, and what they said');
    expect(manual).toContain('It is all just files');
  });
});
