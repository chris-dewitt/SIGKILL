import { beforeEach, describe, expect, it } from 'vitest';
import { Machine } from '../src/machine.js';
import { ROOT_USER } from '../src/vfs/vfs.js';

const SCRUBBER_UNIT = [
  '[Unit]',
  'Description=Atmosphere scrubber',
  '',
  '[Service]',
  'ExecStart=/usr/sbin/scrubber --config /etc/life_support.conf',
  'Restart=on-failure',
  '',
  '[Install]',
  'WantedBy=multi-user.target',
  '',
].join('\n');

/**
 * NAV-7 as Act I starts: a scrubber that will not run because the oxygen
 * target is outside what the controller accepts.
 */
function boot(): Machine {
  const m = new Machine({ hostname: 'nav7' });
  const v = m.vfs;

  v.mkdirp('/etc/systemd/system', ROOT_USER);
  v.mkdirp('/home/survivor', ROOT_USER);
  v.chown('/home/survivor', 1000, 1000, ROOT_USER);
  v.writeText('/etc/systemd/system/scrubber.service', SCRUBBER_UNIT, ROOT_USER);
  v.writeText('/etc/life_support.conf', 'O2_TARGET=16\nSCRUBBER_DUTY=0.4\n', ROOT_USER);
  v.chmod('/etc/life_support.conf', 0o666, ROOT_USER);
  v.writeText('/etc/sudoers', '# who may act as root\nroot ALL=(ALL) ALL\nsurvivor ALL=(ALL) ALL\n', ROOT_USER);
  v.chmod('/etc/sudoers', 0o644, ROOT_USER);

  // Authored by the adventure, not the Machine: a real atmosphere controller
  // refuses a target outside the breathable band, and says so.
  m.setPrecondition('scrubber', (vfs) => {
    const conf = vfs.readText('/etc/life_support.conf', ROOT_USER);
    const target = Number(/O2_TARGET=(\d+(?:\.\d+)?)/.exec(conf)?.[1] ?? NaN);
    if (!Number.isFinite(target)) {
      return { ok: false, reason: 'O2_TARGET missing or unreadable in /etc/life_support.conf' };
    }
    if (target < 19 || target > 23) {
      return {
        ok: false,
        reason: `O2_TARGET=${target} outside breathable range 19-23; refusing to run`,
      };
    }
    return { ok: true };
  });

  m.shell.cwd = '/home/survivor';
  return m;
}

describe('units', () => {
  it('reads a unit file off the filesystem', async () => {
    const m = boot();
    const status = m.services.get('scrubber');
    expect(status?.description).toBe('Atmosphere scrubber');
    expect(status?.state).toBe('inactive');
    expect(status?.enabled).toBe(false);
  });

  it('accepts a name with or without the .service suffix', async () => {
    const m = boot();
    expect(m.services.get('scrubber.service')?.name).toBe('scrubber');
  });

  it('sees a unit file the player writes', async () => {
    const m = boot();
    expect(m.services.get('beacon')).toBeUndefined();
    m.vfs.writeText(
      '/etc/systemd/system/beacon.service',
      '[Unit]\nDescription=Distress beacon\n\n[Service]\nExecStart=/usr/sbin/beacon\n',
      ROOT_USER,
    );
    expect(m.services.get('beacon')?.description).toBe('Distress beacon');
  });
});

