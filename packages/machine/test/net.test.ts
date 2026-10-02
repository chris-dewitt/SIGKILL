import { beforeEach, describe, expect, it } from 'vitest';
import { Machine } from '../src/machine.js';
import { Network, type Session } from '../src/net/network.js';
import { ROOT_USER } from '../src/vfs/vfs.js';

interface Cluster {
  local: Machine;
  net: Network;
  session: Session;
  node01: Machine;
  gateway: Machine;
}

/**
 * Three machines on one network: where the player is, a compute node they can
 * reach, and a gateway serving files over HTTP.
 */
function cluster(): Cluster {
  const net = new Network();
  const session: Session = { stack: [] };
  const common = { network: net, session };

  const local = new Machine({ hostname: 'nav7', ...common });
  local.vfs.mkdirp('/home/dewitt', ROOT_USER);
  local.vfs.chown('/home/dewitt', 1000, 1000, ROOT_USER);
  local.shell.cwd = '/home/dewitt';

  const node01 = new Machine({ hostname: 'node01', ...common });
  node01.vfs.mkdirp('/home/dewitt', ROOT_USER);
  node01.vfs.chown('/home/dewitt', 1000, 1000, ROOT_USER);
  node01.vfs.mkdirp('/data', ROOT_USER);
  node01.vfs.writeText('/data/manifest.txt', 'reactor\nscrubber\nbeacon\n', ROOT_USER);
  node01.shell.cwd = '/home/dewitt';

  const gateway = new Machine({ hostname: 'gateway', ...common });
  gateway.vfs.mkdirp('/srv/http', ROOT_USER);
  gateway.vfs.writeText('/srv/http/index.html', '<h1>NAV-7 gateway</h1>\n', ROOT_USER);
  gateway.vfs.writeText('/srv/http/status.json', '{"reactor":"nominal"}\n', ROOT_USER);

  net.add({
    hostname: 'nav7', ip: '10.0.0.1', machine: local,
    ports: { 22: 'SSH-2.0-OpenSSH_9.6' },
    accounts: { dewitt: { uid: 1000, gid: 1000 } },
  });
  net.add({
    hostname: 'node01', ip: '10.0.0.11', machine: node01,
    ports: { 22: 'SSH-2.0-OpenSSH_9.6' },
    accounts: { dewitt: { uid: 1000, gid: 1000 }, root: { uid: 0, gid: 0 } },
  });
  net.add({
    hostname: 'gateway', ip: '10.0.0.254', machine: gateway,
    ports: { 80: 'nginx/1.24.0' },
    accounts: {},
  });
  net.add({
    hostname: 'node02', ip: '10.0.0.12', machine: new Machine({ hostname: 'node02', ...common }),
    ports: { 22: 'SSH-2.0-OpenSSH_9.6' },
    accounts: { dewitt: { uid: 1000, gid: 1000 } },
    up: false,
  });

  return { local, net, session, node01, gateway };
}

describe('ping', () => {
  let c: Cluster;
  beforeEach(() => { c = cluster(); });

  it('reaches a host that is up', async () => {
    const r = await c.local.exec('ping -c 2 node01');
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('PING node01 (10.0.0.11)');
    expect(r.stdout).toContain('2 packets transmitted, 2 received');
  });

  it('reports loss for a host that is down', async () => {
    const r = await c.local.exec('ping -c 2 node02');
    expect(r.code).toBe(1);
    expect(r.stdout).toContain('100% packet loss');
  });

  it('fails to resolve an unknown name', async () => {
    const r = await c.local.exec('ping nowhere');
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('Name or service not known');
  });

  it('costs virtual time', async () => {
    await c.local.exec('ping -c 3 node01');
    expect(c.local.time).toBe(3000);
  });

  it('resolves by address as well as by name', async () => {
    expect((await c.local.exec('ping -c 1 10.0.0.11')).code).toBe(0);
  });
});

