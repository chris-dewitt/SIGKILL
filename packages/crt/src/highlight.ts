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

/** A number that carries a unit or a percent. */
const VALUE = /(?<![\w.])(\d+(?:\.\d+)?(?:%|kPa|h|m|s)?)(?![\w.])/g;

/**
 * An indented line that might be a command the player could type.
 *
 * The optional speaker prefix matters: every hint ORACLE gives is emitted as
 * `ORACLE: <line>`, so without it the one place a command most needs to stand
 * out -- the bottom rung of a ladder -- was the one place it never did.
 */
const INDENTED = /^(?:[A-Z][A-Z0-9_]{2,}:)?(\s{2,})(\S.*?)\s*$/;

/**
 * Where a command stops and its description begins.
 *
 * Two spaces. It is how every table in this game is laid out --
 * `deck        the nine compartments` -- and without it the rule painted the
 * description cyan too, promising the player they could type an English
 * sentence.
 */
const GAP = /\s{2,}/;

/**
 * A command introduced by a colon, mid-sentence.
 *
 * `Start with: ls` / `Read it: cat README` / `type: hint`. Bare command words
 * cannot be coloured on sight -- `cat`, `man`, `find`, `sort`, `date` and
 * `which` are all ordinary English -- but a colon followed by one is a
 * reliable tell, and it is how every instruction in this game is written.
 */
// Stops at the next colon as well as at punctuation, or the first colon on
// a line swallows every later one -- `ORACLE: Start with: ls` would be read
// as a single clause beginning with the word `Start`.
const AFTER_COLON = /:[ \t]+([^.,;:\n]+)/g;

/**
 * Punctuation that means the line is a sentence, whatever it starts with.
 *
 * `find which compartment is losing air, and seal it` begins with the name of
 * a real command, and every word of it was coming out cyan. A comma or a
 * closing full stop is the cheapest reliable tell that prose is what this is.
 */
const PROSE = /,\s|\.$/;

/** A `NAME=value` setting, as it appears in every config file aboard. */
const SETTING = /\b([A-Z][A-Z0-9_]*)=(\S*)/g;

/** A short or long option: `-l`, `-rf`, `--failed`, `--audit-level`. */
const FLAG = /(?<=^|\s)(--?[A-Za-z][A-Za-z0-9-]*)(?=$|[\s,.)])/g;

/**
 * A quoted string, either kind.
 *
 * Guarded at both ends, and that guard is the whole rule: without it the
 * apostrophe in a contraction opens a string, so `can't open file
 * 'missing.py'` matched `'t open file '` -- painting the prose yellow and
 * missing the filename it was there for. A quote that opens a string never
 * follows a letter.
 */
const QUOTED = /(?<!\w)('[^']*'|"[^"]*")(?!\w)/g;

