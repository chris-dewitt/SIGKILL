import { describe, expect, it } from 'vitest';
import { ViEditor } from '../src/vi.js';
import { screen, send } from './keys.js';

const CONF = ['# NAV-7 atmosphere controller', 'O2_TARGET=16', 'SCRUBBER_DUTY=0.4', ''].join('\n');

const open = (text = CONF, opts: Partial<ConstructorParameters<typeof ViEditor>[1]> = {}): ViEditor =>
  new ViEditor(text, { rows: 10, cols: 40, path: '/etc/life_support.conf', ...opts });

const status = (e: ViEditor): string => screen(e).at(-1) ?? '';

describe('leaving vi', () => {
  it(':q quits a file nobody changed', () => {
    const e = open();
    send(e, ':q<Enter>');
    expect(e.exit).toEqual({ write: false, text: CONF });
  });

  it('pressing i and Escape does not count as changing the file', () => {
    const e = open();
    send(e, 'i<Escape>:q<Enter>');
    expect(e.exit).not.toBeNull();
  });

  it(':q refuses to discard unsaved work, and says how to override', () => {
    const e = open();
    send(e, 'x:q<Enter>');
    expect(e.exit).toBeNull();
    expect(status(e)).toContain('E37: No write since last change');
  });

  it(':q! throws the work away when the player insists', () => {
    const e = open();
    send(e, 'x:q!<Enter>');
    expect(e.exit?.write).toBe(false);
  });

  it(':wq writes and leaves', () => {
    const e = open();
    send(e, ':wq<Enter>');
    expect(e.exit?.write).toBe(true);
  });

  // However people first learn to leave vi, most of them end up here.
  it('ZZ writes and leaves', () => {
    const e = open();
    send(e, 'ZZ');
    expect(e.exit?.write).toBe(true);
  });

  it('ZQ leaves without writing', () => {
    const e = open();
    send(e, 'xZQ');
    expect(e.exit?.write).toBe(false);
  });

  it('names an unknown ex command instead of ignoring it', () => {
    const e = open();
    send(e, ':wat<Enter>');
    expect(status(e)).toContain('E492: Not an editor command: wat');
  });
});

// The thing the player is actually trying to do in Act I.
describe('changing the oxygen target', () => {
  it('with a substitution', () => {
    const e = open();
    send(e, ':%s/O2_TARGET=16/O2_TARGET=21/<Enter>:wq<Enter>');
    expect(e.exit?.text).toContain('O2_TARGET=21');
    expect(e.exit?.text).not.toContain('=16');
  });

  it('by replacing two characters in place', () => {
    const e = open();
    send(e, 'j$r1');
    expect(e.text).toContain('O2_TARGET=11');
    send(e, 'hr2');
    expect(e.text).toContain('O2_TARGET=21');
  });

  it('by deleting the line and typing a new one', () => {
    const e = open();
    send(e, 'jdd');
    // `O` is the open-line-above command; the O of O2_TARGET is typed text.
    send(e, 'O');
    send(e, 'O2_TARGET=21<Escape>:wq<Enter>');
    expect(e.exit?.text).toContain('O2_TARGET=21');
  });

  it('by searching for the setting first', () => {
    const e = open();
    send(e, '/O2_TARGET<Enter>');
    expect(e.frame().find((l) => l.cursor !== undefined)?.text).toContain('O2_TARGET');
  });

  it('and every route lands on the same file contents', () => {
    const a = open();
    send(a, ':%s/16/21/<Enter>:wq<Enter>');
    const b = open();
    send(b, 'j$r1hr2:wq<Enter>');
    expect(a.exit?.text).toBe(b.exit?.text);
  });
});

