import { beforeAll, describe, expect, it } from 'vitest';
import { ROOT_USER } from '@sigkill/machine';
import { NodePythonRuntime } from '@sigkill/python/node';
import {
  checkObjective,
  taught,
  validateObjectives,
  type Objective,
  type RouteWorld,
} from '@sigkill/quest';
import { bootHarness, restoreHarness, coldOpen, epilogue } from '../src/world.js';
import { HARNESS_OBJECTIVES, UPLINK_LOG, LEDGER_CSV, COMMS_BUFFER } from '../src/objectives.js';
import {
  DESTINATION,
  LEDGER_KB,
  TRANSIT_BYTES,
  TRANSIT_SECONDS,
  UPLINK_LINES,
  UPLINK_GOOD,
  UPLINK_REJECTED,
  UPLINK_SAMPLES,
  UPLINK_TOTAL,
  uplinkLog,
} from '../src/act1/dump.js';

/**
 * One interpreter for the whole file.
 *
 * Booting Pyodide per test would make this suite minutes long for no extra
 * confidence. The runtime is stateless between requests by construction: the
 * filesystem goes in and comes back out, and the standard streams are reopened
 * before every run precisely so one command cannot poison the next.
 */
const python = new NodePythonRuntime();

beforeAll(async () => {
  await python.ready();
}, 180_000);

const boot = () => bootHarness({ python });

/** A fresh galley, driven the way a host drives one. */
const factory = async (): Promise<RouteWorld> => {
  const h = boot();
  return {
    world: h.machine,
    run: async (command: string) => {
      const result = await h.machine.exec(command);
      h.machine.tick(1000);
      return { stderr: result.stderr };
    },
  };
};

describe('the evidence is arithmetically real', () => {
  /*
   * The test that matters most in this file.
   *
   * Every goal in the act checks for a number, and every one of those numbers
   * is derived from the generated log rather than typed next to it. If that
   * derivation ever breaks, the game tells players who did everything right
   * that they are wrong -- and no hint ladder recovers from that.
   */
  it('sums to the byte figure game two already has in its database', () => {
    // games/archive: INSERT INTO transits VALUES (9903, ..., 2211404096, ...)
    expect(UPLINK_TOTAL).toBe(2_211_404_096);
    expect(UPLINK_TOTAL).toBe(TRANSIT_BYTES);
  });

  it('is eleven minutes of traffic, ending part way through a second', () => {
    expect(TRANSIT_SECONDS).toBe(663);
    expect(Math.round(TRANSIT_SECONDS / 60)).toBe(11);
    // The last transferring sample must be a partial one: a transfer that ends
    // on an exact multiple of the line rate is a transfer somebody scheduled.
    const up = uplinkLog()
      .split('\n')
      .filter((l) => l.endsWith(' up'))
      .map((l) => l.split(' ')[2]!)
      .filter((b) => /^\d+$/.test(b))
      .map(Number);
    expect(up[up.length - 1]).toBeLessThan(Math.max(...up));
    expect(up.reduce((a, b) => a + b, 0)).toBe(UPLINK_TOTAL);
  });

  it('has seventeen ruined lines, of two different kinds', () => {
    const lines = uplinkLog().trimEnd().split('\n').filter((l) => !l.startsWith('#'));
    const cut = lines.filter((l) => l.split(' ').length === 2);
    const dashed = lines.filter((l) => l.split(' ')[2] === '--');
    expect(cut.length + dashed.length).toBe(UPLINK_REJECTED);
    // Both kinds present, because they fail differently: `int("--")` raises
    // ValueError and a two-field line raises IndexError, and a player should
    // meet both rather than catch one and believe they are finished.
    expect(cut.length).toBeGreaterThan(0);
    expect(dashed.length).toBeGreaterThan(0);
  });

  it('counts its own samples the way a careful player would', () => {
    // 840 readings, 823 of which survived being written down, 17 cut short,
    // and three comment lines on top that are nobody's sample.
    expect(UPLINK_SAMPLES).toBe(840);
    expect(UPLINK_GOOD).toBe(823);
    expect(UPLINK_GOOD + UPLINK_REJECTED).toBe(UPLINK_SAMPLES);
    expect(UPLINK_LINES).toBe(UPLINK_SAMPLES + 3);
    expect(UPLINK_LINES).toBe(843);
  });

  it('makes the two questions different questions', () => {
    // If "how many samples" and "how many usable samples" were the same
    // number, objective five would be a restatement of objective one and the
    // whole point of accounting for the rejects would go.
    expect(UPLINK_SAMPLES).not.toBe(UPLINK_GOOD);
  });

  it('has a ledger that agrees with the telemetry to ninety-six bytes', () => {
    expect(LEDGER_KB).toBe(2_211_404);
    expect(UPLINK_TOTAL - LEDGER_KB * 1000).toBe(96);
  });

  /*
   * The trap in objective four, asserted so it cannot be softened by accident.
   *
   * The operator's "2.2 GB" is *correct*. A player who divides by 1024 and
   * concludes the operator inflated the figure is about to say so to an
   * adjuster, and the whole point of that objective is that a test stops him.
   */
  it('makes the operator right, which is what makes the trap a trap', () => {
    expect(Number((UPLINK_TOTAL / 1000 ** 3).toFixed(1))).toBe(2.2);
    expect(Number((UPLINK_TOTAL / 1024 ** 3).toFixed(1))).not.toBe(2.2);
    expect(UPLINK_TOTAL / 1024 ** 3).toBeCloseTo(2.0595305562, 9);
  });
});

