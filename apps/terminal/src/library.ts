import type { Machine } from '@sigkill/machine';
import { playable, type Adventure, type AdventureRuntimes } from '@sigkill/quest';
import type { ShipState as AudioState } from '@sigkill/audio';
import {
  WRECK,
  COMPARTMENT_IDS,
  oxygenTarget,
  readCompartment,
  ventingCompartments,
} from '@sigkill/wreck';
import { ARCHIVE } from '@sigkill/archive';
import { HARNESS } from '@sigkill/harness';
import { FORK } from '@sigkill/fork';
import { CONTAINMENT } from '@sigkill/containment';
import { PIPELINE } from '@sigkill/pipeline';
import { DEPOSIT } from '@sigkill/deposit';
import type { ShipStatus } from './status.js';

/**
 * The series, and the two things about it the host has to know that the shared
 * contract deliberately does not carry.
 *
 * `packages/quest` owns what an adventure *is* -- how to boot it, what it
 * teaches, what it says at the start and the end. It cannot own the readout or
 * the room tone without taking a dependency on `@sigkill/audio` and on a notion
 * of what a screen is, and the dependency arrow points one way. So those two
 * live here, next to the thing that draws them, as an optional adapter per
 * adventure.
 *
 * A game with no adapter still plays. It gets the progress rows and a quiet
 * room, which is exactly right for a game that has no ship to listen to.
 */

export interface HostHooks {
  /**
   * NAV-7's air and hull, which come from the ship rather than from the
   * adventure's own `conditions`. Every other game says where it is and what
   * condition it is in on its descriptor, where the world is.
   */
  readonly readout?: (machine: Machine) => Partial<ShipStatus>;
  /**
   * What the mixer should be playing.
   *
   * The Wreck derives its mix from ship state. Other adventures supply their
   * authored room tone. An omitted hook remains silent.
   */
  readonly sound?: (machine: Machine, progress: { done: number; goals: number }) => AudioState;
}

export interface Entry {
  readonly adventure: Adventure;
  readonly hooks: HostHooks;
}

/**
 * NAV-7's own readout, lifted out of `main.ts` unchanged.
 *
 * Every field still reads world state and nothing is cached, for the reason the
 * original comment gives: there is no parallel state to keep in step, so the
 * panel cannot drift from what `deck` and `pressure` say.
 */
const wreckReadout = (machine: Machine): Partial<ShipStatus> => ({
  place: 'NAV-7 — DECK C',
  target: oxygenTarget(machine),
  scrubber: machine.services.get('scrubber')?.state === 'active',
  sealed: COMPARTMENT_IDS.filter((id) => readCompartment(machine.vfs, id).sealed).length,
  compartments: COMPARTMENT_IDS.length,
  venting: ventingCompartments(machine).length,
});

const wreckSound = (machine: Machine, progress: { done: number; goals: number }): AudioState => ({
  scrubber: machine.services.get('scrubber')?.state === 'active',
  monitor: machine.services.get('hull-monitor')?.state === 'active',
  breached: COMPARTMENT_IDS.some((id) => !readCompartment(machine.vfs, id).sealed),
  // The reserve is not simulated yet, so progress stands in for it: the room
  // tone eases as the act is put right. Replace this the moment there is a
  // real clock on the oxygen.
  //
  // The constants are the ones that were in `main.ts`, unchanged. This is a
  // move, not a rewrite: the tone Chris has played the act to is the tone.
  reserve: 0.09 + (progress.done / Math.max(1, progress.goals)) * 0.6,
});

