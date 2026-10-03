import { describe, expect, it } from 'vitest';
import { Machine, Network, ROOT_USER, type Firewall, type Session } from '@sigkill/machine';
import { netCommands } from '../src/index.js';

/**
 * A rule, and the two ways it fails.
 *
 * `db01` accepts ssh from everywhere and drops the database port. The unit is
 * active, the port is open, the route is fine, and a connection from the
 * bastion hangs and then gives up -- which is the shape of this failure every
 * time, and the reason the first question is "refused or timed out".
 */
function floor(firewall?: Firewall) {
  const net = new Network();
  const session: Session = { stack: [] };
  const commands = netCommands();
  const accounts = { root: { uid: 0, gid: 0 }, dewitt: { uid: 1000, gid: 1000 } };

  const bastion = new Machine({ hostname: 'bastion', network: net, session, commands });
  const db = new Machine({ hostname: 'db01', network: net, session, commands });
  for (const m of [bastion, db]) {
    m.vfs.mkdirp('/etc', ROOT_USER);
    m.vfs.writeText('/etc/sudoers', 'dewitt ALL=(ALL) NOPASSWD: ALL\n', ROOT_USER);
    m.vfs.writeText(
      '/etc/passwd',
      'root:x:0:0:root:/root:/bin/sh\ndewitt:x:1000:1000::/home/dewitt:/bin/sh\n',
      ROOT_USER,
    );
    m.shell.user = { uid: 1000, gid: 1000, name: 'dewitt' };
  }

  net.add({ hostname: 'bastion', ip: '10.0.1.1', machine: bastion, ports: { 22: 'SSH' }, accounts });
  net.add({
    hostname: 'db01',
    ip: '10.0.1.20',
    machine: db,
    ports: { 22: 'SSH', 5432: 'postgres/16.1' },
    accounts,
    ...(firewall ? { firewall } : {}),
  });
  return { net, bastion, db };
}

const DROPPING: Firewall = {
  policy: 'ACCEPT',
  rules: [{ action: 'DROP', port: 5432 }],
};

describe('a dropped packet', () => {
  it('times out rather than being refused, which is the whole tell', async () => {
    const { bastion } = floor(DROPPING);
    const r = await bastion.exec('nc -z db01 5432');
    expect(r.stderr).toContain('Connection timed out');
    expect(r.stderr).not.toContain('refused');
  });

  it('costs the player the wait, because the wait is the symptom', async () => {
    const { bastion } = floor(DROPPING);
    const before = bastion.shell.clock();
    await bastion.exec('curl http://db01:5432/');
    expect(bastion.shell.clock() - before).toBeGreaterThanOrEqual(5000);
  });

  it('costs scp the same wait, because scp is ssh underneath', async () => {
    const { bastion } = floor({ policy: 'DROP', rules: [] });
    bastion.vfs.mkdirp('/home/dewitt', ROOT_USER);
    bastion.vfs.writeText('/home/dewitt/app.conf', 'workers=4\n', ROOT_USER);

    const before = bastion.shell.clock();
    const r = await bastion.exec('scp /home/dewitt/app.conf db01:/tmp/app.conf');
    expect(r.stderr).toContain('Connection timed out');
    expect(bastion.shell.clock() - before).toBeGreaterThanOrEqual(5000);
  });

  it('is curl 28, which is a different number from a refusal on purpose', async () => {
    const { bastion } = floor(DROPPING);
    expect((await bastion.exec('curl http://db01:5432/')).code).toBe(28);
    expect((await bastion.exec('curl http://db01:9999/')).code).toBe(7);
  });

  it('leaves every other port alone', async () => {
    const { bastion } = floor(DROPPING);
    expect((await bastion.exec('nc -z db01 22')).code).toBe(0);
  });

  it('looks identical whether or not anything is listening behind it', async () => {
    const { bastion } = floor({ policy: 'DROP', rules: [{ action: 'ACCEPT', port: 22 }] });
    const open = await bastion.exec('nc -z db01 5432');
    const closed = await bastion.exec('nc -z db01 9999');
    expect(open.stderr.replace('5432', 'P')).toBe(closed.stderr.replace('9999', 'P'));
  });
});

describe('a rejected packet', () => {
  it('is refused at once, like a closed port', async () => {
    const { bastion } = floor({ policy: 'ACCEPT', rules: [{ action: 'REJECT', port: 5432 }] });
    const before = bastion.shell.clock();
    const r = await bastion.exec('nc -z db01 5432');
    expect(r.stderr).toContain('Connection refused');
    expect(bastion.shell.clock() - before).toBeLessThan(5000);
  });
});

describe('rules narrow by source', () => {
  it('can let one subnet in and keep the rest out', async () => {
    const { bastion } = floor({
      policy: 'DROP',
      rules: [
        { action: 'ACCEPT', source: '10.0.1.0/24', port: 5432 },
        { action: 'ACCEPT', port: 22 },
      ],
    });
    expect((await bastion.exec('nc -z db01 5432')).code).toBe(0);
  });

  it('and keep out the subnet it does not name', async () => {
    const { bastion } = floor({
      policy: 'DROP',
      rules: [
        { action: 'ACCEPT', source: '10.9.9.0/24', port: 5432 },
        { action: 'ACCEPT', port: 22 },
      ],
    });
    expect((await bastion.exec('nc -z db01 5432')).stderr).toContain('timed out');
  });

  it('never filters a machine talking to itself', async () => {
    const { bastion } = floor({ policy: 'DROP', rules: [{ action: 'ACCEPT', port: 22 }] });
    expect((await bastion.exec("ssh db01 'nc -z localhost 5432'")).code).toBe(0);
  });
});

