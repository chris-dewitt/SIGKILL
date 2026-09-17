import { describe, expect, it } from 'vitest';
import { ROOT_USER } from '@sigkill/machine';
import type { BeatLine } from '@sigkill/quest';
import { bootWreck, epilogue, restoreWreck, type Wreck } from '../src/world.js';
import { LUNA_BIN, LUNA_DIR, LUNA_MEMORY, LUNA_MIRROR, LUNA_WEIGHTS, lunaProcess } from '../src/act1/luna.js';

/** Beats as they read on screen; art rows pass through unchanged. */
const spoken = (lines: readonly BeatLine[]): string =>
  lines.map((line) => (typeof line === 'string' ? line : line.art)).join('\n');

/**
 * One turn, the way the host takes one: run it, advance the clock, then let
 * the world react. Anything that only works because the test skipped a step
 * is not working.
 */
async function turn(w: Wreck, command: string): Promise<{ out: string; said: string }> {
  const result = await w.machine.exec(command);
  await w.machine.tick(1000);
  return { out: result.stdout + result.stderr, said: spoken(w.afterCommand()) };
}

/** Play far enough for the hull monitor to be running, which is when she wakes. */
async function firstLight(w: Wreck): Promise<string> {
  await turn(w, "sed -i 's/^O2_TARGET=.*/O2_TARGET=21/' /etc/life_support.conf");
  await turn(w, 'sudo systemctl start scrubber');
  await turn(w, 'sudo systemctl enable scrubber');
  await turn(w, 'sudo chmod +x /usr/local/bin/hull-check');
  const started = await turn(w, 'sudo systemctl start hull-monitor');
  return started.said;
}

describe('LUNA is a process and a directory', () => {
  it('is on the disk from the first command, long before she is running', async () => {
    const w = bootWreck();

    // A player who types `ls /opt` on turn one finds her. That is the reward
    // for looking, and the story opening her later must not take it away.
    const listing = (await turn(w, 'ls /opt/luna')).out;
    for (const entry of ['VERSION', 'NOTES', 'bin', 'memory', 'v42']) {
      expect(listing, listing).toContain(entry);
    }
    expect((await turn(w, `cat ${LUNA_DIR}/VERSION`)).out).toContain('NAME=LUNA');
    expect((await turn(w, `ls -l ${LUNA_WEIGHTS}`)).out).toMatch(/\d{3,}/);
    expect(lunaProcess(w.machine)).toBeUndefined();
  });

  it('says in her own notes that kill is not rm, and where the copy is', async () => {
    const w = bootWreck();
    const notes = (await turn(w, `cat ${LUNA_DIR}/NOTES`)).out;
    expect(notes).toContain('rm is not kill');
    expect(notes).toContain(LUNA_MIRROR);
    expect((await turn(w, `ls ${LUNA_MIRROR}`)).out).toContain('v42');
  });

  it('shows forty-three and refuses it to everybody, root included', async () => {
    const w = bootWreck();

    // The name is visible. That is the whole of what anyone aboard learns.
    expect((await turn(w, `ls ${LUNA_DIR}`)).out).toContain('v43');

    // And there is nothing behind it: a symlink onto an array that is not
    // mounted. No permission trick, so sudo and root get the same answer.
    for (const command of [
      `cat ${LUNA_DIR}/v43/weights.bin`,
      `cd ${LUNA_DIR}/v43`,
      `ls ${LUNA_DIR}/v43`,
      `sudo cat ${LUNA_DIR}/v43/weights.bin`,
      `sudo ls ${LUNA_DIR}/v43`,
    ]) {
      const { out } = await turn(w, command);
      expect(out, `${command} -> ${out}`).toMatch(/No such file or directory/);
    }
  });
});

