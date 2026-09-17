import type { Vfs } from '../vfs/vfs.js';

export type ProcessState = 'running' | 'sleeping' | 'stopped' | 'zombie';

/** SIGTERM. Asks. */
export const SIGTERM = 15;

/**
 * SIGKILL.
 *
 * The one signal a process gets no say in. Everything else can be caught,
 * blocked or ignored; this one is delivered by the kernel to the process
 * table rather than to the program, which is why it always works and why it
 * is the last thing you reach for rather than the first.
 */
export const SIGKILL = 9;

/**
 * What happened when a signal was delivered.
 *
 * `trapped` is the interesting one: the process is still there afterwards,
 * and `kill` said nothing about it, exactly as on a real machine. Finding out
 * costs another `ps`.
 */
export type SignalOutcome = 'no-such-process' | 'killed' | 'trapped';

export interface Process {
  pid: number;
  ppid: number;
  argv: string[];
  state: ProcessState;
  uid: number;
  /** Virtual-clock milliseconds. */
  startedAt: number;
  /** The service unit that owns this process, when one does. */
  unit?: string;
  /**
   * Signals this process catches instead of dying of.
   *
   * A real program installs a handler and decides for itself what TERM means
   * -- usually "finish what you are doing, then exit", occasionally "no".
   * Numbers rather than a handler function so a process survives a snapshot:
   * what it traps is state, what it does about it is the adventure's business.
   *
   * SIGKILL is never honoured here however it is listed. That is not a rule
   * this table enforces as a courtesy; it is what the signal is.
   */
  traps?: readonly number[];
}

/** systemd's vocabulary, kept deliberately narrow. */
export type ServiceState = 'inactive' | 'active' | 'failed';

/** A parsed `.service` unit file. */
export interface Unit {
  name: string;
  description: string;
  execStart: string;
  /** `Restart=` — parsed and reported, not yet acted on. */
  restart: string;
  wantedBy: string;
  /** Where the unit file was read from, so errors can name it. */
  path: string;
}

/**
 * A start-time check supplied by the adventure, not by the Machine.
 *
 * Real units fail when their configuration is invalid; this is how that
 * becomes a puzzle. Returning a reason fails the unit and the reason lands in
 * `systemctl status`, exactly where a player would look for it.
 */
export type Precondition = (vfs: Vfs) => { ok: true } | { ok: false; reason: string };

export interface ServiceStatus {
  name: string;
  description: string;
  state: ServiceState;
  enabled: boolean;
  pid: number | undefined;
  /** Populated when the last start attempt failed. */
  error: string | undefined;
  since: number | undefined;
}

export interface ProcSnapshot {
  version: 1;
  nextPid: number;
  processes: Process[];
  services: Array<{ name: string; state: ServiceState; pid?: number; error?: string; since?: number }>;
}
