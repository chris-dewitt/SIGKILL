import { commandRegistry } from './coreutils/index.js';
import { pythonCommands, type PythonRuntime } from './lang/python.js';
import type { Network, Session } from './net/network.js';
import { dueBetween } from './proc/cron.js';
import { JobTable } from './proc/jobs.js';
import { ServiceManager } from './proc/services.js';
import { ProcessTable } from './proc/table.js';
import type { Precondition, ProcSnapshot } from './proc/types.js';
import { run, ShellContext, type CommandSpec, type RunResult, type ScreenProgram, type Track } from './shell/exec.js';
import type { User, VfsSnapshot } from './vfs/types.js';
import { Vfs } from './vfs/vfs.js';

export interface MachineOptions {
  /** Hostname shown in the prompt. */
  hostname?: string;
  /** The logged-in user. Defaults to an unprivileged survivor. */
  user?: User;
  /** Seed an existing filesystem instead of an empty one. */
  snapshot?: VfsSnapshot;
  /** Adventure-specific commands layered on top of the standard set. */
  commands?: CommandSpec[];
  cwd?: string;
  env?: Record<string, string>;
  track?: Track;
  /** The internet this machine is attached to, if any. */
  network?: Network;
  /**
   * A real Python interpreter, supplied from outside so this package does not
   * depend on one. Absent means `python3` reports it is not installed, which
   * is a legitimate state for a machine to be in.
   */
  python?: PythonRuntime;
  /**
   * Shared session state. Pass the same object to every machine on a network
   * so that `ssh` from any of them pushes onto one stack.
   */
  session?: Session;
  /**
   * Wall-clock instant the virtual clock counts from, in ms since the Unix
   * epoch. Only cron cares, and only so that `0 3 * * *` means three in the
   * morning of the adventure's own calendar rather than of the player's.
   */
  epoch?: number;
}

export interface MachineSnapshot {
  version: 1;
  vfs: VfsSnapshot;
  proc: ProcSnapshot;
  jobs: ReturnType<JobTable['snapshot']>;
  cwd: string;
  env: Record<string, string>;
  status: number;
  clock: number;
  /**
   * The adventure's calendar origin.
   *
   * `date` makes this observable, so leaving it out of the snapshot meant a
   * restored save could report a different time from the one it was saved at
   * with the clock untouched -- which breaks the determinism the whole engine
   * rests on.
   */
  epoch: number;
}

const DEFAULT_USER: User = { uid: 1000, gid: 1000, name: 'survivor' };

/**
 * A virtual computer.
 *
 * This is the unit every adventure is built on: one Machine per host, so an
 * `ssh` into another node is simply another Machine with its own filesystem.
 */
export class Machine {
  readonly vfs: Vfs;
  readonly procs: ProcessTable;
  readonly services: ServiceManager;
  readonly jobs = new JobTable();
  readonly shell: ShellContext;
  readonly epoch: number;
  readonly session: Session;
  /** Swappable at runtime so the app can lazy-load the interpreter. */
  python: PythonRuntime | undefined;
  /** Virtual clock in milliseconds. Advanced explicitly, never by wall time. */
  private clock = 0;

  /** Guards cron against re-entering itself through a job that sleeps. */
  private cronRunning = false;

  constructor(opts: MachineOptions = {}) {
    const user = opts.user ?? DEFAULT_USER;
    const now = (): number => this.clock;
    this.epoch = opts.epoch ?? Date.UTC(2387, 2, 14);
    this.session = opts.session ?? { stack: [] };
    this.python = opts.python;

    this.vfs = opts.snapshot ? Vfs.restore(opts.snapshot, { now }) : new Vfs({ now });
    this.procs = new ProcessTable(now);
    this.services = new ServiceManager(this.vfs, this.procs, now);

    // pid 1. Every machine has one, and `ps` looks wrong without it.
    this.procs.spawn(['/sbin/init'], { uid: 0, ppid: 0 });

    this.shell = new ShellContext({
      vfs: this.vfs,
      procs: this.procs,
      services: this.services,
      jobs: this.jobs,
      clock: now,
      epoch: this.epoch,
      advance: (ms) => this.tick(ms),
      network: opts.network,
      session: this.session,
      user,
      hostname: opts.hostname ?? 'localhost',
      commands: commandRegistry([...pythonCommands(() => this.python), ...(opts.commands ?? [])]),
      cwd: opts.cwd,
      env: opts.env,
      track: opts.track,
    });
  }

