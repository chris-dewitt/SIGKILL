import type { CommandSpec, ShellContext } from '../shell/exec.js';
import { ROOT_USER } from '../vfs/vfs.js';
import { emit, parseArgs, usage } from './helpers.js';

/**
 * Is this user allowed to use sudo?
 *
 * Reads /etc/sudoers the way the real thing does, matching `name ALL=...`
 * lines and `%group` entries. A missing sudoers file means nobody but root,
 * which is the safe direction to fail.
 */
function isSudoer(ctx: ShellContext, name: string): boolean {
  if (ctx.user.uid === 0) return true;
  let text: string;
  try {
    text = ctx.vfs.readText('/etc/sudoers', ROOT_USER);
  } catch {
    return false;
  }
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .some((line) => {
      const subject = line.split(/\s+/)[0];
      return subject === name || subject === `%${name}`;
    });
}

export const sysCommands: CommandSpec[] = [
  {
    name: 'whoami',
    summary: 'print the current user name',
    manual: 'Print the effective user name.',
    plain: 'Prints who the system thinks you are right now.',
    run: (ctx, _argv, io) => {
      io.out(ctx.user.name + '\n');
      return 0;
    },
  },

  {
    name: 'id',
    summary: 'print user and group ids',
    run: (ctx, _argv, io) => {
      io.out(`uid=${ctx.user.uid}(${ctx.user.name}) gid=${ctx.user.gid}\n`);
      return 0;
    },
  },

  {
    name: 'hostname',
    summary: 'print the machine name',
    run: (ctx, _argv, io) => {
      io.out(ctx.hostname + '\n');
      return 0;
    },
  },

  {
    name: 'env',
    summary: 'print the environment',
    manual: 'Print the environment, one NAME=VALUE pair per line.',
    plain:
      'Shows the named values this shell carries around -- where your home\n' +
      'directory is, who you are logged in as, that sort of thing.',
    run: (ctx, _argv, io) => {
      emit(
        io,
        Object.entries(ctx.env)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => `${k}=${v}`),
      );
      return 0;
    },
  },

  {
    name: 'export',
    summary: 'set an environment variable',
    run: (ctx, argv, io) => {
      const args = argv.slice(1);
      if (args.length === 0) {
        emit(
          io,
          Object.entries(ctx.env)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => `declare -x ${k}="${v}"`),
        );
        return 0;
      }
      for (const arg of args) {
        const eq = arg.indexOf('=');
        if (eq < 0) continue;
        ctx.env[arg.slice(0, eq)] = arg.slice(eq + 1);
      }
      return 0;
    },
  },

  {
    name: 'unset',
    summary: 'remove an environment variable',
    run: (ctx, argv) => {
      for (const name of argv.slice(1)) delete ctx.env[name];
      return 0;
    },
  },

  {
    name: 'which',
    summary: 'locate a command',
    run: (ctx, argv, io) => {
      const { operands } = parseArgs(argv);
      let code = 0;
      for (const operand of operands) {
        if (ctx.commands.has(operand)) {
          io.out(`/usr/bin/${operand}\n`);
        } else {
          io.err(`which: no ${operand} in (${ctx.env['PATH']})\n`);
          code = 1;
        }
      }
      return code;
    },
  },

  { name: 'true', summary: 'do nothing, successfully', run: () => 0 },
  { name: 'false', summary: 'do nothing, unsuccessfully', run: () => 1 },

  {
    name: 'exit',
    summary: 'close the session',
    manual:
      'Close the current shell. Inside an ssh session this returns you to the\n' +
      'machine you came from rather than ending anything.',
    plain:
      'Leaves the current shell. If you are logged into another machine over\n' +
      'ssh, this brings you back to your own.',
    run: (ctx, argv, io) => {
      const code = Number(argv[1] ?? 0);
      const status = Number.isFinite(code) ? code : 0;

      // Walking back out of an ssh hop is not the same as ending the session.
      if (ctx.session && ctx.session.stack.length > 0) {
        ctx.session.stack.pop();
        io.out('logout\n');
        return status;
      }

      ctx.exited = status;
      return status;
    },
  },

  {
    name: 'clear',
    summary: 'clear the screen',
    // The Machine has no screen and emits no escape codes. It raises a flag and
    // lets whatever is rendering it decide what clearing means.
    run: (ctx) => {
      ctx.clearRequested = true;
      return 0;
    },
  },

  {
    name: 'sudo',
    summary: 'run a command as root',
    manual:
      'Execute a command as the superuser.\n' +
      'Permitted users are listed in /etc/sudoers. There is no password\n' +
      'prompt on this machine; authorisation is the sudoers file alone.',
    plain:
      'Runs one command with full privileges, for things an ordinary user is\n' +
      "not allowed to do. Put sudo in front of the command:\n" +
      '  sudo systemctl start scrubber\n' +
      'You can only do this if /etc/sudoers says you can.',
    run: (ctx, argv, io) => {
      const rest = argv.slice(1);
      if (rest.length === 0) return usage(io, 'usage: sudo command [args]');

      if (!isSudoer(ctx, ctx.user.name)) {
        io.err(`${ctx.user.name} is not in the sudoers file. This incident has been reported.\n`);
        return 1;
      }

      const spec = ctx.commands.get(rest[0]!);
      if (!spec) {
        io.err(`sudo: ${rest[0]}: command not found\n`);
        return 127;
      }

      // Swap identity for exactly one command, then put it back even if the
      // command throws. Everything downstream reads ctx.user, so the VFS
      // permission checks see root without any special-casing.
      const original = ctx.user;
      ctx.user = { uid: 0, gid: 0, name: 'root' };
      try {
        return spec.run(ctx, rest, io);
      } finally {
        ctx.user = original;
      }
    },
  },

  {
    name: 'help',
    summary: 'list available commands',
    run: (ctx, _argv, io) => {
      const specs = [...ctx.commands.values()].sort((a, b) => a.name.localeCompare(b.name));
      const width = Math.max(...specs.map((c) => c.name.length));
      emit(io, [
        'Available commands:',
        '',
        ...specs.map((c) => `  ${c.name.padEnd(width)}  ${c.summary}`),
        '',
        "Try 'man COMMAND' for more on any of them.",
      ]);
      return 0;
    },
  },

  {
    name: 'man',
    summary: 'show the manual for a command',
    run: (ctx, argv, io) => {
      const { operands } = parseArgs(argv);
      const name = operands[0];
      if (!name) return usage(io, 'What manual page do you want?');
      const spec = ctx.commands.get(name);
      if (!spec) {
        io.err(`No manual entry for ${name}\n`);
        return 1;
      }
      // Cadets get the plain rewrite. Operators get the real register, terse as it is.
      const body = ctx.track === 'cadet' ? (spec.plain ?? spec.manual) : (spec.manual ?? spec.plain);
      emit(io, [
        `${spec.name.toUpperCase()}(1)`,
        '',
        'NAME',
        `    ${spec.name} - ${spec.summary}`,
        ...(body ? ['', 'DESCRIPTION', ...body.trim().split('\n').map((l) => `    ${l}`)] : []),
      ]);
      return 0;
    },
  },
];
