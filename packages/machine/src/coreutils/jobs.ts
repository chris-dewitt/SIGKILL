import { CRONTAB, parseCrontab } from '../proc/cron.js';
import type { CommandSpec } from '../shell/exec.js';
import { ROOT_USER } from '../vfs/vfs.js';
import { emit, parseArgs, usage } from './helpers.js';

/** Parse `30`, `1m`, `2h`, `0.5` the way GNU sleep does. */
function parseDuration(text: string): number | undefined {
  const m = /^(\d+(?:\.\d+)?)([smhd]?)$/.exec(text);
  if (!m) return undefined;
  const value = Number(m[1]);
  const unit = m[2] ?? '';
  const scale = unit === 'm' ? 60 : unit === 'h' ? 3600 : unit === 'd' ? 86400 : 1;
  return value * scale * 1000;
}

export const jobCommands: CommandSpec[] = [
  {
    name: 'sleep',
    summary: 'wait for a duration',
    manual:
      'Pause for NUMBER seconds. A suffix of s, m, h or d selects the unit.\n' +
      'In the background (`sleep 30 &`) the job completes at that future time\n' +
      'rather than holding the shell.',
    plain:
      'Waits. On this machine time only moves when something moves it, so\n' +
      'sleep is how you make the clock advance -- useful when you are waiting\n' +
      'for something scheduled to happen.',
    run: async (ctx, argv, io) => {
      const { operands } = parseArgs(argv);
      if (operands.length === 0) return usage(io, 'usage: sleep NUMBER[smhd]');

      let total = 0;
      for (const operand of operands) {
        const ms = parseDuration(operand);
        if (ms === undefined) {
          io.err(`sleep: invalid time interval '${operand}'\n`);
          return 1;
        }
        total += ms;
      }

      // Backgrounded: book a completion instead of moving the clock. This is
      // the whole difference between `sleep 30` and `sleep 30 &` here.
      if (ctx.backgroundJob) {
        ctx.backgroundJob.completesAt = ctx.clock() + total;
        return 0;
      }

      await ctx.advance(total);
      return 0;
    },
  },

  {
    name: 'jobs',
    summary: 'list background jobs',
    manual: 'List this session\'s background jobs, their state and command.',
    plain:
      'Shows what you started with & and whether it has finished yet.\n' +
      'Each job has a number; wait uses it.',
    run: (ctx, _argv, io) => {
      ctx.jobs.settle(ctx.clock());
      const all = ctx.jobs.list();
      if (all.length === 0) return 0;

      emit(
        io,
        all.map((job) => {
          const state =
            job.state === 'running'
              ? 'Running'
              : job.exitCode === 0
                ? 'Done'
                : `Exit ${job.exitCode}`;
          return `[${job.id}]  ${state.padEnd(9)} ${job.command}`;
        }),
      );

      // Reporting a finished job is what retires it, as in a real shell.
      for (const job of ctx.jobs.reap()) {
        if (job.stdout) io.out(job.stdout);
        if (job.stderr) io.err(job.stderr);
      }
      return 0;
    },
  },

  {
    name: 'wait',
    summary: 'wait for background jobs to finish',
    manual:
      'Wait for background jobs to complete and report their output.\n' +
      'With no operand, waits for all of them.',
    plain:
      'Waits until the things you started with & have finished, then shows\n' +
      'whatever they printed.',
    run: async (ctx, argv, io) => {
      const { operands } = parseArgs(argv);

      const targets = operands.length > 0
        ? operands.map((o) => ctx.jobs.get(Number(o.replace('%', ''))))
        : ctx.jobs.running();

      for (const [index, job] of targets.entries()) {
        if (!job) {
          io.err(`wait: ${operands[index]}: no such job\n`);
          return 127;
        }
      }

      const deadline = targets
        .filter((j): j is NonNullable<typeof j> => j !== undefined)
        .reduce((latest, j) => Math.max(latest, j.completesAt), ctx.clock());

      if (deadline > ctx.clock()) await ctx.advance(deadline - ctx.clock());
      ctx.jobs.settle(ctx.clock());

      let code = 0;
      for (const job of ctx.jobs.reap()) {
        if (job.stdout) io.out(job.stdout);
        if (job.stderr) io.err(job.stderr);
        if (job.exitCode !== undefined && job.exitCode !== 0) code = job.exitCode;
      }
      return code;
    },
  },

  {
    name: 'crontab',
    summary: 'show the scheduled command table',
    manual:
      'Operate on the cron table.\n' +
      '  -l   list the entries in /etc/crontab\n' +
      'Each line is: minute hour day-of-month month day-of-week user command\n' +
      'Fields accept *, a value, a-b ranges, a,b lists and /step.',
    plain:
      'Shows the jobs the machine runs on a schedule, and when.\n' +
      '  crontab -l\n' +
      'The five numbers at the front of each line are minute, hour, day of\n' +
      'month, month, and day of week. A * means "every".',
    run: (ctx, argv, io) => {
      const { flags } = parseArgs(argv);
      if (!flags.has('-l') && flags.size > 0) {
        return usage(io, 'crontab: only -l is supported');
      }

      let text: string;
      try {
        text = ctx.vfs.readText(CRONTAB, ROOT_USER);
      } catch {
        io.err(`crontab: cannot read ${CRONTAB}: No such file or directory\n`);
        return 1;
      }

      const entries = parseCrontab(text);
      if (entries.length === 0) {
        io.out('no crontab entries\n');
        return 0;
      }
      emit(io, entries.map((e) => e.source));
      return 0;
    },
  },
];