describe('the galley builds itself', () => {
  it('gives him a terminal, a letter and four files he did not write', async () => {
    const { machine } = boot();
    expect((await machine.exec('cat HEARING')).stdout).toContain('Bring me a METHOD');
    expect((await machine.exec('cat README')).stdout).toContain('Hollis');

    for (const path of [UPLINK_LOG, LEDGER_CSV, COMMS_BUFFER]) {
      expect((await machine.exec(`wc -l ${path}`)).stderr, path).toBe('');
    }
  });

  it('will not let him edit the evidence', async () => {
    const { machine } = boot();
    const r = await machine.exec(`echo 'nothing to see' > ${UPLINK_LOG}`);
    expect(r.stderr).not.toBe('');
    // And the log is untouched, which is the part that matters.
    expect(machine.vfs.readText(UPLINK_LOG, ROOT_USER)).toContain('fd3');
  });

  it('has Python on it, because the last engineer put it there', async () => {
    const { machine } = boot();
    expect((await machine.exec('python3 -V')).stdout).toMatch(/^Python /);
  });

  it('hides the destination behind base64, so grep alone is not enough', async () => {
    const { machine } = boot();
    const found = await machine.exec(`grep ROUTE ${COMMS_BUFFER}`);
    expect(found.stdout).toContain('ROUTE established');
    expect(found.stdout).not.toContain(DESTINATION);
  });

  it('boots deterministically: the same galley twice, byte for byte', () => {
    const a = boot();
    const b = boot();
    expect(a.machine.vfs.readText(UPLINK_LOG, ROOT_USER)).toBe(
      b.machine.vfs.readText(UPLINK_LOG, ROOT_USER),
    );
    expect(a.machine.snapshot()).toEqual(b.machine.snapshot());
  });
});

describe('the puzzle schema', () => {
  it('is structurally complete, and teaches only commands that exist', () => {
    // A real machine's command map, not the static registry: `python3` is
    // registered per-Machine by the runtime that wraps it, so the static list
    // does not know it exists.
    const { machine } = boot();
    expect(validateObjectives(HARNESS_OBJECTIVES, { commands: machine.shell.commands })).toEqual([]);
  });

  it('teaches Python, testing and reading a difference', () => {
    const skills = taught(HARNESS_OBJECTIVES);
    expect(skills).toContain('python3');
    expect(skills).toContain('diff');
  });

  it('has nine required objectives and two that are only worth doing', () => {
    const required = HARNESS_OBJECTIVES.filter((o) => !o.optional);
    const optional = HARNESS_OBJECTIVES.filter((o) => o.optional);
    expect(required).toHaveLength(9);
    expect(optional.map((o) => o.id)).toEqual(['luna-was-wrong', 'the-other-shoe']);
  });
});

describe('every declared route really works', () => {
  for (const objective of HARNESS_OBJECTIVES) {
    it(`${objective.id}: ${objective.routes.length} routes, ${objective.nearMisses.length} near-misses`, async () => {
      const report = await checkObjective(objective, factory);
      expect(report.problems).toEqual([]);
    }, 300_000);
  }
});

