import { describe, expect, it } from 'vitest';
import { Machine, Network, ROOT_USER, type Session } from '@sigkill/machine';
import { netCommands } from '../src/index.js';

/**
 * A service that is running, and refusing you.
 *
 * The floor here is the shape the failure actually takes: `db01` runs a
 * database, the unit is active, the port is open, and it is bound to
 * 127.0.0.1. From the bastion it is indistinguishable from a port nobody
 * opened — same message, same exit code — and `ss` on the host is the only
 * thing that tells them apart.
 */
function floor(): { bastion: Machine; db: Machine; net: Network } {
  const net = new Network();
  const session: Session = { stack: [] };
  const commands = netCommands();

  const bastion = new Machine({ hostname: 'bastion', network: net, session, commands });
  bastion.vfs.mkdirp('/etc', ROOT_USER);
  const db = new Machine({ hostname: 'db01', network: net, session, commands });

  net.add({
    hostname: 'bastion',
    ip: '10.0.1.1',
    machine: bastion,
    ports: { 22: 'SSH-2.0-OpenSSH_9.6' },
    accounts: { dewitt: { uid: 1000, gid: 1000 } },
  });
  net.add({
    hostname: 'db01',
    ip: '10.0.1.20',
    machine: db,
    ports: { 22: 'SSH-2.0-OpenSSH_9.6', 5432: 'postgres/16.1' },
    // The whole puzzle, in one line of seed.
    loopback: [5432],
    accounts: { dewitt: { uid: 1000, gid: 1000 } },
  });
  return { bastion, db, net };
}

describe('ss', () => {
  it('lists what this machine is listening on, with the address', async () => {
    const { db } = floor();
    const r = await db.exec('ss -ltn');
    expect(r.stdout).toContain('0.0.0.0:22');
    expect(r.stdout).toContain('127.0.0.1:5432');
    expect(r.code).toBe(0);
  });

  it('shows nothing without -l, because nothing is established here', async () => {
    const { db } = floor();
    const r = await db.exec('ss -tn');
    expect(r.stdout).toContain('State');
    expect(r.stdout).not.toContain('5432');
  });

  it('prints no queue columns, because there are no queues', async () => {
    const { db } = floor();
    const r = await db.exec('ss -ltn');
    expect(r.stdout).not.toContain('Recv-Q');
  });

  it('answers for the machine running it, over ssh like anywhere else', async () => {
    const { bastion } = floor();
    const here = await bastion.exec('ss -ltn');
    expect(here.stdout).not.toContain('5432');

    const there = await bastion.exec("ssh db01 'ss -ltn'");
    expect(there.stdout).toContain('127.0.0.1:5432');
  });
});

describe('a port bound to loopback', () => {
  it('refuses the rest of the network, in the words of a closed port', async () => {
    const { bastion } = floor();
    const bound = await bastion.exec('nc -z db01 5432');
    const closed = await bastion.exec('nc -z db01 9999');
    expect(bound.stderr).toContain('Connection refused');
    // Identical, which is the difficulty and the reason ss exists.
    expect(bound.stderr.replace('5432', 'PORT')).toBe(closed.stderr.replace('9999', 'PORT'));
  });

  it('answers the machine it is running on', async () => {
    const { bastion } = floor();
    const r = await bastion.exec("ssh db01 'nc -z 127.0.0.1 5432'");
    expect(r.code).toBe(0);
  });

  it('does not stop ssh, which is bound to everything', async () => {
    const { bastion } = floor();
    expect((await bastion.exec('ssh db01 true')).code).toBe(0);
  });

  it('survives a save, because it is a fact about the host', async () => {
    const { bastion, net } = floor();
    const { snapshotFleet, restoreFleet } = await import('@sigkill/machine');
    const snap = JSON.parse(JSON.stringify(snapshotFleet(net, bastion.session)));
    const back = restoreFleet(snap, () => ({ options: { commands: netCommands() } }));
    expect(back.network.resolve('db01')!.loopback.has(5432)).toBe(true);
    expect((await back.machines.get('db01')!.exec('ss -ltn')).stdout).toContain('127.0.0.1:5432');
  });
});

describe('netstat', () => {
  it('answers the same question as ss', async () => {
    const { db } = floor();
    const r = await db.exec('netstat -ltn');
    expect(r.stdout).toContain('127.0.0.1:5432');
    expect(r.stdout).toContain('LISTEN');
  });

  it('says to learn ss instead', async () => {
    const { db } = floor();
    expect((await db.exec('man netstat')).stdout).toContain('Learn ss');
  });
});