describe('systemctl', () => {
  let m: Machine;
  beforeEach(async () => { m = boot(); });

  it('refuses to start a unit whose precondition fails, and says why', async () => {
    const r = await m.exec('sudo systemctl start scrubber');
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('outside breathable range');
    expect(m.services.get('scrubber')?.state).toBe('failed');
  });

  it('puts the reason where a player would look: systemctl status', async () => {
    await m.exec('sudo systemctl start scrubber');
    const r = await m.exec('systemctl status scrubber');
    expect(r.stdout).toContain('Active: failed');
    expect(r.stdout).toContain('O2_TARGET=16 outside breathable range');
    // systemd exits non-zero for an inactive unit, and so do we.
    expect(r.code).toBe(3);
  });

  it('starts once the configuration is fixed', async () => {
    await m.exec("sudo sed -i 's/O2_TARGET=16/O2_TARGET=21/' /etc/life_support.conf");
    const r = await m.exec('sudo systemctl start scrubber');
    expect(r.stderr).toBe('');
    expect(r.code).toBe(0);

    const status = m.services.get('scrubber');
    expect(status?.state).toBe('active');
    expect(status?.pid).toBeGreaterThan(0);
    expect((await m.exec('systemctl status scrubber')).code).toBe(0);
  });

  it('shows the running service in ps', async () => {
    await m.exec("sudo sed -i 's/16/21/' /etc/life_support.conf");
    await m.exec('sudo systemctl start scrubber');
    expect((await m.exec('ps -ef')).stdout).toContain('/usr/sbin/scrubber');
  });

  it('stops a service and frees its pid', async () => {
    await m.exec("sudo sed -i 's/16/21/' /etc/life_support.conf");
    await m.exec('sudo systemctl start scrubber');
    const pid = m.services.get('scrubber')!.pid!;
    await m.exec('sudo systemctl stop scrubber');
    expect(m.services.get('scrubber')?.state).toBe('inactive');
    expect(m.procs.get(pid)).toBeUndefined();
  });

  it('reports a unit that does not exist', async () => {
    const r = await m.exec('systemctl status nosuch');
    expect(r.code).toBe(4);
    expect(r.stderr).toContain('could not be found');
  });

  it('lists units', async () => {
    const out = (await m.exec('systemctl list-units')).stdout;
    expect(out).toContain('scrubber.service');
    expect(out).toContain('Atmosphere scrubber');
  });
});

describe('enable is a symlink, not a flag', () => {
  it('creates a real symlink that ls can see', async () => {
    const m = boot();
    await m.exec('sudo systemctl enable scrubber');

    const link = '/etc/systemd/system/multi-user.target.wants/scrubber.service';
    expect(m.vfs.lstat(link, ROOT_USER).kind).toBe('symlink');
    expect(m.vfs.readlink(link, ROOT_USER)).toBe('/etc/systemd/system/scrubber.service');
    expect(m.services.get('scrubber')?.enabled).toBe(true);

    const listing = (await m.exec('ls -l /etc/systemd/system/multi-user.target.wants')).stdout;
    expect(listing).toContain('scrubber.service -> /etc/systemd/system/scrubber.service');
  });

  it('disable removes it', async () => {
    const m = boot();
    await m.exec('sudo systemctl enable scrubber');
    await m.exec('sudo systemctl disable scrubber');
    expect(m.services.get('scrubber')?.enabled).toBe(false);
  });

  it('starts enabled units at boot, and only those', async () => {
    const m = boot();
    await m.exec("sudo sed -i 's/16/21/' /etc/life_support.conf");
    m.services.startEnabled();
    expect(m.services.get('scrubber')?.state).toBe('inactive');

    await m.exec('sudo systemctl enable scrubber');
    m.services.startEnabled();
    expect(m.services.get('scrubber')?.state).toBe('active');
  });
});

describe('privilege', () => {
  it('refuses systemctl start to an ordinary user', async () => {
    const m = boot();
    const r = await m.exec('systemctl start scrubber');
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('Access denied');
    expect(m.services.get('scrubber')?.state).toBe('inactive');
  });

  it('allows status to anyone', async () => {
    const m = boot();
    expect((await m.exec('systemctl status scrubber')).stdout).toContain('Atmosphere scrubber');
  });

  it('sudo elevates for exactly one command', async () => {
    const m = boot();
    expect((await m.exec('whoami')).stdout).toBe('survivor\n');
    expect((await m.exec('sudo whoami')).stdout).toBe('root\n');
    expect((await m.exec('whoami')).stdout).toBe('survivor\n');
  });

  it('refuses sudo to a user absent from sudoers', async () => {
    const m = boot();
    m.vfs.writeText('/etc/sudoers', 'root ALL=(ALL) ALL\n', ROOT_USER);
    const r = await m.exec('sudo systemctl start scrubber');
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('not in the sudoers file');
  });

  it('refuses sudo when there is no sudoers file at all', async () => {
    const m = boot();
    m.vfs.unlink('/etc/sudoers', ROOT_USER);
    expect((await m.exec('sudo whoami')).stderr).toContain('not in the sudoers file');
  });
});

