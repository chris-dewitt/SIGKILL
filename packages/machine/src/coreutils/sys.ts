import { execArgv, type CommandSpec, type ShellContext } from '../shell/exec.js';
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

/**
 * The adventure's own calendar, as a Date.
 *
 * Built from the epoch plus the virtual clock and nothing else -- never
 * `new Date()`. `date` run twice at the same tick gives the same answer on
 * every machine, which is what lets a whole playthrough be replayed in CI.
 */
function shipTime(ctx: ShellContext): Date {
  return new Date(ctx.epoch + ctx.clock());
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const pad = (n: number): string => String(n).padStart(2, '0');

export const sysCommands: CommandSpec[] = [
  {
    name: 'date',
    summary: 'print the date and time',
    manual:
      'date [+FORMAT]\n\n' +
      'Print the current date and time. With a leading +, print it in the\n' +
      'given format: %Y %m %d %H %M %S %j %s, and %% for a literal percent.\n\n' +
      "This clock is the ship's, not yours. It moves when the ship's time\n" +
      'moves -- `sleep 60` advances it by a minute -- and never otherwise.',
    plain:
      'Shows the date and time aboard the ship.\n' +
      'It is not the time where you are. It only moves when ship time moves.\n' +
      '  date            the whole thing\n' +
      '  date +%H:%M     just the hour and minute',
    run: (ctx, argv, io) => {
      const now = shipTime(ctx);
      const format = argv.slice(1).find((a) => a.startsWith('+'));

      if (format) {
        const seconds = Math.floor((ctx.epoch + ctx.clock()) / 1000);
        const startOfYear = Date.UTC(now.getUTCFullYear(), 0, 0);
        const dayOfYear = Math.floor((now.getTime() - startOfYear) / 86_400_000);
        const out = format.slice(1).replace(/%(.)/g, (whole, code: string) => {
          switch (code) {
            case 'Y': return String(now.getUTCFullYear());
            case 'm': return pad(now.getUTCMonth() + 1);
            case 'd': return pad(now.getUTCDate());
            case 'H': return pad(now.getUTCHours());
            case 'M': return pad(now.getUTCMinutes());
            case 'S': return pad(now.getUTCSeconds());
            case 'j': return String(dayOfYear).padStart(3, '0');
            case 's': return String(seconds);
            case '%': return '%';
            default: return whole;
          }
        });
        io.out(out + '\n');
        return 0;
      }

      io.out(
        `${DAYS[now.getUTCDay()]} ${MONTHS[now.getUTCMonth()]} ${pad(now.getUTCDate())} ` +
          `${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}:${pad(now.getUTCSeconds())} ` +
          `UTC ${now.getUTCFullYear()}\n`,
      );
      return 0;
    },
  },

  {
    name: 'uname',
    summary: 'print system information',
    manual:
      'uname [-asnrm]\n\n' +
      '  -s  kernel name (the default)    -n  hostname\n' +
      '  -r  release                      -m  machine\n' +
      '  -a  all of it',
    plain: 'Says what kind of machine this is. `uname -a` prints everything it knows.',
    run: (ctx, argv, io) => {
      const { flags } = parseArgs(argv, { flags: ['-a', '-s', '-n', '-r', '-m'] });
      const all = flags.has('-a');
      const parts: string[] = [];
      if (all || flags.has('-s') || flags.size === 0) parts.push('NAV-OS');
      if (all || flags.has('-n')) parts.push(ctx.hostname);
      if (all || flags.has('-r')) parts.push('2.3.1-degraded');
      if (all || flags.has('-m')) parts.push('mk4');
      io.out(parts.join(' ') + '\n');
      return 0;
    },
  },

  {
    name: 'df',
    summary: 'report filesystem disk space',
    manual: 'df [-h]\n\nShow space on the mounted filesystems. -h for human-readable sizes.',
    plain: 'Shows how full the disk is. Add -h to get sizes you can read at a glance.',
    run: (ctx, argv, io) => {
      const { flags } = parseArgs(argv, { flags: ['-h'] });
      const human = flags.has('-h');

      // Measured, not invented: walking the tree keeps this honest as the
      // player writes files, and a made-up number would be the one piece of
      // furniture in here that does not respond to anything.
      let used = 0;
      const walk = (path: string): void => {
        let entries: string[];
        try {
          entries = ctx.vfs.readdir(path, ROOT_USER);
        } catch {
          return;
        }
        for (const entry of entries) {
          const full = path === '/' ? `/${entry}` : `${path}/${entry}`;
          try {
            const stat = ctx.vfs.lstat(full, ROOT_USER);
            if (stat.kind === 'dir') walk(full);
            else used += stat.size;
          } catch {
            // A node that vanished mid-walk is simply not counted.
          }
        }
      };
      walk('/');

      const total = 64 * 1024 * 1024;
      const fmt = (bytes: number): string =>
        human
          ? bytes >= 1024 * 1024
            ? `${(bytes / 1024 / 1024).toFixed(1)}M`
            : `${Math.max(1, Math.round(bytes / 1024))}K`
          : String(Math.ceil(bytes / 1024));

      const percent = Math.min(100, Math.round((used / total) * 100));
      emit(io, [
        'Filesystem      Size  Used Avail Use% Mounted on',
        `/dev/nav0       ${fmt(total).padStart(4)}  ${fmt(used).padStart(4)} ` +
          `${fmt(total - used).padStart(5)} ${String(percent).padStart(3)}% /`,
      ]);
      return 0;
    },
  },

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
    manual:
      'id\n' +
      '\n' +
      'Print the current user\'s uid, gid and group membership. Which account you\n' +
      'are is the answer to most permission questions, and it changes under\n' +
      'sudo.',
    plain:
      'Says who the ship thinks you are, and which groups you belong to. That\n' +
      'is what decides which files you are allowed to touch.',
    run: (ctx, _argv, io) => {
      io.out(`uid=${ctx.user.uid}(${ctx.user.name}) gid=${ctx.user.gid}\n`);
      return 0;
    },
  },

  {
    name: 'hostname',
    summary: 'print the machine name',
    manual:
      'hostname\n' +
      '\n' +
      'Print the name of this machine. Worth checking before you change\n' +
      'something, on any night where more than one machine is reachable.',
    plain:
      'Prints the name of the computer you are on. This one is nav7.',
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
    manual:
      'export NAME=VALUE\n' +
      '\n' +
      'Set an environment variable so commands started afterwards inherit it.\n' +
      '\n' +
      '  export EDITOR=vi\n' +
      '  export PATH=$PATH:/home/survivor/bin\n' +
      '\n' +
      'Without export, an assignment is only known to this shell. With it, it\n' +
      'reaches everything this shell runs.',
    plain:
      'Sets a setting that other commands can see.\n' +
      '\n' +
      '  export EDITOR=vi\n' +
      '\n' +
      'The shell keeps a small list of these; `env` prints all of them. PATH is\n' +
      'the important one -- it is the list of directories the shell searches\n' +
      'when you type a command name.',
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
    manual:
      'unset NAME...\n' +
      '\n' +
      'Remove a variable from the environment. Not the same as setting it empty:\n' +
      'some programs check whether a name exists at all.',
    plain:
      'Forgets a setting you had set.\n' +
      '\n' +
      '  unset EDITOR',
    run: (ctx, argv) => {
      for (const name of argv.slice(1)) delete ctx.env[name];
      return 0;
    },
  },

  {
    name: 'which',
    summary: 'locate a command',
    manual:
      'which NAME...\n' +
      '\n' +
      'Print where a command comes from, or report that nothing by that name is\n' +
      'known. First thing to try when a command "does not work" -- it may simply\n' +
      'not be aboard.',
    plain:
      'Tells you whether a command exists on this machine, and where it lives.\n' +
      '\n' +
      '  which grep',
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

  {
    name: 'true',
    summary: 'do nothing, successfully',
    manual:
      'true\n\n' +
      'Exit with status 0 and do nothing else.\n\n' +
      'Useful on the left of `&&`, and for standing in for a command while\n' +
      'you work out what the command should be.',
    plain:
      'Does nothing, and reports that it worked.\n\n' +
      'Every command finishes with a number: 0 means it worked, anything else\n' +
      'means it did not. `echo $?` shows the last one. true is the command\n' +
      'that always says 0, which makes it handy for testing.',
    run: () => 0,
  },
  {
    name: 'false',
    summary: 'do nothing, unsuccessfully',
    manual:
      'false\n\n' +
      'Exit with status 1 and do nothing else. The counterpart to true, and\n' +
      'the shortest way to see what `||` does.',
    plain:
      'Does nothing, and reports that it failed.\n\n' +
      'The opposite of true. `false || echo nope` prints nope, because || runs\n' +
      'the right hand side only when the left hand side failed.',
    run: () => 1,
  },

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
    manual:
      'clear\n' +
      '\n' +
      'Clear the screen. Scrollback is not the same thing as state: nothing that\n' +
      'has happened is undone by this.',
    plain:
      'Wipes the screen clean. Nothing else changes -- it just gives you an\n' +
      'empty page to work on.',
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
    run: async (ctx, argv, io) => {
      const rest = argv.slice(1);
      if (rest.length === 0) return usage(io, 'usage: sudo command [args]');

      if (!isSudoer(ctx, ctx.user.name)) {
        io.err(`${ctx.user.name} is not in the sudoers file. This incident has been reported.\n`);
        return 1;
      }

      /*
       * Swap identity for exactly one command, then put it back even if the
       * command throws. Everything downstream reads ctx.user, so the VFS
       * permission checks see root without any special-casing.
       *
       * Dispatch goes through the shell rather than the command table, so
       * `sudo ./seal.sh` runs the script -- root is allowed to run a great
       * many things that are not builtins, and saying "command not found" for
       * a file that is plainly there teaches the player something false.
       */
      const original = ctx.user;
      ctx.user = { uid: 0, gid: 0, name: 'root' };
      try {
        return await execArgv(ctx, rest, io);
      } finally {
        ctx.user = original;
      }
    },
  },

  {
    name: 'help',
    summary: 'list available commands',
    manual:
      'help\n' +
      '\n' +
      'List every command aboard with its one-line summary. For any one of them\n' +
      'in detail:  man COMMAND',
    plain:
      'Lists every command this machine has, with one line on what each does.\n' +
      'For more on one of them, type  man  and its name.',
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
    manual:
      'man COMMAND\n' +
      '\n' +
      'Show the manual for a command: what it does, how it is called, and which\n' +
      'options it takes.\n' +
      '\n' +
      'This is the first thing to reach for and the last habit anyone picks up.\n' +
      'A manual page is written by the person who wrote the command, which makes\n' +
      'it a better source than memory and a much better one than guessing.',
    plain:
      'Explains a command.\n' +
      '\n' +
      '  man ls          what ls does\n' +
      '  man systemctl   what systemctl does\n' +
      '\n' +
      'If you do not know how something works, this is where to look before you\n' +
      'try anything. Every command aboard has a page. Type  help  to see the\n' +
      'list of them.',
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