export const LIBRARY: readonly Entry[] = [
  { adventure: WRECK, hooks: { readout: wreckReadout, sound: wreckSound } },
  {
    adventure: ARCHIVE,
    hooks: { sound: () => ({ scene: 'archive', scrubber: false, monitor: false, breached: false, reserve: 1 }) },
  },
  {
    adventure: HARNESS,
    hooks: { sound: () => ({ scene: 'harness', scrubber: false, monitor: false, breached: false, reserve: 1 }) },
  },
  {
    adventure: FORK,
    hooks: { sound: () => ({ scene: 'fork', scrubber: false, monitor: false, breached: false, reserve: 1 }) },
  },
  {
    adventure: DEPOSIT,
    // The same office as game four, two floors down and two years on.
    hooks: { sound: () => ({ scene: 'deposit', scrubber: false, monitor: false, breached: false, reserve: 1 }) },
  },
  { adventure: PIPELINE, hooks: { sound: () => ({ scene: 'pipeline', scrubber: false, monitor: false, breached: false, reserve: 1 }) } },
  /*
   * Last, and that is the point.
   *
   * The Containment is the finale: the hearing is argued after the evidence
   * has been filed at the deposit office, and v43 lands here rather than in a
   * game that was always one slot further out. `docs/PLAN.md` has the whole
   * decision.
   */
  {
    adventure: CONTAINMENT,
    hooks: { sound: () => ({ scene: 'containment', scrubber: false, monitor: false, breached: false, reserve: 1 }) },
  },
];

/**
 * The adventures this host can actually start, in series order.
 *
 * Filtered rather than listed, so a build without SQLite offers two games
 * instead of crashing on the third. `playable` is the shared rule -- the host
 * does not get its own copy of "what does this game need", because two copies
 * would disagree the first time a game gained a requirement.
 */
export function offered(runtimes: AdventureRuntimes): Entry[] {
  const ok = new Set(playable(LIBRARY.map((row) => row.adventure), runtimes).map((a) => a.id));
  return LIBRARY.filter((row) => ok.has(row.adventure.id)).sort(
    (a, b) => a.adventure.number - b.adventure.number,
  );
}

export const entry = (id: string): Entry | undefined =>
  LIBRARY.find((row) => row.adventure.id === id);

/**
 * The chooser, as lines.
 *
 * Pure so that what it says in each state is a unit test rather than something
 * you have to open a browser to find out -- the same reason `statusRows` is
 * pure. `saved` marks the runs already in progress, because the single most
 * useful thing this screen can tell a returning player is where they were.
 */
export function chooserLines(
  entries: readonly Entry[],
  saved: ReadonlySet<string>,
  cols = 34,
): string[] {
  const lines: string[] = ['', '  SIGKILL', ''];
  for (const [index, { adventure }] of entries.entries()) {
    const mark = saved.has(adventure.id) ? ' [in progress]' : '';
    lines.push(`  ${index + 1}. ${adventure.title}${mark}`);
    lines.push(`     ${adventure.teaches}`);
    for (const line of wrap(adventure.blurb.join(' '), Math.max(10, cols - 5))) lines.push(`     ${line}`);
    lines.push('');
  }
  lines.push(entries.length === 1 ? '  Type 1 to begin.' : `  Type 1-${entries.length} to begin.`);
  lines.push('');
  return lines;
}

/**
 * Words into lines no wider than `width`.
 *
 * The blurbs used to be clipped per authored line, which lost words on any
 * screen narrower than the line was written for -- "a research ship" then
 * "no idea why", with the words between them gone. Wrapped, the whole
 * sentence survives at any width. A word longer than the line is broken
 * rather than allowed to run off the glass.
 */
export function wrap(text: string, width: number): string[] {
  const out: string[] = [];
  let line = '';
  for (let word of text.split(/\s+/).filter(Boolean)) {
    while (word.length > width) {
      if (line) { out.push(line); line = ''; }
      out.push(word.slice(0, width));
      word = word.slice(width);
    }
    if (!line) line = word;
    else if (line.length + 1 + word.length <= width) line += ` ${word}`;
    else { out.push(line); line = word; }
  }
  if (line) out.push(line);
  return out;
}

/**
 * Read a chooser answer, by number or by name.
 *
 * By name as well as number because a player who has been told about `games`
 * will type `harness` before they count, and refusing that would be the
 * interface being clever at somebody's expense.
 */
export function chosen(entries: readonly Entry[], raw: string): Entry | undefined {
  const answer = raw.trim().toLowerCase();
  if (answer.length === 0) return undefined;
  const byNumber = Number(answer);
  if (Number.isInteger(byNumber) && byNumber >= 1 && byNumber <= entries.length) {
    return entries[byNumber - 1];
  }
  return entries.find(
    (row) =>
      row.adventure.id === answer ||
      row.adventure.title.toLowerCase() === answer ||
      row.adventure.title.toLowerCase().replace(/^the /, '') === answer,
  );
}

