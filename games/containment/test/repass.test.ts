import { beforeAll, describe, expect, it } from 'vitest';
import { NodePythonRuntime } from '@sigkill/python/node';
import { bootContainment, epilogue } from '../src/world.js';
import { CONTAINMENT_OBJECTIVES } from '../src/objectives.js';
import { DISCLOSURE, HOME } from '../src/act1/annexe.js';
import {
  CONSTANT_LOSS, DOWNHILL, HOLDOUT, LOSS, OWN_MODEL, PAPERWORK, TRAIN_CONSTANT_LOSS, VENDOR_LOSS, heredoc,
} from '../src/act1/training.js';

/**
 * The repass: the player makes a model (docs/GAME5_REPASS.md).
 *
 * The beats quote numbers -- a bias of -4.44, a validation minimum at step
 * forty, none of six crewed vessels found -- and every one of them is printed
 * by a script in `act1/training.ts` run against the seeded dataset. These
 * tests run those scripts in the real Python runtime and hold the beats to
 * what they print, the same way `dataset.test.ts` holds the act's first four
 * numbers.
 */

const python = new NodePythonRuntime();
beforeAll(async () => {
  await python.ready();
}, 180_000);

const boot = () => bootContainment({ python });

async function run(machine: ReturnType<typeof boot>['machine'], name: string, body: readonly string[]): Promise<string> {
  await machine.exec(heredoc(`${HOME}/${name}.py`, body));
  const result = await machine.exec(`python3 ${HOME}/${name}.py`);
  expect(result.stderr, `${name}.py`).toBe('');
  return result.stdout;
}

const value = (out: string, label: RegExp): number => {
  const line = out.split('\n').find((l) => label.test(l));
  expect(line, String(label)).toBeDefined();
  return Number(line!.trim().split(/\s+/).at(-1));
};

describe('the dataset carries what the repass needs, and the first four numbers did not move', () => {
  it('charges the vendor more log loss than a model that always guesses the base rate', async () => {
    const { machine } = boot();
    const out = await run(machine, 'loss', LOSS);
    expect(value(out, /vendor/)).toBeCloseTo(VENDOR_LOSS, 4);
    expect(value(out, /constant/)).toBeCloseTo(CONSTANT_LOSS, 4);
    // Objective five's verdict, by a different route.
    expect(value(out, /constant/)).toBeLessThan(value(out, /vendor/));
  });

  it('overfits visibly when given the paperwork and a small sample', async () => {
    const { machine } = boot();
    const out = await run(machine, 'paper', PAPERWORK());
    expect(value(out, /train/)).toBeLessThan(0.01);
    // Worse than guessing, on rows it never saw.
    expect(value(out, /unseen/)).toBeGreaterThan(TRAIN_CONSTANT_LOSS);
  });
});

describe('downhill: the model learns the base rate, and only that', () => {
  it('falls from ln 2 to no worse than the constant model, and the bias does the work', async () => {
    const { machine } = boot();
    const out = await run(machine, 'downhill', DOWNHILL());
    const losses = out.split('\n').filter((l) => /^step/.test(l)).map((l) => Number(l.split(' ').at(-1)));
    expect(losses).toHaveLength(100);
    expect(losses[0]).toBeCloseTo(0.6931, 4);
    expect(losses.at(-1)!).toBeLessThanOrEqual(TRAIN_CONSTANT_LOSS);
    const [, weights, bias] = /weights \[(.*)\] bias (\S+)/.exec(out)!;
    // The number the beat quotes, and the one-in-eighty it means.
    expect(Number(bias)).toBeCloseTo(-4.44, 2);
    for (const w of weights!.split(',').map(Number)) expect(Math.abs(w)).toBeLessThan(Math.abs(Number(bias)) / 4);
  });

  it('gives the same answer twice, because the adjuster will run it twice', async () => {
    const a = boot();
    const b = boot();
    expect(await run(a.machine, 'downhill', DOWNHILL())).toBe(await run(b.machine, 'downhill', DOWNHILL()));
  });

  it('a rate too high stalls and a rate too low never arrives', async () => {
    const { machine } = boot();
    const last = (out: string): number => Number(out.split('\n').filter((l) => /^step/.test(l)).at(-1)!.split(' ').at(-1));
    expect(last(await run(machine, 'hot', DOWNHILL(1000)))).toBeGreaterThan(0.3);
    expect(last(await run(machine, 'slow', DOWNHILL(0.1)))).toBeGreaterThan(0.1);
  });
});

describe('hold-some-back: the curve the beat draws is the curve the script prints', () => {
  it('bottoms out at step forty, climbs after, and scores the test part once', async () => {
    const { machine } = boot();
    const out = await run(machine, 'holdout', HOLDOUT);
    const curve = out
      .split('\n')
      .filter((l) => /validation/.test(l))
      .map((l) => ({ step: Number(l.split(' ')[1]), loss: Number(l.split(' ').at(-1)) }));
    const lowest = Math.min(...curve.map((p) => p.loss));
    expect(curve.find((p) => p.step === 40)!.loss).toBe(lowest);
    expect(curve.at(-1)!.loss).toBeGreaterThan(lowest);
    expect(value(out, /best step/)).toBe(40);
    expect(out.split('\n').filter((l) => /test/.test(l))).toHaveLength(1);
  });
});

describe('the honest number: his own model, scored', () => {
  it('matches the base rate and finds none of the six', async () => {
    const { machine } = boot();
    await run(machine, 'downhill', DOWNHILL());
    const out = await run(machine, 'own', OWN_MODEL);
    expect(out).toContain('own model accuracy 98.8');
    expect(out).toContain('own model crewed found 0 of 6');
  });
});

describe('the act, start to finish, by its own ladders', () => {
  /*
   * Every required objective closed by the command its own ladder hands
   * over, in order. A ladder whose last rung does not close its objective is
   * a ladder that strands somebody at the bottom of it, and the route harness
   * does not run rungs -- it runs routes.
   */
  it('closes all seventeen with the bottom rung of each step', async () => {
    const { machine, questbook } = boot();
    for (const objective of CONTAINMENT_OBJECTIVES.filter((o) => o.optional !== true)) {
      for (const step of objective.steps) {
        const rung = [...step.rungs].reverse().find((r) => r.tier === 'command' && r.command !== undefined);
        expect(rung, `${objective.id}/${step.id} has a command rung`).toBeDefined();
        const result = await machine.exec(rung!.command!);
        expect(result.stderr, `${objective.id}/${step.id}`).toBe('');
        machine.tick(1000);
      }
      expect(objective.done(machine), objective.id).toBe(true);
    }
    expect(questbook.complete(machine)).toBe(true);
    const ending = epilogue(machine).map((l) => (typeof l === 'string' ? l : l.art)).join('\n');
    expect(ending).toMatch(/found none of the six/);
  }, 300_000);

  it('opens the repass on the underwriter, in the disclosure', async () => {
    const { machine } = boot();
    const answer = (await machine.exec(`cat ${DISCLOSURE}/ANSWER`)).stdout;
    expect(answer).toMatch(/No classifier could have done better/);
  });
});
