import { describe, expect, it } from 'vitest';
import { Machine, ROOT_USER } from '@sigkill/machine';
import { Repository } from '../src/repo.js';
import { ancestors, bisect, bisectNext, mergeBase, notIn, walk } from '../src/revwalk.js';
import { blame, blameLine, history } from '../src/blame.js';
import type { ObjectId } from '../src/objects.js';

/**
 * Walking a graph, not a list.
 *
 * Every test here builds a history with a merge in it, because the act turns on a
 * merge that dropped a safety check -- and a `log` that followed only first
 * parents would never show it while a `bisect` that assumed a straight line would
 * walk off the side of the graph.
 */

const T0 = 13_519_887_120;

interface World {
  repo: Repository;
  machine: Machine;
  at: (seconds: number) => void;
  who: (name: string) => void;
  put: (path: string, body: string) => void;
  save: (path: string, body: string, message: string) => ObjectId;
}

function world(): World {
  const machine = new Machine({ hostname: 'deposit' });
  machine.vfs.mkdirp('/repo', ROOT_USER);
  let when = T0;
  let name = 'V. Vasquez';
  const repo = new Repository({
    root: '/repo',
    vfs: machine.vfs,
    user: ROOT_USER,
    now: () => when,
    identity: () => ({ name, email: `${name.split(' ').pop()!.toLowerCase()}@nav7` }),
  });
  repo.init();

  const put = (path: string, body: string): void => {
    const full = `/repo/${path}`;
    machine.vfs.mkdirp(full.slice(0, full.lastIndexOf('/')), ROOT_USER);
    machine.vfs.writeText(full, body, ROOT_USER);
  };

  return {
    repo,
    machine,
    at: (seconds) => { when = T0 + seconds; },
    who: (n) => { name = n; },
    put,
    save: (path, body, message) => {
      put(path, body);
      repo.stage(path);
      return repo.commit(message);
    },
  };
}

/**
 * The shape the act needs: a line of work, a branch off it, and a merge that
 * takes one side.
 *
 *   A -- B -- C ---- M   (main)
 *          \        /
 *           D ---- E     (check)
 */
function forked(): { w: World; ids: Record<string, ObjectId> } {
  const w = world();
  w.at(0);
  const a = w.save('sandbox.conf', 'SANDBOX=strict\nREADS=own\n', 'sandbox: start strict');
  w.at(3600);
  const b = w.save('notes.txt', 'cleaning pass planned\n', 'notes: plan the cleaning pass');
  w.at(7200);
  const c = w.save('sandbox.conf', 'SANDBOX=wide\nREADS=own\n', 'sandbox: widen, temporary');

  // Okonkwo branches off B and adds the check nobody merged.
  w.repo.writeRef('refs/heads/check', b);
  w.repo.checkout(b);
  w.who('L. Okonkwo');
  w.at(9000);
  w.machine.vfs.writeText('/repo/.git/HEAD', 'ref: refs/heads/check\n', ROOT_USER);
  const d = w.save('guard.py', 'def allowed(path):\n    return path.startswith("own/")\n', 'guard: refuse reads outside own/');
  w.at(10_800);
  const e = w.save('guard.py', 'def allowed(path):\n    return path.startswith("own/")\n\nSTRICT = True\n', 'guard: default to strict');

  // Back to main, and merge taking main's side of the conflict.
  w.machine.vfs.writeText('/repo/.git/HEAD', 'ref: refs/heads/main\n', ROOT_USER);
  w.repo.checkout(c);
  w.who('V. Vasquez');
  w.at(14_400);
  w.put('sandbox.conf', 'SANDBOX=wide\nREADS=own\n');
  w.repo.stage('sandbox.conf');
  const m = w.repo.commit('merge check: take ours, sort it out in the morning', { parents: [c, e] });

  return { w, ids: { a, b, c, d, e, m } };
}

