import type { CommandSpec } from '../shell/exec.js';
import { SIGKILL, SIGTERM, type Process } from '../proc/types.js';
import type { ShellContext } from '../shell/exec.js';
import { emit, parseArgs, usage } from './helpers.js';

/**
 * The signals `kill` will name.
 *
 * Deliberately the short list. A player needs to know that signals have names
 * as well as numbers, that TERM is the polite one and KILL is not, and that
 * the number after the dash is the same thing as the name -- not that there
 * are sixty-four of them.
 */
const SIGNALS: Readonly<Record<string, number>> = {
  HUP: 1,
  INT: 2,
  QUIT: 3,
  KILL: SIGKILL,
  USR1: 10,
  USR2: 12,
  TERM: 15,
  CONT: 18,
  STOP: 19,
};

/** Render virtual-clock milliseconds as the H:MM:SS that `ps` shows. */
function elapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * Processes whose name matches, the way pgrep and pkill both mean it.
 *
 * Substring rather than a regular expression: the pattern a player types is
 * `purge`, and making them learn a second language to find a pid would be
 * teaching the wrong thing at the wrong moment.
 */
function match(ctx: ShellContext, pattern: string, full: boolean): Process[] {
  return ctx.procs.list().filter((p) => {
    const name = (p.argv[0] ?? '').split('/').pop() ?? '';
    return (full ? p.argv.join(' ') : name).includes(pattern);
  });
}