  /**
   * The shell the player is actually typing into.
   *
   * Normally this machine's own. After `ssh`, the machine at the top of the
   * session stack — which is why the prompt and every command follow you
   * across the hop without anything being special-cased.
   */
  get active(): Machine {
    return this.session.stack[this.session.stack.length - 1] ?? this;
  }

  /** Run one command line. Returns captured output; never throws for user error. */
  async exec(
    input: string,
  ): Promise<RunResult & { cleared: boolean; screen: ScreenProgram | undefined; preformatted: boolean }> {
    const target = this.active;
    target.shell.clearRequested = false;
    target.shell.screenRequest = undefined;
    target.shell.preformatted = false;
    const result = await run(target.shell, input);
    return {
      ...result,
      cleared: target.shell.clearRequested,
      screen: target.shell.screenRequest,
      // See `ShellContext.preformatted`: columns are load-bearing in this
      // output, so a host with a width must clip rather than wrap it.
      preformatted: target.shell.preformatted,
    };
  }

  /**
   * Advance the virtual clock, then let anything time-driven catch up.
   *
   * Async because cron runs real commands, and commands are async. Nothing
   * here consults wall time: a tick is the only way time passes.
   */
  async tick(ms: number): Promise<void> {
    if (ms <= 0) return;
    const from = this.clock;
    this.clock += ms;

    this.jobs.settle(this.clock);

    // A cron job that sleeps would otherwise advance the clock and re-enter
    // cron from inside itself.
    if (this.cronRunning) return;
    const due = dueBetween(this.vfs, this.epoch, from, this.clock);
    if (due.length === 0) return;

    this.cronRunning = true;
    try {
      for (const job of due) {
        // Cron output goes to no terminal, exactly like the real thing. A
        // crontab that wants to be seen redirects to a file.
        await run(this.shell, job.entry.command);
      }
    } finally {
      this.cronRunning = false;
    }
  }

  /**
   * Register a unit's start-time check.
   *
   * This is the seam between the Machine and an adventure: the Machine knows
   * how services behave, the adventure knows what makes this one refuse.
   */
  setPrecondition(unit: string, check: Precondition): void {
    this.services.setPrecondition(unit, check);
  }

  get time(): number {
    return this.clock;
  }

  get prompt(): string {
    const shell = this.active.shell;
    const cwd = shell.cwd === shell.home ? '~' : shell.cwd;
    const sigil = shell.user.uid === 0 ? '#' : '$';
    return `${shell.user.name}@${shell.hostname}:${cwd} ${sigil} `;
  }

  get exited(): number | null {
    // Only the machine the player started on can end the session; `exit` on a
    // remote host pops the stack instead.
    return this.shell.exited;
  }

  snapshot(): MachineSnapshot {
    return {
      version: 1,
      vfs: this.vfs.snapshot(),
      proc: { ...this.procs.snapshot(), services: this.services.snapshot() },
      jobs: this.jobs.snapshot(),
      cwd: this.shell.cwd,
      env: { ...this.shell.env },
      status: this.shell.status,
      clock: this.clock,
      epoch: this.epoch,
    };
  }

  static restore(snap: MachineSnapshot, opts: MachineOptions = {}): Machine {
    // A save carries its own calendar, so the snapshot supplies the epoch
    // unless the caller explicitly asked for a different one. A snapshot
    // written before `epoch` existed simply has none, and the default applies.
    // Tested for undefined rather than truthiness: epoch 0 is the Unix epoch
    // and a perfectly legal calendar to run an adventure on.
    const epoch = opts.epoch ?? snap.epoch;
    const machine = new Machine({
      ...opts,
      ...(epoch === undefined ? {} : { epoch }),
      snapshot: snap.vfs,
    });
    machine.procs.restore(snap.proc);
    machine.services.restore(snap.proc.services);
    machine.jobs.restore(snap.jobs);
    machine.shell.cwd = snap.cwd;
    machine.shell.env = { ...snap.env };
    machine.shell.status = snap.status;
    machine.clock = snap.clock;
    return machine;
  }
}
