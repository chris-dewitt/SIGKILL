import { describe, expect, it } from 'vitest';
import type { Objective } from '@sigkill/quest';
import { bootDeposit } from '../src/world.js';
import { DEPOSIT_OBJECTIVES } from '../src/objectives.js';

/**
 * The test that keeps hints honest.
 *
 * Every bottom rung carries the literal command. Each one is run here against
 * a world standing where a player asking for that hint would be standing --
 * prerequisite objectives satisfied by their own ladders -- and the step has
 * to stop being pending. A hint that has drifted fails CI instead of stranding
 * somebody at two in the morning.
 *
 * `clean-hands/and-not-you` is the one deliberate exception in this adventure
 * and has a test of its own below.
 */
describe('every command hint actually works', () => {
  const byId = new Map(DEPOSIT_OBJECTIVES.map((o) => [o.id, o]));

  /** Everything that must be done first, in an order that works. */
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

  for (const objective of DEPOSIT_OBJECTIVES) {
    for (const step of objective.steps) {
      it(`${objective.id}/${step.id}`, async () => {
        const { machine } = bootDeposit();
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

        const command = step.rungs.find((r) => r.tier === 'command')!.command!;
        expect(await run(command), command).toBe('');
        expect(step.pending(machine), `${command} did not clear ${step.id}`).toBe(false);
      }, 120_000);
    }
  }
});

/**
 * The one objective that can be lost, and the fact that it stays lost.
 *
 * `clean-hands` rests on the store's record, and the store records a read the
 * moment it serves one. A player who opens their own matter cannot complete
 * the objective afterwards -- not by writing a file, not by copying the log,
 * not by deleting it -- and the last rung of the ladder is where the game says
 * so. All four of those are asserted here, because the whole objective is a
 * claim about what a record is, and a record you can get out of is not one.
 */
describe('clean-hands rests on something the player cannot edit', () => {
  const cleanHands = DEPOSIT_OBJECTIVES.find((o) => o.id === 'clean-hands')!;
  const theForfeit = cleanHands.steps.find((s) => s.id === 'and-not-you')!;

  /** The record as it stands, or nothing at all if somebody removed it. */
  const record = (d: ReturnType<typeof bootDeposit>): string => {
    const vault = d.network.resolve('vault01')!.machine;
    try {
      return vault.vfs.readText('/var/log/access.log', { uid: 0, gid: 0, name: 'root' });
    } catch {
      return '';
    }
  };

  it('is still completable after reading somebody else, which is the job', async () => {
    const d = bootDeposit();
    await d.machine.exec("ssh vault01 'deposit get 7719/manifest' > ~/work/7719.txt");
    await d.machine.exec("ssh vault01 'grep 7714 /var/log/access.log' > ~/work/mine.txt");
    expect(record(d)).toContain('dewitt 7719/manifest');
    expect(cleanHands.done(d.machine)).toBe(true);
  });

  it('is lost the moment the store serves him his own matter', async () => {
    const d = bootDeposit();
    await d.machine.exec("ssh vault01 'grep 7714 /var/log/access.log' > ~/work/mine.txt");
    expect(cleanHands.done(d.machine)).toBe(true);
    expect(theForfeit.pending(d.machine)).toBe(false);

    await d.machine.exec("ssh vault01 'deposit get 7714/manifest'");
    expect(cleanHands.done(d.machine)).toBe(false);
    expect(theForfeit.pending(d.machine)).toBe(true);
  });

  it('stays lost, including to somebody who deletes the record', async () => {
    const d = bootDeposit();
    await d.machine.exec("ssh vault01 'grep 7714 /var/log/access.log' > ~/work/mine.txt");
    await d.machine.exec("ssh vault01 'deposit get 7714/disclosure.txt'");
    expect(cleanHands.done(d.machine)).toBe(false);

    // His notes still have the tribunal's two lines. The record does not.
    await d.machine.exec("ssh vault01 'sudo rm /var/log/access.log'");
    expect(record(d)).not.toContain('dewitt');
    expect(cleanHands.done(d.machine)).toBe(false);
  });

  /*
   * The hole this used to have.
   *
   * Root on vault01 means its log is a file he can rewrite. Both of these
   * trim his own line out and keep every tribunal line, and the first of them
   * used to complete the objective. The ledger is why neither does now.
   */
  for (const trim of [
    "ssh vault01 \"sudo sed -i '/dewitt/d' /var/log/access.log\"",
    "ssh vault01 'grep -v dewitt /var/log/access.log > /tmp/a; sudo cp /tmp/a /var/log/access.log'",
    "ssh vault01 'grep -v dewitt /var/log/access.log > /tmp/a; sudo mv /tmp/a /var/log/access.log'",
  ]) {
    it(`stays lost to somebody who trims his own line: ${trim}`, async () => {
      const d = bootDeposit();
      await d.machine.exec("ssh vault01 'grep 7714 /var/log/access.log' > ~/work/mine.txt");
      await d.machine.exec("ssh vault01 'deposit get 7714/disclosure.txt'");

      const r = await d.machine.exec(trim);
      expect(r.stderr, trim).toBe('');
      expect(record(d)).not.toContain('dewitt');
      expect(record(d)).toContain(`tribunal 7714/disclosure.txt`);

      expect(cleanHands.done(d.machine)).toBe(false);
      expect(theForfeit.pending(d.machine)).toBe(true);
    });
  }

  it('refuses to serve anything once it cannot record it', async () => {
    const d = bootDeposit();
    await d.machine.exec("ssh vault01 'sudo rm /var/log/access.log'");
    const r = await d.machine.exec("ssh vault01 'deposit get 7719/manifest'");
    expect(r.code).not.toBe(0);
    expect(r.stdout).toBe('');
    expect(r.stderr).toContain('refusing to serve');
  });
});
