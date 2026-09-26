import { describe, expect, it } from 'vitest';
import { Pager } from '../src/pager.js';
import { send } from './keys.js';

const OPTS = { rows: 6, cols: 40, path: '/var/log/hull.log' };

/** A file with numbered lines, so a frame says where it is. */
function numbered(count: number): string {
  return Array.from({ length: count }, (_, i) => `line ${i + 1}`).join('\n') + '\n';
}

/** The text of the body rows, status line excluded. */
function body(p: Pager): string[] {
  return p.frame().slice(0, -1).map((l) => l.text);
}

function status(p: Pager): string {
  return p.frame().at(-1)!.text;
}

describe('less', () => {
  it('shows a page, and the status says where you are', () => {
    const p = new Pager(numbered(100), OPTS);
    // Six rows, one of which is the status line.
    expect(body(p)).toEqual(['line 1', 'line 2', 'line 3', 'line 4', 'line 5']);
    expect(status(p)).toContain('1-5/100');
    // The way out survives truncation at every width the game runs at.
    for (const cols of [80, 40, 34, 24]) {
      const narrow = new Pager(numbered(100), { ...OPTS, cols });
      expect(narrow.frame().at(-1)!.text, `at ${cols} columns`).toContain('q');
      expect(narrow.frame().at(-1)!.text.length, `at ${cols} columns`).toBeLessThanOrEqual(cols);
    }
  });

  it('pages forward and back, and stops at both ends', () => {
    const p = new Pager(numbered(100), OPTS);
    send(p, ' ');
    expect(body(p)[0]).toBe('line 6');
    send(p, 'b');
    expect(body(p)[0]).toBe('line 1');

    // Back from the top goes nowhere rather than negative.
    send(p, 'b');
    expect(body(p)[0]).toBe('line 1');

    send(p, 'G');
    expect(body(p).at(-1)).toBe('line 100');
    expect(status(p)).toContain('(END)');
    // And forward from the end stays put: no blank screen past the file.
    send(p, ' ');
    expect(body(p).at(-1)).toBe('line 100');
  });

  it('moves a line at a time with j and k', () => {
    const p = new Pager(numbered(100), OPTS);
    send(p, 'jjj');
    expect(body(p)[0]).toBe('line 4');
    send(p, 'k');
    expect(body(p)[0]).toBe('line 3');
  });

  it('quits on q, and never asks to write anything', () => {
    const p = new Pager(numbered(10), OPTS);
    expect(p.exit).toBeNull();
    send(p, 'q');
    expect(p.exit).toEqual({ write: false, text: '' });
  });

  /*
   * The whole reason a pager is in this game. `/var/log/hull.log` is 540
   * lines and the act's lesson is that you search a log rather than read it --
   * so the pager has to be able to search, and has to be visibly worse at it
   * than `grep`, which finds every line at once.
   */
  it('searches forward, repeats with n, and says when there is nothing', () => {
    const p = new Pager(numbered(100), OPTS);
    send(p, '/line 42<Enter>');
    expect(body(p)[0]).toBe('line 42');

    send(p, '/line 4<Enter>');
    expect(body(p)[0]).toBe('line 43');
    send(p, 'n');
    expect(body(p)[0]).toBe('line 44');

    send(p, '/nothing here<Enter>');
    expect(status(p)).toContain('Pattern not found');
  });

  it('shows the pattern as it is typed, and Escape abandons it', () => {
    const p = new Pager(numbered(100), OPTS);
    send(p, '/lin');
    expect(status(p)).toBe('/lin');
    send(p, '<Backspace>');
    expect(status(p)).toBe('/li');
    send(p, '<Escape>');
    expect(status(p)).toContain('1-5/100');
    // Abandoned, so it never moved.
    expect(body(p)[0]).toBe('line 1');
  });

  it('folds case for a lower-case pattern and respects a capital', () => {
    // Padded so the file is actually scrollable. A file that fits on one
    // screen cannot move -- correct behaviour, and a poor fixture.
    const pad = numbered(40);
    const p = new Pager(`${pad}BETA\n${pad}`, OPTS);
    send(p, '/beta<Enter>');
    expect(body(p)[0]).toBe('BETA');

    const strict = new Pager(`${pad}BETA\nBeta\n${pad}`, OPTS);
    send(strict, '/Beta<Enter>');
    expect(body(strict)[0]).toBe('Beta');
  });

  it('pads a short file with ~ and reads as ended immediately', () => {
    const p = new Pager('one\ntwo\n', OPTS);
    expect(body(p)).toEqual(['one', 'two', '~', '~', '~']);
    expect(status(p)).toContain('(END)');
  });

  it('truncates to the column count rather than wrapping', () => {
    const p = new Pager('x'.repeat(200) + '\n', { ...OPTS, cols: 20 });
    expect(body(p)[0]).toHaveLength(20);
  });

  it('survives a resize, including one that would scroll past the end', () => {
    const p = new Pager(numbered(20), OPTS);
    send(p, 'G');
    p.resize(40, 40);
    // A taller screen shows the whole file, so the top clamps back to zero.
    expect(body(p)[0]).toBe('line 1');
  });

  it('offers a way out on the chip bar, always', () => {
    const p = new Pager(numbered(10), OPTS);
    expect(p.chips).toContain('q');
    send(p, '/');
    // Mid-search the chips change, and both of them leave the prompt.
    expect(p.chips).toEqual(['Enter', 'ESC']);
  });

  it('handles an empty file without dividing by zero', () => {
    const p = new Pager('', OPTS);
    expect(() => p.frame()).not.toThrow();
    expect(status(p)).toContain('(END)');
  });
});