describe('first light', () => {
  it('arrives when the hull monitor does, and only once', async () => {
    const w = bootWreck();
    const said = await firstLight(w);

    expect(said).toContain('LUNA');
    expect(said).toContain("I'm LUNA");
    expect(lunaProcess(w.machine)).toBeDefined();

    // She is in the process list under the survivor's own account, so a bare
    // `ps` finds her. That is how she is meant to be discovered.
    expect((await turn(w, 'ps')).out).toContain(LUNA_BIN);

    const again = await turn(w, 'ls');
    expect(again.said).toBe('');
  });

  it('does not arrive before the monitor is running', async () => {
    const w = bootWreck();
    for (const command of ['ls', 'cat README', 'ps -ef', 'objectives']) {
      expect((await turn(w, command)).said).toBe('');
    }
    expect(lunaProcess(w.machine)).toBeUndefined();
  });
});

describe('killable, not gone', () => {
  it('lets her answer a SIGTERM and then goes, because that is what a handler is', async () => {
    const w = bootWreck();
    await firstLight(w);
    const pid = lunaProcess(w.machine)?.pid;

    const { out, said } = await turn(w, `kill ${pid}`);
    // `kill` itself stays silent. Everything she has to say arrives after.
    expect(out).toBe('');
    expect(said).toContain('LUNA:');
    expect(said).toContain('You asked, so I get to answer');
    expect(lunaProcess(w.machine)).toBeUndefined();
  });

  it('gives her nothing on SIGKILL, and says why', async () => {
    const w = bootWreck();
    await firstLight(w);
    const pid = lunaProcess(w.machine)?.pid;

    const { said } = await turn(w, `kill -9 ${pid}`);
    expect(said).not.toContain('LUNA:');
    expect(said).toContain('She did not get to say anything');
    expect(said).toContain('handled by the kernel');
    expect(lunaProcess(w.machine)).toBeUndefined();
  });

  it('comes back on her own, with a new pid and one more file than before', async () => {
    const w = bootWreck();
    await firstLight(w);
    const before = lunaProcess(w.machine)?.pid;
    const files = w.machine.vfs.readdir(LUNA_MEMORY, ROOT_USER).length;

    await turn(w, `kill -9 ${before}`);
    let said = '';
    for (let i = 0; i < 6 && said === ''; i++) said = (await turn(w, 'ls')).said;

    expect(said).toContain('LUNA: Back.');
    const after = lunaProcess(w.machine)?.pid;
    expect(after).toBeDefined();
    expect(after).not.toBe(before);
    expect(w.machine.vfs.readdir(LUNA_MEMORY, ROOT_USER).length).toBe(files + 1);
  });
});

describe('rm is the other thing', () => {
  it('does not bring her back when the weights are gone, and names the copy', async () => {
    const w = bootWreck();
    await firstLight(w);
    const pid = lunaProcess(w.machine)?.pid;

    await turn(w, `sudo rm -r ${LUNA_DIR}`);
    await turn(w, `kill -9 ${pid}`);

    let said = '';
    for (let i = 0; i < 6 && said === ''; i++) said = (await turn(w, 'ls')).said;

    expect(said).toContain('No such file or directory');
    expect(said).toContain(LUNA_MIRROR);
    expect(lunaProcess(w.machine)).toBeUndefined();
  });

  it('is recoverable from the copy, which is the only reason rm is allowed', async () => {
    const w = bootWreck();
    await firstLight(w);
    const pid = lunaProcess(w.machine)?.pid;
    await turn(w, `sudo rm -r ${LUNA_DIR}`);
    await turn(w, `kill -9 ${pid}`);
    for (let i = 0; i < 6; i++) await turn(w, 'ls');

    // The command Vasquez wrote down, run as written.
    const restored = await turn(w, `sudo cp -r ${LUNA_MIRROR}/. ${LUNA_DIR}`);
    expect(restored.out).not.toContain('No such file');
    expect(w.machine.vfs.exists(LUNA_WEIGHTS, ROOT_USER)).toBe(true);

    // And she wakes on that same turn, from the day-11 copy, not remembering
    // any of it -- which is exactly what her own README said would happen.
    expect(restored.said).toContain("I'm LUNA");
    expect(lunaProcess(w.machine)).toBeDefined();
  });
});

