import { describe, expect, it } from 'vitest';
import { bootWreck, restoreWreck } from '../src/world.js';

/**
 * DeWitt, berth three.
 *
 * The account rename went in as a find-and-replace and left five "the dewitt"
 * artifacts behind, two of them in files the player reads. Nothing failed,
 * because nothing was checking that the person has a name rather than that the
 * string appears. These do.
 */
describe('DeWitt', () => {
  it('is who the shell says you are', async () => {
    const { machine } = bootWreck();

    expect(machine.prompt).toBe('dewitt@nav7:~ $ ');
    expect((await machine.exec('whoami')).stdout.trim()).toBe('dewitt');
    expect((await machine.exec('pwd')).stdout.trim()).toBe('/home/dewitt');
  });

  it('is a person in the passwd file, not just a berth number', async () => {
    const { machine } = bootWreck();

    // Initial and surname, the way the rest of the crew are recorded.
    const passwd = (await machine.exec('grep dewitt /etc/passwd')).stdout;
    expect(passwd).toContain('C. DeWitt');
    expect(passwd).toContain('/home/dewitt');
  });

  it('owns its own home and can use the sudoers line Vasquez left', async () => {
    const { machine } = bootWreck();

    // Written as the player, without sudo: if the uid and the directory ever
    // disagree, this is the test that says so.
    expect((await machine.exec('echo "still here" > ~/note.txt')).stderr).toBe('');
    expect((await machine.exec('cat ~/note.txt')).stdout).toContain('still here');
    expect((await machine.exec('sudo whoami')).stdout.trim()).toBe('root');
  });

  it('is addressed by name rather than by account, everywhere the player reads', async () => {
    const { machine } = bootWreck();

    // Vasquez talks to you. She does not refer to "the dewitt account".
    for (const path of ['/home/dewitt/logs/vasquez.log', '/etc/sudoers']) {
      const text = (await machine.exec(`cat ${path}`)).stdout;
      expect(text, path).not.toMatch(/the dewitt/i);
    }

    // And the sudoers columns line up, which they did not after the rename.
    const sudoers = (await machine.exec('cat /etc/sudoers')).stdout;
    const columns = [...sudoers.matchAll(/^(\S+)(\s+)ALL=/gm)].map(
      (match) => (match[1] ?? '').length + (match[2] ?? '').length,
    );
    expect(new Set(columns).size, sudoers).toBe(1);
  });

  it('is still DeWitt after a reload', async () => {
    const live = bootWreck();
    const back = restoreWreck({
      machine: live.machine.snapshot(),
      quest: live.questbook.snapshot(),
    });

    expect((await back.machine.exec('whoami')).stdout.trim()).toBe('dewitt');
    expect((await back.machine.exec('ls /home/dewitt')).stderr).toBe('');
    expect((await back.machine.exec('sudo whoami')).stdout.trim()).toBe('root');
  });
});
