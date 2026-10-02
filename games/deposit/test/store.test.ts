import { describe, expect, it } from 'vitest';
import { ROOT_USER } from '@sigkill/machine';
import { bootDeposit } from '../src/world.js';
import { HIS_MATTER } from '../src/act1/floor.js';
import { ACCESS_LOG } from '../src/store.js';

/**
 * The store, probed before `clean-hands` was written and kept as the
 * regression test it turned into.
 *
 * Everything the optional objective rests on is here: that the material does
 * not open, that the store opens it for you, that it writes down who asked
 * before it hands anything over, and that `sudo` goes around all of it. The
 * last one is a limitation rather than a feature and is asserted anyway,
 * because a hole nobody has written down is a hole somebody will later call a
 * bug in the objective.
 */

const vault = (d: ReturnType<typeof bootDeposit>) => d.network.resolve('vault01')!.machine;
const record = (d: ReturnType<typeof bootDeposit>): string =>
  vault(d).vfs.readText(ACCESS_LOG, ROOT_USER);

describe('deposited material does not open', () => {
  it('is 0600 and owned by the store', () => {
    const d = bootDeposit();
    const stat = vault(d).vfs.lstat(`/srv/deposit/${HIS_MATTER}/manifest`, ROOT_USER);
    expect(stat.mode & 0o777).toBe(0o600);
    expect(stat.uid).toBe(0);
  });

  it('refuses dewitt a plain cat, and leaves the redirect empty', async () => {
    const d = bootDeposit();
    const r = await d.machine.exec("ssh vault01 'cat /srv/deposit/7719/manifest' > ~/work/7719.txt");
    expect(r.stderr).toContain('Permission denied');
    expect(d.machine.vfs.readText('/home/dewitt/work/7719.txt', ROOT_USER)).toBe('');
  });

  it('still shows the shape of the store, because that is the inventory', async () => {
    const d = bootDeposit();
    const r = await d.machine.exec("ssh vault01 'deposit list'");
    expect(r.code).toBe(0);
    expect(r.stdout.trim().split('\n')).toHaveLength(24);
    expect(r.stdout).toContain(HIS_MATTER);
  });
});

describe('the store serves it, and says so', () => {
  it('hands over the body and records the account that asked', async () => {
    const d = bootDeposit();
    const r = await d.machine.exec("ssh vault01 'deposit get 7719/manifest'");
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('matter 7719');
    expect(record(d).trim().split('\n').pop()).toBe('2398-07-14T07:30 dewitt 7719/manifest');
  });

  it('will not serve what it cannot record', async () => {
    const d = bootDeposit();
    await d.machine.exec(`ssh vault01 'sudo rm ${ACCESS_LOG}'`);
    const r = await d.machine.exec("ssh vault01 'deposit get 7719/manifest'");
    expect(r.code).not.toBe(0);
    expect(r.stdout).toBe('');
    expect(r.stderr).toContain('refusing to serve');
  });

  it('does not climb out of the store', async () => {
    const d = bootDeposit();
    for (const target of ['../../etc/passwd', '/etc/passwd']) {
      const r = await d.machine.exec(`ssh vault01 'deposit get ${target}'`);
      expect(r.code).not.toBe(0);
      expect(r.stdout).toBe('');
      expect(record(d)).not.toContain('passwd');
    }
  });

  /**
   * The documented hole.
   *
   * He is the operator of the machine the evidence is on, and an engine that
   * pretended otherwise would be teaching something false about Unix. The mode
   * bits make the recorded path the ordinary one; they do not make a cage, and
   * the act is about what he does when nothing stops him.
   */
  it('is bypassed by sudo, which the act knows and does not hide', async () => {
    const d = bootDeposit();
    const before = record(d);
    const r = await d.machine.exec(`ssh vault01 'sudo cat /srv/deposit/${HIS_MATTER}/manifest'`);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('C. DeWitt');
    expect(record(d)).toBe(before);
  });
});

describe('the boundary LUNA sits behind is written down', () => {
  it('on the bastion as an allowlist', () => {
    const d = bootDeposit();
    const scope = d.machine.vfs.readText('/etc/luna/scope', ROOT_USER);
    expect(scope).toMatch(/allow\s+bastion/);
    for (const host of ['vault01', 'vault02', 'index01', 'relay01']) {
      expect(scope).toMatch(new RegExp(`deny\\s+${host}`));
    }
  });

  it('and on each deposit host as the reason', () => {
    const d = bootDeposit();
    for (const hostname of ['vault01', 'index01', 'relay01']) {
      const machine = d.network.resolve(hostname)!.machine;
      expect(machine.vfs.readText('/etc/deposit/policy', ROOT_USER)).toContain(
        'runs only software the office',
      );
    }
    // Not on the bastion, which is the half of the boundary he is standing on.
    expect(d.machine.vfs.exists('/etc/deposit/policy', ROOT_USER)).toBe(false);
  });

  it('and her tooling is only ever on the bastion', async () => {
    const d = bootDeposit();
    expect(d.machine.shell.commands.has('objectives')).toBe(true);
    const r = await d.machine.exec("ssh vault01 'objectives'");
    expect(r.stderr).toContain('not found');
  });
});

describe('he learns the number from his own post', () => {
  it('which is on the bastion and names the matter', () => {
    const d = bootDeposit();
    const notice = d.machine.vfs.readText(`/home/dewitt/NOTICE`, ROOT_USER);
    expect(notice).toContain(`matter ${HIS_MATTER}`);
    expect(notice).toContain('is not the file');
  });
});
