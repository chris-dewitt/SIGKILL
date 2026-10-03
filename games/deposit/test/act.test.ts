import { describe, expect, it } from 'vitest';
import { ROOT_USER } from '@sigkill/machine';
import { Questbook } from '@sigkill/quest';
import { DEPOSIT } from '../src/adventure.js';
import { DEPOSIT_ART, DEPOSIT_OBJECTIVES } from '../src/objectives.js';
import { bootDeposit, saveDeposit } from '../src/world.js';

const required = DEPOSIT_OBJECTIVES.filter((o) => o.optional !== true);

/**
 * The act, played through in one world.
 *
 * `hints.test.ts` runs each ladder in a world of its own, which proves every
 * rung still works and proves nothing about whether they compose. This runs
 * all of them in order, in one world, and asserts the act closes -- the test
 * that would have caught Act I being unfinishable.
 */
describe('the act can be finished', () => {
  it('closes every required objective by its own ladders, in order', async () => {
    const { machine, questbook } = bootDeposit();
    for (const objective of required) {
      for (const step of objective.steps) {
        if (!step.pending(machine)) continue;
        const command = step.rungs.find((r) => r.tier === 'command')!.command!;
        const r = await machine.exec(command);
        expect(r.stderr, `${objective.id}/${step.id}: ${command}`).toBe('');
        machine.tick(1000);
      }
      expect(objective.done(machine), objective.id).toBe(true);
    }
    expect(questbook.complete(machine)).toBe(true);
  }, 120_000);

  /**
   * And the optional two do not hold it open.
   *
   * Which is the whole point of them: an investigation the player can only
   * finish by doing it is not an investigation, and an act that will not end
   * until you have read every file teaches people to stop reading.
   */
  it('without either optional objective being touched', async () => {
    const { machine, questbook } = bootDeposit();
    for (const objective of required) {
      for (const step of objective.steps) {
        if (!step.pending(machine)) continue;
        await machine.exec(step.rungs.find((r) => r.tier === 'command')!.command!);
        machine.tick(1000);
      }
    }
    expect(questbook.complete(machine)).toBe(true);
    for (const id of ['clean-hands', 'where-she-cannot-go']) {
      expect(DEPOSIT_OBJECTIVES.find((o) => o.id === id)!.done(machine), id).toBe(false);
    }
  }, 120_000);
});

/**
 * The save, which is the reason `AdventureSession.snapshot` exists.
 *
 * Five games are one machine. This one is four hosts, and a save holding only
 * the bastion would come back with the player's notes intact, every service
 * they repaired on the other three undone, and the questbook -- stored
 * separately -- still reporting those objectives as met. So the round trip is
 * asserted on the hosts the player is not standing on.
 */
describe('a save keeps the whole floor', () => {
  const fix = async (d: ReturnType<typeof bootDeposit>): Promise<void> => {
    for (const command of [
      "ssh index01 'sudo systemctl start catalogue'",
      "ssh index01 'sudo systemctl enable catalogue'",
      "ssh relay01 'sudo sed -i s/workers=2/workers=8/ /etc/relay/relay.conf'",
      'echo "catalogue was never enabled" > ~/work/handover.txt',
    ]) {
      const r = await d.machine.exec(command);
      expect(r.stderr, command).toBe('');
    }
  };

  it('comes back with every host as it was left', async () => {
    const started = bootDeposit();
    await fix(started);
    // Standing on the store when the browser closed, which is observable:
    // the prompt says so.
    await started.machine.exec('ssh vault01');

    const save = JSON.parse(JSON.stringify(saveDeposit(started)));
    const back = await DEPOSIT.restore(save, {});

    const index = back.machine.network!.resolve('index01')!.machine;
    expect(index.services.get('catalogue')?.state).toBe('active');
    expect(index.services.isEnabled('catalogue')).toBe(true);

    const relay = back.machine.network!.resolve('relay01')!.machine;
    expect(relay.vfs.readText('/etc/relay/relay.conf', ROOT_USER)).toContain('workers=8');

    expect(back.machine.vfs.readText('/home/dewitt/work/handover.txt', ROOT_USER)).toContain(
      'catalogue',
    );
    // vault02 is off, and a save that brought it up would be a save that
    // solved an objective.
    expect(back.machine.network!.resolve('vault02')!.up).toBe(false);
    // Still inside the hop, because the prompt says which host you are on and
    // a save that dropped it would move somebody with no event to explain it.
    expect(back.machine.session.stack.map((m) => m.shell.hostname)).toEqual(['vault01']);
  });

  it('and with the progress those repairs actually earned', async () => {
    const started = bootDeposit();
    await fix(started);
    const afterTheReboot = DEPOSIT_OBJECTIVES.find((o) => o.id === 'after-the-reboot')!;
    expect(afterTheReboot.done(started.machine)).toBe(true);

    const back = await DEPOSIT.restore(JSON.parse(JSON.stringify(saveDeposit(started))), {});
    expect(afterTheReboot.done(back.machine)).toBe(true);

    // The questbook is restored from the same save, so the board and the
    // world agree -- which is the failure this whole seam exists to prevent.
    const fresh = new Questbook(DEPOSIT_OBJECTIVES);
    expect(fresh.status(back.machine).find((r) => r.id === 'after-the-reboot')?.done).toBe(true);
  });

  it('refuses a save with no floor in it rather than half-restoring one', async () => {
    const started = bootDeposit();
    const { fleet: _fleet, ...single } = saveDeposit(started);
    await expect(DEPOSIT.restore(single, {})).rejects.toThrow(/no fleet/);
  });
});

describe('what the act says for itself', () => {
  it('opens on the gap between up and right, and fits a phone', () => {
    const lines = DEPOSIT.coldOpen(bootDeposit().machine);
    const art = lines.filter((line): line is { art: string } => typeof line !== 'string');
    expect(art).toEqual(DEPOSIT_ART);
    for (const { art: row } of art) expect(row.length, row).toBeLessThanOrEqual(34);
    expect(lines.join('\n')).toContain('Do not make it convenient');
    // The two things a new player has to be told exist.
    expect(lines.join('\n')).toContain('objectives');
    expect(lines.join('\n')).toContain('hint');
  });

  it('ends differently for the player who kept their hands clean', async () => {
    const plain = bootDeposit();
    const clean = bootDeposit();
    await clean.machine.exec("ssh vault01 'grep 7714 /var/log/access.log' > ~/work/mine.txt");

    expect(DEPOSIT.epilogue(plain.machine).join('\n')).toContain('still on vault01');
    expect(DEPOSIT.epilogue(clean.machine).join('\n')).toContain('never read it at all');
  });
});
