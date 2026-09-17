import type { CommandSpec, ExecIO, ShellContext } from '@sigkill/machine';
import { deckMap, pressurePanel } from './art.js';
import { ventingCompartments } from './purge.js';

/**
 * Commands the ship carries that draw rather than print.
 *
 * Adventure commands, layered in through `MachineOptions.commands` exactly like
 * `hint` -- `packages/machine` has no screen and no idea what a drawing is,
 * which is why the art lives here and not there.
 *
 * Both read live world state on every invocation. That is the point: `deck`
 * after sealing C7 is a different picture from `deck` before, so the player's
 * edit to a line in a config file and the hole in the side of a spaceship are
 * visibly the same fact.
 */

/**
 * Neither drawing exists until the hull monitor does.
 *
 * This is a gate the fiction already promised. The cold open says ORACLE can
 * draw the deck "once the hull monitor is running", and for a while it would
 * draw it anyway -- so a player could type `pressure` as their first command,
 * be handed the flagged C7 row, and skip the two puzzles that exist to teach
 * them how to find it. Worse than the spoiler: the ship broke its word, which
 * is the one thing it must never do.
 *
 * The refusal does the teaching. It names the unit and hands over the exact
 * diagnostic that is the whole lesson of the hull-monitor puzzle, so being
 * turned away leaves the player closer to the answer than they were.
 */
function requireMonitor(ctx: ShellContext, io: ExecIO, command: string): boolean {
  const monitor = ctx.services.get('hull-monitor');
  if (monitor?.state === 'active') return true;

  io.err(
    [
      `${command}: hull-monitor is not running, so I have nothing live to draw from.`,
      '',
      '  The unit that reads the compartments will tell you why itself:',
      '',
      '      systemctl status hull-monitor',
      '',
      '  The telemetry it has already written is on disk either way:',
      '',
      '      /var/log/hull.log',
      '',
    ].join('\n') + '\n',
  );
  return false;
}

export function artCommands(): CommandSpec[] {
  return [
    {
      name: 'deck',
      summary: 'draw the deck plan from the hull configuration',
      // Columns are load-bearing. Declared here rather than raised during the
      // run, so `deck; cat README` tags only the drawing.
      preformatted: true,
      manual:
        'deck\n\n' +
        'Render deck C as a diagram, read from /etc/hull/*.conf and from the\n' +
        'process table at the moment you ask. A compartment with a solid wall\n' +
        'is sealed; one with a dashed wall is open to vacuum; a half-filled\n' +
        'one is shut and losing pressure anyway, which means something running\n' +
        'aboard is emptying it.\n\n' +
        'Requires hull-monitor to be running -- the diagram is a view of what\n' +
        'that unit reads, not a second copy of the truth. Edit a compartment\n' +
        'and run it again.',
      plain:
        'Draws a map of this deck.\n\n' +
        'Nine compartments. A solid box is sealed and safe. A dashed box is\n' +
        'open to space.\n\n' +
        'The hull monitor has to be running first, because that is the thing\n' +
        'that reads the compartments. Once it is, the map is drawn from the\n' +
        'files in /etc/hull every time you ask -- so if you change one and run\n' +
        '  deck  again, the picture changes too.',
      run: (ctx, _argv, io) => {
        if (!requireMonitor(ctx, io, 'deck')) return 1;
        // Read from the process table as well as the filesystem: a
        // compartment can be shut in /etc/hull and emptying anyway, and the
        // picture has to be able to say so or it is lying by omission.
        io.out(deckMap(ctx.vfs, { venting: ventingCompartments(ctx) }).join('\n') + '\n');
        return 0;
      },
    },
    {
      name: 'pressure',
      summary: 'plot hull pressure per compartment',
      preformatted: true,
      manual:
        'pressure\n\n' +
        'Plot ten days of /var/log/hull.log as one sparkline per compartment,\n' +
        'all nine on a shared axis so they can be compared. The latest reading\n' +
        'is printed beside each, and anything under 100 kPa is flagged.\n\n' +
        'Requires hull-monitor to be running. It reads the same log `grep`\n' +
        'does; it is faster to look at and worse at answering when, which is\n' +
        'why both exist.',
      plain:
        'Draws a little graph of hull pressure for each compartment, from the\n' +
        'readings in /var/log/hull.log.\n\n' +
        'A flat line near the top is a compartment that is fine. A line that\n' +
        'slides downward is one that is losing air.\n\n' +
        'The hull monitor has to be running first. It shows you the shape; to\n' +
        'find out exactly when something happened, you still want:\n' +
        '  grep C7 /var/log/hull.log',
      run: (ctx, _argv, io) => {
        if (!requireMonitor(ctx, io, 'pressure')) return 1;
        io.out(pressurePanel(ctx.vfs).join('\n') + '\n');
        return 0;
      },
    },
  ];
}