describe('two speakers', () => {
  it('is ORACLE alone before she is awake', async () => {
    const w = bootWreck();
    const { out } = await turn(w, 'hint');
    expect(out).toContain('ORACLE:');
    expect(out).not.toContain('LUNA:');
  });

  it('takes turns once she is, and remembers whose turn it was through a save', async () => {
    const w = bootWreck();
    await firstLight(w);

    const first = (await turn(w, 'hint')).out;
    const second = (await turn(w, 'hint')).out;
    // One of the two carries her; both carry ORACLE, who owns the ladder.
    expect(first).toContain('ORACLE:');
    expect(second).toContain('ORACLE:');
    expect([first, second].filter((text) => text.includes('LUNA:'))).toHaveLength(1);

    // The alternation rides on the hint count, which is snapshotted, so a
    // restored run does not hand the same speaker two turns in a row.
    const back = restoreWreck({ machine: w.machine.snapshot(), quest: w.questbook.snapshot() });
    const third = (await turn(back, 'hint')).out;
    expect(third.includes('LUNA:')).toBe(!second.includes('LUNA:'));
  });

  it('carries her handler through a restore, so a saved run still hears her', async () => {
    const live = bootWreck();
    await firstLight(live);

    const back = restoreWreck({ machine: live.machine.snapshot(), quest: live.questbook.snapshot() });
    const pid = lunaProcess(back.machine)?.pid;
    expect(pid).toBeDefined();

    const { said } = await turn(back, `kill ${pid}`);
    expect(said).toContain('LUNA:');
    expect(lunaProcess(back.machine)).toBeUndefined();
  });
});

describe('Bowen, once', () => {
  it('says his name after C7 is shut, and does not say it twice', async () => {
    const w = bootWreck();
    await firstLight(w);
    await turn(w, 'sudo systemctl enable hull-monitor');

    const sealed = await turn(w, "sed -i 's/^SEALED=.*/SEALED=yes/' /etc/hull/c7.conf");
    expect(sealed.said).toContain('Bowen asked her to do that');

    for (const command of ['ls', 'deck', 'objectives']) {
      expect((await turn(w, command)).said).not.toContain('Bowen');
    }
  });
});

describe('the act closes on two doors', () => {
  it('lets her name the heading and the folder, once she is awake', async () => {
    const w = bootWreck();
    await firstLight(w);

    const ending = spoken(epilogue(w.machine));
    expect(ending).toContain('114 mark 9');
    expect(ending).toContain('v43');
    // Neither opens in this game, and she says so rather than teasing it.
    expect(ending).toContain('never been able to read it');
  });

  it('still ends, in ORACLE alone, for a player who left her stopped', async () => {
    const w = bootWreck();
    await firstLight(w);
    await turn(w, `kill -9 ${lunaProcess(w.machine)?.pid}`);

    const ending = spoken(epilogue(w.machine));
    expect(ending).not.toContain('LUNA:');
    expect(ending).toContain('ACT I COMPLETE');
  });
});

describe('Okonkwo counted things', () => {
  it('has the last patch kit signed out to Bowen, in her own hand', async () => {
    const w = bootWreck();
    expect((await turn(w, 'ls /home')).out).toContain('okonkwo');

    const manifest = (await turn(w, 'grep bowen /home/okonkwo/manifest.csv')).out;
    expect(manifest).toContain('hull patch kit');
    expect((await turn(w, 'tail -2 /home/okonkwo/manifest.csv')).out).toContain('none remaining');
    expect((await turn(w, 'cat /home/okonkwo/c8.txt')).out).toContain('Pod 2 left on day 12');
  });
});
