import { describe, expect, it } from 'vitest';
import { ROOT_USER } from '@sigkill/machine';
import { validateObjectives } from '@sigkill/quest';
import { bootWreck, COLD_OPEN } from '../src/world.js';
import { WRECK_OBJECTIVES, oxygenTarget } from '../src/objectives.js';

describe('Act I content', () => {
  it('is structurally sound', () => {
    expect(validateObjectives(WRECK_OBJECTIVES)).toEqual([]);
  });

  it('opens on an unbreathable ship with a refused scrubber', () => {
    const { machine } = bootWreck();
    expect(oxygenTarget(machine)).toBe(16);
    expect(machine.services.get('scrubber')?.state).not.toBe('active');
    expect(machine.services.get('reactor')?.state).toBe('active');
  });

  it('tells the player hints exist, in the cold open', () => {
    expect(COLD_OPEN.join('\n')).toContain('hint');
  });
});

/**
 * The test that keeps hints honest.
 *
 * Every bottom rung carries the literal command. Here each one is run against
 * a world sitting on exactly that step, and the step has to stop being
 * pending. A hint that has drifted out of date fails CI instead of stranding
 * somebody at two in the morning.
 */
describe('every command hint actually works', () => {
  for (const objective of WRECK_OBJECTIVES) {
    for (const [index, step] of objective.steps.entries()) {
      it(`${objective.id}/${step.id}`, async () => {
        const { machine } = bootWreck();

        // Walk the world up to this step using the earlier steps' own hints.
        for (const earlier of objective.steps.slice(0, index)) {
          const command = earlier.rungs.find((r) => r.tier === 'command')?.command;
          const result = await machine.exec(command!);
          expect(result.stderr, `${earlier.id}: ${result.stderr}`).toBe('');
        }
        for (const required of objective.requires ?? []) {
          const earlier = WRECK_OBJECTIVES.find((o) => o.id === required)!;
          for (const earlierStep of earlier.steps) {
            const command = earlierStep.rungs.find((r) => r.tier === 'command')?.command;
            await machine.exec(command!);
          }
        }

        expect(step.pending(machine), 'the step should still be pending here').toBe(true);

        const command = step.rungs.find((r) => r.tier === 'command')!.command!;
        const result = await machine.exec(command);
        expect(result.stderr, `${command} -> ${result.stderr}`).toBe('');
        expect(step.pending(machine), `${command} did not clear ${step.id}`).toBe(false);
      });
    }
  }
});

describe('the ladder follows the player, not a script', () => {
  it('opens with a nudge about the refusal, not the answer', async () => {
    const { machine } = bootWreck();
    const r = await machine.exec('hint');
    expect(r.stdout).toContain('refused');
    // Naming the file, the number or the command would end the puzzle here.
    expect(r.stdout).not.toContain('life_support.conf');
    expect(r.stdout).not.toContain('O2_TARGET');
    expect(r.stdout).not.toContain('systemctl');
  });

  it('nudges about starting the service once the number is right', async () => {
    const { machine } = bootWreck();
    await machine.exec("sed -i 's/^O2_TARGET=.*/O2_TARGET=21/' /etc/life_support.conf");
    const r = await machine.exec('hint');
    expect(r.stdout).toContain('has not noticed');
    expect(r.stdout).not.toContain('sudo');
  });

  it('hides the reboot objective behind the one that keeps you alive', async () => {
    const { machine } = bootWreck();
    expect((await machine.exec('objectives')).stdout).toContain('waiting on atmosphere');
    expect((await machine.exec('hint survive-a-reboot')).code).toBe(1);
  });

  it('opens the second objective once the scrubber is running', async () => {
    const { machine } = bootWreck();
    await machine.exec("sed -i 's/^O2_TARGET=.*/O2_TARGET=21/' /etc/life_support.conf");
    await machine.exec('sudo systemctl start scrubber');

    const board = (await machine.exec('objectives')).stdout;
    expect(board).toContain('[x] atmosphere');
    expect(board).toContain('[ ] survive-a-reboot');
    expect((await machine.exec('hint')).stdout).toContain('not safe');
  });
});

/**
 * The invariant the whole engine exists for, applied to objectives: the goal
 * is a fact about the ship, so any honest route there counts.
 */
describe('the objective does not care how you got there', () => {
  const routes: Array<[string, string[]]> = [
    ['sed', ["sed -i 's/O2_TARGET=16/O2_TARGET=21/' /etc/life_support.conf"]],
    ['a redirect, rewriting the file', [
      'echo "# NAV-7 atmosphere controller" > /etc/life_support.conf',
      'echo O2_TARGET=21 >> /etc/life_support.conf',
      'echo SCRUBBER_DUTY=0.4 >> /etc/life_support.conf',
    ]],
    ['grep -v and an append', [
      'grep -v O2_TARGET /etc/life_support.conf > /tmp/conf',
      'echo O2_TARGET=21 >> /tmp/conf',
      'cp /tmp/conf /etc/life_support.conf',
    ]],
    ['a different, still-breathable number', [
      "sed -i 's/O2_TARGET=16/O2_TARGET=23/' /etc/life_support.conf",
    ]],
  ];

  for (const [name, commands] of routes) {
    it(`accepts: ${name}`, async () => {
      const { machine } = bootWreck();
      const atmosphere = WRECK_OBJECTIVES.find((o) => o.id === 'atmosphere')!;
      expect(atmosphere.done(machine)).toBe(false);

      for (const command of commands) {
        const r = await machine.exec(command);
        expect(r.stderr, `${command} -> ${r.stderr}`).toBe('');
      }
      const start = await machine.exec('sudo systemctl start scrubber');
      expect(start.stderr, start.stderr).toBe('');
      expect(atmosphere.done(machine)).toBe(true);
    });
  }

  it('still refuses a target outside the breathable band', async () => {
    const { machine } = bootWreck();
    await machine.exec("sed -i 's/O2_TARGET=16/O2_TARGET=40/' /etc/life_support.conf");
    const r = await machine.exec('sudo systemctl start scrubber');
    expect(r.stderr + r.stdout).toContain('19-23');
    expect(machine.services.get('scrubber')?.state).not.toBe('active');
  });

  it('survives the config being deleted outright', async () => {
    const { machine } = bootWreck();
    // /etc is root's, so this needs sudo -- which is itself worth asserting.
    expect((await machine.exec('rm /etc/life_support.conf')).code).not.toBe(0);
    expect((await machine.exec('sudo rm /etc/life_support.conf')).code).toBe(0);
    expect(oxygenTarget(machine)).toBe(null);
    expect(machine.vfs.exists('/etc/life_support.conf', ROOT_USER)).toBe(false);
    const r = await machine.exec('hint');
    expect(r.code).toBe(0);
  });
});