describe('every command hint actually works', () => {
  const byId = new Map(HARNESS_OBJECTIVES.map((o) => [o.id, o]));

  /**
   * Every objective that must be done before this one, in an order that works.
   *
   * The bottom rungs of an objective's prerequisites are run before its own,
   * because that is the world a player asking for this hint is standing in.
   * `the-package` is the reason: its hint copies `uplink.py` and
   * `test_uplink.py`, which the `write-the-test` ladder is what creates. Testing
   * it from an empty home directory would fail for a reason no player will ever
   * meet, and -- worse -- would have hidden whether the ladders compose at all.
   */
  const prerequisites = (objective: Objective, seen = new Set<string>()): Objective[] => {
    const out: Objective[] = [];
    for (const id of objective.requires ?? []) {
      if (seen.has(id)) continue;
      seen.add(id);
      const required = byId.get(id)!;
      out.push(...prerequisites(required, seen), required);
    }
    return out;
  };

  for (const objective of HARNESS_OBJECTIVES) {
    for (const [index, step] of objective.steps.entries()) {
      it(`${objective.id}/${step.id}`, async () => {
        const { machine } = boot();
        const run = async (command: string): Promise<string> => {
          const result = await machine.exec(command);
          machine.tick(1000);
          return result.stderr;
        };

        for (const earlier of [...prerequisites(objective), objective]) {
          for (const priorStep of earlier.steps) {
            if (earlier === objective && priorStep === step) break;
            if (!priorStep.pending(machine)) continue;
            const command = priorStep.rungs.find((r) => r.tier === 'command')!.command!;
            expect(await run(command), `${earlier.id}/${priorStep.id}`).toBe('');
          }
        }
        void index;

        const command = step.rungs.find((r) => r.tier === 'command')!.command!;
        expect(await run(command), command).toBe('');
        expect(step.pending(machine), `${command} did not clear ${step.id}`).toBe(false);
      }, 300_000);
    }
  }
});