describe('ssh with a command', () => {
  let c: Cluster;
  beforeEach(() => { c = cluster(); });

  it('runs it on the remote machine, against the remote filesystem', async () => {
    const r = await c.local.exec('ssh node01 cat /data/manifest.txt');
    expect(r.code).toBe(0);
    expect(r.stdout).toBe('reactor\nscrubber\nbeacon\n');
    // The file exists there and nowhere else.
    expect(c.local.vfs.exists('/data/manifest.txt', ROOT_USER)).toBe(false);
  });

  it('carries the remote exit code back', async () => {
    expect((await c.local.exec('ssh node01 false')).code).toBe(1);
    expect((await c.local.exec('ssh node01 cat /nope')).code).toBe(1);
  });

  it('leaves the player where they were', async () => {
    await c.local.exec('ssh node01 pwd');
    expect((await c.local.exec('hostname')).stdout).toBe('nav7\n');
  });

  it('refuses an unknown host, a downed host and a closed port', async () => {
    expect((await c.local.exec('ssh nowhere ls')).stderr).toContain('Could not resolve hostname');
    expect((await c.local.exec('ssh node02 ls')).stderr).toContain('No route to host');
    expect((await c.local.exec('ssh gateway ls')).stderr).toContain('Connection refused');
  });

  it('refuses an account the remote host does not have', async () => {
    const r = await c.local.exec('ssh vasquez@node01 ls');
    expect(r.code).toBe(255);
    expect(r.stderr).toContain('Permission denied');
  });

  it('logs in as the requested user', async () => {
    expect((await c.local.exec('ssh root@node01 whoami')).stdout).toBe('root\n');
  });
});

describe('ssh as a session', () => {
  let c: Cluster;
  beforeEach(() => { c = cluster(); });

  it('moves the player, and the prompt follows', async () => {
    expect(c.local.prompt).toContain('@nav7');
    await c.local.exec('ssh node01');
    expect(c.local.prompt).toContain('@node01');

    // Commands now run there without anything being special-cased.
    expect((await c.local.exec('hostname')).stdout).toBe('node01\n');
    expect((await c.local.exec('cat /data/manifest.txt')).stdout).toContain('reactor');
  });

  it('exit walks back rather than ending the session', async () => {
    await c.local.exec('ssh node01');
    const r = await c.local.exec('exit');
    expect(r.stdout).toContain('logout');
    expect(c.local.exited).toBeNull();
    expect((await c.local.exec('hostname')).stdout).toBe('nav7\n');
  });

  it('nests, and unwinds one hop at a time', async () => {
    await c.local.exec('ssh node01');
    await c.local.exec('ssh gateway || true');
    await c.local.exec('ssh nav7');
    expect(c.local.prompt).toContain('@nav7');
    await c.local.exec('exit');
    expect(c.local.prompt).toContain('@node01');
    await c.local.exec('exit');
    expect(c.local.prompt).toContain('@nav7');
  });

  it('exit at the top really does end the session', async () => {
    await c.local.exec('exit');
    expect(c.local.exited).toBe(0);
  });
});

describe('scp', () => {
  let c: Cluster;
  beforeEach(() => { c = cluster(); });

  it('copies a local file to a remote host', async () => {
    await c.local.exec('echo findings > notes.txt');
    const r = await c.local.exec('scp notes.txt node01:/data/notes.txt');
    expect(r.code).toBe(0);
    expect(c.node01.vfs.readText('/data/notes.txt', ROOT_USER)).toBe('findings\n');
  });

  it('copies a remote file back', async () => {
    const r = await c.local.exec('scp node01:/data/manifest.txt manifest.txt');
    expect(r.code).toBe(0);
    expect((await c.local.exec('cat manifest.txt')).stdout).toContain('scrubber');
  });

  it('takes the basename when the target is a directory', async () => {
    await c.local.exec('echo x > payload.bin');
    await c.local.exec('scp payload.bin node01:/data');
    expect(c.node01.vfs.exists('/data/payload.bin', ROOT_USER)).toBe(true);
  });

  it('refuses a host it cannot reach', async () => {
    await c.local.exec('echo x > f');
    expect((await c.local.exec('scp f node02:/tmp/f')).code).toBe(1);
  });
});