describe('iptables', () => {
  it('lists the chain and its policy', async () => {
    const { db } = floor(DROPPING);
    const r = await db.exec('iptables -L');
    expect(r.stdout).toContain('Chain INPUT (policy ACCEPT)');
    expect(r.stdout).toContain('DROP');
    expect(r.stdout).toContain('tcp dpt:5432');
  });

  it('prints the chain as the commands that would rebuild it', async () => {
    const { db } = floor(DROPPING);
    expect((await db.exec('iptables -S')).stdout).toBe(
      '-P INPUT ACCEPT\n-A INPUT -p tcp --dport 5432 -j DROP\n',
    );
  });

  it('will not be changed by somebody who is not root', async () => {
    const { db } = floor(DROPPING);
    const r = await db.exec('iptables -D INPUT -p tcp --dport 5432 -j DROP');
    expect(r.code).toBe(4);
    expect(r.stderr).toContain('Permission denied');
  });

  it('opens the port when the rule is removed, and the connection works', async () => {
    const { bastion } = floor(DROPPING);
    expect((await bastion.exec('nc -z db01 5432')).stderr).toContain('timed out');

    const fix = await bastion.exec("ssh db01 'sudo iptables -D INPUT -p tcp --dport 5432 -j DROP'");
    expect(fix.code).toBe(0);
    expect((await bastion.exec('nc -z db01 5432')).code).toBe(0);
  });

  it('puts an accept in front of a policy that drops everything', async () => {
    const { bastion } = floor({ policy: 'DROP', rules: [{ action: 'ACCEPT', port: 22 }] });
    expect((await bastion.exec('nc -z db01 5432')).stderr).toContain('timed out');

    await bastion.exec("ssh db01 'sudo iptables -I INPUT -p tcp --dport 5432 -j ACCEPT'");
    expect((await bastion.exec('nc -z db01 5432')).code).toBe(0);
  });

  it('refuses a flag it does not honour rather than ignoring it', async () => {
    const { db } = floor(DROPPING);
    const r = await db.exec('sudo iptables -A INPUT -m state --state NEW -j ACCEPT');
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('unknown option');
  });

  it('says so when a rule to delete is not there', async () => {
    const { db } = floor(DROPPING);
    const r = await db.exec('sudo iptables -D INPUT -p tcp --dport 80 -j DROP');
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('Bad rule');
  });

  it('survives a save, because the chain is a fact about the host', async () => {
    const { bastion, net } = floor(DROPPING);
    const { snapshotFleet, restoreFleet } = await import('@sigkill/machine');
    const snap = JSON.parse(JSON.stringify(snapshotFleet(net, bastion.session)));
    const back = restoreFleet(snap, () => ({ options: { commands: netCommands() } }));
    expect((await back.machines.get('bastion')!.exec('nc -z db01 5432')).stderr).toContain(
      'timed out',
    );
  });
});

describe('a host nobody gave rules to', () => {
  it('filters nothing at all, which is every adventure so far', async () => {
    const { bastion, db } = floor();
    expect((await bastion.exec('nc -z db01 5432')).code).toBe(0);
    expect((await db.exec('iptables -L')).stdout).toContain('policy ACCEPT');
  });
});

/**
 * Which address the far end sees.
 *
 * A multihomed host leaves by the leg on the destination's subnet, and that is
 * the address a `-s` rule has to be matched against -- it is also what `ip
 * route` prints as that connected route's source. Matching the primary instead
 * had a border box refused by a rule accepting the very subnet it was
 * connecting from.
 */
describe('a rule matching on source', () => {
  function twoLegs() {
    const net = new Network({ routing: true });
    const session: Session = { stack: [] };
    const commands = netCommands();
    const accounts = { root: { uid: 0, gid: 0 }, dewitt: { uid: 1000, gid: 1000 } };
    const border = new Machine({ hostname: 'border', network: net, session, commands });
    const db = new Machine({ hostname: 'db01', network: net, session, commands });

    net.add({
      hostname: 'border',
      ip: '10.0.1.254',
      ips: ['10.0.2.254'],
      router: true,
      machine: border,
      ports: { 22: 'SSH' },
      accounts,
    });
    net.add({
      hostname: 'db01',
      ip: '10.0.2.20',
      machine: db,
      ports: { 22: 'SSH', 5432: 'postgres' },
      accounts,
      firewall: {
        policy: 'DROP',
        rules: [
          { action: 'ACCEPT', source: '10.0.2.0/24', port: 5432 },
          { action: 'ACCEPT', port: 22 },
        ],
      },
    });
    return { border };
  }

  it('sees the leg on its own subnet, not the primary one', async () => {
    const { border } = twoLegs();
    expect((await border.exec('nc -z db01 5432')).code).toBe(0);
  });
});
