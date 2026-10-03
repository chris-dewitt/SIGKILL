import { describe, expect, it } from 'vitest';
import { Machine } from '../src/machine.js';
import { Network, type Session } from '../src/net/network.js';
import { ROOT_USER } from '../src/vfs/vfs.js';

/**
 * Resolution as a file, which is what `packages/net` starts from.
 *
 * Until now `Network.resolve()` was hostname-and-address lookup in one map and
 * that was the whole of DNS: nothing to read, nothing to edit, nothing to get
 * wrong. `probe-net.test.ts` recorded that as a boundary and said an adventure
 * about DNS needs an engine first.
 *
 * This is the first half of that engine. `/etc/hosts` is an ordinary file on
 * the machine doing the resolving, it wins over the network's own map the way
 * `hosts: files dns` makes it win on a real box, and a name pointed at an
 * address nothing answers at is a *different failure* from a name nothing
 * knows -- which is the entire diagnostic skill the file exists to teach.
 */

interface Fleet {
  local: Machine;
  net: Network;
  api: Machine;
}

function fleet(): Fleet {
  const net = new Network();
  const session: Session = { stack: [] };
  const common = { network: net, session };

  const local = new Machine({ hostname: 'bastion', ...common });
  local.vfs.mkdirp('/etc', ROOT_USER);
  local.vfs.mkdirp('/home/dewitt', ROOT_USER);
  local.vfs.chown('/home/dewitt', 1000, 1000, ROOT_USER);
  local.shell.cwd = '/home/dewitt';

  const api = new Machine({ hostname: 'api01', ...common });
  api.vfs.mkdirp('/srv/http', ROOT_USER);
  api.vfs.writeText('/srv/http/health', 'ok\n', ROOT_USER);

  net.add({
    hostname: 'bastion',
    ip: '10.0.1.1',
    machine: local,
    ports: { 22: 'SSH-2.0-OpenSSH_9.6' },
    accounts: { dewitt: { uid: 1000, gid: 1000 } },
  });
  net.add({
    hostname: 'api01',
    ip: '10.0.1.10',
    machine: api,
    ports: { 22: 'SSH-2.0-OpenSSH_9.6', 80: 'nginx/1.24.0' },
    accounts: { dewitt: { uid: 1000, gid: 1000 }, root: { uid: 0, gid: 0 } },
  });
  return { local, net, api };
}

const hosts = (f: Fleet, text: string): void =>
  f.local.vfs.writeText('/etc/hosts', text, ROOT_USER);

describe('a machine with no /etc/hosts', () => {
  /*
   * The five games that exist have no hosts file, and this is the assertion
   * that keeps the file an addition rather than a change: with no file, every
   * name resolves exactly as it did before.
   */
  it('resolves by the network map, as it always has', async () => {
    const f = fleet();
    expect((await f.local.exec('curl http://api01/health')).stdout).toBe('ok\n');
    expect((await f.local.exec('curl http://10.0.1.10/health')).stdout).toBe('ok\n');
    expect((await f.local.exec('ssh api01 true')).code).toBe(0);
  });
});

describe('/etc/hosts, when there is one', () => {
  it('is an ordinary file the player can read', async () => {
    const f = fleet();
    hosts(f, '127.0.0.1 localhost\n10.0.1.10 api01 api\n');
    const r = await f.local.exec('cat /etc/hosts');
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('api01');
  });

  it('names a host by an alias that the network map has never heard of', async () => {
    const f = fleet();
    hosts(f, '10.0.1.10 api01 api\n');
    expect((await f.local.exec('curl http://api/health')).stdout).toBe('ok\n');
    expect((await f.local.exec('ssh api true')).code).toBe(0);
  });

  it('ignores comments and blank lines, as any resolver does', async () => {
    const f = fleet();
    hosts(f, '# the API box\n\n   \n10.0.1.10 api  # trailing note\n');
    expect((await f.local.exec('curl http://api/health')).stdout).toBe('ok\n');
  });

  it('wins over the network map, which is the whole reason to break one', async () => {
    const f = fleet();
    // api01 is 10.0.1.10. Somebody pointed it at the bastion.
    hosts(f, '10.0.1.1 api01\n');
    const r = await f.local.exec('curl http://api01/health');
    // The bastion has no port 80 at all, so the name resolves and the
    // connection is refused -- which is a different sentence from "no such
    // host", and telling them apart is the point.
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('Connection refused');
    expect(r.stderr).not.toContain('Could not resolve');
  });

  it('falls through to the network map for a name it does not carry', async () => {
    const f = fleet();
    hosts(f, '127.0.0.1 localhost\n');
    expect((await f.local.exec('curl http://api01/health')).stdout).toBe('ok\n');
  });
});

/**
 * The three failures, told apart.
 *
 * The first diagnostic move in operations, and the reason a hosts file is
 * worth having in the engine at all: an entry pointing at an address nobody
 * answers at must not look like a name nobody knows.
 */
