import type { CommandSpec } from '../shell/exec.js';
import { listUnits } from '../proc/units.js';
import { emit, parseArgs, usage } from './helpers.js';

/** Render virtual-clock milliseconds as the H:MM:SS that `ps` shows. */
function elapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
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
      '  -9, -KILL   SIGKILL. Cannot be caught, blocked, or ignored.\n' +
      '  -15, -TERM  SIGTERM. Asks the process to stop.',
    plain:
      'Stops a running program. You need its PID, which ps will tell you.\n' +
      'kill -9 is the one that cannot be refused.',
    run: (ctx, argv, io) => {
      const args = argv.slice(1);
      let signal = 15;
      const pids: string[] = [];

      for (const arg of args) {
        const named = /^-(?:SIG)?([A-Z]+)$/.exec(arg);
        if (named) {
          const name = named[1]!;
          signal = name === 'KILL' ? 9 : name === 'TERM' ? 15 : name === 'HUP' ? 1 : 15;
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
        // with a dangling pid — which is what makes `systemctl status` honest
        // after someone kills the process behind its back.
        if (process.unit) ctx.services.stop(process.unit);
        else ctx.procs.kill(pid, signal);
      }
      return code;
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
      '  list-units      show every known unit',
    plain:
      'Starts and stops the services the machine runs in the background.\n' +
      "  systemctl start NAME    turn it on now\n" +
      "  systemctl status NAME   is it running, and if not, why not\n" +
      "  systemctl enable NAME   turn it on automatically at boot\n" +
      'If a service will not start, status tells you the reason. Read it.',
    run: (ctx, argv, io) => {
      const { operands } = parseArgs(argv);
      const verb = operands[0];
      const target = operands[1];

      if (!verb || verb === 'list-units' || verb === 'list-unit-files') {
        const units = ctx.services.list();
        if (units.length === 0) {
          io.out('0 loaded units listed.\n');
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
