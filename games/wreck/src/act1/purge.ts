import { ROOT_USER, SIGTERM, type Machine, type Process } from '@sigkill/machine';
import type { World } from '@sigkill/quest';
import { readCompartment } from './art.js';
import { BREACHED, stamp } from './deck-c.js';

/**
 * The fifth puzzle: a process that will not take no for an answer.
 *
 * On day nine Vasquez started a purge cycle on C7 so she could work in the
 * crawl without a suit. The cycle ends when the compartment reaches its target
 * pressure. C7 was open to space, so it never reached anything, so the cycle
 * never ended -- and the program traps SIGTERM specifically so that it can
 * close the valve before it exits, which it will not do until the cycle is
 * finished. It has been politely deferring every request to stop for eleven
 * years.
 *
 * While the hull was open this changed nothing: it was venting a compartment
 * that was already vacuum. The moment the player seals C7 it finally has a
 * sealed compartment to evacuate, and starts pulling the deck's air back out
 * through the hatch they just closed.
 *
 * That is the whole shape of the lesson, and it is the one the series is named
 * after. SIGTERM is a request. SIGKILL is not a request. You reach for the
 * second one only when the first has been refused, and now the player has met
 * a program that refuses.
 */

export const PURGE_BIN = '/usr/sbin/atmo-purge';
export const PURGE_LOG = '/var/log/purge.log';

/** The full command line, so `ps -f` reads like something somebody typed. */
export const PURGE_ARGV = [PURGE_BIN, '--compartment', BREACHED, '--continuous'] as const;

/** The purge, if it is still running. Undefined is the objective being met. */
export function purgeProcess(world: World): Process | undefined {
  return world.procs.list().find((p) => p.argv[0] === PURGE_BIN);
}

/**
 * Compartments that are shut and being emptied anyway.
 *
 * Only a *sealed* compartment counts. While the hatch is open the purge is
 * venting a room that is already vacuum, which is exactly why nobody noticed
 * it for eleven years -- and a readout that cried venting from the first
 * command would give the whole thing away before the player had sealed
 * anything.
 */
export function ventingCompartments(world: World): string[] {
  const purge = purgeProcess(world);
  if (!purge) return [];
  const at = purge.argv.indexOf('--compartment');
  const id = at >= 0 ? purge.argv[at + 1] : undefined;
  if (id === undefined) return [];
  return readCompartment(world.vfs, id).sealed ? [id] : [];
}

function append(m: Machine, path: string, lines: string[]): void {
  let existing = '';
  try {
    existing = m.vfs.readText(path, ROOT_USER);
  } catch {
    // The player is allowed to delete a log. That is a state, not a crash.
  }
  m.vfs.writeText(path, existing + lines.join('\n') + '\n', ROOT_USER);
}

/**
 * Eleven years of a program being asked nicely.
 *
 * Seeded rather than generated because every line is doing narrative work:
 * the valve opening, the compartment failing to settle, and then Vasquez
 * trying three times in four days to stop the thing and being told each time
 * that it would get to it.
 */
function history(wakeMs: number): string[] {
  const day = 24 * 60 * 60 * 1000;
  const start = wakeMs - 4112 * day;
  const at = (days: number, hours: number): string => stamp(start + days * day + hours * 3600_000);

  return [
    `${at(9, 4)} atmo-purge: cycle start, compartment ${BREACHED.toUpperCase()}, target 0.0kPa`,
    `${at(9, 4)} atmo-purge: valve open`,
    `${at(9, 6)} atmo-purge: ${BREACHED.toUpperCase()} not settling after 2h`,
    `${at(9, 6)} atmo-purge: compartment may be open to vacuum. holding valve open`,
    `${at(10, 2)} atmo-purge: caught SIGTERM. deferring: cycle incomplete`,
    `${at(11, 23)} atmo-purge: caught SIGTERM. deferring: cycle incomplete`,
    `${at(12, 9)} atmo-purge: caught SIGTERM. deferring: cycle incomplete`,
    `${at(12, 9)} atmo-purge: operator note: "just stop"`,
    `${at(14, 1)} atmo-purge: caught SIGTERM. deferring: cycle incomplete`,
    `${at(400, 0)} atmo-purge: still holding. 0 of 1 cycles complete`,
    `${at(4000, 0)} atmo-purge: still holding. 0 of 1 cycles complete`,
    '',
  ];
}

/**
 * Put the purge on the deck and make its signal handler real.
 *
 * The handler is a watcher on the process table rather than a field on the
 * process, because a function is not state and would not survive a save. The
 * Machine delivers the signal and knows nothing about what it means; this is
 * where it means something.
 */
export function startPurge(m: Machine): void {
  m.vfs.writeText(PURGE_LOG, history(m.epoch).join('\n'), ROOT_USER);
  m.vfs.chmod(PURGE_LOG, 0o644, ROOT_USER);

  // Started on day nine of four thousand one hundred and twelve, so `ps -ef`
  // reports an elapsed time with five digits in it. Nothing says "this has
  // been running since before you were asleep" like the number does.
  m.procs.spawn([...PURGE_ARGV], {
    uid: 0,
    traps: [SIGTERM],
    startedAt: -(4112 - 9) * 24 * 60 * 60 * 1000,
  });
}

/**
 * Install the signal handler.
 *
 * Called from `wireWreck`, which both boot paths go through, for the same
 * reason the unit preconditions live there: a saved run carries the log and
 * the process but cannot carry behaviour, because behaviour is code. A
 * restored save that forgot this would have a purge that dies of SIGTERM,
 * which is the whole of puzzle five quietly deleted.
 */
export function watchPurge(m: Machine): void {
  m.procs.watch((process, signal, outcome) => {
    if (process.argv[0] !== PURGE_BIN) return;
    const now = stamp(m.epoch + m.time);

    if (outcome === 'trapped') {
      // The whole puzzle, written down by the thing causing it. A player who
      // sends TERM, sees nothing, and thinks to look at the log finds the
      // program explaining in its own words why it ignored them.
      append(m, PURGE_LOG, [
        `${now} atmo-purge: caught SIG${signal === SIGTERM ? 'TERM' : String(signal)}.` +
          ' deferring: cycle incomplete',
        `${now} atmo-purge: ${BREACHED.toUpperCase()} has not reached target. valve stays open`,
      ]);
      return;
    }

    if (outcome !== 'killed') return;

    append(m, PURGE_LOG, [
      `${now} atmo-purge: SIGKILL. no handler. process ended`,
      `${now} atmo-purge: valve closed on loss of process`,
    ]);

    // The payoff is a picture, not a sentence: the compartment starts filling
    // again, and the sparkline the player learned to read in puzzle four is
    // the thing that says so.
    const step = 20 * 60 * 1000;
    append(
      m,
      '/var/log/hull.log',
      [100.4, 100.7, 100.9, 101.1, 101.2, 101.3].map(
        (kpa, i) =>
          `${stamp(m.epoch + m.time + i * step)} ${BREACHED.toUpperCase()} ${kpa.toFixed(1)}kPa RISING`,
      ),
    );
  });
}
