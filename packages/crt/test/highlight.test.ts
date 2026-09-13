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
    expect(highlight('I have had a long time to think of something better.', { commands: COMMANDS }))
      .toEqual([]);
  });

  it('leaves words that are both prose and machine vocabulary alone', () => {
    // "It refused" is ORACLE telling a story. Painting it red because a log
    // also uses the word is noise, and the story is most of what gets read.
    for (const line of ['It did not break. It refused.', 'it is refusing to run']) {
      expect(highlight(line, { commands: COMMANDS }), line).toEqual([]);
    }
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


describe('flags', () => {
  it('colours a short flag', () => {
    expect(covered('grep -c PRESSURE_DROP file', 'flag')).toBe('-c');
  });

  it('colours a long flag', () => {
    expect(covered('systemctl --failed', 'flag')).toBe('--failed');
  });

  it('colours a cluster', () => {
    expect(covered('rm -rf /tmp/x', 'flag')).toBe('-rf');
  });

  it('does not colour a negative number', () => {
    expect(kinds('the delta was -5 kPa')).not.toContain('flag');
  });

  it('does not colour a dash between words', () => {
    expect(kinds('a well-known problem')).not.toContain('flag');
  });
});

describe('state words', () => {
  it('paints failure red', () => {
    expect(covered('[0000.884] scrubber: FAIL - refusing to run', 'err')).toBe('FAIL');
  });

  it('paints health green', () => {
    expect(covered('reactor.service   active    enabled', 'good')).toContain('active');
  });

  it('paints a warning amber', () => {
    expect(covered('C7 96.1kPa PRESSURE_DROP', 'warn')).toBe('PRESSURE_DROP');
  });

  it('does not match inside a longer word', () => {
    expect(kinds('the inactivity timer')).not.toContain('good');
  });
});

describe('quoted strings and screamed tokens', () => {
  it('colours a quoted string', () => {
    expect(covered("sed -i 's/no/yes/' file", 'value')).toBe("'s/no/yes/'");
  });

  it('keeps two quoted strings apart', () => {
    const line = `echo "one" and "two"`;
    expect(covered(line, 'value')).toBe('"one" "two"');
  });

  it('colours a SCREAMING_SNAKE token', () => {
    expect(covered('grep PRESSURE_DROP /var/log/hull.log', 'warn')).toBe('PRESSURE_DROP');
  });

  it('does not scream at a single capitalised word', () => {
    expect(kinds('ORACLE is talking')).not.toContain('warn');
  });
});

describe('chrome', () => {
  it('colours a box frame', () => {
    expect(covered('┌───┐', 'heading')).toBe('┌───┐');
  });

  it('leaves block elements alone, because those are the data', () => {
    // Frames are chrome; fills and sparklines are content and keep the line's
    // own colour.
    expect(kinds('C7 ▅▅▄▄▃ 96.1')).not.toContain('heading');
  });

  it('colours a section rule', () => {
    expect(covered('-- OBJECTIVES ------------ 2 of 4 done', 'heading'))
      .toContain('-- OBJECTIVES');
  });
});

describe('the objectives marks', () => {
  it('paints a done mark green', () => {
    expect(covered('  [x] Get the atmosphere scrubber running', 'good')).toBe('[x]');
  });

  it('paints an open mark as something you can act on', () => {
    expect(covered('> [ ] Get the hull monitor running', 'command')).toBe('[ ]');
  });

  it('paints a locked mark quiet', () => {
    expect(covered('  [-] Find the leak and close it', 'muted')).toBe('[-]');
  });

  it('makes the you-are-here arrow the brightest mark in the list', () => {
    expect(covered('> [ ] Get the hull monitor running', 'warn')).toBe('>');
  });

  it('does not fire on a bracket mid-sentence', () => {
    expect(kinds('an array [x] is not a checkbox')).not.toContain('good');
  });
});

/**
 * Both found by screenshotting the real renderer on a phone, not by a test.
 * The rule was painting whole English sentences cyan — which promises the
 * player they can type them.
 */
describe('what counts as a command line', () => {
  it('stops at the description in a two-column table', () => {
    expect(covered('    deck        the nine compartments, as they are', 'command')).toBe('deck');
  });

  it('refuses a sentence that merely starts with a command name', () => {
    // `find` is a real command aboard, and this is a step label.
    expect(kinds('      find which compartment is losing air, and seal it'))
      .not.toContain('command');
  });

  it('refuses a sentence ending in a full stop', () => {
    expect(kinds('    cat the note before you do anything else.')).not.toContain('command');
  });

  it('still takes a real command with flags and a path', () => {
    expect(covered('    grep -c PRESSURE_DROP /var/log/hull.log', 'command'))
      .toBe('grep -c PRESSURE_DROP /var/log/hull.log');
  });

  it('colours a command inside a hint, past the speaker prefix', () => {
    // Every hint is emitted as `ORACLE: <line>`, so without this the bottom
    // rung of a ladder was the one place a command never stood out.
    expect(covered('ORACLE:     sudo systemctl start scrubber', 'command'))
      .toBe('sudo systemctl start scrubber');
  });

  it('still marks the speaker on that same line', () => {
    expect(covered('ORACLE:     sudo systemctl start scrubber', 'speaker')).toBe('ORACLE:');
  });

  it('does not colour ORACLE prose as a command', () => {
    expect(kinds('ORACLE: I have had a long time to think about it'))
      .not.toContain('command');
  });
});

/**
 * Bare command words cannot be coloured on sight — `cat`, `man`, `find`,
 * `sort`, `date` and `which` are all ordinary English. A colon in front of one
 * is the tell, and it is how every instruction in this game is phrased.
 */
describe('a command named after a colon', () => {
  it('colours it', () => {
    expect(covered('ORACLE: Start with: ls', 'command')).toBe('ls');
  });

  it('takes the arguments with it', () => {
    expect(covered('Vasquez left you a note. Read it: cat README', 'command'))
      .toBe('cat README');
  });

  it('stops at the full stop', () => {
    expect(covered('type: hint. It costs nothing.', 'command')).toBe('hint');
  });

  it('finds two on one line and not the words between them', () => {
    const line = '      stuck? type:  hint      the whole board:  objectives';
    expect(covered(line, 'command')).toBe('hint objectives');
  });

  it('ignores a colon followed by something that is not a command', () => {
    expect(kinds('Loaded: loaded (/etc/systemd/system/scrubber.service)'))
      .not.toContain('command');
  });

  it('does not fire on the speaker colon alone', () => {
    expect(kinds('ORACLE: I am what is left of the maintenance daemon'))
      .not.toContain('command');
  });

  it('handles sudo after a colon', () => {
    expect(covered('Then: sudo systemctl start scrubber', 'command'))
      .toBe('sudo systemctl start scrubber');
  });
});

/**
 * Both found by Codex, and both are boundary bugs: a rule that was right about
 * what it matched and wrong about where it was allowed to start.
 */
describe('boundaries', () => {
  it('does not let a contraction open a quoted string', () => {
    const line = "python3: can't open file 'missing.py'";
    expect(covered(line, 'value')).toBe("'missing.py'");
  });

  it('still colours a quoted sed script', () => {
    expect(covered("sed -i 's/no/yes/' /etc/hull/c7.conf", 'value')).toBe("'s/no/yes/'");
  });

  it('leaves a lone contraction entirely alone', () => {
    expect(kinds("it can't be helped")).not.toContain('value');
  });

  it('does not treat a documented long option as a section rule', () => {
    // `man systemctl` prints exactly this. Every option in all 32 manual
    // pages was being painted as a heading.
    const line = '  --failed        show only the units that failed';
    expect(kinds(line)).not.toContain('heading');
    expect(covered(line, 'flag')).toBe('--failed');
  });

  it('still treats a real rule as a rule', () => {
    expect(covered('-- OBJECTIVES ------------ 2 of 4 done', 'heading'))
      .toBe('-- OBJECTIVES ------------ 2 of 4 done');
  });

  it('takes a bare run of dashes', () => {
    expect(covered('------------', 'heading')).toBe('------------');
  });

  it('does not take a short option either', () => {
    expect(kinds('  -l              long form')).not.toContain('heading');
  });
});