describe('walking the graph', () => {
  it('sees both sides of a merge, newest first', () => {
    const { w, ids } = forked();
    const seen = walk(w.repo, [ids.m!]).map((x) => x.id);
    expect(seen[0]).toBe(ids.m);
    for (const id of Object.values(ids)) expect(seen, id).toContain(id);
    expect(seen).toHaveLength(6);
  });

  /*
   * And the thing that would have hidden the whole puzzle.
   *
   * `--first-parent` is a real and useful view, and it is also the view in which
   * the merge that dropped the check looks like an ordinary commit with no second
   * side at all.
   */
  it('hides the other side when asked for first parents only', () => {
    const { w, ids } = forked();
    const seen = walk(w.repo, [ids.m!], { firstParentOnly: true }).map((x) => x.id);
    expect(seen).toContain(ids.c);
    expect(seen).not.toContain(ids.d);
    expect(seen).not.toContain(ids.e);
  });

  it('is stable when two commits share a second', () => {
    const w = world();
    w.at(0);
    const first = w.save('a.txt', 'a\n', 'first');
    const second = w.save('b.txt', 'b\n', 'second');
    const once = walk(w.repo, [second]).map((x) => x.id);
    const twice = walk(w.repo, [second]).map((x) => x.id);
    expect(once).toEqual(twice);
    expect(once).toContain(first);
  });

  it('filters to the commits that touched one path', () => {
    const { w, ids } = forked();
    const touched = walk(w.repo, [ids.m!], { path: 'sandbox.conf' }).map((x) => x.id);
    expect(touched).toContain(ids.a);
    expect(touched).toContain(ids.c);
    // B only added notes.txt, and the merge took main's side unchanged.
    expect(touched).not.toContain(ids.b);
  });

  it('counts ancestors including the commit itself', () => {
    const { w, ids } = forked();
    expect(ancestors(w.repo, ids.a!)).toEqual(new Set([ids.a]));
    expect(ancestors(w.repo, ids.c!).size).toBe(3);
    expect(ancestors(w.repo, ids.m!).size).toBe(6);
  });
});

describe('where two histories parted', () => {
  it('names the newest common ancestor, not just any', () => {
    const { w, ids } = forked();
    expect(mergeBase(w.repo, ids.c!, ids.e!)).toBe(ids.b);
    // Not A, which is also common and says nothing about where they diverged.
    expect(mergeBase(w.repo, ids.c!, ids.e!)).not.toBe(ids.a);
  });

  it('says nothing when there is nothing in common', () => {
    const w = world();
    w.at(0);
    const one = w.save('a.txt', 'a\n', 'one');
    // A second root: no parent, so no shared ancestry at all.
    w.at(60);
    w.put('b.txt', 'b\n');
    w.repo.stage('b.txt');
    const orphan = w.repo.commit('orphan', { parents: [] });
    expect(mergeBase(w.repo, one, orphan)).toBeUndefined();
  });

  /*
   * The question objective five actually asks: what is on this branch that never
   * reached main?
   */
  it('lists what one branch has that another does not', () => {
    const { w, ids } = forked();
    const theirs = notIn(w.repo, ids.e!, ids.c!).map((x) => x.id);
    expect(theirs).toEqual([ids.e, ids.d]);
  });
});

