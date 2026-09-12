import { describe, expect, it } from 'vitest';
import { chipKeystrokes } from '../src/chips.js';
import { NanoEditor } from '../src/nano.js';
import { ViEditor } from '../src/vi.js';
import { screen, send } from './keys.js';

/** Tap an on-screen key the way the app does: label in, keystrokes out. */
const tap = (program: ViEditor | NanoEditor, label: string): void => {
  for (const k of chipKeystrokes(label)) program.key(k);
};

describe('what an on-screen key sends', () => {
  it('maps a named key to that key', () => {
    expect(chipKeystrokes('ESC')).toEqual([{ key: 'Escape' }]);
    expect(chipKeystrokes('ENTER')).toEqual([{ key: 'Enter' }]);
    expect(chipKeystrokes('←')).toEqual([{ key: 'ArrowLeft' }]);
  });

  // This typed a literal caret and an O into the file.
  it('maps ^O to Ctrl-O, not to a caret and an O', () => {
    expect(chipKeystrokes('^O')).toEqual([{ key: 'o', ctrl: true }]);
    expect(chipKeystrokes('^X')).toEqual([{ key: 'x', ctrl: true }]);
  });

  // This typed the command and then sat there waiting forever.
  it('executes an ex command instead of just typing it', () => {
    expect(chipKeystrokes(':wq')).toEqual([
      { key: ':' }, { key: 'w' }, { key: 'q' }, { key: 'Enter' },
    ]);
  });

  it('sends anything else as its characters', () => {
    expect(chipKeystrokes('dd')).toEqual([{ key: 'd' }, { key: 'd' }]);
    expect(chipKeystrokes('i')).toEqual([{ key: 'i' }]);
  });
});

describe('a phone can finish the job with taps alone', () => {
  it('vi: tap i, type, tap ESC, tap :wq -- and it is saved', () => {
    const e = new ViEditor('O2_TARGET=16\n', { rows: 8, cols: 40, path: '/etc/life_support.conf' });
    tap(e, 'i');
    send(e, 'X');
    tap(e, 'ESC');
    tap(e, ':wq');
    expect(e.exit?.write).toBe(true);
    expect(e.exit?.text).toBe('XO2_TARGET=16\n');
  });

  it('vi: tap :w and the text is handed over without leaving', () => {
    const e = new ViEditor('one\ntwo\n', { rows: 8, cols: 40, path: '/tmp/a' });
    send(e, 'dd');
    tap(e, ':w');
    expect(e.pendingWrite).toBe('two\n');
    expect(e.exit).toBeNull();
  });

  it('vi: every chip it offers in normal mode does something', () => {
    const e = new ViEditor('one\ntwo\n', { rows: 8, cols: 40, path: '/tmp/a' });
    for (const label of e.chips) {
      expect(chipKeystrokes(label).length, label).toBeGreaterThan(0);
    }
  });

  // The command-mode bar used to offer w, q, wq and q! as bare fragments, which
  // appended onto the colon already typed and then never ran.
  it('vi: the command-mode bar offers only keys that make sense there', () => {
    const e = new ViEditor('a\n', { rows: 8, cols: 40, path: '/tmp/a' });
    send(e, ':');
    expect(e.chips).toContain('ESC');
    expect(e.chips).toContain('ENTER');
    expect(e.chips).not.toContain('wq');
  });

  it('vi: ENTER from the bar runs what was typed into the command line', () => {
    const e = new ViEditor('a\nb\n', { rows: 8, cols: 40, path: '/tmp/a' });
    send(e, ':2');
    tap(e, 'ENTER');
    expect(screen(e).at(-1)).toMatch(/2,1\s*$/);
  });

  it('nano: tap ^O then ^X and the work is saved and closed', () => {
    const e = new NanoEditor('keep\n', { rows: 8, cols: 40, path: '/tmp/notes' });
    send(e, '!');
    tap(e, '^O');
    expect(e.pendingWrite).toBe('!keep\n');
    tap(e, '^X');
    expect(e.exit).not.toBeNull();
  });

  it('nano: ^K from the bar cuts a line instead of typing two letters', () => {
    const e = new NanoEditor('one\ntwo\n', { rows: 8, cols: 40, path: '/tmp/a' });
    tap(e, '^K');
    expect(e.text).toBe('two\n');
  });

  it('nano: every chip it offers does something, in both its states', () => {
    const e = new NanoEditor('a\n', { rows: 8, cols: 40, path: '/tmp/a' });
    for (const label of e.chips) expect(chipKeystrokes(label).length, label).toBeGreaterThan(0);
    send(e, 'x');
    tap(e, '^X');
    for (const label of e.chips) expect(chipKeystrokes(label).length, label).toBeGreaterThan(0);
    tap(e, 'Y');
    expect(e.exit?.write).toBe(true);
  });
});
