import { describe, expect, it } from 'vitest';
import { ROOT_USER } from '@sigkill/machine';
import { bootDeposit, restoreDeposit, snapshotDeposit } from '../src/world.js';
import { HIS_MATTER, LOCK } from '../src/act1/floor.js';

describe('the floor boots', () => {
  it('stands four hosts up and puts him on the bastion', async () => {
    const d = bootDeposit();
    expect(d.network.list().map((h) => h.hostname)).toEqual([
      'bastion', 'index01', 'relay01', 'vault01',
    ]);
    expect((await d.machine.exec('pwd')).stdout.trim()).toBe('/home/dewitt');
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
