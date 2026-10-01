import { describe, expect, it } from 'vitest';
import { Machine } from '../src/machine.js';
import { Network, type Session } from '../src/net/network.js';
import { ROOT_USER } from '../src/vfs/vfs.js';

/**
 * The spike for game six's engine, kept.
 *
 * Policy: probe the engine with the new game's idiom before authoring the
 * game. Seven bugs in `packages/python` were found that way before game three
 * and two of them would have made the act unplayable.
 *
 * Game six is operations -- hosts that depend on each other, a service that is
 * down, a deploy, a rollback. In the shell that is `ssh`, `scp`, `curl`,
 * and `systemctl` aimed at a machine that is not this one, with the output
 * read back over the link. So that is what this runs, and five things were
 * wrong:
 *
 *   1. `curl -o FILE URL` was not implemented. `-o` fell through to the
 *      operands and the filename was parsed as the URL: "Bad hostname".
 *   2. `curl` exited 22 on a 404 *without* `-f`. The real tool exits 0,
 *      because the transfer succeeded -- which is exactly how a health check
 *      passes while the service answers 500 to everybody. Simulating it
 *      backwards would have taught the habit backwards.
 *   3. `-f`/`--fail` did nothing, and the error page was printed anyway.
 *      Throwing the body away is the entire reason the flag exists.
 *   4. `curl` reported a host that was *down* as a name-resolution failure.
 *   5. `nc` did the same.
 *
 * 4 and 5 are the ones worth the probe on their own. Telling the three
 * failures apart -- the name is wrong, the host is gone, the service is gone
 * -- is the first diagnostic move in operations, and two of the three tools
 * were naming the wrong one. `ssh` had it right all along, which is what the
 * fix was modelled on.
 */

interface Fleet {
  local: Machine;
  net: Network;
  session: Session;
  api: Machine;
  db: Machine;
}

function fleet(): Fleet {
  const net = new Network();
  const session: Session = { stack: [] };
  const common = { network: net, session };

  const local = new Machine({ hostname: 'bastion', ...common });
  local.vfs.mkdirp('/home/dewitt', ROOT_USER);
  local.vfs.chown('/home/dewitt', 1000, 1000, ROOT_USER);
  local.shell.cwd = '/home/dewitt';

  const api = new Machine({ hostname: 'api01', ...common });
  api.vfs.mkdirp('/home/dewitt', ROOT_USER);
  api.vfs.chown('/home/dewitt', 1000, 1000, ROOT_USER);
  api.vfs.mkdirp('/var/log', ROOT_USER);
  api.vfs.mkdirp('/etc/systemd/system', ROOT_USER);
  api.vfs.mkdirp('/srv/http', ROOT_USER);
  api.vfs.writeText('/srv/http/health', 'ok\n', ROOT_USER);
  api.vfs.mkdirp('/etc/app', ROOT_USER);
  api.vfs.writeText('/etc/app/version', '1.4.2\n', ROOT_USER);

  const db = new Machine({ hostname: 'db01', ...common });
  db.vfs.mkdirp('/var/log', ROOT_USER);
  db.vfs.writeText('/var/log/db.log', 'accepting connections\n', ROOT_USER);

  net.add({
    hostname: 'bastion', ip: '10.0.1.1', machine: local,
    ports: { 22: 'SSH-2.0-OpenSSH_9.6' },
    accounts: { dewitt: { uid: 1000, gid: 1000 } },
  });
  net.add({
    hostname: 'api01', ip: '10.0.1.10', machine: api,
    ports: { 22: 'SSH-2.0-OpenSSH_9.6', 80: 'nginx/1.24.0' },
    accounts: { dewitt: { uid: 1000, gid: 1000 }, root: { uid: 0, gid: 0 } },
  });
  net.add({
    hostname: 'db01', ip: '10.0.1.20', machine: db,
    ports: { 22: 'SSH-2.0-OpenSSH_9.6', 5432: 'PostgreSQL 16.2' },
    accounts: { dewitt: { uid: 1000, gid: 1000 } },
  });

  return { local, net, session, api, db };
}