describe('the act can be finished', () => {
  it('plays end to end without ever asking for a hint', async () => {
    const { machine, questbook } = boot();
    const run = async (command: string): Promise<string> => {
      const r = await machine.exec(command);
      machine.tick(1000);
      expect(r.stderr, `${command} -> ${r.stderr}`).toBe('');
      return r.stdout;
    };

    // Everything below follows from HEARING, the dump's README and the
    // tracebacks. No hint is taken and none is needed.
    expect(await run('cat HEARING')).toContain('METHOD');
    expect(await run(`cat /srv/recovery/nav7/README`)).toContain('base64');

    // The parser, as a module, so there is something to test.
    const py = [
      'def read(path):',
      '    rows = []',
      '    bad = 0',
      '    for line in open(path):',
      '        line = line.strip()',
      '        if not line or line.startswith("#"):',
      '            continue',
      '        f = line.split()',
      '        try:',
      '            rows.append((f[0], int(f[2]), f[3]))',
      '        except (IndexError, ValueError):',
      '            bad += 1',
      '    return rows, bad',
      '',
      'def total(rows):',
      '    return sum(b for (t, b, s) in rows)',
    ];
    for (const [i, line] of py.entries()) {
      await run(`echo '${line}' ${i === 0 ? '>' : '>>'} uplink.py`);
    }

    const read = `import uplink; rows, bad = uplink.read("${UPLINK_LOG}")`;

    // 1 and 2: how much there is, and what it adds up to.
    await run(
      `python3 -c '${read}; print("samples:", len(rows) + bad); ` +
        `print("total bytes:", uplink.total(rows)); print("rejected:", bad)' > findings.txt`,
    );
    expect(await run('cat findings.txt')).toContain(String(UPLINK_TOTAL));

    // 3: tests, and the report kept off stderr.
    const suite = [
      'import unittest',
      'import uplink',
      '',
      `LOG = "${UPLINK_LOG}"`,
      '',
      'class TestUplink(unittest.TestCase):',
      '    def test_sample_count(self):',
      '        rows, bad = uplink.read(LOG)',
      `        self.assertEqual(len(rows) + bad, ${UPLINK_SAMPLES})`,
      '',
      '    def test_byte_total(self):',
      '        rows, bad = uplink.read(LOG)',
      `        self.assertEqual(uplink.total(rows), ${UPLINK_TOTAL})`,
      '',
      '    def test_rejected(self):',
      '        rows, bad = uplink.read(LOG)',
      `        self.assertEqual(bad, ${UPLINK_REJECTED})`,
      '',
      '    def test_decimal_gigabytes(self):',
      `        self.assertEqual(${UPLINK_TOTAL} / 1000 ** 3, 2.211404096)`,
    ];
    for (const [i, line] of suite.entries()) {
      await run(`echo '${line}' ${i === 0 ? '>' : '>>'} test_uplink.py`);
    }
    await run('python3 -m unittest 2> test-report.txt');
    expect(await run('cat test-report.txt')).toContain('OK');

    // 4: both conversions, so the operator is checked rather than accused.
    await run(
      `python3 -c 'b = ${UPLINK_TOTAL}; print("GB ", b / 1000 ** 3); ` +
        `print("GiB", b / 1024 ** 3)' >> findings.txt`,
    );

    // 6: the same answer twice.
    await run(
      `python3 -c '${read}; print("total bytes:", uplink.total(rows)); ` +
        `print("rejected:", bad)' | tee run-a.txt > run-b.txt`,
    );
    expect(await run('diff run-a.txt run-b.txt')).toBe('');

    // 7: somebody else's arithmetic.
    await run(`grep RG-NAV7-03 ${LEDGER_CSV} > agree.txt`);
    await run(`echo 'telemetry total: ${UPLINK_TOTAL} bytes, 96 apart' >> agree.txt`);

    // 8: where it was going.
    await run(
      `python3 -c 'import base64` +
        `\nfor line in open("${COMMS_BUFFER}"):\n` +
        `    if "ROUTE established" in line:\n` +
        `        print("destination:", base64.b64decode(line.split()[-1]).decode())' > route.txt`,
    );
    expect(await run('cat route.txt')).toContain(DESTINATION);

    // 9: the package.
    await run('mkdir -p hearing');
    await run('cp uplink.py test_uplink.py hearing/');
    await run('cd hearing');
    await run('python3 -m unittest 2> test-report.txt');
    await run(`echo 'METHOD -- the NAV-7 uplink figure, for the adjuster.' > README`);
    await run(`echo 'Run: python3 -m unittest here. The tests must pass.' >> README`);
    await run(`echo 'Result: ${UPLINK_TOTAL} bytes over ${TRANSIT_SECONDS} seconds.' >> README`);

    expect(questbook.complete(machine)).toBe(true);
    expect(questbook.hintsTaken).toBe(0);
  }, 300_000);

  it('has an opening and an ending, and they do not repeat each other', () => {
    const open = coldOpen().map((l) => (typeof l === 'string' ? l : l.art)).join('\n');
    const close = epilogue().map((l) => (typeof l === 'string' ? l : l.art)).join('\n');
    expect(open).toContain('she does not want your answer');
    expect(close).toContain('PART ONE COMPLETE');
    const shared = open.split('\n').filter((l) => l.trim().length > 20 && close.includes(l));
    expect(shared).toEqual([]);
  });

  it('closes on a measurement and not on a theory', () => {
    const close = epilogue().map((l) => (typeof l === 'string' ? l : l.art)).join('\n');
    expect(close).toContain('I am not filing a theory, I am filing a measurement');
    // Canon: do not literalise v43 here. Game three ends with a rented
    // processor and an adjuster who declines to speculate.
    expect(close).not.toContain('v43');
  });
});

describe('saves', () => {
  it('carries his program and his progress through a snapshot', async () => {
    const live = boot();
    await live.machine.exec(
      `python3 -c 'print(len([l for l in open("${UPLINK_LOG}") ` +
        `if l.strip() and not l.startswith("#")]), "samples")' > /home/dewitt/findings.txt`,
    );
    await live.machine.exec(`echo 'x = 1' > /home/dewitt/first.py`);

    const restored = restoreHarness(
      { machine: live.machine.snapshot(), quest: live.questbook.snapshot() },
      { python },
    );
    expect(restored.machine.vfs.readText('/home/dewitt/findings.txt', ROOT_USER)).toContain(
      String(UPLINK_SAMPLES),
    );
    expect(restored.questbook.status(restored.machine).find((o) => o.id === 'open-the-dump')?.done).toBe(
      true,
    );
    // And Python still works on the other side of a restore.
    expect((await restored.machine.exec(`python3 -c 'print(2 + 2)'`)).stdout).toBe('4\n');
  }, 120_000);
});
