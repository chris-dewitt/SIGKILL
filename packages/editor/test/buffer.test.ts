import { describe, expect, it } from 'vitest';
import { TextBuffer } from '../src/buffer.js';

describe('the text buffer', () => {
  it('never has zero lines, because the cursor needs somewhere to be', () => {
    expect(new TextBuffer('').count).toBe(1);
    expect(new TextBuffer('').all()).toEqual(['']);
  });

  it('does not turn a file trailing newline into a phantom last line', () => {
    const b = new TextBuffer('a\nb\n');
    expect(b.count).toBe(2);
    expect(b.toText()).toBe('a\nb\n');
  });

  it('always writes back newline-terminated, like every Unix tool', () => {
    expect(new TextBuffer('no newline').toText()).toBe('no newline\n');
  });

  it('writes an emptied file as genuinely empty, not as one blank line', () => {
    const b = new TextBuffer('gone\n');
    b.deleteLines(1);
    expect(b.toText()).toBe('');
  });

  it('inserts across a newline by splitting the line', () => {
    const b = new TextBuffer('ac');
    b.moveTo(0, 1);
    b.insert('b\nX');
    expect(b.all()).toEqual(['ab', 'Xc']);
  });

  it('joins onto the previous line when backspacing at column zero', () => {
    const b = new TextBuffer('one\ntwo');
    b.moveTo(1, 0);
    expect(b.deleteBack()).toBe(true);
    expect(b.all()).toEqual(['onetwo']);
    expect(b.cursor).toEqual({ line: 0, col: 3 });
  });

  it('refuses to backspace off the front of the file', () => {
    const b = new TextBuffer('x');
    b.moveTo(0, 0);
    expect(b.deleteBack()).toBe(false);
  });

  // The behaviour every editor has and nobody notices until it is missing.
  it('remembers the column it was aiming for across a short line', () => {
    const b = new TextBuffer('aaaaaaaaaa\nbb\ncccccccccc');
    b.moveTo(0, 9);
    b.moveLine(1);
    expect(b.cursor.col).toBe(1);
    b.moveLine(1);
    expect(b.cursor.col).toBe(9);
  });

  it('keeps $ stuck to the end through vertical movement', () => {
    const b = new TextBuffer('abc\nabcdefgh');
    b.lineEnd();
    b.moveLine(1);
    expect(b.cursor.col).toBe(7);
  });

  it('separates normal-mode clamping from insert-mode clamping', () => {
    const b = new TextBuffer('abc');
    b.moveTo(0, 99);
    expect(b.cursor.col).toBe(2);
    b.moveTo(0, 99, true);
    expect(b.cursor.col).toBe(3);
  });

  it('walks words forward and back, across lines', () => {
    const b = new TextBuffer('one two three\nfour');
    b.moveTo(0, 0);
    b.wordForward();
    expect(b.cursor).toEqual({ line: 0, col: 4 });
    b.wordForward();
    expect(b.cursor).toEqual({ line: 0, col: 8 });
    b.wordForward();
    expect(b.cursor.line).toBe(1);
    b.wordBack();
    expect(b.cursor).toEqual({ line: 0, col: 8 });
  });

  it('deletes a word with its trailing space', () => {
    const b = new TextBuffer('alpha beta');
    b.moveTo(0, 0);
    expect(b.deleteWord()).toBe('alpha ');
    expect(b.line(0)).toBe('beta');
  });

  it('joins lines with a single space at the seam', () => {
    const b = new TextBuffer('one\n   two');
    b.joinLine();
    expect(b.line(0)).toBe('one two');
  });

  it('substitutes over a range and reports how many lines changed', () => {
    const b = new TextBuffer('a1\na2\nb3\n');
    expect(b.substitute(/a/, 'X', 0, 2)).toBe(2);
    expect(b.all()).toEqual(['X1', 'X2', 'b3']);
  });

  it('leaves the file alone when a substitution matches nothing', () => {
    const b = new TextBuffer('abc\n');
    expect(b.substitute(/zzz/, 'x')).toBe(0);
    expect(b.dirty).toBe(false);
  });

  it('searches forward and wraps exactly once', () => {
    const b = new TextBuffer('alpha\nbeta\ngamma');
    b.moveTo(2, 0);
    expect(b.search(/beta/)).toBe(true);
    expect(b.cursor.line).toBe(1);
    expect(b.search(/nowhere/)).toBe(false);
  });
});

describe('undo', () => {
  it('takes back an edit, and redo puts it back', () => {
    const b = new TextBuffer('original\n');
    b.moveTo(0, 0);
    b.insert('X');
    expect(b.line(0)).toBe('Xoriginal');

    expect(b.undo()).toBe(true);
    expect(b.line(0)).toBe('original');
    expect(b.redo()).toBe(true);
    expect(b.line(0)).toBe('Xoriginal');
  });

  it('reports honestly when there is nothing left to undo', () => {
    const b = new TextBuffer('x');
    expect(b.undo()).toBe(false);
  });

  it('drops the redo stack once a new edit lands, like a real editor', () => {
    const b = new TextBuffer('a\n');
    b.insert('1');
    b.undo();
    b.insert('2');
    expect(b.redo()).toBe(false);
  });

  it('restores the cursor along with the text', () => {
    const b = new TextBuffer('one\ntwo\nthree\n');
    b.moveTo(2, 1);
    b.deleteLines(1);
    b.undo();
    expect(b.cursor).toEqual({ line: 2, col: 1 });
  });

  it('undoes a whole insert session as one step', () => {
    const b = new TextBuffer('seed\n');
    b.lineEnd(true);
    b.insert('');
    for (const ch of ' and more') b.insertContinuing(ch);
    expect(b.line(0)).toBe('seed and more');
    b.undo();
    expect(b.line(0)).toBe('seed');
  });
});