describe('normal mode', () => {
  it('moves with hjkl and reports the position', () => {
    const e = open();
    send(e, 'jjll');
    expect(status(e)).toMatch(/3,3\s*$/);
  });

  it('takes a count prefix', () => {
    const e = open('1\n2\n3\n4\n5\n6\n');
    send(e, '3j');
    expect(status(e)).toMatch(/4,1\s*$/);
    send(e, '2k');
    expect(status(e)).toMatch(/2,1\s*$/);
  });

  it('clamps a count that runs off the end of the file', () => {
    const e = open();
    send(e, '99j');
    expect(status(e)).toMatch(/3,1\s*$/);
  });

  it('treats a leading 0 as the motion, not a count', () => {
    const e = open();
    send(e, 'j$0');
    expect(status(e)).toMatch(/2,1\s*$/);
  });

  it('gg and G jump to the ends, and a count with G to a line', () => {
    const e = open();
    send(e, 'G');
    expect(status(e)).toMatch(/3,/);
    send(e, 'gg');
    expect(status(e)).toMatch(/1,/);
    send(e, '2G');
    expect(status(e)).toMatch(/2,/);
  });

  it('dd deletes a line and 2dd deletes two', () => {
    const e = open('a\nb\nc\nd\n');
    send(e, 'dd');
    expect(e.text).toBe('b\nc\nd\n');
    send(e, '2dd');
    expect(e.text).toBe('d\n');
  });

  it('yanks and puts', () => {
    const e = open('keep\n');
    send(e, 'yyp');
    expect(e.text).toBe('keep\nkeep\n');
  });

  it('x deletes under the cursor, with a count', () => {
    const e = open('abcdef\n');
    send(e, '3x');
    expect(e.text).toBe('def\n');
  });

  it('D truncates from the cursor', () => {
    const e = open('keep this\n');
    send(e, '4lD');
    expect(e.text).toBe('keep\n');
  });

  it('dw deletes a word', () => {
    const e = open('alpha beta gamma\n');
    send(e, 'dw');
    expect(e.text).toBe('beta gamma\n');
  });

  it('u undoes, and Ctrl-r redoes', () => {
    const e = open('precious\n');
    send(e, 'dd');
    expect(e.text).toBe('');
    send(e, 'u');
    expect(e.text).toBe('precious\n');
    send(e, '<C-r>');
    expect(e.text).toBe('');
  });

  it('says so rather than going quiet when there is nothing to undo', () => {
    const e = open();
    send(e, 'u');
    expect(status(e)).toContain('Already at oldest change');
  });
});

// The single most common way a person gets stuck in vi, and the reason the
// first playtest reported "can't type within the file".
describe('typing in normal mode', () => {
  it('says letters are commands, and names the way in', () => {
    const e = open();
    send(e, 'q');
    expect(status(e)).toContain('Not a command: q');
    expect(status(e)).toContain('press i');
  });

  it('changes nothing while it says so', () => {
    const e = open();
    send(e, 'zq');
    expect(e.text).toBe(CONF);
  });

  it('stays quiet for keys that really are commands', () => {
    const e = open();
    send(e, 'j');
    expect(status(e)).not.toContain('Not a command');
  });

  it('clears itself the moment insert mode starts', () => {
    const e = open();
    send(e, 'q');
    send(e, 'i');
    expect(status(e)).toContain('-- INSERT --');
  });
});

describe('insert mode', () => {
  it('shows -- INSERT -- so the mode is never a guess', () => {
    const e = open();
    send(e, 'i');
    expect(status(e)).toContain('-- INSERT --');
    send(e, '<Escape>');
    expect(status(e)).not.toContain('INSERT');
  });

  it('a appends after the cursor, i inserts before it', () => {
    const e = open('XZ\n');
    send(e, 'iA<Escape>');
    expect(e.text).toBe('AXZ\n');
    const f = open('XZ\n');
    send(f, 'aY<Escape>');
    expect(f.text).toBe('XYZ\n');
  });

  it('A appends at the end of the line', () => {
    const e = open('start\n');
    send(e, 'A end<Escape>');
    expect(e.text).toBe('start end\n');
  });

  it('o opens below and O above', () => {
    const e = open('mid\n');
    send(e, 'obelow<Escape>');
    expect(e.text).toBe('mid\nbelow\n');
    send(e, 'ggOabove<Escape>');
    expect(e.text).toBe('above\nmid\nbelow\n');
  });

  it('Enter splits the line and Backspace joins it back', () => {
    const e = open('ab\n');
    send(e, 'a<Enter><Backspace><Escape>');
    expect(e.text).toBe('ab\n');
  });

  // A literal tab in a config file is a bug the player cannot see.
  it('Tab inserts spaces, not a tab character', () => {
    const e = open('x\n');
    send(e, 'i<Tab><Escape>');
    expect(e.text).toBe('  x\n');
  });

  it('leaves the cursor on a character when Escape lands', () => {
    const e = open('ab\n');
    send(e, 'A!<Escape>');
    expect(status(e)).toMatch(/1,3\s*$/);
  });
});

