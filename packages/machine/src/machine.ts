import { commandRegistry } from './coreutils/index.js';
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
  readonly shell: ShellContext;
  /** Virtual clock in milliseconds. Advanced explicitly, never by wall time. */
  private clock = 0;

  constructor(opts: MachineOptions = {}) {
    const user = opts.user ?? DEFAULT_USER;
    const now = (): number => this.clock;

    this.vfs = opts.snapshot ? Vfs.restore(opts.snapshot, { now }) : new Vfs({ now });
    this.shell = new ShellContext({
      vfs: this.vfs,
      user,
      hostname: opts.hostname ?? 'localhost',
      commands: commandRegistry(opts.commands ?? []),
      cwd: opts.cwd,
      env: opts.env,
      track: opts.track,
    });
  }

  /** Run one command line. Returns captured output; never throws for user error. */
  exec(input: string): RunResult & { cleared: boolean } {
    this.shell.clearRequested = false;
    const result = run(this.shell, input);
    return { ...result, cleared: this.shell.clearRequested };
  }

  /** Advance the virtual clock. Timestamps and timed events read from here. */
  tick(ms: number): void {
    this.clock += ms;
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
      cwd: this.shell.cwd,
      env: { ...this.shell.env },
      status: this.shell.status,
      clock: this.clock,
    };
  }

  static restore(snap: MachineSnapshot, opts: MachineOptions = {}): Machine {
    const machine = new Machine({ ...opts, snapshot: snap.vfs });
    machine.shell.cwd = snap.cwd;
    machine.shell.env = { ...snap.env };
    machine.shell.status = snap.status;
    machine.clock = snap.clock;
    return machine;
  }
}