describe('kill', () => {
  it('marks a unit inactive when its process is killed behind its back', async () => {
    const m = boot();
    await m.exec("sudo sed -i 's/16/21/' /etc/life_support.conf");
    await m.exec('sudo systemctl start scrubber');
    const pid = m.services.get('scrubber')!.pid!;

    await m.exec(`sudo kill -9 ${pid}`);

    // The unit must not be left "active" pointing at a pid that is gone.
    expect(m.services.get('scrubber')?.state).toBe('inactive');
    expect(m.procs.get(pid)).toBeUndefined();
  });

  it('reports a pid that does not exist', async () => {
    const m = boot();
    const r = await m.exec('kill 9999');
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('No such process');
  });

  it('stops an ordinary user killing root-owned processes', async () => {
    const m = boot();
    const r = await m.exec('kill 1');
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('Operation not permitted');
    expect(m.procs.get(1)).toBeDefined();
  });
});

describe('service state survives a snapshot', () => {
  it('restores active units, pids and the clock', async () => {
    const m = boot();
    await m.exec("sudo sed -i 's/16/21/' /etc/life_support.conf");
    await m.exec('sudo systemctl enable scrubber');
    await m.exec('sudo systemctl start scrubber');
    await m.tick(9000);
    const saved = m.snapshot();

    const restored = Machine.restore(saved, { hostname: 'nav7' });
    const status = restored.services.get('scrubber');
    expect(status?.state).toBe('active');
    expect(status?.enabled).toBe(true);
    expect(status?.pid).toBe(m.services.get('scrubber')!.pid);
    expect((await restored.exec('ps -ef')).stdout).toContain('/usr/sbin/scrubber');
    expect(restored.snapshot()).toEqual(saved);
  });

  it('restores a failed unit together with its reason', async () => {
    const m = boot();
    await m.exec('sudo systemctl start scrubber');
    const restored = Machine.restore(m.snapshot(), { hostname: 'nav7' });
    expect((await restored.exec('systemctl status scrubber')).stdout).toContain('outside breathable range');
  });
});

describe('Act I, end to end', () => {
  // The real goal predicate from docs/PLAN.md, asserted on world state only.
  const goal = (m: Machine): boolean =>
    m.vfs.readText('/etc/life_support.conf', ROOT_USER).includes('O2_TARGET=21') &&
    m.services.get('scrubber')?.state === 'active';

  const routes: Array<[string, string[]]> = [
    ['sed then start', [
      "sudo sed -i 's/O2_TARGET=16/O2_TARGET=21/' /etc/life_support.conf",
      'sudo systemctl start scrubber',
    ]],
    ['edit then restart rather than start', [
      "sudo sed -i 's/16/21/' /etc/life_support.conf",
      'sudo systemctl restart scrubber',
    ]],
    ['enable and let boot start it', [
      "sudo sed -i 's/16/21/' /etc/life_support.conf",
      'sudo systemctl enable scrubber',
    ]],
  ];

  for (const [name, commands] of routes) {
    it(`accepts: ${name}`, async () => {
      const m = boot();
      expect(goal(m)).toBe(false);
      for (const command of commands) await m.exec(command);
      if (name.includes('boot')) m.services.startEnabled();
      expect(goal(m)).toBe(true);
    });
  }

  it('rejects fixing the config without starting the service', async () => {
    const m = boot();
    await m.exec("sudo sed -i 's/16/21/' /etc/life_support.conf");
    expect(goal(m)).toBe(false);
  });

  it('rejects starting the service without fixing the config', async () => {
    const m = boot();
    await m.exec('sudo systemctl start scrubber');
    expect(goal(m)).toBe(false);
  });
});
