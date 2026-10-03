import { describe, expect, it } from 'vitest';
import { ROOT_USER } from '@sigkill/machine';
import { bootDeposit, restoreDeposit, snapshotDeposit } from '../src/world.js';
import { HIS_MATTER, LOCK } from '../src/act1/floor.js';

describe('the floor boots', () => {
  it('stands the floor up and puts him on the bastion', async () => {
    const d = bootDeposit();
    expect(d.network.list().map((h) => h.hostname)).toEqual([
      'bastion', 'index01', 'relay01', 'vault01', 'vault02',
    ]);
    expect((await d.machine.exec('pwd')).stdout.trim()).toBe('/home/dewitt');
  });

  /*
   * The mirror host, which is the whole of objective five.
   *
   * Powered off, not missing: it has a name and an address, and all three
   * tools have to say so rather than reporting a DNS failure. That distinction
   * was two engine bugs a week ago.
   */
  it('has a mirror that is off, and says off rather than missing', async () => {
    const d = bootDeposit();

    const ssh = await d.machine.exec("ssh vault02 'echo hi'");
    expect(ssh.stderr).toContain('No route to host');

    const curl = await d.machine.exec('curl http://vault02/health');
    expect(curl.stderr).toContain('No route to host');

    const nc = await d.machine.exec('nc -z vault02 22');
    expect(nc.stderr).toContain('No route to host');

    // And a name that genuinely does not exist reads differently.
    const missing = await d.machine.exec("ssh vault03 'echo hi'");
    expect(missing.stderr).toContain('Could not resolve');
  });

  it("names it in Pell's mirror script and nowhere else", async () => {
    const d = bootDeposit();
    const relay = d.network.resolve('relay01')!.machine;
    expect(relay.vfs.readText('/usr/local/bin/mirror.sh', ROOT_USER)).toContain('vault02');
    // Not in the handover: the player meets it as a name inside a failure.
    expect(d.machine.vfs.readText('/home/dewitt/PELL', ROOT_USER)).not.toContain('vault02');
  });

  it('left the catalogue disabled, which is why it never came back', () => {
    const d = bootDeposit();
    const idx = d.network.resolve('index01')!.machine;
    expect(idx.services.isEnabled('index')).toBe(true);
    expect(idx.services.isEnabled('catalogue')).toBe(false);
  });

  it('lets him reach every host over ssh', async () => {
    const d = bootDeposit();
    for (const name of ['vault01', 'index01', 'relay01']) {
      const r = await d.machine.exec(`ssh ${name} 'echo reached'`);
      expect(r.stderr).toBe('');
      expect(r.stdout).toContain('reached');
    }
  });

  /*
   * The act's premise, as a test.
   *
   * The index is active. It has been active all month. And every answer it
   * gives is a 500, because the catalogue died and left a lock behind -- so a
   * check that only asks whether the service is running has nothing to report.
   */
  it('has an index that is up and wrong at the same time', async () => {
    const d = bootDeposit();
    const idx = d.network.resolve('index01')!.machine;
    expect(idx.services.get('index')?.state).toBe('active');

    const health = await d.machine.exec('curl http://index01/health');
    expect(health.stdout).toContain('catalogue unavailable');
    // The whole lesson: the fetch *worked*.
    expect(health.code).toBe(0);
  });

  it("and Pell's check says it is healthy, which is why nobody noticed", async () => {
    const d = bootDeposit();
    const r = await d.machine.exec('/opt/deposit/check.sh');
    expect(r.stdout).toContain('index healthy');
  });

  it('answers properly once the catalogue is running again', async () => {
    const d = bootDeposit();
    // Deleting the lock changes nothing: it is evidence, not the cause.
    expect((await d.machine.exec(`ssh root@index01 'rm ${LOCK}'`)).code).toBe(0);
    expect((await d.machine.exec('curl http://index01/health')).stdout).toContain('unavailable');

    expect((await d.machine.exec("ssh index01 'sudo systemctl start catalogue'")).code).toBe(0);

    const health = await d.machine.exec('curl http://index01/health');
    expect(health.stdout).toContain('ok');
    const matter = await d.machine.exec(`curl http://index01/matter/${HIS_MATTER}`);
    expect(matter.stdout).toContain('vault01:/srv/deposit/7714');
  });

  it('keeps the floor across a save, which is what the fleet snapshot is for', async () => {
    const d = bootDeposit();
    await d.machine.exec("ssh index01 'sudo systemctl start catalogue'");
    await d.machine.exec("ssh root@vault01 'echo note >> /srv/deposit/7701/manifest'");

    const back = restoreDeposit(snapshotDeposit(d));
    expect((await back.machine.exec('curl http://index01/health')).stdout).toContain('ok');
    const vault = back.network.resolve('vault01')!.machine;
    expect(vault.vfs.readText('/srv/deposit/7701/manifest', ROOT_USER)).toContain('note');
  });

  it('records reads by the tribunal and names his matter among them', () => {
    const d = bootDeposit();
    const vault = d.network.resolve('vault01')!.machine;
    const log = vault.vfs.readText('/var/log/access.log', ROOT_USER);
    expect(log).toContain(`tribunal ${HIS_MATTER}/manifest`);
    // And nothing read by him, because he has not started yet.
    expect(log).not.toContain('dewitt');
  });
});
