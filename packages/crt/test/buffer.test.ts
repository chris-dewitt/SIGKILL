import { describe, expect, it } from 'vitest';
import { TerminalBuffer, wrap } from '../src/buffer.js';

describe('wrap', () => {
  it('leaves a short line alone', () => {
    expect(wrap('hello', 20)).toEqual(['hello']);
  });

  it('breaks on the last space that fits', () => {
    expect(wrap('the scrubber will not start', 12)).toEqual(['the scrubber', 'will not', 'start']);
  });

  it('hard-breaks a token longer than the line', () => {
    // A long path or a base64 blob has no space to break on.
    expect(wrap('/etc/systemd/system/scrubber.service', 12)).toEqual([
      '/etc/systemd',
      '/system/scru',
      'bber.service',
    ]);
  });

  it('does not leave leading spaces on continuation rows', () => {
    expect(wrap('a b c d e f g h', 4)).toEqual(['a b', 'c d', 'e f', 'g h']);
  });

  it('collapses a line of nothing but spaces, and terminates', () => {
    // Continuation rows strip leading spaces, so whitespace has nothing left
    // to wrap and yields one empty row rather than a column of them. The
    // property that matters is that it terminates: a naive loop never
    // shrinks `rest` here and hangs.
    expect(wrap('          ', 3)).toEqual(['']);
  });

  it('keeps interior spacing that fits', () => {
    // Alignment inside a line is content, not padding, and must survive.
    expect(wrap('O2      21', 20)).toEqual(['O2      21']);
  });

  it('handles a width of one', () => {
    expect(wrap('abc', 1)).toEqual(['a', 'b', 'c']);
  });

  it('returns nothing for a nonsensical width', () => {
    expect(wrap('abc', 0)).toEqual([]);
  });
});

describe('TerminalBuffer', () => {
  it('splits a block on newlines and drops the trailing one', () => {
    const b = new TerminalBuffer();
    // `echo hi` produces "hi\n" and must be one line, not a line and a blank.
    b.write('hi\n');
    expect(b.length).toBe(1);

    b.write('a\nb\n');
    expect(b.length).toBe(3);
  });

  it('keeps a genuinely blank line in the middle', () => {
    const b = new TerminalBuffer();
    b.write('a\n\nb\n');
    expect(b.all().map((l) => l.text)).toEqual(['a', '', 'b']);
  });

  it('ignores an empty write', () => {
    const b = new TerminalBuffer();
    b.write('');
    expect(b.length).toBe(0);
  });

  it('reflows when the width changes, because it stores unwrapped lines', () => {
    const b = new TerminalBuffer();
    b.push('the scrubber will not start');

    // Rotating the phone must not corrupt anything — the logical line is
    // the truth and wrapping is recomputed.
    expect(b.layout(40).map((r) => r.text)).toEqual(['the scrubber will not start']);
    expect(b.layout(12).map((r) => r.text)).toEqual(['the scrubber', 'will not', 'start']);
    expect(b.layout(40).map((r) => r.text)).toEqual(['the scrubber will not start']);
  });

  it('marks continuation rows so the renderer can show them', () => {
    const b = new TerminalBuffer();
    b.push('one two three four');
    const rows = b.layout(8);
    expect(rows.map((r) => r.first)).toEqual([true, false, false]);
    expect(rows.every((r) => r.line === 0)).toBe(true);
  });

  it('carries the line kind onto every wrapped row', () => {
    const b = new TerminalBuffer();
    b.push('cat: /etc/shadow: Permission denied', 'err');
    const rows = b.layout(10);
    expect(rows.length).toBeGreaterThan(1);
    expect(rows.every((r) => r.kind === 'err')).toBe(true);
  });

  it('preserves a blank line as one row', () => {
    const b = new TerminalBuffer();
    b.push('');
    expect(b.layout(20)).toEqual([{ text: '', kind: 'out', line: 0, first: true }]);
  });

  it('drops the oldest lines past the scrollback limit', () => {
    const b = new TerminalBuffer({ scrollback: 3 });
    for (const n of [1, 2, 3, 4, 5]) b.push(`line ${n}`);
    expect(b.length).toBe(3);
    expect(b.all().map((l) => l.text)).toEqual(['line 3', 'line 4', 'line 5']);
  });

  it('bumps its revision on every mutation, so frames can be skipped', () => {
    const b = new TerminalBuffer();
    const start = b.revision;
    b.push('a');
    expect(b.revision).toBeGreaterThan(start);

    const afterPush = b.revision;
    b.layout(20);
    // Reading must not count as a change.
    expect(b.revision).toBe(afterPush);

    b.clear();
    expect(b.revision).toBeGreaterThan(afterPush);
  });

  it('reports its height at a width', () => {
    const b = new TerminalBuffer();
    b.push('one two three four');
    b.push('short');
    expect(b.height(8)).toBe(4);
  });
});
