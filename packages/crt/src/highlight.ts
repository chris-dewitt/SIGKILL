import type { LineKind, Span } from './buffer.js';

/**
 * Find the runs worth colouring in a line of terminal text.
 *
 * Deliberately a pure function over a string, and deliberately not a markup
 * language. There are thousands of lines of authored prose, manual pages and
 * command output already written; a syntax would mean rewriting all of it and
 * would mean every future line is one forgotten tag away from being plain.
 * Rules that read the text get every line right at once, including output the
 * adventure never wrote -- `ls -l`, a manual page, a log.
 *
 * The cost is that a rule can be wrong, so each one here is narrow, ordered
 * least- to most-specific (later spans win), and tested against the lines it
 * must not touch as hard as the ones it must.
 */

export interface HighlightOptions {
  /**
   * Names the machine will actually run.
   *
   * Passed in rather than guessed: colouring a word cyan says "you can type
   * this", and saying that about something the ship does not have is worse
   * than leaving the line grey.
   */
  commands?: ReadonlySet<string>;
}

/** `ORACLE:` and friends at the head of a line. */
const SPEAKER = /^(\s*)([A-Z][A-Z0-9_]{2,}):/;

/** An absolute path, or a bare dotted filename. Conservative on both ends. */
const PATH = /(?<![\w/])(\/[A-Za-z0-9._\-*]+(?:\/[A-Za-z0-9._\-*]+)*\/?)/g;

/** A number that carries a unit or a percent, plus bare NAME=value settings. */
const VALUE = /(?<![\w.])(\d+(?:\.\d+)?(?:%|kPa|h|m|s)?)(?![\w.])/g;

/** An indented line that is a command the player could type. */
const INDENTED = /^(\s{2,})(\S.*?)\s*$/;

/** A `NAME=value` setting, as it appears in every config file aboard. */
const SETTING = /\b([A-Z][A-Z0-9_]*)=(\S*)/g;

export function highlight(text: string, opts: HighlightOptions = {}): Span[] {
  const spans: Span[] = [];
  const add = (start: number, end: number, kind: LineKind): void => {
    if (end > start) spans.push({ start, end, kind });
  };

  // --- least specific first; later spans win where they overlap ------------

  for (const match of text.matchAll(VALUE)) {
    const at = match.index ?? 0;
    add(at, at + match[0].length, 'value');
  }

  for (const match of text.matchAll(SETTING)) {
    const at = match.index ?? 0;
    // The name stays quiet and the value carries, because in every puzzle
    // aboard it is the value that is wrong.
    add(at, at + (match[1] ?? '').length, 'muted');
    add(at + (match[1] ?? '').length + 1, at + match[0].length, 'value');
  }

  for (const match of text.matchAll(PATH)) {
    const at = match.index ?? 0;
    // A path is allowed to contain dots and almost never ends with one, while
    // a sentence mentioning a path ends with one constantly. Give the full
    // stop back to the prose.
    let end = at + match[0].length;
    while (end > at && text[end - 1] === '.') end--;
    add(at, end, 'path');
  }

  // An indented command line: the whole thing, so flags and arguments read as
  // part of the one typeable unit rather than three different colours.
  const indented = INDENTED.exec(text);
  if (indented) {
    const body = indented[2] ?? '';
    const first = body.split(/\s+/)[0] ?? '';
    const verb = first === 'sudo' ? (body.split(/\s+/)[1] ?? '') : first;
    if (opts.commands?.has(verb) === true) {
      const at = (indented[1] ?? '').length;
      add(at, at + body.length, 'command');
    }
  }

  // The speaker's name recedes so the sentence carries. Last, because it sits
  // at offset zero and must win over anything that matched there.
  const speaker = SPEAKER.exec(text);
  if (speaker) {
    const at = (speaker[1] ?? '').length;
    add(at, at + (speaker[2] ?? '').length + 1, 'speaker');
  }

  return spans;
}
