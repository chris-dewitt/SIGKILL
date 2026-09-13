import { describe, expect, it } from 'vitest';
import { highlight } from '../src/highlight.js';
import type { LineKind, Span } from '../src/buffer.js';

const COMMANDS = new Set([
  'ls', 'cat', 'cd', 'grep', 'systemctl', 'chmod', 'sed', 'vi', 'man', 'deck',
  'sudo', 'hint', 'objectives', 'echo', 'tail',
]);

/** The kind covering a character, after later spans win. Null if uncoloured. */
function at(text: string, index: number): LineKind | null {
  let kind: LineKind | null = null;
  for (const span of highlight(text, { commands: COMMANDS })) {
    if (index >= span.start && index < span.end) kind = span.kind;
  }
  return kind;
}

/** The contiguous runs a kind covers, joined, for readable assertions. */
function covered(text: string, kind: LineKind): string {
  const parts: string[] = [];
  let run = '';
  for (let i = 0; i < text.length; i++) {
    if (at(text, i) === kind) run += text[i];
    else if (run.length > 0) { parts.push(run); run = ''; }
  }
  if (run.length > 0) parts.push(run);
  return parts.join(' ').trim();
}

const kinds = (text: string): Set<LineKind> =>
  new Set(highlight(text, { commands: COMMANDS }).map((s: Span) => s.kind));

describe('the speaker prefix', () => {
  it('colours ORACLE: and nothing after it', () => {
    const line = 'ORACLE: You are awake.';
    expect(covered(line, 'speaker')).toBe('ORACLE:');
    expect(at(line, 8)).not.toBe('speaker');
  });

  it('works when the line is indented', () => {
    expect(covered('  ORACLE: hello there', 'speaker')).toBe('ORACLE:');
  });

  it('leaves an ordinary capitalised word alone', () => {
    expect(kinds('Vasquez left you a note.')).not.toContain('speaker');
  });

  it('does not fire on a lower-case word with a colon', () => {
    expect(kinds('day 9: dropped the target')).not.toContain('speaker');
  });

  it('does not fire mid-sentence', () => {
    expect(kinds('the unit is called SCRUBBER: it refuses')).not.toContain('speaker');
  });
});

describe('indented commands', () => {
  it('colours a whole indented command line', () => {
    expect(covered('    systemctl status scrubber', 'command')).toBe('systemctl status scrubber');
  });

  it('sees through sudo to the real command', () => {
    expect(covered('    sudo systemctl start scrubber', 'command'))
      .toBe('sudo systemctl start scrubber');
  });

  it('leaves an indented line that is not a command alone', () => {
    // Prose is indented all over the notes aboard. Colouring it cyan would
    // promise the player they can type an English sentence.
    expect(kinds('    I set the target low to stretch the reserve.')).not.toContain('command');
  });

  it('leaves a command the ship does not have alone', () => {
    expect(kinds('    kubectl get pods')).not.toContain('command');
  });

  it('does not colour an unindented command, which is usually prose', () => {
    expect(kinds('systemctl is how you start things')).not.toContain('command');
  });

  it('needs two spaces, not one', () => {
    expect(kinds(' ls')).not.toContain('command');
  });

  it('colours a command with flags as one unit', () => {
    expect(covered('    grep -c PRESSURE_DROP /var/log/hull.log', 'command'))
      .toContain('grep -c');
  });
});

describe('paths', () => {
  it('colours an absolute path', () => {
    expect(covered('open /etc/life_support.conf now', 'path')).toBe('/etc/life_support.conf');
  });

  it('colours a directory with a trailing slash', () => {
    expect(covered('look in /etc/hull/ for it', 'path')).toBe('/etc/hull/');
  });

  it('colours a glob', () => {
    expect(covered('read /etc/hull/*.conf', 'path')).toBe('/etc/hull/*.conf');
  });

  it('does not colour a bare slash', () => {
    expect(kinds('either / or')).not.toContain('path');
  });

  it('does not colour the slash inside a fraction', () => {
    expect(kinds('9/10 of the crew')).not.toContain('path');
  });

  it('gives a trailing full stop back to the sentence', () => {
    expect(covered('it is in /etc/life_support.conf.', 'path')).toBe('/etc/life_support.conf');
  });

  it('gives back an ellipsis too', () => {
    expect(covered('somewhere under /etc/hull...', 'path')).toBe('/etc/hull');
  });

  it('keeps a dot that is part of the filename', () => {
    expect(covered('read /var/log/hull.log now', 'path')).toBe('/var/log/hull.log');
  });

  it('finds more than one path in a line', () => {
    const line = 'copy /etc/motd to /tmp/motd';
    expect(covered(line, 'path')).toContain('/etc/motd');
    expect(covered(line, 'path')).toContain('/tmp/motd');
  });
});

describe('settings and values', () => {
  it('leaves the name quiet and lets the value carry', () => {
    const line = 'O2_TARGET=16';
    expect(at(line, 0)).toBe('muted');
    expect(at(line, line.length - 1)).toBe('value');
  });

  it('colours a reading with its unit', () => {
    expect(covered('C7 96.1kPa PRESSURE_DROP', 'value')).toContain('96.1kPa');
  });

  it('colours a percentage', () => {
    expect(covered('hull integrity 61%', 'value')).toBe('61%');
  });

  it('does not colour a number that is part of a word', () => {
    expect(kinds('nav7')).not.toContain('value');
  });

  it('keeps a path one colour, numbers inside it included', () => {
    // The path rule runs after the value rule and wins where they overlap.
    expect(at('/etc/hull/c7.conf', 11)).toBe('path');
  });
});

describe('what it must never do', () => {
  it('returns no spans for ordinary prose', () => {
    expect(highlight('It did not break. It refused.', { commands: COMMANDS })).toEqual([]);
  });

  it('returns no spans for an empty line', () => {
    expect(highlight('', { commands: COMMANDS })).toEqual([]);
  });

  it('never runs a span past the end of the text', () => {
    const lines = [
      'ORACLE: try /etc/hull/c7.conf',
      '    sudo systemctl start scrubber',
      'O2_TARGET=16 outside 19-23',
      '/var/log/hull.log',
      '',
      '   ',
    ];
    for (const line of lines) {
      for (const span of highlight(line, { commands: COMMANDS })) {
        expect(span.start, line).toBeGreaterThanOrEqual(0);
        expect(span.end, line).toBeLessThanOrEqual(line.length);
        expect(span.end, line).toBeGreaterThan(span.start);
      }
    }
  });

  it('colours nothing as a command when no command list is given', () => {
    // Better grey than a promise the ship cannot keep.
    expect(new Set(highlight('    systemctl status scrubber').map((s) => s.kind)))
      .not.toContain('command');
  });

  it('is stable: the same line twice gives the same spans', () => {
    const line = 'ORACLE: open /etc/life_support.conf and set O2_TARGET=21';
    expect(highlight(line, { commands: COMMANDS })).toEqual(highlight(line, { commands: COMMANDS }));
  });
});

describe('a real line from the game', () => {
  it('colours the speaker and the path in one sentence', () => {
    const line = 'ORACLE: The number is O2_TARGET, in /etc/life_support.conf.';
    const found = kinds(line);
    expect(found).toContain('speaker');
    expect(found).toContain('path');
    expect(covered(line, 'path')).toBe('/etc/life_support.conf');
  });
});