describe('a name pointed at nothing', () => {
  it('resolves, and then fails to connect', async () => {
    const f = fleet();
    hosts(f, '10.0.9.99 api01\n');

    const curl = await f.local.exec('curl http://api01/health');
    expect(curl.stderr).toContain('No route to host');
    expect(curl.stderr).not.toContain('Could not resolve');
    expect(curl.code).toBe(7);

    const ssh = await f.local.exec('ssh api01 true');
    expect(ssh.stderr).toContain('No route to host');
    expect(ssh.stderr).not.toContain('Could not resolve');

    const nc = await f.local.exec('nc -z api01 22');
    expect(nc.stderr).toContain('No route to host');
  });

  it('pings the address it was given, and gets nothing back', async () => {
    const f = fleet();
    hosts(f, '10.0.9.99 api01\n');
    const r = await f.local.exec('ping -c 2 api01');
    expect(r.stdout).toContain('10.0.9.99');
    expect(r.stdout).toContain('100% packet loss');
    expect(r.code).toBe(1);
  });

  it('is still a name nobody knows when it is in no file and no map', async () => {
    const f = fleet();
    hosts(f, '10.0.1.10 api01\n');
    const r = await f.local.exec('curl http://api02/health');
    expect(r.stderr).toContain('Could not resolve');
    expect(r.code).toBe(6);
  });
});

/**
 * scp lumped all three failures into one sentence.
 *
 * Found while wiring the resolver through: `ssh`, `curl` and `nc` each name
 * which of the three went wrong and `scp` said "Could not reach host" to all
 * of them, including a name that simply does not exist. Fixed here because
 * the file makes it much easier to hit.
 */
describe('scp says which failure it was', () => {
  it('a name nothing knows', async () => {
    const f = fleet();
    f.local.vfs.writeText('/home/dewitt/app.conf', 'workers=4\n', ROOT_USER);
    const r = await f.local.exec('scp /home/dewitt/app.conf api02:/tmp/app.conf');
    expect(r.stderr).toContain('Could not resolve');
  });

  it('a name pointed at nothing', async () => {
    const f = fleet();
    hosts(f, '10.0.9.99 api01\n');
    f.local.vfs.writeText('/home/dewitt/app.conf', 'workers=4\n', ROOT_USER);
    const r = await f.local.exec('scp /home/dewitt/app.conf api01:/tmp/app.conf');
    expect(r.stderr).toContain('No route to host');
  });

  it('and a host that is simply off', async () => {
    const f = fleet();
    f.net.setUp('api01', false);
    f.local.vfs.writeText('/home/dewitt/app.conf', 'workers=4\n', ROOT_USER);
    const r = await f.local.exec('scp /home/dewitt/app.conf api01:/tmp/app.conf');
    expect(r.stderr).toContain('No route to host');
  });
});

/**
 * Resolution happens on the machine doing the resolving.
 *
 * Not on the one the player started from. A hosts file on the bastion must not
 * follow them over ssh, because the first thing anybody learns about a hosts
 * file is that it is per-machine and the box you are paged about does not have
 * your one.
 */
describe('the file belongs to the machine that reads it', () => {
  it('does not follow the player over ssh', async () => {
    const f = fleet();
    hosts(f, '10.0.1.10 api\n');
    expect((await f.local.exec('curl http://api/health')).stdout).toBe('ok\n');

    const remote = await f.local.exec("ssh api01 'curl http://api/health'");
    expect(remote.stderr).toContain('Could not resolve');
  });
});

/**
 * 127.0.0.1 is whoever is asking.
 *
 * Not a host on the network and never routed to one, which is the only way the
 * engine can express the connection that is supposed to succeed: a service
 * bound to loopback answers its own machine and refuses everybody else.
 */
describe('loopback', () => {
  it('is the machine running the command, by address and by name', async () => {
    const f = fleet();
    // The bastion has ssh open, so it can reach its own.
    expect((await f.local.exec('nc -z 127.0.0.1 22')).code).toBe(0);
    expect((await f.local.exec('nc -z localhost 22')).code).toBe(0);
  });

  it('is a different machine on the other end of an ssh', async () => {
    const f = fleet();
    // api01 has port 80; the bastion does not. `localhost` over there is
    // over there.
    expect((await f.local.exec("ssh api01 'nc -z localhost 80'")).code).toBe(0);
    expect((await f.local.exec('nc -z localhost 80')).stderr).toContain('refused');
  });

  it('can be pointed somewhere else by the hosts file, which is a real bug', async () => {
    const f = fleet();
    // The classic: a line that sends a service's own name at the local box.
    hosts(f, '127.0.0.1 api01\n');
    const r = await f.local.exec('curl http://api01/health');
    expect(r.stderr).toContain('Connection refused');
    expect(r.stderr).not.toContain('Could not resolve');
  });
});
