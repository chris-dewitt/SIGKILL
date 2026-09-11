import type { Process, ProcessState, ProcSnapshot } from './types.js';

export interface SpawnOptions {
  uid?: number;
  ppid?: number;
  unit?: string;
  state?: ProcessState;
}

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

  constructor(private readonly now: () => number) {}

  spawn(argv: string[], opts: SpawnOptions = {}): Process {
    const process: Process = {
      pid: this.nextPid++,
      ppid: opts.ppid ?? 1,
      argv,
      state: opts.state ?? 'running',
      uid: opts.uid ?? 0,
      startedAt: this.now(),
      ...(opts.unit !== undefined ? { unit: opts.unit } : {}),
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
   * Remove a process.
   *
   * Signal 15 asks and signal 9 does not, but nothing here traps signals yet,
   * so both end the process. The distinction becomes real when units can
   * install handlers — The Daemon needs that, The Wreck does not.
   */
  kill(pid: number, _signal = 15): boolean {
    return this.processes.delete(pid);
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
