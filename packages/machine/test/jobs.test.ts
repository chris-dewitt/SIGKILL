import { describe, expect, it } from 'vitest';
import { Machine } from '../src/machine.js';
import { matchField, matches, parseCrontab, type CronEntry } from '../src/proc/cron.js';
import { ROOT_USER } from '../src/vfs/vfs.js';

function boot(): Machine {
  // 14 March 2387, 00:00 UTC — a Friday, which the day-of-week cases rely on.
  const m = new Machine({ hostname: 'nav7', epoch: Date.UTC(2387, 2, 14) });
  m.vfs.mkdirp('/home/survivor', ROOT_USER);
  m.vfs.chown('/home/survivor', 1000, 1000, ROOT_USER);
  m.vfs.mkdirp('/var/log', ROOT_USER);
  m.vfs.chmod('/var/log', 0o777, ROOT_USER);
  m.vfs.mkdirp('/etc', ROOT_USER);
  m.shell.cwd = '/home/survivor';
  return m;
}

describe('the virtual clock', () => {
  it('only moves when something moves it', async () => {
    const m = boot();
    expect(m.time).toBe(0);
    await m.exec('echo hello');
    expect(m.time).toBe(0);
    await m.exec('sleep 5');
    expect(m.time).toBe(5000);
  });

  it('understands unit suffixes', async () => {
    const m = boot();
    await m.exec('sleep 2m');
    expect(m.time).toBe(120_000);
    await m.exec('sleep 1h');
    expect(m.time).toBe(3_720_000);
  });

  it('rejects a duration it cannot parse', async () => {
    const m = boot();
    const r = await m.exec('sleep soon');
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('invalid time interval');
    expect(m.time).toBe(0);
  });
});

describe('background jobs', () => {
  it('reports job id and pid, and does not print the output yet', async () => {
    const m = boot();
    const r = await m.exec('echo from-the-background &');
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/^\[1\] \d+\n$/);
    expect(r.stdout).not.toContain('from-the-background');
  });

  it('hands the output over when the job is listed', async () => {
    const m = boot();
    await m.exec('echo deferred &');
    const listed = await m.exec('jobs');
    expect(listed.stdout).toContain('echo deferred');
    expect(listed.stdout).toContain('deferred\n');

    // Reporting retires the job, as a real shell does.
    expect((await m.exec('jobs')).stdout).toBe('');
  });

  it('books a future completion for a backgrounded sleep instead of waiting', async () => {
    const m = boot();
    await m.exec('sleep 30 &');
    // The clock must not have moved: that is the whole point of &.
    expect(m.time).toBe(0);
    expect((await m.exec('jobs')).stdout).toContain('Running');
  });

  it('settles the job once the clock passes its completion', async () => {
    const m = boot();
    await m.exec('sleep 30 &');
    await m.exec('sleep 31');
    expect((await m.exec('jobs')).stdout).toContain('Done');
  });

  it('wait advances the clock to the job and collects its output', async () => {
    const m = boot();
    await m.exec('sleep 45 &');
    expect(m.time).toBe(0);

    const r = await m.exec('wait');
    expect(m.time).toBe(45_000);
    expect(r.code).toBe(0);
    expect((await m.exec('jobs')).stdout).toBe('');
  });

  it('surfaces a failing background job through its exit code', async () => {
    const m = boot();
    await m.exec('false &');
    const r = await m.exec('wait');
    expect(r.code).toBe(1);
  });

  it('reports a job number that does not exist', async () => {
    const m = boot();
    const r = await m.exec('wait 7');
    expect(r.code).toBe(127);
    expect(r.stderr).toContain('no such job');
  });

  it('registers a process for the job', async () => {
    const m = boot();
    await m.exec('sleep 10 &');
    expect((await m.exec('ps')).stdout).toContain('sleep');
  });

  it('backgrounds a whole and-or list, not just the last command', async () => {
    const m = boot();
    await m.exec('true && echo chained &');
    expect((await m.exec('jobs')).stdout).toContain('true && echo chained');
  });
});

