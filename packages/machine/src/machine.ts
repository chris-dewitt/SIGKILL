import { commandRegistry } from './coreutils/index.js';
import { ServiceManager } from './proc/services.js';
import { ProcessTable } from './proc/table.js';
import type { Precondition, ProcSnapshot } from './proc/types.js';
import { run, ShellContext, type CommandSpec, type RunResult, type Track } from './shell/exec.js';
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
}

export interface MachineSnapshot {
  version: 1;
  vfs: VfsSnapshot;
  proc: ProcSnapshot;
  cwd: string;
  env: Record<string, string>;
  status: number;
  clock: number;
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
  readonly shell: ShellContext;
  /** Virtual clock in milliseconds. Advanced explicitly, never by wall time. */
  private clock = 0;

  constructor(opts: MachineOptions = {}) {
    const user = opts.user ?? DEFAULT_USER;
    const now = (): number => this.clock;

    this.vfs = opts.snapshot ? Vfs.restore(opts.snapshot, { now }) : new Vfs({ now });
    this.procs = new ProcessTable(now);
    this.services = new ServiceManager(this.vfs, this.procs, now);

    // pid 1. Every machine has one, and `ps` looks wrong without it.
    this.procs.spawn(['/sbin/init'], { uid: 0, ppid: 0 });

    this.shell = new ShellContext({
      vfs: this.vfs,
      procs: this.procs,
      services: this.services,
      clock: now,
      user,
      hostname: opts.hostname ?? 'localhost',
      commands: commandRegistry(opts.commands ?? []),
      cwd: opts.cwd,
      env: opts.env,
      track: opts.track,
    });
  }

  /** Run one command line. Returns captured output; never throws for user error. */
  async exec(input: string): Promise<RunResult & { cleared: boolean }> {
    this.shell.clearRequested = false;
    const result = await run(this.shell, input);
    return { ...result, cleared: this.shell.clearRequested };
  }

  /** Advance the virtual clock. Timestamps and timed events read from here. */
  tick(ms: number): void {
    this.clock += ms;
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
    const cwd = this.shell.cwd === this.shell.home ? '~' : this.shell.cwd;
    const sigil = this.shell.user.uid === 0 ? '#' : '$';
    return `${this.shell.user.name}@${this.shell.hostname}:${cwd} ${sigil} `;
  }

  get exited(): number | null {
    return this.shell.exited;
  }

  snapshot(): MachineSnapshot {
    return {
      version: 1,
      vfs: this.vfs.snapshot(),
      proc: { ...this.procs.snapshot(), services: this.services.snapshot() },
      cwd: this.shell.cwd,
      env: { ...this.shell.env },
      status: this.shell.status,
      clock: this.clock,
    };
  }

  static restore(snap: MachineSnapshot, opts: MachineOptions = {}): Machine {
    const machine = new Machine({ ...opts, snapshot: snap.vfs });
    machine.procs.restore(snap.proc);
    machine.services.restore(snap.proc.services);
    machine.shell.cwd = snap.cwd;
    machine.shell.env = { ...snap.env };
    machine.shell.status = snap.status;
    machine.clock = snap.clock;
    return machine;
  }
}