describe('who wrote this line', () => {
  it('attributes each line to the commit that introduced it', () => {
    const w = world();
    w.at(0);
    const first = w.save('sandbox.conf', 'SANDBOX=strict\nREADS=own\n', 'sandbox: start strict');
    w.who('L. Okonkwo');
    w.at(3600);
    const second = w.save('sandbox.conf', 'SANDBOX=strict\nREADS=own\nAUDIT=on\n', 'sandbox: audit the reads');

    const lines = blame(w.repo, second, 'sandbox.conf');
    expect(lines.map((l) => [l.line, l.text, l.commit])).toEqual([
      [1, 'SANDBOX=strict', first],
      [2, 'READS=own', first],
      [3, 'AUDIT=on', second],
    ]);
    expect(lines[2]!.author).toBe('L. Okonkwo');
    expect(lines[2]!.summary).toBe('sandbox: audit the reads');
  });

  /*
   * The test that makes the diff worth having.
   *
   * Insert a line at the *top* of a file. With a positional comparison every line
   * below it would be re-attributed to whoever did the inserting -- a blame that
   * blames the last person to touch anything for all of it, which is worse than
   * no blame because it reads as an accusation.
   */
  it('does not blame the whole file on somebody who inserted one line at the top', () => {
    const w = world();
    w.at(0);
    const first = w.save('conf', 'one\ntwo\nthree\n', 'first');
    w.who('R. Bowen');
    w.at(3600);
    const second = w.save('conf', 'zero\none\ntwo\nthree\n', 'add a line at the top');

    const lines = blame(w.repo, second, 'conf');
    expect(lines.map((l) => l.commit)).toEqual([second, first, first, first]);
    expect(lines.filter((l) => l.author === 'R. Bowen')).toHaveLength(1);
  });

  it('keeps a line attributed to its author across an unrelated change', () => {
    const w = world();
    w.at(0);
    const first = w.save('conf', 'keep me\n', 'first');
    w.who('M. Chen');
    w.at(3600);
    const second = w.save('conf', 'keep me\nand another\n', 'add another');
    w.at(7200);
    const third = w.save('conf', 'keep me\nand another\nand a third\n', 'add a third');

    const lines = blame(w.repo, third, 'conf');
    expect(lines[0]!.commit).toBe(first);
    expect(lines[1]!.commit).toBe(second);
    expect(lines[2]!.commit).toBe(third);
  });

  it('answers about one line, which is the question a player asks', () => {
    const { w, ids } = forked();
    const line = blameLine(w.repo, ids.m!, 'sandbox.conf', 1);
    expect(line?.text).toBe('SANDBOX=wide');
    expect(line?.commit).toBe(ids.c);
    expect(line?.summary).toBe('sandbox: widen, temporary');
  });

  it('says nothing about a path that is not there', () => {
    const { w, ids } = forked();
    expect(blame(w.repo, ids.m!, 'nothing.txt')).toEqual([]);
  });

  it('lists a path\'s own history, oldest first', () => {
    const { w, ids } = forked();
    const shown = history(w.repo, ids.m!, 'sandbox.conf');
    expect(shown.map((h) => h.summary)).toEqual([
      'sandbox: start strict',
      'sandbox: widen, temporary',
    ]);
    expect(shown[0]!.id).toBe(ids.a);
  });
});

describe('bisect', () => {
  /** Twelve commits, one of which turns the flag on. */
  function line(): { w: World; ids: ObjectId[]; culprit: number } {
    const w = world();
    const ids: ObjectId[] = [];
    const culprit = 7;
    for (let i = 0; i < 12; i++) {
      w.at(i * 3600);
      ids.push(w.save('flag.conf', `WIDE=${i >= culprit ? 'yes' : 'no'}\n`, `step ${i}`));
    }
    return { w, ids, culprit };
  }

  const isGood = (w: World) => (id: ObjectId): boolean =>
    w.repo.fileAt(id, 'flag.conf')?.includes('WIDE=no') === true;

  it('finds the first bad commit', () => {
    const { w, ids, culprit } = line();
    const { firstBad } = bisect(
      w.repo,
      { good: [ids[0]!], bad: ids[11]! },
      isGood(w),
    );
    expect(firstBad).toBe(ids[culprit]);
  });

  /*
   * And finds it in about log2(n) steps, which is the entire reason to teach it.
   *
   * A bisect that walked linearly would still get the right answer and would
   * teach the wrong lesson.
   */
  it('gets there logarithmically, not linearly', () => {
    const { w, ids } = line();
    const { steps } = bisect(w.repo, { good: [ids[0]!], bad: ids[11]! }, isGood(w));
    expect(steps).toBeLessThanOrEqual(5);
    expect(steps).toBeGreaterThan(0);
  });

  it('works when the culprit is on a merged branch', () => {
    const { w, ids } = forked();
    // "Bad" means guard.py exists -- true only on the branch and after the merge
    // would have brought it, which it did not. So the first bad commit is D.
    const bad = (id: ObjectId): boolean => w.repo.fileAt(id, 'guard.py') !== undefined;
    const { firstBad } = bisect(w.repo, { good: [ids.b!], bad: ids.e! }, (id) => !bad(id));
    expect(firstBad).toBe(ids.d);
  });

  it('stops immediately when the bad commit is the first one after a good one', () => {
    const { w, ids } = forked();
    const result = bisect(w.repo, { good: [ids.a!], bad: ids.b! }, () => true);
    expect(result.firstBad).toBe(ids.b);
    expect(result.steps).toBe(0);
  });

  it('never offers a commit that is already known good', () => {
    const { w, ids } = line();
    const next = bisectNext(w.repo, { good: [ids[0]!, ids[1]!, ids[2]!], bad: ids[11]! });
    expect(next).toBeDefined();
    expect([ids[0], ids[1], ids[2], ids[11]]).not.toContain(next!.id);
  });
});
