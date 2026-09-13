import type { CommandSpec } from '@sigkill/machine';
import { deckMap, pressurePanel } from './art.js';

/**
 * Commands the ship carries that draw rather than print.
 *
 * These are adventure commands, layered in through `MachineOptions.commands`
 * exactly like `hint` -- `packages/machine` has no screen and no idea what a
 * drawing is, which is why the art lives here and not there.
 *
 * Both read live world state on every invocation. That is the point: `deck`
 * after sealing C7 is a different picture from `deck` before, so the player's
 * edit to a line in a config file and the hole in the side of a spaceship are
 * visibly the same fact.
 */
export function artCommands(): CommandSpec[] {
  return [
    {
      name: 'deck',
      summary: 'draw the deck plan from the hull configuration',
      manual:
        'deck\n\n' +
        'Render deck C as a diagram, read from /etc/hull/*.conf at the moment\n' +
        'you ask. A compartment with a solid wall is sealed; one with a dashed\n' +
        'wall is open to vacuum.\n\n' +
        'It is a view of the files, not a second copy of the truth. Edit a\n' +
        'compartment and run it again.',
      plain:
        'Draws a map of this deck.\n\n' +
        'Nine compartments. A solid box is sealed and safe. A dashed box is\n' +
        'open to space.\n\n' +
        'The map is drawn from the files in /etc/hull every time you ask, so\n' +
        'if you change one and run  deck  again, the picture changes too.',
      run: (ctx, _argv, io) => {
        // Columns are load-bearing here. See `ShellContext.preformatted`.
        ctx.preformatted = true;
        io.out(deckMap(ctx.vfs).join('\n') + '\n');
        return 0;
      },
    },
    {
      name: 'pressure',
      summary: 'plot hull pressure per compartment',
      manual:
        'pressure\n\n' +
        'Plot ten days of /var/log/hull.log as one sparkline per compartment,\n' +
        'all nine on a shared axis so they can be compared. The latest reading\n' +
        'is printed beside each, and anything under 100 kPa is flagged.\n\n' +
        'It reads the same log `grep` does. It is faster to look at and worse\n' +
        'at answering when, which is why both exist.',
      plain:
        'Draws a little graph of hull pressure for each compartment, from the\n' +
        'readings in /var/log/hull.log.\n\n' +
        'A flat line near the top is a compartment that is fine. A line that\n' +
        'slides downward is one that is losing air.\n\n' +
        'It shows you the shape. To find out exactly when something happened,\n' +
        'you still want:  grep C7 /var/log/hull.log',
      run: (ctx, _argv, io) => {
        ctx.preformatted = true;
        io.out(pressurePanel(ctx.vfs).join('\n') + '\n');
        return 0;
      },
    },
  ];
}
