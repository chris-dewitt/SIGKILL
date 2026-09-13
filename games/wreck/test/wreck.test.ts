import { describe, expect, it } from 'vitest';
import { ROOT_USER } from '@sigkill/machine';
import { validateObjectives } from '@sigkill/quest';
import { bootWreck, COLD_OPEN, EPILOGUE } from '../src/world.js';
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

/**
 * The bug that made Act I unfinishable, and the one that made it end in
 * silence. Both were content, both were found by playing rather than testing,
 * and both now have a test that would have caught them.
 */
describe('Act I can actually be finished', () => {
  it('tells the player the number on a cold boot, as the README promises', async () => {
    const { machine } = bootWreck();

    // This is the exact command the README and the first hint send them to,
    // before they have done anything else.
    const status = await machine.exec('systemctl status scrubber');
    expect(status.stdout).toContain('O2_TARGET=16');
    expect(status.stdout).toContain('19-23');
    expect(status.stdout).toContain('failed');
  });

  it('has the refusal in the boot log too, with the number', async () => {
    const { machine } = bootWreck();
    const log = (await machine.exec('grep O2 /var/log/boot.log')).stdout;
    expect(log).toContain('O2_TARGET=16');
    expect(log).toContain('19-23');
  });

  it('the README does not promise anything the ship will not say', async () => {
    const { machine } = bootWreck();
    const readme = (await machine.exec('cat README')).stdout;
    // Every command the note tells the player to run has to work from a
    // cold boot and tell them something.
    for (const cmd of ['systemctl status scrubber', 'ls /etc']) {
      expect(readme, `README should send them to: ${cmd}`).toContain(cmd);
      const r = await machine.exec(cmd);
      expect(r.code, `${cmd} should run`).toBeLessThan(4);
      expect(r.stdout.length, `${cmd} should say something`).toBeGreaterThan(0);
    }
  });

  it('reports the act finished once both objectives are done', async () => {
    const { machine, questbook } = bootWreck();
    expect(questbook.complete(machine)).toBe(false);

    await machine.exec("sed -i 's/^O2_TARGET=.*/O2_TARGET=21/' /etc/life_support.conf");
    await machine.exec('sudo systemctl start scrubber');
    expect(questbook.complete(machine)).toBe(false);

    await machine.exec('sudo systemctl enable scrubber');
    expect(questbook.complete(machine)).toBe(true);
  });

  it('has an ending to play, in ORACLE\'s voice', () => {
    expect(EPILOGUE.length).toBeGreaterThan(10);
    const text = EPILOGUE.join('\n');
    expect(text).toContain('ORACLE:');
    expect(text).toContain('ACT I COMPLETE');
    // It closes the story it opened: Vasquez, and why she stopped.
    expect(text).toContain('Vasquez');
  });
});

describe('the ladder follows the player, not a script', () => {
  // The line the first rung walks: telling the player how to *diagnose* is not
  // a spoiler and is the whole lesson; telling them the fix ends the puzzle.
  it('opens by handing over a diagnostic, not the fix', async () => {
    const { machine } = bootWreck();
    const r = await machine.exec('hint');

    expect(r.stdout).toContain('refused');
    expect(r.stdout).toContain('systemctl status scrubber');

    expect(r.stdout).not.toContain('life_support.conf');
    expect(r.stdout).not.toContain('O2_TARGET');
    // 'sed' on its own matches the word "refused"; the command is what matters.
    expect(r.stdout).not.toContain('sed -i');
    expect(r.stdout).not.toContain('=21');
  });

  it('gives a command the player can actually run on every rung', async () => {
    const { machine } = bootWreck();
    // Three asks on the opening step; each one should name something typeable.
    for (let i = 0; i < 3; i++) {
      const r = await machine.exec('hint');
      expect(r.stdout, `rung ${i + 1}`).toMatch(/systemctl|ls |cat |grep |vi |nano |sed /);
    }
  });

  it('offers an editor before it offers sed', async () => {
    const { machine } = bootWreck();
    await machine.exec('hint');
    await machine.exec('hint');
    const answer = (await machine.exec('hint')).stdout;
    expect(answer).toContain('vi /etc/life_support.conf');
    expect(answer).toContain('nano /etc/life_support.conf');
    expect(answer.indexOf('vi /etc')).toBeLessThan(answer.indexOf('sed -i'));
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
