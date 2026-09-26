/**
 * A real line diff, at last.
 *
 * `packages/machine`'s `diff` coreutil compares files position by position and
 * says so in a comment that has been waiting for this package:
 *
 *   > A real edit-distance diff is a genuinely interesting algorithm and belongs
 *   > in the game that teaches it, not smuggled in here.
 *
 * This is that game. The algorithm is Myers, 1986 -- the greedy forward pass with
 * a kept frontier, which is the same family git uses by default. It matters here
 * for one practical reason: a blame is a stack of diffs, and a positional
 * comparison would attribute every line below an insertion to the wrong commit.
 * Getting this right is what makes `blame` mean anything.
 *
 * The paper's linear-space variant was written here first and was wrong in a way
 * that passed every simple case and misplaced a moved block -- exactly the shape
 * of bug this package's external oracle exists to catch. See `trace` below.
 */

export type EditKind = 'keep' | 'add' | 'remove';

export interface Edit {
  readonly kind: EditKind;
  /** The line's text, without its newline. */
  readonly text: string;
  /** 1-based line number in the old file, when it has one. */
  readonly before?: number;
  /** 1-based line number in the new file, when it has one. */
  readonly after?: number;
}

/**
 * Split a file into lines for diffing.
 *
 * A trailing newline is a line terminator rather than an empty final line, which
 * is the convention every diff tool uses and the one that stops a file ending in
 * `\n` from reporting a phantom change against itself.
 */
export function lines(content: string): string[] {
  if (content === '') return [];
  const split = content.split('\n');
  if (split[split.length - 1] === '') split.pop();
  return split;
}

/**
 * Myers' greedy forward pass, keeping the frontier at each step.
 *
 * The first half of the 1986 paper: walk the edit graph one d at a time, always
 * taking the furthest-reaching path on each diagonal, and stop when one reaches
 * the bottom right. `trace[d]` is the frontier after d edits, which is what the
 * backtrack below needs to recover the route.
 *
 * O(ND) time and O(D^2) space, where D is the number of edits -- so it is fast
 * precisely when the files are similar, which is the only case that happens in a
 * repository. The paper's second half trades that space for O(N) with a
 * divide-and-conquer middle snake; it was written here first and was subtly
 * wrong in a way that only showed up as a moved block being misattributed. The
 * simpler one is correct, fast enough for files a person reads, and possible to
 * check line by line against the paper.
 */
function trace(a: readonly string[], b: readonly string[]): Int32Array[] {
  const n = a.length;
  const m = b.length;
  const max = n + m;
  const frontiers: Int32Array[] = [];
  const v = new Int32Array(2 * max + 1);

  for (let d = 0; d <= max; d++) {
    frontiers.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && (v[k - 1 + max] ?? 0) < (v[k + 1 + max] ?? 0))) {
        x = v[k + 1 + max] ?? 0;
      } else {
        x = (v[k - 1 + max] ?? 0) + 1;
      }
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[k + max] = x;
      if (x >= n && y >= m) return frontiers;
    }
  }
  return frontiers;
}

/**
 * Walk the frontiers backwards, emitting the edits in order.
 *
 * Built back to front and reversed at the end, because the only way to know
 * which diagonal a step came from is to start where it finished.
 */
