import { describe, expect, it } from 'vitest';
import { Machine, Network, ROOT_USER, type Session } from '@sigkill/machine';
import { netCommands } from '../src/index.js';

/**
 * The instruments, and the one disagreement they exist to show.
 *
 * `dig` and `host` ask the nameserver. `getent hosts` asks the resolver, which
 * reads `/etc/hosts` first. When those two answers differ, the program that is
 * failing is using the second one — and every tool an operator reaches for by
 * reflex reports the first.
 */

function floor(): { local: Machine; net: Network } {
  const net = new Network();
  const session: Session = { stack: [] };
  const commands = netCommands();

  const local = new Machine({ hostname: 'bastion', network: net, session, commands });
  local.vfs.mkdirp('/etc', ROOT_USER);
  const api = new Machine({ hostname: 'api01', network: net, session, commands });

  net.add({ hostname: 'bastion', ip: '10.0.1.1', machine: local, ports: { 22: 'SSH' } });
  net.add({ hostname: 'api01', ip: '10.0.1.10', machine: api, ports: { 22: 'SSH', 80: 'nginx' } });
  return { local, net };
}

const hosts = (m: Machine, text: string): void => m.vfs.writeText('/etc/hosts', text, ROOT_USER);

describe('dig', () => {
  it('answers from the nameserver', async () => {
    const { local } = floor();
    const r = await local.exec('dig api01 +short');
    expect(r.stdout).toBe('10.0.1.10\n');
    expect(r.code).toBe(0);
  });

  it('prints a header, a question and an answer', async () => {
    const { local } = floor();
    const r = await local.exec('dig api01');
    expect(r.stdout).toContain('status: NOERROR');
    expect(r.stdout).toContain('ANSWER SECTION');
    expect(r.stdout).toContain('api01.\t3600\tIN\tA\t10.0.1.10');
  });

  /*
   * The whole reason this package exists.
   *
   * The file says one thing, the nameserver says another, and dig reports the
   * nameserver with no hint that anything is overriding it.
   */
  it('reads straight past /etc/hosts, which is how a stale line survives', async () => {
    const { local } = floor();
    hosts(local, '10.0.9.99 api01\n');
    expect((await local.exec('dig api01 +short')).stdout).toBe('10.0.1.10\n');
    expect((await local.exec('host api01')).stdout).toContain('10.0.1.10');
    // And the one that answers the question the player is actually asking:
    expect((await local.exec('getent hosts api01')).stdout).toContain('10.0.9.99');
  });

  it('knows nothing of a name only the file carries', async () => {
    const { local } = floor();
    hosts(local, '10.0.1.10 api\n');
    expect((await local.exec('dig api +short')).stdout).toBe('');
    expect((await local.exec('getent hosts api')).stdout).toContain('10.0.1.10');
  });

  /*
   * The curl lesson again, in a different tool.
   *
   * `dig name +short && echo ok` prints ok for a name that does not exist,
   * because the server answered and the answer was "no such name". Faithful to
   * the real tool, and the manual says so out loud.
   */
  it('exits 0 for a name that does not exist, as the real one does', async () => {
    const { local } = floor();
    const r = await local.exec('dig nowhere +short');
    expect(r.stdout).toBe('');
    expect(r.code).toBe(0);
    expect((await local.exec('dig nowhere')).stdout).toContain('NXDOMAIN');
  });

  it('turns an address back into a name', async () => {
    const { local } = floor();
    expect((await local.exec('dig -x 10.0.1.10 +short')).stdout).toBe('api01.\n');
    expect((await local.exec('dig -x 10.0.9.99')).stdout).toContain('NXDOMAIN');
  });
});

describe('host', () => {
  it('says it in one line', async () => {
    const { local } = floor();
    expect((await local.exec('host api01')).stdout).toBe('api01 has address 10.0.1.10\n');
  });

  it('fails on a name that does not exist, which dig does not', async () => {
    const { local } = floor();
    const r = await local.exec('host nowhere');
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('NXDOMAIN');
    expect((await local.exec('dig nowhere')).code).toBe(0);
  });

  it('goes backwards too', async () => {
    const { local } = floor();
    expect((await local.exec('host 10.0.1.1')).stdout).toContain('bastion');
  });
});

describe('getent hosts', () => {
  it('is the answer the program will act on', async () => {
    const { local } = floor();
    hosts(local, '10.0.9.99 api01 api\n');
    const r = await local.exec('getent hosts api01');
    expect(r.stdout).toContain('10.0.9.99');
    // Both names from the line, as getent prints them.
    expect(r.stdout).toContain('api01 api');
  });

  it('falls through to the nameserver when the file has nothing to say', async () => {
    const { local } = floor();
    hosts(local, '127.0.0.1 localhost\n');
    // Padded to a column, as getent prints it.
    expect((await local.exec('getent hosts api01')).stdout).toMatch(/^10\.0\.1\.10\s+api01$/m);
  });

  it('fails with 2 when nothing resolves, and says nothing at all', async () => {
    const { local } = floor();
    const r = await local.exec('getent hosts nowhere');
    expect(r.code).toBe(2);
    expect(r.stdout).toBe('');
  });

  /*
   * With no key it lists the file, because that is all a resolver can
   * enumerate. DNS answers questions; it does not hand over a list.
   */
  it('lists the file, and only the file', async () => {
    const { local } = floor();
    hosts(local, '# a note\n10.0.9.99 api01\n127.0.0.1 localhost\n');
    const r = await local.exec('getent hosts');
    expect(r.stdout).toContain('10.0.9.99');
    expect(r.stdout).toContain('localhost');
    expect(r.stdout).not.toContain('10.0.1.10');
  });

  it('refuses a database it does not have', async () => {
    const { local } = floor();
    const r = await local.exec('getent passwd dewitt');
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('Unknown database');
  });
});

describe('the instruments are honest about what they are', () => {
  it('each explains, in plain language, which question it asks', async () => {
    const { local } = floor();
    for (const [command, phrase] of [
      ['man dig', 'does not read'],
      ['man host', 'reads no local file'],
      ['man getent', '/etc/hosts first'],
    ] as const) {
      expect((await local.exec(command)).stdout, command).toContain(phrase);
    }
  });
});
