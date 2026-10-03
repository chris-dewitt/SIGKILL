import { describe, expect, it } from 'vitest';
import { Machine, Network, type Session } from '@sigkill/machine';
import { netCommands } from '../src/index.js';

/**
 * Two subnets and the box that joins them.
 *
 *   app01   10.0.1.10        the office floor
 *   border  10.0.1.254 +     one leg in each, forwarding
 *           10.0.2.254
 *   db01    10.0.2.20        the other side
 *
 * Which is the smallest arrangement in which "I cannot reach it" has more
 * than one answer, and therefore the smallest one worth modelling.
 */
function sites(opts: { forwarding?: boolean; borderUp?: boolean } = {}) {
  // Subnets are opt-in, because an adventure that has not thought about them
  // has not chosen its addresses to mean anything. This one has.
  const net = new Network({ routing: true });
  const session: Session = { stack: [] };
  const commands = netCommands();
  const make = (hostname: string) => new Machine({ hostname, network: net, session, commands });

  const app = make('app01');
  const border = make('border');
  const db = make('db01');

  const everyone = { root: { uid: 0, gid: 0 }, dewitt: { uid: 1000, gid: 1000 } };

  net.add({
    hostname: 'app01',
    ip: '10.0.1.10',
    machine: app,
    ports: { 22: 'SSH', 80: 'nginx' },
    accounts: everyone,
  });
  net.add({
    hostname: 'border',
    ip: '10.0.1.254',
    ips: ['10.0.2.254'],
    router: opts.forwarding ?? true,
    up: opts.borderUp ?? true,
    machine: border,
    ports: { 22: 'SSH' },
    accounts: everyone,
  });
  net.add({
    hostname: 'db01',
    ip: '10.0.2.20',
    machine: db,
    ports: { 22: 'SSH', 5432: 'postgres' },
    accounts: everyone,
  });
  return { net, app, border, db };
}

describe('ip addr', () => {
  it('shows loopback and the address this machine actually has', async () => {
    const { app } = sites();
    const r = await app.exec('ip addr');
    expect(r.stdout).toContain('inet 127.0.0.1/8 scope host lo');
    expect(r.stdout).toContain('inet 10.0.1.10/24 brd 10.0.1.255 scope global eth0');
  });

  it('shows both legs of a box that has two', async () => {
    const { app } = sites();
    const r = await app.exec("ssh border 'ip a'");
    expect(r.stdout).toContain('10.0.1.254/24');
    expect(r.stdout).toContain('10.0.2.254/24');
    expect(r.stdout).toContain('eth1');
  });
});

describe('ip route', () => {
  it('names the subnet it reaches directly and the gateway for everything else', async () => {
    const { app } = sites();
    const r = await app.exec('ip route');
    expect(r.stdout).toContain('default via 10.0.1.254 dev eth0');
    expect(r.stdout).toContain('10.0.1.0/24 dev eth0 proto kernel scope link src 10.0.1.10');
  });

  it('has no default route when nothing on the subnet forwards', async () => {
    const { app } = sites({ forwarding: false });
    const r = await app.exec('ip route');
    expect(r.stdout).not.toContain('default via');
    expect(r.stdout).toContain('10.0.1.0/24');
  });
});

/**
 * The three ways a host on another subnet is unreachable.
 *
 * All three are `No route to host`, which is correct and is why reading the
 * route table and `ip addr` on the box in the middle is the only way through.
 */
describe('across a subnet', () => {
  it('works when the border box is up and forwarding', async () => {
    const { app } = sites();
    expect((await app.exec('nc -z db01 5432')).code).toBe(0);
  });

  it('fails when the border box is not forwarding', async () => {
    const { app } = sites({ forwarding: false });
    const r = await app.exec('nc -z db01 5432');
    expect(r.stderr).toContain('No route to host');
  });

  it('fails when the border box is off', async () => {
    const { app } = sites({ borderUp: false });
    expect((await app.exec('nc -z db01 5432')).stderr).toContain('No route to host');
  });

  it('is not a name problem, and dig says so', async () => {
    const { app } = sites({ forwarding: false });
    expect((await app.exec('dig db01 +short')).stdout).toBe('10.0.2.20\n');
    expect((await app.exec('nc -z db01 5432')).stderr).not.toContain('Name or service');
  });

  it('leaves the local subnet alone either way', async () => {
    const { app } = sites({ forwarding: false });
    expect((await app.exec('nc -z border 22')).code).toBe(0);
  });

  /*
   * And the box in the middle reaches both sides, because it is on both.
   */
  it('is reachable from the box with a leg in each', async () => {
    const { app } = sites({ forwarding: false });
    expect((await app.exec("ssh border 'nc -z db01 5432'")).code).toBe(0);
    expect((await app.exec("ssh border 'nc -z app01 80'")).code).toBe(0);
  });
});

describe('one subnet needs no router at all', () => {
  it('reaches everything, which is how every adventure so far has worked', async () => {
    const net = new Network({ routing: true });
    const session: Session = { stack: [] };
    const commands = netCommands();
    const a = new Machine({ hostname: 'a', network: net, session, commands });
    const b = new Machine({ hostname: 'b', network: net, session, commands });
    net.add({ hostname: 'a', ip: '10.9.9.1', machine: a, ports: { 22: 'SSH' } });
    net.add({ hostname: 'b', ip: '10.9.9.2', machine: b, ports: { 22: 'SSH' } });

    expect((await a.exec('nc -z b 22')).code).toBe(0);
    expect((await a.exec('ip route')).stdout).not.toContain('default via');
  });
});

/**
 * And a network that never asked for subnets does not get them.
 *
 * The case this was found by: game six puts its tribunal ledger on 10.9.0.4 to
 * say *that machine is not ours*, which was flavour when it was written
 * because nothing could read anything into an address. Inferring a topology
 * from it and then reporting the story decision as `No route to host` is the
 * engine lying about something it does not know.
 */
describe('a flat network', () => {
  it('reaches another subnet with no router anywhere', async () => {
    const net = new Network();
    const session: Session = { stack: [] };
    const commands = netCommands();
    const here = new Machine({ hostname: 'here', network: net, session, commands });
    const far = new Machine({ hostname: 'far', network: net, session, commands });
    net.add({ hostname: 'here', ip: '10.2.0.1', machine: here, ports: { 22: 'SSH' } });
    net.add({ hostname: 'far', ip: '10.9.0.4', machine: far, ports: { 80: 'ledgerd' } });

    expect((await here.exec('nc -z far 80')).code).toBe(0);
  });
});
