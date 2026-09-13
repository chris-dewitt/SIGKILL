import { describe, expect, it } from 'vitest';
import { ROOT_USER } from '@sigkill/machine';
import { validateObjectives } from '@sigkill/quest';
import { bootWreck, restoreWreck, coldOpen, epilogue } from '../src/world.js';
import type { BeatLine } from '@sigkill/quest';

/** A beat as plain text, art rows included, for asserting on what it says. */
function spoken(lines: readonly BeatLine[]): string {
  return lines.map((line) => (typeof line === 'string' ? line : line.art)).join('\n');
}

/** The cold open of a fresh boot. */
function opening(): string {
  return spoken(coldOpen(bootWreck().machine));
}
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
    expect(opening()).toContain('hint');
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

  it('reports the act finished only once every objective is done', async () => {
    const { machine, questbook } = bootWreck();
    expect(questbook.complete(machine)).toBe(false);

    // The whole act, in the order a player meets it. Each line must leave the
    // act unfinished except the last, or an objective has stopped mattering.
    const route = [
      "sed -i 's/^O2_TARGET=.*/O2_TARGET=21/' /etc/life_support.conf",
      'sudo systemctl start scrubber',
      'sudo systemctl enable scrubber',
      'sudo chmod +x /usr/local/bin/hull-check',
      'sudo systemctl start hull-monitor',
      'sudo systemctl enable hull-monitor',
      "sed -i 's/^SEALED=.*/SEALED=yes/' /etc/hull/c7.conf",
    ];

    for (const [index, command] of route.entries()) {
      const r = await machine.exec(command);
      expect(r.stderr, `${command} -> ${r.stderr}`).toBe('');
      const isLast = index === route.length - 1;
      expect(questbook.complete(machine), `after: ${command}`).toBe(isLast);
    }
  });

  it('a save that has started the scrubber still refuses a bad target after restore', async () => {
    const live = bootWreck();
    await live.machine.exec("sed -i 's/^O2_TARGET=.*/O2_TARGET=21/' /etc/life_support.conf");
    await live.machine.exec('sudo systemctl start scrubber');
    live.questbook.hint(live.machine);

    const saved = restoreWreck({
      machine: live.machine.snapshot(),
      quest: live.questbook.snapshot(),
    });

    expect(saved.machine.services.get('scrubber')?.state).toBe('active');
    expect(saved.questbook.hintsTaken).toBe(1);

    await saved.machine.exec('sudo systemctl stop scrubber');
    await saved.machine.exec("sed -i 's/^O2_TARGET=.*/O2_TARGET=16/' /etc/life_support.conf");
    const start = await saved.machine.exec('sudo systemctl start scrubber');
    expect(start.stderr).toContain('19-23');
  });

  /**
   * The playthrough that found every content bug so far.
   *
   * It follows only what the world itself says -- the note, the boot log, the
   * unit status, Vasquez's own history -- and never types `hint`. If this
   * passes, Act I is finishable by somebody who reads. If it fails, the
   * writing is wrong, whatever the unit tests say.
   */
  it('can be played end to end without ever asking for a hint', async () => {
    const { machine, questbook } = bootWreck();

    // Puzzle one: the ship names the number it objects to.
    expect((await machine.exec('cat README')).stdout).toContain('systemctl status scrubber');
    expect((await machine.exec('systemctl status scrubber')).stdout).toContain('O2_TARGET=16');
    await machine.exec("sed -i 's/^O2_TARGET=.*/O2_TARGET=21/' /etc/life_support.conf");
    await machine.exec('sudo systemctl start scrubber');
    expect(machine.services.get('scrubber')?.state).toBe('active');

    // Puzzle two: Vasquez's own notes explain start versus enable.
    expect((await machine.exec('cat /home/vasquez/notes/scrubber-notes.txt')).stdout)
      .toContain('systemctl enable scrubber');
    await machine.exec('sudo systemctl enable scrubber');

    // Puzzle three: a second unit was failing the whole time, and says why.
    const failed = await machine.exec('systemctl --failed');
    expect(failed.stdout).toContain('hull-monitor');
    const why = await machine.exec('systemctl status hull-monitor');
    expect(why.stdout).toContain('/usr/local/bin/hull-check');
    expect(why.stdout).toContain('Permission denied');
    // And `ls -l` is where the missing bit is visible.
    expect((await machine.exec('ls -l /usr/local/bin/hull-check')).stdout).toMatch(/^-rw-r--r--/);
    await machine.exec('sudo chmod +x /usr/local/bin/hull-check');
    expect((await machine.exec('ls -l /usr/local/bin/hull-check')).stdout).toMatch(/^-rwxr-xr-x/);
    await machine.exec('sudo systemctl start hull-monitor');
    await machine.exec('sudo systemctl enable hull-monitor');
    expect(machine.services.get('hull-monitor')?.state).toBe('active');

    // Puzzle four: the log names the compartment, and only search finds it.
    const drops = await machine.exec('grep PRESSURE_DROP /var/log/hull.log');
    expect(drops.stdout).toContain('C7');
    const tally = await machine.exec(
      "grep PRESSURE_DROP /var/log/hull.log | cut -d' ' -f2 | sort | uniq -c",
    );
    expect(tally.stderr).toBe('');
    expect(tally.stdout).toContain('C7');
    // And the fix Vasquez wrote for herself works, mode bits and all.
    expect((await machine.exec('sudo chmod +x /home/vasquez/notes/seal.sh')).stderr).toBe('');
    const seal = await machine.exec('sudo /home/vasquez/notes/seal.sh c7');
    expect(seal.stderr, seal.stderr).toBe('');
    expect(seal.stdout).toContain('SEALED=yes');

    expect(questbook.complete(machine)).toBe(true);
    expect(questbook.hintsTaken).toBe(0);
  });

  it('has an ending to play, in ORACLE\'s voice', () => {
    const ending = epilogue(bootWreck().machine);
    expect(ending.length).toBeGreaterThan(10);
    const text = spoken(ending);
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
    expect((await machine.exec('objectives')).stdout)
      .toContain('locked until: Get the atmosphere scrubber running');
    expect((await machine.exec('hint survive-a-reboot')).code).toBe(1);
  });

  it('opens the second objective once the scrubber is running', async () => {
    const { machine } = bootWreck();
    await machine.exec("sed -i 's/^O2_TARGET=.*/O2_TARGET=21/' /etc/life_support.conf");
    await machine.exec('sudo systemctl start scrubber');

    const board = (await machine.exec('objectives')).stdout;
    expect(board).toContain('[x] Get the atmosphere scrubber running');
    expect(board).toContain('[ ] Make the scrubber come back on its own');
    expect((await machine.exec('hint')).stdout).toContain('not safe');
  });
});

