import { describe, expect, it } from 'vitest';
import { ROOT_USER } from '@sigkill/machine';
import { bootWreck, restoreWreck } from '../src/world.js';
import { COMMS_LOCK, PACKET, REPLY, SPOOL_OUT } from '../src/act1/comms.js';

/** Boot a ship with the carrier free and running, which is puzzle six done. */
async function connected() {
  const w = bootWreck();
  const run = async (command: string): Promise<string> => {
    const result = await w.machine.exec(command);
    w.machine.tick(1000);
    w.afterCommand();
    return result.stderr;
  };
  expect(await run(`sudo rm ${COMMS_LOCK}`)).toBe('');
  expect(await run('sudo systemctl start comms')).toBe('');
  return { ...w, run };
}

describe('the stale lock', () => {
  it('refuses with the pid, and says the pid is not running', async () => {
    const { machine } = bootWreck();
    const status = await machine.exec('systemctl status comms');
    expect(status.stdout).toContain('failed');
    expect(status.stdout).toContain('204');
    expect(status.stdout).toContain('not running');
    expect(status.stdout).toContain(COMMS_LOCK);
  });

  /*
   * The boot log claims three casualties. If it claims three and `systemctl
   * --failed` shows two, the ship is lying in the first file anybody reads,
   * and the README's whole promise -- that this machine writes everything
   * down -- goes with it.
   */
  it('is one of exactly three units that failed at boot, as the log says', async () => {
    const { machine } = bootWreck();
    const failed = (await machine.exec('systemctl --failed')).stdout;
    for (const unit of ['scrubber', 'hull-monitor', 'comms']) {
      expect(failed, unit).toContain(unit);
    }
    const log = (await machine.exec('grep "units failed" /var/log/boot.log')).stdout;
    expect(log).toContain('3 units failed');
  });

  it('will not start while the lock is there, and starts the moment it is not', async () => {
    const { machine } = bootWreck();
    expect((await machine.exec('sudo systemctl start comms')).code).not.toBe(0);
    expect(machine.services.get('comms')?.state).not.toBe('active');

    expect((await machine.exec(`sudo rm ${COMMS_LOCK}`)).stderr).toBe('');
    expect((await machine.exec('sudo systemctl start comms')).stderr).toBe('');
    expect(machine.services.get('comms')?.state).toBe('active');
  });

  /*
   * A lock held by something real is a lock you respect. The purge is on the
   * process table from the first command, so pointing the lock at it proves
   * the check is reading the process table rather than assuming the answer.
   */
  it('respects a lock whose owner does exist', async () => {
    const { machine } = bootWreck();
    const pid = /^\S+\s+(\d+).*atmo-purge/m.exec((await machine.exec('ps -ef')).stdout)?.[1];
    expect(pid).toBeDefined();

    machine.vfs.writeText(COMMS_LOCK, `PID=${pid}\nHOLDER=atmo-purge\n`, ROOT_USER);
    // Ask it to start before reading status: the unit reports the reason it
    // recorded on its last attempt, and the last attempt was at boot.
    expect((await machine.exec('sudo systemctl start comms')).code).not.toBe(0);
    const status = await machine.exec('systemctl status comms');
    expect(status.stdout).toContain('held by pid');
    expect(status.stdout).not.toContain('not running');
  });
});

/**
 * The goal reads the finished file and never the transcript.
 *
 * Four genuinely different routes to the same packet. If any of them stops
 * working, the act has quietly acquired One Correct Way to type something,
 * which is the failure this whole engine exists to prevent.
 */
describe('any honest route writes a valid packet', () => {
  const routes: ReadonlyArray<{ name: string; commands: readonly string[] }> = [
    {
      name: 'three appends',
      commands: [
        `echo CALLSIGN=NAV-7 > ${PACKET}`,
        `echo POSITION=KV-OUTER-9 >> ${PACKET}`,
        `echo SOULS_ABOARD=1 >> ${PACKET}`,
      ],
    },
    {
      name: 'one line, semicolons',
      commands: [
        `echo CALLSIGN=NAV-7 > ${PACKET}; echo POSITION=KV-OUTER-9 >> ${PACKET}; ` +
          `echo SOULS_ABOARD=1 >> ${PACKET}`,
      ],
    },
    {
      name: 'copy the template and fill it in with sed',
      commands: [
        `cp ${SPOOL_OUT}/distress.template ${PACKET}`,
        `sed -i 's/^CALLSIGN=.*/CALLSIGN=NAV-7/' ${PACKET}`,
        `sed -i 's/^POSITION=.*/POSITION=KV-OUTER-9/' ${PACKET}`,
        `sed -i 's/^SOULS_ABOARD=.*/SOULS_ABOARD=1/' ${PACKET}`,
      ],
    },
    {
      name: 'pipe the real files in, then add the count',
      commands: [
        `grep CALLSIGN /etc/ship-id > ${PACKET}`,
        `grep POSITION /etc/nav/last-fix.txt >> ${PACKET}`,
        `echo SOULS_ABOARD=1 >> ${PACKET}`,
      ],
    },
  ];

  for (const route of routes) {
    it(`${route.name}`, async () => {
      const w = await connected();
      for (const command of route.commands) {
        expect(await w.run(command), command).toBe('');
      }
      // Sent, then answered. Neither is a thing the player typed.
      await w.run('sleep 120');
      expect(w.machine.vfs.exists(REPLY, ROOT_USER), 'no reply arrived').toBe(true);
      expect(w.questbook.complete(w.machine)).toBe(false);
    });
  }

  it('refuses a packet that is missing any one of the three facts', async () => {
    for (const missing of ['CALLSIGN=NAV-7', 'POSITION=KV-OUTER-9', 'SOULS_ABOARD=1']) {
      const w = await connected();
      const kept = ['CALLSIGN=NAV-7', 'POSITION=KV-OUTER-9', 'SOULS_ABOARD=1']
        .filter((line) => line !== missing);
      for (const line of kept) await w.run(`echo ${line} >> ${PACKET}`);
      await w.run('sleep 300');
      expect(w.machine.vfs.exists(REPLY, ROOT_USER), `sent without ${missing}`).toBe(false);
    }
  });

  it('will not transmit while the carrier is down, however good the packet is', async () => {
    const w = bootWreck();
    for (const line of ['CALLSIGN=NAV-7', 'POSITION=KV-OUTER-9', 'SOULS_ABOARD=1']) {
      await w.machine.exec(`echo ${line} >> ${PACKET}`);
    }
    w.machine.tick(300_000);
    w.afterCommand();
    expect(w.machine.vfs.exists(REPLY, ROOT_USER)).toBe(false);
  });
});