export const procCommands: CommandSpec[] = [
  {
    name: 'ps',
    summary: 'report running processes',
    manual:
      'Report a snapshot of the current processes.\n' +
      '  -e, -A   every process\n' +
      '  -f       full format, including the command line',
    plain:
      'Lists what the machine is currently running. Each line is one program.\n' +
      'The PID is its number -- you need that to stop it with kill.',
    run: (ctx, argv, io) => {
      const { flags } = parseArgs(argv);
      const full = flags.has('-f');
      const all = flags.has('-e') || flags.has('-A') || full;
      const rows = ctx.procs
        .list()
        .filter((p) => all || p.uid === ctx.user.uid);

      const header = full
        ? 'UID        PID  PPID  STIME     TIME CMD'
        : '  PID     TIME CMD';

      emit(io, [
        header,
        ...rows.map((p) =>
          full
            ? `${String(p.uid).padEnd(6)} ${String(p.pid).padStart(5)} ${String(p.ppid).padStart(5)} ` +
              `${elapsed(p.startedAt).padStart(8)} ${elapsed(ctx.clock() - p.startedAt).padStart(8)} ${p.argv.join(' ')}`
            : `${String(p.pid).padStart(5)} ${elapsed(ctx.clock() - p.startedAt).padStart(8)} ${p.argv[0] ?? ''}`,
        ),
      ]);
      return 0;
    },
  },

  {
    name: 'kill',
    summary: 'send a signal to a process',
    manual:
      'Send a signal to a process by pid. Default is TERM (15).\n' +
      '  -l          list the signal names this machine knows\n' +
      '  -9, -KILL   SIGKILL. Cannot be caught, blocked, or ignored.\n' +
      '  -15, -TERM  SIGTERM. Asks the process to stop.\n\n' +
      'A signal is a message, not a guarantee. A program may install a\n' +
      'handler for TERM and decide for itself what to do about it, and kill\n' +
      'still exits 0 -- it reports that the signal was delivered, not that\n' +
      'anybody acted on it. If the process is still listed afterwards, it\n' +
      'caught the signal. SIGKILL is the exception: it is handled by the\n' +
      'kernel rather than by the program, so there is nothing to install a\n' +
      'handler in.',
    plain:
      'Stops a running program. You need its PID, which ps will tell you.\n\n' +
      '    kill 412       ask it to stop\n' +
      '    kill -9 412    make it stop\n\n' +
      'The first one is a request. A program is allowed to catch it and keep\n' +
      'going, and kill will not tell you that happened -- run ps again and\n' +
      'see whether it is still there.\n\n' +
      'kill -9 is the one that cannot be refused. Nothing gets to argue with\n' +
      'it, which is also why it is the second thing you try and not the first:\n' +
      'a program killed that way never gets to finish or tidy up.',
    run: (ctx, argv, io) => {
      const args = argv.slice(1);
      let signal = 15;
      const pids: string[] = [];

      // `kill -l` is how anybody finds out what the numbers are called
      // without a manual, and it is one line of code.
      if (args.includes('-l')) {
        emit(
          io,
          Object.entries(SIGNALS).map(([name, number]) => `${String(number).padStart(2)}) SIG${name}`),
        );
        return 0;
      }

      for (const arg of args) {
        const named = /^-(?:SIG)?([A-Za-z]+)$/.exec(arg);
        if (named) {
          const name = named[1]!.toUpperCase();
          const known = SIGNALS[name];
          if (known === undefined) {
            io.err(`kill: ${arg}: invalid signal specification\n`);
            return 1;
          }
          signal = known;
          continue;
        }
        const numbered = /^-(\d+)$/.exec(arg);
        if (numbered) {
          signal = Number(numbered[1]);
          continue;
        }
        pids.push(arg);
      }

      if (pids.length === 0) return usage(io, 'usage: kill [-signal] pid ...');

      let code = 0;
      for (const raw of pids) {
        const pid = Number(raw);
        if (!Number.isInteger(pid)) {
          io.err(`kill: ${raw}: arguments must be process ids\n`);
          code = 1;
          continue;
        }
        const process = ctx.procs.get(pid);
        if (!process) {
          io.err(`kill: (${pid}) - No such process\n`);
          code = 1;
          continue;
        }
        if (ctx.user.uid !== 0 && process.uid !== ctx.user.uid) {
          io.err(`kill: (${pid}) - Operation not permitted\n`);
          code = 1;
          continue;
        }
        // A unit's process going away leaves the unit inactive, not active
        // with a dangling pid -- which is what makes `systemctl status`
        // honest after someone kills the process behind its back.
        if (process.unit) ctx.services.stop(process.unit);
        // Nothing is printed either way. `kill` reports delivery, and a
        // process that caught the signal is still in the table for `ps` to
        // find. Saying so here would hand over the whole lesson.
        else ctx.procs.signal(pid, signal);
      }
      return code;
    },
  },

  {
    name: 'pgrep',
    summary: 'find the pids of processes by name',
    manual:
      'pgrep [-f] PATTERN\n\n' +
      'Print the process id of every process whose name matches PATTERN.\n' +
      '  -f   match against the whole command line, not just the program name\n\n' +
      'Exits 1 when nothing matched, so it can be tested in a script. The\n' +
      'usual use is to feed kill:  kill -9 $(pgrep thing)',
    plain:
      'Finds the PID of a program by its name, so you do not have to read it\n' +
      'out of ps by eye.\n\n' +
      '    pgrep scrubber\n\n' +
      'Prints one number per matching program. Nothing printed means nothing\n' +
      'matched.',
    run: (ctx, argv, io) => {
      const args = argv.slice(1);
      const full = args.includes('-f');
      const pattern = args.find((arg) => !arg.startsWith('-'));
      if (pattern === undefined) return usage(io, 'usage: pgrep [-f] pattern');
      const found = match(ctx, pattern, full);
      emit(io, found.map((p) => String(p.pid)));
      return found.length > 0 ? 0 : 1;
    },
  },

  {
    name: 'pkill',
    summary: 'signal processes by name',
    manual:
      'pkill [-signal] [-f] PATTERN\n\n' +
      'Send a signal to every process whose name matches PATTERN. Default is\n' +
      'TERM, and every caveat on `man kill` applies here too: a program may\n' +
      'catch TERM and carry on, and this will still exit 0.\n\n' +
      '  -f   match against the whole command line, not just the program name\n\n' +
      'Exits 1 when nothing matched.',
    plain:
      'Like kill, but you name the program instead of looking up its number.\n\n' +
      '    pkill atmo-purge       ask it to stop\n' +
      '    pkill -9 atmo-purge    make it stop\n\n' +
      'Same rule as kill: the first one is a request and a program is allowed\n' +
      'to ignore it. Check with ps afterwards.',
    run: (ctx, argv, io) => {
      // Parsed by hand rather than with parseArgs, for the same reason `kill`
      // is: `-KILL` is one signal name and not a cluster of four short flags.
      let signal = SIGTERM;
      let full = false;
      let pattern: string | undefined;

      for (const arg of argv.slice(1)) {
        if (arg === '-f') { full = true; continue; }
        const numbered = /^-(\d+)$/.exec(arg);
        if (numbered) { signal = Number(numbered[1]); continue; }
        const named = /^-(?:SIG)?([A-Za-z]+)$/.exec(arg);
        if (named) {
          const known = SIGNALS[named[1]!.toUpperCase()];
          if (known === undefined) {
            io.err(`pkill: ${arg}: invalid signal specification\n`);
            return 1;
          }
          signal = known;
          continue;
        }
        if (pattern === undefined) pattern = arg;
      }

      if (pattern === undefined) return usage(io, 'usage: pkill [-signal] [-f] pattern');

      const found = match(ctx, pattern, full);
      let signalled = 0;
      for (const process of found) {
        if (ctx.user.uid !== 0 && process.uid !== ctx.user.uid) {
          io.err(`pkill: (${process.pid}) - Operation not permitted\n`);
          continue;
        }
        if (process.unit) ctx.services.stop(process.unit);
        else ctx.procs.signal(process.pid, signal);
        signalled++;
      }
      return signalled > 0 ? 0 : 1;
    },
  },

  {
    name: 'systemctl',
    summary: 'control system services',
    manual:
      'Control the service manager.\n' +
      '  start UNIT      start a unit now\n' +
      '  stop UNIT       stop it\n' +
      '  restart UNIT    stop then start\n' +
      '  status UNIT     show state, and why it failed if it did\n' +
      '  enable UNIT     start it at boot (creates a symlink in\n' +
      '                  /etc/systemd/system/multi-user.target.wants)\n' +
      '  disable UNIT    remove that symlink\n' +
      '  list-units      show every known unit\n' +
      '  --failed        show only the units that failed',
    plain:
      'Starts and stops the services the machine runs in the background.\n' +
      "  systemctl start NAME    turn it on now\n" +
      "  systemctl status NAME   is it running, and if not, why not\n" +
      "  systemctl enable NAME   turn it on automatically at boot\n" +
      "  systemctl --failed      list only what is broken\n" +
      'If a service will not start, status tells you the reason. Read it.',
    run: (ctx, argv, io) => {
      const { flags, operands } = parseArgs(argv);
      const verb = operands[0];
      const target = operands[1];
      // `systemctl --failed` is how anybody who has run a real machine asks
      // "what is broken", and on a ship with two dead units it is the right
      // first question. It narrows the listing; it is not a verb of its own.
      const onlyFailed = flags.has('--failed');

      if (!verb || verb === 'list-units' || verb === 'list-unit-files') {
        const all = ctx.services.list();
        const units = onlyFailed ? all.filter((u) => u.state === 'failed') : all;
        if (units.length === 0) {
          io.out(onlyFailed ? '0 loaded units listed. Nothing has failed.\n' : '0 loaded units listed.\n');
          return 0;
        }
        const width = Math.max(...units.map((u) => u.name.length + 8));
        emit(io, [
          `${'UNIT'.padEnd(width)} STATE     ENABLED   DESCRIPTION`,
          ...units.map(
            (u) =>
              `${`${u.name}.service`.padEnd(width)} ${u.state.padEnd(9)} ` +
              `${(u.enabled ? 'enabled' : 'disabled').padEnd(9)} ${u.description}`,
          ),
          '',
          `${units.length} loaded units listed.`,
          // A bare `systemctl` is where somebody lands when they know the word
          // and not the verb. Real systemctl leaves them there; this is a
          // teaching game, so it points at the manual rather than at a hint.
          ...(verb || onlyFailed ? [] : ['', 'For what you can do with a unit:  man systemctl']),
          ...(onlyFailed ? ['', 'Ask one of them why:  systemctl status <unit>'] : []),
        ]);
        return 0;
      }

      if (!target) return usage(io, `systemctl: ${verb} requires a unit name`);

      if (verb === 'status') {
        const status = ctx.services.get(target);
        if (!status) {
          io.err(`Unit ${target}.service could not be found.\n`);
          return 4;
        }
        const dot = status.state === 'active' ? '*' : status.state === 'failed' ? 'x' : 'o';
        const rows = [
          `${dot} ${status.name}.service - ${status.description}`,
          `     Loaded: loaded (${ctx.services.unitPath(status.name)}; ${status.enabled ? 'enabled' : 'disabled'})`,
          `     Active: ${status.state}${status.since !== undefined ? ` (since ${elapsed(status.since)})` : ''}`,
        ];
        if (status.pid !== undefined) rows.push(`   Main PID: ${status.pid}`);
        if (status.error) rows.push('', `      Error: ${status.error}`);

        // A failure is history and stays printed, but the player may have just
        // fixed the thing it complains about. Saying nothing here is how
        // somebody edits the config correctly, reads a stale error, and
        // concludes their edit did not work.
        if (status.state === 'failed') {
          const now = ctx.services.precheck(status.name);
          if (now.ok) {
            rows.push(
              '',
              '       Note: that failure is from the last attempt. The problem it',
              '             names is no longer there.',
              `             Try: sudo systemctl start ${status.name}`,
            );
          } else if (now.reason !== undefined && now.reason !== status.error) {
            rows.push('', `    Current: ${now.reason}`);
          }
        }
        emit(io, rows);
        // systemd exits non-zero when the unit is not active. Scripts rely on
        // it, and so can a puzzle.
        return status.state === 'active' ? 0 : 3;
      }

      const actions: Record<string, (name: string) => { ok: boolean; reason?: string }> = {
        start: (n) => ctx.services.start(n),
        stop: (n) => ctx.services.stop(n),
        restart: (n) => ctx.services.restart(n),
        enable: (n) => ctx.services.enable(n),
        disable: (n) => ctx.services.disable(n),
      };

      const action = actions[verb];
      if (!action) {
        // Caps lock is a real hazard on a phone keyboard, and `STATUS` looks
        // to a beginner like it should obviously work. Say what they meant
        // rather than only what they typed.
        const lower = verb.toLowerCase();
        const meant = lower !== verb && (lower === 'status' || lower in actions)
          ? `  Did you mean: systemctl ${lower} ${target}\n`
          : '';
        io.err(`systemctl: unknown command '${verb}'\n${meant}`);
        return 1;
      }

      if (ctx.user.uid !== 0 && verb !== 'status') {
        // Real systemd would prompt for authentication here. Refusing outright
        // is the honest simplification, and it makes sudo mean something.
        io.err(
          `Failed to ${verb} ${target}.service: Access denied\n` +
            'Hint: this operation requires root privileges.\n',
        );
        return 1;
      }

      const result = action(target);
      if (!result.ok) {
        io.err(`Job for ${target}.service failed: ${result.reason}\n`);
        io.err(`See 'systemctl status ${target}' for details.\n`);
        return 1;
      }
      return 0;
    },
  },
];
