import { Repository, ancestors, walk, type ObjectId, type Walked } from '@sigkill/git';
import { ROOT_USER, type Vfs } from '@sigkill/machine';
import type { World } from '@sigkill/quest';
import { CREW, REPO, type CrewId } from './act1/history.js';
import { HOME } from './act1/office.js';

/**
 * How a goal in this act reads the world.
 *
 * Two rules, both learned the hard way in Act I. A goal reads *state*, never
 * the command -- so every helper here takes a world and looks at files and
 * refs. And a goal must not care which filename the player chose: the Act I
 * bug where recording Bowen's heading in a file of your own choosing did not
 * count was a goal that hard-coded a path, and it shipped, and it was the most
 * confusing kind of wrong because the player had done the work.
 *
 * So `written` reads everything the player has written anywhere under their own
 * home directory, and the only paths it skips are the ones the act itself put
 * there. A finding in `findings/sandbox`, in `notes.txt`, or appended to the
 * bottom of a Python script all count, because all three are somebody writing
 * down what they found.
 */

/** Files the office seeded. Not the player's work, so not evidence. */
const SEEDED: ReadonlySet<string> = new Set([
  `${HOME}/README`,
  `${HOME}/KERR`,
  `${HOME}/carried/NOTES`,
]);

/** Every regular file under a directory, as absolute paths. */
export function filesUnder(vfs: Vfs, root: string): string[] {
  const out: string[] = [];
  const go = (dir: string): void => {
    let names: string[];
    try {
      names = vfs.readdir(dir, ROOT_USER);
    } catch {
      return;
    }
    for (const name of names) {
      const path = `${dir}/${name}`.replace(/\/+/g, '/');
      let kind: string;
      try {
        kind = vfs.lstat(path, ROOT_USER).kind;
      } catch {
        continue;
      }
      if (kind === 'dir') go(path);
      else if (kind === 'file') out.push(path);
    }
  };
  go(root);
  return out;
}

/**
 * Everything the player has written, as one lowercase blob.
 *
 * Lowercased because a finding is a finding whether they typed `Vasquez` or
 * `vasquez`, and a goal that turned on capitalisation would be a quiz.
 */
export function written(w: World): string {
  const parts: string[] = [];
  for (const path of filesUnder(w.vfs, HOME)) {
    if (SEEDED.has(path)) continue;
    try {
      parts.push(w.vfs.readText(path, ROOT_USER));
    } catch {
      // Unreadable, or not text. Either way not a finding.
    }
  }
  return parts.join('\n').toLowerCase();
}

/** The player's own Python, for the objective that wants a program as well as an answer. */
export function pythonFiles(w: World): string[] {
  return filesUnder(w.vfs, HOME).filter((path) => path.endsWith('.py'));
}

/** Open the deposit repository for reading. */
export function repoOf(w: World): Repository | undefined {
  const repo = new Repository({
    root: REPO,
    vfs: w.vfs,
    user: ROOT_USER,
    now: () => 0,
    identity: () => ({ name: 'reader', email: 'reader@deposit' }),
  });
  return repo.exists ? repo : undefined;
}

/**
 * Does the writing cite this commit?
 *
 * Any abbreviation of seven characters or more, which is what `--oneline`
 * prints and therefore what a player will paste. Fewer than seven would start
 * matching by accident across a history this size.
 */
export function cites(text: string, id: ObjectId): boolean {
  for (let length = id.length; length >= 7; length--) {
    if (text.includes(id.slice(0, length))) return true;
  }
  return false;
}

/**
 * Commits per author, counted the way `git shortlog` counts them.
 *
 * From `main` only, rather than from every branch. That is not a detail: the
 * goal asks the player to write down each person's share, and the only share
 * they can obtain is the one `git shortlog` prints, which walks from HEAD.
 * Counting every tip here made the goal demand numbers the game would never
 * show them -- a goal that cannot be satisfied by playing, which is the worst
 * kind of wrong because the player has done the work correctly.
 *
 * Chen's guard branch is included anyway, because it was merged; her rate-limit
 * branch is not, because it never was. Both of those are the act's point.
 */