/**
 * From the playtest: Chris finished the first puzzle and asked *me* what to do
 * next, while `hint` existed and the chip bar had quietly dropped it. A board
 * the player has to know to ask for is a board most players never see.
 */
describe('the player can always tell what they are doing', () => {
  it('names the objective in their words, not the content\'s id', async () => {
    const { machine } = bootWreck();
    const board = (await machine.exec('objectives')).stdout;
    expect(board).toContain('Get the atmosphere scrubber running');
    expect(board).not.toContain('[ ] atmosphere');
  });

  it('marks which one they are on', async () => {
    const { machine } = bootWreck();
    expect((await machine.exec('objectives')).stdout)
      .toContain('> [ ] Get the atmosphere scrubber running');
  });

  it('says what is in front of them right now, not just the destination', async () => {
    const { machine } = bootWreck();
    expect((await machine.exec('objectives')).stdout).toContain('now: put O2_TARGET back');
  });

  it('moves "now" to the next step within the same objective', async () => {
    const { machine } = bootWreck();
    await machine.exec("sed -i 's/^O2_TARGET=.*/O2_TARGET=21/' /etc/life_support.conf");
    const board = (await machine.exec('objectives')).stdout;
    expect(board).toContain('now: start the scrubber');
    expect(board).not.toContain('now: put O2_TARGET back');
  });

  it('counts progress through the act', async () => {
    const { machine } = bootWreck();
    expect((await machine.exec('objectives')).stdout).toContain('0 of 4 done');
  });

  it('gives every step a label, or the board has nothing to say', () => {
    for (const objective of WRECK_OBJECTIVES) {
      for (const step of objective.steps) {
        expect(step.label, `${objective.id}/${step.id}`).toBeTruthy();
        expect((step.label ?? '').length, `${objective.id}/${step.id}`).toBeGreaterThan(8);
        // A label is a phrase, not a sentence: it sits after "now:".
        expect(step.label ?? '', `${objective.id}/${step.id}`).not.toMatch(/\.$/);
      }
    }
  });

  it('offers the way out of being stuck every time the board is drawn', async () => {
    const { machine } = bootWreck();
    expect((await machine.exec('objectives')).stdout).toContain('hint');
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

/**
 * From the first playthrough: `systemctl start` is silent on success, which is
 * correct Unix, so the moment the air came back after eleven years landed in
 * total silence. The machine stays quiet; ORACLE answers.
 */
describe('the ship reacts when you fix it', () => {
  it('says something the moment the scrubber starts', async () => {
    const { machine, questbook } = bootWreck();
    await machine.exec("sed -i 's/^O2_TARGET=.*/O2_TARGET=21/' /etc/life_support.conf");
    expect(questbook.drainCompleted(machine)).toHaveLength(0);

    await machine.exec('sudo systemctl start scrubber');
    const closed = questbook.drainCompleted(machine);
    expect(closed.map((o) => o.id)).toEqual(['atmosphere']);
    expect(spoken(closed[0]?.onComplete ?? [])).toContain('It started');
  });

  it('plays each beat exactly once, however the player got there', async () => {
    const { machine, questbook } = bootWreck();
    await machine.exec("sed -i 's/^O2_TARGET=.*/O2_TARGET=21/' /etc/life_support.conf");
    await machine.exec('sudo systemctl start scrubber');
    expect(questbook.drainCompleted(machine)).toHaveLength(1);
    // Asking again must not replay it.
    expect(questbook.drainCompleted(machine)).toHaveLength(0);
  });

  it('every objective has a beat, so no completion is silent', () => {
    for (const objective of WRECK_OBJECTIVES) {
      expect(objective.onComplete?.length, `${objective.id} needs a beat`).toBeGreaterThan(0);
    }
  });

  it('does not repeat itself between the last beat and the ending', () => {
    const last = spoken(WRECK_OBJECTIVES.at(-1)?.onComplete ?? []);
    const ending = spoken(epilogue(bootWreck().machine));
    // The final beat is about the hatch; the ending is about the act. Sharing
    // a sentence between them is how an ending stops feeling like one.
    expect(last).toContain('closed');
    expect(ending).not.toContain('ALARM CLEARED');
    const shared = last.split('\n').filter((line) => line.trim().length > 20 && ending.includes(line));
    expect(shared, 'the last beat and the ending share a line').toEqual([]);
  });

  /*
   * Checked against *every* beat, not just the last one. Comparing only the
   * last let a real duplication through: the hull-watch beat spent the whole
   * clipboard reveal -- the number ORACLE has recited for eleven years without
   * having measured it -- and the epilogue then made the same confession over
   * again, so the ending had nothing left to be about.
   */
  it('spends each reveal once, across the whole act', () => {
    const ending = spoken(epilogue(bootWreck().machine)).split('\n');
    for (const objective of WRECK_OBJECTIVES) {
      const beat = spoken(objective.onComplete ?? []).split('\n');
      for (const line of beat) {
        const prose = line.replace(/^ORACLE: /, '').trim();
        if (prose.length < 25) continue;
        expect(
          ending.some((e) => e.includes(prose)),
          `${objective.id}'s beat and the ending both say: ${prose}`,
        ).toBe(false);
      }
    }
  });

  it('keeps the clipboard confession for the ending alone', () => {
    const ending = spoken(epilogue(bootWreck().machine));
    expect(ending).toContain('clipboard');
    for (const objective of WRECK_OBJECTIVES) {
      expect(spoken(objective.onComplete ?? []), `${objective.id}`).not.toContain('clipboard');
    }
  });
});

/**
 * Numbers ORACLE says out loud, checked against the ship.
 *
 * The hints quote counts -- 540 lines, 68 matches, nine compartments -- because
 * a specific number is what makes a machine sound like it has actually looked.
 * It also means a change to the telemetry generator can quietly turn ORACLE
 * into a liar, and a hint that is wrong about a number is worse than no hint.
 */
describe('the numbers in the writing are the numbers in the world', () => {
  const said = (text: string): boolean =>
    WRECK_OBJECTIVES.some((o) =>
      o.steps.some((st) => st.rungs.some((r) => r.lines.join(' ').includes(text))) ||
      (o.onComplete ?? []).join(' ').includes(text),
    );

  it('has as many telemetry lines as it claims', async () => {
    const { machine } = bootWreck();
    const count = Number((await machine.exec('wc -l < /var/log/hull.log')).stdout.trim());
    expect(count).toBe(540);
    expect(said('five hundred and forty'), 'the hints should quote 540').toBe(true);
    expect(said('540')).toBe(true);
  });

  it('has as many pressure drops as it claims', async () => {
    const { machine } = bootWreck();
    const count = Number((await machine.exec('grep -c PRESSURE_DROP /var/log/hull.log')).stdout.trim());
    expect(count).toBe(68);
    expect(said('sixty-eight'), 'the hints should quote 68').toBe(true);
  });

  it('names two compartments in the log and only two', async () => {
    const { machine } = bootWreck();
    const tally = await machine.exec(
      "grep PRESSURE_DROP /var/log/hull.log | cut -d' ' -f2 | sort | uniq -c",
    );
    const names = tally.stdout.trim().split('\n').map((l) => l.trim().split(/\s+/)[1]);
    expect(names).toEqual(['C2', 'C7']);
  });

  it('leaves C2 in the past and C7 running to the last line', async () => {
    const { machine } = bootWreck();
    const lastC2 = (await machine.exec('grep C2 /var/log/hull.log | grep DROP | tail -1')).stdout;
    const lastAll = (await machine.exec('tail -1 /var/log/hull.log')).stdout;
    expect(lastAll).toContain('C9');
    const lastC7 = (await machine.exec('grep C7 /var/log/hull.log | tail -1')).stdout;
    expect(lastC7).toContain('PRESSURE_DROP');
    // C2's last drop must be strictly older than C7's, or the dates do not
    // settle the question the way the hint says they do.
    expect(lastC2.slice(0, 16) < lastC7.slice(0, 16)).toBe(true);
  });

  it('has nine compartments, as everything aboard says it does', async () => {
    const { machine } = bootWreck();
    const files = (await machine.exec('ls /etc/hull')).stdout.trim().split(/\s+/);
    expect(files).toHaveLength(9);
  });

  it('opens with exactly one compartment unsealed', async () => {
    const { machine } = bootWreck();
    const open = (await machine.exec('grep -l "SEALED=no" /etc/hull/*.conf')).stdout.trim();
    expect(open).toBe('/etc/hull/c7.conf');
  });
});

/**
 * The rule this enforces, which is worth more than the test:
 *
 *   **The hint system must never be the only path.** It is a safety net. Every
 *   command an objective actually requires has to be reachable from something
 *   in the world -- the note, a log, an error message, or `man` -- by a player
 *   who never types `hint` at all.
 *
 * This was found by Chris asking "how is the player supposed to know
 * `sudo systemctl start scrubber`?" The answer was: from `man systemctl`, which
 * has it -- and nothing in the game had ever mentioned that `man` exists.
 */
describe('every required command is discoverable without the hint system', () => {
  /** Everything the player can read that is not a hint. */
  async function worldText(): Promise<string> {
    const { machine } = bootWreck();
    const sources = [
      'cat README',
      'cat /var/log/boot.log',
      'systemctl status scrubber',
      'systemctl status hull-monitor',
      'systemctl',
      'man systemctl',
      'man sudo',
      'man chmod',
      'man grep',
      'help',
      'cat /home/vasquez/.bash_history',
      'cat /home/vasquez/notes/hull-notes.txt',
      'cat /home/vasquez/notes/todo',
      'cat /mnt/deck-c/README',
    ];
    let all = opening();
    for (const s of sources) {
      const r = await machine.exec(s);
      all += '\n' + r.stdout + r.stderr;
    }
    return all;
  }

  it('the cold open teaches man before it offers hint', () => {
    const text = opening();
    expect(text).toContain('man ');
    expect(text.indexOf('man ')).toBeLessThan(text.indexOf('hint'));
  });

  it('the note sends the player to the manual, not to the daemon', async () => {
    const { machine } = bootWreck();
    const readme = (await machine.exec('cat README')).stdout;
    expect(readme).toContain('man systemctl');
  });

  it('names systemctl start somewhere a player can find it', async () => {
    expect(await worldText()).toContain('start');
  });

  it('explains that starting a service needs privilege', async () => {
    expect(await worldText()).toMatch(/sudo/);
  });

  it('a bare systemctl points somewhere useful', async () => {
    const { machine } = bootWreck();
    const r = await machine.exec('systemctl');
    expect(r.stdout).toContain('man systemctl');
  });

  it('names chmod +x somewhere a player who never asks for a hint can find it', async () => {
    const text = await worldText();
    expect(text).toContain('chmod +x');
  });

  it('names grep and the log it is for', async () => {
    const text = await worldText();
    expect(text).toContain('grep');
    expect(text).toContain('/var/log/hull.log');
  });

  it('says which compartment configuration file to look at', async () => {
    const text = await worldText();
    expect(text).toContain('/etc/hull');
  });

  it('man chmod explains the execute bit, on both tracks', async () => {
    for (const track of ['operator', 'cadet'] as const) {
      const { machine } = bootWreck({ track });
      const page = (await machine.exec('man chmod')).stdout;
      expect(page, `${track} track`).toMatch(/\+x|execut/i);
    }
  });

  it('man systemctl actually documents start and enable, on both tracks', async () => {
    for (const track of ['operator', 'cadet'] as const) {
      const { machine } = bootWreck({ track });
      const page = (await machine.exec('man systemctl')).stdout;
      expect(page, `${track} track`).toContain('start');
      expect(page, `${track} track`).toContain('enable');
    }
  });
});

/**
 * The board prints titles, so the titles have to be what the player types.
 * Found by Codex on the colour pass.
 */
describe('the board and the hint command agree on names', () => {
  it('takes a title from the board', async () => {
    const { machine } = bootWreck();
    expect((await machine.exec('hint Get the atmosphere scrubber running')).code).toBe(0);
  });

  it('takes a prefix of one', async () => {
    const { machine } = bootWreck();
    expect((await machine.exec('hint Get the atmosphere')).code).toBe(0);
  });

  it('every title on the board can be asked about once it is unlocked', async () => {
    const { machine } = bootWreck();
    const route = [
      "sed -i 's/^O2_TARGET=.*/O2_TARGET=21/' /etc/life_support.conf",
      'sudo systemctl start scrubber',
      'sudo systemctl enable scrubber',
      'sudo chmod +x /usr/local/bin/hull-check',
      'sudo systemctl start hull-monitor',
      'sudo systemctl enable hull-monitor',
    ];
    // Walk the act, and at each point the objective the board marks as
    // current must be askable by the exact words the board printed.
    for (const step of ['', ...route]) {
      if (step !== '') await machine.exec(step);
      const board = (await machine.exec('objectives')).stdout;
      const current = /^> \[ \] (.+)$/m.exec(board)?.[1];
      if (current === undefined) continue;
      const asked = await machine.exec(`hint ${current}`);
      expect(asked.code, `hint ${current}`).toBe(0);
    }
  });

  it('suggests real titles when the name is wrong', async () => {
    const { machine } = bootWreck();
    const r = await machine.exec('hint whatever');
    expect(r.stderr).toContain('Get the atmosphere scrubber running');
  });
});
