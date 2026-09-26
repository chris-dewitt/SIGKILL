import { describe, expect, it } from 'vitest';
import { Machine, ROOT_USER } from '@sigkill/machine';
import { Repository } from '../src/repo.js';

/**
 * A repository built by this package, checked against one built by real git.
 *
 * This is the test the whole package exists to pass. The history below was
 * created with git 2.50 -- two commits, fixed authors, fixed dates -- and the
 * shas are pasted in. If the object model, the tree building, the index or the
 * commit encoding is wrong anywhere, the ids stop matching and this goes red.
 *
 * To regenerate:
 *
 *     git init -q ref && cd ref && git config core.autocrlf false
 *     T1=13519887120; T2=$((T1 + 3600))
 *     mkdir luna
 *     printf 'SANDBOX=strict\n' > sandbox.conf
 *     printf 'def answer():\n    return 42\n' > luna/core.py
 *     git add -A
 *     GIT_AUTHOR_DATE="@$T1 +0000" GIT_COMMITTER_DATE="@$T1 +0000" \
 *     GIT_AUTHOR_NAME="V. Vasquez" GIT_AUTHOR_EMAIL="vasquez@nav7" \
 *     GIT_COMMITTER_NAME="V. Vasquez" GIT_COMMITTER_EMAIL="vasquez@nav7" \
 *       git commit -q -m "sandbox: start strict"
 *     printf 'SANDBOX=wide\n' > sandbox.conf
 *     git add -A && ... (same, with $T2 and the second message)
 */

/** 2398-06-06 04:12:00 +0000, and an hour later. */
const T1 = 13_519_887_120;
const T2 = T1 + 3600;

const C1 = '038e427615095d9c496de8e1d6c006740fc004c2';
const C2 = '90da176080d1c7a57c1f6d487274c87713ad9d0b';
const TREE2 = 'e8eef27f1d686c574bbc3f0e3fea296b1ad9df8b';

const VASQUEZ = { name: 'V. Vasquez', email: 'vasquez@nav7' };

/** A machine with a working tree, and a clock the test drives. */
function world(): { repo: Repository; machine: Machine; tick: (to: number) => void } {
  const machine = new Machine({ hostname: 'deposit' });
  machine.vfs.mkdirp('/work', ROOT_USER);
  let when = T1;
  const repo = new Repository({
    root: '/work',
    vfs: machine.vfs,
    user: ROOT_USER,
    now: () => when,
    identity: () => VASQUEZ,
  });
  repo.init();
  return { repo, machine, tick: (to: number) => { when = to; } };
}

const put = (machine: Machine, path: string, body: string): void => {
  const dir = path.slice(0, path.lastIndexOf('/'));
  machine.vfs.mkdirp(dir, ROOT_USER);
  machine.vfs.writeText(path, body, ROOT_USER);
};

describe('a repository real git would recognise', () => {
  it('produces the same commit ids for the same history', () => {
    const { repo, machine, tick } = world();

    put(machine, '/work/sandbox.conf', 'SANDBOX=strict\n');
    put(machine, '/work/luna/core.py', 'def answer():\n    return 42\n');
    repo.stage('sandbox.conf');
    repo.stage('luna/core.py');
    const first = repo.commit('sandbox: start strict');
    expect(first).toBe(C1);

    tick(T2);
    put(machine, '/work/sandbox.conf', 'SANDBOX=wide\n');
    repo.stage('sandbox.conf');
    const second = repo.commit('sandbox: widen for the cleaning pass, temporary');
    expect(second).toBe(C2);

    // And the tree, which is where a flat index becomes a nested structure --
    // the one place the two shapes have to be reconciled by hand.
    expect(repo.readCommit(second).tree).toBe(TREE2);
    expect(repo.readCommit(second).parents).toEqual([C1]);
  });

  it('is deterministic: the same script twice is the same history', () => {
    const build = (): string => {
      const { repo, machine, tick } = world();
      put(machine, '/work/sandbox.conf', 'SANDBOX=strict\n');
      put(machine, '/work/luna/core.py', 'def answer():\n    return 42\n');
      repo.stage('sandbox.conf');
      repo.stage('luna/core.py');
      repo.commit('sandbox: start strict');
      tick(T2);
      put(machine, '/work/sandbox.conf', 'SANDBOX=wide\n');
      repo.stage('sandbox.conf');
      return repo.commit('sandbox: widen for the cleaning pass, temporary');
    };
    expect(build()).toBe(build());
  });
});

