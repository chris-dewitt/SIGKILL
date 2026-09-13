import { describe, expect, it } from 'vitest';
import { TerminalBuffer, wrap, type Span } from '../src/buffer.js';

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

/**
 * Art is not prose and must not be treated like it.
 *
 * `wrap` breaks on spaces and trims the trailing ones — which in a drawing are
 * the spaces holding its columns in line. A picture that goes through the
 * prose path comes out as confetti, so art takes a different one.
 */
describe('art does not reflow', () => {
  const ART = [
    '┌────────────┐',
    '│ ▓▓  ▓▓     │',
    '│            │',
    '└────────────┘',
  ];

  it('keeps every row on one row, however narrow the screen', () => {
    const buffer = new TerminalBuffer();
    buffer.writeArt(ART);
    for (const cols of [80, 20, 8]) {
      expect(buffer.layout(cols), `at ${cols} columns`).toHaveLength(ART.length);
    }
  });

  it('clips to the width instead of breaking', () => {
    const buffer = new TerminalBuffer();
    buffer.writeArt(ART);
    const rows = buffer.layout(6);
    expect(rows.map((r) => r.text)).toEqual(['┌─────', '│ ▓▓  ', '│     ', '└─────']);
  });

  it('keeps trailing spaces, because in a drawing they are pixels', () => {
    const buffer = new TerminalBuffer();
    buffer.writeArt(['##   ', '  #  ']);
    expect(buffer.layout(40).map((r) => r.text)).toEqual(['##   ', '  #  ']);
  });

  it('leaves prose reflowing exactly as it did', () => {
    const buffer = new TerminalBuffer();
    buffer.write('the quick brown fox jumps over the lazy dog\n');
    expect(buffer.layout(20).length).toBeGreaterThan(1);
  });

  it('scrambles the same art if it goes through the prose path', () => {
    // The bug this exists to prevent, asserted so nobody "simplifies"
    // writeArt back into write.
    const buffer = new TerminalBuffer();
    for (const row of ART) buffer.push(row);
    const rows = buffer.layout(6);
    expect(rows.length).toBeGreaterThan(ART.length);
  });

  it('marks every art row as a first row, so no continuation marker is drawn', () => {
    const buffer = new TerminalBuffer();
    buffer.writeArt(ART);
    expect(buffer.layout(6).every((r) => r.first)).toBe(true);
  });
});


/**
 * Spans are offsets into the unwrapped line, so every one of them has to be
 * clipped and rebased when the line is laid out. Getting this wrong is
 * invisible in a test that only checks text: the words are right and the
 * colours land on the wrong characters.
 */
describe('colour survives wrapping', () => {
  const line = (text: string, spans: Span[]): TerminalBuffer => {
    const b = new TerminalBuffer();
    b.pushLine({ text, kind: 'out', spans });
    return b;
  };

  it('leaves a span alone when nothing wraps', () => {
    const b = line('hello world', [{ start: 6, end: 11, kind: 'path' }]);
    expect(b.layout(40)[0]?.spans).toEqual([{ start: 6, end: 11, kind: 'path' }]);
  });

  it('rebases a span onto the row it lands on', () => {
    //            0123456789012345678901
    const b = line('aaaa bbbb cccc dddd', [{ start: 15, end: 19, kind: 'path' }]);
    const rows = b.layout(10);
    // The span is on a later row, so its offsets must be row-local.
    const carrying = rows.filter((r) => r.spans !== undefined);
    expect(carrying).toHaveLength(1);
    const span = carrying[0]?.spans?.[0];
    expect(carrying[0]?.text.slice(span?.start, span?.end)).toBe('dddd');
  });

  it('splits a span that straddles a break', () => {
    const b = line('aaaa bbbb cccc', [{ start: 0, end: 14, kind: 'command' }]);
    const rows = b.layout(9);
    expect(rows.length).toBeGreaterThan(1);
    for (const row of rows) {
      const span = row.spans?.[0];
      expect(span, row.text).toBeDefined();
      // Each piece covers exactly its own row, which is what makes a wrapped
      // command still read as one colour.
      expect(span?.start).toBe(0);
      expect(span?.end).toBe(row.text.length);
    }
  });

  it('never lets a span run past its row', () => {
    const b = line('the quick brown fox jumps over the lazy dog', [
      { start: 0, end: 43, kind: 'command' },
    ]);
    for (const row of b.layout(11)) {
      for (const span of row.spans ?? []) {
        expect(span.start).toBeGreaterThanOrEqual(0);
        expect(span.end).toBeLessThanOrEqual(row.text.length);
      }
    }
  });

  it('carries no spans property at all on a row nothing lands on', () => {
    const b = line('aaaa bbbb cccc', [{ start: 0, end: 4, kind: 'path' }]);
    const rows = b.layout(9);
    expect(rows[0]?.spans).toBeDefined();
    expect(rows[1]?.spans).toBeUndefined();
  });

  it('re-wraps correctly at a different width, from the same stored line', () => {
    const b = line('aaaa bbbb cccc dddd', [{ start: 15, end: 19, kind: 'path' }]);
    for (const cols of [40, 14, 9, 5]) {
      const rows = b.layout(cols);
      const found = rows.flatMap((r) => (r.spans ?? []).map((s) => r.text.slice(s.start, s.end)));
      expect(found.join(''), `at ${cols}`).toBe('dddd');
    }
  });

  it('keeps colour on clipped art rather than dropping it', () => {
    const b = new TerminalBuffer();
    b.pushLine({ text: '| C7 open |', kind: 'out', nowrap: true, spans: [{ start: 2, end: 4, kind: 'warn' }] });
    const row = b.layout(6)[0];
    expect(row?.text).toBe('| C7 o');
    expect(row?.spans).toEqual([{ start: 2, end: 4, kind: 'warn' }]);
  });

  it('drops a span that falls entirely outside a clipped art row', () => {
    const b = new TerminalBuffer();
    b.pushLine({ text: '| C7 open |', kind: 'out', nowrap: true, spans: [{ start: 8, end: 10, kind: 'warn' }] });
    expect(b.layout(5)[0]?.spans).toBeUndefined();
  });
});
