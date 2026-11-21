import { beforeAll, describe, expect, it } from 'vitest';
import { NodePythonRuntime } from '@sigkill/python/node';
import { NodeSqlRuntime } from '@sigkill/sql/node';
import { ROOT_USER, type Machine } from '@sigkill/machine';
import type { AdventureSession, BeatLine, Objective } from '@sigkill/quest';
import { LIBRARY } from '../src/library.js';

/**
 * How much a player is asked to read at once, capped.
 *
 * Chris, on the phone: "if this shit is too dense and wordy, it's not fun."
 * A phone shows about thirty-eight columns, so sixty words is fifteen rows --
 * most of a screen. The oldest games had beats of a hundred and twenty words,
 * hint rungs of a hundred, and a first README of four hundred, and nothing
 * stopped the next one being longer. This does.
 *
 * Prose only: a line that starts with whitespace is a log line, a command, a
 * table or art, which the eye takes in at a glance and the tap layer turns
 * into input. What is counted is what has to be *read*.
 */

const CAP = {
  coldOpen: 80,
  beat: 60,
  rung: 60,
  readme: 150,
} as const;

const prose = (lines: readonly (BeatLine | string)[]): number =>
  lines
    .filter((l): l is string => typeof l === 'string' && !/^\s/.test(l))
    .join(' ')
    .split(/\s+/)
    .filter(Boolean).length;

const python = new NodePythonRuntime();
const sql = new NodeSqlRuntime();
const booted = new Map<string, AdventureSession>();

beforeAll(async () => {
  await python.ready();
  for (const { adventure } of LIBRARY) booted.set(adventure.id, await adventure.boot({ python, sql }));
}, 180_000);

/** Every README the world ships, wherever a player might be told to look. */
function readmes(machine: Machine): { path: string; words: number }[] {
  const found: { path: string; words: number }[] = [];
  const walk = (dir: string, depth: number): void => {
    let names: string[];
    try {
      names = machine.vfs.readdir(dir, ROOT_USER);
    } catch {
      return;
    }
    for (const name of names) {
      const path = `${dir}/${name}`;
      try {
        if (machine.vfs.stat(path, ROOT_USER).kind === 'dir') {
          if (depth > 0) walk(path, depth - 1);
        } else if (name === 'README') {
          found.push({ path, words: machine.vfs.readText(path, ROOT_USER).split(/\s+/).filter(Boolean).length });
        }
      } catch { /* unreadable is not this test's business */ }
    }
  };
  walk('/home', 3);
  walk('/srv', 3);
  return found;
}

describe.each(LIBRARY.map((e) => e.adventure))('$id reads in a phone screen at a time', (adventure) => {
  const session = (): AdventureSession => booted.get(adventure.id)!;
  const objectives = (): readonly Objective[] => session().questbook.objectives;

  it(`opens in ${CAP.coldOpen} words or fewer`, () => {
    expect(prose(adventure.coldOpen(session().machine))).toBeLessThanOrEqual(CAP.coldOpen);
  });

  it(`answers each objective in ${CAP.beat} words or fewer`, () => {
    for (const o of objectives()) {
      const beat = typeof o.onComplete === 'function' ? o.onComplete(session().machine) : (o.onComplete ?? []);
      expect(prose(beat), o.id).toBeLessThanOrEqual(CAP.beat);
    }
  });

  it(`hints in ${CAP.rung} words or fewer a rung`, () => {
    for (const o of objectives()) {
      for (const step of o.steps) {
        for (const rung of step.rungs) expect(prose(rung.lines), `${o.id}/${step.id} ${rung.tier}`).toBeLessThanOrEqual(CAP.rung);
      }
    }
  });

  it(`keeps every README to ${CAP.readme} words`, () => {
    for (const { path, words } of readmes(session().machine)) expect(words, path).toBeLessThanOrEqual(CAP.readme);
  });
});