describe('probe: running a command somewhere else', () => {
  it('takes a quoted pipeline, which is how anybody actually uses ssh', async () => {
    const f = fleet();
    f.api.vfs.writeText('/var/log/api.log', 'GET /health 200\nGET /x 500\nGET /y 500\n', ROOT_USER);

    const plain = await f.local.exec("ssh api01 'cat /etc/app/version'");
    expect(plain.code).toBe(0);
    expect(plain.stdout).toContain('1.4.2');

    // The pipe belongs to the remote shell, not the local one.
    const piped = await f.local.exec("ssh api01 'grep 500 /var/log/api.log | wc -l'");
    expect(piped.code).toBe(0);
    expect(piped.stdout.trim()).toBe('2');
  });

  it('puts remote output into a local file, which is how evidence is kept', async () => {
    const f = fleet();
    const r = await f.local.exec("ssh api01 'cat /etc/app/version' > /home/dewitt/deployed.txt");
    expect(r.code).toBe(0);
    expect(f.local.vfs.readText('/home/dewitt/deployed.txt', ROOT_USER)).toContain('1.4.2');
  });

  it('pipes remote output into a local command', async () => {
    const f = fleet();
    const r = await f.local.exec("ssh db01 'cat /var/log/db.log' | grep -c connections");
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toBe('1');
  });

  it('substitutes a remote command into a local one', async () => {
    const f = fleet();
    const r = await f.local.exec("echo running $(ssh api01 'cat /etc/app/version')");
    expect(r.stdout).toContain('running 1.4.2');
  });
});

describe('probe: operating a service that is not on this machine', () => {
  /** A unit is a file, which is what the player will be reading and editing. */
  const unit = (m: Machine, name: string, description: string): void => {
    m.vfs.mkdirp('/etc/systemd/system', ROOT_USER);
    m.vfs.writeText(
      `/etc/systemd/system/${name}.service`,
      `[Unit]\nDescription=${description}\n\n[Service]\nExecStart=/usr/bin/${name}\n`,
      ROOT_USER,
    );
  };

  it('reports a remote unit over ssh, which is the whole verb of a deploy', async () => {
    const f = fleet();
    unit(f.api, 'api', 'The API');
    f.api.services.start('api');

    const r = await f.local.exec("ssh api01 'systemctl status api'");
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('api.service - The API');
    expect(r.stdout).toContain('active');
  });

  it('stops one remotely, given sudo on the far side', async () => {
    const f = fleet();
    unit(f.api, 'api', 'The API');
    f.api.services.start('api');
    f.api.vfs.mkdirp('/etc', ROOT_USER);
    f.api.vfs.writeText('/etc/sudoers', 'dewitt ALL=(ALL) NOPASSWD: ALL\n', ROOT_USER);

    const stop = await f.local.exec("ssh api01 'sudo systemctl stop api'");
    expect(stop.code).toBe(0);
    expect(f.api.services.get('api')?.state).not.toBe('active');
  });

  it('refuses without it, in the remote host\'s own words', async () => {
    const f = fleet();
    unit(f.api, 'api', 'The API');
    f.api.services.start('api');

    const stop = await f.local.exec("ssh api01 'sudo systemctl stop api'");
    expect(stop.code).not.toBe(0);
    expect(stop.stderr).toContain('not in the sudoers file');
    // And the service is untouched, which is the point of the refusal.
    expect(f.api.services.get('api')?.state).toBe('active');
  });
});

describe('probe: checking whether a thing is healthy', () => {
  it('fetches, and writes to a file with -o', async () => {
    const f = fleet();
    expect((await f.local.exec('curl http://api01/health')).stdout).toContain('ok');

    const saved = await f.local.exec('curl -o /home/dewitt/health.txt http://api01/health');
    expect(saved.code).toBe(0);
    expect(saved.stdout).toBe('');
    expect(f.local.vfs.readText('/home/dewitt/health.txt', ROOT_USER)).toContain('ok');
  });

  /*
   * The trap the act is built on.
   *
   * `curl URL` on a 500 exits 0. A deploy script that checks only the exit
   * status ships a broken service and reports success, and that is a real
   * habit this game can take off somebody cheaply.
   */
  it('calls an HTTP error a successful transfer unless asked not to', async () => {
    const f = fleet();
    const quiet = await f.local.exec('curl http://api01/nope');
    expect(quiet.code).toBe(0);
    expect(quiet.stdout).toContain('404');

    const strict = await f.local.exec('curl -f http://api01/nope');
    expect(strict.code).toBe(22);
    expect(strict.stdout).toBe('');
  });
});

