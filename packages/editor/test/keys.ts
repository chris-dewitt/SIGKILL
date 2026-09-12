import type { EditorKey, FullscreenProgram } from '../src/types.js';

/**
 * Turn a keystroke script into keys.
 *
 * `'ihello<Escape>:wq<Enter>'` reads the way the thing you would actually type
 * reads, which matters when a test is describing a vi session.
 * `<C-r>` is control-r. Everything else inside angle brackets is a key name.
 */
export function keys(script: string): EditorKey[] {
  const out: EditorKey[] = [];
  let i = 0;
  while (i < script.length) {
    if (script[i] === '<') {
      const close = script.indexOf('>', i);
      if (close < 0) throw new Error(`unclosed key name in: ${script}`);
      const name = script.slice(i + 1, close);
      const ctrl = /^C-(.+)$/.exec(name);
      out.push(ctrl ? { key: ctrl[1]!, ctrl: true } : { key: name });
      i = close + 1;
    } else {
      out.push({ key: script[i]! });
      i++;
    }
  }
  return out;
}

export function send(program: FullscreenProgram, script: string): void {
  for (const k of keys(script)) program.key(k);
}

/** The frame as plain strings, chrome included. */
export function screen(program: FullscreenProgram): string[] {
  return program.frame().map((l) => l.text);
}
