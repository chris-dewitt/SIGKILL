import type { CommandSpec } from '@sigkill/machine';
import type { Questbook } from './book.js';
import type { World } from './types.js';

export interface QuestCommandOptions {
  /**
   * Who the hints come from.
   *
   * Hints are diegetic: the ship's daemon is talking, not a tooltip. Keeping
   * the name here means the voice can be recast without touching a ladder.
   */
  speaker?: string;
  /**
   * A second voice, called after a hint has been given.
   *
   * `turn` is how many rungs have been taken across the adventure, so an
   * adventure that wants two characters taking turns can decide from its
   * parity -- which means the alternation is carried by the questbook's own
   * snapshot and a restored save picks up where it left off. Returning an
   * empty array is the normal answer and costs nothing.
   *
   * The aside never carries the answer. The ladder does that; this is the
   * thing somebody says while somebody else is explaining.
   */
  aside?: (world: World, turn: number) => readonly string[];
}

const DEFAULT_SPEAKER = 'ORACLE';

/**
 * `objectives` and `hint`.
 *
 * They are ordinary commands rather than a menu, because everything the
 * player learns here should be a thing they typed. A menu would also have to
 * exist twice once the game is on a phone.
 */
export function questCommands(book: Questbook, opts: QuestCommandOptions = {}): CommandSpec[] {
  const speaker = opts.speaker ?? DEFAULT_SPEAKER;
  const say = (lines: readonly string[]): string =>
    lines.map((line) => (line === '' ? '' : `${speaker}: ${line}`)).join('\n') + '\n';
  // Already attributed by whoever wrote them: an aside is a different voice,
  // so it cannot go through the prefix the ladder uses.
  const aside = (world: World): string => {
    const lines = opts.aside?.(world, book.hintsTaken) ?? [];
    return lines.length === 0 ? '' : lines.join('\n') + '\n';
  };

  return [
    {
      name: 'objectives',
      summary: 'list what still needs doing',
      manual:
        'objectives\n\n' +
        'Print the current objectives and their state. [x] is done, [ ] is\n' +
        'open, and a locked objective names what it is waiting on.\n' +
        'Ask for help on one with: hint <id>',
      plain:
        'Shows what you are trying to do right now.\n' +
        '  [x] means finished\n' +
        '  [ ] means still open\n' +
        'Stuck on one? Type: hint',
      run: (ctx, _argv, io) => {
        book.track = ctx.track;
        io.out(board(book, ctx));
        return 0;
      },
    },
    {
      name: 'hint',
      summary: 'ask for help with the current objective',
      manual:
        'hint [objective]\n\n' +
        'Ask for help. Each hint is a little more specific than the last, and\n' +
        'the last one in a ladder is the command itself. Hints cost nothing.\n' +
        'With no argument, asks about the objective you are on.\n\n' +
        'To ask about a different one, name it the way the board does -- the\n' +
        'title, or enough of the start of it to be unambiguous:\n' +
        '  hint Get the hull monitor running\n' +
        '  hint Get the hull\n' +
        'See the board with:  objectives',
      plain:
        'Ask for help when you are stuck.\n' +
        'Type it again for a bigger hint. Keep going and it will eventually\n' +
        'just tell you the command. That is allowed -- you still have to\n' +
        'understand it to do the next one.\n\n' +
        'It asks about whatever you are on. To ask about something else,\n' +
        'type its name from the  objectives  list after it.',
      run: (ctx, argv, io) => {
        book.track = ctx.track;
        // Joined, not argv[1]: the board shows titles and a title has spaces
        // in it. Taking only the first word made the displayed name unusable.
        const asked = argv.slice(1).join(' ').trim();
        const outcome = book.hint(ctx, asked.length > 0 ? asked : undefined);

        switch (outcome.kind) {
          case 'hint':
            io.out(say(outcome.lines));
            io.out(aside(ctx));
            if (outcome.last && !outcome.repeated) {
              io.out(`\n(That is the whole hint. Type \`hint\` again to re-read it.)\n`);
            }
            return 0;

          case 'all-done':
            io.out(say(['Nothing left that I know of. Whatever comes next, we find together.']));
            return 0;

          case 'locked':
            io.err(`hint: ${outcome.objective.id} is waiting on: ${outcome.blockedBy.join(', ')}\n`);
            return 1;

          case 'unknown': {
            // Name what *is* addressable. Sending somebody back to a screen
            // and making them guess the format again is how a help command
            // becomes another dead end.
            const open = book.objectives
              .filter((o) => !o.done(ctx))
              .map((o) => `  hint ${o.title}`);
            io.err(
              [
                `hint: no objective called '${outcome.id}'`,
                ...(open.length > 0 ? ['', 'Try one of:', ...open] : []),
                '',
                'Or just:  hint',
                '',
              ].join('\n'),
            );
            return 1;
          }

          // Not reachable from well-formed content, which is why it names the
          // objective: whoever sees this is the one who can fix it.
          case 'stuck':
            io.err(
              `hint: objective '${outcome.objective.id}' has no step matching the current state.\n` +
                `This is a content bug, not something you did.\n`,
            );
            return 1;
        }
      },
    },
  ];
}

