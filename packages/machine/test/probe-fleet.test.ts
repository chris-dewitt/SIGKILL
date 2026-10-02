import { describe, expect, it } from 'vitest';
import { Machine } from '../src/machine.js';
import { Network, type Session } from '../src/net/network.js';
import { ROOT_USER } from '../src/vfs/vfs.js';

/**
 * The third probe for game six, and the one that nearly did not happen.
 *
 * The first two probed *commands* -- can the player reach another host, can
 * they operate a service on it. Both said yes. What neither asked is whether
 * any of it survives a reload, and the answer is no, because every adventure
 * so far has been one machine and `MachineSnapshot` is the snapshot of one
 * machine: vfs, procs, services, journal, jobs, cwd, env, clock, epoch. There
 * is no network in it and no second host.
 *
 * For an adventure whose entire progress lives on hosts that are not the one
 * the player is sitting at, that is not a detail. A player who diagnoses the
 * index, rolls back the config, restarts the service and then closes the app
 * comes back to a fleet that never had anything done to it -- while the
 * questbook, which is saved separately, still says the objectives are met.
 *
 * This file exists to pin that down before a line of the game is written, and
 * to fail once it is fixed.
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

  /*
   * The finding.
   *
   * Everything the player changed on the far side of the link is in that
   * machine's own Vfs, and the local machine's snapshot has never heard of it.
   */
  it('loses everything done on another host', async () => {
    const f = fleet();

    // A rollback, which in an operations game is a whole objective.
    const edit = await f.local.exec(
      "ssh root@vault01 'sed -i s/workers=4/workers=8/ /etc/app/config'",
    );
    expect(edit.code).toBe(0);
    expect(f.vault.vfs.readText('/etc/app/config', ROOT_USER)).toContain('workers=8');

    // Save the machine the player is sitting at -- which is what the terminal
    // saves, because it is the only machine the adventure hands it.
    const snap = f.local.snapshot();

    expect(
      JSON.stringify(snap).includes('workers=8'),
      'the fleet is in the snapshot now -- this probe is out of date',
    ).toBe(false);
  });

  it('has no way to express a second machine at all', () => {
    const f = fleet();
    const snap = f.local.snapshot();

    // Not a complaint about the shape: `MachineSnapshot` is a correct snapshot
    // of one machine. The gap is that nothing above it carries a fleet.
    expect(Object.keys(snap).sort()).toEqual(
      ['clock', 'cwd', 'env', 'epoch', 'jobs', 'proc', 'status', 'version', 'vfs'].sort(),
    );
  });

  /*
   * And the session stack goes too, which is the sharper edge of the same
   * problem: a player who saves while `ssh`-ed into a host comes back sitting
   * somewhere else, with a prompt that has silently changed under them.
   */
  it('loses where the player was standing', async () => {
    const f = fleet();
    await f.local.exec('ssh vault01');
    expect(f.session.stack.length).toBe(1);
    expect(f.local.active.shell.hostname).toBe('vault01');

    const snap = f.local.snapshot();
    expect(JSON.stringify(snap).includes('vault01')).toBe(false);
  });
});
