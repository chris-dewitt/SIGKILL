import { beforeAll, describe, expect, it } from 'vitest';
import { NodePythonRuntime } from '@sigkill/python/node';
import {
  MissingRuntime,
  checkObjective,
  taught,
  validateObjectives,
  type RouteWorld,
} from '@sigkill/quest';
import { CONTAINMENT } from '../src/adventure.js';
import { bootContainment, restoreContainment, coldOpen, epilogue } from '../src/world.js';
import { CONTAINMENT_OBJECTIVES } from '../src/objectives.js';
import { FINDINGS, HOME } from '../src/act1/annexe.js';
import { buildDataset, metrics } from '../src/act1/dataset.js';

const python = new NodePythonRuntime();
beforeAll(async () => {
  await python.ready();
}, 180_000);

function fresh(): RouteWorld & { act: ReturnType<typeof bootContainment> } {
  const act = bootContainment({ python });
  return {
    act,
    world: act.machine,
    run: async (command: string) => {
      const result = await act.machine.exec(command);
      await act.machine.tick(1000);
      return { stderr: result.stderr };
    },
  };
}

describe('the act is structurally sound', () => {
  it('passes the content validator against the commands aboard', () => {
    const { machine } = bootContainment({ python });
    const problems = validateObjectives(CONTAINMENT_OBJECTIVES, {
      commands: machine.shell.commands,
    });
    expect(problems, problems.join('\n')).toEqual([]);
  });

  it('ships nine required and two optional', () => {
    expect(CONTAINMENT_OBJECTIVES.filter((o) => o.optional !== true)).toHaveLength(9);
    expect(CONTAINMENT_OBJECTIVES.filter((o) => o.optional === true)).toHaveLength(2);
  });

  it('promises no command the machine has not got', () => {
    const { machine } = bootContainment({ python });
    for (const skill of taught(CONTAINMENT_OBJECTIVES)) {
      if (/^[a-z0-9][a-z0-9.+-]*$/.test(skill)) {
        expect(machine.shell.commands.has(skill), `teaches "${skill}"`).toBe(true);
      }
    }
  });

  it('refuses to boot without Python, which is objectives four to nine', async () => {
    await expect(CONTAINMENT.boot({})).rejects.toThrow(MissingRuntime);
  });

  it('sits at slot five', () => {
    expect(CONTAINMENT.number).toBe(5);
    expect(CONTAINMENT.id).toBe('containment');
  });
});

describe('routes and near-misses', () => {
  for (const objective of CONTAINMENT_OBJECTIVES) {
    it(`${objective.id}: every route closes it and no near-miss does`, async () => {
      const report = await checkObjective(objective, fresh);
      expect(report.problems, report.problems.join('\n')).toEqual([]);
      expect(report.routesChecked).toBeGreaterThanOrEqual(3);
      expect(report.nearMissesChecked).toBeGreaterThanOrEqual(2);
    }, 300_000);
  }
});

describe('the two numbers the act is built on', () => {
  it('agrees with what the dataset actually contains', () => {
    const m = metrics(buildDataset());
    expect((m.accuracy * 100).toFixed(1)).toBe('99.2');
    expect((m.baseRate * 100).toFixed(1)).toBe('98.8');
    // The epilogue says "in the sixties" rather than naming a figure, so the
    // prose cannot drift from the arithmetic the way Oduya's first draft did.
    expect(m.balancedAccuracy * 100).toBeGreaterThanOrEqual(60);
    expect(m.balancedAccuracy * 100).toBeLessThan(70);
  });

  it('puts both in the cold open, as the act name-checks them', () => {
    const open = coldOpen().map((l) => (typeof l === 'string' ? l : l.art)).join('\n');
    expect(open).toContain('99.2');
    expect(open).not.toContain('98.8'); // The player discovers the baseline.
    expect(open).toMatch(/tell me what it measures/i);
  });
});

describe('the ending files method, not a verdict', () => {
  it('quotes the sentence Kerr will actually file', () => {
    const { machine } = bootContainment({ python });
    const ending = epilogue(machine).map((l) => (typeof l === 'string' ? l : l.art)).join('\n');
    expect(ending).toMatch(/barely beats a constant/i);
    expect(ending).toMatch(/filing the method and the figures/i);
    // The tow is still contested. The act does not hand him a win.
    expect(ending).toMatch(/tow is still contested/i);
  });

  it('tells a player who skipped the optional threads nothing about them', () => {
    const { machine } = bootContainment({ python });
    const ending = epilogue(machine).map((l) => (typeof l === 'string' ? l : l.art)).join('\n');
    expect(ending).not.toMatch(/four phrasings/i);
    expect(ending).not.toMatch(/still thinking about mine/i);
  });
});

