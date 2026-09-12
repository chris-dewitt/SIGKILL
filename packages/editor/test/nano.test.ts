import { describe, expect, it } from 'vitest';
import { NanoEditor } from '../src/nano.js';
import { screen, send } from './keys.js';

const open = (text = 'O2_TARGET=16\n', opts: Partial<ConstructorParameters<typeof NanoEditor>[1]> = {}): NanoEditor =>
  new NanoEditor(text, { rows: 10, cols: 44, path: '/etc/life_support.conf', ...opts });

/** The message line sits above the two shortcut rows. */
const message = (e: NanoEditor): string => screen(e).at(-3) ?? '';

describe('nano types without a mode', () => {
  it('inserts what you press, with no incantation first', () => {
    const e = open('');
    send(e, 'hello');
    expect(e.text).toBe('hello\n');
  });

  it('Enter and Backspace do the obvious thing', () => {
    const e = open('');
    send(e, 'ab<Enter>c<Backspace><Backspace>');
    expect(e.text).toBe('ab\n');
  });

  it('never traps anybody: the way out is printed on screen', () => {
    const e = open();
    const rows = screen(e);
    expect(rows.at(-2)).toContain('^O Write Out');
    expect(rows.at(-1)).toContain('^X Exit');
  });
});

describe('saving and leaving', () => {
  it('^O writes and keeps editing', () => {
    const e = open('a\n');
    send(e, 'b<C-o>');
    expect(e.pendingWrite).toBe('ba\n');
    expect(e.exit).toBeNull();
    expect(message(e)).toContain('Wrote 1 line');
  });

  it('^X leaves straight away when nothing changed', () => {
    const e = open();
    send(e, '<C-x>');
    expect(e.exit).toEqual({ write: false, text: 'O2_TARGET=16\n' });
  });

  it('^X on a changed file asks first', () => {
    const e = open();
    send(e, 'x<C-x>');
    expect(e.exit).toBeNull();
    expect(message(e)).toContain('Save modified buffer?');
    expect(e.chips).toEqual(['Y', 'N', '^C']);
  });

  it('answering Y writes, N discards, ^C goes back to editing', () => {
    const yes = open();
    send(yes, 'X<C-x>y');
    expect(yes.exit?.write).toBe(true);

    const no = open();
    send(no, 'X<C-x>n');
    expect(no.exit?.write).toBe(false);

    const cancel = open();
    send(cancel, 'X<C-x><C-c>');
    expect(cancel.exit).toBeNull();
    expect(message(cancel)).toContain('Cancelled');
  });

  it('holds the prompt up rather than guessing at a stray key', () => {
    const e = open();
    send(e, 'x<C-x>q');
    expect(e.exit).toBeNull();
  });
});

describe('the shortcuts that earn their place on the bar', () => {
  it('^K cuts a line', () => {
    const e = open('one\ntwo\n');
    send(e, '<C-k>');
    expect(e.text).toBe('two\n');
  });

  it('^A and ^E go to the ends of the line', () => {
    const e = open('abcdef\n');
    send(e, '<C-e>!');
    expect(e.text).toBe('abcdef!\n');
    send(e, '<C-a>>');
    expect(e.text).toBe('>abcdef!\n');
  });

  it('^C says where you are', () => {
    const e = open('a\nb\nc\n');
    send(e, '<ArrowDown><C-c>');
    expect(message(e)).toContain('line 2/3');
  });

  it('^G lists the keys, for the player who forgot', () => {
    const e = open();
    send(e, '<C-g>');
    expect(message(e)).toContain('^O write out');
  });

  it('names an unknown shortcut instead of swallowing it', () => {
    const e = open();
    send(e, '<C-z>');
    expect(message(e)).toContain('Unknown command: ^Z');
  });
});

describe('the screen', () => {
  it('titles itself and flags an unsaved change', () => {
    const e = open();
    expect(screen(e)[0]).toContain('/etc/life_support.conf');
    expect(screen(e)[0]).not.toContain('Modified');
    send(e, 'x');
    expect(screen(e)[0]).toContain('Modified');
  });

  it('draws the cursor on exactly one cell', () => {
    const e = open();
    expect(e.frame().filter((l) => l.cursor !== undefined)).toHaveLength(1);
  });

  it('scrolls to follow the cursor down a long file', () => {
    const e = open(Array.from({ length: 40 }, (_, i) => `line ${i + 1}`).join('\n') + '\n');
    for (let i = 0; i < 39; i++) send(e, '<ArrowDown>');
    expect(screen(e).some((l) => l === 'line 40')).toBe(true);
  });
});

describe('a file the player cannot write', () => {
  it('is still editable; the refusal belongs at the save', () => {
    const e = open('locked\n', { readOnly: true });
    send(e, 'x');
    expect(e.text).toBe('xlocked\n');
  });

  it('says so on open, and says what it would take', () => {
    const e = open('locked\n', { readOnly: true });
    expect(message(e)).toContain('Read only');
    expect(message(e)).toContain('sudo');
  });

  it('attempts the write and shows what the disk says', () => {
    const e = open('locked\n', { readOnly: true });
    send(e, 'x<C-o>');
    expect(e.pendingWrite).toBe('xlocked\n');
    e.notify('/etc/motd: permission denied');
    expect(message(e)).toContain('permission denied');
  });
});