export function commitCounts(repo: Repository): Record<CrewId, number> {
  const counts: Record<CrewId, number> = { vasquez: 0, chen: 0, bowen: 0, okonkwo: 0 };
  const main = repo.readRef('refs/heads/main');
  if (main === undefined) return counts;

  for (const step of walk(repo, [main])) {
    const email = step.commit.author.email;
    for (const [id, who] of Object.entries(CREW) as Array<[CrewId, { email: string }]>) {
      if (who.email === email) counts[id] += 1;
    }
  }
  return counts;
}

/**
 * The findings, computed from the repository rather than remembered.
 *
 * Every id here is found by asking the history a question -- which commit
 * first read this, which commit has two parents -- rather than by being handed
 * a value the seed returned. That costs a walk per check and buys the thing
 * worth having: the goals and the authored history cannot drift apart. Edit a
 * commit message in `history.ts` and these follow it; there is no second copy
 * of the truth to forget to update.
 */
export interface Facts {
  readonly main: ObjectId;
  readonly firstV43?: ObjectId;
  readonly widened?: ObjectId;
  readonly firstRestrictedRead?: ObjectId;
  readonly merge?: ObjectId;
  readonly mergeSecondParent?: ObjectId;
  readonly safety?: ObjectId;
  readonly orphan?: ObjectId;
}

/** Ordered oldest first. */
const byAge = (steps: readonly Walked[]): Walked[] =>
  [...steps].sort((a, b) => a.commit.author.when - b.commit.author.when);

export function facts(repo: Repository): Facts | undefined {
  const main = repo.readRef('refs/heads/main');
  if (main === undefined) return undefined;

  const history = byAge(walk(repo, [main]));

  /** The commit where a property of a file became true. */
  const became = (path: string, needle: string): ObjectId | undefined => {
    for (const step of history) {
      const now = repo.fileAt(step.id, path)?.includes(needle) === true;
      if (!now) continue;
      const parent = step.commit.parents[0];
      const before =
        parent === undefined ? false : repo.fileAt(parent, path)?.includes(needle) === true;
      if (!before) return step.id;
    }
    return undefined;
  };

  const firstV43 = history.find((step) => /v43/i.test(step.commit.message))?.id;
  const merge = history.find((step) => step.commit.parents.length > 1);

  // The commit nothing points at: in the reflog, not an ancestor of main.
  const reachable = ancestors(repo, main);
  let orphan: ObjectId | undefined;
  for (const line of repo.reflog()) {
    for (const token of line.split(/\s+/)) {
      if (/^[0-9a-f]{40}$/.test(token) && !reachable.has(token) && repo.has(token)) {
        orphan = token;
      }
    }
  }

  const safetyBranch = repo.branches().find((branch) => branch.startsWith('safety/'));

  return {
    main,
    firstV43,
    widened: became('sandbox/sandbox.conf', 'datasets/restricted/crew-health'),
    firstRestrictedRead: became('v43/reader.py', 'datasets/restricted/crew-health'),
    merge: merge?.id,
    mergeSecondParent: merge?.commit.parents[1],
    safety:
      safetyBranch === undefined ? undefined : repo.readRef(`refs/heads/${safetyBranch}`),
    orphan,
  };
}

/** A branch the player made, with a commit of their own on top of it. */
export function ownBranch(repo: Repository, seeded: ReadonlySet<string>): string | undefined {
  for (const branch of repo.branches()) {
    if (seeded.has(branch)) continue;
    const tip = repo.readRef(`refs/heads/${branch}`);
    if (tip === undefined) continue;
    const author = repo.readCommit(tip).author;
    if (/dewitt/i.test(author.name) || /dewitt/i.test(author.email)) return branch;
  }
  return undefined;
}
