import type { CommandSpec } from '../shell/exec.js';
import { emit, parseArgs, usage } from './helpers.js';

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
    run: (ctx, argv) => {
      const code = Number(argv[1] ?? 0);
      ctx.exited = Number.isFinite(code) ? code : 0;
      return ctx.exited;
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
