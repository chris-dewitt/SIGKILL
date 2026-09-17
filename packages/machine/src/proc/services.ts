import * as p from '../vfs/path.js';
import { ROOT_USER, type Vfs } from '../vfs/vfs.js';
import type { ProcessTable } from './table.js';
import { SIGKILL, type Precondition, type ServiceState, type ServiceStatus } from './types.js';
import { listUnits, loadUnit, unitName, WANTS_DIR } from './units.js';

interface Runtime {
  state: ServiceState;
  pid?: number;
  error?: string;
  since?: number;
}

export interface ServiceResult {
  ok: boolean;
  /** Present when ok is false — this is what `systemctl status` shows. */
  reason?: string;
}

/**
 * A small systemd.
 *
 * Two decisions worth knowing:
 *
 * 1. Unit *definitions* live in the filesystem and are re-read on every
 *    operation, so a player who edits a `.service` file changes behaviour for
 *    real — and so `cat`, `ls` and `grep` all work on them.
 * 2. "Enabled" is not a field. It is a symlink in multi-user.target.wants,
 *    exactly as on a real system, which means `systemctl enable` is visible to
 *    `ls -l` and persists through a snapshot without any extra machinery.
 */
export class ServiceManager {
  private runtime = new Map<string, Runtime>();
  private preconditions = new Map<string, Precondition>();

  constructor(
    private readonly vfs: Vfs,
    private readonly procs: ProcessTable,
    private readonly now: () => number,
  ) {}

  /**
   * Register the start-time check for a unit. Supplied by the adventure, so
   * the Machine stays generic and the failure reason stays in-fiction.
   */
  setPrecondition(name: string, check: Precondition): void {
    this.preconditions.set(unitName(name), check);
  }

  private rt(name: string): Runtime {
    let r = this.runtime.get(name);
    if (!r) {
      r = { state: 'inactive' };
      this.runtime.set(name, r);
    }
    return r;
  }

  exists(name: string): boolean {
    return loadUnit(this.vfs, name) !== undefined;
  }

  isEnabled(name: string): boolean {
    return this.vfs.exists(p.join(WANTS_DIR, `${unitName(name)}.service`), ROOT_USER);
  }

  get(name: string): ServiceStatus | undefined {
    const unit = loadUnit(this.vfs, name);
    if (!unit) return undefined;
    const r = this.rt(unit.name);
    return {
      name: unit.name,
      description: unit.description,
      state: r.state,
      enabled: this.isEnabled(unit.name),
      pid: r.pid,
      error: r.error,
      since: r.since,
    };
  }

  /** Where a unit's file lives, for `systemctl status` to report. */
  unitPath(name: string): string {
    return loadUnit(this.vfs, name)?.path ?? `${unitName(name)}.service`;
  }

  list(): ServiceStatus[] {
    return listUnits(this.vfs)
      .map((u) => this.get(u.name))
      .filter((s): s is ServiceStatus => s !== undefined);
  }

  /**
   * Would this unit's precondition pass right now, without starting it?
   *
   * A recorded failure is history and stays as it is -- that is what real
   * systemd shows. But a player who has just fixed the configuration and runs
   * `systemctl status` deserves to know the fix took, rather than reading the
   * error from the last attempt and concluding their edit did nothing.
   */
  precheck(name: string): { ok: boolean; reason?: string } {
    const check = this.preconditions.get(unitName(name));
    if (!check) return { ok: true };
    const verdict = check(this.vfs);
    return verdict.ok ? { ok: true } : { ok: false, reason: verdict.reason };
  }

  start(name: string): ServiceResult {
    const unit = loadUnit(this.vfs, name);
    if (!unit) return { ok: false, reason: `Unit ${unitName(name)}.service not found.` };

    const r = this.rt(unit.name);
    if (r.state === 'active') return { ok: true };

    if (unit.execStart.length === 0) {
      r.state = 'failed';
      r.error = `Unit ${unit.name}.service has no ExecStart= and cannot be started.`;
      r.since = this.now();
      delete r.pid;
      return { ok: false, reason: r.error };
    }

    const check = this.preconditions.get(unit.name);
    const verdict = check ? check(this.vfs) : ({ ok: true } as const);
    if (!verdict.ok) {
      r.state = 'failed';
      r.error = verdict.reason;
      r.since = this.now();
      delete r.pid;
      return { ok: false, reason: verdict.reason };
    }

    const process = this.procs.spawn(unit.execStart.split(/\s+/), { uid: 0, unit: unit.name });
    r.state = 'active';
    r.pid = process.pid;
    r.since = this.now();
    delete r.error;
    return { ok: true };
  }

  stop(name: string): ServiceResult {
    const unit = loadUnit(this.vfs, name);
    if (!unit) return { ok: false, reason: `Unit ${unitName(name)}.service not found.` };

    const r = this.rt(unit.name);
    // SIGKILL rather than TERM: `systemctl stop` is an instruction, not a
    // request, and a unit whose process trapped TERM would otherwise leave
    // the manager believing it had stopped something it had not.
    if (r.pid !== undefined) this.procs.kill(r.pid, SIGKILL);
    r.state = 'inactive';
    r.since = this.now();
    delete r.pid;
    delete r.error;
    return { ok: true };
  }

  restart(name: string): ServiceResult {
    this.stop(name);
    return this.start(name);
  }

  enable(name: string): ServiceResult {
    const unit = loadUnit(this.vfs, name);
    if (!unit) return { ok: false, reason: `Unit ${unitName(name)}.service not found.` };
    const link = p.join(WANTS_DIR, `${unit.name}.service`);
    if (this.vfs.exists(link, ROOT_USER)) return { ok: true };
    this.vfs.mkdirp(WANTS_DIR, ROOT_USER);
    this.vfs.symlink(unit.path, link, ROOT_USER);
    return { ok: true };
  }

  disable(name: string): ServiceResult {
    const unit = loadUnit(this.vfs, name);
    if (!unit) return { ok: false, reason: `Unit ${unitName(name)}.service not found.` };
    const link = p.join(WANTS_DIR, `${unit.name}.service`);
    if (this.vfs.exists(link, ROOT_USER)) this.vfs.unlink(link, ROOT_USER);
    return { ok: true };
  }

  /** Called by the boot sequence: start everything that is enabled. */
  startEnabled(): void {
    for (const unit of listUnits(this.vfs)) {
      if (this.isEnabled(unit.name)) this.start(unit.name);
    }
  }

  snapshot(): Array<{ name: string; state: ServiceState; pid?: number; error?: string; since?: number }> {
    return [...this.runtime.entries()].map(([name, r]) => ({
      name,
      state: r.state,
      ...(r.pid !== undefined ? { pid: r.pid } : {}),
      ...(r.error !== undefined ? { error: r.error } : {}),
      ...(r.since !== undefined ? { since: r.since } : {}),
    }));
  }

  restore(rows: Array<{ name: string; state: ServiceState; pid?: number; error?: string; since?: number }>): void {
    this.runtime = new Map(
      rows.map((row) => [
        row.name,
        {
          state: row.state,
          ...(row.pid !== undefined ? { pid: row.pid } : {}),
          ...(row.error !== undefined ? { error: row.error } : {}),
          ...(row.since !== undefined ? { since: row.since } : {}),
        },
      ]),
    );
  }
}