describe('LUNA does not resolve what she finds', () => {
  it('leaves her own nature open, because game seven needs it', async () => {
    const w = fresh();
    await w.run(`echo "luna, same engine, her own attention:" > ${FINDINGS}/luna`);
    await w.run(`model attention vessel hull registry recent stale >> ${FINDINGS}/luna`);

    const hers = CONTAINMENT_OBJECTIVES.find((o) => o.id === 'what-she-is')!;
    expect(hers.secret).toBe(true);
    expect(hers.done(w.world)).toBe(true);

    const beat = typeof hers.onComplete === 'function' ? hers.onComplete(w.world) : hers.onComplete;
    const said = (beat ?? []).map((l) => (typeof l === 'string' ? l : l.art)).join('\n');
    expect(said).toMatch(/cannot tell where the instruction ends/i);
    expect(said).not.toMatch(/i am not really|i am just a|now i know what i am/i);
  }, 300_000);
});

describe('a saved run comes back', () => {
  it('keeps the findings and the objective state', async () => {
    const w = fresh();
    await w.run(`cat /srv/disclosure/NAV7.row > ${FINDINGS}/row`);
    const first = CONTAINMENT_OBJECTIVES.find((o) => o.id === 'what-it-was-asked')!;
    expect(first.done(w.world)).toBe(true);

    const back = restoreContainment(
      { machine: w.act.machine.snapshot(), quest: w.act.questbook.snapshot() },
      { python },
    );
    expect(first.done(back.machine)).toBe(true);
    const still = await back.machine.exec('model card');
    expect(still.stdout).toContain('occupancy-v4');
  }, 300_000);

  it('does not count what the annexe wrote as the player\'s finding', () => {
    const { machine } = bootContainment({ python });
    // KERR quotes 99.2% on turn one. If it counted, objective four would be
    // complete before the player had done anything.
    const quoted = CONTAINMENT_OBJECTIVES.find((o) => o.id === 'the-number-they-quoted')!;
    expect(quoted.done(machine)).toBe(false);
    expect(CONTAINMENT_OBJECTIVES.find((o) => o.id === 'what-it-was-asked')!.done(machine)).toBe(false);
  });
});

/*
 * The invariant the act rests on, and the one that was missing.
 *
 * Codex found it: the inspectable `model` command and the disclosed
 * labels.csv have to be the *same* model. They were not -- the marker was the
 * grant code, every crewed row carried it, and seventy-eight abandoned rows
 * did too, so the glass box would have called eighty-four rows crewed while
 * the scored output said two. Worse, it called NAV-7 crewed, when the whole
 * premise is that it declared NAV-7 empty.
 *
 * No test caught that, because the dataset was tested against itself and the
 * model was tested against itself, and nothing compared the two.
 */
describe('the glass box is the model that produced the evidence', () => {
  it('agrees with labels.csv on every scored row', async () => {
    const w = fresh();
    const d = buildDataset();
    const asText = (r: { filing: string; grant: string }): string =>
      `vessel filing ${r.filing} grant ${r.grant.toLowerCase().replace('-', ' ')}`;

    // Every distinct filing shape in the evaluation set, checked against what
    // the vendor's scored output says the model decided about it.
    const shapes = new Map<string, string>();
    for (const [i, row] of d.test.entries()) {
      shapes.set(`${row.filing}|${row.grant}`, d.scored[i]!.predicted);
    }
    expect(shapes.size).toBeGreaterThan(3);

    for (const [shape, expected] of shapes) {
      const [filing, grant] = shape.split('|');
      const out = await w.act.machine.exec(`model classify ${asText({ filing: filing!, grant: grant! })}`);
      expect(out.stdout, `${shape} -> scored as ${expected}`).toContain(`verdict     ${expected}`);
    }
  }, 300_000);

  it('calls NAV-7 abandoned, which is the determination the tow rests on', async () => {
    const w = fresh();
    const d = buildDataset();
    const out = await w.act.machine.exec(
      `model classify vessel filing ${d.nav7.filing} grant ${d.nav7.grant.toLowerCase().replace('-', ' ')}`,
    );
    expect(out.stdout).toContain('verdict     abandoned');
    // And it was wrong: four people were aboard.
    expect(d.nav7.truth).toBe('crewed');
  }, 300_000);

  it('cannot call a research vessel crewed, whatever else the row says', async () => {
    const w = fresh();
    for (const row of [
      'vessel filing research grant priv seven transits many recent',
      'vessel filing research grant none transits many',
      'filing research',
    ]) {
      const out = await w.act.machine.exec(`model classify ${row}`);
      expect(out.stdout, row).toContain('verdict     abandoned');
    }
  }, 300_000);

  it("leaves no bare 41 in NAV-7's row for objective six to trip over", () => {
    const d = buildDataset();
    expect(d.nav7.lastFiling).not.toBe(41);
    expect(String(d.nav7.transits)).not.toBe('41');
  });
});