describe('the answer', () => {
  it('notices the heading if the player put it in, and does not invent one', async () => {
    const plain = await connected();
    for (const line of ['CALLSIGN=NAV-7', 'POSITION=KV-OUTER-9', 'SOULS_ABOARD=1']) {
      await plain.run(`echo ${line} >> ${PACKET}`);
    }
    await plain.run('sleep 120');
    const quiet = plain.machine.vfs.readText(REPLY, ROOT_USER);
    expect(quiet).toContain('ELLEN MAY');
    expect(quiet).not.toContain('one-fourteen');

    const told = await connected();
    for (const line of ['CALLSIGN=NAV-7', 'POSITION=KV-OUTER-9', 'SOULS_ABOARD=1']) {
      await told.run(`echo ${line} >> ${PACKET}`);
    }
    await told.run(`echo 'Pod 2 away on heading 114 mark 9' >> ${PACKET}`);
    await told.run('sleep 120');
    expect(told.machine.vfs.readText(REPLY, ROOT_USER)).toContain('one-fourteen');
  });

  it('arrives once and stays arrived, including across a save', async () => {
    const w = await connected();
    for (const line of ['CALLSIGN=NAV-7', 'POSITION=KV-OUTER-9', 'SOULS_ABOARD=1']) {
      await w.run(`echo ${line} >> ${PACKET}`);
    }
    await w.run('sleep 120');
    const first = w.machine.vfs.readText(REPLY, ROOT_USER);

    // The player edits the inbox. The ship does not write it again.
    await w.run(`echo tampered >> ${REPLY}`);
    await w.run('sleep 600');
    expect(w.machine.vfs.readText(REPLY, ROOT_USER)).toContain('tampered');

    const restored = restoreWreck({
      machine: w.machine.snapshot(),
      quest: w.questbook.snapshot(),
    });
    restored.machine.tick(1000);
    restored.afterCommand();
    expect(restored.machine.vfs.readText(REPLY, ROOT_USER)).toContain('tampered');
    expect(restored.machine.vfs.readText(REPLY, ROOT_USER)).toContain(first.split('\n')[2]);
    // The objective itself, not the act: this ship still has an open hull and
    // a running purge, because that is not what this test is about.
    const call = restored.questbook.status(restored.machine).find((o) => o.id === 'send-the-call');
    expect(call?.done).toBe(true);
  });

  /*
   * Determinism, the way every other subsystem here asserts it: run the same
   * script twice from scratch and compare snapshots. The reply is the one
   * thing in Act I that happens because the clock moved, which makes it the
   * one most likely to acquire a dependency on wall time.
   */
  it('replays identically', async () => {
    const play = async (): Promise<string> => {
      const w = bootWreck();
      for (const command of [
        `sudo rm ${COMMS_LOCK}`,
        'sudo systemctl start comms',
        `echo CALLSIGN=NAV-7 > ${PACKET}`,
        `echo POSITION=KV-OUTER-9 >> ${PACKET}`,
        `echo SOULS_ABOARD=1 >> ${PACKET}`,
        'sleep 120',
      ]) {
        await w.machine.exec(command);
        w.machine.tick(1000);
        w.afterCommand();
      }
      return JSON.stringify(w.machine.snapshot());
    };
    expect(await play()).toBe(await play());
  });
});

/*
 * The journal, on the ship it was added for.
 *
 * `systemctl status comms` answers "why will this not start". `journalctl -u
 * comms` answers "what has been happening to it", and after the player fixes
 * the lock the refusal is still there -- which is the difference between a
 * status line and a history, and the reason the command exists.
 */
describe('journalctl on the wreck', () => {
  it('keeps the stale-lock refusal after the carrier is up', async () => {
    const w = await connected();
    const journal = (await w.machine.exec('journalctl -u comms')).stdout;

    expect(journal).toContain('204');
    expect(journal).toContain('stale lock');
    expect(journal).toContain('Started Long-range communications.');
    // In order: refused first, started after.
    expect(journal.indexOf('204')).toBeLessThan(journal.indexOf('Started'));

    // And status has moved on, which is the whole contrast.
    expect((await w.machine.exec('systemctl status comms')).stdout).not.toContain('stale lock');
  });

  it('has something to say about all three units that failed at boot', async () => {
    const w = bootWreck();
    for (const unit of ['scrubber', 'hull-monitor', 'comms']) {
      const out = (await w.machine.exec(`journalctl -u ${unit}`)).stdout;
      expect(out, unit).not.toContain('No entries');
      expect(out, unit).toContain(unit);
    }
    // The scrubber's refusal names the number, same as status does.
    expect((await w.machine.exec('journalctl -u scrubber')).stdout).toContain('19-23');
  });
});
