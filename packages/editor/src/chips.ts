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
  '←': [{ key: 'ArrowLeft' }],
  '→': [{ key: 'ArrowRight' }],
  '↑': [{ key: 'ArrowUp' }],
  '↓': [{ key: 'ArrowDown' }],
};

export function chipKeystrokes(label: string): EditorKey[] {
  const named = NAMED[label];
  if (named) return named;

  // `^O` is Ctrl-O, not a caret followed by an O.
  const control = /^\^([A-Za-z])$/.exec(label);
  if (control) return [{ key: control[1]!.toLowerCase(), ctrl: true }];

  // An ex command has to be executed, or tapping it leaves the editor sitting
  // in command mode with the text typed and nothing happening.
  if (label.startsWith(':')) return [...[...label].map((key) => ({ key })), { key: 'Enter' }];

  return [...label].map((key) => ({ key }));
}