describe('git is just files', () => {
  /*
   * The single most valuable thing a git course can teach, so it had better be
   * true here: the objects and the refs are files in the Machine's own
   * filesystem, and the player can look at them with the commands they already
   * know.
   */
  it('keeps its objects where git keeps them', () => {
    const { repo, machine } = world();
    put(machine, '/work/sandbox.conf', 'SANDBOX=strict\n');
    const id = repo.stage('sandbox.conf');

    const path = `/work/.git/objects/${id.slice(0, 2)}/${id.slice(2)}`;
    expect(machine.vfs.exists(path, ROOT_USER)).toBe(true);
  });

  /*
   * And readable, which real git's are not.
   *
   * A deliberate deviation: real git deflates loose objects and this package
   * depends on nothing. The ids are still real, so everything a player learns
   * transfers -- and `cat` showing `blob 15\0SANDBOX=strict` is a better first
   * lesson in what an object is than an unreadable block of compressed bytes.
   */
  it('stores them uncompressed, so cat is a lesson rather than a mess', () => {
    const { repo, machine } = world();
    put(machine, '/work/sandbox.conf', 'SANDBOX=strict\n');
    const id = repo.stage('sandbox.conf');
    const raw = machine.vfs.readText(`/work/.git/objects/${id.slice(0, 2)}/${id.slice(2)}`, ROOT_USER);
    expect(raw).toBe('blob 15\0SANDBOX=strict\n');
  });

  it('writes HEAD and the branch ref as text a player can read', async () => {
    const { repo, machine } = world();
    put(machine, '/work/sandbox.conf', 'x\n');
    repo.stage('sandbox.conf');
    const id = repo.commit('first');

    expect(machine.vfs.readText('/work/.git/HEAD', ROOT_USER)).toBe('ref: refs/heads/main\n');
    expect(machine.vfs.readText('/work/.git/refs/heads/main', ROOT_USER)).toBe(`${id}\n`);
    expect((await machine.exec('cat /work/.git/HEAD')).stdout).toContain('refs/heads/main');
  });

  it('keeps a staging area a player can cat', () => {
    const { repo, machine } = world();
    put(machine, '/work/a.txt', 'a\n');
    put(machine, '/work/b.txt', 'b\n');
    repo.stage('b.txt');
    repo.stage('a.txt');
    // Sorted, so the index is stable and a diff of two indexes means something.
    const index = machine.vfs.readText('/work/.git/index', ROOT_USER);
    expect(index.split('\n')[0]).toMatch(/^100644 [0-9a-f]{40} a\.txt$/);
    expect(index.split('\n')[1]).toMatch(/ b\.txt$/);
  });
});

describe('naming a commit the way a person would', () => {
  function history(): { repo: Repository; ids: string[] } {
    const { repo, machine, tick } = world();
    const ids: string[] = [];
    for (const [i, body] of ['one\n', 'two\n', 'three\n'].entries()) {
      tick(T1 + i * 3600);
      put(machine, '/work/notes.txt', body);
      repo.stage('notes.txt');
      ids.push(repo.commit(`note ${i + 1}`));
    }
    return { repo, ids };
  }

  it('takes a full id, HEAD, and a branch name', () => {
    const { repo, ids } = history();
    expect(repo.resolve(ids[2]!)).toBe(ids[2]);
    expect(repo.resolve('HEAD')).toBe(ids[2]);
    expect(repo.resolve('main')).toBe(ids[2]);
  });

  /*
   * And an abbreviation, which is not a nicety.
   *
   * Every real git workflow is built on pasting the first seven characters out
   * of a log. A game that demanded forty would be teaching a dialect nobody
   * speaks.
   */
  it('takes a short id, and refuses one that is ambiguous or unknown', () => {
    const { repo, ids } = history();
    expect(repo.resolve(ids[0]!.slice(0, 7))).toBe(ids[0]);
    expect(repo.resolve('0000')).toBeUndefined();
    expect(repo.resolve('nope')).toBeUndefined();
    expect(repo.resolve('')).toBeUndefined();
  });

  it('walks backwards with ~ and ^', () => {
    const { repo, ids } = history();
    expect(repo.resolve('HEAD~1')).toBe(ids[1]);
    expect(repo.resolve('HEAD~2')).toBe(ids[0]);
    expect(repo.resolve('HEAD^')).toBe(ids[1]);
    expect(repo.resolve('HEAD~3')).toBeUndefined();
  });
});

