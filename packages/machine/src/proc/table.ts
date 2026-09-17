import { SIGKILL, SIGTERM, type Process, type ProcessState, type ProcSnapshot, type SignalOutcome } from './types.js';

export interface SpawnOptions {
  uid?: number;
  ppid?: number;
  unit?: string;
  state?: ProcessState;
  /** Signals this process catches rather than dies of. Never SIGKILL. */
  traps?: readonly number[];
  /**
   * Virtual-clock instant this process started, when it is not now.
   *
   * Negative is the useful case: something an adventure wants to have been
   * running since before the session opened. `ps` reports elapsed time from
   * it, so a process started years ago looks like one, which is a clue a
   * player can read off the screen rather than be told.
   */
  startedAt?: number;
}

/**
 * Told about every signal that reaches a process.
 *
 * The seam for an adventure that wants a trapped signal to *do* something --
 * write a line to a log, vent another compartment. The Machine delivers the
 * signal and knows nothing about what it means; the adventure supplies the
 * meaning, the same way it supplies a unit's precondition.
 */
export type SignalWatcher = (process: Process, signal: number, outcome: SignalOutcome) => void;

/**
 * The process table.
 *
 * Nothing here actually executes — a "process" is a row that `ps` can show,
 * `kill` can remove, and a service can own. That is enough for every puzzle
 * that turns on which things are running, and it stays deterministic because
 * pids are allocated in order and times come from the virtual clock.
 */
export class ProcessTable {
  private processes = new Map<number, Process>();
  private nextPid = 1;
  private watchers: SignalWatcher[] = [];

  constructor(private readonly now: () => number) {}

  spawn(argv: string[], opts: SpawnOptions = {}): Process {
    const process: Process = {
      pid: this.nextPid++,
      ppid: opts.ppid ?? 1,
      argv,
      state: opts.state ?? 'running',
      uid: opts.uid ?? 0,
      startedAt: opts.startedAt ?? this.now(),
      ...(opts.unit !== undefined ? { unit: opts.unit } : {}),
      ...(opts.traps !== undefined ? { traps: [...opts.traps] } : {}),
    };
    this.processes.set(process.pid, process);
    return process;
  }

  get(pid: number): Process | undefined {
    return this.processes.get(pid);
  }

  list(): Process[] {
    return [...this.processes.values()].sort((a, b) => a.pid - b.pid);
  }

  /** Find the processes belonging to a unit. */
  byUnit(unit: string): Process[] {
    return this.list().filter((p) => p.unit === unit);
  }

  /**
   * Watch every signal delivered from now on. Returns the undo.
   *
   * Watchers are not snapshotted, because a function is not state. An
   * adventure installs them while it is building its world, and does so again
   * on the boot path a restored save goes through.
   */
  watch(fn: SignalWatcher): () => void {
    this.watchers.push(fn);
    return () => {
      this.watchers = this.watchers.filter((w) => w !== fn);
    };
  }

  /**
   * Send a signal.
   *
   * Signal 15 asks and signal 9 does not. A process that lists a signal in
   * `traps` catches it and stays where it is -- and the sender is told
   * nothing, because on a real machine `kill` reports whether the signal was
   * *delivered*, not whether the program took any notice. The way you find out
   * is to look again.
   */
  signal(pid: number, signal: number = SIGTERM): SignalOutcome {
    const process = this.processes.get(pid);
    if (!process) return 'no-such-process';

    const trapped = signal !== SIGKILL && (process.traps ?? []).includes(signal);
    if (!trapped) this.processes.delete(pid);

    const outcome: SignalOutcome = trapped ? 'trapped' : 'killed';
    for (const watcher of this.watchers) watcher(process, signal, outcome);
    return outcome;
  }

  /**
   * Remove a process.
   *
   * The short form of `signal`, kept because most callers only want the
   * process gone and do not care which signal did it. True means it is gone.
   */
  kill(pid: number, signal = SIGTERM): boolean {
    return this.signal(pid, signal) === 'killed';
  }

  snapshot(): ProcSnapshot {
    return {
      version: 1,
      nextPid: this.nextPid,
      processes: this.list().map((p) => ({ ...p })),
      services: [],
    };
  }

  restore(snap: ProcSnapshot): void {
    this.processes = new Map(snap.processes.map((p) => [p.pid, { ...p }]));
    this.nextPid = snap.nextPid;
  }
}