describe('cron field matching', () => {
  const at = { minute: 30, hour: 3, dayOfMonth: 14, month: 3, dayOfWeek: 5 };

  it('matches wildcards, values, ranges, lists and steps', () => {
    expect(matchField('*', 30)).toBe(true);
    expect(matchField('30', 30)).toBe(true);
    expect(matchField('29', 30)).toBe(false);
    expect(matchField('0-45', 30)).toBe(true);
    expect(matchField('0-15', 30)).toBe(false);
    expect(matchField('5,30,55', 30)).toBe(true);
    expect(matchField('*/15', 30)).toBe(true);
    expect(matchField('*/7', 30)).toBe(false);
    expect(matchField('0-59/10', 30)).toBe(true);
  });

  it('ORs day-of-month against day-of-week when both are restricted', () => {
    // The famous cron gotcha, reproduced deliberately: with both day fields
    // restricted, a match on either one fires.
    const entry = (dom: string, dow: string): CronEntry => ({
      minute: '30', hour: '3', dayOfMonth: dom, month: '*', dayOfWeek: dow,
      user: 'root', command: 'true', source: '',
    });

    expect(matches(entry('14', '1'), at)).toBe(true);  // day of month hits
    expect(matches(entry('1', '5'), at)).toBe(true);   // day of week hits
    expect(matches(entry('1', '1'), at)).toBe(false);  // neither
    expect(matches(entry('14', '*'), at)).toBe(true);  // only dom restricted
    expect(matches(entry('1', '*'), at)).toBe(false);
  });
});

describe('crontab parsing', () => {
  it('skips comments, blanks and environment assignments', () => {
    const entries = parseCrontab(
      [
        '# NAV-7 schedule',
        'SHELL=/bin/sh',
        'PATH=/usr/bin:/bin',
        '',
        '*/5 * * * * root /usr/sbin/beacon --ping',
        '0 3 * * * root echo nightly >> /var/log/cron.log',
        'garbage',
      ].join('\n'),
    );
    expect(entries).toHaveLength(2);
    expect(entries[0]!.command).toBe('/usr/sbin/beacon --ping');
    expect(entries[1]!.minute).toBe('0');
  });
});

describe('cron execution', () => {
  it('fires an entry when the clock crosses its minute', async () => {
    const m = boot();
    m.vfs.writeText('/etc/crontab', '*/5 * * * * root echo tick >> /var/log/cron.log\n', ROOT_USER);

    await m.exec('sleep 4m');
    expect(m.vfs.exists('/var/log/cron.log', ROOT_USER)).toBe(false);

    await m.exec('sleep 2m');
    expect(m.vfs.readText('/var/log/cron.log', ROOT_USER)).toBe('tick\n');
  });

  it('never fires the same minute twice', async () => {
    const m = boot();
    m.vfs.writeText('/etc/crontab', '* * * * * root echo x >> /var/log/cron.log\n', ROOT_USER);

    await m.exec('sleep 3m');
    const after = m.vfs.readText('/var/log/cron.log', ROOT_USER);
    expect(after.trim().split('\n')).toHaveLength(3);

    // Advancing by zero must not replay anything.
    await m.tick(0);
    expect(m.vfs.readText('/var/log/cron.log', ROOT_USER)).toBe(after);
  });

  it('caps catch-up so a long sleep cannot spawn thousands of runs', async () => {
    const m = boot();
    m.vfs.writeText('/etc/crontab', '* * * * * root echo x >> /var/log/cron.log\n', ROOT_USER);

    await m.exec('sleep 10h');
    const lines = m.vfs.readText('/var/log/cron.log', ROOT_USER).trim().split('\n');
    expect(lines.length).toBe(60);
  });

  it('respects the hour field against the machine epoch, not wall time', async () => {
    const m = boot();
    m.vfs.writeText('/etc/crontab', '0 3 * * * root echo dawn >> /var/log/cron.log\n', ROOT_USER);

    await m.exec('sleep 2h');
    expect(m.vfs.exists('/var/log/cron.log', ROOT_USER)).toBe(false);

    await m.exec('sleep 1h');
    expect(m.vfs.readText('/var/log/cron.log', ROOT_USER)).toBe('dawn\n');
  });

  it('does not re-enter itself when a cron job sleeps', async () => {
    const m = boot();
    m.vfs.writeText('/etc/crontab', '* * * * * root sleep 120\n', ROOT_USER);
    // If cron re-entered through the sleep inside its own job this would
    // recurse until the stack gave out.
    await expect(m.exec('sleep 5m')).resolves.toBeDefined();
  });

  it('lists entries with crontab -l', async () => {
    const m = boot();
    m.vfs.writeText('/etc/crontab', '# header\n0 3 * * * root /usr/sbin/beacon\n', ROOT_USER);
    const r = await m.exec('crontab -l');
    expect(r.stdout).toBe('0 3 * * * root /usr/sbin/beacon\n');
  });
});

describe('time stays deterministic', () => {
  it('produces identical snapshots for identical input, cron included', async () => {
    const script = [
      'echo start > /var/log/run.log',
      'sleep 90 &',
      'sleep 3m',
      'wait',
      'jobs',
    ];

    const run = async (): Promise<unknown> => {
      const m = boot();
      m.vfs.writeText('/etc/crontab', '* * * * * root echo beat >> /var/log/cron.log\n', ROOT_USER);
      for (const line of script) await m.exec(line);
      return m.snapshot();
    };

    expect(await run()).toEqual(await run());
  });
});
