import type { EditorKey } from './types.js';

/**
 * What tapping an on-screen key actually sends.
 *
 * The chip bar is the only keyboard a phone player has inside an editor, so a
 * label that does not send what it says is worse than no label at all. Three
 * bugs lived here before this function existed: `:wq` typed the command and
 * never sent Enter, nano's `^O` typed a literal caret and an O into the file,
 * and every multi-character label was assumed to be plain text.
 *
 * Lives in this package rather than in the app so it can be tested without a
 * browser.
 */
const NAMED: Record<string, EditorKey[]> = {
  ESC: [{ key: 'Escape' }],
  ENTER: [{ key: 'Enter' }],
  TAB: [{ key: 'Tab' }],
  BACK: [{ key: 'Backspace' }],
  // The pager's page-forward key. Without it, `SPACE` is five letters, and
  // in `less` the letters s, p, a, c and e mean five different things.
  SPACE: [{ key: ' ' }],
  '←': [{ key: 'ArrowLeft' }],
  '→': [{ key: 'ArrowRight' }],
  '↑': [{ key: 'ArrowUp' }],
  '↓': [{ key: 'ArrowDown' }],
};

export function chipKeystrokes(label: string): EditorKey[] {
  // Matched case-insensitively: a program that labels its chip `Enter` rather
  // than `ENTER` should not silently type five characters into a file. That
  // is the same class of bug as `^O` typing a caret, and it got in once.
  const named = NAMED[label.toUpperCase()];
  if (named) return named;

  // `^O` is Ctrl-O, not a caret followed by an O.
  const control = /^\^([A-Za-z])$/.exec(label);
  if (control) return [{ key: control[1]!.toLowerCase(), ctrl: true }];

  // An ex command has to be executed, or tapping it leaves the editor sitting
  // in command mode with the text typed and nothing happening.
  if (label.startsWith(':')) return [...[...label].map((key) => ({ key })), { key: 'Enter' }];

  return [...label].map((key) => ({ key }));
}
