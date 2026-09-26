import { describe, expect, it } from 'vitest';
import { changedLines, diffLines, lines, unified } from '../src/diff.js';

/**
 * The diff, against real git's diff.
 *
 * The edit *scripts* below were produced by `git diff --no-index` on git 2.50,
 * which is the second external oracle in this package and is used for the same
 * reason as the first: an algorithm checked only against its own output is a
 * mirror. Myers has a lot of places to be subtly wrong and every one of them
 * shows up later as `blame` attributing a line to the wrong person.
 */

const show = (before: string, after: string): string[] =>
  diffLines(before, after).map(
    (e) => `${e.kind === 'keep' ? ' ' : e.kind === 'add' ? '+' : '-'}${e.text}`,
  );

describe('splitting a file into lines', () => {
  it('treats a trailing newline as a terminator, not an empty line', () => {
    expect(lines('a\nb\n')).toEqual(['a', 'b']);
    expect(lines('a\nb')).toEqual(['a', 'b']);
    expect(lines('')).toEqual([]);
    expect(lines('\n')).toEqual(['']);
  });

  it('does not report a file as changed against itself', () => {
    const body = 'SANDBOX=strict\nREADS=own\n';
    expect(diffLines(body, body).every((e) => e.kind === 'keep')).toBe(true);
    expect(unified(body, body)).toEqual([]);
  });
});

describe('the edit script', () => {
  /*
   *   git diff --no-index -U1 before.txt after.txt
   *     a / -b / +B / c ... e / +f
   */
  it('finds a changed line and an appended one', () => {
    expect(show('a\nb\nc\nd\ne\n', 'a\nB\nc\nd\ne\nf\n')).toEqual([
      ' a',
      '-b',
      '+B',
      ' c',
      ' d',
      ' e',
      '+f',
    ]);
  });

  it('finds a deletion with nothing added', () => {
    expect(show('keep\ngone\nkeep2\n', 'keep\nkeep2\n')).toEqual([' keep', '-gone', ' keep2']);
  });

  it('finds an insertion with nothing removed', () => {
    expect(show('keep\nkeep2\n', 'keep\nnew\nkeep2\n')).toEqual([' keep', '+new', ' keep2']);
  });

  /*
   * A moved block, which is where a positional comparison falls apart.
   *
   * Real git reports this as a deletion of one/two at the top and an insertion of
   * them after four. It does not pretend the lines moved -- and neither does
   * this, because a diff that invented a "moved" concept would produce a blame
   * nobody could check against real git.
   */
  it('handles a moved block the way git does', () => {
    expect(show('one\ntwo\nthree\nfour\nfive\n', 'three\nfour\none\ntwo\nfive\n')).toEqual([
      '-one',
      '-two',
      ' three',
      ' four',
      '+one',
      '+two',
      ' five',
    ]);
  });

  it('handles an empty side in both directions', () => {
    expect(show('', 'a\nb\n')).toEqual(['+a', '+b']);
    expect(show('a\nb\n', '')).toEqual(['-a', '-b']);
    expect(show('', '')).toEqual([]);
  });

  it('keeps line numbers that point at the right lines', () => {
    const edits = diffLines('a\nb\nc\n', 'a\nB\nc\n');
    expect(edits.map((e) => [e.kind, e.before, e.after])).toEqual([
      ['keep', 1, 1],
      ['remove', 2, undefined],
      ['add', undefined, 2],
      ['keep', 3, 3],
    ]);
  });

  it('is not fooled by a repeated line', () => {
    // The classic trap: the common subsequence is ambiguous, and any answer is
    // correct as long as the result reconstructs the new file exactly.
    const before = 'x\nx\nx\n';
    const after = 'x\nx\n';
    const edits = diffLines(before, after);
    const rebuilt = edits.filter((e) => e.kind !== 'remove').map((e) => e.text);
    expect(rebuilt).toEqual(['x', 'x']);
  });
});

describe('reconstruction, which is the property that matters', () => {
  /*
   * Whatever route the algorithm takes, applying the script has to produce the
   * new file and reversing it has to produce the old one. Everything `blame` and
   * `bisect` do rests on that and on nothing else about the route.
   */
  const cases: Array<[string, string]> = [
    ['a\nb\nc\n', 'a\nB\nc\n'],
    ['', 'one\n'],
    ['one\n', ''],
    ['one\ntwo\nthree\n', 'three\ntwo\none\n'],
    ['SANDBOX=strict\nREADS=own\n', 'SANDBOX=wide\nREADS=own\nNOTE=temporary\n'],
    ['a\n'.repeat(40), `${'a\n'.repeat(20)}b\n${'a\n'.repeat(19)}`],
    ['same\n', 'same\n'],
  ];

  for (const [before, after] of cases) {
    it(`rebuilds both sides of ${JSON.stringify(before.slice(0, 18))}`, () => {
      const edits = diffLines(before, after);
      expect(edits.filter((e) => e.kind !== 'remove').map((e) => e.text)).toEqual(lines(after));
      expect(edits.filter((e) => e.kind !== 'add').map((e) => e.text)).toEqual(lines(before));
    });
  }
});

describe('unified output', () => {
  it('uses the real header shape, so it reads anywhere', () => {
    const out = unified('a\nb\nc\nd\ne\n', 'a\nB\nc\nd\ne\n', {
      beforeName: 'sandbox.conf',
      afterName: 'sandbox.conf',
      context: 1,
    });
    expect(out[0]).toBe('--- a/sandbox.conf');
    expect(out[1]).toBe('+++ b/sandbox.conf');
    expect(out[2]).toMatch(/^@@ -\d+,\d+ \+\d+,\d+ @@$/);
    expect(out).toContain('-b');
    expect(out).toContain('+B');
  });

  it('splits distant changes into separate hunks', () => {
    const before = `${'x\n'.repeat(20)}`;
    const after = `a${'\nx'.repeat(19)}\nz\n`;
    const out = unified(before, after, { context: 1 });
    expect(out.filter((l) => l.startsWith('@@')).length).toBeGreaterThanOrEqual(2);
  });

  it('joins changes that are close enough to share context', () => {
    const out = unified('a\nb\nc\n', 'A\nb\nC\n', { context: 3 });
    expect(out.filter((l) => l.startsWith('@@'))).toHaveLength(1);
  });
});

describe('counting, for a bisect that has to be quick', () => {
  it('counts only the lines that moved', () => {
    expect(changedLines('a\nb\n', 'a\nb\n')).toBe(0);
    expect(changedLines('a\nb\n', 'a\nB\n')).toBe(2);
    expect(changedLines('', 'a\nb\nc\n')).toBe(3);
  });

  it('stays quick on a file the size of one a player would actually read', () => {
    const before = Array.from({ length: 800 }, (_, i) => `line ${i}`).join('\n');
    const after = before.replace('line 400', 'line 400, edited');
    const started = Date.now();
    expect(changedLines(before, after)).toBe(2);
    // Generous, because a slow machine is not a bug. A diff that took seconds
    // would make `blame` unusable on a phone, which is the real constraint.
    expect(Date.now() - started).toBeLessThan(2000);
  });
});