describe('curl', () => {
  let c: Cluster;
  beforeEach(() => { c = cluster(); });

  it('serves a file from the host filesystem', async () => {
    const r = await c.local.exec('curl http://gateway/');
    expect(r.code).toBe(0);
    expect(r.stdout).toBe('<h1>NAV-7 gateway</h1>\n');
  });

  it('serves a named path', async () => {
    expect((await c.local.exec('curl http://gateway/status.json')).stdout)
      .toBe('{"reactor":"nominal"}\n');
  });

  it('reflects a file written on the server, because it is the same filesystem', async () => {
    c.gateway.vfs.writeText('/srv/http/motd', 'all hands lost\n', ROOT_USER);
    expect((await c.local.exec('curl http://gateway/motd')).stdout).toBe('all hands lost\n');
  });

  /*
   * An HTTP error is a successful transfer, and curl says so.
   *
   * This is the classic way a health check passes while the service is
   * answering 500 to everybody, so the simulation has to get it right or it
   * teaches the habit backwards.
   */
  it('hands back a 404 body and still exits 0, because the fetch worked', async () => {
    const r = await c.local.exec('curl http://gateway/missing');
    expect(r.stdout).toContain('404 Not Found');
    expect(r.code).toBe(0);
  });

  it('-f is how you ask for the other behaviour, and it drops the body', async () => {
    const r = await c.local.exec('curl -f http://gateway/missing');
    expect(r.code).toBe(22);
    // The error page must not reach the pipe or the file: that is the whole
    // reason -f exists.
    expect(r.stdout).toBe('');
    expect(r.stderr).toContain('The requested URL returned error: 404');
  });

  it('-s silences the message without changing the verdict', async () => {
    const r = await c.local.exec('curl -sf http://gateway/missing');
    expect(r.code).toBe(22);
    expect(r.stderr).toBe('');
  });

  it('-o writes the body to a file instead of stdout', async () => {
    const r = await c.local.exec('curl -o /home/dewitt/status.json http://gateway/status.json');
    expect(r.code).toBe(0);
    expect(r.stdout).toBe('');
    expect(c.local.vfs.readText('/home/dewitt/status.json', ROOT_USER)).toContain('reactor');
  });

  it('refuses a closed port and an unresolvable host', async () => {
    expect((await c.local.exec('curl http://node01/')).code).toBe(7);
    expect((await c.local.exec('curl http://nowhere/')).code).toBe(6);
  });

  /*
   * Three failures a player has to tell apart before they can fix anything:
   * the name is wrong, the host is gone, the service is gone. Reporting the
   * middle one as DNS sends them to look in the wrong place.
   */
  it('distinguishes a host that is down from one that does not exist', async () => {
    const down = await c.local.exec('curl http://node02/');
    expect(down.code).toBe(7);
    expect(down.stderr).toContain('No route to host');

    const missing = await c.local.exec('curl http://nowhere/');
    expect(missing.code).toBe(6);
    expect(missing.stderr).toContain('Could not resolve host');
  });

  it('shows headers with -I', async () => {
    const r = await c.local.exec('curl -I http://gateway/status.json');
    expect(r.stdout).toContain('HTTP/1.1 200 OK');
    expect(r.stdout).toContain('Content-Type: application/json');
  });

  it('is honest that there is no trust store for https', async () => {
    expect((await c.local.exec('curl https://gateway/')).code).toBe(60);
  });
});

describe('nc', () => {
  let c: Cluster;
  beforeEach(() => { c = cluster(); });

  it('reports an open port and its banner', async () => {
    const r = await c.local.exec('nc -zv node01 22');
    expect(r.code).toBe(0);
    expect(r.stderr).toContain('succeeded');
    expect(r.stdout).toContain('OpenSSH');
  });

  it('reports a closed port', async () => {
    const r = await c.local.exec('nc -zv node01 80');
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('Connection refused');
  });

  it('separates a host that is down from a name that does not exist', async () => {
    // `nc` is the tool somebody reaches for *because* ssh or curl failed and
    // they want to know whether anything is answering. It has to be the one
    // that tells the truth about which.
    const down = await c.local.exec('nc -zv node02 22');
    expect(down.code).toBe(1);
    expect(down.stderr).toContain('No route to host');

    const missing = await c.local.exec('nc -zv nowhere 22');
    expect(missing.code).toBe(1);
    expect(missing.stderr).toContain('Name or service not known');
  });
});

describe('a machine with no interface', () => {
  it('says so rather than pretending the host is missing', async () => {
    const alone = new Machine({ hostname: 'isolated' });
    const r = await alone.exec('ping gateway');
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('no network interface');
  });
});

describe('the network stays deterministic', () => {
  it('produces identical snapshots for identical input', async () => {
    const script = [
      'ping -c 2 node01',
      'ssh node01 cat /data/manifest.txt > manifest.txt',
      'curl -s http://gateway/status.json > status.json',
      'echo done > notes.txt',
      'scp notes.txt node01:/data/notes.txt',
    ];

    const run = async (): Promise<unknown> => {
      const c = cluster();
      for (const line of script) await c.local.exec(line);
      return [c.local.snapshot(), c.node01.snapshot()];
    };

    expect(await run()).toEqual(await run());
  });
});