describe('probe: the three failures an operator has to tell apart', () => {
  it('names the wrong one for none of ssh, curl or nc', async () => {
    const f = fleet();

    // 1. The name does not exist.
    expect((await f.local.exec('ssh nosuchhost echo hi')).stderr).toContain('Could not resolve');
    expect((await f.local.exec('curl http://nosuchhost/')).stderr).toContain('Could not resolve');
    expect((await f.local.exec('nc -z nosuchhost 22')).stderr).toContain('Name or service not known');

    // 2. The host exists and is not answering.
    f.net.setUp('db01', false);
    expect((await f.local.exec("ssh db01 'echo hi'")).stderr).toContain('No route to host');
    expect((await f.local.exec('curl http://db01/')).stderr).toContain('No route to host');
    expect((await f.local.exec('nc -z db01 5432')).stderr).toContain('No route to host');

    // 3. The host is answering and the service is not.
    expect((await f.local.exec('nc -z api01 443')).stderr).toContain('Connection refused');
    expect((await f.local.exec('curl http://api01:443/')).stderr).toContain('Connection refused');
  });

  it('still says the host is up when only the service is gone', async () => {
    const f = fleet();
    expect((await f.local.exec('ping -c 1 api01')).code).toBe(0);
    expect((await f.local.exec('nc -z api01 443')).code).toBe(1);
  });
});

describe('probe: moving a file, which is what a deploy is', () => {
  it('copies up and down, and the far side really changed', async () => {
    const f = fleet();
    f.local.vfs.writeText('/home/dewitt/app.conf', 'workers=4\n', ROOT_USER);

    expect((await f.local.exec('scp /home/dewitt/app.conf api01:/etc/app/app.conf')).code).toBe(0);
    expect((await f.local.exec("ssh api01 'cat /etc/app/app.conf'")).stdout).toContain('workers=4');

    expect(
      (await f.local.exec('scp api01:/etc/app/version /home/dewitt/remote-version')).code,
    ).toBe(0);
    expect(f.local.vfs.readText('/home/dewitt/remote-version', ROOT_USER)).toContain('1.4.2');
  });
});

/**
 * What the engine has not got.
 *
 * Not a complaint -- a boundary, recorded where the next author will trip over
 * it rather than discover it halfway through writing an objective. There is no
 * name resolution to inspect or edit, nothing that reports listening sockets,
 * and no routing or firewall surface at all. `Network.resolve()` is hostname
 * and address lookup in one map, and that is the whole of DNS.
 *
 * So an adventure about DNS, routing, TLS or firewalls needs a new engine
 * first, on the scale of `packages/sql` or `packages/ml`. An adventure about
 * operating services across hosts -- deploy, observe, roll back -- needs none
 * of it and is supported today, which is what everything above demonstrates.
 *
 * If one of these ever arrives, this test fails and says so, which is the
 * point: the boundary should not move quietly.
 */
describe('probe: the boundary of the simulated network', () => {
  it('has no DNS, socket, routing or firewall tooling', async () => {
    const f = fleet();
    for (const absent of [
      'dig api01',
      'host api01',
      'nslookup api01',
      'ss -ltn',
      'netstat -ltn',
      'ip addr',
      'route -n',
      'iptables -L',
      'ufw status',
    ]) {
      const r = await f.local.exec(absent);
      expect(r.code, `${absent} exists now -- see the note above this test`).toBe(127);
    }
  });

  it('has no /etc/hosts, because resolution is not a file', async () => {
    const f = fleet();
    const r = await f.local.exec('cat /etc/hosts');
    expect(r.code).not.toBe(0);
  });
});