/** A SCREAMING_SNAKE token on its own: the vocabulary of every log aboard. */
const SCREAMED = /(?<![\w=])([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)(?![\w=])/g;

/** Box drawing. Frames are chrome and get the chrome colour. */
const FRAME = /[\u2500-\u257f]+/g;

/** A checklist mark, as the objectives board draws it. */
const MARK = /^(\s*)(>?)\s*\[([x\- ])\]/;

/**
 * A section rule: `-- OBJECTIVES ---`, or a bare run of dashes.
 *
 * The trailing boundary matters more than it looks. Without it a documented
 * long option at the head of a line is a rule -- and `man systemctl` prints
 * `  --failed        show only the units that failed`, so every option in
 * every one of the 32 manual pages was painted as a heading, overriding its
 * own colour.
 */
const RULE = /^\s*(-{2,}|─{2,})(?=\s|$)/;

/**
 * Words a machine says about the state of something.
 *
 * Mapped by meaning rather than by hue, which is the whole reason a glance at
 * `systemctl` output can find the broken unit without reading it. Matched
 * whole-word and case-sensitively in the forms these actually appear in --
 * loose matching here would paint half of ordinary prose.
 */
const STATE: ReadonlyArray<readonly [RegExp, LineKind]> = [
  // Deliberately excluded: `refused`, `refusing`, `broken`, `wrong`. They are
  // the vocabulary of the machine *and* of ORACLE's prose, and painting half a
  // sentence red because it contains the word is noise, not information.
  [/(?<![\w-])(FAIL|FAILED|failed|ERROR|CRITICAL|ALARM|DENIED|Denied|denied)(?![\w-])/g, 'err'],
  [/(?<![\w-])(OK|ACTIVE|active|enabled|DONE|PASS|RISING|SEALED|sealed|CLEARED|nominal|holding)(?![\w-])/g, 'good'],
  [/(?<![\w-])(WARN|WARNING|DEGRADED|degraded|inactive|disabled|unknown|PRESSURE_DROP|SENSOR_FAULT)(?![\w-])/g, 'warn'],
];

export function highlight(text: string, opts: HighlightOptions = {}): Span[] {
  const spans: Span[] = [];
  const add = (start: number, end: number, kind: LineKind): void => {
    if (end > start) spans.push({ start, end, kind });
  };
  const all = (re: RegExp, kind: LineKind): void => {
    for (const match of text.matchAll(re)) {
      const at = match.index ?? 0;
      add(at, at + match[0].length, kind);
    }
  };

  // --- least specific first; later spans win where they overlap ------------

  all(VALUE, 'value');
  all(SCREAMED, 'warn');

  for (const [re, kind] of STATE) all(re, kind);

  for (const match of text.matchAll(SETTING)) {
    const at = match.index ?? 0;
    // The name stays quiet and the value carries, because in every puzzle
    // aboard it is the value that is wrong.
    add(at, at + (match[1] ?? '').length, 'muted');
    add(at + (match[1] ?? '').length + 1, at + match[0].length, 'value');
  }

  all(QUOTED, 'value');
  all(FLAG, 'flag');
  all(FRAME, 'heading');

  for (const match of text.matchAll(PATH)) {
    const at = match.index ?? 0;
    // A path is allowed to contain dots and almost never ends with one, while
    // a sentence mentioning a path ends with one constantly. Give the full
    // stop back to the prose.
    let end = at + match[0].length;
    while (end > at && text[end - 1] === '.') end--;
    add(at, end, 'path');
  }

  /*
   * An indented command line, coloured as one typeable unit so that flags and
   * arguments read as part of the thing you type rather than three colours.
   *
   * Trimmed at the first double space, because that is where this game's
   * tables put the description, and rejected outright when the line carries
   * sentence punctuation -- otherwise a step label that happens to begin with
   * the word `find` becomes a cyan promise that you can type it.
   */
  const indented = INDENTED.exec(text);
  if (indented) {
    const body = (indented[2] ?? '').split(GAP)[0] ?? '';
    const words = body.split(/\s+/);
    const verb = words[0] === 'sudo' ? (words[1] ?? '') : (words[0] ?? '');
    if (opts.commands?.has(verb) === true && !PROSE.test(body)) {
      const at = text.indexOf(body);
      if (at >= 0) add(at, at + body.length, 'command');
    }
  }

  /*
   * A command named after a colon, which is how ORACLE phrases every
   * instruction. Trimmed at a double space so `type:  hint     the whole
   * board:  objectives` colours two commands and not the words between them.
   */
  if (opts.commands !== undefined) {
    for (const match of text.matchAll(AFTER_COLON)) {
      const clause = (match[1] ?? '').split(GAP)[0]?.trimEnd() ?? '';
      const words = clause.split(/\s+/);
      const verb = words[0] === 'sudo' ? (words[1] ?? '') : (words[0] ?? '');
      if (clause.length === 0 || !opts.commands.has(verb)) continue;
      const at = (match.index ?? 0) + match[0].indexOf(clause);
      add(at, at + clause.length, 'command');
    }
  }

  // A rule under a section title is chrome, like a box edge.
  const ruled = RULE.exec(text);
  if (ruled) add(0, text.length, 'heading');

  /*
   * The objectives board's marks, which are the fastest thing on the screen to
   * read and so are worth the most colour: done is green, open is the colour
   * of something you could act on, locked is quiet, and the `>` saying "you
   * are here" is the brightest mark in the list.
   */
  const mark = MARK.exec(text);
  if (mark) {
    const indent = (mark[1] ?? '').length;
    const arrow = mark[2] ?? '';
    const state = mark[3] ?? ' ';
    if (arrow.length > 0) add(indent, indent + 1, 'warn');
    const box = text.indexOf('[', indent);
    add(box, box + 3, state === 'x' ? 'good' : state === '-' ? 'muted' : 'command');
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
