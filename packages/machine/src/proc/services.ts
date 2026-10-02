import * as p from '../vfs/path.js';
import { ROOT_USER, type Vfs } from '../vfs/vfs.js';
import type { ProcessTable } from './table.js';
import {
  SIGKILL,
  type Precondition,
  type ServiceState,
  type ServiceStatus,
  type Unit,
} from './types.js';
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
 * One line of the journal.
 *
 * Written by the manager at the moments a real unit would log: a start that
 * took, a start that was refused and why, a stop. Deliberately not a parallel
 * fiction -- every entry is generated from the same `ServiceResult` the
 * caller gets back, so `journalctl -u comms` and `systemctl status comms` can
 * never tell different stories about the same event.
 */
export interface JournalEntry {
  /** Virtual-clock milliseconds, from the same `now` the manager uses. */
  at: number;
  unit: string;
  text: string;
}

/**
 * How much journal is kept.
 *
 * A ring, because the alternative is a save that grows without bound for a
 * player who sits in a restart loop. Generous enough that nothing an Act I
 * player does can push a real event off the end.
 */
const JOURNAL_LIMIT = 500;

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
  private journal: JournalEntry[] = [];

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

  /** Append to the journal, oldest dropped first. */
  private log(unit: string, text: string): void {
    this.journal.push({ at: this.now(), unit, text });
    if (this.journal.length > JOURNAL_LIMIT) this.journal.shift();
  }

  /**
   * The journal, oldest first, optionally for one unit.
   *
   * Returned as data rather than as text: `journalctl` formats it, and the
   * Machine has no screen to format for.
   */
  logs(unit?: string): readonly JournalEntry[] {
    if (unit === undefined) return this.journal;
    const wanted = unitName(unit);
    return this.journal.filter((entry) => entry.unit === wanted);
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
      this.log(unit.name, r.error);
      return { ok: false, reason: r.error };
    }

    /*
     * `Requires=` before anything else runs.
     *
     * This is the first line an operator reads when something will not come
     * up, and it was being accepted into the file and then ignored -- which is
     * worse than rejecting it, because a player who writes
     * `Requires=db.service` got no error and no effect and no way to tell.
     *
     * Checked before the precondition because a missing dependency is a
     * structural refusal: there is no point asking the unit whether it is
     * happy when the thing it is built on is not there.
     */
    for (const needed of unit.requires) {
      if (this.rt(needed).state === 'active') continue;
      const reason = `Unit ${needed}.service is not active.`;
      r.state = 'failed';
      r.error = reason;
      r.since = this.now();
      delete r.pid;
      this.log(unit.name, reason);
      this.log(unit.name, `Failed to start ${unit.description}.`);
      return { ok: false, reason };
    }

    const check = this.preconditions.get(unit.name);
    const verdict = check ? check(this.vfs) : ({ ok: true } as const);
    if (!verdict.ok) {
      r.state = 'failed';
      r.error = verdict.reason;
      r.since = this.now();
      delete r.pid;
      // The refusal, in the unit's own words. This is the line that makes
      // `journalctl -u <unit>` worth typing: it is the whole history of a
      // thing that would not start, not just its current mood.
      this.log(unit.name, `${verdict.reason ?? 'refused to start'}`);
      this.log(unit.name, 'Failed to start ' + unit.description + '.');
      return { ok: false, reason: verdict.reason };
    }

    const process = this.procs.spawn(unit.execStart.split(/\s+/), { uid: 0, unit: unit.name });
    r.state = 'active';
    r.pid = process.pid;
    r.since = this.now();
    delete r.error;
    this.log(unit.name, `Started ${unit.description}.`);
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
    this.log(unit.name, `Stopped ${unit.description}.`);
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

  /**
   * Called by the boot sequence: start everything that is enabled.
   *
   * `After=` is honoured here and only here, because ordering is all it means.
   * A unit with `After=db.service` and no `Requires=` will still start by hand
   * while the database is down -- that is not a gap, it is what the directive
   * does, and the difference between the two is one of the genuinely
   * confusing things about systemd.
   */
  startEnabled(): void {
    for (const unit of this.inStartOrder(listUnits(this.vfs))) {
      if (this.isEnabled(unit.name)) this.start(unit.name);
    }
  }

  /**
   * Sort by `After=`, leaving anything unordered where it was.
   *
   * A plain depth-first walk with a visiting set, so a cycle -- which systemd
   * itself resolves by dropping one edge and carrying on -- cannot hang the
   * boot.
   */
  private inStartOrder(units: readonly Unit[]): Unit[] {
    const byName = new Map(units.map((u) => [u.name, u]));
    const ordered: Unit[] = [];
    const done = new Set<string>();
    const visiting = new Set<string>();

    const visit = (unit: Unit): void => {
      if (done.has(unit.name) || visiting.has(unit.name)) return;
      visiting.add(unit.name);
      for (const earlier of unit.after) {
        const dep = byName.get(earlier);
        if (dep) visit(dep);
      }
      visiting.delete(unit.name);
      done.add(unit.name);
      ordered.push(unit);
    };

    for (const unit of units) visit(unit);
    return ordered;
  }

  /**
   * The journal goes in the save.
   *
   * It is history, and history that vanishes on reload is worse than no
   * history: a player who reads `journalctl -u scrubber`, reloads and finds
   * the refusal gone concludes the game forgot, not that the log was never
   * real. Returned as a separate array rather than folded into the unit rows
   * because entries outlive units -- a `.service` file the player deletes
   * should not take its past with it.
   */
  snapshotJournal(): readonly JournalEntry[] {
    return this.journal;
  }

  restoreJournal(entries: readonly JournalEntry[] | undefined): void {
    this.journal = entries ? entries.slice(-JOURNAL_LIMIT) : [];
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