describe('what has changed', () => {
  it('separates staged, changed and untracked', () => {
    const { repo, machine } = world();
    put(machine, '/work/committed.txt', 'one\n');
    repo.stage('committed.txt');
    repo.commit('first');

    put(machine, '/work/committed.txt', 'one, edited\n');
    put(machine, '/work/fresh.txt', 'new\n');
    put(machine, '/work/staged.txt', 'staged\n');
    repo.stage('staged.txt');

    const status = repo.status();
    expect(status.staged).toEqual(['staged.txt']);
    expect(status.changed).toEqual(['committed.txt']);
    expect(status.untracked).toEqual(['fresh.txt']);
  });

  it('never reports .git itself as untracked', () => {
    const { repo, machine } = world();
    put(machine, '/work/a.txt', 'a\n');
    repo.stage('a.txt');
    repo.commit('first');
    expect(repo.status().untracked).toEqual([]);
    expect(repo.walkWorkTree().some((p) => p.startsWith('.git'))).toBe(false);
  });
});

describe('reading history back out', () => {
  it('hands back a file as it was at any commit', () => {
    const { repo, machine, tick } = world();
    put(machine, '/work/sandbox.conf', 'SANDBOX=strict\n');
    repo.stage('sandbox.conf');
    const before = repo.commit('strict');

    tick(T2);
    put(machine, '/work/sandbox.conf', 'SANDBOX=wide\n');
    repo.stage('sandbox.conf');
    const after = repo.commit('wide');

    expect(repo.fileAt(before, 'sandbox.conf')).toBe('SANDBOX=strict\n');
    expect(repo.fileAt(after, 'sandbox.conf')).toBe('SANDBOX=wide\n');
    expect(repo.fileAt(before, 'nothing.txt')).toBeUndefined();
  });

  it('puts a whole revision back in the working tree', () => {
    const { repo, machine, tick } = world();
    put(machine, '/work/keep.txt', 'first\n');
    repo.stage('keep.txt');
    const first = repo.commit('first');

    tick(T2);
    put(machine, '/work/keep.txt', 'second\n');
    put(machine, '/work/added-later.txt', 'later\n');
    repo.stage('keep.txt');
    repo.stage('added-later.txt');
    repo.commit('second');

    repo.checkout(first);
    expect(machine.vfs.readText('/work/keep.txt', ROOT_USER)).toBe('first\n');
    // And the file that did not exist then does not exist now.
    expect(machine.vfs.exists('/work/added-later.txt', ROOT_USER)).toBe(false);
  });

  it('records every move HEAD makes, which is how a lost commit is found', () => {
    const { repo, machine, tick } = world();
    put(machine, '/work/a.txt', 'a\n');
    repo.stage('a.txt');
    const first = repo.commit('first');
    tick(T2);
    put(machine, '/work/a.txt', 'b\n');
    repo.stage('a.txt');
    const second = repo.commit('second');

    const log = repo.reflog();
    expect(log).toHaveLength(2);
    expect(log[0]).toContain(first);
    expect(log[1]).toContain(`${first} ${second}`);
    expect(log[1]).toContain('commit: second');
  });
});
