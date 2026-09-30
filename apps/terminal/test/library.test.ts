import { describe, expect, it } from 'vitest';
import { chooserLines, chosen, entry, offered, LIBRARY } from '../src/library.js';

/**
 * The chooser, tested as text.
 *
 * It is the first thing a new player reads and it is three functions of pure
 * data, so what it says in each state is a unit test rather than something you
 * have to open a browser to find out. That is the same argument `statusRows`
 * makes, and the reason the chooser was written as lines instead of a screen.
 */

const ids = LIBRARY.map((row) => row.adventure.id);
const none = new Set<string>();
const both = { python: {} as never, sql: {} as never };

describe('the library', () => {
  it('holds the four games that exist, in series order', () => {
    expect(ids).toEqual(['wreck', 'archive', 'harness', 'fork']);
    expect(LIBRARY.map((row) => row.adventure.number)).toEqual([1, 2, 3, 4]);
  });

  it('gives every adventure an id that a save key can be built from', () => {
    for (const { adventure } of LIBRARY) {
      expect(adventure.id, adventure.title).toMatch(/^[a-z][a-z0-9-]*$/);
    }
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('says what each one teaches and what it is about', () => {
    for (const { adventure } of LIBRARY) {
      expect(adventure.teaches.length, adventure.id).toBeGreaterThan(4);
      expect(adventure.blurb.length, adventure.id).toBeGreaterThanOrEqual(2);
      // The chooser is the first thing a new player reads. A list of games that
      // gives away their endings is a list nobody wants.
      const blurb = adventure.blurb.join(' ');
      expect(blurb, adventure.id).not.toMatch(/v43|dies|dead crew/i);
    }
  });

  it('finds an entry by id, and nothing by a name that is not one', () => {
    expect(entry('harness')?.adventure.title).toBe('The Harness');
    expect(entry('cluster')).toBeUndefined();
  });
});

describe('what this host can offer', () => {
  it('offers all four when both interpreters are present', () => {
    expect(offered(both).map((row) => row.adventure.id)).toEqual([
      'wreck',
      'archive',
      'harness',
      'fork',
    ]);
  });

  /*
   * A build with no SQLite offers two games rather than crashing on the third.
   * The filter is `playable` from the contract, not a second copy of the rule
   * here -- two copies would disagree the first time a game gained a
   * requirement, and they would disagree at boot, on somebody's phone.
   */
  it('leaves out an adventure whose engine is missing', () => {
    expect(offered({ python: {} as never }).map((r) => r.adventure.id)).toEqual([
      'wreck',
      'harness',
      'fork',
    ]);
    expect(offered({ sql: {} as never }).map((r) => r.adventure.id)).toEqual(['wreck', 'archive']);
    expect(offered({}).map((r) => r.adventure.id)).toEqual(['wreck']);
  });
});

describe('what the chooser says', () => {
  it('numbers them and tells the player what to type', () => {
    const lines = chooserLines(offered(both), none);
    expect(lines.join('\n')).toContain('1. The Wreck');
    expect(lines.join('\n')).toContain('2. The Archive');
    expect(lines.join('\n')).toContain('3. The Harness');
    expect(lines.join('\n')).toContain('4. The Fork');
    expect(lines.at(-2)).toBe('  Type 1-4 to begin.');
  });

  it('marks the runs already in progress, which is the useful part', () => {
    const lines = chooserLines(offered(both), new Set(['archive'])).join('\n');
    expect(lines).toContain('2. The Archive [in progress]');
    expect(lines).not.toContain('1. The Wreck [in progress]');
  });

  it('does not say 1-1 when only one game can run', () => {
    expect(chooserLines(offered({}), none).at(-2)).toBe('  Type 1 to begin.');
  });

  it('fits a narrow phone', () => {
    for (const line of chooserLines(offered(both), none, 34)) {
      expect(line.length, line).toBeLessThanOrEqual(34);
    }
  });
});

describe('reading the answer', () => {
  const list = offered(both);

  it('takes a number', () => {
    expect(chosen(list, '1')?.adventure.id).toBe('wreck');
    expect(chosen(list, ' 3 ')?.adventure.id).toBe('harness');
  });

  /*
   * And a name, because a player who has been told about `games` will type
   * `harness` before they count, and refusing that would be the interface being
   * clever at somebody's expense.
   */
  it('takes a name, with or without the article, in any case', () => {
    expect(chosen(list, 'harness')?.adventure.id).toBe('harness');
    expect(chosen(list, 'The Archive')?.adventure.id).toBe('archive');
    expect(chosen(list, 'wreck')?.adventure.id).toBe('wreck');
    expect(chosen(list, 'THE WRECK')?.adventure.id).toBe('wreck');
  });

  it('refuses everything else rather than guessing', () => {
    for (const answer of ['', '0', '5', '-1', '2x', 'cluster', 'yes']) {
      expect(chosen(list, answer), answer).toBeUndefined();
    }
  });

  it('will not offer a game this host cannot run', () => {
    // Typing `archive` on a build with no SQLite has to fail, not boot a
    // database-less version of it.
    expect(chosen(offered({ python: {} as never }), 'archive')).toBeUndefined();
  });
});
