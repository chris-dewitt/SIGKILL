import { diffLines } from './diff.js';
import type { Repository } from './repo.js';
import type { ObjectId } from './objects.js';
import { walk } from './revwalk.js';

/**
 * Who last touched each line, and when.
 *
 * The centre of the act. Objective three is one line of a sandbox config, and the
 * whole beat is that the line has an author, a date and a message attached to it
 * -- that somebody decided this, on purpose, for a reason they wrote down, and
 * that the reason is *reasonable*.
 *
 * The method is the obvious one and the only honest one: walk the path's history
 * oldest to newest, diff each version against the one before, and stamp every
 * line an edit introduced with the commit that introduced it. Lines carried
 * through unchanged keep the stamp they already had.
 *
 * That is why the diff had to be a real edit-distance diff. With a positional
 * comparison, inserting one line at the top of a file would re-attribute every
 * line below it to whoever did the inserting -- a blame that blamed the last
 * person to touch anything for all of it.
 */

export interface BlameLine {
  /** 1-based line number in the final version. */
  readonly line: number;
  readonly text: string;
  readonly commit: ObjectId;
  readonly author: string;
  readonly when: number;
  /** The commit's subject, which is usually the answer the player wanted. */
  readonly summary: string;
}

export function blame(repo: Repository, revision: ObjectId, path: string): BlameLine[] {
  // Oldest first: a blame is built forwards even though history reads backwards.
  const history = walk(repo, [revision], { path }).reverse();
  if (history.length === 0) return [];

  /** Each surviving line, with the commit that put it there. */
  let carried: Array<{ text: string; from: ObjectId }> = [];

  for (const { id } of history) {
    const content = repo.fileAt(id, path);
    if (content === undefined) {
      // The path did not exist at this commit -- it was deleted and later
      // restored. Start again from nothing rather than carrying ghosts.
      carried = [];
      continue;
    }

    const before = carried.map((l) => l.text).join('\n');
    const next: Array<{ text: string; from: ObjectId }> = [];
    let at = 0;

    for (const edit of diffLines(carried.length === 0 ? '' : `${before}\n`, content)) {
      if (edit.kind === 'remove') {
        at++;
      } else if (edit.kind === 'add') {
        next.push({ text: edit.text, from: id });
      } else {
        next.push({ text: edit.text, from: carried[at]?.from ?? id });
        at++;
      }
    }
    carried = next;
  }

  return carried.map((line, i) => {
    const commit = repo.readCommit(line.from);
    return {
      line: i + 1,
      text: line.text,
      commit: line.from,
      author: commit.author.name,
      when: commit.author.when,
      summary: commit.message.split('\n')[0] ?? '',
    };
  });
}

/**
 * Blame one line, which is the question a player actually asks.
 *
 * `git blame -L 12,12 sandbox.conf` in one call, and the thing objective three's
 * goal reads.
 */
export function blameLine(
  repo: Repository,
  revision: ObjectId,
  path: string,
  line: number,
): BlameLine | undefined {
  return blame(repo, revision, path).find((b) => b.line === line);
}

/** Every commit that changed a path, oldest first, as a short history. */
export function history(
  repo: Repository,
  revision: ObjectId,
  path: string,
): Array<{ id: ObjectId; author: string; when: number; summary: string }> {
  return walk(repo, [revision], { path })
    .reverse()
    .map(({ id, commit }) => ({
      id,
      author: commit.author.name,
      when: commit.author.when,
      summary: commit.message.split('\n')[0] ?? '',
    }));
}