function script(a: readonly string[], b: readonly string[]): Edit[] {
  const n = a.length;
  const m = b.length;
  if (n === 0 && m === 0) return [];
  if (n === 0) return b.map((textLine, i) => ({ kind: 'add' as const, text: textLine, after: i + 1 }));
  if (m === 0) {
    return a.map((textLine, i) => ({ kind: 'remove' as const, text: textLine, before: i + 1 }));
  }

  const frontiers = trace(a, b);
  const max = n + m;
  const out: Edit[] = [];
  let x = n;
  let y = m;

  /*
   * `frontiers[d]` is the state *before* step d, because it is pushed at the top
   * of the loop. So undoing step d reads `frontiers[d]`, not `frontiers[d - 1]`
   * -- which was the off-by-one that made a moved block come out wrong while
   * every simple case still looked right.
   */
  for (let d = frontiers.length - 1; d >= 0; d--) {
    const v = frontiers[d]!;
    const k = x - y;

    let previousK: number;
    if (k === -d || (k !== d && (v[k - 1 + max] ?? 0) < (v[k + 1 + max] ?? 0))) {
      previousK = k + 1;
    } else {
      previousK = k - 1;
    }
    const previousX = v[previousK + max] ?? 0;
    const previousY = previousX - previousK;

    // Diagonal first: everything between here and the previous frontier is a
    // line both files have.
    while (x > previousX && y > previousY) {
      out.push({ kind: 'keep', text: a[x - 1]!, before: x, after: y });
      x--;
      y--;
    }

    if (d > 0) {
      if (x > previousX) out.push({ kind: 'remove', text: a[x - 1]!, before: x });
      else if (y > previousY) out.push({ kind: 'add', text: b[y - 1]!, after: y });
      x = previousX;
      y = previousY;
    }
  }

  return out.reverse();
}

/** Every line of both files, marked kept, added or removed. */
export function diffLines(before: string, after: string): Edit[] {
  return script(lines(before), lines(after));
}

export interface Hunk {
  readonly beforeStart: number;
  readonly beforeCount: number;
  readonly afterStart: number;
  readonly afterCount: number;
  readonly edits: readonly Edit[];
}

/** Group the edits into hunks with `context` unchanged lines around each. */
export function hunks(edits: readonly Edit[], context = 3): Hunk[] {
  const interesting = edits
    .map((edit, i) => ({ edit, i }))
    .filter(({ edit }) => edit.kind !== 'keep')
    .map(({ i }) => i);
  if (interesting.length === 0) return [];

  const ranges: Array<[number, number]> = [];
  for (const at of interesting) {
    const from = Math.max(0, at - context);
    const to = Math.min(edits.length - 1, at + context);
    const last = ranges[ranges.length - 1];
    if (last && from <= last[1] + 1) last[1] = Math.max(last[1], to);
    else ranges.push([from, to]);
  }

  return ranges.map(([from, to]) => {
    const slice = edits.slice(from, to + 1);
    const firstBefore = slice.find((e) => e.before !== undefined)?.before;
    const firstAfter = slice.find((e) => e.after !== undefined)?.after;
    return {
      beforeStart: firstBefore ?? 0,
      beforeCount: slice.filter((e) => e.before !== undefined).length,
      afterStart: firstAfter ?? 0,
      afterCount: slice.filter((e) => e.after !== undefined).length,
      edits: slice,
    };
  });
}

/**
 * Unified diff, the format every code review in the world is written in.
 *
 * Deliberately the real header shape -- `@@ -a,b +c,d @@` -- because a player who
 * learns to read one of these here can read one anywhere, and a made-up format
 * would be teaching a dialect that exists only in this game.
 */
export function unified(
  before: string,
  after: string,
  opts: { beforeName?: string; afterName?: string; context?: number } = {},
): string[] {
  const edits = diffLines(before, after);
  const groups = hunks(edits, opts.context ?? 3);
  if (groups.length === 0) return [];

  const out = [`--- a/${opts.beforeName ?? 'file'}`, `+++ b/${opts.afterName ?? 'file'}`];
  for (const hunk of groups) {
    out.push(
      `@@ -${hunk.beforeStart},${hunk.beforeCount} +${hunk.afterStart},${hunk.afterCount} @@`,
    );
    for (const edit of hunk.edits) {
      out.push(`${edit.kind === 'keep' ? ' ' : edit.kind === 'add' ? '+' : '-'}${edit.text}`);
    }
  }
  return out;
}

/** How many lines differ. Cheap enough to call on every commit in a bisect. */
export function changedLines(before: string, after: string): number {
  return diffLines(before, after).filter((e) => e.kind !== 'keep').length;
}
