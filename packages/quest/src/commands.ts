import type { CommandSpec } from '@sigkill/machine';
import type { Questbook } from './book.js';

export interface QuestCommandOptions {
  /**
   * Who the hints come from.
   *
   * Hints are diegetic: the ship's daemon is talking, not a tooltip. Keeping
   * the name here means the voice can be recast without touching a ladder.
   */
  speaker?: string;
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
        const rows = book.status(ctx);
        if (rows.length === 0) {
          io.out('Nothing on the board.\n');
          return 0;
        }

        const width = Math.max(...rows.map((row) => row.id.length));
        for (const row of rows) {
          const mark = row.done ? '[x]' : row.blockedBy.length > 0 ? '[-]' : '[ ]';
          const waiting = row.blockedBy.length > 0 ? `   (waiting on ${row.blockedBy.join(', ')})` : '';
          io.out(`  ${mark} ${row.id.padEnd(width)}  ${row.title}${waiting}\n`);
        }
        const taken = book.hintsTaken;
        io.out(`\n${taken === 0 ? 'No hints taken.' : `${taken} hint${taken === 1 ? '' : 's'} taken.`}\n`);
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
        'With no argument, asks about the objective you are on.',
      plain:
        'Ask for help when you are stuck.\n' +
        'Type it again for a bigger hint. Keep going and it will eventually\n' +
        'just tell you the command. That is allowed -- you still have to\n' +
        'understand it to do the next one.',
      run: (ctx, argv, io) => {
        book.track = ctx.track;
        const outcome = book.hint(ctx, argv[1]);

        switch (outcome.kind) {
          case 'hint':
            io.out(say(outcome.lines));
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

          case 'unknown':
            io.err(`hint: no objective called '${outcome.id}'\nTry: objectives\n`);
            return 1;

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
