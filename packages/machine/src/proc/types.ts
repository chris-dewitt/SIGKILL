import type { Vfs } from '../vfs/vfs.js';

export type ProcessState = 'running' | 'sleeping' | 'stopped' | 'zombie';

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