/**
 * The objectives board.
 *
 * Deliberately not boxed. A frame would have to fit the narrowest phone, and
 * an objective's title does not -- so the box would clip the very words it is
 * drawn around. Plain wrapped lines with a strong left edge survive any width,
 * and the colouring rules pick out the marks and the commands for free.
 *
 * Three things a player needs, in this order: how far through am I, what is in
 * front of me right now, and what do I type if I am stuck.
 */
export function board(book: Questbook, world: World): string {
  const rows = book.status(world);
  if (rows.length === 0) return 'Nothing on the board.\n';

  const titles = new Map(book.objectives.map((o) => [o.id, o.title]));
  const done = rows.filter((row) => row.done).length;
  const current = book.current(world);
  const lines: string[] = ['', `-- OBJECTIVES ------------ ${done} of ${rows.length} done`, ''];

  for (const row of rows) {
    const here = row.id === current?.id;
    const mark = row.done ? '[x]' : row.blockedBy.length > 0 ? '[-]' : '[ ]';
    // One character of left margin carries the whole "you are here" signal,
    // and survives being wrapped onto a narrow screen.
    lines.push(`${here ? '>' : ' '} ${mark} ${row.title}`);

    if (row.blockedBy.length > 0) {
      // Named by title, not id. `atmosphere` is what the content calls it;
      // "Get the atmosphere scrubber running" is what the player just read.
      const blockers = row.blockedBy.map((id) => titles.get(id) ?? id);
      lines.push(`      locked until: ${blockers.join(', ')}`);
      continue;
    }
    if (!here || current === undefined) continue;

    const step = book.step(world, current);
    if (step?.label !== undefined) lines.push(`      now: ${step.label}`);
  }

  const taken = book.hintsTaken;
  lines.push(
    '',
    current === undefined
      ? 'Everything on the board is done.'
      : 'Stuck on this one? Type:  hint',
    taken === 0 ? 'No hints taken.' : `${taken} hint${taken === 1 ? '' : 's'} taken.`,
    '',
  );
  return lines.join('\n');
}

/**
 * One line naming what the player is on, for the host to print unprompted.
 *
 * A board the player has to know to ask for is a board most players never see.
 * This is the nudge that goes out after the opening and after every objective
 * closes, so the next thing to do is always the last thing on screen.
 */
export function whatNow(book: Questbook, world: World): string[] {
  const current = book.current(world);
  if (current === undefined) return [];

  const step = book.step(world, current);
  return [
    '',
    `NEXT: ${current.title}`,
    ...(step?.label !== undefined ? [`      ${step.label}`] : []),
    '      stuck? type:  hint      the whole board:  objectives',
    '',
  ];
}
