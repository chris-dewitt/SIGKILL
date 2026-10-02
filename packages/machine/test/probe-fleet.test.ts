import { describe, expect, it } from 'vitest';
import { Machine } from '../src/machine.js';
import { restoreFleet, snapshotFleet } from '../src/net/fleet.js';
import { Network, type Session } from '../src/net/network.js';
import { ROOT_USER } from '../src/vfs/vfs.js';

/**
 * The third probe for game six, and the one that nearly did not happen.
 *
 * The first two probed *commands* -- can the player reach another host, can
 * they operate a service on it. Both said yes. What neither asked is whether
 * any of it survives a reload, and it did not, because every adventure so far
 * has been one machine and `MachineSnapshot` is the snapshot of one machine:
 * vfs, procs, services, journal, jobs, cwd, env, clock, epoch. No network, no
 * second host, and no record of where the player was standing.
 *
 * For an adventure whose entire progress lives on hosts that are not the one
 * the player sits at, that is not a detail. A player who diagnoses the index,
 * rolls back the config, restarts the service and closes the app would come
 * back to a fleet nothing had been done to -- while the questbook, saved
 * separately, went on reporting the objectives as met.
 *
 * `snapshotFleet` and `restoreFleet` close it. The tests below are the ones
 * that recorded the gap, inverted: each now asserts the thing that was lost
 * comes back.
 */

interface Fleet {
  local: Machine;
  net: Network;
  session: Session;
  vault: Machine;
}

function fleet(): Fleet {
  const net = new Network();
  const session: Session = { stack: [] };
  const common = { network: net, session };

  const local = new Machine({ hostname: 'bastion', ...common });
  local.vfs.mkdirp('/home/dewitt', ROOT_USER);
  local.vfs.chown('/home/dewitt', 1000, 1000, ROOT_USER);
  local.shell.cwd = '/home/dewitt';

  const vault = new Machine({ hostname: 'vault01', ...common });
  vault.vfs.mkdirp('/etc/app', ROOT_USER);
  vault.vfs.writeText('/etc/app/config', 'workers=4\n', ROOT_USER);

  net.add({
    hostname: 'bastion', ip: '10.0.1.1', machine: local,
    ports: { 22: 'SSH-2.0-OpenSSH_9.6' },
    accounts: { dewitt: { uid: 1000, gid: 1000 } },
  });
  net.add({
    hostname: 'vault01', ip: '10.0.1.10', machine: vault,
    ports: { 22: 'SSH-2.0-OpenSSH_9.6' },
    accounts: { dewitt: { uid: 1000, gid: 1000 }, root: { uid: 0, gid: 0 } },
  });

  return { local, net, session, vault };
}

describe('probe: what a save keeps when the work was done somewhere else', () => {
  it('keeps work done on the local machine, as it always has', async () => {
    const f = fleet();
    await f.local.exec('echo kept > /home/dewitt/note.txt');

    const snap = f.local.snapshot();
    const back = Machine.restore(snap, {});
    expect(back.vfs.readText('/home/dewitt/note.txt', ROOT_USER)).toContain('kept');
  });

  /* The local machine's own snapshot still cannot see the rest of the fleet. */
  it('is still true that one machine cannot speak for the others', async () => {
    const f = fleet();
    await f.local.exec("ssh root@vault01 'sed -i s/workers=4/workers=8/ /etc/app/config'");
    expect(JSON.stringify(f.local.snapshot()).includes('workers=8')).toBe(false);
  });

  it('keeps a change made on another host', async () => {
    const f = fleet();
    const edit = await f.local.exec(
      "ssh root@vault01 'sed -i s/workers=4/workers=8/ /etc/app/config'",
    );
    expect(edit.code).toBe(0);

    const back = restoreFleet(snapshotFleet(f.net, f.session), () => ({}));
    const vault = back.machines.get('vault01')!;
    expect(vault.vfs.readText('/etc/app/config', ROOT_USER)).toContain('workers=8');
  });

  it('keeps a service started on another host, and its journal', async () => {
    const f = fleet();
    f.vault.vfs.mkdirp('/etc/systemd/system', ROOT_USER);
    f.vault.vfs.writeText(
      '/etc/systemd/system/store.service',
      '[Unit]\nDescription=Deposit store\n\n[Service]\nExecStart=/usr/bin/store\n',
      ROOT_USER,
    );
    f.vault.services.start('store');

    const back = restoreFleet(snapshotFleet(f.net, f.session), () => ({}));
    const vault = back.machines.get('vault01')!;
    expect(vault.services.get('store')?.state).toBe('active');
    // The journal is the evidence objective nine is written from, so it has to
    // cross a reload with the rest.
    expect(vault.services.logs('store').length).toBeGreaterThan(0);
  });

  it('keeps the shape of the network, including a host that is down', async () => {
    const f = fleet();
    f.net.setUp('vault01', false);

    const back = restoreFleet(snapshotFleet(f.net, f.session), () => ({}));
    const host = back.network.resolve('vault01')!;
    expect(host.up).toBe(false);
    expect(host.ip).toBe('10.0.1.10');
    expect(host.ports.get(22)).toContain('OpenSSH');
    expect(host.accounts.get('dewitt')?.uid).toBe(1000);
  });

  it('puts the player back where they were standing', async () => {
    const f = fleet();
    await f.local.exec('ssh vault01');
    expect(f.local.active.shell.hostname).toBe('vault01');

    const back = restoreFleet(snapshotFleet(f.net, f.session), () => ({}));
    expect(back.session.stack.length).toBe(1);
    expect(back.machines.get('bastion')!.active.shell.hostname).toBe('vault01');
  });

  it('lands at the bastion if a saved host no longer exists', async () => {
    const f = fleet();
    await f.local.exec('ssh vault01');
    const snap = snapshotFleet(f.net, f.session);

    // The adventure dropped a host between versions. Better to stand somewhere
    // real than to restore a hole.
    snap.hosts = snap.hosts.filter((h) => h.hostname !== 'vault01');
    const back = restoreFleet(snap, () => ({}));
    expect(back.session.stack).toHaveLength(0);
    expect(back.machines.get('bastion')!.active.shell.hostname).toBe('bastion');
  });

  it('lets the caller put back what a snapshot cannot carry', async () => {
    const f = fleet();
    const back = restoreFleet(snapshotFleet(f.net, f.session), (hostname) => ({
      options:
        hostname === 'bastion'
          ? {
              commands: [
                { name: 'whereami', summary: 'say so', run: (_c, _a, io) => (io.out('bastion\n'), 0) },
              ],
            }
          : {},
    }));

    const r = await back.machines.get('bastion')!.exec('whereami');
    expect(r.stdout).toContain('bastion');
    // And not on the others, because the adventure said so.
    expect((await back.machines.get('vault01')!.exec('whereami')).code).toBe(127);
  });
});