describe('the screen', () => {
  it('fills past the end of the file with ~, like the real thing', () => {
    const e = open('one\n');
    const rows = screen(e);
    expect(rows[0]).toBe('one');
    expect(rows[1]).toBe('~');
    expect(rows).toHaveLength(10);
  });

  it('draws the cursor on exactly one cell', () => {
    const e = open();
    const withCursor = e.frame().filter((l) => l.cursor !== undefined);
    expect(withCursor).toHaveLength(1);
    expect(withCursor[0]?.cursor).toBe(0);
  });

  it('announces the file on open, the way vi does', () => {
    const e = open();
    expect(status(e)).toContain('"/etc/life_support.conf"');
    expect(status(e)).toMatch(/3L, \d+C/);
  });

  it('marks the buffer modified', () => {
    const e = open();
    send(e, 'x');
    expect(status(e)).toContain('[+]');
  });

  it('scrolls to keep the cursor on screen', () => {
    const e = open(Array.from({ length: 40 }, (_, i) => `line ${i + 1}`).join('\n') + '\n');
    send(e, 'G');
    expect(screen(e)[0]).not.toBe('line 1');
    expect(screen(e).some((l) => l === 'line 40')).toBe(true);
  });

  it(':set number shows line numbers and shifts the cursor with them', () => {
    const e = open();
    send(e, ':set number<Enter>');
    expect(screen(e)[0]).toMatch(/^\s*1 #/);
    const cursorRow = e.frame().find((l) => l.cursor !== undefined);
    expect(cursorRow?.cursor).toBeGreaterThan(0);
    send(e, ':set nonumber<Enter>');
    expect(screen(e)[0]).toMatch(/^#/);
  });

  it('echoes the command line as it is typed', () => {
    const e = open();
    send(e, ':wq');
    expect(status(e)).toBe(':wq');
    expect(e.exit).toBeNull();
  });

  it('backspacing away the colon leaves command mode', () => {
    const e = open();
    send(e, ':<Backspace>');
    expect(status(e)).not.toBe(':');
  });
});

describe('a phone can reach every key it needs', () => {
  it('offers Escape in insert mode, where it is the only way out', () => {
    const e = open();
    send(e, 'i');
    expect(e.chips).toContain('ESC');
  });

  it('offers the way in and the way out from normal mode', () => {
    const e = open();
    expect(e.chips).toContain('i');
    expect(e.chips).toContain(':wq');
  });
});

describe('a file the player cannot write', () => {
  it('refuses to enter insert mode and says why', () => {
    const e = open(CONF, { readOnly: true });
    send(e, 'i');
    expect(status(e)).toContain('read-only');
    send(e, 'X');
    expect(e.text).toBe(CONF);
  });

  it('refuses :w with the real vi error', () => {
    const e = open(CONF, { readOnly: true });
    send(e, ':w<Enter>');
    expect(status(e)).toContain('E45');
    expect(e.exit).toBeNull();
  });

  it('announces itself as readonly on open', () => {
    const e = open(CONF, { readOnly: true });
    expect(status(e)).toContain('[readonly]');
  });
});

describe('a file that does not exist yet', () => {
  it('opens empty and says so', () => {
    const e = new ViEditor('', { rows: 8, cols: 40, path: '/home/survivor/notes', isNew: true });
    expect(screen(e).at(-1)).toContain('[New File]');
    send(e, 'ifirst line<Escape>:wq<Enter>');
    expect(e.exit?.text).toBe('first line\n');
  });
});

describe(':w without quitting', () => {
  it('hands the text over immediately rather than at exit', () => {
    const e = open();
    send(e, 'dd:w<Enter>');
    expect(e.pendingWrite).toBe(e.text);
    expect(e.exit).toBeNull();
    expect(status(e)).toContain('written');
  });
});
