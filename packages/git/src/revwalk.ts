import type { Repository } from './repo.js';
import type { CommitData, ObjectId } from './objects.js';

/**
 * Walking history, which is a directed graph and not a list.
 *
 * Every function here had to be written for merges rather than for a straight
 * line, because the act turns on a merge that dropped a safety check -- and a
 * `log` that followed only first parents would never show it, while a `bisect`
 * that assumed a line would walk off the side of the graph.
 */

export interface Walked {
  readonly id: ObjectId;
  readonly commit: CommitData;
}

/**
 * History from one or more starting points, newest first.
 *
 * Ordered by commit time and then by id, which gives a stable order for a graph
 * where two commits share a second -- and a seeded history built by a loop shares
 * seconds constantly. Real git breaks that tie differently, but *having* a tie
 * break is the part that matters: without one, `log` output would vary between
 * runs and the transcript tests would be unreproducible.
 */
export function walk(
  repo: Repository,
  from: readonly ObjectId[],
  opts: { firstParentOnly?: boolean; limit?: number; path?: string } = {},
): Walked[] {
  const seen = new Set<ObjectId>();
  const found: Walked[] = [];
  const queue = [...from];

  while (queue.length > 0) {
    const id = queue.shift()!;
    if (id === undefined || seen.has(id)) continue;
    seen.add(id);
    let commit: CommitData;
    try {
      commit = repo.readCommit(id);
    } catch {
      continue;
    }
    found.push({ id, commit });
    const parents = opts.firstParentOnly ? commit.parents.slice(0, 1) : commit.parents;
    queue.push(...parents);
  }

  found.sort((a, b) => {
    const when = b.commit.committer.when - a.commit.committer.when;
    return when !== 0 ? when : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  const filtered = opts.path === undefined ? found : found.filter((w) => touches(repo, w, opts.path!));
  return opts.limit === undefined ? filtered : filtered.slice(0, opts.limit);
}

/**
 * Did this commit change this path?
 *
 * Compared against the first parent, the way `git log -- path` does. A commit
 * whose parents all have the same content at the path did not touch it, however
 * much else it changed -- which is what makes `git log -- luna/` a useful
 * question rather than the whole history again.
 */
export function touches(repo: Repository, walked: Walked, path: string): boolean {
  const mine = repo.fileAt(walked.id, path);
  if (walked.commit.parents.length === 0) return mine !== undefined;
  return walked.commit.parents.every((parent) => repo.fileAt(parent, path) !== mine);
}

/** Every ancestor of a commit, itself included. */
export function ancestors(repo: Repository, id: ObjectId): Set<ObjectId> {
  const out = new Set<ObjectId>();
  const queue = [id];
  while (queue.length > 0) {
    const at = queue.shift()!;
    if (out.has(at)) continue;
    out.add(at);
    try {
      queue.push(...repo.readCommit(at).parents);
    } catch {
      // A missing object ends that branch of the walk rather than the walk.
    }
  }
  return out;
}

/**
 * The best common ancestor of two commits.
 *
 * "Best" meaning the newest of the common ones: an older shared ancestor is also
 * common and tells you nothing about where the two histories actually parted. It
 * is the commit `git merge-base` names, and the one a player needs to answer
 * "what is on this branch that is not on main".
 */
export function mergeBase(repo: Repository, a: ObjectId, b: ObjectId): ObjectId | undefined {
  const mine = ancestors(repo, a);
  const shared = [...ancestors(repo, b)].filter((id) => mine.has(id));
  if (shared.length === 0) return undefined;

  let best: { id: ObjectId; when: number } | undefined;
  for (const id of shared) {
    const when = repo.readCommit(id).committer.when;
    if (best === undefined || when > best.when || (when === best.when && id < best.id)) {
      best = { id, when };
    }
  }
  return best?.id;
}

/** Commits reachable from `head` but not from `exclude`. Newest first. */
export function notIn(repo: Repository, head: ObjectId, exclude: ObjectId): Walked[] {
  const theirs = ancestors(repo, exclude);
  return walk(repo, [head]).filter((w) => !theirs.has(w.id));
}

// -------------------------------------------------------------------- bisect

export interface BisectState {
  readonly good: readonly ObjectId[];
  readonly bad: ObjectId;
}

/**
 * The commits a bisect still has to consider.
 *
 * Ancestors of the bad commit, minus the ancestors of every good one. Set
 * subtraction rather than a range, because with a merge in the history the
 * "range" is not an interval and pretending otherwise is how a bisect starts
 * testing commits that cannot be the culprit.
 */
export function bisectCandidates(repo: Repository, state: BisectState): Walked[] {
  const reachable = walk(repo, [state.bad]);
  const known = new Set<ObjectId>();
  for (const good of state.good) for (const id of ancestors(repo, good)) known.add(id);
  return reachable.filter((w) => !known.has(w.id) && w.id !== state.bad);
}

/**
 * The commit to test next: the one that halves the remaining work.
 *
 * Git's own heuristic, and the reason bisect is logarithmic rather than linear --
 * pick the candidate whose own ancestor count within the candidate set is closest
 * to half of it, so whichever way the answer goes, half the suspects are gone.
 *
 * Returns undefined when nothing is left to test, which means the bad commit's
 * parent is good and the bad commit is the answer.
 */
export function bisectNext(repo: Repository, state: BisectState): Walked | undefined {
  const candidates = bisectCandidates(repo, state);
  if (candidates.length === 0) return undefined;

  const inSet = new Set(candidates.map((c) => c.id));
  let best: { walked: Walked; distance: number } | undefined;

  for (const candidate of candidates) {
    let below = 0;
    for (const id of ancestors(repo, candidate.id)) if (inSet.has(id)) below++;
    const distance = Math.abs(below - candidates.length / 2);
    if (best === undefined || distance < best.distance) best = { walked: candidate, distance };
  }
  return best?.walked;
}

/**
 * Run a whole bisect with a predicate, for tests and for a seeded history.
 *
 * The game drives the real thing one `git bisect good`/`bad` at a time, because
 * typing those is the lesson. This is the same search with the waiting taken out,
 * and it is what proves the search converges on a graph with merges in it.
 */
export function bisect(
  repo: Repository,
  state: BisectState,
  isGood: (id: ObjectId) => boolean,
): { firstBad: ObjectId; steps: number } {
  let good = [...state.good];
  let bad = state.bad;
  let steps = 0;

  for (;;) {
    const next = bisectNext(repo, { good, bad });
    if (next === undefined) return { firstBad: bad, steps };
    steps++;
    if (isGood(next.id)) good = [...good, next.id];
    else bad = next.id;
  }
}
